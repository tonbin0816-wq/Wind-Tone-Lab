// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";
import { REPORT_REASONS } from "./community/report.js";

// ------------------------------------------------------------------
// 【便BV 2026-10-04 本人裁定(案B)】iPad の「広い」画面のコミュニティタブ。
//   データ・順位 = 2ペイン(左 = 一覧・右 = 人物のページ PersonBody)/ シェア・マイページ = 列(--page-max-w)/
//   参加前の画面(JoinIntro)の裏の見本も2ペインの形。
// 本物のアプリ(WindToneLabPhaseMode)を描き、作り物の matchMedia で WIDE_LAYOUT_QUERY にだけ真偽を返して広い木 / 狭い木を描き分ける
// (ほかの検査は matchMedia が全部 false = 狭い木。iPhone の木はそちらと pitch-test が見ている)。作り方は wideLayoutReeds.test.jsx と同じ。
// サーバーは作り物(accountRepo / directory / idealRepo / reportRepo の読み書きだけを差し替える。Firebase に触らない)。
// IndexedDB も作り物。見本の人は blockKit.testutil.jsx の4人(しろねこ・くろねこ・みけねこ・とらねこ)と、その目安。
// 見ること:
//   (1) 広い: 形 ── 器(--pane-max-w)・.pane-2 はデータと順位の2つ・右に data-noswipe・右が空なら1行・シェアとマイページは列
//   (2) 広い: データの行を押すと右に人物のページ(シートは開かない)。表に出ている子タブのペインにだけ描く。
//       別の人を押すと作り直される(前の人で開いたタブを持ち越さない)。本文の器は subPageStyle
//   (3) 広い: 子タブを替えると右は空に戻る / 順位の行からも右に開く / 列のページ(シェア)には人を描かない
//   (4) 広い: 人物のページの中の操作 ── ブロック(右は空・左の一覧から消える)/ 通報(シートは body・「ブロックしない」で右に戻る・
//       「通報しました」の1行は右ペイン)/ 目安に設定(貼り付く bottom は右ペインの下端から --sp-3・押すと右ペインに1行)
//   【便BV3】2ペインの画面は高さ固定の枠(.pane-frame)・SwipePager は fill(列のページ = シェア・マイページでは外れる)/
//       「目安に設定」はペインでは浮かせるボタン(body へ portal・右ペインの右下)/ 条件が変わったら右は空 /
//       右に出している人の行に選択中の枠と aria-current(別の人で移る・空になると消える)
//   (5) 広い: みんなの平均カード(左ペイン)を押すと確認のシート(body)/ はじめの一手(参加後)の的は1つ以下
//   (6) 狭い: 今までの木(.pane-2 が無い・行を押すと BottomSheet・本文の器と貼り付く bottom はシートの綴り)/
//       広い ↔ 狭いで開いていた人を捨てない
//   (7) 参加前: 広いと裏の見本が2ペイン(左 = 見本・右 = 空の1行・触れない包みのまま)/ 狭いと今までの形
// 期待値の文言・人数・名前は見本のデータと仕様(ipad-spec.md §4)から手で書いた。定数から逆算しない。
// 【守っていないもの】実寸(ペインの幅・貼り付くボタンの位置・吹き出しの左右・はじめの一手の的の見え方)と、指での横スワイプ
//   (jsdom は配置もタッチも無い)。どちらも headless Chrome で実測した(報告の表)。右ペインの data-noswipe は (1) で在ることだけ見る。
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

