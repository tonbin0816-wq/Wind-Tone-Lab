import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// このファイルの隣へ書き出す(前は Linux の絶対パスが埋まっていて、他の環境で動かなかった)。
const OUT = fileURLToPath(new URL("./", import.meta.url));
// 【D-9 2026/08/25】Main / Windows は**本人がキャンバス上で直接いじった**ものが正になった。
// 既定では上書きしない。D-8 当時の写しを作り直したいときだけ --regen-baseline を付ける。
const REGEN_BASELINE = process.argv.includes("--regen-baseline");
const guard = (name) => REGEN_BASELINE || !["Main.dc.html", "Windows.dc.html"].includes(name);
// 【D-9】この下の Main / Windows は D-8 当時の写し。ファイルの末尾で D-9 版が上書きする。

// ---- src/App.jsx から写した定数 ----------------------------------------
const NOTE_NAMES = ["C","C♯","D","E♭","E","F","F♯","G","G♯","A","B♭","B"];
const LOW_MIDI = 49, HIGH_MIDI = 85, ALTISSIMO = 4;      // alto
const N = (HIGH_MIDI - LOW_MIDI + 1) - ALTISSIMO;        // 33
const SVG_FS_XS = 12, SVG_SP1 = 4, SVG_SP2 = 8;
const W = 347;                                            // 375 - --page-side-pad*2
const PLOT_H = 94, PAD_TOP = SVG_SP2;
const RING_IN_TUNE_CENTS = 2;
const CHART_OK_BAND_OPACITY = 0.28;
const MATRIX_CELL_H = 32, MATRIX_GRID_GAP = 1, DIVERGING_STEPS = 8;

const labelOf = (i) => {
  const midi = LOW_MIDI + i;
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
};
const LABELS = Array.from({ length: N }, (_, i) => labelOf(i));

// measureSvgTextPx が実測する送り幅の代わり。system font 12px の実測に近い係数。
const textPx = (s, fs = SVG_FS_XS) => {
  let w = 0;
  for (const ch of String(s)) w += /[0-9]/.test(ch) ? fs * 0.556 : /[♯♭]/.test(ch) ? fs * 0.60 : fs * 0.667;
  return w;
};

const formatSignedCents = (v) => {
  const t = v.toFixed(1);
  if (t === "0.0" || t === "-0.0") return "0.0";
  return v > 0 ? `+${t}` : t;
};
const roundInt = (v) => Math.round(v).toString();

// ---- NoteAxisLineChart の L( ) をそのまま再現 ---------------------------
// 【D-9u 2026/08/25 本人指示】「平均差分以外はその項目の平均を中央線にして同様に」
//   ・平均差分 … 中央線 = 0（従来どおり）
//   ・HNR / 重心 / 音量 … 中央線 = **その指標で描いている全値の平均**
// どちらも中央線をまん中に置いて上下対称のドメインにする（＝「同様に」）。
// こうすると上下の目盛線が無くても、中央線1本が基準として必ず残る。
function layout({ vals, zeroCentered, fmt, refVals, plotH = PLOT_H, meanCentered = false, width = W }) {
  const all = [...vals.flat().filter((v) => v !== null), ...(refVals ? refVals.filter((v) => v !== null) : [])];
  let lo, hi, center;
  if (zeroCentered) { center = 0; hi = Math.max(...all.map(Math.abs)) || 1; lo = -hi; }
  else if (meanCentered) {
    center = all.reduce((a, v) => a + v, 0) / all.length;
    const dev = Math.max(...all.map((v) => Math.abs(v - center))) || 1;
    hi = center + dev; lo = center - dev;
  }
  else {
    center = null;
    const mn = Math.min(...all), mx = Math.max(...all);
    const pad = (mx - mn) * 0.12 || Math.abs(mx) * 0.1 || 1;
    lo = mn - pad; hi = mx + pad;
  }
  const rng = hi - lo || 1;
  const FS = SVG_FS_XS;
  const tickVals = [hi, (hi + lo) / 2, lo];
  const tickTexts = tickVals.map(fmt);
  const maxLblW = Math.ceil(Math.max(...LABELS.map((s) => textPx(s))));
  const halfLbl = Math.ceil(maxLblW / 2) + SVG_SP1;
  const x0 = SVG_SP2 + halfLbl;                    // axisOverlay → AXW = 0
  const x1 = Math.max(x0 + 1, width - SVG_SP2 - halfLbl);
  const colStep = (x1 - x0) / (N - 1);
  const need = maxLblW + SVG_SP2;
  const labelStep = [1, 2, 3, 4, 6, 12].find((s) => s * colStep >= need) ?? 12;
  const ebIdx = LABELS.map((nm, i) => (nm.startsWith("E♭") ? i : -1)).filter((i) => i >= 0);
  const axisCenter = (N - 1) / 2;
  const midEb = ebIdx.reduce((b, i) => (Math.abs(i - axisCenter) < Math.abs(b - axisCenter) ? i : b), ebIdx[0]);
  const dotR = Math.max(1.5, Math.min(3, colStep * 0.3));
  const labelY = PAD_TOP + plotH + SVG_SP2 + Math.round(FS * 0.8);
  const yAt = (v) => PAD_TOP + plotH - ((v - lo) / rng) * plotH;
  return {
    lo, hi, center, FS, plotH, tickVals, tickTexts, dotR, labelY, midEb, labelStep,
    H: labelY + SVG_SP1,
    xAt: (i) => x0 + i * colStep,
    yAt,
    showLabel: (i) => (((i - midEb) % labelStep) + labelStep) % labelStep === 0,
    tickX: SVG_SP2,
    tickTextY: (v) => Math.max(Math.round(FS * 0.85), yAt(v) - SVG_SP1),
  };
}

const segsOf = (byIdx, L) => {
  const segs = []; let cur = [];
  for (let i = 0; i < N; i++) {
    const v = byIdx[i];
    if (v === null || v === undefined) { if (cur.length) segs.push(cur); cur = []; continue; }
    cur.push([L.xAt(i), L.yAt(v)]);
  }
  if (cur.length) segs.push(cur);
  return segs;
};
const r2 = (n) => Math.round(n * 100) / 100;

function chartSvg({ series, L, zeroCentered, bandAbs, refVals, edgeGridLines = true, width = W }) {
  const p = [];
  const W2 = width;
  p.push(`<svg width="${W2}" height="${L.H}" viewBox="0 0 ${W2} ${L.H}" style="display: block">`);
  if (zeroCentered && bandAbs > 0) {
    const yTop = L.yAt(Math.min(bandAbs, L.hi)), yBot = L.yAt(Math.max(-bandAbs, L.lo));
    p.push(`<rect x="0" y="${r2(yTop)}" width="${W2}" height="${r2(yBot - yTop)}" stroke="none" style="fill: var(--c-quiet); opacity: ${CHART_OK_BAND_OPACITY}" />`);
  }
  if (edgeGridLines) {
    for (const v of L.tickVals) {
      p.push(`<line x1="0" y1="${r2(L.yAt(v))}" x2="${W2}" y2="${r2(L.yAt(v))}" stroke-width="1" style="stroke: var(--c-line)" />`);
    }
  }
  // 【D-9u】中央線は1本だけ。平均差分は 0、他3指標はその指標の平均
  if (L.center !== null && L.center !== undefined) {
    p.push(`<line x1="0" y1="${r2(L.yAt(L.center))}" x2="${W2}" y2="${r2(L.yAt(L.center))}" stroke-width="1" style="stroke: var(--c-line-strong)" />`);
  }
  p.push(`<line x1="${r2(L.xAt(L.midEb))}" y1="${PAD_TOP}" x2="${r2(L.xAt(L.midEb))}" y2="${PAD_TOP + L.plotH}" stroke-width="1" style="stroke: var(--c-line)" />`);
  // 目盛の文字は折れ線の上・白い縁つき(D-8 の axisOverlay)
  for (let k = 0; k < L.tickVals.length; k++) {
    p.push(`<text x="${L.tickX}" y="${r2(L.tickTextY(L.tickVals[k]))}" font-size="${L.FS}" text-anchor="start" font-family="var(--font-num)" style="fill: var(--c-ink-3); paint-order: stroke; stroke: var(--c-surface); stroke-width: 3px; stroke-linejoin: round">${L.tickTexts[k]}</text>`);
  }
  if (refVals) {
    for (const seg of segsOf(refVals, L)) {
      p.push(`<polyline fill="none" points="${seg.map(([x, y]) => `${r2(x)},${r2(y)}`).join(" ")}" stroke-width="2" stroke-dasharray="4 3" stroke-linejoin="round" stroke-linecap="round" style="stroke: var(--c-ink-3)" />`);
    }
  }
  for (const s of series) {
    for (const seg of segsOf(s.byIdx, L)) {
      p.push(`<polyline fill="none" points="${seg.map(([x, y]) => `${r2(x)},${r2(y)}`).join(" ")}" stroke-width="${s.width}" stroke-linejoin="round" stroke-linecap="round" style="stroke: ${s.color}" />`);
    }
    for (let i = 0; i < N; i++) {
      const v = s.byIdx[i];
      if (v === null || v === undefined) continue;
      p.push(`<circle cx="${r2(L.xAt(i))}" cy="${r2(L.yAt(v))}" r="${r2(L.dotR)}" style="fill: ${s.color}" />`);
    }
  }
  for (let i = 0; i < N; i++) {
    if (!L.showLabel(i)) continue;
    const isEb = i === L.midEb;
    p.push(`<text x="${r2(L.xAt(i))}" y="${L.labelY}" font-size="${L.FS}" font-weight="${isEb ? 700 : 400}" text-anchor="middle" font-family="var(--font-num)" style="fill: ${isEb ? "var(--c-accent)" : "var(--c-ink-3)"}">${LABELS[i]}</text>`);
  }
  p.push(`</svg>`);
  return p.join("\n          ");
}

// ---- 画面の骨格 ---------------------------------------------------------
const TOKENS = `
    :root {
      --font-jp: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "BIZ UDPGothic", "Noto Sans JP", sans-serif;
      --font-num: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      --fs-xs: 12px; --fs-sm: 13px; --fs-md: 15px; --fs-lg: 18px; --fs-xl: 22px;
      --r-xs: 4px; --r-sm: 8px;
      --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
      --tap-min: 44px;
      --c-bg: #FFFFFF; --c-surface: #FFFFFF; --c-sunk: #F6F7F9;
      --c-rule: #E1E6EC; --c-ink: #121F32; --c-ink-2: #435266; --c-ink-3: #8D95A1;
      --c-line: #E9ECF0; --c-line-strong: #C3CAD3;
      --c-accent: #174585; --c-accent-mid: #7FA0CE; --c-accent-line: #B9C9E4;
      --c-on-accent: #FFFFFF;
      --c-div-1: #43719F; --c-div-2: #658BB1; --c-div-3: #89A6C3; --c-div-4: #B3C6D9;
      --c-div-5: #E2D0A3; --c-div-6: #D1B570; --c-div-7: #C39F45; --c-div-8: #B5891C;
      --c-quiet: #C7CFD9;
      /* 【2026/08/26】モックの中で var() は書かれていたのに**未定義だった**4つを足した。
         未定義のカスタムプロパティは transparent 扱いになるので、カレンダーの
         薄い段(--c-accent-tint)が消えていた。値は src/index.css から写している。 */
      --fs-2xl: 28px; --fs-hero: 46px;
      --c-ink-4: #A6AEBA; --c-accent-tint: #EAEFF5; --c-danger: #DC2626;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { margin: 0; background: var(--c-bg); font-family: var(--font-jp); font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; }
    a { color: var(--c-accent); } a:hover { color: #123A70; }`;

// 子タブ行(SubTabs): marginLeft -9 / marginBottom 4 / 文字 22 と 15
function subTabRow() {
  return `<div style="display: flex; align-items: center; gap: 0; margin-left: -9px; margin-bottom: 4px">
        <div style="min-height: 44px; padding: 0 9px; display: flex; align-items: center; font-size: 22px; color: var(--c-ink); font-weight: 600; line-height: 1.2">My Data</div>
        <div style="min-height: 44px; padding: 0 9px; display: flex; align-items: center; font-size: 15px; color: var(--c-ink-3); font-weight: 400; line-height: 1.2">分析</div>
        <div style="margin-left: auto; display: flex; align-items: center">
          <div style="min-height: 44px; display: inline-flex; align-items: center; justify-content: flex-end; font-size: 12px; color: var(--c-ink-3)">Alto ▾</div>
          <span style="font-size: 12px; color: var(--c-ink-3); white-space: pre"> · </span>
          <div style="min-height: 44px; display: inline-flex; align-items: center; justify-content: flex-end; font-size: 12px; color: var(--c-ink-3)">1ヶ月 ▾</div>
        </div>
      </div>`;
}

// 指標タブ(MetricUnderlineTabs bordered): marginLeft -8 / 下辺に罫 / 文字 13
function metricTabs(sel) {
  const items = ["平均差分", "HNR", "重心", "音量"];
  return `<div style="display: flex; gap: 0; margin-left: -8px; border-bottom: 1px solid var(--c-line)">
${items.map((t) => `          <div style="min-height: 44px; padding: 0 8px; display: inline-flex; align-items: center; justify-content: center">
            <span style="display: inline-flex; align-items: center; min-height: 26px; padding: 0 2px; font-size: 13px; font-weight: 600; color: ${t === sel ? "var(--c-ink)" : "var(--c-ink-3)"};${t === sel ? " box-shadow: inset 0 -2px 0 0 var(--c-ink);" : ""}">${t}</span>
          </div>`).join("\n")}
        </div>`;
}

