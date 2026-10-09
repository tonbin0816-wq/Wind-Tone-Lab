// src/shell/ads.js ── 殻の広告の帯の呼び口。*.native.js ではないので静的に import してよい(Capacitor に触れない)。
// Web では即 return(動的 import も DOM への書き込みもしない)。殻では ads.native.js を動的 import で読む(殻の仕様 §5.3)。
// 待たない・失敗は無視(帯が出なくても計測は止めない)。
import { isNativeShell } from "./native.js";
import { AD_H_INITIAL_PX, AD_RELOAD_DEBOUNCE_MS, ATT_FOCUS_WAIT_MAX_MS } from "./policy.js";

// --ad-h を書き換えたことを知らせる window の出来事の名前(参加の画面のカードが見える範囲を読み直す。CommunityTab.jsx)。
export const AD_HEIGHT_EVENT = "ficus-ad-height";

let started = false;
let hiddenWanted = false;   // シートが開いているか(帯を始める前に開いたシートの分も、始めるときに渡す)
let gapPx = 0;              // 帯と下部タブの間のすき間(--sp-2 の px)。始めるときに1回読む

// --sp-2 の px(index.css の :root。素の "8px" なので parseFloat で読める)。読めなければ 0。
function readGapPx() {
  try { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sp-2")) || 0; } catch { return 0; }
}

// 帯の高さを --ad-h へ(index.css の --page-bottom-gap が足す)。<html> の inline style なので :root の既定 0px と見本の値に勝つ。
// 【殻 S3 統括の裁定】--ad-h = 帯の高さ + すき間(--sp-2)。帯が無い(0)ときはすき間も取らない。
function setAdHeight(h) {
  const v = h > 0 ? Math.round(h) + Math.round(gapPx) : 0;
  try { document.documentElement.style.setProperty("--ad-h", `${Math.max(0, v)}px`); } catch { /* noop */ }
  try { window.dispatchEvent(new Event(AD_HEIGHT_EVENT)); } catch { /* noop */ }
}

// 下部タブ(App.jsx の BottomNav の根。data-bottom-nav)の上端と、その下の安全域(paddingBottom = env(safe-area-inset-bottom))。
function readNavGeometry() {
  const el = document.querySelector("[data-bottom-nav]");
  const innerHeight = window.innerHeight;
  if (!el) return { innerHeight, navTop: innerHeight, inset: 0 };
  const inset = parseFloat(getComputedStyle(el).paddingBottom) || 0;
  return { innerHeight, navTop: el.getBoundingClientRect().top, inset };
}

// 【殻 S3 統括の裁定】画面の幅が変わったら(iPad を回した)帯を取り直す。アダプティブの帯の幅は showBanner のときに決まるため。
// resize は続けて来るので AD_RELOAD_DEBOUNCE_MS 待って最後の1回だけ。幅が同じ(高さだけ変わった)なら何もしない。
// --ad-h は次の SizeChanged まで今の値を保つ。シートで隠している間は、取り直したあとも隠したまま(ads.native.js)。
function watchWidth() {
  let lastW = window.innerWidth;
  let timer = 0;
  const onResize = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      import("./ads.native.js").then((m) => m.reloadAds()).catch(() => {});
    }, AD_RELOAD_DEBOUNCE_MS);
  };
  window.addEventListener("resize", onResize);
}

// 起動時の最初のマイクの試み(App.jsx の startListening の完全再取得)が成功・失敗どちらでも終わった直後に呼ぶ。
// 1回だけ。OS のマイクの許可の画面と ATT の画面を重ねないため、この時機にする。
// 【便CG 2026-10-09 統括の裁定】さらに、はじめの案内が終わるまでは呼ばない(App.jsx がマイクの試みのあと onboarding.jsx の adsAllowed が立ったときに呼ぶ)。
export function shellStartAdsOnce() {
  if (!isNativeShell() || started) return;
  started = true;
  gapPx = readGapPx();
  setAdHeight(AD_H_INITIAL_PX);   // 来るまでの仮の高さ(跳ねを1回にする)
  const geo = readNavGeometry();
  watchWidth();
  // 帯を出す前に失敗したら(プラグインが無い古い殻のビルド・初期化の失敗など)、仮に取った高さを 0 に戻す
  // (開発版の殻は Web が先に新しくなり得る。帯の無い殻で下部タブの上に空きを残さない)。
  import("./ads.native.js")
    .then((m) => m.startAds({ ...geo, gap: gapPx, hidden: hiddenWanted, onHeight: setAdHeight }))
    .catch(() => setAdHeight(0));
}

// 【便CH 2026-10-10 本人「トラッキングの許可は最初のプライバシーポリシーとかと同じタイミングにして」】
// 同意の画面の2枚目の「次へ」の直後(記録を書いたあと)に ATT を尋ねる(未決定のときだけ。ads.native.js の askTrackingAfterConsent)。
// Web では何もせず null を返す(待つものが無い)。殻では Promise を返し、答えが出たら・失敗したら・ATT_FOCUS_WAIT_MAX_MS を過ぎたら
// 必ず解決する(棄却しない)── ATT の画面が出なかった・プラグインが無い・返ってこないときも、アプリ本体へ進めるように。
export function shellAskTrackingAfterConsent() {
  if (!isNativeShell()) return null;
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ATT_FOCUS_WAIT_MAX_MS);
    import("./ads.native.js")
      .then((m) => m.askTrackingAfterConsent())
      .catch(() => {})
      .finally(() => { clearTimeout(timer); resolve(); });
  });
}

// シートが開いている間は帯を隠す(本人裁定)。--ad-h は戻さない(便BL の規則。裏のページを跳ねさせない)。
export function shellSetAdsHidden(hidden) {
  if (!isNativeShell()) return;
  hiddenWanted = !!hidden;
  if (!started) return;
  import("./ads.native.js").then((m) => m.setAdsHidden(hiddenWanted)).catch(() => {});
}
