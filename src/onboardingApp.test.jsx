// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便BP 2026-10-03 本人裁定】はじめの一手の**アプリへの配線**。本物のアプリ(WindToneLabPhaseMode)を描いて確かめる。
//   ・入れたての人: データタブで出る / 計測タブはマイクが無い(jsdom)ので出ない
//   ・リードを登録した成功の道で印が立ち、この端末の保存(kv)とアカウント引継の書き出しに入る。
//     箱を消しても印は戻らない(案内も戻らない)。追加のシートが開いている間は出ない
//   ・既にある人の移行: 計測・リード・リードの紐づいた計測・取り込んだ目安で済みになる(参加は決めない)
//   ・移行は読み込みを待つ(計測の読み込みが済むまで判定も書き込みもしない)
//   ・印そのものが読めない起動では、案内を出さず、印も書かない
//   ・計測を消して起動し直しても、計測の印は戻らない
// 起動ごとに保存の写し(persistedStateCache)が残らないよう、各検査は vi.resetModules でアプリを読み直す。
// IndexedDB は作り物(fakeIndexedDb.testutil.js)。的の矩形は 375×812 の実測と同じ値を返す(jsdom は配置を計算しない)。
// 【守っていないもの】録音して保存する道・取り込みの道を画面から押すこと(jsdom にマイクも音声の復号も無い)。
//   その2つは下の「配線の綴り」で、印を立てる呼び出しが保存の呼び出しの**隣**にあることを見る(罠2)。
//   計測タブで案内が出ること自体は headless Chrome(偽のマイク)で実測した(報告の表)。
// ------------------------------------------------------------------

const W = 375; const H = 812;
let fake; let host; let mod; let root; let realRect;

// 作り物の IndexedDB を包んで、(a) kv の1つの鍵の読みだけを失敗させる (b) 計測の読み込みを門で止める。
function wrapIdb(inner, { failKvKey = null, sessionsGate = null } = {}) {
  const wrapDb = (db) => ({
    objectStoreNames: db.objectStoreNames,
    createObjectStore: (...a) => db.createObjectStore(...a),
    close: () => {},
    transaction(names, mode) {
      const tx = db.transaction(names, mode);
      const orig = tx.objectStore;
      tx.objectStore = (n) => {
        const st = orig(n);
        if (n === "kv" && failKvKey) {
          return { ...st, get: (k) => {
            if (k !== failKvKey) return st.get(k);
            const r = { result: undefined, error: new Error("読めない(検査)"), onsuccess: null, onerror: null };
            setTimeout(() => r.onerror?.(), 0);
            return r;
          } };
        }
        if (n === "sessions" && sessionsGate) {
          return { ...st, getAll: () => {
            const r = { result: undefined, error: null, onsuccess: null, onerror: null };
            const q = st.getAll();
            q.onsuccess = () => { sessionsGate.then(() => { r.result = q.result; r.onsuccess?.(); }); };
            q.onerror = () => { r.error = q.error; r.onerror?.(); };
            return r;
          } };
        }
        return st;
      };
      return tx;
    },
  });
  return {
    open(name, v) {
      const q = inner.open(name, v);
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      q.onupgradeneeded = () => { req.result = q.result; req.onupgradeneeded?.(); };
      q.onsuccess = () => { req.result = wrapDb(q.result); req.onsuccess?.(); };
      q.onerror = () => { req.error = q.error; req.onerror?.(); };
      return req;
    },
  };
}

