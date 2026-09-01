// 【D-25】**変更前の木の音**(本番 5ab5206)を、そのまま動かせる形で凍らせたもの。
//
// なぜ要るか(罠16: 「変わっていない」「狙いどおりの差だけ」を主張するなら**変更前を測る**):
//   D-25 は木の音を「もう少し高く・鋭く」変える。変わったのが本当に
//   周波数・減衰・makeup の3つだけなのかは、**変更前を実際に駆動して**比べないと言えない。
//   定数を書き写した期待値(2100/1500 = 1.4 など)では、実装の言い換えにしかならない(罠3)。
//
// 出どころ: `git show 5ab5206:src/App.jsx` から
//   METRO_CLICK_VOL / METRO_CLICK_SPECS の wood / getMetroClickBuffer /
//   getMetroMasterInput / scheduleMetroClickAlt
// を**逐語で**写した(electro・tick は D-25 で削除されたので写していない)。
// **ここは「昔のコードの標本」なので、直さない。** 現行の実装に合わせて書き換えたら、
// 比較対象そのものが消える(D-9 でやった「退行を従来として固定する」型の事故になる)。

const METRO_CLICK_VOL = { accent: 1.0, beat: 0.85, sub: 0.6 };

const METRO_CLICK_SPECS = {
  // 【木】本物のメトロノームに近い、芯のあるコツッという音。
  // Q を 1.6 → 8 に上げて雑音を狭帯域に絞ると音程感が立ち、減衰を 60ms → 30ms に詰めると
  // 尾を引かない「コッ」になる。Q を5倍・中心周波数を下げたぶん通過帯域幅が約 1/5 になるので、
  // 失う振幅を makeup 5.0 で戻す(計算値: accent のピークが現行 0.354 に対し 0.349)。
  wood: { src: "noise", filter: "bandpass", q: 8, decay: 0.030, makeup: 5.0,
    freq: { accent: 1500, beat: 1100, sub: 850 } },
};

function getMetroClickBuffer(ctx) {
  if (ctx.__metroClickBuffer) return ctx.__metroClickBuffer;
  const dur = 0.06;
  const n = Math.ceil(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const decay = Math.exp(-i / (n * 0.15));
    data[i] = (Math.random() * 2 - 1) * decay;
  }
  ctx.__metroClickBuffer = buffer;
  return buffer;
}

function getMetroMasterInput(ctx) {
  if (ctx.__metroMasterInput) return ctx.__metroMasterInput;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.05;
  const master = ctx.createGain();
  master.gain.value = 2.6; // マイク有効時の小音量を補うブースト。リミッターが歪みを抑える
  limiter.connect(master);
  master.connect(ctx.destination);
  ctx.__metroMasterInput = limiter;
  return limiter;
}

function scheduleMetroClickAlt(ctx, t, kind, id) {
  const spec = METRO_CLICK_SPECS[id];
  if (!spec) return;
  const step = METRO_CLICK_VOL[kind] ?? METRO_CLICK_VOL.sub;
  const f = spec.freq[kind] ?? spec.freq.sub;
  const vol = step * spec.makeup;
  const gain = ctx.createGain();
  if (spec.src === "tone") {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    // 0 から指数で立ち上げられないので 0.0001 から。attack のあとに同じ形で落とす。
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + spec.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + spec.attack + spec.decay);
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + spec.attack + spec.decay); // 明示的に止める(発振器は自分では終わらない)
  } else {
    const src = ctx.createBufferSource();
    src.buffer = getMetroClickBuffer(ctx);
    const filt = ctx.createBiquadFilter();
    filt.type = spec.filter;
    filt.frequency.value = f;
    filt.Q.value = spec.q;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + spec.decay);
    src.connect(filt);
    filt.connect(gain);
    src.start(t); // バッファ音源は末尾で自分で終わる
  }
  gain.connect(getMetroMasterInput(ctx));
}

// 変更前の木を1回ぶん予約する。呼び手は現行の scheduleMetroClick と同じ (ctx, t, kind)。
export function scheduleBeforeWood(ctx, t, kind) {
  scheduleMetroClickAlt(ctx, t, kind, "wood");
}
// 変更前の表そのもの(比較のときに「何を狙って動かしたか」の左右を分けるために出す)。
export const BEFORE_WOOD_SPEC = METRO_CLICK_SPECS.wood;
export const BEFORE_VOL = METRO_CLICK_VOL;
