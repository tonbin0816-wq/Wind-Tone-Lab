import { describe, it, expect } from "vitest";
import { rankByPractice, findMyRank, tallyGear, tallyCombos, gearKey, UNSET, GEAR_SLOTS } from "./aggregate.js";
import { filterUsers, isFiltered, ANY } from "./directory.js";
import { OTHER_BRAND } from "./catalog/gear.js";

const NOW = new Date(2026, 8, 3, 12); // 2026-09-03(木)
const iso = (y, m, d) => new Date(y, m, d, 12).toISOString();

const person = (uid, over = {}) => ({
  uid, nickname: uid, saxTypes: ["alto"], genres: ["クラシック"], position: "社会人",
  gear: { alto: { instrumentBrand: "YAMAHA", instrumentModel: "YAS-62", mpBrand: "Selmer", mpModel: "S80 C*", ligBrand: "Rovner", ligModel: "Dark", reedBrand: "Vandoren", reedModel: "Traditional" } },
  stats: { daysThisWeek: 3, daysThisMonth: 10, daysThisYear: 100, daysAll: 300, computedAt: iso(2026, 8, 3) },
  ...over,
});

describe("rankByPractice", () => {
  it("練習日数の多い順に並び、順位が入る", () => {
    const r = rankByPractice([
      person("a", { stats: { ...person("a").stats, daysThisMonth: 5 } }),
      person("b", { stats: { ...person("b").stats, daysThisMonth: 20 } }),
      person("c", { stats: { ...person("c").stats, daysThisMonth: 12 } }),
    ], "month", NOW);
    expect(r.map((x) => x.uid)).toEqual(["b", "c", "a"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(r[0].days).toBe(20);
  });

  // ここがこの関数の芯
  it("期間外に計算された古い値を捨てる(先月の成績で今月の順位に並ばせない)", () => {
    const stale = person("古", { stats: { daysThisWeek: 7, daysThisMonth: 28, daysThisYear: 200, daysAll: 500, computedAt: iso(2026, 7, 20) } });
    const fresh = person("新", { stats: { ...person("x").stats, daysThisMonth: 3 } });
    const month = rankByPractice([stale, fresh], "month", NOW);
    expect(month.map((x) => x.uid)).toEqual(["新"]); // 28日の人は今月には出ない
    // 「今年」なら 8/20 は今年の中なので使える
    const year = rankByPractice([stale, fresh], "year", NOW);
    expect(year.map((x) => x.uid)).toEqual(["古", "新"]);
    // 「すべて」は期間に依らないので必ず使える
    expect(rankByPractice([stale], "all", NOW).map((x) => x.uid)).toEqual(["古"]);
  });
  it("未来に計算された値は捨てる", () => {
    const future = person("未来", { stats: { ...person("x").stats, computedAt: iso(2027, 0, 1) } });
    expect(rankByPractice([future], "month", NOW)).toEqual([]);
  });
  it("同点は同順位で、次はその人数ぶん飛ぶ", () => {
    const r = rankByPractice([
      person("a", { stats: { ...person("x").stats, daysThisMonth: 10 } }),
      person("b", { stats: { ...person("x").stats, daysThisMonth: 10 } }),
      person("c", { stats: { ...person("x").stats, daysThisMonth: 4 } }),
    ], "month", NOW);
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3]);
  });
  it("同点の並びが毎回同じになる(見るたび順が変わらない)", () => {
    const mk = () => [
      person("z", { stats: { ...person("x").stats, daysThisMonth: 10 } }),
      person("a", { stats: { ...person("x").stats, daysThisMonth: 10 } }),
    ];
    const first = rankByPractice(mk(), "month", NOW).map((x) => x.uid);
    const second = rankByPractice(mk().reverse(), "month", NOW).map((x) => x.uid);
    expect(first).toEqual(second);
  });
  it("stats が無い人・0日の人・壊れた値は並べない", () => {
    const rows = rankByPractice([
      person("statsなし", { stats: undefined }),
      person("ゼロ", { stats: { ...person("x").stats, daysThisMonth: 0 } }),
      person("文字列", { stats: { ...person("x").stats, daysThisMonth: "10" } }),
      person("小数", { stats: { ...person("x").stats, daysThisMonth: 3.5 } }),
      person("負", { stats: { ...person("x").stats, daysThisMonth: -5 } }),
      person("正常"),
    ], "month", NOW);
    expect(rows.map((x) => x.uid)).toEqual(["正常"]);
  });
  it("知らない期間では空を返す(黙って全員を並べない)", () => {
    expect(rankByPractice([person("a")], "そんな期間", NOW)).toEqual([]);
  });
  it("圏外の自分は findMyRank が null を返す", () => {
    const r = rankByPractice([person("a")], "month", NOW);
    expect(findMyRank(r, "a").rank).toBe(1);
    expect(findMyRank(r, "私")).toBeNull();
  });
});

