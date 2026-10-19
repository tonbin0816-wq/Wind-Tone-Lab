// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【殻 S2 2026-10-05】アプリ全体(WindToneLabPhaseMode)を描いて、殻の枝の**配線**を確かめる。凍結仕様 shell-spec.md §4.2〜§4.5・§8.1-S2。
//   ・スリープ防止: 殻は録音の開始で KeepAwake.keepAwake・停止で allowSleep(navigator.wakeLock は使わない)。
//     Web は navigator.wakeLock.request("screen") だけ(KeepAwake のモジュールは読まれもしない)
//   ・計測タブを離れたとき: 殻はマイクを止める。Web は一時停止(enabled = false・stop しない)
//   ・Web 版の記録の移し方の1行: 殻かつ記録 0 件のときだけ、すべての計測の「まだ記録がありません」の下に出る
// 【便CX 2026-10-19】殻の計測の音(メトロノームとマイク)は殻(AVAudioEngine)が扱う: 殻では getUserMedia を呼ばず、Web の AudioContext を作らず、
//   navigator.audioSession.type を play-and-record にしない。マイクは殻の micStart / micStop と "micData" の知らせ、メトロノームは metroLoad / metroStart /
//   metroUpdate / metroStop と "metroClicks" の知らせ(作り物の殻 = 下の vi.mock)。作り物の殻は、マイクを始めたら 40ms ごとに小さな雑音の塊を送る
//   (本物の殻と同じく、止めるまで送り続ける。送らないと解析が無音と読み、既存の無音の見張りが取り直しを始める)。
// マイクと Web Audio は作り物(onboardingApp.test.jsx の installFakeMic と同じ形)。IndexedDB も作り物。
// 【守っていないもの】実機で KeepAwake が画面を点け続けること・殻のエンジンが鳴る・取れる・大きく聞こえること・出口がスピーカー / イヤホンへ替わること
//   (どれも実機待ち。Swift はここでは走らない。綴りは pitch-test K.6 / K.14)。
// ------------------------------------------------------------------
const cap = vi.hoisted(() => ({
  log: [], factories: [], session: null, native: [], nativeInfo: null, listeners: {},
  mic: { queue: [], fail: null, rate: 48000 }, clock: { offsetSec: 1000, sampleRate: 48000, delayMs: 0 }, metroFail: null,
  feed: { id: null, timer: null, off: false, b64: null },
}));
vi.mock("@capacitor-community/keep-awake", () => {
  cap.factories.push("keep-awake");
  return { KeepAwake: { keepAwake: async () => { cap.log.push("keepAwake"); }, allowSleep: async () => { cap.log.push("allowSleep"); } } };
});
vi.mock("@capacitor/core", () => {
  cap.factories.push("core");
  const emit = (ev, d) => { for (const fn of [...(cap.listeners[ev] || [])]) fn(d); };
  const startFeed = () => {
    if (cap.feed.timer) return;
    cap.feed.timer = setInterval(() => {
      if (!cap.feed.id || cap.feed.off) return;
      emit("micData", { id: cap.feed.id, pcm: cap.feed.b64, sample: 0, host: performance.now() / 1000 + cap.clock.offsetSec, rate: cap.mic.rate, frames: 1024 });
    }, 40);
  };
  // 【便CQ】sessionInfo は診断の板が読む。cap.session が無いときは古い殻のビルド(読み出し口が無い)として拒否する
  return { registerPlugin: (name) => ({
    sessionInfo: async () => {
      if (!cap.session) throw Object.assign(new Error("not implemented"), { code: "UNIMPLEMENTED" });
      return cap.session;
    },
    // 【便CX】殻のマイク。cap.mic.queue があれば呼ばれた順に1つずつ使う({ gate, fail })。fail は拒否の文
    micStart: async (o) => {
      cap.log.push(`${name}.micStart`); cap.native.push(["micStart", o]);
      const q = cap.mic.queue.length ? cap.mic.queue.shift() : null;
      if (q && q.gate) await q.gate;
      const fail = q ? q.fail : cap.mic.fail;
      if (fail) throw Object.assign(new Error(fail), { code: "DENIED" });
      cap.feed.id = o.id;
      startFeed();
      return { sampleRate: cap.mic.rate };
    },
    micStop: async (o) => { cap.log.push(`${name}.micStop`); cap.native.push(["micStop", o]); if (cap.feed.id === o.id) cap.feed.id = null; return { stopped: true }; },
    metroLoad: async (o) => { cap.native.push(["metroLoad", { sampleRate: o.sampleRate }]); return {}; },
    metroStart: async (o) => { cap.native.push(["metroStart", o]); if (cap.metroFail) throw new Error(cap.metroFail); return { running: true }; },
    metroUpdate: async (o) => { cap.native.push(["metroUpdate", o]); return { running: true }; },
    metroStop: async (o) => { cap.native.push(["metroStop", o]); return { stopped: true }; },
    // host は呼ばれた時の時刻(performance.now() + offsetSec)。答えは delayMs 遅れて返す(往復の片道を不揃いにする)
    audioClock: async () => {
      const host = performance.now() / 1000 + cap.clock.offsetSec;
      if (cap.clock.delayMs) await new Promise((r) => setTimeout(r, cap.clock.delayMs));
      return { host, sampleRate: cap.clock.sampleRate };
    },
    audioInfo: async () => {
      if (!cap.nativeInfo) throw Object.assign(new Error("not implemented"), { code: "UNIMPLEMENTED" });
      return cap.nativeInfo;
    },
    addListener: async (ev, fn) => {
      (cap.listeners[ev] ||= []).push(fn);
      return { remove: async () => { cap.listeners[ev] = (cap.listeners[ev] || []).filter((f) => f !== fn); } };
    },
  }) };
});

const W = 375; const H = 812;
let fake; let host; let mod; let root; let track; let wakeReq; let masterGains = []; let gum = 0; let offlines = [];

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
// 【便CX】作り物の殻への呼び出し・知らせ
const nativeCalls = (n) => cap.native.filter(([k]) => k === n);
const micStarts = () => nativeCalls("micStart").length;
const emitNative = (ev, d) => mod.act(async () => { for (const fn of [...(cap.listeners[ev] || [])]) fn(d); });

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
  // マスターの音量 = リミッター(createDynamicsCompressor)の直後に作られた gain。作った順に控える(masterGains = 作った AudioContext の全部)。
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
  // 【便CX】殻のクリックの描き出し(renderMetroClickSamples)の OfflineAudioContext(音の出口を使わない)。助走 0.12 秒の後ろに 0.5 の標本を1つ返す
  class FakeOfflineAudioContext {
    constructor(ch, length, sampleRate) { this.length = length; this.sampleRate = sampleRate; this.destination = node(); offlines.push(this); }
    createBuffer(ch, len) { const d = new Float32Array(len); return { length: len, getChannelData: () => d }; }
    createBufferSource() { return { ...node(), buffer: null, start() {} }; }
    createBiquadFilter() { return { ...node(), type: "", frequency: { value: 0 }, Q: { value: 0 } }; }
    createGain() { return { ...node(), gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
    createDynamicsCompressor() { const p = () => ({ value: 0 }); return { ...node(), threshold: p(), knee: p(), ratio: p(), attack: p(), release: p() }; }
    startRendering() { const d = new Float32Array(this.length); d[Math.round(this.sampleRate * 0.12)] = 0.5; return Promise.resolve({ getChannelData: () => d }); }
  }
  window.OfflineAudioContext = FakeOfflineAudioContext;
  track = { enabled: true, readyState: "live", muted: false, kind: "audio", stopped: 0, stop() { this.stopped++; this.readyState = "ended"; }, getSettings() { return {}; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => { gum += 1; return stream; } }, configurable: true });
  wakeReq = vi.fn(async () => ({ release() {}, addEventListener() {} }));
  Object.defineProperty(window.navigator, "wakeLock", { value: { request: wakeReq }, configurable: true });
}
// 作り物の殻が送る雑音の塊(±1e-3。Float32 × 1024 の base64)
function noiseChunkB64() {
  const f = new Float32Array(1024);
  for (let i = 0; i < f.length; i++) f[i] = (Math.random() - 0.5) * 2e-3;
  const b = new Uint8Array(f.buffer);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

beforeEach(() => {
  fake = createFakeIndexedDb();
  cap.log.length = 0; cap.factories.length = 0; cap.session = null; masterGains = []; gum = 0; offlines = [];
  cap.native = []; cap.nativeInfo = null; cap.listeners = {}; cap.metroFail = null; // 配列ごと作り直す(試験が push を差し替えることがある)
  cap.mic = { queue: [], fail: null, rate: 48000 };
  cap.clock = { offsetSec: 1000, sampleRate: 48000, delayMs: 0 };
  if (cap.feed.timer) clearInterval(cap.feed.timer);
  cap.feed = { id: null, timer: null, off: false, b64: noiseChunkB64() };
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
  if (cap.feed.timer) { clearInterval(cap.feed.timer); cap.feed.timer = null; }
  delete window.Capacitor;
  delete window.AudioContext;
  delete window.OfflineAudioContext;
  try { delete window.navigator.mediaDevices; } catch { /* */ }
  try { delete window.navigator.wakeLock; } catch { /* */ }
});
const asShell = () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" }; };
const recButton = () => document.querySelector('button[aria-label="録音する"]') || document.querySelector('button[aria-label="録音を停止"]');
const settle = async () => { for (let i = 0; i < 10; i++) await tick(5); };
const waitMic = () => waitFor(() => micStarts() >= 1 && cap.feed.id, "殻のマイク");

describe("殻: スリープ防止は KeepAwake・マイクは殻(getUserMedia を呼ばない)・タブを離れたらマイクを止める", () => {
  it("殻のマイクを始める(micStart)。録音の開始で keepAwake・停止で allowSleep。navigator.wakeLock は使わない・getUserMedia も Web の AudioContext も使わない", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    expect(cap.log).toEqual(["FicusAudioSession.micStart"]);
    await waitFor(() => document.querySelector('button[aria-label="録音する"]'), "録音のボタン");
    await click(recButton());
    await waitFor(() => cap.log.includes("keepAwake"), "録音の開始で keepAwake");
    expect(document.querySelector('button[aria-label="録音を停止"]')).not.toBe(null);
    await click(recButton());
    await waitFor(() => cap.log.includes("allowSleep"), "録音の停止で allowSleep");
    expect(cap.log).toEqual(["FicusAudioSession.micStart", "keepAwake", "allowSleep"]);
    expect(wakeReq).not.toHaveBeenCalled();
    expect([gum, masterGains.length]).toEqual([0, 0]);
  }, 30000);

  it("リードタブへ移ると殻のマイクを止める(同じ id の micStop)。戻ると新しい id で取り直す", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    const id1 = nativeCalls("micStart")[0][1].id;
    await click(nav("リード"));
    await settle();
    expect(nativeCalls("micStop").map(([, o]) => o.id)).toEqual([id1]);
    await click(nav("計測"));
    await waitFor(() => micStarts() === 2, "戻ると取り直す(完全再取得の道)");
    expect(nativeCalls("micStart")[1][1].id).not.toBe(id1);
    expect([gum, masterGains.length]).toEqual([0, 0]);
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
    await waitMic();
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
    await waitFor(() => document.querySelector('button[aria-label="録音する"]') && micStarts() >= 1, "録音のボタン");
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
    await waitMic();
    cap.log.length = 0;
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    try {
      await mod.act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      await waitFor(() => cap.log.includes("allowSleep"), "隠れたら allowSleep");
    } finally { delete document.hidden; }
  }, 30000);
});

