import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ------------------------------------------------------------------
// 【便BP 2026-10-03 本人裁定】はじめの一手(最初に開いたときの案内)。
// 正典 = scratchpad の ficus-tutorial.html(版4)。ただし「参加後の2段目」は凍結仕様で差し替え
// (人物のページの「目安に設定」ではなく、データのページの「みんなの平均」カード)。
//
// 決まり(変えない):
//   ・説明ではなく、最初の一手へ導く。各一手が起きるまで残る(ほかのタブを触っても消えない)
//   ・画面をうっすら暗くし(--c-coach-dim = --c-ink の 46%)、押してほしい所(的)だけを明るく残す。
//     明るい所の縁に枠線は付けない
//   ・カードは白・角丸 18・浮きの影。中身は丸いアイコン・見出し・1行。文は押し方を書かない
//   ・動きは、一手が済んだときに暗幕とカードが 0.35 秒で溶けて消えるだけ(時間は index.css の .coach-layer が持つ)。
//     prefers-reduced-motion では溶けもしない(即座に消す)
//   ・「閉じる」は置かない。暗幕と的はタップを下へ通す(pointer-events: none)。カードだけが押せる(押しても何も起きない)。
//     【便BP3 2026-10-03 統括の裁定(便BP2 の「カードも通す」を改めた)】カードは当たり判定を持つまま、
//     **押せる部品と重ならない所**に置く(placeCoachCard)。参加前の「アカウント引継」・データタブの取り込みを空ける
//
// **判断はこのファイルの純関数が持つ**(どの一手を出すか・印の立て方・移行・穴とカードの位置)。
// App.jsx は「いまの状態」を渡し、成功の道で markOnboardingDone を呼ぶだけ。
// ------------------------------------------------------------------

// 済んだ印の保存の鍵(usePersistedState = IndexedDB の kv)。アカウント引継は kv を丸ごと書き出すので、
// この鍵もファイルに入る(backup/localStore.js の readAll)。
export const ONBOARDING_KEY = "onboardingDone";
// 印の名前。**一度 true になったら戻さない**(計測やリードを消しても戻らない)。
export const ONBOARDING_FLAGS = ["measure", "reeds", "reedsMeasure", "join", "openPerson", "adoptAverage"];
// usePersistedState の初期値(まだ一度も保存されていない)。
export const ONBOARDING_INITIAL = Object.freeze({});
// 出し得る一手が無いときに渡す空の並び(描くたびに新しい [] を作らない)。
export const NO_COACH = Object.freeze([]);

// 重なり順(DESIGN-SYSTEM §4.5a)。下部タブ(30)・浮かぶボタン(45)・一時的な告知(50)より上、
// シートの暗幕(60)より下。暗幕は下部タブも含めて全体を覆う(データタブの的が下部タブのため)。
export const COACH_Z = 55;
// カードと画面の左右の間隔・的とカードの間隔(版4の .coach の left/right 22 と、的の下に置くときの + 22)。
export const COACH_EDGE_PX = 22;