describe("filterUsers", () => {
  const users = [
    person("a", { saxTypes: ["alto"], genres: ["クラシック"], position: "社会人" }),
    person("b", { saxTypes: ["tenor"], genres: ["ジャズ"], position: "学生" }),
    person("c", { saxTypes: ["alto", "tenor"], genres: ["クラシック", "ジャズ"], position: "学生" }),
  ];
  it("指定なしなら全員通る", () => {
    expect(filterUsers(users, {}).length).toBe(3);
    expect(isFiltered({})).toBe(false);
  });
  it("掛け持ちの人は、どちらの楽器で絞っても出る", () => {
    expect(filterUsers(users, { saxType: "alto" }).map((u) => u.uid)).toEqual(["a", "c"]);
    expect(filterUsers(users, { saxType: "tenor" }).map((u) => u.uid)).toEqual(["b", "c"]);
  });
  it("3条件の掛け算になる", () => {
    expect(filterUsers(users, { saxType: "alto", genre: "ジャズ", position: "学生" }).map((u) => u.uid)).toEqual(["c"]);
    expect(filterUsers(users, { saxType: "alto", genre: "ジャズ", position: "社会人" })).toEqual([]);
    expect(isFiltered({ saxType: "alto" })).toBe(true);
  });
  it("項目が壊れている人を通さない(配列でない genres 等)", () => {
    const broken = [{ uid: "x", saxTypes: "alto", genres: null, position: "社会人" }];
    expect(filterUsers(broken, { saxType: "alto" })).toEqual([]);
    expect(filterUsers(broken, { genre: "クラシック" })).toEqual([]);
    expect(filterUsers([null, undefined], {})).toEqual([]);
  });
});

describe("tallyGear", () => {
  const g = (over) => ({ instrumentBrand: "YAMAHA", instrumentModel: "YAS-62", mpBrand: "Selmer", mpModel: "S80 C*", ligBrand: "Rovner", ligModel: "Dark", reedBrand: "Vandoren", reedModel: "Traditional", ...over });

  it("4種すべての内訳を、多い順に数える", () => {
    const r = tallyGear([
      person("a", { gear: { alto: g() } }),
      person("b", { gear: { alto: g() } }),
      person("c", { gear: { alto: g({ mpBrand: "Meyer", mpModel: "MR-404" }) } }),
    ], "alto");
    expect(r.total).toBe(3);
    expect(Object.keys(r.slots).sort()).toEqual([...GEAR_SLOTS].sort());
    expect(r.slots.instrument[0]).toMatchObject({ key: "YAMAHA YAS-62", count: 3, ratio: 1 });
    expect(r.slots.mouthpiece.map((x) => x.count)).toEqual([2, 1]);
  });
  it("その種別を吹かない人は母数に入らない", () => {
    const r = tallyGear([person("a", { gear: { alto: g() } }), person("b", { gear: { tenor: g() } })], "alto");
    expect(r.total).toBe(1);
  });

  // ここが一番間違えやすい
  it("未選択(null)と「その他」を別々に数える", () => {
    const r = tallyGear([
      person("未選択", { gear: { alto: g({ reedBrand: null, reedModel: null }) } }),
      person("その他", { gear: { alto: g({ reedBrand: OTHER_BRAND, reedModel: null }) } }),
    ], "alto");
    const keys = r.slots.reed.map((x) => x.key);
    expect(keys).toContain(UNSET);
    expect(keys).toContain(OTHER_BRAND);
    expect(UNSET).not.toBe(OTHER_BRAND);
    // 混ぜると内訳が実態より「その他」に寄る
    expect(r.slots.reed.find((x) => x.key === OTHER_BRAND).count).toBe(1);
  });
  it("型番の無い銘柄は銘柄だけを鍵にする", () => {
    expect(gearKey("YAMAHA", null)).toBe("YAMAHA");
    expect(gearKey("YAMAHA", "YAS-62")).toBe("YAMAHA YAS-62");
    expect(gearKey(null, null)).toBe(UNSET);
    expect(gearKey(undefined, undefined)).toBe(UNSET);
  });
  it("誰も居なければ 0 で返る(0除算しない)", () => {
    const r = tallyGear([], "alto");
    expect(r.total).toBe(0);
    expect(r.slots.reed).toEqual([]);
  });
});

describe("tallyCombos", () => {
  const g = (over) => ({ instrumentBrand: "YAMAHA", instrumentModel: "YAS-62", mpBrand: "Selmer", mpModel: "S80 C*", ligBrand: "Rovner", ligModel: "Dark", reedBrand: "Vandoren", reedModel: "Traditional", ...over });
  it("段数ごとに違う組み合わせを数える", () => {
    const users = [
      person("a", { gear: { alto: g() } }),
      person("b", { gear: { alto: g({ instrumentBrand: "Yanagisawa", instrumentModel: "A-WO10" }) } }),
    ];
    // 2項目(マウスピース×リード)は楽器が違っても同じ組
    expect(tallyCombos(users, "alto", 2).combos[0].count).toBe(2);
    // 3項目(楽器を含む)は別の組に割れる
    expect(tallyCombos(users, "alto", 3).combos.map((c) => c.count)).toEqual([1, 1]);
    expect(tallyCombos(users, "alto", 4).combos[0].parts).toHaveLength(4);
  });
  it("1つでも未選択を含む人は組み合わせに数えない", () => {
    // 未選択を含む組は「その組み合わせを使っている人」を表さない
    const r = tallyCombos([
      person("a", { gear: { alto: g() } }),
      person("欠", { gear: { alto: g({ ligBrand: null, ligModel: null }) } }),
    ], "alto", 4);
    expect(r.total).toBe(1);
  });
  it("知らない段数では空を返す", () => {
    expect(tallyCombos([person("a")], "alto", 5)).toEqual({ total: 0, combos: [] });
  });
});
