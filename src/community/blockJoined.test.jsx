// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便BE 2026-09-30 本人裁定「B」】ブロックの結合の検査。コミュニティの本物の画面(JoinedView)を描いて押す。
//   ・人物のページからブロック → 人物のページが閉じ、その人が順位・データの一覧・みんなの平均の人数から
//     **読み直しなしで**消える(サーバーの読み取りは最初の1回のまま・サーバーへは何も書かない)
//   ・一覧は**この端末の保存(IndexedDB の kv)**に入り、アカウント引継の書き出し(readAll → buildSnapshot)に載る
//   ・マイページの「ブロック中の人」から解除 → その場で戻る。保存からも外れる
// サーバーは作り物(directory / reportRepo / idealRepo の読み書きだけを差し替える)。
// IndexedDB は作り物(fakeIndexedDb.testutil.js)── usePersistedState と引継の readAll が**同じ入れ物**を読む。
// 【守っていないもの】ブラウザでの見た目(dev サーバで確かめる。コミュニティは Firebase の設定が無いと描かれない)。
// ------------------------------------------------------------------

const fakeIdb = createFakeIndexedDb();
globalThis.indexedDB = fakeIdb;

vi.mock("./directory.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(async () => kit.SERVER_USERS), publishStats: vi.fn(async () => {}) };
});
vi.mock("./reportRepo.js", async () => ({
  listFlaggedUids: vi.fn(async () => new Set()), isFlagged: vi.fn(async () => false), reportUser: vi.fn(async () => {}),
}));
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
const { listPublicUsers, publishStats } = await import("./directory.js");
const { listIdeals, publishMyIdeals } = await import("./idealRepo.js");
const { reportUser } = await import("./reportRepo.js");
const { readAll } = await import("../backup/localStore.js");
const { buildSnapshot, validateSnapshot } = await import("../backup/snapshot.js");
const { BLOCKED_USERS_KEY } = await import("./block.js");
const kit = await import("./blockKit.testutil.jsx");
const { setupDom, teardownDom, drawJoined, bodyText, buttonsNamed, dialogNamed, rankRowOf, blockedRow, click, goSubTab, waitForValue } = kit;

beforeEach(setupDom);
afterEach(teardownDom);

// 書き出しと同じ道: readAll → buildSnapshot → JSON → 読み戻しの検査
const exportedBlocked = async () => {
  const snap = JSON.parse(JSON.stringify(buildSnapshot(await readAll())));
  expect(validateSnapshot(snap).ok).toBe(true);
  return snap.kv[BLOCKED_USERS_KEY];
};

describe("ブロック → 一覧から消える → 保存と引継に載る → 解除で戻る", () => {
  // 【便BE】本物の画面を4枚描いて押し進める長い検査なので、上限は既定の 5 秒ではなく 30 秒
  // (全検査を2本並走させた重い状態で 5 秒に当たった。待ちは状態がそろうまでの形なので、軽いときは 1 秒台で終わる)。
  it("一連の流れ", { timeout: 30000 }, async () => {
    await drawJoined(JoinedView, {}, undefined, warmPersistedStateCache);
    // 最初は4人とも居る。みんなの平均は4人
    expect(bodyText()).toContain("くろねこ");
    expect(rankRowOf("くろねこ")).toBeTruthy();
    expect(bodyText()).toContain("目安を公開している4人");
    // 人を開ける行(role="button")は 順位の4行 + データの一覧の4行(横スワイプの4枚は同時に描かれている)
    const rankRows = () => [...document.querySelectorAll('[role="button"]')].filter((el) => Object.values(kit.NICK).some((n) => el.textContent.includes(n)));
    expect(rankRows()).toHaveLength(8);
    expect(listPublicUsers).toHaveBeenCalledTimes(1);
    expect(listIdeals).toHaveBeenCalledTimes(1);
    const writesBefore = { stats: publishStats.mock.calls.length, ideals: publishMyIdeals.mock.calls.length };

    // 人物のページを開いてプロフィール面へ → ブロック → 確認 → ブロックする
    await click(rankRowOf("くろねこ"));
    const sheet = dialogNamed("くろねこ の詳細");
    expect(sheet).not.toBe(null);
    await click([...sheet.querySelectorAll('[role="radio"]')].find((b) => b.textContent.trim() === "プロフィール"));
    await click(buttonsNamed("この人をブロック")[0]);
    expect(dialogNamed("くろねこ をブロックしますか")).not.toBe(null);
    await click(buttonsNamed("ブロックする")[0]);

    // 確認のシートも人物のページも閉じている
    expect(dialogNamed("くろねこ をブロックしますか")).toBe(null);
    expect(dialogNamed("くろねこ の詳細")).toBe(null);
    // その人は画面のどこにも居ない(順位・データの一覧・シェア)。みんなの平均の母数も減る
    expect(bodyText()).not.toContain("くろねこ");
    expect(rankRows()).toHaveLength(6);
    expect(bodyText()).toContain("目安を公開している3人");
    expect(bodyText()).toContain("しろねこ");
    // 読み直していない・サーバーへは何も書いていない(通報も送っていない)
    expect(listPublicUsers).toHaveBeenCalledTimes(1);
    expect(listIdeals).toHaveBeenCalledTimes(1);
    expect(reportUser).not.toHaveBeenCalled();
    expect(publishStats.mock.calls.length).toBe(writesBefore.stats);
    expect(publishMyIdeals.mock.calls.length).toBe(writesBefore.ideals);

    // この端末に保存され、アカウント引継の書き出しに載る(名前とアイコンはブロックした時点の写し)
    const saved = await waitForValue(exportedBlocked, (v) => Array.isArray(v) && v.length > 0, "保存にブロックの一覧が入る");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ uid: "u2", nickname: "くろねこ", icon: "ic-cat", iconColor: 2 });
    expect(typeof saved[0].blockedAt).toBe("string");
    expect(Number.isNaN(Date.parse(saved[0].blockedAt))).toBe(false);

    // マイページの「ブロック中の人」は1人。開いて解除
    await goSubTab("マイページ");
    expect(blockedRow().textContent).toBe("ブロック中の人1人");
    await click(blockedRow());
    const list = dialogNamed("ブロック中の人");
    expect(list.textContent).toContain("くろねこ");
    await click([...list.querySelectorAll("button")].find((b) => b.textContent.trim() === "解除"));

    // その場で戻る(読み直しなし)。シートは「いません」、行は0人
    expect(dialogNamed("ブロック中の人").textContent).toContain("ブロック中の人はいません");
    expect(blockedRow().textContent).toBe("ブロック中の人0人");
    expect(rankRowOf("くろねこ")).toBeTruthy();
    expect(rankRows()).toHaveLength(8);
    expect(bodyText()).toContain("目安を公開している4人");
    expect(listPublicUsers).toHaveBeenCalledTimes(1);
    expect(await waitForValue(exportedBlocked, (v) => Array.isArray(v) && v.length === 0, "保存から外れる")).toEqual([]);
  });

});
