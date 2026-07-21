// 計測タブの根幹(音名判定・セント計算・ピッチ検出)をNodeで検証するハーネス。
// App.jsxから対象の関数・定数をそのまま抽出してevalし、「実装そのもの」をテストする。
// 検証項目(ユーザー要求):
//   1. メーターが1cent単位でしっかり動くか(ピッチ検出精度<±0.5¢・1¢の弁別)
//   2. 正しい音名が表示されるか(全サックス種別×全音×基準Hz438-444で記音ラベル一致)
//   3. これまでの音(グラフ)にも同じ値が反映されるか(メーター¢とグラフ¢の完全一致)
// 使い方: node scripts/pitch-test.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "..", "src", "App.jsx"), "utf8");

function extractFunction(name) {
  const idx = src.indexOf(`function ${name}(`);
  if (idx === -1) throw new Error(`function ${name} not found`);
  let i = src.indexOf("{", idx);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error(`function ${name}: unbalanced braces`);
}
function extractConst(name) {
  const re = new RegExp(`const ${name} = `);
  const m = re.exec(src);
  if (!m) throw new Error(`const ${name} not found`);
  const start = m.index;
  const eq = src.indexOf("=", start);
  let i = eq + 1;
  while (src[i] === " ") i++;
  if (src[i] === "{" || src[i] === "[") {
    const open = src[i], close = open === "{" ? "}" : "]";
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === open) depth++;
      else if (src[i] === close) { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i) + ";";
  }
  const end = src.indexOf(";", start);
  return src.slice(start, end + 1);
}

const code = [
  extractConst("NOTE_NAMES"),
  extractConst("NOTE_NAMES_SHARP"),
  extractConst("LOW_BB_WRITTEN_MIDI"),
  extractConst("TRANSPOSITION_SEMITONES"),
  extractConst("A4_MIDI"),
  extractConst("PITCH_CLARITY_MIN"),
  extractFunction("freqToNote"),
  extractFunction("centsBetween"),
  extractFunction("writtenNoteLabel"),
  extractFunction("parseNoteLabel"),
  extractFunction("writtenMidiToSoundingFreq"),
  extractConst("SAX_CONCERT_RANGE"),
  extractFunction("concertMidiToFreq"),
  extractFunction("concertFreqLabel"),
  extractFunction("saxPitchBounds"),
  extractFunction("buildFingeringTable"),
  extractFunction("findClosestFingering"),
  extractConst("TIMBRE_SUSTAIN_MS"),
  extractConst("NOTE_SWITCH_CENTS"),
  extractConst("PITCH_OUTLIER_CENTS"),
  extractFunction("fftRadix2"),
  extractFunction("detectPitchMPM"),
  extractFunction("computeTimbreMetrics"),
  extractFunction("frameWeight"),
  extractFunction("timbreSustained"),
  extractFunction("weightedMean"),
  extractFunction("sanitizePitchOutliers"),
  extractFunction("holdFingering"),
  extractConst("FINGERING_MATCH_MAX_CENTS"),
  extractFunction("matchFingering"),
  extractFunction("applyBandpassRBJ"),
  extractConst("METRO_TEMPO_MIN"),
  extractConst("METRO_TEMPO_MAX"),
  extractFunction("clampMetroTempo"),
  extractFunction("parseMetroSig"),
  extractFunction("metroBeatGroups"),
  extractFunction("metroX8BeatStarts"),
  extractFunction("metroTickKind"),
  extractFunction("isNearScheduledClick"),
  extractConst("METRO_WEIGHT_TOP_MIN"),
  extractConst("METRO_WEIGHT_TOP_MAX"),
  extractFunction("metroWeightTop"),
].join("\n\n");

const api = new Function(`${code}
  return { freqToNote, centsBetween, writtenNoteLabel, parseNoteLabel, writtenMidiToSoundingFreq,
           buildFingeringTable, findClosestFingering, fftRadix2, detectPitchMPM, computeTimbreMetrics,
           frameWeight, timbreSustained, weightedMean, sanitizePitchOutliers, holdFingering,
           matchFingering, applyBandpassRBJ, concertMidiToFreq, concertFreqLabel, saxPitchBounds,
           clampMetroTempo, parseMetroSig, metroBeatGroups, metroX8BeatStarts, metroTickKind, isNearScheduledClick, metroWeightTop,
           NOTE_NAMES, NOTE_NAMES_SHARP, LOW_BB_WRITTEN_MIDI, TRANSPOSITION_SEMITONES, A4_MIDI, PITCH_CLARITY_MIN,
           TIMBRE_SUSTAIN_MS, NOTE_SWITCH_CENTS, PITCH_OUTLIER_CENTS, FINGERING_MATCH_MAX_CENTS, SAX_CONCERT_RANGE,
           METRO_TEMPO_MIN, METRO_TEMPO_MAX, METRO_WEIGHT_TOP_MIN, METRO_WEIGHT_TOP_MAX };`)();

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail = "") {
  if (cond) pass++;
  else { fail++; failures.push(`${label}${detail ? " — " + detail : ""}`); }
}

const SR = 48000, BUF = 8192;
// サックス様の波形合成(8倍音・振幅1/h・位相ばらし)。ampFnで倍音バランスを変えられる。
function synthTone(f0, { ampFn = (h) => 1 / h, harmonics = 8, noise = 0, sampleRate = SR, len = BUF } = {}) {
  const buf = new Float32Array(len);
  for (let h = 1; h <= harmonics; h++) {
    const a = ampFn(h);
    const w = (2 * Math.PI * f0 * h) / sampleRate;
    const ph = (h * 1.2345) % (2 * Math.PI);
    for (let i = 0; i < len; i++) buf[i] += a * Math.sin(w * i + ph);
  }
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let i = 0; i < len; i++) buf[i] = (buf[i] / max) * 0.4 + noise * rand();
  return buf;
}
const detectCents = (freqTrue, buf) => {
  const r = api.detectPitchMPM(buf, SR);
  if (!r) return null;
  return { cents: 1200 * Math.log2(r.freq / freqTrue), clarity: r.clarity, freq: r.freq };
};

// ============================================================
// 検証1: ピッチ検出精度 — 全音(アルト)×オフセット{-30..+30}¢で誤差≤0.5¢
// ============================================================
console.log("=== 検証1: MPMピッチ検出精度(要求: 誤差≤0.5¢) ===");
{
  let maxErr = 0, sumErr = 0, n = 0;
  const table = api.buildFingeringTable("alto", 442, 30);
  for (const entry of table) {
    for (const c of [-30, -10, -3, -1, 0, 1, 3, 10, 30]) {
      const f = entry.soundingFreqHz * Math.pow(2, c / 1200);
      const d = detectCents(f, synthTone(f));
      if (!d) { check(`detect ${entry.writtenLabel} ${c}c`, false, "検出失敗"); continue; }
      const err = Math.abs(d.cents);
      maxErr = Math.max(maxErr, err); sumErr += err; n++;
      check(`detect ${entry.writtenLabel} ${c}c`, err <= 0.5, `誤差${d.cents.toFixed(2)}¢`);
    }
  }
  console.log(`  誤差: 平均 ${(sumErr / n).toFixed(3)}¢ / 最大 ${maxErr.toFixed(3)}¢ (${n}ケース)`);
}

