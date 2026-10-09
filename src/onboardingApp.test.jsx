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
// 【便BS 2026-10-03 本人裁定】移行の結果に計測タブの3段の移行の印(migratedMeasureSteps)が加わり、計測があれば tuner・metronome も立つ。
//   データタブは計測があるとき「ここに貯まります」(dataSeen)が出る(既存の人にも1回)。それに合わせて期待値を直した(各所に【便BS】)。
// 【便BW 2026-10-06 凍結仕様 coach2-spec.md】一本の流れに作り直した。移行の結果に3つ目の門の印(migratedCoach2)が加わり、
//   計測がある人には新しい8つの印も立つ(新しい段は0枚)。リードタブへ移ると goReeds が立つ。dataSeen の段・dataSeenDeferred は無くなった
//   (データタブは ⑫ 日のマス → ⑬ 記録の行 → ⑭ 音の傾向)。それに合わせて期待値を直し(各所に【便BW】)、流れの検査を下に足した。
//   計測の日はカレンダーの「表示中の月」に要るので、計測の日時はいま(SESSION の NOW_ISO)にした。
// 【便BX 2026-10-06 本人の決定・凍結仕様 coach3-spec.md】リード・データ(計測あり)・コミュニティ(参加後)に着くと、先に到着カード(穴なし・
//   どこを押しても次へ)が出る。既存の「リードタブで ⑥」などの検査は、到着を1回押してから続けるように直した(passArrival。各所に【便BX】)。
//   移行の結果に4つ目の門の印(migratedCoach3)が加わり、計測がある人には新しい6つの印も立つ(新しい段は0枚)。
//   帯は「保存しました」の帯(coach: true)だけ ⑩ と同時に出す(hidden の式)。流れの検査を下の【便BX】の節に足した。
// 起動ごとに保存の写し(persistedStateCache)が残らないよう、各検査は vi.resetModules でアプリを読み直す。
// IndexedDB は作り物(fakeIndexedDb.testutil.js)。的の矩形は 375×812 の実測と同じ値を返す(jsdom は配置を計算しない)。
// 【守っていないもの】録音して保存する道・取り込みの道を画面から押すこと(jsdom にマイクも音声の復号も無い)。
//   その2つは下の「配線の綴り」で、印を立てる呼び出しが保存の呼び出しの**隣**にあることを見る(罠2)。
//   計測タブで案内が出ること自体は headless Chrome(偽のマイク)で実測した(報告の表)。
// ------------------------------------------------------------------

const W = 375; const H = 812;
let fake; let host; let mod; let root; let realRect; let realSIV;
// 【便BW】音の傾向カードの上端(初期は画面の外 = My Data の最下段)。scrollIntoView が呼ばれたら見える所(216)へ来る。
let trendTop = 1400;
// 【便BZ】① の環の箱(既定は 375×812 の実測)と、浮かせるボタンの矩形(既定は無し = 0。② の覆いの検査だけが置く)
let tunerBox = [14, 96, 347, 330];
let fabBox = null;
let scrollCalls = [];
// 【便BW】下部タブの絵柄の左端(375 の4つ。1つ (375 − 40) / 4 = 83.75 の中央に 30)
const NAV_SVG_X = { "nav-measure": 46.88, "nav-reeds": 130.6, "nav-community": 214.4, "nav-analysis": 298.1 };

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
// 【便BX】到着カード(穴なし)を押して次へ進む(印を立てる)。到着が出るのを待ち、受け(画面いっぱいの1枚)を押し、外れるまで待つ。
async function passArrival(id) {
  await waitFor(() => layerId() === id, `到着 ${id}`);
  expect(layer().querySelector(".coach-dim")).not.toBe(null);
  await click(layer().querySelector('[data-coach-hit="all"]'));
  await waitFor(() => layerId() !== id || layer()?.getAttribute("data-leaving") === "true", `到着 ${id} が済む`);
}
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
    // 【便BW】新しい的(375×812 の実測と同じ形の値)
    if (c === "metronome") return box(317, 30, 44, 44);
    if (c === "tuner") return box(...tunerBox);   // 【便BW 審査】①④ の的は環の箱(帯全体ではない)
    if (c === "metroTempo") return box(43.6, 470, 287.8, 57.6);
    if (c === "reedChip") return box(14, 46, 190, 30);
    if (c === "calendarDay") return box(66.5, 305, 34, 34);   // 【便BW 審査】⑫ の的はマスの中の丸(34)
    if (c === "daySession") return box(16, 560, 343, 50);
    if (c === "trend") return box(14, trendTop, 347, 380);
    const pc = this.tagName?.toLowerCase() === "svg" ? this.parentElement?.getAttribute("data-coach") : null;
    if (pc && pc in NAV_SVG_X) return box(NAV_SVG_X[pc], 767, 30, 30);
    // 【便BZ 統括の裁定】下部タブの的はボタンの箱(375×812・新しい下部タブの実測: 上端 760・高さ 44・1つ 83.75)
    if (c && c in NAV_SVG_X && this.tagName === "BUTTON") return box({ "nav-measure": 20, "nav-reeds": 103.75, "nav-community": 187.5, "nav-analysis": 271.25 }[c], 760, 83.75, 44);
    if (fabBox && this.hasAttribute?.("data-floating-action")) return box(...fabBox);
    return box(0, 0, 0, 0);
  };
  trendTop = 1400;
  tunerBox = [14, 96, 347, 330];
  fabBox = null;
  scrollCalls = [];
  realSIV = window.Element.prototype.scrollIntoView;
  window.Element.prototype.scrollIntoView = function (arg) {
    const c = this.getAttribute?.("data-coach") ?? null;
    scrollCalls.push([c, arg]);
    if (c === "trend") trendTop = 216;
  };
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  window.Element.prototype.getBoundingClientRect = realRect;
  window.Element.prototype.scrollIntoView = realSIV;
});

// 【便BW】計測の日時は「いま」(カレンダーは表示中の月の日だけを押せる。日付を固定すると月が替わった日に落ちる)
const NOW_ISO = new Date(Date.now() - 60 * 1000).toISOString();
const SESSION = (id, reedId = null) => ({ id, recordedAt: NOW_ISO, saxType: "alto", reedId, linkedAt: reedId ? "eager" : null, memo: null, performer: "自分", source: "live", frames: [], barlines: [], noteEvents: [] });
// 【便BW】門の印3つ(移行の結果にいつも付く)・計測がある人に立つ新しい8つ。【便BX】4つ目の門(migratedCoach3)も
// 【便BZ】5つ目の門(migratedCoach4)も
const GATES = { migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true };
// 【便BX】計測がある人に立つ新しい6つ(到着4つ・⑭'・⑰)
const NEW6 = { arriveReeds: true, arriveData: true, arriveCommunity: true, goCommunity: true, goMeasure: true, finish: true };
// 【便BW 審査】計測がある人には idealSeen も立つ(既存の利用者に新しい段0枚)。名前は前のまま
const NEW8 = { metroTempo: true, metroStart: true, goReeds: true, reedLinked: true, goData: true, calendarDay: true, daySession: true, trend: true, idealSeen: true };
const REED = { id: "r1", brand: "Vandoren", model: null, strength: 3, startDate: "2026-10-01", saxType: "alto", boxLabel: null, rating: null, thickness: null, balance: null, createdAt: "2026-10-01T09:00:00.000Z" };

