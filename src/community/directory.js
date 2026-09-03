import { collection, getDocs, limit as qLimit, orderBy, query, where, doc, updateDoc } from "firebase/firestore";
import { getFirebase } from "./firebaseClient.js";
import { validateStats } from "./stats.js";

// ------------------------------------------------------------------
// 公開ユーザーの一覧。**データ・順位・シェアの3画面がここだけを共有する。**
//
// 3つは独立した機能ではなく、「users を条件で絞って読む」同じ土台の上に
// 違う見せ方が乗っているだけ。別々に書くと、同じ絞り込みが3通りの挙動をする画面ができる。
// 設計は docs/superpowers/specs/2026-09-02-community-screens-design.md の決定2。
// ------------------------------------------------------------------

// 【50 の根拠は設計書の決定1-b】上限そのものは安全のために要る
// (limit の無いクエリはコレクション全体を返しうるのでルールが拒否する)。
// 値が50なのは、無料枠が約200人まで持つから。上げると無料枠は**早く**尽きる。
// **公開ユーザーが40人に達したら決定1-b を読み直すこと。**
export const DIRECTORY_LIMIT = 50;

/**
 * 公開しているユーザーを読む。
 *
 * 【where("isPublic","==",true) を必ず付ける】ルールの list は返る1件ごとに評価されるので、
 * 非公開の人が1件でも当たるとクエリ全体が失敗する。付け忘れは「漏れる」ではなく
 * 「全件失敗」になる ── そう設計してある。
 *
 * @param orderField 並べ替えに使う `stats.*` の項目。省略すると並べ替えない
 */
export async function listPublicUsers({ orderField = null, max = DIRECTORY_LIMIT } = {}) {
  const { db } = getFirebase();
  const parts = [where("isPublic", "==", true)];
  // 並べ替えを指定するときは複合索引が要る。索引が無いと Firestore は
  // 「索引を作れ」という明確なエラーを返すので、黙って壊れることはない。
  if (orderField) parts.push(orderBy(orderField, "desc"));
  parts.push(qLimit(max));
  const snap = await getDocs(query(collection(db, "users"), ...parts));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

/**
 * 自分の練習日数を公開する。**プロフィールの他の項目には触らない。**
 * updateDoc で stats だけを差し替える(setDoc の全置換だと他の項目を巻き添えにする)。
 */
export async function publishStats(uid, stats) {
  const v = validateStats(stats);
  if (v.error) throw new Error(v.error);
  const { db } = getFirebase();
  await updateDoc(doc(db, "users", uid), { stats: v.stats });
}

// ------------------------------------------------------------------
// 条件で絞る。**サーバではなくクライアントで絞る。**
//
// 理由は2つ:
//   1. 3条件の組み合わせごとに複合索引が要り、組み合わせ数だけ増える
//   2. genres は配列で、array-contains は1クエリに1つしか使えない
//
// 50人の中で絞るので「条件を絞ったのに0人」が起きうる。呼ぶ側はそれを前提にすること。
// ------------------------------------------------------------------

export const ANY = "__any__"; // 「指定なし」。空文字だと「未入力」と見分けが付かない

/**
 * @param filter { saxType, genre, position } 各項目は ANY で「指定なし」
 */
export function filterUsers(users, { saxType = ANY, genre = ANY, position = ANY } = {}) {
  return (users ?? []).filter((u) => {
    if (!u) return false;
    // 楽器種別は配列(掛け持ちの奏者が居る)。1つでも当たれば通す。
    if (saxType !== ANY && !(Array.isArray(u.saxTypes) && u.saxTypes.includes(saxType))) return false;
    // ジャンルも配列。「クラシックもジャズもやる人」はどちらの絞り込みにも現れる。
    if (genre !== ANY && !(Array.isArray(u.genres) && u.genres.includes(genre))) return false;
    // 属性は単一。
    if (position !== ANY && u.position !== position) return false;
    return true;
  });
}

/** 絞り込みが1つでも効いているか(画面の「絞り込み中」表示に使う) */
export function isFiltered({ saxType = ANY, genre = ANY, position = ANY } = {}) {
  return saxType !== ANY || genre !== ANY || position !== ANY;
}
