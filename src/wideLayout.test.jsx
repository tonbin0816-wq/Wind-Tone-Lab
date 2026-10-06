// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BT 2026-10-03 本人裁定】iPad の「広い」画面。便1 = 案Aの土台(列 640・下部タブ 640・環 440)。
// 【便BT2 2026-10-03 統括の裁定】広い = 幅 ≥ 700 **かつ 高さ ≥ 500**(iPhone の横向きを狭い側に置く)。
// jsdom には matchMedia が無く、App を描くほかの検査が置く作り物はどの問い合わせにも matches: false
// (prefers-reduced-motion だけ true にする検査はある)なので、**ほかの検査は全部「狭い」の木(今の iPhone の木)を描く**。
// ここだけ作り物の matchMedia で広い木を描く。作り物は2通り:
//   ・切り替え式(installMatchMedia): WIDE_LAYOUT_QUERY にだけ指定の真偽を返す
//   ・画面の大きさ式(installViewport): 問い合わせの文字列の min-width / min-height を**その場で読んで**、
//     与えた幅×高さに当てはめる(問い合わせの綴りが変われば答えも変わる = 本物の判定の文字列を試す)
//   (1) useWideLayout: matchMedia が無ければ false / 最初の描画から正しい値 / 購読を始めるときに読み直す /
//       幅が変わる(change)と追いかける / 外したら購読を外す / iPhone の横向きは狭い・iPad は横でも広い
//   (2) App 全体を描き、計測タブの環: 広い → 上限 440・音名 197.33px / 狭い → 330・148px / 切り替わりで戻る
//   (3) 【便BT2】据え置き中(入力欄にフォーカス)の回転・Split View: 縮む向きだけ合わせ直す・大きくなる向きは据え置く
// 期待値(700 / 500 / 440 / 197.33 / 330 / 148 / 377(【便BZ】以前は 389)/ 292)は本人裁定・統括の裁定・モック案Aの実寸と手計算で書いたもの
// (定数から逆算しない)。環の大きさは配置の寸法から決まる(便BM)ので、jsdom の getBoundingClientRect を**環のまわりだけ**
// 作り物にする:
//   環の外枠(幅 100%・上限 diameter)= min(上限, 列の幅) の正方形 / 環の箱 = 列の幅 × 外枠の高さ /
//   画面ぶんの枠(measureFrameRef)= 環以外の高さ OTHERS + 外枠の高さ / 100svh の物差し = 画面の高さ VH。
//   ほかの要素は jsdom のまま(全部 0)。--page-bottom-gap の物差しは 0 を返すので、App の既定(【便BZ】47 → 59 = 下部タブに名前を足した --nav-h)が使われる。
//   よって収まる直径 = VH − 59 − OTHERS(を上限と列の幅で頭打ち)。
// 【守っていないもの】実寸(列 640 の中央寄せ・下部タブの幅・浮かせるボタンの右端・カードの幅)。CSS の max-width と
//   max() の結果は jsdom では出ない。実測は報告に書いた。綴りは pitch-test の「iPad」節が見る。
// ------------------------------------------------------------------
const mod = await import("./App.jsx");
const { default: App, useWideLayout, WIDE_LAYOUT_QUERY, WIDE_LAYOUT_MIN_W, WIDE_LAYOUT_MIN_H } = mod;

