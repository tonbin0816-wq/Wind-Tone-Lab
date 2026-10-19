// src/shell/nativeAudio.js ── 【便CX 2026-10-19】殻(iOS アプリ)の計測タブの音を、殻(アプリのプロセス)の AVAudioEngine で扱う JS 側。
// Capacitor に触れない(呼び口は src/shell/audio.js の shellNativeAudio。検査は作り物の api を渡す)ので、静的に import してよい。
//
// なぜ殻へ移したか(本人の実機・診断の板の試し口 nativeSolo で確定): WebKit の getUserMedia と play-and-record の Web AudioContext が
// 動いている間、WebKit の GPU プロセス側の音のセッションが通話(videoChat)の段になり、アプリ全体の音量がその段に縛られる。
// 殻では getUserMedia を呼ばず、Web の AudioContext も作らず、navigator.audioSession.type も "play-and-record" にしない。
//
//   マイク     … NativeMicContext。startListening が Web の AudioContext の代わりに作る「同じ形の口」。
//                createMediaStreamSource / createAnalyser / createBiquadFilter を持ち、App.jsx の解析の配線(source → analyser・
//                source → bandpass → gateAnalyser)はそのまま組める。中身は殻から届く PCM(モノラル・Float32)を輪のバッファに溜めるだけで、
//                getFloatTimeDomainData は AnalyserNode と同じく直近 fftSize 個の標本を返す。バンドパスは Web Audio の BiquadFilterNode(bandpass)と
//                同じ式(RBJ。App.jsx の applyBandpassRBJ と同じ演算の順)を、状態を持ったまま塊ごとに回す。解析(ピッチ・音色・ゲート)の数値は変えない。
//   メトロノーム … createNativeMetronome。クリックは App.jsx の renderMetroClickSamples(OfflineAudioContext = 音の出口を使わない)で描いて殻へ渡し、
//                殻がプレーヤーの sample time で予約する。予約したクリックは殻が知らせる(h = host time 秒・s = プレーヤーの sample time・k・i・v)。
//   時計       … createHostClock。殻の host time(マイクの塊の host・クリックの h と同じ時計)と performance.now() の対応を、往復の真ん中で合わせる
//                (往復が最も短い標本を使う = ずれは往復の半分以下)。定期的(NATIVE_CLOCK_SYNC_MS)に合わせ直す。
import { shellNativeAudio } from "./audio.js";

// 輪のバッファの長さ(標本)。解析の窓(App.jsx の FFT_SIZE = 8192)の2倍。fftSize がこれより大きく置かれたら伸ばす
export const NATIVE_MIC_RING_MIN = 16384;
// 殻からの塊がこの時間届かなければ、解析には無音(0)を渡す ── Web で死んだマイクの解析バッファが 0 になるのと同じ形にして、
// 既存の無音の見張り(SILENCE_WATCHDOG_DB / SUSTAIN)と復旧の入口(recoverMic)にそのまま乗せる。
// 値の理由: 殻の入力は AVAudioSinkNode なら I/O の周期(約 5ms)ごとに来て約 21ms(1024 フレーム)ごとに送られるが、installTap に戻ったときは
// Apple の文書のとおり1回の塊が [100, 400] ms になる。最長の 400ms の塊が1つ遅れても(2倍の 800ms)誤って 0 にしないよう、それにブリッジの揺れを足した 1000ms。
// 死んだ入力を見つけるのは、これに無音の見張りの 1.5 秒を足した約 2.5 秒後になる(Web は 1.5 秒)。
export const NATIVE_MIC_STALE_MS = 1000;
// 時計を合わせ直す間隔・覚えておく標本の数・使う標本の往復の上限(往復の半分 = ずれの上限 10ms。越える標本は使わない。全部越えたら最短を使い、板に rtt>20)
export const NATIVE_CLOCK_SYNC_MS = 2000;
export const NATIVE_CLOCK_KEEP = 8;
export const NATIVE_CLOCK_MAX_RTT_MS = 20;
// クリックを描く標本化周波数(殻がセッションの値を返さなかったとき)
export const NATIVE_CLICK_RATE_FALLBACK = 48000;

