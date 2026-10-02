// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  applyTutorialPreview, tutorialPreviewFromSearch, urlWithoutTutorialPreview, readTutorialPreviewStored, isTutorialPreviewOn,
  TUTORIAL_PREVIEW_STORAGE_KEY, TUTORIAL_PREVIEW_ATTR,
} from "./tutorialPreview.js";

// ------------------------------------------------------------------
// 【便BP3 2026-10-03 本人の依頼】はじめの一手の見本の合図(?tutorialpreview=1 / 0)の読み書き。
// 綴り(鍵・問い合わせ・属性)は手で書いた期待値で縛る。見本の中の振る舞い(済みを無視する・本物の印を書かない)は
// onboardingApp.test.jsx の「見本」。
// ------------------------------------------------------------------

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}
function env(search, stored = {}) {
  const calls = [];
  const loc = { pathname: "/app", search, hash: "#x" };
  const hist = { state: null, replaceState: (_s, _t, url) => { calls.push(url); } };
  const storage = memStorage(stored);
  const doc = document.implementation.createHTMLDocument("t");
  return { loc, hist, storage, doc, calls };
}

describe("見本の合図", () => {
  it("綴り: 鍵は ficus.tutorialPreview、属性は data-tutorial-preview", () => {
    expect(TUTORIAL_PREVIEW_STORAGE_KEY).toBe("ficus.tutorialPreview");
    expect(TUTORIAL_PREVIEW_ATTR).toBe("data-tutorial-preview");
    expect(tutorialPreviewFromSearch("?tutorialpreview=1")).toBe("on");
    expect(tutorialPreviewFromSearch("?tutorialpreview=0")).toBe("off");
    expect(tutorialPreviewFromSearch("?tutorialpreview=yes")).toBe(null);
    expect(tutorialPreviewFromSearch("?adpreview=1")).toBe(null);
  });
  it("?tutorialpreview=1 でこの端末に覚え、<html> に印を付け、URL から合図だけを消す(他の問い合わせと # は残す)", () => {
    const e = env("?adpreview=1&tutorialpreview=1");
    expect(applyTutorialPreview({ location: e.loc, history: e.hist, storage: e.storage, doc: e.doc })).toBe(true);
    expect(e.storage.getItem("ficus.tutorialPreview")).toBe("1");
    expect(e.doc.documentElement.getAttribute("data-tutorial-preview")).toBe("1");
    expect(isTutorialPreviewOn(e.doc)).toBe(true);
    expect(e.calls).toEqual(["/app?adpreview=1#x"]);
  });
  it("合図が無ければ覚えているとおり。?tutorialpreview=0 で消す", () => {
    const e1 = env("", { "ficus.tutorialPreview": "1" });
    expect(applyTutorialPreview({ location: e1.loc, history: e1.hist, storage: e1.storage, doc: e1.doc })).toBe(true);
    expect(e1.calls).toEqual([]);   // 合図が無ければ URL に触らない
    const e2 = env("?tutorialpreview=0", { "ficus.tutorialPreview": "1" });
    expect(applyTutorialPreview({ location: e2.loc, history: e2.hist, storage: e2.storage, doc: e2.doc })).toBe(false);
    expect(e2.storage.getItem("ficus.tutorialPreview")).toBe(null);
    expect(e2.doc.documentElement.hasAttribute("data-tutorial-preview")).toBe(false);
    expect(e2.calls).toEqual(["/app#x"]);
    const e3 = env("");
    expect(applyTutorialPreview({ location: e3.loc, history: e3.hist, storage: e3.storage, doc: e3.doc })).toBe(false);
  });
  it("保存が投げても止まらない(プライベートブラウジング)/ 引継のファイル(IndexedDB の kv)には置かない", () => {
    const throwing = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
    expect(readTutorialPreviewStored(throwing)).toBe(false);
    const e = env("?tutorialpreview=1");
    expect(applyTutorialPreview({ location: e.loc, history: e.hist, storage: throwing, doc: e.doc })).toBe(true);
    expect(urlWithoutTutorialPreview({ pathname: "/", search: "?tutorialpreview=1", hash: "" })).toBe("/");
  });
});
