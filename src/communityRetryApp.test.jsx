// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便CO 2026-10-12 本人の実機指示】「コミュニティタブで通信が失敗し、『もう一度試す』を押すと、勝手に計測タブへ移って
// 終わりの案内(⑱「チューナーとメトロノームを使って、あなたのデータを貯めよう！」)が出る」をやめる。
// 統括の仕様から手で書いた期待値:
//   ・「もう一度試す」を押したら、コミュニティタブのまま読み込み直す(下部タブの選択はコミュニティのまま・⑱ は出ない)
//   ・成功したら、そのままコミュニティの案内が続く(到着カード「ここはコミュニティ」)
//   ・失敗の画面は2つある: (1) 通信の失敗(CommunityTabBody の「通信に失敗しました…」)(2) 画面の読み込みの失敗
//     (App.jsx の CommunityErrorBoundary「コミュニティを読み込めませんでした…」。ここが window.location.reload() でアプリごと読み直し、
//     起動のタブ = 計測タブから始まって ⑱ が出ていた)。どちらの「もう一度試す」も、引っ張って更新も、タブを変えない
// ⑱ が出る条件(4つのタブを開いた印と ① が済んでいる)を満たした人で見る ── 計測タブへ移れば ⑱ が出る人。
// サーバーは作り物(accountRepo / directory / idealRepo。Firebase に触らない)。画面のコード(CommunityTab.jsx)の読み込みの失敗は、
// 作り物のモジュールの読み込みを1回だけ失敗させて作る。IndexedDB も作り物。
// 【守っていないもの】実機で画面のコードの読み込みが失敗したあと、もう一度の読み込みが本当に取りに行くか
// (ブラウザがモジュールの失敗を覚えるか。WebKit は取り直す報告がある。実機待ち)。
// ------------------------------------------------------------------

