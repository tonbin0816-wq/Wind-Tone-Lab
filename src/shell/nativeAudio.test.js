// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  createFrameAnalyzer, applyBandpassRBJ, isNearScheduledClick, metroBeatInfo, metroClickClockMs,
  metroNativeClickPattern, BANDPASS_Q, SAX_PRESETS,
} from "../App.jsx";
import {
  NativeMicContext, createHostClock, createNativeMetronome, nativeFloat32ToBase64, nativeBandpassCoefficients,
  NATIVE_MIC_STALE_MS, NATIVE_CLOCK_SYNC_MS, NATIVE_AUDIO,
  nativeRebuildDecision, nativeRebuildDelay, nativeGridSkip, NATIVE_REBUILD_MAX_FAILURES, nativeEvents,
} from "./nativeAudio.js";

// ------------------------------------------------------------------
// 【便CX 2026-10-19】殻の計測の音(マイクとメトロノーム)を殻の AVAudioEngine で扱う JS 側(src/shell/nativeAudio.js)。
// 【守っているもの】
//   ・殻の PCM から解析が今と同じ値を出す: 同じ波形を「Web の口」(アップロード解析の作り物 = analyzeAudioBuffer と同じ mono と applyBandpassRBJ)と
//     「殻の口」(NativeMicContext に startListening と同じ配線 source → analyser・source → bandpass → gateAnalyser を組み、殻の塊の形〈base64・
//     不揃いの大きさ〉で流す)に通し、窓ごとの時間波形・ゲート波形が1標本残らず同じ・createFrameAnalyzer(ピッチ MPM・音色・ゲート)のフレームが同じ。
//     途中で中心周波数を替えても(楽器の切り替え)、Web Audio の BiquadFilterNode と同じく状態を持ったまま係数だけ替わる(仕様の式で書いた参照と同じ)
//   ・塊が途切れた(NATIVE_MIC_STALE_MS)・トラックを止めた / 無効にした間は 0 を返す(既存の無音の見張り → 復旧の入口に乗る)
//   ・時計: 往復の真ん中で合わせ、往復が最も短い標本を使う(ずれ ≦ 往復の半分。往復 20ms なら 10ms 以内)・使う人がいる間だけ合わせ直す
//   ・除外: 「今」は殻の入力の最新の標本の host time(Web は performance.now() のまま)。クリックの host time と同じ時計で判定する(窓は同じ)
//   ・拍の表示: 殻の知らせの i から拍頭と拍の長さを出す metroBeatInfo が、譜の決まり(手で書いた期待値)と合う
//   ・メトロノームの呼び出しの順と引数(描き出し → load → start・次の拍からの update・小節の頭からの restart・stop・古い run の知らせを捨てる・失敗)
//   ・マイクの開始・止める・置き換え・殻が諦めた(failed)ときの道
// 【守っていないもの】Swift(殻の AVAudioEngine・タップ・予約)が本当にそう動くか・ブリッジの実際の往復の長さ・実機の音量(どれも実機待ち。綴りは pitch-test K.14)。
// 期待値は Web 側の既存の口(applyBandpassRBJ・analyzeAudioBuffer の作り物)と譜の決まりから取り、殻の側の実装から逆算していない。
// ------------------------------------------------------------------

const RATE = 48000;
const FFT = 8192;

// アルトの A4 くらい(実音 440Hz)の倍音の多い音 + 空調のうなり(60Hz)+ 小さな雑音 + 途中の無音 + クリック
function makeWave(n, rate) {
  const out = new Float32Array(n);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296 - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const on = t > 0.15 && t < 0.9; // 0.15〜0.9 秒だけ鳴る
    let v = 0.004 * Math.sin(2 * Math.PI * 60 * t) + 0.0005 * rnd();
    if (on) for (let h = 1; h <= 6; h++) v += (0.18 / h) * Math.sin(2 * Math.PI * 440 * h * t + h);
    if (i % Math.round(rate * 0.5) < 40) v += 0.3 * rnd(); // 0.5 秒ごとの短いクリック
    out[i] = v;
  }
  return out;
}

// 作り物の殻(呼び出しを控え、知らせを手で送る)
function fakeApi(over = {}) {
  const calls = [];
  const listeners = {};
  const api = {
    calls,
    emit(ev, d) { for (const fn of listeners[ev] || []) fn(d); },
    on: async (ev, fn) => { (listeners[ev] ||= []).push(fn); return () => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); }; },
    micStart: async (o) => { calls.push(["micStart", o]); return { sampleRate: RATE }; },
    micStop: async (o) => { calls.push(["micStop", o]); return { stopped: true }; },
    metroLoad: async (o) => { calls.push(["metroLoad", { sampleRate: o.sampleRate, n: [o.accent.length, o.beat.length, o.sub.length] }]); return {}; },
    metroStart: async (o) => { calls.push(["metroStart", o]); return { running: true }; },
    metroUpdate: async (o) => { calls.push(["metroUpdate", o]); return { running: true }; },
    metroStop: async (o) => { calls.push(["metroStop", o]); return { stopped: true }; },
    clock: async () => ({ host: 100, sampleRate: RATE }),
    info: async () => ({}),
    listeners,
    ...over,
  };
  return api;
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); for (let i = 0; i < 30; i++) await Promise.resolve(); };

// startListening と同じ配線(fftSize・バンドパスの型・中心周波数・Q)
function wireLikeStartListening(ctx, saxType) {
  const source = ctx.createMediaStreamSource({});
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = SAX_PRESETS[saxType].gateBandpassHz;
  bandpass.Q.value = BANDPASS_Q;
  const gateAnalyser = ctx.createAnalyser();
  gateAnalyser.fftSize = FFT;
  gateAnalyser.smoothingTimeConstant = 0.2;
  source.connect(bandpass);
  bandpass.connect(gateAnalyser);
  return { analyser, gateAnalyser, bandpass };
}

async function startMic(api, nowRef) {
  const ctx = new NativeMicContext({ api, now: () => nowRef.t });
  const stream = await ctx.start();
  return { ctx, stream };
}

