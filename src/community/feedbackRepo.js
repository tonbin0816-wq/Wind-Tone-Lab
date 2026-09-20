import { addDoc, collection } from "firebase/firestore";
import { getFirebase } from "./firebaseClient.js";
import { detectDeviceClass } from "./profile.js";

// ------------------------------------------------------------------
// お問い合わせ・要望/感想の**投書箱**。書くだけで、1件も読まない。
//
// 【束3 2026-09-19 本人指示・裁定ずみ】本人「お問い合わせはメールに飛ばす形ではなくて
// 添付画像のような形を採用できますか？」── アプリの中のフォームにし、書かれた文字を
// feedback へ書き込む。読むのは運営者(Firebase コンソール)だけで、アプリには
// 一覧も詳細も無い。**このファイルに読む関数を足さないこと** ── 足した瞬間、
// 「他人の投書が誰にも見えない」という約束(firestore.rules の feedback)が
// アプリ側の期待と食い違い、read を許す圧力になる。
//
// 【プロフィールは作らない】送信のときに ensureSignedIn で匿名の資格情報だけを得る
// (呼ぶのは FeedbackSheet)。users は1つも書かないので、**コミュニティへの参加ではない**。
// uid を添えるのは、同じ人からの続きを運営者が辿れるようにするためだけで、
// プロフィールとは結び付けない(参加していない人の uid も入る)。
//
// 【deviceClass は写しを作らない】プロフィールが使っている判定(profile.js の
// detectDeviceClass)をそのまま呼ぶ。「iOS だけで起きる」という報告が多いので、
// 本文に書かれていなくても切り分けられるようにしておく。
// ------------------------------------------------------------------

// 本文の上限。**この数の置き場はここ1つ**にする:
//   ・画面(FeedbackSheet)が maxLength と送る前の切り詰めに使う
//   ・firestore.rules の feedback が同じ 1000 を持つ(ルールは別ファイルなので写しになる。
//     片方だけ直すと「画面では書けるのにサーバーに拒まれる」行き止まりになる。
//     検証64 が両方を突き合わせている)
export const FEEDBACK_MAX = 1000;

/**
 * 投書の中身を作る。**純粋な組み立てだけ**(通信しない)。
 * createdAt は ISO の文字列 ── 他のドキュメント(users / ideals / reports)と同じ扱いで、
 * サーバー時刻は使っていない。
 */
export function buildFeedbackDoc({ uid, text }, now = new Date()) {
  return {
    uid,
    text: String(text ?? "").slice(0, FEEDBACK_MAX),
    createdAt: now.toISOString(),
    deviceClass: detectDeviceClass(),
  };
}

/**
 * 投書を1件書く。id は Firestore に任せる(addDoc)。
 *
 * 【setDoc ではなく addDoc】id を自分で決めると「同じ人の2通目」が1通目を上書きしうる。
 * 通報(reports)は二重通報を弾くために id を決めていたが、こちらは**何通でも送れてよい**。
 */
export async function sendFeedback({ uid, text }, now = new Date()) {
  const { db } = getFirebase();
  await addDoc(collection(db, "feedback"), buildFeedbackDoc({ uid, text }, now));
}