const W = 820; const H = 1180;
let fake; let host; let mod; let root; let wideNow; const listeners = new Set();

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
async function seed(kvEntries) {
  const db = await mod.openIdb();
  db.close?.();
  for (const [k, v] of Object.entries(kvEntries)) fake._peek("windToneLabDB", "kv").set(k, structuredClone(v));
}
const tick = (ms = 5) => mod.act(async () => { await new Promise((r) => setTimeout(r, ms)); });
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
// SwipePager は4ページを同時に描く: [0] = データ・[1] = 順位(どちらも 2ペイン)
const leftOf = (i) => panes()[i]?.children[0] ?? null;
const rightOf = (i) => panes()[i]?.children[1] ?? null;
const EMPTY_LINE = "奏者を選ぶと、ここに詳しいデータが表示されます";
const dialogNamed = (label) => document.querySelector(`[role="dialog"][aria-label="${label}"]`);
const subTab = (label) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === label && b.style.fontSize);
// コミュニティの SwipePager の4ページ(データ・順位・シェア・マイページ)。ページの包みは flex: 0 0 100%(App.jsx の SwipePager)。
// コミュニティは App の .surf-card の中なので、その中の包みだけを数える。
const slots = () => [...document.querySelectorAll('.surf-card div[style*="flex: 0 0 100%"]')];
// データの一覧の行と順位の行は同じ名乗り(「○○ の詳細を見る」)なので、どのページの中かで分ける
const rowIn = (slot, nick) => slot?.querySelector(`[role="button"][aria-label="${nick} の詳細を見る"]`) ?? null;
const dataRow = (nick) => rowIn(slots()[0], nick);
const rankRow = (nick) => rowIn(slots()[1], nick);
const nameLineIn = (el) => el?.querySelector('[role="radiogroup"][aria-label="表示する内容"]') ?? null;
const radioIn = (el, text) => [...el.querySelectorAll('[role="radio"]')].find((b) => b.textContent.trim() === text);
const buttonIn = (el, text) => [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
const adoptBtn = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "目安に設定");
// 見本: はじめの一手は全部済み(案内を出さない)。(5) だけ adoptAverage を外す。
const DONE = { migrated: true, migratedMeasureSteps: true, measure: true, reeds: true, reedsMeasure: true, join: true, adoptAverage: true, tuner: true, metronome: true, dataSeen: true };

beforeEach(() => {
  fake = createFakeIndexedDb();
  window.localStorage.clear();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  auth.uid = "me";
  wideNow = true;
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = vi.fn();
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  delete window.matchMedia;
});

async function startOnCommunity({ done = DONE, wide = true, joined = true } = {}) {
  mod = await loadApp(fake);
  wideNow = wide;
  auth.uid = joined ? "me" : null;
  installMatchMedia();
  await seed({ onboardingDone: done });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = mod.createRoot(host);
  await mod.act(async () => { root.render(mod.React.createElement(mod.App)); });
  await waitFor(() => nav("コミュニティ"), "下部タブ");
  await click(nav("コミュニティ"));
  if (joined) await waitFor(() => dataRow("くろねこ") && rankRow("くろねこ"), "名簿と目安(データ・順位の行)");
  else await waitFor(() => document.querySelector("[data-join-card]"), "参加のカード");
}

