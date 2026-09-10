import { useEffect, useId, useState } from "react";
import { beginLoad, loadPercent, loadFloor, ficusGrowth } from "./loadProgress.js";

// ------------------------------------------------------------------
// コミュニティタブの読み込み中の絵。ficus(アプリの印)が読み込みに合わせて育つ。
//
// 【ここは firebase を一切 import しない】App.jsx の Suspense の fallback が
// この要素を描く。fallback が重い依存を連れてくると、**遅延読み込みの意味が
// 消える**(待たせている当のものを、待つ画面が読み込んでしまう)。
// import してよいのは React と loadProgress.js(純粋な計算)だけ。
//
// 【形は public/icon.svg の葉そのもの】100% でアプリの印と同じ姿になる。
// 座標は icon.svg を 0.26 倍して、傾き -18° と葉身・主脈・側脈4対の関係を
// そのまま写した。ここで別の生き物を描くと、印が2つあるアプリになる。
// ------------------------------------------------------------------

// 葉の中心(傾きの軸)と、葉柄の付け根(葉が開くときの軸)。
const LEAF_CX = 22, LEAF_CY = 44.2, JOIN_Y = 83.2;
// 側脈4対。y が大きいほど根元側で、根元から先端へ順に引かれる。
const VEINS = [
  { y: 63.7, ty: 57.46 },
  { y: 52.0, ty: 45.76 },
  { y: 40.3, ty: 34.06 },
  { y: 28.6, ty: 22.36 },
];
const VEIN_DX = 14.8;
// 葉身の輪郭。塗りと**脈の切り抜きの両方**がこれを使う(綴りを2つ置かない)。
const BLADE_D = `M ${LEAF_CX} 5.2 Q 46 38.35 ${LEAF_CX} ${JOIN_Y} Q -2 38.35 ${LEAF_CX} 5.2 Z`;

// step: この待ちがどの段階かを進捗の帳簿に伝える。**省くと帳簿を進めずに
// 今の値のまま出す** ── 目安の一覧のように名簿と**並行して**走る読みは、
// 段階をもう1つ足すと「名簿より先に終わった側で数字が巻き戻る」ので、
// 進めずに出すのが正しい。
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

// 育ち具合 p(0〜1)の姿を描くだけの部品。進捗の帳簿を知らないので、
// **止め絵として好きな p で描ける**(検証ページが育ちの各段を並べるのに使う)。
export function FicusMark({ p }) {
  // 切り抜きの id。1つの画面に2つ並ぶ場面(検証ページ)で衝突しないよう毎回ずらす。
  const clipId = `ficus-blade-${useId().replace(/:/g, "")}`;
  const g = ficusGrowth(p);
  // 葉身・主脈・側脈は**同じ入れ物**の中で開く。別々に育てると、葉がまだ
  // 小さいうちに主脈だけが原寸で伸びて葉からはみ出す。
  const open = `translate(${LEAF_CX} ${JOIN_Y}) scale(${g.bladeX.toFixed(4)} ${g.bladeY.toFixed(4)}) translate(${-LEAF_CX} ${-JOIN_Y})`;
  return (
    <svg viewBox="0 0 40 98" width="34" height="84" aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <g className="ficus-grow">
        <g transform={`rotate(-18 ${LEAF_CX} ${LEAF_CY})`}>
          {/* 茎。地際から葉柄の付け根へ向かって伸びる(0% でも少しだけ出ている) */}
          <path d={`M ${LEAF_CX} 92 L ${LEAF_CX} ${JOIN_Y}`} pathLength="1"
            stroke="var(--c-accent)" strokeWidth="2.9" strokeLinecap="round" fill="none"
            strokeDasharray="1" strokeDashoffset={(1 - g.stem).toFixed(4)} />
          <g transform={open}>
            {/* 葉身。icon.svg と同じ二次曲線2本 */}
            <path d={BLADE_D} fill="var(--c-accent-line)" />
            {/* 【脈は葉身の中だけに出す】icon.svg では脈が葉からはみ出しているが、
                あちらは**地の紺と同じ色で描いている**ので、はみ出した分は地に
                溶けて見えない。白地のこちらでそのまま写すと、葉の外に線が
                4対突き出て絵が壊れる。切り抜いて、印と同じ見え方に揃える。 */}
            <clipPath id={clipId}><path d={BLADE_D} /></clipPath>
            <g clipPath={`url(#${clipId})`}>
            {/* 主脈。根元から先端へ走る */}
            <path d={`M ${LEAF_CX} 77.7 L ${LEAF_CX} 10.7`} pathLength="1"
              stroke="var(--c-accent)" strokeWidth="1.8" strokeLinecap="round" fill="none"
              vectorEffect="non-scaling-stroke"
              strokeDasharray="1" strokeDashoffset={(1 - g.midrib).toFixed(4)} />
            {/* 側脈。左右を別の path にする ── ひと続きにすると片側が引き終わってから
                もう片側が始まり、左右が揃わない(dasharray は subpath をまたいで連なる)。 */}
            {VEINS.map((v, i) => (
              <g key={v.y} strokeDasharray="1" strokeDashoffset={(1 - g.veins[i]).toFixed(4)}>
                <path d={`M ${LEAF_CX} ${v.y} L ${LEAF_CX + VEIN_DX} ${v.ty}`} pathLength="1"
                  stroke="var(--c-accent)" strokeWidth="1.05" strokeLinecap="round" fill="none"
                  vectorEffect="non-scaling-stroke" />
                <path d={`M ${LEAF_CX} ${v.y} L ${LEAF_CX - VEIN_DX} ${v.ty}`} pathLength="1"
                  stroke="var(--c-accent)" strokeWidth="1.05" strokeLinecap="round" fill="none"
                  vectorEffect="non-scaling-stroke" />
              </g>
            ))}
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