describe("入れたての人", () => {
  it("移行が済むとデータタブで出る(的は下部タブの「計測」)。計測タブはマイクが無いので出ない(許可されなかったとき)", async () => {
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    expect(kv("onboardingDone")).toEqual(GATES);   // 【便BS】【便BW】門の印3つ
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
    expect([hole.style.width, hole.style.height, hole.style.borderRadius]).toEqual(["83.75px", "44px", "var(--r-2)"]);   // 【便BZ】ボタンの箱
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
    expect(kv("onboardingDone")).toEqual(GATES);      // 印は立てない(【便BS】【便BW】移行の印が加わった)
    // タブを行き来しても、この起動の間は出ない
    await click(nav("リード"));
    await waitFor(() => layerId() === "arriveReeds", "リードタブの案内(別の一手は出る。【便BX】到着)");
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
    await passArrival("arriveReeds");   // 【便BX】到着を押してから
    await waitFor(() => layerId() === "reeds", "リードタブの案内");
    expect(layer().querySelector(".coach-title").textContent).toBe("使っているリードを登録しよう");   // 【便BY】本人の指示で便BW の見出しに戻した
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
    expect(snap.kv.onboardingDone).toEqual({ ...GATES, goReeds: true, reeds: true, arriveReeds: true });   // 【便BS】【便BW】リードタブへ移ると goReeds。【便BX】到着
    // 箱を消す(箱の編集 → 削除)。リードは0枚になるが、印は戻らない・案内も戻らない
    await click(document.querySelector('button[aria-label$="のメーカーと番手を編集"]'));
    await waitFor(() => [...document.querySelectorAll('[role="dialog"] button')].some((b) => b.textContent.trim() === "削除"), "箱の編集");
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "削除"));
    await waitFor(() => Array.isArray(kv("reeds")) && kv("reeds").length === 0, "箱が消える");
    await tick(80);
    expect(kv("onboardingDone")).toEqual({ ...GATES, goReeds: true, reeds: true, arriveReeds: true });   // 【便BS】【便BW】【便BX】
    expect(layer()).toBe(null);   // リードの案内は戻らない(済み)・リード2は的(タイル)が無いので出ない
  }, 30000);

  // 【便BP2 2026-10-03 統括の裁定】リード2は2つの画面をまたいで同じ一手を案内する。
  it("リード2: 一覧の先頭のタイル → 押して個体詳細 → 詳細の計測ボタン(丸)へ的が移る → 押すと計測タブへ・そのリードが選ばれる", async () => {
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    await click(nav("リード"));
    await passArrival("arriveReeds");   // 【便BX】
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
  it("計測・リード・リードの紐づいた計測・取り込んだ目安があれば済みにする(参加は決めない)。【便BW】リードの案内もデータタブの段も出ない", async () => {
    mod = await loadApp(fake);
    await seed({
      kvEntries: { reeds: [REED], idealProfiles: [{ id: "p1", name: "しろねこ さんの目安", sourceKind: "community", saxType: "alto", notes: {} }] },
      sessions: [SESSION("s1"), SESSION("s2", "r1")],
    });
    await render();
    await waitFor(() => kv("onboardingDone")?.migratedCoach2 === true, "移行の印");
    // 【便BQ】取り込んだのは人物の目安だけ → 何も立てない(openPerson は外した。adoptAverage はみんなの平均の目安があるときだけ)
    // 【便BS】計測があるので計測タブの3段(tuner・metronome)も済み。dataSeen は移行で立てない
    // 【便BW 本人裁定(§14 の 2 = ア)】計測があるので新しい8つも済み(新しい段は0枚)。idealSeen は人物の目安だけなので立てない
    // 【便BX】計測があるので新しい6つも済み(到着も出ない)
    expect(kv("onboardingDone")).toEqual({ measure: true, reeds: true, reedsMeasure: true, tuner: true, metronome: true, ...NEW8, ...NEW6, goCompare: true, ...GATES });
    await click(nav("データ"));
    // 【便BW】データタブの ⑫⑬⑭ も出ない(便BS の「ここに貯まります」は段ごと無くなった)
    await waitFor(() => document.body.textContent.includes("すべての計測 2件"), "計測の読み込み");
    await tick(400);
    expect(layer()).toBe(null);
    expect(document.querySelector('[data-coach="calendarDay"]')).not.toBe(null);   // 的は在る(印で出していない)
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
    await waitFor(() => kv("onboardingDone")?.migratedCoach2 === true, "3つ目の門");
    await waitFor(() => kv("onboardingDone")?.migratedCoach3 === true, "4つ目の門");
    expect(kv("onboardingDone")).toEqual({ measure: true, tuner: true, metronome: true, ...NEW8, ...NEW6, goCompare: true, ...GATES });   // 【便BS】【便BW】【便BX】
    // 【便BW】計測があるので「計測を始めると」の段は出ず、新しいデータタブの段も移行で済んでいるので何も出ない
    await tick(400);
    expect(layer()).toBe(null);
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
    expect(kv("onboardingDone")).toEqual({ measure: true, tuner: true, metronome: true, ...NEW8, ...NEW6, goCompare: true, ...GATES });   // 【便BS】【便BW】【便BX】
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
    // 【便BZ】候補と帯の間の決まりは、描く直前の const coachWithNotice = coachDuringNotice({ … }) が持つ(<OnboardingCoach> はその2つを渡すだけ)
    const blk = (/const coachWithNotice = coachDuringNotice\(\{([\s\S]*?)\n  \}\);/.exec(app) || [])[1] || "";
    expect(call).toMatch(/candidates=\{coachWithNotice\.candidates\}/);
    expect(blk).toMatch(/candidates: coachReady && !isRecording/);
    expect(blk).toMatch(/micReady: isListening && !errorMsg/);
    expect(blk).toMatch(/\n\s*notice, topTab,$/);
    // 【便BP2】BottomSheet 以外の z60 の暗幕(エラー・保存の確認)が出ている間も出さない
    // 【便BP3】録音ファイルの取り込みを解析している間も出さない。見本では読み込みを待たない(coachReady)
    // 【便BS 審査 2026-10-03 統括の裁定】操作の合図の帯(notice)が出ている間も出さない(帯の「開く」を覆わない)
    // 【便BX 2026-10-06 本人の決定 C】例外は保存の帯(notice.coach)が出ている間の計測タブ(⑩)だけ
    // 【便BZ】帯の間の決まりは coachDuringNotice(onboarding.test.jsx が純関数を守る)。計測(保存の帯)の ⑩ は今までどおり
    expect(call).toMatch(/hidden=\{!coachReady \|\| isRecording \|\| anySheetOpen \|\| errorScrimShown \|\| saveConfirmShown \|\| isAnalyzingUpload \|\| coachWithNotice\.hidden\}/);
    expect(app).toMatch(/const coachReady = tutorialPreview \|\| onboardingReady;/);
    // 【便BS】計測タブの3段の移行の印も待つ。【便BW】3つ目の門(新しい段の移行)も待つ
    expect(app).toMatch(/const onboardingReady = onboardingLoaded && onboardingReadOk && onboardingDone\.migrated && onboardingDone\[MEASURE_STEPS_MIGRATED\] && onboardingDone\[COACH2_MIGRATED\] && onboardingDone\[COACH3_MIGRATED\]\n\s*&& onboardingDone\[COACH4_MIGRATED\];/);   // 【便BZ】5つ目の門
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
    // データタブ: 計測が済んでいても、見本では出る(【便BW】計測があるので ⑫ 日のマス。【便BX】その前に到着)
    await click(nav("データ"));
    await passArrival("arriveData");
    await waitFor(() => layerId() === "calendarDay", "見本のデータタブ");
    // リードタブ: リードを持っていても、見本では＋(リード1)から(【便BX】その前に到着)
    await click(nav("リード"));
    await passArrival("arriveReeds");
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
    await passArrival("arriveReeds");   // 【便BX】
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
    expect(kv("onboardingDone")).toEqual({ ...GATES, goReeds: true, reeds: true, arriveReeds: true });   // 【便BS】移行の印(便BP の移行を済ませた人にも1回)。【便BW】3つ目の門・リードタブへ移った goReeds。【便BX】4つ目の門・到着
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
    expect(kv("onboardingDone")).toEqual({ measure: true, tuner: true, metronome: true, ...NEW8, ...NEW6, goCompare: true, ...GATES });   // 【便BS】【便BW】【便BX】
    await mod.act(async () => root.unmount());
    root = null; host.remove();
    fake = createFakeIndexedDb();
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp(fake);
    await seed({ sessions: [SESSION("s1")] });
    await launchAndSettle();
    expect(layerId()).toBe("arriveData");   // 見本なので出ている(【便BW】計測があるので ⑫ 日のマス。【便BX】その前に到着)
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
    await passArrival("arriveReeds");   // 【便BX】
    await waitFor(() => layerId() === "reeds", "見本のリード1");
    await click(document.querySelector('button[aria-label="リードを追加"]'));
    await waitFor(() => document.querySelector('[role="dialog"].sheet-scrim'), "追加のシート");
    await pickFirstReed();   // 【便BR】1箱目は銘柄を選んでから
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "追加"));
    await waitFor(() => layerId() === "reedsMeasure", "見本のリード2");
    await tick(200);
    expect(JSON.parse(window.localStorage.getItem("ficus.tutorialPreviewDone"))).toMatchObject({ reeds: true, arriveReeds: true });
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
    await waitFor(() => layerId() === "arriveReeds", "=1 で最初から(【便BX】到着 → リード1)");
    await passArrival("arriveReeds");
    await waitFor(() => layerId() === "reeds", "=1 でリード1から");
    expect(kv("onboardingDone")).toEqual({ migrated: true });
  }, 40000);
  it("見本でない起動では見本の鍵を読みも書きもしない", async () => {
    window.localStorage.setItem("ficus.tutorialPreviewDone", JSON.stringify({ measure: true, reeds: true, migrated: true }));
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    await click(nav("リード"));
    await waitFor(() => layerId() === "arriveReeds", "本物の印で到着(見本の済んだは見ない)");
    expect(JSON.parse(window.localStorage.getItem("ficus.tutorialPreviewDone"))).toEqual({ measure: true, reeds: true, migrated: true });
  }, 30000);
});