// 比較対象チップ + 見せ方の切替: 行の高さ 52px(チップ 44 + 下 8)
function compareRow(chips, sel, view) {
  const icon = (kind, on) => kind === "line"
    ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${on ? "var(--c-accent)" : "var(--c-ink-3)"}" stroke-width="${on ? 2.2 : 1.8}" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>`
    : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${on ? "var(--c-accent)" : "var(--c-ink-3)"}" stroke-width="${on ? 2.2 : 1.8}" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" /></svg>`;
  return `<div style="display: flex; align-items: center; gap: 9px; padding: 0 0 8px">
          <div style="display: flex; gap: 4px; min-width: 0; flex-wrap: wrap">
${chips.map((c) => `            <div style="min-height: 44px; display: inline-flex; align-items: center; padding: 0 13px; font-size: 12px; font-weight: 600; background: transparent; border: 1px solid ${c === sel ? "var(--c-accent)" : "var(--c-line-strong)"}; border-radius: 8px; color: ${c === sel ? "var(--c-accent)" : "var(--c-ink-2)"}">${c}</div>`).join("\n")}
          </div>
          <div style="display: flex; gap: 2px; margin-left: auto; flex-shrink: 0">
            <div style="min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center">${icon("line", view === "line")}</div>
            <div style="min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center">${icon("matrix", view === "matrix")}</div>
          </div>
        </div>`;
}

function legendRow(series, ref) {
  const items = series.map((s) => `          <span style="display: inline-flex; align-items: center; gap: 5px"><span style="width: 14px; height: 3px; border-radius: 2px; flex-shrink: 0; background: ${s.color}"></span>${s.label}</span>`);
  if (ref) items.push(`          <span style="display: inline-flex; align-items: center; gap: 5px"><span style="width: 14px; height: 2px; flex-shrink: 0; background-image: repeating-linear-gradient(90deg, var(--c-ink-3) 0 5px, transparent 5px 9px)"></span>${ref}</span>`);
  return `<div style="display: flex; flex-wrap: wrap; gap: 12px; font-size: 10.5px; color: var(--c-ink-2); margin-bottom: 5px">
${items.join("\n")}
        </div>`;
}

function page(inner) {
  return `<div style="width: 375px; background: var(--c-bg); padding: 0 14px; box-sizing: border-box">
      ${subTabRow()}
      <div style="padding: 16px 0; background: transparent; border: 0; border-radius: 0">
        ${inner}
      </div>
    </div>`;
}

function dcFile(body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>${TOKENS}
  </style>
</helmet>
${body}
</x-dc>
</body>
</html>
`;
}

// ---- データ(見た目を確かめるための値。実データではない) -----------------
const mk = (arr) => { const o = {}; arr.forEach((v, i) => { o[i] = v; }); return o; };
const pitchDay = mk([ -8.4,-6.1,-4.8,null,-3.2,-1.9,-0.6,0.8,1.4,2.6,3.1,1.8,0.4,-1.1,-2.4,-3.6,-2.8,-1.2,0.6,2.1,3.8,5.2,6.4,7.1,6.2,4.8,3.1,1.4,-0.8,-2.6,-4.9,-6.8,null ]);
const pitchPeriod = mk([ -5.2,-4.4,-3.6,-2.9,-2.1,-1.4,-0.7,0.2,0.9,1.6,2.0,1.5,0.6,-0.4,-1.3,-2.0,-1.6,-0.7,0.4,1.5,2.6,3.4,4.1,4.5,3.9,3.0,1.9,0.8,-0.5,-1.7,-3.2,-4.4,-5.1 ]);
const cenDay = mk([ 690,760,840,null,930,1010,1090,1180,1260,1340,1420,1490,1560,1640,1710,1790,1860,1940,2010,2090,2160,2230,2290,2320,2270,2190,2100,2010,1900,1780,1650,1520,null ]);
const cenPeriod = mk([ 640,700,780,850,920,990,1060,1140,1210,1280,1350,1410,1480,1550,1610,1680,1740,1810,1870,1930,1990,2040,2090,2120,2080,2010,1940,1860,1770,1670,1560,1450,1340 ]);
const cenRef = mk([ 880,960,1040,1120,1200,1280,1360,1440,1520,1600,1670,1740,1810,1880,1950,2010,2070,2130,2190,2250,2300,2350,2400,2430,2400,2340,2270,2190,2100,2000,1890,1780,1670 ]);

// ---- Main.dc.html : 平均差分 × 折れ線(0中心 + 帯) ------------------------
{
  const series = [
    { id: "day", label: "8/24", color: "var(--c-accent)", width: 2, byIdx: pitchDay },
    { id: "period", label: "1ヶ月の平均", color: "var(--c-accent-mid)", width: 2, byIdx: pitchPeriod },
  ];
  const L = layout({ vals: series.map((s) => Object.values(s.byIdx)), zeroCentered: true, fmt: formatSignedCents });
  const body = page([
    metricTabs("平均差分"),
    compareRow(["自分の平均", "目安", "±0"], "±0", "line"),
    legendRow(series, null),
    `<div>
          ${chartSvg({ series, L, zeroCentered: true, bandAbs: RING_IN_TUNE_CENTS })}
        </div>`,
  ].join("\n        "));
  if (guard("Main.dc.html")) writeFileSync(OUT + "Main.dc.html", dcFile(body)); else console.log("skip Main.dc.html (本人の修正が正)");
  console.log("Main   H=" + L.H + " ticks=" + L.tickTexts.join("/") + " labelStep=" + L.labelStep + " midEb=" + L.midEb);
}

// ---- Centroid.dc.html : 重心 × 折れ線(実数 + 破線) ----------------------
{
  const series = [
    { id: "day", label: "8/24", color: "var(--c-accent)", width: 2, byIdx: cenDay },
    { id: "period", label: "1ヶ月の平均", color: "var(--c-accent-mid)", width: 2, byIdx: cenPeriod },
  ];
  const L = layout({ vals: series.map((s) => Object.values(s.byIdx)), zeroCentered: false, fmt: roundInt, refVals: Object.values(cenRef) });
  const body = page([
    metricTabs("重心"),
    compareRow(["自分の平均", "目安"], "目安", "line"),
    legendRow(series, "目安"),
    `<div>
          ${chartSvg({ series, L, zeroCentered: false, refVals: cenRef })}
        </div>`,
  ].join("\n        "));
  writeFileSync(OUT + "Centroid.dc.html", dcFile(body));
  console.log("Centroid H=" + L.H + " ticks=" + L.tickTexts.join("/"));
}

// ---- Windows.dc.html : 平均差分 × 窓型(8段の発散スケール + 帯の灰) ------
const matrixCellText = (v) => { const r = Math.round(v); return r > 0 ? "+" + r : String(r); };
const divergingStep = (v, maxAbs) => {
  if (!(maxAbs > 0)) return v < 0 ? 4 : 5;
  const t = Math.max(-1, Math.min(1, v / maxAbs));
  return Math.max(0, Math.min(DIVERGING_STEPS - 1, Math.floor(((t + 1) / 2) * DIVERGING_STEPS))) + 1;
};
const divergingInk = (step) => (step === 1 ? "var(--c-on-accent)" : "var(--c-ink)");
const matrixNumFontSize = (texts) => {
  const L = Math.max(0, ...texts.map((t) => t.length));
  if (L <= 2) return 15; if (L === 3) return 13; if (L === 4) return 10; return 9;
};

function buildMatrix(byIdx) {
  const byKey = {}; const octaves = []; let min = null, max = null, count = 0;
  for (let i = 0; i < N; i++) {
    const v = byIdx[i];
    const midi = LOW_MIDI + i;
    const oct = Math.floor(midi / 12) - 1, pc = NOTE_NAMES[midi % 12];
    if (!octaves.includes(oct)) octaves.push(oct);
    if (v === null || v === undefined) continue;
    byKey[oct + ":" + pc] = v; count++;
    min = min === null ? v : Math.min(min, v);
    max = max === null ? v : Math.max(max, v);
  }
  octaves.sort((a, b) => b - a);
  return { octaves, byKey, min, max, maxAbs: min === null ? 0 : Math.max(Math.abs(min), Math.abs(max)), count };
}

function matrixBlock(title, sub, m) {
  const band = RING_IN_TUNE_CENTS;                    // 平均差分は絶対値の帯
  const texts = [];
  for (const oct of m.octaves) for (const pc of NOTE_NAMES) {
    const v = m.byKey[oct + ":" + pc];
    if (v === null || v === undefined) continue;
    texts.push(matrixCellText(v));
  }
  const numFs = matrixNumFontSize(texts);
  const rangeText = m.count === 0 ? "—" : matrixCellText(m.min) + " 〜 " + matrixCellText(m.max);
  const rows = m.octaves.map((oct) => {
    const cells = NOTE_NAMES.map((pc) => {
      const v = m.byKey[oct + ":" + pc];
      if (v === null || v === undefined) return `              <div style="height: ${MATRIX_CELL_H}px"></div>`;
      const label = matrixCellText(v);
      const n = Number(label);
      let bg, fg;
      if (Math.abs(n) <= band) { bg = "var(--c-sunk)"; fg = "var(--c-ink-3)"; }
      else { const st = divergingStep(n, m.maxAbs); bg = "var(--c-div-" + st + ")"; fg = divergingInk(st); }
      return `              <div style="height: ${MATRIX_CELL_H}px; border-radius: 4px; overflow: hidden; background: ${bg}; color: ${fg}; display: flex; align-items: center; justify-content: center; font-family: var(--font-num); font-weight: 600; font-size: ${numFs}px">${label}</div>`;
    }).join("\n");
    return `            <div style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: ${MATRIX_GRID_GAP}px; margin-bottom: ${MATRIX_GRID_GAP}px">
${cells}
            </div>`;
  }).join("\n");
  return `<div>
          <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding-bottom: 12px">
            <div style="min-width: 0">
              <div style="font-size: 12px; font-weight: 600; color: var(--c-ink)">${title}</div>
              <div style="font-size: 10px; color: var(--c-ink-3); margin-top: 2px">${sub}</div>
            </div>
            <span style="font-family: var(--font-num); font-size: 10px; color: var(--c-ink-3); flex-shrink: 0">${rangeText}</span>
          </div>
          <div style="display: flex; gap: 5px">
            <div style="width: 11px; flex-shrink: 0; display: flex; flex-direction: column; gap: ${MATRIX_GRID_GAP}px; padding-top: 14px">
${m.octaves.map((o) => `              <span style="height: ${MATRIX_CELL_H}px; display: flex; align-items: center; font-family: var(--font-num); font-size: 10px; color: var(--c-ink-3)">${o}</span>`).join("\n")}
            </div>
            <div style="flex: 1; min-width: 0">
              <div style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: ${MATRIX_GRID_GAP}px; margin-bottom: ${MATRIX_GRID_GAP}px">
${NOTE_NAMES.map((pc) => `                <span style="font-size: 10px; color: var(--c-ink-3); text-align: center; overflow: hidden">${pc}</span>`).join("\n")}
              </div>
${rows}
            </div>
          </div>
        </div>`;
}

{
  const upper = buildMatrix(pitchDay), lower = buildMatrix(pitchPeriod);
  const body = page([
    metricTabs("平均差分"),
    compareRow(["自分の平均", "目安", "±0"], "±0", "matrix"),
    matrixBlock("今日の自分", "8/24 − ±0", upper),
    `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--c-line)">
          ${matrixBlock("いつもの自分", "1ヶ月の平均 − ±0", lower)}
        </div>`,
  ].join("\n        "));
  if (guard("Windows.dc.html")) writeFileSync(OUT + "Windows.dc.html", dcFile(body)); else console.log("skip Windows.dc.html (本人の修正が正)");
  console.log("Windows octaves=" + upper.octaves.join(",") + " maxAbs=" + upper.maxAbs + " cells=" + upper.count);
}

// ========================================================================
// 改善案(2ページ目)。**まだ正典ではない**。本人が見て決めるための絵。
// ========================================================================

