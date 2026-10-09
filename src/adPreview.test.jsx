// @vitest-environment jsdom
import React, { act, useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ------------------------------------------------------------------
// 【便BL 2026-10-02 本人指示】見本の広告の帯。本人「広告を入れたらボタン類が重ならないか、先に実機で見たい」。
// 守るもの:
//   ・合図の読み書き: ?adpreview=1 で覚える / ?adpreview=0 で消す / 無ければ覚えているとおり。
//     読んだら URL から adpreview だけを消す(他の問い合わせと # は残す)。保存が投げても起動を止めない
//   ・合図(<html data-ad-preview="1">)があるときだけ帯が出る。無ければ何も描かない
//   ・BottomSheet が1枚でも開いているあいだ帯は消え、全部閉じると戻る
//   ・index.css: --ad-h は既定 0px / 合図のときだけ 50px + すき間 --sp-2(【殻 S3】) / --page-bottom-gap に --ad-h が入っている
//   ・main.jsx が最初の描画の前に合図を読む
// 期待値はここに手で書いた値(定数から逆算しない)。
// 【守っていないもの】実寸(jsdom は配置も CSS の変数も計算しない)。帯の位置・計測タブの空き・
// 浮かせるボタンが帯の上に来ることは、375×812 / 375×667 の実測で報告に書いた。
// 【便CG 2026-10-09 統括の裁定】はじめの案内が終わるまで帯を出さない(<html data-ad-hold="1"> の間は --ad-h 0・帯なし)。
//   帯の出し入れの検査は「既存の利用者」(移行で案内が全部済んだ人)の起動で描く(印を作り物の IndexedDB に入れ、App を読み直す)。
//   案内の間・⑱・2回目の起動の検査は src/shell/shellAds.test.jsx の【便CG】。
// ------------------------------------------------------------------
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";
import { migrateOnboardingDone } from "./onboarding.jsx";
const { default: App, BottomSheet } = await import("./App.jsx");
const { adPreviewFromSearch, applyAdPreview, isAdPreviewOn, urlWithoutAdPreview } = await import("./adPreview.js");

const KEY = "ficus.adPreview";

// 覚え場所の偽物(localStorage と同じ3つ)。throwing にすると全部投げる(プライベートブラウジングの姿)。
function fakeStorage(init = {}, { throwing = false } = {}) {
  const m = new Map(Object.entries(init));
  const guard = () => { if (throwing) throw new Error("SecurityError"); };
  return {
    map: m,
    getItem: (k) => { guard(); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { guard(); m.set(k, String(v)); },
    removeItem: (k) => { guard(); m.delete(k); },
  };
}
function fakeHistory() {
  const calls = [];
  return { calls, state: { keep: 1 }, replaceState: (s, t, url) => { calls.push({ s, url }); } };
}
const loc = (search, { pathname = "/", hash = "" } = {}) => ({ search, pathname, hash });

describe("合図の読み書き(便BL)", () => {
  afterEach(() => { document.documentElement.removeAttribute("data-ad-preview"); });

  it("問い合わせの読み方: 1 → on / 0 → off / 無し・他の値 → null", () => {
    expect(adPreviewFromSearch("?adpreview=1")).toBe("on");
    expect(adPreviewFromSearch("?adpreview=0")).toBe("off");
    expect(adPreviewFromSearch("")).toBe(null);
    expect(adPreviewFromSearch("?a=1")).toBe(null);
    expect(adPreviewFromSearch("?adpreview=2")).toBe(null);
    expect(adPreviewFromSearch("?adpreview=")).toBe(null);
  });

  it("?adpreview=1: 端末に覚え、<html> に印を付け、URL から adpreview だけを消す", () => {
    const storage = fakeStorage(); const history = fakeHistory();
    const on = applyAdPreview({ location: loc("?x=2&adpreview=1", { pathname: "/app", hash: "#metro-diag" }), history, storage, doc: document });
    expect(on).toBe(true);
    expect(storage.map.get(KEY)).toBe("1");
    expect(document.documentElement.getAttribute("data-ad-preview")).toBe("1");
    expect(isAdPreviewOn(document)).toBe(true);
    expect(history.calls).toEqual([{ s: { keep: 1 }, url: "/app?x=2#metro-diag" }]);
  });

  it("?adpreview=0: 覚えていたのを消し、印を外し、URL を戻す", () => {
    document.documentElement.setAttribute("data-ad-preview", "1");
    const storage = fakeStorage({ [KEY]: "1" }); const history = fakeHistory();
    const on = applyAdPreview({ location: loc("?adpreview=0"), history, storage, doc: document });
    expect(on).toBe(false);
    expect(storage.map.has(KEY)).toBe(false);
    expect(document.documentElement.hasAttribute("data-ad-preview")).toBe(false);
    expect(isAdPreviewOn(document)).toBe(false);
    expect(history.calls).toEqual([{ s: { keep: 1 }, url: "/" }]);
  });

  it("合図なし・覚えている: 出す。URL には触らない", () => {
    const storage = fakeStorage({ [KEY]: "1" }); const history = fakeHistory();
    expect(applyAdPreview({ location: loc("?x=2"), history, storage, doc: document })).toBe(true);
    expect(document.documentElement.getAttribute("data-ad-preview")).toBe("1");
    expect(history.calls).toEqual([]);
    expect(storage.map.get(KEY)).toBe("1");
  });

  it("合図なし・覚えていない: 出さない。印も付けない・URL にも保存にも触らない", () => {
    const storage = fakeStorage(); const history = fakeHistory();
    expect(applyAdPreview({ location: loc(""), history, storage, doc: document })).toBe(false);
    expect(document.documentElement.hasAttribute("data-ad-preview")).toBe(false);
    expect(history.calls).toEqual([]);
    expect(storage.map.size).toBe(0);
  });

  it("保存が投げる端末でも止まらない(?adpreview=1 ならこの起動では出す / 合図なしなら出さない)", () => {
    const storage = fakeStorage({}, { throwing: true });
    expect(() => applyAdPreview({ location: loc("?adpreview=1"), history: fakeHistory(), storage, doc: document })).not.toThrow();
    expect(isAdPreviewOn(document)).toBe(true);
    document.documentElement.removeAttribute("data-ad-preview");
    expect(applyAdPreview({ location: loc(""), history: fakeHistory(), storage, doc: document })).toBe(false);
    expect(isAdPreviewOn(document)).toBe(false);
  });

  it("1 / 0 以外の値でも adpreview は URL から消す(覚えはしない)", () => {
    const storage = fakeStorage(); const history = fakeHistory();
    expect(applyAdPreview({ location: loc("?adpreview=yes&b=3"), history, storage, doc: document })).toBe(false);
    expect(history.calls.map((c) => c.url)).toEqual(["/?b=3"]);
    expect(storage.map.size).toBe(0);
    expect(urlWithoutAdPreview(loc("?adpreview=1"))).toBe("/");
  });

  it("main.jsx は最初の描画の前に合図を読む", () => {
    const main = readFileSync(join(process.cwd(), "src", "main.jsx"), "utf8");
    const call = main.indexOf("applyAdPreview()");
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(main.indexOf("root.render("));
  });
});

describe("index.css の帯の高さ(便BL)", () => {
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
  // コメントを剥がしてから読む(注記の中の綴りに当たらないように)
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rootBlock = code.slice(code.indexOf(":root {"), code.indexOf("}", code.indexOf(":root {")));

  it("--ad-h は :root で 0px(合図が無い人には何も変わらない)", () => {
    expect(/--ad-h:\s*0px;/.test(rootBlock)).toBe(true);
  });
  it("--page-bottom-gap = ナビ + 帯 + 安全域", () => {
    expect(/--page-bottom-gap:\s*calc\(var\(--nav-h\) \+ var\(--ad-h\) \+ env\(safe-area-inset-bottom\)\);/.test(rootBlock)).toBe(true);
  });
  // 【殻 S3 2026-10-06 統括の裁定】帯と下部タブの間に押せないすき間 --sp-2。--ad-h は帯の 50px + すき間(中身も同じだけ上がる)
  it("【便CG】案内の間の印(<html data-ad-hold=\"1\">)は --ad-h を既定の 0px に戻す(見本の規則より後ろ・同じ詳細度)", () => {
    const iPrev = code.search(/:root\[data-ad-preview="1"\]\s*\{/);
    const m = code.match(/:root\[data-ad-hold="1"\]\s*\{([^}]*)\}/);
    expect(m).toBeTruthy();
    expect(m[1].trim()).toBe("--ad-h: 0px;");
    expect(iPrev).toBeGreaterThan(0);
    expect(code.indexOf(m[0])).toBeGreaterThan(iPrev);
  });

  it("合図(<html data-ad-preview=\"1\">)のときだけ --ad-h は 50px + --sp-2(帯 + すき間)", () => {
    const m = code.match(/:root\[data-ad-preview="1"\]\s*\{([^}]*)\}/);
    expect(m).toBeTruthy();
    expect(/--ad-h:\s*calc\(50px \+ var\(--sp-2\)\);/.test(m[1])).toBe(true);
    // 50px を持つのはこの規則だけ(:root の既定が 50 になっていない)
    expect((code.match(/--ad-h:\s*calc\(50px/g) || []).length).toBe(1);
    expect((code.match(/--ad-h:\s*50px/g) || []).length).toBe(0);
  });
});

describe("帯の出し入れ(便BL)。【便CG】既存の利用者の起動", () => {
  let root; let host; let root2; let host2;
  // 【便CG】既存の利用者(移行で finish)の印を入れた作り物の IndexedDB で、App を読み直して描く(案内の間は帯を出さないため)
  let App; let BottomSheet; let fake;
  const EXISTING = migrateOnboardingDone({}, { sessions: [{ id: "s1" }] });
  beforeEach(async () => {
    fake = createFakeIndexedDb();
    vi.resetModules();
    globalThis.indexedDB = fake;
    const m = await import("./App.jsx");
    App = m.default; BottomSheet = m.BottomSheet;
    const db = await m.openIdb(); db.close?.();
    fake._peek("windToneLabDB", "kv").set("onboardingDone", structuredClone(EXISTING));
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.scrollTo = () => {};
    if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    if (!window.SVGElement.prototype.getComputedTextLength) {
      window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
    }
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    host2 = document.createElement("div"); document.body.appendChild(host2); root2 = createRoot(host2);
  });
  afterEach(() => {
    act(() => root.unmount()); act(() => root2.unmount());
    host.remove(); host2.remove();
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-ad-preview");
    document.documentElement.removeAttribute("data-ad-hold");
    delete globalThis.indexedDB;
  });
  const strip = () => document.querySelector("[data-ad-preview-strip]");
  // 印の読み込み(作り物の IndexedDB は setTimeout 0 で返す)が済み、帯の門が開くまで待つ
  const loaded = async () => {
    for (let i = 0; i < 100 && document.documentElement.getAttribute("data-ad-hold") === "1"; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    }
    expect(document.documentElement.hasAttribute("data-ad-hold")).toBe(false);
  };
  const go = async (label) => {
    const b = document.querySelector(`button[aria-label="${label}"]`);
    expect(b, label).toBeTruthy();
    await act(async () => { b.click(); });
  };

  it("合図が無ければ帯は描かれない", async () => {
    await act(async () => { root.render(<App />); });
    await loaded();
    expect(host.querySelector(".app-root")).toBeTruthy();
    expect(strip()).toBe(null);
    expect(document.body.textContent.includes("広告(見本)")).toBe(false);
  });

  it("合図があれば、下部タブのすぐ上・高さ --ad-h・重なり順 30 で、下部タブより後ろに描かれる", async () => {
    document.documentElement.setAttribute("data-ad-preview", "1");
    await act(async () => { root.render(<App />); });
    await loaded();
    const s = strip();
    expect(s).toBeTruthy();
    expect(s.textContent).toContain("広告(見本)");
    expect([...s.querySelectorAll("span")].map((e) => e.textContent)).toEqual(["広告", "広告(見本)"]);
    expect(s.style.position).toBe("fixed");
    // 【殻 S3】下部タブとの間に --sp-2 のすき間(地は塗らない = 帯の箱はすき間の上から)。帯の高さは --ad-h からすき間を引いた分
    expect(s.style.bottom).toBe("calc(var(--nav-h) + env(safe-area-inset-bottom) + var(--sp-2))");
    expect(s.style.height).toBe("calc(var(--ad-h) - var(--sp-2))");
    expect(s.style.zIndex).toBe("30");
    // 下部タブ(同じ 30)より後ろに居る = 同じ重なり順の中では上に描かれる
    const nav = document.querySelector('button[aria-label="計測"]').closest('div[style*="z-index: 30"]');
    expect(nav).toBeTruthy();
    expect(nav.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("シート(リードを追加)を開くと帯が消え、閉じると戻る", async () => {
    document.documentElement.setAttribute("data-ad-preview", "1");
    await act(async () => { root.render(<App />); });
    await loaded();
    await go("リード");
    expect(strip()).toBeTruthy();
    await go("リードを追加");
    expect(document.querySelector(".sheet-scrim")).toBeTruthy();
    expect(strip()).toBe(null);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(document.querySelector(".sheet-scrim")).toBe(null);
    expect(strip()).toBeTruthy();
  });

  it("2枚重ねたシートは、全部閉じるまで帯を出さない", async () => {
    document.documentElement.setAttribute("data-ad-preview", "1");
    await act(async () => { root.render(<App />); });
    await loaded();
    expect(strip()).toBeTruthy();
    function Two() {
      const [open, setOpen] = useState({ A: true, B: true });
      return open.A ? (
        <BottomSheet ariaLabel="A" onClose={() => setOpen((o) => ({ ...o, A: false }))}>
          {open.B ? <BottomSheet ariaLabel="B" onClose={() => setOpen((o) => ({ ...o, B: false }))}><div>B</div></BottomSheet> : null}
        </BottomSheet>
      ) : null;
    }
    await act(async () => { root2.render(<Two />); });
    expect(strip()).toBe(null);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(document.querySelector('[role="dialog"][aria-label="B"]')).toBe(null);
    expect(document.querySelector('[role="dialog"][aria-label="A"]')).toBeTruthy();
    expect(strip()).toBe(null);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(document.querySelector('[role="dialog"][aria-label="A"]')).toBe(null);
    expect(strip()).toBeTruthy();
  });
});
