// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import LoadingRingBox, { loadingRingShift } from "./LoadingRing.jsx";

// ------------------------------------------------------------------
// 【便DG 2026-10-26 本人の実機のスクショ】コミュニティのロード中、ロードが進んで上にタブ(データ・順位・シェア・マイページ)が出ると、芽のアイコンが下へ約 50px(2000px 換算)ずれた。
// 原因: 芽は「包みの上端〜下部ナビ(と広告の帯)の上端」の中央に置かれ、タブの帯が出ると包みの上端が下がって中央が半分だけ下がる。
// 直し: 中央を「タブが出ていないときの上端(top0)〜下部ナビ(と広告の帯)の上端」の中央に固定する(上端が下がったぶん shift を下の余白に足して中身を持ち上げる)。
// jsdom には配置が無いので、描いた包みの style(paddingBottom・minHeight)から**中央の y を計算**して比べる:
//   中身の領域 = [top + pt, top + minHeight − pb]  (pt = pb の基本 = --sp-6 = s。pb には shift が足される)  → 中央 = (D + top − shift) / 2   (D = 可視高 − --page-bottom-gap)
// 本物のブラウザでの実測(375×812・広告あり/なし)は報告に書いた(同じ式の素の DOM で、Chrome の配置が出した y)。
// 【守っていないもの】本物の iPhone の実寸・殻の広告の帯の実際の高さ(実機待ち)。
// ------------------------------------------------------------------
const S = 32;   // --sp-6 の値(index.css)。式の中の相殺で消えるので、ここでの値は答えに効かない(計算の見通しのため)
let host; let root; let realRect; let realCS;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });   // 動きを減らす = rAF を回さない
  window.scrollTo = () => {};
  realRect = window.Element.prototype.getBoundingClientRect;
  realCS = window.getComputedStyle;
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; host?.remove();
  window.Element.prototype.getBoundingClientRect = realRect;
  window.getComputedStyle = realCS;
  delete window.matchMedia;
});

// 包みの style から、芽(中身)の中央の y を求める。D = 可視高 − --page-bottom-gap(広告あり/なしで変わる)
async function ringCenterY({ withTabs, ad = 0, vh = 812, nav = 59 }) {
  const CARD_TOP = 4;      // card(.surf-card)の中身の先頭(app-root の上の余白)
  const TABS = 44;         // タブの帯の高さ
  const boxTop = CARD_TOP + (withTabs ? TABS : 0);
  window.Element.prototype.getBoundingClientRect = function () {
    const rect = (t, h) => ({ top: t, bottom: t + h, left: 0, right: 375, width: 375, height: h, x: 0, y: t });
    if (this.classList?.contains("surf-card")) return rect(CARD_TOP, 600);
    if (this.getAttribute?.("role") === "img") return rect(boxTop, 100);
    return rect(0, 0);
  };
  window.getComputedStyle = (el) => (el.classList?.contains("surf-card") ? { borderTopWidth: "0px", paddingTop: "0px" } : realCS(el));
  await act(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<div className="surf-card"><LoadingRingBox /></div>);
  });
  const el = host.querySelector('[role="img"]');
  const style = el.getAttribute("style");
  const shift = Number(/padding-bottom:\s*calc\(var\(--sp-6\)\s*\+\s*([\d.]+)px\)/.exec(style)?.[1]);
  const top = Number(/min-height:\s*calc\(100dvh - var\(--page-bottom-gap\) - ([\d.]+)px\)/.exec(style)?.[1]);
  expect(Number.isFinite(shift), style).toBe(true);
  expect(top).toBe(boxTop);                         // 上端は実測(測った値をそのまま使う)
  const D = vh - (nav + ad);                        // 可視高 − --page-bottom-gap(下部ナビ + 広告の帯)
  const minH = D - top;
  return { center: top + (S + minH - (S + shift)) / 2, shift, top, D };
}

describe("ロード中の芽の位置(便DG)", () => {
  it("タブの帯が出ていても出ていなくても、芽の中央の y は同じ(許容 1px)。位置はタブが出ていないとき = 今までの中央", async () => {
    const a = await ringCenterY({ withTabs: false });
    await act(async () => root.unmount()); root = null; host.remove();
    const b = await ringCenterY({ withTabs: true });
    expect(a.shift).toBe(0);                          // タブが出ていない画面は今までと1pxも変わらない
    expect(b.shift).toBe(44);                         // タブの帯の高さぶんだけ持ち上げる
    expect(Math.abs(a.center - b.center)).toBeLessThanOrEqual(1);
    expect(a.center).toBe((a.top + a.D) / 2);         // = 上端〜下部ナビの上端の中央(以前と同じ)
  });
  it("広告の帯があっても、中央は(上端〜広告の帯の上端)の中央に来て、タブの有無では動かない", async () => {
    const out = [];
    for (const ad of [0, 50]) {
      for (const withTabs of [false, true]) {
        out.push({ ad, withTabs, ...(await ringCenterY({ withTabs, ad })) });
        await act(async () => root.unmount()); root = null; host.remove();
      }
    }
    for (const ad of [0, 50]) {
      const [x, y] = out.filter((o) => o.ad === ad);
      expect(Math.abs(x.center - y.center), `広告 ${ad}px`).toBeLessThanOrEqual(1);
      expect(x.center).toBe((4 + (812 - 59 - ad)) / 2);   // 上端 4 〜 (可視高 − 下部ナビ − 広告)の中央
    }
    expect(out.find((o) => o.ad === 50 && !o.withTabs).center).toBeLessThan(out.find((o) => o.ad === 0 && !o.withTabs).center);   // 広告があると、その分だけ上へ
  });
  it("card の外(.surf-card も .app-root も無い)では今までどおり shift = 0", async () => {
    window.Element.prototype.getBoundingClientRect = function () { return { top: 100, bottom: 200, left: 0, right: 375, width: 375, height: 100, x: 0, y: 100 }; };
    await act(async () => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); root.render(<LoadingRingBox />); });
    expect(host.querySelector('[role="img"]').getAttribute("style")).toMatch(/padding-bottom:\s*calc\(var\(--sp-6\)\s*\+\s*0px\)/);
  });
  it("loadingRingShift: 上端が top0 より下がったぶんだけ(上がったら 0。測れなければ 0)", () => {
    expect(loadingRingShift(48, 4)).toBe(44);
    expect(loadingRingShift(4, 4)).toBe(0);
    expect(loadingRingShift(2, 4)).toBe(0);
    expect(loadingRingShift(48, null)).toBe(0);
    expect(loadingRingShift(NaN, 4)).toBe(0);
  });
});
