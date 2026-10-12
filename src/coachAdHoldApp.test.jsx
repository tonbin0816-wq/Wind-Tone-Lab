// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便CO 2026-10-12 本人の実機指示「案内(チュートリアルのカード)が出ているときは、いつでも広告を出さない」】アプリへの配線。
// 本物のアプリ(WindToneLabPhaseMode)を描き、Web の広告の見本(<html data-ad-preview="1"> と見本の帯 [data-ad-preview-strip])で見る。
// 統括の仕様から手で書いた期待値:
//   ・広告を始めてよい起動(2回目の起動 = 起動の最初に読んだ onboardingShown が true)でも、案内のカードが画面にある間は
//     <html data-ad-hold="1"> が付き、見本の帯を描かない
//   ・段が切り替わる間(到着カード → 次の段)に印は一度も外れない(帯が一瞬出て消えない)
//   ・案内が閉じたら(カードの無いタブへ移った)、少し置いて印が外れ、見本の帯が戻る。外れる前の空き(段と段の間の 250ms の探し直し
//     = COACH_POLL_MS の数倍)では外れない
//   ・広告をまだ始めてはいけない起動(初めて案内が出た起動)では、閉じても印は外れず、帯は出ない
// 実機の到着カードの症状(データタブの「ここはデータタブ」の下にバナー)をなぞる: 計測が1件ある人が、計測タブからデータタブへ移る。
// IndexedDB は作り物。的の矩形は onboardingApp.test.jsx と同じ 375×812 の実測の値。
// 【守っていないもの】殻の本物の帯(ネイティブ)が実際に消えて戻ること(ads.test.jsx の【便CO】が呼び口までを見る。描画は実機待ち)・
//   溶ける動き(jsdom は index.css を読まないので溶ける時間 0 = 即座に消える。実機の 350ms の溶けは止めている間に含まれる)。
// ------------------------------------------------------------------

const W = 375; const H = 812;
let fake; let host; let mod; let root; let realRect;
const NAV_BOX = { "nav-measure": 20, "nav-reeds": 103.75, "nav-community": 187.5, "nav-analysis": 271.25 };

