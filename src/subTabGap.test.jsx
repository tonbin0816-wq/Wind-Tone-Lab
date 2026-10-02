// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ------------------------------------------------------------------
// 【便BN 2026-10-02 本人指示】「コミュニティタブだけ、タブと楽器やジャンルなどのボタンの幅が広いですよね?
// 他のリードタブ・データタブと揃えて詰めてください」(幅 = 縦の間隔)。
// アプリ全体(App.jsx の既定の書き出し)を描き、下部タブで リード → データ → コミュニティ(参加済み)を行き来して、
// 子タブの行(SubTabs。選んでいる字が --fs-xl の行)のまわりの**縦の余白を、描いた DOM から足し算で出す**。
//   ・上端: .app-root の中身の上端 → 子タブの行の上端 … 3つのタブで同じ
//   ・下: 子タブの行の下端 → ページの先頭の上端
//       データ・順位・シェア(先頭は条件の行) … リードタブ(子タブの行 → 楽器の行)と同じ
//       マイページ(先頭はアイコン)           … データタブ(子タブの行 → My Data の累計のカード)と同じ
// 期待値は**定数から引かない**。比べる相手(リード・データ)の値も、その場で描いた DOM から同じ足し算で出す。
// だから、リードかデータの余白が動けば、コミュニティの側が追いつくまでここが落ちる(片方だけ直す変異が通らない)。
//
// 足し算の中身: 子タブの行の margin-bottom + 親の行の間の gap(grid か縦の flex のときだけ)
//   + 先頭の塊までの各段の margin-top / border-top / padding-top。値は index.css の規則(el.matches で当たるもの)と
//   インラインの style から読み、var(--sp-*) は index.css の :root から解く。解けない値・先頭でない子を通る道は
//   黙って0にせず**投げる**(足し算の前提が崩れたら落ちる)。
// 【守っていないもの】実寸(jsdom は配置を計算しない。字の高さ・ピルの当たり44の中の見えるピルの位置)。
//   375×812 の実測(子タブの行の上端 4・下端 48 → 条件の行 48 / マイページ 56 など)は報告に書いた。
//   参加前の画面(JoinIntro)と編集のフォーム(ProfileForm)は子タブの行の下に居ないので、ここでは見ない。
// ------------------------------------------------------------------

const KEYS = [14, 16, 18, 20, 22];
const NICK = { u1: "しろねこ", u2: "くろねこ", u3: "みけねこ", u4: "とらねこ" };
const SERVER_USERS = Object.entries(NICK).map(([uid, nickname], i) => ({
  uid, nickname, icon: "ic-cat", iconColor: i + 1, photo: null, isPublic: true,
  saxTypes: ["alto"], gear: { alto: {} }, position: "学生", genres: ["クラシック"], ensembles: [],
  stats: { daysAll: 10 + i, secAll: 3600 + i },
}));
const SERVER_IDEALS = Object.keys(NICK).map((uid, i) => ({
  id: `${uid}_alto`, ownerUid: uid, saxType: "alto", sourceSessionCount: 3,
  notes: Object.fromEntries(KEYS.map((k, j) => [k, { spectralCentroidHz: 1400 + i * 30 + j * 20, hnrDb: 16 + j, pitchCentsSigned: 4 - j * 3 }])),
}));
const MY_PROFILE = {
  nickname: "じぶん", icon: "ic-dog", iconColor: 5, saxTypes: ["alto"], gear: { alto: {} },
  position: "社会人", startYear: 2015, genres: ["ジャズ"], ensembles: ["ソロ"], isPublic: true,
};

