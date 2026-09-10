import { collection, doc, getDoc, getDocs, limit as qLimit, query, setDoc } from "firebase/firestore";
import { getFirebase } from "./firebaseClient.js";
import { buildFlagDoc, buildReportDoc } from "./report.js";
import { DIRECTORY_LIMIT } from "./directory.js";

// ------------------------------------------------------------------
// 通報の読み書き。純関数は report.js が持つ。
// 【計画5 モデレーション 2026-09-10】
// ------------------------------------------------------------------

/**
 * 通報する。**2つ書く。**
 *
 *   reports/{target}_{reporter} … 監査の記録(誰が・なぜ)。クライアントからは読めない
 *   flags/{target}              … 「隠す」の名簿。誰でも読める。通報者は入れない
 *
 * 【reports の失敗を握る理由】ルールは reports の update を拒む(後から理由や時刻を
 * 書き換えられないようにするため)。同じ人が同じ相手を2度通報すると、2度目は
 * 「既にある doc への書き込み」= update と見なされて弾かれる。**それは正常な経路**なので、
 * ここで止めずに flags の方へ進む(相手は隠れたままでよい)。
 * flags の失敗は握らない ── そちらが落ちたら通報が効いていない。
 */
export async function reportUser({ targetUid, reporterUid, reason }, now = new Date()) {
  const r = buildReportDoc({ targetUid, reporterUid, reason }, now);
  if (r.error) throw new Error(r.error);
  const { db } = getFirebase();
  try {
    await setDoc(doc(db, "reports", r.id), r.doc);
  } catch {
    // 二重通報。記録は1件目が持っているので、何も足さずに進む。
  }
  await setDoc(doc(db, "flags", targetUid), buildFlagDoc(now));
}

/**
 * いま隠されている uid の集合。
 *
 * 【上限は users と同じ 50】公開ユーザー自体が 50 で頭打ちなので、
 * 隠されている人がそれを超えることは現状ありえない。
 * **決定1-b(公開ユーザーが50人を超えたら壊れる)を直すときは、ここも一緒に直すこと。**
 */
export async function listFlaggedUids(max = DIRECTORY_LIMIT) {
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, "flags"), qLimit(max)));
  return new Set(snap.docs.map((d) => d.id));
}

/**
 * 自分が隠されているか。マイページの告知に使う。
 *
 * 【一覧とは別に1件読む】listFlaggedUids は上限50で切れるので、
 * 「自分が入っているか」を一覧の結果から判定すると、切れた先に居たときに
 * **本人にだけ何も知らせないまま隠れる**という最悪の壊れ方になる。1 read 増やして確実に見る。
 */
export async function isFlagged(uid) {
  if (!uid) return false;
  const { db } = getFirebase();
  const snap = await getDoc(doc(db, "flags", uid));
  return snap.exists();
}
