import {
  avatarPathOf, avatarPrefixOf, downloadUrlOf, looksLikeWebp, pathOfDownloadUrl, safeSearchVerdict,
  shouldDropPhoto, uploadAcceptable, uploadPathOf,
} from "./avatarVerdict.js";

// ------------------------------------------------------------------
// 写真の仕事の**中身**。Firebase も Vision も import しない ──
// 触るものはすべて引数(deps)で受け取る。
//
// 【なぜ index.js から出したか ── 2026-09-23 審査役の指摘】
// index.js は firebase-functions を import するので、`node_modules` を入れない限り
// **1行も走らせられない**。走らせられないコードは、綴りの検査でしか守れない。
// 審査役の変異(`deleteFiles` を `if (false)` で殺す)が生き残ったのはそのためである。
// 触る相手を引数にすれば、作り物を渡して**実際に走らせて**確かめられる。
// index.js は本物の道具をここへ渡すだけの配線になる。
// ------------------------------------------------------------------

/** 呼び出し側(index.js)が HttpsError へ翻訳するための種別つきの失敗。 */
export function photoError(kind, reason) {
  const e = new Error(kind === "unavailable" ? `photo-unavailable: ${reason}` : `photo-rejected: ${reason}`);
  e.kind = kind;
  e.reason = reason;
  return e;
}

/**
 * 上がってきた写真を判定し、通ったら Storage と users に書く。
 *
 * 【重1 の要 ── バイト列は1度しか読まない(2026-09-23 審査役の指摘)】
 * 以前は「Vision には gs:// のアドレスを渡し、保存は `copy` で写す」形だった。
 * どちらも**その時点の最新世代**を別々の時刻に読むので、
 *   無害な画像を上げる → これを呼ぶ → 呼んだ直後に同じ場所を差し替える
 * で、判定は前の画像・保存は後の画像になり得た(TOCTOU)。
 * storage.rules は置き場への上書きを何度でも許しているので、実際に起こせる。
 *
 * **いまは `download` で1度だけ読み、その同じバッファを判定にも保存にも使う。**
 * 読んだあとに置き場が何度差し替えられても、載るのは判定したそのバイト列だけになる。
 * 「判定を通っていない写真が載る経路が構造上存在しない」(決定6)はこれで成立する。
 */
export async function runVetAvatarPhoto({ uid }, deps) {
  if (!uid) throw photoError("unauthenticated", "no-uid");
  const src = uploadPathOf(uid);

  if (!(await deps.exists(src))) throw photoError("rejected", "no-upload");

  const form = uploadAcceptable(await deps.getMetadata(src));
  if (!form.ok) {
    await deps.remove(src);
    throw photoError("rejected", form.reason);
  }

  // ---- ここから先は、このバッファだけを見る ------------------------------
  const bytes = await deps.download(src);

  // 【中9】申告ではなく中身を見る。JPEG を image/webp と称して上げても通らない。
  if (!looksLikeWebp(bytes)) {
    await deps.remove(src);
    throw photoError("rejected", "not-webp-bytes");
  }

  let verdict;
  try {
    verdict = safeSearchVerdict(await deps.safeSearch(bytes));
  } catch (e) {
    // 判定そのものが失敗したときは**通さない**(fail closed)。
    await deps.remove(src);
    throw photoError("unavailable", "no-verdict");
  }
  if (!verdict.ok) {
    await deps.remove(src);
    throw photoError("rejected", verdict.reason);
  }

  // ---- 載せる ------------------------------------------------------------
  // 【名前を毎回変える】古い場所を指している画面や CDN の写しに新しい写真が出ない。
  const rev = deps.rev();
  const token = deps.token();
  const dest = avatarPathOf(uid, rev);
  await deps.save(dest, bytes, token);
  await deps.remove(src);

  const url = downloadUrlOf(deps.bucketName, dest, token);
  // **決定6 の要**: users に値を入れるのはこの1回だけ。
  await deps.writeUserPhoto(uid, url);

  // 【1人1枚(決定7)】差し替えのたびに増やさない。いま載せた物だけを残す。
  // 【便AJ 2026-09-24 競合】同じ人が続けて2枚上げると、先に終わった側の片付けが
  // 後から載った写真を消し得る。**消す直前に users の写真を読み直し、それも残す。**
  // (窓を狭めるだけで、ゼロにはしない ── 読んでから消すまでの間に別の書き込みが
  //  割り込む余地は残る。同じ人が1秒以内に2枚上げる形なので、ここで止める。)
  const current = pathOfDownloadUrl(await deps.readUserPhoto(uid));
  await deps.dropOthers(avatarPrefixOf(uid), [...new Set([dest, current].filter(Boolean))]);
  return { photo: url };
}

/**
 * users の写真が消えたら、Storage の写真も消す(決定9)。
 *
 * 3つの経路をこれ1つがまかなう:
 *   ・アカウント削除   … ドキュメントごと消える
 *   ・絵柄を選び直した … クライアントが photo に null を書く(決定4)
 *   ・運営が剥がす     … コンソールで photo を消す(コンソールはルールを通らない)
 */
export async function runCleanAvatarPhoto({ uid, before, after }, deps) {
  if (!shouldDropPhoto(before, after)) return { dropped: false };
  // 【便AJ 2026-09-24 競合】この掃除は users の書き込みを**合図に非同期で**走るので、
  // 数秒遅れて来ることがある。「絵柄に戻す → すぐ新しい写真を上げる」と、
  // 起動した時点では新しい写真がもう載っている。丸ごと消すとそれも消える。
  // **消す直前に読み直し、いま載っている写真があれば、それ以外だけを消す。**
  // その場合は置き場(avatarUploads)にも触らない ── 新しい写真の判定が使っている最中かもしれない。
  const current = pathOfDownloadUrl(await deps.readUserPhoto(uid));
  if (current) {
    await deps.dropOthers(avatarPrefixOf(uid), [current]);
    return { dropped: true, kept: current };
  }
  await deps.dropAll(avatarPrefixOf(uid));
  await deps.remove(uploadPathOf(uid));
  return { dropped: true };
}