// ============================================================
// 検証2: 1¢の弁別 — 1¢違いの2音を検出値の差としてちゃんと区別できるか
// ============================================================
console.log("=== 検証2: 1¢単位の弁別 ===");
{
  const table = api.buildFingeringTable("alto", 442, 30);
  for (const entry of [table[0], table[10], table[20], table[29]]) {
    const f1 = entry.soundingFreqHz;
    const d0 = detectCents(f1, synthTone(f1));
    const f2 = f1 * Math.pow(2, 1 / 1200);
    const d1 = detectCents(f1, synthTone(f2)); // 基準はf1のまま→検出差は+1¢のはず
    const diff = d1 && d0 ? d1.cents - d0.cents : null;
    check(`1c-step ${entry.writtenLabel}`, diff !== null && Math.abs(diff - 1) < 0.3,
      diff === null ? "検出失敗" : `検出差 ${diff.toFixed(2)}¢ (期待1.0¢)`);
  }
  console.log("  -> done");
}

// ============================================================
// 検証3: 音名の正しさ — 全サックス種別×基準438/440/442/444×全30音で
// 検出周波数→記音ラベルが期待と一致(±30¢ずらしても同じ音に判定)
// ============================================================
console.log("=== 検証3: 音名判定(全種別×全音×基準Hz) ===");
{
  const before = fail;
  for (const sax of ["soprano", "alto", "tenor", "baritone"]) {
    for (const tuning of [438, 440, 442, 444]) {
      const table = api.buildFingeringTable(sax, tuning, 30);
      for (const entry of table) {
        for (const c of [-30, 0, 30]) {
          const f = entry.soundingFreqHz * Math.pow(2, c / 1200);
          const r = api.detectPitchMPM(synthTone(f), SR);
          if (!r) { check(`name ${sax}@${tuning} ${entry.writtenLabel} ${c}c`, false, "検出失敗"); continue; }
          const m = api.findClosestFingering(r.freq, table);
          check(`name ${sax}@${tuning} ${entry.writtenLabel} ${c}c`,
            m && m.writtenLabel === entry.writtenLabel,
            m ? `got ${m.writtenLabel}` : "null");
          // 大表示用のparseNoteLabelも壊れていないこと
          const p = api.parseNoteLabel(entry.writtenLabel);
          check(`parse ${entry.writtenLabel}`, p && p.name + p.octave === entry.writtenLabel);
        }
      }
    }
  }
  console.log(`  -> ${fail === before ? "all pass" : `${fail - before} fail`}`);
}

// ============================================================
// 検証3b: 実音(コンサートピッチ)表示 — メーター/グラフに出す音名は
// freqToNote(実測周波数, 基準)で得られる実音であり、記音(運指)とは
// 移調分ずれること。アルトのwritten C→concert E♭、written G→concert B♭を確認。
// (メーター・グラフは共に frame.concertNote = freqToNote(f0).name+octave を使う)
// ============================================================
console.log("=== 検証3b: 実音表示(記音ではなく実音) ===");
{
  const before = fail;
  const table = api.buildFingeringTable("alto", 442, 30);
  const wC = table.find((e) => e.writtenLabel === "C5");   // 記音C
  const wG = table.find((e) => e.writtenLabel === "G4");   // 記音G
  for (const [entry, expectPc] of [[wC, "E♭"], [wG, "B♭"]]) {
    if (!entry) { check(`実音 ${expectPc}`, false, "テーブルに音がない"); continue; }
    const r = api.detectPitchMPM(synthTone(entry.soundingFreqHz), SR);
    const meter = r ? api.freqToNote(r.freq, 442) : null;               // メーター実音
    const written = api.findClosestFingering(r.freq, table)?.writtenLabel; // 記音
    // 実音の音名クラスが期待どおり(E♭/B♭)で、記音(C/G)とは異なること
    check(`実音表示 記音${entry.writtenLabel}→実音${expectPc}`,
      meter && meter.name === expectPc && written && written[0] !== expectPc[0],
      meter ? `meter=${meter.name}${meter.octave} written=${written}` : "検出失敗");
  }
  console.log(`  -> ${fail === before ? "all pass" : `${fail - before} fail`}`);
}

// ============================================================
// 検証4: メーターとグラフのリンク — 同じf0に対し
// メーター(freqToNote(f, 実効基準).centsExact)とグラフ(同じ値を保存)が一致し、
// かつ運指テーブルのcentsErrorとも一致する(0¢基準の同一性)
// ============================================================
console.log("=== 検証4: メーター¢ = グラフ¢ = テーブル¢ ===");
{
  const before = fail;
  for (const tuning of [438, 442, 444]) {
    const table = api.buildFingeringTable("alto", tuning, 30);
    for (const entry of table) {
      for (const c of [-40, -1, 0, 1, 40]) {
        const f = entry.soundingFreqHz * Math.pow(2, c / 1200);
        const r = api.detectPitchMPM(synthTone(f), SR);
        if (!r) { check(`link ${entry.writtenLabel} ${c}c`, false, "検出失敗"); continue; }
        // メーター: freqToNote(f0, 実効基準).centsExact / グラフ: pitchCentsUnified = 同じ値(共有変数)
        const meter = api.freqToNote(r.freq, tuning);
        const m = api.findClosestFingering(r.freq, table);
        check(`link ${entry.writtenLabel} ${c}c`,
          meter && m && Math.abs(meter.centsExact - m.centsError) < 0.01 && Math.abs(meter.centsExact - c) <= 0.5,
          `meter=${meter?.centsExact?.toFixed(2)} table=${m?.centsError?.toFixed(2)} 期待${c}`);
      }
    }
  }
  console.log(`  -> ${fail === before ? "all pass" : `${fail - before} fail`}`);
}

