import { describe, it, expect } from "vitest";
import {
  BLOCKED_USERS_KEY, normalizeBlockedList, blockedUidSet,
  addBlocked, removeBlocked, hideBlocked, hideBlockedIdeals,
} from "./block.js";
import { rankByPractice, tallyGearByBrand } from "./aggregate.js";
import { cohortAverage } from "./align.js";

// ------------------------------------------------------------------
// 【便BE 2026-09-30 本人裁定「B」】ブロックの純関数。
// 守るもの: 落とす / 自分は落とさない / 解除で戻る / 母数(順位・シェア・みんなの平均)から消える /
//           表示用の名前とアイコンはブロックした時点の写し / 壊れた・古い保存値でも壊れない。
// 守らないもの: 画面の配線(block.test.jsx・blockJoined.test.jsx が見る)。
// ------------------------------------------------------------------

const U = (uid, extra = {}) => ({
  uid, nickname: `n-${uid}`, saxTypes: ["alto"], genres: [], position: "学生",
  stats: { daysAll: 3, secAll: 600 },
  gear: { alto: { instrumentBrand: `B-${uid}`, instrumentModel: "M" } },
  ...extra,
});
const USERS = [U("a"), U("b"), U("c"), U("me")];

// 目安: 5音ぶん。人ごとに形を変える(平均が人を落としたことで**実際に動く**ように)。
const KEYS = [14, 16, 18, 20, 22];
const IDEAL = (uid, base) => ({
  id: `${uid}_alto`, ownerUid: uid, saxType: "alto", sourceSessionCount: 3,
  notes: Object.fromEntries(KEYS.map((k, i) => [k, { spectralCentroidHz: base + i * (base / 20), hnrDb: 15 + i + base / 1000, pitchCentsSigned: 0 }])),
});
// みんなの平均は3人未満だと出ない(align.js の MIN_COHORT)ので、1人落としても出る4人にしておく。
const IDEALS = [IDEAL("a", 1400), IDEAL("b", 2400), IDEAL("c", 1500), IDEAL("d", 1600)];

describe("hideBlocked — 落とす・自分は落とさない・解除で戻る", () => {
  it("ブロックした人だけが落ちる", () => {
    const list = addBlocked([], U("b"));
    expect(hideBlocked(USERS, list, "me").map((u) => u.uid)).toEqual(["a", "c", "me"]);
  });
  it("自分は落とさない(一覧が壊れて自分が入っていても)", () => {
    const broken = [{ uid: "me", nickname: "自分" }, { uid: "a", nickname: "a" }];
    expect(hideBlocked(USERS, broken, "me").map((u) => u.uid)).toEqual(["b", "c", "me"]);
  });
  it("解除すると戻る(並びも元のまま)", () => {
    let list = addBlocked([], U("b"));
    list = addBlocked(list, U("c"));
    expect(hideBlocked(USERS, list, "me").map((u) => u.uid)).toEqual(["a", "me"]);
    list = removeBlocked(list, "b");
    expect(hideBlocked(USERS, list, "me").map((u) => u.uid)).toEqual(["a", "b", "me"]);
    list = removeBlocked(list, "c");
    expect(hideBlocked(USERS, list, "me")).toEqual(USERS);
  });
  it("空の一覧・鍵の無い値(古い引継のファイル)では誰も落ちない", () => {
    expect(hideBlocked(USERS, [], "me")).toEqual(USERS);
    expect(hideBlocked(USERS, undefined, "me")).toEqual(USERS);
    expect(hideBlocked(USERS, { b: true }, "me")).toEqual(USERS);
  });
  it("目安は所有者(ownerUid)で落ちる", () => {
    const list = addBlocked([], U("b"));
    expect(hideBlockedIdeals(IDEALS, list, "me").map((i) => i.ownerUid)).toEqual(["a", "c", "d"]);
    expect(hideBlockedIdeals(IDEALS, removeBlocked(list, "b"), "me").map((i) => i.ownerUid)).toEqual(["a", "b", "c", "d"]);
  });
  // 【便BG 2026-10-01】以前は report.js の hideFlagged / hideFlaggedIdeals を借りていた。あちらを消して
  // 同じ規則を block.js へ移したので、report.test.js にあった hideFlagged の検査のうち、ここに無かったものを移した。
  it("myUid を渡さなければ自分も落ちる(自分を残すのは myUid を渡したときだけ)", () => {
    const broken = [{ uid: "me", nickname: "自分" }];
    expect(hideBlocked(USERS, broken).map((u) => u.uid)).toEqual(["a", "b", "c"]);
    expect(hideBlocked(USERS, broken, "me").map((u) => u.uid)).toEqual(["a", "b", "c", "me"]);
  });
  it("目安も自分のものは残す(一覧が壊れて自分が入っていても)", () => {
    const withMine = [...IDEALS, IDEAL("me", 1700)];
    const broken = [{ uid: "me", nickname: "自分" }, { uid: "b", nickname: "b" }];
    expect(hideBlockedIdeals(withMine, broken, "me").map((i) => i.ownerUid)).toEqual(["a", "c", "d", "me"]);
  });
  it("名簿や目安が null / undefined でも壊れない(空を返す)", () => {
    const list = addBlocked([], U("b"));
    expect(hideBlocked(null, list, "me")).toEqual([]);
    expect(hideBlocked(undefined, list, "me")).toEqual([]);
    expect(hideBlockedIdeals(null, list, "me")).toEqual([]);
  });
});

