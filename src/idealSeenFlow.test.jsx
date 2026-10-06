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
// 【便BX 2026-10-06 本人の決定・凍結仕様 coach3-spec.md §2・§13.2】⑮ のあと ⑰「計測タブに戻ろう」(下部タブ「計測」)→ 計測タブで ⑱ 終わり(穴なし・
//   マイクを待たない)。コミュニティの到着(参加済みの人がタブを開いた直後)・⑭' → コミュニティ。下部タブの絵柄と平均カードの矩形は 375×812 の値を返す
//   (既存の検査には効かない: DONE は参加済み・adoptAverage 済・計測なしなので、⑪⑭'⑯ の的が在っても出ない)。
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
    // 【便BX】下部タブの絵柄(375 の4つ)・みんなの平均カード
    if (this.getAttribute?.("data-coach") === "adoptAverage") return box(14, 108, 347, 314);
    const pc = this.tagName?.toLowerCase() === "svg" ? this.parentElement?.getAttribute("data-coach") : null;
    const NAV_X = { "nav-measure": 46.88, "nav-reeds": 130.6, "nav-community": 214.4, "nav-analysis": 298.1 };
    if (pc && pc in NAV_X) return box(NAV_X[pc], 773, 30, 30);
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

async function start(kvEntries = {}, sessions = []) {
  mod = await loadApp(fake);
  await seed({ onboardingDone: DONE, ...kvEntries });
  for (const x of sessions) fake._peek("windToneLabDB", "sessions").set(x.id, structuredClone(x));
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

// ------------------------------------------------------------------
// 【便BX 2026-10-06 本人の決定 C・凍結仕様 coach3-spec.md §2・§9・§13.2】
// ------------------------------------------------------------------
// 計測の日時は「いま」(カレンダーの表示中の月)
const NOW_ISO = new Date(Date.now() - 60 * 1000).toISOString();
const SESSION = (id) => ({ id, recordedAt: NOW_ISO, saxType: "alto", reedId: null, linkedAt: null, memo: null, performer: "自分", source: "live", frames: [], barlines: [], noteEvents: [] });
// 4つ目の門まで済み・到着(リード・データ)は済み。⑮ ⑰ ⑱ と、コミュニティの到着・⑭' を見るための印
const GATE4 = { migratedCoach3: true, arriveReeds: true, arriveData: true };
// 作り物のマイク。gate が解けるまで getUserMedia が返らない(殻でタブへ戻ったときの取り直しの待ちと同じ形 = isListening が立たず、エラーも出ない)
function installPendingMic() {
  const gate = new Promise(() => {});
  Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => { await gate; return null; } }, configurable: true });
  window.AudioContext = class { constructor() { this.state = "running"; } resume() { return Promise.resolve(); } close() { return Promise.resolve(); } };
}
function removePendingMic() {
  delete window.AudioContext;
  try { delete window.navigator.mediaDevices; } catch { /* */ }
}
const hit = () => layer()?.querySelector('[data-coach-hit="all"]');