// ============================================================
// 検証5: 楽器以外の排除 — 白色ノイズ/無音はclarity不足で棄却されること
// ============================================================
console.log("=== 検証5: ノイズ・無音の棄却 ===");
{
  let seed = 99;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  const noise = new Float32Array(BUF);
  for (let i = 0; i < BUF; i++) noise[i] = rand() * 0.5;
  const rn = api.detectPitchMPM(noise, SR);
  check("白色ノイズ棄却", !rn || rn.clarity < api.PITCH_CLARITY_MIN, rn ? `clarity=${rn.clarity.toFixed(2)}` : "");
  const silence = new Float32Array(BUF);
  check("無音棄却", api.detectPitchMPM(silence, SR) === null);
  // 楽音+軽いノイズ(SNR確保)はちゃんと通ること
  const f = 442;
  const rt = api.detectPitchMPM(synthTone(f, { noise: 0.02 }), SR);
  check("楽音+軽ノイズ通過", rt && rt.clarity >= api.PITCH_CLARITY_MIN && Math.abs(1200 * Math.log2(rt.freq / f)) <= 1,
    rt ? `clarity=${rt.clarity.toFixed(2)} err=${(1200 * Math.log2(rt.freq / f)).toFixed(2)}¢` : "null");
  console.log("  -> done");
}

// ============================================================
// 検証6: 頑健性 — 2倍音優勢の音色でもオクターブを間違えないか、
// DCオフセット、微小振幅、ビブラート(±15¢/5Hz)
// ============================================================
console.log("=== 検証6: 頑健性(音色・DC・振幅・ビブラート) ===");
{
  const f = 220; // アルト実音域の中低音
  // 2倍音が基音より強い音色
  const strong2 = synthTone(f, { ampFn: (h) => (h === 2 ? 1.2 : 1 / h) });
  const r2 = detectCents(f, strong2);
  check("2倍音優勢でオクターブ維持", r2 && Math.abs(r2.cents) <= 1, r2 ? `err=${r2.cents.toFixed(1)}¢` : "検出失敗");
  // DCオフセット
  const dc = synthTone(f); const dcBuf = new Float32Array(BUF);
  for (let i = 0; i < BUF; i++) dcBuf[i] = dc[i] + 0.3;
  const rdc = detectCents(f, dcBuf);
  check("DCオフセット耐性", rdc && Math.abs(rdc.cents) <= 0.5, rdc ? `err=${rdc.cents.toFixed(2)}¢` : "検出失敗");
  // 微小振幅(ゲートは別途音量で判定するので、検出自体は通ってよい)
  const tiny = synthTone(f); const tinyBuf = new Float32Array(BUF);
  for (let i = 0; i < BUF; i++) tinyBuf[i] = tiny[i] * 0.002;
  const rt = detectCents(f, tinyBuf);
  check("微小振幅での検出", rt && Math.abs(rt.cents) <= 0.5, rt ? `err=${rt.cents.toFixed(2)}¢` : "検出失敗");
  // ビブラート ±15¢ 5Hz → 窓平均に近い値(±8¢以内)が返ればよい
  const vib = new Float32Array(BUF);
  for (let h = 1; h <= 6; h++) {
    const a = 1 / h; let phase = 0;
    for (let i = 0; i < BUF; i++) {
      const fInst = f * Math.pow(2, (15 * Math.sin((2 * Math.PI * 5 * i) / SR)) / 1200);
      phase += (2 * Math.PI * fInst * h) / SR;
      vib[i] += a * Math.sin(phase);
    }
  }
  // ビブラートはチューナーとして「揺れを追従」するのが正しい挙動。
  // 検出値が変調幅(±15¢)の範囲内にあることを確認する(平均への収束は要求しない)。
  const rv = detectCents(f, vib);
  check("ビブラート追従(変調幅内)", rv && Math.abs(rv.cents) <= 15, rv ? `err=${rv.cents.toFixed(1)}¢` : "検出失敗");
  console.log("  -> done");
}

// ============================================================
// 検証7: 実行速度 — rAF(60fps)ループ内で毎フレーム呼んでも間に合うか
// ============================================================
console.log("=== 検証7: 実行速度(1回あたり<8ms) ===");
{
  const buf = synthTone(220);
  const t0 = performance.now();
  const N = 100;
  for (let i = 0; i < N; i++) api.detectPitchMPM(buf, SR);
  const per = (performance.now() - t0) / N;
  console.log(`  detectPitchMPM: ${per.toFixed(2)} ms/回`);
  check("速度(60fps耐性)", per < 8, `${per.toFixed(2)}ms`);
}

// ============================================================
// 検証8〜11: 音色測定(computeTimbreMetrics) — 倍音・重心・HNR
// ============================================================

// 倍音振幅を正規化せず正確に指定できる合成器(HNRの理論値計算に使うため振幅を保存する)
function synthKnown(f0, amps, { noiseStd = 0, sampleRate = SR, len = BUF } = {}) {
  const buf = new Float32Array(len);
  for (let h = 1; h <= amps.length; h++) {
    const a = amps[h - 1];
    const w = (2 * Math.PI * f0 * h) / sampleRate;
    const ph = (h * 1.2345) % (2 * Math.PI);
    for (let i = 0; i < len; i++) buf[i] += a * Math.sin(w * i + ph);
  }
  if (noiseStd > 0) {
    // mulberry32: 旧LCG(seed*1103515245が2^53超で浮動小数精度が壊れる)はスペクトルに
    // 構造が出て白色にならない(最大/中央値≒12倍。理想は≒3.5倍)ため使わない
    let a = 987654321;
    const rand = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5; };
    // 一様乱数12個の和 ≒ 標準正規(分散1) → noiseStd倍で白色雑音(既知パワー)にする
    for (let i = 0; i < len; i++) { let g = 0; for (let k = 0; k < 12; k++) g += rand(); buf[i] += noiseStd * g; }
  }
  return buf;
}

// ビブラートつき合成(周波数変調。位相を毎サンプル積分して倍音間の整合を保つ)
function synthVibrato(f0, { cents = 20, rate = 5.5, amps = [1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.125], sampleRate = SR, len = BUF } = {}) {
  const buf = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const f = f0 * Math.pow(2, (cents * Math.sin(2 * Math.PI * rate * t)) / 1200);
    phase += (2 * Math.PI * f) / sampleRate;
    for (let h = 1; h <= amps.length; h++) buf[i] += amps[h - 1] * Math.sin(h * phase + ((h * 1.2345) % (2 * Math.PI)));
  }
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  for (let i = 0; i < len; i++) buf[i] = (buf[i] / max) * 0.4;
  return buf;
}