// 作り直しの決まり(殻の AppDelegate.swift の rebuildMinIntervalSec / rebuildSettleSec / rebuildWindowSec / rebuildMaxInWindow / rebuildMaxFailures と同じ値。
// pitch-test K.14 が突き合わせる)。間隔の下限が 1 秒なので 10 秒の窓に入るのは最大 9〜10 件 ── 上限は窓に必ず届く 5 にした(10 では発動しなかった)。
export const NATIVE_REBUILD_MIN_INTERVAL_SEC = 1.0;
export const NATIVE_REBUILD_SETTLE_SEC = 0.2;
export const NATIVE_REBUILD_WINDOW_SEC = 10.0;
export const NATIVE_REBUILD_MAX_IN_WINDOW = 5;
export const NATIVE_REBUILD_MAX_FAILURES = 5;
// 作り直しの遅れ(殻の rebuildDelay と同じ式)
export function nativeRebuildDelay(sinceLast) {
  return Math.max(NATIVE_REBUILD_SETTLE_SEC, NATIVE_REBUILD_MIN_INTERVAL_SEC - sinceLast);
}
// 作り直しの歯止め(殻の rebuildDecision と同じ式)。窓の中に残る時刻と、諦めるか(時刻を差し替えて試せる純関数)
export function nativeRebuildDecision(times, now) {
  const keep = times.filter((t) => now - t < NATIVE_REBUILD_WINDOW_SEC);
  return { keep, giveUp: keep.length >= NATIVE_REBUILD_MAX_IN_WINDOW };
}
// 過ぎてしまった拍の数(殻の gridSkip と同じ式)。作り直しの間に過ぎた拍は鳴らさず、格子の上で数だけ進める
export function nativeGridSkip(next, now, step) {
  return now > next ? Math.ceil((now - next) / step) : 0;
}

// 診断の板が読む JS 側の様子(読むだけ。普段は誰も読まない)
export const NATIVE_AUDIO = {
  mic: { id: null, chunks: 0, rate: null, lastHostMs: null, lastRecvAt: null, error: "" },
  metro: { bufPeaks: null, error: "", clicks: 0, run: null },
};

// ---- base64 ⇔ Float32 ----
export function nativeFloat32ToBase64(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function nativeBase64ToFloat32(b64) {
  const s = atob(String(b64 || ""));
  const n = s.length - (s.length % 4);
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer, 0, n / 4);
}

// ============================================================
// 時計(殻の host time ⇔ performance.now())
// ============================================================
export function createHostClock({ api = null, now = () => performance.now(), setIntervalFn = (f, ms) => setInterval(f, ms), clearIntervalFn = (id) => clearInterval(id), syncMs = NATIVE_CLOCK_SYNC_MS } = {}) {
  const st = { samples: [], offsetMs: null, rttMs: null, rttWarn: false, sampleRate: null, users: 0, timer: null, syncing: null, syncs: 0, fails: 0 };
  function sync() {
    if (!api) return Promise.resolve(null);
    if (st.syncing) return st.syncing;
    st.syncing = (async () => {
      const t0 = now();
      let r;
      try { r = await api.clock(); } catch { st.fails += 1; return null; }
      const t1 = now();
      if (!r || typeof r.host !== "number" || !Number.isFinite(r.host)) { st.fails += 1; return null; }
      const rtt = t1 - t0;
      st.samples.push({ rtt, offset: (t0 + t1) / 2 - r.host * 1000, at: t1 });
      if (st.samples.length > NATIVE_CLOCK_KEEP) st.samples.shift();
      // 往復が上限(NATIVE_CLOCK_MAX_RTT_MS)を越える標本は使わない。その中で往復が最も短い標本(同じ短さなら新しい方)を使う = ずれはその往復の半分以下。
      // 全部が上限を越えたときは、仕方なく全部の中の最短を使い、rttWarn を立てる(板の nativeClock に rtt>20)
      const ok = st.samples.filter((x) => x.rtt <= NATIVE_CLOCK_MAX_RTT_MS);
      const pool = ok.length ? ok : st.samples;
      const best = pool.reduce((a, b) => (b.rtt <= a.rtt ? b : a));
      st.offsetMs = best.offset;
      st.rttMs = best.rtt;
      st.rttWarn = ok.length === 0;
      st.syncs += 1;
      if (typeof r.sampleRate === "number" && r.sampleRate > 0) st.sampleRate = r.sampleRate;
      return r;
    })().finally(() => { st.syncing = null; });
    return st.syncing;
  }
  return {
    state: st,
    sync,
    // 使い始める(数える)。使う人がいる間だけ syncMs ごとに合わせ直す。答えは「使い終わる」関数(2回呼んでも1回分)
    acquire() {
      st.users += 1;
      if (!st.timer) { sync(); st.timer = setIntervalFn(sync, syncMs); }
      let done = false;
      return () => {
        if (done) return;
        done = true;
        st.users = Math.max(0, st.users - 1);
        if (st.users === 0 && st.timer) { clearIntervalFn(st.timer); st.timer = null; }
      };
    },
    get synced() { return st.offsetMs !== null; },
    // ずれの上限(ミリ秒)= 使っている標本の往復の半分。合わせていなければ null
    get errorBoundMs() { return st.rttMs === null ? null : st.rttMs / 2; },
    nowHostSec() { return (now() - (st.offsetMs ?? 0)) / 1000; },
    toPerfMs(hostSec) { return hostSec * 1000 + (st.offsetMs ?? 0); },
  };
}
let HOST_CLOCK = null;
export function nativeHostClock() {
  if (!HOST_CLOCK) HOST_CLOCK = createHostClock({ api: shellNativeAudio() });
  return HOST_CLOCK;
}