describe("リードの一覧が揺れている間(編集中)は的を名乗らない(便BP3)", () => {
  it("長押しで揺れたら案内が消え、「完了」は暗幕の下に入らない。完了で戻る", async () => {
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    await click(nav("リード"));
    await passArrival("arriveReeds");   // 【便BX】
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

// ------------------------------------------------------------------
// 【便BS 2026-10-03 本人裁定(ficus-tutorial2.html)】計測タブの3段・データタブの計測があるときの段を、アプリの中で確かめる。
// 【守っていないもの】チューナーの段が出ること・音程が1秒続いて済むこと・3段が順に出ること(jsdom にマイクが無く、計測タブでは
//   エラーの暗幕が出るので案内は出ない)。済む条件の判定(useSustained)と出す順(coachCandidates)は onboarding.test.jsx、
//   配線は下の綴り、出ることそのものは headless Chrome(偽のマイク)で実測した(報告の表)。
// ------------------------------------------------------------------
describe("【便BS】計測タブ: メトロノームの面を開いたら印 metronome", () => {
  it("右上のメトロノームのボタンが的を名乗り、押して面を開くと kv に metronome が立つ(閉じても戻らない)", async () => {
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migratedMeasureSteps === true, "移行の印");
    const metro = () => document.querySelector('button[aria-label="メトロノーム"]');
    await waitFor(() => metro(), "計測タブ");
    expect(metro().getAttribute("data-coach")).toBe("metronome");
    expect(kv("onboardingDone").metronome).toBeUndefined();
    await click(metro());
    await waitFor(() => kv("onboardingDone")?.metronome === true, "メトロノームの印");
    expect(kv("onboardingDone").tuner).toBeUndefined();     // 他の段の印は立てない
    expect(kv("onboardingDone").measure).toBeUndefined();
    await click(metro());   // 閉じる
    await tick(80);
    expect(kv("onboardingDone").metronome).toBe(true);
  }, 30000);
  it("面を開いたまま保存されている人は、印が読めた時点で metronome が立つ", async () => {
    mod = await loadApp(fake);
    await seed({ kvEntries: { showMetroPanel: true } });
    await render();
    await waitFor(() => kv("onboardingDone")?.metronome === true, "メトロノームの印");
  }, 30000);
});

// ------------------------------------------------------------------
// 【便BW 2026-10-06 凍結仕様 §2.3 / §11.2】データタブ(計測がある): ⑫ 日のマス → ⑬ 記録の行 →(計測の詳細。案内は置かない)→ ⑭ 音の傾向。
// 便BS の「計測したデータがここに貯まります」(dataSeen・的なし)は段ごと無くなった。
// 印は門だけ済ませて保存しておく(移行で全部済みにならないよう、3つの門を立てた印を置く)。
// ------------------------------------------------------------------
// 【便BX】データタブの到着(arriveData)は済ませておく(⑫⑬⑭ の検査は今までどおり。到着は下の【便BX】の節)
const MEASURE_DONE = { ...GATES, measure: true, tuner: true, metronome: true, metroTempo: true, metroStart: true, goReeds: true, reedLinked: true, arriveData: true };
const backToList = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "< 一覧") ?? null;

describe("【便BW】データタブ: ⑫ 日のマス → ⑬ 記録の行 →(詳細)→ ⑭ 音の傾向", () => {
  it("今日のマスが名乗って ⑫。押すと calendarDay・マスは名乗らず先頭の行が ⑬。行を押すと詳細(案内なし)・daySession。戻ると ⑭(1回だけ送る)。押すと trend", async () => {
    mod = await loadApp(fake);
    // 2件目は前の日(月の初日なら前の月)。的になるのは**最新の**計測の日だけ
    const YESTERDAY_ISO = new Date(new Date(NOW_ISO).getTime() - 24 * 3600 * 1000).toISOString();
    await seed({ kvEntries: { onboardingDone: MEASURE_DONE }, sessions: [{ ...SESSION("s2"), recordedAt: YESTERDAY_ISO }, SESSION("s1")] });
    await render();
    await click(nav("データ"));
    await waitFor(() => layerId() === "calendarDay", "⑫ 日のマス");
    // 的は最新の計測の日のマス1つだけ(押せる日のボタン。見た目のクラス・style は他の日と同じ綴り)
    const cells = [...document.querySelectorAll('[data-coach="calendarDay"]')];
    expect(cells).toHaveLength(1);
    expect(cells[0].tagName).toBe("SPAN");   // 【便BW 審査】中の丸(34)が名乗る。押せる日のボタンの中
    expect(cells[0].closest("button").getAttribute("aria-label")).toBe(`${new Date(NOW_ISO).getDate()}日 計測1件`);
    expect(layer().querySelector(".coach-title").textContent).toBe("計測した日を押してみよう");
    expect(layer().querySelector(".coach-line")).toBe(null);
    await waitFor(() => kv("onboardingDone")?.goData === true, "goData の印(計測があるときにデータタブへ移った。⑩)");
    await click(cells[0]);
    await waitFor(() => kv("onboardingDone")?.calendarDay === true, "calendarDay の印");
    await waitFor(() => layerId() === "daySession", "⑬ 記録の行");
    expect(document.querySelectorAll('[data-coach="calendarDay"]')).toHaveLength(0);   // 開いている日は名乗らない
    const rows = [...document.querySelectorAll('[data-coach="daySession"]')];
    expect(rows).toHaveLength(1);                                                       // 先頭の1行だけ
    expect(rows[0].className).toBe("rowcard sans");
    expect(layer().querySelector(".coach-title").textContent).toBe("記録を開いてみよう");
    expect(kv("onboardingDone").daySession).toBeUndefined();
    await click(rows[0]);
    await waitFor(() => backToList(), "計測の詳細");
    await waitFor(() => kv("onboardingDone")?.daySession === true, "daySession の印");
    await tick(300);
    expect(layer()).toBe(null);                                                         // 詳細の中には出さない
    expect(scrollCalls).toEqual([]);
    await click(backToList());
    await waitFor(() => layerId() === "trend", "⑭ 音の傾向");
    expect(scrollCalls).toEqual([["trend", { block: "center", behavior: "auto" }]]);   // 画面の外だったので1回だけ送った
    expect(layer().querySelector(".coach-title").textContent).toBe("データが溜まると、平均がここにグラフで出ます");
    const hole = layer().querySelector(".coach-hole");
    expect([hole.style.left, hole.style.top, hole.style.width, hole.style.height]).toEqual(["14px", "216px", "347px", "380px"]);
    await click(layer().querySelector(".coach-card"));                                  // 押す=済
    await waitFor(() => kv("onboardingDone")?.trend === true, "trend の印");
    // 【便BX 本人の決定 C】⑭ を押すとすぐ ⑭'「みんなのデータも見てみよう」(下部タブ「コミュニティ」の絵柄・直径 52)
    await waitFor(() => layerId() === "goCommunity", "⑭' みんなのデータも見てみよう");
    expect(layer().querySelector(".coach-title").textContent).toBe("みんなのデータも見てみよう");
    expect(layer().querySelector(".coach-line")).toBe(null);
    const h14 = layer().querySelector(".coach-hole");
    expect([h14.style.left, h14.style.top, h14.style.width, h14.style.height, h14.style.borderRadius]).toEqual(["187.5px", "760px", "83.75px", "44px", "var(--r-2)"]);
    expect(scrollCalls).toHaveLength(1);
  }, 40000);

  it("⑫ で外を押すと、この起動ではデータタブの3段とも出ない(印は立てない)。日を開けば calendarDay は立つ。開き直すと ⑬ から", async () => {
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: MEASURE_DONE }, sessions: [SESSION("s1")] });
    await render();
    await click(nav("データ"));
    await waitFor(() => layerId() === "calendarDay", "⑫");
    await click(layer().querySelector('[data-coach-hit="t"]'));
    expect(layer()).toBe(null);
    // タブを行き来しても、この起動の間は出ない
    await click(nav("計測"));
    await click(nav("データ"));
    await tick(400);
    expect(layer()).toBe(null);
    expect(kv("onboardingDone").calendarDay).toBeUndefined();   // 印は立てない
    // 日を開いても ⑬ は出ない(群ごと消した)。日を開いたこと自体は ⑫ の成功の道なので印 calendarDay は立つ
    await click(document.querySelector('[data-coach="calendarDay"]'));
    await waitFor(() => kv("onboardingDone")?.calendarDay === true, "calendarDay の印");
    await tick(400);
    expect(layer()).toBe(null);
    expect(kv("onboardingDone").daySession).toBeUndefined();
    // 開き直す → まだ済んでいない ⑬ から(日を開けば出る)
    await mod.act(async () => root.unmount()); root = null; host.remove();
    mod = await loadApp(fake);
    await render();
    await click(nav("データ"));
    await waitFor(() => document.body.textContent.includes("すべての計測 1件"), "My Data");
    await tick(300);
    expect(layer()).toBe(null);   // ⑫ は済んでいる(マスは名乗るが出さない)
    const cell = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === `${new Date(NOW_ISO).getDate()}日 計測1件`);
    await click(cell);
    await waitFor(() => layerId() === "daySession", "開き直すと ⑬ が出る");
  }, 40000);

  it("計測が無ければ今までどおり「計測を始めると」の段(⑫ は出ない)", async () => {
    mod = await loadApp(fake);
    await render();
    await click(nav("データ"));
    await waitFor(() => layerId() === "data", "計測なしの段");
    expect(layer().querySelector(".coach-hole")).not.toBe(null);
    expect(document.querySelector('[data-coach="calendarDay"]')).toBe(null);
  }, 30000);
});

// ------------------------------------------------------------------
// 【便BS 審査 2026-10-03 統括の裁定】帯(ActionNotice。z50)が出ている間は案内を出さない(帯の「開く」「元に戻す」を覆わない)。
// 【便BW】「0件 → 1件の起動では dataSeen を次の起動へ回す」は dataSeen の段と一緒に外した(新しい流れでは ⑩ → ⑫ と続いてほしい)。
// 帯は5秒で溶けるが jsdom は animationend を出さないので、動きを減らす設定(帯も案内も溶けずにすぐ外れる)で描く。
// ------------------------------------------------------------------
function preferReducedMotion() {
  window.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}
const buttonText = (t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t) ?? null;
const buttonStarts = (t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(t)) ?? null;
const noticeText = () => document.querySelector(".action-notice")?.textContent ?? null;
// データタブの「すべての計測」→ 削除の入口 → 行を全部選ぶ → 削除(帯が出る)→ My Data へ戻る
async function deleteSessionsFromAllList(count) {
  await click(buttonStarts("すべての計測"));
  await waitFor(() => document.querySelector('button[aria-label="削除する計測を選ぶ"]'), "すべての計測");
  await click(document.querySelector('button[aria-label="削除する計測を選ぶ"]'));
  const rows = () => [...document.querySelectorAll(".slist-row")];
  await waitFor(() => rows().length >= count, "一覧の行");
  for (const r of rows().slice(0, count)) await click(r);
  await click(document.querySelector(`button[aria-label="選んだ計測${count}件を削除"]`));
  await waitFor(() => /削除しました/.test(noticeText() ?? ""), "削除の帯");
  await click(buttonText("< My Data"));
  await waitFor(() => document.querySelector('[data-coach-anchor="mydata"]'), "My Data");
}

describe("【便BS 審査】帯が出ている間は出さない(【便BW】0件 → 1件の起動の先送りは外した)", () => {
  it("帯が出ている間は My Data でも ⑫ が出ない。帯が消えるとまた出る", async () => {
    preferReducedMotion();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: MEASURE_DONE }, sessions: [SESSION("s1"), SESSION("s2")] });
    await render();
    await click(nav("データ"));
    await waitFor(() => layerId() === "calendarDay", "⑫(対照: 帯が無ければ出る)");
    await deleteSessionsFromAllList(1);
    // My Data が表に出ていて、計測は1件ある。帯(計測 1件を削除しました / 元に戻す)が出ている間は出さない
    expect(noticeText()).toContain("計測 1件を削除しました");
    await tick(300);
    expect(layer()).toBe(null);
    // 帯の「元に戻す」が押せる(案内に覆われていない)。押すと帯が消え、案内が戻る
    await click(buttonStarts("元に戻す"));
    await waitFor(() => noticeText() === null, "帯が消える");
    await waitFor(() => layerId() === "calendarDay", "帯が消えたらまた出る");
    expect(kv("onboardingDone").calendarDay).toBeUndefined();
  }, 40000);

  it("【便BW】この起動の中で 0件 → 1件 になっても次の起動へ回さない(帯が消えたら ⑫ が出る)", async () => {
    preferReducedMotion();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: MEASURE_DONE }, sessions: [SESSION("s1")] });
    await render();
    await click(nav("データ"));
    await waitFor(() => layerId() === "calendarDay", "⑫");
    await deleteSessionsFromAllList(1);   // 0件になる
    await click(buttonStarts("元に戻す"));  // 1件に戻る(この起動の中で 0件 → 1件)
    await waitFor(() => noticeText() === null, "帯が消える");
    await waitFor(() => document.body.textContent.includes("すべての計測 1件"), "計測が1件に戻る");
    await waitFor(() => layerId() === "calendarDay", "先送りしない");
  }, 40000);
});

