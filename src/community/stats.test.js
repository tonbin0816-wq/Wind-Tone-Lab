import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { computePracticeStats, isStatsFresh, validateStats, STATS_MAX, STATS_KEYS } from "./stats.js";

// 2026-09-03 は木曜。週の始まり(月曜)は 2026-08-31。
const NOW = new Date(2026, 8, 3, 12, 0, 0); // 月は0始まりなので 8 = 9月
const at = (y, m, d, h = 12) => ({ recordedAt: new Date(y, m, d, h).toISOString() });

describe("computePracticeStats", () => {
  it("同じ日に何回録音しても1日として数える", () => {
    const r = computePracticeStats([at(2026, 8, 3, 9), at(2026, 8, 3, 14), at(2026, 8, 3, 20)], NOW);
    expect(r.daysAll).toBe(1);
    expect(r.daysThisWeek).toBe(1);
  });
  it("期間ごとに正しく切る(週は月曜始まり)", () => {
    const r = computePracticeStats([
      at(2026, 8, 3),  // 木 今週
      at(2026, 8, 1),  // 火 今週
      at(2026, 7, 31), // 8/31 月 → 今週の初日
      at(2026, 7, 30), // 8/30 日 → 先週。今月ではない
      at(2026, 8, 2),  // 水 今週
      at(2026, 0, 5),  // 1月 今年だが今月ではない
      at(2025, 5, 5),  // 去年
    ], NOW);
    expect(r.daysThisWeek).toBe(4);  // 8/31, 9/1, 9/2, 9/3
    expect(r.daysThisMonth).toBe(3); // 9/1, 9/2, 9/3
    expect(r.daysThisYear).toBe(6);  // 上の5件 + 1/5
    expect(r.daysAll).toBe(7);
  });
  it("日曜を前の週に置く(月曜始まりでなければ落ちる)", () => {
    // 8/30(日)は「先週」。日曜始まりで数えるとこれが今週に入って 1 になる。
    const r = computePracticeStats([at(2026, 7, 30)], NOW);
    expect(r.daysThisWeek).toBe(0);
  });
  it("recordedAt が無い・読めないセッションは数えない", () => {
    // 【NaN の日付を1件の日として数えないこと】"NaN-NaN-NaN" が Set に入ると、
    // 壊れたセッションが何件あっても「1日」が加算され、全員の日数が水増しされる。
    const r = computePracticeStats([{}, { recordedAt: null }, { recordedAt: "ごみ" }, at(2026, 8, 3)], NOW);
    expect(r.daysAll).toBe(1);
  });
  it("未来のセッションは数えない", () => {
    // 端末の時計が進んでいた時期の録音が混じると「今年」に来年の練習が入る。
    const r = computePracticeStats([at(2026, 8, 3), at(2027, 0, 1)], NOW);
    expect(r.daysAll).toBe(1);
    expect(r.daysThisYear).toBe(1);
  });
  it("上限で頭打ちにする(弾かずに通す)", () => {
    // 定義上超えないが、時計のずれ等で超えたときに公開そのものが失敗するより、
    // 頭打ちで通すほうがよい。
    const many = [];
    for (let i = 0; i < 400; i++) many.push(at(2026, 0, 1 + i, 12));
    const r = computePracticeStats(many, new Date(2026, 11, 31, 23));
    expect(r.daysThisYear).toBeLessThanOrEqual(STATS_MAX.daysThisYear);
    expect(r.daysThisWeek).toBeLessThanOrEqual(STATS_MAX.daysThisWeek);
  });
  it("セッションが無くても0で返る(例外にしない)", () => {
    for (const empty of [[], null, undefined]) {
      const r = computePracticeStats(empty, NOW);
      expect(r.daysAll).toBe(0);
      expect(Object.keys(r).sort()).toEqual([...STATS_KEYS].sort());
    }
  });
});

