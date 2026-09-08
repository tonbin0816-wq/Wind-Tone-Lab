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
function avatar(icon, color, size = 34) {
  usedIcons.add(icon);
  return `<span aria-hidden="true" style="display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: ${size}px; height: ${size}px; border-radius: 50%; background: var(--c-avatar-${color})"><svg width="${size * 0.6}" height="${size * 0.6}" fill="#fff" aria-hidden="true"><use href="#${icon}" /></svg></span>`;
}

// SubTabs(App.jsx): marginLeft -9 / padding 0 9 / 選択 22px・非選択 15px / marginBottom 0
const SUB_TABS = [["data", "データ"], ["rank", "順位"], ["share", "シェア"], ["me", "マイページ"]];
function subTabs(sel) {
  const items = SUB_TABS.map(([k, label]) => {
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
function filterPill(label, value) {
  const on = value !== null;
  return `        <span style="flex: 1 1 0; min-width: 0; position: relative; display: flex; align-items: center; justify-content: center; min-height: 44px">
          <span style="display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%; min-width: 0; min-height: 34px; padding: 0 10px; box-sizing: border-box; background: var(--c-sunken); border-radius: var(--r-pill); font-size: var(--fs-xs); font-weight: ${on ? 700 : 600}; color: ${on ? "var(--c-ink)" : "var(--c-ink-3)"}; white-space: nowrap; overflow: hidden">
            <span style="min-width: 0; overflow: hidden; text-overflow: ellipsis">${on ? value : label}</span>
            <svg width="7" height="7" viewBox="0 0 10 10" style="flex: none; opacity: .55" aria-hidden="true"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </span>
        </span>`;
}
function filterRow(sax, genre, position) {
  return `<div style="display: flex; gap: var(--sp-2)">
${filterPill("楽器", sax)}
${filterPill("ジャンル", genre)}
${filterPill("属性", position)}
      </div>`;
}

// Chip(screens.jsx): 当たり 44 / 見えるピル 30 / A型(枠 + 文字色。地は塗らない)
function chip(text, on, grow = true) {
  return `        <span style="min-height: 44px; display: inline-flex; align-items: center; justify-content: center; flex: ${grow ? "1 1 0" : "0 0 auto"}; min-width: 0">
          <span style="display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 0 13px; border-radius: var(--r-pill); border: 1px solid ${on ? "var(--c-accent)" : "var(--c-line-strong)"}; color: ${on ? "var(--c-accent)" : "var(--c-ink-2)"}; font-size: var(--fs-xs); font-weight: 600; white-space: nowrap; width: ${grow ? "100%" : "auto"}; box-sizing: border-box">${text}</span>
        </span>`;
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

// Legend(screens.jsx): 14x3 の実線の帯。破線は帯では描き分けない
function legend(series) {
  return `<div style="display: flex; flex-wrap: wrap; gap: var(--sp-3)">${series
    .map((s) => `<div style="display: flex; align-items: center; gap: var(--sp-1)"><span style="width: 14px; height: 3px; border-radius: 2px; background: ${s.color}; flex: 0 0 auto"></span><span style="${NOTE}">${s.label}</span></div>`)
    .join("")}</div>`;
}

const ALIGN_NOTE = "計測環境により値全体が一律にずれるため、揃えた状態で線の形で比較しています";

// ---- 画面の外枠 ---------------------------------------------------------
function screen(sel, inner) {
  return `${sprite()}
  <div style="width: 375px; background: var(--c-bg)">
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

const PEOPLE = [
  { nick: "しろねこ", icon: "ic-cat", color: 1, who: ["学生", "歴3年", "クラシック"], days: 24, rec: 38 },
  { nick: "Reedman", icon: "ic-music-notes", color: 6, who: ["社会人", "歴12年", "ジャズ"], days: 21, rec: 26 },
  { nick: "あおば", icon: "ic-leaf", color: 3, who: ["学生（音大）", "歴7年", "クラシック"], days: 19, rec: 31 },
  { nick: "tone-lab", icon: "ic-star", color: 8, who: ["講師・プロ", "歴20年", "ジャズ"], days: 17, rec: 44, mine: true },
  { nick: "まるこ", icon: "ic-rabbit", color: 5, who: ["独学", "歴2年", "ポップス"], days: 14, rec: 12 },
  { nick: "Kei", icon: "ic-fish", color: 2, who: ["社会人", "歴5年", "クラシック"], days: 11, rec: 19 },
  { nick: "のあ", icon: "ic-butterfly", color: 7, who: ["学生", "歴4年", "ポップス"], days: 9, rec: 8 },
  { nick: "ハル", icon: "ic-sun", color: 4, who: ["社会人", "歴9年", "ジャズ"], days: 6, rec: 15 },
];

// ---- データ -------------------------------------------------------------
function buildData() {
  const series = [
    { label: "みんなの平均", values: asVals(centroidAvg), color: "var(--c-accent)" },
    { label: "自分", values: asVals(centroidMine), color: "var(--c-ink-2)", dash: "4 3" },
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
          ${lineChart({ keys: KEYS, series, digits: 0 })}
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

function buildMyPage() {
  return screen("me", `<div style="display: flex; justify-content: center">${avatar("ic-star", 8, 64)}</div>

      <div>
${infoRow("ニックネーム", "tone-lab")}
${infoRow("楽器種別", "A.Sax・T.Sax")}
        <div style="font-size: var(--fs-sm); color: var(--c-ink); font-weight: 700; padding: var(--sp-3) 0 var(--sp-1)">A.Sax</div>
${infoRow("楽器", "YAMAHA YAS-875EX")}
${infoRow("マウスピース", "Selmer Paris S90 190")}
${infoRow("リガチャー", "BG Tradition")}
${infoRow("リード", 'Vandoren Traditional <span style="' + NUM + '">3.0</span>')}
        <div style="font-size: var(--fs-sm); color: var(--c-ink); font-weight: 700; padding: var(--sp-3) 0 var(--sp-1)">T.Sax</div>
${infoRow("楽器", "Selmer Paris Mark VI")}
${infoRow("マウスピース", "Otto Link Tone Edge")}
${infoRow("リガチャー", "未選択")}
${infoRow("リード", 'Vandoren Java <span style="' + NUM + '">2.5</span>')}
${infoRow("属性", "講師・プロ")}
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

      <div style="${BTN2}">編集</div>
      <div style="${BTN2}">アカウント引継</div>

      <div style="display: grid; margin-top: var(--sp-4)">
        <div style="width: 100%; min-height: 44px; border-radius: var(--r-pill); border: none; background: var(--c-danger); color: var(--c-on-accent); font-size: var(--fs-sm); font-weight: 700; display: flex; align-items: center; justify-content: center">アカウントを削除</div>
      </div>`);
}

// ---- 人をタップしたとき(表 = 音のデータ / 裏 = プロフィール) -------------
const BACK_BTN = "justify-self: start; min-height: 44px; padding: 0 var(--sp-3); border: none; border-radius: var(--r-md); background: var(--c-sunken); color: var(--c-ink-2); font-size: var(--fs-sm); font-weight: 600; display: inline-flex; align-items: center";

function personShell(inner) {
  return `${sprite()}
  <div style="width: 375px; background: var(--c-bg)">
    <div style="padding: var(--sp-4); padding-bottom: var(--sp-6); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-4)">
      ${inner}
    </div>
  </div>`;
}

function personHead(p, chevron) {
  return `<div style="display: flex; align-items: center; gap: var(--sp-3)">
        ${avatar(p.icon, p.color, 56)}
        <div style="min-width: 0; flex: 1 1 0">
          <div style="font-size: var(--fs-md); font-weight: 700; color: var(--c-ink)">${p.nick}</div>
          ${whoLine(p.who)}
        </div>${chevron
    ? `\n        <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true" style="flex: none; color: var(--c-ink-3)"><path d="M4 2l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>`
    : ""}
      </div>`;
}

function buildPerson() {
  const p = PEOPLE[0];
  const series = [
    { label: p.nick, values: asVals(centroidTheir), color: "var(--c-accent)" },
    { label: "自分", values: asVals(centroidMine), color: "var(--c-ink-2)", dash: "4 3" },
  ];
  return personShell(`<div style="${BACK_BTN}">&lt; 一覧</div>

      ${personHead(p, true)}

      <div style="display: flex; align-items: baseline; gap: var(--sp-2)">
        <div style="${LABEL}">練習日数</div>
        <div style="font-size: var(--fs-lg); font-weight: 700; color: var(--c-ink)">142<span style="font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-3)">日</span></div>
      </div>

      <div style="display: flex; gap: var(--sp-1)">
${chip("A.Sax", true)}
${chip("T.Sax", false)}
      </div>

      <div style="${LABEL}; padding-top: var(--sp-3)">音のデータ</div>
      ${underlineTabs(["重心", "HNR", "音程"], "重心")}
      <div style="${NOTE}">重心(Hz)　計測${p.rec}件</div>
      ${lineChart({ keys: KEYS, series, digits: 0 })}
      ${legend(series)}
      <div style="${NOTE}">${ALIGN_NOTE}</div>
      <div style="min-height: 44px; border: none; border-radius: var(--r-md); background: var(--c-accent); color: var(--c-on-accent); font-size: var(--fs-sm); font-weight: 700; display: flex; align-items: center; justify-content: center">目安に設定</div>`);
}

function buildPersonBack() {
  const p = PEOPLE[0];
  const gear = (label, value) => infoRow(label, value, "7em");
  return personShell(`<div style="${BACK_BTN}">&lt; 音のデータ</div>

      ${personHead(p, false)}

      <div>
${infoRow("属性", "学生", "7em")}
${infoRow("演奏開始年", '<span style="' + NUM + '">2023</span>年', "7em")}
${infoRow("ジャンル", '<span style="display: flex; flex-wrap: wrap; gap: 9px"><span>クラシック</span><span>ポップス</span></span>', "7em")}
${infoRow("編成", '<span style="display: flex; flex-wrap: wrap; gap: 9px"><span>吹奏楽</span></span>', "7em")}
      </div>

      <div style="${LABEL}; padding-top: var(--sp-3)">楽器の組</div>
      <div style="display: flex; gap: var(--sp-1)">
${chip("A.Sax", true)}
${chip("T.Sax", false)}
      </div>
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

// ---- 書き出し -----------------------------------------------------------
const FILES = [
  ["CommData.dc.html", buildData, "データ"],
  ["CommRank.dc.html", buildRank, "順位"],
  ["CommShare.dc.html", buildShare, "シェア"],
  ["CommMyPage.dc.html", buildMyPage, "マイページ"],
  ["CommPerson.dc.html", buildPerson, "人をタップ(表 音のデータ)"],
  ["CommPersonBack.dc.html", buildPersonBack, "人をタップ(裏 プロフィール)"],
  ["CommDataB.dc.html", buildDataB, "改善案 データ(線に名前)"],
  ["CommRankB.dc.html", buildRankB, "改善案 順位(上位3位)"],
  ["CommRankTint.dc.html", buildRankTint, "順位案A 淡い地"],
  ["CommDataC.dc.html", buildDataC, "データ案C 一覧の面をやめる"],
  ["CommDataD.dc.html", buildDataD, "データ案D 一覧を1行に"],
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
