// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便CD 2026-10-08 本人「それ以下の利用規約やボタン自体もいらない」・統括の裁定】参加のカードを押すと参加が始まる。
// 便BX の案内の流れ(⑭' goCommunity → 参加の画面 → 参加 → 到着コミュニティ → ⑯)が、カードを押す参加でそのまま通ることを
// 本物のアプリ(App)で確かめる。iPhone 縦(375×812。matchMedia は reduced-motion だけ true)。
// サーバーは作り物(accountRepo / directory / idealRepo / reportRepo。Firebase に触らない・アカウントを作らない)。
//   ・getSignedInUid は「作った後」だけ uid を返す / ensureSignedIn は作り物の uid を返す / saveProfile は手元に覚える
//   ・フォームの中身の判定(buildProfileDoc)は作り物(判定そのものは profile.test.js が守る。ここで見るのは流れだけ)
// 的の矩形は idealSeenFlow.test.jsx と同じ 375×812 の値。
// 【便CI 2026-10-10 本人「カード以外の箇所をタップしても次に進めるように変更」】カードの外(枠 .join-frame)を押す参加でも同じ流れが通る。
// 【守っていないもの】実寸の見た目(Browser ペインのスクショ)。
// ------------------------------------------------------------------

const server = vi.hoisted(() => ({ uid: null, profile: null, signIns: 0 }));
vi.mock("./community/accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => server.uid),
  loadProfile: vi.fn(async () => server.profile),
  saveProfile: vi.fn(async (_uid, doc) => { server.profile = doc; }),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => { server.signIns += 1; server.uid = "me"; return "me"; }),
}));
vi.mock("./community/profile.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return { ...(await orig()), buildProfileDoc: vi.fn(() => ({ doc: { ...kit.MY_PROFILE, ageConfirmed: true } })) };
});
vi.mock("./community/directory.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(async () => kit.SERVER_USERS), publishStats: vi.fn(async () => {}) };
});
vi.mock("./community/reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));
vi.mock("./community/idealRepo.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return { ...(await orig()), listIdeals: vi.fn(async () => kit.SERVER_IDEALS), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) };
});

const W = 375; const H = 812;
let fake; let host; let mod; let root; let realRect; let realSIV;

