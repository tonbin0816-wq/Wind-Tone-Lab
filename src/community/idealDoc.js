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

// ローカルの倍音構成 [{n, norm}] → 公開用の数値配列。数値配列がそのまま来ても受ける
// (取り込んだ目安をもう一度公開する経路があるため)。形が違えば null を返す。
function toNorms(v) {
  if (!Array.isArray(v) || v.length === 0) return null;
  if (v.every(num)) return v.slice();
  const norms = v.map((h) => (h && num(h.norm) ? h.norm : null));
  return norms.every((x) => x !== null) ? norms : null;
}

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
        // 【ローカルは [{n:1, norm:0.8}, ...] のオブジェクト配列】公開側は norm だけの
        // 数値配列にする。n は添字+1 でしかなく、送る意味が無い。
        //
        // 【一度これを踏んだ】数値配列を期待して v.every(num) で見ていたため、
        // オブジェクト配列が毎回落ち、**倍音構成が一度も公開されていなかった。**
        // エラーにならず黙って消えるので、画面を見ても気づけない。
        const norms = toNorms(v);
        if (norms) kept[sharedKey] = norms;
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

// ------------------------------------------------------------------
// 取り込み: 他人の目安を、自分の目安として使える形へ戻す。
// ------------------------------------------------------------------

// 公開の綴り → ローカル(App.jsx)の綴り。LOCAL_TO_SHARED の逆写像を**手で書く**。
// 自動で反転させると、片方向にしか無い項目が出たときに黙って落ちる。
const SHARED_TO_LOCAL = {
  spectralCentroidHz: "centroidHz",
  hnrDb: "hnrDb",
  pitchCentsSigned: "pitchCentsSigned",
  harmonics: "harmonicsProfile",
};

/**
 * 平行移動済みの notes を、App.jsx が読める形へ戻す。
 *
 * 【音量は復元しない(できない)】そもそも共有していないので、
 * 取り込んだ目安に音量の目標は入らない。**それが正しい。**
 * 音量は環境で決まる値で、他人の値を目標にする意味が無い。
 */
export function toLocalNotes(sharedNotes) {
  const out = {};
  for (const [key, note] of Object.entries(sharedNotes ?? {})) {
    if (!note || typeof note !== "object") continue;
    const local = {};
    for (const [sharedKey, localKey] of Object.entries(SHARED_TO_LOCAL)) {
      const v = note[sharedKey];
      if (v === undefined) continue;
      if (sharedKey === "harmonics") {
        // 【形を戻さないと計測タブで NaN になる】あちらは harmonicsProfile.map((h) => h.norm)
        // と書いており、数値の配列を渡すと h.norm が undefined になって音色一致度が壊れる。
        if (!Array.isArray(v)) continue;
        local[localKey] = v.map((norm, i) => ({ n: i + 1, norm }));
      } else {
        local[localKey] = v;
      }
    }
    // 半音インデックスは App.jsx 側でも数値として持っている
    const n = Number(key);
    if (Number.isInteger(n)) local.semitoneIndex = n;
    if (Object.keys(local).length > 0) out[key] = local;
  }
  return out;
}

// 取り込んだ目安であることの印。App.jsx の sourceKind に入る。
// **"session" / "performer" と区別する** ── 由来が自分の録音ではないので、
// 「目安設定中」のセッション判定(sourceSessionIds)に混ぜてはいけない。
export const ADOPTED_SOURCE = "community";

/**
 * 他人の目安を取り込んだ、ローカルの目安プロファイルを作る。
 *
 * @param aligned alignProfile の結果(自分に合わせ済みの notes)
 * @param theirIdeal 公開ドキュメント(saxType を取る)
 * @param nickname 相手のニックネーム。名前に使う
 * @param id 新しい目安の id(App.jsx の generateId で作って渡す)
 */
export function buildAdoptedProfile({ aligned, theirIdeal, nickname, id, baseFreqOf = null, now = new Date() }) {
  const notes = toLocalNotes(aligned?.notes);
  if (Object.keys(notes).length === 0) return { error: "取り込める音がありませんでした" };

  // 【ピッチの目標は自分の基準で作り直す】計測タブは noteIdeal.pitchHz(絶対周波数)を
  // 見て「合っているか」を出す。だが共有しているのは pitchCentsSigned(理論値からのずれ)で、
  // 相手の絶対周波数ではない ── 相手が442Hz、自分が440Hzかもしれないので、
  // **相手の Hz をそのまま目標にすると調弦の違いのぶんだけ常にずれる。**
  // 「相手と同じだけ理論値から外して吹く」が正しい目標なので、
  // 自分の基準ピッチでの理論周波数に、相手のずれ(セント)を当てて作る。
  //
  // baseFreqOf を渡さない呼び出し(テスト等)では pitchHz を作らない。
  // **無いなら無いままにする** ── でたらめな Hz を入れると、
  // 音程が合っているのに「ずれている」と出続ける。
  if (typeof baseFreqOf === "function") {
    for (const [key, note] of Object.entries(notes)) {
      const cents = note.pitchCentsSigned;
      if (typeof cents !== "number" || !Number.isFinite(cents)) continue;
      const base = baseFreqOf(Number(key));
      if (typeof base !== "number" || !Number.isFinite(base) || base <= 0) continue;
      note.pitchHz = base * Math.pow(2, cents / 1200);
    }
  }
  return {
    profile: {
      id,
      // 【誰の目安かが分かる名前にする】取り込んだあと一覧に並ぶので、
      // 「目安」だけでは自分で録ったものと見分けが付かない。
      name: `${nickname} さんの目安`,
      saxType: theirIdeal?.saxType ?? null,
      recordedAt: now.toISOString(),
      notes,
      sourceKind: ADOPTED_SOURCE,
      // 【自分のセッションから作ったものではないので空にする】
      // ここに何か入れると、関係の無いセッションが「目安設定中」と表示される。
      sourceSessionIds: [],
    },
  };
}