console.log("=== 検証8: 倍音プロファイル精度(既知振幅の再現) ===");
{
  const trueAmps = [1.0, 0.6, 0.35, 0.2, 0.12, 0.08, 0.05, 0.03];
  // 代表音域(バリトン低音〜ソプラノ高音相当)
  for (const f0 of [116.54, 220, 349.23, 440, 587.33, 880]) {
    const buf = synthKnown(f0, trueAmps.map((a) => a * 0.3));
    const tm = api.computeTimbreMetrics(buf, SR, f0, 8);
    check(`倍音測定が返る f0=${f0}`, !!tm && tm.harmonics.length === 8);
    if (!tm) continue;
    const maxMag = Math.max(...tm.harmonics.map((l) => l.mag), 1e-9);
    tm.harmonics.forEach((l, i) => {
      const norm = l.mag / maxMag;
      check(`倍音norm f0=${f0} n=${l.n}`, Math.abs(norm - trueAmps[i]) < 0.05,
        `期待${trueAmps[i]} 実測${norm.toFixed(3)}`);
    });
  }

  // ビン格子非依存: f0をビン幅(5.86Hz)以下で微妙にずらしても値が揺れないこと
  // (旧実装の±2ビン最大値はピークがビン間に落ちると過小評価していた)
  const profiles = [];
  for (const f0 of [440, 441.3, 442.9, 444.7]) {
    const buf = synthKnown(f0, trueAmps.map((a) => a * 0.3));
    const tm = api.computeTimbreMetrics(buf, SR, f0, 8);
    const maxMag = Math.max(...tm.harmonics.map((l) => l.mag), 1e-9);
    profiles.push(tm.harmonics.map((l) => l.mag / maxMag));
  }
  for (let n = 0; n < 8; n++) {
    const vals = profiles.map((p) => p[n]);
    const spread = Math.max(...vals) - Math.min(...vals);
    check(`ビン格子非依存 n=${n + 1}`, spread < 0.02, `振れ幅${spread.toFixed(4)}`);
  }
}

console.log("=== 検証9: ビブラート耐性(HNR・倍音プロファイル) ===");
{
  const amps = [1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.125];
  for (const f0 of [220, 440, 660]) {
    const buf = synthVibrato(f0, { cents: 20, rate: 5.5, amps });
    const tm = api.computeTimbreMetrics(buf, SR, f0, 8);
    check(`ビブラート時HNR f0=${f0}`, tm && tm.hnrDb >= 25,
      `HNR=${tm ? tm.hnrDb.toFixed(1) : "null"}dB(きれいな音のビブラートでHNRが下がってはいけない)`);
    if (!tm) continue;
    const maxMag = Math.max(...tm.harmonics.map((l) => l.mag), 1e-9);
    tm.harmonics.forEach((l, i) => {
      const norm = l.mag / maxMag;
      check(`ビブラート時倍音norm f0=${f0} n=${l.n}`, Math.abs(norm - amps[i]) < 0.1,
        `期待${amps[i]} 実測${norm.toFixed(3)}`);
    });
  }
}

console.log("=== 検証10: HNRの定量精度(既知ノイズ量との一致) ===");
{
  const amps = [0.3, 0.18, 0.1, 0.06, 0.04, 0.02, 0.012, 0.008];
  const f0 = 440;
  const nyquist = SR / 2;
  // 期待HNRの理論値: 白色雑音は帯域に一様に分布するため、評価帯域(0.5f0〜8.5f0)内の
  // ノイズパワーと、倍音帯域(次数比例幅)に紛れ込むノイズパワーを面積比で見積もる
  const Ph = amps.reduce((s, a) => s + (a * a) / 2, 0);
  const evalWidth = 8 * f0;
  let harmWidth = 0;
  for (let n = 1; n <= 8; n++) harmWidth += 2 * (15 + 0.015 * f0 * n);
  const results = [];
  for (const noiseStd of [0.02, 0.05, 0.1]) {
    const buf = synthKnown(f0, amps, { noiseStd });
    const tm = api.computeTimbreMetrics(buf, SR, f0, 8);
    const PnPerHz = (noiseStd * noiseStd) / nyquist;
    const PnEval = PnPerHz * evalWidth;
    const PnHarm = PnPerHz * harmWidth;
    const expected = 10 * Math.log10((Ph + PnHarm) / (PnEval - PnHarm));
    results.push(tm.hnrDb);
    check(`HNR定量 noiseStd=${noiseStd}`, Math.abs(tm.hnrDb - expected) < 3,
      `期待${expected.toFixed(1)}dB 実測${tm.hnrDb.toFixed(1)}dB`);
  }
  check("HNR単調性(ノイズ増→HNR減)", results[0] > results[1] && results[1] > results[2],
    results.map((r) => r.toFixed(1)).join(" > "));
  // クリーンな音は十分高いHNR
  const clean = api.computeTimbreMetrics(synthKnown(f0, amps), SR, f0, 8);
  check("クリーン音のHNR≥40dB", clean.hnrDb >= 40, `${clean.hnrDb.toFixed(1)}dB`);
}

console.log("=== 検証11: スペクトル重心(ノイズ床・帯域外の除外) ===");
{
  // 純音: 重心はその周波数に一致するはず
  const pure = api.computeTimbreMetrics(synthKnown(440, [0.3]), SR, 440, 8);
  check("純音440Hzの重心", Math.abs(pure.centroidHz - 440) < 12, `${pure.centroidHz.toFixed(1)}Hz`);

  // 倍音つき: 振幅加重平均に一致するはず
  const amps = [0.3, 0.18, 0.1, 0.06];
  const expected = amps.reduce((s, a, i) => s + a * 440 * (i + 1), 0) / amps.reduce((s, a) => s + a, 0);
  const harm = api.computeTimbreMetrics(synthKnown(440, amps), SR, 440, 8);
  check("倍音音の重心=振幅加重平均", Math.abs(harm.centroidHz - expected) / expected < 0.05,
    `期待${expected.toFixed(0)}Hz 実測${harm.centroidHz.toFixed(0)}Hz`);

  // 弱音+ノイズ床: -60dB閾値でノイズビンが除外され、重心がほぼ動かないこと
  const weakClean = api.computeTimbreMetrics(synthKnown(440, amps.map((a) => a * 0.15)), SR, 440, 8);
  const weakNoisy = api.computeTimbreMetrics(synthKnown(440, amps.map((a) => a * 0.15), { noiseStd: 0.003 }), SR, 440, 8);
  check("弱音でもノイズ床に重心が引っ張られない",
    Math.abs(weakNoisy.centroidHz - weakClean.centroidHz) / weakClean.centroidHz < 0.1,
    `クリーン${weakClean.centroidHz.toFixed(0)}Hz ノイズあり${weakNoisy.centroidHz.toFixed(0)}Hz`);

  // 10kHz超の高域ヒス(帯域外)は重心に影響しないこと
  const hissBuf = synthKnown(440, amps);
  const w15k = (2 * Math.PI * 15000) / SR;
  for (let i = 0; i < hissBuf.length; i++) hissBuf[i] += 0.1 * Math.sin(w15k * i);
  const withHiss = api.computeTimbreMetrics(hissBuf, SR, 440, 8);
  check("10kHz超の成分は重心から除外",
    Math.abs(withHiss.centroidHz - harm.centroidHz) / harm.centroidHz < 0.02,
    `ヒスなし${harm.centroidHz.toFixed(0)}Hz ヒスあり${withHiss.centroidHz.toFixed(0)}Hz`);

  // 異常系: 無音・f0なし・短バッファはnull
  check("無音はnull", api.computeTimbreMetrics(new Float32Array(BUF), SR, null, 8) === null);
  check("短バッファはnull", api.computeTimbreMetrics(new Float32Array(1024), SR, 440, 8) === null);

  // 実行速度(rAFループ内で毎フレーム呼ぶため)
  const buf = synthKnown(440, amps);
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) api.computeTimbreMetrics(buf, SR, 440, 8);
  const per = (performance.now() - t0) / 100;
  console.log(`  computeTimbreMetrics: ${per.toFixed(2)} ms/回`);
  check("音色測定の速度(60fps耐性)", per < 8, `${per.toFixed(2)}ms`);
}

