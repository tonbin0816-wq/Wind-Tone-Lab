// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便CB 2026-10-08 本人の依頼】起動の最初の同意の画面(src/ConsentScreen.jsx の AppRoot)。
// **main.jsx が描くのと同じ根(AppRoot)**を描いて確かめる(アプリ単体 WindToneLabPhaseMode を描くのではない)。
//   ・入れたての人: 同意の画面だけが出る(下部タブ・案内・マイクの取得は無い)。チェックするまで「はじめる」は押せない
//   ・規約の導線はアプリの中のシートを開く(チェックは入らない)
//   ・チェック → 「はじめる」で、kv に { at, version } が書かれ、アプリが描かれ、マイクが始まり ① が出る。引継の書き出しにも入る
//   ・起動し直すと出ない(1回だけ)
//   ・参加済みの既存の利用者(onboardingDone.join)には出さない(記録も書かない)
//   ・参加していない既存の利用者(計測あり)には1回だけ出す
//   ・見本(?tutorialpreview=1)は記録があっても毎回出し、記録は書かない
//   ・参加のカード: 起動の最初に同意済みならチェックを出さず参加は押せる / 記録が無ければ今までどおりチェックを出す(根から配線を通す)
// サーバーは作り物(accountRepo などを差し替える。Firebase に触らない・アカウントを作らない)。IndexedDB も作り物。
// 【守っていないもの】見た目の実寸(中央・安全域・iPad の列)と殻での ATT・広告の順番。実寸は headless Chrome の実測(報告)、
//   ATT・広告は「マイクの最初の試みのあと」に始まる(shellStartAdsOnce)ので、マイクが同意の前に0回であることで間接に見ている。
// ------------------------------------------------------------------

vi.mock("./community/accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => null),   // 参加していない(参加のカードが出る)
  loadProfile: vi.fn(async () => null),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => { throw new Error("検査: サインインしない"); }),
}));
vi.mock("./community/directory.js", async (orig) => ({ ...(await orig()), listPublicUsers: vi.fn(async () => []), publishStats: vi.fn(async () => {}) }));
vi.mock("./community/idealRepo.js", async (orig) => ({ ...(await orig()), listIdeals: vi.fn(async () => []), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) }));

const W = 375; const H = 812;
const AGREE = "利用規約とプライバシーポリシーに同意します";
let fake; let host; let mod; let root; let realRect; let gum;

