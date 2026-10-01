import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { randomUUID } from "node:crypto";
import { runCleanAvatarPhoto, runVetAvatarPhoto } from "./avatarJobs.js";
import { monotonicClock, photoRevAt } from "./avatarVerdict.js";

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

// 【便BH 2026-10-01 本人裁定 (b)】同じ実体の中では必ず増える時計。版の物差しは置き場の
// timeCreated / generation(上げた順)で、これはそれが取れないとき・合図の時刻が読めないときの代わり。
const photoClock = monotonicClock();

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
      // 【便BH 差し戻し(統括裁定2)】private にした。public だと手前の共有キャッシュが応答を持ち、
      // 鍵を入れ替えたあとも古い鍵の URL に答え続けるおそれがある。前から在る写真は public のまま。
      cacheControl: "private, max-age=31536000, immutable",
      metadata: { firebaseStorageDownloadTokens: token },
    },
  }),
  // 【便BH 差し戻し】opts に { ifGenerationMatch } を渡せる(置き場を消すのは、読んだ世代のときだけ)。
  remove: async (p, opts) => { try { await bucket().file(p).delete(opts); } catch (e) { console.warn("[avatar] 消せなかった", p, e?.message); } },
  // 【便BH 2026-10-01 (b)】以前の dropOthers(「残す物以外をすべて消す」)は外した。
  // どれを消すか(いま載っている写真より古いものだけ)は avatarJobs が決める。ここは名前を並べるだけ。
  listPhotos: async (prefix) => (await bucket().getFiles({ prefix }))[0].map((f) => f.name),
  // 【便BH 差し戻し(統括裁定3)】dropAll(丸ごと消す)は外した。掃除は「合図の時刻より前に上げられた版」
  // だけを listPhotos と remove で消す(判断は avatarJobs)。
  // 【便BH 2026-10-01 (a)】鍵(firebaseStorageDownloadTokens)を書く。値は avatarJobs が決める
  // (「古い,新しい」→ 新しい1つ、の順)。新しい鍵だけになった時点で、古い鍵の URL では読めなくなる
  // (ただし、すでに見た人の端末のキャッシュは消せない)。
  setDownloadToken: (p, token) => bucket().file(p).setMetadata({ metadata: { firebaseStorageDownloadTokens: token } }),
  safeSearch: async (bytes) => {
    const [res] = await visionClient().safeSearchDetection({ image: { content: Buffer.from(bytes) } });
    return res?.safeSearchAnnotation ?? null;
  },
  // 【便BH 2026-10-01 (b)】トランザクションにした。いま載っている写真を読んで decide に渡す。
  // decide は「書く」道具(write)も受け取り、書くかどうかを**自分で**決める(avatarJobs の writeUserPhotoIf)。
  // ここに if を置かないため ── 判断はすべて avatarJobs が持つ。返り値は decide の答えそのまま。
  // トランザクションの中で読んだ値が書く前に変わっていれば、Firestore が decide からやり直す。
  writeUserPhoto: (uid, decide) => db().runTransaction(async (tx) => {
    const ref = db().doc(`users/${uid}`);
    const snap = await tx.get(ref);
    return decide(snap.exists ? (snap.get("photo") ?? null) : null, (photo) => tx.set(ref, { photo }, { merge: true }));
  }),
  // 【便AJ】掃除の直前に「いま載っている写真」を読み直す。文書が無ければ null。
  readUserPhoto: async (uid) => {
    const snap = await db().doc(`users/${uid}`).get();
    return snap.exists ? (snap.get("photo") ?? null) : null;
  },
  // 【便BH 2026-10-01 (b)】版に「上げた順」(置き場の時刻と世代)を入れる。形は avatarVerdict.js の photoRevAt。
  rev: (order) => photoRevAt(order.ms, order.gen, randomUUID().replace(/-/g, "").slice(0, 8)),
  now: () => photoClock(),
  token: () => randomUUID(),
});

// 【便BH 再審査】superseded(判定の途中で写真が外された)は aborted で返す。端末は文言を出さない。
const CODE_OF = { unauthenticated: "unauthenticated", rejected: "failed-precondition", unavailable: "unavailable", superseded: "aborted" };

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
    // 【便BH 差し戻し(統括裁定3)】合図(この書き込み)の時刻。掃除はこれより前に上げられた版だけを消す。
    at: event.time ?? null,
  }, storageDeps());
});
