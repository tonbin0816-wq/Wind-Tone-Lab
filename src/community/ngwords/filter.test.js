import { describe, it, expect } from "vitest";
import { findNgWord } from "./filter.js";

describe("findNgWord", () => {
  it("普通のニックネームは通す", () => {
    expect(findNgWord("さっくす太郎")).toBeNull();
    expect(findNgWord("AltoLove442")).toBeNull();
  });
  it("英語の不適切語を部分一致で弾く", () => {
    expect(findNgWord("xxfuckxx")).not.toBeNull();
  });
  it("区切りで偽装しても弾く", () => {
    expect(findNgWord("f-u-c-k")).not.toBeNull();
  });
  it("leet(数字置換)で偽装しても弾く(bitch -> b17ch)", async () => {
    const en = (await import("./generated/en.json")).default;
    const entry = en.entries.find((e) => e.words.includes("bitch"));
    expect(entry).toBeTruthy();
    expect(entry.exceptions).toHaveLength(0);
    // b->8ではなくb17ch(1->i, 7->t)で実語"bitch"を表現する
    expect(findNgWord("b17ch")).toBe("bitch");
  });
  it("日本語の不適切語を弾く(リスト先頭の実語で確認)", async () => {
    const ja = (await import("./generated/ja.json")).default;
    expect(findNgWord(`前後${ja.words[0]}前後`)).toBe(ja.words[0]);
  });
  it("例外リスト(Scunthorpe対策)を尊重する", async () => {
    const en = (await import("./generated/en.json")).default;
    const withEx = en.entries.find((e) => e.exceptions.length > 0);
    if (withEx) expect(findNgWord(withEx.exceptions[0])).toBeNull();
  });
  it("例外の*を除去して照合する(cath* -> arse を保護)", async () => {
    const en = (await import("./generated/en.json")).default;
    const arse = en.entries.find((e) => e.words.includes("arse"));
    expect(arse).toBeTruthy();
    expect(arse.exceptions).toContain("cath*");
    // 生JSONの例外は"cath*"のようにワイルドカードを含むため、
    // *を除去せず照合すると絶対にヒットしない(ニックネームに"*"は現れない)。
    // *を除去して"cath"として照合することで初めてarseが保護される。
    expect(findNgWord("xxarsexx")).not.toBeNull(); // 保護なしのarseは弾かれる
    expect(findNgWord("catharse")).toBeNull(); // cath*由来の保護で通る
  });
});
