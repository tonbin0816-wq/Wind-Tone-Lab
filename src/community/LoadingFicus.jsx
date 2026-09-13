import { useEffect, useId, useState } from "react";
import { beginLoad, loadPercent, loadFloor, ficusGrowth } from "./loadProgress.js";

// ------------------------------------------------------------------
// コミュニティタブの読み込み中の絵。ficus が読み込みに合わせて育つ。
//
// 【ここは firebase を一切 import しない】App.jsx の Suspense の fallback が
// この要素を描く。fallback が重い依存を連れてくると、**遅延読み込みの意味が
// 消える**(待たせている当のものを、待つ画面が読み込んでしまう)。
// import してよいのは React と loadProgress.js(純粋な計算)だけ。
//
// 【姿は本人の株 2026/09/10 写真で指定】曲げ仕立てのフィカス・ベンガレンシス。
// 鉢から**うねる幹**が立ち、葉の房が4段。本人の言葉「ロードが進むたびに
// この巻いている幹が伸びていくイメージ」がそのまま骨格になっている ──
// 幹が根元から先端へ伸び、**房はその先端が通り過ぎた所から**開く。
//
// 【単色・静かに 2026/09/12 本人指示】色は1つだけで、**下に出る%の数字と
// 同じ段**。待っているあいだの絵が、待つことより目立ってはいけない ──
// 主役はこのあと出てくる中身のほう。
// ------------------------------------------------------------------

// 絵の枠。**検証がここを読んで、葉が枠から出ていないかを見る**(実際に樹冠を
// 枠の外へ出しかけた)。値を変えるときは検証も一緒に走らせること。
export const VIEW_W = 58, VIEW_H = 96;

// 土の高さ。**ここから下は鉢の中**で、株はここで切る(下を見ること)。
export const SOIL_Y = 77;

// 下に出る%の数字と**同じ色**。白地とのコントラストは 3.03:1 で、
// 非文字の部品に WCAG 1.4.11 が求める 3:1 をちょうど超える。
// これより薄い段(--c-ink-4 = 2.2:1)へ落とすと基準を割る。
const INK = "var(--c-ink-3)";

// うねる幹。土より少し下(29, 78)から樹冠(28, 29)へ。
// 【背は低く 2026/09/11 本人指示】高さ 48(最初は 79)。うねりの振れ幅は ±5.5 の
// まま残したので、**背が縮んだぶんうねりは強く出る**(写真の曲げ仕立てに近い)。
// 78 から始めるのは、土の高さでちょうど切られて「土に入っている」ように
// 見せるため(丸い先端が土の上に丸く残らない)。
export const TRUNK_D = "M 29 78 C 29 71 34 68 34 61 C 34 54 23 52 23 45 "
  + "C 23 38 29 36 28 29";

// 鉢。実物は白い鉢なので**塗らずに輪郭**で描く。
const POT_D = "M 17 77 L 17 85 Q 17 94 29 94 Q 41 94 41 85 L 41 77 Z";

// 房。**枝1本ぶんの [根元x, 根元y, 先x, 先y] だけ**を持ち、葉は枚数から
// 組み立てる(tierLeaves)。以前は葉を1枚ずつ手で置いていたが、それだと
// 「1房を何枚にするか」を変えるたびに全部の座標を置き直すことになる。
//
// 高さは幹の伸び(0.04→0.72)と対応させてある ── 房が開くころ、幹の先端は
// ちょうどその高さを通り過ぎている。左右は交互。
//
// 【いちばん上も「片側へ出る房」 2026/09/13 本人指示】以前は幹の先端から
// 上・左・右へ放射させていたが、本人評「1番上の右左真ん中に分かれる葉、要らない」。
// 他の3段と同じ**片側へ出る枝**にして、株ぜんぶが同じ作りになった。
export const TIERS = [
  { branch: [34, 61.5, 38.5, 63.5] }, // 1段目 右
  { branch: [26.5, 50, 18, 51.5] },   // 2段目 左
  { branch: [30, 38, 37, 36] },       // 3段目 右
  { branch: [28, 29, 20, 23] },       // 4段目 左(頂)
];

// 【1つの房の枚数 2026/09/12 本人指示「最大3まで」】房ごとに決めず、
// **ここ1つ**で全部の房が変わる。濃くしたくなったら房を足す(TIERS に1行)。
// 3枚は「左右へ開いて、間から幹が見える」限界の枚数でもある ── 幹が伸びるのを
// 見せるための絵なので、葉で幹を埋めては本末転倒になる。
export const LEAVES_PER_TIER = 3;
// 隣り合う葉の角度差。ただし房ぜんたいの開きは FAN_MAX_DEG を超えない ──
// 枚数を増やしたときに端の葉が真下や真上を向いて、枠や鉢へ突っ込むのを防ぐ。
const FAN_STEP_DEG = 42, FAN_MAX_DEG = 110;
// 葉の長さと縦横比(長さ : 幅)。2 未満にすると丸くて木の実に見える。
const LEAF_LEN = 15, LEAF_RATIO = 2;
// 房の中で外側の葉ほど短くする割合。真ん中が一番長い。
const LEAF_TAPER = 0.09;

const r2 = (v) => Math.round(v * 100) / 100;