// 7つの一手。文は凍結仕様の表のまま(一字一句)。pad / shape は版4の .spot の値。
//   pad   … 的の矩形から穴を広げる幅(px)
//   shape … circle = 的の中心に、長い辺 + pad×2 の円 / pill = 角丸 999 / rect = 角丸 12(--r-2)
// target は的を探す CSS セレクタ。的の要素は各画面が data-coach で名乗る(無ければ出さない)。
// データタブの的は下部タブの「計測」ボタンの**絵柄**(ボタンそのものは横長 84×32 なので、絵柄 30×30 を円で囲む。
// 版4は 44 の丸 + pad 4 = 直径 52 だったので、30 の絵柄には pad 11 で同じ 52 にする)。
export const COACH_STEPS = {
  measure: {
    flag: "measure", icon: "mic",
    title: "最初の計測を記録しよう", line: "ボタンタップで計測スタート",
    target: '[data-coach="measure"]', pad: 14, shape: "circle",
  },
  reeds: {
    flag: "reeds", icon: "reeds",
    title: "使っているリードを登録しよう", line: "計測が自動でリードに紐づきます",
    target: '[data-coach="reeds"]', pad: 10, shape: "circle",
  },
  // 【便BP2 2026-10-03 統括の裁定】2つの画面をまたいで同じ一手を案内する。一覧では先頭の箱の先頭のタイル(角丸 12 の四角)、
  // タイルを押して個体詳細に入ったら詳細の計測ボタン(丸。data-coach-shape="circle" で形を名乗る)。済む条件は同じ。
  reedsMeasure: {
    flag: "reedsMeasure", icon: "measure",
    title: "このリードで計測してみよう", line: "リードごとの違いが見えてきます",
    target: '[data-coach="reedsMeasure"]', pad: 4, shape: "rect",
  },
  data: {
    flag: "measure", icon: "data",
    title: "計測を始めると、ここに貯まります", line: "計測タブから計測してみよう",
    target: '[data-coach="nav-measure"] svg', pad: 11, shape: "circle",
  },
  join: {
    flag: "join", icon: "community",
    title: "コミュニティに参加しよう", line: "みんなの計測データが見られます",
    target: '[data-coach="join"]', pad: 0, shape: "pill",
  },
  openPerson: {
    flag: "openPerson", icon: "person",
    title: "気になる奏者を開いてみよう", line: "計測データとプロフィールが見られます",
    target: '[data-coach="openPerson"]', pad: 2, shape: "rect",
  },
  adoptAverage: {
    flag: "adoptAverage", icon: "target",
    title: "みんなの平均を目安にしてみよう", line: "目安に設定すると自分の音と比べられます",
    target: '[data-coach="adoptAverage"]', pad: 0, shape: "rect",
  },
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// 保存された値を読む形にそろえる(true 以外は「まだ」)。migrated は移行を済ませたかの印。
export function normalizeOnboardingDone(raw) {
  const src = isObj(raw) ? raw : {};
  const out = {};
  for (const k of ONBOARDING_FLAGS) out[k] = src[k] === true;
  out.migrated = src.migrated === true;
  return out;
}

// 成功の道で印を立てる。**立てるだけ**(false へ戻す道は無い)。既に立っていれば同じ物を返す(書き込みを起こさない)。
export function markOnboardingDone(prev, flag) {
  if (!ONBOARDING_FLAGS.includes(flag)) return prev;
  if (isObj(prev) && prev[flag] === true) return prev;
  return { ...(isObj(prev) ? prev : {}), [flag]: true };
}

// 計測が1件保存されたときに立てる印(録音の保存・取り込みの保存の両方が呼ぶ)。
// リードを紐づけた計測なら「このリードで計測」(reedsMeasure)も済む。
export function onboardingFlagsForSavedSession(session) {
  return session?.reedId ? ["measure", "reedsMeasure"] : ["measure"];
}

// みんなの平均を取り込んだ目安か(名前が「みんなの平均」で始まる。screens.jsx の cohortAdoptName が付ける)。
export const COHORT_AVERAGE_NAME_PREFIX = "みんなの平均";
export function isCohortAverageProfile(p) {
  return typeof p?.name === "string" && p.name.startsWith(COHORT_AVERAGE_NAME_PREFIX);
}

// 既にある人の移行(更新後の最初の起動で1回だけ)。**読み込みが済んでから**呼ぶこと(呼び手の門)。
//   計測があれば measure / リードがあれば reeds / リードの紐づいた計測があれば reedsMeasure /
//   取り込んだ目安(コミュニティから)があれば openPerson、そのうちみんなの平均の目安があれば adoptAverage。
// 参加(join)はここでは決めない ── 参加しているかはコミュニティタブが Firebase に訊いて初めて分かる。
// コミュニティタブが「参加済み」と分かった時点(プロフィールの画面に入った時点)で印を立てる。
// 立てるだけで、既に立っている印を倒さない。migrated が立っていれば何もしない(同じ物を返す)。
export function migrateOnboardingDone(prev, { sessions = [], reeds = [], idealProfiles = [], isAdopted = () => false } = {}) {
  if (isObj(prev) && prev.migrated === true) return prev;
  const next = { ...(isObj(prev) ? prev : {}) };
  const ss = Array.isArray(sessions) ? sessions : [];
  if (ss.length > 0) next.measure = true;
  if (Array.isArray(reeds) && reeds.length > 0) next.reeds = true;
  if (ss.some((s) => Boolean(s?.reedId))) next.reedsMeasure = true;
  const adopted = (Array.isArray(idealProfiles) ? idealProfiles : []).filter((p) => isAdopted(p));
  if (adopted.length > 0) next.openPerson = true;
  // 【便BP3 2026-10-03 統括の裁定】adoptAverage は**みんなの平均の目安**があるときだけ(人物の目安だけなら openPerson だけ)。
  // みんなの平均の取り込みは名前を「みんなの平均」で始める(screens.jsx の cohortAdoptName)ので、それで見分ける。
  if (adopted.some(isCohortAverageProfile)) next.adoptAverage = true;
  next.migrated = true;
  return next;
}

// いまのタブで出し得る一手(順番どおり。的が画面に在る最初の1つを出す)。
//   計測   … マイクの許可が済んでいる(micReady)ときだけ
//   リード … 登録 → 登録が済んだら「このリードで計測」
//   データ … 計測タブへ(計測が済むまで。計測タブと共通の印)
//   コミュニティ … 参加 → 参加したら奏者を開く → 開いたらみんなの平均を目安に
export function coachCandidates({ topTab, done, micReady = false }) {
  const d = done ?? {};
  switch (topTab) {
    case "measure": return !d.measure && micReady ? ["measure"] : [];
    case "reeds": return !d.reeds ? ["reeds"] : !d.reedsMeasure ? ["reedsMeasure"] : [];
    case "analysis": return !d.measure ? ["data"] : [];
    case "community": return !d.join ? ["join"] : !d.openPerson ? ["openPerson"] : !d.adoptAverage ? ["adoptAverage"] : [];
    default: return [];
  }
}

// 的が画面の中に**まるごと**見えているか。大きさ 0(描かれていない)・画面の外(スクロール・ページャの隣のページ)は出さない。
export function targetVisible(r, vw, vh) {
  if (!r || !(r.width > 0) || !(r.height > 0)) return false;
  return r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh;
}

// 明るく残す穴(画面の座標)。的の getBoundingClientRect から作る。
export function holeOf(r, step) {
  const pad = step.pad;
  if (step.shape === "circle") {
    const d = Math.max(r.width, r.height) + pad * 2;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return { left: cx - d / 2, top: cy - d / 2, width: d, height: d, shape: "circle" };
  }
  return { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2, shape: step.shape };
}

// カードの縦の位置。カードは当たり判定を持つ(版4どおり。押しても何も起きない)ので、**押せる部品(avoid)と重ならない所**に置く。
// 【便BP5 2026-10-03 統括の裁定(再審査の差し戻し)】候補を4つに限らない。画面の上端から下端まで COACH_SCAN_STEP_PX 刻みに
// 置ける位置を全部試し(的から gap ちょうどの上下2つと、いまの位置も加える)、次の順で選ぶ:
//   (a) 重なりの重みが一番少ない位置
//   (b) 同じなら、的に一番近い位置(カードと穴の間の縦の距離)
//   (c) それも同じなら、いまの位置(prevTop)を保つ
// 的(穴)の上下 gap の内側には置かない(置ける位置が1つも無いときだけ、重なりを報告して最も重みの少ない位置)。
// 画面の上下にも gap を残す。左右は CSS(.coach-card の left/right 22px)。
//
// 重み: 部品1つにつき 1。ただし次の部品は COACH_FIXED_WEIGHT(10):
//   ・画面に貼り付いた部品(fixed: 浮かせるボタン・下部タブ・広告の見本の帯)
//   ・**その位置ではスクロールしてもカードの下から出せない部品**(stuckAt)。判定(canScrollOut):
//     ページのスクロールで動かせる幅 d ∈ [scroll.min, scroll.max](= [-scrollY, 最大 - scrollY])の中に、
//     部品が「カードと重ならず、かつ見える範囲(0 〜 下部タブの上端)にまるごと入る」d が1つも無ければ出せない。
//     例: ページの先頭(scrollY 0)の「My Data / 分析」は、カードを画面の上端に置くとそれより上に逃がせない。
//   scroll を渡さない呼び手(位置だけの検査)は、貼り付いていない部品を全部「出せる」(重み 1)として数える。
export const COACH_FIXED_WEIGHT = 10;
export const COACH_SCAN_STEP_PX = 8;
const hitPx = 0.5;
export function rectsOverlap(a, b) {
  return a.left < b.right - hitPx && a.right > b.left + hitPx && a.top < b.bottom - hitPx && a.bottom > b.top + hitPx;
}
// 部品 r(画面の座標)を、ページのスクロールでカード [ct, cb] の下から出せるか。見える範囲は [viewTop, viewBottom]。
export function canScrollOut(r, ct, cb, scroll, viewTop, viewBottom) {
  const h = r.bottom - r.top;
  if (h > viewBottom - viewTop) return false;
  const lo = scroll.min;
  const hi = scroll.max;
  // スクロール量 d(下へ = 正)で部品は [r.top - d, r.bottom - d] へ動く。
  // カードの上側に逃がす: r.bottom - d <= ct かつ r.top - d >= viewTop
  const a1 = Math.max(lo, r.bottom - ct);
  const a2 = Math.min(hi, r.top - viewTop);
  if (a1 <= a2 + hitPx) return true;
  // カードの下側に逃がす: r.top - d >= cb かつ r.bottom - d <= viewBottom
  const b1 = Math.max(lo, r.bottom - viewBottom);
  const b2 = Math.min(hi, r.top - cb);
  return b1 <= b2 + hitPx;
}
// 【便BP6 2026-10-03 統括の裁定(3回目の審査: スクロール中のがたつき)】
//   ・比べる順は (a) 重み → (b) いまの位置を保つ → (c) 部品の縁から作った位置を目盛りより先に → (d) 的に近い。
//     置き直すのは「いまの位置の重みがほかより重くなった」か「いまの位置が穴の上下 gap の内側に入った」ときだけ
//     (= いまの位置が一番軽い組に居る限り、(b) で保たれる)。
//   ・スクロール中に穴が近づいて置き直すとき(motion: 穴の動く向き。上へ = -1 / 下へ = +1)は、(b) のあとに
//     「穴がこのまま動いても、次に入るまでが一番長い位置」を先にする(穴が遠ざかる側は ∞)。近い所へ置くと、
//     1px 動くたびにまた入って、カードが穴に付いて 1px ずつ動いてしまう(審査で見つかった形)。
//   ・候補は部品の縁から作る: 部品の上端 − COACH_EDGE_SPACE_PX − カードの高さ / 部品の下端 + COACH_EDGE_SPACE_PX。
//     的の上下 gap ちょうどの2つも縁の候補。8px の目盛りは、縁の候補がどれも重いときの控え。
export const COACH_EDGE_SPACE_PX = 8;   // 部品とカードの間の余白(--sp-2 と同じ 8)
export function placeCoachCard({
  hole, cardH, vw = 375, vh, bottomLimit = vh, gap = COACH_EDGE_PX, avoid = [], prevTop = null, scroll = null, step = COACH_SCAN_STEP_PX, motion = 0,
}) {
  const holeRect = { left: hole.left, top: hole.top, right: hole.left + hole.width, bottom: hole.top + hole.height };
  const keepOut = { left: -Infinity, right: Infinity, top: holeRect.top - gap + hitPx * 2, bottom: holeRect.bottom + gap - hitPx * 2 };
  const minTop = gap;
  const maxTop = Math.max(minTop, vh - gap - cardH);
  const inRange = (t) => typeof t === "number" && Number.isFinite(t) && t >= minTop - 1e-6 && t <= maxTop + 1e-6;
  const kind = new Map();   // top → 0(縁・的の上下・いまの位置)/ 1(目盛り)
  const add = (t, k) => { if (!inRange(t)) return; const key = r2(t); if (!kind.has(key) || kind.get(key) > k) kind.set(key, k); };
  add(holeRect.top - gap - cardH, 0);
  add(holeRect.bottom + gap, 0);
  for (const r of avoid) { add(r.top - COACH_EDGE_SPACE_PX - cardH, 0); add(r.bottom + COACH_EDGE_SPACE_PX, 0); }
  add(prevTop, 0);
  for (let t = minTop; t <= maxTop + 1e-6; t += step) add(t, 1);
  add(maxTop, 1);
  const viewBottom = Math.min(bottomLimit, vh);
  const tried = [...kind.entries()].map(([top, k]) => {
    const card = { left: gap, right: vw - gap, top, bottom: top + cardH };
    const hits = avoid.filter((r) => rectsOverlap(card, r));
    const onHole = rectsOverlap(card, keepOut);
    const weight = hits.reduce((n, h) => {
      const stuck = h.fixed || (scroll ? !canScrollOut(h, card.top, card.bottom, scroll, 0, viewBottom) : false);
      return n + (stuck ? COACH_FIXED_WEIGHT : 1);
    }, 0);
    const dist = card.bottom <= holeRect.top ? holeRect.top - card.bottom : Math.max(0, card.top - holeRect.bottom);
    const keep = typeof prevTop === "number" && Math.abs(top - prevTop) < 0.5;
    // 穴がこのまま動いたとき、次に上下 gap の内側へ入るまでの余裕(穴が遠ざかる側・動いていないときは ∞)
    const above = card.bottom <= holeRect.top;
    const room = motion < 0 && above ? holeRect.top - gap - card.bottom
      : motion > 0 && !above ? card.top - holeRect.bottom - gap : Infinity;
    return { top, hits, onHole, weight, dist, keep, room, kind: k, score: (onHole ? 100000 : 0) + weight };
  });
  const better = (t, b) => {
    if (t.score !== b.score) return t.score < b.score;
    if (t.keep !== b.keep) return t.keep;
    if (t.room !== b.room) return t.room > b.room;
    if (t.kind !== b.kind) return t.kind < b.kind;
    return t.dist < b.dist - 0.01;
  };
  let best = tried[0];
  for (const t of tried) if (better(t, best)) best = t;
  const side = best.top + cardH <= holeRect.top ? "above" : "below";
  return { top: best.top, slot: side, side, hits: best.hits, weight: best.weight, dist: best.dist, kept: best.keep, overlaps: best.onHole || best.hits.length > 0, onHole: best.onHole };
}

// カード [top, top + cardH] が穴の上下 gap の内側に入っているか(スクロール中でも即座に置き直す条件)。
export function cardIntrudesHole(top, cardH, hole, gap = COACH_EDGE_PX) {
  return top < hole.top + hole.height + gap - hitPx * 2 && top + cardH > hole.top - gap + hitPx * 2;
}
// 部品が画面に貼り付いているか: 自分か祖先に position: fixed / sticky がある(浮かせるボタン・下部タブ・告知の帯の「元に戻す」など)。
export function isPinnedElement(el) {
  for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
    const p = getComputedStyle(n).position;
    if (p === "fixed" || p === "sticky") return true;
  }
  return false;
}