describe("【便BX】⑮ → ⑰ 計測タブに戻ろう → ⑱ 終わり(穴なし・マイクを待たない)", () => {
  afterEach(() => removePendingMic());
  it("⑮ を押すと ⑰(下部タブ「計測」の絵柄)。計測タブへ移ると goMeasure、マイクの取り直しの間でも ⑱。押すと finish、以後どのタブでも出ない", async () => {
    installPendingMic();
    // 【便BX 審査】goCommunity はコミュニティを開いたときに立つ(先に立てておくと、起動の計測タブで ⑱ が出る)
    await start({ onboardingDone: { ...DONE, ...GATE4, arriveCommunity: true } }, [SESSION("s1")]);
    await adoptAverage();
    await click(buttonIn(noticeEl(), "見る"));
    await waitFor(() => layerId() === "idealSeen", "⑮");
    await click(layer().querySelector(".coach-card"));
    await waitFor(() => kv("onboardingDone")?.idealSeen === true, "idealSeen の印");
    // ⑰
    await waitFor(() => layerId() === "goMeasure", "⑰ 計測タブに戻ろう");
    expect(layer().querySelector(".coach-title").textContent).toBe("計測タブに戻ろう");
    expect(layer().querySelector(".coach-line")).toBe(null);
    const h = layer().querySelector(".coach-hole");
    expect([h.style.left, h.style.top, h.style.width, h.style.height, h.style.borderRadius]).toEqual(["35.88px", "762px", "52px", "52px", "50%"]);
    expect(layer().querySelector(".coach-progress").getAttribute("aria-label")).toBe("案内 20/21");   // 【便BY】枚数の目印
    expect([...layer().querySelectorAll(".coach-progress > i.on")]).toHaveLength(20);
    expect(kv("onboardingDone").goMeasure).toBeUndefined();
    // 計測タブへ
    await click(nav("計測"));
    await waitFor(() => kv("onboardingDone")?.goMeasure === true, "goMeasure の印");
    await waitFor(() => layerId() === "finish", "⑱ 終わり");
    expect(document.querySelector('[role="dialog"][aria-label="エラー"]')).toBe(null);   // マイクはまだ取れていない(エラーでもない)
    expect(layer().querySelector(".coach-hole")).toBe(null);
    expect(layer().querySelectorAll(".coach-dim")).toHaveLength(1);
    expect(layer().querySelector(".coach-title").textContent).toBe("チューナーとメトロノームを使って、あなたのデータを貯めよう！");
    expect(layer().querySelector(".coach-line").textContent).toBe("はじめの案内はこれで終わりです");
    expect(layer().querySelector(".coach-progress").getAttribute("aria-label")).toBe("案内 21/21");   // 【便BY】枚数の目印
    expect([...layer().querySelectorAll(".coach-progress > i.on")]).toHaveLength(21);
    await click(hit());
    await waitFor(() => kv("onboardingDone")?.finish === true, "finish の印");
    await waitFor(() => layer() === null, "終わり");
    for (const label of ["リード", "データ", "コミュニティ", "計測"]) {
      await click(nav(label));
      let seen = null;
      for (let i = 0; i < 16; i++) { if (layer()) seen = layerId(); await tick(25); }
      expect(seen, label).toBe(null);
    }
  }, 60000);
});