// 枝1本に n 枚の葉を扇に開く。[x, y, 角度, 長さ, 半幅] の並びを返す。
// 葉は枝の**途中から先端まで**に散らす ── 先端に集めると三つ葉の飾りになる。
export function tierLeaves(branch, n = LEAVES_PER_TIER, opt = {}) {
  const spread = opt.spread ?? FAN_STEP_DEG;
  const maxLen = opt.len ?? LEAF_LEN;
  const ratio = opt.ratio ?? LEAF_RATIO;
  const [ax, ay, bx, by] = branch;
  const dir = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  const step = n <= 1 ? 0 : Math.min(spread, FAN_MAX_DEG / (n - 1));
  const mid = (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 1 : 0.62 + 0.38 * (i / (n - 1));
    const len = maxLen * (1 - LEAF_TAPER * Math.abs(i - mid));
    return [
      r2(ax + (bx - ax) * t), r2(ay + (by - ay) * t),
      r2(dir + step * (i - mid)), r2(len), r2(len / (2 * ratio)),
    ];
  });
}

// 房の中で葉を1枚ずつずらして開く。全部が同時に出ると「開いた」に見えない。
// 前の葉が半分ほど開いたころ次が動き出す長さ(重ねないと房の開きが間延びする)。
const LEAF_STAGGER = 0.45;

// 幹・枝の太さ。【細く 2026/09/13 本人指示】3.2 → 2.4。葉を1房3枚まで
// 減らしたぶん幹が目立つようになったので、下げて釣り合いを戻す。
const TRUNK_W = 2.4, TRUNK_BASE_W = 3.6, BRANCH_W = 1.5;

// 幹・枝の1本。伸び具合 L(0〜1)を **dashoffset ではなく dasharray** で表す:
// 「見せる長さ」をそのまま書けるので、pathLength=1 と合わせて読み違えようがない。
//
// 【L が 0 のときは描かない】丸い先端(strokeLinecap="round")は**長さ 0 の破線も
// 点として描く**。素直に書くと、株が伸びる前に枝の根元の位置へ点が4つ浮かぶ
// (実際に出た)。0 を弾くだけで直る。
const grownDash = (L) => `${L} 1`;
function Stem({ d, width, len }) {
  if (len <= 0.001) return null;
  return (
    <path d={d} pathLength="1" fill="none" stroke={INK} strokeWidth={width}
      strokeLinecap="round" strokeDasharray={grownDash(len)} />
  );
}

// 葉1枚。柄の位置を軸に開くので、scale がそのまま「葉が広がる」に見える。
//
// 【葉と葉のあいだは「地」で切る】単色では葉が重なった所が融ける。淡い縁を
// 足すのは2色目を持つのと同じなので、縁を**地の色そのもの**(--c-bg)にする ──
// 塗っているのではなく、地が透けている幅を作っているだけなので、インクは1色のまま。
// vectorEffect が無いと、開きかけの葉で隙間が細って育ち始めだけ塊に見える。
//
// 【葉脈は引かない】淡い脈は2色目。地で抜くとこの大きさでは隙間と見分けられず、
// 葉が割れて見える。
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
  // 切り抜きの id。1つの画面に2つ並ぶ場面(検証ページ)で衝突しないよう毎回ずらす。
  const clipId = `ficus-soil-${useId().replace(/:/g, "")}`;
  const g = ficusGrowth(p);
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="76" height="126" aria-hidden="true" style={{ display: "block" }}>
      {/* 【株は土の高さで切る 2026/09/13 本人指示】本人評「下の幹が鉢よりも
          前に出ているように見える」。鉢は塗らない輪郭なので、幹の**丸い先端**が
          土の下へはみ出すと、空の鉢の中に浮いて見えていた。ここで切ると
          幹は土の高さで断ち切られ、土に入っているように読める。 */}
      <clipPath id={clipId}><rect x="0" y="0" width={VIEW_W} height={SOIL_Y} /></clipPath>
      <g clipPath={`url(#${clipId})`}>
        {/* 根元だけ太い。丸い先端が細い幹へなだらかに続き、実物の裾広がりになる */}
        <Stem d={TRUNK_D} width={TRUNK_BASE_W} len={Math.min(g.trunk, 0.18)} />
        <Stem d={TRUNK_D} width={TRUNK_W} len={g.trunk} />
        {TIERS.map((tier, ti) => {
          const t = g.tiers[ti];
          const leaves = tierLeaves(tier.branch);
          const n = leaves.length;
          return (
            <g key={ti}>
              <Stem d={`M ${tier.branch[0]} ${tier.branch[1]} L ${tier.branch[2]} ${tier.branch[3]}`}
                width={BRANCH_W} len={t.branch} />
              {leaves.map(([x, y, angle, len, half], li) => {
                // 1枚ずつずらして開く。前の葉が開ききる前に次が動き出す。
                const from = (li / n) * LEAF_STAGGER;
                const open = Math.min(1, Math.max(0, (t.leaves - from) / (1 - LEAF_STAGGER)));
                return <Leaf key={li} x={x} y={y} angle={angle} len={len} half={half} t={open} />;
              })}
            </g>
          );
        })}
      </g>
      {/* 鉢は育たない(最初から最後までここに居る)。**株より後に描く** ──
          先に描くと、口の罫を幹が跨いで前に出て見える。 */}
      <path d={POT_D} fill="none" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
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
