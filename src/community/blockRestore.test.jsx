// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便BE 2026-09-30】アカウント引継の**読み戻し**でブロックの一覧が戻る。
// 別の端末で書き出したファイル(ブロック中の人が1人)を、この端末で読み戻して(writeAll)、
// アプリを起動し直した(このファイルのモジュールは読み込みたて = 保存の読み込みが冷えている)姿を描く。
//   ・その人は最初から一覧に居ない・みんなの平均の母数にも入っていない
//   ・マイページの「ブロック中の人」は1人で、名前はファイルに書かれた写しのまま
// 古い形式(ブロックの鍵が無いファイル)は blockRestoreOld.test.jsx(起動し直しをファイルで分けている)。
// ------------------------------------------------------------------
globalThis.indexedDB = createFakeIndexedDb();

vi.mock("./directory.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(async () => kit.SERVER_USERS), publishStats: vi.fn(async () => {}) };
});
vi.mock("./reportRepo.js", async () => ({
  listFlaggedUids: vi.fn(async () => new Set()), isFlagged: vi.fn(async () => false), reportUser: vi.fn(async () => {}),
}));
vi.mock("./idealRepo.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listIdeals: vi.fn(async () => kit.SERVER_IDEALS), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) };
});

const { JoinedView } = await import("./CommunityTab.jsx");
const { warmPersistedStateCache } = await import("../App.jsx");
const { writeAll } = await import("../backup/localStore.js");
const { buildSnapshot, validateSnapshot } = await import("../backup/snapshot.js");
const { setupDom, teardownDom, drawJoined, bodyText, rankRowOf, blockedRow, click, goSubTab, dialogNamed, waitFor } = await import("./blockKit.testutil.jsx");

beforeEach(setupDom);
afterEach(teardownDom);

describe("引継のファイルを読み戻すと、ブロックの一覧も戻る", () => {
  // 【便BE】上限 30 秒の理由は blockJoined.test.jsx と同じ(本物の画面を描く長い検査)。
  it("書き出したファイル(ブロック中 1人)→ 読み戻し → 起動: その人は居ない・マイページは1人", { timeout: 30000 }, async () => {
    // 別の端末の書き出し(BackupPanel と同じ道: buildSnapshot → JSON の文字列 → parse → validateSnapshot)
    const other = buildSnapshot({
      kv: {
        saxType: "alto",
        blockedUsers: [{ uid: "u3", nickname: "みけねこ(ブロックしたときの名前)", icon: "ic-cat", iconColor: 3, blockedAt: "2026-09-29T12:00:00.000Z" }],
      },
      sessions: [],
    });
    const file = JSON.parse(JSON.stringify(other));
    const checked = validateSnapshot(file);
    expect(checked.ok).toBe(true);
    await writeAll({ kv: checked.data.kv, sessions: checked.data.sessions });

    // 起動し直し(main.jsx と同じく、描く前に保存の読み込みを温める)。
    await drawJoined(JoinedView, {}, undefined, warmPersistedStateCache);
    await waitFor(() => bodyText().includes("目安を公開している3人"), "保存したブロックの一覧の読み込み");
    expect(rankRowOf("しろねこ")).toBeTruthy();
    expect(rankRowOf("みけねこ")).toBeFalsy();
    expect(bodyText()).not.toContain("みけねこ");
    expect(bodyText()).toContain("目安を公開している3人");

    await goSubTab("マイページ");
    expect(blockedRow().textContent).toBe("ブロック中の人1人");
    await click(blockedRow());
    // 名前はファイルに書かれた写しのまま(サーバーの今の名前ではない)
    expect(dialogNamed("ブロック中の人").textContent).toContain("みけねこ(ブロックしたときの名前)");
  });
});
