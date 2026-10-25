// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ------------------------------------------------------------------
// 【便S4 2026-10-25 本人「これでリリースしよう」】本番は本物の広告・開発版(Ficus Dev)は試験の広告・診断の板は本番で開かない。
//   ・印: native.js の shellBuildKind() ── 殻でページが capacitor:(同梱の資産)なら "release"、それ以外の scheme(開発版は
//     server.url で https の Vercel を読む)なら "dev"、殻でなければ "web"
//   ・広告: adsConfig.js の admobIds(kind) → ads.native.js の initialize と showBanner
//   ・診断の板: audioDiag.jsx の audioDiagAvailable(kind) と長押しのフック(useAudioDiagLongPress)
// 期待値の ID は本人の AdMob の値(2026-10-06)と Google の文書(test-ads の Anchored Adaptive Banner)から手で写した。adsConfig の定数から逆算しない。
// jsdom のページの scheme は http: で替えられない(location は書き換え不可)ので、
//   (a) shellBuildKind はその引数(scheme)を渡して確かめ、
//   (b) 広告と板の配線は native.js の shellBuildKind だけを作り物にして("release" / "dev")確かめる。
// 【守っていないもの】実機の殻のページが本当に capacitor: / https: で来ること(Capacitor の既定と server.url の仕組み。実機待ち)・
//   本物の広告が帯に出ること(実機待ち。押さない)。
// ------------------------------------------------------------------
const st = vi.hoisted(() => ({ mockKind: null, log: [], calls: [] }));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({}) }));
vi.mock("./native.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, shellBuildKind: (...a) => (st.mockKind === null ? real.shellBuildKind(...a) : st.mockKind) };
});
vi.mock("@capacitor-community/admob", async (importOriginal) => {
  const real = await importOriginal();
  const rec = (name, ret) => async (arg) => { st.log.push(name); st.calls.push([name, arg]); return ret?.(arg); };
  return {
    ...real,
    AdMob: {
      initialize: rec("initialize"),
      trackingAuthorizationStatus: rec("trackingAuthorizationStatus", () => ({ status: "denied" })),
      requestTrackingAuthorization: rec("requestTrackingAuthorization", () => ({})),
      addListener: async () => ({ remove() {} }),
      showBanner: rec("showBanner"),
      hideBanner: rec("hideBanner"),
      resumeBanner: rec("resumeBanner"),
      removeBanner: rec("removeBanner"),
    },
  };
});

const REAL_UNIT = "ca-app-pub-8488624336436415/6801189906";   // 本人の AdMob のバナー bottom-banner
const DEMO_UNIT = "ca-app-pub-3940256099942544/2435281174";   // https://developers.google.com/admob/ios/test-ads の Anchored Adaptive Banner(iOS)
const asShell = () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" }; };

beforeEach(() => {
  vi.resetModules();
  st.mockKind = null; st.log.length = 0; st.calls.length = 0;
});
afterEach(() => {
  delete window.Capacitor;
  document.body.innerHTML = "";
});

describe("ビルドの種類(native.js の shellBuildKind)", () => {
  it("殻でなければ web(scheme に関係なく)", async () => {
    const { shellBuildKind } = await import("./native.js");
    expect(shellBuildKind()).toBe("web");
    expect(shellBuildKind("capacitor:")).toBe("web");
    expect(shellBuildKind("https:")).toBe("web");
  });
  it("殻で capacitor:(同梱の資産)なら release・https:(開発版の server.url)/ http: / 知らない scheme / 読めないなら dev", async () => {
    asShell();
    const { shellBuildKind } = await import("./native.js");
    expect(shellBuildKind("capacitor:")).toBe("release");
    expect(shellBuildKind("https:")).toBe("dev");
    expect(shellBuildKind("http:")).toBe("dev");
    expect(shellBuildKind("ionic:")).toBe("dev");
    expect(shellBuildKind({ toString() { throw new Error("boom"); } })).toBe("dev");
    expect(shellBuildKind()).toBe("dev");   // 引数なし = いまのページ(jsdom は http:)
  });
  it("本番の scheme が capacitor: のままである前提: capacitor.config.json に server(url・iosScheme・hostname)を書かない", () => {
    const conf = JSON.parse(readFileSync(join(process.cwd(), "capacitor.config.json"), "utf8"));
    expect("server" in conf).toBe(false);
  });
});

