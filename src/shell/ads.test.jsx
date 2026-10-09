// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ------------------------------------------------------------------
// 【殻 S3 2026-10-06】広告の帯(AdMob)の部品。凍結仕様 shell-spec.md §5.2・§5.3・§8.1-S3 と、審査の裁定(重1〜重3・軽3・軽4)。
// プラグイン @capacitor-community/admob は作り物にする(AdMob の呼び出しだけを差し替え、列挙の値は本物のまま)。
//   ・殻: 呼び口 shellStartAdsOnce → initialize → ATT(未決定なら尋ねて読み直す)→ 聞き手 → showBanner の**順**
//   ・帯の実寸(SizeChanged)+ すき間 --sp-2 が --ad-h に入る / 隠したときの高さ 0 では戻さない / 読み込みの失敗で 0px / 2回目は何もしない
//   ・margin = 下部タブの高さ(安全域を除く)+ すき間
//   ・ATT: 「許可」なら npa false・それ以外(拒否・制限・未決定のまま・例外)は npa。未決定のまま返ったら、画面が見えて
//     フォーカスが戻るのを待ち、1.5 秒おいて1回だけ尋ね直す
//   ・画面の幅が変わったら(iPad の回転)removeBanner → 同じ margin で showBanner。--ad-h は次の SizeChanged まで保つ。隠している間は隠し直す
//   ・帯が来る前に開いたシートでも、帯が来たら隠す(プラグインは帯のビューを広告が届いてから足すため)
//   ・Web(window.Capacitor 無し): プラグインに何も渡らず、--ad-h も触らない
// 期待値の綴り(ID・"ADAPTIVE_BANNER"・"bannerAdSizeChanged" など)は adsConfig.js からではなく、Google の文書と
// プラグインの Swift の実装(BannerExecutor.swift の switch / BannerAdPluginEvents.swift の rawValue)から手で写した。
// 【守っていないもの】実機で帯が下部タブの上に出ること・ATT の画面が実際に出ること・帯の高さの実寸・回転で帯の幅が合うこと(どれも実機待ち)。
// ------------------------------------------------------------------
const ad = vi.hoisted(() => ({ log: [], calls: [], handlers: {}, statuses: [], failInit: false, statusThrows: false }));
// @capacitor/core の本物は読まれた瞬間に window.Capacitor を上書きする(jsdom では殻の作り物が Web に化ける)ので、作り物にしておく。
vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({}) }));
vi.mock("@capacitor-community/admob", async (importOriginal) => {
  const real = await importOriginal();
  const rec = (name, ret) => async (arg) => { ad.log.push(name); ad.calls.push([name, arg]); return ret?.(arg); };
  return {
    ...real,
    AdMob: {
      initialize: rec("initialize", () => { if (ad.failInit) throw new Error("plugin is not implemented on ios"); }),
      trackingAuthorizationStatus: rec("trackingAuthorizationStatus", () => {
        if (ad.statusThrows) throw new Error("trackingAuthorizationStatus can't get status");
        return { status: ad.statuses.length > 1 ? ad.statuses.shift() : ad.statuses[0] };
      }),
      requestTrackingAuthorization: rec("requestTrackingAuthorization", () => ({})),
      addListener: async (ev, fn) => { ad.log.push(`addListener:${ev}`); (ad.handlers[ev] ||= []).push(fn); return { remove() {} }; },
      showBanner: rec("showBanner"),
      hideBanner: rec("hideBanner"),
      resumeBanner: rec("resumeBanner"),
      removeBanner: rec("removeBanner"),
    },
  };
});

const fire = (ev, data) => (ad.handlers[ev] || []).forEach((fn) => fn(data));
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, label, ms = 10000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`${label} が来ない: ${JSON.stringify(ad.log)}`);
    await wait(5);
  }
  await flush();
}
// 動的 import(ads.native.js とプラグインの変換)は初回に時間がかかるので、帯を出し終えるまで待つ
const count = (name) => ad.log.filter((x) => x === name).length;
const untilShown = (n = 1) => until(() => count("showBanner") >= n, "showBanner");
const adH = () => document.documentElement.style.getPropertyValue("--ad-h");
const asShell = () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" }; };
const showArgs = (k = 0) => ad.calls.filter(([n]) => n === "showBanner")[k][1];

