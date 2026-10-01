// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便BE 2026-09-30】古い形式の引継のファイル(便BE より前に書き出した = ブロックの鍵が無い)を読み戻しても壊れない。
//   ・この端末にブロック中の人が居ても、読み戻しは置き換えなので一覧は空になる(ファイルの中身が正)
//   ・起動すると誰も隠れておらず、マイページの「ブロック中の人」は0人
// 形式の版(SNAPSHOT_VERSION)は上げていない: ブロックの一覧は kv の1つの鍵で、kv は元から丸ごと書き出す。
// 新しいファイルを古いアプリで読んでも、知らない鍵が kv に残るだけで何も壊れない(拒む理由が無い)。
// ------------------------------------------------------------------
const fakeIdb = createFakeIndexedDb();
globalThis.indexedDB = fakeIdb;

vi.mock("./directory.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(async () => kit.SERVER_USERS), publishStats: vi.fn(async () => {}) };
});
vi.mock("./reportRepo.js", async () => ({
  // 【便BG 2026-10-01】listFlaggedUids / isFlagged は reportRepo.js から消えたので、作り物からも外した。
  reportUser: vi.fn(async () => ({ already: false })),
}));
vi.mock("./idealRepo.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listIdeals: vi.fn(async () => kit.SERVER_IDEALS), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) };
});

const { JoinedView } = await import("./CommunityTab.jsx");
const { warmPersistedStateCache } = await import("../App.jsx");
const { writeAll, readAll } = await import("../backup/localStore.js");
const { validateSnapshot, SNAPSHOT_VERSION } = await import("../backup/snapshot.js");
const { setupDom, teardownDom, drawJoined, bodyText, rankRowOf, blockedRow, click, goSubTab, dialogNamed } = await import("./blockKit.testutil.jsx");

beforeEach(setupDom);
afterEach(teardownDom);

describe("古い形式の引継のファイル(ブロックの鍵が無い)", () => {
  // 【便BE】上限 30 秒の理由は blockJoined.test.jsx と同じ。
  it("読み戻すと一覧は空で始まり、誰も隠れない", { timeout: 30000 }, async () => {
    // この端末ではもう1人ブロックしていた
    await writeAll({ kv: { blockedUsers: [{ uid: "u2", nickname: "くろねこ", blockedAt: "2026-09-29T00:00:00.000Z" }] }, sessions: [] });
    expect((await readAll()).kv.blockedUsers).toHaveLength(1);

    // 便BE より前の書き出し(版 1・kv にブロックの鍵が無い)。手で書いた JSON の文字列から読む
    const oldFile = JSON.parse('{"format":"ficus-backup","version":1,"exportedAt":"2026-09-20T00:00:00.000Z","counts":{"sessions":0,"frames":0},"kv":{"saxType":"alto","tuningHz":442},"sessions":[]}');
    expect(SNAPSHOT_VERSION).toBe(1); // 版を上げていない(上げると古いアプリが新しいファイルを拒む)
    const checked = validateSnapshot(oldFile);
    expect(checked.ok).toBe(true);
    await writeAll({ kv: checked.data.kv, sessions: checked.data.sessions });
    expect("blockedUsers" in (await readAll()).kv).toBe(false);

    // 起動し直し(main.jsx と同じく、描く前に保存の読み込みを温める)。
    await drawJoined(JoinedView, {}, undefined, warmPersistedStateCache);
    expect(rankRowOf("くろねこ")).toBeTruthy();
    expect(bodyText()).toContain("目安を公開している4人");
    await goSubTab("マイページ");
    expect(blockedRow().textContent).toBe("ブロック中の人0人");
    await click(blockedRow());
    expect(dialogNamed("ブロック中の人").textContent).toContain("ブロック中の人はいません");
  });
});
