import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ------------------------------------------------------------------
// 【便BP 2026-10-03 本人裁定】はじめの一手(最初に開いたときの案内)。
// 正典 = scratchpad の ficus-tutorial.html(版4)。ただし「参加後の2段目」は凍結仕様で差し替え
// (人物のページの「目安に設定」ではなく、データのページの「みんなの平均」カード)。
//
// 決まり:
//   ・説明ではなく、最初の一手へ導く。各一手が起きるまで、起動のたびに出る
//   ・画面をうっすら暗くし(--c-coach-dim = --c-ink の 46%)、押してほしい所(的)だけを明るく残す。
//     明るい所の縁に枠線は付けない
//   ・カードは白・角丸 18・浮きの影。中身は丸いアイコン・見出し・1行(1行の無い一手もある)。文は押し方を書かない
//   ・動きは、一手が済んだときに暗幕とカードが 0.35 秒で溶けて消えるだけ(時間は index.css の .coach-layer が持つ)。
//     prefers-reduced-motion では溶けもしない(即座に消す)
//   ・【便BQ 2026-10-03 本人の実機指示】
//     「他のところタップで案内は消えるようにして」 … 的(穴)以外のどこを押しても(カードも暗幕も)案内は消える。
//       消えるのは**この起動の間だけ**で、印は立てない(一手はまだ済んでいない)。次の起動で、まだ済んでいなければまた出る。
//       同じ起動の中では、一度消した一手はタブを行き来しても出さない。外を押したその1回は**消すだけ**(暗幕が受け、下の部品には届かない)。
//       的(穴)を押したときは今までどおり下へ通して一手を起こす(穴の上には何も置かない)
//     「案内のポップアップは全て画面中央に出すようにして」 … カードは見える範囲(下部タブ・広告の帯を除く)の縦横の中央。
//       的に重なる場面だけ、的を避けて上か下にずらす(placeCoachCard)。便BP4〜6 の置き場所の決め方(重みの走査・
//       スクロールで出せるかの判定・部品の縁の候補・スクロール中は置き直さない・data-coach-avoid)は片付けた
//     「気になる奏者を開いてみようのパートは削除」 … 参加後1(openPerson)を外した。参加したら、すぐ参加後2
//   ・【便BS 2026-10-03 本人裁定】正典 = scratchpad の ficus-tutorial2.html。
//     参加前(join)の段は外した ── 参加の画面そのものが暗幕とカード1枚になった(CommunityTab.jsx の JoinIntro)。
//       印 join は「参加した」の印として残す(参加後の段 adoptAverage を出す門)
//     計測タブは3段: チューナー(tuner。的なし)→ メトロノーム(metronome。右上のアイコン)→ 計測(measure)。
//       外を押して消したら、計測タブの3段とも、この起動の間は出さない(dismissWith)
//     データタブ: 計測がすでにあるときの段(dataSeen。的なし)。押したら(外でもカードでも)印を立てて二度と出さない(markOnDismiss)。
//       計測が無いときの段(data)は今までどおり。どちらを出すかは計測の有無で決まる(同時には出ない)
//     的なし(target: null)の段は、穴を開けずに暗幕だけを敷き、カードを中央に置く。anchor があれば、その要素が在るときだけ出す
//
// **判断はこのファイルの純関数が持つ**(どの一手を出すか・印の立て方・移行・穴とカードの位置)。
// App.jsx は「いまの状態」を渡し、成功の道で markOnboardingDone を呼ぶだけ。
// ------------------------------------------------------------------

