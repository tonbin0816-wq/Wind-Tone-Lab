// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BI 2026-10-02 本人裁定(b)】「計測タブだけ画面レイアウトの根本が違うので、計測タブだけ上に詰めて」。
// アプリ全体(WindToneLabPhaseMode)を描いて、下部タブで行き来しながら .app-root の上端の余白を読む。
//   ・計測タブ      … calc(var(--sp-1) + env(safe-area-inset-top))(--sp-1 = 4px。index.css から読んで確かめる)
//   ・リード・データ・コミュニティ … calc(16px + env(safe-area-inset-top))(今までのまま)
//   ・どちらもセーフエリアをつぶさない(env(safe-area-inset-top) を足している)
//   ・行って戻っても計測タブは詰まったまま、他のタブは 16px のまま
// 期待値はここに手で書いた式(定数から逆算しない。定数の綴りが変わっても描いた結果で見る)。
// 【守っていないもの】実寸(jsdom は配置を計算しない)。375×812 の実測(設定の行の y・空きの高さ)は報告に書いた。
// ------------------------------------------------------------------
const { default: App } = await import("./App.jsx");
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MEASURE = "calc(var(--sp-1) + env(safe-area-inset-top))";
const OTHERS = "calc(16px + env(safe-area-inset-top))";

let root; let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});
const appRoot = () => host.querySelector(".app-root");
// padding の1つ目(上端)。インラインの padding は「上 右 下 左」の4つ。
const topPad = () => {
  const p = appRoot().style.padding;
  const i = p.indexOf(" var(--page-pad-right)");
  return i > 0 ? p.slice(0, i) : p;
};
const go = async (label) => {
  const b = document.querySelector(`button[aria-label="${label}"]`);
  expect(b, label).toBeTruthy();
  await act(async () => { b.click(); });
};

describe("上端の余白は計測タブだけ詰める(便BI 本人裁定(b))", () => {
  it("前提: --sp-1 は 4px(本人の指定の 4px をトークンで書いている)", () => {
    const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
    expect(/--sp-1:\s*4px;/.test(css)).toBe(true);
  });

  it("起動(計測タブ)は 4px + セーフエリア。リード・データ・コミュニティは 16px + セーフエリア。戻ると 4px", async () => {
    await act(async () => { root.render(<App />); });
    expect(appRoot()).toBeTruthy();
    expect(topPad()).toBe(MEASURE);
    // 左右と下は今までどおり
    expect(appRoot().style.padding).toBe(`${MEASURE} var(--page-pad-right) var(--page-bottom-gap) var(--page-pad-left)`);
    for (const label of ["リード", "データ", "コミュニティ"]) {
      await go(label);
      expect(topPad(), label).toBe(OTHERS);
      expect(appRoot().style.padding, label).toBe(`${OTHERS} var(--page-pad-right) var(--page-bottom-gap) var(--page-pad-left)`);
    }
    await go("計測");
    expect(topPad()).toBe(MEASURE);
    await go("データ");
    expect(topPad()).toBe(OTHERS);
  });
});