let root; let host;
let mq; // 作り物の matchMedia の状態
const listeners = new Set();
function installMatchMedia(wide) {
  mq = { wide };
  listeners.clear();
  window.matchMedia = vi.fn((q) => ({
    media: q,
    get matches() { return q === WIDE_LAYOUT_QUERY ? mq.wide : false; },
    addEventListener: (type, fn) => { if (q === WIDE_LAYOUT_QUERY && type === "change") listeners.add(fn); },
    removeEventListener: (type, fn) => { if (q === WIDE_LAYOUT_QUERY && type === "change") listeners.delete(fn); },
    addListener: () => {}, removeListener: () => {},
  }));
}
async function setWide(wide) {
  mq.wide = wide;
  await act(async () => { for (const fn of [...listeners]) fn({ matches: wide }); });
}
// 問い合わせの文字列を読んで幅×高さに当てはめる(min-width / min-height を and でつないだ形だけを解く。
// それ以外の条件が入っていたら投げる = 黙って真にしない)。
function matchesViewport(q, w, h) {
  const parts = q.split(/\s+and\s+/);
  return parts.every((p) => {
    const m = /^\(\s*min-(width|height)\s*:\s*(\d+)px\s*\)$/.exec(p.trim());
    if (!m) throw new Error(`解けない問い合わせ: ${p}`);
    return (m[1] === "width" ? w : h) >= Number(m[2]);
  });
}
function installViewport(w, h) {
  window.matchMedia = vi.fn((q) => ({
    media: q,
    get matches() { return /prefers-reduced-motion/.test(q) ? false : matchesViewport(q, w, h); },
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
}

// 環のまわりだけの配置の作り物(上の注記)。
let COL = 640; let VH = 1180; let OTHERS = 0;
const realRect = Element.prototype.getBoundingClientRect;
const isRingOuter = (el) => !!el && !!el.style && el.style.width === "100%" && /^\d+(\.\d+)?px$/.test(el.style.maxWidth)
  && el.style.position === "relative" && el.style.pointerEvents === "none";
const drawn = (outer) => Math.min(parseFloat(outer.style.maxWidth), COL);
function fakeRect() {
  const box = (w, h) => ({ x: 0, y: 0, left: 0, top: 0, width: w, height: h, right: w, bottom: h, toJSON() {} });
  if (this.style && this.style.height === "100svh") return box(1, VH);
  if (isRingOuter(this)) { const d = drawn(this); return box(d, d); }
  if (this.style && this.style.flexShrink === "0" && isRingOuter(this.firstElementChild)) return box(COL, drawn(this.firstElementChild));
  if (this.style && this.style.position === "relative" && this.style.display === "flex" && this.style.flexDirection === "column") {
    const outer = [...this.querySelectorAll("div")].find(isRingOuter);
    if (outer) return box(COL, OTHERS + drawn(outer));
  }
  return realRect.call(this);
}
const setInnerWidth = (w) => Object.defineProperty(window, "innerWidth", { value: w, configurable: true, writable: true });
const realInnerWidth = window.innerWidth;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  COL = 640; VH = 1180; OTHERS = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  delete window.matchMedia;
  Element.prototype.getBoundingClientRect = realRect;
  setInnerWidth(realInnerWidth);
  vi.restoreAllMocks();
});

describe("便BT: useWideLayout(幅 ≥ 700 かつ 高さ ≥ 500 を「広い」と呼ぶ。判定は JS ただ1つ)", () => {
  let last; let seen;
  function Probe() { last = useWideLayout(); seen.push(last); return null; }
  beforeEach(() => { seen = []; });

  it("しきい値は幅 700・高さ 500。問い合わせは min-width と min-height を and でつなぐ", () => {
    expect(WIDE_LAYOUT_MIN_W).toBe(700);
    expect(WIDE_LAYOUT_MIN_H).toBe(500);
    expect(WIDE_LAYOUT_QUERY).toBe("(min-width: 700px) and (min-height: 500px)");
  });
  // 【便BT2 2026-10-03 統括の裁定】iPhone の横向き(幅 667〜956・高さ 375〜440)は狭い。iPad は縦でも横でも広い。
  it("問い合わせを画面の大きさに当てはめる: iPhone は縦も横も狭い・iPad は縦も横も広い・Split View の 1/2 と Slide Over は狭い", () => {
    const narrow = [[375, 812], [440, 956], [667, 375], [844, 390], [932, 430], [956, 440], [320, 1180], [678, 1024]];
    const wideSizes = [[820, 1180], [1180, 820], [744, 1133], [1133, 744], [1032, 1376], [1376, 1032], [781, 820], [700, 820]];
    for (const [w, h] of narrow) expect(matchesViewport(WIDE_LAYOUT_QUERY, w, h), `${w}x${h}`).toBe(false);
    for (const [w, h] of wideSizes) expect(matchesViewport(WIDE_LAYOUT_QUERY, w, h), `${w}x${h}`).toBe(true);
  });
  it("iPhone の横向き(844×390 / 956×440)で描くと狭い・iPad の横向き(1180×820)は広い", async () => {
    for (const [w, h, want] of [[844, 390, false], [956, 440, false], [1180, 820, true]]) {
      installViewport(w, h);
      await act(async () => { root.render(<Probe key={`${w}x${h}`} />); });
      expect(last, `${w}x${h}`).toBe(want);
    }
  });
  it("matchMedia が無い(jsdom・古い環境)ときは false で、投げない", async () => {
    expect(window.matchMedia).toBeUndefined();
    await act(async () => { root.render(<Probe />); });
    expect(last).toBe(false);
  });
  it("最初の描画から正しい値(広い画面で起動しても、狭い木を一度描いてから広い木に替わる、をしない)", async () => {
    installMatchMedia(true);
    await act(async () => { root.render(<Probe />); });
    expect(seen[0]).toBe(true);
    expect(seen.every((v) => v === true)).toBe(true);
  });
  it("購読を始めるときに読み直す(最初の描画のあと・購読の前に変わった分を拾う)", async () => {
    let reads = 0;
    window.matchMedia = vi.fn((q) => ({
      media: q,
      // 最初の1回(最初の描画)だけ広い、そのあとは狭い。change は来ない。
      get matches() { if (q !== WIDE_LAYOUT_QUERY) return false; reads++; return reads === 1; },
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    }));
    await act(async () => { root.render(<Probe />); });
    expect(seen[0]).toBe(true);
    expect(last).toBe(false);
  });
  it("広い・狭いを読み、幅が変わると追いかけ、外すと購読を外す", async () => {
    installMatchMedia(true);
    await act(async () => { root.render(<Probe />); });
    expect(last).toBe(true);
    expect(listeners.size).toBe(1);
    await setWide(false);
    expect(last).toBe(false);
    await setWide(true);
    expect(last).toBe(true);
    act(() => root.unmount());
    expect(listeners.size).toBe(0);
    root = createRoot(host); // afterEach の unmount 用
  });
});

describe("便BT: 計測タブの環(App 全体を描く)", () => {
  const ring = () => [...document.querySelectorAll("div")].find(isRingOuter);
  // 音名の文字の箱(fontSize = 148 × 倍率)。音が無くても箱は描かれる(§6.1.5)。
  const noteSpan = () => ring()?.querySelector('span[style*="scale"]');
  const ringPx = () => ring().style.maxWidth;
  const notePx = () => parseFloat(noteSpan().style.fontSize);

  beforeEach(() => { Element.prototype.getBoundingClientRect = fakeRect; });

  // 既存の App の検査が置く作り物(どの問い合わせにも matches: false)と同じ形。PitchRing は matchMedia を
  // 前提に読む(prefers-reduced-motion)ので、App を描くときは無しにはできない。
  it("既存の検査と同じ作り物(どれも false)= 今までの木: 列 640 でも環 330・音名 148px", async () => {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    await act(async () => { root.render(<App />); });
    expect(ring()).toBeTruthy();
    expect(ringPx()).toBe("330px");
    expect(noteSpan().style.fontSize).toBe("148px");
  });
  it("広い(820×1180・列 640): 環の上限 440・音名 197.33px(4/3 倍)", async () => {
    installMatchMedia(true);
    await act(async () => { root.render(<App />); });
    expect(ringPx()).toBe("440px");
    expect(notePx()).toBeCloseTo(197.33, 2);
  });
  it("狭い(Split View 600・列 572): 環 330・音名 148px(列が 330 より広くても上限は 330)", async () => {
    installMatchMedia(false);
    COL = 572; VH = 820;
    await act(async () => { root.render(<App />); });
    expect(ringPx()).toBe("330px");
    expect(noteSpan().style.fontSize).toBe("148px");
  });
  // 【便BT2】高さが 390 しかないので環は高さで決まる(収まる直径 = 390 − 59 − 0 = 331。【便BZ】以前は − 47 で 343)。
  // 広いと誤判定すると上限 440 → 343 になり、狭いなら上限 330 のまま。
  it("iPhone の横向き 844×390(列 640): 狭い木 = 環の上限 330・音名 148px", async () => {
    installViewport(844, 390);
    COL = 640; VH = 390;
    await act(async () => { root.render(<App />); });
    expect(ringPx()).toBe("330px");
    expect(noteSpan().style.fontSize).toBe("148px");
  });
  it("広い → 狭い(Split View で狭めた)に変わった描画で 330・148 に戻り、広げると 440 に戻る", async () => {
    installMatchMedia(true);
    await act(async () => { root.render(<App />); });
    expect(ringPx()).toBe("440px");
    await setWide(false);
    expect(ringPx()).toBe("330px");
    expect(noteSpan().style.fontSize).toBe("148px");
    await setWide(true);
    expect(ringPx()).toBe("440px");
    expect(notePx()).toBeCloseTo(197.33, 2);
  });
});

// 【便BT2 2026-10-03 統括の裁定】据え置き中(録音中・シート・入力欄・ピンチ)でも縮む向きだけは合わせ直す。
// 据え置きは入力欄にフォーカスして作る(ringFitHold がその場で読む)。回転・Split View は、配置の作り物の値・
// innerWidth を替えて resize を投げる(useRingFitLayout の鍵 = 100svh × innerWidth が変わる)。
describe("便BT2: 据え置き中の回転・Split View", () => {
  const ring = () => [...document.querySelectorAll("div")].find(isRingOuter);
  const ringPx = () => ring().style.maxWidth;
  const notePx = () => parseFloat(ring().querySelector('span[style*="scale"]').style.fontSize);
  let input;
  const hold = async () => {
    input = document.createElement("input");
    document.body.appendChild(input);
    await act(async () => { input.focus(); });
  };
  const release = async () => {
    await act(async () => { input.blur(); input.remove(); await new Promise((r) => setTimeout(r, 10)); });
  };
  const resize = async (w, h, col, wideNow) => {
    VH = h; COL = col; setInnerWidth(w);
    mq.wide = wideNow;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      for (const fn of [...listeners]) fn({ matches: wideNow });
    });
  };
  beforeEach(() => { Element.prototype.getBoundingClientRect = fakeRect; });

  it("(a) 820×1180 → 据え置き → 1180×820 に回す: 環は 377 に縮む(440 のままだとメトロノームを開いたときはみ出す)", async () => {
    installMatchMedia(true);
    setInnerWidth(820); OTHERS = 384; // 収まる直径: 縦 1180 − 59 − 384 = 737(→ 上限 440)/ 横 820 − 59 − 384 = 377(【便BZ】以前は − 47 で 389)
    await act(async () => { root.render(<App />); });
    expect(ringPx()).toBe("440px");
    await hold();
    await resize(1180, 820, 640, true);
    expect(ringPx()).toBe("377px");
    expect(notePx()).toBeCloseTo(148 * 377 / 330, 2); // 169.08
  });
  it("(b) 820×1180 → 据え置き → 幅 320(狭い・列 292): 環 292・音名 148px(描いた環より大きい字にしない)", async () => {
    installMatchMedia(true);
    setInnerWidth(820);
    await act(async () => { root.render(<App />); });
    expect(ringPx()).toBe("440px");
    expect(notePx()).toBeCloseTo(197.33, 2);
    await hold();
    await resize(320, 1180, 292, false);
    expect(ringPx()).toBe("292px");
    expect(notePx()).toBeCloseTo(148, 6);
  });
  it("(c) 大きくなる向きは据え置く: 1180×820(377)→ 据え置き → 820×1180 でも 377 のまま、外すと 440", async () => {
    installMatchMedia(true);
    setInnerWidth(1180); VH = 820; OTHERS = 384;
    await act(async () => { root.render(<App />); });
    expect(ringPx()).toBe("377px");
    await hold();
    await resize(820, 1180, 640, true);
    expect(ringPx()).toBe("377px");
    await release();
    expect(ringPx()).toBe("440px");
    expect(notePx()).toBeCloseTo(197.33, 2);
  });
});
