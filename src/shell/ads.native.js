// 【殻 S3】広告の帯(AdMob のバナー1本・下部タブの上)と ATT(殻の仕様 §5.3)。
// 殻の枝(src/shell/ads.js の shellStartAdsOnce / shellSetAdsHidden)からだけ動的 import で読む。
// プラグインは @capacitor-community/admob 8.1.0(iOS の実装 = node_modules/@capacitor-community/admob/ios/Sources/AdMobPlugin)。
import { AdMob, BannerAdSize, BannerAdPosition, BannerAdPluginEvents } from "@capacitor-community/admob";
import { ADMOB_USE_TEST_ADS, ADMOB_BANNER_UNIT_ID_IOS } from "./adsConfig.js";
import { adBannerMargin, ATT_RETRY_DELAY_MS, ATT_FOCUS_WAIT_MAX_MS } from "./policy.js";

let started = false;
let hidden = false;      // シートが開いている(帯を隠したい)か。帯が来る前に開いたシートにも効かせるために持つ
let bannerUp = false;    // showBanner を呼び終えたか(それより前の hide / resume / 取り直しはプラグインに送らない)
let lastShow = null;     // 最後に showBanner へ渡したもの(取り直しは同じ margin・同じ npa で呼ぶ)
let reloading = null;    // 取り直しの最中(続けて頼まれたら、終わってからもう1回)
let reloadAgain = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visibleAndFocused = () => document.visibilityState === "visible" && document.hasFocus();
// 画面が見えていてフォーカスがある状態を待つ(アプリが前面に戻り切るのを待つ)。そろえば true。
// 【殻 S3 統括の裁定】待つのは maxMs まで。過ぎたら false(尋ね直さない)。
function whenVisibleAndFocused(maxMs) {
  if (visibleAndFocused()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer = 0;
    const done = (ok) => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      resolve(ok);
    };
    const check = () => { if (visibleAndFocused()) done(true); };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    timer = setTimeout(() => done(false), maxMs);
  });
}

// ATT: 未決定のときだけ尋ね、答えを読み直す(プラグインの requestTrackingAuthorization は答えを返さない)。
// 【便CH】同意の画面(askTrackingAfterConsent)と広告を始めるとき(startAds)の両方がこの1つを使う(写しを作らない)。
async function askTracking() {
  const { status } = await AdMob.trackingAuthorizationStatus();
  if (status !== "notDetermined") return status;
  await AdMob.requestTrackingAuthorization();
  return (await AdMob.trackingAuthorizationStatus()).status;
}
// 【殻 S3 統括の裁定】マイクの許可の画面の直後はアプリがまだ前面に戻り切っておらず、iOS が ATT の画面を出さずに
// 未決定のまま返すことがある。そのときは**帯を先に npa で出しておき**、そのあとで画面が見えてフォーカスが戻るのを待ち
// (ATT_FOCUS_WAIT_MAX_MS まで)、ATT_RETRY_DELAY_MS おいて1回だけ尋ね直す。待ちが上限を過ぎたら尋ね直さない。
// 尋ね直して「許可」になっても、この起動の帯は npa のまま(npa は広告を取りに行くたびの引数で、出したあとに替える API が無い)。
// 次の起動から通常の広告になる。
async function askTrackingAgain() {
  const ok = await whenVisibleAndFocused(ATT_FOCUS_WAIT_MAX_MS);
  if (!ok) return;
  await sleep(ATT_RETRY_DELAY_MS);
  await AdMob.requestTrackingAuthorization();
}

// 【便CH 2026-10-10 本人「トラッキングの許可は最初のプライバシーポリシーとかと同じタイミングにして」】
// 同意の画面の2枚目で「次へ」を押した直後に尋ねる(殻だけ。呼び口は ads.js の shellAskTrackingAfterConsent。待ちの上限もそちら)。
// この起動で同意の画面が尋ねたら、広告を始めるとき(startAds)は尋ねず、決まっている状態を読んで npa を決めるだけ(尋ね直しもしない)。
// 同意の画面を通らずに起動した人(記録がすでにある人)で未決定なら、今までどおり広告を始めるときに尋ねる。
let askedAtConsent = false;
export async function askTrackingAfterConsent() {
  askedAtConsent = true;
  return askTracking();
}

