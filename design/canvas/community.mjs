// コミュニティタブの実寸モックを書き出す。
//
//   node design/canvas/community.mjs
//
// 【正典は src/community/screens.jsx と CommunityTab.jsx】この生成器は写しであって
// 提案ではない。**寸法・色・語句をここで発明しない。**新しい値が要ると思ったら、
// それは実装が先に変わっているということなので、実装を読み直して写す。
// generate.mjs が App.jsx に追随するのと同じ約束(design/canvas/README.md)。
//
// 数値と人名は**ダミー**。実データではないので、値そのものを読み取らないこと。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dcFile } from "./tokens.mjs";

const OUT = fileURLToPath(new URL("./", import.meta.url));
const SRC = fileURLToPath(new URL("../../src/community/", import.meta.url));

// ---- アイコンの絵柄は icons.jsx から抜き出す ----------------------------
// 【写しを作らない】絵柄のパスをここに貼ると、icons.jsx を直したとき片方だけ古くなる。
// アートボードは単体で開かれるので、使う分の <symbol> だけを実装から抜いて埋める。
const ICONS_SRC = readFileSync(SRC + "icons.jsx", "utf8");
// 【選べる絵柄の並びは profile.js が正】写しをここに貼らない(README の約束)。
const PROFILE_SRC = readFileSync(SRC + "profile.js", "utf8");
const AVATAR_ICONS = ((PROFILE_SRC.match(/export const AVATAR_ICONS = \[([\s\S]*?)\];/) || [, ""])[1]
  .match(/"([^"]+)"/g) || []).map((q) => q.slice(1, -1));
if (AVATAR_ICONS.length === 0) throw new Error("profile.js から AVATAR_ICONS を読めない");
// 【便AS】格子に並べるのは選べる14種(写真枠と合わせて 5 × 3)。
const AVATAR_PICKABLE_ICONS = ((PROFILE_SRC.match(/export const AVATAR_PICKABLE_ICONS = \[([\s\S]*?)\];/) || [, ""])[1]
  .match(/"(ic-[a-z0-9-]+)"/g) || []).map((s) => s.slice(1, -1));
if (AVATAR_PICKABLE_ICONS.length !== 14) throw new Error("profile.js から AVATAR_PICKABLE_ICONS(14種)を読めない");
function symbolOf(id) {
  const m = ICONS_SRC.match(new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`));
  if (!m) throw new Error(`icons.jsx に ${id} が無い`);
  return m[0];
}
const usedIcons = new Set();
function sprite() {
  const defs = [...usedIcons].map((id) => `      ${symbolOf(id)}`).join("\n");
  return `<svg width="0" height="0" style="position: absolute" aria-hidden="true">
    <defs>
${defs}
    </defs>
  </svg>`;
}

// ---- 部品(すべて実装からの写し) ----------------------------------------

// Avatar(icons.jsx): 円の地は --c-avatar-N、絵柄は白で size*0.6
// 【便AH 2026-09-23】写真があれば写真を描く。地は --c-sunken(読み込み中に見える面)で、
// 丸く切り抜くので --c-avatar-N は意味を持たない(凍結仕様 決定2 と同じ理由)。
function avatar(icon, color, size = 34, photo = null) {
  if (photo) {
    return `<span aria-hidden="true" style="display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: ${size}px; height: ${size}px; border-radius: 50%; background: var(--c-sunken); overflow: hidden"><img src="${photo}" alt="" width="${size}" height="${size}" style="width: ${size}px; height: ${size}px; object-fit: cover; display: block; border-radius: 50%" /></span>`;
  }
  usedIcons.add(icon);
  return `<span aria-hidden="true" style="display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: ${size}px; height: ${size}px; border-radius: 50%; background: var(--c-avatar-${color})"><svg width="${size * 0.6}" height="${size * 0.6}" fill="#fff" aria-hidden="true"><use href="#${icon}" /></svg></span>`;
}

// SubTabs(App.jsx): marginLeft -9 / padding 0 9 / 選択 22px・非選択 15px / marginBottom 0
const SUB_TABS = [["data", "データ"], ["rank", "順位"], ["share", "シェア"], ["me", "マイページ"]];
// 【C9 2026-09-16】順位の種類も同じ SubTabs(screens.jsx の RANK_METRICS)。
const RANK_METRIC_TABS = [["days", "練習日数"], ["time", "練習時間"]];
function subTabs(sel, tabs = SUB_TABS) {
  const items = tabs.map(([k, label]) => {
    const on = k === sel;
    return `        <div style="min-height: 44px; min-width: 44px; padding: 0 9px; display: inline-flex; align-items: center; justify-content: center; font-size: ${on ? "var(--fs-xl)" : "var(--fs-md)"}; font-weight: ${on ? 700 : 400}; color: ${on ? "var(--c-ink)" : "var(--c-ink-3)"}; line-height: 1.2">${label}</div>`;
  });
  return `<div style="display: flex; align-items: center; gap: 0; margin-left: -9px; margin-bottom: 0">
${items.join("\n")}
      </div>`;
}

// UnderlineTabs(screens.jsx): marginLeft -10 / 当たり 44 / 見えるのは 26px の字と下線
function underlineTabs(items, sel) {
  const row = items.map((t) => {
    const on = t === sel;
    return `          <div style="min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 10px">
            <span style="display: inline-flex; align-items: center; min-height: 26px; padding: 0 2px; font-size: var(--fs-sm); font-weight: 600; color: ${on ? "var(--c-ink)" : "var(--c-ink-3)"};${on ? " box-shadow: inset 0 -2px 0 0 var(--c-ink);" : ""}">${t}</span>
          </div>`;
  });
  return `<div style="display: flex; align-items: center; gap: 0; margin-left: -10px; flex-wrap: wrap">
${row.join("\n")}
        </div>`;
}

// FilterPill / FilterRow(screens.jsx): 当たり 44 / 見えるピル 34 / 地は --c-sunken / 枠なし
function filterPill(label, value, dense = false) {
  const on = value !== null;
  return `        <span style="flex: 1 1 0; min-width: 0; position: relative; display: flex; align-items: center; justify-content: center; min-height: 44px">
          <span style="display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%; min-width: 0; min-height: 34px; padding: 0 ${dense ? 6 : 10}px; box-sizing: border-box; background: var(--c-sunken); border-radius: var(--r-pill); font-size: var(--fs-xs); font-weight: ${on ? 700 : 600}; color: ${on ? "var(--c-ink)" : "var(--c-ink-3)"}; white-space: nowrap; overflow: hidden">
            <span style="min-width: 0; overflow: hidden; text-overflow: ellipsis">${on ? value : label}</span>
            <svg width="7" height="7" viewBox="0 0 10 10" style="flex: none; opacity: .55" aria-hidden="true"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </span>
        </span>`;
}
// 【便AT 2026-09-24 本人指示】順位だけ、4つ目(一番右)に期間のピル。4つのときは隙間 --sp-1・内側 6。
// period は undefined なら3つ、null なら「すべて」(薄い字の「期間」)、文字列なら選んだ期間。
function filterRow(sax, genre, position, period) {
  const four = period !== undefined;
  return `<div style="display: flex; gap: ${four ? "var(--sp-1)" : "var(--sp-2)"}">
${filterPill("楽器", sax, four)}
${filterPill("ジャンル", genre, four)}
${filterPill("属性", position, four)}${four ? "\n" + filterPill("期間", period, true) : ""}
      </div>`;
}

// Chip(screens.jsx): 当たり 44 / 見えるピル 30 / A型(枠 + 文字色。地は塗らない)
// off = 選びようが無いもの(束2 2026-09-19)。枠は transparent・字は --c-line-strong。
// 枠を 0 にせず transparent で残すのは、寸法が 2px ずれて行が揃わなくなるため。
function chip(text, on, grow = true, off = false) {
  return `        <span style="min-height: 44px; display: inline-flex; align-items: center; justify-content: center; flex: ${grow ? "1 1 0" : "0 0 auto"}; min-width: 0">
          <span style="display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 0 13px; border-radius: var(--r-pill); border: 1px solid ${off ? "transparent" : on ? "var(--c-accent)" : "var(--c-line-strong)"}; color: ${off ? "var(--c-line-strong)" : on ? "var(--c-accent)" : "var(--c-ink-2)"}; font-size: var(--fs-xs); font-weight: 600; white-space: nowrap; width: ${grow ? "100%" : "auto"}; box-sizing: border-box">${text}</span>
        </span>`;
}

// SegmentedTabs(screens.jsx): 【便AT 2026-09-24 本人指示】溝型の切り替え。
// 溝 --c-sunken・角 --r-2・高さ 44 / 押せる箱は溝の高さいっぱい / 見える白い面 36・角 --r-1・影 --shadow-seg。
// 字 --fs-md。選択中 --c-ink 700 / 選べる --c-ink-3 600 / 選べない --c-line-strong 600(面は乗らない)。
// items = [[label, state]] state: "on" | "off"(選べる) | "dis"(選べない)
function segmented(items) {
  const cells = items.map(([label, st]) => {
    const on = st === "on";
    const color = st === "dis" ? "var(--c-line-strong)" : on ? "var(--c-ink)" : "var(--c-ink-3)";
    return `        <span style="display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 44px; padding: 0 2px">
          <span style="display: flex; align-items: center; justify-content: center; width: 100%; min-width: 0; min-height: 36px; padding: 0 4px; box-sizing: border-box; border-radius: var(--r-1); white-space: nowrap; overflow: hidden; font-size: var(--fs-md); font-weight: ${on ? 700 : 600}; color: ${color}; background: ${on ? "var(--c-surface)" : "transparent"}; box-shadow: ${on ? "var(--shadow-seg)" : "none"}">${label}</span>
        </span>`;
  });
  return `<div style="display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); background: var(--c-sunken); border-radius: var(--r-2); padding: 0 2px; min-height: 44px">
${cells.join("\n")}
      </div>`;
}

// 人物画面・マイページの楽器の行(SaxTypeRow)。【便AT】溝型。SAX_TYPES の4つを常に並べ、
// 選択中 / 吹く(登録している) / 吹かない(押せない) の3つ。
function saxTypeRow(selected, plays) {
  return `      ${segmented(["S.Sax", "A.Sax", "T.Sax", "B.Sax"]
    .map((t) => [t, !plays.includes(t) ? "dis" : t === selected ? "on" : "off"]))}`;
}

const CARD = "background: var(--c-surface); border-radius: var(--r-lg); padding: var(--sp-4); box-shadow: var(--shadow-card)";
const CARD_LIST = "background: var(--c-surface); border-radius: var(--r-lg); padding: var(--sp-1) var(--sp-4); box-shadow: var(--shadow-card)";
const EYEBROW = "font-size: 10px; font-weight: 600; letter-spacing: .08em; color: var(--c-ink-3)";
const NOTE = "font-size: var(--fs-xs); color: var(--c-ink-3); line-height: 1.6";
const BODY_NOTE = "font-size: var(--fs-xs); color: var(--c-ink-2); line-height: 1.8";
const LABEL = "font-size: var(--fs-xs); color: var(--c-ink-2); font-weight: 600";
const NUM = "font-family: var(--font-num)";

// WhoLine: 中黒を使わない。区切りは gap 9 の余白だけ(§6.0)
function whoLine(parts) {
  return `<span style="display: flex; gap: 9px; min-width: 0; overflow: hidden; font-size: var(--fs-xs); color: var(--c-ink-3); margin-top: 2px">${parts
    .map((p) => `<span style="flex: none; white-space: nowrap">${p}</span>`).join("")}</span>`;
}
// NameLine: 「あなた」の札は名前とは別の項目(名前の ellipsis に食われないように)
function nameLine(nick, mine, size = "var(--fs-sm)") {
  return `<span style="display: flex; align-items: center; gap: 6px; min-width: 0">
              <span style="flex: 0 1 auto; font-size: ${size}; font-weight: 700; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${nick}</span>${mine
    ? `<span style="flex: none; font-size: var(--fs-xs); font-weight: 700; color: var(--c-ink-2); background: var(--c-sunken); border-radius: var(--r-xs); padding: 1px 6px">あなた</span>`
    : ""}
            </span>`;
}

// ---- LineChart(screens.jsx の写し) --------------------------------------
const CH_W = 320, CH_H = 160, PAD_L = 40, PAD_B = 22, PAD_T = 10;
const MAX_X_LABELS = 7;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteLabel = (k) => NOTE_NAMES[((k % 12) + 12) % 12] + (Math.floor(k / 12) + 1);

function xLabelIndexes(n) {
  const set = new Set();
  if (n <= 0) return set;
  if (n <= MAX_X_LABELS) { for (let i = 0; i < n; i++) set.add(i); return set; }
  for (let j = 0; j < MAX_X_LABELS; j++) set.add(Math.round((j * (n - 1)) / (MAX_X_LABELS - 1)));
  return set;
}

// endLabels: 線の右端に名前を置く。凡例を往復せずにどちらの線か分かるようにするため
// (§6.0「説明を消して形に語らせる」)。名前のぶん右の余白を広げる。
// 端の値が近いと札が重なるので、12px 以内なら上下へ振り分ける。
function lineChart({ keys, series, digits, centerAt = null, endLabels = false, H = CH_H }) {
  const PAD_R = endLabels ? 62 : 8;
  return lineChartRaw({ keys, series, digits, centerAt, endLabels, PAD_R, H });
}

function lineChartRaw({ keys, series, digits, centerAt, endLabels, PAD_R, H = CH_H }) {
  const all = series.flatMap((s) => keys.map((k) => s.values[k]).filter((v) => typeof v === "number"));
  let lo = Math.min(...all), hi = Math.max(...all);
  if (typeof centerAt === "number") {
    const half = Math.max(...all.map((v) => Math.abs(v - centerAt))) || 1;
    lo = centerAt - half; hi = centerAt + half;
  } else if (lo === hi) { lo -= 1; hi += 1; }
  const ticks = typeof centerAt === "number" ? [hi, centerAt, lo] : [hi, lo];
  const x = (i) => PAD_L + (keys.length === 1 ? (CH_W - PAD_L - PAD_R) / 2 : (i * (CH_W - PAD_L - PAD_R)) / (keys.length - 1));
  const y = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const xl = xLabelIndexes(keys.length);
  const p = [];
  p.push(`<svg viewBox="0 0 ${CH_W} ${H}" width="100%" role="img" style="display: block; overflow: visible">`);
  for (const v of ticks) {
    const stroke = v === centerAt ? "var(--c-line-strong)" : "var(--c-line)";
    p.push(`  <line x1="${PAD_L}" x2="${CH_W - PAD_R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${stroke}" stroke-width="1" />`);
    p.push(`  <text x="${PAD_L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--c-ink-3)">${v.toFixed(digits)}</text>`);
  }
  keys.forEach((k, i) => {
    if (!xl.has(i)) return;
    p.push(`  <text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--c-ink-3)">${noteLabel(k)}</text>`);
  });
  const ends = [];
  for (const s of series) {
    const pts = keys.map((k, i) => (typeof s.values[k] === "number" ? `${x(i).toFixed(1)},${y(s.values[k]).toFixed(1)}` : null)).filter(Boolean);
    const w = s.width ?? 2;
    p.push(`  <polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""} />`);
    for (const pt of pts) {
      const [px, py] = pt.split(",");
      p.push(`  <circle cx="${px}" cy="${py}" r="${s.dot ?? 2.5}" fill="${s.color}" />`);
    }
    const last = pts[pts.length - 1];
    if (last) ends.push({ s, ex: Number(last.split(",")[0]), ey: Number(last.split(",")[1]) });
  }
  if (endLabels && ends.length > 0) {
    // 近すぎる札は上下へ振り分ける。**線そのものは動かさない。**
    ends.sort((a, b) => a.ey - b.ey);
    for (let i = 1; i < ends.length; i++) {
      if (ends[i].ey - ends[i - 1].ey < 12) ends[i].ey = ends[i - 1].ey + 12;
    }
    for (const e of ends) {
      // 【札の色は線の色と別】線は薄くてよいが、**文字は読める濃さが要る**
      // (§1.1「--c-ink-3 は約3.0:1。読ませたい文章には使わない」)。
      p.push(`  <text x="${(e.ex + 6).toFixed(1)}" y="${(e.ey + 3.5).toFixed(1)}" font-size="10" font-weight="700" fill="${e.s.labelColor ?? e.s.color}">${e.s.label}</text>`);
    }
  }
  p.push(`</svg>`);
  return p.join("\n            ");
}