async function loadApp(idb) {
  vi.resetModules();
  globalThis.indexedDB = idb;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("./App.jsx");
  const local = await import("./backup/localStore.js");
  const snap = await import("./backup/snapshot.js");
  return { React, act: React.act, createRoot, App: App.default, openIdb: App.openIdb, readAll: local.readAll, buildSnapshot: snap.buildSnapshot };
}
const kv = (key) => fake._peek("windToneLabDB", "kv")?.get(key);
async function seed({ kvEntries = {}, sessions = [] } = {}) {
  const db = await mod.openIdb();   // ストアを作る(App と同じ onupgradeneeded)
  db.close?.();
  for (const [k, v] of Object.entries(kvEntries)) fake._peek("windToneLabDB", "kv").set(k, structuredClone(v));
  for (const s of sessions) fake._peek("windToneLabDB", "sessions").set(s.id, structuredClone(s));
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
const layer = () => document.querySelector("[data-coach-layer]");
const layerId = () => layer()?.getAttribute("data-coach-layer") ?? null;
const nav = (label) => document.querySelector(`button[aria-label="${label}"]`);
const click = (el) => mod.act(async () => { el.click(); });
// 【便BR 2026-10-03 本人指示】登録のシートは、リードが1枚も無い人には銘柄を入れずに開く(「追加」は押せない)。
// 1箱目を登録する検査は、押す前に**以前の既定と同じ銘柄**(Vandoren Traditional)を検索欄から選ぶ。
// 2箱目以降は前の箱の値が入って開くので要らない。案内の判定・期待値は1つも変えていない。
async function pickFirstReed() {
  const input = document.querySelector('[role="dialog"] input[aria-label="リードを検索"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await mod.act(async () => { setter.call(input, "Traditional"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === "Vandoren Traditional"));
}

beforeEach(() => {
  fake = createFakeIndexedDb();
  // 【便BQ】見本の「済んだ」は localStorage に残るので、検査ごとに空にする(前の検査の見本を持ち越さない)
  window.localStorage.clear();
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = () => {};
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  realRect = window.Element.prototype.getBoundingClientRect;
  // 的の矩形(375×812 の headless Chrome の実測値)。それ以外は jsdom の既定(0)のまま。
  window.Element.prototype.getBoundingClientRect = function () {
    const box = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
    if (this.classList?.contains("coach-card")) return box(22, 0, W - 44, 146);
    const c = this.getAttribute?.("data-coach");
    if (c === "measure") return box(153.5, 616, 68, 68);
    if (c === "reeds") return box(305, 697, 56, 56);
    // 【便BP2】リード2: 一覧の先頭のタイル / 個体詳細の計測ボタン(375×812 の実測と同じ値)
    if (c === "reedsMeasure" && this.classList?.contains("reedtile")) return box(14, 170.5, 59.4, 59.4);
    if (c === "reedsMeasure") return box(305, 697, 56, 56);
    if (this.tagName?.toLowerCase() === "svg" && this.parentElement?.getAttribute("data-coach") === "nav-measure") return box(46.88, 773, 30, 30);
    return box(0, 0, 0, 0);
  };
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  window.Element.prototype.getBoundingClientRect = realRect;
});

const SESSION = (id, reedId = null) => ({ id, recordedAt: "2026-10-01T10:00:00.000Z", saxType: "alto", reedId, linkedAt: reedId ? "eager" : null, memo: null, performer: "自分", source: "live", frames: [], barlines: [], noteEvents: [] });
const REED = { id: "r1", brand: "Vandoren", model: null, strength: 3, startDate: "2026-10-01", saxType: "alto", boxLabel: null, rating: null, thickness: null, balance: null, createdAt: "2026-10-01T09:00:00.000Z" };

describe("入れたての人", () => {
  it("移行が済むとデータタブで出る(的は下部タブの「計測」)。計測タブはマイクが無いので出ない(許可されなかったとき)", async () => {
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    expect(kv("onboardingDone")).toEqual({ migrated: true });
    // 計測タブ(起動直後): マイクが取れず(jsdom)、エラーの案内が出る。はじめの一手は出ない
    await waitFor(() => document.querySelector('[role="dialog"][aria-label="エラー"]'), "マイクのエラー");
    await tick(80);
    expect(layer()).toBe(null);
    // データタブ: 出る(同じ作りで出せる対照)
    await click(nav("データ"));
    await waitFor(() => layerId() === "data", "データタブの案内");
    // 読み上げは常に在る role=status(便BP3)。見た目のカードは同じ文を持つ
    expect(document.querySelector("[data-coach-live]").textContent).toBe("計測を始めると、ここに貯まります。計測タブから計測してみよう");
    expect(layer().querySelector(".coach-title").textContent + layer().querySelector(".coach-line").textContent).toBe("計測を始めると、ここに貯まります計測タブから計測してみよう");
    // 下部タブも含めて覆う(重なり順 55 > 下部タブ 30)。穴は「計測」の絵柄(30)を直径 52 で囲む
    expect(Number(layer().style.zIndex)).toBeGreaterThan(30);
    const hole = layer().querySelector(".coach-hole");
    expect([hole.style.width, hole.style.height]).toEqual(["52px", "52px"]);
    // 下部タブの「計測」は暗幕の上からでも押せる → 計測タブへ移る(案内は消える。マイクが無いので計測タブには出ない)
    await click(nav("計測"));
    await tick(50);
    expect(layer()).toBe(null);
  }, 30000);
});

// 【便BQ 2026-10-03 本人の実機指示「他のところタップで案内は消えるようにして」】アプリの中で確かめる。
describe("外を押したら消える(この起動の間だけ・印は立てない)", () => {
  it("データタブの案内で外を押すと消え、下へは届かない。タブを行き来しても出ない。開き直すとまた出る", async () => {
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    await click(nav("データ"));
    await waitFor(() => layerId() === "data", "データタブの案内");
    // 画面の上のほう(子タブ「分析」などがある所)は受け「上」が覆う。押すと消えるだけ
    const subBefore = [...document.querySelectorAll("button")].find((b) => b.textContent === "分析");
    expect(subBefore).toBeTruthy();
    await click(layer().querySelector('[data-coach-hit="t"]'));
    expect(layer()).toBe(null);
    expect(kv("onboardingDone")).toEqual({ migrated: true });      // 印は立てない
    // タブを行き来しても、この起動の間は出ない
    await click(nav("リード"));
    await waitFor(() => layerId() === "reeds", "リードタブの案内(別の一手は出る)");
    await click(nav("データ"));
    await tick(400);
    expect(layer()).toBe(null);
    // 開き直す → まだ済んでいないので、また出る
    await mod.act(async () => root.unmount()); root = null; host.remove();
    mod = await loadApp(fake);
    await render();
    await click(nav("データ"));
    await waitFor(() => layerId() === "data", "開き直すとまた出る");
  }, 40000);
});

describe("リードの登録(成功の道で印が立つ)", () => {
  it("登録で印が立ち、保存と引継の書き出しに入る / シートの間は出ない / 箱を消しても戻らない", async () => {
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    await click(nav("リード"));
    await waitFor(() => layerId() === "reeds", "リードタブの案内");
    expect(layer().querySelector(".coach-title").textContent).toBe("使っているリードを登録しよう");
    expect(layer().querySelector(".coach-line").textContent).toBe("計測に登録したリードを紐づけることができます");   // 【便BQ】
    // 右下の ＋(案内の的)を押す → 追加のシート(BottomSheet)が開いている間は出ない
    await click(document.querySelector('button[aria-label="リードを追加"]'));
    await waitFor(() => document.querySelector('[role="dialog"].sheet-scrim'), "追加のシート");
    await tick(50);
    expect(layer()).toBe(null);
    expect(kv("onboardingDone").reeds).toBeUndefined();   // 開いただけでは立たない
    // 追加 → 印が立つ
    await pickFirstReed();   // 【便BR】1箱目は銘柄を選んでから
    const add =[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "追加");
    await click(add);
    await waitFor(() => kv("onboardingDone")?.reeds === true, "リードの印");
    expect(kv("reeds")).toHaveLength(10);
    // 【便BP2】登録が済むと、同じ一覧で「このリードで計測」へ進む(的は先頭の箱の先頭のタイル)
    await waitFor(() => layerId() === "reedsMeasure", "リード2の案内");
    // アカウント引継の書き出し(readAll → buildSnapshot → JSON)に入る
    const snap = JSON.parse(JSON.stringify(mod.buildSnapshot(await mod.readAll())));
    expect(snap.kv.onboardingDone).toEqual({ migrated: true, reeds: true });
    // 箱を消す(箱の編集 → 削除)。リードは0枚になるが、印は戻らない・案内も戻らない
    await click(document.querySelector('button[aria-label$="のメーカーと番手を編集"]'));
    await waitFor(() => [...document.querySelectorAll('[role="dialog"] button')].some((b) => b.textContent.trim() === "削除"), "箱の編集");
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "削除"));
    await waitFor(() => Array.isArray(kv("reeds")) && kv("reeds").length === 0, "箱が消える");
    await tick(80);
    expect(kv("onboardingDone")).toEqual({ migrated: true, reeds: true });
    expect(layer()).toBe(null);   // リードの案内は戻らない(済み)・リード2は的(タイル)が無いので出ない
  }, 30000);

  // 【便BP2 2026-10-03 統括の裁定】リード2は2つの画面をまたいで同じ一手を案内する。
  it("リード2: 一覧の先頭のタイル → 押して個体詳細 → 詳細の計測ボタン(丸)へ的が移る → 押すと計測タブへ・そのリードが選ばれる", async () => {
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    await click(nav("リード"));
    await click(document.querySelector('button[aria-label="リードを追加"]'));
    await waitFor(() => document.querySelector('[role="dialog"].sheet-scrim'), "追加のシート");
    await pickFirstReed();   // 【便BR】1箱目は銘柄を選んでから
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "追加"));
    await waitFor(() => layerId() === "reedsMeasure", "一覧のリード2");
    // もう1箱(番手 4.0)足す。箱が2つでも、的を名乗るのは**先頭の箱**の先頭のタイルだけ
    await click(document.querySelector('button[aria-label="リードを追加"]'));
    await waitFor(() => document.querySelector('[role="dialog"].sheet-scrim'), "追加のシート(2箱目)");
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "4.0"));
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "追加"));
    await waitFor(() => Array.isArray(kv("reeds")) && kv("reeds").length === 20, "2箱目の保存");
    await waitFor(() => layerId() === "reedsMeasure", "一覧のリード2(2箱)");
    // 的を名乗るのは先頭の箱の先頭のタイルだけ(20枚のうち1枚)。見た目のクラス・style は他のタイルと同じ
    const tiles = [...document.querySelectorAll(".reedtile")];
    expect(tiles).toHaveLength(20);
    const named = tiles.filter((t) => t.getAttribute("data-coach") === "reedsMeasure");
    expect(named).toEqual([tiles[0]]);
    expect(tiles[0].getAttribute("style")).toBe(tiles[1].getAttribute("style"));
    expect(tiles[0].className).toBe(tiles[1].className);
    let hole = layer().querySelector(".coach-hole");
    expect(hole.style.borderRadius).toBe("var(--r-2)");
    expect(layer().querySelector(".coach-title").textContent).toBe("このリードで計測してみよう");
    // 押したタイル = 先頭の箱(見出しの番手で引く)の1枚目(#1/10)。そのリードが選ばれること
    const headStrength = /^\S+ (\S+) のメーカーと番手を編集$/.exec(document.querySelector('button[aria-label$="のメーカーと番手を編集"]')?.getAttribute("aria-label") ?? "")?.[1];
    const firstId = kv("reeds").find((r) => String(r.strength) === headStrength && r.boxLabel === "#1/10")?.id;
    expect(firstId, "先頭の箱の1枚目").toBeTruthy();
    // タイルを押す(押して離す = タップ)→ 個体詳細
    const cell = tiles[0].parentElement;
    await mod.act(async () => {
      cell.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 200, button: 0 }));
      cell.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 40, clientY: 200, button: 0 }));
    });
    const measureBtn = () => document.querySelector('button[aria-label="このリードで計測する"]');
    await waitFor(() => measureBtn(), "個体詳細");
    await waitFor(() => layer()?.querySelector(".coach-hole")?.style.borderRadius === "50%", "詳細の計測ボタンへ移る");
    expect(layerId()).toBe("reedsMeasure");
    expect(layer().getAttribute("data-leaving")).toBe("false");   // 済んでいない(同じ一手のまま)
    expect(measureBtn().getAttribute("data-coach")).toBe("reedsMeasure");
    hole = layer().querySelector(".coach-hole");
    expect([hole.style.left, hole.style.top, hole.style.width, hole.style.height]).toEqual(["301px", "693px", "64px", "64px"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("このリードで計測してみよう");
    // 押す → 計測タブへ移り、そのリードが選ばれる(既存の onMeasure の動き)。印はまだ立たない(計測を保存していない)
    await click(measureBtn());
    await waitFor(() => document.querySelector('[data-coach="measure"]'), "計測タブ");
    await waitFor(() => kv("selectedReedId") === firstId, "そのリードが選ばれる");
    expect(kv("onboardingDone").reedsMeasure).toBeUndefined();
    // 計測タブではリード2は出ない(計測の案内の番。jsdom はマイクが無いのでエラーの暗幕が出て、それも出ない)
    await tick(80);
    expect(layerId()).not.toBe("reedsMeasure");
  }, 30000);
});

