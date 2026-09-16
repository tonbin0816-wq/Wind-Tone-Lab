import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { computePracticeStats, isStatsFresh, validateStats, STATS_MAX, STATS_KEYS, STATS_REQUIRED_KEYS, STATS_SEC_KEYS, PERIOD_FIELD, PERIOD_FIELD_SEC, PERIOD_PHRASE, PERIODS } from "./stats.js";

// 2026-09-03 は木曜。週の始まり(月曜)は 2026-08-31。
const NOW = new Date(2026, 8, 3, 12, 0, 0); // 月は0始まりなので 8 = 9月
const at = (y, m, d, h = 12) => ({ recordedAt: new Date(y, m, d, h).toISOString() });
// 【C9】練習時間つきの計測。frames は 0.1 秒間隔で全部が発音(pitchCents あり)なので、
// sessionSoundingSec = フレーム数 × 0.1 = sec。**録音の長さではなく発音の時間**が足されることを
// 見るために、末尾に無音フレーム(pitchCents null)を 10 個足しておく(録音長は sec + 1.0)。
// step はフレーム間隔(秒)。大きな秒数の検査だけ粗くする(フレーム数を抑えるため)。
const withSec = (y, m, d, sec, h = 12, step = 0.1) => {
  const n = Math.round(sec / step);
  const frames = [];
  for (let i = 0; i < n; i++) frames.push({ t: i * step, pitchCents: 0 });
  for (let i = 0; i < 10; i++) frames.push({ t: (n + i) * step, pitchCents: null });
  return { ...at(y, m, d, h), frames };
};

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
      expect(r.secAll).toBe(0);
      expect(Object.keys(r).sort()).toEqual([...STATS_KEYS].sort());
    }
  });

  // ---- 【C9 2026-09-16】練習時間(整数秒) ----
  it("練習時間は各計測の発音時間(sessionSoundingSec)を日数と同じ暦の境界で足す", () => {
    const r = computePracticeStats([
      withSec(2026, 8, 3, 30),   // 木 今週・今月・今年
      withSec(2026, 8, 3, 12, 9),  // 同じ日の朝にもう1件 → 日数は増えないが秒は足す(NOW は 12 時。夕方だと未来扱い)
      withSec(2026, 7, 30, 100), // 8/30 日 → 先週・先月・今年
      withSec(2025, 5, 5, 7),    // 去年 → 累計だけ
      at(2026, 8, 1),            // frames の無い計測 → 秒は 0(日数には入る)
    ], NOW);
    expect(r.daysThisWeek).toBe(2);
    expect(r.secThisWeek).toBe(42);
    expect(r.secThisMonth).toBe(42);
    expect(r.secThisYear).toBe(142);
    expect(r.secAll).toBe(149);
  });
  it("練習時間は録音の長さではない(無音フレームは足さない)", () => {
    // withSec は末尾に 1.0 秒の無音を持つ。録音長で数えると 31 になる。
    const r = computePracticeStats([withSec(2026, 8, 3, 30)], NOW);
    expect(r.secAll).toBe(30);
  });
  it("練習時間は整数秒に丸める(ルールの is int)", () => {
    // 0.1 秒刻み 3 フレーム = 0.3 秒 → 0。7 フレーム = 0.7 秒 → 1。
    const r = computePracticeStats([withSec(2026, 8, 3, 0.3), withSec(2026, 8, 2, 0.7)], NOW);
    expect(Number.isInteger(r.secThisWeek)).toBe(true);
    expect(r.secThisWeek).toBe(1);
    for (const k of STATS_SEC_KEYS) expect(Number.isInteger(r[k])).toBe(true);
  });
  it("練習時間も上限で頭打ちにする", () => {
    // 1件で 20 時間(72000秒)を 10 件 → 72万秒。週の上限 604800 で止まる(月以上は届かない)。
    const many = [];
    for (let i = 0; i < 10; i++) many.push(withSec(2026, 8, 3, 72000, 1 + i, 100));
    const r = computePracticeStats(many, NOW);
    expect(r.secThisWeek).toBe(STATS_MAX.secThisWeek);
    expect(r.secThisMonth).toBe(720000);
    expect(r.secThisYear).toBe(720000);
    expect(r.secAll).toBe(720000);
  });
  it("未来の計測は練習時間にも入れない", () => {
    const r = computePracticeStats([withSec(2027, 0, 1, 50), withSec(2026, 8, 3, 5)], NOW);
    expect(r.secAll).toBe(5);
  });
});