// ============================================================
// マイク(Web の AudioContext と同じ形の口)
// ============================================================

// バンドパスの係数(Web Audio の BiquadFilterNode type "bandpass" = RBJ の Audio-EQ-Cookbook・ピーク 0dB)。
// 式と演算の順は App.jsx の applyBandpassRBJ と同じ(同じ値になる ── nativeAudio.test.js が全体を一度に回した値と比べる)。
export function nativeBandpassCoefficients(sampleRate, centerHz, q) {
  const w0 = (2 * Math.PI * centerHz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW0 = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0;
  const a1 = (-2 * cosW0) / a0, a2 = (1 - alpha) / a0;
  return { b0, b2, a1, a2 };
}

class NativeSourceNode {
  constructor() { this._outs = []; }
  connect(dest) { if (dest && !this._outs.includes(dest)) this._outs.push(dest); return dest; }
  disconnect() { this._outs = []; }
  _push(x) { for (const o of this._outs) o._push(x); }
}

// BiquadFilterNode の代わり(bandpass だけ)。状態(x1, x2, y1, y2)は塊をまたいで持ち、中心周波数・Q が替わっても状態はそのまま(Web Audio と同じ)。
// bandpass 以外の type は素通し(App.jsx が置くのは bandpass だけ)。
class NativeBiquadNode {
  constructor(ctx) {
    this.context = ctx;
    this.type = "lowpass";
    this.frequency = { value: 350 };
    this.Q = { value: 1 };
    this._outs = [];
    this._x1 = 0; this._x2 = 0; this._y1 = 0; this._y2 = 0;
    this._key = null; this._c = null;
  }
  connect(dest) { if (dest && !this._outs.includes(dest)) this._outs.push(dest); return dest; }
  disconnect() { this._outs = []; }
  // 入力の標本化周波数が替わったとき: 状態を捨て、係数は次の塊で新しい周波数から作り直す
  _reset() { this._x1 = 0; this._x2 = 0; this._y1 = 0; this._y2 = 0; this._key = null; this._c = null; }
  _push(input) {
    let out = input;
    if (this.type === "bandpass") {
      const rate = this.context.sampleRate;
      const key = `${rate}|${this.frequency.value}|${this.Q.value}`;
      if (key !== this._key) { this._key = key; this._c = nativeBandpassCoefficients(rate, this.frequency.value, this.Q.value); }
      const { b0, b2, a1, a2 } = this._c;
      out = new Float32Array(input.length);
      let x1 = this._x1, x2 = this._x2, y1 = this._y1, y2 = this._y2;
      for (let i = 0; i < input.length; i++) {
        const x0 = input[i];
        const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
        out[i] = y0;
        x2 = x1; x1 = x0;
        y2 = y1; y1 = y0;
      }
      this._x1 = x1; this._x2 = x2; this._y1 = y1; this._y2 = y2;
    }
    for (const o of this._outs) o._push(out);
  }
}

// AnalyserNode の代わり(時間波形だけ)。getFloatTimeDomainData は直近 min(配列の長さ, fftSize) 個の標本を写す(足りない頭は 0)。
// 殻からの塊が届かない(NATIVE_MIC_STALE_MS)・トラックを止めた / 無効にした間は 0 を写す(Web の死んだ・止めたマイクと同じ)。
class NativeAnalyserNode {
  constructor(ctx) {
    this.context = ctx;
    this._fft = 2048;
    this.smoothingTimeConstant = 0.8; // 時間波形には効かない(AnalyserNode と同じ)
    this._ring = new Float32Array(NATIVE_MIC_RING_MIN);
    this._w = 0;      // 次に書く位置
    this._n = 0;      // これまでに書いた数(輪の長さで頭打ち)
  }
  get fftSize() { return this._fft; }
  set fftSize(v) {
    this._fft = v;
    if (this._ring.length < v * 2) { this._ring = new Float32Array(v * 2); this._w = 0; this._n = 0; }
  }
  get frequencyBinCount() { return this._fft / 2; }
  connect(dest) { return dest; }
  disconnect() {}
  // 入力の標本化周波数が替わったとき: 前の周波数の標本を捨てる(違う周波数の標本を1つの窓に混ぜない)
  _reset() { this._ring.fill(0); this._w = 0; this._n = 0; }
  _push(x) {
    const ring = this._ring;
    const L = ring.length;
    let src = x;
    if (src.length > L) src = src.subarray(src.length - L);
    const first = Math.min(src.length, L - this._w);
    ring.set(src.subarray(0, first), this._w);
    if (first < src.length) ring.set(src.subarray(first), 0);
    this._w = (this._w + src.length) % L;
    this._n = Math.min(L, this._n + src.length);
  }
  getFloatTimeDomainData(out) {
    const n = Math.min(out.length, this._fft);
    if (!this.context._fresh()) { out.fill(0, 0, n); return; }
    const ring = this._ring;
    const L = ring.length;
    const have = Math.min(n, this._n);
    const lead = n - have;
    if (lead > 0) out.fill(0, 0, lead);
    let start = (this._w - have + L) % L;
    const first = Math.min(have, L - start);
    out.set(ring.subarray(start, start + first), lead);
    if (first < have) out.set(ring.subarray(0, have - first), lead + first);
  }
}

// ---- 殻からの知らせの受け手(殻の部品ごとに1回だけ登録して付けっぱなし) ----
// 殻の notifyListeners は殻の列(micQueue / audioQueue)から送り、受け手の登録の書き換え(登録・解除)は Capacitor の bridge の列で
// 行われ、知らせとは同期しない。そのため、殻の受け手は3つの知らせをまとめて最初の1回だけ(マイクを始める前に)登録し、流している間は書き換えない。
// 計測を始める・止めるたびに足し外しするのは、この JS の中の受け手(subs)だけ。古い知らせはそれぞれの受け手が id / run で捨てる。
const NATIVE_EVENT_NAMES = ["micData", "metroClicks", "audioState"];
const NATIVE_EVENTS = new WeakMap();
export function nativeEvents(api) {
  let e = NATIVE_EVENTS.get(api);
  if (e) return e;
  const subs = {};
  for (const name of NATIVE_EVENT_NAMES) subs[name] = new Set();
  const ready = api && typeof api.on === "function"
    ? Promise.all(NATIVE_EVENT_NAMES.map((name) => api.on(name, (d) => { for (const fn of [...subs[name]]) fn(d); }))).then(() => true, () => false)
    : Promise.resolve(false);
  e = {
    subs,
    ready,
    subscribe(name, fn) { subs[name].add(fn); return () => { subs[name].delete(fn); }; },
  };
  NATIVE_EVENTS.set(api, e);
  return e;
}

let MIC_SEQ = 0;

// startListening が Web の AudioContext の代わりに作る口。state は "suspended"(start の前)→ "running" → "closed"(close の後)。
// start() は殻のマイク(micStart)を始め、MediaStream と同じ形({ getTracks, getAudioTracks })を返す。許可が無い・殻が始められないときは投げる
// (呼び手の失敗の枝 = 今の拒否の案内)。close() が始まる前に呼ばれていたら、殻のマイクを止めてから投げる(置き換えられた取得)。
export class NativeMicContext {
  constructor({ api = shellNativeAudio(), now = () => performance.now(), staleMs = NATIVE_MIC_STALE_MS } = {}) {
    this._api = api;
    this._now = now;
    this._staleMs = staleMs;
    this._id = `mic-${++MIC_SEQ}-${Math.round(now())}`;
    this._sources = [];
    this._nodes = [];      // 作った analyser / biquad(標本化周波数が替わったときに捨てる)
    this._track = null;
    this._unsub = [];
    this._lastRecvAt = -Infinity;
    this._lastHostMs = NaN;
    this._lastSample = null;
    this._stopped = false;
    this._t0 = now();
    this.state = "suspended";
    this.sampleRate = NATIVE_CLICK_RATE_FALLBACK;
    this.__nativeMic = true;
  }
  get currentTime() { return (this._now() - this._t0) / 1000; }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { this._stop(); this.state = "closed"; return Promise.resolve(); }
  createMediaStreamSource() { const s = new NativeSourceNode(); this._sources.push(s); return s; }
  createAnalyser() { const n = new NativeAnalyserNode(this); this._nodes.push(n); return n; }
  createBiquadFilter() { const n = new NativeBiquadNode(this); this._nodes.push(n); return n; }
  // 除外(isNearScheduledClick)の「今」: いちばん新しい入力の標本の host time(ミリ秒)。クリックの h(host time)と同じ時計
  clickClockMs() { return this._lastHostMs; }
  _fresh() {
    if (this.state !== "running" || this._stopped) return false;
    const t = this._track;
    if (!t || t.readyState !== "live" || t.enabled === false) return false;
    return this._now() - this._lastRecvAt <= this._staleMs;
  }
  async start() {
    if (!this._api) throw new Error("native audio unavailable");
    // 先に知らせを受け始める(呼び出しの答えより先に届く塊を落とさない)。殻の受け手は nativeEvents が最初の1回だけ登録し、
    // ここで足し外しするのは JS の中の受け手だけ(流している間に bridge の登録を書き換えない)
    const ev = nativeEvents(this._api);
    this._unsub.push(ev.subscribe("micData", (d) => this._onData(d)), ev.subscribe("audioState", (d) => this._onState(d)));
    await ev.ready;
    if (this._stopped) throw new Error("superseded");
    let r;
    try {
      r = await this._api.micStart({ id: this._id });
    } catch (e) {
      NATIVE_AUDIO.mic.error = String(e?.code || e?.message || e);
      this._unlisten();
      throw e;
    }
    if (this._stopped) {
      // 待っている間に止められた(stopListening・別の取得)。殻のマイクも止めてから、置き換えられた取得として投げる
      this._api.micStop({ id: this._id }).catch(() => {});
      throw new Error("superseded");
    }
    if (r && typeof r.sampleRate === "number" && r.sampleRate > 0) this.sampleRate = r.sampleRate;
    this.state = "running";
    NATIVE_AUDIO.mic.id = this._id;
    NATIVE_AUDIO.mic.rate = this.sampleRate;
    NATIVE_AUDIO.mic.error = "";
    const ctx = this;
    this._track = {
      kind: "audio", id: this._id, label: "native:builtInMic",
      readyState: "live", muted: false, enabled: true,
      onmute: null, onended: null, onconfigurationchange: null,
      stop() { if (this.readyState === "ended") return; this.readyState = "ended"; ctx._stop(); },
      // 殻のタップは音声処理を通さない(エコー除去・ノイズ抑制・自動音量調整なし)
      getSettings() { return { deviceId: "native", echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: ctx.sampleRate, channelCount: 1 }; },
    };
    const track = this._track;
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  }
  _unlisten() {
    const offs = this._unsub;
    this._unsub = [];
    for (const off of offs) { try { off(); } catch { /* noop */ } }
  }
  _stop() {
    if (this._stopped) return;
    this._stopped = true;
    this._unlisten();
    if (this._api) Promise.resolve().then(() => this._api.micStop({ id: this._id })).catch(() => {});
  }
  _onData(d) {
    if (!d || d.id !== this._id || this._stopped) return;
    const pcm = nativeBase64ToFloat32(d.pcm);
    if (!pcm.length) return;
    const rate = typeof d.rate === "number" && d.rate > 0 ? d.rate : this.sampleRate;
    // 入力の標本化周波数が途中で替わった(経路の変化で殻が作り直した等): トラックは終わらせない(録音中でも無音を続けない)。
    // sampleRate を新しい値にし(tick は毎フレーム audioCtx.sampleRate を読む)、2つの輪とバンドパスの状態を捨て(係数は新しい周波数で作り直す)、そのまま続ける
    if (rate !== this.sampleRate) {
      this.sampleRate = rate;
      NATIVE_AUDIO.mic.rate = rate;
      NATIVE_AUDIO.mic.rateChanges = (NATIVE_AUDIO.mic.rateChanges || 0) + 1;
      for (const n of this._nodes) n._reset();
    }
    this._lastRecvAt = this._now();
    this._lastHostMs = (d.host + pcm.length / rate) * 1000;
    this._lastSample = typeof d.sample === "number" && d.sample >= 0 ? d.sample + pcm.length : null;
    NATIVE_AUDIO.mic.chunks += 1;
    NATIVE_AUDIO.mic.lastHostMs = this._lastHostMs;
    NATIVE_AUDIO.mic.lastRecvAt = this._lastRecvAt;
    for (const s of this._sources) s._push(pcm);
  }
  // 殻が作り直しを諦めた(failed)・このマイクだった: トラックを終わらせ、既存の復旧の入口(トラックの onended → recoverMic)に渡す
  _onState(d) {
    if (!d || d.state !== "failed" || !d.mic || d.id !== this._id) return;
    this._endTrack();
  }
  _endTrack() {
    const t = this._track;
    if (!t || t.readyState === "ended") return;
    t.readyState = "ended";
    this._stop();
    if (typeof t.onended === "function") t.onended();
  }
}
export function createNativeMicContext(opts) { return new NativeMicContext(opts); }

// ============================================================
// メトロノーム
// ============================================================
let METRO_RUN_SEQ = 0;
let METRO_VER_SEQ = 0;
// 描いたクリックを殻へ渡した標本化周波数(殻の部品ごと。殻はアプリが動いている間バッファを持つ。JS を読み直したら1回渡し直す)
const CLICKS_LOADED = new WeakMap();
const absPeak = (d) => { let p = 0; for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i])); return p; };