// ---- StackA.dc.html : 上部の積み上げを実寸で並べる ----------------------
{
  const blk = (h, label, fill, ink) =>
    `<div style="height: ${h}px; background: ${fill}; color: ${ink}; border-radius: 4px; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; font-size: 11px; font-weight: 600"><span>${label}</span><span style="font-family: var(--font-num); opacity: .75">${h}</span></div>`;
  const col = (title, blocks, total) => `<div style="width: 176px; flex-shrink: 0">
          <div style="font-size: 12px; font-weight: 600; color: var(--c-ink); margin-bottom: 8px">${title}</div>
          <div style="display: flex; flex-direction: column; gap: 2px">
${blocks.join("\n")}
          </div>
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--c-rule); font-size: 11px; color: var(--c-ink-3)">グラフの上端 <span style="font-family: var(--font-num); font-size: 13px; font-weight: 600; color: var(--c-ink)">y = ${total}</span></div>
        </div>`;
  const now = [
    blk(48, "子タブ", "var(--c-sunk)", "var(--c-ink-2)"),
    blk(16, "カードの上余白", "var(--c-line)", "var(--c-ink-3)"),
    blk(45, "指標タブ", "var(--c-sunk)", "var(--c-ink-2)"),
    blk(52, "比較対象 + 切替", "#FDE8E8", "#9B2C2C"),
    blk(19, "凡例", "var(--c-line)", "var(--c-ink-3)"),
  ];
  const plan = [
    blk(48, "子タブ", "var(--c-sunk)", "var(--c-ink-2)"),
    blk(16, "カードの上余白", "var(--c-line)", "var(--c-ink-3)"),
    blk(45, "指標タブ + 比較対象", "var(--c-accent-tint)", "var(--c-accent)"),
    blk(19, "凡例", "var(--c-line)", "var(--c-ink-3)"),
  ];
  const body = `<div style="width: 420px; background: var(--c-bg); padding: 16px 14px; box-sizing: border-box">
      <div style="font-size: 15px; font-weight: 600; color: var(--c-ink); margin-bottom: 4px">案A ─ 比較対象の行を畳む</div>
      <div style="font-size: 11px; color: var(--c-ink-3); margin-bottom: 16px; line-height: 1.5">375x812 の実測。実効ビューポートは 812 − ナビ47 − セーフエリア34 = <span style="font-family: var(--font-num)">731px</span>。<br>ブロックの高さは実寸。</div>
      <div style="display: flex; gap: 16px; align-items: flex-start">
        ${col("現状", now, 180)}
        ${col("案A", plan, 128)}
      </div>
      <div style="margin-top: 16px; padding: 10px 12px; background: var(--c-sunk); border-radius: 8px; font-size: 11px; color: var(--c-ink-2); line-height: 1.6">
        <span style="font-weight: 600; color: var(--c-ink)">−52px（実効ビューポートの 7%）。</span>データに触る前の割合は <span style="font-family: var(--font-num)">25% → 18%</span>。<br>
        44pt はチップの床なので、行を減らす以外に削る余地はもう無い。
      </div>
    </div>`;
  writeFileSync(OUT + "StackA.dc.html", dcFile(body));
  console.log("StackA  現状 y=180 / 案 y=128 / 差 52");
}

