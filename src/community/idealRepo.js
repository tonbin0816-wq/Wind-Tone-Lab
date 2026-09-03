import { collection, deleteDoc, doc, getDocs, limit as qLimit, query, setDoc, where } from "firebase/firestore";
import { getFirebase } from "./firebaseClient.js";
import { buildIdealDoc, sanitizeIncomingNotes, selectOwnSessions } from "./idealDoc.js";
import { DIRECTORY_LIMIT } from "./directory.js";

// docId は "<uid>_<saxType>"。ルールがこの綴りを要求している
// (要求しないと、他人の uid を名乗るドキュメントを別のIDで作れる)。
const idealId = (uid, saxType) => `${uid}_${saxType}`;

/** 楽器種別1つぶんの目安を公開する。同じ種別を出し直すと上書きになる。 */
export async function publishIdeal(input, now = new Date()) {
  const r = buildIdealDoc(input, now);
  if (r.error) throw new Error(r.error);
  const { db } = getFirebase();
  await setDoc(doc(db, "ideals", idealId(r.doc.ownerUid, r.doc.saxType)), r.doc);
  return r.doc;
}

/** 公開を取り下げる。 */
export async function unpublishIdeal(uid, saxType) {
  const { db } = getFirebase();
  await deleteDoc(doc(db, "ideals", idealId(uid, saxType)));
}

/** 自分が公開している目安の一覧。 */
export async function listMyIdeals(uid) {
  const { db } = getFirebase();
  const snap = await getDocs(query(
    collection(db, "ideals"), where("ownerUid", "==", uid), qLimit(DIRECTORY_LIMIT)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * 公開されている目安を読む。
 *
 * 【読んだ直後に洗う】ルールには繰り返しが無く、各音の値が数値であることを
 * サーバ側で検査できない(設計書の宿題2)。壊れた値が画面へ届かないようにするのが上限。
 */
export async function listIdeals({ saxType = null, max = DIRECTORY_LIMIT } = {}) {
  const { db } = getFirebase();
  const parts = [];
  if (saxType) parts.push(where("saxType", "==", saxType));
  parts.push(qLimit(max));
  const snap = await getDocs(query(collection(db, "ideals"), ...parts));
  return snap.docs.map((d) => {
    const data = d.data();
    return { ...data, id: d.id, notes: sanitizeIncomingNotes(data.notes) };
  });
}

/**
 * 目安を、公開しているユーザーの情報と突き合わせる。
 *
 * 【非公開の人の目安が混ざらないようにする】ideals の list 規則は
 * クエリそのものに対して評価されるので、所有者の公開状態をサーバ側では見られない。
 * **そこで「非公開にしたら ideals から消す」という設計にしてある**
 * (公開状態を持つ場所を users の1箇所に保ち、読まれてはいけないものを置かない)。
 * ここで落としているのは、消し漏れた場合の二重の備え。
 */
export function joinOwners(ideals, users) {
  const byUid = new Map((users ?? []).map((u) => [u.uid, u]));
  return (ideals ?? [])
    .map((i) => ({ ideal: i, owner: byUid.get(i.ownerUid) ?? null }))
    .filter((x) => x.owner !== null);
}

/**
 * 登録した楽器種別ごとに、自分のセッションから平均を作る。
 *
 * 【目安は選ぶものではない】種別ごとに1つあるだけ(2026-09-03 本人裁定)。
 * どれを公開するかという選択が無いので、画面に公開ボタンも要らない。
 *
 * @param buildProfile App.jsx の buildIdealProfileFromSessions。
 *   平均の作り方は計測タブと同じものを使う ── ここで別の計算を書くと、
 *   自分の画面に出ている目安と、公開した目安が違う値になる。
 * @returns { [saxType]: ローカルの形のプロファイル }
 */
export function buildMyIdeals({ sessions, saxTypes, tuningHz, buildProfile }) {
  const out = {};
  for (const t of saxTypes ?? []) {
    // 【自分の演奏だけ】他人を録ったセッションは selectOwnSessions が落とす。
    const own = selectOwnSessions(sessions, t);
    if (own.length === 0) continue;
    const profile = buildProfile(own, "", 8, tuningHz);
    if (profile && Object.keys(profile.notes ?? {}).length > 0) {
      // 【tuningHz は自分で付ける】buildIdealProfileFromSessions は
      // それを返さない(計算に使うだけ)。公開ドキュメントには必要なので、
      // 呼ぶ側が渡した値をそのまま持たせる。
      out[t] = { ...profile, tuningHz, sourceSessionCount: own.length };
    }
  }
  return out;
}

/**
 * 作った目安をまとめて公開する。
 *
 * 【失敗しても黙って諦める】本人の操作ではなく副次的な更新なので、
 * 「目安の公開に失敗しました」と出しても利用者にできることが無い。
 * 音が足りない種別は buildIdealDoc が弾くが、それも異常ではない
 * (まだ数音しか吹いていない種別があるのは普通)。
 */
export async function publishMyIdeals(uid, myIdeals, now = new Date()) {
  const published = [];
  for (const [saxType, profile] of Object.entries(myIdeals ?? {})) {
    try {
      const doc = await publishIdeal({
        ownerUid: uid,
        saxType,
        tuningHz: profile.tuningHz ?? null,
        notes: profile.notes,
        sourceSessionCount: profile.sourceSessionCount,
      }, now);
      published.push(doc);
    } catch (e) { /* この種別は公開できなかっただけ。他の種別は続ける */ }
  }
  return published;
}
