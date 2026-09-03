import { SAX_TYPES } from "./profile.js";
import { SHIFTED_METRICS, COPIED_METRICS } from "./align.js";

// ------------------------------------------------------------------
// 公開する目安ドキュメントの組み立て。
//
// 【目安は「選んで公開するもの」ではない】その人の**楽器種別ごとの平均**が
// 1つあるだけで、どれを出すかという選択は無い(2026-09-03 本人裁定)。
// したがって:
//   - ドキュメントは楽器種別ごとに1つ。docId は "<uid>_<saxType>"
//   - 名前を持たない。「Alto の平均」以外に呼び名が無いので、付ける意味が無い
//   - **名前が無いことで、公開される自由入力がニックネームだけになる。**
//     設計書 §8.1(通報の対象はニックネームだけ)がそのまま保たれる
//   - リードも持たない。平均は複数のセッションにまたがるので、1本に決まらない
//     (使っているリードはプロフィールの機材が持っている)
//
// 【ここが「端末から出ていくもの」の唯一の入口】共有してよい指標だけを写し、
// それ以外は**書き写さないことで**落とす(消すのではなく、拾わない)。
// 拾う側で列挙してあるので、App.jsx が notes に項目を足しても勝手に外へ出ない。
// ------------------------------------------------------------------

// 公開してよい指標(平行移動するもの + そのまま写すもの)。align.js と同じ綴り。
export const SHARED_METRICS = [...SHIFTED_METRICS, ...COPIED_METRICS];

// 【ローカルと公開で綴りが違う】App.jsx の目安は centroidHz / harmonicsProfile を持つが、
// 公開側は spectralCentroidHz / harmonics で持つ(align.js の綴り)。
// **対応づけはこの表だけが持つ。** 綴りが揃っていないことに気づかず片方だけ直すと、
// 「値が全部 undefined の目安」が公開されて、誰の画面にも線が出ない。
// (実際に一度これを踏んだ。境界では必ず sanitizeNotes を通すこと。)
const LOCAL_TO_SHARED = {
  centroidHz: "spectralCentroidHz",
  hnrDb: "hnrDb",
  pitchCentsSigned: "pitchCentsSigned",
  harmonicsProfile: "harmonics",
};

// 1つの目安に載せる音の上限。**firestore.rules の noteKeys.size() <= 40 と同じ値にすること。**
// ここを緩めるとクライアントは通してルールが弾き、**保存の瞬間にだけ失敗する**
// (手元にルールは無いのでテストでは気づけない)。同期は idealDoc.test.js が検査している。
// 音名キーの取りうる範囲(0..47)とは別の話 ── キーは飛び飛びに使われるので、
// 範囲の広さと個数の上限は一致しない。
export const MAX_PUBLISHED_NOTES = 40;
// 音名キーの上限。半音インデックスの文字列で 0..47(サックスの実音域に余裕を持たせた範囲)。
export const MAX_NOTE_KEY = 47;
// これ未満だと平行移動の基準が立たない(align.js の MIN_COMMON_NOTES と同じ理由)
export const MIN_PUBLISHED_NOTES = 3;

const num = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * 共有してよい指標だけを残す。**volumeDb を必ず落とす。**
 *
 * 【落とすのではなく拾う】列挙したものだけを写すので、
 * ローカルの音に新しい項目が増えても自動では出ていかない。
 */
export function sanitizeNotes(notes) {
  const out = {};
  for (const [key, note] of Object.entries(notes ?? {})) {
    if (!note || typeof note !== "object") continue;
    const kept = {};
    for (const [localKey, sharedKey] of Object.entries(LOCAL_TO_SHARED)) {
      const v = note[localKey];
      if (sharedKey === "harmonics") {
        // 倍音構成は数値の配列。中身まで数値であることを見る
        // (ルールでは中身の型を書けないので、ここが唯一の砦。設計書の宿題2)。
        if (Array.isArray(v) && v.length > 0 && v.every(num)) kept[sharedKey] = v.slice();
      } else if (num(v)) {
        kept[sharedKey] = v;
      }
    }
    // 平行移動に使う2つのどちらも無い音は、載せても比較に使えない
    if (SHIFTED_METRICS.every((m) => kept[m] === undefined)) continue;
    out[key] = kept;
  }
  return out;
}

