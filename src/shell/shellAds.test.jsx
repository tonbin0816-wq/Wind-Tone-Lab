// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【殻 S3 2026-10-06】アプリ全体(WindToneLabPhaseMode)を描いて、広告の帯の**配線**を確かめる。凍結仕様 shell-spec.md §5.3・§8.1-S3。
//   ・始める時機: 最初のマイクの試み(getUserMedia)が終わった直後に1回(成功でも失敗でも)。ATT の画面をマイクの許可の画面と重ねない
//   ・ShellAdBannerSync: BottomSheet を開くと hideBanner・閉じると resumeBanner(殻)。--ad-h は戻さない
//   ・殻では見本の帯(AdPreviewStrip)を <html data-ad-preview="1"> でも描かない(Web では描く = 対照)
//   ・Web: プラグインに何も渡らない・--ad-h に触らない
// マイクと Web Audio は作り物(shellApp.test.jsx と同じ形)。IndexedDB も作り物。
// 【守っていないもの】帯の位置(margin)の実寸 ── jsdom は矩形を持たないので下部タブの上端は測れない(式は ads.test.jsx)。
//   ATT の画面と帯が実機で出ること(実機待ち。仕様 §8.4)。
// 【便CG 2026-10-09 本人の要望「チュートリアル中は広告なしにできませんか」・統括の裁定】はじめの案内が終わるまで帯(と ATT)を始めない。
//   始めるのは (a) ⑱ が済んだとき (b) 2回目以降の起動(初めて案内のカードが出た起動の次)。既存の利用者(移行で finish)は今までどおり最初から。
//   上の「始める時機」の検査は既存の利用者(EXISTING)の起動で書き直し、案内の間・⑱・2回目の起動・見本の検査を足した(下の【便CG】)。
//   期待値は統括の裁定の文から手で書いた。プラグインは作り物(下の vi.mock)。
//   【守っていないもの】ATT の画面が ⑱ のカードの直後に実機で出ること(実機待ち)。
// ------------------------------------------------------------------
import { migrateOnboardingDone } from "../onboarding.jsx";
const cap = vi.hoisted(() => ({ log: [], handlers: {}, att: [] }));
vi.mock("@capacitor-community/keep-awake", () => ({ KeepAwake: { keepAwake: async () => {}, allowSleep: async () => {} } }));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({ routeToSpeaker: async () => ({}) }) }));
vi.mock("@capacitor-community/admob", async (importOriginal) => {
  const real = await importOriginal();
  const rec = (name, ret) => async () => { cap.log.push(name); return ret?.(); };
  return {
    ...real,
    AdMob: {
      initialize: rec("initialize"),
      // 【便CG】ATT の答えは cap.att の順に返す(空なら denied = 今までの作り物と同じ)
      trackingAuthorizationStatus: rec("trackingAuthorizationStatus", () => ({ status: cap.att.length ? cap.att.shift() : "denied" })),
      requestTrackingAuthorization: rec("requestTrackingAuthorization"),
      addListener: async (ev, fn) => { (cap.handlers[ev] ||= []).push(fn); return { remove() {} }; },
      showBanner: rec("showBanner"),
      hideBanner: rec("hideBanner"),
      resumeBanner: rec("resumeBanner"),
    },
  };
});

const W = 375; const H = 812;
let fake; let host; let mod; let root; let micFails = false; let micGate = null; let realRect;