describe("母数から消える(数える前に落とす)", () => {
  const list = addBlocked([], U("b"));
  it("順位: 人数が減り、ブロックした人の行が無い", () => {
    const before = rankByPractice(USERS, "all");
    const after = rankByPractice(hideBlocked(USERS, list, "me"), "all");
    expect(before).toHaveLength(4);
    expect(after).toHaveLength(3);
    expect(after.some((r) => r.uid === "b")).toBe(false);
  });
  it("シェア: ブロックした人の楽器のメーカーが数から消える", () => {
    const brands = (users) => JSON.stringify(tallyGearByBrand(users, "alto", "instrument"));
    expect(brands(USERS)).toContain("B-b");
    expect(brands(hideBlocked(USERS, list, "me"))).not.toContain("B-b");
  });
  it("みんなの平均: 人数が減り、平均の値も変わる(解除すると元に戻る)", () => {
    const all = cohortAverage(IDEALS);
    const hidden = cohortAverage(hideBlockedIdeals(IDEALS, list, "me"));
    const back = cohortAverage(hideBlockedIdeals(IDEALS, removeBlocked(list, "b"), "me"));
    expect(all.count).toBe(4);
    expect(hidden.count).toBe(3);
    expect(JSON.stringify(hidden)).not.toBe(JSON.stringify(all));
    expect(JSON.stringify(back)).toBe(JSON.stringify(all));
  });
  // 【便BO2 2026-10-02】倍音構成の平均からも、ブロックした人の分が外れる(解除すると戻る)。期待値は手計算。
  it("みんなの平均の倍音構成: ブロックした人の分が外れる", () => {
    const H = { a: [1, 0], b: [0, 1], c: [1, 0], d: [1, 0] };
    const withH = IDEALS.map((x) => ({ ...x, notes: Object.fromEntries(Object.entries(x.notes).map(([k, v]) => [k, { ...v, harmonics: H[x.ownerUid] }])) }));
    const list = addBlocked([], U("b"));
    const all = cohortAverage(withH).notes["14"].harmonics;
    const hidden = cohortAverage(hideBlockedIdeals(withH, list, "me")).notes["14"].harmonics;
    expect(all.n).toBe(4);
    expect(all.value[0]).toBeCloseTo(0.75, 9);
    expect(all.value[1]).toBeCloseTo(0.25, 9);
    expect(hidden.n).toBe(3);
    expect(hidden.value[0]).toBeCloseTo(1, 9);
    expect(hidden.value[1]).toBeCloseTo(0, 9);
    const back = cohortAverage(hideBlockedIdeals(withH, removeBlocked(list, "b"), "me")).notes["14"].harmonics;
    expect(back).toEqual(all);
  });
});

