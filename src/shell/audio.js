// src/shell/audio.js ── 殻の音の出口の呼び口。*.native.js ではないので静的に import してよい(Capacitor に触れない)。
// Web では即 return(動的 import もしない)。殻では自前のネイティブ部品 FicusAudioSession を呼ぶ(殻の仕様 §4.4)。
// 待たない・失敗は無視(出口を寄せられなくても計測とメトロノームは止めない)。
import { isNativeShell } from "./native.js";

export function shellRouteToSpeaker() {
  if (!isNativeShell()) return;
  import("./audioSession.native.js").then((m) => m.routeToSpeaker()).catch(() => {});
}

// 【便CQ】診断の板(src/audioDiag.jsx)が読む音のセッションの値。Web では null(動的 import もしない)。
// 殻のビルドが古く読み出し口が無いときは { error } を返す(板は「要ビルド」と出す)。
export function shellAudioSessionInfo() {
  if (!isNativeShell()) return Promise.resolve(null);
  return import("./audioSession.native.js")
    .then((m) => m.sessionInfo())
    .catch((e) => ({ error: String(e?.code || e?.message || e) }));
}

// 【便CT】診断の板の試し口: 殻の音のセッションのモードを替える(聞き比べ用。保存しない = アプリを開き直せば default)。
// Web では null(動的 import もしない)。殻の答えは { mode }(替えた後のモードの生の値)、断られた・古いビルドは { error }。
export function shellSetAudioTestMode(mode) {
  if (!isNativeShell()) return Promise.resolve(null);
  return import("./audioSession.native.js")
    .then((m) => m.setTestMode(mode))
    .catch((e) => ({ error: String(e?.code || e?.message || e) }));
}

// 【便CS】殻の入力の候補([{ portType, name }])。内蔵マイクの見分け(src/builtInMic.js)が読む。
// Web・殻のビルドが古い(availableInputs を返さない)・失敗のときは null(= ラベルで見分ける道へ落ちる)。
export function shellAvailableInputs() {
  return shellAudioSessionInfo().then((s) => (s && Array.isArray(s.availableInputs) ? s.availableInputs : null));
}

// 【便CU 2026-10-17】診断の板の試し口「鳴らし方」: 殻(アプリのプロセス)の AVAudioEngine でメトロノームのクリックを鳴らす・マイクを取る
// (FicusAudioSession の nativeClickLoad / nativeClickStart / nativeClickStop / nativeInputStart / nativeInputStop / nativeAudioInfo)。
// Web では null(動的 import もしない。板は Web では試し口を出さない)。殻のビルドが古い・断られたときは { error }。
function shellNativeCall(name, arg) {
  if (!isNativeShell()) return Promise.resolve(null);
  return import("./audioSession.native.js")
    .then((m) => m[name](arg))
    .catch((e) => ({ error: String(e?.code || e?.message || e) }));
}
// { sampleRate, accent, beat, sub }(3つは Float32 の標本を base64 にしたもの)を1回渡す
export const shellNativeClickLoad = (o) => shellNativeCall("nativeClickLoad", o);
// { stepSec, kinds }(1小節ぶんの並び。設定が変わったら渡し直す)で鳴らし始める
export const shellNativeClickStart = (o) => shellNativeCall("nativeClickStart", o);
export const shellNativeClickStop = () => shellNativeCall("nativeClickStop");
export const shellNativeInputStart = () => shellNativeCall("nativeInputStart");
export const shellNativeInputStop = () => shellNativeCall("nativeInputStop");
// { engineRunning, clickOn, inputOn, inputDb?, lastError, configChanges }
export const shellNativeAudioInfo = () => shellNativeCall("nativeAudioInfo");
