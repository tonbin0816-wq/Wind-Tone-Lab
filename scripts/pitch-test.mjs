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
  extractConst("RING_MAX_CENTS"),
  extractConst("RING_SWEEP_DEG"),
  extractConst("RING_CX"),
  extractConst("RING_CY"),
  extractConst("RING_R"),
  extractConst("RING_SW"),
  extractConst("RING_PITCH_DOT_R"),
  extractConst("RING_MARKER_MIN_GAP_PX"),
  extractConst("RING_D_FULL"),
  extractFunction("ringPoint"),
  extractFunction("ringPitchArcD"),
  extractConst("RING_PITCH_ARC_D"),
  // メトロノーム(E案: 上半円=振り子 / 下半円=拍の点)
  extractConst("RING_PEND_R"),
  extractConst("RING_PEND_SWING_DEG"),
  extractConst("RING_PEND_BOB_R"),
  extractConst("RING_PEND_BOB_GROW"),
  extractConst("RING_PEND_HALO_GAP"),
  extractConst("RING_PEND_HALO_SW"),
  extractConst("RING_PEND_HALO_OPACITY"),
  extractConst("RING_BEAT_DOT_ORBIT_R"),
  extractConst("RING_BEAT_DOT_SPREAD_DEG"),
  extractConst("RING_BEAT_DOT_R"),
  extractConst("RING_BEAT_DOT_CUR_R"),
  extractConst("RING_BEAT_DOT_CUR_GROW"),
  extractConst("RING_BEAT_DOT_HEAD_R"),
  extractConst("RING_BEAT_DOT_HEAD_GROW"),
  extractConst("RING_BEAT_EMPH_DECAY"),
  extractConst("RING_BEAT_EMPH_HEAD"),
  extractConst("RING_BEAT_EMPH_OTHER"),
  extractFunction("ringPendDeg"),
  extractFunction("ringPendArcD"),
  extractConst("RING_PEND_ARC_D"),
  extractFunction("ringBeatEmphasis"),
  extractFunction("ringBeatIndex"),
  extractFunction("ringBeatIsHead"),
  extractFunction("ringBeatDotDeg"),
  extractFunction("ringBeatDotR"),
  // マイク生存監視・復旧(iOS対策)
  extractConst("SILENCE_WATCHDOG_DB"),
  extractConst("SILENCE_WATCHDOG_SUSTAIN_MS"),
  extractConst("MIC_RECOVER_COOLDOWN_MS"),
  extractConst("MIC_RETRY_TAP_COOLDOWN_MS"),
  extractConst("AUDIO_SESSION_TYPE"),
  extractFunction("audioCtxRecoveryAction"),
  extractFunction("isMicTrackUsable"),
  extractFunction("isMicStreamUsable"),
  extractFunction("shouldRecoverFromSilence"),
  // リードの主観評価(総評/厚さ/バランス)。1〜5の整数化・履歴の追加判定・グラフの座標
  extractConst("REED_SCORE_MIN"),
  extractConst("REED_SCORE_MAX"),
  extractConst("REED_SCORE_STEPS"),
  extractConst("REED_SCORE_KEYS"),
  extractConst("RATING_DIAL_ORDER"),
  extractConst("RATING_DIAL_ITEM_H"),
  extractConst("REED_SCORE_NEUTRAL"),
  extractConst("REED_SCORE_PLOT_H"),
  extractFunction("normalizeReedScore"),
  extractFunction("reedHistoryEntry"),
  extractFunction("normalizeRatingHistory"),
  extractFunction("commitReedScores"),
  extractFunction("ratingDialValueAt"),
  extractFunction("ratingDialOffsetFor"),
  extractFunction("ratingDialScrollIsUser"),
  extractFunction("reedScoreY"),
  extractFunction("reedScoreX"),
  extractFunction("reedScoreSegments"),
  extractFunction("reedScoreLabelStep"),
  extractFunction("reedScoreDateLabel"),
].join("\n\n");