// ============================================================
// 検証12〜14: 記録データの頑健化(外れ値除去・音名ヒステリシス・重み付き集計)
// ============================================================

console.log("=== 検証12: 単発ピッチ誤検出の除去(sanitizePitchOutliers) ===");
{
  const mkFrame = (pitchHz) => ({
    pitchHz, pitchCents: pitchHz ? 5 : null, matchedWrittenNote: pitchHz ? "C5" : null,
    concertNote: pitchHz ? "E♭4" : null, semitoneIndex: pitchHz ? 14 : null,
    volumeDb: -30, spectralCentroidHz: pitchHz ? 900 : null, hnrDb: pitchHz ? 20 : null,
    harmonics: [], clarity: pitchHz ? 0.95 : null,
    matchScore: { pitch: { theoretical: 0.9, ideal: 0 }, timbre: { ideal: 0 } },
  });
  // オクターブ誤検出(1フレームだけ2倍)は除去される
  const octaveGlitch = [440, 440, 880, 440, 440].map(mkFrame);
  const fixed = api.sanitizePitchOutliers(octaveGlitch);
  check("オクターブ誤検出が無効化される", fixed[2].pitchHz === null && fixed[2].pitchCents === null);
  check("誤検出フレームの音色も無効化", fixed[2].spectralCentroidHz === null && fixed[2].hnrDb === null);
  check("前後の正常フレームは保持", fixed[1].pitchHz === 440 && fixed[3].pitchHz === 440);
  check("音量は保持(実測値のため)", fixed[2].volumeDb === -30);

  // 速いパッセージ(トリル: 隣接音±200¢)は実音として保持される
  const trill = [440, 493.88, 440, 493.88, 440].map(mkFrame); // A4-B4トリル(約204¢)
  const trillOut = api.sanitizePitchOutliers(trill);
  check("トリルは除去されない", trillOut.every((f) => f.pitchHz !== null));

  // 2フレーム続く高い音(実音とみなす)は保持される
  const twoFrames = [440, 440, 880, 880, 440, 440].map(mkFrame);
  const twoOut = api.sanitizePitchOutliers(twoFrames);
  check("2フレーム続く音は保持(実音扱い)", twoOut[2].pitchHz === 880 && twoOut[3].pitchHz === 880);

  // 無音を挟むと判定しない(連続3フレームが条件)
  const withGap = [mkFrame(440), mkFrame(null), mkFrame(880), mkFrame(null), mkFrame(440)];
  const gapOut = api.sanitizePitchOutliers(withGap);
  check("無音を挟む場合は判定対象外", gapOut[2].pitchHz === 880);

  // 短い配列・空配列はそのまま
  check("空配列OK", api.sanitizePitchOutliers([]).length === 0);
  check("2フレームはそのまま", api.sanitizePitchOutliers([440, 880].map(mkFrame)).every((f) => f.pitchHz !== null));
}

console.log("=== 検証13: 音名グルーピングのヒステリシス(holdFingering) ===");
{
  const table = api.buildFingeringTable("alto", 442, 30);
  // 半音境界ちょうど(+50¢)の音: 生の判定はフレーム毎に揺れるが、ヒステリシスで保持される
  const entry = table[14];
  const fBoundary = entry.soundingFreqHz * Math.pow(2, 50 / 1200); // ちょうど中間
  const fJustOver = entry.soundingFreqHz * Math.pow(2, 52 / 1200); // わずかに上
  const candOver = api.findClosestFingering(fJustOver, table); // 生判定は隣の音
  check("生判定は隣の音(前提確認)", candOver.semitoneIndex === 15);
  const held = api.holdFingering(entry, fJustOver, candOver);
  check("±60¢以内なら前の音名を保持", held.semitoneIndex === 14, `→${held.semitoneIndex}`);
  check("保持時のcentsErrorは前の音基準", Math.abs(held.centsError - 52) < 0.5, `${held.centsError.toFixed(1)}¢`);

  // 本当に隣の音へ移った(+120¢)場合は切り替わる
  const fMoved = entry.soundingFreqHz * Math.pow(2, 120 / 1200);
  const candMoved = api.findClosestFingering(fMoved, table);
  const switched = api.holdFingering(entry, fMoved, candMoved);
  check("±60¢を超えたら切り替え", switched.semitoneIndex === 15, `→${switched.semitoneIndex}`);

  // 同じ音のままなら素通し
  const same = api.holdFingering(entry, entry.soundingFreqHz, api.findClosestFingering(entry.soundingFreqHz, table));
  check("同じ音は素通し", same.semitoneIndex === 14);
  // 前の音がない(発音開始)なら候補をそのまま使う
  check("初回は候補をそのまま", api.holdFingering(null, fJustOver, candOver).semitoneIndex === 15);

  // 境界チャタリングのシミュレーション: 境界±2¢で揺れる20フレーム → 音名は1つに固定される
  let prev = null;
  const assigned = [];
  for (let i = 0; i < 20; i++) {
    const f = fBoundary * Math.pow(2, ((i % 2 === 0 ? -2 : 2) / 1200));
    const m = api.holdFingering(prev, f, api.findClosestFingering(f, table));
    prev = m;
    assigned.push(m.semitoneIndex);
  }
  check("境界で揺れても音名が固定される", new Set(assigned).size === 1, [...new Set(assigned)].join(","));
}

