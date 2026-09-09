// 順位色のコントラスト(2026/09/09)。design/UNIFY-AUDIT.md の「順位色が 3:1 未満」。
//
//   node design/canvas/rankcolor.mjs
//
// **提案は3つ。実測値はすべてこの場で計算している**(下の contrast())。
// 数字は WCAG 2.x の相対輝度の式そのままで、白 #FFFFFF に対する比。
//
// 【なぜ 3:1 か】順位の**数字**は 2026/09/09 の案Bで --c-ink に戻したので、文字としては
// もう問題ない(#121F32 は白地に 16.1:1)。残っているのは環3px と カード左端の帯4px で、
// これは文字ではなく **UI の部品**。WCAG 1.4.11(Non-text Contrast)は隣接色に対して
// 3:1 を求める。4.5:1 は文字の基準なので、ここには掛からない。
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dcFile } from "./tokens.mjs";

const OUT = fileURLToPath(new URL("./", import.meta.url));

const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b = "#FFFFFF") => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

// 3案。いまの色 → 明度だけ落としたもの(色相と彩度は変えない)。
const PLANS = [
  {
    id: "現状", note: "1位と2位が 3:1 に届かない。3位だけ 4.00:1 で、<b>3色の重さが揃っていない</b>のも今のまま。",
    colors: { 1: "#C79A3E", 2: "#9BA6B4", 3: "#A9743E" },
  },
  {
    id: "案B 3:1 ちょうど", note: "1位と2位だけを 3:1 に乗せる最小の変更。<b>見た目の変化がいちばん小さい</b>が、余裕は 0.01。ブラウザの色管理で丸められると割り込みうる。",
    colors: { 1: "#B88E39", 2: "#8C95A2", 3: "#A9743E" },
  },
  {
    id: "案C 3色とも 4:1", note: "いま唯一基準を満たしている<b>3位(4.00:1)に他の2色を合わせる</b>。3色の重さが揃い、余裕もできる。そのぶん金と銀は現状よりはっきり暗くなる。",
    colors: { 1: "#9C7931", 2: "#77808B", 3: "#A8733E" },
  },
];

const NOTE = "font-size: var(--fs-xs); color: var(--c-ink-2); line-height: 1.6";
const CAP = "font-size: 10px; font-weight: 600; letter-spacing: .08em; color: var(--c-ink-3)";
const AV = { 1: "var(--c-avatar-1)", 2: "var(--c-avatar-3)", 3: "var(--c-avatar-5)" };
const NAME = { 1: "たけし", 2: "みさき", 3: "ゆうと" };
const DAYS = { 1: 24, 2: 21, 3: 19 };

// 実装(screens.jsx の RankRow・案B)と同じ形。色が乗るのは**環3px と 左端の帯4px の2つだけ**、
// 数字は --c-ink。ここで新しい作法を発明しない。
function row(rank, hex, big) {
  const av = big ? 56 : 34;
  return `        <div style="position: relative; overflow: hidden; background: var(--c-surface); border-radius: var(--r-lg); box-shadow: var(--shadow-card); padding: ${big ? "14px" : "10px 14px"}; display: flex; align-items: center; gap: var(--sp-3); margin-bottom: 8px">
          <span style="position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: ${hex}"></span>
          <span style="width: 22px; text-align: center; flex-shrink: 0; font-family: var(--font-num); font-weight: 700; font-size: ${big ? "var(--fs-2xl)" : "var(--fs-md)"}; color: var(--c-ink)">${rank}</span>
          <span style="width: ${av}px; height: ${av}px; border-radius: 999px; background: ${AV[rank]}; box-shadow: 0 0 0 3px ${hex}; flex-shrink: 0"></span>
          <span style="flex: 1 1 0; min-width: 0; font-size: ${big ? "var(--fs-lg)" : "var(--fs-sm)"}; font-weight: 600; color: var(--c-ink)">${NAME[rank]}</span>
          <span style="font-family: var(--font-num); font-weight: 700; font-size: ${big ? "var(--fs-2xl)" : "var(--fs-lg)"}; color: var(--c-ink)">${DAYS[rank]}<span style="font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-3)">日</span></span>
        </div>`;
}

function plan(p) {
  const chips = [1, 2, 3].map((r) => {
    const c = contrast(p.colors[r]).toFixed(2);
    const ok = contrast(p.colors[r]) >= 3;
    return `          <div style="flex: 1 1 0; text-align: center">
            <div style="height: 26px; border-radius: var(--r-sm); background: ${p.colors[r]}; margin-bottom: 4px"></div>
            <div style="font-family: var(--font-num); font-size: 11px; font-weight: 700; color: ${ok ? "var(--c-good)" : "var(--c-bad)"}">${c}:1</div>
            <div style="font-size: 9px; color: var(--c-ink-3)">${p.colors[r]}</div>
          </div>`;
  }).join("\n");
  return `      <div style="margin-bottom: 22px">
        <div style="${CAP}; margin-bottom: 6px">${p.id}</div>
${[1, 2, 3].map((r) => row(r, p.colors[r], r === 1)).join("\n")}
        <div style="display: flex; gap: 8px; margin: 10px 0 6px">
${chips}
        </div>
        <div style="${NOTE}">${p.note}</div>
      </div>`;
}

const body = `<div style="width: 375px; background: var(--c-bg); padding: 14px; box-sizing: border-box">
      <div style="font-size: var(--fs-md); font-weight: 700; color: var(--c-ink)">順位色のコントラスト</div>
      <div style="${NOTE}; margin: 4px 0 6px">色が乗るのは<b>環3px と カード左端の帯4px の2つだけ</b>で、順位の数字は <code>--c-ink</code>（白地に 16.1:1）。<b>文字はもう問題ない</b> ── 残っているのは非文字の部品で、WCAG 1.4.11 が求めるのは <b>3:1</b>（4.5:1 は文字の基準なのでここには掛からない）。</div>
      <div style="${NOTE}; margin-bottom: 14px">比の数字はこのページを作るときに計算した実測値。色相と彩度は変えず、<b>明度だけ</b>下げてある。</div>
${PLANS.map(plan).join("\n")}
      <div style="${NOTE}"><b>色を変えない道もある。</b> 順位は数字でも読めるので「色だけが頼り」ではない。1.4.11 は「情報を伝える非文字」に掛かるので、色を<b>装飾</b>と割り切るなら現状維持も筋は通る。ただし 3位だけ基準を満たしている今の状態は、どちらの理屈でも説明しにくい。</div>
    </div>`;

writeFileSync(OUT + "RankColor.dc.html", dcFile(body));
console.log("RankColor.dc.html");
for (const p of PLANS) {
  console.log(`  ${p.id.padEnd(16)} ` + [1, 2, 3].map((r) => `${r}位 ${p.colors[r]} ${contrast(p.colors[r]).toFixed(2)}:1`).join(" / "));
}
