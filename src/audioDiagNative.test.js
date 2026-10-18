// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { metroNativeClickPattern, renderMetroClickSamples } from "./App.jsx";
import {
  AUDIO_DIAG, audioDiagFloat32ToBase64, audioDiagSetPlayback, audioDiagSyncNativeClick, audioDiagResetTests,
  audioDiagCheckNativeSilence, audioDiagApplyMetroGain, AUDIO_DIAG_NATIVE_SILENT_MS,
} from "./audioDiag.jsx";

// ------------------------------------------------------------------
// 【便CU 2026-10-17】診断の板の試し口「鳴らし方」(殻の AVAudioEngine でクリックを鳴らす・マイクを取る)の部品。
// 【守っているもの】
//   ・殻へ渡す1小節の並び(metroNativeClickPattern): 期待値は譜の決まり(4/4 は拍ごと・分割は sub・X/8 は8分のグリッドで3と2のまとまり・
//     テンポは X/4 で四分・X/8 で付点四分)から手で書いた(実装の関数で期待値を作らない)
//   ・殻へ渡すクリックの描き出し(renderMetroClickSamples): 同じ鎖を Web Audio の仕様の式で回す作り物の OfflineAudioContext で描いたピークが、
//     DESIGN-SYSTEM の「今の出口」(Chrome 152 の実測 強拍 0.862・拍 0.564・弱拍 0.317 @48kHz)にそろう / 板の倍率・ミュートが混ざらない /
//     末尾の無音だけを落とす / 古い WebKit の oncomplete でも受け取れる
//   ・base64 の往復(殻へ渡す形)
//   ・鳴らし方の切り替え: 設定が変わったときだけ渡し直す・描いている間に止めたら始めない・閉じる(戻し)で殻の停止を呼ぶ
// 【守っていないもの】
//   ・作り物のリミッターは「閾値より下では持ち上げ(makeup)だけ」の形(Chromium の DynamicsCompressor の式 (1 / 0dB での利得)^0.6)。
//     入口が閾値を越えないことはここで確かめるが、本物の DynamicsCompressor の波形そのものは回していない。端末の WebKit で描いた本当の値は
//     板の nativeBuf の行に出る(実機待ち)
//   ・Swift(殻の AVAudioEngine)が予約どおりに鳴らすこと・大きく聞こえるか(実機待ち。綴りは pitch-test K.14)
// ------------------------------------------------------------------

describe("【便CU】殻へ渡す1小節の並び", () => {
  it("4/4・分割1・アクセントあり: 0.5 秒ごとに 強 拍 拍 拍(♩=120)", () => {
    expect(metroNativeClickPattern(120, "4/4", 1, true, null)).toEqual({ stepSec: 0.5, kinds: ["accent", "beat", "beat", "beat"] });
  });
  it("4/4・分割2: 0.25 秒ごとに 拍頭と sub が交互(♩=120)", () => {
    expect(metroNativeClickPattern(120, "4/4", 2, true, null)).toEqual({
      stepSec: 0.25, kinds: ["accent", "sub", "beat", "sub", "beat", "sub", "beat", "sub"],
    });
  });
  it("3/4・分割3・アクセントなし: 頭も beat(♩=60 で 1/3 秒ごと)", () => {
    const p = metroNativeClickPattern(60, "3/4", 3, false, null);
    expect(p.stepSec).toBeCloseTo(1 / 3, 12);
    expect(p.kinds).toEqual(["beat", "sub", "sub", "beat", "sub", "sub", "beat", "sub", "sub"]);
  });
  it("6/8・8分で埋める: 付点四分 = テンポ(♩.=90 → 8分は 2/9 秒)・強 弱 弱 拍 弱 弱", () => {
    const p = metroNativeClickPattern(90, "6/8", 2, true, null);
    expect(p.stepSec).toBeCloseTo(60 / 90 / 3, 12);
    expect(p.kinds).toEqual(["accent", "sub", "sub", "beat", "sub", "sub"]);
  });
  it("6/8・主拍だけ・アクセントなし: 拍の間の8分は鳴らさない", () => {
    expect(metroNativeClickPattern(90, "6/8", 1, false, null).kinds).toEqual(["beat", "silent", "silent", "beat", "silent", "silent"]);
  });
  it("7/8 を 2+2+3 にまとめたとき: まとまりの頭が拍", () => {
    expect(metroNativeClickPattern(120, "7/8", 2, true, [2, 2, 3]).kinds).toEqual(["accent", "sub", "beat", "sub", "beat", "sub", "sub"]);
  });
});