// ---- NoteAxisLineChart(App.jsx の写し)────────────────────────────────
// 【便AO 2026-09-24 本人の実機報告「横軸が D2 E2 F#2 の3つしかない」】
// データの「みんなの平均」と人物紹介の折れ線は、手作りの LineChart から
// アプリ本体の NoteAxisLineChart(`plain`・My Data ではない側)に差し替わった。
// ここはその L() の写し(generate.mjs の layout() が My Data 側を写しているのと同じ約束)。
//   ・横軸は**その楽器の音域の全音**(buildFingeringTable。フラジオ込み)。データのある音だけではない
//   ・音名は**実音**(concertFreqLabel)。音の番号を 12 で回した名前ではない
//   ・縦軸の目盛は上端・中間・下端の3本(--c-line)。中央線(--c-line-strong)は My Data だけ(D-12)
//   ・音域の中央の E♭ に縦の破線(--c-accent-line / 4 3)。点は描く(My Data 以外)
// 音域・音名の表は App.jsx から**その場で抜く**(写しを貼らない。icons.jsx と同じ扱い)。
// 上の LineChart の写しは、**改善案の面(CommDataB / C / D)**が当時の姿のまま使っている。
const APP_SRC = readFileSync(fileURLToPath(new URL("../../src/App.jsx", import.meta.url)), "utf8");
const appConst = (name) => {
  const m = APP_SRC.match(new RegExp(`const ${name} = ([\\s\\S]*?);\\n`));
  if (!m) throw new Error(`App.jsx から ${name} を読めない`);
  return new Function(`return (${m[1]});`)();
};
const NA_RANGE = appConst("SAX_CONCERT_RANGE");
const NA_NOTE_NAMES = appConst("NOTE_NAMES");
const NA_PLOT_H = appConst("CHART_PLOT_H");
const NA_FS = appConst("SVG_FS_XS"), NA_SP1 = appConst("SVG_SP1"), NA_SP2 = appConst("SVG_SP2");
// 実音の音名。キャンバスの基準ピッチはどの値でも音名は変わらないので MIDI から引く
// (concertFreqLabel は 基準ピッチで割り戻して丸めるだけなので、同じ名前になる)。
const naLabels = (saxType) => {
  const r = NA_RANGE[saxType];
  return Array.from({ length: r.highMidi - r.lowMidi + 1 }, (_, i) => {
    const midi = r.lowMidi + i;
    return NA_NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
  });
};
// measureSvgTextPx の代わり(generate.mjs の textPx と同じ係数。system font 12px の実測に近い)
const naTextPx = (s, fs = NA_FS) => {
  let w = 0;
  for (const ch of String(s)) w += /[0-9]/.test(ch) ? fs * 0.556 : /[♯♭]/.test(ch) ? fs * 0.60 : fs * 0.667;
  return w;
};
const na2 = (n) => Math.round(n * 100) / 100;

