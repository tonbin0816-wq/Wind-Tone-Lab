// ------------------------------------------------------------------
// 練習日数の集計。**端末の中のセッションから数えて、公開用の値を作る。**
//
// 【なぜ「日数」か】回数や音数だと、短い録音を並べるだけで水増しできる。
// 1日に何時間吹いても1日と数えるので、水増しの利得が小さい(2026-08-28 本人裁定)。
//
// 【この値は本人の端末が書く。改ざんは防げない】生の SDK を叩ける人は好きな数を書ける。
// ルールで書けるのは型と上限までで、その数が本物かはサーバにしか判定できない
// (ローカルのセッションはサーバに無い)。匿名アカウントの順位を偽って得るものが無いので
// 受け入れている。詳細は docs/superpowers/specs/2026-09-02-community-screens-design.md の決定3。
// ------------------------------------------------------------------

// 期間の上限。**改ざん対策ではなく、定義上ありえない値を弾くためのもの。**
// 桁違いの数字で画面が壊れることだけは防ぐ。
export const STATS_MAX = {
  daysThisWeek: 7,
  daysThisMonth: 31,
  daysThisYear: 366,
  daysAll: 36500, // 100年
};

export const STATS_KEYS = ["daysThisWeek", "daysThisMonth", "daysThisYear", "daysAll", "computedAt"];

// 【月曜始まりにする】日本の「今週」は月曜から数えるのが普通で、
// 日曜始まりにすると日曜に練習した人の週が翌週へずれて見える。
// getDay() は日曜が0なので、月曜を0にするために (day + 6) % 7 を使う。
function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

// 【日付は端末の地方時で切る】UTC で切ると、日本時間の朝8時までの練習が前日に数えられる。
// 「昨日と今日にまたがって練習した」ように見えるより、本人の感覚に合わせる。
function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * セッションから公開用の練習日数を作る。
 * @param sessions App.jsx が IndexedDB に持っているセッションの配列(recordedAt を持つ)
 * @param now 基準時刻
 */
export function computePracticeStats(sessions, now = new Date()) {
  const weekStart = startOfWeek(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  // 同じ日に何回録音しても1日。Set で日付そのものを数える。
  const all = new Set();
  const week = new Set();
  const month = new Set();
  const year = new Set();

  for (const s of sessions ?? []) {
    // 【文字列であることを先に見る】`new Date(null)` は Invalid ではなく **1970-01-01** を返す
    // (null が 0 に変換されるため)。型を見ずに Number.isNaN だけで弾こうとすると、
    // recordedAt が null のセッションが「1970年に練習した1日」として数えられる。
    // recordedAt は ISO 文字列で保存されているので、文字列でなければその時点で捨てる。
    if (typeof s?.recordedAt !== "string") continue;
    const t = new Date(s.recordedAt);
    // 【壊れた日付を数えない】読めない文字列は日数に入れない。
    // NaN の日付を Set に入れると "NaN-NaN-NaN" という1件の日として数えられてしまい、
    // 壊れたセッションが何件あっても1日ぶん水増しされる。
    if (Number.isNaN(t.getTime())) continue;
    // 【未来のセッションを数えない】端末の時計が進んでいた時期に録音したものが混じると、
    // 「今年」に来年の練習が入る。now より後は捨てる。
    if (t > now) continue;
    const k = dayKey(t);
    all.add(k);
    if (t >= yearStart) year.add(k);
    if (t >= monthStart) month.add(k);
    if (t >= weekStart) week.add(k);
  }

  // 上限で頭打ちにする。定義上超えないはずだが、時計のずれ等で超えたときに
  // ルールで弾かれて**公開そのものが失敗する**より、頭打ちで通すほうがよい。
  const cap = (n, key) => Math.min(n, STATS_MAX[key]);
  return {
    daysThisWeek: cap(week.size, "daysThisWeek"),
    daysThisMonth: cap(month.size, "daysThisMonth"),
    daysThisYear: cap(year.size, "daysThisYear"),
    daysAll: cap(all.size, "daysAll"),
    computedAt: now.toISOString(),
  };
}

/**
 * 読んだ stats がその期間のものとして使えるかを判定する。
 *
 * 【なぜ要るか】stats はアプリを開いたときにしか書き換わらない。
 * 先月たくさん練習してその後開いていない人の daysThisMonth は**先月の値のまま**で、
 * 放っておくと今月の順位に先月の成績で並ぶ。読む側で捨てる。
 *
 * 「すべて」は期間に依存しないので常に true。
 */
export function isStatsFresh(computedAt, period, now = new Date()) {
  if (period === "all") return true;
  const t = new Date(computedAt);
  if (Number.isNaN(t.getTime())) return false;
  // 【未来の値は捨てる】端末の時計は信用できない。過去方向のずれは救えないが、
  // 「時計を進めて今月に居座る」だけはこれで塞げる。
  if (t > now) return false;
  if (period === "week") return t >= startOfWeek(now);
  if (period === "month") return t >= new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "year") return t >= new Date(now.getFullYear(), 0, 1);
  return false; // 知らない期間を黙って通さない
}

// 期間 → stats のキー。画面と集計で同じ対応を使う。
export const PERIOD_FIELD = {
  week: "daysThisWeek",
  month: "daysThisMonth",
  year: "daysThisYear",
  all: "daysAll",
};
// 【2026/09/09 本人裁定・A25「C案」】**語を My Data と揃えない。**
// 一度「1週間 / 1ヶ月 / 1年」へ揃えたが、数え方が違うまま語だけ揃えると嘘になるので戻した。
//
//   ここ(コミュニティ) … **暦**。週は月曜0時から / 月は1日から / 年は1/1から
//   My Data           … **ローリング**。「1週間」は いまこの瞬間から168時間さかのぼる窓
//
// 水曜の22時なら、同じ「1週間」が片方は7日ぶん・片方は3日ぶんを指してしまう。
// 【暦をやめられない理由】この暦の境界は見た目の都合ではなく**順位の土台**。
// 各自の数字は本人の端末が計算して公開した4つの数で、サーバは計算できない
// (セッションは端末の中にしかない)。だから読む側は下の isStatsFresh で
// 「今週の月曜以降に計算されたものだけ」を採る。ローリングにするとこの足場が消え、
// 「数時間以内に公開した人だけ」に絞るしかなくなって順位がほぼ空になる。
// **「今週」は暦、「1週間」はローリング**と読めるので、語を分けるほうが正確。
export const PERIOD_LABEL = { week: "今週", month: "今月", year: "今年", all: "すべて" };
export const PERIODS = ["week", "month", "year", "all"];

/** 保存前の形の検査。ルールの `is int` と同じ厳しさにする。 */
export function validateStats(stats) {
  if (!stats || typeof stats !== "object") return { error: "練習日数の形が正しくありません" };
  for (const k of ["daysThisWeek", "daysThisMonth", "daysThisYear", "daysAll"]) {
    const v = stats[k];
    if (!Number.isInteger(v) || v < 0 || v > STATS_MAX[k]) {
      return { error: `練習日数(${k})が正しくありません` };
    }
  }
  if (typeof stats.computedAt !== "string" || Number.isNaN(new Date(stats.computedAt).getTime())) {
    return { error: "練習日数の計算時刻が正しくありません" };
  }
  const keys = Object.keys(stats);
  if (keys.length !== STATS_KEYS.length || !STATS_KEYS.every((k) => keys.includes(k))) {
    return { error: "練習日数のキーが正しくありません" };
  }
  return { stats };
}
