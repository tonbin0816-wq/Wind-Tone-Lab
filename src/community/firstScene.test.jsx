// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便DE 審査 2026-10-25】コミュニティタブの「初回の参加の場面」(joinFirst)は、**マウントしたときの値だけ**で決まる。
// App が設定の欠落で場面を畳むなど、あとから joinFirst が false に変わっても、いま出ているプロフィールの入力・上の「もう一度試す」・保存の待ちは変わらない
// (変わると、入力の途中のフォームが裏の確認の失敗のたびに作り直される・押せない保存が突然押せるようになる)。
// タブを直に描いて(App を通さず)joinFirst を true → false に替えて確かめる。サーバーは作り物(Firebase に触らない)。
// 【守っていないもの】App の経路(joinSceneNow の切り替わり。joinFirst.test.jsx が根から見る)。
// ------------------------------------------------------------------
globalThis.indexedDB = createFakeIndexedDb();
const srv = vi.hoisted(() => ({ uid: "me", profile: null, failLoad: false, saves: 0 }));
vi.mock("./accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => { if (srv.failLoad) throw new Error("検査: 通信に失敗"); return srv.uid; }),
  loadProfile: vi.fn(async () => srv.profile),
  saveProfile: vi.fn(async () => { srv.saves += 1; }),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => "me"),
}));
vi.mock("./directory.js", async (orig) => ({ ...(await orig()), listPublicUsers: vi.fn(async () => []), publishStats: vi.fn(async () => {}) }));
vi.mock("./reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));
vi.mock("./idealRepo.js", async (orig) => ({ ...(await orig()), listIdeals: vi.fn(async () => []), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) }));

const { default: CommunityTab } = await import("./CommunityTab.jsx");
const kit = await import("./blockKit.testutil.jsx");
const { setupDom, teardownDom, waitFor, buttonsNamed } = kit;

describe("初回の参加の場面(joinFirst)はマウントしたときの値で決まる", () => {
  let host = null; let root = null;
  beforeEach(() => {
    setupDom();
    Object.assign(srv, { uid: "me", profile: null, failLoad: false, saves: 0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    root = null; host?.remove(); host = null;
    teardownDom();
    vi.restoreAllMocks();
  });
  const render = (joinFirst) => act(async () => { root.render(<CommunityTab sessions={[]} tuningHz={442} onAdoptIdeal={() => ({})} joinFirst={joinFirst} />); });
  const retry = () => document.querySelector("[data-join-retry] button");
  const form = () => buttonsNamed("プロフィールを作る")[0];

  it("joinFirst で描く: いきなりフォーム(読み込み画面も参加のカードも出ない)。確認が失敗したら上に「もう一度試す」。joinFirst が false に変わっても、フォームと「もう一度試す」と押せない保存はそのまま", async () => {
    srv.failLoad = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await render(true);
    expect(form()).toBeTruthy();                                              // いきなりフォーム
    expect(document.querySelector('[role="img"][aria-label="読み込み中"]')).toBe(null);
    expect(document.querySelector("[data-join-card]")).toBe(null);
    await waitFor(() => retry(), "確認の失敗の「もう一度試す」");
    const before = form();
    expect(before.disabled).toBe(true);                                       // 確認が済むまで保存は押せない
    // あとから joinFirst が false になっても(App が場面を畳んだ・タブの props が変わった)、この部品の画面は変えない
    await render(false);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(retry()).toBeTruthy();                                             // 「もう一度試す」は残る
    expect(form()).toBe(before);                                              // フォームは作り直されない
    expect(form().disabled).toBe(true);                                       // 押せない保存は押せないまま
    expect(srv.saves).toBe(0);
  }, 30000);

  it("joinFirst を渡さない(ふだんのタブ)なら、今までどおり読み込み画面 → 参加のカード(フォームは出さない)", async () => {
    srv.uid = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await render(false);
    await waitFor(() => document.querySelector("[data-join-card]"), "参加のカード");
    expect(form()).toBeUndefined();
  }, 30000);
});