// ---- PlanA.dc.html : 案Aを実寸の画面で ---------------------------------
{
  const series = [
    { id: "day", label: "8/24", color: "var(--c-accent)", width: 2, byIdx: pitchDay },
    { id: "period", label: "1ヶ月の平均", color: "var(--c-accent-mid)", width: 2, byIdx: pitchPeriod },
  ];
  const L = layout({ vals: series.map((s) => Object.values(s.byIdx)), zeroCentered: true, fmt: formatSignedCents });
  const icon = (kind, on) => kind === "line"
    ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${on ? "var(--c-accent)" : "var(--c-ink-3)"}" stroke-width="${on ? 2.2 : 1.8}" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>`
    : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${on ? "var(--c-accent)" : "var(--c-ink-3)"}" stroke-width="${on ? 2.2 : 1.8}" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" /></svg>`;
  // 指標タブの行に、比較対象(既存の DataOptionSheet を開く「素のテキスト + ▾」)と切替を同居させる
  const mergedRow = `<div style="display: flex; align-items: center; gap: 0; margin-left: -8px; border-bottom: 1px solid var(--c-line)">
${["平均差分", "HNR", "重心", "音量"].map((t) => `          <div style="min-height: 44px; padding: 0 8px; display: inline-flex; align-items: center; justify-content: center">
            <span style="display: inline-flex; align-items: center; min-height: 26px; padding: 0 2px; font-size: 13px; font-weight: 600; color: ${t === "平均差分" ? "var(--c-ink)" : "var(--c-ink-3)"};${t === "平均差分" ? " box-shadow: inset 0 -2px 0 0 var(--c-ink);" : ""}">${t}</span>
          </div>`).join("\n")}
          <div style="margin-left: auto; display: flex; align-items: center; flex-shrink: 0">
            <div style="min-height: 44px; display: inline-flex; align-items: center; justify-content: flex-end; padding: 0 6px; font-size: 12px; font-weight: 600; color: var(--c-accent)">±0 ▾</div>
            <div style="min-height: 44px; min-width: 32px; display: inline-flex; align-items: center; justify-content: center">${icon("line", true)}</div>
            <div style="min-height: 44px; min-width: 32px; display: inline-flex; align-items: center; justify-content: center">${icon("matrix", false)}</div>
          </div>
        </div>`;
  const body = page([
    mergedRow,
    legendRow(series, null),
    `<div>
          ${chartSvg({ series, L, zeroCentered: true, bandAbs: RING_IN_TUNE_CENTS })}
        </div>`,
  ].join("\n        "));
  writeFileSync(OUT + "PlanA.dc.html", dcFile(body));
  console.log("PlanA   統合行を実寸で");
}

// ---- CompareB.dc.html : 子タブの非選択の濃さ ----------------------------
{
  const row = (inkClass) => `<div style="display: flex; align-items: center; gap: 0; margin-left: -9px">
          <div style="min-height: 44px; padding: 0 9px; display: flex; align-items: center; font-size: 22px; color: var(--c-ink); font-weight: 600; line-height: 1.2">My Data</div>
          <div style="min-height: 44px; padding: 0 9px; display: flex; align-items: center; font-size: 15px; color: ${inkClass}; font-weight: 400; line-height: 1.2">分析</div>
        </div>`;
  const one = (title, note, inkClass) => `<div>
          <div style="font-size: 12px; font-weight: 600; color: var(--c-ink); margin-bottom: 2px">${title}</div>
          <div style="font-size: 11px; color: var(--c-ink-3); margin-bottom: 4px; font-family: var(--font-num)">${note}</div>
          ${row(inkClass)}
        </div>`;
  const body = `<div style="width: 375px; background: var(--c-bg); padding: 16px 14px; box-sizing: border-box">
      <div style="font-size: 15px; font-weight: 600; color: var(--c-ink); margin-bottom: 4px">案B ─ 非選択の色を1段だけ戻す</div>
      <div style="font-size: 11px; color: var(--c-ink-3); margin-bottom: 16px; line-height: 1.5">大きさ(22→15)と太さ(600→400)の差はそのまま。<br>色だけ体系内で1段上げて、押せることを返す。</div>
      <div style="display: flex; flex-direction: column; gap: 16px">
        ${one("現状", "--c-ink-3  #8D95A1", "var(--c-ink-3)")}
        ${one("案B", "--c-ink-2  #435266", "var(--c-ink-2)")}
      </div>
      <div style="margin-top: 16px; padding: 10px 12px; background: var(--c-sunk); border-radius: 8px; font-size: 11px; color: var(--c-ink-2); line-height: 1.6">
        白地とのコントラスト比 <span style="font-family: var(--font-num)">3.02:1 → 7.96:1</span>。<br>
        新しい値は要らない（どちらも既にある段）。変更は1行。
      </div>
    </div>`;
  writeFileSync(OUT + "CompareB.dc.html", dcFile(body));
  console.log("CompareB 子タブ非選択 --c-ink-3 → --c-ink-2");
}

// ---- PlanD.dc.html : 窓型の空セルを2つに分ける -------------------------
{
  // 【罠】HIGH_MIDI(85)はフラジオ込みの上端。My Data の軸は includeAltissimo=false なので
  // 上端は LOW_MIDI + N - 1 = 81。HIGH_MIDI で判定すると B♭5 / B5 が「音域内」になる。
  const AXIS_HIGH_MIDI = LOW_MIDI + N - 1;
  const inRange = (oct, pcIdx) => { const midi = (oct + 1) * 12 + pcIdx; return midi >= LOW_MIDI && midi <= AXIS_HIGH_MIDI; };
  const m = buildMatrix(pitchDay);
  const band = RING_IN_TUNE_CENTS;
  const texts = [];
  for (const oct of m.octaves) for (const pc of NOTE_NAMES) {
    const v = m.byKey[oct + ":" + pc];
    if (v === null || v === undefined) continue;
    texts.push(matrixCellText(v));
  }
  const numFs = matrixNumFontSize(texts);
  const rows = m.octaves.map((oct) => {
    const cells = NOTE_NAMES.map((pc, pi) => {
      const v = m.byKey[oct + ":" + pc];
      if (v === null || v === undefined) {
        // 【案D】音域外 = 何も描かない / 音域内でデータ無し = --c-line の枠だけ
        return inRange(oct, pi)
          ? `              <div style="height: ${MATRIX_CELL_H}px; border-radius: 4px; border: 1px solid var(--c-line)"></div>`
          : `              <div style="height: ${MATRIX_CELL_H}px"></div>`;
      }
      const label = matrixCellText(v);
      const n = Number(label);
      let bg, fg;
      if (Math.abs(n) <= band) { bg = "var(--c-sunk)"; fg = "var(--c-ink-3)"; }
      else { const st = divergingStep(n, m.maxAbs); bg = "var(--c-div-" + st + ")"; fg = divergingInk(st); }
      return `              <div style="height: ${MATRIX_CELL_H}px; border-radius: 4px; overflow: hidden; background: ${bg}; color: ${fg}; display: flex; align-items: center; justify-content: center; font-family: var(--font-num); font-weight: 600; font-size: ${numFs}px">${label}</div>`;
    }).join("\n");
    return `            <div style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: ${MATRIX_GRID_GAP}px; margin-bottom: ${MATRIX_GRID_GAP}px">
${cells}
            </div>`;
  }).join("\n");
  const swatch = (style, label) => `          <span style="display: inline-flex; align-items: center; gap: 6px"><span style="width: 20px; height: 14px; border-radius: 3px; flex-shrink: 0; ${style}"></span>${label}</span>`;
  const body = `<div style="width: 375px; background: var(--c-bg); padding: 16px 14px; box-sizing: border-box">
      <div style="font-size: 15px; font-weight: 600; color: var(--c-ink); margin-bottom: 4px">案D ─ 空セルを2つに分ける</div>
      <div style="font-size: 11px; color: var(--c-ink-3); margin-bottom: 16px; line-height: 1.5">現状は「音域外」と「まだ吹いていない」が同じ白。<br>音域内で値の無い窓にだけ枠を出す（新しい色は使わない）。</div>
      <div style="display: flex; gap: 5px">
        <div style="width: 11px; flex-shrink: 0; display: flex; flex-direction: column; gap: ${MATRIX_GRID_GAP}px; padding-top: 14px">
${m.octaves.map((o) => `          <span style="height: ${MATRIX_CELL_H}px; display: flex; align-items: center; font-family: var(--font-num); font-size: 10px; color: var(--c-ink-3)">${o}</span>`).join("\n")}
        </div>
        <div style="flex: 1; min-width: 0">
          <div style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: ${MATRIX_GRID_GAP}px; margin-bottom: ${MATRIX_GRID_GAP}px">
${NOTE_NAMES.map((pc) => `            <span style="font-size: 10px; color: var(--c-ink-3); text-align: center; overflow: hidden">${pc}</span>`).join("\n")}
          </div>
${rows}
        </div>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 10px 14px; margin-top: 14px; font-size: 11px; color: var(--c-ink-2)">
${swatch("background: var(--c-div-8)", "高い（8段）")}
${swatch("background: var(--c-sunk)", "帯の中 = 合っている")}
${swatch("border: 1px solid var(--c-line)", "まだ吹いていない")}
${swatch("background: transparent", "音域外（窓を置かない）")}
      </div>
      <div style="margin-top: 14px; padding: 10px 12px; background: var(--c-sunk); border-radius: 8px; font-size: 11px; color: var(--c-ink-2); line-height: 1.6">
        上段は <span style="font-family: var(--font-num)">B♭5 / B5</span>、下段は <span style="font-family: var(--font-num)">C3</span> が音域外。<br>
        枠が出るのは <span style="font-family: var(--font-num)">E3</span> と <span style="font-family: var(--font-num)">A5</span> ＝ この日まだ吹いていない音。
      </div>
    </div>`;
  writeFileSync(OUT + "PlanD.dc.html", dcFile(body));
  console.log("PlanD   音域外/未演奏を分けた");
}

// ========================================================================
// 【D-9 2026/08/25 本人指示・凍結仕様 design/D9-SPEC.md】
// 本人がキャンバスで置いた絵は「イメージ」なので、位置ズレを直し、追加の裁定を当てた版。
// これが Main.dc.html / Windows.dc.html を**上書きする**（上の D-8 版は履歴のためだけ）。
// ========================================================================

// 折れ線の系列色 = チップの枠の色。**綴りを2箇所に持たない**ための1箇所。
const D9_SERIES = [
  { key: "day",    label: "8/24",   color: "var(--c-accent)" },      // SERIES_STYLES[0]
  { key: "period", label: "my平均", color: "var(--c-accent-mid)" },  // SERIES_STYLES[1]
];

// 【D-9 §3】この行は §5(44pt) を要求しない。高さ 20px。当たり判定は行の高さいっぱい。
const d9Chip = (label, borderColor) =>
  `<div style="display: inline-flex; align-items: center; height: 20px; padding: 0 13px; font-size: 12px; font-weight: 600; background: transparent; border: 1px solid ${borderColor}; border-radius: 8px; color: var(--c-ink-2)">${label}</div>`;

// 【D-9z】集計範囲セレクタは指標タブの行の右端へ。子タブ行からは外す
const d9ScopePicker = () => `<div style="display: flex; align-items: center; margin-left: auto; flex-shrink: 0">
            <div style="min-height: 44px; display: inline-flex; align-items: center; font-size: 12px; color: var(--c-ink-3)">Alto ▾</div>
            <span style="font-size: 12px; color: var(--c-ink-3); white-space: pre"> · </span>
            <div style="min-height: 44px; display: inline-flex; align-items: center; font-size: 12px; color: var(--c-ink-3)">1ヶ月 ▾</div>
          </div>`;

// 【D-9z 追加指示】「不自然に上部があくのは不自然にならないように上部に寄せてください」
// 子タブはナビゲーションなので 44pt を保つ(チップ行の例外とは別)。詰めるのは縦の余白:
//   子タブ行の marginBottom 4 → 0 / カードの上余白 --sp-4(16) → --sp-2(8)
const d9SubTabRow = () => `<div style="display: flex; align-items: center; gap: 0; margin-left: -9px; margin-bottom: 0">
        <div style="min-height: 44px; padding: 0 9px; display: flex; align-items: center; font-size: 22px; color: var(--c-ink); font-weight: 600; line-height: 1.2">My Data</div>
        <div style="min-height: 44px; padding: 0 9px; display: flex; align-items: center; font-size: 15px; color: var(--c-ink-3); font-weight: 400; line-height: 1.2">分析</div>
      </div>`;

// 【D-9y】指標タブの下の罫は**両方外す**(本人裁定)
const d9MetricTabs = (sel) => `<div style="display: flex; align-items: center; gap: 0; margin-left: -8px">
${["平均差分", "HNR", "重心", "音量"].map((t) => `          <div style="min-height: 44px; padding: 0 8px; display: inline-flex; align-items: center; justify-content: center">
            <span style="display: inline-flex; align-items: center; min-height: 26px; padding: 0 2px; font-size: 13px; font-weight: 600; color: ${t === sel ? "var(--c-ink)" : "var(--c-ink-3)"};${t === sel ? " box-shadow: inset 0 -2px 0 0 var(--c-ink);" : ""}">${t}</span>
          </div>`).join("\n")}
          ${d9ScopePicker()}
        </div>`;

const d9Toggle = (view) => {
  const ic = (kind, on) => kind === "line"
    ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${on ? "var(--c-accent)" : "var(--c-ink-3)"}" stroke-width="${on ? 2.2 : 1.8}" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>`
    : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${on ? "var(--c-accent)" : "var(--c-ink-3)"}" stroke-width="${on ? 2.2 : 1.8}" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" /></svg>`;
  return `<div style="display: flex; gap: 2px; margin-left: auto; flex-shrink: 0">
            <div style="height: 35px; min-width: 35px; display: inline-flex; align-items: center; justify-content: center">${ic("line", view === "line")}</div>
            <div style="height: 35px; min-width: 35px; display: inline-flex; align-items: center; justify-content: center">${ic("matrix", view === "matrix")}</div>
          </div>`;
};

// 【D-9 §1】式の行。記号は折れ線が「×」(重ねる) / 窓型が「ー」(引く)。使い分けは本人確認済み
const d9FormulaRow = (left, sign, right, view) => `<div style="display: flex; align-items: center; gap: 8px; height: 35px">
          ${left}
          <span style="font-size: 16px; line-height: 1; color: var(--c-ink-3); flex-shrink: 0">${sign}</span>
          ${right}
          ${d9Toggle(view)}
        </div>`;

const d9Page = (inner) => `<div style="width: 375px; background: var(--c-bg); padding: 0 14px; box-sizing: border-box">
      ${d9SubTabRow()}
      <div style="padding: 8px 0 16px; background: transparent; border: 0; border-radius: 0">
        ${inner}
      </div>
    </div>`;

// ---- Main.dc.html（D-9）: 平均差分 × 折れ線 ------------------------------
{
  const series = [
    { id: "day", label: D9_SERIES[0].label, color: D9_SERIES[0].color, width: 2, byIdx: pitchDay },
    { id: "period", label: D9_SERIES[1].label, color: D9_SERIES[1].color, width: 2, byIdx: pitchPeriod },
  ];
  // 【D-9w】plotH 94 → 170。「4指標が縦に積まれるため」という 94 の理由はタブ化で既に古い
  const L = layout({ vals: series.map((s) => Object.values(s.byIdx)), zeroCentered: true, fmt: formatSignedCents, plotH: 170 });
  const body = d9Page([
    d9MetricTabs("平均差分"),
    d9FormulaRow(d9Chip(D9_SERIES[0].label, D9_SERIES[0].color), "×", d9Chip(D9_SERIES[1].label, D9_SERIES[1].color), "line"),
    `<div>
          ${chartSvg({ series, L, zeroCentered: true, bandAbs: null, edgeGridLines: false })}
        </div>`,
  ].join("\n        "));
  writeFileSync(OUT + "Main.dc.html", dcFile(body));
  console.log("D-9 Main   plotH=170 H=" + L.H + " ticks=" + L.tickTexts.join("/") + "（上下の目盛線なし・帯なし）");
}

// ---- Windows.dc.html（D-9）: 平均差分 × 窓型（1枚 + 案D） ---------------
{
  const inRangeHigh = LOW_MIDI + N - 1;
  const inRange = (oct, pcIdx) => { const midi = (oct + 1) * 12 + pcIdx; return midi >= LOW_MIDI && midi <= inRangeHigh; };
  // 【D-9 §4】1枚だけ = 選んだ2つの引き算。
  // 案D の見え方を確かめるため、期間中に一度も吹いていない音を2つ空けたダミーにする
  const periodWithGaps = { ...pitchPeriod, 3: null, 25: null };
  const m = buildMatrix(periodWithGaps);
  const band = RING_IN_TUNE_CENTS;
  const texts = [];
  for (const oct of m.octaves) for (const pc of NOTE_NAMES) {
    const v = m.byKey[oct + ":" + pc];
    if (v !== null && v !== undefined) texts.push(matrixCellText(v));
  }
  const numFs = matrixNumFontSize(texts);
  const rangeText = m.count === 0 ? "—" : matrixCellText(m.min) + " 〜 " + matrixCellText(m.max);
  const rows = m.octaves.map((oct) => `            <div style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: ${MATRIX_GRID_GAP}px; margin-bottom: ${MATRIX_GRID_GAP}px">
${NOTE_NAMES.map((pc, pi) => {
    const v = m.byKey[oct + ":" + pc];
    if (v === null || v === undefined) {
      // 【案D】音域外は窓を置かない / 音域内でデータ無しは --c-line の枠だけ
      return inRange(oct, pi)
        ? `              <div style="height: ${MATRIX_CELL_H}px; border-radius: 4px; border: 1px solid var(--c-line)"></div>`
        : `              <div style="height: ${MATRIX_CELL_H}px"></div>`;
    }
    const label = matrixCellText(v);
    const n = Number(label);
    let bg, fg;
    if (Math.abs(n) <= band) { bg = "var(--c-sunk)"; fg = "var(--c-ink-3)"; }
    else { const st = divergingStep(n, m.maxAbs); bg = "var(--c-div-" + st + ")"; fg = divergingInk(st); }
    return `              <div style="height: ${MATRIX_CELL_H}px; border-radius: 4px; overflow: hidden; background: ${bg}; color: ${fg}; display: flex; align-items: center; justify-content: center; font-family: var(--font-num); font-weight: 600; font-size: ${numFs}px">${label}</div>`;
  }).join("\n")}
            </div>`).join("\n");
  // 【D-9 §4】title(今日の自分 / いつもの自分)と sub("8/24 − ±0")は式が兼ねるので撤去。
  // 実測レンジだけ残す（いちばん長い窓がいくつかを数字で確かめられる）
  const matrix = `<div>
          <div style="display: flex; justify-content: flex-end; padding-bottom: 8px">
            <span style="font-family: var(--font-num); font-size: 10px; color: var(--c-ink-3)">${rangeText}</span>
          </div>
          <div style="display: flex; gap: 5px">
            <div style="width: 11px; flex-shrink: 0; display: flex; flex-direction: column; gap: ${MATRIX_GRID_GAP}px; padding-top: 14px">
${m.octaves.map((o) => `              <span style="height: ${MATRIX_CELL_H}px; display: flex; align-items: center; font-family: var(--font-num); font-size: 10px; color: var(--c-ink-3)">${o}</span>`).join("\n")}
            </div>
            <div style="flex: 1; min-width: 0">
              <div style="display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: ${MATRIX_GRID_GAP}px; margin-bottom: ${MATRIX_GRID_GAP}px">
${NOTE_NAMES.map((pc) => `                <span style="font-size: 10px; color: var(--c-ink-3); text-align: center; overflow: hidden">${pc}</span>`).join("\n")}
              </div>
${rows}
            </div>
          </div>
        </div>`;
  // 【D-9】窓型は「系列」ではなく「引かれる数 ー 引く数」なので、枠に系列色を持たせない
  const body = d9Page([
    d9MetricTabs("平均差分"),
    d9FormulaRow(d9Chip("my平均", "var(--c-line-strong)"), "ー", d9Chip("±0", "var(--c-line-strong)"), "matrix"),
    matrix,
  ].join("\n        "));
  writeFileSync(OUT + "Windows.dc.html", dcFile(body));
  console.log("D-9 Windows 1枚 + 案D（音域外は窓なし / 未演奏は枠）");
}

// ---- Centroid.dc.html（D-9）: 重心 × 折れ線（中央線 = その指標の平均） ----
{
  const series = [
    { id: "day", label: D9_SERIES[0].label, color: D9_SERIES[0].color, width: 2, byIdx: cenDay },
    { id: "period", label: D9_SERIES[1].label, color: D9_SERIES[1].color, width: 2, byIdx: cenPeriod },
  ];
  // 【D-9u】0 中心ではないので、**その指標の平均**を中央線にして上下対称にする。
  // 【D-9 §6】比較対象の破線(refByIdx)は撤去。目安を見たいときは**式の片側で選ぶ**
  const L = layout({ vals: series.map((s) => Object.values(s.byIdx)), zeroCentered: false, meanCentered: true, fmt: roundInt, plotH: 170 });
  const body = d9Page([
    d9MetricTabs("重心"),
    d9FormulaRow(d9Chip(D9_SERIES[0].label, D9_SERIES[0].color), "×", d9Chip(D9_SERIES[1].label, D9_SERIES[1].color), "line"),
    `<div>
          ${chartSvg({ series, L, zeroCentered: false, edgeGridLines: false })}
        </div>`,
  ].join("\n        "));
  writeFileSync(OUT + "Centroid.dc.html", dcFile(body));
  console.log("D-9 Centroid 中央線=" + Math.round(L.center) + "Hz（その指標の平均）ticks=" + L.tickTexts.join("/"));
}

// ---- AnalysisTop.dc.html : D-9r 分析(PIVOT)タブの上部 -------------------
// 集計範囲セレクタが子タブ行から抜けたあと、その空きをどうするか。
// **案R = 表題「PIVOT」をその空きへ移す。** D-8a「PIVOT が2つ目の見出しに見える」も同時に解ける。
{
  const subTab = (analysisSel, right) => `<div style="display: flex; align-items: center; gap: 0; margin-left: -9px; margin-bottom: 0">
            <div style="min-height: 44px; padding: 0 9px; display: flex; align-items: center; font-size: 15px; color: var(--c-ink-3); font-weight: 400; line-height: 1.2">My Data</div>
            <div style="min-height: 44px; padding: 0 9px; display: flex; align-items: center; font-size: 22px; color: var(--c-ink); font-weight: 600; line-height: 1.2">分析</div>
            ${right}
          </div>`;
  const pivotTitle = `<div style="font-size: 15px; color: var(--c-accent); font-weight: 700; margin-bottom: 4px">PIVOT</div>`;
  const desc = `<div style="font-size: 12px; color: var(--c-ink-3); line-height: 1.6; margin-bottom: 12px">条件・縦軸・横軸・分析軸を選ぶと、蓄積データをマトリクスで集計します</div>`;
  const condRow = `<div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 0 0 4px">
            <div style="display: inline-flex; align-items: center; padding: 3px 10px; font-size: 11px; font-weight: 600; color: var(--c-accent); background: transparent; border: 1px solid var(--c-line-strong); border-radius: 8px; line-height: 1.4">楽器 = Alto</div>
            <div style="display: inline-flex; align-items: center; padding: 3px 10px; font-size: 11px; color: var(--c-ink-2); background: transparent; border: 1px solid var(--c-line-strong); border-radius: 8px; line-height: 1.4">＋ 条件</div>
          </div>`;
  const ghost = `<div style="margin-top: 12px; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 1px; opacity: .5">
${Array.from({ length: 12 }, (_, i) => `            <div style="height: 25px; border-radius: 4px; background: ${i % 5 === 0 ? "var(--c-div-6)" : i % 3 === 0 ? "var(--c-div-3)" : "var(--c-sunk)"}"></div>`).join("\n")}
          </div>`;
  const block = (title, note, inner, h) => `<div>
          <div style="font-size: 12px; font-weight: 600; color: var(--c-ink); margin-bottom: 2px">${title}</div>
          <div style="font-size: 11px; color: var(--c-ink-3); margin-bottom: 8px; line-height: 1.5">${note}</div>
          <div style="border: 1px dashed var(--c-line-strong); border-radius: 8px; padding: 0 14px 12px; background: var(--c-bg)">
${inner}
          </div>
          <div style="font-size: 10px; color: var(--c-ink-3); font-family: var(--font-num); margin-top: 4px; text-align: right">上部 ${h}px</div>
        </div>`;

  const body = `<div style="width: 375px; background: var(--c-bg); padding: 16px 14px; box-sizing: border-box">
      <div style="font-size: 15px; font-weight: 600; color: var(--c-ink); margin-bottom: 4px">D-9r ─ 分析タブの上部</div>
      <div style="font-size: 11px; color: var(--c-ink-3); margin-bottom: 16px; line-height: 1.5">集計範囲セレクタが子タブ行から抜けたあと、右端が空く。</div>
      <div style="display: flex; flex-direction: column; gap: 20px">
${block("そのまま（空けたまま）", "子タブ行の右端が空く。表題「PIVOT」は 22px の見出しの下に残るので、<b>見出しが2つ続いて見える</b>（D-8a の指摘そのもの）。",
    `            ${subTab(true, "")}\n            <div style="padding-top: 8px">${pivotTitle}${desc}${condRow}${ghost}</div>`, 63)}
${block("最終 ─ 「PIVOT」を文字ごと削除", "本人裁定「PIVOT の文字ごと削除してその分上に詰めましょう」。表題の行（15px + 余白4）が丸ごと消えて <b>19px 縮む</b>。見出しは子タブの「分析」1つだけ。<b>子タブ行の右端は両タブとも空</b>になるので、<code>dataSubTab === \"mydata\"</code> の分岐が本当に1つ消える。",
    `            ${subTab(true, "")}\n            <div style="padding-top: 8px">${desc}${condRow}${ghost}</div>`, 44)}
      </div>
      <div style="margin-top: 16px; padding: 10px 12px; background: var(--c-sunk); border-radius: 8px; font-size: 11px; color: var(--c-ink-2); line-height: 1.6">
        F-99 で「PIVOT の文字があれば Excel も想起できる」と言って復活させた表題を、<b>本人の裁定で消す</b>。<br>
        完了記録に「D-9r で消した」と書かないと、次に触る人が 15px の表題を戻す。<br>
        説明の2行は F-99 の意図どおり<b>残す</b>。
      </div>
    </div>`;
  writeFileSync(OUT + "AnalysisTop.dc.html", dcFile(body));
  console.log("AnalysisTop D-9r 最終（PIVOT を文字ごと削除 / 上部 63 → 44px）");
}

// ---- 練習カレンダー（src/App.jsx の PracticeCalendarCard から写した） -----
const CALENDAR_CELL_H = 38, CALENDAR_DOT = 28;
const CALENDAR_FILLS = ["transparent", "var(--c-accent-tint)", "var(--c-accent-line)", "var(--c-accent-mid)", "var(--c-accent)"];
const calendarInk = (lv) => (lv >= 3 ? "var(--c-on-accent)" : "var(--c-ink)");
function calendarCard() {
  // 2026年8月。1日は土曜（曜日は日曜始まり）
  const firstDow = 6, days = 31;
  const levels = { 3:1, 5:2, 6:1, 8:3, 10:1, 12:2, 13:1, 15:4, 17:1, 19:2, 20:3, 22:1, 24:4, 26:2, 27:1, 29:1 };
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const cellHtml = cells.map((d, i) => {
    if (d === null) return `            <div style="height: ${CALENDAR_CELL_H}px"></div>`;
    const lv = levels[d] ?? 0;
    const sel = d === 24;
    return `            <div style="height: ${CALENDAR_CELL_H}px; display: flex; align-items: center; justify-content: center">
              <span style="width: ${CALENDAR_DOT}px; height: ${CALENDAR_DOT}px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${CALENDAR_FILLS[lv]}; color: ${lv > 0 ? calendarInk(lv) : "var(--c-ink-3)"}; font-family: var(--font-num); font-size: 12px;${sel ? " box-shadow: 0 0 0 2px var(--c-ink);" : ""}">${d}</span>
            </div>`;
  }).join("\n");
  return `<div style="margin-top: 12px; padding: 16px 0; border-top: 1px solid var(--c-rule)">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
            <div style="min-width: 0">
              <div style="font-size: 12px; font-weight: 600; color: var(--c-ink)">2026年8月</div>
              <div style="font-size: 10px; color: var(--c-ink-3); margin-top: 2px">16日 · 3時間42分</div>
            </div>
            <div style="display: flex; align-items: center; flex-shrink: 0">
              <span style="min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; color: var(--c-ink-3)">‹</span>
              <span style="min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; color: var(--c-ink-3)">›</span>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; font-size: 10px; color: var(--c-ink-3); text-align: center; margin-top: 6px">
${["日","月","火","水","木","金","土"].map((w) => `            <span>${w}</span>`).join("\n")}
          </div>
          <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-top: 6px">
${cellHtml}
          </div>
          <div style="margin-top: 16px; padding-top: 13px; border-top: 1px solid var(--c-line)">
            <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 4px">
              <span style="font-size: 12px; font-weight: 600; color: var(--c-ink)">8月24日 のセッション</span>
              <span style="font-size: 11px; color: var(--c-ink-3); flex-shrink: 0">2 件</span>
            </div>
${[["19:42","自分 · Alto · Vandoren-3 #1","21.7秒"],["18:05","自分 · Alto · Vandoren-3 #1","1分04秒"]].map(([t,m,d]) => `            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px">
              <span style="min-width: 0">
                <span style="display: block; font-size: 13px; color: var(--c-ink)">${t}</span>
                <span style="display: block; font-size: 10px; color: var(--c-ink-3); margin-top: 2px">${m}</span>
              </span>
              <span style="font-family: var(--font-num); font-size: 12px; color: var(--c-ink-3); flex-shrink: 0">${d}</span>
            </div>`).join("\n")}
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; border-top: 1px solid var(--c-line); margin-top: 4px">
            <span style="font-size: 12px; color: var(--c-accent)">すべてのセッション 128 件</span>
            <span style="font-size: 15px; color: var(--c-line-strong)">›</span>
          </div>
        </div>`;
}

// ---- Full.dc.html : My Data の1画面ぶん（折り返し線つき） ----------------
{
  const series = [
    { id: "day", label: D9_SERIES[0].label, color: D9_SERIES[0].color, width: 2, byIdx: pitchDay },
    { id: "period", label: D9_SERIES[1].label, color: D9_SERIES[1].color, width: 2, byIdx: pitchPeriod },
  ];
  const L = layout({ vals: series.map((s) => Object.values(s.byIdx)), zeroCentered: true, fmt: formatSignedCents, plotH: 170 });
  const inner = [
    d9MetricTabs("平均差分"),
    d9FormulaRow(d9Chip(D9_SERIES[0].label, D9_SERIES[0].color), "×", d9Chip(D9_SERIES[1].label, D9_SERIES[1].color), "line"),
    `<div>
          ${chartSvg({ series, L, zeroCentered: true, bandAbs: null, edgeGridLines: false })}
        </div>`,
    calendarCard(),
  ].join("\n        ");
  const body = `<div style="width: 375px; background: var(--c-bg); box-sizing: border-box; position: relative">
      <div style="padding: 0 14px">
        ${d9SubTabRow()}
        <div style="padding: 8px 0 16px">
          ${inner}
        </div>
      </div>
      <div style="position: absolute; left: 0; top: 731px; width: 375px; border-top: 1px dashed var(--c-danger)"></div>
      <div style="position: absolute; right: 6px; top: 712px; font-size: 10px; color: var(--c-danger); background: var(--c-bg); padding: 2px 4px; border-radius: 4px">ここまでが1画面（812 − ナビ47 − セーフエリア34 = 731）</div>
      <div style="position: absolute; left: 0; top: 812px; width: 375px; border-top: 1px dashed var(--c-line-strong)"></div>
    </div>`;
  writeFileSync(OUT + "Full.dc.html", dcFile(body));
  console.log("Full    1画面ぶん（折り返し線 731px）");
}

// ---- Sheet.dc.html : 系列を選ぶシート（左右で選択肢が変わる） -------------
{
  const opt = (label, state) => {
    const bg = state === "sel" ? "var(--c-accent-tint)" : "transparent";
    const col = state === "sel" ? "var(--c-accent)" : state === "gone" ? "var(--c-ink-4)" : "var(--c-ink)";
    const strike = state === "gone" ? " text-decoration: line-through;" : "";
    return `            <div style="min-height: 44px; display: flex; align-items: center; padding: 0 14px; font-size: 15px; background: ${bg}; color: ${col};${strike} border-radius: 8px">${label}${state === "sel" ? '<span style="margin-left: auto; font-size: 13px">✓</span>' : ""}</div>`;
  };
  const sheet = (title, opts) => `<div style="border: 1px solid var(--c-line-strong); border-radius: 16px; padding: 12px; background: var(--c-surface)">
          <div style="font-size: 12px; font-weight: 600; color: var(--c-ink-3); padding: 0 2px 8px">${title}</div>
${opts.join("\n")}
        </div>`;
  const body = `<div style="width: 375px; background: var(--c-bg); padding: 16px 14px; box-sizing: border-box">
      <div style="font-size: 15px; font-weight: 600; color: var(--c-ink); margin-bottom: 4px">系列を選ぶ ─ 左右で同じものは選べない</div>
      <div style="font-size: 11px; color: var(--c-ink-3); margin-bottom: 16px; line-height: 1.5">本人指示「一方で選ばれているものはそもそももう一方の選択肢から削除するように」。<br>押せない選択肢を出さない（F-77 と同じ手）。</div>
      <div style="display: flex; align-items: center; gap: 8px; height: 35px; margin-bottom: 14px">
        ${d9Chip(D9_SERIES[0].label, D9_SERIES[0].color)}
        <span style="font-size: 16px; line-height: 1; color: var(--c-ink-3)">×</span>
        ${d9Chip(D9_SERIES[1].label, D9_SERIES[1].color)}
      </div>
      <div style="display: flex; flex-direction: column; gap: 14px">
        <div>
          <div style="font-size: 11px; color: var(--c-ink-3); margin-bottom: 6px">左（8/24）を押したとき ─ <b style="color: var(--c-ink)">my平均が消える</b></div>
          ${sheet("1本目", [opt("8/24（その日）", "sel"), opt("my平均", "gone"), opt("目安", ""), opt("±0", "")])}
        </div>
        <div>
          <div style="font-size: 11px; color: var(--c-ink-3); margin-bottom: 6px">右（my平均）を押したとき ─ <b style="color: var(--c-ink)">8/24 が消える</b></div>
          ${sheet("2本目", [opt("8/24（その日）", "gone"), opt("my平均", "sel"), opt("目安", ""), opt("±0", "")])}
        </div>
      </div>
      <div style="margin-top: 16px; padding: 10px 12px; background: var(--c-sunk); border-radius: 8px; font-size: 11px; color: var(--c-ink-2); line-height: 1.6">
        取り消し線は<b>説明のための印</b>で、実装では<b>行ごと出さない</b>。<br>
        「±0」は平均差分のときだけ出る（既存の <span style="font-family: var(--font-num)">pitchOnly</span> の規則）。<br>
        目安が未設定なら「目安」も出ない（既存の規則）。
      </div>
    </div>`;
  writeFileSync(OUT + "Sheet.dc.html", dcFile(body));
  console.log("Sheet   左右で選択肢が変わる規則");
}

// ========================================================================
// 【R 2026/08/25 本人指示】My Data のレイアウトを一から設計し直す方向案。
// 「見せ方とか機能は今のままでいいんだが、デザイン性がなく『見たい画面』になってない」
// 「折れ線グラフ→カレンダーの順じゃなくてもいい。レイアウトは一から設計して問題ない」
// **機能は1つも足していない。並び順と組み方だけが違う4案。**
// ========================================================================

// 小さな折れ線(スパークライン)。案3 のタイルが使う
function spark(vals, w, h, color) {
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = (mx - mn) || 1;
  const pts = vals.map((v, i) => `${r2((i / (vals.length - 1)) * w)},${r2(h - ((v - mn) / rng) * h)}`).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display: block"><polyline fill="none" points="${pts}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" style="stroke: ${color}" /></svg>`;
}
const rSubTab = (right = "") => `<div style="display: flex; align-items: center; gap: 0; margin-left: -9px">
        <div style="min-height: 44px; padding: 0 9px; display: flex; align-items: center; font-size: 22px; color: var(--c-ink); font-weight: 600; line-height: 1.2">My Data</div>
        <div style="min-height: 44px; padding: 0 9px; display: flex; align-items: center; font-size: 15px; color: var(--c-ink-3); font-weight: 400; line-height: 1.2">分析</div>
        ${right}
      </div>`;
