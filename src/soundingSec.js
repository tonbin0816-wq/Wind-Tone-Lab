// ------------------------------------------------------------------
// 練習時間 = 1つの計測の中で**音を感知していた時間**(秒)。
//
// 【D1 2026-09-16 実機の指摘・本人裁定⑥】My Data の累計は「録音の長さ」(sessionDurationSec =
// 最後のフレームの t)ではなく、**音を感知していたフレームの合計時間**で数える。
// 無音・ノイズ・ブレスは含めない。取り込んだ動画の計測もフレームの形は同じなので同じ式。
// コミュニティの公開統計(便H)も**この関数**を読む(定義を2箇所に書かない)。
//
// 【発音の判定は App.jsx が既に「音あり」として扱っている基準に揃える】
// フレームの pitchCents は、ライブ(App.jsx の tick)でも取り込み(analyzeAudioBuffer)でも
// **sounding のときだけ**値が入る(noteNow = sounding ? freqToNote(...) : null → centsExact)。
// 取り込みの「有効な音が検出できたか」(hasSound)も同じ pitchCents を見ている。
// **pitchHz では判定しない**: ライブ経路のフレームは pitchHz に MPM の基音をそのまま持つので、
// ノイズゲートを通っていない(sounding でない)フレームにも値が残る。
//
// 【フレーム間隔は隣り合う t の差の中央値】ライブは rAF の間引き(100ms 目標)なので
// 間隔が揺れる。平均だと一時停止や取りこぼしの長い隙間に引きずられるため、中央値を採る。
// ------------------------------------------------------------------

// 「音を感知していた」フレームか。
export function isSoundingFrame(frame) {
  const c = frame?.pitchCents;
  return typeof c === "number" && Number.isFinite(c);
}

// 隣り合う t の差の中央値(秒)。差が取れなければ 0。
export function frameIntervalSec(frames) {
  if (!Array.isArray(frames) || frames.length < 2) return 0;
  const diffs = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]?.t, b = frames[i]?.t;
    if (typeof a !== "number" || typeof b !== "number") continue;
    const d = b - a;
    if (Number.isFinite(d) && d > 0) diffs.push(d);
  }
  if (diffs.length === 0) return 0;
  diffs.sort((x, y) => x - y);
  const mid = diffs.length >> 1;
  return diffs.length % 2 === 1 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
}

// 1つの計測の練習時間(秒)。発音フレーム数 × フレーム間隔。
// frames が無い / 1件以下 / 間隔が出せない → 0。
export function sessionSoundingSec(session) {
  const frames = session?.frames;
  if (!Array.isArray(frames) || frames.length < 2) return 0;
  const interval = frameIntervalSec(frames);
  if (interval <= 0) return 0;
  let n = 0;
  for (const f of frames) if (isSoundingFrame(f)) n++;
  return n * interval;
}