describe("addBlocked / removeBlocked / normalizeBlockedList", () => {
  const at = new Date("2026-09-30T01:02:03Z");
  it("uid・ニックネーム・アイコン(あるものだけ)・ブロックした日時を写す", () => {
    const person = { uid: "p", nickname: "しろねこ", icon: "ic-cat", iconColor: 3, photo: "https://x/p.jpg", gear: { alto: {} }, stats: { daysAll: 9 } };
    expect(addBlocked([], person, at)).toEqual([
      { uid: "p", nickname: "しろねこ", icon: "ic-cat", iconColor: 3, photo: "https://x/p.jpg", blockedAt: "2026-09-30T01:02:03.000Z" },
    ]);
    // 写真の無い人は photo を持たない(null を書かない)
    expect(addBlocked([], { uid: "q", nickname: "q", icon: "ic-dog", iconColor: 0, photo: null }, at)[0])
      .toEqual({ uid: "q", nickname: "q", icon: "ic-dog", iconColor: 0, blockedAt: "2026-09-30T01:02:03.000Z" });
  });
  it("名前とアイコンはブロックした時点の写し(あとで元の人が変わっても一覧は変わらない)", () => {
    const person = { uid: "p", nickname: "まえ", icon: "ic-cat", iconColor: 1 };
    const list = addBlocked([], person, at);
    person.nickname = "あと"; person.icon = "ic-dog";
    expect(list[0].nickname).toBe("まえ");
    expect(list[0].icon).toBe("ic-cat");
  });
  it("同じ人は2回足さない・uid の無い人は足さない", () => {
    const one = addBlocked([], { uid: "p", nickname: "p" }, at);
    expect(addBlocked(one, { uid: "p", nickname: "別名" }, at)).toEqual(one);
    expect(addBlocked(one, { nickname: "uid なし" }, at)).toEqual(one);
    expect(addBlocked(one, null, at)).toEqual(one);
  });
  it("足した順に並ぶ", () => {
    const list = addBlocked(addBlocked([], { uid: "x", nickname: "x" }, at), { uid: "y", nickname: "y" }, at);
    expect(list.map((e) => e.uid)).toEqual(["x", "y"]);
  });
  it("解除はその人だけを外す(居ない uid は何もしない)", () => {
    const list = addBlocked(addBlocked([], { uid: "x" }, at), { uid: "y" }, at);
    expect(removeBlocked(list, "x").map((e) => e.uid)).toEqual(["y"]);
    expect(removeBlocked(list, "zzz").map((e) => e.uid)).toEqual(["x", "y"]);
  });
  it("壊れた保存値を整える: 配列でなければ空・uid の無い項目と重複は捨てる", () => {
    expect(normalizeBlockedList(undefined)).toEqual([]);
    expect(normalizeBlockedList(null)).toEqual([]);
    expect(normalizeBlockedList("x")).toEqual([]);
    expect(normalizeBlockedList({ uid: "a" })).toEqual([]);
    expect(normalizeBlockedList([null, 3, { nickname: "uid 無し" }, { uid: "" }, { uid: "a", nickname: "1" }, { uid: "a", nickname: "2" }]))
      .toEqual([{ uid: "a", nickname: "1" }]);
    expect([...blockedUidSet([{ uid: "a" }, { uid: "b" }, { x: 1 }])]).toEqual(["a", "b"]);
  });
  it("型をそろえる: nickname は文字列でなければ \"\"、icon・iconColor・photo・blockedAt は型が合わなければ捨てる", () => {
    expect(normalizeBlockedList([
      { uid: "a", nickname: { x: 1 }, icon: 3, iconColor: "red", photo: {}, blockedAt: 5, extra: "捨てる" },
      { uid: "b", nickname: "ok", icon: "ic-cat", iconColor: 2, photo: "https://x/p.jpg", blockedAt: "2026-09-30T00:00:00.000Z" },
      { uid: "c", nickname: 12, iconColor: 1.5, icon: "" },
    ])).toEqual([
      { uid: "a", nickname: "" },
      { uid: "b", nickname: "ok", icon: "ic-cat", iconColor: 2, photo: "https://x/p.jpg", blockedAt: "2026-09-30T00:00:00.000Z" },
      { uid: "c", nickname: "" },
    ]);
  });
  it("保存の鍵の綴りは blockedUsers(変えると保存済みの一覧と引継のファイルが読めなくなる)", () => {
    expect(BLOCKED_USERS_KEY).toBe("blockedUsers");
  });
});
