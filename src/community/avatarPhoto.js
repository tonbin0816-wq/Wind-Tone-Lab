// ------------------------------------------------------------------
// アイコンに使う写真の**純関数だけ**を置く。Firestore にも Storage にも触らない
// (触るのは photoRepo.js)。凍結仕様:
//   docs/superpowers/specs/2026-09-23-avatar-photo.md
//
// 【ここに判断を集める理由】写真まわりの分岐が JSX の中にしか無いと、
// **綴りを見る検査しか書けない**。綴りの検査は「条件が消えた」ことは掴めても
// 「条件が逆になった」ことを掴めない(便AG で reportEntryVisible を出したのと同じ理由)。
//
// 【「確認中」を作らない(決定3)】判定は保存の最中に同期で行うので、
// このファイルにも呼び出し側にも**保留を表す状態が1つも無い**。
// 写真は「在る(判定を通った)」か「無い」かの2つしかない。
// ------------------------------------------------------------------
import { AVATAR_ICONS, AVATAR_COLOR_MIN, AVATAR_COLOR_MAX } from "./profile.js";

// 【書き直しの仕様(決定0/決定3の2番)】正方形 256px の WebP。
// **storage.rules と functions も同じ値を要求する。片方だけ直さないこと。**
export const PHOTO_EDGE_PX = 256;
export const PHOTO_MIME = "image/webp";
// 品質は 256px の顔写真が 10〜30KB に収まる帯。上限(下の PHOTO_MAX_BYTES)は
// この値に対して十分な余裕を見た固定値で、青天井にしないためのもの(決定7)。
export const PHOTO_QUALITY = 0.82;
// 256KiB。**storage.rules の写し。片方だけ直さないこと。**
export const PHOTO_MAX_BYTES = 262144;
// 【`image/*` と書かない】pitch-test の codeOf() が `/*` をブロックコメントの
// 始まりと読んで数百行を消す(罠の目録 9)。列挙で書けばその罠を踏まない。
export const PHOTO_ACCEPT = "image/png,image/jpeg,image/webp,image/heic,image/heif";

// 【決定5】拡大できる場所は2つだけ。
//   mypage     … マイページの自分のアイコン
//   personBack … 人物紹介シートの裏(プロフィール面)のアイコン
// 表(音のデータ面)の名前の行と、順位などの一覧の行は**行全体がその人を開く入口**なので
// ここに入れない。入れると行を押すたびに写真が開き、人を開けなくなる。
export const PHOTO_ZOOM_PLACES = ["mypage", "personBack"];

/**
 * 端末側の書き直しの手順を決める。**画像には触らない**(描くのは下の encodeSquarePhoto)。
 *
 * 返すもの:
 *   source … 元画像から切り出す正方形(中央)
 *   output … 書き出す大きさ・形式・品質
 *   reencode … **常に true**。元のバイト列を素通しする道を持たない。
 *              これが EXIF(向き・撮影位置)が残らないことの根拠である ──
 *              素通しが1つでもあると、その経路だけメタデータが付いてくる。
 */
export function planPhotoEncode({ width, height } = {}) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { error: "写真の大きさが読み取れません" };
  }
  const side = Math.min(w, h);
  return {
    source: { x: Math.floor((w - side) / 2), y: Math.floor((h - side) / 2), width: side, height: side },
    output: { width: PHOTO_EDGE_PX, height: PHOTO_EDGE_PX, type: PHOTO_MIME, quality: PHOTO_QUALITY },
    reencode: true,
    maxBytes: PHOTO_MAX_BYTES,
  };
}

// 既定の道具。**引数で差し替えられる形にしてある**ので、検査は本物の DOM なしで
// 「何を描いて何を書き出したか」を実際に走らせて確かめられる。
const domDeps = {
  loadImage: (file) => createImageBitmap(file),
  makeCanvas: (w, h) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  },
  toBlob: (canvas, type, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PHOTO_ENCODE_FAILED"))), type, quality);
  }),
};

/**
 * 選ばれた画像を、正方形 256px の WebP に書き直す。
 *
 * **元のファイルは1バイトも返らない。** 返るのは canvas から書き出した新しい Blob で、
 * EXIF はここで落ちる(canvas は画素しか持たない)。
 */
