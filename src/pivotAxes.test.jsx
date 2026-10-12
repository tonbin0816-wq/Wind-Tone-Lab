// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便CL 2026-10-11 本人裁定】データタブ「分析」の縦軸・横軸・⇄・問い・秒・散布図を、本物のアプリを描いて確かめる。
//   ・縦軸と横軸の一覧は同じ(数値7 → 項目12)。項目は縦横どちらか一方だけ / もう一方で選ばれているものは薄く(.35)押せない
//   ・⇄ は縦と横の選択をそのまま入れ替える(何度でも)
//   ・問いのピルは縦軸・横軸・分析軸を一度に書き(抽出条件は触らない)、今の組と一致するピルだけが押された状態になる
//   ・項目ごとの秒(フレーム数 × 0.1秒。--c-ink-3)・その系列のその項目が20秒未満の点は .4・グラフの下に合計の秒(無いときは出さない)
//   ・数値 × 数値は散布図: 点は canvas に**全部**描き(間引かない)、色は CSS のトークンを getComputedStyle で読む。
//     濃さは 9/√点数(上限 .25)・平均の線と幅ごとの点・音程(¢)の軸は 0 を含む
//   ・⇄ は縦軸と横軸の間の専用の列(28px)に置き、当たり判定はその列と左右の溝(44×44)。どのセルの値や ▾ にも掛けない(配置の実測は報告。ここは式の綴りを縛る)
// 期待値はここに手で書いた(実装の定数から読まない)。純関数の細かい決まり(押せない行の全組・幅ごとの平均・ゲート・
// パーセンタイル・重み・負の値の幅の境目)は scripts/pitch-test.mjs の検証CL が実ソースを抜き出して見る。
// 【守っていないもの】見た目の実寸(⇄ の丸が値の行の高さにそろうこと・点の濃さ・iPhone での描画)。jsdom は配置も canvas も無い
//   (getBoundingClientRect と getContext は作り物)。実寸は Browser ペインの 375 幅で測り、報告にスクショを付けた。
// サーバーは作り物(Firebase に触らない・アカウントを作らない)。IndexedDB も作り物。
// ------------------------------------------------------------------

vi.mock("./community/accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => null),
  loadProfile: vi.fn(async () => null),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => { throw new Error("検査: サインインしない"); }),
}));
vi.mock("./community/directory.js", async (orig) => ({ ...(await orig()), listPublicUsers: vi.fn(async () => []), publishStats: vi.fn(async () => {}) }));
vi.mock("./community/idealRepo.js", async (orig) => ({ ...(await orig()), listIdeals: vi.fn(async () => []), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) }));

let fake; let host; let mod; let root; let realRect; let realGetContext; let draws;

async function loadApp() {
  vi.resetModules();
  globalThis.indexedDB = fake;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("./App.jsx");
  return { React, act: React.act, createRoot, App: App.default, openIdb: App.openIdb, warm: App.warmPersistedStateCache };
}
async function seed({ kvEntries = {}, sessions = [] } = {}) {
  const db = await mod.openIdb();
  db.close?.();
  for (const [k, v] of Object.entries(kvEntries)) fake._peek("windToneLabDB", "kv").set(k, structuredClone(v));
  for (const s of sessions) fake._peek("windToneLabDB", "sessions").set(s.id, structuredClone(s));
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
const btn = (label) => document.querySelector(`button[aria-label="${label}"]`);
const byText = (t) => [...document.querySelectorAll("button")].find((b) => b.textContent === t) ?? null;
const valueOf = (label) => btn(label)?.children[1]?.textContent.replace("▾", "").trim();
const options = () => [...document.querySelectorAll('[role="option"]')];
const optionState = () => Object.fromEntries(options().map((o) => [o.textContent.replace("✓", ""), { disabled: o.disabled, selected: o.getAttribute("aria-selected") === "true", opacity: o.style.opacity }]));
const pressedQuestions = () => [...document.querySelectorAll('[data-noswipe] button[aria-pressed="true"]')].map((b) => b.textContent);
// 分析のグラフのカード(操作のカードの次の次。間は 12px の余白)
const graphCard = () => btn("縦軸を選ぶ")?.closest(".card")?.nextElementSibling?.nextElementSibling ?? null;
const closeSheet = async () => { await mod.act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); }); await tick(); };

