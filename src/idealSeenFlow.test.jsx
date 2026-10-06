// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便BW 2026-10-06 本人裁定(凍結仕様 §14 の 1 への答え)】みんなの平均を目安に設定したあと。
//   ・帯の文は「目安に設定しました」(【審査】短く。計測タブには目安を描いている所が無いので「計測タブで比べられます」はやめた)。帯に「見る」
//   ・「見る」を押すと データタブの My Data へ移り、音の傾向カードまでスクロールし、はじめの一手 ⑮(idealSeen)でそのカードを照らす
//     (文「みんなの平均を目安にしました / my平均と目安を重ねて見られます」)。押す=済。2回目からは移ってスクロールするだけ
//   ・My Data の折れ線の2系列の既定: 目安があれば my平均 × 目安、無ければ その日 × my平均。
//     既定は「本人がまだ選んでいない」ときだけ効く(選んだ組は目安を付け外ししても上書きしない)
// 本物のアプリを描き、サーバーは作り物(wideLayoutCommunity.test.jsx と同じ差し替え。Firebase に触らない)。IndexedDB も作り物。
// 幅は iPhone 縦(375×812。matchMedia は全部 false = 狭い木)。
// 【守っていないもの】実際のスクロールの量と、カードが画面の中央に来ること(jsdom は配置もスクロールも無い。scrollIntoView は
//   呼ばれた要素と引数を控える作り物。実測は Browser ペインの 375×812 で行い、報告にスクショがある)・人物のページの1行の文
//   (綴りは pitch-test の BO.4 が idealDoc.js の1つの定数を見る)。
// ------------------------------------------------------------------

const auth = vi.hoisted(() => ({ uid: "me" }));
vi.mock("./community/accountRepo.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return {
    ...(await orig()),
    getSignedInUid: vi.fn(async () => auth.uid),
    loadProfile: vi.fn(async () => kit.MY_PROFILE),
    watchMyPhoto: vi.fn(() => () => {}),
    ensureSignedIn: vi.fn(async () => { throw new Error("検査: サインインしない"); }),
  };
});
vi.mock("./community/directory.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(async () => kit.SERVER_USERS), publishStats: vi.fn(async () => {}) };
});
vi.mock("./community/reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));
vi.mock("./community/idealRepo.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return { ...(await orig()), listIdeals: vi.fn(async () => kit.SERVER_IDEALS), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) };
});

const W = 375; const H = 812;
let fake; let host; let mod; let root; let realRect; let realSIV;
let trendTop = 1400;
let scrollCalls = [];

