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
const cap = vi.hoisted(() => ({ log: [], factories: [], session: null }));
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