describe("【便CX】殻の PCM から解析が今と同じ値を出す(同じ波形を Web の口と殻の口に通して比べる)", () => {
  for (const [saxType, RATE] of [["alto", 48000], ["soprano", 48000], ["tenor", 44100], ["baritone", 48000]]) {
    it(`${saxType}・${RATE}Hz: 窓ごとの時間波形・ゲート波形が1標本残らず同じ・createFrameAnalyzer のフレーム(ピッチ・音色・ゲート)が同じ`, async () => {
      const n = Math.round(RATE * 1.2);
      const mono = makeWave(n, RATE);
      // Web の口(analyzeAudioBuffer と同じ作り物)
      const gateMono = applyBandpassRBJ(mono, RATE, SAX_PRESETS[saxType].gateBandpassHz, BANDPASS_Q);
      const cur = { pos: 0 };
      const webLike = {
        getFloatTimeDomainData: (out) => out.set(mono.subarray(cur.pos, cur.pos + FFT)),
        getGateTimeDomainData: (out) => out.set(gateMono.subarray(cur.pos, cur.pos + FFT)),
      };
      // 殻の口(殻の答えの標本化周波数 = この試験の値)
      const api = fakeApi({ micStart: async (o) => { api.calls.push(["micStart", o]); return { sampleRate: RATE }; } });
      const nowRef = { t: 1000 };
      const { ctx } = await startMic(api, nowRef);
      expect(api.calls[0]).toEqual(["micStart", { id: ctx._id }]);
      expect(ctx.sampleRate).toBe(RATE);
      const { analyser, gateAnalyser } = wireLikeStartListening(ctx, saxType);
      const shellLike = {
        getFloatTimeDomainData: (out) => analyser.getFloatTimeDomainData(out),
        getGateTimeDomainData: (out) => gateAnalyser.getFloatTimeDomainData(out),
      };
      const opts = { saxType, tuningHz: 442, instrumentOffsetCents: 0, temperature: 22, selectedIdeal: null, noiseGateDb: -50 };
      const faWeb = createFrameAnalyzer(opts);
      const faShell = createFrameAnalyzer(opts);
      // 不揃いの塊(殻のタップが 1024 / 937 / 4800 などで渡す形)で流し、窓が埋まるたびに両方を同じ位置で読む
      const sizes = [1024, 937, 4800, 333, 2048, 1500];
      let fed = 0, k = 0, compared = 0;
      const a = new Float32Array(FFT), b = new Float32Array(FFT), ga = new Float32Array(FFT), gb = new Float32Array(FFT);
      while (fed < n) {
        const len = Math.min(sizes[k++ % sizes.length], n - fed);
        const chunk = mono.slice(fed, fed + len);
        nowRef.t += 5;
        api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(chunk), sample: fed, host: 50 + fed / RATE, rate: RATE, frames: len });
        fed += len;
        if (fed < FFT) continue;
        cur.pos = fed - FFT;
        webLike.getFloatTimeDomainData(a); shellLike.getFloatTimeDomainData(b);
        webLike.getGateTimeDomainData(ga); shellLike.getGateTimeDomainData(gb);
        expect(Buffer.from(b.buffer).equals(Buffer.from(a.buffer))).toBe(true);
        expect(Buffer.from(gb.buffer).equals(Buffer.from(ga.buffer))).toBe(true);
        const ms = (fed / RATE) * 1000;
        faWeb.tick(webLike, RATE, ms);
        faShell.tick(shellLike, ctx.sampleRate, ms); // 殻の口の sampleRate(殻の答え)で解析する
        compared += 1;
      }
      expect(compared).toBeGreaterThan(20);
      expect(faShell.frames.length).toBeGreaterThan(3);
      expect(faShell.frames.some((f) => f.pitchHz !== null)).toBe(true); // 鳴っている区間でピッチが出る(空の比べっこにしない)
      expect(JSON.stringify(faShell.frames)).toBe(JSON.stringify(faWeb.frames));
      expect(JSON.stringify(faShell.noteEvents)).toBe(JSON.stringify(faWeb.noteEvents));
    });
  }

  it("中心周波数を途中で替えても(楽器の切り替え)、状態を持ったまま係数だけ替わる(Web Audio の BiquadFilterNode の式で書いた参照と同じ)", async () => {
    const n = 20000;
    const mono = makeWave(n, RATE);
    const switchAt = 7001;
    // 参照: Web Audio の仕様の双二次(bandpass: b0 = α, b1 = 0, b2 = -α, a0 = 1+α, a1 = -2cos w0, a2 = 1-α を a0 で割る)。状態は替えない
    const ref = new Float32Array(n);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const f = i < switchAt ? 500 : 650;
      const w0 = (2 * Math.PI * f) / RATE;
      const al = Math.sin(w0) / (2 * BANDPASS_Q);
      const a0 = 1 + al;
      const y = (al / a0) * mono[i] + (-al / a0) * x2 - ((-2 * Math.cos(w0)) / a0) * y1 - ((1 - al) / a0) * y2;
      ref[i] = y; x2 = x1; x1 = mono[i]; y2 = y1; y1 = y;
    }
    const api = fakeApi();
    const nowRef = { t: 0 };
    const { ctx } = await startMic(api, nowRef);
    const source = ctx.createMediaStreamSource({});
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 500; bp.Q.value = BANDPASS_Q;
    const ga = ctx.createAnalyser(); ga.fftSize = 16384;
    source.connect(bp); bp.connect(ga);
    api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(mono.slice(0, switchAt)), sample: 0, host: 1, rate: RATE, frames: switchAt });
    bp.frequency.value = 650;
    api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(mono.slice(switchAt)), sample: switchAt, host: 2, rate: RATE, frames: n - switchAt });
    const out = new Float32Array(16384);
    ga.getFloatTimeDomainData(out);
    let maxDiff = 0;
    for (let i = 0; i < out.length; i++) maxDiff = Math.max(maxDiff, Math.abs(out[i] - ref[n - out.length + i]));
    expect(maxDiff).toBeLessThan(1e-7);
    // 係数は App.jsx の applyBandpassRBJ と同じ式・同じ順(同じ double)
    const c = nativeBandpassCoefficients(RATE, 500, BANDPASS_Q);
    const one = new Float32Array([1, 0, 0]);
    const r = applyBandpassRBJ(one, RATE, 500, BANDPASS_Q);
    expect(r[0]).toBe(Math.fround(c.b0));
  });

  it("塊が途切れた・トラックを止めた / 無効にした間は 0(Web の死んだ・止めたマイクと同じ形 = 既存の無音の見張りに乗る)", async () => {
    const api = fakeApi();
    const nowRef = { t: 0 };
    const { ctx, stream } = await startMic(api, nowRef);
    const an = ctx.createAnalyser(); an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const chunk = new Float32Array(2048).fill(0.25);
    api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(chunk), sample: 0, host: 1, rate: RATE, frames: 2048 });
    const out = new Float32Array(1024);
    an.getFloatTimeDomainData(out);
    expect(out.every((v) => v === 0.25)).toBe(true);
    // 決まりは 1000ms(DESIGN-SYSTEM §3.5【便CX】の値。タップに戻ったときの最長 400ms の塊が1つ遅れても誤って 0 にしない。定数から逆算しない):
    // タップの最長の塊の2倍(800ms)はまだ使い、999ms 後もまだ使い、1001ms 後は 0
    nowRef.t += 800;
    an.getFloatTimeDomainData(out);
    expect(out[0]).toBe(0.25);
    nowRef.t += 199;
    an.getFloatTimeDomainData(out);
    expect(out[0]).toBe(0.25);
    expect(NATIVE_MIC_STALE_MS).toBe(1000);
    nowRef.t += 2;
    an.getFloatTimeDomainData(out);
    expect(out.every((v) => v === 0)).toBe(true);
    nowRef.t += 1;
    api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(chunk), sample: 2048, host: 2, rate: RATE, frames: 2048 });
    an.getFloatTimeDomainData(out);
    expect(out[0]).toBe(0.25);
    stream.getTracks()[0].enabled = false;
    an.getFloatTimeDomainData(out);
    expect(out.every((v) => v === 0)).toBe(true);
    stream.getTracks()[0].enabled = true;
    // 別の id(止めた前の取得)の塊は使わない
    api.emit("micData", { id: "other", pcm: nativeFloat32ToBase64(new Float32Array(2048).fill(0.9)), sample: 0, host: 3, rate: RATE, frames: 2048 });
    an.getFloatTimeDomainData(out);
    expect(out[0]).toBe(0.25);
    stream.getTracks()[0].stop();
    an.getFloatTimeDomainData(out);
    expect(out.every((v) => v === 0)).toBe(true);
    await settle();
    expect(api.calls.filter(([n]) => n === "micStop")).toEqual([["micStop", { id: ctx._id }]]);
    // トラックを止めたら JS の中の受け手を外す(殻への登録は付けっぱなし = 流している間に書き換えない)
    expect(nativeEvents(api).subs.micData.size).toBe(0);
    expect((api.listeners.micData || []).length).toBe(1);
  });

  it("足りない頭は 0・配列が fftSize より長ければ fftSize ぶんだけ写す(AnalyserNode と同じ)", async () => {
    const api = fakeApi();
    const nowRef = { t: 0 };
    const { ctx } = await startMic(api, nowRef);
    const an = ctx.createAnalyser(); an.fftSize = 2048;
    ctx.createMediaStreamSource({}).connect(an);
    api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(new Float32Array([0.1, 0.2, 0.3])), sample: 0, host: 1, rate: RATE, frames: 3 });
    const out = new Float32Array(4096).fill(7);
    an.getFloatTimeDomainData(out);
    expect(Array.from(out.subarray(2045, 2049))).toEqual([Math.fround(0.1), Math.fround(0.2), Math.fround(0.3), 7]);
    expect(out.subarray(0, 2045).every((v) => v === 0)).toBe(true);
  });
});