// 1つの音 = 同じ運指(semitoneIndex)のフレームが 0.1秒ごとに n 個。
function note(si, n, t0, f = () => ({})) {
  const hz = 440 * Math.pow(2, (49 + si - 69) / 12);
  return Array.from({ length: n }, (_, i) => {
    const o = { cents: 0, vol: -25, hnr: 20, ...f(i) };
    return {
      t: +(t0 + i * 0.1).toFixed(2), semitoneIndex: si, pitchHz: hz * Math.pow(2, o.cents / 1200), pitchCents: o.cents,
      clarity: 0.9, noteAgeMs: i * 100, volumeDb: o.vol, hnrDb: o.hnr, spectralCentroidHz: 1000,
      harmonics: Array.from({ length: 8 }, (_, k) => ({ n: k + 1, freqHz: hz * (k + 1), levelNorm: 0.5 })),
    };
  });
}
const DONE = Object.fromEntries(["measure", "reeds", "reedsMeasure", "adoptAverage", "tuner", "metronome", "dataSeen",
  "metroTempo", "metroStart", "goReeds", "reedLinked", "goData", "calendarDay", "daySession", "trend", "idealSeen",
  "arriveReeds", "arriveData", "arriveCommunity", "goCommunity", "goMeasure", "finish", "goCompare"].map((k) => [k, true]));
Object.assign(DONE, { migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true });

// 音 A: 300 フレーム(両端のゲートで 4 つ落ちて 296 = 30秒)/ 音 B: 100 フレーム(96 = 10秒 → 20秒未満で薄い)。
// 音量は -40〜-11 を順に回す(散布図の点の数 = 音程のゲートを通ったフレーム数 392)。
const vol = (i) => -40 + (i % 30);
const SESSION = {
  id: "s1", recordedAt: "2026-10-10T10:00:00.000Z", saxType: "alto", reedId: null, performer: "自分", source: "live", memo: null,
  frames: [...note(16, 300, 0, (i) => ({ vol: vol(i), cents: 0.4 * (vol(i) + 25) })), ...note(18, 100, 31, (i) => ({ vol: vol(i), cents: 3 }))],
  barlines: [], noteEvents: [],
};

async function openAnalysis({ sessions = [] } = {}) {
  mod = await loadApp();
  await seed({ kvEntries: { onboardingDone: DONE, onboardingShown: true, termsConsent: { at: "2026-10-10T00:00:00.000Z", version: "2026-10-08" } }, sessions });
  await mod.warm?.();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = mod.createRoot(host);
  await mod.act(async () => { root.render(mod.React.createElement(mod.App)); });
  await waitFor(() => btn("データ"), "下部タブ");
  await click(btn("データ"));
  await waitFor(() => byText("分析"), "子タブ");
  await click(byText("分析"));
  await waitFor(() => btn("縦軸を選ぶ"), "軸のセレクタ");
  if (sessions.length) await waitFor(() => document.querySelector("svg circle"), "グラフ");
}

beforeEach(() => {
  fake = createFakeIndexedDb();
  window.localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  window.scrollTo = vi.fn();
  window.Element.prototype.scrollIntoView = function () {};
  // グラフは器の実測幅で描く(0 なら描かない)。どの箱も 311 幅を返す。
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 311, height: 44, right: 311, bottom: 44, x: 0, y: 0 };
  };
  // canvas の作り物。点(fillRect)の数と、そのときの色を控える。
  draws = [];
  realGetContext = window.HTMLCanvasElement.prototype.getContext;
  window.HTMLCanvasElement.prototype.getContext = function () {
    const ctx = {
      fillStyle: "", globalAlpha: 1,
      setTransform() {}, clearRect() { draws.push({ clear: true }); },
      fillRect() { draws.push({ color: ctx.fillStyle, alpha: ctx.globalAlpha }); },
    };
    return ctx;
  };
  document.documentElement.style.setProperty("--c-accent", "#174585");
  document.documentElement.style.setProperty("--c-accent-mid", "#7FA0CE");
  document.documentElement.removeAttribute("data-theme");
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  window.Element.prototype.getBoundingClientRect = realRect;
  window.HTMLCanvasElement.prototype.getContext = realGetContext;
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