// 作り物の OfflineAudioContext。ノードの値と時刻を Web Audio の仕様の式で回す(バッファ音源・双二次のバンドパス・
// setValueAtTime / exponentialRampToValueAtTime・ゲイン)。リミッターは閾値より下で持ち上げだけ(上の【守っていないもの】)。
function makeOfflineCtor(log) {
  return class FakeOffline {
    constructor(ch, length, sampleRate) {
      this.length = length; this.sampleRate = sampleRate;
      this.destination = this.node("destination", (ins) => ins);
      log.ctors.push([ch, length, sampleRate]);
      log.ctxs.push(this);
    }
    node(kind, fn) {
      const nd = { kind, ins: [], out: null, connect: (dst) => { dst.ins.push(nd); return dst; }, disconnect() {} };
      nd.render = () => {
        if (nd.out) return nd.out;
        const sum = new Float64Array(this.length);
        for (const i of nd.ins) { const o = i.render(); for (let k = 0; k < sum.length; k++) sum[k] += o[k]; }
        nd.out = fn(sum, nd);
        return nd.out;
      };
      return nd;
    }
    param(v) {
      const p = { value: v, ev: [] };
      p.setValueAtTime = (x, t) => { p.ev.push(["set", x, t]); };
      p.exponentialRampToValueAtTime = (x, t) => { p.ev.push(["exp", x, t]); };
      p.linearRampToValueAtTime = () => { throw new Error("使っていないはず"); };
      p.at = (t) => {
        let v0 = p.value, t0 = 0;
        for (const [type, x, te] of p.ev) {
          if (type === "set") { if (te <= t) { v0 = x; t0 = te; } else break; }
          else if (t >= te) { v0 = x; t0 = te; }
          else return v0 * Math.pow(x / v0, (t - t0) / (te - t0));
        }
        return v0;
      };
      return p;
    }
    createBuffer(ch, len, sr) { const d = new Float32Array(len); return { length: len, sampleRate: sr, numberOfChannels: ch, getChannelData: () => d }; }
    createBufferSource() {
      const nd = this.node("source", () => {
        const out = new Float64Array(this.length);
        if (nd.startAt === undefined || !nd.buffer) return out;
        const d = nd.buffer.getChannelData(0);
        const s0 = Math.round(nd.startAt * this.sampleRate);
        for (let k = 0; k < d.length && s0 + k < out.length; k++) out[s0 + k] = d[k];
        return out;
      });
      nd.buffer = null;
      nd.start = (t) => { nd.startAt = t; };
      return nd;
    }
    createBiquadFilter() {
      const nd = this.node("biquad", (x) => {
        if (nd.type !== "bandpass") throw new Error(`bandpass だけ: ${nd.type}`);
        const w0 = 2 * Math.PI * nd.frequency.value / this.sampleRate;
        const alpha = Math.sin(w0) / (2 * nd.Q.value);
        const a0 = 1 + alpha;
        const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;
        const y = new Float64Array(x.length);
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let k = 0; k < x.length; k++) {
          const v = b0 * x[k] + b2 * x2 - a1 * y1 - a2 * y2;
          x2 = x1; x1 = x[k]; y2 = y1; y1 = v; y[k] = v;
        }
        return y;
      });
      nd.type = ""; nd.frequency = this.param(350); nd.Q = this.param(1); nd.gain = this.param(0);
      return nd;
    }
    createGain() {
      const nd = this.node("gain", (x) => x.map((v, k) => v * nd.gain.at(k / this.sampleRate)));
      nd.gain = this.param(1);
      return nd;
    }
    createDynamicsCompressor() {
      const nd = this.node("comp", (x, self) => {
        const thrDb = self.threshold.value, ratio = self.ratio.value;
        const thr = Math.pow(10, thrDb / 20);
        const fullRange = Math.pow(10, (thrDb + (0 - thrDb) / ratio) / 20);
        const makeup = Math.pow(1 / fullRange, 0.6);
        let inPeak = 0;
        for (const v of x) inPeak = Math.max(inPeak, Math.abs(v));
        log.compIn.push(inPeak / thr);
        // 立ち上がり: 作った直後は持ち上げが立ち上がっていない(Chrome 152 の実測で、0 秒の音は約 0.17 倍・0.01 秒後 0.37 倍・0.05 秒後 0.95 倍・0.1 秒後から 1 倍)。
        // おおよその形として 0.06 秒で 1 倍になる直線にする(0 秒に置いた描き出しを落とすため)
        return x.map((v, k) => v * makeup * Math.min(1, k / this.sampleRate / 0.06));
      });
      for (const k of ["threshold", "knee", "ratio", "attack", "release"]) nd[k] = this.param(0);
      return nd;
    }
    startRendering() {
      const out = Float32Array.from(this.destination.render());
      return Promise.resolve({ length: out.length, getChannelData: () => out });
    }
  };
}
const peakOf = (d) => d.reduce((a, v) => Math.max(a, Math.abs(v)), 0);