describe("便BV: 広い(iPad)のコミュニティタブ", () => {
  it("(1) 形: 器は --pane-max-w・.pane-2 はデータと順位の2つ・右は data-noswipe と空の1行・シェアとマイページは列", async () => {
    await startOnCommunity();
    expect(panes()).toHaveLength(2);
    // 器: 子タブの行と SwipePager を包む --pane-max-w の中央
    const box = panes()[0].closest('div[style*="--pane-max-w"]');
    expect(box).toBeTruthy();
    expect(box.style.maxWidth).toBe("var(--pane-max-w)");
    expect(box.style.margin).toBe("0px auto");
    for (const i of [0, 1]) {
      expect(panes()[i].children).toHaveLength(2);
      expect(rightOf(i).hasAttribute("data-noswipe")).toBe(true);
      // 左右ともクラスを持たない(高さ固定・スクロールは枠の規則 .pane-frame .pane-2 > * が配る)
      expect(rightOf(i).className).toBe("");
      expect(leftOf(i).className).toBe("");
      expect(leftOf(i).hasAttribute("data-noswipe")).toBe(false);
      expect(rightOf(i).textContent).toBe(EMPTY_LINE);
    }
    // 左: データ = 条件の行・平均カード・一覧 / 順位 = 練習日数|練習時間
    expect(leftOf(0).querySelector(".card.card-accent")).toBeTruthy();
    expect(leftOf(0).contains(dataRow("くろねこ"))).toBe(true);
    expect(leftOf(1).querySelector('[role="radiogroup"][aria-label="順位の種類"]')).toBeTruthy();
    // 作法のクラスは名乗らない(コミュニティ全体が App の .surf-card 1つ)
    expect(box.querySelectorAll(".surf-card, .surf-rule")).toHaveLength(0);
    expect(box.closest(".surf-card")).toBeTruthy();
    // シェアとマイページは列(--page-max-w)。人を描く右ペインは無い
    const cols = [...box.querySelectorAll('div[style*="--page-max-w"]')].filter((d) => d.style.maxWidth === "var(--page-max-w)" && d.style.margin === "0px auto");
    expect(cols).toHaveLength(2);
    expect(cols[0].textContent).toContain("楽器");
    expect(cols[1].querySelector('button[aria-label="アイコンを変更"], button[aria-label="写真を大きく表示"]')).toBeTruthy();
    expect(cols.some((c) => c.querySelector(".pane-2"))).toBe(false);
    // 人物のシートは開いていない
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    // 【便BV3】データ(2ペイン)を表に出している間は高さ固定の枠・SwipePager は fill(窓 = 枠の残り・各ページ = 高さ 100%)
    const viewport = slots()[0].parentElement.parentElement;
    expect(box.className).toBe("pane-frame");
    expect(viewport.style.overflow).toBe("hidden");
    expect(viewport.style.minHeight).toMatch(/^0(px)?$/);
    expect(slots()[0].style.height).toBe("100%");
    expect(document.querySelector(".pane-2-detail, .swipe-pager-clip")).toBe(null);
    // 列のページ(シェア)へ移ると枠も fill も外れる(文書がスクロールする)。順位(2ペイン)では付く
    await click(subTab("シェア"));
    await waitFor(() => box.className === "", "シェアでは枠が外れる");
    expect(slots()[0].style.height).toBe("");
    await click(subTab("順位"));
    await waitFor(() => box.className === "pane-frame", "順位では枠が付く");
    expect(slots()[1].style.height).toBe("100%");
  }, 30000);

  it("(2) データの行を押すと右に人物のページ(シートは開かない)・表の子タブのペインだけ・別の人で作り直す・器は subPageStyle", async () => {
    await startOnCommunity();
    await click(dataRow("くろねこ"));
    await waitFor(() => nameLineIn(rightOf(0)), "右に人物のページ");
    expect(rightOf(0).textContent).toContain("くろねこ");
    expect(rightOf(0).textContent).not.toContain(EMPTY_LINE);
    expect(dialogNamed("くろねこ の詳細")).toBe(null);
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    // 順位のペイン(裏のページ)には描かない(同じ人が2か所に描かれない)
    expect(rightOf(1).textContent).toBe(EMPTY_LINE);
    expect(document.querySelectorAll('[role="radiogroup"][aria-label="表示する内容"]')).toHaveLength(1);
    // 本文の器: 左ペインのデータ・順位と同じ subPageStyle(上 0・下 --sp-4)。シートの下 --sp-6 ではない
    const bodyBox = rightOf(0).children[0];
    // (jsdom は var() を含む padding の一括指定を、あとの padding-top の上書きと一緒に落とす ── 下の --sp-4 は読めない。
    //  ここでは「シートの綴り(下 --sp-6)ではない・上は 0」を見る。subPageStyle を読む綴りは pitch-test の BV.3 が見る)
    expect(bodyBox.style.paddingTop).toBe("0px");
    expect(bodyBox.style.paddingBottom).toBe("");
    expect(bodyBox.getAttribute("style")).not.toContain("--sp-6");
    expect(bodyBox.style.gridTemplateColumns).toBe("minmax(0, 1fr)");
    expect(bodyBox.style.display).toBe("grid");
    // 左の一覧は残る
    expect(leftOf(0).contains(dataRow("しろねこ"))).toBe(true);
    // プロフィールのタブへ → 別の人(しろねこ)を押す → しろねこのページはデータのタブから(作り直される)
    await click(radioIn(rightOf(0), "プロフィール"));
    await waitFor(() => radioIn(rightOf(0), "プロフィール").getAttribute("aria-checked") === "true", "プロフィールのタブ");
    expect(buttonIn(rightOf(0), "通報")).toBeTruthy();
    await click(dataRow("しろねこ"));
    await waitFor(() => rightOf(0).textContent.includes("しろねこ") && !rightOf(0).textContent.includes("くろねこ"), "右がしろねこに替わる");
    expect(radioIn(rightOf(0), "データ").getAttribute("aria-checked")).toBe("true");
    expect(buttonIn(rightOf(0), "通報")).toBeFalsy();
    expect(window.scrollTo).not.toHaveBeenCalled();
  }, 30000);

  it("(3) 子タブを替えると右は空 / 順位の行からも右に開く / シェア(列)には人を描かない", async () => {
    await startOnCommunity();
    await click(dataRow("くろねこ"));
    await waitFor(() => nameLineIn(rightOf(0)), "右に人物のページ");
    await click(subTab("順位"));
    await waitFor(() => rightOf(0).textContent === EMPTY_LINE, "子タブを替えると右は空");
    expect(rightOf(1).textContent).toBe(EMPTY_LINE);
    await click(rankRow("みけねこ"));
    await waitFor(() => nameLineIn(rightOf(1)), "順位の右に人物のページ");
    expect(rightOf(1).textContent).toContain("みけねこ");
    expect(rightOf(0).textContent).toBe(EMPTY_LINE);
    expect(document.querySelector('[role="dialog"]')).toBe(null);
    await click(subTab("シェア"));
    await waitFor(() => rightOf(1).textContent === EMPTY_LINE, "シェアへ移ると右は空");
    expect(document.querySelectorAll('[role="radiogroup"][aria-label="表示する内容"]')).toHaveLength(0);
  }, 30000);

  it("(4) ブロック: 確認のシート(body)→ ブロックする → 右は空・左の一覧と順位からその人が消える", async () => {
    await startOnCommunity();
    expect(document.body.textContent).toContain("目安を公開している4人");
    await click(dataRow("くろねこ"));
    await waitFor(() => nameLineIn(rightOf(0)), "右に人物のページ");
    await click(radioIn(rightOf(0), "プロフィール"));
    await click(buttonIn(rightOf(0), "ブロック"));
    const sheet = dialogNamed("くろねこ をブロックしますか");
    expect(sheet).toBeTruthy();
    expect(panes().some((p) => p.contains(sheet))).toBe(false);
    await click(buttonIn(sheet, "ブロックする"));
    await waitFor(() => rightOf(0).textContent === EMPTY_LINE, "右は空");
    expect(dataRow("くろねこ")).toBe(null);
    expect(rankRow("くろねこ")).toBeFalsy();
    expect(dataRow("しろねこ")).toBeTruthy();
    expect(document.body.textContent).toContain("目安を公開している3人");
  }, 30000);

  it("(4) 通報: シートは body・送れたら問い →「ブロックしない」で右ペインに戻り、「通報しました」の1行は右ペイン", async () => {
    await startOnCommunity();
    await click(dataRow("とらねこ"));
    await waitFor(() => nameLineIn(rightOf(0)), "右に人物のページ");
    await click(radioIn(rightOf(0), "プロフィール"));
    await click(buttonIn(rightOf(0), "通報"));
    const sheet = dialogNamed("この人を通報");
    expect(sheet).toBeTruthy();
    expect(panes().some((p) => p.contains(sheet))).toBe(false);
    await click(buttonIn(sheet, REPORT_REASONS[0]));
    await click(buttonIn(sheet, "通報する"));
    await waitFor(() => dialogNamed("通報しました"), "通報のあとの問い");
    await click(buttonIn(dialogNamed("通報しました"), "ブロックしない"));
    await waitFor(() => !dialogNamed("通報しました"), "問いが閉じる");
    expect(rightOf(0).textContent).toContain("とらねこ");
    const done = [...rightOf(0).querySelectorAll('[role="status"]')].find((e) => e.textContent === "通報しました");
    expect(done).toBeTruthy();
    expect(dataRow("とらねこ")).toBeTruthy();   // 通報では一覧から消さない
  }, 30000);

  it("(4) 目安に設定: ペインでは浮かせるボタン(body へ portal・右ペインの右下)と末尾の余白・押すと右ペインに1行", async () => {
    await startOnCommunity();
    await click(dataRow("みけねこ"));
    await waitFor(() => adoptBtn(), "目安に設定");
    // 【便BV3】リードの「計測」と同じ浮かせるボタン(body へ portal)。右端は右ペインの右下の式(--pane-max-w)・下端は下部タブ・帯の上
    const fab = adoptBtn();
    expect(fab.parentElement).toBe(document.body);
    expect(rightOf(0).contains(fab)).toBe(false);
    expect(fab.style.position).toBe("fixed");
    expect(fab.getAttribute("style")).toMatch(/right: max\(var\(--page-pad-right\), calc\(\(100% - var\(--pane-max-w\)\) \/ 2\)\);/);
    expect(fab.getAttribute("style")).toContain("bottom: calc(var(--page-bottom-gap) + var(--sp-3))");
    // 右ペインの中身の末尾に、ボタンに隠れないだけの余白(リードの右ペインと同じ FloatingActionSpacer)。シートの貼り付く器は無い
    const tail = rightOf(0).lastElementChild;
    expect(tail.getAttribute("aria-hidden")).toBe("true");
    expect(tail.style.height).toBe("calc(56px + var(--sp-3) + var(--sp-3))");
    expect([...rightOf(0).querySelectorAll("div")].some((d) => d.style.position === "sticky")).toBe(false);
    await click(adoptBtn());
    await waitFor(() => [...rightOf(0).querySelectorAll('[role="status"]')].some((e) => /目安/.test(e.textContent)), "取り込んだ1行");
    expect(document.querySelector('[role="dialog"]')).toBe(null);
  }, 30000);

  it("(5) みんなの平均カード(左ペイン)を押すと確認のシート(body)/ はじめの一手(参加後)の的は1つ以下", async () => {
    const { adoptAverage, ...notYet } = DONE;
    expect(adoptAverage).toBe(true);
    await startOnCommunity({ done: notYet });
    const card = leftOf(0).querySelector(".card.card-accent");
    expect(card.getAttribute("data-coach")).toBe("adoptAverage");
    expect(document.querySelectorAll('[data-coach="adoptAverage"]')).toHaveLength(1);
    await click(card);
    await waitFor(() => document.querySelector('[role="dialog"]'), "確認のシート");
    const dlg = document.querySelector('[role="dialog"]');
    expect(dlg.textContent).toContain("みんなの平均");
    expect(panes().some((p) => p.contains(dlg))).toBe(false);
    await mod.act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await waitFor(() => !document.querySelector('[role="dialog"]'), "シートを閉じる");
    // 人を右に開いても的は増えない(人物のページは的を名乗らない)
    await click(dataRow("くろねこ"));
    await waitFor(() => nameLineIn(rightOf(0)), "右に人物のページ");
    expect(document.querySelectorAll('[data-coach="adoptAverage"]').length).toBeLessThanOrEqual(1);
    expect(rightOf(0).querySelector("[data-coach]")).toBe(null);
  }, 30000);
});

