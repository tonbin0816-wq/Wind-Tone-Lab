// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";
import { migrateOnboardingDone } from "./onboarding.jsx";

// ------------------------------------------------------------------
// 【便CH 2026-10-10 本人「トラッキングの許可は最初のプライバシーポリシーとかと同じタイミングにして」】
// ATT(トラッキングの許可)は、同意の画面の2枚目で「次へ」を押した直後に、殻でだけ尋ねる。
// **main.jsx が描くのと同じ根(AppRoot)**を描いて確かめる:
//   ・殻: 「次へ」→ 1. 記録(kv の termsConsent)→ 2. ATT を尋ねる(未決定のときだけ)→ 3. 答えが出るまでアプリを描かない → 答えのあとアプリ
//   ・未決定でない(拒否・許可済み)ときは尋ねない
//   ・ATT が失敗しても・返ってこなくても(上限 10 秒 = ATT_FOCUS_WAIT_MAX_MS)アプリへ進む
//   ・Web: 尋ねない(プラグインに何も渡らない)・今までどおり同じ描画でアプリ
//   ・広告を始めるとき: この起動で同意の画面が尋ねていれば尋ねない(状態を読んで npa を決めるだけ)。
//     同意の画面を通らない人(記録がある人)で未決定なら、広告を始めるときに尋ねる(今までどおり)
//   ・見本(?tutorialpreview=1)では尋ねない(本物の状態に触れない)
// 期待値は統括の仕様の文から手で書いた(定数から逆算しない。10 秒は仕様の「上限 10 秒」)。プラグインは作り物(下の vi.mock)。
// 広告を始める検査は、案内が全部済んだ既存の利用者(移行で finish)で描く(帯はマイクの最初の試みのすぐあとに始まる)。
// 【守っていないもの】実機で ATT の画面が同意の画面の上に出ること・iOS が画面を出さずに返す場合の実際の挙動・
//   上限を過ぎたあとも ATT の画面が出ている間にマイクの許可の画面がどう並ぶか(どれも実機待ち)。
// ------------------------------------------------------------------
// 【便DC 2026-10-21】入れたての人は同意のあと、コミュニティの参加の場面から始まる。【便DD】参加を終えるまで下部タブは無く、毎回参加の場面から始まる
// (計測タブへ進むには参加を終える)。参加の場面は作り物のサーバー(サインインして、プロフィールを覚えるだけ。Firebase に触らない・実際のアカウントを作らない)。
const server = vi.hoisted(() => ({ uid: null, profile: null }));
vi.mock("./community/accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => server.uid),
  loadProfile: vi.fn(async () => server.profile),
  saveProfile: vi.fn(async (_uid, doc) => { server.profile = doc; }),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => { server.uid = "me"; return "me"; }),
}));
vi.mock("./community/profile.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return { ...(await orig()), buildProfileDoc: vi.fn(() => ({ doc: { ...kit.MY_PROFILE, ageConfirmed: true } })) };
});
vi.mock("./community/directory.js", async (orig) => ({ ...(await orig()), listPublicUsers: vi.fn(async () => []), publishStats: vi.fn(async () => {}) }));
vi.mock("./community/idealRepo.js", async (orig) => ({ ...(await orig()), listIdeals: vi.fn(async () => []), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) }));
const cap = vi.hoisted(() => ({ log: [], statuses: [], statusThrows: false, requestHangs: false, requestGate: null, consentAtRequest: [] }));
vi.mock("@capacitor-community/keep-awake", () => ({ KeepAwake: { keepAwake: async () => {}, allowSleep: async () => {} } }));
// 【便CX 2026-10-19】殻の計測のマイクは殻の micStart(OS のマイクの許可の画面もここで出る)。殻では getUserMedia を呼ばない。
// 作り物の殻は cap.log に "micStart" を控え、始めたら 40ms ごとに小さな雑音の塊を "micData" で送る(本物の殻と同じく止めるまで。送らないと解析が無音と読み、
// 既存の無音の見張りが取り直しを始める)。MICCTL は門(gate)と失敗(fails)。
const nat = vi.hoisted(() => ({ listeners: {}, feedId: null, timer: null, gate: null, fails: false }));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => {
  const emit = (ev, d) => { for (const fn of [...(nat.listeners[ev] || [])]) fn(d); };
  const chunk = () => { const f = new Float32Array(1024); for (let i = 0; i < f.length; i++) f[i] = (Math.random() - 0.5) * 2e-3; const b = new Uint8Array(f.buffer); let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
  return {
    sessionInfo: async () => { throw Object.assign(new Error("not implemented"), { code: "UNIMPLEMENTED" }); },
    micStart: async (o) => {
      cap.log.push("micStart");
      if (nat.gate) await nat.gate.promise;
      if (nat.fails) throw Object.assign(new Error("denied"), { code: "DENIED" });
      nat.feedId = o.id;
      if (!nat.timer) nat.timer = setInterval(() => { if (nat.feedId) emit("micData", { id: nat.feedId, pcm: chunk(), sample: 0, host: performance.now() / 1000, rate: 48000, frames: 1024 }); }, 40);
      return { sampleRate: 48000 };
    },
    micStop: async (o) => { if (nat.feedId === o.id) nat.feedId = null; return { stopped: true }; },
    metroLoad: async () => ({}), metroStart: async () => ({ running: true }), metroUpdate: async () => ({ running: true }), metroStop: async () => ({ stopped: true }),
    audioClock: async () => ({ host: performance.now() / 1000, sampleRate: 48000 }),
    audioInfo: async () => ({}),
    addListener: async (ev, fn) => { (nat.listeners[ev] ||= []).push(fn); return { remove: async () => { nat.listeners[ev] = (nat.listeners[ev] || []).filter((f) => f !== fn); } }; },
  };
} }));
vi.mock("@capacitor-community/admob", async (importOriginal) => {
  const real = await importOriginal();
  const rec = (name, ret) => async () => { cap.log.push(name); return ret?.(); };
  return {
    ...real,
    AdMob: {
      initialize: rec("initialize"),
      // 答えは cap.statuses の順に返す(最後の1つは残り続ける)
      trackingAuthorizationStatus: rec("trackingAuthorizationStatus", () => {
        if (cap.statusThrows) throw new Error("trackingAuthorizationStatus can't get status");
        return { status: cap.statuses.length > 1 ? cap.statuses.shift() : cap.statuses[0] };
      }),
      requestTrackingAuthorization: rec("requestTrackingAuthorization", () => {
        cap.consentAtRequest.push(cap.peekConsent?.() ?? null);
        if (cap.requestHangs) return new Promise(() => {});   // 返ってこない
        if (cap.requestGate) return cap.requestGate.promise;   // 答えるまで待つ
        return {};
      }),
      addListener: async () => ({ remove() {} }),
      showBanner: rec("showBanner"),
      hideBanner: rec("hideBanner"),
      resumeBanner: rec("resumeBanner"),
    },
  };
});

