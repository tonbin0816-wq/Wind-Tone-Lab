// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { metroNativeClickPattern, renderMetroClickSamples } from "./App.jsx";
import { AUDIO_DIAG } from "./audioDiag.jsx";
import { nativeFloat32ToBase64, nativeBase64ToFloat32 } from "./shell/nativeAudio.js";

// ------------------------------------------------------------------
// 【便CU 2026-10-17】殻の AVAudioEngine でクリックを鳴らす部品(【便CX 2026-10-19】本番の殻のメトロノームが使う。試し口「鳴らし方」は消した)。
// 【守っているもの】
//   ・殻へ渡す1小節の並び(metroNativeClickPattern): 期待値は譜の決まり(4/4 は拍ごと・分割は sub・X/8 は8分のグリッドで3と2のまとまり・
//     テンポは X/4 で四分・X/8 で付点四分)から手で書いた(実装の関数で期待値を作らない)
//   ・殻へ渡すクリックの描き出し(renderMetroClickSamples): 同じ鎖を Web Audio の仕様の式で回す作り物の OfflineAudioContext で描いたピークが、
//     DESIGN-SYSTEM の「今の出口」(Chrome 152 の実測 強拍 0.862・拍 0.564・弱拍 0.317 @48kHz)にそろう / 板の倍率・ミュートが混ざらない /
//     末尾の無音だけを落とす / 古い WebKit の oncomplete でも受け取れる
//   ・base64 の往復(殻へ渡す形・殻から届くマイクの形)
//   (【便CX】殻への呼び出しの順と引数は src/shell/nativeAudio.test.js と src/shell/shellApp.test.jsx が見る)
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
  afterEach(() => { AUDIO_DIAG.metroGainX = 1; });
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
  it("板の倍率(×1.6)は描き出しに混ざらない(新しい ctx には何も置かない)・マスターは殻の値 1.0", async () => {
    AUDIO_DIAG.metroGainX = 1.6;
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
    const bin = atob(nativeFloat32ToBase64(f));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    expect(bytes.length).toBe(80000);
    expect(Array.from(new Float32Array(bytes.buffer))).toEqual(Array.from(f));
    // 【便CX】殻から届くマイクの塊(Swift の Data.base64EncodedString)を戻す口も同じ値
    expect(Array.from(nativeBase64ToFloat32(nativeFloat32ToBase64(f)))).toEqual(Array.from(f));
  });
});
