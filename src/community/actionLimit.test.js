import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withinActionLimit, COMMUNITY_ACTION_MAX_MS, CommunityActionTimeoutError, COMMUNITY_LOAD_MAX_MS } from "./loadLimit.js";

// ------------------------------------------------------------------
// 【便DD 審査 2026-10-23】匿名サインイン(ensureSignedIn)とプロフィールの保存(saveProfile)の上限。参加の場面は出られないので、
// 返らない往復を待ち続けない。値は統括の指示の 15 秒(期待値は指示の文から手で書く。定数から逆算しない)。
// 画面への配線(上限のあとに「もう一度試す」/ 保存の再送)は joinFirst.test.jsx が根を描いて見る。
// 【守っていないもの】本物の端末で15秒が長すぎ・短すぎないか(実機待ち)。
// ------------------------------------------------------------------
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("withinActionLimit", () => {
  it("上限は 15 秒(読みの上限 10 秒より長い)", () => {
    expect(COMMUNITY_ACTION_MAX_MS).toBe(15000);
    expect(COMMUNITY_ACTION_MAX_MS).toBeGreaterThan(COMMUNITY_LOAD_MAX_MS);
  });
  it("返らない約束は 15 秒ちょうどで失敗する(14.9 秒ではまだ待つ)。失敗は期限切れの code を持つ", async () => {
    let state = "pending"; let err = null;
    withinActionLimit(new Promise(() => {})).then(() => { state = "ok"; }, (e) => { state = "failed"; err = e; });
    await vi.advanceTimersByTimeAsync(14900);
    expect(state).toBe("pending");
    await vi.advanceTimersByTimeAsync(200);
    expect(state).toBe("failed");
    expect(err).toBeInstanceOf(CommunityActionTimeoutError);
    expect(err.code).toBe("deadline-exceeded");
  });
  it("上限のうちに返れば値を返し、時計を残さない。上限のうちの失敗はそのまま渡す", async () => {
    await expect(withinActionLimit(Promise.resolve("me"))).resolves.toBe("me");
    const boom = new Error("permission-denied");
    await expect(withinActionLimit(Promise.reject(boom))).rejects.toBe(boom);
    expect(vi.getTimerCount()).toBe(0);
  });
});
