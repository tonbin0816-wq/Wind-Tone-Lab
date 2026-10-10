import React, { useEffect, useRef, useState } from "react";
import { LoadingRing } from "./LoadingRing.jsx";
// 軸判定と「測れなければ」のしきい値は §6.3 の横スワイプと同じもの(写しを作らない)。
import { swipeAxisIsHorizontal, SWIPE_BACK_THRESHOLD_MIN } from "../App.jsx";

// ------------------------------------------------------------------
// 【便CK 2026-10-10 本人「よくある下にスワイプでリロードの仕様も追加して」】コミュニティタブの「引っ張って更新」。
// 規範は design/DESIGN-SYSTEM.md §6.3a。ここが持つのは**指の扱いと印の描き方だけ**で、
// 何を読み直すかは呼び手(CommunityTab.jsx の CommunityTabBody)が「もう一度試す」と同じ読みで決める。
//
//   ・画面の一番上で、縦の下向きと決まった指だけを掴む(軸判定は SwipePager / シートと同じ swipeAxisIsHorizontal)。
//     横と決まった指・上向きの指は手放す(子タブの横スワイプとスクロールのもの)。
//   ・引いた量に合わせて中身ごと下がり、空いた所に芽(LoadingRing の小さい版)が描かれていく。しきい値で芽が完成する。
//   ・しきい値を越えて離すと onRefresh。越えずに離す・touchcancel(中断)・2本目の指は元へ戻るだけ。
//   ・戻るときも消えるときも動きは付けない(位置の追従だけ)。動きを減らす設定では追従もしない(越えて離したら更新するだけ)。
//   ・更新中(busy)は印を出したまま。その間は新しく引いても掴まない(二重に走らせない)。
//   ・掴まない: シート・写真の拡大(aria-modal)・はじめの一手のカード(.coach-layer)が出ている間 / 入力欄にフォーカスがある間 /
//     触れた点からこの包みまでのどこかがスクロールしている間(iPad の2ペインは触れたペインだけを見る)/ 文書がスクロールしている間。
//
// 【静止時は包みの div 1つだけ】style も印も描かない(transform を残さない。§6.3「静止時に transform を残さない」)。
// 包みは位置を持たない素の div なので、中身の大きさ・位置は包む前と同じ(margin も印の空の箱を素通りする)。
// ------------------------------------------------------------------

// 引っ張って更新が効いている間、<html> に立てる印。index.css がこれを見てページの overscroll-behavior-y を止める
// (iPhone の Safari の「ページごと再読み込み」と二重にしない)。立てるのは CommunityTab の間だけ。
export const PULL_REFRESH_ATTR = "data-pull-refresh";

// しきい値 = 印がまるごと出る距離 = 印(--tap-min)+ 上下の --sp-2 × 2(= 44 + 16 = 60px)。
// トークンが読めなければ(検査の jsdom など)§6.3 の「測れなければ 60px」。
export function pullThreshold(tapMin, gap) {
  const s = parseFloat(tapMin), g = parseFloat(gap);
  return s > 0 && g > 0 ? s + 2 * g : SWIPE_BACK_THRESHOLD_MIN;
}
function readPullThreshold() {
  if (typeof window === "undefined" || !window.getComputedStyle) return SWIPE_BACK_THRESHOLD_MIN;
  const cs = window.getComputedStyle(document.documentElement);
  return pullThreshold(cs.getPropertyValue("--tap-min"), cs.getPropertyValue("--sp-2"));
}

// 引いた量 → 中身を下げる量。下向きだけ・しきい値で止める(越えて引いても、それ以上は下がらない)。
export function pullOffset(dy, threshold) {
  return Math.max(0, Math.min(threshold, Number(dy) || 0));
}

// 離したときに更新するか。縦と決まった引きを、中断ではなく指を離して、しきい値以上で終えたときだけ。
export function pullShouldRefresh(vertical, interrupted, dy, threshold) {
  return vertical === true && interrupted !== true && dy >= threshold;
}

// 触れた点が「一番上」か。文書がスクロールしていたら違う。触れた点からこの包み(root)までの祖先のどれかが
// スクロールしていたら違う(iPad の2ペインの左右・シート以外の内側のスクロール)。
export function pullAtTop(target, root, scrollY) {
  if ((Number(scrollY) || 0) > 0) return false;
  let node = target;
  while (node && node.nodeType === 1) {
    if (node.scrollTop > 0) return false;
    if (node === root) break;
    node = node.parentElement;
  }
  return true;
}

