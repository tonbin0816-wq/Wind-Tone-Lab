import { writeFileSync } from "node:fs";
const OUT = "/home/user/Wind-Tone-Lab/design/canvas/";
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
function layout({ vals, zeroCentered, fmt, refVals, plotH = PLOT_H, meanCentered = false }) {
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
  const x1 = Math.max(x0 + 1, W - SVG_SP2 - halfLbl);
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

function chartSvg({ series, L, zeroCentered, bandAbs, refVals, edgeGridLines = true }) {
  const p = [];
  p.push(`<svg width="${W}" height="${L.H}" viewBox="0 0 ${W} ${L.H}" style="display: block">`);
  if (zeroCentered && bandAbs > 0) {
    const yTop = L.yAt(Math.min(bandAbs, L.hi)), yBot = L.yAt(Math.max(-bandAbs, L.lo));
    p.push(`<rect x="0" y="${r2(yTop)}" width="${W}" height="${r2(yBot - yTop)}" stroke="none" style="fill: var(--c-quiet); opacity: ${CHART_OK_BAND_OPACITY}" />`);
  }
  if (edgeGridLines) {
    for (const v of L.tickVals) {
      p.push(`<line x1="0" y1="${r2(L.yAt(v))}" x2="${W}" y2="${r2(L.yAt(v))}" stroke-width="1" style="stroke: var(--c-line)" />`);
    }
  }
  // 【D-9u】中央線は1本だけ。平均差分は 0、他3指標はその指標の平均
  if (L.center !== null && L.center !== undefined) {
    p.push(`<line x1="0" y1="${r2(L.yAt(L.center))}" x2="${W}" y2="${r2(L.yAt(L.center))}" stroke-width="1" style="stroke: var(--c-line-strong)" />`);
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
${block("案R ─ 「PIVOT」を空いた右端へ", "セレクタがいた場所に名前が入る。<b>見出しは「分析」1つだけ</b>になり、表題の行（15px + 余白4）が丸ごと消えて <b>19px 縮む</b>。「PIVOT の文字があれば Excel も想起できる」（F-99）は名前が残るので保たれる。",
    `            ${subTab(true, '<div style="margin-left: auto; font-size: 12px; color: var(--c-accent); font-weight: 700; flex-shrink: 0">PIVOT</div>')}\n            <div style="padding-top: 8px">${desc}${condRow}${ghost}</div>`, 44)}
      </div>
      <div style="margin-top: 16px; padding: 10px 12px; background: var(--c-sunk); border-radius: 8px; font-size: 11px; color: var(--c-ink-2); line-height: 1.6">
        文字組みは <span style="font-family: var(--font-num)">15px / --c-accent / 700</span> → <span style="font-family: var(--font-num)">12px / --c-accent / 700</span>。<br>
        大きさだけ落として色は残す ─ 12px は集計範囲セレクタと同じ段なので、<b>右端の作法がそのまま引き継がれる</b>。新しい値は使っていない。
      </div>
    </div>`;
  writeFileSync(OUT + "AnalysisTop.dc.html", dcFile(body));
  console.log("AnalysisTop D-9r 案R（PIVOT を右端へ / 上部 63 → 44px）");
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