// 作り物のマイク(jsdom に Web Audio と getUserMedia が無いので、App の startListening が通るだけの形)。
// 解析には小さな雑音を返す(音程は取れない = チューナーは済まない)。
// 【便BW】micGate を渡すと、getUserMedia はその約束が解けるまで返らない(殻でタブへ戻ったときの「取り直し」の待ちと同じ形)。
function installFakeMic(micGate = null) {
  const node = () => ({ connect() {}, disconnect() {} });
  const analyser = () => ({
    ...node(), fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0,
    getFloatTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = (Math.random() - 0.5) * 2e-3; },
    getFloatFrequencyData(a) { a.fill(-120); },
    getByteFrequencyData(a) { a.fill(0); },
    getByteTimeDomainData(a) { a.fill(128); },
  });
  class FakeAudioContext {
    constructor() { this.state = "running"; this.sampleRate = 48000; this.currentTime = 0; this.destination = node(); }
    resume() { this.state = "running"; return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
    createMediaStreamSource() { return node(); }
    createAnalyser() { return analyser(); }
    createBiquadFilter() { return { ...node(), type: "", frequency: { value: 0 }, Q: { value: 0 } }; }
    createGain() { return { ...node(), gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
    createOscillator() { return { ...node(), frequency: { value: 0, setValueAtTime() {} }, start() {}, stop() {} }; }
  }
  window.AudioContext = FakeAudioContext;
  const track = { enabled: true, readyState: "live", muted: false, kind: "audio", stop() {}, getSettings() { return {}; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => { if (micGate) await micGate; return stream; } }, configurable: true });
}
function removeFakeMic() {
  delete window.AudioContext;
  try { delete window.navigator.mediaDevices; } catch { /* */ }
}

// ------------------------------------------------------------------
// 【便BW 2026-10-06 凍結仕様 §2.1 / §11.2】計測タブの流れ(作り物のマイクで isListening を立てる)。
// 【守っていないもの】① が「音名が1秒続いて」済むこと(作り物のマイクは音程を返さない。useSustained は onboarding.test.jsx、配線は綴り)・
//   録音して保存する道(jsdom に録音が無い。保存の印は onboarding.test.jsx の onboardingFlagsForSavedSession と下の綴り)・
//   穴の実寸(jsdom は配置を計算しない。矩形は 375×812 の値を作り物で返す。実寸は headless Chrome の実測が報告にある)。
// ------------------------------------------------------------------
const metroBtn = () => document.querySelector('button[aria-label="メトロノーム"]');
const holeOf = () => { const h = layer().querySelector(".coach-hole"); return [h.style.left, h.style.top, h.style.width, h.style.height, h.style.borderRadius]; };

describe("【便BW】計測タブ: ① 帯 → ② メトロノーム →(面の中)③ テンポ行 → ④ 帯 → ⑤ 下部タブ「リード」", () => {
  afterEach(() => removeFakeMic());

  it("① 入れたて・マイクあり: 環の箱を穴で照らす(角丸の矩形・pad 0)。画面いっぱいの暗幕は無い", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await render();
    await waitFor(() => layerId() === "tuner", "①");
    // 【便BW 審査 統括の裁定】名乗るのは環の箱(PitchRing の親。帯全体だとカードが帯の中央に重なって環を覆った)
    const ringBox = document.querySelector('[data-coach="tuner"]');
    expect(ringBox.style.flexShrink).toBe("0");
    expect(ringBox.style.position).toBe("");
    expect(ringBox.parentElement.style.position).toBe("relative");   // 親がチューナーの帯(style は不変)
    expect(holeOf()).toEqual(["14px", "96px", "347px", "330px", "var(--r-2)"]);
    expect(document.querySelector(".coach-dim")).toBe(null);
    expect([...layer().querySelectorAll(".coach-hit")].map((h) => h.getAttribute("data-coach-hit"))).toEqual(["t", "b", "l", "r"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("まずは吹いてみよう");
  }, 30000);

  it("②→③→④: 面を開くと metronome、面の上で ③(テンポ行のピル)。− を押すと metroTempo、④(帯の穴)。帯を押して鳴らすと metroStart → ⑤", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true } } });
    await render();
    await waitFor(() => layerId() === "metronome", "②");
    await click(metroBtn());
    await waitFor(() => kv("onboardingDone")?.metronome === true, "metronome の印");
    await waitFor(() => layerId() === "metroTempo", "③");
    expect(holeOf()).toEqual(["37.6px", "464px", "299.8px", "69.6px", "var(--r-full)"]);
    const row = document.querySelector('[data-coach="metroTempo"]');
    expect(row.className).toBe("tap-through");
    expect([...row.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["テンポを下げる", "テンポと拍子", "テンポを上げる"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("テンポを決めよう");
    expect(layer().querySelector(".coach-line").textContent).toBe("♩=n を押すと拍子も変えられます");
    expect(kv("onboardingDone").metroTempo).toBeUndefined();
    await click(document.querySelector('button[aria-label="テンポを下げる"]'));
    await waitFor(() => kv("onboardingDone")?.metroTempo === true, "metroTempo の印");
    expect(kv("metroTempo")).toBe(119);   // − はいつもどおり効く
    await waitFor(() => layerId() === "metroStart", "④");
    expect(holeOf()).toEqual(["14px", "96px", "347px", "330px", "var(--r-2)"]);
    // 面が開いているので帯の中(環の箱の兄弟)に背面レイヤ(開始/停止)がある。環は当たり判定を持たないので、環を押すとここに届く
    const layerBtn = document.querySelector('[aria-label="メトロノームの開始/停止"]');
    expect(layerBtn.parentElement).toBe(document.querySelector('[data-coach="tuner"]').parentElement);
    await click(layerBtn);
    await waitFor(() => kv("onboardingDone")?.metroStart === true, "metroStart の印");
    // 【便BW 審査 統括の裁定(a)】鳴っている間は ④ の次(⑤)を出さない(④ の文が促す2回目のタップが ⑤ の受けに当たらないように)
    expect(layerBtn.getAttribute("aria-pressed")).toBe("true");
    let seen5 = false;
    for (let i = 0; i < 20; i++) { if (layer() && layerId() !== "metroStart") seen5 = true; await tick(25); }
    expect(seen5).toBe(false);
    // 2回目のタップで止める → ⑤。計測タブの段は消えていない(外押しになっていない)
    await click(layerBtn);
    expect(layerBtn.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => layerId() === "goReeds", "⑤ 下部タブ「リード」");
    expect(holeOf()).toEqual(["103.75px", "760px", "83.75px", "44px", "var(--r-2)"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("次はリードを登録しよう");
    // ⑤: 下部タブ「リード」を押す → goReeds・リードタブで ⑥(既存)
    await click(nav("リード"));
    await waitFor(() => kv("onboardingDone")?.goReeds === true, "goReeds の印");
    await passArrival("arriveReeds");   // 【便BX】到着「ここはリードタブ」
    await waitFor(() => layerId() === "reeds", "⑥");
  }, 40000);

  // 【便BW 再審査 統括の裁定(a)】③ のあと続けて − を押しても、④ のカード(環の下)がテンポ行を覆わない ──
  // ④ はテンポ行に最後に触れてから TUNER_SUSTAIN_MS(1秒)なにも触れなかったときに出す。群(計測タブの段)は消えない
  for (const times of [2, 3]) {
    it(`③ のあと − を${times}回続けて押す: 押している間は何も出ず(群は消えない)、テンポはその分変わり、手を止めると ④`, async () => {
      installFakeMic();
      mod = await loadApp(fake);
      await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true, metronome: true }, showMetroPanel: true, metroTempo: 120 } });
      await render();
      await waitFor(() => layerId() === "metroTempo", "③");
      let seen = [];
      for (let i = 0; i < times; i++) {
        await click(document.querySelector('button[aria-label="テンポを下げる"]'));
        for (let k = 0; k < 8; k++) { if (layer() && layerId() !== "metroTempo") seen.push(layerId()); await tick(25); }   // 押す間隔 約 200ms
      }
      expect(seen).toEqual([]);                                  // 押している間に ④ は出ない(カードが次の − を覆わない)
      await waitFor(() => kv("metroTempo") === 120 - times, "テンポがその分変わる");
      expect(kv("onboardingDone").metroTempo).toBe(true);
      const t0 = Date.now();
      await waitFor(() => layerId() === "metroStart", "手を止めると ④");
      expect(Date.now() - t0).toBeGreaterThanOrEqual(500);   // 最後の − から 1秒(既に待った分を引いても半分以上は待つ)
      expect(layer().querySelector(".coach-title").textContent).toBe("タップでスタート");
      expect(kv("onboardingDone").metroStart).toBeUndefined();
    }, 40000);
  }

  it("③ を ♩=n で: テンポと拍子のシートが開いている間は隠れ、metroTempo が立つ。閉じると ④", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true, metronome: true }, showMetroPanel: true } });
    await render();
    await waitFor(() => layerId() === "metroTempo", "③");
    await click(document.querySelector('button[aria-label="テンポと拍子"]'));
    await waitFor(() => document.querySelector('[role="dialog"].sheet-scrim'), "テンポと拍子のシート");
    await waitFor(() => kv("onboardingDone")?.metroTempo === true, "metroTempo の印");
    await tick(80);
    expect(layer()).toBe(null);
    await mod.act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await waitFor(() => !document.querySelector('[role="dialog"].sheet-scrim'), "シートを閉じる");
    await waitFor(() => layerId() === "metroStart", "④");
  }, 40000);

  it("③ を飛ばす: ③ を見たまま帯(背面レイヤ)を押して鳴らすと metroStart と metroTempo が同時に立つ → ⑤", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true, metronome: true }, showMetroPanel: true } });
    await render();
    await waitFor(() => layerId() === "metroTempo", "③");
    await click(document.querySelector('[aria-label="メトロノームの開始/停止"]'));
    await waitFor(() => kv("onboardingDone")?.metroStart === true, "metroStart の印");
    expect(kv("onboardingDone").metroTempo).toBe(true);
    await tick(300);
    expect(layer()).toBe(null);   // 鳴っている間は ⑤ を出さない
    await click(document.querySelector('[aria-label="メトロノームの開始/停止"]'));   // 止める
    await waitFor(() => layerId() === "goReeds", "⑤");
  }, 40000);

  it("面を閉じたら ③④ を済ませていなくても ⑤ へ(③④ は面を次に開いたときに出る)", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true, metronome: true }, showMetroPanel: true } });
    await render();
    await waitFor(() => layerId() === "metroTempo", "③");
    await click(metroBtn());   // 閉じる
    await waitFor(() => layerId() === "goReeds", "⑤");
    await click(metroBtn());   // 開く
    await waitFor(() => layerId() === "metroTempo", "③ がまた出る");
  }, 40000);
});