// width はそのグラフが置かれる箱の実寸(SVG の実寸 = viewBox。§1.9 の縮小禁止)。
// 【柱の幅】実装は4指標ぶんの目盛の最大で固定する(R12)。キャンバスは1指標ぶんの
// ダミーしか持たないので、描いている指標の目盛から測る。
function noteAxisChart({ saxType = "alto", series, fmt, width }) {
  const labels = naLabels(saxType);
  const N = labels.length;
  const vals = series.flatMap((s) => Object.values(s.byIdx));
  // noteAxisDomain(中心を持たない指標): 最小〜最大に 12% の余白
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const pad = (maxV - minV) * 0.12 || Math.abs(maxV) * 0.1 || 1;
  const lo = minV - pad, hi = maxV + pad, rng = hi - lo || 1;
  const FS = NA_FS, plotH = NA_PLOT_H, padTop = NA_SP2;
  const tickVals = [hi, (hi + lo) / 2, lo];
  const tickTexts = tickVals.map(fmt);
  const tickW = Math.ceil(Math.max(...tickTexts.map((t) => naTextPx(t))));
  const TICK_GAP = NA_SP1;
  const AXW = TICK_GAP + tickW + TICK_GAP;
  const maxLblW = Math.ceil(Math.max(0, ...labels.map((nm) => naTextPx(nm))));
  const halfLbl = Math.ceil(maxLblW / 2) + NA_SP1;
  const x0 = AXW + halfLbl;
  const x1 = Math.max(x0 + 1, width - NA_SP2 - halfLbl);
  const colStep = (x1 - x0) / Math.max(1, N - 1);
  const need = maxLblW + NA_SP2;
  const labelStep = [1, 2, 3, 4, 6, 12].find((st) => st * colStep >= need) ?? Math.max(12, Math.ceil(need / colStep / 12) * 12);
  const ebIdx = labels.map((nm, i) => (nm.startsWith("E♭") ? i : -1)).filter((i) => i >= 0);
  const axisCenter = (N - 1) / 2;
  const midEb = ebIdx.reduce((b, i) => (Math.abs(i - axisCenter) < Math.abs(b - axisCenter) ? i : b), ebIdx[0]);
  const showLabel = (i) => (((i - midEb) % labelStep) + labelStep) % labelStep === 0;
  const dotR = Math.max(1.5, Math.min(3, colStep * 0.3));
  const labelY = padTop + plotH + NA_SP2 + Math.round(FS * 0.8);
  const H = labelY + NA_SP1;
  const xAt = (i) => x0 + i * colStep;
  const yAt = (v) => padTop + plotH - ((v - lo) / rng) * plotH;

  const p = [];
  p.push(`<svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" style="display: block">`);
  tickVals.forEach((v, k) => {
    p.push(`  <line x1="${AXW}" y1="${na2(yAt(v))}" x2="${width}" y2="${na2(yAt(v))}" stroke-width="1" style="stroke: var(--c-line)" />`);
    p.push(`  <text x="${AXW - TICK_GAP}" y="${na2(yAt(v) + Math.round(FS * 0.35))}" font-size="${FS}" text-anchor="end" font-family="var(--font-num)" style="fill: var(--c-ink-4)">${tickTexts[k]}</text>`);
  });
  p.push(`  <line x1="${na2(xAt(midEb))}" y1="${padTop}" x2="${na2(xAt(midEb))}" y2="${padTop + plotH}" stroke-width="1" stroke-dasharray="4 3" style="stroke: var(--c-accent-line)" />`);
  for (const s of series) {
    const segs = []; let cur = [];
    for (let i = 0; i < N; i++) {
      if (s.byIdx[i] !== undefined) cur.push(`${na2(xAt(i))},${na2(yAt(s.byIdx[i]))}`);
      else { if (cur.length) segs.push(cur); cur = []; }
    }
    if (cur.length) segs.push(cur);
    p.push(`  <g style="stroke: ${s.color}; fill: ${s.color}">`);
    for (const seg of segs) {
      p.push(`    <polyline fill="none" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""} points="${seg.join(" ")}" />`);
    }
    for (const [idx, v] of Object.entries(s.byIdx)) {
      // 【便AR】比べる相手(hollow)は目安と同じ白抜きの点
      p.push(s.hollow
        ? `    <circle cx="${na2(xAt(+idx))}" cy="${na2(yAt(v))}" r="${na2(dotR)}" stroke-width="1" style="fill: var(--c-surface)" />`
        : `    <circle cx="${na2(xAt(+idx))}" cy="${na2(yAt(v))}" r="${na2(dotR)}" stroke="none" />`);
    }
    p.push(`  </g>`);
  }
  labels.forEach((nm, i) => {
    if (!showLabel(i)) return;
    const eb = i === midEb;
    p.push(`  <text x="${na2(xAt(i))}" y="${labelY}" font-size="${FS}" font-weight="${eb ? 700 : 400}" text-anchor="middle" font-family="var(--font-num)" style="fill: ${eb ? "var(--c-accent)" : "var(--c-ink-3)"}">${nm}</text>`);
  });
  p.push(`</svg>`);
  return p.join("\n            ");
}

// Legend(screens.jsx): 【便AR】グラフと同じ「線 + 点」の小さな見本(22×10)。破線・白抜きも見本に出す
function legendSwatch(s) {
  const line = `<line x1="1" y1="5" x2="21" y2="5" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""} style="stroke: ${s.color}" />`;
  const dot = s.hollow
    ? `<circle cx="11" cy="5" r="3" stroke-width="1" style="stroke: ${s.color}; fill: var(--c-surface)" />`
    : `<circle cx="11" cy="5" r="3" style="fill: ${s.color}" />`;
  return `<svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" style="display: block; flex: 0 0 auto; overflow: visible">${line}${dot}</svg>`;
}
function legend(series) {
  return `<div style="display: flex; flex-wrap: wrap; gap: var(--sp-3)">${series
    .map((s) => `<div style="display: flex; align-items: center; gap: var(--sp-1)">${legendSwatch(s)}<span style="${NOTE}">${s.label}</span></div>`)
    .join("")}</div>`;
}
// 【便AR 2026-09-24 本人採用 案B】計測タブの「実測と目安」にそろえる。screens.jsx の COMPARE_SERIES / MINE_SERIES の正典。
const COMPARE_SERIES = { color: "var(--c-ink-3)", dash: "4 3", hollow: true };
const MINE_SERIES = { color: "var(--c-accent)", dash: null, hollow: false };

const ALIGN_NOTE = "計測環境により値全体が一律にずれるため、揃えた状態で線の形で比較しています";

// ---- 画面の外枠 ---------------------------------------------------------
function screen(sel, inner) {
  return `${sprite()}
  <!-- 【実測 2026/09/09】app-root と .surf-card が左右 14px を持つ(--page-side-pad)。
       その中で pageStyle が さらに --sp-4 を足すので、カードの左端は 14+16=30、
       カードの中の文字は 14+16+16=46。**子タブの文字は 30** なので 16px ずれている。 -->
  <div style="width: 375px; background: var(--c-bg); padding: 0 14px; box-sizing: border-box">
    <div style="padding: 0 var(--sp-4)">
      ${subTabs(sel)}
    </div>
    <div style="padding: var(--sp-4); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-4)">
      ${inner}
    </div>
  </div>`;
}

// ---- ダミーのデータ -----------------------------------------------------
const KEYS = [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51];
// 【3本とも形を変えてある】この画面の要点は「線の形を比べる」ことなので、
// 重なった線を置くとモックが何も言わなくなる。平均はなだらかに上がり、
// 自分は中音域で寝てから上で立ち上がり、相手は逆に早く上がってから寝る。
const centroidAvg = [742, 806, 878, 944, 1021, 1098, 1172, 1258, 1331, 1409, 1486, 1552, 1627, 1698, 1764, 1831, 1889, 1942];
const centroidMine = [712, 795, 902, 968, 1010, 1042, 1061, 1088, 1140, 1252, 1372, 1498, 1626, 1742, 1848, 1954, 2036, 2098];
const centroidTheir = [790, 851, 918, 1002, 1112, 1208, 1288, 1344, 1382, 1412, 1451, 1502, 1571, 1655, 1748, 1836, 1902, 1948];
const asVals = (arr) => Object.fromEntries(KEYS.map((k, i) => [k, arr[i]]));
// 【便AO】音名軸(NoteAxisLineChart)の面で使う音の番号。上の KEYS(34〜51)は手作りの
// LineChart が「番号を 12 で回して名付ける」だけだった頃の値で、A.Sax の音域(0〜36)の外に出る。
// 同じ値の並びを A.Sax の番号 10〜27(実音 B3〜E5)に置く。**ダミー**。
const NA_KEYS = KEYS.map((_, i) => 10 + i);
const naVals = (arr) => Object.fromEntries(NA_KEYS.map((k, i) => [k, arr[i]]));
const roundFmt = (v) => Math.round(v).toString(); // 重心(METRICS の digits 0)
// 器の幅(このキャンバスの箱の実寸。SVG は 1:1 で置く)
//   データのカードの中 = 375 − 14×2(app-root)− 16×2(screen の --sp-4)− 16×2(カードの --sp-4)
//   人物紹介の本文    = 375 − 14×2 − 16×2(personShell の --sp-4)
const NA_W_DATA = 375 - 14 * 2 - 16 * 2 - 16 * 2;
const NA_W_PERSON = 375 - 14 * 2 - 16 * 2;

const PEOPLE = [
  { nick: "しろねこ", icon: "ic-cat", color: 1, who: ["学生", "歴3年", "クラシック"], days: 24, rec: 38 },
  { nick: "Reedman", icon: "ic-music-notes", color: 6, who: ["社会人", "歴12年", "ジャズ"], days: 21, rec: 26 },
  { nick: "あおば", icon: "ic-leaf", color: 3, who: ["学生（音楽専門）", "歴7年", "クラシック"], days: 19, rec: 31 },
  { nick: "tone-lab", icon: "ic-star", color: 8, who: ["職業音楽家", "歴20年", "ジャズ"], days: 17, rec: 44, mine: true },
  { nick: "まるこ", icon: "ic-rabbit", color: 5, who: ["学生", "歴2年", "ポップス"], days: 14, rec: 12 },
  { nick: "Kei", icon: "ic-fish", color: 2, who: ["社会人", "歴5年", "クラシック"], days: 11, rec: 19 },
  { nick: "のあ", icon: "ic-butterfly", color: 7, who: ["学生", "歴4年", "ポップス"], days: 9, rec: 8 },
  { nick: "ハル", icon: "ic-sun", color: 4, who: ["社会人", "歴9年", "ジャズ"], days: 6, rec: 15 },
];

// ---- データ -------------------------------------------------------------
function buildData() {
  const series = [
    { label: "みんなの平均", byIdx: naVals(centroidAvg), ...COMPARE_SERIES },
    { label: "自分", byIdx: naVals(centroidMine), ...MINE_SERIES },
  ];
  const rows = PEOPLE.slice(0, 4).map((p, i, arr) => `          <div style="display: flex; align-items: center; gap: var(--sp-3); padding: 11px 2px; min-height: 47px; border-bottom: ${i === arr.length - 1 ? "none" : "1px solid var(--c-line)"}">
            ${avatar(p.icon, p.color, 34)}
            <div style="flex: 1 1 0; min-width: 0">
              ${nameLine(p.nick, p.mine)}
              ${whoLine(p.who)}
            </div>
            <div style="flex: none; text-align: right"><span style="${NUM}; font-size: var(--fs-md); font-weight: 700; color: var(--c-ink)">${p.rec}</span><span style="font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-3)">回</span></div>
          </div>`);

  return screen("data", `${filterRow("A.Sax", null, null)}

      <div style="${CARD}">
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2)">
          <div style="${EYEBROW}">みんなの平均</div>
          <div style="${NOTE}">目安を公開している<span style="${NUM}; font-weight: 700">12</span>人</div>
        </div>
        <div style="margin: 10px 0 2px">
          ${underlineTabs(["重心", "HNR", "音程"], "重心")}
        </div>
        <div style="display: grid; gap: var(--sp-2)">
          ${noteAxisChart({ series, fmt: roundFmt, width: NA_W_DATA })}
          ${legend(series)}
          <div style="${BODY_NOTE}">${ALIGN_NOTE}</div>
        </div>
      </div>

      <div style="${CARD_LIST}">
${rows.join("\n")}
      </div>`);
}

