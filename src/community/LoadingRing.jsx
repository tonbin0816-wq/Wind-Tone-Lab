import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { beginLoad, loadPercent, loadFloor } from "./loadProgress.js";
import { SPROUT_OUTER, SPROUT_HOLE, SPROUT_OUTER_SHARE } from "./sproutPath.js";

// ------------------------------------------------------------------
// コミュニティタブの読み込み中の絵。アプリアイコンの芽の輪郭が1本の線で
// なぞられていき、**90% で輪郭が閉じ、残りの 10% で中が紺に塗られる**。
// 100% でアイコンの芽と同じ姿になる。下に%の数字が出る。
//
// 【ここは firebase を一切 import しない】App.jsx の Suspense の fallback が
// この要素を描く。fallback が重い依存を連れてくると、**遅延読み込みの意味が
// 消える**(待たせている当のものを、待つ画面が読み込んでしまう)。
// import してよいのは React と loadProgress.js(純粋な計算)と sproutPath.js
// (芽の形。import を持たない純粋なデータ)だけ。
//
// 【2026-10-06 本人裁定】輪(09/13〜)をやめ、アイコンの芽を描く形にした。
// 見本の案(芽が伸びる・下から満ちる・線で描いて塗る・アイコンの枠ごと・輪の中に芽・
// F を書く)から「線で描いて塗る」を選び、「9割で閉じる」と指示(見本は 8 割で閉じていた)。
// 絵は**時間ではなく進み具合で決まる** ── 読み込みが止まれば絵も止まり、
// 100% で必ず完成する。輪のときと同じく、数字と同じことを言う絵である。
// 経緯は design/DESIGN-SYSTEM.md §1.12。
//
// 【色】線も塗りも --c-accent(アイコンと同じ紺)。数字は --c-ink-3 のまま。
// ------------------------------------------------------------------

// 芽の外接箱(1024 四方のうち x 226〜840・y 201〜838)を中心に 720 四方で切り出す
const VIEWBOX = "173 160 720 720";
const SIZE = 88;
const INK = "var(--c-accent)";
// 線の太さ(1024 の座標で)。88px の絵では約 1.5px
const W = 12;
// ここまでで輪郭が閉じる。残りで中を塗る
export const CLOSE_AT = 0.9;
const clamp01 = (x) => Math.min(1, Math.max(0, x || 0));

// 進み具合 → 絵の段階。outer / hole は輪郭をなぞった割合、fill は塗りの濃さ、line は線の濃さ
export function sproutStage(p) {
  const frac = clamp01(p);
  const line = clamp01(frac / CLOSE_AT);
  const fillRaw = clamp01((frac - CLOSE_AT) / (1 - CLOSE_AT));
  const fill = 1 - Math.pow(1 - fillRaw, 2.2);
  return {
    // 外形を先に(右上の葉の先から)、残りで根元の巻きの穴をなぞる
    outer: clamp01(line / SPROUT_OUTER_SHARE),
    hole: clamp01((line - SPROUT_OUTER_SHARE) / (1 - SPROUT_OUTER_SHARE)),
    fill,
    // 塗りが濃くなるぶん線を消す(残すと線の太さだけ芽が太ってアイコンと違う形になる)
    line: 1 - fill,
  };
}

// 【便CK 2026-10-10】size = 引っ張って更新の印(PullToRefresh.jsx)が同じ芽を小さく描くための口(値はトークン var(--tap-min))。
// 渡さない呼び手(読み込み中の画面)は今までどおり 88px の属性だけで描く(style も1文字も変わらない)。
export function LoadingRing({ p, size = null }) {
  const { outer, hole, fill, line } = sproutStage(p);
  // **pathLength=1** にしてあるので、dasharray に「見せる割合」をそのまま書ける(長さを計算しない)。
  const stroke = { pathLength: "1", fill: "none", stroke: INK, strokeWidth: W,
    strokeLinecap: "round", strokeLinejoin: "round", opacity: line };
  return (
    <svg viewBox={VIEWBOX} width={SIZE} height={SIZE} aria-hidden="true"
      style={size ? { display: "block", width: size, height: size } : { display: "block" }}>
      {fill > 0 && <path d={SPROUT_OUTER + SPROUT_HOLE} fillRule="evenodd" fill={INK} opacity={fill} />}
      {/* 【0 のときは描かない】丸い先端は**長さ 0 の破線も点として描く**ので、
          素直に書くと 0% の芽の先に点が1つ乗る(株と輪で同じ罠を2度踏んでいる)。
          塗り終わって線が消えたときも描かない。 */}
      {line > 0.001 && outer > 0.002 && <path d={SPROUT_OUTER} strokeDasharray={`${outer} 1`} {...stroke} />}
      {line > 0.001 && hole > 0.002 && <path d={SPROUT_HOLE} strokeDasharray={`${hole} 1`} {...stroke} />}
    </svg>
  );
}

// step: この待ちがどの段階かを進捗の帳簿に伝える。**省くと帳簿を進めずに
// 今の値のまま出す** ── 目安の一覧のように名簿と**並行して**走る読みは、
// 段階をもう1つ足すと「名簿より先に終わった側で数字が巻き戻る」ので、
// 進めずに出すのが正しい。
export default function LoadingRingBox({ step = null }) {
  const [pct, setPct] = useState(() => loadFloor());
  // 【C1 2026-09-16 実機の指摘】絵(芽)を**見えている領域の縦の中央**に置く。
  // 領域 = この包みの上端(chunk / account なら本文の先頭、list なら子タブ帯の下端)〜下部ナビの上端。
  // 包みの高さを「可視高(100dvh)− 下部ナビ(--page-bottom-gap)− 包みの上端」にして中を中央寄せする。
  // 上端は文書座標で1度測る(スクロール位置に依らない。App.jsx の fillViewportMinHeight と同じ考え)。
  // 新しい数は書かない: 100dvh と --page-bottom-gap は既存のトークン、上端は実測値。
  // dvh 未対応の環境では minHeight の宣言ごと落ちて、以前どおり中身の高さになる。
  const boxRef = useRef(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const el = boxRef.current;
      if (!el) return;
      setTop(Math.max(0, el.getBoundingClientRect().top + (window.scrollY || 0)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

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
    <div role="img" aria-label="読み込み中" ref={boxRef}
      style={{
        padding: "var(--sp-6)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        minHeight: `calc(100dvh - var(--page-bottom-gap) - ${top}px)`,
      }}>
      {/* 【中央に来るのは絵】数字は絵の下に**絶対配置**で添える ── 流れの中に置くと
          絵 + 余白 + 数字の塊が中央に来て、絵そのものは中点より上にずれる。 */}
      <div style={{ position: "relative" }}>
        <LoadingRing p={pct / 100} />
        <div className="sans" style={{
          position: "absolute", top: "calc(100% + var(--sp-3))", left: 0, right: 0, textAlign: "center",
          fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", lineHeight: 1,
        }}>
          {Math.floor(pct)}%
        </div>
      </div>
    </div>
  );
}
