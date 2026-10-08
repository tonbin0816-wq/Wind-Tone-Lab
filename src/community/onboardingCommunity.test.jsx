// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便BP 2026-10-03 本人裁定】はじめの一手のコミュニティ側の配線。本物の画面(CommunityTab / JoinedView / DataScreen)を描く。
//   ・参加前: 【便BS 2026-10-03 本人裁定】参加の段ははじめの一手から外した(参加の画面そのものが暗幕とカード1枚。
//     参加のボタンは的を名乗らない)。参加済みと分かったら(プロフィールの画面に入ったら)印 "join"
//     まだ参加していない(匿名のアカウントが無い・プロフィールが無い)なら印は立てない
//   ・参加後1: データの一覧の**1人目だけ**が的を名乗る。一覧が空なら名乗る行が無い(= 案内は出ない)
//     人物のページを開いたら(データ・順位のどちらからでも)印 "openPerson"。描いただけでは立てない
//   ・参加後2: みんなの平均カードは**平均が出ているときだけ**的を名乗る(人数不足では名乗らない)
// サーバーは作り物(accountRepo / directory / idealRepo の読み書きを差し替える。Firebase に触らない)。
// 【守っていないもの】的の位置と見た目(headless Chrome の起動口 bp_harness で実測。報告の表)。
//   みんなの平均の取り込みの成功で印が立つこと(App.jsx の onAdoptIdeal)は onboardingApp.test.jsx の綴りの検査。
// ------------------------------------------------------------------

globalThis.indexedDB = createFakeIndexedDb();
const account = { uid: "me", profile: null };
vi.mock("./accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => account.uid),
  loadProfile: vi.fn(async () => account.profile),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => { throw new Error("検査: サインインしない"); }),
}));
vi.mock("./directory.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(async () => kit.SERVER_USERS), publishStats: vi.fn(async () => {}) };
});
vi.mock("./reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));
vi.mock("./idealRepo.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listIdeals: vi.fn(async () => kit.SERVER_IDEALS), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) };
});

const { default: CommunityTab, JoinedView } = await import("./CommunityTab.jsx");
const { DataScreen } = await import("./screens.jsx");
const kit = await import("./blockKit.testutil.jsx");
const { setupDom, teardownDom, drawJoined, click, waitFor, bodyText } = kit;

beforeEach(setupDom);
afterEach(teardownDom);

const coachNamed = (name) => [...document.querySelectorAll(`[data-coach="${name}"]`)];