describe("【便CX】殻のマイクの開始・置き換え・権限の拒否・殻が諦めたとき", () => {
  it("知らせを受け始めてから micStart を呼ぶ(答えより先に届く塊を落とさない)・答えの標本化周波数を使う", async () => {
    const order = [];
    const api = fakeApi({
      on: async (ev, fn) => { order.push(`on:${ev}`); return () => {}; },
      micStart: async (o) => { order.push("micStart"); return { sampleRate: 44100 }; },
    });
    const ctx = new NativeMicContext({ api });
    expect(ctx.state).toBe("suspended");
    const stream = await ctx.start();
    expect(order).toEqual(["on:micData", "on:metroClicks", "on:audioState", "micStart"]); // 3つの知らせをまとめて最初の1回だけ登録してから
    expect(ctx.state).toBe("running");
    expect(ctx.sampleRate).toBe(44100);
    const t = stream.getAudioTracks()[0];
    expect([t.readyState, t.muted, t.enabled]).toEqual(["live", false, true]);
    expect(t.getSettings()).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  });
  it("権限の拒否(殻が reject)は投げる(呼び手の失敗の枝 = 今の拒否の案内)・知らせは外す", async () => {
    const api = fakeApi({ micStart: async () => { throw Object.assign(new Error("denied"), { code: "DENIED" }); } });
    const ctx = new NativeMicContext({ api });
    await expect(ctx.start()).rejects.toThrow("denied");
    expect(nativeEvents(api).subs.micData.size).toBe(0);
  });
  it("待っている間に止められた(stopListening が close)ら、殻のマイクを止めてから置き換えとして投げる", async () => {
    let release;
    const api = fakeApi({ micStart: (o) => { api.calls.push(["micStart", o]); return new Promise((r) => { release = () => r({ sampleRate: RATE }); }); } });
    const ctx = new NativeMicContext({ api });
    const p = ctx.start();
    await settle();
    ctx.close();
    release();
    await expect(p).rejects.toThrow("superseded");
    await settle();
    expect(api.calls.filter(([n]) => n === "micStop").length).toBeGreaterThanOrEqual(1);
    expect(api.calls.filter(([n]) => n === "micStop").every(([, o]) => o.id === ctx._id)).toBe(true);
  });
  it("殻が作り直しを諦めた(audioState failed・このマイク)ら、トラックを終わらせて onended(既存の復旧の入口)を呼ぶ。別のマイクの知らせでは何もしない", async () => {
    const api = fakeApi();
    const { ctx, stream } = await startMic(api, { t: 0 });
    const t = stream.getTracks()[0];
    let ended = 0;
    t.onended = () => { ended += 1; };
    api.emit("audioState", { state: "failed", reason: "loop", mic: true, id: "other" });
    expect([t.readyState, ended]).toEqual(["live", 0]);
    api.emit("audioState", { state: "interrupted", reason: "began", mic: true, id: ctx._id });
    expect([t.readyState, ended]).toEqual(["live", 0]);
    api.emit("audioState", { state: "failed", reason: "loop", mic: true, id: ctx._id });
    expect([t.readyState, ended]).toEqual(["ended", 1]);
  });
});

describe("【便CX】時計(殻の host time ⇔ performance.now())", () => {
  it("往復の真ん中で合わせ、往復が最も短い標本を使う: ずれは往復の半分以下(往復 20ms → 10ms 以内)", async () => {
    let perf = 5000;
    const TRUE_OFFSET_MS = 5000 - 123456.789 * 1000; // perf = host*1000 + offset
    // 往復の長さと、殻が時刻を読む位置(行きの遅れ)を標本ごとに変える(片道が不揃い = 最悪で往復の半分ずれる)
    // 使われるのは途中の往復 18ms(殻が行き 1ms で時刻を読んだ = 真ん中と 8ms ずれる。帰りの時刻で合わせると 17ms ずれる)。
    // 最後に長い往復(60ms・行き 50ms)を置く ── 最新の標本を使うと 20ms ずれる
    const trips = [[40, 35], [18, 1], [30, 2], [60, 50]];
    let k = 0;
    const api = {
      clock: async () => {
        const [rtt, go] = trips[k++];
        const hostAt = (perf + go - TRUE_OFFSET_MS) / 1000;
        perf += rtt;
        return { host: hostAt, sampleRate: 48000 };
      },
    };
    const c = createHostClock({ api, now: () => perf, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    for (let i = 0; i < trips.length; i++) await c.sync();
    expect(c.state.rttMs).toBe(18);
    const err = Math.abs(c.state.offsetMs - TRUE_OFFSET_MS);
    expect(err).toBeLessThanOrEqual(c.errorBoundMs + 1e-9);
    expect(c.errorBoundMs).toBeLessThanOrEqual(10);
    // host ⇔ perf の換算
    const h = 123460;
    expect(Math.abs(c.toPerfMs(h) - (h * 1000 + TRUE_OFFSET_MS))).toBeLessThanOrEqual(10);
    expect(Math.abs(c.nowHostSec() - (perf - TRUE_OFFSET_MS) / 1000) * 1000).toBeLessThanOrEqual(10);
    expect(c.state.sampleRate).toBe(48000);
  });
  it("使う人がいる間だけ、NATIVE_CLOCK_SYNC_MS ごとに合わせ直す(始めにも1回)", async () => {
    const timers = [];
    let syncs = 0;
    const api = { clock: async () => { syncs += 1; return { host: 1, sampleRate: 48000 }; } };
    const c = createHostClock({ api, now: () => 0, setIntervalFn: (f, ms) => { timers.push({ f, ms, on: true }); return timers.length; }, clearIntervalFn: (id) => { timers[id - 1].on = false; } });
    const r1 = c.acquire();
    const r2 = c.acquire();
    await settle();
    expect(syncs).toBe(1);
    expect(timers.map((t) => t.ms)).toEqual([NATIVE_CLOCK_SYNC_MS]);
    timers[0].f(); await settle();
    expect(syncs).toBe(2);
    r1(); r1();
    expect(timers[0].on).toBe(true);
    r2();
    expect(timers[0].on).toBe(false);
  });
});

describe("【便CX】除外は殻の入力の時刻とクリックの時刻(同じ殻の時計)で判定する", () => {
  it("殻の口の「今」= いちばん新しい入力の標本の host time。クリックの host time が窓(前 30ms・後 90ms)に入れば除く", async () => {
    const api = fakeApi();
    const { ctx } = await startMic(api, { t: 0 });
    // 塊: host 200.000 秒から 1024 標本(48kHz)→ 最新の標本は 200.021333 秒
    api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(new Float32Array(1024)), sample: 9600000, host: 200, rate: RATE, frames: 1024 });
    const nowMs = metroClickClockMs(ctx);
    expect(nowMs).toBeCloseTo(200000 + (1024 / RATE) * 1000, 6);
    expect(isNearScheduledClick([199950], nowMs)).toBe(true);   // 71ms 前のクリック(減衰がまだ入る)
    expect(isNearScheduledClick([199920], nowMs)).toBe(false);  // 101ms 前
    expect(isNearScheduledClick([200040], nowMs)).toBe(true);   // 19ms 先(先読み)
    expect(isNearScheduledClick([200060], nowMs)).toBe(false);  // 39ms 先
  });
  it("Web(AudioContext に clickClockMs が無い)は今までどおり performance.now()", () => {
    const before = performance.now();
    const v = metroClickClockMs({ state: "running", sampleRate: 48000 });
    expect(v).toBeGreaterThanOrEqual(before);
    expect(v).toBeLessThanOrEqual(performance.now());
  });
});

