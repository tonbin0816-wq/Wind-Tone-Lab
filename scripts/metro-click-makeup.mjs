// メトロノームのクリック音の **ピークとエネルギー** を計算で出す。
// 【D-25】音は木の1種だけになったので、比べる相手は **変更前の木(5ab5206)** になった。
//
// なぜ要るか(D-24a 指摘6):
//   makeup(振幅の戻し)の根拠として記録に数値を載せるなら、次に触る人がその数値を
//   **検証も更新もできる**形で残しておかなければならない(罠7: 測っていない数値を書かない)。
//
// この計算の入力は **src/App.jsx と scripts/metro-click-before.mjs だけ**。
//   ・METRO_CLICK_SPEC / METRO_CLICK_VOL / getMetroClickBuffer / getMetroMasterInput /
//     scheduleMetroClick をソースから取り出してそのまま動かす
//   ・値をここへ書き写さない(罠3: 実装と同じ式を書き直した検算は恒真になる)
//   ・実装が実際に組み立てた graph(何を作り・どの値を設定し・どこへ繋いだか)を
//     読んで、その通りにオフラインで信号を作る
//   ・**変更前の木**は scripts/metro-click-before.mjs(5ab5206 からの逐語の標本)を駆動する
//
// 何を測っているか / 測っていないか:
//   ・測っているのは **マスターチェーンに入る直前**の1回ぶんの波形。
//     リミッター(閾値-3dB・比20)と masterGain 2.6 は通していない(D-24 仕様 §1.5 で触らない所)。
//   ・**実機で聴いた音ではない。** 端末・出力ルート(受話口/スピーカー)で聴感は変わる。
//     **高くなったか・鋭くなったかは、この数値では判定できない**(本人が実機で聴いて決める)。
//   ・雑音に依存するので、**種を固定した疑似乱数で多数回引いて平均**する
//     (1回の引きでは ±数%ばらつく)。
//
// 使い方:
//   node scripts/metro-click-makeup.mjs [--draws 1000]
//   node scripts/metro-click-makeup.mjs --solve   ← 変更前の木とピークがそろう makeup を求める
import { readFileSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
import { scheduleBeforeWood, BEFORE_WOOD_SPEC } from "./metro-click-before.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "..", "src", "App.jsx"), "utf8");

export const SAMPLE_RATE = 48000;
const DRAWS = (() => {
  const i = process.argv.indexOf("--draws");
  const n = i >= 0 ? parseInt(process.argv[i + 1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1000;
})();

// ---- 実装をソースから取り出す(pitch-test.mjs と同じやり方) --------------------
function extractFunction(name) {
  const idx = src.indexOf(`function ${name}(`);
  if (idx === -1) throw new Error(`function ${name} not found`);
  let i = src.indexOf("{", idx), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error(`function ${name}: unbalanced braces`);
}
function extractConst(name) {
  const m = new RegExp(`const ${name} = `).exec(src);
  if (!m) throw new Error(`const ${name} not found`);
  const start = m.index;
  let i = src.indexOf("=", start) + 1;
  while (src[i] === " ") i++;
  if (src[i] === "{" || src[i] === "[") {
    const open = src[i], close = open === "{" ? "}" : "]";
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === open) depth++;
      else if (src[i] === close) { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i) + ";";
  }
  return src.slice(start, src.indexOf(";", start) + 1);
}

const api = new Function(`${[
  extractConst("METRO_CLICK_VOL"),
  extractConst("METRO_CLICK_SPEC"),
  extractFunction("getMetroClickBuffer"),
  extractFunction("getMetroMasterInput"),
  extractFunction("scheduleMetroClick"),
].join("\n\n")}
  return { METRO_CLICK_SPEC, METRO_CLICK_VOL, scheduleMetroClick };`)();

export const METRO_CLICK_SPEC = api.METRO_CLICK_SPEC;

// ---- 種を固定した疑似乱数(mulberry32)。同じ種なら必ず同じ列が出る ------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 実装を動かして graph を組み立てる作り物の AudioContext -------------------
// ノードは「何が設定され、どこへ繋がれたか」を素直に持つだけ。あとで信号を作るときに読む。
function makeGraphCtx() {
  const nodes = [];
  const mk = (kind) => {
    const nd = { kind, id: nodes.length, out: null, events: [], startAt: null, stopAt: null,
      startOffset: null, startDuration: null, loop: false };
    // 【D-24d】本物は connect(undefined) で TypeError。作り物が黙って受けると、
    // 繋がっていない配線を持つ実装を「鳴る」と描いてしまう(罠19)。
    nd.connect = (dst) => { if (!dst) throw new TypeError("connect: 繋ぎ先が無い"); nd.out = dst; };
    nodes.push(nd);
    return nd;
  };
  const param = (nd, name) => ({
    set value(v) { nd[name] = v; },
    get value() { return nd[name]; },
    setValueAtTime(v, t) { nd.events.push({ name, kind: "set", v, t }); return this; },
    exponentialRampToValueAtTime(v, t) { nd.events.push({ name, kind: "exp", v, t }); return this; },
    linearRampToValueAtTime(v, t) { nd.events.push({ name, kind: "lin", v, t }); return this; },
  });
  const ctx = {
    sampleRate: SAMPLE_RATE, currentTime: 0, nodes,
    destination: { kind: "destination", id: -1 },
    createBuffer(ch, len) {
      const data = new Float32Array(len);
      return { length: len, duration: len / SAMPLE_RATE, numberOfChannels: ch, getChannelData: () => data };
    },
    createBufferSource() {
      const nd = mk("source"); nd.buffer = null;
      // 【D-25】本物の AudioBufferSourceNode は start(when, offset, duration) を取り、
      // loop = true なら stop() されるまで鳴り続ける。作り物が第2・第3引数と loop を
      // 捨てていたので、`src.start(t, 0.055)`(ほぼ無音)も `src.loop = true`(鳴り止まない)も
      // **満額の波形**として描いていた(罠19: 作り物が本物より甘い)。
      nd.start = (t, offset, duration) => {
        nd.startAt = t;
        nd.startOffset = offset === undefined ? null : offset;
        nd.startDuration = duration === undefined ? null : duration;
      };
      nd.stop = (t) => { nd.stopAt = t; };
      return nd;
    },
    createOscillator() {
      const nd = mk("osc");
      nd.frequency = param(nd, "freq");
      nd.start = (t) => { nd.startAt = t; };
      nd.stop = (t) => { nd.stopAt = t; };
      Object.defineProperty(nd, "type", { set(v) { nd.oscType = v; }, get() { return nd.oscType; }, configurable: true });
      return nd;
    },
    createBiquadFilter() {
      const nd = mk("biquad");
      nd.frequency = param(nd, "freq");
      nd.Q = param(nd, "q");
      nd.gain = param(nd, "filterGain");
      Object.defineProperty(nd, "type", { set(v) { nd.filterType = v; }, get() { return nd.filterType; }, configurable: true });
      return nd;
    },
    createGain() {
      const nd = mk("gain");
      nd.gain = param(nd, "gainValue");
      return nd;
    },
    createDynamicsCompressor() {
      const nd = mk("comp");
      for (const k of ["threshold", "knee", "ratio", "attack", "release"]) nd[k] = param(nd, k);
      return nd;
    },
  };
  return ctx;
}

// ---- Web Audio 仕様の双二次係数(RBJ Audio-EQ-Cookbook) -----------------------
// bandpass は alphaQ = sin(w0)/(2Q)、highpass は仕様どおり Q をデシベルとして扱う
// (alphaQ_dB = sin(w0)/(2 * 10^(Q/20)))。ここが BiquadFilterNode と食い違うと全部ずれる。
function biquadCoeffs(type, f0, q) {
  const w0 = (2 * Math.PI * f0) / SAMPLE_RATE;
  const cosW0 = Math.cos(w0), sinW0 = Math.sin(w0);
  if (type === "bandpass") {
    const alpha = sinW0 / (2 * q);
    const a0 = 1 + alpha;
    return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * cosW0) / a0, a2: (1 - alpha) / a0 };
  }
  if (type === "highpass") {
    const alpha = sinW0 / (2 * Math.pow(10, q / 20));
    const a0 = 1 + alpha;
    const c = (1 + cosW0) / 2;
    return { b0: c / a0, b1: (-(1 + cosW0)) / a0, b2: c / a0, a1: (-2 * cosW0) / a0, a2: (1 - alpha) / a0 };
  }
  throw new Error(`未対応のフィルタ: ${type}`);
}
function runBiquad(x, c) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    y[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return y;
}