const W = 375; const H = 812;
let fake; let host; let mod; let root; let realRect; let realFetch; let gum;

async function loadApp() {
  vi.resetModules();
  globalThis.indexedDB = fake;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("./App.jsx");
  const gate = await import("./ConsentScreen.jsx");
  return { React, act: React.act, createRoot, AppRoot: gate.default, openIdb: App.openIdb, warm: App.warmPersistedStateCache };
}
const kv = (key) => fake._peek("windToneLabDB", "kv")?.get(key);
async function seed(kvEntries = {}) {
  const db = await mod.openIdb();
  db.close?.();
  for (const [k, v] of Object.entries(kvEntries)) fake._peek("windToneLabDB", "kv").set(k, structuredClone(v));
}
async function launch() {
  await mod.warm();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = mod.createRoot(host);
  await mod.act(async () => { root.render(mod.React.createElement(mod.AppRoot)); });
}
const tick = (ms = 10) => mod.act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function waitFor(pred, label, deadline = 10000) {
  const end = Date.now() + deadline;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label} log=${JSON.stringify(cap.log)}`);
    await tick();
  }
}
const screen = () => document.querySelector("[data-consent-screen]");
const step = () => screen()?.getAttribute("data-consent-step") ?? null;
const navBar = () => document.querySelector("[data-bottom-nav]");
const click = (el) => mod.act(async () => { el.click(); });
const count = (name) => cap.log.filter((x) => x === name).length;
// 【便DC・便DD】参加の場面を通って計測タブへ(カード → プロフィールの入力 → 「プロフィールを作る」→ 自動で計測タブ)。参加するまで下部タブは無い
// 【便DE】参加の場面 = 同意のあといきなり出るプロフィールの入力(「プロフィールを作る」のボタンがあるフォーム)
const sceneForm = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "プロフィールを作る");
async function joinNow() {
  await waitFor(() => sceneForm(), "参加の場面(プロフィールの入力)");
  await click(sceneForm());
  await waitFor(() => navBar(), "計測タブ(下部タブ)");
  await waitFor(() => kv("onboardingDone")?.join === true, "join の印");
}
const asShell = () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" }; };
// 1枚目 → 2枚目 → チェック → 次へ(アプリを待たない。待ち方は各検査が決める)
async function agreeAndNext() {
  await click(document.querySelector("[data-consent-start]"));
  await waitFor(() => step() === "terms", "2枚目");
  await click(screen().querySelector('input[type="checkbox"]'));
  await click(document.querySelector("[data-consent-next]"));
}

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
  const track = { enabled: true, readyState: "live", muted: false, kind: "audio", stop() {}, getSettings() { return {}; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  gum = 0;
  Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => { gum += 1; cap.log.push("getUserMedia"); return stream; } }, configurable: true });
  Object.defineProperty(window.navigator, "wakeLock", { value: { request: async () => ({ release() {}, addEventListener() {} }) }, configurable: true });
}

beforeEach(() => {
  fake = createFakeIndexedDb();
  server.uid = null; server.profile = null;
  cap.log.length = 0; cap.statuses = ["notDetermined", "denied"]; cap.statusThrows = false; cap.requestHangs = false; cap.requestGate = null;
  cap.consentAtRequest.length = 0;
  cap.peekConsent = () => kv("termsConsent") ?? null;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-tutorial-preview");
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = () => {};
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    const r = realRect.call(this);
    if (!this.classList?.contains("coach-card")) return r;
    return { left: 22, top: 0, width: W - 44, height: 146, right: W - 22, bottom: 146, x: 22, y: 0 };
  };
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const name = String(url).replace(/^\//, "");
    if (!/^(terms|privacy)\.html$/.test(name)) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => readFileSync(join(process.cwd(), "public", name), "utf8") };
  };
  installFakeMic();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  // 注入したものを個別に片付ける
  window.Element.prototype.getBoundingClientRect = realRect;
  globalThis.fetch = realFetch;
  delete window.Capacitor;
  delete window.AudioContext;
  try { delete window.navigator.mediaDevices; } catch { /* */ }
  try { delete window.navigator.wakeLock; } catch { /* */ }
  document.documentElement.style.removeProperty("--ad-h");
  document.documentElement.removeAttribute("data-ad-hold");
  document.documentElement.removeAttribute("data-tutorial-preview");
  delete cap.peekConsent;
  if (nat.timer) { clearInterval(nat.timer); nat.timer = null; }
  nat.feedId = null; nat.listeners = {}; nat.gate = null; nat.fails = false;
  delete document.visibilityState;   // 上の1つの検査が置いた見え方を個別に外す(置いていなければ何もしない)
  vi.restoreAllMocks();
});

// 案内が全部済んだ既存の利用者(計測が1件ある人の移行の結果。finish を含む。参加の印 join は無い = 同意の画面は出る)
const EXISTING = migrateOnboardingDone({}, { sessions: [{ id: "s1" }] });
const REC = { at: "2026-10-08T00:00:00.000Z", version: "2026-10-08" };

describe("殻: 「次へ」→ 記録 → ATT → 答えのあとアプリ", () => {
  it("未決定なら尋ね、答えるまでは2枚目のまま(アプリ・マイクは無い)。尋ねる時には記録が書かれている。答えたらアプリへ", async () => {
    asShell();
    let answer;
    cap.requestGate = { promise: new Promise((r) => { answer = r; }) };
    mod = await loadApp();
    await launch();
    expect(step()).toBe("welcome");
    await agreeAndNext();
    await waitFor(() => count("requestTrackingAuthorization") === 1, "ATT を尋ねる");
    expect(cap.log).toEqual(["trackingAuthorizationStatus", "requestTrackingAuthorization"]);
    expect(cap.consentAtRequest[0]).toEqual(expect.objectContaining({ version: "2026-10-08" }));   // 1. 記録 → 2. ATT
    for (let i = 0; i < 30; i++) await tick(10);   // 答えないまま 300ms 以上
    expect(step()).toBe("terms");
    expect(navBar()).toBe(null);
    expect(gum).toBe(0);
    expect(count("micStart")).toBe(0);
    await mod.act(async () => { answer({}); });
    await waitFor(() => sceneForm(), "答えのあとアプリ(参加の場面)");
    expect(screen()).toBe(null);
    expect(cap.log.slice(0, 3)).toEqual(["trackingAuthorizationStatus", "requestTrackingAuthorization", "trackingAuthorizationStatus"]);
    // 【便DC】答えのあとは参加の場面(コミュニティ)。マイクの許可の画面は ATT のあとの計測タブへ入るまで出ない(重ならない)
    await waitFor(() => sceneForm(), "参加の場面");
    for (let i = 0; i < 10; i++) await tick(10);
    expect(count("micStart")).toBe(0);
    expect(navBar()).toBe(null);   // 【便DD】参加を終えるまで下部タブは無い
    await joinNow();
    await waitFor(() => count("micStart") > 0, "マイク");
  }, 30000);

  it("未決定でない(拒否済み)なら尋ねない。状態を読んだらアプリへ", async () => {
    asShell();
    cap.statuses = ["denied"];
    mod = await loadApp();
    await launch();
    await agreeAndNext();
    await waitFor(() => sceneForm(), "アプリ(参加の場面)");
    expect(count("trackingAuthorizationStatus")).toBe(1);
    expect(count("requestTrackingAuthorization")).toBe(0);
    await waitFor(() => kv("termsConsent"), "記録");
  }, 30000);

  it("ATT が失敗しても(状態が読めない)アプリへ進む", async () => {
    asShell();
    cap.statusThrows = true;
    mod = await loadApp();
    await launch();
    const t0 = Date.now();
    await agreeAndNext();
    await waitFor(() => sceneForm(), "失敗のあとアプリ(参加の場面)", 5000);
    expect(Date.now() - t0).toBeLessThan(5000);   // 上限を待たずに進む
    expect(count("requestTrackingAuthorization")).toBe(0);
    await waitFor(() => kv("termsConsent"), "記録");
  }, 30000);

  it("ATT が返ってこなくても、上限 10 秒でアプリへ進む(それより前は2枚目のまま)", async () => {
    asShell();
    cap.requestHangs = true;
    mod = await loadApp();
    await launch();
    await agreeAndNext();
    await waitFor(() => count("requestTrackingAuthorization") === 1, "ATT を尋ねる");
    const t0 = Date.now();
    await waitFor(() => Date.now() - t0 > 8500, "8.5 秒", 9500);
    expect(step()).toBe("terms");
    expect(sceneForm()).toBeUndefined();
    await waitFor(() => sceneForm(), "上限のあとアプリ(参加の場面)", 6000);
    expect(Date.now() - t0).toBeLessThan(12500);
  }, 40000);
});

describe("Web: 尋ねない", () => {
  it("「次へ」で同じ描画のうちにアプリ。プラグインに何も渡らない", async () => {
    mod = await loadApp();
    await launch();
    await agreeAndNext();
    expect(screen()).toBe(null);   // 待たずにアプリ(今までどおり。同じ描画のうちに同意の画面は消える)
    // 【便DC】アプリは参加の場面(コミュニティ)から始まる。マイクは参加を終えて計測タブへ入ってから
    await waitFor(() => sceneForm(), "参加の場面");
    expect(gum).toBe(0);
    await joinNow();
    await waitFor(() => gum > 0, "マイク");
    for (let i = 0; i < 20; i++) await tick(10);
    expect(cap.log).toEqual(["getUserMedia"]);
  }, 30000);
});

describe("殻: 広告を始めるとき(案内が全部済んだ既存の利用者 = マイクの最初の試みのすぐあとに帯を始める)", () => {
  it("同意の画面で決まっていれば、帯を始めるときは尋ねない(状態を読むだけ)。許可なら npa false", async () => {
    asShell();
    cap.statuses = ["notDetermined", "authorized"];
    mod = await loadApp();
    await seed({ onboardingDone: EXISTING });
    await launch();
    await agreeAndNext();
    await joinNow();   // 【便DD】参加するまで計測タブ(マイク・帯)へ進まない
    await waitFor(() => count("showBanner") === 1, "帯");
    // 【便DD】参加の場面を出た直後は広告の止めが1秒残る(useCoachAdHold の戻し。参加の場面の間 engage していた)ので、始めた帯はすぐ隠れる(hideBanner)。始め方の並びは先頭の7つ
    expect(cap.log.slice(0, 7)).toEqual([
      "trackingAuthorizationStatus", "requestTrackingAuthorization", "trackingAuthorizationStatus",   // 同意の画面
      "micStart", "initialize", "trackingAuthorizationStatus", "showBanner",                       // 帯(尋ねない)
    ]);
  }, 30000);

  it("同意の画面で尋ねても未決定のまま(iOS が画面を出さなかった)なら、この起動の帯では尋ねない・尋ね直さない(npa)", async () => {
    asShell();
    cap.statuses = ["notDetermined"];   // ずっと未決定
    // 尋ね直しの待ち(見えていてフォーカスがある)が最初からそろっている状態にする。そろわないと尋ね直しが 10 秒待って
    // 尋ねないので、「尋ね直さない」の検査が何も守らなくなる(変異試験で確かめた)
    Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
    vi.spyOn(document, "hasFocus").mockImplementation(() => true);
    mod = await loadApp();
    await seed({ onboardingDone: EXISTING });
    await launch();
    await agreeAndNext();
    await joinNow();
    await waitFor(() => count("showBanner") === 1, "帯");
    for (let i = 0; i < 25; i++) await tick(100);   // 尋ね直しの待ち 1.5 秒より長く見る
    expect(count("requestTrackingAuthorization")).toBe(1);   // 同意の画面の1回だけ
  }, 30000);

  it("同意の画面を通らない人(記録がある)で未決定なら、帯を始めるときに尋ねる", async () => {
    asShell();
    cap.statuses = ["notDetermined", "denied"];
    mod = await loadApp();
    await seed({ onboardingDone: { ...EXISTING, join: true }, termsConsent: REC });   // 【便DD】参加済み(join)= 参加の場面を通らず計測タブから
    await launch();
    expect(screen()).toBe(null);
    await waitFor(() => count("showBanner") === 1, "帯");
    expect(cap.log).toEqual(["micStart", "initialize", "trackingAuthorizationStatus", "requestTrackingAuthorization", "trackingAuthorizationStatus", "showBanner"]);
  }, 30000);
});

describe("見本(?tutorialpreview=1)", () => {
  it("殻でも同意の画面では尋ねない(本物の状態に触れない。今までどおり)", async () => {
    asShell();
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp();
    await launch();
    await agreeAndNext();
    await waitFor(() => sceneForm(), "見本のアプリ(参加の場面)");
    for (let i = 0; i < 20; i++) await tick(10);
    expect(count("requestTrackingAuthorization")).toBe(0);
    expect(count("trackingAuthorizationStatus")).toBe(0);
  }, 30000);
});

// ------------------------------------------------------------------
// 【便CJ 2026-10-10 本人の実機の指摘「チュートリアルをいくつか飛ばしてると最後の計測しよう!が出なくなって一生広告でない」】
// main.jsx と同じ根(AppRoot)から、広告の帯を始める時機を確かめる(プラグインは作り物)。
//   (b) 2回目の起動: 同意の記録があり、前の起動で案内のカードが出ていれば、案内が残っていてもマイクの試みの直後に始める
//   【統括の裁定】(b) を広げた: 初めて案内のカードが出たあと、アプリが裏に回って 30 分(RELAUNCH_AFTER_HIDDEN_MS)以上たってから前に戻ったら2回目の起動。
//   (iOS はアプリを閉じずに裏に残すので本当の起動が来ない。初版の「案内が 10 秒出ないと始める」(c)は、案内の途中で帯が出るので外した)
// 期待値は統括の裁定の文(「29 分では始まらない・31 分で始まる・本当の2回目の起動でも始まる」)から手で書いた。
// 裏に回る・戻るは document.hidden と visibilitychange で作り、時刻は Date.now を作り物にして進める(30 分を本当には待たない)。
// 【守っていないもの】実機の殻で本物の AdMob の帯が出ること・iOS がアプリを本当に閉じて開き直したか(判定不能・実機待ち)。
// ------------------------------------------------------------------
const GATES_CJ = { migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true };
describe("【便CJ】広告の帯を始める時機(根から)", () => {
  it("(b) 入れたての1回目の起動: 同意 → 案内のカードが出ても帯は始めない(印 onboardingShown が立つ)。開き直した2回目は、案内が残っていてもマイクの直後に始める", async () => {
    asShell();
    cap.statuses = ["notDetermined", "denied", "denied", "denied"];
    mod = await loadApp();
    await launch();
    await agreeAndNext();
    await joinNow();   // 【便DC・便DD】参加の場面を通って計測タブへ
    await waitFor(() => count("micStart") >= 1, "マイク");
    // jsdom は的の矩形を持たないので、穴なしの到着カード(リードタブの「ここはリードタブ」)で「案内のカードが出た」を作る
    await click(document.querySelector('button[aria-label="リード"]'));
    await waitFor(() => document.querySelector('[data-coach-layer="arriveReeds"]'), "到着「ここはリードタブ」");
    await waitFor(() => kv("onboardingShown") === true, "初めて案内が出た起動の印");
    for (let i = 0; i < 20; i++) await tick(10);
    expect(count("showBanner")).toBe(0);
    expect(document.documentElement.getAttribute("data-ad-hold")).toBe("1");
    // 開き直す(モジュールごと作り直す。kv は同じ作り物)
    await mod.act(async () => root.unmount());
    root = null; host?.remove();
    cap.log.length = 0;
    mod = await loadApp();
    await launch();
    expect(screen()).toBe(null);   // 同意の記録があるので同意の画面は出ない
    await waitFor(() => count("showBanner") === 1, "2回目の起動の帯");
    expect(cap.log.slice(0, 2)).toEqual(["micStart", "initialize"]);
    expect(kv("onboardingDone").finish).toBeUndefined();   // 案内は終わっていない
    expect(document.documentElement.getAttribute("data-ad-hold")).toBe(null);
  }, 40000);

  it("裏に回って 29 分で戻っても始めない・31 分で戻ると始める。案内のカードが出る前に裏に回った分は数えない", async () => {
    asShell();
    cap.statuses = ["notDetermined", "denied", "denied", "denied"];
    const MIN = 60 * 1000;
    let clock = Date.UTC(2026, 9, 10, 3, 0, 0);
    const realNow = Date.now.bind(Date);
    const base = realNow();
    vi.spyOn(Date, "now").mockImplementation(() => clock + (realNow() - base));
    let hidden = false;
    Object.defineProperty(document, "hidden", { get: () => hidden, configurable: true });
    const away = async (minutes) => {
      hidden = true;
      await mod.act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      clock += minutes * MIN;
      hidden = false;
      await mod.act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      for (let i = 0; i < 20; i++) await tick(10);
    };
    try {
      mod = await loadApp();
      await launch();
      await agreeAndNext();
      await joinNow();   // 【便DC・便DD】参加の場面を通って計測タブへ
      await waitFor(() => count("micStart") >= 1, "マイク");
      // 案内のカードがまだ出ていない(jsdom は ① の的を測れない)うちに 31 分裏に回っても、数えない
      expect(kv("onboardingShown")).toBeUndefined();
      await away(31);
      expect(count("showBanner")).toBe(0);
      // 到着カード(穴なし)で「案内のカードが出た」を作る
      await click(document.querySelector('button[aria-label="リード"]'));
      await waitFor(() => document.querySelector('[data-coach-layer="arriveReeds"]'), "到着「ここはリードタブ」");
      await waitFor(() => kv("onboardingShown") === true, "初めて案内が出た印");
      await away(29);
      expect(count("showBanner")).toBe(0);
      expect(document.documentElement.getAttribute("data-ad-hold")).toBe("1");
      await away(31);
      await waitFor(() => count("showBanner") === 1, "31 分で帯");
      // 【便CO 2026-10-12 本人の実機指示】到着カードがまだ画面にあるので、始めた帯は隠し、印も付けたまま
      expect(document.querySelector('[data-coach-layer="arriveReeds"]')).not.toBe(null);
      await waitFor(() => count("hideBanner") === 1, "カードの間は帯を隠す");
      expect(document.documentElement.getAttribute("data-ad-hold")).toBe("1");
      // カードを押して閉じる(jsdom は ⑥ の的を測れないので次のカードは出ない)→ 少し置いて戻る
      await click(document.querySelector('[data-coach-hit="all"]'));
      await waitFor(() => document.documentElement.getAttribute("data-ad-hold") === null, "カードが閉じたら戻す");
      await waitFor(() => count("resumeBanner") === 1, "resumeBanner");
      expect(kv("onboardingDone").finish).toBeUndefined();   // 案内は終わっていない
    } finally {
      delete document.hidden;
    }
  }, 40000);
});