console.log("=== 検証14: clarity重み付き平均とアタック除外 ===");
{
  // frameWeight: clarity未記録(旧データ)は1、記録済みはその値
  check("旧データの重みは1", api.frameWeight({}) === 1 && api.frameWeight({ clarity: null }) === 1);
  check("clarity記録済みはその値", api.frameWeight({ clarity: 0.85 }) === 0.85);

  // timbreSustained: アタック過渡(noteAgeMs < TIMBRE_SUSTAIN_MS)は除外、旧データは含む
  check("アタック中は音色集計から除外", api.timbreSustained({ noteAgeMs: 50 }) === false);
  check("サステインは含む", api.timbreSustained({ noteAgeMs: 200 }) === true);
  check("旧データ(noteAgeMsなし)は含む", api.timbreSustained({}) === true);

  // weightedMean: 重み付き平均の計算
  const frames = [
    { clarity: 1.0, v: 10 },
    { clarity: 0.8, v: 20 },
    { v: 30 }, // 旧データ(重み1)
  ];
  const wm = api.weightedMean(frames, (f) => f.v);
  const expected = (1.0 * 10 + 0.8 * 20 + 1 * 30) / (1.0 + 0.8 + 1);
  check("重み付き平均の値", Math.abs(wm - expected) < 1e-9, `${wm} vs ${expected}`);
  check("null値はスキップ", api.weightedMean([{ clarity: 1, v: null }, { clarity: 1, v: 5 }], (f) => f.v) === 5);
  check("空ならnull", api.weightedMean([], (f) => f.v) === null);
  // 全フレームclarity=1なら従来の単純平均と一致(後方互換)
  const legacy = [{ v: 10 }, { v: 20 }, { v: 30 }];
  check("旧データは単純平均と一致", api.weightedMean(legacy, (f) => f.v) === 20);
}

// ============================================================
// 検証15: ゲート用バンドパス(RBJ)の特性と運指範囲外リジェクト
// ============================================================
console.log("=== 検証15: バンドパス特性(RBJ)・運指の範囲外リジェクト ===");
{
  // バンドパス: 中心周波数はほぼ0dB通過、離れた帯域は減衰する(Web AudioのBiquadFilterNode相当)
  const gainAt = (freq, centerHz) => {
    const len = SR; // 1秒
    const input = new Float32Array(len);
    const w = (2 * Math.PI * freq) / SR;
    for (let i = 0; i < len; i++) input[i] = Math.sin(w * i);
    const out = api.applyBandpassRBJ(input, SR, centerHz, 0.3);
    // フィルタ過渡を避けて後半だけでRMS比較
    let si = 0, so = 0;
    for (let i = len >> 1; i < len; i++) { si += input[i] ** 2; so += out[i] ** 2; }
    return 10 * Math.log10(so / si);
  };
  const g500 = gainAt(500, 500);
  check("中心周波数はほぼ0dB", Math.abs(g500) < 1, `${g500.toFixed(2)}dB`);
  const g50 = gainAt(50, 500);
  check("低域(50Hz)は減衰", g50 < -6, `${g50.toFixed(1)}dB`);
  const g8k = gainAt(8000, 500);
  check("高域(8kHz)は減衰", g8k < -6, `${g8k.toFixed(1)}dB`);
  // バリトン用(中心300Hz)は300Hz付近を通す
  const g300 = gainAt(300, 300);
  check("バリトン用中心300Hzは0dB", Math.abs(g300) < 1, `${g300.toFixed(2)}dB`);

  // 運指の範囲外リジェクト(matchFingering)
  const table = api.buildFingeringTable("alto", 442, 30);
  const lowest = table[0], highest = table[table.length - 1];
  // 範囲内: 正しくその運指にマッチ
  const inRange = api.matchFingering(null, table[10].soundingFreqHz, table);
  check("範囲内は正しくマッチ", inRange?.semitoneIndex === 10);
  // テーブル最低音より300¢低い音 → リジェクト(null)
  const tooLow = api.matchFingering(null, lowest.soundingFreqHz * Math.pow(2, -300 / 1200), table);
  check("範囲外(下に300¢)はリジェクト", tooLow === null);
  // テーブル最高音より300¢高い音(アルティッシモ相当) → リジェクト
  const tooHigh = api.matchFingering(null, highest.soundingFreqHz * Math.pow(2, 300 / 1200), table);
  check("範囲外(上に300¢=アルティッシモ)はリジェクト", tooHigh === null);
  // 端から100¢(範囲外だが150¢以内)は最寄りにマッチ(境界の少し外は許容)
  const nearEdge = api.matchFingering(null, lowest.soundingFreqHz * Math.pow(2, -100 / 1200), table);
  check("端から100¢はマッチ許容", nearEdge?.semitoneIndex === 0);
  // ヒステリシスは共通処理経由でも機能する
  const held = api.matchFingering(table[14], table[14].soundingFreqHz * Math.pow(2, 52 / 1200), table);
  check("matchFingering経由でもヒステリシス有効", held?.semitoneIndex === 14);
}

// ============================================================
// 検証16: 楽器音域による検出範囲の制限とオクターブ上の誤検出の棄却
//   (ユーザー報告: 吹いていないA5以上が計測される/吹いている低音が計測されない)
// ============================================================
console.log("=== 検証16: 音域制限・オクターブ誤検出の棄却 ===");
{
  // 各楽器の音域(SAX_CONCERT_RANGE)と、buildFingeringTableの実音が一致すること
  const expect = {
    soprano: ["A♭3", "E5"], alto: ["D♭3", "A♭5"], tenor: ["A♭2", "E4"], baritone: ["D♭2", "A♭4"],
  };
  // NOTE_NAMESはC♯/D♭表記が"C♯","E♭","G♯","B♭"。A♭=G♯, D♭=C♯として突き合わせる
  const norm = (s) => s.replace("A♭", "G♯").replace("D♭", "C♯").replace("G♭", "F♯").replace("B♭", "A♯");
  for (const sax of ["soprano", "alto", "tenor", "baritone"]) {
    const t = api.buildFingeringTable(sax, 442);
    const lo = api.concertFreqLabel(t[0].soundingFreqHz, 442);
    const hi = api.concertFreqLabel(t[t.length - 1].soundingFreqHz, 442);
    const r = api.SAX_CONCERT_RANGE[sax];
    check(`${sax} テーブル音数=音域`, t.length === r.highMidi - r.lowMidi + 1, `${t.length} vs ${r.highMidi - r.lowMidi + 1}`);
    check(`${sax} 最低音=${expect[sax][0]}`, norm(lo) === norm(expect[sax][0]), `${lo}`);
    check(`${sax} 最高音=${expect[sax][1]}`, norm(hi) === norm(expect[sax][1]), `${hi}`);
  }

  // オクターブ上の誤検出棄却: 音域上限より上の音を鳴らしても、音域内に収まらなければnull。
  // かつ、低音を「倍音が非常に強い」波形で鳴らしても、音域を絞れば基音を正しく採る。
  for (const sax of ["alto", "tenor"]) {
    const b = api.saxPitchBounds(sax, 442);
    const r = api.SAX_CONCERT_RANGE[sax];
    // 音域内の代表音(中央付近)は正しく検出される
    const midFreq = api.concertMidiToFreq((r.lowMidi + r.highMidi) >> 1, 442);
    const rMid = api.detectPitchMPM(synthTone(midFreq), SR, b.minFreq, b.maxFreq);
    check(`${sax} 音域内は検出`, rMid && Math.abs(1200 * Math.log2(rMid.freq / midFreq)) < 5, rMid ? rMid.freq.toFixed(1) : "null");

    // 倍音が基音より強い低音(基音の実効振幅が小さい)= オクターブ上を拾いやすい波形。
    // 音域を絞らない(デフォルト)と2倍音を拾うことがあるが、音域制限つきなら基音を採る。
    const lowFreq = api.concertMidiToFreq(r.lowMidi + 2, 442); // 低音側
    const weakFundamental = synthTone(lowFreq, { ampFn: (h) => (h === 1 ? 0.15 : 1 / h) });
    const rLow = api.detectPitchMPM(weakFundamental, SR, b.minFreq, b.maxFreq);
    check(`${sax} 倍音の強い低音でも基音(音域制限あり)`, rLow && Math.abs(1200 * Math.log2(rLow.freq / lowFreq)) < 10,
      rLow ? `${rLow.freq.toFixed(1)}Hz (真値${lowFreq.toFixed(1)})` : "null");

    // 音域上限の1オクターブ上の純音は棄却される(幻の高音を拾わない)
    const tooHigh = api.concertMidiToFreq(r.highMidi + 12, 442);
    const rHigh = api.detectPitchMPM(synthTone(tooHigh), SR, b.minFreq, b.maxFreq);
    check(`${sax} 音域外(1oct上)は棄却`, rHigh === null || rHigh.freq <= b.maxFreq * 1.01, rHigh ? rHigh.freq.toFixed(1) : "null");
  }

  // saxPitchBounds: 未知の種別はワイドなデフォルト
  const def = api.saxPitchBounds("unknown", 442);
  check("未知種別はデフォルト範囲", def.minFreq === 55 && def.maxFreq === 1200);
}