// 【殻 S2 審査】イヤホンを外すと WebKit が AudioContext を止める(suspended)── Web の AudioContext の話。
// 【便CX】殻はメトロノームを殻で鳴らすので、殻の ctx の onstatechange の手当ては消した(経路の変化は殻が自分で作り直す)。
describe("経路の変化で AudioContext が止められたとき", () => {
  const startMetroCtx = async () => {
    await waitFor(() => document.querySelector('button[aria-label="メトロノーム"]'), "計測タブ");
    await click(document.querySelector('button[aria-label="メトロノーム"]'));
    await waitFor(() => document.querySelector('button[aria-label="メトロノームの開始/停止"]'), "メトロノームの面");
    await click(document.querySelector('button[aria-label="メトロノームの開始/停止"]'));
    await waitFor(() => masterGains.some((c) => c.master), "メトロノームの ctx", 5000);
    return masterGains.find((c) => c.master);
  };
  it("Web: メトロノームの ctx に onstatechange を付けない", async () => {
    mod = await loadApp();
    await render();
    const ctx = await startMetroCtx();
    expect(ctx.onstatechange).toBe(undefined);
  }, 30000);
  it("殻: メトロノームは殻で鳴らす(Web の AudioContext を作らない)・殻の標本化周波数で描いて1回渡し、今の設定の並び(♩=120・4/4 → 0.5 秒ごとに 強 拍 拍 拍)で 0.12 秒後から始める", async () => {
    asShell();
    cap.clock.sampleRate = 44100;
    mod = await loadApp();
    await render();
    await waitMic();
    await openMetroShell();
    await waitFor(() => nativeCalls("metroStart").length === 1, "殻の開始");
    expect(nativeCalls("metroLoad")).toEqual([["metroLoad", { sampleRate: 44100 }]]);
    expect(offlines.map((c) => c.sampleRate)).toEqual([44100, 44100, 44100]);
    const o = nativeCalls("metroStart")[0][1];
    expect({ stepSec: o.stepSec, kinds: o.kinds, leadSec: o.leadSec }).toEqual({ stepSec: 0.5, kinds: ["accent", "beat", "beat", "beat"], leadSec: 0.12 });
    expect(masterGains.length).toBe(0);
    expect(metroToggle().getAttribute("aria-pressed")).toBe("true");
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
  it("殻: Web の鎖は組まない(Web の AudioContext を作らない)。殻へ渡すクリックは殻の値 1.0 のマスターで描く(描き出しの ctx の基の値)", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    await openMetroShell();
    await waitFor(() => nativeCalls("metroLoad").length === 1, "描いて渡す");
    expect(masterGains.length).toBe(0);
    expect(offlines.length).toBe(3);
    expect(offlines.every((c) => c.__metroMasterBase === 1)).toBe(true);
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

// ------------------------------------------------------------------
// 【便CQ 2026-10-12】本人の実機(Ficus Dev)の報告2件。
//   (2) しばらく他のアプリを見てから戻るとメトロノームが動かない(リードタブへ移って戻ると使える)。
//       戻ったら、止まっているメトロノームの ctx を閉じて捨て、次の START がそのタップの中で作り直す。勝手には鳴らさない。
//   (1) マイクが入っているとメトロノームが小さい。WebKit は取り込み中に音が鳴り始めるたび playAndRecord + videoChat(VC の音量)へ
//       立て直すので、殻ではメトロノームが鳴り始めた後(resume が解決した後)にもう一度 routeToSpeaker を呼ぶ。
// 【守っているもの】作り物の AudioContext の上での配線と順序(どの ctx が閉じられ、どの ctx が resume され、どの ctx に予約されるか・
//   routeToSpeaker が何回・いつ呼ばれるか・getUserMedia に渡す制約の値)。
// 【守っていないもの】実機で音が出ること・音量が戻ること・WebKit が戻った ctx を本当に「running なのに無音」にするか(どれも実機待ち)。
//   作り物の ctx は「running で時計も進む」=死んだ ctx の形を真似ているだけで、無音そのものは作れない。
// ------------------------------------------------------------------
const metroToggle = () => document.querySelector('button[aria-label="メトロノームの開始/停止"]');
// 作り物の音源の start() を ctx ごとに数える(予約されたか = 押せば鳴るの作り物での言い換え)
function countClickStarts() {
  const P = window.AudioContext.prototype;
  const orig = P.createBufferSource;
  P.createBufferSource = function () {
    const s = orig.call(this);
    const ctx = this;
    s.start = () => { ctx.started = (ctx.started || 0) + 1; };
    return s;
  };
}
const totalStarts = () => masterGains.reduce((a, c) => a + (c.started || 0), 0);
async function setHidden(v) {
  Object.defineProperty(document, "hidden", { value: v, configurable: true });
  await mod.act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
}
async function openMetroAndStart() {
  await waitFor(() => document.querySelector('button[aria-label="メトロノーム"]'), "計測タブ");
  await click(document.querySelector('button[aria-label="メトロノーム"]'));
  await waitFor(() => metroToggle(), "メトロノームの面");
  await click(metroToggle());
  await waitFor(() => masterGains.some((c) => c.master), "メトロノームの ctx", 5000);
  return masterGains.find((c) => c.master);
}

// 【便CX】殻: メトロノームの面を開いて(開いていればそのまま)START を押す。殻は Web の AudioContext を作らないので、殻の metroStart を呼び手が待つ
async function openMetroShell() {
  await waitFor(() => document.querySelector('button[aria-label="メトロノーム"]'), "計測タブ");
  if (!metroToggle()) await click(document.querySelector('button[aria-label="メトロノーム"]'));
  await waitFor(() => metroToggle(), "メトロノームの面");
  await click(metroToggle());
}

describe("【便CQ】裏から戻ったときのメトロノーム: 止まった状態で戻り、押せば新しく鳴る", () => {
  it("Web: 鳴らしたまま裏へ → 戻ると止まったまま(勝手に予約しない)・古い ctx は閉じる → 押すと新しい ctx を resume して予約する", async () => {
    countClickStarts();
    mod = await loadApp();
    await render();
    const ctx1 = await openMetroAndStart();
    await waitFor(() => (ctx1.started || 0) > 0, "1つ目の ctx で予約される");
    expect(metroToggle().getAttribute("aria-pressed")).toBe("true");
    try {
      await setHidden(true);
      expect(metroToggle().getAttribute("aria-pressed")).toBe("false");   // 隠れたら止める(既存)
      // 戻ってきた ctx は「running のまま・時計も進む」(WebKit bug 240646 の形)。F-52 の時計の判定では見分けられない
      expect(ctx1.state).toBe("running");
      await setHidden(false);
      expect(ctx1.state).toBe("closed");                                   // 戻ったら閉じて捨てる
      const startsAtReturn = totalStarts();
      const ctx1Starts = ctx1.started;
      await tick(300);
      expect(metroToggle().getAttribute("aria-pressed")).toBe("false");   // 勝手に鳴り出さない
      expect(totalStarts()).toBe(startsAtReturn);                          // 戻っただけでは1つも予約しない
      await click(metroToggle());
      await waitFor(() => masterGains.some((c) => c !== ctx1 && c.master), "押すと新しい ctx", 5000);
      const ctx2 = masterGains.find((c) => c !== ctx1 && c.master);
      expect(ctx2.resumes).toBeGreaterThanOrEqual(1);                     // タップの中で resume を蹴る
      await waitFor(() => (ctx2.started || 0) > 0, "新しい ctx に予約される", 5000);
      expect(ctx1.started).toBe(ctx1Starts);                               // 閉じた ctx にはもう予約しない
      expect(metroToggle().getAttribute("aria-pressed")).toBe("true");
    } finally { delete document.hidden; }
  }, 30000);
  // 【便CX】殻は殻で鳴らす: 隠れたら殻も止める(metroStop)・戻っただけでは鳴らさない・作り直した面で押すと新しい run で殻を始める
  it("殻: 鳴らしたまま裏へ → 隠れたら殻も止める(今の run の metroStop)→ 戻ると止まったまま(勝手に metroStart しない)→ 押すと新しい run で殻を始める", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    await openMetroShell();
    await waitFor(() => nativeCalls("metroStart").length === 1, "1回目");
    const run1 = nativeCalls("metroStart")[0][1].run;
    try {
      await setHidden(true);
      expect(metroToggle().getAttribute("aria-pressed")).toBe("false");
      await waitFor(() => nativeCalls("metroStop").some(([, o]) => o.run === run1), "隠れたら殻も止める");
      await setHidden(false);
      await tick(300);
      expect(nativeCalls("metroStart").length).toBe(1);                   // 勝手に鳴り出さない
      await waitFor(() => metroToggle(), "作り直した面");
      expect(metroToggle().getAttribute("aria-pressed")).toBe("false");
      await click(metroToggle());
      await waitFor(() => nativeCalls("metroStart").length === 2, "押すと殻で鳴らす");
      expect(nativeCalls("metroStart")[1][1].run).not.toBe(run1);
      expect(metroToggle().getAttribute("aria-pressed")).toBe("true");
      expect([gum, masterGains.length]).toEqual([0, 0]);
    } finally { delete document.hidden; }
  }, 30000);
  // (【便CX】次の2つは止まっている Web の AudioContext を捨てる dropIdleMetroCtx の検査。殻は Web の AudioContext を作らなくなったので Web で見る)
  it("Web: ページのキャッシュから戻った(pageshow・persisted)ときも止まっている ctx を閉じる。persisted でない pageshow では閉じない", async () => {
    mod = await loadApp();
    await render();
    const ctx1 = await openMetroAndStart();
    await click(metroToggle());                                              // 止める
    expect(metroToggle().getAttribute("aria-pressed")).toBe("false");
    const fresh = new Event("pageshow"); fresh.persisted = false;
    await mod.act(async () => { window.dispatchEvent(fresh); });
    expect(ctx1.state).toBe("running");
    const restored = new Event("pageshow"); restored.persisted = true;
    await mod.act(async () => { window.dispatchEvent(restored); });
    expect(ctx1.state).toBe("closed");
    await click(metroToggle());
    await waitFor(() => masterGains.some((c) => c !== ctx1 && c.master), "押すと新しい ctx", 5000);
  }, 30000);
  it("Web: 鳴らしている ctx には触れない(戻りの知らせだけが来ても、鳴っている ctx を閉じない)", async () => {
    mod = await loadApp();
    await render();
    const ctx1 = await openMetroAndStart();
    const restored = new Event("pageshow"); restored.persisted = true;
    await mod.act(async () => { window.dispatchEvent(restored); });
    try {
      await setHidden(false);                                                // 隠れずに「見えている」の知らせだけ
      expect(ctx1.state).toBe("running");
      expect(metroToggle().getAttribute("aria-pressed")).toBe("true");
    } finally { delete document.hidden; }
  }, 30000);
  it("殻: 鳴らしている間に「見えている」の知らせだけが来ても止めない(殻へ metroStop を送らない)", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    await openMetroShell();
    await waitFor(() => nativeCalls("metroStart").length === 1, "鳴らす");
    const restored = new Event("pageshow"); restored.persisted = true;
    await mod.act(async () => { window.dispatchEvent(restored); });
    try {
      await setHidden(false);
      await settle();
      expect(nativeCalls("metroStop").length).toBe(0);
      expect(metroToggle().getAttribute("aria-pressed")).toBe("true");
    } finally { delete document.hidden; }
  }, 30000);
});

// (【便CX】【便CQ】の「鳴り始めた後にもう一度 routeToSpeaker」の検査は、routeToSpeaker ごと消した。殻はもう WebKit で鳴らさない)
describe("【便CQ】マイクの制約", () => {
  it("Web: getUserMedia に渡す制約は音声処理を3つとも切る(echoCancellation / noiseSuppression / autoGainControl = false)", async () => {
    const calls = [];
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async (c) => { calls.push(c); return stream; } }, configurable: true });
    mod = await loadApp();
    await render();
    await waitFor(() => calls.length > 0, "getUserMedia");
    expect(calls[0]).toEqual({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  }, 30000);
  it("殻: getUserMedia を呼ばない(殻のタップは音声処理を通さない = 板の micSettings は ec / ns / agc とも no)", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    await settle();
    expect(gum).toBe(0);
  }, 30000);
});

// ------------------------------------------------------------------
// 【便CQ 審査の差し戻し】R4・R5 を振る舞いで落とす / 統括の決定A(殻は戻ったら計測タブの中身を作り直す)/ 決定B(診断の板)
// ------------------------------------------------------------------
// 作り物の close を数える。閉じた ctx をもう一度閉じたら控える(本物は InvalidStateError で拒否し、拾われない Promise の拒否になる)
function countCloses() {
  const P = window.AudioContext.prototype;
  const orig = P.close;
  window.__closedTwice = 0;
  P.close = function () {
    if (this.state === "closed") window.__closedTwice += 1;
    this.closes = (this.closes || 0) + 1;
    return orig.call(this);
  };
}
// getUserMedia を数え、呼ぶたびに新しい live のトラックを渡す(本物と同じ。installFakeMic は同じトラックを使い回すので、
// 一度 stop すると ended のまま戻らず、戻ったときの健全さの確かめが偽になって取り直しが2回に見える)。track は最新のものを指す。
function countGetUserMedia() {
  const box = { n: 0 };
  const makeTrack = () => ({ enabled: true, readyState: "live", muted: false, kind: "audio", stopped: 0, stop() { this.stopped++; this.readyState = "ended"; },
    getSettings() { return { echoCancellation: false, noiseSuppression: false, autoGainControl: false }; } });
  Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => {
    box.n += 1;
    const t = makeTrack();
    track = t;
    return { getTracks: () => [t], getAudioTracks: () => [t] };
  } }, configurable: true });
  return box;
}