const rScope = `<div style="margin-left: auto; display: flex; align-items: center; flex-shrink: 0">
          <span style="min-height: 44px; display: inline-flex; align-items: center; font-size: 12px; color: var(--c-ink-3)">Alto ▾</span>
          <span style="font-size: 12px; color: var(--c-ink-3); white-space: pre"> · </span>
          <span style="min-height: 44px; display: inline-flex; align-items: center; font-size: 12px; color: var(--c-ink-3)">1ヶ月 ▾</span>
        </div>`;
const rMetricTabs = (sel, right) => `<div style="display: flex; align-items: center; gap: 0; margin-left: -8px">
${["平均差分", "HNR", "重心", "音量"].map((t) => `        <div style="min-height: 44px; padding: 0 8px; display: inline-flex; align-items: center; justify-content: center">
          <span style="display: inline-flex; align-items: center; min-height: 26px; padding: 0 2px; font-size: 13px; font-weight: 600; color: ${t === sel ? "var(--c-ink)" : "var(--c-ink-3)"};${t === sel ? " box-shadow: inset 0 -2px 0 0 var(--c-ink);" : ""}">${t}</span>
        </div>`).join("\n")}
        ${right || ""}
      </div>`;
const rFormula = (l, sign, rr, view = "line") => `<div style="display: flex; align-items: center; gap: 8px; height: 35px">
        ${d9Chip(l, D9_SERIES[0].color)}
        <span style="font-size: 16px; line-height: 1; color: var(--c-ink-3)">${sign}</span>
        ${d9Chip(rr, D9_SERIES[1].color)}
        ${d9Toggle(view)}
      </div>`;
