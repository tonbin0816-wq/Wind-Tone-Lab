// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便BU 2026-10-03 本人裁定(案B)】iPad の「広い」画面のリードタブ = 2ペイン(左 = 一覧・右 = 個体詳細)。
// 本物のアプリ(WindToneLabPhaseMode)を描き、作り物の matchMedia で WIDE_LAYOUT_QUERY にだけ真偽を返して広い木 / 狭い木を描き分ける
// (ほかの検査は matchMedia が全部 false = 狭い木。iPhone の木はそちらと pitch-test が見ている)。
// IndexedDB は作り物(fakeIndexedDb.testutil.js)。リードは kv の "reeds" に入れて起動する(onboardingApp.test.jsx と同じ作り)。
// 見ること:
//   (1) 広い: 2ペインの形(.pane-2 が1つ・左 = .surf-rule の一覧・右 = .surf-card + data-noswipe)/ 右が空なら1行 /
//       最初に右に出るのは計測タブで選んでいるリード
//   (2) 広い: タイルを押すと右の中身が替わるだけ(戻るの「< 一覧」は無い・一覧は残る・スクロールしない)
//   (3) 広い: 浮かせるボタンは ＋ = 左ペイン・計測 = 右ペイン(式の名乗りで見る。値は pitch-test の BU.6)/ 比較を見ている間は
//       ＋ も計測も描かない / 楽器のチップを替えると右は外れて空に戻る
//   (4) 広い: 個体詳細の中のシート(評価のダイヤル)が開く(body へ portal)/ 長押しの編集中(右ペインを押しても終わらない・
//       タイルを押すと番号のシート)
//   (5) 広い: はじめの一手(リード2)の的は**常に1つ以下**。右が空 → 先頭のタイル / 右にリード → 右の「計測」(丸で囲む)
//   (6) 狭い: 今までの木(.pane-2 が無い・タイルを押すと個体詳細の画面と「< 一覧」)/ 広い ↔ 狭いで開いていたリードを捨てない
// 期待値の文言・数(リードの番号・枚数)は見本のデータから手で書いた。定数から逆算しない。
// 【守っていないもの】実寸(ペインの幅・ボタンの位置・タイルの大きさ)と、指での横スワイプ(jsdom は配置もタッチも無い)。
//   どちらも headless Chrome で実測した(報告の表)。右ペインの data-noswipe は (1) で在ることだけ見る。
// ------------------------------------------------------------------

const W = 820; const H = 1180;
let fake; let host; let mod; let root; let realRect; let wideNow; const listeners = new Set();

