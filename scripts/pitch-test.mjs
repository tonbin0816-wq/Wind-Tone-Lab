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

// コメントを外した「実際に動く側」だけを返す。「○○は使わない」「【削除済み】○○」という
// 記録をコメントに書くと、その綴りが本文に現れて「○○が無いこと」の検査が落ちる。
// 記録を残せなくなるのは本末転倒なので、綴りの不在を見る検査はここを通してから見る。
function codeOf(s) {
  return String(s || "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

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
  extractConst("RING_IN_TUNE_CENTS"),
  extractConst("RING_VB"),
  extractConst("RING_CX"),
  extractConst("RING_CY"),
  extractConst("RING_R"),
  extractConst("RING_SW"),
  extractConst("RING_MARKER_MIN_GAP_PX"),
  extractConst("RING_D_FULL"),
  extractFunction("ringPoint"),
  extractFunction("ringArcD"),
  // 機能色の補間(OKLCH)と帯のグラデーション
  extractFunction("srgbToLinear"),
  extractFunction("linearToSrgb"),
  extractFunction("rgbToOklab"),
  extractFunction("oklabToRgb"),
  extractFunction("oklabToOklch"),
  extractFunction("oklchToOklab"),
  extractFunction("mixOklchRGB"),
  extractFunction("pitchBarColorRGB"),
  extractConst("RING_RAMP_REF"),
  extractConst("RING_RAMP_STOPS"),
  extractFunction("ringSmoothstep"),
  extractFunction("ringTuneRGB"),
  extractFunction("ringRampRGB"),
  extractFunction("ringGradientStops"),
  // 到達の演出(走り・呼吸・光・再走行の抑制)
  extractConst("RING_RUN_MS"),
  extractConst("RING_RUN_REARM_MS"),
  extractConst("RING_BREATH_MS"),
  extractConst("RING_BREATH_RISE"),
  extractConst("RING_GLOW_AMP"),
  extractConst("RING_GLOW_EDGE_PCT"),
  extractFunction("ringRunEase"),
  extractFunction("ringRunQuantP"),
  extractFunction("ringRunProgress"),
  extractFunction("ringBreath"),
  extractFunction("ringGlowOpacity"),
  extractFunction("ringGlowRGB"),
  extractFunction("ringRunState"),
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
  // ringPendArcD / RING_PEND_ARC_D は軌道のガイド線ごと削除した(本人指示)
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
  // リードの主観評価(総評=0.1刻み41段 / 厚さ・バランス=1〜5の整数)。履歴の追加判定・グラフの座標
  extractConst("REED_SCORE_MIN"),
  extractConst("REED_SCORE_MAX"),
  extractConst("REED_SCORE_KEYS"),
  extractConst("REED_RATING_STEP"),
  extractConst("REED_RATING_STEPS_N"),
  extractConst("RATING_DIAL_ORDER"),
  extractConst("RATING_DIAL_RATING_ORDER"),
  extractConst("RATING_DIAL_ITEM_H"),
  extractConst("RATING_DIAL_VISIBLE"),
  extractConst("REED_SCORE_NEUTRAL"),
  extractConst("REED_SCORE_PLOT_H"),
  extractFunction("normalizeReedScore"),
  extractFunction("normalizeReedRating"),
  extractFunction("normalizeReedScoreOf"),
  extractFunction("ratingDialOrder"),
  extractFunction("reedScoreText"),
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
  extractFunction("reedScoreRowItems"),
  // 詳細画面の横スワイプ(指追従。右=戻る / 左=onForward)
  extractConst("SWIPE_BACK_THRESHOLD_RATIO"),
  extractConst("SWIPE_BACK_THRESHOLD_MIN"),
  extractConst("SWIPE_AXIS_LOCK_PX"),
  extractConst("SWIPE_VERTICAL_BIAS"),
  extractConst("SWIPE_DEAD_END_RESIST"),
  extractConst("SWIPE_BACK_EASE"),
  extractConst("SWIPE_BACK_SETTLE_MS"),
  extractFunction("swipeBackThreshold"),
  extractFunction("swipeAxisIsHorizontal"),
  extractFunction("swipeBackOffset"),
  extractFunction("swipeBackDecision"),
  extractFunction("swipeBackHandler"),
  extractFunction("createSwipeBackGesture"),
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
           METRO_TEMPO_MIN, METRO_TEMPO_MAX, RING_MAX_CENTS, RING_SWEEP_DEG, RING_IN_TUNE_CENTS,
           RING_VB, RING_CX, RING_CY, RING_R, RING_SW, ringArcD,
           srgbToLinear, linearToSrgb, rgbToOklab, oklabToRgb, oklabToOklch, oklchToOklab,
           mixOklchRGB, pitchBarColorRGB, RING_RAMP_REF, RING_RAMP_STOPS,
           ringSmoothstep, ringTuneRGB, ringRampRGB, ringGradientStops,
           RING_RUN_MS, RING_RUN_REARM_MS, RING_BREATH_MS, RING_BREATH_RISE,
           RING_GLOW_AMP, RING_GLOW_EDGE_PCT,
           ringRunEase, ringRunQuantP, ringRunProgress, ringBreath, ringGlowOpacity, ringGlowRGB, ringRunState,
           RING_PEND_R, RING_PEND_SWING_DEG, RING_PEND_BOB_R, RING_PEND_BOB_GROW,
           RING_PEND_HALO_GAP, RING_PEND_HALO_SW, RING_PEND_HALO_OPACITY,
           RING_BEAT_DOT_ORBIT_R, RING_BEAT_DOT_SPREAD_DEG, RING_BEAT_DOT_R, RING_BEAT_DOT_CUR_R,
           RING_BEAT_DOT_CUR_GROW, RING_BEAT_DOT_HEAD_R, RING_BEAT_DOT_HEAD_GROW,
           RING_BEAT_EMPH_DECAY, RING_BEAT_EMPH_HEAD, RING_BEAT_EMPH_OTHER,
           RING_MARKER_MIN_GAP_PX, RING_D_FULL,
           audioCtxRecoveryAction, isMicTrackUsable, isMicStreamUsable, shouldRecoverFromSilence,
           SILENCE_WATCHDOG_DB, SILENCE_WATCHDOG_SUSTAIN_MS, MIC_RECOVER_COOLDOWN_MS,
           MIC_RETRY_TAP_COOLDOWN_MS, AUDIO_SESSION_TYPE,
           REED_SCORE_MIN, REED_SCORE_MAX, REED_SCORE_KEYS,
           REED_RATING_STEP, REED_RATING_STEPS_N, RATING_DIAL_RATING_ORDER, RATING_DIAL_VISIBLE,
           RATING_DIAL_ORDER, RATING_DIAL_ITEM_H, REED_SCORE_NEUTRAL, REED_SCORE_PLOT_H,
           normalizeReedScore, normalizeReedRating, normalizeReedScoreOf, ratingDialOrder, reedScoreText,
           reedHistoryEntry, normalizeRatingHistory, commitReedScores,
           ratingDialValueAt, ratingDialOffsetFor, ratingDialScrollIsUser,
           reedScoreY, reedScoreX, reedScoreSegments, reedScoreLabelStep, reedScoreDateLabel,
           reedScoreRowItems,
           SWIPE_BACK_THRESHOLD_RATIO, SWIPE_BACK_THRESHOLD_MIN, SWIPE_AXIS_LOCK_PX, SWIPE_DEAD_END_RESIST,
           SWIPE_VERTICAL_BIAS,
           SWIPE_BACK_EASE, SWIPE_BACK_SETTLE_MS,
           swipeBackThreshold, swipeAxisIsHorizontal, swipeBackOffset, swipeBackDecision, swipeBackHandler,
           createSwipeBackGesture };`)();

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
  // 環の帯(ピッチ)と拍の要素(錘・点)の最小距離。
  //
  // DESIGN-SYSTEM §6.1 の要件は「**実寸**で最低 6 CSS px」。
  // ここは実装の定数の定義を言い換えるのではなく、実寸を独立に計算して要件と突き合わせる。
  // (過去に「距離 − (定義から引き算で作った上限) > 余白」という恒等式を書いてしまい、
  //  構造上失敗し得ないテストで余白を守っているつもりになっていた。定義から導出しない)
  //
  // 【基準が変わった】以前は帯の先端に半径 RING_SW/2+3 の点を置いていたので、
  // 「点の内縁 R-SW/2-3 = 126」で測っていた。その点を削除したので、
  // 基準は**帯の内縁 R-SW/2 = 129**になる(=クリアランスは広がる)。
  // さらに到達時は帯が**全周**を走るので、どの角度にも帯が来る最悪ケースで見る。
  // 帯は半径 [R-SW/2, R+SW/2] の円環なので、内側の点から見た最短距離は
  // 「R-SW/2 − 中心からの距離 − その要素の半径」。
  //
  // viewBox は 300 で、実寸は環の直径。つまり 1 viewBox 単位 = 直径/300 CSS px。
  // 環は常に RING_D_FULL(330) なので 1.1 倍。viewBox 単位を px と呼んではいけない。
  // ------------------------------------------------------------------
  {
    const VB_TO_PX = api.RING_D_FULL / 300;
    const bandInnerVb = api.RING_R - api.RING_SW / 2;
    let minPx = Infinity, worst = null;
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
        const items = [[Math.hypot(bx - api.RING_CX, by - api.RING_CY), bobOuter, "錘"]];
        for (let i = 0; i < beats; i++) {
          items.push([Math.hypot(dots[i][0] - api.RING_CX, dots[i][1] - api.RING_CY), dotRs[i], `点${i}`]);
        }
        for (const [dist, rr, which] of items) {
          const clearPx = (bandInnerVb - dist - rr) * VB_TO_PX;
          if (clearPx < minPx) { minPx = clearPx; worst = { beats, phase: +p.toFixed(3), e: +e.toFixed(3), which }; }
        }
      }
    }
    check(`環の帯と拍の要素(錘・点)が実寸で ${api.RING_MARKER_MIN_GAP_PX} CSS px 以上離れている`,
      minPx >= api.RING_MARKER_MIN_GAP_PX,
      `最小 ${minPx.toFixed(2)} CSS px (${api.RING_D_FULL}px環) @ ${JSON.stringify(worst)}`);
    console.log(`  帯の内縁と拍の要素の最小クリアランス: ${minPx.toFixed(2)} CSS px (要件 ${api.RING_MARKER_MIN_GAP_PX}) @ ${JSON.stringify(worst)}`);
  }

  // 帯(ピッチ)の内側に拍の要素が入らないことを、**位相に依存しない上限**でも見る。
  // 上の検査は位相を刻んだ実測、こちらは取りうる最大半径からの静的な上限で、独立している。
  {
    const bandInner = api.RING_R - api.RING_SW / 2;                 // 環の帯の内縁
    const bobOuterMax = api.RING_PEND_R + api.RING_PEND_BOB_R + api.RING_PEND_BOB_GROW
      + api.RING_PEND_HALO_GAP + api.RING_PEND_HALO_SW / 2;
    const dotOuterMax = api.RING_BEAT_DOT_ORBIT_R + api.RING_BEAT_DOT_HEAD_R + api.RING_BEAT_DOT_HEAD_GROW;
    const gapPx = (bandInner - Math.max(bobOuterMax, dotOuterMax)) * (api.RING_D_FULL / 300);
    check(`拍の要素が環の帯に届かない(実寸で ${api.RING_MARKER_MIN_GAP_PX} CSS px 以上内側)`,
      gapPx >= api.RING_MARKER_MIN_GAP_PX,
      `帯の内縁 ${bandInner} / 錘 ${bobOuterMax.toFixed(2)} / 点 ${dotOuterMax} → ${gapPx.toFixed(2)} CSS px`);
  }

  // 軌道のガイド線は描かない(本人指示で削除)。以前はここに「弧が錘の軌道と一致する」検査が
  // あったが、弧そのものを消したので、代わりに**復活していないこと**を見る。
  // 演奏中サーフェスは読ませる線を増やさない(DESIGN-SYSTEM §6.1)。
  // 「削除した」という記録をコメントに残すと、識別子の綴りが本文に現れる。
  // コメントを外してから見ないと、記録を書いた瞬間にこの検査が落ちる(実際に落ちた)。
  check("振り子の軌道にガイド線を描かない(定数も描画も残っていない)",
    !/const RING_PEND_ARC/.test(codeOf(src)) && !/function ringPendArcD/.test(codeOf(src))
    && !/<path d=\{RING_PEND/.test(codeOf(src)));
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
// 検証19: チューナーの環 — 機能色のOKLCH補間 / 帯のグラデーション / 到達の演出
// ============================================================
console.log("=== 検証19: 環の配色(OKLCH)・帯のグラデーション・到達の演出 ===");
{
  // JSX側(描画)はハーネスからevalできないので、ソース文字列で見る。
  const ringSrc = (() => {
    const idx = src.indexOf("function PitchRing(");
    if (idx === -1) throw new Error("PitchRing not found");
    // 引数が分割代入({ note, ... })なので、まず括弧を閉じてから本体の波括弧を数える。
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
    throw new Error("PitchRing: unbalanced");
  })();
  const ringCode = codeOf(ringSrc);
  const GREEN = [22, 163, 74], ORANGE = [217, 119, 6], RED = [220, 38, 38];

  // ------------------------------------------------------------------
  // ringArcD が返す **パス文字列そのもの** を幾何として読み解くための道具。
  // 「to>from なら sweep=1」という綴りを見るだけでは、sweep を定数に潰す変異
  // (= 低い側の帯が環から外れた鏡像の弧になる)を捕まえられない。
  // SVG 2 の F.6.5「端点表現→中心表現」の変換をそのまま実装し、描かれる弧の
  // **中心・半径・開始角・符号付き掃引角**を取り出して意図と突き合わせる。
  // ------------------------------------------------------------------
  function parseArcD(d) {
    const m = /^M(-?[\d.]+),(-?[\d.]+) A(-?[\d.]+),(-?[\d.]+) 0 ([01]),([01]) (-?[\d.]+),(-?[\d.]+)$/.exec(d);
    if (!m) return null;
    const [x1, y1, rx, ry] = [+m[1], +m[2], +m[3], +m[4]];
    const fA = +m[5], fS = +m[6], x2 = +m[7], y2 = +m[8];
    const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;   // 回転0なので x1'=dx2, y1'=dy2
    const num = rx * rx * ry * ry - rx * rx * dy2 * dy2 - ry * ry * dx2 * dx2;
    const den = rx * rx * dy2 * dy2 + ry * ry * dx2 * dx2;
    const coef = (fA === fS ? -1 : 1) * Math.sqrt(Math.max(0, num) / den);
    const cxp = coef * (rx * dy2) / ry, cyp = coef * (-(ry * dx2) / rx);
    const cx = cxp + (x1 + x2) / 2, cy = cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => {
      const s = Math.sign(ux * vy - uy * vx) || 1;
      const c = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
      return (s * Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
    };
    const th1 = ang(1, 0, (dx2 - cxp) / rx, (dy2 - cyp) / ry);
    let dth = ang((dx2 - cxp) / rx, (dy2 - cyp) / ry, (-dx2 - cxp) / rx, (-dy2 - cyp) / ry);
    if (fS === 0 && dth > 0) dth -= 360;
    if (fS === 1 && dth < 0) dth += 360;
    return { cx, cy, rx, ry, fA, fS, th1, dth, x1, y1, x2, y2 };
  }
  {
    // 帯・走りの弧はすべて ringArcD が作る。ここで見るのは綴りではなく**出力の幾何**。
    // 低い側(to<from)で sweep を 1 に潰すと、中心が環の中心から外れた鏡像の弧になり
    // 「帯が環から剥がれる」。中心・半径・開始角・掃引角の4つで塞ぐ。
    const cases = [];
    for (const [from, to] of [
      [0, 110], [0, -110], [0, 1.5], [0, -1.5], [0, 55], [0, -55],
      [-180, 0], [180, 0], [-90, 0], [90, 0], [-30, 0], [30, 0],
      // 180°を超える弧。アプリの現在の使い方では出ないが、large-arc-flag の分岐は
      // ここでしか検証できない(下に「実際に描く弧は常に180°以下」の記録も置く)。
      [0, 200], [0, -200], [-270, 0], [270, 0],
    ]) cases.push([from, to, parseArcD(api.ringArcD(from, to))]);
    check("ringArcD の出力はすべて 1本の楕円弧コマンドとして読める",
      cases.every(([, , g]) => g !== null),
      cases.filter(([, , g]) => !g).map(([f, t]) => `${f}→${t}`).join(",") || "全12件OK");
    // ringArcD は端点を toFixed(2) で丸めるので、弦が短いほど中心の復元が鈍る。
    // 許容は「端点の丸め 0.005 が中心をどれだけ動かすか(≒ ε×R/弦長)」から出す。
    // sweep を潰す変異が作る鏡像の弧は中心が 2R(=272)ずれるので、この許容でも捕まる。
    const tolOf = (g) => 0.02 + 0.03 * api.RING_R / Math.max(1e-6, Math.hypot(g.x2 - g.x1, g.y2 - g.y1));
    check("ringArcD の弧の中心は環の中心・半径は RING_R", cases.every(([, , g]) =>
      g && Math.abs(g.cx - api.RING_CX) < tolOf(g) && Math.abs(g.cy - api.RING_CY) < tolOf(g)
      && g.rx === api.RING_R && g.ry === api.RING_R),
      cases.map(([f, t, g]) => `${f}→${t}:(${g.cx.toFixed(2)},${g.cy.toFixed(2)})`).join(" ").slice(0, 160));
    check("ringArcD の開始角は from(12時=0・時計回り)と一致する", cases.every(([from, , g]) => {
      const want = ((from - 90) % 360 + 540) % 360 - 180;   // SVG極角へ。-180〜180 に正規化
      const got = ((g.th1 % 360) + 540) % 360 - 180;
      return Math.abs(((got - want + 540) % 360) - 180) < 0.02 + tolOf(g) * 30;
    }));
    check("ringArcD の符号付き掃引角は to−from と一致する(向きが反転しない)",
      cases.every(([from, to, g]) => Math.abs(g.dth - (to - from)) < 0.02),
      cases.map(([f, t, g]) => `${f}→${t}:${g.dth.toFixed(2)}°`).join(" ").slice(0, 160));
    check("ringArcD の large-arc-flag は掃引角が180°を超えるときだけ1",
      cases.every(([from, to, g]) => g.fA === (Math.abs(to - from) > 180 ? 1 : 0)),
      cases.map(([f, t, g]) => `${f}→${t}:${g.fA}`).join(" "));
    // 【事実の記録】アプリが実際に ringArcD へ渡す角度は、ズレの帯が (0, ±110°まで)、
    // 走りが (±180°まで, 0)。どちらも 180° を超えないので large-arc-flag は常に0になる。
    // 上の検査が >180° の場合を含んでいるのは、分岐そのものを検証するため。
    check("アプリが実際に描く弧はすべて掃引180°以下(large-arc-flag は常に0)", (() => {
      const used = [];
      for (let c = -api.RING_MAX_CENTS; c <= api.RING_MAX_CENTS; c += 0.25) {
        used.push([0, (c / api.RING_MAX_CENTS) * api.RING_SWEEP_DEG]);
      }
      for (let ms = 0; ms <= api.RING_RUN_MS; ms += 1) {
        const sp = 180 * api.ringRunQuantP(api.ringRunProgress(0, ms));
        used.push([-sp, 0], [sp, 0]);
      }
      return used.every(([f, t]) => {
        if (Math.abs(t - f) > 180 + 1e-9) return false;
        const g = parseArcD(api.ringArcD(f, t));
        return g && g.fA === 0;
      });
    })());
    // 弧の中点が環の上に乗ること(端点だけ合っていても中身が別の弧なら落ちる)。
    check("ringArcD の弧上の点はすべて環(中心・半径 RING_R)の上にあり、from〜to の内側に収まる", (() => {
      let worst = 0;
      for (const [from, to, g] of cases) {
        const tol = tolOf(g);
        for (let u = 0; u <= 1.0001; u += 0.05) {
          const th = ((g.th1 + g.dth * u) * Math.PI) / 180;
          const px = g.cx + Math.cos(th) * g.rx, py = g.cy + Math.sin(th) * g.ry;
          const dev = Math.abs(Math.hypot(px - api.RING_CX, py - api.RING_CY) - api.RING_R);
          worst = Math.max(worst, dev);
          if (dev > tol) return false;
          // その角度に対応する 12時基準の角度が from〜to の内側にあること
          const deg = th * 180 / Math.PI + 90;
          const lo = Math.min(from, to) - 0.1 - tol, hi = Math.max(from, to) + 0.1 + tol;
          const norm = ((deg - lo) % 360 + 360) % 360 + lo;
          if (norm > hi + 1e-6) return false;
        }
      }
      return true;
    })());
  }

  // ------------------------------------------------------------------
  // A-1. sRGB ⇔ OKLab の往復。既知の値で丸め誤差の範囲に収まること。
  // ------------------------------------------------------------------
  check("srgbToLinear/linearToSrgb は互いの逆", (() => {
    for (let i = 0; i <= 255; i++) {
      const c = i / 255;
      if (Math.abs(api.linearToSrgb(api.srgbToLinear(c)) - c) > 1e-9) return false;
    }
    return true;
  })());
  check("srgbToLinear は0と1を固定点に持つ",
    api.srgbToLinear(0) === 0 && Math.abs(api.srgbToLinear(1) - 1) < 1e-12);
  check("rgbToOklab→oklabToRgb は元の色に戻る(全機能色)",
    [GREEN, ORANGE, RED, [0, 0, 0], [255, 255, 255], [128, 64, 200]].every((c) =>
      api.oklabToRgb(api.rgbToOklab(c)).join(",") === c.join(",")));
  // 既知の基準値: 白の L は 1、黒の L は 0(OKLab の定義)
  check("白の OKLab の L は 1", Math.abs(api.rgbToOklab([255, 255, 255])[0] - 1) < 1e-6,
    String(api.rgbToOklab([255, 255, 255])[0]));
  check("黒の OKLab は原点", api.rgbToOklab([0, 0, 0]).every((v) => Math.abs(v) < 1e-9));
  check("無彩色(灰)は OKLCH の彩度が0", api.oklabToOklch(api.rgbToOklab([128, 128, 128]))[1] < 1e-6);
  check("oklabToOklch/oklchToOklab は往復する",
    [GREEN, ORANGE, RED].every((c) => {
      const lab = api.rgbToOklab(c);
      const back = api.oklchToOklab(api.oklabToOklch(lab));
      return lab.every((v, i) => Math.abs(v - back[i]) < 1e-12);
    }));
  check("色域外の OKLab は 0〜255 に丸められる",
    api.oklabToRgb([1.5, 0.4, 0.4]).every((v) => v >= 0 && v <= 255 && Number.isInteger(v))
    && api.oklabToRgb([-1, 0, 0]).every((v) => v === 0));

  // ------------------------------------------------------------------
  // A-2. 補間は **OKLCH**。sRGB の直線補間に戻すと落ちる。
  //   緑→橙の中点は sRGB なら rgb(120,141,40) の濁ったカーキ。
  //   OKLCH なら彩度が落ちない澄んだ金になる。
  // ------------------------------------------------------------------
  {
    const mid = api.mixOklchRGB(GREEN, ORANGE, 0.5);
    const srgbMid = [0, 1, 2].map((k) => Math.round(GREEN[k] + (ORANGE[k] - GREEN[k]) * 0.5));
    check("緑→橙の中点は sRGB 直線補間の色と一致しない(=OKLCHで補間している)",
      mid.join(",") !== srgbMid.join(","), `OKLCH=${mid.join(",")} / sRGB=${srgbMid.join(",")}`);
    // 濁りの定量: 途中で彩度(OKLCH の C)がどれだけ落ちるか。
    // 緑と橙は色相が離れているので sRGB 色域の都合でどちらの経路でも多少は落ちるが、
    // **OKLCH のほうが落ち込みが明確に浅い**。これが「濁った/澄んだ」の正体。
    const cOf = (rgb) => api.oklabToOklch(api.rgbToOklab(rgb))[1];
    const dipOf = (f) => {
      let m = Infinity, at = 0;
      for (let t = 0; t <= 1.0001; t += 0.005) { const c = cOf(f(t)); if (c < m) { m = c; at = t; } }
      return [m, at];
    };
    const [okDip, okAt] = dipOf((t) => api.mixOklchRGB(GREEN, ORANGE, t));
    const [srgbDip] = dipOf((t) => [0, 1, 2].map((k) => Math.round(GREEN[k] + (ORANGE[k] - GREEN[k]) * t)));
    const endMinC = Math.min(cOf(GREEN), cOf(ORANGE));
    check("緑→橙の彩度の落ち込みが sRGB 直線補間より浅い(濁らない)", okDip > srgbDip + 0.01,
      `OKLCH最小C=${okDip.toFixed(5)} @t=${okAt.toFixed(2)} / sRGB最小C=${srgbDip.toFixed(5)} / 両端の下限=${endMinC.toFixed(5)}`);
    console.log(`  緑→橙の彩度の落ち込み: OKLCH=${okDip.toFixed(5)} / sRGB直線=${srgbDip.toFixed(5)} (両端の下限 ${endMinC.toFixed(5)})`);
    check("緑→橙の中点は仕様どおり rgb(160,145,0)(sRGB直線なら rgb(120,141,40))",
      api.mixOklchRGB(GREEN, ORANGE, 0.5).join(",") === "160,145,0"
      && srgbMid.join(",") === "120,141,40", api.mixOklchRGB(GREEN, ORANGE, 0.5).join(","));
    check("mixOklchRGB は両端で元の色そのもの",
      api.mixOklchRGB(GREEN, ORANGE, 0).join(",") === GREEN.join(",")
      && api.mixOklchRGB(GREEN, ORANGE, 1).join(",") === ORANGE.join(","));
    // 色相は最短経路。0°/360° をまたぐ2色で確かめる(機能色どうしは -91°/-31° で
    // またがないため、そこで見ても最短経路の実装は検証できない)。
    // rgb(220,60,180) は H≈340.0° / rgb(255,100,150) は H≈3.3°。短い方は +23.4°、
    // 長い方は -336.6°。最短経路でないと途中で緑や青を経由する。
    const hOf = (rgb) => api.oklabToOklch(api.rgbToOklab(rgb))[2];
    const A = [220, 60, 180], B = [255, 100, 150];
    check("色相は 0°/360° をまたぐときも最短経路で回る", (() => {
      for (let t = 0; t <= 1.0001; t += 0.01) {
        const h = hOf(api.mixOklchRGB(A, B, t));
        if (!(h >= 339 || h <= 4.5)) return false;
      }
      return true;
    })(), (() => {
      let far = 0, at = 0;
      for (let t = 0; t <= 1.0001; t += 0.01) {
        const h = hOf(api.mixOklchRGB(A, B, t));
        const d = Math.min(Math.abs(h - 360), Math.abs(h));
        if (d > far) { far = d; at = t; }
      }
      return `0°から最も離れた色相=${far.toFixed(1)}° @t=${at.toFixed(2)}`;
    })());
    let maxJump = 0;
    for (let t = 0; t < 1; t += 0.01) {
      maxJump = Math.max(maxJump, Math.abs(hOf(api.mixOklchRGB(GREEN, RED, t + 0.01)) - hOf(api.mixOklchRGB(GREEN, RED, t))));
    }
    check("緑→赤の色相は1%刻みで飛ばない", maxJump < 5, `最大の飛び=${maxJump.toFixed(2)}°`);
  }

  // ------------------------------------------------------------------
  // A-3. pitchBarColorRGB のストップ。橙は **8¢**(以前は13¢)。
  // ------------------------------------------------------------------
  check("0¢はちょうど緑 #16A34A", api.pitchBarColorRGB(0).join(",") === GREEN.join(","));
  // **pitchBarColorRGB 自身が OKLCH で補間していること**を、出てくる色で確かめる。
  // (mixOklchRGB 単体の検査だけだと、pitchBarColorRGB を sRGB 直線補間に戻す変異を見逃す)
  check("pitchBarColorRGB は OKLCH で補間している(4¢=緑と橙の中点=rgb(160,145,0))", (() => {
    const got = api.pitchBarColorRGB(4).join(",");
    const srgb = [0, 1, 2].map((k) => Math.round(GREEN[k] + (ORANGE[k] - GREEN[k]) * 0.5)).join(",");
    return got === "160,145,0" && got === api.mixOklchRGB(GREEN, ORANGE, 0.5).join(",") && got !== srgb;
  })(), api.pitchBarColorRGB(4).join(","));
  check("pitchBarColorRGB は全域で OKLCH 補間と一致し、sRGB 直線補間とは離れる", (() => {
    let maxOk = 0, maxSrgb = 0;
    for (let a = 0; a <= 30; a += 0.1) {
      const got = api.pitchBarColorRGB(a);
      const seg = a <= 8 ? [GREEN, ORANGE, a / 8] : [ORANGE, RED, (a - 8) / 22];
      const ok = api.mixOklchRGB(seg[0], seg[1], seg[2]);
      const sr = [0, 1, 2].map((k) => Math.round(seg[0][k] + (seg[1][k] - seg[0][k]) * seg[2]));
      maxOk = Math.max(maxOk, Math.max(...[0, 1, 2].map((k) => Math.abs(got[k] - ok[k]))));
      maxSrgb = Math.max(maxSrgb, Math.max(...[0, 1, 2].map((k) => Math.abs(got[k] - sr[k]))));
    }
    return maxOk === 0 && maxSrgb > 20;
  })());
  check("8¢はちょうど橙 #D97706", api.pitchBarColorRGB(8).join(",") === ORANGE.join(","),
    api.pitchBarColorRGB(8).join(","));
  check("13¢は橙ではない(橙は8¢へ前倒しした)", api.pitchBarColorRGB(13).join(",") !== ORANGE.join(","),
    api.pitchBarColorRGB(13).join(","));
  check("30¢以上はちょうど赤 #DC2626",
    api.pitchBarColorRGB(30).join(",") === RED.join(",") && api.pitchBarColorRGB(50).join(",") === RED.join(",")
    && api.pitchBarColorRGB(-99).join(",") === RED.join(","));
  check("符号によらず絶対値で決まる", (() => {
    for (let c = 0; c <= 50; c += 0.25) {
      if (api.pitchBarColorRGB(c).join(",") !== api.pitchBarColorRGB(-c).join(",")) return false;
    }
    return true;
  })());
  // 橙の位置が8¢であることを、定数の言い換えではなく**色の到達点**で見る。
  // 13¢へ戻すと 8¢ の色は橙に届かない(=この検査が落ちる)。
  check("8¢より手前は橙に達していない(緑寄り)", (() => {
    const c = api.pitchBarColorRGB(7.9);
    return c.join(",") !== ORANGE.join(",")
      && api.oklabToOklch(api.rgbToOklab(c))[2] > api.oklabToOklch(api.rgbToOklab(ORANGE))[2];
  })());
  check("8¢を越えると赤へ向かう(橙から離れる)", (() => {
    const h8 = api.oklabToOklch(api.rgbToOklab(api.pitchBarColorRGB(8)))[2];
    const h9 = api.oklabToOklch(api.rgbToOklab(api.pitchBarColorRGB(9)))[2];
    return h9 < h8;
  })());
  // ストップの境目で色が跳ばないこと(区分ごとに別の補間をすると継ぎ目が出る)。
  check("ストップの境目(0/8/30¢)で色が跳ばない", (() => {
    const d = (a, b) => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k] - b[k])));
    return d(api.pitchBarColorRGB(0), api.pitchBarColorRGB(0.001)) <= 2
      && d(api.pitchBarColorRGB(7.999), api.pitchBarColorRGB(8.001)) <= 2
      && d(api.pitchBarColorRGB(29.999), api.pitchBarColorRGB(30.001)) <= 2;
  })());

  // ------------------------------------------------------------------
  // B. 帯のランプ — 先端からの**絶対弧長**で塗る。帯の長さで割らない。
  // ------------------------------------------------------------------
  check("RING_RAMP_REF は 62(viewBox単位)", api.RING_RAMP_REF === 62, String(api.RING_RAMP_REF));
  // 「作り込む長さ」が実用域とどう対応しているか。角度→セントの写像から逆に辿る。
  check("ランプは実用域(±10¢)の内側で飽和しない", (() => {
    const centsOf = (s) => ((s / api.RING_R) * 180 / Math.PI) / api.RING_SWEEP_DEG * api.RING_MAX_CENTS;
    const refCents = centsOf(api.RING_RAMP_REF);
    return refCents > 10 && refCents < 14;
  })(), `RING_RAMP_REF=${api.RING_RAMP_REF} は ${(((api.RING_RAMP_REF / api.RING_R) * 180 / Math.PI) / api.RING_SWEEP_DEG * api.RING_MAX_CENTS).toFixed(2)}¢ 相当`);
  check("ストップ数は30", api.RING_RAMP_STOPS === 30, String(api.RING_RAMP_STOPS));
  check("smoothstep は0〜1で端が平ら", (() => {
    if (api.ringSmoothstep(0) !== 0 || api.ringSmoothstep(1) !== 1) return false;
    if (api.ringSmoothstep(-5) !== 0 || api.ringSmoothstep(9) !== 1) return false;
    return Math.abs(api.ringSmoothstep(0.5) - 0.5) < 1e-12;
  })());
  // ランプの3要素(明度差・彩度倍率・色相ずれ)は**単調**。芯(明るさの山)を置かない。
  // 単調でないと帯の途中に境目が生まれる。
  // 【測り方】機能色(緑/橙/赤)は sRGB 色域の縁に近く、明るくすると丸め込まれて
  // 設計した振れが目減りする(緑の色相は -16° の設計に対し実測 -9.6°)。そこで単調性と
  // 振れ幅は、色域の**内側に十分入った色**で測る。ここで使う rgb(48,72,240) は
  // ランプ全域で 1〜254 の内側に収まり(=丸め込みが起きない)、3要素の設計値が
  // そのまま取り出せる。取り出した値を仕様と突き合わせるので定数の言い換えにならない。
  {
    const lchOf = (rgb) => api.oklabToOklch(api.rgbToOklab(rgb));
    const PROBE = [48, 72, 240];
    let clipped = false, backL = 0, backC = 0, backH = 0;
    const seqL = [], seqC = [], seqH = [];
    let prev = lchOf(api.ringRampRGB(PROBE, 0));
    const first = prev; let last = prev;
    seqL.push(first[0]); seqC.push(first[1]); seqH.push(first[2]);
    for (let s = 0.5; s <= api.RING_RAMP_REF * 2; s += 0.5) {
      const rgb = api.ringRampRGB(PROBE, s);
      if (rgb.some((v) => v <= 1 || v >= 254)) clipped = true;
      const cur = lchOf(rgb);
      backL = Math.max(backL, prev[0] - cur[0]);
      backC = Math.max(backC, cur[1] - prev[1]);
      backH = Math.max(backH, cur[2] - prev[2]);
      seqL.push(cur[0]); seqC.push(cur[1]); seqH.push(cur[2]);
      prev = cur; last = cur;
    }
    check("測定用の色は色域の内側に収まる(丸め込みが起きない)", !clipped);
    // ------------------------------------------------------------------
    // 【単調性の測り方を2段に分ける】
    //
    // (i) 隣接ストップ間の折り返し(急な段差を見る)。整数RGBへの量子化そのもので
    //     L=0.00036 / C=0.00127 / H=0.128° の見かけの逆行が出るので、許容はその倍。
    //     この指標は**なだらかな山には鈍い**。dH に振幅13°の山を足しても、
    //     隣接差では 0.298°(量子化の 0.128° と同程度)にしかならず素通りする。
    //     以前ここの色相の許容 0.3° は、その素通りする側にぎりぎり合わせてあった。
    //
    // (ii) 累積の折り返し(running extremum からの戻り)を、移動平均(±8サンプル
    //      =±4 viewBox単位)で量子化ノイズを均してから測る。移動平均は単調な列の
    //      単調性を壊さないので、**設計が単調なら 0**。実測でも L=0 / C=0.000013 / H=0。
    //      許容はそこから素直に置ける。
    //
    // 【感度をそろえた確認(dX に振幅Aの山 A(1-(2e-1)²) を足して掃引した実測)】
    //      明度: 数式上の単調性の境目 A=0.042 → 許容 0.0003 は A=0.04 で落ちる
    //      彩度: 境目 A=0.075                → 許容 0.0002 は A=0.08 で落ちる
    //      色相: 境目 A=4                    → 許容 0.002  は A=4    で落ちる
    //      3つとも「数式上、単調でなくなった瞬間」で落ちる。色相だけ緩い状態を解消した。
    // ------------------------------------------------------------------
    const smooth = (a, w = 8) => a.map((_, i) => {
      let t = 0, n = 0;
      for (let k = Math.max(0, i - w + 1); k <= Math.min(a.length - 1, i + w - 1); k++) { t += a[k]; n++; }
      return t / n;
    });
    const drawback = (a, up) => {
      let ext = a[0], worst = 0;
      for (const v of a) {
        if (up) { ext = Math.max(ext, v); worst = Math.max(worst, ext - v); }
        else { ext = Math.min(ext, v); worst = Math.max(worst, v - ext); }
      }
      return worst;
    };
    const cumL = drawback(smooth(seqL), true);
    const cumC = drawback(smooth(seqC), false);
    const cumH = drawback(smooth(seqH), false);
    check("ランプの明度は単調に増える(累積の折り返し / 山 A=0.04 で落ちる厳しさ)",
      cumL <= 0.0003, `累積の逆行=${cumL.toFixed(6)}`);
    check("ランプの彩度は単調に減る(累積の折り返し / 山 A=0.08 で落ちる厳しさ)",
      cumC <= 0.0002, `累積の逆行=${cumC.toFixed(6)}`);
    check("ランプの色相は単調に動く(累積の折り返し / 山 A=4 で落ちる厳しさ)",
      cumH <= 0.002, `累積の逆行=${cumH.toFixed(4)}°`);
    console.log(`  ランプの累積の折り返し(移動平均後): L=${cumL.toFixed(6)} / C=${cumC.toFixed(6)} / H=${cumH.toFixed(4)}°`);
    // (i) 隣接ストップ間。なだらかな山には鈍いが、**鋭い段差**はこちらでしか捕まらない
    // (移動平均は幅の狭い山を均してしまうため)。2つで役割を分けている。
    check("隣接ストップ間で明度が折り返さない(急な段差が無い)", backL <= 0.001, `最大の逆行=${backL.toFixed(6)}`);
    check("隣接ストップ間で彩度が折り返さない(急な段差が無い)", backC <= 0.0026, `最大の逆行=${backC.toFixed(6)}`);
    check("隣接ストップ間で色相が折り返さない(急な段差が無い)", backH <= 0.3, `最大の逆行=${backH.toFixed(4)}°`);
    // 取り出した振れ幅が仕様(dL=+0.105/-0.062 / cMul=1.12→0.30減 / dH=-9〜+7)と一致する
    check("明度の振れ幅は 0.105+0.062=0.167", Math.abs((last[0] - first[0]) - 0.167) < 0.002,
      `実測 ${(last[0] - first[0]).toFixed(4)}`);
    check("彩度の倍率は 1.12→0.82(比 0.732)", Math.abs(last[1] / first[1] - 0.82 / 1.12) < 0.005,
      `実測 ${(last[1] / first[1]).toFixed(4)}`);
    check("色相の振れ幅は 7-(-9)=16°", Math.abs((first[2] - last[2]) - 16) < 0.3,
      `実測 ${(first[2] - last[2]).toFixed(3)}°`);
    console.log(`  ランプの実測(丸め込みの無い色): ΔL=${(last[0] - first[0]).toFixed(4)} / C比=${(last[1] / first[1]).toFixed(4)} / ΔH=${(first[2] - last[2]).toFixed(2)}°`);
  }
  {
    const lchOf = (rgb) => api.oklabToOklch(api.rgbToOklab(rgb));
    // 【この区画で言えること・言えないこと】
    // 機能色(緑/橙/赤)は sRGB 色域の縁に近く、ランプ全域で成分が 0/255 に張り付く。
    // 丸め込みで色相が動くため、**この3色では単調性そのものを主張できない**
    // (実測: 累積の折り返しは緑 0.81° / 橙 5.13° / 赤 0.88°。これは丸め込みの産物)。
    // ここで見るのは「隣接ストップ間に急な段差が無いこと」と「振れの向きと量」だけ。
    // 単調性の本体は上の PROBE(丸め込みの起きない色)の区画が担う。
    // 許容値は実測した「量子化だけで生じる最大の隣接差」から決めた(L=0 / C=0.0013 / H=0.55°)。
    const TOL_L = 0.0005, TOL_C = 0.003, TOL_H = 1.2;
    for (const base of [GREEN, ORANGE, RED]) {
      let backL = 0, backC = 0, backH = 0;
      let prev = lchOf(api.ringRampRGB(base, 0));
      const first = prev;
      let last = prev;
      for (let s = 0.5; s <= api.RING_RAMP_REF * 2; s += 0.5) {
        const cur = lchOf(api.ringRampRGB(base, s));
        backL = Math.max(backL, prev[0] - cur[0]);
        backC = Math.max(backC, cur[1] - prev[1]);
        backH = Math.max(backH, cur[2] - prev[2]);
        prev = cur; last = cur;
      }
      check(`根元ほど明るく、隣接ストップ間で明度が折り返さない(base=${base.join(",")})`,
        backL <= TOL_L && last[0] - first[0] > 0.10,
        `先端L=${first[0].toFixed(4)} → 根元L=${last[0].toFixed(4)} / 最大の逆行=${backL.toFixed(5)}`);
      check(`先端ほど濃く、隣接ストップ間で彩度が折り返さない(base=${base.join(",")})`,
        backC <= TOL_C && first[1] - last[1] > 0.015,
        `先端C=${first[1].toFixed(4)} → 根元C=${last[1].toFixed(4)} / 最大の逆行=${backC.toFixed(5)}`);
      check(`色相が先端から根元へ4°以上動き、隣接ストップ間で折り返さない(base=${base.join(",")})`,
        backH <= TOL_H && first[2] - last[2] > 4,
        `先端H=${first[2].toFixed(2)} → 根元H=${last[2].toFixed(2)} / 最大の逆行=${backH.toFixed(3)}`);
    }
  }
  // **帯の長さで正規化していない**ことの検査:
  // 長さの違う2本の帯で、先端から同じ弧長だけ入った点の色が一致すること。
  // 「帯の長さで割る」実装に戻すと、短い帯の色が先に飽和して一致しなくなる。
  {
    let ok = true, detail = "";
    for (const s of [0, 5, 12, 24, 40]) {
      const a = api.ringRampRGB(GREEN, s).join(",");
      const b = api.ringRampRGB(GREEN, s).join(",");
      if (a !== b) { ok = false; break; }
      // 実際の帯(±8¢ と ±24¢)のストップ列から、先端から s に最も近いストップの色を引く
      const colorAt = (cents) => {
        const deg = (cents / api.RING_MAX_CENTS) * api.RING_SWEEP_DEG;
        const stops = api.ringGradientStops(0, deg);
        let best = stops[0];
        for (const st of stops) if (Math.abs(st.s - s) < Math.abs(best.s - s)) best = st;
        return { s: best.s, c: api.ringRampRGB(GREEN, best.s) };
      };
      const short = colorAt(8), long = colorAt(24);
      // 同じ弧長 s の色は帯の長さに依存しない。ストップの刻みぶんの差だけ許す。
      const cShort = api.ringRampRGB(GREEN, short.s).join(",");
      const cShortByS = api.ringRampRGB(GREEN, short.s).join(",");
      if (cShort !== cShortByS) { ok = false; detail = "不定"; break; }
      const dLong = api.ringRampRGB(GREEN, long.s);
      const dShort = api.ringRampRGB(GREEN, short.s);
      if (Math.abs(short.s - long.s) < 0.6 && dShort.join(",") !== dLong.join(",")) {
        ok = false; detail = `s=${s}: 短い帯=${dShort.join(",")} / 長い帯=${dLong.join(",")}`;
      }
    }
    check("色は先端からの絶対弧長だけで決まる(帯の長さに依存しない)", ok, detail);
  }
  // 上の検査だけだと「ringRampRGB が s しか受け取らない」ことの言い換えになりかねないので、
  // **描画で使う色列そのもの**を比べる: ±8¢ と ±24¢ の帯で、先端から重なる範囲の
  // 色が一致すること。帯の長さで正規化すると、この重なりが崩れる。
  {
    const rampAt = (cents) => {
      const deg = (cents / api.RING_MAX_CENTS) * api.RING_SWEEP_DEG;
      return api.ringGradientStops(0, deg).map((st) => ({ s: st.s, c: api.ringRampRGB(GREEN, st.s).join(",") }));
    };
    const shortR = rampAt(8), longR = rampAt(24);
    let maxDiff = 0;
    for (const st of shortR) {
      // 長い帯の中で同じ弧長にあたる色(線形補間せず最近傍)
      let best = longR[0];
      for (const q of longR) if (Math.abs(q.s - st.s) < Math.abs(best.s - st.s)) best = q;
      const a = st.c.split(",").map(Number), b = best.c.split(",").map(Number);
      // 弧長の差ぶんは色が違って当然なので、弧長差が小さいものだけ比べる
      if (Math.abs(best.s - st.s) <= 0.6) {
        maxDiff = Math.max(maxDiff, Math.max(...[0, 1, 2].map((k) => Math.abs(a[k] - b[k]))));
      }
    }
    check("±8¢の帯と±24¢の帯は、先端から同じ弧長の位置で同じ色になる", maxDiff <= 2, `最大差=${maxDiff}`);
  }
  // 隣接ストップ間の明度差(断層の指標)。ストップは角度で等分するので、帯が長いほど
  // 1ストップあたりの弧長が伸びて差は大きくなる。実用域(±10¢)で十分小さいことを見る。
  {
    const dLOf = (cents) => {
      const deg = (cents / api.RING_MAX_CENTS) * api.RING_SWEEP_DEG;
      const stops = api.ringGradientStops(0, deg);
      const base = api.pitchBarColorRGB(cents);
      let prev = null, worst = 0;
      for (const st of stops) {
        const L = api.oklabToOklch(api.rgbToOklab(api.ringRampRGB(base, st.s)))[0];
        if (prev !== null) worst = Math.max(worst, Math.abs(L - prev));
        prev = L;
      }
      return worst;
    };
    const measured = [2, 5, 8, 10, 24, 50].map((c) => [c, dLOf(c)]);
    const practical = Math.max(...measured.filter(([c]) => c <= 10).map(([, d]) => d));
    const all = Math.max(...measured.map(([, d]) => d));
    check("実用域(±10¢)の帯で隣接ストップ間の明度差が 0.012 未満(断層が出ない)", practical < 0.012,
      `最大 ΔL=${practical.toFixed(5)}`);
    check("最も長い帯(±50¢)でも隣接ストップ間の明度差が 0.04 未満", all < 0.04, `最大 ΔL=${all.toFixed(5)}`);
    console.log(`  隣接ストップ間の最大明度差: ${measured.map(([c, d]) => `${c}¢:${d.toFixed(5)}`).join(" / ")}`);
    // 帯の根元・先端の色も記録に残す(報告用)。
    console.log(`  帯の色(根元→先端): ${[2, 5, 8, 10, 24].map((c) => {
      const deg = (c / api.RING_MAX_CENTS) * api.RING_SWEEP_DEG;
      const st = api.ringGradientStops(0, deg);
      const base = api.pitchBarColorRGB(c);
      const a = api.ringRampRGB(base, st[0].s), b = api.ringRampRGB(base, st[st.length - 1].s);
      return `${c}¢ rgb(${a.join(",")})→rgb(${b.join(",")})`;
    }).join(" / ")}`);
  }

  // ------------------------------------------------------------------
  // B-2. ストップの位置 — 弧を弦へ**射影**する(等間隔に戻すと落ちる)。
  // ------------------------------------------------------------------
  {
    const deg = api.RING_SWEEP_DEG; // 110°の帯(最長)
    const stops = api.ringGradientStops(0, deg);
    check("ストップ数はグラデーションでも30", stops.length === api.RING_RAMP_STOPS);
    check("offset は 0 から 1 まで", Math.abs(stops[0].offset) < 1e-12 && Math.abs(stops[stops.length - 1].offset - 1) < 1e-12,
      `${stops[0].offset} … ${stops[stops.length - 1].offset}`);
    check("offset は非減少", stops.every((st, i) => i === 0 || st.offset >= stops[i - 1].offset - 1e-12));
    check("先端の弧長は0・根元の弧長は帯の全長", (() => {
      const total = (deg * Math.PI / 180) * api.RING_R;
      return Math.abs(stops[stops.length - 1].s) < 1e-9 && Math.abs(stops[0].s - total) < 1e-9;
    })(), `根元s=${stops[0].s.toFixed(3)}`);
    // 射影していることの実証: 等間隔(i/29)とは実際にずれる。
    let maxDev = 0;
    for (let i = 0; i < stops.length; i++) {
      maxDev = Math.max(maxDev, Math.abs(stops[i].offset - i / (stops.length - 1)));
    }
    check("110°の帯で offset は等間隔から明確にずれる(=弦へ射影している)", maxDev > 0.01,
      `等間隔との最大差=${maxDev.toFixed(4)}`);
    // 射影の正しさ: 各ストップの点が、弦の上でその offset の位置に落ちること。
    {
      const [x0, y0] = api.ringPoint(0, api.RING_R, api.RING_CX, api.RING_CY);
      const [x1, y1] = api.ringPoint(deg, api.RING_R, api.RING_CX, api.RING_CY);
      let ok = true, worst = 0;
      for (let i = 0; i < stops.length; i++) {
        const phi = (deg * i) / (stops.length - 1);
        const [px, py] = api.ringPoint(phi, api.RING_R, api.RING_CX, api.RING_CY);
        // 弦上の offset 位置と、弧上の点との差は弦に**垂直**であること(=射影になっている)
        const qx = x0 + (x1 - x0) * stops[i].offset, qy = y0 + (y1 - y0) * stops[i].offset;
        const dot = (px - qx) * (x1 - x0) + (py - qy) * (y1 - y0);
        worst = Math.max(worst, Math.abs(dot));
        if (Math.abs(dot) > 1e-6) ok = false;
      }
      check("各ストップは弧上の点を弦へ垂直に落とした位置にある", ok, `最大内積=${worst.toExponential(2)}`);
    }
    check("負の角度(低い側)でも offset は非減少で 0→1", (() => {
      const s2 = api.ringGradientStops(0, -api.RING_SWEEP_DEG);
      return Math.abs(s2[0].offset) < 1e-12 && Math.abs(s2[s2.length - 1].offset - 1) < 1e-12
        && s2.every((st, i) => i === 0 || st.offset >= s2[i - 1].offset - 1e-12);
    })());
    check("長さ0の弧でも例外を投げない", (() => {
      const s0 = api.ringGradientStops(0, 0);
      return s0.length === api.RING_RAMP_STOPS && s0.every((st) => st.offset === 0 && st.s === 0);
    })());
  }

  // ------------------------------------------------------------------
  // B-3. 描画側(JSX)の契約 — linecap は butt / 帯に stop-opacity を書かない /
  //      先端の点は無い。
  // ------------------------------------------------------------------
  check("帯に丸端(linecap round)を使っていない", !/strokeLinecap="round"/.test(
    (ringCode.match(/<path[\s\S]*?\/>/g) || []).join("\n")),
    (ringCode.match(/<path[^>]*strokeLinecap="[a-z]+"/g) || []).join(" | "));
  check("帯とグラデーションの path はすべて linecap=butt",
    (ringCode.match(/<path[\s\S]*?\/>/g) || []).filter((t) => /strokeWidth=\{SW\}/.test(t))
      .every((t) => /strokeLinecap="butt"/.test(t)),
    (ringCode.match(/<path[\s\S]*?\/>/g) || []).filter((t) => /strokeWidth=\{SW\}/.test(t)).length + "本");
  {
    const linear = ringCode.match(/<linearGradient[\s\S]*?<\/linearGradient>/g) || [];
    // ソース上は2箇所(ズレの帯 + 走りの弧)。走りのほうは runGradIds(左右2本)を map するので
    // 実際に描かれる linearGradient は3つになる。
    check("linearGradient はソース上2箇所(ズレの帯 + 走りの左右をmapする1箇所)", linear.length === 2, `${linear.length}個`);
    check("走りのグラデーションは左右2本ぶん作られる",
      /const runGradIds = \[`ring-run-l-\$\{uid\}`, `ring-run-r-\$\{uid\}`\];/.test(codeOf(src))
      && /runGradIds\.map\(\(gid, k\) => \(\s*<linearGradient/.test(ringCode));
    check("帯のグラデーションに stop-opacity を1つも書いていない",
      linear.every((blk) => !/stopOpacity|stop-opacity/.test(blk)));
    check("帯の path に不透明度を指定していない(属性でもstyleでも)",
      !(ringCode.match(/<path[\s\S]*?\/>/g) || []).some((t) => /opacity/i.test(t)));
    // rAF が書き換えるのは帯側では offset と stop-color だけ。stop-opacity を書くのは
    // 光の1箇所のみ(走りの帯に透明度が入ると根元から下地が透ける)。
    check("rAF が stop-opacity を書くのは光の1箇所だけ",
      (ringCode.match(/setAttribute\("stop-opacity"/g) || []).length === 1,
      `${(ringCode.match(/setAttribute\("stop-opacity"/g) || []).length}箇所`);
    check("走りのストップに書くのは offset と stop-color だけ",
      /el\.setAttribute\("offset", list\[i\]\.offset\.toFixed\(5\)\);/.test(ringCode)
      && /el\.setAttribute\("stop-color", `rgb\(\$\{c\[0\]\},\$\{c\[1\]\},\$\{c\[2\]\}\)`\);/.test(ringCode));
    // ズレの帯のグラデーションの軸は「根元(12時)→先端(現在位置)」の弦。
    check("ズレの帯のグラデーションの軸は根元→先端の弦",
      /x1=\{sx\.toFixed\(2\)\} y1=\{sy\.toFixed\(2\)\} x2=\{mx\.toFixed\(2\)\} y2=\{my\.toFixed\(2\)\}/.test(ringCode)
      && /const \[sx, sy\] = ringPoint\(0, R, CX, CY\);/.test(ringCode)
      && /const \[mx, my\] = ringPoint\(deg, R, CX, CY\);/.test(ringCode));
    // 到達している間はズレの帯を描かない(±1¢ の帯は線幅より短く、全周の帯と重なって
    // 12時に継ぎ目として見えるため)。走りが全周を覆うので情報も失われない。
    check("到達している間はズレの帯を描かない",
      /const arcD = \(inTune \|\| Math\.abs\(deg\) < 1\) \? "" : ringArcD\(0, deg\);/.test(ringCode));
    check("グラデーションはユーザー座標系(弦を軸にする)",
      linear.every((blk) => /gradientUnits="userSpaceOnUse"/.test(blk)));
  }
  check("帯の先端に点(circle)を置いていない",
    !/RING_PITCH_DOT_R/.test(codeOf(src)) && !/<circle cx=\{mx\}/.test(ringCode));
  // 環の中(SVG)では ficus-breathe(要素全体の透明度アニメ)を使わない。
  // 到達は走り＋外側の光で返す。透明度で環そのものを薄くすると下地が透ける。
  check("環のSVGの中で ficus-breathe を使っていない", (() => {
    const a = ringCode.indexOf("<svg"), b = ringCode.indexOf("</svg>");
    return a >= 0 && b > a && !/ficus-breathe/.test(ringCode.slice(a, b));
  })());

  // ------------------------------------------------------------------
  // B-4. 描画の配線(JSX)。
  //
  // 【なぜ綴りで縛るのか】このハーネスは関数と定数を抽出して評価する方式なので、
  // **描画側を壊しても純関数のテストは緑のまま通る**(LOOP.md の既知の弱点 F-19/F-24)。
  // 審査で「グラデーションを stroke から外す」「帯を描く条件を false にする」
  // 「ストップの色を先端一色にする」等がすべて素通りした。ここはその穴を塞ぐ区画で、
  // **見た目を決めている配線を1本ずつ名指しする**。値の正しさは他の区画が見ている。
  // ------------------------------------------------------------------
  {
    const svg = ringCode.slice(ringCode.indexOf("<svg"), ringCode.indexOf("</svg>"));
    const flat = svg.replace(/\s*\n\s*/g, " ");
    // (a) 帯・走りの色は必ずグラデーションから引く。単色に置き換えるとランプが死ぬ。
    check("ズレの帯の stroke はズレの帯のグラデーション",
      /<path d=\{arcD\} fill="none" stroke=\{`url\(#\$\{barGradId\}\)`\} strokeWidth=\{SW\} strokeLinecap="butt" \/>/.test(flat),
      (flat.match(/<path d=\{arcD\}[^/]*\/>/) || [""])[0].slice(0, 120));
    check("走りの弧の stroke は走りのグラデーション(左右それぞれの id)",
      /d="" fill="none" stroke=\{`url\(#\$\{gid\}\)`\} strokeWidth=\{SW\} strokeLinecap="butt"/.test(flat));
    check("stroke に単色を直接入れている path が無い(必ず url(#…) を通す)", (() => {
      const paths = flat.match(/<path[\s\S]*?\/>/g) || [];
      return paths.length > 0 && paths.every((t) => !/stroke=/.test(t) || /stroke=\{`url\(#/.test(t));
    })(), (flat.match(/<path[\s\S]*?\/>/g) || []).map((t) => (/stroke=\{[^}]*\}/.exec(t) || [""])[0]).join(" | "));
    check("ズレの帯のストップの色は各ストップの弧長 s から引く(先端一色にしない)",
      /const c = ringRampRGB\(\[r, g, b\], st\.s\);/.test(ringCode));
    check("ズレの帯のストップは barStops をそのまま並べる",
      /\{barStops\.map\(\(st, i\) => \{/.test(ringCode)
      && /const barStops = ringGradientStops\(0, deg\);/.test(ringCode));
    // (b) 描画の条件。false に潰すと帯そのものが消える。
    check("ズレの帯は「音が鳴っていて arcD がある」ときに描く",
      /\{sounding && arcD && \(/.test(ringCode));
    check("拍の要素は getBeatPhase が渡されたときだけ描く", /\{getBeatPhase && \(/.test(ringCode));
    // (c) 半径。役割ごとに違う半径を使い分けているので、取り違えると二役が崩れる。
    check("環のトラックの半径は R(=RING_R)",
      /<circle cx=\{CX\} cy=\{CY\} r=\{R\} fill="none" strokeWidth=\{SW\} style=\{\{ stroke: "var\(--c-line\)" \}\} \/>/.test(flat));
    check("拍の点は RING_BEAT_DOT_ORBIT_R の上に並べる(環のトラックに乗せない)",
      /ringPoint\(ringBeatDotDeg\(i, dotCount\), RING_BEAT_DOT_ORBIT_R, CX, CY\)/.test(ringCode));
    // F-51 で「停止後にゆっくり中央へ戻る」を足したため、角度はいったん pendDeg に受ける。
    // 軌道半径(RING_PEND_R)と、**動作中の角度が ringPendDeg(位相) そのものであること**は
    // 分けて縛る(戻りの実装が動作中の角度を書き換えたら落ちる)。
    check("錘は RING_PEND_R の軌道を回る(環のトラックに乗せない)",
      /ringPoint\(pendDeg, RING_PEND_R, RING_CX, RING_CY\)/.test(ringCode));
    check("動作中の錘の角度は ringPendDeg(位相)そのもの",
      /pendDeg = ringPendDeg\(phase\);/.test(ringCode));
    check("錘と輪の初期位置も RING_PEND_R(12時)",
      (flat.match(/cx=\{CX\} cy=\{CY - RING_PEND_R\}/g) || []).length === 2);
    // (d) 線幅。SW 以外を混ぜると帯と走りの太さが揃わない。
    check("SW で描く path は帯と走りの2本だけで、太さはどちらも SW ちょうど", (() => {
      const paths = flat.match(/<path[\s\S]*?\/>/g) || [];
      const sw = paths.filter((t) => /strokeWidth=\{SW\}/.test(t));
      const other = paths.filter((t) => /strokeWidth=/.test(t) && !/strokeWidth=\{SW\}/.test(t));
      return sw.length === 2 && other.length === 0;
    })(), (flat.match(/<path[\s\S]*?\/>/g) || []).map((t) => (/strokeWidth=\{[^}]*\}/.exec(t) || ["(線幅なし)"])[0]).join(" | "));
    // (e) 重ね順。光は一番奥、拍は一番手前。入れ替えると光が帯を覆う/拍が帯に隠れる。
    check("重ね順は 光 → トラック → 走り → ズレの帯 → 拍", (() => {
      const order = [
        flat.indexOf("fill={`url(#${glowGradId})`}"),
        flat.indexOf('r={R} fill="none" strokeWidth={SW}'),
        flat.indexOf('d="" fill="none" stroke={`url(#${gid})`}'),
        flat.indexOf("<path d={arcD}"),
        flat.indexOf("{getBeatPhase && ("),
      ];
      return order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]));
    })());
    // 12時の基準マーカー(紺の縦線)は本人指示で撤去した。帯の根元そのものが0¢を示すので、
    // 印を別に置く理由が無い。**復活させないこと**を綴りではなく要素の有無で見る。
    // `<line` は `<linearGradient` の接頭辞でもあるので境界を付ける(最初これで空振りした)
    check("12時の基準マーカーを復活させていない(環に <line> は無い)",
      !/<line[\s/>]/.test(flat.slice(flat.indexOf("<svg"), flat.indexOf("{getBeatPhase && ("))),
      (flat.match(/<line[\s/>][\s\S]{0,60}/g) || []).join(" | ") || "");
  }
  // (f) 到達の判定は1箇所だけ。rAF に渡す値を別式にすり替える変異が通っていた。
  check("到達の判定は ringCode 内で1箇所だけ(閾値の二重定義が無い)",
    (ringCode.match(/Math\.abs\(exact\)/g) || []).length === 1,
    `Math.abs(exact) が ${(ringCode.match(/Math\.abs\(exact\)/g) || []).length}箇所`);
  check("rAF に渡す到達判定は const inTune をそのまま渡す(別式に置き換えない)",
    /liveRef\.current = \{ inTune, base: \[r, g, b\] \};/.test(ringCode));

  // ------------------------------------------------------------------
  // C. 合格判定は ±1¢。
  // ------------------------------------------------------------------
  check("RING_IN_TUNE_CENTS は 1", api.RING_IN_TUNE_CENTS === 1, String(api.RING_IN_TUNE_CENTS));
  check("判定に使う定数は RING_IN_TUNE_CENTS だけ(閾値の直書きが無い)",
    /const inTune = sounding && Math\.abs\(exact\) <= RING_IN_TUNE_CENTS;/.test(ringCode));

  // ------------------------------------------------------------------
  // D-1. 走り — 640ms・ease-out cubic・12時から両サイドへ対称。
  // ------------------------------------------------------------------
  check("RING_RUN_MS は 640", api.RING_RUN_MS === 640, String(api.RING_RUN_MS));
  check("イージングは ease-out cubic", (() => {
    for (let p = 0; p <= 1.0001; p += 0.001) {
      if (Math.abs(api.ringRunEase(p) - (1 - Math.pow(1 - p, 3))) > 1e-12) return false;
    }
    return true;
  })());
  check("イージングは linear ではない(中間で明確に先行する)",
    api.ringRunEase(0.5) - 0.5 > 0.3, String(api.ringRunEase(0.5)));
  check("イージングは0で0・1で1、単調増加", (() => {
    if (api.ringRunEase(0) !== 0 || api.ringRunEase(1) !== 1) return false;
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.001) { const v = api.ringRunEase(p); if (v < prev) return false; prev = v; }
    return api.ringRunEase(-1) === 0 && api.ringRunEase(2) === 1;
  })());
  // 走行中の角度。仕様書にある試作の実測表(60ms=41.4° / 180ms=104.1° / 360ms=157.5°)は
  // **720msの試作**で採ったもの。同じイージングなら 720ms を入れた式が表を再現する。
  // 本実装の 640ms では比例して速くなる(表より大きい角度になる)。
  {
    const proto = [[60, 41.4], [180, 104.1], [360, 157.5], [720, 180]];
    let ok = true;
    const protoGot = [];
    for (const [ms, degExp] of proto) {
      const d = 180 * api.ringRunEase(ms / 720);
      protoGot.push(`${ms}ms:${d.toFixed(1)}`);
      if (Math.abs(d - degExp) > 0.06) ok = false;
    }
    check("イージングが試作(720ms)の実測表を再現する(60/180/360/720ms)", ok, protoGot.join(" "));
    const got = [60, 180, 360, 640].map((ms) => `${ms}ms:${(180 * api.ringRunEase(ms / api.RING_RUN_MS)).toFixed(1)}°`);
    check("640msでは試作(720ms)より速く進む(同じ時刻で角度が大きい)",
      [60, 180, 360].every((ms) => 180 * api.ringRunEase(ms / 640) > 180 * api.ringRunEase(ms / 720)));
    console.log(`  走りの角度(640ms・左右とも): ${got.join(" / ")}`);
    console.log(`  同じ式に720msを入れた値(試作の実測表と照合): ${protoGot.join(" / ")}`);
  }
  // ------------------------------------------------------------------
  // D-1b. 走りの終端 — ±180.0000° ちょうどで閉じること。
  //
  // 【過去の欠陥】rAF は書き換えの間引きに p.toFixed(4) をキーとして使うが、以前は
  // キーだけを丸め、描画には量子化前の p を渡していた。toFixed は四捨五入なので
  // t=617ms(p=0.99996)でキーが "1.0000" に丸まり、以降キーが変わらず**最終フレームが
  // 書かれなかった**。終端が ±179.9916° で止まり、6時に 0.044 CSS px の隙間が残る
  // (審査で8倍解像度のラスタから1画素検出された)。
  // ringRunQuantP で切り捨て量子化し、キーの値と描画に使う値を一致させて直した。
  // ------------------------------------------------------------------
  check("走り切る前のどの時刻でも量子化後の進捗は1にならない(0.01ms刻み)", (() => {
    for (let ms = 0; ms <= api.RING_RUN_MS - 0.01; ms += 0.01) {
      if (api.ringRunQuantP(api.ringRunProgress(0, ms)) >= 1) return false;
    }
    return true;
  })());
  // 旧実装が実際に止まっていた時刻。toFixed(4) で丸めると t=617ms でキーが "1.0000" になった。
  check("t=617ms(旧実装が終端を書かなくなった時刻)でも進捗はまだ1未満", (() => {
    const q = api.ringRunQuantP(api.ringRunProgress(0, 617));
    const old = api.ringRunEase(api.ringRunProgress(0, 617));
    return q < 1 && old.toFixed(4) === "1.0000";
  })(), `量子化後=${api.ringRunQuantP(api.ringRunProgress(0, 617))} / 旧キー="${api.ringRunEase(api.ringRunProgress(0, 617)).toFixed(4)}" / 旧実装の広がり=${(180 * api.ringRunEase(api.ringRunProgress(0, 617))).toFixed(4)}°`);
  check("進捗が1になったら量子化後もちょうど1", api.ringRunQuantP(1) === 1 && api.ringRunQuantP(2) === 1);
  check("量子化は切り捨て(イージング値を超えない・差は 1e-4 未満)", (() => {
    for (let raw = 0; raw <= 1.0001; raw += 0.0005) {
      const q = api.ringRunQuantP(raw), e = api.ringRunEase(raw);
      if (q > e + 1e-12) return false;
      if (e - q >= 1e-4) return false;
    }
    return true;
  })());
  // 実際の rAF ループと同じ間引き(キー)を回して、**最後に DOM へ書かれた広がり**を取る。
  {
    const frameSpread = (ms) => 180 * api.ringRunQuantP(api.ringRunProgress(0, ms));
    let lastKey = "", lastSpread = null, lastMs = null;
    for (let ms = 0; ms <= api.RING_RUN_MS + 200; ms += 0.5) {
      const p = api.ringRunQuantP(api.ringRunProgress(0, ms));
      const key = p <= 0 ? "off" : `${p.toFixed(4)}|22,163,74`;
      if (key !== lastKey) { lastKey = key; lastSpread = 180 * p; lastMs = ms; }
    }
    check("最後に書き換えられるフレームの広がりはちょうど180.0000°", lastSpread === 180,
      `${lastSpread}° @${lastMs}ms`);
    check("その最終書き換えは走り切った時刻(RING_RUN_MS)で起きる", lastMs === api.RING_RUN_MS,
      `${lastMs}ms / RING_RUN_MS=${api.RING_RUN_MS}`);
    const [lx, ly] = api.ringPoint(-lastSpread, api.RING_R, api.RING_CX, api.RING_CY);
    const [rx, ry] = api.ringPoint(lastSpread, api.RING_R, api.RING_CX, api.RING_CY);
    check("左右の弧の先端は6時ちょうどで重なる(隙間0)",
      Math.abs(lx - rx) < 1e-9 && Math.abs(ly - ry) < 1e-9
      && Math.abs(lx - api.RING_CX) < 1e-9 && Math.abs(ly - (api.RING_CY + api.RING_R)) < 1e-9,
      `左(${lx.toFixed(6)},${ly.toFixed(6)}) / 右(${rx.toFixed(6)},${ry.toFixed(6)})`);
    // 隙間を CSS px でも出しておく(実寸 = viewBox × RING_D_FULL/RING_VB)。
    const gapPx = Math.hypot(lx - rx, ly - ry) * (api.RING_D_FULL / api.RING_VB);
    // 旧実装(179.9916°)では 0.044 CSS px の隙間が残り、8倍解像度のラスタで1画素検出された。
    const gapOld = Math.hypot(
      ...(() => {
        const s = 180 * api.ringRunEase(api.ringRunProgress(0, 617));
        const [ax, ay] = api.ringPoint(-s, api.RING_R, api.RING_CX, api.RING_CY);
        const [bx, by] = api.ringPoint(s, api.RING_R, api.RING_CX, api.RING_CY);
        return [ax - bx, ay - by];
      })()
    ) * (api.RING_D_FULL / api.RING_VB);
    check("6時の隙間は実質0 CSS px(浮動小数の誤差 1e-9 px 未満)", gapPx < 1e-9, `${gapPx.toExponential(2)} CSS px`);
    check("旧実装(終端179.9916°)なら隙間が残る = この検査は空振りではない",
      gapOld > 0.03 && gapOld < 0.06, `旧実装の隙間=${gapOld.toFixed(4)} CSS px`);
    console.log(`  走りの終端: ${lastSpread.toFixed(4)}° @${lastMs}ms / 6時の隙間 ${gapPx} CSS px`);
    check("走り切る前は閉じていない(RING_RUN_MS の1ms手前で360°未満)",
      frameSpread(api.RING_RUN_MS - 1) * 2 < 360, `${(frameSpread(api.RING_RUN_MS - 1) * 2).toFixed(4)}°`);
    check("走り始めから RING_RUN_MS 後にちょうど全周(360°)が閉じる",
      frameSpread(api.RING_RUN_MS) * 2 === 360 && frameSpread(api.RING_RUN_MS + 500) * 2 === 360,
      `RING_RUN_MS=${api.RING_RUN_MS}ms で ${frameSpread(api.RING_RUN_MS) * 2}°`);
  }
  // 左右対称: 左弧は -180p→0、右弧は +180p→0。同じ p で角度の絶対値が等しい。
  check("左右の弧は常に対称(角度・弧長・色すべて)", (() => {
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const spread = 180 * api.ringRunEase(p);
      if (spread <= 0) continue;
      const l = api.ringGradientStops(-spread, 0), r = api.ringGradientStops(spread, 0);
      for (let i = 0; i < l.length; i++) {
        if (Math.abs(l[i].offset - r[i].offset) > 1e-9) return false;
        if (Math.abs(l[i].s - r[i].s) > 1e-9) return false;
      }
      // 端点も左右対称(x が中心から等距離・y が同じ)
      const [lx, ly] = api.ringPoint(-spread, api.RING_R, api.RING_CX, api.RING_CY);
      const [rx, ry] = api.ringPoint(spread, api.RING_R, api.RING_CX, api.RING_CY);
      if (Math.abs((lx - api.RING_CX) + (rx - api.RING_CX)) > 1e-9) return false;
      if (Math.abs(ly - ry) > 1e-9) return false;
    }
    return true;
  })());
  // 【名乗りに注意】これは ringPoint(±180) が真下を指すことの確認だけで、走りには触れない。
  // 「走り切って6時で出会う」の検査は D-1b(走りの終端)にある。
  check("ringPoint(±180°) は環の真下(6時)を指す", (() => {
    const [lx, ly] = api.ringPoint(-180, api.RING_R, api.RING_CX, api.RING_CY);
    const [rx, ry] = api.ringPoint(180, api.RING_R, api.RING_CX, api.RING_CY);
    return Math.abs(lx - api.RING_CX) < 1e-9 && Math.abs(rx - api.RING_CX) < 1e-9
      && Math.abs(ly - (api.RING_CY + api.RING_R)) < 1e-9 && Math.abs(ry - (api.RING_CY + api.RING_R)) < 1e-9;
  })());
  // 走りのランプは「深い端が12時」の向き。to=0(12時)で s=0 になる。
  check("走りのランプは深い端(s=0)が12時に来る", (() => {
    const st = api.ringGradientStops(-90, 0);
    return Math.abs(st[st.length - 1].s) < 1e-9 && st[0].s > 100;
  })());
  // 描画側も「左右で同じ広がり・向きは 12時(to=0)へ」であること。
  // 片側だけ係数を変える/向きを反転する変異は、純関数の対称性テストだけでは捕まらない。
  check("描画は左右とも from=±spread, to=0(同じ広がり・深い端は12時)",
    /const from = \(k === 0 \? -1 : 1\) \* spread, to = 0;/.test(ringCode));
  check("走りの広がりは量子化した進捗×180°",
    /const spread = 180 \* p;/.test(ringCode) && /const p = ringRunQuantP\(raw\);/.test(ringCode));
  // キーの値と描画に使う値が同じ p であること。分けると最終フレームが書かれない(D-1b)。
  check("書き換えの間引きキーは描画に使う p そのものから作る",
    /const key = p <= 0 \? "off" : `\$\{p\.toFixed\(4\)\}\|\$\{base\.join\(","\)\}`;/.test(ringCode));
  check("走りの左右は2本とも書き換える(k は 0 と 1)",
    /for \(let k = 0; k < 2; k\+\+\) \{/.test(ringCode));
  check("走りの弧の d は ringArcD(from, to) の出力をそのまま入れる",
    /path\.setAttribute\("d", ringArcD\(from, to\)\);/.test(ringCode));
  check("走りのグラデーションの軸は from→to の端点(弦)に毎フレーム合わせる",
    /grad\.setAttribute\("x1", ax\.toFixed\(2\)\);/.test(ringCode)
    && /grad\.setAttribute\("y1", ay\.toFixed\(2\)\);/.test(ringCode)
    && /grad\.setAttribute\("x2", bx\.toFixed\(2\)\);/.test(ringCode)
    && /grad\.setAttribute\("y2", by\.toFixed\(2\)\);/.test(ringCode));
  check("走りのストップの色は各ストップの弧長 s から引く(先端一色のベタ塗りにしない)",
    /const c = ringRampRGB\(base, list\[i\]\.s\);/.test(ringCode));
  check("走りの進捗は 0〜1 にクランプされる",
    api.ringRunProgress(1000, 500) === 0 && api.ringRunProgress(1000, 1000) === 0
    && Math.abs(api.ringRunProgress(1000, 1000 + api.RING_RUN_MS / 2) - 0.5) < 1e-12
    && api.ringRunProgress(1000, 99999) === 1 && api.ringRunProgress(null, 1000) === 0);

  // ------------------------------------------------------------------
  // D-2/D-3. 光と呼吸。
  // ------------------------------------------------------------------
  check("RING_GLOW_AMP は 0.90", api.RING_GLOW_AMP === 0.90, String(api.RING_GLOW_AMP));
  check("光の内縁は環の帯の外縁と一致する", (() => {
    const want = ((api.RING_R + api.RING_SW / 2) / (api.RING_VB / 2)) * 100;
    return Math.abs(api.RING_GLOW_EDGE_PCT - want) < 1e-12 && Math.abs(want - 95.33333333333333) < 1e-9;
  })(), `${api.RING_GLOW_EDGE_PCT}%`);
  check("光は環の外側だけ(内縁が音名の領域に食い込まない)",
    api.RING_GLOW_EDGE_PCT > 90 && api.RING_GLOW_EDGE_PCT < 100, `${api.RING_GLOW_EDGE_PCT}%`);
  check("呼吸の周期は2600ms・上りは0.50",
    api.RING_BREATH_MS === 2600 && api.RING_BREATH_RISE === 0.50,
    `${api.RING_BREATH_MS}ms / ${api.RING_BREATH_RISE}`);
  check("呼吸は 0→1→0 を周期で繰り返す(正弦波ではなく smoothstep の上り下り)", (() => {
    if (Math.abs(api.ringBreath(0)) > 1e-12) return false;
    if (Math.abs(api.ringBreath(api.RING_BREATH_MS * api.RING_BREATH_RISE) - 1) > 1e-12) return false;
    if (Math.abs(api.ringBreath(api.RING_BREATH_MS - 1e-9)) > 1e-6) return false;
    // 周期性
    for (const t of [123, 777, 2599]) {
      if (Math.abs(api.ringBreath(t) - api.ringBreath(t + api.RING_BREATH_MS * 3)) > 1e-9) return false;
    }
    return true;
  })());
  check("呼吸は正弦波ではない(smoothstep を上り下りに分けたもの)", (() => {
    let maxD = 0;
    for (let t = 0; t < api.RING_BREATH_MS; t += 1) {
      const sine = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / api.RING_BREATH_MS);
      maxD = Math.max(maxD, Math.abs(api.ringBreath(t) - sine));
    }
    // 実測: 正弦波との最大差は 0.0100。閾値はその半分に置く。
    return maxD > 0.005;
  })());
  check("呼吸は仕様の式(上り smoothstep(u/rise) / 下り 1-smoothstep((u-rise)/(1-rise)))そのもの", (() => {
    for (let t = 0; t < api.RING_BREATH_MS * 2; t += 3) {
      const u = ((t % api.RING_BREATH_MS) + api.RING_BREATH_MS) % api.RING_BREATH_MS / api.RING_BREATH_MS;
      const want = u < api.RING_BREATH_RISE
        ? api.ringSmoothstep(u / api.RING_BREATH_RISE)
        : 1 - api.ringSmoothstep((u - api.RING_BREATH_RISE) / (1 - api.RING_BREATH_RISE));
      if (Math.abs(api.ringBreath(t) - want) > 1e-12) return false;
    }
    return true;
  })());
  check("上りと下りが同じ長さ(rise=0.50 なので山は周期のちょうど中央)", (() => {
    // 山の位置を波形そのものから探す(定数の言い換えにしない)
    let peakT = 0, peak = -1;
    for (let t = 0; t < api.RING_BREATH_MS; t += 1) { const v = api.ringBreath(t); if (v > peak) { peak = v; peakT = t; } }
    return Math.abs(peakT / api.RING_BREATH_MS - 0.5) < 0.002 && Math.abs(peak - 1) < 1e-9;
  })(), (() => { let pt = 0, p = -1; for (let t = 0; t < api.RING_BREATH_MS; t += 1) { const v = api.ringBreath(t); if (v > p) { p = v; pt = t; } } return `山=${pt}ms/${api.RING_BREATH_MS}ms`; })());
  check("呼吸は両端で変化が緩く中ほどが速い(上り区間で単調増加・微分が山型)", (() => {
    const h = 1;
    let prev = -1, dPrev = 0, rose = false, fell = false;
    for (let t = 0; t <= api.RING_BREATH_MS * api.RING_BREATH_RISE; t += 5) {
      const v = api.ringBreath(t);
      if (v < prev - 1e-12) return false;
      const d = api.ringBreath(t + h) - api.ringBreath(t);
      if (t > 0) { if (d > dPrev + 1e-12) rose = true; if (d < dPrev - 1e-12) fell = true; }
      dPrev = d; prev = v;
    }
    return rose && fell;
  })());
  check("呼吸は0〜1に収まる", (() => {
    for (let t = 0; t < api.RING_BREATH_MS * 3; t += 7) {
      const v = api.ringBreath(t);
      if (v < -1e-12 || v > 1 + 1e-12) return false;
    }
    return true;
  })());
  check("光の不透明度 = AMP × 線形進捗 × (0.34 + 0.66×呼吸)", (() => {
    for (const raw of [0, 0.25, 0.5, 1]) {
      for (const br of [0, 0.5, 1]) {
        const want = api.RING_GLOW_AMP * raw * (0.34 + 0.66 * br);
        if (Math.abs(api.ringGlowOpacity(raw, br) - want) > 1e-12) return false;
      }
    }
    return true;
  })());
  check("走りが始まる前は光が出ていない", api.ringGlowOpacity(0, 1) === 0);
  check("光は走りに合わせて立ち上がる(線形進捗に比例)",
    api.ringGlowOpacity(0.5, 1) > 0 && api.ringGlowOpacity(0.5, 1) < api.ringGlowOpacity(1, 1));
  check("光の色は帯より明るく彩度が低い(照らされた面の色)", (() => {
    for (const base of [GREEN, ORANGE, RED]) {
      const b = api.oklabToOklch(api.rgbToOklab(base));
      const g = api.oklabToOklch(api.rgbToOklab(api.ringGlowRGB(base)));
      if (!(g[0] > b[0])) return false;
      if (!(g[1] < b[1])) return false;
      if (Math.abs(g[2] - b[2]) > 1.5) return false; // 色相は動かさない
    }
    return true;
  })());
  {
    const radial = ringCode.match(/<radialGradient[\s\S]*?<\/radialGradient>/g) || [];
    check("radialGradient は1つ(到達の光)", radial.length === 1, `${radial.length}個`);
    // 【グラデーション自身の幾何】ストップの offset(%)は「この半径 r に対する割合」なので、
    // r を縮めると RING_GLOW_EDGE_PCT が指す実際の半径も一緒に縮み、光の内縁が
    // 音名の領域へ食い込む(r={VB/4} にすると内縁が 143→71.5 に移動する)。
    // 中心のずらしや gradientUnits の削除も同じく offset の意味を変える。
    // ストップと `<circle>` 側だけを見ていると全部素通りするので、ここで開始タグを縛る。
    check("光のグラデーションはユーザー座標系・環と同心・半径は viewBox の半分",
      /<radialGradient\s+id=\{glowGradId\} gradientUnits="userSpaceOnUse" cx=\{CX\} cy=\{CY\} r=\{VB \/ 2\}\s*>/
        .test((radial[0] || "").replace(/\s*\n\s*/g, " ")),
      (radial[0] || "").split("\n").slice(0, 2).join(" ").trim());
    check("光のグラデーションの半径は光の円の半径と同じ(offset%が円の縁と対応する)", (() => {
      const gr = /<radialGradient[^>]*r=\{([^}]+)\}/.exec((radial[0] || "").replace(/\s*\n\s*/g, " "));
      const ci = /<circle cx=\{CX\} cy=\{CY\} r=\{([^}]+)\} fill=\{`url\(#\$\{glowGradId\}\)`\} \/>/.exec(ringCode);
      return !!gr && !!ci && gr[1].trim() === ci[1].trim();
    })());
    // 内縁の実寸(viewBox単位・CSS px)を出しておく。音名の箱(音名サイズ118px)を侵さないこと。
    {
      const inner = (api.RING_GLOW_EDGE_PCT / 100) * (api.RING_VB / 2);
      const innerPx = inner * (api.RING_D_FULL / api.RING_VB);
      check("光の内縁は環のトラックの外縁(viewBox 143 / 実寸 157.3 CSS px)",
        Math.abs(inner - (api.RING_R + api.RING_SW / 2)) < 1e-9 && Math.abs(inner - 143) < 1e-9,
        `内縁 viewBox=${inner.toFixed(3)} / 実寸=${innerPx.toFixed(2)} CSS px`);
      check("光の内縁は音名の外接半径より外側にある(音名を覆わない)",
        innerPx > (api.RING_D_FULL * 0.3576) / 2 + 20,
        `内縁 ${innerPx.toFixed(1)}px vs 音名の高さの半分 ${((api.RING_D_FULL * 0.3576) / 2).toFixed(1)}px`);
    }
    const stops = (radial[0] || "").match(/<stop[\s\S]*?\/>/g) || [];
    check("光のストップは3つだけ", stops.length === 3, `${stops.length}個`);
    check("先頭のストップは不透明度0(内側は完全に透明=白のまま)",
      /stopOpacity="0"/.test(stops[0] || ""), stops[0] || "");
    check("先頭と2番目のストップは同じ位置(環の外縁)にある",
      /offset=\{`\$\{RING_GLOW_EDGE_PCT\}%`\}/.test(stops[0] || "")
      && /offset=\{`\$\{RING_GLOW_EDGE_PCT\}%`\}/.test(stops[1] || ""));
    check("最後のストップは 100% で不透明度0",
      /offset="100%"/.test(stops[2] || "") && /stopOpacity="0"/.test(stops[2] || ""));
    check("光の円は viewBox の半分の半径", /<circle cx=\{CX\} cy=\{CY\} r=\{VB \/ 2\} fill=\{`url\(#\$\{glowGradId\}\)`\} \/>/.test(ringCode));
  }

  // ------------------------------------------------------------------
  // D-4. 再走行の抑制 — 純関数の状態遷移として検証する。
  // ------------------------------------------------------------------
  // 【根拠は測って出す】以前ここには「判定線の上でごく短く揺らしても外れている時間は
  // 0.9〜1.0秒より下がらず、実測 923/943/968ms」と書いてあったが、実測すると
  // **揺らしだけでは最長 650ms** で 900ms には届かない。923〜968ms が出るのは
  // 「一度はっきり外して戻す」場合(EMA の戻り尾が加わる)で、それは揺らしではない。
  // 定数と文章の突き合わせではなく、**実装と同じ EMA を回して外れ時間を出す**。
  //
  // 実コンポーネントの平滑と判定:
  //   smoothRef.val += (raw - smoothRef.val) * 0.15   (60fps・音名が変わらない間)
  //   inTune = |val| <= RING_IN_TUNE_CENTS
  const EMA_ALPHA = 0.15, FPS = 60;
  check("平滑の係数はソースどおり 0.15", /smoothRef\.current\.val \+= \(rawExact - smoothRef\.current\.val\) \* 0\.15;/.test(ringCode));
  // centsFn(t[ms]) → 生のセント値。戻り値: 外れている連続時間の一覧と、走った回数。
  function simulateRing(centsFn, seconds, rearmMs = api.RING_RUN_REARM_MS) {
    const dt = 1000 / FPS;
    let val = centsFn(0), st = { runFrom: null, outSince: -Infinity };
    let runs = 0, prevRunFrom = null, crossings = 0, prevIn = null;
    const outs = [];
    let outStart = null;
    for (let i = 0; i * dt <= seconds * 1000; i++) {
      const t = i * dt;
      val += (centsFn(t) - val) * EMA_ALPHA;
      const inTune = Math.abs(val) <= api.RING_IN_TUNE_CENTS;
      if (prevIn !== null && inTune !== prevIn) crossings++;
      if (!inTune && outStart === null) outStart = t;
      if (inTune && outStart !== null) { outs.push(t - outStart); outStart = null; }
      prevIn = inTune;
      // ringRunState と同じ遷移を、抑制時間だけ差し替えられる形で回す
      const prev = st;
      if (!inTune) st = { runFrom: null, outSince: prev.runFrom === null ? prev.outSince : t };
      else if (prev.runFrom !== null) st = { runFrom: prev.runFrom, outSince: null };
      else st = { runFrom: t - prev.outSince >= rearmMs ? t : t - api.RING_RUN_MS, outSince: null };
      if (st.runFrom !== null && st.runFrom !== prevRunFrom && api.ringRunProgress(st.runFrom, t) === 0) runs++;
      prevRunFrom = st.runFrom;
    }
    if (outStart !== null) outs.push(seconds * 1000 - outStart);
    return { runs, crossings, outs, maxOut: outs.length ? Math.max(...outs) : 0 };
  }
  // このシミュレータが ringRunState と同じ遷移をしていることの裏取り
  check("シミュレータの状態遷移は ringRunState と一致する", (() => {
    let a = { runFrom: null, outSince: -Infinity }, b = a;
    for (let t = 0; t < 6000; t += 50) {
      const inTune = Math.floor(t / 137) % 3 !== 0;
      const prev = a;
      if (!inTune) a = { runFrom: null, outSince: prev.runFrom === null ? prev.outSince : t };
      else if (prev.runFrom !== null) a = { runFrom: prev.runFrom, outSince: null };
      else a = { runFrom: t - prev.outSince >= api.RING_RUN_REARM_MS ? t : t - api.RING_RUN_MS, outSince: null };
      b = api.ringRunState(b, inTune, t);
      if (a.runFrom !== b.runFrom || a.outSince !== b.outSince) return false;
    }
    return true;
  })());
  {
    // (1) 判定線の上でごく短く揺らす。EMA で振幅が落ちるので、外れている時間は短い。
    const wobble = (amp, hz) => simulateRing((t) => amp * Math.sin((2 * Math.PI * hz * t) / 1000), 8);
    const w3 = wobble(3, 1.5), w16 = wobble(1.6, 0.8), w2 = wobble(2, 0.5), w12 = wobble(1.2, 3);
    console.log(`  揺らしたときの外れ時間(実測): 3¢/1.5Hz 判定の切替${w3.crossings}回・最長${w3.maxOut.toFixed(0)}ms`
      + ` / 1.6¢/0.8Hz 判定の切替${w16.crossings}回・最長${w16.maxOut.toFixed(0)}ms`
      + ` / 2¢/0.5Hz 判定の切替${w2.crossings}回・最長${w2.maxOut.toFixed(0)}ms`
      + ` / 1.2¢/3Hz 判定の切替${w12.crossings}回・最長${w12.maxOut.toFixed(0)}ms`);
    check("揺らしただけでは外れている時間は 700ms を超えない(EMA が振幅を落とすため)",
      Math.max(w3.maxOut, w16.maxOut, w2.maxOut, w12.maxOut) < 700,
      `最長 ${Math.max(w3.maxOut, w16.maxOut, w2.maxOut, w12.maxOut).toFixed(0)}ms`);
    check("速い揺らし(1.2¢/3Hz)は EMA が吸収して一度も外れない",
      w12.crossings === 0 && w12.maxOut === 0, `判定の切替${w12.crossings}回`);
    check("揺らしても走りは1回だけ(3¢/1.5Hz で8秒間)", w3.runs === 1, `${w3.runs}回`);
    check("どの揺らし方でも走りは1回だけ",
      [w3, w16, w2, w12].every((r) => r.runs === 1),
      [w3, w16, w2, w12].map((r) => r.runs).join(","));
    // 抑制が無ければ交差のたびに走る = 上の検査は空振りではない
    check("抑制が無ければ 3¢/1.5Hz で何度も走る(比較対象)",
      simulateRing((t) => 3 * Math.sin((2 * Math.PI * 1.5 * t) / 1000), 8, 0).runs >= 8,
      `${simulateRing((t) => 3 * Math.sin((2 * Math.PI * 1.5 * t) / 1000), 8, 0).runs}回`);

    // (2) 一度はっきり外して戻す。EMA の戻り尾(15¢→1¢ に約278ms)が加わる。
    const excursion = (holdMs, rearm = api.RING_RUN_REARM_MS) =>
      simulateRing((t) => (t >= 1000 && t < 1000 + holdMs ? 15 : 0), 6, rearm);
    const e650 = excursion(650), e800 = excursion(800), e1000 = excursion(1000);
    const tail = e650.maxOut - 650;
    console.log(`  +15¢に外して戻したときの外れ時間(実測): 保持650ms→${e650.maxOut.toFixed(0)}ms`
      + ` / 800ms→${e800.maxOut.toFixed(0)}ms / 1000ms→${e1000.maxOut.toFixed(0)}ms`
      + ` (EMA の戻り尾 ${tail.toFixed(0)}ms)`);
    check("EMA の戻り尾は約278ms(15¢→1¢ まで 0.15/フレームで戻る時間)",
      Math.abs(tail - 278) < 20, `${tail.toFixed(0)}ms`);
    check("+15¢を650ms保持して戻すと外れ時間は 923〜968ms の帯に入る",
      e650.maxOut > 900 && e650.maxOut < 980, `${e650.maxOut.toFixed(0)}ms`);
    check("900 では (2) が抑制を抜けて走り直してしまう(1200 が必要な理由)",
      excursion(650, 900).runs === 2, `${excursion(650, 900).runs}回`);
    check("1200 なら生の外れ 800ms までは走り直さない",
      e650.runs === 1 && e800.runs === 1, `650ms:${e650.runs}回 / 800ms:${e800.runs}回`);
    check("1200 でも生の外れ 1000ms 以上なら走り直す(離れて戻ったことは伝える)",
      e1000.runs === 2, `${e1000.runs}回`);
  }
  check("RING_RUN_REARM_MS は 1200", api.RING_RUN_REARM_MS === 1200, String(api.RING_RUN_REARM_MS));
  {
    const INIT = { runFrom: null, outSince: -Infinity };
    // 初回の到達は必ず走る(進捗0から)
    const s1 = api.ringRunState(INIT, true, 1000);
    check("初回の到達は走る(進捗0から)", s1.runFrom === 1000 && api.ringRunProgress(s1.runFrom, 1000) === 0);
    // 合格が続く間は runFrom を保持する(毎フレーム走り直さない)
    const s2 = api.ringRunState(s1, true, 1200);
    check("合格が続く間は走りをやり直さない", s2.runFrom === 1000);
    // 外れた瞬間に outSince が立ち、以降は更新されない
    const s3 = api.ringRunState(s2, false, 1500);
    const s4 = api.ringRunState(s3, false, 1900);
    check("外れた瞬間の時刻を記録し、以降は更新しない", s3.outSince === 1500 && s4.outSince === 1500);
    check("外れている間は帯を出さない(runFrom=null)", s3.runFrom === null && s4.runFrom === null);
    // 抑制中(900ms未満)に戻ったら走り直さず点灯状態(進捗1)から
    const s5 = api.ringRunState(s4, true, 2000);   // 外れて500ms
    check("抑制中(900ms未満)に戻ったら走り直さない",
      s5.runFrom === 2000 - api.RING_RUN_MS && api.ringRunProgress(s5.runFrom, 2000) === 1,
      `runFrom=${s5.runFrom}`);
    // 境界は定数から導く。数値を直書きすると、定数を動かしたとき検査だけが取り残される
    // (実際 900→1200 に上げたときここだけ落ちた)。
    const RE = api.RING_RUN_REARM_MS;
    const t1 = api.ringRunState(s5, false, 3000);
    const t2 = api.ringRunState(t1, false, 3000 + RE - 1);
    const t3 = api.ringRunState(t2, true, 3000 + RE - 1);   // 1ms 足りない → まだ抑制
    check("抑制時間に1ms足りなければ再走行しない",
      api.ringRunProgress(t3.runFrom, 3000 + RE - 1) === 1, `runFrom=${t3.runFrom}`);
    const u1 = api.ringRunState(s5, false, 3000);
    const u2 = api.ringRunState(u1, false, 3000 + RE);
    const u3 = api.ringRunState(u2, true, 3000 + RE);       // ちょうど抑制時間
    check("抑制時間ちょうどで再走行する",
      u3.runFrom === 3000 + RE && api.ringRunProgress(u3.runFrom, 3000 + RE) === 0);
    // 判定線の上で細かく揺れても走りは1回だけ
    {
      let st = INIT, runs = 0, prevRunFrom = null;
      for (let t = 0; t < 5000; t += 50) {
        const inTune = Math.floor(t / 100) % 2 === 0;   // 100msごとに合格/不合格が入れ替わる
        st = api.ringRunState(st, inTune, t);
        if (st.runFrom !== null && st.runFrom !== prevRunFrom && api.ringRunProgress(st.runFrom, t) === 0) runs++;
        prevRunFrom = st.runFrom;
      }
      check("判定線の上で揺れても走りは1回だけ(再走行の抑制が効く)", runs === 1, `${runs}回`);
    }
    // 抑制が無い実装(毎回走り直す)なら上は何回も走る = この検査は空振りではない
    {
      let runs = 0, prev = false;
      for (let t = 0; t < 5000; t += 50) {
        const inTune = Math.floor(t / 100) % 2 === 0;
        if (inTune && !prev) runs++;
        prev = inTune;
      }
      check("抑制が無ければ同じ入力で25回走る(比較対象)", runs === 25, `${runs}回`);
    }
    check("prev が空でも例外を投げず初回として走る",
      api.ringRunState(undefined, true, 5000).runFrom === 5000
      && api.ringRunState({}, true, 5000).runFrom === 5000);
    // 抑制の判定はコンポーネントの中ではなく純関数に置く(ハーネスから見えるように)
    check("再走行の抑制はコンポーネント内の if ではなく純関数",
      /const st = ringRunState\(runStateRef\.current, liveRef\.current\.inTune, now\);/.test(ringCode)
      && !/RING_RUN_REARM_MS/.test(ringCode));
  }

  // ------------------------------------------------------------------
  // D-5. 動きを減らす設定 — 走らず点灯・呼吸は止める・**光は消さない**。
  // ------------------------------------------------------------------
  check("減速設定では進捗1(点灯)から始める", /const raw = st\.runFrom === null \? 0 : \(reduce \? 1 : ringRunProgress\(st\.runFrom, now\)\);/.test(ringCode));
  check("減速設定では呼吸を止めて breath=1 に固定する", /const breath = reduce \? 1 : ringBreath\(now\);/.test(ringCode));
  // 【この2つは別のことを見ている】
  //  ・下の1本目は ringGlowOpacity の係数の和が1であること(= 進捗1・呼吸1 で AMP)。
  //    reduce には一切触れない。名乗りを式に合わせてある。
  //  ・2本目が「減速設定で光が消えない」の本体。減速の分岐は raw と breath の2行だけに
  //    置き、**不透明度の式には reduce を混ぜない**ことをソースで縛る。
  //    (`const op = (reduce ? 0 : ringGlowOpacity(raw, breath)).toFixed(4);` という変異は
  //     純関数のテストを一切壊さずに減速設定で光を完全に消せた。)
  check("ringGlowOpacity の係数の和は1(進捗1・呼吸1で AMP ちょうど)",
    api.ringGlowOpacity(1, 1) === api.RING_GLOW_AMP, String(api.ringGlowOpacity(1, 1)));
  check("減速設定でも光は消えない(不透明度の式に reduce の分岐を挟まない)", (() => {
    const m = /const op = [^\n]*/.exec(ringCode);
    if (!m) return false;
    return m[0].trim() === "const op = ringGlowOpacity(raw, breath).toFixed(4);" && !/reduce/.test(m[0]);
  })(), (/const op = [^\n]*/.exec(ringCode) || [""])[0].trim());
  check("減速設定の分岐は raw と breath の2箇所だけ(rAFループ内)",
    (ringCode.match(/reduce \?/g) || []).length === 2,
    `${(ringCode.match(/reduce \?/g) || []).length}箇所`);
  // 減速設定の経路を、実装の3行と同じ順で組み立てて評価する。
  check("減速設定の経路をたどると光は最大の明るさで灯る", (() => {
    const reduce = true;
    const st = api.ringRunState({ runFrom: null, outSince: -Infinity }, true, 1000);
    const raw = st.runFrom === null ? 0 : (reduce ? 1 : api.ringRunProgress(st.runFrom, 1000));
    const breath = reduce ? 1 : api.ringBreath(1000);
    return api.ringGlowOpacity(raw, breath) === api.RING_GLOW_AMP;
  })());

  // ------------------------------------------------------------------
  // E. §6.1 / §6.1.5 — 到達しても環の寸法は変わらない。
  // ------------------------------------------------------------------
  check("環の直径は状態によらず RING_D_FULL 固定", api.RING_D_FULL === 330 && !/diameter = (?!RING_D_FULL)/.test(ringCode));
  check("到達しても viewBox は 300 のまま", /viewBox=\{`0 0 \$\{VB\} \$\{VB\}`\}/.test(ringCode) && api.RING_VB === 300);
  // 【ここは定数の言い換えを書かない】
  // 以前ここには `|c/RING_MAX_CENTS × RING_SWEEP_DEG| ≤ RING_SWEEP_DEG` という
  // **定数を何に変えても真になる**式と、「下弧(±90°より外)に届かない」という
  // 実装(110°)と逆の名乗りが置かれていた。どちらも何も守っていなかった。
  //
  // 実際の要件は §6.1「環の二役」= 到達していない間の帯が**拍の要素と場所を争わない**こと。
  // 帯の角度の上限(RING_SWEEP_DEG=110)と、拍の点が占める角度(6時±RING_BEAT_DOT_SPREAD_DEG
  // = |角度| 120°〜180°)は**別々に決めた定数**なので、突き合わせは恒等式にならない。
  check("角度の写像はソースどおり(exact/RING_MAX_CENTS × RING_SWEEP_DEG)",
    /const deg = \(exact \/ RING_MAX_CENTS\) \* RING_SWEEP_DEG;/.test(ringCode));
  {
    // 帯が届く最大角度を、写像そのものを回して求める(定数を読み直さない)。
    let bandMax = 0;
    for (let c = -api.RING_MAX_CENTS; c <= api.RING_MAX_CENTS; c += 0.1) {
      bandMax = Math.max(bandMax, Math.abs((c / api.RING_MAX_CENTS) * api.RING_SWEEP_DEG));
    }
    // 拍の点が占める角度を、点の配置関数から求める(こちらも定数を読み直さない)。
    let dotMin = 360;
    for (let n = 1; n <= 12; n++) {
      for (let i = 0; i < n; i++) {
        const d = api.ringBeatDotDeg(i, n);
        dotMin = Math.min(dotMin, Math.abs(((d + 180) % 360 + 360) % 360 - 180));
      }
    }
    check("到達していない帯は拍の点の角度範囲に一切入らない(環の二役が保たれる)",
      bandMax < dotMin - 1e-9,
      `帯の上限=±${bandMax.toFixed(1)}° / 拍の点の内端=±${dotMin.toFixed(1)}° / 余白=${(dotMin - bandMax).toFixed(1)}°`);
    check("その余白は5°以上ある(角度が近すぎて役割が読めなくならない)",
      dotMin - bandMax >= 5, `${(dotMin - bandMax).toFixed(1)}°`);
    // 帯は 90°を 20°超えて下半円に入る。「±90°で止まる」ではない。事実として記録に残す。
    check("帯は下半円に RING_SWEEP_DEG−90 = 20° だけ入る(±90°では止まらない)",
      Math.abs((bandMax - 90) - 20) < 1e-9, `下半円へ ${(bandMax - 90).toFixed(1)}°`);
    console.log(`  環の二役: 帯 ±${bandMax.toFixed(1)}° / 拍の点 ±${dotMin.toFixed(1)}°〜180° / 余白 ${(dotMin - bandMax).toFixed(1)}°`);
  }
  // 到達したときだけ全周を使う(本人の明示的な許可)。
  check("到達の走りは全周を使う(6時に届く)", 180 * api.ringRunQuantP(1) === 180);
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
console.log("\n========== 14. リードの主観評価(総評=0.1刻み41段 / 厚さ・バランス=1〜5・履歴・グラフ) ==========");
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
    sourceOf("ReedScoreEditor").includes("</div>") && sourceOf("ReedScoreEditor").length > 400,
    `${sourceOf("ReedScoreEditor").length}文字`);

  const N = api.normalizeReedScore;

  // --- 1〜5の整数への正規化(厚さ・バランス)。既存の0.1刻みデータ・0・null を壊さずに読む ---
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
  // (REED_SCORE_STEPS = [1,2,3,4,5] を数えていた検査はここにあったが、唯一の読み手だった
  //  RatingSlider を削除して定数ごと消えたため撤去した。1〜5であることは上の
  //  「その5段階は1〜5」と RATING_DIAL_ORDER の検査が押さえている。)

  // ============================================================
  // 総評だけ 0.1 刻み(本人指示「総評だけは.1きざみでできるように」)
  // ============================================================
  {
    const R = api.normalizeReedRating;
    const OF = api.normalizeReedScoreOf;
    const TXT = api.reedScoreText;
    // --- 刻み: 0.1 を取れること。ここが1(整数)に戻ると全滅する ---
    check("総評は 3.7 をそのまま取れる", R(3.7) === 3.7, String(R(3.7)));
    check("総評は 3.4 を丸め上げない", R(3.4) === 3.4, String(R(3.4)));
    check("総評は 0.05 単位を最寄りの 0.1 に乗せる", R(3.74) === 3.7 && R(3.76) === 3.8, `${R(3.74)} / ${R(3.76)}`);
    check("総評の下限は 1.0", R(0.4) === 1 && R(1) === 1, `${R(0.4)} / ${R(1)}`);
    check("総評の上限は 5.0", R(9.9) === 5, String(R(9.9)));
    check("総評の 0 / null / undefined / 非数値は未評価", R(0) === null && R(null) === null && R(undefined) === null && R("abc") === null && R(NaN) === null);
    check("総評の文字列も読める", R("3.7") === 3.7, String(R("3.7")));
    // 既存の整数の総評はそのまま有効(マイグレーション不要)
    check("既存の整数の総評はそのまま有効な値", [1, 2, 3, 4, 5].every((v) => R(v) === v));
    // 段階数の要件。刻みを1に戻すとここが 5段 になって落ちる
    {
      const distinct = new Set();
      for (let i = 0; i <= 40; i++) { const v = R(1 + i * 0.1); if (v !== null) distinct.add(v); }
      check("総評は41段(1.0〜5.0の0.1刻み)", distinct.size === 41, `${distinct.size}段`);
      check("総評の最小と最大は 1 と 5", Math.min(...distinct) === 1 && Math.max(...distinct) === 5);
    }
    // --- 2進小数の誤差を落としていること(丸めをやめると落ちる) ---
    check("累積加算で作った値も同じ値に落ちる", (() => {
      let x = 1; for (let i = 0; i < 27; i++) x += 0.1;    // x = 3.7000000000000024
      return x !== 3.7 && R(x) === R(3.7);
    })(), "生の加算は 3.7 と一致しない");
    check("2進誤差を持つ値をすべて刻みに戻せる(1.0〜5.0を累積加算で走査)", (() => {
      let x = 1, bad = 0;
      for (let i = 0; i < 40; i++) { x += 0.1; if (R(x) !== Math.round((1 + (i + 1) * 0.1) * 10) / 10) bad++; }
      return bad === 0;
    })());
    check("正規化した値をもう一度正規化しても変わらない(冪等)",
      api.RATING_DIAL_RATING_ORDER.every((v) => R(v) === v));

    // --- 【訂正】「刻みに乗せる行を消しても末尾の丸めと等価」は誤りだった ---
    // 前回の報告で「総評の丸めをやめる変異は末尾の Math.round(r*10)/10 が同じ仕事をする
    // (600,001通り＋累積加算で差分0を確認)」と書いたが、**この申告は数値として誤り**。
    // 生き残る変異は「刻み乗せ Math.round(n / REED_RATING_STEP) * REED_RATING_STEP を外す版」
    // (= const r = n; にする)で、等価ではない。
    //   掃き方: n = i / 1000 を i = 1000〜5000 で生成した 4001 点(1.000〜5.000 の0.001刻み)。
    //   結果: 14点で食い違う。1.15 1.45 1.65 2.05 2.15 2.55 2.65 3.05 3.15 3.55 4.05 4.35 4.55 4.85
    //         (いずれも現行のほうが 0.1 低い。例: 1.15 → 現行 1.1 / 変異 1.2。
    //          1.15 * 10 は丸め上がって 11.5 ちょうどになるのに、1.15 / 0.1 は
    //          11.499999999999998 に落ちるため、前段の Math.round が届かない。)
    // なぜ前回見つからなかったか: **掃き方が刻みに揃っていた**。
    //   x = 1 から x += 1e-5 を 600,001 回まわす累積加算では差分0(下で再現している)。
    //   1 + i * 1e-5 の格子でも 6 点しか出ない。x.x5 という**3桁目が5の10進リテラル**を
    //   生む格子(i/1000 や Number(v.toFixed(3)))でないと現れない差だった。
    // 実害: 無い。総評に入る値はダイヤルの RATING_DIAL_RATING_ORDER か、一度
    //   normalizeReedRating を通った保存値だけで、x.x5 には到達しない。
    // 検査で出力を焼き付けない理由: x.x5 は40点あるうち食い違うのは14点だけで、残り26点は
    //   一致する。つまりこの差は**方針ではなく2進誤差の当たり外れ**であり、
    //   R(1.15) === 1.1 のような期待値を検査に書くと偶然を要件に格上げすることになる。
    //   代わりに「丸めが2段であること」をソースの形で固定して、この変異だけを殺す。
    //   ＝これは実行では守れない。ソースの綴りでしか守っていない。
    {
      // 掃き方の再現(前回の申告が通ってしまった掃引)。等価に見えることを検査として残す。
      const mut = (n) => Math.max(1, Math.min(5, Math.round(n * 10) / 10));
      let same = 0, x = 1;
      for (let i = 0; i <= 600000; i++) { if (R(x) === mut(x)) same++; x += 1e-5; }
      check("刻みに揃った掃引(0.1の累積加算)では刻み乗せの有無が見分けられない(前回の掃き方の再現)",
        same === 600001, `${same}/600001 点で一致`);
      // x.x5 を生む格子でだけ差が出る。ここでは点数だけを見る(どの点かは要件ではない)。
      let diff = 0;
      for (let i = 1000; i <= 5000; i++) { const n = i / 1000; if (R(n) !== mut(n)) diff++; }
      check("0.001刻み(i/1000)で掃くと刻み乗せの有無は見分けられる(＝等価ではない)",
        diff > 0, `${diff}/4001 点で食い違う`);
      const NR = (src.match(/function normalizeReedRating\(\)?[\s\S]*?\n\}/) || [""])[0];
      check("総評の丸めは2段(刻みに乗せてから2進誤差を落とす)。実行では差が出ないのでソースで固定する",
        /Math\.round\(n \/ REED_RATING_STEP\) \* REED_RATING_STEP/.test(NR) &&
        /Math\.round\(r \* 10\) \/ 10/.test(NR), NR ? "" : "normalizeReedRating を取り出せない");
    }

    // --- 項目ごとの正規化。総評だけ0.1刻み、厚さ・バランスは整数 ---
    check("項目別: rating は 0.1 刻み", OF("rating", 3.7) === 3.7, String(OF("rating", 3.7)));
    check("項目別: thickness は整数に丸める", OF("thickness", 3.7) === 4, String(OF("thickness", 3.7)));
    check("項目別: balance は整数に丸める", OF("balance", 2.4) === 2, String(OF("balance", 2.4)));
    check("項目別: 知らないキーは整数側(総評だけが特別)", OF("memo", 3.7) === 4, String(OF("memo", 3.7)));

    // --- 表示は総評だけ小数第1位まで ---
    check("総評 3 は \"3.0\" と表示する", TXT("rating", 3) === "3.0", TXT("rating", 3));
    check("総評 3.7 は \"3.7\" と表示する", TXT("rating", 3.7) === "3.7", TXT("rating", 3.7));
    check("総評 5 は \"5.0\" と表示する", TXT("rating", 5) === "5.0", TXT("rating", 5));
    check("厚さは整数表示(小数点を付けない)", TXT("thickness", 3) === "3", TXT("thickness", 3));
    check("バランスも整数表示", TXT("balance", 2) === "2", TXT("balance", 2));
    check("未評価はどれも —", TXT("rating", null) === "—" && TXT("thickness", null) === "—" && TXT("balance", null) === "—");
    check("総評の表示は必ず小数第1位まで(41段すべて)",
      api.RATING_DIAL_RATING_ORDER.every((v) => /^\d\.\d$/.test(TXT("rating", v))),
      api.RATING_DIAL_RATING_ORDER.map((v) => TXT("rating", v)).filter((s) => !/^\d\.\d$/.test(s)).join(",") || "(全部OK)");

    // --- 総評のダイヤルの並び: 上が5.0・下が1.0・0.1刻み41段 ---
    const O = api.RATING_DIAL_RATING_ORDER;
    check("総評ダイヤルの上端は5", O[0] === 5, String(O[0]));
    check("総評ダイヤルの下端は1", O[O.length - 1] === 1, String(O[O.length - 1]));
    check("総評ダイヤルは41段", O.length === 41, `${O.length}段`);
    check("総評ダイヤルは上から下へ降順", O.every((v, i, a) => i === 0 || a[i - 1] > v));
    check("総評ダイヤルの隣り合う差はすべて0.1",
      O.every((v, i, a) => i === 0 || Math.abs((a[i - 1] - v) - 0.1) < 1e-9),
      O.map((v, i, a) => (i === 0 ? "" : (a[i - 1] - v).toFixed(3))).filter((s) => s && s !== "0.100").join(",") || "(全部0.1)");
    check("総評ダイヤルに 3.7 がある", O.includes(3.7));
    check("総評ダイヤルの値はすべて正規化済みの値と一致する(indexOfが-1にならない)",
      O.every((v) => O.indexOf(R(v)) >= 0));
    check("厚さ・バランスのダイヤルは整数5段のまま", api.ratingDialOrder("thickness").join(",") === "5,4,3,2,1",
      api.ratingDialOrder("thickness").join(","));
    check("総評だけ別の並びを使う", api.ratingDialOrder("rating").length === 41 && api.ratingDialOrder("balance").length === 5);

    // --- 位置 ⇄ 値(総評) ---
    {
      const H = api.RATING_DIAL_ITEM_H;
      check("総評: スクロール最上部で5.0", api.ratingDialValueAt(0, H, "rating") === 5);
      check("総評: スクロール最下部で1.0", api.ratingDialValueAt(H * 40, H, "rating") === 1);
      check("総評: 値→位置は位置→値の逆写像(41段すべて)",
        O.every((v) => api.ratingDialValueAt(api.ratingDialOffsetFor(v, H, "rating"), H, "rating") === v));
      check("総評: 3.7 の位置は上から13行目", api.ratingDialOffsetFor(3.7, H, "rating") === 13 * H,
        `${api.ratingDialOffsetFor(3.7, H, "rating")}px`);
      check("総評: 未評価は中央(3.0)の位置に置く",
        api.ratingDialOffsetFor(null, H, "rating") === api.ratingDialOffsetFor(3, H, "rating"));
      check("総評: 行き過ぎても範囲外にならない",
        api.ratingDialValueAt(-999, H, "rating") === 5 && api.ratingDialValueAt(999999, H, "rating") === 1);
    }
  }
  // --- 窓の高さは5行ぶん。ただし「常に5段が見える」ではない ---
  // 以前ここには「窓の行数は整数の段数(5段)以上=厚さ・バランスはスクロール不要」という
  // 検査があったが、名乗りが実態より強かった。ダイヤルは選択行を窓の中央に合わせるため
  // 上下に (窓高 - 行高)/2 の padding を持つので、**一度に見える段数は選択位置で変わる**。
  // 名前を実態に落としたうえで、実際に見える段数を数えて固定する。
  check("ダイヤルの窓の高さは5行ぶん", api.RATING_DIAL_VISIBLE === 5, `${api.RATING_DIAL_VISIBLE}行`);
  {
    const H = api.RATING_DIAL_ITEM_H, VIS = api.RATING_DIAL_VISIBLE;
    const winH = H * VIS;
    const pad = (winH - H) / 2;                       // RatingDial の padding と同じ式
    // 窓(スクロール位置 top から winH ぶん)に全体が収まっている段の数
    const rowsVisible = (v) => {
      const top = api.ratingDialOffsetFor(v, H);
      let n = 0;
      for (let i = 0; i < api.RATING_DIAL_ORDER.length; i++) {
        const a = pad + i * H;
        if (a >= top && a + H <= top + winH) n++;
      }
      return n;
    };
    const seen = api.RATING_DIAL_ORDER.map((v) => `${v}:${rowsVisible(v)}`).join(" ");
    check("一度に見えるのは中央(3)を選んでいるときだけ5段", rowsVisible(3) === 5, seen);
    check("端(5 / 1)を選んでいるときは3段しか見えない(F-13の「1と2はスクロール」は値が5のとき残る)",
      rowsVisible(5) === 3 && rowsVisible(1) === 3, seen);
    check("その隣(4 / 2)は4段", rowsVisible(4) === 4 && rowsVisible(2) === 4, seen);
    check("どの選択位置でも最低3段は見える(3行だった頃を下回らない)",
      api.RATING_DIAL_ORDER.every((v) => rowsVisible(v) >= 3), seen);
    // 上のモデルが実装と同じ padding を前提にしていること(前提が崩れたら数え直しになる)
    check("ダイヤルの padding は中央合わせの (窓高 - 行高)/2",
      /padding: `\$\{\(height - ITEM\) \/ 2\}px 0`/.test(sourceOf("RatingDial")));
  }

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
    // 総評は 0.1 刻みになったので、旧データの小数はもう丸めない(3.7 は 3.7 のまま有効)
    check("旧形式の value を rating として読む", legacy.rating === 3.7, String(legacy.rating));
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
    // 変異で patch が null になったときにハーネスごと落ちると、以降の検査が全部消えて
    // 「何件落ちたか」が読めなくなる。件数として数えられるよう null 安全に書く。
    const hist = (q) => (q && q.ratings) || [];
    check("履歴が1件だけ増える", hist(p).length === reed.ratings.length + 1, `${hist(p).length}件`);
    check("追加された履歴は3つ全部の値を持つ",
      !!hist(p)[1] && hist(p)[1].rating === 3 && hist(p)[1].thickness === 2 && hist(p)[1].balance === 4);
    check("追加された履歴は日時を持つ", !!hist(p)[1] && hist(p)[1].at === at);
    check("既存の履歴エントリはそのまま残る", hist(p)[0] === reed.ratings[0]);
    // 0 の既存データ(厚さ): 未評価と同じ意味なので「変わっていない」と判定して書かない
    const legacyReed = { rating: 3.7, thickness: 0, balance: null, ratings: [] };
    check("0 の厚さと未評価は同じ値なので書かない",
      api.commitReedScores(legacyReed, { rating: 3.7, thickness: null, balance: null }, at) === null);
    // **0.1刻みの肝**: 生の浮動小数と比べると「変えていないのに変わった」になり、
    // 開いただけで履歴が1件増える(前の周で潰した挙動)。丸めをやめるとここが落ちる。
    check("累積加算で作った同値でも書かない", (() => {
      let x = 1; for (let i = 0; i < 27; i++) x += 0.1;
      return x !== 3.7 && api.commitReedScores(legacyReed, { rating: x, thickness: null, balance: null }, at) === null;
    })());
    // 0.1 だけ動かしたら「変わった」。刻みを1に戻すとここが落ちる
    const step = api.commitReedScores(legacyReed, { rating: 3.8, thickness: null, balance: null }, at);
    check("総評を 0.1 だけ動かしたら記録する", step !== null && step.rating === 3.8, step ? String(step.rating) : "null");
    check("0.1 の変更でも履歴は1件だけ増える", hist(step).length === 1, `${hist(step).length}件`);
    const lp = api.commitReedScores(legacyReed, { rating: 5, thickness: null, balance: null }, at);
    check("総評を大きく変えれば書く", lp !== null && lp.rating === 5);
    check("履歴0件からでも1件だけ積む", hist(lp).length === 1, `${hist(lp).length}件`);
    check("総評は 0.1 に乗った値で保存される",
      !!hist(lp)[0] && api.normalizeReedRating(hist(lp)[0].rating) === hist(lp)[0].rating,
      hist(lp)[0] ? String(hist(lp)[0].rating) : "null");
    // --- 3つのうちどれか1つでも変わったら1件。1つでも検知から外すと落ちる ---
    {
      const base = { rating: 3, thickness: 3, balance: 3, ratings: [] };
      for (const [k, v] of [["rating", 3.1], ["thickness", 4], ["balance", 2]]) {
        const nx = { rating: 3, thickness: 3, balance: 3, [k]: v };
        const q = api.commitReedScores(base, nx, at);
        check(`${k} だけ変えても1件記録する`, q !== null && q[k] === v && hist(q).length === 1,
          q ? `${Object.keys(q).join(",")} / ${hist(q).length}件` : "null");
      }
      check("3つとも変えても履歴は1件だけ",
        hist(api.commitReedScores(base, { rating: 4.2, thickness: 1, balance: 5 }, at)).length === 1);
      check("3つとも同じなら0件", api.commitReedScores(base, { rating: 3, thickness: 3, balance: 3 }, at) === null);
    }
    // 直前の記録と3つとも同じなら履歴は増やさない(現在値だけがずれていた場合)
    const skew = { rating: 2, thickness: null, balance: null, ratings: [{ at: "2026-07-01T00:00:00.000Z", rating: 4, thickness: null, balance: null }] };
    const sp = api.commitReedScores(skew, { rating: 4, thickness: null, balance: null }, at);
    check("直前の記録と同じ値なら履歴は増やさない", sp !== null && !("ratings" in sp), sp ? Object.keys(sp).join(",") : "null");
    check("それでも現在値は更新する", !!sp && sp.rating === 4);
    // 未評価に戻すのも「変更」
    const clear = api.commitReedScores({ rating: 4, thickness: null, balance: null, ratings: [] }, { rating: null, thickness: null, balance: null }, at);
    check("評価を消すのも変更として記録する", clear !== null && clear.rating === null && hist(clear).length === 1);
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
    check("RatingDial は StarRating を呼ばない", !sourceOf("RatingDial").includes("<StarRating"));
    check("ReedScoreField は StarRating を呼ばない", !sourceOf("ReedScoreField").includes("<StarRating"));
    // 【C-1】表示は1行。行全体が1つのタップ対象で、押すと1つのダイアログが開く
    {
      const fld = sourceOf("ReedScoreField");
      check("評価表示は行全体が1つのボタン", /^function ReedScoreField[\s\S]*?return \(\s*<button/.test(fld));
      check("ボタンは1つだけ(項目ごとのボタンに戻していない)",
        (fld.match(/<button/g) || []).length === 1, `${(fld.match(/<button/g) || []).length}個`);
      check("押すと開くのは1つのダイアログ", (fld.match(/onClick=\{onOpen\}/g) || []).length === 1);
      // --- 「3つとも出る」を実行で数える ---
      // 以前はスタイル文字列の正規表現しか見ておらず、fields.slice(0,1).map(…)(総評だけ表示)
      // という1文字の変異が素通りした。行の中身を組み立てる部分を純関数 reedScoreRowItems に
      // 出したので、ここから直接呼んで数えられる。
      {
        const F = [
          { key: "rating", label: "総評", value: 3.7 },
          { key: "thickness", label: "厚さ", value: 4 },
          { key: "balance", label: "バランス", value: null },
        ];
        const row = api.reedScoreRowItems(F);
        check("行に並ぶのは渡された3項目すべて", row.length === 3, `${row.length}件`);
        check("行の並びは 総評 → 厚さ → バランス(渡された順を変えない)",
          row.map((r) => r.key).join(",") === "rating,thickness,balance", row.map((r) => r.key).join(","));
        check("行は項目名をそのまま出す", row.map((r) => r.label).join(",") === "総評,厚さ,バランス",
          row.map((r) => r.label).join(","));
        check("行の表示文字列は reedScoreText と同じ(総評だけ小数第1位・未評価は「—」)",
          row.map((r) => r.text).join(",") === F.map((f) => api.reedScoreText(f.key, f.value)).join(","),
          row.map((r) => r.text).join(","));
        check("未評価かどうかは normalizeReedScoreOf と一致する(色の出し分けの根拠)",
          row.map((r) => r.rated).join(",") === F.map((f) => api.normalizeReedScoreOf(f.key, f.value) !== null).join(","),
          row.map((r) => r.rated).join(","));
        check("区切り(列と列の境の罫)は先頭以外にだけ付く", row.map((r) => (r.sep ? 1 : 0)).join(",") === "0,1,1",
          row.map((r) => (r.sep ? 1 : 0)).join(","));
        // 件数を落とす変異(slice / filter / 先頭だけ)を、長さを振って捕まえる
        let dropped = null;
        for (let n = 0; n <= 6; n++) {
          const some = Array.from({ length: n }, (_, i) => ({ key: "thickness", label: "L" + i, value: 3 }));
          if (api.reedScoreRowItems(some).length !== n) dropped = dropped || `${n}件渡して${api.reedScoreRowItems(some).length}件`;
        }
        check("項目を1つも落とさない(0〜6件のどれを渡しても同じ数だけ返す)", !dropped, dropped || "");
        check("fields が無くても落ちない",
          api.reedScoreRowItems(null).length === 0 && api.reedScoreRowItems(undefined).length === 0);
      }
      // JSX 側は純関数の返り値をそのまま並べるだけ。ここで間引くと上の実行検査をすり抜ける。
      check("行の中身は reedScoreRowItems(fields) をそのまま map する",
        /\{reedScoreRowItems\(fields\)\.map\(\(it\) => \(/.test(fld));
      check("行の中身を間引く操作を挟んでいない(slice/filter/splice/添字)",
        !/\.(slice|filter|splice|shift|pop|find)\(/.test(fld) && !/fields\s*\[/.test(fld),
        (fld.match(/\.(slice|filter|splice|shift|pop|find)\(/g) || []).join(" / "));
      check("map は1つだけ(2段組みに分けていない)", (fld.match(/\.map\(/g) || []).length === 1,
        `${(fld.match(/\.map\(/g) || []).length}箇所`);
      // --- 「折り返さない」 ---
      // 以前は whiteSpace:nowrap(項目の中の改行止め)しか見ておらず、行に flexWrap:"wrap" を
      // 足す変異が素通りした(3項目が2段に折り返っても通る)。行そのものの折り返しを見る。
      check("3項目を横一列に並べる(flex)", /display: "flex", alignItems: "stretch"/.test(fld));
      check("行は折り返さない(flexWrap は nowrap ただ1つ。wrap を足しても後勝ちにならない)",
        (fld.match(/flexWrap:/g) || []).length === 1 && /flexWrap: "nowrap"/.test(fld),
        (fld.match(/flexWrap: "[a-z-]+"/g) || []).join(" / ") || "flexWrap の指定なし");
      check("flexFlow で折り返しを持ち込んでいない", !/flexFlow/.test(fld));
      // --- 「余白なく均等に三等分」(本人指示) ---
      // 列に flex:1 1 0 + minWidth:0 を与え、行の外側に padding も gap も置かない。
      // どれか1つでも欠けると幅が中身依存になり、3列が等幅にならない。
      check("列は flex:1 1 0 で幅を均等に分ける", /flex: "1 1 0"/.test(fld));
      check("列の幅は中身に引きずられない(minWidth:0)", /minWidth: 0/.test(fld));
      check("行の左右に padding を置かない(縦だけ --sp-2)",
        /padding: "var\(--sp-2\) 0"/.test(fld),
        (fld.match(/padding: "[^"]*"/g) || []).join(" / ") || "padding の指定なし");
      // gap は列の中(見出し↔数字)の1つだけ。行に gap を足すと列の合計幅が
      // 「画面幅 - gap」になり、三等分が崩れる
      check("行そのものに gap を置かない(gap は列の中の1つだけ)",
        (codeOf(fld).match(/gap:/g) || []).length === 1,
        `${(codeOf(fld).match(/gap:/g) || []).length}箇所`);
      // 見出しの下に数字(本人指示)。横並びに戻すと縦積みが崩れる
      check("各列は見出しの下に数字を積む(flexDirection:column)", /flexDirection: "column"/.test(fld));
      check("行の高さは --tap-min 以上(値の有無で高さが変わらない)", /minHeight: "var\(--tap-min\)"/.test(fld));
      // 区切りは幅を食わない1px罫。文字(「・」)だと列ごとに幅が変わり等幅にならない
      // 「・」は aria-label("総評・厚さ・バランスを編集")には出てよい。描画される文字として
      // 出ると列ごとに幅が変わって三等分が崩れるので、要素の中身(>の直後)だけを見る。
      check("区切りは列の境の罫(--c-line)で、幅を食う文字を描画しない",
        /borderLeft: it\.sep \?/.test(fld) && /1px solid var\(--c-line\)/.test(fld)
        && !/>\s*・/.test(codeOf(fld)) && !/\{"・"\}/.test(codeOf(fld)));
      check("フォントサイズはスケール内(--fs-xs / --fs-lg のみ)",
        (fld.match(/fontSize: "var\(--fs-[a-z0-9]+\)"/g) || []).every((s) => /--fs-(xs|lg)\)/.test(s)),
        (fld.match(/fontSize: "var\(--fs-[a-z0-9]+\)"/g) || []).join(","));
      check("生の px フォントサイズを使っていない", !/fontSize: \d/.test(fld));
    }
    check("ReedScoreEditor は StarRating を呼ばない", !sourceOf("ReedScoreEditor").includes("<StarRating"));
    // 項目1: 入力は5段階(0.1刻みの復活を止める)
    // 以前ここには RatingSlider の step / min / max を見る検査が3件あったが、今周で
    // ReedScoreEditor を3ダイヤル化した時点で呼び出し元がゼロになったため、コンポーネント
    // ごと削除した。入力の段数を守っているのは下の RatingDial の検査
    // (ratingDialOrder / RATING_DIAL_ORDER)。
    // 【訂正】前回この位置には「RatingSlider はダイヤル化の時点で死にコードで製品バンドルにも
    //  入っていなかった。出荷物について何も主張していない検査だった」と書いたが、これは事実に
    //  反していた。HEAD(80bf314)では SCORE_FIELDS の厚さ・バランスが kind:"slider" で、
    //  ReedScoreEditor が <RatingSlider> を実際に描いており、HEAD のバンドル
    //  dist/assets/index-u8DNZPZS.js には type:"range" が3箇所あった(現行は2箇所)。
    //  削除した3件は**書かれた時点では出荷物を守っていた検査**で、死にコードになったのは
    //  今周で3ダイヤル化した瞬間である。削除そのものは正しい(A/Bビルドで裏取り済み)。
    check("RatingSlider は定義も呼び出しも残っていない(3ダイヤル化で呼び出し元が消えたので削除した)",
      !/function RatingSlider\(/.test(src) && !/<RatingSlider/.test(src));
    // 残る type="range" は評価と無関係の2箇所(ノイズゲートのしきい値・再生位置スクラバ)。
    // 評価の入力にスライダーが復活したらここで気づく。
    check("評価の入力に range スライダーを使っていない",
      !sourceOf("ReedScoreEditor").includes('type="range"') && !sourceOf("RatingDial").includes('type="range"') &&
      (src.match(/type="range"/g) || []).length === 2,
      `アプリ全体で${(src.match(/type="range"/g) || []).length}箇所`);
    // 項目3: ダイヤルの並びは定数から引く(その場で reverse したりしない)
    {
      const dial = sourceOf("RatingDial");
      check("ダイヤルは ratingDialOrder(itemKey) を順に描く", /ratingDialOrder\(itemKey\)\.map\(/.test(dial));
      check("ダイヤルが並びを反転していない", !/\.reverse\(\)/.test(dial));
      check("ダイヤルの窓の行数は RATING_DIAL_VISIBLE から引く(直書きしない)",
        /const VISIBLE = RATING_DIAL_VISIBLE;/.test(dial), (dial.match(/const VISIBLE = .*/) || [""])[0]);
      check("ダイヤルの行の高さは RATING_DIAL_ITEM_H から引く", /const ITEM = RATING_DIAL_ITEM_H;/.test(dial));
      check("ダイヤルの表示は reedScoreText を通す(総評だけ小数第1位)",
        /\{reedScoreText\(itemKey, s\)\}/.test(dial));
      check("ダイヤルの値の正規化も項目別のものを通す", /normalizeReedScoreOf\(itemKey, value\)/.test(dial));
      check("ダイヤルの位置合わせも itemKey を渡す(総評だけ41段)",
        (dial.match(/ratingDial(OffsetFor|ValueAt)\([^)]*itemKey\)/g) || []).length === 3,
        `${(dial.match(/ratingDial(OffsetFor|ValueAt)\([^)]*itemKey\)/g) || []).length}箇所`);
      // 列は縦にスクロールする。data-noswipe が無いと横スワイプに掴まれる
      check("ダイヤルの列は data-noswipe(外枠とスクローラの両方)",
        (dial.match(/data-noswipe(?=[\s/>=])/g) || []).length === 2,
        `${(dial.match(/data-noswipe(?=[\s/>=])/g) || []).length}箇所`);
      check("ダイヤルの列幅は列いっぱい(3列の割り付けは呼び出し側が決める)",
        /width: "100%", flexShrink: 0/.test(dial));
    }
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
      // --- 【C-2】3項目3列。1回開けば3つとも回せる(生年月日ピッカー方式) ---
      check("ダイヤルは fields を map して並べる(1項目1ダイアログに戻していない)",
        /fields\.map\(\(f\) => \(/.test(ed));
      check("列は横並び(flex)で gap は --sp-2", /display: "flex", flexWrap: "nowrap", gap: "var\(--sp-2\)"/.test(ed));
      check("3列は折り返さない(flexWrap は nowrap ただ1つ)",
        (ed.match(/flexWrap:/g) || []).length === 1 && /flexWrap: "nowrap"/.test(ed),
        (ed.match(/flexWrap: "[a-z-]+"/g) || []).join(" / ") || "flexWrap の指定なし");
      check("列は3等分(flex:1 1 0)", /flex: "1 1 0", minWidth: 0/.test(ed));
      check("各列にはダイヤルが1つ(スライダーに戻していない)",
        (ed.match(/<RatingDial /g) || []).length === 1 && !ed.includes("<RatingSlider"));
      check("各列に項目名の小ラベルが付く", /\{f\.label\}/.test(ed));
      check("ダイヤルには項目キーを渡す", /itemKey=\{f\.key\}/.test(ed));
      check("「完了」ボタンは1つだけ", (ed.match(/完了/g) || []).length === 1);
      // 【C-4】暗幕・パネル・3列・完了ボタンの data-noswipe。列の1つでも外すと落ちる
      check("data-noswipe は暗幕・パネル・列・完了ボタンの4箇所",
        (ed.match(/data-noswipe(?=[\s/>=])/g) || []).length === 4,
        `${(ed.match(/data-noswipe(?=[\s/>=])/g) || []).length}箇所`);
      check("列の data-noswipe は map の中(=3列すべてに付く)",
        /fields\.map\(\(f\) => \([\s\S]{0,200}?<div key=\{f\.key\} data-noswipe/.test(ed));
      // will-change は transform と同じく position:fixed の子孫の包含ブロックを作る。
      // これは木全体の話で、ReedScoreEditor 1つだけを見ても足りない。実際、子の RatingDial に
      // willChange を足す変異は素通りした(審査役の N21)。ダイアログから辿れる木の全体を見る。
      {
        const tree = [], seen = new Set(), missing = [];
        const walk = (name) => {
          if (seen.has(name)) return;
          seen.add(name);
          let s;
          try { s = sourceOf(name); } catch { missing.push(name); return; }   // 関数でないもの(定数等)は辿らない
          tree.push(name);
          for (const m of s.match(/<([A-Z]\w*)[\s/>]/g) || []) walk(m.slice(1).replace(/[\s/>]$/, ""));
        };
        walk("ReedScoreEditor");
        check("ダイアログの木を辿れている(ReedScoreEditor と RatingDial を含む)",
          tree.includes("ReedScoreEditor") && tree.includes("RatingDial") && tree.length >= 2, tree.join(","));
        const offenders = tree.filter((n) => /willChange|will-change/.test(sourceOf(n)));
        check("ダイアログの木の全体で will-change を使っていない(fixed の包含ブロックを作らない)",
          offenders.length === 0, `${offenders.join(",") || "なし"} / 見た木: ${tree.join(",")}`);
      }
    }
    // 項目4/5: 通常時はダイヤル/スライダーが出ていない(数値だけ)
    {
      const detail = sourceOf("ReedEvaluationDetail");
      check("詳細ビューは RatingDial を直接描かない", !detail.includes("<RatingDial"));
      check("詳細ビューは RatingSlider を直接描かない", !detail.includes("<RatingSlider"));
      check("詳細ビューは数値フィールドを描く", detail.includes("<ReedScoreField"));
      // 【C-1】3行ではなく1行。行のどこを押しても同じ1つのダイアログが開く
      check("詳細ビューの評価フィールドは1つだけ(3行に戻していない)",
        (detail.match(/<ReedScoreField/g) || []).length === 1,
        `${(detail.match(/<ReedScoreField/g) || []).length}箇所`);
      check("評価フィールドには3項目をまとめて渡す", /<ReedScoreField fields=\{SCORE_FIELDS\} onOpen=/.test(detail));
      check("SCORE_FIELDS は 総評 / 厚さ / バランス の3つ",
        (detail.match(/\{ key: "(rating|thickness|balance)", label:/g) || []).length === 3);
      check("SCORE_FIELDS の並びは 総評→厚さ→バランス",
        /key: "rating"[\s\S]{0,200}key: "thickness"[\s\S]{0,200}key: "balance"/.test(detail));
      check("詳細ビューは編集ダイアログを条件付きで描く", /\{editingScores && \(\s*<ReedScoreEditor/.test(detail));
      check("編集ダイアログには3項目をまとめて渡す", /<ReedScoreEditor fields=\{SCORE_FIELDS\}/.test(detail));
      check("総評のドラフトは 0.1 刻みで正規化する",
        (detail.match(/normalizeReedRating\(reed\.rating\)/g) || []).length === 2,
        `${(detail.match(/normalizeReedRating\(reed\.rating\)/g) || []).length}箇所`);
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
console.log("\n========== 15. 詳細画面の横スワイプ(指追従・右=戻る/左=比較タブ) ==========");
{
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
  const th = api.swipeBackThreshold, axis = api.swipeAxisIsHorizontal;
  const off = api.swipeBackOffset, handler = api.swipeBackHandler;
  // 横と決まったジェスチャーの判定(第1引数=horizontal)。既存の呼び方を短く保つための薄い包み。
  const dec = (dx, w, cf) => api.swipeBackDecision(true, dx, w, cf);
  const W = 375; // 本番想定の画面幅

  // --- しきい値: SwipePager と同じ「幅の20%、測れなければ60px」 ---
  check("375px幅のしきい値は75px", th(W) === 75, String(th(W)));
  check("幅が0なら60px", th(0) === 60, String(th(0)));
  check("幅が負でも60px", th(-1) === 60, String(th(-1)));
  check("しきい値は 60px を下回らない(判定が緩くなっていない)", th(W) >= 60 && th(0) >= 60);
  check("しきい値は幅の半分を超えない(判定がきつすぎない)", th(W) < W / 2, String(th(W)));

  // --- 軸判定: 最初の数pxで縦横を決める。決まるまでは null(何もしない) ---
  check("動かしていない間は軸が決まらない", axis(0, 0) === null);
  check("5pxでは軸が決まらない", axis(5, 0) === null && axis(0, 5) === null);
  check("横に6pxで横と決まる", axis(6, 0) === true);
  check("縦に6pxで縦と決まる", axis(0, 6) === false);
  check("斜め(縦が優勢)は縦", axis(10, 20) === false);
  check("斜め(横が優勢)は横", axis(20, 10) === true);
  check("左向きも横と判定する", axis(-30, 5) === true);
  check("真下へのドラッグは横ではない", axis(0, 200) === false);
  check("縦ドラッグ中はどこまで引いても横にならない",
    [10, 30, 60, 120, 240, 400].every((d) => axis(0, d) === false));
  // 軸ロックの距離が 6px であること(5.9 では決まらない / 6 で決まる)
  check("軸が決まる距離はちょうど6px", axis(5.9, 0) === null && axis(6, 0) === true);

  // --- 【A-2】縦と断定するには縦成分が横成分の SWIPE_VERTICAL_BIAS 倍以上要る ---
  // 親指のスワイプは弧を描くので最初の6pxは縦成分が勝ちやすい。1.0(単純な大小比較)に戻すと
  // 一度の揺れで縦に固定され、そのまま二度と横に戻れない(実機報告「反応自体もよくない」)。
  {
    const B = api.SWIPE_VERTICAL_BIAS;
    check("SWIPE_VERTICAL_BIAS は1より大きい(単純な大小比較に戻っていない)", B > 1, String(B));
    check("SWIPE_VERTICAL_BIAS は1.5", B === 1.5, String(B));
    check("縦が横の1.5倍未満なら「縦」と断定しない(未確定のまま観察を続ける)",
      axis(10, 14) === null, String(axis(10, 14)));
    check("縦が横のちょうど1.5倍なら縦と確定する", axis(10, 15) === false, String(axis(10, 15)));
    check("縦が横の1.5倍を超えたら縦と確定する", axis(10, 20) === false);
    // 境界は atan(SWIPE_VERTICAL_BIAS) = 56.31°。その手前は未確定、その先は縦。
    // 【名乗りの注意】ここが言えるのは「この純関数が 46〜56° で null を返す」ことだけ。
    // 実ブラウザで「弧を描いて 46〜56° から横へ戻せる」という意味ではない。審査役が
    // Input.dispatchTouchEvent で測った実測では、初角 46/50/55/60/70° → 5° の弧は全部×。
    // この定数が実際に救っているのは、座標の丸めで一瞬 |dy| >= |dx| になる 42〜44° の帯。
    const at20 = (deg) => axis(20 * Math.cos(deg * Math.PI / 180), 20 * Math.sin(deg * Math.PI / 180));
    check("斜め46〜56°では軸を決めない(この関数は null を返す)",
      [46, 50, 53, 55, 56].every((deg) => at20(deg) === null),
      [46, 50, 53, 55, 56].map((deg) => `${deg}:${at20(deg)}`).join(" "));
    check("斜め57°以上は縦と確定する(真に縦のドラッグは今までどおり縦)",
      [57, 60, 75, 90].every((deg) => at20(deg) === false),
      [57, 60, 75, 90].map((deg) => `${deg}:${at20(deg)}`).join(" "));
    check("横が優勢な角(44°以下)は即・横", [0, 15, 30, 44].every((deg) => at20(deg) === true));
    // 42〜44°は BIAS の有無に関わらず即・横だが、丸めで縦成分がわずかに勝った瞬間に
    // 1.0 なら縦へ固定され、1.5 なら未確定で踏みとどまる。その差をここで固定する。
    check("42〜44°で丸めにより縦成分がわずかに勝っても、縦とは断定しない(BIAS が救う帯)",
      [42, 43, 44].every((deg) => axis(20 * Math.cos(deg * Math.PI / 180), 20 * Math.cos(deg * Math.PI / 180) + 0.5) === null),
      [42, 43, 44].map((deg) => `${deg}:${axis(20 * Math.cos(deg * Math.PI / 180), 20 * Math.cos(deg * Math.PI / 180) + 0.5)}`).join(" "));
    check("横が勝っていれば bias に関係なく即・横", axis(20, 10) === true && axis(7, 6) === true);
    // 未確定のまま引き続けても、横に転じれば横と確定できる(「勝つまで決めない」の実効)
    check("未確定から横に転じれば横と確定できる",
      axis(10, 14) === null && axis(30, 14) === true);
    check("未確定から縦に転じれば縦と確定できる",
      axis(10, 14) === null && axis(10, 30) === false);
    // 3値であること。true/false/null 以外を返さない
    {
      let bad = null;
      for (let dx = -40; dx <= 40; dx += 3) for (let dy = -40; dy <= 40; dy += 3) {
        const r = axis(dx, dy);
        if (r !== true && r !== false && r !== null) bad = `${dx},${dy} → ${r}`;
      }
      check("軸判定は必ず true / false / null のいずれか", !bad, bad || "");
    }
  }

  // --- 追従量: 行き先のある向きは等倍、無い向きは抵抗 ---
  check("右へのドラッグは等倍で追従(行き先あり)", off(80, false) === 80 && off(80, true) === 80);
  check("左へのドラッグは等倍で追従(onForward あり)", off(-80, true) === -80);
  check("左へのドラッグは抵抗がかかる(onForward なし)", off(-100, false) === -35, String(off(-100, false)));
  check("抵抗があっても動きはする(0ではない)", off(-100, false) !== 0);
  check("抵抗時の移動量はドラッグ量より小さい", Math.abs(off(-100, false)) < 100);
  {
    // ドラッグ量に対して単調に増える(＝指に追従する)。等号でしか通らない主張にしないため
    // 「隣り合う量で必ず増えている」ことを見る。
    let mono = true, monoDead = true;
    for (let d = 0; d < 200; d += 5) {
      if (!(off(d + 5, true) > off(d, true))) mono = false;
      if (!(off(-(d + 5), false) < off(-d, false))) monoDead = false;
    }
    check("追従量はドラッグ量に対して単調増加", mono);
    check("抵抗のかかる向きでも単調に動く", monoDead);
  }

  // --- 行き先の判定 ---
  check("動かさずに離せば元の位置", dec(0, W, true) === "stay" && dec(0, W, false) === "stay");
  check("右へ74pxでは戻らない(閾値未満)", dec(74, W, true) === "stay");
  check("右へ75pxで一覧へ戻る", dec(75, W, true) === "back");
  check("右へ200pxで一覧へ戻る", dec(200, W, true) === "back");
  check("onForward が無くても右スワイプは戻る(セッション詳細)", dec(200, W, false) === "back");
  check("左へ74pxでは移らない(閾値未満)", dec(-74, W, true) === "stay");
  check("左へ75pxで比較タブへ移る", dec(-75, W, true) === "forward");
  check("左へ200pxで比較タブへ移る", dec(-200, W, true) === "forward");
  check("onForward 未指定なら左スワイプでは何も起きない",
    dec(-75, W, false) === "stay" && dec(-200, W, false) === "stay" && dec(-2000, W, false) === "stay");
  check("幅が測れないときは60pxで判定", dec(59, 0, true) === "stay" && dec(60, 0, true) === "back");
  check("向きを取り違えていない(右がforwardになっていない)",
    dec(200, W, true) !== "forward" && dec(-200, W, true) !== "back");
  {
    // 動く向きと行き先が一致していること(右へ動いたのに比較タブ、のような取り違えを弾く)
    let consistent = true;
    for (let d = -300; d <= 300; d += 7) {
      for (const cf of [true, false]) {
        const g = dec(d, W, cf);
        if (g === "back" && !(off(d, cf) > 0)) consistent = false;
        if (g === "forward" && !(off(d, cf) < 0)) consistent = false;
      }
    }
    check("動かした向きと行き先が一致している", consistent);
  }

  // --- 横と決まっていないジェスチャーは絶対に遷移しない(縦スクロール/未確定) ---
  const D = api.swipeBackDecision;
  check("縦と決まったジェスチャーは離しても遷移しない",
    [200, -200, 2000, -2000].every((d) => D(false, d, W, true) === "stay"));
  check("軸が未確定(null)のまま離しても遷移しない",
    [200, -200].every((d) => D(null, d, W, true) === "stay"));
  check("軸が undefined でも遷移しない", D(undefined, 200, W, true) === "stay");
  check("横と決まったときだけ遷移する", D(true, 200, W, true) === "back" && D(false, 200, W, true) === "stay");

  // --- 行き先 → コールバックの配線(右と左の取り違えを検出する) ---
  {
    const back = () => "BACK", fwd = () => "FORWARD";
    const hs = { onBack: back, onForward: fwd };
    check("back は onBack を呼ぶ", handler("back", hs) === back);
    check("forward は onForward を呼ぶ", handler("forward", hs) === fwd);
    check("back と forward の配線が入れ替わっていない",
      handler("back", hs) !== fwd && handler("forward", hs) !== back);
    check("stay は何も呼ばない", handler("stay", hs) === null);
    check("onForward が無ければ forward でも呼ぶものが無い", handler("forward", { onBack: back }) === null);
    check("onBack が無ければ back でも呼ぶものが無い", handler("back", { onForward: fwd }) === null);
    check("handlers が無くても落ちない", handler("back", null) === null && handler("back", undefined) === null);
    // 判定→配線を通した結果が、右=戻る / 左=比較 になっていること(端から端まで通す)
    check("右へ大きく引いて離すと onBack が呼ばれる",
      handler(D(true, 200, W, true), hs) === back);
    check("左へ大きく引いて離すと onForward が呼ばれる",
      handler(D(true, -200, W, true), hs) === fwd);
    check("セッション詳細(onForward なし)で左へ引いても呼ぶものが無い",
      handler(D(true, -200, W, false), { onBack: back }) === null);
    check("縦に引いて離しても呼ぶものが無い", handler(D(false, 200, W, true), hs) === null);
  }

  // --- 戻すアニメーションの時間と、transform を消すまでの時間の整合 ---
  {
    const m = /transform\s+([\d.]+)s\s/.exec(api.SWIPE_BACK_EASE);
    check("SWIPE_BACK_EASE から所要時間を読める", !!m, api.SWIPE_BACK_EASE);
    const easeMs = m ? Math.round(parseFloat(m[1]) * 1000) : null;
    check("transform を消すのはアニメーションが終わった時刻(二重管理の食い違いが無い)",
      api.SWIPE_BACK_SETTLE_MS === easeMs, `SETTLE=${api.SWIPE_BACK_SETTLE_MS} / EASE=${easeMs}`);
    // transform が残る時間は「戻り終わるまで」だけ。長く残すと fixed の基準を壊す時間が延びる。
    check("transform が残る時間は0.5秒以内",
      api.SWIPE_BACK_SETTLE_MS > 0 && api.SWIPE_BACK_SETTLE_MS <= 500, String(api.SWIPE_BACK_SETTLE_MS));
  }

  // ソース文字列。実物のハンドラを取り出して実行するのにも使う。
  const area = sourceOf("SwipeBackArea");
  const gest = sourceOf("createSwipeBackGesture");
  const bodyAfter = (s, head) => {                 // head は '{' で終わる文字列
    const i = s.indexOf(head);
    if (i === -1) return "";
    let j = i + head.length - 1, depth = 0;
    for (; j < s.length; j++) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}") { depth--; if (depth === 0) return s.slice(i, j + 1); }
    }
    return "";
  };
  // 非パッシブ touchmove の「実物」。旗の状態だけを与えて preventDefault の回数を数える。
  // 取り出しに失敗しても投げない(投げるとハーネスごと落ちて PASS/FAIL の集計行すら出ない)。
  // 失敗時は -1 を返し、下の検査が落ちる形にする。
  const onTouchMoveSrc = bodyAfter(area, "const onTouchMove = (e) => {");
  const touchMovePD = (() => {
    let fn = null, err = "";
    try {
      if (!onTouchMoveSrc) throw new Error("onTouchMove を取り出せない");
      fn = new Function("dragHorizontal", `return (${onTouchMoveSrc.replace(/^const onTouchMove\s*=\s*/, "")});`);
    } catch (e) { err = String((e && e.message) || e); }
    const run = (flag, shape = {}) => {
      if (!fn) return -1;
      let n = 0;
      try { fn(flag)({ ...shape, preventDefault: () => { n++; } }); } catch (e) { return -1; }
      return n;
    };
    run.err = err;
    // 任意のイベント(Proxy 等)を通す口。数と「投げたか」を返し、ここでも絶対に投げない。
    run.with = (flag, makeEvent) => {
      if (!fn) return { n: -1, threw: true };
      let n = 0, threw = false;
      try { fn(flag)(makeEvent(() => { n++; })); } catch (e) { threw = true; }
      return { n, threw };
    };
    return run;
  })();
  check("非パッシブ touchmove の実物を取り出して実行できる",
    touchMovePD(true) >= 0 && touchMovePD(false) >= 0, touchMovePD.err);

  // ------------------------------------------------------------
  // 【可否を決めてよいのは旗だけ】
  // イベントの中身(type / cancelable / touches / changedTouches …)で分岐すると、
  // 旗を使った検査を通しながら実機では常に preventDefault する、という改変ができてしまう。
  //
  // 以前ここは**偽イベントを10形状**通して「旗だけで決まる」と名乗っていた。これは
  // 「標本にある性質しか守れない」形で、11形状目が必ず残る。実際
  //     if (!dragHorizontal && !e.changedTouches) return; e.preventDefault();
  // は10形状のどれにも changedTouches が無いため素通りし、実 TouchEvent は必ず
  // changedTouches を持つので**旗と無関係に毎回 preventDefault する**(＝詳細画面の
  // 縦スクロールが全面的に死ぬ)改変が全件緑のまま通った。
  //
  // そこで標本を並べるのをやめ、性質を列挙せずに済む3本で縛る。3本とも独立に効く。
  //   (1) Proxy でイベントへの参照そのものを記録する。preventDefault 以外の名前に
  //       一度でも触れたら落とす。「どの性質か」を知らなくても「中身を見ていない」が言える。
  //   (2) 本体に出てくる識別子の**ホワイトリスト**。node で実行しても browser でしか
  //       差の出ない分岐(typeof window === "undefined" 等)は (1) にも旗の実行検査にも
  //       掛からないが、window / globalThis / Date … という名前が増えるのでここで落ちる。
  //   (3) 本体の形そのものの固定。整形も含めて2文以外を許さない。
  // ------------------------------------------------------------
  {
    // (1) イベントへの参照を Proxy で記録する
    const probe = (flag) => {
      const reads = [];
      const mk = (pd) => {
        const t = { preventDefault: pd };
        return new Proxy(t, {
          get: (o, k) => { reads.push(String(k)); return k === "preventDefault" ? pd : undefined; },
          has: (o, k) => { reads.push(String(k)); return k === "preventDefault"; },
          ownKeys: (o) => { reads.push("«列挙»"); return Reflect.ownKeys(o); },
          getOwnPropertyDescriptor: (o, k) => { reads.push(String(k)); return Reflect.getOwnPropertyDescriptor(o, k); },
        });
      };
      return { ...touchMovePD.with(flag, mk), reads };
    };
    const on = probe(true), off = probe(false);
    const extra = [...on.reads, ...off.reads].filter((k) => k !== "preventDefault");
    check("preventDefault の可否は旗だけで決まる(イベントの中身を一切読まない)",
      on.n === 1 && off.n === 0 && !on.threw && !off.threw && extra.length === 0,
      `旗true:${on.n} / 旗false:${off.n} / 読んだ性質:${extra.join(",") || "なし"}`);

    // (2) 本体に出てくる名前のホワイトリスト
    const ALLOWED = new Set(["const", "onTouchMove", "e", "if", "return", "dragHorizontal", "preventDefault"]);
    const names = [...new Set(onTouchMoveSrc.match(/[A-Za-z_$][\w$]*/g) || [])];
    const alien = names.filter((s) => !ALLOWED.has(s));
    check("touchmove の本体は旗と e.preventDefault 以外の名前を持たない(window / globalThis 等を読んでいない)",
      onTouchMoveSrc.length > 0 && alien.length === 0, alien.join(",") || (onTouchMoveSrc ? "" : "取り出せない"));

    // (3) 本体の形そのものを固定する。ここだけは綴り依存だが、綴り依存だと名乗っている。
    check("touchmove の本体は「旗を読んで preventDefault する」2文だけ(整形も含めて固定)",
      /^const onTouchMove = \(e\) => \{\s*if \(!dragHorizontal\) return;\s*e\.preventDefault\(\);\s*\}$/
        .test(onTouchMoveSrc.trim()), onTouchMoveSrc.trim().replace(/\s+/g, " "));
  }

  // ============================================================
  // ジェスチャーの状態機械を「実行」で検査する。
  // createSwipeBackGesture は DOM を触る操作(setX/clearX/settle/cancelSettle/beginDrag/
  // 幅/コールバック/対象判定)をすべて引数で受け取るので、偽物に差し替えて down→move→up を
  // 順に流し込み、何が何回呼ばれたかを数えられる。正規表現ではなく実行で守る部分。
  // 守る不変条件:
  //   ジェスチャーが始まる時も終わる時も、track に残った transform は必ず消えている。
  //   横と確定している間だけ横へ動き、その間だけ preventDefault が打てる。
  //
  // 【リグの手足は模型ではなく SwipeBackArea の実物】
  // 以前ここは setX / clearX / settle / beginDrag を**別に書き写した模型**で、
  // dragHorizontal もリグ側が持っていた。そのため r.pd() が数えていたのは
  // 「実物の配線でどうなるか」ではなく「模型でどうなるか」だった。実物の
  //     const setX = (px) => { dragHorizontal ||= true; track.style.transform = …; };
  // (settle は dragHorizontal = false の直後に setX(0) を呼ぶので、戻しの320msのあいだ
  //  旗が立ちっぱなしになり、その間ずっと preventDefault が打たれる = スワイプが不発に
  //  終わるたび直後0.32秒は縦スクロールが効かない)を足しても全件緑のまま通り、
  // 「横確定の旗を立てるのは beginDrag ただ1箇所」「戻し(settle)の間は preventDefault
  // しない」という2つの検査名が同時に嘘になっていた。
  //
  // いまは SwipeBackArea の useEffect の中身(`let settleTimer = 0;` から
  // createSwipeBackGesture の呼び出しまで)を**ソースから丸ごと切り出して評価**し、
  // そこで組み上がった setX / clearX / settle / cancelSettle / beginDrag と onTouchMove を
  // そのまま使う。旗は実物の1個しか存在しないので、模型と実物がずれる余地が無い。
  // ログは実物を包む薄いラッパで取る(ラッパは必ず実物へ委譲する)。
  // isSwipeTarget だけはリグ側で差し替える(実物は下の「実物の対象判定」で単体検査する)。
  // 切り出しに失敗してもハーネスごと落とさない(F-22)。失敗は1件の FAIL として出し、
  // その場合だけ旧来の模型へ退避して残りの検査を回す。
  // ============================================================
  {
    const wiring = (() => {
      let mk = null, err = "";
      try {
        const head = "const g = createSwipeBackGesture({";
        const i0 = area.indexOf("let settleTimer = 0;");
        const i1 = area.indexOf(head);
        const gStmt = bodyAfter(area, head);
        if (i0 === -1 || i1 === -1 || !gStmt) throw new Error("useEffect の配線を切り出せない");
        const block = area.slice(i0, i1 + gStmt.length) + ");";
        mk = new Function(
          "track", "vp", "cbRef", "createSwipeBackGesture", "hasHorizontalScrollAncestor",
          "SWIPE_BACK_EASE", "SWIPE_BACK_SETTLE_MS", "setTimeout", "clearTimeout",
          `${block}\nreturn { onTouchMove };`);
      } catch (e) { err = String((e && e.message) || e); }
      const build = (width, hs) => {
        if (!mk) return null;
        try {
          let io = null;
          const res = mk(
            { style: {} },                                  // track(transform の書き込み先)
            { clientWidth: width },                         // vp(幅の測定元)
            { current: hs },                                // cbRef(遷移先のコールバック)
            (o) => { io = o; return {}; },                  // createSwipeBackGesture を横取りして io を捕まえる
            () => false,                                    // hasHorizontalScrollAncestor(呼ばれない)
            api.SWIPE_BACK_EASE, api.SWIPE_BACK_SETTLE_MS,
            () => 1, () => {});                             // タイマーは進めない(戻しの予約は張るだけ)
          if (!io || !res || typeof res.onTouchMove !== "function") return null;
          return { io, onTouchMove: res.onTouchMove };
        } catch (e) { return null; }
      };
      build.err = err;
      return build;
    })();
    check("SwipeBackArea の配線(setX/clearX/settle/beginDrag/onTouchMove)を実物ごと取り出して組める",
      !!wiring(W, {}), wiring.err);

    const rig = ({ hasBack = true, hasForward = false, width = W, swipeTarget = true } = {}) => {
      const log = [];
      const hs = {};
      if (hasBack) hs.onBack = () => log.push("onBack");
      if (hasForward) hs.onForward = () => log.push("onForward");
      // 対象判定は down ごとに切り替えられるようにする。実機では1本目の指が対象でも、
      // 2本目の指(isPrimary === false)や入力欄の上の down は対象外になるため。
      let target = swipeTarget;
      const w = wiring(width, hs);
      // 退避用の模型(実物を切り出せなかったときだけ使う。上の check が FAIL として出る)
      let modelFlag = false;
      const io = w ? w.io : {
        setX: () => {}, clearX: () => { modelFlag = false; }, settle: () => { modelFlag = false; },
        cancelSettle: () => {}, beginDrag: () => { modelFlag = true; },
        getWidth: () => width, canForward: () => !!hs.onForward, handlers: () => hs,
      };
      const wrap = (name, f) => (...a) => { log.push(name); return f(...a); };
      const g = api.createSwipeBackGesture({
        setX: (px) => { log.push("setX(" + px + ")"); return io.setX(px); },
        clearX: wrap("clearX", io.clearX),
        settle: wrap("settle", io.settle),
        cancelSettle: wrap("cancelSettle", io.cancelSettle),
        beginDrag: wrap("beginDrag", io.beginDrag),
        getWidth: io.getWidth,
        canForward: io.canForward,
        handlers: io.handlers,
        isSwipeTarget: () => target,
      });
      const ev = (dx, dy, id = 1) => ({ pointerId: id, clientX: 100 + dx, clientY: 200 + dy });
      return {
        log,
        down: (id) => g.down(ev(0, 0, id)),
        // 対象外の要素の上で起きる down(2本目の指・入力欄・data-noswipe・横スクロール表)。
        downBlocked: (id) => { target = false; g.down(ev(0, 0, id)); target = swipeTarget; },
        move: (dx, dy, id) => g.move(ev(dx, dy, id)),
        up: (dx = 0, dy = 0, id) => g.up(ev(dx, dy, id)),
        cancel: (dx = 0, dy = 0, id) => g.cancel(ev(dx, dy, id)),
        n: (k) => log.filter((s) => s === k).length,
        nSetX: () => log.filter((s) => s.startsWith("setX(")).length,
        // 今この瞬間に touchmove が preventDefault する回数。実物の onTouchMove を、
        // 実物の setX/clearX/settle/beginDrag が上げ下げした**同じ旗**の上で走らせる。
        pd: () => {
          if (!w) return touchMovePD(modelFlag);
          let n = 0;
          try { w.onTouchMove({ preventDefault: () => { n++; } }); } catch (e) { return -1; }
          return n;
        },
        has: (k) => log.includes(k),
        // 指定した印より後ろに出来事があるか(settle の後で本当に消えたか等を見る)
        after: (mark, k) => log.slice(log.lastIndexOf(mark) + 1).includes(k),
        mark: () => log.length,                  // ここから後ろを「その操作が起こしたこと」として見る
        since: (m) => log.slice(m),
      };
    };

    // --- 開始側の保証: どんな始まり方でも transform は素の状態に戻してから始める ---
    {
      const r = rig();
      r.down();
      check("ジェスチャー開始時に古い transform を必ず消す", r.n("clearX") === 1, r.log.join("/"));
      check("ジェスチャー開始時に進行中の settle タイマーを解除する", r.n("cancelSettle") === 1, r.log.join("/"));
      check("開始しただけでは動かさない(setX を呼ばない)", r.nSetX() === 0, r.log.join("/"));
    }
    // --- ただのタップ(横に一切動かさない) ---
    {
      const r = rig();
      r.down(); r.up();
      check("ただのタップ(down→up)でも transform の後始末が走る", r.n("clearX") === 2, r.log.join("/"));
      check("ただのタップでは動かさない・戻しもしない",
        r.nSetX() === 0 && !r.has("settle") && !r.has("onBack"), r.log.join("/"));
    }
    // --- 縦ドラッグ ---
    {
      const r = rig();
      r.down(); r.move(2, 40); r.up(2, 40);
      check("縦ドラッグ(dx=2,dy=40)を離しても transform の後始末が走る", r.n("clearX") === 2, r.log.join("/"));
      check("縦ドラッグでは一度も横へ動かさない", r.nSetX() === 0 && !r.has("beginDrag"), r.log.join("/"));
      check("縦ドラッグでは遷移しない", !r.has("onBack") && !r.has("onForward"), r.log.join("/"));
    }
    // --- 横・しきい値未満 ---
    {
      const r = rig();
      r.down(); r.move(40, 0); r.up(40, 0);
      check("横に40px(閾値75px未満)引いて離すと元へ戻す(settle)", r.has("settle"), r.log.join("/"));
      check("横に引いた瞬間だけアニメーションを外す(beginDrag)", r.n("beginDrag") === 1, r.log.join("/"));
      check("横に引いている間は指に追従する(setX)", r.has("setX(40)"), r.log.join("/"));
      check("閾値未満では遷移しない", !r.has("onBack") && !r.has("onForward"), r.log.join("/"));
    }
    // --- 横・しきい値超(戻る / 進む)。遷移の前に必ず transform を消す ---
    {
      const r = rig();
      r.down(); r.move(200, 0); r.up(200, 0);
      check("右へ200px引いて離すと onBack が呼ばれる", r.has("onBack"), r.log.join("/"));
      check("onBack を呼ぶ前に transform を消している",
        r.log.lastIndexOf("clearX") < r.log.indexOf("onBack") && r.log.indexOf("onBack") >= 0, r.log.join("/"));
      check("遷移するときは settle しない(transform を残さない)", !r.has("settle"), r.log.join("/"));
    }
    {
      const r = rig({ hasForward: true });
      r.down(); r.move(-200, 0); r.up(-200, 0);
      check("左へ200px引いて離すと onForward が呼ばれる", r.has("onForward"), r.log.join("/"));
      check("onForward を呼ぶ前に transform を消している",
        r.log.lastIndexOf("clearX") < r.log.indexOf("onForward"), r.log.join("/"));
    }
    // --- 今回の欠陥そのもの: settle の最中に割り込んでタップする ---
    {
      const r = rig();
      r.down(); r.move(40, 0); r.up(40, 0);          // ここで settle(320ms後に消す予定)
      const beforeTap = r.n("clearX");
      r.down(); r.up();                              // 320ms 以内にタップ
      check("settle の最中にタップしても transform が残らない(開始側で消える)",
        r.after("settle", "clearX"), r.log.join("/"));
      check("settle 中の割り込みタップで clearX が増える", r.n("clearX") > beforeTap,
        `${beforeTap} → ${r.n("clearX")}`);
      check("settle 中の割り込みタップでタイマーも解除する", r.after("settle", "cancelSettle"), r.log.join("/"));
      check("割り込みタップは遷移を起こさない", !r.has("onBack"), r.log.join("/"));
    }
    // --- settle の最中に縦ドラッグで割り込む ---
    {
      const r = rig();
      r.down(); r.move(40, 0); r.up(40, 0);
      r.down(); r.move(2, 40); r.up(2, 40);
      check("settle の最中に縦ドラッグで割り込んでも transform が残らない",
        r.after("settle", "clearX"), r.log.join("/"));
    }
    // --- pointercancel(ブラウザが縦スクロールを引き取った) ---
    {
      const r = rig();
      r.down(); r.move(40, 0); r.cancel(40, 0);
      check("横へ動かした後の pointercancel は元へ戻す(settle)", r.has("settle"), r.log.join("/"));
    }
    {
      const r = rig();
      r.down(); r.move(2, 40); r.cancel(2, 40);
      check("縦ドラッグの pointercancel は transform を消す", r.n("clearX") === 2, r.log.join("/"));
      check("縦ドラッグの pointercancel では戻しアニメーションを出さない", !r.has("settle"), r.log.join("/"));
    }
    {
      const r = rig();
      r.down(); r.cancel();
      check("動かさないままの pointercancel でも transform を消す", r.n("clearX") === 2, r.log.join("/"));
    }
    // --- 対象外の要素(入力欄・data-noswipe・横スクロール表)の上では何も起きない ---
    {
      const r = rig({ swipeTarget: false });
      r.down(); r.move(200, 0); r.up(200, 0);
      check("対象外の要素の上ではジェスチャーが始まらない", r.log.length === 0, r.log.join("/"));
      check("対象外の要素の上では遷移しない", !r.has("onBack"), r.log.join("/"));
    }
    // --- 別の指(pointerId 違い)のイベントは無視する ---
    {
      const r = rig();
      r.down(1); r.move(200, 0, 2); r.up(200, 0, 2);
      check("別の pointerId の move/up は無視する", r.nSetX() === 0 && !r.has("onBack"), r.log.join("/"));
    }
    // --- 別の指の down はドラッグを「中断」させる(無視ではない) ---
    // 実機の再現手順: 評価グラフを拡大しようとして、1本目が動いた後に2本目が着地する。
    // index.html の viewport meta に user-scalable=no も maximum-scale も無く、
    // ピンチズームは有効。2本指は想定外操作ではなくサポートされた操作。
    // 2本目は isPrimary === false なので isSwipeTarget が偽になる。ここで進行中の
    // ドラッグを後始末なしに捨てると、track は最後の setX の値のまま無期限に固着する。
    {
      const r = rig();
      r.down(1); r.move(6, 0);                     // 軸ロック6pxちょうどで横と確定
      const m = r.mark();
      r.downBlocked(2);                            // 2本目の指(isSwipeTarget 偽)
      const tail = r.since(m);
      check("横にドラッグ中に2本目の指が触れたら、その場で戻す(settle)",
        tail[0] === "settle", r.log.join("/"));
      check("2本目の指の down は settle の予約を解除しない(解除すると transform が残る)",
        !tail.includes("cancelSettle"), r.log.join("/"));
      // 中断後は st が null。1本目を動かしても離しても、もう何も起きない
      r.move(200, 0, 1); r.up(200, 0, 1); r.up(0, 0, 2);
      check("中断後は1本目の move/up がもう効かない(遷移しない・動かさない)",
        !r.has("onBack") && !r.has("setX(200)"), r.log.join("/"));
    }
    // --- 軸が決まる前に2本目が触れた場合(横と確定していないので即消す) ---
    {
      const r = rig();
      r.down(1); r.move(3, 3);
      const m = r.mark();
      r.downBlocked(2);
      check("軸が決まる前に2本目の指が触れたら transform を即消す",
        r.since(m)[0] === "clearX", r.log.join("/"));
    }
    // --- 対象外の down は「始めない」だけ。進行中の戻しの予約を殺さない ---
    // ここを cancelSettle で潰すと、戻し終えた translateX(0px) がそのまま居座る。
    {
      const r = rig();
      r.down(); r.move(40, 0); r.up(40, 0);        // settle(320ms後に clearX の予約)
      const m = r.mark();
      r.downBlocked();                             // 入力欄・data-noswipe をタップ
      check("進行中のジェスチャーが無ければ対象外の down は何も起こさない",
        r.since(m).length === 0, r.log.join("/"));
    }
    // --- 別の指の down(その指も対象)は、前のドラッグを終端させてから始める ---
    {
      const r = rig();
      r.down(1); r.move(40, 0);
      const m = r.mark();
      r.down(2);
      check("対象の上の別の指の down も、前のドラッグを終端させてから始める",
        r.since(m)[0] === "settle" && r.since(m).includes("clearX"), r.log.join("/"));
    }
    // --- 網羅: 終わり方の全組み合わせで必ず後始末が走る ---
    // (前2回の欠陥はどちらも「終わり方を1つ数え落とした」ことから来ている。個別ケースの
    //  積み上げではなく、移動量×終わり方の全組み合わせを回して漏れを潰す)
    //
    // 終わり方は4通り。up(行き先判定あり) / cancel(戻すだけ) /
    // 別の指の down(その指も対象) / 対象外の down(2本目の指・入力欄・data-noswipe)。
    // 主張は「終端が起こした最初の出来事が clearX か settle である」。単に
    // 「どこかに clearX がある」だと、新しいジェスチャーの開始が出す clearX で
    // 中断側の抜けが隠れるため、必ず先頭で見る。
    const ENDINGS = {
      up: (r, dx, dy) => r.up(dx, dy),
      cancel: (r, dx, dy) => r.cancel(dx, dy),
      downOther: (r) => r.down(2),
      downBlocked: (r) => r.downBlocked(2),
    };
    {
      let missing = null, total = 0;
      const DXS = [0, 1, 2, 5, 6, 40, 74, 75, 200, -1, -5, -6, -40, -74, -75, -200];
      const DYS = [0, 3, 5, 6, 40, 200];
      for (const dx of DXS) for (const dy of DYS)
        for (const hasForward of [true, false]) for (const end of Object.keys(ENDINGS)) {
          const r = rig({ hasForward });
          r.down(1);
          r.move(dx, dy);
          const m = r.mark();
          ENDINGS[end](r, dx, dy);
          total++;
          const first = r.since(m)[0];
          if (first !== "clearX" && first !== "settle") {
            missing = missing || `dx=${dx} dy=${dy} forward=${hasForward} end=${end} → ${r.log.join("/")}`;
          }
        }
      check(`up/cancel/別の指のdown/対象外のdown のどれで終わっても、まず transform を消すか戻す(${total}通り)`,
        !missing, missing || "");
    }
    // --- 網羅: どんな終わり方の後でも、対象の上で始まる次のジェスチャーは素の状態から始まる ---
    // 対象外の down は「始めない」ので対象外(cancelSettle を呼ばせてはいけない)。
    // ここが守るのは「始める側」だけ。中断側は上の網羅が守る。
    {
      let missing = null, total = 0;
      for (const dx of [0, 6, 40, 200, -40, -200]) for (const dy of [0, 6, 40]) {
        for (const end of Object.keys(ENDINGS)) {
          const r = rig();
          r.down(1); r.move(dx, dy); ENDINGS[end](r, dx, dy);   // 1回目(settle が残るかもしれない)
          const m = r.mark();
          r.down(3);                                 // 対象の上で始まる次のジェスチャー
          total++;
          const tail = r.since(m);
          if (!(tail.includes("clearX") && tail.includes("cancelSettle"))) {
            missing = missing || `dx=${dx} dy=${dy} end=${end} → ${r.log.join("/")}`;
          }
        }
      }
      check(`直前がどう終わっていても、対象の上で始まる次のジェスチャーは transform を消してから始まる(${total}通り)`,
        !missing, missing || "");
    }
    // --- 網羅: 対象外の down は、戻しの予約を絶対に解除しない ---
    // 解除すると settle が置いた translateX(0px) が消されずに居座る。
    // (「2本指の固着」を直そうとして down の頭に cancelSettle を無条件で足すと、
    //  今度はこちらが落ちる)
    {
      let missing = null, total = 0;
      for (const dx of [0, 6, 40, 200, -40, -200]) for (const dy of [0, 6, 40]) {
        for (const end of Object.keys(ENDINGS)) {
          const r = rig();
          r.down(1); r.move(dx, dy); ENDINGS[end](r, dx, dy);
          const m = r.mark();
          r.downBlocked(4);                          // 対象外の上の down
          total++;
          if (r.since(m).includes("cancelSettle")) {
            missing = missing || `dx=${dx} dy=${dy} end=${end} → ${r.log.join("/")}`;
          }
        }
      }
      check(`対象外の down は戻しの予約を解除しない(${total}通り)`, !missing, missing || "");
    }
    // --- 状態機械が判定を自前で持っていない(純関数を通している)ことの実行確認 ---
    {
      // 閾値ちょうど(75px)で遷移し、1px手前(74px)では遷移しない = swipeBackThreshold と同じ値を使っている
      const a = rig(); a.down(); a.move(75, 0); a.up(75, 0);
      const b = rig(); b.down(); b.move(74, 0); b.up(74, 0);
      check("状態機械の閾値は swipeBackThreshold と同じ(75で遷移・74で戻す)",
        a.has("onBack") && !b.has("onBack") && b.has("settle"), `${a.log.join("/")} | ${b.log.join("/")}`);
      // 幅が測れないときは 60px
      const c = rig({ width: 0 }); c.down(); c.move(60, 0); c.up(60, 0);
      const d = rig({ width: 0 }); d.down(); d.move(59, 0); d.up(59, 0);
      check("幅が測れないときの閾値も状態機械に通っている(60で遷移・59で戻す)",
        c.has("onBack") && !d.has("onBack"), `${c.log.join("/")} | ${d.log.join("/")}`);
      // 行き先の無い向きは抵抗つきで動くが遷移しない
      const e = rig({ hasForward: false }); e.down(); e.move(-200, 0); e.up(-200, 0);
      check("行き先の無い向きは抵抗つきで動くだけ(遷移しない)",
        e.has("setX(-70)") && !e.has("onForward") && e.has("settle"), e.log.join("/"));
    }

    // ============================================================
    // 【A-3】軸判定の「結果そのもの」を掃引で固定する。
    //
    // これまでの768通りの網羅は**後始末しか見ておらず**、「どの入力のとき実際に横へ動くか」を
    // 一度も確かめていなかった。そのため move の1行を
    //   const h = swipeAxisIsHorizontal(dx, dy) ?? (Math.abs(dy) >= SWIPE_AXIS_LOCK_PX ? false : null);
    // と書き換えて未確定帯を縦に倒しても(=X01)、逆に横に倒しても(=X02)、
    // 純関数・代入箇所の数・旗の配線がどれも無傷なので全件緑のまま通ってしまった。
    // X02 は未確定帯で preventDefault を打つので**縦スクロールを殺す**改変でもある。
    //
    // ここでは同じリグで、角度θのドラッグを流したときに
    //   ・setX が呼ばれたか(= 実際に横へ動いたか)
    //   ・そのまま横へ引き直せば横になれるか(= 未確定か、縦に固定されたか)
    //   ・その時点で touchmove が preventDefault するか(= 縦スクロールを止めるか)
    // を1°刻みで記録し、境界を **SWIPE_VERTICAL_BIAS から計算した値**と突き合わせる。
    // 角度の定数を並べ替えただけでは通らないよう、期待値は掃引の外で atan から出す。
    // ============================================================
    {
      const BIAS = api.SWIPE_VERTICAL_BIAS;
      const HB = Math.atan(1) * 180 / Math.PI;             // 横と確定する境界(|dx| > |dy|) = 45°
      const VB = Math.atan(BIAS) * 180 / Math.PI;          // 縦と確定する境界 = atan(BIAS) = 56.31°
      const rad = (deg) => deg * Math.PI / 180;
      // 角度θへ何回かに分けて引き、状態機械の反応を3値で返す。
      //   "h" = 横と確定して実際に動いた / "u" = 動かないが未確定(横へ引き直せば横になれる)
      //   "v" = 縦に固定された(横へ引き直しても二度と動かない)
      const trace = (deg) => {
        const r = rig();
        r.down();
        for (const d of [10, 25, 40, 60]) r.move(d * Math.cos(rad(deg)), d * Math.sin(rad(deg)));
        const pd = r.pd();                                  // この時点で preventDefault するか
        const drags = r.n("beginDrag");
        if (r.nSetX() > 0) return { axis: "h", pd, drags };
        const m = r.mark();
        r.move(240, 60 * Math.sin(rad(deg)));               // 横へ引き直す
        const recovered = r.since(m).some((s) => s.startsWith("setX("));
        return { axis: recovered ? "u" : "v", pd, drags };
      };
      const sweep = [];
      for (let deg = 0; deg <= 90; deg++) sweep.push({ deg, ...trace(deg) });

      // 境界ちょうどの角度(45°)は cos と sin が 1ulp しか違わないので、どちらに倒れても可とする。
      // それ以外は一意に決まる。VB は整数にならないのでこの緩和は効かない。
      const want = (deg) => {
        if (Math.abs(deg - HB) < 1e-9) return ["h", "u"];
        if (Math.abs(deg - VB) < 1e-9) return ["u", "v"];
        if (deg < HB) return ["h"];
        if (deg < VB) return ["u"];
        return ["v"];
      };
      {
        let bad = null;
        for (const s of sweep) if (!want(s.deg).includes(s.axis)) bad = bad || `${s.deg}°→${s.axis}(期待${want(s.deg).join("|")})`;
        check(`軸の掃引(0〜90°を1°刻み): 横の境界は atan(1)=${HB.toFixed(2)}°、縦の境界は atan(SWIPE_VERTICAL_BIAS)=${VB.toFixed(2)}°`,
          !bad, bad || "");
      }
      // 帯ごとにも見る。上の1件だけだと落ちたときに何が起きたか読めないため。
      // 帯の端は定数の直書きではなく HB / VB から出す。
      {
        const band = (a, b) => sweep.filter((s) => s.deg >= a && s.deg <= b);
        const all = (a, b, k) => band(a, b).every((s) => s.axis === k);
        const show = (a, b) => band(a, b).map((s) => `${s.deg}:${s.axis}`).join(" ");
        const hHi = Math.ceil(HB) - 1, uLo = Math.floor(HB) + 1, uHi = Math.ceil(VB) - 1, vLo = Math.floor(VB) + 1;
        check(`0〜${hHi}°は横と確定して実際に動く(setX が呼ばれる)`, all(0, hHi, "h"), show(0, hHi));
        check(`${uLo}〜${uHi}°は動かないが未確定のまま(横へ引き直せば横と確定できる)`, all(uLo, uHi, "u"), show(uLo, uHi));
        check(`${vLo}〜90°は縦に固定される(横へ引き直しても動かない)`, all(vLo, 90, "v"), show(vLo, 90));
        check("未確定の帯は空ではない(SWIPE_VERTICAL_BIAS が効いている)", uHi >= uLo, `${uLo}〜${uHi}`);
      }
      // 横と確定したときだけ beginDrag が1回。未確定・縦では一度も呼ばない。
      {
        let bad = null;
        for (const s of sweep) {
          const n = s.axis === "h" ? 1 : 0;
          if (s.drags !== n) bad = bad || `${s.deg}°(${s.axis}) → beginDrag ${s.drags}回(期待${n})`;
        }
        check("beginDrag は横と確定した瞬間の1回だけ(未確定・縦では呼ばない)", !bad, bad || "");
      }
      // preventDefault の可否を同じ掃引で見る。期待値は**観測した軸ではなく上の期待の軸**から
      // 出す。そうしないと未確定帯を横に倒す改変(X02)がここも一緒に動いてすり抜ける。
      {
        let bad = null;
        for (const s of sweep) {
          const ok = new Set(want(s.deg).map((a) => (a === "h" ? 1 : 0)));
          if (!ok.has(s.pd)) bad = bad || `${s.deg}°(${s.axis}) → preventDefault ${s.pd}回(期待${[...ok].join("|")})`;
        }
        check("preventDefault は横と確定している間だけ(未確定・縦のあいだは打たない=縦スクロールを殺さない)",
          !bad, bad || "");
      }
      // 掃引は距離60pxまで引いている。軸ロックの距離そのものは別に押さえる
      // (「20px引かないと反応しない」のような距離のすり替えを掃引だけでは見つけられない)。
      {
        const L = api.SWIPE_AXIS_LOCK_PX;
        const a = rig(); a.down(); a.move(L - 0.1, 0);
        const b = rig(); b.down(); b.move(L, 0);
        check("状態機械が動き始める距離は SWIPE_AXIS_LOCK_PX ちょうど(1つ手前では動かない)",
          a.nSetX() === 0 && b.nSetX() === 1 && b.n("beginDrag") === 1, `${a.log.join("/")} | ${b.log.join("/")}`);
        check("軸ロックに届く前は preventDefault しない", a.pd() === 0, String(a.pd()));
        check("軸ロックに届いた瞬間から preventDefault する", b.pd() === 1, String(b.pd()));
      }
      // ジェスチャーが終わったら旗は必ず降りる(戻しの最中・遷移後・中断後に縦スクロールを殺さない)
      {
        const s1 = rig(); s1.down(); s1.move(60, 0);
        check("横へ引いている最中は preventDefault する", s1.pd() === 1, String(s1.pd()));
        s1.up(60, 0);                                       // しきい値未満 → settle
        check("指を離して戻している最中は preventDefault しない", s1.pd() === 0, String(s1.pd()));
        const s2 = rig(); s2.down(); s2.move(200, 0); s2.up(200, 0);   // 遷移
        check("遷移した後は preventDefault しない", s2.pd() === 0, String(s2.pd()));
        const s3 = rig(); s3.down(); s3.move(60, 0); s3.cancel(60, 0);
        check("pointercancel の後は preventDefault しない", s3.pd() === 0, String(s3.pd()));
        const s4 = rig(); s4.down(); s4.move(60, 0); s4.downBlocked(2);
        check("2本目の指で中断された後は preventDefault しない", s4.pd() === 0, String(s4.pd()));
        const s5 = rig(); s5.down();
        check("ジェスチャー開始直後(まだ動かしていない)は preventDefault しない", s5.pd() === 0, String(s5.pd()));
      }
    }
  }

  // --- 実装の作り(ハーネスはJSXを見ないのでソースで照合する) ---
  check("SwipeBackArea は PointerEvent で組んである",
    ["pointerdown", "pointermove", "pointerup", "pointercancel"].every((n) => area.includes(`"${n}"`)));
  check("SwipeBackArea は transform を直接書き換える", /track\.style\.transform = /.test(area));
  check("SwipeBackArea はドラッグ中にstateを更新しない(useStateを持たない)", !area.includes("useState("));
  // 状態遷移はファクトリに出してある。SwipeBackArea 側は DOM の手足を渡して繋ぐだけ。
  check("SwipeBackArea は状態機械のファクトリを使う(コンポーネントに if を残さない)",
    area.includes("createSwipeBackGesture({"));
  check("SwipeBackArea 側に状態遷移が残っていない",
    !/swipeBack(Decision|Offset|Handler)\(/.test(area) && !area.includes("swipeAxisIsHorizontal("), area);
  check("イベントに繋ぐのはファクトリが返した4つだけ",
    ["g.down", "g.move", "g.up", "g.cancel"].every((n) => area.includes(n)));
  check("状態機械は軸判定の純関数を使う", gest.includes("swipeAxisIsHorizontal("));
  check("状態機械は追従量の純関数を使う", gest.includes("swipeBackOffset("));
  check("状態機械は行き先判定の純関数を使う", gest.includes("swipeBackDecision("));
  check("状態機械は配線も純関数を通す(ifで直接呼び分けない)",
    gest.includes("swipeBackHandler(go, handlers())") && !/handlers\(\)\.on(Back|Forward)/.test(gest));
  check("状態機械は DOM に一切触らない(だから実行で検査できる)",
    !/\.style\.|document\.|window\.|clientWidth|addEventListener/.test(gest), gest);
  check("状態機械は down/move/up/cancel の4つを返す",
    /return \{ down, move, up, cancel \};/.test(gest));
  check("SwipeBackArea は onForward を受け取る", /function SwipeBackArea\(\{[^}]*onForward/.test(area));
  // canForward は1箇所で定義し、追従(move)と判定(up)の両方で同じものを使う。
  // 片方だけ true に書き換える改変を数で検出する。
  check("canForward の出どころは onForward の有無ただ1つ",
    area.includes("canForward: () => !!cbRef.current.onForward,"));
  check("canForward は追従と判定の2箇所で使われている",
    (gest.match(/canForward\(\)/g) || []).length === 2, `${(gest.match(/canForward\(\)/g) || []).length}箇所`);
  check("canForward に定数を直書きしていない", !/swipeBack(Offset|Decision)\([^)]*,\s*(true|false)\s*\)/.test(gest));
  check("しきい値は viewport の実幅から出す", area.includes("getWidth: () => vp.clientWidth,"));
  check("横スクロール要素・入力欄の上では発火しない",
    area.includes("hasHorizontalScrollAncestor(") && area.includes('"input, select, textarea, [data-noswipe]"'));
  check("対象判定はファクトリの入口(isSwipeTarget)にただ1つ",
    area.includes("isSwipeTarget: (e) => {") && (gest.match(/isSwipeTarget\(/g) || []).length === 1);
  check("touch-action を敷いていない(中の横スクロール表を殺さない)", !/touchAction/.test(area));
  check("マウスのドラッグでは発火しない(ソース検査: 綴りしか見ていない)",
    area.includes('e.pointerType === "mouse"'));

  // --- 対象判定(isSwipeTarget)の「実物」を取り出して実行で検査する ---
  // 上の768通りのリグは isSwipeTarget を `() => target` という真偽値の偽物で差し替えている。
  // つまり「2本目の指は対象外だから abort に入る」という今周の設計を支えている述語そのものは
  // 一度も通っていない。ここだけは SwipeBackArea に直書きされている実物を取り出し、
  // 偽の PointerEvent を通す。hasHorizontalScrollAncestor と vp は差し替える。
  {
    const decl = bodyAfter(area, "isSwipeTarget: (e) => {");
    check("対象判定の実物をソースから取り出せる", decl.startsWith("isSwipeTarget: (e) => {"), decl.slice(0, 40));
    const arrow = decl.replace(/^isSwipeTarget:\s*/, "");
    // scroll=true で「横スクロールできる祖先がある」状況を作る
    const T = (scroll = false) =>
      new Function("hasHorizontalScrollAncestor", "vp", `return (${arrow});`)(() => scroll, {});
    const t = T();
    const plain = { closest: () => null };                                  // 何にも当たらない要素
    const noswipe = { closest: (sel) => (sel.includes("[data-noswipe]") ? {} : null) };
    check("実物の対象判定: 1本目の指(touch/isPrimary=true)は対象",
      t({ pointerType: "touch", isPrimary: true, target: plain }) === true);
    check("実物の対象判定: 2本目の指(isPrimary === false)は対象外",
      t({ pointerType: "touch", isPrimary: false, target: plain }) === false);
    // 「2本目の指の down は中断だけして始めない」という今周の物語は、この1行だけに乗っている。
    // target が何であっても偽になること(＝入力欄判定の巻き添えではないこと)まで見る。
    check("実物の対象判定: 2本目の指は触れた先に関係なく対象外",
      [plain, noswipe, {}, null, undefined]
        .every((tg) => t({ pointerType: "touch", isPrimary: false, target: tg }) === false));
    check("実物の対象判定: isPrimary が来ないイベントは対象(=== false のときだけ弾く)",
      t({ pointerType: "touch", target: plain }) === true &&
      t({ pointerType: "touch", isPrimary: undefined, target: plain }) === true);
    check("実物の対象判定: マウスは対象外", t({ pointerType: "mouse", isPrimary: true, target: plain }) === false);
    check("実物の対象判定: pen は対象(弾くのは mouse だけで、touch 以外を弾いてはいない)",
      t({ pointerType: "pen", isPrimary: true, target: plain }) === true);
    check("実物の対象判定: 入力欄・data-noswipe の上は対象外",
      t({ pointerType: "touch", isPrimary: true, target: noswipe }) === false);
    check("実物の対象判定: 横スクロールできる祖先の上は対象外",
      T(true)({ pointerType: "touch", isPrimary: true, target: plain }) === false);
    check("実物の対象判定: closest を持たない target でも落ちない",
      t({ pointerType: "touch", isPrimary: true, target: {} }) === true &&
      t({ pointerType: "touch", isPrimary: true, target: null }) === true);
  }
  check("縦と決まったら横へは動かさない(早期return)", /if \(!st\.horizontal\) return;/.test(gest));
  check("軸が決まる前は何もしない", /if \(h === null\) return;/.test(gest));

  // ============================================================
  // 【A-1】非パッシブ touchmove。Pointer Events だけではブラウザのスクロールを止められず、
  // 斜めに引くとブラウザが縦スクロールを引き取って pointercancel が飛び、ジェスチャーが死ぬ。
  // 「横と確定している間だけ preventDefault する」を**実行**で検査する
  // (isSwipeTarget と同じやり方で、ソースから実物を取り出して偽のイベントを通す)。
  // ・preventDefault を消す → 横のとき止まらないので落ちる
  // ・無条件に preventDefault する → 未確定・縦のときも止まるので落ちる(縦スクロールが死ぬ)
  // ============================================================
  {
    check("viewport に touchmove を非パッシブで登録している",
      area.includes('vp.addEventListener("touchmove", onTouchMove, { passive: false });'), area.slice(0, 0));
    check("アンマウント時に touchmove を外す", area.includes('vp.removeEventListener("touchmove", onTouchMove);'));
    check("touchmove を張る相手は viewport(window ではない)",
      !/window\.addEventListener\("touchmove"/.test(area));
    const decl = bodyAfter(area, "const onTouchMove = (e) => {");
    check("touchmove ハンドラの実物をソースから取り出せる", decl.startsWith("const onTouchMove = (e) => {"), decl.slice(0, 40));
    const arrow = decl.replace(/^const onTouchMove\s*=\s*/, "");
    const run = (dragHorizontal) => {
      let n = 0;
      new Function("dragHorizontal", `return (${arrow});`)(dragHorizontal)({ preventDefault: () => { n++; } });
      return n;
    };
    check("横と確定している間は preventDefault する(ブラウザに縦スクロールさせない)", run(true) === 1, String(run(true)));
    check("未確定・縦のあいだは preventDefault しない(縦スクロールを妨げない)", run(false) === 0, String(run(false)));
    // 旗の上げ下げの配線。ここが1本でも抜けると上の実行検査をすり抜ける
    const ups = (area.match(/dragHorizontal = true/g) || []).length;
    // 宣言(let dragHorizontal = false)は数えない。降ろす代入だけを数える
    const downs = (area.match(/(?<!let\s)\bdragHorizontal = false/g) || []).length;
    check("横確定の旗を立てるのは beginDrag ただ1箇所",
      ups === 1 && /beginDrag: \(\) => \{ dragHorizontal = true;/.test(area), `${ups}箇所`);
    check("旗を降ろすのは clearX と settle の2箇所(開始・終了はすべてここを通る)",
      downs === 2, `${downs}箇所`);
    // 上の2つが数えているのは **綴り**(`dragHorizontal = true` / `= false`)なので、
    // `dragHorizontal ||= true` のような別の書き方を数え落とす。実際、setX に
    //     const setX = (px) => { dragHorizontal ||= true; … };
    // を足す改変は ups=1 / downs=2 のまま通った(戻しの320msのあいだ旗が立ちっぱなしになる)。
    // st と同じ方針で、綴りではなく **旗への書き込みの数** を固定する。
    // 数える対象: 単純代入 / 複合代入(||= &&= ??= += …) / ++ -- の前置・後置。
    // 期待は 宣言1(let … = false) + 立てる1(beginDrag) + 降ろす2(clearX / settle) の計4。
    // これでも「= を使わずに書き換える」経路(旗をオブジェクトに入れて Object.assign 等)は
    // 残る。そちらは上の実行検査が実物の配線ごと走っているので、旗が余計に立てば pd() が拾う。
    {
      const NAME = "dragHorizontal";
      const writes = [];
      const re = new RegExp("\\b" + NAME + "\\b", "g");
      let m;
      while ((m = re.exec(area))) {
        const before = area.slice(Math.max(0, m.index - 4), m.index);
        const after = area.slice(m.index + NAME.length, m.index + NAME.length + 6).replace(/^\s*/, "");
        if (/(\+\+|--)\s*$/.test(before)) writes.push(before.trim().slice(-2) + NAME);
        else if (/^(\+\+|--)/.test(after)) writes.push(NAME + after.slice(0, 2));
        else if (/^(\|\||&&|\?\?|\*\*|<<|>>>|>>|[-+*/%&|^])?=(?!=)/.test(after)) writes.push(NAME + " " + after.split(/\s/)[0]);
      }
      check("旗への書き込みは 宣言1 + beginDrag1 + clearX/settle2 の計4箇所だけ(綴りに依らず数える)",
        writes.length === 4, `${writes.length}箇所: ${writes.join(" / ")}`);
    }
    check("戻し(settle)の間は preventDefault しない(指はもう離れている)",
      /const settle = \(\) => \{[^\n]*\n\s*dragHorizontal = false;/.test(area));
    check("旗の初期値は false(前のジェスチャーの状態を引き継がない)",
      /let dragHorizontal = false;/.test(area));
    // touch-action は今までどおり触らない(祖先指定が子孫より優先され、中の横スクロール表が死ぬ)
    check("preventDefault 方式にしても touch-action は敷いていない", !/touchAction/.test(area));
    // SwipePager と共通なのは「非パッシブの touchmove を張る」ことだけ。
    // **軸を決める場所は違う**: SwipePager は touchmove の中で決め(s.horizontal をその場で立てる)、
    // SwipeBackArea は pointermove(状態機械)で決めて touchmove は旗を読むだけ。
    // 以前この検査は「SwipePager と同じ形」と名乗っていたが、名乗りが実態より強かった。
    check("どちらも touchmove を非パッシブで張っている(preventDefault を打てる形)",
      sourceOf("SwipePager").includes('addEventListener("touchmove", onMove, { passive: false })') &&
      area.includes('addEventListener("touchmove", onTouchMove, { passive: false })'));
    check("軸を決める場所は SwipePager と違う(SwipePager は touchmove の中・こちらは pointermove)",
      /s\.horizontal = Math\.abs\(dxRaw\) > Math\.abs\(dy\);/.test(sourceOf("SwipePager")) &&
      !/swipeAxisIsHorizontal\(/.test(bodyAfter(area, "const onTouchMove = (e) => {")) &&
      gest.includes("swipeAxisIsHorizontal("));
  }
  // 上の網羅ループが回せるのは「知っている終わり方」だけ。4つ目の出口が後から生えても
  // 実行検査は気づけない(掃引の dx は最大200pxなので、その外側で発火させれば触れない)。
  // だから st に触る場所の数をここで固定する。
  //
  // 前は `st = null;` という**綴り**を数えていた。それでは `st = undefined;` や
  // `st.id = -1;`(以後のイベントを pointerId 違いとして素通りさせる)で後始末なしの
  // 出口を足せてしまう。どちらも「捨てるだけで transform が居座る」という同じ欠陥。
  // そこで綴りではなく **st への再代入** と **st の破壊的な書き換え** を数える。
  //   再代入(= 状態そのものを差し替える): 宣言 / abort / down の開始 / up の4つだけ。
  //     null でも undefined でも void 0 でも 0 でも、右辺が何であれ1件として数える。
  //   破壊的な書き換え(= 状態の中身をいじる): move の st.horizontal と st.dx の2つだけ。
  // 代入の数だけでは Object.assign(st, { id: -1 }) のように「= を使わずに書き換える」
  // 経路が残る(自分で試して実際に生き残った)ので、st を関数へ渡すこと自体も禁じる。
  // それでも網羅ではない。「綴りに依らず数える」であって「どんな書き方でも捕まえる」ではない。
  {
    const asg = gest.match(/(?<![.\w$])st\s*=(?!=)/g) || [];         // let st = / st = / (st === は除く)
    const decl = gest.match(/\blet\s+st\s*=(?!=)/g) || [];
    const props = (gest.match(/(?<![.\w$])st\.(\w+)\s*=(?!=)/g) || [])
      .map((s) => s.slice(3).replace(/\s*=$/, ""));
    check("st を捨てる(再代入する)場所は abort / down の開始 / up の3つだけ(綴りは問わない)",
      asg.length - decl.length === 3, `再代入${asg.length - decl.length}箇所 / 宣言${decl.length}箇所`);
    check("st の宣言はただ1つ(別名に退避して使い回していない)", decl.length === 1, `${decl.length}箇所`);
    check("st の中身を書き換えるのは move の st.horizontal と st.dx だけ(st.id 等で無効化しない)",
      props.slice().sort().join(",") === "dx,horizontal", props.join(",") || "(なし)");
    check("st を関数へ渡さない(Object.assign(st, …) のような = を使わない書き換えを封じる)",
      !/[(,]\s*st\s*[,)]/.test(gest), (gest.match(/[(,]\s*st\s*[,)]/g) || []).join(" / "));
    // 上の2本は `st.名前 =` という書き方しか数えない。添字と別名はその外側なので個別に塞ぐ。
    check("st に添字でアクセスしない(st[\"id\"] = -1 で名前の検査をすり抜けさせない)",
      !/(?<![.\w$])st\s*\[/.test(gest), (gest.match(/(?<![.\w$])st\s*\[[^\]]*\]/g) || []).join(" / "));
    // `const s = st;` は封じるが、`const { dx, horizontal } = st;`(up の読み出し)は通す。
    // 左辺が識別子で終わるものだけを見る(分割代入は直前が `}` なので当たらない)。
    check("st を別の変数に写さない(別名越しの書き換えを封じる。分割代入での読み出しは可)",
      !/\w\s*=\s*st\s*[;,)]/.test(gest), (gest.match(/\w+\s*=\s*st\s*[;,)]/g) || []).join(" / "));
  }
  // cancel も同じ罠を踏まないよう、終端の綴り(st = null)ではなく st への再代入全般を弾く。
  const cancelSrc = bodyAfter(gest, "const cancel = (e) => {");
  check("cancel は自前で終端せず abort に合流する(綴りに依らず st への再代入を禁じる)",
    cancelSrc.includes("abort();") && !/settle\(|clearX\(|(?<![.\w$])st\s*=(?!=)/.test(cancelSrc), cancelSrc);

  // --- ①②③(fixed の基準を壊さない / はみ出しを封じる)の構造検査 ---
  // transform も will-change も position:fixed の子孫の包含ブロックを作る。
  // 「静止時は transform を消す」だけでは足りず、will-change を一切使わないこと。
  check("will-change を使わない(identityでも包含ブロックを作るため)", !/willChange|will-change/.test(area));
  check("戻し終えたら transform も transition も消し、横確定の旗も降ろす",
    /const clearX = \(\) => \{ dragHorizontal = false; track\.style\.transition = ""; track\.style\.transform = ""; \};/.test(area));
  check("戻しは SWIPE_BACK_EASE で 0 へ向かわせる",
    /const settle = \(\) => \{[\s\S]*?track\.style\.transition = SWIPE_BACK_EASE;[\s\S]*?setX\(0\);/.test(area));
  // 「必ず消える」はこの正規表現ではなく上の実行検査が守る。ここが見ているのは
  // 「戻しの SWIPE_BACK_SETTLE_MS 後に clearX を予約している」という配線1本だけ。
  check("戻しは SWIPE_BACK_SETTLE_MS 後に clearX を予約する",
    /settleTimer = setTimeout\(clearX, SWIPE_BACK_SETTLE_MS\);/.test(area));
  // 予約は1本だけ。settle が古い予約を解除せずに setTimeout を重ねると、
  // 2回目の戻しの最中に1回目のタイマーが起きて clearX する = transition ごと消えて
  // 戻し途中の位置から瞬間移動する。settleTimer は最後の1本しか覚えていないので、
  // 取り残された古いタイマーは cancelSettle でも止められない。
  {
    const s = bodyAfter(area, "const settle = () => {");
    const iClear = s.indexOf("clearTimeout(settleTimer);");
    const iSet = s.indexOf("settleTimer = setTimeout(");
    check("戻しは予約し直す前に古い予約を解除する(settle 本体で clearTimeout が setTimeout より前)",
      iClear >= 0 && iSet >= 0 && iClear < iSet, s);
  }
  check("予約したタイマーは解除できる(cancelSettle が同じタイマーを見ている)",
    area.includes("cancelSettle: () => clearTimeout(settleTimer),"));
  check("アンマウント時にもタイマーを解除する", /return \(\) => \{\s*clearTimeout\(settleTimer\);/.test(area));
  check("遷移するときは transform を消してからコールバックを呼ぶ",
    /if \(run\) \{ clearX\(\); run\(\); return; \}/.test(gest));
  check("横に動かした後だけ元へ戻す(動いていないのに transform を置かない)",
    /if \(horizontal === true\) settle\(\);/.test(gest));
  check("横と確定しなかった経路は必ず transform を消す(タップ・縦ドラッグ)",
    /if \(horizontal === true\) settle\(\);[^\n]*\n\s*else clearX\(\);/.test(gest));
  check("ジェスチャー開始でタイマー解除と transform 消しの両方をする",
    /cancelSettle\(\);[\s\S]{0,120}?clearX\(\);[\s\S]{0,120}?st = \{ id: e\.pointerId/.test(gest));
  // 動かすのは track。viewport が overflow:hidden で包み、ページを横に伸ばさない(SwipePagerと同じ構造)。
  check("viewport が overflow:hidden で track を包む",
    /<div ref=\{viewportRef\} style=\{\{ overflow: "hidden", width: "100%", minHeight: minH \|\| undefined \}\}>/.test(area));
  check("track は viewport の中身をそのまま包む", /<div ref=\{trackRef\}>\{children\}<\/div>/.test(area));
  // transform / transition を書く相手が track 以外に1つでもあれば、overflow:hidden の
  // 外側が動くことになり、はみ出しを封じる構造が壊れる。書き込み先を数で突き合わせる。
  check("transform を書く相手は track だけ",
    (area.match(/\.style\.transform\b/g) || []).length > 0 &&
    (area.match(/\.style\.transform\b/g) || []).length === (area.match(/track\.style\.transform\b/g) || []).length,
    `全${(area.match(/\.style\.transform\b/g) || []).length} / track宛${(area.match(/track\.style\.transform\b/g) || []).length}`);
  check("transition を書く相手も track だけ",
    (area.match(/\.style\.transition\b/g) || []).length > 0 &&
    (area.match(/\.style\.transition\b/g) || []).length === (area.match(/track\.style\.transition\b/g) || []).length,
    `全${(area.match(/\.style\.transition\b/g) || []).length} / track宛${(area.match(/track\.style\.transition\b/g) || []).length}`);
  check("画面下端までの高さは viewport が持つ", area.includes("useFillViewportHeight(viewportRef)"));

  // 評価ダイアログは SwipeBackArea の木の外(document.body)に出す。中に置くと祖先の
  // transform が包含ブロックになり、暗幕が画面全体を覆えなくなる(審査役の実測: 44,65,347x700)。
  const editor = sourceOf("ReedScoreEditor");
  check("評価ダイアログは document.body へポータルする",
    /return createPortal\(/.test(editor) && /\bdocument\.body,\s*\);\s*$/.test(editor.trim().replace(/\}$/, "").trim()));
  check("createPortal を react-dom から import している", /import \{ createPortal \} from "react-dom";/.test(src));
  // 数えるのは「暗幕 / パネル / 列(map の中の1記述が3列ぶん) / 完了ボタン」の4記述。
  // 4という数はこの4記述であって「4つの要素」ではない(列は描画上3つになる)。
  // 属性としての出現だけを数える(コメント中の "data-noswipe:" は後続が : なので当たらない)。
  check("暗幕・パネル・列・完了ボタンの4記述が data-noswipe を持つ(列は map の中なので3列すべてに付く)",
    (editor.match(/data-noswipe(?=[\s/>=])/g) || []).length === 4, `${(editor.match(/data-noswipe(?=[\s/>=])/g) || []).length}箇所`);
  check("暗幕は画面全体(position:fixed / inset:0)のまま",
    editor.includes('position: "fixed", inset: 0, zIndex: 60'));

  // 呼び出し側: リード詳細だけが onForward を持つ
  const reedsTab = sourceOf("ReedsTab");
  check("リード詳細は onBack と onForward の両方を渡す",
    /<SwipeBackArea onBack=\{closeReed\} onForward=\{openCompareFromReed\}>/.test(reedsTab));
  check("左スワイプの行き先は「詳細を閉じて比較タブ」",
    /openCompareFromReed = \(\) => \{[^}]*setEvaluatingReedId\(null\);[^}]*setReedsSubTab\("compare"\);/.test(reedsTab));
  const lab = sourceOf("AnalysisLabView");
  check("セッション詳細は onForward を渡さない", /<SwipeBackArea onBack=\{[^}]*\}>/.test(lab) && !/<SwipeBackArea[^>]*onForward/.test(lab));

  // 立入禁止の確認: SwipePager 本体に手を入れていない
  const pager = sourceOf("SwipePager");
  check("SwipePager のしきい値はそのまま", pager.includes("const threshold = w ? w * 0.2 : 60;"));
  check("SwipePager の端の抵抗はそのまま", pager.includes("if ((i === 0 && dx > 0) || (i === count - 1 && dx < 0)) dx *= 0.35;"));
  check("SwipePager の軸判定はそのまま", pager.includes("if (Math.abs(dxRaw) < 6 && Math.abs(dy) < 6) return;"));
  check("SwipePager は touchmove を非パッシブで登録したまま", pager.includes('el.addEventListener("touchmove", onMove, { passive: false });'));
  check("SwipePager は touch イベントのまま(pointerに変えていない)",
    pager.includes("onTouchStart") && !pager.includes("pointerdown"));
  check("SwipeBackArea の使用箇所は2つのまま", (src.match(/<SwipeBackArea /g) || []).length === 2, `${(src.match(/<SwipeBackArea /g) || []).length}箇所`);
  check("旧しきい値方式(useHorizontalSwipe)の呼び出しが残っていない", !src.includes("useHorizontalSwipe("));
}

// ============================================================
console.log("\n========== 16. 面の作法(地は白 / 罫と沈めるの2作法) ==========");
// DESIGN-SYSTEM §6。地を白にしたうえで、群のまとめ方だけをタブごとに変える。
//   計測・リード = 罫(.surf-rule) / データ = 沈める(.surf-sunk)
// この作法は **CSSクラス** が持つ。インライン style はクラスより強いので、
// .card / .tile に background / border / borderRadius をインラインで書くと
// 作法が丸ごと無効になる。ここはそれを構造で見張るための節。
{
  const css = readFileSync(join(__dirname, "..", "src", "index.css"), "utf8");

  // --- CSS を読むための最小限の道具 ------------------------------------
  // カスタムプロパティの値(`--name: value;`)。
  // **最初の一致では読まない。** CSS は後勝ちなので、ファイル末尾に
  // `:root { --c-rule: #FFFFFF }` を1行足すだけでトークンを反転できてしまう
  // (最初の一致だけを見る実装では、それが検査を素通りしていた)。
  // ここでは最後の定義を返し、同時に「定義は1回だけ」を下で検査する。
  const cssVarAll = (name) =>
    [...css.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, "g"))].map((m) => m[1].trim());
  const cssVar = (name) => { const v = cssVarAll(name); return v.length ? v[v.length - 1] : null; };

  // スタイルシートを「規則の列」に分解する。
  // **最初に一致した規則だけを読む方式は使わない。** CSS は後に書いたほうが勝つので、
  // 同じセレクタをファイル末尾にもう一度書けば作法が丸ごと反転してしまう。
  // ここでは全規則を順に持ち、(a) 同じセレクタが2回現れないこと を検査したうえで
  // (b) 読むときは**最後の規則**を読む。どちらか片方だけでは追記で抜けられる。
  const parseRules = (text) => {
    const noComment = text.replace(/\/\*[\s\S]*?\*\//g, "");
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(noComment)) !== null) {
      // 直前に @import 等の文があると前置きとして取り込まれるので `;` の後ろだけ見る
      const raw = m[1].split(";").pop().trim();
      if (!raw || raw.startsWith("@")) continue;         // @media / @keyframes の頭
      if (/^\d+%/.test(raw) || raw === "from" || raw === "to") continue; // キーフレーム
      const sels = raw.split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
      out.push({ sels, body: m[2] });
    }
    return out;
  };
  const cssRules = parseRules(css);
  // そのセレクタを持つ規則すべて(宣言順)
  const rulesFor = (sel) => cssRules.filter((r) => r.sels.includes(sel));
  // 実際に効く規則 = 最後に書かれたもの
  const cssBlock = (sel) => {
    const rs = rulesFor(sel);
    return rs.length ? rs[rs.length - 1].body : null;
  };
  // 宣言1つの値。同じ規則の中に2回書かれていたら後勝ちの値を返す
  const decl = (block, prop) => {
    if (block === null) return null;
    const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g");
    let m, last = null;
    while ((m = re.exec(block)) !== null) last = m[1].trim();
    return last;
  };
  // 宣言の名前だけを正規化して並べる(`border-top` → `bordertop`)。
  // **綴りを列挙しない**ための道具。接頭辞で見れば個別プロパティも一緒に捕まる。
  const propNames = (block) =>
    (String(block ?? "").match(/(?:^|;)\s*([A-Za-z-]+)\s*:/g) || [])
      .map((s) => s.replace(/[^A-Za-z-]/g, "").toLowerCase().replace(/-/g, ""));
  const hasPropPrefix = (block, prefixes) =>
    propNames(block).some((p) => prefixes.some((x) => p.startsWith(x)));
  // スタイルシート中で、あるセレクタ片に触れているセレクタの一覧
  const selectorsMatching = (rules, re) => {
    const s = new Set();
    for (const r of rules) for (const sel of r.sels) if (re.test(sel)) s.add(sel);
    return [...s].sort();
  };
  const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  // hex色の相対輝度(WCAG)。罫が --c-line より弱くなっていないことを見るのに使う
  const luminance = (hex) => {
    const h = hex.replace("#", "");
    const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  // 2色のコントラスト比(WCAG)。**トークン名ではなく値で**線の強さを縛るのに使う。
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // --- 作法に効く宣言をカスケードで読むための道具 ------------------------
  // 「禁止する綴りを列挙する」方式はいくらでも別綴りを作られるし、逆に
  // padding-top を足すような**作法そのものの調整**まで止めてしまう。
  // ここでは宣言を longhand へ展開し、「このプロパティを最終的に決めているのは
  // どの宣言か」を**宣言順で**求める。見るのは綴りではなくカスケードの勝敗。
  const SIDES = ["top", "right", "bottom", "left"];
  const BPARTS = ["width", "style", "color"];
  const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];
  const BG_LONG = ["color", "image", "position", "size", "repeat", "origin", "clip", "attachment"]
    .map((k) => `background-${k}`);
  const BORDER_LONG = SIDES.flatMap((s) => BPARTS.map((p) => `border-${s}-${p}`))
    .concat(CORNERS.map((c) => `border-${c}-radius`));
  // 作法が握っているプロパティの「根」。ここに属さない宣言(color / opacity / outline …)は
  // 作法を壊さないので、この道具の対象外にする。
  const SURF_ROOTS = {
    background: BG_LONG,
    border: BORDER_LONG,
    padding: SIDES.map((s) => `padding-${s}`),
    margin: SIDES.map((s) => `margin-${s}`),
    gap: ["row-gap", "column-gap"],
    overflow: ["overflow-x", "overflow-y"],
  };
  const rootOf = (n) => Object.keys(SURF_ROOTS).find((r) => n === r || n.startsWith(r + "-")) || null;
  // 宣言名 → それが値を決める longhand の集合。
  // 既知の shorthand は正確に、**知らない綴りは根まるごと**(保守側に倒す)。
  const expandDecl = (raw) => {
    const n = String(raw).trim().toLowerCase();
    const root = rootOf(n);
    if (!root) return [n];
    const all = SURF_ROOTS[root];
    if (all.includes(n)) return [n];                                  // 既知の longhand
    if (n === root) return all;                                       // 根の shorthand
    if (root === "border") {
      let m;
      if (n === "border-radius") return CORNERS.map((c) => `border-${c}-radius`);
      if ((m = /^border-(width|style|color)$/.exec(n))) return SIDES.map((s) => `border-${s}-${m[1]}`);
      if ((m = /^border-(top|right|bottom|left)$/.exec(n))) return BPARTS.map((p) => `border-${m[1]}-${p}`);
    }
    return all;   // border-inline-start / padding-inline / background-blend-mode …
  };
  // 宣言を「順番のまま」名前と値で取り出す
  const declList = (block) =>
    [...String(block ?? "").matchAll(/(?:^|;)\s*([A-Za-z-]+)\s*:\s*([^;]*)/g)]
      .map((m) => ({ name: m[1].toLowerCase(), value: m[2].trim() }));
  // その longhand を最終的に決めている宣言の名前(= 後勝ちの勝者)
  const ownerOf = (block, longhand) => {
    let win = null;
    for (const d of declList(block)) if (expandDecl(d.name).includes(longhand)) win = d.name;
    return win;
  };
  // 作法に効く宣言(= 根を持つ宣言)を1つでも持っているか
  const hasSurfDecl = (block) => declList(block).some((d) => rootOf(d.name) !== null);
  // 作法のクラスを対象にしているセレクタか。`.card` だけでなく
  // `[class~="card"]` / `[class*=card]` のような**別綴り**も同じ扱いにする
  // (詳細度が同じで後に書けば、実際に作法は反転する)。
  const targetsClass = (cls) =>
    new RegExp(`\\.${cls}(?![-\\w])|\\[\\s*class\\s*[~*^$|]?=\\s*["']?[^"'\\]]*${cls}`);

  // --- 1. トークン ------------------------------------------------------
  // トークンは1回しか定義しない。末尾に `:root { --c-rule: #FFFFFF }` を足すだけで
  // セレクタを一切触らずに罫を消せてしまうため(実測で確認済み)。
  {
    const dup = [...new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))]
      .filter((n) => cssVarAll(n).length > 1);
    check("index.css のトークンはそれぞれ1回しか定義されていない(末尾追記での差し替えが無い)",
      dup.length === 0, dup.join(" "));
  }
  check("地は白(--c-bg: #FFFFFF)", cssVar("--c-bg") === "#FFFFFF", String(cssVar("--c-bg")));
  // --c-sunk は**値を固定しない**。下の「地との差の下限」で縛る。
  // 値を固定する検査を併置すると下限検査が永久に発火せず、下限を置いた意味が消える
  // (「もっと沈めたい」という正当な変更まで止めてしまう)。
  check("沈めた面のトークン --c-sunk が定義されている", /^#[0-9A-Fa-f]{6}$/.test(String(cssVar("--c-sunk"))), String(cssVar("--c-sunk")));
  // --c-rule も**値を固定しない**。index.css 自身が「1m先で足りなければ
  // 次の段は --c-line-strong」と逃げ道を書いているのに、値を固定していたせいで
  // その正当な変更が落ちていた(--c-sunk で一度踏んだのと同じ壊れ方)。
  // 下は「--c-line より濃い + 白地と 1.2551:1 以上」、上は「--c-line-strong まで」で
  // 体系の段の中に閉じ込める。
  check("罫のトークン --c-rule が定義されている", /^#[0-9A-Fa-f]{6}$/.test(String(cssVar("--c-rule"))), String(cssVar("--c-rule")));
  check("--c-surface は白のまま残っている(沈めた面の上に置く白い要素に使う)", cssVar("--c-surface") === "#FFFFFF");
  // 罫は「白地で群の境界を担う唯一の線」なので、ヘアライン(--c-line)と同値では役目を果たせない。
  check("--c-rule は --c-line と別の値", cssVar("--c-rule") !== cssVar("--c-line"),
    `rule=${cssVar("--c-rule")} / line=${cssVar("--c-line")}`);
  check("--c-rule は --c-line より濃い(相対輝度が小さい)",
    luminance(cssVar("--c-rule")) < luminance(cssVar("--c-line")),
    `rule L=${luminance(cssVar("--c-rule")).toFixed(4)} / line L=${luminance(cssVar("--c-line")).toFixed(4)}`);
  // 沈めた面は白地と見分けが付く必要がある(見分けが付かないなら沈めていない)。
  check("--c-sunk は地(--c-bg)と別の値", cssVar("--c-sunk") !== cssVar("--c-bg"));
  // データタブは群の境界を「沈めた面 vs 白地」だけで作る。ここを薄くすると群が消える。
  // 一度 #F7F9FB を指定して**旧来(白カード vs 地 #F6F7F9)より弱く**したことがあるので、
  // 旧来の強さを下限として固定する。値ではなく**差**で縛るのが要点。
  {
    const now = ratio(cssVar("--c-bg"), cssVar("--c-sunk"));
    const OLD = 1.0719;   // 旧来の「白カード #FFFFFF vs 地 #F6F7F9」
    check("沈めた面と地の差は旧来の群の境界(1.0719:1)以上",
      now >= OLD - 1e-4, `いま ${now.toFixed(4)}:1 / 旧来 ${OLD}:1`);
  }
  // A型(状態を持つもの)の枠。§1.3 の --c-line-strong は名前で定めているだけなので、
  // トークン名の参照を守っても値を薄めれば「状態を持っている」の合図は消える
  // (#C3CAD3 → #F0F2F5 にすると 1.6523 → 1.1215 まで落ち、--c-line より弱くなる)。
  // --c-sunk と同じく**差**で下限を置く。根拠は現在値の 1.6523:1。
  {
    const now = ratio(cssVar("--c-bg"), cssVar("--c-line-strong"));
    const MIN = 1.6523;
    check("A型の枠(--c-line-strong)と白地の差は 1.6523:1 以上(名前だけでなく値で縛る)",
      now >= MIN - 1e-4, `いま ${now.toFixed(4)}:1 / 下限 ${MIN}:1`);
    // 罫も同じく差で縛る。下限は現在値 #E1E6EC の 1.2551:1。
    const r = ratio(cssVar("--c-bg"), cssVar("--c-rule"));
    check("罫(--c-rule)と白地の差は 1.2551:1 以上", r >= 1.2551 - 1e-4, `いま ${r.toFixed(4)}:1 / 下限 1.2551:1`);
    // 段の順序: --c-line < --c-rule <= --c-line-strong。
    // 上限を --c-line-strong に置くことで「新しい値を発明しない」を保ちつつ、
    // index.css が逃げ道として書いている1段の引き上げは通す。
    check("--c-line-strong は --c-rule と同じか濃い(入力欄の枠 >= 群の罫)",
      luminance(cssVar("--c-line-strong")) <= luminance(cssVar("--c-rule")),
      `strong L=${luminance(cssVar("--c-line-strong")).toFixed(4)} / rule L=${luminance(cssVar("--c-rule")).toFixed(4)}`);
  }

  // --- 1.5 作法を持つ規則が「これだけ」であること -------------------------
  // CSS は後勝ちなので、同じ詳細度で後に書き足すだけで作法は丸ごと反転する。
  // `.surf-rule [class~="card"]` は `.surf-rule .card` と同じ (0,2,0) なので、
  // **セレクタの綴りを列挙する方式では塞げない**(実測で反転を確認済み)。
  //
  // なので見るのは綴りではなく「作法に効く宣言(background/border/padding/
  // margin/gap/overflow)を持っているか」。
  //   (a) 作法を持ってよい規則の集合を固定する
  //   (b) 各規則が1回しか書かれていないこと
  //   (c) それ以外に作法のクラスへ触れる規則があってもよいが、
  //       作法に効く宣言は持てない
  // (c) があるので `.card:focus-visible { outline: … }` や `.tile:hover { opacity: … }`
  // のような**正当な追加**は通り、`[class~="card"] { background: … }` は落ちる。
  {
    const expectCard = [".card", ".surf-rule .card", ".surf-sunk .card"];
    const expectTile = [".surf-rule .tile", ".surf-sunk .tile", ".tile"];
    const expectRow  = [".surf-rule .tile-row", ".tile-row"];
    // 入力欄の共通規則(type を列挙する方式)。range / checkbox は含めない。
    const expectInput = [
      'input[type="date"]', 'input[type="datetime-local"]', 'input[type="number"]',
      'input[type="search"]', 'input[type="text"]', "select", "textarea",
    ];
    for (const [label, re, expect] of [
      [".card", targetsClass("card"), expectCard],
      [".tile", targetsClass("tile"), expectTile],
      [".tile-row", targetsClass("tile-row"), expectRow],
      ["入力欄", /(^|[\s,>+~])(input|select|textarea)\b/, expectInput],
    ]) {
      const touching = cssRules.filter((r) => r.sels.some((s) => re.test(s)));
      // (a) 作法に効く宣言を持つ規則のセレクタ集合
      const owners = [...new Set(touching.filter((r) => hasSurfDecl(r.body)).flatMap((r) => r.sels)
        .filter((s) => re.test(s)))].sort();
      check(`index.css で ${label} に作法(地/枠/角丸/余白/間隔)を与える規則はこの集合だけ`,
        sameSet(owners, [...expect].sort()), owners.join(" | ") || "0件");
      // (b) 後勝ちの上書きが無い
      for (const sel of expect) {
        check(`index.css の ${sel} は1回しか書かれていない(後勝ちの上書きが無い)`,
          rulesFor(sel).length === 1, `${rulesFor(sel).length}回`);
      }
      // (c) 集合の外から作法に効く宣言が入っていない(属性セレクタ・別綴りを含む)
      const extra = touching
        .filter((r) => !r.sels.some((s) => expect.includes(s)))
        .filter((r) => hasSurfDecl(r.body));
      check(`index.css で ${label} を狙う他の規則は作法に効く宣言を持たない(別綴り・属性セレクタでの上書きが無い)`,
        extra.length === 0, extra.map((r) => r.sels.join(",") + " {" + r.body.trim() + "}").slice(0, 2).join(" | "));
    }
    // 地はページの根が持つ。.app-root は高さだけを持ち、色・枠は一切持たない
    // (`.app-root { background:#F6F7F9 }` を足すだけで旧地に戻せてしまう)。
    {
      const rootRules = cssRules.filter((r) => r.sels.some((s) => targetsClass("app-root").test(s)));
      const bad = rootRules.filter((r) => hasSurfDecl(r.body));
      check("index.css の .app-root は作法に効く宣言(地・枠・余白)を持たない",
        bad.length === 0, bad.map((r) => r.sels.join(",") + " {" + r.body.trim() + "}").join(" | "));
      check("index.css の .app-root は1回しか書かれていない", rulesFor(".app-root").length === 1,
        `${rulesFor(".app-root").length}回`);
      // 地そのもの。ラバーバンドで引っ張ると見える面なので、勝者の値まで固定する。
      let bodyBg = null;
      for (const r of cssRules.filter((x) => x.sels.includes("body")))
        for (const d of declList(r.body)) if (expandDecl(d.name).includes("background-color")) bodyBg = d.value;
      check("html, body の地は var(--c-bg)(最後に勝つ宣言で見る)", bodyBg === "var(--c-bg)", String(bodyBg));
    }
    // 影・輪郭は border と同じく「箱」を描ける。作法の規則そのものに持たせない
    // (:hover / :focus-visible のような別セレクタは上の (c) の対象で、outline は許す)。
    for (const sel of [".card", ".surf-rule .card", ".surf-sunk .card", ".tile",
      ".surf-rule .tile", ".surf-sunk .tile", ".tile-row", ".surf-rule .tile-row", ".app-root"]) {
      const names = declList(cssBlock(sel)).map((d) => d.name);
      const boxy = names.filter((n) => /^(box-shadow|outline|filter|backdrop-filter)/.test(n));
      check(`${sel} は影・輪郭で箱を描き直していない`, boxy.length === 0, boxy.join(" "));
    }
    // !important は詳細度も宣言順も飛び越える。作法に効くところで使わせない。
    const bangs = (css.replace(/\/\*[\s\S]*?\*\//g, "").match(/[a-zA-Z-]+\s*:[^;{}]*!important/g) || [])
      .map((s) => s.trim());
    check("index.css の !important は動きを止める1件だけ(作法を飛び越える手を残さない)",
      bangs.length === 1 && /^animation\s*:/.test(bangs[0]), bangs.join(" | ") || "0件");
  }

  // --- 2. 作法の規則そのもの -------------------------------------------
  const ruleCard = cssBlock(".surf-rule .card");
  const sunkCard = cssBlock(".surf-sunk .card");
  const ruleTile = cssBlock(".surf-rule .tile");
  const sunkTile = cssBlock(".surf-sunk .tile");
  const ruleRow  = cssBlock(".surf-rule .tile-row");

  check(".surf-rule .card / .surf-sunk .card の両方が定義されている", ruleCard !== null && sunkCard !== null);
  // 罫: 箱を消す。塗りが復活したら(background: var(--c-surface) 等)ここで落ちる。
  check("罫の作法のカードは塗りを持たない", decl(ruleCard, "background") === "transparent", String(decl(ruleCard, "background")));
  check("罫の作法のカードは枠を持たない(border: 0)", decl(ruleCard, "border") === "0", String(decl(ruleCard, "border")));
  check("罫の作法のカードは上辺の罫1本だけ", decl(ruleCard, "border-top") === "1px solid var(--c-rule)", String(decl(ruleCard, "border-top")));
  check("罫の作法のカードは角丸なし", decl(ruleCard, "border-radius") === "0");
  check("罫の作法のカードは左右の padding なし",
    decl(ruleCard, "padding-left") === "0" && decl(ruleCard, "padding-right") === "0");
  // 沈める: 地は白のまま、面だけを沈める。
  check("沈める作法のカードの塗りは --c-sunk", decl(sunkCard, "background") === "var(--c-sunk)", String(decl(sunkCard, "background")));
  check("沈める作法のカードの枠は透明", decl(sunkCard, "border") === "1px solid transparent", String(decl(sunkCard, "border")));
  check("沈める作法のカードは角丸あり", decl(sunkCard, "border-radius") === "var(--r-md)");
  check("カードの内側余白は --sp-4(DESIGN-SYSTEM §3)", decl(cssBlock(".card"), "padding") === "var(--sp-4)");

  check("罫の作法のタイルは塗りも枠も持たず、左罫1本だけ",
    decl(ruleTile, "background") === "transparent" && decl(ruleTile, "border") === "0" &&
    decl(ruleTile, "border-left") === "1px solid var(--c-rule)" && decl(ruleTile, "border-radius") === "0");
  check("沈める作法のタイルは白い面 + ヘアライン + 角丸",
    decl(sunkTile, "background") === "var(--c-surface)" && decl(sunkTile, "border") === "1px solid var(--c-line)" &&
    decl(sunkTile, "border-radius") === "var(--r-sm)");

  // --- 3. 行の先頭のタイルに左罫が出ないこと ---------------------------
  // 位置で決める方式: 罫はタイルの左端(margin-left:-1px で自分の枠の外)に付き、
  // 行の左端に来た1本だけを容器の overflow:hidden が落とす。
  // :nth-child で数える方式にすると、TappableMetricCard を開いたとき
  // (gridColumn:1/-1)に行頭の位置がずれて破綻する。
  check("罫の作法のタイルは罫を自分の枠の外(1px左)に出す", decl(ruleTile, "margin-left") === "-1px", String(decl(ruleTile, "margin-left")));
  check("タイルの行は行頭の罫を落とすため overflow:hidden", decl(ruleRow, "overflow") === "hidden", String(decl(ruleRow, "overflow")));
  check("タイルの行は左右へはみ出させ、タイルの padding と相殺して中身を地の左端に揃える",
    decl(ruleRow, "margin-left") === "calc(-1 * var(--sp-3))" && decl(ruleRow, "margin-right") === "calc(-1 * var(--sp-3))",
    `${decl(ruleRow, "margin-left")} / ${decl(ruleRow, "margin-right")}`);
  check("罫の作法では列の間隔を0にする(罫の左右の余白はタイルの padding が持つ)", decl(ruleRow, "gap") === "0");
  check("タイルの内側余白は --sp-3", decl(cssBlock(".tile"), "padding") === "var(--sp-3)");

  // --- 3.5 作法の宣言が「後から別綴りで上書きされていない」こと ------------
  // 上の decl() は綴りが完全に一致する1つの宣言しか見ない。同じ規則の中に
  // `background-color:` や `border-color:` を足せば、`background: transparent` を
  // 残したまま見た目だけ変えられてしまう。
  //
  // かつてここは**宣言名の集合そのもの**を固定していたが、それだと
  // `.surf-rule .card` に `padding-top` を足すような**作法そのものの調整**まで
  // 落ちてしまい、作法を育てられなかった。
  // 見るのは名前の集合ではなく **longhand ごとのカスケードの勝者**にする。
  //   ・作法が握る longhand それぞれについて、最後に値を決めている宣言が
  //     「作法として書いた宣言」であること
  //   ・作法が握っていない longhand(padding-top など)は対象外 = 足してよい
  {
    // [セレクタ, 本体, 作法として書いた宣言(**ソース順**)]
    // 順序が意味を持つ: border-top は border より後に書かれて上辺だけを取り戻す。
    const surfRules = [
      [".surf-rule .card", ruleCard, ["background", "border", "border-top", "border-radius", "padding-left", "padding-right"]],
      [".surf-sunk .card", sunkCard, ["background", "border", "border-radius"]],
      [".surf-rule .tile", ruleTile, ["background", "border", "border-left", "border-radius", "margin-left"]],
      [".surf-sunk .tile", sunkTile, ["background", "border", "border-radius"]],
      [".surf-rule .tile-row", ruleRow, ["gap", "margin-left", "margin-right", "overflow"]],
      [".card", cssBlock(".card"), ["padding"]],
      [".tile", cssBlock(".tile"), ["padding"]],
      [".tile-row", cssBlock(".tile-row"), ["gap"]],
    ];
    for (const [sel, block, intended] of surfRules) {
      // 作法が握る longhand と、その意図された持ち主(後に書いたものが勝つ)
      const want = new Map();
      for (const name of intended) for (const lh of expandDecl(name)) want.set(lh, name);
      const wrong = [];
      for (const [lh, name] of want) {
        const win = ownerOf(block, lh);
        if (win !== name) wrong.push(`${lh}: ${win ?? "無し"}(期待 ${name})`);
      }
      check(`${sel} の作法は同じ規則の中で上書きされていない(${[...want.keys()].length}個の最終プロパティを宣言順で確認)`,
        wrong.length === 0, wrong.slice(0, 4).join(" / "));
      // 意図した宣言が実際に書かれていること(片方だけ消して「勝者無し」で
      // 通り抜けるのを防ぐ。上の win !== name で落ちるが、意図を文にして残す)
      const names = declList(block).map((d) => d.name);
      const missing = intended.filter((n) => !names.includes(n));
      check(`${sel} は作法の宣言(${intended.join(" / ")})をすべて持つ`, missing.length === 0, missing.join(" "));
      // 地と線は「箱を作るか作らないか」そのものなので、意図した宣言の外に
      // 1つでもあってはならない(例: .surf-rule .tile-row に border-left を足すと
      // 行の左端に縦線が出て、まさに避けたい「囲み」になる)。
      // 余白・間隔(padding/margin/gap/overflow)は上のカスケード検査で
      // 握っているぶんだけ守り、それ以外は足してよい(作法を育てられるように)。
      const strayPaint = names.filter((n) => ["background", "border"].includes(rootOf(n)) && !intended.includes(n));
      check(`${sel} は意図した以外の地・線の宣言を持たない(箱を作り直していない)`,
        strayPaint.length === 0, strayPaint.join(" "));
    }
  }

  // --- 4. 入力欄は両方の作法で B型(枠線なし + --c-sunken の地) ------------
  // 入力欄は「群」ではなく「操作するもの」。白地でも触れると分かる必要がある。
  // **枠線は付けない。** 本人指示(2026-08-03)「枠線は重くなるので不要」
  // 「背景と同じ色で枠線をつけるか、違う色で枠線をつかないかに統一して」。
  // 入力欄は on/off も開閉も持たない = 状態を持たないので B型(下の 17. を参照)。
  // 枠は 0 ではなく透明で残す(DESIGN-SYSTEM §6.1.5。0 にすると外形が 2px 縮み、
  // リード選択ピルが縮んで環が 2px 上がる)。
  const inputSels = selectorsMatching(cssRules, /(^|[\s,>+~])(input|select|textarea)\b/);
  const inputRules = cssRules.filter((r) => r.sels.some((s) => inputSels.includes(s)));
  const inputBlock = inputRules.length ? inputRules[inputRules.length - 1].body : null;
  check("入力欄(input/select/textarea)の共通規則がある", inputBlock !== null);
  check("入力欄の規則は index.css に1つだけ(後から別規則で上書きしていない)",
    inputRules.length === 1, `${inputRules.length}規則`);
  check("入力欄の地は --c-sunken(B型)", decl(inputBlock, "background") === "var(--c-sunken)", String(decl(inputBlock, "background")));
  check("入力欄は見える枠線を持たない(B型。透明で場所だけ残す)",
    decl(inputBlock, "border") === "1px solid transparent", String(decl(inputBlock, "border")));
  // 別綴り(background-color / border-color …)で後ろから上書きしていないこと。
  // ここも名前の集合の固定はやめ、**最終プロパティごとの勝者**で見る
  // (集合固定だと font-size を足すような正当な調整まで落ちる)。
  {
    const intended = ["background", "color", "border", "border-radius"];
    const want = new Map();
    for (const name of intended) for (const lh of expandDecl(name)) want.set(lh, name);
    const wrong = [];
    for (const [lh, name] of want) {
      const win = ownerOf(inputBlock, lh);
      if (win !== name) wrong.push(`${lh}: ${win ?? "無し"}(期待 ${name})`);
    }
    check("入力欄の地・枠は同じ規則の中で上書きされていない(別綴りの個別プロパティが無い)",
      wrong.length === 0, wrong.slice(0, 4).join(" / "));
  }
  check("入力欄の規則は select と textarea を含む", inputSels.includes("select") && inputSels.includes("textarea"));
  for (const t of ["text", "number", "date", "datetime-local"]) {
    check(`入力欄の規則は input[type="${t}"] を含む`, inputSels.includes(`input[type="${t}"]`));
  }
  // range / checkbox に塗りを当てるとUAの描画(つまみ・チェック)が壊れる。列挙方式であることの確認。
  check("入力欄の規則は range / checkbox を含まない(UA描画のまま残す)",
    !inputSels.includes('input[type="range"]') && !inputSels.includes('input[type="checkbox"]'));

  // App.jsx の <style> は React が <body> の中に描く。index.css は本番ビルドでは
  // <head> の <link> なので、**同じ詳細度なら必ず body 側が勝つ**。
  // ここに1行足すだけで index.css の作法は丸ごと反転する(実測で確認済み:
  // `.surf-rule .card { background:#FFFFFF; padding-left:16px; border-radius:12px }`
  // を足すと旧デザインの白カードがそのまま戻る)。
  // 入力欄だけでなく、**作法に関わるセレクタすべて**をここで塞ぐ。
  {
    // <style ...> の別綴り(<style type="text/css">)で2つ目を隠せないよう、
    // タグの数え方も綴り完全一致から外す。
    const st = /<style>\{`([\s\S]*?)`\}<\/style>/.exec(src);
    check("App.jsx の <style> は1つだけ", (src.match(/<style[\s>]/g) || []).length === 1 && st !== null,
      `${(src.match(/<style[\s>]/g) || []).length}箇所`);
    check("App.jsx に dangerouslySetInnerHTML が無い(<style> の中身を静的に読めなくなる)",
      !src.includes("dangerouslySetInnerHTML"));
    const appRules = st ? parseRules(st[1]) : [];

    // (1) 作法そのもの。.card / .tile / .tile-row / .surf-* / .app-root に
    //     触れる規則は1つも置かせない(属性セレクタ = 別綴りも同じ扱い)。
    const surfSel = [
      ["card", targetsClass("card")], ["tile", targetsClass("tile")],
      ["tile-row", targetsClass("tile-row")], ["app-root", targetsClass("app-root")],
      ["surf-rule", targetsClass("surf-rule")], ["surf-sunk", targetsClass("surf-sunk")],
    ];
    const surfOffenders = appRules.filter((r) =>
      r.sels.some((s) => surfSel.some(([, re]) => re.test(s))));
    check("App.jsx の <style> は面の作法(.card/.tile/.tile-row/.surf-*/.app-root)に触れる規則を持たない",
      surfOffenders.length === 0,
      surfOffenders.map((r) => r.sels.join(",") + " {" + r.body.trim() + "}").slice(0, 2).join(" | "));

    // (2) トークンの差し替え。`:root { --c-rule: #FFFFFF }` を1行足せば
    //     セレクタを一切触らずに罫を消せる。値の唯一の答えは index.css に置く。
    const varDefs = appRules.filter((r) => /(^|;)\s*--[A-Za-z0-9-]+\s*:/.test(r.body));
    check("App.jsx の <style> は CSS カスタムプロパティを定義しない(トークンの値は index.css だけが持つ)",
      varDefs.length === 0, varDefs.map((r) => r.sels.join(",") + " {" + r.body.trim() + "}").join(" | "));

    // (3) 全称セレクタ。`* { background: #F6F7F9 }` は詳細度0でも、地を持たない
    //     要素すべてを塗り替える。ここは box-sizing 専用にする。
    const starRules = appRules.filter((r) => r.sels.includes("*"));
    const starProps = [...new Set(starRules.flatMap((r) => declList(r.body).map((d) => d.name)))].sort();
    check("App.jsx の <style> の * が持つ宣言は box-sizing だけ",
      sameSet(starProps, ["box-sizing"]), starProps.join(" "));

    // (3.5) セレクタを名指しで塞ぐ方式には終わりが無い。`body` / `div` / `#root` に
    //     地を塗れば、作法のクラスに一度も触れずに面を作り替えられる(実測で確認済み)。
    //     ここは**宣言の側**で閉じる: この <style> で地・枠・余白・間隔を持てるのは
    //     select の2規則だけ(丸角カード内の軸セレクタと select 固有の詰め)。
    const PAINT_OK = ["select", "select.pivot-axis-select"];
    const painters = appRules
      .filter((r) => !r.sels.every((s) => PAINT_OK.includes(s)))
      .filter((r) => hasSurfDecl(r.body));
    check("App.jsx の <style> で地・枠・余白・間隔を持てるのは select の2規則だけ",
      painters.length === 0,
      painters.map((r) => r.sels.join(",") + " {" + r.body.trim() + "}").slice(0, 2).join(" | "));

    // (4) 入力欄。
    const appInputSels = selectorsMatching(appRules, /(^|[\s,>+~])(input|select|textarea)\b/);
    // 意図して地・枠を落とす唯一の例外。丸角カードの中に置く軸セレクタ。
    const EXCEPTION = "select.pivot-axis-select";
    check("App.jsx の <style> で入力欄に触れるセレクタはこの集合だけ",
      sameSet(appInputSels, ["input:focus-visible", "input[type=range]", "select",
        EXCEPTION, "select:focus-visible"].sort()), appInputSels.join(" | "));
    const offenders = appRules
      .filter((r) => r.sels.some((s) => appInputSels.includes(s)) && !r.sels.includes(EXCEPTION))
      .filter((r) => hasPropPrefix(r.body, ["background", "border"]));
    check("App.jsx の <style> は入力欄の地・枠を上書きしない(例外は軸セレクタ1件のみ)",
      offenders.length === 0, offenders.map((r) => r.sels.join(",") + " {" + r.body.trim() + "}").join(" | "));
    check("App.jsx の <style> に !important が無い(index.css の作法を飛び越えさせない)",
      st !== null && !st[1].includes("!important"));
  }

  // --- 4.5 JSX のタグを読むための道具 -----------------------------------
  // タグの終わりは「{} の深さが0のところに現れる > 」で判定する。
  // onClick={() => ...} の "=>" は必ず {} の中にあるので誤検出しない。
  const tagAt = (idx) => {
    const start = src.lastIndexOf("<", idx);
    let depth = 0;
    for (let i = start; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      else if (src[i] === ">" && depth === 0) return src.slice(start, i + 1);
    }
    return src.slice(start);
  };
  // **完全一致では見ない。** `className="card cardx"` とクラスを1つ足すだけで
  // 走査から外れてしまう(クラスを足すのは日常的な編集なので、意図せず踏む)。
  // className の中身を空白で割り、**トークンとして含まれるか**で判定する。
  const tagsWithClass = (cls) => {
    const out = [];
    const re = /className="([^"]*)"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[1].trim().split(/\s+/).includes(cls)) out.push(tagAt(m.index));
    }
    return out;
  };

  // --- 5. タブの根に作法のクラスが付いていること ------------------------
  check("計測タブの根は罫の作法(surf-rule)",
    /\{topTab === "measure" && \(\s*<div className="surf-rule">\s*<MeasureView/.test(src));
  check("データタブの根は沈める作法(surf-sunk)",
    /\{topTab === "analysis" && \(\s*<div className="surf-sunk">\s*<AnalysisLabView/.test(src));
  // リードタブは子タブ(登録/比較)の溝と本体の2つを1つの根で包む。
  const reedsBlockIdx = src.indexOf('{topTab === "reeds" && (');
  const reedsBlock = reedsBlockIdx === -1 ? "" : src.slice(reedsBlockIdx, src.indexOf('{topTab === "measure" && ('));
  check("リードタブの根は罫の作法(surf-rule)",
    /\{topTab === "reeds" && \(\s*<div className="surf-rule">/.test(src));
  check("ReedsTab(登録・比較・個別詳細のすべて)が罫の作法の根の中にある", reedsBlock.includes("<ReedsTab"));
  check("ReedsTab の描画箇所は1つだけ(作法の外に置き去りにしていない)",
    (src.match(/<ReedsTab/g) || []).length === 1, `${(src.match(/<ReedsTab/g) || []).length}箇所`);
  // トークンで数える。`className="surf-rule wrap"` と書いても数から漏れない。
  {
    const roots = tagsWithClass("surf-rule").length + tagsWithClass("surf-sunk").length;
    check("作法のクラスは3タブぶんの3箇所だけ", roots === 3, `${roots}箇所`);
  }

  // --- 6. .card / .tile にインラインで見た目を書いていないこと ----------
  // ここが今回いちばん壊れやすい。インライン style はクラスより強いので、
  // background / border / borderRadius を1つでも書くとその要素だけ作法から外れる。
  const cardTags = tagsWithClass("card");
  const tileTags = tagsWithClass("tile");
  const rowTags = tagsWithClass("tile-row");
  // 数そのものが要件ではないが、0件なら検査が何も見ていないので下限だけ置く。
  check(".card が実際に使われている", cardTags.length >= 15, `${cardTags.length}箇所`);
  check(".tile が実際に使われている", tileTags.length >= 3, `${tileTags.length}箇所`);
  check(".tile-row が実際に使われている", rowTags.length >= 5, `${rowTags.length}箇所`);
  // 上の tagsWithClass は className="card" という**綴りそのもの**を探す。
  // className={"card"} / className={`card ${x}`} と書けば走査から外れてしまうので、
  // 作法のクラスは文字列リテラルでしか書けないことを先に固定する。
  {
    const exprs = (src.match(/className=\{[^}]*\}/g) || []).filter((s) => /\b(card|tile|tile-row)\b/.test(s));
    check("作法のクラス(card/tile/tile-row)は className=\"…\" の直書きだけ(式に隠して走査から逃げていない)",
      exprs.length === 0, exprs.slice(0, 2).join(" | "));
    // React は `class=` も DOM に通す(警告は出るが描画はされる)。
    // 綴りを変えるだけで上の走査から丸ごと外れるので、JSX では使わせない。
    const rawClass = src.match(/[^a-zA-Z-]class=/g) || [];
    check("JSX で class= を使っていない(className= だけ。綴りを変えて走査から逃げていない)",
      rawClass.length === 0, `${rawClass.length}箇所`);
    // style={someObject} だと中身を静的に読めない。作法のクラスを持つタグでは使わせない。
    const all = [...cardTags, ...tileTags, ...rowTags];
    const opaque = all.filter((t) => /style=\{(?!\{)/.test(t));
    check("作法のクラスを持つタグの style はオブジェクトリテラル直書きだけ(変数経由で走査から逃げていない)",
      opaque.length === 0, opaque.length ? opaque[0].slice(0, 160) : "");
    // スプレッド({...OVERRIDE})と計算したキー({["background"+"Color"]: …})も
    // 宣言名が静的に読めなくなる。オブジェクトリテラルであること自体を担保する。
    const styleBody = (t) => { const m = /style=\{\{([\s\S]*?)\}\}/.exec(t); return m ? m[1] : ""; };
    const spread = all.filter((t) => /\.\.\./.test(styleBody(t)));
    check("作法のクラスを持つタグの style にスプレッドが無い(中身が静的に読めなくなる)",
      spread.length === 0, spread.length ? spread[0].slice(0, 160) : "");
    const computed = all.filter((t) => /(^|[{,])\s*\[/.test(styleBody(t)));
    check("作法のクラスを持つタグの style に計算したキーが無い(宣言名が静的に読めなくなる)",
      computed.length === 0, computed.length ? computed[0].slice(0, 160) : "");
  }
  // 実行時に見た目を書き換えられると、ここまでの静的検査は何も見られない。
  // 塞ぐ口は2つある。**規則**の差し込みと、**要素の style プロパティ**。
  // 前者だけを塞いで「スタイルは2箇所だけ」と名乗っていたが、
  // `el.style.background = "#FFFFFF"` / `style.setProperty("--c-rule", …)` は
  // 素通しだった(実測で確認済み)。名乗りを実態に合わせ、両方を見る。
  {
    const code = codeOf(src);
    // (a) 規則そのものの差し込み
    const inject = ["createElement(\"style\"", "createElement('style'", "insertRule",
      "adoptedStyleSheets", "document.styleSheets", "CSSStyleSheet", "innerHTML"]
      .filter((k) => code.includes(k));
    check("App.jsx は実行時にスタイル規則を差し込まない(規則は index.css と <style> の2箇所だけ)",
      inject.length === 0, inject.join(" | "));

    // (b) 要素の style プロパティ。作法が握るプロパティだけを見る。
    //     PitchRing の rAF は setAttribute("d"/"cx"/"stop-color" …) を正当に使うので、
    //     ここでは巻き込まない(見るのは .style.<prop> = と setAttribute("style"))。
    // DOM の style は camelCase。CSS の綴りへ直してから根を引く
    // (backgroundColor → background-color → 根 background)。
    const toKebab = (n) => n.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const styleWrites = [...code.matchAll(/\.style\.([A-Za-z-]+)\s*=(?!=)/g)]
      .map((m) => m[1])
      .filter((n) => n !== "cssText")
      .filter((n) => rootOf(toKebab(n)) !== null || /^(box-shadow|outline)/.test(toKebab(n)));
    check("App.jsx は要素の style で作法のプロパティ(地/枠/角丸/余白/間隔/影)を書かない",
      styleWrites.length === 0, styleWrites.join(" | "));
    // setProperty はカスタムプロパティを触れる。`--c-rule` を白にすれば罫は消える。
    check("App.jsx は style.setProperty を使わない(トークンを実行時に差し替えられる)",
      !/\.style\.setProperty\s*\(/.test(code));
    check('App.jsx は setAttribute("style") / setAttribute("class") を使わない',
      !/setAttribute\s*\(\s*["'`](style|class)\b/.test(code));
    check("App.jsx は className / classList を実行時に書き換えない",
      !/\.className\s*=(?!=)/.test(code) && !/\.classList\b/.test(code));
    // cssText は画面外の計測用プローブ2箇所でだけ使う。文字列リテラルに限り、
    // 作法のプロパティを含めない(overflow は画面外要素の隠しに要るので対象外)。
    const cssTexts = [...code.matchAll(/\.style\.cssText\s*=\s*([^\n]*)/g)]
      .map((m) => m[1].trim().replace(/;\s*$/, ""));
    const badCssText = cssTexts.filter((v) =>
      !/^(["'])[^"'`]*\1$/.test(v) || /(^|;)\s*(background|border|padding|margin|gap|box-shadow|outline)[a-z-]*\s*:/i.test(v));
    check("style.cssText は文字列リテラルで、作法のプロパティを含まない",
      badCssText.length === 0, badCssText.slice(0, 2).join(" | "));
    // 作法のクラスを JS から掴めれば、上のどの経路でも直接 style を書ける。
    const grab = code.match(/["'`][^"'`\n]*\.(card|tile|tile-row|surf-rule|surf-sunk|app-root)(?![-\w])[^"'`\n]*["'`]/g) || [];
    check("App.jsx は作法のクラスを JS の文字列(セレクタ)で掴まない",
      grab.length === 0, grab.slice(0, 2).join(" | "));
  }
  // ページの根の地。ここを `#F6F7F9` にすれば地だけ旧デザインに戻せる。
  // .app-root は index.css 側では地を持たない(上の 1.5 で固定)ので、
  // 実際の地はこのインライン1行が決めている。値まで見る。
  {
    const rootTags = tagsWithClass("app-root");
    check(".app-root は1箇所だけ", rootTags.length === 1, `${rootTags.length}箇所`);
    const rootTag = rootTags[0] || "";
    check(".app-root の地は var(--c-bg)(旧地 #F6F7F9 への差し戻しを止める)",
      /background:\s*"var\(--c-bg\)"/.test(rootTag),
      (rootTag.match(/background[A-Za-z]*:\s*[^,}]*/) || ["無し"])[0]);
    const rootBg = (rootTag.match(/([A-Za-z-]+)\s*:/g) || [])
      .map((s) => s.replace(/[^A-Za-z-]/g, "").toLowerCase())
      .filter((p) => p.startsWith("background"));
    check(".app-root のインライン地の宣言は background 1つだけ(別綴りで後から上書きしていない)",
      rootBg.length === 1 && rootBg[0] === "background", rootBg.join(" ") || "0件");
  }
  // インライン style の宣言名を正規化して並べる。
  // **綴りを列挙しない。** React の style は camelCase なので background / border /
  // padding は backgroundColor・borderWidth・borderStyle・borderColor・borderTop・
  // paddingLeft … といくらでも別綴りが作れる。接頭辞で見れば全部まとめて捕まる。
  const inlineProps = (tag) =>
    (tag.match(/([A-Za-z-]+)\s*:/g) || [])
      .map((s) => s.replace(/[^A-Za-z-]/g, "").toLowerCase().replace(/-/g, ""));
  const withPrefix = (tags, prefixes, extra = () => false) =>
    tags.filter((t) => inlineProps(t).some((p) => prefixes.some((x) => p.startsWith(x)) || extra(p)));
  for (const [name, tags] of [[".card", cardTags], [".tile", tileTags]]) {
    // borderRadius も border 接頭辞で一緒に落ちる(作法が角丸を決めているため)。
    // boxShadow / outline / filter は border を書かずに「箱」を描き直せる別経路
    // (`boxShadow: "inset 0 0 0 1px #E9ECF0"` で旧カードの枠がそのまま戻る)。
    const bad = withPrefix(tags, ["background", "border", "padding", "boxshadow", "outline", "filter", "backdropfilter"]);
    check(`${name} に background* / border* / padding* / 影 / 輪郭のインライン宣言が無い(あると作法が効かなくなる)`,
      bad.length === 0, bad.length ? bad[0].slice(0, 160) : "");
  }
  // インライン style で CSS カスタムプロパティを定義すると、セレクタにも
  // 宣言名にも作法の綴りが現れないまま作法を反転できる
  // (`style={{ "--c-rule": "#FFFFFF" }}` を根に1つ書けば罫が全滅する)。
  // 上の inlineProps は `--` を落として正規化するため、ここだけ生の綴りで見る。
  {
    const code = codeOf(src);
    const vars = code.match(/["']--[A-Za-z0-9-]+["']\s*:/g) || [];
    check("App.jsx はインライン style で CSS カスタムプロパティを定義しない(トークンを要素単位で差し替えられる)",
      vars.length === 0, [...new Set(vars)].slice(0, 3).join(" | "));
  }
  // タイルの行にインラインの gap を書くと、罫の作法の gap:0 を上書きして
  // 罫の左右の余白が非対称になる。margin-left/right と overflow も同様
  // (行頭の罫を落とす仕掛けそのものが壊れる)。marginTop/Bottom は作法が触らないので許す。
  {
    const bad = withPrefix(rowTags, ["gap", "background", "border", "overflow"],
      (p) => p === "margin" || p === "marginleft" || p === "marginright" || p.startsWith("margininline"));
    check(".tile-row に gap* / margin(左右) / overflow* / background* / border* のインライン宣言が無い",
      bad.length === 0, bad.length ? bad[0].slice(0, 160) : "");
  }
  // 旧カードの綴りが .card へ移らずに残っていないか(白カード+ヘアラインの3点セット)。
  // コメント中の記録には当たらないよう codeOf を通す。
  {
    const code = codeOf(src);
    const leftovers = (code.match(/background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius/g) || []).length;
    check("旧カードの3点セット(白 + #E9ECF0 + 角丸)の直書きが残っていない", leftovers === 0, `${leftovers}箇所`);
  }

  // --- 6.5 .no-top-rule: 2箇所だけの上辺ライン除去特例 --------------------
  // 本人指示(F-?): リードタブ上部(子タブの溝・「一覧に戻る」との間)のラインを
  // 「新しいリードを登録」カードと「登録済みの個別リード」識別情報カードの2箇所だけ消す。
  // .card 自体はロック済みの集合({expectCard})以外に触れてはいけないので、
  // .card という文字列を一切含まない別セレクタ .surf-rule .no-top-rule で
  // border-top だけを後勝ちさせる方式にした。この節はその方式が実際に機能していることを
  // 独立に検証する(16節の .card ロック検査は selector 文字列に「.card」を含まないと
  // そもそも捕捉しないため、ここで守らないと何も守られていないテストになる)。
  {
    const noTopBlock = cssBlock(".surf-rule .no-top-rule");
    check(".surf-rule .no-top-rule の規則が index.css にある", noTopBlock !== null);
    check("index.css の .surf-rule .no-top-rule は1回しか書かれていない(後勝ちの上書きが無い)",
      rulesFor(".surf-rule .no-top-rule").length === 1, `${rulesFor(".surf-rule .no-top-rule").length}回`);
    // セレクタの綴りそのものが .card を含まない(本人指示の絶対条件)。16節のロック検査は
    // セレクタに ".card" という文字列が現れることを前提に走査するので、含んでいたら
    // その時点でロック検査に引っかかって別の形で落ちる。ここは**その前提を直接確認する**。
    check(".surf-rule .no-top-rule というセレクタの綴りに \".card\" という文字列を含まない",
      !/\.card(?![-\w])/.test(".surf-rule .no-top-rule"));
    // 中身は border-top だけ(他のプロパティに手を広げていない = 乱用の芽を摘む)
    const noTopDecls = declList(noTopBlock ?? "");
    check(".surf-rule .no-top-rule は border-top だけを持つ(他のプロパティに触れていない)",
      noTopDecls.length === 1 && noTopDecls[0].name === "border-top",
      noTopDecls.map((d) => d.name).join(" ") || "0件");
    check(".surf-rule .no-top-rule の border-top は none",
      decl(noTopBlock, "border-top") === "none", String(decl(noTopBlock, "border-top")));
    // 【カスケードの実地検証】.surf-rule .card と .surf-rule .no-top-rule は詳細度が
    // 同じ(0,2,0)。ファイル順で後に書かれたほうが border-top を決める。ここでは
    // 「両方のクラスを持つ要素に実際にどちらが効くか」を宣言列を連結してシミュレートする
    // (decl() は最後に一致した宣言を返すので、連結順=カスケード順そのもの)。
    {
      const ruleIdx = cssRules.findIndex((r) => r.sels.includes(".surf-rule .card"));
      const noTopIdx = cssRules.findIndex((r) => r.sels.includes(".surf-rule .no-top-rule"));
      check(".surf-rule .no-top-rule は .surf-rule .card より後に書かれている(後勝ちが成立する)",
        ruleIdx !== -1 && noTopIdx !== -1 && noTopIdx > ruleIdx, `card=${ruleIdx} no-top-rule=${noTopIdx}`);
      const cardBody = cssBlock(".surf-rule .card") ?? "";
      const merged = cardBody + ";" + (noTopBlock ?? "");
      check("両方のクラスを持つ要素では border-top が none に上書きされる(カスケードのシミュレーション)",
        decl(merged, "border-top") === "none", String(decl(merged, "border-top")));
      // 【変異への裏取り】.no-top-rule 側を外した(=merged から除いた)ときは
      // .surf-rule .card 単体の border-top(= 罫が生きている状態)に戻ることを確認する。
      // これが変わらなければ、上のテストは「連結すれば必ず none になる」という
      // 恒等式を検査しているだけで、何も守っていないことになる(LOOP.md が戒める罠)。
      check("(裏取り) .no-top-rule を外すと border-top は元の罫(1px solid var(--c-rule))に戻る",
        decl(cardBody, "border-top") === "1px solid var(--c-rule)", String(decl(cardBody, "border-top")));
    }
  }
  // App.jsx 側: no-top-rule を付けているのは本人指示の2箇所だけ(乱用しないこと)。
  {
    const noTopTags = tagsWithClass("no-top-rule");
    check('className="card no-top-rule" は2箇所だけ(リード登録カード / 識別情報カードの2つのみ)',
      noTopTags.length === 2, `${noTopTags.length}箇所`);
    check("no-top-rule を持つタグはすべて .card も同時に持つ(単独では使わない)",
      noTopTags.every((t) => (t.match(/className="([^"]*)"/) || ["", ""])[1].trim().split(/\s+/).includes("card")),
      noTopTags.join(" | ").slice(0, 200));
  }

  // extractFunction (ファイル先頭) は「関数名の直後の最初の { 」を本体開始とみなすため、
  // 分割代入の引数(`function X({ a, b }) {`)を持つ関数では引数側の { } で早期に
  // 閉じてしまい、本体を取り違える(実際に確認済み: MyDataSection で69文字しか取れず、
  // noteFocus を含む本体が丸ごと欠落した)。ここでは「引数の丸括弧をまず対応させ、
  // その後で最初の { から本体を対応させる」正しい版をローカルに用意する
  // (15節の sourceOf と同じ実装。15節はブロックスコープに閉じているため再利用できない)。
  const srcOf = (name) => {
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
  // --- 6.6 noteFocus(音名の絞り込み)は指定した2箇所だけに効く ------------
  // データタブの「My Data」「最新セッション」の各カードだけ x軸を E♭3/E♭4/E♭5 に絞る。
  // ReedEvaluationDetail の測定データ・SessionDetailView のセッション平均・ReedCompareTab は
  // 対象外(従来どおり全音域)。渡し忘れ・渡しすぎのどちらも壊れたら検出できるようにする。
  {
    const FOCUS = 'noteFocus={["E♭3", "E♭4", "E♭5"]}';
    const total = (src.match(/noteFocus=\{\["E♭3", "E♭4", "E♭5"\]\}/g) || []).length;
    check("noteFocus=[\"E♭3\",\"E♭4\",\"E♭5\"] を渡す箇所は全体でちょうど2箇所",
      total === 2, `${total}箇所`);
    const myData = srcOf("MyDataSection");
    const latest = srcOf("LatestSessionCard");
    const reedDetail = srcOf("ReedEvaluationDetail");
    const sessionDetail = srcOf("SessionDetailView");
    check("MyDataSection(My Dataカード)は noteFocus を渡す", myData.includes(FOCUS));
    check("LatestSessionCard(最新セッションカード)は noteFocus を渡す", latest.includes(FOCUS));
    check("ReedEvaluationDetail(登録済みリードの測定データ)は noteFocus を渡さない(全音域のまま)",
      !reedDetail.includes("noteFocus"));
    check("SessionDetailView(セッション平均)は noteFocus を渡さない(全音域のまま)",
      !sessionDetail.includes("noteFocus"));
    // TappableMetricCard の呼び出しは全体で4箇所(登録済みリード/My Data/最新セッション/
    // セッション詳細)。noteFocus を持つのはそのうち2箇所だけ、という数の対応も見る
    // (渡し忘れ・渡しすぎのどちらでもここが動く)。
    const callSites = (src.match(/<TappableMetricCard/g) || []).length;
    check("TappableMetricCard の呼び出しは4箇所", callSites === 4, `${callSites}箇所`);
  }
  // NoteAxisLineChart / TappableMetricCard 自体が noteFocus を実装として持っている
  // (呼び出し側だけ書いて実装が無い、という状態を防ぐ)。
  {
    const chart = srcOf("NoteAxisLineChart");
    check("NoteAxisLineChart は noteFocus を受け取る(既定 null)", /noteFocus\s*=\s*null/.test(chart));
    // 2026-08-04 本人指示により仕様を訂正: noteFocus はデータ(折れ線・y軸)を絞り込まず、
    // 横軸の「ラベル表示」だけを絞る。plotN/plotNoteLabels は常に N/noteLabels のままで、
    // データの再マッピング(旧: focusIndexes によるインデックス付け替え)は行わない。
    check("NoteAxisLineChart は noteFocus 指定時もデータ(折れ線・y軸)は絞り込まない(plotN/plotNoteLabelsは常にN/noteLabels)",
      /const plotN = N;/.test(chart) && /const plotNoteLabels = noteLabels;/.test(chart) && !/focusIndexes/.test(chart));
    check("NoteAxisLineChart は noteFocus 指定時、横軸ラベルだけを noteFocus に含まれる音名に絞る(plotNoteLabels[i] を noteFocus で判定)",
      /noteFocus\.includes\(plotNoteLabels\[i\]\)/.test(chart));
    // データを絞り込まなくなったため、中央E♭の強調(ガイド線)を noteFocus で特別扱いする理由も
    // 無くなった(3音とも同じE♭系列という前提自体が旧仕様のもの)。ebIndexes は常に通常どおり計算する。
    check("NoteAxisLineChart は noteFocus指定時も中央E♭の強調(ガイド線)を通常どおり計算する(ebIndexesはnoteFocusで分岐しない)",
      !/noteFocus \? \[\] :/.test(chart));
    const card = srcOf("TappableMetricCard");
    check("TappableMetricCard は noteFocus を受け取り NoteAxisLineChart へそのまま渡す(既定 null)",
      /noteFocus\s*=\s*null/.test(card) && /noteFocus=\{noteFocus\}/.test(card));
  }
  // --- 6.7 符号付きピッチ誤差(pitchCentsSigned)は0中心の対称軸・折れ線1本 ------------
  // 【2026-08-04 本人指示で仕様変更】以前は「ピッチの安定度」(pitchStabilityCents = 標準偏差、
  // 常に非負)を ±v の2本のミラー折れ線で帯として見せていた。本人の指示は
  //   「0を挟んで上が＋、下がマイナスに変更。この変更で折れ線グラフが1本になるはず」
  // で、見たいのは「シャープ側/フラット側のどちらへどれだけズレたか」だったため、
  // My Data のカードは符号付きの平均ズレ(pitchCentsSigned)に変わり、ミラー描画は
  // 使う指標が無くなったので撤去した。**ミラーを復活させないこと**(復活させると
  // 1本のはずの線が2本に戻り、指示に反する)。
  {
    const chart = srcOf("NoteAxisLineChart");
    const myData = extractConst("MY_DATA_METRICS");
    check("MY_DATA_METRICS のピッチ系指標は符号付き(pitchCentsSigned)である",
      /key: "pitchCentsSigned"/.test(myData));
    check("MY_DATA_METRICS に非負のブレ幅(pitchStabilityCents)はもう使われていない",
      !/key: "pitchStabilityCents"/.test(myData));
    // 【2026-08-04 F-46 本人指示で仕様変更】以前は「リード比較系だけ絶対値のまま」だったが、
    // 本人自身が上書きし、リード比較タブ・リード個別ページも符号付きに統一された。
    const reedCompare = extractConst("REED_COMPARE_METRICS");
    check("REED_COMPARE_METRICS のピッチも符号付き(pitchCentsSigned)に統一(F-46)",
      /key: "pitchCentsSigned"/.test(reedCompare) && !/key: "pitchCents",/.test(reedCompare));
    check("REED_COMPARE_METRICS のピッチのラベルは「ピッチ誤差」・fmtは符号付き",
      /label: "ピッチ誤差", unit: "¢", fmt: \(v\) => `\$\{v >= 0 \? "\+" : ""\}\$\{v\.toFixed\(1\)\}`/.test(reedCompare));
    check("旧SESSION_METRICS(符号付き差し替え版)は廃止され、配列は1つに統合されている(F-46)",
      !/SESSION_METRICS/.test(codeOf(src)));
    check("リード比較タブのグラフのピッチも符号付きキーを使う(F-46)",
      /\["volumeDb", "pitchCentsSigned", "hnrDb", "spectralCentroidHz"\]/.test(src));
    check("NoteAxisLineChart は metricKey===\"pitchCentsSigned\" で分岐する",
      /metricKey === "pitchCentsSigned"/.test(chart));
    check("符号付きピッチ誤差は縦軸ドメインを ±maxAbs の対称にする(lo = -hi)", /lo = -hi;/.test(chart));
    check("ゼロ除算だけ避ける(実測が全て0のとき hi を1にフォールバック)",
      /hi = maxAbs \|\| 1;/.test(chart));
    // ここが今回の指示の芯。ミラー描画の痕跡(2本目のポリライン・負値の作成・分岐フラグ)が
    // 1つでも残っていたら、線が2本に戻り得るということなので落とす。
    // **「綴りが無いこと」を見る検査は codeOf() を通す**(このファイル冒頭の規約)。
    // 通さないと、経緯をコメントに書き残しただけで落ちる(審査役が変異試験で実証)。
    const chartCode = codeOf(chart);
    check("ミラー描画の2本目のポリラインが無い(折れ線は1系列につき1本)",
      !/segmentsFor\(negByIdx\)/.test(chartCode));
    check("ミラー用の負値(negByIdx)を作っていない", !/negByIdx/.test(chartCode));
    check("ミラー分岐のフラグ(isStabilityMirror)が残っていない", !/isStabilityMirror/.test(chartCode));
    // 目盛は fmt に生の値を渡す(符号付きの fmt が自分で "+"/"-" を付ける)。絶対値に潰すと
    // 下端の目盛が上端と同じ表示になり、上下の向きが読めなくなる。
    check("縦軸の目盛は fmt に生の値をそのまま渡す(絶対値に潰さない)",
      /const tickTexts = tickVals\.map\(\(v\) => fmt\(v\)\);/.test(chart));
    check("符号付き指標の fmt は正の値に \"+\" を前置する(0を挟んだ向きが読める)",
      /fmt: \(v\) => `\$\{v >= 0 \? "\+" : ""\}\$\{v\.toFixed\(1\)\}`/.test(myData));
  }

  // --- 6.7b ピッチ指標の表記ゆれ禁止(F-46 本人指示) ---------------------------
  // 「平均ピッチ誤差」「ピッチの安定度」「ピッチ誤差(絶対値)」「平均ピッチ偏差」の
  // 4表記は全て「ピッチ誤差」に統一された。動く側(コメント除去後)のソースに
  // 旧表記が1つも現れないことを固定する(経緯はコメントに書き残してよい)。
  {
    const liveSrc = codeOf(src);
    for (const old of ["平均ピッチ誤差", "ピッチの安定度", "ピッチ誤差(絶対値)", "平均ピッチ偏差"]) {
      check(`旧表記「${old}」が動く側のソースに残っていない(表示は「ピッチ誤差」に統一)`,
        !liveSrc.includes(old));
    }
  }

  // --- 6.8 データタブ最上部のヒーロー「今日のピッチ誤差」は符号付き ------------
  // 本人指示(2026-08-04): 「データタブ最上部の今日のピッチ誤差は符号付きがいいです」。
  // 以前は絶対値(pitchCents)を渡しながら表示側だけ符号つき前提の分岐を持っており、
  // "-" が構造上出得なかった(BACKLOG F-37)。良否の色分けは今までどおり絶対値で評価する。
  {
    const myDataSection = srcOf("MyDataSection");
    // 【F-66で書き方が変わった】ばらつき(pitchStabilityCents)も同じ集計から出すため、
    // 指標オブジェクトを一度受けてから .pitchCentsSigned を取る形になった。
    // 「今日のフレームの computeFrameMetrics から符号付きの値を取る」という縛りは同じ強さで残す。
    check("ヒーローの今日の値は符号付き(pitchCentsSigned)を使う",
      /const todayMetrics = todayFrames\.length \? computeFrameMetrics\(todayFrames\) : null;/.test(myDataSection) &&
      /const todayVal = todayMetrics \? todayMetrics\.pitchCentsSigned : null;/.test(myDataSection));
    check("ヒーローの対象期間平均も符号付き(pitchCentsSigned)を使う",
      /const periodVal = overall\.pitchCentsSigned;/.test(myDataSection));
    check("ヒーローの良否判定は絶対値(0からの距離)のままで評価する",
      /const todayErr = todayVal != null \? Math\.abs\(todayVal\) : null;/.test(myDataSection) &&
      /const periodErr = periodVal != null \? Math\.abs\(periodVal\) : null;/.test(myDataSection));

    // 本人の問い(2026-08-04)「上方向にしかブレていないように見えるが実データが+側だけだから?」
    // → 違い、スパークラインだけ絶対値(pitchCents)を渡していたので**構造上片側にしか
    // 振れなかった**。すぐ上の大きい数字が符号つきなので、真下の線だけ絶対値だと読み違える。
    check("ヒーロー直下のスパークラインも符号付き(pitchCentsSigned)を使う",
      /const sparkVals = points\.map\(\(p\) => p\.pitchCentsSigned\)/.test(myDataSection));
    check("スパークラインは絶対値(pitchCents)を使っていない",
      !/points\.map\(\(p\) => p\.pitchCents\)/.test(codeOf(myDataSection)));
    // 符号付きにしただけでは足りない。minV〜maxV の自動フルスケールのままだと0がどこか
    // 分からず、上下の向きが読めない(0中心の対称スケール + 0の基準線がセットで要る)。
    check("スパークラインは0を中央に置いた対称スケールにする",
      /const zeroY = H \/ 2;/.test(myDataSection) &&
      /const maxAbs = Math\.max\(\.\.\.sparkVals\.map\(\(v\) => Math\.abs\(v\)\)\) \|\| 1;/.test(myDataSection));
    check("スパークラインは0の基準線を描く(上下の意味が読めるように)",
      /<line x1="0" y1=\{zeroY\} x2=\{W\} y2=\{zeroY\}/.test(myDataSection));
    check("スパークラインの面は0の線まで塗る(箱の底ではない)",
      /\$\{W\},\$\{zeroY\} 0,\$\{zeroY\}/.test(myDataSection));
  }

  // --- 6.9 input[type=date] は appearance を落として幅を効かせる ------------
  // 本人報告(2026-08-04・3周目): 「使用開始日の横幅がまだずれている。必ず修正しろ」。
  // iOS Safari の input[type=date] はネイティブのdateコントロールとして描かれる間、
  // 固有の内容幅を優先して CSS の width:100% を無視する(Chromeは無視しないため
  // Browser pane では再現せず、2周ぶん見落とした)。appearance を落とすと素の箱になり
  // width が効く。**この2行を外すと実機でだけ再発する**ので外さないこと。
  {
    const register = srcOf("ReedRegisterView");
    const dateInput = register.slice(register.indexOf('id="reed-startdate-input"'));
    const decl = dateInput.slice(0, dateInput.indexOf("/>"));
    check("使用開始日の input[type=date] は WebkitAppearance:none を持つ",
      /WebkitAppearance: "none"/.test(decl));
    check("使用開始日の input[type=date] は appearance:none も併記する(非WebKit系のため)",
      /appearance: "none"/.test(decl));
    check("使用開始日の input[type=date] は maxWidth:100% で親を超えないようにする",
      /maxWidth: "100%"/.test(decl));
    // 本人報告(2026-08-04)「横幅は直ったが縦幅が変わった」。appearance を落とすと幅と一緒に
    // **縦方向の固有の寸法も失われる**ため、行の高さを明示しないと中のテキストが上寄せに落ちる。
    check("使用開始日の input[type=date] は lineHeight を明示する(appearance:none で失う縦位置の補償)",
      /lineHeight: "1\.25"/.test(decl));
    check("使用開始日の input[type=date] は overflow:hidden を持つ(内部UIのはみ出しの最後の歯止め)",
      /overflow: "hidden"/.test(decl));
    // 高さは共通スタイル側で固定する。minHeight だけだと下限にしかならず、ネイティブ描画の
    // ままの select が 44px を上回ったときに使用開始日だけ低くなる(本人報告の「縦幅が変わった」)。
    const rf = rfBodyFor(src);
    check("REED_FORM_CONTROL_STYLE は height を固定して3つの欄の縦幅を揃える",
      /height: "var\(--tap-min\)"/.test(rf));
    check("REED_FORM_CONTROL_STYLE は minHeight も併記する(§5 の 44pt 要件の意図を残す)",
      /minHeight: "var\(--tap-min\)"/.test(rf));
  }

  // ============================================================
  console.log("\n========== 17. 操作するものの型(A型 = 枠線 / B型 = 地) ==========");
  // 本人指示(2026-08-03):
  //   「銘柄、番手、使用開始日のどれも枠線をつけていますが、枠線は重くなるので不要です」
  //   「他も背景と同じ色で枠線をつけるか、違う色で枠線をつかないかに統一してください」
  //   「メトロノームアイコンは on off の違いが分かったほうがいいので枠線があっていいです」
  //   「データタブのセッション一覧の絞り込みも枠線もあって色も変わっています どちらかにして」
  //
  // 確定した規則: **枠線は「状態を持つもの」にだけ使う。**
  //   A型 .ctl-state — 枠線 --c-line-strong / 地は透明。on-off・開閉・選択が切り替わるもの
  //   B型 .ctl-plain — 枠線なし        / 地は --c-sunken。状態を持たないもの
  // **同じ物に「枠線」と「違う地」を両方与えない。** これが統一の芯なので、
  // 下の「排他」の検査が本体で、個別の値の検査はその補助でしかない。
  //
  // この節は section 16 のスコープの中にある(cssRules / decl / tagsWithClass /
  // withPrefix / inlineProps などの道具をそのまま使うため)。
  {
    const code = codeOf(src);
    // 入力欄のタグ一覧(17.7 と 17.8 の両方で使う)。tagAt は section 16 の道具。
    const inputTags = [];
    {
      const re = /<(input|select|textarea)[\s>]/g;
      let m;
      while ((m = re.exec(src)) !== null) inputTags.push({ el: m[1], tag: tagAt(m.index + 1) });
    }

    // --- 17.1 B型の地のトークン(--c-sunken。F-30 の回収) ------------------
    // DESIGN-SYSTEM §1.2 にありながら index.css に定義が無く、段がひとつ欠けていた。
    check("B型の地のトークン --c-sunken が定義されている",
      /^#[0-9A-Fa-f]{6}$/.test(String(cssVar("--c-sunken"))), String(cssVar("--c-sunken")));
    check("--c-sunken は地(--c-bg)と別の値", cssVar("--c-sunken") !== cssVar("--c-bg"));
    // 枠線を外すと、地の差だけが「ここは触れる」の唯一の信号になる。**値ではなく差**で縛る。
    // 下限は現在値 #EEF1F4 の 1.1337:1。--c-sunk(1.0719:1)まで戻すとここで落ちる。
    {
      const now = ratio(cssVar("--c-bg"), cssVar("--c-sunken"));
      check("B型の地(--c-sunken)と白地の差は 1.1337:1 以上(枠線を外したぶん、地だけが合図になる)",
        now >= 1.1337 - 1e-4, `いま ${now.toFixed(4)}:1 / 下限 1.1337:1`);
    }
    // 段の順序: --c-bg(白) < --c-sunk < --c-sunken <= --c-line。
    // 面が罫(ヘアライン)より濃くなると、面と線の役割が入れ替わる。
    check("--c-sunken は --c-sunk より濃い(§1.2 の段の順序)",
      luminance(cssVar("--c-sunken")) < luminance(cssVar("--c-sunk")),
      `sunken L=${luminance(cssVar("--c-sunken")).toFixed(4)} / sunk L=${luminance(cssVar("--c-sunk")).toFixed(4)}`);
    check("--c-sunken は --c-line(ヘアライン)より濃くない(面が線を追い越さない)",
      luminance(cssVar("--c-sunken")) >= luminance(cssVar("--c-line")),
      `sunken L=${luminance(cssVar("--c-sunken")).toFixed(4)} / line L=${luminance(cssVar("--c-line")).toFixed(4)}`);

    // --- 17.2 型の規則そのもの -------------------------------------------
    const stateBlock = cssBlock(".ctl-state");
    const plainBlock = cssBlock(".ctl-plain");
    const pillBlock  = cssBlock(".ctl-pill");
    check("A型(.ctl-state) と B型(.ctl-plain) の規則が index.css にある",
      stateBlock !== null && plainBlock !== null);
    check("A型は枠線を持つ(--c-line-strong)",
      decl(stateBlock, "border") === "1px solid var(--c-line-strong)", String(decl(stateBlock, "border")));
    check("A型の地は透明(背景と同色。枠線と地を両方持たせない)",
      decl(stateBlock, "background") === "transparent", String(decl(stateBlock, "background")));
    check("B型の地は --c-sunken", decl(plainBlock, "background") === "var(--c-sunken)", String(decl(plainBlock, "background")));
    check("B型は枠線を持たない(border: 0)", decl(plainBlock, "border") === "0", String(decl(plainBlock, "border")));
    // 角丸は型のスケール(§2)から引く。ピル形だけを後ろの .ctl-pill が差し替える。
    check("A型の角丸は --r-sm", decl(stateBlock, "border-radius") === "var(--r-sm)", String(decl(stateBlock, "border-radius")));
    check("B型の角丸は --r-xs(入力欄のスケール)", decl(plainBlock, "border-radius") === "var(--r-xs)", String(decl(plainBlock, "border-radius")));
    check(".ctl-pill は角丸だけを差し替える(地・枠を持たない)",
      pillBlock !== null && decl(pillBlock, "border-radius") === "var(--r-pill)" &&
      declList(pillBlock).every((d) => d.name === "border-radius"),
      declList(pillBlock ?? "").map((d) => d.name).join(" "));
    // 後に書いたほうが勝つ。.ctl-pill が型より前にあると角丸が効かない。
    {
      const idx = (sel) => cssRules.findIndex((r) => r.sels.includes(sel));
      check(".ctl-pill は .ctl-state / .ctl-plain より後に書かれている(角丸の後勝ちが成立する)",
        idx(".ctl-pill") > idx(".ctl-state") && idx(".ctl-pill") > idx(".ctl-plain"),
        `state=${idx(".ctl-state")} plain=${idx(".ctl-plain")} pill=${idx(".ctl-pill")}`);
    }

    // --- 17.3 【統一の芯】枠線と違う地を両方持たない ----------------------
    // ここが規則の本体。個別の値ではなく「排他」そのものを見る。
    // 変異試験で確認済み: A型に地を足す / B型から地を外す / 入力欄に枠線を戻す
    // のいずれでもここが落ちる。
    const resolveVar = (v) => {
      let s = String(v ?? "").trim();
      for (let i = 0; i < 4; i++) {
        const m = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/.exec(s);
        if (!m) break;
        s = String(cssVar(m[1]) ?? "").trim();
      }
      return s;
    };
    // 「見える枠線」= 幅が 0 でなく、色が transparent でもない
    const borderVisible = (block) => {
      const b = String(decl(block, "border") ?? "").trim();
      if (!b) return false;
      const parts = b.split(/\s+/);
      if (parts.includes("none") || parts.includes("0") || parts.includes("0px")) return false;
      // border の色は最後の語。border-color を後から書いていればそちらが勝つ
      const col = decl(block, "border-color") ?? parts[parts.length - 1];
      const c = resolveVar(col).toLowerCase();
      return c !== "transparent" && c !== "rgba(0,0,0,0)";
    };
    // 「違う地」= 塗りがあり、それがページの地(--c-bg)と違う色
    const groundDistinct = (block) => {
      const g = resolveVar(decl(block, "background")).toLowerCase();
      if (!g || g === "transparent" || g === "none") return false;
      return g !== String(cssVar("--c-bg")).toLowerCase();
    };
    for (const [label, block] of [
      ["A型(.ctl-state)", stateBlock],
      ["B型(.ctl-plain)", plainBlock],
      ["入力欄(input/select/textarea)", inputBlock],
    ]) {
      const vis = borderVisible(block), gnd = groundDistinct(block);
      check(`${label} は「枠線」と「違う地」を両方持たない(統一の芯)`,
        !(vis && gnd), `枠線=${vis} 地=${gnd}`);
      check(`${label} は「枠線」か「違う地」のどちらか一方は持つ(触れると分かる合図が消えていない)`,
        vis || gnd, `枠線=${vis} 地=${gnd}`);
    }
    // 入力欄は B型でなければならない(A型に「昇格」させて枠線を戻す抜け道を塞ぐ)。
    check("入力欄は B型(枠線を持たない)。状態を持たないものに枠線を使わない",
      !borderVisible(inputBlock) && groundDistinct(inputBlock),
      `枠線=${borderVisible(inputBlock)} 地=${groundDistinct(inputBlock)}`);
    // 入力欄と B型クラスの地は同じトークンでなければならない(片方だけ変えると型が割れる)。
    check("入力欄の地と B型(.ctl-plain)の地は同じトークン",
      decl(inputBlock, "background") === decl(plainBlock, "background"),
      `入力欄=${decl(inputBlock, "background")} / .ctl-plain=${decl(plainBlock, "background")}`);

    // --- 17.4 A型の状態は「枠線の色」だけで返す --------------------------
    // 地を足すと A型が「枠線 + 違う地」になり、芯が崩れる。
    {
      const onSel = '.ctl-state[aria-pressed="true"]';
      const onBlock = cssBlock(onSel);
      check("A型の ON 状態の規則がある(aria-pressed / aria-expanded)", onBlock !== null);
      check("A型の ON 状態は枠線の色だけを変える(--c-accent)",
        decl(onBlock, "border-color") === "var(--c-accent)", String(decl(onBlock, "border-color")));
      check("A型の ON 状態は地・角丸・余白を持たない(状態は枠線の色だけで返す)",
        declList(onBlock ?? "").every((d) => d.name === "border-color"),
        declList(onBlock ?? "").map((d) => d.name).join(" "));
      check("A型の ON 状態は開閉(aria-expanded)にも効く",
        (rulesFor(onSel)[0]?.sels ?? []).includes('.ctl-state[aria-expanded="true"]'),
        (rulesFor(onSel)[0]?.sels ?? []).join(" | "));
    }

    // --- 17.5 型に触れる規則の集合を固定する ------------------------------
    // CSS は後勝ちなので、`[class~="ctl-plain"] { border: 1px solid #C3CAD3 }` を
    // 1行足すだけで B型に枠線が戻る(詳細度は .ctl-plain と同じ 0,1,0)。
    // 綴りではなく「型に効く宣言(地/枠/角丸)を持っているか」で見る。
    {
      const expect = [".ctl-state", '.ctl-state[aria-pressed="true"]',
        '.ctl-state[aria-expanded="true"]', ".ctl-plain", ".ctl-pill"];
      const re = /\.ctl-(state|plain|pill)(?![-\w])|\[\s*class\s*[~*^$|]?=\s*["']?[^"'\]]*ctl-(state|plain|pill)/;
      const touching = cssRules.filter((r) => r.sels.some((s) => re.test(s)));
      const owners = [...new Set(touching.filter((r) => hasSurfDecl(r.body))
        .flatMap((r) => r.sels).filter((s) => re.test(s)))].sort();
      check("index.css で型(A型/B型)に地・枠・角丸を与える規則はこの集合だけ",
        sameSet(owners, [...expect].sort()), owners.join(" | ") || "0件");
      for (const sel of [".ctl-state", ".ctl-plain", ".ctl-pill"]) {
        check(`index.css の ${sel} は1回しか書かれていない(後勝ちの上書きが無い)`,
          rulesFor(sel).length === 1, `${rulesFor(sel).length}回`);
      }
      // 影・輪郭は border を書かずに「枠線」を描き直せる別経路
      // (boxShadow: "inset 0 0 0 1px #C3CAD3" は見た目そのものが枠線)。
      for (const sel of [".ctl-state", ".ctl-plain", ".ctl-pill"]) {
        const boxy = declList(cssBlock(sel)).map((d) => d.name)
          .filter((n) => /^(box-shadow|outline|filter|backdrop-filter)/.test(n));
        check(`${sel} は影・輪郭で枠線を描き直していない`, boxy.length === 0, boxy.join(" "));
      }
      // App.jsx の <style> は body の中に描かれるので、同じ詳細度なら必ず勝つ。
      // section 16 の PAINT_OK 検査が地・枠を塞いでいるが、型のクラスは名指しでも塞ぐ。
      const st = /<style>\{`([\s\S]*?)`\}<\/style>/.exec(src);
      const appRules = st ? parseRules(st[1]) : [];
      const bad = appRules.filter((r) => r.sels.some((s) => re.test(s)));
      check("App.jsx の <style> は型のクラス(.ctl-*)に触れる規則を持たない",
        bad.length === 0, bad.map((r) => r.sels.join(",")).join(" | "));
    }

    // --- 17.6 JSX 側: 型はクラスで表す。インラインで書き戻さない -----------
    const stateTags = tagsWithClass("ctl-state");
    const plainTags = tagsWithClass("ctl-plain");
    const pillTags  = tagsWithClass("ctl-pill");
    check("A型(.ctl-state)が実際に使われている", stateTags.length >= 2, `${stateTags.length}箇所`);
    check("B型(.ctl-plain)が実際に使われている", plainTags.length >= 1, `${plainTags.length}箇所`);
    // className={...} の式に隠すと下の走査から丸ごと外れる(.card と同じ抜け道)。
    {
      const exprs = (src.match(/className=\{[^}]*\}/g) || []).filter((s) => /\bctl-(state|plain|pill)\b/.test(s));
      check("型のクラス(ctl-*)は className=\"…\" の直書きだけ(式に隠して走査から逃げていない)",
        exprs.length === 0, exprs.slice(0, 2).join(" | "));
    }
    // インライン style はクラスより強い。地・枠・角丸・影を1つでも書くと型が効かなくなる。
    {
      const all = [...stateTags, ...plainTags, ...pillTags];
      const bad = withPrefix(all, ["background", "border", "boxshadow", "outline", "filter", "backdropfilter"]);
      check("型のクラスを持つタグに background* / border* / 影 / 輪郭のインライン宣言が無い",
        bad.length === 0, bad.length ? bad[0].slice(0, 200) : "");
      const opaque = all.filter((t) => /style=\{(?!\{)/.test(t));
      check("型のクラスを持つタグの style はオブジェクトリテラル直書きだけ(変数経由で走査から逃げていない)",
        opaque.length === 0, opaque.length ? opaque[0].slice(0, 160) : "");
      const spread = all.filter((t) => /style=\{\{[\s\S]*?\.\.\.[\s\S]*?\}\}/.test(t));
      check("型のクラスを持つタグの style にスプレッドが無い(中身が静的に読めなくなる)",
        spread.length === 0, spread.length ? spread[0].slice(0, 160) : "");
    }

    // --- 17.7 個別の割り当て ---------------------------------------------
    // メトロノーム = A型。本人指示「on off の違いが分かったほうがいいので枠線があっていい」。
    {
      const i = src.indexOf('aria-label="メトロノーム"');
      const tag = i === -1 ? "" : tagAt(i);
      check("メトロノームのボタンは A型(ctl-state)", /className="[^"]*\bctl-state\b/.test(tag),
        (tag.match(/className="[^"]*"/) || ["className 無し"])[0]);
      check("メトロノームのボタンは ON/OFF を aria-pressed で持つ(A型の状態の出所)",
        /aria-pressed=\{showMetroPanel\}/.test(tag));
      check("メトロノームのボタンはインラインで地・枠を書き戻していない",
        !withPrefix([tag], ["background", "border"]).length, tag.slice(0, 200));
      // 旧実装(枠 + 地の両方)が残っていないこと
      check("メトロノームの旧実装(枠と地を両方持つ)が残っていない",
        !/showMetroPanel \? "1\.5px solid|showMetroPanel \? "#EAEFF5"/.test(code));
    }
    // 「詳細を見る」トグル = A型(開/閉の状態を持つ)。
    {
      const i = src.indexOf('"詳細を閉じる"');
      const tag = i === -1 ? "" : tagAt(i);
      check("「詳細を見る」トグルは A型(ctl-state)", /className="[^"]*\bctl-state\b/.test(tag),
        (tag.match(/className="[^"]*"/) || ["className 無し"])[0]);
      check("「詳細を見る」トグルはピル形(ctl-pill)", /className="[^"]*\bctl-pill\b/.test(tag));
      check("「詳細を見る」トグルは開閉を aria-expanded で持つ", /aria-expanded=\{detailOpen\}/.test(tag));
      check("「詳細を見る」トグルの旧実装(枠 #D9E1EC + 地 #F3F6FA)が残っていない",
        !code.includes('border: "1px solid #D9E1EC", background: "#F3F6FA"'));
    }
    // リード選択ピル = B型(状態を持たない選択欄)。
    // 【F-50 で角丸が変わった】本人指示「画面上部のリード枠が一つだけ丸いので、奏者枠と
    // 同じ形式に変更」により .ctl-pill を外した。**対象を綴りで特定し直す**こと。
    // 以前は plainTags の中から「ctl-pill を持つ最初のもの」で拾っていたが、それだと
    // テンポの ± ボタン(同じ ctl-plain ctl-pill)が代わりに当たって**別の要素を検査したまま
    // 緑になる**(実際 F-50 の変更後もこの検査は通ってしまった)。
    {
      const i = src.indexOf('<option value="">リードを選択</option>');
      const tag = i === -1 ? "" : tagAt(src.lastIndexOf('<div className="ctl-plain', i) + 1);
      check("計測タブのリード選択ピルを綴りで特定できている", tag !== "" && /ctl-plain/.test(tag), tag.slice(0, 160));
      check("計測タブのリード選択ピルは B型(ctl-plain)", /className="[^"]*\bctl-plain\b/.test(tag), tag.slice(0, 160));
      // 【F-50 の完了条件そのもの】隣の奏者枠は素の <select> なので角丸は入力欄の規則が決める。
      // 「同じ形式」= 同じ角丸の値になること。値ではなく **2つの規則の一致** で縛る
      // (どちらかを勝手に変えたら落ちる)。ctl-pill を戻しても落ちる。
      check("リード選択ピルはピル形(ctl-pill)を持たない(奏者枠と同じ角丸にする)",
        !/className="[^"]*\bctl-pill\b/.test(tag), tag.slice(0, 160));
      check("リード選択ピル(B型)の角丸と、奏者枠(素の select)の角丸が同じ規則から来ている",
        decl(plainBlock, "border-radius") === decl(inputBlock, "border-radius") &&
        decl(plainBlock, "border-radius") === "var(--r-xs)",
        `.ctl-plain=${decl(plainBlock, "border-radius")} / select=${decl(inputBlock, "border-radius")}`);
      check("リード選択ピルは角丸をインラインで書き戻していない",
        !withPrefix([tag], ["borderradius"]).length, tag.slice(0, 160));
      check("リード選択ピルの旧実装(選択で地を塗り分ける)が残っていない",
        !/selectedReedId \? "#EAEFF5"/.test(code));
      // ピルの中の select 2つは DESIGN-SYSTEM §6.6 が明記する**意図的な例外**。
      // ピル自身が地を持つので、中の select にさらに地・枠を出すと二重になる。
      // 次の実装役がこれを違反と読んで潰さないよう、ここで「例外のまま」を固定する。
      const pillSelects = inputTags
        .filter((x) => x.el === "select" && /background: "none", border: "none"/.test(x.tag)).length;
      check("リード選択ピルの中の select 2つは地も枠も持たない(§6.6 の意図的な例外を維持)",
        pillSelects === 2, `${pillSelects}箇所`);
    }
    // データタブの軸セレクタ = §6.6 の意図的な例外(枠なし・地なし)。B型にすると地が付く。
    check("select.pivot-axis-select は例外のまま(枠なし・地なし)",
      /select\.pivot-axis-select \{[^}]*background:transparent;[^}]*border:none;/.test(src));

    // --- 17.8 入力欄にインラインで地・枠を書いていないこと ------------------
    // CSS を B型にしても、個々の <input> / <select> に
    // style={{ border: "1px solid #C3CAD3" }} と書けば枠線は戻る。
    // 例外はピルの中の select 2つ(上で数を固定した「地も枠も無い」だけ)。
    {
      const tags = inputTags.map((x) => x.tag);
      check("入力欄のタグを走査できている", tags.length >= 25, `${tags.length}箇所`);
      const bad = withPrefix(tags, ["background", "border", "boxshadow"])
        .filter((t) => !/background: "none", border: "none"/.test(t));
      check("<input>/<select>/<textarea> にインラインの地・枠・影が無い(例外はピル内の select 2つ)",
        bad.length === 0, bad.length ? bad[0].slice(0, 200) : "");
      // 共通スタイルのオブジェクト経由でも書き戻せる。角丸も型が持つ。
      const rfBody = rfBodyFor(src);
      check("REED_FORM_CONTROL_STYLE がある", rfBody !== "");
      check("REED_FORM_CONTROL_STYLE は地・枠・角丸を持たない(型が持つ)",
        !withPrefix([rfBody], ["background", "border", "boxshadow"]).length, rfBody.replace(/\s+/g, " ").slice(0, 160));
    }

    // --- 17.9 リード登録: 銘柄+番手は2カラム、使用開始日は単独1行フル幅 -------
    // 2026-08-04 本人指示により確定仕様を訂正: 「計測タブ上部のリード選択と同じように
    // 銘柄と番手は同じ行でまとめて、カレンダー(使用開始日)だけ違う段に表示」。
    // 過去(F-23)に見つかった実機不具合は「番手+使用開始日」を2カラムにした版で
    // input[type=date] が iOS Safari の最小内容幅(Chrome実測150px)から縮まず
    // はみ出したというもの(番手とdateの組み合わせ)。今回の組み合わせは
    // 銘柄+番手(どちらもselect)で、input[type=date]をこの2カラムに含めないため、
    // その不具合は再現しない。使用開始日は今まで通り単独の1行フル幅のまま変更しない。
    {
      const startIdx = src.indexOf("新しいリードを登録");
      const endIdx = src.indexOf("1枚ずつ追加", startIdx);
      const block = startIdx === -1 || endIdx === -1 ? "" : src.slice(startIdx, endIdx);
      check("リード登録カードのブロックを走査できている", block !== "");
      check("リード登録: 銘柄+番手の2カラムグリッド(display:grid, 1fr 1fr)がある",
        /display: "grid", gridTemplateColumns: "1fr 1fr"/.test(block), block.replace(/\s+/g, " ").slice(0, 200));
      // 銘柄セレクトと番手セレクトが同じグリッドの中(=グリッドdivの開始から次の
      // フル幅div開始までの間)にあることを見る(渡し忘れ・順序ずれの検出)。
      const gridStart = block.indexOf('display: "grid", gridTemplateColumns: "1fr 1fr"');
      const fullWidthStart = block.indexOf('<div style={{ marginBottom: 8 }}>');
      const gridBlock = gridStart === -1 ? "" : block.slice(gridStart, fullWidthStart === -1 ? undefined : fullWidthStart);
      check("2カラムグリッドの中に銘柄セレクトと番手セレクトが両方ある",
        /id="reed-brand-select"/.test(gridBlock) && /id="reed-strength-select"/.test(gridBlock));
      check("2カラムグリッドの各項目に minWidth: 0 がある(グリッド内の select が 1fr を超えて広がらないため)",
        (gridBlock.match(/minWidth: 0/g) || []).length === 2, gridBlock.replace(/\s+/g, " ").slice(0, 300));
      // 使用開始日は2カラムに含めず、銘柄と同じ「1行フル幅」のdivのまま(F-23で確定した形を維持)。
      const fullWidthRows = (block.match(/<div style=\{\{ marginBottom: 8 \}\}>/g) || []).length;
      check("リード登録: 使用開始日は単独の1行フル幅のdivのまま(2カラムに含まれない)",
        fullWidthRows === 1, `${fullWidthRows}箇所`);
      check("使用開始日の input[type=date] は REED_FORM_CONTROL_STYLE(width:100%)を使っている",
        /id="reed-startdate-input"[\s\S]{0,200}REED_FORM_CONTROL_STYLE/.test(block));
      check("使用開始日の input[type=date] 自身が width:100% を持つ(REED_FORM_CONTROL_STYLE経由)",
        /width: "100%",/.test(rfBodyFor(src)), rfBodyFor(src).replace(/\s+/g, " ").slice(0, 160));
    }

    // --- 17.10 【統一の芯】JSX 側を機械的に走査する ------------------------
    // ここまでの 17.7〜17.9 は「メトロノーム」「詳細を見る」…と**対象を綴りで名指し**
    // していた。名指しの検査は、名指ししていない要素をいくら増やされても発火しない
    // (実際 前周は名指しした4件だけを直し、拍子ボタン6個・分割・拍グループ・
    //  音域バンド・値ピル・キャンセル/クリア/＋条件を追加 … が同じ違反のまま残っていた)。
    //
    // この節は**対象を列挙しない**。JSX のタグを全部走査し、規則そのものを2つ当てる:
    //   (芯1) 操作するものは「見える全周の枠線」と「違う地」を**同じ分岐で**両方持たない
    //   (芯2) 「見える全周の枠線」を持てるのは**状態を持つ操作**だけ
    //         (= aria-pressed / aria-expanded を持つ、または .ctl-state)
    //
    // 【入口(=何を「操作するもの」と見るか)】次の3つ。ここに挙げたものが入口のすべてで、
    // 走査はこの入口と**その部分木の中のタグ**に掛かる(見た目のピルを内側の <span> に
    // 持たせる書き方があるため)。
    //   (i)   <button> / <select> / <input> / <textarea>
    //   (ii)  role="button" を持つタグ
    //   (iii) onClick / onPointerDown / onPointerUp / onMouseDown / cursor:"pointer" の
    //         いずれかを持つ**小文字タグ**(= DOM のタグ)
    //
    // 【なぜ (iii) が要るか】以前は (i)(ii) だけを入口にし、「列挙の漏れは走査不能の判定で
    // 担保される」と称していたが、**これは実態と違った**。走査不能の判定は入口の中の要素に
    // しか掛からないので、入口の外の要素は判定にすら到達しない。審査役の変異で
    //   ・<div onClick> に 枠+違う地   → SURVIVE
    //   ・<label> でくるんで 枠+違う地 → SURVIVE
    // が通り、実際に App.jsx の「基準」プロファイル行(<div onClick> + cursor:pointer +
    // 選択中だけ 1.5px 枠 + 地 #EAEFF5)が違反のまま残っていた。入口の形ひとつで
    // 落ちていたので、入口を「タグの綴り」ではなく「触れるかどうか」で決める。
    //
    // 【入口の中の担保】走査はインライン style を**静的に読めること**が前提なので、
    // 読めない書き方(style={式} / 未知のスプレッド / 文字列リテラルでない枠の値)は
    // **それ自体を失敗にする**(下の「走査不能」)。実際 SetAsIdealButton は
    // `style={tapMin ? {…} : {…}}` の式だったせいで前周の走査を丸ごとすり抜けており、
    // 枠(--c-accent)と地(--c-accent-tint)を両方持ったまま残っていた。
    //
    // 【除外】通知面(タップで消せるが操作対象ではないもの)だけは data-frame-exempt で
    // 明示的に外せる。外せるのは (iii) で拾ったタグだけで、<button> 等は外せない。
    // 件数も下で固定するので、貼れば逃げられる印にはならない。
    // (F-?? 計測タブのエラー通知(唯一の使用箇所だった)を、上部の赤い帯から
    //  保存確認モーダルと同じ idiom のモーダルに変更した。モーダルは 背景(ground)だけの
    //  暗幕 + 枠を持たないカード + 枠なしの塗りボタン、で構成され、「枠と地を同じ要素が
    //  同時に持つ」組み合わせがそもそも無いため、この除外印は不要になった。
    //  以後 data-frame-exempt の使用箇所は0件が正)
    {
      // (0) コメントを空白で潰す(位置は保つ)。コメント中の例示コードを拾わないため。
      //     【罠】`/\/\*[\s\S]*?\*\//` をそのまま当てると accept="audio/*,video/*" の
      //     `/*` をコメントの開始と読み、そこから次の `*/` までを丸ごと消してしまう
      //     (実際これで <input type="file"> 以降の 400行が走査から消え、
      //      通知面が「操作するもの」に化けて誤検出になった)。
      //     コメントの開始は**直前が空白か区切り記号のとき**だけと見る。
      const blank = (m) => m.replace(/[^\n]/g, " ");
      const jsx = src
        .replace(/(^|[\s{(,;=])\/\*[\s\S]*?\*\//g, (m, a) => a + blank(m.slice(a.length)))
        .replace(/(^|\n)([ \t]*)(\/\/[^\n]*)/g, (m, a, b, c) => a + b + blank(c));

      // (1) 開始タグの走査。タグの終わりは {} の深さ0に現れる > (section 16 の tagAt と同じ考え)
      const tagEndAt = (start) => {
        let depth = 0;
        for (let i = start; i < jsx.length; i++) {
          if (jsx[i] === "{") depth++;
          else if (jsx[i] === "}") depth--;
          else if (jsx[i] === ">" && depth === 0) return i + 1;
        }
        return jsx.length;
      };
      const opens = [];
      {
        const re = /<([A-Za-z][A-Za-z0-9.]*)[\s/>]/g;
        let m;
        while ((m = re.exec(jsx)) !== null) {
          const end = tagEndAt(m.index);
          opens.push({ el: m[1], start: m.index, end, tag: jsx.slice(m.index, end) });
        }
      }
      // 対応する閉じタグまで(= その操作の部分木)。自己終了タグは自分だけ
      const subtreeEnd = (o) => {
        if (/\/>\s*$/.test(o.tag)) return o.end;
        const close = `</${o.el}>`;
        let depth = 1, i = o.end;
        while (i < jsx.length) {
          const c = jsx.indexOf(close, i);
          if (c === -1) return jsx.length;
          let nested = 0;
          const re = new RegExp(`<${o.el}[\\s/>]`, "g");
          re.lastIndex = i;
          let mm;
          while ((mm = re.exec(jsx)) !== null && mm.index < c) {
            if (!/\/>\s*$/.test(jsx.slice(mm.index, tagEndAt(mm.index)))) nested++;
          }
          depth += nested - 1;
          i = c + close.length;
          if (depth === 0) return i;
        }
        return jsx.length;
      };

      // (2) 中括弧の対応を取る(スプレッド元・関数の返り値を読むのに使う)
      const braceBody = (s, open) => {
        let d = 0;
        for (let i = open; i < s.length; i++) {
          if (s[i] === "{") d++;
          else if (s[i] === "}") { d--; if (d === 0) return s.slice(open + 1, i); }
        }
        return null;
      };
      // `const NAME = { … };` と `function NAME(…) { return { … }; }` の中身
      const objSource = (name) => {
        let m = new RegExp(`const ${name}\\s*=\\s*\\{`).exec(jsx);
        if (m) return braceBody(jsx, m.index + m[0].length - 1);
        m = new RegExp(`function ${name}\\s*\\(`).exec(jsx);
        if (m) {
          const r = jsx.indexOf("return {", m.index);
          if (r !== -1) return braceBody(jsx, r + "return ".length);
        }
        return null;
      };

      // (3) style の中身を「読めた宣言の列」にする。読めなければ null(=走査不能)
      const splitTop = (body) => {
        const out = [];
        let d = 0, cur = "";
        for (const ch of body) {
          if ("([{".includes(ch)) d++;
          else if (")]}".includes(ch)) d--;
          if (ch === "," && d === 0) { out.push(cur); cur = ""; } else cur += ch;
        }
        out.push(cur);
        return out.map((s) => s.trim()).filter(Boolean);
      };
      const readObj = (body, depth = 0) => {
        if (body === null || depth > 3) return null;
        const out = [];
        for (const part of splitTop(body)) {
          const sp = /^\.\.\.\s*([A-Za-z_$][\w$]*)\s*$/.exec(part);
          if (sp) {                        // スプレッドは元をたどる。たどれなければ走査不能
            const inner = readObj(objSource(sp[1]), depth + 1);
            if (inner === null) return null;
            out.push(...inner);
            continue;
          }
          if (part.startsWith("...")) return null;          // 式のスプレッド
          if (/^\[/.test(part)) return null;                // 計算したキー
          const i = part.indexOf(":");
          // 短縮記法({ height } のような値省略)。地・枠の綴りでは使えないので名前だけ拾う
          if (i === -1 && /^[A-Za-z_$][\w$]*$/.test(part)) { out.push({ name: part, value: "" }); continue; }
          if (i === -1) return null;
          out.push({ name: part.slice(0, i).trim(), value: part.slice(i + 1).trim() });
        }
        return out;
      };
      const styleOf = (tag) => {
        const i = tag.indexOf("style=");
        if (i === -1) return [];                            // style 無し = 読めている
        const j = tag.indexOf("{", i);
        if (j === -1) return null;
        const outer = braceBody(tag, j);                    // style={ … } の中身
        if (outer === null) return null;
        const t = outer.trim();
        if (t.startsWith("{")) return readObj(braceBody(t, 0));      // オブジェクトリテラル
        const id = /^([A-Za-z_$][\w$]*)\s*(\(|$)/.exec(t);           // 定数 / 関数呼び出し
        if (id) return readObj(objSource(id[1]));
        return null;                                        // 三項などの式 = 走査不能
      };

      // (4) 値の読み取り。三項は**条件式を値と読まない**
      //     (metroPanel === "sig" ? … の "sig" を地の値と誤読していた)
      const lits = (v) => [...String(v).matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      const arms = (v) => {
        const s = String(v).trim();
        const q = s.indexOf("?");
        if (q === -1) return { test: null, arms: [s] };
        const rest = s.slice(q + 1);
        let d = 0;
        for (let i = 0; i < rest.length; i++) {
          const ch = rest[i];
          if ("([{".includes(ch)) d++;
          else if (")]}".includes(ch)) d--;
          else if (ch === "?") d++;
          else if (ch === ":" && d === 0)
            return { test: s.slice(0, q).trim(), arms: [rest.slice(0, i).trim(), rest.slice(i + 1).trim()] };
        }
        return { test: s.slice(0, q).trim(), arms: [rest.trim()] };
      };
      // 「全周の枠」だけを見る。borderTop/Left… は**区切りの罫**なので箱を作らない。
      // borderRadius も箱の有無には関わらない。
      // boxShadow は **inset のときだけ**枠と見る。`inset 0 0 0 1px …` は border と同じ
      // 全周の線を描くので、border を外して inset 影で描き直す逃げ道になる
      // (審査役の変異で SURVIVE した経路。現状コードに inset 影は無い)。
      // inset でない影は落ち影(浮きの表現)なので枠ではない。
      // outline も全周の線を描く別経路。**インラインで**書いたものだけを見る
      // (App.jsx の <style> にある :focus-visible の outline はキーボード操作の
      //  焦点の合図で、常に見える枠ではないのでここには掛からない)。
      const FRAME = ["border", "borderWidth", "borderStyle", "borderColor",
        "borderBlock", "borderInline", "boxShadow",
        "outline", "outlineWidth", "outlineStyle", "outlineColor"];
      const GROUND = ["background", "backgroundColor", "backgroundImage"];
      const isFrame = (n) => FRAME.includes(n);
      const isGround = (n) => GROUND.includes(n);
      const frameVisible = (n, l) => {
        const s = String(l).trim().toLowerCase();
        if (n === "boxShadow") return s.includes("inset");
        if (!s || s === "none" || s === "0" || s === "0px") return false;
        if (s.includes("transparent")) return false;
        if (/^0(px)?(\s|$)/.test(s)) return false;
        return true;
      };
      const groundDistinct = (l) => {
        const s = resolveVar(l).trim().toLowerCase();
        if (!s || s === "none" || s === "transparent" || s === "inherit") return false;
        return s !== String(cssVar("--c-bg")).toLowerCase();
      };

      // (5) 入口。(i)(ii) はタグの綴り、(iii) は「触れるかどうか」で決める。
      const lineOf = (i) => src.slice(0, i).split("\n").length;
      const CONTROL = /^(button|select|input|textarea)$/;
      const styleCache = new Map();
      const dsOf = (o) => {
        if (!styleCache.has(o)) styleCache.set(o, styleOf(o.tag));
        return styleCache.get(o);
      };
      // cursor:"pointer" は三項の腕に入っていることがある(押せないときだけ default 等)ので
      // 宣言を読んで腕まで見る。style が読めない(=null)タグは、後で走査不能として落とす。
      const hasPointer = (o) => {
        const ds = dsOf(o);
        if (ds === null) return false;
        return ds.some((d) => d.name === "cursor" &&
          arms(d.value).arms.flatMap(lits).includes("pointer"));
      };
      const HANDLER = /\son(Click|PointerDown|PointerUp|MouseDown)\s*=/;
      const isTagged = (o) => CONTROL.test(o.el) || /role="button"/.test(o.tag);
      // (iii) で拾ったタグのうち、data-frame-exempt を持つものだけ外せる。
      // <button> 等((i)(ii))は data-frame-exempt を貼っても外れない。
      const exempt = [];
      const isEntry = (o) => {
        if (isTagged(o)) return true;
        if (!/^[a-z]/.test(o.el)) return false;           // 自作コンポーネントは入口にしない
        if (!(HANDLER.test(o.tag) || /style=/.test(o.tag) && hasPointer(o))) return false;
        if (/data-frame-exempt=/.test(o.tag)) { exempt.push(`${lineOf(o.start)}: <${o.el}>`); return false; }
        return true;
      };
      const controls = opens.filter(isEntry);
      const ranges = controls.map((c) => ({ c, end: subtreeEnd(c) }));
      const ownerOf = (o) => {
        let best = null;
        for (const { c, end } of ranges)
          if (o.start >= c.start && o.start < end && (!best || c.start > best.start)) best = c;
        return best;
      };
      const unreadable = [], both = [], framed = [];
      for (const o of opens) {
        const owner = ownerOf(o);
        if (!owner) continue;
        const ds = dsOf(o);
        if (ds === null) {
          // 【この走査の限界】大文字始まり = 自作コンポーネントの `style` は
          // ただのプロップで、CSS とは限らない(SeriesSwatch は SVG の線の色を受け取る)。
          // 読めることを要求するのは DOM のタグ(小文字)だけにする。
          // 自作コンポーネントが**自分の定義側で**描く地・枠は、その定義が
          // 操作の部分木の外にあるとこの走査には掛からない。コードレビューで見るしかない。
          if (/^[a-z]/.test(o.el)) unreadable.push(`${lineOf(o.start)}: <${o.el}>`);
          continue;
        }
        const bd = ds.filter((d) => isFrame(d.name));
        const gd = ds.filter((d) => isGround(d.name));
        // 枠の値は文字列リテラルでなければならない(変数に逃がすと読めなくなる)
        for (const d of bd) if (arms(d.value).arms.some((a) => lits(a).length === 0))
          unreadable.push(`${lineOf(o.start)}: <${o.el}> ${d.name} が文字列リテラルでない`);
        // (芯1) 同じ分岐で 枠 ∧ 違う地 を持たない。
        //       条件式が同じ三項どうしは真同士・偽同士で対にする。違えば総当たり。
        if (bd.length && gd.length) {
          const ba = arms(bd[0].value), ga = arms(gd[0].value);
          const pairs = [];
          if (ba.test && ga.test && ba.test === ga.test && ba.arms.length === 2 && ga.arms.length === 2) {
            for (let k = 0; k < 2; k++)
              for (const x of lits(ba.arms[k])) for (const y of lits(ga.arms[k])) pairs.push([bd[0].name, x, y]);
          } else {
            const bl = bd.flatMap((d) => arms(d.value).arms.flatMap(lits).map((x) => [d.name, x]));
            const gl = gd.flatMap((d) => arms(d.value).arms.flatMap(lits));
            for (const [n, x] of bl) for (const y of gl) pairs.push([n, x, y]);
          }
          for (const [n, x, y] of pairs) if (frameVisible(n, x) && groundDistinct(y))
            both.push(`${lineOf(o.start)}: <${o.el}> 枠(${n})="${x}" ∧ 地="${y}"`);
        }
        // (芯2) 枠を持てるのは状態を持つ操作だけ
        const hasFrame = bd.some((d) => arms(d.value).arms.flatMap(lits).some((x) => frameVisible(d.name, x)));
        const hasState = /aria-pressed=|aria-expanded=/.test(owner.tag) ||
          /className="[^"]*\bctl-state\b/.test(owner.tag);
        if (hasFrame && !hasState)
          framed.push(`${lineOf(o.start)}: <${o.el}> 枠あり / 状態なし(操作は ${lineOf(owner.start)} 行の <${owner.el}>)`);
      }
      // 走査そのものが空回りしていないことの下限。要素を減らして「0件だから合格」を作らせない
      check("入口(button/select/input/textarea/role=button/触れる小文字タグ)を走査できている",
        controls.length >= 80, `${controls.length}個`);
      console.log(`  入口: 合計 ${controls.length}個 (うち(iii)触れる小文字タグ ` +
        `${controls.filter((c) => !isTagged(c)).length}個) / 除外 ${exempt.length}件`);
      // 入口 (iii) が実際に効いていること。(i)(ii) だけに戻すとここが 0 になって落ちる。
      check("入口(iii)『触れる小文字タグ』が実際に拾えている",
        controls.filter((c) => !isTagged(c)).length >= 5,
        `${controls.filter((c) => !isTagged(c)).length}個`);
      // 除外は0件が正(唯一使っていた計測タブのエラー通知をモーダルに変更し、
      // 枠+地を同時に持つ通知面が無くなったため)。増えたら「印を貼って逃げた」ということ。
      check("data-frame-exempt による除外は0件(計測タブのエラー通知はモーダル化して枠+地の組を持たない)",
        exempt.length === 0, exempt.join(" | "));
      check("操作するものの style はすべて静的に読める(式・未知のスプレッド・変数の枠に逃がしていない)",
        unreadable.length === 0, unreadable.slice(0, 3).join(" | "));
      check("【芯1】操作するもので「全周の枠線」と「違う地」を同じ状態で両方持つものが1つも無い",
        both.length === 0, `${both.length}件: ` + both.slice(0, 3).join(" | "));
      check("【芯2】「全周の枠線」を持つ操作はすべて状態(aria-pressed / aria-expanded / .ctl-state)を持つ",
        framed.length === 0, `${framed.length}件: ` + framed.slice(0, 3).join(" | "));
      // 型のクラスが実際に広く行き渡っていること(名指しの検査では見えない全体像)
      check("A型(.ctl-state)は 8箇所以上で使われている", tagsWithClass("ctl-state").length >= 8,
        `${tagsWithClass("ctl-state").length}箇所`);
      check("B型(.ctl-plain)は 15箇所以上で使われている", tagsWithClass("ctl-plain").length >= 15,
        `${tagsWithClass("ctl-plain").length}箇所`);
    }

    // --- 17.11 角丸だけを差し替えるクラス(.ctl-pill / .ctl-lg) ---------------
    // 型は地・枠・角丸の3つを持つ。角丸だけは要素ごとに要るので後ろで差し替えるが、
    // ここに地や枠を書けば型が壊れる。.ctl-pill と同じ縛りを .ctl-lg にも当てる。
    {
      const lgBlock = cssBlock(".ctl-lg");
      check(".ctl-lg は角丸だけを差し替える(地・枠を持たない)",
        lgBlock !== null && decl(lgBlock, "border-radius") === "var(--r-lg)" &&
        declList(lgBlock).every((d) => d.name === "border-radius"),
        declList(lgBlock ?? "").map((d) => d.name).join(" "));
      const idx = (sel) => cssRules.findIndex((r) => r.sels.includes(sel));
      check(".ctl-lg は .ctl-plain より後に書かれている(角丸の後勝ちが成立する)",
        idx(".ctl-lg") > idx(".ctl-plain"), `plain=${idx(".ctl-plain")} lg=${idx(".ctl-lg")}`);
      check("index.css の .ctl-lg は1回しか書かれていない", rulesFor(".ctl-lg").length === 1,
        `${rulesFor(".ctl-lg").length}回`);
    }

    // --- 17.12 子タブの溝はトークンの色 -------------------------------------
    // リード/データの子タブの溝が #EDEFF3 の直書きだった(--c-sunken #EEF1F4 と
    // 最大成分差 2 のトークン外の色。F-30 の残り)。**綴りを禁止するのではなく**
    // 「溝が var(--c-sunken) であること」と「トークン外の近似色が居ないこと」の両方を見る。
    {
      const code = codeOf(src);
      const grooves = (code.match(/display: "flex", gap: 6, background: "var\(--c-sunken\)", borderRadius: 11, padding: 4/g) || []).length;
      check("子タブの溝2箇所(リード/データ)の地は var(--c-sunken)", grooves === 2, `${grooves}箇所`);
      check("トークン外の近似色 #EDEFF3 が App.jsx に残っていない", !/#EDEFF3/i.test(code));
    }

    // --- 17.13 危険色の塗り(.ctl-danger) ------------------------------------
    // 塗りは体系の中で既に「主要動作の合図」(--c-accent 塗り + --c-on-accent 文字)
    // として使っている語彙。**押せば実際に消える一手にだけ**危険色の塗りを許す。
    // ここで縛るのは3つ:
    //   (a) 塗りであって枠ではない(枠を持つと芯1・芯2 の話に戻る)
    //   (b) 文字が読める(AA 4.5:1)。**トークン名ではなく値で**見る
    //   (c) 付けられるのは「本当に消える一手」だけ。削除モードに入る入口には付かない
    {
      const dgBlock = cssBlock(".ctl-danger");
      const dgOn = cssBlock('.ctl-danger[data-armed="true"]');
      check(".ctl-danger の規則が index.css にある", dgBlock !== null && dgOn !== null);
      check("index.css の .ctl-danger は1回しか書かれていない",
        rulesFor(".ctl-danger").length === 1, `${rulesFor(".ctl-danger").length}回`);
      {
        const idx = (sel) => cssRules.findIndex((r) => r.sels.includes(sel));
        check(".ctl-danger は .ctl-plain より後に書かれている",
          idx(".ctl-danger") > idx(".ctl-plain"), `plain=${idx(".ctl-plain")} danger=${idx(".ctl-danger")}`);
      }
      // (a) 塗りであって枠ではない。border だけでなく影・輪郭も塞ぐ
      //     (`box-shadow: inset 0 0 0 1px …` は border を書かずに全周の枠を描ける)。
      for (const [label, block] of [[".ctl-danger", dgBlock], ['.ctl-danger[data-armed="true"]', dgOn]]) {
        const boxy = declList(block).map((d) => d.name)
          .filter((n) => /^(border|box-shadow|outline|filter|backdrop-filter)/.test(n));
        check(`${label} は枠・影・輪郭を持たない(塗りだけで危険を返す)`, boxy.length === 0, boxy.join(" "));
      }
      check(".ctl-danger は押せないとき地を持たず、文字だけ弱める(--c-ink-3)",
        declList(dgBlock).length === 1 && decl(dgBlock, "color") === "var(--c-ink-3)",
        declList(dgBlock ?? "").map((d) => `${d.name}:${d.value}`).join(" "));
      check('.ctl-danger[data-armed="true"] は 地=--c-danger / 文字=--c-on-accent だけを持つ',
        declList(dgOn).length === 2 && decl(dgOn, "background") === "var(--c-danger)" &&
        decl(dgOn, "color") === "var(--c-on-accent)",
        declList(dgOn ?? "").map((d) => `${d.name}:${d.value}`).join(" "));
      // (b) 値で読む。--c-danger を明るい色に、--c-on-accent を薄い色に変えれば落ちる。
      const dangerRatio = ratio(cssVar("--c-on-accent"), cssVar("--c-danger"));
      check(`危険色の塗りの上の文字は WCAG AA(4.5:1)を満たす`, dangerRatio >= 4.5,
        `${cssVar("--c-on-accent")} on ${cssVar("--c-danger")} = ${dangerRatio.toFixed(4)}:1`);
      console.log(`  危険色の塗りのコントラスト: ${cssVar("--c-on-accent")} on ${cssVar("--c-danger")} = ${dangerRatio.toFixed(4)}:1`);
      // (c) 付いているのは「実際に消える一手」だけ。data-armed は
      //     「1件以上選択済み = 押せば本当に消える」に結び付いていなければならない。
      const dgTags = tagsWithClass("ctl-danger");
      check(".ctl-danger が付くのは実際に削除が実行される3箇所だけ(箱 / 個体 / セッション)",
        dgTags.length === 3, `${dgTags.length}箇所`);
      const armed = dgTags.filter((t) => /data-armed=\{[A-Za-z]*[Ff]orDelete\.size > 0\}/.test(t));
      check(".ctl-danger はすべて data-armed={選択数 > 0} を持つ(常時塗る印にしていない)",
        armed.length === dgTags.length, `${armed.length}/${dgTags.length}箇所`);
      // 地・文字色をインラインで書くとクラスより強くなり、この型が丸ごと効かなくなる。
      check(".ctl-danger を持つタグに background* / color のインライン宣言が無い",
        withPrefix(dgTags, ["background", "color"]).length === 0,
        (withPrefix(dgTags, ["background", "color"])[0] ?? "").slice(0, 120));
      // 「削除モードに入る入口」は破壊がまだ起きないので中立のまま(危険色を持たない)。
      for (const entry of ["startBoxSelectionMode", "startMemberSelect", "setSelectionMode(true)"]) {
        const i = Math.max(src.indexOf(`onClick={() => ${entry}`), src.indexOf(`onClick={${entry}}`));
        const open = i === -1 ? -1 : src.lastIndexOf("<button", i);
        const close = i === -1 ? -1 : src.indexOf("</button>", i);
        const block = open === -1 || close === -1 ? null : src.slice(open, close + "</button>".length);
        check(`削除モードに入る入口(${entry})は危険色を持たない(破壊はまだ起きない)`,
          block !== null && !/\bctl-danger\b/.test(block),
          block === null ? "入口が見つからない" : block.replace(/\s+/g, " ").slice(0, 140));
      }
    }

    // --- 17.14 芯1 を index.css の全規則にも当てる --------------------------
    // 17.10 は JSX の**インライン style** を見る。だから「新しいクラスを1つ作って
    // そこに枠と地を書き、操作に付ける」だけですり抜ける(自作の変異試験で SURVIVE を確認。
    // `.fake-chip { border: 1px solid var(--c-line-strong); background: var(--c-sunken) }`)。
    // 17.5 は .ctl-* を名指しした規則しか見ないので、別名のクラスには効かない。
    // ここは**綴りを列挙せず**、index.css の全規則に芯1(枠 ∧ 違う地)をそのまま当てる。
    // 白い地(--c-bg と同色)+枠 は「違う地」ではないので通る(.surf-sunk .tile がこれ)。
    {
      const bad = cssRules.filter((r) => borderVisible(r.body) && groundDistinct(r.body));
      check("index.css のどの規則も「見える全周の枠線」と「違う地」を同時に持たない(芯1)",
        bad.length === 0, bad.map((r) => r.sels.join(",")).join(" | "));
    }

    // --- 17.15 F-49 長押しでテキスト選択させない(.no-select) -----------------
    // 本人指示: 「メトロノームのプラスマイナスとボタンが長押しでテキスト選択の判定になる」
    //           「テンポタップ時も同様」「登録済みリードを並び替えで長押しすると選択になる」
    // 対象が9箇所以上あるのでインラインでは必ず漏れる。クラス1つに寄せた。
    // ここで縛るのは3つ: (a) 規則の中身 (b) 面の作法・操作の型に触れないこと
    //                    (c) 実際に必要な要素に付いていて、入力欄には付いていないこと
    {
      const nsBlock = cssBlock(".no-select");
      check(".no-select の規則が index.css にある", nsBlock !== null);
      check("index.css の .no-select は1回しか書かれていない(後勝ちで無効化されない)",
        rulesFor(".no-select").length === 1, `${rulesFor(".no-select").length}回`);
      for (const prop of ["user-select", "-webkit-user-select", "-webkit-touch-callout"]) {
        check(`.no-select は ${prop}: none を持つ`, decl(nsBlock, prop) === "none", String(decl(nsBlock, prop)));
      }
      // 新しいクラスに地・枠・角丸・余白を混ぜると、付けた要素だけ作法(§6.6)/型(§6.7)が割れる。
      check(".no-select は選択の抑制だけを持つ(地・枠・角丸・余白を持ち込まない)",
        declList(nsBlock).every((d) => /user-select$/.test(d.name) || d.name === "-webkit-touch-callout"),
        declList(nsBlock ?? "").map((d) => d.name).join(" "));

      const nsTags = tagsWithClass("no-select");
      // 本人が名指しした操作 + 同じ長押しを持つ並び替えの行。**綴りで1つずつ確かめる**
      // (数だけ見ると、別の要素に付け替えても通ってしまう)。
      const nsHas = (needle) => nsTags.some((t) => t.includes(needle));
      for (const [label, needle] of [
        ["テンポを下げる(−)", 'aria-label="テンポを下げる"'],
        ["テンポを上げる(＋)", 'aria-label="テンポを上げる"'],
        ["テンポの数値(タップで直接入力)", "onClick={() => setTempoEditing(true)}"],
        ["START/STOP", "aria-pressed={metronomeOn}"],
        ["拍子パネルを開くボタン", 'aria-label="拍子"'],
        ["1拍の分割パネルを開くボタン", 'aria-label="1拍の分割"'],
        ["拍子の選択(METRO_SIGS)", "aria-pressed={metroSig === sig}"],
        ["分割の選択", "aria-pressed={selected}"],
        ["アクセントのラベル", 'className="sans no-select"'],
        ["登録済みリードの並び替えの行", "onPointerDown={handlePointerDown(r.id, idx)}"],
      ]) {
        check(`.no-select が付いている: ${label}`, nsHas(needle), needle);
      }
      check(".no-select は12箇所以上で使われている(対象を減らして緑にしていない)",
        nsTags.length >= 12, `${nsTags.length}箇所`);
      // 入力欄に効かせると値を選択・コピーできなくなる。**絶対に付けない**。
      const nsInputs = nsTags.filter((t) => /^<(input|select|textarea)[\s/>]/.test(t));
      check(".no-select は入力欄(input/select/textarea)に付いていない(値を選択・コピーできなくしない)",
        nsInputs.length === 0, nsInputs.map((t) => t.slice(0, 80)).join(" | "));
      // 祖先に付けても子の入力欄まで効く。並び替えの行の中に入力欄が無いことを確かめる。
      {
        const i = src.indexOf("<ReorderableReedRows");
        const j = i === -1 ? -1 : src.indexOf("/>", src.indexOf("renderRow=", i));
        const rowBlock = i === -1 || j === -1 ? "" : src.slice(i, j);
        check("並び替えの行(no-select の祖先)の中に入力欄が無い", rowBlock !== "" &&
          !/<(input|textarea|select)[\s/>]/.test(rowBlock), rowBlock.slice(0, 80));
      }
    }

    // --- 17.16 F-50 録音ボタンは影を持たない --------------------------------
    // 本人指示「録音するボタンの周辺に影がついてるので削除」。
    // box-shadow はレイアウトに影響しないので、外形寸法(§6.1.5)は変わらない。
    {
      const i = src.indexOf("{isRecording ? \"停止\" : \"録音する\"}");
      const tag = i === -1 ? "" : tagAt(src.lastIndexOf("<button", i) + 1);
      check("録音ボタンのタグを走査できている", /onClick=\{toggleRecording\}/.test(tag), tag.slice(0, 120));
      check("録音ボタンは影(boxShadow)を持たない",
        !withPrefix([tag], ["boxshadow"]).length, tag.replace(/\s+/g, " ").slice(0, 200));
      check("録音ボタンの外形(角丸16 / padding 16px 0)は変わっていない",
        /borderRadius: 16/.test(tag) && /padding: "16px 0"/.test(tag), tag.replace(/\s+/g, " ").slice(0, 200));
    }

    // --- 17.17 F-48 録音中バッジはメトロノームアイコンと重ならない ------------
    // 本人指示「録音中のポップアップがメトロノームアイコンと被るので修正。
    //           画面上部であれば右でも左でもよい」。
    // 上部バーの左端はメトロノームアイコン(34×34)なので、左寄せだと必ず重なる。
    // 【縛り方】綴りだけでなく**幾何**でも見る: 告知はページ左右余白と同じ式で全幅に敷かれ、
    // 中の要素は alignSelf で寄る。左端どうしが同じ x なので flex-start は重なる。
    {
      const i = src.indexOf('<span className="ficus-pulse"');
      const tag = i === -1 ? "" : tagAt(src.lastIndexOf('<div className="sans"', i) + 1);
      check("録音中バッジのタグを走査できている",
        i !== -1 && /pointerEvents: "auto"/.test(tag) && /var\(--c-danger\)/.test(src.slice(i, i + 300)),
        tag.replace(/\s+/g, " ").slice(0, 120));
      check("録音中バッジは右寄せ(alignSelf: flex-end)。左端のメトロノームアイコンと重ならない",
        /alignSelf: "flex-end"/.test(tag), (tag.match(/alignSelf: "[^"]*"/) || ["alignSelf 無し"])[0]);
      // メトロノームアイコンは上部バーの**左端**にあり、告知の左端と同じ x から始まる。
      const mi = src.indexOf('aria-label="メトロノーム"');
      const mtag = mi === -1 ? "" : tagAt(mi);
      check("メトロノームアイコンは 34×34 のまま(F-48 で上部バーは動かしていない)",
        /width: 34, height: 34/.test(mtag), mtag.replace(/\s+/g, " ").slice(0, 160));
      // 告知の容器は position:fixed のまま = レイアウトの流れの外(§6.1.5 / F-8)。
      const ci = src.indexOf("{(isRecording || isAnalyzingUpload || lastUploadedSession) && (");
      const cblock = ci === -1 ? "" : src.slice(ci, ci + 700);
      check("録音中バッジの容器は position:fixed のまま(流れの外。出ても環は動かない)",
        /position: "fixed"/.test(cblock) && /pointerEvents: "none"/.test(cblock), cblock.slice(0, 120));
    }
  }
}

// REED_FORM_CONTROL_STYLE の中身(17.9 から使う)
function rfBodyFor(src) {
  const m = /const REED_FORM_CONTROL_STYLE = \{([\s\S]*?)\};/.exec(src);
  return m ? m[1] : "";
}

// ============================================================
// 検証18: F-44 ピッチ集計のノイズ除外(集計側ゲート + 頑健統計 + 透明性)
// 合成フレーム列で数値を独立に検算する(綴りの有無だけの検査にしない)。
// 期待値はすべてテスト側で手計算した値(定数の定義の言い換えではなく、
// 「25msホップでどのtのフレームが残るか」を独立に導出して突き合わせる)。
// ============================================================
console.log("=== 検証18: F-44 ピッチ集計のノイズ除外 ===");
{
  // 専用サンドボックス。overridesで定数を、edits([from,to]の配列)でコード本文を
  // 書き換えた変異体を作れる(変異はこの複製文字列上でだけ起き、実ソースには触れない)。
  // 置換が空振りしたら例外(効かない変異試験を防ぐ)。
  const buildPitchGateApi = (overrides = {}, edits = []) => {
    let pieces = [
      extractFunction("mean"),
      extractFunction("median"),
      extractFunction("stddev"),
      extractFunction("frameWeight"),
      extractFunction("timbreSustained"),
      extractFunction("weightedMean"),
      extractConst("TIMBRE_SUSTAIN_MS"),
      extractConst("PITCH_EDGE_TRIM_MS"),
      extractConst("PITCH_RUN_GAP_MS"),
      extractConst("PITCH_FLIP_MAX_MS"),
      extractConst("PITCH_FLIP_NEIGHBOR_AGREE_CENTS"),
      extractConst("PITCH_FLIP_INTERVALS_CENTS"),
      extractConst("PITCH_FLIP_TOLERANCE_CENTS"),
      extractFunction("selectPitchAggregationFrames"),
      extractFunction("computeFrameMetrics"),
      extractFunction("groupFramesByNote"),
    ].join("\n\n");
    for (const [name, val] of Object.entries(overrides)) {
      const before = pieces;
      pieces = pieces.replace(new RegExp(`const ${name} = [^;]+;`), `const ${name} = ${val};`);
      if (pieces === before) throw new Error(`mutation failed: const ${name} not replaced`);
    }
    for (const [from, to] of edits) {
      const before = pieces;
      pieces = pieces.replace(from, to);
      if (pieces === before) throw new Error(`mutation failed: "${from}" not found`);
    }
    return new Function(`${pieces}
      return { selectPitchAggregationFrames, computeFrameMetrics, groupFramesByNote,
               PITCH_EDGE_TRIM_MS, PITCH_RUN_GAP_MS, PITCH_FLIP_MAX_MS };`)();
  };
  const gate = buildPitchGateApi();

  // 合成フレーム: 25msホップ。si=半音インデックス(nullなら運指範囲外)、dev=最寄り半音との
  // 差(¢)。pitchHzはそのsiの音の周波数×2^(dev/1200)なので、絶対セントにはsi間の音程差が
  // そのまま現れる(si+12の区間はちょうど+1200¢上に居る)。
  const HOP = 0.025;
  const hzOf = (si) => 440 * Math.pow(2, (si - 9) / 12);
  const pf = (t, si, dev) => ({
    t,
    semitoneIndex: si,
    pitchHz: (si === null ? hzOf(30) : hzOf(si)) * Math.pow(2, dev / 1200),
    pitchCents: dev,
    clarity: 1, volumeDb: -20, noteAgeMs: 1000, hnrDb: 20, spectralCentroidHz: 1000, harmonics: [],
  });
  // devFn(t)でdevを変えながら等間隔フレーム列を作る
  const noteFrames = (t0, count, si, devFn) =>
    Array.from({ length: count }, (_, k) => pf(t0 + k * HOP, si, devFn(t0 + k * HOP, k)));
  const near = (a, b, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) <= eps;

  // --- 18.1 アタックのしゃくり: 冒頭120msのランプが集計に混入しない --------------
  // 1000ms(41フレーム)の+2¢安定音。冒頭のt<0.12(5フレーム)は-40→-10¢のランプ。
  // 手計算: dur=1.000, e=min(0.12, dur/3)=0.12 → 採用は t∈[0.12,0.88] の31フレーム(全部+2)。
  // 除外は 冒頭5(ランプ) + 末尾5(t=0.90〜1.00) = 10。
  // 【F-46】代表値はゲート通過フレームのclarity加重平均(中央値は本人指示で廃止)。
  {
    const frames = noteFrames(0, 41, 10, (t) => (t < 0.12 ? -40 + (t / 0.12) * 30 : 2));
    const m = gate.computeFrameMetrics(frames);
    check("18.1 ピッチ誤差は安定区間の加重平均+2.0¢(しゃくりが混入しない)", near(m.pitchCentsSigned, 2));
    check("18.1 絶対値版(旧pitchCents)は廃止されている(F-46)", m.pitchCents === undefined);
    check("18.1 採用フレームは全て+2¢なのでブレ(stddev)は0", near(m.pitchStabilityCents, 0));
    check("18.1 除外数は手計算どおり(冒頭5+末尾5=10 / total 41)",
      m.pitchFrameTotal === 41 && m.pitchFrameUsed === 31 && m.pitchFrameExcluded === 10,
      `total=${m.pitchFrameTotal} used=${m.pitchFrameUsed} excluded=${m.pitchFrameExcluded}`);
    // ゲート無しの全フレーム平均(clarity1なら算術平均)を独立に計算し、汚染値と異なることを確認
    const contaminated = frames.reduce((s, f) => s + f.pitchCents, 0) / frames.length;
    check("18.1 ゲート無しの全フレーム平均は汚染されている(ゲート後の平均と異なる)",
      Math.abs(contaminated - 2) > 0.5 && Math.abs(m.pitchCentsSigned - contaminated) > 0.5,
      `汚染平均=${contaminated.toFixed(2)}¢ ゲート後=${m.pitchCentsSigned}¢`);
  }

  // --- 18.2 スラー過渡: 音替わり境界±60msのランプが両音の平均に混入しない ---------
  // A(+2¢, si=10, t=0〜0.475)の末尾3フレームは+10/+20/+30、
  // B(-3¢, si=12, t=0.5〜0.975)の先頭3フレームは-45/-25/-10(noteAgeMsはスラーでは
  // リセットされない想定なので全フレーム1000のまま=音量ベースの除外は効かない状況)。
  {
    const rampA = [10, 20, 30];  // Aの末尾3フレーム(t=0.425〜0.475)
    const rampB = [-45, -25, -10]; // Bの先頭3フレーム(t=0.5〜0.55)
    const frames = [
      ...noteFrames(0, 20, 10, (t, k) => (k >= 17 ? rampA[k - 17] : 2)),
      ...noteFrames(0.5, 20, 12, (t, k) => (k <= 2 ? rampB[k] : -3)),
    ];
    const groups = gate.groupFramesByNote(frames);
    const gA = groups.find((g) => g.semitoneIndex === 10);
    const gB = groups.find((g) => g.semitoneIndex === 12);
    check("18.2 音Aの平均は+2.0¢(スラーの過渡が混入しない)", near(gA?.pitchCentsSigned, 2));
    check("18.2 音Bの平均は-3.0¢(スラーの過渡が混入しない)", near(gB?.pitchCentsSigned, -3));
    check("18.2 両音とも除外(excluded)がある",
      gA?.pitchFrameExcluded > 0 && gB?.pitchFrameExcluded > 0,
      `A=${gA?.pitchFrameExcluded} B=${gB?.pitchFrameExcluded}`);
  }

  // --- 18.3 短い音を全滅させない ------------------------------------------------
  {
    // (a) 90msの音(dur=0.09): e=min(0.12, 0.03)=0.03 → 中央1/3のt∈[0.03,0.06]だけが残る。
    //     ライブ計測はrAF(≒16ms)で等間隔とは限らないため、tは明示指定
    //     (帯の境界ちょうどにフレームを置かない。浮動小数の丸めに依存する検査にしない)。
    const times = [0, 0.02, 0.04, 0.05, 0.07, 0.09];
    const devs6 = [-30, -10, 5, 5, 15, 25];
    const short6 = times.map((t, k) => pf(t, 10, devs6[k]));
    const m4 = gate.computeFrameMetrics(short6);
    check("18.3a 90msの音は中央1/3(2フレーム,+5¢)が残る(全滅しない)",
      m4.pitchFrameUsed === 2 && near(m4.pitchCentsSigned, 5),
      `used=${m4.pitchFrameUsed} val=${m4.pitchCentsSigned}`);
    // (b) 2フレーム(dur=0.025): e=dur/3≈0.0083の帯t∈[0.0083,0.0167]にフレームが無い
    //     → インデックス中央(2>>1=1番目=+9¢)の1フレームだけ採用される。
    const devs2 = [7, 9];
    const short2 = noteFrames(0, 2, 10, (t, k) => devs2[k]);
    const m2 = gate.computeFrameMetrics(short2);
    check("18.3b 離散化で帯が空になる音は中央の1フレームが残る(全滅しない)",
      m2.pitchFrameUsed === 1 && near(m2.pitchCentsSigned, 9),
      `used=${m2.pitchFrameUsed} val=${m2.pitchCentsSigned}`);
  }

  // --- 18.4 持続オクターブ誤検出ラン(75ms)は丸ごと除外される ---------------------
  // 安定音P(si=10, 0¢, t=0〜0.375) → R(si=22=+1200¢, 3フレーム=dur0.05) →
  // 安定音N(si=10, 0¢, t=0.475〜0.975)。sanitizePitchOutliers(単発用)が素通しする形。
  {
    const frames = [
      ...noteFrames(0, 16, 10, () => 0),
      ...noteFrames(0.4, 3, 22, () => 0),
      ...noteFrames(0.475, 21, 10, () => 0),
      pf(1.4, null, 10), // 運指範囲外(アルティッシモ等): 区間に入らず自然に除外される
    ];
    const groups = gate.groupFramesByNote(frames);
    const gFlip = groups.find((g) => g.semitoneIndex === 22);
    const gMain = groups.find((g) => g.semitoneIndex === 10);
    check("18.4 +12側のグループのピッチ系はnull(ランごと除外)",
      gFlip && gFlip.pitchCentsSigned === null &&
      gFlip.pitchHz === null && gFlip.pitchFrameUsed === 0 && gFlip.pitchFrameExcluded === 3,
      gFlip ? `used=${gFlip.pitchFrameUsed} val=${gFlip.pitchCentsSigned}` : "groupなし");
    check("18.4 実音側の平均は0¢のまま", near(gMain?.pitchCentsSigned, 0));
    // 全体の内訳を手計算と突き合わせる: total=16+3+21+1=41。
    // P: dur=0.375, e=0.12 → t∈[0.12,0.255]の6フレーム。N: dur=0.5, e=0.12 →
    // t∈[0.595,0.855]の11フレーム。used=17, excluded=24(フリップ3+si=null 1を含む)。
    const sel = gate.selectPitchAggregationFrames(frames);
    check("18.4 全体の内訳(total/used/excluded)が手計算と一致",
      sel.total === 41 && sel.used === 17 && sel.excluded === 24,
      `total=${sel.total} used=${sel.used} excluded=${sel.excluded}`);
  }

  // --- 18.5 実奏のオクターブ跳躍(300ms)は除外されない(誤爆防止。最重要) ----------
  // P(si=10, 0¢, 375ms) → R(si=22, +4¢, t=0.4〜0.675=dur0.275 > PITCH_FLIP_MAX_MS)
  // → N(si=10, 0¢, 475ms)。Rは疑い対象にならず、両端トリムだけ受けて生き残る。
  // 手計算: Rのdur=0.275, e=min(0.12, 0.0917)=0.0917 → t∈[0.4917,0.5833]の4フレーム。
  {
    const frames = [
      ...noteFrames(0, 16, 10, () => 0),
      ...noteFrames(0.4, 12, 22, () => 4),
      ...noteFrames(0.7, 20, 10, () => 0),
    ];
    const groups = gate.groupFramesByNote(frames);
    const gJump = groups.find((g) => g.semitoneIndex === 22);
    check("18.5 実奏のオクターブ跳躍は除外されない(ピッチ+4.0¢が残る)",
      near(gJump?.pitchCentsSigned, 4) && gJump?.pitchFrameUsed === 4,
      `used=${gJump?.pitchFrameUsed} val=${gJump?.pitchCentsSigned}`);
    check("18.5 跳躍先のpitchHzも非null(採用フレームの加重平均)", gJump?.pitchHz > 0, String(gJump?.pitchHz));
  }

  // --- 18.6 セッション連結境界(tの逆行)で区間が跨がらない ------------------------
  // s1: 安定音(si=10,+2¢) → 末尾に短いsi=22ラン(75ms)。s2: 安定音(si=10,+2¢)。
  // 連結するとsi=22ランの直後でtが逆行する。境界を跨いでs2を「後続の安定区間」として
  // 使うとランが誤検出扱いで消えるが、正しくは隣接扱いしない→トリムだけ受けて残る。
  {
    const s1 = [
      ...noteFrames(0, 20, 10, () => 2),
      ...noteFrames(0.5, 3, 22, () => 0),
    ];
    const s2 = noteFrames(0, 16, 10, () => 2); // tが0に戻る=連結境界
    const frames = [...s1, ...s2];
    const groups = gate.groupFramesByNote(frames);
    const gEnd = groups.find((g) => g.semitoneIndex === 22);
    check("18.6 境界を跨いで前後の安定区間として扱わない(末尾ランは誤検出扱いされない)",
      gEnd?.pitchFrameUsed === 1 && near(gEnd?.pitchCentsSigned, 0),
      `used=${gEnd?.pitchFrameUsed} val=${gEnd?.pitchCentsSigned}`);
    // si=10は2つの区間に割れ、それぞれ独立にトリムされる。
    // run1: dur=0.475, e=0.12 → t∈[0.12,0.355]の10フレーム。
    // run2: dur=0.375, e=0.12 → t∈[0.12,0.255]の6フレーム。計16。
    const gMain = groups.find((g) => g.semitoneIndex === 10);
    check("18.6 逆行の前後が別区間として独立にトリムされる(採用16フレーム,+2¢)",
      gMain?.pitchFrameUsed === 16 && near(gMain?.pitchCentsSigned, 2),
      `used=${gMain?.pitchFrameUsed} val=${gMain?.pitchCentsSigned}`);
  }

  // --- 18.7 変異試験(検査自体に組み込む。変異は複製したコード文字列にだけ当てる) ---
  {
    // (a) PITCH_EDGE_TRIM_MS=0 にすると 18.1 の主張が成立しなくなる
    //     (除外0になり、ランプ混入でstddevが立つ)=18.1はトリムを本当に検査している。
    const mutTrim = buildPitchGateApi({ PITCH_EDGE_TRIM_MS: 0 });
    const framesA = noteFrames(0, 41, 10, (t) => (t < 0.12 ? -40 + (t / 0.12) * 30 : 2));
    const mA = mutTrim.computeFrameMetrics(framesA);
    check("18.7a 変異(トリム0)では18.1が落ちる(excluded=0・stddev>0になる)",
      mA.pitchFrameExcluded === 0 && mA.pitchStabilityCents > 1,
      `excluded=${mA.pitchFrameExcluded} stddev=${mA.pitchStabilityCents}`);
    // (b) PITCH_FLIP_MAX_MS=300 にすると 18.5 の実奏跳躍(275ms)が誤爆で消える
    //     =18.5は誤爆防止の上限を本当に検査している。
    const mutFlip = buildPitchGateApi({ PITCH_FLIP_MAX_MS: 300 });
    const framesB = [
      ...noteFrames(0, 16, 10, () => 0),
      ...noteFrames(0.4, 12, 22, () => 4),
      ...noteFrames(0.7, 20, 10, () => 0),
    ];
    const gJumpMut = mutFlip.groupFramesByNote(framesB).find((g) => g.semitoneIndex === 22);
    check("18.7b 変異(疑い上限300ms)では18.5が落ちる(実奏跳躍が除外されnullになる)",
      gJumpMut && gJumpMut.pitchCentsSigned === null && gJumpMut.pitchFrameUsed === 0,
      `used=${gJumpMut?.pitchFrameUsed} val=${gJumpMut?.pitchCentsSigned}`);
  }

  // --- 18.8 音量・音色はゲートを通らない(従来のまま) -----------------------------
  // ピッチ系だけの変更であることを数値で固定する: 全フレームがvolumeDb=-20なら従来どおり
  // -20。過渡フレームのvolumeDbだけ変えた列で、加重平均が過渡を含む値になる(除外されない)。
  {
    const frames = noteFrames(0, 41, 10, (t) => (t < 0.12 ? -40 : 2));
    frames.forEach((f, i) => { f.volumeDb = i < 5 ? -60 : -20; });
    const m = gate.computeFrameMetrics(frames);
    const expectVol = (5 * -60 + 36 * -20) / 41; // clarity=1なので算術平均
    check("18.8 volumeDbは全フレームの加重平均のまま(ピッチのゲートが効いていない)",
      near(m.volumeDb, expectVol, 1e-6), `vol=${m.volumeDb} expect=${expectVol}`);
  }

  // --- 18.9 透明性の1行(SessionDetailView)。JSXはハーネスの外なので綴りの存在確認のみ ---
  // (描画の実測はBrowser paneで行う。この検査はリグレッションの早期検知用の補助)
  {
    const sdvStart = src.indexOf("function SessionDetailView(");
    const sdv = sdvStart === -1 ? "" : src.slice(sdvStart, sdvStart + 20000);
    check("18.9 音階ごとの平均の直下に除外率の1行がある",
      /ピッチは各音の安定区間の平均（立ち上がり・切り替わりの過渡 \{pct\}% を除外）/.test(sdv));
    check("18.9 除外率は全グループ合計から計算し、合計0なら行ごと出さない",
      /if \(used \+ excluded === 0\) return null;/.test(sdv) &&
      /Math\.round\(\(excluded \/ \(used \+ excluded\)\) \* 100\)/.test(sdv));
  }
  // --- 18.10 代表値は「採用フレームのclarity加重平均」であること(F-46 本人指示) ----
  // F-44では中央値を固定していたが、F-46で本人が「平均値に統一」と指示し反転した。
  // 18.1〜18.6は採用フレームの値が一様(中央値=平均)なので、ここだけ非対称な列
  // (+2が30個 / +30が1個、外れ値だけclarity 0.8)を使い、
  //   加重平均 = (30*1*2 + 0.8*30) / (30*1 + 0.8) = 84/30.8 ≈ +2.727¢
  // をテスト側で独立に手計算して固定する。中央値(+2.0)とも算術平均(90/31≈+2.903)とも
  // 異なる値になるため、中央値に戻す変異・clarity重みを落とす変異の両方が落ちる。
  {
    // 41フレーム(t=0〜1.0)。採用帯はt∈[0.12,0.88]の31フレーム(18.1と同じ)。
    // その内側のt=0.5(k=20)だけ+30¢・clarity0.8(±700¢未満なのでsanitizeでも消えない)。
    const frames = noteFrames(0, 41, 10, () => 2);
    frames[20] = { ...frames[20], pitchCents: 30, clarity: 0.8 };
    const m = gate.computeFrameMetrics(frames);
    const expectedWeighted = (30 * 1 * 2 + 0.8 * 30) / (30 * 1 + 0.8); // ≈2.727
    const adoptedMedian = 2;             // 31個中16番目
    const arithmeticMean = (30 * 2 + 30) / 31; // ≈2.903(clarity無視の平均)
    check("18.10 代表値は採用フレームのclarity加重平均(手計算+2.727¢と一致)",
      near(m.pitchCentsSigned, expectedWeighted, 1e-9), `signed=${m.pitchCentsSigned}`);
    check("18.10 中央値(+2.0)とは異なる=代表値は中央値ではない(F-46)",
      Math.abs(m.pitchCentsSigned - adoptedMedian) > 0.5);
    check("18.10 clarity無視の算術平均(+2.903)とも異なる=重み付けが効いている",
      Math.abs(m.pitchCentsSigned - arithmeticMean) > 0.1);
    // 変異: 加重平均→中央値(F-44仕様)に戻すと+2.0になり、上の検査が落ちる
    const mutMedian = buildPitchGateApi({}, [
      ["pitchCentsSigned: weightedMean(pitchFrames, (f) => f.pitchCents),", "pitchCentsSigned: median(signed),"],
    ]);
    const mm = mutMedian.computeFrameMetrics(frames);
    check("18.10x 変異(加重平均→中央値)では+2.0になり18.10が落ちる",
      near(mm.pitchCentsSigned, adoptedMedian, 1e-9) && !near(mm.pitchCentsSigned, expectedWeighted, 0.5),
      `mutant=${mm.pitchCentsSigned}`);
  }

  // --- 18.11 前後安定条件: 速いパッセージ(短いランの連続)は1音も除外されない -------
  // 審査役の変異試験で「durOf(p)/durOf(n) > flipMaxSec の条件を削除しても通過」が発覚。
  // 実奏のオクターブ交互(全ランが100ms=疑い対象の長さ、前後の音程は1200¢ちょうど)を
  // 合成し、「隣が安定区間でなければフリップ判定は発動しない」という核心を固定する。
  {
    // 5つの短いラン(各5フレーム=dur0.1≤PITCH_FLIP_MAX_MS)を25ms間隔で連続させる:
    // si10 → si22 → si10 → si22 → si10(+3¢)。中3ランは前後の音程一致も1200¢一致も
    // 満たすため、安定条件が無ければ丸ごと除外されてしまう配置。
    const runStarts = [0, 0.125, 0.25, 0.375, 0.5];
    const frames = runStarts.flatMap((t0, r) => noteFrames(t0, 5, r % 2 === 0 ? 10 : 22, () => 3));
    const sel = gate.selectPitchAggregationFrames(frames);
    // 手計算: 各ラン dur=0.1, e=0.1/3≈0.033 → 帯[t0+0.033,t0+0.067]はt0+0.05の1フレーム
    // → 採用は5ランで5フレーム(除外はトリムの20のみ。ラン除外は0)。
    check("18.11 速いオクターブ交互は1音も除外されない(採用5=各ランの中央1フレーム)",
      sel.total === 25 && sel.used === 5 && sel.excluded === 20,
      `total=${sel.total} used=${sel.used} excluded=${sel.excluded}`);
    const groups = gate.groupFramesByNote(frames);
    const gLow = groups.find((g) => g.semitoneIndex === 10);
    const gHigh = groups.find((g) => g.semitoneIndex === 22);
    check("18.11 両方の音のピッチが残る(+3.0¢)",
      near(gLow?.pitchCentsSigned, 3) && gLow?.pitchFrameUsed === 3 &&
      near(gHigh?.pitchCentsSigned, 3) && gHigh?.pitchFrameUsed === 2,
      `low used=${gLow?.pitchFrameUsed} high used=${gHigh?.pitchFrameUsed}`);
    // 変異: 前後安定条件の行を削除すると中3ランが誤検出扱いで消え、上の検査が落ちる
    const mutStable = buildPitchGateApi({}, [
      ["if (!(durOf(p) > flipMaxSec && durOf(n) > flipMaxSec)) continue;", ""],
    ]);
    const selMut = mutStable.selectPitchAggregationFrames(frames);
    const gHighMut = mutStable.groupFramesByNote(frames).find((g) => g.semitoneIndex === 22);
    check("18.11x 変異(前後安定条件の削除)では交互練習が破壊され18.11が落ちる",
      selMut.used === 2 && gHighMut?.pitchFrameUsed === 0 && gHighMut?.pitchCentsSigned === null,
      `used=${selMut.used} high used=${gHighMut?.pitchFrameUsed}`);
  }

  // --- 18.12 前後一致条件: 前後が別の音(>200¢差)なら短いランを疑わない -------------
  // 審査役の変異試験で「|medAbs(P)-medAbs(N)| ≤ 200¢ の条件を削除しても通過」が発覚。
  // 安定音P(si10)→短い音R(si22=Pの+1200¢。音程だけならフリップ候補)→安定音N(si17=
  // Pの+700¢)。前後が一致しないので「同じ音の途中の誤検出」ではなく、Rは実音として残る。
  {
    const frames = [
      ...noteFrames(0, 16, 10, () => 0),      // P: 375ms 安定
      ...noteFrames(0.4, 3, 22, () => 5),     // R: 50ms(P比+1200¢+5¢)
      ...noteFrames(0.475, 16, 17, () => 0),  // N: 375ms 安定(P比+700¢ > 200¢)
    ];
    const gR = gate.groupFramesByNote(frames).find((g) => g.semitoneIndex === 22);
    // 手計算: R dur=0.05, e=0.05/3≈0.017 → 帯[0.417,0.433]にt=0.425の1フレームが残る
    check("18.12 前後が別の音なら短いランは除外されない(+5.0¢が残る)",
      near(gR?.pitchCentsSigned, 5) && gR?.pitchFrameUsed === 1,
      `used=${gR?.pitchFrameUsed} val=${gR?.pitchCentsSigned}`);
    // 変異: 前後一致条件の行を削除するとRがフリップ扱いで消え、上の検査が落ちる
    const mutAgree = buildPitchGateApi({}, [
      ["if (Math.abs(mp - mn) > PITCH_FLIP_NEIGHBOR_AGREE_CENTS) continue;", ""],
    ]);
    const gRMut = mutAgree.groupFramesByNote(frames).find((g) => g.semitoneIndex === 22);
    check("18.12x 変異(前後一致条件の削除)では実音Rが消え18.12が落ちる",
      gRMut?.pitchFrameUsed === 0 && gRMut?.pitchCentsSigned === null,
      `used=${gRMut?.pitchFrameUsed}`);
  }
  console.log("  -> done");
}

// ============================================================
// 検証19: F-45 PIVOTのピッチ集計にF-44/F-46のノイズゲートを適用
// 合成データで数値を独立に検算する(綴りの有無だけの検査にしない)。
// buildFramesWithContext(App.jsxのモジュールスコープ関数。AnalysisLabViewはこれを呼ぶだけ)・
// selectPitchAggregationFrames・buildPivot/PIVOT_MEASURES/PIVOT_DIMENSIONSは
// すべて実ソースからそのまま抽出して検証する(テスト側の再実装を持たない)。
// 【審査で発覚した罠】buildFramesWithContextを最初テスト側で手書き再実装していたところ、
// 実ソースのゲート注入(_pitchGateOk: sel.selected.has(i))を`true`固定に変異させても
// このテストは何も検知できなかった(再実装側は変異の影響を受けないため)。F-45で
// buildFramesWithContextをApp.jsxのモジュールスコープ関数に切り出し、ここもextractFunctionで
// 実体を取るように直した(19.5でこの変異が今度こそ落ちることを確認している)。
// ============================================================
console.log("=== 検証19: F-45 PIVOTのピッチ集計ゲート適用 ===");
{
  // 専用サンドボックス(18節のbuildPitchGateApiと同じ方式)。edits([from,to]の配列)で
  // 抽出済みコード本文を書き換えた変異体を作れる(変異はこの複製文字列上でだけ起き、
  // 実ソースには触れない)。置換が空振りしたら例外(効かない変異試験を防ぐ)。
  // PIVOT_DIMENSIONS/PIVOT_MEASURESの他次元・他指標のgetValueはこのテストでは一度も
  // 呼ばれない(row="note"・metric="pitchCents"/"volume"/"hnr"のみ使用)。それらのgetValueは
  // 呼ばれるまで評価されないアロー関数の中身なので、reedLabel/registerBand/usageDays等の
  // 未抽出の依存関数を参照していても問題は起きない(buildFramesWithContextが呼ぶ
  // reeds.find(...)もreedsを空配列で渡す限り同様に安全)。
  const buildPivotApi = (edits = []) => {
    let pieces = [
      extractFunction("mean"),
      extractFunction("median"),
      extractFunction("stddev"),
      extractFunction("frameWeight"),
      extractFunction("timbreSustained"),
      extractFunction("weightedMean"),
      extractConst("TIMBRE_SUSTAIN_MS"),
      extractConst("PITCH_EDGE_TRIM_MS"),
      extractConst("PITCH_RUN_GAP_MS"),
      extractConst("PITCH_FLIP_MAX_MS"),
      extractConst("PITCH_FLIP_NEIGHBOR_AGREE_CENTS"),
      extractConst("PITCH_FLIP_INTERVALS_CENTS"),
      extractConst("PITCH_FLIP_TOLERANCE_CENTS"),
      extractFunction("selectPitchAggregationFrames"),
      extractFunction("computeFrameMetrics"),
      extractFunction("groupFramesByNote"),
      extractFunction("buildFramesWithContext"),
      extractFunction("pitchCellColor"),
      extractConst("PIVOT_DIMENSIONS"),
      extractConst("PIVOT_MEASURES"),
      extractFunction("buildPivot"),
    ].join("\n\n");
    for (const [from, to] of edits) {
      const before = pieces;
      pieces = pieces.replace(from, to);
      if (pieces === before) throw new Error(`mutation failed: "${from}" not found`);
    }
    return new Function(`${pieces}
      return { selectPitchAggregationFrames, groupFramesByNote, buildFramesWithContext,
               buildPivot, PIVOT_MEASURES, PIVOT_DIMENSIONS };`)();
  };
  const api = buildPivotApi();

  const HOP = 0.025;
  const hzOf = (si) => 440 * Math.pow(2, (si - 9) / 12);
  const pf = (t, si, dev, note) => ({
    t, semitoneIndex: si,
    pitchHz: hzOf(si) * Math.pow(2, dev / 1200),
    pitchCents: dev,
    matchedWrittenNote: note,
    clarity: 1, volumeDb: -20, noteAgeMs: 1000, hnrDb: 20, spectralCentroidHz: 1000, harmonics: [],
  });
  const noteFrames = (t0, count, si, dev, note) =>
    Array.from({ length: count }, (_, k) => pf(t0 + k * HOP, si, dev, note));
  const near = (a, b, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) <= eps;

  // 合成セッション(検証18.4と同じトリム配置。devだけ非対称にする):
  // 安定音P(si=10,+2¢,"C4",16フレーム=375ms) → 短いオクターブ誤検出ランR
  // (si=22,+5¢,"C5",3フレーム=75ms≤120ms) → 安定音N(si=10,-6¢,"C4",21フレーム=500ms)。
  // P/Nのdevをあえて非対称(+2 / -6)にして、C4セルが「トリムで生き残ったフレーム数の
  // 重み付き」平均であることまで検算する(一様データでは代表値の検査が何も固定しない、
  // というF-44/F-46の教訓の再適用)。
  // 手計算: P dur=0.375,e=min(0.12,0.125)=0.12→採用6(t∈[0.12,0.255])。
  // N dur=0.5,e=0.12→採用11(t∈[0.595,0.855])。Rは前後(P,N)が安定区間・音程差8¢(≤200¢)で
  // 一致・ジャンプ|1305-102|=1203¢(オクターブ1200¢±150許容)を満たすため丸ごと除外される。
  const P = noteFrames(0, 16, 10, 2, "C4");
  const R = noteFrames(0.4, 3, 22, 5, "C5");
  const N = noteFrames(0.475, 21, 10, -6, "C4");
  const sessionFrames = [...P, ...R, ...N];
  // buildFramesWithContext(sessions, reeds) はセッション"オブジェクト"の配列を取る
  // (App.jsx AnalysisLabViewが渡す形と同じ。reedIdはnull=未紐付けでreeds探索を空振りさせる)。
  const sessionObj = {
    frames: sessionFrames, reedId: null, recordedAt: "2026-08-04T00:00:00.000Z",
    performer: "自分", saxType: "alto", source: "recording", memo: "",
  };
  const fwc = api.buildFramesWithContext([sessionObj], []);
  const ctx = { reeds: [] };

  // --- 19.1 ゲート適用の確認 -----------------------------------------------------
  {
    const pivot = api.buildPivot(fwc, ctx, "note", "none", "pitchCents", []);
    const expectedC4 = (6 * 2 + 11 * -6) / 17; // = -54/17 ≈ -3.176470588235294
    const cellC4 = pivot.cells["C4"]?.["全体"];
    check("19.1 C4セル(ラン除外後)は手計算の加重平均(-3.176…)と一致",
      !!cellC4 && near(cellC4.wsum / cellC4.wtotal, expectedC4, 1e-9),
      `value=${cellC4 ? cellC4.wsum / cellC4.wtotal : "なし"} expect=${expectedC4}`);
    check("19.1 短いオクターブ誤検出ラン(C5)はセルごと消える(groupFramesByNoteの「―」と同じ扱い)",
      pivot.rowKeys.includes("C5") === false, `rowKeys=${pivot.rowKeys.join(",")}`);
    // 「ランを含めた場合の値」を生データで独立に手計算(F-45以前の挙動相当)し、
    // ゲート後の結果(セルが存在しない)と異なることを確認する
    const rawC5Avg = R.reduce((s, f) => s + f.pitchCents, 0) / R.length; // = +5.0
    check("19.1 ランを含めた場合の値(+5.0¢)はゲート後の結果(セル無し)と異なる",
      near(rawC5Avg, 5, 1e-9) && !pivot.cells["C5"]);
  }

  // --- 19.2 整合性の確認: PIVOTと音階ごとの平均(groupFramesByNote)が同じ値を返す ----
  {
    const pivot = api.buildPivot(fwc, ctx, "note", "none", "pitchCents", []);
    const cellC4 = pivot.cells["C4"]["全体"];
    const pivotVal = cellC4.wsum / cellC4.wtotal;
    const groups = api.groupFramesByNote(sessionFrames);
    const g10 = groups.find((g) => g.semitoneIndex === 10);
    check("19.2 PIVOTのC4セルとgroupFramesByNote(si=10)のpitchCentsSignedが一致",
      near(pivotVal, g10?.pitchCentsSigned, 1e-9),
      `pivot=${pivotVal} group=${g10?.pitchCentsSigned}`);
    const g22 = groups.find((g) => g.semitoneIndex === 22);
    check("19.2 誤検出ラン側もgroupFramesByNoteと同じくnull(2つの経路が同じゲートを共有)",
      g22?.pitchCentsSigned === null, `group22=${g22?.pitchCentsSigned}`);
  }

  // --- 19.3 他measure(volume/hnr)は無変更(ゲートを通らず従来どおり全フレームで集計) ---
  {
    const pivotVol = api.buildPivot(fwc, ctx, "note", "none", "volume", []);
    const cellVolC5 = pivotVol.cells["C5"]?.["全体"];
    check("19.3 volume: 誤検出ラン(C5)もゲートされず3フレームとも残る",
      !!cellVolC5 && near(cellVolC5.wtotal, 3, 1e-9) && near(cellVolC5.wsum / cellVolC5.wtotal, -20, 1e-9),
      cellVolC5 ? `wtotal=${cellVolC5.wtotal}` : "セルなし");
    const cellVolC4 = pivotVol.cells["C4"]["全体"];
    check("19.3 volume: C4セルはP+N全37フレーム(ピッチのトリムを受けない)",
      near(cellVolC4.wtotal, 37, 1e-9), `wtotal=${cellVolC4.wtotal}`);

    const pivotHnr = api.buildPivot(fwc, ctx, "note", "none", "hnr", []);
    const cellHnrC5 = pivotHnr.cells["C5"]?.["全体"];
    check("19.3 hnr: 誤検出ラン(C5)もゲートされず3フレームとも残る",
      !!cellHnrC5 && near(cellHnrC5.wtotal, 3, 1e-9) && near(cellHnrC5.wsum / cellHnrC5.wtotal, 20, 1e-9),
      cellHnrC5 ? `wtotal=${cellHnrC5.wtotal}` : "セルなし");
  }

  // --- 19.4 変異試験(検査自体に組み込む。変異は複製したコード文字列にだけ当てる) ---
  // getValueのゲート判定(f._pitchGateOk ? f.pitchCents : null)を外すと、19.1で
  // 消えるはずの誤検出ラン(C5)がセルに残ってしまう=19.1はゲートを本当に検査している。
  {
    const mutApi = buildPivotApi([
      ['getValue: (f) => (f._pitchGateOk ? f.pitchCents : null)', 'getValue: (f) => f.pitchCents'],
    ]);
    const pivotMut = mutApi.buildPivot(fwc, ctx, "note", "none", "pitchCents", []);
    const cellMutC5 = pivotMut.cells["C5"]?.["全体"];
    check("19.4x 変異(getValueのゲート判定を外す)では誤検出ラン(C5)がセルに残り19.1が落ちる",
      pivotMut.rowKeys.includes("C5") && !!cellMutC5 && near(cellMutC5.wsum / cellMutC5.wtotal, 5, 1e-9),
      `rowKeys=${pivotMut.rowKeys.join(",")}`);
  }

  // --- 19.5 変異試験: buildFramesWithContext自体のゲート注入を無効化すると19.1が落ちる ---
  // 【審査指摘への直接対応】buildFramesWithContextを実ソースからextractFunctionで抽出する
  // ようにしたことで、App.jsx側の "_pitchGateOk: sel.selected.has(i)," を
  // "_pitchGateOk: true," に変異(=ゲートを丸ごと無効化)させると、今度こそ19.1相当の
  // 主張が落ちることを確認する(この変異が検知できないことこそが審査で指摘された欠陥だった)。
  {
    const mutApi = buildPivotApi([
      ["_pitchGateOk: sel.selected.has(i),", "_pitchGateOk: true, // MUTATION"],
    ]);
    const fwcMut = mutApi.buildFramesWithContext([sessionObj], []);
    const pivotMut = mutApi.buildPivot(fwcMut, ctx, "note", "none", "pitchCents", []);
    const cellMutC5 = pivotMut.cells["C5"]?.["全体"];
    check("19.5x 変異(_pitchGateOkを常にtrueにする)では誤検出ラン(C5)がセルに残り19.1が落ちる",
      pivotMut.rowKeys.includes("C5") && !!cellMutC5 && near(cellMutC5.wsum / cellMutC5.wtotal, 5, 1e-9),
      `rowKeys=${pivotMut.rowKeys.join(",")}`);
    const cellMutC4 = pivotMut.cells["C4"]["全体"];
    const expectedC4 = (6 * 2 + 11 * -6) / 17; // 19.1のトリム後の期待値
    check("19.5x 変異(_pitchGateOkを常にtrueにする)ではC4セルもトリム前の値に汚染され19.1の期待値と食い違う",
      !near(cellMutC4.wsum / cellMutC4.wtotal, expectedC4, 0.05),
      `mutant=${cellMutC4.wsum / cellMutC4.wtotal} expect(gate後)=${expectedC4}`);
  }

  console.log("  -> done");
}

// ============================================================
// 検証20: F-51 / F-52 / F-53
//   F-51 振り子: 錘のタップで開始・停止/停止後にゆっくり中央へ戻る
//   F-52 【バグ】別アプリから戻るとメトロノームが端で固まる(音声時計が止まったまま)
//   F-53 【バグ】詳細を開いた状態でテンポ入力すると録音ボタン以下が下へずれる
// 関数はすべて実ソースから extractFunction / extractConst で取り出して評価する
// (F-45 の審査で「テスト側の手書き再実装は実ソースを守らない」と不合格になった前例がある)。
// ============================================================
console.log("=== 検証20: F-51 振り子 / F-52 音声時計の停止 / F-53 画面ぶんの高さ ===");
{
  // extractFunction は「関数名の次の { 」から括弧を数えるので、引数が分割代入
  // (function PitchRing({ note, … })) の関数では**引数の { } だけ**を取ってしまう。
  // コンポーネントの本体を読むときはこちらを使う(section 15 の sourceOf と同じ考え)。
  const componentSourceOf = (name) => {
    const idx = src.indexOf(`function ${name}(`);
    if (idx === -1) throw new Error(`function ${name} not found`);
    let i = src.indexOf("(", idx), depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") { depth--; if (depth === 0) { i++; break; } }
    }
    while (i < src.length && src[i] !== "{") i++;
    let d = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === "{") d++;
      else if (src[j] === "}") { d--; if (d === 0) return src.slice(idx, j + 1); }
    }
    throw new Error(`function ${name}: unbalanced braces`);
  };

  const api20 = new Function(`${[
    extractFunction("fillViewportMinHeight"),
    extractConst("AUDIO_CLOCK_STALL_MIN_WALL_S"),
    extractConst("AUDIO_CLOCK_STALL_RATIO"),
    extractFunction("audioClockStalled"),
    extractConst("RING_PEND_R"),
    extractConst("RING_PEND_SWING_DEG"),
    extractConst("RING_PEND_SETTLE_EPS_VB"),
    extractFunction("ringPendDeg"),
    extractFunction("ringPendSettleDeg"),
    extractFunction("ringPendSettleDone"),
  ].join("\n\n")}
    return { fillViewportMinHeight, audioClockStalled, ringPendDeg, ringPendSettleDeg, ringPendSettleDone,
             AUDIO_CLOCK_STALL_MIN_WALL_S, AUDIO_CLOCK_STALL_RATIO, RING_PEND_SETTLE_EPS_VB,
             RING_PEND_R, RING_PEND_SWING_DEG };`)();

  // --- 20.1 F-53 画面ぶんの高さは「スクロール位置に依存しない」 --------------
  // 本人報告「詳細ページを開いているときにテンポ入力をすると録音ボタンから下のすべての
  // 位置が下に大きくズレる」。詳細を開くとページがスクロールできるようになり、
  // スクロールした状態で測り直し(resize / visualViewport の resize)が走ると
  // getBoundingClientRect().top がスクロール量ぶん小さくなって minHeight が膨らむ。
  // **枠の高さがスクロール量に比例して伸び、flex:1 の中間がそれを吸収するので
  // 録音ボタン以下がそのぶん下がる。** DESIGN-SYSTEM §6.1.5 に真正面から反する。
  //
  // 【縛り方】文書上の位置(docTop)を固定したまま、スクロール量だけを動かして
  // 返り値が1pxも変わらないことを見る。スクロール項を落とすと即座に落ちる。
  {
    const docTop = 60, visibleH = 768, gap = 81;
    const at = (scrollY) => api20.fillViewportMinHeight(docTop - scrollY, scrollY, visibleH, gap);
    const base = at(0);
    check("F-53: 画面ぶんの高さの基準値(スクロール0)", base === visibleH - docTop - gap, `${base}`);
    for (const s of [1, 100, 447, 900]) {
      check(`F-53: スクロール ${s}px でも画面ぶんの高さは変わらない`, at(s) === base, `${at(s)} / 基準 ${base}`);
    }
    // 下端の余白・可視高は素直に効くこと(スクロール項だけを無視する実装になっていない)
    check("F-53: 下端の余白が増えればそのぶん減る",
      api20.fillViewportMinHeight(docTop, 0, visibleH, gap + 34) === base - 34);
    check("F-53: 可視高が縮めばそのぶん減る(キーボードで visualViewport が縮む場合)",
      api20.fillViewportMinHeight(docTop, 0, visibleH - 300, gap) === base - 300);
    check("F-53: 負にはならない(0で止める)",
      api20.fillViewportMinHeight(10000, 0, visibleH, gap) === 0);
    // 【配線】純関数が正しくても、フックが呼んでいなければ意味がない。
    const hook = codeOf(extractFunction("useFillViewportHeight"));
    check("F-53: useFillViewportHeight は fillViewportMinHeight にスクロール量を渡している",
      /fillViewportMinHeight\(\s*el\.getBoundingClientRect\(\)\.top\s*,\s*scrollY\s*,/.test(hook),
      hook.replace(/\s+/g, " ").slice(0, 220));
    check("F-53: スクロール量は window.scrollY(無ければ documentElement.scrollTop)から取る",
      /window\.scrollY\s*\?\?\s*document\.documentElement\.scrollTop/.test(hook));
    check("F-53: フックが自前で高さを計算し直していない(計算は純関数1箇所)",
      !/visibleViewportHeight\(\)\s*-/.test(hook), hook.replace(/\s+/g, " ").slice(0, 220));
    // 計測タブの枠がこのフックを使っていること(F-7 で組んだ構造の入口)
    check("F-53: 計測タブの枠は useFillViewportHeight で高さを決めている",
      /const measureMinH = useFillViewportHeight\(measureRootRef\);/.test(src));
    check("F-53: 枠の minHeight は measureMinH(枠は1枚だけ・詳細カードはその外)",
      /minHeight: measureMinH \|\| undefined/.test(src));
  }

  // --- 20.2 F-52 音声時計が止まったまま復帰したことを検出する ----------------
  // 本人報告「メトロノーム起動中に違うアプリへ行って戻ると、たまに右端から動かなくなる。
  // スタートを押しても動かない。ストップで真ん中に戻るが、またスタートすると右端へ飛ぶだけ。
  // アプリを落とすと直る」。
  // iOS は割り込みから戻ったあと state を "running" と報告したまま currentTime が
  // 止まったコンテキストを返すことがあり、既存の audioCtxRecoveryAction(state だけを見る)
  // では "ok" になって使い回されてしまう。
  {
    const stalled = api20.audioClockStalled;
    check("F-52: 健全な時計は「止まった」と判定しない(実5秒/音声5秒)", stalled(5, 5) === false);
    check("F-52: 止まった時計を検出する(実5秒/音声0秒)", stalled(0, 5) === true);
    check("F-52: 作り直された直後の時計(音声が巻き戻る)も「止まった」側に落ちる", stalled(-3, 5) === true);
    check("F-52: 実時間が1秒未満なら判定しない(連打で作り直さない)", stalled(0, 0.5) === false);
    check("F-52: 実時間ちょうど1秒からは判定する", stalled(0, 1) === true);
    // しきい値(実時間の50%)を独立に当てる。片側ずつ挟んで、比率を変えると落ちるようにする。
    check("F-52: 実時間の49%しか進んでいなければ止まっている", stalled(5 * 0.49, 5) === true);
    check("F-52: 実時間の51%進んでいれば止まっていない", stalled(5 * 0.51, 5) === false);
    check("F-52: 判定に使う定数(1秒 / 0.5)が体系の外の値になっていない",
      api20.AUDIO_CLOCK_STALL_MIN_WALL_S === 1 && api20.AUDIO_CLOCK_STALL_RATIO === 0.5,
      `${api20.AUDIO_CLOCK_STALL_MIN_WALL_S} / ${api20.AUDIO_CLOCK_STALL_RATIO}`);

    // 【配線】判定関数があっても、START が呼ばなければ何も直らない。
    const startBody = codeOf(src.slice(src.indexOf("const startMetronome = useCallback("),
      src.indexOf("const stopMetronome = useCallback(")));
    const stopBody = codeOf(src.slice(src.indexOf("const stopMetronome = useCallback("),
      src.indexOf("// アンマウント(=計測タブを離れた)時は完全に停止して音を止める")));
    const markStart = src.indexOf("const markMetroClock = useCallback(");
    const markFn = markStart === -1 ? "" : codeOf(src.slice(markStart, src.indexOf("}, []);", markStart) + 7));
    const visBody = codeOf(src.slice(src.indexOf("const onVis = () => {"),
      src.indexOf('document.addEventListener("visibilitychange", onVis);')));
    check("F-52: START が audioClockStalled で時計の停止を見ている",
      /audioClockStalled\(\s*ctx\.currentTime - mark\.audio\s*,\s*\(performance\.now\(\) - mark\.wall\) \/ 1000\s*\)/.test(startBody),
      startBody.replace(/\s+/g, " ").slice(0, 240));
    check("F-52: 時計が止まっていたら state を信じずにコンテキストを作り直す",
      /if \(!ctx \|\| ctx\.state !== "running" \|\| clockStalled\)/.test(startBody),
      startBody.replace(/\s+/g, " ").slice(0, 240));
    check("F-52: 基準点は1回のSTARTで使い切る(作り直した新しい時計と比べない)",
      /metroClockMarkRef\.current = null;/.test(startBody));
    check("F-52: 基準点は (音声時計, 実時計) の対で控える",
      /\{ audio: ctx\.currentTime, wall: performance\.now\(\) \}/.test(markFn), markFn.replace(/\s+/g, " ").slice(0, 200));
    check("F-52: 非表示になる瞬間に基準点を控える(鳴っていたかに関わらず)",
      /markMetroClock\(\);/.test(visBody) &&
      visBody.indexOf("markMetroClock()") < visBody.indexOf("stopMetronome()"),
      visBody.replace(/\s+/g, " ").slice(0, 200));
    check("F-52: 停止したときも基準点を控える(visibilitychange が飛ばない端末の逃げ道)",
      /markMetroClock\(\);/.test(stopBody), stopBody.replace(/\s+/g, " ").slice(0, 200));
    // 発音のスケジューリングそのものには触れていないこと(直したのは位相の基準時刻の再同期だけ)
    const schedStart = src.indexOf("const metroSchedulerTick = useCallback(");
    const sched = codeOf(src.slice(schedStart, src.indexOf("const startMetronome = useCallback(", schedStart)));
    check("F-52: スケジューラを走査できている", /while \(metroNextTimeRef\.current < ctx\.currentTime \+ LOOKAHEAD\)/.test(sched));
    check("F-52: 発音のスケジューラには手を入れていない(時計の判定を持ち込んでいない)",
      !/audioClockStalled|metroClockMarkRef|markMetroClock/.test(sched));
  }

  // --- 20.3 F-51 停止後に「ゆっくり中央へ戻る」 -----------------------------
  // 本人指示「メトロノーム止めた時にいきなり真ん中に振り子が戻るのではなく、
  //           本物の振り子のようにゆっくり真ん中に戻るモーションを追加」。
  // 【新しい値を作っていないこと】角振動数も減衰の時定数も 1拍の長さ(beatDur)から出す。
  //   動作中: deg = SWING × cos(π × 経過/beatDur) → ω = π/beatDur
  //   戻り  : deg = from × exp(−経過/beatDur) × cos(ω × 経過)
  // この2点を**数値の同一性**で当てると、ω や τ に係数を1つでも入れた瞬間に落ちる。
  {
    const A = 55, D = 0.5;
    const f = api20.ringPendSettleDeg;
    check("F-51: 停止した瞬間は止まった角度そのもの", f(A, D, 0) === A);
    // ω = π/beatDur の裏取り: 1/4周期(=beatDur/2)でちょうど0を通る
    check("F-51: 角振動数は動作中の振り子と同じ(beatDur/2 で中央を通過)",
      Math.abs(f(A, D, D / 2)) < 1e-12, `${f(A, D, D / 2)}`);
    check("F-51: 角振動数は beatDur に比例する(テンポを変えても同じ関係)",
      Math.abs(f(A, 0.8, 0.4)) < 1e-12, `${f(A, 0.8, 0.4)}`);
    // τ = beatDur の裏取り: 片道1振り(beatDur)後に振幅がちょうど 1/e
    check("F-51: 減衰の時定数は1拍ぶん(beatDur 後に振幅が 1/e)",
      Math.abs(f(A, D, D) - (-A * Math.exp(-1))) < 1e-12, `${f(A, D, D)} / 期待 ${-A * Math.exp(-1)}`);
    check("F-51: 時定数も beatDur に比例する", Math.abs(f(A, 0.8, 0.8) - (-A * Math.exp(-1))) < 1e-12);
    // 包絡は単調減少で、必ず0へ収束する(端に張り付いたままにならない)
    {
      let ok = true, prev = Infinity;
      for (let t = 0; t <= 4 * D; t += D / 40) {
        const env = Math.abs(A) * Math.exp(-t / D);
        if (Math.abs(f(A, D, t)) > env + 1e-9) ok = false;
        if (env > prev + 1e-12) ok = false;
        prev = env;
      }
      check("F-51: 角度は常に包絡の内側で、包絡は単調に減る", ok);
    }
    check("F-51: 十分に時間が経てば中央に落ち着く", Math.abs(f(A, D, 20 * D)) < 1e-6, `${f(A, D, 20 * D)}`);
    // 静止の判定は**包絡だけ**を見る(cos は途中で何度も0を通るので角度では判定できない)
    check("F-51: 止まった直後は「戻りきった」と判定しない", api20.ringPendSettleDone(A, D, 0) === false);
    check("F-51: 中央を通過する瞬間(角度0)でも戻りきったとは判定しない",
      api20.ringPendSettleDone(A, D, D / 2) === false);
    check("F-51: 描画の丸め(toFixed(2))より小さくなったら戻りきったと判定する",
      api20.ringPendSettleDone(A, D, 12 * D) === true);
    const ring = codeOf(componentSourceOf("PitchRing"));
    // --- 静止と判定するしきい値 -------------------------------------------
    // 【この検査は一度書き直している】最初は期待時刻を
    //   tDone = -D * log(eps / (A * π/180 * RING_PEND_R))
    // と **守るべき定数 eps そのものから逆算**して突き合わせていた。これは
    // LOOP.md が禁じる「定数の定義を言い換えるテスト」で、両辺が一緒に動くため
    // eps を 0.005 → 50(1万倍)にしても緑のまま通った。**そのとき振り子は中央から
    // 30.5°(画面上 55px)離れた位置からいきなり中央へ飛ぶ** = F-51 が直そうとした
    // 本人指示「いきなり真ん中に振り子が戻る」そのものになる(審査役が実測)。
    //
    // 書き直した形: しきい値の根拠は「錘の座標を toFixed(桁) で書くので、
    // それより小さい変位は属性の文字列を変えられない=静止と区別できない」。
    // ならば **桁数を実ソースの描画側から読み**、そこから丸め幅を出して当てる。
    // eps を触っても描画側の桁数は動かないので、両辺が連動しない。
    {
      const m = /bob\.setAttribute\("cx", bx\.toFixed\((\d+)\)\)/.exec(ring);
      check("F-51: 錘の座標を書く桁数を実ソースから読めている", m !== null, String(m && m[1]));
      const digits = m ? Number(m[1]) : NaN;
      const half = 0.5 * Math.pow(10, -digits);   // toFixed(2) なら 0.005 viewBox
      // (a) しきい値そのものが描画の丸め幅と一致していること。
      //     eps を動かすとここが落ちる。逆に toFixed の桁を変えてもここが落ちる
      //     (桁を変えたら eps も直すべき、という関係を両方向に縛る)。
      check("F-51: 静止のしきい値は描画の丸め幅そのもの(定数の綴りではなく値で見る)",
        api20.RING_PEND_SETTLE_EPS_VB === half,
        `eps=${api20.RING_PEND_SETTLE_EPS_VB} / toFixed(${digits}) の丸め幅=${half}`);
      // (b) 挙動でも当てる。**定数を一切使わず**、静止と判定した最初の瞬間の
      //     「錘の実際の変位」が丸め幅の内側にあり、その1ステップ前はまだ外側にある
      //     ことを掃引で確かめる(= 丸めに乗った瞬間に静止と判定している)。
      //     eps を大きくすると (b-1) が、小さくすると (b-2) が落ちる。
      const disp = (t) => Math.abs(A) * Math.exp(-t / D) * (Math.PI / 180) * api20.RING_PEND_R;
      const step = D / 2000;
      let tFirst = null;
      for (let t = 0; t <= 40 * D; t += step) if (api20.ringPendSettleDone(A, D, t)) { tFirst = t; break; }
      check("F-51: 掃引で「静止と判定した最初の時刻」を見つけられている", tFirst !== null,
        tFirst === null ? "40拍たっても静止と判定しない" : `t=${tFirst.toFixed(4)}s`);
      check("F-51: 静止と判定した瞬間、錘の変位は描画の丸め幅より小さい(=画面上で飛ばない)",
        tFirst !== null && disp(tFirst) < half,
        `変位=${tFirst === null ? "-" : disp(tFirst).toExponential(3)} / 丸め幅=${half}`);
      check("F-51: その1ステップ前はまだ丸め幅以上(必要以上に長く回し続けていない)",
        tFirst !== null && tFirst > 0 && disp(tFirst - step) >= half,
        `1つ前の変位=${tFirst === null || tFirst === 0 ? "-" : disp(tFirst - step).toExponential(3)} / 丸め幅=${half}`);
      // 参考出力。**アサーションにはしない**(上の (b-1) から自動的に従うので、
      //   ここで「〜px 未満」を主張しても恒真な条件を1つ増やすだけになる)。
      //   viewBox 300 に対し環の実寸は RING_D_FULL(330) = 1.1倍(§6.1「単位を書き間違えない」)。
      if (tFirst !== null) console.log(`  静止に切り替わる瞬間の飛び: ${(disp(tFirst) * (330 / 300)).toExponential(3)} CSS px ` +
        `(判定時刻 ${tFirst.toFixed(3)}s / 停止角 ${A}° / beatDur ${D}s)`);
    }
    check("F-51: beatDur が取れないときは戻りを出さない(0除算・NaNを作らない)",
      f(A, 0, 1) === 0 && api20.ringPendSettleDone(A, 0, 0) === true);

    // 【配線】環のrAFループが実際にこの2つを使い、減速設定では出さないこと。
    check("F-51: 停止中は ringPendSettleDeg で角度を作る",
      /pendDeg = ringPendSettleDeg\(s\.from, s\.dur, el\)/.test(ring), "");
    check("F-51: 戻りきったかは ringPendSettleDone で見る",
      /ringPendSettleDone\(s\.from, s\.dur, el\)/.test(ring));
    check("F-51: 減速設定の端末では戻りを出さず即座に中央(装飾は止める・§6.1)",
      /reduceMotion\.matches \|\| !settleOnStopRef\.current/.test(ring), "");
    check("F-51: 戻りの起点は「止まった瞬間の角度」(lastDegRef)",
      /const from = lastDegRef\.current;/.test(ring) && /lastDegRef\.current = pendDeg;/.test(ring));
    check("F-51: 動き出したら戻りの状態は捨てる(次の停止で古い角度から戻らない)",
      /settleRef\.current = null;/.test(ring));
    check("F-51: 1拍の長さは MeasureView の getMetroBeatDur から受け取る(勝手な周期を持たない)",
      /getBeatDur=\{getMetroBeatDur\}/.test(src) &&
      /const getMetroBeatDur = useCallback\(\(\) => \{[\s\S]{0,200}?a\.dur \|\| \(60 \/ metroTempoRef\.current\)/.test(src));
    // 【2026-08-04 統括の仕様ミスの訂正】当初「録音中は絶対に走らせないこと(既存の規則)」と
    // 指示したが、実装役が「その規則の出典が見つからない」と報告して正しかった。
    // リポジトリで「録音中は走らせない」と書かれているのは**マイク復旧**だけで
    // (recoverMic: セッションが壊れるため)、振り子の戻りは計測にも発音にも一切関与しない
    // 純粋な描画。録音中だけカクッと戻る差を作る根拠が無いので settleOnStop の指定を外し、
    // 既定の true(常にゆっくり戻る)に統一した。**録音状態で戻り方を分岐させないこと**を固定する。
    check("F-51: 戻りは録音状態で分岐させない(settleOnStop を isRecording で切らない)",
      !/settleOnStop=\{!?\s*isRecording\s*\}/.test(codeOf(src)));
  }

  // --- 20.4 F-51 錘のタップで開始/停止 --------------------------------------
  // 本人指示「メトロノームモードで振り子をタップでスタートしてもメトロノームがスタートする」。
  // 錘そのものは実寸 直径 30.8 CSS px しかなく、DESIGN-SYSTEM §5 の 44pt に足りない。
  // **見た目は変えず、透明な当たり判定だけを広げる。**
  {
    const ring = codeOf(componentSourceOf("PitchRing"));
    const i = src.indexOf('aria-label="メトロノームの開始/停止"');
    const tapTag = i === -1 ? "" : src.slice(src.lastIndexOf("<button", i), src.indexOf("/>", i) + 2);
    check("F-51: 錘のタップ用のボタンがある", i !== -1 && /ref=\{bobTapRef\}/.test(tapTag), tapTag.slice(0, 120));
    check("F-51: タップは onBeatToggle を呼ぶ(発音・位相の計算には触れない)",
      /onClick=\{onBeatToggle\}/.test(tapTag));
    check("F-51: 状態は aria-pressed が持つ(SVG は aria-hidden なので名前もここが持つ)",
      /aria-pressed=\{beatOn\}/.test(tapTag) && /aria-hidden="true"/.test(ring));
    check("F-51: 当たり判定は --tap-min(§5 の下限)で、見た目は持たない",
      /width: "var\(--tap-min\)", height: "var\(--tap-min\)"/.test(tapTag) &&
      /background: "transparent"/.test(tapTag) && /border: "none"/.test(tapTag),
      tapTag.replace(/\s+/g, " ").slice(0, 240));
    check("F-51: 当たり判定は錘の中心に合わせる(--tap-min の半分だけ戻す)",
      /marginLeft: "calc\(var\(--tap-min\) \/ -2\)", marginTop: "calc\(var\(--tap-min\) \/ -2\)"/.test(tapTag));
    check("F-51: 当たり判定は position:absolute(出ても消えてもレイアウトが動かない・§6.1.5)",
      /position: "absolute"/.test(tapTag));
    // 初期値は錘の静止位置(12時)と同じ式から出す。0% だと最初の1フレームだけ
    // 当たり判定が錘より 61.6px 上にいる(審査役の指摘)。
    check("F-51: 当たり判定の初期位置は錘の静止位置(12時)と同じ式で書く",
      /left: `\$\{\(CX \/ VB\) \* 100\}%`, top: `\$\{\(\(CY - RING_PEND_R\) \/ VB\) \* 100\}%`/.test(tapTag),
      tapTag.replace(/\s+/g, " ").slice(0, 200));
    check("F-51: 当たり判定は rAF が錘に追従させる(left/top を % で書き換える)",
      /tap\.style\.left = `\$\{\(bx \/ RING_VB\) \* 100\}%`/.test(ring) &&
      /tap\.style\.top = `\$\{\(by \/ RING_VB\) \* 100\}%`/.test(ring));
    check("F-51: メトロノームを開いていて、かつトグルが渡されたときだけ出す",
      /\{getBeatPhase && onBeatToggle && \(/.test(ring));
    check("F-51: MeasureView は既存の startMetronome / stopMetronome をそのまま渡す",
      /onBeatToggle=\{\(\) => \(metronomeOn \? stopMetronome\(\) : startMetronome\(\)\)\}/.test(src));
    // 【当たり判定を広げる必要があることの独立計算】錘の実寸 < 44。
    {
      const bobPx = 2 * 14 * (330 / 300); // RING_PEND_BOB_R × 2 × (RING_D_FULL / RING_VB)
      check("F-51: 錘そのものの実寸(30.8px)は §5 の 44pt に足りない(だから透明な当たり判定が要る)",
        bobPx < 44 && Math.abs(bobPx - 30.8) < 1e-9, `${bobPx.toFixed(2)}px`);
    }
  }
  console.log("  -> done");
}

// ============================================================
// 検証21: F-66 ピッチ誤差に「ばらつき」を併記する
//
// 主役の数字(pitchCentsSigned)は**符号付きの加重平均**なので、+5¢と−5¢を行き来していると
// 打ち消し合って0に近づく=「一度も合っていないのに0¢」が起こる(本人報告「肌感覚より過剰に
// 合っている」の正体)。この節はその状況を合成フレーム列で実際に作り、
// **主役が0.0¢でも副次テキストが「ばらつき ±5.0¢」を返す**ことを実ソースで固定する。
//
// 関数・定数・指標定義はすべて実ソースから extractFunction / extractConst で取り出して
// 評価する(テスト側の手書き再実装は実ソースを守らない。F-45 の前例)。
// 期待値は「25msホップでどのtのフレームが残るか」をテスト側で独立に数えた値であって、
// 定数(PITCH_EDGE_TRIM_MS 等)の言い換えではない(F-51 の前例)。
// ============================================================
console.log("=== 検証21: F-66 ピッチ誤差にばらつきを併記 ===");
{
  // 実ソースの断片を束ねたサンドボックス。edits([from,to])で変異体を作れる
  // (変異はこの複製文字列上でだけ起き、実ソースには触れない)。置換の空振りは例外。
  const buildF66Api = (edits = []) => {
    let pieces = [
      extractFunction("mean"),
      extractFunction("median"),
      extractFunction("stddev"),
      extractFunction("frameWeight"),
      extractFunction("timbreSustained"),
      extractFunction("weightedMean"),
      extractConst("TIMBRE_SUSTAIN_MS"),
      extractConst("PITCH_EDGE_TRIM_MS"),
      extractConst("PITCH_RUN_GAP_MS"),
      extractConst("PITCH_FLIP_MAX_MS"),
      extractConst("PITCH_FLIP_NEIGHBOR_AGREE_CENTS"),
      extractConst("PITCH_FLIP_INTERVALS_CENTS"),
      extractConst("PITCH_FLIP_TOLERANCE_CENTS"),
      extractFunction("selectPitchAggregationFrames"),
      extractFunction("computeFrameMetrics"),
      extractFunction("pitchSpreadSub"),
      extractConst("REED_COMPARE_METRICS"),
      extractConst("MY_DATA_METRICS"),
    ].join("\n\n");
    for (const [from, to] of edits) {
      const before = pieces;
      pieces = pieces.replace(from, to);
      if (pieces === before) throw new Error(`mutation failed: "${from}" not found`);
    }
    return new Function(`${pieces}
      return { computeFrameMetrics, pitchSpreadSub, REED_COMPARE_METRICS, MY_DATA_METRICS };`)();
  };
  const api = buildF66Api();

  const HOP = 0.025;
  const hzOf = (si) => 440 * Math.pow(2, (si - 9) / 12);
  const pf = (t, si, dev) => ({
    t, semitoneIndex: si,
    pitchHz: hzOf(si) * Math.pow(2, dev / 1200),
    pitchCents: dev,
    clarity: 1, volumeDb: -20, noteAgeMs: 1000, hnrDb: 20, spectralCentroidHz: 1000, harmonics: [],
  });
  const near = (a, b, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) <= eps;
  // 副次テキストの導出を**例外ごと**評価する。null ガードを外す変異は
  // undefined.toFixed で throw するので、素で呼ぶとハーネスごと落ちて
  // 「どの検査が何を守ったか」が残らない。落ちた事実を値として拾い、検査を落とす。
  const callSub = (fn, arg) => { try { return fn(arg); } catch (e) { return `例外(${e.message})`; } };

  // --- 21.1 本人報告そのものの再現: 打ち消し合って0¢になる列 --------------------
  // 42フレーム(t=0〜1.025s, 25msホップ)を1つの音(si=10)で、+5¢と−5¢を1フレームおきに往復。
  // 【テスト側の独立な手計算】区間長 dur = 41×0.025 = 1.025s。両端トリム量は
  // e = min(120ms, dur/3=341.7ms) = 0.12s なので採用は t∈[0.12, 0.905]。
  // t=0.025k がこの帯に入るのは k=5(t=0.125)〜k=36(t=0.900) の **32フレーム**。
  // その内訳は奇数k(=−5¢)が16個、偶数k(=+5¢)が16個で**ちょうど釣り合う**。
  //   → 主役(符号付き加重平均, clarity=1) = 0/32 = 0.0¢  ← 「一度も合っていないのに0¢」
  //   → ばらつき(母標準偏差) = √(32×25/32) = 5.0¢       ← 実際には常に5¢外している
  {
    const frames = Array.from({ length: 42 }, (_, k) => pf(k * HOP, 10, k % 2 === 0 ? 5 : -5));
    const m = api.computeFrameMetrics(frames);
    check("21.1 採用フレームは手計算どおり32個(t∈[0.12,0.905]のk=5〜36)",
      m.pitchFrameUsed === 32, `used=${m.pitchFrameUsed} total=${m.pitchFrameTotal}`);
    check("21.1 主役のピッチ誤差は打ち消し合って0.0¢になる(本人が見ていた数字)",
      near(m.pitchCentsSigned, 0), `${m.pitchCentsSigned}`);
    check("21.1 主役の表示は「+0.0」(合っているように見える)",
      `${m.pitchCentsSigned >= 0 ? "+" : ""}${m.pitchCentsSigned.toFixed(1)}` === "+0.0");
    // ここが F-66 の芯。主役が0.0でも、副次テキストは実際のズレ幅5¢を返さなければならない。
    check("21.1 副次テキストは「ばらつき ±5.0¢」(合っていないことが数字に出る)",
      callSub(api.pitchSpreadSub, m) === "ばらつき ±5.0¢", `${callSub(api.pitchSpreadSub, m)}`);
    // (この列は全フレームがちょうど±5¢で、0¢のフレームは1つも無い。
    //  主役の +0.0 は「合っている」ではなく打ち消し合いの産物である、という状況そのもの)
  }

  // --- 21.2 ばらつきが出せないときは副次テキストごと出さない --------------------
  // stddev は arr.length < 2 で null を返す。採用フレームが1つしかないセッションで
  // 「ばらつき ±null¢」「±NaN¢」を出さないこと。
  {
    // 2フレーム(dur=25ms)。トリム帯 t∈[0.00833,0.01667] にフレームが無いので
    // 「全滅させない」フォールバックでインデックス中央の1フレームだけが採用される。
    const frames = [pf(0, 10, 7), pf(0.025, 10, 9)];
    const m = api.computeFrameMetrics(frames);
    check("21.2 採用フレームが1つのとき ばらつきは算出されない(stddevがnull)",
      m.pitchFrameUsed === 1 && m.pitchStabilityCents === null,
      `used=${m.pitchFrameUsed} sd=${m.pitchStabilityCents}`);
    check("21.2 そのとき副次テキストは出さない(nullを返す)",
      callSub(api.pitchSpreadSub, m) === null, `${callSub(api.pitchSpreadSub, m)}`);
    check("21.2 主役の数字は今までどおり出る(副次だけが消える)",
      m.pitchCentsSigned !== null && m.pitchCentsSigned !== undefined);
    for (const [label, arg] of [
      ["null", null], ["undefined", undefined], ["空オブジェクト", {}],
      ["sd=null", { pitchStabilityCents: null }],
      ["sd=undefined", { pitchStabilityCents: undefined }],
      ["sd=NaN", { pitchStabilityCents: NaN }],
    ]) {
      check(`21.2 ${label} でも副次テキストは null(「±null¢」「±NaN¢」を出さない)`,
        callSub(api.pitchSpreadSub, arg) === null, `${callSub(api.pitchSpreadSub, arg)}`);
    }
  }

  // --- 21.3 表記と桁 -----------------------------------------------------------
  // 表記は「ばらつき ±5.3¢」で統一(F-46 の「ピッチ誤差」統一と同じ方針)。桁は主役と揃えて小数1桁。
  {
    check("21.3 桁は主役と同じ小数1桁(5.34 → ±5.3)",
      callSub(api.pitchSpreadSub, { pitchStabilityCents: 5.34 }) === "ばらつき ±5.3¢",
      `${callSub(api.pitchSpreadSub, { pitchStabilityCents: 5.34 })}`);
    // 端数は toFixed(1) の丸め(5.37→5.4 / 0.04→0.0)。5.35 のような二進で表せない中間値は
    // 処理系の丸めが "5.3" 側に落ちるので、丸め方向の検査には使わない。
    check("21.3 端数は1桁に丸める(5.37 → ±5.4 / 0.04 → ±0.0)",
      callSub(api.pitchSpreadSub, { pitchStabilityCents: 5.37 }) === "ばらつき ±5.4¢" &&
      callSub(api.pitchSpreadSub, { pitchStabilityCents: 0.04 }) === "ばらつき ±0.0¢");
    check("21.3 ばらつき0(全採用フレームが同じ値)は「±0.0¢」として出す(消さない)",
      callSub(api.pitchSpreadSub, { pitchStabilityCents: 0 }) === "ばらつき ±0.0¢");
    // 主役(偏り)ではなく、ばらつき(標準偏差)を読んでいること。
    // 両方入れた指標オブジェクトで、どちらを読んでいるかを判別する。
    check("21.3 読むのは pitchStabilityCents であって pitchCentsSigned ではない",
      callSub(api.pitchSpreadSub, { pitchCentsSigned: 9.9, pitchStabilityCents: 5.34 }) === "ばらつき ±5.3¢");
    check("21.3 常に非負の量なので符号は「±」1つだけ(「±-」が出ない)",
      !/±-/.test(callSub(api.pitchSpreadSub, { pitchStabilityCents: 4.4 })));
  }

  // --- 21.4 導出は指標定義に1つだけ(4画面へコピペしない) ------------------------
  // F-46 で SESSION_METRICS を廃止して1配列に統合したのと同じ考え方。
  {
    const fixture = { pitchCentsSigned: 1.2, pitchStabilityCents: 5.3 };
    for (const [name, arr] of [["REED_COMPARE_METRICS", api.REED_COMPARE_METRICS], ["MY_DATA_METRICS", api.MY_DATA_METRICS]]) {
      const pitch = arr.find((x) => x.key === "pitchCentsSigned");
      const sub = typeof pitch?.sub === "function" ? pitch.sub : () => "(subが無い)";
      check(`21.4 ${name} のピッチ誤差は副次テキストの導出(sub)を持つ`,
        typeof pitch?.sub === "function");
      check(`21.4 ${name} の sub は指標オブジェクトから「ばらつき ±5.3¢」を返す`,
        callSub(sub, fixture) === "ばらつき ±5.3¢", `${callSub(sub, fixture)}`);
      check(`21.4 ${name} の sub は共通の pitchSpreadSub と同じ結果を返す(写しではない)`,
        callSub(sub, fixture) === callSub(api.pitchSpreadSub, fixture) &&
        callSub(sub, {}) === callSub(api.pitchSpreadSub, {}));
      // ばらつきはピッチ誤差だけの話。音量・HNR・重心に副次テキストは付かない
      for (const other of arr.filter((x) => x.key !== "pitchCentsSigned")) {
        check(`21.4 ${name} の ${other.key} には sub が無い(ばらつきはピッチ誤差だけ)`,
          other.sub === undefined);
      }
    }
    // 「4箇所にコピペしない」を綴りで縛る。表示文言の組み立ては動く側に1回しか現れない
    // (**「無いこと」ではなく「1回だけ」を見る検査なので codeOf() で経緯コメントを外す**)。
    const liveSrc = codeOf(src);
    check("21.4 副次テキストの文言の組み立ては動く側のソースに1箇所だけ",
      (liveSrc.match(/ばらつき/g) || []).length === 1,
      `${(liveSrc.match(/ばらつき/g) || []).length}箇所`);
    check("21.4 表記は「ばらつき」で統一(「安定度」「標準偏差」を混ぜない)",
      !liveSrc.includes("安定度") && !liveSrc.includes("標準偏差"));
  }

  // --- 21.5 配線: 4画面すべてが指標定義の sub を渡している ----------------------
  // 純関数と指標定義が正しくても、カードに渡していなければ画面には出ない。
  // (ハーネスはJSXを評価しないので、ここは実ソースの綴りで縛る。この節の限界として明記する)
  {
    const componentSourceOf = (name) => {
      const idx = src.indexOf(`function ${name}(`);
      if (idx === -1) throw new Error(`function ${name} not found`);
      let i = src.indexOf("(", idx), depth = 0;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") { depth--; if (depth === 0) { i++; break; } }
      }
      while (i < src.length && src[i] !== "{") i++;
      let d = 0;
      for (let j = i; j < src.length; j++) {
        if (src[j] === "{") d++;
        else if (src[j] === "}") { d--; if (d === 0) return src.slice(idx, j + 1); }
      }
      throw new Error(`function ${name}: unbalanced braces`);
    };
    const wiring = [
      ["MyDataSection（My Dataカード）", "MyDataSection", /sub=\{m\.sub\?\.\(overall\)/],
      ["LatestSessionCard（最新セッション）", "LatestSessionCard", /sub=\{mt\.sub\?\.\(m\) \?\? null\}/],
      ["SessionDetailView（個別セッション）", "SessionDetailView", /sub=\{mt\.sub\?\.\(sessionMetrics\) \?\? null\}/],
      ["ReedEvaluationDetail（登録済みリードの測定データ）", "ReedEvaluationDetail", /sub=\{m\.sub\?\.\(overall\) \?\? null\}/],
    ];
    for (const [label, fn, re] of wiring) {
      check(`21.5 ${label} は指標定義の sub をカードに渡している`, re.test(componentSourceOf(fn)));
    }
    // ヒーローは TappableMetricCard ではないので個別に見る。主役の大きい数字と**同じ母集団**
    // から出していること(今日を出しているのに対象期間のばらつきを添えると読み違える)。
    const myDataSection = componentSourceOf("MyDataSection");
    check("21.5 ヒーローのばらつきは主役の数字と同じ母集団から出す",
      /const heroSpread = pitchSpreadSub\(todayVal != null \? todayMetrics : overall\);/.test(myDataSection));
    check("21.5 ヒーローは heroSpread があるときだけ副次行を出す",
      /\{heroSpread && <span>\{heroSpread\}<\/span>\}/.test(myDataSection));
    check("21.5 ヒーローの副次行の色は既存の副次色(#9DB3D6)のまま(新しい色を作らない)",
      /\{\(heroSpread \|\| \(todayVal != null && periodVal != null\)\) && \([\s\S]{0,200}?color: "#9DB3D6"/.test(myDataSection));
    // TappableMetricCard 側の受け口(sub)が生きていること
    const cardCode = componentSourceOf("TappableMetricCard");
    check("21.5 TappableMetricCard は sub を引数に受け取る",
      /function TappableMetricCard\(\{[^}]*\bsub\b[^}]*\}\)/.test(src));
    check("21.5 TappableMetricCard は sub があるときだけ副次行を描く",
      /\{sub && <div className="sans"/.test(cardCode));
  }

  console.log("  -> done");
}

// ============================================================
console.log("\n========== 結果 ==========");
console.log(`PASS: ${pass}  FAIL: ${fail}`);
if (failures.length) {
  console.log("--- 失敗一覧(最大30件) ---");
  failures.slice(0, 30).forEach((f) => console.log("  ✗ " + f));
}
process.exit(fail > 0 ? 1 : 0);
