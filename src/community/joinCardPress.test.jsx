// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便CD 2026-10-08 本人「それ以下の利用規約やボタン自体もいらない」・統括の裁定】参加のカードを押すと参加が始まる。
// 本物の CommunityTab(参加前 → カードを押す → 匿名のアカウントを作る → プロフィールの入力)を描いて確かめる。
//   ・まだ誰でもない(getSignedInUid が null)人がカードを押すと、ensureSignedIn(匿名のアカウントを作る唯一の口)が1回だけ呼ばれ、
//     プロフィールの入力(「プロフィールを作る」)へ進む = 以前の「参加する」と同じ処理
//   ・準備中(ensureSignedIn が返る前)はカードが aria-disabled になり、押しても・Enter でも2回目は呼ばれない
//   ・カードの外(暗幕・枠)を押しても参加は始まらず、カードは消えない
//   ・失敗したら今までどおりエラーの画面(通信の失敗の文)
// サーバーは作り物(accountRepo / directory / idealRepo / reportRepo を差し替える。Firebase に触らない・アカウントを作らない)。
// ------------------------------------------------------------------

globalThis.indexedDB = createFakeIndexedDb();
const account = vi.hoisted(() => ({ release: null, fail: false }));
vi.mock("./accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => null),
  loadProfile: vi.fn(async () => null),
  saveProfile: vi.fn(async () => {}),
  watchMyPhoto: vi.fn(() => () => {}),
  // 返すのを検査が決める(準備中の間を作るため)
  ensureSignedIn: vi.fn(() => new Promise((resolve, reject) => {
    account.release = () => (account.fail ? reject(new Error("検査: 通信の失敗")) : resolve("me"));
  })),
}));
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
const repo = await import("./accountRepo.js");
const kit = await import("./blockKit.testutil.jsx");
const { setupDom, teardownDom, waitFor, bodyText, buttonsNamed, click } = kit;

const joinCard = () => document.querySelector('[data-join-card][role="button"][aria-label="参加する"]');
const formShown = () => buttonsNamed("プロフィールを作る").length > 0;
let host = null; let root = null;
beforeEach(() => {
  setupDom();
  account.release = null; account.fail = false;
  repo.ensureSignedIn.mockClear();
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
  await waitFor(() => joinCard(), "参加のカード");
}

describe("【便CD】参加のカードを押すと参加が始まる", () => {
  it("カードを押す → 匿名のアカウントを1回作る → プロフィールの入力へ進む(カードは消える)", async () => {
    await drawTab();
    expect(repo.ensureSignedIn).not.toHaveBeenCalled();   // 描いただけでは作らない(覗いて去った人にアカウントを残さない)
    expect(formShown()).toBe(false);
    await click(joinCard());
    expect(repo.ensureSignedIn).toHaveBeenCalledTimes(1);
    await act(async () => { account.release(); });
    await waitFor(() => formShown(), "プロフィールの入力");
    expect(document.querySelector("[data-join-card]")).toBe(null);
    expect(document.querySelector("[data-join-layer]")).toBe(null);
    expect(repo.ensureSignedIn).toHaveBeenCalledTimes(1);
  });

  it("準備中(アカウントを作り終える前)は押せない: aria-disabled・押しても Enter でも2回目は呼ばれない。終われば入力へ", async () => {
    await drawTab();
    await click(joinCard());
    expect(joinCard().getAttribute("aria-disabled")).toBe("true");
    await click(joinCard());
    await act(async () => { joinCard().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(repo.ensureSignedIn).toHaveBeenCalledTimes(1);
    expect(formShown()).toBe(false);
    await act(async () => { account.release(); });
    await waitFor(() => formShown(), "プロフィールの入力");
    expect(repo.ensureSignedIn).toHaveBeenCalledTimes(1);
  });

  it("カードの外(暗幕・枠)を押しても参加は始まらず、カードは消えない(外を押しても閉じない例外のまま)", async () => {
    await drawTab();
    await click(document.querySelector(".coach-dim"));
    await click(document.querySelector(".join-frame"));
    await click(document.querySelector("[data-join-preview]"));
    expect(repo.ensureSignedIn).not.toHaveBeenCalled();
    expect(joinCard()).not.toBe(null);
  });

  it("作れなかったら今までどおりエラーの画面(通信の失敗の文と「もう一度試す」)", async () => {
    await drawTab();
    account.fail = true;
    await click(joinCard());
    await act(async () => { account.release(); });
    await waitFor(() => bodyText().includes("通信に失敗しました"), "エラーの画面");
    expect(buttonsNamed("もう一度試す")).toHaveLength(1);
    expect(document.querySelector("[data-join-card]")).toBe(null);
  });
});
