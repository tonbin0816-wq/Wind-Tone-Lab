import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// ------------------------------------------------------------------
// 【便BG 2026-10-01 本人指示】通報は、運営に届く reports の書き込みだけにする。
//   ・書くのは reports/{target}_{reporter} の1つだけ。flags には書かない
//   ・二重通報(ルールが update を拒む = permission-denied)は失敗にせず already: true
//   ・それ以外の失敗(通信など)は投げる(画面はエラーを出し、ブロックは問わない)
//   ・flags を読む関数(listFlaggedUids / isFlagged)は無い。src のどこからも flags を読み書きしない
// Firestore は作り物(doc / setDoc だけ。書いた先の道を記録する)。
// 【守っていないもの】本物のルールでの可否(ルールは変えていない。report.test.js が綴りを見る)。
// ------------------------------------------------------------------
const writes = [];
let failWith = null;
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...path) => ({ path: path.join("/") }),
  setDoc: vi.fn(async (ref, data) => {
    writes.push({ path: ref.path, data });
    if (failWith) throw failWith;
  }),
}));
vi.mock("./firebaseClient.js", () => ({ getFirebase: () => ({ db: {} }) }));

const repo = await import("./reportRepo.js");
const { reportUser } = repo;
const NOW = new Date("2026-10-01T00:00:00Z");
const ARGS = { targetUid: "p1", reporterUid: "me", reason: "なりすまし" };

beforeEach(() => { writes.length = 0; failWith = null; });

describe("reportUser は reports に1つだけ書く", () => {
  it("書く先は reports/{target}_{reporter} の1つだけで、flags には書かない", async () => {
    await expect(reportUser(ARGS, NOW)).resolves.toEqual({ already: false });
    expect(writes.map((w) => w.path)).toEqual(["reports/p1_me"]);
    expect(writes[0].data).toEqual({
      targetUid: "p1", reporterUid: "me", reason: "なりすまし", createdAt: NOW.toISOString(), status: "open",
    });
    expect(writes.some((w) => w.path.startsWith("flags"))).toBe(false);
  });

  it("既に通報済み(permission-denied)は失敗にせず already: true。ほかには何も書かない", async () => {
    failWith = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    await expect(reportUser(ARGS, NOW)).resolves.toEqual({ already: true });
    expect(writes.map((w) => w.path)).toEqual(["reports/p1_me"]);
  });

  it("それ以外の失敗(通信など)はそのまま投げる", async () => {
    failWith = Object.assign(new Error("offline"), { code: "unavailable" });
    await expect(reportUser(ARGS, NOW)).rejects.toThrow("offline");
    failWith = new Error("code の無い失敗");
    await expect(reportUser(ARGS, NOW)).rejects.toThrow("code の無い失敗");
  });

  it("組めない通報(自分自身・理由なし)は書かずに投げる", async () => {
    await expect(reportUser({ ...ARGS, targetUid: "me" }, NOW)).rejects.toThrow();
    await expect(reportUser({ ...ARGS, reason: "自由記述" }, NOW)).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });
});

describe("flags を読み書きしない(便BG)", () => {
  it("reportRepo.js は flags を読む関数(listFlaggedUids / isFlagged)を持たない", () => {
    expect(repo.listFlaggedUids).toBeUndefined();
    expect(repo.isFlagged).toBeUndefined();
  });

  // 画面のコードのどこかが flags の集合を指したら落ちる。検査用のファイル(*.test.* / *.testutil.*)は見ない。
  it("src の本番のコードに flags の集合を指す doc / collection が1つも無い", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\.|\.testutil\./.test(name)) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(20); // 走査が空振りしていない
    expect(files.some((f) => f.endsWith("reportRepo.js"))).toBe(true);
    const hits = files.filter((f) => /\b(?:doc|collection)\([^)]*["'`]flags["'`/]/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
