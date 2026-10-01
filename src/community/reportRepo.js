import { doc, setDoc } from "firebase/firestore";
import { getFirebase } from "./firebaseClient.js";
import { buildReportDoc } from "./report.js";

// ------------------------------------------------------------------
// 通報の読み書き。純関数は report.js が持つ。
// 【計画5 モデレーション 2026-09-10】
//
// 【便BG 2026-10-01 本人指示】通報で一覧から消す動きをやめた。書くのは reports の1つだけ。
// 以前は flags/{target} にも書き(reportUser)、一覧を読む側が flags を読んで(listFlaggedUids)
// その人を全員の画面から落とし、本人にはマイページで告知していた(isFlagged)。
// クライアントは flags を書きも読みもしなくなったので、その2つの読みの関数も消した。
// firestore.rules の flags の塊は変えていない(使わなくなっただけ。配信の順番は問わない)。
// 本番に残っている flags の文書は、もう誰にも読まれない。消すのは運営の作業(コンソール)。
// ------------------------------------------------------------------

/**
 * 通報する。reports/{target}_{reporter} に1つ書く(監査の記録。クライアントからは読めない)。
 *
 * @returns {{ already: boolean }} already = 既に同じ相手を通報していた(下記)
 *
 * 【二重通報は失敗にしない】ルールは reports の update を拒む(後から理由や時刻を
 * 書き換えられないようにするため)。同じ人が同じ相手を2度通報すると、2度目は
 * 「既にある doc への書き込み」= update と見なされて permission-denied で弾かれる。
 * **それは正常な経路**(記録は1件目が持っている)なので、送れたときと同じに扱う。
 * 【便BG】以前は reports の失敗を**すべて**握り、成否は flags の書き込みで決まっていた。
 * flags が無くなったので、握るのは permission-denied(= 既に在る)だけにした。
 * 通信の失敗など、それ以外はそのまま投げる(画面は「通報を送れませんでした」を出し、ブロックは問わない)。
 */
export async function reportUser({ targetUid, reporterUid, reason }, now = new Date()) {
  const r = buildReportDoc({ targetUid, reporterUid, reason }, now);
  if (r.error) throw new Error(r.error);
  const { db } = getFirebase();
  try {
    await setDoc(doc(db, "reports", r.id), r.doc);
    return { already: false };
  } catch (e) {
    if (e?.code === "permission-denied") return { already: true };
    throw e;
  }
}