async function loadApp(idb) {
  vi.resetModules();
  globalThis.indexedDB = idb;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("./App.jsx");
  return { React, act: React.act, createRoot, App: App.default, openIdb: App.openIdb };
}
async function seed({ kvEntries = {}, sessions = [] } = {}) {
  const db = await mod.openIdb();
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
const held = () => document.documentElement.getAttribute("data-ad-hold") === "1";
const strip = () => document.querySelector("[data-ad-preview-strip]");

// 印の付け外しを1つ残らず記録する(描画の間に一瞬だけ外れて戻った、も拾う)
let holdLog = []; let observer = null;
function watchHold() {
  holdLog = [held() ? "1" : null];
  observer = new MutationObserver((recs) => {
    for (const r of recs) if (r.attributeName === "data-ad-hold") holdLog.push(document.documentElement.getAttribute("data-ad-hold"));
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ad-hold"] });
}

const NOW_ISO = new Date(Date.now() - 60 * 1000).toISOString();
const SESSION = { id: "s1", recordedAt: NOW_ISO, saxType: "alto", reedId: null, linkedAt: null, memo: null, performer: "自分", source: "live", frames: [], barlines: [], noteEvents: [] };
// 移行の門(5つ)・計測がある人の計測タブの章・リードの章は済み(リードタブには何も出ない)。データタブは到着から(arriveData がまだ)
const DONE = {
  migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true,
  measure: true, tuner: true, metronome: true, metroTempo: true, metroStart: true, goReeds: true, reedLinked: true, goData: true,
  arriveReeds: true, reeds: true, reedsMeasure: true,
};

beforeEach(() => {
  fake = createFakeIndexedDb();
  window.localStorage.clear();
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = () => {};
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    const box = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
    if (this.classList?.contains("coach-card")) return box(22, 0, W - 44, 146);
    const c = this.getAttribute?.("data-coach");
    if (c === "calendarDay") return box(66.5, 305, 34, 34);
    // 計測タブの的(375×812 の実測と同じ値。onboardingApp.test.jsx と同じ)
    if (c === "measure") return box(153.5, 616, 68, 68);
    if (c === "tuner") return box(14, 96, 347, 330);
    if (c === "metroTempo") return box(43.6, 470, 287.8, 57.6);
    if (c === "metronome") return box(317, 30, 44, 44);
    if (c && c in NAV_BOX && this.tagName === "BUTTON") return box(NAV_BOX[c], 760, 83.75, 44);
    return box(0, 0, 0, 0);
  };
  // Web の広告の見本の合図(main.jsx の applyAdPreview が付ける印)。後で個別に外す
  document.documentElement.setAttribute("data-ad-preview", "1");
});
afterEach(async () => {
  observer?.disconnect(); observer = null;
  removeFakeMic();
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  window.Element.prototype.getBoundingClientRect = realRect;
  document.documentElement.removeAttribute("data-ad-preview");
  document.documentElement.removeAttribute("data-ad-hold");
});

describe("【便CO】案内のカードが出ている間は広告の帯を止める(Web の見本)", () => {
  it("2回目の起動: カードの無い計測タブでは帯が出ている → データタブの到着カードで止まる → ⑫ へ進む間も止めたまま → カードの無いタブへ移ると少し置いて戻る", async () => {
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: DONE, onboardingShown: true }, sessions: [SESSION] });
    await render();
    // 計測タブ(マイクが無いのでエラーの暗幕。カードは出ない)。2回目の起動なので広告を始めてよい
    await waitFor(() => !held() && strip(), "計測タブで帯が出る");
    expect(layer()).toBe(null);
    watchHold();
    // データタブ: 到着カード「ここはデータタブ」(実機の症状の場面)
    await click(nav("データ"));
    await waitFor(() => layerId() === "arriveData", "到着カード");
    expect(held()).toBe(true);
    expect(strip()).toBe(null);
    // 到着を押す → ⑫ 日のマス(段の切り替わり)
    await click(layer().querySelector('[data-coach-hit="all"]'));
    await waitFor(() => layerId() === "calendarDay", "⑫");
    await tick(50);
    expect(held()).toBe(true);
    expect(strip()).toBe(null);
    // 段の切り替わりの間、印は1回付いただけで、一度も外れていない(帯が一瞬出て消えない)
    expect(holdLog).toEqual([null, "1"]);
    // カードの無いタブ(リードの章は済み)へ移る → カードが消える
    await click(nav("リード"));
    await waitFor(() => layer() === null, "カードが消える");
    // 段と段の間の空き(探し直し 250ms の倍)では、まだ止めたまま
    await tick(500);
    expect(held()).toBe(true);
    expect(strip()).toBe(null);
    // 少し置いて戻る(帯も描かれる)
    await waitFor(() => !held() && strip(), "閉じたら戻る", 5000);
    expect(holdLog).toEqual([null, "1", null]);
  }, 40000);

  it("初めて案内が出た起動(まだ広告を始めてはいけない): カードが閉じても印は外れず、帯は出ない", async () => {
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: DONE }, sessions: [SESSION] });
    await render();
    await waitFor(() => kv("onboardingDone") !== undefined, "印の読み込み");
    await tick(100);
    expect(held()).toBe(true);
    expect(strip()).toBe(null);
    await click(nav("データ"));
    await waitFor(() => layerId() === "arriveData", "到着カード");
    await click(nav("リード"));
    await waitFor(() => layer() === null, "カードが消える");
    await tick(2500);   // 戻す待ちを十分に越える
    expect(held()).toBe(true);
    expect(strip()).toBe(null);
  }, 40000);
});
const kv = (key) => fake._peek("windToneLabDB", "kv")?.get(key);
// ⑦ 「このリードで計測」だけが残っている人(リードの章の到着・登録は済み・データタブの段も済み)
const DONE_NO_REEDS_MEASURE = { ...DONE, reedsMeasure: false, arriveData: true, calendarDay: true, daySession: true, trend: true, idealSeen: true, goCommunity: true };

