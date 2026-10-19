// src/shell/audio.js ── 殻の音の部品の呼び口。*.native.js ではないので静的に import してよい(Capacitor に触れない)。
// Web では即 return / null(動的 import もしない)。殻では自前のネイティブ部品 FicusAudioSession を呼ぶ(殻の仕様 §4.4)。
// 【便CX 2026-10-19】WebKit がもう音のセッションを立て直さない(殻では getUserMedia も Web の AudioContext も使わない)ので、
// 出口を寄せる shellRouteToSpeaker と、診断の板の試し口(shellSetAudioTestMode・shellNative*)は消した。
import { isNativeShell } from "./native.js";

// 【便CQ】診断の板(src/audioDiag.jsx)が読む音のセッションの値。Web では null(動的 import もしない)。
// 殻のビルドが古く読み出し口が無いときは { error } を返す(板は「要ビルド」と出す)。
export function shellAudioSessionInfo() {
  if (!isNativeShell()) return Promise.resolve(null);
  return import("./audioSession.native.js")
    .then((m) => m.sessionInfo())
    .catch((e) => ({ error: String(e?.code || e?.message || e) }));
}

// 【便CS】殻の入力の候補([{ portType, name }])。内蔵マイクの見分け(src/builtInMic.js)が読む。
// Web・殻のビルドが古い(availableInputs を返さない)・失敗のときは null(= ラベルで見分ける道へ落ちる)。
// 【便CX】殻の計測は getUserMedia を使わないので、いまの呼び手(startListening の Web の枝)では Web の答え(null)だけになる。
export function shellAvailableInputs() {
  return shellAudioSessionInfo().then((s) => (s && Array.isArray(s.availableInputs) ? s.availableInputs : null));
}

// 【便CX】殻の計測の音(メトロノームとマイク)の呼び口。Web では null(呼び手は殻の枝でだけ使う)。
// どのメソッドも Promise を返し、失敗(殻が断った・古いビルド)は reject のまま渡す(呼び手が失敗の道を持つ)。
// on(event, fn) は殻からの知らせを受け、答えは「受けるのをやめる関数」の Promise。計測では nativeAudio.js の nativeEvents だけが
// 殻の部品ごとに最初の1回呼び、この関数は呼ばない(流している間に殻への登録を書き換えない)。
function nativeCall(name, arg) {
  return import("./audioSession.native.js").then((m) => m[name](arg));
}
const NATIVE_AUDIO_API = {
  micStart: (o) => nativeCall("micStart", o),
  micStop: (o) => nativeCall("micStop", o),
  metroLoad: (o) => nativeCall("metroLoad", o),
  metroStart: (o) => nativeCall("metroStart", o),
  metroUpdate: (o) => nativeCall("metroUpdate", o),
  metroStop: (o) => nativeCall("metroStop", o),
  clock: () => nativeCall("audioClock"),
  info: () => nativeCall("audioInfo"),
  on: (event, fn) => import("./audioSession.native.js")
    .then((m) => m.addListener(event, fn))
    .then((h) => () => { try { const r = h && h.remove ? h.remove() : null; if (r && typeof r.catch === "function") r.catch(() => {}); } catch { /* noop */ } }),
};
export function shellNativeAudio() {
  return isNativeShell() ? NATIVE_AUDIO_API : null;
}