// 下部タブの作り物(iPhone 縦 375×812: 上端 731・安全域 34 = 高さ 47 + 34)
function placeNav({ top = 731, inset = 34 } = {}) {
  const el = document.createElement("div");
  el.setAttribute("data-bottom-nav", "");
  el.style.paddingBottom = `${inset}px`;
  el.getBoundingClientRect = () => ({ top, bottom: 812, left: 0, right: 375, width: 375, height: 812 - top });
  document.body.appendChild(el);
}
// 画面の見え方とフォーカス(ATT の尋ね直しの待ち)
let visibility = "visible"; let focused = true;
function setVisible(v, f) {
  visibility = v; focused = f;
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
}

// 前のテストの部品(モジュールの複製)が付けた聞き手を、テストごとに個別に外す
const added = [];
let ads;
beforeEach(async () => {
  vi.resetModules();
  ad.log.length = 0; ad.calls.length = 0; ad.handlers = {}; ad.statuses = ["notDetermined", "denied"]; ad.failInit = false; ad.statusThrows = false;
  visibility = "visible"; focused = true;
  Object.defineProperty(document, "visibilityState", { get: () => visibility, configurable: true });
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  for (const target of [window, document]) {
    const orig = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type, fn, opt) => { added.push([target, type, fn, opt]); return orig(type, fn, opt); });
  }
  Object.defineProperty(window, "innerHeight", { value: 812, configurable: true, writable: true });
  Object.defineProperty(window, "innerWidth", { value: 375, configurable: true, writable: true });
  document.documentElement.style.removeProperty("--ad-h");
  document.documentElement.style.setProperty("--sp-2", "8px");   // index.css の --sp-2(jsdom は index.css を読まない)
  ads = await import("./ads.js");
});
afterEach(() => {
  for (const [target, type, fn, opt] of added.splice(0)) target.removeEventListener(type, fn, opt);
  vi.restoreAllMocks();
  delete document.visibilityState;
  delete window.Capacitor;
  document.body.innerHTML = "";
  // 注入した inline の値を個別に片付ける
  document.documentElement.style.removeProperty("--ad-h");
  document.documentElement.style.removeProperty("--sp-2");
});

describe("殻: 広告の帯を始める順と、帯の高さ(--ad-h = 帯 + すき間 --sp-2)", () => {
  it("initialize → ATT の状態 → 未決定なら尋ねて読み直す → 聞き手 → showBanner の順。中身は iOS の demo のユニット・アダプティブ・下中央・margin 55", async () => {
    asShell(); placeNav();
    ads.shellStartAdsOnce();
    expect(adH()).toBe("58px");   // 来るまでの仮の高さ 50(仕様 §5.3 の AD_H_INITIAL_PX)+ すき間 8
    await untilShown();
    expect(ad.log).toEqual([
      "initialize", "trackingAuthorizationStatus", "requestTrackingAuthorization", "trackingAuthorizationStatus",
      "addListener:bannerAdSizeChanged", "addListener:bannerAdFailedToLoad", "addListener:bannerAdLoaded",
      "showBanner",
    ]);
    expect(ad.calls[0][1]).toEqual({ initializeForTesting: true });
    expect(showArgs()).toEqual({
      adId: "ca-app-pub-3940256099942544/2435281174",   // https://developers.google.com/admob/ios/test-ads の Anchored Adaptive Banner
      adSize: "ADAPTIVE_BANNER", position: "BOTTOM_CENTER",
      margin: 55,          // (812 − 731 − 34) + 8(プラグインの margin は安全域の下端から。BannerExecutor.swift。すき間 --sp-2 を足す)
      isTesting: false,    // true だとプラグインが Android の demo の ID に差し替える(AdMobPlugin.swift の getAdId)
      npa: true,           // 尋ねた答えが denied
    });
  });

  it("SizeChanged の実寸 + すき間が --ad-h に入る。隠したときの高さ 0 では戻さない。読み込みの失敗で 0px(すき間も取らない)", async () => {
    asShell(); placeNav();
    const seen = [];
    window.addEventListener(ads.AD_HEIGHT_EVENT, () => seen.push(adH()));
    ads.shellStartAdsOnce();
    await untilShown();
    fire("bannerAdSizeChanged", { width: 375, height: 56 });
    expect(adH()).toBe("64px");
    fire("bannerAdSizeChanged", { width: 0, height: 0 });   // hideBanner のときプラグインが送る
    expect(adH()).toBe("64px");
    fire("bannerAdFailedToLoad", { code: 0, message: "no fill" });
    expect(adH()).toBe("0px");
    expect(seen).toEqual(["58px", "64px", "0px"]);   // 書き換えるたびに知らせる(参加の画面のカードが読み直す)
  });

  it("2回目の shellStartAdsOnce は何もしない(initialize も showBanner も1回)", async () => {
    asShell(); placeNav();
    ads.shellStartAdsOnce();
    await untilShown();
    ads.shellStartAdsOnce();
    await flush();
    expect(count("initialize")).toBe(1);
    expect(count("showBanner")).toBe(1);
  });
});