async function loadApp(idb) {
  vi.resetModules();
  globalThis.indexedDB = idb;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("./App.jsx");
  return { React, act: React.act, createRoot, App: App.default, openIdb: App.openIdb };
}
async function seed(kvEntries) {
  const db = await mod.openIdb();
  db.close?.();
  for (const [k, v] of Object.entries(kvEntries)) fake._peek("windToneLabDB", "kv").set(k, structuredClone(v));
}
const kv = (key) => fake._peek("windToneLabDB", "kv")?.get(key);
const tick = (ms = 5) => mod.act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function waitFor(pred, label, deadline = 10000) {
  const end = Date.now() + deadline;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label}`);
    await tick();
  }
}
const click = (el) => mod.act(async () => { el.click(); });
const nav = (label) => document.querySelector(`[data-bottom-nav] button[aria-label="${label}"]`);
const layer = () => document.querySelector("[data-coach-layer]");
const layerId = () => layer()?.getAttribute("data-coach-layer") ?? null;
const joinCard = () => document.querySelector('[data-join-card][role="button"][aria-label="参加する"]');
const buttonsNamed = (name) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === name);

const NOW_ISO = new Date(Date.now() - 60 * 1000).toISOString();
const SESSION = (id) => ({ id, recordedAt: NOW_ISO, saxType: "alto", reedId: null, linkedAt: null, memo: null, performer: "自分", source: "live", frames: [], barlines: [], noteEvents: [] });
// ⑭' の手前まで済み(参加・到着コミュニティ・⑯ はまだ)。idealSeenFlow.test.jsx の BASE_X と同じ形
const BASE = {
  migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true,
  measure: true, reeds: true, reedsMeasure: true, tuner: true, metronome: true, metroTempo: true, metroStart: true, goReeds: true, reedLinked: true,
  goData: true, arriveReeds: true, arriveData: true, calendarDay: true, daySession: true, trend: true,
};
// 作り物のマイク(返らない = 計測タブの段は出ない・エラーも出ない)
function installPendingMic() {
  const gate = new Promise(() => {});
  Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => { await gate; return null; } }, configurable: true });
  window.AudioContext = class { constructor() { this.state = "running"; } resume() { return Promise.resolve(); } close() { return Promise.resolve(); } };
}

beforeEach(() => {
  fake = createFakeIndexedDb();
  window.localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  server.uid = null; server.profile = null; server.signIns = 0;
  window.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = vi.fn();
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    const box = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
    if (this.classList?.contains("coach-card")) return box(22, 0, W - 44, 146);
    if (this.getAttribute?.("data-coach") === "adoptAverage") return box(14, 108, 347, 314);
    const c0 = this.getAttribute?.("data-coach");
    const NAV_BTN = { "nav-measure": 20, "nav-reeds": 103.75, "nav-community": 187.5, "nav-analysis": 271.25 };
    if (c0 && c0 in NAV_BTN && this.tagName === "BUTTON") return box(NAV_BTN[c0], 760, 83.75, 44);
    return box(0, 0, 0, 0);
  };
  realSIV = window.Element.prototype.scrollIntoView;
  window.Element.prototype.scrollIntoView = function () {};
  installPendingMic();
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  window.Element.prototype.getBoundingClientRect = realRect;
  window.Element.prototype.scrollIntoView = realSIV;
  delete window.matchMedia;
  delete window.AudioContext;
  try { delete window.navigator.mediaDevices; } catch { /* */ }
});

async function start(kvEntries, sessions = []) {
  mod = await loadApp(fake);
  await seed(kvEntries);
  for (const x of sessions) fake._peek("windToneLabDB", "sessions").set(x.id, structuredClone(x));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = mod.createRoot(host);
  await mod.act(async () => { root.render(mod.React.createElement(mod.App)); });
  await waitFor(() => nav("コミュニティ"), "下部タブ");
}

const joinFrame = () => document.querySelector("[data-join-layer] .join-frame");

describe("【便CD】便BX の案内の流れを、カードを押す参加で通す", () => {
  for (const [how, target] of [["カードを押す", joinCard], ["【便CI】カードの外(枠)を押す", joinFrame]]) {
  it(`⑭' → コミュニティ(参加のカード)→ ${how} → プロフィールの入力 → 作る → join → 到着コミュニティ → ⑯`, async () => {
    await start({ onboardingDone: BASE }, [SESSION("s1")]);
    await click(nav("データ"));
    await waitFor(() => layerId() === "goCommunity", "⑭'");
    await click(nav("コミュニティ"));
    await waitFor(() => joinCard(), "参加のカード");
    await waitFor(() => kv("onboardingDone")?.goCommunity === true, "goCommunity の印");
    // 参加のカードの間は案内の段を出さない(参加していないので community の候補は空)
    expect(layerId()).toBe(null);
    expect(kv("onboardingDone").join).toBeUndefined();
    expect(server.signIns).toBe(0);
    await click(target());
    await waitFor(() => buttonsNamed("プロフィールを作る").length > 0, "プロフィールの入力");
    expect(server.signIns).toBe(1);
    expect(document.querySelector("[data-join-card]")).toBe(null);
    await click(buttonsNamed("プロフィールを作る")[0]);
    await waitFor(() => kv("onboardingDone")?.join === true, "join の印(参加の完了)");
    await waitFor(() => layerId() === "arriveCommunity", "到着コミュニティ");
    await click(layer().querySelector(".coach-card"));
    await waitFor(() => kv("onboardingDone")?.arriveCommunity === true, "arriveCommunity の印");
    await waitFor(() => layerId() === "adoptAverage", "⑯");
    expect(server.signIns).toBe(1);
  }, 60000);
  }

  // 【便CI】外を押すと参加が始まるようになっても、本物の下部タブは枠の外(層の中に居ない)。押せばタブが移り、参加は始まらない。
  it("【便CI】参加のカードの間に下部タブを押すと、タブが移るだけ(参加は始まらない・アカウントは作られない)", async () => {
    await start({ onboardingDone: BASE }, [SESSION("s1")]);
    await click(nav("コミュニティ"));
    await waitFor(() => joinCard(), "参加のカード");
    const navEl = document.querySelector("[data-bottom-nav]");
    expect(document.querySelector("[data-join-layer]").contains(navEl)).toBe(false);
    expect(joinFrame().contains(navEl)).toBe(false);
    await click(nav("データ"));
    await waitFor(() => document.querySelector("[data-join-card]") === null, "データタブへ移った(参加のカードが消えた)");
    await tick(50);
    expect(server.signIns).toBe(0);
    expect(buttonsNamed("プロフィールを作る")).toHaveLength(0);
  }, 60000);
});
