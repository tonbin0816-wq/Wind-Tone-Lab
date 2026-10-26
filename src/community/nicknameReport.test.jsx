// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便DH 2026-10-26 本人の指示】はじめの案内の文に入れる「〇〇さん」のニックネームは、コミュニティタブが自分のプロフィールを持ったとき
// onNickname で App へ知らせる(App.jsx の coachNickname → OnboardingCoach の nickname)。本物の CommunityTab を描いて、知らせる時機を見る。
//   ・参加済みの人がタブを開いて読み込めたとき … その人のニックネーム
//   ・編集で変えて保存したとき … 変えたあとのニックネーム(案内の文は次の描画で変わる)
//   ・アカウントを削除したとき … null(「あなた」に戻る)
//   ・ニックネームが無い間(参加前・読み込み中)は何も知らせない … 開き直した直後に、前の名前を null で消して「あなた」へ一瞬戻さない
// サーバーは作り物(accountRepo / directory / idealRepo / reportRepo。Firebase に触らない)。フォームの判定(buildProfileDoc)は作り物に差し替える
// (判定そのものは profile.test.js が守る。ここで見るのは知らせる時機だけ)。
// 【守っていないもの】App.jsx から OnboardingCoach までの配線の全体(idealSeenFlow.test.jsx が、読み込んだニックネーム「じぶん」が計測タブの ⑱ に
//   「Ficusでじぶんさんの音を分析しよう！」と出るところまで通しで見る)。
// ------------------------------------------------------------------

globalThis.indexedDB = createFakeIndexedDb();
const account = vi.hoisted(() => ({ uid: "me", profile: null, nextNickname: "かわった", deleted: 0, gate: null }));
vi.mock("./accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => account.uid),
  loadProfile: vi.fn(async () => { if (account.gate) await account.gate; return account.profile; }),
  saveProfile: vi.fn(async () => {}),
  deleteAccount: vi.fn(async () => { account.deleted += 1; account.uid = null; account.profile = null; return { credentialRemoved: true }; }),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => "me"),
}));
vi.mock("./profile.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), buildProfileDoc: vi.fn(() => ({ doc: { ...kit.MY_PROFILE, nickname: account.nextNickname, ageConfirmed: true } })) };
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
const { setupDom, teardownDom, waitFor, buttonsNamed, click } = kit;

const joinedShown = () => ["データ", "順位", "シェア", "マイページ"].every((l) => buttonsNamed(l).length > 0);
let host = null; let root = null;
let heard = [];
beforeEach(() => {
  setupDom();
  window.scrollTo = () => {};
  heard = [];
  account.uid = "me"; account.profile = null; account.nextNickname = "かわった"; account.deleted = 0; account.gate = null;
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
  await act(async () => { root.render(<CommunityTab sessions={[]} tuningHz={442} onAdoptIdeal={() => ({})} onNickname={(n) => heard.push(n)} />); });
}
const button = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === label);

describe("【便DH】ニックネームを App へ知らせる時機", () => {
  it("参加済みの人がタブを開いて読み込めたら、そのニックネームを知らせる(読み込み中は何も知らせない)", async () => {
    account.profile = kit.MY_PROFILE;
    expect(kit.MY_PROFILE.nickname).toBe("じぶん");
    let release; account.gate = new Promise((r) => { release = r; });   // 読み込みの返りを遅らせる(検査が手で解く)
    await drawTab();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(joinedShown()).toBe(false);
    expect(heard).toEqual([]);                  // 読み込めるまでは null も知らせない
    await act(async () => { release(); });
    await waitFor(() => joinedShown(), "参加後の画面");
    expect(heard).toEqual(["じぶん"]);
  });
  it("参加していない人(プロフィールが無い)には何も知らせない", async () => {
    account.profile = null;
    await drawTab();
    await waitFor(() => document.querySelector("[data-join-card]"), "参加のカード");
    expect(heard).toEqual([]);
  });
  it("編集でニックネームを変えて保存したら、変えたあとのニックネームを知らせる(案内の文は次の描画で変わる)", async () => {
    account.profile = kit.MY_PROFILE;
    await drawTab();
    await waitFor(() => joinedShown(), "参加後の画面");
    await click(buttonsNamed("マイページ")[0]);
    await click(buttonsNamed("編集")[0]);
    await waitFor(() => buttonsNamed("保存").length > 0, "編集のフォーム");
    await click(buttonsNamed("保存")[0]);
    await waitFor(() => heard.includes("かわった"), "変えたニックネーム");
    expect(heard).toEqual(["じぶん", "かわった"]);
  });
  it("変えずに保存(同じニックネーム)や「やめる」では、知らせ直さない", async () => {
    account.profile = kit.MY_PROFILE;
    account.nextNickname = "じぶん";
    await drawTab();
    await waitFor(() => joinedShown(), "参加後の画面");
    await click(buttonsNamed("マイページ")[0]);
    await click(buttonsNamed("編集")[0]);
    await waitFor(() => buttonsNamed("保存").length > 0, "編集のフォーム");
    await click(buttonsNamed("保存")[0]);
    await waitFor(() => joinedShown(), "参加後の画面に戻る");
    expect(heard).toEqual(["じぶん"]);
  });
  it("アカウントを削除したら null を知らせる(案内の文は「あなた」に戻る)", async () => {
    account.profile = kit.MY_PROFILE;
    await drawTab();
    await waitFor(() => joinedShown(), "参加後の画面");
    await click(buttonsNamed("マイページ")[0]);
    await waitFor(() => button("アカウントを削除"), "アカウントを削除");
    await click(button("アカウントを削除"));
    await waitFor(() => button("アカウントを削除する"), "確認のシート");
    await click(button("アカウントを削除する"));
    await waitFor(() => account.deleted === 1 && document.querySelector("[data-join-card]"), "削除のあとの参加のカード");
    expect(heard).toEqual(["じぶん", null]);
  });
});