describe("【便BW】計測タブ: ⑦ → ⑧ リードの枠 → ⑨ このリードで計測 / ⑩ 下部タブ「データ」", () => {
  afterEach(() => removeFakeMic());

  it("⑦ 詳細の「計測」→ 計測タブ: 枠が reedChip を名乗り ⑧。カードを押すと reedLinked、続けて ⑨「このリードで計測してみよう」(的は録音ボタン)", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true, metronome: true } } });
    await render();
    await waitFor(() => layerId() === "goReeds", "⑤");
    expect(document.querySelector('[data-coach="reedChip"]')).toBe(null);   // リードが無い間は名乗らない
    await click(nav("リード"));
    await passArrival("arriveReeds");   // 【便BX】
    await waitFor(() => layerId() === "reeds", "⑥");
    await click(document.querySelector('button[aria-label="リードを追加"]'));
    await waitFor(() => document.querySelector('[role="dialog"].sheet-scrim'), "追加のシート");
    await pickFirstReed();
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "追加"));
    await waitFor(() => layerId() === "reedsMeasure", "⑦ 一覧");
    const cell = document.querySelectorAll(".reedtile")[0].parentElement;
    await mod.act(async () => {
      cell.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 200, button: 0 }));
      cell.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 40, clientY: 200, button: 0 }));
    });
    await waitFor(() => document.querySelector('button[aria-label="このリードで計測する"]'), "個体詳細");
    await click(document.querySelector('button[aria-label="このリードで計測する"]'));
    await waitFor(() => layerId() === "reedLinked", "⑧ リードの枠");
    const chip = document.querySelector('[data-coach="reedChip"]');
    expect(chip.querySelector('button[aria-label="リードの箱を選ぶ"]')).not.toBe(null);
    expect(chip.querySelector('button[aria-label="リードの個体を選ぶ"]')).not.toBe(null);
    expect(holeOf()).toEqual(["8px", "40px", "202px", "42px", "var(--r-full)"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("選んだリードが紐づいています");
    expect(layer().querySelector(".coach-line").textContent).toBe("計測データに選択したリードが紐づきます");   // 【便BX】本人の指示
    await click(layer().querySelector(".coach-card"));
    await waitFor(() => kv("onboardingDone")?.reedLinked === true, "reedLinked の印");
    await waitFor(() => layerId() === "measureReed", "⑨");
    expect(layer().querySelector(".coach-title").textContent).toBe("このリードで計測してみよう");
    expect(layer().querySelector(".coach-line").textContent).toBe("ボタンタップで計測スタート");
    expect(holeOf()).toEqual(["139.5px", "602px", "96px", "96px", "50%"]);
  }, 40000);

  // 【便BW 審査 統括の裁定】面はタブをまたいで開いたまま。③④ を済ませて面を開いたまま ⑦ の「計測」で戻っても ⑧ → ⑨ が出る
  it("【便BW 審査】⑦ → 戻る(面は開いたまま)→ ⑧ → ⑨(面を閉じなくても流れが止まらない)", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true, metronome: true, metroTempo: true, metroStart: true }, showMetroPanel: true } });
    await render();
    await waitFor(() => layerId() === "goReeds", "⑤(面は開いている・鳴っていない)");
    expect(metroBtn().getAttribute("aria-pressed")).toBe("true");
    await click(nav("リード"));
    await passArrival("arriveReeds");   // 【便BX】
    await waitFor(() => layerId() === "reeds", "⑥");
    await click(document.querySelector('button[aria-label="リードを追加"]'));
    await waitFor(() => document.querySelector('[role="dialog"].sheet-scrim'), "追加のシート");
    await pickFirstReed();
    await click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "追加"));
    await waitFor(() => layerId() === "reedsMeasure", "⑦ 一覧");
    const cell = document.querySelectorAll(".reedtile")[0].parentElement;
    await mod.act(async () => {
      cell.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 40, clientY: 200, button: 0 }));
      cell.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 40, clientY: 200, button: 0 }));
    });
    await waitFor(() => document.querySelector('button[aria-label="このリードで計測する"]'), "個体詳細");
    await click(document.querySelector('button[aria-label="このリードで計測する"]'));
    await waitFor(() => metroBtn(), "計測タブ");
    expect(metroBtn().getAttribute("aria-pressed")).toBe("true");   // 面は開いたまま
    await waitFor(() => layerId() === "reedLinked", "⑧(面は開いたまま)");
    await click(layer().querySelector(".coach-card"));
    await waitFor(() => layerId() === "measureReed", "⑨(面は開いたまま)");
    expect(metroBtn().getAttribute("aria-pressed")).toBe("true");
  }, 40000);

  it("【便BW 審査】⑧ の的の条件(reedChipShown): リードの id があっても、枠の箱にそのリードが無ければ名乗らない", async () => {
    mod = await loadApp(fake);
    const { reedChipShown } = await import("./App.jsx");
    const box = { members: [{ id: "a" }, { id: "b" }] };
    expect(reedChipShown("a", box)).toBe(true);
    expect(reedChipShown("x", box)).toBe(false);        // id はあるが枠の箱に居ない
    expect(reedChipShown("a", null)).toBe(false);       // 箱が選ばれていない(「リードを選択」)
    expect(reedChipShown("a", { members: [] })).toBe(false);
    expect(reedChipShown(null, box)).toBe(false);
  }, 30000);

  it("⑨ リードが選ばれていない: 「最初の計測を記録しよう」。枠は reedChip を名乗らない(「リードを選択」を照らさない)", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true, metronome: true, reeds: true }, reeds: [REED] } });
    await render();
    await waitFor(() => layerId() === "measure", "⑨(リードなし)");
    expect(layer().querySelector(".coach-title").textContent).toBe("最初の計測を記録しよう");
    expect(document.querySelector('[data-coach="reedChip"]')).toBe(null);
    expect(document.body.textContent).toContain("リードを選択");
  }, 30000);

  // 【便BX】データタブに着くと先に到着「ここはデータタブ」(押すと arriveData)→ ⑫
  it("⑩ 計測がある・goData まだ: 下部タブ「データ」の絵柄。押すと goData、データタブで到着 → 押すと arriveData → ⑫", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...MEASURE_DONE, arriveData: false } }, sessions: [SESSION("s1")] });
    await render();
    await waitFor(() => layerId() === "goData", "⑩");
    expect(holeOf()).toEqual(["271.25px", "760px", "83.75px", "44px", "var(--r-2)"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("計測の記録を見てみよう");
    await click(nav("データ"));
    await waitFor(() => kv("onboardingDone")?.goData === true, "goData の印");
    await waitFor(() => layerId() === "arriveData", "到着「ここはデータタブ」");
    expect(layer().querySelector(".coach-title").textContent).toBe("ここはデータタブ");
    expect(layer().querySelector(".coach-hole")).toBe(null);
    await click(layer().querySelector(".coach-card"));
    await waitFor(() => kv("onboardingDone")?.arriveData === true, "arriveData の印");
    await waitFor(() => layerId() === "calendarDay", "⑫");
  }, 30000);

  it("外を押す(群): ⑨ で外を押すと、この起動では計測タブの段が出ない(印は立てない)。データタブの段は出る", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true, metronome: true, goReeds: true } }, sessions: [] });
    await render();
    await waitFor(() => layerId() === "measure", "⑨");
    await click(layer().querySelector('[data-coach-hit="t"]'));
    expect(layer()).toBe(null);
    await click(metroBtn());   // 面を開いても ③ は出ない(群ごと消した)
    await tick(400);
    expect(layer()).toBe(null);
    expect(kv("onboardingDone").measure).toBeUndefined();
    await click(nav("データ"));
    await waitFor(() => layerId() === "data", "データタブの段は出る");
  }, 40000);

  it("マイクの取り直しを待つ(殻でタブへ戻ったときと同じ形): isListening が立つまで出さず、立てば出る", async () => {
    let open;
    const micGate = new Promise((r) => { open = r; });
    installFakeMic(micGate);
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES } } });
    await render();
    await waitFor(() => document.querySelector('[data-coach="tuner"]'), "計測タブ");
    let seen = false;
    for (let i = 0; i < 20; i++) { if (layer()) seen = true; await tick(25); }
    expect(seen).toBe(false);
    open();
    await waitFor(() => layerId() === "tuner", "マイクが動いたら ①");
  }, 30000);

  it("見本: 保存の印が全部済みでも ① から出す。本物の印は書き換えない", async () => {
    installFakeMic();
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    try {
      mod = await loadApp(fake);
      const ALL = { ...GATES, measure: true, reeds: true, reedsMeasure: true, tuner: true, metronome: true, ...NEW8, idealSeen: true };
      await seed({ kvEntries: { onboardingDone: ALL }, sessions: [SESSION("s1")] });
      await render();
      await waitFor(() => layerId() === "tuner", "見本の ①");
      // ① が済む前に面を開いても、順番を守って ① のまま(見本の済んだに metronome は立つ)
      await click(metroBtn());
      await waitFor(() => JSON.parse(window.localStorage.getItem("ficus.tutorialPreviewDone") || "{}").metronome === true, "見本の済んだ");
      await tick(200);
      expect(layerId()).toBe("tuner");
      expect(kv("onboardingDone")).toEqual(ALL);
      expect(JSON.parse(window.localStorage.getItem("ficus.tutorialPreviewDone"))).toMatchObject({ metronome: true, migratedCoach2: true });
    } finally {
      document.documentElement.removeAttribute("data-tutorial-preview");
    }
  }, 30000);
});