// (【便CX】R4「鳴り始めた後の routeToSpeaker は、いまの ctx のときだけ」の検査は、routeToSpeaker ごと消した)

describe("【便CQ 差し戻し】戻ったときに捨てた ctx を二度閉じない(R5: ref を空にする)", () => {
  // 【便CX】殻は Web の AudioContext を作らなくなったので Web で見る(殻の時計の口は殻の metroStop の検査が見る)
  it("Web: 鳴らす → 裏 → 戻る → 押す で、古い ctx の close はちょうど1回・閉じた ctx を閉じ直さない", async () => {
    countCloses();
    mod = await loadApp();
    await render();
    const ctx1 = await openMetroAndStart();
    try {
      await setHidden(true);
      await setHidden(false);
      await settle();
      await waitFor(() => metroToggle(), "メトロノームの面");
      await click(metroToggle());
      await waitFor(() => masterGains.some((c) => c !== ctx1 && c.master), "押すと新しい ctx", 5000);
      await settle();
      expect(ctx1.closes).toBe(1);
      expect(window.__closedTwice).toBe(0);
    } finally { delete document.hidden; }
  }, 30000);
});

describe("【便CQ 統括の決定A】裏から戻ったとき: 殻は計測タブの中身を作り直す(タブを離れて戻るのと同じ)・マイクは1回だけ取り直す", () => {
  it("殻: 戻ると MeasureView を作り直す(面のボタンが別の要素になる)・隠れたら殻のマイクを止め、戻ったら micStart はちょうど1回", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    await openMetroShell();
    await waitFor(() => nativeCalls("metroStart").length === 1, "鳴らす");
    await click(metroToggle());                                              // 止めておく
    const before = metroToggle();
    const n0 = micStarts();
    const id = nativeCalls("micStart").at(-1)[1].id;
    try {
      await setHidden(true);
      await waitFor(() => nativeCalls("micStop").some(([, o]) => o.id === id), "隠れたらマイクを止める(既存)");
      await setHidden(false);
      await waitFor(() => metroToggle() && metroToggle() !== before, "作り直された面", 5000);
      await waitFor(() => micStarts() >= n0 + 1, "戻ったら取り直す");
      await tick(300);
      expect(micStarts()).toBe(n0 + 1);                                     // 二重に取り直さない
      expect(metroToggle().getAttribute("aria-pressed")).toBe("false");     // 勝手に鳴らない
    } finally { delete document.hidden; }
  }, 30000);
  it("Web: 戻っても MeasureView は作り直さない(面のボタンは同じ要素)・getUserMedia はちょうど1回", async () => {
    const gum = countGetUserMedia();
    mod = await loadApp();
    await render();
    await openMetroAndStart();
    await click(metroToggle());
    const before = metroToggle();
    gum.n = 0;
    try {
      await setHidden(true);
      await setHidden(false);
      await waitFor(() => gum.n >= 1, "戻ったら取り直す");
      await tick(300);
      expect(gum.n).toBe(1);
      expect(metroToggle()).toBe(before);
    } finally { delete document.hidden; }
  }, 30000);
  it("殻: タブを離れて戻る道と、裏から戻る道で、マイクの取り直しの回数が同じ(どちらも1回)", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    const n0 = micStarts();
    await click(nav("リード"));
    await settle();
    await click(nav("計測"));
    await waitFor(() => micStarts() >= n0 + 1, "タブで戻る");
    await tick(300);
    const byTab = micStarts() - n0;
    try {
      await setHidden(true);
      await setHidden(false);
      await waitFor(() => micStarts() >= n0 + byTab + 1, "裏から戻る");
      await tick(300);
      expect([byTab, micStarts() - n0 - byTab]).toEqual([1, 1]);
    } finally { delete document.hidden; }
  }, 30000);
});

