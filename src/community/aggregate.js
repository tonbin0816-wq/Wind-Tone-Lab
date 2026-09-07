import { OTHER_BRAND } from "./catalog/gear.js";
import { PERIOD_FIELD, isStatsFresh } from "./stats.js";

// ------------------------------------------------------------------
// 順位と楽器の組の内訳。**どちらも公開ユーザーの配列を受け取って数えるだけの純粋な関数。**
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

// ============ 楽器の組の内訳 ============

// 未選択を表す印。**「その他」とは別物として数える。**
// 2026-09-02 に楽器の組は必須になったが、それ以前のドキュメントと、ルールを直接叩いた
// 書き込みには null が残る。未選択を「その他」に混ぜると内訳が実態より「その他」に寄る。
export const UNSET = "__unset__";

// 3つ目の要素は「銘柄・型番に続けて数える値」。リードだけが番手を持つ。
const SLOTS = {
  instrument: ["instrumentBrand", "instrumentModel"],
  mouthpiece: ["mpBrand", "mpModel"],
  ligature: ["ligBrand", "ligModel"],
  reed: ["reedBrand", "reedModel", "reedStrength"],
};
export const GEAR_SLOTS = Object.keys(SLOTS);
export const SLOT_LABEL = { instrument: "楽器", mouthpiece: "マウスピース", ligature: "リガチャー", reed: "リード" };

/**
 * 楽器の組1つを数えるための鍵。null は UNSET、その他は OTHER_BRAND のまま。
 *
 * 【extra は番手(リードのみ) 2026/09/06 本人裁定「含める」】
 * 「Vandoren Traditional」と「Vandoren Traditional 3.0」を別の票にする。
 * ・「その他」は番手が付いても「その他」のまま ── 型番でまとめないのと同じ理屈で、
 *   カタログ外を細かく割っても読めるものにならない。
 * ・番手を持たない古いドキュメント(ルールが null を許している)は番手なしの票になる。
 *   同じリードでも保存し直すまで別の票に見えるが、勝手に「3.0 だろう」と埋めるよりよい。
 */
export function gearKey(brand, model, extra) {
  if (brand === null || brand === undefined) return UNSET;
  if (brand === OTHER_BRAND) return OTHER_BRAND;
  const base = model ? `${brand} ${model}` : brand;
  return extra ? `${base} ${extra}` : base;
}

/**
 * **画面に出す綴り。数えるための鍵(gearKey)とは別物。**
 *
 * 型番があれば型番だけを返す。メーカー名を繰り返さない理由は2つ:
 * ・どの枠が何かは、すぐ上で選んでいる「楽器 × マウスピース × リード」が既に言っている
 *   (同じことを2度言わない。§6.0)
 * ・375px に鍵の綴りは入らない。2026/09/07 の実測で、人気の組み合わせは
 *   **5行すべてが切れて**いた(使える幅 285px に対し 410〜461px 必要)。
 *   メーカー名を落とすと 2項目・3項目は収まる(4項目だけは 370px で最後が省略記号)。
 *
 * 型番を持たないもの(メーカーだけ登録・「その他」・未選択)は今までどおりの綴り。
 * 番手は型番の一部として残す ── 番手を含めて別の票にしているので、消すと
 * 「同じ名前で人数の違う行」ができる。
 */
export function gearDisplay(brand, model, extra) {
  if (brand === null || brand === undefined) return UNSET;
  if (brand === OTHER_BRAND) return OTHER_BRAND;
  const base = model || brand;
  return extra ? `${base} ${extra}` : base;
}

/**
 * 選んだ楽器種別について、楽器の組の内訳を数える。
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
    for (const [slot, [bKey, mKey, xKey]] of Object.entries(SLOTS)) {
      const k = gearKey(g[bKey], g[mKey], xKey ? g[xKey] : undefined);
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

// ============ 内訳を2段にする(メーカー段 → 型番段) ============
//
// 【既存の gearKey を壊さないこと】gearKey は「銘柄 型番 番手」を1つの鍵にする関数で、
// tallyGear と tallyCombos の両方が使っている。2段の内訳はそこに手を入れず**別に足す**。
// 1段目は型番で割らないので、メーカーの人気がそのまま読める。

/** メーカー段の鍵。型番でも番手でも割らない。 */
export function brandKey(brand) {
  if (brand === null || brand === undefined) return UNSET;
  return brand; // OTHER_BRAND もそのまま1票(下の段では割れない)
}