async function loadApp(idb) {
  vi.resetModules();
  globalThis.indexedDB = idb;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("./App.jsx");
  return { React, act: React.act, createRoot, App: App.default, openIdb: App.openIdb, WIDE_LAYOUT_QUERY: App.WIDE_LAYOUT_QUERY };
}
// WIDE_LAYOUT_QUERY にだけ wideNow を返す。ほかの問い合わせ(prefers-reduced-motion など)は false。
function installMatchMedia() {
  listeners.clear();
  window.matchMedia = (q) => ({
    media: q,
    get matches() { return q === mod.WIDE_LAYOUT_QUERY ? wideNow : false; },
    addEventListener: (type, fn) => { if (q === mod.WIDE_LAYOUT_QUERY && type === "change") listeners.add(fn); },
    removeEventListener: (type, fn) => { if (q === mod.WIDE_LAYOUT_QUERY && type === "change") listeners.delete(fn); },
    addListener: () => {}, removeListener: () => {},
  });
}
async function setWide(v) {
  wideNow = v;
  await mod.act(async () => { for (const fn of [...listeners]) fn({ matches: v }); });
}
const kv = (key) => fake._peek("windToneLabDB", "kv")?.get(key);
async function seed(kvEntries) {
  const db = await mod.openIdb();
  db.close?.();
  for (const [k, v] of Object.entries(kvEntries)) fake._peek("windToneLabDB", "kv").set(k, structuredClone(v));
}
async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = mod.createRoot(host);
  await mod.act(async () => { root.render(mod.React.createElement(mod.App)); });
}
const tick = (ms = 10) => mod.act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function waitFor(pred, label, deadline = 10000) {
  const end = Date.now() + deadline;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label}`);
    await tick();
  }
}
const click = (el) => mod.act(async () => { el.click(); });
const nav = (label) => document.querySelector(`[data-bottom-nav] button[aria-label="${label}"]`) || document.querySelector(`button[aria-label="${label}"]`);
const panes = () => [...document.querySelectorAll(".pane-2")];
const leftPane = () => panes()[0]?.children[0] ?? null;
const rightPane = () => panes()[0]?.children[1] ?? null;
const tiles = () => [...document.querySelectorAll(".reedtile")];
const tileByNo = (n) => tiles().find((t) => t.getAttribute("aria-label") === `${n}枚目`);
const numberInput = () => document.querySelector('input[aria-label="番号"]');
const backButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "< 一覧") ?? null;
const plusBtn = () => document.querySelector('button[aria-label="リードを追加"]');
const measureBtn = () => document.querySelector('button[aria-label="このリードで計測する"]');
const coachTargets = () => [...document.querySelectorAll('[data-coach="reedsMeasure"]')];
const layerId = () => document.querySelector("[data-coach-layer]")?.getAttribute("data-coach-layer") ?? null;
const subTab = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === label && !b.closest('[role="radiogroup"]'));
const saxChip = (label) => [...document.querySelectorAll('[role="radiogroup"][aria-label="楽器種別"] [role="radio"]')].find((b) => b.textContent === label);
// タイルを押して離す(タップ)。押下はマスの包み(タイルの親)が受ける。
async function tapTile(n) {
  const cell = tileByNo(n).parentElement;
  await mod.act(async () => {
    cell.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 200, button: 0 }));
    cell.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 40, clientY: 200, button: 0 }));
  });
}
// 長押し(REED_DRAG_LONGPRESS_MS = 400 より長く押してから離す)。
async function longPressTile(n) {
  const cell = tileByNo(n).parentElement;
  await mod.act(async () => { cell.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 200, button: 0 })); });
  await tick(520);
  await mod.act(async () => { window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 40, clientY: 200, button: 0 })); });
  await tick(400);
}

// 見本: A.Sax の箱(3枚)と T.Sax の箱(1枚)。
const REED = (id, n, saxType, strength = 3) => ({ id, brand: "Vandoren", model: null, strength, startDate: "2026-10-01", saxType, boxLabel: null, rating: null, thickness: null, balance: null, createdAt: `2026-10-01T09:00:0${n}.000Z`, sortOrder: n });
const REEDS = [REED("a1", 1, "alto"), REED("a2", 2, "alto"), REED("a3", 3, "alto"), REED("t1", 1, "tenor", 2.5)];
// はじめの一手は全部済み(案内を出さない)。(5) だけ reedsMeasure を外す。
const DONE = { migrated: true, migratedMeasureSteps: true, measure: true, reeds: true, reedsMeasure: true, join: true, adoptAverage: true, tuner: true, metronome: true, dataSeen: true };

beforeEach(() => {
  fake = createFakeIndexedDb();
  window.localStorage.clear();
  wideNow = true;
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = vi.fn();
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  realRect = window.Element.prototype.getBoundingClientRect;
  // はじめの一手の的だけ、820×1180 の headless Chrome の実測に近い矩形を返す(それ以外は jsdom の既定 0)。
  window.Element.prototype.getBoundingClientRect = function () {
    const box = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
    if (this.classList?.contains("coach-card")) return box(90, 0, 640, 146);
    const c = this.getAttribute?.("data-coach");
    if (c === "reedsMeasure" && this.classList?.contains("reedtile")) return box(14, 170, 69.2, 69.2);
    if (c === "reedsMeasure") return box(750, 1065, 56, 56);
    if (c === "reeds") return box(344, 1065, 56, 56);
    return box(0, 0, 0, 0);
  };
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  window.Element.prototype.getBoundingClientRect = realRect;
  delete window.matchMedia;
});

async function startOnReeds({ done = DONE, selectedReedId = null, wide = true } = {}) {
  mod = await loadApp(fake);
  wideNow = wide;
  installMatchMedia();
  await seed({ reeds: REEDS, onboardingDone: done, ...(selectedReedId ? { selectedReedId } : {}) });
  await render();
  await waitFor(() => nav("リード"), "下部タブ");
  await click(nav("リード"));
  await waitFor(() => tiles().length > 0, "リードの一覧");
}

describe("便BU: 広い(iPad)のリードタブは2ペイン", () => {
  it("(1) 形: .pane-2 が1つ・左 = 罫の一覧・右 = カード + data-noswipe。選んでいなければ右は空の1行・戻るは無い", async () => {
    await startOnReeds();
    expect(panes()).toHaveLength(1);
    expect(panes()[0].children).toHaveLength(2);
    expect(leftPane().className).toBe("surf-rule");
    expect(rightPane().className).toBe("surf-card");
    // 【便BV3 2026-10-04】登録(2ペイン)を表に出している間は高さ固定の枠(.pane-frame)。左右がそれぞれ自分でスクロールする
    expect(panes()[0].closest(".pane-frame")).toBeTruthy();
    expect(panes()[0].parentElement.style.height).toBe("100%");
    expect(rightPane().hasAttribute("data-noswipe")).toBe(true);
    // 左に A.Sax の3枚(T.Sax の箱は出ない)。右は空の1行
    expect(leftPane().querySelectorAll(".reedtile")).toHaveLength(3);
    expect(rightPane().textContent).toBe("リードを選ぶと、ここに詳細が表示されます");
    expect(numberInput()).toBe(null);
    expect(backButton()).toBe(null);
    // 作法は兄弟(入れ子にしない)
    expect(leftPane().querySelector(".surf-card")).toBe(null);
    expect(rightPane().querySelector(".surf-rule")).toBe(null);
    expect(plusBtn()).toBeTruthy();
    expect(measureBtn()).toBe(null);
  }, 30000);

  it("(1) 最初に右に出るのは計測タブで選んでいるリード(A.Sax の2枚目)", async () => {
    await startOnReeds({ selectedReedId: "a2" });
    await waitFor(() => numberInput(), "右ペインの個体詳細");
    expect(rightPane().contains(numberInput())).toBe(true);
    expect(numberInput().value).toBe("2");
    expect(backButton()).toBe(null);
    expect(measureBtn()).toBeTruthy();
  }, 30000);

  it("(2) タイルを押すと右の中身が替わるだけ(一覧は残る・< 一覧 は無い・スクロールしない)", async () => {
    await startOnReeds({ selectedReedId: "a2" });
    await waitFor(() => numberInput()?.value === "2", "右に 2枚目");
    window.scrollTo.mockClear();
    await tapTile(3);
    await waitFor(() => numberInput()?.value === "3", "右に 3枚目");
    expect(panes()).toHaveLength(1);
    expect(leftPane().querySelectorAll(".reedtile")).toHaveLength(3);
    expect(backButton()).toBe(null);
    await tapTile(1);
    await waitFor(() => numberInput()?.value === "1", "右に 1枚目");
    expect(document.querySelectorAll('input[aria-label="番号"]')).toHaveLength(1);
    await tick(50);
    expect(window.scrollTo).not.toHaveBeenCalled();
  }, 30000);

  it("(3) ＋ は左ペイン・計測は右ペインの面を名乗る / 比較を見ている間は2つとも描かない / 楽器を替えると右は空", async () => {
    await startOnReeds();
    await tapTile(2);
    await waitFor(() => measureBtn(), "計測");
    // 浮かせるボタンは body へ portal(ペインの中には居ない)。右端の式は面ごと(値は pitch-test の BU.6 が見る)
    expect(plusBtn().parentElement).toBe(document.body);
    expect(measureBtn().parentElement).toBe(document.body);
    const rightOf = (b) => b.getAttribute("style").match(/right: ([^;]+);/)?.[1] ?? "";
    expect(rightOf(plusBtn())).toContain("50%");
    expect(rightOf(measureBtn())).toContain("--pane-max-w");
    expect(rightOf(plusBtn())).not.toBe(rightOf(measureBtn()));
    // 比較へ: ＋ も計測も描かない(SwipePager は隣のページを描いたまま)
    await click(subTab("比較"));
    await waitFor(() => !measureBtn() && !plusBtn(), "比較では浮かせるボタンが無い");
    expect(panes()).toHaveLength(1);   // 2ペインのページは描いたまま(隣のページ)
    await click(subTab("登録"));
    await waitFor(() => measureBtn() && plusBtn(), "登録に戻ると2つとも出る");
    expect(numberInput().value).toBe("2");
    // 楽器のチップを T.Sax へ: 2枚目(A.Sax)は外れて右は空。A.Sax に戻すと押したリードが戻る
    await click(saxChip("T.Sax"));
    await waitFor(() => rightPane().textContent === "リードを選ぶと、ここに詳細が表示されます", "T.Sax で右は空");
    expect(measureBtn()).toBe(null);
    expect(leftPane().querySelectorAll(".reedtile")).toHaveLength(1);
    await click(saxChip("A.Sax"));
    await waitFor(() => numberInput()?.value === "2", "A.Sax に戻すと 2枚目");
  }, 30000);

  it("(4) 右ペインの中のシート(評価のダイヤル)が開く(body へ portal)", async () => {
    await startOnReeds({ selectedReedId: "a1" });
    await waitFor(() => numberInput(), "右ペインの個体詳細");
    const score = [...rightPane().querySelectorAll("button")].find((b) => /・評価を編集$/.test(b.getAttribute("aria-label") || ""));
    expect(score).toBeTruthy();
    await click(score);
    await waitFor(() => document.querySelector('[role="dialog"][aria-label="評価を編集"]'), "評価のシート");
    const dlg = document.querySelector('[role="dialog"][aria-label="評価を編集"]');
    expect(panes()[0].contains(dlg)).toBe(false);
    expect(document.body.contains(dlg)).toBe(true);
  }, 30000);

  it("(4) 長押しで編集中: 右ペインはそのまま・右ペインを押しても終わらない・タイルを押すと番号のシート・「完了」で抜ける", async () => {
    await startOnReeds({ selectedReedId: "a1" });
    await waitFor(() => numberInput()?.value === "1", "右に 1枚目");
    await longPressTile(2);
    await waitFor(() => tiles().every((t) => t.getAttribute("data-editing") === "true"), "編集中(揺れる)");
    expect(subTab("完了")).toBeTruthy();
    expect(numberInput().value).toBe("1");   // 右ペインはそのまま
    // 右ペイン(個体詳細の見出しの文字)を押しても編集は終わらない
    await click(rightPane().querySelector("span"));
    await tick(50);
    expect(tiles().every((t) => t.getAttribute("data-editing") === "true")).toBe(true);
    // 揺れている間にタイルを押す → 番号のシート(右の中身は替えない)
    await tapTile(3);
    await waitFor(() => document.querySelector('[role="dialog"][aria-label="リード番号を変更"]'), "番号のシート");
    expect(numberInput().value).toBe("1");
    await mod.act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await waitFor(() => !document.querySelector('[role="dialog"][aria-label="リード番号を変更"]'), "シートを閉じる");
    await click(subTab("完了"));
    await waitFor(() => tiles().every((t) => t.getAttribute("data-editing") === "false"), "編集を抜ける");
  }, 30000);

  it("(5) はじめの一手(リード2)の的は常に1つ以下: 右が空 → 先頭のタイル / 右にリード → 右の計測(丸)/ 比較 → 0", async () => {
    const { reedsMeasure, ...notYet } = DONE;
    expect(reedsMeasure).toBe(true);
    await startOnReeds({ done: notYet });
    // 右が空: 的は先頭の箱の先頭のタイル1つ
    expect(coachTargets()).toHaveLength(1);
    expect(coachTargets()[0].classList.contains("reedtile")).toBe(true);
    await waitFor(() => layerId() === "reedsMeasure", "リード2の案内(タイル)");
    expect(document.querySelector(".coach-hole").style.borderRadius).toBe("var(--r-2)");
    // タイルを押す → 右にリード。的は右の「計測」だけ(タイルは名乗らない)
    await tapTile(1);
    await waitFor(() => measureBtn(), "右の計測");
    expect(coachTargets()).toEqual([measureBtn()]);
    await waitFor(() => document.querySelector(".coach-hole")?.style.borderRadius === "50%", "的が右の計測へ移る");
    expect(layerId()).toBe("reedsMeasure");
    // 比較: 計測は描かれず、タイルも名乗らない(右にリードが出ているため)
    await click(subTab("比較"));
    await waitFor(() => !measureBtn(), "比較");
    expect(coachTargets().length).toBeLessThanOrEqual(1);
    expect(coachTargets()).toHaveLength(0);
  }, 30000);
});

describe("便BU: 狭い(iPhone)は今までの木。広い ↔ 狭いで開いていたリードを捨てない", () => {
  it("(6) 狭い: .pane-2 は無い・タイルを押すと個体詳細の画面(< 一覧)・一覧は消える", async () => {
    await startOnReeds({ wide: false });
    expect(panes()).toHaveLength(0);
    expect(document.querySelector(".surf-rule .reedtile")).toBeTruthy();
    await tapTile(2);
    await waitFor(() => backButton(), "個体詳細の画面");
    expect(numberInput().value).toBe("2");
    expect(tiles()).toHaveLength(0);
    expect(document.querySelector(".surf-card").contains(numberInput())).toBe(true);
  }, 30000);

  it("(6) 広い木で押したリードは、狭い木では個体詳細の画面として出て、広い木へ戻すと右ペインへ戻る", async () => {
    await startOnReeds();
    await tapTile(3);
    await waitFor(() => numberInput()?.value === "3", "右に 3枚目");
    await setWide(false);
    await waitFor(() => backButton(), "狭い木の個体詳細");
    expect(panes()).toHaveLength(0);
    expect(numberInput().value).toBe("3");
    await setWide(true);
    await waitFor(() => panes().length === 1, "広い木に戻る");
    expect(numberInput().value).toBe("3");
    expect(backButton()).toBe(null);
    expect(leftPane().querySelectorAll(".reedtile")).toHaveLength(3);
  }, 30000);
});

describe("便BV3: 右に出しているリードを一覧で目立たせる(本人裁定)・比較では枠を外す", () => {
  const current = () => [...document.querySelectorAll('.reedtile[aria-current="true"]')];
  it("(7) 計測タブで選んでいるリード(右の初期)のタイルに枠。押すと移る。楽器を替えて右が空になると消える。編集中も枠は残る", async () => {
    await startOnReeds({ selectedReedId: "a2" });
    await waitFor(() => numberInput()?.value === "2", "右に 2枚目");
    expect(current()).toEqual([tileByNo(2)]);
    expect(tileByNo(2).getAttribute("data-pane-current")).toBe("true");
    await tapTile(3);
    await waitFor(() => numberInput()?.value === "3", "右に 3枚目");
    expect(current()).toEqual([tileByNo(3)]);
    expect(tileByNo(2).hasAttribute("data-pane-current")).toBe(false);
    await longPressTile(1);
    await waitFor(() => tiles().every((t) => t.getAttribute("data-editing") === "true"), "編集中");
    expect(current()).toEqual([tileByNo(3)]);
    await click(subTab("完了"));
    await waitFor(() => tiles().every((t) => t.getAttribute("data-editing") === "false"), "編集を抜ける");
    await click(saxChip("T.Sax"));
    await waitFor(() => rightPane().textContent === "リードを選ぶと、ここに詳細が表示されます", "T.Sax で右は空");
    expect(current()).toHaveLength(0);
  }, 30000);

  it("(7) 比較(列)では枠(.pane-frame)が外れる・狭い(iPhone)では枠もタイルの印も無い", async () => {
    await startOnReeds({ selectedReedId: "a1" });
    await waitFor(() => numberInput(), "右ペイン");
    await click(subTab("比較"));
    await waitFor(() => !document.querySelector(".pane-frame"), "比較では枠が外れる");
    await click(subTab("登録"));
    await waitFor(() => document.querySelector(".pane-frame"), "登録では枠が付く");
  }, 30000);

  it("(7) 狭い(iPhone): 枠もタイルの印も無い", async () => {
    await startOnReeds({ wide: false, selectedReedId: "a1" });
    expect(document.querySelector(".pane-frame")).toBe(null);
    expect(document.querySelectorAll("[data-pane-current], [aria-current]")).toHaveLength(0);
  }, 30000);
});