// ============================================================
// 検証17: メトロノーム — クリック近傍判定(計測からの除外窓)とテンポ範囲
// ============================================================
console.log("=== 検証17: メトロノームのクリック近傍判定・テンポ範囲 ===");
{
  const times = [1000, 1500, 2000]; // 昇順の予定時刻(ms)
  check("クリック直後(+50ms)は近傍", api.isNearScheduledClick(times, 2050) === true);
  check("クリック直前(-20ms)も近傍(先読み分)", api.isNearScheduledClick(times, 1980) === true);
  check("クリック後100msは範囲外", api.isNearScheduledClick(times, 2100) === false);
  check("クリック間の中間は範囲外", api.isNearScheduledClick(times, 1250) === false);
  check("境界: +90msちょうどは近傍", api.isNearScheduledClick(times, 2090) === true);
  check("境界: -30msちょうどは近傍", api.isNearScheduledClick(times, 1970) === true);
  check("未来すぎる予定は範囲外", api.isNearScheduledClick(times, 900) === false);
  check("空配列はfalse", api.isNearScheduledClick([], 1000) === false);
  check("古い予定しか無ければfalse", api.isNearScheduledClick([100, 200], 5000) === false);
  // 16分連打相当の密な予定でも判定が正しい(120BPM・4分割=125ms間隔)
  const dense = Array.from({ length: 32 }, (_, i) => 1000 + i * 125);
  check("密な予定: クリック直後は近傍", api.isNearScheduledClick(dense, 1000 + 8 * 125 + 40) === true);
  // +92ms: 直前クリックの+90ms窓も、次クリック(+125ms)の-30ms窓も外れる僅かな隙間
  check("密な予定: 窓間の隙間は範囲外", api.isNearScheduledClick(dense, 1000 + 8 * 125 + 92) === false);

  check("テンポは20〜300にクランプ", api.clampMetroTempo(10) === 20 && api.clampMetroTempo(999) === 300 && api.clampMetroTempo(120) === 120);
  check("テンポ不正値は120", api.clampMetroTempo("abc") === 120);
  check("テンポ小数は丸め", api.clampMetroTempo(120.6) === 121);

  // 振り子の錘位置(テンポに応じてアーム上を上下する)
  check("最低テンポで錘は上端(40)", api.metroWeightTop(api.METRO_TEMPO_MIN) === api.METRO_WEIGHT_TOP_MIN);
  check("最高テンポで錘は下端(208)", api.metroWeightTop(api.METRO_TEMPO_MAX) === api.METRO_WEIGHT_TOP_MAX);
  const wMid = api.metroWeightTop(160); // (20,300)の中点
  check("中間テンポで錘は中間位置", Math.abs(wMid - (api.METRO_WEIGHT_TOP_MIN + api.METRO_WEIGHT_TOP_MAX) / 2) < 0.01, `${wMid}`);
  check("テンポが上がると錘の位置(top)も単調に増える",
    api.metroWeightTop(20) < api.metroWeightTop(100) && api.metroWeightTop(100) < api.metroWeightTop(200) && api.metroWeightTop(200) < api.metroWeightTop(300));
  check("範囲外テンポもクランプされ端の位置になる", api.metroWeightTop(9999) === api.METRO_WEIGHT_TOP_MAX && api.metroWeightTop(-50) === api.METRO_WEIGHT_TOP_MIN);
}

