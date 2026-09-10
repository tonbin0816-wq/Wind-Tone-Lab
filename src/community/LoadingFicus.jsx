import { useEffect, useState } from "react";
import { beginLoad, loadPercent, loadFloor, ficusGrowth } from "./loadProgress.js";

// ------------------------------------------------------------------
// コミュニティタブの読み込み中の絵。ficus が読み込みに合わせて育つ。
//
// 【ここは firebase を一切 import しない】App.jsx の Suspense の fallback が
// この要素を描く。fallback が重い依存を連れてくると、**遅延読み込みの意味が
// 消える**(待たせている当のものを、待つ画面が読み込んでしまう)。
// import してよいのは React と loadProgress.js(純粋な計算)だけ。
//
// 【姿は本人の株そのもの 2026/09/10 本人指示・写真で指定】
// 曲げ仕立てのフィカス・ベンガレンシス。白い鉢から**うねる淡色の幹**が立ち、
// 濃い葉の房が4段。本人の言葉「ロードが進むたびにこの巻いている幹が
// 伸びていくイメージ」がそのまま骨格になっている ── 幹は根元から先端へ
// 伸び、**房はその先端が通り過ぎた所から**開く。
//
// 【色は紺の階調だけで作る】体系に緑は無い(§1.5 の機能色を装飾に流用しない)。
// 実物の「淡い幹・濃い葉・白い鉢」の**明暗の関係**を紺の段に置き換える:
//   鉢 --c-sunken / 幹 --c-accent-mid / 葉 --c-accent / 葉脈 --c-accent-line
// ------------------------------------------------------------------

// 絵の枠。**検証がここを読んで、葉が枠から出ていないかを見る**(実際に樹冠を
// 枠の外へ出しかけた)。値を変えるときは検証も一緒に走らせること。
export const VIEW_W = 52, VIEW_H = 116;

// うねる幹。土の高さ(26, 94)から樹冠(19, 15)へ、左右に**大きく**振れながら立つ。
// 振れ幅は ±6(株の幅の約1/3)。細かく刻むと落書きの線に見え、写真の
// 曲げ仕立ての「ゆったりした」うねりにならない。
export const TRUNK_D = "M 26 94 C 26 86 30 82 31 75 C 32 67 23 64 22 56 "
  + "C 21 48 30 45 30 37 C 30 29 20 27 19 20 C 18.5 18 19 17 19 15";

// 葉の房。branches = [根元x, 根元y, 先x, 先y] の並び / leaves = [x, y, 角度, 長さ, 半幅]。
// 半幅は長さのおよそ 1/3.6(実物の葉の縦横比)。
// 高さは幹の伸び(0.04→0.72)と対応させてある ── 房が開くころ、幹の先端は
// ちょうどその高さを通り過ぎている。
export const TIERS = [
  { // 1段目。低い位置の2枚(右)
    branches: [[30.5, 72, 35, 73.5]],
    leaves: [[32.5, 72.7, -35, 8.5, 2.4], [35, 73.5, 10, 10, 2.8]],
  },
  { // 2段目。中ほどの左の房
    branches: [[22.5, 57, 14.5, 57.5]],
    leaves: [
      [19, 57.2, 220, 9, 2.5], [16.8, 57.4, 140, 9.5, 2.6],
      [14.5, 57.5, 196, 11, 3.1], [14.5, 57.5, 168, 9.5, 2.6],
    ],
  },
  { // 3段目。中ほどの右の房
    branches: [[30, 38, 36, 36.5]],
    leaves: [
      [31.8, 37.6, -40, 9, 2.5], [33.8, 37.1, 40, 9.5, 2.6],
      [36, 36.5, -12, 11, 3.1], [36, 36.5, 18, 9.5, 2.6],
    ],
  },
  { // 4段目。樹冠。**1点から放射させない** ── 三つ葉の飾りに見える。
    // 幹の先端の3枚に、少し下から左右へ張り出す小枝を2本足し、葉は枝の
    // **途中にも**付ける。写真の「上のほうに横へ広がる疎らな葉」になる。
    branches: [[20, 22, 12.5, 19.5], [20, 22, 27.5, 19.5]],
    leaves: [
      [19, 15, -100, 12, 3.3], [19, 15, -140, 10.5, 2.9], [19, 15, -58, 10.5, 2.9],
      [16.5, 20.8, 215, 9, 2.5], [12.5, 19.5, 190, 11, 3.1], [12.5, 19.5, 158, 9.5, 2.6],
      [23.5, 20.8, -35, 9, 2.5], [27.5, 19.5, -10, 11, 3.1], [27.5, 19.5, 22, 9.5, 2.6],
    ],
  },
];


// 房の中で葉を1枚ずつずらして開く。全部が同時に出ると「開いた」に見えない。
// 前の葉が半分ほど開いたころ次が動き出す長さ(重ねないと房の開きが間延びする)。
const LEAF_STAGGER = 0.45;