// 【便BS 審査】不合格2「面が開いている間は計測の段を出さない」は、【便BW 審査 2026-10-06 統括の裁定】で
// 「面の上に出すのは ③④ が済むまで。済めば面が開いていても計測の段へ合流する」に改めた(面はタブをまたいで開いたままなので、
// 前の決まりは ⑦ の「計測」で戻る本筋の道で流れを止めていた)。面が最初のテンポ操作を食べない、という元の狙いは ③④ が先に出ることで守る。
describe("【便BS 審査】→【便BW 審査】メトロノームの面と計測の段", () => {
  afterEach(() => removeFakeMic());
  const DONE_12 = { ...GATES, tuner: true, metronome: true, goReeds: true };
  const DONE_1234 = { ...DONE_12, metroTempo: true, metroStart: true };

  it("③④ がまだ: 面が開くと面の中の ③(計測の段は出さない)。閉じると計測の段", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: DONE_12 } });
    await render();
    await waitFor(() => metroBtn(), "計測タブ");
    expect(metroBtn().getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => layerId() === "measure", "計測の段(マイクが動いて面が閉じている)");
    await click(metroBtn());   // 開く(穴の外側の受けがあっても、ボタンそのものを押す)
    expect(metroBtn().getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => layerId() === "metroTempo", "面の上は ③");
    await click(metroBtn());   // 閉じる
    await waitFor(() => layerId() === "measure", "閉じると計測の段");
    expect(kv("onboardingDone").measure).toBeUndefined();
  }, 40000);

  it("③④ が済んでいれば、面が開いていても計測の段が出る(端末に「開いたまま」と覚えている起動でも)", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: DONE_1234, showMetroPanel: true } });
    await render();
    await waitFor(() => metroBtn()?.getAttribute("aria-pressed") === "true", "面が開いたままの計測タブ");
    await waitFor(() => layerId() === "measure", "面が開いたままでも計測の段");
  }, 40000);
});

describe("【便BS 審査】【便BW】配線の綴り(App.jsx)", () => {
  const app = readFileSync(join(process.cwd(), "src", "App.jsx"), "utf8").replace(/\r\n/g, "\n");
  const call = app.slice(app.indexOf("<OnboardingCoach"), app.indexOf("/>", app.indexOf("<OnboardingCoach")));
  const blk = (/const coachWithNotice = coachDuringNotice\(\{([\s\S]*?)\n  \}\);/.exec(app) || [])[1] || "";
  it("帯(notice)が出ている間は hidden。面の開閉・枠のリード・⑮ の依頼を coachCandidates へ渡す。0件 → 1件 の先送りは無い", () => {
    // 【便BX】→【便BZ】帯の間の決まりは coachDuringNotice へ(帯が名乗るタブにいる間だけ・コミュニティは goCompare だけ)
    expect(call).toMatch(/hidden=\{[^}]*\|\| coachWithNotice\.hidden\}/);
    expect(blk).toMatch(/metroPanelOpen, metronomeOn: metronomeOnForCoach, metroTempoQuiet, hasSelectedReed, idealRequested: coachRequest === "idealSeen" \}\)/);
    // 保存の帯は計測タブ・目安の帯はコミュニティタブを名乗る(帯の中身は文字列か null)
    expect(app).toMatch(/coach: typeof next\.coach === "string" \? next\.coach : null,/);
    expect(app).toMatch(/\/\/ 【便BZ】帯が名乗るのはタブの名前\(計測タブにいる間だけ\)\n\s*coach: "measure",/);
    expect(app).toMatch(/if \(announce\) showNotice\(\{ text: ADOPTED_DONE_NOTE, done: true, actionLabel: "見る", onAction: openTrendFromNotice, coach: "community" \}\);/);
    expect((app.match(/\bcoach: "(measure|community)"/g) || []).length).toBe(2);
    expect(app).toMatch(/onMetronomeChange=\{setMetronomeOnForCoach\}/);
    expect(app).toMatch(/onMetroPanelChange=\{setMetroPanelOpen\}/);
    expect(app).toMatch(/useLayoutEffect\(\(\) => \{\n\s*onMetroPanelChange\?\.\(showMetroPanel\);\n\s*\}, \[showMetroPanel, onMetroPanelChange\]\);/);
    expect(app).not.toMatch(/sawNoSessionsThisLaunch|dataSeenDeferred:/);
  });
  it("【便BW】⑧⑨: 枠のリードは「いまの楽器のリードが選ばれている」(計測タブの枠の候補 reedsOfSax と同じ絞り方)", () => {
    expect(app).toMatch(/const hasSelectedReed = Boolean\(selectedReedId\) && reeds\.some\(\(r\) => r\.id === selectedReedId && reedSaxTypeOf\(r\) === saxType\);/);
  });
  it("【便BW】③④: 口は印が読めてから渡す。④ は鳴り始めたら(③ も一緒に済む)。③ は − / ＋ / シートが開いた・閉じたら", () => {
    expect(app).toMatch(/onMetroTempoTouched=\{coachReady \? markMetroTempo : undefined\}/);
    expect(app).toMatch(/onMetronomeStarted=\{coachReady \? markMetroStarted : undefined\}/);
    expect(app).toMatch(/const markMetroStarted = useCallback\(\(\) => \{ markOnboarding\("metroStart"\); markOnboarding\("metroTempo"\); \}, \[markOnboarding\]\);/);
    expect(app).toMatch(/useEffect\(\(\) => \{\n\s*if \(metronomeOn\) onMetronomeStarted\?\.\(\);\n\s*\}, \[metronomeOn, onMetronomeStarted\]\);/);
    // 【便BW 再審査】シートが閉じたときも触れたと数える(④ は閉じてから TUNER_SUSTAIN_MS)
    expect(app).toMatch(/if \(tempoSheetOpen\) \{ tempoSheetWasOpenRef\.current = true; onMetroTempoTouched\?\.\(\); \}\n\s*else if \(tempoSheetWasOpenRef\.current\) \{ tempoSheetWasOpenRef\.current = false; onMetroTempoTouched\?\.\(\); \}/);
    expect((app.match(/onMetroTempoTouched\?\.\(\)/g) || []).length).toBe(4);
  });
  it("【便BW】⑤⑩: タブを移った結果で印を立てる(案内はタブを移さない)。goData は計測があるときだけ", () => {
    expect(app).toMatch(/if \(topTab === "reeds"\) markOnboarding\("goReeds"\);\n\s*if \(topTab === "analysis" && sessions\.length > 0\) markOnboarding\("goData"\);/);
    // 【便BX】⑭' コミュニティへ移った / ⑰ ⑮ を見てから計測タブへ戻った
    expect(app).toMatch(/if \(topTab === "community"\) markOnboarding\("goCommunity"\);\n(?:\s*\/\/[^\n]*\n)?\s*if \(topTab === "measure" && \(coachDone\.idealSeen \|\| coachDone\.adoptAverage\)\) markOnboarding\("goMeasure"\);\n\s*\}, \[coachReady, topTab, sessions\.length, coachDone\.idealSeen, coachDone\.adoptAverage, markOnboarding\]\);/);   // 【便BX 審査】目安にしただけでも
    expect(app).toMatch(/data-coach=\{`nav-\$\{t\.key\}`\}/);
    // 【便BZ】目安と比べてみよう: コミュニティ → データ(「見る」でも下部タブでも)で goCompare と ⑮ の依頼。判定は coachCameFromCompare
    expect(app).toMatch(/const coachPrevTabRef = useRef\(topTab\);\n\s*useEffect\(\(\) => \{\n\s*const from = coachPrevTabRef\.current;\n\s*coachPrevTabRef\.current = topTab;\n\s*if \(!coachReady \|\| !coachCameFromCompare\(\{ from, to: topTab, done: coachDone \}\)\) return;\n\s*markOnboarding\("goCompare"\);\n\s*setCoachRequest\("idealSeen"\);/);
  });
  it("【便BW】⑫⑬: 日を開いたら calendarDay・計測の詳細が開いたら daySession(帯の「開く」から開いても)", () => {
    expect(app).toMatch(/if \(next !== null\) onOnboarding\?\.\("calendarDay"\);/);
    expect(app).toMatch(/if \(selectedSession\) onOnboarding\?\.\("daySession"\);/);
    expect(app).toMatch(/onOnboarding=\{markOnboarding\}\n/);
  });
});