describe("キーと上限の表", () => {
  it("STATS_KEYS は9キー = 必須5 + 練習時間4(順序も固定)", () => {
    expect(STATS_KEYS).toEqual(["daysThisWeek", "daysThisMonth", "daysThisYear", "daysAll", "computedAt",
      "secThisWeek", "secThisMonth", "secThisYear", "secAll"]);
    expect(STATS_REQUIRED_KEYS.length).toBe(5);
    expect(STATS_SEC_KEYS.length).toBe(4);
  });
  it("練習時間の上限は定義上の最大値(週 7日 / 月 31日 / 年 366日 × 86400、累計 100年)", () => {
    expect(STATS_MAX.secThisWeek).toBe(7 * 86400);
    expect(STATS_MAX.secThisMonth).toBe(31 * 86400);
    expect(STATS_MAX.secThisYear).toBe(366 * 86400);
    expect(STATS_MAX.secAll).toBe(100 * 365 * 86400);
  });
  it("期間 → キーの対応は日数と秒で同じ期間を持つ", () => {
    expect(Object.keys(PERIOD_FIELD_SEC)).toEqual(Object.keys(PERIOD_FIELD));
    for (const p of PERIODS) {
      expect(STATS_SEC_KEYS).toContain(PERIOD_FIELD_SEC[p]);
      expect(STATS_REQUIRED_KEYS).toContain(PERIOD_FIELD[p]);
    }
  });
  it("文の中の期間は助詞込み。「すべて」は「すべての期間で」(C5・C6)", () => {
    expect(PERIOD_PHRASE).toEqual({ week: "今週で", month: "今月で", year: "今年で", all: "すべての期間で" });
    for (const p of PERIODS) expect(PERIOD_PHRASE[p].endsWith("で")).toBe(true);
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
  const ok = {
    daysThisWeek: 3, daysThisMonth: 12, daysThisYear: 140, daysAll: 320, computedAt: NOW.toISOString(),
    secThisWeek: 3600, secThisMonth: 40000, secThisYear: 500000, secAll: 900000,
  };
  it("正しい形(9キー)は通る", () => {
    expect(validateStats(ok).error).toBeUndefined();
  });
  it("整数でない・負・上限超えを弾く", () => {
    for (const bad of ["3", 3.5, -1, null, undefined, NaN]) {
      expect(validateStats({ ...ok, daysThisWeek: bad })).toHaveProperty("error");
      expect(validateStats({ ...ok, secThisWeek: bad })).toHaveProperty("error");
    }
    expect(validateStats({ ...ok, daysThisWeek: 8 })).toHaveProperty("error");   // 週は7日まで
    expect(validateStats({ ...ok, daysThisMonth: 32 })).toHaveProperty("error"); // 月は31日まで
    expect(validateStats({ ...ok, secThisWeek: 604801 })).toHaveProperty("error");   // 週は 604800 秒まで
    expect(validateStats({ ...ok, secAll: 3153600001 })).toHaveProperty("error");
    expect(validateStats({ ...ok, secThisWeek: 604800 }).error).toBeUndefined();  // 上限ちょうどは通る
  });
  it("キーの過不足を弾く(練習時間の4キーも**このアプリでは必須**)", () => {
    const { daysAll, ...missing } = ok;
    expect(validateStats(missing)).toHaveProperty("error");
    const { secAll, ...noSec } = ok;
    expect(validateStats(noSec)).toHaveProperty("error");
    expect(validateStats({ ...ok, おまけ: 1 })).toHaveProperty("error");
  });
  it("computedAt が読めないと弾く", () => {
    expect(validateStats({ ...ok, computedAt: "ごみ" })).toHaveProperty("error");
    expect(validateStats({ ...ok, computedAt: 12345 })).toHaveProperty("error");
  });
});

describe("firestore.rules との同期", () => {
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  // 改行と空白を1つに潰す(hasOnly の9キーは rules 側で2行に折り返している)。
  const flat = rules.replace(/\s+/g, " ");
  it("stats の8項目(日数4 + 秒4)の上限がルールと一致する", () => {
    // 【食い違うと本番でしか壊れない】実装が通す値をルールが弾くと、
    // 公開の瞬間に permission-denied になる。手元にルールは無いので気づけない。
    expect(Object.keys(STATS_MAX).length).toBe(8);
    for (const [k, max] of Object.entries(STATS_MAX)) {
      expect(rules).toContain(`request.resource.data.stats.${k} is int`);
      expect(rules).toContain(`request.resource.data.stats.${k} >= 0`);
      expect(rules).toContain(`request.resource.data.stats.${k} <= ${max}`);
    }
  });
  it("hasAll は必須5キーのまま、hasOnly は9キー(練習時間の4キーは任意)", () => {
    const list = (keys) => "[" + keys.map((k) => `'${k}'`).join(",") + "]";
    expect(flat).toContain(`request.resource.data.stats.keys().hasAll(${list(STATS_REQUIRED_KEYS)})`);
    // hasOnly は rules 側で折り返しているので、空白を除いて比べる。
    const only = /request\.resource\.data\.stats\.keys\(\)\.hasOnly\(\[([^\]]*)\]\)/.exec(flat);
    expect(only).not.toBeNull();
    expect(only[1].replace(/\s+/g, "").split(",")).toEqual(STATS_KEYS.map((k) => `'${k}'`));
    // 【古いアプリを締め出さない】sec* を hasAll に入れると、ルール公開からアプリ配信までの間、
    // 5キーしか書かない古いアプリの書き込みが全滅する。
    for (const k of STATS_SEC_KEYS) {
      expect(flat).not.toMatch(new RegExp(`hasAll\\(\\[[^\\]]*'${k}'`));
      expect(flat).toContain(`(!('${k}' in request.resource.data.stats) || (`);
    }
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