/**
 * @param input { ownerUid, saxType, tuningHz, notes(ローカルの形), sourceSessionCount }
 *
 * 【performerIsSelf を引数に取らない】呼ぶ側が「自分のセッションだけ」を選んで
 * 平均を作る責任を負う(publishMyIdeals がそれをしている)。
 * ここで真偽値を1つ受け取る形にすると、呼ぶ側が true を渡すだけで通ってしまい、
 * 検査しているつもりで何も検査していないことになる。
 */
export function buildIdealDoc(input, now = new Date()) {
  if (typeof input?.ownerUid !== "string" || input.ownerUid.length === 0) {
    return { error: "アカウントが見つかりません" };
  }
  if (!SAX_TYPES.includes(input.saxType)) return { error: "楽器種別が正しくありません" };

  // 【範囲は firestore.rules と同じにする】ここを広げるとクライアントは通して
  // ルールが弾き、保存の瞬間にだけ失敗する。
  const tuningHz = input.tuningHz;
  if (!num(tuningHz) || tuningHz < 400 || tuningHz > 500) {
    return { error: "基準ピッチが正しくありません" };
  }

  const notes = sanitizeNotes(input.notes);
  // 【音名キーは 0..47 の整数の文字列だけ】ルールは列挙で固定しているので、
  // 範囲外のキーを1つでも作るとドキュメントごと弾かれる。ここで先に落とす。
  for (const k of Object.keys(notes)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 0 || n > MAX_NOTE_KEY) delete notes[k];
  }
  const noteKeys = Object.keys(notes).sort((a, b) => Number(a) - Number(b));
  if (noteKeys.length < MIN_PUBLISHED_NOTES) {
    return { error: `公開できる音が${MIN_PUBLISHED_NOTES}音に足りません` };
  }
  if (noteKeys.length > MAX_PUBLISHED_NOTES) return { error: "音が多すぎます" };

  const count = input.sourceSessionCount;
  if (!Number.isInteger(count) || count < 1 || count > 10000) {
    return { error: "もとにした録音の数が正しくありません" };
  }

  return {
    doc: {
      ownerUid: input.ownerUid,
      saxType: input.saxType,
      tuningHz,
      notes,
      noteKeys,
      sourceSessionCount: count,
      updatedAt: now.toISOString(),
    },
  };
}

/**
 * 読み込んだ目安の中身を、画面に出す前に洗い直す。
 *
 * 【なぜ読む側でもやるか】Firestore のルールには繰り返しが無く、
 * notes の各音の値が数値であることを**サーバ側では検査できない**
 * (設計書の宿題2への裁定)。生の SDK を叩けば壊れた値を書き込める。
 * 書き込みを塞げない以上、壊れた値が画面へ届かないようにするのが上限。
 */
export function sanitizeIncomingNotes(notes) {
  const out = {};
  for (const [key, note] of Object.entries(notes ?? {})) {
    if (!note || typeof note !== "object") continue;
    const kept = {};
    for (const m of SHARED_METRICS) {
      const v = note[m];
      if (m === "harmonics") {
        if (Array.isArray(v) && v.length > 0 && v.every(num)) kept[m] = v.slice();
      } else if (num(v)) {
        kept[m] = v;
      }
    }
    if (SHIFTED_METRICS.every((m) => kept[m] === undefined)) continue;
    out[key] = kept;
  }
  return out;
}

// 【自分の演奏の印】App.jsx の performer は既定が "自分" で、他人には名前が入る。
// 未設定(空・undefined)も「自分」として扱う ── 既定値なので。
export const SELF_PERFORMER = "自分";
export const isSelfSession = (s) => ((s?.performer ?? "") || SELF_PERFORMER) === SELF_PERFORMER;

/**
 * 公開する対象のセッションを選ぶ。
 *
 * 【ここが「他人の演奏を公開しない」を守っている唯一の場所】
 * 先生や友人の音を録ったセッションは performer に名前が入っているので落ちる。
 * 録られた本人の同意がないまま音が世界中に出るのを防ぐ(設計書 §7)。
 */
export function selectOwnSessions(sessions, saxType) {
  return (sessions ?? []).filter(
    (s) => s && isSelfSession(s) && s.saxType === saxType && (s.frames?.length ?? 0) > 0);
}
