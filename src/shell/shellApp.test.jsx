// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
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

describe("殻: スリープ防止は KeepAwake・音の出口はマイクの直後・タブを離れたらマイクを止める", () => {
  it("マイクを取った直後に routeToSpeaker。録音の開始で keepAwake・停止で allowSleep。navigator.wakeLock は使わない", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイクの直後の routeToSpeaker");
    expect(cap.log).toEqual(["FicusAudioSession.routeToSpeaker"]);
    await waitFor(() => document.querySelector('button[aria-label="録音する"]'), "録音のボタン");
    await click(recButton());
    await waitFor(() => cap.log.includes("keepAwake"), "録音の開始で keepAwake");
    expect(document.querySelector('button[aria-label="録音を停止"]')).not.toBe(null);
    await click(recButton());
    await waitFor(() => cap.log.includes("allowSleep"), "録音の停止で allowSleep");
    expect(cap.log).toEqual(["FicusAudioSession.routeToSpeaker", "keepAwake", "allowSleep"]);
    expect(wakeReq).not.toHaveBeenCalled();
  }, 30000);

  it("リードタブへ移るとマイクのトラックを stop する(橙の印が消える)。戻ると取り直してまた出口を寄せる", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイク");
    expect(track.stopped).toBe(0);
    await click(nav("リード"));
    await settle();
    expect(track.stopped).toBeGreaterThan(0);
    await click(nav("計測"));
    await waitFor(() => cap.log.filter((x) => x === "FicusAudioSession.routeToSpeaker").length === 2, "戻ると取り直す(完全再取得の道)");
  }, 30000);
});

// 【殻 S2 審査】KeepAwake は Web の wakeLock と違って自動では解けない。計測タブを離れる・画面が隠れるときに解くこと。
describe("殻: スリープ防止を解く(計測タブを離れたとき・画面が隠れたとき)", () => {
  const openMetro = async () => {
    await waitFor(() => document.querySelector('button[aria-label="メトロノーム"]'), "計測タブ");
    await click(document.querySelector('button[aria-label="メトロノーム"]'));
    await waitFor(() => document.querySelector('button[aria-label="メトロノームの開始/停止"]'), "メトロノームの面");
    await click(document.querySelector('button[aria-label="メトロノームの開始/停止"]'));
  };
  it("メトロノームを鳴らしたままリードタブへ移ると allowSleep", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイク");
    await openMetro();
    await waitFor(() => cap.log.includes("keepAwake"), "鳴らし始めで keepAwake");
    cap.log.length = 0;
    await click(nav("リード"));
    await waitFor(() => cap.log.includes("allowSleep"), "リードタブで allowSleep");
    expect(cap.log.includes("keepAwake")).toBe(false);
  }, 30000);
  // 録音中は下部タブの移動そのものが止められている(handleNavTap が isRecordingRef で戻る)ので、録音中にリードタブへは移れない。
  // 録音中に計測タブを離れる実際の道は「画面が隠れる」(stopListening が録音を終わらせる)なので、そちらで allowSleep を見る。
  it("録音中はリードタブへ移れない(移動は止められ、スリープ防止も解かない)。録音中に画面が隠れると allowSleep", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitFor(() => document.querySelector('button[aria-label="録音する"]') && cap.log.includes("FicusAudioSession.routeToSpeaker"), "録音のボタン");
    await click(recButton());
    await waitFor(() => cap.log.includes("keepAwake"), "録音の開始で keepAwake");
    cap.log.length = 0;
    await click(nav("リード"));
    await settle();
    expect(document.querySelector('button[aria-label="録音を停止"]')).not.toBe(null);   // 計測タブのまま・録音中のまま
    expect(cap.log).toEqual([]);
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    try {
      await mod.act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      await waitFor(() => cap.log.includes("allowSleep"), "隠れたら allowSleep");
      expect(cap.log.includes("keepAwake")).toBe(false);
    } finally { delete document.hidden; }
  }, 30000);
  it("画面が隠れると allowSleep", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイク");
    cap.log.length = 0;
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    try {
      await mod.act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      await waitFor(() => cap.log.includes("allowSleep"), "隠れたら allowSleep");
    } finally { delete document.hidden; }
  }, 30000);
});

