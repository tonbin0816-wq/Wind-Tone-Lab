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