// MeasureView が1つ持つ殻のメトロノーム。ctx は MeasureView の metroCtxRef に入る「時計の口」(currentTime = 殻の host time の秒。
// getMetroPhase・診断の読み手はこれを読む)。start / update / stop は「こうしてほしい」を置くだけで、殻への呼び出しは1本の列で順に送る
// (開始と停止が入れ替わらない・続けて替えたら最後の形だけを送る)。
//   start(pattern, leadSec)        … 小節の頭を今から leadSec 秒後に置いて鳴らし始める(Web の startMetronome は 0.12)
//   update(pattern, { restart })   … テンポ・アクセント・まとまりは次の拍から(restart なし)。拍子・分割は小節の頭から(restart。Web は 0.08 秒後)
//   stop()
// 答えの { run, v } の v は、殻が知らせるクリックの v と同じ(どの設定で予約したクリックか)。onClicks(clicks) は今の run の知らせだけ渡す。
// onFail(reason) は今の run が殻で鳴らせなかった(描き出し・load・start の失敗・作り直しを諦めた)とき。
export function createNativeMetronome({ api = shellNativeAudio(), clock = nativeHostClock(), renderClicks, onClicks, onFail } = {}) {
  const want = { on: false, run: null, v: null, pattern: null, lead: 0.12, restart: false };
  const sent = { on: false, run: null, v: null };
  const st = { chain: Promise.resolve(), offs: [], closed: false, releaseClock: null };
  const ctx = {
    state: "running",
    __nativeMetro: true,
    get sampleRate() { return clock.state.sampleRate || NATIVE_CLICK_RATE_FALLBACK; },
    get currentTime() { return clock.nowHostSec(); },
    resume() { return Promise.resolve(); },
    suspend() { return Promise.resolve(); },
    close() { metro.stop(); metro.dispose(); ctx.state = "closed"; return Promise.resolve(); },
  };
  // 殻の受け手は nativeEvents が1回だけ登録する。ここで足し外しするのは JS の中の受け手だけ
  const listen = (event, fn) => {
    if (!api) return;
    st.offs.push(nativeEvents(api).subscribe(event, fn));
  };
  // 殻は作り直しのとき、まだ鳴っていないクリックを同じ通し番号(n)で予約し直す。同じ run の中で、もう渡した番号の知らせは捨てる(振り子の拍を二重に数えない)
  const seen = { run: null, n: -1 };
  listen("metroClicks", (d) => {
    if (!d || !want.on || d.run !== want.run || !Array.isArray(d.clicks)) return;
    if (seen.run !== d.run) { seen.run = d.run; seen.n = -1; }
    const fresh = d.clicks.filter((c) => typeof c.n !== "number" || c.n > seen.n);
    for (const c of fresh) if (typeof c.n === "number") seen.n = Math.max(seen.n, c.n);
    if (!fresh.length) return;
    NATIVE_AUDIO.metro.clicks += fresh.length;
    if (onClicks) onClicks(fresh);
  });
  listen("audioState", (d) => {
    if (!d || d.state !== "failed" || !d.metro || !want.on || d.run !== sent.run) return;
    sent.on = false;
    fail(`rebuild: ${d.reason}`, want.run);
  });
  function fail(reason, run) {
    NATIVE_AUDIO.metro.error = String(reason);
    if (run === want.run && want.on && onFail) onFail(String(reason));
  }
  async function ensureLoaded() {
    await clock.sync();
    const rate = clock.state.sampleRate || NATIVE_CLICK_RATE_FALLBACK;
    if (CLICKS_LOADED.get(api) === rate) return;
    if (!renderClicks) throw new Error("load: no renderer");
    const r = await renderClicks(rate);
    NATIVE_AUDIO.metro.bufPeaks = { rate: r.sampleRate ?? rate, accent: absPeak(r.accent), beat: absPeak(r.beat), sub: absPeak(r.sub) };
    await api.metroLoad({ sampleRate: r.sampleRate ?? rate, accent: nativeFloat32ToBase64(r.accent), beat: nativeFloat32ToBase64(r.beat), sub: nativeFloat32ToBase64(r.sub) });
    CLICKS_LOADED.set(api, rate);
  }
  // 「こうしてほしい」と「送ったもの」の差だけを送る(列の上で1回ずつ)
  async function flush() {
    if (!api) return;
    if (!want.on) {
      if (sent.on) {
        const run = sent.run;
        sent.on = false;
        await api.metroStop({ run });
      }
      return;
    }
    if (!sent.on) {
      const run = want.run;
      try {
        await ensureLoaded();
        if (!want.on || want.run !== run) return flush();
        const v = want.v;
        await api.metroStart({ run, v, stepSec: want.pattern.stepSec, kinds: want.pattern.kinds, leadSec: want.lead });
        sent.on = true; sent.run = run; sent.v = v; want.restart = false;
        NATIVE_AUDIO.metro.run = run;
        NATIVE_AUDIO.metro.error = "";
      } catch (e) {
        fail(`start: ${e?.code || e?.message || e}`, run);
        return;
      }
      return flush();
    }
    if (want.v !== sent.v || want.run !== sent.run) {
      const run = want.run;
      const v = want.v;
      const restart = want.run !== sent.run;
      try {
        await api.metroUpdate({ run, v, stepSec: want.pattern.stepSec, kinds: want.pattern.kinds, restart, leadSec: want.lead });
        sent.run = run; sent.v = v;
        NATIVE_AUDIO.metro.run = run;
      } catch (e) {
        fail(`update: ${e?.code || e?.message || e}`, run);
        return;
      }
      return flush();
    }
  }
  const enqueue = () => { st.chain = st.chain.then(flush).catch((e) => { NATIVE_AUDIO.metro.error = String(e?.message || e); }); return st.chain; };
  const metro = {
    ctx,
    start(pattern, leadSec = 0.12) {
      want.on = true;
      want.run = ++METRO_RUN_SEQ;
      want.v = ++METRO_VER_SEQ;
      want.pattern = pattern;
      want.lead = leadSec;
      sent.on = false; // 始め直しは殻でも頭から(鳴っていても metroStart を送り直す)
      if (!st.releaseClock) st.releaseClock = clock.acquire();
      enqueue();
      return { run: want.run, v: want.v };
    },
    update(pattern, { restart = false, leadSec = 0.08 } = {}) {
      if (!want.on) return null;
      want.v = ++METRO_VER_SEQ;
      want.pattern = pattern;
      if (restart) { want.run = ++METRO_RUN_SEQ; want.lead = leadSec; }
      enqueue();
      return { run: want.run, v: want.v };
    },
    stop() {
      want.on = false;
      if (st.releaseClock) { st.releaseClock(); st.releaseClock = null; }
      return enqueue();
    },
    dispose() {
      st.closed = true;
      const offs = st.offs;
      st.offs = [];
      for (const off of offs) { try { off(); } catch { /* noop */ } }
    },
    get running() { return want.on; },
    get run() { return want.run; },
    // 検査が待つための口(列が空になるまで)
    idle() { return st.chain; },
  };
  return metro;
}