// ---- 順位 ---------------------------------------------------------------
const RANK_COLOR = ["var(--c-rank-1)", "var(--c-rank-2)", "var(--c-rank-3)"];

function rankRow(p, rank, big) {
  const c = big ? RANK_COLOR[rank - 1] : null;
  const ring = c ? ` box-shadow: 0 0 0 2px ${c}; margin: 2px;` : "";
  return `<div style="display: flex; align-items: center; gap: var(--sp-3); ${big ? CARD : "padding: 11px 2px; min-height: 47px"}">
            <div style="flex: 0 0 1.6em; text-align: center; font-weight: 700; letter-spacing: -.02em; ${NUM}; font-size: ${big ? "var(--fs-md)" : "var(--fs-sm)"}; color: ${c ?? "var(--c-ink-3)"}">${rank}</div>
            <span style="position: relative; display: inline-flex; flex: none; border-radius: 50%;${ring}">${avatar(p.icon, p.color, big ? 44 : 34)}</span>
            <div style="flex: 1 1 0; min-width: 0">
              ${nameLine(p.nick, p.mine, big ? "var(--fs-md)" : "var(--fs-sm)")}
              ${whoLine(p.who)}
            </div>
            <div style="flex: 0 0 auto; font-weight: 700; ${NUM}; letter-spacing: -.02em; font-size: ${big ? "var(--fs-xl)" : "var(--fs-md)"}; color: var(--c-ink)">${p.days}<span style="font-family: var(--font-jp); font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-3)">日</span></div>
          </div>`;
}

// 【上位3件は案B(左の帯)】2026/09/08 本人裁定で実装済み。ここは現状の写しなので、
// 実装(screens.jsx の RankRow)と同じ形にしてある。
function buildRank() {
  const top = PEOPLE.slice(0, 3).map((p, i) => `        ${rankRowEdge(p, i + 1)}`);
  const rest = PEOPLE.slice(3).map((p, i, arr) => `          <div style="border-bottom: ${i === arr.length - 1 ? "none" : "1px solid var(--c-line)"}">${rankRow(p, i + 4, false)}</div>`);
  // 【便AT 2026-09-24 本人指示】種類(練習日数 | 練習時間)は溝型の切り替え、期間は条件行の4つ目。
  // 期間のチップの行は消えた。既定の「すべて」は他の3つと同じく薄い字の項目名(期間)。
  return screen("rank", `${filterRow(null, null, null, null)}

      ${segmented(RANK_METRIC_TABS.map(([k, label]) => [label, k === "days" ? "on" : "off"]))}

      <div style="display: grid; gap: var(--sp-3)">
${top.join("\n")}
      </div>

      <div style="${CARD_LIST}">
${rest.join("\n")}
      </div>`);
}

// ---- シェア -------------------------------------------------------------
const PIE_COLORS = ["var(--c-accent)", "var(--c-accent-mid)", "var(--c-accent-line)"];
const PIE_REST = "var(--c-sunken)";
const PIE_R = 54, PIE_C = 60;

function arcPath(from, to) {
  const pt = (r) => {
    const a = r * 2 * Math.PI - Math.PI / 2;
    return [PIE_C + PIE_R * Math.cos(a), PIE_C + PIE_R * Math.sin(a)];
  };
  if (to - from >= 0.9999) return null;
  const [sx, sy] = pt(from), [ex, ey] = pt(to);
  const large = to - from > 0.5 ? 1 : 0;
  return `M${PIE_C},${PIE_C} L${sx.toFixed(1)},${sy.toFixed(1)} A${PIE_R},${PIE_R} 0 ${large} 1 ${ex.toFixed(1)},${ey.toFixed(1)} Z`;
}

function pie(items) {
  const top = items.slice(0, 3);
  const rest = Math.max(0, 1 - top.reduce((a, x) => a + x.ratio, 0));
  const slices = [];
  let acc = 0;
  top.forEach((x, i) => { slices.push({ d: arcPath(acc, acc + x.ratio), fill: PIE_COLORS[i] }); acc += x.ratio; });
  if (rest > 0.0001) slices.push({ d: arcPath(acc, 1), fill: PIE_REST });
  return `<svg width="120" height="120" viewBox="0 0 120 120" style="flex: none" role="img">
${slices.map((s) => `              <path d="${s.d}" fill="${s.fill}" />`).join("\n")}
            </svg>`;
}

// PieLegend: 行の当たり判定 44 / 行どうしの gap は 0(44 と字の高さの差が間隔になる)
function pieLegend(items) {
  const row = (color, text, ratio, muted) => `              <div style="display: flex; align-items: center; gap: 7px; min-width: 0; min-height: 44px">
                <span style="width: 9px; height: 9px; border-radius: 2px; background: ${color}; flex: none"></span>
                <span style="font-size: var(--fs-xs); color: ${muted ? "var(--c-ink-3)" : "var(--c-ink)"}; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${text}</span>
                <span style="${NOTE}; flex: none; margin-left: auto; ${NUM}">${Math.round(ratio * 100)}%</span>
              </div>`;
  const top = items.slice(0, 3);
  const rest = items.slice(3);
  const restRatio = rest.reduce((a, x) => a + x.ratio, 0);
  const out = top.map((x, i) => row(PIE_COLORS[i], x.key, x.ratio, false));
  if (rest.length > 0) out.push(row(PIE_REST, `ほか${rest.length}種類`, restRatio, true));
  return `<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0">
${out.join("\n")}
            </div>`;
}

// ---- マイページ ---------------------------------------------------------
function infoRow(label, value, em = "6.5em") {
  return `        <div style="display: flex; gap: var(--sp-3); align-items: baseline; padding: var(--sp-2) 0; border-bottom: 1px solid var(--c-line)">
          <div style="${LABEL}; flex: 0 0 ${em}">${label}</div>
          <div style="font-size: var(--fs-sm); color: var(--c-ink); line-height: 1.7; flex: 1 1 0; min-width: 0">${value}</div>
        </div>`;
}
const BTN2 = "width: 100%; min-height: 44px; border-radius: var(--r-pill); border: none; background: var(--c-sunken); color: var(--c-ink-2); font-size: var(--fs-md); font-weight: 600; display: flex; align-items: center; justify-content: center";

// 【M3 2026-09-19 本人指示】マイページのアイコンは**編集の導線**なので、
// 右下に小さな印(直径 24 = 64 の 3/8)を添える。絵柄は鉛筆
// (本人「添付はカメラのアイコンだが鉛筆マークにして」)。地は --c-ink・線は白。
// 押すと絵柄を選び直すシートが開く ── 画面は変わらない。
const PENCIL_BADGE = `<span aria-hidden="true" style="position: absolute; right: 0; bottom: 0; width: 24px; height: 24px; border-radius: 50%; background: var(--c-ink); color: #fff; display: inline-flex; align-items: center; justify-content: center"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg></span>`;

function buildMyPage() {
  return screen("me", `<div style="display: flex; justify-content: center"><span style="position: relative; display: inline-flex">${avatar("ic-star", 8, 64)}${PENCIL_BADGE}</span></div>

      <div>
${infoRow("ニックネーム", "tone-lab")}
${infoRow("楽器種別", "A.Sax・T.Sax")}
        <!-- 【便AT 2026-09-24 本人指示】楽器の組は SaxTypeRow の切り替えで1組ずつ(登録していない種別は押せない)。
             以前は種別ごとに見出し + 4行を縦に積んでいた。ここは A.Sax を選んでいる姿。 -->
        <div style="padding: var(--sp-3) 0 var(--sp-1)">
${saxTypeRow("A.Sax", ["A.Sax", "T.Sax"])}
        </div>
${infoRow("楽器", "YAMAHA YAS-875EX")}
${infoRow("マウスピース", "Selmer Paris S90 190")}
${infoRow("リガチャー", "BG Tradition")}
${infoRow("リード", 'Vandoren Traditional <span style="' + NUM + '">3.0</span>')}
${infoRow("属性", "職業音楽家")}
${infoRow("演奏開始年", '<span style="' + NUM + '">2006</span>年')}
${infoRow("ジャンル", "ジャズ・ポップス")}
${infoRow("編成", "ソロ・ビッグバンド")}
      </div>

      <div style="display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3)">
        <div style="display: grid; gap: var(--sp-1); min-width: 0">
          <div style="font-size: var(--fs-sm); font-weight: 700; color: var(--c-ink)">公開</div>
          <div style="${NOTE}">プロフィールと奏者：自分のデータが公開されます</div>
        </div>
        <span style="flex: 0 0 auto; width: 44px; min-height: 44px; display: flex; align-items: center; justify-content: center">
          <span style="display: block; width: 44px; height: 26px; border-radius: var(--r-pill); position: relative; background: var(--c-accent)">
            <span style="position: absolute; top: 3px; left: 21px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2)"></span>
          </span>
        </span>
      </div>

      <!-- 【並び C10 2026-09-16】公開スイッチ → お問い合わせ / 規約 / ポリシー → uid → 編集 → 引継 → 削除(破壊的な一手が最後) -->
      <!-- 【束3 2026-09-19 本人指示】お問い合わせはアプリの中のフォーム(FeedbackSheet)を開く行になった。
           アドレスの副題は消えた ── フォームで送るので写す先が無い。
           「レビューを送る」の行はお問い合わせの**上**に入るが、飛び先(APP_STORE_REVIEW_URL)が
           null の間は行ごと出ない。**いまの画面には無い**ので、ここにも描かない
           (このカタログは「現状」の写しであって提案ではない)。 -->
      <div style="${CARD}; padding: 0; margin-top: var(--sp-4)">
${navRow("お問い合わせ")}
${navRow("利用規約")}
${navRow("プライバシーポリシー", true)}
      </div>

      <div style="${NOTE}; text-align: center; word-break: break-all; margin-top: var(--sp-2)">a1b2c3d4e5f6g7h8i9j0k1l2m3n4</div>

      <div style="${BTN2}; margin-top: var(--sp-4)">編集</div>
      <div style="${BTN2}">アカウント引継</div>

      <div style="display: grid; margin-top: var(--sp-4)">
        <div style="width: 100%; min-height: 44px; border-radius: var(--r-pill); border: none; background: var(--c-danger); color: var(--c-on-accent); font-size: var(--fs-sm); font-weight: 700; display: flex; align-items: center; justify-content: center">アカウントを削除</div>
      </div>`);
}