const r2 = (v) => Math.round(v * 100) / 100;
function sameView(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.leaving === b.leaving && a.measured === b.measured && a.slot === b.slot && r2(a.top) === r2(b.top)
    && r2(a.hole.left) === r2(b.hole.left) && r2(a.hole.top) === r2(b.hole.top)
    && r2(a.hole.width) === r2(b.hole.width) && r2(a.hole.height) === r2(b.hole.height);
}

// 溶ける時間(ms)を計算済みの style から読む。"0.35s" / "350ms"(animation-duration)、無ければ
// animation の一括指定("coach-out 350ms ease-out forwards")の最初の時間。読めなければ 0(= 溶かさずに消す)。
export function leaveDurationMs(cs) {
  const src = String(cs?.animationDuration || cs?.animation || "");
  const m = /(\d*\.?\d+)(ms|s)\b/.exec(src);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return m[2] === "ms" ? n : n * 1000;
}
const prefersReducedMotion = () => {
  try { return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches); } catch { return false; }
};

// アイコン(版4の SVG をそのまま)。計測=マイク / リード1=リード / リード2=計測(MeasureIcon と同じ針) /
// データ=データ / 参加前=コミュニティ / 参加後1=人 / 参加後2=的。
const SV = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" };
const ICONS = {
  mic: <svg {...SV}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><line x1="12" y1="17.5" x2="12" y2="21" /></svg>,
  reeds: <svg {...SV}><g transform="translate(0.7 -1.9) rotate(35 12 13)" strokeWidth="1.8"><path d="M9.5 22 L9.5 10 Q9.5 4.5 12 4.5 Q14.5 4.5 14.5 10 L14.5 22 Z" /><path d="M9.5 15 Q12 11.8 14.5 15" /></g></svg>,
  measure: <svg {...SV}><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg>,
  data: <svg {...SV}><path d="M16 16L16 8" /><path d="M12 16L12 11" /><path d="M8 16L8 13" /><path d="M3 20.4V3.6C3 3.3 3.3 3 3.6 3H20.4C20.7 3 21 3.3 21 3.6V20.4C21 20.7 20.7 21 20.4 21H3.6C3.3 21 3 20.7 3 20.4Z" /></svg>,
  community: <svg {...SV}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20 Q3.5 14.5 9 14.5 Q14.5 14.5 14.5 20" /><circle cx="17" cy="9" r="2.4" /><path d="M15.5 13.6 Q20.5 13.6 20.5 18" /></svg>,
  person: <svg {...SV}><circle cx="12" cy="8" r="3.4" /><path d="M5 20 Q5 14 12 14 Q19 14 19 20" /></svg>,
  target: <svg {...SV}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" /></svg>,
};