describe("既にある人の移行", () => {
  it("計測・リード・リードの紐づいた計測・取り込んだ目安があれば済みにする(参加は決めない)。案内は出ない", async () => {
    mod = await loadApp(fake);
    await seed({
      kvEntries: { reeds: [REED], idealProfiles: [{ id: "p1", name: "しろねこ さんの目安", sourceKind: "community", saxType: "alto", notes: {} }] },
      sessions: [SESSION("s1"), SESSION("s2", "r1")],
    });
    await render();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    // 【便BQ】取り込んだのは人物の目安だけ → 何も立てない(openPerson は外した。adoptAverage はみんなの平均の目安があるときだけ)
    expect(kv("onboardingDone")).toEqual({ measure: true, reeds: true, reedsMeasure: true, migrated: true });
    await click(nav("データ"));
    await tick(80);
    expect(layer()).toBe(null);
    await click(nav("リード"));
    await tick(80);
    expect(layer()).toBe(null);
  }, 30000);

  it("計測の読み込みが済むまで判定しない(書き込みも案内もしない)。済んだら判定する", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const idb = wrapIdb(fake, { sessionsGate: gate });
    mod = await loadApp(idb);
    await seed({ sessions: [SESSION("s1")] });
    await render();
    await click(nav("データ"));
    await tick(150);
    expect(kv("onboardingDone")).toBeUndefined();   // まだ判定していない
    expect(layer()).toBe(null);                     // 移行の前は出さない(既に使っている人に一瞬出さない)
    release();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    expect(kv("onboardingDone")).toEqual({ measure: true, migrated: true });
    await tick(80);
    expect(layer()).toBe(null);                     // 計測があるのでデータタブの案内は出ない
  }, 30000);

  it("印そのものが読めない起動では、案内を出さず、印も書かない(読めていない値で上書きしない)", async () => {
    const idb = wrapIdb(fake, { failKvKey: "onboardingDone" });
    mod = await loadApp(idb);
    await seed({ kvEntries: { onboardingDone: { migrated: true } } });   // 本当は「何も済んでいない人」
    await render();
    await click(nav("データ"));
    await tick(300);
    expect(layer()).toBe(null);
    expect(kv("onboardingDone")).toEqual({ migrated: true });   // 書き換わっていない
    // リードを登録しても印は書かない(初期値 {} に足した物で保存を上書きしない)
    await click(nav("リード"));
    await click(document.querySelector('button[aria-label="リードを追加"]'));
    await waitFor(() => document.querySelector('[role="dialog"].sheet-scrim'), "追加のシート");
    await pickFirstReed();   // 【便BR】1箱目は銘柄を選んでから
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "追加"));
    await waitFor(() => Array.isArray(kv("reeds")) && kv("reeds").length === 10, "リードの保存");
    await tick(80);
    expect(kv("onboardingDone")).toEqual({ migrated: true });
  }, 30000);

  // 【便BP3 R13】移行の門。リード・目安のどちらかが読めない起動では判定しない(読めていない [] で「無い人」と決めない)。
  for (const key of ["reeds", "idealProfiles"]) {
    it(`移行の門: ${key} が読めない起動では移行しない(印は書かない・案内も出さない)`, async () => {
      const idb = wrapIdb(fake, { failKvKey: key });
      mod = await loadApp(idb);
      await seed({ kvEntries: { reeds: [REED] }, sessions: [SESSION("s1")] });
      await render();
      await click(nav("データ"));
      // 計測の読み込みが済んだ(画面に1件と出た)ことを確かめてから、さらに待つ(門が無ければこの間に移行が書く)
      await waitFor(() => document.body.textContent.includes("すべての計測 1件"), "計測の読み込み");
      await tick(400);
      expect(kv("onboardingDone")).toBeUndefined();
      expect(layer()).toBe(null);
    }, 30000);
  }

  it("計測を消して起動し直しても、計測の印は戻らない(数を数えて決めない)", async () => {
    mod = await loadApp(fake);
    await seed({ sessions: [SESSION("s1")] });
    await render();
    await waitFor(() => kv("onboardingDone")?.measure === true, "計測の印");
    await mod.act(async () => root.unmount());
    root = null;
    host.remove();
    // 計測を全部消す(保存の中身から)→ 起動し直す
    fake._peek("windToneLabDB", "sessions").clear();
    mod = await loadApp(fake);
    await render();
    await click(nav("データ"));
    await tick(150);
    expect(fake._peek("windToneLabDB", "sessions").size).toBe(0);
    expect(kv("onboardingDone")).toEqual({ measure: true, migrated: true });
    expect(layer()).toBe(null);
  }, 30000);
});

