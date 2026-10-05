// src/shell/policy.js ── 殻(Capacitor の iOS アプリ)での振る舞いの定数と純関数。
// Capacitor に触れないので Web からも静的に import してよい(殻の仕様 §1.2)。値を変えるならここの1か所だけ。

// 【殻 S2】計測タブを離れたときのマイク。Web は "pause"(接続を保つ。1fb310e の決まり)。殻は "stop"(解放。橙の印が消える)。
// 殻では Capacitor が WebKit の許可を自動で通すので、getUserMedia を呼び直しても OS の許可は最初の1回だけ(殻の仕様 §4.3)。
// 殻で止めると許可の直後に固まる(Web の C12 の再来)なら、この定数を false にして Web と同じ振る舞いへ戻す(1か所)。
export const SHELL_STOP_MIC_ON_TAB_LEAVE = true;
export function micActionOnTabLeave(native, stopOnLeave = SHELL_STOP_MIC_ON_TAB_LEAVE) {
  return native && stopOnLeave ? "stop" : "pause";
}

// 【殻 S2】殻のメトロノームのマスターゲイン。殻はネイティブで出口をスピーカーへ回す(FicusAudioSession)ので 1.0 から始める。
// 実機でまだ小さいなら 2.6 にして再ビルド(殻の仕様 §4.4)。Web の 2.6 は App.jsx の getMetroMasterInput の行が唯一の答え
// (D-24 §1.5 の凍結値。ここに写しを持たない)。殻の値は startMetronome が ctx に置き、getMetroMasterInput が読む。
export const METRO_MASTER_GAIN_SHELL = 1.0;