async function loadApp(idb) {
  vi.resetModules();
  globalThis.indexedDB = idb;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("./App.jsx");
  return { React, act: React.act, createRoot, App: App.default, openIdb: App.openIdb };
}
async function seed(kvEntries) {
  const db = await mod.openIdb();
  db.close?.();
  for (const [k, v] of Object.entries(kvEntries)) fake._peek("windToneLabDB", "kv").set(k, structuredClone(v));
}
const kv = (key) => fake._peek("windToneLabDB", "kv")?.get(key);
const tick = (ms = 5) => mod.act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function waitFor(pred, label, deadline = 10000) {
  const end = Date.now() + deadline;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label}`);
    await tick();
  }
}
const click = (el) => mod.act(async () => { el.click(); });
const nav = (label) => document.querySelector(`[data-bottom-nav] button[aria-label="${label}"]`);
const layer = () => document.querySelector("[data-coach-layer]");
const layerId = () => layer()?.getAttribute("data-coach-layer") ?? null;
const noticeEl = () => document.querySelector(".action-notice");
const buttonIn = (el, text) => [...(el?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === text) ?? null;
// My Data の式の行の2つのチップ(読み上げの名で引く)。中身は系列の綴り
const chip = (side) => document.querySelector(`button[aria-label="${side}本目の系列を選ぶ"]`)?.textContent.replace("▾", "").trim() ?? null;
const DAY_LABEL = /^(今日|\d+\/\d+)$/;

// 印: 前の版までの段は全部済み・新しい段も ⑮(idealSeen)以外は済み。みんなの平均の段(adoptAverage)も済み(案内が帯の邪魔をしない)。
const DONE = {
  migrated: true, migratedMeasureSteps: true, migratedCoach2: true,
  measure: true, reeds: true, reedsMeasure: true, join: true, adoptAverage: true, tuner: true, metronome: true,
  metroTempo: true, metroStart: true, goReeds: true, reedLinked: true, goData: true, calendarDay: true, daySession: true, trend: true,
};

beforeEach(() => {
  fake = createFakeIndexedDb();
  window.localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  auth.uid = "me";
  // 帯は5秒で溶けるが jsdom は animationend を出さないので、動きを減らす設定(帯も案内も溶けずにすぐ外れる)で描く。
  // ほかの問い合わせ(iPad の広い画面など)は false = iPhone の木。
  window.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = vi.fn();
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  trendTop = 1400;
  scrollCalls = [];
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    const box = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
    if (this.classList?.contains("coach-card")) return box(22, 0, W - 44, 146);
    if (this.getAttribute?.("data-coach") === "trend") return box(14, trendTop, 347, 380);
    return box(0, 0, 0, 0);
  };
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
  delete window.matchMedia;
});

async function start(kvEntries = {}) {
  mod = await loadApp(fake);
  await seed({ onboardingDone: DONE, ...kvEntries });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = mod.createRoot(host);
  await mod.act(async () => { root.render(mod.React.createElement(mod.App)); });
  await waitFor(() => nav("コミュニティ"), "下部タブ");
}
// コミュニティのデータの子タブ → みんなの平均カード → 確認のシートの「目安に設定」
async function adoptAverage() {
  await click(nav("コミュニティ"));
  const card = () => document.querySelector('.surf-card .card.card-accent[data-coach="adoptAverage"]');
  await waitFor(() => card(), "みんなの平均カード(押せる)");
  await click(card());
  await waitFor(() => document.querySelector('[role="dialog"][aria-label="みんなの平均を目安に設定しますか"]'), "確認のシート");
  await click(buttonIn(document.querySelector('[role="dialog"][aria-label="みんなの平均を目安に設定しますか"]'), "目安に設定"));
  await waitFor(() => noticeEl() && !document.querySelector('[role="dialog"][aria-label="みんなの平均を目安に設定しますか"]'), "帯");
}

describe("【便BW 本人裁定】目安に設定 → 帯の「見る」→ My Data の音の傾向カード(⑮)", () => {
  it("帯は「目安に設定しました」+「見る」(【審査】短くした)。押すと My Data・音の傾向カードへ送り・⑮。折れ線の既定は my平均 × 目安。押すと idealSeen", async () => {
    await start();
    await adoptAverage();
    // 【便BW 審査 統括の裁定】帯の文は短く(375 で語の途中から折れていた)。行き先は「見る」が持つ
    expect(noticeEl().querySelector('[aria-live="polite"]').textContent).toBe("目安に設定しました");
    expect(noticeEl().textContent).not.toContain("計測タブ");
    const see = buttonIn(noticeEl(), "見る");
    expect(see).not.toBe(null);
    expect(layer()).toBe(null);                     // 帯が出ている間は案内を出さない(既存の決まり)
    expect(scrollCalls).toEqual([]);
    await click(see);
    // データタブの My Data(下部タブの「データ」が選ばれ、My Data の目印が在る)
    await waitFor(() => document.querySelector('[data-coach-anchor="mydata"]'), "My Data");
    expect(nav("データ").style.color).toBe("var(--c-accent)");
    // 音の傾向カードまで送った(即座・中央)
    await waitFor(() => scrollCalls.length > 0, "スクロール");
    expect(scrollCalls[0]).toEqual(["trend", { block: "center", behavior: "auto" }]);
    // ⑮ は帯が消えてから出る
    await waitFor(() => layerId() === "idealSeen", "⑮");
    expect(noticeEl()).toBe(null);
    expect(layer().querySelector(".coach-title").textContent).toBe("みんなの平均を目安にしました");
    expect(layer().querySelector(".coach-line").textContent).toBe("my平均と目安を重ねて見られます");
    const hole = layer().querySelector(".coach-hole");
    expect([hole.style.left, hole.style.top, hole.style.width, hole.style.height]).toEqual(["14px", "216px", "347px", "380px"]);
    // 本人裁定: 目安があるときの既定は my平均 × 目安(本人がまだ選んでいない)
    expect(chip(1)).toBe("my平均");
    expect(chip(2)).toBe("目安");
    // 計測タブの絵は変えていない(⑮ は計測タブには出ない・計測タブで目安を描く所は足していない)
    expect(scrollCalls.every(([c]) => c === "trend")).toBe(true);
    // 押す=済
    await click(layer().querySelector(".coach-card"));
    await waitFor(() => kv("onboardingDone")?.idealSeen === true, "idealSeen の印");
    await tick(400);
    expect(layer()).toBe(null);
  }, 40000);

  it("2回目: 「見る」で移ってスクロールはするが、⑮ はもう出ない", async () => {
    await start({ onboardingDone: { ...DONE, idealSeen: true } });
    await adoptAverage();
    await click(buttonIn(noticeEl(), "見る"));
    await waitFor(() => document.querySelector('[data-coach-anchor="mydata"]'), "My Data");
    await waitFor(() => scrollCalls.length === 1, "スクロール");
    expect(scrollCalls[0]).toEqual(["trend", { block: "center", behavior: "auto" }]);
    await waitFor(() => noticeEl() === null, "帯が消える", 15000);
    await tick(400);
    expect(layer()).toBe(null);
  }, 40000);

  it("「見る」を押さずに自分でデータタブへ行った: ⑮ は出ない・印も立たない(折れ線の既定は my平均 × 目安)", async () => {
    await start();
    await adoptAverage();
    await click(nav("データ"));
    await waitFor(() => document.querySelector('[data-coach-anchor="mydata"]'), "My Data");
    await waitFor(() => noticeEl() === null, "帯が消える", 15000);
    await tick(400);
    expect(layer()).toBe(null);
    expect(scrollCalls).toEqual([]);
    expect(kv("onboardingDone").idealSeen).toBeUndefined();
    expect(chip(1)).toBe("my平均");
    expect(chip(2)).toBe("目安");
  }, 40000);
});

describe("【便BW 本人裁定】My Data の折れ線の既定: 目安があれば my平均 × 目安。本人が選んだ組は上書きしない", () => {
  const IDEAL = { id: "p1", name: "練習の目安", sourceKind: "session", saxType: "alto", notes: {} };
  it("目安なし: その日 × my平均(今までどおり)→ 目安を選ぶと my平均 × 目安 → 外すと戻る(まだ選んでいない間)", async () => {
    await start({ idealProfiles: [IDEAL] });
    await click(nav("データ"));
    await waitFor(() => chip(1) !== null, "式の行");
    const idealRow = () => [...document.querySelectorAll(".ctl-state")].find((d) => d.textContent.includes("練習の目安"));
    await waitFor(() => idealRow(), "目安の一覧");
    expect(chip(1)).toMatch(DAY_LABEL);
    expect(chip(2)).toBe("my平均");
    await click(idealRow());
    await waitFor(() => chip(2) === "目安", "目安を選ぶと既定が変わる");
    expect(chip(1)).toBe("my平均");
    await click(idealRow());   // 外す
    await waitFor(() => chip(2) === "my平均", "外すと今までの既定へ");
    expect(chip(1)).toMatch(DAY_LABEL);
  }, 40000);

  it("本人が一度選んだら、その組が残る(目安を付け外ししても既定で上書きしない)", async () => {
    await start({ idealProfiles: [IDEAL], selectedIdealId: "p1" });
    await click(nav("データ"));
    await waitFor(() => chip(2) === "目安", "目安ありの既定");
    expect(chip(1)).toBe("my平均");
    // 2本目を「その日」に選ぶ
    await click(document.querySelector('button[aria-label="2本目の系列を選ぶ"]'));
    await waitFor(() => document.querySelector('[role="dialog"][aria-label="2本目の系列"]'), "系列のシート");
    const dayItem = [...document.querySelectorAll('[role="dialog"][aria-label="2本目の系列"] button')].find((b) => DAY_LABEL.test(b.textContent.trim()));
    await click(dayItem);
    await waitFor(() => DAY_LABEL.test(chip(2) ?? ""), "選んだ組");
    expect(chip(1)).toBe("my平均");
    const idealRow = () => [...document.querySelectorAll(".ctl-state")].find((d) => d.textContent.includes("練習の目安"));
    await click(idealRow());   // 外す
    await tick(100);
    expect(chip(1)).toBe("my平均");
    expect(chip(2)).toMatch(DAY_LABEL);
    await click(idealRow());   // 付け直す
    await tick(100);
    expect(chip(1)).toBe("my平均");   // 既定(my平均 × 目安)で上書きしない
    expect(chip(2)).toMatch(DAY_LABEL);
  }, 40000);
});
