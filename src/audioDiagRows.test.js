// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { AUDIO_DIAG, audioDiagRows, audioDiagNativeRows, audioDiagApplyMetroGain, audioDiagResetTests, audioDiagSetMetroGain } from "./audioDiag.jsx";
import { NATIVE_AUDIO } from "./shell/nativeAudio.js";

// ------------------------------------------------------------------
// 【便CX 2026-10-19】診断の板の行(src/audioDiag.jsx)。殻の計測の音が本番で殻になったので、試し口を整理し、殻の行は本番の殻の状態を出す。
// 【守っているもの】殻の行(nativeEngine / nativeSched / nativeIn / nativeClock / nativeBuf)の並びと書式・古い殻のビルドは「要ビルド」・
//   Web の行は試し口 gain と clickPeak を出し殻の行を出さない・殻は試し口の行(metroGain / clickPeak / testMode / playback)を出さず metro に phase を足す・
//   gain の当て方と戻し。期待値は板の決まり(DESIGN-SYSTEM §3.5 の「音の診断の板」)から手で書いた。
// 【守っていないもの】実機の値そのもの(実機待ち)。
// ------------------------------------------------------------------
const asShell = () => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" }; };
const rowsToObj = (rows) => Object.fromEntries(rows);
afterEach(() => {
  delete window.Capacitor;
  AUDIO_DIAG.getMetro = null; AUDIO_DIAG.nativeInfo = undefined; AUDIO_DIAG.metroGainX = 1;
  NATIVE_AUDIO.mic.error = ""; NATIVE_AUDIO.metro.error = ""; NATIVE_AUDIO.metro.bufPeaks = null; NATIVE_AUDIO.mic.lastRecvAt = null;
});

describe("【便CX】殻の行(audioDiagNativeRows)", () => {
  it("まだ読んでいない: nativeEngine は …・ほかは —", () => {
    const r = rowsToObj(audioDiagNativeRows(undefined, 0));
    expect([r.nativeEngine, r.nativeSched, r.nativeIn, r.nativeBuf]).toEqual(["…", "—", "—", "—"]);
  });
  it("古い殻のビルド(audioInfo が無い): 要ビルド・JS 側の失敗は js= に足す", () => {
    NATIVE_AUDIO.mic.error = "UNIMPLEMENTED";
    const r = rowsToObj(audioDiagNativeRows({ error: "UNIMPLEMENTED" }, 0));
    expect(r.nativeEngine).toBe("n/a (要ビルド: UNIMPLEMENTED) js=mic: UNIMPLEMENTED");
  });
  it("本番の値: エンジン・予約・入力・描いたクリックの並びと書式", () => {
    NATIVE_AUDIO.mic.lastRecvAt = 1000;
    NATIVE_AUDIO.metro.bufPeaks = { rate: 48000, accent: 0.862, beat: 0.564, sub: 0.317 };
    const ni = { engineRunning: true, activated: true, micOn: true, metroOn: false, configChanges: 3, rebuilds: 2, lastError: "", scheduled: 40, played: 38, playing: true, lastRender: true, tick: "ok",
      chunks: 120, inputRate: 48000, inputDb: -52.34, via: "sink", cbFrames: 256, cbMax: 512, sendMs: 21.3, sendMaxMs: 42.7, overruns: 0 };
    const r = rowsToObj(audioDiagNativeRows(ni, 1012));
    expect(r.nativeEngine).toBe("running=yes act=yes mic=yes metro=no cfg=3 rb=2 err=—");
    expect(r.nativeSched).toBe("sched=40 played=38 play=yes lrt=yes tick=ok");
    expect(r.nativeIn).toMatch(/^-52\.3 dBFS @48000 via=sink cb=256\/512 send=21\/43ms chunks=120 js=\d+ age=12ms$/);
    // installTap に戻ったとき・読み手が遅れて捨てたとき
    const r2 = rowsToObj(audioDiagNativeRows({ ...ni, via: "tap", cbFrames: 4800, cbMax: 4800, sendMs: 100, sendMaxMs: 101, overruns: 2 }, 1012));
    expect(r2.nativeIn).toMatch(/ via=tap cb=4800\/4800 send=100\/101ms .* ovr=2$/);
    expect(r.nativeBuf).toBe("0.862/0.564/0.317 @48000");
    expect(r.nativeClock).toMatch(/^— syncs=0 fails=0$/);
  });
});

describe("【便CX】板の行の出し分け(殻 / Web)", () => {
  it("Web: metroGain と clickPeak を出し、殻の行を出さない・metro に phase を足さない", () => {
    AUDIO_DIAG.getMetro = () => ({ ctx: { state: "running", currentTime: 1.5 }, on: true, phase: 2.25 });
    const r = rowsToObj(audioDiagRows(null, 0));
    expect(r.session).toBe("n/a (web)");
    expect(r.metroGain).toBe("x1");
    expect(r.clickPeak).toBe("—");
    expect(r.metro).toBe("on=yes ctx=running t=1.500");
    expect(r.nativeEngine).toBe(undefined);
    expect(r.testMode).toBe(undefined);
  });
  it("殻: 試し口の行(metroGain / clickPeak / testMode / playback)を出さず、殻の行と metro の phase を出す", () => {
    asShell();
    AUDIO_DIAG.getMetro = () => ({ ctx: { state: "running", currentTime: 100.25 }, on: true, phase: -0.24 });
    const r = rowsToObj(audioDiagRows({ category: "AVAudioSessionCategoryPlayAndRecord", mode: "AVAudioSessionModeDefault", options: 0x28 }, 0));
    expect(r.metro).toBe("on=yes ctx=running t=100.250 phase=-0.24");
    for (const k of ["metroGain", "clickPeak", "testMode", "playback"]) expect(r[k]).toBe(undefined);
    expect(r.nativeEngine).toBe("…");
    expect(r.options).toBe("0x28 defaultToSpeaker allowBluetoothA2DP");
  });
});

describe("【便CT】Web の試し口 gain の当て方と戻し", () => {
  it("鎖が無ければ ctx に置くだけ・あれば基の値 × 倍率・決まった3つの外は受けない・閉じる(audioDiagResetTests)と ×1", () => {
    const bare = {};
    audioDiagApplyMetroGain(bare, 1.3);
    expect(bare.__metroDiagGainX).toBe(1.3);
    const master = { gain: { value: 2.6 } };
    const ctx = { __metroMasterGain: master, __metroMasterBase: 2.6 };
    AUDIO_DIAG.getMetro = () => ({ ctx, on: true });
    audioDiagSetMetroGain(1.6);
    expect(master.gain.value).toBeCloseTo(2.6 * 1.6, 12);
    audioDiagSetMetroGain(2);
    expect(AUDIO_DIAG.metroGainX).toBe(1.6);
    audioDiagResetTests();
    expect([AUDIO_DIAG.metroGainX, master.gain.value]).toEqual([1, 2.6]);
  });
});