// サーバーには繋がない(読み書きの関数だけ作り物にする)。参加済みの人として描く。
vi.mock("./community/accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => "me"),
  loadProfile: vi.fn(async () => MY_PROFILE),
  watchMyPhoto: vi.fn(() => () => {}),
}));
vi.mock("./community/directory.js", async (orig) => ({
  ...(await orig()), listPublicUsers: vi.fn(async () => SERVER_USERS), publishStats: vi.fn(async () => {}),
}));
vi.mock("./community/idealRepo.js", async (orig) => ({
  ...(await orig()), listIdeals: vi.fn(async () => SERVER_IDEALS),
  publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}),
}));
vi.mock("./community/reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));

const { default: App } = await import("./App.jsx");

// ---- index.css を読む(:root の変数と、規則の一覧) -------------------------------------------
const CSS = readFileSync(join(process.cwd(), "src", "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const ROOT_VARS = (() => {
  const m = CSS.match(/:root\s*\{([^}]*)\}/);
  const out = {};
  for (const d of m[1].split(";")) {
    const i = d.indexOf(":");
    if (i > 0 && d.trim().startsWith("--")) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return out;
})();
// 素朴に「セレクタ { 宣言 }」を拾う(@media の中の規則も拾う = 余白を足す規則を見落とさない側に倒す)。
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sels: m[1].trim().split(",").map((s) => s.trim()).filter(Boolean), body: m[2] }))
  .filter((r) => !r.sels.some((s) => s.startsWith("@") || s.startsWith(":root")));

const splitTop = (v) => { // 括弧の外の空白で分ける
  const out = []; let depth = 0; let cur = "";
  for (const ch of v.trim()) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};
