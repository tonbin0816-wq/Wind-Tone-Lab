// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【殻 S3 審査 2026-10-06】Web の検査をこのファイルに分けた。vi.mock の factory は1つのファイルの中で1回しか走らず、
// vi.resetModules の後にも走り直さない。殻の検査と同じファイルに置くと、先に流れる殻の検査が factory を走らせたあとなので、
// 「factory が呼ばれない = プラグインのモジュールは読まれもしない」が張りぼてになっていた(同じファイルに殻の検査が無いので、ここでは本当に守れる)。
// 【殻 S2 2026-10-05】アプリ全体(WindToneLabPhaseMode)を描いて、殻の枝の**配線**を確かめる。凍結仕様 shell-spec.md §4.2〜§4.5・§8.1-S2。
//   ・スリープ防止: 殻は録音の開始で KeepAwake.keepAwake・停止で allowSleep(navigator.wakeLock は使わない)。
//     Web は navigator.wakeLock.request("screen") だけ(KeepAwake のモジュールは読まれもしない)
//   ・音の出口: 殻はマイクを取った直後に FicusAudioSession.routeToSpeaker。Web は呼ばない
//   ・計測タブを離れたとき: 殻はマイクを止める(トラックの stop)。Web は一時停止(enabled = false・stop しない)
//   ・Web 版の記録の移し方の1行: 殻かつ記録 0 件のときだけ、すべての計測の「まだ記録がありません」の下に出る
// マイクと Web Audio は作り物(onboardingApp.test.jsx の installFakeMic と同じ形)。IndexedDB も作り物。
// 【守っていないもの】実機で KeepAwake が画面を点け続けること・出口が実際にスピーカー / イヤホンへ替わること・
//   止めたマイクが戻ったときに固まらないこと(どれも実機待ち。仕様 §8.4)。メトロノームのゲインの値は policy.test.js と pitch-test が見る。
// ------------------------------------------------------------------
const cap = vi.hoisted(() => ({ log: [], factories: [] }));
vi.mock("@capacitor-community/keep-awake", () => {
  cap.factories.push("keep-awake");
  return { KeepAwake: { keepAwake: async () => { cap.log.push("keepAwake"); }, allowSleep: async () => { cap.log.push("allowSleep"); } } };
});
vi.mock("@capacitor/core", () => {
  cap.factories.push("core");
  return { registerPlugin: (name) => ({ routeToSpeaker: async () => { cap.log.push(`${name}.routeToSpeaker`); return {}; } }) };
});

const W = 375; const H = 812;
let fake; let host; let mod; let root; let track; let wakeReq; let masterGains = [];

async function loadApp() {
  vi.resetModules();
  globalThis.indexedDB = fake;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("../App.jsx");
  return { React, act: React.act, createRoot, App: App.default, openIdb: App.openIdb };
}
async function seedSessions(n) {
  const db = await mod.openIdb();
  db.close?.();
  for (let i = 0; i < n; i++) {
    fake._peek("windToneLabDB", "sessions").set(`s${i}`, { id: `s${i}`, recordedAt: "2026-10-01T10:00:00.000Z", saxType: "alto", reedId: null, memo: null, performer: "自分", source: "live", frames: [], barlines: [], noteEvents: [] });
  }
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
    if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label}`);
    await tick();
  }
}
const nav = (label) => document.querySelector(`button[aria-label="${label}"]`);
const click = (el) => mod.act(async () => { el.click(); });

function installFakeMic() {
  const node = () => ({ connect() {}, disconnect() {} });
  const analyser = () => ({
    ...node(), fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0,
    getFloatTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = (Math.random() - 0.5) * 2e-3; },
    getFloatFrequencyData(a) { a.fill(-120); },
    getByteFrequencyData(a) { a.fill(0); },
    getByteTimeDomainData(a) { a.fill(128); },
  });
  // メトロノームの鎖(音源 → フィルタ → 音量 → リミッター → マスター → 出口)も組めるようにする。
  // マスターの音量 = リミッター(createDynamicsCompressor)の直後に作られた gain。作った順に控える。
  class FakeAudioContext {
    constructor() { this.state = "running"; this.sampleRate = 48000; this._t0 = performance.now(); this.destination = node(); this._afterComp = false; masterGains.push(this); this.master = null; }
    get currentTime() { return (performance.now() - this._t0) / 1000; }
    createDynamicsCompressor() { this._afterComp = true; const p = () => ({ value: 0 }); return { ...node(), threshold: p(), knee: p(), ratio: p(), attack: p(), release: p() }; }
    createBuffer(ch, len) { const d = new Float32Array(len); return { length: len, numberOfChannels: ch, getChannelData: () => d }; }
    createBufferSource() { return { ...node(), buffer: null, start() {}, stop() {} }; }
    resume() { this.resumes = (this.resumes || 0) + 1; this.state = "running"; return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
    createMediaStreamSource() { this.isMic = true; return node(); }
    createAnalyser() { return analyser(); }
    createBiquadFilter() { return { ...node(), type: "", frequency: { value: 0 }, Q: { value: 0 } }; }
    createGain() {
      const g = { ...node(), gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } };
      if (this._afterComp) { this._afterComp = false; this.master = g; }
      return g;
    }
    createOscillator() { return { ...node(), frequency: { value: 0, setValueAtTime() {} }, start() {}, stop() {} }; }
  }
  window.AudioContext = FakeAudioContext;
  track = { enabled: true, readyState: "live", muted: false, kind: "audio", stopped: 0, stop() { this.stopped++; this.readyState = "ended"; }, getSettings() { return {}; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => stream }, configurable: true });
  wakeReq = vi.fn(async () => ({ release() {}, addEventListener() {} }));
  Object.defineProperty(window.navigator, "wakeLock", { value: { request: wakeReq }, configurable: true });
}

beforeEach(() => {
  fake = createFakeIndexedDb();
  cap.log.length = 0; cap.factories.length = 0; masterGains = [];
  window.localStorage.clear();
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = () => {};
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  installFakeMic();
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
});
const asShell = () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" }; };
const recButton = () => document.querySelector('button[aria-label="録音する"]') || document.querySelector('button[aria-label="録音を停止"]');
const settle = async () => { for (let i = 0; i < 10; i++) await tick(5); };

describe("Web: 今までどおり(navigator.wakeLock・一時停止)。殻の部品は読まれもしない", () => {
  it("録音の開始で navigator.wakeLock.request(\"screen\")。KeepAwake も routeToSpeaker も呼ばれない", async () => {
    mod = await loadApp();
    await render();
    await waitFor(() => document.querySelector('button[aria-label="録音する"]'), "録音のボタン");
    await settle();
    await click(recButton());
    await waitFor(() => wakeReq.mock.calls.length > 0, "wakeLock.request");
    expect(wakeReq).toHaveBeenCalledWith("screen");
    await click(recButton());
    await settle();
    expect(cap.log).toEqual([]);
    expect(cap.factories).toEqual([]);
  }, 30000);

  it("リードタブへ移ってもトラックは stop しない(enabled = false の一時停止)", async () => {
    mod = await loadApp();
    await render();
    await waitFor(() => document.querySelector('button[aria-label="録音する"]'), "計測タブ");
    await settle();
    await click(nav("リード"));
    await settle();
    expect(track.stopped).toBe(0);
    expect(track.enabled).toBe(false);
  }, 30000);
});