describe("分析の縦軸・横軸の一覧(便CL)", () => {
  it("既定は縦=音名・横=音程(¢)。縦の一覧: 数値 → 項目、横で選んでいる音程(¢)だけ押せない", async () => {
    await openAnalysis();
    expect(valueOf("縦軸を選ぶ")).toBe("音名");
    expect(valueOf("横軸を選ぶ")).toBe("音程(¢)");
    await click(btn("縦軸を選ぶ"));
    const st = optionState();
    expect(Object.keys(st)).toEqual(["音程(¢)", "ピッチ(Hz)", "音量(dB)", "倍音強度(低次1-4)", "倍音強度(高次5-8)", "HNR(dB)", "重心(Hz)",
      "音名", "音域帯", "リード(個体)", "リードメーカー", "リード番手", "リード主観評価", "開封後日数", "録音日", "奏者", "サックス種別", "データ種別", "メモ"]);
    expect(st["音程(¢)"]).toMatchObject({ disabled: true, opacity: "0.35" });
    expect(st["音名"]).toMatchObject({ disabled: false, selected: true });
    expect(Object.entries(st).filter(([, v]) => v.disabled).map(([k]) => k)).toEqual(["音程(¢)"]);
    // 見出しは「数値」「項目」だけ(説明文は出さない)
    const sheetText = document.querySelector('[role="dialog"]').textContent;
    expect(sheetText).toContain("数値");
    expect(sheetText).toContain("項目");
    expect(sheetText).not.toContain("選べません");
    // 読み上げ: まとまりごとに role="group" + aria-label。行はそれぞれのまとまりの中
    const groups = [...document.querySelectorAll('[role="listbox"] > [role="group"]')];
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["数値", "項目"]);
    expect(groups.map((g) => g.querySelectorAll('[role="option"]').length)).toEqual([7, 12]);
  });

  it("横の一覧: 縦が項目なので項目は全部押せない(薄い)。押せない行を押しても何も変わらず、シートも閉じない", async () => {
    await openAnalysis();
    await click(btn("横軸を選ぶ"));
    const st = optionState();
    const dims = ["音名", "音域帯", "リード(個体)", "リードメーカー", "リード番手", "リード主観評価", "開封後日数", "録音日", "奏者", "サックス種別", "データ種別", "メモ"];
    expect(dims.every((k) => st[k].disabled && st[k].opacity === "0.35")).toBe(true);
    expect(["ピッチ(Hz)", "音量(dB)", "HNR(dB)"].every((k) => !st[k].disabled)).toBe(true);
    await click(options().find((o) => o.textContent === "録音日"));
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await closeSheet();
    expect(valueOf("横軸を選ぶ")).toBe("音程(¢)");
    // 押せる行を押すと書かれる
    await click(btn("横軸を選ぶ"));
    await click(options().find((o) => o.textContent === "音量(dB)"));
    expect(valueOf("横軸を選ぶ")).toBe("音量(dB)");
  });

  it("縦を数値にすると、横の一覧の項目が押せるようになり、縦の数値だけ押せない", async () => {
    await openAnalysis();
    await click(btn("縦軸を選ぶ"));
    await click(options().find((o) => o.textContent === "HNR(dB)"));
    expect(valueOf("縦軸を選ぶ")).toBe("HNR(dB)");
    await click(btn("横軸を選ぶ"));
    const st = optionState();
    expect(Object.entries(st).filter(([, v]) => v.disabled).map(([k]) => k)).toEqual(["HNR(dB)"]);
  });
});