export async function encodeSquarePhoto(file, deps = domDeps) {
  // 【読めない形式はここで名前を付ける(中8)】createImageBitmap は復号できないと
  // DOMException を投げる。そのまま上へ流すと「通信の失敗」に見える。
  let img;
  try {
    img = await deps.loadImage(file);
  } catch (e) {
    throw new Error("PHOTO_UNREADABLE");
  }
  const plan = planPhotoEncode({ width: img.width, height: img.height });
  if (plan.error) throw new Error("PHOTO_UNREADABLE");
  const canvas = deps.makeCanvas(plan.output.width, plan.output.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PHOTO_ENCODE_FAILED");
  ctx.drawImage(
    img,
    plan.source.x, plan.source.y, plan.source.width, plan.source.height,
    0, 0, plan.output.width, plan.output.height,
  );
  if (typeof img.close === "function") img.close();
  const blob = await deps.toBlob(canvas, plan.output.type, plan.output.quality);
  if (!blob) throw new Error("PHOTO_ENCODE_FAILED");
  // 【上限は端末側でも見る】ここで止めれば、通らないと分かっている書き込みを投げない。
  // 本当の門は storage.rules(決定7)で、こちらはそれを先取りするだけ。
  if (blob.size > PHOTO_MAX_BYTES) throw new Error("PHOTO_TOO_LARGE");
  return blob;
}

const isUsablePhoto = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * 写真と絵柄の**どちらを描くか**を決める。Avatar() はこの答えだけを見る。
 *
 * 写真が在れば写真。無ければ絵柄 + 地の色。
 * 絵柄・色が壊れている(保存の古い形・未知の識別子)ときは既定へ落とす ──
 * 未定義の CSS 変数は transparent 扱いで**黙って消える**ので、色の無い丸が出る。
 */
export function avatarPaint({ photo, icon, color } = {}) {
  if (isUsablePhoto(photo)) return { kind: "photo", url: photo.trim() };
  // 【Number() を通さない】"3" のような文字列は buildProfileDoc もルールも弾く値で、
  // ここで整数に化かすと「保存できないはずの形が画面では動く」状態を作ってしまう。
  const ok = Number.isInteger(color) && color >= AVATAR_COLOR_MIN && color <= AVATAR_COLOR_MAX;
  return {
    kind: "icon",
    icon: AVATAR_ICONS.includes(icon) ? icon : AVATAR_ICONS[0],
    color: ok ? color : AVATAR_COLOR_MIN,
  };
}

/**
 * そのアイコンを押したときに**拡大表示を出すか**(決定5)。
 *
 * 規則は2つ。どちらか一方でも欠けたら出さない。
 *  ・描いているのが写真である ── 絵柄はベクターなので拡大に意味が無い
 *  ・場所が PHOTO_ZOOM_PLACES のどれかである ── 裏とマイページだけ
 */
export function photoZoomAvailable({ photo, icon, color, place } = {}) {
  if (avatarPaint({ photo, icon, color }).kind !== "photo") return false;
  return PHOTO_ZOOM_PLACES.includes(place);
}

/**
 * 失敗が「読み取れなかった」「判定で落ちた」「通信で落ちた」のどれかを決める
 * (決定3の文言の出し分け)。
 *
 * 読み取れなかった = その端末ではその形式を開けない(iOS の HEIC など)。
 *                    電波を変えても永久に直らないので、通信の文言を出してはいけない。
 * 判定で落ちた     = 同じ写真を出し直しても結果は変わらない。別の写真を選ぶしかない。
 * 通信で落ちた     = 電波の良いところでやり直せば通る。
 */
export function photoFailureKind(e) {
  const code = String(e?.code ?? "");
  const name = String(e?.name ?? "");
  const msg = String(e?.message ?? "");
  // 【2026-09-23 審査役の指摘(中8)】createImageBitmap は復号できないと
  // DOMException("The source image could not be decoded") を投げる。
  // これを通信の失敗として扱うと、「電波の良いところで」と案内したうえで
  // 何度やっても同じ所で止まる行き止まりになる。
  if (/PHOTO_UNREADABLE/.test(msg)) return "unreadable";
  if (name === "EncodingError" || name === "InvalidStateError") return "unreadable";
  if (/could not be decoded|decode|unsupported|corrupt/i.test(msg)) return "unreadable";
  if (code === "functions/failed-precondition" || code === "functions/invalid-argument") return "rejected";
  if (/photo-rejected|PHOTO_[A-Z_]+/.test(msg)) return "rejected";
  return "network";
}

/**
 * アイコンのシートを閉じたときに、**users へ何を書くか**を決める。
 *
 * 【2026-09-23 審査役の指摘(重2)で切り出した】以前は「絵柄か色が変わったか」だけを
 * 見て、書く中身は呼び出し側が組み立てていた。そのため
 *   ① 色を押す(下書きの写真が null になる) → ② 写真を選んで成功 → ③ 閉じる
 * の順で、① のぶんだけ「変わった」と判定され、**写真を消す書き込みが走った**。
 * 下書きに載っている写真ごと答えに含めれば、その取り違えが起こらない。
 *
 * @returns null なら書かない / 器を返したらそれをそのまま users へ渡す
 */
/**
 * 格子で絵柄か色を押したあとの下書き。**写真は必ず外れる**(決定4: 絵柄を選ぶこと＝写真をやめること)。
 *
 * 【便AJ 2026-09-24】もとは画面の中の1行だった。審査役の変異「絵柄を押しても下書きの写真を
 * 消さない」が生き残ったので、判断をここへ出して振る舞いで守る。写真が外れれば avatarPaint が
 * 絵柄を返し、背景色の行が戻る(決定2)。
 */
export function avatarDraftAfterPick(pick = {}) {
  return { icon: pick.icon ?? null, iconColor: pick.color ?? null, photo: null };
}

export function avatarWriteOnClose({ draft, saved } = {}) {
  const icon = draft?.icon ?? null;
  const iconColor = draft?.iconColor ?? null;
  const photo = isUsablePhoto(draft?.photo) ? draft.photo : null;
  // 下書きが組み上がっていない(開いていない)ときは書かない。
  if (icon === null || iconColor === null) return null;
  const savedIcon = saved?.icon ?? AVATAR_ICONS[0];
  const savedColor = saved?.iconColor ?? AVATAR_COLOR_MIN;
  const savedPhoto = isUsablePhoto(saved?.photo) ? saved.photo : null;
  if (icon === savedIcon && iconColor === savedColor && photo === savedPhoto) return null;
  return { icon, iconColor, photo };
}
