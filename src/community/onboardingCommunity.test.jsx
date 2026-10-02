// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便BP 2026-10-03 本人裁定】はじめの一手のコミュニティ側の配線。本物の画面(CommunityTab / JoinedView / DataScreen)を描く。
//   ・参加前: 参加のボタンが的を名乗る(data-coach="join")。参加済みと分かったら(プロフィールの画面に入ったら)印 "join"
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
  it("まだ参加していない: 参加のボタンが的を名乗る。印は立てない", async () => {
    account.uid = null; account.profile = null;
    const onOnboarding = vi.fn();
    const root = await drawTab(onOnboarding);
    await waitFor(() => bodyText().includes("参加してプロフィールを作る"), "参加前の画面");
    const join = coachNamed("join");
    expect(join).toHaveLength(1);
    expect(join[0].tagName).toBe("BUTTON");
    expect(join[0].textContent.trim()).toBe("参加してプロフィールを作る");
    // 【便BP4】同意の前に読む説明文の2段落と、規約・ポリシーの導線は、案内のカードを重ねない印を持つ
    const avoid = [...document.querySelectorAll("[data-coach-avoid]")];
    expect(avoid).toHaveLength(3);
    expect(avoid[0].textContent).toContain("参加すると匿名のアカウントが作られ");
    expect(avoid[1].textContent).toContain("匿名のアカウントはこの端末にだけ残ります");
    expect([...avoid[2].querySelectorAll("button")].map((b) => b.textContent.trim())).toEqual(["利用規約", "プライバシーポリシー", "お問い合わせ"]);
    expect(onOnboarding).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
  it("匿名のアカウントはあるがプロフィールが無い(参加の途中)なら印は立てない", async () => {
    account.uid = "me"; account.profile = null;
    const onOnboarding = vi.fn();
    const root = await drawTab(onOnboarding);
    await waitFor(() => bodyText().includes("参加してプロフィールを作る"), "参加前の画面");
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

describe("参加後1: 奏者を開く", () => {
  it("データの一覧の1人目だけが的を名乗り、開いたら印 openPerson(描いただけでは立てない)", async () => {
    const onOnboarding = vi.fn();
    await drawJoined(JoinedView, { initialTab: "data", onOnboarding });
    const rows = coachNamed("openPerson");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("role")).toBe("button");
    expect(rows[0].textContent).toContain("しろねこ");   // 一覧の先頭
    expect(onOnboarding).not.toHaveBeenCalledWith("openPerson");
    await click(rows[0]);
    expect(document.querySelector('[role="dialog"][aria-label="しろねこ の詳細"]')).not.toBe(null);
    expect(onOnboarding).toHaveBeenCalledWith("openPerson");
  });
  it("順位の一覧から開いても同じ印(人物のページを初めて開いた)", async () => {
    const onOnboarding = vi.fn();
    await drawJoined(JoinedView, { initialTab: "rank", onOnboarding });
    const row = kit.rankRowOf("くろねこ");
    await click(row);
    expect(onOnboarding).toHaveBeenCalledWith("openPerson");
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
    // 【便BP5】押すと確認のシートが開くカードなので、ほかの一手のカードを重ねない印も持つ
    expect(card[0].hasAttribute("data-coach-avoid")).toBe(true);
    expect(coachNamed("openPerson")).toHaveLength(1);
    await act(async () => root.unmount());
  });
  it("人数不足(2人)では平均カードは名乗らない(案内は出ない)。一覧の1人目は名乗る", async () => {
    const root = await draw({ ideals: kit.SERVER_IDEALS.slice(0, 2) });
    expect(bodyText()).not.toContain("目安を公開している");
    expect(document.querySelector(".card.card-accent")).not.toBe(null);
    expect(coachNamed("adoptAverage")).toHaveLength(0);
    expect(document.querySelector(".card.card-accent").hasAttribute("data-coach-avoid")).toBe(false);   // 押せないカードは印を持たない
    expect(coachNamed("openPerson")).toHaveLength(1);
    await act(async () => root.unmount());
  });
  it("一覧が空なら名乗る行が無い(参加後1の案内は出ない)", async () => {
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