describe("⇄ と問い(便CL)", () => {
  it("⇄ は縦と横の選択をそのまま入れ替える(もう一度押すと戻る)。当たり判定の名前は「縦軸と横軸を入れ替える」", async () => {
    await openAnalysis();
    const sw = btn("縦軸と横軸を入れ替える");
    expect(sw).toBeTruthy();
    await click(sw);
    expect([valueOf("縦軸を選ぶ"), valueOf("横軸を選ぶ")]).toEqual(["音程(¢)", "音名"]);
    await click(btn("縦軸と横軸を入れ替える"));
    expect([valueOf("縦軸を選ぶ"), valueOf("横軸を選ぶ")]).toEqual(["音名", "音程(¢)"]);
  });

  it("問いは縦軸・横軸・分析軸を一度に書き、抽出条件は触らない。一致するピルだけが押された状態", async () => {
    await openAnalysis();
    const qs = [...document.querySelectorAll("[data-noswipe] button[aria-pressed]")].map((b) => b.textContent);
    expect(qs).toEqual(["音程の癖は?", "音量で音程は変わる?", "音量で音色は変わる?", "リードで音程は変わる?", "リードで音色は違う?"]);
    // 既定(分析軸=リードメーカー)はどの問いとも一致しない
    expect(pressedQuestions()).toEqual([]);
    const chipsBefore = document.querySelector('button[aria-label="集計の条件を追加"]').parentElement.textContent;
    await click(byText("音量で音色は変わる?"));
    expect([valueOf("縦軸を選ぶ"), valueOf("横軸を選ぶ"), valueOf("分析軸(色で分ける単位)を選ぶ")]).toEqual(["HNR(dB)", "音量(dB)", "なし(全体)"]);
    expect(pressedQuestions()).toEqual(["音量で音色は変わる?"]);
    expect(document.querySelector('button[aria-label="集計の条件を追加"]').parentElement.textContent).toBe(chipsBefore);
    await click(byText("リードで音色は違う?"));
    expect([valueOf("縦軸を選ぶ"), valueOf("横軸を選ぶ"), valueOf("分析軸(色で分ける単位)を選ぶ")]).toEqual(["音名", "HNR(dB)", "リード(個体)"]);
    expect(pressedQuestions()).toEqual(["リードで音色は違う?"]);
    // 軸を手で変えて組がずれたら、どのピルも押された状態ではない(別の状態を持たない)
    await click(btn("縦軸と横軸を入れ替える"));
    expect(pressedQuestions()).toEqual([]);
  });
});