const HOLE_RADIUS = { circle: "50%", pill: "var(--r-full)", rect: "var(--r-2)" };

// 押せる部品(カードを重ねてはいけない物)。的そのもの・案内の中の物は除く。
// 【便BP5 2026-10-03 統括の裁定】押せない(disabled)部品も避ける ── 押せなくても、条件がそろえば押す物で、隠すべきではない。
// 【便BP4 2026-10-03 統括の裁定】画面の側が data-coach-avoid を付けた要素(読んでほしい文など)も、押せる部品と同じ重みで数える。
export const COACH_AVOID_SELECTOR = 'button, [role="button"], a[href], input, select, textarea, [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [data-coach-avoid]';
// 的が見つからない間に探し直す間隔(ms)。この間は rAF を回さない(便BP3 統括の裁定 5)。
export const COACH_POLL_MS = 250;
// 【便BP6】スクロールが止まったとみなすまでの間(最後の scroll イベントから)。その間はカードを置き直さない(画面に固定)。
export const COACH_SCROLL_SETTLE_MS = 150;
// 押せる部品の矩形を読み直す間隔(ms)。【便BP5】的が動いても(スクロール中も)読み直さない。一手・カードの高さ・画面の大きさが
// 変わったときだけ即座に読み直す。ページのスクロールで動いた分は、読んだときの scrollY との差で毎フレーム足し引きする
// (位置の計算だけ毎フレーム。部品の getBoundingClientRect は 200ms に1回まで)。内側のスクロール(横のページャ等)はこの間隔で追いつく。
export const COACH_AVOID_REFRESH_MS = 200;