describe("便BV: 狭い(iPhone)は今までの木。広い ↔ 狭いで開いていた人を捨てない", () => {
  it("(6) 狭い: .pane-2 は無い・行を押すとシート(BottomSheet)・本文の器と貼り付く bottom はシートの綴り", async () => {
    await startOnCommunity({ wide: false });
    expect(panes()).toHaveLength(0);
    expect(document.querySelector('div[style*="--pane-max-w"]')).toBe(null);
    // 狭い木の SwipePager は今までどおり inline の hidden(clip のクラスも右ペインのクラスも無い)
    expect(document.querySelector(".pane-frame, .pane-2-detail, .swipe-pager-clip, [aria-current]")).toBe(null);
    expect(slots()[0].parentElement.parentElement.style.overflow).toBe("hidden");
    expect(document.body.textContent).not.toContain(EMPTY_LINE);
    await click(dataRow("みけねこ"));
    await waitFor(() => dialogNamed("みけねこ の詳細"), "人物のシート");
    const sheet = dialogNamed("みけねこ の詳細");
    const bodyBox = nameLineIn(sheet).parentElement;
    expect(bodyBox.style.paddingTop).toBe("0px");
    expect(bodyBox.style.paddingBottom).toBe("var(--sp-6, 40px)");
    const sticky = [...sheet.querySelectorAll("button")].find((b) => b.textContent.trim() === "目安に設定").parentElement;
    expect(sticky.style.position).toBe("sticky");
    expect(sticky.style.bottom).toBe("0px");
  }, 30000);

  it("(6) 広い木で右に開いた人は、狭い木ではシートとして出て、広い木へ戻すと右ペインへ戻る", async () => {
    await startOnCommunity();
    await click(dataRow("くろねこ"));
    await waitFor(() => nameLineIn(rightOf(0)), "右に人物のページ");
    await setWide(false);
    await waitFor(() => dialogNamed("くろねこ の詳細"), "狭い木のシート");
    expect(panes()).toHaveLength(0);
    await setWide(true);
    await waitFor(() => panes().length === 2 && nameLineIn(rightOf(0)), "広い木に戻る");
    expect(rightOf(0).textContent).toContain("くろねこ");
    expect(dialogNamed("くろねこ の詳細")).toBe(null);
  }, 30000);
});