// 【便BY 2026-10-07 本人の指示「リード登録の時の楽器を選択して〜の案内はやっぱり削除」】⑥ リード登録は便BW の形に戻した。
// 本物の楽器種別の行(ReedSaxChipRow)は data-coach を名乗らず、⑥ の穴は「リードを追加」の1つだけ(2つ目の穴・clip-path は無い)。
describe("【便BY】⑥ リード登録: 穴は「リードを追加」の1つ", () => {
  it("本物の楽器種別の行は的を名乗らない。穴は1つ(clip-path なし)・受けは4枚・見出しは「使っているリードを登録しよう」", async () => {
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    await click(nav("リード"));
    await passArrival("arriveReeds");   // 【便BX】
    await waitFor(() => layerId() === "reeds", "リードタブの案内");
    const row = document.querySelector('[role="radiogroup"][aria-label="楽器種別"]');
    expect(row).not.toBe(null);
    expect(row.hasAttribute("data-coach")).toBe(false);
    expect(document.querySelector('[data-coach="reedsSax"]')).toBe(null);
    const holes = [...layer().querySelectorAll(".coach-hole")];
    expect(holes.map((h) => [h.style.left, h.style.top, h.style.width, h.style.height, h.style.borderRadius, h.style.clipPath || null])).toEqual([
      ["295px", "687px", "76px", "76px", "50%", null],
    ]);
    expect([...layer().querySelectorAll(".coach-hit")].map((h) => h.getAttribute("data-coach-hit"))).toEqual(["t", "b", "l", "r"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("使っているリードを登録しよう");
  }, 40000);
});

// ------------------------------------------------------------------
// 【便BX 2026-10-06 本人の決定・凍結仕様 coach3-spec.md §7・§13.2】
//   保存の帯(「HH:mm の計測を保存しました」+「開く」)と**同じ描画**で ⑩ が出る(帯は2つ目の穴で明るく残す・「開く」は押せる)。
//   作り物のマイクに A4(440Hz)の正弦波を返させて、本物の録音 → 保存の確認 →「登録」の道を通す(録音の道を jsdom で押せるようにした)。
//   ⑭ → ⑭'(参加済みの人には出ない)・到着の受けは下部タブも覆う・既存の利用者は 0 枚。
// 【守っていないもの】穴・帯の実寸(jsdom は配置を持たない。帯の内箱の矩形は作り物で 375×812 の仕様 §7.3 の値を返す。実寸は headless Chrome の報告)。
// ------------------------------------------------------------------
function installToneMic() {
  installFakeMic();
  const AC = window.AudioContext;
  let phase = 0;
  window.AudioContext = class extends AC {
    createAnalyser() {
      const a = super.createAnalyser();
      a.getFloatTimeDomainData = (buf) => {
        for (let i = 0; i < buf.length; i++) buf[i] = 0.3 * Math.sin(2 * Math.PI * 440 * ((phase + i) / 48000));
        phase += buf.length;
      };
      return a;
    }
  };
}
const recordBtn = () => document.querySelector('button[data-coach="measure"]');
const saveDialog = () => document.querySelector('[role="dialog"][aria-label="この録音を保存しますか？"]');
async function recordAndSave() {
  await click(recordBtn());
  await waitFor(() => recordBtn().getAttribute("aria-pressed") === "true", "録音中");
  await tick(1200);
  await click(recordBtn());
  await waitFor(() => saveDialog(), "保存の確認");
  await click([...saveDialog().querySelectorAll("button")].find((b) => b.textContent.trim() === "登録"));
}

describe("【便BX】保存の帯と同時に ⑩(帯は2つ目の穴)", () => {
  afterEach(() => removeFakeMic());
  let realRect2;
  beforeEach(() => {
    // 帯の内箱(data-action-notice)は 375×812 の仕様 §7.3 の矩形(685〜753)・データの絵柄は 772〜802
    realRect2 = window.Element.prototype.getBoundingClientRect;
    const base = realRect2;
    window.Element.prototype.getBoundingClientRect = function () {
      const box = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
      if (this.hasAttribute?.("data-action-notice")) return box(14, 685, 347, 68);
      const pc = this.tagName?.toLowerCase() === "svg" ? this.parentElement?.getAttribute("data-coach") : null;
      if (pc === "nav-analysis") return box(298.1, 772, 30, 30);
      return base.call(this);
    };
  });
  afterEach(() => { window.Element.prototype.getBoundingClientRect = realRect2; });

  it("⑨ 録音 → 保存の確認で「登録」: 帯と同じ描画で ⑩。穴は2枚(データの絵柄 + 帯の箱)。帯の「開く」を押すと詳細が開き、案内は消え goData・daySession", async () => {
    installToneMic();
    mod = await loadApp(fake);
    // 入れたて(⑤⑧ まで済み・⑨ から)。リードは選んでいない
    await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true, metronome: true, goReeds: true } } });
    await render();
    await waitFor(() => layerId() === "measure", "⑨");
    await recordAndSave();
    // 帯が出ている同じ描画で ⑩
    await waitFor(() => noticeText() !== null, "保存の帯");
    expect(noticeText()).toMatch(/^✓\d\d:\d\d の計測を保存しました開く$/);
    await waitFor(() => layerId() === "goData", "帯と同時に ⑩");
    expect(noticeText()).not.toBe(null);
    await waitFor(() => kv("onboardingDone")?.measure === true, "measure の印(保存)");
    expect(noticeText()).not.toBe(null);
    const holes = [...layer().querySelectorAll(".coach-hole")];
    expect(holes.map((h) => [h.style.left, h.style.top, h.style.width, h.style.height, h.style.borderRadius, h.getAttribute("data-coach-hole")])).toEqual([
      ["271.25px", "760px", "83.75px", "44px", "var(--r-2)", null], ["14px", "685px", "347px", "68px", "var(--r-2)", "also"],
    ]);
    expect(document.querySelectorAll("[data-action-notice]")).toHaveLength(1);
    expect(document.querySelector("[data-action-notice]").className).toBe("action-notice");
    // 帯の箱の中に受けは無い(「開く」は押せる)
    const hitsOver = [...layer().querySelectorAll(".coach-hit")].filter((h) => {
      const t = parseFloat(h.style.top); const hh = parseFloat(h.style.height);
      return t < 753 && t + hh > 685 && parseFloat(h.style.width) > 0;
    });
    expect(hitsOver.map((h) => h.getAttribute("data-coach-hit")).sort()).toEqual(["xl", "xr"]);   // 帯の左右(画面の縁 14px)だけ
    // 帯の「開く」→ 詳細(既存の openSessionFromNotice)。タブが変わるので ⑩ は消え、goData・daySession が立つ
    await click(buttonText("開く"));
    await waitFor(() => backToList(), "計測の詳細");
    await waitFor(() => kv("onboardingDone")?.goData === true && kv("onboardingDone")?.daySession === true, "goData・daySession の印");
    expect(layerId()).not.toBe("goData");
  }, 40000);

  it("帯が消えても ⑩ は残る(穴は1枚に戻る)", async () => {
    preferReducedMotion();   // 帯が5秒で溶けずに外れる(jsdom は animationend を出さない)
    installToneMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true, metronome: true, goReeds: true } } });
    await render();
    await waitFor(() => layerId() === "measure", "⑨");
    await recordAndSave();
    await waitFor(() => layerId() === "goData" && layer().querySelectorAll(".coach-hole").length === 2, "帯と同時に ⑩");
    await waitFor(() => noticeText() === null, "帯が消える", 8000);
    await waitFor(() => layer()?.querySelectorAll(".coach-hole").length === 1, "穴は1枚");
    expect(layerId()).toBe("goData");
  }, 40000);

  // 【便BZ 統括の裁定】帯が出ている間は、その帯が名乗る段だけ。保存の帯の間に ⑱ の条件がそろっても、⑱ は帯が消えてから
  it("【便BZ】コミュニティを見たあとに初めて計測した人: 保存の帯の間は ⑱ を出さない(帯の「開く」は押せる)。帯が消えると ⑱", async () => {
    preferReducedMotion();
    installToneMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true, metronome: true, goReeds: true, goData: true, goCommunity: true } } });
    await render();
    await waitFor(() => layerId() === "measure", "⑨");
    await recordAndSave();
    await waitFor(() => noticeText() !== null, "保存の帯");
    await waitFor(() => kv("onboardingDone")?.measure === true, "measure の印(⑱ の条件がそろう)");
    let seenDuring = null;
    for (let i = 0; i < 24 && noticeText() !== null; i++) { if (layer() && layer().getAttribute("data-leaving") === "false") seenDuring = layerId(); await tick(25); }
    expect(noticeText()).not.toBe(null);
    expect(seenDuring).toBe(null);
    await waitFor(() => noticeText() === null, "帯が消える", 8000);
    await waitFor(() => layerId() === "finish", "帯が消えたら ⑱");
  }, 40000);

  it("帯の間に「データ」を押すと: データタブの段(到着)は帯が消えてから出る(帯の「開く」を覆わない)", async () => {
    preferReducedMotion();
    installToneMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES, tuner: true, metronome: true, goReeds: true } } });
    await render();
    await waitFor(() => layerId() === "measure", "⑨");
    await recordAndSave();
    await waitFor(() => layerId() === "goData", "⑩");
    await click(nav("データ"));
    await waitFor(() => kv("onboardingDone")?.goData === true, "goData の印");
    await tick(300);
    expect(noticeText()).not.toBe(null);
    expect(layer()).toBe(null);                               // 帯が出ている間は到着も出さない
    expect(buttonText("開く")).not.toBe(null);
    await waitFor(() => noticeText() === null, "帯が消える", 8000);
    await waitFor(() => layerId() === "arriveData", "帯が消えたら到着");
  }, 40000);
});

