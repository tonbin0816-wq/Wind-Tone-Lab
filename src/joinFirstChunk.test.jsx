// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便DE 審査 2026-10-25】初回の参加の場面の、コミュニティタブの「コードの取得」に関わる2つの決まり。
//   ① 先読み: 同意の画面が出ている間に、コミュニティタブのコードの取得が始まっている(「次へ」の前。先読みを外すと、取得はアプリが描かれてから = 数が0のまま)
//   ② 遅れて出す輪: 参加の場面でコードがまだ来ていないとき、最初の1秒(TUNER_SUSTAIN_MS)は何も描かず、それでも待っていれば読み込みの輪を出す。
//      来たらすぐプロフィールの入力に替わり、輪は消える(空白のままにしない・速いときにちらつかせない)。
// 取得は、本体だけが読む葉のモジュール photoRepo.js の vi.mock のファクトリが数える(本体の読み込みが始まるたびに1つ増える)。ファクトリは門(chunk.gate)が開くまで返さない = 遅いコードの取得を作る。
// モックのファクトリは同じ vitest ファイルの中で作り直されないので、**このファイルには検査を1つだけ**置く(複数置くと2つ目から数が増えない)。
// 【守っていないもの】本物の回線でのコードの取得の速さ(実機待ち)。「同意済みの再起動」の先読みは、取得を描画の中で1回早く始めるだけで、数では見分けられない(pitch-test の DE.3 が綴りで見る)。
// ------------------------------------------------------------------
const chunk = vi.hoisted(() => ({ requests: 0, gate: null }));
// コミュニティタブの本体(CommunityTab.jsx)だけが読む葉のモジュール(photoRepo.js)のファクトリを、取得の数え手と門にする:
// 本体の読み込みが始まると葉が要求され(= 取得のたびに1つ増える)、門が開くまで本体の評価が終わらない(= 遅いコードの取得)。
// (本体そのものを vi.mock すると、取得が重なったときに2つ目以降は本物へ素通りして門が効かない)
vi.mock("./community/photoRepo.js", async (orig) => {
  chunk.requests += 1;
  await chunk.gate;
  return await orig();
});
vi.mock("./community/accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => null),
  loadProfile: vi.fn(async () => null),
  saveProfile: vi.fn(async () => {}),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => "me"),
}));
vi.mock("./community/profile.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return { ...(await orig()), buildProfileDoc: vi.fn(() => ({ doc: { ...kit.MY_PROFILE, ageConfirmed: true } })) };
});
vi.mock("./community/directory.js", async (orig) => ({ ...(await orig()), listPublicUsers: vi.fn(async () => []), publishStats: vi.fn(async () => {}) }));
vi.mock("./community/reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));
vi.mock("./community/idealRepo.js", async (orig) => ({ ...(await orig()), listIdeals: vi.fn(async () => []), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) }));

let fake; let host; let mod; let root; let realFetch;
beforeEach(() => {
  fake = createFakeIndexedDb();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-tutorial-preview");
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = () => {};
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const name = String(url).replace(/^\//, "");
    if (!/^(terms|privacy)\.html$/.test(name)) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => readFileSync(join(process.cwd(), "public", name), "utf8") };
  };
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null; host?.remove(); document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-ad-hold");
  globalThis.fetch = realFetch;
  delete window.matchMedia;
});

describe("初回の参加の場面のコード取得", () => {
  it("同意の画面のうちに取得が始まる(先読み)。遅いコードは最初の1秒は何も描かず、それでも待てば輪を出し、来たらすぐプロフィールの入力に替わる", async () => {
    let open;
    chunk.gate = new Promise((r) => { open = r; });
    vi.resetModules();
    globalThis.indexedDB = fake;
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const App = await import("./App.jsx");
    const gate = await import("./ConsentScreen.jsx");
    mod = { act: React.act };
    const tick = (ms = 10) => React.act(async () => { await new Promise((r) => setTimeout(r, ms)); });
    const waitFor = async (pred, label, deadline = 10000) => { const end = Date.now() + deadline; while (!pred()) { if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label}`); await tick(); } };
    const ring = () => document.querySelector('[role="img"][aria-label="読み込み中"]');
    const formBtn = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "プロフィールを作る");
    await App.warmPersistedStateCache();
    host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
    await React.act(async () => { root.render(React.createElement(gate.default)); });
    // ① 1枚目(ようこそ)のうちに、コミュニティタブのコードの取得が始まっている
    await waitFor(() => chunk.requests >= 1, "同意の画面のうちに取得が始まる");
    expect(document.querySelector('[data-consent-step="welcome"]')).toBeTruthy();
    expect(chunk.requests).toBe(1);
    // 同意する(コードはまだ来ない)
    await React.act(async () => { document.querySelector("[data-consent-start]").click(); });
    await waitFor(() => document.querySelector('[data-consent-step="terms"]'), "2枚目");
    await React.act(async () => { document.querySelector('input[type="checkbox"]').click(); });
    await React.act(async () => { document.querySelector("[data-consent-next]").click(); });
    await waitFor(() => !document.querySelector("[data-consent-screen]"), "同意の画面が消える");
    const t0 = Date.now();
    // ② 最初の1秒は何も描かない(輪もフォームも無い)
    await tick(500); console.log("AFTER500", chunk.requests, Date.now() % 100000);
    expect(ring()).toBe(null);
    expect(formBtn()).toBeUndefined();
    // それでも待っていれば輪が出る(1秒のあと)
    await waitFor(() => ring(), "遅れて輪が出る", 4000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect(formBtn()).toBeUndefined();
    expect(chunk.requests).toBe(1);               // 取得は1回のまま(先読みと App の lazy が同じ取得を待つ)
    // コードが来たら、すぐプロフィールの入力に替わる(輪は消える)
    await React.act(async () => { open(); });
    await waitFor(() => formBtn(), "コードが来てプロフィールの入力", 5000);
    expect(ring()).toBe(null);
    expect(document.querySelector("[data-join-card]")).toBe(null);
    expect(document.querySelector("[data-bottom-nav]")).toBe(null);
  }, 60000);
});
