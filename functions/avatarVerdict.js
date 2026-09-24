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
// 【便AP 2026-09-24 本人の実機報告「写真はなにを選んでも使えません」】
// **iPhone の Safari は canvas を WebP で書き出せない。** toBlob に image/webp を頼むと
// 黙って PNG を返し、アプリはそれに「WebP」の札を付けて送っていた。判定は中身を見て
// 弾くので、iPhone ではどの写真も必ず落ちていた(Chrome では WebP が出るので気づけなかった)。
// 端末は WebP が出なければ JPEG で書き直す。ここでも JPEG を受ける。
// **JPEG の付帯情報(EXIF・XMP・撮影位置・注釈・末尾に足された物)は、判定の前にここで取り除く**
// (stripJpegMetadata)。画素の走査の間に挟まった区画も、画像の終わり(EOI)の後ろも読んで捨てる。
// 【言い過ぎない】画素そのものに文字を埋める(見た目に写し込む)ことは防げない ── それは写真の中身。
export const PHOTO_MIME_JPEG = "image/jpeg";
export const PHOTO_MIMES = [PHOTO_MIME, PHOTO_MIME_JPEG];

/** クライアントが書ける置き場。**判定前なので誰にも見せない。**
 * 名前は JPEG でも photo.webp のまま(1人1枚の鍵。形式は名前でなく Content-Type と中身で見る)。 */
export const uploadPathOf = (uid) => `avatarUploads/${uid}/photo.webp`;

/**
 * 判定を通った写真の置き場。**rev を名前に混ぜる。**
 * 同じ名前を使い回すと、古い場所を指している画面(や CDN の写し)に
 * 新しい写真が出てしまう。差し替えるたびに別の名前にすれば、それが起こらない。
 */
export const avatarPathOf = (uid, rev, kind = PHOTO_MIME) =>
  `avatars/${uid}/${rev}.${kind === PHOTO_MIME_JPEG ? "jpg" : "webp"}`;

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

/** **本当に JPEG か**を先頭のバイト列で見る。JPEG は SOI(FF D8)の直後にマーカー(FF)が来る。 */
export function looksLikeJpeg(bytes) {
  const len = bytes?.length;
  if (typeof len !== "number" || len < 4) return false;
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** 中身から形式を決める。WebP / JPEG のどちらでもなければ null。**申告は見ない。** */
export function photoKindOf(bytes) {
  if (looksLikeWebp(bytes)) return PHOTO_MIME;
  if (looksLikeJpeg(bytes)) return PHOTO_MIME_JPEG;
  return null;
}

/**
 * JPEG から付帯情報を取り除いた**新しいバイト列**を返す。壊れていれば null。
 *
 * 【残すもの】画像の復号に要る区画だけ:
 *   量子化表・ハフマン表・SOF・DRI・SOS と画素の走査(詰め物 FF 00 と区切り RSTn を含む)、
 *   APP2 の色の定義(ICC_PROFILE で始まるもの)、APP14 の色変換の印(Adobe・12バイト)。
 * 【捨てるもの】上記以外の APP0〜APP15(EXIF・XMP・撮影位置・JFIF の縮小画像)と注釈 COM、
 *   そして**最初の EOI より後ろ**(2枚目の JPEG をつなげる等。「最後の」にすると2枚目が残る)。
 * 【落とす(null)もの】上のどれでもない番号の区画(JPGn・予約番号・FF C8・DE・DF など)。
 *   復号に要らず、中身を問わず残すと文字を運べるので、**名前で許した物だけを残す**。
 *
 * 画素の走査は区画として読まない。走査の中の FF は、後ろが 00(詰め物)か D0〜D7(区切り)なら
 * 画素の一部で、それ以外なら次の区画の始まり。プログレッシブ JPEG では走査が何回も来て、
 * **走査の間にも APPn や COM を挟める**ので、最初の SOS で打ち切らずに最後まで読む。
 *
 * 【判定と保存に使うのはこの戻り値】取り除く前のバイト列を判定し、取り除いた後を保存する、
 * のように分けると、判定を通ったものと載るものが別物になる(重1 と同じ形)。
 */
const JPEG_ICC = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00]; // "ICC_PROFILE\0"
const JPEG_ADOBE = [0x41, 0x64, 0x6f, 0x62, 0x65]; // "Adobe"
const startsWith = (bytes, at, sig) => sig.every((v, k) => bytes[at + k] === v);

