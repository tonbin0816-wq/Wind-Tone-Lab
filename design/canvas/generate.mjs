import { writeFileSync } from "node:fs";
const OUT = "/home/user/Wind-Tone-Lab/design/canvas/";

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
function layout({ vals, zeroCentered, fmt, refVals }) {
  const all = [...vals.flat().filter((v) => v !== null), ...(refVals ? refVals.filter((v) => v !== null) : [])];
  let lo, hi;
  if (zeroCentered) { hi = Math.max(...all.map(Math.abs)) || 1; lo = -hi; }
  else {
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
  const center = (N - 1) / 2;
  const midEb = ebIdx.reduce((b, i) => (Math.abs(i - center) < Math.abs(b - center) ? i : b), ebIdx[0]);
  const dotR = Math.max(1.5, Math.min(3, colStep * 0.3));
  const labelY = PAD_TOP + PLOT_H + SVG_SP2 + Math.round(FS * 0.8);
  const yAt = (v) => PAD_TOP + PLOT_H - ((v - lo) / rng) * PLOT_H;
  return {
    lo, hi, FS, tickVals, tickTexts, dotR, labelY, midEb, labelStep,
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

function chartSvg({ series, L, zeroCentered, bandAbs, refVals }) {
  const p = [];
  p.push(`<svg width="${W}" height="${L.H}" viewBox="0 0 ${W} ${L.H}" style="display: block">`);
  if (zeroCentered && bandAbs > 0) {
    const yTop = L.yAt(Math.min(bandAbs, L.hi)), yBot = L.yAt(Math.max(-bandAbs, L.lo));
    p.push(`<rect x="0" y="${r2(yTop)}" width="${W}" height="${r2(yBot - yTop)}" stroke="none" style="fill: var(--c-quiet); opacity: ${CHART_OK_BAND_OPACITY}" />`);
  }
  for (const v of L.tickVals) {
    p.push(`<line x1="0" y1="${r2(L.yAt(v))}" x2="${W}" y2="${r2(L.yAt(v))}" stroke-width="1" style="stroke: var(--c-line)" />`);
  }
  if (zeroCentered) {
    p.push(`<line x1="0" y1="${r2(L.yAt(0))}" x2="${W}" y2="${r2(L.yAt(0))}" stroke-width="1" style="stroke: var(--c-line-strong)" />`);
  }
  p.push(`<line x1="${r2(L.xAt(L.midEb))}" y1="${PAD_TOP}" x2="${r2(L.xAt(L.midEb))}" y2="${PAD_TOP + PLOT_H}" stroke-width="1" style="stroke: var(--c-line)" />`);
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
  writeFileSync(OUT + "Main.dc.html", dcFile(body));
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
  writeFileSync(OUT + "Windows.dc.html", dcFile(body));
  console.log("Windows octaves=" + upper.octaves.join(",") + " maxAbs=" + upper.maxAbs + " cells=" + upper.count);
}
