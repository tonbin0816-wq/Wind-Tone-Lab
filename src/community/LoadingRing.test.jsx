// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【2026-10-06 本人裁定】読み込み中の絵は、アイコンの芽の輪郭を線でなぞり、
// **90% で輪郭が閉じ、残りの 10% で中を塗る**(見本「線で描いて塗る」を9割で閉じる形に)。
//   ・0〜90%: 外形(右上の葉の先から)→ 根元の巻きの穴の順になぞる。塗りは無い
//   ・90% ちょうどで輪郭が閉じる(外形も穴もなぞり終わり)。まだ塗らない
//   ・90〜100%: 塗りが濃くなるぶん線が消え、100% は塗りだけ(アイコンの芽と同じ形)
//   ・0% では線を描かない(丸い先端は長さ 0 の破線も点として描く ── 株と輪で2度踏んだ罠)
//   ・芽の形はアイコン(public/icon.svg)の写し。外形と穴の2本
// 【守っていないもの】88px での線の見え方(約 1.5px)と色。ブラウザで目で見た(報告)。
// ------------------------------------------------------------------
const { LoadingRing, sproutStage, CLOSE_AT } = await import("./LoadingRing.jsx");
const { SPROUT_OUTER, SPROUT_HOLE, SPROUT_OUTER_SHARE } = await import("./sproutPath.js");

let root; let host;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const draw = (p) => { act(() => root.render(<LoadingRing p={p} />)); return [...host.querySelectorAll("path")]; };
const strokes = (paths) => paths.filter((el) => el.getAttribute("stroke-dasharray"));
const fills = (paths) => paths.filter((el) => el.getAttribute("fill") !== "none");

describe("読み込み中の芽: 9割で輪郭が閉じ、残りで塗る", () => {
  it("閉じる位置は 90%", () => {
    expect(CLOSE_AT).toBe(0.9);
  });

  it("90% より手前は線だけ。外形を先になぞり、外形が済んでから穴をなぞる", () => {
    const early = sproutStage(0.9 * SPROUT_OUTER_SHARE * 0.5);
    expect(early.outer).toBeCloseTo(0.5, 5);
    expect(early.hole).toBe(0);
    expect(early.fill).toBe(0);
    expect(early.line).toBe(1);
    const late = sproutStage(0.9 * (SPROUT_OUTER_SHARE + (1 - SPROUT_OUTER_SHARE) * 0.5));
    expect(late.outer).toBe(1);
    expect(late.hole).toBeCloseTo(0.5, 5);
    expect(late.fill).toBe(0);
  });

  it("90% ちょうどで輪郭が閉じ、まだ塗らない", () => {
    const s = sproutStage(0.9);
    expect(s.outer).toBe(1);
    expect(s.hole).toBe(1);
    expect(s.fill).toBe(0);
    expect(s.line).toBe(1);
  });

  it("90〜100% で塗りが濃くなり、そのぶん線が消える。100% は塗りだけ", () => {
    const mid = sproutStage(0.95);
    expect(mid.fill).toBeGreaterThan(0);
    expect(mid.fill).toBeLessThan(1);
    expect(mid.line).toBeCloseTo(1 - mid.fill, 10);
    const done = sproutStage(1);
    expect(done.fill).toBe(1);
    expect(done.line).toBe(0);
  });

  it("描いた絵: 0% は何も描かない(点が乗らない)", () => {
    expect(draw(0)).toHaveLength(0);
  });

  it("描いた絵: 50% は外形の線が1本だけ(pathLength=1 で見せる割合を書く)", () => {
    const paths = draw(0.5);
    expect(strokes(paths)).toHaveLength(1);
    expect(fills(paths)).toHaveLength(0);
    const [line] = strokes(paths);
    expect(line.getAttribute("d")).toBe(SPROUT_OUTER);
    expect(line.getAttribute("pathLength")).toBe("1");
    expect(line.getAttribute("stroke")).toBe("var(--c-accent)");
    expect(line.getAttribute("stroke-linecap")).toBe("round");
  });

  it("描いた絵: 100% は塗りだけで、形はアイコンの芽(外形 + 穴・evenodd)", () => {
    const paths = draw(1);
    expect(strokes(paths)).toHaveLength(0);
    const [body] = fills(paths);
    expect(fills(paths)).toHaveLength(1);
    expect(body.getAttribute("d")).toBe(SPROUT_OUTER + SPROUT_HOLE);
    expect(body.getAttribute("fill-rule")).toBe("evenodd");
    expect(body.getAttribute("fill")).toBe("var(--c-accent)");
  });

  it("芽の形はアイコンの芽と同じ範囲にある(外接箱がアイコンの芽の箱 x 226〜840・y 201〜838 から 6 以内)", () => {
    const nums = (SPROUT_OUTER + SPROUT_HOLE).match(/-?\d+(?:\.\d+)?/g).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.abs(Math.min(...xs) - 226)).toBeLessThanOrEqual(6);
    expect(Math.abs(Math.max(...xs) - 840)).toBeLessThanOrEqual(6);
    expect(Math.abs(Math.min(...ys) - 201)).toBeLessThanOrEqual(6);
    expect(Math.abs(Math.max(...ys) - 838)).toBeLessThanOrEqual(6);
  });
});