describe("参加(参加前の的・参加済みと分かったら印)", () => {
  // drawJoined と同じ根を使うため、setupDom の root に描く(kit の root は外から見えないので render を自前で持つ)
  async function drawTab(onOnboarding) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<CommunityTab sessions={[]} tuningHz={442} onAdoptIdeal={() => ({})} onOnboarding={onOnboarding} />); });
    return root;
  }
  // 【便BS 2026-10-03 本人裁定】参加の段ははじめの一手から外した(参加の画面そのものがカード1枚)。参加のボタンは的を名乗らない。
  it("まだ参加していない: 参加の画面(カード)が出る。参加のボタンは的を名乗らない(【便BS】)。印は立てない", async () => {
    account.uid = null; account.profile = null;
    const onOnboarding = vi.fn();
    const root = await drawTab(onOnboarding);
    // 【便CD】「参加する」はカードの名前(aria-label)になり、字では出ない
    await waitFor(() => document.querySelector("[data-join-card]"), "参加前の画面");
    expect(coachNamed("join")).toHaveLength(0);
    expect(document.querySelectorAll("[data-coach]")).toHaveLength(0);
    // 【便BQ】カードは画面の中央に置くので、重ねない印(便BP4 の data-coach-avoid)は片付けた
    expect(document.querySelectorAll("[data-coach-avoid]")).toHaveLength(0);
    expect(onOnboarding).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
  it("匿名のアカウントはあるがプロフィールが無い(参加の途中)なら印は立てない", async () => {
    account.uid = "me"; account.profile = null;
    const onOnboarding = vi.fn();
    const root = await drawTab(onOnboarding);
    await waitFor(() => document.querySelector("[data-join-card]"), "参加前の画面");
    expect(onOnboarding).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
  it("参加済み(プロフィールがある): プロフィールの画面に入ったら印 join を立てる", async () => {
    account.uid = "me"; account.profile = kit.MY_PROFILE;
    const onOnboarding = vi.fn();
    const root = await drawTab(onOnboarding);
    await waitFor(() => onOnboarding.mock.calls.length > 0, "参加の印");
    expect(onOnboarding.mock.calls.map((c) => c[0])).toContain("join");
    expect(coachNamed("join")).toHaveLength(0);   // 参加のボタンはもう無い
    await act(async () => root.unmount());
  });
});

// 【便BQ 2026-10-03 本人指示「気になる奏者を開いてみようのパートは削除」】参加後1は無い。
describe("参加後1(奏者を開く)は無い", () => {
  it("データの一覧のどの行も的を名乗らず、人物を開いても印を立てない(人物のページは今までどおり開く)", async () => {
    const onOnboarding = vi.fn();
    await drawJoined(JoinedView, { initialTab: "data", onOnboarding });
    expect(coachNamed("openPerson")).toHaveLength(0);
    const row = [...document.querySelectorAll('[role="button"]')].find((el) => el.textContent.includes("しろねこ") && el.getAttribute("aria-label") === "しろねこ の詳細を見る");
    await click(row);
    expect(document.querySelector('[role="dialog"][aria-label="しろねこ の詳細"]')).not.toBe(null);
    expect(onOnboarding).not.toHaveBeenCalled();
  });
});

describe("DataScreen の的の名乗り(一覧が空・平均が出ていない)", () => {
  const draw = async (props) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<DataScreen users={kit.SERVER_USERS} ideals={kit.SERVER_IDEALS} myIdeals={{}} myUid="me" saxTypes={["alto"]}
        onOpenPerson={() => {}} tuningHz={442} onAdopt={() => ({ ok: true })} {...props} />);
    });
    return root;
  };
  it("平均が出ている(4人)なら平均カードが的を名乗る・1人目も名乗る", async () => {
    const root = await draw({});
    expect(bodyText()).toContain("目安を公開している4人");
    const card = coachNamed("adoptAverage");
    expect(card).toHaveLength(1);
    expect(card[0].className).toBe("card card-accent");
    expect(card[0].hasAttribute("data-coach-avoid")).toBe(false);   // 【便BQ】重ねない印は片付けた
    expect(coachNamed("openPerson")).toHaveLength(0);                // 【便BQ】参加後1は無い
    await act(async () => root.unmount());
  });
  it("人数不足(2人)では平均カードは名乗らない(案内は出ない)。一覧の1人目は名乗る", async () => {
    const root = await draw({ ideals: kit.SERVER_IDEALS.slice(0, 2) });
    expect(bodyText()).not.toContain("目安を公開している");
    expect(document.querySelector(".card.card-accent")).not.toBe(null);
    expect(coachNamed("adoptAverage")).toHaveLength(0);
    expect(coachNamed("openPerson")).toHaveLength(0);
    await act(async () => root.unmount());
  });
  it("一覧が空でも、平均カードは名乗らない(平均が出ていない)", async () => {
    const root = await draw({ ideals: [] });
    expect(bodyText()).toContain("公開されているデータがまだありません");
    expect(coachNamed("openPerson")).toHaveLength(0);
    expect(coachNamed("adoptAverage")).toHaveLength(0);
    await act(async () => root.unmount());
  });
  it("取り込み口が無い(onAdopt なし)なら平均カードは名乗らない(押しても何も起きないカードへ導かない)", async () => {
    const root = await draw({ onAdopt: null });
    expect(coachNamed("adoptAverage")).toHaveLength(0);
    await act(async () => root.unmount());
  });
});
