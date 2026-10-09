import { initializeApp } from "firebase/app";
import { getAuth, initializeAuth, indexedDBLocalPersistence } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";
import { isNativeShell } from "../shell/native.js";

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

// 【便CJ 2026-10-10 統括の裁定(本人「コミュニティタブで63%くらいで止まることが多い」の根の候補)】殻(Capacitor の iOS WKWebView)の Firestore は
// 長いポーリングを強制する。WKWebView では Firestore の既定の通信(WebChannel のストリーミング)が返らなくなる事例が知られている
// (https://github.com/firebase/firebase-js-sdk/issues/1674 ほか。SDK の文書も「通信を溜め込む経路との相性のための設定」と書く)。
// 入っている版(firebase 12.18.0 / @firebase/firestore 4.17.1)では、experimentalAutoDetectLongPolling の既定は true
// (node_modules/@firebase/firestore/dist/index.d.ts の注記「v9.22.0 で既定を true に変えた」と、同じ版の FirestoreSettingsImpl の
// 「未指定なら true」)。自動判定でも返らない事例に備えて、殻では強制(experimentalForceLongPolling: true)にする。
// 2つは一緒に指定できない(FirestoreSettingsImpl の __PRIVATE_validateIsNotUsedTogether)ので、強制の1つだけを渡す(強制なら自動判定は false になる)。
// Web 版は今までどおり getFirestore(app)(既定の自動判定)。
export const SHELL_FIRESTORE_SETTINGS = Object.freeze({ experimentalForceLongPolling: true });

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
    // 【殻 S1】Capacitor の WKWebView では既定の getAuth(永続化の自動選択)が onAuthStateChanged を返さないことがある。
    // Firebase の案内(ハイブリッドアプリは initializeAuth + indexedDBLocalPersistence)に従う。Web 版は今までどおり getAuth。
    const auth = isNativeShell() ? initializeAuth(app, { persistence: indexedDBLocalPersistence }) : getAuth(app);
    // 【便CJ】殻だけ長いポーリングを強制(上の SHELL_FIRESTORE_SETTINGS)。Web は今までどおり
    const db = isNativeShell() ? initializeFirestore(app, SHELL_FIRESTORE_SETTINGS) : getFirestore(app);
    cached = { app, auth, db };
  }
  return cached;
}