async function loadApp() {
  vi.resetModules();
  globalThis.indexedDB = fake;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("../App.jsx");
  return { React, act: React.act, createRoot, App: App.default, App_openIdb: App.openIdb };
}
// 【便CG】kv に印を入れてから描く(起動の前の保存値)。ストアは App と同じ openIdb で作る
async function seedKv(entries = {}) {
  const db = await mod.App_openIdb();
  db.close?.();
  for (const [k, v] of Object.entries(entries)) fake._peek("windToneLabDB", "kv").set(k, structuredClone(v));
}
const kv = (key) => fake._peek("windToneLabDB", "kv")?.get(key);
// 既存の利用者(計測が1件ある人の移行の結果。finish を含む全部の印と5つの門)
const EXISTING = migrateOnboardingDone({}, { sessions: [{ id: "s1" }] });
const GATES = { migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true };
async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = mod.createRoot(host);
  await mod.act(async () => { root.render(mod.React.createElement(mod.App)); });
}
const tick = (ms = 10) => mod.act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function waitFor(pred, label, deadline = 10000) {
  const end = Date.now() + deadline;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label} log=${JSON.stringify(cap.log)} root=${!!document.querySelector(".app-root")}`);
    await tick();
  }
}
const settle = async () => { for (let i = 0; i < 10; i++) await tick(5); };
const go = async (label) => {
  const b = document.querySelector(`button[aria-label="${label}"]`);
  expect(b, label).toBeTruthy();
  await mod.act(async () => { b.click(); });
};
const adH = () => document.documentElement.style.getPropertyValue("--ad-h");
const strip = () => document.querySelector("[data-ad-preview-strip]");

function installFakeMic() {
  const node = () => ({ connect() {}, disconnect() {} });
  const analyser = () => ({
    ...node(), fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0,
    getFloatTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = (Math.random() - 0.5) * 2e-3; },
    getFloatFrequencyData(a) { a.fill(-120); }, getByteFrequencyData(a) { a.fill(0); }, getByteTimeDomainData(a) { a.fill(128); },
  });
  class FakeAudioContext {
    constructor() { this.state = "running"; this.sampleRate = 48000; this._t0 = performance.now(); this.destination = node(); }
    get currentTime() { return (performance.now() - this._t0) / 1000; }
    createDynamicsCompressor() { const p = () => ({ value: 0 }); return { ...node(), threshold: p(), knee: p(), ratio: p(), attack: p(), release: p() }; }
    createBuffer(ch, len) { const d = new Float32Array(len); return { length: len, numberOfChannels: ch, getChannelData: () => d }; }
    createBufferSource() { return { ...node(), buffer: null, start() {}, stop() {} }; }
    resume() { this.state = "running"; return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
    createMediaStreamSource() { return node(); }
    createAnalyser() { return analyser(); }
    createBiquadFilter() { return { ...node(), type: "", frequency: { value: 0 }, Q: { value: 0 } }; }
    createGain() { return { ...node(), gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
    createOscillator() { return { ...node(), frequency: { value: 0, setValueAtTime() {} }, start() {}, stop() {} }; }
  }
  window.AudioContext = FakeAudioContext;
  const track = { enabled: true, readyState: "live", muted: false, kind: "audio", stopped: 0, stop() { this.stopped++; this.readyState = "ended"; }, getSettings() { return {}; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: { getUserMedia: async () => { cap.log.push("getUserMedia"); if (micGate) await micGate.promise; if (micFails) throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); return stream; } },
    configurable: true,
  });
  Object.defineProperty(window.navigator, "wakeLock", { value: { request: async () => ({ release() {}, addEventListener() {} }) }, configurable: true });
}

beforeEach(() => {
  fake = createFakeIndexedDb();
  cap.log.length = 0; cap.handlers = {}; cap.att = []; micFails = false; micGate = null;
  window.localStorage.clear();
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = () => {};
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  installFakeMic();
  // 【便CG】jsdom は矩形を持たないので、案内のカードの高さだけ作る(カードは測り終えて初めて「出た」= onShown。onboarding.test.jsx と同じ 146)
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    const r = realRect.call(this);
    if (!this.classList?.contains("coach-card")) return r;
    return { left: 22, top: 0, width: W - 44, height: 146, right: W - 22, bottom: 146, x: 22, y: 0 };
  };
  vi.spyOn(console, "error").mockImplementation(() => {});   // 失敗の枝の console.error("getUserMedia failed") を黙らせる
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  window.Element.prototype.getBoundingClientRect = realRect;
  delete window.Capacitor;
  delete window.AudioContext;
  try { delete window.navigator.mediaDevices; } catch { /* */ }
  try { delete window.navigator.wakeLock; } catch { /* */ }
  // 注入したものを個別に片付ける(--ad-h の inline・見本の帯の印)
  document.documentElement.style.removeProperty("--ad-h");
  document.documentElement.removeAttribute("data-ad-preview");
  document.documentElement.removeAttribute("data-ad-hold");   // 【便CG】(App が外すが、念のため個別に)
  document.documentElement.removeAttribute("data-tutorial-preview");
  vi.restoreAllMocks();
});
const asShell = () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" }; };

describe("殻: 帯を始める時機(最初のマイクの試みの直後に1回)。【便CG】既存の利用者(移行で案内が全部済んだ人)の起動", () => {
  it("マイクが取れた直後に initialize → ATT → showBanner。計測タブへ戻って取り直しても2回目は無い", async () => {
    asShell();
    mod = await loadApp();
    await seedKv({ onboardingDone: EXISTING });
    await render();
    await waitFor(() => cap.log.includes("showBanner"), "showBanner");
    expect(cap.log).toEqual(["getUserMedia", "initialize", "trackingAuthorizationStatus", "showBanner"]);
    expect(adH()).toBe("50px");   // 来るまでの仮の高さ
    await settle();
    await go("リード"); await settle();
    await go("計測");
    await waitFor(() => cap.log.filter((x) => x === "getUserMedia").length === 2, "戻って取り直す");
    await settle();
    expect(cap.log.filter((x) => x === "initialize").length).toBe(1);
    expect(cap.log.filter((x) => x === "showBanner").length).toBe(1);
  }, 30000);

  // 【殻 S3 審査 軽4】OS のマイクの許可の画面が出ている間(getUserMedia が終わっていない間)は、ATT も帯も始めない
  it("getUserMedia を門で止めている間は initialize が来ない。門を開けた直後に来る", async () => {
    asShell();
    let open;
    micGate = { promise: new Promise((r) => { open = r; }) };
    mod = await loadApp();
    await seedKv({ onboardingDone: EXISTING });
    await render();
    await waitFor(() => cap.log.includes("getUserMedia"), "getUserMedia の呼び出し");
    for (let i = 0; i < 30; i++) await tick(10);   // 門を閉じたまま 300ms 以上
    expect(cap.log).toEqual(["getUserMedia"]);
    await mod.act(async () => { open(); });
    await waitFor(() => cap.log.includes("showBanner"), "門を開けた後の showBanner");
    expect(cap.log.slice(0, 2)).toEqual(["getUserMedia", "initialize"]);
  }, 30000);

  it("マイクが許可されなかった(getUserMedia が失敗)ときも、その直後に帯を始める", async () => {
    asShell(); micFails = true;
    mod = await loadApp();
    await seedKv({ onboardingDone: EXISTING });
    await render();
    await waitFor(() => cap.log.includes("showBanner"), "失敗の後の showBanner");
    expect(cap.log.slice(0, 2)).toEqual(["getUserMedia", "initialize"]);
  }, 30000);
});

describe("殻: シート(BottomSheet)の間は帯を隠す。--ad-h は戻さない", () => {
  it("リードを追加のシートを開くと hideBanner・閉じると resumeBanner。帯の実寸 56px はその間も変わらない", async () => {
    asShell();
    mod = await loadApp();
    await seedKv({ onboardingDone: EXISTING });
    await render();
    await waitFor(() => cap.log.includes("showBanner"), "showBanner");
    await mod.act(async () => { (cap.handlers.bannerAdSizeChanged || []).forEach((fn) => fn({ width: 375, height: 56 })); });
    expect(adH()).toBe("56px");
    await go("リード"); await settle();
    cap.log.length = 0;
    await go("リードを追加");
    expect(document.querySelector(".sheet-scrim")).toBeTruthy();
    await waitFor(() => cap.log.includes("hideBanner"), "hideBanner");
    // 隠すとプラグインは高さ 0 の SizeChanged を送る(BannerExecutor.swift)。それでも --ad-h は戻さない
    await mod.act(async () => { (cap.handlers.bannerAdSizeChanged || []).forEach((fn) => fn({ width: 0, height: 0 })); });
    expect(adH()).toBe("56px");
    await mod.act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(document.querySelector(".sheet-scrim")).toBe(null);
    await waitFor(() => cap.log.includes("resumeBanner"), "resumeBanner");
    expect(cap.log.filter((x) => /Banner$/.test(x))).toEqual(["hideBanner", "resumeBanner"]);
    expect(adH()).toBe("56px");
  }, 30000);

  it("殻では <html data-ad-preview=\"1\"> でも見本の帯を描かない", async () => {
    asShell();
    document.documentElement.setAttribute("data-ad-preview", "1");
    mod = await loadApp();
    await render();
    await settle();
    expect(document.querySelector(".app-root")).toBeTruthy();
    expect(strip()).toBe(null);
  }, 30000);
});

describe("Web: 今までどおり(プラグインに何も渡らない・--ad-h に触らない)", () => {
  it("マイクを取っても、シートを開閉しても、プラグインに何も渡らず --ad-h は空のまま", async () => {
    mod = await loadApp();
    await render();
    await waitFor(() => cap.log.includes("getUserMedia"), "マイク");
    await settle();
    await go("リード"); await settle();
    await go("リードを追加");
    expect(document.querySelector(".sheet-scrim")).toBeTruthy();
    await mod.act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    await settle();
    expect(cap.log).toEqual(["getUserMedia"]);
    expect(adH()).toBe("");
  }, 30000);

  it("Web で <html data-ad-preview=\"1\"> なら見本の帯は描かれる(上の殻の検査の対照。【便CG】既存の利用者)", async () => {
    document.documentElement.setAttribute("data-ad-preview", "1");
    mod = await loadApp();
    await seedKv({ onboardingDone: EXISTING });
    await render();
    await settle();
    expect(strip()).toBeTruthy();
    expect(document.documentElement.hasAttribute("data-ad-hold")).toBe(false);
  }, 30000);
});

// ------------------------------------------------------------------
// 【便CG】案内の間は広告を出さない
// ------------------------------------------------------------------
const hold = () => document.documentElement.getAttribute("data-ad-hold");
const layerId = () => document.querySelector("[data-coach-layer]")?.getAttribute("data-coach-layer") ?? null;
const ADS = ["initialize", "trackingAuthorizationStatus", "requestTrackingAuthorization", "showBanner"];
const adsCalls = () => cap.log.filter((x) => ADS.includes(x));
// ⑰ まで済んで計測タブにいる人(⑱ の手前。⑱ は穴なしなのでマイクを待たずに出る)
const BEFORE_FINISH = { ...EXISTING, finish: false };
// jsdom は矩形を持たないので、的のある段(① など)は出ない。穴なしの到着カード(リードタブの「ここはリードタブ」)で「案内が出た」を作る
const toReedsArrival = async () => {
  await go("リード");
  await waitFor(() => layerId() === "arriveReeds", "到着「ここはリードタブ」");
};

describe("【便CG】殻: 案内の間は initialize / showBanner を呼ばない。--ad-h は 0", () => {
  it("初めての起動(kv が空): マイクの試みのあとも、案内のカードが出ている間は何も始めない。--ad-h は inline に無く data-ad-hold=\"1\"。カードが出たので onboardingShown が立つ", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitFor(() => cap.log.includes("getUserMedia"), "マイク");
    for (let i = 0; i < 30; i++) await tick(10);
    expect(adsCalls()).toEqual([]);
    expect(adH()).toBe("");
    expect(hold()).toBe("1");
    expect(kv("onboardingShown")).toBeUndefined();   // カードはまだ出ていない(jsdom では ① の的が測れない)
    await toReedsArrival();
    expect(adsCalls()).toEqual([]);
    await waitFor(() => kv("onboardingShown") === true, "初めて案内が出た起動の印");
    // 同じ起動の中では、印が立っても始めない(起動の最初に読んだ値だけを使う)
    for (let i = 0; i < 20; i++) await tick(10);
    expect(adsCalls()).toEqual([]);
    expect(hold()).toBe("1");
  }, 30000);

  it("⑱ が済むと、その場で initialize → ATT(未決定なら尋ねる)→ showBanner。押す前は何も始めない。data-ad-hold が外れ --ad-h は仮の 50px", async () => {
    asShell();
    cap.att = ["notDetermined", "authorized"];
    mod = await loadApp();
    await seedKv({ onboardingDone: BEFORE_FINISH });
    await render();
    await waitFor(() => cap.log.includes("getUserMedia"), "マイク");
    await waitFor(() => layerId() === "finish", "⑱ 終わり");
    for (let i = 0; i < 30; i++) await tick(10);
    expect(adsCalls()).toEqual([]);
    expect(adH()).toBe("");
    expect(hold()).toBe("1");
    await mod.act(async () => { document.querySelector('[data-coach-hit="all"]').click(); });
    await waitFor(() => kv("onboardingDone")?.finish === true, "finish の印");
    await waitFor(() => cap.log.includes("showBanner"), "⑱ のあとの showBanner");
    expect(adsCalls()).toEqual(["initialize", "trackingAuthorizationStatus", "requestTrackingAuthorization", "trackingAuthorizationStatus", "showBanner"]);
    expect(cap.log.indexOf("getUserMedia")).toBeLessThan(cap.log.indexOf("initialize"));
    expect(hold()).toBe(null);
    expect(adH()).toBe("50px");
  }, 30000);

  it("2回目の起動(前の起動で案内が出た): 案内が残っていても、マイクの試みの直後に始める。案内はまだ出る", async () => {
    asShell();
    mod = await loadApp();
    await seedKv({ onboardingDone: GATES, onboardingShown: true });
    await render();
    await waitFor(() => cap.log.includes("showBanner"), "showBanner");
    expect(cap.log.slice(0, 4)).toEqual(["getUserMedia", "initialize", "trackingAuthorizationStatus", "showBanner"]);
    expect(hold()).toBe(null);
    await toReedsArrival();   // 案内は残っている
    expect(kv("onboardingDone").finish).toBeUndefined();
    expect(cap.log.filter((x) => x === "initialize").length).toBe(1);
  }, 30000);

  it("起動を2回続ける: 1回目は案内の間ずっと始めない → 開き直した2回目は、案内が残っていてもマイクの直後に始める", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitFor(() => cap.log.includes("getUserMedia"), "1回目のマイク");
    await toReedsArrival();
    await waitFor(() => kv("onboardingShown") === true, "印");
    await settle();
    expect(adsCalls()).toEqual([]);
    await mod.act(async () => root.unmount());
    root = null; host?.remove();
    cap.log.length = 0;
    mod = await loadApp();   // 開き直す(モジュールごと作り直す。kv は同じ作り物)
    await render();
    await waitFor(() => cap.log.includes("showBanner"), "2回目の showBanner");
    expect(cap.log.slice(0, 2)).toEqual(["getUserMedia", "initialize"]);
    expect(kv("onboardingDone").finish).toBeUndefined();
  }, 40000);

  it("移行がまだの既存の利用者(計測が1件・印なし): 移行で finish が立てば、その起動で始める", async () => {
    asShell();
    mod = await loadApp();
    await seedKv({});
    fake._peek("windToneLabDB", "sessions").set("s1", { id: "s1", recordedAt: new Date("2026-09-01T10:00:00").toISOString(), frames: [], saxType: "alto" });
    await render();
    await waitFor(() => kv("onboardingDone")?.finish === true, "移行");
    await waitFor(() => cap.log.includes("showBanner"), "showBanner");
    expect(hold()).toBe(null);
  }, 30000);
});

describe("【便CG】Web の見本の帯(?adpreview=1)も同じ条件", () => {
  it("初めての起動: 見本の帯を描かず data-ad-hold=\"1\"(--ad-h は 0 に戻る)。2回目の起動は描く", async () => {
    document.documentElement.setAttribute("data-ad-preview", "1");
    mod = await loadApp();
    await render();
    await settle();
    expect(document.querySelector(".app-root")).toBeTruthy();
    expect(strip()).toBe(null);
    expect(hold()).toBe("1");
    expect(document.documentElement.getAttribute("data-ad-preview")).toBe("1");   // 合図(端末の望み)は外さない
    await mod.act(async () => root.unmount());
    root = null; host?.remove();
    expect(hold()).toBe(null);   // 部品が外れたら印も外す
    await seedKv({ onboardingShown: true });
    mod = await loadApp();
    await render();
    await settle();
    expect(strip()).toBeTruthy();
    expect(hold()).toBe(null);
  }, 40000);

  it("⑱ が済むと、その場で見本の帯が出て data-ad-hold が外れる。測り直しの知らせ(ficus-ad-height)が1回出る", async () => {
    document.documentElement.setAttribute("data-ad-preview", "1");
    mod = await loadApp();
    await seedKv({ onboardingDone: BEFORE_FINISH });
    await render();
    await waitFor(() => layerId() === "finish", "⑱");
    expect(strip()).toBe(null);
    expect(hold()).toBe("1");
    let events = 0;
    const on = () => { events += 1; };
    window.addEventListener("ficus-ad-height", on);
    try {
      await mod.act(async () => { document.querySelector('[data-coach-hit="all"]').click(); });
      await waitFor(() => strip() !== null, "見本の帯");
      expect(hold()).toBe(null);
      expect(events).toBe(1);
    } finally { window.removeEventListener("ficus-ad-height", on); }
  }, 30000);

  it("見本(?tutorialpreview=1)の中: 本物の印が全部済んだ既存の利用者でも、見本の案内が終わるまで帯なし。見本の ⑱ が済んだら出る。本物の onboardingShown は書かない", async () => {
    document.documentElement.setAttribute("data-ad-preview", "1");
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    window.localStorage.setItem("ficus.tutorialPreviewDone", JSON.stringify({ ...BEFORE_FINISH }));
    mod = await loadApp();
    await seedKv({ onboardingDone: EXISTING, onboardingShown: true });
    await render();
    await waitFor(() => layerId() === "finish", "見本の ⑱");
    expect(strip()).toBe(null);
    expect(hold()).toBe("1");
    await mod.act(async () => { document.querySelector('[data-coach-hit="all"]').click(); });
    await waitFor(() => strip() !== null, "見本の帯");
    expect(hold()).toBe(null);
    expect(JSON.parse(window.localStorage.getItem("ficus.tutorialPreviewDone")).finish).toBe(true);
    expect(kv("onboardingShown")).toBe(true);   // 入れたまま(見本は本物の印に触らない)
    expect(kv("onboardingDone")).toEqual(EXISTING);
  }, 30000);

  it("見本で初めて開いた端末(本物の kv が空): 見本の案内の間は帯なし・本物の onboardingShown を立てない", async () => {
    document.documentElement.setAttribute("data-ad-preview", "1");
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp();
    await render();
    await settle();
    await toReedsArrival();   // 見本の案内
    await settle();
    expect(strip()).toBe(null);
    expect(hold()).toBe("1");
    expect(kv("onboardingShown")).toBeUndefined();
  }, 30000);
});
