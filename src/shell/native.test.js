// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { isNativeShell, shellPlatform } from "./native.js";

// 【殻 S1】殻かどうかの判定(アプリ全体でここだけが window.Capacitor を読む)。
// jsdom は Web 版と同じく window.Capacitor を持たない。殻の中の形は Capacitor のランタイムが置く
// { isNativePlatform, getPlatform } をモックで作る。
afterEach(() => { delete window.Capacitor; });

describe("isNativeShell / shellPlatform ── 殻の判定", () => {
  it("window.Capacitor が無い(Web 版・jsdom)なら殻ではない", () => {
    expect("Capacitor" in window).toBe(false);
    expect(isNativeShell()).toBe(false);
    expect(shellPlatform()).toBe("web");
  });

  it("殻の中(isNativePlatform が true・getPlatform が ios)なら殻で、種別は ios", () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
    expect(isNativeShell()).toBe(true);
    expect(shellPlatform()).toBe("ios");
  });

  it("種別は getPlatform の答えをそのまま返す(android)", () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };
    expect(shellPlatform()).toBe("android");
  });

  // Capacitor の Web 用ランタイムが読み込まれた形(isNativePlatform が false)。殻ではない。
  it("isNativePlatform が false なら殻ではない(種別も web)", () => {
    window.Capacitor = { isNativePlatform: () => false, getPlatform: () => "web" };
    expect(isNativeShell()).toBe(false);
    expect(shellPlatform()).toBe("web");
  });

  it("isNativePlatform が真らしいだけの値(true ではない)なら殻ではない", () => {
    window.Capacitor = { isNativePlatform: () => "yes", getPlatform: () => "ios" };
    expect(isNativeShell()).toBe(false);
    expect(shellPlatform()).toBe("web");
  });

  it("isNativePlatform が無い・関数でないなら殻ではない", () => {
    window.Capacitor = { getPlatform: () => "ios" };
    expect(isNativeShell()).toBe(false);
    window.Capacitor = { isNativePlatform: true, getPlatform: () => "ios" };
    expect(isNativeShell()).toBe(false);
  });

  it("isNativePlatform が例外を投げても殻ではない(投げ返さない)", () => {
    window.Capacitor = { isNativePlatform: () => { throw new Error("boom"); }, getPlatform: () => "ios" };
    expect(() => isNativeShell()).not.toThrow();
    expect(isNativeShell()).toBe(false);
    expect(shellPlatform()).toBe("web");
  });

  it("殻の中で getPlatform が例外を投げたら種別は web に倒す(投げ返さない)", () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => { throw new Error("boom"); } };
    expect(isNativeShell()).toBe(true);
    expect(() => shellPlatform()).not.toThrow();
    expect(shellPlatform()).toBe("web");
  });
});