describe("【便CQ 統括の決定B】音の診断の板(計測タブで下部タブの「計測」を長押し)", () => {
  const press = async (ms) => {
    const btn = nav("計測");
    await mod.act(async () => { btn.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await tick(ms);
    await mod.act(async () => {
      btn.dispatchEvent(new Event("pointerup", { bubbles: true }));
      btn.click();
    });
  };
  const panel = () => document.querySelector("[data-audio-diag]");
  const val = (k) => document.querySelector(`[data-audio-diag] [data-diag-key="${k}"]`)?.textContent;
  it("殻: 長押しで開き、音のセッション・メトロノーム(殻の時計)・戻り・殻のマイク・殻のエンジン・予約・入力・時計・描いたクリックを出す。閉じるで消える", async () => {
    asShell();
    cap.session = {
      category: "AVAudioSessionCategoryPlayAndRecord", mode: "AVAudioSessionModeDefault",
      options: 0x8 | 0x20, routeSharingPolicy: 0,
      outputs: ["Speaker"], inputs: ["MicrophoneBuiltIn"], outputVolume: 0.7, otherAudioPlaying: false,
    };
    cap.nativeInfo = {
      engineRunning: true, activated: true, micOn: true, metroOn: true, configChanges: 2, rebuilds: 1, lastError: "configurationChange",
      scheduled: 12, played: 10, playing: true, lastRender: true, tick: "ok", chunks: 33, inputRate: 48000, inputDb: -45.8,
      via: "sink", cbFrames: 256, cbMax: 256, sendMs: 21.4, sendMaxMs: 22.1, overruns: 0,
    };
    mod = await loadApp();
    await render();
    await waitMic();
    await openMetroShell();
    await waitFor(() => nativeCalls("metroStart").length === 1, "鳴らす");
    try {
      await setHidden(true);
      await tick(50);
      await setHidden(false);
    } finally { delete document.hidden; }
    await waitFor(() => metroToggle(), "メトロノームの面");
    await click(metroToggle());                                              // 戻ったあとの START
    await waitFor(() => nativeCalls("metroStart").length === 2, "戻ったあとの殻の開始");
    expect(panel()).toBe(null);
    await press(500);
    await waitFor(() => panel() && val("category") === "PlayAndRecord" && /^running=/.test(val("nativeEngine") || ""), "板と音のセッション", 5000);
    expect(val("mode")).toBe("Default");
    expect(val("options")).toBe("0x28 defaultToSpeaker allowBluetoothA2DP");
    expect(val("outputVolume")).toBe("0.70");
    expect(val("metro")).toMatch(/^on=yes ctx=running t=\d+\.\d{3} phase=-?\d+\.\d{2}$/);
    expect(val("lastStart")).toMatch(/rebuilt=yes prev=none stalled=no$/);  // 作り直した面で押したので、殻の時計の口も新しい
    expect(val("lastReturn")).toMatch(/ bg=\d+\.\ds #1$/);
    expect(val("mic")).toMatch(/^ctx=running track=live muted=no enabled=yes/);
    expect(val("micSettings")).toBe("ec=no ns=no agc=no");
    expect(val("micTrack")).toBe("label=native:builtInMic id=native");
    expect(val("nativeEngine")).toBe("running=yes act=yes mic=yes metro=yes cfg=2 rb=1 err=configurationChange");
    expect(val("nativeSched")).toBe("sched=12 played=10 play=yes lrt=yes tick=ok");
    expect(val("nativeIn")).toMatch(/^-45\.8 dBFS @48000 via=sink cb=256\/256 send=21\/22ms chunks=33 js=\d+ age=\d+ms$/);
    expect(val("nativeClock")).toMatch(/^±\d+\.\dms rtt=\d+\.\dms syncs=\d+$/);
    expect(val("nativeBuf")).toBe("0.500/0.500/0.500 @48000");
    await click([...panel().querySelectorAll("button")].find((b) => b.textContent === "閉じる"));
    expect(panel()).toBe(null);
  }, 30000);
  it("短く押しただけ・計測タブ以外では開かない", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    await press(100);
    await settle();
    expect(panel()).toBe(null);
    await click(nav("リード"));
    await settle();
    await press(500);
    await settle();
    expect(panel()).toBe(null);
  }, 30000);
  it("殻のビルドが古い(sessionInfo・audioInfo が無い)と「要ビルド」", async () => {
    asShell();
    cap.session = null;
    mod = await loadApp();
    await render();
    await waitMic();
    await press(500);
    await waitFor(() => panel() && /要ビルド/.test(val("session") || "") && /要ビルド/.test(val("nativeEngine") || ""), "要ビルド", 5000);
  }, 30000);
  it("Web: session は n/a (web)", async () => {
    mod = await loadApp();
    await render();
    await waitFor(() => document.querySelector('button[aria-label="メトロノーム"]'), "計測タブ");
    await press(500);
    await waitFor(() => panel() && val("session") === "n/a (web)", "Web", 5000);
  }, 30000);
});

// ------------------------------------------------------------------
// 【便CT 2026-10-13】板の試し口(本人の実機「マイクがあると、まだ小さい」の聞き比べ)。
// 【便CX 2026-10-19】mode(殻のセッションのモード)と「鳴らし方」は消した。gain(Web のメトロノームのマスターの倍率)と直近のクリックのピークは Web だけに残した
//   (殻のクリックは殻で鳴るので Web のマスターは届かない・殻のクリックの音は変えない決まり)。
// 【守っているもの】作り物の Web Audio の上で: gain のボタンがメトロノームのマスターに 基の値 2.6 × 倍率 を入れ、止めて鳴らし直しても残る / 保存しない
//   (kv と localStorage が1文字も変わらない・アプリを読み直すと x1)/ 直近のクリックのピークの行が数を出す / 閉じたら戻し・片付け / 殻では試し口も行も出さない。
// 【守っていないもの】ピークの値が実機の出口と同じか(実機待ち)。
// ------------------------------------------------------------------
describe("【便CT】診断の板の試し口(gain・直近のクリックのピーク)── 【便CX】Web だけ", () => {
  const press = async (ms) => {
    const btn = nav("計測");
    await mod.act(async () => { btn.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await tick(ms);
    await mod.act(async () => {
      btn.dispatchEvent(new Event("pointerup", { bubbles: true }));
      btn.click();
    });
  };
  const panel = () => document.querySelector("[data-audio-diag]");
  const val = (k) => document.querySelector(`[data-audio-diag] [data-diag-key="${k}"]`)?.textContent;
  const gainBtn = (x) => document.querySelector(`[data-audio-diag] [data-diag-gain="${x}"]`);
  const saved = () => JSON.stringify({
    kv: [...(fake._peek("windToneLabDB", "kv")?.entries() ?? [])],
    ls: Object.keys(window.localStorage).sort().map((k) => [k, window.localStorage.getItem(k)]),
  });
  it("Web: gain は マスター = 2.6 × 倍率(鳴らす前に選んでも新しく組む鎖に当たる・鳴らし直しても残る)・保存しない・読み直すと x1・ピークの行・mode の試し口は無い", async () => {
    mod = await loadApp();
    await render();
    await waitFor(() => document.querySelector('button[aria-label="メトロノーム"]'), "計測タブ");
    await press(500);
    await waitFor(() => panel() && val("session") === "n/a (web)", "板", 5000);
    expect(val("metroGain")).toBe("x1");
    expect(val("testMode")).toBe(undefined);
    expect(panel().querySelector("[data-diag-mode]")).toBe(null);
    // 鳴らす前に x1.6 を選ぶ → START で作る ctx の鎖(getMetroMasterInput)が 2.6 × 1.6 で組まれる
    await click(gainBtn("1.6"));
    const ctx = await openMetroAndStart();
    expect(ctx.master.gain.value).toBeCloseTo(2.6 * 1.6, 12);
    await settle();
    const before = saved(); // 面を開いた・鳴らした記録(既存)の後で控え、試し口の操作で1文字も変わらないことを見る
    await click(gainBtn("1"));
    expect(ctx.master.gain.value).toBeCloseTo(2.6, 12);
    await click(gainBtn("1.3"));
    expect(ctx.master.gain.value).toBeCloseTo(2.6 * 1.3, 12);
    await waitFor(() => val("metroGain") === "x1.3", "倍率の行", 3000);
    // 直近のクリックのピーク(作り物の分析は ±0.001 の雑音を返す)
    await waitFor(() => /^\d\.\d{3} max=\d\.\d{3}$/.test(val("clickPeak") || ""), "ピークの行", 3000);
    // 止めて鳴らし直しても倍率は残る
    await click(metroToggle());
    await click(metroToggle());
    await settle();
    const now = masterGains.filter((c) => c.master).at(-1);
    expect(now.master.gain.value).toBeCloseTo(2.6 * 1.3, 12);
    await settle();
    expect(saved()).toBe(before);
    // 読み直す(アプリを開き直す)と x1
    await mod.act(async () => root.unmount());
    host.remove();
    masterGains = [];
    mod = await loadApp();
    await render();
    await waitFor(() => document.querySelector('button[aria-label="メトロノーム"]'), "計測タブ");
    await settle();
    if (!metroToggle()) await click(document.querySelector('button[aria-label="メトロノーム"]'));
    await waitFor(() => metroToggle(), "メトロノームの面");
    await click(metroToggle());
    await waitFor(() => masterGains.some((c) => c.master), "読み直した ctx", 5000);
    expect(masterGains.find((c) => c.master).master.gain.value).toBe(2.6);
    await press(500);
    await waitFor(() => panel() && val("metroGain") === "x1", "読み直した板", 5000);
  }, 40000);
  // 【便CT 審査 統括の裁定】板を閉じたら試し口を元に戻す(gain ×1)・ピークの読み取り(20ms)を止める・分析の節点を外す
  it("Web: 閉じると gain は x1 に戻り、ピークの読み取りが止まり、分析の節点がマスターから外れる", async () => {
    mod = await loadApp();
    await render();
    const ctx = await openMetroAndStart();
    let reads = 0;
    const taps = [];
    const disc = [];
    const origCreate = ctx.createAnalyser.bind(ctx);
    ctx.createAnalyser = () => {
      const a = origCreate();
      const g = a.getFloatTimeDomainData;
      a.getFloatTimeDomainData = (b) => { reads++; return g.call(a, b); };
      taps.push(a);
      return a;
    };
    ctx.master.disconnect = (n) => { disc.push(n); };
    await press(500);
    await waitFor(() => panel() && val("session") === "n/a (web)", "板", 5000);
    await waitFor(() => reads > 0, "ピークを読み始める", 3000);
    await click(gainBtn("1.6"));
    expect(ctx.master.gain.value).toBeCloseTo(2.6 * 1.6, 12);
    await click([...panel().querySelectorAll("button")].find((b) => b.textContent === "閉じる"));
    expect(panel()).toBe(null);
    await settle();
    expect(ctx.master.gain.value).toBeCloseTo(2.6, 12);
    expect(taps.length).toBeGreaterThan(0);
    expect(taps.every((a) => disc.includes(a))).toBe(true);
    expect(ctx.__metroPeakTap ?? null).toBe(null);
    const atClose = reads;
    await tick(300);
    expect(reads).toBe(atClose);
    await press(500);
    await waitFor(() => panel() && val("metroGain") === "x1", "開き直した板", 5000);
  }, 40000);
  it("殻: 試し口(gain・mode・鳴らし方)のボタンも metroGain / clickPeak / testMode / playback の行も出さない", async () => {
    asShell();
    cap.session = { category: "AVAudioSessionCategoryPlayAndRecord", mode: "AVAudioSessionModeDefault", options: 0x28, routeSharingPolicy: 0, outputs: ["Speaker"], inputs: ["MicrophoneBuiltIn"], outputVolume: 0.3, otherAudioPlaying: false };
    mod = await loadApp();
    await render();
    await waitMic();
    await press(500);
    await waitFor(() => panel() && val("category") === "PlayAndRecord", "板", 5000);
    expect(panel().querySelectorAll("[data-diag-gain], [data-diag-mode], [data-diag-playback]").length).toBe(0);
    for (const k of ["metroGain", "clickPeak", "testMode", "playback", "webCtx"]) expect(val(k)).toBe(undefined);
    expect(val("nativeEngine")).toBeTruthy();
  }, 30000);
});

// ------------------------------------------------------------------
// 【便CX 2026-10-19】殻の計測の音を本番で殻(AVAudioEngine)が扱う(本人の実機で確定: WebKit の取り込みと play-and-record の AudioContext が、
//   アプリ全体の音量を通話の段に縛っていた)。
// 【守っているもの】作り物の殻の上で: 殻では getUserMedia を呼ばず・Web の AudioContext を作らず・navigator.audioSession.type を play-and-record にしない
//   (マイク・メトロノーム・録音・タブの往復・裏から戻る を通して)/ 拍の表示(振り子の位相)が殻の時計に合う(往復の片道を不揃いにしても 10ms 以内)/
//   テンポは同じ run で次の拍から・拍子は新しい run で小節の頭から・止めると今の run / 権限の拒否は今と同じ案内 / 殻が諦めたら既存の復旧の入口で取り直す /
//   中断は JS では取り直さない / 塊が途切れたら既存の無音の見張りが取り直す / 殻がメトロノームを鳴らせなければ止める / 録音で殻のマイクを取り直さない /
//   Web は殻のメソッドを1回も呼ばず今のまま(getUserMedia・AudioContext・play-and-record)。
// 【守っていないもの】殻のエンジンが本当に鳴る・取れる・作り直す・大きく聞こえること・ブリッジの実際の往復(実機待ち。Swift はここでは走らない)。
// ------------------------------------------------------------------
describe("【便CX】殻の計測の音は殻で扱う", () => {
  const defineAudioSession = () => Object.defineProperty(window.navigator, "audioSession", { value: { type: "auto" }, configurable: true, writable: true });
  const dropAudioSession = () => { try { delete window.navigator.audioSession; } catch { /* */ } };
  const later = () => { const orig = performance.now.bind(performance); vi.spyOn(performance, "now").mockImplementation(() => orig() + 1e6); }; // 復旧のクールダウン(起動直後の 5 秒)の外

  it("殻: getUserMedia を呼ばず・Web の AudioContext を作らず・audioSession.type を play-and-record にしない(マイク・メトロノーム・録音・タブの往復・裏から戻る)", async () => {
    asShell();
    defineAudioSession();
    try {
      mod = await loadApp();
      await render();
      await waitMic();
      await openMetroShell();
      await waitFor(() => nativeCalls("metroStart").length === 1, "殻で鳴らす");
      await click(recButton());
      await waitFor(() => document.querySelector('button[aria-label="録音を停止"]'), "録音中");
      await click(recButton());
      await click(metroToggle());
      await click(nav("リード"));
      await settle();
      await click(nav("計測"));
      await waitFor(() => micStarts() === 2, "戻ると殻のマイク");
      try {
        await setHidden(true);
        await setHidden(false);
        await waitFor(() => micStarts() === 3, "裏から戻ると殻のマイク");
      } finally { delete document.hidden; }
      await openMetroShell();
      await waitFor(() => nativeCalls("metroStart").length === 2, "作り直した面で殻で鳴らす");
      await settle();
      expect(gum).toBe(0);
      expect(masterGains.length).toBe(0);
      expect(navigator.audioSession.type).toBe("auto");
    } finally { dropAudioSession(); }
  }, 40000);

  it("殻: 拍の表示(振り子の位相)が殻の時計に合う ── 殻が知らせたクリックの host time と、合わせた時計で数えた位相のずれが 10ms 以内(往復の片道を不揃いにしても)", async () => {
    asShell();
    cap.clock.delayMs = 8; // 殻は呼ばれた瞬間の時刻を返し、答えは 8ms 遅れて届く(往復の真ん中と 4ms ずれる)
    mod = await loadApp();
    await render();
    await waitMic();
    await openMetroShell();
    await waitFor(() => nativeCalls("metroStart").length === 1, "殻で鳴らす");
    const { run, v, stepSec } = nativeCalls("metroStart")[0][1];
    expect(stepSec).toBe(0.5);
    const hostNow = () => performance.now() / 1000 + cap.clock.offsetSec; // 殻の本当の時計
    const h0 = hostNow() + 0.05;
    await emitNative("metroClicks", { run, clicks: [
      { h: h0, s: 0, k: "accent", i: 0, v },
      { h: h0 + 0.5, s: 24000, k: "beat", i: 1, v },
    ] });
    const diag = await import("../audioDiag.jsx");
    // 2つ目の拍頭(gBeat 1)が錨: 位相 = 1 + (今 − (h0 + 0.5)) / 0.5
    const errs = [];
    for (let k = 0; k < 5; k++) {
      const phase = diag.AUDIO_DIAG.getMetro().phase;
      const want = 1 + (hostNow() - (h0 + 0.5)) / 0.5;
      errs.push(Math.abs(phase - want) * 0.5 * 1000); // ミリ秒
      await tick(20);
    }
    expect(Math.max(...errs)).toBeLessThanOrEqual(10);
    // 前の run の知らせは錨を動かさない(止めてから鳴らし直した後に、古い予約の知らせが遅れて届いた形)
    await click(metroToggle());
    await click(metroToggle());
    await waitFor(() => nativeCalls("metroStart").length === 2, "鳴らし直す");
    const run2 = nativeCalls("metroStart")[1][1].run;
    await emitNative("metroClicks", { run, clicks: [{ h: hostNow() - 5, s: 0, k: "accent", i: 0, v }] });
    const p = diag.AUDIO_DIAG.getMetro().phase;
    expect(p).toBeLessThan(1);           // 鳴らし直した直後の位相(0 拍目の手前)のまま。古い錨(5 秒前)なら 10 を越える
    expect(run2).not.toBe(run);
  }, 30000);

  it("殻: テンポの変更は同じ run の metroUpdate(次の拍から・並びの位置を続ける)・拍子の変更は新しい run で小節の頭から(0.08 秒後)・止めると今の run の metroStop", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    await openMetroShell();
    await waitFor(() => nativeCalls("metroStart").length === 1, "殻で鳴らす");
    const run1 = nativeCalls("metroStart")[0][1].run;
    await click(document.querySelector('button[aria-label="テンポを上げる"]'));
    await waitFor(() => nativeCalls("metroUpdate").length === 1, "テンポの変更");
    const u1 = nativeCalls("metroUpdate")[0][1];
    expect([u1.run, u1.restart, u1.kinds]).toEqual([run1, false, ["accent", "beat", "beat", "beat"]]);
    expect(u1.stepSec).toBeCloseTo(60 / 121, 12);
    await click(document.querySelectorAll('button[aria-label="テンポと拍子"]')[0]);
    await waitFor(() => document.querySelector('button[aria-label="拍子 3/4"]'), "拍子のシート");
    await click(document.querySelector('button[aria-label="拍子 3/4"]'));
    await waitFor(() => nativeCalls("metroUpdate").some(([, o]) => o.restart), "拍子の変更");
    const u2 = nativeCalls("metroUpdate").find(([, o]) => o.restart)[1];
    expect(u2.run).not.toBe(run1);
    expect([u2.leadSec, u2.kinds]).toEqual([0.08, ["accent", "beat", "beat"]]);
    expect(nativeCalls("metroStart").length).toBe(1);                       // 鳴らし直さない(殻の中で頭から置き直す)
    // 止める(START/STOP は面にある。シートが上に開いていても押せる)
    const lastRun = nativeCalls("metroUpdate").at(-1)[1].run;
    const toggles = [...document.querySelectorAll('button[aria-label="メトロノームの開始/停止"]')];
    await click(toggles[0]);
    await waitFor(() => nativeCalls("metroStop").length >= 1, "止める");
    expect(nativeCalls("metroStop").at(-1)[1]).toEqual({ run: lastRun });
  }, 30000);

  it("殻: 権限の拒否(殻の micStart が断る)→ 今と同じ拒否の案内(見出し・設定の案内の文言)・殻のマイクは動いていない", async () => {
    asShell();
    cap.mic.fail = "denied";
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mod = await loadApp();
      await render();
      await waitFor(() => document.body.textContent.includes("マイクの使用が許可されていません"), "拒否の案内");
      expect(document.body.textContent).toContain("設定 › Ficus › マイク を「許可」にすると計測できます");
      expect(cap.feed.id).toBe(null);
      expect(gum).toBe(0);
    } finally { vi.restoreAllMocks(); }
  }, 30000);

  it("殻: 殻が作り直しを諦めた(audioState failed・このマイク)→ 既存の復旧の入口(recoverMic)で殻のマイクを取り直す", async () => {
    asShell();
    later();
    try {
      mod = await loadApp();
      await render();
      await waitMic();
      await settle();
      const id1 = nativeCalls("micStart")[0][1].id;
      await emitNative("audioState", { state: "failed", reason: "loop", mic: true, metro: false, id: id1, run: 0 });
      await waitFor(() => micStarts() >= 2, "取り直す");
      const diag = await import("../audioDiag.jsx");
      expect(diag.AUDIO_DIAG.lastMicRecover?.reason).toBe("track-ended");
      expect(nativeCalls("micStop").some(([, o]) => o.id === id1)).toBe(true);
      expect(nativeCalls("micStart")[1][1].id).not.toBe(id1);
      expect(gum).toBe(0);
    } finally { vi.restoreAllMocks(); }
  }, 30000);

  it("殻: 中断(audioState interrupted)では JS は取り直さない(殻が中断の終わりに作り直す)", async () => {
    asShell();
    later();
    try {
      mod = await loadApp();
      await render();
      await waitMic();
      await settle();
      const id1 = nativeCalls("micStart")[0][1].id;
      const before = cap.native.length;
      await emitNative("audioState", { state: "interrupted", reason: "began", mic: true, metro: false, id: id1, run: 0 });
      await tick(300);
      expect(cap.native.slice(before).filter(([k]) => k.startsWith("mic"))).toEqual([]);
    } finally { vi.restoreAllMocks(); }
  }, 30000);

  it("殻: 殻のマイクの塊が途切れたら、解析には無音(0)が渡り、既存の無音の見張りが既存の復旧の入口で取り直す", async () => {
    asShell();
    later();
    try {
      mod = await loadApp();
      await render();
      await waitMic();
      await settle();
      cap.feed.off = true; // 殻が黙った
      await waitFor(() => micStarts() >= 2, "無音の見張りが取り直す", 8000);
      const diag = await import("../audioDiag.jsx");
      expect(diag.AUDIO_DIAG.lastMicRecover?.reason).toBe("silence-watchdog");
    } finally { vi.restoreAllMocks(); }
  }, 30000);

  it("殻: 殻がメトロノームを鳴らせなかった(殻の開始の失敗 / 作り直しを諦めた)→ ON のまま無音にせず止める", async () => {
    asShell();
    cap.metroFail = "engine not running";
    mod = await loadApp();
    await render();
    await waitMic();
    await openMetroShell();
    await waitFor(() => nativeCalls("metroStart").length === 1, "殻の開始(失敗)");
    await waitFor(() => metroToggle().getAttribute("aria-pressed") === "false", "止める");
    cap.metroFail = null;
    await click(metroToggle());
    await waitFor(() => nativeCalls("metroStart").length === 2 && metroToggle().getAttribute("aria-pressed") === "true", "押し直すと鳴る");
    const run = nativeCalls("metroStart")[1][1].run;
    await emitNative("audioState", { state: "failed", reason: "loop", mic: false, metro: true, id: "", run });
    await waitFor(() => metroToggle().getAttribute("aria-pressed") === "false", "諦めたら止める");
  }, 30000);

  it("殻: 録音の開始・停止で殻のマイクを取り直さない。録音中に隠れたら録音を終わらせ、殻のマイクも止める", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    await waitFor(() => document.querySelector('button[aria-label="録音する"]'), "録音のボタン");
    await settle();
    const id1 = nativeCalls("micStart")[0][1].id;
    await click(recButton());
    await waitFor(() => document.querySelector('button[aria-label="録音を停止"]'), "録音中");
    await click(recButton());
    await settle();
    expect([micStarts(), nativeCalls("micStop").length]).toEqual([1, 0]);
    await click(recButton());
    await waitFor(() => document.querySelector('button[aria-label="録音を停止"]'), "録音中");
    try {
      await setHidden(true);
      await waitFor(() => nativeCalls("micStop").some(([, o]) => o.id === id1), "隠れたら殻のマイクを止める");
      expect(document.querySelector('button[aria-label="録音を停止"]')).toBe(null);
    } finally { delete document.hidden; }
  }, 30000);

  it("Web: 殻のメソッドを1回も呼ばない・getUserMedia と AudioContext と play-and-record は今のまま", async () => {
    defineAudioSession();
    try {
      mod = await loadApp();
      await render();
      await waitFor(() => gum >= 1, "getUserMedia");
      const ctx = await openMetroAndStart();
      expect(ctx.master.gain.value).toBe(2.6);
      await settle();
      expect(cap.native).toEqual([]);
      expect(masterGains.some((c) => c.isMic)).toBe(true);
      expect(navigator.audioSession.type).toBe("play-and-record");
    } finally { dropAudioSession(); }
  }, 30000);
});

// ------------------------------------------------------------------
// 【便CS 2026-10-13】マイクはいつも端末の内蔵マイク(本人の実機の板: Bluetooth のイヤホンで in = out = BluetoothHFP・outputVolume 0.15)。
// 【守っているもの】作り物の mediaDevices の上で: 許可の後に内蔵マイクを探して deviceId exact で取り直す(制約 ec/ns/agc は false のまま)・
//   見つからなければ取り直さない・殻は機器の一覧が変わったら routeToSpeaker(ネイティブが入力を本体のマイクへ戻す)を呼び JS では取り直さない・
//   Web は取り込み中に内蔵マイクから外れたら取り直す(devicechange 1回につき1回まで)・診断の板の新しい項目(inputs / preferredIn / micTrack)。
// 【守っていないもの】実機の WebKit が exact を setPreferredInput に替えること・ネイティブの setPreferredInput が効くこと・出力が A2DP /
//   スピーカーへ行くこと・音量が戻ること(どれも実機待ち。Swift はここでは走らない。綴りは pitch-test K.6 が見る)。
// ------------------------------------------------------------------
const MIC_C = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
// 作り物の mediaDevices。getUserMedia は exact があればその機器、無ければ既定(box.defaultId)のトラックを返す。
// トラックの deviceId を書き換えると、WebKit が取り込み中に入力を替えた(handleNewCurrentMicrophoneDevice)形になる。
function installDevices(devices, defaultId) {
  const listeners = new Set();
  const box = { calls: [], devices, defaultId, tracks: [] };
  const labelOf = (id) => box.devices.find((d) => d.deviceId === id)?.label ?? "";
  const makeTrack = (id) => {
    const t = { enabled: true, readyState: "live", muted: false, kind: "audio", deviceId: id, stopped: 0,
      get label() { return labelOf(this.deviceId); },
      stop() { this.stopped++; this.readyState = "ended"; },
      getSettings() { return { deviceId: this.deviceId, ...MIC_C }; } };
    box.tracks.push(t);
    track = t;
    return t;
  };
  const md = {
    getUserMedia: async (c) => {
      box.calls.push(c);
      // 待たせる(完全に取り直す待ちの間にタブを離れる形)。box.queue があれば呼ばれた順に1つずつ使う({ gate, fails })
      const q = box.queue && box.queue.length ? box.queue.shift() : null;
      const gate = q ? q.gate : box.gate;
      const fails = q ? q.fails : box.gateFails;
      if (gate) {
        await gate;
        if (fails) throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      }
      const t = makeTrack(c?.audio?.deviceId?.exact || box.defaultId);
      return { getTracks: () => [t], getAudioTracks: () => [t] };
    },
    enumerateDevices: async () => box.devices.map((d) => ({ kind: "audioinput", groupId: "", ...d })),
    addEventListener: (type, fn) => { if (type === "devicechange") listeners.add(fn); },
    removeEventListener: (type, fn) => { listeners.delete(fn); },
  };
  box.fire = () => mod.act(async () => { listeners.forEach((fn) => fn()); });
  box.live = () => box.tracks.filter((t) => t.readyState === "live");
  Object.defineProperty(window.navigator, "mediaDevices", { value: md, configurable: true });
  return box;
}
const BT_D = { deviceId: "bt0000000000aaaa", label: "AirPods Pro" };
const MIC_D = { deviceId: "mic1abcdef012345", label: "iPhone マイク" };
const exactCall = (id) => ({ audio: { ...MIC_C, deviceId: { exact: id } } });
// iOS / iPadOS の WebKit の形: 指で触れる(maxTouchPoints)+ navigator.audioSession(Audio Session API)。label の道はこの形のときだけ通る
const setTouch = (n) => {
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: n, configurable: true });
  Object.defineProperty(window.navigator, "audioSession", { value: { type: "auto" }, configurable: true, writable: true });
};
const clearTouch = () => {
  try { delete window.navigator.maxTouchPoints; } catch { /* */ }
  try { delete window.navigator.audioSession; } catch { /* */ }
};