// ------------------------------------------------------------------
// 配線の綴り(画面から押せない2つの道と、出す条件)。**呼び出しの隣**を錨にする(罠2)。
// ------------------------------------------------------------------
describe("配線の綴り(App.jsx)", () => {
  const app = readFileSync(join(process.cwd(), "src", "App.jsx"), "utf8").replace(/\r\n/g, "\n");
  it("録音の保存: addSession(pendingSession) の直後に印を立てる", () => {
    expect(app).toMatch(/addSession\(pendingSession\);\n\s*\/\/ 【便BP】[^\n]*\n\s*markSessionSaved\(pendingSession\);/);
  });
  it("取り込みの保存: addSession(session) の直後に印を立てる", () => {
    expect(app).toMatch(/addSession\(session\);\n\s*\/\/ 【便BP】[^\n]*\n\s*markSessionSaved\(session\);/);
  });
  it("みんなの平均の取り込み: announce(みんなの平均だけが渡す)で成功したときに印を立てる", () => {
    expect(app).toMatch(/setSelectedIdealId\(r\.profile\.id\);[\s\S]{0,600}?if \(announce\) markOnboarding\("adoptAverage"\);\n\s*return \{ ok: true \};/);
  });
  it("出す条件: マイクの許可(isListening かつエラー無し)・録音中でない・シートが開いていない・移行が済んでいる", () => {
    const call = app.slice(app.indexOf("<OnboardingCoach"), app.indexOf("/>", app.indexOf("<OnboardingCoach")));
    expect(call).toMatch(/candidates=\{coachReady && !isRecording/);
    expect(call).toMatch(/micReady: isListening && !errorMsg/);
    // 【便BP2】BottomSheet 以外の z60 の暗幕(エラー・保存の確認)が出ている間も出さない
    // 【便BP3】録音ファイルの取り込みを解析している間も出さない。見本では読み込みを待たない(coachReady)
    expect(call).toMatch(/hidden=\{!coachReady \|\| isRecording \|\| anySheetOpen \|\| errorScrimShown \|\| saveConfirmShown \|\| isAnalyzingUpload\}/);
    expect(app).toMatch(/const coachReady = tutorialPreview \|\| onboardingReady;/);
    expect(app).toMatch(/const onboardingReady = onboardingLoaded && onboardingReadOk && onboardingDone\.migrated;/);
    expect(app).toMatch(/const anySheetOpen = useAnyBottomSheetOpen\(\);/);
  });
  it("後から紐づけた計測(計測の詳細でリードを付け直す)でも reedsMeasure を立てる(便BP3)", () => {
    expect(app).toMatch(/linkedAt: reedId \? "retroactive" : null \} : s\)\)\);\n\s*\/\/ 【便BP3[^\n]*\n\s*if \(reedId\) onReedLinked\?\.\(\);/);
    expect(app).toMatch(/onReedLinked=\{props\.onReedLinked\}/);
    expect(app).toMatch(/onReedLinked=\{\(\) => markOnboarding\("reedsMeasure"\)\}/);
  });
  it("z60 の暗幕の式は、描く側の式と同じ(エラーの暗幕 / 「この録音を保存しますか？」)", () => {
    // エラーの暗幕を描く条件(JSX)と、隠す条件の式が同じ綴りであること
    const renderCond = /\{errorMsg && \((topTab === "measure" \|\| \(topTab === "analysis" && !ERROR_MEASURE_ONLY\.includes\(errorMsg\)\))\) && \(/.exec(app);
    expect(renderCond, "エラーの暗幕を描く条件").not.toBe(null);
    const hideCond = /const errorScrimShown = Boolean\(errorMsg && \((.*)\)\);/.exec(app);
    expect(hideCond, "隠す条件").not.toBe(null);
    expect(hideCond[1]).toBe(renderCond[1]);
    // 保存の確認を描く条件(MeasureView)と、隠す条件
    expect(app).toMatch(/\{!isRecording && pendingSession && \(\s*<div\s+role="dialog" aria-modal="true" aria-label="この録音を保存しますか？"/);
    expect(app).toMatch(/const saveConfirmShown = topTab === "measure" && Boolean\(!isRecording && pendingSession\);/);
    // z60 の暗幕を持つのは BottomSheet・エラー・保存の確認の3つだけ(4つ目が増えたらここで気づく)
    expect((app.match(/zIndex: 60, background: "rgba\(15,23,42,0\.28\)"/g) || []).length).toBe(3);
  });
});

// ------------------------------------------------------------------
// 【便BP3 2026-10-03 本人の依頼】見本(?tutorialpreview=1 を覚えた端末)。<html> の印を付けてからアプリを読む。
// ------------------------------------------------------------------
describe("見本(全部の一手を「まだ」として出す・本物の印は書かない)", () => {
  const ALL_DONE = { measure: true, reeds: true, reedsMeasure: true, join: true, openPerson: true, adoptAverage: true, migrated: true };
  afterEach(() => { document.documentElement.removeAttribute("data-tutorial-preview"); });
  it("保存してある印(全部済み)を無視して出す。済ませた一手はその場で消え、段の順を守る。保存の印は書き換えない", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: ALL_DONE, reeds: [REED] }, sessions: [SESSION("s1", "r1")] });
    await render();
    // データタブ: 計測が済んでいても、見本では出る
    await click(nav("データ"));
    await waitFor(() => layerId() === "data", "見本のデータタブ");
    // リードタブ: リードを持っていても、見本では＋(リード1)から
    await click(nav("リード"));
    await waitFor(() => layerId() === "reeds", "見本のリード1");
    await click(document.querySelector('button[aria-label="リードを追加"]'));
    await waitFor(() => document.querySelector('[role="dialog"].sheet-scrim'), "追加のシート");
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "追加"));
    // 見本の中でリード1を済ませたので、リード2(先頭のタイル)へ進む
    await waitFor(() => layerId() === "reedsMeasure", "見本のリード2");
    // 本物の印は1つも書き換わっていない(移行も走っていない)
    await tick(100);
    expect(kv("onboardingDone")).toEqual(ALL_DONE);
    expect(kv("reeds").length).toBe(11);   // リードそのものは本物に足される(見本は案内だけ)
  }, 30000);
  // 【便BP5 2026-10-03 統括の裁定 2(P1)】保存の印を「何も済んでいない」から始め、見本の中で一手を済ませても kv が動かないこと。
  // 対照として先に、見本でない起動で同じ手順を踏むと kv に印が立つことを確かめる(同じ待ち方)。
  async function registerOneBox() {
    await click(nav("リード"));
    await waitFor(() => layerId() === "reeds", "リード1");
    await click(document.querySelector('button[aria-label="リードを追加"]'));
    await waitFor(() => document.querySelector('[role="dialog"].sheet-scrim'), "追加のシート");
    await pickFirstReed();   // 【便BR】1箱目は銘柄を選んでから
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "追加"));
    await waitFor(() => layerId() === "reedsMeasure", "リード2へ進む");
    await waitFor(() => Array.isArray(kv("reeds")) && kv("reeds").length === 10, "リードの保存");
    await tick(400);
  }
  it("P1: 印が「何も済んでいない」人でも、見本の中で済ませた一手は本物の印に書かない(対照: 見本でなければ書く)", async () => {
    // 対照(見本でない起動)
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { migrated: true } } });
    await render();
    await registerOneBox();
    expect(kv("onboardingDone")).toEqual({ migrated: true, reeds: true });
    await mod.act(async () => root.unmount());
    root = null; host.remove();
    // 見本の起動(新しい保存で同じ手順・同じ待ち方)
    fake = createFakeIndexedDb();
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { migrated: true } } });
    await render();
    await registerOneBox();
    expect(kv("onboardingDone")).toEqual({ migrated: true });
  }, 40000);
  // 【便BP5 2026-10-03 統括の裁定 2(P2)】見本でない起動では移行が書かれる(対照)。同じ待ち方で、見本では書かれない。
  async function launchAndSettle() {
    await render();
    await click(nav("データ"));
    await waitFor(() => document.body.textContent.includes("すべての計測 1件"), "計測の読み込み");
    await tick(400);
  }
  it("P2: 移行の前の人(印が無い)の保存に、見本は移行を書かない(対照: 見本でなければ書く)", async () => {
    mod = await loadApp(fake);
    await seed({ sessions: [SESSION("s1")] });
    await launchAndSettle();
    expect(kv("onboardingDone")).toEqual({ measure: true, migrated: true });
    await mod.act(async () => root.unmount());
    root = null; host.remove();
    fake = createFakeIndexedDb();
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp(fake);
    await seed({ sessions: [SESSION("s1")] });
    await launchAndSettle();
    expect(layerId()).toBe("data");   // 見本なので計測があっても出ている
    expect(kv("onboardingDone")).toBeUndefined();
  }, 40000);
});