describe("広告の ID の選び方(adsConfig.js の admobIds)", () => {
  it("release だけが本物(本人のバナー・試験でない)。dev・web・知らない値は Google の demo(試験)", async () => {
    const { admobIds } = await import("./adsConfig.js");
    expect(admobIds("release")).toEqual({ useTestAds: false, bannerUnitId: REAL_UNIT });
    for (const k of ["dev", "web", undefined, null, "Release"]) {
      expect(admobIds(k)).toEqual({ useTestAds: true, bannerUnitId: DEMO_UNIT });
    }
  });
});

describe("殻の帯(ads.native.js の startAds)に渡る ID", () => {
  const start = async () => {
    const m = await import("./ads.native.js");
    await m.startAds({ onHeight() {}, navTop: 731, inset: 34, gap: 8, innerHeight: 812 });
    return { init: st.calls.find(([n]) => n === "initialize")[1], show: st.calls.find(([n]) => n === "showBanner")[1] };
  };
  it("本番(release): initializeForTesting false・本人のバナー", async () => {
    asShell(); st.mockKind = "release";
    const { init, show } = await start();
    expect(init).toEqual({ initializeForTesting: false });
    expect(show.adId).toBe(REAL_UNIT);
    expect(show.isTesting).toBe(false);   // true だとプラグインが Android の demo に差し替える(今までどおり常に false)
  });
  it("開発版(dev): initializeForTesting true・Google の iOS の demo", async () => {
    asShell(); st.mockKind = "dev";
    const { init, show } = await start();
    expect(init).toEqual({ initializeForTesting: true });
    expect(show.adId).toBe(DEMO_UNIT);
    expect(show.isTesting).toBe(false);
  });
  it("作り物なし(jsdom の http: = 開発版)でも試験の側", async () => {
    asShell();
    const { init, show } = await start();
    expect(init).toEqual({ initializeForTesting: true });
    expect(show.adId).toBe(DEMO_UNIT);
  });
});

describe("診断の板(audioDiag.jsx)は本番の殻で開かない", () => {
  it("audioDiagAvailable: release だけ false", async () => {
    const { audioDiagAvailable } = await import("../audioDiag.jsx");
    expect(audioDiagAvailable("release")).toBe(false);
    expect(audioDiagAvailable("dev")).toBe(true);
    expect(audioDiagAvailable("web")).toBe(true);
  });

  // 長押しのフックを小さな部品で描く(App.jsx は useAudioDiagLongPress(topTab === "measure", REED_DRAG_LONGPRESS_MS, openAudioDiag) で使う)
  async function pressNav(kind, holdMs = 400) {
    st.mockKind = kind;
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useAudioDiagLongPress } = await import("../audioDiag.jsx");
    const opened = [];
    function Harness() {
      useAudioDiagLongPress(true, holdMs, () => opened.push(1));
      return React.createElement("button", { "data-coach": "nav-measure", type: "button" }, "計測");
    }
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await React.act(async () => { root.render(React.createElement(Harness)); });
    const btn = host.querySelector("button");
    let clicks = 0;
    btn.addEventListener("click", () => { clicks += 1; });
    await React.act(async () => { btn.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await React.act(async () => { await new Promise((r) => setTimeout(r, holdMs + 100)); });
    await React.act(async () => { btn.dispatchEvent(new Event("pointerup", { bubbles: true })); btn.click(); });
    await React.act(async () => { root.unmount(); });
    return { opened: opened.length, clicks };
  }
  it("本番(release): 長押ししても開かない(その後の click も飲み込まない = ふつうのタップ)", async () => {
    asShell();
    expect(await pressNav("release")).toEqual({ opened: 0, clicks: 1 });
  });
  it("開発版(dev)・Web: 長押しで開き、その後の click は飲み込む(今までどおり)", async () => {
    asShell();
    expect(await pressNav("dev")).toEqual({ opened: 1, clicks: 0 });
    delete window.Capacitor;
    expect(await pressNav("web")).toEqual({ opened: 1, clicks: 0 });
  });
});