// ---- AudioParam の自動化(setValueAtTime / exponentialRampToValueAtTime) ------
// 指数ランプは v(t) = v0 * (v1/v0)^((t-t0)/(t1-t0))。イベントが無い区間は直前の値を保つ。
function envelopeAt(events, t) {
  const ev = [...events].sort((a, b) => a.t - b.t);
  let v = ev.length ? ev[0].v : 1;
  let prevT = ev.length ? ev[0].t : 0;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (t < e.t) {
      if (e.kind === "exp") {
        const r = (t - prevT) / (e.t - prevT);
        return v * Math.pow(e.v / v, Math.max(0, Math.min(1, r)));
      }
      if (e.kind === "lin") {
        const r = Math.max(0, Math.min(1, (t - prevT) / (e.t - prevT)));
        return v + (e.v - v) * r;
      }
      return v;
    }
    v = e.v; prevT = e.t;
  }
  return v;
}

// ---- 組み上がった graph を1回ぶんの波形に描く --------------------------------
// 鎖は 音源 → (フィルタ) → ゲイン → リミッター。**リミッターの手前まで**を返す。
// schedule は (ctx, t, kind) を取る予約関数 ── 現行の実装でも、変更前の標本でもよい。
export function renderWith(schedule, kind, rand) {
  const ctx = makeGraphCtx();
  const origRandom = Math.random;
  Math.random = rand;
  try { schedule(ctx, 0, kind); } finally { Math.random = origRandom; }

  const source = ctx.nodes.find((n) => n.kind === "source" || n.kind === "osc");
  if (!source) throw new Error(`${kind}: 音源が見つからない`);
  // 【D-24b】**start() されていない音源は1サンプルも鳴らない。**
  // ここを持たずに `source.buffer` を無条件で読み `(source.startAt || 0)` で 0 扱いすると、
  // `src.start(t);` を消した(= **完全な無音**になる)実装を**満額の波形**として描いてしまう。
  // 作り物のモデルが本物より甘いと、この波形を読む検査が嘘をつく。
  if (source.startAt === null) return new Float64Array(0);
  // 音源が動いている長さ: stop() があればそこまで、
  // 【D-25】start の第3引数(duration)があればそこまで、無ければバッファの残り(offset のぶん短い)。
  // loop = true は stop() が無ければ**永久に鳴り続ける**ので、ここでは描けない
  //(呼び手が「窓に収まらない」と判定する)。
  const bufDur = source.kind === "source" ? source.buffer.duration : Infinity;
  const offset = source.startOffset || 0;
  const natural = source.loop ? Infinity : Math.max(0, bufDur - offset);
  const byDuration = source.startDuration === null ? Infinity : source.startDuration;
  const byStop = source.stopAt === null ? Infinity : source.stopAt - source.startAt;
  const dur = Math.min(natural, byDuration, byStop);
  if (!Number.isFinite(dur)) throw new Error(`${kind}: 音源が止まらない(loop で stop が無い)`);
  const n = Math.round(dur * SAMPLE_RATE);

  let x = new Float64Array(n);
  if (source.kind === "source") {
    const d = source.buffer.getChannelData(0);
    const off = Math.round(offset * SAMPLE_RATE);
    for (let i = 0; i < n; i++) x[i] = d[off + i] || 0;
  } else {
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * source.freq * i) / SAMPLE_RATE);
  }

  let node = source.out;
  // 【D-24d】止まるのは **comp(マスターの入口)** のみ。destination も止め先にしていたため、
  // マスターを迂回して出口へ直行する鎖を「正常」として満額の波形を返していた。
  while (node && node.kind !== "comp") {
    if (node.kind === "biquad") x = runBiquad(x, biquadCoeffs(node.filterType, node.freq, node.q));
    else if (node.kind === "gain") {
      const ev = node.events.filter((e) => e.name === "gainValue");
      for (let i = 0; i < n; i++) x[i] *= envelopeAt(ev, source.startAt + i / SAMPLE_RATE);
    }
    node = node.out;
  }
  // 【D-24c】**鎖がマスター(comp)にも出力にも届かないなら、その音はどこへも出ない = 無音。**
  // 罠19: 作り物は「本物ができないことをできてはいけない」。繋がっていない音は鳴らない。
  if (!node) return new Float64Array(0);   // マスターに届かない鎖はどこへも出ない = 無音
  return x;
}

