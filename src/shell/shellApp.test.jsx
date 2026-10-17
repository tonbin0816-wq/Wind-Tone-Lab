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
const cap = vi.hoisted(() => ({ log: [], factories: [], session: null, native: [], nativeInfo: null, onInStart: null }));
vi.mock("@capacitor-community/keep-awake", () => {
  cap.factories.push("keep-awake");
  return { KeepAwake: { keepAwake: async () => { cap.log.push("keepAwake"); }, allowSleep: async () => { cap.log.push("allowSleep"); } } };
});
vi.mock("@capacitor/core", () => {
  cap.factories.push("core");
  // 【便CQ】sessionInfo は診断の板が読む。cap.session が無いときは古い殻のビルド(読み出し口が無い)として拒否する
  return { registerPlugin: (name) => ({
    routeToSpeaker: async () => { cap.log.push(`${name}.routeToSpeaker`); return {}; },
    sessionInfo: async () => {
      if (!cap.session) throw Object.assign(new Error("not implemented"), { code: "UNIMPLEMENTED" });
      return cap.session;
    },
    // 【便CT】診断の板の試し口。殻が替えた後のモード(生の値)を返す形の作り物。cap.session があれば mode も書き換える
    setTestMode: async ({ mode }) => {
      cap.log.push(`${name}.setTestMode:${mode}`);
      const raw = `AVAudioSessionMode${mode[0].toUpperCase()}${mode.slice(1)}`;
      if (cap.session) cap.session = { ...cap.session, mode: raw };
      return { mode: raw };
    },
    // 【便CU】試し口「鳴らし方」: 殻の AVAudioEngine の6つ。呼ばれた順と引数を cap.native に控える。nativeAudioInfo は cap.nativeInfo が無ければ古い殻のビルド
    nativeClickLoad: async (o) => { cap.native.push(["load", o]); return { frames: {} }; },
    nativeClickStart: async (o) => { cap.native.push(["start", o]); return { running: true }; },
    nativeClickStop: async (...a) => { cap.native.push(["stop", ...a]); return {}; },
    nativeInputStart: async (...a) => { cap.native.push(["inStart", ...a]); cap.onInStart?.(); return { running: true }; },
    nativeInputStop: async (...a) => { cap.native.push(["inStop", ...a]); return {}; },
    nativeAudioInfo: async () => {
      if (!cap.nativeInfo) throw Object.assign(new Error("not implemented"), { code: "UNIMPLEMENTED" });
      return cap.nativeInfo;
    },
  }) };
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
  cap.log.length = 0; cap.factories.length = 0; cap.session = null; masterGains = [];
  cap.native = []; cap.nativeInfo = null; cap.onInStart = null; // 配列ごと作り直す(試験が push を差し替えることがある)
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

describe("【便CQ】裏から戻ったときのメトロノーム: 止まった状態で戻り、押せば新しい ctx で鳴る", () => {
  for (const shell of [true, false]) {
    it(`${shell ? "殻" : "Web"}: 鳴らしたまま裏へ → 戻ると止まったまま(勝手に予約しない)・古い ctx は閉じる → 押すと新しい ctx を resume して予約する`, async () => {
      if (shell) asShell();
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
  }
  it("ページのキャッシュから戻った(pageshow・persisted)ときも止まっている ctx を閉じる。persisted でない pageshow では閉じない", async () => {
    asShell();
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
  it("鳴らしている ctx には触れない(戻りの知らせだけが来ても、鳴っている ctx を閉じない)", async () => {
    asShell();
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
});

describe("【便CQ】マイクが入っているときのメトロノームの音量(殻)", () => {
  // メトロノームの ctx の resume だけを手で解決できるようにする(マイクの ctx は描画の時点で running なので resume を呼ばない)
  let pending = [];
  const deferMetroResume = () => {
    const P = window.AudioContext.prototype;
    const orig = P.resume;
    P.resume = function () {
      if (this.isMic) return orig.call(this);
      this.resumes = (this.resumes || 0) + 1;
      this.state = "suspended";   // 解決するまでは鳴っていない(本物の resume 待ちと同じ)
      return new Promise((r) => { pending.push({ ctx: this, run: () => { if (this.state !== "closed") this.state = "running"; r(); } }); });
    };
  };
  const routes = () => cap.log.filter((x) => x === "FicusAudioSession.routeToSpeaker").length;
  it("鳴らし始めで1回、鳴り始めた(resume が解決した)後にもう1回 routeToSpeaker を呼ぶ", async () => {
    asShell();
    pending = [];
    deferMetroResume();
    mod = await loadApp();
    await render();
    await waitFor(() => routes() === 1, "マイクの直後");
    await openMetroAndStart();
    await waitFor(() => routes() === 2, "鳴らし始め");
    await settle();
    expect(routes()).toBe(2);                                               // まだ鳴り始めていない間は呼ばない
    expect(pending.length).toBeGreaterThan(0);
    await mod.act(async () => { pending.splice(0).forEach((p) => p.run()); });
    await waitFor(() => routes() === 3, "鳴り始めた後");
  }, 30000);
  it("鳴り始める前に止めたら、あとで resume が解決しても呼ばない", async () => {
    asShell();
    pending = [];
    deferMetroResume();
    mod = await loadApp();
    await render();
    await waitFor(() => routes() === 1, "マイクの直後");
    await openMetroAndStart();
    await waitFor(() => routes() === 2, "鳴らし始め");
    await click(metroToggle());                                              // 止める
    await mod.act(async () => { pending.splice(0).forEach((p) => p.run()); });
    await settle();
    expect(routes()).toBe(2);
  }, 30000);
  it("getUserMedia に渡す制約は音声処理を3つとも切る(echoCancellation / noiseSuppression / autoGainControl = false)", async () => {
    const calls = [];
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async (c) => { calls.push(c); return stream; } }, configurable: true });
    asShell();
    mod = await loadApp();
    await render();
    await waitFor(() => calls.length > 0, "getUserMedia");
    expect(calls[0]).toEqual({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
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

describe("【便CQ 差し戻し】鳴り始めた後の routeToSpeaker は、いまの ctx のときだけ(R4)", () => {
  let pending = [];
  const deferMetroResume = () => {
    const P = window.AudioContext.prototype;
    const orig = P.resume;
    P.resume = function () {
      if (this.isMic) return orig.call(this);
      this.resumes = (this.resumes || 0) + 1;
      this.state = "suspended";
      return new Promise((r) => { pending.push({ ctx: this, run: () => { if (this.state !== "closed") this.state = "running"; r(); } }); });
    };
  };
  const routes = () => cap.log.filter((x) => x === "FicusAudioSession.routeToSpeaker").length;
  it("鳴り始める前に止めて押し直し、別の ctx に替わったあとで古い ctx の resume が解決しても呼ばない。新しい ctx の解決では呼ぶ", async () => {
    asShell();
    pending = [];
    deferMetroResume();
    mod = await loadApp();
    await render();
    await waitFor(() => routes() === 1, "マイクの直後");
    const ctx1 = await openMetroAndStart();
    await waitFor(() => routes() === 2, "1回目の鳴らし始め");
    await click(metroToggle());                                              // 止める
    await click(metroToggle());                                              // 押し直す(ctx1 は suspended なので作り直す)
    await waitFor(() => routes() === 3, "2回目の鳴らし始め");
    await waitFor(() => masterGains.some((c) => c !== ctx1 && c.master), "2つ目の ctx", 5000);
    const ctx2 = masterGains.find((c) => c !== ctx1 && c.master);
    expect(ctx2).toBeTruthy();
    expect(metroToggle().getAttribute("aria-pressed")).toBe("true");
    const p1 = pending.filter((p) => p.ctx === ctx1);
    const p2 = pending.filter((p) => p.ctx === ctx2);
    expect([p1.length, p2.length]).toEqual([1, 1]);
    await mod.act(async () => { p1.forEach((p) => p.run()); });
    await settle();
    expect(routes()).toBe(3);                                               // 古い ctx の解決では呼ばない
    await mod.act(async () => { p2.forEach((p) => p.run()); });
    await waitFor(() => routes() === 4, "新しい ctx の解決で呼ぶ");
  }, 30000);
});

describe("【便CQ 差し戻し】戻ったときに捨てた ctx を二度閉じない(R5: ref を空にする)", () => {
  for (const shell of [true, false]) {
    it(`${shell ? "殻" : "Web"}: 鳴らす → 裏 → 戻る → 押す で、古い ctx の close はちょうど1回・閉じた ctx を閉じ直さない`, async () => {
      if (shell) asShell();
      countCloses();
      mod = await loadApp();
      await render();
      const ctx1 = await openMetroAndStart();
      try {
        await setHidden(true);
        await setHidden(false);
        await settle();
        await waitFor(() => metroToggle(), "メトロノームの面(殻は作り直したあと)");
        await click(metroToggle());
        await waitFor(() => masterGains.some((c) => c !== ctx1 && c.master), "押すと新しい ctx", 5000);
        await settle();
        expect(ctx1.closes).toBe(1);
        expect(window.__closedTwice).toBe(0);
      } finally { delete document.hidden; }
    }, 30000);
  }
});

describe("【便CQ 統括の決定A】裏から戻ったとき: 殻は計測タブの中身を作り直す(タブを離れて戻るのと同じ)・マイクは1回だけ取り直す", () => {
  it("殻: 戻ると MeasureView を作り直す(面のボタンが別の要素になる)・隠れたらトラックを止め、戻ったら getUserMedia はちょうど1回", async () => {
    asShell();
    const gum = countGetUserMedia();
    mod = await loadApp();
    await render();
    await openMetroAndStart();
    await click(metroToggle());                                              // 止めておく
    const before = metroToggle();
    const live = track;
    gum.n = 0;
    try {
      await setHidden(true);
      expect(live.readyState).toBe("ended");                                 // 隠れたらマイクを止める(既存)
      await setHidden(false);
      await waitFor(() => metroToggle() && metroToggle() !== before, "作り直された面", 5000);
      await waitFor(() => gum.n >= 1, "戻ったら取り直す");
      await tick(300);
      expect(gum.n).toBe(1);                                                // 二重に取り直さない
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
    const gum = countGetUserMedia();
    mod = await loadApp();
    await render();
    await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイク");
    gum.n = 0;
    await click(nav("リード"));
    await settle();
    await click(nav("計測"));
    await waitFor(() => gum.n >= 1, "タブで戻る");
    await tick(300);
    const byTab = gum.n;
    try {
      await setHidden(true);
      await setHidden(false);
      await waitFor(() => gum.n >= byTab + 1, "裏から戻る");
      await tick(300);
      expect([byTab, gum.n - byTab]).toEqual([1, 1]);
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
  it("殻: 長押しで開き、音のセッション(category・mode・options・policy・out・outputVolume)・メトロノーム・戻り・マイクを出す。閉じるで消える", async () => {
    asShell();
    cap.session = {
      category: "AVAudioSessionCategoryPlayAndRecord", mode: "AVAudioSessionModeVideoChat",
      options: 0x4 | 0x8 | 0x20 | 0x40, routeSharingPolicy: 1,
      outputs: ["Speaker"], inputs: ["MicrophoneBuiltIn"], outputVolume: 0.8125, otherAudioPlaying: false,
    };
    countGetUserMedia();
    mod = await loadApp();
    await render();
    await openMetroAndStart();
    try {
      await setHidden(true);
      await tick(50);
      await setHidden(false);
    } finally { delete document.hidden; }
    await waitFor(() => metroToggle(), "メトロノームの面");
    await click(metroToggle());                                              // 戻ったあとの START
    expect(panel()).toBe(null);
    await press(500);
    await waitFor(() => panel() && val("category") === "PlayAndRecord", "板と音のセッション", 5000);
    expect(val("mode")).toBe("VideoChat");
    expect(val("options")).toBe("0x6c allowBluetoothHFP defaultToSpeaker allowBluetoothA2DP allowAirPlay");
    expect(val("policy")).toBe("longFormAudio(1)");
    expect(val("out")).toBe("Speaker");
    expect(val("outputVolume")).toBe("0.81");
    expect(val("metro")).toMatch(/^on=yes ctx=running t=\d+\.\d{3}$/);
    expect(val("lastStart")).toMatch(/rebuilt=yes prev=none stalled=no$/);  // 戻ったときに捨てたので、押したときは新しく作った
    expect(val("lastReturn")).toMatch(/ bg=\d+\.\ds #1$/);
    expect(val("mic")).toMatch(/^ctx=running track=live muted=no enabled=yes/);
    expect(val("micSettings")).toBe("ec=no ns=no agc=no");
    await click([...panel().querySelectorAll("button")].find((b) => b.textContent === "閉じる"));
    expect(panel()).toBe(null);
  }, 30000);
  it("短く押しただけ・計測タブ以外では開かない", async () => {
    asShell();
    mod = await loadApp();
    await render();
    await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイク");
    await press(100);
    await settle();
    expect(panel()).toBe(null);
    await click(nav("リード"));
    await settle();
    await press(500);
    await settle();
    expect(panel()).toBe(null);
  }, 30000);
  it("殻のビルドが古い(sessionInfo が無い)と「要ビルド」", async () => {
    asShell();
    cap.session = null;
    mod = await loadApp();
    await render();
    await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイク");
    await press(500);
    await waitFor(() => panel() && /要ビルド/.test(val("session") || ""), "要ビルド", 5000);
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
// 【守っているもの】作り物の殻と Web Audio の上で: mode のボタンが殻の setTestMode へその名前で届き、板の testMode と mode の行に出る /
//   gain のボタンがメトロノームのマスターに 基の値(殻 1.0・Web 2.6)× 倍率 を入れ、止めて鳴らし直しても残る / どちらも保存しない
//   (kv と localStorage が1文字も変わらない・アプリを読み直すと mode は default・倍率は x1)/ 直近のクリックのピークの行が数を出す /
//   Web では mode は n/a。
// 【守っていないもの】実機でモードが本当に替わること・どのモードで大きく聞こえるか・ピークの値が実機の出口と同じか(どれも実機待ち。
//   Swift はここでは走らない。綴りは pitch-test K.6)。
// ------------------------------------------------------------------
describe("【便CT】診断の板の試し口(mode・gain・直近のクリックのピーク)", () => {
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
  const modeBtn = (m) => document.querySelector(`[data-audio-diag] [data-diag-mode="${m}"]`);
  const gainBtn = (x) => document.querySelector(`[data-audio-diag] [data-diag-gain="${x}"]`);
  const saved = () => JSON.stringify({
    kv: [...(fake._peek("windToneLabDB", "kv")?.entries() ?? [])],
    ls: Object.keys(window.localStorage).sort().map((k) => [k, window.localStorage.getItem(k)]),
  });
  const SESSION = {
    category: "AVAudioSessionCategoryPlayAndRecord", mode: "AVAudioSessionModeDefault", options: 0x28, routeSharingPolicy: 0,
    outputs: ["Speaker"], inputs: ["MicrophoneBuiltIn"], outputVolume: 0.3, otherAudioPlaying: false,
  };
  it("殻: mode は setTestMode へ届き板に出る・gain は マスター = 1.0 × 倍率(鳴らし直しても残る)・どちらも保存しない・読み直すと default / x1", async () => {
    asShell();
    cap.session = { ...SESSION };
    mod = await loadApp();
    await render();
    const ctx = await openMetroAndStart();
    expect(ctx.master.gain.value).toBe(1);
    await press(500);
    await waitFor(() => panel() && val("mode") === "Default", "板", 5000);
    expect(val("testMode")).toBe("default → —");
    expect(val("metroGain")).toBe("x1");
    await settle();
    const before = saved();
    await click(gainBtn("1.3"));
    expect(ctx.master.gain.value).toBeCloseTo(1.3, 12);
    await waitFor(() => val("metroGain") === "x1.3", "倍率の行", 3000);
    await click(modeBtn("measurement"));
    await waitFor(() => val("testMode") === "measurement → Measurement" && val("mode") === "Measurement", "モードの行", 3000);
    expect(cap.log.filter((x) => x.startsWith("FicusAudioSession.setTestMode"))).toEqual(["FicusAudioSession.setTestMode:measurement"]);
    // 直近のクリックのピーク(作り物の分析は ±0.001 の雑音を返す)
    await waitFor(() => /^\d\.\d{3} max=\d\.\d{3}$/.test(val("clickPeak") || ""), "ピークの行", 3000);
    // 止めて鳴らし直しても倍率は残る(同じ ctx でも、作り直した ctx でも)
    await click(metroToggle());
    await click(metroToggle());
    await settle();
    const now = masterGains.filter((c) => c.master).at(-1);
    expect(now.master.gain.value).toBeCloseTo(1.3, 12);
    await settle();
    expect(saved()).toBe(before);
    // 読み直す(アプリを開き直す)と default / x1
    await mod.act(async () => root.unmount());
    host.remove();
    masterGains = [];
    cap.session = { ...SESSION };
    mod = await loadApp();
    await render();
    // 面の開閉は保存される(kv の showMetroPanel)ので、開いていればそのまま鳴らす
    await waitFor(() => document.querySelector('button[aria-label="メトロノーム"]'), "計測タブ");
    await settle();
    if (!metroToggle()) await click(document.querySelector('button[aria-label="メトロノーム"]'));
    await waitFor(() => metroToggle(), "メトロノームの面");
    await click(metroToggle());
    await waitFor(() => masterGains.some((c) => c.master), "読み直した ctx", 5000);
    const ctx2 = masterGains.find((c) => c.master);
    expect(ctx2.master.gain.value).toBe(1);
    await press(500);
    await waitFor(() => panel() && val("mode") === "Default", "読み直した板", 5000);
    expect(val("testMode")).toBe("default → —");
    expect(val("metroGain")).toBe("x1");
  }, 40000);
  // 【便CT 審査 統括の裁定】板を閉じたら試し口を元に戻す(gain ×1・殻の mode default)・ピークの読み取り(20ms)を止める・分析の節点を外す
  it("殻: 閉じると gain は x1・mode は default に戻り、ピークの読み取りが止まり、分析の節点がマスターから外れる", async () => {
    asShell();
    cap.session = { ...SESSION };
    mod = await loadApp();
    await render();
    const ctx = await openMetroAndStart();
    // 分析の節点の読み取りの回数と、マスターからの付け外しを控える
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
    await waitFor(() => panel() && val("mode") === "Default", "板", 5000);
    await waitFor(() => reads > 0, "ピークを読み始める", 3000);
    await click(gainBtn("1.6"));
    await click(modeBtn("measurement"));
    await waitFor(() => val("testMode") === "measurement → Measurement", "モードの行", 3000);
    expect(ctx.master.gain.value).toBeCloseTo(1.6, 12);
    await click([...panel().querySelectorAll("button")].find((b) => b.textContent === "閉じる"));
    expect(panel()).toBe(null);
    await settle();
    // 戻し: gain は基の値 × 1、殻へ default を頼む
    expect(ctx.master.gain.value).toBe(1);
    expect(cap.log.filter((x) => x.startsWith("FicusAudioSession.setTestMode")).at(-1)).toBe("FicusAudioSession.setTestMode:default");
    // 片付け: 付けた分析の節点はマスターから外れ、読み取りは止まる
    expect(taps.length).toBeGreaterThan(0);
    expect(taps.every((a) => disc.includes(a))).toBe(true);
    expect(ctx.__metroPeakTap ?? null).toBe(null);
    const atClose = reads;
    await tick(300);
    expect(reads).toBe(atClose);
    // 開き直すと x1 / default のまま
    await press(500);
    await waitFor(() => panel() && val("testMode") === "default → Default" && val("metroGain") === "x1", "開き直した板", 5000);
  }, 40000);
  it("Web: mode は n/a (web)(殻を呼ばない)・gain は マスター = 2.6 × 倍率(鳴らす前に選んでも、新しく組む鎖に当たる)", async () => {
    mod = await loadApp();
    await render();
    await waitFor(() => document.querySelector('button[aria-label="メトロノーム"]'), "計測タブ");
    await press(500);
    await waitFor(() => panel() && val("session") === "n/a (web)", "板", 5000);
    await click(modeBtn("videoRecording"));
    await waitFor(() => val("testMode") === "videoRecording → n/a (web)", "Web のモードの行", 3000);
    // 鳴らす前に x1.6 を選ぶ → START で作る ctx の鎖(getMetroMasterInput)が 2.6 × 1.6 で組まれる
    await click(gainBtn("1.6"));
    const ctx = await openMetroAndStart();
    expect(ctx.master.gain.value).toBeCloseTo(2.6 * 1.6, 12);
    await click(gainBtn("1"));
    expect(ctx.master.gain.value).toBeCloseTo(2.6, 12);
    await click(gainBtn("1.3"));
    expect(ctx.master.gain.value).toBeCloseTo(2.6 * 1.3, 12);
    expect(cap.log.some((x) => x.includes("setTestMode"))).toBe(false);
  }, 30000);
});

// ------------------------------------------------------------------
// 【便CU 2026-10-17】板の試し口「鳴らし方」(web / nativeClick / nativeBoth)。本人の実機: 殻のセッションのモード 5種も ×1/1.3/1.6 も聞こえる音量が変わらなかった。
// 【守っているもの】作り物の殻と Web Audio の上で: nativeClick を選ぶと、描いた3段(base64・sampleRate)を殻へ1回渡し、今のメトロノームの設定の
//   1小節の並び(♩=120・4/4 → 0.5 秒ごとに 強 拍 拍 拍)で殻のクリックを始め、Web のマスターは 0(止めない)/ メトロノームを止めると殻の停止 /
//   web に戻すとマスターは基の値 / nativeBoth は殻の取り込みを始めてから(その時 Web のトラックはまだ live)Web のトラックを stop し、nativeIn を出す・
//   その間の画面のタップでは Web のマイクを取り直さない / 閉じると殻の取り込みとクリックを止め、Web のマイクを取り直す(getUserMedia がもう1回)/
//   Web では試し口も行も出さず、殻の新しいメソッドを1回も呼ばない。
// 【守っていないもの】殻の AVAudioEngine が鳴る・取れる・大きく聞こえること(実機待ち。Swift はここでは走らない。綴りは pitch-test K.14)・
//   描いたクリックの本当の値(作り物の OfflineAudioContext は決まった標本を返すだけ。値の検査は audioDiagNative.test.js、端末の値は板の nativeBuf)。
// ------------------------------------------------------------------
describe("【便CU】診断の板の試し口「鳴らし方」(殻の AVAudioEngine)", () => {
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
  const pbBtn = (p) => document.querySelector(`[data-audio-diag] [data-diag-playback="${p}"]`);
  const closeBtn = () => [...panel().querySelectorAll("button")].find((b) => b.textContent === "閉じる");
  const SESSION = {
    category: "AVAudioSessionCategoryPlayAndRecord", mode: "AVAudioSessionModeDefault", options: 0x28, routeSharingPolicy: 0,
    outputs: ["Speaker"], inputs: ["MicrophoneBuiltIn"], outputVolume: 0.05, otherAudioPlaying: true,
  };
  const INFO = { engineRunning: true, clickOn: true, inputOn: false, lastError: "", configChanges: 0, activated: true };
  // 作り物の OfflineAudioContext: 鎖は組めるだけ。描いた結果は、助走(0.12 秒)の後ろに決まった標本(末尾の 0 は落ちる)
  const RENDERED = [0, 0.5, -0.25, 0, 0];
  const installOffline = () => {
    const node = () => ({ connect: (d) => d, disconnect() {} });
    const p = () => ({ value: 0 });
    window.OfflineAudioContext = class {
      constructor(ch, length, sampleRate) { this.sampleRate = sampleRate; this.length = length; this.destination = node(); }
      createBuffer(ch, len) { const d = new Float32Array(len); return { length: len, getChannelData: () => d }; }
      createBufferSource() { return { ...node(), buffer: null, start() {} }; }
      createBiquadFilter() { return { ...node(), type: "", frequency: p(), Q: p() }; }
      createGain() { return { ...node(), gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
      createDynamicsCompressor() { return { ...node(), threshold: p(), knee: p(), ratio: p(), attack: p(), release: p() }; }
      startRendering() {
        const d = new Float32Array(this.length);
        d.set(RENDERED, Math.round(this.sampleRate * 0.12));
        return Promise.resolve({ getChannelData: () => d });
      }
    };
  };
  const decode = (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return Array.from(new Float32Array(bytes.buffer));
  };
  const names = () => cap.native.map((c) => c[0]);
  afterEach(() => { delete window.OfflineAudioContext; });

  it("殻: nativeClick は描いた3段を渡して今の並びで始め、Web のマスターは 0・止めると停止・web でマスターが戻る・閉じると殻の停止", async () => {
    asShell();
    installOffline();
    cap.session = { ...SESSION };
    cap.nativeInfo = { ...INFO };
    mod = await loadApp();
    await render();
    const ctx = await openMetroAndStart();
    await press(500);
    await waitFor(() => panel() && val("playback") === "web", "板", 5000);
    expect(["web", "nativeClick", "nativeBoth"].every((p) => pbBtn(p))).toBe(true);
    expect(cap.native).toEqual([]);                                          // 選ぶまでは殻のエンジンを1回も呼ばない
    await click(pbBtn("nativeClick"));
    await waitFor(() => names().includes("start"), "殻のクリックの開始", 5000);
    const load = cap.native.find((c) => c[0] === "load")[1];
    expect(load.sampleRate).toBe(48000);
    for (const k of ["accent", "beat", "sub"]) expect(decode(load[k])).toEqual([0, 0.5, -0.25]);
    expect(cap.native.find((c) => c[0] === "start")[1]).toEqual({ stepSec: 0.5, kinds: ["accent", "beat", "beat", "beat"] });
    expect(names().filter((n) => n === "load").length).toBe(1);
    expect(ctx.master.gain.value).toBe(0);                                   // Web のメトロノームはミュート(止めない)
    expect(ctx.state).toBe("running");
    expect(metroToggle().getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => val("playback") === "nativeClick" && val("nativeEngine") === "running=yes act=yes click=yes in=no cfg=0 err=—", "板の行", 5000);
    expect(val("nativeBuf")).toBe("0.500/0.500/0.500 @48000");
    expect(val("outputVolume")).toBe("0.05");
    expect(val("nativeIn")).toBe(undefined);                                 // nativeBoth のときだけ
    // メトロノームを止める → 殻のクリックも止める
    await click(metroToggle());
    await waitFor(() => cap.native.at(-1)?.[0] === "stop", "殻の停止", 3000);
    // 鳴らし直すと、また今の並びで始める(描いた3段は渡し直さない)
    await click(metroToggle());
    await waitFor(() => cap.native.at(-1)?.[0] === "start", "殻の開始(2回目)", 3000);
    expect(names().filter((n) => n === "load").length).toBe(1);
    // 閉じる → 殻のクリックを止め、Web のマスターは基の値へ戻る
    const before = cap.native.length;
    await click(closeBtn());
    expect(panel()).toBe(null);
    await waitFor(() => cap.native.length > before && cap.native.at(-1)[0] === "stop", "閉じたら殻の停止", 3000);
    const now = masterGains.filter((c) => c.master).at(-1);
    await waitFor(() => now.master.gain.value === 1, "殻を止め終わってからマスターが戻る", 3000);
    // 開き直すと web のまま
    await press(500);
    await waitFor(() => panel() && val("playback") === "web", "開き直した板", 5000);
    expect(pbBtn("web").getAttribute("aria-pressed")).toBe("true");
  }, 40000);

  it("殻: web に戻すと殻を止め、マスターは基の値 × 倍率へ戻る", async () => {
    asShell();
    installOffline();
    cap.session = { ...SESSION };
    cap.nativeInfo = { ...INFO };
    mod = await loadApp();
    await render();
    const ctx = await openMetroAndStart();
    await press(500);
    await waitFor(() => panel() && val("playback") === "web", "板", 5000);
    await click(document.querySelector('[data-audio-diag] [data-diag-gain="1.3"]'));
    await click(pbBtn("nativeClick"));
    await waitFor(() => names().includes("start"), "殻のクリックの開始", 5000);
    expect(ctx.master.gain.value).toBe(0);
    await click(pbBtn("web"));
    await waitFor(() => cap.native.at(-1)?.[0] === "stop", "殻の停止", 3000);
    expect(ctx.master.gain.value).toBeCloseTo(1.3, 12);
  }, 40000);

  it("殻: nativeBoth は殻の取り込みを始めてから Web のトラックを stop し nativeIn を出す・その間のタップで取り直さない・閉じると殻を止めてマイクを取り直す", async () => {
    asShell();
    installOffline();
    cap.session = { ...SESSION };
    cap.nativeInfo = { ...INFO };
    const gum = countGetUserMedia();
    mod = await loadApp();
    await render();
    const ctx = await openMetroAndStart();
    await waitFor(() => gum.n >= 1 && track.readyState === "live", "Web のマイク");
    await press(500);
    await waitFor(() => panel() && val("playback") === "web", "板", 5000);
    const live = track;
    const stateAtInStart = [];
    cap.onInStart = () => { stateAtInStart.push(live.readyState); };
    gum.n = 0;
    await click(pbBtn("nativeBoth"));
    await waitFor(() => names().includes("start"), "殻のクリックの開始", 5000);
    expect(names().slice(0, 1)).toEqual(["inStart"]);
    expect(stateAtInStart).toEqual(["live"]);                                // 殻の取り込みを始めた時、Web のトラックはまだ動いている
    expect(live.readyState).toBe("ended");                                   // そのあと Web のトラックを止めた
    expect(live.stopped).toBe(1);
    expect(ctx.master.gain.value).toBe(0);
    cap.nativeInfo = { ...INFO, inputOn: true, inputDb: -42 };
    await waitFor(() => val("playback") === "nativeBoth" && val("nativeIn") === "-42.0 dBFS", "nativeIn の行", 5000);
    expect(val("nativeEngine")).toBe("running=yes act=yes click=yes in=yes cfg=0 err=—");
    // その間、画面のタップ(既存の復旧の入口)でも Web のマイクを取り直さない
    await mod.act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await tick(300);
    expect(gum.n).toBe(0);
    // 閉じる → 殻のクリックを先に止め(二重に鳴らさない)、殻の取り込みを止め、Web のマイクを取り直す
    const before = cap.native.length;
    await click(closeBtn());
    await waitFor(() => names().slice(before).includes("inStop"), "閉じたら殻の取り込みを止める", 5000);
    expect(names().slice(before)).toEqual(["stop", "inStop"]);
    await waitFor(() => gum.n >= 1 && track !== live && track.readyState === "live", "Web のマイクが戻る", 5000);
    await tick(300);
    expect(gum.n).toBe(1);
  }, 40000);

  it("殻: 戻す道で二重に鳴らない — 殻のクリックが止まった時点ではまだ Web のマスターは 0・Web のマイクも取り直していない", async () => {
    asShell();
    installOffline();
    cap.session = { ...SESSION };
    cap.nativeInfo = { ...INFO };
    const gum = countGetUserMedia();
    mod = await loadApp();
    await render();
    const ctx = await openMetroAndStart();
    await waitFor(() => gum.n >= 1, "Web のマイク");
    await press(500);
    await waitFor(() => panel() && val("playback") === "web", "板", 5000);
    await click(pbBtn("nativeBoth"));
    await waitFor(() => names().includes("start"), "殻のクリックの開始", 5000);
    // 殻のクリックの停止が呼ばれた瞬間の Web の状態を控える
    const atStop = [];
    const gumBefore = gum.n;
    const orig = cap.native.push.bind(cap.native);
    cap.native.push = (x) => { if (x[0] === "stop") atStop.push({ master: ctx.master.gain.value, gum: gum.n - gumBefore, inStop: names().includes("inStop") }); return orig(x); };
    await click(pbBtn("web"));
    await waitFor(() => gum.n > gumBefore && track.readyState === "live", "Web のマイクが戻る", 5000);
    await waitFor(() => ctx.master.gain.value === 1, "マスターが戻る", 3000);
    expect(atStop).toEqual([{ master: 0, gum: 0, inStop: false }]);
  }, 40000);

  it("殻: nativeBoth の間に録音を始めると、鳴らし方は web に戻り(殻のクリックと取り込みを止める)、録音のための取得だけでマイクを取る", async () => {
    asShell();
    installOffline();
    cap.session = { ...SESSION };
    cap.nativeInfo = { ...INFO };
    const gum = countGetUserMedia();
    mod = await loadApp();
    await render();
    await openMetroAndStart();
    await waitFor(() => gum.n >= 1, "Web のマイク");
    await press(500);
    await waitFor(() => panel() && val("playback") === "web", "板", 5000);
    await click(pbBtn("nativeBoth"));
    await waitFor(() => names().includes("start") && track.readyState === "ended", "nativeBoth", 5000);
    const before = cap.native.length;
    gum.n = 0;
    await click(recButton());
    await waitFor(() => document.querySelector('button[aria-label="録音を停止"]'), "録音が始まる", 5000);
    await waitFor(() => names().slice(before).includes("inStop"), "殻の取り込みを止める", 5000);
    expect(names().slice(before)).toEqual(["stop", "inStop"]);
    await waitFor(() => val("playback") === "web", "板の表示も web", 3000);
    expect(pbBtn("web").getAttribute("aria-pressed")).toBe("true");
    await tick(300);
    expect(gum.n).toBe(1);                                                   // 録音の開始が取った1回だけ(板の側で二重に取らない)
    expect(track.readyState).toBe("live");
  }, 40000);

  it("殻: 閉じたとき recoverMic がクールダウンで断っても、予備の道(startListening)で Web のマイクが戻る", async () => {
    asShell();
    installOffline();
    cap.session = { ...SESSION };
    cap.nativeInfo = { ...INFO };
    const gum = countGetUserMedia();
    mod = await loadApp();
    const diag = await import("../audioDiag.jsx");
    await render();
    await openMetroAndStart();
    await waitFor(() => gum.n >= 1 && track.readyState === "live", "Web のマイク");
    await press(500);
    await waitFor(() => panel() && val("playback") === "web", "板", 5000);
    // 直前に1回、既存の復旧(トラックの mute)を走らせる → 以後 1 秒(タップの再試行のクールダウン)は recoverMic が断る
    const n0 = gum.n;
    await mod.act(async () => { track.onmute(); });
    await waitFor(() => gum.n > n0 && track.readyState === "live", "既存の復旧が終わる", 3000);
    await tick(20);
    expect(diag.AUDIO_DIAG.lastMicRecover.reason).toBe("track-muted");
    await click(pbBtn("nativeBoth"));
    await waitFor(() => names().includes("inStart") && track.readyState === "ended", "nativeBoth", 3000);
    const n1 = gum.n;
    await click(closeBtn());
    await waitFor(() => gum.n > n1 && track.readyState === "live", "予備の道で Web のマイクが戻る", 3000);
    expect(diag.AUDIO_DIAG.lastMicRecover.reason).toBe("track-muted");     // recoverMic は断った(走っていれば diag-playback-web になる)
    await tick(300);
    expect(gum.n).toBe(n1 + 1);
  }, 40000);

  it("殻のビルドが古い(新しいメソッドが無い)と nativeEngine は「要ビルド」", async () => {
    asShell();
    cap.session = { ...SESSION };
    cap.nativeInfo = null;
    mod = await loadApp();
    await render();
    await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイク");
    await press(500);
    await waitFor(() => panel() && /^n\/a \(要ビルド: UNIMPLEMENTED\)/.test(val("nativeEngine") || ""), "要ビルド", 5000);
  }, 30000);

  it("Web: 鳴らし方の試し口も行も出さず、殻の新しいメソッドを呼ばない", async () => {
    installOffline();
    mod = await loadApp();
    await render();
    const ctx = await openMetroAndStart();
    await press(500);
    await waitFor(() => panel() && val("session") === "n/a (web)", "板", 5000);
    await tick(1200);
    expect(document.querySelector("[data-audio-diag] [data-diag-test='playback']")).toBe(null);
    expect(document.querySelector("[data-audio-diag] [data-diag-playback]")).toBe(null);
    for (const k of ["playback", "nativeEngine", "nativeBuf", "nativeIn"]) expect(val(k)).toBe(undefined);
    expect(cap.native).toEqual([]);
    expect(ctx.master.gain.value).toBeCloseTo(2.6, 12);
    await click(closeBtn());
    await settle();
    expect(cap.native).toEqual([]);
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
  it("殻: 内蔵マイクの名前はネイティブの availableInputs から(label に iPhone が無くても)取り直す", async () => {
    asShell();
    const name = "内蔵のマイク";
    cap.session = { availableInputs: [{ portType: "BluetoothHFP", name: "AirPods Pro" }, { portType: "MicrophoneBuiltIn", name }] };
    const box = installDevices([BT_D, { ...MIC_D, label: name }], BT_D.deviceId);
    mod = await loadApp();
    await render();
    await waitFor(() => box.calls.length >= 2 && cap.log.includes("FicusAudioSession.routeToSpeaker"), "取り直し");
    expect(box.calls).toEqual([{ audio: MIC_C }, exactCall(MIC_D.deviceId)]);
  }, 30000);
  it("殻: 機器の一覧が変わったら(devicechange)殻へ内蔵マイクを求める(routeToSpeaker)。JS では取り直さない。マイクを止めている間は呼ばない", async () => {
    asShell();
    setTouch(5);
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイク");
      await settle();
      const routes = () => cap.log.filter((x) => x === "FicusAudioSession.routeToSpeaker").length;
      const before = routes();
      box.devices = [MIC_D, BT_D];
      box.defaultId = BT_D.deviceId;
      track.deviceId = BT_D.deviceId;                                 // 入力がイヤホンへ替わった
      await box.fire();
      await waitFor(() => routes() === before + 1, "devicechange で routeToSpeaker");
      await settle();
      expect(box.calls.length).toBe(1);                               // 殻はネイティブが戻す。JS は取り直さない
      await click(nav("リード"));                                     // 殻はタブを離れるとマイクを止める
      await settle();
      expect(box.tracks[0].readyState).toBe("ended");
      expect(box.tracks[0].onconfigurationchange).toBe(null);         // 【便CS 審査】止めるときに内蔵マイクの知らせも外す
      const stopped = routes();
      await box.fire();
      await settle();
      expect(routes()).toBe(stopped);
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
  it("殻: inputs = availableInputs の portType:名前・preferredIn・micTrack = label と deviceId の先頭 8 文字", async () => {
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
      await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイク");
      await press(500);
      await waitFor(() => val("inputs") && val("inputs") !== "…", "板", 5000);
      expect(val("inputs")).toBe("MicrophoneBuiltIn:iPhone マイク / BluetoothHFP:AirPods Pro");
      expect(val("preferredIn")).toBe("MicrophoneBuiltIn:iPhone マイク");
      expect(val("micTrack")).toBe("label=iPhone マイク id=mic1abcd");
    } finally { clearTouch(); }
  }, 30000);
  it("殻: 優先の入力が無い(nil = 空の辞書)は none・古い殻のビルド(項目が無い)は「—」", async () => {
    asShell();
    cap.session = { category: "AVAudioSessionCategoryPlayAndRecord", availableInputs: [], preferredInput: {} };
    mod = await loadApp();
    await render();
    await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイク");
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
  it("殻: 録音中は devicechange から routeToSpeaker を呼ばない → 録音が終わったら呼ぶ", async () => {
    asShell();
    setTouch(5);
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker") && document.querySelector('button[aria-label="録音する"]'), "録音のボタン");
      await settle();
      await click(document.querySelector('button[aria-label="録音する"]'));
      await waitFor(() => document.querySelector('button[aria-label="録音を停止"]'), "録音中");
      const before = routes();
      toBt(box);
      await box.fire();
      await settle();
      expect(routes()).toBe(before);
      await click(document.querySelector('button[aria-label="録音を停止"]'));
      await waitFor(() => routes() === before + 1, "録音が終わったら呼ぶ");
      await settle();
      expect(routes()).toBe(before + 1);
    } finally { clearTouch(); }
  }, 30000);
  it("殻: トラックが live でも enabled = false なら devicechange で routeToSpeaker を呼ばない", async () => {
    asShell();
    setTouch(5);
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      mod = await loadApp();
      await render();
      await waitFor(() => cap.log.includes("FicusAudioSession.routeToSpeaker"), "マイク");
      await settle();
      const before = routes();
      track.enabled = false;
      await box.fire();
      await settle();
      expect(routes()).toBe(before);
      track.enabled = true;                                           // 戻せば呼ぶ(この試験が「何も起きない」で通っていないことの確かめ)
      await box.fire();
      await waitFor(() => routes() === before + 1, "enabled なら呼ぶ");
    } finally { clearTouch(); }
  }, 30000);
  it("殻: マイクを待っている間にタブを離れたら、取れたマイクは使わずに止める(routeToSpeaker も呼ばない)", async () => {
    asShell();
    setTouch(5);
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      let release;
      box.gate = new Promise((r) => { release = r; });
      mod = await loadApp();
      await render();
      await waitFor(() => box.calls.length >= 1, "getUserMedia を待っている");
      await click(nav("リード"));
      await settle();
      box.gate = null;
      await mod.act(async () => { release(); });
      await waitFor(() => box.tracks.length >= 1, "マイクが取れた");
      await settle();
      expect(box.tracks[0].readyState).toBe("ended");
      expect(box.tracks[0].stopped).toBe(1);
      expect(cap.log.includes("FicusAudioSession.routeToSpeaker")).toBe(false);
    } finally { clearTouch(); }
  }, 30000);
});

// ------------------------------------------------------------------
// 【便CS 再審査】置き換えられた取得(MIC_START_SUPERSEDED)は失敗ではない: 画面復帰・recoverMic は何もしない・古い失敗は新しい成功を上書きしない
// ------------------------------------------------------------------
describe("【便CS 再審査】置き換えられた取得", () => {
  for (const shell of [true, false]) {
    it(`${shell ? "殻" : "Web"}: 隠れる → 見える → 取得を待っている間にリードへ → 取得が終わる で、live のトラックは0本・recoverMic は走らない`, async () => {
      if (shell) asShell();
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
  }
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
  it("殻: 古い取得の失敗(待っている間に置き換えられた)は、新しい取得の成功を上書きしない(エラーを出さない・マイクは動いたまま)", async () => {
    asShell();
    setTouch(5);
    try {
      const box = installDevices([MIC_D], MIC_D.deviceId);
      let release;
      box.gate = new Promise((r) => { release = r; });
      box.gateFails = true;
      mod = await loadApp();
      await render();
      await waitFor(() => box.calls.length >= 1, "1回目の取得を待っている");
      box.gate = null;
      box.gateFails = false;
      await click(nav("リード"));                                     // 殻は止める(1回目は置き換えられる)
      await settle();
      await click(nav("計測"));                                       // 2回目の取得はすぐ成功する
      await waitFor(() => box.live().length === 1, "2回目の成功");
      await settle();
      await mod.act(async () => { release(); });                     // 1回目が今ごろ失敗で終わる
      await settle();
      await tick(100);
      expect(document.body.textContent).not.toContain("マイクの使用が許可されていません");
      expect(box.live().length).toBe(1);
      expect(document.querySelector('button[aria-label="録音する"]')).not.toBe(null);
    } finally { clearTouch(); }
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