describe("殻: ATT と npa(許可のときだけパーソナライズ)", () => {
  const run = async () => { asShell(); placeNav(); ads.shellStartAdsOnce(); await untilShown(); return showArgs().npa; };
  it("既に許可: 尋ねない・npa false", async () => {
    ad.statuses = ["authorized"];
    expect(await run()).toBe(false);
    expect(count("requestTrackingAuthorization")).toBe(0);
  });
  it("既に拒否: 尋ねない・npa true", async () => {
    ad.statuses = ["denied"];
    expect(await run()).toBe(true);
    expect(count("requestTrackingAuthorization")).toBe(0);
  });
  it("未決定 → 尋ねて許可: npa false", async () => {
    ad.statuses = ["notDetermined", "authorized"];
    expect(await run()).toBe(false);
    expect(count("requestTrackingAuthorization")).toBe(1);
  });
  it("制限(restricted): 尋ねない・npa true", async () => {
    ad.statuses = ["restricted"];
    expect(await run()).toBe(true);
    expect(count("requestTrackingAuthorization")).toBe(0);
  });
  it("状態が読めない(例外): npa true で帯は出す", async () => {
    ad.statusThrows = true;
    expect(await run()).toBe(true);
    expect(count("showBanner")).toBe(1);
  });
  it("尋ねても未決定のまま: 帯を先に npa で出し、そのあと画面が見えてフォーカスが戻るまで待って、1.5 秒おいて1回だけ尋ね直す", async () => {
    ad.statuses = ["notDetermined"];   // ずっと未決定
    visibility = "hidden"; focused = false;
    asShell(); placeNav();
    ads.shellStartAdsOnce();
    await untilShown();                                       // 尋ね直しを待たずに帯は出る
    expect(showArgs().npa).toBe(true);
    expect(count("requestTrackingAuthorization")).toBe(1);
    await wait(1800);
    expect(count("requestTrackingAuthorization")).toBe(1);   // 見えていない間は尋ね直さない
    setVisible("visible", false);
    await wait(1800);
    expect(count("requestTrackingAuthorization")).toBe(1);   // フォーカスが無い間も尋ね直さない
    const t0 = Date.now();
    setVisible("visible", true);
    await until(() => count("requestTrackingAuthorization") === 2, "尋ね直し");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1450);    // 1.5 秒おいてから
    await wait(2000);
    expect(count("requestTrackingAuthorization")).toBe(2);   // 1回だけ
    expect(count("showBanner")).toBe(1);                      // 帯は出し直さない(この起動は npa のまま)
  }, 20000);

  // 【殻 S3 統括の裁定】待ちの上限 10 秒(ATT_FOCUS_WAIT_MAX_MS)。WKWebView で hasFocus() が true にならない端末への備え
  it("見えていてフォーカスがある状態が 10 秒そろわなければ、尋ね直さない(帯は npa のまま出ている)。上限のあとにそろっても尋ねない", async () => {
    ad.statuses = ["notDetermined"];
    visibility = "visible"; focused = false;   // 見えているがフォーカスが来ない
    asShell(); placeNav();
    ads.shellStartAdsOnce();
    await untilShown();
    expect(showArgs().npa).toBe(true);
    await wait(10600);                          // 上限 10 秒 + ゆとり
    setVisible("visible", true);                // 上限のあとにそろう
    await wait(2200);                           // 1.5 秒の待ちより長く見る
    expect(count("requestTrackingAuthorization")).toBe(1);   // 尋ね直していない
    expect(count("showBanner")).toBe(1);
  }, 30000);
});