describe("便BV: 参加前の画面(JoinIntro)", () => {
  it("(7) 広い: 裏の見本は2ペイン(左 = 見本・右 = 空の1行)。触れない包み(inert・読み上げに出さない)のまま・カードは1枚", async () => {
    await startOnCommunity({ joined: false });
    const preview = document.querySelector("[data-join-preview]");
    expect(preview.getAttribute("aria-hidden")).toBe("true");
    expect(preview.hasAttribute("inert")).toBe(true);
    expect(panes()).toHaveLength(1);
    expect(preview.contains(panes()[0])).toBe(true);
    expect(leftOf(0).querySelector("[data-join-preview-screen]")).toBeTruthy();
    expect(rightOf(0).textContent).toBe(EMPTY_LINE);
    const box = panes()[0].parentElement;
    expect(box.style.maxWidth).toBe("var(--pane-max-w)");
    expect(box.children[0].textContent).toContain("データ");   // 子タブの行が器の中の先頭
    expect(document.querySelectorAll("[data-join-card]")).toHaveLength(1);
    expect(preview.contains(document.querySelector("[data-join-card]"))).toBe(false);
  }, 30000);

  it("(7) 狭い: 見本は今までの形(.pane-2 も器も無い。子タブの行のすぐ下に見本)", async () => {
    await startOnCommunity({ joined: false, wide: false });
    const preview = document.querySelector("[data-join-preview]");
    expect(panes()).toHaveLength(0);
    expect(preview.children).toHaveLength(2);
    expect(preview.children[1].hasAttribute("data-join-preview-screen")).toBe(true);
    expect(document.body.textContent).not.toContain(EMPTY_LINE);
  }, 30000);
});

