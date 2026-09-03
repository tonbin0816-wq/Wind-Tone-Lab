import { describe, it, expect } from "vitest";
import { normalizeForFilter, compactForFilter, leetForFilter } from "./normalize.js";

describe("normalizeForFilter", () => {
  it("全角英数を半角小文字にする", () => {
    expect(normalizeForFilter("ＡＢＣ１２３")).toBe("abc123");
  });
  it("カタカナをひらがなにする", () => {
    expect(normalizeForFilter("サックス")).toBe("さつくす".replace("つ", "っ")); // "さっくす"
  });
  it("nullや数値でも落ちない", () => {
    expect(normalizeForFilter(null)).toBe("");
    expect(normalizeForFilter(123)).toBe("123");
  });
});

describe("compactForFilter", () => {
  it("区切り文字を除去して連結語を照合可能にする", () => {
    expect(compactForFilter("s.e-x")).toBe("sex");
    expect(compactForFilter("ば か")).toBe("ばか");
  });
});

describe("leetForFilter", () => {
  it("leet表記を戻す(照合用)", () => {
    expect(leetForFilter("s3x")).toBe("sex");
    expect(leetForFilter("@ss")).toBe("ass");
  });
  it("照合用コピー専用であることを確認", () => {
    expect(leetForFilter("abc123")).toBe("abci2e");
  });
});
