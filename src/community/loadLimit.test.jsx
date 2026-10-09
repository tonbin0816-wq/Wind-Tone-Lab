// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便CJ 2026-10-10 本人の実機の指摘「コミュニティタブで63%くらいで止まることが多いので修正」】
// 63% = 段 account(匿名アカウントの確認 + 自分のプロフィールの読み)の行き着く値。画面のコードが端末に残っている2回目以降は
// account から割り直すので 35 / (35 + 20) = 63.6%。内挿は追い越さないので、account の1往復が返らない間は 63% のまま止まっていた。
// 直し: 読み込みの1往復(アカウントの確認・プロフィール・名簿・目安)を上限 COMMUNITY_LOAD_MAX_MS(既存の ATT_FOCUS_WAIT_MAX_MS = 10 秒)まで待ち、
// 過ぎたら今までの失敗の扱い(「通信に失敗しました」+「もう一度試す」/「みんなのデータを読み込めませんでした」/ 目安は空)へ進む。
// 返らない1往復は作り物のサーバー(accountRepo / directory / idealRepo の読みを「解けない約束」にする)で作る。
// 期待値は統括の仕様(「終わらない読み込みに上限(既存の値)を付けて先へ進む」)と、今までの失敗の文言から手で書いた。
// 【守っていないもの】本物の端末でどの1往復が返らないのか(Firebase の SDK の中。判定不能・実機待ち)。
// ------------------------------------------------------------------

globalThis.indexedDB = createFakeIndexedDb();
const never = () => new Promise(() => {});
const srv = vi.hoisted(() => ({ uid: "me", profile: null, hangUid: false, hangProfile: false, hangList: false, hangIdeals: false }));
vi.mock("./accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(() => (srv.hangUid ? new Promise(() => {}) : Promise.resolve(srv.uid))),
  loadProfile: vi.fn(() => (srv.hangProfile ? new Promise(() => {}) : Promise.resolve(srv.profile))),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => "me"),
}));
vi.mock("./directory.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(() => (srv.hangList ? new Promise(() => {}) : Promise.resolve(kit.SERVER_USERS))), publishStats: vi.fn(async () => {}) };
});
vi.mock("./reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));
vi.mock("./idealRepo.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listIdeals: vi.fn(() => (srv.hangIdeals ? new Promise(() => {}) : Promise.resolve(kit.SERVER_IDEALS))), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) };
});

const { withinLoadLimit, COMMUNITY_LOAD_MAX_MS, CommunityLoadTimeoutError } = await import("./loadLimit.js");
const { ATT_FOCUS_WAIT_MAX_MS } = await import("../shell/policy.js");
const { resetLoadProgress } = await import("./loadProgress.js");
const { default: CommunityTab } = await import("./CommunityTab.jsx");
const kit = await import("./blockKit.testutil.jsx");
const { setupDom, teardownDom, waitFor, buttonsNamed, bodyText } = kit;

describe("【便CJ】withinLoadLimit(返らない1往復を待ち続けない)", () => {
  afterEach(() => vi.useRealTimers());
  it("上限は既存の値(殻の待ちの上限 10 秒)。新しい値を作らない", () => {
    expect(COMMUNITY_LOAD_MAX_MS).toBe(ATT_FOCUS_WAIT_MAX_MS);
    expect(COMMUNITY_LOAD_MAX_MS).toBe(10000);
  });
  it("上限より先に返れば、その値(失敗ならその失敗)をそのまま返し、時計を残さない", async () => {
    vi.useFakeTimers();
    await expect(withinLoadLimit(Promise.resolve("v"), 50)).resolves.toBe("v");
    await expect(withinLoadLimit(Promise.reject(new Error("net")), 50)).rejects.toThrow("net");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("返らなければ、上限ちょうどで CommunityLoadTimeoutError(code は deadline-exceeded)。上限の手前ではまだ待つ", async () => {
    vi.useFakeTimers();
    let out = null;
    withinLoadLimit(never()).then((v) => { out = ["ok", v]; }, (e) => { out = ["ng", e]; });
    await vi.advanceTimersByTimeAsync(COMMUNITY_LOAD_MAX_MS - 1);
    expect(out).toBe(null);
    await vi.advanceTimersByTimeAsync(1);
    expect(out[0]).toBe("ng");
    expect(out[1]).toBeInstanceOf(CommunityLoadTimeoutError);
    expect(out[1].code).toBe("deadline-exceeded");
  });
});

describe("【便CJ】コミュニティタブ: 返らない読み込みがあっても、輪は上限で先へ進む(作り物のサーバー)", () => {
  let host = null; let root = null;
  beforeEach(() => {
    setupDom();
    resetLoadProgress();
    Object.assign(srv, { uid: "me", profile: kit.MY_PROFILE, hangUid: false, hangProfile: false, hangList: false, hangIdeals: false });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    root = null; host?.remove(); host = null;
    teardownDom();
    vi.restoreAllMocks();
  });
  async function draw() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<CommunityTab sessions={[]} tuningHz={442} onAdoptIdeal={() => ({})} />); });
  }
  const ringPct = () => {
    const box = document.querySelector('[role="img"][aria-label="読み込み中"]');
    const m = box ? /(\d+)%/.exec(box.textContent) : null;
    return m ? Number(m[1]) : null;
  };
  const joinedShown = () => ["データ", "順位", "シェア", "マイページ"].every((l) => buttonsNamed(l).length > 0);

  it("自分のプロフィールの読みが返らない: 輪は 63% で止まる(再現)→ 上限で「通信に失敗しました」+「もう一度試す」。押すと読み直して開く", async () => {
    srv.hangProfile = true;
    const t0 = Date.now();
    await draw();
    await waitFor(() => ringPct() === 63, "輪が 63%(段 account の行き着く値)", 9000);
    expect(Date.now() - t0).toBeLessThan(COMMUNITY_LOAD_MAX_MS);
    await waitFor(() => bodyText().includes("通信に失敗しました。電波の良いところでもう一度お試しください"), "上限で失敗の画面", 15000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(COMMUNITY_LOAD_MAX_MS - 50);
    expect(ringPct()).toBe(null);
    srv.hangProfile = false;
    await act(async () => { buttonsNamed("もう一度試す")[0].click(); });
    await waitFor(() => joinedShown(), "読み直して参加後の画面", 9000);
  }, 30000);

  it("匿名アカウントの確認が返らない: 上限で「通信に失敗しました」", async () => {
    srv.hangUid = true;
    await draw();
    await waitFor(() => ringPct() !== null, "輪");
    await waitFor(() => bodyText().includes("通信に失敗しました"), "上限で失敗の画面", 15000);
    expect(buttonsNamed("もう一度試す")).toHaveLength(1);
  }, 30000);

  it("名簿の読みが返らない: 上限で「みんなのデータを読み込めませんでした」(輪のまま止まらない)", async () => {
    srv.hangList = true;
    await draw();
    await waitFor(() => joinedShown(), "参加後の画面");
    await waitFor(() => ringPct() !== null, "名簿の輪");
    await waitFor(() => bodyText().includes("みんなのデータを読み込めませんでした"), "上限で名簿の失敗", 15000);
  }, 30000);

  it("目安の読みが返らない: 上限で空として扱い、データの子タブの輪が消える", async () => {
    srv.hangIdeals = true;
    await draw();
    await waitFor(() => joinedShown(), "参加後の画面");
    await waitFor(() => ringPct() !== null, "目安の輪");
    await waitFor(() => ringPct() === null, "上限で輪が消える", 15000);
  }, 30000);
});