const srv = vi.hoisted(() => ({ failUid: 0, failChunk: 0, breakRender: false, noAccount: false }));
vi.mock("./community/accountRepo.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return {
    ...(await orig()),
    getSignedInUid: vi.fn(async () => {
      if (srv.failUid > 0) { srv.failUid--; throw Object.assign(new Error("net"), { code: "unavailable" }); }
      return srv.noAccount ? null : "me";
    }),
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
// 画面のコードの読み込み(App.jsx の lazy)を srv.failChunk 回だけ失敗させる(電波の悪いときの動的 import の失敗の代わり)。
// 作り物のモジュールは**読み込みに成功すると覚えられる**(vi.resetModules でも読み直さない)ので、読み込みの失敗を作れるのは
// このファイルで最初に読む検査だけ(下の describe の1つ目)。2つ目以降は描画の失敗(srv.breakRender。同じ境界が受ける)で作る。
vi.mock("./community/CommunityTab.jsx", async (orig) => {
  if (srv.failChunk > 0) { srv.failChunk--; throw new TypeError("Failed to fetch dynamically imported module"); }
  const real = await orig();
  const React = await import("react");
  function CommunityTabMaybeBroken(props) {
    if (srv.breakRender) throw new Error("検査: コミュニティの画面の描画の失敗");
    return React.createElement(real.default, props);
  }
  return { ...real, default: CommunityTabMaybeBroken };
});

const W = 375; const H = 812;
let fake; let host; let mod; let root;
async function loadApp(idb) {
  vi.resetModules();
  globalThis.indexedDB = idb;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("./App.jsx");
  const accountRepo = await import("./community/accountRepo.js");
  return { React, act: React.act, createRoot, App: App.default, openIdb: App.openIdb, accountRepo };
}
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
    if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label} / ${bodyText().slice(0, 300)}`);
    await tick();
  }
}
const layerId = () => document.querySelector("[data-coach-layer]")?.getAttribute("data-coach-layer") ?? null;
const nav = (label) => document.querySelector(`button[aria-label="${label}"]`);
const click = (el) => mod.act(async () => { el.click(); });
const bodyText = () => document.body.textContent || "";
const retryButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "もう一度試す");
// いま選ばれている下部タブ(BottomNav は選ばれたタブの色を --c-accent にする)
const activeTab = () => ["計測", "リード", "コミュニティ", "データ"].find((l) => nav(l)?.style.color === "var(--c-accent)") ?? null;
const NET_ERROR = "通信に失敗しました。電波の良いところでもう一度お試しください";
const CHUNK_ERROR = "コミュニティを読み込めませんでした。アプリを開き直すと直ることがあります。";
// 4つのタブを開いた印と ① が済んでいる(計測タブにいれば ⑱ が出る)。コミュニティは参加済み・到着カードはまだ
const DONE = {
  migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true,
  tuner: true, metronome: true, goReeds: true, arriveReeds: true, goData: true, arriveData: true, goCommunity: true, join: true,
};
// 作り物の指(PullToRefresh.jsx の touch の聞き手へ流す)
const touch = (type, x, y) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "touches", { value: type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: y }] });
  return ev;
};
async function pull(el, dy) {
  await mod.act(async () => {
    el.dispatchEvent(touch("touchstart", 100, 100));
    for (let k = 1; k <= 6; k++) el.dispatchEvent(touch("touchmove", 100, 100 + (dy * k) / 6));
    el.dispatchEvent(touch("touchend", 0, 0));
  });
}

let reloads = 0; let realLocation;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  fake = createFakeIndexedDb();
  srv.failUid = 0; srv.failChunk = 0; srv.breakRender = false; srv.noAccount = false;
  window.localStorage.clear();
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = () => {};
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  // ページの読み直し(window.location.reload)を数える(jsdom は読み直せない)。後で元に戻す
  reloads = 0;
  realLocation = window.location;
  delete window.location;
  window.location = { ...realLocation, href: realLocation.href, search: "", pathname: "/", hash: "", reload: () => { reloads++; } };
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  window.location = realLocation;
  document.documentElement.removeAttribute("data-pull-refresh");
});

describe("【便CO】コミュニティの読み込みの失敗から「もう一度試す」: コミュニティタブのまま読み直す", () => {
  it("画面のコードの読み込みの失敗: 「もう一度試す」はページを読み直さず、コミュニティタブのまま読み込みだけやり直す。⑱ は出ない", async () => {
    mod = await loadApp(fake);
    await seed({ onboardingDone: DONE, onboardingShown: true });
    srv.failChunk = 1;
    await render();
    await waitFor(() => fake._peek("windToneLabDB", "kv")?.get("onboardingDone")?.migrated === true, "印の読み込み");
    await click(nav("コミュニティ"));
    await waitFor(() => bodyText().includes(CHUNK_ERROR) && retryButton(), "読み込みの失敗の画面");
    // この画面の間も、ページの標準の引っ張って再読み込みを止める印が付く(Safari で引くとページごと読み直していた)
    expect(document.documentElement.hasAttribute("data-pull-refresh")).toBe(true);
    await click(retryButton());
    await waitFor(() => !bodyText().includes(CHUNK_ERROR) && bodyText().includes("マイページ"), "参加後の画面");
    expect(reloads).toBe(0);
    expect(activeTab()).toBe("コミュニティ");
    await waitFor(() => layerId() === "arriveCommunity", "コミュニティの到着カード");
    expect(layerId()).not.toBe("finish");
  }, 40000);

  it("画面の描画の失敗(同じ境界が受ける)の画面で引っ張って更新しても、ページを読み直さずコミュニティタブのまま読み込みだけやり直す", async () => {
    mod = await loadApp(fake);
    await seed({ onboardingDone: DONE, onboardingShown: true });
    srv.breakRender = true;
    await render();
    await waitFor(() => fake._peek("windToneLabDB", "kv")?.get("onboardingDone")?.migrated === true, "印の読み込み");
    await click(nav("コミュニティ"));
    await waitFor(() => bodyText().includes(CHUNK_ERROR), "読み込みの失敗の画面");
    // 引っ張って更新の包み(失敗の文の祖先)を引く。しきい値(60px)を十分に越える
    expect(document.documentElement.hasAttribute("data-pull-refresh")).toBe(true);
    // 到着カードが失敗の画面の上に出ていれば、先に押して済ませる(カードが出ている間は引っ張って更新は掴まない)
    if (layerId() === "arriveCommunity") {
      await click(document.querySelector('[data-coach-hit="all"]'));
      await waitFor(() => layerId() === null, "到着カードが済む");
    }
    const wrap = [...document.querySelectorAll("div")].find((d) => d.textContent === CHUNK_ERROR)?.parentElement?.parentElement;
    expect(wrap).toBeTruthy();
    srv.breakRender = false;   // 電波が戻った
    await pull(wrap, 200);
    await waitFor(() => !bodyText().includes(CHUNK_ERROR) && bodyText().includes("マイページ"), "参加後の画面");
    expect(reloads).toBe(0);
    expect(activeTab()).toBe("コミュニティ");
    expect(layerId()).not.toBe("finish");
  }, 40000);

  it("通信の失敗(アカウントの確認が落ちた): 押すとコミュニティタブのまま読み直し、成功したら到着カードが続く。⑱ は出ない", async () => {
    mod = await loadApp(fake);
    await seed({ onboardingDone: DONE, onboardingShown: true });
    srv.failUid = 1;
    await render();
    await waitFor(() => fake._peek("windToneLabDB", "kv")?.get("onboardingDone")?.migrated === true, "印の読み込み");
    await click(nav("コミュニティ"));
    await waitFor(() => bodyText().includes(NET_ERROR) && retryButton(), "通信の失敗の画面");
    expect(activeTab()).toBe("コミュニティ");
    const uidCalls = mod.accountRepo.getSignedInUid.mock.calls.length;
    await click(retryButton());
    await waitFor(() => !bodyText().includes(NET_ERROR) && nav("コミュニティ") && document.querySelector('[role="tab"], button') && bodyText().includes("マイページ"), "参加後の画面");
    expect(mod.accountRepo.getSignedInUid.mock.calls.length).toBe(uidCalls + 1);
    expect(activeTab()).toBe("コミュニティ");
    await waitFor(() => layerId() === "arriveCommunity", "コミュニティの到着カード");
    await tick(300);
    expect(activeTab()).toBe("コミュニティ");
    expect(layerId()).not.toBe("finish");
    expect(reloads).toBe(0);
  }, 40000);

  it("通信の失敗の画面で引っ張って更新しても、コミュニティタブのまま(⑱ は出ない)", async () => {
    mod = await loadApp(fake);
    await seed({ onboardingDone: DONE, onboardingShown: true });
    srv.failUid = 1;
    await render();
    await waitFor(() => fake._peek("windToneLabDB", "kv")?.get("onboardingDone")?.migrated === true, "印の読み込み");
    await click(nav("コミュニティ"));
    await waitFor(() => bodyText().includes(NET_ERROR), "通信の失敗の画面");
    // 到着カードが失敗の画面の上に出ていれば、先に押して済ませる(カードが出ている間は引っ張って更新は掴まない)
    if (layerId() === "arriveCommunity") {
      await click(document.querySelector('[data-coach-hit="all"]'));
      await waitFor(() => layerId() === null, "到着カードが済む");
    }
    const wrap = [...document.querySelectorAll("div")].find((d) => d.textContent === NET_ERROR)?.parentElement?.parentElement;
    expect(wrap).toBeTruthy();
    const uidCalls = mod.accountRepo.getSignedInUid.mock.calls.length;
    await pull(wrap, 200);
    await waitFor(() => !bodyText().includes(NET_ERROR) && bodyText().includes("マイページ"), "参加後の画面");
    expect(mod.accountRepo.getSignedInUid.mock.calls.length).toBe(uidCalls + 1);
    expect(reloads).toBe(0);
    expect(activeTab()).toBe("コミュニティ");
    expect(layerId()).not.toBe("finish");
  }, 40000);
});

// 【便CO 審査のあとの統括の決定 (d)(A案)】参加の画面のカード(JoinIntro)が出ている間も、広告の帯を止める。
// 2回目の起動(広告を始めてよい)・まだ参加していない人がコミュニティタブを開く → 印が付く。カードの無いリードタブ(章は済み)へ移ると、待ちのあと外れる。
// (計測タブはこの作り物ではマイクが無くエラーの暗幕が出る。⑱ が残っているので「候補はあるのに一時的に隠している」(b) にあたり、止めたままになる)
describe("【便CO】参加の画面のカードの間は広告の帯を止める", () => {
  it("参加の画面のカードが出ている間は data-ad-hold が付き、離れると戻る", async () => {
    mod = await loadApp(fake);
    const { join, ...notJoined } = DONE;
    await seed({ onboardingDone: notJoined, onboardingShown: true });
    srv.noAccount = true;
    await render();
    await waitFor(() => fake._peek("windToneLabDB", "kv")?.get("onboardingDone")?.migrated === true, "印の読み込み");
    const hold = () => document.documentElement.getAttribute("data-ad-hold");
    await click(nav("リード"));
    await waitFor(() => hold() === null, "リードタブ(章は済み)では止めていない");
    await click(nav("コミュニティ"));
    await waitFor(() => document.querySelector("[data-join-card]"), "参加の画面のカード");
    expect(layerId()).toBe(null);                        // 案内のカード(a)ではなく、参加の画面のカード(d)だけ
    expect(hold()).toBe("1");
    await tick(1500);
    expect(hold()).toBe("1");                            // 出ている間はずっと
    await click(nav("リード"));
    await waitFor(() => !document.querySelector("[data-join-card]"), "カードが消える");
    await waitFor(() => hold() === null, "離れたら戻る", 5000);
  }, 40000);
});