// 済んだ印の保存の鍵(usePersistedState = IndexedDB の kv)。アカウント引継は kv を丸ごと書き出すので、
// この鍵もファイルに入る(backup/localStore.js の readAll)。
export const ONBOARDING_KEY = "onboardingDone";
// 印の名前。**一度 true になったら戻さない**(計測やリードを消しても戻らない)。
// 【便BQ】openPerson(参加後1)は外した。前の版で保存された openPerson は読み捨てる(残っていても害は無い)。
// 【便BS】tuner / metronome(計測タブの1段目・2段目)と dataSeen(データタブの計測があるときの段)を足した。
export const ONBOARDING_FLAGS = ["measure", "reeds", "reedsMeasure", "join", "adoptAverage", "tuner", "metronome", "dataSeen"];
// 【便BS】計測タブの3段の移行を済ませたかの印。便BP の移行(migrated)を済ませた人(配信済み)にも、
// 計測があれば tuner・metronome を済みにするために、別の印で1回だけ走らせる(migrateOnboardingDone)。
export const MEASURE_STEPS_MIGRATED = "migratedMeasureSteps";
// 【便BS】計測タブの3段(出す順)。外を押して消したら、この3つを全部この起動の間は出さない。
export const MEASURE_TAB_STEPS = Object.freeze(["tuner", "metronome", "measure"]);
// 【便BS】チューナーの段が済むまでの長さ。音程が**続けて**この長さ取れたら済み(本人裁定「音程が1秒ほど続けて取れた」)。
// 動きの時間ではなく「待つ長さ」(DESIGN-SYSTEM §1.11 の段の外)。
export const TUNER_SUSTAIN_MS = 1000;
// usePersistedState の初期値(まだ一度も保存されていない)。
export const ONBOARDING_INITIAL = Object.freeze({});
// 出し得る一手が無いときに渡す空の並び(描くたびに新しい [] を作らない)。
export const NO_COACH = Object.freeze([]);

// 重なり順(DESIGN-SYSTEM §4.5a)。下部タブ(30)・浮かぶボタン(45)・一時的な告知(50)より上、
// シートの暗幕(60)より下。暗幕は下部タブも含めて全体を覆う(データタブの的が下部タブのため)。
export const COACH_Z = 55;
// カードと画面の左右の間隔・的とカードの間隔(版4の .coach の left/right 22 と、的の下に置くときの + 22)。
export const COACH_EDGE_PX = 22;

