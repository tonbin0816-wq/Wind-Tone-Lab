// ------------------------------------------------------------------
// 判定の**純関数だけ**を置く。Firebase にも Vision にも触らない。
// 便AH 2026-09-23 凍結仕様 決定6 / 決定7:
//   docs/superpowers/specs/2026-09-23-avatar-photo.md
//
// 【ここに切り出した理由】判定の線引きが index.js の中にしか無いと、
// 配信しないと確かめられない。ここに出せば単体で走らせて確かめられる
// (src/community/avatarVerdict.test.js が引数を与えて実際に走らせている)。
//
// 【決定3 「確認中」を作らない】判定は**その場で1回**行い、通るか落ちるかしかない。
// だからこのファイルにも「保留」を表す返り値が無い。
// ------------------------------------------------------------------

// 置ける大きさ・形式。**storage.rules と src/community/avatarPhoto.js の写し。**
// 3つが食い違うと「上げられるのに関数が拒む」「関数は通すのにルールが拒む」が起きる。
export const PHOTO_MAX_BYTES = 262144;
export const PHOTO_MIME = "image/webp";

/** クライアントが書ける置き場。**判定前なので誰にも見せない。** */
export const uploadPathOf = (uid) => `avatarUploads/${uid}/photo.webp`;

/**
 * 判定を通った写真の置き場。**rev を名前に混ぜる。**
 * 同じ名前を使い回すと、古い場所を指している画面(や CDN の写し)に
 * 新しい写真が出てしまう。差し替えるたびに別の名前にすれば、それが起こらない。
 */
export const avatarPathOf = (uid, rev) => `avatars/${uid}/${rev}.webp`;

/** その uid の写真が置かれている場所すべての接頭辞(消すときに使う)。 */
export const avatarPrefixOf = (uid) => `avatars/${uid}/`;

/**
 * SafeSearch の答えから、載せてよいかを決める。
 *
 * 【落とす段は LIKELY 以上】Vision は5段(VERY_UNLIKELY / UNLIKELY / POSSIBLE /
 * LIKELY / VERY_LIKELY)で返す。POSSIBLE まで落とすと、逆光の顔や赤い服が
 * 落ちて「なぜ使えないのか分からない」が増える。LIKELY 以上に絞る。
 *
 * 【答えが無いときは落とす(fail closed)】判定できなかったものを通すと、
 * 「判定を通っていない写真が載る経路」ができる ── 決定6 が禁じているのはそれ。
 */
const BLOCK_AT = new Set(["LIKELY", "VERY_LIKELY"]);
const LOOKED_AT = ["adult", "violence", "racy", "medical"];

export function safeSearchVerdict(annotation) {
  if (annotation === null || typeof annotation !== "object") {
    return { ok: false, reason: "no-verdict" };
  }
  for (const k of LOOKED_AT) {
    const v = annotation[k];
    // 【段が読めないものも落とす】未知の綴り・undefined を「安全」と読まない。
    if (typeof v !== "string") return { ok: false, reason: `no-verdict:${k}` };
    if (BLOCK_AT.has(v)) return { ok: false, reason: k };
  }
  return { ok: true, reason: null };
}

/**
 * **本当に WebP か**を先頭のバイト列で見る(中9 / 2026-09-23 審査役の指摘)。
 *
 * storage.rules も uploadAcceptable も、見ているのは**クライアントが申告した
 * Content-Type だけ**である。JPEG を `image/webp` と称して上げれば、どちらも素通りする。
 * 申告ではなく中身を見れば、その嘘は通らない。
 *
 * WebP は RIFF コンテナ: "RIFF" + 4バイトの長さ + "WEBP"。
 */
export function looksLikeWebp(bytes) {
  const len = bytes?.length;
  if (typeof len !== "number" || len < 12) return false;
  const eq = (off, s) => {
    for (let i = 0; i < s.length; i++) if (bytes[off + i] !== s.charCodeAt(i)) return false;
    return true;
  };
  return eq(0, "RIFF") && eq(8, "WEBP");
}

/**
 * users の写真が**消えた**か(決定9)。
 *
 * 「前は在って、今は無い」ときだけ真。差し替え(前も今も在る)では真にしない ──
 * 真にすると、載せたばかりの写真まで掃除が消す。
 */
export function shouldDropPhoto(before, after) {
  const had = typeof before?.photo === "string" && before.photo.length > 0;
  const has = typeof after?.photo === "string" && after.photo.length > 0;
  return had && !has;
}

/**
 * 上がってきたものが、こちらが要求した形かどうか。
 * **storage.rules が同じことを見ている**が、ルールを通らない経路(コンソール等)が
 * 混ざったときに備えて関数側でも見る。片方だけに頼らない。
 * **これは申告(Content-Type)を見るだけ**なので、中身は looksLikeWebp が見る。
 */
export function uploadAcceptable(meta) {
  const size = Number(meta?.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, reason: "empty" };
  if (size > PHOTO_MAX_BYTES) return { ok: false, reason: "too-large" };
  if (meta?.contentType !== PHOTO_MIME) return { ok: false, reason: "not-webp" };
  return { ok: true, reason: null };
}

/**
 * 画面が読む場所。Firebase Storage の取り出し口に、ドキュメントの鍵を添えた形。
 * **ここで組み立てる**ので、置き場の名前を変えたときに直す場所が1つで済む。
 */
export function downloadUrlOf(bucket, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

/**
 * downloadUrlOf の逆。users/{uid}.photo(URL)から Storage の置き場を取り出す。
 * 読めない形なら null(= 残すべき物は分からない、として扱う)。
 *
 * 【便AJ 2026-09-24】掃除の直前に「いま載っている写真」を読み直すために要る。
 * users に在るのは URL だけで、消す側が要るのは置き場の名前なので。
 */
export function pathOfDownloadUrl(url) {
  if (typeof url !== "string") return null;
  const m = url.match(/\/o\/([^?]+)\?/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}