describe("秒・薄い点・散布図(便CL)", () => {
  // グラフのカードの下の合計の秒(カードの外)。データが無いときは出ない。
  const totalEl = () => document.querySelector("[data-pivot-total]");
  const chartSvg = () => [...graphCard().querySelectorAll("svg")].find((x) => x.querySelector("circle"));

  it("縦=項目: 行の右に秒、20秒未満の点は .4、グラフの下に合計の秒", async () => {
    await openAnalysis({ sessions: [SESSION] });
    const svg = chartSvg();
    const secs = [...svg.querySelectorAll("text")].map((t) => t.textContent).filter((s) => /秒$/.test(s));
    expect(secs.sort()).toEqual(["10秒", "30秒"]);
    const circles = [...svg.querySelectorAll("circle")];
    const rowSecs = [...svg.querySelectorAll("text")].map((t) => t.textContent).filter((s) => /秒$/.test(s));
    expect(circles.length).toBe(2);
    circles.forEach((c, i) => expect(c.getAttribute("opacity")).toBe(rowSecs[i] === "10秒" ? "0.4" : null));
    // 秒は読ませる字なので --c-ink-3(ink-4 は目盛まで。DESIGN-SYSTEM §1.1)
    expect([...svg.querySelectorAll("text")].filter((t) => /秒$/.test(t.textContent)).every((t) => t.getAttribute("fill") === "var(--c-ink-3)")).toBe(true);
    expect(totalEl()?.textContent).toBe("39秒");
    expect(graphCard().contains(totalEl())).toBe(false);
  });

  it("横=項目(⇄ のあと): 項目名の下に秒、20秒未満の点は .4", async () => {
    await openAnalysis({ sessions: [SESSION] });
    await click(btn("縦軸と横軸を入れ替える"));
    const svg = chartSvg();
    const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts.filter((s) => /秒$/.test(s)).sort()).toEqual(["10秒", "30秒"]);
    expect([...svg.querySelectorAll("circle")].map((c) => c.getAttribute("opacity")).sort()).toEqual(["0.4", null].sort());
  });

  it("分析軸で2系列: 行の秒は系列を足した秒、薄くするのはその系列のその項目が20秒未満の点だけ", async () => {
    // 同じ音を 奏者A 300 フレーム(30秒)・奏者B 100 フレーム(10秒)。行の秒は 39秒(20秒以上)。B の点だけ薄い。
    const A = { ...SESSION, id: "a", performer: "A", frames: note(16, 300, 0) };
    const B = { ...SESSION, id: "b", performer: "B", recordedAt: "2026-10-09T10:00:00.000Z", frames: note(16, 100, 0) };
    await openAnalysis({ sessions: [A, B] });
    await click(btn("分析軸(色で分ける単位)を選ぶ"));
    await click(options().find((o) => o.textContent === "奏者"));
    const svg = chartSvg();
    expect([...svg.querySelectorAll("text")].map((t) => t.textContent).filter((s) => /秒$/.test(s))).toEqual(["39秒"]);
    // 系列は分析軸の値の順(A → B)に1つずつ <g>。A の点は濃く、B の点は .4
    const groups = [...svg.querySelectorAll("g")].filter((g) => g.querySelector("circle"));
    expect(groups.map((g) => g.querySelector("circle").getAttribute("opacity"))).toEqual([null, "0.4"]);
  });

  it("データが無いとき: 合計の秒は出さない。空の文言は折れ線 / 散布図で言い分ける", async () => {
    await openAnalysis();
    expect(totalEl()).toBe(null);
    expect(graphCard().textContent).toContain("ここに折れ線が育ちます");
    await click(byText("音量で音程は変わる?"));
    expect(totalEl()).toBe(null);
    expect(graphCard().textContent).toContain("ここに点が育ちます");
    expect(graphCard().textContent).not.toContain("折れ線");
  });

  it("数値 × 数値: 点は canvas に全部描き(間引かない)、色はトークンを読む。合計の秒は点の数", async () => {
    await openAnalysis({ sessions: [SESSION] });
    draws = [];
    await click(byText("音量で音程は変わる?"));
    await waitFor(() => graphCard()?.querySelector("canvas"), "散布図");
    await tick();
    const pts = draws.filter((d) => !d.clear);
    expect(pts.length).toBe(392);                                   // 音程のゲートを通った 296 + 96 点を全部
    expect(new Set(pts.map((d) => d.color))).toEqual(new Set(["#174585"]));
    expect(graphCard().textContent).toContain("全体");
    expect(graphCard().textContent).toContain("39秒");    // 凡例の系列ごとの秒
    expect(graphCard().textContent).toContain("縦 ¢ · 横 dB");
    expect(totalEl()?.textContent).toBe("39秒");          // カードの下の合計(散布図は点の数)
  });

  it("数値 × 数値(1,296 点を超える): 濃さは 9/√点数・平均の線と幅ごとの点・音程(¢)の軸は 0 を含む", async () => {
    // 1 つの音を 1,500 フレーム。音量は -30 / -29 / -28 dB を順に回し(1dB の幅が3つ、どれも 20 点以上)、
    // 音程は +5〜+7¢(全部プラス)。ゲートを通るのは両端の 4 つを除いた 1,496 点。
    const BIG = { ...SESSION, id: "big", frames: note(16, 1500, 0, (i) => ({ vol: -30 + (i % 3), cents: 5 + (i % 3) })) };
    await openAnalysis({ sessions: [BIG] });
    draws = [];
    await click(byText("音量で音程は変わる?"));
    await waitFor(() => graphCard()?.querySelector("canvas"), "散布図");
    await tick();
    const pts = draws.filter((d) => !d.clear);
    expect(pts.length).toBe(1496);
    expect(pts[0].alpha).toBeCloseTo(9 / Math.sqrt(1496), 6);       // 0.2327(上限 .25 より小さい)
    expect(pts[0].alpha).toBeLessThan(0.25);
    // 平均の線(上に重ねた SVG): 3 つの幅を1本で結び、幅ごとに平均の点 3 つ
    const overlay = [...graphCard().querySelectorAll("svg")].find((x) => x.querySelector("polyline"));
    expect(overlay).toBeTruthy();
    const lines = [...overlay.querySelectorAll("polyline")];
    expect(lines.length).toBe(1);
    expect(lines[0].getAttribute("points").trim().split(/\s+/).length).toBe(3);
    expect(overlay.querySelectorAll("circle").length).toBe(3);
    // 平均の点の x はその幅の点の平均(音量 -30 / -29 / -28 dB ちょうど。幅の中央ではない)なので等間隔・昇順
    const cx = [...overlay.querySelectorAll("circle")].map((c) => Number(c.getAttribute("cx")));
    expect(cx[1] - cx[0]).toBeGreaterThan(0);
    expect(Math.abs((cx[2] - cx[1]) - (cx[1] - cx[0]))).toBeLessThan(1e-6);
    // 音程(¢)が全部プラスでも、縦の範囲は 0 を含む → 0 の線(--c-line-strong)とラベル「0.0」
    const base = [...graphCard().querySelectorAll("svg")].find((x) => x.querySelector("text") && !x.querySelector("polyline") && x.querySelector("line"));
    expect([...base.querySelectorAll("line")].some((l) => l.getAttribute("stroke") === "var(--c-line-strong)")).toBe(true);
    expect([...base.querySelectorAll("text")].some((t) => t.textContent === "0.0")).toBe(true);
    expect(totalEl()?.textContent).toBe("150秒");
  });
});

