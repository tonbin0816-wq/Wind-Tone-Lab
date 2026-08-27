import { describe, it, expect } from "vitest";
import { findNgWord } from "./filter.js";

// ------------------------------------------------------------------
// 受け入れ基準(最終レビューで確定した表)。
// 上流リストは語境界照合を前提に作られているため、全語を部分一致させると
// bass / Classic / Passion のような普通のニックネームが弾かれてしまう。
// filter.js は severity で照合の強さを2段階に分けてこれを解いている。
// この2つの配列が、その解が守るべき境界そのものである。
// ------------------------------------------------------------------
const MUST_ACCEPT = [
  // en severity 1 の "ass" が内部に出る一般語
  "bass", "brass", "Bassoon", "Classic", "classical", "Passion", "Grass",
  // ja の除外語 "SM" が内部に出る一般語
  "Smile", "smile442", "jasmine", "Sax_Smith",
  // ja の除外語 "イク" / "カス"(compact でひらがなに統一される)が内部に出る名前
  "いくみ", "カスミ", "かすみ", "ゆういく", "たいくつ",
  // 素の日本語・英語のニックネーム
  "さっくす太郎", "AltoLove442",
  // 上流 exceptions のワイルドカード展開で守られる語(過去ラウンドの回帰防止)
  "coarse", "hoarse", "debugger", "c4th4rse",
];

const MUST_REJECT = [
  "fuck", // 素の強い語
  "xxfuckxx", // 語の内部への埋め込み
  "f-u-c-k", // 区切りによる偽装
  "b17ch", // leet による偽装
  "coolarse", // 例外の断片("co")だけでは守られない
  "前後ちんこ前後", // ja の実語を前後で挟んだもの
];

describe("findNgWord 受け入れ基準", () => {
  it.each(MUST_ACCEPT)("%s は通す", (nickname) => {
    expect(findNgWord(nickname)).toBeNull();
  });
  it.each(MUST_REJECT)("%s は弾く", (nickname) => {
    expect(findNgWord(nickname)).not.toBeNull();
  });
});

describe("severity による照合の強さの切り替え", () => {
  it("severity 1 の語は語境界でしか当たらない(ass)", async () => {
    const en = (await import("./generated/en.json")).default;
    const ass = en.entries.find((e) => e.words.includes("ass"));
    expect(ass).toBeTruthy();
    expect(ass.severity).toBe(1);
    // 上流は境界照合前提なので exceptions が空。だからこそ部分一致してはいけない。
    expect(ass.exceptions).toHaveLength(0);
    expect(findNgWord("bass")).toBeNull(); // 語の内部 → 通す
    expect(findNgWord("ass")).toBe("ass"); // 単独 → 弾く
    expect(findNgWord("sax ass")).toBe("ass"); // 空白の後 → 境界なので弾く
    expect(findNgWord("sax_ass")).toBe("ass"); // アンダースコアも境界
  });
  it("severity 2 以上の語は部分一致で当たる(arse)", async () => {
    const en = (await import("./generated/en.json")).default;
    const arse = en.entries.find((e) => e.words.includes("arse"));
    expect(arse.severity).toBeGreaterThanOrEqual(2);
    expect(findNgWord("coolarse")).toBe("arse"); // 語の内部でも弾く
  });
  it("生成側が severity を落としていない", async () => {
    const en = (await import("./generated/en.json")).default;
    expect(en.entries.every((e) => Number.isInteger(e.severity))).toBe(true);
  });
  it("生成側が誤爆源の短い ja 項目を除外している", async () => {
    const ja = (await import("./generated/ja.json")).default;
    for (const w of ["SM", "3P", "NTR", "SOD", "イク", "カス"]) {
      expect(ja.words).not.toContain(w);
    }
  });
});

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