// いまの実装(木1種)の1回ぶん。
export function renderClick(kind, rand) { return renderWith(api.scheduleMetroClick, kind, rand); }
// 変更前の木(5ab5206)の1回ぶん。**同じ描き手**で描くので、差は音の作りの差だけになる。
export function renderBefore(kind, rand) { return renderWith(scheduleBeforeWood, kind, rand); }

export function peakOf(x) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m; }
export function energyOf(x) { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / SAMPLE_RATE); }

// 種を固定して draws 回引いた平均。
function meanOver(render, kind, draws) {
  let p = 0, e = 0;
  const peaks = [];
  for (let i = 0; i < draws; i++) {
    const x = render(kind, mulberry32(0x9e3779b9 + i));
    const pk = peakOf(x);
    peaks.push(pk); p += pk; e += energyOf(x);
  }
  const mean = p / draws;
  const sd = draws < 2 ? 0
    : Math.sqrt(peaks.reduce((s, v) => s + (v - mean) ** 2, 0) / draws);
  return { peak: mean, peakSd: sd, energy: e / draws };
}

// ---- 実行(このファイルを直接動かしたときだけ。検査ハーネスからは renderClick を使う) -----------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pad = (s, w) => String(s).padEnd(w);
  console.log(`サンプリング周波数 ${SAMPLE_RATE}Hz / 雑音の引き直し ${DRAWS}回(種は固定)`);
  console.log("測っているのは **マスターチェーンに入る直前**の1回ぶん(リミッターと gain 2.6 は通していない)\n");

  const before = meanOver(renderBefore, "accent", DRAWS);
  const now = meanOver(renderClick, "accent", DRAWS);

  if (process.argv.includes("--solve")) {
    // 【罠3 を避ける】makeup を「式で言い換えた値」にせず、**実際に鳴らして探す**。
    //
    // ピークは makeup にほぼ比例するが、**厳密には比例しない**。包絡が
    //   setValueAtTime(vol, t) → exponentialRampToValueAtTime(0.0001, t + decay)
    // という形で、**行き先の 0.0001 は vol によらず固定**なので、vol が大きいほど
    // 減衰の傾きが急になる(ピークが立つ最初の数サンプルのあいだにも 1% ほど効く)。
    // 1回の割り算で出すと 1% ずれるので、makeup を実際に差し替えながら二分探索する。
    const cur = api.METRO_CLICK_SPEC.makeup;
    const peakAt = (m) => {
      api.METRO_CLICK_SPEC.makeup = m;
      try { return meanOver(renderClick, "accent", DRAWS).peak; } finally { api.METRO_CLICK_SPEC.makeup = cur; }
    };
    let lo = 0.01, hi = 100;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (peakAt(mid) < before.peak) lo = mid; else hi = mid;
    }
    const want = (lo + hi) / 2;
    console.log("【makeup を解く】変更前の木の accent のピークにそろえる(二分探索・実際に鳴らして比べる)");
    console.log(`  変更前の木(${BEFORE_WOOD_SPEC.freq.accent}Hz / 減衰 ${BEFORE_WOOD_SPEC.decay * 1000}ms / Q ${BEFORE_WOOD_SPEC.q} / makeup ${BEFORE_WOOD_SPEC.makeup})`
      + `  ピーク ${before.peak.toFixed(4)} ±${before.peakSd.toFixed(4)}`);
    console.log(`  いまの木(${api.METRO_CLICK_SPEC.freq.accent}Hz / 減衰 ${api.METRO_CLICK_SPEC.decay * 1000}ms / Q ${api.METRO_CLICK_SPEC.q} / makeup ${cur})`
      + `  ピーク ${now.peak.toFixed(4)} ±${now.peakSd.toFixed(4)}`);
    console.log(`  → ピークがそろう makeup = **${want.toFixed(4)}**  (いま入っている ${cur} との比 ${(want / cur).toFixed(4)} 倍)`);
    console.log(`  参考: makeup を 4.50 / 4.53 / 4.55 にしたときのピーク = `
      + [4.50, 4.53, 4.55].map((m) => `${m}→${peakAt(m).toFixed(4)}`).join(" / "));
  } else {
    console.log(`${pad("accent", 14)}${pad("ピーク", 12)}${pad("(ばらつき)", 14)}エネルギー √(Σx²/SR)`);
    for (const [name, r] of [["変更前の木", before], ["いまの木", now]]) {
      console.log(`${pad(name, 14)}${pad(r.peak.toFixed(4), 12)}${pad("±" + r.peakSd.toFixed(4), 14)}${r.energy.toFixed(5)}`);
    }
    console.log(`\nピーク比(いま ÷ 変更前) = ${(now.peak / before.peak).toFixed(4)}`
      + `  / エネルギー比 = ${(now.energy / before.energy).toFixed(4)}`);
    console.log("  ※ エネルギーは減衰を 30ms → 18ms に詰めたぶん減る(狙いどおり)。");
    console.log("  ※ **高くなったか・鋭くなったかは、この数値では判定できない**(実機で本人が聴く)。");

    // 3段(accent / beat / sub)が実際に鳴ったときのピーク比。
    // **ゲインの段の比(1.0 / 0.85 / 0.6)そのものではない** ── 段ごとに中心周波数が違い、
    // 帯域幅も変わるので、そのぶんが掛かった「耳に届く側」の比になる。
    console.log("\n3段の**鳴った波形の**ピーク比(accent を 1。段の音量 × 帯域幅の違い)");
    for (const [name, render] of [["変更前の木", renderBefore], ["いまの木", renderClick]]) {
      const p = ["accent", "beat", "sub"].map((k) => meanOver(render, k, DRAWS).peak);
      console.log(`  ${pad(name, 14)}1 : ${(p[1] / p[0]).toFixed(3)} : ${(p[2] / p[0]).toFixed(3)}`);
    }
  }
}
