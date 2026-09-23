import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// 接続設定が欠けていることを表す印。**通信の失敗とは別の型で投げる。**
//
// Vite は import.meta.env.VITE_* を**ビルド時に**埋め込む。`.env.local` は
// リポジトリに入れていないので、Vercel / Netlify のように別の場所でビルドする配信では、
// その環境に環境変数を設定しないかぎり全部 undefined になる。
// この状態で initializeApp すると後段の auth で分かりにくく失敗するが、
// **これは電波とは無関係で、待っても直らない**(再ビルドしないかぎり永久に失敗する)。
// 画面が「設定の問題」と「通信の問題」を言い分けられるように、型で区別する。
export class FirebaseConfigMissingError extends Error {
  constructor(missing) {
    super(`Firebase の接続設定が読み込めません: ${missing.join(", ")}`);
    this.name = "FirebaseConfigMissingError";
    this.missing = missing;
  }
}

/**
 * 写真の置き場(Cloud Storage のバケット)の名前を決める。
 *
 * 【便AH-2 2026-09-23 統括】もとは環境変数だけを見ていたが、それだと
 * **手元と Vercel の両方に同じ値を入れるまで本番の写真が動かない**。
 * Vite はビルド時に値を埋め込むので、Vercel 側を忘れると手元だけ動いて
 * 本番で「送信できませんでした」が出る ── 原因が一番分かりにくい形になる。
 *
 * Firebase の既定のバケット名は `<projectId>.firebasestorage.app` で、
 * projectId は**すでに必須の4キーに入っている**。だから導ける。
 * (このプロジェクトの実物が ficus-caa43.firebasestorage.app であることは
 *  2026-09-23 に確認済み。古い `<projectId>.appspot.com` は存在しない。)
 *
 * 環境変数は**上書きとして残す** ── 既定と違う名前のバケットを使う配信や、
 * 将来バケットを移したときに、コードを変えずに追従できるようにするため。
 */
export function storageBucketFor(projectId, override = undefined) {
  if (typeof override === "string" && override.length > 0) return override;
  if (typeof projectId !== "string" || projectId.length === 0) return undefined;
  return `${projectId}.firebasestorage.app`;
}

let cached = null;

export function getFirebase() {
  if (!cached) {
    const conf = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };
    const missing = Object.keys(conf).filter((k) => !conf[k]);
    if (missing.length > 0) throw new FirebaseConfigMissingError(missing);

    // 【便AH 2026-09-23】アイコンの写真の置き場(Cloud Storage)。
    // **必須にしない。** これが無い配信でもコミュニティは今までどおり全部動き、
    // 写真を選んだときだけ失敗する(そこで「送信できませんでした」が出る)。
    // 上の4つと同じ扱いにすると、環境変数を1つ足すまでタブ全体が開かなくなる。
    const storageBucket = storageBucketFor(
      conf.projectId, import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    );

    const app = initializeApp(storageBucket ? { ...conf, storageBucket } : conf);
    cached = { app, auth: getAuth(app), db: getFirestore(app) };
  }
  return cached;
}
