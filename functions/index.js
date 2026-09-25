import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { randomUUID } from "node:crypto";
import { runCleanAvatarPhoto, runVetAvatarPhoto } from "./avatarJobs.js";

// ====================================================================
// アイコンの写真(便AH 2026-09-23 凍結仕様)
//   docs/superpowers/specs/2026-09-23-avatar-photo.md
//
// 【このファイルは配線だけ】判断と手順は avatarJobs.js / avatarVerdict.js が持つ。
// あちらは Firebase も Vision も import しないので、**作り物を渡して実際に走らせて
// 確かめられる**(src/community/avatarJobs.test.js)。ここには if を足さないこと。
// ====================================================================

initializeApp();
// 写真1枚は 256px の WebP / JPEG なので割り当ては最小でよい。同時実行を絞るのは、
// 万一叩かれたときに費用が伸び続けないようにするため。
// 【便AP 2026-09-24 東京へ移した】us-central1 に置いていたので、1回の判定で写真の置き場・
// データベース(どちらも東京)と10回ほど太平洋を往復し、温まっていても約4秒かかっていた
// (実測: 送信 0.17秒 / 判定 3.9〜4.2秒、冷えていると8秒)。
// **src/community/photoRepo.js の PHOTO_FUNCTIONS_REGION の写し。片方だけ直さないこと。**
setGlobalOptions({ region: "asia-northeast1", memory: "256MiB", timeoutSeconds: 60, maxInstances: 10 });

const db = () => getFirestore();
const bucket = () => getStorage().bucket();

// Vision は呼ぶときに初めて作る(使わない配信で接続を張らない)。
let vision = null;
const visionClient = () => (vision ??= new ImageAnnotatorClient());

// avatarJobs が使う道具。**本物の Firebase をここで束ねる。**
const storageDeps = () => ({
  get bucketName() { return bucket().name; },
  exists: async (p) => (await bucket().file(p).exists())[0],
  getMetadata: async (p) => (await bucket().file(p).getMetadata())[0],
  download: async (p) => (await bucket().file(p).download())[0],
  // 【判定したバイト列そのものを書く】置き場から写す(copy)のではない ── 重1。
  // 形式は中身から決めたもの(WebP / JPEG)。関数に渡すのは Buffer にそろえる。
  save: (p, bytes, token, contentType = "image/webp") => bucket().file(p).save(Buffer.from(bytes), {
    contentType,
    metadata: {
      cacheControl: "public, max-age=31536000, immutable",
      metadata: { firebaseStorageDownloadTokens: token },
    },
  }),
  remove: async (p) => { try { await bucket().file(p).delete(); } catch (e) { console.warn("[avatar] 消せなかった", p, e?.message); } },
  // keep は1つの名前でも、名前の配列でもよい(便AJ: 読み直した「いま載っている写真」も残す)。
  dropOthers: async (prefix, keep) => {
    try {
      const keeps = new Set([].concat(keep ?? []));
      const [olds] = await bucket().getFiles({ prefix });
      await Promise.all(olds.filter((f) => !keeps.has(f.name)).map((f) => f.delete().catch(() => {})));
    } catch (e) { console.warn("[avatar] 古い写真を消せなかった", e?.message); }
  },
  dropAll: async (prefix) => { await bucket().deleteFiles({ prefix }); },
  safeSearch: async (bytes) => {
    const [res] = await visionClient().safeSearchDetection({ image: { content: Buffer.from(bytes) } });
    return res?.safeSearchAnnotation ?? null;
  },
  writeUserPhoto: (uid, url) => db().doc(`users/${uid}`).set({ photo: url }, { merge: true }),
  // 【便AJ】掃除の直前に「いま載っている写真」を読み直す。文書が無ければ null。
  readUserPhoto: async (uid) => {
    const snap = await db().doc(`users/${uid}`).get();
    return snap.exists ? (snap.get("photo") ?? null) : null;
  },
  rev: () => randomUUID().replace(/-/g, "").slice(0, 16),
  token: () => randomUUID(),
});

const CODE_OF = { unauthenticated: "unauthenticated", rejected: "failed-precondition", unavailable: "unavailable" };

// 【便AP 2026-09-24 → 2026-09-25 並走を終えた】移し替えの間は us-central1 にも置いていたが、
// 端末の配信から1日たったので外した。地域は setGlobalOptions の asia-northeast1 だけ。
export const vetAvatarPhoto = onCall(async (req) => {
  try {
    return await runVetAvatarPhoto({ uid: req.auth?.uid ?? null }, storageDeps());
  } catch (e) {
    if (e?.kind) throw new HttpsError(CODE_OF[e.kind] ?? "internal", e.message);
    console.error("[avatar] 想定外の失敗", e?.message);
    throw new HttpsError("internal", "photo-unavailable: internal");
  }
});

export const cleanAvatarPhoto = onDocumentWritten("users/{uid}", async (event) => {
  await runCleanAvatarPhoto({
    uid: event.params.uid,
    before: event.data?.before?.data?.() ?? null,
    after: event.data?.after?.data?.() ?? null,
  }, storageDeps());
});
