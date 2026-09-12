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
// 【単色・静かに 2026/09/11 → 09/12 本人指示】色は1つだけ。
// 一度目は紺の4段で塗り分け、二度目は --c-accent の1色にした。本人評
// 「**色が濃い、もっと静かにしたい。%のテキストと同じ色にして**」。
// いまは絵も%の数字も同じ --c-ink-3。**待っているあいだの絵が、待つこと
// より目立ってはいけない** ── 主役はこのあと出てくる中身のほう。
// 鉢だけは塗らずに輪郭にして、同じ1色のまま株を前に出す。
// ------------------------------------------------------------------

// 絵の枠。**検証がここを読んで、葉が枠から出ていないかを見る**(実際に樹冠を
// 枠の外へ出しかけた)。値を変えるときは検証も一緒に走らせること。
export const VIEW_W = 58, VIEW_H = 96;

// 【色は1つだけ 2026/09/11 本人指示】鉢も幹も葉も --c-accent。
// 淡い段(幹 --c-accent-mid / 葉脈 --c-accent-line / 鉢 --c-sunken)で
// 塗り分けていたが、小さく出すと**色の数だけが目に付いて姿が読めない**。
// 鉢だけは塗らずに輪郭にする ── 同じ1色のまま、実物の白い鉢と、
// 中の株が前に出る関係が保てる。
// 下に出る%の数字と**同じ色**。白地とのコントラストは 3.03:1 で、
// 非文字の部品に WCAG 1.4.11 が求める 3:1 をちょうど超える。
// これより薄い段(--c-ink-4 = 2.2:1)へ落とすと基準を割る。
const INK = "var(--c-ink-3)";

// うねる幹。土の高さ(29, 77)から樹冠(28, 29)へ。
// 【背は低く 2026/09/11 本人指示】高さ 48(前は 79)。うねりの振れ幅は ±5.5 の
// まま残したので、**背が縮んだぶんうねりは強く出る**(写真の曲げ仕立てに近い)。
// 低くしたぶんの余白は葉に回してある。
export const TRUNK_D = "M 29 77 C 29 71 34 68 34 61 C 34 54 23 52 23 45 "
  + "C 23 38 29 36 28 29";

// 葉の房。branches = [根元x, 根元y, 先x, 先y] の並び / leaves = [x, y, 角度, 長さ, 半幅]。
// 半幅は長さの 1/4(実物の葉は細長い。1/3.2 だと丸くて木の実に見えた)。
//
// 【1つの房は3枚まで 2026/09/12 本人指示】19枚 → 27枚 → **12枚**。
// 27枚は「葉の数が多すぎる」。房ごとに枚数を決めるのではなく**上限を3枚**と
// 決めてあるので、房を足したくなったらここに房を1つ足す ── 1つの房を
// 濃くしない。3枚は「左右へ開いて、間から幹が見える」限界の枚数でもある。
//
// 葉は枝の**途中にも**付ける ── 先端に集めると三つ葉の飾りになる。
// 高さは幹の伸び(0.04→0.72)と対応させてある ── 房が開くころ、幹の先端は
// ちょうどその高さを通り過ぎている。
export const TIERS = [
  { // 1段目。低い位置の右
    branches: [[34, 61.5, 39, 63.5]],
    leaves: [[36.5, 62.5, -30, 13, 3.25], [39, 63.5, 4, 15, 3.75], [39, 63.5, 38, 13, 3.25]],
  },
  { // 2段目。中ほどの左
    branches: [[26.5, 50, 18, 51.5]],
    leaves: [[21, 50.9, 218, 13, 3.25], [18, 51.5, 184, 16, 4], [18, 51.5, 150, 14, 3.5]],
  },
  { // 3段目。中ほどの右
    branches: [[23.5, 39.5, 32, 37.5]],
    leaves: [[28.5, 38.4, -46, 13, 3.25], [32, 37.5, -8, 16, 4], [32, 37.5, 26, 14, 3.5]],
  },
  { // 4段目。樹冠。上・左・右の3方向へ1枚ずつ張る
    branches: [[28, 29, 21, 25.5], [28, 29, 35, 26]],
    leaves: [[28, 29, -95, 17, 4.25], [21, 25.5, 198, 15, 3.75], [35, 26, -14, 15, 3.75]],
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
    <path d={d} pathLength="1" fill="none" stroke={INK} strokeWidth={width}
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
//
// 【葉と葉のあいだは「地」で切る】単色で 26 枚を重ねると、**ひとつの塊**に
// 潰れて葉が1枚も見えない(実際にそうなった)。かといって淡い縁を足すのは
// 2色目を持つのと同じ。そこで縁を**地の色そのもの**(--c-bg)にする ──
// 塗っているのではなく、地が透けている幅を作っているだけなので、
// インクは --c-accent の1色のまま。
//
// vectorEffect: 葉が小さいときも隙間の幅を変えない。付けないと、開きかけの
// 葉では隙間が scale ぶん細り、育ち始めだけ塊に見える。
//
// 【葉脈は引かない】淡い脈は2色目になる。地で抜くこともできるが、
// この大きさでは脈の幅が隙間と見分けられず、葉が割れて見える。
function Leaf({ x, y, angle, len, half, t }) {
  if (t <= 0.001) return null; // scale(0) は描かせない
  return (
    <ellipse cx={len / 2} cy="0" rx={len / 2} ry={half} fill={INK}
      stroke="var(--c-bg)" strokeWidth="0.9" vectorEffect="non-scaling-stroke"
      transform={`translate(${x} ${y}) rotate(${angle}) scale(${t.toFixed(3)})`} />
  );
}

// 育ち具合 p(0〜1)の姿を描くだけの部品。進捗の帳簿を知らないので、
// **止め絵として好きな p で描ける**(検証ページが育ちの各段を並べるのに使う)。
export function FicusMark({ p }) {
  const g = ficusGrowth(p);
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="76" height="126" aria-hidden="true" style={{ display: "block" }}>
      {/* 鉢。**育たないので進捗を見ない**(最初から最後までここに居る)。
          **揺れの外に置く** ── 鉢まで一緒に揺れると床ごと動いて見える。
          塗らずに輪郭にするのは、単色のまま実物の白い鉢を出すため。 */}
      <path d="M 17 77 L 17 85 Q 17 94 29 94 Q 41 94 41 85 L 41 77 Z"
        fill="none" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <g className="ficus-grow">
        {/* 根元だけ太い。丸い先端が細い幹へなだらかに続き、実物の裾広がりになる */}
        <Stem d={TRUNK_D} width="5" len={Math.min(g.trunk, 0.18)} />
        <Stem d={TRUNK_D} width="3.2" len={g.trunk} />
        {TIERS.map((tier, ti) => {
          const t = g.tiers[ti];
          const n = tier.leaves.length;
          return (
            <g key={ti}>
              {tier.branches.map(([ax, ay, bx, by], bi) => (
                <Stem key={bi} d={`M ${ax} ${ay} L ${bx} ${by}`} width="2" len={t.branch} />
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
