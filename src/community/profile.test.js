import { describe, it, expect } from "vitest";
import { validateNickname, buildProfileDoc, detectDeviceClass, POSITIONS, SAX_TYPES } from "./profile.js";

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
  it("複数選択は許可リスト外を黙って除外する", () => {
    const r = buildProfileDoc({ ...base, genres: ["クラシック", "演歌"] });
    expect(r.doc.genres).toEqual(["クラシック"]);
  });
});

describe("detectDeviceClass", () => {
  it("UA文字列から判定する", () => {
    expect(detectDeviceClass("Mozilla/5.0 (iPhone; ...)")).toBe("ios");
    expect(detectDeviceClass("Mozilla/5.0 (Linux; Android 14; ...)")).toBe("android");
    expect(detectDeviceClass("Mozilla/5.0 (Windows NT 10.0)")).toBe("pc");
  });
});