function rChart(plotH = 170, width = W) {
  const series = [
    { id: "day", label: "8/24", color: D9_SERIES[0].color, width: 2, byIdx: pitchDay },
    { id: "period", label: "my平均", color: D9_SERIES[1].color, width: 2, byIdx: pitchPeriod },
  ];
  const L = layout({ vals: series.map((s) => Object.values(s.byIdx)), zeroCentered: true, fmt: formatSignedCents, plotH, width });
  return chartSvg({ series, L, zeroCentered: true, bandAbs: null, edgeGridLines: false, width });
}
const rPage = (inner, note) => `<div style="width: 375px; background: var(--c-bg); padding: 0 14px 20px; box-sizing: border-box">
      ${inner}
      <div style="margin-top: 20px; padding: 10px 12px; background: var(--c-sunk); border-radius: 8px; font-size: 11px; color: var(--c-ink-2); line-height: 1.6">${note}</div>
    </div>`;

// ---- 案1 Hero : 要約が先。数字で答えを出す ------------------------------
{
  const inner = `${rSubTab()}
      <div style="padding: 4px 0 20px">
        <div style="font-size: 12px; color: var(--c-ink-3); letter-spacing: .04em">8月24日 土</div>
        <div style="display: flex; align-items: baseline; gap: 8px; margin-top: 6px">
          <span style="font-family: var(--font-num); font-size: 46px; font-weight: 600; color: var(--c-ink); line-height: 1">+2.4</span>
          <span style="font-size: 15px; color: var(--c-ink-3)">¢</span>
          <span style="margin-left: auto; font-size: 12px; color: var(--c-ink-2); text-align: right; line-height: 1.5">いつもより<br><b style="color: var(--c-ink)">1.2¢ 高い</b></span>
        </div>
        <div style="margin-top: 10px; display: flex; gap: 14px; font-size: 11px; color: var(--c-ink-3)">
          <span>2 セッション</span><span>1分26秒</span><span>21 音</span>
        </div>
      </div>
      <div style="border-top: 1px solid var(--c-rule); padding: 8px 0 16px">
        ${rMetricTabs("平均差分", rScope)}
        ${rFormula("8/24", "×", "my平均")}
        <div>${rChart(150)}</div>
      </div>
      ${calendarCard()}`;
  writeFileSync(OUT + "R1Hero.dc.html", dcFile(rPage(inner,
    "<b>案1 要約が先。</b>開いた瞬間に「今日どうだったか」が数字で返る。グラフは答えの<b>裏取り</b>になる。<br>足した機能はゼロ ─ 大きな数字は選んでいる指標の当日平均、右はその指標の期間平均との差。どちらも既にある値。")));
  console.log("R1 Hero    要約が先");
}

// ---- 案2 ByDay : 時間が先。日を選んでからグラフ ---------------------------
{
  const inner = `${rSubTab(rScope)}
      <div style="padding: 4px 0 0">
        ${calendarCard().replace('margin-top: 12px; padding: 16px 0; border-top: 1px solid var(--c-rule)', 'padding: 0')}
      </div>`;
  // カレンダーの下半分(セッション一覧)は差し替えて、選んだ日のグラフを置く
  const cal = calendarCard();
  const head = cal.slice(0, cal.indexOf('<div style="margin-top: 16px; padding-top: 13px'));
  const inner2 = `${rSubTab(rScope)}
      <div style="padding: 4px 0 0">
        ${head.replace('margin-top: 12px; padding: 16px 0; border-top: 1px solid var(--c-rule)', 'padding: 0')}
        </div>
      </div>
      <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--c-rule)">
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px">
          <span style="font-size: 18px; font-weight: 600; color: var(--c-ink)">8月24日</span>
          <span style="font-size: 11px; color: var(--c-ink-3)">2 件 · 1分26秒</span>
        </div>
        ${rMetricTabs("平均差分", "")}
        ${rFormula("8/24", "×", "my平均")}
        <div>${rChart(150)}</div>
      </div>
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; border-top: 1px solid var(--c-line); margin-top: 12px">
        <span style="font-size: 12px; color: var(--c-accent)">すべてのセッション 128 件</span>
        <span style="font-size: 15px; color: var(--c-line-strong)">›</span>
      </div>`;
  writeFileSync(OUT + "R2ByDay.dc.html", dcFile(rPage(inner2,
    "<b>案2 時間が先。</b>カレンダーを頭に出して「いつの話か」を先に決める。式の「8/24」が<b>自明になる</b>のが効き目。<br>日を押すと下のグラフが差し替わる ─ 今のカレンダーが既に持っている挙動をそのまま使う。")));
  console.log("R2 ByDay   時間が先");
}

// ---- 案3 Tiles : 指標が先。4つを横に並べて関係を見せる --------------------
{
  const tiles = [
    { l: "平均差分", v: "+2.4", u: "¢", d: pitchDay, sel: true },
    { l: "HNR", v: "17.2", u: "dB", d: [12,13,15,14,16,17,17.2,16.8], sel: false },
    { l: "重心", v: "1580", u: "Hz", d: [1400,1450,1520,1490,1550,1600,1580,1560], sel: false },
    { l: "音量", v: "-18.4", u: "dB", d: [-22,-21,-20,-19,-18,-18.5,-18.4,-19], sel: false },
  ];
  const tileHtml = tiles.map((t) => `          <div style="padding: 8px 8px 6px; border-radius: 8px; background: ${t.sel ? "var(--c-accent-tint)" : "transparent"}; border: 1px solid ${t.sel ? "var(--c-accent)" : "var(--c-line)"}">
            <div style="font-size: 10px; color: ${t.sel ? "var(--c-accent)" : "var(--c-ink-3)"}; font-weight: 600">${t.l}</div>
            <div style="display: flex; align-items: baseline; gap: 2px; margin-top: 2px">
              <span style="font-family: var(--font-num); font-size: 15px; font-weight: 600; color: var(--c-ink)">${t.v}</span>
              <span style="font-size: 10px; color: var(--c-ink-3)">${t.u}</span>
            </div>
            <div style="margin-top: 4px">${spark(Array.isArray(t.d) ? t.d : Object.values(t.d).filter((v) => v !== null), 66, 16, t.sel ? "var(--c-accent)" : "var(--c-accent-line)")}</div>
          </div>`).join("\n");
  const inner = `${rSubTab(rScope)}
      <div style="padding: 4px 0 0">
        <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px">
${tileHtml}
        </div>
        <div style="margin-top: 16px">
          ${rFormula("8/24", "×", "my平均")}
          <div>${rChart(170)}</div>
        </div>
      </div>
      ${calendarCard()}`;
  writeFileSync(OUT + "R3Tiles.dc.html", dcFile(rPage(inner,
    "<b>案3 指標が先。</b>4指標をタイルで横に並べ、押したものだけが下で大きく開く。<b>4つの関係が一目で見える</b>のが効き目 ─ いまはタブを押さないと他の3つが分からない。<br>指標タブの行が消えるので、行が1本減る。")));
  console.log("R3 Tiles   指標が先");
}

// ---- 案4 Quiet : 静かな章立て。余白と見出しで読ませる ---------------------
{
  const chap = (t, sub) => `        <div style="margin-top: 28px">
          <div style="font-size: 18px; font-weight: 600; color: var(--c-ink); letter-spacing: .02em">${t}</div>
          <div style="font-size: 11px; color: var(--c-ink-3); margin-top: 3px">${sub}</div>
        </div>`;
  const inner = `${rSubTab(rScope)}
      <div style="padding: 0 0 4px">
${chap("今日の音程", "8月24日 · 2セッション · 音名ごとの平均差分")}
        <div style="margin-top: 12px">
          ${rFormula("8/24", "×", "my平均")}
          <div>${rChart(190)}</div>
        </div>
${chap("指標を変える", "同じ音名軸で、別の物差しに切り替える")}
        <div style="margin-top: 8px">${rMetricTabs("平均差分", "")}</div>
${chap("積み重ね", "練習した日と、その量")}
        <div style="margin-top: 12px">${calendarCard().replace('margin-top: 12px; padding: 16px 0; border-top: 1px solid var(--c-rule)', 'padding: 0')}</div>
      </div>`;
  writeFileSync(OUT + "R4Quiet.dc.html", dcFile(rPage(inner,
    "<b>案4 静かな章立て。</b>行を詰めるのをやめ、<b>28px の余白と 18px の見出し</b>で3つの章に割る。<br>読ませる順が視覚的に立つ代わりに<b>縦は伸びる</b>。「育てる × 静けさ」(design/DESIGN.md)にいちばん近いのはこれ。")));
  console.log("R4 Quiet   静かな章立て");
}


// ========================================================================
// 【S 2026/08/26 本人指示】My Data / 分析タブのレイアウト刷新案。
// 一次: 「総計測時間・回数を先頭 → 次にカレンダー(よりカレンダーらしく)」「レイアウトは一から」
// 二次: 「むやみに線をひくのやめて」「カード化とサイズ感を参考画像へ」「日付は元の丸に戻して」
// 三次(裁定): **My Data は S1、分析は A1 を採用**。
//   ・「白いカードがある方が機械感が強くて少しうるさくなるが、mydata はラボ的に使ってほしい
//     側面があるので、その表現としてはあり」= **カードの文法を採用**
//   ・その日のセッションは**常時表示をやめ、日付を押したら開く**(折れ線のカードを下へ押し出す)。
//     他をタップすると閉じる。**最大3件、それ以上はスクロール**
//   ・式のチップ(比較対象の選択)は**ゼロベースで作り直す**(下の Chips.dc.html に4案)
//
// 【体系に持ち込む変更 ─ 採用済み】
//   1. 面の作法: D-7 の「白地 + 罫1本」→ **薄い地 + 白いカード**(本人裁定で採用)
//   2. 影のトークンが体系に無い。ここでは2段の影を使っている
//   3. カレンダーのマスを 38 → 44pt(§5.1 の例外が要らなくなる)
// ========================================================================

const S_SHADOW = "0 1px 2px rgba(18, 31, 50, .04), 0 6px 16px rgba(18, 31, 50, .06)";
const sCard = (inner, pad = 16) => `<div style="background: var(--c-surface); border-radius: 16px; box-shadow: ${S_SHADOW}; padding: ${pad}px">
        ${inner}
      </div>`;
const sEyebrow = (t) => `<div style="font-size: 10px; font-weight: 600; letter-spacing: .08em; color: var(--c-ink-3)">${t}</div>`;
const sNum = "font-family: var(--font-num); font-weight: 600; color: var(--c-ink); letter-spacing: -.02em";
const sSectionHead = (t, right) => `<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 0 4px 8px">
        ${t ? `<span style="font-size: 15px; font-weight: 600; color: var(--c-ink)">${t}</span>` : ""}
        ${right ? `<span style="font-size: 11px; color: var(--c-ink-3); flex-shrink: 0">${right}</span>` : ""}
      </div>`;

// ---- サマリー -----------------------------------------------------------
// S1(採用): 本人が綴りを「累計 / 計測時間 / 計測回数 / 計測音」へ直した
function sStatsThree() {
  const cell = (v, u, l) => `          <div style="flex: 1; min-width: 0">
            <div style="${sNum}; font-size: 26px; line-height: 1.1; white-space: nowrap">${v}<span style="font-size: 12px; font-weight: 400; color: var(--c-ink-3); margin-left: 2px; letter-spacing: 0">${u}</span></div>
            <div style="font-size: 10px; color: var(--c-ink-3); margin-top: 3px">${l}</div>
          </div>`;
  return sCard(`${sEyebrow("累計")}
        <div style="display: flex; align-items: flex-start; gap: 10px; margin-top: 10px">
${cell("12.5", "時間", "計測時間")}
${cell("46", "回", "計測回数")}
${cell("3,120", "音", "計測音")}
        </div>`);
}
// S2 / S3 は本人が綴りを元へ戻したので、そのまま(S1 の語彙を波及させない)
function sStatsHero() {
  return sCard(`${sEyebrow("これまでの練習")}
        <div style="display: flex; align-items: baseline; gap: 6px; margin-top: 6px">
          <span style="${sNum}; font-size: 46px; line-height: 1">12.5</span>
          <span style="font-size: 15px; color: var(--c-ink-3)">時間</span>
        </div>
        <div style="font-size: 13px; color: var(--c-ink-2); margin-top: 8px">46 セッション · 3,120 音</div>`);
}
function sStatsTwoTier() {
  return sCard(`<div style="display: flex; align-items: center; gap: 8px">
          ${sEyebrow("この1ヶ月")}
          <span style="margin-left: auto; display: inline-flex; align-items: center; min-height: 44px; font-size: 12px; color: var(--c-ink-3)">Alto ▾</span>
          <span style="font-size: 12px; color: var(--c-ink-3); white-space: pre"> · </span>
          <span style="display: inline-flex; align-items: center; min-height: 44px; font-size: 12px; color: var(--c-ink-3)">1ヶ月 ▾</span>
        </div>
        <div style="display: flex; align-items: baseline; gap: 10px">
          <span style="${sNum}; font-size: 26px; line-height: 1.1; white-space: nowrap">3.7<span style="font-size: 13px; font-weight: 400; color: var(--c-ink-3); margin-left: 2px; letter-spacing: 0">時間</span></span>
          <span style="font-size: 13px; color: var(--c-ink-2)">12 セッション</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; margin-top: 10px">
          <span style="font-size: 10px; font-weight: 600; letter-spacing: .08em; color: var(--c-ink-3)">全期間</span>
          <span style="font-size: 12px; color: var(--c-ink-2); margin-left: auto">46 セッション · 12.5 時間 · 3,120 音</span>
        </div>`);
}

