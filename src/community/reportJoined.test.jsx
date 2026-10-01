// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便BG 2026-10-01 本人指示】通報しても一覧から消えない。コミュニティの本物の画面(JoinedView)を描いて押す。
//   ・通報を送っても、その人は順位・データの一覧・みんなの平均の人数に**残る**(読み直しも無い)
//   ・通報のあとの「ブロックしない」→ 人物のページに戻り、一覧もそのまま。ブロックの一覧は空のまま
//   ・もう一度通報して「ブロックする」→ 人物のページが閉じ、その人は一覧から消え、ブロックの一覧(保存)に入る
//   ・flags を読まない: reportRepo の作り物は reportUser **しか持たない**。画面が listFlaggedUids / isFlagged を
//     使おうとすれば、作り物に無い名前を読んだところで落ちる(名簿が出ず、この検査は待ちの期限で落ちる)
// サーバーは作り物(directory / reportRepo / idealRepo)。IndexedDB も作り物(blockJoined.test.jsx と同じ)。
// 【守っていないもの】reports に書く中身と flags に書かないこと(reportRepo.test.js)。ブラウザでの見た目。
// ------------------------------------------------------------------

const fakeIdb = createFakeIndexedDb();
globalThis.indexedDB = fakeIdb;

vi.mock("./directory.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(async () => kit.SERVER_USERS), publishStats: vi.fn(async () => {}) };
});
vi.mock("./reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));
vi.mock("./idealRepo.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return {
    ...(await orig()),
    listIdeals: vi.fn(async () => kit.SERVER_IDEALS),
    publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}),
  };
});

const { JoinedView } = await import("./CommunityTab.jsx");
const { warmPersistedStateCache } = await import("../App.jsx");
const { listPublicUsers } = await import("./directory.js");
const { listIdeals } = await import("./idealRepo.js");
const { reportUser } = await import("./reportRepo.js");
const { readAll } = await import("../backup/localStore.js");
const { BLOCKED_USERS_KEY } = await import("./block.js");
const { REPORT_REASONS } = await import("./report.js");
const kit = await import("./blockKit.testutil.jsx");
const { setupDom, teardownDom, drawJoined, bodyText, buttonsNamed, dialogNamed, rankRowOf, click, waitForValue } = kit;

beforeEach(setupDom);
afterEach(teardownDom);

const savedBlocked = async () => (await readAll())?.kv?.[BLOCKED_USERS_KEY];
const rankRows = () => [...document.querySelectorAll('[role="button"]')].filter((el) => Object.values(kit.NICK).some((n) => el.textContent.includes(n)));
const inDialog = (label, name) => [...dialogNamed(label).querySelectorAll("button")].filter((b) => b.textContent.trim() === name);

async function reportFromPage(nick) {
  await click(rankRowOf(nick));
  const page = dialogNamed(`${nick} の詳細`);
  expect(page).not.toBe(null);
  await click([...page.querySelectorAll('[role="radio"]')].find((b) => b.textContent.trim() === "プロフィール"));
  await click(buttonsNamed("通報")[0]);
  await click(inDialog("この人を通報", REPORT_REASONS[0])[0]);
  await click(inDialog("この人を通報", "通報する")[0]);
  await kit.waitFor(() => dialogNamed("通報しました") !== null, "通報のあとの問い");
}

describe("通報しても一覧から消えない(便BG)", () => {
  it("通報 → ブロックしない: 残る / もう一度通報 → ブロックする: 消えてブロックの一覧に入る", { timeout: 30000 }, async () => {
    await drawJoined(JoinedView, {}, undefined, warmPersistedStateCache);
    expect(rankRows()).toHaveLength(8);
    expect(bodyText()).toContain("目安を公開している4人");

    // 1回目: 通報 → ブロックしない
    await reportFromPage("くろねこ");
    expect(reportUser).toHaveBeenCalledTimes(1);
    expect(reportUser.mock.calls[0][0]).toMatchObject({ targetUid: "u2", reporterUid: "me", reason: REPORT_REASONS[0] });
    expect(dialogNamed("通報しました").textContent).toContain("この奏者をブロックしますか");
    // 問いが出ている間も、裏の一覧から消えていない
    expect(rankRows()).toHaveLength(8);
    await click(inDialog("通報しました", "ブロックしない")[0]);
    expect(dialogNamed("通報しました")).toBe(null);
    expect(dialogNamed("くろねこ の詳細")).not.toBe(null); // 人物のページに戻る
    // 一覧もみんなの平均の人数もそのまま。読み直しもしていない
    expect(rankRowOf("くろねこ")).toBeTruthy();
    expect(rankRows()).toHaveLength(8);
    expect(bodyText()).toContain("目安を公開している4人");
    expect(listPublicUsers).toHaveBeenCalledTimes(1);
    expect(listIdeals).toHaveBeenCalledTimes(1);
    // ブロックの一覧には何も入っていない
    const before = await savedBlocked();
    expect(Array.isArray(before) ? before : []).toHaveLength(0);

    // 人物のページを閉じて、同じ人をもう一度通報 → ブロックする
    await click(dialogNamed("くろねこ の詳細").querySelector('button[aria-label="閉じる"]'));
    expect(dialogNamed("くろねこ の詳細")).toBe(null);
    await reportFromPage("くろねこ");
    expect(reportUser).toHaveBeenCalledTimes(2);
    await click(inDialog("通報しました", "ブロックする")[0]);
    // シートも人物のページも閉じ、ブロックの確認のシートは重ねて出ていない
    expect(dialogNamed("通報しました")).toBe(null);
    expect(dialogNamed("くろねこ の詳細")).toBe(null);
    expect(dialogNamed("くろねこ をブロックしますか")).toBe(null);
    // その人は一覧から消え、みんなの平均の人数も減る(ブロックで消えた)
    expect(bodyText()).not.toContain("くろねこ");
    expect(rankRows()).toHaveLength(6);
    expect(bodyText()).toContain("目安を公開している3人");
    expect(listPublicUsers).toHaveBeenCalledTimes(1);
    const saved = await waitForValue(savedBlocked, (v) => Array.isArray(v) && v.length === 1, "ブロックの一覧に入る");
    expect(saved[0]).toMatchObject({ uid: "u2", nickname: "くろねこ" });
  });
});
