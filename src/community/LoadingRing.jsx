import { useEffect, useState } from "react";
import { beginLoad, loadPercent, loadFloor } from "./loadProgress.js";

// ------------------------------------------------------------------
// コミュニティタブの読み込み中の絵。ドーナツが埋まり、下に%の数字が出る。
//
// 【ここは firebase を一切 import しない】App.jsx の Suspense の fallback が
// この要素を描く。fallback が重い依存を連れてくると、**遅延読み込みの意味が
// 消える**(待たせている当のものを、待つ画面が読み込んでしまう)。
// import してよいのは React と loadProgress.js(純粋な計算)だけ。
//
// 【2026/09/13 本人裁定】ここには写真の株(曲げ仕立てのベンガレンシス)が
// 育つ絵を置いていたが、「絵はいいや。ドーナツ状のアニメーションと下の数字
// だけで ok」。**輪は進捗そのものの形**で、数字と同じことを言う ── 絵より
// 素直で、待っているあいだ何を見ればよいかが1つに決まる。
// 経緯と外した理由は design/DESIGN-SYSTEM.md §1.12。
//
// 【色】輪も数字も --c-ink-3(白地と 3.03:1。非文字の部品に WCAG 1.4.11 が
// 求める 3:1 をちょうど超える)。待っているあいだの絵が、待つことより
// 目立ってはいけない ── 主役はこのあと出てくる中身のほう。
// ------------------------------------------------------------------

// 輪の寸法。R は中心から**線の真ん中**までなので、外形は R*2 + W。
const VIEW = 48, CX = 24, CY = 24, R = 20, W = 3.5;
const INK = "var(--c-ink-3)";
// 埋まっていない側。index.css がこの色に与えている役どころが「罫線・**トラック**」で、
// まさにこれ。輪の形は残しつつ、埋まった側とはっきり分かれる。
const TRACK = "var(--c-line)";

// 12時から時計回りに埋める。**pathLength=1** にしてあるので、
// dasharray に「見せる割合」をそのまま書ける(円周を計算しない)。
// 幹を伸ばしていたころと同じ書き方 ── dashoffset は「隠す長さ」なので符号を
// 間違えやすい。
const ARC_D = `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.001} ${CY - R}`;

export function LoadingRing({ p }) {
  const frac = Math.min(1, Math.max(0, p || 0));
  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} width="60" height="60" aria-hidden="true" style={{ display: "block" }}>
      <circle cx={CX} cy={CY} r={R} fill="none" stroke={TRACK} strokeWidth={W} />
      {/* 【0 のときは描かない】丸い先端は**長さ 0 の破線も点として描く**ので、
          素直に書くと 0% の輪の上に点が1つ乗る(株を描いていたころ、同じ罠で
          枝の根元に点が4つ浮いた)。 */}
      {frac > 0.002 && (
        <path d={ARC_D} pathLength="1" fill="none" stroke={INK} strokeWidth={W}
          strokeLinecap="round" strokeDasharray={`${frac} 1`} />
      )}
    </svg>
  );
}

// step: この待ちがどの段階かを進捗の帳簿に伝える。**省くと帳簿を進めずに
// 今の値のまま出す** ── 目安の一覧のように名簿と**並行して**走る読みは、
// 段階をもう1つ足すと「名簿より先に終わった側で数字が巻き戻る」ので、
// 進めずに出すのが正しい。
export default function LoadingRingBox({ step = null }) {
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
      <LoadingRing p={pct / 100} />
      <div className="sans" style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", lineHeight: 1 }}>
        {Math.floor(pct)}%
      </div>
    </div>
  );
}