function readAvoidRects(target, layer, vw, vh) {
  const out = [];
  const sy = window.scrollY || 0;
  for (const el of document.querySelectorAll(COACH_AVOID_SELECTOR)) {
    if (el === target || target.contains(el) || el.contains(target)) continue;
    if (layer && layer.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) continue;
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    // 画面に貼り付いた部品か(浮かせるボタンは自分が fixed、下部タブ・広告の見本の帯は親が fixed)。
    // 【便BP6】祖先まで見る(告知の帯の「元に戻す」「開く」は、帯の箱が fixed)。
    const fixed = Boolean(el.closest("[data-bottom-nav], [data-ad-preview-strip]")) || isPinnedElement(el);
    // 貼り付いていない部品は、読んだときのスクロール(sy)を足した「ページの座標」で持つ(毎フレーム画面の座標へ戻す)。
    out.push({ left: r.left, top: r.top + (fixed ? 0 : sy), right: r.right, bottom: r.bottom + (fixed ? 0 : sy), fixed,
      label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 24) });
  }
  return out;
}
// 下部タブと広告の見本の帯の上端(画面の下寄りの候補の基準)。無ければ画面の下端。
function readBottomLimit(vh) {
  let lim = vh;
  for (const sel of ["[data-bottom-nav]", "[data-ad-preview-strip]"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.top < lim) lim = r.top;
  }
  return lim;
}