// 【便CH 2026-10-10】同意の画面の「次へ」の直後に尋ねる呼び口(shellAskTrackingAfterConsent)。根を描く検査は src/consentAtt.test.jsx。
describe("【便CH】同意の画面の ATT の呼び口", () => {
  it("Web: null を返し、プラグインに何も渡らない", async () => {
    expect(ads.shellAskTrackingAfterConsent()).toBe(null);
    await flush();
    expect(ad.log).toEqual([]);
  });
  it("殻: 未決定なら尋ねて読み直し、解決する。そのあと帯を始めるときは状態を読むだけ(尋ねない)。npa は読んだ答えから", async () => {
    ad.statuses = ["notDetermined", "authorized"];
    asShell(); placeNav();
    await ads.shellAskTrackingAfterConsent();
    expect(ad.log).toEqual(["trackingAuthorizationStatus", "requestTrackingAuthorization", "trackingAuthorizationStatus"]);
    ads.shellStartAdsOnce();
    await untilShown();
    expect(ad.log.slice(3, 5)).toEqual(["initialize", "trackingAuthorizationStatus"]);
    expect(count("requestTrackingAuthorization")).toBe(1);
    expect(showArgs().npa).toBe(false);
  });
  it("殻: 状態が読めなくても(例外)棄却せず解決する", async () => {
    ad.statusThrows = true;
    asShell();
    await expect(ads.shellAskTrackingAfterConsent()).resolves.toBe(undefined);
  });
});

describe("殻: 帯を出す前に失敗したとき", () => {
  it("プラグインが無い(古い殻のビルドで initialize が失敗する)と、仮の高さを 0px に戻す。showBanner は呼ばない", async () => {
    asShell(); placeNav();
    ad.failInit = true;
    ads.shellStartAdsOnce();
    expect(adH()).toBe("58px");
    await until(() => adH() === "0px", "0px");
    expect(ad.log).toEqual(["initialize"]);
  });
});

describe("殻: 画面の幅が変わったら(iPad の回転)帯を取り直す", () => {
  const rotate = (w) => { window.innerWidth = w; window.dispatchEvent(new Event("resize")); };
  it("幅が変わると、間引いたあと1回だけ removeBanner → 同じ margin で showBanner。--ad-h は次の SizeChanged まで保つ", async () => {
    asShell(); placeNav();
    ads.shellStartAdsOnce();
    await untilShown();
    fire("bannerAdSizeChanged", { width: 375, height: 56 });
    ad.log.length = 0;
    rotate(900); rotate(1000); rotate(1180);   // 続けて来る resize
    await wait(100);
    expect(ad.log).toEqual([]);                 // 間引きの間は何もしない
    await until(() => count("showBanner") === 1, "取り直し");
    expect(ad.log).toEqual(["removeBanner", "showBanner"]);
    expect(showArgs(1)).toEqual(showArgs(0));   // 同じ margin・同じ npa
    expect(adH()).toBe("64px");                 // 取り直しの間も高さは保つ
    fire("bannerAdSizeChanged", { width: 1180, height: 90 });
    expect(adH()).toBe("98px");
  });

  it("幅が同じ(高さだけ変わった)なら取り直さない", async () => {
    asShell(); placeNav();
    ads.shellStartAdsOnce();
    await untilShown();
    ad.log.length = 0;
    window.innerHeight = 700; window.dispatchEvent(new Event("resize"));
    await wait(600);
    expect(ad.log).toEqual([]);
  });

  it("シートで隠している間に回すと、取り直したあとも隠したまま", async () => {
    asShell(); placeNav();
    ads.shellStartAdsOnce();
    await untilShown();
    ads.shellSetAdsHidden(true);
    await until(() => count("hideBanner") === 1, "hideBanner");
    ad.log.length = 0;
    rotate(1180);
    await until(() => count("hideBanner") === 1, "取り直したあとの hideBanner");
    expect(ad.log).toEqual(["removeBanner", "showBanner", "hideBanner"]);
  });
});