async function loadApp() {
  vi.resetModules();
  globalThis.indexedDB = fake;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("./App.jsx");
  const gate = await import("./ConsentScreen.jsx");
  const terms = await import("./termsConsent.js");
  const local = await import("./backup/localStore.js");
  return { React, act: React.act, createRoot, AppRoot: gate.default, openIdb: App.openIdb, warm: App.warmPersistedStateCache, terms, readAll: local.readAll };
}
const kv = (key) => fake._peek("windToneLabDB", "kv")?.get(key);
async function seed({ kvEntries = {}, sessions = [] } = {}) {
  const db = await mod.openIdb();
  db.close?.();
  for (const [k, v] of Object.entries(kvEntries)) fake._peek("windToneLabDB", "kv").set(k, structuredClone(v));
  for (const s of sessions) fake._peek("windToneLabDB", "sessions").set(s.id, structuredClone(s));
}
// main.jsx と同じ順: 温めてから根を描く
async function launch() {
  await mod.warm();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = mod.createRoot(host);
  await mod.act(async () => { root.render(mod.React.createElement(mod.AppRoot)); });
}
async function relaunch() {
  await mod.act(async () => root.unmount());
  host.remove(); document.body.innerHTML = "";
  mod = await loadApp();
  await launch();
}
const tick = (ms = 10) => mod.act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function waitFor(pred, label, deadline = 10000) {
  const end = Date.now() + deadline;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label}`);
    await tick();
  }
}
const consent = () => document.querySelector("[data-consent-screen]");
const startBtn = () => document.querySelector("[data-consent-start]");
const box = () => consent().querySelector('input[type="checkbox"]');
const navBar = () => document.querySelector("[data-bottom-nav]");
const layerId = () => document.querySelector("[data-coach-layer]")?.getAttribute("data-coach-layer") ?? null;
const click = (el) => mod.act(async () => { el.click(); });
const joinCard = () => document.querySelector("[data-join-card]");
const joinBtn = () => [...joinCard().querySelectorAll("button")].find((b) => b.textContent.trim() === "参加する");

// 作り物のマイク(onboardingApp.test.jsx の installFakeMic と同じ形)。getUserMedia の呼ばれた回数を数える。
function installFakeMic() {
  const node = () => ({ connect() {}, disconnect() {} });
  const analyser = () => ({
    ...node(), fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0,
    getFloatTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = (Math.random() - 0.5) * 2e-3; },
    getFloatFrequencyData(a) { a.fill(-120); }, getByteFrequencyData(a) { a.fill(0); }, getByteTimeDomainData(a) { a.fill(128); },
  });
  class FakeAudioContext {
    constructor() { this.state = "running"; this.sampleRate = 48000; this.currentTime = 0; this.destination = node(); }
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
  Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => { gum += 1; return stream; } }, configurable: true });
}

beforeEach(() => {
  fake = createFakeIndexedDb();
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
  // ① の的(環の箱)とカードの矩形(375×812 の実測と同じ値)。それ以外は jsdom の既定(0)のまま。
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    const b = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
    if (this.classList?.contains("coach-card")) return b(22, 0, W - 44, 146);
    if (this.getAttribute?.("data-coach") === "tuner") return b(14, 96, 347, 330);
    return b(0, 0, 0, 0);
  };
  installFakeMic();
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-tutorial-preview");
  window.Element.prototype.getBoundingClientRect = realRect;
  delete window.AudioContext;
  try { delete window.navigator.mediaDevices; } catch { /* */ }
});

const GATES = { migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true };
const NOW_ISO = new Date(Date.now() - 60 * 1000).toISOString();
const SESSION = (id) => ({ id, recordedAt: NOW_ISO, saxType: "alto", reedId: null, linkedAt: null, memo: null, performer: "自分", source: "live", frames: [], barlines: [], noteEvents: [] });

describe("入れたての人: 同意の画面から始まる", () => {
  it("同意の画面だけが出る(下部タブ・案内・マイクは無い)。チェックするまで「はじめる」は押せない。導線はシートを開きチェックは入らない", async () => {
    mod = await loadApp();
    await launch();
    expect(consent()).not.toBe(null);
    expect(consent().querySelector("h1").textContent).toBe("Ficus");
    expect(consent().querySelector("p").textContent).toBe("サックスの音程と音色を測って記録するアプリです");
    expect(consent().querySelector("label").textContent).toBe(AGREE);
    expect(consent().querySelector("label").style.minHeight).toBe("var(--tap-min)");   // 参加のカードと同じ AgreeRow
    // アイコンの芽(読み込み中の絵の 100% = 塗りの1枚だけ・線は描かない)
    const svg = consent().querySelector("svg");
    expect(svg.getAttribute("width")).toBe("88");
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    await tick(400);
    expect(navBar()).toBe(null);
    expect(layerId()).toBe(null);
    expect(gum).toBe(0);
    expect(startBtn().textContent).toBe("はじめる");
    expect(startBtn().disabled).toBe(true);
    expect(startBtn().style.background).toBe("var(--c-disabled)");
    await click(startBtn());
    await tick(100);
    expect(consent()).not.toBe(null);
    expect(kv("termsConsent")).toBeUndefined();
    // 規約の導線: アプリの中のシート(LegalSheet)。<label> の中にあるがチェックは入らない
    await click([...consent().querySelectorAll("button")].find((b) => b.textContent === "利用規約"));
    await waitFor(() => document.querySelector('[role="dialog"][aria-label="利用規約"]'), "規約のシート");
    expect(box().checked).toBe(false);
    expect(startBtn().disabled).toBe(true);
    expect(gum).toBe(0);
  }, 30000);

  it("チェック → はじめる: kv に日時と版を書き、アプリが描かれ、マイクが始まり ① が出る。引継の書き出しにも入る", async () => {
    mod = await loadApp();
    await launch();
    await click(consent().querySelector("label > span:last-child"));   // 行の文字を押しても入る
    expect(box().checked).toBe(true);
    expect(startBtn().disabled).toBe(false);
    expect(startBtn().style.background).toBe("var(--c-accent)");
    const before = Date.now();
    await click(startBtn());
    await waitFor(() => navBar(), "アプリ(下部タブ)");
    expect(consent()).toBe(null);
    await waitFor(() => kv("termsConsent"), "同意の記録(kv)");
    const rec = kv("termsConsent");
    expect(Object.keys(rec).sort()).toEqual(["at", "version"]);
    expect(rec.version).toBe("2026-10-08");
    expect(Math.abs(Date.parse(rec.at) - before)).toBeLessThan(5000);
    expect(new Date(rec.at).toISOString()).toBe(rec.at);
    await waitFor(() => gum > 0, "マイク");
    await waitFor(() => layerId() === "tuner", "① まずは吹いてみよう");
    const snap = await mod.readAll();
    expect(snap.kv.termsConsent).toEqual(rec);
    expect(snap.kv).toHaveProperty("onboardingDone");   // onboardingDone と同じ層(kv)に入る
  }, 30000);

  it("起動し直すと出ない(1回だけ)。記録は書き換えない", async () => {
    mod = await loadApp();
    await launch();
    await click(box());
    await click(startBtn());
    await waitFor(() => kv("termsConsent"), "同意の記録");
    const rec = structuredClone(kv("termsConsent"));
    await relaunch();
    expect(consent()).toBe(null);
    expect(navBar()).not.toBe(null);
    await tick(200);
    expect(kv("termsConsent")).toEqual(rec);
  }, 30000);
});

describe("既存の利用者", () => {
  it("参加済み(onboardingDone.join)の人には出さない。記録は書かない", async () => {
    mod = await loadApp();
    await seed({ kvEntries: { onboardingDone: { ...GATES, join: true, measure: true } }, sessions: [SESSION("s1")] });
    await launch();
    expect(consent()).toBe(null);
    expect(navBar()).not.toBe(null);
    await tick(300);
    expect(kv("termsConsent")).toBeUndefined();
  }, 30000);

  it("参加していない人(計測あり)には1回だけ出す。マイクは同意の前に始まらない", async () => {
    mod = await loadApp();
    await seed({ kvEntries: { onboardingDone: { ...GATES, measure: true, tuner: true, metronome: true } }, sessions: [SESSION("s1")] });
    await launch();
    expect(consent()).not.toBe(null);
    await tick(300);
    expect(gum).toBe(0);
    expect(navBar()).toBe(null);
    await click(box());
    await click(startBtn());
    await waitFor(() => navBar(), "アプリ");
    await waitFor(() => gum > 0, "同意のあとにマイク");
    await waitFor(() => kv("termsConsent"), "同意の記録");
    await relaunch();
    expect(consent()).toBe(null);
  }, 30000);

  it("壊れた記録(版が無い)は記録として数えない(出す)", async () => {
    mod = await loadApp();
    await seed({ kvEntries: { termsConsent: { at: "2026-10-08T00:00:00.000Z" }, onboardingDone: { ...GATES } } });
    await launch();
    expect(consent()).not.toBe(null);
  }, 30000);
});

describe("見本(?tutorialpreview=1)", () => {
  it("記録があっても毎回出す。同意しても記録は書かない(書き換えない)", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    const REC = { at: "2026-10-08T00:00:00.000Z", version: "2026-10-08" };
    mod = await loadApp();
    await seed({ kvEntries: { termsConsent: REC, onboardingDone: { ...GATES } } });
    await launch();
    expect(consent()).not.toBe(null);
    expect(gum).toBe(0);
    await click(box());
    await click(startBtn());
    await waitFor(() => navBar(), "アプリ");
    await waitFor(() => layerId() === "tuner", "見本の ①");
    expect(kv("termsConsent")).toEqual(REC);
    await relaunch();
    expect(consent()).not.toBe(null);   // 開き直してもまた出る
  }, 30000);

  it("記録の無い端末の見本でも、同意しても記録は書かない", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp();
    await launch();
    await click(box());
    await click(startBtn());
    await waitFor(() => navBar(), "アプリ");
    await tick(300);
    expect(kv("termsConsent")).toBeUndefined();
  }, 30000);
});

describe("参加のカード(根 → アプリ → コミュニティ → JoinIntro の配線)", () => {
  const openCommunity = async () => {
    await click(document.querySelector('button[aria-label="コミュニティ"]'));
    await waitFor(() => joinCard(), "参加のカード", 20000);
  };
  it("起動の最初に同意した人: チェックを出さず、参加は押せる", async () => {
    mod = await loadApp();
    await launch();
    await click(box());
    await click(startBtn());
    await waitFor(() => navBar(), "アプリ");
    await openCommunity();
    expect(joinCard().querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(joinCard().textContent).not.toContain(AGREE);
    expect(joinBtn().disabled).toBe(false);
    expect(joinBtn().style.background).toBe("var(--c-accent)");
  }, 40000);

  it("記録のある起動(2回目以降)でもチェックを出さない", async () => {
    mod = await loadApp();
    await seed({ kvEntries: { termsConsent: { at: "2026-10-08T00:00:00.000Z", version: "2026-10-08" }, onboardingDone: { ...GATES } } });
    await launch();
    expect(consent()).toBe(null);
    await openCommunity();
    expect(joinCard().querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(joinBtn().disabled).toBe(false);
  }, 40000);

  it("記録が無い(参加の印だけ残っている = 古いバックアップ・アカウントを消した等): 今までどおりチェックを出し、入るまで押せない", async () => {
    mod = await loadApp();
    await seed({ kvEntries: { onboardingDone: { ...GATES, join: true } } });
    await launch();
    expect(consent()).toBe(null);
    await openCommunity();
    const cb = joinCard().querySelector('input[type="checkbox"]');
    expect(cb).not.toBe(null);
    expect(cb.closest("label").textContent).toBe(AGREE);
    expect(joinBtn().disabled).toBe(true);
    expect(joinBtn().style.background).toBe("var(--c-disabled)");
    await click(cb);
    expect(joinBtn().disabled).toBe(false);
  }, 40000);

  // 【便CB 統括の指示】記録の無い人が参加のカードでチェックを入れて参加できたら、記録(日時と今の版)を書く。成功のときだけ。
  const seedJoinedNoRecord = () => seed({ kvEntries: { onboardingDone: { ...GATES, join: true } } });
  it("記録が無い人がカードで同意して参加できたら、kv に日時と今の版を書く", async () => {
    mod = await loadApp();
    const repo = await import("./community/accountRepo.js");
    repo.ensureSignedIn.mockReset();
    repo.ensureSignedIn.mockImplementation(async () => "new-uid");
    await seedJoinedNoRecord();
    await launch();
    await openCommunity();
    await click(joinCard().querySelector('input[type="checkbox"]'));
    const before = Date.now();
    await click(joinBtn());
    await waitFor(() => kv("termsConsent"), "参加の成功で記録");
    const rec = kv("termsConsent");
    expect(Object.keys(rec).sort()).toEqual(["at", "version"]);
    expect(rec.version).toBe("2026-10-08");
    expect(Math.abs(Date.parse(rec.at) - before)).toBeLessThan(5000);
    expect(repo.ensureSignedIn).toHaveBeenCalledTimes(1);
    // 記録が入ったので、起動し直しても同意の画面は出ない
    await relaunch();
    expect(consent()).toBe(null);
  }, 40000);

  it("参加に失敗したら(アカウントが作れない)記録を書かない", async () => {
    mod = await loadApp();
    const repo = await import("./community/accountRepo.js");
    repo.ensureSignedIn.mockReset();
    repo.ensureSignedIn.mockImplementation(async () => { throw new Error("検査: サインインしない"); });
    await seedJoinedNoRecord();
    await launch();
    await openCommunity();
    await click(joinCard().querySelector('input[type="checkbox"]'));
    await click(joinBtn());
    await waitFor(() => !joinCard(), "参加の失敗(エラーの画面へ)");
    await tick(300);
    expect(kv("termsConsent")).toBeUndefined();
  }, 40000);

  it("起動の最初に同意済みの人が参加しても、記録は書き換えない", async () => {
    const REC = { at: "2026-10-08T00:00:00.000Z", version: "2026-10-08" };
    mod = await loadApp();
    const repo = await import("./community/accountRepo.js");
    repo.ensureSignedIn.mockReset();
    repo.ensureSignedIn.mockImplementation(async () => "new-uid");
    await seed({ kvEntries: { termsConsent: REC, onboardingDone: { ...GATES } } });
    await launch();
    await openCommunity();
    await click(joinBtn());
    await waitFor(() => repo.ensureSignedIn.mock.calls.length === 1 && !joinCard(), "参加の成功(フォームへ)");
    await tick(300);
    expect(kv("termsConsent")).toEqual(REC);
  }, 40000);
});
