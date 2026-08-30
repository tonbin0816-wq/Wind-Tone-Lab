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
  searchLigatures,
  isValidLigature,
  LIGATURE_CATALOG,
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

describe("searchLigatures", () => {
  it("ラテン文字のブランド名で引ける", () => {
    expect(searchLigatures("rovner").length).toBeGreaterThan(0);
    expect(searchLigatures("rovner").every((h) => h.brand === "Rovner")).toBe(true);
  });
  it("モデル名でも引ける", () => {
    expect(searchLigatures("HEXA").some((h) => h.brand === "Silverstein")).toBe(true);
    expect(searchLigatures("Optimum").some((h) => h.brand === "Vandoren")).toBe(true);
  });
  it("空クエリは0件(楽器・マウスピースと同じ挙動)", () => {
    expect(searchLigatures("")).toHaveLength(0);
    expect(searchLigatures("   ")).toHaveLength(0);
  });
  it("カタログに無い語は0件", () => {
    expect(searchLigatures("ズィルジャン")).toHaveLength(0);
  });

  // カタカナ別名。フォームの案内どおりに日本語で打った人が0件になると、
  // 実在のリガチャーを持っている人まで「その他」へ流れてデータが失われる。
  it("カタカナのブランド名で引ける", () => {
    expect(searchLigatures("ロブナー").some((h) => h.brand === "Rovner")).toBe(true);
    expect(searchLigatures("シルバースタイン").some((h) => h.brand === "Silverstein")).toBe(true);
    expect(searchLigatures("イシモリ").some((h) => h.brand === "Ishimori")).toBe(true);
    expect(searchLigatures("石森").some((h) => h.brand === "Ishimori")).toBe(true);
  });
  it("半角カナでも引ける(NFKC が全角カナに畳む)", () => {
    expect(searchLigatures("ﾛﾌﾞﾅｰ").some((h) => h.brand === "Rovner")).toBe(true);
  });
  it("アクセント記号を打てなくても引ける(ç / ú のブランド)", () => {
    // NFKC は ç → c、ú → u に畳まない。別名でアクセント無しの綴りを持たせてある。
    expect(searchLigatures("francois").some((h) => h.brand === "François Louis")).toBe(true);
    expect(searchLigatures("bambu").some((h) => h.brand === "Bambú")).toBe(true);
  });

  // Selmer / Yamaha は愛称モデル名を持たず、部品番号か管別の一般名しかない。
  // 日本語の補足を括弧で付けてあるので、日本語の語で当たること自体が要件。
  it("Selmer / Yamaha のリガチャーが日本語の語で当たる", () => {
    expect(searchLigatures("標準リガチャー").some((h) => h.brand === "Selmer")).toBe(true);
    expect(searchLigatures("標準リガチャー").some((h) => h.brand === "Yamaha")).toBe(true);
    expect(searchLigatures("メタルマウスピース用").some((h) => h.brand === "Selmer")).toBe(true);
    // 管で探す人が多いので「アルト用」でも当たること
    expect(searchLigatures("アルト用").some((h) => h.brand === "Yamaha")).toBe(true);
  });
  it("Yamaha の部品番号でも当たる", () => {
    expect(searchLigatures("YAC-1607").some((h) => h.brand === "Yamaha")).toBe(true);
  });
});

describe("isValidLigature", () => {
  it("カタログに実在する組だけ valid", () => {
    expect(isValidLigature("Rovner", "Dark")).toBe(true);
    expect(isValidLigature("Silverstein", "CRYO4")).toBe(true);
    expect(isValidLigature("Rovner", "存在しないモデル")).toBe(false);
    // ブランドは実在するが、そのブランドのモデルではない組
    expect(isValidLigature("Rovner", "CRYO4")).toBe(false);
    // カタログに無いブランド
    expect(isValidLigature("Zildjian", "Dark")).toBe(false);
  });
  it("未選択(null/null)は「その他」とは別の正当な状態として通す", () => {
    expect(isValidLigature(null, null)).toBe(true);
  });
  it("「その他」はモデル無しのときだけ通す", () => {
    expect(isValidLigature(OTHER_BRAND, null)).toBe(true);
    expect(isValidLigature(OTHER_BRAND, "何か")).toBe(false);
  });
  it("ブランドだけ null でモデルがある形は通さない", () => {
    expect(isValidLigature(null, "Dark")).toBe(false);
  });
});

describe("LIGATURE_CATALOG の中身", () => {
  it("初版の収録量を満たす(20ブランド以上・60モデル以上)", () => {
    const brands = Object.keys(LIGATURE_CATALOG);
    const modelCount = Object.values(LIGATURE_CATALOG).reduce((n, b) => n + b.models.length, 0);
    expect(brands.length).toBeGreaterThanOrEqual(20);
    expect(modelCount).toBeGreaterThanOrEqual(60);
  });
  it("どのブランドも models を持ち、空でない", () => {
    const broken = Object.entries(LIGATURE_CATALOG)
      .filter(([, b]) => !Array.isArray(b?.models) || b.models.length === 0)
      .map(([name]) => name);
    expect(broken).toEqual([]);
  });
  it("同じブランド内にモデル名の重複が無い", () => {
    const dup = Object.entries(LIGATURE_CATALOG)
      .filter(([, b]) => new Set(b.models).size !== b.models.length)
      .map(([name]) => name);
    expect(dup).toEqual([]);
  });
  it("調査レポートで△(未裏取り)だったモデルを収録していない", () => {
    // レポート §2 の△は Rovner "Legacy" と Harrison のサイズ記号 A1/S1/T/TD/TO の2件のみ。
    expect(LIGATURE_CATALOG.Rovner.models).not.toContain("Legacy");
    // サイズ記号はそもそもモデル名に畳み込まない方針
    expect(LIGATURE_CATALOG.Harrison.models.some((m) => /A1|S1|TD|TO/.test(m))).toBe(false);
    // ALTA は Silverstein の合成リードでリガチャーではない(レポート §1.5 の注)
    expect(LIGATURE_CATALOG.Silverstein.models).not.toContain("ALTA");
  });
  it("別名の付いていないブランドが残っていない", () => {
    const missing = Object.keys(LIGATURE_CATALOG).filter((b) => !(BRAND_ALIASES[b]?.length > 0));
    expect(missing).toEqual([]);
  });
});