// 【便BQ 2026-10-03 統括の裁定】見本の「済んだ」は localStorage の見本専用の鍵に残る(開き直しても済ませた一手は出ない)。
describe("見本の「済んだ」は開き直しても残る / =1 で最初から / 本物の印は書かない", () => {
  afterEach(() => { document.documentElement.removeAttribute("data-tutorial-preview"); });
  it("見本でリードを登録 → 開き直してもリード1は出ずリード2から。=1 を付けて開くとリード1から。本物の印は {migrated:true} のまま", async () => {
    const { applyTutorialPreview } = await import("./tutorialPreview.js");
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { migrated: true } } });
    await render();
    await click(nav("リード"));
    await waitFor(() => layerId() === "reeds", "見本のリード1");
    await click(document.querySelector('button[aria-label="リードを追加"]'));
    await waitFor(() => document.querySelector('[role="dialog"].sheet-scrim'), "追加のシート");
    await pickFirstReed();   // 【便BR】1箱目は銘柄を選んでから
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "追加"));
    await waitFor(() => layerId() === "reedsMeasure", "見本のリード2");
    await tick(200);
    expect(JSON.parse(window.localStorage.getItem("ficus.tutorialPreviewDone"))).toMatchObject({ reeds: true });
    expect(kv("onboardingDone")).toEqual({ migrated: true });
    // 開き直す(見本のまま)
    await mod.act(async () => root.unmount()); root = null; host.remove();
    mod = await loadApp(fake);
    await render();
    await click(nav("リード"));
    await waitFor(() => layerId() === "reedsMeasure", "開き直してもリード2から");
    // ?tutorialpreview=1 を付けて開き直す → 見本の済んだは空になり、リード1から
    await mod.act(async () => root.unmount()); root = null; host.remove();
    applyTutorialPreview({ location: { pathname: "/", search: "?tutorialpreview=1", hash: "" }, history: { state: null, replaceState() {} }, storage: window.localStorage, doc: document });
    expect(window.localStorage.getItem("ficus.tutorialPreviewDone")).toBe(null);
    mod = await loadApp(fake);
    await render();
    await click(nav("リード"));
    await waitFor(() => layerId() === "reeds", "=1 でリード1から");
    expect(kv("onboardingDone")).toEqual({ migrated: true });
  }, 40000);
  it("見本でない起動では見本の鍵を読みも書きもしない", async () => {
    window.localStorage.setItem("ficus.tutorialPreviewDone", JSON.stringify({ measure: true, reeds: true, migrated: true }));
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    await click(nav("リード"));
    await waitFor(() => layerId() === "reeds", "本物の印でリード1(見本の済んだは見ない)");
    expect(JSON.parse(window.localStorage.getItem("ficus.tutorialPreviewDone"))).toEqual({ measure: true, reeds: true, migrated: true });
  }, 30000);
});

