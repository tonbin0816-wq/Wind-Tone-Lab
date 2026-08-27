import { findNgWord } from "./ngwords/filter.js";
import { isValidInstrument, isValidMouthpiece, OTHER_BRAND } from "./catalog/gear.js";

// spec §4.1 の選択肢。文言を変えるときは設計書も直すこと
export const SAX_TYPES = ["soprano", "alto", "tenor", "baritone"];
export const POSITIONS = ["中学吹奏楽部", "高校吹奏楽部", "大学吹奏楽・サークル", "音大生", "社会人", "講師・プロ", "独学"];
export const GENRES = ["クラシック", "ジャズ", "ポップス", "その他"];
export const ENSEMBLES = ["ソロ", "アンサンブル", "ビッグバンド", "吹奏楽", "オーケストラ"];
export const PLACES = ["自宅", "学校の音楽室", "個人練習室", "スタジオ", "カラオケ", "屋外"];

export function startYearOptions(now = new Date()) {
  const y = now.getFullYear();
  const out = [];
  for (let i = y; i >= y - 80; i--) out.push(i);
  return out;
}

export function validateNickname(raw) {
  const value = String(raw ?? "").trim();
  if (value.length === 0) return { error: "ニックネームを入力してください" };
  if ([...value].length > 20) return { error: "ニックネームは20文字までです" };
  if (/[\r\n\t]/.test(value)) return { error: "使えない文字が含まれています" };
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
  if (!POSITIONS.includes(input.position)) return { error: "立場を選んでください" };
  const year = Number(input.startYear);
  if (!Number.isInteger(year) || year < now.getFullYear() - 80 || year > now.getFullYear()) {
    return { error: "演奏開始年が正しくありません" };
  }
  if (input.ageConfirmed !== true) return { error: "13歳以上であることの確認が必要です" };
  const g = input.gear ?? {};
  const instBrand = g.instrumentBrand ?? OTHER_BRAND;
  const instModel = g.instrumentModel ?? null;
  const mpBrand = g.mpBrand ?? OTHER_BRAND;
  const mpModel = g.mpModel ?? null;
  if (!isValidInstrument(instBrand, instModel, input.saxType)) return { error: "楽器がカタログにありません" };
  if (!isValidMouthpiece(mpBrand, mpModel)) return { error: "マウスピースがカタログにありません" };
  return {
    doc: {
      nickname: nick.value,
      saxType: input.saxType,
      position: input.position,
      startYear: year,
      genres: pickAllowed(input.genres, GENRES),
      ensembles: pickAllowed(input.ensembles, ENSEMBLES),
      places: pickAllowed(input.places, PLACES),
      gear: { instrumentBrand: instBrand, instrumentModel: instModel, mpBrand, mpModel },
      deviceClass: detectDeviceClass(),
      isPublic: input.isPublic !== false, // 既定は公開(spec 決定事項)
      ageConfirmed: true,
      updatedAt: now.toISOString(),
    },
  };
}
