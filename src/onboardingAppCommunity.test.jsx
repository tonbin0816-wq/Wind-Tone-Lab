// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便BP3 2026-10-03 統括の裁定 2】App → CommunityTab → CommunityTabBody → JoinedView の**配線**を、
// アプリ全体(WindToneLabPhaseMode)からコミュニティタブを描いて確かめる(審査で R21 / R17 の断線が生き残った)。
//   ・プロフィールの画面に入ったら、この端末の保存(kv)の onboardingDone に join が立つ
//   ・人物を開いたら、openPerson が立つ
// サーバーは作り物(onboardingCommunity.test.jsx と同じ。accountRepo / directory / idealRepo の読み書きを差し替える。
// Firebase に触らない)。IndexedDB も作り物。
// 【守っていないもの】見た目と的の位置(headless Chrome の起動口 bp_harness で実測)。
// ------------------------------------------------------------------

const fake = createFakeIndexedDb();
globalThis.indexedDB = fake;
vi.mock("./community/accountRepo.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return {
    ...(await orig()),
    getSignedInUid: vi.fn(async () => "me"),
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

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: App } = await import("./App.jsx");
const act = React.act;

let host; let root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const kv = (key) => fake._peek("windToneLabDB", "kv")?.get(key);
const tick = (ms = 10) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function waitFor(pred, label, deadline = 15000) {
  const end = Date.now() + deadline;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label}`);
    await tick();
  }
}

describe("App → コミュニティタブの配線(便BP3)", () => {
  it("プロフィールの画面に入ったら kv に join、人物を開いたら openPerson が立つ", async () => {
    await act(async () => { root.render(React.createElement(App)); });
    await waitFor(() => kv("onboardingDone")?.migrated === true, "移行の印");
    expect(kv("onboardingDone").join).toBeUndefined();
    await act(async () => { document.querySelector('button[aria-label="コミュニティ"]').click(); });
    // 参加済み(作り物のプロフィール)→ JoinedView のデータの子タブ。名簿が読み終わるまで待つ
    await waitFor(() => document.querySelector('[data-coach="openPerson"]'), "データの一覧の1人目");
    await waitFor(() => kv("onboardingDone")?.join === true, "参加の印(kv)");
    expect(kv("onboardingDone").openPerson).toBeUndefined();
    await act(async () => { document.querySelector('[data-coach="openPerson"]').click(); });
    await waitFor(() => document.querySelector('[role="dialog"][aria-label="しろねこ の詳細"]'), "人物のページ");
    await waitFor(() => kv("onboardingDone")?.openPerson === true, "奏者を開いた印(kv)");
    expect(kv("onboardingDone").adoptAverage).toBeUndefined();
  }, 40000);
});
