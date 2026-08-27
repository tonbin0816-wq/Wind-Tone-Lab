import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  validateNickname,
  buildProfileDoc,
  detectDeviceClass,
  POSITIONS,
  SAX_TYPES,
  GENRES,
  ENSEMBLES,
  PLACES,
} from "./profile.js";
import { OTHER_BRAND } from "./catalog/gear.js";

const base = {
  nickname: "さっくす太郎",
  saxType: "alto",
  position: "社会人",
  startYear: 2015,
  genres: ["クラシック"],
  ensembles: ["吹奏楽"],
  places: ["自宅"],
  ageConfirmed: true,
  isPublic: true,
  gear: { instrumentBrand: "YAMAHA", instrumentModel: "YAS-62", mpBrand: "Selmer", mpModel: "S80 C*" },
};

describe("validateNickname", () => {
  it("前後の空白を落として受理する", () => {
    expect(validateNickname("  太郎 ")).toEqual({ value: "太郎" });
  });
  it("空・21文字以上・改行・NGワードを弾く", () => {
    expect(validateNickname("")).toHaveProperty("error");
    expect(validateNickname("あ".repeat(21))).toHaveProperty("error");
    expect(validateNickname("a\nb")).toHaveProperty("error");
    expect(validateNickname("xxfuckxx")).toHaveProperty("error");
  });
  it("表示偽装に使える不可視・双方向制御文字を弾く", () => {
    expect(validateNickname("\u202E太郎")).toHaveProperty("error"); // 右横書き上書き(表示順反転)
    expect(validateNickname("太\u200B郎")).toHaveProperty("error"); // ゼロ幅スペース
  });
  it("ZWJ を使った絵文字ニックネームは受理する", () => {
    // 👨‍👩‍👧 = U+1F468 U+200D U+1F469 U+200D U+1F467 (家族の絵文字、ZWJ結合列)
    const nick = "太郎👨‍👩‍👧";
    expect(validateNickname(nick)).toEqual({ value: nick });
  });
  it("20コードポイントちょうどは受理する(サロゲートペア境界)", () => {
    const nick = "あ".repeat(19) + "😀"; // 19 + 1(絵文字はサロゲートペアだが1コードポイント) = 20
    expect([...nick].length).toBe(20);
    expect(validateNickname(nick)).toEqual({ value: nick });
  });
});

describe("buildProfileDoc", () => {
  it("正しい入力からドキュメントを作る", () => {
    const r = buildProfileDoc(base, new Date("2026-08-27"));
    expect(r.doc.nickname).toBe("さっくす太郎");
    expect(r.doc.startYear).toBe(2015);
    expect(r.doc.deviceClass).toMatch(/ios|android|pc/);
  });
  it("選択肢に無い値・未来の開始年・年齢未確認を弾く", () => {
    expect(buildProfileDoc({ ...base, position: "宇宙人" })).toHaveProperty("error");
    expect(buildProfileDoc({ ...base, startYear: 2199 })).toHaveProperty("error");
    expect(buildProfileDoc({ ...base, ageConfirmed: false })).toHaveProperty("error");
    expect(buildProfileDoc({ ...base, gear: { ...base.gear, instrumentModel: "でたらめ" } })).toHaveProperty("error");
  });
  it("startYear が非整数だと弾く", () => {
    expect(buildProfileDoc({ ...base, startYear: 2015.5 })).toHaveProperty("error");
    expect(buildProfileDoc({ ...base, startYear: "abc" })).toHaveProperty("error");
  });
  it("複数選択は許可リスト外を黙って除外する", () => {
    const r = buildProfileDoc({ ...base, genres: ["クラシック", "演歌"] });
    expect(r.doc.genres).toEqual(["クラシック"]);
  });
  it("doc のキー集合が Firestore ルール(Task 7)と一致する12キーに固定される", () => {
    const r = buildProfileDoc(base, new Date("2026-08-27"));
    expect(Object.keys(r.doc).sort()).toEqual(
      [
        "ageConfirmed",
        "deviceClass",
        "ensembles",
        "gear",
        "genres",
        "isPublic",
        "nickname",
        "places",
        "position",
        "saxType",
        "startYear",
        "updatedAt",
      ].sort()
    );
  });
  it("入力に余計なキーを混ぜても doc に漏れない", () => {
    const r = buildProfileDoc(
      { ...base, evilKey: "x", gear: { ...base.gear, evilKey: "x" } },
      new Date("2026-08-27")
    );
    expect(r.doc).not.toHaveProperty("evilKey");
    expect(r.doc.gear).not.toHaveProperty("evilKey");
  });
  // 【未選択と「その他」を潰さない】計画4の機材シェア円グラフはこの欄をそのまま読む。
  // 一度 null を "その他" に寄せて書き込むと、書き込んだ後からは区別を復元できない。
  it("機材を選ばなかった場合は null のまま保存される(その他に寄せない)", () => {
    const r = buildProfileDoc(
      { ...base, gear: { instrumentBrand: null, instrumentModel: null, mpBrand: null, mpModel: null } },
      new Date("2026-08-27")
    );
    expect(r.error).toBeUndefined();
    expect(r.doc.gear).toEqual({ instrumentBrand: null, instrumentModel: null, mpBrand: null, mpModel: null });
  });
  it("gear キーごと省略しても null で保存される", () => {
    const { gear, ...rest } = base;
    const r = buildProfileDoc(rest, new Date("2026-08-27"));
    expect(r.error).toBeUndefined();
    expect(r.doc.gear).toEqual({ instrumentBrand: null, instrumentModel: null, mpBrand: null, mpModel: null });
  });
  it("明示的に「その他」を選んだ場合は文字列で保存される", () => {
    const r = buildProfileDoc(
      { ...base, gear: { instrumentBrand: OTHER_BRAND, instrumentModel: null, mpBrand: OTHER_BRAND, mpModel: null } },
      new Date("2026-08-27")
    );
    expect(r.error).toBeUndefined();
    expect(r.doc.gear).toEqual({ instrumentBrand: OTHER_BRAND, instrumentModel: null, mpBrand: OTHER_BRAND, mpModel: null });
  });
  it("未選択と「その他」は保存後のドキュメント上で区別できる", () => {
    const unselected = buildProfileDoc(
      { ...base, gear: { instrumentBrand: null, instrumentModel: null, mpBrand: null, mpModel: null } },
      new Date("2026-08-27")
    ).doc;
    const other = buildProfileDoc(
      { ...base, gear: { instrumentBrand: OTHER_BRAND, instrumentModel: null, mpBrand: OTHER_BRAND, mpModel: null } },
      new Date("2026-08-27")
    ).doc;
    expect(unselected.gear.instrumentBrand).toBeNull();
    expect(other.gear.instrumentBrand).toBe(OTHER_BRAND);
    expect(unselected.gear).not.toEqual(other.gear);
  });
  it("ブランドだけ null でモデルを渡す不整合は弾く", () => {
    expect(
      buildProfileDoc({ ...base, gear: { ...base.gear, instrumentBrand: null } })
    ).toHaveProperty("error");
  });

  it("isPublic を省略すると既定で true になる", () => {
    const { isPublic, ...rest } = base;
    const r = buildProfileDoc(rest, new Date("2026-08-27"));
    expect(r.doc.isPublic).toBe(true);
  });
  it("isPublic: false を渡すと false になる", () => {
    const r = buildProfileDoc({ ...base, isPublic: false }, new Date("2026-08-27"));
    expect(r.doc.isPublic).toBe(false);
  });
});

