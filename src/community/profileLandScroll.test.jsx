// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便BX 2026-10-06 本人の実機指示】プロフィールを初めて作った(参加の完了)あと、データの子タブを先頭から見せる。
// 原因(CommunityTab.jsx の onSubmit の setPhase("profile")): フォームを下まで送って保存すると、文書の送り位置が
// 参加後の画面に持ち越されていた(375×812 の実測で 581 → 315。報告の表)。直し: 差し替えた描画の直後に window.scrollTo(0, 0)。
// 本物の CommunityTab(参加前 → 参加する → フォーム → 保存 → 参加後)を描いて確かめる。
// サーバーは作り物(accountRepo / directory / idealRepo / reportRepo)。フォームの中身の判定(buildProfileDoc)は通す
// (判定そのものは profile.test.js が守る。ここで見るのは保存のあとの送り位置だけ)。
// jsdom は配置も送り位置も持たないので、window.scrollTo の呼び出しと、呼ばれた時点で画面が参加後に替わっていたかを記録して見る。
// 【守っていないもの】実際の送り位置(headless Chrome の実測: iPhone 375×812 で保存の後 315 → 0。iPad 820×1180 / 1180×820 の
//   2ペインは直す前から 0・左右のペインの送り位置も 0。報告の表)。
// ------------------------------------------------------------------

globalThis.indexedDB = createFakeIndexedDb();
const account = { uid: "me", profile: null, saved: [] };
vi.mock("./accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => account.uid),
  loadProfile: vi.fn(async () => account.profile),
  saveProfile: vi.fn(async (uid, doc) => { account.saved.push([uid, doc]); }),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => "me"),
}));
vi.mock("./profile.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), buildProfileDoc: vi.fn(() => ({ doc: { ...kit.MY_PROFILE, ageConfirmed: true } })) };
});
vi.mock("./directory.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(async () => kit.SERVER_USERS), publishStats: vi.fn(async () => {}) };
});
vi.mock("./reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));
vi.mock("./idealRepo.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listIdeals: vi.fn(async () => kit.SERVER_IDEALS), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) };
});

const { default: CommunityTab } = await import("./CommunityTab.jsx");
const kit = await import("./blockKit.testutil.jsx");
const { setupDom, teardownDom, waitFor, bodyText, buttonsNamed, click } = kit;

// 子タブの行(参加後の画面)が描かれているか / フォームが描かれているか
const joinedShown = () => ["データ", "順位", "シェア", "マイページ"].every((l) => buttonsNamed(l).length > 0);
const formShown = () => buttonsNamed("プロフィールを作る").length > 0 || buttonsNamed("保存").length > 0;
let calls = [];
let host = null; let root = null;
beforeEach(() => {
  setupDom();
  calls = [];
  // 呼ばれた時点で、画面が参加後に替わっていたか(描いた直後に呼ぶ = フォームはもう無い)も一緒に記録する
  window.scrollTo = (...args) => { calls.push({ args, joined: joinedShown(), form: formShown() }); };
  account.uid = "me"; account.profile = null; account.saved = [];
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; host?.remove(); host = null;
  teardownDom();
});
async function drawTab() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<CommunityTab sessions={[]} tuningHz={442} onAdoptIdeal={() => ({})} />); });
}
const toTop = () => calls.filter((c) => c.args[0] === 0 && c.args[1] === 0);

describe("【便BX】プロフィールを初めて作ったあと、データの子タブを先頭から見せる", () => {
  it("参加する → フォーム → 「プロフィールを作る」: 参加後の画面に替わった直後に1回だけ window.scrollTo(0, 0)", async () => {
    await drawTab();
    await waitFor(() => buttonsNamed("参加する").length > 0, "参加の画面");
    await click(document.querySelector('[data-join-card] input[type="checkbox"]'));
    await click(buttonsNamed("参加する")[0]);
    await waitFor(() => buttonsNamed("プロフィールを作る").length > 0, "プロフィールの入力");
    // フォームが出ている間(まだ保存していない)は先頭へ戻さない
    expect(toTop()).toEqual([]);
    calls = [];
    await click(buttonsNamed("プロフィールを作る")[0]);
    await waitFor(() => joinedShown(), "参加後の画面");
    await waitFor(() => bodyText().includes("目安を公開している"), "データの子タブの中身");
    expect(account.saved).toHaveLength(1);
    const top = toTop();
    expect(top).toHaveLength(1);
    // フォームを参加後の画面に差し替えた描画の後(フォームはもう無く、子タブの行が在る)
    expect(top[0]).toEqual({ args: [0, 0], joined: true, form: false });
    // 名簿・目安の読み込みで描き直しても、もう一度は戻さない(読み終わった後に自分で送った位置を奪わない)
    expect(calls.filter((c) => c.args[0] === 0 && c.args[1] === 0)).toHaveLength(1);
  });

  it("編集の保存(マイページへ戻る)は今までどおり先頭へ戻さない(本人の指示はデータの子タブへ戻るとき)", async () => {
    account.profile = kit.MY_PROFILE;
    await drawTab();
    await waitFor(() => joinedShown(), "参加後の画面");
    await click(buttonsNamed("マイページ")[0]);
    await click(buttonsNamed("編集")[0]);
    await waitFor(() => buttonsNamed("保存").length > 0, "編集のフォーム");
    calls = [];
    await click(buttonsNamed("保存")[0]);
    await waitFor(() => joinedShown(), "参加後の画面に戻る");
    expect(account.saved).toHaveLength(1);
    expect(toTop()).toEqual([]);
  });

  it("編集の「やめる」も先頭へ戻さない", async () => {
    account.profile = kit.MY_PROFILE;
    await drawTab();
    await waitFor(() => joinedShown(), "参加後の画面");
    await click(buttonsNamed("マイページ")[0]);
    await click(buttonsNamed("編集")[0]);
    await waitFor(() => buttonsNamed("やめる").length > 0, "編集のフォーム");
    calls = [];
    await click(buttonsNamed("やめる")[0]);
    await waitFor(() => joinedShown(), "参加後の画面に戻る");
    expect(toTop()).toEqual([]);
  });
});