describe("【便BX】コミュニティの到着・⑭' → コミュニティ", () => {
  it("参加済みの人がコミュニティを開く: 到着「ここはコミュニティ」(穴なし)→ 押すと arriveCommunity → ⑯ みんなの平均カード", async () => {
    const { adoptAverage: _a, ...noAdopt } = DONE;
    await start({ onboardingDone: { ...noAdopt, ...GATE4 } });
    await click(nav("コミュニティ"));
    await waitFor(() => layerId() === "arriveCommunity", "到着");
    expect(layer().querySelector(".coach-title").textContent).toBe("ここはコミュニティ");
    expect(layer().querySelector(".coach-line").textContent).toBe("参加した人の計測データと、みんなの平均が見られます");
    expect(layer().querySelector(".coach-hole")).toBe(null);
    expect(layer().querySelector(".coach-progress").getAttribute("aria-label")).toBe("案内 17/21");   // 【便BY】枚数の目印
    expect([...layer().querySelectorAll(".coach-progress > i.on")]).toHaveLength(17);
    await click(layer().querySelector(".coach-card"));
    await waitFor(() => kv("onboardingDone")?.arriveCommunity === true, "arriveCommunity の印");
    await waitFor(() => layerId() === "adoptAverage", "⑯");
  }, 40000);

  it("⑭' みんなのデータも見てみよう → 下部タブ「コミュニティ」: goCommunity が立ち、(参加済みと分かって join)到着が出る", async () => {
    const { join: _j, adoptAverage: _a, ...rest } = DONE;
    await start({ onboardingDone: { ...rest, ...GATE4 } }, [SESSION("s1")]);
    await click(nav("データ"));
    await waitFor(() => layerId() === "goCommunity", "⑭'");
    const h = layer().querySelector(".coach-hole");
    expect([h.style.left, h.style.top, h.style.width, h.style.height]).toEqual(["203.4px", "762px", "52px", "52px"]);
    await click(nav("コミュニティ"));
    await waitFor(() => kv("onboardingDone")?.goCommunity === true, "goCommunity の印");
    await waitFor(() => kv("onboardingDone")?.join === true, "join の印(参加済みと分かった)");
    await waitFor(() => layerId() === "arriveCommunity", "到着");
  }, 40000);

  it("既存の利用者(計測あり・参加済み・みんなの平均の目安あり): 4つ目の門で到着は済み。コミュニティを開いても何も出ない", async () => {
    mod = await loadApp(fake);
    await seed({ idealProfiles: [{ id: "p3", name: "みんなの平均（クラシック 学生）", sourceKind: "community", saxType: "alto", notes: {} }] });
    fake._peek("windToneLabDB", "sessions").set("s1", SESSION("s1"));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = mod.createRoot(host);
    await mod.act(async () => { root.render(mod.React.createElement(mod.App)); });
    await waitFor(() => kv("onboardingDone")?.migratedCoach3 === true, "移行の印");
    await click(nav("コミュニティ"));
    await waitFor(() => kv("onboardingDone")?.join === true, "join の印");
    let seen = null;
    for (let i = 0; i < 16; i++) { if (layer()) seen = layerId(); await tick(25); }
    expect(seen).toBe(null);
  }, 40000);
});

// ------------------------------------------------------------------
// 【便BX 審査 2026-10-06 統括の裁定】⑱ に「参加・目安にする・5秒以内の『見る』」が全部要って、どれかが欠けると案内が黙って止まっていた。
//   ⑱ は「コミュニティを見たあと計測タブにいる」で出し、⑰ と印 goMeasure は「目安にした」だけでも立つ。3つの道をアプリで通す。
//   あわせて §13.2「帯の種類」: 目安の帯(coach を持たない)が出ている間は、計測タブでも段を出さない(帯が消えてから ⑱)。
// ------------------------------------------------------------------
const BASE_X = {
  migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true,
  measure: true, reeds: true, reedsMeasure: true, tuner: true, metronome: true, metroTempo: true, metroStart: true, goReeds: true, reedLinked: true,
  goData: true, arriveReeds: true, arriveData: true, calendarDay: true, daySession: true, trend: true,
};
const noLayerOnAllTabs = async () => {
  const seen = {};
  for (const label of ["リード", "データ", "コミュニティ", "計測"]) {
    await click(nav(label));
    seen[label] = null;
    for (let i = 0; i < 16; i++) { if (layer()) seen[label] = layerId(); await tick(25); }
  }
  return seen;
};
const NONE4 = { リード: null, データ: null, コミュニティ: null, 計測: null };

