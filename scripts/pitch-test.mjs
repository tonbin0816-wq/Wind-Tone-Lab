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

// 関数の本体を**そのままの文字列で**取り出す(eval はしない。ソース照合専用)。
// extractFunction は「関数名の直後の最初の {」を本体開始とみなすため、
// React コンポーネントのような分割代入の引数(`function X({ a, b }) {`)では
// 引数側の { } で早く閉じてしまう。ここでは引数の丸括弧をまず対応させてから本体を取る。
// 同じ実装が節ごとに sourceOf / srcOf という名前でローカルに置かれているが、
// それらはブロックスコープに閉じていて他の節から使えないので、ここに1つ置く。
function srcOfFn(source, name) {
  const idx = source.indexOf(`function ${name}(`);
  if (idx === -1) throw new Error(`function ${name} not found`);
  let i = source.indexOf("(", idx), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") { depth--; if (depth === 0) { i++; break; } }
  }
  while (i < source.length && source[i] !== "{") i++;
  depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) return source.slice(idx, i + 1); }
  }
  throw new Error(`function ${name}: unbalanced braces`);
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
  // 外周の光(F-47。試作 public/ring-proto.html 案③ の移植)
  extractConst("RING_GLOW_NEAR_CENTS"),
  extractConst("RING_GLOW_PEAK"),
  extractConst("RING_GLOW_EDGE_R"),
  extractConst("RING_GLOW_RISE_R"),
  extractConst("RING_GLOW_R_MAX"),
  extractConst("RING_GLOW_DECAY"),
  extractConst("RING_GLOW_RAMP_POW"),
  extractConst("RING_GLOW_GRAIN_LO"),
  extractConst("RING_GLOW_GRAIN_HI"),
  extractConst("RING_GLOW_STEPS"),
  extractConst("RING_GLOW_SEED"),
  extractConst("RING_GLOW_STOP_R0"),
  extractConst("RING_GLOW_RECT_MIN"),
  extractConst("RING_GLOW_RECT_SIZE"),
  extractFunction("ringGlowAlphaAt"),
  extractFunction("ringGlowRampAt"),
  extractFunction("ringGlowStops"),
  extractConst("RING_GLOW_FALLOFF_STOPS"),
  extractConst("RING_GLOW_GRAINY_STOPS"),
  extractConst("RING_GLOW_SMOOTH_STOPS"),
  extractFunction("ringRunEase"),
  extractFunction("ringRunQuantP"),
  extractFunction("ringRunProgress"),
  extractFunction("ringBreath"),
  extractFunction("ringGlowOpacity"),
  extractFunction("ringGlowRGB"),
  extractFunction("ringRunState"),
  // メトロノーム(N-4b: 環の外・下に「浅い弧+点」と「拍の●列」)
  extractConst("RING_PEND_SWING_DEG"),
  // 【F-95a/F-95b】拡大率は基準値より先に読む(下の派生 *_CSS が参照する)。
  extractConst("METRO_SCALE"),
  extractConst("METRO_DOT_HEAD_SCALE"),
  extractConst("METRO_ARC_W"),
  extractConst("METRO_ARC_H"),
  extractConst("METRO_ARC_P0"),
  extractConst("METRO_ARC_C"),
  extractConst("METRO_ARC_P2"),
  extractConst("METRO_ARC_SW"),
  extractConst("METRO_DOT_R"),
  extractConst("METRO_BEAT_DOT_PX"),
  extractConst("METRO_BEAT_GAP_PX"),
  extractConst("METRO_BEAT_ROW_H"),
  extractConst("METRO_PM_W"),
  extractConst("METRO_PM_H"),
  extractConst("METRO_PM_FS"),
  extractConst("METRO_BPM_FS"),
  extractConst("METRO_TSIG_FS"),
  extractConst("METRO_PM_GAP"),
  // 【F-95a】画面に出る実寸(基準値 × METRO_SCALE)。基準値の後に置くこと。
  extractConst("METRO_ARC_W_CSS"),
  extractConst("METRO_ARC_H_CSS"),
  extractConst("METRO_BEAT_ROW_H_CSS"),
  extractConst("METRO_PM_W_CSS"),
  extractConst("METRO_PM_H_CSS"),
  extractConst("METRO_PM_FS_CSS"),
  extractConst("METRO_BPM_FS_CSS"),
  extractConst("METRO_TSIG_FS_CSS"),
  extractConst("METRO_PM_GAP_CSS"),
  extractConst("METRO_ARC_PX_PER_DEG"),
  extractConst("RING_BEAT_EMPH_DECAY"),
  extractConst("RING_BEAT_EMPH_HEAD"),
  extractConst("RING_BEAT_EMPH_OTHER"),
  extractFunction("ringPendDeg"),
  // ringPendArcD / RING_PEND_ARC_D は軌道のガイド線ごと削除した(本人指示)
  extractFunction("ringBeatEmphasis"),
  extractFunction("ringBeatIndex"),
  extractFunction("ringBeatIsHead"),
  extractFunction("metroPendT"),
  extractFunction("metroArcPoint"),
  extractFunction("metroDotR"),
  extractFunction("metroBeatRowW"),
  extractFunction("metroBeatDotX"),
  extractFunction("metroBeatDotR"),
  extractFunction("formatElapsedMs"),
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
  // 【N-5】ダイヤルの先頭に「—」(未評価)を1段足した並び。REED_SCORE_NEUTRAL は
  // 「未評価のとき指を置く位置=中央の3」だったが、「—」の段ができて参照が0件になり削除された。
  extractConst("RATING_DIAL_UNRATED"),
  extractConst("RATING_DIAL_ORDER_WITH_UNRATED"),
  extractConst("RATING_DIAL_RATING_ORDER_WITH_UNRATED"),
  extractConst("REED_SCORE_PLOT_H"),
  extractFunction("normalizeReedScore"),
  extractFunction("normalizeReedRating"),
  extractFunction("normalizeReedScoreOf"),
  extractFunction("ratingDialOrder"),
  extractFunction("reedScoreText"),
  extractFunction("reedHistoryEntry"),
  extractFunction("localDayKey"),
  extractFunction("reedRatingDayKey"),
  extractFunction("normalizeRatingHistory"),
  extractFunction("commitReedScores"),
  extractFunction("reedGroupAvgRating"),
  // 箱のまとめ方そのもの。F-80/F-82 の「合流する」を実行で確かめるのに要る
  extractFunction("reedGroupKey"),
  extractFunction("reedMemberOrder"),
  extractFunction("groupReeds"),
  extractFunction("ratingDialValueAt"),
  extractFunction("ratingDialOffsetFor"),
  extractFunction("ratingDialScrollIsUser"),
  extractFunction("reedScoreY"),
  extractFunction("reedScoreX"),
  extractFunction("reedScoreSegments"),
  extractFunction("reedScoreLabelStep"),
  extractFunction("reedScoreDateLabel"),
  extractFunction("reedScoreRowItems"),
  // 【N-5】リードタブを正典どおりにするための純関数と実寸。
  extractConst("REED_APP_SIDE_PAD_PX"),
  extractConst("REED_SIDE_PAD_PX"),
  extractConst("REED_LIST_EXTRA_PAD_PX"),
  extractConst("REED_GRID_COLS"),
  extractConst("REED_GRID_GAP_PX"),
  extractConst("REED_TILE_FS_PX"),
  extractConst("REED_HEAD_MB_PX"),
  extractConst("REED_GROUP_PAD_TOP_PX"),
  extractConst("REED_GROUP_PAD_BOTTOM_PX"),
  extractConst("REED_ADDROW_PAD_TOP_PX"),
  extractConst("REED_SUBTAB_GAP_PX"),
  extractConst("REED_SUBTAB_HALF_GAP_PX"),
  extractConst("REED_NUMROW_MIN_PX"),
  extractConst("REED_DRAG_LONGPRESS_MS"),
  extractConst("REED_DRAG_SLOP_PX"),
  // REED_BOX_SIZE は REED_ADD_COUNT_MAX の定義が参照するので**先に**並べる
  // (この配列の順序がそのまま評価順になる)。
  extractConst("REED_BOX_SIZE"),
  extractConst("REED_STRENGTHS"),
  extractConst("REED_ADD_COUNT_MIN"),
  extractConst("REED_ADD_COUNT_MAX"),
  extractConst("REED_BRAND_CUSTOM"),
  extractConst("REED_BRAND_CUSTOM_LABEL"),
  extractConst("REED_MORE_ITEMS"),
  extractConst("REED_DETAIL_METRICS"),
  extractConst("REED_COMPARE_CHART_KEYS"),
  extractFunction("reedTileTone"),
  extractFunction("gridDropIndex"),
  extractFunction("reedDetailMetaLine"),
  extractFunction("reedAddButtonLabel"),
  extractFunction("reedSheetButtonLabel"),
  extractFunction("reedSheetTitle"),
  extractFunction("clampReedAddCount"),
  // F-79b タイルの見た目(指への追従・避ける動き)。定義を参照するので定数を先に並べる
  extractConst("REED_TILE_SLIDE_EASE"),
  extractConst("REED_TILE_SETTLE_MS"),
  extractConst("REED_TILE_LIFT_PX"),
  extractConst("REED_TILE_DRAG_DEG"),
  extractFunction("reedTileVisual"),
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
  // F-79a の差し戻し: SwipePager の終わり方と track へ書く値(swipeBackThreshold を参照するので後ろ)
  extractFunction("swipePagerEndKind"),
  extractFunction("swipePagerTrackStyle"),
  extractFunction("swipePagerNextIndex"),
  // F-83: 終わりを告げたイベント → 中断か否か
  extractFunction("swipePagerInterrupted"),
  // F-88/F-90: 下から出るシートを下スワイプで閉じる(判定・書く値・行き先)
  extractFunction("sheetDismissThreshold"),
  extractFunction("sheetDismissOffset"),
  extractFunction("sheetDismissEndKind"),
  extractFunction("sheetDismissSheetStyle"),
  extractFunction("sheetDismissShouldClose"),
  extractFunction("sheetDismissInterrupted"),
  extractFunction("sheetDismissShouldCapture"),
  extractFunction("createSheetDismissGesture"),
  extractFunction("sheetScrollTopAt"),
  // F-89: 録音ボタンの中身の寸法
  extractConst("REC_BTN_D"),
  extractConst("REC_RING_SW"),
  extractConst("REC_RING_GAP"),
  extractConst("REC_STOP_PX"),
  extractConst("REC_STOP_R"),
  extractFunction("recInnerShape"),
].join("\n\n");

const api = new Function(`${code}
  return { freqToNote, centsBetween, writtenNoteLabel, parseNoteLabel, writtenMidiToSoundingFreq,
           buildFingeringTable, findClosestFingering, fftRadix2, detectPitchMPM, computeTimbreMetrics,
           frameWeight, timbreSustained, weightedMean, sanitizePitchOutliers, holdFingering,
           matchFingering, applyBandpassRBJ, concertMidiToFreq, concertFreqLabel, saxPitchBounds,
           clampMetroTempo, parseMetroSig, metroBeatGroups, metroX8BeatStarts, metroTickKind, isNearScheduledClick,
           ringPoint, ringPendDeg, ringBeatEmphasis, ringBeatIndex, ringBeatIsHead,
           metroPendT, metroArcPoint, metroDotR, metroBeatRowW, metroBeatDotX, metroBeatDotR, formatElapsedMs,
           NOTE_NAMES, NOTE_NAMES_SHARP, LOW_BB_WRITTEN_MIDI, TRANSPOSITION_SEMITONES, A4_MIDI, PITCH_CLARITY_MIN,
           TIMBRE_SUSTAIN_MS, NOTE_SWITCH_CENTS, PITCH_OUTLIER_CENTS, FINGERING_MATCH_MAX_CENTS, SAX_CONCERT_RANGE,
           METRO_TEMPO_MIN, METRO_TEMPO_MAX, RING_MAX_CENTS, RING_SWEEP_DEG, RING_IN_TUNE_CENTS,
           RING_VB, RING_CX, RING_CY, RING_R, RING_SW, ringArcD,
           srgbToLinear, linearToSrgb, rgbToOklab, oklabToRgb, oklabToOklch, oklchToOklab,
           mixOklchRGB, pitchBarColorRGB, RING_RAMP_REF, RING_RAMP_STOPS,
           ringSmoothstep, ringTuneRGB, ringRampRGB, ringGradientStops,
           RING_RUN_MS, RING_RUN_REARM_MS, RING_BREATH_MS, RING_BREATH_RISE,
           RING_GLOW_AMP, RING_GLOW_NEAR_CENTS, RING_GLOW_PEAK, RING_GLOW_EDGE_R, RING_GLOW_RISE_R,
           RING_GLOW_R_MAX, RING_GLOW_DECAY, RING_GLOW_RAMP_POW, RING_GLOW_GRAIN_LO, RING_GLOW_GRAIN_HI,
           RING_GLOW_STEPS, RING_GLOW_SEED, RING_GLOW_STOP_R0, RING_GLOW_RECT_MIN, RING_GLOW_RECT_SIZE,
           ringGlowAlphaAt, ringGlowRampAt, ringGlowStops,
           RING_GLOW_FALLOFF_STOPS, RING_GLOW_GRAINY_STOPS, RING_GLOW_SMOOTH_STOPS,
           ringRunEase, ringRunQuantP, ringRunProgress, ringBreath, ringGlowOpacity, ringGlowRGB, ringRunState,
           RING_PEND_SWING_DEG,
           METRO_ARC_W, METRO_ARC_H, METRO_ARC_P0, METRO_ARC_C, METRO_ARC_P2, METRO_ARC_SW,
           METRO_DOT_R, METRO_DOT_HEAD_SCALE, METRO_ARC_PX_PER_DEG,
           METRO_BEAT_DOT_PX, METRO_BEAT_GAP_PX, METRO_BEAT_ROW_H, METRO_PM_W, METRO_PM_H,
           METRO_SCALE, METRO_PM_FS, METRO_BPM_FS, METRO_TSIG_FS, METRO_PM_GAP,
           METRO_ARC_W_CSS, METRO_ARC_H_CSS, METRO_BEAT_ROW_H_CSS, METRO_PM_W_CSS, METRO_PM_H_CSS,
           METRO_PM_FS_CSS, METRO_BPM_FS_CSS, METRO_TSIG_FS_CSS, METRO_PM_GAP_CSS,
           RING_BEAT_EMPH_DECAY, RING_BEAT_EMPH_HEAD, RING_BEAT_EMPH_OTHER,
           RING_D_FULL,
           audioCtxRecoveryAction, isMicTrackUsable, isMicStreamUsable, shouldRecoverFromSilence,
           SILENCE_WATCHDOG_DB, SILENCE_WATCHDOG_SUSTAIN_MS, MIC_RECOVER_COOLDOWN_MS,
           MIC_RETRY_TAP_COOLDOWN_MS, AUDIO_SESSION_TYPE,
           REED_SCORE_MIN, REED_SCORE_MAX, REED_SCORE_KEYS,
           REED_RATING_STEP, REED_RATING_STEPS_N, RATING_DIAL_RATING_ORDER, RATING_DIAL_VISIBLE,
           RATING_DIAL_ORDER, RATING_DIAL_ITEM_H, REED_SCORE_PLOT_H,
           RATING_DIAL_UNRATED, RATING_DIAL_ORDER_WITH_UNRATED, RATING_DIAL_RATING_ORDER_WITH_UNRATED,
           REED_APP_SIDE_PAD_PX, REED_SIDE_PAD_PX, REED_LIST_EXTRA_PAD_PX,
           REED_GRID_COLS, REED_GRID_GAP_PX, REED_TILE_FS_PX,
           REED_HEAD_MB_PX, REED_GROUP_PAD_TOP_PX, REED_GROUP_PAD_BOTTOM_PX, REED_ADDROW_PAD_TOP_PX,
           REED_SUBTAB_GAP_PX, REED_SUBTAB_HALF_GAP_PX, REED_NUMROW_MIN_PX,
           REED_DRAG_LONGPRESS_MS, REED_DRAG_SLOP_PX,
           REED_ADD_COUNT_MIN, REED_ADD_COUNT_MAX, REED_BOX_SIZE, REED_STRENGTHS,
           REED_BRAND_CUSTOM, REED_BRAND_CUSTOM_LABEL, REED_MORE_ITEMS,
           REED_DETAIL_METRICS, REED_COMPARE_CHART_KEYS,
           reedTileTone, gridDropIndex, reedDetailMetaLine, reedAddButtonLabel, clampReedAddCount,
           reedSheetButtonLabel, reedSheetTitle, reedTileVisual,
           REED_TILE_SLIDE_EASE, REED_TILE_SETTLE_MS, REED_TILE_LIFT_PX, REED_TILE_DRAG_DEG,
           normalizeReedScore, normalizeReedRating, normalizeReedScoreOf, ratingDialOrder, reedScoreText,
           reedHistoryEntry, localDayKey, reedRatingDayKey, normalizeRatingHistory, commitReedScores,
           reedGroupAvgRating, reedGroupKey, groupReeds, reedMemberOrder,
           swipePagerEndKind, swipePagerTrackStyle, swipePagerNextIndex, swipePagerInterrupted,
           ratingDialValueAt, ratingDialOffsetFor, ratingDialScrollIsUser,
           reedScoreY, reedScoreX, reedScoreSegments, reedScoreLabelStep, reedScoreDateLabel,
           reedScoreRowItems,
           SWIPE_BACK_THRESHOLD_RATIO, SWIPE_BACK_THRESHOLD_MIN, SWIPE_AXIS_LOCK_PX, SWIPE_DEAD_END_RESIST,
           SWIPE_VERTICAL_BIAS,
           SWIPE_BACK_EASE, SWIPE_BACK_SETTLE_MS,
           swipeBackThreshold, swipeAxisIsHorizontal, swipeBackOffset, swipeBackDecision, swipeBackHandler,
           createSwipeBackGesture,
           sheetDismissThreshold, sheetDismissOffset, sheetDismissEndKind, sheetDismissSheetStyle,
           sheetDismissShouldClose, sheetDismissInterrupted, sheetDismissShouldCapture,
           createSheetDismissGesture, sheetScrollTopAt,
           REC_BTN_D, REC_RING_SW, REC_RING_GAP, REC_STOP_PX, REC_STOP_R, recInnerShape };`)();

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

  // 【N-4b で置き換えた検査】以前ここは「錘は全位相で上半円 / 拍の点は全拍子で下半円」
  // = 環の中で上下に分けることを主張していた。正典(design/north-star-measure.html)は
  // 拍を**環の外・下**に出したので、主張を「環の中に無い」+「弧の上を動く」へ置き換える。
  // 弱めていない: 以前は"環の中のどこか"を許していたが、いまは環の中に1つも許さない。
  {
    // 点は必ずガイドの弧そのものの上にいる(x は左端〜右端の間、y は弧の式と一致)。
    let outside = 0, offCurve = 0, minX = Infinity, maxX = -Infinity;
    for (let p = 0; p <= 8; p += 0.001) {
      const t = api.metroPendT(api.ringPendDeg(p));
      const [x, y] = api.metroArcPoint(t);
      if (x < api.METRO_ARC_P0[0] - 1e-9 || x > api.METRO_ARC_P2[0] + 1e-9) outside++;
      // 弧の式(2次ベジエ)を独立に組み立てて突き合わせる(実装の返り値を言い換えない)
      const u = 1 - t;
      const ey = u * u * api.METRO_ARC_P0[1] + 2 * u * t * api.METRO_ARC_C[1] + t * t * api.METRO_ARC_P2[1];
      if (Math.abs(y - ey) > 1e-9) offCurve++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    }
    check("往復する点はガイドの弧の内側だけを動く(端をはみ出さない)", outside === 0, `はみ出し ${outside} 回`);
    check("点の y はガイドの弧の式そのもの(弧から浮かない)", offCurve === 0, `ずれ ${offCurve} 回`);
    check("点は弧の左端から右端まで使い切る",
      Math.abs(minX - api.METRO_ARC_P0[0]) < 1e-9 && Math.abs(maxX - api.METRO_ARC_P2[0]) < 1e-9,
      `x ${minX.toFixed(3)}〜${maxX.toFixed(3)} / 弧 ${api.METRO_ARC_P0[0]}〜${api.METRO_ARC_P2[0]}`);
    // 拍の瞬間(位相が整数)にちょうど端にいる = 「点が往復し端で拍」
    check("拍の瞬間に点が弧の端にいる(0拍=右端 / 1拍=左端)",
      Math.abs(api.metroArcPoint(api.metroPendT(api.ringPendDeg(0)))[0] - api.METRO_ARC_P2[0]) < 1e-9
      && Math.abs(api.metroArcPoint(api.metroPendT(api.ringPendDeg(1)))[0] - api.METRO_ARC_P0[0]) < 1e-9);
    // 停止中(角度0)は弧の中央。戻りは角度が0へ減衰するので、中央へ戻ることと同義。
    check("停止中は弧の中央に止まる", Math.abs(api.metroPendT(0) - 0.5) < 1e-12);
    // 弧は「浅い」= 制御点が高さの中にあり、たわみが弧の横幅よりずっと小さい。
    // 数字を言い換えないよう、たわみは metroArcPoint の実測(中央の y − 端の y)で取る。
    {
      const sag = api.metroArcPoint(0.5)[1] - api.METRO_ARC_P0[1];
      const span = api.METRO_ARC_P2[0] - api.METRO_ARC_P0[0];
      check("ガイドは浅い弧(たわみが横幅の1/8未満)", sag > 0 && sag < span / 8,
        `たわみ ${sag.toFixed(2)} / 横幅 ${span}`);
    }
  }

  // 拍の●列: 数が拍子と一致し、左から右へ等間隔、列の中心が列幅の中心。
  for (const n of [1, 2, 3, 4, 6]) {
    const w = api.metroBeatRowW(n);
    const xs = Array.from({ length: n }, (_, i) => api.metroBeatDotX(i, n));
    let ascending = true;
    for (let i = 1; i < n; i++) if (!(xs[i] > xs[i - 1])) ascending = false;
    // 間隔が全部同じ(等間隔)
    let evenGap = true;
    for (let i = 2; i < n; i++) if (Math.abs((xs[i] - xs[i - 1]) - (xs[1] - xs[0])) > 1e-9) evenGap = false;
    // 列の重心が列幅のちょうど中央 = 行の中央に置けば画面中央に来る
    const centered = Math.abs(((xs[0] + xs[n - 1]) / 2) - w / 2) < 1e-9;
    // 端の●が列の外へ出ない(左端の中心 − 半径 >= 0、右端の中心 + 半径 <= 幅)
    const rMax = api.metroBeatDotR(true);
    const inside = xs[0] - api.METRO_BEAT_DOT_PX / 2 >= -1e-9 && xs[n - 1] + api.METRO_BEAT_DOT_PX / 2 <= w + 1e-9;
    check(`拍の●(${n}拍): 左から右へ等間隔で並び、列の中心が列幅の中心`,
      ascending && evenGap && centered && inside,
      `xs=${xs.map((v) => v.toFixed(1)).join(",")} / w=${w} / 最大r=${rMax}`);
  }
  check("1拍のときは●が1つだけで幅は●の直径", api.metroBeatRowW(1) === api.METRO_BEAT_DOT_PX);

  // 現在の拍だけが大きい。位置は動かさない(●の x は拍に依存しない)。
  for (const n of [2, 3, 4, 6]) {
    let ok = true, detail = "";
    for (let beat = 0; beat < 2 * n; beat++) {
      const phase = beat + 0.3;
      const cur = api.ringBeatIndex(phase, n);
      if (cur !== beat % n) { ok = false; detail = `index ${cur}!=${beat % n}`; break; }
      const rs = Array.from({ length: n }, (_, i) => api.metroBeatDotR(cur === i));
      const others = rs.filter((_, i) => i !== cur);
      if (!others.every((r) => r === api.METRO_BEAT_DOT_PX / 2)) { ok = false; detail = "現在以外の●が既定の大きさでない"; break; }
      if (!others.every((r) => rs[cur] > r)) { ok = false; detail = `現在の●が大きくない ${rs.join(",")}`; break; }
    }
    check(`拍の●(${n}拍): 現在の拍だけが大きく、位置は変わらない`, ok, detail);
  }
  check("6/8は主拍2つ(拍子パースと●の数が一致)", api.metroBeatGroups(6).length === 2);

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
  // 点の移動(位相→角度→弧の上の位置)と●の切り替え(現在の拍)は e に依存しないので残る。
  {
    const movedX = new Set();
    for (let p = 0; p <= 2; p += 0.1) movedX.add(api.metroArcPoint(api.metroPendT(api.ringPendDeg(p)))[0].toFixed(3));
    const idx = [0, 1, 2, 3].map((b) => api.ringBeatIndex(b + 0.3, 4)).join(",");
    const curR = api.metroBeatDotR(true), otherR = api.metroBeatDotR(false);
    check("減速設定でも点は動き、●の切り替えも続く(止まるのは膨らみだけ)",
      movedX.size > 10 && idx === "0,1,2,3" && curR > otherR
      && api.metroDotR(true, 0) === api.METRO_DOT_R && api.metroDotR(false, 0) === api.METRO_DOT_R,
      `位置の種類=${movedX.size} / 拍=${idx} / 現在r=${curR} 他r=${otherR}`);
  }

  // 往復する点の膨らみ: **小節頭だけ**が膨らむ(本人指示「1拍目は点が大きくなる」)。
  // 上限は正典の scale(1.4)。小節頭以外は演出量に関わらず既定の大きさのまま。
  {
    let headGrew = false, otherGrew = false, over = false;
    for (const beats of [2, 3, 4, 6]) {
      for (let p = 0; p <= 2 * beats; p += 0.01) {
        const e = api.ringBeatEmphasis(p, beats, true);
        const isHead = api.ringBeatIsHead(p, beats, true);
        const r = api.metroDotR(isHead, e);
        if (r > api.METRO_DOT_R + 1e-12) { if (isHead) headGrew = true; else otherGrew = true; }
        if (r > api.METRO_DOT_R * api.METRO_DOT_HEAD_SCALE + 1e-9) over = true;
      }
    }
    check("往復する点は小節頭でだけ膨らむ(それ以外の拍では既定の大きさ)", headGrew && !otherGrew);
    check("膨らみの上限は正典の倍率(scale 1.4)を超えない", !over);
    // アクセントOFF なら小節頭も膨らまない(鳴っていないものを見せない)。
    let anyGrewOff = false;
    for (let p = 0; p <= 8; p += 0.01) {
      if (api.metroDotR(api.ringBeatIsHead(p, 4, false), api.ringBeatEmphasis(p, 4, false)) > api.METRO_DOT_R + 1e-12) anyGrewOff = true;
    }
    check("小節アクセントOFF なら点は膨らまない", !anyGrewOff);
  }

  // ------------------------------------------------------------------
  // 【N-4b で置き換えた検査】以前ここには「環の帯(ピッチ)と拍の要素(錘・点)が
  // 実寸で 6 CSS px 以上離れている」という2本のクリアランス検査があった。
  // 拍を環の外へ出したので、**環の中に拍の要素が1つも無い**という、
  // 距離ではなく有無の主張に置き換える(距離の要件より強い)。
  // 実際の JSX を見る検査は下の「検証19」側(PitchRing の SVG の走査)に置いてある。
  // ここでは「環の中で拍を描くための定数・関数が1つも残っていない」ことを見る。
  // codeOf でコメントを外してから見る(経緯をコメントに書いた瞬間に落ちないようにする)。
  // ------------------------------------------------------------------
  {
    const c = codeOf(src);
    const gone = ["RING_PEND_R", "RING_PEND_BOB_R", "RING_PEND_BOB_GROW", "RING_PEND_HALO_GAP",
      "RING_PEND_HALO_SW", "RING_PEND_HALO_OPACITY", "RING_BEAT_DOT_ORBIT_R", "RING_BEAT_DOT_SPREAD_DEG",
      "RING_BEAT_DOT_R", "RING_BEAT_DOT_CUR_R", "RING_BEAT_DOT_HEAD_R", "RING_MARKER_MIN_GAP_PX"];
    const left = gone.filter((k) => new RegExp(`\\b${k}\\b`).test(c));
    check("環の中に拍を描くための定数が1つも残っていない(環はピッチ専用)", left.length === 0, left.join(" "));
    check("環の中に拍を描くための関数(ringBeatDotDeg / ringBeatDotR)が残っていない",
      !/function ringBeatDotDeg/.test(c) && !/function ringBeatDotR/.test(c));
  }

  // 【N-4b で反転した検査】以前は「振り子の軌道にガイド線を描かない」だった。
  // 確定版の正典(design/north-star-measure.html)は**浅い弧のガイドを1本描く**。
  // 錘(直径30px超の円)を細い点に落としたぶん、点だけでは往復の道筋が読めないため。
  // 主張を反転させたので、**ガイドが実際に描かれていること**を見る。
  {
    const c = codeOf(src);
    const i = c.indexOf("function MetroPendulum");
    const body = i === -1 ? "" : c.slice(i, c.indexOf("function MeasureView", i));
    check("振り子のガイドの弧を描いている(正典の浅い弧1本)", /<path[\s\S]{0,400}?METRO_ARC_C\[0\]/.test(body), body ? "" : "MetroPendulum が見つからない");
    check("ガイドの弧の制御点は METRO_ARC_* から引く(座標の直書きが無い)",
      /METRO_ARC_P0\[0\]\} \$\{METRO_ARC_P0\[1\]\} Q\$\{METRO_ARC_C\[0\]\} \$\{METRO_ARC_C\[1\]\} \$\{METRO_ARC_P2\[0\]\} \$\{METRO_ARC_P2\[1\]\}/.test(body));
    check("往復する点の位置は metroArcPoint(metroPendT(角度)) から引く",
      /metroArcPoint\(metroPendT\(pendDeg\)\)/.test(body));
    check("動作中の角度は ringPendDeg(位相)そのもの(戻りの実装が動作中の角度を書き換えていない)",
      /pendDeg = ringPendDeg\(phase\);/.test(body));
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
    // rAF が書き換えるのは帯側では offset と stop-color だけ。
    // 【F-47で変わった】光は radialGradient のストップではなく <g> の opacity で明暗を作るので、
    // rAF が stop-opacity を書く箇所は**0箇所**になった(走りの帯に透明度が入ると根元から
    // 下地が透けるので、ここに1箇所でも現れたら不具合)。
    check("rAF は stop-opacity を1箇所も書かない(光は <g> の opacity で作る)",
      (ringCode.match(/setAttribute\("stop-opacity"/g) || []).length === 0,
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
    // 【N-4b】環は**ピッチ専用**になった(拍は環の外・下の MetroPendulum が描く)。
    // 以前ここは「拍の要素は getBeatPhase が渡されたときだけ描く」だった。
    // 主張を「環の中に拍の描画が1つも無い」へ**強めて**置き換える。
    check("環の SVG に拍の要素が1つも無い(環はピッチ専用)",
      !/getBeatPhase|beatDot|BEAT_DOT|PEND|metroArcPoint|metroBeatDot/.test(ringCode),
      (ringCode.match(/getBeatPhase|beatDot|BEAT_DOT|PEND|metroArcPoint|metroBeatDot/g) || []).join(" "));
    check("PitchRing が受け取るのは音・セント・直径だけ(拍の口が残っていない)",
      /function PitchRing\(\{ note, centsOffset, diameter = RING_D_FULL \}\)/.test(ringCode),
      (ringCode.match(/function PitchRing\([^)]*\)/) || [""])[0]);
    // (c) 半径。役割ごとに違う半径を使い分けているので、取り違えると二役が崩れる。
    // 【N-4a】環のトラック(常時全周の円)は撤去した。本人指示「チューナーの円環の枠は要らない」。
    // 帯は必ず12時から伸びるので軌道は帯自身が示す(DESIGN-SYSTEM §6.0)。
    // **復活させないこと**を見る。svg は codeOf を通した ringCode 由来なので、
    // 経緯をコメントに書いても落ちない(綴りの不在を見る検査の作法)。
    check("環のトラック(全周の円)を復活させていない",
      !/<circle[^>]*r=\{R\}[^>]*strokeWidth=\{SW\}/.test(flat), flat.match(/<circle[^>]*\/>/g)?.join(" | ") || "circle無し");
    // 【N-4b】環の中に <circle> が1つも無い(帯・走り・光はすべて <path>/<rect>)。
    // 拍の点も錘も輪も出て行ったので、環に丸い物は残らない。
    check("環の SVG に <circle> が1つも無い(拍の丸が出て行った)",
      !/<circle[\s/>]/.test(flat), (flat.match(/<circle[^>]*\/>/g) || []).join(" | ") || "circle無し");
    // (d) 線幅。SW 以外を混ぜると帯と走りの太さが揃わない。
    check("SW で描く path は帯と走りの2本だけで、太さはどちらも SW ちょうど", (() => {
      const paths = flat.match(/<path[\s\S]*?\/>/g) || [];
      const sw = paths.filter((t) => /strokeWidth=\{SW\}/.test(t));
      const other = paths.filter((t) => /strokeWidth=/.test(t) && !/strokeWidth=\{SW\}/.test(t));
      return sw.length === 2 && other.length === 0;
    })(), (flat.match(/<path[\s\S]*?\/>/g) || []).map((t) => (/strokeWidth=\{[^}]*\}/.exec(t) || ["(線幅なし)"])[0]).join(" | "));
    // (e) 重ね順。光は一番奥、拍は一番手前。入れ替えると光が帯を覆う/拍が帯に隠れる。
    // 【N-4a】トラックを撤去したので重ね順から外した。残る4つの相対順は不変。
    check("重ね順は 光 → 走り → ズレの帯", (() => {
      const order = [
        flat.indexOf("<g ref={glowGroupRef} mask={`url(#${glowFalloffId}-m)`}"),
        flat.indexOf('d="" fill="none" stroke={`url(#${gid})`}'),
        flat.indexOf("<path d={arcD}"),
      ];
      return order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]));
    })());
    // 12時の基準マーカー(紺の縦線)は本人指示で撤去した。帯の根元そのものが0¢を示すので、
    // 印を別に置く理由が無い。**復活させないこと**を綴りではなく要素の有無で見る。
    // `<line` は `<linearGradient` の接頭辞でもあるので境界を付ける(最初これで空振りした)
    check("12時の基準マーカーを復活させていない(環に <line> は無い)",
      !/<line[\s/>]/.test(flat),
      (flat.match(/<line[\s/>][\s\S]{0,60}/g) || []).join(" | ") || "");
  }
  // 【N-4a】「これまでの音」の ±10¢ 良好ゾーンの帯を撤去した。
  // 本人判定「真ん中の緑の帯は役目を果たしていない」。残すのは 0¢ の基準線と音名ラベルだけ。
  // **復活させないこと**を、綴りではなく「描かれる要素」で見る(codeOf 済みなので経緯の
  // コメントを書いても落ちない)。0¢ の基準線と音名ラベルが**消えていないこと**も同時に縛る
  // ―― 片方だけを見ると「全部消した」変異が通ってしまう。
  {
    // 【抽出の注意】extractFunction は `function 名(` の直後の `{` から波括弧を数えるので、
    // **引数が分割代入の関数では引数の `{...}` を本体と誤認する**（PitchDeviationLine は
    // `({ frames, quiet = false })` なので 53文字しか取れなかった）。ここは次の
    // トップレベル `function ` までを切り出す。
    const devStart = src.indexOf("function PitchDeviationLine(");
    const devEnd = src.indexOf("\nfunction ", devStart + 1);
    const devSrc = codeOf(src.slice(devStart, devEnd === -1 ? undefined : devEnd)).replace(/\s*\n\s*/g, " ");
    check("PitchDeviationLine を走査できている(分割代入の引数で空振りしていない)",
      devSrc.length > 1000 && /<svg/.test(devSrc), `${devSrc.length}文字`);
    // 【綴りで見ない】最初 `goodTop|goodBottom` という**変数名**で見ていたが、
    // 変異試験で「同じ帯を y(10)/y(-10) 直書きで復活させる」変異が**素通しした**。
    // 見るべきは描かれる要素そのもの: このミニタイムラインの svg に <rect> は1つも無い
    // (帯が唯一の rect だった。0¢線は <line>、折れ線は <polyline>、音名は HTML の span)。
    check("ゾーン帯を復活させていない(ミニタイムラインの svg に <rect> が無い)",
      !/<rect[\s/>]/.test(devSrc),
      (devSrc.match(/<rect[\s\S]{0,80}/g) || []).join(" | ") || "rect無し");
    check("0¢ の基準線は残っている",
      /<line x1="0" y1=\{H \/ 2\} x2=\{W\} y2=\{H \/ 2\}/.test(devSrc));
    check("音名ラベルの重ね描きは残っている",
      /labels\.map\(/.test(devSrc) && /\{l\.name\}/.test(devSrc));
    check("折れ線そのものは残っている", /<polyline/.test(devSrc));
  }
  // (f) 到達の判定は1箇所だけ。rAF に渡す値を別式にすり替える変異が通っていた。
  // 【F-47で1→2箇所になった】光は ±RING_GLOW_NEAR_CENTS までの帯も出すので、|¢| そのものを
  // rAF へ渡す必要がある。ただし**閾値との比較は依然として1箇所だけ**で、増えたのは
  // 「音が無ければ NaN」を付けた生の |¢| の受け渡しだけ。段の切り分けは ringGlowOpacity の中。
  check("閾値と比較する到達の判定は ringCode 内で1箇所だけ(閾値の二重定義が無い)",
    (ringCode.match(/Math\.abs\(exact\) <=/g) || []).length === 1,
    `Math.abs(exact) <= が ${(ringCode.match(/Math\.abs\(exact\) <=/g) || []).length}箇所`);
  check("rAF に渡す到達判定は const inTune をそのまま渡す(別式に置き換えない)",
    /liveRef\.current = \{ inTune, base: \[r, g, b\], glowCents: sounding \? Math\.abs\(exact\) : NaN \};/.test(ringCode));
  check("光の段の切り分けは rAF の中ではなく純関数 ringGlowOpacity に閉じている",
    !/RING_GLOW_NEAR_CENTS/.test(ringCode)
    && /return RING_GLOW_AMP \* \(\(RING_GLOW_NEAR_CENTS - ac\) \/ \(RING_GLOW_NEAR_CENTS - RING_IN_TUNE_CENTS\)\);/
      .test(extractFunction("ringGlowOpacity")));

  // ------------------------------------------------------------------
  // C. 合格判定は ±2¢(F-47 で本人指示により 1 → 2)。
  // ------------------------------------------------------------------
  check("RING_IN_TUNE_CENTS は 2", api.RING_IN_TUNE_CENTS === 2, String(api.RING_IN_TUNE_CENTS));
  check("判定に使う定数は RING_IN_TUNE_CENTS だけ(閾値の直書きが無い)",
    /const inTune = sounding && Math\.abs\(exact\) <= RING_IN_TUNE_CENTS;/.test(ringCode));
  // ±2¢ の帯は線幅より短いので、到達中に帯を消しても「消えた」ようには見えない。
  // (帯を消す条件が inTune なので、閾値を広げすぎると消える帯が目に付くようになる)
  check("±RING_IN_TUNE_CENTS の帯の弧長は線幅より短い", (() => {
    const degAt = (api.RING_IN_TUNE_CENTS / api.RING_MAX_CENTS) * api.RING_SWEEP_DEG;
    const arc = (degAt * Math.PI / 180) * api.RING_R;
    return arc < api.RING_SW;
  })(), (() => {
    const degAt = (api.RING_IN_TUNE_CENTS / api.RING_MAX_CENTS) * api.RING_SWEEP_DEG;
    return `弧長 ${((degAt * Math.PI / 180) * api.RING_R).toFixed(2)} vs 線幅 ${api.RING_SW}`;
  })());

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
  check("合ったときの光の不透明度 = AMP × 線形進捗 × (0.34 + 0.66×呼吸)", (() => {
    for (const raw of [0, 0.25, 0.5, 1]) {
      for (const br of [0, 0.5, 1]) {
        const want = api.RING_GLOW_AMP * raw * (0.34 + 0.66 * br);
        for (const ac of [0, 0.5, api.RING_IN_TUNE_CENTS]) {
          if (Math.abs(api.ringGlowOpacity(raw, br, ac) - want) > 1e-12) return false;
        }
      }
    }
    return true;
  })());
  check("走りが始まる前は光が出ていない", api.ringGlowOpacity(0, 1, 0) === 0);
  check("光は走りに合わせて立ち上がる(線形進捗に比例)",
    api.ringGlowOpacity(0.5, 1, 0) > 0 && api.ringGlowOpacity(0.5, 1, 0) < api.ringGlowOpacity(1, 1, 0));
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
  // ------------------------------------------------------------------
  // D-3b. 外周の光の**形**(F-47。試作 public/ring-proto.html 案③ の移植)。
  //
  // ここで守るのは3つ:
  //   (1) 光の最大は環のトラックの外縁にある(立ち上がりが外へはみ出すと、環と光の間に
  //       細い明るい線が見える。試作の初期版で本人が指摘した不具合)
  //   (2) 終端で値も傾きも0(折れると「グラデーションの終わり」が縁として見える)
  //   (3) 環の内側は完全に透明のまま(音名の可読性。DESIGN-SYSTEM §6.1)
  // 【定数の言い換えにしない】判定の基準はすべて環そのものの寸法(RING_R / RING_SW)から
  // 独立に組み立て、光の関数を数値で走査して突き合わせる。
  // ------------------------------------------------------------------
  {
    const TRACK_IN = api.RING_R - api.RING_SW / 2;    // 環のトラックの内縁 = 129
    const TRACK_OUT = api.RING_R + api.RING_SW / 2;   // 環のトラックの外縁 = 143
    // (1) 最大の位置。0.01 刻みで走査して山を探す(定数を読み替えるのではなく波形から探す)。
    const scanMax = (() => {
      let best = -1, bestR = -1;
      for (let r = 0; r <= api.RING_GLOW_R_MAX + 20; r = Math.round((r + 0.01) * 100) / 100) {
        const v = api.ringGlowAlphaAt(r);
        if (v > best) { best = v; bestR = r; }
      }
      return { best, bestR };
    })();
    check("光の最大は環のトラックの外縁ちょうどにある(環と光の間に明るい線を作らない)",
      Math.abs(scanMax.bestR - TRACK_OUT) < 0.02,
      `山 r=${scanMax.bestR} / トラック外縁 ${TRACK_OUT}`);
    check("外縁での明るさは本人選定の peak(案③ = 0.66)",
      Math.abs(scanMax.best - 0.66) < 1e-9 && api.RING_GLOW_PEAK === 0.66,
      `${scanMax.best.toFixed(4)}`);
    // (3) 内側は完全に透明。トラックの内縁まで 0 でないと音名の領域に光が乗る。
    check("環のトラックの内縁より内側は光が完全に0(音名の可読性)", (() => {
      for (let r = 0; r <= TRACK_IN; r += 0.25) if (api.ringGlowAlphaAt(r) !== 0) return false;
      return true;
    })(), `内縁 ${TRACK_IN} での値 ${api.ringGlowAlphaAt(TRACK_IN)}`);
    check("立ち上がりはトラックの内縁と外縁の間に収まる(＝トラックの下に完全に隠れる)",
      api.RING_GLOW_RISE_R > TRACK_IN && api.RING_GLOW_RISE_R < TRACK_OUT,
      `立ち上がり開始 ${api.RING_GLOW_RISE_R} (トラック ${TRACK_IN}〜${TRACK_OUT})`);
    // (2) 終端。値が0で、しかも傾きも0(裾が折れない)。
    check("光は届く半径 RING_GLOW_R_MAX で完全に0になり、その外にも出ない", (() => {
      for (let r = api.RING_GLOW_R_MAX; r <= api.RING_GLOW_R_MAX + 40; r += 0.5) {
        if (api.ringGlowAlphaAt(r) !== 0) return false;
      }
      return true;
    })(), `rMax=${api.RING_GLOW_R_MAX}`);
    check("外縁より外では単調に減る(途中に山や谷を作らない)", (() => {
      let prev = Infinity;
      for (let r = TRACK_OUT; r <= api.RING_GLOW_R_MAX; r += 0.1) {
        const v = api.ringGlowAlphaAt(r);
        if (v > prev + 1e-12) return false;
        prev = v;
      }
      return true;
    })());
    check("終端では傾きも0になる(直線で切ると縁として見える)", (() => {
      const h = 0.05;
      const slopeAt = (r) => Math.abs(api.ringGlowAlphaAt(r + h) - api.ringGlowAlphaAt(r - h)) / (2 * h);
      const near = slopeAt(api.RING_GLOW_R_MAX - 0.5);
      const start = slopeAt(TRACK_OUT + 1);
      return start > 0 && near < start * 0.01;
    })(), (() => {
      const h = 0.05;
      const slopeAt = (r) => Math.abs(api.ringGlowAlphaAt(r + h) - api.ringGlowAlphaAt(r - h)) / (2 * h);
      return `終端 ${slopeAt(api.RING_GLOW_R_MAX - 0.5).toExponential(2)} / 立ち上がり直後 ${slopeAt(TRACK_OUT + 1).toExponential(2)}`;
    })());
    // 傾斜(外ほど粒に分解する割合)。外縁で0・届く端で1・単調増加・べき1.8なので直線より下。
    check("粒の傾斜は外縁で0・rMaxで1・単調増加",
      api.ringGlowRampAt(TRACK_OUT) === 0 && Math.abs(api.ringGlowRampAt(api.RING_GLOW_R_MAX) - 1) < 1e-12
      && (() => {
        let prev = -1;
        for (let r = TRACK_OUT; r <= api.RING_GLOW_R_MAX; r += 0.1) {
          const v = api.ringGlowRampAt(r); if (v < prev - 1e-12) return false; prev = v;
        }
        return true;
      })());
    check("粒は内側ほど効かない(傾斜は直線より下に凸)", (() => {
      const mid = (TRACK_OUT + api.RING_GLOW_R_MAX) / 2;
      return api.ringGlowRampAt(mid) < 0.5 - 0.05 && api.RING_GLOW_RAMP_POW > 1;
    })(), `中点の傾斜 ${api.ringGlowRampAt((TRACK_OUT + api.RING_GLOW_R_MAX) / 2).toFixed(4)}`);
    // 44段のストップが上の関数をきちんと近似しているか。直線2〜3本だと折れ目が見える。
    const interp = (stops, r) => {
      const off = r / api.RING_GLOW_R_MAX;
      if (off <= stops[0].offset) return stops[0].value;
      for (let i = 1; i < stops.length; i++) {
        if (off <= stops[i].offset) {
          const k = (off - stops[i - 1].offset) / (stops[i].offset - stops[i - 1].offset);
          return stops[i - 1].value + (stops[i].value - stops[i - 1].value) * k;
        }
      }
      return stops[stops.length - 1].value;
    };
    check("減衰のストップは RING_GLOW_STEPS+1 段(直線近似ではない)",
      api.RING_GLOW_FALLOFF_STOPS.length === api.RING_GLOW_STEPS + 1 && api.RING_GLOW_STEPS >= 30,
      `${api.RING_GLOW_FALLOFF_STOPS.length}段`);
    check("ストップの offset は 0〜1 で非減少", (() => {
      let prev = -1;
      for (const st of api.RING_GLOW_FALLOFF_STOPS) {
        if (!(st.offset >= 0 && st.offset <= 1)) return false;
        if (st.offset < prev - 1e-12) return false;
        prev = st.offset;
      }
      return true;
    })());
    check("ストップの刻み始めはトラックの下(＝内側は必ず0から始まる)",
      api.RING_GLOW_STOP_R0 <= api.RING_GLOW_RISE_R && api.RING_GLOW_FALLOFF_STOPS[0].value === 0,
      `刻み始め r=${api.RING_GLOW_STOP_R0}`);
    check("44段の近似は元の減衰カーブから peak の1.5%以上ずれない", (() => {
      let worst = 0;
      for (let r = api.RING_GLOW_STOP_R0; r <= api.RING_GLOW_R_MAX; r += 0.1) {
        worst = Math.max(worst, Math.abs(interp(api.RING_GLOW_FALLOFF_STOPS, r) - api.ringGlowAlphaAt(r)));
      }
      return worst < api.RING_GLOW_PEAK * 0.015;
    })(), (() => {
      let worst = 0;
      for (let r = api.RING_GLOW_STOP_R0; r <= api.RING_GLOW_R_MAX; r += 0.1) {
        worst = Math.max(worst, Math.abs(interp(api.RING_GLOW_FALLOFF_STOPS, r) - api.ringGlowAlphaAt(r)));
      }
      return `最大差 ${worst.toFixed(4)} (peak ${api.RING_GLOW_PEAK})`;
    })());
    check("実際に描かれる(ストップ補間後の)明るさも外縁でほぼ peak", (() => {
      const v = interp(api.RING_GLOW_FALLOFF_STOPS, TRACK_OUT);
      return v > api.RING_GLOW_PEAK * 0.97;
    })(), `外縁での補間値 ${interp(api.RING_GLOW_FALLOFF_STOPS, TRACK_OUT).toFixed(4)}`);
    check("内側と外側の傾斜マスクは足して1になる(掛け算で光が二重に濃くならない)", (() => {
      for (let i = 0; i < api.RING_GLOW_SMOOTH_STOPS.length; i++) {
        const s = api.RING_GLOW_SMOOTH_STOPS[i], g = api.RING_GLOW_GRAINY_STOPS[i];
        if (Math.abs(s.offset - g.offset) > 1e-12) return false;
        if (Math.abs(s.value + g.value - 1) > 1e-12) return false;
      }
      return true;
    })());
    // 実寸(CSS px)。光は環の外へ出るので SVG の overflow を切ってはいけない。
    {
      const px = (v) => v * (api.RING_D_FULL / api.RING_VB);
      const outPx = px(api.RING_GLOW_R_MAX) - api.RING_D_FULL / 2;
      console.log(`  外周の光(実寸 330px環): 外縁 ${px(TRACK_OUT).toFixed(1)}px → 届く端 ${px(api.RING_GLOW_R_MAX).toFixed(1)}px`
        + ` (環の箱から ${outPx.toFixed(1)}px はみ出す) / 外縁での明るさ ${api.RING_GLOW_PEAK}`);
      check("光は環の viewBox(半径 VB/2)より外まで届く＝SVG は overflow を切ってはいけない",
        api.RING_GLOW_R_MAX > api.RING_VB / 2,
        `rMax=${api.RING_GLOW_R_MAX} vs VB/2=${api.RING_VB / 2}`);
      // viewBox の枠で切られると、切り口でまだ残っている明るさがそのまま四角い縁になる。
      check("viewBox の枠で切ると縁が見える明るさが残っている(overflow:visible が必要な理由)",
        api.ringGlowAlphaAt(api.RING_VB / 2) > 0.1,
        `r=${api.RING_VB / 2} での明るさ ${api.ringGlowAlphaAt(api.RING_VB / 2).toFixed(4)}`);
      // 【審査で差し戻し】以前は overflow と pointerEvents を**別々の正規表現**で
      // PitchRing 全体に当てていた。しかし PitchRing には音名を重ねる div にも
      // pointerEvents:"none" があり(F-47 以前からの無関係な記述)、**svg 側から
      // pointerEvents だけを消しても検査が通ってしまった**(審査役が変異試験で実証)。
      // 実際の綴りどおり「同じ style の中で隣り合っている」ことを1本で要求する。
      // これなら片方だけ消しても落ちる。
      check("光を出す SVG は overflow:visible かつ当たり判定を持たない(同じ style に隣接)",
        /overflow: "visible", pointerEvents: "none"/.test(ringCode),
        ringCode.slice(ringCode.indexOf("<svg"), ringCode.indexOf("<svg") + 220).replace(/\s+/g, " "));
      // 光を塗る矩形は、届く範囲を完全に覆っていること(足りないと矩形の辺が縁になる)。
      check("光を塗る矩形は届く範囲(半径 rMax)を完全に覆う",
        api.RING_GLOW_RECT_MIN <= api.RING_CX - api.RING_GLOW_R_MAX
        && api.RING_GLOW_RECT_MIN + api.RING_GLOW_RECT_SIZE >= api.RING_CX + api.RING_GLOW_R_MAX,
        `矩形 ${api.RING_GLOW_RECT_MIN}〜${api.RING_GLOW_RECT_MIN + api.RING_GLOW_RECT_SIZE} / 必要 ${api.RING_CX - api.RING_GLOW_R_MAX}〜${api.RING_CX + api.RING_GLOW_R_MAX}`);
    }
  }

  // ------------------------------------------------------------------
  // D-3c. 外周の光の**構成**。ブレンドモードを使わず、マスクの入れ子だけで作る。
  //
  // 【なぜ縛るか】試作の初版は粒をマスクの中で mix-blend-mode:multiply で重ねており、
  // その指定がマスク内で効かない環境ではノイズが全面に加算されて**画面全体が緑になった**
  // (本人報告)。同じ作りに戻さないことを、綴りの不在と入れ子の形の両方で固定する。
  // ------------------------------------------------------------------
  {
    const flatRing = ringCode.replace(/\s*\n\s*/g, " ");
    check("環のコードに mix-blend-mode / mixBlendMode が1文字も無い",
      !/mixBlendMode|mix-blend-mode/.test(ringCode),
      (ringCode.match(/mixBlendMode|mix-blend-mode/g) || []).join(",") || "");
    check("環のコードに blend / isolation の指定が無い",
      !/style=\{\{[^}]*blend/i.test(ringCode) && !/isolation/i.test(ringCode));
    // 入れ子の形そのもの。いちばん外が減衰マスクで、内側が (1-傾斜) / 傾斜×粒 の2枚。
    check("光は「減衰マスク」の <g> がいちばん外にある(ここが0なら何も描かれない)",
      /<g ref=\{glowGroupRef\} mask=\{`url\(#\$\{glowFalloffId\}-m\)`\} opacity="0">/.test(flatRing));
    check("内側は 減衰 × (1-傾斜) の滑らかな光",
      /<g mask=\{`url\(#\$\{glowSmoothId\}-m\)`\}> <rect/.test(flatRing));
    check("外側は 減衰 × 傾斜 × 粒 の入れ子(掛け算で粒に分解する)",
      /<g mask=\{`url\(#\$\{glowGrainyId\}-m\)`\}> <g mask=\{`url\(#\$\{glowNoiseId\}-m\)`\}> <rect/.test(flatRing));
    // 【N-4a】終端の目印だったトラックを撤去したので、次の兄弟=走り(runGradIds の path)を
    // 境界に使う。主張は変えていない: 2枚の光がどちらも減衰マスクの <g> の内側で閉じていること。
    check("光の <g> は減衰マスクの中で閉じる(2枚の光がどちらも減衰の内側にある)", (() => {
      const open = flatRing.indexOf('<g ref={glowGroupRef}');
      const smooth = flatRing.indexOf('<g mask={`url(#${glowSmoothId}-m)`}>');
      const grainy = flatRing.indexOf('<g mask={`url(#${glowGrainyId}-m)`}>');
      const afterGlow = flatRing.indexOf('d="" fill="none" stroke={`url(#${gid})`}');
      return open >= 0 && smooth > open && grainy > smooth && afterGlow > grainy;
    })());
    // 粒そのもの。fractalNoise / 彩度0 / 明るさの幅 / **alpha は不透明に固定**。
    const filt = (ringCode.match(/<filter[\s\S]*?<\/filter>/g) || []);
    check("粒のフィルタは1つだけ", filt.length === 1, `${filt.length}個`);
    const f0 = (filt[0] || "").replace(/\s*\n\s*/g, " ");
    check("粒は fractalNoise(baseFrequency 0.9 / numOctaves 2 / stitch)",
      /<feTurbulence type="fractalNoise" baseFrequency="0\.9" numOctaves="2" seed=\{RING_GLOW_SEED\} stitchTiles="stitch" \/>/.test(f0));
    check("粒は彩度0(色を持たせない。マスクの輝度だけを使う)",
      /<feColorMatrix type="saturate" values="0" \/>/.test(f0));
    check("粒の明るさの幅は grainLo〜grainHi", (() => {
      const slope = api.RING_GLOW_GRAIN_HI - api.RING_GLOW_GRAIN_LO;
      const n = (f0.match(/type="linear" slope=\{RING_GLOW_GRAIN_HI - RING_GLOW_GRAIN_LO\} intercept=\{RING_GLOW_GRAIN_LO\}/g) || []).length;
      return n === 3 && Math.abs(slope - 0.70) < 1e-12 && api.RING_GLOW_GRAIN_LO === 0.30 && api.RING_GLOW_GRAIN_HI === 1.00;
    })(), `RGB3本 / 幅 ${(api.RING_GLOW_GRAIN_HI - api.RING_GLOW_GRAIN_LO).toFixed(2)}`);
    // ここが抜けると粒がマスクに**穴**を空け、光が斑に消える(不透明に固定するのが要点)。
    check("粒の alpha は slope 0 / intercept 1 で不透明に固定する",
      /<feFuncA type="linear" slope="0" intercept="1" \/>/.test(f0));
    // マスクは4枚(減衰 / 傾斜 / 1-傾斜 / 粒)。それぞれ矩形1枚だけを持つ。
    const masks = (ringCode.match(/<mask[\s\S]*?<\/mask>/g) || []);
    check("マスクは4枚(減衰 / 傾斜 / 1-傾斜 / 粒)", masks.length === 4, `${masks.length}枚`);
    check("radialGradient は3つ(減衰 / 傾斜 / 1-傾斜)",
      (ringCode.match(/<radialGradient[\s\S]*?<\/radialGradient>/g) || []).length === 3);
    check("3つのグラデーションはユーザー座標系・環と同心・半径は RING_GLOW_R_MAX",
      (ringCode.match(/gradientUnits="userSpaceOnUse" cx=\{CX\} cy=\{CY\} r=\{RING_GLOW_R_MAX\}/g) || []).length === 3);
    check("マスクの矩形はどれも光を塗る矩形と同じ大きさ",
      (ringCode.match(/x=\{RING_GLOW_RECT_MIN\} y=\{RING_GLOW_RECT_MIN\}/g) || []).length === 6);
    // 毎フレーム変えるのは明るさだけ。ノイズや減衰ストップを作り直すと重い。
    check("rAF が触るのはいちばん外の <g> の opacity だけ(ストップは作り直さない)",
      /glow\.setAttribute\("opacity", op\)/.test(ringCode)
      && !/setAttribute\("stop-opacity"/.test(ringCode)
      && !/ringGlowStops\(/.test(ringCode));
    check("減衰・傾斜のストップはモジュール定数として1度だけ作る",
      /const RING_GLOW_FALLOFF_STOPS = ringGlowStops\(ringGlowAlphaAt\);/.test(codeOf(src))
      && /const RING_GLOW_GRAINY_STOPS = ringGlowStops\(ringGlowRampAt\);/.test(codeOf(src))
      && /const RING_GLOW_SMOOTH_STOPS = ringGlowStops\(\(r\) => 1 - ringGlowRampAt\(r\)\);/.test(codeOf(src)));
    check("光の色は元色が変わったときだけ塗り替える(走りの有無とは別のキー)",
      /const baseKey = base\.join\(","\);/.test(ringCode)
      && /el\.setAttribute\("fill", `rgb\(\$\{gl\[0\]\},\$\{gl\[1\]\},\$\{gl\[2\]\}\)`\)/.test(ringCode));
  }

  // ------------------------------------------------------------------
  // D-3d. 光の3つの段(F-47 本人指示)。
  //   ±RING_IN_TUNE_CENTS 以内   走り + 光(呼吸つき)
  //   〜 ±RING_GLOW_NEAR_CENTS   走りは出さない。光だけ。合格線に近いほど強く、端で0
  //   それより外 / 音が無い       光らない
  // ------------------------------------------------------------------
  check("RING_GLOW_NEAR_CENTS は 4(本人指示)", api.RING_GLOW_NEAR_CENTS === 4, String(api.RING_GLOW_NEAR_CENTS));
  check("光の帯は合格判定より外側にある", api.RING_GLOW_NEAR_CENTS > api.RING_IN_TUNE_CENTS);
  check("±RING_GLOW_NEAR_CENTS を超えると光は完全に0", (() => {
    for (let ac = api.RING_GLOW_NEAR_CENTS; ac <= 60; ac += 0.1) {
      for (const raw of [0, 0.5, 1]) for (const br of [0, 1]) {
        if (api.ringGlowOpacity(raw, br, ac) !== 0) return false;
      }
    }
    return true;
  })());
  check("音が入っていない(NaN)ときは光らない",
    api.ringGlowOpacity(1, 1, NaN) === 0 && api.ringGlowOpacity(1, 1, undefined) === 0);
  check("符号は問わない(±で対称)", (() => {
    for (let c = -6; c <= 6; c += 0.05) {
      if (api.ringGlowOpacity(1, 0.5, c) !== api.ringGlowOpacity(1, 0.5, -c)) return false;
    }
    return true;
  })());
  check("合格線の外〜RING_GLOW_NEAR_CENTS では合格線に近いほど強い(単調減少)", (() => {
    let prev = Infinity;
    for (let ac = api.RING_IN_TUNE_CENTS + 1e-6; ac < api.RING_GLOW_NEAR_CENTS; ac += 0.01) {
      const v = api.ringGlowOpacity(0, 0, ac);
      if (!(v < prev)) return false;
      prev = v;
    }
    return true;
  })());
  check("帯の端(RING_GLOW_NEAR_CENTS)でちょうど0に着地する(段差を作らない)", (() => {
    const eps = 1e-9;
    return api.ringGlowOpacity(0, 0, api.RING_GLOW_NEAR_CENTS - eps) < 1e-8
      && api.ringGlowOpacity(0, 0, api.RING_GLOW_NEAR_CENTS) === 0;
  })(), `端の直前 ${api.ringGlowOpacity(0, 0, api.RING_GLOW_NEAR_CENTS - 1e-9).toExponential(2)}`);
  check("帯の中では走りも呼吸も関係しない(光だけを出す)", (() => {
    for (let ac = api.RING_IN_TUNE_CENTS + 0.05; ac < api.RING_GLOW_NEAR_CENTS; ac += 0.05) {
      const v = api.ringGlowOpacity(0, 0, ac);
      for (const raw of [0, 0.3, 1]) for (const br of [0, 0.5, 1]) {
        if (api.ringGlowOpacity(raw, br, ac) !== v) return false;
      }
    }
    return true;
  })());
  check("帯は試作の (NEAR-ac)/(NEAR-IN_TUNE) × AMP そのもの", (() => {
    for (let ac = api.RING_IN_TUNE_CENTS + 1e-6; ac < api.RING_GLOW_NEAR_CENTS; ac += 0.017) {
      const want = api.RING_GLOW_AMP
        * ((api.RING_GLOW_NEAR_CENTS - ac) / (api.RING_GLOW_NEAR_CENTS - api.RING_IN_TUNE_CENTS));
      if (Math.abs(api.ringGlowOpacity(0, 0, ac) - want) > 1e-12) return false;
    }
    return true;
  })());
  // 帯の中(±IN_TUNE〜±NEAR)では「走りは出ないのに光は出ている」が同時に成り立つこと。
  // 実装と同じ経路(inTune の式 → ringRunState → 進捗 → ringGlowOpacity)を組んで確かめる。
  check("帯の中では走りが1度も発火せず、それでも光は出ている", (() => {
    let anyGlow = false;
    for (let ac = api.RING_IN_TUNE_CENTS + 0.01; ac < api.RING_GLOW_NEAR_CENTS; ac += 0.05) {
      let st = { runFrom: null, outSince: -Infinity };
      for (let t = 0; t < 4000; t += 16) {
        const inTune = Math.abs(ac) <= api.RING_IN_TUNE_CENTS;   // 実装と同じ式
        st = api.ringRunState(st, inTune, t);
        if (st.runFrom !== null) return false;                   // 走ってはいけない
      }
      const raw = st.runFrom === null ? 0 : 1;
      const v = api.ringGlowOpacity(raw, api.ringBreath(0), ac);
      if (!(v > 0)) return false;                                // 光は出ていないといけない
      anyGlow = true;
    }
    return anyGlow;
  })());
  {
    // 報告用の実測表。合った側は呼吸の山(breath=1)・走り切った状態(raw=1)で出す。
    const rows = [1, 2, 2.5, 3, 4, 4.5].map((ac) => {
      const inTune = ac <= api.RING_IN_TUNE_CENTS;
      const hi = api.ringGlowOpacity(1, 1, ac), lo = api.ringGlowOpacity(1, 0, ac);
      const surface = api.RING_GLOW_PEAK * hi;   // 環の外縁での実効の濃さ(減衰 × <g>の明るさ)
      return `±${ac}¢: 走り${inTune ? "有" : "無"} 光 ${lo.toFixed(3)}〜${hi.toFixed(3)}`
        + ` (外縁の実効 ${(api.RING_GLOW_PEAK * lo).toFixed(3)}〜${surface.toFixed(3)})`;
    });
    console.log(`  光の段(実測): ${rows.join(" / ")}`);
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
  // 【F-47 で前提が動いた】判定線が ±1 → ±2 になったので、ここの実測値はすべて取り直した。
  //   ・揺らしは**判定線に対する相対量**なので、振幅を RING_IN_TUNE_CENTS 倍にすると
  //     外れ時間は ±1 のときと完全に一致する(267/333/650/0 ms)。EMA が線形で判定が
  //     しきい値比較なので、系は判定線に対してスケール不変。
  //   ・一方「+15¢へ外して戻す」は絶対量なので不変ではない。EMA の戻り尾が
  //     15¢→1¢ の 278ms から 15¢→2¢ の 200ms に**縮む**。
  //   ・結果、1200 の根拠だった「650ms 保持の外れ(928ms)は 900 では抑制を抜ける」は
  //     成立しなくなった(±2 では 850ms なので 900 でも抑制される)。ただし掃引すると
  //     900 は保持 690ms から、1200 は保持 990ms から走り直すので、**1200 のほうが
  //     厳しい**ことと「生の外れが 800ms までは走らず 1000ms 以上で走る」という
  //     選定時の性質は保たれている。定数は変えていない。
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
    // 【振幅は判定線に対する相対量で置く】揺らしの意味は「判定線をまたぐ程度の震え」なので、
    // 判定線が動いたら振幅も一緒に動かさないと同じことを測ったことにならない。
    // 生の振幅を固定すると、±2 では 1.6/2/1.2¢ が**一度も判定線をまたがなくなり**、
    // 「走りは1回だけ」という検査が空振りになる(実際にそうなったので相対量に直した)。
    const K = api.RING_IN_TUNE_CENTS;
    const wobble = (amp, hz) => simulateRing((t) => amp * K * Math.sin((2 * Math.PI * hz * t) / 1000), 8);
    const w3 = wobble(3, 1.5), w16 = wobble(1.6, 0.8), w2 = wobble(2, 0.5), w12 = wobble(1.2, 3);
    console.log(`  揺らしたときの外れ時間(実測・振幅は判定線の倍数): 3×/1.5Hz 判定の切替${w3.crossings}回・最長${w3.maxOut.toFixed(0)}ms`
      + ` / 1.6×/0.8Hz 判定の切替${w16.crossings}回・最長${w16.maxOut.toFixed(0)}ms`
      + ` / 2×/0.5Hz 判定の切替${w2.crossings}回・最長${w2.maxOut.toFixed(0)}ms`
      + ` / 1.2×/3Hz 判定の切替${w12.crossings}回・最長${w12.maxOut.toFixed(0)}ms`);
    check("揺らしただけでは外れている時間は 700ms を超えない(EMA が振幅を落とすため)",
      Math.max(w3.maxOut, w16.maxOut, w2.maxOut, w12.maxOut) < 700,
      `最長 ${Math.max(w3.maxOut, w16.maxOut, w2.maxOut, w12.maxOut).toFixed(0)}ms`);
    check("速い揺らし(判定線の1.2倍/3Hz)は EMA が吸収して一度も外れない",
      w12.crossings === 0 && w12.maxOut === 0, `判定の切替${w12.crossings}回`);
    // 空振り防止: 残り3つは実際に判定線をまたいでいること(またがなければ抑制も試されない)
    check("残りの揺らしは実際に判定線を何度もまたいでいる(検査が空振りでない)",
      [w3, w16, w2].every((r) => r.crossings >= 10),
      [w3, w16, w2].map((r) => r.crossings).join(","));
    check("揺らしても走りは1回だけ(判定線の3倍/1.5Hz で8秒間)", w3.runs === 1, `${w3.runs}回`);
    check("どの揺らし方でも走りは1回だけ",
      [w3, w16, w2, w12].every((r) => r.runs === 1),
      [w3, w16, w2, w12].map((r) => r.runs).join(","));
    // 抑制が無ければ交差のたびに走る = 上の検査は空振りではない
    check("抑制が無ければ 判定線の3倍/1.5Hz で何度も走る(比較対象)",
      simulateRing((t) => 3 * K * Math.sin((2 * Math.PI * 1.5 * t) / 1000), 8, 0).runs >= 8,
      `${simulateRing((t) => 3 * K * Math.sin((2 * Math.PI * 1.5 * t) / 1000), 8, 0).runs}回`);

    // (2) 一度はっきり外して戻す。EMA の戻り尾(15¢→判定線まで戻る時間)が加わる。
    const excursion = (holdMs, rearm = api.RING_RUN_REARM_MS) =>
      simulateRing((t) => (t >= 1000 && t < 1000 + holdMs ? 15 : 0), 6, rearm);
    const e650 = excursion(650), e800 = excursion(800), e1000 = excursion(1000);
    const tail = e650.maxOut - 650;
    console.log(`  +15¢に外して戻したときの外れ時間(実測): 保持650ms→${e650.maxOut.toFixed(0)}ms`
      + ` / 800ms→${e800.maxOut.toFixed(0)}ms / 1000ms→${e1000.maxOut.toFixed(0)}ms`
      + ` (EMA の戻り尾 ${tail.toFixed(0)}ms)`);
    // 戻り尾は理論値と突き合わせる(数値の直書きにしない)。
    // 15¢ から判定線まで 0.15/フレームで減衰: n = ln(判定線/15) / ln(1-0.15) フレーム。
    check("EMA の戻り尾は理論値(ln(判定線/15)/ln(0.85) フレーム)と一致する", (() => {
      const frames = Math.log(api.RING_IN_TUNE_CENTS / 15) / Math.log(1 - EMA_ALPHA);
      return Math.abs(tail - frames * (1000 / FPS)) < 1000 / FPS + 10;
    })(), (() => {
      const frames = Math.log(api.RING_IN_TUNE_CENTS / 15) / Math.log(1 - EMA_ALPHA);
      return `実測 ${tail.toFixed(0)}ms / 理論 ${(frames * (1000 / FPS)).toFixed(0)}ms`;
    })());
    check("外れている時間は「保持時間 + 戻り尾」で説明できる(1フレーム以内)",
      Math.abs(e800.maxOut - (800 + tail)) <= 1000 / FPS + 1e-6
      && Math.abs(e1000.maxOut - (1000 + tail)) <= 1000 / FPS + 1e-6,
      `800ms→${e800.maxOut.toFixed(0)}ms / 1000ms→${e1000.maxOut.toFixed(0)}ms (尾 ${tail.toFixed(0)}ms)`);
    // 【F-47 で更新】判定線が ±1 のときは「650ms 保持(外れ928ms)が 900 では抜ける」が
    // 1200 の直接の根拠だった。±2 では戻り尾が縮んで 850ms になり、その事例では 900 でも
    // 抑制される。根拠は事例ではなく**掃引の境目**で置き直す: 走り直しに必要な保持時間を
    // 掃引で求め、1200 が 900 より厳しいことと、選定時の性質(800ms までは走らず
    // 1000ms 以上で走る)が保たれていることを見る。
    const firstRerunHold = (rearm) => {
      for (let hold = 0; hold <= 2000; hold += 10) if (excursion(hold, rearm).runs === 2) return hold;
      return null;
    };
    const h900 = firstRerunHold(900), h1200 = firstRerunHold(api.RING_RUN_REARM_MS);
    console.log(`  走り直しに必要な保持時間(掃引): 抑制900ms→${h900}ms / 抑制${api.RING_RUN_REARM_MS}ms→${h1200}ms`);
    check("1200 は 900 より厳しい(同じ外し方でも走り直さない領域が広い)",
      h900 !== null && h1200 !== null && h1200 > h900, `900→${h900}ms / 1200→${h1200}ms`);
    check("走り直しの境目は「生の外れ 800ms は走らず 1000ms は走る」の間にある",
      h1200 > 800 && h1200 <= 1000, `${h1200}ms`);
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
    api.ringGlowOpacity(1, 1, 0) === api.RING_GLOW_AMP, String(api.ringGlowOpacity(1, 1, 0)));
  check("減速設定でも光は消えない(不透明度の式に reduce の分岐を挟まない)", (() => {
    const m = /const op = [^\n]*/.exec(ringCode);
    if (!m) return false;
    return m[0].trim() === "const op = ringGlowOpacity(raw, breath, liveRef.current.glowCents).toFixed(4);"
      && !/reduce/.test(m[0]);
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
    return api.ringGlowOpacity(raw, breath, 0) === api.RING_GLOW_AMP;
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
  // 【N-4b で置き換えた要件】以前の要件は §6.1「環の二役」= 到達していない間の帯が
  // **拍の要素と場所を争わない**ことだった。正典が拍を環の外へ出したので、
  // 争う相手そのものが無い。代わりに「帯が上弧を出て下半円へどれだけ入るか」という
  // **帯そのものの事実**を、写像を回して独立に確かめる(定数を読み直さない)。
  check("角度の写像はソースどおり(exact/RING_MAX_CENTS × RING_SWEEP_DEG)",
    /const deg = \(exact \/ RING_MAX_CENTS\) \* RING_SWEEP_DEG;/.test(ringCode));
  {
    // 帯が届く最大角度を、写像そのものを回して求める(定数を読み直さない)。
    let bandMax = 0;
    for (let c = -api.RING_MAX_CENTS; c <= api.RING_MAX_CENTS; c += 0.1) {
      bandMax = Math.max(bandMax, Math.abs((c / api.RING_MAX_CENTS) * api.RING_SWEEP_DEG));
    }
    // 帯は 90°を 20°超えて下半円に入る。「±90°で止まる」ではない。事実として記録に残す。
    check("帯は下半円に RING_SWEEP_DEG−90 = 20° だけ入る(±90°では止まらない)",
      Math.abs((bandMax - 90) - 20) < 1e-9, `下半円へ ${(bandMax - 90).toFixed(1)}°`);
    check("帯は全周(±180°)には届かない(到達の走りだけが全周を使う)",
      bandMax < 180, `帯の上限 ±${bandMax.toFixed(1)}°`);
    console.log(`  帯の到達角: ±${bandMax.toFixed(1)}° (下半円へ ${(bandMax - 90).toFixed(1)}°)`);
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
    // 【N-5 で並びが変わった】ダイヤルの**先頭に「—」(未評価 = null)が1段入る**
    // (本人指示 / 正典の「評価ダイヤル」ミニ)。旧主張は
    //   「厚さ・バランスのダイヤルは 5,4,3,2,1 の5段」「総評は41段」
    //   「スクロール最上部で5.0 / 最下部で1.0」「未評価は中央(3.0)の位置」だった。
    // 新主張はそれぞれ
    //   「先頭が「—」で、その後ろは 5,4,3,2,1 のまま(6段)」「総評は「—」+41段の42段」
    //   「最上部は「—」/ 最下部は 1.0」「未評価は先頭の「—」の位置」。
    // **値の側(1〜5 / 0.1刻み41段)は1つも動いていない**ことを、下で並びから切り出して確かめる。
    check("ダイヤルの先頭は「—」(未評価 = null)",
      api.ratingDialOrder("thickness")[0] === null && api.ratingDialOrder("rating")[0] === null,
      `${JSON.stringify(api.ratingDialOrder("thickness")[0])} / ${JSON.stringify(api.ratingDialOrder("rating")[0])}`);
    check("「—」は先頭の1段だけ(並びの途中に未評価が混ざらない)",
      api.ratingDialOrder("thickness").filter((v) => v === null).length === 1
      && api.ratingDialOrder("rating").filter((v) => v === null).length === 1);
    check("厚さ・バランスは「—」を除くと 5,4,3,2,1 のまま",
      api.ratingDialOrder("thickness").slice(1).join(",") === "5,4,3,2,1",
      api.ratingDialOrder("thickness").join(","));
    check("総評は「—」を除くと41段のまま",
      api.ratingDialOrder("rating").slice(1).length === 41, `${api.ratingDialOrder("rating").slice(1).length}段`);
    check("「—」を除いた並びは元の定数そのもの(ダイヤル用に値を作り直していない)",
      api.ratingDialOrder("thickness").slice(1).join(",") === api.RATING_DIAL_ORDER.join(",")
      && api.ratingDialOrder("rating").slice(1).join(",") === api.RATING_DIAL_RATING_ORDER.join(","));
    check("総評だけ別の並びを使う", api.ratingDialOrder("rating").length === 42 && api.ratingDialOrder("balance").length === 6);
    // グラフの縦軸目盛が使う RATING_DIAL_ORDER には「—」を混ぜていない(混ぜると目盛が1本増える)
    check("評価の推移グラフの目盛の定数(RATING_DIAL_ORDER)に null は入っていない",
      api.RATING_DIAL_ORDER.every((v) => v !== null) && api.RATING_DIAL_ORDER.length === 5,
      api.RATING_DIAL_ORDER.join(","));
    check("RATING_DIAL_RATING_ORDER にも null は入っていない",
      api.RATING_DIAL_RATING_ORDER.every((v) => v !== null) && api.RATING_DIAL_RATING_ORDER.length === 41);

    // --- 位置 ⇄ 値(総評) ---
    {
      const H = api.RATING_DIAL_ITEM_H;
      check("総評: スクロール最上部は「—」(未評価)", api.ratingDialValueAt(0, H, "rating") === null,
        String(api.ratingDialValueAt(0, H, "rating")));
      check("総評: その次の段が 5.0", api.ratingDialValueAt(H, H, "rating") === 5, String(api.ratingDialValueAt(H, H, "rating")));
      check("総評: スクロール最下部で1.0", api.ratingDialValueAt(H * 41, H, "rating") === 1, String(api.ratingDialValueAt(H * 41, H, "rating")));
      check("総評: 値→位置は位置→値の逆写像(41段すべて)",
        O.every((v) => api.ratingDialValueAt(api.ratingDialOffsetFor(v, H, "rating"), H, "rating") === v));
      check("総評: 「—」も値→位置→値で往復できる(選んで未評価に戻せる)",
        api.ratingDialValueAt(api.ratingDialOffsetFor(null, H, "rating"), H, "rating") === null);
      check("総評: 3.7 の位置は上から14行目(「—」が1段増えたぶん)", api.ratingDialOffsetFor(3.7, H, "rating") === 14 * H,
        `${api.ratingDialOffsetFor(3.7, H, "rating")}px`);
      check("総評: 未評価は先頭(「—」)の位置に置く(中央の3.0ではない)",
        api.ratingDialOffsetFor(null, H, "rating") === 0
        && api.ratingDialOffsetFor(null, H, "rating") !== api.ratingDialOffsetFor(3, H, "rating"),
        `${api.ratingDialOffsetFor(null, H, "rating")} / 3.0は${api.ratingDialOffsetFor(3, H, "rating")}`);
      check("総評: 行き過ぎても範囲外にならない",
        api.ratingDialValueAt(-999, H, "rating") === null && api.ratingDialValueAt(999999, H, "rating") === 1);
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
    // 【N-5 で数え直した】並びの先頭に「—」が入ったので、段の総数が 5 → 6 に、
    // 各値の位置が1段ぶん下へ動いた。**数える対象を「実際にダイヤルが描く並び」に直す**
    // (RATING_DIAL_ORDER は目盛用の定数で、ダイヤルの並びとは別物になった)。
    const DIAL = api.ratingDialOrder("thickness");
    const rowsVisible = (v) => {
      const top = api.ratingDialOffsetFor(v, H);
      let n = 0;
      for (let i = 0; i < DIAL.length; i++) {
        const a = pad + i * H;
        if (a >= top && a + H <= top + winH) n++;
      }
      return n;
    };
    const seen = DIAL.map((v) => `${v === null ? "—" : v}:${rowsVisible(v)}`).join(" ");
    // 旧主張「中央(3)のときだけ5段」→ 新主張「中央寄りの 4 と 3 のときに5段」
    // (6段になったので中央は 4 と 3 の間。窓の高さ 5行 は変えていない)
    check("一度に5段見えるのは中央寄りの 4 / 3 を選んでいるとき", rowsVisible(4) === 5 && rowsVisible(3) === 5, seen);
    check("端(「—」/ 1)を選んでいるときは3段しか見えない(F-13の「1と2はスクロール」は残る)",
      rowsVisible(null) === 3 && rowsVisible(1) === 3, seen);
    check("その隣(5 / 2)は4段", rowsVisible(5) === 4 && rowsVisible(2) === 4, seen);
    check("どの選択位置でも最低3段は見える(3行だった頃を下回らない)",
      DIAL.every((v) => rowsVisible(v) >= 3), seen);
    check("未評価(「—」)を選んでも 5 と 4 は同じ窓に見える(そこから戻せる)",
      rowsVisible(null) >= 3 && api.ratingDialOffsetFor(null, H) === 0, seen);
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
    // 【N-5】旧主張「スクロール最上部で5」→ 新主張「最上部は「—」、その次が5」。
    // 「上が5・下が1」という本人指示そのものは**評価値の並びの中で**保たれている。
    check("スクロール最上部は「—」(未評価)", api.ratingDialValueAt(0, H) === null, String(api.ratingDialValueAt(0, H)));
    check("その次の段で5が選ばれる(値としては上が5)", api.ratingDialValueAt(H, H) === 5, String(api.ratingDialValueAt(H, H)));
    check("スクロール最下部で1が選ばれる", api.ratingDialValueAt(H * 5, H) === 1, String(api.ratingDialValueAt(H * 5, H)));
    check("下へスクロールするほど値が小さくなる(「—」の段を除く)",
      [1, 2, 3, 4, 5].every((i, k, a) => k === 0 || api.ratingDialValueAt(a[k - 1] * H, H) > api.ratingDialValueAt(i * H, H)));
    check("行き過ぎても範囲外にならない",
      api.ratingDialValueAt(-999, H) === null && api.ratingDialValueAt(99999, H) === 1);
    check("値→位置は位置→値の逆写像",
      [1, 2, 3, 4, 5].every((v) => api.ratingDialValueAt(api.ratingDialOffsetFor(v, H), H) === v));
    check("「—」も値→位置→値で往復できる(厚さ・バランスも未評価に戻せる)",
      api.ratingDialValueAt(api.ratingDialOffsetFor(null, H), H) === null);
    check("未評価は先頭(「—」)の位置に置く(中央の3ではない)",
      api.ratingDialOffsetFor(null, H) === 0 && api.ratingDialOffsetFor(null, H) !== api.ratingDialOffsetFor(3, H),
      `${api.ratingDialOffsetFor(null, H)} / 3は${api.ratingDialOffsetFor(3, H)}`);
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

  // --- F-61 同じカレンダー日(ローカル)の記録は積まずに上書きする ---------------
  // 本人指示「リード評価遷移は同じ日付に変更があった場合は上書きされる仕組みに変更」。
  //
  // 【この検査が TZ を固定する理由】「ローカルの暦日で判定する」という要件は、
  // 実行環境が UTC だと**成立しているかどうか観測できない**(ローカル日 = UTC 日 なので、
  // toISOString().slice(0,10) で書かれた実装も同じ答えを返す)。
  // ずれのある実在のゾーン(Asia/Tokyo = UTC+9・DST なし)に固定して、
  // 「UTC の日は同じだがローカルの日は違う」「UTC の日は違うがローカルの日は同じ」の
  // 両方向を当てる。固定できたこと・元へ戻せたことも検査にする(黙って素通りさせない)。
  {
    const tzOrig = process.env.TZ;
    const tzSystem = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offBefore = new Date(2026, 0, 1).getTimezoneOffset();
    const hist = (q) => (q && q.ratings) || [];
    const entry = (a, r, t, b) => ({ at: a, rating: r, thickness: t, balance: b });
    try {
      process.env.TZ = "Asia/Tokyo";
      check("TZ を Asia/Tokyo(UTC+9)に固定できている(以下の判定の前提)",
        new Date("2026-08-08T15:30:00.000Z").getTimezoneOffset() === -540,
        String(new Date("2026-08-08T15:30:00.000Z").getTimezoneOffset()));

      // (a) 同じ日に2回変えても履歴は1件のまま。中身は最後の値、日時も最後の時刻
      {
        const t1 = "2026-08-08T01:00:00.000Z"; // JST 8/8 10:00
        const t2 = "2026-08-08T08:00:00.000Z"; // JST 8/8 17:00
        const reed = { rating: 3, thickness: 3, balance: 3, ratings: [entry(t1, 3, 3, 3)] };
        const p = api.commitReedScores(reed, { rating: 4.2, thickness: 2, balance: 5 }, t2);
        check("同じ日に評価し直しても履歴は1件のまま", hist(p).length === 1, `${hist(p).length}件`);
        check("残るのはその日の最後の値", !!hist(p)[0] &&
          hist(p)[0].rating === 4.2 && hist(p)[0].thickness === 2 && hist(p)[0].balance === 5,
          JSON.stringify(hist(p)[0] || null));
        check("残る記録の日時は新しい方の時刻", !!hist(p)[0] && hist(p)[0].at === t2,
          hist(p)[0] ? hist(p)[0].at : "null");
      }
      // (b) 日をまたげば増える
      {
        const reed = { rating: 3, thickness: 3, balance: 3, ratings: [entry("2026-08-07T08:00:00.000Z", 3, 3, 3)] };
        const p = api.commitReedScores(reed, { rating: 4.2, thickness: 3, balance: 3 }, "2026-08-08T08:00:00.000Z");
        check("日をまたいだら履歴は2件になる", hist(p).length === 2, `${hist(p).length}件`);
        check("前の日の記録はそのまま残る", hist(p)[0] && hist(p)[0].rating === 3 && hist(p)[1].rating === 4.2,
          hist(p).map((h) => h.rating).join(","));
      }
      // (c) **年が違う同じ月日は別の記録**。表示用の reedScoreDateLabel(M/D)を
      //     判定に流用すると、ここで1年前の記録が消える
      {
        const reed = { rating: 3, thickness: 3, balance: 3, ratings: [entry("2025-08-08T08:00:00.000Z", 3, 3, 3)] };
        const p = api.commitReedScores(reed, { rating: 4.2, thickness: 3, balance: 3 }, "2026-08-08T08:00:00.000Z");
        check("年が違う同じ月日は別の記録になる(M/D で判定していない)", hist(p).length === 2, `${hist(p).length}件`);
        check("表示用ラベルは両方とも同じ 8/8(判定に使えないことの裏取り)",
          api.reedScoreDateLabel("2025-08-08T08:00:00.000Z") === api.reedScoreDateLabel("2026-08-08T08:00:00.000Z"),
          `${api.reedScoreDateLabel("2025-08-08T08:00:00.000Z")} / ${api.reedScoreDateLabel("2026-08-08T08:00:00.000Z")}`);
      }
      // (d) 【UTC 実装だと落ちる方向 その1】UTC は同じ 8/8 だが、JST では 8/8 と 8/9
      {
        const t1 = "2026-08-08T14:30:00.000Z"; // JST 8/8 23:30
        const t2 = "2026-08-08T15:30:00.000Z"; // JST 8/9 00:30
        check("この2つの UTC 日は同じ(前提)",
          t1.slice(0, 10) === t2.slice(0, 10), `${t1.slice(0, 10)} / ${t2.slice(0, 10)}`);
        const reed = { rating: 3, thickness: 3, balance: 3, ratings: [entry(t1, 3, 3, 3)] };
        const p = api.commitReedScores(reed, { rating: 4.2, thickness: 3, balance: 3 }, t2);
        check("ローカルで日付が変わっていれば増える(UTC で判定していない)", hist(p).length === 2, `${hist(p).length}件`);
      }
      // (e) 【UTC 実装だと落ちる方向 その2】UTC は 8/7 と 8/8 だが、JST ではどちらも 8/8
      {
        const t1 = "2026-08-07T16:00:00.000Z"; // JST 8/8 01:00
        const t2 = "2026-08-08T13:00:00.000Z"; // JST 8/8 22:00
        check("この2つの UTC 日は違う(前提)",
          t1.slice(0, 10) !== t2.slice(0, 10), `${t1.slice(0, 10)} / ${t2.slice(0, 10)}`);
        const reed = { rating: 3, thickness: 3, balance: 3, ratings: [entry(t1, 3, 3, 3)] };
        const p = api.commitReedScores(reed, { rating: 4.2, thickness: 3, balance: 3 }, t2);
        check("ローカルで同じ日なら上書きする(UTC で判定していない)", hist(p).length === 1, `${hist(p).length}件`);
      }
      // (f) 置き換えても並びは古い順のまま。前後に別の日の記録があっても位置がずれない
      {
        const reed = {
          rating: 3, thickness: 3, balance: 3,
          ratings: [
            entry("2026-08-05T08:00:00.000Z", 1, 1, 1),
            entry("2026-08-08T01:00:00.000Z", 2, 2, 2),
            entry("2026-08-11T08:00:00.000Z", 5, 5, 5),
          ],
        };
        const p = api.commitReedScores(reed, { rating: 4.2, thickness: 4, balance: 4 }, "2026-08-08T09:00:00.000Z");
        check("真ん中の日を上書きしても件数は増えない", hist(p).length === 3, `${hist(p).length}件`);
        check("上書きしたのは同じ日の1件だけ(前後の日は無傷)",
          hist(p)[0] && hist(p)[0].rating === 1 && hist(p)[1].rating === 4.2 && hist(p)[2].rating === 5,
          hist(p).map((h) => h.rating).join(","));
        const sorted = api.normalizeRatingHistory(hist(p));
        check("上書き後も古い順に並ぶ(並べ直しても順序が変わらない)",
          sorted.length === 3 && sorted.map((h) => h.rating).join(",") === "1,4.2,5",
          sorted.map((h) => h.rating).join(","));
      }
      // (g) 古いデータに同じ日が2件以上あっても、上書きで1件にまとまる
      {
        const reed = {
          rating: 3, thickness: 3, balance: 3,
          ratings: [
            entry("2026-08-08T01:00:00.000Z", 1, 1, 1),
            entry("2026-08-08T05:00:00.000Z", 2, 2, 2),
            entry("2026-08-09T05:00:00.000Z", 5, 5, 5),
          ],
        };
        const p = api.commitReedScores(reed, { rating: 4.2, thickness: 4, balance: 4 }, "2026-08-08T09:00:00.000Z");
        check("同じ日が複数あった古いデータは1件にまとまる", hist(p).length === 2, `${hist(p).length}件`);
        check("まとまった位置は元の並びのまま(翌日の記録より前)",
          hist(p)[0] && hist(p)[0].rating === 4.2 && hist(p)[1].rating === 5,
          hist(p).map((h) => h.rating).join(","));
      }
      // (h) 「直前と3つとも同じなら積まない」既存の意図を壊していない
      {
        const reed = { rating: 2, thickness: 2, balance: 2, ratings: [entry("2026-08-08T01:00:00.000Z", 4, 4, 4)] };
        const p = api.commitReedScores(reed, { rating: 4, thickness: 4, balance: 4 }, "2026-08-08T09:00:00.000Z");
        check("直前の記録と3つとも同じなら履歴に触れない(上書きもしない)",
          p !== null && !("ratings" in p), p ? Object.keys(p).join(",") : "null");
      }
      // (i) 読めない日時の記録を巻き込まない(捨てられる記録を上書き対象にしない)
      {
        const reed = { rating: 3, thickness: 3, balance: 3, ratings: [entry("こわれた", 1, 1, 1)] };
        const p = api.commitReedScores(reed, { rating: 4.2, thickness: 3, balance: 3 }, "2026-08-08T09:00:00.000Z");
        check("日時が読めない記録は上書き対象にしない(末尾へ追加する)", hist(p).length === 2, `${hist(p).length}件`);
        check("暦日キーは読めない日時に null を返す", api.reedRatingDayKey("こわれた") === null,
          String(api.reedRatingDayKey("こわれた")));
      }
      // (j) 暦日キーそのもの: 年を落とさない / 0埋めする
      check("暦日キーは年月日を全部持つ", api.reedRatingDayKey("2026-01-02T09:00:00.000Z") === "2026-01-02",
        String(api.reedRatingDayKey("2026-01-02T09:00:00.000Z")));
      check("暦日キーは1桁の月日を0埋めする(1/12 と 11/2 が同じ綴りにならない)",
        api.reedRatingDayKey("2026-01-12T09:00:00.000Z") !== api.reedRatingDayKey("2026-11-02T09:00:00.000Z") &&
        api.reedRatingDayKey("2026-01-12T09:00:00.000Z").length === api.reedRatingDayKey("2026-11-02T09:00:00.000Z").length,
        `${api.reedRatingDayKey("2026-01-12T09:00:00.000Z")} / ${api.reedRatingDayKey("2026-11-02T09:00:00.000Z")}`);
    } finally {
      process.env.TZ = tzOrig === undefined ? tzSystem : tzOrig;
    }
    check("TZ を元に戻せている(以降の日付の検査を汚していない)",
      new Date(2026, 0, 1).getTimezoneOffset() === offBefore,
      `${new Date(2026, 0, 1).getTimezoneOffset()} / 元 ${offBefore}`);
  }

  // --- F-62 箱の平均総評は総評と同じ 0.1 刻み ---------------------------------
  // 本人指示「箱単位の平均総評が.1刻みになっているか確認。なっていなければ.1刻みに修正」。
  // 丸めていないと、title に出る "4.1" と StarRating の塗り(生の 4.0666…)が別の値を指す。
  {
    const mem = (...vs) => vs.map((v) => ({ rating: v }));
    check("4.0 / 4.1 / 4.1 の箱の平均は 4.1", api.reedGroupAvgRating(mem(4.0, 4.1, 4.1)) === 4.1,
      String(api.reedGroupAvgRating(mem(4.0, 4.1, 4.1))));
    // 生の平均そのものではないこと(丸めを外すとここが落ちる)
    check("生の平均(4.0666…)をそのまま返していない",
      api.reedGroupAvgRating(mem(4.0, 4.1, 4.1)) !== (4.0 + 4.1 + 4.1) / 3,
      String((4.0 + 4.1 + 4.1) / 3));
    // 整数に丸めてもいない
    check("整数に丸めてもいない(0.1 刻みを保つ)", api.reedGroupAvgRating(mem(4.0, 4.1, 4.1)) !== 4,
      String(api.reedGroupAvgRating(mem(4.0, 4.1, 4.1))));
    check("2枚 3.0 / 4.0 の平均は 3.5", api.reedGroupAvgRating(mem(3, 4)) === 3.5,
      String(api.reedGroupAvgRating(mem(3, 4))));
    check("1枚だけならその値", api.reedGroupAvgRating(mem(3.7)) === 3.7, String(api.reedGroupAvgRating(mem(3.7))));
    check("未評価しか無い箱は null",
      api.reedGroupAvgRating([{ rating: null }, { rating: undefined }, {}]) === null,
      String(api.reedGroupAvgRating([{ rating: null }, { rating: undefined }, {}])));
    check("空の箱でも例外を投げない",
      api.reedGroupAvgRating([]) === null && api.reedGroupAvgRating(null) === null &&
      api.reedGroupAvgRating(undefined) === null);
    check("未評価の枚数は平均に混ざらない(3.0 と未評価2枚の平均は 3.0)",
      api.reedGroupAvgRating([{ rating: 3 }, { rating: null }, { rating: undefined }]) === 3,
      String(api.reedGroupAvgRating([{ rating: 3 }, { rating: null }, { rating: undefined }])));
    // **完了条件そのもの**: title の文字列(toFixed(1))と星に渡す値が同じものを指す。
    // 41段の総評から作れる 1〜5枚のあらゆる組み合わせを総当たりし、
    //   (1) 値が小数第1位で正確に書ける = toFixed(1) を通しても値が変わらない
    //   (2) その値が総評の刻み(normalizeReedRating)の上に乗っている
    // の両方を要求する。丸めを外すと 4.0666… で (1) が落ちる。
    {
      // 41^5 は総当たりできないので、刻みの端・中・端の代表値で1〜5枚の箱を作る
      const grid = api.RATING_DIAL_RATING_ORDER;
      const reps = [grid[0], grid[1], grid[10], grid[20], grid[30], grid[grid.length - 2], grid[grid.length - 1]];
      let mismatch = null, offGrid = null, n = 0;
      const walk = (acc) => {
        if (acc.length) {
          const v = api.reedGroupAvgRating(acc.map((x) => ({ rating: x })));
          n++;
          if (v !== null && Number(v.toFixed(1)) !== v) mismatch = mismatch || `${acc.join("+")} -> ${v}`;
          if (v !== null && api.normalizeReedRating(v) !== v) offGrid = offGrid || `${acc.join("+")} -> ${v}`;
        }
        if (acc.length === 5) return;
        for (const g of reps) walk([...acc, g]);
      };
      walk([]);
      check("星に渡す平均は title の toFixed(1) と同じ値を指す(小数第1位で正確に書ける)",
        mismatch === null, mismatch || `${n}通り検査`);
      check("平均は総評の刻み(0.1)の上に乗っている", offGrid === null, offGrid || `${n}通り検査`);
      check("組み合わせの総当たりが空回りしていない", n >= 2000, `${n}通り`);
    }
    // JSX 側: 箱のヘッダが生の平均を作り直していないこと(丸めが1箇所に閉じている)
    {
      const i = src.indexOf("const avgRating =");
      const line = i === -1 ? "" : src.slice(i, src.indexOf("\n", i));
      check("箱の平均は reedGroupAvgRating から取る(その場で平均を作り直さない)",
        /reedGroupAvgRating\(g\.members\)/.test(line), line.trim().slice(0, 160));
      check("箱のヘッダに生の平均を作る旧実装(ratedValues)が残っていない",
        !/const ratedValues\b/.test(codeOf(src)));
      // 【N-5 で表示が変わった】旧主張は「星の塗り(<StarRating value={avgRating}>)と
      // title の toFixed(1) が同じ変数を見る」だったが、正典 .rmeta は**「★3.8」という文字**で、
      // 星の絵も title も無くなった。新主張は「箱見出しに出る数字は avgRating を
      // toFixed(1) した文字そのもの」。**表示と値が別物になり得る余地ごと消えている**
      // (星の塗りという別経路が無くなったので、食い違いようがない)。
      check("箱見出しの★は avgRating.toFixed(1) の文字で書く",
        /★\{avgRating\.toFixed\(1\)\}/.test(src),
        (src.match(/★\{[^}]*\}/g) || []).join(" / ") || "見つからない");
      check("箱見出しの★は評価済みの箱にだけ出す(未評価しか無い箱では出さない)",
        /avgRating !== null && <span>★\{avgRating\.toFixed\(1\)\}<\/span>/.test(src));
    }
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
    // 項目2: 厚さ・バランスに★を出さない。
    // 【N-5 で StarRating を削除した】旧主張は「StarRating コンポーネントは残っている
    // (他画面で使うので)」。正典は箱見出しも比較の一覧も**「★3.8」という文字**で書いており、
    // 星の絵の読み手が0件になった。新主張は「定義も呼び出しも残っていない」。
    // ★の表示そのものが消えたわけではない(上の「箱見出しの★は avgRating.toFixed(1)」で固定)。
    check("StarRating は定義も呼び出しも残っていない(★は文字で書く)",
      !/function StarRating\(/.test(codeOf(src)) && !/<StarRating/.test(codeOf(src)),
      (codeOf(src).match(/(function StarRating\(|<StarRating)/g) || []).join(" / ") || "0件");
    // 星の絵が持っていた「肯定的評価に機能色 --c-warn を流用」(§1.5 違反)も一緒に消えたこと。
    // #D97706 は計測タブのピッチ判定色としては残る(そちらは意味を持つ機能色)。
    check("★の表示に機能色 #D97706 を使う箇所が残っていない",
      !/color: "#D97706", whiteSpace: "nowrap" \}\}>★/.test(codeOf(src)));
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
      // --- 3枚のカードは等幅(F-65 で1枚を3枚に分けた後も「均等」は変えない) ---
      // カードに flex:1 1 0 + minWidth:0 を与える。どちらか欠けると幅が中身依存になる。
      check("カードは flex:1 1 0 で幅を均等に分ける", /flex: "1 1 0"/.test(fld));
      check("カードの幅は中身に引きずられない(minWidth:0)", /minWidth: 0/.test(fld));
      // --- 【N-5】3枚のカード → 正典 .starrow --------------------------------
      // 旧主張(F-65 の本人指示「色と配置はそのままでカード3枚に分割表示」)は
      //   (a) 各列が B型 .ctl-plain の地を持つ / (b) 列の間に --sp-2 の隙間がある
      //   (c) 列の内側に --sp-2 の余白 / (d) 見出しの下に数字 / (e) フォントは --fs-xs / --fs-lg
      // だった。正典 .starrow は
      //   行 = padding 16px 0 + 下に罫1本 / 列 = 地も枠も隙間も持たない flex:1 の中央揃え
      //   値 23px/600 が**上**、ラベル 11px --ink3 が**下**
      // で、地・隙間・余白・上下関係・文字サイズがすべて違う。DESIGN-SYSTEM §6.0 が
      // 「モックと本書(および本書に取り込まれた過去の指示)が食い違えば無条件でモックが勝つ」
      // と定めているので、新主張は正典側に置き換える。
      // **等幅・折り返さない・3項目とも出す・行のどこを押しても開く**は旧主張のまま残す。
      check("列は地を持たない(正典 .starrow に箱は無い)",
        !/className="ctl-plain"/.test(fld), (fld.match(/className="[^"]*"/g) || []).join(" / "));
      check("外側のボタンも地を持たない", !/className="sans ctl-plain"/.test(fld) && /className="sans"/.test(fld),
        (fld.match(/className="[^"]*"/g) || []).join(" / "));
      check("外側のボタンの地・枠は none(下の罫1本だけを持つ)",
        /background: "none", border: "none", borderBottom: "1px solid var\(--c-line\)"/.test(fld));
      check("行は上下 16px の余白を持つ(正典 .starrow の padding:16px 0)", /padding: "16px 0"/.test(fld));
      check("列の間に隙間を作らない(正典 .starrow は gap を持たない)",
        /flexWrap: "nowrap", gap: 0/.test(fld), (fld.match(/gap: [^,]*/g) || []).join(" / "));
      check("gap は行の1つだけ(列の中にも隙間を作らない)",
        (codeOf(fld).match(/gap:/g) || []).length === 1,
        `${(codeOf(fld).match(/gap:/g) || []).length}箇所`);
      check("列は内側の余白を持たない", /padding: 0,/.test(fld));
      // 角丸・地をインラインで書き戻していない(型が効かなくなるのを防ぐ)。
      // borderRadius: 0 は「.card 等の角丸を持ち込まない」宣言なので除く。
      check("列に地・枠・角丸を書き足していない",
        !/borderRadius: "[^"]*"/.test(fld) && !/background: "(?!none")/.test(fld),
        (fld.match(/(borderRadius|background): [^,]*/g) || []).join(" / "));
      // 旧実装(1枚の枠の中を1px罫で区切る)が残っていない。行の下の罫(borderBottom)は正典。
      check("列の境の罫で区切る旧実装が残っていない",
        !/borderLeft/.test(codeOf(fld)) && !/\bsep\b/.test(codeOf(fld)),
        (codeOf(fld).match(/borderLeft[^,]*/g) || []).join(" / "));
      check("各列は縦積み(flexDirection:column)", /flexDirection: "column"/.test(fld));
      // 【上下が入れ替わった】正典 .starrow は .v(値)が先で .l(ラベス)が後。
      // ソース上の**出現順**で見る(綴りだけでなく順序を縛る)。
      check("列は数字が上・ラベルが下(正典 .starrow の .v → .l)",
        fld.indexOf("{it.text}") !== -1 && fld.indexOf("{it.label}") !== -1
        && fld.indexOf("{it.text}") < fld.indexOf("{it.label}"),
        `値=${fld.indexOf("{it.text}")} / ラベル=${fld.indexOf("{it.label}")}`);
      check("行の高さは --tap-min 以上(値の有無で高さが変わらない)", /minHeight: "var\(--tap-min\)"/.test(fld));
      // 幅を食う文字(「・」)は描画しない。列ごとに幅が変わって等幅が崩れる。
      check("幅を食う区切り文字を描画しない",
        !/>\s*・/.test(codeOf(fld)) && !/\{"・"\}/.test(codeOf(fld)));
      // 正典の実寸: 値 23px / ラベル 11px。**どちらも 7段スケールの外**だが §6.0 でモックが勝つ。
      check("値は正典 .starrow .v の 23px / 600", /fontSize: 23, fontWeight: 600/.test(fld));
      check("ラベルは正典 .starrow .l の 11px / --c-ink-3", /fontSize: 11, color: "var\(--c-ink-3\)"/.test(fld));
      check("フォントサイズは正典の2つ(23 / 11)だけ",
        (fld.match(/fontSize: [^,]*/g) || []).join(",") === "fontSize: 23,fontSize: 11",
        (fld.match(/fontSize: [^,]*/g) || []).join(" / "));
    }
    check("ReedScoreEditor は星の絵を描かない(数値のダイヤルだけ)", !sourceOf("ReedScoreEditor").includes("<StarRating"));
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
  // 【F-79a の差し戻しで主張を変えた】
  // 旧主張: SwipePager の本体に `const threshold = w ? w * 0.2 : 60;` という**綴り**が残っている
  // 新主張: しきい値の**値**が変わっていない。行き先の判定を純関数(swipePagerEndKind)へ
  //   出したので綴りはそこへ移ったが、規則は §6.3 の「幅の20%・測れなければ60px」1つのまま。
  //   綴りではなく**境界での振る舞い**で見る(0.2 を 0.3 にすれば落ちる)。
  check("SwipePager のしきい値は幅の20%・測れなければ60px のまま(値で確認)",
    api.swipePagerEndKind(true, false, -75, 375, 0, 2) === "advance"
    && api.swipePagerEndKind(true, false, -74.99, 375, 0, 2) === "settle"
    && api.swipePagerEndKind(true, false, -60, 0, 0, 2) === "advance"
    && api.swipePagerEndKind(true, false, -59.99, 0, 0, 2) === "settle",
    `375→${api.swipeBackThreshold(375)} / 幅不明→${api.swipeBackThreshold(0)}`);
  check("SwipePager は行き先の判定を自前で持たない(純関数へ寄せた)",
    !/w \* 0\.2 : 60/.test(pager) && /swipePagerEndKind\(/.test(pager));
  check("SwipePager の端の抵抗はそのまま", pager.includes("if ((i === 0 && dx > 0) || (i === count - 1 && dx < 0)) dx *= 0.35;"));
  check("SwipePager の軸判定はそのまま", pager.includes("if (Math.abs(dxRaw) < 6 && Math.abs(dy) < 6) return;"));
  check("SwipePager は touchmove を非パッシブで登録したまま", pager.includes('el.addEventListener("touchmove", onMove, { passive: false });'));
  check("SwipePager は touch イベントのまま(pointerに変えていない)",
    pager.includes("onTouchStart") && !pager.includes("pointerdown"));
  check("SwipeBackArea の使用箇所は2つのまま", (src.match(/<SwipeBackArea /g) || []).length === 2, `${(src.match(/<SwipeBackArea /g) || []).length}箇所`);
  check("旧しきい値方式(useHorizontalSwipe)の呼び出しが残っていない", !src.includes("useHorizontalSwipe("));

  // ============================================================
  // 【F-88 / F-90】下から出るシートを下スワイプで閉じる。
  // §6.3 が名指しで警告している壊れ方(終端を通らない経路が1つでもあると
  // シートがずれたまま固着する)を、**終わり方の総当たり**で塞ぐ。
  // ここで見ているのは純関数の振る舞いだけで、**実機での指の追従感は見ていない**。
  // ============================================================
  {
    const K = ["idle", "drop", "close", "settle"];

    // --- しきい値: §6.3 の「動かす面の20% / 測れなければ60px」を**値で**見る --------
    // 綴りを写さず境界の振る舞いで見る(0.2 を 0.3 にすれば落ちる)。
    check("シートのしきい値はシートの高さの20%(§6.3 と同じ規則)",
      api.sheetDismissThreshold(300) === 60 && api.sheetDismissThreshold(500) === 100,
      `300→${api.sheetDismissThreshold(300)} / 500→${api.sheetDismissThreshold(500)}`);
    check("シートの高さが測れないときだけ 60px にする(§6.3 のフォールバック)",
      api.sheetDismissThreshold(0) === 60 && api.sheetDismissThreshold(-1) === 60,
      `0→${api.sheetDismissThreshold(0)}`);
    // 【名前の範囲】これは「横スワイプの定数を**参照している**」ことの検査ではない
    // (同じ値の別の定数を新設しても通る)。**値が一致している**ことだけを主張する。
    check("しきい値の値は横スワイプの定数と一致する(別の割合・別の下限を持ち込んでいない)",
      api.sheetDismissThreshold(500) === 500 * api.SWIPE_BACK_THRESHOLD_RATIO
      && api.sheetDismissThreshold(0) === api.SWIPE_BACK_THRESHOLD_MIN);

    // --- 動かす量: **下向きだけ**。上へは1pxも動かさない --------------------
    // 【初版の誤りを撤回】§6.3 の「行き先の無い向きの抵抗 0.35」を向き無しで転用しており、
    // 上へ 100px 引くと -35px 動いて**下端が持ち上がり暗幕が 35px 覗いた**(審査役の実測)。
    // シートは下端に貼り付いているので、上へ動かす行き先そのものが無い。
    check("下へ引いた量はそのまま指に追従する",
      api.sheetDismissOffset(0) === 0 && api.sheetDismissOffset(120) === 120);
    check("上へ引いてもシートは1pxも動かない(下端から浮かせない)",
      [-1, -35, -100, -1000].every((v) => api.sheetDismissOffset(v) === 0),
      [-1, -35, -100, -1000].map((v) => `${v}→${api.sheetDismissOffset(v)}`).join(" / "));
    check("動かす量が負になることは無い(暗幕が覗く向きへ動かさない)",
      [-1000, -1, 0, 1, 1000].every((v) => api.sheetDismissOffset(v) >= 0));

    // --- 終わり方の総当たり --------------------------------------------------
    // 縦と確定していなければ、中断でも指を離しても必ず "idle"(シートを触っていない)。
    check("縦と確定していないジェスチャーは必ず idle(false / null / undefined のすべて)",
      [false, null, undefined].every((v) =>
        [true, false].every((intr) =>
          [-500, 0, 500].every((dy) => api.sheetDismissEndKind(v, intr, dy, 400) === "idle"))));
    // 中断は**行き先を判定しない**。しきい値を越えていても閉じない。
    check("中断(drop)はしきい値を越えていても閉じない",
      api.sheetDismissEndKind(true, true, 1000, 400) === "drop"
      && api.sheetDismissEndKind(true, true, 0, 400) === "drop");
    check("指を離してしきい値以上なら close、未満なら settle(境界を含む)",
      api.sheetDismissEndKind(true, false, 80, 400) === "close"
      && api.sheetDismissEndKind(true, false, 79.99, 400) === "settle"
      && api.sheetDismissEndKind(true, false, -300, 400) === "settle",
      `しきい値=${api.sheetDismissThreshold(400)}`);
    // 返る値は4つだけ。知らない種類が混ざると下の style / shouldClose の総当たりが穴になる。
    check("終わり方は4種類しか返らない",
      [true, false, null].every((v) => [true, false].every((intr) =>
        [-1000, -80, -1, 0, 1, 79, 80, 1000].every((dy) =>
          [0, 400].every((h) => K.includes(api.sheetDismissEndKind(v, intr, dy, h)))))));

    // --- 書く値: **idle 以外はすべて元へ戻す** ------------------------------
    // §6.3「捨てるだけの経路を作るとシートがずれたまま固着する」。close も戻す
    // (onClose が実際には閉じない実装だと、戻さない経路がそのまま固着になる)。
    check("idle のときだけ何も書かない",
      api.sheetDismissSheetStyle("idle", "E") === null);
    check("idle 以外はすべて transition を戻し translateY(0px) へ戻す(close も含む)",
      ["drop", "close", "settle"].every((k) => {
        const s = api.sheetDismissSheetStyle(k, "E");
        return s && s.transition === "E" && s.transform === "translateY(0px)";
      }), JSON.stringify(K.map((k) => [k, api.sheetDismissSheetStyle(k, "E")])));

    // --- 行き先: close のときだけ閉じる -------------------------------------
    check("閉じるのは close のときだけ(他の3つでは閉じない)",
      api.sheetDismissShouldClose("close") === true
      && ["idle", "drop", "settle", "none"].every((k) => api.sheetDismissShouldClose(k) === false));

    // --- 中断の判定: touchcancel だけが中断(F-83 と同じ規則) ----------------
    check("touchcancel は中断・touchend は中断ではない",
      api.sheetDismissInterrupted("touchcancel") === true
      && api.sheetDismissInterrupted("touchend") === false);

    // --- 掴む条件: 「先頭に居る」と「下向き」の**両方**が要る -----------------
    // 片方だけだと、中身がスクローラのシートで scrollTop=0 から**上へ**引いたときにも
    // preventDefault が入り、**中身が先頭から動き出せなくなる**(審査役の実測)。
    check("先頭(scrollTop<=0)で下向きのときだけ掴む",
      api.sheetDismissShouldCapture(0, 1) === true && api.sheetDismissShouldCapture(-2, 100) === true);
    check("先頭でも上向き・横(dy<=0)なら掴まない(中身のスクロールを殺さない)",
      [0, -1, -100].every((dy) => api.sheetDismissShouldCapture(0, dy) === false));
    check("スクロール中(scrollTop>0)なら下向きでも掴まない",
      [1, 5, 200].every((t) => api.sheetDismissShouldCapture(t, 100) === false));
    // 2つの条件の総当たり。**論理積であること**を全組み合わせで固定する(片方を落とす変異を撃つ)。
    check("掴む条件は2つの論理積(4象限すべてで一致)",
      [-5, 0, 1, 50].every((t) => [-50, 0, 1, 50].every((dy) =>
        api.sheetDismissShouldCapture(t, dy) === (t <= 0 && dy > 0))));

    // --- 配線: **アプリ内のシートを全部**同じ作法にする(1つだけ違う挙動を残さない) ---
    // シート = 正典 .sheet の角丸(28px 28px 0 0)を持つカード。集合で縛る(箇所数では縛らない)。
    // 数を固定すると、正しくシートを増やす修正が落ちる(F-72 罠5 / F-79 罠2)。
    {
      // 【必ず codeOf を通す】前版は生ソースに /dismiss/i を当てており、
      // **テンポ拍子シートだけコメントに useSheetDismiss の綴りが入っていたため、
      // 配線行を丸ごと削っても通った**(審査役の実測。F-90 が名指しした当のシートが無防備)。
      // 「綴りが無いこと」を主張する検査は codeOf() を通してから見る(LOOP.md)。
      const codeSrc = codeOf(src);
      const sheetCards = [];
      const re = /borderRadius: "28px 28px 0 0"/g;
      let m;
      while ((m = re.exec(codeSrc)) !== null) {
        // このカードの開始タグを取り、そこに ref/handlers が乗っているかを見る
        const open = codeSrc.lastIndexOf("<div", m.index);
        sheetCards.push(codeSrc.slice(open, m.index));
      }
      // 【この検査が言う「シート」の範囲】正典 .sheet の角丸(28px 28px 0 0)を持ち、
      // 下端に密着するカードだけ。**下端寄せのカードすべてではない**。
      // 意図的に外してあるのは「エラー」「この録音を保存しますか？」「目安に設定」の3枚で、
      // これらは角丸 --r-lg の四方囲みで、つまみも持たない別の部品(判断は BACKLOG F-88 に記録)。
      check("正典 .sheet の角丸を持つカードを4枚以上走査できている",
        sheetCards.length >= 4, `${sheetCards.length}枚`);
      const without = sheetCards.filter((t) => !/dismiss/i.test(t));
      check("正典 .sheet の角丸を持つカードは、1枚残らず下スワイプの配線を持つ",
        without.length === 0, without.map((t) => t.replace(/\s+/g, " ").slice(0, 90)).join(" || ") || "0枚");
      // 呼び出し側の綴りも codeOf 済みで数える(コメントの言及で水増しされない)。
      check("下スワイプの配線は useSheetDismiss 1本に寄っている(シートごとに書き分けていない)",
        /function useSheetDismiss\(/.test(codeSrc)
        && (codeSrc.match(/useSheetDismiss\(/g) || []).length >= 5,
        `useSheetDismiss( の出現 ${(codeSrc.match(/useSheetDismiss\(/g) || []).length}回(定義1 + 呼び出し)`);
      // 名指しで4枚を確かめる。集合の性質だけだと「シートを1枚消して緑にする」が通る。
      for (const [label, needle] of [
        ["テンポ拍子(計測タブ)", /ref=\{tempoSheetDismiss\.ref\} \{\.\.\.tempoSheetDismiss\.handlers\}/],
        ["リード追加・箱を編集", /ref=\{dismiss\.ref\} \{\.\.\.dismissHandlers\}/],
        ["リード/データの「…」・データの絞り込み", /ref=\{dismiss\.ref\} \{\.\.\.dismiss\.handlers\}/],
      ]) {
        check(`下スワイプの配線が実際に書かれている: ${label}`, needle.test(codeSrc), String(needle));
      }
    }

    // --- 状態機械: **DOM へ実際に何が書かれるか**を偽のイベントで確かめる ------
    // 【なぜ必要か】前版はここが無く、純関数の総当たりだけだった。
    // 「純関数が正しい」は「その純関数が使われている」を1件も担保しない。
    // 審査の変異試験で **純関数を迂回する変異が9件生存**した(戻す値を直書きする /
    // 中断の判定を落とす / 高さを 0 に固定する / 消す予約の呼び出しを消す など)。
    // ここでは createSheetDismissGesture に io を差し込み、**呼ばれた順に記録して**見る。
    {
      // io の呼ばれ方を記録する土台。height は 400(しきい値 80)固定。
      const makeIO = (opts = {}) => {
        const log = [];
        const io = {
          log,
          ease: () => "EASE",
          height: () => (opts.height === undefined ? 400 : opts.height),
          touchCount: (e) => e.touches,
          point: (e) => ({ x: e.x, y: e.y }),
          isFormField: (e) => !!e.form,
          scrollTopAt: () => (opts.scrollTop === undefined ? 0 : opts.scrollTop),
          axisIsHorizontal: (dx, dy) => api.swipeAxisIsHorizontal(dx, dy),
          preventDefault: () => log.push("preventDefault"),
          setTransition: (v) => log.push(`transition=${v}`),
          setTransform: (v) => log.push(`transform=${v}`),
          close: () => log.push("close"),
          scheduleClear: () => log.push("scheduleClear"),
          cancelClear: () => log.push("cancelClear"),
        };
        return io;
      };
      // 指を x0,y0 から (dx,dy) へ動かして endType で離す。戻り値は io.log。
      const run = (dy, endType, opts = {}) => {
        const io = makeIO(opts);
        const g = api.createSheetDismissGesture(io);
        const x0 = 100, y0 = 100;
        const dx = opts.dx === undefined ? 0 : opts.dx;
        g.start({ touches: 1, x: x0, y: y0, form: opts.form });
        for (let i = 1; i <= 4; i++) g.move({ touches: 1, x: x0 + (dx * i) / 4, y: y0 + (dy * i) / 4 });
        if (endType === "detach") g.detach(); else g.end(endType);
        return io.log;
      };
      const last = (log, prefix) => [...log].reverse().find((l) => l.startsWith(prefix)) ?? null;

      check("状態機械を組み立てられている(io を差し込んで動かせる)",
        Array.isArray(run(100, "touchend")));

      // (1) しきい値を越えて指を離す → 閉じる。**close は1回だけ**。
      {
        const log = run(100, "touchend");
        check("engine: 下へ100px(しきい値80超)で離すと close が呼ばれる",
          log.filter((l) => l === "close").length === 1, log.join(" | "));
        check("engine: 閉じるときも transform を元へ戻す(戻さない経路を作らない。§6.3)",
          last(log, "transform=") === "transform=translateY(0px)", log.join(" | "));
      }
      // (2) しきい値未満 → 閉じずに戻す
      {
        const log = run(79, "touchend");
        check("engine: 下へ79px(しきい値80未満)では閉じない",
          !log.includes("close"), log.join(" | "));
        check("engine: 戻すときは transition を戻し translateY(0px) を書く",
          last(log, "transition=") === "transition=EASE"
          && last(log, "transform=") === "transform=translateY(0px)", log.join(" | "));
        check("engine: 戻したら transform を消す予約を入れる(§6.3。呼び出しごと消す変異を撃つ)",
          log.includes("scheduleClear"), log.join(" | "));
      }
      // (3) touchcancel は**行き先を判定しない**(F-83 の回帰を撃つ)
      {
        const log = run(500, "touchcancel");
        check("engine: touchcancel はしきい値を大きく越えていても閉じない(F-83)",
          !log.includes("close"), log.join(" | "));
        check("engine: touchcancel でも位置は必ず元へ戻る",
          last(log, "transform=") === "transform=translateY(0px)", log.join(" | "));
      }
      // (4) アンマウントも終端を通る + 予約を取り消す
      {
        const log = run(500, "detach");
        check("engine: アンマウントでも閉じない・位置は戻る(終わり方の4つ目)",
          !log.includes("close") && last(log, "transform=") === "transform=translateY(0px)", log.join(" | "));
        check("engine: アンマウントでは消す予約を取り消す(消えた要素にタイマーを残さない)",
          log.includes("cancelClear"), log.join(" | "));
      }
      // (5) 指に追従している間の値。**sheetDismissOffset を通っていること**を値で見る。
      {
        const log = run(60, "touchend");
        const during = log.filter((l) => l.startsWith("transform=")).slice(0, -1);
        check("engine: ドラッグ中は指の位置をそのまま transform に書く(下向き)",
          during.length > 0 && during[during.length - 1] === "transform=translateY(60px)",
          during.join(" | "));
        check("engine: ドラッグ中は transition を none にする(追従を鈍らせない)",
          log.includes("transition=none"), log.join(" | "));
        // 【R13 で足した】前版は「掴まなかったときに**呼ばない**」しか見ておらず、
        // `io.preventDefault(e)` を**削除しても 6119/0 で通った**(統括の実測)。
        // §6.3 の要求は「非パッシブで張り、掴んでいる間だけ preventDefault() を呼ぶ」で、
        // 前半は綴りで守られていたが**後半が無防備**だった。
        // 呼ばないとブラウザが縦スクロールを引き取り、シートが指に付いてくる裏でページも動く。
        // **掴んだ move の回数と preventDefault の回数が一致する**ことで固定する。
        {
          const pd = log.filter((l) => l === "preventDefault").length;
          const moved = log.filter((l) => l.startsWith("transform=translateY(") ).length - 1; // 最後の1つは戻し
          check("engine: 掴んでいる間は毎回 preventDefault を呼ぶ(§6.3。呼ばないと裏でページが動く)",
            pd > 0 && pd === moved, `preventDefault ${pd}回 / 掴んで動かした ${moved}回 : ${log.join(" | ")}`);
        }
      }
      // (6) 上へ引く: **掴まない**(preventDefault しない・DOM を1回も触らない)
      {
        const log = run(-200, "touchend");
        check("engine: 上へ引いたときは掴まない(preventDefault を呼ばない)",
          !log.includes("preventDefault"), log.join(" | "));
        check("engine: 掴まなかったジェスチャーは DOM を1回も触らない",
          !log.some((l) => l.startsWith("transform=") || l.startsWith("transition=")), log.join(" | "));
        check("engine: 掴まなかったジェスチャーでは閉じない", !log.includes("close"));
      }
      // (7) 横へ引く: 掴まない
      {
        const log = run(0, "touchend", { dx: 200 });
        check("engine: 横へ引いたときは掴まない(子タブのスワイプを奪わない)",
          !log.includes("preventDefault") && !log.some((l) => l.startsWith("transform=")),
          log.join(" | "));
      }
      // (8) 中身がスクロール中: 掴まない(sheetScrollTopAt の戻り値が効いていること)
      {
        const log = run(200, "touchend", { scrollTop: 30 });
        check("engine: 中身がスクロール中(scrollTop>0)なら掴まない",
          !log.includes("preventDefault") && !log.includes("close"), log.join(" | "));
      }
      // (9) 入力欄の上では始めない
      {
        const log = run(200, "touchend", { form: true });
        check("engine: 入力欄の上ではジェスチャーを始めない(値を選ぶ操作を奪わない)",
          log.length === 0, log.join(" | "));
      }
      // (10) **しきい値がシートの高さから来ていること**。高さを固定値に潰す変異を撃つ。
      //      高さ 1000(しきい値200)なら 150px では閉じず、高さ 400(しきい値80)なら閉じる。
      {
        const tall = run(150, "touchend", { height: 1000 });
        const short = run(150, "touchend", { height: 400 });
        check("engine: しきい値はシートの高さから決まる(高さを 0 や固定値に潰す変異を撃つ)",
          !tall.includes("close") && short.includes("close"),
          `高さ1000→${tall.includes("close") ? "閉じた" : "閉じない"} / 高さ400→${short.includes("close") ? "閉じた" : "閉じない"}`);
        // 高さが測れない(0)ときだけ 60px のフォールバックへ落ちる
        const zero59 = run(59, "touchend", { height: 0 });
        const zero60 = run(60, "touchend", { height: 0 });
        check("engine: 高さが測れないときだけ 60px のフォールバック(§6.3)",
          !zero59.includes("close") && zero60.includes("close"));
      }
      // (11) 2本目の指では始めない / 進行中は動かさない
      {
        const io = makeIO();
        const g = api.createSheetDismissGesture(io);
        g.start({ touches: 2, x: 100, y: 100 });
        g.move({ touches: 2, x: 100, y: 300 });
        g.end("touchend");
        check("engine: 2本の指では始めない", io.log.length === 0, io.log.join(" | "));
      }
      // (12) 新しい down は**進行中を必ず終わらせる**(§6.3。中断の終端が対象判定より前)
      {
        const io = makeIO();
        const g = api.createSheetDismissGesture(io);
        g.start({ touches: 1, x: 100, y: 100 });
        g.move({ touches: 1, x: 100, y: 200 });     // 100px 掴んで動かした
        const before = io.log.length;
        g.start({ touches: 2, x: 0, y: 0 });        // 2本目の指 = 対象外だが、前のは終わらせる
        const added = io.log.slice(before);
        check("engine: 2本目の指が触れても、前のジェスチャーは終端を通って元へ戻る(§6.3)",
          added.includes("transform=translateY(0px)") && added.includes("scheduleClear"),
          added.join(" | "));
        check("engine: そのとき行き先は判定しない(閉じない)", !added.includes("close"), added.join(" | "));
      }
      // (13) **掴んだ後に指が戻る**経路。下向きに掴んでからそのまま上へ引き返すと、
      //      dy が負になる。ここで生の dy を書くと**シートが下端より上へ持ち上がり、
      //      下に暗幕が覗く**(C の欠陥そのもの)。sheetDismissOffset を通していれば 0 で止まる。
      //      【この経路が無いと sheetDismissOffset(dyRaw)→dyRaw の変異が生き残る】
      //      掴む条件が dy>0 なので、掴んだ瞬間だけを見ても差が出ない。実際に撃たれて気付いた。
      {
        const io = makeIO();
        const g = api.createSheetDismissGesture(io);
        g.start({ touches: 1, x: 100, y: 100 });
        g.move({ touches: 1, x: 100, y: 150 });   // 下へ 50px = 掴む
        g.move({ touches: 1, x: 100, y: 60 });    // 指が始点より 40px 上へ戻る
        g.end("touchend");
        const negative = io.log.filter((l) => l.startsWith("transform=translateY(-"));
        check("engine: 掴んだ後に指が始点より上へ戻っても、シートは下端より上へ行かない",
          negative.length === 0, io.log.join(" | "));
        check("engine: そのまま離しても閉じない(戻った先はしきい値未満)",
          !io.log.includes("close"), io.log.join(" | "));
      }
    }

    // --- sheetScrollTopAt を**単体で**確かめる ------------------------------
    // 【R06 で足した】engine の検査は `scrollTopAt` を io で**丸ごとスタブ**しているので、
    // 実関数を1度も通らない。実際 `return node.scrollTop;` を `return 0;` にする変異が
    // **6119/0 で生存**した(統括の実測)。`io` に出したことで、
    // **実 DOM を歩く唯一の部分が検査の外へ出て**しまっていた。
    // ここでは偽の DOM を渡して中身そのものを見る。**getComputedStyle は差し替える**
    // (Node には無い。呼ばれた要素の overflowY を返すだけの最小の偽物)。
    {
      const mk = (o) => ({ nodeType: 1, scrollHeight: 0, clientHeight: 0, scrollTop: 0, parentElement: null, ov: "visible", ...o });
      const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].parentElement = nodes[i + 1]; return nodes[0]; };
      const saved = globalThis.getComputedStyle;
      globalThis.getComputedStyle = (n) => ({ overflowY: n.ov });
      try {
        // (1) 触れた要素自身がスクローラ → その scrollTop
        const self = mk({ scrollHeight: 500, clientHeight: 100, scrollTop: 37, ov: "auto" });
        check("sheetScrollTopAt: 触れた要素自身がスクローラならその scrollTop を返す",
          api.sheetScrollTopAt(self, self) === 37, String(api.sheetScrollTopAt(self, self)));
        // (2) 祖先がスクローラ → 祖先の scrollTop(直近のものを採る)
        const inner = mk({});
        const near = mk({ scrollHeight: 500, clientHeight: 100, scrollTop: 21, ov: "scroll" });
        const far = mk({ scrollHeight: 900, clientHeight: 100, scrollTop: 99, ov: "auto" });
        const root2 = far;
        chain(inner, near, far);
        check("sheetScrollTopAt: 直近のスクロールできる祖先の scrollTop を返す(遠い方ではない)",
          api.sheetScrollTopAt(inner, root2) === 21, String(api.sheetScrollTopAt(inner, root2)));
        // (3) スクローラが1つも無い → 0(先頭とみなす)
        const a = mk({}), b = mk({});
        chain(a, b);
        check("sheetScrollTopAt: スクロールできる祖先が無ければ 0(先頭とみなす)",
          api.sheetScrollTopAt(a, b) === 0, String(api.sheetScrollTopAt(a, b)));
        // (4) overflowY が auto / scroll 以外なら**スクローラとみなさない**
        for (const ov of ["visible", "hidden", "clip"]) {
          const n = mk({ scrollHeight: 500, clientHeight: 100, scrollTop: 44, ov });
          check(`sheetScrollTopAt: overflowY:${ov} はスクローラとみなさない`,
            api.sheetScrollTopAt(n, n) === 0, String(api.sheetScrollTopAt(n, n)));
        }
        // (5) 中身がはみ出していない(scrollHeight ≒ clientHeight)ならスクローラとみなさない
        const flat = mk({ scrollHeight: 101, clientHeight: 100, scrollTop: 44, ov: "auto" });
        check("sheetScrollTopAt: 中身がはみ出していなければスクローラとみなさない",
          api.sheetScrollTopAt(flat, flat) === 0, String(api.sheetScrollTopAt(flat, flat)));
        // (6) root より上は見に行かない(シートの外のスクローラを拾わない)
        const child = mk({});
        const rootEl = mk({});
        const outside = mk({ scrollHeight: 500, clientHeight: 100, scrollTop: 77, ov: "auto" });
        chain(child, rootEl, outside);
        check("sheetScrollTopAt: root より外側のスクローラは見に行かない",
          api.sheetScrollTopAt(child, rootEl) === 0, String(api.sheetScrollTopAt(child, rootEl)));
      } finally {
        globalThis.getComputedStyle = saved;
      }
    }

    // --- 状態機械の書き方: 捨てるだけの経路が無い ----------------------------
    {
      const eng = codeOf(sourceOf("createSheetDismissGesture"));
      // 1 に固定してよいのは偶然の件数ではなく「終端を通らずに捨てられない」という
      // 不変条件そのものだから(F-79 罠2 の「箇所数を釘付けにする検査」には当たらない)。
      // 宣言(`let st = null;`)は数に入れない。数えたいのは**捨てる代入**だけ。
      const drops = (eng.replace(/\blet\s+st\s*=\s*null/g, "＿宣言＿").match(/\bst\s*=\s*null\b/g) || []);
      check("進行中の状態を捨てる代入は状態機械の中で1箇所だけ(終端を通らずに捨てられない)",
        drops.length === 1, `${drops.length}箇所`);
      check("中断の終端は対象判定より前に置く(§6.3。start の最初の1行)",
        /const start = \(e\) => \{\s*finish\(true\);/.test(eng));
      check("終わりを告げたイベント種は引数で受ける(同じ関数に配線して中で区別しない。F-83)",
        /const end = \(eventType\) => \{[\s\S]*?sheetDismissInterrupted\(eventType\)/.test(eng));
    }

    // --- React 層: 判定を持たず、状態機械へ渡すだけ --------------------------
    {
      const hook = codeOf(sourceOf("useSheetDismiss"));
      check("touchend と touchcancel はイベント種を分けて状態機械へ渡す(F-83)",
        /onTouchEnd: \(\) => g\.end\("touchend"\)/.test(hook)
        && /onTouchCancel: \(\) => g\.end\("touchcancel"\)/.test(hook), hook.slice(-400));
      check("touchmove は非パッシブで登録する(§6.3。横取りを止められない)",
        /addEventListener\("touchmove", fn, \{ passive: false \}\)/.test(hook));
      // 【名前の範囲】「依存配列が空である」ことだけを見る。**空である理由**(親の再レンダーで
      // ref が付け外しされない)は実ブラウザで実測済みで、ここでは綴りしか見ていない。
      check("コールバック ref の依存配列は [g] だけ(g は ref なので同一性が変わらない)",
        /const attachRef = useCallback\(\(node\) => \{[\s\S]*?\n  \}, \[g\]\);/.test(hook),
        (hook.match(/\}, \[[^\]]*\]\);/g) || []).join(" / "));
      check("要素が外れたら状態機械の detach を通す(捨てるだけの経路を作らない)",
        /\} else \{\s*g\.detach\(\);/.test(hook));
      check("状態機械は1つだけ作る(レンダーごとに作り直すと進行中のジェスチャーが消える)",
        /gestureRef\.current === null/.test(hook));
      // io の各口が**実際の DOM 操作につながっている**こと。ここは綴りの確認で、
      // 「その口が呼ばれること」は上の engine の検査が持つ。両方が揃って初めて配線が守られる。
      for (const [label, needle] of [
        ["高さ", /height: \(\) => el\(\)\?\.offsetHeight/],
        ["スクロール位置", /scrollTopAt: \(e\) => sheetScrollTopAt\(e\.target, el\(\)\)/],
        ["軸判定", /axisIsHorizontal: \(dx, dy\) => swipeAxisIsHorizontal\(dx, dy\)/],
        ["transform を書く", /setTransform: \(v\) => \{[^}]*style\.transform = v/],
        ["transform を消す", /style\.transform = "";/],
        ["消すまでの時間", /SWIPE_BACK_SETTLE_MS/],
        ["イージング", /ease: \(\) => SWIPE_BACK_EASE/],
        ["入力欄の除外", /closest\?\.\("input, select, textarea"\)/],
      ]) {
        check(`io の口の中身が DOM 操作の綴りになっている: ${label}`, needle.test(hook), String(needle));
      }
    }
  }
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
    // 許すのは**2種だけ**(同じ2種なら本数は問わない)で、どちらも「見た目の作法」ではなく
    // **壊れ方を構造的に封じる**用途:
    //   ・animation: none  … 動きを止める(既存)
    //   ・overflow: visible … .taptext の当たり判定が切られるのを防ぐ(F-83)。
    //     インラインの style に勝つ必要があるので素の宣言では足りない。
    // **件数ではなく「宣言の集合」で縛る**(箇所数の釘付けは F-72 罠5 で禁じた形)。
    // 色・地・枠・寸法など見た目の作法に !important が現れたら、それは飛び越えなので落とす。
    const ALLOWED_BANGS = [/^animation\s*:\s*none\b/, /^overflow\s*:\s*visible\b/];
    const strayBangs = bangs.filter((b) => !ALLOWED_BANGS.some((re) => re.test(b)));
    check("index.css の !important は「壊れ方を封じる」2種(animation:none / overflow:visible)だけ(作法を飛び越える手を残さない)",
      bangs.length > 0 && strayBangs.length === 0, strayBangs.join(" | ") || `${bangs.length}件すべて許容: ${bangs.join(" | ")}`);
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
  // 【N-5 で下限を 15 → 10 に下げた】リードタブが正典へ移り、登録フォーム・登録済みリード・
  // 個体詳細の識別情報 / 測定データ / 評価の推移の**5枚のカードが無くなった**
  // (正典の囲いの序列は「余白 → 揃え → 罫1本 → 面」で、面は1画面に1枚まで。§6.0)。
  // 実測 11 枚に対して 10 を下限に置く。**下限を下げたぶんは、下で「リードタブに .card が
  // 1枚も無い」ことを名指しで固定して埋める**(数が減ったこと自体を要件にする)。
  // 【N-6 で下限を 10 → 8 / 5 → 4 に下げた】データタブの My Data 子タブが正典へ移り、
  // 「My Data」「最新セッション」「セッション一覧」の**3枚のカードと2つの .tile-row が
  // 無くなった**(囲いの序列は同上。面はヒーロー1枚だけ)。実測 .card 8 / .tile-row 4。
  // **下げたぶんは、下で「My Data 子タブに .card が1枚も無い」ことを名指しで固定して埋める。**
  check(".card が実際に使われている", cardTags.length >= 8, `${cardTags.length}箇所`);
  check(".tile が実際に使われている", tileTags.length >= 3, `${tileTags.length}箇所`);
  check(".tile-row が実際に使われている", rowTags.length >= 4, `${rowTags.length}箇所`);
  // 【N-6】My Data 子タブに面(グレーのカード)が1枚も無いこと。
  // 走査は関数の集合で行う: ヒーロー〜指標行(MyDataSection / MetricRow)と
  // 一覧まわり(MyDataPage)。**「面が無い」ことの十分条件ではない**(親が .card を巻けば
  // ここは通る)ので、名前もその範囲しか名乗らない。
  {
    const owners = ["MyDataPage", "MyDataSection", "MetricRow"];
    const bodies = owners.map((n) => ({ n, body: srcOfFn(src, n) }));
    check("N-6: My Data 子タブの3関数を走査できている(空回りしていない)",
      bodies.every((b) => b.body.length > 400), bodies.map((b) => `${b.n}:${b.body.length}`).join(" "));
    const withCard = bodies.filter((b) => /className="[^"]*\bcard\b[^"]*"/.test(b.body)).map((b) => b.n);
    check("N-6: My Data 子タブの3関数に .card が1枚も無い(面はヒーローだけ。§6.0 の囲いの序列)",
      withCard.length === 0, withCard.join(",") || "0件");
  }
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
  // App.jsx 側: no-top-rule を付けているのは本人指示の箇所だけ(乱用しないこと)。
  // 【F-75 で 2 → 3】計測タブの詳細カードが加わった。
  // 【N-5 で 3 → 1】旧主張は「3箇所(リード登録カード / 識別情報カード / 計測タブの詳細カード)」。
  // リードタブが正典へ移り、**リード登録カードと識別情報カードそのものが無くなった**
  // (正典の登録一覧・個体詳細に .card は1枚も無い)。新主張は「1箇所(計測タブの詳細カードだけ)」。
  // 箇所数を緩めたのではなく**減った2件が本当に消えたこと**も下で名指しで確かめる。
  {
    const noTopTags = tagsWithClass("no-top-rule");
    check('className="card no-top-rule" は1箇所だけ(計測タブの詳細カード)',
      noTopTags.length === 1, `${noTopTags.length}箇所`);
    {
      const codeNT = codeOf(src);
      const at = (needle) => codeNT.indexOf(needle);
      // codeOf はコメントを {} に潰すので、その残骸を挟んで一致させる
      const detailCard = /\{detailOpen && \(\s*<div style=\{\{ padding: "16px 0 10px" \}\}>[\s{}]*<div className="card no-top-rule">/.test(codeNT);
      check("F-75: 計測タブの詳細カードが no-top-rule を持つ(上辺の罫を消した1件)", detailCard,
        (codeNT.match(/\{detailOpen && \([\s\S]{0,200}/) || [""])[0].replace(/\s+/g, " ").slice(0, 200));
      check("N-5: リード登録カード / 識別情報カードは無くなった(no-top-rule ごと消えている)",
        at('<div className="card no-top-rule" style={{ marginBottom: 12 }}>') === -1
        && at('<div className="card no-top-rule" style={{ marginBottom: 10 }}>') === -1);
    }
    check("no-top-rule を持つタグはすべて .card も同時に持つ(単独では使わない)",
      noTopTags.every((t) => (t.match(/className="([^"]*)"/) || ["", ""])[1].trim().split(/\s+/).includes("card")),
      noTopTags.join(" | ").slice(0, 200));
    // 【N-5】.card の下限を 15 → 10 に下げたぶんの埋め合わせ:
    // リードタブの3つの画面(登録一覧 / 個体詳細 / 比較)に .card が1枚も残っていないこと。
    // 減った枚数を数えるのではなく、**どこから消えたか**を関数単位で固定する。
    // 分割代入の引数を跨いで本体を取る版(この節より後ろで定義される srcOf と同じ実装。
    // ここでは使えないのでローカルに置く)。
    const bodyOf = (name) => {
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
    for (const name of ["ReedRegisterView", "ReedEvaluationDetail", "ReedCompareTab", "ReedScoreHistoryChart", "ReedsTab"]) {
      const body = bodyOf(name);
      check(`${name} の本体を走査できている`, body.length > 400, `${body.length}文字`);
      check(`${name} に .card / .tile は1つも無い(正典の囲いは余白と罫1本だけ)`,
        !/className="[^"]*\b(card|tile|tile-row)\b[^"]*"/.test(body),
        (body.match(/className="[^"]*"/g) || []).filter((s) => /\b(card|tile|tile-row)\b/.test(s)).join(" / ") || "0件");
    }
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
  // --- 6.6 noteFocus(音名の絞り込み)はデータタブの指標行だけに効く ------------
  // 【N-6 で場所が1つに畳まれた】旧: データタブの「My Data」「最新セッション」の2カードが
  // それぞれ noteFocus を渡していた。新: 累計/最新は**同じ形の行**なので部品 MetricRow が
  // 1つになり、渡し先も1箇所になった(2行とも MetricRow が描くので効き方は変わっていない)。
  // ReedEvaluationDetail の測定データ・SessionDetailView のセッション平均・ReedCompareTab は
  // 対象外(従来どおり全音域)。渡し忘れ・渡しすぎのどちらも壊れたら検出できるようにする。
  {
    const FOCUS = 'noteFocus={["E♭3", "E♭4", "E♭5"]}';
    // **数ではなく「どの関数が渡しているか」の集合**で縛る(件数を釘付けにすると、
    // 部品を1つにまとめる/分けるという正しい修正が落ちる。F-72 罠5 / F-79 罠2)。
    // 【N-6 追記】MyDataSection も渡し手に戻った。正典 .mrow が3列で平均差分の列を持たないため
    // 列は消したが、**「どの音がどれだけズレているか」まで消してはいけない**ので、
    // 入口をヒーローの数字のタップに移した(本人の決定「機能を残す」/ N6-SPEC「音名軸グラフは落とさない」)。
    const NOTE_FOCUS_OWNERS = ["MetricRow", "MyDataSection"];
    const NOTE_FOCUS_NON_OWNERS = ["MyDataPage", "ReedEvaluationDetail",
      "SessionDetailView", "ReedCompareTab"];
    for (const fn of NOTE_FOCUS_OWNERS) {
      check(`${fn} は noteFocus を渡す(データタブの指標行だけが音名を絞る)`, srcOf(fn).includes(FOCUS));
    }
    for (const fn of NOTE_FOCUS_NON_OWNERS) {
      check(`${fn} は noteFocus を渡さない`, !srcOf(fn).includes("noteFocus"));
    }
    // 集合の外(上の関数のどれでもない場所)から渡していないこと。渡す綴りの総数と、
    // 集合の中で数えた総数が一致するかで見る(名前どおり「集合の外に無い」しか主張しない)。
    const total = (src.match(/noteFocus=\{\["E♭3", "E♭4", "E♭5"\]\}/g) || []).length;
    const inOwners = NOTE_FOCUS_OWNERS
      .reduce((n, fn) => n + (srcOf(fn).match(/noteFocus=\{\["E♭3", "E♭4", "E♭5"\]\}/g) || []).length, 0);
    check("noteFocus を渡しているのは上の集合の中だけ(集合の外に渡し手がいない)",
      total === inOwners && total > 0, `全体 ${total} / 集合内 ${inOwners}`);
    // 【N-7 2026/08/16 本人指示による書き換え】TappableMetricCard の呼び出しは全体で2箇所
    // (登録済みリード / セッション詳細)になった。データタブの指標行(MetricRow)は
    // 「数字タップでグラフ」をやめ、常時表示の NoteAxisLineChart になった(検証27)。
    // **どの関数が呼んでいるか**を集合で固定する。
    const CARD_CALLERS = ["ReedEvaluationDetail", "SessionDetailView"];
    const callSites = (src.match(/<TappableMetricCard/g) || []).length;
    const inCallers = CARD_CALLERS
      .reduce((n, fn) => n + (srcOf(fn).match(/<TappableMetricCard/g) || []).length, 0);
    check("TappableMetricCard を呼ぶのはこの2関数だけ(呼び出し側が集合の外に増えていない)",
      callSites === inCallers && CARD_CALLERS.every((fn) => srcOf(fn).includes("<TappableMetricCard")),
      `全体 ${callSites} / 集合内 ${inCallers}`);
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
    // 【2026-08-15】fmt の綴りを写すのをやめ、共有の書式 formatSignedCents を使っていることで見る
    // (書式の中身は「0 に符号を付けない」も含めて §6.7 で挙動として固定した)。
    check("REED_COMPARE_METRICS のピッチのラベルは「平均差分」(N-2 表記統一)・fmtは共有の書式",
      /label: "平均差分", unit: "¢", fmt: formatSignedCents/.test(reedCompare));
    // 【N-6】ラベルは**正典(design/north-star-measure.html)の文言に固定**する。
    // 「スペクトル重心」のまま長らく正典(「重心」)とずれていたのに、**どの検査も落ちなかった**
    // (統括が N-6 の実測で気付いた)。正典と表示文言のずれは、値の検査では捕まらない。
    // 期待値をここに写すのではなく、**正典の該当行から読む**(写すと正典が変わっても落ちない)。
    {
      const mock = readFileSync(new URL("../design/north-star-measure.html", import.meta.url), "utf8");
      // 正典の**データタブの節だけ**を切り出す(.l はリード側の 総評/厚さ/バランス にも使われている)
      const iData = mock.indexOf("<h2>データタブ</h2>");
      const iNext = mock.indexOf("<h2>", iData + 8);
      const dataSection = iData < 0 ? "" : mock.slice(iData, iNext < 0 ? mock.length : iNext);
      // さらに **My Data の指標行(.mrow)〜セッション見出し(.shead) の手前**に絞る。
      // データタブの節には PIVOT 側の「平均差分」の .l も含まれるので、節ごと拾うと
      // 「行に出る3ラベル」の突き合わせに混ざる。
      const iRow = dataSection.indexOf('class="mrow"');
      const iHead = dataSection.indexOf('class="shead"', iRow);
      const rowBlock = iRow < 0 ? "" : dataSection.slice(iRow, iHead < 0 ? dataSection.length : iHead);
      const uniq = [...new Set([...rowBlock.matchAll(/<div class="l">([^<]+)<\/div>/g)].map((m) => m[1].trim()))];
      check("N-6: 正典の My Data 指標行から指標ラベルを読めている(空回りしていない)",
        iData >= 0 && iRow >= 0 && iHead > iRow && rowBlock.length > 200 && uniq.length === 3
        && uniq.includes("HNR") && uniq.includes("音量") && uniq.includes("重心"),
        `節 ${dataSection.length}文字 / 行ブロック ${rowBlock.length}文字 / ${uniq.join(" ")}`);
      // 【重要】**画面に出るラベルを持つ配列を全部見る。**
      // 初版は REED_COMPARE_METRICS しか見ておらず、**データタブが使う MY_DATA_METRICS を
      // 1文字も見ていなかった**(検査名は「指標ラベルは正典と一致する」と全体を名乗っていた)。
      // 統括が REED_COMPARE_METRICS だけ直して「直った」と報告し、審査役の変異
      // (MY_DATA_METRICS の「音量」→「ボリューム」等)が**3件とも生存**して露見した。
      // 通算12回目の「検査名が実際の検証より強い」。走査する配列を取りこぼすと同じことが起きるので、
      // **配列そのものを名指しで列挙し、列挙漏れが起きたら落ちる**ようにする。
      const LABEL_ARRAYS = ["REED_COMPARE_METRICS", "MY_DATA_METRICS"];
      const arrays = LABEL_ARRAYS.map((n) => ({ n, src: extractConst(n) }));
      check("N-6: ラベルを持つ配列を全部切り出せている(空回りしていない)",
        arrays.every((a) => a.src && a.src.length > 100 && /label: "/.test(a.src)),
        arrays.map((a) => `${a.n}:${a.src ? a.src.length : "無し"}`).join(" "));
      // 列挙漏れの検出: ソース全体で `label: "…"` を持つ**指標配列**の名前を拾い、
      // 上の一覧に載っていないものがあれば落とす(新しい配列が増えたら気付ける)。
      const declared = [...codeOf(src).matchAll(/const ([A-Z_]*METRICS)\s*=\s*\[/g)].map((m) => m[1])
        .filter((n) => /label: "/.test(extractConst(n) || ""));
      const unlisted = declared.filter((n) => !LABEL_ARRAYS.includes(n));
      check("N-6: ラベルを持つ指標配列がほかに増えていない(増えたらこの検査に足す)",
        unlisted.length === 0, unlisted.join(" ") || `対象 ${declared.join("/")}`);
      // 【許される語彙は正典から作る】前版は「`重心|音量|HNR` を**部分文字列に含む**のに
      // 正典に無い語」しか弾いておらず、「ボリューム」「SNR」「セントロイド」が素通りした
      // (「スペクトル重心」だけ落ちたのは、たまたま「重心」を含んでいたから)。
      // 正しくは**正典に出てくる語の集合に属さない語をすべて弾く**。
      // 語彙は正典**全体**の .l から作る(データタブの節だけだと、同じ配列を使う
      // リード側の 総評/厚さ/バランス まで違反になってしまうため)。
      const vocab = new Set([...mock.matchAll(/<div class="l">([^<]+)<\/div>/g)].map((m) => m[1].trim()));
      check("N-6: 正典から許される語彙を作れている(空回りしていない)",
        vocab.size >= 4 && vocab.has("重心") && vocab.has("音量") && vocab.has("HNR"),
        `${vocab.size}語: ${[...vocab].join(" ")}`);
      const labelsOf = (a) => [...(a.src || "").matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
      const outside = arrays.flatMap((a) => labelsOf(a).filter((l) => !vocab.has(l)).map((l) => `${a.n}:${l}`));
      check("N-6: 指標ラベルはすべて正典に出てくる語(言い換えを作らない)",
        outside.length === 0, outside.join(" | ") || "0件");
      // 【配列ごとに見る】前版は2配列の**和集合**で「正典の語が揃っているか」を見ていたため、
      // 片方から「音量」が消えても、もう片方に残っていれば通った
      // (審査役の実測: REED_COMPARE_METRICS の「音量」→「ボリューム」が、初版では撃墜できたのに
      //  配列を増やした版では生存した = **配列を足したことが配列ごとの検証を消していた**)。
      for (const a of arrays) {
        const ls = labelsOf(a);
        const lack = ["HNR", "重心", "音量"].filter((l) => !ls.includes(l));
        check(`N-6: ${a.n} は音色3指標のラベルを正典の語で持つ`,
          lack.length === 0, lack.length ? `欠け: ${lack.join("/")} / 実装 ${ls.join("/")}` : ls.join("/"));
      }
      // データタブの行に**実際に出る**3ラベルが、正典データタブの節の .l と一致すること。
      // キーの並び(MY_DATA_ROW_METRICS)を辿って解決するので、配列側の定義が変わると落ちる。
      {
        const rowKeys = new Function(`${extractConst("MY_DATA_ROW_METRICS")} return MY_DATA_ROW_METRICS;`)();
        const myData = extractConst("MY_DATA_METRICS");
        const labelFor = (k) => (new RegExp(`key: "${k}"[^}]*label: "([^"]+)"`).exec(myData) || [])[1];
        const rowLabels = rowKeys.map(labelFor);
        // 【集合ではなく**列ごとの対応**で見る】前版は両方向の包含＝集合の一致だったので、
        // 「音量」と「重心」の**ラベルだけ入れ替える**変異が生存した(審査役が実証)。
        // それが通ると画面には `1195Hz 音量` / `-21.9dB 重心` と出る。
        // 正典 .mrow は HNR / 重心 / 音量 の**並び**を持ち、MY_DATA_ROW_METRICS も同じ並びなので、
        // 正典の1行目の .l を**出現順のまま**取って添字で突き合わせる。
        const iSecond = rowBlock.indexOf('class="mrow"', 1);
        const firstRow = iSecond > 0 ? rowBlock.slice(0, iSecond) : rowBlock;
        const ordered = [...firstRow.matchAll(/<div class="l">([^<]+)<\/div>/g)].map((m) => m[1].trim());
        check("N-6: 正典の指標行から**並び順のまま**ラベルを読めている(空回りしていない)",
          ordered.length === 3 && ordered.join("/") === "HNR/重心/音量", ordered.join("/"));
        check("N-6: データタブの行は正典と同じ順で同じラベルを出す(列とラベルの対応まで一致)",
          rowLabels.length === ordered.length && rowLabels.every((l, i) => l === ordered[i]),
          `実装 ${rowLabels.join("/")} / 正典 ${ordered.join("/")}`);
        // 各ラベルが**正しいキーに付いている**ことを、単位まで見て確かめる
        // (ラベルだけ入れ替えると Hz の列が「音量」になる)。
        const UNIT_OF = { hnrDb: "dB", spectralCentroidHz: "Hz", volumeDb: "dB" };
        const unitFor = (k) => (new RegExp(`key: "${k}"[^}]*unit: "([^"]+)"`).exec(myData) || [])[1];
        const wrongUnit = rowKeys.filter((k) => unitFor(k) !== UNIT_OF[k]);
        check("N-6: 重心の列だけが Hz(ラベルとキーの対応が入れ替わっていない)",
          wrongUnit.length === 0 && labelFor("spectralCentroidHz") === "重心"
          && labelFor("volumeDb") === "音量" && labelFor("hnrDb") === "HNR",
          rowKeys.map((k) => `${k}:${labelFor(k)}/${unitFor(k)}`).join(" "));
        // 【平均差分】行の列には出ないが、ヒーローのグラフの軸見出しと読み上げ名そのもの。
        // REED_COMPARE_METRICS 側には同じ検査があるのに、こちらには無く、
        // 「平均差分」→「総評」(語彙の**中**の語)への変異が生存した(審査役が実証)。
        check("N-6: MY_DATA_METRICS のピッチのラベルも「平均差分」(N-2 表記統一)",
          labelFor("pitchCentsSigned") === "平均差分", String(labelFor("pitchCentsSigned")));
      }
    }
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
    // 【2026-08-15 本人指示】「ピッチがちょうど 0 のときの表示は 0.0¢ で」。
    // 書式は formatSignedCents 1つに寄せた(以前は同じ式が3箇所に写されていた)。
    // **綴りではなく挙動で見る**(前版は式を丸写しした正規表現だったので、
    //  同じ意味の書き換えでも落ち、規則を変える正しい修正も落とした)。
    check("符号付き指標の fmt は formatSignedCents を使う(書式を写さない)",
      /fmt: formatSignedCents/.test(myData) && /fmt: formatSignedCents/.test(reedCompare),
      `MY_DATA:${/fmt: formatSignedCents/.test(myData)} / REED:${/fmt: formatSignedCents/.test(reedCompare)}`);
    {
      const f = new Function(`${extractFunction("formatSignedCents")}; return formatSignedCents;`)();
      check("符号付き指標の fmt は正の値に \"+\" を前置する(0を挟んだ向きが読める)",
        f(3) === "+3.0" && f(0.05) === "+0.1" && f(12.34) === "+12.3",
        `${f(3)} / ${f(0.05)} / ${f(12.34)}`);
      check("符号付き指標の fmt は負の値に \"-\" を付ける",
        f(-3) === "-3.0" && f(-12.34) === "-12.3", `${f(-3)} / ${f(-12.34)}`);
      // **丸めた結果が 0.0 なら符号を付けない**。+0.0 も -0.0 も出さない。
      check("符号付き指標の fmt は 0 に符号を付けない(本人指示: ちょうど0は 0.0)",
        f(0) === "0.0" && f(-0) === "0.0" && f(0.04) === "0.0" && f(-0.04) === "0.0",
        `0→${f(0)} / -0→${f(-0)} / 0.04→${f(0.04)} / -0.04→${f(-0.04)}`);
    }
  }

  // --- 6.7b ピッチ指標の表記ゆれ禁止(F-46 本人指示 → N-2 表記統一で改訂) --------
  // F-46 で「平均ピッチ誤差」「ピッチの安定度」「ピッチ誤差(絶対値)」「平均ピッチ偏差」の
  // 4表記を「ピッチ誤差」に統一 → N-2(2026-08-10 本人決定)で表示は**「平均差分」**、
  // 副次テキストの「ばらつき」は**「標準偏差」**になった。旧表記(「ピッチ誤差」「ばらつき」を含む)が
  // 動く側(コメント除去後)のソースに1つも現れないことを固定する(経緯はコメントに書き残してよい)。
  {
    const liveSrc = codeOf(src);
    for (const old of ["平均ピッチ誤差", "ピッチの安定度", "ピッチ誤差(絶対値)", "平均ピッチ偏差", "ピッチ誤差", "ばらつき"]) {
      check(`旧表記「${old}」が動く側のソースに残っていない(表示は「平均差分」「標準偏差」に統一)`,
        !liveSrc.includes(old));
    }
  }

  // --- 6.7c N-2 表記統一(2026/08/11): 目安・英語のサックス種別・日付 yyyy/mm/dd ---
  // (1) 「理想値」「理想」「基準」(理想値プロファイルの意味のもの)→ 表示は「目安」。
  //     変数名(idealXxx)・IndexedDBのキー・関数名は変えない。**「基準ピッチ」(442Hz の
  //     チューニング基準)は別概念なので対象外**。「基準」は比較基準の意味(「絶対値基準」等)で
  //     正当に残るため綴り0件は固定できない。代わりに(a)「理想」の0件と、(b)機械置換の
  //     事故形「目安ピッチ」が現れないことを固定する。
  // (2) サックス種別の label は英語表記(Alto / Tenor / Soprano / Baritone)。
  //     保存データが参照するのは key の方なので、key は英小文字のまま変えない。
  // (3) 表示用の日付は formatYmd の1関数に寄せ、yyyy/mm/dd(ゼロ埋め)に統一。
  //     時刻が付く場所は { time: true } で yyyy/mm/dd hh:mm。
  {
    const liveSrc = codeOf(src);
    // (1) 目安への統一
    check("旧表記「理想」(理想値・理想:等)が動く側のソースに残っていない(表示は「目安」に統一)",
      !liveSrc.includes("理想"));
    for (const kept of ["目安に設定", "目安設定中", "目安との差", "目安未設定"]) {
      check(`新表記「${kept}」が動く側のソースに存在する(統一先が消えていない)`,
        liveSrc.includes(kept));
    }
    check("「基準ピッチ」を機械置換した事故形「目安ピッチ」が現れていない",
      !liveSrc.includes("目安ピッチ"));
    // (2) サックス種別の英語表記。key(保存データが参照)はそのまま、label だけ英語
    {
      const presets = new Function(`${extractConst("SAX_PRESETS")} return SAX_PRESETS;`)();
      const want = { soprano: "Soprano", alto: "Alto", tenor: "Tenor", baritone: "Baritone" };
      check("SAX_PRESETS の key は英小文字のまま過不足なし(保存データの互換)",
        JSON.stringify(Object.keys(presets).sort()) === JSON.stringify(Object.keys(want).sort()),
        Object.keys(presets).join(","));
      for (const [k, label] of Object.entries(want)) {
        check(`SAX_PRESETS.${k}.label は英語表記「${label}」`, presets[k]?.label === label,
          `${presets[k]?.label}`);
      }
      for (const old of ["アルト", "テナー", "ソプラノ", "バリトン"]) {
        check(`旧表記「${old}」が動く側のソースに残っていない(種別は英語表記)`,
          !liveSrc.includes(old));
      }
    }
    // (3) 日付表示 yyyy/mm/dd。formatYmd を実ソースから取り出して実際の出力で確かめる
    {
      const fy = new Function(`${extractFunction("formatYmd")} return formatYmd;`)();
      check("formatYmd は yyyy/mm/dd(月日ゼロ埋め)を返す",
        fy("2026-08-05T00:00:00") === "2026/08/05", `${fy("2026-08-05T00:00:00")}`);
      check("formatYmd は { time: true } で yyyy/mm/dd hh:mm(時分ゼロ埋め)を返す",
        fy("2026-08-05T09:07:59", { time: true }) === "2026/08/05 09:07",
        `${fy("2026-08-05T09:07:59", { time: true })}`);
      check("formatYmd は欠測・壊れた値で null を返す(呼び出し側が文言に振り替える)",
        fy(null) === null && fy("not-a-date") === null);
      // 端末ロケール依存の整形を表示に使わない(以前は toLocaleString("ja-JP") が3箇所、
      // toLocaleDateString("ja-JP") が1箇所あり、ゼロ埋め無し・秒付きで形が割れていた)
      check("表示用の日付整形に toLocaleString / toLocaleDateString を使っていない",
        !liveSrc.includes("toLocaleString") && !liveSrc.includes("toLocaleDateString"));
      // 配線(ハーネスはJSXを評価しないので綴りで縛る): 時刻つきの表示はすべて formatYmd に寄せた。
      // 【N-6 で 3 → 2】「最新セッション」カードは正典 .mrow の「最新 / yyyy/mm/dd」の行になり、
      // 時刻を出さなくなった(日付だけ)。**件数ではなく「どの関数が出しているか」の集合**で縛る
      // (件数の固定は、部品をまとめる/分けるという正しい修正を落とす)。
      {
        // セッション一覧(MyDataPage)と、別セッション整列の候補一覧(PhraseTimeline)。
        const TIME_OWNERS = ["MyDataPage", "PhraseTimeline"];
        const RE = () => /formatYmd\((?:s|session)\.recordedAt, \{ time: true \}\)/g;
        const countIn = (s) => (s.match(RE()) || []).length;
        const total = countIn(liveSrc);
        const inOwners = TIME_OWNERS.reduce((n, fn) => n + countIn(codeOf(srcOfFn(src, fn))), 0);
        for (const fn of TIME_OWNERS) {
          check(`${fn} の日時は formatYmd(..., { time: true })`, countIn(codeOf(srcOfFn(src, fn))) > 0);
        }
        check("時刻つきの recordedAt を出しているのは上の集合の中だけ",
          total === inOwners && total >= 2, `全体 ${total} / 集合内 ${inOwners}`);
      }
      check("PIVOTの日付次元も formatYmd を使う",
        /getValue: \(f\) => formatYmd\(f\.recordedAt\),/.test(liveSrc));
      check("リードの開始日表示(reedLabel)も formatYmd を使う",
        /formatYmd\(reed\.startDate\) \?\? "—"/.test(liveSrc));
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
    // 【N-8 2026/08/16 本人指示による書き換え】「今日」は「今日または直近の記録日」になり、
    // 綴りが todayFrames/todayVal → dayFrames/dayVal に変わった(フレームとラベルの出どころは
    // myDataTodayOrLatestFrames の1関数。検証28)。符号付きの縛りは同じ強さで残す。
    check("ヒーローの今日/直近日の値は符号付き(pitchCentsSigned)を使う",
      /const dayMetrics = dayFrames\.length \? computeFrameMetrics\(dayFrames\) : null;/.test(myDataSection) &&
      /const dayVal = dayMetrics \? dayMetrics\.pitchCentsSigned : null;/.test(myDataSection));
    check("ヒーローの対象期間平均も符号付き(pitchCentsSigned)を使う",
      /const periodVal = overall\.pitchCentsSigned;/.test(myDataSection));
    // 【F-56 で仕様が変わった】評価は「0からの距離だけ」の3段(Great/Good/Keep Trying)になり、
    // 対象期間平均との比較(旧 periodErr / MARGIN)は使わなくなった。よって periodErr の存在は
    // もう要求しない。**絶対値で評価する**という芯だけを引き続き固定する
    // (符号で良否を決めるように変えたら落ちる)。
    check("ヒーローの良否判定は絶対値(0からの距離)で評価する",
      /const dayErr = dayVal != null \? Math\.abs\(dayVal\) : null;/.test(myDataSection));
    check("ヒーローの良否判定に期間平均との比較を持ち込まない(F-56で0からの距離だけになった)",
      !/const periodErr\b/.test(codeOf(myDataSection)));

    // 【N-8 2026/08/16 本人指示による書き換え】旧「ヒーロー直下のスパークライン(時系列)」は
    // **廃止**され、同じ場所に音名軸の折れ線2本(NoteAxisLineChart の hero)が入った(検証28)。
    // 符号付き・0中央の対称軸・0の基準線という旧スパークラインの主張は、pitchCentsSigned を
    // 0 中央で描く NoteAxisLineChart(6.7 で固定済み)がそのまま引き継いでいる。
    // ここでは「時系列のスパークラインが戻っていない」ことだけを見る:
    // MyDataSection は svg を1つも直接描かない(折れ線はすべて NoteAxisLineChart 経由)。
    check("N-8: スパークラインが残っていない(sparkVals の綴りが動く側に無い)",
      !/sparkVals/.test(codeOf(src)));
    check("N-8: MyDataSection は svg を直接描かない(折れ線はすべて NoteAxisLineChart 経由)",
      !/<svg/.test(codeOf(myDataSection)) && !/<polyline/.test(codeOf(myDataSection)));
  }

  // --- 6.9 input[type=date] は appearance を落として幅を効かせる ------------
  // 本人報告(2026-08-04・3周目): 「使用開始日の横幅がまだずれている。必ず修正しろ」。
  // iOS Safari の input[type=date] はネイティブのdateコントロールとして描かれる間、
  // 固有の内容幅を優先して CSS の width:100% を無視する(Chromeは無視しないため
  // Browser pane では再現せず、2周ぶん見落とした)。appearance を落とすと素の箱になり
  // width が効く。**この2行を外すと実機でだけ再発する**ので外さないこと。
  // 【N-5】この欄は「新しいリードを登録」フォームの使用開始日から、
  // 「…」→「箱の開封日を編集」の中の開封日へ**移った**。要件(appearance を落として
  // 幅を効かせ、縦位置を自分で決める)は1つも下げずにそのまま引き継ぐ。
  // 【F-80 でもう一度移った】「…」のモードごと廃止し、箱見出しの日付タップで開く
  // 「箱を編集」シート(ReedBoxSheet)の中に置いた。**要件はここでも1つも下げない**
  // (行内に置かないぶん幅は広く取れるが、iOS Safari の固有幅の罠は同じなので同じ手当てをする)。
  {
    const sheet = srcOfFn(src, "ReedBoxSheet");
    const dateInput = sheet.slice(sheet.indexOf('type="date"'));
    const decl = dateInput.slice(0, dateInput.indexOf("/>"));
    check("開封日の入力欄を走査できている", decl.length > 100 && /type="date"/.test(decl), `${decl.length}文字`);
    check("開封日の input[type=date] は WebkitAppearance:none を持つ",
      /WebkitAppearance: "none"/.test(decl));
    check("開封日の input[type=date] は appearance:none も併記する(非WebKit系のため)",
      /appearance: "none"/.test(decl));
    check("開封日の input[type=date] は maxWidth:100% で親を超えないようにする",
      /maxWidth: "100%"/.test(decl));
    // 本人報告(2026-08-04)「横幅は直ったが縦幅が変わった」。appearance を落とすと幅と一緒に
    // **縦方向の固有の寸法も失われる**ため、行の高さを明示しないと中のテキストが上寄せに落ちる。
    check("開封日の input[type=date] は lineHeight を明示する(appearance:none で失う縦位置の補償)",
      /lineHeight: "1\.25"/.test(decl));
    check("開封日の input[type=date] は overflow:hidden を持つ(内部UIのはみ出しの最後の歯止め)",
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
    // 【F-75 で主張が変わった】メトロノームと「詳細を見る」トグルの枠線を撤去した。
    //   旧主張: どちらも A型(.ctl-state)= 見える枠線を持ち、ON は枠線の色で返す
    //   新主張: **見える枠線を1つも持たない**。ON/OFF・開閉は
    //           アイコンの色 / 山形の向き と aria-pressed / aria-expanded だけが返す。
    //           枠は `1px solid transparent` で**場所だけ**残す(外形を 1px も変えないため)。
    // 本人指示(2026/08/12・実機)「詳細タブも枠線を作る必要はない。メトロノームアイコンも同様に枠線不要」。
    // **主張は弱めていない**: 「A型である」→「枠線を持たないが、外形と状態の返し方は保つ」に
    // 置き換え、透明でない枠を書いたら落ちる形にしてある。
    {
      const i = src.indexOf('aria-label="メトロノーム"');
      const tag = i === -1 ? "" : tagAt(i);
      check("メトロノームのボタンを綴りで特定できている", tag !== "" && /aria-label="メトロノーム"/.test(tag), tag.slice(0, 120));
      check("F-75: メトロノームのボタンは型のクラス(.ctl-state)を持たない",
        !/className="[^"]*\bctl-(state|plain)\b/.test(tag),
        (tag.match(/className="[^"]*"/) || ["className 無し"])[0]);
      check("F-75: メトロノームのボタンは見える枠線を持たない(枠は透明で場所だけ残す)",
        /border: "1px solid transparent"/.test(tag) && !/border: "1px solid var\(--c-|border: "1\.5px/.test(tag),
        (tag.match(/border: "[^"]*"/) || ["border 無し"])[0]);
      check("F-75: メトロノームのボタンは地も持たない",
        /background: "transparent"/.test(tag), (tag.match(/background: "[^"]*"/) || ["background 無し"])[0]);
      // 外形は変えない(§6.1.5)。枠を 0 にすると 44×56 が 42×54 に縮む。
      check("F-75: メトロノームのボタンの外形は 44(--tap-min)×56 のまま",
        /width: "var\(--tap-min\)", height: 56/.test(tag), tag.replace(/\s+/g, " ").slice(0, 200));
      check("メトロノームのボタンは ON/OFF を aria-pressed で持つ",
        /aria-pressed=\{showMetroPanel\}/.test(tag));
      // 枠を消したので、ON/OFF の唯一の視覚的な合図は**アイコンの色**。ここが消えたら状態が読めない。
      check("F-75: ON/OFF はアイコンの色が返す(--c-accent #174585 / --c-ink-3 #8D95A1)",
        /<MetronomeIcon color=\{showMetroPanel \? "#174585" : "#8D95A1"\}/.test(code),
        (code.match(/<MetronomeIcon[^/]*/) || [""])[0].replace(/\s+/g, " ").slice(0, 160));
      // 旧実装(枠 + 地の両方)が残っていないこと
      check("メトロノームの旧実装(枠と地を両方持つ)が残っていない",
        !/showMetroPanel \? "1\.5px solid|showMetroPanel \? "#EAEFF5"/.test(code));
    }
    // 「詳細を見る」トグル = F-75 で枠線を撤去。開閉は山形の向きと aria-expanded が返す。
    {
      const i = src.indexOf('"詳細を閉じる"');
      const tag = i === -1 ? "" : tagAt(i);
      check("「詳細を見る」トグルを綴りで特定できている", tag !== "" && /aria-expanded=\{detailOpen\}/.test(tag), tag.slice(0, 120));
      check("F-75: 「詳細を見る」トグルは型のクラス(.ctl-state / .ctl-pill)を持たない",
        !/className="[^"]*\bctl-(state|plain|pill)\b/.test(tag),
        (tag.match(/className="[^"]*"/) || ["className 無し"])[0]);
      check("F-75: 「詳細を見る」トグルは見える枠線も地も持たない",
        /border: "1px solid transparent"/.test(tag) && /background: "transparent"/.test(tag)
        && !/border: "1px solid var\(--c-/.test(tag),
        (tag.match(/border: "[^"]*"/) || ["border 無し"])[0]);
      // 枠を 0 にすると 9+24+9 = 42px になり §5(44px)を割る。透明枠で 44 を保つ。
      check("F-75: 「詳細を見る」トグルの縦の当たり判定は 44px を保つ(9+24+9 + 透明枠 1×2)",
        /padding: "9px 0"/.test(tag) && /border: "1px solid transparent"/.test(tag),
        tag.replace(/\s+/g, " ").slice(0, 200));
      check("「詳細を見る」トグルは開閉を aria-expanded で持つ", /aria-expanded=\{detailOpen\}/.test(tag));
      // 枠を消したので、開閉の唯一の視覚的な合図は**山形の向き**。
      check("F-75: 開閉は山形の向きが返す(開=ChevronUp / 閉=ChevronDown)",
        /detailOpen\s*\?\s*<ChevronUp size=\{24\}[\s\S]{0,80}?:\s*<ChevronDown size=\{24\}/.test(code));
      check("「詳細を見る」トグルの旧実装(枠 #D9E1EC + 地 #F3F6FA)が残っていない",
        !code.includes('border: "1px solid #D9E1EC", background: "#F3F6FA"'));
    }
    // 【F-72 で主張が変わった】計測タブ上部の「奏者 / 楽器 / 基準ピッチ / リード」。
    //   旧主張: リード枠は B型(.ctl-plain)= 地 --c-sunken を持つ / 奏者枠は素の <select>
    //           (= 入力欄の規則の地 --c-sunken を持つ) で、両者の角丸が一致していること
    //   新主張: **どちらも地を持たない素のテキスト + ▾**(正典 .reedchip / .set1)。
    //           「触れる」の合図は地ではなく ▾ が担う。
    // 本人指示(2026/08/12・実機)「モックでは上部の奏者やリードもカード色を変えて
    // カード方式にしていない。モックに合わせて。モックどおり ▾ などがあれば
    // タップすれば選択肢が出るんだなと直感的に分かる」。
    // **主張は弱めていない**: 「地が無いこと」「▾ があること」「外形が変わっていないこと」を
    // 新たに縛り、地を戻したら落ちる形にしてある。
    {
      // 【差し戻し①で目印が変わった】option の綴りは reedBoxOptions へ集約したので、
      // 枠の目印は <label htmlFor="measure-reed-box"> だけになる。
      const i = src.indexOf('<label htmlFor="measure-reed-box"');
      const tag = i === -1 ? "" : tagAt(i + 1);
      check("計測タブのリード枠を綴りで特定できている", tag !== "" && /htmlFor="measure-reed-box"/.test(tag), tag.slice(0, 160));
      check("F-72: リード枠は型のクラス(.ctl-plain / .ctl-state)を持たない(地も枠も持たない)",
        !/className=/.test(tag), (tag.match(/className="[^"]*"/) || ["className 無し"])[0]);
      check("F-72: リード枠はインラインでも地・枠・角丸を持たない",
        !withPrefix([tag], ["background", "border", "borderradius", "boxshadow"]).length, tag.slice(0, 200));
      check("F-72: リード枠の padding は元のまま(地を落としても外形は 1px も変わらない)",
        /padding: "2px 4px 2px 10px"/.test(tag), (tag.match(/padding: "[^"]*"/g) || []).join(" | "));
      check("リード枠の旧実装(選択で地を塗り分ける)が残っていない",
        !/selectedReedId \? "#EAEFF5"/.test(code));
      // ▾。地が消えたので「押せば選択肢が出る」を形で示す唯一の合図。
      // **枠(label)の中に居ること**まで見る(外に出すとそこが当たり判定の穴になる)。
      {
        const lblEnd = i === -1 ? -1 : src.indexOf("</label>", i);
        const lbl = i === -1 || lblEnd === -1 ? "" : src.slice(i, lblEnd);
        check("F-72: リード枠の中に ▾(PickChevron)がある(正典 .reedchip の末尾)",
          /<PickChevron \/>/.test(lbl), lbl.replace(/\s+/g, " ").slice(-160));
      }
      // 中の select 2つは DESIGN-SYSTEM §6.6 が明記する**意図的な例外**(地も枠も持たない)。
      // 【F-72】ネイティブの三角を出さないため appearance も落とす。
      // 【差し戻し① で主張が変わった】
      //   旧主張: select が値を描く。appearance を落とすので §6.7 のとおり
      //           高さ・行送り・overflow を select 自身が持つ
      //   新主張: **値は <span> が描き、select は枠に重ねて透明にする。**
      //           select に値を描かせると箱の幅が「いちばん長い option」で決まり、
      //           「V16-3」と「#4」の間に 43.3px、「#4」と ▾ の間に 19.8px の空きが出ていた
      //           (実測。リード12枚・#4 選択時)。正典 .reedchip は間が半角空白1つ。
      //           重ねる形なら幅が値そのものになる。縦は包む <span> が TOPSET_REED_SELECT_H_PX で持つ。
      {
        const lblEnd = i === -1 ? -1 : src.indexOf("</label>", i);
        const lbl = i === -1 || lblEnd === -1 ? "" : src.slice(i, lblEnd);
        check("F-72: リード枠のブロックを走査できている", lbl.length > 400, `${lbl.length}文字`);
        const sels = lbl.match(/<select[\s\S]*?\n\s*>/g) || [];
        check("リード枠の中の select は2つ", sels.length === 2, `${sels.length}個`);
        check("リード枠の中の select 2つは地も枠も持たない(§6.6 の意図的な例外を維持)",
          sels.length === 2 && sels.every((t) => /background: "none", border: "none"/.test(t)),
          sels.map((t) => (t.match(/background: "[^"]*", border: "[^"]*"/) || ["無し"])[0]).join(" | "));
        check("F-72: リード枠の中の select は appearance を落としている(▾ が二重に出ない)",
          sels.length === 2 && sels.every((t) => /appearance: "none", WebkitAppearance: "none"/.test(t)),
          `${sels.filter((t) => /appearance: "none"/.test(t)).length}/2`);
        check("F-72: リード枠の select 2つは値を描かず、枠に重ねて透明にする(幅を option に引きずられない)",
          sels.length === 2 && sels.every((t) =>
            /position: "absolute", left: 0, top: 0, width: "100%", height: "100%"/.test(t)
            && /color: "transparent"/.test(t) && !/opacity: 0/.test(t)),
          sels.map((t) => (t.match(/position: "[^"]*"/) || ["無し"])[0]).join(" | "));
        // 縦は包む <span> が持つ(§6.7。上部設定行の高さ 60px = 環の位置を保つ)
        const wraps = lbl.match(/<span style=\{\{ position: "relative"[^}]*\}\}>/g) || [];
        check("F-72: 値と select を包む <span> は2つ(箱と個体)", wraps.length === 2, `${wraps.length}個`);
        check("F-72: 包む <span> が縦(TOPSET_REED_SELECT_H_PX)を持つ",
          wraps.length === 2 && wraps.every((t) => /height: TOPSET_REED_SELECT_H_PX/.test(t)),
          wraps.map((t) => (t.match(/height: [A-Z_]*/) || ["無し"])[0]).join(" | "));
        // 【差し戻し① 長い銘柄のはみ出し】maxWidth は幅の上限でしかなく、値を <span> に
        // 描かせる形では**上限を超えた文字が箱の外へそのまま描かれる**(実測: `D'Addario
        // Select Jazz-3S` 166.9px が maxWidth 110 を越え、隣の #3 に 56.4px 重なった)。
        // 素の <select> はコントロールの箱が値をクリップしていたので、これは HEAD からの退行だった。
        // 歯止めは**箱と値の両方**に要る(箱だけだと ellipsis が出ず、値だけだと flex で縮まない)。
        check("F-72: 値を包む箱に overflow:hidden がある(maxWidth を越えた文字を外へ描かせない)",
          wraps.length === 2 && wraps.every((t) => /overflow: "hidden"/.test(t)),
          wraps.map((t) => (t.match(/overflow: "[^"]*"/) || ["overflow 無し"])[0]).join(" | "));
        {
          // 値そのものの <span>(包む箱の直後にある、position を持たない方)
          // 【F-81 で1つ増えた】箱の開封日(値でも選択肢でもない**箱の説明**)が末尾に付いた。
          // 3つとも色を持つので、まず**総数**を固定し、役割ごとに分けて中身を見る。
          const colorSpans = (lbl.match(/<span style=\{\{ color: [^}]*\}\}>/g) || []);
          check("F-72/F-81: リード枠の中で色を持つ <span> は3つ(箱の値・個体の値・開封日)",
            colorSpans.length === 3, `${colorSpans.length}個`);
          const valSpans = colorSpans.slice(0, 2);
          check("F-72: リード枠の値の <span> は2つ(箱と個体)",
            valSpans.length === 2 && /selectedReedId \? "var\(--c-ink\)"/.test(valSpans[0])
            && /selectedReedId \? "var\(--c-ink-2\)"/.test(valSpans[1]),
            valSpans.map((t) => (t.match(/color: [^,]*/) || ["?"])[0]).join(" | "));
          check("F-72: リード枠の値は縮んで省略記号になる(minWidth:0 + overflow + textOverflow)",
            valSpans.length === 2 && valSpans.every((t) =>
              /minWidth: 0/.test(t) && /overflow: "hidden"/.test(t) && /textOverflow: "ellipsis"/.test(t)),
            valSpans.map((t) => t.replace(/\s+/g, " ").slice(0, 140)).join(" | "));
          // 【F-81】開封日は**箱の説明**なので、値(--c-ink / --c-ink-2)より弱い段に落とす。
          // 折り返さず、縮まず(flexShrink:0)、省略記号も出さない = 日付は全桁読める。
          const dateSpan = colorSpans[2] || "";
          check("F-81: 開封日は値より弱い段(--c-ink-3)の素の文字",
            /color: "var\(--c-ink-3\)"/.test(dateSpan), dateSpan.replace(/\s+/g, " ").slice(0, 140));
          check("F-81: 開封日は折り返さず縮まない(全桁読める)",
            /whiteSpace: "nowrap"/.test(dateSpan) && /flexShrink: 0/.test(dateSpan)
            && !/textOverflow/.test(dateSpan), dateSpan.replace(/\s+/g, " ").slice(0, 140));
          // 表記は yyyy/mm/dd(§6.0)。formatYmd を通すので月日だけの独自表記は作れない。
          check("F-81: 開封日は formatYmd(yyyy/mm/dd)を通す(独自の日付表記を作らない)",
            /\{selectedBoxGroup && formatYmd\(selectedBoxGroup\.startDate\) && \(/.test(lbl)
            && /· \{formatYmd\(selectedBoxGroup\.startDate\)\}/.test(lbl));
          check("F-81: 箱を選んでいないときは開封日を出さない(今に関係ない物は出ていない)",
            /\{selectedBoxGroup && formatYmd/.test(lbl));
        }
        // 【差し戻し②】箱と個体の間隔を作っているのは label の gap ではなく、
        // **個体を包む箱の marginLeft**。gap:0 だけを見る検査では marginLeft を広げる変異を
        // 通してしまう(43.3px 空く状態の復元。前回の不合格理由そのもの)。値で縛る。
        check("F-72: 箱と個体の間隔は --sp-1 だけ(marginLeft を広げると「1つの塊」に読めなくなる)",
          wraps.length === 2 && /marginLeft: "var\(--sp-1\)"/.test(wraps[1]) && !/marginLeft/.test(wraps[0]),
          wraps.map((t) => (t.match(/marginLeft: [^,}]*/) || ["marginLeft 無し"])[0]).join(" | "));
        // 【綴りの一元化】見えているテキストと <option> が**同じ配列**から作られていること。
        // 2箇所に書くと「見えている値と選択肢がずれる」という最悪の壊れ方をする。
        for (const [name, arr] of [["箱", "reedBoxOptions"], ["個体", "reedMemberOptions"]]) {
          check(`F-72: リード枠の${name}は ${arr} からテキストも <option> も作る(綴りを2箇所に置かない)`,
            new RegExp(`\\(${arr}\\.find\\(\\(o\\) => o\\.value ===`).test(lbl)
            && new RegExp(`${arr}\\.map\\(\\(o\\) => \\(<option`).test(lbl),
            lbl.replace(/\s+/g, " ").slice(0, 200));
          check(`F-72: ${arr} の定義がある(先頭は未選択のときのラベル)`,
            new RegExp(`const ${arr} = \\[\\s*\\{ value: "",`).test(src),
            (src.match(new RegExp(`const ${arr} = \\[[^\\n]*`)) || ["無し"])[0]);
        }
      }

      // --- リード枠の「横方向の間隔」を**集合ごと**突き合わせる ---------------
      // 【なぜ綴りの数え上げでは駄目か】前の版は「枠の中の marginLeft は1箇所」しか見ておらず、
      // 審査役の5変異が全部生存した: 箱の包みに marginRight:40 / paddingRight:40 を足す、
      // 個体の包みに paddingLeft:36 を足す、幅だけを持つ span を間に挟む、▾ の前に同じ span を挟む。
      // どれも差し戻し②の状態(「V16-3」と「#4」が離れる / ▾ が隣の記号に見える)を復元する。
      // **間隔は marginLeft 以外の手段でいくらでも作れる**ので、綴りを1つ数えても意味が無い。
      //
      // ここでは (a) label の直下の子を4つに固定し (b) 枠の中の**横方向に効く宣言を全部集めて**
      // 期待する集合とそのまま突き合わせる。期待集合は「何のためにその値があるか」を
      // 1行ずつ書いた仕様表で、実装から機械的に写したものではない。
      // 集合に無い宣言が1つでも増えれば落ちる = 間隔を作る新しい経路を塞げる。
      {
        // 【専用のコメント除去】このファイルの codeOf / codeSafe は
        // accept="audio/*,video/*" の `/*` をコメント開始と読んで数百行を消す既知の罠がある。
        // ここは JSX の構造を数えるので、文字列・テンプレートの中を壊さない除去器を使う。
        const stripJs = (s) => {
          let out = "", i = 0; const n = s.length;
          while (i < n) {
            const c = s[i], d = s[i + 1];
            if (c === '"' || c === "'" || c === "`") {
              const q = c; out += c; i++;
              while (i < n) { const ch = s[i]; out += ch; if (ch === "\\") { out += s[i + 1] ?? ""; i += 2; continue; } i++; if (ch === q) break; }
              continue;
            }
            if (c === "/" && d === "/") { while (i < n && s[i] !== "\n") { out += " "; i++; } continue; }
            if (c === "/" && d === "*") { while (i < n && !(s[i] === "*" && s[i + 1] === "/")) { out += s[i] === "\n" ? "\n" : " "; i++; } out += "  "; i += 2; continue; }
            out += c; i++;
          }
          return out;
        };
        const codeJs = stripJs(src);
        // 除去器そのものが空回りしていないことの確認(コードを食っていない / コメントは消えている)
        check("F-72: コメント除去器が壊れていない(文字列の中の /* を食っていない)",
          /accept="audio\/\*,video\/\*"/.test(codeJs) && !/正典 \.reedchip の末尾の ▾/.test(codeJs),
          `accept 残存=${/accept="audio/.test(codeJs)} / コメント残存=${/正典 \.reedchip の末尾の ▾/.test(codeJs)}`);

        const tagEnd = (s, from) => { let d = 0; for (let k = from; k < s.length; k++) { const ch = s[k]; if (ch === "{") d++; else if (ch === "}") d--; else if (ch === ">" && d === 0) return k + 1; } return s.length; };
        const lo = codeJs.indexOf('<label htmlFor="measure-reed-box"');
        const openEnd = tagEnd(codeJs, lo);
        const closeAt = codeJs.indexOf("</label>", lo);
        const openTag = lo === -1 ? "" : codeJs.slice(lo, openEnd);
        const body = lo === -1 || closeAt === -1 ? "" : codeJs.slice(openEnd, closeAt);
        check("F-72: リード枠の開きタグと中身を走査できている", openTag !== "" && body.length > 300,
          `開きタグ ${openTag.length}文字 / 中身 ${body.length}文字`);

        // 直下の子と、枠の中の全タグ(順番つき)
        const allTags = [], children = [];
        {
          let d = 0, k = 0;
          while (k < body.length) {
            if (body[k] === "<") {
              if (body[k + 1] === "/") { d--; k = body.indexOf(">", k) + 1; continue; }
              const e = tagEnd(body, k);
              const tg = body.slice(k, e);
              const nm = (/^<([A-Za-z][\w.]*)/.exec(tg) || [, "?"])[1];
              const self = /\/>\s*$/.test(tg);
              allTags.push({ name: nm, tag: tg });
              if (d === 0) children.push(nm + (self ? "/" : ""));
              if (!self) d++;
              k = e; continue;
            }
            k++;
          }
        }
        // (a) 直下の子は「点 / 箱の包み / 個体の包み / 開封日 / ▾」の5つ**ちょうど**。
        //     スペーサーを1つ挟めばここで落ちる(幅を持たない span でも落ちる)。
        // 【F-81 で4→5】箱の開封日が個体と ▾ の間に入った(本人指示「開封日も追加して」)。
        check("F-72/F-81: リード枠の直下の子は 点span・箱の包み・個体の包み・開封日・▾ の5つちょうど",
          JSON.stringify(children) === JSON.stringify(["span/", "span", "span", "span", "PickChevron/"]),
          JSON.stringify(children));

        // (b) 横方向に効く宣言の**集合**。左右方向の位置・幅・余白に効きうる名前を全部拾う。
        const splitTop2 = (b) => { const out = []; let d = 0, cur = ""; for (const ch of b) { if ("([{".includes(ch)) d++; else if (")]}".includes(ch)) d--; if (ch === "," && d === 0) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
        const styleDecls = (tg) => {
          const i2 = tg.indexOf("style={{"); if (i2 === -1) return [];
          let d = 0, start = i2 + 7, end = -1;
          for (let k = start; k < tg.length; k++) { if (tg[k] === "{") d++; else if (tg[k] === "}") { d--; if (d === 0) { end = k; break; } } }
          if (end === -1) return [];
          return splitTop2(tg.slice(start + 1, end)).map((p) => { const j = p.indexOf(":"); return { name: p.slice(0, j).trim(), value: p.slice(j + 1).trim() }; });
        };
        const HORIZ = /^(margin|padding|gap|columnGap|width|minWidth|maxWidth|left|right|inset)/;
        const got = [];
        [{ name: "label", tag: openTag }, ...allTags].forEach((t, i2) => {
          styleDecls(t.tag).filter((d) => HORIZ.test(d.name)).forEach((d) => got.push(`${i2}:${t.name}:${d.name}=${d.value}`));
        });
        // 期待する集合。**何のためにその宣言があるか**を1つずつ書く。
        // 番号はリード枠の中のタグの並び順(0=label / 1=点 / 2=箱の包み / 3=箱の値 /
        // 4=箱のselect / 5=option / 6=個体の包み / 7=個体の値 / 8=個体のselect / 9=option /
        // 10=開封日(F-81 で挿入) / 11=▾)。
        // 並びが変われば番号がずれるので、タグを挟む変異もここで落ちる。
        const want = [
          '0:label:gap=0',                              // 間隔は gap では作らない(0 に固定)
          '0:label:padding="2px 4px 2px 10px"',         // 枠の内側の余白。N-4 で当たり判定を塞いだ値のまま
          '1:span:width=6',                             // 選択済みを示す点の直径
          '1:span:marginRight=2',                       // 点と銘柄の間
          '2:span:maxWidth=110',                        // 銘柄の幅の上限
          '3:span:minWidth=0',                          // flex で縮ませる(ellipsis を出すため)
          '4:select:left=0',                            // 重ねた透明 select(枠にぴったり)
          '4:select:width="100%"',
          '4:select:padding=0',
          '6:span:maxWidth=60',                         // 個体の幅の上限
          '6:span:marginLeft="var(--sp-1)"',            // **箱と個体の間隔はこの1つだけ**(正典の半角空白1つ)
          '7:span:minWidth=0',
          '8:select:left=0',
          '8:select:width="100%"',
          '8:select:padding=0',
          // 【F-81】開封日と個体の間。**個体と ▾ の間隔(--sp-1)と同じ**で、
          // 「V16-3 #4 · 2026/08/13 ▾」が1つの塊に読めるようにする(F-72 の差し戻しの理由と同じ)。
          '10:span:marginLeft="var(--sp-1)"',
        ];
        const missing = want.filter((x) => !got.includes(x));
        const extra = got.filter((x) => !want.includes(x));
        check("F-72: リード枠の横方向の宣言は仕様表どおり(足りない物が無い)",
          missing.length === 0, missing.join(" | "));
        check("F-72: リード枠に仕様表に無い横方向の宣言が増えていない(間隔を作る新しい経路を塞ぐ)",
          extra.length === 0, extra.join(" | "));
      }
      // 奏者枠。<select> は ▾ を中に持てないので、枠まるごとを <label htmlFor> にして
      // ▾ をその中へ入れる(リード枠と同じ手)。地は落とすが、透明枠は残して外形を保つ。
      //
      // 【F-72 の適用範囲。審査①の差し戻しで作った縛り】
      // PerformerSelector は**共有部品**で、計測タブとセッション詳細の2箇所から呼ばれる。
      // 1周目は無条件に地を落としてしまい、**N-6 が未着手のセッション詳細まで巻き添えにした**
      // (同じ行の隣のリード <select> は --c-sunken のままなので、1行に入力欄の作法が2種類並んだ)。
      // 北極星モックは計測タブしか描いていないので §6.0 の「モックが勝つ」はあちらに及ばない。
      // ここは「bare を渡した呼び出しだけが F-72 の見た目になる」ことを**両方の枝**で縛る。
      {
        const psStart = src.indexOf("function PerformerSelector(");
        const psEnd = src.indexOf("\nfunction ", psStart + 10);
        const ps = psStart === -1 ? "" : src.slice(psStart, psEnd);
        check("F-72: PerformerSelector を走査できている", ps.length > 500, `${ps.length}文字`);
        // (0) 既定は bare でない。既定を反転させると、次に増えた呼び出しへ黙って漏れる。
        check("F-72: PerformerSelector の既定は bare でない(漏れる側を既定にしない)",
          /function PerformerSelector\(\{[^}]*\bbare = false\b/.test(ps),
          (ps.match(/function PerformerSelector\(\{[^}]*\}/) || [""])[0].replace(/\s+/g, " ").slice(0, 200));
        // (1) bare でない枝 = HEAD のまま。地・枠・appearance・高さのどれも持たない素の <select>。
        const plain = (ps.match(/if \(!bare\) \{[\s\S]*?\n  \}/) || [""])[0];
        check("F-72: bare でない枝がある(セッション詳細はこちらを使う)", plain !== "", plain.slice(0, 80));
        const plainSel = (plain.match(/<select[\s\S]*?\n\s*>/) || [""])[0];
        check("F-72: bare でない枝の <select> は入力欄の規則そのまま(地・枠・appearance・高さを持たない)",
          plainSel !== "" && /style=\{\{ pointerEvents: "auto" \}\}/.test(plainSel)
          && !/background|appearance|height|lineHeight|overflow|border/.test(plainSel),
          plainSel.replace(/\s+/g, " ").slice(0, 220));
        check("F-72: bare でない枝は ▾ を持たない(セッション詳細に計測タブの作法を漏らさない)",
          !/<PickChevron \/>/.test(plain), plain.replace(/\s+/g, " ").slice(0, 200));
        check("F-72: bare でない枝は id を持たない(画面名を部品の中に直書きしない)",
          !/id=/.test(plainSel), plainSel.replace(/\s+/g, " ").slice(0, 160));
        // (2) bare の枝 = 正典 .set1。id は**呼び出し側から**受け取る。
        const bareStart = ps.indexOf("htmlFor={selectId}");
        const bare = bareStart === -1 ? "" : ps.slice(ps.lastIndexOf("<label", bareStart), ps.indexOf("</label>", bareStart));
        check("F-72: bare の枝は <label htmlFor={selectId}> で ▾ を抱えている",
          bare !== "" && /<PickChevron \/>/.test(bare) && /<select\s*\n?\s*id=\{selectId\}/.test(bare),
          bare.replace(/\s+/g, " ").slice(0, 200));
        const psel = (bare.match(/<select[\s\S]*?\n\s*>/) || [""])[0];
        check("F-72: bare の select は地を持たない(入力欄の規則の --c-sunken を打ち消す)",
          /background: "none"/.test(psel), (psel.match(/background: "[^"]*"/) || ["background 無し"])[0]);
        check("F-72: bare の select は appearance を落としている(ネイティブの三角を出さない)",
          /appearance: "none", WebkitAppearance: "none"/.test(psel), psel.replace(/\s+/g, " ").slice(0, 220));
        // 【差し戻し①】値は <span> が描き、<select> は**枠に重ねて透明にする**。
        //   <select> の固有幅は「いちばん長い option」で決まるので、値を <select> に描かせると
        //   値が短いときに ▾ が右へ離れ、隣の項目の記号に見える(実測 76.0px 離れ / 隣とは 10.0px)。
        //   重ねる形は幅が option に引きずられない。
        //   **近接そのもの(▾ と値の距離 < ▾ と隣の距離)はハーネスでは縛れない**(書体の字幅が無い)。
        //   ここで縛るのは「値を <span> が描き、<select> が枠全体に重なっている」という構造だけ。
        check("F-72: bare の枠は値を <span> が描く(<select> の固有幅に ▾ の位置を引きずられない)",
          /<span style=\{\{ color: "var\(--c-ink\)", whiteSpace: "nowrap",[^}]*\}\}>\{selectedPerformer\}<\/span>/.test(bare),
          bare.replace(/\s+/g, " ").slice(0, 260));
        // 【差し戻し①】奏者は**幅の上限を持たない**(枠の中に続くのが ▾ だけで、上限が無ければ
        // 箱の幅は値そのものになり、はみ出しようが無い)。上限を付ける = px を決めることなので
        // 発明しない。歯止め(overflow/textOverflow)は上限を持ったときに効くよう入れてある。
        check("F-72: 奏者の値にも歯止め(minWidth:0 + overflow + textOverflow)が入っている",
          /minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" \}\}>\{selectedPerformer\}/.test(bare),
          bare.replace(/\s+/g, " ").slice(0, 260));
        // 「無いこと」を主張するので **codeOf(コメント除去)を通してから見る**(LOOP.md)。
        // 通さないと、経緯をコメントに書いただけで落ちる(実際に一度落とした)。
        {
          // codeOf はコメントを詰めるので位置がずれる。**除去後の文字列で取り直す。**
          const codeAll = codeOf(src);
          const p0 = codeAll.indexOf("function PerformerSelector(");
          const psc = p0 === -1 ? "" : codeAll.slice(p0, codeAll.indexOf("\nfunction ", p0 + 10));
          const bs = psc.indexOf("htmlFor={selectId}");
          const bareCode = bs === -1 ? "" : psc.slice(psc.lastIndexOf("<label", bs), psc.indexOf("</label>", bs));
          check("F-72: bare の枝をコメント除去後にも走査できている", bareCode.length > 200, `${bareCode.length}文字`);
          check("F-72: 奏者の枠は幅の上限を持たない(maxWidth を発明しない)",
            !/maxWidth/.test(bareCode), (bareCode.match(/maxWidth[^,}]*/) || ["maxWidth 無し"])[0]);
        }
        check("F-72: bare の select は枠全体に重なる(左上0・幅高さ100%)",
          /position: "absolute", left: 0, top: 0, width: "100%", height: "100%"/.test(psel),
          psel.replace(/\s+/g, " ").slice(0, 240));
        // 透明化は opacity ではなく color。opacity:0 だと :focus-visible の輪郭まで消える。
        check("F-72: bare の select は color: transparent で透明にする(opacity:0 にしない)",
          /color: "transparent"/.test(psel) && !/opacity: 0/.test(psel),
          psel.replace(/\s+/g, " ").slice(0, 240));
        // 枠(label)の高さで上部設定行の高さを保つ(§6.1.5。環を動かさない)
        check("F-72: bare の枠の高さは TOPSET_PERFORMER_H_PX(行の高さ=環の位置を保つ)",
          /height: TOPSET_PERFORMER_H_PX/.test(bare.slice(0, bare.indexOf("<span"))),
          bare.slice(0, 240).replace(/\s+/g, " "));
        check("F-72: bare の枠は重ねるための位置指定を持つ(position: relative)",
          /position: "relative"/.test(bare.slice(0, bare.indexOf("<span"))),
          bare.slice(0, 240).replace(/\s+/g, " "));
        // 位置の比較は**コメント中の `<select>` を拾わない目印**(id={selectId})で見る
        check("F-72: ▾ は重ねた <select> より前(=枠の中)にある",
          bare.indexOf("<PickChevron />") !== -1 && bare.indexOf("<PickChevron />") < bare.indexOf("id={selectId}"),
          `▾ ${bare.indexOf("<PickChevron />")} / select ${bare.indexOf("id={selectId}")}`);
        // (3) 呼び出し側。bare を渡すのは計測タブだけ。
        const calls = [...src.matchAll(/<PerformerSelector[\s\S]*?\/>/g)].map((m) => m[0]);
        check("F-72: PerformerSelector の呼び出しは2箇所(計測タブ / セッション詳細)",
          calls.length === 2, `${calls.length}箇所`);
        const bareCalls = calls.filter((t) => /\bbare\b/.test(t));
        check("F-72: bare を渡しているのは1箇所だけ", bareCalls.length === 1,
          bareCalls.map((t) => t.replace(/\s+/g, " ").slice(0, 120)).join(" | "));
        check("F-72: bare を渡しているのは計測タブの呼び出し(disabled={isRecording} を持つ側)",
          bareCalls.length === 1 && /disabled=\{isRecording\}/.test(bareCalls[0])
          && /selectId="measure-performer-select"/.test(bareCalls[0]),
          bareCalls[0] ? bareCalls[0].replace(/\s+/g, " ").slice(0, 200) : "");
        // セッション詳細側 = 残り1件。bare も selectId も渡していないこと。
        const otherCalls = calls.filter((t) => !/\bbare\b/.test(t));
        check("F-72: セッション詳細の呼び出しは bare も selectId も渡していない(HEAD のまま)",
          otherCalls.length === 1 && !/selectId/.test(otherCalls[0]) && /session\.performer/.test(otherCalls[0]),
          otherCalls[0] ? otherCalls[0].replace(/\s+/g, " ").slice(0, 200) : "");
      }
      // 【審査③→②の差し戻し】appearance を落とすのは DESIGN-SYSTEM §6.7 が
      // 「**Chrome の実測は判定に使えない。必ず実機(iOS Safari)で確認すること**」と
      // 名指ししている領域。TOPSET_* の値の根拠はすべて Chrome の実測なので、
      // 「未検証だと分かる状態」が消えたら落ちるようにする。
      //
      // 【この検査が守るもの／守らないもの。書き分ける】
      //   守る: TOPSET_* の直前に **1行で** 「Chrome … 判定不能 … 実機待ち」と書かれた
      //         見出しがあること。**行を要求する**ので、見出しを言い換えて留保を外す変異は落ちる。
      //   守る: 本文に「(Chrome の実測は)証明にはならない / 判定には使えない」に当たる
      //         **留保の一文が残っていること**。留保ごと消す変異はここで落ちる。
      //   守らない: **その留保が日本語として正しく効いているか**は見ていない。
      //         意味は正規表現では判定できない。留保の一文を残したまま別の場所へ
      //         断定を書き足すことは原理的に可能で、下の禁止語の列挙はその一部を拾うだけ
      //         (列挙外の言い回しはすり抜ける)。これは「綴りの検査で意味は縛れない」
      //         という限界であって、縛っているつもりで書いていない。
      // 前回はここを「直前1600文字に3つの綴りがあるか」だけで見ており、見出しを言い換える変異も
      // 本文を断定に置き換える変異も**両方すり抜けた**のに「見出し行を要求する形に強化した」と
      // 報告していた。検査の実装と説明が食い違っていた(その申告は誤り)。
      {
        // 【アンカーを付け替えた】以前は死んだ定数 TOPSET_LINE_H_PX を位置決めに使っており、
        // **その定数を消すとテストが落ちる**= 負債を固定する構造になっていた(審査③)。
        // 実際に使われている TOPSET_PERFORMER_H_PX を目印にする。
        const at = src.indexOf("const TOPSET_PERFORMER_H_PX");
        const note = at === -1 ? "" : src.slice(Math.max(0, at - 1900), at);
        check("F-72: TOPSET_* の定数を綴りで特定できている", at !== -1);
        // 【死んだ定数を残さない。名指しではなく App.jsx 全体の一般形で見る】
        // 前の版は「テストに自分で書いた2つの名前を自分で数える」だけで、
        // 別名の死んだ定数を足す変異も、定義を消して参照だけ残す変異も素通りした
        // (検査名が「定義があるのに参照が無い状態を落とす」と、書いていない範囲を主張していた)。
        // ここでは **SCREAMING_CASE の定数を全部拾って**、
        //   (1) 定義があるのに参照が0件  (2) 参照があるのに定義が無い
        // の両方を落とす。**除外は0件**(現状 188個すべてが参照されている)。
        // const だけでなく let / var の定義も拾う(let で復活させる逃げ道を塞ぐ)。
        {
          // コメントを消す除去器。blankStrings=true なら文字列・テンプレートの**中身**も空にする。
          //   ・死んだ定数を探すときは中身を残す(テンプレートの `${定数}` も参照として数えるため)
          //   ・未定義の識別子を探すときは中身を空にする(色の "#FFFFFF" 等を識別子と誤認しないため)
          // このファイルの codeOf は accept="audio/*,video/*" の `/*` で数百行を消す既知の罠があるので使わない。
          const strip = (s, blankStrings) => {
            let out = "", i2 = 0; const n = s.length;
            while (i2 < n) {
              const c = s[i2], d = s[i2 + 1];
              if (c === '"' || c === "'" || c === "`") {
                const q = c; out += c; i2++;
                while (i2 < n) {
                  const ch = s[i2];
                  if (ch === "\\") { out += blankStrings ? "  " : ch + (s[i2 + 1] ?? ""); i2 += 2; continue; }
                  i2++;
                  if (ch === q) { out += q; break; }
                  out += blankStrings ? (ch === "\n" ? "\n" : " ") : ch;
                }
                continue;
              }
              if (c === "/" && d === "/") { while (i2 < n && s[i2] !== "\n") { out += " "; i2++; } continue; }
              if (c === "/" && d === "*") { while (i2 < n && !(s[i2] === "*" && s[i2 + 1] === "/")) { out += s[i2] === "\n" ? "\n" : " "; i2++; } out += "  "; i2 += 2; continue; }
              out += c; i2++;
            }
            return out;
          };
          const codeKeep = strip(src, false);
          const codeBare = strip(src, true);
          const WORD = (nm) => new RegExp("(?<![\\w$])" + nm + "(?![\\w$])", "g");
          // 定義。`const A = 1, B = 2;` の**2つ目以降**も拾う(1つ目しか見ないと B が未定義に見える)。
          const defs = new Set();
          for (const m of codeKeep.matchAll(/\b(?:const|let|var)\s+([^\n;]*)/g))
            for (const d of m[1].matchAll(/(?<![\w$])([A-Z][A-Z0-9_]*)\s*=(?!=)/g)) defs.add(d[1]);
          // 走査が空回りしていないことの下限(定数を全部消して「0件だから合格」を作らせない)
          check("App.jsx の SCREAMING_CASE 定数を走査できている", defs.size >= 150, `${defs.size}個`);
          // (1) 定義があるのに参照0件 = 死んだ定数。**除外は0件**(現状すべて参照されている)。
          const dead = [...defs].filter((nm) => (codeKeep.match(WORD(nm)) || []).length < 2);
          check("App.jsx に「定義だけで参照0件」の定数が1つも無い(除外なし)",
            dead.length === 0, dead.join(" "));
          // (2) 参照はあるのに定義が無い = 実行時 ReferenceError。定義だけ消す変異をここで落とす。
          // 【この走査の限界】JSX の地の文(`>HNR</th>` や `>HNR: {…}`)は識別子ではないので外す。
          // その判定は「直前の非空白が > で、直後の非空白が < か { か :」という**形**で行うため、
          // `a > MAX : b` のような三項の一部も同じ形になり、そこだけは見落とす。
          // テンプレート文字列の中だけで使われている定数も(中身を空にしているので)見落とす。
          // **完全ではない**が、名指しの2定数を数えるだけだった前の版よりは広い。
          const JS_GLOBAL_UPPER = ["URL", "AudioContext", "Float32Array", "Uint8Array", "MediaRecorder", "ResizeObserver", "JSON", "NaN"];
          const used = new Set();
          // 【速度】元は一致ごとに `codeBare.slice(0, m.index)` と `codeBare.slice(m.index + …)`
          // で **500KB の文字列を2本作って**いた。一致は数千件あるので、この1ループだけで
          // 110,341ms(検証ゲート全体の大半)を使っていた(統括の実測 → 行番号を打って特定)。
          // 見ているのは「直前の非空白1文字」と「直後の非空白1文字」だけなので、
          // 切り出さずに前後へ1文字ずつ走る。**判定の結果は完全に同じ**
          // (前が無ければ "" / 後ろが無ければ "" になるところまで含めて元と一致)。
          const isWs = (ch) => ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v";
          const prevNonWs = (s, i) => { let k = i - 1; while (k >= 0 && isWs(s[k])) k--; return k >= 0 ? s[k] : ""; };
          const nextNonWs = (s, i) => { let k = i; while (k < s.length && isWs(s[k])) k++; return k < s.length ? s[k] : ""; };
          for (const m of codeBare.matchAll(/(?<![\w$])([A-Z][A-Z0-9_]{2,})(?![\w$])/g)) {
            const before = prevNonWs(codeBare, m.index);
            const after = nextNonWs(codeBare, m.index + m[1].length);
            if (before === ">" && (after === "<" || after === "{" || after === ":")) continue;
            used.add(m[1]);
          }
          const undef = [...used].filter((nm) => !defs.has(nm) && !JS_GLOBAL_UPPER.includes(nm));
          check("App.jsx に「参照はあるのに定義が無い」定数が1つも無い(定義だけ消すと落ちる)",
            undef.length === 0, undef.join(" "));
        }
        check("F-72: 削除した TOPSET_LINE_H_PX が定数として復活していない(let / var も塞ぐ)",
          !/\b(?:const|let|var)\s+TOPSET_LINE_H_PX\b/.test(codeOf(src)), "");
        // 見出しは**同一行**であることを要求する(行をまたいだ3綴りでは通らない)
        const HEAD_RE = /^[ \t]*\/\/[^\n]*Chrome[^\n]*判定不能[^\n]*実機待ち[^\n]*$/m;
        check("F-72: TOPSET_* の直上に「Chrome では判定不能・実機待ち」の見出しが1行である(§6.7)",
          HEAD_RE.test(note), (note.match(/^[ \t]*\/\/[^\n]*(判定不能|実機待ち)[^\n]*$/m) || ["見出し行が無い"])[0]);
        // 留保の一文そのものを要求する。**禁止語の列挙だけでは網羅できない**ので、
        // 「Chrome の実測は証明にならない」に当たる一文が消えたら落ちる形を本体にする。
        // 留保は3つある。**別々に**要求する(1つだけ消す変異を通さないため)。
        // §6.7 の引用だけを残して結論を断定に書き換える変異が実際にすり抜けたので、
        // 「引用が在ること」と「結論が留保のままであること」を分けて見る。
        //   (1) §6.7 の引用(Chrome の実測は判定に使えない)
        //   (2) この節の結論(3つの値は証明にはならない)
        //   (3) 帰結(実機で見るまで分からない)
        // **綴りに寄せた検査**なので、言い換えて書き直すときは検査側も直すこと。
        check("F-72: 留保(1) §6.7 の引用「Chrome の実測は判定に使えない」が残っている",
          /判定に(は)?使えない/.test(note), note.replace(/\s+/g, " ").slice(-220));
        check("F-72: 留保(2) 結論「(Chrome の実測は)証明にはならない」が残っている",
          /証明にはならない/.test(note), note.replace(/\s+/g, " ").slice(-220));
        check("F-72: 留保(3)「実機で見るまで分からない」が残っている",
          /実機で[^\n]*分からない/.test(note), note.replace(/\s+/g, " ").slice(-220));
        // 二の網。よくある断定の言い回しだけを拾う(列挙外はすり抜ける。上のコメント参照)。
        const BAN = /(で確定する|で確定します|検証済み\)|エンジンに依存しない|実機でも同じ|実機でも変わらない|保証できる|確定とする)/;
        check("F-72: 本文を「実機でも確定」型の断定に書き換えていない(禁止する言い回しの列挙)",
          !BAN.test(note), (note.match(new RegExp("[^\\n]*" + BAN.source + "[^\\n]*")) || [""])[0]);
      }
      // 楽器種別 / 基準ピッチ。元から地も枠も無いので、F-72 で足したのは ▾ だけ。
      {
        const saxBtn = (code.match(/<button onClick=\{\(\) => setOpenPicker\("sax"\)\}[\s\S]*?<\/button>/) || [""])[0];
        const tunBtn = (code.match(/<button onClick=\{\(\) => setOpenPicker\("tuning"\)\}[\s\S]*?<\/button>/) || [""])[0];
        check("F-72: 楽器種別のボタンに ▾ がある(ボタンの中なので当たり判定の穴にならない)",
          /<PickChevron \/>/.test(saxBtn), saxBtn.replace(/\s+/g, " ").slice(-120));
        check("F-72: 基準ピッチのボタンに ▾ がある",
          /<PickChevron \/>/.test(tunBtn), tunBtn.replace(/\s+/g, " ").slice(-120));
        check("F-72: 楽器種別・基準ピッチは地も枠も持たないまま",
          /background: "none", border: "none"/.test(saxBtn) && /background: "none", border: "none"/.test(tunBtn));
      }
      // ▾ の見た目は正典 .chev(10px / --ink3 の段)。**定数と実際の描画の両方**を見る。
      {
        check("F-72: ▾ の文字サイズは正典 .chev の 10px", /const PICK_CHEV_PX = 10;/.test(code),
          (code.match(/const PICK_CHEV_PX = \d+/) || ["無し"])[0]);
        const fn = (code.match(/function PickChevron\(\)[\s\S]*?\n\}/) || [""])[0];
        check("F-72: ▾ は PICK_CHEV_PX と --c-ink-3 から描いている(定数だけ正しくて描画は別、を防ぐ)",
          /fontSize: PICK_CHEV_PX, color: "var\(--c-ink-3\)"/.test(fn) && />▾<\/span>/.test(fn),
          fn.replace(/\s+/g, " ").slice(0, 200));
        check("F-72: ▾ は読み上げ対象にしない(aria-hidden。値そのものは文字で読める)",
          /aria-hidden="true"/.test(fn));
        // 【差し戻し②の再犯を塞ぐ】▾ と値の間隔は **--sp-1 だけ**。広げると ▾ が隣の項目の
        // 記号に見え始める(奏者で 76.0px 空いていたのが差し戻し①の理由)。
        //
        // 【綴りを1つ数えない】以前ここは `/marginLeft: "var\(--sp-1\)"/` の**綴りの有無**だけを
        // 見ていた。間隔は marginLeft 以外でいくらでも作れるので、それでは何も守れていない
        // ―― 実際 `paddingLeft: 40` を足す変異が**生存**した(審査役が実証。▾ が値から 40px 離れ、
        // PickChevron は上部設定行の**4箇所すべて**を描くので被害は全部に及ぶ)。
        // リード枠の 15行の期待表からも、▾ は style を持たない自己閉じタグとして見えるので**構造上外れる**。
        // よって上と同じ `styleDecls` / `HORIZ` を当て、**横方向の宣言の集合が
        // {marginLeft: "var(--sp-1)"} ちょうど**であることを突き合わせる。
        {
          const splitTop3 = (b) => { const out = []; let d = 0, cur = ""; for (const ch of b) { if ("([{".includes(ch)) d++; else if (")]}".includes(ch)) d--; if (ch === "," && d === 0) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
          const declsOf = (tg) => {
            const i2 = tg.indexOf("style={{"); if (i2 === -1) return [];
            let d = 0, start = i2 + 7, end = -1;
            for (let k = start; k < tg.length; k++) { if (tg[k] === "{") d++; else if (tg[k] === "}") { d--; if (d === 0) { end = k; break; } } }
            if (end === -1) return [];
            return splitTop3(tg.slice(start + 1, end)).map((p) => { const j = p.indexOf(":"); return { name: p.slice(0, j).trim(), value: p.slice(j + 1).trim() }; });
          };
          const HORIZ2 = /^(margin|padding|gap|columnGap|width|minWidth|maxWidth|left|right|inset)/;
          const openSpan = (fn.match(/<span[\s\S]*?>/) || [""])[0];
          const horiz = declsOf(openSpan).filter((d) => HORIZ2.test(d.name)).map((d) => `${d.name}=${d.value}`).sort();
          // 抽出が空回りしていたら「間隔が1つも無い」に見えて緑になるので、
          // **タグを掴めていること**を先に確かめる(空回り検知)。
          check("F-72: ▾ の span を走査できている(空回りしていない)",
            /^<span/.test(openSpan) && declsOf(openSpan).length >= 3, openSpan.replace(/\s+/g, " ").slice(0, 120));
          const wantHoriz = ['marginLeft="var(--sp-1)"'];
          check("F-72: ▾ の横方向の宣言は marginLeft=--sp-1 ちょうど(paddingLeft 等で離す経路も塞ぐ)",
            JSON.stringify(horiz) === JSON.stringify(wantHoriz),
            `実際=${JSON.stringify(horiz)} / 期待=${JSON.stringify(wantHoriz)}`);
        }
        // 上部設定行の4箇所(奏者 / 楽器 / 基準ピッチ / リード)すべてに出ていること。
        // 【N-5 で 4 → 5】リードタブの追加シートの銘柄プルダウンが5つ目。
        // **箇所数を緩めたのではなく**、計測タブの上部設定行に4つあることと、
        // 増えた1件が追加シートの銘柄であることを別々に固定する
        // (F-72 の罠5「箇所数の固定で逃げない」)。
        // 【N-6 で 5 → 6】データタブのフィルタピル(正典 .fp の中の .chev)が6つ目。
        // ピルは3種類あるが**描くのは共通の filterPill 1箇所**なので綴りは1つ増えるだけ。
        const n = (code.match(/<PickChevron \/>/g) || []).length;
        check("F-72: ▾ を使う箇所は6つ(上部設定行の4つ + 追加シートの銘柄 + データタブのフィルタピル)",
          n === 6, `${n}箇所`);
        {
          const inMyDataPage = (srcOfFn(src, "MyDataPage").match(/<PickChevron \/>/g) || []).length;
          check("N-6: データタブの ▾ はフィルタピルの共通部品に1つだけ(ピルごとに写していない)",
            inMyDataPage === 1, `${inMyDataPage}箇所`);
        }
        {
          // 上部設定行の4つの内訳: 楽器種別・基準ピッチ・リード枠は MeasureView が直接描き、
          // 奏者は共有部品 PerformerSelector が描く。合わせて4つ。
          const inMeasure = (srcOfFn(src, "MeasureView").match(/<PickChevron \/>/g) || []).length;
          const inPerformer = (srcOfFn(src, "PerformerSelector").match(/<PickChevron \/>/g) || []).length;
          check("F-72: 上部設定行の ▾ は4つ(MeasureView に3つ + 奏者セレクタに1つ)",
            inMeasure === 3 && inPerformer === 1, `MeasureView=${inMeasure} / PerformerSelector=${inPerformer}`);
          const sheet = srcOfFn(src, "ReedBoxSheet");
          check("N-5: 追加シートの銘柄プルダウンにも ▾ がある(押せば選択肢が出ることを形で示す)",
            (sheet.match(/<PickChevron \/>/g) || []).length === 1,
            `${(sheet.match(/<PickChevron \/>/g) || []).length}箇所`);
        }
      }
      // 型のクラスの CSS 側は変えていない(リードタブ等で使い続けるため)。
      check("B型(.ctl-plain)の角丸と入力欄の角丸は同じ規則から来ている(CSS 側は不変)",
        decl(plainBlock, "border-radius") === decl(inputBlock, "border-radius") &&
        decl(plainBlock, "border-radius") === "var(--r-xs)",
        `.ctl-plain=${decl(plainBlock, "border-radius")} / select=${decl(inputBlock, "border-radius")}`);
      // 地も枠も持たない <select> は全部で3つ(リード枠の2つ + 奏者)。
      // §6.6 の「意図的な例外」の**総数**を固定する(増えたら例外に逃がしたということ)。
      const bareSelects = inputTags
        .filter((x) => x.el === "select" && /background: "none"/.test(x.tag)).length;
      check("地を持たない <select> は3つだけ(リード枠の箱・個体 + 奏者。§6.6 の意図的な例外)",
        bareSelects === 3, `${bareSelects}箇所`);
    }
    // データタブの軸セレクタ = §6.6 の意図的な例外(枠なし・地なし)。B型にすると地が付く。
    check("select.pivot-axis-select は例外のまま(枠なし・地なし)",
      /select\.pivot-axis-select \{[^}]*background:transparent;[^}]*border:none;/.test(src));

    // --- 17.8 入力欄にインラインで地・枠を書いていないこと ------------------
    // CSS を B型にしても、個々の <input> / <select> に
    // style={{ border: "1px solid #C3CAD3" }} と書けば枠線は戻る。
    // 例外は §6.6 の「地も枠も持たない select」だけ:
    //   ・リード枠の中の2つ = `background: "none", border: "none"`
    //   ・【F-72 で追加】奏者の select = `background: "none"` **だけ**。
    //     枠は index.css の透明枠(1px solid transparent)のまま残す。border:0 にすると
    //     28px が 26px に縮み、行の高さを通って環が 2px 上がる(§6.1.5 / §6.7)。
    // 例外の書き方を綴りで限定してあるので、これ以外の地・枠・影を書けば従来どおり落ちる。
    {
      const tags = inputTags.map((x) => x.tag);
      check("入力欄のタグを走査できている", tags.length >= 25, `${tags.length}箇所`);
      const BARE_OK = [
        /background: "none", border: "none"/,          // リード枠の中の2つ
        /id=\{selectId\}[\s\S]*background: "none"/,    // 奏者の bare の枝(枠は透明のまま)
      ];
      const bad = withPrefix(tags, ["background", "border", "boxshadow"])
        .filter((t) => !BARE_OK.some((re) => re.test(t)));
      check("<input>/<select>/<textarea> にインラインの地・枠・影が無い(例外は地を持たない select 3つ)",
        bad.length === 0, bad.length ? bad[0].slice(0, 200) : "");
      // 例外の側にも枠を書き足していないこと(奏者の select に border を書けばここで落ちる)
      const exceptionsWithBorder = tags.filter((t) => /id=\{selectId\}/.test(t) && /border:/.test(t));
      check("F-72: 奏者の select に枠のインライン指定が無い(透明枠のまま=外形不変)",
        exceptionsWithBorder.length === 0, exceptionsWithBorder.join(" | ").slice(0, 160));
      // 共通スタイルのオブジェクト経由でも書き戻せる。角丸も型が持つ。
      const rfBody = rfBodyFor(src);
      check("REED_FORM_CONTROL_STYLE がある", rfBody !== "");
      check("REED_FORM_CONTROL_STYLE は地・枠・角丸を持たない(型が持つ)",
        !withPrefix([rfBody], ["background", "border", "boxshadow"]).length, rfBody.replace(/\s+/g, " ").slice(0, 160));
    }

    // --- 17.9 【N-5 で置き換え】リード登録フォームは無くなり、追加シートになった -------
    // 旧主張(2026-08-04 本人指示): 「新しいリードを登録」カードの中で
    //   銘柄+番手が display:grid の2カラム / 使用開始日は単独の1行フル幅 /
    //   使用開始日の input[type=date] が REED_FORM_CONTROL_STYLE(width:100%)を使う
    // 新主張(正典 = north-star-measure.html の「追加シート」):
    //   フォームそのものが画面から消え、「＋ 追加」1つ → シートの中に
    //   銘柄プルダウン + 番手5種のピル + 枚数 1〜10 が入る。
    //   **開封日の入力欄は出さない**(箱を追加した日が自動で開封日になる)。
    //   開封日を書き換えられるのは「…」の「箱の開封日を編集」だけで、
    //   そこで初めて input[type=date] が現れる(REED_FORM_CONTROL_STYLE はそこが使う)。
    // これは P0-5「リード登録フォームが375pxで破綻」の解消でもある(フォームが消えた)。
    {
      const codeR = codeOf(src);
      check("N-5: 「新しいリードを登録」フォームが残っていない",
        !codeR.includes("新しいリードを登録"), codeR.includes("新しいリードを登録") ? "まだある" : "0件");
      // 【名前を実装より強く書かない(通算9回目を潰す)】旧主張は
      //   「『登録済みリード』の見出し(総枚数バッジ)が**一覧から**消えている」
      // と名乗りながら、走査は**ファイル全体に対する `登録済みリード <span` の綴り1つ**だった。
      // 審査役の変異(ReedRegisterView の空状態行に `登録済みリード {reeds.length}／` を足す)が
      // **生存**した。そもそも「登録済みリード」の綴りは「…」の見出しに現存しているので、
      // 名前と走査範囲が食い違っていた。
      // 新主張: **一覧を描く関数(ReedRegisterView)の中に**枚数を出す表示が無い。
      // 綴りではなく「reeds.length / g.members.length を描画している箇所が無いこと」で見る
      // (文言を変えた変異も捕まえる)。
      {
        const reg = codeOf(srcOfFn(src, "ReedRegisterView"));
        check("一覧を描く関数を走査できている(空回りしていない)",
          reg.length > 4000 && /＋ 追加/.test(reg), `${reg.length}文字`);
        check("N-5: 一覧(ReedRegisterView)に「登録済みリード」の見出しが無い",
          !/登録済みリード/.test(reg), (reg.match(/登録済みリード[^\n]{0,20}/g) || []).join(" / ") || "0件");
        check("N-5: 一覧に枚数(総数・箱の枚数)を描画していない",
          !/\{reeds\.length\}/.test(reg) && !/\{g\.members\.length\}/.test(reg)
          && !/reeds\.length\}枚/.test(reg),
          (reg.match(/\{(reeds|g\.members)\.length\}/g) || []).join(" / ") || "0件");
        // 【F-78 で主張が反転した(2026/08/14 本人決定「消す」)】
        // 旧主張: 「総枚数は『…』の見出しにだけ出る」(N-5 の暫定配置。本人判断待ちだった)
        // 新主張: **リードタブのどこにも総枚数を描画していない。**
        // 綴り(「登録済みリード」「totalCount」)だけを見ると、文言を変えた変異
        // (例: `リード {reeds.length}枚`)が生き残る。**リードタブの4つの関数を走査し、
        // 「枚数を描画している式」が1つも無いこと**で見る(F-72 罠5 の「構造＋集合」)。
        {
          const bodies = ["ReedsTab", "ReedRegisterView", "ReedMoreMenu", "ReedTileGrid"]
            .map((n) => ({ n, body: codeOf(srcOfFn(src, n)) }));
          check("F-78: リードタブの4関数を走査できている(空回りしていない)",
            bodies.every((b) => b.body.length > 500) && /REED_MORE_ITEMS\.map/.test(bodies[2].body),
            bodies.map((b) => `${b.n}:${b.body.length}`).join(" "));
          // 【前版は名乗りが実装より強かった(通算10回目)】旧主張は「枚数を描画している箇所が
          // 無いこと」を名乗りながら、走査は `{…reeds|members|totalCount…length…}` という
          // **1つの補間の中に数え上げが直接書いてある形**だけだった。審査役の変異
          // (`const reedTotalForBadge = reeds.length;` を作って `{reedTotalForBadge}枚` を描く)が
          // **生存**した。計算と描画を2行に分けるだけですり抜ける。
          //
          // 新主張は「数え上げそのものを作らせない」に変える。**3枚の網**で見る:
          //   (1) リードの本数を数える式(`reeds.length` 等)が、**比較以外**に使われていない
          //       = 変数に束ねる/補間に置く/返す、をすべて落とす(上の変異はここで死ぬ)
          //   (2) JSX の補間の直後に単位の語(枚/本/箱/個)が続かない
          //       = 別名の変数で数を描いても、単位を付ければここで死ぬ
          //       (テンプレートリテラルの中の `${n}箱を削除` は正当なので、先に取り除く)
          //   (3) totalCount という綴りが残っていない(前版からの引き継ぎ)
          // **どれも「枚数の表示が無い」ことの十分条件ではない**ので、名前もそう名乗る。
          {
            const COUNT_EXPR = /\b(?:reeds|members|orderedMembers|g\.members)\.length\b/g;
            const bad1 = [];
            for (const b of bodies) {
              let m;
              const re = new RegExp(COUNT_EXPR.source, "g");
              while ((m = re.exec(b.body)) !== null) {
                const after = b.body.slice(m.index + m[0].length, m.index + m[0].length + 12);
                // 比較(> < >= <= === !==)に続いているものだけが正当な用途
                if (!/^\s*(===|!==|>=|<=|>|<)/.test(after)) {
                  bad1.push(`${b.n}: ${b.body.slice(Math.max(0, m.index - 28), m.index + m[0].length + 8).replace(/\s+/g, " ")}`);
                }
              }
            }
            check("F-78: リードタブでリード数(reeds.length 等)を比較以外に使っていない(変数に束ねて描くのを塞ぐ)",
              bad1.length === 0, bad1.slice(0, 3).join(" | ") || "0件");
            // 網(2): テンプレートリテラルを外してから、補間の直後の単位の語を探す
            const bad2 = bodies.flatMap((b) => {
              const noTpl = b.body.replace(/`(?:[^`\\]|\\[\s\S])*`/g, '""');
              return (noTpl.match(/\}\s*[枚本箱個][^\n]{0,10}/g) || []).map((x) => `${b.n}: …${x}`);
            });
            check("F-78: リードタブの表示に「{式}+単位(枚/本/箱/個)」の形が無い(別名の変数で数を描くのを塞ぐ)",
              bad2.length === 0, bad2.slice(0, 3).join(" | ") || "0件");
            check("F-78: ReedMoreMenu は totalCount を受け取らない(呼び出し側も渡さない)",
              !/totalCount/.test(codeOf(src)),
              (codeOf(src).match(/totalCount[^\n]{0,30}/g) || []).join(" / ") || "0件");
            // 走査が空回りしていないことの裏取り: 正当な比較の用途は実在する
            const legit = bodies.flatMap((b) => b.body.match(/\b(?:reeds|members)\.length\s*(?:===|!==|>=|<=|>|<)/g) || []);
            check("F-78: 比較の用途は実在する(網1 が何も見ずに通っていない)",
              legit.length >= 3, legit.join(" / "));
          }
        }
      }
      check("N-5: 「1枚ずつ追加」「まとめて追加」の2択が残っていない",
        !codeR.includes("1枚ずつ追加") && !codeR.includes("まとめて追加"));
      check("N-5: 枚数を window.prompt で聞く旧実装が残っていない",
        !/window\.prompt/.test(codeR), (codeR.match(/window\.prompt/g) || []).join(","));
      check("N-5: 銘柄・番手の select(id=reed-brand-select / reed-strength-select)が残っていない",
        !/id="reed-brand-select"/.test(codeR) && !/id="reed-strength-select"/.test(codeR));
      check("N-5: 追加の入口は「＋ 追加」1つだけ",
        (codeR.match(/＋ 追加/g) || []).length === 1, `${(codeR.match(/＋ 追加/g) || []).length}箇所`);
      // 追加ボタンの文言は枚数で変わる(純関数なので実行で数える)
      check("枚数1なら「1枚を追加」", api.reedAddButtonLabel(1) === "1枚を追加", api.reedAddButtonLabel(1));
      check("枚数2以上なら「n枚の箱を追加」",
        api.reedAddButtonLabel(2) === "2枚の箱を追加" && api.reedAddButtonLabel(10) === "10枚の箱を追加",
        `${api.reedAddButtonLabel(2)} / ${api.reedAddButtonLabel(10)}`);
      check("文言が変わる境目は 1 と 2 の間だけ(2〜10 は全部「n枚の箱を追加」)",
        [2, 3, 4, 5, 6, 7, 8, 9, 10].every((n) => api.reedAddButtonLabel(n) === `${n}枚の箱を追加`));
      check("シートは reedSheetButtonLabel を呼んで文言を出す(JSX 側で書き分けていない)",
        /\{reedSheetButtonLabel\(mode, count\)\}/.test(src));
      // 【F-80 / F-82】同じシートを「箱を編集」にも使う。**呼び出し側で切り替える**方式で、
      // 既定は "add"(F-72 罠1「既定を新しい側にすると次の呼び出し側へ黙って漏れる」)。
      check("F-82: シートの mode の既定は \"add\"(追加の呼び出しは何も渡さない)",
        /mode = "add",\s*\r?\n?\s*\}\)/.test(srcOfFn(src, "ReedBoxSheet").slice(0, 400))
        || /startDate, setStartDate, onAdd, onClose, mode = "add",/.test(src));
      check("F-82: mode=\"edit\" を渡す呼び出しは1つだけ(箱の編集)",
        (src.match(/mode="edit"/g) || []).length === 1, `${(src.match(/mode="edit"/g) || []).length}箇所`);
      check("F-82: 編集の一手は「この箱を変更」/ 追加は枚数で変わる(同じ関数が分ける)",
        api.reedSheetButtonLabel("edit", 1) === "この箱を変更"
        && api.reedSheetButtonLabel("edit", 10) === "この箱を変更"
        && api.reedSheetButtonLabel("add", 1) === "1枚を追加"
        && api.reedSheetButtonLabel("add", 10) === "10枚の箱を追加"
        && api.reedSheetButtonLabel(undefined, 3) === "3枚の箱を追加",
        `${api.reedSheetButtonLabel("edit", 1)} / ${api.reedSheetButtonLabel("add", 10)}`);
      check("F-82: シートの見出しは 追加=「追加」/ 編集=「箱を編集」",
        api.reedSheetTitle("edit") === "箱を編集" && api.reedSheetTitle("add") === "追加"
        && api.reedSheetTitle(undefined) === "追加",
        `${api.reedSheetTitle("edit")} / ${api.reedSheetTitle("add")}`);
      check("F-82: 見出しの綴りは reedSheetTitle からしか出ない(JSX に直書きしていない)",
        /\{reedSheetTitle\(mode\)\}/.test(src));
      // 枚数は「追加」のときだけ。編集で枚数を触らせると、どの個体を消すのかが決まらない。
      check("F-82: 枚数の −/数値/＋ は追加のときだけ出る",
        /\{!isEdit && \(\s*\r?\n?\s*<div[\s\S]{0,300}?aria-label="枚数を減らす"/.test(srcOfFn(src, "ReedBoxSheet")));
      // 【押しても何も起きない一手を作らない(§6.1.5)】実行側(registerReeds / applyBoxEdit)は
      // 銘柄が空・開封日が空のとき**黙って return する**。ボタンの disabled がそれと食い違うと、
      // 「押せるのに無反応」になる。**実ソースの式を取り出して実行で突き合わせる**
      // (審査役の変異で `(isEdit && !startDate)` を外しても生存した = 検査が無かった)。
      {
        const sheet = srcOfFn(src, "ReedBoxSheet");
        const m = /const disabled = (.+);/.exec(sheet);
        check("F-82: シートの disabled の式を実ソースから取れている", m !== null, m ? m[1] : "取れない");
        const isDisabled = new Function("isCustom", "customBrand", "isEdit", "startDate",
          `return !!(${m ? m[1] : "false"});`);
        // 編集: 開封日が空なら押せない / 入っていれば押せる
        check("F-82: 編集で開封日が空なら「この箱を変更」は押せない(死んだ一手にしない)",
          isDisabled(false, "", true, "") === true && isDisabled(false, "", true, null) === true,
          `空=${isDisabled(false, "", true, "")}`);
        check("F-82: 編集で開封日が入っていれば押せる",
          isDisabled(false, "", true, "2026-08-13") === false,
          `${isDisabled(false, "", true, "2026-08-13")}`);
        // 自由入力の銘柄が空なら追加も編集も押せない(現行のまま)
        check("F-82: 自由入力の銘柄が空なら押せない(追加・編集とも)",
          isDisabled(true, "  ", false, "") === true && isDisabled(true, "  ", true, "2026-08-13") === true,
          `${isDisabled(true, "  ", false, "")} / ${isDisabled(true, "  ", true, "2026-08-13")}`);
        // 追加は開封日を持たない(自動で入る)ので、startDate が空でも押せる
        check("F-82: 追加は開封日を聞かないので startDate が空でも押せる",
          isDisabled(false, "", false, "") === false, `${isDisabled(false, "", false, "")}`);
        // 実行側が同じ2つで return していること(ボタンと実行の判断がずれない)
        check("F-82: applyBoxEdit も 銘柄が空 / 開封日が空 で return する(ボタンと同じ判断)",
          /const applyBoxEdit = \(\) => \{[\s\S]{0,400}?if \(!brand \|\| !editStartDate\) return;/.test(srcOf("ReedRegisterView")));
        check("F-82: registerReeds も銘柄が空なら return する",
          /const registerReeds = \(count\) => \{\s*\r?\n\s*const brand = resolveBrand\(\);\s*\r?\n\s*if \(!brand\) return;/.test(srcOf("ReedRegisterView")));
      }
      // 枚数の範囲 1〜10(箱1つぶん)。上下にはみ出さない
      check("枚数の下限は1・上限は箱1つぶん(10)",
        api.REED_ADD_COUNT_MIN === 1 && api.REED_ADD_COUNT_MAX === api.REED_BOX_SIZE && api.REED_BOX_SIZE === 10,
        `${api.REED_ADD_COUNT_MIN}〜${api.REED_ADD_COUNT_MAX}`);
      check("枚数はクランプされる(0→1 / 11→10 / 非数→1)",
        api.clampReedAddCount(0) === 1 && api.clampReedAddCount(-5) === 1
        && api.clampReedAddCount(11) === 10 && api.clampReedAddCount(999) === 10
        && api.clampReedAddCount(NaN) === 1 && api.clampReedAddCount("abc") === 1,
        `${api.clampReedAddCount(0)} / ${api.clampReedAddCount(11)} / ${api.clampReedAddCount(NaN)}`);
      check("枚数の −/＋ はどちらも clampReedAddCount を通す",
        (src.match(/clampReedAddCount\(v [-+] 1\)/g) || []).length === 2,
        `${(src.match(/clampReedAddCount\(v [-+] 1\)/g) || []).length}箇所`);
      // 銘柄の自由入力は現行のまま(選択肢の末尾に「＋ 新しい銘柄を入力...」)
      check("銘柄の自由入力の値とラベルは現行のまま",
        api.REED_BRAND_CUSTOM === "__custom__" && api.REED_BRAND_CUSTOM_LABEL === "＋ 新しい銘柄を入力...",
        `${api.REED_BRAND_CUSTOM} / ${api.REED_BRAND_CUSTOM_LABEL}`);
      check("銘柄のピッカーの選択肢は 登録済み + 「＋ 新しい銘柄を入力...」",
        /const pickerOptions = \[\.\.\.brandOptions, REED_BRAND_CUSTOM\];/.test(src));
      check("自由入力した銘柄は候補に自動追加される(重複は避ける)",
        /if \(newBrand === REED_BRAND_CUSTOM && !brandOptions\.includes\(brand\)\) \{\s*setExtraBrands/.test(src));
      check("番手は5種のまま", api.REED_STRENGTHS.length === 5 && api.REED_STRENGTHS.join(",") === "2.0,2.5,3.0,3.5,4.0",
        api.REED_STRENGTHS.join(","));
      check("シートは REED_STRENGTHS をそのまま並べる(選択肢を作り直していない)",
        /REED_STRENGTHS\.map\(\(s\) => \(/.test(src));
      // --- 開封日は「箱を追加した**ローカル暦日**」------------------------------
      // 【この検査の前身が「正しい修正をすると落ちる検査」だった】N-5 の初版は
      //   /const startDate = new Date\(\)\.toISOString\(\)\.slice\(0, 10\);/
      // という**綴りを要求**していた。その式は UTC の暦日なので JST の 00:00〜09:00 に
      // 追加すると1日前の開封日が入る(審査役の実測: ローカル 2026-08-14 00:55 に追加 →
      // 保存 2026-08-13)。綴りを要求する検査は、その不具合を直すと FAIL する
      // (N-4 の罠2 と同型)。**綴りの要求をやめ、振る舞いを実行で確かめる**形に置き換える。
      //
      // 旧主張: 「startDate は `new Date().toISOString().slice(0,10)` と書かれている」
      // 新主張: 「UTC 由来の綴りがどこにも無い」＋「TZ=Asia/Tokyo の 00:30 に追加した箱の
      //          開封日が**ローカルの暦日と一致する**(UTC の暦日とは一致しない)」
      {
        // (a) UTC 由来の綴りが実装から消えていること。**コメントには残っている**
        //     (localDayKey の解説が名指しで禁じている)ので、必ず codeOf を通してから見る。
        //     【範囲を名前より広く主張しない】アプリ全体を見ると、データタブの PIVOT の
        //     日付フィルタ(`new Date(flt.rangeMin).toISOString().slice(0, 10)` 2箇所)が
        //     同じ綴りを持つ。**あれは N-5 の担当外(立入禁止)**なので、ここで巻き込んで
        //     禁止すると「担当外を直さないと緑にならない検査」になる。
        //     見るのは**リードタブの関数の中だけ**にし、名前もそう名乗る。
        const codeNoComment = codeOf(src);
        const reedBodies = ["localDayKey", "reedRatingDayKey", "ReedsTab", "ReedRegisterView",
          "ReedTileGrid", "ReedBoxSheet", "ReedMoreMenu", "ReedEvaluationDetail"]
          .map((n) => codeOf(srcOfFn(src, n))).join("\n");
        check("リードタブの関数を走査できている(空回りしていない)",
          reedBodies.length > 12000 && /localDayKey\(new Date\(\)\)/.test(reedBodies), `${reedBodies.length}文字`);
        check("N-5: リードタブの中に暦日を UTC から作る綴り(toISOString().slice(0,10))が無い",
          !/toISOString\(\)\.slice\(0,\s*10\)/.test(reedBodies),
          (reedBodies.match(/toISOString\(\)\.slice\(0,\s*10\)/g) || []).join(" / ") || "0件");
        check("N-5: 開封日は箱を追加した日が自動で入る(入力欄から取らない)",
          /const startDate = localDayKey\(new Date\(\)\);/.test(src) && /startDate,\r?\n/.test(src));
        check("暦日の組み立ては localDayKey ただ1箇所(評価履歴の同日判定と共有)",
          /return localDayKey\(d\); \/\/ 組み立ては localDayKey ただ1箇所/.test(src)
          && (codeNoComment.match(/getFullYear\(\)\}-\$\{p2\(d\.getMonth\(\) \+ 1\)\}-\$\{p2\(d\.getDate\(\)\)\}/g) || []).length === 1);

        // (b) 実行で確かめる。**実ソースの式をそのまま取り出して**、時計だけを差し替える。
        //     TZ の固定は F-61 節と同じ作法(固定できたこと・戻せたことも検査する)。
        const m = /const startDate = ([^;]+);/.exec(src);
        check("開封日を作る式を実ソースから取れている", m !== null, m ? m[1] : "取れない");
        const tzOrig = process.env.TZ;
        const tzSystem = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const offBefore = new Date(2026, 0, 1).getTimezoneOffset();
        try {
          process.env.TZ = "Asia/Tokyo";
          check("TZ を Asia/Tokyo(UTC+9)に固定できている(以下の判定の前提)",
            new Date("2026-08-13T15:30:00.000Z").getTimezoneOffset() === -540,
            String(new Date("2026-08-13T15:30:00.000Z").getTimezoneOffset()));
          // 時計を固定した Date を渡して、実ソースの式を評価する
          const evalStartDate = (instantIso) => {
            const fixed = new Date(instantIso).getTime();
            class FixedDate extends Date {
              constructor(...a) { if (a.length === 0) super(fixed); else super(...a); }
              static now() { return fixed; }
            }
            return new Function("localDayKey", "Date", `return (${m[1]});`)(api.localDayKey, FixedDate);
          };
          // ケース1: ローカル 2026/08/14 00:30(= UTC 2026-08-13T15:30Z)。**ずれる時間帯**
          {
            const iso = "2026-08-13T15:30:00.000Z";
            const local = new Date(iso);
            const wantLocal = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
            const utcDay = iso.slice(0, 10);
            check("この時刻ではローカルの暦日と UTC の暦日が違う(検査が空回りしていない)",
              wantLocal !== utcDay, `ローカル=${wantLocal} / UTC=${utcDay}`);
            check("00:30 に追加した箱の開封日はローカルの暦日(2026-08-14)",
              evalStartDate(iso) === wantLocal, `${evalStartDate(iso)} / 期待 ${wantLocal}`);
            check("00:30 に追加した箱の開封日は UTC の暦日(1日前)ではない",
              evalStartDate(iso) !== utcDay, `${evalStartDate(iso)} / UTC は ${utcDay}`);
          }
          // ケース2: ローカル 2026/08/14 12:00(= UTC 03:00Z)。**ずれない時間帯**でも一致する
          {
            const iso = "2026-08-14T03:00:00.000Z";
            const local = new Date(iso);
            const wantLocal = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
            check("昼に追加した箱の開封日もローカルの暦日と一致する",
              evalStartDate(iso) === wantLocal, `${evalStartDate(iso)} / 期待 ${wantLocal}`);
            check("この時刻ではローカルと UTC の暦日は同じ(片方向だけ見ていない)",
              wantLocal === iso.slice(0, 10), `${wantLocal} / ${iso.slice(0, 10)}`);
          }
          // 箱のキーが割れないこと: 同じローカル日の 08:00 と 10:00 で同じ開封日になる
          {
            const a = evalStartDate("2026-08-13T23:00:00.000Z"); // JST 8/14 08:00
            const b = evalStartDate("2026-08-14T01:00:00.000Z"); // JST 8/14 10:00
            check("同じローカル日の 08:00 と 10:00 は同じ開封日(箱が2つに割れない)",
              a === b && a === "2026-08-14", `${a} / ${b}`);
            // reedGroupKey が開封日を含むこと(割れる経路が実在することの裏取り)
            check("箱のキーは 銘柄|番手|開封日(開封日がずれると箱が割れる)",
              /return `\$\{r\.brand\}\|\$\{r\.strength\}\|\$\{r\.startDate\}`;/.test(src));
          }
        } finally {
          process.env.TZ = tzOrig === undefined ? tzSystem : tzOrig;
        }
        check("TZ を元に戻せている(以降の日付の検査を汚していない)",
          new Date(2026, 0, 1).getTimezoneOffset() === offBefore,
          `${new Date(2026, 0, 1).getTimezoneOffset()} / 元 ${offBefore}`);
      }
      // 【F-80 で置き場所が変わった】
      // 旧主張: 開封日の input[type=date] は「…」→「箱の開封日を編集」モードの中(=一覧の行内)
      //         に1つだけあり、通常時は日付の文字だけ。
      // 新主張: 一覧の行の中には input[type=date] が**1つも無い**(通常時も編集時も文字のまま)。
      //         入力欄は「箱を編集」シート(ReedBoxSheet)の中に1つだけある。
      //         行内に置かないのは iOS Safari の固有幅の罠(F-39/F-40/F-41)を避けるため
      //         — 行では ★ と同居して 150px しか取れない。シートなら左右 24px 以外は使える。
      {
        const inList = (srcOf("ReedRegisterView").match(/type="date"/g) || []).length;
        const inSheet = (srcOfFn(src, "ReedBoxSheet").match(/type="date"/g) || []).length;
        check("F-80: 一覧(ReedRegisterView)の中に input[type=date] が無い", inList === 0, `${inList}箇所`);
        check("F-80: 開封日の input[type=date] は「箱を編集」シートの1箇所だけ", inSheet === 1, `${inSheet}箇所`);
        check("F-80: 開封日の欄はシートを編集で開いたときだけ出る(追加のときは出ない)",
          /\{isEdit && \(\s*\r?\n?\s*<div[\s\S]{0,400}?type="date"/.test(srcOfFn(src, "ReedBoxSheet")));
        check("F-80: 開封日の input[type=date] は REED_FORM_CONTROL_STYLE(width:100%)を使っている",
          /type="date"[\s\S]{0,700}\.\.\.REED_FORM_CONTROL_STYLE/.test(srcOfFn(src, "ReedBoxSheet")));
        check("開封日の input[type=date] 自身が width:100% を持つ(REED_FORM_CONTROL_STYLE経由)",
          /width: "100%",/.test(rfBodyFor(src)), rfBodyFor(src).replace(/\s+/g, " ").slice(0, 160));
      }
      // 【F-80 / F-82】箱の編集は**銘柄・番手・開封日の3つとも**箱の全メンバーへ同じ値を書く。
      // 1枚だけ書き換えると reedGroupKey(銘柄|番手|開封日)が割れて箱が2つになる。
      // **綴りではなく実行で確かめる**: 実ソースの updateGroup を取り出し、setReeds だけを
      // 差し替えて評価し、その結果を実物の groupReeds に通して箱の数を数える。
      {
        const upd = /const updateGroup = \(g, patch\) => \{([\s\S]*?)\n  \};/.exec(srcOf("ReedRegisterView"));
        check("F-82: updateGroup を実ソースから取れている(空回りしていない)",
          upd !== null && /setReeds\(/.test(upd ? upd[1] : ""), upd ? `${upd[1].length}文字` : "取れない");
        // 実ソースの updateGroup をそのまま評価する。差し替えるのは setReeds だけで、
        // 参照している実物の関数(reedGroupKey / reedMemberOrder)は api のものを渡す。
        const applyUpdateRaw = new Function("reedGroupKey", "reedMemberOrder", `
          return (g, patch, reeds) => {
            let out = reeds;
            const setReeds = (fn) => { out = fn(reeds); };
            ${upd ? upd[1] : ""}
            return out;
          };
        `)(api.reedGroupKey, api.reedMemberOrder);
        const applyUpdate = (g, patch, reeds) => applyUpdateRaw(g, patch, reeds);
        const base = [
          { id: "a", brand: "Vandoren", strength: "3.0", startDate: "2026-08-13", createdAt: "2026-08-13T01:00:00.000Z" },
          { id: "b", brand: "Vandoren", strength: "3.0", startDate: "2026-08-13", createdAt: "2026-08-13T01:00:01.000Z" },
          { id: "c", brand: "Marca", strength: "2.5", startDate: "2026-08-10", createdAt: "2026-08-10T01:00:00.000Z" },
        ];
        check("F-82: 用意した3枚は2箱に分かれている(前提の裏取り)",
          api.groupReeds(base).length === 2, `${api.groupReeds(base).length}箱`);
        const marca = api.groupReeds(base).find((x) => x.brand === "Marca");
        // (a) 銘柄・番手を Vandoren 3.0 へ変えると、開封日も同じにすれば既存の箱へ合流する
        {
          const after = applyUpdate(marca, { brand: "Vandoren", strength: "3.0", startDate: "2026-08-13" }, base);
          const gs = api.groupReeds(after);
          check("F-82: 銘柄・番手・開封日を既存の箱と同じにすると、その箱へ合流する",
            gs.length === 1 && gs[0].members.length === 3, `${gs.length}箱 / ${gs[0]?.members.length}枚`);
        }
        // (b) 開封日だけを合わせても、銘柄が違えば合流しない(キーの3要素が効いていることの裏取り)
        {
          const after = applyUpdate(marca, { startDate: "2026-08-13" }, base);
          const gs = api.groupReeds(after);
          check("F-80: 開封日だけ合わせても銘柄が違えば合流しない(片方向だけ見ていない)",
            gs.length === 2, `${gs.length}箱`);
        }
        // (c) 3つとも患部: 銘柄だけ変えて開封日が違えば別の箱のまま
        {
          const after = applyUpdate(marca, { brand: "Vandoren", strength: "3.0" }, base);
          const gs = api.groupReeds(after);
          check("F-82: 銘柄・番手を合わせても開封日が違えば別の箱のまま",
            gs.length === 2, `${gs.length}箱`);
        }
        // (d) 書き換えは箱の全メンバーに及ぶ(1枚だけ動かして箱を割らない)
        {
          const vd = api.groupReeds(base).find((x) => x.brand === "Vandoren");
          const after = applyUpdate(vd, { startDate: "2026-08-01" }, base);
          const moved = after.filter((r) => r.startDate === "2026-08-01");
          check("F-80: 開封日の変更は箱の2枚とも動く(1枚だけ残して割らない)",
            moved.length === 2 && api.groupReeds(after).length === 2,
            `${moved.length}枚 / ${api.groupReeds(after).length}箱`);
        }
        check("F-80/F-82: 箱のキーは 銘柄|番手|開封日 のまま(合流の判定がこの3つで決まる)",
          /return `\$\{r\.brand\}\|\$\{r\.strength\}\|\$\{r\.startDate\}`;/.test(src));

        // (e) 【差し戻し②】合流したタイルは**末尾に続く**。
        // 旧実装は値を書き換えるだけで、両方の箱が sortOrder 1..n を持ったまま重なり、
        // reedMemberOrder が `1,4,2,5,3,6,7` のように**交互に**並べていた(審査役の実測)。
        // どれが合流分か画面から読めないので、合流のたびに通し番号を振り直す。
        {
          const box = (pfx, n, brand, strength, date, withOrder) =>
            Array.from({ length: n }).map((_, i) => ({
              id: `${pfx}${i + 1}`, brand, strength, startDate: date,
              ...(withOrder ? { sortOrder: i + 1 } : {}),
              createdAt: new Date(Date.parse(`${date}T02:00:00.000Z`) + i * 1000).toISOString(),
            }));
          // 合流先4枚(並び替え済み) + 合流してくる3枚(並び替え済み)
          const base = [...box("D", 4, "Vandoren", "3.0", "2026-08-13", true),
            ...box("S", 3, "Marca", "2.5", "2026-08-10", true)];
          check("F-82: 合流前は2箱・両方が sortOrder 1.. を持っている(交互になる条件が揃っている)",
            api.groupReeds(base).length === 2
            && base.filter((r) => r.sortOrder === 1).length === 2, `${api.groupReeds(base).length}箱`);
          const src3 = api.groupReeds(base).find((x) => x.brand === "Marca");
          const after = applyUpdate(src3, { brand: "Vandoren", strength: "3.0", startDate: "2026-08-13" }, base);
          const merged = api.groupReeds(after);
          check("F-82: 合流して1箱になる", merged.length === 1 && merged[0].members.length === 7,
            `${merged.length}箱 / ${merged[0]?.members.length}枚`);
          check("F-82: 合流したタイルは末尾に続く(交互に入り込まない)",
            merged[0].members.map((m) => m.id).join(",") === "D1,D2,D3,D4,S1,S2,S3",
            merged[0].members.map((m) => m.id).join(","));
          // 合流先が一度も並び替えられていない(sortOrder 未設定)場合も末尾に続くこと。
          // 未設定は reedMemberOrder では Infinity = 最後尾なので、正規化しないと
          // 番号を持つ合流分のほうが**前に来る**。
          {
            const base2 = [...box("D", 4, "Vandoren", "3.0", "2026-08-13", false),
              ...box("S", 3, "Marca", "2.5", "2026-08-10", true)];
            const g2 = api.groupReeds(base2).find((x) => x.brand === "Marca");
            const a2 = applyUpdate(g2, { brand: "Vandoren", strength: "3.0", startDate: "2026-08-13" }, base2);
            check("F-82: 合流先が未並び替え(sortOrder 未設定)でも末尾に続く",
              api.groupReeds(a2)[0].members.map((m) => m.id).join(",") === "D1,D2,D3,D4,S1,S2,S3",
              api.groupReeds(a2)[0].members.map((m) => m.id).join(","));
          }
          // 合流先の並び替え結果を壊さない(1..n の順序そのものは保つ)
          {
            const base3 = [
              { id: "D1", brand: "Vandoren", strength: "3.0", startDate: "2026-08-13", sortOrder: 3, createdAt: "2026-08-13T02:00:00.000Z" },
              { id: "D2", brand: "Vandoren", strength: "3.0", startDate: "2026-08-13", sortOrder: 1, createdAt: "2026-08-13T02:00:01.000Z" },
              { id: "D3", brand: "Vandoren", strength: "3.0", startDate: "2026-08-13", sortOrder: 2, createdAt: "2026-08-13T02:00:02.000Z" },
              ...box("S", 2, "Marca", "2.5", "2026-08-10", true),
            ];
            const g3 = api.groupReeds(base3).find((x) => x.brand === "Marca");
            const a3 = applyUpdate(g3, { brand: "Vandoren", strength: "3.0", startDate: "2026-08-13" }, base3);
            check("F-82: 合流先が並び替え済みなら、その並びを保ったまま末尾に続く",
              api.groupReeds(a3)[0].members.map((m) => m.id).join(",") === "D2,D3,D1,S1,S2",
              api.groupReeds(a3)[0].members.map((m) => m.id).join(","));
          }
          // 合流しない編集(開封日だけずらす)でも箱の中の並びは変わらない
          {
            const g4 = api.groupReeds(base).find((x) => x.brand === "Marca");
            const a4 = applyUpdate(g4, { startDate: "2026-08-01" }, base);
            const moved = api.groupReeds(a4).find((x) => x.brand === "Marca");
            check("F-82: 合流しない編集では箱の中の並びが変わらない",
              moved.members.map((m) => m.id).join(",") === "S1,S2,S3",
              moved.members.map((m) => m.id).join(","));
          }
          // 並びの規則は groupReeds と合流で**同じ関数**を使う(2箇所に書くと必ず食い違う)
          check("F-82: 箱の中の並びの規則は reedMemberOrder 1つ",
            (codeOf(src).match(/reedMemberOrder/g) || []).length === 3
            && /g\.members\.sort\(reedMemberOrder\)/.test(src)
            && /\.sort\(reedMemberOrder\);/.test(srcOf("ReedRegisterView")),
            `${(codeOf(src).match(/reedMemberOrder/g) || []).length}箇所`);
          check("F-82: reedMemberOrder は sortOrder が主・未設定は登録順で後ろ",
            api.reedMemberOrder({ sortOrder: 1 }, { sortOrder: 2 }) < 0
            && api.reedMemberOrder({ sortOrder: 5 }, { createdAt: "2000-01-01" }) < 0
            && api.reedMemberOrder({ createdAt: "2026-01-01" }, { createdAt: "2026-01-02" }) < 0);
        }
      }
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
      // 【速度】以下2つは**索引**。主張は1つも変えず、総当たりを二分探索に置き換えるだけ。
      // 直す前はこの節だけで 251,468ms(検証ゲート全体の73%)を使っており、
      // ゲートが5分かかるせいで**変異試験が回り切らない**状態だった(統括の実測)。
      //
      // (a) 要素名ごとの開始タグ位置と、「自己終了でないもの」の累積和。
      //     opens は正規表現の走査順なので start の昇順に並んでいる(二分探索の前提)。
      //     `<el[\s/>]` が当たる位置は opens の el 一致分と**完全に同じ**
      //     (`<el` の直後が空白/スラッシュ/> のときだけ当たるので `<element` は当たらない)。
      const openIdx = new Map();
      for (const o of opens) {
        if (!openIdx.has(o.el)) openIdx.set(o.el, { pos: [], pre: [0] });
        const e = openIdx.get(o.el);
        e.pos.push(o.start);
        e.pre.push(e.pre[e.pre.length - 1] + (/\/>\s*$/.test(o.tag) ? 0 : 1));
      }
      // 配列 arr(昇順)の中で v 未満の要素数 = v 以上の最初の位置
      const lowerBound = (arr, v) => {
        let lo = 0, hi = arr.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
        return lo;
      };

      // 対応する閉じタグまで(= その操作の部分木)。自己終了タグは自分だけ
      // 【速度】区間 [i, c) にある「自己終了でない同名の開始タグ」の**数**が要るだけなので、
      // 元の「毎回 new RegExp して数え直す」を累積和の差に置き換えた。
      // 数え方(区間の開閉・自己終了の判定)は1文字も変えていない。
      const subtreeCache = new Map();
      const subtreeEnd = (o) => {
        if (subtreeCache.has(o)) return subtreeCache.get(o);
        const val = (() => {
          if (/\/>\s*$/.test(o.tag)) return o.end;
          const close = `</${o.el}>`;
          const idx = openIdx.get(o.el) || { pos: [], pre: [0] };
          let depth = 1, i = o.end;
          while (i < jsx.length) {
            const c = jsx.indexOf(close, i);
            if (c === -1) return jsx.length;
            // 元の内側ループと同じ範囲: i <= mm.index < c
            const nested = idx.pre[lowerBound(idx.pos, c)] - idx.pre[lowerBound(idx.pos, i)];
            depth += nested - 1;
            i = c + close.length;
            if (depth === 0) return i;
          }
          return jsx.length;
        })();
        subtreeCache.set(o, val);
        return val;
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
      // 【速度】元は `src.slice(0, i).split("\n").length` で、1回ごとに 500KB を切って割っていた。
      // 行頭表(改行の位置)を1度だけ作り、二分探索で数える。**返す行番号は同じ**
      // (i より前にある改行の数 + 1)。
      const nlPos = [];
      for (let k = 0; k < src.length; k++) if (src[k] === "\n") nlPos.push(k);
      const lineOf = (i) => lowerBound(nlPos, i) + 1;
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
      // 【速度】「その要素を含む操作のうち、**開始が最も後ろのもの**」を返す規則はそのまま。
      // 開始の降順に見れば**最初に見つかったものが答え**なので、そこで打ち切れる
      // (元は毎回 129 個すべてを舐めて最大を取り直していた)。
      const rangesDesc = [...ranges].sort((a, b) => b.c.start - a.c.start);
      const ownerOf = (o) => {
        for (const { c, end } of rangesDesc)
          if (o.start >= c.start && o.start < end) return c;
        return null;
      };
      const unreadable = [], both = [], framed = [], mockOutline = [];
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
        // (芯2) 枠を持てるのは状態を持つ操作だけ。
        // 【意図した例外(N-4c)】正典 design/north-star-measure.html のテンポシートは
        // ± を「1.5px の輪郭だけの円(.pm)」で描く。状態は持たないが枠を持つ。
        // DESIGN-SYSTEM §6.0 が「見た目についてはモックが唯一の正典。§6.7 はモックに対する
        // 制約として機能しない」と定めたので、**この2つだけ**を名指しで外す。
        // 名指しなので、他の要素に枠を足せば従来どおり落ちる。件数も下で固定する。
        const MOCK_OUTLINE_ONLY = /aria-label="テンポを(下|上)げる" className="no-select"\s*\r?\n?\s*style=\{\{ width: 62/;
        const hasFrame = bd.some((d) => arms(d.value).arms.flatMap(lits).some((x) => frameVisible(d.name, x)));
        const hasState = /aria-pressed=|aria-expanded=/.test(owner.tag) ||
          /className="[^"]*\bctl-state\b/.test(owner.tag);
        if (hasFrame && !hasState) {
          if (MOCK_OUTLINE_ONLY.test(owner.tag)) mockOutline.push(`${lineOf(owner.start)}`);
          else framed.push(`${lineOf(o.start)}: <${o.el}> 枠あり / 状態なし(操作は ${lineOf(owner.start)} 行の <${owner.el}>)`);
        }
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
      check("【芯2】「全周の枠線」を持つ操作はすべて状態を持つ(正典の輪郭だけの円を除く)",
        framed.length === 0, `${framed.length}件: ` + framed.slice(0, 3).join(" | "));
      // 例外は**テンポシートの ± の2つだけ**。増えたら「例外に逃がした」ということ。
      check("芯2 の例外は正典 .pm(テンポシートの ±)の2つだけ",
        mockOutline.length === 2, `${mockOutline.length}件: ` + mockOutline.join(" | "));
      // 型のクラスが実際に広く行き渡っていること(名指しの検査では見えない全体像)
      // 【F-75 で 8 → 6】計測タブの2件(メトロノーム / 詳細トグル)が本人指示で枠線を撤去し、
      // A型を外れた。下限だけ下げると「もっと減らしても通る」ので、**外れた2件が
      // 枠線を持たないことを 17.7 で個別に固定**したうえで下限を合わせている
      // (残る6件は リード/データ/セッション詳細側で、この周では1件も触っていない)。
      // 【N-5 で 6 → 5】リード比較の個体チップが A型(.ctl-state)から正典 .selpill
      // (非選択=輪郭のみ / 選択中=紺の塗り。テンポシートの拍子ピルと同じ形)へ移った。
      // 下限だけ下げると「もっと減らしても通る」ので、**外れた1件が正典の形になっていること**を
      // 下の N-5 の節(比較のチップ)で個別に固定してある。
      check("A型(.ctl-state)は 5箇所以上で使われている", tagsWithClass("ctl-state").length >= 5,
        `${tagsWithClass("ctl-state").length}箇所`);
      check("N-5: リード比較の個体チップは A型に戻っていない(正典 .selpill の形)",
        !tagsWithClass("ctl-state").some((t) => /aria-pressed=\{sel\}/.test(t)),
        tagsWithClass("ctl-state").filter((t) => /aria-pressed=\{sel\}/.test(t)).join(" | ").slice(0, 160));
      // 外れた2件が「A型に戻っていない」ことも同時に見る(戻せば箇所数は8に戻るが、ここで落ちる)
      check("F-75: 計測タブのメトロノーム / 詳細トグルは A型に戻っていない",
        !tagsWithClass("ctl-state").some((t) => /aria-pressed=\{showMetroPanel\}|aria-expanded=\{detailOpen\}/.test(t)),
        tagsWithClass("ctl-state").filter((t) => /showMetroPanel|detailOpen/.test(t)).join(" | ").slice(0, 160));
      // 【N-5 で 15 → 12】リードタブの B型が減った(登録フォームの「1枚ずつ追加」/
      // 一覧の削除ボタン2つ / 測定ボタン / 個体詳細の評価カード3枚が消え、
      // 削除モードのキャンセル・削除ピル2つは子タブ行へ移って残っている)。実測13。
      // 【N-6 で 12 → 10】データタブの一覧のゴミ箱が「…」の行に、絞り込みの2つの <select> が
      // ピル(A型)に、一括変更の塗りボタンが B型のピルになった。差し引きで実測11。
      check("B型(.ctl-plain)は 10箇所以上で使われている", tagsWithClass("ctl-plain").length >= 10,
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
      // 【N-5 で 2 → 1】リードタブの子タブは正典 .subtabs(素のテキスト2つ + 右端の「…」)に
      // 変わり、溝そのものが無くなった。残る1つはデータタブの子タブ。
      // **リードタブ側に溝が復活していないこと**も同時に見る(下限を下げただけにしない)。
      // 【N-6 で 1 → 0】データタブの子タブも正典 .subtabs(素のテキスト + 右端の「…」)に
      // 変わり、**アプリから溝が1つも無くなった**。下限を下げただけにしないため、
      // 両タブとも「溝が復活していないこと」と「選択中だけ濃い太字」を名指しで固定する。
      const grooves = (code.match(/display: "flex", gap: 6, background: "var\(--c-sunken\)", borderRadius: 11, padding: 4/g) || []).length;
      check("子タブの溝はアプリのどこにも無い(正典 .subtabs は素のテキスト)", grooves === 0, `${grooves}箇所`);
      for (const fn of ["ReedsTab", "AnalysisLabView"]) {
        check(`${fn} の子タブに溝が無い(角丸11 + padding4 の segmented control が復活していない)`,
          !/borderRadius: 11, padding: 4/.test(srcOfFn(src, fn)));
      }
      check("N-5: リードタブの子タブは選択中だけ濃い太字(正典 .subtabs .on)",
        /color: reedsSubTab === t\.key \? "var\(--c-ink\)" : "var\(--c-ink-3\)"/.test(src)
        && /fontWeight: reedsSubTab === t\.key \? 600 : 400/.test(src));
      check("N-6: データタブの子タブは選択中だけ濃い太字(正典 .subtabs .on)",
        /color: dataSubTab === t\.key \? "var\(--c-ink\)" : "var\(--c-ink-3\)"/.test(src)
        && /fontWeight: dataSubTab === t\.key \? 600 : 400/.test(src));
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
      // 【N-5 で 3 → 2】旧主張は「箱 / 個体 / セッションの3箇所」。リードタブの削除は
      // 「箱を選んで削除」「個体を選んで削除」が**同じ1つの実行ボタン**(子タブ行の右)に
      // まとまり、文言だけが「n箱を削除」「n枚を削除」に変わる形になった。
      // 実行される場面は2つのまま(減っていない)ので、**2つの場面が両方この1つのボタンから
      // 出ていること**を下で確かめる。
      const dgTags = tagsWithClass("ctl-danger");
      check(".ctl-danger が付くのは実際に削除が実行される2箇所だけ(リードの削除 / セッションの削除)",
        dgTags.length === 2, `${dgTags.length}箇所`);
      const armed = dgTags.filter((t) => /data-armed=\{[^}]*\.size(?:[^}]*)> 0\}/.test(t));
      check(".ctl-danger はすべて data-armed={選択数 > 0} を持つ(常時塗る印にしていない)",
        armed.length === dgTags.length, `${armed.length}/${dgTags.length}箇所`);
      check("N-5: リードの削除ボタンは箱・個体の両方の場面で文言を出し分ける(片方を落としていない)",
        /selectedBoxKeys\.size > 0 \? `\$\{selectedBoxKeys\.size\}箱を削除` : "削除"/.test(src)
        && /selectedMemberIds\.size > 0 \? `\$\{selectedMemberIds\.size\}枚を削除` : "削除"/.test(src));
      check("N-5: リードの削除はどちらの場面も window.confirm を通る(現行のまま)",
        /confirmBoxDelete = \(\) => \{[\s\S]{0,400}?window\.confirm\(/.test(src)
        && /confirmMemberDelete = \(\) => \{[\s\S]{0,300}?window\.confirm\(/.test(src));
      check("N-5: 削除したリードに紐づくセッションは紐付けだけ解除する(セッションは消さない)",
        /updateSessions\(\(prev\) => prev\.map\(\(s\) => \(idSet\.has\(s\.reedId\) \? \{ \.\.\.s, reedId: null, linkedAt: null \} : s\)\)\)/.test(src));
      // 地・文字色をインラインで書くとクラスより強くなり、この型が丸ごと効かなくなる。
      check(".ctl-danger を持つタグに background* / color のインライン宣言が無い",
        withPrefix(dgTags, ["background", "color"]).length === 0,
        (withPrefix(dgTags, ["background", "color"])[0] ?? "").slice(0, 120));
      // 「削除モードに入る入口」は破壊がまだ起きないので中立のまま(危険色を持たない)。
      // 【N-5】リードの入口は「…」メニューの行になった(startMode(mode) を呼ぶ)。
      // 【N-6】データタブの入口も「…」シートの行になった(DataOptionSheet が onPick(it.key) を呼ぶ)。
      for (const entry of ["onPick(it.mode)", "onPick(it.key)"]) {
        const i = Math.max(src.indexOf(`onClick={() => ${entry}`), src.indexOf(`onClick={${entry}}`));
        const open = i === -1 ? -1 : src.lastIndexOf("<button", i);
        const close = i === -1 ? -1 : src.indexOf("</button>", i);
        const block = open === -1 || close === -1 ? null : src.slice(open, close + "</button>".length);
        check(`削除モードに入る入口(${entry})は危険色を持たない(破壊はまだ起きない)`,
          block !== null && !/\bctl-danger\b/.test(block),
          block === null ? "入口が見つからない" : block.replace(/\s+/g, " ").slice(0, 140));
      }
      // 「…」メニューの中身。**全部出ていること**を集合で確かめる(1つ落としても気づく)。
      // 【F-80 で主張が変わった】旧主張は「箱を選んで削除 / 個体を選んで削除 / 箱の開封日を編集
      // の3つがある」。開封日の編集は箱見出しの日付タップへ移したので、**残るのは削除2件**。
      check("F-80: 「…」には 箱を選んで削除 / 個体を選んで削除 の2つだけがある",
        api.REED_MORE_ITEMS.length === 2
        && api.REED_MORE_ITEMS.map((x) => x.mode).join(",") === "boxDelete,memberDelete"
        && api.REED_MORE_ITEMS.map((x) => x.label).join(",") === "箱を選んで削除,個体を選んで削除",
        api.REED_MORE_ITEMS.map((x) => `${x.mode}:${x.label}`).join(" / "));
      // 「開封日を編集」という入口が「…」側に残っていないこと(モードごと消したことの裏取り)。
      check("F-80: listMode に \"dateEdit\" が残っていない(モードごと消した)",
        !/"dateEdit"/.test(codeOf(src)), (codeOf(src).match(/"dateEdit"/g) || []).join(",") || "0件");
      check("F-80: 「…」に開封日の項目が無い",
        api.REED_MORE_ITEMS.every((it) => !/開封日/.test(it.label)),
        api.REED_MORE_ITEMS.map((x) => x.label).join(" / "));
      check("N-5: 「…」は REED_MORE_ITEMS をそのまま並べる(JSX 側で間引いていない)",
        /REED_MORE_ITEMS\.map\(\(it\) => \(/.test(src)
        && !/REED_MORE_ITEMS\.(slice|filter)\(/.test(src));
      // 【リード0枚のときは実行できない操作を出さない】HEAD は削除の入口を
      // `{reeds.length > 0 && …}` で括っていた。N-5 の初版はこれを落として、0枚でも
      // 削除の項目を出していた(審査役の実測)。§6.0 の3原則「今に関係ない物は出ていない」。
      // どれも「箱があること」が前提なので、**入口ごと**出さない。
      {
        const tab = srcOfFn(src, "ReedsTab");
        // 条件式を実ソースから取り出して評価する(綴りの一致ではなく振る舞いで見る)
        const m = /\{reedsSubTab === "register" && (\([^)]*\)) && \(/.exec(tab);
        check("「…」を出す条件式を実ソースから取れている", m !== null, m ? m[1] : "取れない");
        const shows = new Function("reeds", "listMode", `return !!(${m ? m[1] : "true"});`);
        check("リードが0枚・モード無しなら「…」を出さない", shows({ length: 0 }, null) === false);
        check("リードが1枚以上なら「…」を出す", shows({ length: 1 }, null) === true && shows({ length: 12 }, null) === true);
        // 0枚でモードが残った場合だけは行を出す(「キャンセル」に戻れなくなるのを防ぐ)
        check("0枚でもモードが残っていれば行は出す(戻れなくならない)",
          shows({ length: 0 }, "boxDelete") === true);
        // 「…」の項目はどれも箱があることが前提(0枚で出す意味が無いことの裏取り)
        check("「…」の項目はどれも箱を対象にする操作",
          api.REED_MORE_ITEMS.every((it) => /箱|個体/.test(it.label)),
          api.REED_MORE_ITEMS.map((x) => x.label).join(" / "));
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

    // --- 17.14b 【F-92】タップした場所が四角いグレーで塗られる挙動を消す ------
    // 本人指示(実機 2026/08/15)「タップしたところがタップ判定？で四角くグレーになる
    // 仕様を削除」= ブラウザ既定の `-webkit-tap-highlight-color`。
    // **アプリ全体に効かせる**必要があるので、継承する root(html)に1回だけ書く。
    // ここで見るのは3つ: (a) root に書いてある (b) 値が transparent (c) 後から
    // 別の要素で色を戻していない。**「押した手応えがあるか」は見ていない**
    // (index.css には :active の規則が1つも無く、押下中の見た目を持つ要素は存在しない。
    //  代わりの手応えを足すかどうかは本人・統括の判断。実装報告に明記した)。
    {
      const htmlBlocks = rulesFor("html");
      const withTap = htmlBlocks.filter((b) => decl(b.body, "-webkit-tap-highlight-color") !== null);
      check("F-92: html(継承の根)に -webkit-tap-highlight-color を書いている",
        withTap.length >= 1, `html の規則 ${htmlBlocks.length}件 / うち指定あり ${withTap.length}件`);
      check("F-92: その値は transparent(灰色の四角を出さない)",
        withTap.length >= 1 && withTap.every((b) => decl(b.body, "-webkit-tap-highlight-color") === "transparent"),
        withTap.map((b) => decl(b.body, "-webkit-tap-highlight-color")).join(" / "));
      // 後勝ちで戻していないこと。**セレクタを固定しない**(html 以外に書き足す正しい修正を
      // 落とさないため)。見るのは「透明でない値がファイル内に1つも無い」という集合の性質。
      const opaque = cssRules.filter((r) => {
        const v = decl(r.body, "-webkit-tap-highlight-color");
        return v !== null && v !== "transparent" && !/rgba\([^)]*,\s*0\s*\)/.test(v);
      });
      check("F-92: 透明以外の tap-highlight を書いている規則が1つも無い(後から戻していない)",
        opaque.length === 0, opaque.map((r) => `${r.sels.join(",")} → ${decl(r.body, "-webkit-tap-highlight-color")}`).join(" | "));
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
        ["テンポの数値(シートの中。タップで直接入力)", "onClick={() => setTempoEditing(true)}"],
        ["画面タップでの開始/停止(背面レイヤ)", "aria-pressed={metronomeOn}"],
        ["テンポシートを開くボタン", 'aria-label="テンポと拍子"'],
        ["テンポシートを閉じるつまみ", 'aria-label="閉じる" className="no-select"'],
        ["拍子の選択(METRO_SIGS)", "aria-pressed={metroSig === sig}"],
        ["分割の選択", "aria-pressed={selected}"],
        ["アクセントのラベル", 'className="sans no-select"'],
        // 【N-5】並び替えの対象が「行」から 5×2 の「タイル」に変わった。綴りは同じ。
        ["登録済みリードの並び替えのタイル", "onPointerDown={handlePointerDown(r.id, idx)}"],
      ]) {
        check(`.no-select が付いている: ${label}`, nsHas(needle), needle);
      }
      check(".no-select は12箇所以上で使われている(対象を減らして緑にしていない)",
        nsTags.length >= 12, `${nsTags.length}箇所`);
      // 入力欄に効かせると値を選択・コピーできなくなる。**絶対に付けない**。
      const nsInputs = nsTags.filter((t) => /^<(input|select|textarea)[\s/>]/.test(t));
      check(".no-select は入力欄(input/select/textarea)に付いていない(値を選択・コピーできなくしない)",
        nsInputs.length === 0, nsInputs.map((t) => t.slice(0, 80)).join(" | "));
      // 祖先に付けても子の入力欄まで効く。並び替えのタイルの中に入力欄が無いことを確かめる。
      // 【N-5】旧主張は「<ReorderableReedRows … /> の呼び出しタグの中に入力欄が無い」だった
      // (行の中身を renderRow プロップで渡していたため、呼び出しタグが中身そのものだった)。
      // タイルは ReedTileGrid が自分で描くので、**その関数の本体**を見る。
      {
        const grid = srcOfFn(src, "ReedTileGrid");
        check("並び替えのタイルを描く関数を走査できている",
          grid.length > 2000 && /className="no-select reedtile"/.test(grid), `${grid.length}文字`);
        // タイルの部分木(<button …> から </button> まで)に入力欄が無いこと
        const bStart = grid.indexOf("<button");
        const bEnd = grid.indexOf("</button>", bStart);
        const tileBlock = bStart === -1 || bEnd === -1 ? "" : grid.slice(bStart, bEnd);
        check("タイルのブロックを最後まで走査できている", tileBlock.length > 500 && /reedtile/.test(tileBlock),
          `${tileBlock.length}文字`);
        check("並び替えのタイル(no-select の祖先)の中に入力欄が無い", tileBlock !== "" &&
          !/<(input|textarea|select)[\s/>]/.test(tileBlock), tileBlock.slice(0, 80));
      }
    }

    // --- 17.15b 【F-80 / F-82】.taptext = 見た目を変えずに当たり判定だけ 44pt へ ----
    // 箱見出しの銘柄と日付は「文字そのもの」をタップさせる。padding / min-height で
    // 広げると行が 20px → 44px に伸びて**見た目が変わる**(本人指示「今の表示から変更する
    // 必要はない」)ので、レイアウトに参加しない疑似要素で広げる。
    // ここで縛るのは3つ: (a) 高さが 44pt (b) レイアウトに参加しない (c) 余計な物を持ち込まない
    {
      const tt = cssBlock(".taptext");
      const after = cssBlock(".taptext::after");
      check(".taptext / .taptext::after の規則が index.css にある", tt !== null && after !== null);
      check("index.css の .taptext::after は1回しか書かれていない",
        rulesFor(".taptext::after").length === 1, `${rulesFor(".taptext::after").length}回`);
      check(".taptext::after の高さは --tap-min(§5 の 44pt)",
        decl(after, "height") === "var(--tap-min)", String(decl(after, "height")));
      check(".taptext::after はレイアウトに参加しない(絶対配置)",
        decl(after, "position") === "absolute" && decl(tt, "position") === "relative",
        `${decl(after, "position")} / ${decl(tt, "position")}`);
      check(".taptext::after は文字の左右いっぱいを覆う",
        decl(after, "left") === "0" && decl(after, "right") === "0",
        `${decl(after, "left")} / ${decl(after, "right")}`);
      check(".taptext は当たり判定だけを持つ(地・枠・角丸・余白・文字色を持ち込まない)",
        declList(tt).every((d) => /^(position|overflow)$/.test(d.name))
        && declList(after).every((d) => /^(content|position|left|right|top|transform|height)$/.test(d.name)),
        declList(tt ?? "").concat(declList(after ?? "")).map((d) => d.name).join(" "));
      // 【F-83】当たり判定が切られないことを**構造的に**担保する。
      // コメントで禁じるだけでは破っても誰も気付かず、実ブラウザで 44px → 15px に落ちた。
      // `!important` はインラインの style に勝つために必要(素の宣言では負ける)。
      check(".taptext は overflow を visible に固定する(疑似要素ごと切られるのを構造的に防ぐ)",
        /overflow:\s*visible\s*!important/.test(String(tt)), String(tt));
      // 他の規則が `.taptext` の付いた要素を名指しで切らないこと。
      // (`.rname` は銘柄ボタンが `className="rname sans taptext"` で自分に付けているクラス名。
      //  そこに `overflow: hidden` を1行足すと当たり判定が 15px に落ちることを審査役が実測した。
      //  いまは上の !important が勝つが、**そもそも書かせない**ほうが読み手に親切)
      {
        const hostClasses = [".rname", ".sans", ".taptext"];
        const offenders = hostClasses.filter((sel) => {
          const b = cssBlock(sel);
          return b !== null && declList(b).some((d) => /^overflow/.test(d.name) && !/visible/.test(d.value));
        });
        check(".taptext を付ける要素のクラス(.rname/.sans/.taptext)を index.css が切らない",
          offenders.length === 0, offenders.join(" ") || "0件");
      }
      // 芯1(枠 ∧ 違う地)にも触れないこと。17.14 の全規則走査でも見ているが、名指しでも見る。
      check(".taptext は枠も地も持たない",
        !/border|background|box-shadow/.test(String(tt) + String(after)),
        `${tt} / ${after}`);
    }

    // --- 17.16 録音ボタン: 影を持たない(F-50) + 形は正典 .rec ----------------
    // 本人指示「録音するボタンの周辺に影がついてるので削除」。
    // box-shadow はレイアウトに影響しないので、外形寸法(§6.1.5)は変わらない。
    // 【N-4c で形が変わった】旧主張「外形は 角丸16 / padding 16px 0」→
    // 正典 .rec の **68×68 の白い円 + 1.5px の輪郭**。中身は .rec .dot(赤丸26) /
    // .rec .stop(赤い角丸22・r5)。文字を持たないので名前は aria-label が担う。
    {
      const i = src.indexOf("onClick={toggleRecording}");
      const tag = i === -1 ? "" : tagAt(src.lastIndexOf("<button", i) + 1);
      // 正典の .rec / .rec .stop を**その場で**読む(この節は §25/§26 の declOf の外にある)。
      // 綴りを写さず正典から引くのは、正典が変わったら検査も一緒に動くようにするため。
      const recMock = readFileSync(join(__dirname, "..", "design", "north-star-measure.html"), "utf8");
      const mockDecl = (sel, name) => {
        const re = new RegExp(`(^|[},])\\s*${sel.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\{([^{}]*)\\}`, "m");
        const m = re.exec(recMock.replace(/\/\*[\s\S]*?\*\//g, " "));
        if (!m) return null;
        for (const d of m[2].split(";")) {
          const k = d.slice(0, d.indexOf(":")).trim();
          if (k === name) return d.slice(d.indexOf(":") + 1).trim();
        }
        return null;
      };
      check("正典 north-star-measure.html の .rec / .rec .stop を読めている",
        mockDecl(".rec", "border") !== null && mockDecl(".rec .stop", "width") !== null,
        `${mockDecl(".rec", "border")} / ${mockDecl(".rec .stop", "width")}`);
      check("録音ボタンのタグを走査できている", /onClick=\{toggleRecording\}/.test(tag), tag.slice(0, 120));
      check("録音ボタンは影(boxShadow)を持たない",
        !withPrefix([tag], ["boxshadow"]).length, tag.replace(/\s+/g, " ").slice(0, 200));
      check("録音ボタンは正典 .rec の 68×68 の円",
        /width: 68, height: 68, borderRadius: "50%"/.test(tag), tag.replace(/\s+/g, " ").slice(0, 240));
      // 【F-89 で 1.5px → 4px】本人指示(実機 2026/08/15)「録音ボタンはスマホの動画開始、
      // 停止ボタンと同じに変更(とる前は枠全体の丸、とると四角に形が変わる形式)」。
      // 正典 .rec の輪は 1.5px だが、**本人の実機指示が正典より上位**(F-75 / F-77 と同じ扱い)。
      // 4px は DESIGN-SYSTEM にも正典にも無い**新設の値**(統括/本人の確認待ち)。
      // ここでは「地は白のまま」「輪の太さがソース中の定数 REC_RING_SW と一致する」だけを見る。
      // **これは見た目が「太い輪に見えるか」の判定ではない**(それは実機の判断)。
      check("録音ボタンは白い地 + 輪郭を持つ(正典 .rec の白地は据え置き)",
        /background: "var\(--c-surface\)", border: "\d+(\.\d+)?px solid var\(--c-line-strong\)"/.test(tag),
        tag.replace(/\s+/g, " ").slice(0, 240));
      {
        const sw = api.REC_RING_SW;
        const inTag = Number((tag.match(/border: "(\d+(?:\.\d+)?)px solid var\(--c-line-strong\)"/) || [])[1]);
        check("録音ボタンの輪の太さは REC_RING_SW と一致する(2箇所に別の値が書かれていない)",
          Number.isFinite(sw) && sw === inTag, `REC_RING_SW=${sw} / JSX=${inTag}`);
        // 「正典より太い」= 本人指示を実際に反映したことの最低条件。1.5 は正典の値。
        check("録音ボタンの輪は正典 .rec の 1.5px より太い(F-89)",
          Number.isFinite(sw) && sw > parseFloat(mockDecl(".rec", "border")), `REC_RING_SW=${sw} / 正典=${mockDecl(".rec", "border")}`);
      }
      check("録音ボタンは文字を持たないので aria-label が名前を担う",
        /aria-label=\{isRecording \? "録音を停止" : "録音する"\}/.test(tag) && !/録音する<\/button>/.test(codeOf(src)));
      check("録音ボタンはトグルなので状態を aria-pressed が持つ", /aria-pressed=\{isRecording\}/.test(tag));
      // 中身: 【F-89】待機 = 輪の内側いっぱいの赤い丸 / 録音中 = 赤い角丸 22px(正典 .rec .stop)。
      // 旧主張「待機中は赤い丸 26px(正典 .rec .dot)」は本人指示で置き換わった
      // (26px = 外径の 38% しかなく「枠全体の丸」にならない)。
      // **寸法は recInnerShape に閉じ込めた**ので、JSX ではなく関数を評価して見る
      // (JSX に数値が2箇所写っていないことは、下の「数値を書かない」で別に見る)。
      {
        const body = src.slice(src.indexOf(">", src.lastIndexOf("<button", i) + 1), src.indexOf("</button>", i));
        const idle = api.recInnerShape(false);
        const rec = api.recInnerShape(true);
        // 【期待値は実装の定数から作らない】前版は `idle.size === D - 2*(sw+gap)` と書いており、
        // **実装と同じ式を同じ定数で書き直しただけ**でどの値でも真になる恒真式だった
        // (審査役の実測: REC_RING_GAP 3→10 / 3→0 / REC_BTN_D 68→80 がすべて生存)。
        // 期待値は **JSX に実際に書かれている外径と輪の太さ**(=画面に出る値)から作る。
        // 定数側を書き換えても JSX の 68 / 4 は動かないので、食い違いがそのまま落ちる。
        const jsxD = Number((tag.match(/width: (\d+(?:\.\d+)?), height: \d/) || [])[1]);
        const jsxSW = Number((tag.match(/border: "(\d+(?:\.\d+)?)px solid/) || [])[1]);
        // 輪の内側の内容ボックス(border-box なので 外径 − 輪×2)。中身はこの中に収まる。
        const innerBox = jsxD - 2 * jsxSW;
        check("JSX の外径は正典 .rec の width と一致する",
          jsxD === parseFloat(mockDecl(".rec", "width")), `JSX=${jsxD} / 正典=${mockDecl(".rec", "width")}`);
        // (1) 待機は「円」= 半径が直径の半分。**丸であることを形で見る**(綴りではなく)
        check("待機中の中身は円(半径 = 直径の半分)",
          idle.size > 0 && idle.radius === idle.size / 2, JSON.stringify(idle));
        // (2) 「枠全体の丸」(本人指示)= 中身が輪の内側をほぼ埋める。
        //     **輪の内側に収まり**、かつ**輪に接しない**(隙間がある)ことの両方を見る。
        //     0.85 は「輪の内側の直径の85%以上」。正典の 26px は 26/60 = 0.43 で落ちる。
        check("待機中の円は輪の内側に収まる(はみ出さない)",
          idle.size <= innerBox, `内容ボックス=${innerBox} / 中身=${idle.size}`);
        check("待機中の円と輪の間に隙間がある(輪に接しない)",
          idle.size < innerBox, `内容ボックス=${innerBox} / 中身=${idle.size}`);
        check("待機中の円は輪の内側をほぼ埋める(本人指示「枠全体の丸」。内径の85%以上)",
          idle.size / innerBox >= 0.85,
          `${idle.size}/${innerBox} = ${(idle.size / innerBox).toFixed(3)}`);
        // (3) 録音中は「四角」= 半径が直径の半分**未満**。正典 .rec .stop の 22px / r5 のまま
        check("録音中の中身は角丸の四角(半径 < 直径の半分)",
          rec.radius < rec.size / 2, JSON.stringify(rec));
        check("録音中の四角は正典 .rec .stop のまま(22px / r5)",
          rec.size === parseFloat(mockDecl(".rec .stop", "width"))
          && rec.radius === parseFloat(mockDecl(".rec .stop", "border-radius")),
          `${JSON.stringify(rec)} / 正典=${mockDecl(".rec .stop", "width")} ${mockDecl(".rec .stop", "border-radius")}`);
        // (4) **どちらの状態でも中身は外径を超えない** = 形が変わっても外径は動かない。
        //     これは「位置と外径は動かさない」(本人指示)の必要条件。十分条件ではない
        //     (実際の描画位置は実機で見る)。
        check("中身はどちらの状態でも輪の内側に収まる(形だけが変わる。外径は動かない)",
          idle.size <= innerBox && rec.size <= innerBox,
          `idle=${idle.size} rec=${rec.size} 内容ボックス=${innerBox}`);
        check("待機と録音中で形が実際に変わる(同じ寸法・同じ角丸ではない)",
          !(idle.size === rec.size && idle.radius === rec.radius), `${JSON.stringify(idle)} / ${JSON.stringify(rec)}`);
        // (5) JSX 側は recInnerShape だけを参照し、寸法の数値を持たない
        //     (待機と録音中で2箇所に写すと、片方だけ直して外径が動く)
        check("録音ボタンの中身の寸法は JSX に直書きされていない(recInnerShape が唯一の答え)",
          /recInnerShape\(isRecording\)/.test(body) && !/width: \d/.test(codeOf(body)),
          codeOf(body).replace(/\s+/g, " ").slice(0, 240));
      }
    }

    // --- 17.17 【B-2 で置き換え】録音中バッジ → 録音ボタンの下の経過時間 ------
    // 元の要件(F-48)は本人指示「録音中のポップアップがメトロノームアイコンと被るので修正」。
    // 正典(design/north-star-measure.html の「演奏中」)は、上に浮かぶバッジを持たず
    // **録音ボタンの下に赤点 + m:ss** を置く。バッジそのものを撤去したので、
    // 「メトロノームアイコンを覆う」経路が構造的に消えた。
    // 【縛り方】(1) バッジが復活していないこと (2) 経過時間が録音ボタンの下にあること
    // (3) 箱を常に確保していること(出入りでレイアウトが動かない。§6.1.5)。
    {
      const code17 = codeOf(src);
      check("上に浮かぶ「録音中」バッジが復活していない(経過時間に一本化)",
        !/録音中/.test(code17), (code17.match(/.{0,30}録音中.{0,30}/) || [""])[0]);
      const i = code17.indexOf("formatElapsedMs(recElapsedMs)");
      check("録音の経過時間を出している(m:ss)", i !== -1);
      const box = i === -1 ? "" : code17.slice(code17.lastIndexOf("<div className=\"sans\"", i), i);
      check("経過時間は赤点(--c-danger)を伴う", /var\(--c-danger\)/.test(box), box.replace(/\s+/g, " ").slice(0, 160));
      // 【逸脱6 の撤回】寸法は正典 .rectime / .recdot: 12px / gap 6 / 赤点 6×6。
      // 箱の高さは固定のまま(録音の有無で行が増減しない。§6.1.5)。
      check("経過時間の箱は常に確保されている(高さが固定で、録音の有無で行が増減しない)",
        /height: 19, marginTop: "var\(--sp-1\)"/.test(box), box.replace(/\s+/g, " ").slice(0, 200));
      check("経過時間は正典 .rectime の 12px / gap 6",
        /gap: 6, fontFamily: "var\(--font-num\)", fontSize: 12/.test(box), box.replace(/\s+/g, " ").slice(0, 200));
      check("赤点は正典 .recdot の 6×6", /width: 6, height: 6, background: "var\(--c-danger\)"/.test(box));
      // 録音ボタンより**後ろ**にある = 画面上では下(正典の .rectime の位置)。
      const rb = code17.indexOf("onClick={toggleRecording}");
      check("経過時間は録音ボタンの下に置かれている", rb !== -1 && i > rb, `録音ボタン ${rb} / 経過時間 ${i}`);
      const mi = src.indexOf('aria-label="メトロノーム"');
      const mtag = mi === -1 ? "" : tagAt(mi);
      // 高さ56 = 上部バー2行ぶん。幅は --tap-min(44px)。バッジが無くなっても寸法は不変。
      check("メトロノームアイコンは2行ぶんの高さ(height 56)でタップ幅は --tap-min",
        /width: "var\(--tap-min\)", height: 56/.test(mtag), mtag.replace(/\s+/g, " ").slice(0, 200));
    }

    // --- 17.18 F-63 測定ボタンは計測タブと同じアイコン(絵は1箇所に閉じる) -----
    // 本人指示「登録済みリードの一覧の測定ボタンを測定タブと同じアイコンに変更」。
    // **同じ絵を2箇所に書かないこと**が要件の中身。コピーを残すと、次に絵を直した人が
    // 片方だけ直して食い違う。綴りが1箇所しか無いことを、絵そのもの(path の d)で見る。
    {
      const code = codeOf(src);
      check("MeasureIcon が共通コンポーネントとして存在する", /function MeasureIcon\(/.test(src));
      const arcs = (code.match(/M4 15 A8 8 0 0 1 20 15/g) || []).length;
      check("計測の絵(メーターの弧)はアプリ全体で1箇所だけ(コピーが残っていない)",
        arcs === 1, `${arcs}箇所`);
      // 引数の分割代入({ size = 30, … })で終端を誤らないよう、括弧を数えてから本体を取る
      // (ファイル先頭の extractFunction は引数の { を本体の { と読むので使えない)。
      const bodyOf = (name) => {
        const idx = src.indexOf(`function ${name}(`);
        if (idx === -1) return "";
        let i = src.indexOf("(", idx), d = 0;
        for (; i < src.length; i++) {
          if (src[i] === "(") d++;
          else if (src[i] === ")") { d--; if (d === 0) { i++; break; } }
        }
        while (i < src.length && src[i] !== "{") i++;
        d = 0;
        for (; i < src.length; i++) {
          if (src[i] === "{") d++;
          else if (src[i] === "}") { d--; if (d === 0) return src.slice(idx, i + 1); }
        }
        return "";
      };
      const body = bodyOf("MeasureIcon");
      check("MeasureIcon の本体を走査できている", body !== "" && body.includes("</svg>"), `${body.length}文字`);
      check("その1箇所は MeasureIcon の中にある", /M4 15 A8 8 0 0 1 20 15/.test(body));
      check("MeasureIcon は針と軸の点も持つ(弧だけの別物になっていない)",
        /<line x1="12" y1="15" x2="15" y2="9" \/>/.test(body) && /<circle cx="12" cy="15" r="1.4"/.test(body));
      // 【変異で1度すり抜けた】`/size = 30/` だけを見ていたら、本体に const size = 30 を
      // 置いて引数から size を消す変異が通った(呼び出し側がサイズを決められなくなるのに緑)。
      // **引数の並びそのもの**を見る。
      check("MeasureIcon のサイズは呼び出し側が決められる(size は引数で既定30)",
        /function MeasureIcon\(\{ size = 30\b/.test(body) && /width=\{size\} height=\{size\}/.test(body),
        body.replace(/\s+/g, " ").slice(0, 120));
      check("MeasureIcon の中でサイズを固定していない(引数の size を握り潰していない)",
        !/const size\s*=/.test(codeOf(body)), body.replace(/\s+/g, " ").slice(0, 120));
      check("MeasureIcon は装飾(aria-hidden)。意味は呼び出し側の aria-label が担う",
        /aria-hidden="true"/.test(body));
      // 下部ナビ側: 計測タブのアイコンが MeasureIcon になっている
      {
        const i = src.indexOf('key: "measure", label: "計測"');
        const block = i === -1 ? "" : src.slice(i, i + 200);
        check("下部ナビの計測タブは MeasureIcon を使う", /<MeasureIcon/.test(block), block.replace(/\s+/g, " ").slice(0, 120));
        check("下部ナビは選択色を渡せる(現在タブと非選択で色が変わる挙動を壊していない)",
          /<MeasureIcon color=\{c\}/.test(block), block.replace(/\s+/g, " ").slice(0, 120));
      }
      // 【N-5】リード一覧の行にあった「測定」ボタンは**個体詳細の「このリードで計測」へ移った**
      // (本人決定6:「計測ジャンプは個体詳細内」)。旧主張は
      //   一覧の行の測定ボタンが MeasureIcon を描く / aria-label="測定" を持つ /
      //   当たり判定 44×44 / 行の長押しを stopPropagation で止める
      // 新主張は「一覧に測定の入口は無い」+「個体詳細に正典 .bigbtn の
      // 『このリードで計測』が1つある」。**ジャンプ機能そのものは落ちていない**ことを
      // 遷移(setSelectedReedId → setTopTab("measure"))まで見て確かめる。
      {
        check("N-5: 一覧の行の測定ボタン(goToMeasure)は無くなった",
          !/goToMeasure/.test(codeOf(src)), (codeOf(src).match(/goToMeasure/g) || []).join(","));
        const detail = srcOfFn(src, "ReedEvaluationDetail");
        check("N-5: 個体詳細に「このリードで計測」が1つある",
          (detail.match(/このリードで計測/g) || []).length === 1,
          `${(detail.match(/このリードで計測/g) || []).length}箇所`);
        const i = detail.indexOf("このリードで計測");
        const btn = i === -1 ? "" : detail.slice(detail.lastIndexOf("<button", i), i);
        check("「このリードで計測」は onMeasure(reed.id) を呼ぶ",
          /onClick=\{\(\) => onMeasure\?\.\(reed\.id\)\}/.test(btn), btn.replace(/\s+/g, " ").slice(0, 160));
        check("「このリードで計測」の当たり判定は 44px 以上(§5)",
          /minHeight: "var\(--tap-min\)"/.test(btn), btn.replace(/\s+/g, " ").slice(0, 200));
        // 見た目は正典 .bigbtn(紺の塗り / 14px / 600 / padding 11px 26px / 角丸999)
        const bigbtn = i === -1 ? "" : detail.slice(i - 400, i);
        check("「このリードで計測」は正典 .bigbtn の紺の塗りピル",
          /fontSize: 14, fontWeight: 600, color: "var\(--c-on-accent\)",\s*\r?\n?\s*background: "var\(--c-accent\)", borderRadius: 999, padding: "11px 26px"/.test(bigbtn),
          bigbtn.replace(/\s+/g, " ").slice(-200));
        // 渡す側: 計測タブのリードを選んでからタブを移す(現行の goToMeasure と同じ2手)
        check("N-5: ジャンプは「リードを選ぶ → 計測タブへ移る」の2手のまま",
          /onMeasure=\{\(id\) => \{ setSelectedReedId\(id\); setTopTab\("measure"\); \}\}/.test(src));
        check("TAP_BUTTON_RESET が minHeight: var(--tap-min) を持つ(削除モードのピルが使う)",
          /const TAP_BUTTON_RESET = \{[\s\S]*?minHeight: "var\(--tap-min\)"/.test(src));
      }
    }

    // --- 17.19 【N-5 で置き換え】F-64 の三本線 → 正典 .tile.drag の浮き上がり ----
    // 旧主張(F-64 本人指示): 一覧の行の右端に「長押しで順番変更」を意味する三本線を置き、
    //   測定ボタンより外側(右)に並べ、目印自身は stopPropagation しない(掴んだときだけ
    //   並び替え不能になるのを防ぐ)。
    // 新主張: 行が 5×2 のタイルになって**目印を載せる場所が無い**。
    //   代わりに正典 .tile.drag(浮き上がり + 影 + 枠が紺)で「持ち上がった」ことを示す。
    //   目印が無いので「目印が掴めない」という事故も構造ごと消えている。
    {
      const grid = srcOfFn(src, "ReedTileGrid");
      check("N-5: 三本線(GripLines)の import も描画も残っていない",
        !/\bGripLines\b/.test(codeOf(src)), (codeOf(src).match(/GripLines/g) || []).join(","));
      // 持ち上がりは**指を動かす前から**分かる(長押し成立の瞬間に drag が入る)
      check("長押しが成立した瞬間に持ち上がる(移動量を待たない)",
        /setReedTileDragActive\(true\);[\s\S]{0,120}?setDrag\(\{/.test(grid));
      check("持ち上がりの見た目は data-drag で CSS 側に渡す",
        /data-drag=\{isDragging \? "true" : "false"\}/.test(grid));
      // 正典 .tile.drag の3点(浮き上がり / 影 / 紺の枠)が実際に定義されていること
      {
        const dragBlock = cssBlock('.reedtile[data-drag="true"]');
        check("正典 .tile.drag の影と紺の枠が index.css にある",
          dragBlock !== null && /border-color:\s*var\(--c-accent\)/.test(dragBlock)
          && /box-shadow:\s*0 10px 22px/.test(dragBlock), String(dragBlock).replace(/\s+/g, " "));
        check("index.css の .reedtile[data-drag] は1回しか書かれていない",
          rulesFor('.reedtile[data-drag="true"]').length === 1,
          `${rulesFor('.reedtile[data-drag="true"]').length}回`);
      }
      // 【F-79b で書き換えた】
      // 旧主張: transform は `translate(${dragOffset.x}px, ${dragOffset.y - 6}px) rotate(-2deg)`
      //         という**綴り**である(= 掴んだ点からの移動量をそのまま当てる)。
      //         その式は入れ替えでタイルのレイアウト位置が動くと丸ごと指からずれる
      //         (本人の実機報告「入れ替えると自分の持っている指からずれる」)。
      // 新主張: 見た目は純関数 reedTileVisual が決め、JSX はその戻り値を当てるだけ。
      //         浮き上がり(-6px / -2deg)は**実行で**確かめる(下の 25.6 節)。
      check("F-79b: タイルの transform / transition / 前後関係は reedTileVisual が決める",
        /transform: vis\.transform,/.test(grid) && /transition: vis\.transition,/.test(grid)
        && /zIndex: vis\.zIndex,/.test(grid)
        && /const vis = reedTileVisual\(drag, r\.id, home, cur\);/.test(grid));
      check("F-79b: ドラッグ中は DOM の並びを凍結する(描くのは drag.baseOrder)",
        /const renderIds = drag \? drag\.baseOrder : order;/.test(grid)
        && /const cur = drag \? order\.indexOf\(r\.id\) : home;/.test(grid));
      check("F-79b: 掴んだ瞬間に指とタイル左上のずれ(grabX/grabY)を控える",
        /grabX: pending\.lastX - rect\.left,/.test(grid) && /grabY: pending\.lastY - rect\.top,/.test(grid));
      check("F-79b: 各マスの左上は掴んだ瞬間に実測して控える(以後は測り直さない)",
        /const cells = Array\.from\(gridRef\.current\?\.children \|\| \[\]\)\.map\(/.test(grid));
      // タイル全体の長押しで並び替えが始まる仕組み(掴む場所を限定しない)
      check("タイル全体の長押しで並び替えが始まる",
        /onPointerDown=\{handlePointerDown\(r\.id, idx\)\}/.test(grid));
      // タイルの中に stopPropagation を持つ子が1つも無い(=どこを掴んでも並び替えできる)
      check("タイルの中で長押しを止める子が1つも無い",
        (codeOf(grid).match(/stopPropagation/g) || []).length === 0,
        `${(codeOf(grid).match(/stopPropagation/g) || []).length}箇所`);
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
      // F-54 で groupFramesByNote が音名を実音(concertLabel)で返すようになり、
      // その導出に必要なものを一式取り込む(運指テーブル → 実音Hz → 実音の音名)。
      // 取り込まないと groupFramesByNote の評価が ReferenceError で落ちる。
      extractConst("SAX_CONCERT_RANGE"),
      extractConst("LOW_BB_WRITTEN_MIDI"),
      extractConst("NOTE_NAMES"),
      extractFunction("writtenMidiToSoundingFreq"),
      extractFunction("writtenNoteLabel"),
      extractFunction("freqToNote"),
      extractFunction("concertFreqLabel"),
      extractFunction("buildFingeringTable"),
      extractFunction("concertNoteTableOf"),
      extractFunction("concertNoteLabelOf"),
      extractFunction("concertNoteFreqOf"),
      extractFunction("groupFramesByNote"),
      extractFunction("groupFramesByNoteAcrossSessions"),
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
      // F-54: 音名の次元 / groupFramesByNote が実音ラベルを運指から導くようになったので、
      // その依存(運指テーブル → 実音Hz → 実音の音名)をここにも取り込む。
      extractConst("SAX_CONCERT_RANGE"),
      extractConst("LOW_BB_WRITTEN_MIDI"),
      extractConst("NOTE_NAMES"),
      extractFunction("writtenMidiToSoundingFreq"),
      extractFunction("writtenNoteLabel"),
      extractFunction("freqToNote"),
      extractFunction("concertFreqLabel"),
      extractFunction("buildFingeringTable"),
      extractFunction("concertNoteTableOf"),
      extractFunction("concertNoteLabelOf"),
      extractFunction("concertNoteFreqOf"),
      extractFunction("groupFramesByNote"),
      extractFunction("groupFramesByNoteAcrossSessions"),
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
    extractConst("RING_PEND_SWING_DEG"),
    extractConst("METRO_ARC_P0"),
    extractConst("METRO_ARC_C"),
    extractConst("METRO_ARC_P2"),
    extractConst("METRO_ARC_PX_PER_DEG"),
    extractConst("RING_PEND_SETTLE_EPS_VB"),
    extractFunction("ringPendDeg"),
    extractFunction("ringPendSettleDeg"),
    extractFunction("ringPendSettleDone"),
  ].join("\n\n")}
    return { fillViewportMinHeight, audioClockStalled, ringPendDeg, ringPendSettleDeg, ringPendSettleDone,
             AUDIO_CLOCK_STALL_MIN_WALL_S, AUDIO_CLOCK_STALL_RATIO, RING_PEND_SETTLE_EPS_VB,
             METRO_ARC_P0, METRO_ARC_C, METRO_ARC_P2, METRO_ARC_PX_PER_DEG, RING_PEND_SWING_DEG };`)();

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
    // 【N-4b】振り子は環の外へ出た。配線を見る先は MetroPendulum。
    const ring = codeOf(componentSourceOf("MetroPendulum"));
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
      const m = /dot\.setAttribute\("cx", px\.toFixed\((\d+)\)\)/.exec(ring);
      check("F-51: 点の座標を書く桁数を実ソースから読めている", m !== null, String(m && m[1]));
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
      // 【N-4b】変位は「弧の上の実際の移動量」で測る。**定数 METRO_ARC_PX_PER_DEG を
      // 使わずに** metroArcPoint を実際に回して x の差から出す(定数の言い換えにしない)。
      // 角度→t は線形なので、中央付近が最も速い=最悪ケースになる。
      const dispAt = (deg) => {
        const t0 = 0.5, t1 = 0.5 + deg / (2 * api20.RING_PEND_SWING_DEG);
        const bez = (t) => {
          const u = 1 - t;
          return u * u * api20.METRO_ARC_P0[0] + 2 * u * t * api20.METRO_ARC_C[0] + t * t * api20.METRO_ARC_P2[0];
        };
        return Math.abs(bez(t1) - bez(t0));
      };
      const disp = (t) => dispAt(Math.abs(A) * Math.exp(-t / D));
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
      // 弧は実寸で描く(viewBox 1単位 = 1 CSS px)ので、換算は要らない。
      if (tFirst !== null) console.log(`  静止に切り替わる瞬間の飛び: ${disp(tFirst).toExponential(3)} CSS px ` +
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

  // --- 20.4 【A-1 で置き換え】錘のタップ → **画面のどこをタップしても開始/停止** ----
  // 元の指示(F-51)は「振り子をタップでスタートしてもメトロノームがスタートする」。
  // 正典の決定2(2026/08/11)はこれを広げて「画面のどこをタップしてもよい。
  // ただし操作要素の上ではその要素の機能が勝つ」。錘のタップはこれに吸収された。
  // 【縛り方】(1) 背面レイヤが計測タブの全面を覆い、押すと開始/停止すること
  //           (2) stopPropagation で実装していないこと(伝播を止める作りにしない)
  //           (3) 押せなければならない物が**前面(z-index 1)**に居ること。
  //               ここが本体。1つでも背面に落ちると「押しても何も起きない」が生まれる(§6.1.5)。
  {
    const code20 = codeOf(src);
    const i = code20.indexOf('aria-label="メトロノームの開始/停止"');
    const tapTag = i === -1 ? "" : code20.slice(code20.lastIndexOf("<button", i), code20.indexOf("/>", i) + 2);
    check("A-1: 画面タップ用の背面レイヤがある", i !== -1 && /position: "absolute", zIndex: 0/.test(tapTag),
      tapTag.replace(/\s+/g, " ").slice(0, 200));
    // 【審査⑤の修正】枠の中だけに敷くと、.app-root の padding(左右14px帯・上端16px帯)が
    // 外に残り、審査役の1px刻み全走査で 26,972px²(画面の8.9%)が無反応だった。
    // 負のオフセットで padding のぶんだけ広げる。**式は .app-root の padding と同じもの**を
    // 符号だけ変えて書く(別管理にすると安全域のある端末でずれる)。
    {
      const rootPad = /className="app-root"[\s\S]{0,400}?padding: "([^"]+)"/.exec(code20);
      check("A-1: .app-root の padding を実ソースから読めている", rootPad !== null, rootPad ? rootPad[1] : "");
      // padding は「上 右 下 左」の4値。上・右・左をレイヤの負のオフセットと突き合わせる。
      // padding の4値を「括弧の外の空白」で割る(calc(...) の中の空白では割らない)
      const splitTop = (str) => {
        const out = []; let d = 0, cur = "";
        for (const ch of str) {
          if (ch === "(") d++;
          else if (ch === ")") d--;
          if (/\s/.test(ch) && d === 0) { if (cur) out.push(cur); cur = ""; } else cur += ch;
        }
        if (cur) out.push(cur);
        return out;
      };
      const [padTop, padRight, , padLeft] = splitTop(rootPad ? rootPad[1] : "");
      // calc(16px + env(x)) → calc(-16px - env(x))。**中身の符号だけ**を反転する
      // (末尾の ) を落とすと env( の閉じ括弧を壊す)。
      const neg = (v) => {
        const m = /^calc\((.*)\)$/.exec(String(v).trim());
        const body = m ? m[1] : String(v).trim();
        return "calc(-" + body.replace(/ \+ /g, " - ") + ")";
      };
      // 【F-74 で主張が変わった】
      //   旧主張: レイヤは上端も .app-root の padding-top(16px + 安全域)ぶん負に広げる
      //           = 画面の一番上まで覆う
      //   新主張: **上端は広げない。** 覆う範囲は「上部設定行の直下 〜 テンポ操作行の下端」に
      //           限る(本人指示 2026/08/12・実機「どこをタップしても作動しすぎる。上部の
      //           奏者やリード表示があるところより下から、テンポ表示があるところまで」)。
      //           上端の負オフセットは「上端の塊との固定の間隔 --sp-1」ぶんだけで、
      //           これは**上部設定行の下端とレイヤの間に無反応の隙間を作らない**ための最小値。
      // padTop は使わなくなったが、左右の突き合わせで rootPad 自体は引き続き使う。
      check("F-74: レイヤの上端は .app-root の padding-top まで広げない(上部設定行は覆わない)",
        !new RegExp('top: "' + neg(padTop).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"').test(tapTag),
        `覆わない期待 / 実際 ${(tapTag.match(/top: "[^"]*"/) || [""])[0]}`);
      check("F-74: レイヤの上端は「上端の塊との固定の間隔」ぶんだけ遡る(隙間を作らない)",
        /top: "calc\(-1 \* var\(--sp-1\)\)"/.test(tapTag),
        (tapTag.match(/top: "[^"]*"/) || ["top 無し"])[0]);
      check("A-1: レイヤは左右を .app-root の padding ぶん広げている",
        new RegExp('left: "' + neg(padLeft).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"').test(tapTag)
        && new RegExp('right: "' + neg(padRight).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"').test(tapTag),
        `期待 ${neg(padLeft)} / 実際 ${(tapTag.match(/left: "[^"]*"/) || [""])[0]}`);
      // 下端は広げない。広げると下部ナビ(position:fixed / z-index 30)の帯に重なる意図が生まれ、
      // 「ナビを奪わない」という約束が読めなくなる。
      check("A-1: レイヤの下端は広げない(下部ナビの帯を奪わない)", /bottom: 0,/.test(tapTag),
        (tapTag.match(/bottom: [^,]*/) || [""])[0]);
    }
    check("A-1: レイヤは既存の startMetronome / stopMetronome をそのまま呼ぶ(発音・位相に触れない)",
      /onClick=\{\(\) => \(metronomeOn \? stopMetronome\(\) : startMetronome\(\)\)\}/.test(tapTag));
    check("A-1: 状態は aria-pressed が持つ", /aria-pressed=\{metronomeOn\}/.test(tapTag));
    check("A-1: レイヤは見た目を持たない(地も枠も無い透明な当たり判定)",
      /background: "transparent"/.test(tapTag) && /border: "none"/.test(tapTag), tapTag.replace(/\s+/g, " ").slice(0, 240));
    check("A-1: レイヤはメトロノームを開いている間だけ出す(素の計測タブでは誤爆しない)",
      /\{showMetroPanel && \(\s*<button/.test(code20.replace(/\s+/g, " ").replace(/\{showMetroPanel && \( <button/g, "{showMetroPanel && (\n<button")) ||
      /\{showMetroPanel && \([\s\S]{0,40}<button/.test(code20));
    // 【F-74 で主張が変わった】レイヤが覆う範囲。
    //   旧主張: 画面ぶんの枠(minHeight: measureMinH)の中を丸ごと覆う
    //   新主張: 枠の中の「チューナーの帯」= 環 + 可変の中間 だけを覆う。
    //           帯は flexShrink:0 で**中身ぶんの高さしか持たない**ので、
    //           帯の下端 = (メトロノームを開いていれば)テンポ操作行の下端になる。
    //           余りは帯の外の**スペーサー(flex:1)**が吸収する。
    // ここが F-74 の本体なので、構造を3点で縛る:
    //   (a) レイヤの親が position:relative + flexShrink:0 の帯である
    //   (b) 帯の中に 環 と 可変の中間 が入っている
    //   (c) 余りを吸収する flex:1 が帯の**外**にある(帯の中に戻すと下端が伸びて元に戻る)
    {
      const frameStart = code20.indexOf('minHeight: measureMinH');
      const bandStart = code20.indexOf('<div style={{ position: "relative", flexShrink: 0 }}>', frameStart);
      const layerAt = code20.indexOf('aria-label="メトロノームの開始/停止"');
      const spacerAt = code20.indexOf('<div style={{ flex: "1 1 auto", minHeight: 0 }} />');
      const ringAt = code20.indexOf('<PitchRing note={note}');
      const tempoRowAt = code20.indexOf('aria-label="テンポを下げる"');
      check("A-1: 画面ぶんの枠がある(position:relative + minHeight: measureMinH)",
        /position: "relative", display: "flex", flexDirection: "column", minHeight: measureMinH/.test(code20));
      check("F-74: レイヤは「チューナーの帯」(position:relative + flexShrink:0)の中に敷いてある",
        bandStart !== -1 && layerAt > bandStart, `帯 ${bandStart} / レイヤ ${layerAt}`);
      check("F-74: 帯の中に 環 と テンポ操作行 が入っている",
        bandStart !== -1 && ringAt > bandStart && tempoRowAt > bandStart,
        `帯 ${bandStart} / 環 ${ringAt} / テンポ行 ${tempoRowAt}`);
      check("F-74: 余りを吸収する flex:1 は帯の**外**(帯の下端がテンポ操作行の下端で止まる)",
        spacerAt !== -1 && spacerAt > tempoRowAt, `スペーサー ${spacerAt} / テンポ行 ${tempoRowAt}`);
      // 可変の中間から flex:1 が抜けていること(残っていると帯が伸びて範囲が元に戻る)
      check("F-74: 可変の中間はもう余りを吸収しない(flex:1 を持たない)",
        !/<div style=\{\{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" \}\}>/.test(code20));
    }
    check("A-1: 詳細カードはレイヤの外(枠の外・下)にあり、覆われない",
      /\{detailOpen && \(\s*<div style=\{\{ padding: "16px 0 10px" \}\}>/.test(code20));
    // 【F-73】ピッカーを開いている間はレイヤを無効化する(本人報告「メトロノームの開始/停止が
    // 優先されて動かない」)。**ピッカーの置き場所も併せて縛る**: 上部設定行(.tap-through =
    // pointer-events:none)の中に戻すと、暗幕もピッカーの行も当たり判定を失って
    // タップがレイヤへ抜ける。テンポシートと同じ「枠の外」に居ることを位置で見る。
    check("F-73: ピッカーを開いている間は背面レイヤを無効化する",
      /disabled=\{openPicker !== null\}/.test(tapTag), tapTag.replace(/\s+/g, " ").slice(0, 260));
    {
      // 「枠の外」の位置は**コメントではなくコードの目印**で見る(codeOf がコメントを潰すため)。
      // 詳細カード `{detailOpen && (` は「枠の外・下」にあることを上で別途縛ってあるので、
      // それより後ろ = 枠の外。逆に、枠の中にある録音ボタンより前なら枠の中に戻ったということ。
      const detailAt = code20.indexOf("{detailOpen && (");
      const recAnchor = code20.indexOf('aria-label={isRecording ? "録音を停止" : "録音する"}');
      const pickers = [...code20.matchAll(/\{openPicker === "(tuning|sax)" && \(/g)].map((m) => ({ k: m[1], at: m.index }));
      check("F-73: スクロールピッカーの分岐を2つとも走査できている", pickers.length === 2,
        pickers.map((p) => `${p.k}@${p.at}`).join(" "));
      check("F-73: スクロールピッカーは画面ぶんの枠の**外**に置く(.tap-through の中に戻さない)",
        detailAt !== -1 && recAnchor !== -1 && pickers.length === 2
        && pickers.every((p) => p.at > detailAt && p.at > recAnchor),
        `詳細カード ${detailAt} / 録音ボタン ${recAnchor} / ` + pickers.map((p) => `${p.k}@${p.at}`).join(" "));
      // 録音ボタンも無効化する(本人「録音ボタンも選択肢提示中に有効になっている」)
      const recAt = code20.indexOf('aria-label={isRecording ? "録音を停止" : "録音する"}');
      const recTag = recAt === -1 ? "" : code20.slice(code20.lastIndexOf("<button", recAt), code20.indexOf(">", code20.indexOf("className=", recAt)) + 1);
      check("F-73: ピッカーを開いている間は録音ボタンも無効化する",
        /disabled=\{openPicker !== null\}/.test(recTag), recTag.replace(/\s+/g, " ").slice(0, 240));
      // ピッカー自体の作法(暗幕タップ / Esc で閉じる)は変えていない
      const pi = code20.indexOf("function ScrollPicker");
      const picker = pi === -1 ? "" : code20.slice(pi, code20.indexOf("function PickChevron"));
      check("F-73: ピッカーは暗幕タップで閉じる作法のまま", /onClick=\{onClose\}/.test(picker));
      check("F-73: ピッカーは Esc で閉じる作法のまま", /e\.key === "Escape"/.test(picker) && /onClose\(\)/.test(picker));
      check("F-73: ピッカーの暗幕は position:fixed の z-index 60(枠の中の z-index 1 より上)",
        /position: "fixed", inset: 0, zIndex: 60/.test(picker));
    }
    // stopPropagation で作っていないこと。伝播を止める作りは、document まで届くことに
    // 依存している既存の仕組み(マイク復旧のジェスチャー経路)を壊しうる。
    {
      const mv = code20.slice(code20.indexOf("function MeasureView(props)"), code20.indexOf("function PhraseTimeline"));
      const sp = (mv.match(/stopPropagation/g) || []).length;
      // 残ってよいのは「目安プロファイルの削除」と「シートの中身」の2箇所だけ。
      check("A-1: 開始/停止は stopPropagation ではなく重ね順で実装している(伝播を止める作りにしない)",
        sp <= 2, `MeasureView 内の stopPropagation ${sp}箇所`);
    }
    // 【審査②③の修正】前面に居なければならない物を、**綴りの列挙ではなく性質**で見る。
    //
    // 旧: 4件を needle で名指ししていたが、そのうち「上部設定行」の needle が
    //     'opacity: isRecording ? 0.35 : 1, display: "flex"' で **zIndex を含んでいなかった**。
    //     審査役が上部設定行から position/zIndex を削る変異を当てたところ**生存**した
    //     (=メトロノームトグル・Alto・442Hz・リード・奏者が全部背面に沈む変異を通していた)。
    // 旧: 「.tap-through は2箇所」と**箇所数を固定**していたため、テンポ行に .tap-through を
    //     足す正しい修正をすると落ちた。**正しい修正で落ちる検査は検査ではない。**
    //
    // 新: MeasureView の中で「背面レイヤより手前に居なければならない箱」を
    //     **操作要素を含むかどうか**で機械的に見つけ、その全部が
    //       (a) position:relative + zIndex:1 を持つ
    //       (b) className に tap-through を持つ(箱自身は当たり判定を持たない)
    //     を満たすことを見る。件数は固定しない(増減しても性質だけを見る)。
    {
      const mvStart = code20.indexOf("function MeasureView(props)");
      const mvEnd = code20.indexOf("function PhraseTimeline");
      const mv = code20.slice(mvStart, mvEnd);
      // zIndex: 1 を持つ箱を全部集める(= 作者が「前面に出す」と決めた箱)
      const front = [...mv.matchAll(/<div ([^>]*?)zIndex: 1([^>]*?)>/g)].map((m) => m[0]);
      // 3箱 = 上部設定行 / テンポの操作行 / 録音ボタンと詳細トグルの塊。
      // 下限で縛る(減らして「0件だから合格」を作らせない)。増える分には性質の検査が受け止める。
      check("A-1: 前面(zIndex 1)に出している箱を走査できている", front.length >= 3, `${front.length}箱`);
      // (a) 位置指定が無いと z-index は効かない。static のまま zIndex を書いても無視される。
      const noPos = front.filter((t) => !/position: "relative"/.test(t));
      check("A-1: 前面の箱はすべて position:relative を持つ(static だと z-index が効かない)",
        noPos.length === 0, noPos.map((t) => t.slice(0, 90)).join(" | "));
      // (b) 箱自身が当たり判定を持つと、その中の**余白**でタップが死ぬ(審査①の実測)。
      //     箱は .tap-through で当たり判定を捨て、中の <button>/<select> だけが取り戻す。
      const noThrough = front.filter((t) => !/className="tap-through"/.test(t) && !/pointerEvents: "none"/.test(t));
      check("A-1: 前面の箱はすべて当たり判定を捨てている(.tap-through か pointerEvents:none)",
        noThrough.length === 0, noThrough.map((t) => t.slice(0, 120)).join(" | "));
      // 名指しの補助(消えたら気付けるように)。**上部設定行は zIndex を含む綴りで見る**。
      for (const [label, needle] of [
        ["上部設定行(奏者・楽器・基準ピッチ・リード・メトロノーム)",
          'className="tap-through" style={{ position: "relative", zIndex: 1, opacity: isRecording ? 0.35 : 1'],
        // 【F-95a】gap は正典の 34 を METRO_SCALE 倍した METRO_PM_GAP_CSS で描く。
        // ここで見ているのは「前面に居ること」なので、綴りは今の実装に合わせて更新する。
        ["テンポの操作行(− / ♩=n / ＋)",
          'className="tap-through" style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: METRO_PM_GAP_CSS }}'],
        ["録音ボタンと詳細トグルの塊",
          'className="tap-through" style={{ position: "relative", zIndex: 1, flexShrink: 0 }}'],
      ]) {
        check(`A-1: 前面(position:relative + z-index 1)に居る: ${label}`, code20.includes(needle), needle);
      }
    }
    // モーダル類はさらに上(z-index 60)。レイヤに吸われない。
    check("A-1: テンポシートは z-index 60(背面レイヤに吸われない)",
      /aria-label="テンポと拍子"[\s\S]{0,400}?zIndex: 60/.test(code20));

    // 【375×812 の実測で見つけて直した穴】前面に上げた箱は、位置指定された透明な板として
    // レイヤを覆う。箱そのものが当たり判定を持つと、その中の**余白**でタップが死ぬ
    // (実測では 環の中・振り子の上・拍の●・録音ボタンの左右・経過時間の行 で死んでいた)。
    // 直し方は「箱は当たり判定を捨て、押せる物だけが取り戻す」。ここを綴りで固定する。
    {
      // (a) 読むだけの箱は丸ごと当たり判定を持たない
      for (const [label, needle] of [
        ["環(PitchRing の外枠)", 'margin: "0 auto", position: "relative", pointerEvents: "none"'],
        // 【F-95a】縦の間隔も METRO_SCALE 倍で開くようになった(calc の中に倍率が入る)。
        ["振り子と拍の●(MetroPendulum の外枠)", 'alignItems: "center", gap: `calc(var(--sp-2) * ${METRO_SCALE})`, pointerEvents: "none"'],
      ]) {
        check(`A-1: 読むだけの箱は当たり判定を持たない: ${label}`, code20.includes(needle), needle);
      }
      // (b) .tap-through は「使われていること」だけを見る(**箇所数は固定しない**)。
      //     数を固定すると、押せる箱を1つ足すたびに正しい修正が落ちる。
      const tt = (code20.match(/className="tap-through"/g) || []).length;
      check("A-1: 操作を含む箱は .tap-through を使う(1箇所以上)", tt >= 1, `${tt}箇所`);
      // (c) 入力欄は <button> ではないので index.css の .tap-through button では戻らない。
      //     **入力欄そのもの**に pointerEvents:"auto" が要る(リード選択の箱2つと奏者セレクタ)。
      //     ピルの箱の側に付けると、箱の padding と点の上でタップが死ぬ(審査①の実測)。
      {
        // 【F-72 で目印が変わった】枠から .ctl-plain(地)を外したので、目印は htmlFor だけになる。
        // 【差し戻し①】終端も「その label の閉じタグ」で取る(option の綴りは配列へ移ったので
        // reedPosition を目印にすると、枠の外(配列の定義側)を掴んでしまう)。
        const pillStart = code20.lastIndexOf("<label", code20.indexOf('htmlFor="measure-reed-box"', code20.indexOf("function MeasureView(props)")));
        const pill = pillStart === -1 ? "" : code20.slice(pillStart, code20.indexOf("</label>", pillStart));
        const selects = (pill.match(/<select[\s\S]*?\n\s*>/g) || []);
        // 【審査④⑥の修正】旧は「箱そのものは当たり判定を持たない」を `style={{` の**直後**だけで
        // 見ており、style の**末尾**に pointerEvents を足す変異が生存した。
        // さらに「左端だけ label」では枠の上下 2px・右 4px が背面レイヤに落ちたまま残った(実測 1,088px²)。
        // 新: **枠まるごとが箱の <select> の <label>** = 枠の中に当たり判定の穴が構造的に無い。
        // 綴りの並び順にも位置にも依存しない「構造」で見る。
        {
          const pillTag = (pill.match(/<label htmlFor="measure-reed-box"[\s\S]*?>/) || [""])[0];
          check("A-1: リード枠のタグを走査できている", /htmlFor="measure-reed-box"/.test(pillTag), pillTag.slice(0, 140));
          check("A-1: リード枠そのものが箱の <select> の <label>(枠の中に当たり判定の穴を作らない)",
            /^<label htmlFor="measure-reed-box"/.test(pillTag),
            pillTag.replace(/\s+/g, " ").slice(0, 200));
          check("A-1: リード枠は当たり判定を取り戻している(.tap-through の中なので明示が要る)",
            /pointerEvents: "auto"/.test(pillTag), pillTag.replace(/\s+/g, " ").slice(0, 200));
          check("A-1: その <label> が指す id が箱の <select> にある",
            /<select\s+id="measure-reed-box"/.test(pill));
          // 枠の中に「label にも select にも属さない箱」を挟んでいないこと(挟むと穴が復活する)
          // 【F-72】中身は 点の span / select 2つ / ▾(PickChevron)。**div は 0 のまま**。
          const innerTags = (pill.match(/<(div|span|select)[\s>]/g) || []).map((t) => t.slice(1).trim());
          check("A-1: リード枠の中身に穴になる箱(div)を挟んでいない / select は2つ",
            innerTags.filter((t) => t === "div").length === 0 && innerTags.filter((t) => t === "select").length === 2,
            innerTags.join(" "));
          check("A-1: 枠の padding は元のまま(タグを label に変えただけで外形は不変)",
            /padding: "2px 4px 2px 10px"/.test(pillTag), (pillTag.match(/padding: "[^"]*"/g) || []).join(" | "));
        }
        check("A-1: リード選択の <select> が当たり判定を取り戻している",
          selects.length >= 1 && selects.every((t) => /pointerEvents: "auto"/.test(t)),
          `${selects.length}個 / ` + selects.map((t) => t.slice(0, 60)).join(" | "));
      }
      // 【F-72 で形が変わった】奏者枠は「素の <select>」から「<label> + <select> + ▾」になった。
      // .tap-through(pointer-events:none)の中なので、**label と select の両方**が
      // 当たり判定を取り戻していないと、▾ の上や label の余白でタップが死ぬ。
      // 【F-72】計測タブが使うのは PerformerSelector の **bare の枝**(htmlFor={selectId})。
      // セッション詳細が使う既定の枝は .tap-through の外なので、この節の対象ではない。
      {
        const pAnchor = code20.indexOf("htmlFor={selectId}");
        const pStart = pAnchor === -1 ? -1 : code20.lastIndexOf("<label", pAnchor);
        const pTag = pStart === -1 ? "" : code20.slice(pStart, code20.indexOf(">", code20.indexOf("style=", pStart)) + 1);
        const pSel = pStart === -1 ? "" : (code20.slice(pStart).match(/<select[\s\S]*?\n\s*>/) || [""])[0];
        check("A-1: 奏者枠(label)を走査できている", pStart !== -1 && pTag !== "", pTag.slice(0, 120));
        check("A-1: 奏者枠(label)が当たり判定を取り戻している",
          /pointerEvents: "auto"/.test(pTag), pTag.replace(/\s+/g, " ").slice(0, 200));
        check("A-1: 奏者セレクタ(select)が当たり判定を取り戻している",
          /pointerEvents: "auto"/.test(pSel), pSel.replace(/\s+/g, " ").slice(0, 200));
        check("A-1: 奏者枠の中身に穴になる箱(div)を挟んでいない",
          pStart !== -1 && !/<div[\s>]/.test(code20.slice(pStart, code20.indexOf("</label>", pAnchor))), "");
      }
      // (d) index.css 側の規則。**入力欄の規則を2つ目として足していない**ことも見る
      //     (足すと「入力欄の規則は index.css に1つだけ」が壊れる)。
      // index.css をここで独立に読む(section 16 の道具はそのスコープの外からは見えない)。
      const cssSrc = readFileSync(new URL("../src/index.css", import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ");   // コメントを潰す(セレクタに混ざるため)
      const ttRules = [...cssSrc.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map((m) => ({ sels: m[1].split(",").map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean), body: m[2] }))
        .filter((r) => r.sels.some((x) => /(^|[\s.])tap-through\b/.test(x)));
      const declsOf = (body) => body.split(";").map((d) => d.trim()).filter(Boolean)
        .map((d) => ({ name: d.slice(0, d.indexOf(":")).trim(), value: d.slice(d.indexOf(":") + 1).trim() }));
      const ttBlock = ttRules.find((r) => r.sels.length === 1 && r.sels[0] === ".tap-through");
      const ttBtn = ttRules.find((r) => r.sels.length === 1 && r.sels[0] === ".tap-through button");
      check("A-1: .tap-through は pointer-events: none だけを持つ(地・枠・角丸・余白を持ち込まない)",
        !!ttBlock && declsOf(ttBlock.body).length === 1 && declsOf(ttBlock.body)[0].name === "pointer-events"
        && declsOf(ttBlock.body)[0].value === "none",
        ttBlock ? declsOf(ttBlock.body).map((d) => `${d.name}:${d.value}`).join(" ") : "規則が無い");
      check("A-1: .tap-through button は pointer-events: auto だけを持つ",
        !!ttBtn && declsOf(ttBtn.body).length === 1 && declsOf(ttBtn.body)[0].name === "pointer-events"
        && declsOf(ttBtn.body)[0].value === "auto",
        ttBtn ? declsOf(ttBtn.body).map((d) => `${d.name}:${d.value}`).join(" ") : "規則が無い");
      check("A-1: .tap-through の規則は2つだけ(なし崩しに対象を増やしていない)", ttRules.length === 2, `${ttRules.length}規則`);
      check("A-1: .tap-through の規則に input/select/textarea を書いていない(入力欄の規則を増やさない)",
        !ttRules.some((r) => r.sels.some((x) => /(input|select|textarea)\b/.test(x))),
        ttRules.flatMap((r) => r.sels).join(" | "));
    }
  }
  console.log("  -> done");
}

// ============================================================
// 検証21: F-66 平均差分(ピッチ)に「標準偏差」を併記する
// (N-2 表記統一 2026-08-10 本人決定: 表示は「ピッチ誤差」→「平均差分」、「ばらつき」→「標準偏差」)
//
// 主役の数字(pitchCentsSigned)は**符号付きの加重平均**なので、+5¢と−5¢を行き来していると
// 打ち消し合って0に近づく=「一度も合っていないのに0¢」が起こる(本人報告「肌感覚より過剰に
// 合っている」の正体)。この節はその状況を合成フレーム列で実際に作り、
// **主役が0.0¢でも副次テキストが「標準偏差 ±5.0¢」を返す**ことを実ソースで固定する。
//
// 関数・定数・指標定義はすべて実ソースから extractFunction / extractConst で取り出して
// 評価する(テスト側の手書き再実装は実ソースを守らない。F-45 の前例)。
// 期待値は「25msホップでどのtのフレームが残るか」をテスト側で独立に数えた値であって、
// 定数(PITCH_EDGE_TRIM_MS 等)の言い換えではない(F-51 の前例)。
// ============================================================
console.log("=== 検証21: F-66 平均差分(ピッチ)に標準偏差を併記 ===");
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
      extractFunction("formatSignedCents"),
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
    check("21.1 副次テキストは「標準偏差 ±5.0¢」(合っていないことが数字に出る)",
      callSub(api.pitchSpreadSub, m) === "標準偏差 ±5.0¢", `${callSub(api.pitchSpreadSub, m)}`);
    // (この列は全フレームがちょうど±5¢で、0¢のフレームは1つも無い。
    //  主役の +0.0 は「合っている」ではなく打ち消し合いの産物である、という状況そのもの)
  }

  // --- 21.2 標準偏差が出せないときは副次テキストごと出さない --------------------
  // stddev は arr.length < 2 で null を返す。採用フレームが1つしかないセッションで
  // 「標準偏差 ±null¢」「±NaN¢」を出さないこと。
  {
    // 2フレーム(dur=25ms)。トリム帯 t∈[0.00833,0.01667] にフレームが無いので
    // 「全滅させない」フォールバックでインデックス中央の1フレームだけが採用される。
    const frames = [pf(0, 10, 7), pf(0.025, 10, 9)];
    const m = api.computeFrameMetrics(frames);
    check("21.2 採用フレームが1つのとき 標準偏差は算出されない(stddevがnull)",
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
  // 表記は「標準偏差 ±5.3¢」で統一(F-46 → N-2 の表記統一と同じ方針)。桁は主役と揃えて小数1桁。
  {
    check("21.3 桁は主役と同じ小数1桁(5.34 → ±5.3)",
      callSub(api.pitchSpreadSub, { pitchStabilityCents: 5.34 }) === "標準偏差 ±5.3¢",
      `${callSub(api.pitchSpreadSub, { pitchStabilityCents: 5.34 })}`);
    // 端数は toFixed(1) の丸め(5.37→5.4 / 0.04→0.0)。5.35 のような二進で表せない中間値は
    // 処理系の丸めが "5.3" 側に落ちるので、丸め方向の検査には使わない。
    check("21.3 端数は1桁に丸める(5.37 → ±5.4 / 0.04 → ±0.0)",
      callSub(api.pitchSpreadSub, { pitchStabilityCents: 5.37 }) === "標準偏差 ±5.4¢" &&
      callSub(api.pitchSpreadSub, { pitchStabilityCents: 0.04 }) === "標準偏差 ±0.0¢");
    check("21.3 標準偏差0(全採用フレームが同じ値)は「±0.0¢」として出す(消さない)",
      callSub(api.pitchSpreadSub, { pitchStabilityCents: 0 }) === "標準偏差 ±0.0¢");
    // 主役(偏り)ではなく、標準偏差(ブレ幅)を読んでいること。
    // 両方入れた指標オブジェクトで、どちらを読んでいるかを判別する。
    check("21.3 読むのは pitchStabilityCents であって pitchCentsSigned ではない",
      callSub(api.pitchSpreadSub, { pitchCentsSigned: 9.9, pitchStabilityCents: 5.34 }) === "標準偏差 ±5.3¢");
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
      check(`21.4 ${name} の平均差分(ピッチ)は副次テキストの導出(sub)を持つ`,
        typeof pitch?.sub === "function");
      check(`21.4 ${name} の sub は指標オブジェクトから「標準偏差 ±5.3¢」を返す`,
        callSub(sub, fixture) === "標準偏差 ±5.3¢", `${callSub(sub, fixture)}`);
      check(`21.4 ${name} の sub は共通の pitchSpreadSub と同じ結果を返す(写しではない)`,
        callSub(sub, fixture) === callSub(api.pitchSpreadSub, fixture) &&
        callSub(sub, {}) === callSub(api.pitchSpreadSub, {}));
      // 標準偏差は平均差分(ピッチ)だけの話。音量・HNR・重心に副次テキストは付かない
      for (const other of arr.filter((x) => x.key !== "pitchCentsSigned")) {
        check(`21.4 ${name} の ${other.key} には sub が無い(標準偏差は平均差分だけ)`,
          other.sub === undefined);
      }
    }
    // 「4箇所にコピペしない」を綴りで縛る。表示文言の組み立ては動く側に1回しか現れない
    // (**「無いこと」ではなく「1回だけ」を見る検査なので codeOf() で経緯コメントを外す**)。
    const liveSrc = codeOf(src);
    check("21.4 副次テキストの文言の組み立ては動く側のソースに1箇所だけ",
      (liveSrc.match(/標準偏差/g) || []).length === 1,
      `${(liveSrc.match(/標準偏差/g) || []).length}箇所`);
    check("21.4 表記は「標準偏差」で統一(「安定度」「ばらつき」を混ぜない)",
      !liveSrc.includes("安定度") && !liveSrc.includes("ばらつき"));
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
    // 【N-6 で2つ減った】データタブの指標行は正典 .mrow に合わせて **HNR / 重心 / 音量の3列**に
    // なり、平均差分の列を持たない(同じ量がヒーローの主役の数字として出ているため)。
    // 標準偏差を添える指標は平均差分だけなので、データタブ側に sub の受け手はもう居ない。
    // **代わりに「その3列に平均差分が混ざっていないこと」を下の 21.5b で固定する。**
    const wiring = [
      ["SessionDetailView（個別セッション）", "SessionDetailView", /sub=\{mt\.sub\?\.\(sessionMetrics\) \?\? null\}/],
      ["ReedEvaluationDetail（登録済みリードの測定データ）", "ReedEvaluationDetail", /sub=\{m\.sub\?\.\(overall\) \?\? null\}/],
    ];
    for (const [label, fn, re] of wiring) {
      check(`21.5 ${label} は指標定義の sub をカードに渡している`, re.test(componentSourceOf(fn)));
    }
    // 21.5b データタブの指標行に平均差分(標準偏差を連れてくる唯一の指標)が入っていないこと。
    // ここが破れると、ヒーローと同じ数字が真下に重複し、標準偏差の出どころも2つになる。
    {
      const rowKeys = new Function(`${extractConst("MY_DATA_ROW_METRICS")} return MY_DATA_ROW_METRICS;`)();
      check("21.5b データタブの指標行は HNR / 重心 / 音量 の3列(正典 .mrow)",
        JSON.stringify(rowKeys) === JSON.stringify(["hnrDb", "spectralCentroidHz", "volumeDb"]),
        rowKeys.join(","));
      check("21.5b データタブの指標行に平均差分(pitchCentsSigned)を入れない(ヒーローと重複させない)",
        !rowKeys.includes("pitchCentsSigned"), rowKeys.join(","));
    }
    // ヒーローは TappableMetricCard ではないので個別に見る。主役の大きい数字と**同じ母集団**
    // から出していること(今日を出しているのに対象期間の標準偏差を添えると読み違える)。
    // 【N-6】正典 .hero .sd は語を持たない「±3.4¢」なので bare で形だけ選ぶ。**導出は1つのまま**。
    const myDataSection = componentSourceOf("MyDataSection");
    // 【N-6】`{ bare: true }` を**任意にしない**。任意にすると、`bare` を足した唯一の理由
    // (正典 .hero .sd は「標準偏差」の語を持たない)を何も固定しないことになり、
    // 語つきに戻す変異が生き残る(審査役が実証: 削除しても PASS 6003 / FAIL 0)。
    // 母集団の一致と表記の形は**別の主張**なので、検査も2本に分ける。
    // 【N-8 書き換え】綴りが todayVal/todayMetrics → dayVal/dayMetrics(今日または直近の記録日)。
    check("21.5 ヒーローの標準偏差は主役の数字と同じ母集団から出す",
      /const heroSpread = pitchSpreadSub\(dayVal != null \? dayMetrics : overall/.test(myDataSection));
    check("21.5 ヒーローの標準偏差は語を持たない形で出す(正典 .hero .sd は「±3.4¢」)",
      /const heroSpread = pitchSpreadSub\([^;]*, \{ bare: true \}\);/.test(myDataSection),
      (myDataSection.match(/const heroSpread = [^\n;]+/) || ["見つからない"])[0]);
    // 【N-6】表示の形は2つ(語つき/語なし)だが、**数の作り方は1つ**であること。
    // pitchSpreadSub を実ソースから取り出して両方の形を評価し、数字の部分が一致するかで見る
    // (別の式を書き足して桁や丸めがずれたら落ちる)。
    {
      const ps = new Function(`${extractFunction("pitchSpreadSub")} return pitchSpreadSub;`)();
      const m = { pitchStabilityCents: 3.44 };
      check("21.5 標準偏差の語なし表示は語つき表示と同じ数字(導出を2つ作っていない)",
        ps(m, { bare: true }) === "±3.4¢" && ps(m) === `標準偏差 ${ps(m, { bare: true })}`,
        `${ps(m)} / ${ps(m, { bare: true })}`);
      check("21.5 欠測はどちらの形でも null(「±null¢」を出さない)",
        ps({ pitchStabilityCents: null }, { bare: true }) === null && ps({}) === null);
    }
    check("21.5 ヒーローは heroSpread があるときだけ副次行を出す",
      /\{heroSpread && <span>\{heroSpread\}<\/span>\}/.test(myDataSection));
    check("21.5 ヒーローの副次行の色は既存の副次色(#9DB3D6)のまま(新しい色を作らない)",
      /\{\(heroSpread \|\| \(dayVal != null && periodVal != null\)\) && \([\s\S]{0,200}?color: "#9DB3D6"/.test(myDataSection));
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
// ============================================================
// 検証22: F-54〜F-60(データタブ)
//   F-54 音名を実音(コンサートピッチ)に統一。ラベルは運指(semitoneIndex)から導く
//   F-55 メモ欄の左端を日付・奏者と揃える
//   F-56 My Data のヒーローの評価を「0からの距離だけ」の3段(Great/Good/Keep Trying)に
//   F-57 PIVOTのフィルターの × をカテゴリ名の先頭へ
//   F-58 セッション一覧のゴミ箱の枠をリードタブの削除ボタンと同じ寸法に
//   F-59 PIVOTの選択軸・集計条件をタブ移動をまたいで保持
//   F-60 実音に変えても並び順は運指(高い音が上)のまま
//
// F-54/F-56 は**実ソースを extractFunction / 実ソース文字列の評価**で検証する
// (テスト側に手書きの再実装を置くと実ソースを守らない。F-45の審査で不合格になった前例)。
// F-55/F-57/F-58/F-59 の配線はJSXなのでハーネスから評価できず、**ソース文字列の検査**に
// とどまる(このハーネスがJSXを見ていないことの帰結。冒頭の規約どおり報告でも区別する)。
// ============================================================
console.log("=== 検証22: F-54 音名を実音へ / F-56 3段評価 / F-57〜F-60 ===");
{
  const componentSourceOf = (name) => {
    const idx = src.indexOf(`function ${name}(`);
    if (idx === -1) throw new Error(`function ${name} not found`);
    let i = src.indexOf("{", src.indexOf(")", idx));
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(idx, i + 1); }
    }
    throw new Error(`function ${name}: unbalanced braces`);
  };

  // --- サンドボックス(19節と同じ方式。変異は複製した文字列にだけ当てる) ---------
  const buildNoteApi = (edits = []) => {
    let pieces = [
      extractConst("NOTE_NAMES"),
      extractConst("NOTE_NAMES_SHARP"),
      extractConst("LOW_BB_WRITTEN_MIDI"),
      extractConst("TRANSPOSITION_SEMITONES"),
      extractConst("A4_MIDI"),
      extractConst("SAX_CONCERT_RANGE"),
      extractFunction("freqToNote"),
      extractFunction("writtenNoteLabel"),
      extractFunction("writtenMidiToSoundingFreq"),
      extractFunction("concertMidiToFreq"),
      extractFunction("concertFreqLabel"),
      extractFunction("buildFingeringTable"),
      extractConst("CONCERT_LABEL_CACHE"),
      extractFunction("concertNoteTableOf"),
      extractFunction("concertNoteLabelOf"),
      extractFunction("concertNoteFreqOf"),
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
      extractFunction("groupFramesByNoteAcrossSessions"),
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
      return { concertNoteLabelOf, concertNoteFreqOf, writtenNoteLabel, buildFingeringTable, freqToNote,
               groupFramesByNote, buildFramesWithContext, buildPivot,
               PIVOT_DIMENSIONS, SAX_CONCERT_RANGE, NOTE_NAMES };`)();
  };
  const nApi = buildNoteApi();
  const TUNE = 442;

  // 実音MIDI → 音名ラベル。**運指テーブルもconcertFreqLabelも通さない独立計算**。
  // 「i番目の運指の実音MIDIは SAX_CONCERT_RANGE[sax].lowMidi + i」という要件
  // (App.jsx の SAX_CONCERT_RANGE のコメント「音域の左端は運指テーブルの最低音の実音と一致」)
  // だけを使う。実装が周波数経由でどう出そうと、結果はこの表と一致しなければならない。
  const midiLabel = (midi) => nApi.NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

  // --- 21.1 アルトの音名は実音(D♭3〜A5)になり、記音(B♭3〜F♯6)ではない -------------
  {
    const r = nApi.SAX_CONCERT_RANGE.alto;
    const labels = [];
    let allMatch = true;
    for (let i = 0; i <= r.highMidi - r.lowMidi; i++) {
      const got = nApi.concertNoteLabelOf(i, "alto", TUNE);
      const want = midiLabel(r.lowMidi + i);
      labels.push(got);
      if (got !== want) allMatch = false;
    }
    check("21.1 アルトの全運指(33音)の音名が実音の期待値(lowMidi+i)と一致する",
      allMatch && labels.length === 33, `${labels[0]}…${labels[labels.length - 1]}`);
    // 本人報告の症状そのもの: 最低音がB♭3(記音)・最高音がF♯6(記音)になっていた
    check("21.1 最低音は実音のD♭3(=C♯3)。記音のB♭3ではない",
      labels[0] === midiLabel(49) && labels[0] !== nApi.writtenNoteLabel(0),
      `low=${labels[0]} written=${nApi.writtenNoteLabel(0)}`);
    check("21.1 最高音は実音のA5。記音のF♯6ではない",
      labels[32] === "A5" && labels[32] !== nApi.writtenNoteLabel(32),
      `high=${labels[32]} written=${nApi.writtenNoteLabel(32)}`);
    check("21.1 F6 / F♯6 のような音域外(記音)のラベルが1つも現れない",
      !labels.includes("F6") && !labels.includes("F♯6"), labels.join(","));
    // 運指の外(範囲外・不明な楽器・基準ピッチ無し)はnullを返し、呼び出し側のフォールバックに任せる
    check("21.1 semitoneIndex が null / 範囲外 / 楽器不明ならnull(フォールバックは呼び出し側)",
      nApi.concertNoteLabelOf(null, "alto", TUNE) === null &&
      nApi.concertNoteLabelOf(99, "alto", TUNE) === null &&
      nApi.concertNoteLabelOf(0, "unknown", TUNE) === null &&
      nApi.concertNoteLabelOf(0, "alto", null) === null);
  }

  // --- 21.2 楽器種別ごとに実音が変わる(同じ運指でも別の音名) ----------------------
  {
    let ok = true;
    for (const sax of ["soprano", "alto", "tenor", "baritone"]) {
      const r = nApi.SAX_CONCERT_RANGE[sax];
      for (let i = 0; i <= r.highMidi - r.lowMidi; i++) {
        if (nApi.concertNoteLabelOf(i, sax, TUNE) !== midiLabel(r.lowMidi + i)) ok = false;
      }
    }
    check("21.2 4機種すべてで実音ラベルが各機種の音域(lowMidi+i)と一致する", ok);
    // メモ化が楽器種別ごとに分かれていること(1つのテーブルを使い回すと全機種同じ音名になる)
    const pairs = [[10, "alto", "tenor"], [32, "alto", "tenor"], [0, "soprano", "baritone"]];
    check("21.2 同じ semitoneIndex でも楽器種別が違えば別の音名になる(メモ化が種別で分かれている)",
      pairs.every(([i, a, b]) => nApi.concertNoteLabelOf(i, a, TUNE) !== nApi.concertNoteLabelOf(i, b, TUNE)),
      pairs.map(([i, a, b]) => `si${i}:${nApi.concertNoteLabelOf(i, a, TUNE)}/${nApi.concertNoteLabelOf(i, b, TUNE)}`).join(" "));
  }

  // --- 合成データ(21.3以降で共用) ------------------------------------------------
  // 同じ運指(si=10)なのに**実測の音名(concertNote)が隣に振れている**列を作る。
  // ラベルを実測から取ると同じ運指が複数行に割れる。運指から導けば1行のまま。
  const HOP = 0.025;
  const mkFrame = (t, si, sax, concertNote, written) => ({
    t, semitoneIndex: si, pitchHz: 440, pitchCents: 1, concertNote, matchedWrittenNote: written,
    clarity: 1, volumeDb: -20, noteAgeMs: 1000, hnrDb: 20, spectralCentroidHz: 1000, harmonics: [],
  });
  const ALTO_SI10 = nApi.concertNoteLabelOf(10, "alto", TUNE);   // 実音
  const TENOR_SI10 = nApi.concertNoteLabelOf(10, "tenor", TUNE); // 実音(アルトとは別)
  const WRITTEN_SI10 = nApi.writtenNoteLabel(10);                // 記音(旧表示)
  const NEIGHBOR = "C4"; // 実測が隣に振れたときの誤ラベル(運指とは無関係の値)
  const wobbly = (sax) => Array.from({ length: 24 }, (_, k) =>
    mkFrame(k * HOP, 10, sax, k % 2 === 0 ? NEIGHBOR : nApi.concertNoteLabelOf(10, sax, TUNE), WRITTEN_SI10));
  const altoSession = { frames: wobbly("alto"), reedId: null, recordedAt: "2026-08-08T01:00:00.000Z", performer: "自分", saxType: "alto", source: "recording", memo: "" };
  const tenorSession = { frames: wobbly("tenor"), reedId: null, recordedAt: "2026-08-08T00:00:00.000Z", performer: "自分", saxType: "tenor", source: "recording", memo: "" };
  const ctx = { reeds: [], tuningHz: TUNE };

  // --- 21.3 ラベルは運指から導く(実測のconcertNoteに引きずられない) ---------------
  {
    const groups = nApi.groupFramesByNote(altoSession.frames, 8, "alto", TUNE);
    check("21.3 実測の音名が隣に振れていても、音階ごとの平均は1行のまま",
      groups.length === 1, `groups=${groups.length}`);
    check("21.3 音階ごとの平均のラベルは運指から導いた実音(実測の誤ラベルでも記音でもない)",
      groups[0].concertLabel === ALTO_SI10 && groups[0].concertLabel !== NEIGHBOR &&
      groups[0].concertLabel !== WRITTEN_SI10,
      `label=${groups[0].concertLabel} expect=${ALTO_SI10}`);
    // 記音は「消した」のではなく別フィールドとして残す(理想値プロファイルの旧表記変換が読む)
    check("21.3 記音は writtenLabel として残り、表示用の concertLabel と混ざっていない",
      groups[0].writtenLabel === WRITTEN_SI10 && groups[0].writtenLabel !== groups[0].concertLabel);

    const fwc = nApi.buildFramesWithContext([altoSession, tenorSession], []);
    const pivot = nApi.buildPivot(fwc, ctx, "note", "none", "volume", []);
    check("21.3 PIVOTの音名次元も1機種につき1行(実測の誤ラベルで行が割れない)",
      pivot.rowKeys.length === 2 && !pivot.rowKeys.includes(NEIGHBOR), `rowKeys=${pivot.rowKeys.join(",")}`);
    check("21.3 PIVOTはアルトとテナーを**それぞれの実音**で別の行にする(記音だと同じ行に潰れる)",
      pivot.rowKeys.includes(ALTO_SI10) && pivot.rowKeys.includes(TENOR_SI10) &&
      !pivot.rowKeys.includes(WRITTEN_SI10),
      `rowKeys=${pivot.rowKeys.join(",")} written=${WRITTEN_SI10}`);
  }

  // --- 21.4 PIVOTと音階ごとの平均が同じ音名を出す(画面によって食い違わない) --------
  {
    const fwc = nApi.buildFramesWithContext([altoSession], []);
    const pivot = nApi.buildPivot(fwc, ctx, "note", "none", "volume", []);
    const groups = nApi.groupFramesByNote(altoSession.frames, 8, "alto", TUNE);
    check("21.4 PIVOTの行ラベルと音階ごとの平均のラベルが一致する",
      pivot.rowKeys.length === 1 && pivot.rowKeys[0] === groups[0].concertLabel,
      `pivot=${pivot.rowKeys.join(",")} group=${groups[0].concertLabel}`);
    // 音名軸グラフ(NoteAxisLineChart)の横軸と同じ導出であること。グラフ側は
    // concertFreqLabel(buildFingeringTable(...)[i].soundingFreqHz, tuningHz) で作る。
    const axis = nApi.buildFingeringTable("alto", TUNE).map((e) => nApi.freqToNote(e.soundingFreqHz, TUNE));
    check("21.4 音名軸グラフの横軸ラベルと同じ音名になる(同じ運指テーブル・同じ基準ピッチ)",
      `${axis[10].name}${axis[10].octave}` === groups[0].concertLabel,
      `axis=${axis[10].name}${axis[10].octave} group=${groups[0].concertLabel}`);
  }

  // --- 21.5 旧データのフォールバック(記音を完全には消さない) ----------------------
  {
    // (a) saxType/tuningHz が取れない呼び出し → 実測concertNote → 記音 の順に落ちる
    const noSax = nApi.groupFramesByNote(altoSession.frames, 8);
    check("21.5 運指から引けないときは実測のconcertNoteにフォールバックする",
      noSax[0].concertLabel === NEIGHBOR, `label=${noSax[0].concertLabel}`);
    const onlyWritten = Array.from({ length: 24 }, (_, k) => mkFrame(k * HOP, 10, "alto", null, WRITTEN_SI10));
    const g2 = nApi.groupFramesByNote(onlyWritten, 8);
    check("21.5 concertNoteも無い最古のデータでは記音が最後の手段として残る",
      g2[0].concertLabel === WRITTEN_SI10, `label=${g2[0].concertLabel}`);
    // (b) PIVOT: semitoneIndex が無いフレーム(運指未判定の旧データ)
    const legacy = {
      frames: Array.from({ length: 24 }, (_, k) => ({ ...mkFrame(k * HOP, null, "alto", null, WRITTEN_SI10) })),
      reedId: null, recordedAt: "2026-08-08T00:00:00.000Z", performer: "自分", saxType: "alto", source: "recording", memo: "",
    };
    const pv = nApi.buildPivot(nApi.buildFramesWithContext([legacy], []), ctx, "note", "none", "volume", []);
    check("21.5 PIVOTでも semitoneIndex 無しの旧データは記音のラベルで拾える",
      pv.rowKeys.length === 1 && pv.rowKeys[0] === WRITTEN_SI10, `rowKeys=${pv.rowKeys.join(",")}`);
  }

  // --- 21.6 F-60 並び順は運指のまま(高い音が上) ----------------------------------
  {
    const multi = [
      ...Array.from({ length: 24 }, (_, k) => mkFrame(k * HOP, 0, "alto", null, nApi.writtenNoteLabel(0))),
      ...Array.from({ length: 24 }, (_, k) => mkFrame(1.0 + k * HOP, 20, "alto", null, nApi.writtenNoteLabel(20))),
      ...Array.from({ length: 24 }, (_, k) => mkFrame(2.0 + k * HOP, 32, "alto", null, nApi.writtenNoteLabel(32))),
    ];
    const groups = nApi.groupFramesByNote(multi, 8, "alto", TUNE);
    check("21.6 音階ごとの平均は運指の降順(高い音が上)のまま",
      groups.map((g) => g.semitoneIndex).join(",") === "32,20,0", groups.map((g) => g.semitoneIndex).join(","));
    check("21.6 実音のラベルに変えても、並びは運指の順(A5 → A4 → C♯3)",
      groups.map((g) => g.concertLabel).join(",") ===
      [32, 20, 0].map((i) => nApi.concertNoteLabelOf(i, "alto", TUNE)).join(","),
      groups.map((g) => g.concertLabel).join(","));
    const sess = { frames: multi, reedId: null, recordedAt: "2026-08-08T00:00:00.000Z", performer: "自分", saxType: "alto", source: "recording", memo: "" };
    const pv = nApi.buildPivot(nApi.buildFramesWithContext([sess], []), ctx, "note", "none", "volume", []);
    check("21.6 PIVOTの行順も高い音が上(単一楽器)",
      pv.rowKeys.join(",") === [32, 20, 0].map((i) => nApi.concertNoteLabelOf(i, "alto", TUNE)).join(","),
      pv.rowKeys.join(","));

    // 【F-60 の差し戻しで追加】**複数の楽器種別を混ぜたときこそ本番**。
    // 検証役の実測で、運指(semitoneIndex)で並べていたために実音の高さが4箇所逆転していた
    // (アルト si=32 は A5=880Hz、テナー si=32 は E5=659Hz。運指が同じでも実音は違う)。
    // ここは「1つの楽器だけ流す」検査では絶対に捕まらない。混在を必ず流すこと。
    {
      // 楽器種別は**フレームではなくセッション**が持つ(buildFramesWithContext が s.saxType を
      // 各フレームへ配る)。
      //
      // 【データの選び方がこの検査の生命線】運指順と実音順が**食い違う**組み合わせを選ぶこと。
      // 同じ運指番号を2つの楽器で吹かせるだけでは、運指で並べても実音で並べても同じ順序になり、
      // 検査が何も守らない(統括が最初にこれをやり、変異を当てても緑のまま通った)。
      // 使う組み合わせ(検証役が実機で見つけた逆転そのもの):
      //   アルト si=32 → A5(880Hz) / アルト si=28 → F5(698Hz) / テナー si=32 → E5(659Hz)
      //   実音の高さ順 : A5 > F5 > E5
      //   運指の降順   : si32(A5) → si32(E5) → si28(F5)   ← F5 と E5 が逆転する
      const framesAlto = [
        ...Array.from({ length: 12 }, (_, k) => mkFrame(k * HOP, 32, "alto", null, nApi.writtenNoteLabel(32))),
        ...Array.from({ length: 12 }, (_, k) => mkFrame(2.0 + k * HOP, 28, "alto", null, nApi.writtenNoteLabel(28))),
      ];
      const framesTenor = Array.from({ length: 12 }, (_, k) => mkFrame(k * HOP, 32, "tenor", null, nApi.writtenNoteLabel(32)));
      const sA = { frames: framesAlto, reedId: null, recordedAt: "2026-08-08T00:00:00.000Z", performer: "自分", saxType: "alto", source: "recording", memo: "" };
      const sT = { frames: framesTenor, reedId: null, recordedAt: "2026-08-08T01:00:00.000Z", performer: "自分", saxType: "tenor", source: "recording", memo: "" };
      const pvMix = nApi.buildPivot(nApi.buildFramesWithContext([sA, sT], []), ctx, "note", "none", "volume", []);
      // 期待順はテスト側で独立に組む: 4つの (運指, 楽器) の実音Hzを降順に並べたラベル列
      const USED = [[32, "alto"], [28, "alto"], [32, "tenor"]];
      const expect = USED
        .map(([i, sx]) => ({ label: nApi.concertNoteLabelOf(i, sx, TUNE), hz: nApi.concertNoteFreqOf(i, sx, TUNE) }))
        .sort((a, b) => b.hz - a.hz)
        .map((e) => e.label);
      // このデータで運指順と実音順が本当に違うことを、検査自身が先に確かめる
      // (同じ順序になるデータを選ぶと、以下の主張は何も守らなくなるため)
      const byFingering = USED.slice().sort((a, b) => -a[0] - -b[0]).map(([i, sx]) => nApi.concertNoteLabelOf(i, sx, TUNE));
      check("21.6 (前提) 選んだデータは運指順と実音順が食い違う=この検査が意味を持つ",
        byFingering.join(",") !== expect.join(","), `運指順 ${byFingering.join(",")} / 実音順 ${expect.join(",")}`);
      check("21.6 PIVOTの行順は**楽器が混ざっても**実音の高さの降順(運指の順ではない)",
        pvMix.rowKeys.join(",") === expect.join(","), `実測 ${pvMix.rowKeys.join(",")} / 期待 ${expect.join(",")}`);
      // 逆転が1つも無いことを、ラベルではなく実音Hzで直接主張する(ラベルの綴りに依らない)
      const hzSeq = pvMix.rowKeys.map((lbl) => {
        for (const [i, sx] of USED) {
          if (nApi.concertNoteLabelOf(i, sx, TUNE) === lbl) return nApi.concertNoteFreqOf(i, sx, TUNE);
        }
        return null;
      });
      check("21.6 混在時の行順に音の高さの逆転が1つも無い",
        hzSeq.every((v, i) => i === 0 || (v !== null && hzSeq[i - 1] !== null && hzSeq[i - 1] >= v)),
        hzSeq.map((v) => (v === null ? "?" : v.toFixed(1))).join(" > "));
    }
  }

  // --- 21.7 変異試験(変異は複製した文字列にだけ当てる。実ツリーには触れない) --------
  {
    // (a) ラベルを記音に戻す変異 → 21.1 が落ちる
    const mutWritten = buildNoteApi([
      // F-60 の修正で labels は table 変数から作るようになった(freqs と同じ土台から出すため)。
      ["labels: table.map((e) => concertFreqLabel(e.soundingFreqHz, tuningHz)),",
        "labels: table.map((e) => e.writtenLabel), // MUTATION"],
    ]);
    check("21.7x 変異(ラベルを記音に戻す)では最低音がB♭3・最高音がF♯6になり21.1が落ちる",
      mutWritten.concertNoteLabelOf(0, "alto", TUNE) === "B♭3" &&
      mutWritten.concertNoteLabelOf(32, "alto", TUNE) === "F♯6",
      `${mutWritten.concertNoteLabelOf(0, "alto", TUNE)}…${mutWritten.concertNoteLabelOf(32, "alto", TUNE)}`);

    // (b) PIVOTの音名次元を記音(matchedWrittenNote)に戻す変異 → 21.3 が落ちる
    // (置換は1行に閉じる。App.jsx は CRLF なので複数行にまたがる needle は空振りする)
    const mutPivot = buildNoteApi([
      ["concertNoteLabelOf(f.semitoneIndex, f.saxType, ctx?.tuningHz)",
        "(f.matchedWrittenNote ?? null) /* MUTATION: F-54以前(記音)に戻す */"],
    ]);
    const pvMut = mutPivot.buildPivot(mutPivot.buildFramesWithContext([altoSession, tenorSession], []), ctx, "note", "none", "volume", []);
    check("21.7x 変異(PIVOTを記音に戻す)ではアルトとテナーが同じ記音の1行に潰れ21.3が落ちる",
      pvMut.rowKeys.length === 1 && pvMut.rowKeys[0] === WRITTEN_SI10, `rowKeys=${pvMut.rowKeys.join(",")}`);

    // (c) フレームごとの楽器種別を使わず固定にする変異 → テナーがアルトの音名になる
    const mutSax = buildNoteApi([
      ["concertNoteLabelOf(f.semitoneIndex, f.saxType, ctx?.tuningHz)",
        'concertNoteLabelOf(f.semitoneIndex, "alto", ctx?.tuningHz) /* MUTATION */'],
    ]);
    const pvSax = mutSax.buildPivot(mutSax.buildFramesWithContext([altoSession, tenorSession], []), ctx, "note", "none", "volume", []);
    check("21.7x 変異(楽器種別をaltoに固定)ではテナーの行がアルトの音名に化けて21.3が落ちる",
      pvSax.rowKeys.length === 1 && pvSax.rowKeys[0] === ALTO_SI10 && !pvSax.rowKeys.includes(TENOR_SI10),
      `rowKeys=${pvSax.rowKeys.join(",")}`);

    // (d) 運指より実測のconcertNoteを優先する変異 → 行が割れる / ラベルが誤ラベルになる
    const mutMeasured = buildNoteApi([
      ["concertLabel: concertNoteLabelOf(semitoneIndex, saxType, tuningHz)",
        "concertLabel: (groupFrames.find((f) => f.concertNote)?.concertNote ?? null) /* MUTATION: 実測優先 */"],
    ]);
    const gMut = mutMeasured.groupFramesByNote(altoSession.frames, 8, "alto", TUNE);
    check("21.7x 変異(実測のconcertNoteを優先)では音階ごとの平均のラベルが誤ラベルになり21.3が落ちる",
      gMut[0].concertLabel === NEIGHBOR, `label=${gMut[0].concertLabel}`);
  }

  // --- 21.8 F-56 ヒーローの3段評価(実ソースの判定コードをそのまま評価する) ---------
  // 【N-8 書き換え】評価の対象は「今日または直近の記録日」の値になり、綴りが
  // todayErr/todayVal → dayErr/dayVal に変わった。判定(0からの距離・3段・色)は同一。
  {
    const myData = componentSourceOf("MyDataSection");
    const from = myData.indexOf("const dayErr =");
    const to = myData.indexOf("const displayVal");
    if (from === -1 || to === -1 || to <= from) throw new Error("F-56: ヒーローの判定ブロックを切り出せない");
    const decideSrc = myData.slice(from, to);
    const decide = (dayVal) => new Function("dayVal", `${decideSrc}\nreturn { heroColor, heroStatus };`)(dayVal);
    const st = (v) => decide(v).heroStatus;
    check("21.8 |値| ≤ 2 は Great (0 / +2 / -2 の3点)",
      st(0) === "Great" && st(2) === "Great" && st(-2) === "Great",
      `${st(0)}/${st(2)}/${st(-2)}`);
    check("21.8 2を超え4以下は Good (+2.0001 / -3 / +4 / -4)",
      st(2.0001) === "Good" && st(-3) === "Good" && st(4) === "Good" && st(-4) === "Good",
      `${st(2.0001)}/${st(-3)}/${st(4)}/${st(-4)}`);
    // 【統括の判断】本人の指示は「±4以内でGood」「±6以上でKeep Trying」で4〜6が未定義。
    // 境界を空けない方を採り、**4超はすべて Keep Trying**。5(=未定義帯)もここで固定する。
    check("21.8 4を超えたら Keep Trying (+4.0001 / ±5(指示の未定義帯) / ±6 / ±50)",
      st(4.0001) === "Keep Trying" && st(5) === "Keep Trying" && st(-5) === "Keep Trying" &&
      st(6) === "Keep Trying" && st(-6) === "Keep Trying" && st(50) === "Keep Trying",
      `${st(4.0001)}/${st(5)}/${st(-5)}/${st(6)}`);
    check("21.8 値が無いときは評価そのものを出さない", st(null) === null && decide(null).heroColor === "#FFFFFF");
    check("21.8 判定は「0からの距離」だけ。符号が違っても同じ評価になる",
      [0.5, 2, 3, 4, 7, 30].every((v) => st(v) === st(-v)));
    check("21.8 3段はそれぞれ違う色。旧4段の色(平均より悪化=#F87171)は使われない",
      new Set([decide(0).heroColor, decide(3).heroColor, decide(9).heroColor]).size === 3 &&
      ![decide(0).heroColor, decide(3).heroColor, decide(9).heroColor].includes("#F87171"),
      [decide(0).heroColor, decide(3).heroColor, decide(9).heroColor].join(","));
    check("21.8 旧4段の文言(ほぼ完璧/平均より改善/平均より悪化/平均並み)が動く側に残っていない",
      ["ほぼ完璧", "平均より改善", "平均より悪化", "平均並み"].every((t) => !codeOf(src).includes(t)));
    // 変異試験: 閾値を動かすと上の主張が落ちる(閾値そのものを固定できている)
    {
      const mutSrc = decideSrc.replace("dayErr <= 2", "dayErr <= 3");
      if (mutSrc === decideSrc) throw new Error("F-56 変異が空振り");
      const mutSt = (v) => new Function("dayVal", `${mutSrc}\nreturn { heroColor, heroStatus };`)(v).heroStatus;
      check("21.8x 変異(Greatの閾値を2→3)では +2.0001 が Good ではなく Great になり21.8が落ちる",
        mutSt(2.0001) === "Great", mutSt(2.0001));
    }
  }

  // --- 21.9 F-55/F-57/F-58/F-59 の配線(JSXなので**ソース文字列の検査**にとどまる) ---
  {
    const detail = componentSourceOf("SessionDetailView");
    const lab = componentSourceOf("AnalysisLabView");
    const root = componentSourceOf("WindToneLabPhaseMode");

    // F-54(配線): 実音ラベルは「呼び出し元が saxType/tuningHz を渡し、表示が concertLabel を
    // 読む」ところまで通っていて初めて画面に出る。ここが切れても集計側の検算(21.1〜21.6)は
    // 全部通ってしまう(複製ツリーでの変異試験で実際に素通りした)ので、配線を綴りで固定する。
    check("F-54: セッション詳細は groupFramesByNote に楽器種別と基準ピッチを渡す",
      /groupFramesByNote\(frames, NUM_HARMONICS, session\.saxType, tuningHz\)/.test(detail));
    check("F-54: 音階ごとの平均の表は実音(concertLabel)を表示する",
      /\{g\.concertLabel \?\? "—"\}/.test(detail));
    check("F-54: 音階ごとの平均の表に記音(writtenLabel)を表示していない",
      !/g\.writtenLabel/.test(codeOf(detail)));
    check("F-54: 音階ごとの平均の表の見出しは「実音」(「記音」のままにしない)",
      />実音<\/th>/.test(detail) && !/>記音<\/th>/.test(codeOf(src)));
    // 【F-68で配線が変わった】理想値の生成は buildIdealProfileFromSessions(複数セッション対応)に
    // 一本化され、単一セッション版はその特別な場合になった。**渡すもの(楽器種別・基準ピッチ)は
    // 変わっていない**ので、検査の意図(この経路にも saxType と tuningHz が通っていること)は同じ。
    check("F-54: 理想値プロファイル生成も楽器種別と基準ピッチを渡す",
      /groupFramesByNoteAcrossSessions\(\s*list\.map\(\(s\) => s\.frames \|\| \[\]\), NUM_HARMONICS, list\[0\]\?\.saxType \?\? null, tuningHz\)/.test(src) &&
      /buildIdealProfileFromSessions\(targets, trimmedName, NUM_HARMONICS, effectiveTuningHz, scope\)/.test(src) &&
      /return buildIdealProfileFromSessions\(\[session\], name, NUM_HARMONICS, tuningHz, "session"\);/.test(src));
    check("F-54: 音名軸グラフ(NoteAxisLineChart)も同じ楽器種別・基準ピッチで集計する",
      /groupFramesByNote\(s\.frames \|\| \[\], undefined, saxType, tuningHz\)/.test(src));
    check("F-54: PIVOTのctxに基準ピッチを載せる(音名次元が実音を導けない)",
      /const pivotCtx = \{ reeds, tuningHz \};/.test(lab));

    // F-55: メモ行のラベルと入力欄の間隔を日付・奏者と同じ4pxにし、ラベルの文字部分を
    // 全角2文字ぶん(2em)確保する。日付・奏者側の gap は変えない(両方4pxのまま)。
    const memoAt = detail.indexOf("【F-55】");
    const memoRow = memoAt === -1 ? "" : detail.slice(memoAt, memoAt + 1400);
    check("F-55: メモ行のラベルと入力欄の間隔は日付・奏者と同じ4px",
      /marginTop: 8, display: "flex", alignItems: "center", gap: 4 \}\}>\s*<span style=\{\{ color: "#435266", flexShrink: 0 \}\}>/.test(memoRow),
      memoRow.replace(/\s+/g, " ").slice(-260));
    check("F-55: メモのラベルの文字部分は全角2文字ぶん(2em)を確保する(片仮名が詰まる書体でもずれない)",
      /<span style=\{\{ display: "inline-block", minWidth: "2em" \}\}>メモ<\/span>:/.test(memoRow));
    check("F-55: 日付・奏者側の間隔(gap: 4)は動かしていない",
      (detail.match(/display: "flex", alignItems: "center", gap: 4, minWidth: 0/) || []).length === 1 &&
      (detail.match(/display: "flex", alignItems: "center", gap: 4, flexShrink: 0/g) || []).length === 2);

    // F-57: フィルター行で × がカテゴリ名(次元のselect)より**前**にある
    {
      const rowStart = lab.indexOf("pivotFilters.map((flt, i)");
      const del = lab.indexOf('title="このフィルターを削除"', rowStart);
      const dimSelect = lab.indexOf("value={flt.dimKey}", rowStart);
      check("F-57: 条件削除の × はカテゴリ名(次元のselect)より前に置かれている",
        rowStart !== -1 && del !== -1 && dimSelect !== -1 && del < dimSelect,
        `del=${del} select=${dimSelect}`);
      check("F-57: × は1個だけ(末尾に置いていた分が残っていない)",
        (lab.match(/title="このフィルターを削除"/g) || []).length === 1);
      // 【検証で差し戻し】この検査は元々「移動前と同じ padding のまま」= 15.59×19px を固定して
      // おり、本人が出した完了条件(§5 の 44×44pt)に**反する状態をロックしていた**。
      // 「既存と同じ」を守る検査は、その既存が要件違反のときに要件違反を守ってしまう。
      // 当たり判定は 44pt を要求し、**見た目の文字の大きさ**(fontSize 13)は据え置きを要求する。
      const delTag = lab.slice(lab.lastIndexOf("<button", del), lab.indexOf("</button>", del));
      check("F-57: × の当たり判定は §5 の 44×44pt 以上(--tap-min)",
        /minWidth: "var\(--tap-min\)"/.test(delTag) && /minHeight: "var\(--tap-min\)"/.test(delTag),
        delTag.replace(/\s+/g, " ").slice(0, 200));
      check("F-57: × の見た目(文字の大きさ)は変えない(fontSize 13 のまま)",
        /fontSize: 13/.test(delTag), delTag.replace(/\s+/g, " ").slice(0, 200));
      // 当たり判定を広げたぶんで行が伸びないよう、上下の食い出しを相殺していること
      check("F-57: 当たり判定を広げた分は marginTop/Bottom で相殺し、行の高さを変えない",
        /marginTop: -8/.test(delTag) && /marginBottom: -8/.test(delTag),
        delTag.replace(/\s+/g, " ").slice(0, 200));
    }

    // F-58: 削除モードのボタンを、リードタブの削除ボタンと同じ枠(内側のピル)にする。
    // 「同じ寸法」は数値を書き写すのではなく、**両者から抜き出したpaddingが等しいこと**で見る。
    //
    // 【N-6 で対象が移った】旧: セッション一覧の見出しにあった**ゴミ箱ボタン**
    // (aria-label="セッションを選んで削除")が入口だった。新: 入口は子タブ行の「…」の中の
    // 文言になり、ボタンとしては消えた。**要件は1つも下げず**、削除モードに入ったあとに出る
    // 「n件を削除」を対象にする(こちらもリードタブと同じ構造・同じ寸法であるべきもの)。
    //
    // 【前版は構造上失敗し得ない検査だった(N-6 で発見)】リード側の目印を
    // `aria-label="箱を選んで削除"` にしていたが、その綴りは App.jsx の**JSX コメントの中**
    // (F-58 の経緯を書き残した行)にしか無く、しかもそのコメントは**セッション一覧のゴミ箱
    // ボタンの中**にあった。つまり `sess` と `reed` は同じ要素を切り出しており、
    // 「padding が両者で一致する」は恒等式だった。目印は実在する**描画されるテキスト**にする。
    {
      const btnAround = (needle, what) => {
        const i = src.indexOf(needle);
        if (i === -1) throw new Error(`${what}が見つからない`);
        return src.slice(src.lastIndexOf("<button", i), src.indexOf("</button>", i));
      };
      const dataDel = btnAround("件を削除", "データタブの削除ボタン");
      const reed = btnAround("箱を削除", "リードタブの削除ボタン");
      // 切り出しが別々の要素であることを先に固定する(同じ要素を2回見て「一致」と言わない)
      check("F-58: 2つの削除ボタンは別々の要素を切り出せている(恒等式になっていない)",
        dataDel !== reed && dataDel.length > 100 && reed.length > 100,
        `data=${dataDel.length}文字 / reed=${reed.length}文字`);
      // 属性値の中に `>` が入り得る(data-armed={n > 0})ので、`[^>]*?` では拾えない。
      const pillPad = (tag) => (tag.match(/className="ctl-plain ctl-pill[^"]*"[\s\S]{0,160}?padding: "([^"]+)"/) || [])[1] ?? null;
      check("F-58: どちらも「見た目のピルは内側の<span>・<button>は透明な当たり判定」の構造",
        /\.\.\.TAP_BUTTON_RESET/.test(dataDel) && /\.\.\.TAP_BUTTON_RESET/.test(reed) &&
        /className="ctl-plain ctl-pill/.test(dataDel) && /className="ctl-plain ctl-pill/.test(reed));
      check("F-58: 内側のピルの padding が両者で一致する(＝枠の寸法が同じ)",
        pillPad(dataDel) !== null && pillPad(dataDel) === pillPad(reed),
        `data=${pillPad(dataDel)} reed=${pillPad(reed)}`);
      check("F-58: <button>自身にピルの地を持たせない(持たせると枠が44×44に膨らむ)",
        !/<button[^>]*className="sans ctl-plain ctl-pill"/.test(dataDel));
      // N-6: 実際に消える一手だけが危険色の塗りを持つ(0件選択のときは B型の地のまま)
      check("F-58/N-6: データタブの削除は .ctl-danger + data-armed(選択0件では塗らない)",
        /className="ctl-plain ctl-pill ctl-danger"/.test(dataDel)
        && /data-armed=\{selectedForDelete\.size > 0\}/.test(dataDel), dataDel.replace(/\s+/g, " ").slice(0, 200));
    }

    // F-59: 保持したい状態だけを親へ持ち上げる。navNonce による再マウントの意図は壊さない。
    for (const name of ["pivotRow", "pivotCol", "pivotMetric", "pivotFilters"]) {
      check(`F-59: ${name} は親(WindToneLabPhaseMode)が持つ`,
        new RegExp(`const \\[${name}, set${name[0].toUpperCase()}${name.slice(1)}\\] = useState\\(`).test(root));
      check(`F-59: ${name} は AnalysisLabView の useState ではない(再マウントで消えなくなる)`,
        !new RegExp(`const \\[${name},`).test(lab));
      check(`F-59: ${name} は props として渡されている`,
        new RegExp(`${name}=\\{${name}\\}`).test(root));
    }
    // 「親に無いこと」を見る検査なので codeOf() を通す(経緯をコメントに書き残すと落ちるため)
    const rootCode = codeOf(root);
    check("F-59: 開いている個別セッション(selectedSessionId)は持ち上げない(戻ってきたら一覧)",
      /const \[selectedSessionId, setSelectedSessionId\] = useState\(null\);/.test(lab) &&
      !/selectedSessionId/.test(rootCode));
    check("F-59: データタブ内の子タブ(dataSubTab)も持ち上げない(戻ってきたらトップ)",
      /const \[dataSubTab, setDataSubTab\] = useState\("mydata"\);/.test(lab) && !/dataSubTab/.test(rootCode));
    check("F-59: 下部ナビのタップで子ビューを作り直す仕組み(navNonce)を壊していない",
      /key=\{`data-\$\{navNonce\}`\}/.test(root) && /key=\{`reeds-\$\{navNonce\}`\}/.test(root) &&
      /setNavNonce\(\(n\) => n \+ 1\);/.test(root));
    // 既定値(サックス種別=今の楽器)は**使う時点**で作る。親のuseState初期化子で作ると、
    // 楽器種別がIndexedDBから復元される前の既定値("alto")で固定されてしまう。
    check("F-59: 初期フィルターは defaultPivotFilters(saxType) を使う側で評価する",
      /const \[pivotFilters, setPivotFilters\] = useState\(null\);/.test(root) &&
      /const pivotFilters = pivotFiltersRaw \?\? defaultPivotFilters\(saxType\);/.test(lab));
    {
      const dpf = new Function(`${extractFunction("defaultPivotFilters")}
        ${extractConst("SAX_PRESETS")}
        return defaultPivotFilters;`)();
      const f = dpf("tenor");
      check("F-59: defaultPivotFilters はその時点の楽器種別で1件のフィルターを作る",
        f.length === 1 && f[0].dimKey === "saxType" && f[0].values.length === 1, JSON.stringify(f));
      check("F-59: 未知の楽器種別ならフィルター無し(存在しない値で全データを消さない)",
        dpf("unknown").length === 0);
    }
  }
  console.log("  -> done");
}

// ============================================================
// 検証23: F-67 「理想値に設定」のポップアップ化・設定中表示 / F-68 対象の2択
//
// この節が守るもの(集計側・実ソースを評価する):
//   (a) 複数セッションから理想値を作るとき、ピッチのゲートは**セッション単位で個別に**掛かる
//       (F-44の罠1。連結してから1回で掛けると区間の文脈が壊れる)
//   (b) 「この奏者の平均」の対象は**同じ奏者かつ同じ楽器種別**のセッションだけ
//   (c) 理想値プロファイルの構造(getNoteIdeal が引く notes[semitoneIndex])が単一セッション版と同じ
//   (d) 「理想値設定中」の判定は由来を持たない古いプロファイルでクラッシュしない
// 守れないもの(このハーネスはJSXを見ない): ポップアップの見た目・レイアウトの不動。
//   モーダルの体裁だけは**既存モーダルのソースと突き合わせる**形で綴りを縛る(下の 23.6)。
//
// 期待値は「25msホップでどのtのフレームが残るか」を実ソースの選別器から**独立に組み立てた**
// もので、守るべき定数の言い換えではない(F-51 の前例)。
// ============================================================
console.log("=== 検証23: F-67 理想値ポップアップ / F-68 奏者の平均 ===");
{
  const buildIdealApi = (edits = []) => {
    let pieces = [
      extractConst("NOTE_NAMES"),
      extractConst("NOTE_NAMES_SHARP"),
      extractConst("LOW_BB_WRITTEN_MIDI"),
      extractConst("TRANSPOSITION_SEMITONES"),
      extractConst("A4_MIDI"),
      extractConst("SAX_CONCERT_RANGE"),
      extractFunction("freqToNote"),
      extractFunction("writtenNoteLabel"),
      extractFunction("writtenMidiToSoundingFreq"),
      extractFunction("concertMidiToFreq"),
      extractFunction("concertFreqLabel"),
      extractFunction("buildFingeringTable"),
      extractConst("CONCERT_LABEL_CACHE"),
      extractFunction("concertNoteTableOf"),
      extractFunction("concertNoteLabelOf"),
      extractFunction("mean"),
      extractFunction("median"),
      extractFunction("stddev"),
      extractFunction("frameWeight"),
      extractFunction("timbreSustained"),
      extractFunction("weightedMean"),
      extractFunction("generateId"),
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
      extractFunction("groupFramesByNoteAcrossSessions"),
      extractFunction("getNoteIdeal"),
      extractFunction("buildIdealProfileFromSession"),
      extractFunction("buildIdealProfileFromSessions"),
      extractFunction("idealPerformerKeyOf"),
      extractFunction("selectPerformerSessions"),
      extractFunction("isSessionInIdeal"),
    ].join("\n\n");
    for (const [from, to] of edits) {
      const before = pieces;
      pieces = pieces.replace(from, to);
      if (pieces === before) throw new Error(`mutation failed: "${from}" not found`);
    }
    return new Function(`${pieces}
      return { selectPitchAggregationFrames, weightedMean, groupFramesByNoteAcrossSessions,
               buildIdealProfileFromSession, buildIdealProfileFromSessions,
               selectPerformerSessions, isSessionInIdeal, getNoteIdeal };`)();
  };
  const api = buildIdealApi();
  const TUNE = 442;
  // 実ソースを壊す変異(ガードの削除など)で例外が出ると、ハーネスごと落ちて
  // 「どの検査が何を守ったか」が残らない。落ちた事実を値として拾い、検査を落とす。
  const safe = (fn, ...args) => { try { return fn(...args); } catch (e) { return `例外(${e.message})`; } };
  // 変異体の構築も同じ。綴りが変わって置換が空振りしたら、その事実で検査を落とす。
  const mutant = (edits) => { try { return buildIdealApi(edits); } catch (e) { return { _err: e.message }; } };

  // --- 合成データ ---------------------------------------------------------------
  // 25msホップ。si=判定運指、hz=実測f0(オクターブ誤検出を作るために直接指定する)、
  // dev=最寄り半音との差(¢)。silence は無音フレーム(semitoneIndex 無し)。
  const HOP = 0.025;
  const fr = (t, si, hz, dev) => ({
    t, semitoneIndex: si, pitchHz: hz, pitchCents: dev,
    clarity: 1, volumeDb: -20, noteAgeMs: 1000, hnrDb: 20, spectralCentroidHz: 1000, harmonics: [],
  });
  const silence = (t) => ({
    t, semitoneIndex: null, pitchHz: null, pitchCents: null,
    clarity: null, volumeDb: -60, noteAgeMs: 0, hnrDb: null, spectralCentroidHz: null, harmonics: [],
  });
  const seq = (n, f) => Array.from({ length: n }, (_, k) => f(k));

  // セッションA: 短い1音(si=10 / 220Hz / +4¢)。t=0.000〜0.200 の9フレーム。
  const framesA = seq(9, (k) => fr(k * HOP, 10, 220, 4));
  // セッションB: 冒頭0.275sは無音 → 0.300〜0.375 に**1オクターブ上の誤検出**(si=22 / 440Hz /
  // +20¢, 4フレーム=75ms) → 0.400〜0.700 に本来の音(si=10 / 220Hz / −6¢, 13フレーム)。
  // **Bの誤検出は「前の区間」を持たない**(セッションの先頭)ので、F-44の除外条件
  // 「前後の安定区間に挟まれている」を満たさず、Bだけを見る限り除外されない。
  const framesB = [
    ...seq(12, (k) => silence(k * HOP)),
    ...seq(4, (k) => fr(0.300 + k * HOP, 22, 440, 20)),
    ...seq(13, (k) => fr(0.400 + k * HOP, 10, 220, -6)),
  ];
  const sessA = { id: "sA", performer: "自分", saxType: "alto", frames: framesA };
  const sessB = { id: "sB", performer: "自分", saxType: "alto", frames: framesB };

  // テスト側の期待値は**実ソースの選別器を1セッションずつ呼んで**組み立てる。
  // (定数から逆算しない。ゲートの中身が変われば期待値も同じように動く。
  //  ここで固定しているのは「掛け方」= セッションごとに1回、という構造そのもの)
  const expectByNote = (frameLists) => {
    const acc = {};
    for (const list of frameLists) {
      const sel = api.selectPitchAggregationFrames(list);
      list.forEach((f, i) => {
        if (f.semitoneIndex === null || f.semitoneIndex === undefined) return;
        if (!sel.selected.has(i)) return;
        (acc[f.semitoneIndex] ||= []).push(f);
      });
    }
    const out = {};
    for (const [si, fs] of Object.entries(acc)) out[si] = api.weightedMean(fs, (f) => f.pitchCents);
    return out;
  };

  // --- 23.1 ゲートはセッション単位。連結してから1回で掛けたのと結果が違う -----------
  {
    const perSession = expectByNote([framesA, framesB]);
    const concatenated = expectByNote([[...framesA, ...framesB]]);
    // needle が本当に効いているか(=2つの掛け方で結果が違うデータになっているか)を先に確かめる。
    // ここが同じ値になるデータで下の検査を書くと、何も固定できていないことになる。
    check("23.1 needle: このデータは「セッションごと」と「連結して1回」で結果が違う",
      perSession[22] !== null && perSession[22] !== undefined &&
      (concatenated[22] === null || concatenated[22] === undefined),
      `perSession[22]=${perSession[22]} concat[22]=${concatenated[22]}`);

    const groups = api.groupFramesByNoteAcrossSessions([framesA, framesB], 8, "alto", TUNE);
    const got = Object.fromEntries(groups.map((g) => [g.semitoneIndex, g.pitchCentsSigned]));
    const same = (a, b) => (a === null || a === undefined) ? (b === null || b === undefined)
      : (b !== null && b !== undefined && Math.abs(a - b) < 1e-9);
    check("23.1 複数セッションの集計は「セッションごとにゲート」を掛けた結果と全音一致する",
      Object.keys(perSession).every((si) => same(got[si], perSession[si])) &&
      Object.keys(got).length === Object.keys(perSession).length,
      `got=${JSON.stringify(got)} want=${JSON.stringify(perSession)}`);
    check("23.1 連結してから1回だけ掛けた結果(F-44の罠1)にはなっていない",
      !same(got[22], concatenated[22]), `got[22]=${got[22]} concat[22]=${concatenated[22]}`);
    // 音10は両セッションのフレームが混ざる。加重平均は (3×(+4) + 5×(−6))/8
    // (採用フレーム数はテスト側で数えず、上の expectByNote が実ソースの選別器から出している)
    check("23.1 両セッションに出てくる音(si=10)は両方のフレームを合わせた加重平均になる",
      same(got[10], perSession[10]) && got[10] < 0 && got[10] > -6,
      `si10=${got[10]}`);
  }

  // --- 23.1x 変異試験: 連結してから掛ける実装にすると 23.1 が落ちる -----------------
  {
    const mut = mutant([[
      "for (const list of frameLists || []) {",
      "for (const list of [[].concat(...(frameLists || []).map((l) => l || []))]) {",
    ]]);
    const g = mut._err ? null : mut.groupFramesByNoteAcrossSessions([framesA, framesB], 8, "alto", TUNE)
      .find((x) => x.semitoneIndex === 22);
    check("23.1x 変異(連結してから1回だけゲート)では si=22 の理想値が消え、23.1が落ちる",
      !!g && (g.pitchCentsSigned === null || g.pitchCentsSigned === undefined),
      mut._err ? `変異の空振り: ${mut._err}` : `si22=${g ? g.pitchCentsSigned : "グループ無し"}`);
  }

  // --- 23.2 単一セッションは「セッションが1つだけ」の特別な場合として同じ経路を通る ---
  {
    const one = api.groupFramesByNoteAcrossSessions([framesB], 8, "alto", TUNE);
    const legacy = api.buildIdealProfileFromSession(sessB, "single", 8, TUNE);
    const ok = one.every((g) => {
      const n = legacy.notes[g.semitoneIndex];
      return n && JSON.stringify(n.pitchCentsSigned) === JSON.stringify(g.pitchCentsSigned) &&
        n.frameCount === g.frameCount;
    });
    check("23.2 単一セッションの理想値は複数セッション版と同じ値を返す(経路が1本)",
      ok && Object.keys(legacy.notes).length === one.length,
      `notes=${Object.keys(legacy.notes).join(",")}`);
  }

  // --- 23.3 プロファイルの構造は変えていない(getNoteIdeal が引く形) ----------------
  {
    const single = api.buildIdealProfileFromSession(sessA, "単一", 8, TUNE);
    const avg = api.buildIdealProfileFromSessions([sessA, sessB], "平均", 8, TUNE, "performer");
    const keysOf = (p) => Object.keys(api.getNoteIdeal(p, 10) || {}).sort().join(",");
    check("23.3 getNoteIdeal が引く音ごとのオブジェクトのキーが単一/平均で完全に一致する",
      keysOf(single) !== "" && keysOf(single) === keysOf(avg), `single=[${keysOf(single)}]`);
    check("23.3 プロファイルのトップレベルに notes / saxType / name / id がある(既存の読み手の形)",
      ["id", "name", "saxType", "recordedAt", "notes"].every((k) => k in avg) &&
      typeof avg.notes === "object", Object.keys(avg).join(","));
    check("23.3 由来(sourceKind / sourceSessionIds)が記録される(F-67の「設定中」判定に使う)",
      avg.sourceKind === "performer" && Array.isArray(avg.sourceSessionIds) &&
      avg.sourceSessionIds.join(",") === "sA,sB" && single.sourceKind === "session" &&
      single.sourceSessionIds.join(",") === "sA",
      `${avg.sourceKind}:${avg.sourceSessionIds} / ${single.sourceKind}:${single.sourceSessionIds}`);
    // 完了条件: 「奏者の平均」は単一セッションの理想値と**違う値**になる
    check("23.3 奏者の平均は単一セッションの理想値と違う値になる(合成データでの実測)",
      api.getNoteIdeal(single, 10).pitchCentsSigned !== api.getNoteIdeal(avg, 10).pitchCentsSigned &&
      api.getNoteIdeal(single, 22) === null && api.getNoteIdeal(avg, 22) !== null,
      `single(si10)=${api.getNoteIdeal(single, 10).pitchCentsSigned} avg(si10)=${api.getNoteIdeal(avg, 10).pitchCentsSigned}`);
    check("23.3 楽器種別はプロファイルに残る(対象セッションで揃っている前提)",
      avg.saxType === "alto" && single.saxType === "alto", `${avg.saxType}/${single.saxType}`);
  }

  // --- 23.4 「この奏者の平均」の対象選び(同じ奏者 × 同じ楽器種別だけ) ---------------
  {
    const sTenor = { id: "sT", performer: "自分", saxType: "tenor", frames: framesA };
    const sOther = { id: "sO", performer: "後輩", saxType: "alto", frames: framesA };
    const sNoName = { id: "sN", saxType: "alto", frames: framesA };             // performer未設定=「自分」
    const sEmpty = { id: "sE", performer: "自分", saxType: "alto", frames: [] }; // 音が入っていない
    const all = [sessA, sessB, sTenor, sOther, sNoName, sEmpty];
    const got = api.selectPerformerSessions(all, sessA).map((s) => s.id).sort().join(",");
    check("23.4 同じ奏者・同じ楽器種別のセッションだけが対象になる",
      got === "sA,sB,sN", got);
    check("23.4 楽器種別が違うセッションは混ぜない(アルトとテナーの平均を作らない)",
      api.selectPerformerSessions(all, sessA).every((s) => s.saxType === sessA.saxType) &&
      !got.includes("sT"), got);
    check("23.4 別の奏者のセッションは入らない", !got.includes("sO"), got);
    check("23.4 奏者名が未設定のセッションは「自分」として扱う", got.includes("sN"), got);
    check("23.4 フレームが空のセッションは対象にしない(理想値に何も足せない)",
      !got.includes("sE"), got);
    check("23.4 テナー側から見ればテナーのセッションだけが対象",
      api.selectPerformerSessions(all, sTenor).map((s) => s.id).join(",") === "sT",
      api.selectPerformerSessions(all, sTenor).map((s) => s.id).join(","));
    check("23.4 別の奏者から見ればその奏者のセッションだけ",
      api.selectPerformerSessions(all, sOther).map((s) => s.id).join(",") === "sO");
    // 対象0件を作らない(仕様: 1件しかなければ「このセッション」と同じ結果になる。エラーにしない)
    check("23.4 一覧に自分が入っていなくても対象は0件にならない",
      api.selectPerformerSessions([], sessA).length === 1 &&
      api.selectPerformerSessions([], sessA)[0].id === "sA");
    check("23.4 セッションが無ければ空(nullでも例外にしない)",
      api.selectPerformerSessions(null, null).length === 0 &&
      api.selectPerformerSessions(null, sessA).length === 1);
    // 対象が1件だけなら「このセッション」と同じ結果になる(仕様: エラーにしない)
    const only = api.buildIdealProfileFromSessions(
      api.selectPerformerSessions([sessA], sessA), "x", 8, TUNE, "performer");
    const single = api.buildIdealProfileFromSession(sessA, "x", 8, TUNE);
    check("23.4 対象が1件のときの平均は「このセッション」と同じ値になる",
      api.getNoteIdeal(only, 10).pitchCentsSigned === api.getNoteIdeal(single, 10).pitchCentsSigned);
  }

  // --- 23.4x 変異試験: 楽器種別の条件を外すとテナーが混ざり 23.4 が落ちる ------------
  {
    const mut = mutant([[
      "s && idealPerformerKeyOf(s) === key && s.saxType === session.saxType && (s.frames || []).length > 0",
      "s && idealPerformerKeyOf(s) === key && (s.frames || []).length > 0",
    ]]);
    const sTenor = { id: "sT", performer: "自分", saxType: "tenor", frames: framesA };
    const got = mut._err ? `変異の空振り: ${mut._err}`
      : mut.selectPerformerSessions([sessA, sessB, sTenor], sessA).map((s) => s.id).join(",");
    check("23.4x 変異(楽器種別の条件を外す)ではテナーが混ざり、23.4が落ちる",
      !mut._err && got.includes("sT"), got);
  }

  // --- 23.5 「理想値設定中」の判定(古いプロファイルでクラッシュしない) --------------
  {
    const legacy = { id: "p0", name: "旧", notes: {} };                       // 由来を持たない旧データ
    const nu = { id: "p1", name: "新", notes: {}, sourceSessionIds: ["sA", "sB"] };
    const inIdeal = (p, s) => safe(api.isSessionInIdeal, p, s); // ガードを外す変異は例外になるので拾う
    check("23.5 由来を持たない古いプロファイルでは「設定中」を出さない(例外にもしない)",
      inIdeal(legacy, sessA) === false, `${inIdeal(legacy, sessA)}`);
    check("23.5 由来にそのセッションが入っていれば「設定中」", inIdeal(nu, sessB) === true);
    check("23.5 入っていなければ出さない",
      inIdeal(nu, { id: "sX" }) === false);
    check("23.5 プロファイル未選択(null)・セッション無しでも例外にしない",
      inIdeal(null, sessA) === false && inIdeal(nu, null) === false &&
      inIdeal(nu, {}) === false,
      `${inIdeal(null, sessA)} / ${inIdeal(nu, null)} / ${inIdeal(nu, {})}`);
    check("23.5 sourceSessionIds が配列でない壊れたデータでも false",
      inIdeal({ notes: {}, sourceSessionIds: "sA" }, sessA) === false,
      `${inIdeal({ notes: {}, sourceSessionIds: "sA" }, sessA)}`);
  }

  // --- 23.6 F-67 の配線(JSXなので**ソース文字列の検査**にとどまる) ------------------
  // このハーネスはJSXを評価しないので、以下は「綴りが実ソースにあるか」しか見ていない。
  // ポップアップの見た目・レイアウトが動かないことは Browser pane の実測が担保する。
  {
    const btnStart = src.indexOf("function SetAsIdealButton(");
    const btn = (() => {
      let i = src.indexOf("{", src.indexOf(")", btnStart)), d = 0;
      for (; i < src.length; i++) {
        if (src[i] === "{") d++;
        else if (src[i] === "}") { d--; if (d === 0) return src.slice(btnStart, i + 1); }
      }
      throw new Error("SetAsIdealButton を切り出せない");
    })();
    const btnCode = codeOf(btn);

    check("F-67: その場で入力欄に化けるインライン方式(isNaming)は残っていない",
      !/isNaming/.test(btnCode) && /createPortal\(/.test(btnCode), "");
    check("F-67: ボタンは A型(.ctl-state)で、状態を aria-pressed で返す",
      /className="sans ctl-state ctl-pill"/.test(btn) && /aria-pressed=\{isSet\}/.test(btn));
    check("F-67: B型(.ctl-plain)の地はボタン自身には残っていない(型の二重取りをしない)",
      !/className="sans ctl-plain ctl-pill"[\s\S]{0,200}aria-pressed=\{isSet\}/.test(btn));
    // ラベルは「押す前後で行の中身が動かない」ために**同じ文字数**で組む(全角のみ)。
    // 文字数を数えるのはソースから取り出した実際の文字列であって、書き写した定数ではない。
    {
      const m = /\{isSet \? "([^"]+)" : "([^"]+)"\}/.exec(btn);
      const a = m ? [...m[1]] : [], b = m ? [...m[2]] : [];
      check("F-67: 設定中/未設定のラベルは同じ文字数(幅が変わるとボタンの左端が動く)",
        m !== null && a.length === b.length && a.length > 0,
        m ? `"${m[1]}"(${a.length}) / "${m[2]}"(${b.length})` : "ラベルの三項が見つからない");
      // 文字数が同じでも、片方だけに半角文字が入れば幅は変わる。共通の頭(★+空白)を外した
      // 残りが両方とも全角だけであることを見る(★と空白は両方に同じだけあるので幅に効かない)。
      const head = m ? m[1].slice(0, 2) : "";
      const restOf = (s) => [...s.slice(2)];
      check("F-67: 共通の頭を除いた残りは両方とも全角のみ(片方だけ半角が混ざると幅が変わる)",
        m !== null && m[2].startsWith(head) &&
        [...restOf(m[1]), ...restOf(m[2])].every((c) => c.charCodeAt(0) > 0x2000),
        m ? `頭="${head}" / "${m[1]}" / "${m[2]}"` : "");
    }
    check("F-68: ポップアップに2択(このセッション / この奏者の平均)がある",
      /key: "session", label: "このセッション"/.test(btn) &&
      /key: "performer", label: "この奏者の平均"/.test(btn));
    check("F-68: 2択は A型(.ctl-state)で、選択中を aria-pressed で返す",
      /className="sans ctl-state"[\s\S]{0,120}aria-pressed=\{scope === o\.key\}/.test(btn));
    check("F-68: 選択肢に対象件数を添える",
      /\{o\.count\}セッション/.test(btn));
    check("F-68: 件数は selectPerformerSessions から出す(画面側で数え直さない)",
      /selectPerformerSessions\(sessions, session\)\.length/.test(btnCode));
    check("F-68: 保存は選んだ対象(scope)を渡す", /onSave\(session, trimmed, scope\)/.test(btnCode));
    // promoteSessionToIdeal はコンポーネント内(useCallback)なのでハーネスから評価できない。
    // 「奏者の平均を選んだのに1セッションしか渡さない」という配線ミスを綴りで縛る
    // (複製ツリーでの変異試験で、この検査が無いと丸ごと素通りすることを確認した)。
    check("F-68: 「この奏者の平均」の対象は selectPerformerSessions が返す全セッション",
      /const targets = scope === "performer" \? selectPerformerSessions\(sessions, sessionLike\) : \[sessionLike\];/.test(src));
    check("F-68: 生成はその対象一式を渡す(1セッションに縮めない)",
      /buildIdealProfileFromSessions\(targets, trimmedName, NUM_HARMONICS, effectiveTuningHz, scope\)/.test(src));
    check("F-67: 呼び出し元は2箇所ともセッション・一覧・選択中の理想値を渡す",
      (src.match(/<SetAsIdealButton[^>]*session=\{[^}]+\} sessions=\{sessions\} selectedIdeal=\{selectedIdeal\}/g) || []).length === 2,
      `${(src.match(/<SetAsIdealButton/g) || []).length}箇所`);
    // マージ(同名の理想値に積み上げる既存の挙動)でも由来を失わない
    check("F-67: 同名マージで由来(sourceSessionIds)を積む",
      /sourceSessionIds: \[\.\.\.new Set\(\[\.\.\.\(existing\.sourceSessionIds \|\| \[\]\), \.\.\.newProfile\.sourceSessionIds\]\)\]/.test(src));

    // --- モーダルの体裁を既存2つと突き合わせる(値を書き写さず、ソース同士を比較する) ---
    const dialogStyle = (label) => {
      const i = src.indexOf(`aria-label="${label}"`);
      if (i === -1) throw new Error(`aria-label="${label}" が見つからない`);
      const open = src.lastIndexOf("<div", i);
      const s = src.indexOf("style={{", open);
      let d = 0, j = s + "style={".length;
      for (; j < src.length; j++) {
        if (src[j] === "{") d++;
        else if (src[j] === "}") { d--; if (d === 0) break; }
      }
      return src.slice(s, j + 1).replace(/\s+/g, " ");
    };
    // 宣言の切り出しは**括弧の深さを見て**行う。単純に「次のカンマまで」で切ると
    // rgba(15,23,42,0.28) が `rgba(15` で切れ、暗幕の濃さを変えても差が出なくなる
    // (複製ツリーでの変異試験で実際にすり抜けた)。
    const declMap = (style) => {
      const body = style.slice(style.indexOf("{{") + 2, style.lastIndexOf("}}"));
      const out = {};
      let d = 0, cur = "";
      const push = (s) => {
        const i = s.indexOf(":");
        if (i > 0) out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
      };
      for (const ch of body) {
        if ("([{".includes(ch)) d++;
        else if (")]}".includes(ch)) d--;
        if (ch === "," && d === 0) { push(cur); cur = ""; } else cur += ch;
      }
      push(cur);
      return out;
    };
    const keyDecls = (style) => {
      const m = declMap(style);
      return ["position", "inset", "zIndex", "background", "flexDirection",
        "justifyContent", "alignItems", "padding", "paddingBottom"]
        .map((k) => `${k}=${m[k] ?? "無し"}`).join(" | ");
    };
    // 【N-2 表記統一】ダイアログの aria-label は「理想値に設定」→「目安に設定」になった
    const mine = keyDecls(dialogStyle("目安に設定"));
    const pending = keyDecls(dialogStyle("この録音を保存しますか？"));
    const micErr = keyDecls(dialogStyle("エラー"));
    check("F-67: ポップアップの暗幕は保存確認モーダルと同じ宣言(位置・色・下寄せ・余白)",
      mine === pending, `目安=[${mine}] 保存確認=[${pending}]`);
    check("F-67: マイク許可エラーのモーダルとも同じ宣言(体裁は1つに揃える)",
      mine === micErr, `目安=[${mine}] エラー=[${micErr}]`);
    check("F-67: 下寄せ(justifyContent: flex-end)である(計測タブと同じ理由で中央寄せにしない)",
      /flex-end/.test(mine), mine);
    // カード側(白い面)も同じ体裁であること
    const cardOf = (label) => {
      const i = src.indexOf(`aria-label="${label}"`);
      const c = src.indexOf('style={{ width: "100%", maxWidth: 900', i);
      if (c === -1 || c - i > 2000) return "無し";
      let d = 0, j = c + "style={".length;
      for (; j < src.length; j++) {
        if (src[j] === "{") d++;
        else if (src[j] === "}") { d--; if (d === 0) break; }
      }
      return src.slice(c, j + 1).replace(/\s+/g, " ");
    };
    check("F-67: ポップアップのカードは保存確認モーダルのカードと同じ宣言",
      cardOf("目安に設定") !== "無し" && cardOf("目安に設定") === cardOf("この録音を保存しますか？"),
      `${cardOf("目安に設定")}`);
  }
  console.log("  -> done");
}

// ============================================================
// 検証24: N-4b 計測タブを正典どおりに完成させる
//   A テンポシート(拍子12種 / 分割の条件分岐 / 拍グループ / 小節アクセント)
//   A 拍の●は画面中央固定・拍子表示はその左 / −＋ の反応領域 72×48
//   B 録音中は周辺だけ淡くする(環・音名・折れ線は淡くしない)
//   C アップロードはデータタブで完結する(計測タブに残っていない)
//   D 3連符は数字ではなく音符 / スクロールピッカーに見出しを出さない
// 正典: design/north-star-measure.html(確定版 2026/08/11)
// ============================================================
console.log("=== 検証24: N-4b/N-4c 計測タブ(メトロノーム / 録音 / アップロード移設 / 正典の実寸) ===");
let METRO_SIGS_ALL = [];
{
  const code = codeOf(src);
  // 【罠】codeOf のコメント除去は `/\*` をそのままコメントの開始と読むので、
  // accept="audio/*,video/*" の `/*` から次の `*/` までを丸ごと消してしまう
  // (section 17.10 が同じ罠を踏んで400行が走査から消えた記録がある)。
  // データタブ側は隠しファイル入力を持つので、こちらの除去器を使う:
  // コメントの開始は**直前が空白か区切り記号のとき**だけと見る。
  const blank = (m) => m.replace(/[^\n]/g, " ");
  const codeSafe = src
    .replace(/(^|[\s{(,;=])\/\*[\s\S]*?\*\//g, (m, a) => a + blank(m.slice(a.length)))
    .replace(/(^|\n)([ \t]*)(\/\/[^\n]*)/g, (m, a, b, c) => a + b + blank(c));
  const sheetStart = code.indexOf('aria-label="テンポと拍子"', code.indexOf('role="dialog" aria-modal="true" aria-label="テンポと拍子"'));
  const sheet = sheetStart === -1 ? "" : code.slice(sheetStart, code.indexOf("録音停止後: この録音を", sheetStart));
  check("テンポシートのブロックを走査できている", sheet !== "" && sheet.length > 500, `${sheet.length}文字`);

  // --- 24.1 拍子は12種すべて。**数ではなく綴りで1つずつ**確かめる --------------
  // (「6列グリッドがある」だけだと、配列を減らされても通ってしまう)
  {
    const want = ["1/4", "2/4", "3/4", "4/4", "5/4", "6/4", "3/8", "5/8", "6/8", "7/8", "9/8", "12/8"];
    const m = /const METRO_SIGS = \[([^\]]*)\]/.exec(code);
    const got = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
    METRO_SIGS_ALL = got;
    check("拍子は12種ちょうど", got.length === 12, `${got.length}種: ${got.join(" ")}`);
    check("拍子の顔ぶれが正典どおり(1/4 2/4 3/4 4/4 5/4 6/4 3/8 5/8 6/8 7/8 9/8 12/8)",
      want.every((w) => got.includes(w)) && got.every((g) => want.includes(g)), got.join(" "));
    // 【N-4c】正典 .selrow は **6個ずつ2行**。slice(0,6) / slice(6) で全12種を漏れなく描く。
    // 「全部並べる」を、綴りではなく**実際に描かれる拍子の集合**で見る
    // (slice の範囲を変えたり片方の行を消したりすると落ちる)。
    {
      const rm = /\[METRO_SIGS\.slice\((\d+), (\d+)\), METRO_SIGS\.slice\((\d+)\)\]\.map\(\(row, ri\) => \(/.exec(sheet);
      check("テンポシートは拍子を2行に分けて並べる(式を実ソースから取れている)", rm !== null, rm ? rm[0] : "取れない");
      const drawn = rm ? [...got.slice(Number(rm[1]), Number(rm[2])), ...got.slice(Number(rm[3]))] : [];
      check("テンポシートが描く拍子は METRO_SIGS 12種の全部(重複なし・欠けなし)",
        drawn.length === 12 && new Set(drawn).size === 12 && want.every((w) => drawn.includes(w)),
        `${drawn.length}種: ${drawn.join(" ")}`);
      check("1行目6個 / 2行目6個(正典 .selrow の並び)",
        rm !== null && Number(rm[1]) === 0 && Number(rm[2]) === 6 && Number(rm[3]) === 6,
        rm ? `${rm[1]},${rm[2]} / ${rm[3]}` : "");
    }
    // 状態は aria-pressed が持つ。
    check("拍子のピルの状態は aria-pressed が持つ", /aria-pressed=\{metroSig === sig\}/.test(sheet));
    // 【逸脱1 の撤回】見た目は正典 .selpill / .selpill.on:
    //   非選択 = 1px の輪郭 + 地なし / 選択中 = --c-accent の塗り + 白文字。
    // 選択中の枠を "1px solid transparent" にしてあるのは、描画を変えずに
    //   「枠と違う地を同じ状態で両方持たない」構造を保つため(背景は枠の下まで塗られる)。
    check("拍子の非選択は輪郭のみ(正典 .selpill)",
      /border: metroSig === sig \? "1px solid transparent" : "1px solid var\(--c-line-strong\)"/.test(sheet));
    check("拍子の選択中は --c-accent の塗り + 白文字(正典 .selpill.on)",
      /background: metroSig === sig \? "var\(--c-accent\)" : "transparent"/.test(sheet)
      && /color: metroSig === sig \? "var\(--c-on-accent\)" : "var\(--c-ink-2\)"/.test(sheet));
    check("拍子のピルの寸法は正典 .selpill(12.5px / padding 4px 11px / 角丸999)",
      /fontSize: 12\.5, padding: "4px 11px", borderRadius: 999/.test(sheet));
    check("拍子の行の gap は正典 .selrow の 7、上マージンは 18 / 7",
      /gap: 7, marginTop: ri === 0 \? 18 : 7/.test(sheet));
    // タップ領域 44 以上(§5 は §6.0 が「機能側の規定として引き続き有効」と明記した規定)。
    // 見た目のピルは 44 未満なので、外側の <button> が当たり判定を持ち、内側の <span> が見た目を持つ。
    //
    // 【審査③の修正】以前は sheet 全体に正規表現を1回当てていたので、
    // **拍子ピルだけ 30px にする / 分割ピルだけ 30px にする**変異がどちらも生存した
    // (他の群の一致で通ってしまう)。**群ごとに、その群のタグを切り出して1つずつ見る。**
    {
      // シート内の <button> を、直前の aria-label / aria-pressed で群に分けて集める
      // 【切り出し】`<button…>` の終わりは **{} の深さ0に現れる >**。
      // 非貪欲の /<button[\s\S]*?>/ だと onClick={() => …} の `=>` で切れてしまい、
      // 群がすべて0件になって「走査できている」ごと落ちる(実際に落ちた)。
      const tagsIn = (str, el) => {
        const out = []; const re = new RegExp("<" + el + "[\\s/>]", "g");
        let m;
        while ((m = re.exec(str)) !== null) {
          let d = 0;
          for (let i = m.index; i < str.length; i++) {
            if (str[i] === "{") d++;
            else if (str[i] === "}") d--;
            else if (str[i] === ">" && d === 0) { out.push(str.slice(m.index, i + 1)); break; }
          }
        }
        return out;
      };
      const btns = tagsIn(sheet, "button");
      const groups = {
        "拍子": btns.filter((t) => /aria-pressed=\{metroSig === sig\}/.test(t)),
        "1拍の分割": btns.filter((t) => /aria-label=\{`分割 \$\{s\.value\}`\}/.test(t)),
        "拍のグループ": btns.filter((t) => /aria-label=\{`拍のグループ \$\{label\}`\}/.test(t)),
        "テンポの ±(シート)": btns.filter((t) => /aria-label="テンポを(下|上)げる"/.test(t)),
        "テンポの直接入力": btns.filter((t) => /aria-label="テンポを直接入力"/.test(t)),
        "つまみ(閉じる)": btns.filter((t) => /aria-label="閉じる"/.test(t)),
      };
      // 44 を満たす書き方は2通り: --tap-min の min か、44 以上の実寸(62 の円など)
      const meetsTap = (t) => {
        if (/minHeight: "var\(--tap-min\)"/.test(t) && /minWidth: "var\(--tap-min\)"/.test(t)) return true;
        if (/height: "var\(--tap-min\)"/.test(t) && /width: "var\(--tap-min\)"/.test(t)) return true;
        const w = /width: (\d+)/.exec(t), h = /height: (\d+)/.exec(t);
        return !!(w && h && Number(w[1]) >= 44 && Number(h[1]) >= 44);
      };
      for (const [name, tags] of Object.entries(groups)) {
        check(`シートの「${name}」のタグを走査できている`, tags.length >= 1, `${tags.length}個`);
        const bad = tags.filter((t) => !meetsTap(t));
        check(`シートの「${name}」のタップ領域は 44px 以上(群ごとに個別に確認)`,
          tags.length >= 1 && bad.length === 0,
          bad.length ? bad[0].replace(/\s+/g, " ").slice(0, 170) : "");
      }
      // 群の数が減っていないこと(群ごと消して「0件だから合格」を作らせない)
      check("シートの操作の群は6つある(群ごと消して緑にしていない)",
        Object.values(groups).every((g) => g.length >= 1), Object.entries(groups).map(([k, v]) => `${k}:${v.length}`).join(" "));
    }
  }

  // --- 24.2 1拍の分割は**現行の条件分岐のまま** -------------------------------
  // X/4系 = 1・2・3連・4 の4択 / X/8系 = 「主拍のみ」と「8分で埋める」の2択。
  // 複合拍子(3の倍数)のときだけ、埋める側のアイコンが8分3つになる。
  // 分岐そのものを実際に評価して確かめる(綴りの一致では中身が変わっても通る)。
  {
    const m = /const metroSubdivOptions = ([\s\S]*?);\r?\n/.exec(code);
    check("分割の選択肢を作る式を実ソースから取れている", m !== null);
    const build = (sig) => {
      const { num, den } = api.parseMetroSig(sig);
      const compound = den === 8 && num % 3 === 0;
      // 実ソースの式をそのまま評価する(手書きの再実装をしない)
      const f = new Function("metroSigDen", "metroCompoundX8", "METRO_SUBDIVS",
        `const metroSubdivOptions = ${m[1]}; return metroSubdivOptions;`);
      return f(den, compound, [
        { value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3連" }, { value: 4, label: "4" },
      ]);
    };
    for (const sig of ["1/4", "2/4", "3/4", "4/4", "5/4", "6/4"]) {
      const o = build(sig);
      check(`分割(${sig}): 1・2・3連・4 の4択`,
        o.length === 4 && o.map((x) => x.value).join(",") === "1,2,3,4" && o.map((x) => x.icon).join(",") === "1,2,3,4",
        JSON.stringify(o));
    }
    for (const sig of ["3/8", "6/8", "9/8", "12/8"]) {
      const o = build(sig);
      check(`分割(${sig} 複合): 主拍のみ / 8分で埋める の2択で、埋める側は8分3つの絵`,
        o.length === 2 && o[0].value === 1 && o[1].value === 2 && o[0].icon === 1 && o[1].icon === 3,
        JSON.stringify(o));
    }
    for (const sig of ["5/8", "7/8"]) {
      const o = build(sig);
      check(`分割(${sig} 非複合): 2択で、埋める側は8分2つの絵`,
        o.length === 2 && o[1].value === 2 && o[1].icon === 2, JSON.stringify(o));
    }
    check("テンポシートは metroSubdivOptions をそのまま並べる(選択肢を作り直していない)",
      /metroSubdivOptions\.map\(\(s\) => \{/.test(sheet));
  }

  // --- 24.3 拍グループ行は 5/8・7/8 のときだけ --------------------------------
  {

    // 【審査④の修正】旧実装はテスト内の述語をテスト内の配列にかけているだけで、
    // **src を1文字も参照していなかった**(実装をどう壊しても永久に通る。LOOP.md が
    // 名指しで禁じている「構造上失敗し得ないアサーション」の7例目)。
    // **実ソースの条件式そのものを取り出して評価する**形に直す(24.2 の分割と同じ方式)。
    {
      const m = /\{\((metroSig === "[^"]+" \|\| metroSig === "[^"]+")\) && \(\(\) => \{/.exec(sheet);
      check("拍グループ行を出す条件式を実ソースから取れている", m !== null, m ? m[1] : "取れない");
      const shows = new Function("metroSig", `return (${m ? m[1] : "false"});`);
      const on = METRO_SIGS_ALL.filter((sig) => shows(sig));
      check("拍グループ行が出るのは 5/8 と 7/8 だけ(実ソースの条件式を評価)",
        on.length === 2 && on.includes("5/8") && on.includes("7/8"), `出る拍子: ${on.join(" ")}`);
      // 選択肢そのものも実ソースの式から取り出して評価する(綴りの一致では中身を変えられる)。
      const cm = /const choices = (metroSig === "5\/8" \? \[\[[\s\S]*?\]\]);/.exec(sheet);
      check("拍グループの選択肢の式を実ソースから取れている", cm !== null);
      const choicesOf = new Function("metroSig", `return (${cm ? cm[1] : "null"});`);
      check("5/8 の拍グループは [3,2] と [2,3](実ソースの式を評価)",
        JSON.stringify(choicesOf("5/8")) === JSON.stringify([[3, 2], [2, 3]]), JSON.stringify(choicesOf("5/8")));
      check("7/8 の拍グループは [3,2,2] [2,3,2] [2,2,3](実ソースの式を評価)",
        JSON.stringify(choicesOf("7/8")) === JSON.stringify([[3, 2, 2], [2, 3, 2], [2, 2, 3]]), JSON.stringify(choicesOf("7/8")));
      // 拍数の合計が分子と一致する(グループ分けとして成立している)ことも独立に見る。
      for (const [sig, num] of [["5/8", 5], ["7/8", 7]]) {
        const ok = choicesOf(sig).every((g) => g.reduce((a, b) => a + b, 0) === num);
        check(`${sig} の拍グループはどれも合計が ${num}`, ok, JSON.stringify(choicesOf(sig)));
      }
    }
  }

  // --- 24.4 小節アクセント -----------------------------------------------------
  {
    check("チェックの文言は「小節アクセント」(旧「一拍目にアクセントをつける」ではない)",
      /小節アクセント/.test(sheet) && !/一拍目にアクセントをつける/.test(code));
    check("小節アクセントは metroAccent を読み書きする(表示だけの飾りではない)",
      /checked=\{metroAccent\} onChange=\{\(e\) => setMetroAccent\(e\.target\.checked\)\}/.test(sheet));
    check("小節アクセントの行は --tap-min 以上",
      /alignSelf: "flex-start", marginTop: 14, minHeight: "var\(--tap-min\)"/.test(sheet));
    // 見た目は正典 .ckrow / .ck: 行 12.5px・gap 8 / 箱 16px・紺の枠・チェック時は紺の塗り。
    check("小節アクセントの行の寸法は正典 .ckrow(12.5px / gap 8 / marginTop 14)",
      /marginTop: 14, minHeight: "var\(--tap-min\)", display: "flex", alignItems: "center", gap: 8, fontSize: 12\.5/.test(sheet));
    check("チェックの箱は正典 .ck(16px・未チェックは紺の枠)",
      /reedCheckboxStyle\(metroAccent, 16, CHECKBOX_OFF_ACCENT_IMG\)/.test(sheet));
    check("未チェックの絵は紺(--c-accent #174585)の 1.5px 枠で地を持たない(正典 .ck)",
      /const CHECKBOX_OFF_ACCENT_IMG = [^;]*fill='none' stroke='%23174585' stroke-width='1\.5'/.test(code));
    // 実際に効いていること: OFF なら小節頭の"差"が出ない(発音側と視覚側の両方)。
    check("小節アクセントOFF は発音側の強拍を消す",
      api.metroTickKind(0, "4/4", 1, true) === "accent" && api.metroTickKind(0, "4/4", 1, false) === "beat");
    check("小節アクセントOFF は視覚側の小節頭の差も消す",
      api.ringBeatIsHead(0, 4, true) === true && api.ringBeatIsHead(0, 4, false) === false);
  }

  // --- 24.5 テンポの −/＋ の反応領域は 72×48 の METRO_SCALE 倍 -------------------
  // 【縛り方】基準値(正典 .pmt の 72×48)と、**その基準値から導いた実寸が実際に
  // 反応領域(width/height)に使われている**ことを両方見る。
  // 定数だけ見ると使われていなくても通り、綴りだけ見ると値を変えられる。
  {
    check("反応領域の基準値は 72×48(正典 .pmt)", api.METRO_PM_W === 72 && api.METRO_PM_H === 48,
      `${api.METRO_PM_W}×${api.METRO_PM_H}`);
    const minus = code.indexOf('aria-label="テンポを下げる" className="no-select"');
    const plus = code.indexOf('aria-label="テンポを上げる" className="no-select"');
    check("画面上の −/＋ を綴りで特定できている", minus !== -1 && plus !== -1);
    for (const [label, at] of [["−", minus], ["＋", plus]]) {
      const tag = at === -1 ? "" : code.slice(code.lastIndexOf("<button", at), code.indexOf(">", at) + 1);
      check(`テンポの ${label} の反応領域は METRO_PM_W_CSS × METRO_PM_H_CSS`,
        /width: METRO_PM_W_CSS, height: METRO_PM_H_CSS/.test(tag), tag.replace(/\s+/g, " ").slice(0, 200));
      check(`テンポの ${label} 自体は見た目を持たない(見た目は内側の span が持つ)`,
        /background: "transparent"/.test(tag) && /border: "none"/.test(tag), tag.replace(/\s+/g, " ").slice(0, 200));
    }
    // 【逸脱4 の撤回】見た目は正典 .pmt そのもの: 地も枠も持たない素のテキスト、
    // font-size 20 / font-weight 300 / color --ink2。以前は 46×46 のピル + 24px だった。
    {
      const pmt = (code.match(/width: METRO_PM_W_CSS, height: METRO_PM_H_CSS, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", flexShrink: 0, fontSize: METRO_PM_FS_CSS, fontWeight: 300, color: "var\(--c-ink-2\)", lineHeight: 1/g) || []).length;
      check("−/＋ は正典 .pmt(地も枠も無い素のテキスト / weight 300 / --ink2)を METRO_SCALE 倍で描く", pmt === 2, `${pmt}個`);
      check("−/＋ に見た目のピル(46×46 の .ctl-plain)が残っていない",
        !/width: 46, height: 46[^}]*ctl-plain|ctl-pill[^>]*width: 46/.test(code)
        && (code.match(/<span className="ctl-plain ctl-pill" style=\{\{ width: 46, height: 46/g) || []).length === 0);
      check("−/＋ と ♩=n の間隔は正典の 34 を METRO_SCALE 倍した METRO_PM_GAP_CSS",
        /justifyContent: "center", gap: METRO_PM_GAP_CSS \}\}/.test(code));
      check("♩=n は正典 .bpmtxt の 15 を METRO_SCALE 倍した METRO_BPM_FS_CSS",
        /fontFamily: "var\(--font-num\)", fontSize: METRO_BPM_FS_CSS, color: "var\(--c-ink-2\)"/.test(code));
    }
    // テンポ数値の箱も同じ幅 = 桁が変わっても ± が動かない(§6.1.5)
    check("テンポ数値の箱は ± と同じ幅(桁が変わっても ± が動かない)",
      /aria-label="テンポと拍子"[\s\S]{0,300}?width: METRO_PM_W_CSS/.test(code));
  }

  // --- 24.6 拍の●は画面中央固定・拍子表示はその左 ------------------------------
  {
    const mp = code.slice(code.indexOf("function MetroPendulum"), code.indexOf("function MeasureView"));
    check("●の列は行の中央に置く(justifyContent: center)",
      /height: METRO_BEAT_ROW_H_CSS, display: "flex", alignItems: "center", justifyContent: "center"/.test(mp));
    check("拍子表示は流れの外(absolute)に置く。●の列の幅・桁数に影響されない",
      /position: "absolute", right: `calc\(50% \+ \$\{rowWCss \/ 2\}px \+ var\(--sp-3\) \* \$\{METRO_SCALE\}\)`/.test(mp));
    check("拍子表示は●の列の左にある(右端が中央より 列幅/2 以上左)",
      /right: `calc\(50% \+ \$\{rowWCss \/ 2\}px/.test(mp));
    // 幾何: 列の中心が列幅の中心にあるので、行の中央に置けば画面中央に来る。
    // 拍子の桁数(2〜4文字)が変わっても●は1pxも動かない = 絶対配置の帰結を数値で確認する。
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const w = api.metroBeatRowW(n);
      const c = (api.metroBeatDotX(0, n) + api.metroBeatDotX(n - 1, n)) / 2;
      check(`●列(${n}拍)の中心は列幅の中心(=行の中央に置けば画面中央)`, Math.abs(c - w / 2) < 1e-9,
        `中心 ${c} / 幅の半分 ${w / 2}`);
    }
    check("行の高さは固定(●が膨らんでも行が伸びない)", /height: METRO_BEAT_ROW_H_CSS/.test(mp) && api.METRO_BEAT_ROW_H > api.METRO_BEAT_DOT_PX * api.METRO_DOT_HEAD_SCALE,
      `行 ${api.METRO_BEAT_ROW_H} / ●の最大 ${api.METRO_BEAT_DOT_PX * api.METRO_DOT_HEAD_SCALE}`);
    // 【逸脱5 の撤回】拍子表示は正典 .tsig の 12px。以前は §6.1「演奏中サーフェスで12px禁止」に
    // 従って --fs-md(15px)にしていたが、見た目はモックが唯一の正典(§6.0)。
    // 【F-95a】その 12px は基準値になり、画面には ×METRO_SCALE で描く。
    check("拍子表示は正典 .tsig の 12 を METRO_SCALE 倍した METRO_TSIG_FS_CSS",
      /fontSize: METRO_TSIG_FS_CSS, color: "var\(--c-ink-3\)"/.test(mp));

    // --- 【F-91】拍子表示・拍の●をタップしてもテンポ拍子シートが出る ------------
    // 本人指示(実機 2026/08/15)「4/4などの拍子や、拍を表すをタップしても
    // テンポ拍子メニューがでるルートを追加」。
    // 【メトロノームの開始/停止と喧嘩させない】計測タブは A-1 で画面のどこでも開始/停止し、
    // F-74 でその範囲を限定してある。ここに置く当たり判定は**拍子の文字と●の列の上だけ**。
    // ここで見ているのは配線と寸法の規則で、**実際にどこがどちらに割り当たるかは
    // 実ブラウザの走査で見る**(この検査だけでは十分条件にならない)。
    {
      const mpSrc = mp;   // MetroPendulum の本体(コメントは落としてある)
      check("F-91: MetroPendulum は押せるかどうかを呼び出し側から受け取る(既定は押せない)",
        /onOpenSheet = null/.test(code.slice(code.indexOf("function MetroPendulum"), code.indexOf("function MetroPendulum") + 400)));
      // 既定を「押せる」にすると、次に増える呼び出し先へ黙って当たり判定が漏れる(F-72 罠1)。
      check("F-91: onOpenSheet が無いときは当たり判定を1つも作らない",
        /\{onOpenSheet \?/.test(mpSrc) && /\{onOpenSheet && n > 0 &&/.test(mpSrc));
      check("F-91: ●が1つも無いとき(n=0)は●側の当たり判定を出さない",
        /onOpenSheet && n > 0/.test(mpSrc));
      // 押せる箱は流れの外(absolute)。行の高さ METRO_BEAT_ROW_H を伸ばさない(§6.1.5)。
      const taps = [];
      for (let k = mpSrc.indexOf("onClick={onOpenSheet}"); k !== -1; k = mpSrc.indexOf("onClick={onOpenSheet}", k + 1)) {
        taps.push(mpSrc.slice(mpSrc.lastIndexOf("<button", k), mpSrc.indexOf(">", k) + 1));
      }
      // 2 に固定するのは偶然の件数ではなく、**本人が名指しした入口が2つ**だから
      // (「4/4などの拍子」と「拍を表す」)。増やすなら仕様の側を先に変える。
      check("F-91: 本人が名指しした入口は2つ(拍子の文字と●の列)。それ以外に増やしていない",
        taps.length === 2, `${taps.length}個`);
      check("F-91: どちらも流れの外(absolute)に置き、行の高さを伸ばさない",
        taps.every((t) => /position: "absolute"/.test(t)),
        taps.map((t) => t.replace(/\s+/g, " ").slice(0, 80)).join(" || "));
      check("F-91: どちらも §5 の 44pt を満たす(高さ --tap-min / 最小幅 --tap-min)",
        taps.every((t) => /height: "var\(--tap-min\)"/.test(t) && /minWidth: "var\(--tap-min\)"/.test(t)),
        taps.map((t) => t.replace(/\s+/g, " ").slice(0, 120)).join(" || "));
      // 親は pointerEvents:none(A-1 の読むだけの箱)なので、押せる箱は自分で取り戻す。
      check("F-91: 押せる箱は pointerEvents を自分で auto に戻す(親が none のため)",
        taps.every((t) => /pointerEvents: "auto"/.test(t)));
      // 文字の位置は1pxも動かない = 拍子の右端の式が従来と同じであること(上の検査と同じ式)。
      check("F-91: 拍子の文字の右端の位置は押せる版・押せない版で同じ式(当たり判定だけ広げる。§5)",
        (mpSrc.match(/right: `calc\(50% \+ \$\{rowWCss \/ 2\}px \+ var\(--sp-3\) \* \$\{METRO_SCALE\}\)`/g) || []).length === 2,
        `${(mpSrc.match(/right: `calc\(50% \+ \$\{rowWCss \/ 2\}px \+ var\(--sp-3\) \* \$\{METRO_SCALE\}\)`/g) || []).length}箇所(押せる版・押せない版の2つ)`);
      // 呼び出し側: 計測タブだけが渡す。行き先はテンポ拍子シート。
      const mv = code.slice(code.indexOf("function MeasureView"));
      check("F-91: 計測タブは onOpenSheet でテンポ拍子シートを開く",
        /onOpenSheet=\{\(\) => setTempoSheetOpen\(true\)\}/.test(mv));
      check("F-91: テンポ数値(♩=n)からの入口も残っている",
        /aria-label="テンポと拍子" aria-expanded=\{tempoSheetOpen\}/.test(mv));
    }

    // 【審査の穴だった箇所】●の寸法と間隔を縛る検査が1件も無く、
    // METRO_BEAT_GAP_PX を 12→4 にする変異が生存していた。正典の実寸を値で縛る。
    check("●の直径は正典 .beat の 7px", api.METRO_BEAT_DOT_PX === 7, String(api.METRO_BEAT_DOT_PX));
    check("●の間隔は正典 .beatrow の gap 12px", api.METRO_BEAT_GAP_PX === 12, String(api.METRO_BEAT_GAP_PX));
    check("往復する点の半径は正典 .pend の circle r=5", api.METRO_DOT_R === 5, String(api.METRO_DOT_R));
    check("ガイドの弧は正典 .pend の svg 150×26", api.METRO_ARC_W === 150 && api.METRO_ARC_H === 26,
      `${api.METRO_ARC_W}×${api.METRO_ARC_H}`);
    check("ガイドの弧の制御点は正典の M10 8 Q75 30 140 8",
      JSON.stringify([api.METRO_ARC_P0, api.METRO_ARC_C, api.METRO_ARC_P2]) === JSON.stringify([[10, 8], [75, 30], [140, 8]]),
      JSON.stringify([api.METRO_ARC_P0, api.METRO_ARC_C, api.METRO_ARC_P2]));
    check("ガイドの線幅は正典の 1.5", api.METRO_ARC_SW === 1.5, String(api.METRO_ARC_SW));
    // 値だけでなく**実際にその値から描いている**ことも見る(定数だけ正しくて描画は別、を防ぐ)。
    check("●の間隔は metroBeatDotX / metroBeatRowW が METRO_BEAT_GAP_PX から導く",
      /i \* \(METRO_BEAT_DOT_PX \+ METRO_BEAT_GAP_PX\)/.test(code)
      && /n \* METRO_BEAT_DOT_PX \+ \(n - 1\) \* METRO_BEAT_GAP_PX/.test(code));
    check("隣り合う●の中心間距離は 直径7 + 間隔12 = 19",
      api.metroBeatDotX(1, 4) - api.metroBeatDotX(0, 4) === 19,
      String(api.metroBeatDotX(1, 4) - api.metroBeatDotX(0, 4)));

    // --- 【F-95a】メトロノーム一式を 1.2 倍(本人が選んだ B) --------------------
    // 本人指示(実機 2026/08/16)「メトロノームはB」。B は統括が作った比較サンプル
    // design/metro-size-sample.html の B 列で、正典 .pend 一式を丸ごと 1.20 倍したもの。
    //
    // 【期待値の出どころ】倍率をこのファイルに写すと、実装と一緒に書き換える変異が通る
    // (design/LOOP.md「定数の定義を同じ式で書き直す」)。だから
    //   ・倍率は **本人が選んだサンプルの B 列の --k** から読む
    //   ・基準値は **正典 north-star-measure.html の該当宣言** から読む
    // の2つとも App.jsx の外から取る。実寸はその積と突き合わせる。
    {
      const sample = readFileSync(join(__dirname, "..", "design", "metro-size-sample.html"), "utf8");
      const iB = sample.indexOf('<span class="n">B ');
      check("比較サンプルの B 列を綴りで特定できている", iB !== -1);
      const bTag = iB === -1 ? "" : sample.slice(iB, iB + 260);
      // 取り違え防止: B 列が「推し」の印を持つ列であること(本人が選んだのはこの列)。
      check("B 列は「推し」の印が付いた列(本人が選んだ列を取り違えていない)",
        /<span class="rec">推し<\/span>/.test(bTag), bTag.slice(0, 120));
      const mK = /<div class="phone" style="--k:([\d.]+)">/.exec(bTag);
      check("B 列の倍率(--k)を読めている", mK !== null, mK ? mK[1] : "読めない");
      const kB = mK ? parseFloat(mK[1]) : NaN;
      check(`拡大率はサンプル B の --k と一致する(${kB})`, api.METRO_SCALE === kB,
        `実装=${api.METRO_SCALE} / サンプルB=${kB}`);

      // 正典の該当宣言を読む(このファイルに値を写さない)。
      const mockPend = readFileSync(join(__dirname, "..", "design", "north-star-measure.html"), "utf8");
      const mockStyle = (mockPend.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1];
      const mockDeclOf = (sel, name) => {
        const rule = new RegExp(`(?:^|[};])\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(mockStyle);
        if (!rule) return null;
        const d = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(rule[1]);
        return d ? d[1].trim() : null;
      };
      // 正典の .pend の中身(svg の実寸と ± を並べる行の gap はインラインで書かれている)
      const iPend = mockPend.indexOf('<div class="pend">');
      const iRecwrap = mockPend.indexOf('class="recwrap"', iPend);
      const pendBlock = iPend === -1 ? "" : mockPend.slice(iPend, iRecwrap === -1 ? iPend + 1000 : iRecwrap);
      const mSvg = /<svg width="(\d+)" height="(\d+)"/.exec(pendBlock);
      const mGap = /display:flex;align-items:center;gap:(\d+)px/.exec(pendBlock);
      check("正典 .pend の svg 実寸と ± 行の gap を読めている", mSvg !== null && mGap !== null,
        `${mSvg ? mSvg.slice(1, 3).join("×") : "?"} / gap ${mGap ? mGap[1] : "?"}`);

      // (a) 基準値は正典のまま1つも動かしていない
      const base = [
        ["振り子の幅", api.METRO_ARC_W, mSvg && parseFloat(mSvg[1])],
        ["振り子の高さ", api.METRO_ARC_H, mSvg && parseFloat(mSvg[2])],
        ["●の直径", api.METRO_BEAT_DOT_PX, parseFloat(mockDeclOf(".beat", "width"))],
        ["●の間隔", api.METRO_BEAT_GAP_PX, parseFloat(mockDeclOf(".beatrow", "gap"))],
        ["±の反応領域の幅", api.METRO_PM_W, parseFloat(mockDeclOf(".pmt", "width"))],
        ["±の反応領域の高さ", api.METRO_PM_H, parseFloat(mockDeclOf(".pmt", "height"))],
        ["±の文字", api.METRO_PM_FS, parseFloat(mockDeclOf(".pmt", "font-size"))],
        ["テンポの文字", api.METRO_BPM_FS, parseFloat(mockDeclOf(".bpmtxt", "font-size"))],
        ["拍子の文字", api.METRO_TSIG_FS, parseFloat(mockDeclOf(".tsig", "font-size"))],
        ["±行の間隔", api.METRO_PM_GAP, mGap && parseFloat(mGap[1])],
      ];
      for (const [label, impl, canon] of base) {
        check(`F-95a: 基準値は正典のまま: ${label}`, Number.isFinite(canon) && impl === canon,
          `実装=${impl} / 正典=${canon}`);
      }
      // (b) 画面に出る実寸は「正典の基準値 × B の倍率」
      const drawn = [
        ["振り子の幅", api.METRO_ARC_W_CSS, mSvg && parseFloat(mSvg[1])],
        ["振り子の高さ", api.METRO_ARC_H_CSS, mSvg && parseFloat(mSvg[2])],
        ["±の反応領域の幅", api.METRO_PM_W_CSS, parseFloat(mockDeclOf(".pmt", "width"))],
        ["±の反応領域の高さ", api.METRO_PM_H_CSS, parseFloat(mockDeclOf(".pmt", "height"))],
        ["±の文字", api.METRO_PM_FS_CSS, parseFloat(mockDeclOf(".pmt", "font-size"))],
        ["テンポの文字", api.METRO_BPM_FS_CSS, parseFloat(mockDeclOf(".bpmtxt", "font-size"))],
        ["拍子の文字", api.METRO_TSIG_FS_CSS, parseFloat(mockDeclOf(".tsig", "font-size"))],
        ["±行の間隔", api.METRO_PM_GAP_CSS, mGap && parseFloat(mGap[1])],
      ];
      for (const [label, impl, canon] of drawn) {
        check(`F-95a: 画面の実寸 = 正典 × B の倍率: ${label}`,
          Number.isFinite(canon) && Math.abs(impl - canon * kB) < 1e-9,
          `実装=${impl} / 期待=${canon * kB}`);
      }
      // (b') 行の高さだけは正典に対応する宣言が無い(●の最大直径から決めた実装側の箱)。
      // 【審査②の指摘】ここだけ値の検査が無く、`= METRO_BEAT_ROW_H` / `* 1.1` / `* 2` /
      // `+ 0.0001` の**4種類とも生存**していた。綴りの検査は定義側の変異を通す。
      // 【なぜ効くか】svg は viewBox を一様スケールで拡大するので、倍率は縦横の**小さいほう**が
      // 採られる。行の高さだけ 1.0 のままだと min(1.2, 1.0)=1.0 になり、
      // 幅が 76.8 でも**●は 8.4px ではなく 7px(拡大前)に戻る**。
      check("F-95a: ●列の行の高さも B の倍率で伸びる(ここが 1.0 だと●が拡大前に戻る)",
        Math.abs(api.METRO_BEAT_ROW_H_CSS - api.METRO_BEAT_ROW_H * kB) < 1e-9,
        `実装=${api.METRO_BEAT_ROW_H_CSS} / 期待=${api.METRO_BEAT_ROW_H * kB}`);
      check("F-95a: ●列の svg は縦横が同じ倍率(一様スケール = ●が正しい大きさで出る条件)",
        api.METRO_BEAT_ROW_H_CSS / api.METRO_BEAT_ROW_H === api.METRO_ARC_W_CSS / api.METRO_ARC_W,
        `縦 ${api.METRO_BEAT_ROW_H_CSS / api.METRO_BEAT_ROW_H} / 横 ${api.METRO_ARC_W_CSS / api.METRO_ARC_W}`);
      // (c) ●列の実寸も同じ倍率で伸びる(拍子の位置がここから決まるため)
      check("F-95a: ●列の実寸は viewBox 幅の METRO_SCALE 倍",
        /const rowWCss = rowW \* METRO_SCALE;/.test(code));
      // (d) svg は viewBox を正典の単位のまま残す = 弧の幾何と物理は1行も変わらない。
      //     ここが崩れると METRO_ARC_P0/C/P2・metroArcPoint の意味が変わる。
      check("F-95a: 振り子の svg は実寸だけ拡大し viewBox は正典のまま",
        /width=\{METRO_ARC_W_CSS\} height=\{METRO_ARC_H_CSS\} viewBox=\{`0 0 \$\{METRO_ARC_W\} \$\{METRO_ARC_H\}`\}/.test(mp));
      check("F-95a: ●列の svg も実寸だけ拡大し viewBox は正典の単位のまま",
        /width=\{rowWCss\} height=\{METRO_BEAT_ROW_H_CSS\} viewBox=\{`0 0 \$\{rowW\} \$\{METRO_BEAT_ROW_H\}`\}/.test(mp));
      // (e) 縦の間隔も同じ倍率で開く(サンプルは .pend の gap も --k 倍している)
      check("F-95a: 縦の間隔も METRO_SCALE 倍で開く(振り子〜●〜テンポ行)",
        (code.match(/gap: `calc\(var\(--sp-2\) \* \$\{METRO_SCALE\}\)`/g) || []).length === 2,
        `${(code.match(/gap: `calc\(var\(--sp-2\) \* \$\{METRO_SCALE\}\)`/g) || []).length}箇所`);
      // (f) 拡大の対象は計測タブのメトロノームだけ。リード追加シートの ± は基準値のまま
      //     (METRO_PM_W を共有しているので、拡大を基準値側に入れると巻き添えになる)。
      check("F-95a: リード追加シートの ± は拡大していない(基準値 METRO_PM_W のまま)",
        /width: METRO_PM_W, height: "var\(--tap-min\)"/.test(srcOfFn(src, "ReedBoxSheet")));

      // --- 【F-95b】拍の瞬間の膨らみを大きく ------------------------------------
      // 本人指示「振り子が端に触れるときの大きくなるのも今よりも大きくして」。
      // 正典 .beat.on は scale(1.4)。**正典を意図的に超えている**ことを、正典の側から確認する。
      const mOn = /scale\(([\d.]+)\)/.exec(mockDeclOf(".beat.on", "transform") || "");
      check("正典 .beat.on の倍率を読めている", mOn !== null, mOn ? mOn[1] : "読めない");
      const canonScale = mOn ? parseFloat(mOn[1]) : NaN;
      check("F-95b: 膨らみの倍率は 1.8(本人指示で正典 .beat.on を上書き)",
        api.METRO_DOT_HEAD_SCALE === 1.8, String(api.METRO_DOT_HEAD_SCALE));
      check(`F-95b: 正典(${canonScale})より大きい = 「今よりも大きく」を満たす`,
        api.METRO_DOT_HEAD_SCALE > canonScale, `実装=${api.METRO_DOT_HEAD_SCALE} / 正典=${canonScale}`);
      // 1つの定数が2箇所(振り子の点・拍の●)を動かすこと。片方だけ据え置く変異を殺す。
      // 【名前を実際の検証範囲に合わせる】ここで見ているのは**純関数の戻り値**だけで、
      // 画面が膨らむかは見ていない(それは下の「描画側が拍の瞬間を渡す」で見る)。
      check("F-95b: metroDotR の返す最大の半径は基準の 1.8 倍(戻り値のみ)",
        api.metroDotR(true, 1) === api.METRO_DOT_R * 1.8,
        `${api.metroDotR(true, 1)} / 期待 ${api.METRO_DOT_R * 1.8}`);
      check("F-95b: metroBeatDotR の返す半径は今の拍だけ 1.8 倍(戻り値のみ)",
        api.metroBeatDotR(true) / api.metroBeatDotR(false) === 1.8,
        `${api.metroBeatDotR(true)} / ${api.metroBeatDotR(false)}`);

      // 【審査②の指摘】上の2件は戻り値しか見ておらず、**描画側が定数を書き込む形に
      // 書き換えても緑のまま**だった(`dot.setAttribute("r", METRO_DOT_R.toFixed(2))` /
      // `metroBeatDotR(false)` のどちらも生存)。つまり F-95b の成果物そのものが
      // 緑のまま消せた。rAF ループは評価できないので、**描画文を綴りで固定する**。
      // 引数が「拍の瞬間」を運んでいることまで、変数の出どころを辿って見る。
      {
        const loop = mp.slice(mp.indexOf("const loop = ()"), mp.indexOf("raf = requestAnimationFrame(loop);"));
        check("F-95b: 振り子の点の r は毎フレーム metroDotR(小節頭か, 拍の演出) から書く",
          /dot\.setAttribute\("r", metroDotR\(isHead, e\)\.toFixed\(2\)\);/.test(loop), loop.length + "字");
        check("F-95b: 拍の●の r は毎フレーム metroBeatDotR(今の拍か) から書く",
          /d\.setAttribute\("r", metroBeatDotR\(isCur\)\.toFixed\(2\)\);/.test(loop));
        // 渡している引数が本当に「拍の瞬間」か(定数 true/false や固定値に化けていないか)。
        check("F-95b: 小節頭かは位相から求める(ringBeatIsHead)",
          /const isHead = ringBeatIsHead\(phase, beatsPerMeasure, accentOn\);/.test(loop));
        check("F-95b: 拍の演出の強さは位相から求める(ringBeatEmphasis。減速設定のときだけ 0)",
          /const e = reduceMotion\.matches \? 0 : ringBeatEmphasis\(phase, beatsPerMeasure, accentOn\);/.test(loop));
        check("F-95b: 今の拍かは位相から求める(ringBeatIndex と突き合わせる)",
          /const cur = ringBeatIndex\(phase, beatsPerMeasure\);/.test(loop) && /const isCur = cur === i;/.test(loop));
        // 半径を書き込む文を**集合で**縛る: loop 内の `setAttribute("r"` の全出現が、
        // 正典の2つの綴り(metroDotR / metroBeatDotR 経由)のいずれかであること。
        // 【審査で塞いだ穴・通算16回目】前版は「定数で書き込んでいない」と名乗りながら
        // 2つの定数**識別子**の直書きしか見ておらず、正しい描画文の直後に
        // `dot.setAttribute("r", "5.00")` を**追記**する変異(数値リテラル)が生存した
        // (毎フレーム上書きされ、錘は画面上一切膨らまないのに緑のまま)。
        // 集合制約なら追記も差し替えも落ちる。箇所数の釘付けではない(出現数は縛らない)。
        {
          // 文末(;)まで取る。`[^)]*)` だと引数の中の閉じ括弧で切れて正典の形と一致しない
          const rWrites = [...loop.matchAll(/setAttribute\("r",[^;]*;/g)].map((m) => m[0]);
          const CANON = [
            'setAttribute("r", metroDotR(isHead, e).toFixed(2));',
            'setAttribute("r", metroBeatDotR(isCur).toFixed(2));',
          ];
          const stray = rWrites.filter((w) => !CANON.includes(w));
          check("F-95b: r を書く文は正典の2形だけ(定数・数値リテラル・別の式での上書きを許さない)",
            rWrites.length >= 2 && stray.length === 0,
            stray.join(" | ") || `${rWrites.length}件すべて正典の形`);
        }
      }

      // 【F-95b で overflow: visible が実際に効き始めた】点は cy=8 / 最大 r=5×1.8=9 なので
      // 箱の上辺(y=0)を超える。1.4 の頃は r=7 で箱の中に収まっており宣言は飾りだった。
      // まず「超える」ことを幾何で確かめ、そのうえで宣言が両方の svg に在ることを見る。
      check("F-95b: 膨らんだ点は弧の箱の上辺を超える(overflow の宣言が飾りでなくなった)",
        api.METRO_DOT_R * api.METRO_DOT_HEAD_SCALE > api.METRO_ARC_P0[1],
        `最大半径 ${api.METRO_DOT_R * api.METRO_DOT_HEAD_SCALE} / 中心の高さ ${api.METRO_ARC_P0[1]}`);
      {
        const ov = (mp.match(/style=\{\{ display: "block", overflow: "visible", pointerEvents: "none" \}\}/g) || []).length;
        check("F-95b: 弧と●列の svg はどちらも overflow: visible(切ると膨らみの頭が切れる)",
          ov === 2, `${ov}箇所`);
      }
      // 膨らませても壊れない範囲であること(どちらも viewBox 単位なので拡大率に依らない)。
      check("F-95b: 膨らんだ●が隣の●と重ならない(中心間19 > 最大直径)",
        api.metroBeatDotX(1, 4) - api.metroBeatDotX(0, 4) > api.METRO_BEAT_DOT_PX * api.METRO_DOT_HEAD_SCALE,
        `中心間 ${api.metroBeatDotX(1, 4) - api.metroBeatDotX(0, 4)} / 最大直径 ${api.METRO_BEAT_DOT_PX * api.METRO_DOT_HEAD_SCALE}`);
      // App.jsx のコメントが「2.2 まで行を動かさずに上げられる」と約束しているので、
      // その約束自体を検査にする(約束だけ残って実際は入らない、を防ぐ)。
      check("F-95b: 2.2 まで上げても行の高さ(16)に収まる(コメントの約束の裏取り)",
        api.METRO_BEAT_ROW_H >= api.METRO_BEAT_DOT_PX * 2.2,
        `行 ${api.METRO_BEAT_ROW_H} / 2.2倍の直径 ${api.METRO_BEAT_DOT_PX * 2.2}`);
    }

    // 【審査⑤の修正】●の数が**拍子から導かれている**ことを固定する。
    // 審査役が metroBeatsPerMeasure を 4 に固定する変異を当てたところ生存した
    // (=●の数が拍子と無関係になっても緑だった)。
    // (a) 導出式そのものを実ソースから取り出して評価する。
    {
      const m = /const metroBeatsPerMeasure = ([\s\S]*?);\r?\n/.exec(code);
      check("●の数の導出式を実ソースから取れている", m !== null);
      const beatsOf = (sig, grouping) => {
        const { num, den } = api.parseMetroSig(sig);
        return new Function("metroSigDen", "metroSigNum", "metroGrouping", "metroBeatGroups",
          `return (${m ? m[1] : "null"});`)(den, num, grouping, api.metroBeatGroups);
      };
      // X/4 は分子そのもの。**拍子ごとに違う値が返る**ことを1つずつ確かめる。
      for (const [sig, n] of [["1/4", 1], ["2/4", 2], ["3/4", 3], ["4/4", 4], ["5/4", 5], ["6/4", 6]]) {
        check(`●の数(${sig}) = ${n}`, beatsOf(sig, null) === n, String(beatsOf(sig, null)));
      }
      // X/8 は主拍(グループ)の数。3/8→1 / 6/8→2 / 9/8→3 / 12/8→4 / 5/8→2 / 7/8→3。
      for (const [sig, n] of [["3/8", 1], ["6/8", 2], ["9/8", 3], ["12/8", 4], ["5/8", 2], ["7/8", 3]]) {
        check(`●の数(${sig}) = ${n}(主拍の数)`, beatsOf(sig, null) === n, String(beatsOf(sig, null)));
      }
      // 5/8 のグループ選択が変わっても主拍の数は 2 のまま(合計が分子と合う選択だけ効く)
      check("●の数(5/8・グループ [2,3]) = 2", beatsOf("5/8", [2, 3]) === 2, String(beatsOf("5/8", [2, 3])));
      // 合計が分子と合わない不正なグループは自動(metroBeatGroups)に落ちる
      check("●の数(7/8・不正なグループ [9]) は自動に落ちて 3", beatsOf("7/8", [9]) === 3, String(beatsOf("7/8", [9])));
      // 定数に潰されていないこと: 12種すべてで同じ値にならない
      const all = ["1/4", "2/4", "3/4", "4/4", "5/4", "6/4", "3/8", "5/8", "6/8", "7/8", "9/8", "12/8"].map((sg) => beatsOf(sg, null));
      check("●の数は拍子ごとに変わる(定数に潰されていない)", new Set(all).size >= 5, all.join(","));
    }
    // (b) その値が実際に MetroPendulum へ渡っていること(導出だけあって使われていない、を防ぐ)
    check("●の数は metroBeatsPerMeasure を MetroPendulum に渡して決まる",
      /<MetroPendulum[\s\S]{0,240}?beatsPerMeasure=\{metroBeatsPerMeasure\}/.test(code));
    // (c) MetroPendulum の中で、●の数が beatsPerMeasure そのものであること
    check("MetroPendulum は beatsPerMeasure の数だけ●を描く",
      /const n = beatsPerMeasure > 0 \? beatsPerMeasure : 0;/.test(mp)
      && /Array\.from\(\{ length: n \}\)\.map\(\(_, i\) => \(/.test(mp));
  }

  // --- 24.7 録音中は周辺だけ淡くする ------------------------------------------
  // 正典「演奏中」: 上部設定行と下部タブが opacity .35。**環・音名・折れ線は淡くしない**。
  {
    const dims = [...code.matchAll(/opacity: isRecording \? ([0-9.]+) : 1/g)].map((m) => Number(m[1]));
    check("録音中に淡くする箇所は2つ(上部設定行と下部タブ)だけ", dims.length === 2, `${dims.length}箇所: ${dims.join(",")}`);
    check("淡さは正典の .35", dims.every((d) => d === 0.35), dims.join(","));
    // 環・音名・折れ線が淡さの中に入っていないこと = PitchRing / PitchDeviationLine を
    // 呼ぶ行が opacity を持つ祖先の中に無いこと。綴りで直に確かめる。
    check("環(PitchRing)は淡くしない", /<div style=\{\{ flexShrink: 0 \}\}>\s*<PitchRing/.test(code));
    check("折れ線(PitchDeviationLine)は淡くしない",
      /\{!showMetroPanel && \(\s*<div style=\{\{ marginTop: 6 \}\}>\s*<PitchDeviationLine/.test(code));
    // 淡くするだけで無効化はしない(メトロノームは録音中も押せる)。
    const mi = code.indexOf('aria-label="メトロノーム"');
    const mtag = mi === -1 ? "" : code.slice(code.lastIndexOf("<button", mi), code.indexOf(">", mi) + 1);
    check("メトロノームのボタンは録音中も disabled にしない(淡くするだけ)",
      mtag !== "" && !/disabled/.test(mtag), mtag.replace(/\s+/g, " ").slice(0, 160));
    // 下部タブ側で二重に掛けていない(0.35 × 0.4 = 0.14 になる)
    check("下部タブの淡さは帯に1回だけ(ボタン側で二重に掛けない)",
      !/opacity: isRecording && !active/.test(code));
  }

  // --- 24.8 アップロードはデータタブで完結する --------------------------------
  {
    const mv = code.slice(code.indexOf("function MeasureView(props)"), code.indexOf("function PhraseTimeline"));
    // 【N-6】データタブ側は AnalysisLabView(告知の浮き)と MyDataPage(入口のボタン)の
    // 2関数に分かれた。**ファイル順に依存する切り出しをやめ**、関数の集合で走査する。
    const dv = ["AnalysisLabView", "MyDataPage"]
      .map((n) => codeSafe.slice(codeSafe.indexOf(`function ${n}(`), codeSafe.indexOf("\n}\n", codeSafe.indexOf(`function ${n}(`)) + 3))
      .join("\n");
    check("データタブの2関数(AnalysisLabView / MyDataPage)を走査できている",
      dv.includes("function AnalysisLabView(") && dv.includes("function MyDataPage(") && dv.length > 8000,
      `${dv.length}文字`);
    // (a) 計測タブから消えている。**綴りではなく「到達経路」で見る**:
    //     ファイル入力・アップロードの呼び出し・進捗・完了通知のどれも無いこと。
    for (const [label, re] of [
      ["隠しファイル入力", /type="file"/],
      ["アップロードの実行", /handleUploadFile/],
      ["解析の進捗", /uploadProgress/],
      ["完了通知", /lastUploadedSession/],
      ["自動再生ブロック時の再開", /uploadNeedsTap/],
    ]) {
      check(`計測タブにアップロードの${label}が残っていない`, !re.test(mv), (mv.match(re) || [""])[0]);
    }
    // (b) データタブに全部ある。
    for (const [label, re] of [
      ["隠しファイル入力", /type="file" accept="audio\/\*,video\/\*"/],
      ["アップロードの実行", /handleUploadFile\(f\)/],
      ["解析の進捗バー", /Math\.round\(uploadProgress \* 100\)/],
      // 【N-6】文言は正典 mini の「解析が完了しました」(告知はデータタブ上端にしか出ないので
      // 「アップロードの」は言わなくても通じる。本人指示「長い説明文を書くな」)
      ["完了通知", /解析が完了しました/],
      ["「★ 目安に設定」", /<SetAsIdealButton tapMin session=\{lastUploadedSession\}/],
      ["自動再生ブロック時の「解析を開始」", /解析を開始/],
    ]) {
      check(`データタブにアップロードの${label}がある`, re.test(dv), "");
    }
    // (c) 見出しの右の**塗り**ボタン(フィルタピルは輪郭のみ。§6.0 の形言語)
    const bi = dv.indexOf("録音をアップロード");
    const btag = bi === -1 ? "" : dv.slice(dv.lastIndexOf("<button", bi), dv.indexOf(">", bi) + 1);
    check("データタブのアップロードは塗りボタン(--c-accent 地 + --c-on-accent 文字)",
      /background: "var\(--c-accent\)", color: "var\(--c-on-accent\)"/.test(btag), btag.replace(/\s+/g, " ").slice(0, 200));
    check("データタブのアップロードボタンのタップ領域は --tap-min 以上",
      /minHeight: "var\(--tap-min\)"/.test(btag), btag.replace(/\s+/g, " ").slice(0, 200));
    // 【N-6】見出しは正典 .shead の「セッション 5/12」。同じ行(.shead)の中に居ることを、
    // 見出しの綴りとボタンの距離で見る(行の中に収まる長さに上限を置く)。
    {
      // **距離ではなく構造で見る**: 見出しの箱が閉じたあと、**新しい箱を開かずに**ボタンが来る
      // = 2つは同じ容器(正典 .shead の行)の直下にいる。
      // 箱を1つでも挟めば(=別の行へ動かせば)ここが落ちる。
      const hi = dv.indexOf("セッション <span");
      const btnStart = bi === -1 ? -1 : dv.lastIndexOf("<button", bi);
      const headClose = hi === -1 ? -1 : dv.indexOf("</div>", hi);
      const between = hi !== -1 && headClose !== -1 && btnStart > headClose
        ? dv.slice(headClose, btnStart) : null;
      check("アップロードは「セッション」の見出しと同じ容器(.shead の行)にいる",
        between !== null && !/<div\b/.test(between),
        between === null ? `見出し ${hi} / ボタン ${btnStart}` : (between.match(/<div\b/g) || []).join(","));
    }
    // (d) エラー(無音ファイル等)の出口がデータタブでも開いている。
    //     ここを計測タブ限定に戻すと、アップロードのエラーが誰にも見えなくなる。
    // 【審査②の修正】タブで広げるのではなく、**メッセージの種類**で出し分ける。
    // MIC_RECOVER_FAILED_MSG は「画面をタップしてください」と指示するが、その指示に応える
    // ジェスチャー経路は計測タブ限定なので、データタブで出すと嘘の案内になる。
    check("エラーモーダルはデータタブでも出る(アップロードのエラーの出口)",
      /\{errorMsg && \(topTab === "measure" \|\| \(topTab === "analysis" && !ERROR_MEASURE_ONLY\.includes\(errorMsg\)\)\) && \(/.test(code));
    check("計測タブ限定の案内の集合(ERROR_MEASURE_ONLY)が定義されている",
      /const ERROR_MEASURE_ONLY = \[MIC_RECOVER_FAILED_MSG\];/.test(code));
    // 【本体】「画面をタップしてください」と指示するメッセージは、その指示が効くタブでしか出さない。
    // 出し分けの式とジェスチャー経路のタブ条件を**両方ソースから取り出して**突き合わせる
    // (どちらか片方を変えたら落ちる)。
    {
      const gesture = /const onGesture = \(\) => \{[\s\S]{0,400}?if \(topTab !== "([a-z]+)"/.exec(code);
      check("マイク復旧のジェスチャー経路が効くタブをソースから読めている", gesture !== null, gesture ? gesture[1] : "");
      const gestureTab = gesture ? gesture[1] : null;
      // 【この検査を一度書き直している】最初は条件式を**テスト側にコピーして**評価していた。
      // それは実装を1文字も見ておらず、実装をどう壊しても永久に通る
      // (LOOP.md が名指しで禁じている「構造上失敗し得ないアサーション」)。
      // **JSX の表示条件そのものをソースから取り出して**評価する。
      const condM = /\{errorMsg && \(([\s\S]*?)\) && \(\r?\n\s*<div\r?\n\s*role="dialog" aria-modal="true" aria-label="エラー"/.exec(code);
      check("エラーモーダルの表示条件をソースから取り出せている", condM !== null,
        condM ? condM[1] : "取り出せない");
      const shownOn = (tab, msg) => new Function("topTab", "errorMsg", "ERROR_MEASURE_ONLY",
        `return !!(errorMsg && (${condM ? condM[1] : "false"}));`
      )(tab, msg, ["MIC"]);
      check("「画面をタップしてください」の案内は、その指示が効くタブ(計測)でだけ出る",
        shownOn(gestureTab, "MIC") === true && shownOn("analysis", "MIC") === false,
        `計測=${shownOn(gestureTab, "MIC")} / データ=${shownOn("analysis", "MIC")}`);
      check("アップロード由来のエラー(無音ファイル等)はデータタブでも出る",
        shownOn("analysis", "この音声には音が入っていません") === true);
    }
  }

  // --- 24.9 D 細部 -------------------------------------------------------------
  {
    // 3連符は「3」の文字ではなく、旗をつないだ8分音符×3。
    const si = code.indexOf("function SubdivNoteIcon");
    const sub = si === -1 ? "" : code.slice(si, code.indexOf("function ", si + 10));
    check("3連符のアイコンに「3」の文字を書かない", !/<text/.test(sub), (sub.match(/<text[\s\S]{0,80}/) || [""])[0]);
    check("3連符は音符3つ + 桁1本(2つ・4つと数で区別できる)",
      /3: \{ n: 3, beams: 1 \}/.test(sub) && /2: \{ n: 2, beams: 1 \}/.test(sub) && /4: \{ n: 4, beams: 2 \}/.test(sub));
    // スクロールピッカーに見出しを出さない(正典)。
    const pi = code.indexOf("function ScrollPicker");
    const picker = pi === -1 ? "" : code.slice(pi, code.indexOf("function PitchDeviationLine"));
    check("スクロールピッカーは見出し(「基準ピッチ」等の label)を持たない",
      !/基準ピッチ/.test(picker) && !/<h[1-6]/.test(picker) && !/label=/.test(picker), "");
    check("スクロールピッカーを開く側も見出しを渡していない",
      !/<ScrollPicker[^>]*(title|heading|label)=/.test(code));
    // リード表記は V16-3 #4 が1つの塊として読める = 2つの select の間に隙間を作らない。
    // 【F-72 で綴りが変わった】枠から .ctl-plain(地)を外した。**主張は同じ**(gap 0 で
    // 箱と個体を隙間なく並べ、V16-3 #4 を1つの塊として読ませる)。
    check("リード表記は箱と個体を隙間なく並べる(V16-3 #4 を1つの塊として読ませる)",
      /<label htmlFor="measure-reed-box" style=\{\{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 0,/.test(code));
    check("リード表記の色は箱=--c-ink / 個体=--c-ink-2(--c-accent はアクション専用・§1.4)",
      /color: selectedReedId \? "var\(--c-ink\)" : "#435266"/.test(code) &&
      /color: selectedReedId \? "var\(--c-ink-2\)" : "#C3CAD3"/.test(code));
    // 詳細カードは下端のシェブロンで開閉(現行踏襲)。
    check("詳細カードはシェブロンのトグルで開閉する", /aria-expanded=\{detailOpen\}/.test(code));
  }

  // --- 24.9b 【N-4c】正典の実寸に戻した箇所 -------------------------------------
  // DESIGN-SYSTEM §6.0(2026/08/12 本人確定): 見た目についてはモックが唯一の正典。
  // §6.7 の A型/B型・§6.1 の 12px 禁止・§4.1 の7段スケール・§2/§3 のスケールは
  // モックに対する制約として機能しない。ここは「モックの実寸がそのまま入っていること」を見る。
  {
    // 音名まわり(正典 .note / .note .oct / .cents)
    check("音名は正典 .note の 148px", /const NOTE_FS_PX = 148;/.test(code) && /const noteFs = NOTE_FS_PX;/.test(code));
    check("オクターブ数字は正典 .note .oct の 44px",
      /const NOTE_OCT_PX = 44;/.test(code) && /fontSize: NOTE_OCT_PX, color: "var\(--c-accent-dim\)"/.test(code));
    check("セント値は正典 .cents の 21px / margin-top 10",
      /const NOTE_CENTS_PX = 21;/.test(code) && /const NOTE_CENTS_GAP_PX = 10;/.test(code)
      && /marginTop: NOTE_CENTS_GAP_PX, width: "100%", height: NOTE_CENTS_PX \+ 4/.test(code));
    check("音名の行送りは正典 .note の line-height:1", /const NOTE_LINE_H = 1;/.test(code));
    // 環の直径に比例させる旧方式(NOTE_FS_RATIO / NOTE_OCT_RATIO)は使っていない
    check("音名のサイズは比ではなく実寸(NOTE_FS_RATIO / NOTE_OCT_RATIO が残っていない)",
      !/NOTE_FS_RATIO|NOTE_OCT_RATIO/.test(code), (code.match(/NOTE_[A-Z_]*RATIO/g) || []).join(" "));
    // 【F-77 で主張が反転した】横幅の引き伸ばし(§4.2 の scaleX 1.30)。
    //   旧主張: 掛けない(理由は「正典 .note が transform を持たない」= DESIGN-SYSTEM §6.0)
    //   新主張: **掛ける。** 本人が実機で見て「細いのでいったん引き伸ばし継続」と決めた
    //           (2026/08/12)。本人の直接指示は正典より上位。
    // **この検査が縛るのは「音名の本体に scaleX(NOTE_SCALE_X) が掛かっている」という構造だけ。
    //   環の内周とのクリアランスは縛っていない**(Node に書体の字幅が無く計算できない)。
    //   実測値は App.jsx の定数の直上と BACKLOG の F-77 完了記録に書いてある。
    //   **書いていない検査を「縛っている」と書かないこと**(LOOP.md / F-39)。
    check("F-77: 音名の横幅の倍率は §4.2 の 1.30", /const NOTE_SCALE_X = 1\.30;/.test(code),
      (code.match(/const NOTE_SCALE_X = [0-9.]+/) || ["無し"])[0]);
    // 逃げの余白は「送り幅 0.457em の (倍率-1)/2」。**倍率から導いている**ことを式で見る
    // (定数を直書きに変えると、倍率を変えたときに余白だけ取り残される)。
    check("F-77: scaleX の逃げの余白は倍率から導く(送り幅 0.457em × (倍率-1)/2)",
      /const NOTE_SCALE_PAD_EM = 0\.457 \* \(NOTE_SCALE_X - 1\) \/ 2;/.test(code),
      (code.match(/const NOTE_SCALE_PAD_EM = [^;]*/) || ["無し"])[0]);
    check("F-77: 音名の本体に scaleX が掛かっている(transform-origin は center bottom)",
      /transform: `scaleX\(\$\{NOTE_SCALE_X\}\)`, transformOrigin: "center bottom"/.test(code));
    check("F-77: 逃げの余白が実際に左右 margin として使われている",
      /margin: `0 \$\{NOTE_SCALE_PAD_EM\}em`/.test(code));
    // 臨時記号には掛けない(§4.2「横幅の指定は本体だけに掛け、記号には掛けない」)。
    {
      const accTag = (code.match(/<span style=\{\{ fontSize: noteFs \* NOTE_ACC_RATIO \}\}>/) || [""])[0];
      check("F-77: 臨時記号(♯/♭)には scaleX を掛けない(本体だけ)",
        accTag !== "" && !/transform/.test(accTag), accTag || "臨時記号の span が見つからない");
    }
    // オクターブ数字にも掛けない
    check("F-77: オクターブ数字にも scaleX を掛けない",
      !/fontSize: NOTE_OCT_PX[^}]*transform/.test(code));

    // シート(正典 .sheet / .handle / .bpmrow / .pm / .bpmbig)
    check("シートの角丸は正典 .sheet の 28px", /borderRadius: "28px 28px 0 0"/.test(sheet));
    check("シートの padding は正典 .sheet の 14px 24px 40px(下端だけ安全域を足す)",
      /padding: "14px 24px",/.test(sheet) && /paddingBottom: "calc\(40px \+ env\(safe-area-inset-bottom\)\)"/.test(sheet));
    // 【変異試験で穴が見つかって直した】以前は /marginBottom: 12,/ を sheet 全体に当てていたが、
    // 小節アクセントの行が同じ綴り(marginTop: 14 の隣)を持っていたため、
    // **つまみから marginBottom を消しても他所の一致で通ってしまった**(SURVIVE)。
    // つまみのタグに限定して見る。
    check("つまみは正典 .handle の 36×4 / 下マージン 12",
      /aria-label="閉じる"[\s\S]{0,220}?height: "var\(--tap-min\)", marginBottom: 12,/.test(sheet)
      && /width: 36, height: 4, borderRadius: 2/.test(sheet),
      (sheet.match(/aria-label="閉じる"[\s\S]{0,220}/) || [""])[0].replace(/\s+/g, " ").slice(0, 200));
    check("大きな ± の行の gap は正典 .bpmrow の 30", /justifyContent: "center", gap: 30 \}\}/.test(sheet));
    {
      const pm = (sheet.match(/width: 62, height: 62, borderRadius: "50%", border: "1\.5px solid var\(--c-line-strong\)", background: "transparent"[^}]*fontSize: 28, fontWeight: 300/g) || []).length;
      check("シートの ± は正典 .pm(62×62 の円 / 1.5px の輪郭 / 28px / weight 300)", pm === 2, `${pm}個`);
    }
    check("シートの数値は正典 .bpmbig の 76px",
      (sheet.match(/fontSize: 76, fontWeight: 600/g) || []).length === 2, "表示と直接入力の2箇所");

    // 分割・拍グループのピルも拍子と同じ塗り(正典 .selpill / .selpill.on)
    check("分割のピルは選択中が塗り(正典 .selpill.on)",
      /border: selected \? "1px solid transparent" : "1px solid var\(--c-line-strong\)"/.test(sheet)
      && /background: selected \? "var\(--c-accent\)" : "transparent"/.test(sheet));
    check("分割の選択中は音符が白抜きになる(塗りの上に乗るので)",
      /color=\{selected \? "#FFFFFF" : "#435266"\}/.test(sheet));
    // 選択中のピルが「枠と違う地」を同時に持たないこと(描画は正典と同一・構造だけ保つ)
    check("選択中のピルの枠は transparent(描画は正典と同一・枠と地を両方持たない構造を保つ)",
      (sheet.match(/"1px solid transparent"/g) || []).length >= 3, "拍子 / 分割 / 拍グループ");
  }

  // --- 24.9c 【F-76】選択中の目安をタップすると選択を解除する --------------------
  // 本人指示(2026/08/12・実機)「選択中のものを解除するには他の目安をタップするか
  // 削除するしか今は選択肢がない。選択中の目安をタップで目安設定を解除できるように」。
  // 【縛り方】綴りの一致では中身を変えられるので、**実ソースの更新関数そのものを取り出して
  // 評価する**(24.2 / 24.3 と同じ方式)。期待値は仕様(選択 / 解除 / 乗り換え)から立て、
  // テスト内で定義した値をテスト内で検算する形にはしない。
  {
    const m = /onClick=\{\(\) => setSelectedIdealId\((\(cur\) => \([\s\S]*?\))\)\}/.exec(code);
    check("F-76: 目安の行の更新関数を実ソースから取れている", m !== null, m ? m[1] : "取れない");
    // p は行のプロファイル。更新関数は「今の選択 cur」を受け取って次の選択を返す。
    const next = (cur, pid) => new Function("p", `return (${m ? m[1] : "() => null"});`)({ id: pid })(cur);
    check("F-76: 未選択の状態で行をタップすると、その行が選択される",
      next(null, "A") === "A", String(next(null, "A")));
    check("F-76: 選択中の行をもう一度タップすると解除される(null に戻る)",
      next("A", "A") === null, String(next("A", "A")));
    check("F-76: 別の行をタップしたときは解除ではなく乗り換え(従来の挙動を壊さない)",
      next("B", "A") === "A", String(next("B", "A")));
    // 解除後は「目安未設定」の表示に戻る = selectedIdeal / currentNoteIdeal が null になり、
    // 比較の破線と「目安: n」が消える。**表示側に分岐を足していない**ことを綴りで確かめる
    // (selectedIdealId から selectedIdeal を引く1本道が保たれていること)。
    check("F-76: 解除は selectedIdeal を null にすることで表示に伝わる(表示側に分岐を足さない)",
      /const selectedIdeal = idealProfiles\.find\(\(p\) => p\.id === selectedIdealId\) \|\| null;/.test(code));
    check("F-76: 「目安: n」は selectedIdeal が無ければ(未選択)に落ちる",
      /目安\{selectedIdeal \? `: \$\{selectedIdeal\.name\}` : "\(未選択\)"\}/.test(code));
    check("F-76: 比較の破線は目安が無ければ出ない(showIdealBar が currentNoteIdeal を要求する)",
      /const showIdealBar = showIdeal && currentNoteIdeal && !!idealHarmonic;/.test(code));
    // 削除(ゴミ箱)の挙動は変えていない。行の onClick へ伝播させない stopPropagation が要る
    // (無いと、削除したつもりで選択トグルまで走る)。
    check("F-76: 削除ボタンは行のタップへ伝播しない(削除の挙動は変えていない)",
      /onClick=\{\(e\) => \{ e\.stopPropagation\(\); deleteIdealProfile\(p\.id\); \}\}/.test(code));
    check("F-76: 選択中の目安を削除したときは従来どおり選択も外れる",
      /if \(selectedIdealId === id\) setSelectedIdealId\(null\);/.test(code));
  }

  // --- 24.10 経過時間の書式 ----------------------------------------------------
  {
    check("経過時間は m:ss(秒は2桁ゼロ埋め)",
      api.formatElapsedMs(0) === "0:00" && api.formatElapsedMs(5000) === "0:05"
      && api.formatElapsedMs(84000) === "1:24" && api.formatElapsedMs(600000) === "10:00",
      `${api.formatElapsedMs(84000)}`);
    check("経過時間は60分を超えても切らない", api.formatElapsedMs(3600000) === "60:00", api.formatElapsedMs(3600000));
    check("経過時間は負値・非数を 0:00 に落とす",
      api.formatElapsedMs(-1) === "0:00" && api.formatElapsedMs(NaN) === "0:00" && api.formatElapsedMs(undefined) === "0:00");
    check("経過時間は切り捨て(999ms は 0:00、1000ms で 0:01)",
      api.formatElapsedMs(999) === "0:00" && api.formatElapsedMs(1000) === "0:01");
  }
  console.log("  -> done");
}

// ============================================================
// 検証25: N-5 リードタブを正典どおりにする
//   A 登録一覧(箱見出し + 5×2タイル + 「＋ 追加」1つ)
//   B 追加シート(銘柄・番手・枚数。window.prompt 廃止)
//   C タイルの長押しドラッグ並び替え
//   D 「…」の削除モードと開封日の編集
//   E 個体詳細(#自由入力・3列ダイヤル・測定データ4指標・評価推移・このリードで計測)
//   F 比較(チップ + 4グラフ + ★一覧 + 脚注)
//
// 【この節の作り方】値を実装から写して並べるのではなく、
// **正典 design/north-star-measure.html の CSS を読み、実装の値と突き合わせる**。
// 要件は正典に、調整値は実装に、検証はここに置いて、両者を独立に照合する
// (design/LOOP.md「定数の定義を言い換えるテストは書かない」)。
// ============================================================
console.log("\n========== 検証25: N-5 リードタブ(正典 north-star-measure.html との突き合わせ) ==========");
{
  // REED_COMPARE_METRICS の顔ぶれは**実ソースから**取る(テスト内に写さない)。
  const cmKeys = [...extractConst("REED_COMPARE_METRICS").matchAll(/\{ key: "(\w+)"/g)].map((m) => m[1]);
  const mock = readFileSync(join(__dirname, "..", "design", "north-star-measure.html"), "utf8");
  const cssN5 = readFileSync(join(__dirname, "..", "src", "index.css"), "utf8");

  // --- 正典・index.css の両方を同じパーサで読む -------------------------------
  const parseCss = (text) => {
    const out = [];
    const body = text.replace(/\/\*[\s\S]*?\*\//g, " ");
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const sels = m[1].split(",").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
      out.push({ sels, body: m[2] });
    }
    return out;
  };
  const declsOf = (block) => (block || "").split(";").map((d) => d.trim()).filter(Boolean)
    .map((d) => { const i = d.indexOf(":"); return { name: d.slice(0, i).trim(), value: d.slice(i + 1).trim() }; });
  const ruleOf = (rules, sel) => rules.filter((r) => r.sels.includes(sel));
  const declOf = (rules, sel, name) => {
    let v = null;
    for (const r of ruleOf(rules, sel)) for (const d of declsOf(r.body)) if (d.name === name) v = d.value;
    return v;
  };
  const mockCss = parseCss((mock.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1]);
  const appCss = parseCss(cssN5);

  // 正典側の走査が空回りしていないこと(空回りすると以降が全部「一致」になる)
  check("正典モックの CSS を走査できている", mockCss.length >= 60, `${mockCss.length}規則`);
  for (const sel of [".rgrid", ".tile", ".tile.sel", ".tile.data", ".tile.ret", ".tile.drag",
    ".rhead", ".rname", ".rmeta", ".rgroup", ".addrow", ".addbtn", ".starrow", ".starrow .v",
    ".starrow .l", ".memoline", ".bigbtn", ".numrow .v", ".numrow .l", ".rlist", ".subtabs"]) {
    check(`正典に ${sel} の規則がある`, ruleOf(mockCss, sel).length === 1,
      `${ruleOf(mockCss, sel).length}件`);
  }

  // --- 25.1 5×2 のグリッド(正典 .rgrid)--------------------------------------
  {
    const cols = declOf(mockCss, ".rgrid", "grid-template-columns");
    const gap = declOf(mockCss, ".rgrid", "gap");
    check("正典 .rgrid は repeat(5,1fr)", cols === "repeat(5,1fr)", String(cols));
    check("実装の列数は正典と同じ5", api.REED_GRID_COLS === Number(/repeat\((\d+)/.exec(cols)[1]),
      `実装=${api.REED_GRID_COLS} / 正典=${cols}`);
    check("実装の gap は正典と同じ", api.REED_GRID_GAP_PX === parseFloat(gap),
      `実装=${api.REED_GRID_GAP_PX} / 正典=${gap}`);
    // JSX 側が定数から描いていること(定数だけ正しくて描画は別、を防ぐ)
    const grid = srcOfFn(src, "ReedTileGrid");
    check("グリッドは REED_GRID_COLS から列を作る",
      /gridTemplateColumns: `repeat\(\$\{REED_GRID_COLS\}, 1fr\)`/.test(grid));
    check("グリッドは REED_GRID_GAP_PX から間隔を作る", /gap: REED_GRID_GAP_PX/.test(grid));
    check("タイルは正方形(正典 .tile の aspect-ratio:1)",
      declOf(mockCss, ".tile", "aspect-ratio") === "1" && /aspectRatio: "1"/.test(grid));
    check("タイルの文字サイズは正典と同じ",
      api.REED_TILE_FS_PX === parseFloat(declOf(mockCss, ".tile", "font-size")),
      `実装=${api.REED_TILE_FS_PX} / 正典=${declOf(mockCss, ".tile", "font-size")}`);
    // 本人の不満「10 だけ枠の幅が違う」「8+2 で段が分かれる」= 5×2 で消える。
    // 10枚の箱がちょうど2段になることを、列数から計算して確かめる。
    check("10枚の箱はちょうど2段になる(8+2 に割れない)",
      10 % api.REED_GRID_COLS === 0 && 10 / api.REED_GRID_COLS === 2,
      `${api.REED_GRID_COLS}列 → ${10 / api.REED_GRID_COLS}段`);
    // 375px でタイルが 44px を割らない(§5 は機能側の規定として有効)。
    // 幅 = (画面375 - 左右padding - gap×4) / 5
    {
      const inner = 375 - api.REED_SIDE_PAD_PX * 2;
      const tile = (inner - api.REED_GRID_GAP_PX * (api.REED_GRID_COLS - 1)) / api.REED_GRID_COLS;
      check("375px でタイルの1辺は 44px 以上(§5)", tile >= 44, `${tile.toFixed(2)}px`);
      check("左右の padding は正典 .rlist と同じ 24px",
        api.REED_SIDE_PAD_PX === parseFloat((declOf(mockCss, ".rlist", "padding") || "").split(/\s+/)[1]),
        `実装=${api.REED_SIDE_PAD_PX} / 正典=${declOf(mockCss, ".rlist", "padding")}`);
      // .app-root が既に持っている 14px との差分だけを足している(二重に足していない)
      check("リードタブが足す左右の padding は 24 − 14 = 10",
        api.REED_LIST_EXTRA_PAD_PX === api.REED_SIDE_PAD_PX - api.REED_APP_SIDE_PAD_PX
        && api.REED_LIST_EXTRA_PAD_PX === 10, `${api.REED_LIST_EXTRA_PAD_PX}px`);
      check(".app-root の左右 padding は 14px のまま(この周で触っていない)",
        new RegExp(`padding: "calc\\(16px \\+ env\\(safe-area-inset-top\\)\\) calc\\(${api.REED_APP_SIDE_PAD_PX}px`).test(src));
    }
  }

  // --- 25.2 タイルの「濃さ」4段(正典 .tile / .data / .ret / .sel)------------
  {
    // (a) どの段になるかの真理値表を**全通り**(2×2)確かめる
    check("記録が何も無ければ ret(ごく薄い)", api.reedTileTone(false, false) === "ret");
    check("評価だけあれば既定(plain)", api.reedTileTone(false, true) === "plain");
    check("測定データがあれば data(濃い枠)", api.reedTileTone(true, false) === "data");
    check("測定データも評価もあれば data(測定データが勝つ)", api.reedTileTone(true, true) === "data");
    const tones = new Set([false, true].flatMap((a) => [false, true].map((b) => api.reedTileTone(a, b))));
    check("段は3つだけ(sel は別の軸)", tones.size === 3 && [...tones].sort().join(",") === "data,plain,ret",
      [...tones].sort().join(","));

    // (b) 濃さが単調(ret < plain < data)であることを**色の明るさで**確かめる。
    //     トークン名の一致ではなく値で見る(トークンを差し替えても順序が崩れれば落ちる)。
    const tokenHex = (name) => {
      const m = new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`).exec(cssN5);
      return m ? m[1] : null;
    };
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const borderOf = (tone) => {
      const sel = tone === "plain" ? ".reedtile" : `.reedtile[data-tone="${tone}"]`;
      const v = tone === "plain"
        ? (declOf(appCss, sel, "border") || "").split(/\s+/).pop()
        : declOf(appCss, sel, "border-color");
      const m = /var\((--[\w-]+)\)/.exec(v || "");
      return m ? tokenHex(m[1]) : null;
    };
    const L = { ret: borderOf("ret"), plain: borderOf("plain"), data: borderOf("data") };
    check("3段の枠の色を index.css から解決できている",
      Object.values(L).every((h) => /^#[0-9A-Fa-f]{6}$/.test(String(h))), JSON.stringify(L));
    check("枠は ret → 既定 → data の順に濃くなる(明るさが単調に下がる)",
      lum(L.ret) > lum(L.plain) && lum(L.plain) > lum(L.data),
      `ret=${lum(L.ret).toFixed(4)} / plain=${lum(L.plain).toFixed(4)} / data=${lum(L.data).toFixed(4)}`);
    // 正典側も同じ順序であること(実装だけ勝手に並べ替えていない)
    const mockBorder = (sel) => {
      const v = sel === ".tile"
        ? (declOf(mockCss, ".tile", "border") || "").split(/\s+/).pop()
        : declOf(mockCss, sel, "border-color");
      const m = /var\((--[\w-]+)\)/.exec(v || "");
      const t = m ? new RegExp(`${m[1]}\\s*:\\s*(#[0-9A-Fa-f]{6})`).exec(mock) : null;
      return t ? t[1] : null;
    };
    const M = { ret: mockBorder(".tile.ret"), plain: mockBorder(".tile"), data: mockBorder(".tile.data") };
    check("正典の3段の枠の色を解決できている",
      Object.values(M).every((h) => /^#[0-9A-Fa-f]{6}$/.test(String(h))), JSON.stringify(M));
    check("正典も ret → 既定 → data の順に濃い(順序が実装と一致する)",
      lum(M.ret) > lum(M.plain) && lum(M.plain) > lum(M.data),
      `ret=${lum(M.ret).toFixed(4)} / plain=${lum(M.plain).toFixed(4)} / data=${lum(M.data).toFixed(4)}`);

    // (c) 選択中は紺の塗り(正典 .tile.sel)。**枠と違う地を同時に持たない**ために
    //     枠は透明にしてある(描画は正典と同一)。
    check("選択中の地は --c-accent(正典 .tile.sel の background:var(--accent))",
      declOf(appCss, '.reedtile[data-tone="sel"]', "background") === "var(--c-accent)",
      String(declOf(appCss, '.reedtile[data-tone="sel"]', "background")));
    check("選択中の文字は --c-on-accent / 太字600(正典 .tile.sel)",
      declOf(appCss, '.reedtile[data-tone="sel"]', "color") === "var(--c-on-accent)"
      && declOf(appCss, '.reedtile[data-tone="sel"]', "font-weight") === "600");
    check("選択中の枠は透明(枠 ∧ 違う地 を同時に持たない。§6.7 の芯1)",
      declOf(appCss, '.reedtile[data-tone="sel"]', "border-color") === "transparent");
    check("角丸は正典 .tile と同じ",
      parseFloat(declOf(appCss, ".reedtile", "border-radius")) === parseFloat(declOf(mockCss, ".tile", "border-radius")),
      `実装=${declOf(appCss, ".reedtile", "border-radius")} / 正典=${declOf(mockCss, ".tile", "border-radius")}`);
    check("枠の太さは正典 .tile と同じ",
      parseFloat(declOf(appCss, ".reedtile", "border")) === parseFloat(declOf(mockCss, ".tile", "border")),
      `実装=${declOf(appCss, ".reedtile", "border")} / 正典=${declOf(mockCss, ".tile", "border")}`);
    check("index.css の .reedtile は1回しか書かれていない",
      ruleOf(appCss, ".reedtile").length === 1, `${ruleOf(appCss, ".reedtile").length}回`);
  }

  // --- 25.3 箱見出し(正典 .rhead / .rname / .rmeta)----------------------------
  // 【F-72 の手本に倣う】綴り1つを数えるのではなく、**直下の子と横方向の宣言を
  // 期待表と全件照合**する。要素を足しても消しても落ちる。
  {
    check("正典 .rhead は baseline 揃えの両端寄せ",
      declOf(mockCss, ".rhead", "align-items") === "baseline"
      && declOf(mockCss, ".rhead", "justify-content") === "space-between");
    check("実装の箱見出しも baseline 揃えの両端寄せ",
      /display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: REED_HEAD_MB_PX/.test(src));
    check("箱見出しの下の余白は正典 .rhead と同じ",
      api.REED_HEAD_MB_PX === parseFloat(declOf(mockCss, ".rhead", "margin-bottom")),
      `実装=${api.REED_HEAD_MB_PX} / 正典=${declOf(mockCss, ".rhead", "margin-bottom")}`);
    check("箱の名前は正典 .rname の 15px / 600",
      parseFloat(declOf(mockCss, ".rname", "font-size")) === 15
      && declOf(mockCss, ".rname", "font-weight") === "600"
      && /fontSize: 15, fontWeight: 600, color: "var\(--c-ink\)"/.test(src));
    check("番手は正典 .rname i の --ink3 / 400(斜体にしない)",
      declOf(mockCss, ".rname i", "font-weight") === "400"
      && /color: "var\(--c-ink-3\)", fontWeight: 400, fontStyle: "normal"/.test(src));
    check("★と開封日は正典 .rmeta の 12px / gap 10 / baseline",
      parseFloat(declOf(mockCss, ".rmeta", "font-size")) === 12
      && parseFloat(declOf(mockCss, ".rmeta", "gap")) === 10
      && /fontSize: 12, color: "var\(--c-ink-3\)", display: "flex", gap: 10, alignItems: "baseline"/.test(src));
    // 箱見出しに出るのは 銘柄・番手・平均★・開封日 の4つだけ(枚数バッジ等を足していない)
    // 【F-80/F-82 で走査の開始位置を変えた】銘柄と日付をタップで編集できるようにしたので、
    // 中身が nameInner / dateText に切り出された。走査は const boxEditable から始める。
    {
      const i = src.indexOf("const boxEditable = listMode === null;");
      const j = src.indexOf("\n          return (", i);
      const head = i === -1 || j === -1 ? "" : src.slice(i, j);
      check("箱見出しのブロックを走査できている",
        head.length > 1500 && /const heading = \(/.test(head), `${head.length}文字`);
      const shown = [
        ["銘柄", /\{g\.brand\}/],
        ["番手", /\{g\.strength\}/],
        ["平均★", /★\{avgRating\.toFixed\(1\)\}/],
        ["開封日", /formatYmd\(g\.startDate\) \?\? "開封日 未設定"/],
      ];
      for (const [label, re] of shown) check(`箱見出しに ${label} が出る`, re.test(head), label);
      // 枚数(g.members.length)は出さない = タイルを数えれば分かる(正典の判断)
      check("箱見出しに枚数を出していない(タイルを数えれば分かる)",
        !/g\.members\.length/.test(codeOf(head)), codeOf(head).slice(0, 120));
      // 日付は yyyy/mm/dd(N-2 の表記統一)。生の ISO を出していない
      check("箱見出しの日付は formatYmd(yyyy/mm/dd)を通す",
        !/\{g\.startDate\}/.test(codeOf(head)));

      // --- 【F-80 / F-82】銘柄と日付をタップすると「箱を編集」が開く ----------------
      // **見た目を足していないこと**を、この2つの <button> の宣言を全件照合して縛る。
      // 「地・枠を持たない」は綴りの不在ではなく、**横方向・面まわりの宣言の集合**で見る
      // (F-72 罠5「綴り1つを数える検査は別名の宣言で生き残る」)。
      const btnOf = (needle) => {
        const k = head.indexOf(needle);
        if (k === -1) return null;
        const open = head.lastIndexOf("<button", k);
        const close = head.indexOf(">", head.indexOf("style={{", open));
        return open === -1 ? null : head.slice(open, close + 1);
      };
      const nameBtn = btnOf("の銘柄と番手を編集");
      const dateBtn = btnOf("の開封日を編集");
      check("F-82: 銘柄が <button> になっている(タップで編集が開く)",
        nameBtn !== null && /onClick=\{\(\) => openBoxEdit\(g\)\}/.test(nameBtn),
        (nameBtn || "").replace(/\s+/g, " ").slice(0, 140));
      check("F-80: 日付が <button> になっている(タップで編集が開く)",
        dateBtn !== null && /onClick=\{\(\) => openBoxEdit\(g\)\}/.test(dateBtn),
        (dateBtn || "").replace(/\s+/g, " ").slice(0, 140));
      for (const [label, tag] of [["銘柄", nameBtn], ["日付", dateBtn]]) {
        // 角丸・影・余白・寸法を**足していない** = 見た目が 1px も変わらないことの担保。
        // `padding: 0` は UA 既定の余白を消す**打ち消し**なので許す(足していないので値は 0 のみ)。
        // 0 以外の値が1つでも入れば落ちる(padding: 8 / minHeight: "var(--tap-min)" 等)。
        const pairs = [...(tag || "").matchAll(/(?:^|[{,]\s*)([A-Za-z]+):\s*([^,}]+)/g)]
          .map((m) => ({ name: m[1], value: m[2].trim() }));
        const forbidden = pairs.filter((d) =>
          /^(borderRadius|boxShadow|outline|margin|padding|width|height|minHeight|minWidth|maxWidth)/.test(d.name)
          && d.value !== "0");
        check(`F-80/F-82: ${label}のボタンは角丸・影・余白・寸法を足していない(0 の打ち消しだけ)`,
          tag !== null && forbidden.length === 0, forbidden.map((d) => `${d.name}:${d.value}`).join(" ") || "0件");
        check(`F-80/F-82: ${label}のボタンは地も枠も持たない`,
          tag !== null && /background: "none"/.test(tag) && /border: "none"/.test(tag),
          (tag || "").replace(/\s+/g, " ").slice(0, 160));
        // 当たり判定は疑似要素(.taptext)で 44pt へ広げる。padding/minHeight で広げると行が伸びる。
        check(`F-80/F-82: ${label}のボタンの当たり判定は .taptext(疑似要素)で広げる`,
          tag !== null && /className="[^"]*\btaptext\b[^"]*"/.test(tag),
          (tag || "").replace(/\s+/g, " ").slice(0, 160));
      }
      // 銘柄の見た目は nameStyle 1つが持ち、押せる側(button)と押せない側(span)で**共有**する。
      // 2箇所に書くと、削除モードに入った瞬間に文字の大きさや色が変わる。
      check("F-82: 銘柄の見た目は nameStyle 1つ(押せる側と押せない側で共有)",
        /const nameStyle = \{ fontSize: 15, fontWeight: 600, color: "var\(--c-ink\)", minWidth: 0 \};/.test(head)
        && (head.match(/\.\.\.nameStyle/g) || []).length === 2,
        `${(head.match(/\.\.\.nameStyle/g) || []).length}箇所`);
      check("F-82: 銘柄の文字も nameInner 1つ(押せる側と押せない側で共有)",
        (head.match(/\{nameInner\}/g) || []).length === 2, `${(head.match(/\{nameInner\}/g) || []).length}箇所`);
      check("F-80: 日付の文字も dateText 1つ(押せる側と押せない側で共有)",
        (head.match(/\{dateText\}/g) || []).length === 2, `${(head.match(/\{dateText\}/g) || []).length}箇所`);
      // 削除モード中は見出しの行そのものが <button> なので、入れ子にせず素の <span> に戻す。
      check("F-80/F-82: 削除モード中は素の <span> に戻す(押せる物を入れ子にしない)",
        /\{boxEditable \? \(/.test(head) && (head.match(/\) : \(/g) || []).length === 2,
        `${(head.match(/\) : \(/g) || []).length}箇所`);
      // .taptext の CSS 側(index.css)の検査は §17.15b(cssBlock 等が使える節)に置いた。
      //
      // 【F-83】index.css が「.taptext を付ける要素は overflow を切ってはいけない」と
      // **明文で禁じている**のに、それを見る検査が1本も無かった。銘柄ボタンの style に
      // `overflow: "hidden"` を足す変異は **PASS 5885 / FAIL 0 のまま生存**し、実ブラウザ
      // (375×812)で当たり判定が **44px → 15px** に落ちた(`elementFromPoint` を整数グリッドで
      // 1px刻みに走査。§5 の 44pt 割れ)。
      //
      // **本体の担保は index.css 側の `overflow: visible !important`**(構造的に起こり得なくする)。
      // この節の検査はその**補助**で、`.taptext` を付けた要素の JSX に overflow を書いていないこと
      // ——つまり「!important に頼らないと壊れる書き方が入っていないこと」——だけを見る。
      // **「当たり判定が縮まない」ことの十分条件ではない**(CSS 側の別の規則、祖先の clip-path、
      // contain など、ここから見えない経路がある)ので、名前もそう名乗る。
      // 十分条件を名乗って中身が足りない、というのがこのプロジェクトで11回繰り返した罠。
      {
        // `onClick={() => …}` の `=>` があるので、単純な `>` 探索ではタグを切り出せない。
        // 波括弧の深さを見て、深さ0の `>` を閉じとみなす。
        const taptextTags = (() => {
          const out = [];
          const re = /className="[^"]*\btaptext\b[^"]*"/g;
          let m;
          while ((m = re.exec(src)) !== null) {
            const open = src.lastIndexOf("<", m.index);
            if (open < 0) continue;
            let depth = 0, end = -1;
            for (let i = open; i < src.length; i++) {
              const c = src[i];
              if (c === "{") depth++;
              else if (c === "}") depth--;
              else if (c === ">" && depth === 0) { end = i; break; }
            }
            if (end > open) out.push(src.slice(open, end + 1));
          }
          return out;
        })();
        // 走査が空回りしていないことの裏取り(0件なら何も見ずに通ってしまう)
        check("F-83: .taptext を使っている要素を切り出せている(空回りしていない)",
          taptextTags.length >= 2 && taptextTags.every((t) => /^<[A-Za-z]/.test(t) && t.length > 40),
          `${taptextTags.length}件 / ${taptextTags.map((t) => t.length).join(",")}`);
        const clipped = taptextTags.filter((t) => /(?:^|[{,\s])overflow[A-Za-z]*\s*:/.test(t));
        check("F-83: .taptext を付けた要素の JSX に overflow を書いていない(当たり判定が縮まないことの十分条件ではない。本体の担保は index.css の !important)",
          clipped.length === 0,
          clipped.map((t) => t.replace(/\s+/g, " ").slice(0, 90)).join(" | ") || "0件");
      }
    }
  }

  // --- 25.4 「＋ 追加」1つ(正典 .addrow / .addbtn)----------------------------
  {
    check("追加の行は中央寄せ(正典 .addrow)",
      declOf(mockCss, ".addrow", "justify-content") === "center"
      && /display: "flex", justifyContent: "center", paddingTop: REED_ADDROW_PAD_TOP_PX/.test(src));
    check("追加の行の上の余白は正典 .addrow と同じ",
      api.REED_ADDROW_PAD_TOP_PX === parseFloat(declOf(mockCss, ".addrow", "padding-top")),
      `実装=${api.REED_ADDROW_PAD_TOP_PX} / 正典=${declOf(mockCss, ".addrow", "padding-top")}`);
    check("「＋ 追加」は正典 .addbtn の 14px / --accent",
      parseFloat(declOf(mockCss, ".addbtn", "font-size")) === 14
      && /fontSize: 14, color: "var\(--c-accent\)"/.test(src));
    check("箱の上下の余白は正典 .rgroup と同じ",
      api.REED_GROUP_PAD_TOP_PX === parseFloat((declOf(mockCss, ".rgroup", "padding") || "").split(/\s+/)[0])
      && api.REED_GROUP_PAD_BOTTOM_PX === parseFloat((declOf(mockCss, ".rgroup", "padding") || "").split(/\s+/)[2]),
      `実装=${api.REED_GROUP_PAD_TOP_PX}/${api.REED_GROUP_PAD_BOTTOM_PX} / 正典=${declOf(mockCss, ".rgroup", "padding")}`);
    check("箱の下に罫1本(正典 .rgroup の border-bottom)",
      /border-bottom:\s*1px solid/.test(declOf(mockCss, ".rgroup", "border-bottom") ? `border-bottom:${declOf(mockCss, ".rgroup", "border-bottom")}` : "")
      && /borderBottom: "1px solid var\(--c-line\)"/.test(src));
    // 空状態の文言は現行のまま
    check("空状態の文言は現行のまま", src.includes("まだリードが登録されていません"));
  }

  // --- 25.5 ドラッグ並び替えの幾何(gridDropIndex)------------------------------
  // 純関数なので**全マスを総当たり**する。座標 → 落ちる位置が格子どおりであること。
  {
    const W = 57, H = 57, GAP = api.REED_GRID_GAP_PX, COLS = api.REED_GRID_COLS;
    const X0 = 24, Y0 = 100;
    const at = (col, row) => [X0 + col * (W + GAP) + W / 2, Y0 + row * (H + GAP) + H / 2];
    let bad = null, n = 0;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < COLS; col++) {
        const [x, y] = at(col, row);
        const got = api.gridDropIndex(x, y, X0, Y0, W, H, GAP, COLS, 10);
        n++;
        if (got !== row * COLS + col) bad = bad || `(${col},${row}) → ${got}`;
      }
    }
    check("10枚の格子の全マスで、指の位置 → 落ちる位置が一致する", bad === null, bad || `${n}マス`);
    check("総当たりが空回りしていない", n === 10, `${n}マス`);
    // 端のクランプ: 左外・上外・右外・下外・要素数を超える位置
    check("グリッドの左上より外は先頭に寄る", api.gridDropIndex(-999, -999, X0, Y0, W, H, GAP, COLS, 10) === 0);
    check("グリッドの右下より外は末尾に寄る", api.gridDropIndex(9999, 9999, X0, Y0, W, H, GAP, COLS, 10) === 9);
    check("2段目の空きマス(5枚の箱の6番目以降)は末尾に寄る",
      api.gridDropIndex(...at(4, 1), X0, Y0, W, H, GAP, COLS, 5) === 4,
      String(api.gridDropIndex(...at(4, 1), X0, Y0, W, H, GAP, COLS, 5)));
    check("要素0・列0でも例外を投げない(0を返す)",
      api.gridDropIndex(0, 0, 0, 0, W, H, GAP, 0, 0) === 0 && api.gridDropIndex(0, 0, 0, 0, 0, 0, 0, COLS, 10) === 0);
    // 横方向にも動くこと(行の並び替えの「縦だけ」から変わった点)
    check("同じ段の隣のマスへ横に動かせる",
      api.gridDropIndex(...at(3, 0), X0, Y0, W, H, GAP, COLS, 10) === 3
      && api.gridDropIndex(...at(0, 0), X0, Y0, W, H, GAP, COLS, 10) === 0);
    // 長押しの時間と許容移動量は現行のまま(本人が慣れている感触を変えない)
    check("長押しは 400ms のまま", api.REED_DRAG_LONGPRESS_MS === 400, `${api.REED_DRAG_LONGPRESS_MS}ms`);
    check("長押し成立までの許容移動量は 8px のまま", api.REED_DRAG_SLOP_PX === 8, `${api.REED_DRAG_SLOP_PX}px`);
    {
      const grid = srcOfFn(src, "ReedTileGrid");
      check("長押しの時間は定数から取る(直書きしていない)", /\}, REED_DRAG_LONGPRESS_MS\);/.test(grid));
      // 【行から変わった点】判定を縦だけ(Math.abs(dy))から2次元の距離(hypot)にした。
      // タイルは横にも並ぶので、縦だけ見ていると横に払ったスワイプが長押しとして生き残る。
      check("長押しのキャンセルは2次元の距離で見る(縦だけではない)",
        /Math\.hypot\(e\.clientX - info\.startX, e\.clientY - info\.startY\) > REED_DRAG_SLOP_PX/.test(grid));
      // 横スワイプ(子タブ移動)との同居: ドラッグ中は SwipePager が降りる
      check("ドラッグ中は横スワイプの子タブ移動を止める(旗を立てる)",
        /setReedTileDragActive\(true\)/.test(grid));
      check("ドラッグの終わりで必ず旗を下ろす(endDrag が唯一の出口)",
        /const endDrag = \(\) => \{[\s\S]{0,300}?setReedTileDragActive\(false\);/.test(grid));
      // 出口は1つ。pointerup / pointercancel の両方がここへ来る(片方だけ旗が残らない)。
      check("指を離す・中断のどちらも endDrag へ来る",
        /const onUp = \(\) => endDrag\(\);/.test(grid)
        && /window\.addEventListener\("pointerup", onUp\);/.test(grid)
        && /window\.addEventListener\("pointercancel", onUp\);/.test(grid));
      check("アンマウントでも旗を下ろす(掴んだまま画面が変わっても残らない)",
        /useEffect\(\(\) => \(\) => \{[\s\S]{0,240}?setReedTileDragActive\(false\);/.test(grid));
      // 【F-79a】進行中のジェスチャーを捨てる前に必ず戻す。
      //
      // 【前版の検査が「正しい修正をすると落ちる」形だった(BACKLOG F-72 罠5 の再発)】
      // 旧主張: 「st を捨てるのは onTouchStart のガード2つ + finishGesture の**3箇所ちょうど**」。
      //   これは**箇所数の釘付け**で、①の正しい直し(ガードも finishGesture を通す = 2箇所に減る)
      //   を FAIL にした(審査役が複製ツリーで実証: PASS 5855 / FAIL 2)。
      //   さらに走査範囲の第2引数がコメント文字列で、codeOf 済みの文字列に対して常に -1 を返し、
      //   「onTouchStart 内」と名乗りながら**関数末尾までを測っていた**。
      // 新主張: **`st.current = null` の代入は SwipePager 全体で1箇所だけで、それは
      //   finishGesture の中にある。** 1 は偶然の件数ではなく
      //   「**終端を通らずにジェスチャーを捨てられない**」という不変条件そのもの
      //   (捨てる場所が1つしかなく、そこが必ず endGesture を呼ぶなら、抜け道は構造上作れない)。
      {
        const pagerSrc = srcOfFn(src, "SwipePager");
        const pager = codeOf(pagerSrc);
        const iFin = pager.indexOf("const finishGesture");
        const iStart = pager.indexOf("const onTouchStart");
        check("F-79a: SwipePager と finishGesture の範囲を走査できている(空回りしていない)",
          pager.length > 1500 && iFin !== -1 && iStart !== -1 && iFin < iStart,
          `${pager.length}文字 / finishGesture@${iFin} / onTouchStart@${iStart}`);
        const drops = (pager.match(/st\.current = null;/g) || []).length;
        const inFinish = ((iFin === -1 || iStart === -1 ? "" : pager.slice(iFin, iStart))
          .match(/st\.current = null;/g) || []).length;
        check("F-79a: ジェスチャーを捨てる代入は SwipePager 全体で1箇所だけ",
          drops === 1, `${drops}箇所`);
        check("F-79a: その1箇所は finishGesture の中にある(= 捨てる前に必ず終端を通る)",
          inFinish === 1, `finishGesture 内 ${inFinish}箇所`);
        check("F-79a: finishGesture は st を読んでから捨て、終端(endGesture)の結果を返す",
          /const finishGesture = \(i, interrupted\) => \{\s*\r?\n\s*const s = st\.current;\s*\r?\n\s*st\.current = null;\s*\r?\n\s*if \(!s\) return \{ kind: "none", dx: 0 \};\s*\r?\n\s*return \{ kind: endGesture\(s, i, interrupted\), dx: s\.dx \};/.test(pagerSrc));
        // 【§6.3】中断の終端は**対象判定より前**。onTouchStart の1行目が終端であること。
        check("F-79a: onTouchStart は対象判定より前に終端を通す(§6.3「中断の終端は対象判定より前」)",
          /const onTouchStart = \(e\) => \{\s*\r?\n\s*finishGesture\(index, true\);\s*\r?\n\s*if \(e\.touches\.length !== 1/.test(pagerSrc));
        check("F-79a: 2本目の指・入力欄・横スクロール祖先・並び替え旗は「戻すだけ」で終わる(進まない)",
          /finishGesture\(index, true\);/.test(pagerSrc)
          && /if \(isReedTileDragActive\(\)\) \{ finishGesture\(idxRef\.current, true\); return; \}/.test(pagerSrc));
        // 【F-83】ジェスチャーの終わりを告げたイベントが中断かどうかは、コンポーネントの
        // 条件式ではなく**純関数 swipePagerInterrupted** が決める。ここで三項演算子に
        // 戻すと、`touchcancel` を「指を離した」と取り違えてもハーネスから見えない
        // (A8 の変異が生き残ったのと同じ理由)。
        check("F-79a/F-83: 終わりの経路は中断の判定を純関数へ委ねる(コンポーネントで条件を書かない)",
          /const interrupted = swipePagerInterrupted\(eventType, isReedTileDragActive\(\)\);/.test(pagerSrc)
          && /const \{ kind, dx \} = finishGesture\(i, interrupted\);/.test(pagerSrc));
        // 中断で渡す値は必ず true(「中断なのに進む」経路を作らない)。
        // **箇所数では縛らない**(中断の入口が将来増えても正しい実装なら通ってよい。
        //  箇所数の釘付けは F-72 罠5 で禁じた形)。縛るのは「渡す値の集合」。
        {
          // 引数に括弧を含む呼び出し(isReedTileDragActive())があるので、1段だけ入れ子を許す
          const calls = (pager.match(/finishGesture\((?:[^()]|\([^()]*\))*\)/g) || []);
          // 許されるのは2種類だけ:
          //   ・中断(true をその場で渡す)
          //   ・終わりのイベントから純関数が導いた値(`interrupted`)
          // `false` の直渡し、旗の生の値、その場の条件式はすべて弾く。
          const bad = calls.filter((c) => !/,\s*(?:true|interrupted)\)$/.test(c));
          check("F-79a: finishGesture の呼び出しは中断(true)か純関数の判定(interrupted)しか渡さない(false や条件式を直接渡す経路を作らない)",
            calls.length >= 2 && bad.length === 0, bad.join(" | ") || `${calls.length}箇所すべて適合`);
          check("F-79a: 中断の呼び出しと、終わりのイベントからの呼び出しが両方ある(片方だけにしていない)",
            calls.some((c) => /,\s*true\)$/.test(c)) && calls.some((c) => /,\s*interrupted\)$/.test(c)),
            calls.join(" | "));
        }
      }
      // 【F-79a】ブラウザにスクロールを引き取らせない(§6.3 の作法)。
      // 引き取られると pointercancel が飛んでドラッグごと死ぬ。
      check("F-79a: ドラッグ中は非パッシブの touchmove で preventDefault する",
        /const onTouchMove = \(ev\) => \{ if \(ev\.cancelable\) ev\.preventDefault\(\); \};/.test(grid)
        && /window\.addEventListener\("touchmove", onTouchMove, \{ passive: false \}\);/.test(grid)
        && /window\.removeEventListener\("touchmove", info\.onTouchMove\);/.test(grid));
      check("F-79a: touch-action は掴んだ1枚にだけ none を当てる(祖先には敷かない)",
        /touchAction: isDragging \? "none" : "pan-y",/.test(grid)
        && (codeOf(grid).match(/touchAction/g) || []).length === 1,
        `${(codeOf(grid).match(/touchAction/g) || []).length}箇所`);
      // 旗は ReedTileGrid だけが立てる(他の画面へ漏れない)
      {
        // 定義(function setReedTileDragActive)そのものは呼び出しではないので数から外す
        const calls = (codeOf(src).match(/(?<!function )setReedTileDragActive\(/g) || []).length;
        const inGrid = (codeOf(grid).match(/(?<!function )setReedTileDragActive\(/g) || []).length;
        check("旗を立て下ろしするのは ReedTileGrid だけ(他の画面へ漏れていない)",
          calls === inGrid && inGrid >= 3, `全体=${calls} / ReedTileGrid=${inGrid}`);
        // 【F-79a で 2 → 3】touchstart / touchmove / touchend の3箇所。読む場所はすべて
        // SwipePager の中で、他の部品は旗を読まない(読むと挙動が2箇所に散る)。
        {
          const all = (codeOf(src).match(/(?<!function )isReedTileDragActive\(\)/g) || []).length;
          const inPager = (codeOf(srcOfFn(src, "SwipePager")).match(/isReedTileDragActive\(\)/g) || []).length;
          check("旗を読むのは SwipePager の3箇所だけ(他の部品が挙動を変えていない)",
            all === 3 && inPager === 3, `全体=${all} / SwipePager=${inPager}`);
          // 旗の読みは3つとも役割が違う。**どれも「終端の後」か「終端へ渡す」**であって、
          // 「終端を飛ばして早期 return する」形が1つも無いこと(それが差し戻しの原因だった)。
          //   touchstart … 終端を通した**後**に「新しく始めない」を決める
          //   touchmove  … 中断として終端へ流す
          //   touchend   … 旗の状態を終端へ渡す(中断なら行き先を判定しない)
          {
            const p = codeOf(srcOfFn(src, "SwipePager"));
            const iFinishFirst = p.indexOf("finishGesture(index, true);");
            const iStartGuard = p.indexOf("if (isReedTileDragActive()) return;");
            check("F-79a: touchstart の旗の読みは終端の**後**にある(終端を飛ばさない)",
              iFinishFirst !== -1 && iStartGuard !== -1 && iFinishFirst < iStartGuard,
              `終端@${iFinishFirst} / 旗@${iStartGuard}`);
            check("F-79a: 旗を見て終端を飛ばす早期 return が1つも無い",
              (p.match(/if \(isReedTileDragActive\(\)\) return;/g) || []).length === 1
              && iStartGuard > p.indexOf("const onTouchStart"),
              p.match(/isReedTileDragActive\(\)[^\n]{0,44}/g).join(" | "));
          }
        }
      }
      // 並び替えは sortOrder だけを書き換える(管理番号 boxNumber は動かさない)
      check("並び替えは sortOrder だけを更新する(boxNumber は動かさない)",
        /const orderById = new Map\(newOrderIds\.map\(\(id, i\) => \[id, i \+ 1\]\)\);[\s\S]{0,200}sortOrder: orderById\.get\(r\.id\)/.test(src)
        && !/boxNumber: orderById/.test(src));
      check("並び替えの案内文は残っている", src.includes("長押ししてスライドすると並び替えられます・タップで詳細"));
      check("削除モード中は並び替えない(現行と同じ方針)", /if \(deleteMode\) return;/.test(grid));
      // 【実測で踏んだ罠】「1枚しかない箱は並び替える先が無いので pointerdown ごと降りる」と
      // 書いたら、押下の記録(dragInfoRef)が残らず **pointerup がタップと認識できなくなり、
      // 1枚だけの箱の詳細が開けなくなった**(375×812 の実測で発見)。
      // 正しい形は「押下は必ず記録し、長押しのタイマーだけ張らない」。
      // 順序まで見る: dragInfoRef への代入が canReorder の早期 return より**前**にあること。
      check("並び替えできるかの判定は canReorder に分けてある",
        /const canReorder = !deleteMode && members\.length >= 2;/.test(grid));
      {
        const rec = "dragInfoRef.current = { armed: false, startX, startY, lastX: startX, lastY: startY, id, index };";
        check("1枚しかない箱でも押下は記録する(タップで詳細が開く)",
          grid.indexOf(rec) !== -1 && grid.indexOf(rec) < grid.indexOf("if (!canReorder) return;"),
          `記録=${grid.indexOf(rec)} / 早期return=${grid.indexOf("if (!canReorder) return;")}`);
      }
      check("1枚しかない箱では長押しのタイマーを張らない",
        /if \(!canReorder\) return;\s*\r?\n\s*longPressTimerRef\.current = setTimeout\(/.test(grid));
      check("タップで詳細を開くのは長押しが成立しなかったときだけ",
        /const handlePointerUp = \(id\) => \(\) => \{\s*\r?\n\s*const info = dragInfoRef\.current;\s*\r?\n\s*if \(!info \|\| info\.armed\) return;/.test(grid)
        && /onTileTap\(id\);/.test(grid));
    }

    // --- 25.5b 【F-79b】掴んだ点とタイルの相対位置が最後まで変わらない ------------
    // 本人の実機報告(2026/08/14):「入れ替えると自分の持っている指からずれるのも非常に使いづらい。
    // iphone のアプリの並び替えと全く同じ使用感にしてほしい」。
    //
    // 【この検査が恒等式でないこと】reedTileVisual が返すのは「タイルの transform」で、
    // 画面上の位置は **そのタイルが DOM 上で占めているマス(home) + transform** で決まる。
    // テスト側は home のマスを cells[home] から独立に取って足し合わせる。
    //   実装が cells[home] を使う(正しい)  → 画面位置 = 指 − ずれ で一定
    //   実装が cells[cur] を使う(いまの症状)→ 入れ替えた瞬間にマス1つぶん飛ぶ
    // つまり「入れ替えを跨いで一定か」を見ており、定義の言い換えにはならない
    // (実際に cur へ変異させると下の (b) が落ちることを確認済み)。
    {
      const COLS = 5, W = 57.41, H = 57.41, GAP = 10, X0 = 24, Y0 = 200;
      // 10枚ぶんのマス(実装が長押しの瞬間に実測して控えるのと同じ格子)
      const cells = Array.from({ length: 10 }).map((_, i) => ({
        left: X0 + (i % COLS) * (W + GAP),
        top: Y0 + Math.floor(i / COLS) * (H + GAP),
      }));
      check("F-79b: 検査用の格子が正典の 5列 / gap 10 と同じ",
        COLS === api.REED_GRID_COLS && GAP === api.REED_GRID_GAP_PX,
        `${COLS}列 / gap ${GAP}`);
      // 3番目のタイル(home = 2)を、そのタイルの中の (12, 20) の点でつまむ
      const home = 2;
      const grabX = 12, grabY = 20;
      const drag = (px, py, settling = false) => ({
        id: "t2", cells, grabX, grabY, pointerX: px, pointerY: py, settling,
      });
      const parse = (t) => {
        const m = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\)(?: rotate\((-?[\d.]+)deg\))?$/.exec(t);
        return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]), deg: m[3] === undefined ? null : parseFloat(m[3]) } : null;
      };
      // 掴んだタイルの**画面上の左上** = そのタイルが居るマス(home) + transform
      const screenTopLeft = (vis) => {
        const t = parse(vis.transform);
        return t === null ? null : { x: cells[home].left + t.x, y: cells[home].top + t.y };
      };

      // (a) 掴んだ直後(指はまだ動いていない)。持ち上がりは -6px / -2deg。
      {
        const p = { x: cells[home].left + grabX, y: cells[home].top + grabY };
        const vis = api.reedTileVisual(drag(p.x, p.y), "t2", home, home);
        const t = parse(vis.transform);
        check("F-79b: 掴んだ直後の横のずれは 0(その場で持ち上がるだけ)", t !== null && t.x === 0, JSON.stringify(t));
        check("F-79b: 持ち上がりは正典 .tile.drag の -6px / -2deg",
          t !== null && t.y === -api.REED_TILE_LIFT_PX && t.deg === api.REED_TILE_DRAG_DEG
          && api.REED_TILE_LIFT_PX === 6 && api.REED_TILE_DRAG_DEG === -2,
          JSON.stringify(t));
        check("F-79b: 掴んでいる間は追従にアニメーションを掛けない(指から遅れる)",
          vis.transition === "none" && vis.zIndex === 2, `${vis.transition} / z=${vis.zIndex}`);
      }

      // (b) **本題**: 掴む → 動かす → 入れ替えが起きる → さらに動かす。
      //     指とタイル左上の相対位置(= 指 − 画面上の左上)が全ステップで同じであること。
      {
        const start = { x: cells[home].left + grabX, y: cells[home].top + grabY };
        // 指の軌跡。3歩目で cur が 2 → 5(次の段の先頭)へ、5歩目で 5 → 8 へ入れ替わる想定
        const path = [
          { x: start.x, y: start.y, cur: 2 },
          { x: start.x + 40, y: start.y + 5, cur: 2 },
          { x: start.x + 90, y: start.y + 70, cur: 5 },   // ← ここで入れ替わる
          { x: start.x + 120, y: start.y + 75, cur: 5 },
          { x: start.x + 200, y: start.y + 80, cur: 8 },  // ← もう一度入れ替わる
          { x: start.x + 210, y: start.y + 85, cur: 8 },
        ];
        const rel = path.map((p) => {
          const vis = api.reedTileVisual(drag(p.x, p.y), "t2", home, p.cur);
          const s = screenTopLeft(vis);
          return s === null ? null : { dx: p.x - s.x, dy: p.y - s.y };
        });
        check("F-79b: 途中で並び順が本当に入れ替わっている(検査が空回りしていない)",
          new Set(path.map((p) => p.cur)).size === 3, path.map((p) => p.cur).join(","));
        check("F-79b: 掴んだ点とタイルの相対位置が最初から最後まで変わらない(入れ替えを跨いでも)",
          rel.every((r) => r !== null && r.dx === rel[0].dx && r.dy === rel[0].dy),
          rel.map((r) => (r ? `(${r.dx.toFixed(2)},${r.dy.toFixed(2)})` : "?")).join(" "));
        check("F-79b: その相対位置は掴んだときの (12, 20) そのもの(浮き上がりの 6px だけ上)",
          rel[0].dx === grabX && rel[0].dy === grabY + api.REED_TILE_LIFT_PX,
          `(${rel[0].dx}, ${rel[0].dy}) / 期待 (${grabX}, ${grabY + api.REED_TILE_LIFT_PX})`);
        // 指が動いたぶんだけ実際に動いていること(「動かない」実装でも上は通るため)
        const moved = path.map((p) => screenTopLeft(api.reedTileVisual(drag(p.x, p.y), "t2", home, p.cur)));
        check("F-79b: タイルは指の移動ぶんだけ動く(固まっていない)",
          moved[5].x - moved[0].x === 210 && moved[5].y - moved[0].y === 85,
          `Δ(${moved[5].x - moved[0].x}, ${moved[5].y - moved[0].y})`);
      }

      // (c) 避ける側のタイルは「今の位置 − 元のマス」へ transition 付きで動く。
      {
        const vis = api.reedTileVisual(drag(0, 0), "other", 5, 2);
        const t = parse(vis.transform);
        check("F-79b: 避けるタイルは入れ替え後のマスへ動く(5番目 → 3番目のマス)",
          t !== null && t.x === cells[2].left - cells[5].left && t.y === cells[2].top - cells[5].top,
          JSON.stringify(t));
        check("F-79b: 避ける動きはアニメーションする(ぱちんと飛ばない)",
          vis.transition === api.REED_TILE_SLIDE_EASE && /^transform /.test(vis.transition),
          vis.transition);
        check("F-79b: 避けるタイルは掴んでいるタイルの下(z が低い)", vis.zIndex === 1, String(vis.zIndex));
        // 【F-83 で名前を直した】前版は「動かないタイルは transform を持たない(§6.3)」と
        // 名乗りながら、中身は **`translate(0px, 0px)` を持つことを要求**していた。
        // §6.3(DESIGN-SYSTEM.md:607)が言う「transform を残さない」は**静止時**の話で、
        // transform のある要素は `position: fixed` の子孫の包含ブロックになるため。
        // 並び替え中は静止ではないので identity を持って構わない。名前が要求する側へ直すと
        // 検査が落ちる、という「正しい修正を落とす検査」になっていた(通算11回目の形)。
        // **2つは別の主張なので、検査も2本に分ける。**
        check("F-79b: 並び替え中、動かないタイルは位置を変えない(identity の transform)",
          api.reedTileVisual(drag(0, 0), "other", 4, 4).transform === "translate(0px, 0px)",
          api.reedTileVisual(drag(0, 0), "other", 4, 4).transform);
        check("F-79b: 並び替えが終われば transform を残さない(静止時は none。§6.3 = DESIGN-SYSTEM.md:607)",
          api.reedTileVisual(null, "other", 4, 4).transform === "none",
          api.reedTileVisual(null, "other", 4, 4).transform);
      }

      // (d) 指を離したあと(settling)は、掴んでいたタイルも落ちる先のマスへアニメーションする。
      {
        const vis = api.reedTileVisual(drag(999, 999, true), "t2", home, 7);
        const t = parse(vis.transform);
        check("F-79b: 指を離すと掴んでいたタイルは落ちる先のマスへ動く(指の位置に固まらない)",
          t !== null && t.x === cells[7].left - cells[home].left && t.y === cells[7].top - cells[home].top,
          JSON.stringify(t));
        check("F-79b: 落ちる動きは rotate(0deg) を明示する(角度が補間されずに飛ぶのを防ぐ)",
          t !== null && t.deg === 0, JSON.stringify(t));
        check("F-79b: 落ちる動きもアニメーションする / 最前面のまま",
          vis.transition === api.REED_TILE_SLIDE_EASE && vis.zIndex === 2,
          `${vis.transition} / z=${vis.zIndex}`);
      }

      // (e) 動きの値は**新しく発明していない**。DESIGN-SYSTEM §6.3 の唯一の
      //     「元の位置へ戻す動き」(transform 0.32s cubic-bezier(.22,.61,.36,1) / 後始末 320ms)と同値。
      check("F-79b: タイルの動きの値は §6.3 の横スワイプの戻りと同じ(新しい値を発明していない)",
        api.REED_TILE_SLIDE_EASE === api.SWIPE_BACK_EASE
        && api.REED_TILE_SETTLE_MS === api.SWIPE_BACK_SETTLE_MS,
        `${api.REED_TILE_SLIDE_EASE} / ${api.REED_TILE_SETTLE_MS}ms`);
      check("F-79b: §6.3 が定める値そのもの(定数の言い換えではなく文字列で照合)",
        api.REED_TILE_SLIDE_EASE === "transform 0.32s cubic-bezier(.22,.61,.36,1)"
        && api.REED_TILE_SETTLE_MS === 320,
        `${api.REED_TILE_SLIDE_EASE} / ${api.REED_TILE_SETTLE_MS}`);
      // 並び順の確定は指を離した瞬間。落ちる 320ms を待つと、その間に画面が変わったとき消える。
      {
        const grid = srcOfFn(src, "ReedTileGrid");
        // 落ちる動きのタイマーより**前**に onReorder を呼ぶ(タイマーの中に入れない)。
        check("F-79b: 並び順の確定は指を離した瞬間(落ちる動きの完了を待たない)",
          /settleTimerRef\.current = setTimeout\(\(\) => \{ settleTimerRef\.current = null; setDrag\(null\); \}, REED_TILE_SETTLE_MS\);\s*\r?\n\s*onReorder\(orderRef\.current\);/.test(grid)
          && !/setTimeout\([^\n]*onReorder/.test(grid));
        check("F-79b: 落ちている最中に次のジェスチャーが来たら、その場で落とし切る",
          /if \(settleTimerRef\.current\) \{ cancelSettle\(\); setDrag\(null\); \}/.test(grid));
      }
    }

    // --- 25.5c 【F-79a の差し戻し】どの終わり方でも track は必ず元へ戻る ------------
    // DESIGN-SYSTEM §6.3:「ジェスチャーの終わり方は3つ…これを取り違えると**画面が
    // ずれたまま無期限に固着する**」。F-79a の初版は**4つ目の終わり方(旗が立った)を増やして
    // 戻す処理を持たせなかった**ため、押したまま横へ 8px ずらして長押しを成立させると
    // track が translateX(calc(0% - 8px)) のまま固着した(審査役の実測: grid の left 24 → 16)。
    //
    // 【この検査が綴りを見ないこと】前版の検査は
    //   `if (isReedTileDragActive()) { st.current = null; return; }` が2箇所あること
    // しか見ておらず、**戻す処理の有無を1つも見ていなかった**(だから PASS 5828 のまま通った)。
    // ここは判定(swipePagerEndKind)と後始末(swipePagerTrackStyle)を**実行**し、
    // 「終わり方の全パターン × track に残る値」を総当たりで突き合わせる。
    {
      const EASE = "transform 0.32s cubic-bezier(.22,.61,.36,1)";
      const W = 375, COUNT = 2;
      const TH = api.swipeBackThreshold(W);   // = 75。しきい値の規則は §6.3 でアプリ内に1つ
      check("F-79a: しきい値は §6.3 の規則(幅の20%)から来ている",
        TH === W * api.SWIPE_BACK_THRESHOLD_RATIO && TH === 75, `${TH}px`);

      // (a) 終わり方は4通り。**どれが出るか**を実行で確かめる。
      const kind = (h, flag, dx, i) => api.swipePagerEndKind(h, flag, dx, W, i, COUNT);
      check("F-79a: 横と確定していないジェスチャーは idle(track を触っていない)",
        kind(false, false, 0, 0) === "idle" && kind(undefined, false, 0, 0) === "idle"
        && kind(false, true, -200, 0) === "idle",
        `${kind(false, false, 0, 0)} / ${kind(undefined, false, 0, 0)}`);
      check("F-79a: 旗が立っていたら行き先を判定せず drop(しきい値を越えていても)",
        kind(true, true, -200, 0) === "drop" && kind(true, true, -8, 0) === "drop"
        && kind(true, true, 200, 1) === "drop",
        `${kind(true, true, -200, 0)} / ${kind(true, true, -8, 0)}`);
      check("F-79a: しきい値を越えて行き先があれば advance",
        kind(true, false, -TH, 0) === "advance" && kind(true, false, TH, 1) === "advance",
        `${kind(true, false, -TH, 0)} / ${kind(true, false, TH, 1)}`);
      check("F-79a: しきい値未満は settle(戻す)",
        kind(true, false, -TH + 0.01, 0) === "settle" && kind(true, false, TH - 0.01, 1) === "settle"
        && kind(true, false, -8, 0) === "settle",
        `${kind(true, false, -TH + 0.01, 0)} / ${kind(true, false, -8, 0)}`);
      check("F-79a: 行き先が無い向き(端)はしきい値を越えても settle",
        kind(true, false, 200, 0) === "settle" && kind(true, false, -200, COUNT - 1) === "settle",
        `${kind(true, false, 200, 0)} / ${kind(true, false, -200, COUNT - 1)}`);

      // (b) **不変条件**: 横と確定した(= track に translateX を書いた)ジェスチャーは、
      //     どの終わり方を通っても track が元へ戻るか、React が書き直す予約(advance)が入る。
      //     総当たり: 旗 × dx(端まで含む) × index。1つでも「戻らない」が出れば落ちる。
      {
        const bad = [];
        let n = 0;
        for (const flag of [false, true]) {
          for (const i of [0, 1]) {
            for (const dx of [-300, -TH - 1, -TH, -TH + 1, -80, -8, -0.5, 0, 0.5, 8, 80, TH - 1, TH, TH + 1, 300]) {
              n++;
              const k = api.swipePagerEndKind(true, flag, dx, W, i, COUNT);
              const style = api.swipePagerTrackStyle(k, i, EASE);
              // 横と確定している以上、後始末が「何も書かない」であってはならない
              if (style === null) { bad.push(`flag=${flag} i=${i} dx=${dx} → ${k} で何も書かない`); continue; }
              // transition は必ず EASE へ戻す(ドラッグ中に none にしてあるため)
              if (style.transition !== EASE) { bad.push(`flag=${flag} i=${i} dx=${dx} → transition=${style.transition}`); continue; }
              // transform: advance 以外は元の位置そのもの / advance は React が書く(null)
              const want = k === "advance" ? null : `translateX(${-i * 100}%)`;
              if (style.transform !== want) bad.push(`flag=${flag} i=${i} dx=${dx} → ${k} transform=${style.transform} 期待 ${want}`);
            }
          }
        }
        check("F-79a: 総当たりが空回りしていない", n === 60, `${n}通り`);
        check("F-79a: 横と確定したジェスチャーは、どの終わり方でも track が元へ戻る(または React が書き直す)",
          bad.length === 0, bad.slice(0, 3).join(" | "));
      }
      // (c) 旗が立った終わり方(= 差し戻しの原因)を名指しで固定する。
      //     8px だけ横へずらして長押しが成立した場面: 元の位置(0%)へ戻ることが要件。
      {
        const k = api.swipePagerEndKind(true, true, -8, W, 0, COUNT);
        const style = api.swipePagerTrackStyle(k, 0, EASE);
        check("F-79a: 8px ずらして長押しが成立 → drop で translateX(0%) へ戻す(ずれたまま残さない)",
          k === "drop" && style && style.transform === "translateX(0%)" && style.transition === EASE,
          `${k} / ${JSON.stringify(style)}`);
        const k1 = api.swipePagerEndKind(true, true, -8, W, 1, COUNT);
        // null 安全にしておく。ここで例外を投げるとハーネスが落ち、**以降の検査が全部消える**
        // (変異試験で R2 がクラッシュとして出て、何が壊れたのか読めなくなった)。
        const s1 = api.swipePagerTrackStyle(k1, 1, EASE);
        check("F-79a: 2ページ目にいるときは 2ページ目の位置へ戻す(0% に飛ばさない)",
          s1 !== null && s1.transform === "translateX(-100%)", JSON.stringify(s1));
      }
      // (d) idle は「1px も動かしていない」ときだけ。ここで書いてしまうと、
      //     縦スクロール中に transform が付いて position:fixed の暗幕が壊れる(§6.3)。
      check("F-79a: idle は何も書かない(静止時に transform を残さない)",
        api.swipePagerTrackStyle("idle", 0, EASE) === null
        && api.swipePagerTrackStyle("idle", 1, EASE) === null);

      // (d2) 【新設】**どのページへ行くか**。前版は「戻るか否か」しか見ておらず、
      //      進む向きを反転する変異(`dx < 0 ? i - 1 : i + 1`)が**生存した**(審査役 A8)。
      //      向きは純関数に閉じ込め、左右と端を実行で確かめる。
      {
        const nx = (kind, dx, i, n) => api.swipePagerNextIndex(kind, dx, i, n);
        check("F-79a: 指が左へ(dx<0)なら**次の**ページ",
          nx("advance", -100, 0, 3) === 1 && nx("advance", -100, 1, 3) === 2,
          `${nx("advance", -100, 0, 3)} / ${nx("advance", -100, 1, 3)}`);
        check("F-79a: 指が右へ(dx>0)なら**前の**ページ",
          nx("advance", 100, 2, 3) === 1 && nx("advance", 100, 1, 3) === 0,
          `${nx("advance", 100, 2, 3)} / ${nx("advance", 100, 1, 3)}`);
        check("F-79a: 端では行き先が無い(先頭で右・末尾で左は動かない)",
          nx("advance", 100, 0, 3) === 0 && nx("advance", -100, 2, 3) === 2,
          `${nx("advance", 100, 0, 3)} / ${nx("advance", -100, 2, 3)}`);
        check("F-79a: advance 以外はどれも今のページのまま(中断で子タブが動かない)",
          ["settle", "drop", "idle", "none"].every((k) =>
            nx(k, -300, 1, 3) === 1 && nx(k, 300, 1, 3) === 1),
          ["settle", "drop", "idle", "none"].map((k) => `${k}:${nx(k, -300, 1, 3)}`).join(" "));
        // 判定と行き先を通しで確かめる(登録=0 / 比較=1 の2ページ、幅 327 の実測値)
        {
          const W2 = 327, TH2 = api.swipeBackThreshold(W2);   // 65.4
          const go = (dx, i, interrupted) => {
            const k = api.swipePagerEndKind(true, interrupted, dx, W2, i, 2);
            return api.swipePagerNextIndex(k, dx, i, 2);
          };
          check("F-79a: しきい値は 327×0.2 = 65.4(実測の viewport 幅)",
            Math.abs(TH2 - 65.4) < 1e-9, String(TH2));
          check("F-79a: 登録で左へ 65.4px 超 → 比較へ",
            go(-TH2, 0, false) === 1 && go(-100, 0, false) === 1, `${go(-TH2, 0, false)}`);
          check("F-79a: 登録で左へ 65.4px 未満 → 登録のまま",
            go(-TH2 + 0.01, 0, false) === 0 && go(-8, 0, false) === 0, `${go(-8, 0, false)}`);
          check("F-79a: 比較で右へ 65.4px 超 → 登録へ", go(TH2, 1, false) === 0, `${go(TH2, 1, false)}`);
          check("F-79a: **中断なら 100px 引いていても子タブは動かない**",
            go(-100, 0, true) === 0 && go(100, 1, true) === 1,
            `${go(-100, 0, true)} / ${go(100, 1, true)}`);
        }
        // (d3) 【F-83 新設】**どのイベントが中断か**。前版は `touchcancel` を `touchend` と
        //      同じ関数に配線し、中身でも区別していなかったので、ブラウザに縦スクロールを
        //      引き取られただけで子タブが替わった。イベント名 × 旗の総当たりで固定する。
        {
          const it = (t, flag) => api.swipePagerInterrupted(t, flag);
          check("F-83: touchcancel は旗の状態に関係なく必ず中断(ブラウザが取り上げた合図)",
            it("touchcancel", false) === true && it("touchcancel", true) === true,
            `旗なし:${it("touchcancel", false)} / 旗あり:${it("touchcancel", true)}`);
          check("F-83: touchend は旗の状態にそのまま従う(並び替え成立なら中断、そうでなければ行き先を判定)",
            it("touchend", true) === true && it("touchend", false) === false,
            `旗あり:${it("touchend", true)} / 旗なし:${it("touchend", false)}`);
          // 旗の値は真偽値以外(undefined 等)で来ることがある。中断側へ倒れないと
          // 「指を離しただけで進まない」死んだ操作になるので、false に倒すことを固定する。
          check("F-83: touchend で旗が真偽値でないときは中断にしない(進める判断を殺さない)",
            [undefined, null, 0, ""].every((v) => it("touchend", v) === false),
            [undefined, null, 0, ""].map((v) => `${JSON.stringify(v)}:${it("touchend", v)}`).join(" "));
          // 通しで確認: 同じ移動量でも touchcancel は進まず、touchend は進む
          {
            const W2 = 327;
            const run = (t, flag, dx, i) => {
              const k = api.swipePagerEndKind(true, api.swipePagerInterrupted(t, flag), dx, W2, i, 2);
              return { kind: k, next: api.swipePagerNextIndex(k, dx, i, 2) };
            };
            const c = run("touchcancel", false, -100, 0);
            const e = run("touchend", false, -100, 0);
            check("F-83: 同じ -100px でも touchcancel は登録のまま・touchend は比較へ進む(区別がついている)",
              c.kind === "drop" && c.next === 0 && e.kind === "advance" && e.next === 1,
              `cancel:${c.kind}→${c.next} / end:${e.kind}→${e.next}`);
          }
        }
        // コンポーネントは純関数の結果をそのまま使う(向きを component 側で作り直さない)
        // 綴りはコメントを外してから見る(行末コメントで空白の並びが変わるため)
        check("F-79a: 行き先はコンポーネントで作り直さず swipePagerNextIndex の値を渡す",
          /const next = swipePagerNextIndex\(kind, dx, i, count\);\s*\r?\n\s*if \(next !== i\) onIndexChange\(next\);/.test(codeOf(srcOfFn(src, "SwipePager")))
          && !/onIndexChange\([^)]*\?[^)]*:/.test(codeOf(srcOfFn(src, "SwipePager"))));
      }
      // (e) コンポーネント側は「書くだけ」。判定も値も純関数から取る。
      {
        const pager = srcOfFn(src, "SwipePager");
        check("F-79a: 終端は endGesture 1本に集約されている",
          /const endGesture = \(s, i, interrupted\) => \{/.test(pager)
          && /const kind = swipePagerEndKind\(s\?\.horizontal, interrupted, s\?\.dx \?\? 0,/.test(pager)
          && /const style = swipePagerTrackStyle\(kind, i, EASE\);/.test(pager)
          // **endGesture へ入る道は finishGesture の中の1本だけ**。1 は偶然の件数ではなく
          // 「終端を finishGesture 以外から呼べない = 捨てる処理を伴わずに終端だけ通せない」
          // という不変条件そのもの(上の `st.current = null` が1箇所であることと対になる)。
          && (() => {
            const c = codeOf(pager);
            const all = (c.match(/endGesture\(/g) || []).length;
            const inFin = ((c.slice(c.indexOf("const finishGesture"), c.indexOf("const onTouchStart")))
              .match(/endGesture\(/g) || []).length;
            return all === 1 && inFin === 1;
          })(),
          `endGesture の呼び出し ${(codeOf(pager).match(/endGesture\(/g) || []).length}回`);
        check("F-79a: track へ書くのは endGesture の中だけ(他に transform を書く経路が無い)",
          (codeOf(pager).match(/track\.style\.transform =/g) || []).length === 2,
          `${(codeOf(pager).match(/track\.style\.transform =/g) || []).length}箇所`);
        check("F-79a: endGesture は transition を必ず書き、transform は null のとき書かない",
          /track\.style\.transition = style\.transition;\s*\r?\n\s*if \(style\.transform !== null\) track\.style\.transform = style\.transform;/.test(pager));
        // 終わり方は3つの入口(touchmove の旗 / touchend / touchcancel)から来る。
        // 【F-83】touchend と touchcancel は**同じ終端に来るが、渡すイベント名が違う**。
        // 前版は `onTouchCancel={onTouchEnd}` と同じ関数を配線し、中身でも区別していなかった
        // ので、`touchcancel` が「指を離した」と同じ扱いになり**ブラウザに縦スクロールを
        // 引き取られただけで子タブが替わっていた**(統括の実測: 横へ -100px → touchcancel で
        // `translateX(0%)` → `translateX(-100%)`。同条件の touchend と 800ms 後の値が一致)。
        check("F-79a/F-83: touchend と touchcancel は同じ終端に来るが、イベント名を別々に渡す",
          /onTouchEnd=\{\(\) => onTouchFinish\("touchend"\)\} onTouchCancel=\{\(\) => onTouchFinish\("touchcancel"\)\}/.test(pager)
          && !/onTouchCancel=\{onTouchEnd\}/.test(pager));
        // 【F-83】戻すときの動きも SwipePager に自前で書かせない。
        // DESIGN-SYSTEM §6.3(:585)が「戻すときの動き transform 0.32s cubic-bezier(.22,.61,.36,1)
        // / 後始末 320ms — **この2つは必ず同じ値。片方だけ変えない**」と値を規範として固定しており、
        // タイル側(REED_TILE_SLIDE_EASE === SWIPE_BACK_EASE)は既に固定してあるのに、本家の
        // SwipePager だけ空いていた(審査役の変異: EASE を "transform 0.6s linear" にしても FAIL 0)。
        check("F-79a: SwipePager の戻す動きは SWIPE_BACK_EASE から取る(自前で書かない。§6.3「必ず同じ値」)",
          /const EASE = SWIPE_BACK_EASE;/.test(codeOf(pager))
          && !/const EASE = ["'`]/.test(codeOf(pager)),
          (codeOf(pager).match(/const EASE = [^\n;]+/) || ["見つからない"])[0]);
        // しきい値の綴りを SwipePager に持たせない(§6.3「アプリ内で1つだけ」)
        check("F-79a: SwipePager がしきい値を自前で書いていない(swipeBackThreshold に寄せた)",
          !/clientWidth \|\| 0;\s*\r?\n\s*const threshold = w \? w \* 0\.2 : 60;/.test(pager)
          && !/w \* 0\.2 : 60/.test(codeOf(pager)),
          (codeOf(pager).match(/0\.2/g) || []).join(",") || "0件");
      }
    }
  }

  // --- 25.6 個体詳細(正典 .backrow / .starrow / .memoline / .numrow / .bigbtn)--
  {
    const detail = srcOfFn(src, "ReedEvaluationDetail");
    check("個体詳細を走査できている", detail.length > 3000, `${detail.length}文字`);
    check("「‹ 一覧」で一覧へ戻れる", /‹ 一覧/.test(detail) && /onClick=\{onBack\}/.test(detail));
    check("見出しは shortBoxLabel(V16-3 の形)", /shortBoxLabel\(reed\.brand, reed\.strength, reeds\.map\(\(r\) => r\.brand\)\)/.test(detail));
    check("#番号は自由入力(空で自動採番の値が placeholder に出る)",
      /placeholder=\{String\(reedPosition\(reed, reeds\)\)\}/.test(detail)
      && /onBlur=\{commitPosition\}/.test(detail));
    check("#番号の欄は破線の下線で「書ける」ことを示す(正典)",
      /borderBottom: "1px dashed var\(--c-line-strong\)"/.test(detail));
    check("#番号の欄の当たり判定は 44px 以上(§5)",
      /width: 46, minHeight: "var\(--tap-min\)"/.test(detail));
    check("開封日は右に yyyy/mm/dd で出る", /\{formatYmd\(reed\.startDate\) \?\? "—"\}/.test(detail));
    check("メモは編集できる(placeholder 「メモ」)",
      /placeholder="メモ"/.test(detail) && /onBlur=\{commitMemo\}/.test(detail));
    check("メモの行は正典 .memoline(13px / 上下13px / 下に罫1本)",
      parseFloat(declOf(mockCss, ".memoline", "font-size")) === 13
      && /padding: "13px 0", fontSize: 13/.test(detail));
    // 測定データの4指標。**REED_COMPARE_METRICS の全キーが1つも欠けずに並ぶ**ことを集合で見る
    {
      const keys = api.REED_DETAIL_METRICS;
      check("個体詳細の指標は4つ", keys.length === 4, keys.join(","));
      check("個体詳細の指標の並びは正典どおり(平均差分 → HNR → 重心 → 音量)",
        keys.join(",") === "pitchCentsSigned,hnrDb,spectralCentroidHz,volumeDb", keys.join(","));
      check("個体詳細の指標は REED_COMPARE_METRICS の全キーと同じ集合(1つも落としていない)",
        new Set(keys).size === 4 && keys.every((k) => cmKeys.includes(k))
        && cmKeys.every((k) => keys.includes(k)),
        `${keys.join(",")} / ${cmKeys.join(",")}`);
      check("JSX は REED_DETAIL_METRICS をそのまま map する(間引いていない)",
        /REED_DETAIL_METRICS\.map\(\(key\) => \{/.test(detail)
        && !/REED_DETAIL_METRICS\.(slice|filter)\(/.test(detail));
      check("指標の定義(ラベル・単位・書式)は REED_COMPARE_METRICS から引く(写していない)",
        /REED_COMPARE_METRICS\.find\(\(x\) => x\.key === key\)/.test(detail));
    }
    check("測定データはタップで音名軸グラフに切り替わる(現行のまま)",
      /<TappableMetricCard/.test(detail) && /bare/.test(detail));
    check("測定データの空状態文言は現行のまま", detail.includes("このリードに紐づく測定データがまだありません"));
    // 「測定データ · nセッション · 開封n日」。一覧のタイルから落ちた情報の行き先
    check("nセッション / 未測定 / 開封n日 は reedDetailMetaLine が組み立てる",
      /\{reedDetailMetaLine\(reedSessions\.length, usageDays\(new Date\(\), reed\.startDate\)\)\}/.test(detail));
    check("セッションがあれば「nセッション」", api.reedDetailMetaLine(12, 34) === "測定データ · 12セッション · 開封 34日",
      api.reedDetailMetaLine(12, 34));
    check("セッションが0件なら「未測定」", api.reedDetailMetaLine(0, 34) === "測定データ · 未測定 · 開封 34日",
      api.reedDetailMetaLine(0, 34));
    check("開封日が未設定なら日数の節を出さない",
      api.reedDetailMetaLine(3, null) === "測定データ · 3セッション" && api.reedDetailMetaLine(0, null) === "測定データ · 未測定",
      `${api.reedDetailMetaLine(3, null)} / ${api.reedDetailMetaLine(0, null)}`);
    check("評価の推移グラフは残っている", detail.includes("<ReedScoreHistoryChart"));
    // 正典 .numrow の実寸(値19px + 単位11px / ラベル10.5px)
    {
      const card = srcOfFn(src, "TappableMetricCard");
      check("bare の既定は false(渡していない画面へ漏れない)", /bare = false/.test(card));
      // 【N-7 2026/08/16 本人指示による書き換え】正典の数字の列は .numrow(リード個体詳細)の
      // 1種になった。N-6 の .mrow 型(データタブの累計/最新の2行)は、データタブが常時表示の
      // 音名軸折れ線(検証27)へ移ったため**廃止**。
      // 寸法は BARE_ROW_STYLES が唯一の答えで、**モックの CSS から読んだ値と突き合わせる**
      // (実装から写した値ではないので、片方を書き換えれば落ちる)。
      const rowStyles = new Function(`${extractConst("BARE_ROW_STYLES")} return BARE_ROW_STYLES;`)();
      check("bare の既定の型は numrow(リード個体詳細の見た目のまま)", /rowStyle = "numrow"/.test(card));
      for (const [name, sel] of [["numrow", ".numrow"]]) {
        check(`bare(${name})の値は正典 ${sel} .v と同じ`,
          rowStyles[name].value === parseFloat(declOf(mockCss, `${sel} .v`, "font-size")),
          `実装 ${rowStyles[name].value} / 正典 ${declOf(mockCss, `${sel} .v`, "font-size")}`);
        check(`bare(${name})のラベルは正典 ${sel} .l と同じ`,
          rowStyles[name].label === parseFloat(declOf(mockCss, `${sel} .l`, "font-size")),
          `実装 ${rowStyles[name].label} / 正典 ${declOf(mockCss, `${sel} .l`, "font-size")}`);
        check(`bare(${name})の単位は正典 ${sel} .v small と同じ`,
          rowStyles[name].unit === parseFloat(declOf(mockCss, `${sel} .v small`, "font-size")),
          `実装 ${rowStyles[name].unit} / 正典 ${declOf(mockCss, `${sel} .v small`, "font-size")}`);
      }
      check("bare(numrow)は副次の行を持つ(正典 .numrow .b がある)",
        rowStyles.numrow.sub === parseFloat(declOf(mockCss, ".numrow .b", "font-size")),
        `実装 ${rowStyles.numrow.sub} / 正典 ${declOf(mockCss, ".numrow .b", "font-size")}`);
      // 【N-7】mrow 型の定義が残っていないこと(使い手の無い定義を残さない。L-13 の片側落ち防止)
      check("N-7: BARE_ROW_STYLES は numrow の1種だけ(mrow は本人指示 N-7 で廃止)",
        rowStyles.mrow === undefined && Object.keys(rowStyles).join(",") === "numrow",
        Object.keys(rowStyles).join(","));
      check("寸法は BARE_ROW_STYLES から引く(呼び出し側に数値を写していない)",
        /fontSize: fs\.value, fontWeight: 600, color: "var\(--c-ink\)"/.test(card)
        && /fontSize: fs\.label, color: "var\(--c-ink-3\)"/.test(card)
        && /fontSize: fs\.unit,/.test(card));
      check("bare の当たり判定は 44px 以上(§5)", /minHeight: "var\(--tap-min\)"/.test(card));
      // 【実測で踏んだ罠】1つがグラフに切り替わって幅100%になったとき、flex-basis 0 の
      // 残り3つは**同じ行で幅0まで潰れて見えないボタンになった**(実測 327/0/0/0)。
      // 折り返しの判定に使う最小幅を与えて次の行へ送る。
      check("bare の列は最小幅を持つ(開いたときに残りが幅0の見えないボタンにならない)",
        /flex: open \? "1 1 100%" : "1 1 0", minWidth: REED_NUMROW_MIN_PX/.test(card));
      check("その最小幅は4列が1行に収まる値(通常時の見た目を変えない)",
        api.REED_NUMROW_MIN_PX > 0
        && api.REED_NUMROW_MIN_PX * 4 <= 375 - api.REED_SIDE_PAD_PX * 2,
        `${api.REED_NUMROW_MIN_PX}×4 = ${api.REED_NUMROW_MIN_PX * 4} / 使える幅 ${375 - api.REED_SIDE_PAD_PX * 2}`);
      // 【定義の言い換えを書かない】「3×min + 行幅 > 行幅」は min > 0 なら**恒等的に真**で、
      // 何も守らない。守るべきは「0 ではないこと」そのもの(0 に戻すと同じ行で潰れる)。
      check("その最小幅は 0 ではない(0 だと開いたときに残り3つが同じ行で潰れる)",
        api.REED_NUMROW_MIN_PX > 0, `${api.REED_NUMROW_MIN_PX}px`);
      // 【N-7 2026/08/16 本人指示による書き換え】bare を渡すのはリードの個体詳細(numrow)だけに
      // なった(N-6 のデータタブ指標行 MetricRow は TappableMetricCard を使わない常時表示の
      // 折れ線へ変わった。検証27)。セッション詳細は従来の .tile のまま。
      // **どの関数が渡しているか**を集合で固定する
      // (件数だけを固定すると、部品をまとめる/分けるという正しい修正が落ちる)。
      const BARE_OWNERS = ["ReedEvaluationDetail"];
      const bareSites = (codeOf(src).match(/^\s*bare(?:$| rowStyle=)/gm) || []).length;
      const inBareOwners = BARE_OWNERS
        .reduce((n, fn) => n + (codeOf(srcOfFn(src, fn)).match(/^\s*bare(?:$| rowStyle=)/gm) || []).length, 0);
      check("bare を渡しているのはリード個体詳細だけ(集合の外に渡し手がいない)",
        bareSites === inBareOwners && inBareOwners === 1, `全体 ${bareSites} / 集合内 ${inBareOwners}`);
      check("セッション詳細は bare を渡さない(従来の .tile のまま)",
        !/\bbare\b/.test(codeOf(srcOfFn(src, "SessionDetailView"))));
    }
    // 3列ダイヤルの「—」(この節では並びだけ。値の往復は14節が見ている)
    check("ダイヤルの先頭の「—」は表示文字列も「—」",
      api.reedScoreText("rating", api.RATING_DIAL_UNRATED) === "—"
      && api.reedScoreText("thickness", api.RATING_DIAL_UNRATED) === "—");
    check("「—」を選ぶと未評価に戻る(commitReedScores が null を書ける)", (() => {
      const patch = api.commitReedScores({ rating: 3.7, thickness: 4, balance: 2, ratings: [] },
        { rating: null, thickness: 4, balance: 2 }, "2026-08-13T00:00:00.000Z");
      return patch !== null && patch.rating === null;
    })());
    check("「—」に戻しても履歴は1件だけ増える", (() => {
      const patch = api.commitReedScores({ rating: 3.7, thickness: 4, balance: 2, ratings: [] },
        { rating: null, thickness: 4, balance: 2 }, "2026-08-13T00:00:00.000Z");
      return patch.ratings.length === 1 && patch.ratings[0].rating === null;
    })());
    check("値が変わっていなければ「—」でも履歴を増やさない",
      api.commitReedScores({ rating: null, thickness: null, balance: null, ratings: [] },
        { rating: null, thickness: null, balance: null }, "2026-08-13T00:00:00.000Z") === null);
  }

  // --- 25.7 比較(正典の .selpill と4グラフ)----------------------------------
  {
    const cmp = srcOfFn(src, "ReedCompareTab");
    check("比較タブを走査できている", cmp.length > 2000, `${cmp.length}文字`);
    check("4グラフの並びは正典どおり(音量 → 平均差分 → HNR → 重心)",
      api.REED_COMPARE_CHART_KEYS.join(",") === "volumeDb,pitchCentsSigned,hnrDb,spectralCentroidHz",
      api.REED_COMPARE_CHART_KEYS.join(","));
    check("4グラフは REED_COMPARE_METRICS の全キーと同じ集合(1つも落としていない)",
      new Set(api.REED_COMPARE_CHART_KEYS).size === 4
      && api.REED_COMPARE_CHART_KEYS.every((k) => cmKeys.includes(k))
      && cmKeys.every((k) => api.REED_COMPARE_CHART_KEYS.includes(k)),
      `${api.REED_COMPARE_CHART_KEYS.join(",")} / ${cmKeys.join(",")}`);
    check("JSX は REED_COMPARE_CHART_KEYS をそのまま map する(間引いていない)",
      /REED_COMPARE_CHART_KEYS\.map\(\(key\) => \{/.test(cmp)
      && !/REED_COMPARE_CHART_KEYS\.(slice|filter)\(/.test(cmp));
    check("個体チップは正典 .selpill の寸法(12.5px / padding 4px 11px / 角丸999)",
      parseFloat(declOf(mockCss, ".selpill", "font-size")) === 12.5
      && /fontSize: 12\.5, padding: "4px 11px", borderRadius: 999/.test(cmp));
    check("選択中のチップは紺の塗り + 白文字(正典 .selpill.on)",
      /background: sel \? "var\(--c-accent\)" : "transparent"/.test(cmp)
      && /color: sel \? "var\(--c-on-accent\)" : "var\(--c-ink-2\)"/.test(cmp));
    check("選択中のチップに系列の線種見本が付く(色だけでは実線/破線が伝わらない)",
      /\{sel && styleById\.has\(r\.id\) && <SeriesSwatch style=\{styleById\.get\(r\.id\)\} \/>\}/.test(cmp));
    check("チップの当たり判定は 44px 以上(§5)",
      /minHeight: "var\(--tap-min\)", minWidth: "var\(--tap-min\)"/.test(cmp));
    check("「n枚選択中」は現行のまま出る", /\{selectedInBox\}枚選択中/.test(cmp));
    check("6本超過の告知は現行のまま", cmp.includes("先頭6枚を表示しています"));
    check("★一覧は正典どおり文字で書く(星の絵を使わない)",
      /★\$\{avg\.toFixed\(1\)\}/.test(cmp) && !/<StarRating/.test(cmp));
    check("フレーム数の脚注は現行のまま", /\$\{it\.frameCount\}フレーム/.test(cmp));
    check("空状態は2種とも残っている(リード未登録 / 未選択)",
      cmp.includes("比較するリードがありません") && cmp.includes("リードを選択すると比較グラフが表示されます"));
    check("フレーム数はモジュールの frameCountFor を使う(同じ集計を2箇所に書かない)",
      /const framesOf = \(reedId\) => frameCountFor\(sessions, reedId\);/.test(cmp));
  }

  // --- 25.8 落としていないこと(横スワイプ・スクロール位置・箱グルーピング)------
  {
    const tab = srcOfFn(src, "ReedsTab");
    check("登録⇄比較の横スワイプは残っている", /<SwipePager/.test(tab));
    check("詳細からの右スワイプで一覧へ・左スワイプで比較へ",
      /<SwipeBackArea onBack=\{closeReed\} onForward=\{openCompareFromReed\}>/.test(tab));
    check("一覧のスクロール位置の復元は残っている",
      /listScrollYRef\.current = window\.scrollY/.test(tab) && /window\.scrollTo\(0, y\)/.test(tab));
    check("箱グルーピングは groupReeds のまま", /const reedGroups = groupReeds\(reeds\);/.test(tab));
    check("子タブの「…」は登録タブのときだけ出す(正典の比較画面には無い)",
      /\{reedsSubTab === "register" && \(/.test(tab));
    check("モード中は「…」の代わりにキャンセルと実行が出る", /\{listMode === null \? \(/.test(tab));
    // 個体詳細も一覧・比較と同じ左右の余白の中に置く(詳細だけ 14px になっていた実測を潰した)
    check("個体詳細も同じ左右の余白の枠の中にある",
      /if \(evaluatingReed\) \{\s*\r?\n\s*return \(\s*\r?\n\s*<div style=\{\{ paddingLeft: REED_LIST_EXTRA_PAD_PX, paddingRight: REED_LIST_EXTRA_PAD_PX \}\}>/.test(tab));
    // 子タブの当たり判定(§5)。**見た目の間隔を変えずに**広げてあること
    check("子タブの文字の間隔は正典 .subtabs の gap と同じ",
      api.REED_SUBTAB_GAP_PX === parseFloat(declOf(mockCss, ".subtabs", "gap")),
      `実装=${api.REED_SUBTAB_GAP_PX} / 正典=${declOf(mockCss, ".subtabs", "gap")}`);
    check("子タブは行の gap を 0 にして左右に半分ずつ余白を入れる(文字の間隔は変わらない)",
      /gap: 0, marginLeft: -REED_SUBTAB_HALF_GAP_PX/.test(tab)
      && /padding: `0 \$\{REED_SUBTAB_HALF_GAP_PX\}px`/.test(tab));
    check("子タブの当たり判定は 44px 以上(§5)",
      /minHeight: "var\(--tap-min\)", minWidth: "var\(--tap-min\)"/.test(tab));
    // 【定義の言い換えを書かない】REED_SUBTAB_HALF_GAP_PX は REED_SUBTAB_GAP_PX / 2 と
    // 定義されているので、`HALF * 2 === GAP` は**恒等的に真**で何も守らない
    // (design/LOOP.md「構造上失敗し得ないアサーション」)。**正典の値と突き合わせる**。
    check("左右に入れる余白は正典の gap の半分(足すと文字の間隔が正典どおりになる)",
      api.REED_SUBTAB_HALF_GAP_PX === parseFloat(declOf(mockCss, ".subtabs", "gap")) / 2,
      `実装=${api.REED_SUBTAB_HALF_GAP_PX} / 正典の半分=${parseFloat(declOf(mockCss, ".subtabs", "gap")) / 2}`);
    // 追加シートの ± は正典ミニが height:40 だが、§5(機能側)を優先して 44 にしてある
    {
      const sheet = srcOfFn(src, "ReedBoxSheet");
      const pm = (sheet.match(/width: METRO_PM_W, height: "var\(--tap-min\)"/g) || []).length;
      check("追加シートの ± の当たり判定は 72×44(正典ミニの 40 ではなく §5 を優先)", pm === 2, `${pm}箇所`);
      check("正典ミニの .pmt は 40px(この差は意図した逸脱であることの裏取り)",
        parseFloat(declOf(mockCss, ".pmt", "height") || "0") === 48
        && /class="pmt" style="height:40px"/.test(mock),
        `.pmt=${declOf(mockCss, ".pmt", "height")} / ミニの上書き=${/class="pmt" style="height:40px"/.test(mock)}`);
    }
  }
  console.log("  -> done");
}

// ============================================================
// 検証26: N-6 データタブ(My Data 子タブ)を正典どおりにする
//   A 正典 north-star-measure.html の K画面/mini と実装の寸法を突き合わせる
//   B ヒーロー: 脚注(セッション数)の撤去 / 期間セレクタは素テキスト + ▾
//   C 指標行: 累計(全期間)と最新の2行。累計は期間セレクタと連動しない
//   D セッション一覧: 見出し・塗りボタン・ピル4つ・副次行(録音時間は最後の t から)
//   E 「…」: 押せる項目が無ければ出さない(F-77 の罠)
//   F 機能を1つも落としていないこと(集合で確かめる)
//
// 【この節の作り方】値を実装から写して並べるのではなく、**正典の CSS を読んで突き合わせる**
// (design/LOOP.md「定数の定義を言い換えるテストは書かない」)。
// **ハーネスは JSX を評価しない。** 配線はソース文字列の検査にとどまり、
// 「描画が正しい」ことの証明にはならない。純関数にできたものだけ実行で確かめている。
// ============================================================
console.log("\n========== 検証26: N-6 データタブ(正典 north-star-measure.html との突き合わせ) ==========");
{
  const mock = readFileSync(join(__dirname, "..", "design", "north-star-measure.html"), "utf8");
  const parseCss = (text) => {
    const out = [];
    const body = text.replace(/\/\*[\s\S]*?\*\//g, " ");
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const sels = m[1].split(",").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
      out.push({ sels, body: m[2] });
    }
    return out;
  };
  const declsOf = (block) => (block || "").split(";").map((d) => d.trim()).filter(Boolean)
    .map((d) => { const i = d.indexOf(":"); return { name: d.slice(0, i).trim(), value: d.slice(i + 1).trim() }; });
  const ruleOf = (rules, sel) => rules.filter((r) => r.sels.includes(sel));
  const declOf = (rules, sel, name) => {
    let v = null;
    for (const r of ruleOf(rules, sel)) for (const d of declsOf(r.body)) if (d.name === name) v = d.value;
    return v;
  };
  const mockCss = parseCss((mock.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1]);
  // 走査が空回りしていないこと(空回りすると以降が全部「一致」になる)
  check("26.0 正典モックの CSS を走査できている(データタブの規則が揃っている)",
    mockCss.length >= 60, `${mockCss.length}規則`);
  for (const sel of [".hero", ".hero .lbl", ".hero .num", ".hero .u", ".hero .pill", ".hero .sd",
    ".mrow", ".mrow .rl", ".mrow .v", ".mrow .l", ".shead", ".shead .t", ".impbtn", ".fpills",
    ".fp", ".srow", ".srow .d", ".chev"]) {
    check(`26.0 正典に ${sel} の規則がある`, ruleOf(mockCss, sel).length === 1,
      `${ruleOf(mockCss, sel).length}件`);
  }

  const myDataSection = srcOfFn(src, "MyDataSection");
  const myDataPage = srcOfFn(src, "MyDataPage");
  const metricRow = srcOfFn(src, "MetricRow");
  const lab = srcOfFn(src, "AnalysisLabView");

  // --- 26.1 ヒーロー(正典 .hero) ---------------------------------------------
  {
    check("26.1 ヒーローの角丸は正典 .hero と同じ",
      new RegExp(`borderRadius: ${parseFloat(declOf(mockCss, ".hero", "border-radius"))},`).test(myDataSection),
      `正典=${declOf(mockCss, ".hero", "border-radius")}`);
    check("26.1 ヒーローの内側余白は正典 .hero と同じ",
      myDataSection.includes(`padding: "${declOf(mockCss, ".hero", "padding")}"`),
      `正典=${declOf(mockCss, ".hero", "padding")}`);
    check("26.1 主数値の大きさは正典 .hero .num と同じ",
      new RegExp(`fontSize: ${parseFloat(declOf(mockCss, ".hero .num", "font-size"))}, fontWeight: 600`).test(myDataSection),
      `正典=${declOf(mockCss, ".hero .num", "font-size")}`);
    check("26.1 単位(¢)の大きさは正典 .hero .u と同じ",
      new RegExp(`fontSize: ${parseFloat(declOf(mockCss, ".hero .u", "font-size"))}, color: "#9DB3D6"`).test(myDataSection),
      `正典=${declOf(mockCss, ".hero .u", "font-size")}`);
    check("26.1 評価ピルの余白は正典 .hero .pill と同じ",
      myDataSection.includes(`padding: "${declOf(mockCss, ".hero .pill", "padding")}"`),
      `正典=${declOf(mockCss, ".hero .pill", "padding")}`);
    check("26.1 副次行の上余白は正典 .hero .sd と同じ",
      new RegExp(`color: "#9DB3D6", marginTop: ${parseFloat(declOf(mockCss, ".hero .sd", "margin-top"))}`).test(myDataSection),
      `正典=${declOf(mockCss, ".hero .sd", "margin-top")}`);
    // 【本人指示「青いカード部分のテキストが多い」】脚注「1ヶ月 ・ n セッション」を消した。
    // **綴りを禁じるのではなく**、セッション数の数え上げが「比較以外」に使われていないことで見る
    // (`const n = points.length;` と2行に分けて描く抜け道を塞ぐ。F-78 の網と同じ形)。
    // **これは「脚注が無い」ことの十分条件ではない**(別の変数で数えれば通る)ので名前もそう名乗る。
    {
      const body = codeOf(myDataSection);
      const bad = [];
      const re = /\bpoints\.length\b/g;
      let m;
      while ((m = re.exec(body)) !== null) {
        const after = body.slice(m.index + m[0].length, m.index + m[0].length + 12);
        if (!/^\s*(===|!==|>=|<=|>|<)/.test(after)) bad.push(body.slice(Math.max(0, m.index - 30), m.index + 20).replace(/\s+/g, " "));
      }
      check("26.1 ヒーローでセッション数を比較以外に使っていない(脚注を変数経由で描く経路を塞ぐ。十分条件ではない)",
        bad.length === 0, bad.slice(0, 2).join(" | ") || "0件");
      check("26.1 その比較の用途は実在する(走査が空回りしていない)",
        /\bpoints\.length === 0\b/.test(body));
    }
    // 期間セレクタは枠も地も持たない素のテキスト + ▾(F-72 の作法。正典 .hero .lbl の「1ヶ月 ▾」)
    {
      const i = myDataSection.indexOf('aria-label="集計する期間を選ぶ"');
      const tag = i === -1 ? "" : myDataSection.slice(myDataSection.lastIndexOf("<button", i), myDataSection.indexOf("</button>", i));
      check("26.1 期間セレクタのボタンを走査できている", tag.length > 100, `${tag.length}文字`);
      check("26.1 期間セレクタは地も枠も持たない(型のクラスも持たない)",
        /background: "none", border: "none"/.test(tag) && !/\bctl-(state|plain|pill)\b/.test(tag),
        tag.replace(/\s+/g, " ").slice(0, 200));
      check("26.1 期間セレクタには ▾ が付く(押せば選択肢が出ることを形で示す。F-72)",
        /\{rangeLabel\} ▾/.test(tag), tag.replace(/\s+/g, " ").slice(0, 200));
      // 【実測で踏んだ罠】高さだけ 44 にしても、「昨日 ▾」のように短い値では**幅が 39px**しか
      // 無く §5 を割る(375×812 で elementFromPoint を整数グリッド1px刻みに走査)。
      // 文字は flex-end に寄せてあるので、広げるのは左の余白だけ = 見た目は動かない。
      check("26.1 期間セレクタの当たり判定は縦横とも 44pt(§5。短い値でも幅が足りる)",
        /minHeight: "var\(--tap-min\)", minWidth: "var\(--tap-min\)"/.test(tag)
        && /justifyContent: "flex-end"/.test(tag), tag.replace(/\s+/g, " ").slice(0, 240));
      check("26.1 期間セレクタの文字色は正典 .hero .lbl の #B9C9E4",
        /fontSize: 12, color: "#B9C9E4"/.test(tag));
    }
    // 期間の候補は9種すべて残っている(機能を落とさない)
    {
      const ranges = new Function(`${extractConst("MY_DATA_RANGES")} return MY_DATA_RANGES;`)();
      check("26.1 期間の候補は9種すべて残っている",
        ranges.length === 9 && ranges.map((r) => r.key).join(",") === "yesterday,1w,1m,3m,6m,1y,3y,5y,all",
        ranges.map((r) => r.key).join(","));
      check("26.1 期間の選択肢はシートに MY_DATA_RANGES から流し込む(綴りを2箇所に置かない)",
        /items=\{rangeOptions\.map\(\(o\) => \(\{ key: o\.key, label: o\.label \}\)\)\}/.test(myDataSection));
    }
  }

  // --- 26.2 ヒーローの母集団と、指標の置き場所(N-7 で折れ線へ) ------------------
  // 【N-7 2026/08/16 本人指示による書き換え】この節の旧主張のうち次は**仕様ごと廃止**された:
  //   ・「累計/最新の2行(数字の列)」→ 常時表示の折れ線が引き継ぐ(累計 = 期間セレクタ「全期間」/
  //     最新の数字 = 行ヘッダの「今日」)。行の寸法・並びの検査は検証27(正典 data-tab-final.html)へ。
  //   ・「ヒーローの数字タップで音名グラフを開閉」→ 常時表示になったため入口(ボタン・aria-label・
  //     開閉状態)ごと廃止。「どの音がどれだけズレているか」は消えていない(検証27 が常時表示を固定)。
  // 残っている主張(母集団・fmt の一本化・紺の面の外)はここで引き続き固定する。
  {
    // 【N-7】母集団: 奏者=自分 かつ 選択中の楽器種別(dataSax)。セッションの楽器種別は
    // `s.saxType ?? 現在のsaxType`(既存のフォールバック規則。新規則を発明しない。N7-SPEC 3)。
    check("26.2 allMySessions は期間で絞られていない(奏者と楽器種別で絞る。N-7)",
      /const allMySessions = sessions\.filter\(\(s\) => s\.performer === "自分" && \(s\.saxType \?\? saxType\) === dataSax\);/.test(myDataSection));
    // 【N-6】期間で絞ったフレームは**ヒーローと4本の折れ線だけ**が使う。
    // 主役の数字(overall)と折れ線の期間側が**同じ periodFrames から出る**(母集団がずれると
    // 「+1.2¢ と出ているのにグラフは別の期間」という読み違いが起きる)。
    check("26.2 期間で絞ったフレームは1度だけ作り、ヒーローの平均がそれを使う",
      /const periodFrames = mySessions\.flatMap\(\(s\) => s\.frames \|\| \[\]\);/.test(myDataSection)
      && /const overall = computeFrameMetrics\(periodFrames\);/.test(myDataSection)
      && !/frames=\{mySessions/.test(myDataSection));
    // 【N-7→N-8】ピッチの折れ線はヒーローと同じ母集団の2本(期間 = periodFrames /
    // 濃い線 = dayFrames(今日または直近の記録日。N-8))。系列の組み立ては myDataChartSeries の
    // 1箇所(実行検証は検証27)。紺の面の上なので色だけ HERO_CHART_SERIES_STYLES(検証28)。
    check("26.2 ピッチの折れ線はヒーローと同じ母集団から2系列を作る(myDataChartSeries 経由)",
      /const pitchSeries = myDataChartSeries\(rangeLabel, periodFrames, dayFrames, dayLabel, HERO_CHART_SERIES_STYLES\);/.test(myDataSection)
      && /series=\{pitchSeries\}/.test(myDataSection),
      (myDataSection.match(/const pitchSeries = [^\n;]+/) || ["見つからない"])[0]);
    // 【N-7】数字タップの入口が**残っていない**こと(常時表示と開閉ボタンが二重に生きると、
    // 同じグラフが2枚出る)。開閉状態の綴りが1つも無いことを動く側(コメント除去後)で見る。
    check("26.2 N-7: 数字タップの開閉(heroNoteChartOpen)が動く側に残っていない",
      !/heroNoteChartOpen/.test(codeOf(src)) && !/setHeroNoteChartOpen/.test(codeOf(src)));
    // 【N-6→N-7】画面の数字は fmt を通し、単位は heroMetric.unit の1箇所から取る
    // (以前は直書きの符号分岐が 0 のときだけ食い違いを作った。ボタンでは無くなったが
    //  数字の組み立ての一本化は変わらず固定する)。
    check("26.2 ヒーローの数字は fmt を通し、単位は heroMetric.unit の1箇所から取る",
      /const heroNumText = [\s\S]{0,140}?heroMetric\.fmt\(displayVal\)/.test(myDataSection)
      && /\{heroNumText\}\s*\r?\n\s*<span style=\{\{ fontSize: 21, color: "#9DB3D6" \}\}>\{heroMetric\.unit\}<\/span>/.test(myDataSection));
    // ラベル・単位・書式は MY_DATA_METRICS が唯一の答え(リテラルを直書きしない)
    check("26.2 ピッチのカードのグラフはラベル・単位・書式を MY_DATA_METRICS から取る(直書きしない)",
      /const heroMetric = MY_DATA_METRICS\.find\(\(m\) => m\.key === "pitchCentsSigned"\);/.test(myDataSection)
      && /label=\{heroMetric\.label\} unit=\{heroMetric\.unit\} metricKey=\{heroMetric\.key\}/.test(myDataSection)
      && /fmt=\{heroMetric\.fmt\}/.test(myDataSection)
      && !/label="平均差分" unit="¢"/.test(myDataSection));
    // 【N-8 2026/08/16 本人指示による書き換え】旧主張「グラフ本体は紺の面の外」は**仕様ごと廃止**:
    // 本人指示「濃い青のカードの折れ線グラフを音ごとの平均の折れ線グラフに変更」により、
    // ピッチの折れ線は**ヒーローの紺の面の中**(旧スパークラインの場所)に入った。
    // 紺の上で読めるよう、色は hero 変形(HERO_CHART_*)が持つ(検証28)。
    // ここでは「中に居る」ことを、ヒーローの開きタグからグラフまでの <div> の深さで見る
    // (面の外へ出すと深さが 0 になる)。
    {
      const iHero = myDataSection.indexOf('<div style={{ background: "var(--c-accent)"');
      const iChart = myDataSection.indexOf("<NoteAxisLineChart");
      const seg = iHero >= 0 && iChart > iHero ? myDataSection.slice(iHero, iChart) : "";
      const depth = (seg.match(/<div\b/g) || []).length - (seg.match(/<\/div>/g) || []).length;
      check("26.2 N-8: ピッチの折れ線はヒーローの紺の面の中に居る(<div> の深さ ≥ 1)",
        iHero >= 0 && iChart > iHero && depth >= 1, `面@${iHero} / グラフ@${iChart} / 深さ${depth}`);
    }
    // 【目安Δ】常時表示をやめてグラフの凡例へ移した(情報は失わせない)
    // 【N-6】§6.0 で「なお生きている」と明記された §5(44pt)。行・ピル・期間セレクタには
    // 検査があったのに、**この案件が新設した子タブと進捗棒だけ空いていた**(審査役の変異が生存)。
    {
      // 子タブと進捗棒は AnalysisLabView(データタブ全体)が描く
      const page = srcOfFn(src, "AnalysisLabView");
      check("26.2 データタブの子タブは 44pt の当たり判定を持つ(§5)",
        /aria-pressed=\{dataSubTab === t\.key\}[\s\S]{0,200}?minHeight: "var\(--tap-min\)", minWidth: "var\(--tap-min\)"/.test(page));
      // 進捗棒の細さは正典 mini の値。CSS ではなく正典 HTML のインラインなので
      // **正典から読む**(期待値をここに写すと、正典が変わっても落ちない)。
      {
        const iMini = mock.indexOf("読み込み中");
        const bar = iMini < 0 ? "" : mock.slice(iMini, iMini + 400);
        const h = (/height:\s*(\d+)px;background:var\(--line\)/.exec(bar) || [])[1];
        check("26.2 正典から進捗棒の高さを読めている(空回りしていない)", h !== undefined, `正典=${h}`);
        check("26.2 アップロードの進捗棒は正典と同じ細さ",
          h !== undefined && new RegExp(`borderRadius: 2, height: ${h},`).test(page), `正典=${h}px`);
      }
    }
    // 【N-8 2026/08/16 本人指示による書き換え】旧主張「目安との差(Δ)は行ではなくグラフへ渡す」は
    // **仕様ごと廃止**: 「目安は表示不要で、対象期間の平均と今日の平均だけでok」により、
    // My Data の全グラフから目安の破線と Δ を外した(絶対の主張は検証28)。
    // グラフ部品(NoteAxisLineChart)と TappableMetricCard の目安の仕組みそのものは
    // **他画面(リード詳細・セッション詳細)のために従来のまま**であることをここで固定する。
    {
      const chart = srcOfFn(src, "NoteAxisLineChart");
      check("26.2 グラフ部品は Δ を「目安」の凡例の隣に出す仕組みを保つ(破線が出ているときだけ。他画面用)",
        /\{idealDiffText && <span style=\{\{ color: "var\(--c-accent\)" \}\}>\{idealDiffText\}<\/span>\}/.test(chart)
        && /\{idealByIdx && hasData && \(/.test(chart));
      check("26.2 TappableMetricCard は idealDiffText をグラフへそのまま渡す(他画面用)",
        /idealDiffText=\{idealDiffText\}/.test(srcOfFn(src, "TappableMetricCard")));
    }
    // 【N-7 2026/08/16 本人指示による書き換え】旧「数字はタップで音名軸グラフに切り替わる
    // (TappableMetricCard のまま)」は廃止。指標行は**常時表示**の NoteAxisLineChart になった。
    check("26.2 N-7: 指標行は常時表示の NoteAxisLineChart(タップ切り替えの TappableMetricCard を使わない)",
      /<NoteAxisLineChart/.test(metricRow) && !/<TappableMetricCard/.test(metricRow));
  }

  // --- 26.3 セッション一覧(正典 .shead / .fpills / .srow) ----------------------
  {
    check("26.3 見出しの行の余白は正典 .shead と同じ",
      myDataPage.includes(`padding: "${declOf(mockCss, ".shead", "padding")}"`),
      `正典=${declOf(mockCss, ".shead", "padding")}`);
    check("26.3 見出しの文字は正典 .shead .t と同じ",
      new RegExp(`fontSize: ${parseFloat(declOf(mockCss, ".shead .t", "font-size"))}, fontWeight: ${declOf(mockCss, ".shead .t", "font-weight")}`).test(myDataPage),
      `正典=${declOf(mockCss, ".shead .t", "font-size")}/${declOf(mockCss, ".shead .t", "font-weight")}`);
    check("26.3 見出しは絞り込み中だけ分数(それ以外は総数)",
      /\{sessionFilterActive \? `\$\{filteredSessions\.length\}\/\$\{sessions\.length\}` : sessions\.length\}/.test(myDataPage));
    check("26.3 フィルタピルの余白・文字は正典 .fp と同じ",
      myDataPage.includes(`padding: "${declOf(mockCss, ".fp", "padding")}"`)
      && new RegExp(`fontSize: ${parseFloat(declOf(mockCss, ".fp", "font-size"))},`).test(myDataPage),
      `正典=${declOf(mockCss, ".fp", "padding")} / ${declOf(mockCss, ".fp", "font-size")}`);
    check("26.3 ピルの並びの余白は正典 .fpills と同じ",
      myDataPage.includes(`padding: "${declOf(mockCss, ".fpills", "padding")}"`),
      `正典=${declOf(mockCss, ".fpills", "padding")}`);
    check("26.3 一覧の行の余白は正典 .srow と同じ",
      myDataPage.includes(`padding: "${declOf(mockCss, ".srow", "padding")}"`),
      `正典=${declOf(mockCss, ".srow", "padding")}`);
    check("26.3 一覧の行の日時は正典 .srow .d と同じ大きさ",
      new RegExp(`fontSize: ${parseFloat(declOf(mockCss, ".srow .d", "font-size"))}, color: "var\\(--c-ink\\)"`).test(myDataPage),
      `正典=${declOf(mockCss, ".srow .d", "font-size")}`);
    // 沈めた「絞り込み」ブロックは撤去した(正典に無い)。地を持つ小ブロックが残っていないこと。
    check("26.3 沈めた「絞り込み」ブロックが残っていない",
      !codeOf(myDataPage).includes("絞り込み")
      && !/background: "var\(--c-surface\)"/.test(codeOf(myDataPage)),
      (codeOf(myDataPage).match(/background: "var\(--c-surface\)"/g) || []).join(",") || "0件");
    // 【F-86 で置き換え】本人指示(実機 2026/08/15)「セッションの絞り込みにも枠線は不要」。
    // 旧主張「フィルタピルは輪郭だけ(A型 .ctl-state)」は本人指示に反するので撤回する
    // (正典 .fp は輪郭だが、**本人の実機指示が正典より上位**。F-75 / F-77 と同じ扱い)。
    // 新しい主張は3つ。**この3つが揃って初めて「枠線を消したが寸法は動いていない」と言える**が、
    // 見た目の最終判定ではない(実際の描画は実機で見る)。
    //   (a) 型のクラス(.ctl-state / .ctl-plain)を名乗っていない = 枠も地も持たない
    //   (b) 枠は `1px solid transparent` で**場所だけ残す**(border:0 だと幅・高さが 2px 縮む。F-75)
    //   (c) 見える色の枠線を持たない(--c-line* / --c-accent などの枠を1つも書いていない)
    {
      const pill = myDataPage.slice(myDataPage.indexOf("const filterPill"),
        myDataPage.indexOf("</button>", myDataPage.indexOf("const filterPill")));
      check("26.3 フィルタピルは型のクラス(A型/B型)を名乗らない(F-86: 枠も地も持たない)",
        pill.length > 0 && !/ctl-state|ctl-plain|ctl-pill/.test(pill), pill.replace(/\s+/g, " ").slice(0, 240));
      check("26.3 フィルタピルの枠は 1px solid transparent で場所だけ残す(寸法を動かさない)",
        /border: "1px solid transparent"/.test(pill), pill.replace(/\s+/g, " ").slice(0, 240));
      check("26.3 フィルタピルは見える色の枠線を1つも持たない",
        !/border(Top|Right|Bottom|Left)?: "[^"]*var\(--c-(line|accent|ink)/.test(pill),
        (pill.match(/border[A-Za-z]*: "[^"]*"/g) || []).join(" / ") || "0件");
    }
    check("26.3 ピルの当たり判定は 44pt(見た目のピルは内側の <span>・<button> は透明。§5)",
      /const filterPill = \([\s\S]{0,400}?\.\.\.TAP_BUTTON_RESET/.test(myDataPage));
    check("26.3 一覧の行の当たり判定も 44pt(§5)",
      /borderBottom: "1px solid var\(--c-line\)", cursor: "pointer", minHeight: "var\(--tap-min\)"/.test(myDataPage));
    // 副次行「V16-3 #4 · 自分 · 12:24」。**読めない区画は丸ごと省く**
    check("26.3 副次行はリード短縮形・奏者・録音時間を「 · 」でつなぎ、欠測は区画ごと省く",
      /const subParts = \[reedShortLabel\(reed, reeds\) \?\? "未紐付け", s\.performer \|\| null, dur\]\.filter\(Boolean\);/.test(myDataPage)
      && /\{subParts\.join\(" · "\)\}/.test(myDataPage));
    check("26.3 ピッチの差分は行から出さない(本人指示)",
      !/pitchCents/.test(codeOf(myDataPage)));
    check("26.3 一覧の高さ制限とスクロールは現行のまま(190px)",
      /maxHeight: 190, overflowY: "auto"/.test(myDataPage));
  }

  // --- 26.4 録音時間は最後のフレームの t から導く(保存されていない) --------------
  {
    const dur = new Function(`${extractFunction("formatElapsedMs")}
      ${extractFunction("sessionDurationLabel")}
      return sessionDurationLabel;`)();
    check("26.4 最後のフレームの t(秒)から m:ss を作る",
      dur({ frames: [{ t: 0 }, { t: 744 }] }) === "12:24", String(dur({ frames: [{ t: 0 }, { t: 744 }] })));
    check("26.4 秒は2桁ゼロ埋め・分は桁上がりしても切らない",
      dur({ frames: [{ t: 485 }] }) === "8:05" && dur({ frames: [{ t: 3600 }] }) === "60:00",
      `${dur({ frames: [{ t: 485 }] })} / ${dur({ frames: [{ t: 3600 }] })}`);
    check("26.4 フレームが空/無いときは null(時間の区画ごと省く)",
      dur({ frames: [] }) === null && dur({}) === null && dur(null) === null);
    check("26.4 最後のフレームに t が無い/数でないときも null",
      dur({ frames: [{ t: 10 }, {}] }) === null && dur({ frames: [{ t: "12" }] }) === null
      && dur({ frames: [{ t: NaN }] }) === null && dur({ frames: [{ t: -1 }] }) === null);
    // 使われていること(導出だけあって描いていない、を防ぐ)
    check("26.4 一覧の行が sessionDurationLabel を使っている",
      /const dur = sessionDurationLabel\(s\);/.test(myDataPage));
  }

  // --- 26.5 リードの短縮表記(N-4a と同じ規則) ----------------------------------
  {
    const rs = new Function(`${extractFunction("shortBoxLabel")}
      ${extractFunction("reedGroupKey")}
      ${extractFunction("reedPosition")}
      ${extractFunction("reedShortLabel")}
      return reedShortLabel;`)();
    const reeds = [
      { id: "a", brand: "Vandoren V16", strength: "3.0", startDate: "2026-08-01" },
      { id: "b", brand: "Vandoren V16", strength: "3.0", startDate: "2026-08-01" },
    ];
    check("26.5 「V16-3 #2」の形(短縮は shortBoxLabel・番号は reedPosition)",
      rs(reeds[1], reeds) === "V16-3 #2", String(rs(reeds[1], reeds)));
    check("26.5 リードが無ければ null(呼び出し側が「未紐付け」に振り替える)", rs(null, reeds) === null);
  }

  // --- 26.6 「…」は押せる項目が無ければ出さない(F-77 の罠) ---------------------
  {
    const items = new Function(`${extractConst("DATA_MORE_ITEM_DEFS")}
      ${extractFunction("dataMoreItems")}
      return dataMoreItems;`)();
    check("26.6 セッションもリードもあれば2項目",
      items(3, 2).map((x) => x.key).join(",") === "delete,reed", items(3, 2).map((x) => x.key).join(","));
    check("26.6 リードが0枚なら一括リード変更を出さない(行き先が無い)",
      items(3, 0).map((x) => x.key).join(",") === "delete", items(3, 0).map((x) => x.key).join(","));
    check("26.6 セッションが0件なら項目ゼロ(=「…」ごと出さない)",
      items(0, 5).length === 0 && items(0, 0).length === 0,
      `${items(0, 5).length} / ${items(0, 0).length}`);
    check("26.6 「…」は項目が1つ以上あるときだけ出す(呼び出し側の条件)",
      /\{dataSubTab === "mydata" && \(moreItems\.length > 0 \|\| listMode !== null\) && \(/.test(lab));
    check("26.6 項目の文言は削除と一括リード変更の2つ",
      items(1, 1).map((x) => x.label).join(",") === "セッションを選んで削除,選んだセッションのリードをまとめて変更",
      items(1, 1).map((x) => x.label).join(","));
  }

  // --- 26.7 機能を1つも落としていないこと(集合で確かめる) -----------------------
  // 正典と現行がぶつかったら**機能を残す**(2026/08/12 本人確定)。形が変わっても消さないもの。
  {
    const all = codeOf(myDataSection) + codeOf(myDataPage) + codeOf(metricRow) + codeOf(lab);
    const want = [
      ["期間セレクタ", /MY_DATA_RANGES/],
      // 【N-7 本人指示による書き換え】音名軸グラフの入口は TappableMetricCard(タップ切り替え)
      // から常時表示の NoteAxisLineChart へ移った。機能(音名ごとの内訳)は消えていない。
      ["音名軸グラフ", /<NoteAxisLineChart/],
      ["目安未設定の告知", /目安未設定/],
      ["期間に記録が無いときの文言", /この期間の「自分」のセッションはありません/],
      ["記録が無いときの文言", /まだ記録がありません/],
      ["条件に合わないときの文言", /条件に合うセッションがありません/],
      ["奏者の絞り込み", /setSessionFilterPerformer/],
      ["リードの絞り込み", /setSessionFilterReed/],
      ["期間の絞り込み(自由な範囲)", /setSessionFilterDateFrom/],
      ["クリア", /clearSessionFilters/],
      ["選択削除", /confirmBatchDeleteSessions/],
      ["一括リード変更", /applyBulkReed/],
      ["アップロード", /handleUploadFile/],
      ["アップロード由来の印", /<FileAudio/],
      ["セッション詳細への遷移", /onOpenSession\(s\.id\)/],
      ["目安に設定", /<SetAsIdealButton/],
    ];
    for (const [label, re] of want) {
      check(`26.7 ${label} が残っている`, re.test(all), "");
    }
    // 期間の絞り込みは「いつからいつまで」の自由な範囲のまま(固定の候補に置き換えていない)
    check("26.7 期間の絞り込みは date 入力2つのまま(自由な範囲を候補に置き換えていない)",
      (myDataPage.match(/<input type="date"/g) || []).length === 2,
      `${(myDataPage.match(/<input type="date"/g) || []).length}箇所`);
  }
  console.log("  -> done");
}

// ============================================================
// 検証27: N-7 データタブ(My Data)の折れ線化(2026/08/16 本人指示。凍結仕様 = design/N7-SPEC.md)
//   正典(見た目) = design/data-tab-final.html。値はすべて**正典の CSS/HTML から読んで**突き合わせる
//   (期待値をここに写すと、正典が変わっても落ちない)。
//   A 楽器種別セレクタ「Alto ▾ · 1ヶ月 ▾」: 既定値=計測タブの saxType / 語彙=SAX_PRESETS /
//     効く範囲はヒーロー+4本の折れ線だけ(セッション一覧には効かせない)
//   B ピッチのカード(.pitchcard): **常時表示**(N-6 の数字タップ開閉は廃止)
//   C 指標行(.mrow 案D): ヘッダ「今日 18.2dB · 1ヶ月 17.6 +0.6」+ 折れ線2本
//   D 系列は myDataChartSeries の1箇所(期間=薄 --c-accent-line / 今日=濃 --c-accent)
//   E NoteAxisLineChart の plain(見出し・凡例は正典の形で呼び出し側が持つ)
//   F F-85 対処: 一括リード変更の select(短い表記 + maxWidth)
// 【この節の作り方】ハーネスは JSX を評価しない。数字の規則(metricRowHeader /
// myDataChartSeries / bulkReedOptionLabel)は**抽出して実行**で検証し、描画側が
// その関数を正しい引数で呼んでいることは**綴り**で固定する(LOOP.md の罠: 純関数だけ
// 守って配線を守らない形は3周連続で差し戻されている)。
// ============================================================
console.log("\n========== 検証27: N-7 データタブの折れ線化(正典 data-tab-final.html との突き合わせ) ==========");
{
  const m27html = readFileSync(join(__dirname, "..", "design", "data-tab-final.html"), "utf8");
  // CSS の走査(検証26 と同じ規則。あちらはブロックスコープなのでここに置き直す)。
  // この正典には @media (prefers-color-scheme: dark) の上書きがあるが、アプリは
  // ライトの値だけを持つ(index.css のトークンは固定でダークモードを持たない)ので、
  // **@media ブロックを丸ごと除いてから**読む(除かないと .pitchcard が2件になり、
  // 後勝ちでダークの #20262E を「正典の値」と読み違える)。
  const parseCss27 = (text) => {
    const out = [];
    const body = text.replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, " ");
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const sels = m[1].split(",").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
      out.push({ sels, body: m[2] });
    }
    return out;
  };
  const declsOf27 = (block) => (block || "").split(";").map((d) => d.trim()).filter(Boolean)
    .map((d) => { const i = d.indexOf(":"); return { name: d.slice(0, i).trim(), value: d.slice(i + 1).trim() }; });
  const rule27 = (sel) => m27css.filter((r) => r.sels.includes(sel));
  const decl27 = (sel, name) => {
    let v = null;
    for (const r of rule27(sel)) for (const d of declsOf27(r.body)) if (d.name === name) v = d.value;
    return v;
  };
  const m27css = parseCss27((m27html.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1]);
  check("27.0 正典モックの CSS を走査できている(空回りしていない)", m27css.length >= 15, `${m27css.length}規則`);
  // 【N-8 2026/08/16 本人指示による書き換え】.pitchcard / .chartlbl は正典から削除された
  // (ピッチカードの廃止)。凡例(.legend / .sw)はヒーローの中へ移り、紺地用の上書き
  // .hero .legend と軸ラベル .haxis が加わった。
  for (const sel of [".hero", ".hero .lbl", ".legend", ".sw", ".hero .legend", ".haxis",
    ".mrow", ".mtop", ".mname", ".mnums", ".mnums b", ".up"]) {
    check(`27.0 正典に ${sel} の規則がある`, rule27(sel).length === 1, `${rule27(sel).length}件`);
  }
  check("27.0 N-8: 正典に .pitchcard / .chartlbl の規則が残っていない(ピッチカードの廃止)",
    rule27(".pitchcard").length === 0 && rule27(".chartlbl").length === 0,
    `${rule27(".pitchcard").length} / ${rule27(".chartlbl").length}件`);

  const myDataSection = srcOfFn(src, "MyDataSection");
  const myDataPage = srcOfFn(src, "MyDataPage");
  const metricRow = srcOfFn(src, "MetricRow");
  const chart = srcOfFn(src, "NoteAxisLineChart");

  // --- 27.1 楽器種別セレクタ(N7-SPEC 1〜3) -----------------------------------
  {
    // 既定値 = 計測タブで選択中の saxType(N7-SPEC 1)。永続化しない(再マウントで計測タブへ戻る)
    check("27.1 楽器種別の既定値は計測タブの saxType(useState の初期値)",
      /const \[dataSax, setDataSax\] = useState\(saxType\);/.test(myDataSection)
      && !/usePersistedState\("[^"]*[sS]ax/.test(myDataSection),
      (myDataSection.match(/const \[dataSax[^\n;]+/) || ["見つからない"])[0]);
    // セレクタのボタン(素のテキスト + ▾。F-72 の作法)
    {
      const i = myDataSection.indexOf('aria-label="集計する楽器種別を選ぶ"');
      const tag = i === -1 ? "" : myDataSection.slice(myDataSection.lastIndexOf("<button", i), myDataSection.indexOf("</button>", i));
      check("27.1 楽器種別セレクタのボタンを走査できている", tag.length > 100, `${tag.length}文字`);
      check("27.1 楽器種別セレクタは地も枠も持たない(型のクラスも持たない)",
        /background: "none", border: "none"/.test(tag) && !/\bctl-(state|plain|pill)\b/.test(tag));
      check("27.1 楽器種別セレクタの文字は SAX_PRESETS のラベル + ▾(語彙を発明しない)",
        /\{SAX_PRESETS\[dataSax\]\?\.label\} ▾/.test(tag));
      check("27.1 楽器種別セレクタの当たり判定は縦横とも 44pt(§5)",
        /minHeight: "var\(--tap-min\)", minWidth: "var\(--tap-min\)"/.test(tag)
        && /justifyContent: "flex-end"/.test(tag));
      check("27.1 楽器種別セレクタの文字色は正典 .hero .lbl と同じ副次色(#B9C9E4)",
        /fontSize: 12, color: "#B9C9E4"/.test(tag));
    }
    // 並びは正典「Alto ▾ · 1ヶ月 ▾」= 楽器種別が先・区切りは「 · 」・期間が後
    {
      check("27.1 正典の右上の並びを読めている(Alto ▾ · 1ヶ月 ▾)",
        /Alto ▾ · 1ヶ月 ▾/.test(m27html));
      const iSax = myDataSection.indexOf('aria-label="集計する楽器種別を選ぶ"');
      const iSep = myDataSection.indexOf("> · </span>", iSax);
      const iRange = myDataSection.indexOf('aria-label="集計する期間を選ぶ"', iSax);
      check("27.1 実装も 楽器種別 → 「 · 」 → 期間 の順(正典と同じ並び)",
        iSax > 0 && iSep > iSax && iRange > iSep, `楽器@${iSax} / ·@${iSep} / 期間@${iRange}`);
    }
    // シートは既存の DataOptionSheet。選択肢は計測タブと同じ SAX_PRESETS から流し込む
    check("27.1 楽器種別の選択肢はシートに SAX_PRESETS から流し込む(綴りを2箇所に置かない)",
      /items=\{Object\.keys\(SAX_PRESETS\)\.map\(\(k\) => \(\{ key: k, label: SAX_PRESETS\[k\]\.label \}\)\)\}/.test(myDataSection)
      && /onPick=\{\(k\) => \{ setDataSax\(k\); setSaxSheetOpen\(false\); \}\}/.test(myDataSection));
    {
      const presets = new Function(`${extractConst("SAX_PRESETS")} return SAX_PRESETS;`)();
      const labels = Object.values(presets).map((p) => p.label);
      check("27.1 語彙は計測タブの4種(英語表記。N-2)そのもの",
        Object.keys(presets).join(",") === "soprano,alto,tenor,baritone"
        && labels.every((l) => /^[A-Za-z]+$/.test(l)), labels.join(","));
      check("27.1 正典の「Alto」は SAX_PRESETS のラベルに実在する(別の言い方を作っていない)",
        labels.includes("Alto"), labels.join(","));
    }
    // 効く範囲 = ヒーロー + 4本の折れ線だけ(N7-SPEC 2)。
    // 母集団の絞り(奏者+楽器種別+フォールバック規則)は 26.2 で固定済み。ここでは
    // (a) 4本の折れ線がすべて dataSax で軸を作ること (b) 一覧側(MyDataPage)が dataSax を
    // 参照しないことを見る。
    // 【N-8 書き換え】渡す母集団の綴りが todayFrames → dayFrames + dayLabel になった(検証28)。
    check("27.1 折れ線の軸は選択中の楽器種別(saxType={dataSax} がピッチ1+指標行1の2箇所)",
      (myDataSection.match(/saxType=\{dataSax\}/g) || []).length === 2
      && /series=\{pitchSeries\}\s*\r?\n\s*saxType=\{dataSax\} tuningHz=\{tuningHz\}/.test(myDataSection)
      && /periodFrames=\{periodFrames\} dayFrames=\{dayFrames\} dayLabel=\{dayLabel\}\s*\r?\n\s*saxType=\{dataSax\} tuningHz=\{tuningHz\}/.test(myDataSection),
      `${(myDataSection.match(/saxType=\{dataSax\}/g) || []).length}箇所`);
    check("27.1 MyDataSection の折れ線は計測タブの saxType を直接使わない(セレクタが効かなくなる)",
      !/saxType=\{saxType\}/.test(myDataSection));
    check("27.1 セッション一覧(MyDataPage)は dataSax を参照しない(一覧には効かせない。N7-SPEC 2)",
      !/dataSax/.test(myDataPage));
  }

  // --- 27.2 ヒーローの中のピッチ折れ線(旧: ピッチのカード .pitchcard) ------------
  // 【N-8 2026/08/16 本人指示による全面書き換え】単独のピッチカードは**グラフごと削除**され、
  // 同じ音名軸の折れ線がヒーロー(紺のカード)の中(旧スパークラインの場所)へ移った。
  // 旧主張(カードの寸法 .pitchcard / 見出し .chartlbl)は正典側でも削除済み(27.0 で固定)。
  {
    check("27.2 N-8: ピッチカード(.pitchcard 相当の #F6F8FB の面)が実装に残っていない",
      !/#F6F8FB/.test(codeOf(myDataSection)),
      (codeOf(myDataSection).match(/#F6F8FB/g) || []).length + "件");
    check("27.2 N-8: 旧カードの見出し「音ごとの…」が残っていない(ヒーローの数字が見出しを兼ねる)",
      !codeOf(myDataSection).includes("音ごとの"));
    // 凡例: 正典 .legend(gap 12 / 10px) + 紺地用の上書き .hero .legend(右寄せ・#9DB3D6・上12)。
    // 値はすべて正典から読む(期待値をここに写すと、正典が変わっても落ちない)。
    check("27.2 凡例の並び・文字・色・余白は正典 .legend / .hero .legend と同じ",
      new RegExp(`justifyContent: "${decl27(".hero .legend", "justify-content")}", alignItems: "center", `
        + `gap: ${parseFloat(decl27(".legend", "gap"))}, fontSize: ${parseFloat(decl27(".legend", "font-size"))}, `
        + `color: "${decl27(".hero .legend", "color")}", marginTop: ${parseFloat(decl27(".hero .legend", "margin-top"))}`).test(myDataSection),
      `正典= ${decl27(".hero .legend", "justify-content")} / ${decl27(".legend", "gap")} / ${decl27(".legend", "font-size")} / ${decl27(".hero .legend", "color")} / ${decl27(".hero .legend", "margin-top")}`);
    check("27.2 凡例は系列の配列そのもの(pitchSeries)から描く(綴りを2箇所に置かない)",
      /\{pitchSeries\.map\(\(s\) => \(/.test(myDataSection));
    // 凡例の見本は正典 .sw の色棒(白い地を敷く SeriesSwatch は紺の上では白い線が消えるため使わない)
    check("27.2 凡例の見本は正典 .sw と同じ寸法の色棒で、色は系列そのものから取る",
      new RegExp(`width: ${parseFloat(decl27(".sw", "width"))}, height: ${parseFloat(decl27(".sw", "height"))}, `
        + `borderRadius: ${parseFloat(decl27(".sw", "border-radius"))}, background: s\\.style\\.color`).test(myDataSection)
      && !/SeriesSwatch/.test(codeOf(myDataSection)),
      `正典= ${decl27(".sw", "width")} / ${decl27(".sw", "height")} / ${decl27(".sw", "border-radius")}`);
    check("27.2 グラフは plain + hero で描く(見出し・凡例はヒーロー側、配色は hero 変形が持つ)",
      /<NoteAxisLineChart\s*\r?\n\s*plain hero\s*\r?\n\s*label=\{heroMetric\.label\}/.test(myDataSection));
    // 表示の条件は「フレームを持つ記録があること」だけ(N8-SPEC 5: 記録ゼロなら従来の空表示)。
    check("27.2 N-8: 折れ線と凡例はフレームがあるときだけ・それ以外の条件を持たない",
      /\{\(periodFrames\.length > 0 \|\| dayFrames\.length > 0\) && \(/.test(myDataSection)
      && !/\{false && \(/.test(myDataSection));
    check("27.2 横軸ラベルの絞り(noteFocus)は N-6 のまま(E♭3/E♭4/E♭5)",
      (myDataSection.match(/noteFocus=\{\["E♭3", "E♭4", "E♭5"\]\}/g) || []).length === 1);
  }

  // --- 27.3 系列 myDataChartSeries(実行で検証) --------------------------------
  {
    const api = new Function(`${extractConst("SERIES_STYLES")}
      ${extractFunction("myDataChartSeries")}
      return { myDataChartSeries, SERIES_STYLES };`)();
    const f = api.myDataChartSeries;
    const S = api.SERIES_STYLES;
    // 【N-8 書き換え】濃い線のラベルは引数 dayLabel(myDataTodayOrLatestFrames の戻り値。検証28)。
    // 「今日」の直書きは関数から消えた。
    const both = f("1ヶ月", [{ t: 0 }], [{ t: 1 }], "今日");
    check("27.3 両方にデータがあれば2系列(期間が先=下・今日/直近日が後=上)",
      both.length === 2 && both[0].id === "period" && both[1].id === "today",
      both.map((s) => s.id).join(","));
    check("27.3 期間側のラベルは期間セレクタの語・濃い線側は dayLabel の引数そのまま",
      both[0].label === "1ヶ月" && both[1].label === "今日"
      && f("1ヶ月", [{ t: 0 }], [{ t: 1 }], "8/15")[1].label === "8/15",
      both.map((s) => s.label).join("/"));
    check("27.3 N-8: 濃い線のラベルを「今日」に固定できない(関数に「今日」の綴りが無い)",
      !extractFunction("myDataChartSeries").includes("今日"));
    check("27.3 既定の色は 期間=薄(SERIES_STYLES[2])・濃=SERIES_STYLES[0]。新しい線種を発明しない",
      both[0].style === S[2] && both[1].style === S[0]);
    check("27.3 N-8: styles を渡すとその2色になる(ヒーローが紺地用の色に差し替えるための口)",
      (() => {
        const st = [{ color: "a" }, { color: "b" }];
        const s = f("1ヶ月", [{ t: 0 }], [{ t: 1 }], "今日", st);
        return s[0].style === st[0] && s[1].style === st[1];
      })());
    check("27.3 フレーム列はそのまま渡す(別の集計に差し替えない)",
      (() => { const p = [{ t: 0 }], t = [{ t: 1 }]; const s = f("1m", p, t, "今日"); return s[0].frames === p && s[1].frames === t; })());
    check("27.3 その日のデータが無ければ期間平均の1本だけ(N7-SPEC 8)",
      f("1ヶ月", [{ t: 0 }], [], "今日").length === 1 && f("1ヶ月", [{ t: 0 }], null, "今日").length === 1
      && f("1ヶ月", [{ t: 0 }], [], "今日")[0].id === "period");
    // 色の妥当性を独立に観測できる量へ接続する: 実装のトークン → index.css の値 → 正典の変数。
    // (SERIES_STYLES[2] を書き換えても、index.css の値を書き換えても、正典とずれたら落ちる)
    {
      const css = readFileSync(join(__dirname, "..", "src", "index.css"), "utf8");
      const tok = (name) => (new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{3,8})`).exec(css) || [])[1];
      const mockVar = (name) => (new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{3,8})`).exec(m27html) || [])[1];
      check("27.3 期間側の色は --c-accent-line で、その値は正典の --pale と同じ",
        S[2].color === "var(--c-accent-line)"
        && tok("--c-accent-line") !== undefined && mockVar("--pale") !== undefined
        && tok("--c-accent-line").toUpperCase() === mockVar("--pale").toUpperCase(),
        `token=${tok("--c-accent-line")} / mock=${mockVar("--pale")}`);
      check("27.3 今日側の色は --c-accent で、その値は正典の --accent と同じ",
        S[0].color === "var(--c-accent)"
        && tok("--c-accent") !== undefined && mockVar("--accent") !== undefined
        && tok("--c-accent").toUpperCase() === mockVar("--accent").toUpperCase(),
        `token=${tok("--c-accent")} / mock=${mockVar("--accent")}`);
    }
  }

  // --- 27.4 指標行(.mrow 案D)の寸法と配線 -------------------------------------
  {
    check("27.4 行の内側余白は正典 .mrow と同じ・最後の行だけ罫なし",
      metricRow.includes(`padding: "${decl27(".mrow", "padding")}"`)
      && /borderBottom: last \? "none" : "1px solid var\(--c-line\)"/.test(metricRow)
      && /^\s*1px solid/.test(decl27(".mrow", "border-bottom") || "")
      && /class="mrow" style="border-bottom:none"/.test(m27html),
      `正典=${decl27(".mrow", "padding")} / ${decl27(".mrow", "border-bottom")}`);
    check("27.4 ヘッダ行の下余白は正典 .mtop と同じ",
      new RegExp(`justifyContent: "space-between", marginBottom: ${parseFloat(decl27(".mtop", "margin-bottom"))}`).test(metricRow),
      `正典=${decl27(".mtop", "margin-bottom")}`);
    check("27.4 指標名は正典 .mname と同じ(12px・--ink2)で、語は MY_DATA_METRICS から",
      new RegExp(`fontSize: ${parseFloat(decl27(".mname", "font-size"))}, color: "var\\(--c-ink-2\\)" \\}\\}>\\{m\\.label\\}`).test(metricRow),
      `正典=${decl27(".mname", "font-size")}`);
    check("27.4 数字の行は正典 .mnums と同じ(11.5px・--ink3・等幅数字)",
      new RegExp(`fontSize: ${parseFloat(decl27(".mnums", "font-size"))}, color: "var\\(--c-ink-3\\)", fontVariantNumeric: "tabular-nums"`).test(metricRow),
      `正典=${decl27(".mnums", "font-size")}`);
    check("27.4 今日の値は正典 .mnums b と同じ(--ink・等幅・14px・600)",
      new RegExp(`color: "var\\(--c-ink\\)", fontFamily: "var\\(--font-num\\)", fontSize: ${parseFloat(decl27(".mnums b", "font-size"))}, fontWeight: ${decl27(".mnums b", "font-weight")}`).test(metricRow),
      `正典=${decl27(".mnums b", "font-size")} / ${decl27(".mnums b", "font-weight")}`);
    check("27.4 正の差の色は正典 .up と同じ(それ以外は .mnums の地の色)",
      metricRow.includes(`color: h.diffUp ? "${decl27(".up", "color")}" : "var(--c-ink-3)"`),
      `正典=${decl27(".up", "color")}`);
    // 配線: 定義は MY_DATA_METRICS、数字は metricRowHeader、系列は myDataChartSeries、
    // 集計は computeFrameMetrics。JSX は戻り値を並べるだけ。
    check("27.4 行の定義(ラベル・単位・書式)は MY_DATA_METRICS から引く(写していない)",
      /const m = MY_DATA_METRICS\.find\(\(x\) => x\.key === metricKey\);/.test(metricRow));
    // 【N-8 書き換え】ヘッダの数字は「今日または直近の記録日」(dayMetrics / h.dayNum)。
    // 行頭のラベルは dayLabel(myDataTodayOrLatestFrames の戻り値)をそのまま置く(検証28)。
    check("27.4 ヘッダの数字は metricRowHeader の戻り値をそのまま並べる",
      /const h = metricRowHeader\(m, dayMetrics \? dayMetrics\[m\.key\] : null, periodMetrics\[m\.key\]\);/.test(metricRow)
      && /\{dayLabel\} <b style=/.test(metricRow)
      && />\{h\.dayNum\}<\/b>/.test(metricRow)
      && /\{h\.dayUnit\} · \{rangeLabel\} \{h\.periodText\}/.test(metricRow)
      && /\{h\.diffText && <span style=/.test(metricRow));
    check("27.4 集計は computeFrameMetrics(期間とその日を別々に。その日はフレームが無ければ null)",
      /const periodMetrics = computeFrameMetrics\(periodFrames\);/.test(metricRow)
      && /const dayMetrics = dayFrames\.length \? computeFrameMetrics\(dayFrames\) : null;/.test(metricRow));
    // 【N-8 書き換え】旧主張の selectedIdeal={selectedIdeal} idealKey={m.idealKey} は
    // **仕様ごと廃止**(目安の破線と Δ を My Data から外した。絶対の主張は検証28)。
    check("27.4 折れ線は plain の NoteAxisLineChart に myDataChartSeries の2系列を渡す",
      /<NoteAxisLineChart\s*\r?\n\s*plain\s*\r?\n\s*label=\{m\.label\}/.test(metricRow)
      && /series=\{myDataChartSeries\(rangeLabel, periodFrames, dayFrames, dayLabel\)\}/.test(metricRow)
      && /fmt=\{m\.fmt\}/.test(metricRow));
    // 【審査で塞いだ穴】上の検査は series と fmt までしか見ておらず、
    // **MetricRow が受けた props をグラフへ渡す最後の1段**(saxType / tuningHz / metricKey)が
    // 無防備だった。`saxType={"alto"}` に固定する変異が生存し、楽器種別セレクタが
    // HNR/重心/音量の3行の横軸に効かなくなる(実測: 行の E♭3 ラベルが Alto↔Tenor で
    // 82.7↔122.7 と動くのが、固定すると動かなくなる)。「配線を固定した」と記録しながら
    // 名指しで警告されていた形をまた作っていた(通算17回目)。
    check("27.4 グラフの軸は行が受けた saxType / tuningHz から作る(固定値を書かない)",
      /saxType=\{saxType\} tuningHz=\{tuningHz\} fmt=\{m\.fmt\}/.test(metricRow));
    check("27.4 グラフの指標キーは定義から引く(metricKey={m.key}。別の指標に固定できない)",
      /label=\{m\.label\} unit=\{m\.unit\} metricKey=\{m\.key\}/.test(metricRow));
    // 【N-8 2026/08/16 本人指示による廃止】旧検査「目安Δの母集団はヘッダの主役と同じ」は
    // **仕様ごと廃止**: 目安の破線と Δ は My Data の全グラフから外れた(「目安は表示不要」)。
    // MetricRow が目安を一切扱わないこと(戻す変異が落ちること)は検証28 が固定する。
    // 呼び出し側(MyDataSection): 3行を MY_DATA_ROW_METRICS の並びのまま出す
    check("27.4 3行は MY_DATA_ROW_METRICS をそのまま map する(間引かない・並びを写さない)",
      /\{MY_DATA_ROW_METRICS\.map\(\(key, i\) => \(/.test(myDataSection)
      && /last=\{i === MY_DATA_ROW_METRICS\.length - 1\}/.test(myDataSection)
      && !/MY_DATA_ROW_METRICS\.(slice|filter)\(/.test(myDataSection));
    check("27.4 行の map が条件式(&& / ?)の直後に来ていない(常時表示の綴り)",
      !/(&&|\?)\s*\(?\s*\r?\n?\s*\{MY_DATA_ROW_METRICS\.map/.test(codeOf(myDataSection)));
    // 正典の3行の並び(.mname の出現順)と、実装が出すラベルの列ごとの対応
    {
      const ordered = [...m27html.matchAll(/<span class="mname">([^<]+)<\/span>/g)].map((m) => m[1].trim());
      const mdm = new Function(`const formatSignedCents = 0, pitchSpreadSub = 0;
        ${extractConst("MY_DATA_METRICS")} return MY_DATA_METRICS;`)();
      const rowKeys = new Function(`${extractConst("MY_DATA_ROW_METRICS")} return MY_DATA_ROW_METRICS;`)();
      const rowLabels = rowKeys.map((k) => mdm.find((x) => x.key === k)?.label);
      check("27.4 正典の指標行から並び順のままラベルを読めている(空回りしていない)",
        ordered.length === 3, ordered.join("/"));
      check("27.4 行の並びとラベルは正典と列ごとに一致(HNR / 重心 / 音量)",
        rowLabels.length === ordered.length && rowLabels.every((l, i) => l === ordered[i]),
        `実装 ${rowLabels.join("/")} / 正典 ${ordered.join("/")}`);
    }
  }

  // --- 27.5 行ヘッダの数字(metricRowHeader を実行で検証) ------------------------
  {
    const h = new Function(`${extractFunction("metricRowHeader")} return metricRowHeader;`)();
    const mdm = new Function(`const formatSignedCents = 0, pitchSpreadSub = 0;
      ${extractConst("MY_DATA_METRICS")} return MY_DATA_METRICS;`)();
    const hnr = mdm.find((x) => x.key === "hnrDb");
    // 期待値は正典の1行目(HNR)の数字から読む(写さない)。18.2 と 17.6 を入れると +0.6 が出るはず
    const mm = /今日 <b>([\d.]+)<\/b>([A-Za-z]+) · 1ヶ月 ([\d.]+) <span class="up">(\+[\d.]+)<\/span>/.exec(m27html);
    check("27.5 正典の行ヘッダの数字を読めている(空回りしていない)",
      mm !== null && mm.length === 5, mm ? mm.slice(1).join(" ") : "読めない");
    // 【N-8 書き換え】戻り値のキーが todayNum/todayUnit → dayNum/dayUnit
    // (値は「今日または直近の記録日」のもの。数字の規則そのものは同一)。
    if (mm) {
      const r = h(hnr, parseFloat(mm[1]), parseFloat(mm[3]));
      check("27.5 正典の数字(今日18.2 / 1ヶ月17.6)を入れると正典どおりの表示になる(+0.6・単位はその日側だけ)",
        r.dayNum === mm[1] && r.dayUnit === mm[2] && r.periodText === mm[3]
        && r.diffText === mm[4] && r.diffUp === true,
        `${r.dayNum}${r.dayUnit} · ${r.periodText} ${r.diffText}`);
      check("27.5 正典の単位(dB)は MY_DATA_METRICS の HNR の単位と同じ(列の取り違えが出ない)",
        hnr.unit === mm[2], `実装 ${hnr.unit} / 正典 ${mm[2]}`);
    }
    const none = h(hnr, null, 17.6);
    check("27.5 その日のデータが無ければ「—」(単位も付けない。N7-SPEC 8)",
      none.dayNum === "—" && none.dayUnit === "" && none.periodText === "17.6" && none.diffText === null,
      `${none.dayNum}${none.dayUnit} / ${none.periodText} / ${none.diffText}`);
    check("27.5 期間に値が無ければ期間側も「—」・差は出さない",
      h(hnr, 18.2, null).periodText === "—" && h(hnr, 18.2, null).diffText === null);
    check("27.5 NaN は欠測扱い(「NaN」を画面に出さない)",
      h(hnr, NaN, 17.6).dayNum === "—" && h(hnr, 18.2, NaN).periodText === "—");
    check("27.5 負の差は fmt の \"-\" のまま・正の色も付けない",
      h(hnr, 17.0, 17.6).diffText === "-0.6" && h(hnr, 17.0, 17.6).diffUp === false,
      String(h(hnr, 17.0, 17.6).diffText));
    check("27.5 差が0なら符号を付けない(Δ の既存規則と同じ)",
      h(hnr, 17.6, 17.6).diffText === "0.0" && h(hnr, 17.6, 17.6).diffUp === false,
      String(h(hnr, 17.6, 17.6).diffText));
    // 重心(整数 fmt)でも成り立つ(正典2行目: 1214 / 1195 / +19)
    {
      const cent = mdm.find((x) => x.key === "spectralCentroidHz");
      const r = h(cent, 1214, 1195);
      check("27.5 重心(整数の書式)でも正典どおり(+19)",
        r.dayNum === "1214" && r.dayUnit === "Hz" && r.diffText === "+19",
        `${r.dayNum}${r.dayUnit} ${r.diffText}`);
    }
  }

  // --- 27.6 NoteAxisLineChart の plain ---------------------------------------
  {
    check("27.6 plain は任意の引数(既定 false = 既存の呼び出し側は従来のまま)",
      /plain = false/.test(chart));
    check("27.6 plain のとき見出し行を描かない(見出しは呼び出し側が正典の形で持つ)",
      /\{!plain && <div className="sans" style=\{\{ fontSize: 12, color: "#8D95A1", marginBottom: 6 \}\}>\{label\}/.test(chart));
    check("27.6 plain のとき系列の凡例を描かない(ピッチのカードは .chartlbl・指標行は .mnums が担う)",
      /\{!plain && series\.length > 1 && \(/.test(chart));
    check("27.6 plain のとき下余白も持たない(行の余白は正典 .mrow が持つ)",
      /marginBottom: plain \? 0 : 18/.test(chart));
    check("27.6 目安の凡例(実測/目安/Δ)は plain でも描く(N-6 の置き場所のまま。機能を落とさない)",
      /\{idealByIdx && hasData && \(/.test(chart) && !/plain && idealByIdx/.test(chart));
    // plain を渡すのはデータタブの2箇所だけ(集合で固定。件数の釘付けはしない)
    {
      const PLAIN_OWNERS = ["MyDataSection", "MetricRow"];
      const re = /<NoteAxisLineChart\s*\r?\n\s*plain\b/g;
      const total = (src.match(re) || []).length;
      const inOwners = PLAIN_OWNERS.reduce((n, fn) => n + (srcOfFn(src, fn).match(re) || []).length, 0);
      check("27.6 plain を渡すのはデータタブの集合の中だけ(リード比較・個体詳細・セッション詳細は従来のまま)",
        total === inOwners && total === 2
        && !/\bplain\b/.test(codeOf(srcOfFn(src, "TappableMetricCard")))
        && !/\bplain\b/.test(codeOf(srcOfFn(src, "ReedCompareTab"))),
        `全体 ${total} / 集合内 ${inOwners}`);
    }
  }

  // --- 27.7 F-85 対処: 一括リード変更の select(短い表記 + maxWidth) -------------
  // 本人の実機報告(F-84/F-85)は Chrome で再現しないが、前周の実測で「フル表記の select が
  // 277px になり行が2行に折り返す」根が確認済み。iOS のネイティブ select の実寸は
  // **Chrome では判定不能(実機待ち)**。ここで固定するのは Chrome でも見える範囲だけ:
  // 選択肢の表記が短いこと・select が固有幅に頼らないこと。
  {
    const api = new Function(`${extractFunction("shortBoxLabel")}
      ${extractFunction("reedGroupKey")}
      ${extractFunction("reedPosition")}
      ${extractFunction("reedShortLabel")}
      ${extractFunction("formatYmd")}
      ${extractFunction("bulkReedOptionLabel")}
      return { reedShortLabel, bulkReedOptionLabel };`)();
    const reeds = [
      { id: "a", brand: "Vandoren V16", strength: "3.0", startDate: "2026-08-01", createdAt: "2026-08-01T00:00:00.000Z" },
      { id: "b", brand: "Vandoren V16", strength: "3.0", startDate: "2026-08-13", createdAt: "2026-08-13T00:00:00.000Z" },
    ];
    check("27.7 選択肢は「V16-3 #1 (2026/08/01)」の形(短縮は N-4a・日付は N-2 の yyyy/mm/dd)",
      api.bulkReedOptionLabel(reeds[0], reeds) === "V16-3 #1 (2026/08/01)",
      api.bulkReedOptionLabel(reeds[0], reeds));
    check("27.7 開封日で同名の箱を区別できる(short 表記だけだと衝突する組で一意になる)",
      api.reedShortLabel(reeds[0], reeds) === api.reedShortLabel(reeds[1], reeds)
      && api.bulkReedOptionLabel(reeds[0], reeds) !== api.bulkReedOptionLabel(reeds[1], reeds),
      `${api.bulkReedOptionLabel(reeds[0], reeds)} / ${api.bulkReedOptionLabel(reeds[1], reeds)}`);
    check("27.7 開封日が無いリードは「(—)」(reedLabel と同じ欠測の振り替え)",
      api.bulkReedOptionLabel({ id: "c", brand: "Vandoren V16", strength: "2.5", startDate: null, createdAt: "2026-08-01T00:00:00.000Z" }, reeds)
        .endsWith("(—)"));
    check("27.7 選択肢の表記に銘柄のフル表記が入らない(固有幅の源だった)",
      !api.bulkReedOptionLabel(reeds[0], reeds).includes("Vandoren"),
      api.bulkReedOptionLabel(reeds[0], reeds));
    // 配線: 一括変更の select だけが短い表記を使う(絞り込みピルのシートは選択肢が縦に並ぶ
    // 一覧なのでフル表記のまま = 触っていない)
    {
      const iBlock = myDataPage.indexOf('listMode === "reed"');
      const block = iBlock < 0 ? "" : myDataPage.slice(iBlock, myDataPage.indexOf("</select>", iBlock));
      check("27.7 一括変更の select を走査できている", block.length > 200, `${block.length}文字`);
      check("27.7 一括変更の select の選択肢は bulkReedOptionLabel(フル表記 reedLabel を使わない)",
        /\{bulkReedOptionLabel\(r, reeds\)\}/.test(block) && !/reedLabel\(/.test(block));
      check("27.7 select は flex で縮み、maxWidth を持つ(ネイティブ固有幅に行の折り返しを委ねない)",
        /style=\{\{ fontSize: 12, flex: "1 1 0", minWidth: 0, maxWidth: 200 \}\}/.test(block));
      check("27.7 絞り込みピルのシート(リードで絞り込む)はフル表記のまま(触っていない)",
        /items=\{\[\s*\r?\n\s*\{ key: "", label: "すべて" \},\s*\r?\n\s*\{ key: "__none__", label: "未紐付け" \},\s*\r?\n\s*\.\.\.reeds\.map\(\(r\) => \(\{ key: r\.id, label: reedLabel\(r, reeds\) \}\)\),/.test(myDataPage));
    }
  }
  console.log("  -> done");
}

// ============================================================
// 検証28: N-8 ヒーローの折れ線化・直近日フォールバック・目安の撤去
//   (2026/08/16 本人指示。凍結仕様 = design/N8-SPEC.md。正典 = design/data-tab-final.html の
//    N-8 改訂版。期待値の色は**正典のヒーローの svg から読む**)
//   A 直近日フォールバック myDataTodayOrLatestFrames(抽出して実行で検証)
//   B 描画側の配線: 戻り値(frames / label)をヒーローの数字・濃い線・3行ヘッダの**すべて**が使う
//     — 「純関数は完璧・配線が無防備」で通算17回差し戻された形を、名指しで固定する
//   C ヒーローの中の折れ線(NoteAxisLineChart の hero 変形): 配色を正典と突き合わせ、
//     既定(hero=false)の経路が従来のままであることも固定する
//   D 目安(selectedIdeal)の破線と Δ が My Data の全グラフから外れている(他画面はそのまま)
// ============================================================
console.log("\n========== 検証28: N-8 ヒーローの折れ線化・直近日フォールバック(正典 data-tab-final.html) ==========");
{
  const m28html = readFileSync(join(__dirname, "..", "design", "data-tab-final.html"), "utf8");
  const myDataSection = srcOfFn(src, "MyDataSection");
  const metricRow = srcOfFn(src, "MetricRow");
  const chart = srcOfFn(src, "NoteAxisLineChart");

  // --- 28.1 直近日フォールバック(実行で検証) ---------------------------------
  {
    const F = new Function(`${extractFunction("localDayKey")}
      ${extractFunction("myDataTodayOrLatestFrames")}
      return myDataTodayOrLatestFrames;`)();
    const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).toISOString();
    const now = new Date(2026, 7, 16, 9, 0); // ローカル 2026/08/16 09:00
    const s = (id, iso, n) => ({ id, recordedAt: iso, frames: Array.from({ length: n }, (_, i) => ({ t: i })) });

    {
      const r = F([s("a", at(2026, 8, 16, 7, 30), 2), s("b", at(2026, 8, 15, 20, 0), 3)], now);
      check("28.1 今日に記録があれば frames=今日の全フレーム・label=「今日」",
        r.label === "今日" && r.frames.length === 2, `${r.label} / ${r.frames.length}フレーム`);
    }
    {
      const r = F([
        s("a", at(2026, 8, 15, 5, 0), 1),   // 同じローカル暦日の早朝(JST なら UTC では前日)
        s("b", at(2026, 8, 15, 23, 30), 2), // 同じローカル暦日の深夜
        s("c", at(2026, 8, 13, 12, 0), 4),  // 前の日(混ざってはいけない)
      ], now);
      check("28.1 今日が無ければ直近の記録日の全フレーム(同じ暦日の複数セッションを合算・他の日は混ぜない)",
        r.frames.length === 3, `${r.frames.length}フレーム`);
      check("28.1 ラベルは「今日」と偽らず、その日付(M/D)", r.label === "8/15", r.label);
    }
    check("28.1 日付ラベルは M/D(ゼロ埋めしない・月/日だけ)",
      F([s("a", at(2026, 8, 5, 12, 0), 1)], now).label === "8/5"
      && F([s("a", at(2025, 12, 31, 12, 0), 1)], now).label === "12/31",
      `${F([s("a", at(2026, 8, 5, 12, 0), 1)], now).label} / ${F([s("a", at(2025, 12, 31, 12, 0), 1)], now).label}`);
    check("28.1 暦日の境界(昨日 23:59 の記録は「今日」ではなくその日付)",
      F([s("a", at(2026, 8, 15, 23, 59), 1)], new Date(2026, 7, 16, 0, 1)).label === "8/15",
      F([s("a", at(2026, 8, 15, 23, 59), 1)], new Date(2026, 7, 16, 0, 1)).label);
    check("28.1 フレームの無い記録は無視する(最新が空セッションでも直近の実記録の日を選ぶ)",
      F([s("empty", at(2026, 8, 16, 8, 0), 0), s("b", at(2026, 8, 14, 12, 0), 2)], now).label === "8/14",
      F([s("empty", at(2026, 8, 16, 8, 0), 0), s("b", at(2026, 8, 14, 12, 0), 2)], now).label);
    {
      const r = F([], now);
      check("28.1 記録ゼロなら frames=[]・label=「今日」(呼び出し側は従来どおりの空表示)",
        r.frames.length === 0 && r.label === "今日", `${r.frames.length} / ${r.label}`);
    }
    // 暦日の組み立ては localDayKey ただ1箇所(toISOString().slice(0,10) は UTC 暦日で、
    // JST では 00:00〜09:00 の記録が1日前になる。App.jsx の localDayKey の解説が名指しで禁止)
    const fnSrc = extractFunction("myDataTodayOrLatestFrames");
    check("28.1 暦日の組み立ては localDayKey(toISOString の UTC 暦日を使っていない)",
      (fnSrc.match(/localDayKey\(/g) || []).length >= 2 && !/toISOString/.test(fnSrc),
      `${(fnSrc.match(/localDayKey\(/g) || []).length}箇所`);
  }

  // --- 28.2 描画側の配線: 戻り値(frames / label)を使う -------------------------
  {
    check("28.2 MyDataSection は今日/直近日を myDataTodayOrLatestFrames(allMySessions, now) の1回で取る",
      /const day = myDataTodayOrLatestFrames\(allMySessions, now\);/.test(myDataSection)
      && /const dayFrames = day\.frames;/.test(myDataSection)
      && /const dayLabel = day\.label;/.test(myDataSection)
      && (codeOf(myDataSection).match(/myDataTodayOrLatestFrames\(/g) || []).length === 1,
      `${(codeOf(myDataSection).match(/myDataTodayOrLatestFrames\(/g) || []).length}回`);
    check("28.2 ヒーロー左上のラベルは戻り値の label(値が無いときだけ従来の「平均差分」)",
      /\{dayVal != null \? dayLabel : "平均差分"\}/.test(myDataSection));
    check("28.2 「今日」の綴りが描画側(MyDataSection / MetricRow)に無い(ラベルは戻り値だけ)",
      !codeOf(myDataSection).includes("今日") && !codeOf(metricRow).includes("今日"));
    check("28.2 3行ヘッダも同じ dayFrames / dayLabel を使う(MetricRow への配線)",
      /periodFrames=\{periodFrames\} dayFrames=\{dayFrames\} dayLabel=\{dayLabel\}/.test(myDataSection));
    check("28.2 ヒーローの数字も同じ母集団から出す(dayVal → displayVal)",
      /const displayVal = dayVal != null \? dayVal : periodVal;/.test(myDataSection));
  }

  // --- 28.3 ヒーローの中の折れ線(hero 変形)と配色 ------------------------------
  {
    // 正典のヒーローの svg から、2本の線・0の破線・軸ラベルの色を読む(期待値をここに写さない)
    const iHero = m28html.indexOf('<div class="hero">');
    const iAfter = m28html.indexOf('<div class="mrow">');
    const heroBlock = iHero >= 0 && iAfter > iHero ? m28html.slice(iHero, iAfter) : "";
    const strokes = [...heroBlock.matchAll(/<path [^>]*stroke="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
    const zero = /<line [^>]*stroke="(#[0-9A-Fa-f]{6})" stroke-width="1" stroke-dasharray="4 3"/.exec(heroBlock);
    const axis = /\.haxis\{[^}]*fill:(#[0-9A-Fa-f]{6})/.exec(m28html);
    check("28.3 正典のヒーローから2本の線・0の破線・軸ラベルの色を読めている(空回りしていない)",
      strokes.length === 2 && !!zero && !!axis,
      `線=${strokes.join(",")} / 0線=${zero && zero[1]} / 軸=${axis && axis[1]}`);
    const hs = new Function(`${extractConst("HERO_CHART_SERIES_STYLES")} return HERO_CHART_SERIES_STYLES;`)();
    const hz = new Function(`${extractConst("HERO_CHART_ZERO_LINE")} return HERO_CHART_ZERO_LINE;`)();
    const ha = new Function(`${extractConst("HERO_CHART_AXIS_TEXT")} return HERO_CHART_AXIS_TEXT;`)();
    check("28.3 期間平均の線は正典の1本目(薄)と同じ色",
      strokes.length === 2 && hs[0].color.toUpperCase() === strokes[0].toUpperCase(),
      `実装 ${hs[0].color} / 正典 ${strokes[0]}`);
    check("28.3 今日/直近日の線は正典の2本目(白)と同じ色",
      strokes.length === 2 && hs[1].color.toUpperCase() === strokes[1].toUpperCase(),
      `実装 ${hs[1].color} / 正典 ${strokes[1]}`);
    check("28.3 薄い線は太く(§1.8 の 3px)・濃い線は 2px・2本とも実線",
      hs[0].width === 3 && hs[1].width === 2 && hs[0].dash === null && hs[1].dash === null,
      `${hs[0].width}px / ${hs[1].width}px`);
    check("28.3 0の基準線は正典と同じ色(§1.8 の破線 4 3)",
      zero !== null && hz.toUpperCase() === zero[1].toUpperCase(), `実装 ${hz} / 正典 ${zero && zero[1]}`);
    check("28.3 軸ラベルの色は正典 .haxis と同じ",
      axis !== null && ha.toUpperCase() === axis[1].toUpperCase(), `実装 ${ha} / 正典 ${axis && axis[1]}`);
    // 配色が「ヒーローの既存配色」であること: 期間の線 = 正典 .hero .lbl の色 / 軸 = .hero .u の色
    {
      const lbl = /\.hero \.lbl\{[^}]*color:(#[0-9A-Fa-f]{6})/.exec(m28html);
      const u = /\.hero \.u\{[^}]*color:(#[0-9A-Fa-f]{6})/.exec(m28html);
      check("28.3 期間の線色はヒーローの既存色(.hero .lbl)と同じ(新色を発明していない)",
        lbl !== null && hs[0].color.toUpperCase() === lbl[1].toUpperCase(), `${hs[0].color} / ${lbl && lbl[1]}`);
      check("28.3 軸ラベル色はヒーローの既存色(.hero .u)と同じ(新色を発明していない)",
        u !== null && ha.toUpperCase() === u[1].toUpperCase(), `${ha} / ${u && u[1]}`);
    }
    // hero 変形の描画(綴りで固定)と、既定(hero=false)経路の不変
    check("28.3 hero は任意の引数(既定 false = 既存の呼び出し側は従来のまま)",
      /plain = false, hero = false/.test(chart));
    check("28.3 hero のとき水平グリッドを描かず、0 の基準線だけを破線で示す",
      /\{hero \? \(v === 0 && \(/.test(chart)
      && /strokeDasharray="4 3" style=\{\{ stroke: HERO_CHART_ZERO_LINE \}\}/.test(chart));
    check("28.3 hero=false(既定)の目盛線は従来のまま(var(--c-line) の実線)",
      /<line x1=\{L\.AXW\} y1=\{L\.yAt\(v\)\} x2=\{W\} y2=\{L\.yAt\(v\)\} strokeWidth="1" style=\{\{ stroke: "var\(--c-line\)" \}\} \/>/.test(chart));
    check("28.3 目盛・音名ラベルの色は hero でヒーロー配色・既定(false)で従来色",
      /fill: hero \? HERO_CHART_AXIS_TEXT : "var\(--c-ink-4\)"/.test(chart)
      && /fill: hero \? HERO_CHART_AXIS_TEXT : i === midEbIdx \? "var\(--c-accent\)" : "var\(--c-ink-3\)"/.test(chart));
    check("28.3 hero では中央E♭のガイド線を描かない(既定では描く)",
      /\{!hero && midEbIdx !== null && \(/.test(chart));
    check("28.3 空状態の文言も hero ではヒーロー配色(既定は従来の #8D95A1)",
      /color: hero \? HERO_CHART_AXIS_TEXT : "#8D95A1"/.test(chart));
    // hero を渡すのはデータタブのヒーローの1箇所だけ(集合で縛る)
    {
      const re = /<NoteAxisLineChart\s*\r?\n\s*plain hero\b/g;
      const total = (src.match(re) || []).length;
      const inOwner = (myDataSection.match(re) || []).length;
      check("28.3 hero を渡すのは MyDataSection のヒーローだけ(集合の外に渡し手がいない)",
        total === 1 && inOwner === 1
        && !/\bhero\b/.test(codeOf(srcOfFn(src, "TappableMetricCard")))
        && !/\bhero\b/.test(codeOf(metricRow)),
        `全体 ${total} / MyDataSection ${inOwner}`);
    }
  }

  // --- 28.4 目安(selectedIdeal)の破線と Δ の撤去(他画面はそのまま) --------------
  {
    check("28.4 MetricRow は目安を一切扱わない(selectedIdeal / idealKey / idealDiffText の綴りが無い)",
      !/selectedIdeal|idealKey|idealDiffText/.test(codeOf(metricRow)));
    check("28.4 MyDataSection はどのグラフにも selectedIdeal を渡さない(「目安未設定」の告知の条件にだけ使う)",
      !/selectedIdeal=\{/.test(codeOf(myDataSection)) && /\{!selectedIdeal && \(/.test(myDataSection));
    check("28.4 idealAvgForFrames(Δ の導出)は削除済み(読み手の無い定義を残さない)",
      !/idealAvgForFrames/.test(codeOf(src)));
    {
      const mdm = new Function(`const formatSignedCents = 0, pitchSpreadSub = 0;
        ${extractConst("MY_DATA_METRICS")} return MY_DATA_METRICS;`)();
      check("28.4 MY_DATA_METRICS は idealKey を持たない(読み手の無いフィールドを残さない)",
        mdm.every((m) => !("idealKey" in m)), mdm.map((m) => Object.keys(m).join("+")).join(" / "));
    }
    // 他画面はそのまま: グラフ部品の目安描画と、リード詳細・セッション詳細の配線が生きている
    check("28.4 グラフ部品の目安描画(破線)は従来のまま生きている(他画面用)",
      /if \(selectedIdeal && idealKey\) \{/.test(chart) && /IDEAL_LINE_STYLE/.test(chart));
    check("28.4 リード詳細は selectedIdeal と METRIC_IDEAL_KEYS を渡し続ける",
      /selectedIdeal=\{selectedIdeal\}/.test(srcOfFn(src, "ReedEvaluationDetail"))
      && /idealKey=\{METRIC_IDEAL_KEYS\[m\.key\]\}/.test(srcOfFn(src, "ReedEvaluationDetail")));
    // 【審査で塞いだ穴】前版は「コンポーネント内のどこかに selectedIdeal={selectedIdeal} が
    // 1つあれば」通る形で、SetAsIdealButton / PhraseTimeline の同じ綴りに救われて
    // **指標カードから selectedIdeal を外す変異が生存**した(目安の破線+Δが消えるのに緑)。
    // **指標カードの呼び出しに隣接する綴り**(idealKey と同じ行並び)で錨止めする。
    check("28.4 セッション詳細の指標カードは selectedIdeal と METRIC_IDEAL_KEYS を渡し続ける",
      /metricKey=\{mt\.key\} idealKey=\{METRIC_IDEAL_KEYS\[mt\.key\]\}\s*\r?\n\s*frames=\{frames\} saxType=\{session\.saxType\} tuningHz=\{tuningHz\} selectedIdeal=\{selectedIdeal\}/.test(srcOfFn(src, "SessionDetailView")));
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