// onHeight(h): 帯の実寸の高さ(pt = CSS px)を受ける。0 は「帯が無い」(読み込みの失敗)。すき間は呼び手(ads.js)が足す。
// navTop / inset / innerHeight / gap: 下部タブの上端・安全域の下の幅・画面の高さ・すき間(呼び手が測る)。
export async function startAds({ onHeight, navTop, inset = 0, gap = 0, innerHeight = window.innerHeight, hidden: hiddenAtStart = false }) {
  if (started) return;
  started = true;
  hidden = !!hiddenAtStart;
  await AdMob.initialize({ initializeForTesting: ADMOB_USE_TEST_ADS });
  // 「許可」以外(拒否・制限・未決定のまま・読めない)はパーソナライズしない広告(npa。本人裁定)。拒否でも帯は出る。
  let npa = true;
  let askAgain = false;
  try {
    const now = askedAtConsent ? (await AdMob.trackingAuthorizationStatus()).status : await askTracking();
    npa = now !== "authorized";
    askAgain = !askedAtConsent && now === "notDetermined";
  } catch { /* 続ける(npa のまま) */ }
  // SizeChanged は hideBanner でも高さ 0 で来る(BannerExecutor.swift の hideBanner)。0 は無視して --ad-h を戻さない
  // (シートの間も裏のページを跳ねさせない。便BL の規則)。帯が無いこと(0)は FailedToLoad で知る。
  AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => { if (size?.height > 0) onHeight(size.height); });
  AdMob.addListener(BannerAdPluginEvents.FailedToLoad, () => onHeight(0));
  // 帯のビューは広告が届いたとき(bannerViewDidReceiveAd)に初めて画面に足される。それより前に hideBanner を送っても
  // 隠す相手が居ない(ログを出すだけ)ので、届くたび(自動の更新・取り直しを含む)に、隠したい間なら隠し直す。
  AdMob.addListener(BannerAdPluginEvents.Loaded, () => { if (hidden) AdMob.hideBanner().catch(() => {}); });
  lastShow = {
    adId: ADMOB_BANNER_UNIT_ID_IOS, adSize: BannerAdSize.ADAPTIVE_BANNER, position: BannerAdPosition.BOTTOM_CENTER,
    margin: adBannerMargin({ innerHeight, navTop, inset, gap }),
    // isTesting は常に false。このプラグインは isTesting が true だと adId を捨てて自前の試験用 ID
    // (AdMobPlugin.swift の showBanner → getAdId。末尾 /6300978111)に替える。それは Android の demo のバナーで
    // (https://developers.google.com/admob/android/test-ads)、iOS の demo ではない。試験用の広告は adsConfig.js の iOS の demo で出す。
    isTesting: false,
    npa,
  };
  await AdMob.showBanner(lastShow);
  bannerUp = true;
  if (hidden) await AdMob.hideBanner().catch(() => {});
  // 未決定のまま返ったときの尋ね直し(帯を出したあと。待たない・失敗は無視)
  if (askAgain) askTrackingAgain().catch(() => {});
}

// シートが開いている間は隠す・閉じたら戻す(本人裁定)。高さ(--ad-h)は変えない。
export function setAdsHidden(next) {
  hidden = !!next;
  if (!bannerUp) return Promise.resolve();
  return (hidden ? AdMob.hideBanner() : AdMob.resumeBanner()).catch(() => {});
}

// 【殻 S3 統括の裁定】画面の幅が変わったとき(iPad を回した)に帯を取り直す: removeBanner → 同じ margin で showBanner。
// --ad-h は触らない(次の SizeChanged が新しい実寸を入れる)。隠している間なら取り直したあとも隠す。
export function reloadAds() {
  if (!bannerUp || !lastShow) return Promise.resolve();
  if (reloading) { reloadAgain = true; return reloading; }
  reloading = (async () => {
    do {
      reloadAgain = false;
      try {
        await AdMob.removeBanner();
        await AdMob.showBanner(lastShow);
        if (hidden) await AdMob.hideBanner().catch(() => {});
      } catch { /* 取り直せなくても続ける(次の回転でまた試す) */ }
    } while (reloadAgain);
  })().finally(() => { reloading = null; });
  return reloading;
}
