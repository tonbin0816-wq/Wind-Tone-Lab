// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { micActionOnTabLeave, SHELL_STOP_MIC_ON_TAB_LEAVE, METRO_MASTER_GAIN_SHELL } from "./policy.js";
import * as policy from "./policy.js";

// ------------------------------------------------------------------
// 【殻 S2 2026-10-05】殻での振る舞いの定数と純関数(src/shell/policy.js)と、音の出口の呼び口(src/shell/audio.js)。
// 期待値は凍結仕様 shell-spec.md §4.3・§4.4 の綴りから手で書く(定数から逆算しない)。
// ------------------------------------------------------------------
describe("micActionOnTabLeave ── 計測タブを離れたときのマイク", () => {
  it("殻は stop(解放)・Web は pause(接続を保つ。1fb310e の決まり)", () => {
    expect(SHELL_STOP_MIC_ON_TAB_LEAVE).toBe(true);
    expect(micActionOnTabLeave(true)).toBe("stop");
    expect(micActionOnTabLeave(false)).toBe("pause");
  });
  it("定数を false にした仮定では殻も pause(Web と同じ振る舞いへ1か所で戻せる)", () => {
    expect(micActionOnTabLeave(true, false)).toBe("pause");
    expect(micActionOnTabLeave(false, false)).toBe("pause");
  });
});

describe("METRO_MASTER_GAIN_SHELL ── 殻のメトロノームのマスターゲイン", () => {
  it("殻は 1.0。Web の 2.6 の写しは持たない(policy.js が出すのは定数だけ)", () => {
    expect(METRO_MASTER_GAIN_SHELL).toBe(1.0);
    expect(Object.keys(policy).sort()).toEqual(["METRO_MASTER_GAIN_SHELL", "SHELL_STOP_MIC_ON_TAB_LEAVE", "micActionOnTabLeave"]);
  });
});

// shellRouteToSpeaker: Web では動的 import もしない。殻では FicusAudioSession.routeToSpeaker を1回呼ぶ。
const reg = vi.hoisted(() => ({ names: [], calls: 0, factory: 0 }));
vi.mock("@capacitor/core", () => {
  reg.factory++;
  return { registerPlugin: (name) => { reg.names.push(name); return { routeToSpeaker: async () => { reg.calls++; return {}; } }; } };
});
afterEach(() => { delete window.Capacitor; });
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

describe("shellRouteToSpeaker ── 音の出口の呼び口", () => {
  it("Web(window.Capacitor 無し)では何もしない(@capacitor/core を読みもしない)", async () => {
    const { shellRouteToSpeaker } = await import("./audio.js");
    expect(shellRouteToSpeaker()).toBe(undefined);
    await new Promise((r) => setTimeout(r, 200));   // 読まれるなら届くだけの時間を置いてから、読まれていないことを見る
    await settle();
    expect([reg.factory, reg.calls, reg.names]).toEqual([0, 0, []]);
  });
  it("殻では FicusAudioSession を登録して routeToSpeaker を呼ぶ(待たない)", async () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
    const { shellRouteToSpeaker } = await import("./audio.js");
    expect(shellRouteToSpeaker()).toBe(undefined);
    // 動的 import は負荷によって数十 ms かかる(並列で回すと 0 秒のタイマー10回では足りないことがあった)。届くまで待つ
    for (let i = 0; i < 200 && reg.calls === 0; i++) await new Promise((r) => setTimeout(r, 10));
    await settle();
    expect([reg.factory, reg.calls, reg.names]).toEqual([1, 1, ["FicusAudioSession"]]);
  });
});
