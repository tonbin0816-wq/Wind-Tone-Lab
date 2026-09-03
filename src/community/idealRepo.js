import { collection, deleteDoc, doc, getDocs, limit as qLimit, query, setDoc, where } from "firebase/firestore";
import { getFirebase } from "./firebaseClient.js";
import { buildIdealDoc, sanitizeIncomingNotes } from "./idealDoc.js";
import { DIRECTORY_LIMIT } from "./directory.js";

// docId は "<uid>_<profileId>"。ルールがこの綴りを要求している
// (要求しないと、他人の uid を名乗るドキュメントを別のIDで作れる)。
const idealId = (uid, profileId) => `${uid}_${profileId}`;

/** 自分の目安を公開する。同じ目安を出し直すと上書きになる。 */
export async function publishIdeal(input, now = new Date()) {
  const r = buildIdealDoc(input, now);
  if (r.error) throw new Error(r.error);
  const { db } = getFirebase();
  await setDoc(doc(db, "ideals", idealId(r.doc.ownerUid, r.doc.profileId)), r.doc);
  return r.doc;
}

/** 公開を取り下げる。 */
export async function unpublishIdeal(uid, profileId) {
  const { db } = getFirebase();
  await deleteDoc(doc(db, "ideals", idealId(uid, profileId)));
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
