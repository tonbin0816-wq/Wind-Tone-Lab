// 詳細画面(セッション個別 / リード個体)の実寸モックを書き出す。
//
//   node design/canvas/detail.mjs
//
// 【正典は src/App.jsx】写しであって提案ではない。寸法・色・語句をここで発明しない。
//
// 【この2画面は本文幅が違う】ここを揃えると嘘になる:
//   ・セッション詳細 … 本文 347px(375 − --page-side-pad 14 × 2)。カード内側 315px
//   ・リード詳細     … 本文 327px(さらに左右 10px の padding が入る)。カード内側 295px
//   同じ MetricTabCard でも SVG の幅が変わり、点の間隔も半径も変わる。
//
// 数値と日付は**ダミー**。実データではない。
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dcFile } from "./tokens.mjs";

const OUT = fileURLToPath(new URL("./", import.meta.url));

// ---- 共有の作法 ---------------------------------------------------------
// .surf-card .card(index.css) … 地は白・枠なし・16px の丸・16px の内側余白・影
const CARD = "background: var(--c-surface); border: 0; border-radius: var(--r-lg); padding: var(--sp-4); box-shadow: var(--shadow-card)";
// .surf-card .rowcard … 12px の丸・10/14 の内側余白
const ROWCARD = "background: var(--c-surface); border: 0; border-radius: var(--r-md); padding: 10px 14px; box-shadow: var(--shadow-row)";
const NUM = "font-family: var(--font-num)";

// 12px の送り幅の近似(measureSvgTextPx の代わり)。generate.mjs と同じ係数。
const textPx = (s, fs = 12) => {
  let w = 0;
  for (const ch of String(s)) w += /[0-9]/.test(ch) ? fs * 0.556 : /[♯♭.+-]/.test(ch) ? fs * 0.6 : fs * 0.667;
  return w;
};

// DetailHeader(App.jsx 13722〜)
function detailHeader({ backLabel, actions = "", title, titleSuffix = "", meta }) {
  return `<div style="padding-bottom: var(--sp-3)">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px">
          <div style="min-height: 44px; min-width: 44px; padding: 0 8px 0 0; display: flex; align-items: center; font-size: 13px; color: var(--c-accent); text-align: left">${backLabel}</div>
          ${actions ? `<div style="display: flex; align-items: center; gap: 14px">${actions}</div>` : ""}
        </div>
        <div style="display: flex; align-items: baseline; gap: 9px; margin-top: 6px; flex-wrap: wrap">
          <span style="${NUM}; font-size: var(--fs-2xl); font-weight: 600; letter-spacing: -.01em; color: var(--c-ink)">${title}</span>
          ${titleSuffix ? `<span style="font-size: var(--fs-sm); color: var(--c-ink-3)">${titleSuffix}</span>` : ""}
        </div>
        <div style="display: flex; align-items: center; gap: 7px; margin-top: 5px; font-size: var(--fs-xs); color: var(--c-ink-2); flex-wrap: wrap">
${meta.map((t, i) => `          <span style="display: inline-flex; align-items: center; gap: 7px">${i > 0 ? `<span style="color: var(--c-line-strong)">·</span>` : ""}<span>${t}</span></span>`).join("\n")}
        </div>
      </div>`;
}

// MetricUnderlineTabs(bordered を渡さない = 下辺の罫を引かない)。marginLeft -8 / padding 0 8
function metricTabs(items, sel) {
  return `<div style="display: flex; align-items: center; gap: 0; margin-left: -8px">
${items.map((t) => `          <div style="min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 8px">
            <span style="display: inline-flex; align-items: center; min-height: 26px; padding: 0 2px; font-size: var(--fs-sm); font-weight: 600; color: ${t === sel ? "var(--c-ink)" : "var(--c-ink-3)"};${t === sel ? " box-shadow: inset 0 -2px 0 0 var(--c-ink);" : ""}">${t}</span>
          </div>`).join("\n")}
        </div>`;
}

// ---- NoteAxisLineChart(plain)-------------------------------------------
// 音域は**フラジオ込みの全音**(alto: MIDI 49〜85 の 37 音)。
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];
const LOW_MIDI = 49, N_NOTES = 37;
const noteName = (i) => {
  const m = LOW_MIDI + i;
  return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
};
// 中央の E♭(記音)。縦の点線ガイドと、太字の音名ラベルが付く唯一の音。
const MID_EB = 14; // MIDI 63 = E♭4

