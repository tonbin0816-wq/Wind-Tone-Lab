// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { AUDIO_DIAG, audioDiagRows, audioDiagNativeRows, audioDiagApplyMetroGain, audioDiagResetTests, audioDiagSetMetroGain,
  audioDiagNoteMicRecover, audioDiagNoteMicRecoverResult, audioDiagNoteMicStartError, audioDiagMicPre, audioDiagMicRecoverDetail,
  audioDiagAgo, audioDiagNoteVisibility } from "./audioDiag.jsx";
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
  NATIVE_AUDIO.state = null; AUDIO_DIAG.lastMicRecover = null; AUDIO_DIAG.lastMicStartError = null; AUDIO_DIAG.lastFrameGapMs = null;
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

// 【便CY 2026-10-20】マイクの取り直しの行(micRecover)と、殻の最後の状態(nativeState)。期待値は書式の決まり(audioDiag.jsx の先頭の説明)から手で書いた。
// 【守っているもの】始めるときの様子(殻だけ chunkAge・st)・結果(ok / NG と理由 / superseded)・殻の audioInfo の足し込み・Web は様子を出さない・
//   失敗の詳細の一言(純関数)・startListening の失敗の理由の控え(code → message → name)。
// 【守っていないもの】実機でどの理由が出るか(実機待ち)。
describe("【便CY】micRecover の行 ── 始めるときの様子と結果", () => {
  const chunkAt = (t) => { NATIVE_AUDIO.mic.lastRecvAt = t; };
  it("取り直しが無い: —", () => {
    expect(rowsToObj(audioDiagRows(null, 0)).micRecover).toBe("—");
  });
  it("殻: 始めるときは 理由 [chunkAge st]・結果が来たら → ok / → NG 詳細 / → superseded。殻の audioInfo は後から足す", () => {
    asShell();
    chunkAt(1000);
    NATIVE_AUDIO.state = { state: "interrupted", reason: "began", mic: true, metro: true, at: Date.now() - 4000 };
    audioDiagNoteMicRecover("silence-watchdog");
    expect(AUDIO_DIAG.lastMicRecover.pre).toMatch(/^chunkAge=\d+ms gap=— st=interrupted\/began\(4s前\)$/);
    const row = () => rowsToObj(audioDiagRows(null, 0)).micRecover;
    expect(row()).toMatch(/^\d\d:\d\d:\d\d silence-watchdog \[chunkAge=\d+ms gap=— st=interrupted\/began\(4s前\)\]$/);
    audioDiagNoteMicRecoverResult("NG", "start=false err=session: x ctx=suspended track=none");
    expect(row()).toMatch(/silence-watchdog \[chunkAge=\d+ms gap=— st=interrupted\/began\(4s前\)\] → NG start=false err=session: x ctx=suspended track=none$/);
    AUDIO_DIAG.lastMicRecover.result.native = "native: err=interruption began running=no mic=no cfg=1 rb=0";
    expect(row()).toMatch(/ track=none native: err=interruption began running=no mic=no cfg=1 rb=0$/);
    audioDiagNoteMicRecoverResult("ok");
    expect(row()).toMatch(/\] → ok$/);
    audioDiagNoteMicRecoverResult("superseded");
    expect(row()).toMatch(/\] → superseded$/);
  });
  it("st= には知らせてからの経過を付ける(4s前)。経過が長いものは古い。時計が戻っても負にしない", () => {
    asShell();
    NATIVE_AUDIO.state = { state: "interrupted", reason: "began", mic: true, metro: false, at: 6000 };
    expect(audioDiagMicPre(5000, 10000)).toBe("chunkAge=— gap=— st=interrupted/began(4s前)");
    expect(audioDiagMicPre(5000, 6000 + 125000)).toBe("chunkAge=— gap=— st=interrupted/began(125s前)");
    expect(audioDiagMicPre(5000, 5000)).toBe("chunkAge=— gap=— st=interrupted/began(0s前)");
    expect(audioDiagAgo(6000, 10499)).toBe("4s前");
    expect(audioDiagAgo(6000, 10500)).toBe("5s前");
    expect(audioDiagAgo(undefined, 10000)).toBe("—");
  });
  it("裏へ行ったら(audioDiagNoteVisibility(true))殻の最後の状態を下ろす。戻っても(false)・状態が無くても何も起きない", () => {
    NATIVE_AUDIO.state = { state: "interrupted", reason: "began", mic: true, metro: true, at: 1 };
    audioDiagNoteVisibility(false, 5000);
    expect(NATIVE_AUDIO.state).not.toBe(null);
    audioDiagNoteVisibility(true, 6000);
    expect(NATIVE_AUDIO.state).toBe(null);
    audioDiagNoteVisibility(true, 7000);
    expect(NATIVE_AUDIO.state).toBe(null);
    expect(AUDIO_DIAG.lastHiddenAt).toBe(7000);
  });
  it("殻で塊も状態もまだ無い: chunkAge=— st=—", () => {
    asShell();
    expect(audioDiagMicPre(5000)).toBe("chunkAge=— gap=— st=—");
  });
  it("chunkAge は perfNow − 最後の塊の時刻(負にしない)", () => {
    asShell();
    chunkAt(1000);
    expect(audioDiagMicPre(3650)).toBe("chunkAge=2650ms gap=— st=—");
    expect(audioDiagMicPre(900)).toBe("chunkAge=0ms gap=— st=—");
  });
  it("gap = 解析のフレームの直近の間隔(四捨五入の ms)・0 や未記録は —", () => {
    asShell();
    chunkAt(1000);
    AUDIO_DIAG.lastFrameGapMs = 1834.4;
    expect(audioDiagMicPre(3000)).toBe("chunkAge=2000ms gap=1834ms st=—");
    AUDIO_DIAG.lastFrameGapMs = 0;
    expect(audioDiagMicPre(3000)).toBe("chunkAge=2000ms gap=— st=—");
  });
  it("Web: 様子は出さない(行は 理由 → 結果 だけ)", () => {
    expect(audioDiagMicPre(5000)).toBe("");
    audioDiagNoteMicRecover("gesture");
    audioDiagNoteMicRecoverResult("NG", "start=false err=NotAllowedError ctx=running track=none");
    expect(rowsToObj(audioDiagRows(null, 0)).micRecover).toMatch(/^\d\d:\d\d:\d\d gesture → NG start=false err=NotAllowedError ctx=running track=none$/);
  });
  it("取り直しが始まっていなければ、結果を足しても何も起きない", () => {
    audioDiagNoteMicRecoverResult("ok");
    expect(AUDIO_DIAG.lastMicRecover).toBe(null);
  });
  it("失敗の詳細の一言: start・err・ctx・track(muted は /muted)・無いものは — / none", () => {
    expect(audioDiagMicRecoverDetail({ ok: false, err: "DENIED", ctxState: "suspended", track: null })).toBe("start=false err=DENIED ctx=suspended track=none");
    expect(audioDiagMicRecoverDetail({ ok: true, err: null, ctxState: "running", track: { readyState: "live", muted: true } })).toBe("start=ok err=— ctx=running track=live/muted");
    expect(audioDiagMicRecoverDetail({ ok: true, err: "", ctxState: null, track: { readyState: "ended", muted: false } })).toBe("start=ok err=— ctx=none track=ended");
  });
  it("startListening の失敗の理由の控え: code → message → name の順・null で消す・長すぎれば 120 字", () => {
    audioDiagNoteMicStartError({ code: "DENIED", message: "denied", name: "Error" });
    expect(AUDIO_DIAG.lastMicStartError.text).toBe("DENIED");
    audioDiagNoteMicStartError({ message: "session: boom", name: "Error" });
    expect(AUDIO_DIAG.lastMicStartError.text).toBe("session: boom");
    audioDiagNoteMicStartError({ name: "NotAllowedError" });
    expect(AUDIO_DIAG.lastMicStartError.text).toBe("NotAllowedError");
    audioDiagNoteMicStartError({ message: "x".repeat(300) });
    expect(AUDIO_DIAG.lastMicStartError.text.length).toBe(120);
    audioDiagNoteMicStartError(null);
    expect(AUDIO_DIAG.lastMicStartError).toBe(null);
  });
});

describe("【便CY】nativeState の行 ── 殻が最後に知らせた状態", () => {
  it("まだ知らせが無い: — ・知らせがあれば 状態/理由 時刻 mic metro", () => {
    expect(rowsToObj(audioDiagNativeRows({}, 0)).nativeState).toBe("—");
    const t1 = new Date(2026, 9, 20, 14, 29, 5).getTime();
    NATIVE_AUDIO.state = { state: "interrupted", reason: "began", mic: true, metro: false, at: t1 };
    expect(rowsToObj(audioDiagNativeRows({}, 0, t1 + 4000)).nativeState).toBe("interrupted/began 14:29:05(4s前) mic=yes metro=no");
    const t2 = new Date(2026, 9, 20, 14, 30, 0).getTime();
    NATIVE_AUDIO.state = { state: "running", reason: "", mic: false, metro: true, at: t2 };
    expect(rowsToObj(audioDiagNativeRows({}, 0, t2 + 61000)).nativeState).toBe("running/— 14:30:00(61s前) mic=no metro=yes");
  });
});