describe("【便CX】拍の表示: 殻のクリックの位置から拍頭と拍の長さを出す(metroBeatInfo)", () => {
  // 期待値は譜の決まりから手で書いた: X/4 は分割の頭が拍・1拍 = 60/♩。X/8 はまとまりの頭が拍・1拍 = 8分 × まとまり(8分 = 60/♩./3)
  it("4/4・分割2・♩=120: 偶数の位置が拍頭・1拍 0.5 秒", () => {
    expect([0, 1, 2, 3, 7].map((i) => metroBeatInfo(i, 120, "4/4", 2, null).isBeatAnchor)).toEqual([true, false, true, false, false]);
    expect(metroBeatInfo(2, 120, "4/4", 2, null).beatDur).toBeCloseTo(0.5, 12);
  });
  it("6/8・♩.=60: 0 と 3 が拍頭・1拍 1 秒(8分 1/3 秒 × 3)", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => metroBeatInfo(i, 60, "6/8", 2, null).isBeatAnchor)).toEqual([true, false, false, true, false, false]);
    expect(metroBeatInfo(3, 60, "6/8", 2, null).beatDur).toBeCloseTo(1, 12);
  });
  it("7/8 を 2+2+3: 0・2・4 が拍頭・長さは 2/2/3 の8分(♩.=90 → 8分 2/9 秒)", () => {
    const g = [2, 2, 3];
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => metroBeatInfo(i, 90, "7/8", 1, g).isBeatAnchor)).toEqual([true, false, true, false, true, false, false]);
    expect(metroBeatInfo(4, 90, "7/8", 1, g).beatDur).toBeCloseTo(3 * (60 / 90 / 3), 12);
    expect(metroBeatInfo(2, 90, "7/8", 1, g).beatDur).toBeCloseTo(2 * (60 / 90 / 3), 12);
  });
  it("鳴らす音(silent でない)が拍頭を必ず含む(並びと矛盾しない)", () => {
    for (const [tempo, sig, sd, g] of [[120, "4/4", 1, null], [100, "3/4", 3, null], [90, "6/8", 1, null], [90, "5/8", 2, [3, 2]], [72, "12/8", 2, null]]) {
      const p = metroNativeClickPattern(tempo, sig, sd, true, g);
      p.kinds.forEach((k, i) => { if (metroBeatInfo(i, tempo, sig, sd, g).isBeatAnchor) expect(k === "accent" || k === "beat").toBe(true); });
    }
  });
});

