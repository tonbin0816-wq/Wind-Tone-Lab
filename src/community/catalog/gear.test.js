import { describe, it, expect } from "vitest";
import { searchInstrumentModels, searchMouthpieces, isValidInstrument, isValidMouthpiece, OTHER_BRAND } from "./gear.js";

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

describe("validation", () => {
  it("カタログに実在する組だけ valid", () => {
    expect(isValidInstrument("YAMAHA", "YAS-62", "alto")).toBe(true);
    expect(isValidInstrument("YAMAHA", "存在しない", "alto")).toBe(false);
    expect(isValidInstrument(OTHER_BRAND, null, "alto")).toBe(true);
    expect(isValidInstrument(OTHER_BRAND, "自由入力", "alto")).toBe(false);
    expect(isValidMouthpiece("Meyer", "6M")).toBe(true);
  });
});