// 作り物のマイク(onboardingApp.test.jsx と同じ形。App の startListening が通り、isListening が立つ。音程は取れない)
function installFakeMic() {
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
  Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => stream }, configurable: true });
}
function removeFakeMic() {
  delete window.AudioContext;
  try { delete window.navigator.mediaDevices; } catch { /* */ }
}

// 【便CO 審査のあとの統括の決定】止めるのは案内の流れの途中: (a) カード (b) 一時的に隠している (c) 次の段が操作を待っている (d) 参加の画面のカード。
describe("【便CO 審査】案内の流れの途中は止めたまま(2回目の起動・Web の見本)", () => {
  // 【欠陥1】⑨ から録音すると、録音を始めて約1秒で帯が戻り、録音中に計測の枠が縮んでいた((b) 録音中・保存の確認は一時的に隠しているだけ)
  it("⑨ → 録音(1.5 秒)→ 止める → 保存の確認 → 保存 → ⑩ の間、印は一度も外れない", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    const done9 = { migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true,
      tuner: true, metronome: true, metroTempo: true, metroStart: true, goReeds: true, arriveReeds: true, reeds: true };
    await seed({ kvEntries: { onboardingDone: done9, onboardingShown: true } });
    await render();
    await waitFor(() => layerId() === "measure", "⑨ 計測してみよう");
    expect(held()).toBe(true);
    watchHold();
    const rec = () => document.querySelector('[data-coach="measure"]');
    await click(rec());                                   // 的(録音ボタン)を押す = 録音を始める
    await waitFor(() => layer() === null, "録音中は案内が隠れる");
    await tick(1500);                                     // 戻す待ち(1秒)を越えて録音を続ける
    expect(held()).toBe(true);
    expect(strip()).toBe(null);
    await click(rec());                                   // 止める
    await waitFor(() => saveDialog(), "保存の確認");
    const save = [...saveDialog().querySelectorAll("button")].find((x) => /保存|登録/.test(x.textContent));
    expect(save).toBeTruthy();
    await tick(1200);                                     // 保存の確認を出したまま待ちを越える
    expect(held()).toBe(true);
    await click(save);
    await waitFor(() => layerId() === "goData", "⑩ データを見てみよう(保存の帯と同時)");
    expect(holdLog).toEqual(["1"]);                       // 一度も外れていない
  }, 40000);

  // 【欠陥2】③ → ④ の間に帯が一瞬出ていた((c) ③ の印は最初に触れたときに立ち、④ は最後に触れてから1秒後に出る)
  it("③ のあと − を3回(約 200ms 間隔)押して ④ が出るまで、印は一度も外れない", async () => {
    installFakeMic();
    mod = await loadApp(fake);
    const done3 = { migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true, tuner: true, metronome: true };
    await seed({ kvEntries: { onboardingDone: done3, onboardingShown: true, showMetroPanel: true, metroTempo: 120 } });
    await render();
    await waitFor(() => layerId() === "metroTempo", "③");
    expect(held()).toBe(true);
    watchHold();
    for (let i = 0; i < 3; i++) {
      await click(document.querySelector('button[aria-label="テンポを下げる"]'));
      await tick(200);
    }
    await waitFor(() => layerId() === "metroStart", "手を止めると ④");
    expect(kv("metroTempo")).toBe(117);
    expect(holdLog).toEqual(["1"]);
  }, 40000);

  // 待ちの長さ: 外押しで飛ばした直後(次の段の的が画面に無い = 流れから離れた)、待ちが過ぎるまでは止めたまま、過ぎたら戻す。
  // 期待値は §4.5b の「1秒」(案内で『続いた』『手を止めた』を測る長さにそろえた値)。前は 300ms・後ろは描画と検査の刻みで 800ms まで許す
  it("外押しで飛ばした直後: 約1秒は止めたまま、そのあと戻る", async () => {
    mod = await loadApp(fake);
    await seed({ kvEntries: { onboardingDone: DONE, onboardingShown: true }, sessions: [SESSION] });
    await render();
    await waitFor(() => !held() && strip(), "計測タブで帯が出る");
    await click(nav("データ"));
    await waitFor(() => layerId() === "arriveData", "到着カード");
    await click(layer().querySelector('[data-coach-hit="all"]'));
    await waitFor(() => layerId() === "calendarDay", "⑫");
    // 穴の外(上の受け)を押す = 外押し。⑫⑬ を飛ばす。次の ⑭ の的(音の傾向カード)はこの作り物では画面に無い
    await click(layer().querySelector('[data-coach-hit="t"]'));
    await waitFor(() => layer() === null, "カードが消える");
    const t0 = Date.now();
    await tick(700);
    expect(held()).toBe(true);
    await waitFor(() => !held(), "戻る", 5000);
    const dt = Date.now() - t0;
    expect(dt).toBeGreaterThanOrEqual(1000 - 300);
    expect(dt).toBeLessThanOrEqual(1000 + 800);
    expect(strip()).not.toBe(null);
  }, 40000);

  // 【便CO 再審査】エラーの暗幕(マイクの拒否・取り直しの失敗)は一時的ではないので (b) に数えない。
  // 2回目の起動・マイクなし(この作り物ではマイクが取れずエラーの暗幕)・① と4つのタブの印が済んで計測タブに ⑱ が残っている人が、
  // データタブの到着カードから計測タブへ移る → ⑱ は暗幕の下で出ないまま。待ちのあと印が外れる(以前は止まり続けた)
  it("マイクの無い人がデータタブの到着カードから計測タブへ移ると、待ちのあと戻る(エラーの暗幕は一時的ではない)", async () => {
    mod = await loadApp(fake);
    const doneMicless = { migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true,
      tuner: true, goReeds: true, goCommunity: true, measure: true };
    await seed({ kvEntries: { onboardingDone: doneMicless, onboardingShown: true }, sessions: [SESSION] });
    await render();
    await click(nav("データ"));
    await waitFor(() => layerId() === "arriveData", "到着カード");
    expect(held()).toBe(true);
    await click(nav("計測"));
    await waitFor(() => document.querySelector('[role="dialog"][aria-label="エラー"]'), "マイクのエラーの暗幕");
    await waitFor(() => layer() === null, "カードが消える");
    const t0 = Date.now();
    await waitFor(() => !held(), "待ちのあと戻る", 4000);
    expect(Date.now() - t0).toBeLessThanOrEqual(1000 + 800);
    expect(strip()).not.toBe(null);
  }, 40000);

  // 【境目】2回目の起動で案内を放置した人: 残りの段(⑦ このリードで計測)はあるが的が画面に無い。シートを開いても(候補はあるのに隠している形)
  // カードが出ていない間は止めない
  it("残りの段の的が画面に無い人がシートを開いても、止めない(放置した人にずっと止めない)", async () => {
    mod = await loadApp(fake);
    const REED = { id: "r1", brand: "Vandoren", model: null, strength: 3, startDate: "2026-10-01", saxType: "alto", boxLabel: null, rating: null, thickness: null, balance: null, createdAt: "2026-10-01T09:00:00.000Z" };
    await seed({ kvEntries: { onboardingDone: DONE_NO_REEDS_MEASURE, onboardingShown: true, reeds: [REED] }, sessions: [SESSION] });
    await render();
    await waitFor(() => !held() && strip(), "計測タブで帯が出る");
    watchHold();
    await click(nav("リード"));
    await tick(300);
    expect(layer()).toBe(null);                           // ⑦ の的(タイル)はこの作り物では画面に無い
    const add = document.querySelector('[data-coach="reeds"]');
    expect(add).toBeTruthy();
    await click(add);
    await waitFor(() => document.querySelector('[role="dialog"]'), "シートが開く");
    await tick(1500);
    expect(holdLog).toEqual([null]);                      // 一度も止めていない
  }, 40000);
});
const saveDialog = () => document.querySelector('[role="dialog"][aria-label="この録音を保存しますか？"]');
