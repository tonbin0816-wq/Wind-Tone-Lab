// 【殻 S2】スリープ防止。WKWebView の navigator.wakeLock の代わりに KeepAwake(UIApplication.isIdleTimerDisabled)を使う。
// App.jsx の requestWakeLock / releaseWakeLock の殻の枝からだけ動的 import で読む(殻の仕様 §4.2)。
import { KeepAwake } from "@capacitor-community/keep-awake";

export const keepAwake = () => KeepAwake.keepAwake();
export const allowSleep = () => KeepAwake.allowSleep();
