import { getStorage, ref as storageRef, uploadBytes } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebase } from "./firebaseClient.js";
import { PHOTO_MIME } from "./avatarPhoto.js";

// ------------------------------------------------------------------
// アイコンの写真の読み書き。純関数は avatarPhoto.js が持つ。
// 凍結仕様: docs/superpowers/specs/2026-09-23-avatar-photo.md
//
// 【決定6 写真はサーバの関数だけが書ける】
// ここが触るのは**置き場**だけで、`users/{uid}.photo` には1文字も書かない。
// 値を入れるのは判定を通した Cloud Functions(Admin SDK なのでルールを迂回する)。
// だから「判定を通っていない写真が載る」経路が**構造上存在しない**。
//
// 【置き場が2つある理由】
//   avatarUploads/{uid}/photo.webp … クライアントが書ける。**誰も見ない**
//   avatars/{uid}/...              … 関数だけが書ける。ここだけが画面に出る
// 1つにすると、判定を通ったあとで**同じ場所を別の画像で上書き**できてしまい、
// users に載っている URL の中身だけがすり替わる。場所を分けると、それが起こらない。
//
// 【決定3 「確認中」を作らない】呼ぶ側は待つだけでよい。
// この関数が返った時点で写真は載っているか、例外が投げられているかのどちらかで、
// 途中の状態が残らない。
// ------------------------------------------------------------------

/** クライアントが書ける唯一の置き場。**1人1枚**(名前が固定なので増えない)。 */
export const photoUploadPath = (uid) => `avatarUploads/${uid}/photo.webp`;

/**
 * 写真を保存する。**書き直し済みの Blob だけを受け取る**
 * (File をそのまま渡す道を作らない ── EXIF が付いたまま出ていく)。
 *
 * 1. 置き場へ上げる(storage.rules が uid・大きさ・形式を見る)
 * 2. 関数を呼ぶ。**返ってくるまでが「保存中」**で、返ったときにはもう載っている
 *
 * @returns {Promise<string>} users に載った写真の場所
 */
export async function saveAvatarPhoto(uid, blob) {
  const { app } = getFirebase();
  await uploadBytes(storageRef(getStorage(app), photoUploadPath(uid)), blob, { contentType: PHOTO_MIME });
  const vet = httpsCallable(getFunctions(app), "vetAvatarPhoto");
  const res = await vet({});
  const url = res?.data?.photo;
  // 【空で成功したことにしない】URL が返らないのに成功扱いにすると、
  // 画面は絵柄のまま「保存できた」ことになる。呼ぶ側が失敗の文言を出せるよう投げる。
  if (typeof url !== "string" || url.length === 0) throw new Error("PHOTO_NOT_STORED");
  return url;
}