// NavRow(CommunityTab.jsx): 当たり 44 / padding 8 16 / 罫は行の間だけ / 右端の山形(RowChevron 8px)
// 【C11 2026-09-16】規約・ポリシーは押すとアプリの中のシート(LegalSheet)が開く。外へは出ない。
// 【束3 2026-09-19】お問い合わせも同じくシート(FeedbackSheet)。副題(アドレス)の受け口は
// 実装(NavRow)から消えたので、こちらも持たない ── 正典に画面に無いものを残さない。
function navRow(label, last = false) {
  return `        <div style="display: flex; align-items: center; gap: var(--sp-3); min-height: 44px; padding: var(--sp-2) var(--sp-4); border-bottom: ${last ? "none" : "1px solid var(--c-line)"}; color: var(--c-ink); font-size: var(--fs-sm); font-weight: 600">
          <span style="flex: 1 1 0; min-width: 0">${label}</span>
          <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true" style="flex: none; color: var(--c-ink-3)"><path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </div>`;
}

// ---- プロフィール編集(束4 2026-09-19 本人指示) --------------------------
// 本人:「プロフィール編集画面で楽器やマウスピースのグレーのカードをニックネームの
//        グレーのカードの形に統一」「演奏開始年も同様に統一」
//        「属性はダイヤルではなくジャンルなどの他と同様に選択肢をボタンで提示して選択式に変更」
//
// 【欄の綴りは1つ】ニックネーム・楽器・マウスピース・リガチャー・リード・演奏開始年が
// **同じ FORM_FIELD** を使う。欄ごとに寸法・地・角丸を持たせない。
// 実装は src/community/CommunityTab.jsx の controlStyle + index.css の入力欄の規則。
// **appearance: none** が要る: 同じ宣言を当てても、<select> は ▾ を描き、
// input[type="search"] は iOS Safari が別の形で描くので、綴りだけでは形が揃わない。
// (実装は検索欄の type も "text" にしてニックネームと完全に同じにしてある。)
const FORM_FIELD = "width: 100%; min-height: 44px; padding: 0 var(--sp-3); font-size: var(--fs-sm); color: var(--c-ink); background: var(--c-sunken); border: 1px solid transparent; border-radius: var(--r-xs); appearance: none; box-sizing: border-box; display: flex; align-items: center";

// Field(CommunityTab.jsx): 見出し + 中身(+ 注意書き)
function formField(label, inner, note = null) {
  return `      <div style="display: grid; gap: var(--sp-1)">
        <div style="${LABEL}">${label}</div>
${inner}${note ? `\n        <div style="${NOTE}">${note}</div>` : ""}
      </div>`;
}
// 空の入力欄(打つと候補が出る欄・年を選ぶ欄・ニックネームの欄がこれ1つ)
const formBox = (value = "") => `        <div style="${FORM_FIELD}">${value}</div>`;
// PillGroup(CommunityTab.jsx): 行間 0 / 横は --sp-1。選択中は枠と字が --c-accent。
function pillRow(items) {
  return `        <div style="display: flex; flex-wrap: wrap; gap: 0 var(--sp-1)">
${items.map(([t, on]) => chip(t, on, false)).join("\n")}
        </div>`;
}
const OTHER_BTN = "width: 100%; min-height: 44px; border-radius: var(--r-pill); border: none; background: var(--c-sunken); color: var(--c-ink-2); font-size: var(--fs-sm); font-weight: 600; display: flex; align-items: center; justify-content: center";

function buildProfileEdit() {
  const gearField = (label) => `${formField(label, `${formBox()}\n        <div style="${OTHER_BTN}">カタログに無い(その他)</div>`)}`;
  return screen("me", `<div style="font-size: var(--fs-md); font-weight: 700; color: var(--c-ink)">プロフィールを編集</div>

${formField("ニックネーム", formBox("tone-lab"),
    `<span style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2)"><span>ニックネームは他の利用者に公開されます</span><span style="${NUM}; color: var(--c-ink-3); flex-shrink: 0">8 / 20</span></span>`)}

${formField("楽器種別(複数選択可)", pillRow([["S.Sax", false], ["A.Sax", true], ["T.Sax", false], ["B.Sax", false]]))}

      <div style="font-size: var(--fs-sm); color: var(--c-ink); font-weight: 700">A.Sax</div>
${gearField("楽器")}
${gearField("マウスピース")}
${gearField("リガチャー")}
${gearField("リード")}
${formField("リードの番手", pillRow([["2.0", false], ["2.5", false], ["3.0", true], ["3.5", false]]))}

      <!-- 【束4-C】ダイヤル(<select>)をやめ、ジャンル・編成と同じピルにした。
           違いは「1つだけ選ぶ」ことだけなので、同じ部品に引数を1つ足して使う
           (role="radiogroup" + role="radio" + aria-checked)。 -->
${formField("属性", pillRow([["学生", false], ["学生（音楽専門）", false], ["社会人", true], ["職業音楽家", false]]))}

      <!-- 【束4-B】選び方(押すと年の一覧が出る)は変えない。器の見た目だけニックネームに揃える。 -->
${formField("演奏開始年", formBox("2015年"))}

${formField("ジャンル(複数選択可)", pillRow([["クラシック", false], ["ジャズ", true], ["ポップス", false], ["その他", false]]))}

${formField("編成(複数選択可)", pillRow([["ソロ", true], ["アンサンブル", false], ["ビッグバンド", false], ["吹奏楽", false], ["オーケストラ", false], ["その他", false]]))}

      <div style="min-height: 44px; display: flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-sm); color: var(--c-ink)">
        <span style="width: 18px; height: 18px; flex: 0 0 auto; border: 1px solid var(--c-line-strong); border-radius: 3px"></span>
        <span>13歳以上です</span>
      </div>

      <div style="width: 100%; min-height: 44px; border-radius: var(--r-pill); border: none; background: var(--c-accent); color: var(--c-on-accent); font-size: var(--fs-md); font-weight: 700; display: flex; align-items: center; justify-content: center">保存</div>
      <div style="${BTN2}">やめる</div>`);
}

// ---- 人をタップしたとき(タブ データ / プロフィール) -------------------------
// 【便AO 2026-09-24 本人指示】表裏(名前の行を押して裏返る・`< 音のデータ` で戻る)をやめ、
// 名前の行の下に SubTabs [データ | プロフィール]。左上は常に `< 一覧`。名前の行に山形は無い。
// 【R9 2026-09-16 実機の指摘】地(--c-sunken)と左右の padding を外した(App.jsx の BACK_BUTTON_STYLE と同値)。
const BACK_BTN = "justify-self: start; min-height: 44px; padding: 0; border: none; border-radius: var(--r-md); background: none; color: var(--c-ink-2); font-size: var(--fs-sm); font-weight: 600; display: inline-flex; align-items: center";

function personShell(inner) {
  return `${sprite()}
  <div style="width: 375px; background: var(--c-bg); padding: 0 14px; box-sizing: border-box">
    <div style="padding: 0 var(--sp-4) var(--sp-6); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-4)">
      ${inner}
    </div>
  </div>`;
}

// 名前の行は押せる行ではない(便AO)。その下に SubTabs(PERSON_TABS)。
const PERSON_TABS = [["data", "データ"], ["profile", "プロフィール"]];
function personHead(p, tab) {
  return `<div style="display: flex; align-items: center; gap: var(--sp-3)">
        ${avatar(p.icon, p.color, 56)}
        <div style="min-width: 0; flex: 1 1 0">
          <div style="font-size: var(--fs-md); font-weight: 700; color: var(--c-ink)">${p.nick}</div>
          ${whoLine(p.who)}
        </div>
      </div>

      ${subTabs(tab, PERSON_TABS)}`;
}

function buildPerson() {
  const p = PEOPLE[0];
  const series = [
    { label: p.nick, byIdx: naVals(centroidTheir), ...COMPARE_SERIES },
    { label: "自分", byIdx: naVals(centroidMine), ...MINE_SERIES },
  ];
  return personShell(`<div style="${BACK_BTN}">&lt; 一覧</div>

      ${personHead(p, "data")}

      <div style="display: flex; align-items: baseline; gap: var(--sp-2)">
        <div style="${LABEL}">練習日数</div>
        <div style="font-size: var(--fs-lg); font-weight: 700; color: var(--c-ink)">142<span style="font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-3)">日</span></div>
      </div>

${saxTypeRow("A.Sax", ["A.Sax", "T.Sax"])}

      ${underlineTabs(["重心", "HNR", "音程"], "重心")}
      <div style="${NOTE}">Hz　計測${p.rec}件</div>
      ${noteAxisChart({ series, fmt: roundFmt, width: NA_W_PERSON })}
      ${legend(series)}
      <div style="${NOTE}">${ALIGN_NOTE}</div>
      <div style="display: flex; justify-content: flex-end">
        <div style="min-height: 44px; padding: 0 var(--sp-5); border: none; border-radius: var(--r-pill); background: var(--c-accent); color: var(--c-on-accent); font-size: var(--fs-sm); font-weight: 600; box-shadow: 0 8px 24px rgba(15,23,42,0.18); display: inline-flex; align-items: center; justify-content: center">目安に設定</div>
      </div>`);
}

function buildPersonBack() {
  const p = PEOPLE[0];
  const gear = (label, value) => infoRow(label, value, "7em");
  return personShell(`<div style="${BACK_BTN}">&lt; 一覧</div>

      ${personHead(p, "profile")}

      <div>
${infoRow("属性", "学生", "7em")}
${infoRow("演奏開始年", '<span style="' + NUM + '">2023</span>年', "7em")}
${infoRow("ジャンル", '<span style="display: flex; flex-wrap: wrap; gap: 9px"><span>クラシック</span><span>ポップス</span></span>', "7em")}
${infoRow("編成", '<span style="display: flex; flex-wrap: wrap; gap: 9px"><span>吹奏楽</span></span>', "7em")}
      </div>

      <div style="${LABEL}; padding-top: var(--sp-3)">楽器の組</div>
${saxTypeRow("A.Sax", ["A.Sax", "T.Sax"])}
      <div>
${gear("楽器", "YAMAHA YAS-62")}
${gear("マウスピース", "Selmer Paris S90 180")}
${gear("リガチャー", "YAMAHA 標準")}
${gear("リード", 'Vandoren Traditional <span style="' + NUM + '">2.5</span>')}
      </div>`);
}

// =========================================================================
// 改善案(2026/09/07 本人指摘の3点)。**ここから下は現状ではない。**
//   1. データ … どちらの線を見ればいいのかぱっと見で分からない
//   2. 順位 … 上位3位が目立たない
//   3. シェア … 組み合わせの文字が切れて読めない(改行はしない)
// =========================================================================

// 案1: 線に名前を直接置き、太さと濃さで主従を付ける。
//   ・みんなの平均 … --c-accent / 2.5px / 実線 ── この画面の主役
//   ・自分 … --c-ink-3 / 1.8px / 破線 ── 比較対象。My Data の破線と同じ作法
//   ・凡例は**やめる**。名前が線の端に付いていれば往復が要らない(§6.0)
//   【色は足していない】§1.7「系列は紺の3段まで/色を足すのではなく表示を絞る」。
//   紺(--c-accent)と灰(--c-ink-3)はどちらも既存の段。
function buildDataB() {
  const series = [
    { label: "みんな", values: asVals(centroidAvg), color: "var(--c-accent)", width: 2.5, dot: 2.5 },
    { label: "自分", values: asVals(centroidMine), color: "var(--c-ink-3)", labelColor: "var(--c-ink-2)", width: 1.8, dash: "4 3", dot: 2 },
  ];
  const rows = PEOPLE.slice(0, 4).map((p, i, arr) => `          <div style="display: flex; align-items: center; gap: var(--sp-3); padding: 11px 2px; min-height: 47px; border-bottom: ${i === arr.length - 1 ? "none" : "1px solid var(--c-line)"}">
            ${avatar(p.icon, p.color, 34)}
            <div style="flex: 1 1 0; min-width: 0">
              ${nameLine(p.nick, p.mine)}
              ${whoLine(p.who)}
            </div>
            <div style="flex: none; text-align: right"><span style="${NUM}; font-size: var(--fs-md); font-weight: 700; color: var(--c-ink)">${p.rec}</span><span style="font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-3)">回</span></div>
          </div>`);

  return screen("data", `${filterRow("A.Sax", null, null)}

      <div style="${CARD}">
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2)">
          <div style="${EYEBROW}">みんなの平均</div>
          <div style="${NOTE}">目安を公開している<span style="${NUM}; font-weight: 700">12</span>人</div>
        </div>
        <div style="margin: 10px 0 2px">
          ${underlineTabs(["重心", "HNR", "音程"], "重心")}
        </div>
        <div style="display: grid; gap: var(--sp-2)">
          ${lineChart({ keys: KEYS, series, digits: 0, endLabels: true })}
          <div style="${BODY_NOTE}">${ALIGN_NOTE}</div>
        </div>
      </div>

      <div style="${CARD_LIST}">