/**
 * 型番段の鍵。**銘柄を除いた「型番」**。リードだけ番手まで付ける
 * (2026/09/06 本人指示「リードは型番段で番手まで出してよい」)。
 * 銘柄は選んだが型番が無いドキュメントは「未選択」として数える ── 勝手に埋めない。
 */
export function modelKey(model, extra) {
  if (model === null || model === undefined || model === "") return UNSET;
  return extra ? `${model} ${extra}` : model;
}

/**
 * その鍵を「掘り下げられるか」。**円グラフのタップ可否はこの1つの関数で決める。**
 * ・「その他」はカタログ外なので、割っても読めるものにならない(gearKey と同じ理屈)
 * ・「未選択」は割る中身が無い
 */
export function isDrillable(key) {
  return key !== UNSET && key !== OTHER_BRAND && key !== null && key !== undefined;
}

/**
 * 1段目。楽器種別を選んで、**メーカーだけ**で内訳を数える。
 * @returns { total, slots: { [slot]: [{ key, count, ratio }] } }
 */
export function tallyGearByBrand(users, saxType) {
  const counters = {};
  for (const slot of GEAR_SLOTS) counters[slot] = new Map();
  let total = 0;

  for (const u of users ?? []) {
    const g = u?.gear?.[saxType];
    if (!g) continue; // その種別を吹かない人
    total++;
    for (const [slot, [bKey]] of Object.entries(SLOTS)) {
      const k = brandKey(g[bKey]);
      counters[slot].set(k, (counters[slot].get(k) ?? 0) + 1);
    }
  }

  const out = {};
  for (const slot of GEAR_SLOTS) {
    out[slot] = [...counters[slot].entries()]
      .map(([key, count]) => ({ key, count, ratio: total > 0 ? count / total : 0 }))
      .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
  }
  return { total, slots: out };
}

/**
 * 2段目。**そのメーカーを選んでいる人だけ**を母数にして、型番で数える。
 * 割合はメーカー内の割合(全体の割合ではない)。
 * 掘り下げられない鍵(その他 / 未選択)は空を返す ── isDrillable と同じ線で切る。
 * @returns { total, items: [{ key, count, ratio }] }
 */
export function tallyGearModels(users, saxType, slot, brand) {
  const cols = SLOTS[slot];
  if (!cols || !isDrillable(brand)) return { total: 0, items: [] };
  const [bKey, mKey, xKey] = cols;
  const counter = new Map();
  let total = 0;
  for (const u of users ?? []) {
    const g = u?.gear?.[saxType];
    if (!g) continue;
    if (g[bKey] !== brand) continue;
    total++;
    const k = modelKey(g[mKey], xKey ? g[xKey] : undefined);
    counter.set(k, (counter.get(k) ?? 0) + 1);
  }
  const items = [...counter.entries()]
    .map(([key, count]) => ({ key, count, ratio: total > 0 ? count / total : 0 }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
  return { total, items };
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
      const [bKey, mKey, xKey] = SLOTS[slot];
      return gearKey(g[bKey], g[mKey], xKey ? g[xKey] : undefined);
    });
    // 【1つでも未選択なら組み合わせに数えない】未選択を含む組は
    // 「その組み合わせを使っている人」を表さない。人気の組み合わせとしては嘘になる。
    if (parts.includes(UNSET)) continue;
    // 画面に出す綴り。**数えるのは parts のまま** ── labels で数えると、
    // 別のメーカーが同じ型番を使っていたときに票が1つに混ざる。
    const labels = slots.map((slot) => {
      const [bKey, mKey, xKey] = SLOTS[slot];
      return gearDisplay(g[bKey], g[mKey], xKey ? g[xKey] : undefined);
    });
    total++;
    const key = parts.join(" / ");
    const cur = counter.get(key) ?? { key, parts, labels, count: 0 };
    cur.count++;
    counter.set(key, cur);
  }
  const combos = [...counter.values()]
    .map((c) => ({ ...c, ratio: total > 0 ? c.count / total : 0 }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
  return { total, combos };
}
