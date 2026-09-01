// メトロノームのクリック音4種の **ピークとエネルギー** を計算で出す。
//
// なぜ要るか(D-24a 指摘6):
//   D-24 の完了記録は makeup(振幅の戻し)の根拠として 8 個の数値を載せているが、
//   「Node で RBJ 係数を再現して計算した」とあるだけで**スクリプトが残っていなかった**。
//   次に触る人がその 8 個を検証も更新もできない(罠7: 測っていない数値を書かない)。
//
// この計算の入力は **src/App.jsx だけ**。
//   ・METRO_CLICK_SPECS / METRO_CLICK_VOL / getMetroClickBuffer / scheduleMetroClick /
//     scheduleMetroClickAlt をソースから取り出してそのまま動かす
//   ・値をここへ書き写さない(罠3: 実装と同じ式を書き直した検算は恒真になる)
//   ・実装が実際に組み立てた graph(何を作り・どの値を設定し・どこへ繋いだか)を
//     読んで、その通りにオフラインで信号を作る
//
// 何を測っているか / 測っていないか:
//   ・測っているのは **マスターチェーンに入る直前**の1回ぶんの波形。
//     リミッター(閾値-3dB・比20)と masterGain 2.6 は通していない(仕様 §1.5 で触らない所)。
//   ・**実機で聴いた音ではない。** 端末・出力ルート(受話口/スピーカー)で聴感は変わる。
//   ・雑音の3種(現行・木・鋭い)は Math.random に依存するので、**種を固定した疑似乱数で
//     多数回引いて平均**する(1回の引きでは ±数%ばらつく)。電子は正弦波なので決定的。
//
// 使い方: node scripts/metro-click-makeup.mjs [--draws 1000]
import { readFileSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

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
  extractConst("METRO_CLICK_SOUNDS"),
  extractConst("METRO_CLICK_VOL"),
  extractConst("METRO_CLICK_SPECS"),
  extractFunction("metroClickSoundId"),
  extractFunction("getMetroClickBuffer"),
  extractFunction("getMetroMasterInput"),
  extractFunction("scheduleMetroClickAlt"),
  extractFunction("scheduleMetroClick"),
].join("\n\n")}
  return { METRO_CLICK_SOUNDS, METRO_CLICK_SPECS, scheduleMetroClick };`)();

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
    const nd = { kind, id: nodes.length, out: null, events: [], startAt: null, stopAt: null };
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
      nd.start = (t) => { nd.startAt = t; };
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
export function renderClick(id, kind, rand) {
  const ctx = makeGraphCtx();
  const origRandom = Math.random;
  Math.random = rand;
  try { api.scheduleMetroClick(ctx, 0, kind, id); } finally { Math.random = origRandom; }

  const source = ctx.nodes.find((n) => n.kind === "source" || n.kind === "osc");
  if (!source) throw new Error(`${id}/${kind}: 音源が見つからない`);
  // 【D-24b】**start() されていない音源は1サンプルも鳴らない。**
  // ここを持たずに `source.buffer` を無条件で読み `(source.startAt || 0)` で 0 扱いすると、
  // `src.start(t);` / `osc.start(t);` を消した(= その音が**完全に無音**になる)実装を
  // **満額の波形**として描いてしまう。作り物のモデルが本物より甘いと、この波形を読む
  // 検査(43.1 の makeup)が嘘をつく。長さ 0 の波形はピークもエネルギーも 0 になる。
  if (source.startAt === null) return new Float64Array(0);
  // 音源が動いている長さ: stop() があればそこまで、無ければバッファの最後まで
  const dur = source.stopAt !== null ? source.stopAt - source.startAt
    : source.buffer.duration;
  const n = Math.round(dur * SAMPLE_RATE);

  let x = new Float64Array(n);
  if (source.kind === "source") {
    const d = source.buffer.getChannelData(0);
    for (let i = 0; i < n; i++) x[i] = d[i] || 0;
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
  // `gain.connect(getMetroMasterInput(ctx))` を消す / 向きを逆にする(= 3種が完全な無音)を
  // 素通りさせていた。startAt の番人(上)を足したときに、**その隣の同じ型の甘さ**を見落とした。
  // 罠19: 作り物は「本物ができないことをできてはいけない」。繋がっていない音は鳴らない。
  if (!node) return new Float64Array(0);   // マスターに届かない鎖はどこへも出ない = 無音
  return x;
}

export function peakOf(x) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m; }
export function energyOf(x) { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / SAMPLE_RATE); }

// ---- 実行(このファイルを直接動かしたときだけ。検査ハーネスからは renderClick を使う) -----------------------------------------------------------------

// 検査43.1 はこのファイルの renderClick を読み込んで makeup が効いていることを見る。
// import しただけで表が出ないよう、報告は直接起動したときだけに閉じる。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ids = api.METRO_CLICK_SOUNDS.map((s) => s.id);
  // 雑音を使う音だけ多数回引く。正弦波(電子)は決定的なので1回で足りる。
  const usesNoise = (id) => {
    const sp = api.METRO_CLICK_SPECS[id];
    return !sp || sp.src === "noise"; // 現行(表に無い)は雑音
  };

  console.log(`サンプリング周波数 ${SAMPLE_RATE}Hz / 雑音の引き直し ${DRAWS}回(種は固定)`);
  console.log("測っているのは **マスターチェーンに入る直前**の1回ぶん(リミッターと gain 2.6 は通していない)\n");

  const rows = [];
  for (const id of ids) {
    const draws = usesNoise(id) ? DRAWS : 1;
    const peaks = [], energies = [];
    for (let k = 0; k < draws; k++) {
      const x = renderClick(id, "accent", mulberry32(0x9e3779b9 + k));
      peaks.push(peakOf(x));
      energies.push(energyOf(x));
    }
    const mean = (a) => a.reduce((p, c) => p + c, 0) / a.length;
    const sd = (a) => {
      if (a.length < 2) return 0;
      const m = mean(a);
      return Math.sqrt(a.reduce((p, c) => p + (c - m) ** 2, 0) / a.length);
    };
    rows.push({ id, peak: mean(peaks), peakSd: sd(peaks), energy: mean(energies), energySd: sd(energies) });
  }

  const pad = (s, w) => String(s).padEnd(w);
  console.log(`${pad("accent", 10)}${pad("ピーク", 12)}${pad("(ばらつき)", 14)}${pad("エネルギー √(Σx²/SR)", 24)}(ばらつき)`);
  for (const r of rows) {
    console.log(`${pad(r.id, 10)}${pad(r.peak.toFixed(3), 12)}${pad("±" + r.peakSd.toFixed(3), 14)}`
      + `${pad(r.energy.toFixed(5), 24)}±${r.energySd.toFixed(5)}`);
  }

  // 3段(accent / beat / sub)が実際に鳴ったときのピーク比。
  // **ゲインの段の比(1.0 / 0.85 / 0.6)そのものではない** ── 段ごとに中心周波数が違い、
  // 雑音の3種は帯域幅も変わるので、そのぶんが掛かった「耳に届く側」の比になる。
  // ゲインの段が 1.0 / 0.85 / 0.6 のままであることは検査43.1 が graph から見ている。
  console.log("\n3段の**鳴った波形の**ピーク比(accent を 1。段の音量 × 帯域幅の違い)");
  for (const id of ids) {
    const draws = usesNoise(id) ? DRAWS : 1;
    const p = ["accent", "beat", "sub"].map((k) => {
      let s = 0;
      for (let i = 0; i < draws; i++) s += peakOf(renderClick(id, k, mulberry32(0x9e3779b9 + i)));
      return s / draws;
    });
    console.log(`  ${pad(id, 10)}1 : ${(p[1] / p[0]).toFixed(3)} : ${(p[2] / p[0]).toFixed(3)}`);
  }

}