describe("⇄ の列(便CL 統括の決定・再審査)", () => {
  it("軸の行は 縦軸 | ⇄ | 横軸 | 分析軸 の4列。当たり判定は ⇄ の列+左右の溝で、どのセルの値・▾ にも掛けない", async () => {
    await openAnalysis();
    const grid = btn("縦軸を選ぶ").parentElement.parentElement;
    expect(grid.style.gridTemplateColumns).toBe("1fr 28px 1fr 1fr");
    expect(grid.style.gap).toBe("var(--sp-2)");
    // 子の並び: 縦軸のセル → ⇄ の列 → 横軸のセル → 分析軸のセル
    const kids = [...grid.children];
    expect(kids.length).toBe(4);
    expect(kids[0].contains(btn("縦軸を選ぶ"))).toBe(true);
    expect(kids[1].contains(btn("縦軸と横軸を入れ替える"))).toBe(true);
    expect(kids[2].contains(btn("横軸を選ぶ"))).toBe(true);
    expect(kids[3].contains(btn("分析軸(色で分ける単位)を選ぶ"))).toBe(true);
    // 当たり判定は列の左右の溝の端まで(28 + 8 + 8 = 44)・高さは行いっぱい。上下にははみ出さない
    const sw = btn("縦軸と横軸を入れ替える");
    expect([sw.style.position, sw.style.top, sw.style.bottom]).toEqual(["absolute", "0px", "0px"]);
    expect([sw.style.left, sw.style.right]).toEqual(["calc(var(--sp-2) * -1)", "calc(var(--sp-2) * -1)"]);
    expect([sw.style.minWidth, sw.style.minHeight]).toEqual(["var(--tap-min)", "var(--tap-min)"]);
    // 3つのセルの値は列の幅をまるごと使う(空きを取らない)
    for (const a of ["縦軸を選ぶ", "横軸を選ぶ", "分析軸(色で分ける単位)を選ぶ"]) expect(btn(a).style.maxWidth).toBe("100%");
    // ⇄ を押すと入れ替わる(列に移しても動きは同じ)
    await click(sw);
    expect([valueOf("縦軸を選ぶ"), valueOf("横軸を選ぶ")]).toEqual(["音程(¢)", "音名"]);
  });
});