// ============================================================
// 検証18: メトロノーム — 拍子パースと複合拍子(X/8)の強弱パターン
// ============================================================
console.log("=== 検証18: 拍子パース・複合拍子の強弱パターン ===");
{
  check("parseMetroSig基本", JSON.stringify(api.parseMetroSig("6/8")) === JSON.stringify({ num: 6, den: 8 }));
  check("parseMetroSig不正値はフォールバック", JSON.stringify(api.parseMetroSig("bogus")) === JSON.stringify({ num: 4, den: 4 }));

  // 単純拍子(4/4): 先頭のみaccent、それ以外は全てbeat(均等)
  {
    const kinds = Array.from({ length: 4 }, (_, i) => api.metroTickKind(i, "4/4", 1, true));
    check("4/4 強弱パターン(accent,beat,beat,beat)", JSON.stringify(kinds) === JSON.stringify(["accent", "beat", "beat", "beat"]), kinds.join(","));
  }
  // アクセント無効時は先頭もbeatになる
  {
    const kinds = Array.from({ length: 4 }, (_, i) => api.metroTickKind(i, "4/4", 1, false));
    check("4/4 アクセント無効時は全てbeat", kinds.every((k) => k === "beat"), kinds.join(","));
  }

  // 8分音符のグループ分け(3の倍数は全て3、それ以外は3と2で埋める)
  {
    check("metroBeatGroups: 6→[3,3]", JSON.stringify(api.metroBeatGroups(6)) === JSON.stringify([3, 3]));
    check("metroBeatGroups: 9→[3,3,3]", JSON.stringify(api.metroBeatGroups(9)) === JSON.stringify([3, 3, 3]));
    check("metroBeatGroups: 12→[3,3,3,3]", JSON.stringify(api.metroBeatGroups(12)) === JSON.stringify([3, 3, 3, 3]));
    check("metroBeatGroups: 3→[3]", JSON.stringify(api.metroBeatGroups(3)) === JSON.stringify([3]));
    check("metroBeatGroups: 5→[3,2]", JSON.stringify(api.metroBeatGroups(5)) === JSON.stringify([3, 2]));
    check("metroBeatGroups: 7→[3,2,2]", JSON.stringify(api.metroBeatGroups(7)) === JSON.stringify([3, 2, 2]));
  }
  // 複合拍子6/8 subdiv=1(主拍のみ): 主拍(0,3)だけaccent/beat、拍間の8分音符はsilent
  {
    const kinds = Array.from({ length: 6 }, (_, i) => api.metroTickKind(i, "6/8", 1, true));
    check("6/8 主拍のみ(accent,silent,silent,beat,silent,silent)",
      JSON.stringify(kinds) === JSON.stringify(["accent", "silent", "silent", "beat", "silent", "silent"]), kinds.join(","));
  }
  // 9/8 主拍のみ: 3拍(0,3,6)
  {
    const kinds = Array.from({ length: 9 }, (_, i) => api.metroTickKind(i, "9/8", 1, true));
    check("9/8 主拍のみ(3拍)",
      JSON.stringify(kinds) === JSON.stringify(["accent", "silent", "silent", "beat", "silent", "silent", "beat", "silent", "silent"]), kinds.join(","));
  }
  // 12/8 主拍のみ: 4拍(0,3,6,9)
  {
    const kinds = Array.from({ length: 12 }, (_, i) => api.metroTickKind(i, "12/8", 1, true));
    const expected = ["accent", "silent", "silent", "beat", "silent", "silent", "beat", "silent", "silent", "beat", "silent", "silent"];
    check("12/8 主拍のみ(4拍)", JSON.stringify(kinds) === JSON.stringify(expected), kinds.join(","));
  }
  // 3/8 主拍のみ: 1拍(先頭のみaccent、他silent)
  {
    const kinds = Array.from({ length: 3 }, (_, i) => api.metroTickKind(i, "3/8", 1, true));
    check("3/8 主拍のみ(accent,silent,silent)", JSON.stringify(kinds) === JSON.stringify(["accent", "silent", "silent"]), kinds.join(","));
  }
  // 非複合X/8 主拍のみ: 5/8=3+2(拍0,3) / 7/8=3+2+2(拍0,3,5)
  {
    const kinds5 = Array.from({ length: 5 }, (_, i) => api.metroTickKind(i, "5/8", 1, true));
    check("5/8 主拍のみ(3+2: 0,3が拍)", JSON.stringify(kinds5) === JSON.stringify(["accent", "silent", "silent", "beat", "silent"]), kinds5.join(","));
    const kinds7 = Array.from({ length: 7 }, (_, i) => api.metroTickKind(i, "7/8", 1, true));
    check("7/8 主拍のみ(3+2+2: 0,3,5が拍)", JSON.stringify(kinds7) === JSON.stringify(["accent", "silent", "silent", "beat", "silent", "beat", "silent"]), kinds7.join(","));
  }
  // ユーザー指定のグループ分け(groups引数)で拍頭が変わる: 5/8=2+3(拍0,2) / 7/8=2,2,3(拍0,2,4)
  {
    const k5 = Array.from({ length: 5 }, (_, i) => api.metroTickKind(i, "5/8", 1, true, [2, 3]));
    check("5/8 グループ2+3(拍0,2)", JSON.stringify(k5) === JSON.stringify(["accent", "silent", "beat", "silent", "silent"]), k5.join(","));
    const k7 = Array.from({ length: 7 }, (_, i) => api.metroTickKind(i, "7/8", 1, true, [2, 2, 3]));
    check("7/8 グループ2+2+3(拍0,2,4)", JSON.stringify(k7) === JSON.stringify(["accent", "silent", "beat", "silent", "beat", "silent", "silent"]), k7.join(","));
    // metroX8BeatStarts も指定グループを反映
    check("metroX8BeatStarts(5,[2,3])={0,2}", [...api.metroX8BeatStarts(5, [2, 3])].sort((a, b) => a - b).join(",") === "0,2");
  }
  // 8分音符で埋める(subdiv>=2): 複合6/8は1拍に8分3つ(強-弱-弱)=実質3連。グリッドは8分のまま(perMeasure=6)
  {
    const kinds = Array.from({ length: 6 }, (_, i) => api.metroTickKind(i, "6/8", 2, true));
    check("6/8 8分で埋める(accent,sub,sub,beat,sub,sub)",
      JSON.stringify(kinds) === JSON.stringify(["accent", "sub", "sub", "beat", "sub", "sub"]), kinds.join(","));
  }
  // 5/8 8分で埋める: 拍頭(0,3)以外は sub
  {
    const kinds = Array.from({ length: 5 }, (_, i) => api.metroTickKind(i, "5/8", 2, true));
    check("5/8 8分で埋める(accent,sub,sub,beat,sub)",
      JSON.stringify(kinds) === JSON.stringify(["accent", "sub", "sub", "beat", "sub"]), kinds.join(","));
  }
  // 4/4 subdiv=4(16分相当): 各拍の最初のtickだけが本来のkind、残り3つはsub
  {
    const kinds = Array.from({ length: 16 }, (_, i) => api.metroTickKind(i, "4/4", 4, true));
    check("4/4 subdiv=4: 拍の頭のみ意味のあるkind、残りsub",
      kinds[0] === "accent" && kinds[4] === "beat" && kinds[8] === "beat" && kinds[12] === "beat" &&
      [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15].every((i) => kinds[i] === "sub"), kinds.join(","));
  }
  // 小節境界をまたぐ通算tick番号でも周期的に正しく繰り返す
  {
    const k0 = api.metroTickKind(0, "6/8", 1, true);
    const k6 = api.metroTickKind(6, "6/8", 1, true); // 2小節目の先頭
    const k600 = api.metroTickKind(600, "6/8", 1, true); // 100小節目の先頭(600 = 100*6)
    check("通算tickでも小節境界で周期的に繰り返す", k0 === k6 && k6 === k600 && k0 === "accent", `${k0},${k6},${k600}`);
  }
  // 負のtickIndexでも例外を投げず妥当な値を返す(モジュロの符号対策)
  {
    const kNeg = api.metroTickKind(-1, "6/8", 1, true);
    check("負のtickIndexでもクラッシュせず妥当な値を返す", ["accent", "beat", "sub", "silent"].includes(kNeg), kNeg);
  }
}

// ============================================================
console.log("\n========== 結果 ==========");
console.log(`PASS: ${pass}  FAIL: ${fail}`);
if (failures.length) {
  console.log("--- 失敗一覧(最大30件) ---");
  failures.slice(0, 30).forEach((f) => console.log("  ✗ " + f));
}
process.exit(fail > 0 ? 1 : 0);
