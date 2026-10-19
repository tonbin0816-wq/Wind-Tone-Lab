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
    // 【殻 S3】広告の帯の位置の定数と式(AD_H_INITIAL_PX / AD_MARGIN_MODE / adBannerMargin。仕様 §5.3 が policy.js に置く)が加わった。
    // メトロノームのゲインの関数(metroMasterGain)や Web の 2.6 の写しが無いことは変わらない。
    // 審査の裁定で、帯の取り直しの間引き(AD_RELOAD_DEBOUNCE_MS)と ATT の尋ね直しの待ち(ATT_RETRY_DELAY_MS)も加わった。
    // 統括の裁定で、ATT の尋ね直しの前の待ちの上限(ATT_FOCUS_WAIT_MAX_MS)も加わった。
    expect(Object.keys(policy).sort()).toEqual(["AD_H_INITIAL_PX", "AD_MARGIN_MODE", "AD_RELOAD_DEBOUNCE_MS", "ATT_FOCUS_WAIT_MAX_MS", "ATT_RETRY_DELAY_MS", "METRO_MASTER_GAIN_SHELL", "SHELL_STOP_MIC_ON_TAB_LEAVE", "adBannerMargin", "micActionOnTabLeave"]);
  });
});

// 【便CX 2026-10-19】殻の計測の音の呼び口 shellNativeAudio(src/shell/audio.js)。Web では null(動的 import もしない)。
// 殻では FicusAudioSession のメソッドをそのまま呼び、on(event, fn) は「受けるのをやめる関数」を返す。
// (出口を寄せる shellRouteToSpeaker は消した: 殻はもう WebKit で取り込まず、殻のセッションは殻がエンジンを始める前に用意する)
const reg = vi.hoisted(() => ({ names: [], calls: [], factory: 0, removed: 0 }));
vi.mock("@capacitor/core", () => {
  reg.factory++;
  return { registerPlugin: (name) => { reg.names.push(name); return {
    micStart: async (o) => { reg.calls.push(["micStart", o]); return { sampleRate: 48000 }; },
    addListener: async (ev) => { reg.calls.push(["addListener", ev]); return { remove: async () => { reg.removed++; } }; },
  }; } };
});
afterEach(() => { delete window.Capacitor; });
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

describe("shellNativeAudio ── 殻の計測の音の呼び口", () => {
  it("Web(window.Capacitor 無し)では null・@capacitor/core を読みもしない", async () => {
    const audio = await import("./audio.js");
    expect(audio.shellNativeAudio()).toBe(null);
    expect("shellRouteToSpeaker" in audio).toBe(false);
    await new Promise((r) => setTimeout(r, 200));   // 読まれるなら届くだけの時間を置いてから、読まれていないことを見る
    await settle();
    expect([reg.factory, reg.calls, reg.names]).toEqual([0, [], []]);
  });
  it("殻では FicusAudioSession を登録してメソッドを呼ぶ・on は受けるのをやめる関数を返す", async () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
    const { shellNativeAudio } = await import("./audio.js");
    const api = shellNativeAudio();
    expect(await api.micStart({ id: "m1" })).toEqual({ sampleRate: 48000 });
    const off = await api.on("micData", () => {});
    off();
    await settle();
    expect([reg.factory, reg.names, reg.calls, reg.removed]).toEqual([1, ["FicusAudioSession"], [["micStart", { id: "m1" }], ["addListener", "micData"]], 1]);
  });
});