describe("リードの一覧が揺れている間(編集中)は的を名乗らない(便BP3)", () => {
  it("長押しで揺れたら案内が消え、「完了」は暗幕の下に入らない。完了で戻る", async () => {
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    await click(nav("リード"));
    await click(document.querySelector('button[aria-label="リードを追加"]'));
    await waitFor(() => document.querySelector('[role="dialog"].sheet-scrim'), "追加のシート");
    await pickFirstReed();   // 【便BR】1箱目は銘柄を選んでから
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "追加"));
    await waitFor(() => layerId() === "reedsMeasure", "リード2");
    // 2枚目のタイルを長押し(400ms)→ 編集中(揺れる)
    const cell = document.querySelectorAll(".reedtile")[1].parentElement;
    await mod.act(async () => { cell.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 120, clientY: 200, button: 0 })); });
    await tick(450);
    await mod.act(async () => { window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 120, clientY: 200 })); });
    await waitFor(() => document.querySelector('.reedtile[data-editing="true"]'), "編集中");
    await tick(80);
    expect(document.querySelectorAll('[data-coach="reedsMeasure"]')).toHaveLength(0);
    expect(document.querySelector('[data-coach="reeds"]')).toBe(null);
    expect(layer()).toBe(null);
    const done = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "完了");
    expect(done, "完了").toBeTruthy();
    await click(done);
    await waitFor(() => layerId() === "reedsMeasure", "完了で戻る");
  }, 30000);
});