function noteChart({ W, vals, ideal = null, digits = 1, fmt = (v) => v.toFixed(digits) }) {
  const FS = 12, PLOT_H = 94, PAD_TOP = 8;
  const all = [...vals.filter((v) => v !== null), ...(ideal ? ideal.filter((v) => v !== null) : [])];
  const mn = Math.min(...all), mx = Math.max(...all);
  const pad = (mx - mn) * 0.12 || 1;
  const lo = mn - pad, hi = mx + pad, rng = hi - lo;
  const ticks = [hi, (hi + lo) / 2, lo];
  const tickW = Math.max(...ticks.map((v) => textPx(fmt(v))));
  const AXW = 12 + tickW + 12;
  const labels = Array.from({ length: N_NOTES }, (_, i) => noteName(i));
  const halfLbl = Math.ceil(Math.max(...labels.map((s) => textPx(s))) / 2) + 4;
  const x0 = AXW + halfLbl, x1 = Math.max(x0 + 1, W - 8 - halfLbl);
  const colStep = (x1 - x0) / (N_NOTES - 1);
  const dotR = Math.max(1.5, Math.min(3, colStep * 0.3));
  const labelY = PAD_TOP + PLOT_H + 8 + Math.round(FS * 0.8);
  const H = labelY + 4;
  const xAt = (i) => x0 + i * colStep;
  const yAt = (v) => PAD_TOP + PLOT_H - ((v - lo) / rng) * PLOT_H;
  // ラベルの間引き。1/2/3/4/6/12 から、隣が重ならない最初の段を選ぶ
  const need = Math.max(...labels.map((s) => textPx(s))) + 4;
  const step = [1, 2, 3, 4, 6, 12].find((s) => colStep * s >= need) ?? 12;

  const p = [`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display: block">`];
  for (const v of ticks) {
    p.push(`  <line x1="${AXW.toFixed(1)}" x2="${W}" y1="${yAt(v).toFixed(1)}" y2="${yAt(v).toFixed(1)}" stroke="var(--c-line)" stroke-width="1" />`);
    p.push(`  <text x="${(AXW - 12).toFixed(1)}" y="${(yAt(v) + 4).toFixed(1)}" text-anchor="end" font-size="12" ${NUM.replace("font-family: ", 'font-family="')}" fill="var(--c-ink-4)">${fmt(v)}</text>`);
  }
  // 中央 E♭ の縦ガイド(点線)。中央線は引かない。
  p.push(`  <line x1="${xAt(MID_EB).toFixed(1)}" x2="${xAt(MID_EB).toFixed(1)}" y1="8" y2="102" stroke="var(--c-accent-line)" stroke-width="1" stroke-dasharray="4 3" />`);
  // 目安の破線が先、実測が上
  const poly = (arr, stroke, width, dash) => {
    const runs = [];
    let cur = [];
    arr.forEach((v, i) => {
      if (v === null) { if (cur.length > 1) runs.push(cur); cur = []; return; }
      cur.push(`${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
    });
    if (cur.length > 1) runs.push(cur);
    for (const r of runs) p.push(`  <polyline points="${r.join(" ")}" fill="none" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} />`);
  };
  if (ideal) {
    poly(ideal, "var(--c-ink-3)", 2, "4 3");
    ideal.forEach((v, i) => { if (v !== null) p.push(`  <circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="${dotR.toFixed(2)}" stroke="var(--c-ink-3)" stroke-width="1" fill="var(--c-surface)" />`); });
  }
  poly(vals, "var(--c-accent)", 2, null);
  vals.forEach((v, i) => { if (v !== null) p.push(`  <circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="${dotR.toFixed(2)}" fill="var(--c-accent)" stroke="none" />`); });
  labels.forEach((s, i) => {
    const mid = i === MID_EB;
    if (!mid && i % step !== 0) return;
    p.push(`  <text x="${xAt(i).toFixed(1)}" y="${labelY}" text-anchor="middle" font-size="12" font-family="var(--font-num)" font-weight="${mid ? 700 : 400}" fill="${mid ? "var(--c-accent)" : "var(--c-ink-3)"}">${s}</text>`);
  });
  p.push(`</svg>`);
  return { svg: p.join("\n            "), AXW };
}

// 系列の見本(SeriesSwatch)
function swatch(color, width, dash) {
  return `<span style="display: inline-flex; align-items: center; flex-shrink: 0; background: var(--c-on-accent); border-radius: 2px; padding: 2px"><svg width="14" height="${width}"><line x1="0" y1="${width / 2}" x2="14" y2="${width / 2}" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""} /></svg></span>`;
}

// MemoField(App.jsx)。**地も枠も見えない**(index.css の入力欄の地をインラインで消している)
function memoField(text) {
  return `<div style="display: block; min-height: 44px">
          <span style="display: block; font-size: 10.5px; color: var(--c-ink-3); margin-bottom: 3px">メモ</span>
          <div style="width: 100%; display: block; padding: 0; font-size: var(--fs-xs); line-height: 1.6; color: ${text ? "var(--c-ink)" : "var(--c-ink-3)"}; background: none; border: 1px solid transparent">${text || "タップして入力"}</div>
        </div>`;
}

// ---- セッション個別 -----------------------------------------------------
const SESSION_W = 315; // 375 − 14×2 − 16×2

function buildSession() {
  // 平均差分(¢)。フラジオ域は吹いていないので欠測にする(区間が切れることを見せる)
  const vals = [-9.2, -7.8, -6.1, -5.4, -3.9, -2.6, -1.4, -0.2, 0.9, 1.8, 2.4, 1.6, 0.5, -0.9, -2.1, -3.4, -2.7, -1.3,
    0.4, 1.9, 3.2, 4.6, 5.8, 6.4, 5.5, 4.1, 2.6, 1.1, -0.7, -2.4, -4.6, -6.5, -8.1, null, null, null, null];
  const ideal = [-6.4, -5.6, -4.7, -3.9, -3.0, -2.2, -1.3, -0.5, 0.4, 1.2, 1.7, 1.2, 0.4, -0.5, -1.3, -2.2, -1.7, -0.8,
    0.3, 1.2, 2.2, 3.1, 3.9, 4.3, 3.7, 2.8, 1.8, 0.7, -0.5, -1.6, -3.0, -4.2, -5.0, null, null, null, null];
  const { svg, AXW } = noteChart({
    W: SESSION_W, vals, ideal, digits: 1,
    fmt: (v) => (Math.abs(v) < 0.05 ? "0.0" : v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
  });

  // PhraseTimeline: 幅は max(600, フレーム数 × 6) の**実寸**。カード幅に追従せず横スクロールする
  const FRAMES = 100;
  const pitch = Array.from({ length: FRAMES }, (_, i) => {
    const base = 40 + 42 * Math.sin(i / 9) + 10 * Math.sin(i / 2.3);
    return i > 22 && i < 27 ? null : base;
  });
  const minV = Math.min(...pitch.filter((v) => v !== null)), maxV = Math.max(...pitch.filter((v) => v !== null));
  const py = (v) => (v === null ? 100 : 100 - ((v - minV) / (maxV - minV)) * 90);
  const pts = pitch.map((v, i) => `${i * 6},${py(v).toFixed(1)}`).join(" ");
  const score = (i) => (i > 22 && i < 27 ? "#C3CAD3" : i % 17 < 3 ? "#D97706" : i % 29 === 0 ? "#DC2626" : "#16A34A");
  const bars = Array.from({ length: FRAMES }, (_, i) => `    <rect x="${i * 6}" y="110" width="5" height="8" fill="${score(i)}" />`).join("\n");
  const noteLabels = [[3, "C4"], [21, "E♭4"], [45, "G4"], [72, "B♭4"], [93, "E♭5"]]
    .map(([i, t]) => `    <text x="${i * 6}" y="9" font-size="11" font-weight="700" fill="#174585" font-family="var(--font-num)">${t}</text>`).join("\n");

  return `<div style="width: 375px; background: var(--c-bg); padding: 16px 14px; box-sizing: border-box">
      ${detailHeader({
        backLabel: "‹ 一覧",
        actions: `<span style="background: transparent; border: 1px solid var(--c-line-strong); border-radius: var(--r-pill); font-size: var(--fs-xs); padding: 5px 10px; color: var(--c-accent); font-weight: 600; flex-shrink: 0; white-space: nowrap">★ 目安に設定</span>
            <span style="min-height: 44px; min-width: 44px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11.5px; color: var(--c-accent); font-weight: 600">編集</span>`,
        title: "9/6",
        titleSuffix: "19:42",
        meta: ["自分", "A.Sax", "Vandoren-3 #1", "21.7秒"],
      })}

      <div style="${CARD}; margin-top: var(--sp-3)">
        ${metricTabs(["平均差分", "HNR", "重心", "音量"], "平均差分")}
        <div style="margin-bottom: 0">
          ${svg}
        </div>
        <div style="display: flex; gap: 12px; margin-top: 6px; font-size: 12px; color: #435266; padding-left: ${AXW.toFixed(0)}px">
          <span style="display: flex; align-items: center; gap: 4px">${swatch("var(--c-accent)", 2, null)}実測</span>
          <span style="display: flex; align-items: center; gap: 4px">${swatch("var(--c-ink-3)", 2, "4 3")}目安</span>
        </div>
      </div>

      <div style="${CARD}; margin-top: var(--sp-3)">
        <div style="font-size: 10.5px; font-weight: 600; letter-spacing: .08em; color: var(--c-ink-3); padding-bottom: 10px">録音</div>
        <div style="padding: 10px 0; margin-bottom: 10px">
          <div style="font-size: 12px; color: #435266; margin-bottom: 8px">タイムライン<span style="margin-left: 8px">｜ 検出ノート 5 ・ 平均アタック 164ms</span></div>
          <!-- 【幅はカードに追従しない】max(600, フレーム数×6) の実寸で、はみ出したぶんは横スクロール -->
          <div style="overflow-x: auto">
            <svg width="600" height="120" style="display: block">
    <line x1="150" x2="150" y1="0" y2="108" stroke="#C3CAD3" stroke-width="1" />
    <line x1="330" x2="330" y1="0" y2="108" stroke="#C3CAD3" stroke-width="1" />
${noteLabels}
    <polyline points="${pts}" fill="none" stroke="#174585" stroke-width="1.5" />
${bars}
    <line x1="272.5" x2="272.5" y1="0" y2="118" stroke="#121F32" stroke-width="1" stroke-dasharray="2,2" />
            </svg>
          </div>
          <div style="width: 100%; margin-top: 8px; height: 4px; border-radius: 2px; background: var(--c-line-strong); position: relative">
            <span style="position: absolute; left: 45%; top: -6px; width: 16px; height: 16px; border-radius: 50%; background: #174585"></span>
          </div>
          <div style="font-size: 12px; color: #8D95A1; display: flex; justify-content: space-between">
            <span>0s</span><span>21.7s</span>
          </div>
        </div>
        <div style="padding: 10px 0">
          <div style="font-size: 12px; color: #435266; margin-bottom: 10px">t = 9.78s の詳細</div>
          <div style="display: flex; flex-wrap: wrap; margin-bottom: 12px">
            <div style="flex: 1 1 0; min-width: 60px; text-align: center">
              <div style="${NUM}; font-size: 19px; font-weight: 600; color: #16A34A">0.94</div>
              <div style="font-size: 10.5px; color: var(--c-ink-3)">ピッチ一致度</div>
              <div style="font-size: 10.5px; color: var(--c-ink-3); min-height: 15px">440.6 Hz ／ 記音A4</div>
            </div>
            <div style="flex: 1 1 0; min-width: 60px; text-align: center">
              <div style="${NUM}; font-size: 19px; font-weight: 600; color: #D97706">0.61</div>
              <div style="font-size: 10.5px; color: var(--c-ink-3)">音色一致度(目安基準)</div>
              <div style="font-size: 10.5px; color: var(--c-ink-3); min-height: 15px">重心 1642Hz</div>
            </div>
          </div>
          <div style="font-size: 12px; color: #435266; margin-top: 10px; display: flex; gap: 14px; flex-wrap: wrap">
            <span>音量: -18.4 dB</span><span>HNR: 21.6 dB</span>
          </div>
        </div>
      </div>

      <div style="${CARD}; margin-top: var(--sp-3)">
        ${memoField("下のBから上のFまで。中音域のE♭がぶら下がる癖はまだ残っている")}
      </div>
    </div>`;
}

// ---- リード個体 ---------------------------------------------------------
const REED_W = 295; // 375 − 14×2 − 10×2 − 16×2

function buildReed() {
  const vals = [11.4, 12.8, 13.6, 14.9, 16.2, 17.4, 18.1, 19.6, 20.4, 21.2, 21.9, 22.4, 22.8, 23.1, 22.7, 22.2, 21.6, 20.9,
    20.2, 19.4, 18.7, 18.1, 17.4, 16.8, 16.1, 15.4, 14.6, 13.9, 13.1, 12.4, 11.6, 10.8, 10.1, null, null, null, null];
  const ideal = [12.8, 13.9, 14.8, 15.9, 17.0, 18.0, 18.8, 19.9, 20.6, 21.3, 21.9, 22.3, 22.6, 22.8, 22.5, 22.1, 21.6, 21.0,
    20.4, 19.7, 19.1, 18.6, 18.0, 17.5, 16.9, 16.3, 15.6, 15.0, 14.3, 13.7, 13.0, 12.3, 11.7, null, null, null, null];
  const { svg, AXW } = noteChart({ W: REED_W, vals, ideal, digits: 1 });

  const score = (v, label) => `        <div style="${ROWCARD}; flex: 1 1 0; min-width: 0; min-height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center">
          <span style="${NUM}; font-size: var(--fs-2xl); font-weight: 600; line-height: 1; color: ${v === "—" ? "var(--c-ink-3)" : "var(--c-accent)"}">${v}</span>
          <span style="font-size: var(--fs-xs); color: var(--c-ink-3); margin-top: 3px">${label}</span>
        </div>`;

  // 評価の推移。縦軸は 1〜5 で固定
  const HIST = [
    { d: "8/2", a: 3.4, b: null, c: null },
    { d: "8/9", a: 4.1, b: 4, c: 3 },
    { d: "8/18", a: 4.3, b: 4, c: 4 },
    { d: "8/27", a: 4.0, b: 4, c: 3 },
    { d: "9/2", a: 3.6, b: 3, c: 3 },
    { d: "9/6", a: 4.0, b: 4, c: 3 },
  ];
  const H_FS = 12, H_PLOT = 94, H_PADTOP = 12;
  const hTickW = textPx("5");
  const hAXW = 12 + hTickW + 12;
  const hHalf = Math.ceil(Math.max(...HIST.map((h) => textPx(h.d))) / 2) + 4;
  const hx0 = hAXW + hHalf, hx1 = Math.max(hx0 + 1, REED_W - 8 - hHalf);
  const hStep = (hx1 - hx0) / (HIST.length - 1);
  const hDotR = Math.max(1.5, Math.min(3, hStep * 0.3));
  const hLabelY = H_PADTOP + H_PLOT + 8 + Math.round(H_FS * 0.8);
  const hH = hLabelY + 8;
  const hxAt = (i) => hx0 + i * hStep;
  const hyAt = (v) => H_PADTOP + H_PLOT - ((v - 1) / 4) * H_PLOT;
  const hp = [`<svg width="${REED_W}" height="${hH}" viewBox="0 0 ${REED_W} ${hH}" style="display: block">`];
  for (const v of [5, 4, 3, 2, 1]) {
    hp.push(`  <line x1="${hAXW.toFixed(1)}" x2="${REED_W}" y1="${hyAt(v).toFixed(1)}" y2="${hyAt(v).toFixed(1)}" stroke="var(--c-line)" stroke-width="1" />`);
    hp.push(`  <text x="${(hAXW - 12).toFixed(1)}" y="${(hyAt(v) + 4).toFixed(1)}" text-anchor="end" font-size="12" font-family="var(--font-num)" fill="var(--c-ink-4)">${v}</text>`);
  }
  const SERIES = [["a", "var(--c-accent)", 2], ["b", "var(--c-accent-mid)", 2], ["c", "var(--c-accent-line)", 3]];
  for (const [k, color, w] of SERIES) {
    const seg = [];
    let cur = [];
    HIST.forEach((h, i) => {
      if (h[k] === null) { if (cur.length > 1) seg.push(cur); cur = []; return; }
      cur.push(`${hxAt(i).toFixed(1)},${hyAt(h[k]).toFixed(1)}`);
    });
    if (cur.length > 1) seg.push(cur);
    for (const s of seg) hp.push(`  <polyline points="${s.join(" ")}" fill="none" stroke="${color}" stroke-width="${w}" />`);
    HIST.forEach((h, i) => { if (h[k] !== null) hp.push(`  <circle cx="${hxAt(i).toFixed(1)}" cy="${hyAt(h[k]).toFixed(1)}" r="${hDotR.toFixed(2)}" fill="${color}" stroke="none" />`); });
  }
  HIST.forEach((h, i) => hp.push(`  <text x="${hxAt(i).toFixed(1)}" y="${hLabelY}" text-anchor="middle" font-size="12" font-family="var(--font-num)" fill="var(--c-ink-3)">${h.d}</text>`));
  hp.push(`</svg>`);

  return `<div style="width: 375px; background: var(--c-bg); padding: 16px 14px; box-sizing: border-box; position: relative">
      <div style="padding-left: 10px; padding-right: 10px">
      ${detailHeader({
        backLabel: "‹ 一覧",
        title: "Vandoren-3",
        titleSuffix: `<span style="display: inline-flex; align-items: center; color: var(--c-ink-3)"><span>#</span><span style="width: 46px; min-height: 44px; display: inline-flex; align-items: center; font-size: 15px; font-weight: 600; color: var(--c-ink-3)">1</span></span>`,
        meta: ["開封 2026/08/02", "36日", "6 セッション"],
      })}

      <div style="display: flex; align-items: stretch; flex-wrap: nowrap; gap: var(--sp-2)">
${score("4.0", "総評")}
${score("4", "厚さ")}
${score("3", "バランス")}
      </div>

      <div style="${CARD}; margin-top: var(--sp-3)">
        ${memoField("開封から1ヶ月。高音が鳴りやすくなったが、低音の抵抗が少し落ちてきた")}
      </div>

      <div style="${CARD}; margin-top: var(--sp-3)">
        ${metricTabs(["平均差分", "HNR", "重心", "音量"], "HNR")}
        <div style="margin-bottom: 0">
          ${svg}
        </div>
        <div style="display: flex; gap: 12px; margin-top: 6px; font-size: 12px; color: #435266; padding-left: ${AXW.toFixed(0)}px">
          <span style="display: flex; align-items: center; gap: 4px">${swatch("var(--c-accent)", 2, null)}実測</span>
          <span style="display: flex; align-items: center; gap: 4px">${swatch("var(--c-ink-3)", 2, "4 3")}目安</span>
        </div>
      </div>

      <div style="${CARD}; margin-top: var(--sp-3)">
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding-bottom: 6px">
          <span style="font-size: 10.5px; font-weight: 600; letter-spacing: .08em; color: var(--c-ink-3)">評価の推移</span>
          <span style="font-size: 11px; color: var(--c-ink-3); flex-shrink: 0">6 回の評価</span>
        </div>
        ${hp.join("\n        ")}
        <div style="display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: var(--sp-2); font-size: 10.5px; color: var(--c-ink-3)">
          <span style="display: flex; align-items: center; gap: var(--sp-1)">${swatch("var(--c-accent)", 2, null)}総評</span>
          <span style="display: flex; align-items: center; gap: var(--sp-1)">${swatch("var(--c-accent-mid)", 2, null)}厚さ</span>
          <span style="display: flex; align-items: center; gap: var(--sp-1)">${swatch("var(--c-accent-line)", 3, null)}バランス</span>
        </div>
        <div style="margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--c-line); font-size: 10.5px; color: var(--c-ink-3)">厚さ・バランスは 8/9 の記録から</div>
      </div>

      <div style="height: 68px"></div>
      </div>
      <!-- 実機は position: fixed。モックなので枠の右下に置いている -->
      <div style="position: absolute; right: 14px; bottom: 12px; min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-1); padding: 0 var(--sp-5); border-radius: var(--r-pill); border: none; background: var(--c-accent); color: var(--c-on-accent); font-size: var(--fs-sm); font-weight: 600; line-height: 1.2; box-shadow: 0 8px 24px rgba(15,23,42,0.18)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--c-on-accent)" stroke-width="2" stroke-linecap="round"><path d="M4 15 A8 8 0 0 1 20 15" /><line x1="12" y1="15" x2="15" y2="9" /><circle cx="12" cy="15" r="1.4" fill="var(--c-on-accent)" stroke="none" /></svg>
        計測
      </div>
    </div>`;
}

for (const [name, build, label] of [
  ["SessionDetail.dc.html", buildSession, "セッション個別"],
  ["ReedDetail.dc.html", buildReed, "リード個体"],
]) {
  writeFileSync(OUT + name, dcFile(build()));
  console.log(`${name.padEnd(24)} ${label}`);
}