// ------------------------------------------------------------------
// 暗幕・穴・カード。document.body へ出す(SwipePager の transform の中だと position: fixed が画面を基準にしない)。
//   candidates … いま出し得る一手(coachCandidates の結果)
//   done       … 済んだ印(normalizeOnboardingDone の結果)。出している一手の印が立ったら溶けて消える
//   hidden     … 出してはいけない(録音中・シートや z60 の暗幕が出ている・解析中・読み込み前)。立ったら溶かさずに即座に消す
//
// 【追従】【便BP3 2026-10-03 統括の裁定 5】
//   ・出すもの(候補)が無く、出しているものも無い … 何も走らせない(rAF も時計も無い)
//   ・候補はあるが的が見つからない間 … rAF を回さず、COACH_POLL_MS ごとに探し直す
//   ・出している間(溶けている間を含む) … rAF で毎フレーム的の矩形を1回読む(値が変わったときだけ描き直す)。
//     ResizeObserver は大きさの変化しか知らせず、スクロール・ページャの移動(transform)を拾えないため
//   ・候補が変わった描画(タブの切替)は useLayoutEffect で同じ描画のうちに測り直す(古い案内を1フレームも残さない)
//
// 【読み上げ】【便BP3 統括の裁定 6】空の role="status" を**常に1つ**置き、文だけを差し替える(ライブ領域を中身ごと
// 差し込まない)。文が変わるのは「別の一手を出したとき」と「その一手が済んだとき」だけ ── 同じ一手の間に隠れて
// また出ても(シートの開け閉め・タブの行き来)読み直さない。見た目のカードは同じ文を持つので aria-hidden。
// ------------------------------------------------------------------
export function OnboardingCoach({ candidates, done, hidden }) {
  const [view, setView] = useState(null);
  const [announcedId, setAnnouncedId] = useState(null);
  const viewRef = useRef(null);
  const layerRef = useRef(null);
  const cardRef = useRef(null);
  const candidatesRef = useRef(candidates);
  const doneRef = useRef(done);
  const hiddenRef = useRef(hidden);
  const placeRef = useRef({ key: "", at: 0, avoid: [], bottomLimit: 0 });
  // 【便BP6】最後に scroll イベントが来た時刻(ページ・内側のどちらのスクロールも。捕捉の段で聞く)。
  const lastScrollRef = useRef(-Infinity);
  // いま囲んでいる的の要素(替わったら置き場所を一から決め直す)。
  const targetElRef = useRef(null);
  candidatesRef.current = candidates;
  doneRef.current = done;
  hiddenRef.current = hidden;
  const candKey = (candidates ?? []).join(",");

  const commit = (v) => {
    viewRef.current = v;
    setView(v);
    if (v && !v.leaving) setAnnouncedId((a) => (a === v.id ? a : v.id));
  };
  // 出している一手の印が立ったら溶かす(reduced-motion は即座に消す)。立っていなければ何もしない。
  const leaveIfDone = () => {
    const cur = viewRef.current;
    if (!cur || cur.leaving) return Boolean(cur?.leaving);
    if (!doneRef.current?.[COACH_STEPS[cur.id].flag]) return false;
    if (prefersReducedMotion()) commit(null);
    else commit({ ...cur, leaving: true });
    return true;
  };
  // 1回測る。戻り値は「出している(溶けている)か」── 出していれば次は rAF、出していなければ時計で探し直す。
  const measure = () => {
    if (hiddenRef.current) { if (viewRef.current) commit(null); return false; }
    if (leaveIfDone()) return true;
    const cur = viewRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let found = null;
    for (const id of candidatesRef.current ?? []) {
      const step = COACH_STEPS[id];
      const el = step ? document.querySelector(step.target) : null;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (!targetVisible(r, vw, vh)) continue;
      // 的の要素が形を名乗っていれば、その形で囲む(リード2の詳細の計測ボタン = 丸)。
      found = { id, r, el, shape: el.getAttribute("data-coach-shape") };
      break;
    }
    if (!found) { if (cur) commit(null); return false; }
    const step0 = COACH_STEPS[found.id];
    const hole = holeOf(found.r, found.shape ? { ...step0, shape: found.shape } : step0);
    // 【便BP6】同じ一手でも、的の要素が替わったら(リード2: 一覧のタイル → 詳細の計測ボタン)いまの位置は保たない。
    const sameStep = cur && cur.id === found.id && targetElRef.current === found.el;
    targetElRef.current = found.el;
    const cardH = sameStep ? (cardRef.current?.getBoundingClientRect().height || 0) : 0;
    // 押せる部品の矩形は、一手・カードの高さ・画面の大きさが変わったときと COACH_AVOID_REFRESH_MS ごとにだけ読み直す
    // (【便BP5】的が動いただけでは読み直さない)。
    const key = `${found.id}|${r2(cardH)}|${vw}|${vh}`;
    const now = performance.now();
    const pr = placeRef.current;
    if (pr.key !== key || now - pr.at > COACH_AVOID_REFRESH_MS) {
      pr.avoid = readAvoidRects(found.el, layerRef.current, vw, vh);
      pr.bottomLimit = readBottomLimit(vh);
      pr.key = key;
      pr.at = now;
    }
    // 【便BP6】スクロールしている間は置き直さない。カードは画面に固定したまま、穴だけ追う。
    // ただし穴の上下 gap の内側に入ったら、今までどおり即座に置き直す(的が画面の外へ出たら、上で隠している)。
    if (sameStep && cur.measured && now - lastScrollRef.current < COACH_SCROLL_SETTLE_MS
        && !cardIntrudesHole(cur.top, cardH, hole)) {
      const held = { ...cur, hole, measured: true, leaving: false };
      if (!sameView(cur, held)) commit(held);
      return true;
    }
    // 毎フレーム: ページの座標の部品を、いまのスクロールで画面の座標へ戻す。スクロールで動かせる幅も渡す。
    const sy = window.scrollY || 0;
    const se = document.scrollingElement || document.documentElement;
    const maxScroll = Math.max(0, (se?.scrollHeight || 0) - vh);
    const avoid = pr.avoid.map((a) => (a.fixed ? a : { ...a, top: a.top - sy, bottom: a.bottom - sy }));
    // スクロール中に穴が入って置き直すときは、穴の動く向きを渡す(次に入るまでが一番長い位置を先にする)。
    const scrolling = now - lastScrollRef.current < COACH_SCROLL_SETTLE_MS;
    const motion = scrolling && sameStep ? Math.sign(r2(hole.top - cur.hole.top)) : 0;
    const place = placeCoachCard({
      hole, cardH, vw, vh, bottomLimit: pr.bottomLimit, avoid,
      prevTop: sameStep && cur.measured ? cur.top : null,
      scroll: { min: -sy, max: maxScroll - sy },
      motion,
    });
    const next = { id: found.id, hole, top: place.top, slot: place.slot, measured: cardH > 0, leaving: false };
    if (!sameView(cur, next)) commit(next);
    return true;
  };

  // 印が立った描画・hidden が変わった描画・候補が変わった描画(タブの切替)の直後(rAF より先)に判定して測る。
  // 先に rAF が走ると「出し得る一手が無い」で溶けずに消えたり、古い案内が1フレーム残ったりする。
  useLayoutEffect(() => {
    if (hidden) { if (viewRef.current) commit(null); return; }
    if (!leaveIfDone()) measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, hidden, candKey]);

  // 済んだ一手の文は読み上げから下ろす(次の一手が出れば、その文に差し替わる)。
  useEffect(() => {
    if (!announcedId || !done?.[COACH_STEPS[announcedId].flag]) return;
    if (view?.id === announcedId) return;   // 溶けている間はまだ下ろさない
    setAnnouncedId(null);
  }, [done, announcedId, view]);

  const active = (!hidden && (candidates?.length ?? 0) > 0) || view !== null;
  // 【便BP6】出している間だけ scroll を聞く(何も出していなければ何も足さない)。
  const shownForScroll = view !== null;
  useEffect(() => {
    if (!shownForScroll) return undefined;
    const onScroll = () => { lastScrollRef.current = performance.now(); };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [shownForScroll]);
  const shown = view !== null;
  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    let to = 0;
    let stopped = false;
    const step = () => {
      if (stopped) return;
      if (measure()) raf = requestAnimationFrame(step);
      else to = setTimeout(step, COACH_POLL_MS);
    };
    // 出している間は次のフレームから。出していなければ時計で探す(この描画では useLayoutEffect が測り済み)。
    if (shown) raf = requestAnimationFrame(step);
    else to = setTimeout(step, COACH_POLL_MS);
    return () => { stopped = true; cancelAnimationFrame(raf); clearTimeout(to); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, shown, candKey]);

  // 溶けている間。時間は CSS(.coach-layer[data-leaving])だけが持つので、そこから読んで後始末の時計にする
  // (animationend が来ない環境でも残らない)。読めなければ(0)すぐ消す。
  const leaving = Boolean(view?.leaving);
  useEffect(() => {
    if (!leaving) return undefined;
    const el = layerRef.current;
    const ms = el ? leaveDurationMs(getComputedStyle(el)) : 0;
    if (!(ms > 0)) { commit(null); return undefined; }
    const t = setTimeout(() => { if (viewRef.current?.leaving) commit(null); }, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const said = announcedId ? COACH_STEPS[announcedId] : null;
  const step = view ? COACH_STEPS[view.id] : null;
  return createPortal(
    <>
      {/* 読み上げの入れ物は常に1つ(空のときも在る)。文だけを差し替える。 */}
      <div className="coach-live" role="status" data-coach-live="">{said ? `${said.title}。${said.line}` : ""}</div>
      {view ? (
        <div
          ref={layerRef}
          className="coach-layer"
          data-coach-layer={view.id}
          data-leaving={view.leaving ? "true" : "false"}
          style={{ zIndex: COACH_Z }}
          onAnimationEnd={(e) => { if (e.target === e.currentTarget && viewRef.current?.leaving) commit(null); }}
        >
          <div
            className="coach-hole"
            aria-hidden="true"
            style={{
              left: view.hole.left, top: view.hole.top, width: view.hole.width, height: view.hole.height,
              borderRadius: HOLE_RADIUS[view.hole.shape],
            }}
          />
          {/* カードは当たり判定を持つ(押しても何も起きない。版4どおり)。押せる部品と重ならない所に置く(placeCoachCard)。
              測る前(高さが分からない間)は見せない ── 置き場所が決まっていない姿を1フレームも出さない。 */}
          <div
            ref={cardRef}
            className="coach-card sans"
            aria-hidden="true"
            data-coach-slot={view.slot}
            style={{ top: view.top, visibility: view.measured ? "visible" : "hidden" }}
          >
            <span className="coach-icon">{ICONS[step.icon]}</span>
            <div className="coach-title">{step.title}</div>
            <div className="coach-line">{step.line}</div>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