// 幹・枝の1本。伸び具合 L(0〜1)を **dashoffset ではなく dasharray** で表す:
// 「見せる長さ」をそのまま書けるので、pathLength=1 と合わせて読み違えようがない。
//
// 【L が 0 のときは描かない】丸い先端(strokeLinecap="round")は**長さ 0 の破線も
// 点として描く**。素直に書くと、株が伸びる前に枝の根元の位置へ点が5つ浮かぶ
// (実際に出た)。0 を弾くだけで直る。
const grownDash = (L) => `${L} 1`;
function Stem({ d, width, len }) {
  if (len <= 0.001) return null;
  return (
    <path d={d} pathLength="1" fill="none" stroke="var(--c-accent-mid)" strokeWidth={width}
      strokeLinecap="round" strokeDasharray={grownDash(len)} />
  );
}

// step: この待ちがどの段階かを進捗の帳簿に伝える。**省くと帳簿を進めずに
// 今の値のまま出す** ── 目安の一覧のように名簿と**並行して**走る読みは、
// 段階をもう1つ足すと「名簿より先に終わった側で数字が巻き戻る」ので、
// 進めずに出すのが正しい。
export default function LoadingFicus({ step = null }) {
  const [pct, setPct] = useState(() => loadFloor());

  useEffect(() => {
    if (step) beginLoad(step);
    // 【動きを減らす設定では内挿しない】段階の入口の値だけを出し、rAF も回さない。
    // 数字は 0 → 45 → 80 と跳ぶが、**それが実際に分かっていることの全部**なので、
    // 動きを止めても情報は一つも減らない(§1.11)。
    const still = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) { setPct(loadFloor()); return; }
    let raf = 0;
    const tick = () => { setPct(loadPercent()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  return (
    // role="img" + 固定の名前。role="status" にすると数字が変わるたびに
    // 読み上げが走り、1秒に何十回も「43%」「44%」と喋る。
    <div role="img" aria-label="読み込み中"
      style={{ padding: "var(--sp-6)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-3)" }}>
      <FicusMark p={pct / 100} />
      <div className="sans" style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", lineHeight: 1 }}>
        {Math.floor(pct)}%
      </div>
    </div>
  );
}

// 葉1枚。柄の位置を軸に開くので、scale がそのまま「葉が広がる」に見える。
function Leaf({ x, y, angle, len, half, t }) {
  if (t <= 0.001) return null; // scale(0) は描かせない
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${t.toFixed(3)})`}>
      <ellipse cx={len / 2} cy="0" rx={len / 2} ry={half} fill="var(--c-accent)" />
      {/* 主脈。実物の葉は**脈だけが白く浮いて**見えるので、そこだけ淡い段を置く */}
      <path d={`M 1.4 0 L ${(len * 0.84).toFixed(2)} 0`} stroke="var(--c-accent-line)"
        strokeWidth="1" strokeLinecap="round" fill="none" />
    </g>
  );
}

// 育ち具合 p(0〜1)の姿を描くだけの部品。進捗の帳簿を知らないので、
// **止め絵として好きな p で描ける**(検証ページが育ちの各段を並べるのに使う)。
export function FicusMark({ p }) {
  const g = ficusGrowth(p);
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="56" height="125" aria-hidden="true" style={{ display: "block" }}>
      {/* 鉢。**揺れの外に置く** ── 鉢まで一緒に揺れると、床ごと動いて見える。
          実物は白い鉢なので、地(白)との境は塗りではなく細い罫が担う。 */}
      <g opacity={g.pot.toFixed(3)}>
        <path d="M 15 97 L 15 104 Q 15 114 26 114 Q 37 114 37 104 L 37 97 Z"
          fill="var(--c-sunken)" stroke="var(--c-line-strong)" strokeWidth="0.9" />
        {/* 鉢の口。実物は白い鉢に麻布が見えている所で、ここでは一段沈めた輪で表す */}
        <ellipse cx="26" cy="97" rx="11" ry="2.2" fill="var(--c-line-strong)" />
      </g>
      <g className="ficus-grow">
        {/* 根元だけ太い。丸い先端が細い幹へなだらかに続き、実物の裾広がりになる */}
        <Stem d={TRUNK_D} width="4" len={Math.min(g.trunk, 0.18)} />
        <Stem d={TRUNK_D} width="2.6" len={g.trunk} />
        {TIERS.map((tier, ti) => {
          const t = g.tiers[ti];
          const n = tier.leaves.length;
          return (
            <g key={ti}>
              {tier.branches.map(([ax, ay, bx, by], bi) => (
                <Stem key={bi} d={`M ${ax} ${ay} L ${bx} ${by}`} width="1.5" len={t.branch} />
              ))}
              {tier.leaves.map(([x, y, angle, len, half], li) => {
                // 1枚ずつずらして開く。前の葉が開ききる前に次が動き出す。
                const from = (li / n) * LEAF_STAGGER;
                const open = Math.min(1, Math.max(0, (t.leaves - from) / (1 - LEAF_STAGGER)));
                return <Leaf key={li} x={x} y={y} angle={angle} len={len} half={half} t={open} />;
              })}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