describe("【便CS】マイクはいつも内蔵マイク(取り直し・見つからないとき・経路が変わったとき)", () => {
  it("Web: Bluetooth のイヤホンが既定 → 許可の後に内蔵マイクの deviceId exact で取り直す(制約は ec/ns/agc = false のまま)・元のトラックは止める", async () => {
    setTouch(5);
    try {
      const box = installDevices([BT_D, MIC_D], BT_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => box.calls.length >= 2 && document.querySelector('button[aria-label="メトロノーム"]'), "取り直し");
      await settle();
      expect(box.calls).toEqual([{ audio: MIC_C }, exactCall(MIC_D.deviceId)]);
      expect(box.tracks[0].stopped).toBe(1);
      expect(box.live().map((t) => t.label)).toEqual(["iPhone マイク"]);
    } finally { clearTouch(); }
  }, 30000);
  it("Web: 内蔵マイクが見つからなければ今のまま(getUserMedia は1回・止めない)", async () => {
    setTouch(5);
    try {
      const box = installDevices([BT_D, { deviceId: "wired0000000000", label: "ヘッドセットマイク" }], BT_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => box.calls.length >= 1 && document.querySelector('button[aria-label="メトロノーム"]'), "マイク");
      await settle();
      expect(box.calls).toEqual([{ audio: MIC_C }]);
      expect(box.tracks[0].stopped).toBe(0);
    } finally { clearTouch(); }
  }, 30000);
  // 【便CX】殻は getUserMedia を呼ばない(入力は殻が setPreferredInput builtInMic で本体のマイクに保ち、経路が変われば殻が自分で当て直す)。
  // 便CS の「殻は availableInputs の名前で取り直す」「devicechange で routeToSpeaker」の検査は、その道ごと消えたので置き換えた
  it("殻: getUserMedia を呼ばない(入力は殻が本体のマイクに保つ)。機器の一覧が変わっても(devicechange)JS は殻を呼ばず取り直さない", async () => {
    asShell();
    setTouch(5);
    try {
      cap.session = { availableInputs: [{ portType: "BluetoothHFP", name: "AirPods Pro" }, { portType: "MicrophoneBuiltIn", name: "内蔵のマイク" }] };
      const box = installDevices([BT_D, MIC_D], BT_D.deviceId);
      mod = await loadApp();
      await render();
      await waitMic();
      await settle();
      const before = cap.native.length;
      box.devices = [MIC_D, BT_D];
      await box.fire();
      await settle();
      expect(box.calls).toEqual([]);
      expect(cap.native.length).toBe(before);
      await click(nav("リード"));                                     // 殻はタブを離れるとマイクを止める
      await settle();
      expect(nativeCalls("micStop").length).toBe(1);
      await box.fire();
      await settle();
      expect(box.calls).toEqual([]);
    } finally { clearTouch(); }
  }, 30000);
  it("Web: 取り込み中にイヤホンへ替わったら(devicechange)内蔵マイクで取り直す。iOS が替え続けても、取り直しは devicechange 1回につき1回まで", async () => {
    setTouch(5);
    const orig = performance.now.bind(performance);
    let off = 1e6;                                                    // 復旧のクールダウン(起動直後の 5 秒)を越えた時刻にする
    vi.spyOn(performance, "now").mockImplementation(() => orig() + off);
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => box.calls.length >= 1 && document.querySelector('button[aria-label="メトロノーム"]'), "マイク");
      await settle();
      expect(box.calls).toEqual([{ audio: MIC_C }]);                  // 既定が内蔵マイクなので取り直さない
      box.devices = [MIC_D, BT_D];
      box.defaultId = BT_D.deviceId;
      track.deviceId = BT_D.deviceId;
      await box.fire();
      await waitFor(() => box.calls.length >= 3, "取り直し");
      await settle();
      expect(box.calls).toEqual([{ audio: MIC_C }, { audio: MIC_C }, exactCall(MIC_D.deviceId)]);
      expect(box.live().map((t) => t.label)).toEqual(["iPhone マイク"]);
      // iOS がまたイヤホンへ替えた(configurationchange)→ 同じ devicechange の中ではもう取り直さない。
      // 時計は復旧のクールダウンを越えた所まで進める(クールダウンで止まったのではなく、1回までの歯止めで止まったことを確かめる)
      off += 1e5;
      track.deviceId = BT_D.deviceId;
      await mod.act(async () => { track.onconfigurationchange(); });
      await settle();
      await tick(50);
      expect(box.calls.length).toBe(3);
      // 次の devicechange で歯止めは戻る → また取り直す
      await box.fire();
      await waitFor(() => box.calls.length >= 5, "次の devicechange で取り直す");
      expect(box.calls[4]).toEqual(exactCall(MIC_D.deviceId));
    } finally { clearTouch(); vi.restoreAllMocks(); }
  }, 30000);
  it("Web: 取り込み中に入力が替わった知らせ(トラックの configurationchange)でも取り直す", async () => {
    setTouch(5);
    const orig = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => orig() + 1e6);
    try {
      const box = installDevices([MIC_D, BT_D], MIC_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => box.calls.length >= 1 && document.querySelector('button[aria-label="メトロノーム"]'), "マイク");
      await settle();
      box.defaultId = BT_D.deviceId;
      track.deviceId = BT_D.deviceId;
      await mod.act(async () => { track.onconfigurationchange(); });
      await waitFor(() => box.calls.length >= 3, "取り直し");
      expect(box.calls[2]).toEqual(exactCall(MIC_D.deviceId));
    } finally { clearTouch(); vi.restoreAllMocks(); }
  }, 30000);
});

