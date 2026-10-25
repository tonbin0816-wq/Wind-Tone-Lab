// src/shell/native.js ── 殻(Capacitor の iOS アプリ)かどうかの判定。**アプリ全体でここだけが window.Capacitor を読む。**
// Web 版(Vercel・dev サーバ・jsdom)には window.Capacitor が無いので false。殻の中では Capacitor のランタイムが
// 描画の前に window.Capacitor を置く(capacitor://localhost の起動時に注入される)。
// @capacitor/core を import しない ── Web 版のバンドルに殻の部品を1バイトも入れないため(殻の仕様 §1.2)。
//
// 【殻の規則(便S1)】
//   ・呼び手は isNativeShell() を読んで分岐するだけ。UA やページの scheme で殻を見分ける綴りはどこにも書かない
//     (pitch-test の節「殻」が見張る)。【便S4】例外はこのファイルの shellBuildKind() だけ: 殻と分かったあとで、
//     開発版と本番を scheme で分ける(殻かどうかの判定には使わない)。
//   ・ネイティブの部品(プラグイン)は src/shell/*.native.js に閉じ、isNativeShell() が true の枝の中で
//     **動的 import だけ**で読む。@capacitor/* を静的に import してよいのは *.native.js だけ。
export function isNativeShell() {
  try { return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.() === true; } catch { return false; }
}
// "ios" | "android" | "web"。殻の中では UA を見ずに答えが出る(iPad の Mac 名乗り対策。殻の仕様 §3.9)
export function shellPlatform() {
  try { return isNativeShell() ? String(window.Capacitor.getPlatform()) : "web"; } catch { return "web"; }
}

// 【便S4 2026-10-25】ビルドの種類。"web" | "dev" | "release"。
//   ・"web"     … 殻ではない(Vercel・dev サーバ・jsdom で window.Capacitor が無い)
//   ・"release" … 殻で、ページが同梱の資産(capacitor://localhost)から来ている = 本番(ios-release / ios-testflight)
//   ・"dev"     … 殻で、それ以外の scheme から来ている = 開発版 Ficus Dev(ios-dev は server.url で https の Vercel を読む)
// 印を server.url の有無(= ページの scheme)にした理由:
//   (1) 開発版と本番の違いそのものが server.url。開発版である限り必ず https:(Vercel)から読み、本番は必ず capacitor: から読む
//       (capacitor.config.json に server を書かないので iOS の既定 scheme の capacitor のまま。src/shell/adsRelease.test.jsx が見張る)。
//   (2) ネイティブ(Swift・Info.plist の独自の鍵・プラグイン)を足さずに済む。この端末では Swift をコンパイルできず、
//       しかも既に入っている開発版のビルドは Info.plist の新しい鍵を持たない。scheme なら、入っている開発版も
//       Vercel の JS が新しくなった時点で正しく「dev」になる(本物の広告を出す側に倒れない)。
//   (3) 迷ったら試験の側: capacitor: と分かったときだけ "release"。読めない・知らない scheme は "dev"(本物の広告を出さない・診断の板は開ける)。
// 呼び手: adsConfig.js の admobIds(広告の ID)・audioDiag.jsx(診断の板を本番で開かない)。UA や scheme を読むのはここだけ(pitch-test K.2)。
export function shellBuildKind(protocol) {
  if (!isNativeShell()) return "web";
  try {
    const p = protocol === undefined ? String(window.location.protocol) : String(protocol);
    return p === "capacitor:" ? "release" : "dev";
  } catch { return "dev"; }
}