// 【殻 S2 審査】イヤホンを外すと WebKit が AudioContext を止める(suspended)。殻ではメトロノームの ctx を onstatechange で再開する。
// 計測側の ctx は tick が毎フレーム resume を試みる既存の道で戻る(殻・Web 共通。ここで確かめる)。
describe("経路の変化で AudioContext が止められたとき", () => {
  const startMetroCtx = async () => {
    await waitFor(() => document.querySelector('button[aria-label="メトロノーム"]'), "計測タブ");
    await click(document.querySelector('button[aria-label="メトロノーム"]'));
    await waitFor(() => document.querySelector('button[aria-label="メトロノームの開始/停止"]'), "メトロノームの面");
    await click(document.querySelector('button[aria-label="メトロノームの開始/停止"]'));
    await waitFor(() => masterGains.some((c) => c.master), "メトロノームの ctx", 5000);
    return masterGains.find((c) => c.master);
  };
  it("殻: 鳴らしている間にメトロノームの ctx が suspended になると resume する。止めたあとは再開しない", async () => {
    asShell();
    mod = await loadApp();
    await render();
    const ctx = await startMetroCtx();
    expect(typeof ctx.onstatechange).toBe("function");
    const before = ctx.resumes || 0;
    ctx.state = "suspended";
    await mod.act(async () => { ctx.onstatechange(); });
    expect([ctx.resumes - before, ctx.state]).toEqual([1, "running"]);
    // 止める(表示 OFF)→ 止められても再開しない
    await click(document.querySelector('button[aria-label="メトロノームの開始/停止"]'));
    const after = ctx.resumes;
    ctx.state = "suspended";
    await mod.act(async () => { ctx.onstatechange(); });
    expect([ctx.resumes, ctx.state]).toEqual([after, "suspended"]);
  }, 30000);
  it("Web: メトロノームの ctx に onstatechange を付けない", async () => {
    mod = await loadApp();
    await render();
    const ctx = await startMetroCtx();
    expect(ctx.onstatechange).toBe(undefined);
  }, 30000);
  it("殻: 計測側の ctx が suspended にされても、tick が resume して戻る(既存の道)", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitFor(() => masterGains.some((c) => c.isMic) && cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイク");
    const mic = masterGains.find((c) => c.isMic && c.state !== "closed");
    const before = mic.resumes || 0;
    mic.state = "suspended";
    await waitFor(() => mic.state === "running" && mic.resumes > before, "tick が resume", 5000);
  }, 30000);
});

// メトロノームのマスターゲイン: 殻 1.0・Web 2.6(D-24 §1.5 の凍結値。Web の行は綴りのまま)
describe("メトロノームのマスターゲイン(鳴らして鎖を組ませ、マスターの音量を読む)", () => {
  const startMetro = async () => {
    await waitFor(() => document.querySelector('button[aria-label="メトロノーム"]'), "計測タブ");
    await click(document.querySelector('button[aria-label="メトロノーム"]'));
    await waitFor(() => document.querySelector('button[aria-label="メトロノームの開始/停止"]'), "メトロノームの面");
    await click(document.querySelector('button[aria-label="メトロノームの開始/停止"]'));
    await waitFor(() => masterGains.some((c) => c.master), "マスターの鎖", 5000);
    return masterGains.find((c) => c.master).master.gain.value;
  };
  it("殻: 1.0(出口はネイティブでスピーカーへ寄せる)", async () => {
    asShell();
    mod = await loadApp();
    await render();
    expect(await startMetro()).toBe(1.0);
  }, 30000);
  it("Web: 2.6 のまま", async () => {
    mod = await loadApp();
    await render();
    expect(await startMetro()).toBe(2.6);
  }, 30000);
});

describe("Web 版の記録の移し方(すべての計測の 0 件の下に1行)", () => {
  // 【便BX 2026-10-06 本人の決定 D1】参加の画面の導線は「端末を替えるとき」になった(マイページの「アカウント引継」は残る)
  // 【便CE 2026-10-08】参加前の入口は部品ごと消した(全員が参加し、書き出し・読み戻しはマイページ)。括弧を外した
  const LINE = "Web 版の記録は、このアプリへ自動では移りません。コミュニティタブ → マイページの「アカウント引継」で移せます。";
  const openAll = async () => {
    await click(nav("データ"));
    await waitFor(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("すべての計測")), "My Data");
    await click([...document.querySelectorAll("button")].find((b) => b.textContent.includes("すべての計測")));
    await settle();
  };
  it("殻・記録 0 件: 「まだ記録がありません」の下に出る(同じ体裁 + 行間)", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await openAll();
    const empty = [...document.querySelectorAll("div")].find((d) => d.textContent === "まだ記録がありません");
    expect(empty).toBeTruthy();
    const line = empty.nextElementSibling;
    expect(line?.textContent).toBe(LINE);
    expect([line.style.fontSize, line.style.color, line.style.marginTop, line.style.lineHeight]).toEqual(["12px", "var(--c-ink-3)", "6px", "1.6"]);
  }, 30000);
  it("殻・記録 1 件: 出ない", async () => {
    asShell();
    mod = await loadApp();
    await seedSessions(1);
    await render();
    await openAll();
    expect(document.body.textContent).not.toContain("Web 版の記録は");
  }, 30000);
  it("Web・記録 0 件: 出ない(「まだ記録がありません」は出る)", async () => {
    mod = await loadApp();
    await render();
    await openAll();
    expect(document.body.textContent).toContain("まだ記録がありません");
    expect(document.body.textContent).not.toContain("Web 版の記録は");
  }, 30000);
});