${rows.join("\n")}
      </div>`);
}

// 案2: 上位3位は**大きさと余白だけ**で立たせる。
//   【塗らない・光らせない・台に載せない】追記1 厳守事項と本人指示(「丸パクリ過ぎる」)。
//   増やしたのは寸法だけ: 順位の数字 15 → 28px / 1位のアイコン 44 → 56 /
//   名前 15 → 18px(1位) / 日数 22 → 28px(1位) / 環 2 → 3px。
//   **色は1つも足していない。**
// 【順位の色を2つだけ濃くした案】本人裁定待ち。
// 実測(白地との比): 1位 #C79A3E = 2.59:1 / 2位 #9BA6B4 = 2.47:1 / 3位 #A9743E = 4.00:1。
// 大きな文字(18.66px以上の太字)の下限は 3:1 なので、**字を大きくしても 1位と 2位は薄いまま**で、
// 「目立たせて」に反する。色相は変えず明度だけ落として下限を越えさせる:
//   1位 #C79A3E → #A97F23 (3.65:1) / 2位 #9BA6B4 → #7C8794 (3.65:1) / 3位はそのまま。
// 色は**増えていない**(3段のまま)。却下なら RANK_COLOR をそのまま使う。
const RANK_COLOR_B = ["#A97F23", "#7C8794", "var(--c-rank-3)"];

function rankRowB(p, rank) {
  const c = RANK_COLOR_B[rank - 1];
  const first = rank === 1;
  const av = first ? 56 : 44;
  return `<div style="display: flex; align-items: center; gap: var(--sp-3); ${CARD}">
            <div style="flex: 0 0 34px; text-align: center; font-weight: 700; letter-spacing: -.02em; ${NUM}; font-size: ${first ? "var(--fs-2xl)" : "var(--fs-xl)"}; line-height: 1; color: ${c}">${rank}</div>
            <span style="position: relative; display: inline-flex; flex: none; border-radius: 50%; box-shadow: 0 0 0 3px ${c}; margin: 3px">${avatar(p.icon, p.color, av)}</span>
            <div style="flex: 1 1 0; min-width: 0">
              ${nameLine(p.nick, p.mine, first ? "var(--fs-lg)" : "var(--fs-md)")}
              ${whoLine(p.who)}
            </div>
            <div style="flex: 0 0 auto; font-weight: 700; ${NUM}; letter-spacing: -.02em; line-height: 1; font-size: ${first ? "var(--fs-2xl)" : "var(--fs-xl)"}; color: var(--c-ink)">${p.days}<span style="font-family: var(--font-jp); font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-3)">日</span></div>
          </div>`;
}

function buildRankB() {
  const top = PEOPLE.slice(0, 3).map((p, i) => `        ${rankRowB(p, i + 1)}`);
  const rest = PEOPLE.slice(3).map((p, i, arr) => `          <div style="border-bottom: ${i === arr.length - 1 ? "none" : "1px solid var(--c-line)"}">${rankRow(p, i + 4, false)}</div>`);
  const chips = ["今週", "今月", "今年", "すべて"].map((t) => chip(t, t === "すべて"));

  return screen("rank", `${filterRow(null, null, null)}

      <div style="display: flex; gap: var(--sp-1)">
${chips.join("\n")}
      </div>

      <div style="${BODY_NOTE}; display: flex; gap: 9px"><span>練習日数</span><span>すべて</span></div>

      <div style="display: grid; gap: var(--sp-3)">
${top.join("\n")}
      </div>

      <div style="${CARD_LIST}">
${rest.join("\n")}
      </div>`);
}

// 案3: 組み合わせは**型番だけ**にして、区切りを余白にする。
//   ・メーカー名を落とす … どの枠がどの項目かは、すぐ上で選んでいる
//     「楽器 × マウスピース × リード」が既に言っている(同じことを2度言わない)。
//     型番の無いものだけメーカー名で出す。
//   ・区切りは " / " をやめて**余白**(§6.0 囲いの序列「1. 余白で分ける」。
//     中黒を使わない WhoLine と同じ作法)。
//   ・それでもあふれるとき(4項目)は**最後の1つだけ**が省略記号になる。
//     改行はしない ── 1件1行という形が崩れると、5件の比較ができなくなる。
function comboLine(parts) {
  return `<span style="display: flex; gap: 9px; min-width: 0; overflow: hidden; font-size: var(--fs-sm); color: var(--c-ink)">${parts
    .map((t, i) => (i === parts.length - 1
      ? `<span style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${t}</span>`
      : `<span style="flex: none; white-space: nowrap">${t}</span>`)).join("")}</span>`;
}

// 【組み合わせは型番だけ】2026/09/08 本人裁定で実装済み(aggregate.js の gearDisplay)。
// ここは現状の写し。区切りは中黒でも / でもなく余白(§6.0)。
function buildShare() {
  const makers = [
    { key: "YAMAHA", ratio: 0.42 }, { key: "Selmer Paris", ratio: 0.27 },
    { key: "Yanagisawa", ratio: 0.18 }, { key: "Buffet Crampon", ratio: 0.07 },
    { key: "Keilwerth", ratio: 0.04 }, { key: "その他", ratio: 0.02 },
  ];
  // 型番だけ。型番を持たないもの(「その他」など)はメーカー名のまま出す。
  const combos = [
    { parts: ["YAS-62", "S90 190", "Traditional 3.0"], n: 5, pct: 42 },
    { parts: ["Mark VI", "5MM", "Select Jazz 3M"], n: 3, pct: 25 },
    { parts: ["A-WO10", "Concept", "V16 3.0"], n: 2, pct: 17 },
    { parts: ["YAS-875EX", "Tone Edge", "Java 2.5"], n: 1, pct: 8 },
    { parts: ["Senzo", "4C", "V12 3.5"], n: 1, pct: 8 },
  ];
  const depthRow = (text, on) => `          <div style="min-height: 44px; padding: 0; display: flex; align-items: center">
            <span style="display: flex; align-items: center; width: 100%; min-width: 0; min-height: 36px; padding: 0 12px; box-sizing: border-box; border-radius: var(--r-sm); border: 1px solid ${on ? "var(--c-accent)" : "var(--c-line-strong)"}; color: ${on ? "var(--c-accent)" : "var(--c-ink-2)"}; font-size: var(--fs-sm); font-weight: 600; text-align: left">${text}</span>
          </div>`;

  return screen("share", `${filterRow("A.Sax", null, null)}

      <div style="${CARD}">
        ${underlineTabs(["楽器", "マウスピース", "リガチャー", "リード"], "楽器")}
        <div style="display: flex; align-items: center; gap: var(--sp-4); padding: var(--sp-2) 0 var(--sp-1)">
          ${pie(makers)}
          ${pieLegend(makers)}
        </div>
        <div style="${BODY_NOTE}">n = <span style="${NUM}; font-weight: 700">24</span>人</div>
      </div>

      <div style="${CARD}">
        <div style="${EYEBROW}; margin-bottom: 10px">人気の組み合わせ</div>
        <div style="display: grid; gap: 0">
${depthRow("マウスピース × リード", false)}
${depthRow("楽器 × マウスピース × リード", true)}
${depthRow("楽器 × マウスピース × リガチャー × リード", false)}
        </div>
        <div>