// 画像の区画: SOF0〜15(C0〜CF のうち C4 DHT・CC DAC を含み、C8 は予約なので除く)、
// SOS(DA)・DQT(DB)・DNL(DC)・DRI(DD)。
const isImageSegment = (m) => (m >= 0xc0 && m <= 0xcf && m !== 0xc8) || (m >= 0xda && m <= 0xdd);

/** 区画をどうするか: "keep"(残す) / "drop"(捨てる) / "reject"(知らない区画。JPEG ごと落とす)。 */
function jpegSegmentFate(marker, bytes, payloadAt, segLen) {
  if (marker === 0xfe) return "drop";                      // COM
  if (marker >= 0xe0 && marker <= 0xef) {
    if (marker === 0xe2 && startsWith(bytes, payloadAt, JPEG_ICC)) return "keep";
    if (marker === 0xee && segLen === 14 && startsWith(bytes, payloadAt, JPEG_ADOBE)) return "keep";
    return "drop";                                         // APP0・APP1(EXIF/XMP)・その他
  }
  return isImageSegment(marker) ? "keep" : "reject";
}

export function stripJpegMetadata(bytes) {
  if (!looksLikeJpeg(bytes)) return null;
  const n = bytes.length;
  const keep = [[0, 2]];            // SOI
  let sawScan = false;
  let i = 2;
  for (;;) {
    if (i >= n || bytes[i] !== 0xff) return null;
    let j = i;
    while (j < n && bytes[j] === 0xff) j += 1;   // 区画の前の詰め物の FF を飛ばす
    if (j >= n) return null;
    const marker = bytes[j];
    const at = j - 1;               // FF xx の FF の位置
    if (marker === 0xd9) {          // EOI: ここで終わり。後ろは捨てる
      if (!sawScan) return null;
      keep.push([at, j + 1]);
      break;
    }
    // 長さを持たない印(TEM・RSTn・2つ目の SOI)が区画の位置に来るのは壊れた形
    if (marker === 0x00 || marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return null;
    if (j + 2 >= n) return null;
    const segLen = (bytes[j + 1] << 8) | bytes[j + 2];
    if (segLen < 2) return null;
    const end = j + 1 + segLen;
    if (end > n) return null;
    const fate = jpegSegmentFate(marker, bytes, j + 3, segLen);
    if (fate === "reject") return null;
    if (fate === "keep") keep.push([at, end]);
    i = end;
    if (marker === 0xda) {          // SOS: 後ろは画素の走査。次の本物の区画まで写す
      sawScan = true;
      let k = end;
      for (;;) {
        if (k >= n) return null;    // EOI が来ないまま終わった
        if (bytes[k] !== 0xff) { k += 1; continue; }
        let m = k;
        while (m < n && bytes[m] === 0xff) m += 1;
        if (m >= n) return null;
        const b = bytes[m];
        if (b === 0x00 || (b >= 0xd0 && b <= 0xd7)) { k = m + 1; continue; }  // 詰め物・区切り
        break;                      // k は次の区画の FF(の並び)の頭
      }
      keep.push([end, k]);
      i = k;
    }
  }
  let total = 0;
  for (const [a, b] of keep) total += b - a;
  const out = new Uint8Array(total);
  let o = 0;
  for (const [a, b] of keep) { out.set(bytes.subarray(a, b), o); o += b - a; }
  return out;
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
 * **これは申告(Content-Type)を見るだけ**なので、中身は photoKindOf が見る。
 */
export function uploadAcceptable(meta) {
  const size = Number(meta?.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, reason: "empty" };
  if (size > PHOTO_MAX_BYTES) return { ok: false, reason: "too-large" };
  if (!PHOTO_MIMES.includes(meta?.contentType)) return { ok: false, reason: "not-image" };
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
