// 「自分は自分の順位から消えない」を、**規則そのものを動かして**確かめる。
//
// 【なぜここまでするのか】本人の端末で「プロフィールを保存すると順位から消える」が
// 3度直しても再発した。潰した原因は毎回本物だったが、どれも
// **自分が順位に出るかどうかをサーバの写しに委ねていた**という同じ根から生えていた。
//   便Q 保存が写しを消していた / 便S 読みが書きより先に終わる /
//   便W 差分の書き込みが古いキーを残し、以後の書き込みが拒まれる
// 委ねるのをやめたので、ここでは「委ねていないこと」を試験にする。
// サーバから何も返らなくても、写しが古くても、自分の行は必ず在る。

import { describe, it, expect } from "vitest";
import { withMyRow } from "./directory.js";

const ME = "me-uid";
const profile = {
  nickname: "わたし", icon: "ic-cat", iconColor: 1,
  saxTypes: ["alto"], position: "社会人", startYear: 2015,
  genres: ["クラシック"], ensembles: ["吹奏楽"], gear: { alto: {} },
  deviceClass: "pc", isPublic: true, ageConfirmed: true,
  updatedAt: "2026-09-21T00:00:00.000Z",
};
const stats = { daysThisWeek: 2, daysThisMonth: 9, daysThisYear: 40, daysAll: 120,
  computedAt: "2026-09-21T00:00:00.000Z" };
const other = (uid) => ({ uid, nickname: uid, isPublic: true, stats: { daysAll: 1 } });

describe("withMyRow — 自分の行は必ず在る", () => {
  it("サーバから1件も返らなくても自分は居る（読みが失敗・書きが拒まれた場合）", () => {
    const out = withMyRow([], ME, profile, stats);
    expect(out).toHaveLength(1);
    expect(out[0].uid).toBe(ME);
    expect(out[0].stats).toEqual(stats);
  });

  it("サーバの自分の行に練習記録が無くても、手元の記録で埋まる（読みが書きより先に終わった場合）", () => {
    const server = [{ uid: ME, nickname: "わたし", isPublic: true }, other("a")];
    const out = withMyRow(server, ME, profile, stats);
    expect(out.find((u) => u.uid === ME).stats).toEqual(stats);
  });

  it("サーバの写しが古くても、手元の記録が勝つ", () => {
    const server = [{ uid: ME, isPublic: true, stats: { daysAll: 0, computedAt: "2026-01-01" } }];
    const out = withMyRow(server, ME, profile, stats);
    expect(out[0].stats).toEqual(stats);
  });

  it("上限50の外に押し出されていても自分は足される", () => {
    const server = Array.from({ length: 50 }, (_, i) => other("u" + i));
    const out = withMyRow(server, ME, profile, stats);
    expect(out).toHaveLength(51);
    expect(out.some((u) => u.uid === ME)).toBe(true);
  });

  it("既に居るときは並びを動かさない（真ん中に居ればその位置のまま）", () => {
    const server = [other("a"), { uid: ME, isPublic: true }, other("b")];
    const out = withMyRow(server, ME, profile, stats);
    expect(out.map((u) => u.uid)).toEqual(["a", ME, "b"]);
  });

  it("非公開のときは差し込まない（むしろ取り除く）", () => {
    const server = [other("a"), { uid: ME, isPublic: true, stats }];
    const out = withMyRow(server, ME, { ...profile, isPublic: false }, stats);
    expect(out.map((u) => u.uid)).toEqual(["a"]);
  });

  it("他人の行には触らない", () => {
    const a = other("a");
    const out = withMyRow([a], ME, profile, stats);
    expect(out.find((u) => u.uid === "a")).toBe(a);
  });

  it("サーバの行が持っていて手元に無い項目は残す（差し替えで情報が減らない）", () => {
    const server = [{ uid: ME, isPublic: true, serverOnly: "残る" }];
    const out = withMyRow(server, ME, profile, stats);
    expect(out[0].serverOnly).toBe("残る");
    expect(out[0].nickname).toBe("わたし");
  });

  it("手元のプロフィールがサーバの写しより優先される（保存直後の値が出る）", () => {
    const server = [{ uid: ME, isPublic: true, nickname: "ふるいなまえ", stats }];
    const out = withMyRow(server, ME, { ...profile, nickname: "あたらしい" }, stats);
    expect(out[0].nickname).toBe("あたらしい");
  });

  it("練習記録がまだ数えられていないときは空の器を作らない", () => {
    const out = withMyRow([], ME, profile, null);
    expect("stats" in out[0]).toBe(false);
  });

  it("プロフィールがまだ無いとき（参加前）は何もしない", () => {
    const server = [other("a")];
    expect(withMyRow(server, ME, null, stats)).toBe(server);
    expect(withMyRow(server, null, profile, stats)).toBe(server);
  });

  it("一覧が null でも落ちない", () => {
    expect(withMyRow(null, ME, profile, stats)).toHaveLength(1);
  });
});

describe("withMyRow の結果は順位の数え方をそのまま通る", () => {
  it("練習日数が1日でもあれば順位の母集団に入る", async () => {
    const { rankByPractice } = await import("./aggregate.js");
    const out = withMyRow([], ME, profile, { ...stats, daysThisWeek: 1 });
    const rows = rankByPractice(out, "week", new Date("2026-09-21T12:00:00.000Z"), "days");
    expect(rows.some((r) => r.uid === ME)).toBe(true);
  });

  it("0日のときは並ばない（本人裁定: 0だけを落とす）", async () => {
    const { rankByPractice } = await import("./aggregate.js");
    const out = withMyRow([], ME, profile, { ...stats, daysThisWeek: 0 });
    const rows = rankByPractice(out, "week", new Date("2026-09-21T12:00:00.000Z"), "days");
    expect(rows.some((r) => r.uid === ME)).toBe(false);
  });
});