// ---- カレンダー ---------------------------------------------------------
// 練習量は**丸の濃さ**(現行 CALENDAR_FILLS の4段)。マスは 44pt。
// 【S1・本人の手直し】月見出しは **yyyy/m**、合計はその**右・下揃え**。
//   本人は `position: relative; left: -25px` で寄せていたが、**見た目だけのズラし**なので
//   月の綴りが伸びると重なり得る。baseline で並べる形に置き換えた
//   (文字の大きさが違っても足元が1本に揃い、箱が動くので重ならない)。
const S_CAL_H = 44, S_CAL_DOT = 34;
const S_FILLS = ["transparent", "var(--c-accent-tint)", "var(--c-accent-line)", "var(--c-accent-mid)", "var(--c-accent)"];
const sCalInk = (lv) => (lv >= 3 ? "var(--c-on-accent)" : lv > 0 ? "var(--c-ink)" : "var(--c-ink-3)");
function sCalendarCard({ month = "2026年8月", metaBeside = false, sel = 24 } = {}) {
  const firstDow = 6, days = 31, today = 26;
  const levels = { 3:1, 5:2, 6:1, 8:3, 10:1, 12:2, 13:1, 15:4, 17:1, 19:2, 20:3, 22:1, 24:4, 26:2, 27:1, 29:1 };
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const body = cells.map((d) => {
    if (d === null) return `          <div style="height: ${S_CAL_H}px"></div>`;
    const lv = levels[d] ?? 0;
    const isSel = sel !== null && d === sel, isToday = d === today;
    const bg = isSel ? "var(--c-accent)" : S_FILLS[lv];
    const ink = isSel ? "var(--c-on-accent)" : sCalInk(lv);
    const ring = isToday && !isSel ? " box-shadow: inset 0 0 0 1.5px var(--c-accent);" : "";
    return `          <div style="height: ${S_CAL_H}px; display: flex; align-items: center; justify-content: center">
            <span style="width: ${S_CAL_DOT}px; height: ${S_CAL_DOT}px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: ${bg};${ring} color: ${ink}; font-family: var(--font-num); font-size: 13px; font-weight: ${isSel || isToday ? 600 : 400}">${d}</span>
          </div>`;
  }).join("\n");
  // 【本人指示】合計は月見出しの**右・下揃え**。baseline で揃えるので、
  // 文字の大きさが違っても足元が1本に揃い、月の綴りが伸びても**重ならない**
  // (見た目のズラし position:left は使わない)。
  const head = metaBeside
    ? `<div style="display: flex; align-items: baseline; gap: 10px; min-width: 0">
            <div style="font-size: 17px; font-weight: 600; color: var(--c-ink); letter-spacing: -.01em">${month}</div>
            <div style="font-size: 11px; color: var(--c-ink-3); white-space: nowrap">3.7 時間 · 16 日</div>
          </div>`
    : `<div style="min-width: 0">
            <div style="font-size: 17px; font-weight: 600; color: var(--c-ink); letter-spacing: -.01em">${month}</div>
            <div style="font-size: 11px; color: var(--c-ink-3); margin-top: 2px">3.7 時間 · 16 日</div>
          </div>`;
  return sCard(`<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px">
          ${head}
          <div style="display: flex; align-items: center; flex-shrink: 0; margin-right: -8px">
            <span style="min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; font-size: 17px; color: var(--c-ink-3)">‹</span>
            <span style="min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; font-size: 17px; color: var(--c-ink-3)">›</span>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); font-size: 11px; color: var(--c-ink-3); text-align: center; margin-top: 8px">
${["日","月","火","水","木","金","土"].map((w) => `          <span>${w}</span>`).join("\n")}
        </div>
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); margin-top: 4px">
${body}
        </div>`);
}

// ---- セッション(参考画像のタスクカード: 左に色の細い帯) --------------------
const S_ROW_H = 64;   // 1件ぶんの高さ(カード 54 + 下の余白 8 + 影の逃げ 2)
const sRowCard = (inner, mb = 8) => `<div style="display: flex; align-items: stretch; gap: 12px; background: var(--c-surface); border-radius: 12px; box-shadow: ${S_SHADOW}; padding: 10px 14px; min-height: 44px; margin-bottom: ${mb}px">${inner}</div>`;
const S_SESSIONS = [
  ["19:42", "自分 · Alto · Vandoren-3 #1", "21.7秒", "var(--c-accent)"],
  ["18:05", "自分 · Alto · Vandoren-3 #1", "1分04秒", "var(--c-accent-mid)"],
  ["12:30", "自分 · Alto · Vandoren-3 #2", "48.2秒", "var(--c-accent-mid)"],
  ["09:15", "自分 · Alto · Rico-3 #4", "2分11秒", "var(--c-accent-line)"],
];
const sSessionRow = ([t, m, d, c]) => sRowCard(`
          <span style="width: 3px; border-radius: 2px; background: ${c}; flex-shrink: 0"></span>
          <span style="min-width: 0; display: flex; flex-direction: column; justify-content: center">
            <span style="font-size: 14px; font-weight: 600; color: var(--c-ink)">${t}</span>
            <span style="font-size: 11px; color: var(--c-ink-3); margin-top: 2px">${m}</span>
          </span>
          <span style="margin-left: auto; display: flex; align-items: center; font-family: var(--font-num); font-size: 12px; color: var(--c-ink-3); flex-shrink: 0">${d}</span>
        `);
const sAllSessions = () => sRowCard(`
          <span style="display: flex; align-items: center; font-size: 13px; color: var(--c-accent)">すべてのセッション 128 件</span>
          <span style="margin-left: auto; display: flex; align-items: center; font-size: 17px; color: var(--c-line-strong)">›</span>
        `, 0);

// 【本人指示】最大3件。3件を超えるぶんは**この枠の中でスクロール**する。
// 枠の高さは 3件ぶんで固定し、4件目の頭が見えるようにはしない(件数は上の「n 件」が言う)。
function sDayPanel(count = 4) {
  const rows = S_SESSIONS.slice(0, count).map(sSessionRow).join("\n      ");
  const scroll = count > 3;
  // 【本人がキャンバスで削除】件数の行(「4 件」)も外した。S1 で日付の見出しを消したのと同じ扱いで、
  // **開いた枠の中はセッションのカードだけ**になる(参考画像のタスク一覧と同じ形)。
  return `<div style="${scroll ? `max-height: ${S_ROW_H * 3}px; overflow-y: auto; -webkit-overflow-scrolling: touch;` : ""} padding: 0 2px">
      ${rows}
      </div>`;
}

const sIdealNote = `<div style="font-size: 11px; color: var(--c-ink-3); padding-top: 10px">目安未設定</div>`;
// 集計範囲セレクタ。S1 は本人が 10px に落としている
const sScope = (fs = 12) => `<div style="margin-left: auto; display: flex; align-items: center; flex-shrink: 0">
          <span style="min-height: 44px; display: inline-flex; align-items: center; font-size: ${fs}px; color: var(--c-ink-3)">Alto ▾</span>
          <span style="font-size: ${fs}px; color: var(--c-ink-3); white-space: pre"> · </span>
          <span style="min-height: 44px; display: inline-flex; align-items: center; font-size: ${fs}px; color: var(--c-ink-3)">1ヶ月 ▾</span>
        </div>`;
const sTrendCard = (scopeFs = 12, formula = null) => sCard([
  rMetricTabs("平均差分", scopeFs ? sScope(scopeFs) : ""),
  formula || rFormula("8/24", "×", "my平均"),
  `<div>${rChart(170, 375 - 14 * 2 - 16 * 2)}</div>`,
  sIdealNote,
].join("\n        "));

const sGap = `<div style="height: 12px"></div>`;
const sChapter = (t) => `<div style="font-size: 15px; font-weight: 600; color: var(--c-ink); padding: 0 4px 8px">${t}</div>`;
const sPage = (inner, note) => `<div style="width: 375px; background: var(--c-sunk); padding: 0 14px 18px; box-sizing: border-box">
      ${rSubTab()}
      <div style="padding-top: 8px">
        ${inner}
      </div>
      <div style="margin-top: 16px; padding: 10px 12px; background: var(--c-surface); border-radius: 12px; box-shadow: ${S_SHADOW}; font-size: 11px; color: var(--c-ink-2); line-height: 1.6">${note}</div>
    </div>`;

// ---- S1(採用) 閉じた状態: 日付を押していないので、セッションは出ていない --------
{
  const inner = [sStatsThree(), sGap, sCalendarCard({ month: "2026/8", metaBeside: true, sel: null }), sGap, sAllSessions(), sGap, sTrendCard(10)].join("\n        ");
  writeFileSync(OUT + "S1.dc.html", dcFile(sPage(inner, `<b>採用案の既定の姿</b>(日付を押していない状態)。<br>本人指示で<b>その日のセッションは常時表示をやめた</b>ので、ここには出ていない ── カレンダーのすぐ下は「すべてのセッション」、その下が折れ線。<br><b>カレンダーの月見出し</b>は yyyy/m。合計(3.7 時間 · 16 日)は月見出しの<b>右・下揃え</b>(baseline)。文字の大きさが違っても足元が1本に揃い、<b>月の綴りが伸びても重ならない</b>(見た目のズラしを使っていないため)。<br>日付を押した状態は右の「S1 日付を押した状態」。`)));
  console.log("S1      採用案・閉じた状態");
}

// ---- S1open: 日付を押した状態 ------------------------------------------
{
  const inner = [
    sStatsThree(), sGap,
    sCalendarCard({ month: "2026/8", metaBeside: true, sel: 24 }),
    sGap,
    sDayPanel(4),
    sGap,
    sAllSessions(), sGap,
    sTrendCard(10),
  ].join("\n        ");
  writeFileSync(OUT + "S1open.dc.html", dcFile(sPage(inner, `<b>8/24 を押した状態。</b>カレンダーと「すべてのセッション」の<b>間に</b>その日のセッションが開き、<b>下のカード(すべてのセッション・折れ線)がそのぶん下へ押し出される</b>。<br><b>動き</b>: 開くときは高さ 0 → 実寸へ(200ms・ease-out)、閉じるときは逆。押した日付は紺の塗りになる。<b>他の場所をタップすると閉じる</b>(カレンダーの外側・同じ日付をもう一度・別の日付を押せばその日に切り替わる)。<br><b>最大3件</b>。4件目からは<b>この枠の中でスクロール</b>する(枠の高さは3件ぶんで固定)。件数は右上の「4 件」が言う。<br>この絵は4件のうち3件ぶんが見えている状態。`)));
  console.log("S1open  採用案・日付を押した状態(3件 + スクロール)");
}

// ---- S2 / S3(本人が綴りを戻した版のまま) --------------------------------
{
  const inner = [sStatsHero(), sGap, sCalendarCard(), sGap, sSectionHead("8月24日 のセッション", "2 件"), S_SESSIONS.slice(0, 2).map(sSessionRow).join("\n      "), sAllSessions(), sGap, sTrendCard(12)].join("\n        ");
  writeFileSync(OUT + "S2.dc.html", dcFile(sPage(inner, `<b>不採用</b>(本人裁定で S1 を採用)。記録として残す。<br>積み上げの中で<b>いちばん効く1つ(総時間)だけ</b>を大きく出す案。`)));
  console.log("S2      (不採用・記録)");
}
{
  const inner = [sStatsTwoTier(), sGap, sCalendarCard(), sGap, sSectionHead("8月24日 のセッション", "2 件"), S_SESSIONS.slice(0, 2).map(sSessionRow).join("\n      "), sAllSessions(), sGap, sChapter("音の傾向"), sTrendCard(0)].join("\n        ");
  writeFileSync(OUT + "S3.dc.html", dcFile(sPage(inner, `<b>不採用</b>(本人裁定で S1 を採用)。記録として残す。<br>「この1ヶ月」を主役にして、集計範囲のセレクタを<b>それが効く数字の隣</b>に置いた案。`)));
  console.log("S3      (不採用・記録)");
}