describe("便BV3: 右に出している人を一覧で目立たせる・条件が変わったら右を空に", () => {
  const ringOf = (el) => el?.style.boxShadow ?? "";
  it("(8) データの行: 押した人の行だけ aria-current と選択中の枠。別の人を押すと移る。条件(ジャンル)を変えると右は空・枠も消える", async () => {
    await startOnCommunity();
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(0);
    await click(dataRow("くろねこ"));
    await waitFor(() => nameLineIn(rightOf(0)), "右に人物のページ");
    expect(dataRow("くろねこ").getAttribute("aria-current")).toBe("true");
    expect(ringOf(dataRow("くろねこ"))).toBe("inset 0 0 0 1.5px var(--c-accent)");
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(1);
    expect(ringOf(dataRow("しろねこ"))).toBe("");
    // 【便BV4】選ばれている行だけ、枠を --sp-2 外へ広げて同じ量を padding に足す(中身の位置は同じ)・角は --r-md。選ばれていない行は今までの寸法
    const st = dataRow("くろねこ").getAttribute("style");
    expect(st).toContain("border-radius: var(--r-md)");
    expect(st).toContain("calc(-1 * var(--sp-2))");
    expect(st).toContain("calc(2px + var(--sp-2))");
    expect(dataRow("しろねこ").getAttribute("style")).not.toContain("--sp-2");
    expect(dataRow("しろねこ").style.padding).toBe("11px 2px");
    await click(dataRow("しろねこ"));
    await waitFor(() => rightOf(0).textContent.includes("しろねこ"), "右がしろねこ");
    expect(dataRow("しろねこ").getAttribute("aria-current")).toBe("true");
    expect(dataRow("くろねこ").hasAttribute("aria-current")).toBe(false);
    expect(ringOf(dataRow("くろねこ"))).toBe("");
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(1);
    // 条件の行のジャンルを変える(しろねこは一覧に残る条件でも、右は空に戻す)
    const sel = slots()[0].querySelector('select[aria-label="ジャンルで絞り込む"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    await mod.act(async () => { setter.call(sel, "クラシック"); sel.dispatchEvent(new Event("change", { bubbles: true })); });
    await waitFor(() => rightOf(0).textContent === EMPTY_LINE, "条件を変えると右は空");
    expect(dataRow("しろねこ")).toBeTruthy();
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(0);
    expect(adoptBtn()).toBeFalsy();
  }, 30000);

  it("(8) 順位の行: 押した人の行だけ枠(上位3件のカードは影に重ねる)。順位の種類を替えると右は空・枠も消える", async () => {
    await startOnCommunity();
    await click(subTab("順位"));
    await click(rankRow("とらねこ"));   // 練習日数 13 日 = 1位(上位3件のカード)
    await waitFor(() => nameLineIn(rightOf(1)), "順位の右に人物のページ");
    expect(rankRow("とらねこ").getAttribute("aria-current")).toBe("true");
    expect(ringOf(rankRow("とらねこ"))).toBe("inset 0 0 0 1.5px var(--c-accent), var(--shadow-card)");
    await click(rankRow("しろねこ"));   // 10 日 = 4位(小さい行)
    await waitFor(() => rightOf(1).textContent.includes("しろねこ"), "右がしろねこ");
    expect(rankRow("しろねこ").getAttribute("aria-current")).toBe("true");
    expect(ringOf(rankRow("しろねこ"))).toBe("inset 0 0 0 1.5px var(--c-accent)");
    expect(rankRow("しろねこ").getAttribute("style")).toContain("border-radius: var(--r-md)");
    expect(rankRow("しろねこ").getAttribute("style")).toContain("calc(2px + var(--sp-2))");
    expect(ringOf(rankRow("とらねこ"))).toBe("var(--shadow-card)");
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(1);
    await click([...slots()[1].querySelectorAll('[role="radio"]')].find((b) => b.textContent.trim() === "練習時間"));
    await waitFor(() => rightOf(1).textContent === EMPTY_LINE, "順位の種類を替えると右は空");
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(0);
  }, 30000);

  it("(8) 狭い(iPhone): 人を開いても一覧の行に枠も aria-current も付かない", async () => {
    await startOnCommunity({ wide: false });
    await click(dataRow("くろねこ"));
    await waitFor(() => dialogNamed("くろねこ の詳細"), "人物のシート");
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(0);
    expect(ringOf(dataRow("くろねこ"))).toBe("");
  }, 30000);
});