describe("【便BX 審査】⑱ への3つの道", () => {
  afterEach(() => removePendingMic());

  it("参加を見送る: ⑭' → コミュニティ(参加の画面)を見ただけで計測タブへ戻ると ⑱。押すと終わり、4つのタブとも何も出ない", async () => {
    installPendingMic();
    auth.uid = null;   // 参加していない(参加の画面が出る)
    await start({ onboardingDone: BASE_X }, [SESSION("s1")]);
    await tick(200);
    expect(layer()).toBe(null);                        // 起動の計測タブ: まだコミュニティを見ていないので ⑱ は出ない
    await click(nav("データ"));
    await waitFor(() => layerId() === "goCommunity", "⑭'");
    await click(nav("コミュニティ"));
    await waitFor(() => document.querySelector("[data-join-card]"), "参加の画面");
    await waitFor(() => kv("onboardingDone")?.goCommunity === true, "goCommunity の印");
    expect(kv("onboardingDone").join).toBeUndefined();
    await click(nav("計測"));
    await waitFor(() => layerId() === "finish", "⑱");
    await click(hit());
    await waitFor(() => kv("onboardingDone")?.finish === true, "finish の印");
    await waitFor(() => layer() === null, "終わり");
    expect(await noLayerOnAllTabs()).toEqual(NONE4);
    expect(kv("onboardingDone").goMeasure).toBeUndefined();
  }, 60000);

  it("「見る」を押さない(目安の帯の間に計測タブ): 帯が出ている間は ⑱ も出さない。帯が消えると ⑱(goMeasure も立つ)。終わったあとは何も出ない", async () => {
    installPendingMic();
    await start({ onboardingDone: { ...BASE_X, join: true, arriveCommunity: true } }, [SESSION("s1")]);
    await tick(200);
    expect(layer()).toBe(null);
    await adoptAverage();
    expect(buttonIn(noticeEl(), "見る")).not.toBe(null);
    await click(nav("計測"));
    // 目安の帯(coach を持たない)が出ている間は、計測タブでも段を出さない(§13.2「帯の種類」)
    let seenDuring = null;
    for (let i = 0; i < 20 && noticeEl(); i++) { if (layer()) seenDuring = layerId(); await tick(25); }
    expect(noticeEl()).not.toBe(null);
    expect(seenDuring).toBe(null);
    await waitFor(() => noticeEl() === null, "帯が消える", 15000);
    await waitFor(() => layerId() === "finish", "⑱");
    await waitFor(() => kv("onboardingDone")?.goMeasure === true, "goMeasure の印(目安にした)");
    expect(kv("onboardingDone").idealSeen).toBeUndefined();
    await click(hit());
    await waitFor(() => kv("onboardingDone")?.finish === true, "finish の印");
    await waitFor(() => layer() === null, "終わり");
    expect(await noLayerOnAllTabs()).toEqual(NONE4);
  }, 60000);

  it("「見る」を押さずにデータタブへ: 帯が消えると ⑰(目安にしただけでも)→ 計測タブで ⑱", async () => {
    installPendingMic();
    await start({ onboardingDone: { ...BASE_X, join: true, arriveCommunity: true } }, [SESSION("s1")]);
    await adoptAverage();
    await click(nav("データ"));
    await waitFor(() => noticeEl() === null, "帯が消える", 15000);
    await waitFor(() => layerId() === "goMeasure", "⑰");
    expect(scrollCalls).toEqual([]);   // ⑮ は「見る」から来たときだけ(送りもしない)
    await click(nav("計測"));
    await waitFor(() => kv("onboardingDone")?.goMeasure === true, "goMeasure の印");
    await waitFor(() => layerId() === "finish", "⑱");
  }, 60000);

  it("「見る」の前にアプリを閉じる: 開き直すと計測タブ(起動のタブ)で goMeasure が立ち ⑱", async () => {
    installPendingMic();
    await start({ onboardingDone: { ...BASE_X, join: true, arriveCommunity: true } }, [SESSION("s1")]);
    await adoptAverage();
    await waitFor(() => kv("onboardingDone")?.adoptAverage === true && kv("onboardingDone")?.goCommunity === true, "adoptAverage・goCommunity の印");
    // 閉じる(「見る」は押していない)→ 開き直す
    await mod.act(async () => root.unmount()); root = null; host.remove();
    mod = await loadApp(fake);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = mod.createRoot(host);
    await mod.act(async () => { root.render(mod.React.createElement(mod.App)); });
    await waitFor(() => layerId() === "finish", "開き直すと ⑱");
    await waitFor(() => kv("onboardingDone")?.goMeasure === true, "goMeasure の印");
    expect(kv("onboardingDone").idealSeen).toBeUndefined();
  }, 60000);
});