describe("【便CX】殻のメトロノームの呼び出しの順と引数", () => {
  const renderClicks = async (sr) => ({ sampleRate: sr, accent: new Float32Array([0.862]), beat: new Float32Array([0.564]), sub: new Float32Array([0.317]) });
  const mk = (over = {}) => {
    const api = fakeApi(over);
    const clock = createHostClock({ api, now: () => 0, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    const got = [];
    const fails = [];
    const m = createNativeMetronome({ api, clock, renderClicks, onClicks: (c) => got.push(...c), onFail: (r) => fails.push(r) });
    return { api, m, got, fails };
  };
  it("start: 殻の標本化周波数で描いて load → start(小節の頭は 0.12 秒後)。update はテンポの変更を同じ run で次の拍から・restart は新しい run で 0.08 秒後・stop は今の run", async () => {
    const { api, m } = mk();
    const p1 = { stepSec: 0.5, kinds: ["accent", "beat", "beat", "beat"] };
    const r1 = m.start(p1, 0.12);
    await m.idle(); await settle();
    expect(api.calls.map(([n]) => n)).toEqual(["metroLoad", "metroStart"]);
    expect(api.calls[0][1]).toEqual({ sampleRate: RATE, n: [8, 8, 8] });
    expect(api.calls[1][1]).toEqual({ run: r1.run, v: r1.v, stepSec: 0.5, kinds: p1.kinds, leadSec: 0.12 });
    const r2 = m.update({ stepSec: 0.4, kinds: p1.kinds }, { restart: false });
    await m.idle(); await settle();
    expect(r2.run).toBe(r1.run);
    expect(api.calls[2]).toEqual(["metroUpdate", { run: r1.run, v: r2.v, stepSec: 0.4, kinds: p1.kinds, restart: false, leadSec: 0.12 }]);
    const r3 = m.update({ stepSec: 0.4, kinds: ["accent", "beat", "beat"] }, { restart: true, leadSec: 0.08 });
    await m.idle(); await settle();
    expect(r3.run).not.toBe(r1.run);
    expect(api.calls[3]).toEqual(["metroUpdate", { run: r3.run, v: r3.v, stepSec: 0.4, kinds: ["accent", "beat", "beat"], restart: true, leadSec: 0.08 }]);
    await m.stop(); await settle();
    expect(api.calls[4]).toEqual(["metroStop", { run: r3.run }]);
    // 2回目の START は描き直さない(同じ標本化周波数なら殻のバッファを使う)
    m.start(p1, 0.12);
    await m.idle(); await settle();
    expect(api.calls.slice(5).map(([n]) => n)).toEqual(["metroStart"]);
  });
  it("今の run の知らせだけを渡す(止めた後・前の run の知らせは捨てる)", async () => {
    const { api, m, got } = mk();
    const r1 = m.start({ stepSec: 0.5, kinds: ["accent"] }, 0.12);
    await m.idle(); await settle();
    api.emit("metroClicks", { run: r1.run, clicks: [{ h: 1, s: 0, k: "accent", i: 0, v: r1.v }] });
    api.emit("metroClicks", { run: r1.run - 1, clicks: [{ h: 9, s: 0, k: "accent", i: 0, v: 0 }] });
    const r2 = m.update({ stepSec: 0.5, kinds: ["accent", "beat"] }, { restart: true });
    api.emit("metroClicks", { run: r1.run, clicks: [{ h: 2, s: 0, k: "beat", i: 1, v: r1.v }] });
    api.emit("metroClicks", { run: r2.run, clicks: [{ h: 3, s: 0, k: "accent", i: 0, v: r2.v }] });
    m.stop();
    api.emit("metroClicks", { run: r2.run, clicks: [{ h: 4, s: 0, k: "beat", i: 1, v: r2.v }] });
    expect(got.map((c) => c.h)).toEqual([1, 3]);
  });
  it("描いている間に止めたら start を送らない・続けて替えたら最後の形だけを送る", async () => {
    let release;
    const { api, m } = mk();
    const slow = createNativeMetronome({ api, clock: createHostClock({ api, now: () => 0, setIntervalFn: () => 1, clearIntervalFn: () => {} }),
      renderClicks: (sr) => new Promise((r) => { release = () => r({ sampleRate: sr, accent: new Float32Array([1]), beat: new Float32Array([1]), sub: new Float32Array([1]) }); }) });
    void m;
    slow.start({ stepSec: 0.5, kinds: ["accent"] }, 0.12);
    await settle();
    slow.stop();
    release();
    await slow.idle(); await settle();
    expect(api.calls.map(([n]) => n)).toEqual(["metroLoad"]);
  });
  it("殻の start が失敗した・殻が作り直しを諦めた(failed・metro)ら onFail(MeasureView は止める)", async () => {
    const a = mk({ metroStart: async () => { throw new Error("engine not running"); } });
    a.m.start({ stepSec: 0.5, kinds: ["accent"] }, 0.12);
    await a.m.idle(); await settle();
    expect(a.fails).toEqual(["start: engine not running"]);
    const b = mk();
    const r = b.m.start({ stepSec: 0.5, kinds: ["accent"] }, 0.12);
    await b.m.idle(); await settle();
    b.api.emit("audioState", { state: "failed", reason: "loop", metro: true, run: r.run });
    expect(b.fails).toEqual(["rebuild: loop"]);
  });
  it("時計の口 ctx.currentTime は殻の host time の秒・close で止めて知らせを外す", async () => {
    const { api, m } = mk();
    m.start({ stepSec: 0.5, kinds: ["accent"] }, 0.12);
    await m.idle(); await settle();
    expect(typeof m.ctx.currentTime).toBe("number");
    m.ctx.close();
    await m.idle(); await settle();
    expect(m.ctx.state).toBe("closed");
    expect(api.calls.at(-1)[0]).toBe("metroStop");
    expect(nativeEvents(api).subs.metroClicks.size).toBe(0);
  });
});

describe("【便CX】殻の口の輪のバッファ・塊の時刻", () => {
  it("長い流れ(輪の長さを何周も越える)でも、直近の窓は元の波形と1標本残らず同じ", async () => {
    const api = fakeApi();
    const nowRef = { t: 0 };
    const { ctx } = await startMic(api, nowRef);
    const an = ctx.createAnalyser(); an.fftSize = FFT;
    ctx.createMediaStreamSource({}).connect(an);
    const n = 16384 * 5 + 777;
    const mono = makeWave(n, RATE);
    let fed = 0;
    const out = new Float32Array(FFT);
    while (fed < n) {
      const len = Math.min(3001, n - fed);
      nowRef.t += 1;
      api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(mono.slice(fed, fed + len)), sample: fed, host: fed / RATE, rate: RATE, frames: len });
      fed += len;
    }
    an.getFloatTimeDomainData(out);
    expect(Buffer.from(out.buffer).equals(Buffer.from(mono.slice(n - FFT).buffer))).toBe(true);
  });
  it("fftSize を輪より大きく置くと輪が伸びる(32768 の窓も写せる)", async () => {
    const api = fakeApi();
    const nowRef = { t: 0 };
    const { ctx } = await startMic(api, nowRef);
    const an = ctx.createAnalyser(); an.fftSize = 32768;
    ctx.createMediaStreamSource({}).connect(an);
    const mono = makeWave(40000, RATE);
    api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(mono), sample: 0, host: 1, rate: RATE, frames: mono.length });
    const out = new Float32Array(32768);
    an.getFloatTimeDomainData(out);
    expect(an.frequencyBinCount).toBe(16384);
    expect(Buffer.from(out.buffer).equals(Buffer.from(mono.slice(40000 - 32768).buffer))).toBe(true);
  });
  it("除外の「今」は塊の host + 標本の数 / 塊の標本化周波数(44.1kHz の塊)", async () => {
    const api = fakeApi({ micStart: async (o) => { api.calls.push(["micStart", o]); return { sampleRate: 44100 }; } });
    const { ctx } = await startMic(api, { t: 0 });
    api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(new Float32Array(441)), sample: 0, host: 10, rate: 44100, frames: 441 });
    expect(ctx.clickClockMs()).toBeCloseTo(10010, 9);
  });
});