describe("【便CS】Web: 計測タブを離れている(一時停止)間に替わったら、戻ったときにマイクを再利用せず内蔵マイクで取り直す", () => {
  it("一時停止中は取り直さない(getUserMedia を呼ばない)→ 計測タブへ戻ると完全に取り直して内蔵マイクの deviceId exact", async () => {
    setTouch(5);
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => box.calls.length >= 1 && document.querySelector('button[aria-label="メトロノーム"]'), "マイク");
      await settle();
      await click(nav("リード"));                                     // Web は一時停止(enabled = false・止めない)
      await settle();
      expect(track.enabled).toBe(false);
      box.devices = [MIC_D, BT_D];
      box.defaultId = BT_D.deviceId;
      track.deviceId = BT_D.deviceId;
      await box.fire();
      await settle();
      expect(box.calls.length).toBe(1);
      await click(nav("計測"));
      await waitFor(() => box.calls.length >= 3, "戻ったら取り直す");
      await settle();
      expect(box.calls).toEqual([{ audio: MIC_C }, { audio: MIC_C }, exactCall(MIC_D.deviceId)]);
      expect(box.live().map((t) => t.label)).toEqual(["iPhone マイク"]);
    } finally { clearTouch(); }
  }, 30000);
});

describe("【便CS】診断の板: 入力の候補・優先の入力・使っているマイクのトラック", () => {
  const press = async (ms) => {
    const btn = nav("計測");
    await mod.act(async () => { btn.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await tick(ms);
    await mod.act(async () => { btn.dispatchEvent(new Event("pointerup", { bubbles: true })); btn.click(); });
  };
  const val = (k) => document.querySelector(`[data-audio-diag] [data-diag-key="${k}"]`)?.textContent;
  it("殻: inputs = availableInputs の portType:名前・preferredIn・micTrack = 殻のマイク(label native:builtInMic・id native)", async () => {
    asShell();
    setTouch(5);
    try {
      cap.session = {
        category: "AVAudioSessionCategoryPlayAndRecord", mode: "AVAudioSessionModeDefault", options: 0x28, routeSharingPolicy: 0,
        outputs: ["BluetoothA2DPOutput"], inputs: ["MicrophoneBuiltIn"], outputVolume: 0.5, otherAudioPlaying: false,
        availableInputs: [{ portType: "MicrophoneBuiltIn", name: "iPhone マイク" }, { portType: "BluetoothHFP", name: "AirPods Pro" }],
        preferredInput: { portType: "MicrophoneBuiltIn", name: "iPhone マイク" },
      };
      installDevices([MIC_D, BT_D], MIC_D.deviceId);
      mod = await loadApp();
      await render();
      await waitMic();
      await press(500);
      await waitFor(() => val("inputs") && val("inputs") !== "…", "板", 5000);
      expect(val("inputs")).toBe("MicrophoneBuiltIn:iPhone マイク / BluetoothHFP:AirPods Pro");
      expect(val("preferredIn")).toBe("MicrophoneBuiltIn:iPhone マイク");
      expect(val("micTrack")).toBe("label=native:builtInMic id=native");
    } finally { clearTouch(); }
  }, 30000);
  it("殻: 優先の入力が無い(nil = 空の辞書)は none・古い殻のビルド(項目が無い)は「—」", async () => {
    asShell();
    cap.session = { category: "AVAudioSessionCategoryPlayAndRecord", availableInputs: [], preferredInput: {} };
    mod = await loadApp();
    await render();
    await waitMic();
    await press(500);
    await waitFor(() => val("preferredIn"), "板", 5000);
    expect([val("inputs"), val("preferredIn")]).toEqual(["none", "none"]);
    cap.session = { category: "AVAudioSessionCategoryPlayAndRecord" };
    await waitFor(() => val("inputs") === "—", "古いビルド", 5000);
    expect(val("preferredIn")).toBe("—");
  }, 30000);
});

// ------------------------------------------------------------------
// 【便CS 審査の差し戻し】録音の後・クールダウンの後の取り直し / 殻の録音中の見送り / enabled の条件 / startListening の世代
// ------------------------------------------------------------------
describe("【便CS 審査】録音・クールダウン・世代", () => {
  const routes = () => cap.log.filter((x) => x === "FicusAudioSession.routeToSpeaker").length;
  const toBt = (box) => { box.devices = [MIC_D, BT_D]; box.defaultId = BT_D.deviceId; track.deviceId = BT_D.deviceId; };
  it("Web: 録音中に外れても取り直さない → 録音が終わったら内蔵マイクで取り直す", async () => {
    setTouch(5);
    const orig = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => orig() + 1e6);  // 復旧のクールダウン(起動直後の 5 秒)を越えた時刻にする
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => box.calls.length >= 1 && document.querySelector('button[aria-label="録音する"]'), "録音のボタン");
      await settle();
      await click(document.querySelector('button[aria-label="録音する"]'));
      await waitFor(() => document.querySelector('button[aria-label="録音を停止"]'), "録音中");
      toBt(box);
      await box.fire();
      await settle();
      await tick(50);
      expect(box.calls.length).toBe(1);                               // 録音中は取り直さない
      await click(document.querySelector('button[aria-label="録音を停止"]'));
      await waitFor(() => box.calls.length >= 3, "録音が終わったら取り直す");
      await settle();
      expect(box.calls).toEqual([{ audio: MIC_C }, { audio: MIC_C }, exactCall(MIC_D.deviceId)]);
      expect(box.live().map((t) => t.label)).toEqual(["iPhone マイク"]);
    } finally { clearTouch(); vi.restoreAllMocks(); }
  }, 30000);
  it("Web: クールダウンで断られたら、明けたあとに取り直す", async () => {
    setTouch(5);
    // 時計を差し替える(負荷で前提が崩れないように、実時間に頼らない):
    //   知らせの時は 4000ms で止める = 起動直後のクールダウン(最後の復旧 0ms から 5000ms)の中 → 必ず断られ、予約は残り 1000ms 後。
    //   断られたのを見たら、時計を十分先へ進める → 予約が来たときには必ずクールダウンが明けている。
    const orig = performance.now.bind(performance);
    let mode = "real";
    vi.spyOn(performance, "now").mockImplementation(() => (mode === "freeze" ? 4000 : mode === "late" ? orig() + 1e6 : orig()));
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => box.calls.length >= 1 && document.querySelector('button[aria-label="メトロノーム"]'), "マイク");
      await settle();
      toBt(box);
      mode = "freeze";
      await box.fire();
      await settle();
      expect(box.calls.length).toBe(1);                               // 断られた
      mode = "late";
      await waitFor(() => box.calls.length >= 3, "クールダウンが明けたら取り直す", 12000);
      expect(box.calls[2]).toEqual(exactCall(MIC_D.deviceId));
    } finally { clearTouch(); vi.restoreAllMocks(); }
  }, 30000);
  // 【便CX】殻の「録音中は devicechange から routeToSpeaker を呼ばない」「enabled = false なら呼ばない」の検査は、routeToSpeaker ごと消えた
  // (殻は経路の変化で自分で入力の規則を当て直す)。殻では録音中・録音後も JS は殻を呼ばないことを見る
  it("殻: 録音中に機器の一覧が変わっても、録音が終わっても、JS は殻を呼ばず取り直さない(殻が経路の変化で自分で当て直す)", async () => {
    asShell();
    setTouch(5);
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => micStarts() >= 1 && document.querySelector('button[aria-label="録音する"]'), "録音のボタン");
      await settle();
      await click(document.querySelector('button[aria-label="録音する"]'));
      await waitFor(() => document.querySelector('button[aria-label="録音を停止"]'), "録音中");
      const before = cap.native.length;
      toBt(box);
      await box.fire();
      await settle();
      await click(document.querySelector('button[aria-label="録音を停止"]'));
      await settle();
      await tick(100);
      expect(cap.native.slice(before)).toEqual([]);
      expect(box.calls).toEqual([]);
    } finally { clearTouch(); }
  }, 30000);
  it("殻: マイクを待っている間(OS の許可の画面など)にタブを離れたら、取れた殻のマイクは使わずに止める(同じ id の micStop・案内も出さない)", async () => {
    asShell();
    let release;
    cap.mic.queue = [{ gate: new Promise((r) => { release = r; }) }];
    mod = await loadApp();
    await render();
    await waitFor(() => micStarts() >= 1, "micStart を待っている");
    const id1 = nativeCalls("micStart")[0][1].id;
    await click(nav("リード"));
    await settle();
    await mod.act(async () => { release(); });
    await waitFor(() => nativeCalls("micStop").some(([, o]) => o.id === id1), "取れたマイクを止める");
    await settle();
    expect(cap.feed.id).toBe(null);
    expect(document.body.textContent).not.toContain("マイクの使用が許可されていません");
  }, 30000);
});