describe("【便BX】⑭' と到着の受け・既存の利用者", () => {
  afterEach(() => removeFakeMic());
  it("⑭' は参加済みの人には出ない(⑭ を押しても何も出ない)", async () => {
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...MEASURE_DONE, calendarDay: true, daySession: true, join: true } }, sessions: [SESSION("s1")] });
    await render();
    await click(nav("データ"));
    await waitFor(() => layerId() === "trend", "⑭");
    await click(layer().querySelector(".coach-card"));
    await waitFor(() => kv("onboardingDone")?.trend === true, "trend の印");
    await tick(400);
    expect(layer()).toBe(null);
    expect(kv("onboardingDone").goCommunity).toBeUndefined();
  }, 40000);

  // (⑭' → 下部タブ「コミュニティ」で goCommunity・コミュニティの到着は idealSeenFlow.test.jsx。コミュニティを描くにはサーバーの作り物が要る)
  it("到着の受けは画面いっぱい(下部タブも覆う。重なり順 55 > 下部タブ)・暗幕は1枚・穴は無い", async () => {
    mod = await loadApp(fake);
    await render();
    await waitFor(() => kv("onboardingDone")?.migratedCoach3 === true, "移行の印");
    await click(nav("リード"));
    await waitFor(() => layerId() === "arriveReeds", "到着");
    const hit = layer().querySelector('[data-coach-hit="all"]');
    expect(["left", "top", "width", "height"].map((k) => parseFloat(hit.style[k]))).toEqual([0, 0, W, H]);
    expect(layer().querySelectorAll(".coach-hit")).toHaveLength(1);
    expect(layer().querySelector(".coach-hole")).toBe(null);
    expect(layer().querySelectorAll(".coach-dim")).toHaveLength(1);
    const navZ = Number(getComputedStyle(document.querySelector("[data-bottom-nav]")).zIndex || document.querySelector("[data-bottom-nav]").style.zIndex);
    expect(Number(layer().style.zIndex)).toBeGreaterThan(navZ);
    expect(layer().querySelector(".coach-title").textContent).toBe("ここはリードタブ");
    // 【便BY】→【便BZ】→【便CF】の目印は【便CG】で外した
    expect(layer().querySelector(".coach-progress")).toBe(null);   // 【便CG】目印は外した
    expect(layer().querySelector(".coach-card").firstElementChild.className).toBe("coach-icon");   // 【便CG】カードの最初の子はアイコン
    await waitFor(() => kv("onboardingDone")?.goReeds === true, "goReeds の印");
  }, 30000);

  it("既存の利用者(計測1件・目安あり): 4つ目の門で新しい6つが立ち、どのタブでも 0 枚(到着も)", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { reeds: [REED], idealProfiles: [{ id: "p3", name: "みんなの平均（クラシック 学生）", sourceKind: "community", saxType: "alto", notes: {} }] }, sessions: [SESSION("s1", "r1")] });
    await render();
    await waitFor(() => kv("onboardingDone")?.migratedCoach3 === true, "移行の印");
    expect(kv("onboardingDone")).toMatchObject({ ...NEW6, migratedCoach3: true });
    await waitFor(() => document.querySelector('[data-coach="tuner"]'), "計測タブ");
    // (コミュニティタブはここでは描かない。サーバーの作り物が要るので idealSeenFlow.test.jsx が見る)
    for (const label of [null, "リード", "データ", "計測"]) {
      if (label) await click(nav(label));
      let seen = null;
      for (let i = 0; i < 16; i++) { if (layer()) seen = layerId(); await tick(25); }
      expect(seen, label ?? "計測(起動)").toBe(null);
    }
  }, 40000);
});

// 【便BX 審査 2026-10-06 統括の裁定】§13.2「帯の種類」を振る舞いで守る: 削除の帯(coach を持たない)が出ている間に計測タブへ移っても、
// 計測タブの段は出さない(帯が消えてから出る)。目安の帯は idealSeenFlow.test.jsx の「『見る』を押さない」が同じことを見る。
describe("【便BX 審査】帯の種類: 削除の帯の間は計測タブでも段を出さない", () => {
  afterEach(() => removeFakeMic());
  it("データタブで計測を削除 → 帯(元に戻す)の間に計測タブへ: ② は出ない。帯が消えると ② が出る", async () => {
    preferReducedMotion();
    installFakeMic();
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...MEASURE_DONE, metronome: false, goData: true, calendarDay: true, daySession: true, trend: true } }, sessions: [SESSION("s1"), SESSION("s2")] });
    await render();
    await waitFor(() => layerId() === "metronome", "対照: 帯が無ければ計測タブで ②");
    await click(nav("データ"));
    await deleteSessionsFromAllList(1);
    expect(noticeText()).toContain("計測 1件を削除しました");
    await click(nav("計測"));
    let seenDuring = null;
    for (let i = 0; i < 24 && noticeText() !== null; i++) { if (layer()) seenDuring = layerId(); await tick(25); }
    expect(noticeText()).not.toBe(null);
    expect(seenDuring).toBe(null);
    await waitFor(() => noticeText() === null, "帯が消える", 8000);
    await waitFor(() => layerId() === "metronome", "帯が消えたら ②");
  }, 40000);
});

// ------------------------------------------------------------------
// 【便BZ 2026-10-07 本人の実機の指摘】アプリの中で確かめる(jsdom は配置を計算しないので、的・浮かせるボタンの矩形は作り物)。
//   ① 環の箱の上にも下にもカードが収まらないとき、中央(環の真ん中 = 音名・セント)ではなく重なりが最小の端に置く
//   ② ⑭ の穴(音の傾向カード)の中に入った浮かせるボタン(取り込みの丸)は、暗幕と同じ色の覆いの下(押すと外押し = ⑭ は押す=済)
// 【守っていないもの】実機の環・音名の実寸(headless Chrome の実測は報告の表)。
// ------------------------------------------------------------------
describe("【便BZ】① 環の箱にカードが収まらないとき / ② 浮かせるボタンの覆い", () => {
  afterEach(() => removeFakeMic());
  it("① 実寸の環の箱(96〜426)では今までどおり下(448)。上にも下にも収まらない高い環の箱(60〜680)では中央 333 ではなく下の端 644(812 − 22 − 146)", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    await render();
    await waitFor(() => layerId() === "tuner", "①");
    await tick(60);
    const card = () => layer().querySelector(".coach-card");
    expect(card().style.top).toBe("448px");
    expect(card().getAttribute("data-coach-side")).toBe("below");
    tunerBox = [14, 60, 347, 620];
    await waitFor(() => card().style.top === "644px", "重なりが最小の端");
    expect(card().getAttribute("data-coach-side")).toBe("below");
    expect(card().style.top).not.toBe(`${(812 - 146) / 2}px`);
  }, 30000);
  it("② ⑭ の穴の中の取り込みの丸(本物の FloatingAction は data-floating-action を名乗る)は覆われる。覆いを押すと ⑭ が済み、⑭' へ", async () => {
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...MEASURE_DONE, goData: true, calendarDay: true, daySession: true } }, sessions: [SESSION("s1")] });
    await render();
    fabBox = [305, 540, 56, 56];   // 送ったあとの音の傾向カード(216〜596)の中
    await click(nav("データ"));
    await waitFor(() => layerId() === "trend", "⑭");
    const fab = document.querySelector('button[data-floating-action=""][aria-label="録音ファイルを取り込む"]');
    expect(fab).not.toBe(null);
    await waitFor(() => layer().querySelectorAll(".coach-cover").length === 1, "覆い");
    const c = layer().querySelector(".coach-cover");
    expect([c.style.left, c.style.top, c.style.width, c.style.height]).toEqual(["305px", "540px", "56px", "56px"]);
    await click(c);
    await waitFor(() => kv("onboardingDone")?.trend === true, "trend の印(押す=済)");
    await waitFor(() => layerId() === "goCommunity", "⑭'");
    expect(layer().querySelectorAll(".coach-cover")).toHaveLength(0);   // ⑭' の穴(下部タブ)には浮かせるボタンがかからない
  }, 40000);
  it("的そのものの浮かせるボタン(⑥ リードを追加)は覆わない", async () => {
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: { ...GATES, arriveReeds: true } } });
    await render();
    fabBox = [305, 697, 56, 56];
    await click(nav("リード"));
    await waitFor(() => layerId() === "reeds", "⑥");
    expect(document.querySelector('[data-coach="reeds"]').hasAttribute("data-floating-action")).toBe(true);
    expect(layer().querySelectorAll(".coach-cover")).toHaveLength(0);
  }, 30000);
});

// 【便BZ 2026-10-07 本人の指示「各タブアイコンの下に小さくタブ名称のテキスト追加 / 左から計測、リード、コミュニティ、データ」】
// 期待値は本人の指示の文から手で書いた。字の大きさは最小の字の段 --fs-xs、色はアイコンと同じ(選んでいるタブは紺)。
// 【守っていないもの】実寸(高さ 59・当たり 44)は jsdom では測れない(headless Chrome の実測は報告の表)。
describe("【便BZ】下部タブ: アイコンの下に小さくタブの名前", () => {
  it("左から 計測・リード・コミュニティ・データ。名前は絵柄の下・--fs-xs・色は絵柄と同じ(選んでいるタブは --c-accent)", async () => {
    mod = await loadApp(fake);
    await render();
    const btns = [...document.querySelectorAll("[data-bottom-nav] button")];
    expect(btns.map((b) => b.getAttribute("aria-label"))).toEqual(["計測", "リード", "コミュニティ", "データ"]);
    for (const b of btns) {
      const [icon, name] = b.children;
      expect(icon.tagName.toLowerCase(), b.getAttribute("aria-label")).toBe("svg");
      expect(name.tagName).toBe("SPAN");
      expect(name.textContent).toBe(b.getAttribute("aria-label"));
      expect(name.style.fontSize).toBe("var(--fs-xs)");
      expect(name.style.color).toBe(b.style.color);
      expect(b.style.flexDirection).toBe("column");
    }
    expect(btns[0].style.color).toBe("var(--c-accent)");   // 起動は計測タブ
    expect(btns[1].children[1].style.color).toBe("var(--c-ink-3)");
    await click(nav("データ"));
    expect(document.querySelector('[data-bottom-nav] button[aria-label="データ"]').children[1].style.color).toBe("var(--c-accent)");
    // 【便CA 2026-10-08】内箱の高さ = 上 6 + ボタン 44(--tap-min)+ 下 --nav-pad-bottom(安全域があれば 0・無ければ --sp-2)。帯の高さ --nav-h = 1 + 内箱
    const inner = document.querySelector("[data-bottom-nav]").firstElementChild;
    expect([inner.style.height, inner.style.padding]).toEqual(["calc(50px + var(--nav-pad-bottom))", "6px 20px var(--nav-pad-bottom)"]);
    const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
    expect(/\n  --nav-pad-bottom: max\(0px, calc\(var\(--sp-2\) - env\(safe-area-inset-bottom\)\)\);\n  --nav-h: calc\(51px \+ var\(--nav-pad-bottom\)\);/.test(css)).toBe(true);
    expect(/--tap-min: 44px;/.test(css)).toBe(true);
  }, 30000);
});