function px(v, where) {
  const s = String(v).trim();
  if (s === "0" || s === "0px" || s === "none" || s === "auto") return 0;
  let m = s.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (m) return Number(m[1]);
  m = s.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/);
  if (m) {
    if (ROOT_VARS[m[1]] !== undefined) return px(ROOT_VARS[m[1]], where);
    if (m[2] !== undefined) return px(m[2], where);
  }
  m = s.match(/^calc\(-1 \* (.+)\)$/);
  if (m) return -px(m[1], where);
  throw new Error(`解けない長さ: ${s}(${where})`);
}
// 宣言の並び(index.css の当たる規則 → インライン)を順に当てて、縦の余白だけを持つ。
function vertical(el) {
  const st = { mt: "0", mb: "0", pt: "0", pb: "0", bt: "0", display: "", dir: "", rowGap: "0", position: "" };
  const apply = (prop, val) => {
    const p = prop.trim().toLowerCase(); const v = val.replace(/!important/, "").trim();
    const four = (vals) => { const t = splitTop(vals); return { top: t[0], bottom: t[t.length === 1 ? 0 : 2] ?? t[0] }; };
    if (p === "margin") { const f = four(v); st.mt = f.top; st.mb = f.bottom; }
    else if (p === "margin-top") st.mt = v;
    else if (p === "margin-bottom") st.mb = v;
    else if (p === "padding") { const f = four(v); st.pt = f.top; st.pb = f.bottom; }
    else if (p === "padding-top") st.pt = v;
    else if (p === "padding-bottom") st.pb = v;
    else if (p === "border" || p === "border-top") { const t = splitTop(v); st.bt = t.find((x) => /^(\d|var|calc)/.test(x)) ?? (v === "0" ? "0" : (/none/.test(v) ? "0" : "1px")); }
    else if (p === "border-top-width") st.bt = v;
    else if (p === "display") st.display = v;
    else if (p === "flex-direction") st.dir = v;
    else if (p === "gap") st.rowGap = splitTop(v)[0];
    else if (p === "row-gap") st.rowGap = v;
    else if (p === "position") st.position = v;
  };
  const decls = (body) => body.split(";").map((d) => { const i = d.indexOf(":"); return i > 0 ? [d.slice(0, i), d.slice(i + 1)] : null; }).filter(Boolean);
  for (const r of RULES) {
    let hit = false;
    for (const s of r.sels) { try { if (el.matches(s)) hit = true; } catch { /* 擬似要素など jsdom が読めないもの */ } }
    if (hit) for (const [p, v] of decls(r.body)) apply(p, v);
  }
  for (const [p, v] of decls(el.getAttribute("style") || "")) apply(p, v);
  return st;
}
// 流れの外: <style> などの表示されない要素(UA の display: none)・絶対配置・display: none
const outOfFlow = (el) => { if (["STYLE", "SCRIPT", "TEMPLATE"].includes(el.tagName)) return true; const v = vertical(el); return v.position === "absolute" || v.position === "fixed" || v.display === "none"; };
const firstInFlowChild = (el) => [...el.children].find((c) => !outOfFlow(c)) ?? null;
// E から T まで「先頭の子」をたどって、上に積まれる余白を足す。先頭でない子を通る道は投げる。
function downTo(E, T, label) {
  const v = vertical(E);
  let s = px(v.mt, label);
  if (E === T) return s;
  s += px(v.bt, label) + px(v.pt, label);
  // 横並びの flex(横スワイプの track)では、どの子も上端は親の中身の上端にそろう ── T を持つ子へ降りる。
  // それ以外(block / grid / 縦の flex)は先頭の子だけ(前に兄がいれば、その高さぶん下がるので足し算が成り立たない)。
  const rowFlex = v.display === "flex" && !v.dir.startsWith("column");
  const c = rowFlex ? [...E.children].find((x) => !outOfFlow(x) && (x === T || x.contains(T))) ?? null : firstInFlowChild(E);
  if (!c || !(c === T || c.contains(T))) throw new Error(`${label}: 先頭の子を通らない道(${E.tagName}.${E.className})`);
  return s + downTo(c, T, label);
}
// 子タブの行の下端 → T の上端
function gapBelow(row, T, label) {
  const C = row.parentElement;
  if (!C.contains(T)) throw new Error(`${label}: 子タブの行の親が先頭の塊を持っていない`);
  let A = row.nextElementSibling;
  while (A && outOfFlow(A)) A = A.nextElementSibling;
  if (!A || !(A === T || A.contains(T))) throw new Error(`${label}: 子タブの行のすぐ下の塊が先頭の塊を持っていない`);
  const cv = vertical(C);
  const rowGap = cv.display === "grid" || (cv.display === "flex" && cv.dir.startsWith("column")) ? px(cv.rowGap, label) : 0;
  return px(vertical(row).mb, label) + rowGap + downTo(A, T, label);
}
// .app-root の中身の上端 → 子タブの行の上端(.app-root 自身の padding は measureTopPad.test.jsx が見ている)
const topOf = (row, label) => downTo(firstInFlowChild(appRoot()), row, label) ;