// ---- 式の行: いまの形からのマイナーチェンジ(Chips.dc.html) ----------------
// 本人「C1・C2・C3 はいずれもいまいち。**今のデザインをベースにマイナーチェンジ**で良い案を」。
// いまの形 = 高さ 20px のピル2つ(枠が系列の色) + 記号、行の高さ 35px。
// 4案とも**変えるのは1点だけ**にしてある(何が効いたのかが分かるように)。
function chipRow(chips, opts = {}) {
  const { op = "×", opFs = 16, opColor = "var(--c-ink-3)", gap = 8, h = 35 } = opts;
  return `<div style="display: flex; align-items: center; gap: ${gap}px; height: ${h}px">
          ${chips[0]}
          <span style="font-size: ${opFs}px; line-height: 1; color: ${opColor}; flex-shrink: 0">${op}</span>
          ${chips[1]}
          <div style="display: flex; gap: 2px; margin-left: auto; flex-shrink: 0">
            <div style="height: ${h}px; min-width: ${h}px; display: inline-flex; align-items: center; justify-content: center"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--c-accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg></div>
            <div style="height: ${h}px; min-width: ${h}px; display: inline-flex; align-items: center; justify-content: center"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink-3)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" /></svg></div>
          </div>
        </div>`;
}
// いまの形のピル
const pillNow = (label, color) => `<span style="display: inline-flex; align-items: center; height: 20px; padding: 0 13px; border-radius: var(--r-sm); background: transparent; border: 1px solid ${color}; font-size: 12px; font-weight: 600; color: var(--c-ink-2)">${label}</span>`;
// M1: ▾ を足すだけ
const pillCaret = (label, color) => `<span style="display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 9px 0 13px; border-radius: var(--r-sm); background: transparent; border: 1px solid ${color}; font-size: 12px; font-weight: 600; color: var(--c-ink-2)">${label}<span style="font-size: 9px; color: var(--c-line-strong)">▾</span></span>`;
// M2: 枠をやめて地を敷く。色は**文字**が持つ
const pillGround = (label, color) => `<span style="display: inline-flex; align-items: center; height: 20px; padding: 0 13px; border-radius: var(--r-sm); background: var(--c-sunk); font-size: 12px; font-weight: 600; color: ${color}">${label}</span>`;
// M3: 枠は共通の --c-line-strong。色は**先頭の丸**が持つ
const pillDot = (label, color) => `<span style="display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 12px; border-radius: var(--r-sm); background: transparent; border: 1px solid var(--c-line-strong); font-size: 12px; font-weight: 600; color: var(--c-ink-2)"><span style="width: 6px; height: 6px; border-radius: 50%; background: ${color}; flex-shrink: 0"></span>${label}</span>`;
// M4: 記号と余白を詰める(ピルは 22px、padding 10、gap 6、記号は小さく薄く)
const pillTight = (label, color) => `<span style="display: inline-flex; align-items: center; height: 22px; padding: 0 10px; border-radius: var(--r-sm); background: transparent; border: 1px solid ${color}; font-size: 12px; font-weight: 600; color: var(--c-ink-2)">${label}</span>`;

const chipMiniChart = (h = 44) => {
  const w = 315 - 28;
  const pts = (o) => Array.from({ length: 12 }, (_, i) => `${r2((i / 11) * w)},${r2(h / 2 + Math.sin(i / 1.6 + o) * (h / 2 - 4))}`).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display: block; margin-top: 8px">
          <polyline fill="none" points="${pts(0)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" style="stroke: var(--c-accent)" />
          <polyline fill="none" points="${pts(1.1)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" style="stroke: var(--c-accent-mid)" />
        </svg>`;
};
function chipSample(title, body, note, dim) {
  return `<div style="margin-bottom: 14px">
        <div style="font-size: 12px; font-weight: 600; color: ${dim ? "var(--c-ink-3)" : "var(--c-ink)"}; padding: 0 2px 6px">${title}</div>
        ${sCard(body, 14)}
        <div style="font-size: 10.5px; color: var(--c-ink-3); line-height: 1.5; padding: 6px 2px 0">${note}</div>
      </div>`;
}
{
  const A = "var(--c-accent)", B = "var(--c-accent-mid)";
  const now  = chipRow([pillNow("8/24", A), pillNow("my平均", B)]) + chipMiniChart();
  const m1   = chipRow([pillCaret("8/24", A), pillCaret("my平均", B)]);
  const m2   = chipRow([pillGround("8/24", A), pillGround("my平均", B)]);
  const m3   = chipRow([pillDot("8/24", A), pillDot("my平均", B)]);
  const m4   = chipRow([pillTight("8/24", A), pillTight("my平均", B)], { opFs: 13, opColor: "var(--c-line-strong)", gap: 6 });
  const body = `<div style="width: 375px; background: var(--c-sunk); padding: 14px 14px 18px; box-sizing: border-box">
      <div style="font-size: 15px; font-weight: 600; color: var(--c-ink); padding: 0 2px 4px">式の行 ─ いまの形からのマイナーチェンジ</div>
      <div style="font-size: 11px; color: var(--c-ink-3); line-height: 1.6; padding: 0 2px 12px">ゼロベースの3案(C1〜C3)は取り下げ。<b>変えるのは1案につき1点だけ</b>にしてあるので、効いた点がそのまま分かります。行の高さ 35px・ピル 20px・色は系列と対応、はどの案も据え置き。</div>
      ${chipSample("いまの形(比較用)", now, "枠が系列の色、地は透明、記号は 16px。<b>引っかかりの候補</b>: ①押せる印が無い ②枠だけの箱が入力欄に見える ③色が「枠」にしか出ていないので、線との対応が一拍遅れる。下の折れ線と見比べてください。", true)}
      ${chipSample("案M1 ▾ を足す", m1, "<b>変えた1点</b>: ピルの右に 9px の ▾。<b>押せることが分かる</b>のが唯一の狙いで、他は1pxも変えていない。いちばん小さい変更。")}
      ${chipSample("案M2 枠をやめて地を敷き、色は文字が持つ", m2, "<b>変えた1点</b>: 枠 → 地(--c-sunk)。色は**文字**へ移した。<b>入力欄に見える原因(枠だけの箱)が消え</b>、押せる面に見える。文字が系列色になるので、線との対応もむしろ強い。")}
      ${chipSample("案M3 枠は共通、色は先頭の丸が持つ", m3, "<b>変えた1点</b>: 枠を共通の --c-line-strong にして、色を <b>6px の丸</b>へ移した。枠=「選ぶ器」/ 丸=「どの線か」と役割が分かれる。凡例の丸と同じ読み方になる。")}
      ${chipSample("案M4 余白と記号を詰める", m4, "<b>変えた1点</b>: ピルを 20→22px・左右の余白 13→10px、記号を 16→13px の --c-line-strong、間隔 8→6px。<b>横に間延びした感じ</b>が引っかかりの正体なら、これがいちばん効く。")}
      <div style="margin-top: 4px; padding: 10px 12px; background: var(--c-surface); border-radius: 12px; box-shadow: ${S_SHADOW}; font-size: 11px; color: var(--c-ink-2); line-height: 1.6"><b>窓型のとき</b>: どの案も色を持たせない(M2 の文字は --c-ink-2 / M3 の丸は出さない / M1・M4 の枠は --c-line-strong)。窓型には対応する線が無いためです。<br><b>混ぜられます</b>: M1 の ▾ は M2・M3・M4 のどれにも足せます(足すと押せる印と、選んだ形の両方が揃う)。</div>
    </div>`;
  writeFileSync(OUT + "Chips.dc.html", dcFile(body));
  console.log("Chips   式の行 マイナーチェンジ4案");
}

// ---- 分析タブ(A1 採用。本人の手直しを写す) -------------------------------
const aSubTab = `<div style="display: flex; align-items: center; gap: 0; margin-left: -9px">
        <div style="min-height: 44px; padding: 0 9px; display: flex; align-items: center; font-size: 15px; color: var(--c-ink-3); font-weight: 400; line-height: 1.2">My Data</div>
        <div style="min-height: 44px; padding: 0 9px; display: flex; align-items: center; font-size: 22px; color: var(--c-ink); font-weight: 600; line-height: 1.2">分析</div>
      </div>`;
// 【本人の手直し】「条件」→「**抽出条件**」
const aDesc = `<div style="font-size: 12px; color: var(--c-ink-3); line-height: 1.6; padding: 0 4px 8px">抽出条件・縦軸・横軸・分析軸を選ぶと、蓄積データをマトリクスで集計します</div>`;
// 【本人の手直し】チップ行 30px / 「編集」10px / 軸の行 30px / カード全体 80px
const aChips = `<div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; height: 30px">
          <span style="display: inline-flex; align-items: center; height: 30px">
            <span style="display: inline-flex; align-items: center; padding: 4px 11px; font-size: 11px; font-weight: 600; color: var(--c-accent); background: var(--c-accent-tint); border-radius: 999px; line-height: 1.4">楽器 = Alto</span>
          </span>
          <span style="display: inline-flex; align-items: center; height: 30px">
            <span style="display: inline-flex; align-items: center; padding: 4px 11px; font-size: 11px; color: var(--c-ink-2); border: 1px dashed var(--c-line-strong); border-radius: 999px; line-height: 1.4">＋ 条件</span>
          </span>
          <span style="margin-left: auto; display: inline-flex; align-items: center; height: 30px; font-size: 10px; color: var(--c-accent)">編集</span>
        </div>`;
function aChart() {
  const rows = 9, w = 347 - 32 - 44, h = 25;
  const series = [
    { c: "var(--c-accent)", d: [0.55, 0.48, 0.42, 0.5, 0.6, 0.52, 0.45, 0.38, 0.44] },
    { c: "var(--c-accent-mid)", d: [0.35, 0.4, 0.52, 0.58, 0.5, 0.44, 0.5, 0.56, 0.6] },
  ];
  const notes = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5"];
  const lines = series.map((s) => `<polyline fill="none" points="${s.d.map((v, i) => `${r2(44 + v * w)},${r2(i * h + h / 2)}`).join(" ")}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" style="stroke: ${s.c}" />`).join("\n          ");
  const labels = notes.map((n, i) => `<text x="38" y="${r2(i * h + h / 2 + 4)}" font-size="11" text-anchor="end" font-family="var(--font-num)" style="fill: var(--c-ink-3)">${n}</text>`).join("\n          ");
  return `<svg width="${347 - 32}" height="${rows * h}" viewBox="0 0 ${347 - 32} ${rows * h}" style="display: block">
          <line x1="${r2(44 + w / 2)}" y1="0" x2="${r2(44 + w / 2)}" y2="${rows * h}" stroke-width="1" style="stroke: var(--c-line-strong)" />
          ${labels}
          ${lines}
        </svg>`;
}
const aSel = (label, value, wide) => `<span style="display: inline-flex; align-items: baseline; gap: 5px; ${wide ? "flex: 1; min-width: 0;" : ""}">
            <span style="font-size: 10px; color: var(--c-ink-3); flex-shrink: 0">${label}</span>
            <span style="font-size: 13px; font-weight: 600; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${value} ▾</span>
          </span>`;
{
  const inner = `${aDesc}
      <div style="background: var(--c-surface); border-radius: 16px; box-shadow: ${S_SHADOW}; padding: 16px">
        ${aChips}
        <div style="display: flex; align-items: center; gap: 10px; min-height: 30px">${aSel("縦軸", "音名")}${aSel("横軸", "平均差分")}${aSel("分析軸", "リード", true)}</div>
      </div>
      ${sGap}
      ${sCard(aChart())}`;
  writeFileSync(OUT + "A1.dc.html", dcFile(`<div style="width: 375px; background: var(--c-sunk); padding: 0 14px 18px; box-sizing: border-box">
      ${aSubTab}
      <div style="padding-top: 8px">${inner}</div>
      <div style="margin-top: 16px; padding: 10px 12px; background: var(--c-surface); border-radius: 12px; box-shadow: ${S_SHADOW}; font-size: 11px; color: var(--c-ink-2); line-height: 1.6"><b>採用案</b>。本人の手直しを反映: 「条件」→<b>「抽出条件」</b> / チップの行と軸の行を <b>30px</b> に詰める / 「編集」を 10px。<br><b>減った縦幅</b>: 軸のセレクタが 77 → <b>30px</b>、カード全体で 80px。<br><b>代償</b>: 44pt を割る行が2つ増える(チップ行・軸の行)。§5 の例外を<b>My Data の式の行に加えてもう2つ</b>作ることになるので、DESIGN-SYSTEM に明記が要る。<br><b>脚注</b>: 「637 音 · 26 セッション · 0.2 時間」は My Data の先頭へ移すので、この画面からは消える。</div>
    </div>`));
  console.log("A1      分析: 採用案(本人の手直し込み)");
}
{
  const inner = `${aDesc}
      ${sCard(`${aChips}
        <div style="display: flex; align-items: center; gap: 10px; min-height: 30px"><span style="font-size: 10px; color: var(--c-ink-3); flex-shrink: 0">軸</span>
          <span style="font-size: 13px; font-weight: 600; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">音名 × 平均差分(¢) / リード</span>
          <span style="margin-left: auto; font-size: 15px; color: var(--c-line-strong)">▾</span>
        </div>`)}
      ${sGap}
      ${sCard(aChart())}`;
  writeFileSync(OUT + "A2.dc.html", dcFile(`<div style="width: 375px; background: var(--c-sunk); padding: 0 14px 18px; box-sizing: border-box">
      ${aSubTab}
      <div style="padding-top: 8px">${inner}</div>
      <div style="margin-top: 16px; padding: 10px 12px; background: var(--c-surface); border-radius: 12px; box-shadow: ${S_SHADOW}; font-size: 11px; color: var(--c-ink-2); line-height: 1.6"><b>不採用</b>(本人裁定で A1 を採用)。記録として残す。<br>3つの軸を1行に畳んで、押すとシートで選ぶ案。</div>
    </div>`));
  console.log("A2      (不採用・記録)");
}
