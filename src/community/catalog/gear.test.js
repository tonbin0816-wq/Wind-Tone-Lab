import { describe, it, expect } from "vitest";
import {
  searchInstrumentModels,
  searchMouthpieces,
  isValidInstrument,
  isValidMouthpiece,
  OTHER_BRAND,
  BRAND_ALIASES,
  INSTRUMENT_CATALOG,
  MOUTHPIECE_CATALOG,
} from "./gear.js";

describe("searchInstrumentModels", () => {
  it("部分一致・大文字小文字無視で引ける", () => {
    const hits = searchInstrumentModels("yas-8", "alto");
    expect(hits.some((h) => h.brand === "YAMAHA" && h.model === "YAS-875EX")).toBe(true);
  });
  it("楽器種別で絞られる", () => {
    expect(searchInstrumentModels("YTS", "alto")).toHaveLength(0);
  });
  it("全角入力でも引ける", () => {
    expect(searchInstrumentModels("ｙａｓ６２", "alto").length).toBeGreaterThan(0);
  });
});

describe("searchMouthpieces", () => {
  it("ブランド名でもモデル名でも引ける", () => {
    expect(searchMouthpieces("meyer").length).toBeGreaterThan(0);
    expect(searchMouthpieces("S90").some((h) => h.brand === "Selmer")).toBe(true);
  });
});

describe("カタカナ別名での検索", () => {
  // フォームのプレースホルダが「例: YAS-62 / ヤマハ」「例: S80 C* / メイヤー」と
  // カタカナを例示している。別名が無いと案内どおりに打った人が0件になり、
  // 「カタログに無い(その他)」へ流れて実在の機材データが失われる。
  it("本体をカタカナのブランド名で引ける", () => {
    expect(searchInstrumentModels("ヤマハ", "alto").some((h) => h.brand === "YAMAHA")).toBe(true);
    expect(searchInstrumentModels("セルマー", "alto").some((h) => h.brand === "Selmer Paris")).toBe(true);
    expect(searchInstrumentModels("ヤナギサワ", "alto").some((h) => h.brand === "Yanagisawa")).toBe(true);
    expect(searchInstrumentModels("柳沢", "alto").some((h) => h.brand === "Yanagisawa")).toBe(true);
  });
  it("マウスピースをカタカナのブランド名で引ける", () => {
    expect(searchMouthpieces("メイヤー").some((h) => h.brand === "Meyer")).toBe(true);
    expect(searchMouthpieces("セルマー").some((h) => h.brand === "Selmer")).toBe(true);
    expect(searchMouthpieces("バンドーレン").some((h) => h.brand === "Vandoren")).toBe(true);
    expect(searchMouthpieces("オットーリンク").some((h) => h.brand === "Otto Link")).toBe(true);
  });
  it("半角カナでも引ける(NFKC が全角カナに畳む)", () => {
    expect(searchInstrumentModels("ﾔﾏﾊ", "alto").some((h) => h.brand === "YAMAHA")).toBe(true);
    expect(searchMouthpieces("ﾒｲﾔｰ").some((h) => h.brand === "Meyer")).toBe(true);
    // 半角の濁点も合成される("ﾊﾞﾝﾄﾞｰﾚﾝ" -> "バンドーレン")
    expect(searchMouthpieces("ﾊﾞﾝﾄﾞｰﾚﾝ").some((h) => h.brand === "Vandoren")).toBe(true);
  });
  it("別名の付いていないブランドが残っていない", () => {
    const brands = [...Object.keys(INSTRUMENT_CATALOG), ...Object.keys(MOUTHPIECE_CATALOG)];
    const missing = brands.filter((b) => !(BRAND_ALIASES[b]?.length > 0));
    expect(missing).toEqual([]);
  });
});

describe("validation", () => {
  it("カタログに実在する組だけ valid", () => {
    expect(isValidInstrument("YAMAHA", "YAS-62", "alto")).toBe(true);
    expect(isValidInstrument("YAMAHA", "存在しない", "alto")).toBe(false);
    expect(isValidInstrument(OTHER_BRAND, null, "alto")).toBe(true);
    expect(isValidInstrument(OTHER_BRAND, "自由入力", "alto")).toBe(false);
    expect(isValidMouthpiece("Meyer", "6M")).toBe(true);
  });
  it("未選択(null/null)は「その他」とは別の正当な状態として通す", () => {
    expect(isValidInstrument(null, null, "alto")).toBe(true);
    expect(isValidMouthpiece(null, null)).toBe(true);
  });
  it("ブランドだけ null でモデルがある形は通さない", () => {
    expect(isValidInstrument(null, "YAS-62", "alto")).toBe(false);
    expect(isValidMouthpiece(null, "6M")).toBe(false);
  });
});