// ---- 描く・動かす ------------------------------------------------------------------------
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
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
async function waitFor(pred, label) {
  const end = Date.now() + 10000;
  while (!pred()) { if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label}`); await tick(); }
}
const go = async (label) => {
  const b = document.querySelector(`button[aria-label="${label}"]`);
  expect(b, label).toBeTruthy();
  await act(async () => { b.click(); });
};
// 子タブの行 = 選んでいる字が --fs-xl の aria-pressed のボタンを持つ行(App.jsx の SubTabs)
const subTabRow = () => {
  const rows = [...appRoot().querySelectorAll('button[aria-pressed="true"]')]
    .filter((b) => b.style.fontSize === "var(--fs-xl)").map((b) => b.parentElement);
  expect(rows.length, "子タブの行は1つ").toBe(1);
  return rows[0];
};
const subTab = async (row, text) => {
  const b = [...row.querySelectorAll("button")].find((x) => x.textContent.trim() === text);
  expect(b, text).toBeTruthy();
  await act(async () => { b.click(); });
};
// 横スワイプのページャで、いま出ているページ(transform の番号で決まる)の中の先頭の塊。
// ページャは4枚を同時に描くので、子タブの行の下の塊から「何番目のページか」をたどる。
const pageHead = (row, index) => {
  let pager = row.nextElementSibling;
  while (pager && outOfFlow(pager)) pager = pager.nextElementSibling;
  // pager → track → 各ページの包み → ページの根(.sans や style 付きの div) → 先頭の塊
  const track = firstInFlowChild(pager);
  const slot = [...track.children][index];
  expect(slot, `ページ ${index}`).toBeTruthy();
  let pageRoot = firstInFlowChild(slot);
  return { slot, pageRoot, head: firstInFlowChild(pageRoot) };
};

describe("子タブの行のまわりの縦の余白は、コミュニティもリード・データと同じ(便BN 本人指示)", () => {
  it("上端・子タブの行の下 → 条件の行/アイコン が、比べる相手と同じ値", { timeout: 30000 }, async () => {
    await act(async () => { root.render(<App />); });

    // リード: 子タブの行 → 楽器の行(当たり 44 の A.Sax のボタンを持つ行)
    await go("リード");
    const reedRow = subTabRow();
    const reedSax = [...appRoot().querySelectorAll("button")].find((b) => b.textContent.trim() === "A.Sax");
    expect(reedSax, "リードの楽器の行").toBeTruthy();
    const reed = { top: topOf(reedRow, "リード 上端"), below: gapBelow(reedRow, reedSax.parentElement, "リード 下") };

    // データ(My Data): 子タブの行 → 累計のカード
    await go("データ");
    const dataRow = subTabRow();
    const card = [...appRoot().querySelectorAll("button.card")].find((b) => b.textContent.startsWith("累計"));
    expect(card, "My Data の累計のカード").toBeTruthy();
    const data = { top: topOf(dataRow, "データ 上端"), below: gapBelow(dataRow, card, "データ 下") };

    // 前提: 足し算は「0 しか返さない」ものではない(データの下は正の値・リードとは違う値)
    expect(data.below).toBeGreaterThan(0);
    expect(data.below).not.toBe(reed.below);

    // コミュニティ(参加済み)
    await go("コミュニティ");
    await waitFor(() => document.body.textContent.includes("マイページ") && document.body.textContent.includes("目安を公開している"), "コミュニティの4ページ");
    const commRow = subTabRow();
    const labels = ["データ", "順位", "シェア", "マイページ"];
    const got = {};
    for (const [i, label] of labels.entries()) {
      await subTab(commRow, label);
      const { head } = pageHead(commRow, i);
      expect(head, `${label} の先頭`).toBeTruthy();
      got[label] = { top: topOf(commRow, `コミュニティ ${label} 上端`), below: gapBelow(commRow, head, `コミュニティ ${label} 下`) };
    }
    // 先頭の塊が期待どおりのものか(条件の行 = 楽器のピルを持つ / マイページ = アイコンの円を持つ)
    expect(pageHead(commRow, 0).head.textContent).toContain("A.Sax");
    expect(pageHead(commRow, 1).head.textContent).toContain("楽器");
    expect(pageHead(commRow, 2).head.textContent).toContain("A.Sax");
    expect(pageHead(commRow, 3).head.querySelector('button[aria-label="アイコンを変更"], button[aria-label="写真を大きく表示"]')).toBeTruthy();

    // 上端: 3つのタブで同じ
    expect(data.top, "データの上端 = リードの上端").toBe(reed.top);
    for (const label of labels) expect(got[label].top, `コミュニティ ${label} の上端 = リードの上端`).toBe(reed.top);
    // 下: 条件の行の3ページはリードと、マイページはデータ(My Data)と同じ
    for (const label of ["データ", "順位", "シェア"]) expect(got[label].below, `コミュニティ ${label}: 子タブの行 → 条件の行 = リードの 子タブの行 → 楽器の行`).toBe(reed.below);
    expect(got["マイページ"].below, "コミュニティ マイページ: 子タブの行 → アイコン = データの 子タブの行 → 累計のカード").toBe(data.below);
  });
});
