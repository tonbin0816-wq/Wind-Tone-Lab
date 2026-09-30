// ------------------------------------------------------------------
// ブロックの純関数。**Firestore に触らない**(ブロックはサーバーに何も書かない)。
//
// 【便BE 2026-09-30 本人裁定「ブロックを通報と分けて作る(B)」】
// 通報(report.js)は flags に書き、その人を**全員の画面**から消す。戻せるのは運営だけ。
// App Store の審査(利用者が作るものを見せるアプリはブロックが必須)に向けて、
// **自分の画面からだけ**消し、自分でいつでも戻せる「ブロック」を別に作る。
//
//   ・保存はこの端末(App.jsx の usePersistedState = IndexedDB の kv)。鍵は BLOCKED_USERS_KEY。
//     アカウント引継(src/backup)は kv を丸ごと書き出す/読み戻すので、ファイルにも入り、読み戻すと戻る。
//     古いファイル(この鍵が無い)を読み戻すと鍵ごと無くなり、一覧は空で始まる(normalizeBlockedList)。
//   ・落とし方は通報と同じ考え(hideFlagged / hideFlaggedIdeals)── **数える前に落とす**ので
//     順位・シェア・データの一覧の母数からも、みんなの平均(目安の集計)からも消える。
//   ・相手には知らせない。サーバーには何も書かない。
//   ・入口(人物のページの「この人をブロック」)を出す条件は通報と同じ(report.js の reportEntryVisible)。
//     screens.jsx で通報の入口と同じ器の中に置いたので、条件は1箇所にしか無い。
// ------------------------------------------------------------------
import { hideFlagged, hideFlaggedIdeals } from "./report.js";

/** IndexedDB(kv)の鍵。**綴りを変えないこと** ── 変えると保存済みの一覧と引継のファイルが読めなくなる。 */
export const BLOCKED_USERS_KEY = "blockedUsers";

const isUid = (v) => typeof v === "string" && v.length > 0;

/**
 * 保存されている値を一覧の形に整える。**何が来ても壊れない**(引継のファイルは手で書き換えられうる)。
 *  ・配列でない(鍵が無い = 古い引継のファイル / 初めての端末)→ 空
 *  ・uid の無い項目は捨てる。同じ uid が2つあれば先のものを残す
 *  ・【便BE 審査の指摘】型をそろえる。nickname は文字列でなければ ""。icon(文字列)・iconColor(整数)・
 *    photo(文字列)・blockedAt(文字列)は型が合わなければその項目だけ捨てる(一覧とシートが落ちないように)。
 */
export function normalizeBlockedList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const e of value) {
    if (!e || typeof e !== "object" || !isUid(e.uid) || seen.has(e.uid)) continue;
    seen.add(e.uid);
    const entry = { uid: e.uid, nickname: typeof e.nickname === "string" ? e.nickname : "" };
    if (typeof e.icon === "string" && e.icon.length > 0) entry.icon = e.icon;
    if (Number.isInteger(e.iconColor)) entry.iconColor = e.iconColor;
    if (typeof e.photo === "string" && e.photo.length > 0) entry.photo = e.photo;
    if (typeof e.blockedAt === "string") entry.blockedAt = e.blockedAt;
    out.push(entry);
  }
  return out;
}

/** 一覧 → uid の Set(落とすときに使う)。 */
export function blockedUidSet(list) {
  return new Set(normalizeBlockedList(list).map((e) => e.uid));
}

/**
 * ブロックの一覧に足す。**表示用の名前とアイコンはブロックした時点の写し**
 * (解除の一覧は、その人がもう一覧に居なくても名前と絵で見分けられる必要がある)。
 * アイコンは持っているものだけを写す(icon / iconColor / photo)。
 * 既に居る人・uid の無い人は足さない(元の一覧を返す)。
 */
export function addBlocked(list, person, now = new Date()) {
  const cur = normalizeBlockedList(list);
  if (!isUid(person?.uid) || cur.some((e) => e.uid === person.uid)) return cur;
  const entry = { uid: person.uid, nickname: typeof person.nickname === "string" ? person.nickname : "" };
  if (person.icon != null) entry.icon = person.icon;
  if (person.iconColor != null) entry.iconColor = person.iconColor;
  if (person.photo != null) entry.photo = person.photo;
  entry.blockedAt = now.toISOString();
  return [...cur, entry];
}

/** 解除。確認は挟まない(本人裁定)。 */
export function removeBlocked(list, uid) {
  return normalizeBlockedList(list).filter((e) => e.uid !== uid);
}

/**
 * ブロックした人を落とす。規則は通報の hideFlagged と同じ(**自分は落とさない**)。
 * 自分をブロックする入口は無いが、一覧が壊れていても自分が消えることは無い。
 */
export function hideBlocked(users, list, myUid = null) {
  return hideFlagged(users, blockedUidSet(list), myUid);
}

/** 目安も同じ規則で落とす(所有者は ownerUid)。みんなの平均はこの結果から数える。 */
export function hideBlockedIdeals(ideals, list, myUid = null) {
  return hideFlaggedIdeals(ideals, blockedUidSet(list), myUid);
}