${combos.map((c, i) => `          <div style="padding: 7px 0">
            <div style="display: flex; justify-content: space-between; align-items: baseline; gap: var(--sp-2)">
              ${comboLine(c.parts)}
              <span style="${NOTE}; flex: none; ${NUM}">${c.n}人</span>
            </div>
            <div style="height: 6px; border-radius: var(--r-pill); background: var(--c-sunken); margin-top: 5px; overflow: hidden">
              <div style="width: ${c.pct}%; height: 100%; background: ${PIE_COLORS[Math.min(i, 2)]}"></div>
            </div>
          </div>`).join("\n")}
        </div>
      </div>`);
}

// =========================================================================
// 順位カードに色を入れる案(2026/09/08 本人の問い「カードに色つけたりするのはあかんすか？」)
//
// 禁じているのは DESIGN-SYSTEM §1.5a の厳守事項:
//   「使ってよいのは**アイコンの環の線と、順位の数字の文字色**の2つだけ。面を塗らない」
//   「金属質の光沢・グラデーションは使わない。単色で足りる」
// これは 2026/08/28 に本人が決めた規則なので、本人が変えられる。
// ぶつかる先は2つ:
//   ・§1.4 色の付いた面は「押せる/選ばれている」の合図。順位カードは全部押せるので、
//     1位だけ塗ると「1位が選択中」に読める
//   ・§6.6 面の作法。地は白で、浮きは影だけが担う。色地を足すと面の意味が2種類になる
// どちらも「淡い地」なら回避できる可能性があるので、2案を実寸で出す。
// =========================================================================

// 案A: カードの地を順位の色の淡い段にする。文字は --c-ink に戻すので、
// 現状の弱点(1位 2.59:1 / 2位 2.47:1)は**色を濃くしなくても消える**。
// 淡い段は各色を白に 12% 混ぜた値。新しい色相は増えていない。
const RANK_TINT = ["#F8F3E8", "#F3F4F6", "#F5EEE8"];

function rankRowTint(p, rank) {
  const c = RANK_COLOR[rank - 1];
  const first = rank === 1;
  const av = first ? 56 : 44;
  return `<div style="display: flex; align-items: center; gap: var(--sp-3); background: ${RANK_TINT[rank - 1]}; border-radius: var(--r-lg); padding: var(--sp-4); box-shadow: var(--shadow-card)">
            <div style="flex: 0 0 34px; text-align: center; font-weight: 700; letter-spacing: -.02em; ${NUM}; font-size: ${first ? "var(--fs-2xl)" : "var(--fs-xl)"}; line-height: 1; color: var(--c-ink)">${rank}</div>
            <span style="position: relative; display: inline-flex; flex: none; border-radius: 50%; box-shadow: 0 0 0 3px ${c}; margin: 3px">${avatar(p.icon, p.color, av)}</span>
            <div style="flex: 1 1 0; min-width: 0">
              ${nameLine(p.nick, p.mine, first ? "var(--fs-lg)" : "var(--fs-md)")}
              ${whoLine(p.who)}
            </div>
            <div style="flex: 0 0 auto; font-weight: 700; ${NUM}; letter-spacing: -.02em; line-height: 1; font-size: ${first ? "var(--fs-2xl)" : "var(--fs-xl)"}; color: var(--c-ink)">${p.days}<span style="font-family: var(--font-jp); font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-3)">日</span></div>
          </div>`;
}

// 案B: 地は白のまま、**左端に 4px の帯**だけ順位の色にする。
// §6.6(地は白・浮きは影)を割らずに済む。数字は --c-ink。
function rankRowEdge(p, rank) {
  const c = RANK_COLOR[rank - 1];
  const first = rank === 1;
  const av = first ? 56 : 44;
  return `<div style="display: flex; align-items: stretch; background: var(--c-surface); border-radius: var(--r-lg); box-shadow: var(--shadow-card); overflow: hidden">
            <span style="flex: 0 0 4px; background: ${c}"></span>
            <div style="flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-4)">
              <div style="flex: 0 0 34px; text-align: center; font-weight: 700; letter-spacing: -.02em; ${NUM}; font-size: ${first ? "var(--fs-2xl)" : "var(--fs-xl)"}; line-height: 1; color: var(--c-ink)">${rank}</div>
              <span style="position: relative; display: inline-flex; flex: none; border-radius: 50%; box-shadow: 0 0 0 3px ${c}; margin: 3px">${avatar(p.icon, p.color, av)}</span>
              <div style="flex: 1 1 0; min-width: 0">
                ${nameLine(p.nick, p.mine, first ? "var(--fs-lg)" : "var(--fs-md)")}
                ${whoLine(p.who)}
              </div>
              <div style="flex: 0 0 auto; font-weight: 700; ${NUM}; letter-spacing: -.02em; line-height: 1; font-size: ${first ? "var(--fs-2xl)" : "var(--fs-xl)"}; color: var(--c-ink)">${p.days}<span style="font-family: var(--font-jp); font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-3)">日</span></div>
            </div>
          </div>`;
}

function rankScreenWith(rowFn) {
  const top = PEOPLE.slice(0, 3).map((p, i) => `        ${rowFn(p, i + 1)}`);
  const rest = PEOPLE.slice(3).map((p, i, arr) => `          <div style="border-bottom: ${i === arr.length - 1 ? "none" : "1px solid var(--c-line)"}">${rankRow(p, i + 4, false)}</div>`);
  const chips = ["今週", "今月", "今年", "すべて"].map((t) => chip(t, t === "すべて"));
  return screen("rank", `${filterRow(null, null, null)}

      <div style="display: flex; gap: var(--sp-1)">
${chips.join("\n")}
      </div>

      <div style="${BODY_NOTE}; display: flex; gap: 9px"><span>練習日数</span><span>すべて</span></div>

      <div style="display: grid; gap: var(--sp-3)">
${top.join("\n")}
      </div>

      <div style="${CARD_LIST}">
${rest.join("\n")}
      </div>`);
}

const buildRankTint = () => rankScreenWith(rankRowTint);
const buildRankEdge = () => rankScreenWith(rankRowEdge);

// =========================================================================
// データ 改善案(2026/09/08 本人指示「下のユーザー一覧はあくまでサブなので
// 上のグラフが目立つようにして」)
//
// どちらも **色は足していない**。効かせているのは §6.0「囲いの序列」だけ:
//   1. 余白で分ける → 2. 罫で分ける → 3. 面で分ける → 4. カードにする
// 一覧を1段下げれば、上のカードは何もしなくても相対的に立つ。
// =========================================================================

const dataRows = (opts) => PEOPLE.slice(0, 4).map((p, i, arr) => `          <div style="display: flex; align-items: center; gap: var(--sp-3); padding: ${opts.pad}; min-height: ${opts.minH}px; border-bottom: ${i === arr.length - 1 ? "none" : "1px solid var(--c-line)"}">
            ${avatar(p.icon, p.color, opts.av)}
            <div style="flex: 1 1 0; min-width: 0">
              ${nameLine(p.nick, p.mine)}${opts.who ? `\n              ${whoLine(p.who)}` : ""}
            </div>
            <div style="flex: none; text-align: right"><span style="${NUM}; font-size: var(--fs-md); font-weight: 700; color: var(--c-ink)">${p.rec}</span><span style="font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-3)">回</span></div>
          </div>`).join("\n");

function dataScreen({ chartH, listWrap, rows, note }) {
  const series = [
    { label: "みんなの平均", values: asVals(centroidAvg), color: "var(--c-accent)" },
    { label: "自分", values: asVals(centroidMine), color: "var(--c-ink-2)", dash: "4 3" },
  ];
  return screen("data", `${filterRow("A.Sax", null, null)}

      <div style="${CARD}">
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2)">
          <div style="${EYEBROW}">みんなの平均</div>
          <div style="${NOTE}">目安を公開している<span style="${NUM}; font-weight: 700">12</span>人</div>
        </div>
        <div style="margin: 10px 0 2px">
          ${underlineTabs(["重心", "HNR", "音程"], "重心")}
        </div>
        <div style="display: grid; gap: var(--sp-2)">
          ${lineChart({ keys: KEYS, series, digits: 0, H: chartH })}
          ${legend(series)}
          <div style="${BODY_NOTE}">${ALIGN_NOTE}</div>
        </div>
      </div>

      ${note}
      <div style="${listWrap}">
