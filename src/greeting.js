// 【AE 2026-09-21 本人指示・凍結仕様】計測タブの「起動の挨拶」。
//
// 本人の言葉:「計測タブには音が流れていない間は大きな余白がある。そこに一行のテキストを
// 入れる。音が出ないたびにずっと出るのは邪魔なので、アプリを開いて最初だけにしたい。
// **挨拶だけ。浅いアドバイスは一切いらない。**」
//
// 【入れないもの(本人が不採用と決めている)】
//   - 季節の話(「暖かいと音程が高く出ます」のような話は失礼)
//   - 天気の話(その日による)
//   - 助言・励まし・練習のコツ
//   - 8/13〜8/16 の行事(本人が名指しで不採用にした。この綴りはこのファイルに1つも置かない)
// 足したくなったら、まず本人に聞くこと。ここは挨拶だけの場所。
//
// 【new Date() も乱数もこのファイルで引かない】
// 決め方は greetingFor(date, prev) という**時刻と前回を引数で受ける純関数**1つ。
// 関数の中で時計や乱数を読むと、検査が結果を固定できず「構造上失敗し得ない検査」になる
// (全社の学び L-01)。時計を読むのは呼び手(App.jsx が起動時に1回だけ)。
//
// 【同じ束の中で前回と違う一文を選ぶ】
// 毎回同じだと一週間で古くなる、というのが本人と合意した設計の芯。選び方は**回す**
// ── 前回の一文が候補の何番目かを見て、その次を返す(末尾なら先頭へ戻る)。
// 前回が候補に無ければ先頭。候補が2つ以上ある束では**必ず前回と違う**一文になる。

// ------------------------------------------------------------
// 時刻の束(5つ)。端末のローカル時刻の「時」だけで分ける(分は見ない)。
//   あさ 5〜9 / ひる 10〜14 / ゆうがた 15〜17 / よる 18〜22 / しんや 23〜4
// 文言の綴りはここだけに置く。**JSX に直書きしない。**
// ------------------------------------------------------------
export const GREETING_MORNING = ["おはようございます", "朝の練習ですね"];
export const GREETING_NOON = ["こんにちは", "昼の練習ですね"];
export const GREETING_EVENING = ["こんにちは", "夕方の練習ですね", "今日もお疲れ様です"];
export const GREETING_NIGHT = ["こんばんは", "夜まで練習お疲れ様です", "今日もお疲れ様です", "夜の練習ですね"];
export const GREETING_LATE_NIGHT = ["こんばんは", "夜遅くまでお疲れ様です", "静かな時間ですね"];

// しんや(23〜4)は日をまたぐので帯にしない。**どの帯にも入らない時刻**がしんや。
export const GREETING_HOUR_BANDS = [
  { from: 5, to: 9, texts: GREETING_MORNING },
  { from: 10, to: 14, texts: GREETING_NOON },
  { from: 15, to: 17, texts: GREETING_EVENING },
  { from: 18, to: 22, texts: GREETING_NIGHT },
];

// ------------------------------------------------------------
// 日付(8つ)。**月日だけで決める(年は見ない)。**
// その日は時刻の挨拶の**代わり**に出る ── 並べない・置き換える。
// ------------------------------------------------------------
export const GREETING_NEW_YEAR = ["ハッピーニューイヤー", "あけましておめでとうございます"];
export const GREETING_SETSUBUN = ["節分ですね"];
export const GREETING_HINAMATSURI = ["ひな祭りですね"];
export const GREETING_KODOMO = ["こどもの日ですね"];
export const GREETING_TANABATA = ["七夕ですね"];
export const GREETING_HALLOWEEN = ["ハロウィンですね"];
export const GREETING_CHRISTMAS = ["メリークリスマス"];
export const GREETING_NEW_YEARS_EVE = ["来年も良い年になりますように"];

export const GREETING_SPECIAL_DAYS = [
  { month: 1, day: 1, texts: GREETING_NEW_YEAR },
  { month: 1, day: 2, texts: GREETING_NEW_YEAR },
  { month: 1, day: 3, texts: GREETING_NEW_YEAR },
  { month: 2, day: 3, texts: GREETING_SETSUBUN },
  { month: 3, day: 3, texts: GREETING_HINAMATSURI },
  { month: 5, day: 5, texts: GREETING_KODOMO },
  { month: 7, day: 7, texts: GREETING_TANABATA },
  { month: 10, day: 31, texts: GREETING_HALLOWEEN },
  { month: 12, day: 24, texts: GREETING_CHRISTMAS },
  { month: 12, day: 25, texts: GREETING_CHRISTMAS },
  { month: 12, day: 31, texts: GREETING_NEW_YEARS_EVE },
];

/**
 * 候補の中から「前回の次」を返す。乱数は引かない(検査が結果を固定できなくなる)。
 * 前回が候補に無ければ先頭。候補が2つ以上あれば**必ず前回と違う**一文になる。
 * @param {string[]} texts 候補(1つ以上)
 * @param {string} prev 前回出した一文
 * @returns {string}
 */
export function pickNext(texts, prev) {
  return texts[(texts.indexOf(prev) + 1) % texts.length];
}

/**
 * 渡された時刻に出す挨拶を返す。**時計も乱数もこの関数は引かない。**
 * @param {Date} date 出すときのローカル時刻
 * @param {string} [prev] 前回出した一文(同じ束の中でこれと違う一文を選ぶ)
 * @returns {string} 挨拶の文言(必ずどれか1つを返す)
 */
export function greetingFor(date, prev = "") {
  const d = date instanceof Date ? date : new Date(date);
  // 日付が先。年は見ないので getFullYear() は使わない。
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const special = GREETING_SPECIAL_DAYS.find((s) => s.month === month && s.day === day);
  if (special) return pickNext(special.texts, prev);
  // 無ければ時刻の束。どの帯にも入らない 23〜4 が しんや。
  const hour = d.getHours();
  const band = GREETING_HOUR_BANDS.find((b) => hour >= b.from && hour <= b.to);
  return pickNext(band ? band.texts : GREETING_LATE_NIGHT, prev);
}