// 一手の表(【便BS】参加前を外し、チューナー・メトロノーム・データ(計測あり)を足して8つ)。文は凍結仕様の表のまま(一字一句。【便BQ】リード1・リード2は本人の指示で替えた)。pad / shape は版4の .spot の値。
//   pad   … 的の矩形から穴を広げる幅(px)
//   shape … circle = 的の中心に、長い辺 + pad×2 の円 / pill = 角丸 999 / rect = 角丸 12(--r-2)
//   line  … 1行。null なら出さない(見出しだけ)
// target は的を探す CSS セレクタ。的の要素は各画面が data-coach で名乗る(無ければ出さない)。
// データタブの的は下部タブの「計測」ボタンの**絵柄**(ボタンそのものは横長 84×32 なので、絵柄 30×30 を円で囲む。
// 版4は 44 の丸 + pad 4 = 直径 52 だったので、30 の絵柄には pad 11 で同じ 52 にする)。
// 【便BS】target: null の段は的なし(穴を開けない)。anchor … その段を出してよい画面に在る目印(在るかだけを見る。無ければ出さない)。
//   dismissWith … 外を押して消したときに、一緒にこの起動の間は出さない段(既定はその段だけ)
//   markOnDismiss … 外(暗幕・カード)を押したら、その段の印を立てる(押すことが一手そのものの段)
export const COACH_STEPS = {
  // 【便BS 2026-10-03 本人裁定】計測タブ1段目。吹けば済む(押す所が無い)ので的なし。版は ficus-tutorial2.html の 2-1。
  tuner: {
    flag: "tuner", icon: "tuner",
    title: "まずは吹いてみよう", line: "音程がリアルタイムで表示されます",
    target: null, anchor: null, dismissWith: MEASURE_TAB_STEPS,
  },
  // 【便BS】計測タブ2段目。的は右上のメトロノームのアイコンのボタン(44 角)。版の .spot の pad 0 で丸く囲む。
  metronome: {
    flag: "metronome", icon: "metro",
    title: "メトロノームも使えます", line: "テンポを決めて練習できます",
    target: '[data-coach="metronome"]', pad: 0, shape: "circle", dismissWith: MEASURE_TAB_STEPS,
  },
  measure: {
    flag: "measure", icon: "mic",
    title: "最初の計測を記録しよう", line: "ボタンタップで計測スタート",
    target: '[data-coach="measure"]', pad: 14, shape: "circle",
    // 【便BS】計測タブの3段目。外を押したら3段とも出さない
    dismissWith: MEASURE_TAB_STEPS,
  },
  reeds: {
    flag: "reeds", icon: "reeds",
    // 【便BQ 2026-10-03 本人指示】1行を「計測に登録したリードを紐づけることができます」に。
    title: "使っているリードを登録しよう", line: "計測に登録したリードを紐づけることができます",
    target: '[data-coach="reeds"]', pad: 10, shape: "circle",
  },
  // 【便BP2 2026-10-03 統括の裁定】2つの画面をまたいで同じ一手を案内する。一覧では先頭の箱の先頭のタイル(角丸 12 の四角)、
  // タイルを押して個体詳細に入ったら詳細の計測ボタン(丸。data-coach-shape="circle" で形を名乗る)。済む条件は同じ。
  reedsMeasure: {
    flag: "reedsMeasure", icon: "measure",
    // 【便BQ 2026-10-03 本人指示】1行は無し(見出しだけ)。
    title: "このリードで計測してみよう", line: null,
    target: '[data-coach="reedsMeasure"]', pad: 4, shape: "rect",
  },
  data: {
    flag: "measure", icon: "data",
    title: "計測を始めると、ここに貯まります", line: "計測タブから計測してみよう",
    target: '[data-coach="nav-measure"] svg', pad: 11, shape: "circle",
  },
  // 【便BS 2026-10-03 本人裁定】データタブ・計測がすでにあるとき。やることは無いので的なし。押したら(外でもカードでも)済み。
  // 出すのは My Data を表に出しているときだけ(目印 data-coach-anchor="mydata" は App.jsx の AnalysisLabView が置く)。
  dataSeen: {
    flag: "dataSeen", icon: "data",
    title: "計測したデータがここに貯まります", line: "練習の記録と音の傾向を振り返れます",
    target: null, anchor: '[data-coach-anchor="mydata"]', markOnDismiss: true,
  },
  // (【便BS】参加前(join)の段はここにあった。参加の画面そのものが暗幕とカード1枚になったので外した。CommunityTab.jsx の JoinIntro)
  adoptAverage: {
    flag: "adoptAverage", icon: "target",
    title: "みんなの平均を目安にしてみよう", line: "目安に設定すると自分の音と比べられます",
    target: '[data-coach="adoptAverage"]', pad: 0, shape: "rect",
  },
};
// 読み上げる文(見出しと1行。1行が無ければ見出しだけ)。
export function coachSpeech(step) {
  return step.line ? `${step.title}。${step.line}` : step.title;
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// 保存された値を読む形にそろえる(true 以外は「まだ」)。migrated は移行を済ませたかの印。
export function normalizeOnboardingDone(raw) {
  const src = isObj(raw) ? raw : {};
  const out = {};
  for (const k of ONBOARDING_FLAGS) out[k] = src[k] === true;
  out.migrated = src.migrated === true;
  out[MEASURE_STEPS_MIGRATED] = src[MEASURE_STEPS_MIGRATED] === true;
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
//   取り込んだ目安のうち、みんなの平均の目安があれば adoptAverage(【便BQ】openPerson は外した)。
// 参加(join)はここでは決めない ── 参加しているかはコミュニティタブが Firebase に訊いて初めて分かる。
// コミュニティタブが「参加済み」と分かった時点(プロフィールの画面に入った時点)で印を立てる。
// 立てるだけで、既に立っている印を倒さない。migrated が立っていれば何もしない(同じ物を返す)。
// 【便BS 2026-10-03 本人裁定】計測が1件でもあれば、計測タブの3段(tuner・metronome・measure)を済みにする
// (使い方を知っている人に出さない)。便BP の移行を済ませた人(migrated)にも、別の印(migratedMeasureSteps)で1回だけ当てる。
// dataSeen は移行で立てない(既存の人も、次にデータタブを開いたとき1回だけ出る)。
export function migrateOnboardingDone(prev, { sessions = [], reeds = [], idealProfiles = [], isAdopted = () => false } = {}) {
  const base = isObj(prev) ? prev : {};
  if (base.migrated === true && base[MEASURE_STEPS_MIGRATED] === true) return prev;
  const next = { ...base };
  const ss = Array.isArray(sessions) ? sessions : [];
  if (base.migrated !== true) {
    if (ss.length > 0) next.measure = true;
    if (Array.isArray(reeds) && reeds.length > 0) next.reeds = true;
    if (ss.some((s) => Boolean(s?.reedId))) next.reedsMeasure = true;
    // 【便BP3】adoptAverage は**みんなの平均の目安**があるときだけ。名前が「みんなの平均」で始まる取り込んだ目安で見分ける。
    if ((Array.isArray(idealProfiles) ? idealProfiles : []).some((p) => isAdopted(p) && isCohortAverageProfile(p))) next.adoptAverage = true;
    next.migrated = true;
  }
  // 【便BS】計測タブの3段。立てるだけ(既に立っている印は倒さない)。
  if (ss.length > 0) { for (const f of MEASURE_TAB_STEPS) next[f] = true; }
  next[MEASURE_STEPS_MIGRATED] = true;
  return next;
}

// いまのタブで出し得る一手(順番どおり。的が画面に在る最初の1つを出す)。
//   計測   … マイクの許可が済んでいる(micReady)ときだけ。【便BS】チューナー → メトロノーム → 計測の順に1つずつ
//   リード … 登録 → 登録が済んだら「このリードで計測」
//   データ … 【便BS】計測の有無で分ける(同時には出ない)。計測が無い: 計測タブへ(計測が済むまで。計測タブと共通の印。今までどおり) /
//            計測がある: 「ここに貯まります」(dataSeen が済むまで)。計測の有無が読めるまで(sessionsKnown)はどちらも出さない
//   コミュニティ … 参加したら(印 join)、すぐみんなの平均を目安に(【便BQ】奏者を開く段は外した。【便BS】参加前の段も外した)
// 【便BS 審査 2026-10-03 統括の裁定】
//   metroPanelOpen … メトロノームの面が開いている間は、計測の段(measure)を出さない(面の上に出て最初のテンポ操作を食べるため)。
//                    面を閉じたら出る。メトロノームの印は今までどおり面を開いたときに立てる
//   dataSeenDeferred … この起動の中で計測が 0件 → 1件以上 に変わったときは、dataSeen をこの起動では出さない(次の起動へ回す。
//                    初めて取り込んだ直後に「計測を始めると」と2枚続けて出ないように)
export function coachCandidates({ topTab, done, micReady = false, hasSessions = false, sessionsKnown = true, metroPanelOpen = false, dataSeenDeferred = false }) {
  const d = done ?? {};
  switch (topTab) {
    case "measure":
      if (!micReady) return [];
      for (const id of MEASURE_TAB_STEPS) {
        if (d[COACH_STEPS[id].flag]) continue;
        // 【便BS 審査】計測の段は、メトロノームの面が開いている間は出さない(閉じたら出る)
        return id === "measure" && metroPanelOpen ? [] : [id];
      }
      return [];
    case "reeds": return !d.reeds ? ["reeds"] : !d.reedsMeasure ? ["reedsMeasure"] : [];
    case "analysis":
      if (!sessionsKnown) return [];
      if (hasSessions) return !d.dataSeen && !dataSeenDeferred ? ["dataSeen"] : [];
      return !d.measure ? ["data"] : [];
    case "community": return d.join && !d.adoptAverage ? ["adoptAverage"] : [];
    default: return [];
  }
}

// 【便BS】チューナーの段が済む条件: on(マイクが動いていて・エラーが無く・環に音名が出ている)が ms のあいだ**途切れずに**続いた。
// 途切れたら数え直す。on が続いている間に ms が経ったら onReached を1回呼ぶ(呼び手が印を立てる)。
export function useSustained(on, ms, onReached) {
  const cbRef = useRef(onReached);
  cbRef.current = onReached;
  useEffect(() => {
    if (!on) return undefined;
    const t = setTimeout(() => cbRef.current?.(), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
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

// カードの縦の位置。【便BQ 2026-10-03 本人指示「案内のポップアップは全て画面中央に出すようにして」】
// 見える範囲(画面の上端 〜 下部タブ・広告の帯の上端 = bottomLimit)の縦の中央。横は CSS(.coach-card の left/right 22px)で中央。
// 中央のカードが的(穴)の上下 gap の内側にかかるときだけ、的を避けて上(穴の上端 − gap − カードの高さ)か
// 下(穴の下端 + gap)にずらす。見える範囲(上下に gap を残す)に収まるほうのうち、中央に近いほう。
// どちらも収まらなければ中央のまま(重なりを overlaps で返す)。
// 【便BS】穴の無い段(hole が null)は中央のまま。
export function placeCoachCard({ hole, cardH, vh, bottomLimit = vh, gap = COACH_EDGE_PX }) {
  const viewBottom = Math.min(bottomLimit, vh);
  const center = (viewBottom - cardH) / 2;
  if (!hole) return { top: center, side: "center", shifted: false, overlaps: false };
  const holeTop = hole.top;
  const holeBottom = hole.top + hole.height;
  const near = (t) => t < holeBottom + gap && t + cardH > holeTop - gap;
  if (!near(center)) return { top: center, side: "center", shifted: false, overlaps: false };
  const fits = (t) => t >= gap - 1e-6 && t + cardH <= viewBottom - gap + 1e-6;
  const options = [holeTop - gap - cardH, holeBottom + gap].filter(fits);
  if (options.length === 0) return { top: center, side: "center", shifted: false, overlaps: true };
  const top = options.reduce((a, b) => (Math.abs(b - center) < Math.abs(a - center) ? b : a));
  return { top, side: top < holeTop ? "above" : "below", shifted: true, overlaps: false };
}

const r2 = (v) => Math.round(v * 100) / 100;
function sameView(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const same = a.id === b.id && a.leaving === b.leaving && a.measured === b.measured && a.side === b.side && r2(a.top) === r2(b.top);
  // 【便BS】穴の無い段は穴を比べない(両方 null なら同じ)
  if (!a.hole || !b.hole) return same && a.hole === b.hole;
  return same
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
// データ=データ / 参加前=コミュニティ / 参加後=的。
// 【便BS】チューナー=tuner(針のある半円)・メトロノーム=metro(線の太さ 1.6)を ficus-tutorial2.html の SVG のまま足した。
// コミュニティ(community)は参加の画面のカード(CommunityTab.jsx の JoinIntro)が CoachIcon で読む。
const SV = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" };
const ICONS = {
  tuner: <svg {...SV}><path d="M3 17 A9 9 0 0 1 21 17" /><line x1="12" y1="8" x2="12" y2="10" /><line x1="12" y1="17" x2="14.2" y2="11.4" /><circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" /></svg>,
  metro: <svg {...SV} strokeWidth={1.6}><path d="M8 20h8l-2-14h-4z" /><path d="M12 14l5-8" /></svg>,
  mic: <svg {...SV}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><line x1="12" y1="17.5" x2="12" y2="21" /></svg>,
  reeds: <svg {...SV}><g transform="translate(0.7 -1.9) rotate(35 12 13)" strokeWidth="1.8"><path d="M9.5 22 L9.5 10 Q9.5 4.5 12 4.5 Q14.5 4.5 14.5 10 L14.5 22 Z" /><path d="M9.5 15 Q12 11.8 14.5 15" /></g></svg>,
  measure: <svg {...SV}><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg>,
  data: <svg {...SV}><path d="M16 16L16 8" /><path d="M12 16L12 11" /><path d="M8 16L8 13" /><path d="M3 20.4V3.6C3 3.3 3.3 3 3.6 3H20.4C20.7 3 21 3.3 21 3.6V20.4C21 20.7 20.7 21 20.4 21H3.6C3.3 21 3 20.7 3 20.4Z" /></svg>,
  community: <svg {...SV}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20 Q3.5 14.5 9 14.5 Q14.5 14.5 14.5 20" /><circle cx="17" cy="9" r="2.4" /><path d="M15.5 13.6 Q20.5 13.6 20.5 18" /></svg>,
  target: <svg {...SV}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" /></svg>,
};

// 【便BS】カードの丸いアイコン(.coach-icon の中身)。参加の画面のカード(JoinIntro)も同じ絵を読む(写しを作らない)。
export function CoachIcon({ name }) {
  return <span className="coach-icon">{ICONS[name]}</span>;
}

const HOLE_RADIUS = { circle: "50%", pill: "var(--r-full)", rect: "var(--r-2)" };

// 的が見つからない間に探し直す間隔(ms)。この間は rAF を回さない(便BP3 統括の裁定 5)。
export const COACH_POLL_MS = 250;

// 見える範囲の下端 = 下部タブの上端 − 広告の帯の高さ(--ad-h の計算値)。下部タブが無ければ画面の下端から。
// 【便BS】参加の画面のカード(JoinIntro)も同じ見える範囲の中央に置くので export する(CommunityTab.jsx はこれを読む。読み方はここ1か所)。
// 【殻 S3 2026-10-06 統括の裁定】以前は見本の帯の要素([data-ad-preview-strip])の上端を見ていたが、殻の本物の帯は
// ネイティブのビューで DOM に無い。帯の高さの唯一の答え --ad-h(帯 + すき間 --sp-2。index.css / 殻は src/shell/ads.js が inline で置く)
// から引く形にして、Web の見本と殻で同じ値にする(見本の帯の上端 = 下部タブの上端 − --ad-h)。
export function readBottomLimit(vh) {
  let lim = vh;
  const nav = document.querySelector("[data-bottom-nav]");
  if (nav) {
    const r = nav.getBoundingClientRect();
    if (r.height > 0 && r.top < lim) lim = r.top;
  }
  return lim - resolveAdHeight();
}

// --ad-h の確定値(px)。カスタムプロパティは getPropertyValue では未解決の文字列("calc(50px + 8px)")のまま返るので、
// その高さを持つ要素を一瞬置いて測る(App.jsx の resolveBottomGap と同じ作法)。測れなければ 0。
export function resolveAdHeight() {
  if (typeof document === "undefined" || !document.body) return 0;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;height:var(--ad-h)";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h > 0 ? h : 0;
}

// 穴の外側を覆う4枚の受け(上・下・左・右)。【便BQ】外を押したら案内を消す。穴の上には何も置かない(的は押せる)。
function hitRects(hole, vw, vh) {
  const top = hole.top;
  const bottom = hole.top + hole.height;
  const left = hole.left;
  const right = hole.left + hole.width;
  return [
    { key: "t", left: 0, top: 0, width: vw, height: Math.max(0, top) },
    { key: "b", left: 0, top: bottom, width: vw, height: Math.max(0, vh - bottom) },
    { key: "l", left: 0, top, width: Math.max(0, left), height: hole.height },
    { key: "r", left: right, top, width: Math.max(0, vw - right), height: hole.height },
  ];
}

// ------------------------------------------------------------------
// 暗幕・穴・カード。document.body へ出す(SwipePager の transform の中だと position: fixed が画面を基準にしない)。
//   candidates … いま出し得る一手(coachCandidates の結果)
//   done       … 済んだ印(normalizeOnboardingDone の結果)。出している一手の印が立ったら溶けて消える
//   hidden     … 出してはいけない(録音中・シートや z60 の暗幕が出ている・解析中・読み込み前)。立ったら溶かさずに即座に消す
//
// 【追従】出すもの(候補)が無く出しているものも無い間は何も走らせない / 候補はあるが的が見つからない間は rAF を回さず
// COACH_POLL_MS ごとに探す / 出している間は rAF で的の矩形を1回読む / 候補が変わった描画は useLayoutEffect で測り直す。
// 【読み上げ】空の role="status" を常に1つ置き、文だけを差し替える(同じ一手の間に読み直さない)。カードは aria-hidden。
// 【外を押したら消す】(便BQ)消した一手はこの部品が生きている間(= この起動の間)覚えておき、二度と出さない。印は立てない。
//   【便BS】dismissWith を持つ段は、その全部をこの起動の間は出さない(計測タブの3段)。
//   markOnDismiss の段(dataSeen)だけは、外を押したら onMark(印の名前)で印を立てる(押すことが一手そのもの)
// 【便BS】的なし(target: null)の段は、穴の代わりに暗幕(.coach-dim)を画面いっぱいに敷き、受けは1枚(画面いっぱい)。
// ------------------------------------------------------------------
export function OnboardingCoach({ candidates, done, hidden, onMark = null }) {
  const [view, setView] = useState(null);
  const [announcedId, setAnnouncedId] = useState(null);
  const viewRef = useRef(null);
  const layerRef = useRef(null);
  const cardRef = useRef(null);
  const candidatesRef = useRef(candidates);
  const doneRef = useRef(done);
  const hiddenRef = useRef(hidden);
  // 【便BQ】この起動の間に外を押して消した一手(タブを行き来しても出さない。次の起動では空から)。
  const dismissedRef = useRef(new Set());
  const onMarkRef = useRef(onMark);
  onMarkRef.current = onMark;
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
      if (dismissedRef.current.has(id)) continue;
      const step = COACH_STEPS[id];
      if (!step) continue;
      // 【便BS】的なしの段: 目印(anchor)があれば、それが在るときだけ出す。穴は作らない
      if (step.target === null) {
        if (step.anchor && !document.querySelector(step.anchor)) continue;
        found = { id, r: null, shape: null };
        break;
      }
      const el = document.querySelector(step.target);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (!targetVisible(r, vw, vh)) continue;
      // 【便BV3 2026-10-04】iPad の2ペインでは左右がそれぞれ自分でスクロールする(index.css の .pane-frame)。的がペインの中で
      // 送られて**ペインの縁に切られている**ときは、画面の中に居ても見えていないので出さない(穴が空いた所を照らさない)。
      // ペインの外(iPhone を含む今までの画面)には効かない。測るのは毎フレーム(下の rAF)なので、ペインを送ると穴も追う。
      const paneCell = el.closest(".pane-frame .pane-2 > *");
      if (paneCell) {
        const c = paneCell.getBoundingClientRect();
        // (大きさ 0 のペイン = まだ配置されていない・jsdom は測らない。そのときは今までどおり画面だけで決める)
        if (c.height > 0 && (r.top < c.top || r.bottom > c.bottom || r.left < c.left || r.right > c.right)) continue;
      }
      // 的の要素が形を名乗っていれば、その形で囲む(リード2の詳細の計測ボタン = 丸)。
      found = { id, r, shape: el.getAttribute("data-coach-shape") };
      break;
    }
    if (!found) { if (cur) commit(null); return false; }
    const step0 = COACH_STEPS[found.id];
    const hole = found.r ? holeOf(found.r, found.shape ? { ...step0, shape: found.shape } : step0) : null;
    const sameStep = cur && cur.id === found.id;
    const cardH = sameStep ? (cardRef.current?.getBoundingClientRect().height || 0) : 0;
    const place = placeCoachCard({ hole, cardH, vh, bottomLimit: readBottomLimit(vh) });
    const next = { id: found.id, hole, top: place.top, side: place.side, measured: cardH > 0, leaving: false, vw, vh };
    if (!sameView(cur, next) || cur.vw !== vw || cur.vh !== vh) commit(next);
    return true;
  };
  // 【便BQ】外(暗幕・カード)を押した: この1回は消すだけ(下の部品へ届かせない)。印は立てない。
  const dismiss = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = viewRef.current;
    if (!cur || cur.leaving) return;
    const step = COACH_STEPS[cur.id];
    // 【便BS】計測タブの3段は一緒に消す(次の段がすぐ出て連打にならないように)
    for (const id of step.dismissWith ?? [cur.id]) dismissedRef.current.add(id);
    dismissedRef.current.add(cur.id);
    setAnnouncedId(null);
    commit(null);
    // 【便BS】押すことが一手そのものの段(dataSeen)は、ここで印を立てる(二度と出さない)
    if (step.markOnDismiss) onMarkRef.current?.(step.flag);
  };

  // 印が立った描画・hidden が変わった描画・候補が変わった描画(タブの切替)の直後(rAF より先)に判定して測る。
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
    if (shown) raf = requestAnimationFrame(step);
    else to = setTimeout(step, COACH_POLL_MS);
    return () => { stopped = true; cancelAnimationFrame(raf); clearTimeout(to); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, shown, candKey]);

  // 溶けている間。時間は CSS(.coach-layer[data-leaving])だけが持つので、そこから読んで後始末の時計にする。
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
      <div className="coach-live" role="status" data-coach-live="">{said ? coachSpeech(said) : ""}</div>
      {view ? (
        <div
          ref={layerRef}
          className="coach-layer"
          data-coach-layer={view.id}
          data-leaving={view.leaving ? "true" : "false"}
          style={{ zIndex: COACH_Z }}
          onAnimationEnd={(e) => { if (e.target === e.currentTarget && viewRef.current?.leaving) commit(null); }}
        >
          {/* 【便BS】的なしの段は穴を開けず、暗幕だけを画面いっぱいに敷く(色は穴の影と同じ --c-coach-dim)。 */}
          {view.hole ? (
            <div
              className="coach-hole"
              aria-hidden="true"
              style={{
                left: view.hole.left, top: view.hole.top, width: view.hole.width, height: view.hole.height,
                borderRadius: HOLE_RADIUS[view.hole.shape],
              }}
            />
          ) : <div className="coach-dim" aria-hidden="true" />}
          {/* 【便BQ】穴の外側の受け(透明)。押したら案内を消すだけ(下へ届かせない)。穴の上には置かない。
              【便BS】穴の無い段は画面いっぱいの1枚(data-coach-hit="all")。 */}
          {(view.hole ? hitRects(view.hole, view.vw, view.vh) : [{ key: "all", left: 0, top: 0, width: view.vw, height: view.vh }]).map((h) => (
            <div key={h.key} className="coach-hit" aria-hidden="true" data-coach-hit={h.key}
              style={{ left: h.left, top: h.top, width: h.width, height: h.height }}
              onClick={dismiss} />
          ))}
          {/* カードは画面の中央。押しても案内が消えるだけ(外を押したのと同じ)。測る前は見せない。 */}
          <div
            ref={cardRef}
            className="coach-card sans"
            aria-hidden="true"
            data-coach-side={view.side}
            style={{ top: view.top, visibility: view.measured ? "visible" : "hidden" }}
            onClick={dismiss}
          >
            <CoachIcon name={step.icon} />
            <div className="coach-title">{step.title}</div>
            {step.line ? <div className="coach-line">{step.line}</div> : null}
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