// 掴んではいけない間か。シート・写真の拡大(どちらも role="dialog" aria-modal="true")・はじめの一手のカード・
// 入力欄のフォーカス。
export function pullBlocked(doc) {
  if (!doc) return false;
  if (doc.querySelector('[aria-modal="true"], .coach-layer')) return true;
  const a = doc.activeElement;
  return Boolean(a && a !== doc.body && a.matches?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

// 指の状態機械。DOM に触る操作はすべて io で受ける(検査が作り物の指を流し込めるように)。
//   io.atTop(target) / io.blocked() / io.busy() / io.threshold() / io.still() … 掴むかの判断と、その指のあいだ使う値
//   io.show(px) … 中身を下げる量(0 = 戻す)。io.refresh() … 更新を始める
// 終わり方は3つ: end("touchend")(更新の判定あり)/ end("touchcancel")(中断。戻すだけ)/ 別の start による中断。
// **中断の終端は対象判定より前**(§6.3。2本目の指で前の引きが戻らないまま固着しない)。
// move は「この指のスクロールを止めるか」(preventDefault するか)を返す。縦の下向きと決まってからだけ true。
export function createPullGesture(io) {
  let st = null;
  const drop = () => {
    const s = st;
    st = null;
    if (s && s.vertical) io.show(0);
  };
  const start = (e) => {
    drop();
    if (io.busy() || e.touches.length !== 1 || io.blocked() || !io.atTop(e.target)) return;
    const t = e.touches[0];
    st = { x: t.clientX, y: t.clientY, dy: 0, vertical: null, th: io.threshold(), still: io.still() };
  };
  const move = (e) => {
    if (!st) return false;
    if (e.touches.length !== 1) { drop(); return false; }
    const t = e.touches[0];
    const dx = t.clientX - st.x, dy = t.clientY - st.y;
    if (st.vertical === null) {
      const h = swipeAxisIsHorizontal(dx, dy);
      if (h === null) return false;                       // 未確定のうちは何もしない(preventDefault もしない)
      if (h === true || dy <= 0) { st = null; return false; }  // 横 = 子タブの横スワイプ / 上向き = スクロール
      st.vertical = true;
    }
    st.dy = dy;
    if (!st.still) io.show(pullOffset(dy, st.th));
    return true;
  };
  const end = (type) => {
    const s = st;
    drop();
    if (s && pullShouldRefresh(s.vertical, type === "touchcancel", s.dy, s.th)) io.refresh();
  };
  return { start, move, end };
}

// enabled = 引っ張って更新を出す画面か(呼び手が決める)。busy = 呼び手の更新が走っている間。
export default function PullToRefresh({ enabled = true, busy = false, onRefresh, children }) {
  const wrapRef = useRef(null);
  const [pull, setPull] = useState(0);
  const thRef = useRef(SWIPE_BACK_THRESHOLD_MIN);
  const live = useRef({ enabled, busy, onRefresh });
  useEffect(() => { live.current = { enabled, busy, onRefresh }; });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const g = createPullGesture({
      atTop: (target) => pullAtTop(target, el, window.scrollY || 0),
      blocked: () => !live.current.enabled || pullBlocked(document),
      busy: () => live.current.busy,
      threshold: () => { thRef.current = readPullThreshold(); return thRef.current; },
      still: () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
      show: (px) => setPull(px),
      refresh: () => live.current.onRefresh?.(),
    });
    const onStart = (e) => g.start(e);
    // 非パッシブ。縦の下向きと決まった指だけ、ブラウザのスクロール(と端の跳ね返り)を止める。
    const onMove = (e) => { if (g.move(e) && e.cancelable) e.preventDefault(); };
    const onEnd = () => g.end("touchend");
    const onCancel = () => g.end("touchcancel");
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, []);

  // 更新中は、しきい値の位置で印(完成した芽)を出したまま。引いている間は引いた量に合わせて描かれていく。
  const shift = busy ? thRef.current : pull;
  const p = busy ? 1 : pull / thRef.current;
  return (
    <div ref={wrapRef} data-pull-state={busy ? "busy" : pull > 0 ? "pull" : undefined}
      style={shift > 0 ? { transform: `translateY(${shift}px)` } : undefined}>
      {shift > 0 ? (
        // 高さ 0 の箱。印は中身の上端から --sp-2 だけ上に、下端を合わせて置く(中身の上の、空いた所)。
        <div aria-hidden="true" style={{ position: "relative", height: 0 }}>
          <div data-pull-mark="" style={{ position: "absolute", left: 0, right: 0, bottom: "var(--sp-2)", display: "flex", justifyContent: "center" }}>
            <LoadingRing p={p} size="var(--tap-min)" />
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}
