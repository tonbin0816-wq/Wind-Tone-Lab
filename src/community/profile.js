import { findNgWord } from "./ngwords/filter.js";
import { isValidInstrument, isValidMouthpiece, isValidLigature } from "./catalog/gear.js";

// spec §4.1 の選択肢。文言を変えるときは設計書も直すこと。
//
// 【firestore.rules に同じ列挙の写しがある】計画1に Cloud Functions は無いので、
// サーバ側でこれを検査できる場所はセキュリティルールしかない。ルール側が「文字列」までしか
// 見ないと、生SDKを叩く相手が position などに自由文を入れられてしまい、
// 設計書 §8.1 の「通報の対象はニックネームだけ」が崩れる。
// **ここを足し引きしたら firestore.rules の該当行も必ず直すこと**(逆も同じ)。
// 食い違いは profile.test.js の「Firestore ルールの列挙と一致する」が検出する。
export const SAX_TYPES = ["soprano", "alto", "tenor", "baritone"];
export const POSITIONS = ["学生", "学生（音大）", "社会人", "講師・プロ", "独学"];
export const GENRES = ["クラシック", "ジャズ", "ポップス", "その他"];
export const ENSEMBLES = ["ソロ", "アンサンブル", "ビッグバンド", "吹奏楽", "オーケストラ"];
export const PLACES = ["自宅", "学校の音楽室", "個人練習室", "スタジオ", "カラオケ", "屋外"];

export function startYearOptions(now = new Date()) {
  const y = now.getFullYear();
  const out = [];
  for (let i = y; i >= y - 80; i--) out.push(i);
  return out;
}

// ニックネームは既定で公開されるため、表示偽装に使える不可視・双方向制御文字を明示的に拒否する。
// \p{Cf}(書式文字カテゴリ)を一括拒否すると絵文字が壊れる(ZWJ=U+200D は絵文字合成に必須、
// 異体字セレクタ=U+FE0E/U+FE0F は絵文字の表示形指定に必須)ため、それらは拒否リストから除外している。
// 拒否対象:
//   - \p{Cc}: C0/C1 制御文字全般(従来の \r\n\t を含む)
//   - U+200B (ゼロ幅スペース), U+200C (ゼロ幅非接合子)
//   - U+200E, U+200F (左横書き/右横書きマーク)
//   - U+202A-U+202E (双方向埋め込み・上書き。U+202E は表示順反転による偽装に使われる)
//   - U+2066-U+2069 (双方向分離)
//   - U+FEFF (ゼロ幅ノーブレークスペース / BOM)
const FORBIDDEN_CHARS = /\p{Cc}|[\u200B\u200C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;

export function validateNickname(raw) {
  const value = String(raw ?? "").trim();
  if (value.length === 0) return { error: "ニックネームを入力してください" };
  if ([...value].length > 20) return { error: "ニックネームは20文字までです" };
  if (FORBIDDEN_CHARS.test(value)) return { error: "使えない文字が含まれています" };
  const ng = findNgWord(value);
  if (ng) return { error: "このニックネームは使用できません" };
  return { value };
}

export function detectDeviceClass(ua = (typeof navigator !== "undefined" ? navigator.userAgent : "")) {
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "pc";
}

const pickAllowed = (arr, allowed) => (Array.isArray(arr) ? arr.filter((v) => allowed.includes(v)) : []);

export function buildProfileDoc(input, now = new Date()) {
  const nick = validateNickname(input.nickname);
  if (nick.error) return { error: nick.error };
  if (!SAX_TYPES.includes(input.saxType)) return { error: "楽器種別を選んでください" };
  if (!POSITIONS.includes(input.position)) return { error: "属性を選んでください" };
  const year = Number(input.startYear);
  if (!Number.isInteger(year) || year < now.getFullYear() - 80 || year > now.getFullYear()) {
    return { error: "演奏開始年が正しくありません" };
  }
  if (input.ageConfirmed !== true) return { error: "13歳以上であることの確認が必要です" };
  const g = input.gear ?? {};
  // 【未選択を「その他」に寄せない】機材欄を飛ばした人(null)と、「カタログに無い(その他)」を
  // 自分で選んだ人(OTHER_BRAND)は別の情報である。ここで ?? OTHER_BRAND に潰すと、
  // 計画4の機材シェア円グラフから見て両者が区別できなくなり、しかも書き込み済みの
  // ドキュメントからは後で復元できない(欠測が「その他」の票として数えられてしまう)。
  // undefined は null に正規化するだけにとどめる。妥当性は gear.js が判定する。
  const instBrand = g.instrumentBrand ?? null;
  const instModel = g.instrumentModel ?? null;
  const mpBrand = g.mpBrand ?? null;
  const mpModel = g.mpModel ?? null;
  const ligBrand = g.ligBrand ?? null;
  const ligModel = g.ligModel ?? null;
  if (!isValidInstrument(instBrand, instModel, input.saxType)) return { error: "楽器がカタログにありません" };
  if (!isValidMouthpiece(mpBrand, mpModel)) return { error: "マウスピースがカタログにありません" };
  if (!isValidLigature(ligBrand, ligModel)) return { error: "リガチャーがカタログにありません" };
  return {
    doc: {
      nickname: nick.value,
      saxType: input.saxType,
      position: input.position,
      startYear: year,
      genres: pickAllowed(input.genres, GENRES),
      ensembles: pickAllowed(input.ensembles, ENSEMBLES),
      places: pickAllowed(input.places, PLACES),
      gear: { instrumentBrand: instBrand, instrumentModel: instModel, mpBrand, mpModel, ligBrand, ligModel },
      deviceClass: detectDeviceClass(),
      isPublic: input.isPublic !== false, // 既定は公開(spec 決定事項)
      ageConfirmed: true,
      updatedAt: now.toISOString(),
    },
  };
}