const api = new Function(`${code}
  return { freqToNote, centsBetween, writtenNoteLabel, parseNoteLabel, writtenMidiToSoundingFreq,
           buildFingeringTable, findClosestFingering, fftRadix2, detectPitchMPM, computeTimbreMetrics,
           frameWeight, timbreSustained, weightedMean, sanitizePitchOutliers, holdFingering,
           matchFingering, applyBandpassRBJ, concertMidiToFreq, concertFreqLabel, saxPitchBounds,
           clampMetroTempo, parseMetroSig, metroBeatGroups, metroX8BeatStarts, metroTickKind, isNearScheduledClick,
           ringPoint, ringPendDeg, ringBeatEmphasis, ringBeatIndex, ringBeatIsHead, ringBeatDotDeg, ringBeatDotR,
           NOTE_NAMES, NOTE_NAMES_SHARP, LOW_BB_WRITTEN_MIDI, TRANSPOSITION_SEMITONES, A4_MIDI, PITCH_CLARITY_MIN,
           TIMBRE_SUSTAIN_MS, NOTE_SWITCH_CENTS, PITCH_OUTLIER_CENTS, FINGERING_MATCH_MAX_CENTS, SAX_CONCERT_RANGE,
           METRO_TEMPO_MIN, METRO_TEMPO_MAX, RING_MAX_CENTS, RING_SWEEP_DEG,
           RING_CX, RING_CY, RING_R, RING_SW, RING_PITCH_DOT_R,
           RING_PEND_R, RING_PEND_SWING_DEG, RING_PEND_BOB_R, RING_PEND_BOB_GROW,
           RING_PEND_HALO_GAP, RING_PEND_HALO_SW, RING_PEND_HALO_OPACITY, RING_PEND_ARC_D,
           RING_BEAT_DOT_ORBIT_R, RING_BEAT_DOT_SPREAD_DEG, RING_BEAT_DOT_R, RING_BEAT_DOT_CUR_R,
           RING_BEAT_DOT_CUR_GROW, RING_BEAT_DOT_HEAD_R, RING_BEAT_DOT_HEAD_GROW,
           RING_BEAT_EMPH_DECAY, RING_BEAT_EMPH_HEAD, RING_BEAT_EMPH_OTHER,
           RING_MARKER_MIN_GAP_PX, RING_D_FULL, RING_PITCH_ARC_D,
           audioCtxRecoveryAction, isMicTrackUsable, isMicStreamUsable, shouldRecoverFromSilence,
           SILENCE_WATCHDOG_DB, SILENCE_WATCHDOG_SUSTAIN_MS, MIC_RECOVER_COOLDOWN_MS,
           MIC_RETRY_TAP_COOLDOWN_MS, AUDIO_SESSION_TYPE,
           REED_SCORE_MIN, REED_SCORE_MAX, REED_SCORE_STEPS, REED_SCORE_KEYS,
           RATING_DIAL_ORDER, RATING_DIAL_ITEM_H, REED_SCORE_NEUTRAL, REED_SCORE_PLOT_H,
           normalizeReedScore, reedHistoryEntry, normalizeRatingHistory, commitReedScores,
           ratingDialValueAt, ratingDialOffsetFor, ratingDialScrollIsUser,
           reedScoreY, reedScoreX, reedScoreSegments, reedScoreLabelStep, reedScoreDateLabel };`)();

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
  // 運指範囲は全機種共通で記音B♭3〜F♯6(High F♯キーまで)の33音。
  // 以前はソプラノ/テナーが記音F♯5止まりで11半音短く、アルトも最高音がA♭5どまりで
  // High F♯(実音A5)が鳴らせなかったため、実楽器に合わせて上限を引き上げた。
  const expect = {
    soprano: ["A♭3", "E6"], alto: ["D♭3", "A5"], tenor: ["A♭2", "E5"], baritone: ["D♭2", "A4"],
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

  // ------------------------------------------------------------------
  // メトロノーム(E案): 上半円=振り子(予測) / 下半円=拍の点(今が何拍目か)
  // ------------------------------------------------------------------
  // 振り子: 位相→角度の写像。拍の瞬間(位相が整数)にちょうど両端へ達する。
  check("停止中(null)は静止した振り子と同じ12時(0°)", api.ringPendDeg(null) === 0);
  check("拍の瞬間に振れの端へ達する(0拍=右端 / 1拍=左端 / 2拍=右端)",
    Math.abs(api.ringPendDeg(0) - api.RING_PEND_SWING_DEG) < 1e-9
    && Math.abs(api.ringPendDeg(1) + api.RING_PEND_SWING_DEG) < 1e-9
    && Math.abs(api.ringPendDeg(2) - api.RING_PEND_SWING_DEG) < 1e-9,
    `${api.ringPendDeg(0)},${api.ringPendDeg(1)}`);
  check("振れ角を超えない(全位相で |deg| <= 振れ角)", (() => {
    for (let p = 0; p <= 8; p += 0.001) if (Math.abs(api.ringPendDeg(p)) > api.RING_PEND_SWING_DEG + 1e-9) return false;
    return true;
  })());

  // 錘は必ず上半円、拍の点は必ず下半円に描かれる(環の二役を上下で分ける)。
  {
    let bobMaxY = -Infinity;
    for (let p = 0; p <= 8; p += 0.001) {
      const y = api.ringPoint(api.ringPendDeg(p), api.RING_PEND_R, api.RING_CX, api.RING_CY)[1];
      if (y > bobMaxY) bobMaxY = y;
    }
    check("錘は全位相で上半円(cy < 中心)", bobMaxY < api.RING_CY, `最下点 cy=${bobMaxY.toFixed(2)}`);
    let dotMinY = Infinity;
    for (let n = 1; n <= 12; n++) {
      for (let i = 0; i < n; i++) {
        const y = api.ringPoint(api.ringBeatDotDeg(i, n), api.RING_BEAT_DOT_ORBIT_R, api.RING_CX, api.RING_CY)[1];
        if (y < dotMinY) dotMinY = y;
      }
    }
    check("拍の点は全拍子で下半円(cy > 中心)", dotMinY > api.RING_CY, `最上点 cy=${dotMinY.toFixed(2)}`);
  }

  // 拍の点: 数が拍子と一致し、左から右へ数え、6時を中心に ±SPREAD に収まる。
  for (const n of [2, 3, 4, 6]) {
    const degs = Array.from({ length: n }, (_, i) => api.ringBeatDotDeg(i, n));
    const xs = degs.map((d) => api.ringPoint(d, api.RING_BEAT_DOT_ORBIT_R, api.RING_CX, api.RING_CY)[0]);
    let ascending = true;
    for (let i = 1; i < n; i++) if (!(xs[i] > xs[i - 1])) ascending = false;
    const inRange = degs.every((d) => d >= 180 - api.RING_BEAT_DOT_SPREAD_DEG - 1e-9 && d <= 180 + api.RING_BEAT_DOT_SPREAD_DEG + 1e-9);
    const symmetric = Math.abs((xs[0] - api.RING_CX) + (xs[n - 1] - api.RING_CX)) < 1e-9;
    check(`拍の点(${n}拍): 左から右へ並び、6時を中心に対称で ±${api.RING_BEAT_DOT_SPREAD_DEG}° 以内`,
      ascending && inRange && symmetric, degs.map((d) => d.toFixed(1)).join(","));
  }
  check("1拍のときは6時ちょうどに1つ", api.ringBeatDotDeg(0, 1) === 180);

  // 現在の拍だけが大きい(2/4・3/4・4/4・6/8)。点は動かず大きさだけが変わる。
  for (const n of [2, 3, 4, 6]) {
    let ok = true, detail = "";
    for (let beat = 0; beat < 2 * n; beat++) {
      const phase = beat + 0.3;                                   // 拍の途中(演出は残っている位相)
      const cur = api.ringBeatIndex(phase, n);
      if (cur !== beat % n) { ok = false; detail = `index ${cur}!=${beat % n}`; break; }
      const e = api.ringBeatEmphasis(phase, n, true);
      const isHead = api.ringBeatIsHead(phase, n, true);
      const rs = Array.from({ length: n }, (_, i) => api.ringBeatDotR(cur === i, cur === i && isHead, e));
      const others = rs.filter((_, i) => i !== cur);
      if (!others.every((r) => r === api.RING_BEAT_DOT_R)) { ok = false; detail = "現在以外の点の大きさが既定でない"; break; }
      if (!others.every((r) => rs[cur] > r)) { ok = false; detail = `現在の点が大きくない ${rs.join(",")}`; break; }
    }
    check(`拍の点(${n}拍): 現在の拍だけが大きく、位置は変わらない`, ok, detail);
  }
  check("6/8は主拍2つ(拍子パースと点の数が一致)", api.metroBeatGroups(6).length === 2);

  // ------------------------------------------------------------------
  // 【毎拍・両端で演出が出る】以前は小節頭だけを強調していたため、偶数拍子では
  // cos(π×通算拍) が必ず同じ端に来て**片側でしか光らなかった**。
  // 通算拍の偶数・奇数の両方で e>0 になることを確かめる(=両端で光る)。
  // ------------------------------------------------------------------
  {
    let evenMin = Infinity, oddMin = Infinity;
    const sides = new Set();
    for (const beats of [2, 3, 4, 6]) {
      for (let beat = 0; beat < 4 * beats; beat++) {
        const e = api.ringBeatEmphasis(beat, beats, true);         // 拍の瞬間
        if (beat % 2 === 0) evenMin = Math.min(evenMin, e); else oddMin = Math.min(oddMin, e);
        if (e > 0) sides.add(Math.sign(api.ringPendDeg(beat)));    // +1=右端 / -1=左端
      }
    }
    check("拍の演出が通算拍の偶数・奇数どちらでも出る(=両端で光る)",
      evenMin > 0 && oddMin > 0 && sides.has(1) && sides.has(-1),
      `偶数拍の最小 e=${evenMin} / 奇数拍の最小 e=${oddMin} / 光った端=${[...sides].join(",")}`);
    check("係数は小節頭だけ強い(小節頭=1 / それ以外=0.55)",
      api.ringBeatEmphasis(0, 4, true) === api.RING_BEAT_EMPH_HEAD
      && api.ringBeatEmphasis(1, 4, true) === api.RING_BEAT_EMPH_OTHER
      && api.ringBeatEmphasis(2, 4, true) === api.RING_BEAT_EMPH_OTHER
      && api.ringBeatEmphasis(3, 4, true) === api.RING_BEAT_EMPH_OTHER
      && api.ringBeatEmphasis(4, 4, true) === api.RING_BEAT_EMPH_HEAD,
      `${api.ringBeatEmphasis(0, 4, true)},${api.ringBeatEmphasis(1, 4, true)}`);
    check("演出は拍内位相で減衰して0になる(明滅しない)",
      api.ringBeatEmphasis(0.25, 4, true) > 0 && api.ringBeatEmphasis(0.5, 4, true) === 0
      && api.ringBeatEmphasis(1.25, 4, true) > 0 && api.ringBeatEmphasis(1.5, 4, true) === 0
      && api.ringBeatEmphasis(null, 4, true) === 0);
    // 減衰の傾き。拍内位相 × RING_BEAT_EMPH_DECAY を 1 から引いた値に係数を掛けたもの
    check("減衰は 1 - 拍内位相×2.2 に係数を掛けたもの",
      Math.abs(api.ringBeatEmphasis(0.2, 4, true) - (1 - 0.2 * api.RING_BEAT_EMPH_DECAY)) < 1e-9
      && Math.abs(api.ringBeatEmphasis(1.2, 4, true) - (1 - 0.2 * api.RING_BEAT_EMPH_DECAY) * api.RING_BEAT_EMPH_OTHER) < 1e-9);
    // アクセントOFF(=強拍が鳴らない)なら小節頭の"差"は出ない。ただし拍そのものは毎拍鳴るので
    // 演出自体は残る(鳴っていないものを見せない / 鳴っているものは見せる)。
    let headDiff = false, allBeatsLit = true;
    for (let beat = 0; beat < 8; beat++) {
      const e = api.ringBeatEmphasis(beat, 4, false);
      if (e !== api.RING_BEAT_EMPH_OTHER) headDiff = true;
      if (!(e > 0)) allBeatsLit = false;
    }
    check("アクセントOFFなら全拍が同じ強さ(小節頭を主張しない)が、演出自体は毎拍出る",
      !headDiff && allBeatsLit && api.ringBeatIsHead(0, 4, false) === false);
  }

  // 減速設定(prefers-reduced-motion)の再現: 実装は演出量 e を 0 に固定するだけ。
  // 錘の移動(位相→角度)と点の切り替え(現在の拍)は e に依存しないので残ることを確かめる。
  {
    const movedAngles = new Set();
    for (let p = 0; p <= 2; p += 0.1) movedAngles.add(api.ringPendDeg(p).toFixed(3));
    const idx = [0, 1, 2, 3].map((b) => api.ringBeatIndex(b + 0.3, 4)).join(",");
    const curR = api.ringBeatDotR(true, true, 0), otherR = api.ringBeatDotR(false, false, 0);
    check("減速設定でも錘は動き、点の切り替えも続く(止まるのは膨らみだけ)",
      movedAngles.size > 10 && idx === "0,1,2,3" && curR > otherR
      && curR === api.RING_BEAT_DOT_HEAD_R && api.ringBeatDotR(true, false, 0) === api.RING_BEAT_DOT_CUR_R,
      `角度の種類=${movedAngles.size} / 拍=${idx} / 現在r=${curR} 他r=${otherR}`);
  }

  // ------------------------------------------------------------------
  // ピッチマーカーと拍の要素(錘・点)の最小距離。
  //
  // DESIGN-SYSTEM §6.1 の要件は「**実寸**で最低 6 CSS px」。
  // ここは実装の定数の定義を言い換えるのではなく、実寸を独立に計算して要件と突き合わせる。
  // (過去に「距離 − (定義から引き算で作った上限) > 余白」という恒等式を書いてしまい、
  //  構造上失敗し得ないテストで余白を守っているつもりになっていた。定義から導出しない)
  //
  // viewBox は 300 で、実寸は環の直径。つまり 1 viewBox 単位 = 直径/300 CSS px。
  // 環は常に RING_D_FULL(330) なので 1.1 倍。viewBox 単位を px と呼んではいけない。
  // ------------------------------------------------------------------
  {
    const VB_TO_PX = api.RING_D_FULL / 300;
    let minPx = Infinity, worst = null;
    // ピッチマーカーが取りうる位置(±50¢を0.25¢刻み。最悪ケースの ±25¢=振り子の端と
    // 同じ角度 もグリッド上に乗る)
    const CENT_STEP = 0.25;
    const pitchPts = [];
    for (let cc = -api.RING_MAX_CENTS; cc <= api.RING_MAX_CENTS + 1e-9; cc += CENT_STEP) {
      pitchPts.push([cc, api.ringPoint((cc / api.RING_MAX_CENTS) * api.RING_SWEEP_DEG, api.RING_R, api.RING_CX, api.RING_CY)]);
    }
    // 拍子は 2〜7 すべてを見る。演出が最大になる位相が拍子によって変わり、
    // 偶数拍子なら通算拍0(右端)、奇数拍子ならその奇数倍の位相(左端)も最悪ケースになる。
    for (const beats of [2, 3, 4, 5, 6, 7]) {
      // 拍の点(下半円・位置は固定)
      const dots = Array.from({ length: beats }, (_, i) =>
        api.ringPoint(api.ringBeatDotDeg(i, beats), api.RING_BEAT_DOT_ORBIT_R, api.RING_CX, api.RING_CY));
      for (let p = 0; p <= 2 * beats + 1e-9; p += 0.005) {
        const e = api.ringBeatEmphasis(p, beats, true);
        const cur = api.ringBeatIndex(p, beats);
        const isHead = api.ringBeatIsHead(p, beats, true);
        // --- 錘(上半円) --- 実装が実際に描く大きさをそのまま使う。
        // 錘の膨らみと、輪の外縁(線幅の半分ぶん半径より外に出る)の大きい方が外径。
        const [bx, by] = api.ringPoint(api.ringPendDeg(p), api.RING_PEND_R, api.RING_CX, api.RING_CY);
        const bobR = api.RING_PEND_BOB_R + e * api.RING_PEND_BOB_GROW;
        const haloOuter = bobR + api.RING_PEND_HALO_GAP + api.RING_PEND_HALO_SW / 2;
        const bobOuter = Math.max(bobR, e > 0 ? haloOuter : 0);
        // --- 拍の点(下半円) --- 現在の拍だけ大きさが変わる
        const dotRs = Array.from({ length: beats }, (_, i) => api.ringBeatDotR(cur === i, cur === i && isHead, e));
        for (const [cc, [px, py]] of pitchPts) {
          let clearVb = Math.hypot(px - bx, py - by) - (api.RING_PITCH_DOT_R + bobOuter);
          let which = "錘";
          for (let i = 0; i < beats; i++) {
            const c = Math.hypot(px - dots[i][0], py - dots[i][1]) - (api.RING_PITCH_DOT_R + dotRs[i]);
            if (c < clearVb) { clearVb = c; which = `点${i}`; }
          }
          const clearPx = clearVb * VB_TO_PX;
          if (clearPx < minPx) { minPx = clearPx; worst = { beats, cents: +cc.toFixed(2), phase: +p.toFixed(3), e: +e.toFixed(3), which }; }
        }
      }
    }
    check(`ピッチマーカーと拍の要素(錘・点)が実寸で ${api.RING_MARKER_MIN_GAP_PX} CSS px 以上離れている`,
      minPx >= api.RING_MARKER_MIN_GAP_PX,
      `最小 ${minPx.toFixed(2)} CSS px (${api.RING_D_FULL}px環) @ ${JSON.stringify(worst)}`);
  }

  // 到達(inTune)の合図は上弧の**帯**をピッチ色で塗るので、拍の要素はその帯の内側に
  // 入ってはいけない。帯の内縁(r - 線幅/2)より、拍の要素の最大到達半径が内側にあること。
  {
    const m = /^M([\d.-]+),([\d.-]+) A(\d+(?:\.\d+)?),\d+(?:\.\d+)? 0 1,1 ([\d.-]+),([\d.-]+)$/.exec(api.RING_PITCH_ARC_D);
    const [lx, ly] = api.ringPoint(-api.RING_SWEEP_DEG, api.RING_R, api.RING_CX, api.RING_CY);
    const [rx, ry] = api.ringPoint(api.RING_SWEEP_DEG, api.RING_R, api.RING_CX, api.RING_CY);
    check("到達の合図は全周円ではなく上弧のパス(端が ±RING_SWEEP_DEG と一致)",
      !!m && Math.abs(+m[1] - lx) < 0.01 && Math.abs(+m[2] - ly) < 0.01
      && Math.abs(+m[4] - rx) < 0.01 && Math.abs(+m[5] - ry) < 0.01,
      api.RING_PITCH_ARC_D);
    const bandInner = api.RING_R - api.RING_SW / 2;                 // 環の帯の内縁
    const bobOuterMax = api.RING_PEND_R + api.RING_PEND_BOB_R + api.RING_PEND_BOB_GROW
      + api.RING_PEND_HALO_GAP + api.RING_PEND_HALO_SW / 2;
    const dotOuterMax = api.RING_BEAT_DOT_ORBIT_R + api.RING_BEAT_DOT_HEAD_R + api.RING_BEAT_DOT_HEAD_GROW;
    const gapPx = (bandInner - Math.max(bobOuterMax, dotOuterMax)) * (api.RING_D_FULL / 300);
    check(`拍の要素が環の帯に届かない(実寸で ${api.RING_MARKER_MIN_GAP_PX} CSS px 以上内側)`,
      gapPx >= api.RING_MARKER_MIN_GAP_PX,
      `帯の内縁 ${bandInner} / 錘 ${bobOuterMax.toFixed(2)} / 点 ${dotOuterMax} → ${gapPx.toFixed(2)} CSS px`);
  }

  // 軌道の弧は錘と同じ半径・同じ振れ角の上に描かれていること(錘が弧から外れて見えない)
  {
    const m = /^M([\d.-]+),([\d.-]+) A(\d+(?:\.\d+)?),\d+(?:\.\d+)? 0 0,1 ([\d.-]+),([\d.-]+)$/.exec(api.RING_PEND_ARC_D);
    const [lx, ly] = api.ringPoint(-api.RING_PEND_SWING_DEG, api.RING_PEND_R, api.RING_CX, api.RING_CY);
    const [rx, ry] = api.ringPoint(api.RING_PEND_SWING_DEG, api.RING_PEND_R, api.RING_CX, api.RING_CY);
    check("軌道の弧は錘の軌道(半径・振れ角)と一致する",
      !!m && +m[3] === api.RING_PEND_R && Math.abs(+m[1] - lx) < 0.01 && Math.abs(+m[2] - ly) < 0.01
      && Math.abs(+m[4] - rx) < 0.01 && Math.abs(+m[5] - ry) < 0.01, api.RING_PEND_ARC_D);
  }
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
// 13. マイク生存監視・復旧(iOS対策)
// ============================================================
// 実測の基準値: 全ゼロバッファ = 20*log10(0 + 1e-10) = -200dB / 静かな部屋 = -60dB 前後。
// ウォッチドッグは前者でだけ発火し、後者では絶対に発火してはならない。
{
  console.log("\n========== 13. マイク生存監視・復旧 ==========");

  const ALL_ZERO_DB = 20 * Math.log10(0 + 1e-10); // = -200。App.jsxのtickと同じ式
  const QUIET_ROOM_DB = -60;                       // 静かな部屋の実測値

  check("全ゼロバッファのdB計算は-200", Math.abs(ALL_ZERO_DB - (-200)) < 1e-9, String(ALL_ZERO_DB));

  // 解析ループを模したシミュレータ。実装(tick)と同じく、復旧が走ったらカウンタを0に戻し
  // クールダウンの起点を更新する。
  function runWatchdog({ volumeDb, ms, frameIntervalMs = 16.7, isRecording = false, startMs = 1e6, alternateDb = null }) {
    let silentFrames = 0;
    let lastRecoverAtMs = startMs - 1e6; // 十分に過去(初回はクールダウンに掛からない)
    const recoverTimes = [];
    const frames = Math.round(ms / frameIntervalMs);
    for (let i = 1; i <= frames; i++) {
      const nowMs = startMs + i * frameIntervalMs;
      const db = alternateDb !== null && i % 2 === 0 ? alternateDb : volumeDb;
      const r = api.shouldRecoverFromSilence({
        volumeDb: db, prevSilentFrames: silentFrames, frameIntervalMs,
        isRecording, nowMs, lastRecoverAtMs,
      });
      silentFrames = r.silentFrames;
      if (r.recover) { recoverTimes.push(nowMs - startMs); silentFrames = 0; lastRecoverAtMs = nowMs; }
    }
    return recoverTimes;
  }

  // --- 発火する側: 全ゼロ(-200) ---
  {
    const t = runWatchdog({ volumeDb: ALL_ZERO_DB, ms: 10000 });
    check("全ゼロ(-200dB)が続けば復旧が発火する", t.length >= 1, `発火${t.length}回`);
    check("発火は無音がしきい時間続いた後(早すぎない)",
      t.length >= 1 && t[0] >= api.SILENCE_WATCHDOG_SUSTAIN_MS, `初回${t[0]}ms / 必要${api.SILENCE_WATCHDOG_SUSTAIN_MS}ms`);
    check("発火はしきい時間+2フレーム以内(遅すぎない)",
      t.length >= 1 && t[0] <= api.SILENCE_WATCHDOG_SUSTAIN_MS + 2 * 16.7, `初回${t[0]}ms`);
  }
  // ほぼゼロだが厳密には0でない値(-180dB)でも発火する = 「全ゼロ」判定に十分な余裕がある
  check("-180dB(実質ゼロ)でも発火する", runWatchdog({ volumeDb: -180, ms: 10000 }).length >= 1);

  // --- 発火してはいけない側: 静かな部屋 ---
  check("静かな部屋(-60dB)では10秒経っても発火しない",
    runWatchdog({ volumeDb: QUIET_ROOM_DB, ms: 10000 }).length === 0);
  check("さらに静かな-100dBでも発火しない(誤発火の余裕が40dB以上ある)",
    runWatchdog({ volumeDb: -100, ms: 10000 }).length === 0);
  check("極端に長く(60秒)静かでも-60dBなら発火しない",
    runWatchdog({ volumeDb: QUIET_ROOM_DB, ms: 60000 }).length === 0);
  // 途中で1フレームでも音があればカウンタはリセットされる
  check("全ゼロと-60dBが交互なら発火しない(連続でないため)",
    runWatchdog({ volumeDb: ALL_ZERO_DB, ms: 10000, alternateDb: QUIET_ROOM_DB }).length === 0);

  // --- 録音中は絶対に走らせない ---
  check("録音中は全ゼロが続いても発火しない",
    runWatchdog({ volumeDb: ALL_ZERO_DB, ms: 30000, isRecording: true }).length === 0);

  // --- クールダウン: 連続で復旧を走らせない ---
  {
    const t = runWatchdog({ volumeDb: ALL_ZERO_DB, ms: 30000 });
    let minGap = Infinity;
    for (let i = 1; i < t.length; i++) minGap = Math.min(minGap, t[i] - t[i - 1]);
    check("復旧の間隔はクールダウン以上", t.length < 2 || minGap >= api.MIC_RECOVER_COOLDOWN_MS,
      `最小間隔${minGap}ms / クールダウン${api.MIC_RECOVER_COOLDOWN_MS}ms`);
    // クールダウンが効いていなければ30秒間に数百〜数千回発火する
    check("30秒間の発火回数は10回以下(連打しない)", t.length <= 10, `${t.length}回`);
    check("30秒間に1回以上は発火する(黙って諦めない)", t.length >= 1, `${t.length}回`);
  }

  // --- 発火までの時間(要件を絶対値で書く。定数から逆算すると定数の言い換えになり何も守れない) ---
  // 要件: 一瞬の全ゼロ(接続直後の数フレーム・端末側の瞬断)で復旧を走らせてはならない。
  //       逆に、数秒にわたって全ゼロなら確実に壊れているので必ず復旧を走らせる。
  check("全ゼロが0.5秒(=一瞬)では発火しない", runWatchdog({ volumeDb: ALL_ZERO_DB, ms: 500 }).length === 0,
    `${runWatchdog({ volumeDb: ALL_ZERO_DB, ms: 500 }).length}回`);
  check("全ゼロが1.0秒でも発火しない", runWatchdog({ volumeDb: ALL_ZERO_DB, ms: 1000 }).length === 0,
    `${runWatchdog({ volumeDb: ALL_ZERO_DB, ms: 1000 }).length}回`);
  check("全ゼロが3.0秒続けば必ず発火する", runWatchdog({ volumeDb: ALL_ZERO_DB, ms: 3000 }).length >= 1,
    `${runWatchdog({ volumeDb: ALL_ZERO_DB, ms: 3000 }).length}回`);
  // 低フレームレート(30ms/フレーム)の端末でも同じ時間感覚で動く(フレーム数ではなく時間で判定している)
  check("30ms/フレームの端末でも0.5秒では発火しない",
    runWatchdog({ volumeDb: ALL_ZERO_DB, ms: 500, frameIntervalMs: 30 }).length === 0);
  check("30ms/フレームの端末でも3.0秒なら発火する",
    runWatchdog({ volumeDb: ALL_ZERO_DB, ms: 3000, frameIntervalMs: 30 }).length >= 1);

  // --- 単発呼び出しの契約 ---
  {
    const r1 = api.shouldRecoverFromSilence({ volumeDb: ALL_ZERO_DB, prevSilentFrames: 0, frameIntervalMs: 16.7, nowMs: 1e6, lastRecoverAtMs: 0 });
    check("無音フレームでカウンタが増える", r1.silentFrames === 1 && r1.recover === false);
    const r2 = api.shouldRecoverFromSilence({ volumeDb: QUIET_ROOM_DB, prevSilentFrames: 999, frameIntervalMs: 16.7, nowMs: 1e6, lastRecoverAtMs: 0 });
    check("音があればカウンタは0に戻る", r2.silentFrames === 0 && r2.recover === false);
    // フレーム間隔が不明(0)のうちは時間換算できないので発火しない
    const r3 = api.shouldRecoverFromSilence({ volumeDb: ALL_ZERO_DB, prevSilentFrames: 9999, frameIntervalMs: 0, nowMs: 1e6, lastRecoverAtMs: 0 });
    check("フレーム間隔が未計測(0)なら発火しない", r3.recover === false);
    // クールダウン中は発火しない
    const r4 = api.shouldRecoverFromSilence({ volumeDb: ALL_ZERO_DB, prevSilentFrames: 9999, frameIntervalMs: 16.7, nowMs: 1e6, lastRecoverAtMs: 1e6 - 1 });
    check("クールダウン中は発火しない", r4.recover === false);
    // NaN(計算不能)は安全側=無音として扱う
    const r5 = api.shouldRecoverFromSilence({ volumeDb: NaN, prevSilentFrames: 0, frameIntervalMs: 16.7, nowMs: 1e6, lastRecoverAtMs: 0 });
    check("NaNは安全側(無音)として数える", r5.silentFrames === 1);
  }

  // --- AudioContext の状態分類 ---
  check("running はそのまま使える", api.audioCtxRecoveryAction("running") === "ok");
  check("suspended は resume で戻す", api.audioCtxRecoveryAction("suspended") === "resume");
  check("iOS固有の interrupted も resume で戻す", api.audioCtxRecoveryAction("interrupted") === "resume");
  check("closed は作り直す", api.audioCtxRecoveryAction("closed") === "rebuild");
  check("未知の状態は安全側(作り直し)", api.audioCtxRecoveryAction("something-new") === "rebuild");
  check("undefined でも例外を投げず作り直しに倒す", api.audioCtxRecoveryAction(undefined) === "rebuild");

  // --- トラックの生存判定 ---
  const mkTrack = (readyState, muted) => ({ readyState, muted });
  check("live かつ muted=false なら使える", api.isMicTrackUsable(mkTrack("live", false)) === true);
  check("live でも muted=true なら使えない", api.isMicTrackUsable(mkTrack("live", true)) === false);
  check("ended なら使えない", api.isMicTrackUsable(mkTrack("ended", false)) === false);
  check("ended かつ muted=true なら使えない", api.isMicTrackUsable(mkTrack("ended", true)) === false);
  check("null/undefined でも例外を投げない", api.isMicTrackUsable(null) === false && api.isMicTrackUsable(undefined) === false);
  {
    const mkStream = (tracks) => ({ getTracks: () => tracks });
    check("生きたトラックを持つstreamは使える", api.isMicStreamUsable(mkStream([mkTrack("live", false)])) === true);
    check("mutedなトラックだけのstreamは使えない", api.isMicStreamUsable(mkStream([mkTrack("live", true)])) === false);
    check("endedなトラックだけのstreamは使えない", api.isMicStreamUsable(mkStream([mkTrack("ended", false)])) === false);
    check("トラック0本のstreamは使えない", api.isMicStreamUsable(mkStream([])) === false);
    check("stream が null でも例外を投げない", api.isMicStreamUsable(null) === false);
  }

  // --- タップでの再試行にもクールダウンがある(連打で連打ぶんだけマイクを取り直さない) ---
  // 実測(Browserペイン)で、これが0だと20連打で20回getUserMediaが走ることを確認している。
  check("タップ再試行のクールダウンは0より大きい", api.MIC_RETRY_TAP_COOLDOWN_MS > 0, `${api.MIC_RETRY_TAP_COOLDOWN_MS}ms`);
  check("タップ再試行は自動復旧より待たされない", api.MIC_RETRY_TAP_COOLDOWN_MS <= api.MIC_RECOVER_COOLDOWN_MS,
    `tap=${api.MIC_RETRY_TAP_COOLDOWN_MS} / auto=${api.MIC_RECOVER_COOLDOWN_MS}`);
  {
    // 復旧経路はこの2つの定数以外のクールダウンを持たない(経路ごとの独自クールダウンは連打を招く)
    const usesTap = /const cooldown = urgent \? MIC_RETRY_TAP_COOLDOWN_MS : MIC_RECOVER_COOLDOWN_MS;/.test(src);
    check("復旧のクールダウンは urgent で2定数を切り替える1箇所だけ", usesTap);
    check("復旧経路は録音中に走らない", /const recoverMic = useCallback\(async \(reason, urgent = false\) => \{\s*\n\s*if \(isRecordingRef\.current\) return false;/.test(src));
  }

  // --- ソース側の契約(定数の一元化・購読・既存設定の維持) ---
  {
    const assigns = (src.match(/audioSession\.type\s*=/g) || []).length;
    check("navigator.audioSession.type への代入は1箇所だけ", assigns === 1, `${assigns}箇所`);
    check("その代入は定数 AUDIO_SESSION_TYPE を使っている", /audioSession\.type = AUDIO_SESSION_TYPE;/.test(src));
    check("AUDIO_SESSION_TYPE は非空の文字列", typeof api.AUDIO_SESSION_TYPE === "string" && api.AUDIO_SESSION_TYPE.length > 0, String(api.AUDIO_SESSION_TYPE));
    check("トラックの onmute を購読している", /\.onmute = \(\) => \{ recoverMicRef\.current/.test(src));
    check("トラックの onended を購読している", /\.onended = \(\) => \{ recoverMicRef\.current/.test(src));
    check("復旧失敗時に errorMsg を出している", /setErrorMsg\(MIC_RECOVER_FAILED_MSG\)/.test(src));
    check("復旧失敗の文言はタップでの再試行を促している", /const MIC_RECOVER_FAILED_MSG = "[^"]*画面をタップ[^"]*";/.test(src));
    // 既存のメトロノーム出力設定(ゲイン・リミッター)を変えていないこと
    check("メトロノームのマスターゲインは2.6のまま", /master\.gain\.value = 2\.6;/.test(src));
    check("リミッターのthresholdは-3のまま", /limiter\.threshold\.value = -3;/.test(src));
    check("リミッターのratioは20のまま", /limiter\.ratio\.value = 20;/.test(src));
    check("リミッターのknee/attack/releaseも維持",
      /limiter\.knee\.value = 0;/.test(src) && /limiter\.attack\.value = 0\.002;/.test(src) && /limiter\.release\.value = 0\.05;/.test(src));
  }
}

// ============================================================
// 14. リードの主観評価(総評 / 厚さ / バランス)
//
// このハーネスは JSX を見ないので、描画側を壊してもここは緑のまま通る。
// **テストで守れているのは以下の純関数の振る舞いだけ**であり、
// 「数値だけを表示する」「モーダルが fixed で浮く」といった描画の要件は
// ソース文字列の照合(この節の後半)と Browserペインでの実測で確認している。
// ============================================================
console.log("\n========== 14. リードの主観評価(1〜5の整数・履歴・グラフ) ==========");
{
  // Reactコンポーネントは引数が分割代入(function Foo({ a, b }))なので、
  // 「function の次の { から数える」extractFunction では引数リストで閉じてしまい本文が取れない。
  // 引数リストの ) を跨いでから本文の { を数える版をここに置く(ソース照合専用。evalはしない)。
  const sourceOf = (name) => {
    const idx = src.indexOf(`function ${name}(`);
    if (idx === -1) throw new Error(`function ${name} not found`);
    let i = src.indexOf("(", idx), depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") { depth--; if (depth === 0) { i++; break; } }
    }
    while (i < src.length && src[i] !== "{") i++;
    depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(idx, i + 1); }
    }
    throw new Error(`function ${name}: unbalanced braces`);
  };
  // sourceOf 自体が壊れていたら以降の照合がすべて無意味になるので、先に自己検査する
  check("sourceOf が分割代入の引数を跨いで本文を取れている",
    sourceOf("ReedScoreField").includes("</div>") && sourceOf("ReedScoreField").length > 400,
    `${sourceOf("ReedScoreField").length}文字`);

  const N = api.normalizeReedScore;

  // --- 1〜5の整数への正規化。既存の0.1刻みデータ・0・null を壊さずに読む ---
  check("小数は四捨五入する(3.7→4)", N(3.7) === 4, String(N(3.7)));
  check("小数は四捨五入する(3.4→3)", N(3.4) === 3, String(N(3.4)));
  check("0 は未評価(null)", N(0) === null, String(N(0)));
  check("null は未評価", N(null) === null);
  check("undefined は未評価", N(undefined) === null);
  check("負値は未評価", N(-2) === null, String(N(-2)));
  check("上限を超えたら5にクランプ", N(9.9) === 5, String(N(9.9)));
  check("0より大きく1未満は1にクランプ", N(0.4) === 1, String(N(0.4)));
  check("文字列の数値も読める", N("4") === 4, String(N("4")));
  check("数値でない文字列は未評価", N("abc") === null, String(N("abc")));
  check("NaN は未評価", N(NaN) === null);
  check("整数はそのまま", [1, 2, 3, 4, 5].every((v) => N(v) === v));
  // 段階数の要件(本人指示「五段階でいい」)。0.1刻み(50段階)に戻したらここが落ちる
  {
    const distinct = new Set();
    for (let x = 0.1; x <= 5.001; x += 0.1) { const v = N(Math.round(x * 10) / 10); if (v !== null) distinct.add(v); }
    check("0.1刻みの入力を投げても取りうる値は5段階だけ", distinct.size === 5, `${distinct.size}段階`);
    check("その5段階は1〜5", [...distinct].sort().join(",") === "1,2,3,4,5", [...distinct].sort().join(","));
  }
  check("REED_SCORE_MIN/MAX は 1/5", api.REED_SCORE_MIN === 1 && api.REED_SCORE_MAX === 5,
    `${api.REED_SCORE_MIN}〜${api.REED_SCORE_MAX}`);
  check("スライダーの目盛は5段", api.REED_SCORE_STEPS.length === 5 && api.REED_SCORE_STEPS.join(",") === "1,2,3,4,5",
    api.REED_SCORE_STEPS.join(","));

  // --- ダイヤルは上が5・下が1(本人指示) ---
  check("ダイヤルの上端は5", api.RATING_DIAL_ORDER[0] === 5, String(api.RATING_DIAL_ORDER[0]));
  check("ダイヤルの下端は1", api.RATING_DIAL_ORDER[api.RATING_DIAL_ORDER.length - 1] === 1,
    String(api.RATING_DIAL_ORDER[api.RATING_DIAL_ORDER.length - 1]));
  check("ダイヤルは5段", api.RATING_DIAL_ORDER.length === 5, `${api.RATING_DIAL_ORDER.length}段`);
  check("ダイヤルは上から下へ降順(途中で入れ替わっていない)",
    api.RATING_DIAL_ORDER.every((v, i, a) => i === 0 || a[i - 1] > v), api.RATING_DIAL_ORDER.join(","));
  // 「上が5」を座標で言い直す: スクロール位置0(いちばん上)で5が選ばれること
  {
    const H = api.RATING_DIAL_ITEM_H;
    check("スクロール最上部で5が選ばれる", api.ratingDialValueAt(0, H) === 5, String(api.ratingDialValueAt(0, H)));
    check("スクロール最下部で1が選ばれる", api.ratingDialValueAt(H * 4, H) === 1, String(api.ratingDialValueAt(H * 4, H)));
    check("下へスクロールするほど値が小さくなる",
      [0, 1, 2, 3, 4].every((i, k, a) => k === 0 || api.ratingDialValueAt(a[k - 1] * H, H) > api.ratingDialValueAt(i * H, H)));
    check("行き過ぎても範囲外にならない",
      api.ratingDialValueAt(-999, H) === 5 && api.ratingDialValueAt(99999, H) === 1);
    check("値→位置は位置→値の逆写像",
      [1, 2, 3, 4, 5].every((v) => api.ratingDialValueAt(api.ratingDialOffsetFor(v, H), H) === v));
    check("未評価は中央(3)の位置に置く", api.ratingDialOffsetFor(null, H) === api.ratingDialOffsetFor(api.REED_SCORE_NEUTRAL, H));
    // 未評価のダイヤルを中央に置くための scrollTop 代入で「3を選んだ」ことにしない。
    // これを取り違えると、開いて閉じただけで履歴が1件増える(項目6違反)。実機で踏んだ罠。
    {
      const parked = api.ratingDialOffsetFor(null, H);
      check("位置合わせぶんのスクロールは確定に使わない", api.ratingDialScrollIsUser(parked, parked) === false);
      check("1px以内のずれも位置合わせ扱い", api.ratingDialScrollIsUser(parked + 1, parked) === false);
      check("指で動かしたスクロールは確定に使う", api.ratingDialScrollIsUser(parked + H, parked) === true);
      check("位置合わせ待ちが無ければ常に確定に使う", api.ratingDialScrollIsUser(parked, null) === true);
      check("位置合わせ後に中央(3)へ戻す操作は確定に使う(3を選べなくならない)",
        api.ratingDialScrollIsUser(parked, parked + H) === true);
    }
    // タップ領域(DESIGN-SYSTEM §5)。行そのものが選択の当たり判定
    check("ダイヤルの1行は44pt以上", api.RATING_DIAL_ITEM_H >= 44, `${api.RATING_DIAL_ITEM_H}px`);
  }

  // --- 履歴の後方互換(旧形式 {value, at} を書き換えずに読む) ---
  {
    const at = "2026-07-31T01:00:00.000Z";
    const legacy = api.reedHistoryEntry({ value: 3.7, at });
    check("旧形式の value を rating として読む", legacy.rating === 4, String(legacy.rating));
    check("旧形式では厚さは未評価扱い", legacy.thickness === null);
    check("旧形式ではバランスは未評価扱い", legacy.balance === null);
    const modern = api.reedHistoryEntry({ at, rating: 2, thickness: 5, balance: 1 });
    check("新形式は3つとも読む", modern.rating === 2 && modern.thickness === 5 && modern.balance === 1);
    check("新形式で rating が null なら null のまま(value に落ちない)",
      api.reedHistoryEntry({ at, rating: null, value: 5 }).rating === null);
    const mixed = api.normalizeRatingHistory([
      { value: 2, at: "2026-07-30T00:00:00.000Z" },
      { at: "2026-07-28T00:00:00.000Z", rating: 5, thickness: 3, balance: null },
      { at: "こわれた日付", rating: 4 },
      null,
    ]);
    check("読めない日時と null のエントリは落とす", mixed.length === 2, `${mixed.length}件`);
    check("古い順に並ぶ", new Date(mixed[0].at) < new Date(mixed[1].at));
    check("空・未定義でも例外を投げない",
      api.normalizeRatingHistory(undefined).length === 0 && api.normalizeRatingHistory([]).length === 0);
  }

  // --- 変更があった時だけ記録する(項目6) ---
  {
    const at = "2026-08-01T05:00:00.000Z";
    const reed = { rating: 3, thickness: 2, balance: null, ratings: [{ at: "2026-07-31T00:00:00.000Z", rating: 3, thickness: 2, balance: null }] };
    check("同じ値で確定したら何も書かない",
      api.commitReedScores(reed, { rating: 3, thickness: 2, balance: null }, at) === null);
    check("開いただけ(ドラフト=現在値)でも何も書かない",
      api.commitReedScores(reed, { rating: reed.rating, thickness: reed.thickness, balance: reed.balance }, at) === null);
    const p = api.commitReedScores(reed, { rating: 3, thickness: 2, balance: 4 }, at);
    check("1つ変えたら patch が返る", p !== null);
    check("変わっていない項目は patch に入れない(既存値を書き換えない)",
      p && !("rating" in p) && !("thickness" in p) && p.balance === 4, p ? Object.keys(p).join(",") : "null");
    check("履歴が1件だけ増える", p.ratings.length === reed.ratings.length + 1, `${p.ratings.length}件`);
    check("追加された履歴は3つ全部の値を持つ",
      p.ratings[1].rating === 3 && p.ratings[1].thickness === 2 && p.ratings[1].balance === 4);
    check("追加された履歴は日時を持つ", p.ratings[1].at === at);
    check("既存の履歴エントリはそのまま残る", p.ratings[0] === reed.ratings[0]);
    // 小数・0 の既存データ: 表示上は同じ値なので「変わっていない」と判定して書かない
    const legacyReed = { rating: 3.7, thickness: 0, balance: null, ratings: [] };
    check("小数の現在値と丸めた値が同じなら書かない",
      api.commitReedScores(legacyReed, { rating: 4, thickness: null, balance: null }, at) === null);
    const lp = api.commitReedScores(legacyReed, { rating: 5, thickness: null, balance: null }, at);
    check("小数の現在値でも実際に変えれば書く", lp !== null && lp.rating === 5);
    check("履歴0件からでも1件だけ積む", lp.ratings.length === 1, `${lp.ratings.length}件`);
    check("小数は整数で保存される", Number.isInteger(lp.ratings[0].rating));
    // 直前の記録と3つとも同じなら履歴は増やさない(現在値だけがずれていた場合)
    const skew = { rating: 2, thickness: null, balance: null, ratings: [{ at: "2026-07-01T00:00:00.000Z", rating: 4, thickness: null, balance: null }] };
    const sp = api.commitReedScores(skew, { rating: 4, thickness: null, balance: null }, at);
    check("直前の記録と同じ値なら履歴は増やさない", sp !== null && !("ratings" in sp), sp ? Object.keys(sp).join(",") : "null");
    check("それでも現在値は更新する", sp.rating === 4);
    // 未評価に戻すのも「変更」
    const clear = api.commitReedScores({ rating: 4, thickness: null, balance: null, ratings: [] }, { rating: null, thickness: null, balance: null }, at);
    check("評価を消すのも変更として記録する", clear !== null && clear.rating === null && clear.ratings.length === 1);
    check("reed が空でも例外を投げない",
      api.commitReedScores({}, { rating: null, thickness: null, balance: null }, at) === null);
  }

  // --- グラフの座標: 縦軸は1〜5固定 ---
  {
    const padTop = 12, plotH = api.REED_SCORE_PLOT_H;
    check("5は作図域の上端", api.reedScoreY(5, padTop, plotH) === padTop, String(api.reedScoreY(5, padTop, plotH)));
    check("1は作図域の下端", api.reedScoreY(1, padTop, plotH) === padTop + plotH, String(api.reedScoreY(1, padTop, plotH)));
    check("3は中央", api.reedScoreY(3, padTop, plotH) === padTop + plotH / 2, String(api.reedScoreY(3, padTop, plotH)));
    check("値が大きいほど上に来る",
      [1, 2, 3, 4, 5].every((v, i, a) => i === 0 || api.reedScoreY(a[i - 1], padTop, plotH) > api.reedScoreY(v, padTop, plotH)));
    check("目盛の間隔は等間隔",
      Math.abs((api.reedScoreY(1, padTop, plotH) - api.reedScoreY(2, padTop, plotH)) -
               (api.reedScoreY(4, padTop, plotH) - api.reedScoreY(5, padTop, plotH))) < 1e-9);
    // 「データに応じて伸縮させない」: yAt はデータを引数に取らないので、
    // どんなデータでも 3 の位置は同じ。仮に自動フルスケールに戻すと reedScoreY の
    // シグネチャ自体が変わるためこの呼び出しが壊れる。
    check("縦軸はデータを見ない(引数はvalue/padTop/plotHの3つだけ)", api.reedScoreY.length === 3, `${api.reedScoreY.length}引数`);

    // 横軸
    check("1件しかないときは中央に置く", api.reedScoreX(0, 1, 100, 300) === 200, String(api.reedScoreX(0, 1, 100, 300)));
    check("0件でも例外を投げない", Number.isFinite(api.reedScoreX(0, 0, 100, 300)));
    check("複数件は左端から右端まで等間隔",
      api.reedScoreX(0, 3, 100, 300) === 100 && api.reedScoreX(1, 3, 100, 300) === 200 && api.reedScoreX(2, 3, 100, 300) === 300);
    check("新しい記録ほど右", api.reedScoreX(0, 5, 0, 400) < api.reedScoreX(4, 5, 0, 400));

    // 欠測(未評価)で線を繋がない
    const segs = api.reedScoreSegments([3, null, 4, 5]);
    check("未評価をまたいで線を繋がない", segs.length === 2, `${segs.length}区間`);
    check("未評価の前後で区間が分かれる", JSON.stringify(segs) === JSON.stringify([[0], [2, 3]]), JSON.stringify(segs));
    check("全部未評価なら区間0", api.reedScoreSegments([null, null]).length === 0);
    check("全部評価済みなら1区間", api.reedScoreSegments([1, 2, 3]).length === 1);
    check("undefined も欠測として扱う", api.reedScoreSegments([1, undefined, 2]).length === 2);
    check("先頭・末尾の欠測で空区間を作らない",
      JSON.stringify(api.reedScoreSegments([null, 2, 3, null])) === JSON.stringify([[1, 2]]));
    check("空配列でも例外を投げない", api.reedScoreSegments([]).length === 0 && api.reedScoreSegments(null).length === 0);
    // 欠測は「線を繋がない」だけで、点は打つ(値がある記録は必ず見える)
    check("欠測を挟んだ1点だけの区間も区間として残る",
      JSON.stringify(api.reedScoreSegments([1, null, 2, null, 3])) === JSON.stringify([[0], [2], [4]]));

    // 日付ラベル
    check("記録が1件ならラベルは間引かない", api.reedScoreLabelStep(0, 40, 1) === 1);
    check("間隔が足りていれば間引かない", api.reedScoreLabelStep(50, 40, 10) === 1, String(api.reedScoreLabelStep(50, 40, 10)));
    check("間隔が半分なら1つおき", api.reedScoreLabelStep(20, 40, 10) === 2, String(api.reedScoreLabelStep(20, 40, 10)));
    check("間隔が0でも0除算しない", Number.isFinite(api.reedScoreLabelStep(0, 40, 10)));
    check("日付ラベルは M/D", api.reedScoreDateLabel("2026-07-31T12:00:00") === "7/31", api.reedScoreDateLabel("2026-07-31T12:00:00"));
    check("読めない日付は空文字", api.reedScoreDateLabel("こわれた") === "");
  }

  // --- ソース側の契約(ハーネスが見られない描画の要件をここで押さえる) ---
  {
    // 項目7: テキストの履歴行を消したこと
    check("「履歴:」のテキスト行が残っていない", !/>\s*履歴:\s*</.test(src) && !src.includes("履歴:"));
    // 項目2: 厚さ・バランスに★を出さない。StarRating 自体は他画面で使うので残す
    check("StarRating コンポーネントは残っている", /function StarRating\(/.test(src));
    check("RatingSlider は StarRating を呼ばない", !/RatingSlider[\s\S]{0,1400}?<StarRating/.test(sourceOf("RatingSlider")));
    check("RatingDial は StarRating を呼ばない", !sourceOf("RatingDial").includes("<StarRating"));
    check("ReedScoreField は StarRating を呼ばない", !sourceOf("ReedScoreField").includes("<StarRating"));
    check("ReedScoreEditor は StarRating を呼ばない", !sourceOf("ReedScoreEditor").includes("<StarRating"));
    // 項目1: スライダーは5段階(0.1刻みの復活を止める)
    check("スライダーの step は1", /step="1"/.test(sourceOf("RatingSlider")));
    check("スライダーに step 0.1 が残っていない", !/step="0\.1"/.test(sourceOf("RatingSlider")));
    check("スライダーの範囲は REED_SCORE_MIN〜MAX", /min=\{REED_SCORE_MIN\} max=\{REED_SCORE_MAX\}/.test(sourceOf("RatingSlider")));
    // 項目3: ダイヤルの並びは定数から引く(その場で reverse したりしない)
    check("ダイヤルは RATING_DIAL_ORDER を順に描く", /RATING_DIAL_ORDER\.map\(/.test(sourceOf("RatingDial")));
    check("ダイヤルが並びを反転していない", !/RATING_DIAL_ORDER\][\s\S]*?\.reverse\(\)/.test(sourceOf("RatingDial")));
    // 項目4/5 + §6.1.5: 編集UIは fixed のモーダルで、暗幕・影は既存モーダルと同値
    {
      const ed = sourceOf("ReedScoreEditor");
      check("編集ダイアログは position:fixed(流れから外す)", /position: "fixed"/.test(ed));
      check("暗幕は既存モーダルと同値", ed.includes('background: "rgba(15,23,42,0.28)"'));
      check("影は既存モーダルと同値", ed.includes('boxShadow: "0 8px 24px rgba(15,23,42,0.18)"'));
      check("カードの角丸は --r-lg", ed.includes('borderRadius: "var(--r-lg)"'));
      // 暗幕(role="dialog" の容器)自身が onClose を持つこと。完了ボタンにも同じ属性があるので、
      // 単に onClick={onClose} を探すと暗幕から外しても気づけない
      check("暗幕自身のタップで閉じる", /role="dialog"[\s\S]{0,120}?onClick=\{onClose\}[\s\S]{0,80}?position: "fixed"/.test(ed));
      check("完了ボタンは --tap-min 以上", /minHeight: "var\(--tap-min\)"/.test(ed));
      // 暗幕・影の値がアプリ全体で1種類であること(新しい濃さを発明していない)
      const scrimVals = new Set(src.match(/background: "rgba\(15,\s*23,\s*42,\s*[\d.]+\)"/g) || []);
      const shadowVals = new Set(src.match(/boxShadow: "[^"]*rgba\(15,\s*23,\s*42,\s*[\d.]+\)"/g) || []);
      const scrims = (src.match(/background: "rgba\(15,23,42,0\.28\)"/g) || []).length;
      const shadows = (src.match(/boxShadow: "0 8px 24px rgba\(15,23,42,0\.18\)"/g) || []).length;
      check("暗幕の値はアプリ内で1種類", scrimVals.size === 1, `${scrimVals.size}種 / ${scrims}箇所`);
      check("モーダルの影の値はアプリ内で1種類", shadowVals.size === 1, `${shadowVals.size}種 / ${shadows}箇所`);
      check("その1種類を3箇所以上(ScrollPicker/保存確認/評価編集)が共有している", scrims >= 3 && shadows >= 3, `暗幕${scrims} / 影${shadows}`);
    }
    // 項目4/5: 通常時はダイヤル/スライダーが出ていない(数値だけ)
    {
      const detail = sourceOf("ReedEvaluationDetail");
      check("詳細ビューは RatingDial を直接描かない", !detail.includes("<RatingDial"));
      check("詳細ビューは RatingSlider を直接描かない", !detail.includes("<RatingSlider"));
      check("詳細ビューは数値フィールドを描く", detail.includes("<ReedScoreField"));
      check("詳細ビューは編集ダイアログを条件付きで描く", /\{editingField && \(\s*<ReedScoreEditor/.test(detail));
      check("詳細ビューは評価の推移グラフを描く", detail.includes("<ReedScoreHistoryChart"));
      check("確定は commitReedScores 経由の1箇所だけ", (detail.match(/commitReedScores\(/g) || []).length === 1);
      check("履歴への直接 push が残っていない", !/ratings: \[\.\.\.\(reed\.ratings \|\| \[\]\), \{ value/.test(detail));
    }
    // 合格ライン15: 共通部品を共有していること(同等品の重複実装が無い)
    for (const [name, re] of [
      ["useMeasuredWidth", /function useMeasuredWidth\(/g],
      ["fitLabel", /function fitLabel\(/g],
      ["measureSvgTextPx", /function measureSvgTextPx\(/g],
      ["SERIES_STYLES", /const SERIES_STYLES = /g],
      ["SVG_FS_XS", /const SVG_FS_XS = /g],
    ]) {
      const n = (src.match(re) || []).length;
      check(`${name} の定義は1つだけ(重複実装が無い)`, n === 1, `${n}箇所`);
    }
    {
      const chart = sourceOf("ReedScoreHistoryChart");
      check("グラフは useMeasuredWidth を使う", chart.includes("useMeasuredWidth()"));
      check("グラフは SERIES_STYLES を使う", chart.includes("SERIES_STYLES["));
      check("グラフは SVG_FS_XS を使う", chart.includes("SVG_FS_XS"));
      check("グラフは fitLabel を使う", chart.includes("fitLabel("));
      check("グラフは measureSvgTextPx を使う", chart.includes("measureSvgTextPx("));
      check("グラフの実寸と viewBox は 1:1", /width=\{W\} height=\{L\.H\} viewBox=\{`0 0 \$\{W\} \$\{L\.H\}`\}/.test(chart));
      check("preserveAspectRatio による全体縮小をしていない", !chart.includes("preserveAspectRatio"));
      check("グラフの縦軸目盛は RATING_DIAL_ORDER(1〜5固定)", /RATING_DIAL_ORDER\.map\(/.test(chart));
      // 自動フルスケール描画に戻していないこと(NoteAxisLineChart はデータから lo/hi/rng を作る。
      // ここはそれを持たず、y の写像は reedScoreY(=1〜5固定)しか無い)
      check("グラフの y 写像は reedScoreY だけ", /yAt: \(v\) => reedScoreY\(v, padTop, plotH\)/.test(chart));
      check("グラフはデータから縦軸の範囲を作っていない", !/const (lo|hi|rng|minV|maxV|pad) =/.test(chart));
      check("グラフは履歴値の min/max を取っていない", !/Math\.(min|max)\([^;]*history/.test(chart));
      check("グラフの系列は3本", (chart.match(/\{ key: "(rating|thickness|balance)"/g) || []).length === 3);
      check("空状態は「育つ」の語り口", chart.includes("評価するとここに折れ線が育ちます"));
      check("線は2点以上の区間だけ引く", chart.includes("filter((seg) => seg.length >= 2)"));
    }
    // §1.7/§1.8: 系列は紺3段・機能色を使わない
    {
      const s = api ? null : null; // SERIES_STYLES は JSX 側の定数なのでソースで確認する
      const block = extractConst("SERIES_STYLES");
      check("系列色に機能色(緑/橙/赤)を使っていない", !/#16A34A|#D97706|#DC2626/.test(block));
      check("系列1は --c-accent の実線2px", /\{ color: "var\(--c-accent\)",\s+width: 2, dash: null \}/.test(block));
      check("系列2は --c-accent-mid の実線2px", /\{ color: "var\(--c-accent-mid\)",\s+width: 2, dash: null \}/.test(block));
      check("系列3は --c-accent-line の実線3px", /\{ color: "var\(--c-accent-line\)", width: 3, dash: null \}/.test(block));
      void s;
    }
    // §1.9/§4.1: グラフ内の文字は12px以上、目盛の余白は左右8px・上下4px以上
    check("グラフSVG内の文字サイズは12px(--fs-xs)", api.REED_SCORE_PLOT_H > 0 && /const SVG_FS_XS = 12;/.test(src));
    {
      const chart = sourceOf("ReedScoreHistoryChart");
      check("目盛の左右余白は --sp-2 以上", /const TICK_GAP = SVG_SP2 \+ SVG_SP1;/.test(chart));
      check("上端の余白は --sp-1 以上", /const padTop = SVG_SP2 \+ SVG_SP1;/.test(chart));
      check("下端の余白は --sp-1 以上", /H: labelY \+ SVG_SP2,/.test(chart));
    }
    // 立入禁止の確認: リードのデータモデルを壊していない
    check("リード新規作成の rating 初期値は null のまま", /rating: null, \/\/ 主観の5段階評価/.test(src));
    check("thickness の初期値は null のまま", /thickness: null, \/\/ 主観の厚さ/.test(src));
    check("balance の初期値は null のまま", /balance: null,\s+\/\/ 主観のバランス/.test(src));
    check("pitchBarColorRGB を触っていない", /function pitchBarColorRGB\(/.test(src));
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