// ------------------------------------------------------------------
// 【便CS 再審査】置き換えられた取得(MIC_START_SUPERSEDED)は失敗ではない: 画面復帰・recoverMic は何もしない・古い失敗は新しい成功を上書きしない
// ------------------------------------------------------------------
describe("【便CS 再審査】置き換えられた取得", () => {
  it("殻: 隠れる → 見える → 殻のマイクを待っている間にリードへ → 取得が終わる で、殻のマイクは止まったまま・recoverMic は走らない", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    await settle();
    const diag = await import("../audioDiag.jsx");
    let release;
    try {
      await setHidden(true);
      await settle();
      cap.mic.queue = [{ gate: new Promise((r) => { release = r; }) }];
      await setHidden(false);
      await waitFor(() => micStarts() >= 2, "戻ったら取り直しを待つ");
      await click(nav("リード"));
      await settle();
      await mod.act(async () => { release(); });
      await settle();
      await tick(300);
      await settle();
    } finally { delete document.hidden; }
    expect(cap.feed.id).toBe(null);                                   // 動いている殻のマイクは無い
    expect(micStarts()).toBe(2);                                      // 取り直しの取り直し(recoverMic)をしない
    expect(diag.AUDIO_DIAG.lastMicRecover).toBe(null);
    expect(document.body.textContent).not.toContain("マイクを再接続できませんでした");
  }, 30000);
  it("Web: 隠れる → 見える → 取得を待っている間にリードへ → 取得が終わる で、live のトラックは0本・recoverMic は走らない", async () => {
    setTouch(5);
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => box.calls.length >= 1 && document.querySelector('button[aria-label="メトロノーム"]'), "マイク");
      await settle();
      const diag = await import("../audioDiag.jsx");
      let release;
      try {
        await setHidden(true);
        await settle();
        box.gate = new Promise((r) => { release = r; });
        await setHidden(false);
        await waitFor(() => box.calls.length >= 2, "戻ったら取り直しを待つ");
        await click(nav("リード"));
        await settle();
        box.gate = null;
        await mod.act(async () => { release(); });
        await settle();
        await tick(300);
        await settle();
      } finally { delete document.hidden; }
      expect(box.live().length).toBe(0);
      expect(box.calls.length).toBe(2);                             // 取り直しの取り直し(recoverMic)をしない
      expect(diag.AUDIO_DIAG.lastMicRecover).toBe(null);
      expect(document.body.textContent).not.toContain("マイクを再接続できませんでした");
    } finally { clearTouch(); }
  }, 30000);
  it("Web: 起動の取得を待っている間にリードへ(一時停止)→ 取得が終わっても使わずに止める", async () => {
    setTouch(5);
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      let release;
      box.gate = new Promise((r) => { release = r; });
      mod = await loadApp();
      await render();
      await waitFor(() => box.calls.length >= 1, "getUserMedia を待っている");
      await click(nav("リード"));                                     // Web は一時停止(pauseListening)
      await settle();
      box.gate = null;
      await mod.act(async () => { release(); });
      await settle();
      await tick(100);
      expect(box.live().length).toBe(0);
      expect(box.tracks[0].stopped).toBe(1);
    } finally { clearTouch(); }
  }, 30000);
  it("殻: 古い取得の失敗(待っている間に置き換えられた)は、新しい取得の成功を上書きしない(エラーを出さない・殻のマイクは動いたまま)", async () => {
    asShell();
    let release;
    cap.mic.queue = [{ gate: new Promise((r) => { release = r; }), fail: "denied" }];
    mod = await loadApp();
    await render();
    await waitFor(() => micStarts() >= 1, "1回目の取得を待っている");
    await click(nav("リード"));                                     // 殻は止める(1回目は置き換えられる)
    await settle();
    await click(nav("計測"));                                       // 2回目の取得はすぐ成功する
    await waitFor(() => micStarts() >= 2 && cap.feed.id, "2回目の成功");
    const id2 = nativeCalls("micStart")[1][1].id;
    await settle();
    await mod.act(async () => { release(); });                     // 1回目が今ごろ失敗で終わる
    await settle();
    await tick(100);
    expect(document.body.textContent).not.toContain("マイクの使用が許可されていません");
    expect(cap.feed.id).toBe(id2);
    expect(document.querySelector('button[aria-label="録音する"]')).not.toBe(null);
  }, 30000);
});