${rows}
      </div>`);
}

// 案C: **一覧の面をやめる。** 浮いているカードを画面で1枚だけにする。
// グラフの縦は 160 → 210(表示 155 → 204px)。一覧は地のまま、行の区切りの罫だけ残す。
// 一覧の上に「目安を公開している人」の見出しを置く ── 面が無くなるぶん、
// 何の一覧なのかを言葉が引き受ける。
const buildDataC = () => dataScreen({
  chartH: 210,
  note: `<div style="${EYEBROW}; margin-bottom: -8px">目安を公開している人</div>`,
  listWrap: "padding: 0 2px",
  rows: dataRows({ pad: "9px 0", minH: 42, av: 28, who: true }),
});

// 案D: **一覧をカードのまま1行に詰める。** 属性の行(WhoLine)を落として名前と回数だけにする。
// 面の序列は変えないが、一覧の高さが 200 → 132px になり、グラフが画面の主役になる。
// 落とした属性は、その人を押せば人物紹介で読める。
const buildDataD = () => dataScreen({
  chartH: 210,
  note: "",
  listWrap: CARD_LIST,
  rows: dataRows({ pad: "8px 2px", minH: 40, av: 28, who: false }),
});


// =========================================================================
// 便AH アイコンに任意の写真を使えるようにする(2026-09-23 凍結仕様)
//   docs/superpowers/specs/2026-09-23-avatar-photo.md
// **ここは現状の写しである。**寸法・色・語句をここで発明していない ──
// 出どころは src/community/CommunityTab.jsx の AvatarPicker と PhotoZoom.jsx。
// =========================================================================

// 【ダミーの写真。**設計上の値ではない**】実機では利用者が選んだ 256px の WebP が入る。
// アートボードは単体で開かれるので、外部ファイルを参照せず data URI で埋める。
const DUMMY_PHOTO = "data:image/svg+xml;base64," + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'
  + '<rect width="256" height="256" fill="#8FA6BD"/>'
  + '<circle cx="128" cy="96" r="46" fill="#E6ECF2"/>'
  + '<path d="M36 256c0-50 41-82 92-82s92 32 92 82z" fill="#E6ECF2"/></svg>',
).toString("base64");

// AvatarPicker のマス(CommunityTab.jsx の cell())。選択中の表し方は既存のまま
// (地 --c-accent-tint)。**新しい状態表現を作らない**(凍結仕様 決定1)。
const pickCell = (sel) => `min-width: 44px; min-height: 44px; padding: 0; display: flex; align-items: center; justify-content: center; background: ${sel ? "var(--c-accent-tint)" : "transparent"}; border: none; border-radius: var(--r-md)`;

// 写真枠の絵柄。lucide の Image(線 2px・24px 四方)。鉛筆の印と同じ出どころ。
const PHOTO_GLYPH = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--c-ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

// 【決定1】列は6→5。写真枠は格子の先頭(左上)。
// 【便AS 2026-09-24 本人指示】絵柄は14種に絞った。写真枠と合わせて 5×3 = 15。
// 【minmax(0, 1fr) を外さない】外すと格子が画面より広くなり、ページ全体を押し広げる。
// 【便AM 2026-09-24 本人の実機報告「写真の選択も出てこない」】
// 見出しが「絵柄」で絵が25個並ぶ中の1つだったので、写真を選ぶ場所に見えなかった。
// **このマスにだけ「写真」の文字を添える**。文字が在ること自体が「ここは他と違う」の目印になる。
// 絵 24px + 間 2px + 文字 12px(行の高さ 1)= 38px で、マスの高さ 44px の中に収まる(格子は動かない)。
const PHOTO_CELL_LABEL = `<span style="font-size: 12px; line-height: 1; color: var(--c-ink-2)">写真</span>`;
// 【便AP 2026-09-24 本人指示】保存の間、写真枠は進み具合の輪になる。
// 「読み込んでいるなら、左上の写真アイコンの周りを円形で囲って100%完了するまで円グラフで表す」
// 直径 40・太さ 3。地の輪 --c-line、進んだぶん --c-accent。12時から時計回り。
// 中には送っている写真(28px)。書き出しの間はまだ写真が無いので、写真の絵柄(18px・--c-ink-3)。
// 輪の間は「写真」の文字を引っ込める(40 がマスの 44 に収まる)。
// 薄くなる(0.6)のは絵柄のマスだけで、輪は薄めない。**CommunityTab.jsx の PhotoProgressRing の正典。**
function photoRing(progress, photo) {
  const r = (40 - 3) / 2;
  const c = 2 * Math.PI * r;
  return `<span style="position: relative; display: inline-flex; width: 40px; height: 40px; align-items: center; justify-content: center"><svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" style="position: absolute; inset: 0"><circle cx="20" cy="20" r="${r}" fill="none" stroke="var(--c-line)" stroke-width="3"/><circle cx="20" cy="20" r="${r}" fill="none" stroke="var(--c-accent)" stroke-width="3" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - progress)).toFixed(2)}" transform="rotate(-90 20 20)"/></svg>${photo
    ? `<img src="${photo}" alt="" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover">`
    : PHOTO_GLYPH.replace('width="24" height="24"', 'width="18" height="18"').replace('stroke="var(--c-ink)"', 'stroke="var(--c-ink-3)"')}</span>`;
}
function iconGrid({ photo, sel, busy = null }) {
  const cells = [
    busy
      ? `        <div style="${pickCell(sel === "photo")}">${photoRing(busy.progress, busy.photo)}</div>`
      : `        <div style="${pickCell(sel === "photo")}; flex-direction: column; gap: 2px">${photo
      ? avatar(null, null, 24, photo)
      : PHOTO_GLYPH}${PHOTO_CELL_LABEL}</div>`,
    ...AVATAR_PICKABLE_ICONS.map((id) => {
      usedIcons.add(id);
      return `        <div style="${pickCell(sel === id)}${busy ? "; opacity: 0.6" : ""}"><svg width="24" height="24" fill="var(--c-ink)" aria-hidden="true"><use href="#${id}" /></svg></div>`;
    }),
  ];
  return `      <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--sp-1)">
${cells.join("\n")}
      </div>`;
}

function colorGrid(sel) {
  const cells = [];
  for (let n = 1; n <= 10; n++) {
    const ring = n === sel ? "box-shadow: 0 0 0 2px var(--c-surface), 0 0 0 4px var(--c-accent); " : "";
    cells.push(`        <div style="${pickCell(false)}"><span style="display: block; width: 24px; height: 24px; border-radius: 50%; ${ring}background: var(--c-avatar-${n})"></span></div>`);
  }
  return `      <div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--sp-1)">
${cells.join("\n")}
      </div>`;
}

// シートの器(App.jsx の BottomSheet)。つまみ 36×4 / 角丸 28px 28px 0 0 / 上下 14・左右 24。
function sheetCard(inner) {
  return `  <div style="width: 375px; background: var(--c-surface); border-radius: 28px 28px 0 0; box-shadow: 0 8px 24px rgba(15,23,42,0.18); padding: 14px 24px 40px; box-sizing: border-box">
    <div style="display: flex; justify-content: center; margin-bottom: 12px"><span style="width: 36px; height: 4px; border-radius: 2px; background: var(--c-line-strong); display: block"></span></div>
    <div style="display: grid; gap: var(--sp-3)">
${inner}
    </div>
  </div>`;
}

// 2つの状態を縦に並べる。**同じ部品の出し分け**なので、別の画面ではない。
function buildAvatarPick() {
  const withIcon = sheetCard(`      <div style="display: flex; justify-content: center">${avatar("ic-star", 8, 64)}</div>
      <div style="${LABEL}">絵柄</div>
${iconGrid({ photo: null, sel: "ic-star" })}
      <div style="${LABEL}">背景</div>
${colorGrid(8)}`);
  // 【決定2】写真を選んでいる間、背景色の行は消える。丸く切り抜くので地が見えない。
  // 【決定1】既に写真を設定している人は、写真枠にその写真の縮小が出る。
  const withPhoto = sheetCard(`      <div style="display: flex; justify-content: center">${avatar(null, null, 64, DUMMY_PHOTO)}</div>
      <div style="${LABEL}">絵柄</div>
${iconGrid({ photo: DUMMY_PHOTO, sel: "photo" })}`);
  // 【便AP】保存の最中(判定待ち・約6割)。下に「保存中…」の1行が出る。
  const saving = sheetCard(`      <div style="display: flex; justify-content: center">${avatar("ic-star", 8, 64)}</div>
      <div style="${LABEL}">絵柄</div>
${iconGrid({ photo: null, sel: "ic-star", busy: { progress: 0.62, photo: DUMMY_PHOTO } })}
      <div style="${NOTE}">保存中…</div>
      <div style="${LABEL}">背景</div>
${colorGrid(8)}`);
  // 輪の3つの姿(写真枠だけを抜き出して並べる): 書き出し中 / 判定中 / 返事が来た
  const ringStates = `      <div style="display: flex; gap: var(--sp-4); justify-content: center; align-items: flex-end">
${[["書き出し中 4%", 0.04, null], ["判定中 62%", 0.62, DUMMY_PHOTO], ["返事が来た 100%", 1, DUMMY_PHOTO]].map(([label, p, ph]) =>
    `        <div style="display: grid; justify-items: center; gap: var(--sp-1)"><div style="${pickCell(false)}; width: 62px">${photoRing(p, ph)}</div><div style="${NOTE}">${label}</div></div>`).join("\n")}
      </div>`;
  return `${sprite()}
  <div style="width: 375px; background: var(--c-bg); display: grid; gap: var(--sp-6); padding-bottom: var(--sp-6); box-sizing: border-box">
    <div style="${NOTE}; padding: var(--sp-4) var(--sp-4) 0">絵柄を選んでいるとき（背景の行が出る）</div>
${withIcon}
    <div style="${NOTE}; padding: 0 var(--sp-4)">写真を選んでいるとき（背景の行は消える）</div>
${withPhoto}
    <div style="${NOTE}; padding: 0 var(--sp-4)">写真を保存しているとき（写真枠が進み具合の輪になる）</div>
${saving}
    <div style="${NOTE}; padding: 0 var(--sp-4)">輪の姿（判定の間は 95% へ近づくだけで、返事が来て 100%）</div>
${ringStates}
  </div>`;
}

// 【決定5】アイコンをタップすると写真がそのまま大きく出る。間にシートを挟まない。
// 閉じるボタンは置かない ── 画面のどこをタップしても戻る(Escape も同じ)。
// 暗幕は既存のシートと同値 rgba(15,23,42,0.28)。**写真のときだけ**出る。
function buildPhotoZoom() {
  return `  <div style="width: 375px; height: 700px; background: rgba(15,23,42,0.28); display: flex; align-items: center; justify-content: center; padding: var(--sp-4); box-sizing: border-box">
    <img src="${DUMMY_PHOTO}" alt="" style="width: 343px; height: 343px; max-width: 100%; object-fit: contain; border-radius: var(--r-lg); display: block" />
  </div>`;
}

// ---- 書き出し -----------------------------------------------------------
const FILES = [
  ["CommData.dc.html", buildData, "データ"],
  ["CommRank.dc.html", buildRank, "順位"],
  ["CommShare.dc.html", buildShare, "シェア"],
  ["CommMyPage.dc.html", buildMyPage, "マイページ"],
  ["CommProfileEdit.dc.html", buildProfileEdit, "プロフィール編集(束4)"],
  ["CommPerson.dc.html", buildPerson, "人をタップ(タブ データ)"],
  ["CommPersonBack.dc.html", buildPersonBack, "人をタップ(タブ プロフィール)"],
  ["CommDataB.dc.html", buildDataB, "改善案 データ(線に名前)"],
  ["CommRankB.dc.html", buildRankB, "改善案 順位(上位3位)"],
  ["CommRankTint.dc.html", buildRankTint, "順位案A 淡い地"],
  ["CommDataC.dc.html", buildDataC, "データ案C 一覧の面をやめる"],
  ["CommDataD.dc.html", buildDataD, "データ案D 一覧を1行に"],
  ["CommAvatarPick.dc.html", buildAvatarPick, "便AS アイコンを変更(格子5×3・写真枠)"],
  ["CommPhotoZoom.dc.html", buildPhotoZoom, "便AH 写真の拡大表示"],
];

for (const [name, build, label] of FILES) {
  usedIcons.clear();
  // 1度組んで、その過程で使われた絵柄を集める。集めてから本番を組む
  // (sprite() は文字列の先頭に来るので、後から足せない)。
  build();
  const body = build();
  writeFileSync(OUT + name, dcFile(body));
  console.log(`${name.padEnd(24)} ${label}`);
}
