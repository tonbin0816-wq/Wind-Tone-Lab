// src/shell/native.js ── 殻(Capacitor の iOS アプリ)かどうかの判定。**アプリ全体でここだけが window.Capacitor を読む。**
// Web 版(Vercel・dev サーバ・jsdom)には window.Capacitor が無いので false。殻の中では Capacitor のランタイムが
// 描画の前に window.Capacitor を置く(capacitor://localhost の起動時に注入される)。
// @capacitor/core を import しない ── Web 版のバンドルに殻の部品を1バイトも入れないため(殻の仕様 §1.2)。
//
// 【殻の規則(便S1)】
//   ・呼び手は isNativeShell() を読んで分岐するだけ。UA やページの scheme で殻を見分ける綴りはどこにも書かない
//     (pitch-test の節「殻」が見張る)。
//   ・ネイティブの部品(プラグイン)は src/shell/*.native.js に閉じ、isNativeShell() が true の枝の中で
//     **動的 import だけ**で読む。@capacitor/* を静的に import してよいのは *.native.js だけ。
export function isNativeShell() {
  try { return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.() === true; } catch { return false; }
}
// "ios" | "android" | "web"。殻の中では UA を見ずに答えが出る(iPad の Mac 名乗り対策。殻の仕様 §3.9)
export function shellPlatform() {
  try { return isNativeShell() ? String(window.Capacitor.getPlatform()) : "web"; } catch { return "web"; }
}
