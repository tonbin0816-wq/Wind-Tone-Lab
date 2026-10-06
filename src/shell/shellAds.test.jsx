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
// ------------------------------------------------------------------
const cap = vi.hoisted(() => ({ log: [], handlers: {} }));
vi.mock("@capacitor-community/keep-awake", () => ({ KeepAwake: { keepAwake: async () => {}, allowSleep: async () => {} } }));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({ routeToSpeaker: async () => ({}) }) }));
vi.mock("@capacitor-community/admob", async (importOriginal) => {
  const real = await importOriginal();
  const rec = (name, ret) => async () => { cap.log.push(name); return ret?.(); };
  return {
    ...real,
    AdMob: {
      initialize: rec("initialize"),
      trackingAuthorizationStatus: rec("trackingAuthorizationStatus", () => ({ status: "denied" })),
      requestTrackingAuthorization: rec("requestTrackingAuthorization"),
      addListener: async (ev, fn) => { (cap.handlers[ev] ||= []).push(fn); return { remove() {} }; },
      showBanner: rec("showBanner"),
      hideBanner: rec("hideBanner"),
      resumeBanner: rec("resumeBanner"),
    },
  };
});

const W = 375; const H = 812;
let fake; let host; let mod; let root; let micFails = false; let micGate = null;

async function loadApp() {
  vi.resetModules();
  globalThis.indexedDB = fake;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("../App.jsx");
  return { React, act: React.act, createRoot, App: App.default };
}
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
  cap.log.length = 0; cap.handlers = {}; micFails = false; micGate = null;
  window.localStorage.clear();
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = () => {};
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  installFakeMic();
  vi.spyOn(console, "error").mockImplementation(() => {});   // 失敗の枝の console.error("getUserMedia failed") を黙らせる
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  delete window.Capacitor;
  delete window.AudioContext;
  try { delete window.navigator.mediaDevices; } catch { /* */ }
  try { delete window.navigator.wakeLock; } catch { /* */ }
  // 注入したものを個別に片付ける(--ad-h の inline・見本の帯の印)
  document.documentElement.style.removeProperty("--ad-h");
  document.documentElement.removeAttribute("data-ad-preview");
  vi.restoreAllMocks();
});
const asShell = () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" }; };

describe("殻: 帯を始める時機(最初のマイクの試みの直後に1回)", () => {
  it("マイクが取れた直後に initialize → ATT → showBanner。計測タブへ戻って取り直しても2回目は無い", async () => {
    asShell();
    mod = await loadApp();
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
    await render();
    await waitFor(() => cap.log.includes("showBanner"), "失敗の後の showBanner");
    expect(cap.log.slice(0, 2)).toEqual(["getUserMedia", "initialize"]);
  }, 30000);
});

describe("殻: シート(BottomSheet)の間は帯を隠す。--ad-h は戻さない", () => {
  it("リードを追加のシートを開くと hideBanner・閉じると resumeBanner。帯の実寸 56px はその間も変わらない", async () => {
    asShell();
    mod = await loadApp();
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

  it("Web で <html data-ad-preview=\"1\"> なら見本の帯は描かれる(上の殻の検査の対照)", async () => {
    document.documentElement.setAttribute("data-ad-preview", "1");
    mod = await loadApp();
    await render();
    await settle();
    expect(strip()).toBeTruthy();
  }, 30000);
});