describe("【便CS 再審査】recoverMic は計測タブで、画面が見えているときだけ", () => {
  it("Web: リードのタブ(一時停止中)でトラックが mute しても・計測タブでも画面が隠れていれば、マイクを取り直さない。計測タブで見えていれば取り直す", async () => {
    setTouch(5);
    const orig = performance.now.bind(performance);
    vi.spyOn(performance, "now").mockImplementation(() => orig() + 1e6);  // 復旧のクールダウンの外
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => box.calls.length >= 1 && document.querySelector('button[aria-label="メトロノーム"]'), "マイク");
      await settle();
      const t1 = track;
      await click(nav("リード"));                                     // Web は一時停止(トラックとハンドラは残る)
      await settle();
      await mod.act(async () => { t1.onmute(); });
      await settle();
      expect(box.calls.length).toBe(1);
      await click(nav("計測"));
      await settle();
      Object.defineProperty(document, "hidden", { value: true, configurable: true });  // 知らせ(visibilitychange)を出さずに隠れた状態だけ作る
      try {
        await mod.act(async () => { t1.onmute(); });
        await settle();
        expect(box.calls.length).toBe(1);
      } finally { delete document.hidden; }
      await mod.act(async () => { t1.onmute(); });                   // 見えていて計測タブなら取り直す(この試験が空振りでないことの確かめ)
      await waitFor(() => box.calls.length >= 2, "取り直す");
    } finally { clearTouch(); vi.restoreAllMocks(); }
  }, 30000);
});

describe("【便CS 再審査】置き換えられた取得は「失敗」ではない(計測タブで見えたままでも取り直さない)", () => {
  for (const fails of [false, true]) {
    it(`Web: 戻る → 隠れる → 戻る で、1つ目の取得が後から${fails ? "失敗" : "成功"}で終わっても recoverMic は走らない(2つ目が使われる)`, async () => {
      setTouch(5);
      const orig = performance.now.bind(performance);
      vi.spyOn(performance, "now").mockImplementation(() => orig() + 1e6);  // 復旧のクールダウンの外(取り直しが走るなら必ず走る)
      try {
        const box = installDevices([MIC_D], MIC_D.deviceId);
        mod = await loadApp();
        await render();
        await waitFor(() => box.calls.length >= 1 && document.querySelector('button[aria-label="メトロノーム"]'), "マイク");
        await settle();
        const diag = await import("../audioDiag.jsx");
        let relA; let relB;
        box.queue = [
          { gate: new Promise((r) => { relA = r; }), fails },
          { gate: new Promise((r) => { relB = r; }), fails: false },
        ];
        try {
          await setHidden(true);
          await setHidden(false);
          await waitFor(() => box.calls.length >= 2, "1つ目の取得を待つ");
          await setHidden(true);
          await setHidden(false);
          await waitFor(() => box.calls.length >= 3, "2つ目の取得を待つ");
          await mod.act(async () => { relA(); });                    // 1つ目が終わる(もう置き換えられている)
          await settle();
          await tick(100);
          expect(box.calls.length).toBe(3);                           // recoverMic で取り直していない
          expect(diag.AUDIO_DIAG.lastMicRecover).toBe(null);
          await mod.act(async () => { relB(); });
          await waitFor(() => box.live().length === 1, "2つ目が使われる");
          await settle();
          expect(box.calls.length).toBe(3);
          expect(document.body.textContent).not.toContain("マイクの使用が許可されていません");
        } finally { delete document.hidden; }
      } finally { clearTouch(); vi.restoreAllMocks(); }
    }, 30000);
  }
});

// ------------------------------------------------------------------
// 【便CX 審査】殻の除外・小節線・振り子の拍の数を、殻の時計の値(micData の host・metroClicks の h)で確かめる。
// 【守っているもの】除外の予定は殻の host time で積む(perf の時計で積むと、殻の入力の時刻と比べられず除外が効かない)/ 小節線は perf の時計に直して積む
//   (host のミリ秒で積むと録音の開始と比べられず消える)/ 殻が作り直しで拍を飛ばしても・予約し直しても、振り子の拍の数は続く。
// 【守っていないもの】実機の殻の時刻の正しさ(実機待ち)。
// ------------------------------------------------------------------
describe("【便CX 審査】殻の除外・小節線・振り子の拍の数は殻の時計で効く", () => {
  const hostNow = () => performance.now() / 1000 + cap.clock.offsetSec;
  const saveDialog = () => document.querySelector('[aria-label="この録音を保存しますか？"]');
  const startShellMetro = async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    await openMetroShell();
    await waitFor(() => nativeCalls("metroStart").length === 1, "殻で鳴らす");
    return nativeCalls("metroStart")[0][1];
  };
  it("(b) 録音中、殻の入力の時刻がずっとクリックの窓の中なら、フレームを1つも記録しない(保存の確認が出ない)。窓の外なら記録する(出る)", async () => {
    const { run, v } = await startShellMetro();
    await waitFor(() => recButton(), "録音のボタン");
    const t0 = hostNow();
    const clicks = [];
    let n = 0;
    for (let h = t0 - 0.2; h < t0 + 3.0; h += 0.05) clicks.push({ h, s: 0, k: "beat", i: 1, v, n: n++ });
    await emitNative("metroClicks", { run, clicks });
    await click(recButton());
    await waitFor(() => document.querySelector('button[aria-label="録音を停止"]'), "録音中");
    await tick(600);
    await click(recButton());
    await settle();
    expect(saveDialog()).toBe(null);                                     // クリックの窓の中のフレームは記録しない
    while (hostNow() < t0 + 3.2) await tick(50);                         // クリックが過ぎるまで待つ
    await click(recButton());
    await waitFor(() => document.querySelector('button[aria-label="録音を停止"]'), "録音中(2回目)");
    await tick(600);
    await click(recButton());
    await waitFor(() => saveDialog(), "窓の外なら記録する");
  }, 30000);
  it("(c) 録音中に殻がアクセントを知らせると、保存される小節線は録音の開始からの秒", async () => {
    const { run, v } = await startShellMetro();
    await waitFor(() => recButton(), "録音のボタン");
    await settle();
    const recPerf = performance.now();
    await click(recButton());
    await waitFor(() => document.querySelector('button[aria-label="録音を停止"]'), "録音中");
    const hostAtRec = recPerf / 1000 + cap.clock.offsetSec;
    await emitNative("metroClicks", { run, clicks: [
      { h: hostAtRec + 0.3, s: 0, k: "accent", i: 0, v, n: 0 },
      { h: hostAtRec + 0.8, s: 0, k: "accent", i: 0, v, n: 4 },
    ] });
    while (performance.now() - recPerf < 1100) await tick(50);
    await click(recButton());
    await waitFor(() => saveDialog(), "保存の確認");
    await click([...saveDialog().querySelectorAll("button")].find((b) => b.textContent.trim() === "登録"));
    await waitFor(() => fake._peek("windToneLabDB", "sessions")?.size >= 1, "保存");
    const saved = [...fake._peek("windToneLabDB", "sessions").values()];
    expect(saved.length).toBe(1);
    const b = saved[0].barlines;
    expect(b.length).toBe(2);
    expect(Math.abs(b[0] - 0.3)).toBeLessThan(0.05);
    expect(Math.abs(b[1] - 0.8)).toBeLessThan(0.05);
  }, 30000);
  it("作り直しで殻が拍を飛ばしても(skipped)・同じ通し番号で予約し直しても、振り子の拍の数は続く(位相のずれ 10ms 以内)", async () => {
    const { run, v } = await startShellMetro();
    const h0 = hostNow() + 0.05;
    await emitNative("metroClicks", { run, clicks: [{ h: h0, s: 0, k: "accent", i: 0, v, n: 0 }, { h: h0 + 0.5, s: 24000, k: "beat", i: 1, v, n: 1 }] });
    await emitNative("metroClicks", { run, clicks: [
      { h: h0 + 0.5, s: 0, k: "beat", i: 1, v, n: 1 },        // 予約し直した(同じ番号)
      { h: h0 + 1.0, s: -1, k: "skipped", i: 2, v, n: 2 },    // 作り直しの間に過ぎた拍(鳴らさない)
      { h: h0 + 1.5, s: 0, k: "beat", i: 3, v, n: 3 },
    ] });
    const diag = await import("../audioDiag.jsx");
    const phase = diag.AUDIO_DIAG.getMetro().phase;
    const want = 3 + (hostNow() - (h0 + 1.5)) / 0.5;               // 錨は 4 つ目の拍頭(gBeat 3)
    expect(Math.abs(phase - want) * 500).toBeLessThanOrEqual(10);
  }, 30000);
});

// ------------------------------------------------------------------
// 【便CX 再審査】入力の標本化周波数が途中で替わっても(経路の変化で殻が作り直した等)、トラックを終わらせず新しい周波数で解析を続ける。
// 【守っているもの】録音中: 替わった後の塊が録音のフレームに入る(音量が無音の -200dB でない)・殻のマイクを取り直さない /
//   録音していないとき: 替わった後も無音の見張りが取り直さない(解析に塊が入り続けている)・殻のマイクを取り直さない。
// ------------------------------------------------------------------
describe("【便CX 再審査】入力の標本化周波数が途中で替わっても解析を続ける", () => {
  const later = () => { const orig = performance.now.bind(performance); vi.spyOn(performance, "now").mockImplementation(() => orig() + 1e6); };
  const saveDialog = () => document.querySelector('[aria-label="この録音を保存しますか？"]');
  it("録音中に 48k → 44.1k: 替わった後の塊が録音のフレームに入る(音量が出ている)・殻のマイクを取り直さない", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitMic();
    await waitFor(() => recButton(), "録音のボタン");
    await settle();
    await click(recButton());
    await waitFor(() => document.querySelector('button[aria-label="録音を停止"]'), "録音中");
    cap.mic.rate = 44100;                                              // ここから殻は 44.1k の塊を送る(録音の開始の直後)
    await tick(1300);
    await click(recButton());
    await waitFor(() => saveDialog(), "保存の確認");
    await click([...saveDialog().querySelectorAll("button")].find((b) => b.textContent.trim() === "登録"));
    await waitFor(() => fake._peek("windToneLabDB", "sessions")?.size >= 1, "保存");
    const saved = [...fake._peek("windToneLabDB", "sessions").values()][0];
    // 替わってから 0.5 秒より後のフレーム(窓が新しい標本で埋まった後)が、無音(-150dB 以下)でなく記録されている
    const lateFrames = saved.frames.filter((f) => f.t > 0.7);
    expect(lateFrames.length).toBeGreaterThan(0);
    expect(lateFrames.every((f) => f.volumeDb > -150)).toBe(true);
    expect(micStarts()).toBe(1);
  }, 30000);
  it("録音していないとき 48k → 44.1k: 無音の見張りが取り直さない(解析に塊が入り続ける)・殻のマイクを取り直さない", async () => {
    asShell();
    later();
    try {
      mod = await loadApp();
      await render();
      await waitMic();
      await settle();
      cap.mic.rate = 44100;
      await tick(2600);                                                // 途切れ(1000ms)+ 無音の見張り(1500ms)より長く待つ
      const diag = await import("../audioDiag.jsx");
      expect(diag.AUDIO_DIAG.lastMicRecover).toBe(null);
      expect(micStarts()).toBe(1);
      expect(nativeCalls("micStop").length).toBe(0);
    } finally { vi.restoreAllMocks(); }
  }, 30000);
});