// 計画1に Cloud Functions は無く、サーバ側の検査は firestore.rules しかない。
// ルール側は同じ列挙を手で書き写して持っているので、片方だけ直されると
// 「アプリでは選べるのに保存できない」または「ルールが自由文を通す」のどちらかが起きる。
// 写しである以上、食い違いをテストで検出できる状態にしておく。
describe("firestore.rules との同期", () => {
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  const asRulesList = (arr) => "[" + arr.map((s) => `'${s}'`).join(",") + "]";

  it("position の列挙がルールと一致する", () => {
    expect(rules).toContain(`request.resource.data.position in ${asRulesList(POSITIONS)}`);
  });
  it("genres / ensembles / places の列挙がルールと一致する", () => {
    expect(rules).toContain(`request.resource.data.genres.hasOnly(${asRulesList(GENRES)})`);
    expect(rules).toContain(`request.resource.data.ensembles.hasOnly(${asRulesList(ENSEMBLES)})`);
    expect(rules).toContain(`request.resource.data.places.hasOnly(${asRulesList(PLACES)})`);
  });
  it("saxType の列挙がルールと一致する", () => {
    expect(rules).toContain(`request.resource.data.saxType in ${asRulesList(SAX_TYPES)}`);
  });
  it("gear の4つの値すべてに string-or-null の型検査がある", () => {
    for (const key of ["instrumentBrand", "instrumentModel", "mpBrand", "mpModel"]) {
      expect(rules).toContain(`request.resource.data.gear.${key} == null`);
      expect(rules).toContain(`request.resource.data.gear.${key} is string`);
      expect(rules).toContain(`request.resource.data.gear.${key}.size() <= 60`);
    }
  });
  it("互いを指す注意書きが両側にある", () => {
    expect(rules).toContain("src/community/profile.js");
    const profileSrc = readFileSync(new URL("./profile.js", import.meta.url), "utf8");
    expect(profileSrc).toContain("firestore.rules");
  });
});

describe("detectDeviceClass", () => {
  it("UA文字列から判定する", () => {
    expect(detectDeviceClass("Mozilla/5.0 (iPhone; ...)")).toBe("ios");
    expect(detectDeviceClass("Mozilla/5.0 (Linux; Android 14; ...)")).toBe("android");
    expect(detectDeviceClass("Mozilla/5.0 (Windows NT 10.0)")).toBe("pc");
  });
});