describe("【便CU】殻で鳴らすクリックの描き出し(renderMetroClickSamples)", () => {
  afterEach(() => { AUDIO_DIAG.metroGainX = 1; AUDIO_DIAG.playback = "web"; });
  for (const [rate, want] of [[48000, { accent: 0.862, beat: 0.564, sub: 0.317 }], [44100, { accent: 0.862, beat: 0.555, sub: 0.313 }]]) {
    it(`${rate}Hz: 3段のピークが今の出口(DESIGN-SYSTEM の表)と ±0.01 でそろい、リミッターの入口は閾値を越えない`, async () => {
      const log = { ctors: [], ctxs: [], compIn: [] };
      const r = await renderMetroClickSamples(rate, makeOfflineCtor(log));
      expect(r.sampleRate).toBe(rate);
      for (const k of ["accent", "beat", "sub"]) expect(Math.abs(peakOf(r[k]) - want[k])).toBeLessThan(0.01);
      expect(log.compIn.every((x) => x <= 1.0005)).toBe(true);
      // 描く長さは Web の最初のクリックと同じ 0.12 秒の助走 + 除外の窓の後ろ 90ms(isNearScheduledClick の postMs)・モノラル
      expect(log.ctors).toEqual([1, 2, 3].map(() => [1, Math.round(rate * 0.12) + Math.ceil(rate * 0.09), rate]));
    });
  }
  it("板の倍率(×1.6)とミュート(鳴らし方 native)は描き出しに混ざらない(新しい ctx には何も置かない)・マスターは殻の値 1.0", async () => {
    AUDIO_DIAG.metroGainX = 1.6;
    AUDIO_DIAG.playback = "nativeClick";
    const log = { ctors: [], ctxs: [], compIn: [] };
    const r = await renderMetroClickSamples(48000, makeOfflineCtor(log));
    expect(Math.abs(peakOf(r.accent) - 0.862)).toBeLessThan(0.01);
    for (const c of log.ctxs) {
      expect(c.__metroMasterBase).toBe(1);
      expect(c.__metroMasterGain.gain.value).toBe(1);
      expect(c.__metroDiagGainX).toBe(undefined);
    }
  });
  it("助走(0.12 秒)の後ろから切り出し、末尾の無音(0.0001 より小さい標本)だけを落とす・頭の 0 は落とさない", async () => {
    const tail = [0, 0.5, -0.3, 0.00005, -0.00002, 0, 0];
    class Stub {
      constructor(ch, length, sampleRate) { this.sampleRate = sampleRate; this.length = length; this.destination = { connect() {} }; }
      createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
      createBufferSource() { return { connect: (d) => d, start() {} }; }
      createBiquadFilter() { return { connect: (d) => d, frequency: { value: 0 }, Q: { value: 0 } }; }
      createGain() { return { connect: (d) => d, gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
      createDynamicsCompressor() { const p = () => ({ value: 0 }); return { connect: (d) => d, threshold: p(), knee: p(), ratio: p(), attack: p(), release: p() }; }
      // 助走(0.12 秒)の間にも音があることにして、そこは切り出されないことも見る
      startRendering() {
        const d = new Float32Array(this.length);
        d.fill(0.9, 0, Math.round(this.sampleRate * 0.12));
        d.set(tail, Math.round(this.sampleRate * 0.12));
        return Promise.resolve({ getChannelData: () => d });
      }
    }
    const r = await renderMetroClickSamples(48000, Stub);
    expect(Array.from(r.accent)).toEqual([0, 0.5, Math.fround(-0.3)]);
  });
  it("古い WebKit(startRendering が Promise を返さず oncomplete で渡す)でも受け取れる", async () => {
    class OldWebKit {
      constructor(ch, length, sampleRate) { this.sampleRate = sampleRate; this.length = length; this.destination = { connect() {} }; }
      createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
      createBufferSource() { return { connect: (d) => d, start() {} }; }
      createBiquadFilter() { return { connect: (d) => d, frequency: { value: 0 }, Q: { value: 0 } }; }
      createGain() { return { connect: (d) => d, gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
      createDynamicsCompressor() { const p = () => ({ value: 0 }); return { connect: (d) => d, threshold: p(), knee: p(), ratio: p(), attack: p(), release: p() }; }
      startRendering() {
        const d = new Float32Array(this.length);
        d[Math.round(this.sampleRate * 0.12)] = 0.25;
        setTimeout(() => this.oncomplete({ renderedBuffer: { getChannelData: () => d } }), 0);
      }
    }
    const r = await renderMetroClickSamples(48000, OldWebKit);
    expect(Array.from(r.beat)).toEqual([0.25]);
  });
});

describe("【便CU】base64 の往復", () => {
  it("Float32 の標本を base64 にして戻すと同じ(0x8000 バイトの切れ目をまたぐ長さ)", () => {
    const f = new Float32Array(20000);
    for (let i = 0; i < f.length; i++) f[i] = Math.sin(i * 0.37) * (i % 7 === 0 ? -1 : 0.5);
    const bin = atob(audioDiagFloat32ToBase64(f));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    expect(bytes.length).toBe(80000);
    expect(Array.from(new Float32Array(bytes.buffer))).toEqual(Array.from(f));
  });
});

describe("【便CU】鳴らし方の切り替え(殻への呼び出しの順と引数)", () => {
  let calls; let metro; let api; let gate;
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const setup = () => {
    calls = [];
    gate = null;
    const ok = (name) => async (arg) => { calls.push(arg === undefined ? [name] : [name, arg]); return {}; };
    api = { load: ok("load"), start: ok("start"), stop: ok("stop"), inStart: ok("inStart"), inStop: ok("inStop"), info: ok("info") };
    const master = { gain: { value: 1 } };
    metro = {
      on: true, tempo: 120,
      ctx: { sampleRate: 48000, __metroMasterGain: master, __metroMasterBase: 1 },
    };
    AUDIO_DIAG.getMetro = () => ({ ctx: metro.ctx, on: metro.on, clickPattern: () => ({ stepSec: 60 / metro.tempo, kinds: ["accent", "beat"] }) });
    AUDIO_DIAG.renderClicks = async (sr) => {
      if (gate) await gate;
      return { sampleRate: sr, accent: new Float32Array([0.5]), beat: new Float32Array([0.25]), sub: new Float32Array([0.125]) };
    };
    AUDIO_DIAG.webMic = { recording: () => false, stop: () => calls.push(["webMic.stop"]), restore: async () => { calls.push(["webMic.restore"]); return true; } };
    AUDIO_DIAG.native = { clickKey: null, loadedRate: null, bufPeaks: null, info: undefined, error: "", silent: "", gen: 0, watchAt: 0, watchSched: null, renderTimeoutMs: 5000, held: [], soloHeld: false, releasing: null, chain: Promise.resolve() };
  };
  afterEach(() => {
    AUDIO_DIAG.playback = "web"; AUDIO_DIAG.metroGainX = 1;
    AUDIO_DIAG.getMetro = null; AUDIO_DIAG.renderClicks = null; AUDIO_DIAG.webMic = null;
  });
  it("nativeClick: 描いた3段を1回渡し(base64・sampleRate)、今の並びで始める・Web のマスターは 0。テンポが替わったら渡し直す(描き直さない)・止めたら停止", async () => {
    setup();
    await audioDiagSetPlayback("nativeClick", api);
    await flush();
    expect(metro.ctx.__metroMasterGain.gain.value).toBe(0);
    expect(calls).toEqual([
      ["load", { sampleRate: 48000, accent: audioDiagFloat32ToBase64(new Float32Array([0.5])), beat: audioDiagFloat32ToBase64(new Float32Array([0.25])), sub: audioDiagFloat32ToBase64(new Float32Array([0.125])) }],
      ["start", { stepSec: 0.5, kinds: ["accent", "beat"] }],
    ]);
    expect(AUDIO_DIAG.native.bufPeaks).toEqual({ rate: 48000, accent: 0.5, beat: 0.25, sub: 0.125 });
    // 同じ設定のままなら何も送らない
    audioDiagSyncNativeClick(api); await flush();
    expect(calls.length).toBe(2);
    metro.tempo = 100;
    audioDiagSyncNativeClick(api); await flush();
    expect(calls.slice(2)).toEqual([["start", { stepSec: 0.6, kinds: ["accent", "beat"] }]]);
    metro.on = false;
    audioDiagSyncNativeClick(api); await flush();
    expect(calls.slice(3)).toEqual([["stop"]]);
  });
  it("描いている間に web に戻したら始めない(戻しの停止だけ)・Web のマスターは基の値 × 倍率へ戻る", async () => {
    setup();
    AUDIO_DIAG.metroGainX = 1.3;
    let release;
    gate = new Promise((r) => { release = r; });
    audioDiagSetPlayback("nativeClick", api);
    await flush();
    const back = audioDiagSetPlayback("web", api);
    release();
    await back; await flush();
    expect(calls.map((c) => c[0])).toEqual(["load", "stop"]);
    expect(metro.ctx.__metroMasterGain.gain.value).toBeCloseTo(1.3, 12);
  });
  it("nativeBoth: 殻の取り込みを先に始めてから Web のマイクを止める。閉じる(audioDiagResetTests)と殻のクリックを先に止め、それから殻の取り込みを止めて Web のマイクを戻す", async () => {
    setup();
    await audioDiagSetPlayback("nativeBoth", api);
    await flush();
    expect(calls.map((c) => c[0])).toEqual(["inStart", "webMic.stop", "load", "start"]);
    const modes = [];
    await audioDiagResetTests(async (m) => { modes.push(m); return { mode: "AVAudioSessionModeDefault" }; }, api);
    await flush();
    expect(calls.slice(4).map((c) => c[0])).toEqual(["stop", "inStop", "webMic.restore"]);
    expect(AUDIO_DIAG.playback).toBe("web");
    expect(modes).toEqual(["default"]);
  });
  // 【便CU 審査】殻の取り込みが始められなかったら、Web のマイクは止めない・鳴らし方は前の値・Web のマスターも戻す
  for (const [how, fail] of [["失敗を返す", async () => ({ error: "not playAndRecord" })], ["投げる(reject)", async () => { throw new Error("boom"); }]]) {
    it(`nativeBoth: 殻の取り込みが${how}と、Web のトラックは stop されず、playback は前の値(web)に戻り、マスターも基の値 × 倍率に戻る`, async () => {
      setup();
      AUDIO_DIAG.metroGainX = 1.3;
      audioDiagSetPlayback("web", api); // 何もしない(前も web)
      api.inStart = async (...a) => { calls.push(["inStart"]); return fail(...a); };
      await audioDiagSetPlayback("nativeBoth", api);
      await flush();
      expect(calls.map((c) => c[0])).toEqual(["inStart"]);
      expect(AUDIO_DIAG.playback).toBe("web");
      expect(metro.ctx.__metroMasterGain.gain.value).toBeCloseTo(1.3, 12);
      expect(AUDIO_DIAG.native.error).toMatch(/^inStart: /);
    });
  }
  it("nativeBoth: nativeClick から選んで殻の取り込みが失敗したら、nativeClick に戻る(Web のマイクは止めない・マスターは 0 のまま・殻のクリックはそのまま)", async () => {
    setup();
    await audioDiagSetPlayback("nativeClick", api);
    await flush();
    api.inStart = async () => { calls.push(["inStart"]); return { error: "x" }; };
    await audioDiagSetPlayback("nativeBoth", api);
    await flush();
    expect(calls.map((c) => c[0])).toEqual(["load", "start", "inStart", "start"]);
    expect(AUDIO_DIAG.playback).toBe("nativeClick");
    expect(metro.ctx.__metroMasterGain.gain.value).toBe(0);
  });
  it("戻す道で二重に鳴らない: 殻のクリックを止め終わるまで、戻すと決めた時点の ctx のマスターは 0・止め終わってから殻の取り込みを止め、Web のマイクを戻し、マスターを戻す", async () => {
    setup();
    await audioDiagSetPlayback("nativeBoth", api);
    await flush();
    calls.length = 0;
    let release;
    api.stop = (...a) => { calls.push(["stop"]); return new Promise((r) => { release = () => r({}); }); };
    const back = audioDiagSetPlayback("web", api);
    await flush();
    expect(AUDIO_DIAG.playback).toBe("web");
    expect(calls.map((c) => c[0])).toEqual(["stop"]);                 // 殻の取り込み・Web のマイクはまだ
    expect(metro.ctx.__metroMasterGain.gain.value).toBe(0);            // 殻のクリックが止まるまで Web は鳴らさない
    const fresh = { __metroMasterGain: { gain: { value: 1 } }, __metroMasterBase: 1 };
    const { audioDiagApplyMetroGain } = await import("./audioDiag.jsx");
    audioDiagApplyMetroGain(fresh, 1);                                 // この間に START で作り直した ctx は ×倍率(殻と一瞬二重に鳴るのは許す。統括の裁定 (a))
    expect(fresh.__metroMasterGain.gain.value).toBe(1);
    release();
    await back; await flush();
    expect(calls.map((c) => c[0])).toEqual(["stop", "inStop", "webMic.restore"]);
    expect(metro.ctx.__metroMasterGain.gain.value).toBe(1);
  });
  // 【便CU 再審査】列の前の処理が終わらなくても、閉じた後の START(本番の startMetronome → audioDiagApplyMetroGain)はマスターが ×倍率(無音にしない)
  it("列の前の処理(描き出し)が終わらないまま閉じて計測タブを離れても、そのあとの START の新しい ctx はマスターが ×倍率", async () => {
    setup();
    AUDIO_DIAG.metroGainX = 1.3;
    gate = new Promise(() => {});                                        // 描き出しが永遠に終わらない
    audioDiagSetPlayback("nativeClick", api);
    await flush();
    audioDiagResetTests(async () => ({ mode: "x" }), api);               // 閉じる(列が詰まっているので終わりは待てない)
    AUDIO_DIAG.getMetro = null;                                         // 計測タブを離れた
    await flush();
    const { audioDiagApplyMetroGain, audioDiagSetMetroGain } = await import("./audioDiag.jsx");
    audioDiagSetMetroGain(1.3);                                         // 板を開き直して x1.3 を選んだ
    const fresh = { __metroMasterGain: { gain: { value: 0.5 } }, __metroMasterBase: 1 };
    audioDiagApplyMetroGain(fresh, AUDIO_DIAG.metroGainX);
    expect(AUDIO_DIAG.playback).toBe("web");
    expect(fresh.__metroMasterGain.gain.value).toBeCloseTo(1.3, 12);
  });
  it("録音の開始から戻すとき(skipRestore)は Web のマイクを戻さない(呼び手が取る)", async () => {
    setup();
    await audioDiagSetPlayback("nativeBoth", api);
    await flush();
    calls.length = 0;
    await audioDiagSetPlayback("web", api, { skipRestore: true });
    await flush();
    expect(calls.map((c) => c[0])).toEqual(["stop", "inStop"]);
    expect(AUDIO_DIAG.playback).toBe("web");
  });
  // ---- 【便CV】殻の音が出ていないままミュートを続けない(本人の実機「web 以外で鳴らすと音が消える」) ----
  const silentSetup = (x = 1.3) => {
    setup();
    AUDIO_DIAG.metroGainX = x;
  };
  const afterSilent = async (reason) => {
    await flush();
    expect(AUDIO_DIAG.playback).toBe("nativeClick");              // 選びはそのまま
    expect(AUDIO_DIAG.native.silent).toBe(reason);
    expect(metro.ctx.__metroMasterGain.gain.value).toBeCloseTo(AUDIO_DIAG.metroGainX, 12); // Web のマスターは基の値 × 倍率に戻る
    const fresh = { __metroMasterGain: { gain: { value: 0 } }, __metroMasterBase: 1 };
    audioDiagApplyMetroGain(fresh, AUDIO_DIAG.metroGainX);          // その後に作り直した ctx も ×倍率(無音にしない)
    expect(fresh.__metroMasterGain.gain.value).toBeCloseTo(AUDIO_DIAG.metroGainX, 12);
  };
  it("nativeClickStart が失敗を返したら、Web のマスターを戻して native=silent(start)。", async () => {
    silentSetup();
    api.start = async (o) => { calls.push(["start", o]); return { error: "engine not running" }; };
    await audioDiagSetPlayback("nativeClick", api);
    await afterSilent("start");
  });
  it("nativeClickStart が reject(投げる)でも同じ: native=silent(start)", async () => {
    silentSetup();
    api.start = async () => { throw new Error("boom"); };
    await audioDiagSetPlayback("nativeClick", api);
    await afterSilent("start");
    expect(AUDIO_DIAG.native.error).toBe("start: boom");
  });
  it("nativeClickLoad が失敗しても(投げても)native=silent(load)・start は呼ばない", async () => {
    silentSetup();
    api.load = async () => { throw new Error("no"); };
    await audioDiagSetPlayback("nativeClick", api);
    await afterSilent("load");
    expect(calls.map((c) => c[0])).toEqual([]);
  });
  it("描き出しが終わらない(AUDIO_DIAG.native.renderTimeoutMs)・描き出しが投げる: native=silent(render)。列は詰まらない(web へ戻せる)", async () => {
    silentSetup();
    AUDIO_DIAG.native.renderTimeoutMs = 30;
    AUDIO_DIAG.renderClicks = () => new Promise(() => {});
    await audioDiagSetPlayback("nativeClick", api);
    await new Promise((r) => setTimeout(r, 80));
    await afterSilent("render");
    await audioDiagSetPlayback("web", api);                          // 詰まっていれば、ここで止まる
    expect(AUDIO_DIAG.playback).toBe("web");
    setup(); silentSetup();
    AUDIO_DIAG.renderClicks = async () => { throw new Error("offline failed"); };
    await audioDiagSetPlayback("nativeClick", api);
    await afterSilent("render");
    expect(AUDIO_DIAG.native.error).toBe("render: offline failed");
  });
  // 【便CV 審査】古い処理の失敗を、選び直したあとの正常な殻に掛けない(世代)
  it("古い描き出しの時間切れが、選び直したあと(nativeClick → web → nativeClick)の殻に silent を立てない", async () => {
    silentSetup();
    AUDIO_DIAG.native.renderTimeoutMs = 100;
    let n = 0;
    AUDIO_DIAG.renderClicks = (sr) => {
      n++;
      if (n === 1) return new Promise(() => {});                    // 1回目だけ永久に終わらない
      return Promise.resolve({ sampleRate: sr, accent: new Float32Array([0.5]), beat: new Float32Array([0.25]), sub: new Float32Array([0.125]) });
    };
    audioDiagSetPlayback("nativeClick", api);
    await flush();                                                   // 1回目の描き出しが始まって止まっている
    audioDiagSetPlayback("web", api);
    const again = audioDiagSetPlayback("nativeClick", api);
    await new Promise((r) => setTimeout(r, 250));                    // 1回目が時間切れになる(100ms)・列が進んで2回目の描き出しと start が済む
    await again; await flush();
    expect(n).toBe(2);
    expect(AUDIO_DIAG.native.silent).toBe("");                       // 古い時間切れは今の選びに掛からない
    expect(AUDIO_DIAG.playback).toBe("nativeClick");
    expect(metro.ctx.__metroMasterGain.gain.value).toBe(0);          // 殻が鳴っているので Web は 0 のまま
    expect(calls.map((c) => c[0])).toContain("start");
  });
  it("古い load / start の失敗も、世代が進んでいれば今の選びに silent を立てない", async () => {
    silentSetup();
    let release;
    const slow = new Promise((r) => { release = r; });
    api.load = async (o) => { calls.push(["load", o]); await slow; return { error: "late" }; };
    audioDiagSetPlayback("nativeClick", api);
    await flush();                                                   // load が待っている
    audioDiagSetPlayback("web", api);
    api.load = async (o) => { calls.push(["load", o]); return {}; };
    const again = audioDiagSetPlayback("nativeClick", api);
    release();                                                       // 古い load が失敗で返る
    await again; await flush();
    expect(AUDIO_DIAG.native.silent).toBe("");
    expect(AUDIO_DIAG.playback).toBe("nativeClick");
  });
  it("古い start の失敗も、世代が進んでいれば今の選びに silent を立てない", async () => {
    silentSetup();
    let release;
    const slow = new Promise((r) => { release = r; });
    api.start = async (o) => { calls.push(["start", o]); await slow; return { error: "late" }; };
    audioDiagSetPlayback("nativeClick", api);
    await flush();                                                   // start が待っている
    audioDiagSetPlayback("web", api);
    api.start = async (o) => { calls.push(["start", o]); return {}; };
    const again = audioDiagSetPlayback("nativeClick", api);
    release();                                                       // 古い start が失敗で返る
    await again; await flush();
    expect(AUDIO_DIAG.native.silent).toBe("");
    expect(AUDIO_DIAG.playback).toBe("nativeClick");
    expect(metro.ctx.__metroMasterGain.gain.value).toBe(0);
  });
  it("描き出した3段のどれかが無音(ピーク < 0.05)だったら native=silent(buf)・殻へ渡さない・nativeBuf のピークは残る", async () => {
    silentSetup();
    AUDIO_DIAG.renderClicks = async (sr) => ({ sampleRate: sr, accent: new Float32Array([0.8]), beat: new Float32Array([0.4]), sub: new Float32Array([0.01]) });
    await audioDiagSetPlayback("nativeClick", api);
    await afterSilent("buf");
    expect(calls).toEqual([]);
    expect(AUDIO_DIAG.native.bufPeaks).toEqual({ rate: 48000, accent: Math.fround(0.8), beat: Math.fround(0.4), sub: Math.fround(0.01) });
  });
  it("選び直すと silent は消え、また Web のマスターは 0 に戻る(殻が直っていれば鳴らす)", async () => {
    silentSetup();
    let fail = true;
    api.start = async (o) => { calls.push(["start", o]); return fail ? { error: "x" } : {}; };
    await audioDiagSetPlayback("nativeClick", api);
    await afterSilent("start");
    fail = false;
    await audioDiagSetPlayback("nativeClick", api);
    await flush();
    expect(AUDIO_DIAG.native.silent).toBe("");
    expect(metro.ctx.__metroMasterGain.gain.value).toBe(0);
  });
  it("予約が進まない: メトロノームが鳴っているのに ni.scheduled が3秒(下限)動かなければ native=silent(noSched)。進めば基準が動く・止まっている間は数えない", async () => {
    silentSetup();
    await audioDiagSetPlayback("nativeClick", api);
    await flush();
    expect(AUDIO_DIAG.native.silent).toBe("");
    const t0 = 1_000_000;
    AUDIO_DIAG.native.watchAt = t0; AUDIO_DIAG.native.watchSched = 5;                              // 1つ前の読みで 5 だった(基準は t0)
    audioDiagCheckNativeSilence({ scheduled: 5 }, t0 + AUDIO_DIAG_NATIVE_SILENT_MS - 1);          // まだ
    expect(AUDIO_DIAG.native.silent).toBe("");
    audioDiagCheckNativeSilence({ scheduled: 6 }, t0 + AUDIO_DIAG_NATIVE_SILENT_MS + 500);        // 進んだ → 基準を取り直す
    audioDiagCheckNativeSilence({ scheduled: 6 }, t0 + AUDIO_DIAG_NATIVE_SILENT_MS + 500 + AUDIO_DIAG_NATIVE_SILENT_MS - 1);
    expect(AUDIO_DIAG.native.silent).toBe("");
    metro.on = false;                                                                              // 止めている間は数えない
    audioDiagCheckNativeSilence({ scheduled: 6 }, t0 + 20000);
    audioDiagCheckNativeSilence({ scheduled: 6 }, t0 + 30000);
    expect(AUDIO_DIAG.native.silent).toBe("");
    metro.on = true;
    audioDiagCheckNativeSilence({ scheduled: 6 }, t0 + 30100);                                    // 鳴らし直した: ここが基準
    audioDiagCheckNativeSilence({ scheduled: 6 }, t0 + 30100 + AUDIO_DIAG_NATIVE_SILENT_MS);
    await afterSilent("noSched");
  });
  it("予約の見張りの窓は最長の間隔の2倍(20 bpm = 3 秒の間隔でも誤って silent にしない)・殻の状態が読めない間は数えない・web では何もしない", async () => {
    silentSetup();
    await audioDiagSetPlayback("nativeClick", api);
    await flush();
    AUDIO_DIAG.getMetro = () => ({ ctx: metro.ctx, on: true, clickPattern: () => ({ stepSec: 3, kinds: ["accent"] }) });  // ♩=20
    const t0 = 5_000_000;
    audioDiagCheckNativeSilence({ scheduled: 1 }, t0);
    audioDiagCheckNativeSilence({ scheduled: 1 }, t0 + 5999);
    expect(AUDIO_DIAG.native.silent).toBe("");
    audioDiagCheckNativeSilence({ error: "UNIMPLEMENTED" }, t0 + 8000);                           // 読めない間は基準を取り直すだけ
    audioDiagCheckNativeSilence({ error: "UNIMPLEMENTED" }, t0 + 20000);
    expect(AUDIO_DIAG.native.silent).toBe("");
    audioDiagCheckNativeSilence({ scheduled: 1 }, t0 + 20000);
    audioDiagCheckNativeSilence({ scheduled: 1 }, t0 + 26000);
    expect(AUDIO_DIAG.native.silent).toBe("noSched");
    await audioDiagSetPlayback("web", api);
    audioDiagCheckNativeSilence({ scheduled: 1 }, t0 + 99000);                                    // web では何もしない(silent は web への切り替えで消えている)
    expect(AUDIO_DIAG.native.silent).toBe("");
  });
  it("録音中は nativeBoth を選ばせない(殻を呼ばない・Web のマイクを止めない)", async () => {
    setup();
    AUDIO_DIAG.webMic.recording = () => true;
    await audioDiagSetPlayback("nativeBoth", api);
    await flush();
    expect(calls).toEqual([]);
    expect(AUDIO_DIAG.playback).toBe("web");
    expect(AUDIO_DIAG.native.error).toBe("nativeBoth: recording");
  });
  it("選んでいない(web)まま閉じても殻を1回も呼ばない", async () => {
    setup();
    await audioDiagResetTests(async () => ({ mode: "x" }), api);
    audioDiagSyncNativeClick(api);
    await flush();
    expect(calls).toEqual([]);
  });
  it("計測タブを離れた(MeasureView が外れて getMetro が無い)ら web に戻して止める", async () => {
    setup();
    await audioDiagSetPlayback("nativeClick", api);
    await flush();
    AUDIO_DIAG.getMetro = null;
    audioDiagSyncNativeClick(api);
    await flush();
    expect(AUDIO_DIAG.playback).toBe("web");
    expect(calls.at(-1)).toEqual(["stop"]);
  });
});

// ------------------------------------------------------------------
// 【便CW 2026-10-18】nativeSolo = nativeBoth + Web の AudioContext をすべて suspend + navigator.audioSession.type を "auto"。
// 【守っているもの】選ぶと(殻の取り込みが始まり Web のマイクを止めたあとで)ctx を止め・殻の「止まったら resume」の手当てを外し・type を auto /
//   戻すと resume と type の戻し(AUDIO_SESSION_TYPE)がその場で(殻のクリックの停止より前・Web のマスターは止め終わるまで 0)、そのあと殻の停止 → 取り込みの停止 → マイクの戻し /
//   resume で戻らなければメトロノームを止める(次の START が作り直す)/ 失敗の道(殻の取り込みが始まらない)では Web を止めない / 古い世代は止めない /
//   止めている間に作られた・resume された ctx を止め直す / silent になったら resume と type を戻してからマスターを戻す / マイクの解析の ctx があればそれも止める。
// 【守っていないもの】WebKit の GPU プロセスの音のセッションが本当に非活性になり、音量の段が通話から外れるか(実機待ち)。
// ------------------------------------------------------------------
describe("【便CW】nativeSolo(Web の AudioContext を止め、audioSession.type を auto に)", () => {
  let calls; let metro; let api; let micCtx; let handler; let gateIn;
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const makeCtx = (name, state = "running") => {
    const master = { gain: { value: 1 } };
    const c = {
      name, state, sampleRate: 48000, __metroMasterGain: master, __metroMasterBase: 1, resumeTo: "running",
      suspend() { calls.push([`${name}.suspend`]); if (this.state !== "closed") this.state = "suspended"; return Promise.resolve(); },
      resume() { calls.push([`${name}.resume`]); if (this.state !== "closed") this.state = this.resumeTo; return Promise.resolve(); },
    };
    return c;
  };
  const setup = () => {
    calls = [];
    gateIn = null;
    const ok = (name) => async (arg) => { calls.push(arg === undefined ? [name] : [name, arg]); return {}; };
    api = { load: ok("load"), start: ok("start"), stop: ok("stop"), inStart: async () => { calls.push(["inStart"]); if (gateIn) await gateIn; return {}; }, inStop: ok("inStop"), info: ok("info") };
    handler = () => {};
    metro = { on: true, stopped: 0, ctx: makeCtx("metro") };
    metro.ctx.onstatechange = handler;
    micCtx = null;
    AUDIO_DIAG.getMetro = () => ({ ctx: metro.ctx, on: metro.on, stop: () => { metro.stopped++; metro.on = false; }, clickPattern: () => ({ stepSec: 0.5, kinds: ["accent", "beat"] }) });
    AUDIO_DIAG.renderClicks = async (sr) => ({ sampleRate: sr, accent: new Float32Array([0.5]), beat: new Float32Array([0.25]), sub: new Float32Array([0.125]) });
    AUDIO_DIAG.webMic = { recording: () => false, ctx: () => micCtx, stop: () => calls.push(["webMic.stop"]), restore: async () => { calls.push(["webMic.restore"]); return true; } };
    AUDIO_DIAG.applyAudioSessionType = () => { calls.push(["applyType"]); navigator.audioSession.type = "play-and-record"; };
    Object.defineProperty(navigator, "audioSession", { value: { type: "play-and-record" }, configurable: true });
    AUDIO_DIAG.native = { clickKey: null, loadedRate: null, bufPeaks: null, info: undefined, error: "", silent: "", gen: 0, watchAt: 0, watchSched: null, renderTimeoutMs: 5000, held: [], soloHeld: false, releasing: null, chain: Promise.resolve() };
    AUDIO_DIAG.metroGainX = 1.3;
  };
  afterEach(() => {
    AUDIO_DIAG.playback = "web"; AUDIO_DIAG.metroGainX = 1;
    AUDIO_DIAG.getMetro = null; AUDIO_DIAG.renderClicks = null; AUDIO_DIAG.webMic = null; AUDIO_DIAG.applyAudioSessionType = null;
    try { delete navigator.audioSession; } catch { /* */ }
  });
  const names = () => calls.map((c) => c[0]);

  it("選ぶと: 殻の取り込み → Web のマイクを止める → ctx を suspend(殻の resume の手当ては外す)・type は auto。そのあと殻のクリック・Web のマスター 0", async () => {
    setup();
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    expect(names().slice(0, 3)).toEqual(["inStart", "webMic.stop", "metro.suspend"]);
    expect(names()).toContain("start");
    expect(metro.ctx.state).toBe("suspended");
    expect(metro.ctx.onstatechange).toBe(null);
    expect(navigator.audioSession.type).toBe("auto");
    expect(metro.ctx.__metroMasterGain.gain.value).toBe(0);
  });
  it("戻すと: resume と type の戻しがその場で(殻のクリックの停止より前)→ 殻の停止 → 取り込みの停止 → マイクの戻し → マスターが基の値 × 倍率・手当ても付け直す", async () => {
    setup();
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    calls.length = 0;
    const back = audioDiagSetPlayback("web", api);
    expect(names()).toEqual(["metro.resume", "applyType"]);         // ボタンを押したその場(タップの中)
    expect(metro.ctx.__metroMasterGain.gain.value).toBe(0);          // 殻を止め終わるまで Web は鳴らさない
    await back; await flush();
    expect(names()).toEqual(["metro.resume", "applyType", "stop", "inStop", "webMic.restore"]);
    expect(metro.ctx.state).toBe("running");
    expect(metro.ctx.onstatechange).toBe(handler);
    expect(navigator.audioSession.type).toBe("play-and-record");
    expect(metro.ctx.__metroMasterGain.gain.value).toBeCloseTo(1.3, 12);
    expect(metro.stopped).toBe(0);
  });
  it("resume で running に戻らない ctx は、メトロノームを止める(次の START が既存の道で作り直す)・板に js= で出る", async () => {
    setup();
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    metro.ctx.resumeTo = "suspended";                                // iOS がタップの外で resume を断った形
    await audioDiagSetPlayback("web", api);
    await flush();
    expect(metro.stopped).toBe(1);
    expect(AUDIO_DIAG.native.error).toMatch(/^webCtx: resume → suspended/);
  });
  it("失敗の道: 殻の取り込みが始まらなければ、Web のマイクも ctx も止めず・type も変えず、web に戻る", async () => {
    setup();
    api.inStart = async () => { calls.push(["inStart"]); return { error: "not playAndRecord" }; };
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    expect(names()).toEqual(["inStart"]);
    expect(AUDIO_DIAG.playback).toBe("web");
    expect(metro.ctx.state).toBe("running");
    expect(navigator.audioSession.type).toBe("play-and-record");
    expect(metro.ctx.__metroMasterGain.gain.value).toBeCloseTo(1.3, 12);
  });
  it("押し直し(nativeSolo → nativeSolo)で殻の取り込みが失敗したら、止めていた ctx と type を戻し、Web のマイクも戻して nativeClick に", async () => {
    setup();
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    calls.length = 0;
    api.inStart = async () => { calls.push(["inStart"]); return { error: "x" }; };
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    expect(AUDIO_DIAG.playback).toBe("nativeClick");
    expect(names().slice(0, 4)).toEqual(["inStart", "metro.resume", "applyType", "webMic.restore"]);
    expect(metro.ctx.state).toBe("running");
    expect(navigator.audioSession.type).toBe("play-and-record");
  });
  it("古い世代は止めない: 殻の取り込みを待っている間に web へ戻したら、その後に取り込みが返っても ctx も type も止めない", async () => {
    setup();
    let release;
    gateIn = new Promise((r) => { release = r; });
    audioDiagSetPlayback("nativeSolo", api);
    await flush();
    const back = audioDiagSetPlayback("web", api);
    release();
    await back; await flush();
    expect(names()).not.toContain("metro.suspend");
    expect(names()).not.toContain("webMic.stop");
    expect(metro.ctx.state).toBe("running");
    expect(navigator.audioSession.type).toBe("play-and-record");
    expect(AUDIO_DIAG.playback).toBe("web");
  });
  it("古い世代は止めない(選び直し): nativeSolo → web → nativeSolo で、古い取り込みが後から成功しても、新しい取り込みが返るまで Web を止めない", async () => {
    setup();
    const gates = [];
    api.inStart = () => { calls.push(["inStart"]); return new Promise((r) => { gates.push(() => r({})); }); };
    audioDiagSetPlayback("nativeSolo", api);
    await flush();                                                   // 1回目の取り込みが待っている
    audioDiagSetPlayback("web", api);
    const again = audioDiagSetPlayback("nativeSolo", api);
    gates[0]();                                                      // 古い取り込みが成功で返る
    await flush();                                                   // 新しい取り込み(2回目)が待っている
    expect(gates.length).toBe(2);
    audioDiagSyncNativeClick(api);                                   // 板の 20ms ごとの合わせ
    expect(names()).not.toContain("metro.suspend");                  // 新しい取り込みが返る前に Web を止めない
    expect(metro.ctx.state).toBe("running");
    gates[1]();                                                      // 新しい取り込みが返る
    await again; await flush();
    expect(metro.ctx.state).toBe("suspended");
    expect(navigator.audioSession.type).toBe("auto");
  });
  it("止めている間に START で作られた ctx・resume された ctx・戻された type は、板の 20ms ごとの合わせで止め直す", async () => {
    setup();
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    const fresh = makeCtx("fresh");                                  // START が作った新しい ctx(running)
    fresh.onstatechange = () => {};
    metro.ctx = fresh;
    navigator.audioSession.type = "play-and-record";                // startMetronome の applyAudioSessionType
    audioDiagSyncNativeClick(api);
    expect(fresh.state).toBe("suspended");
    expect(fresh.onstatechange).toBe(null);
    expect(navigator.audioSession.type).toBe("auto");
    fresh.state = "running";                                         // 誰かが resume した
    audioDiagSyncNativeClick(api);
    expect(fresh.state).toBe("suspended");
  });
  it("マイクの解析の ctx があれば、それも止め・戻す", async () => {
    setup();
    micCtx = makeCtx("mic");
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    expect(micCtx.state).toBe("suspended");
    await audioDiagSetPlayback("web", api);
    await flush();
    expect(micCtx.state).toBe("running");
  });
  it("nativeSolo で殻の音が出ていない(start の失敗)と見なしたら、ctx を resume し type も戻してからマスターを戻す・その後は止め直さない", async () => {
    setup();
    api.start = async (o) => { calls.push(["start", o]); return { error: "engine not running" }; };
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    expect(AUDIO_DIAG.native.silent).toBe("start");
    expect(AUDIO_DIAG.playback).toBe("nativeSolo");
    expect(metro.ctx.state).toBe("running");
    expect(navigator.audioSession.type).toBe("play-and-record");
    expect(metro.ctx.__metroMasterGain.gain.value).toBeCloseTo(1.3, 12);
    const i = names().indexOf("metro.resume");
    expect(i).toBeGreaterThan(names().indexOf("metro.suspend"));
    audioDiagSyncNativeClick(api);                                   // silent の間は止め直さない
    expect(metro.ctx.state).toBe("running");
  });
  // 【便CW 審査】silent はタップの外で立つ。resume が効かなければメトロノームを止める(ON のまま無音で残さない)
  it("silent(start の失敗)で resume が戻らなければ、メトロノームを止めて js=webCtx に出す", async () => {
    setup();
    metro.ctx.resumeTo = "suspended";
    api.start = async (o) => { calls.push(["start", o]); return { error: "engine not running" }; };
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    expect(AUDIO_DIAG.native.silent).toBe("start");
    expect(metro.stopped).toBe(1);
    expect(AUDIO_DIAG.native.error).toMatch(/^webCtx: resume → suspended/);
  });
  it("silent(noSched)で resume が戻らなければ、メトロノームを止めて js=webCtx に出す(列が詰まっていても)", async () => {
    setup();
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    expect(metro.ctx.state).toBe("suspended");
    metro.ctx.resumeTo = "suspended";
    AUDIO_DIAG.native.chain = new Promise(() => {});                // 列が詰まっている
    const t0 = 1_000_000;
    AUDIO_DIAG.native.watchAt = t0; AUDIO_DIAG.native.watchSched = 3;
    audioDiagCheckNativeSilence({ scheduled: 3 }, t0 + 5000);
    await flush();
    expect(AUDIO_DIAG.native.silent).toBe("noSched");
    expect(metro.stopped).toBe(1);
    expect(AUDIO_DIAG.native.error).toMatch(/^webCtx: resume → suspended/);
  });
  it("silent で resume が戻ったときはメトロノームを止めない", async () => {
    setup();
    api.start = async (o) => { calls.push(["start", o]); return { error: "x" }; };
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    expect(AUDIO_DIAG.native.silent).toBe("start");
    expect(metro.ctx.state).toBe("running");
    expect(metro.stopped).toBe(0);
  });
  it("録音中は nativeSolo も選ばせない", async () => {
    setup();
    AUDIO_DIAG.webMic.recording = () => true;
    await audioDiagSetPlayback("nativeSolo", api);
    await flush();
    expect(calls).toEqual([]);
    expect(AUDIO_DIAG.native.error).toBe("nativeSolo: recording");
  });
});
