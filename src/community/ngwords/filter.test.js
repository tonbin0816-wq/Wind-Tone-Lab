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
  it("例外の*をヒットした語で展開して照合する(cath* + arse -> catharse を保護)", async () => {
    const en = (await import("./generated/en.json")).default;
    const arse = en.entries.find((e) => e.words.includes("arse"));
    expect(arse).toBeTruthy();
    expect(arse.exceptions).toContain("cath*");
    // 生JSONの例外の"*"は「ヒットした語が入る位置」を示すプレースホルダなので、
    // "*"を単純除去("cath")して部分一致させると"cath"を含むだけの無関係な語まで過剰保護してしまう。
    // ヒットした語("arse")で置換して完全形("catharse")に展開してから照合するのが正しい。
    expect(findNgWord("xxarsexx")).not.toBeNull(); // 保護なしのarseは弾かれる
    expect(findNgWord("catharse")).toBeNull(); // cath*をarseで展開した"catharse"による保護で通る
  });
  it("leet経由でヒットした場合も展開後の例外が効く(c4th4rse -> leet変換後にarseへヒットするがcath*展開で保護される)", async () => {
    const en = (await import("./generated/en.json")).default;
    const arse = en.entries.find((e) => e.words.includes("arse"));
    expect(arse).toBeTruthy();
    expect(arse.exceptions).toContain("cath*");
    // compact自体("c4th4rse")は"arse"を含まないが、leet変換後("catharse")は"arse"を含みヒットする。
    // 例外ガードがleet変換後の形を見ていないと、この場合だけ保護が効かず過剰ブロックになってしまう。
    expect(findNgWord("c4th4rse")).toBeNull();
  });
  it("ワイルドカード例外を実際に展開した完全形で保護する(debugger / coarse / hoarse)", async () => {
    const en = (await import("./generated/en.json")).default;
    const bugger = en.entries.find((e) => e.words.includes("bugger"));
    expect(bugger.exceptions).toContain("de*");
    const arse = en.entries.find((e) => e.words.includes("arse"));
    expect(arse.exceptions).toContain("co*");
    expect(arse.exceptions).toContain("ho*");

    expect(findNgWord("debugger")).toBeNull(); // de* + bugger = debugger
    expect(findNgWord("coarse")).toBeNull(); // co* + arse = coarse
    expect(findNgWord("hoarse")).toBeNull(); // ho* + arse = hoarse
  });
  it("例外の断片だけでは保護されず、展開形を含まない場合はNG判定される(過剰保護の防止)", () => {
    // "coolarse"は例外の断片"co"を含むが、展開形"coarse"はcompactにもleetCompactにも含まれない。
    // fix round 1時点の実装(*を単純除去して"co"で部分一致)ではこれが誤って保護されてしまっていた。
    expect(findNgWord("coolarse")).not.toBeNull();
  });
});