describe("殻: シートの間は帯を隠す(hideBanner / resumeBanner)。高さは変えない", () => {
  it("始めたあと: 隠す → hideBanner・戻す → resumeBanner。--ad-h はそのまま", async () => {
    asShell(); placeNav();
    ads.shellStartAdsOnce();
    await untilShown();
    fire("bannerAdSizeChanged", { width: 375, height: 56 });
    ad.log.length = 0;
    ads.shellSetAdsHidden(true);
    await flush();
    expect(ad.log).toEqual(["hideBanner"]);
    ads.shellSetAdsHidden(false);
    await flush();
    expect(ad.log).toEqual(["hideBanner", "resumeBanner"]);
    expect(adH()).toBe("64px");
  });

  it("始める前に開いたシート: 帯を出した直後に隠し、広告が届く(Loaded)たびにも隠し直す。閉じたら戻す", async () => {
    asShell(); placeNav();
    ads.shellSetAdsHidden(true);    // 始める前。プラグインには何も送らない(始めるときに渡す)
    await flush();
    expect(ad.log).toEqual([]);
    ads.shellStartAdsOnce();
    await untilShown();
    expect(ad.log.slice(-2)).toEqual(["showBanner", "hideBanner"]);
    ad.log.length = 0;
    fire("bannerAdLoaded", {});
    await flush();
    expect(ad.log).toEqual(["hideBanner"]);
    ads.shellSetAdsHidden(false);
    await flush();
    fire("bannerAdLoaded", {});
    await flush();
    expect(ad.log).toEqual(["hideBanner", "resumeBanner"]);   // 戻したあとの Loaded では隠さない
  });
});

describe("Web(window.Capacitor 無し): 何もしない", () => {
  it("shellStartAdsOnce / shellSetAdsHidden はプラグインに何も渡さず、--ad-h も触らない。回しても何もしない", async () => {
    placeNav();
    ads.shellStartAdsOnce();
    ads.shellSetAdsHidden(true);
    ads.shellSetAdsHidden(false);
    window.innerWidth = 1180; window.dispatchEvent(new Event("resize"));
    await wait(600);
    expect(ad.log).toEqual([]);
    expect(adH()).toBe("");
  });
});

describe("帯の位置の式・ID・プラグインとネイティブの名前の突き合わせ", () => {
  it("adBannerMargin: 画面の下端から 81・安全域の下端から 47(仕様 §8.1-S3)。すき間を足す。既定は安全域から", async () => {
    const { adBannerMargin, AD_MARGIN_MODE } = await import("./policy.js");
    expect(adBannerMargin({ innerHeight: 812, navTop: 731, mode: "screen" })).toBe(81);
    expect(adBannerMargin({ innerHeight: 812, navTop: 731, inset: 34, mode: "safe-area" })).toBe(47);
    expect(adBannerMargin({ innerHeight: 812, navTop: 731, inset: 34, mode: "screen" })).toBe(81);
    expect(adBannerMargin({ innerHeight: 812, navTop: 731, inset: 34, gap: 8 })).toBe(55);
    expect(adBannerMargin({ innerHeight: 812, navTop: 731 })).toBe(81);   // inset 0 なら2つは同じ
    expect(adBannerMargin({ innerHeight: 812, navTop: 900, inset: 34 })).toBe(0);   // 負にしない
    expect(AD_MARGIN_MODE).toBe("safe-area");
  });

  it("試験の段(S1〜S3): バナーは Google の iOS の demo(押しても課金されない)。S4 で本番の ID に替えたらこの検査を逆にする", async () => {
    const c = await import("./adsConfig.js");
    expect(c.ADMOB_USE_TEST_ADS).toBe(true);
    expect(c.ADMOB_BANNER_UNIT_ID_IOS).toBe("ca-app-pub-3940256099942544/2435281174");
  });

  it("プラグインの列挙の値は Swift の綴りと同じ(BannerAdPluginEvents.swift の rawValue・BannerExecutor.swift の switch)", async () => {
    const { BannerAdPluginEvents, BannerAdSize, BannerAdPosition } = await vi.importActual("@capacitor-community/admob");
    expect([BannerAdPluginEvents.SizeChanged, BannerAdPluginEvents.FailedToLoad, BannerAdPluginEvents.Loaded])
      .toEqual(["bannerAdSizeChanged", "bannerAdFailedToLoad", "bannerAdLoaded"]);
    expect(BannerAdSize.ADAPTIVE_BANNER).toBe("ADAPTIVE_BANNER");
    expect(BannerAdPosition.BOTTOM_CENTER).toBe("BOTTOM_CENTER");
  });
});
