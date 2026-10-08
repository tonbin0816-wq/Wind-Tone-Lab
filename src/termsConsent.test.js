import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TERMS_CONSENT_KEY, TERMS_VERSION, isConsentRecord, makeConsentRecord, needsConsentScreen } from "./termsConsent.js";

// ------------------------------------------------------------------
// 【便CB 2026-10-08】起動の最初の同意の判断(純関数)。画面と配線は consentGate.test.jsx。
// 版の印は public/terms.html の「最終更新日」から読んで突き合わせる(定数を同じ定数で書き直さない)。
// ------------------------------------------------------------------
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("同意の版と記録", () => {
  it("版は利用規約の「最終更新日」と同じ日(規約の日付を直したら版も直す)", () => {
    const m = read("../public/terms.html").match(/最終更新日: (\d{4})年(\d{1,2})月(\d{1,2})日/);
    expect(m).not.toBe(null);
    const fromHtml = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    expect(TERMS_VERSION).toBe(fromHtml);
  });
  it("規約とポリシーは「利用開始時に同意」と書いている(「利用したら同意とみなす」ではない)", () => {
    const terms = read("../public/terms.html");
    const privacy = read("../public/privacy.html");
    expect(terms).toContain("本アプリの利用開始時（初めて起動したとき）に、本規約とプライバシーポリシーへの同意をいただいています。");
    expect(terms).not.toContain("同意したものとみなします");
    expect(privacy).toContain("本アプリの利用開始時（初めて起動したとき）に、利用規約と本ポリシーへの同意をいただいています。");
    expect(privacy).toMatch(/最終更新日: 2026年10月8日/);
  });
  it("鍵の綴りは termsConsent(変えると保存済みの同意と引継のファイルが読めなくなる)", () => {
    expect(TERMS_CONSENT_KEY).toBe("termsConsent");
  });
  it("記録は日時(ISO)と版の2つ", () => {
    const r = makeConsentRecord(new Date("2026-10-08T01:02:03.000Z"));
    expect(r).toEqual({ at: "2026-10-08T01:02:03.000Z", version: "2026-10-08" });
    expect(isConsentRecord(r)).toBe(true);
  });
  it("欠けた記録は記録ではない", () => {
    for (const v of [null, undefined, {}, "x", { at: "2026-10-08T00:00:00.000Z" }, { version: "2026-10-08" }, { at: "", version: "2026-10-08" }, { at: "a", version: "" }, { at: 1, version: "2026-10-08" }]) {
      expect(isConsentRecord(v)).toBe(false);
    }
  });
});

describe("誰に同意の画面を出すか", () => {
  const REC = { at: "2026-10-08T00:00:00.000Z", version: "2026-10-08" };
  it("記録があれば出さない(参加していてもいなくても)", () => {
    expect(needsConsentScreen({ consent: REC, onboardingDone: {} })).toBe(false);
    expect(needsConsentScreen({ consent: REC, onboardingDone: { join: true } })).toBe(false);
  });
  it("記録が無くても参加の印があれば出さない(参加のカードで同意している)", () => {
    expect(needsConsentScreen({ consent: null, onboardingDone: { join: true } })).toBe(false);
  });
  it("記録も参加の印も無ければ出す(入れたて・参加していない既存の利用者)", () => {
    expect(needsConsentScreen({ consent: null, onboardingDone: {} })).toBe(true);
    expect(needsConsentScreen({ consent: undefined, onboardingDone: { measure: true, migrated: true } })).toBe(true);
    expect(needsConsentScreen({ consent: null, onboardingDone: { join: false } })).toBe(true);
    expect(needsConsentScreen({ consent: null, onboardingDone: null })).toBe(true);
    expect(needsConsentScreen({ consent: { at: "x" }, onboardingDone: {} })).toBe(true);
  });
});
