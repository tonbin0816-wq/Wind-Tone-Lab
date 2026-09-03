import { OTHER_BRAND } from "./catalog/gear.js";
import { PERIOD_FIELD, isStatsFresh } from "./stats.js";

// ------------------------------------------------------------------
// 順位と機材の内訳。**どちらも公開ユーザーの配列を受け取って数えるだけの純粋な関数。**
// 通信はしない(directory.js の仕事)ので、そのまま検査できる。
// ------------------------------------------------------------------

// ============ 順位 ============

/**
 * 練習日数の多い順に並べる。
 *
 * 【古い値を捨てるのがこの関数の芯】stats はアプリを開いたときにしか書き換わらない。
 * 先月たくさん練習してその後開いていない人の daysThisMonth は先月の値のままなので、
 * そのまま並べると**今月の順位に先月の成績で並ぶ**。isStatsFresh で期間外を落とす。
 *
 * 落とされた人は「その期間の練習が0日の人」として順位に出ない。これは正しい ──
 * 今月一度も開いていないなら今月の練習は0日である。
 */
export function rankByPractice(users, period, now = new Date()) {
  const field = PERIOD_FIELD[period];
  if (!field) return [];
  const rows = [];
  for (const u of users ?? []) {
    const s = u?.stats;
    if (!s) continue; // まだ一度も公開していない人
    if (!isStatsFresh(s.computedAt, period, now)) continue;
    const days = s[field];
    // 型が壊れた値を並べない。ルールは int を要求しているが、
    // 「読む側で守る」(設計書の宿題2への裁定)をここでも守る。
    if (!Number.isInteger(days) || days < 0) continue;
    if (days === 0) continue; // 0日の人を順位に並べても意味が無い
    rows.push({ ...u, days });
  }
  // 【同点の並びを安定させる】days だけで比べると、読み込むたびに同点の人の順が入れ替わり、
  // 見るたび順位が違って見える。uid で決着させて毎回同じ並びにする。
  rows.sort((a, b) => (b.days - a.days) || String(a.uid).localeCompare(String(b.uid)));
  // 【同点は同順位。次は人数ぶん飛ばす】1位が2人なら次は3位。
  let rank = 0;
  let prev = null;
  return rows.map((r, i) => {
    if (r.days !== prev) { rank = i + 1; prev = r.days; }
    return { ...r, rank };
  });
}

/** 順位の一覧から自分の行を探す。圏外なら null。 */
export function findMyRank(ranked, uid) {
  return (ranked ?? []).find((r) => r.uid === uid) ?? null;
}

// ============ 機材の内訳 ============

// 未選択を表す印。**「その他」とは別物として数える。**
// 2026-09-02 に機材は必須になったが、それ以前のドキュメントと、ルールを直接叩いた
// 書き込みには null が残る。未選択を「その他」に混ぜると内訳が実態より「その他」に寄る。
export const UNSET = "__unset__";

const SLOTS = {
  instrument: ["instrumentBrand", "instrumentModel"],
  mouthpiece: ["mpBrand", "mpModel"],
  ligature: ["ligBrand", "ligModel"],
  reed: ["reedBrand", "reedModel"],
};
export const GEAR_SLOTS = Object.keys(SLOTS);
export const SLOT_LABEL = { instrument: "楽器", mouthpiece: "マウスピース", ligature: "リガチャー", reed: "リード" };

/** 機材1つを数えるための鍵。null は UNSET、その他は OTHER_BRAND のまま。 */
export function gearKey(brand, model) {
  if (brand === null || brand === undefined) return UNSET;
  if (brand === OTHER_BRAND) return OTHER_BRAND;
  return model ? `${brand} ${model}` : brand;
}

/**
 * 選んだ楽器種別について、機材の内訳を数える。
 * @returns { [slot]: [{ key, count, ratio }] } count の多い順
 */
export function tallyGear(users, saxType) {
  const counters = {};
  for (const slot of GEAR_SLOTS) counters[slot] = new Map();
  let total = 0;

  for (const u of users ?? []) {
    const g = u?.gear?.[saxType];
    if (!g) continue; // その種別を吹かない人
    total++;
    for (const [slot, [bKey, mKey]] of Object.entries(SLOTS)) {
      const k = gearKey(g[bKey], g[mKey]);
      counters[slot].set(k, (counters[slot].get(k) ?? 0) + 1);
    }
  }

  const out = {};
  for (const slot of GEAR_SLOTS) {
    out[slot] = [...counters[slot].entries()]
      .map(([key, count]) => ({ key, count, ratio: total > 0 ? count / total : 0 }))
      // 同数のときは鍵で決着させる。並べ替えが安定しないと、見るたび順が変わる。
      .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
  }
  return { total, slots: out };
}

/**
 * 人気の組み合わせ。
 * @param depth 2 = マウスピース×リード / 3 = 楽器×マウスピース×リード /
 *              4 = 楽器×マウスピース×リガチャー×リード
 */
export const COMBO_SLOTS = {
  2: ["mouthpiece", "reed"],
  3: ["instrument", "mouthpiece", "reed"],
  4: ["instrument", "mouthpiece", "ligature", "reed"],
};

export function tallyCombos(users, saxType, depth) {
  const slots = COMBO_SLOTS[depth];
  if (!slots) return { total: 0, combos: [] };
  const counter = new Map();
  let total = 0;
  for (const u of users ?? []) {
    const g = u?.gear?.[saxType];
    if (!g) continue;
    const parts = slots.map((slot) => {
      const [bKey, mKey] = SLOTS[slot];
      return gearKey(g[bKey], g[mKey]);
    });
    // 【1つでも未選択なら組み合わせに数えない】未選択を含む組は
    // 「その組み合わせを使っている人」を表さない。人気の組み合わせとしては嘘になる。
    if (parts.includes(UNSET)) continue;
    total++;
    const key = parts.join(" / ");
    const cur = counter.get(key) ?? { key, parts, count: 0 };
    cur.count++;
    counter.set(key, cur);
  }
  const combos = [...counter.values()]
    .map((c) => ({ ...c, ratio: total > 0 ? c.count / total : 0 }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
  return { total, combos };
}