describe("【便CX】時計の細かい決まり", () => {
  it("殻が答えない(投げる)・host が数でない答えは使わない(fails を数える・対応は前のまま)", async () => {
    let mode = "ok";
    const api = { clock: async () => { if (mode === "throw") throw new Error("x"); if (mode === "bad") return { host: "?" }; return { host: 2, sampleRate: 48000 }; } };
    const perf = 5000;
    const c = createHostClock({ api, now: () => perf, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    await c.sync();
    const off = c.state.offsetMs;
    mode = "throw"; await c.sync();
    mode = "bad"; await c.sync();
    expect([c.state.fails, c.state.syncs, c.state.offsetMs]).toEqual([2, 1, off]);
  });
  it("合わせる前は performance.now() の秒をそのまま使い(synced = false)、合わせた後は殻の時計になる", async () => {
    let perf = 8000;
    const api = { clock: async () => ({ host: 100, sampleRate: 48000 }) };
    const c = createHostClock({ api, now: () => perf, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    expect([c.synced, c.errorBoundMs, c.nowHostSec()]).toEqual([false, null, 8]);
    await c.sync();
    expect(c.synced).toBe(true);
    expect(c.nowHostSec()).toBeCloseTo(100, 9);
    perf += 500;
    expect(c.nowHostSec()).toBeCloseTo(100.5, 9);
  });
  it("同時に呼んでも往復は1つ(合わせる処理を重ねない)", async () => {
    let calls = 0;
    let release;
    const api = { clock: () => { calls += 1; return new Promise((r) => { release = () => r({ host: 1, sampleRate: 48000 }); }); } };
    const c = createHostClock({ api, now: () => 0, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    const p1 = c.sync(); const p2 = c.sync();
    expect(p1).toBe(p2);
    await settle();
    release(); await p1;
    expect(calls).toBe(1);
  });
});

describe("【便CX】拍の表示: ほかの拍子の拍頭と拍の長さ(譜の決まりから手で書いた期待値)", () => {
  const heads = (tempo, sig, sd, g, n) => Array.from({ length: n }, (_, i) => metroBeatInfo(i, tempo, sig, sd, g).isBeatAnchor);
  it("2/4・分割1・♩=60: 毎回が拍頭・1拍 1 秒", () => {
    expect(heads(60, "2/4", 1, null, 4)).toEqual([true, true, true, true]);
    expect(metroBeatInfo(1, 60, "2/4", 1, null).beatDur).toBeCloseTo(1, 12);
  });
  it("3/8(まとまり 3)・♩.=60: 0 だけが拍頭・1拍 1 秒", () => {
    expect(heads(60, "3/8", 2, null, 3)).toEqual([true, false, false]);
    expect(metroBeatInfo(0, 60, "3/8", 2, null).beatDur).toBeCloseTo(1, 12);
  });
  it("9/8・♩.=90: 0・3・6 が拍頭", () => {
    expect(heads(90, "9/8", 2, null, 9)).toEqual([true, false, false, true, false, false, true, false, false]);
  });
  it("12/8・♩.=72: 0・3・6・9 が拍頭・1拍 60/72 秒", () => {
    expect(heads(72, "12/8", 1, null, 12).map((b, i) => (b ? i : -1)).filter((i) => i >= 0)).toEqual([0, 3, 6, 9]);
    expect(metroBeatInfo(9, 72, "12/8", 1, null).beatDur).toBeCloseTo(60 / 72, 12);
  });
  it("5/8: まとまり 3+2 と 2+3 で拍頭の位置と長さが入れ替わる・合計が合わないまとまりは既定(3+2)", () => {
    expect(heads(60, "5/8", 1, [3, 2], 5)).toEqual([true, false, false, true, false]);
    expect(heads(60, "5/8", 1, [2, 3], 5)).toEqual([true, false, true, false, false]);
    expect(metroBeatInfo(2, 60, "5/8", 1, [2, 3]).beatDur).toBeCloseTo(3 / 3, 12);
    expect(heads(60, "5/8", 1, [2, 2], 5)).toEqual([true, false, false, true, false]);
  });
});

describe("【便CX】殻のメトロノームの呼び出しの細かい決まり", () => {
  const renderClicks = async (sr) => ({ sampleRate: sr, accent: new Float32Array([0.862]), beat: new Float32Array([0.564]), sub: new Float32Array([0.317]) });
  const mk = (over = {}, rc = renderClicks) => {
    const api = fakeApi(over);
    const clock = createHostClock({ api, now: () => 0, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    const fails = [];
    const m = createNativeMetronome({ api, clock, renderClicks: rc, onClicks: () => {}, onFail: (r) => fails.push(r) });
    return { api, m, fails };
  };
  const P = { stepSec: 0.5, kinds: ["accent", "beat"] };
  it("鳴らしていないときの update は何もしない(null・殻を呼ばない)", async () => {
    const { api, m } = mk();
    expect(m.update(P, { restart: true })).toBe(null);
    await m.idle(); await settle();
    expect(api.calls).toEqual([]);
  });
  it("鳴らしている間にもう一度 start → 新しい run で metroStart(頭から。update ではない)", async () => {
    const { api, m } = mk();
    const r1 = m.start(P, 0.12);
    await m.idle(); await settle();
    const r2 = m.start(P, 0.12);
    await m.idle(); await settle();
    const starts = api.calls.filter(([n]) => n === "metroStart");
    expect(starts.map(([, o]) => o.run)).toEqual([r1.run, r2.run]);
    expect(api.calls.some(([n]) => n === "metroUpdate")).toBe(false);
  });
  it("止めてすぐ鳴らし直すと、送るのは metroStart だけ(殻の metroStart が頭から置き直す)", async () => {
    const { api, m } = mk();
    m.start(P, 0.12);
    await m.idle(); await settle();
    const before = api.calls.length;
    m.stop();
    m.start(P, 0.12);
    await m.idle(); await settle();
    expect(api.calls.slice(before).map(([n]) => n)).toEqual(["metroStart"]);
  });
  it("続けて替えたら最後の形だけを送る(テンポを3回替えても metroUpdate は1回・最後の値)", async () => {
    let release;
    const holder = {};
    const { api, m } = mk({ metroStart: (o) => { holder.api.calls.push(["metroStart", o]); return new Promise((r) => { release = () => r({ running: true }); }); } });
    holder.api = api;
    m.start(P, 0.12);
    await settle();
    m.update({ stepSec: 0.49, kinds: P.kinds });
    m.update({ stepSec: 0.48, kinds: P.kinds });
    const last = m.update({ stepSec: 0.47, kinds: P.kinds });
    release();
    await m.idle(); await settle();
    const ups = api.calls.filter(([n]) => n === "metroUpdate");
    expect(ups.map(([, o]) => [o.stepSec, o.v])).toEqual([[0.47, last.v]]);
  });
  it("描き出しの失敗は onFail・次の start で描き直す", async () => {
    let fail = true;
    const { api, m, fails } = mk({}, async (sr) => { if (fail) throw new Error("no OfflineAudioContext"); return renderClicks(sr); });
    m.start(P, 0.12);
    await m.idle(); await settle();
    expect(fails).toEqual(["start: no OfflineAudioContext"]);
    expect(api.calls.some(([n]) => n === "metroStart")).toBe(false);
    fail = false;
    m.start(P, 0.12);
    await m.idle(); await settle();
    expect(api.calls.map(([n]) => n)).toEqual(["metroLoad", "metroStart"]);
  });
});

describe("【便CX 審査】時計: 往復の上限(20ms)を越える標本は使わない", () => {
  const mkClock = (trips, offset = 0) => {
    let perf = 1000;
    let k = 0;
    const api = { clock: async () => { const [rtt, go] = trips[k++]; const host = (perf + go - offset) / 1000; perf += rtt; return { host, sampleRate: 48000 }; } };
    const c = createHostClock({ api, now: () => perf, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    return c;
  };
  it("全部が上限を越えたら最短(25ms)を使い rttWarn を立てる。20ms 以下の標本が来たらそれを使い、警告を下ろす", async () => {
    const c = mkClock([[30, 15], [25, 12], [40, 20], [20, 10]]);
    await c.sync(); await c.sync(); await c.sync();
    expect([c.state.rttMs, c.state.rttWarn]).toEqual([25, true]);
    await c.sync();
    expect([c.state.rttMs, c.state.rttWarn]).toEqual([20, false]);
  });
  it("上限を越える往復が後から来ても、上限以下の標本を使い続ける(警告は出さない)", async () => {
    const c = mkClock([[12, 6], [21, 1], [90, 80]]);
    await c.sync(); await c.sync(); await c.sync();
    expect([c.state.rttMs, c.state.rttWarn]).toEqual([12, false]);
  });
});

describe("【便CX 再審査】入力の標本化周波数が途中で替わってもトラックを終わらせず、新しい周波数で続ける", () => {
  it("違う周波数の塊が来たら: トラックは live のまま(onended を呼ばない・殻のマイクを止めない)・sampleRate を新しい値に・2つの輪とバンドパスの状態を捨て、その塊から解析に入る", async () => {
    const api = fakeApi();
    const nowRef = { t: 0 };
    const { ctx, stream } = await startMic(api, nowRef);
    const { analyser, gateAnalyser } = wireLikeStartListening(ctx, "alto");
    const t = stream.getTracks()[0];
    let ended = 0;
    t.onended = () => { ended += 1; };
    const before = makeWave(9000, 48000);
    api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(before), sample: 0, host: 1, rate: 48000, frames: before.length });
    expect(ctx.sampleRate).toBe(48000);
    // 替わった後の標本は窓(FFT)より短くする: 前の周波数の標本が窓に残る・バンドパスの状態が残ると、下の比較が落ちる
    const AFTER = 6000;
    const after = makeWave(AFTER, 44100).map((v) => v * 0.5);
    nowRef.t += 5;
    api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(after.subarray(0, 2500)), sample: 0, host: 2, rate: 44100, frames: 2500 });
    nowRef.t += 5;
    api.emit("micData", { id: ctx._id, pcm: nativeFloat32ToBase64(after.subarray(2500)), sample: 2500, host: 2.1, rate: 44100, frames: AFTER - 2500 });
    expect([t.readyState, ended, ctx.sampleRate]).toEqual(["live", 0, 44100]);
    // 解析の窓は「0 のあとに替わった後の標本だけ」(前の周波数の標本を混ぜない)・ゲート波形は新しい周波数の係数で状態 0 から回した値と1標本も違わない
    const a = new Float32Array(FFT), g = new Float32Array(FFT);
    analyser.getFloatTimeDomainData(a);
    gateAnalyser.getFloatTimeDomainData(g);
    const wantA = new Float32Array(FFT); wantA.set(after, FFT - AFTER);
    expect(Buffer.from(a.buffer).equals(Buffer.from(wantA.buffer))).toBe(true);
    const ref = applyBandpassRBJ(after, 44100, SAX_PRESETS.alto.gateBandpassHz, BANDPASS_Q);
    const wantG = new Float32Array(FFT); wantG.set(ref, FFT - AFTER);
    expect(Buffer.from(g.buffer).equals(Buffer.from(wantG.buffer))).toBe(true);
    // 前の周波数の標本は 0 ではない(上の比較が「前の標本が残る」を見分けられる)
    expect(before.slice(before.length - (FFT - AFTER)).some((v) => v !== 0)).toBe(true);
    await settle();
    expect(api.calls.filter(([n]) => n === "micStop")).toEqual([]);
  });
});

describe("【便CX 再審査】殻の受け手は1回だけ登録して付けっぱなし(流している間に登録を書き換えない)", () => {
  it("マイクを2回始めて止め、メトロノームを始めて止めても、殻への登録(on)は3つの知らせの1回ずつだけ・外す呼び出しは無い。止めた口は知らせを受けない", async () => {
    let offs = 0;
    const api = fakeApi();
    const origOn = api.on;
    const onCalls = [];
    api.on = async (ev, fn) => { onCalls.push(ev); const off = await origOn(ev, fn); return () => { offs += 1; off(); }; };
    const { ctx: c1, stream: s1 } = await startMic(api, { t: 0 });
    const an1 = c1.createAnalyser(); an1.fftSize = 1024;
    c1.createMediaStreamSource(s1).connect(an1);
    s1.getTracks()[0].stop();
    const { ctx: c2 } = await startMic(api, { t: 0 });
    const clock = createHostClock({ api, now: () => 0, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    const m = createNativeMetronome({ api, clock, renderClicks: async (sr) => ({ sampleRate: sr, accent: new Float32Array([1]), beat: new Float32Array([1]), sub: new Float32Array([1]) }) });
    m.start({ stepSec: 0.5, kinds: ["accent"] }, 0.12);
    await m.idle(); await settle();
    m.ctx.close();
    c2.close();
    await settle();
    expect(onCalls.sort()).toEqual(["audioState", "metroClicks", "micData"]);
    expect(offs).toBe(0);
    expect(nativeEvents(api).subs.micData.size + nativeEvents(api).subs.metroClicks.size + nativeEvents(api).subs.audioState.size).toBe(0);
    // 止めた1つ目の口へ、同じ id の塊が遅れて届いても使わない
    api.emit("micData", { id: c1._id, pcm: nativeFloat32ToBase64(new Float32Array(1024).fill(0.5)), sample: 0, host: 1, rate: RATE, frames: 1024 });
    const out = new Float32Array(1024);
    an1.getFloatTimeDomainData(out);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});

describe("【便CX 審査】作り直しの歯止め(殻の rebuildDecision / rebuildDelay と同じ式の純関数)", () => {
  // 殻の scheduleRebuild を時刻を差し替えて回す: 構成の変化の通知が来るたびに、遅れ(rebuildDelay)の後で判定(rebuildDecision)し、諦めなければ作り直す。
  // fails = 作り直しの成否の並び(既定はずっと成功 = 成功が続く嵐)
  // jitter = asyncAfter が遅れる分(実機では 0 より大きい。0 ちょうどだと 10.2 − 0.2 が浮動小数で 10 を割り、窓の端の判定が実機と食い違う)
  function storm({ notices, fails = () => false, jitter = 0.001 }) {
    let times = []; let lastRebuildAt = -1e9; let failures = 0; let gaveUp = null; let rebuilds = 0;
    let t = 0;
    for (let i = 0; i < notices && gaveUp === null; i++) {
      t += nativeRebuildDelay(t - lastRebuildAt) + jitter;
      const d = nativeRebuildDecision(times, t);
      times = d.keep;
      if (d.giveUp) { gaveUp = { at: t, reason: "loop" }; break; }
      times.push(t);
      lastRebuildAt = t;
      if (fails(i)) { failures += 1; if (failures >= NATIVE_REBUILD_MAX_FAILURES) gaveUp = { at: t, reason: "fail" }; } else { failures = 0; rebuilds += 1; }
    }
    return { gaveUp, rebuilds };
  }
  it("成功が続く嵐(作り直すたびに構成の変化が飛ぶ)でも、10 秒に 5 回に達したら諦める(6 回目の判定で。約 0.2 / 1.2 / 2.2 / 3.2 / 4.2 秒の後の約 5.2 秒)", () => {
    const r = storm({ notices: 100 });
    expect(r.rebuilds).toBe(5);
    expect(r.gaveUp.reason).toBe("loop");
    expect(r.gaveUp.at).toBeCloseTo(0.201 + 5 * 1.001, 9);
  });
  it("前の上限 10 回のままだと、1 秒に 1 回の作り直しは窓に 10 件届かず、いつまでも諦めない(前の不具合の形)", () => {
    let times = []; let t = 0; let last = -1e9; let gaveUp = false;
    for (let i = 0; i < 200; i++) {
      t += nativeRebuildDelay(t - last) + 0.001;
      times = times.filter((x) => t - x < 10);
      if (times.length >= 10) { gaveUp = true; break; }
      times.push(t); last = t;
    }
    expect(gaveUp).toBe(false);
  });
  it("時刻が窓(10 秒)を出た作り直しは数えない・遅れは max(0.2 秒, 1 秒 − 前の作り直しからの経過)", () => {
    expect(nativeRebuildDecision([0, 1, 2, 3], 5).giveUp).toBe(false);
    expect(nativeRebuildDecision([0, 1, 2, 3, 4], 5).giveUp).toBe(true);
    expect(nativeRebuildDecision([0, 1, 2, 3, 4], 10.5)).toEqual({ keep: [1, 2, 3, 4], giveUp: false });
    expect(nativeRebuildDelay(0.3)).toBeCloseTo(0.7, 12);
    expect(nativeRebuildDelay(5)).toBeCloseTo(0.2, 12);
  });
  it("失敗が 5 回続いたら諦める(成功で数え直す)", () => {
    expect(storm({ notices: 100, fails: () => true }).gaveUp.reason).toBe("fail");
    expect(storm({ notices: 4, fails: () => true }).gaveUp).toBe(null);
  });
});

describe("【便CX 審査】作り直しても拍の格子を続ける(殻の gridSkip と同じ式)", () => {
  it("過ぎた拍の数だけ格子の上で進める: 次が 10.0 秒・0.5 秒刻みで今が 11.3 秒なら 3 拍飛ばして 11.5 秒から", () => {
    const k = nativeGridSkip(10.0, 11.3, 0.5);
    expect(k).toBe(3);
    expect(10.0 + k * 0.5).toBeCloseTo(11.5, 12);
    expect(nativeGridSkip(10.0, 9.9, 0.5)).toBe(0);
    expect(nativeGridSkip(10.0, 11.0, 0.5)).toBe(2); // ちょうど格子の上なら今の拍から
  });
  it("殻が予約し直した同じ通し番号(n)の知らせは渡さない・飛ばした拍(skipped)は渡す", async () => {
    const api = fakeApi();
    const clock = createHostClock({ api, now: () => 0, setIntervalFn: () => 1, clearIntervalFn: () => {} });
    const got = [];
    const m = createNativeMetronome({ api, clock, renderClicks: async (sr) => ({ sampleRate: sr, accent: new Float32Array([1]), beat: new Float32Array([1]), sub: new Float32Array([1]) }), onClicks: (c) => got.push(...c) });
    const r = m.start({ stepSec: 0.5, kinds: ["accent", "beat"] }, 0.12);
    await m.idle(); await settle();
    api.emit("metroClicks", { run: r.run, clicks: [{ h: 1, k: "accent", i: 0, v: r.v, n: 0 }, { h: 1.5, k: "beat", i: 1, v: r.v, n: 1 }] });
    // 作り直し: まだ鳴っていなかった n=1 から予約し直し(同じ番号)、間に過ぎた n=2 は skipped、n=3 から鳴らす
    api.emit("metroClicks", { run: r.run, clicks: [{ h: 1.5, k: "beat", i: 1, v: r.v, n: 1 }, { h: 2, k: "skipped", i: 0, v: r.v, n: 2 }, { h: 2.5, k: "beat", i: 1, v: r.v, n: 3 }] });
    expect(got.map((c) => [c.n, c.k])).toEqual([[0, "accent"], [1, "beat"], [2, "skipped"], [3, "beat"]]);
  });
});

// 【便CY 2026-10-20】殻が最後に知らせた状態(audioState)を控える(NATIVE_AUDIO.state。診断の板の nativeState・micRecover の st=)。記録だけ ──
// 受け手へはそのまま渡し、今までの道(failed → 取り直し)は変えない。
describe("【便CY】殻が最後に知らせた状態を控える(NATIVE_AUDIO.state)", () => {
  it("audioState の知らせで 状態・理由・mic・metro・時刻 を控える(最後の1つ)。ほかの知らせ・state の無い知らせでは控えず、受け手には今までどおり渡す", async () => {
    NATIVE_AUDIO.state = null;
    const api = fakeApi();
    const ev = nativeEvents(api);
    await ev.ready;
    const got = [];
    const seen = [];   // 受け手が読んだ時点の NATIVE_AUDIO.state(取り直しの始めが st= で読むのと同じ)
    const off = ev.subscribe("audioState", (d) => { got.push(d.state ?? "none"); seen.push(NATIVE_AUDIO.state && NATIVE_AUDIO.state.state); });
    api.emit("micData", { id: "x", pcm: "", sample: 0, host: 1, rate: RATE, frames: 0 });
    expect(NATIVE_AUDIO.state).toBe(null);
    api.emit("audioState", { state: "interrupted", reason: "began", mic: true, metro: false, id: "x", run: 0 });
    expect(NATIVE_AUDIO.state).toMatchObject({ state: "interrupted", reason: "began", mic: true, metro: false });
    expect(typeof NATIVE_AUDIO.state.at).toBe("number");
    api.emit("audioState", {});
    expect(NATIVE_AUDIO.state.state).toBe("interrupted");
    // 【審査】failed / running を受けたら、受け手へ渡し終えた後に下ろす(古い interrupted を残さない)。受け手は渡している最中は読める
    api.emit("audioState", { state: "failed", reason: "loop", mic: true, metro: true, id: "x", run: 3 });
    expect(NATIVE_AUDIO.state).toBe(null);
    api.emit("audioState", { state: "interrupted", reason: "began", mic: true, metro: false, id: "x", run: 3 });
    api.emit("audioState", { state: "running", reason: "rebuilt", mic: true, metro: false, id: "x", run: 3 });
    expect(NATIVE_AUDIO.state).toBe(null);
    expect(got).toEqual(["interrupted", "none", "failed", "interrupted", "running"]);
    expect(seen).toEqual(["interrupted", "interrupted", "failed", "interrupted", "running"]);
    off();
  });
  it("【審査】受け手が投げても、failed / running の後は状態を下ろす", async () => {
    const api = fakeApi();
    const ev = nativeEvents(api);
    await ev.ready;
    const off = ev.subscribe("audioState", () => { throw new Error("boom"); });
    expect(() => api.emit("audioState", { state: "failed", reason: "loop", mic: true, metro: false, id: "x", run: 0 })).toThrow("boom");
    expect(NATIVE_AUDIO.state).toBe(null);
    off();
  });
  it("【審査】micStop(マイクの口を止める・閉じる)で interrupted を下ろす。failed の受け手の中(_endTrack → _stop)では下ろさない = 取り直しの始めが st=failed を読める", async () => {
    const api = fakeApi();
    const nowRef = { t: 0 };
    const { ctx, stream } = await startMic(api, nowRef);
    NATIVE_AUDIO.state = { state: "interrupted", reason: "began", mic: true, metro: false, at: Date.now() };
    ctx.close();
    expect(NATIVE_AUDIO.state).toBe(null);
    const api2 = fakeApi();
    const { ctx: ctx2, stream: stream2 } = await startMic(api2, nowRef);
    let readInOnended = null;
    stream2.getTracks()[0].onended = () => { readInOnended = NATIVE_AUDIO.state && NATIVE_AUDIO.state.state; };
    api2.emit("audioState", { state: "failed", reason: "loop", mic: true, metro: false, id: ctx2._id, run: 0 });
    expect(readInOnended).toBe("failed");
    expect(NATIVE_AUDIO.state).toBe(null);
    void stream;
  });
});