describe("isStatsFresh", () => {
  const iso = (y, m, d) => new Date(y, m, d, 12).toISOString();
  it("期間の中で計算された値だけを使う", () => {
    expect(isStatsFresh(iso(2026, 8, 3), "month", NOW)).toBe(true);
    expect(isStatsFresh(iso(2026, 7, 20), "month", NOW)).toBe(false); // 先月に計算
    expect(isStatsFresh(iso(2026, 7, 20), "year", NOW)).toBe(true);   // 今年ではある
    expect(isStatsFresh(iso(2025, 7, 20), "year", NOW)).toBe(false);
  });
  it("「すべて」は期間に依らないので常に使える", () => {
    expect(isStatsFresh(iso(2020, 0, 1), "all", NOW)).toBe(true);
  });
  it("未来に計算された値は捨てる(時計を進めて居座るのを塞ぐ)", () => {
    expect(isStatsFresh(iso(2027, 0, 1), "month", NOW)).toBe(false);
    expect(isStatsFresh(iso(2027, 0, 1), "week", NOW)).toBe(false);
  });
  it("読めない値と知らない期間は false", () => {
    expect(isStatsFresh("ごみ", "month", NOW)).toBe(false);
    expect(isStatsFresh(undefined, "month", NOW)).toBe(false);
    expect(isStatsFresh(iso(2026, 8, 3), "そんな期間", NOW)).toBe(false);
  });
});

describe("validateStats", () => {
  const ok = { daysThisWeek: 3, daysThisMonth: 12, daysThisYear: 140, daysAll: 320, computedAt: NOW.toISOString() };
  it("正しい形は通る", () => {
    expect(validateStats(ok).error).toBeUndefined();
  });
  it("整数でない・負・上限超えを弾く", () => {
    for (const bad of ["3", 3.5, -1, null, undefined, NaN]) {
      expect(validateStats({ ...ok, daysThisWeek: bad })).toHaveProperty("error");
    }
    expect(validateStats({ ...ok, daysThisWeek: 8 })).toHaveProperty("error");   // 週は7日まで
    expect(validateStats({ ...ok, daysThisMonth: 32 })).toHaveProperty("error"); // 月は31日まで
  });
  it("キーの過不足を弾く", () => {
    const { daysAll, ...missing } = ok;
    expect(validateStats(missing)).toHaveProperty("error");
    expect(validateStats({ ...ok, おまけ: 1 })).toHaveProperty("error");
  });
  it("computedAt が読めないと弾く", () => {
    expect(validateStats({ ...ok, computedAt: "ごみ" })).toHaveProperty("error");
    expect(validateStats({ ...ok, computedAt: 12345 })).toHaveProperty("error");
  });
});

describe("firestore.rules との同期", () => {
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  it("stats の4項目の上限がルールと一致する", () => {
    // 【食い違うと本番でしか壊れない】実装が通す値をルールが弾くと、
    // 公開の瞬間に permission-denied になる。手元にルールは無いので気づけない。
    for (const [k, max] of Object.entries(STATS_MAX)) {
      expect(rules).toContain(`request.resource.data.stats.${k} is int`);
      expect(rules).toContain(`request.resource.data.stats.${k} >= 0`);
      expect(rules).toContain(`request.resource.data.stats.${k} <= ${max}`);
    }
  });
  it("stats のキー集合がルールと一致する", () => {
    const list = "[" + STATS_KEYS.map((k) => `'${k}'`).join(",") + "]";
    expect(rules).toContain(`request.resource.data.stats.keys().hasAll(${list})`);
    expect(rules).toContain(`request.resource.data.stats.keys().hasOnly(${list})`);
  });
  it("公開している人だけが一覧に返る規則になっている", () => {
    // 【rules は絞り込みではない】一覧は返る1件ごとに評価されるので、
    // 非公開の人が1件でも当たるとクエリ全体が失敗する。つまりクライアントは
    // 必ず where("isPublic","==",true) を付けねばならない。付け忘れが事故にならない形。
    expect(rules).toContain("allow list: if resource.data.isPublic == true");
    // limit の無いクエリはコレクション全体を返しうるので拒否する
    expect(rules).toContain("request.query.limit <= 50");
    expect(rules).not.toContain("allow list: if false; // 一覧APIは計画2まで封鎖");
  });
});
