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
//     (便BS のときの計測タブの3段・データタブの dataSeen・的なしの段の作りは、【便BW】で下のとおり作り直した。印 join の扱いは今も同じ)
//   ・【便BW 2026-10-06 本人の要望・凍結仕様 coach2-spec.md】一本の流れに作り直した。
//     計測タブ: ① チューナー(的は環の箱。暗幕で隠していたのが本人の不満1。的なしの段は無くなった)→ ② メトロノーム →
//       (面の中・③④ が済むまで)③ テンポ行 → ④ 環を押してスタート → ⑤ 下部タブ「リード」→ リードタブ ⑥ 登録 → ⑦ このリードで計測 →
//       計測タブ ⑧ 左上のリードの枠 → ⑨ 計測(リードが選ばれていれば「このリードで計測してみよう」)→ ⑩ 下部タブ「データ」
//     データタブ: ⑫ 最新の計測の日のマス → ⑬ その日の先頭の記録 →(詳細)→ ⑭ 音の傾向カード(初回だけ的へスクロール)
//     ⑮ みんなの平均を目安にしたあと、帯の「見る」でデータタブの My Data へ移り、音の傾向カードを照らす
//       (【本人裁定 2026-10-06】計測タブではなくデータタブ。My Data の折れ線の既定は目安があれば my平均 × 目安)。
//       ⑭ と同じ的なので、⑮ を見た人には ⑭ を出さない(coachCandidates)
//     案内は自動でタブを移さない(⑤⑩ は下部タブを照らして待つ)。例外は帯の「見る」(本人が押した帯の操作)だけ。
//     押す=済(markOnDismiss)の段は ⑧⑭⑮ の3つ。この3つは外を押しても群(dismissWith)を消さない(次の段へ進ませるため)
//   ・【便BX 2026-10-06 本人の実機指示】⑥ リード登録の見出しを「楽器を選択してリードを登録しよう」にし、上部の楽器種別の行も
//     2つ目の穴(also)で明るく残す(押せる・外押しにならない)。⑧ の1行を「計測データに選択したリードが紐づきます」に
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
// 【便BW】新しい9つ(metroTempo 〜 idealSeen)を足した。dataSeen は段が無くなったが、前の版が保存した値を移行で読むので印の名前は残す。
export const ONBOARDING_FLAGS = ["measure", "reeds", "reedsMeasure", "join", "adoptAverage", "tuner", "metronome", "dataSeen",
  "metroTempo", "metroStart", "goReeds", "reedLinked", "goData", "calendarDay", "daySession", "trend", "idealSeen"];
// 【便BS】計測タブの3段の移行を済ませたかの印。便BP の移行(migrated)を済ませた人(配信済み)にも、
// 計測があれば tuner・metronome を済みにするために、別の印で1回だけ走らせる(migrateOnboardingDone)。
export const MEASURE_STEPS_MIGRATED = "migratedMeasureSteps";
// 【便BW】新しい段の移行を済ませたかの印(3つ目の門)。計測が1件でもある人には新しい段を1つも出さない。
export const COACH2_MIGRATED = "migratedCoach2";
// 【便BW】計測タブの段(出す順の id)。外を押して消したら、この全部をこの起動の間は出さない(押す=済の reedLinked を除く。COACH_STEPS)。
export const MEASURE_TAB_STEPS = Object.freeze(["tuner", "metronome", "metroTempo", "metroStart", "goReeds", "reedLinked", "measure", "measureReed", "goData"]);
// 【便BS】の移行(migratedMeasureSteps)が「計測があれば済み」にしていた3段。移行の結果を変えないため、この便で広げた群とは別に持つ。
export const MEASURE_TAB_STEPS_LEGACY = Object.freeze(["tuner", "metronome", "measure"]);
// 【便BW】データタブの段(計測があるとき)。外を押して消したら、この全部をこの起動の間は出さない。
export const DATA_TAB_STEPS = Object.freeze(["calendarDay", "daySession", "trend"]);
// 【便BW】計測が1件保存されたら、計測タブの章を閉じる(計測したことがある人に初めての人向けの案内を出さない)。
export const MEASURE_CHAPTER_FLAGS = Object.freeze(["measure", "tuner", "metronome", "metroTempo", "metroStart", "goReeds", "reedLinked"]);
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

// 一手の表(【便BS】参加前を外し、チューナー・メトロノーム・データ(計測あり)を足して8つ。【便BW】dataSeen を外し、10段を足して17)。文は凍結仕様の表のまま(一字一句。【便BQ】リード1・リード2は本人の指示で替えた)。pad / shape は版4の .spot の値。
//   pad   … 的の矩形から穴を広げる幅(px)
//   shape … circle = 的の中心に、長い辺 + pad×2 の円 / pill = 角丸 999 / rect = 角丸 12(--r-2)
//   line  … 1行。null なら出さない(見出しだけ)
// target は的を探す CSS セレクタ。的の要素は各画面が data-coach で名乗る(無ければ出さない)。
// データタブの的は下部タブの「計測」ボタンの**絵柄**(ボタンそのものは横長 84×32 なので、絵柄 30×30 を円で囲む。
// 版4は 44 の丸 + pad 4 = 直径 52 だったので、30 の絵柄には pad 11 で同じ 52 にする)。
// (【便BW】的なし(target: null)の段は無くなった。どの段も的を持つ)
//   dismissWith … 外を押して消したときに、一緒にこの起動の間は出さない段(既定はその段だけ)
//   markOnDismiss … 外(暗幕・カード)を押したら、その段の印を立てる(押すことが一手そのものの段)。群は持たない(次の段へ進ませる)
//   scrollIntoView … 的の要素が在るのに画面の外なら、この起動で1回だけ的を画面の中央へ送る(【便BW】音の傾向カード)
//   also … 【便BX】2つ目の穴({ target, pad, shape })。的(1つ目)が見えているときだけ探し、画面にまるごと見えていて
//          1つ目と縦に重ならなければ一緒に明るく残す(見えていなければ1つ目だけ)。カードの位置は1つ目で決める
export const COACH_STEPS = {
  // 【便BW 2026-10-06 本人の要望1】計測タブ1段目。的は環の箱(環と音名。吹いて動く所)。
  // 【便BW 審査 統括の裁定】最初はチューナーの帯(環 + 折れ線)全体だったが、カードが帯の中央に重なって環を覆った(広告あり・iPad 横)ので環に絞った。
  // 便BS では「押す所が無い」ので的なし(画面いっぱいの暗幕)にしていたが、吹いて変わる所まで暗くなっていた。
  tuner: {
    flag: "tuner", icon: "tuner",
    title: "まずは吹いてみよう", line: "音程がリアルタイムで表示されます",
    target: '[data-coach="tuner"]', pad: 0, shape: "rect", dismissWith: MEASURE_TAB_STEPS,
  },
  // 【便BS】計測タブ2段目。的は右上のメトロノームのアイコンのボタン(44 角)。版の .spot の pad 0 で丸く囲む。
  metronome: {
    flag: "metronome", icon: "metro",
    title: "メトロノームも使えます", line: "テンポを決めて練習できます",
    target: '[data-coach="metronome"]', pad: 0, shape: "circle", dismissWith: MEASURE_TAB_STEPS,
  },
  // 【便BW 本人の要望2】メトロノームの面の中の2段。③ テンポ行(− ♩=n ＋)。♩=n を押すと拍子・分割のシート(本人裁定 ア)。
  metroTempo: {
    flag: "metroTempo", icon: "metro",
    title: "テンポを決めよう", line: "♩=n を押すと拍子も変えられます",
    target: '[data-coach="metroTempo"]', pad: 6, shape: "pill", dismissWith: MEASURE_TAB_STEPS,
  },
  // ④ 帯のどこを押しても開始(A-1 の背面レイヤ)。的は①と同じ環の箱(環は当たり判定を持たないので、押すと背面レイヤに届いて鳴る)。
  metroStart: {
    flag: "metroStart", icon: "metro",
    title: "タップでスタート", line: "もう一度押すと止まります",
    target: '[data-coach="tuner"]', pad: 0, shape: "rect", dismissWith: MEASURE_TAB_STEPS,
  },
  // 【便BW 本人の要望3】⑤ 下部タブ「リード」の絵柄。自動では移さない(押してもらうのを待つ)。pad 11 はデータの段と同じ(30 + 22 = 52)。
  goReeds: {
    flag: "goReeds", icon: "reeds",
    title: "次はリードを登録しよう", line: null,
    target: '[data-coach="nav-reeds"] svg', pad: 11, shape: "circle", dismissWith: MEASURE_TAB_STEPS,
  },
  // 【便BW 本人の要望5】⑧ 左上のリードの枠(点 + メーカー + 厚さ + 開封日 + #n)。押す=済(外でもカードでも)。
  reedLinked: {
    flag: "reedLinked", icon: "reeds",
    // 【便BX 2026-10-06 本人の実機指示】1行を「計測データに選択したリードが紐づきます」に。
    title: "選んだリードが紐づいています", line: "計測データに選択したリードが紐づきます",
    target: '[data-coach="reedChip"]', pad: 6, shape: "pill", markOnDismiss: true,
  },
  // 【便BW 本人の要望6】⑨ リードが選ばれているときの計測の段。印は measure(リードなしの段と同じ印で文が2つ)。
  measureReed: {
    flag: "measure", icon: "mic",
    title: "このリードで計測してみよう", line: "ボタンタップで計測スタート",
    target: '[data-coach="measure"]', pad: 14, shape: "circle", dismissWith: MEASURE_TAB_STEPS,
  },
  measure: {
    flag: "measure", icon: "mic",
    title: "最初の計測を記録しよう", line: "ボタンタップで計測スタート",
    target: '[data-coach="measure"]', pad: 14, shape: "circle",
    // 【便BS】計測タブの段。外を押したら計測タブの段を全部出さない
    dismissWith: MEASURE_TAB_STEPS,
  },
  // 【便BW 本人の要望7】⑩ 下部タブ「データ」の絵柄。計測があるときだけ。
  goData: {
    flag: "goData", icon: "data",
    title: "計測の記録を見てみよう", line: null,
    target: '[data-coach="nav-analysis"] svg', pad: 11, shape: "circle", dismissWith: MEASURE_TAB_STEPS,
  },
  reeds: {
    flag: "reeds", icon: "reeds",
    // 【便BQ 2026-10-03 本人指示】1行を「計測に登録したリードを紐づけることができます」に。
    // 【便BX 2026-10-06 本人の実機指示】見出しを「楽器を選択してリードを登録しよう」に(本人の原文「画期を選択して」は「楽器」の打ち間違いと読む)。
    title: "楽器を選択してリードを登録しよう", line: "計測に登録したリードを紐づけることができます",
    target: '[data-coach="reeds"]', pad: 10, shape: "circle",
    // 【便BX 本人の実機指示】上部の楽器種別の行(S.Sax / A.Sax / T.Sax / B.Sax)も暗幕から外す(2つ目の穴)。
    // 行の4つのボタンは行の幅いっぱいに並ぶので、行の箱をそのまま穴にする(pad 0・角丸の矩形 = 環の箱・音の傾向カードと同じ「箱」の値)。
    // 穴の中には受けを置かないので、押せば下の楽器種別のボタンに届く(外押しにならない)。段の済み方(リードの登録)は変えない。
    also: { target: '[data-coach="reedsSax"]', pad: 0, shape: "rect" },
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
  // (【便BS】の dataSeen「計測したデータがここに貯まります」(的なし)はここにあった。【便BW】役目は ⑫⑬⑭ が継いだ。印の名前は残す)
  // 【便BW 本人の要望7】⑫ カレンダーの最新の計測の日のマス(その日の枠が閉じているときだけ名乗る)。
  calendarDay: {
    flag: "calendarDay", icon: "data",
    title: "計測した日を押してみよう", line: null,
    // 【便BW 再審査】的は中の丸(34)。pad 5 で直径 44(§5 の当たりの最小)。iPhone・iPad とも同じ大きさ。
    // passThrough: 丸の外でもマス(押せる日のボタン)の中は下へ通す(外押しにしない。iPad のマスは幅 87)
    target: '[data-coach="calendarDay"]', pad: 5, shape: "circle", passThrough: "button", dismissWith: DATA_TAB_STEPS,
  },
  // ⑬ 開いた日の枠の先頭の記録の行。押すと計測の詳細(詳細の中にカードは置かない)。
  daySession: {
    flag: "daySession", icon: "data",
    title: "記録を開いてみよう", line: null,
    target: '[data-coach="daySession"]', pad: 4, shape: "rect", dismissWith: DATA_TAB_STEPS,
  },
  // 【便BW 本人の要望8】⑭ 音の傾向カード。My Data の最下段なので、初回だけ的へスクロール。押す=済。
  trend: {
    flag: "trend", icon: "data",
    title: "データが溜まると、平均がここにグラフで出ます", line: null,
    target: '[data-coach="trend"]', pad: 0, shape: "rect", markOnDismiss: true, scrollIntoView: true,
  },
  // 【便BW 本人の要望9・本人裁定 2026-10-06】⑮ みんなの平均を目安にしたあと、帯の「見る」で来たときだけ。的は ⑭ と同じ音の傾向カード
  // (目安があれば折れ線の既定は my平均 × 目安)。押す=済。
  idealSeen: {
    flag: "idealSeen", icon: "target",
    title: "みんなの平均を目安にしました", line: "my平均と目安を重ねて見られます",
    target: '[data-coach="trend"]', pad: 0, shape: "rect", markOnDismiss: true, scrollIntoView: true,
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
  out[COACH2_MIGRATED] = src[COACH2_MIGRATED] === true;
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
// 【便BW】計測タブの章(MEASURE_CHAPTER_FLAGS)を全部閉じる ── 計測したことがある人に初めての人向けの案内を出さない。
export function onboardingFlagsForSavedSession(session) {
  return session?.reedId ? [...MEASURE_CHAPTER_FLAGS, "reedsMeasure"] : [...MEASURE_CHAPTER_FLAGS];
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
// 【便BW 2026-10-06 本人裁定(§14 の 2 = 既定 ア)】3つ目の門(migratedCoach2)。計測が1件でもある人には新しい段を1つも出さない
// (新しい8つの印を立てる)。リードがあれば goReeds、前の版で dataSeen を押した人はデータタブの3段、みんなの平均を取り込んである人は idealSeen。
export function migrateOnboardingDone(prev, { sessions = [], reeds = [], idealProfiles = [], isAdopted = () => false } = {}) {
  const base = isObj(prev) ? prev : {};
  if (base.migrated === true && base[MEASURE_STEPS_MIGRATED] === true && base[COACH2_MIGRATED] === true) return prev;
  const next = { ...base };
  const ss = Array.isArray(sessions) ? sessions : [];
  const rs = Array.isArray(reeds) ? reeds : [];
  // 【便BP3】みんなの平均の目安は、名前が「みんなの平均」で始まる取り込んだ目安で見分ける。
  const hasCohortIdeal = (Array.isArray(idealProfiles) ? idealProfiles : []).some((p) => isAdopted(p) && isCohortAverageProfile(p));
  if (base.migrated !== true) {
    if (ss.length > 0) next.measure = true;
    if (rs.length > 0) next.reeds = true;
    if (ss.some((s) => Boolean(s?.reedId))) next.reedsMeasure = true;
    // 【便BP3】adoptAverage は**みんなの平均の目安**があるときだけ。
    if (hasCohortIdeal) next.adoptAverage = true;
    next.migrated = true;
  }
  // 【便BS】計測タブの3段。立てるだけ(既に立っている印は倒さない)。【便BW】群が広がったので、便BS の3段は別の定数で持つ。
  if (ss.length > 0) { for (const f of MEASURE_TAB_STEPS_LEGACY) next[f] = true; }
  next[MEASURE_STEPS_MIGRATED] = true;
  // 【便BW】新しい段。1回だけ。
  if (base[COACH2_MIGRATED] !== true) {
    // 【便BW 審査】idealSeen も(本人裁定「既存の利用者には新しい段0枚」。計測がある人には「見る」は移動とスクロールだけ)
    if (ss.length > 0) for (const f of ["metroTempo", "metroStart", "goReeds", "reedLinked", "goData", "calendarDay", "daySession", "trend", "idealSeen"]) next[f] = true;
    if (rs.length > 0) next.goReeds = true;
    if (base.dataSeen === true) for (const f of DATA_TAB_STEPS) next[f] = true;
    if (hasCohortIdeal || base.adoptAverage === true) next.idealSeen = true;
    next[COACH2_MIGRATED] = true;
  }
  return next;
}

// いまのタブで出し得る一手(順番どおり。的が画面に在る最初の1つを出す)。
//   計測   … マイクの許可が済んでいる(micReady)ときだけ。【便BW】① → ② →(面の中)③ → ④ → ⑤ →(面の外)⑤ → ⑧ → ⑨ → ⑩ の順に1つずつ
//   リード … 登録 → 登録が済んだら「このリードで計測」
//   データ … 計測の有無で分ける(同時には出ない)。計測が無い: 計測タブへ(計測が済むまで。計測タブと共通の印。今までどおり) /
//            計測がある: 【便BW】⑫ 日のマス → ⑬ 記録の行 → ⑭ 音の傾向。計測の有無が読めるまで(sessionsKnown)はどちらも出さない
//   コミュニティ … 参加したら(印 join)、すぐみんなの平均を目安に(【便BQ】奏者を開く段は外した。【便BS】参加前の段も外した)
// 【便BS 審査 2026-10-03 統括の裁定】
//   metroPanelOpen … メトロノームの面が開いている間は、計測の段(measure)を出さない(面の上に出て最初のテンポ操作を食べるため)。
//                    面を閉じたら出る。メトロノームの印は今までどおり面を開いたときに立てる
//   (【便BW】dataSeenDeferred は dataSeen の段と一緒に外した。0件 → 1件の起動では ⑩ → ⑫ と続いてほしい)
// 【便BW 2026-10-06 凍結仕様 §6・本人裁定】
//   hasSelectedReed … 計測タブの枠にリードが出ている(いまの楽器のリードが選ばれている)。⑧ と ⑨ の文を決める
//   idealRequested  … 帯の「見る」からデータタブへ来た(⑮)。他のどの段より先・1回だけ。計測の有無を待たない(音の傾向カードは 0件でも在る)
//   計測タブは1つだけ返す(的が無ければ何も出ない)。データタブは並びで返す(日の枠の開閉で ⑫⑬ のどちらの的が在るかが決まる)。
//   ⑭ と ⑮ は同じ的(音の傾向カード)。⑮ を見た人には ⑭ を出さない(同じカードの案内を2回続けない)。⑭ を先に見た人にも ⑮ は出る(目安の話は新しい)
export function coachCandidates({
  topTab, done, micReady = false, hasSessions = false, sessionsKnown = true,
  metroPanelOpen = false, metronomeOn = false, metroTempoQuiet = true, hasSelectedReed = false, idealRequested = false,
}) {
  const d = done ?? {};
  switch (topTab) {
    case "measure": {
      if (!micReady) return [];
      if (!d.tuner) return ["tuner"];
      if (!d.metronome) return ["metronome"];
      // 面の中の段(③④)は、面が開いていて ③④ が済んでいないときだけ。
      // 【便BW 審査 2026-10-06 統括の裁定】③④ が済んでいれば、面が開いていても閉じているときと同じ ⑤→⑧→⑨→⑩ に合流する
      // (面はタブをまたいで開いたままなので、⑦ の「計測」で戻る本筋の道で流れが止まっていた)。面を閉じる段は足さない(閉じると鳴りやむ)。
      if (metroPanelOpen && !d.metroTempo) return ["metroTempo"];
      // 【便BW 再審査 統括の裁定(a)】④ はテンポ行に最後に触れてから TUNER_SUSTAIN_MS の間なにも触れなかったとき(metroTempoQuiet)に出す
      // (③ のあと続けて − / ＋ を押すと、④ のカードがテンポ行を覆っていて、その1回が外押しになって計測タブの段がまるごと消えていた)
      if (metroPanelOpen && !d.metroStart) return metroTempoQuiet ? ["metroStart"] : [];
      // 【便BW 審査】面が開いていて鳴っている間は ④ の次の段を出さない(④ の文が促す2回目のタップが次の段の受けに当たり、
      // 外押しとして計測タブの段がこの起動の間まるごと消えていた)。止まったら出す
      if (metroPanelOpen && metronomeOn) return [];
      if (!d.goReeds && !d.reeds) return ["goReeds"];
      if (hasSelectedReed && !d.reedLinked) return ["reedLinked"];
      if (!d.measure) return [hasSelectedReed ? "measureReed" : "measure"];
      if (hasSessions && !d.goData) return ["goData"];
      return [];
    }
    case "reeds": return !d.reeds ? ["reeds"] : !d.reedsMeasure ? ["reedsMeasure"] : [];
    case "analysis": {
      if (idealRequested && !d.idealSeen) return ["idealSeen"];
      if (!sessionsKnown) return [];
      if (!hasSessions) return !d.measure ? ["data"] : [];
      const out = [];
      if (!d.calendarDay) out.push("calendarDay");
      if (!d.daySession) out.push("daySession");
      if (d.daySession && !d.trend && !d.idealSeen) out.push("trend");
      return out;
    }
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
  const sameBox = (p, q) => r2(p.left) === r2(q.left) && r2(p.top) === r2(q.top) && r2(p.width) === r2(q.width) && r2(p.height) === r2(q.height);
  // 【便BX】2つ目の穴(片方だけ在る・位置が違う)も比べる。無い段同士は今までどおり
  const sameExtra = !a.extra && !b.extra ? true : Boolean(a.extra && b.extra && sameBox(a.extra, b.extra) && a.split === b.split);
  return same && sameBox(a.hole, b.hole) && sameExtra;
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

// 【便BX】2つの穴を縦に分ける線(画面の座標)。上の穴の下端と下の穴の上端の真ん中を整数に丸め、2つの穴の間に収める。
// 縦に重なっていれば null(2つ目の穴は出さない)。暗幕(穴の影)と受けは、この線より上を上の穴が、下を下の穴が受け持つ。
export function holesSplit(a, b) {
  const aBottom = a.top + a.height;
  const bBottom = b.top + b.height;
  const [upperBottom, lowerTop] = aBottom <= b.top ? [aBottom, b.top] : bBottom <= a.top ? [bBottom, a.top] : [null, null];
  if (upperBottom === null) return null;
  return Math.min(lowerTop, Math.max(upperBottom, Math.round((upperBottom + lowerTop) / 2)));
}
// 【便BX】穴が受け持つ縦の帯(線より上の穴は 0 〜 線、下の穴は 線 〜 画面の下端)。
export function bandOfHole(hole, split, vh) {
  return hole.top + hole.height <= split ? { top: 0, bottom: split } : { top: split, bottom: vh };
}
// 【便BX】穴の影(暗幕)を受け持ちの帯の中だけに切る clip-path。影は穴の要素の外へ 150vmax 広がるので、
// 切り取りの枠を穴の要素の縁から画面の縁・帯の縁まで外へ広げる(負の inset)。2つの穴の影が重なって二重に暗くならない。
export function holeClipPath(hole, band, vw) {
  const r = hole.left + hole.width;
  const b = hole.top + hole.height;
  return `inset(${band.top - hole.top}px ${r - vw}px ${b - band.bottom}px ${-hole.left}px)`;
}

// 穴の外側を覆う4枚の受け(上・下・左・右)。【便BQ】外を押したら案内を消す。穴の上には何も置かない(的は押せる)。
// 【便BX】band を渡すと、上下の受けをその帯の中に収める(2つ目の穴がある段。渡さなければ画面の上端 〜 下端で今までどおり)。
function hitRects(hole, vw, vh, band = null) {
  const top = hole.top;
  const bottom = hole.top + hole.height;
  const left = hole.left;
  const right = hole.left + hole.width;
  const top0 = band ? band.top : 0;
  const bottom0 = band ? band.bottom : vh;
  return [
    { key: "t", left: 0, top: top0, width: vw, height: Math.max(0, top - top0) },
    { key: "b", left: 0, top: bottom, width: vw, height: Math.max(0, bottom0 - bottom) },
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
//   【便BS】dismissWith を持つ段は、その全部をこの起動の間は出さない(【便BW】計測タブの段・データタブの段)。
//   markOnDismiss の段(【便BW】reedLinked・trend・idealSeen)だけは、外を押したら onMark(印の名前)で印を立てる(押すことが一手そのもの)
// 【便BW】的なしの段(画面いっぱいの暗幕・受け1枚)の道は外した。どの段も穴と受け4枚。
//   scrollIntoView の段は、的が在るのに画面の外なら、この起動で1回だけ的を画面の中央へ送る(scrolledRef)。
// 【便BX】also を持つ段(リード1)は穴が2つ。画面を2つの穴の間の線(holesSplit)で上下に分け、穴ごとに自分の帯の中だけ
//   影(暗幕)を落とし(clip-path)、受けも帯の中に4枚ずつ置く。穴の影が1つなので、穴を広げずに離れた2か所を照らせる。
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
  // 【便BW】的へスクロールした段(scrollIntoView の段。この起動で1回だけ。送り返されても引き戻さない)。
  const scrolledRef = useRef(new Set());
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
    // 【便BW 審査】前の候補の的が DOM に在る間(見えていなくても)は、後の段のために画面を送らない(前の段を待っている)。
    let earlierInDom = false;
    for (const id of candidatesRef.current ?? []) {
      if (dismissedRef.current.has(id)) continue;
      const step = COACH_STEPS[id];
      if (!step) continue;
      // (【便BW】的なし(target: null)の段の道はここにあった。段が無くなったので外した)
      const el = document.querySelector(step.target);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (!targetVisible(r, vw, vh)) {
        // 【便BW】音の傾向カード(My Data の最下段)は初期のスクロールでは画面の外。この起動で1回だけ的を画面の中央へ送る
        // (behavior: "auto" = 即座。なめらかに流さない)。次の測り直しで見えていれば出る。
        if (step.scrollIntoView && !earlierInDom && r.height > 0 && !scrolledRef.current.has(id)) {
          scrolledRef.current.add(id);
          el.scrollIntoView?.({ block: "center", behavior: "auto" });
        }
        earlierInDom = true;
        continue;
      }
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
      // 【便BW 再審査】passThrough を持つ段は、的の要素を含むその祖先(押せる日のボタン)の矩形も下へ通す(受けを置かない)
      const pt = step.passThrough ? el.closest(step.passThrough) : null;
      found = { id, r, shape: el.getAttribute("data-coach-shape"), pass: pt ? pt.getBoundingClientRect() : null };
      break;
    }
    if (!found) { if (cur) commit(null); return false; }
    const step0 = COACH_STEPS[found.id];
    const hole = holeOf(found.r, found.shape ? { ...step0, shape: found.shape } : step0);
    const sameStep = cur && cur.id === found.id;
    const cardH = sameStep ? (cardRef.current?.getBoundingClientRect().height || 0) : 0;
    const place = placeCoachCard({ hole, cardH, vh, bottomLimit: readBottomLimit(vh) });
    // 受けを置かない範囲 = 穴の外接矩形(と passThrough の祖先の矩形を足した外接矩形)
    const pr = found.pass;
    const pass = pr ? {
      left: Math.min(hole.left, pr.left), top: Math.min(hole.top, pr.top),
      width: Math.max(hole.left + hole.width, pr.right) - Math.min(hole.left, pr.left),
      height: Math.max(hole.top + hole.height, pr.bottom) - Math.min(hole.top, pr.top),
    } : hole;
    // 【便BX】2つ目の穴(also)。画面にまるごと見えていて、1つ目と縦に重ならないときだけ。見えていなければ1つ目だけ(今までどおり)
    let extra = null; let split = null; let band = null; let extraBand = null;
    if (step0.also) {
      const xe = document.querySelector(step0.also.target);
      const xr = xe ? xe.getBoundingClientRect() : null;
      if (xr && targetVisible(xr, vw, vh)) {
        const xh = holeOf(xr, step0.also);
        const sp = holesSplit(pass, xh);
        if (sp !== null) { extra = xh; split = sp; band = bandOfHole(pass, sp, vh); extraBand = bandOfHole(xh, sp, vh); }
      }
    }
    const next = { id: found.id, hole, pass, extra, split, band, extraBand, top: place.top, side: place.side, measured: cardH > 0, leaving: false, vw, vh };
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
    // 【便BS】計測タブの段は一緒に消す(次の段がすぐ出て連打にならないように)。【便BW】データタブの段も同じ
    for (const id of step.dismissWith ?? [cur.id]) dismissedRef.current.add(id);
    dismissedRef.current.add(cur.id);
    setAnnouncedId(null);
    commit(null);
    // 【便BS】押すことが一手そのものの段(【便BW】reedLinked・trend・idealSeen)は、ここで印を立てる(二度と出さない)
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
          {/* 【便BW】どの段も穴を持つ(的なしの段の画面いっぱいの暗幕は無くなった。暗幕の規則そのものは参加の画面が使う)。 */}
          <div
            className="coach-hole"
            aria-hidden="true"
            style={{
              left: view.hole.left, top: view.hole.top, width: view.hole.width, height: view.hole.height,
              borderRadius: HOLE_RADIUS[view.hole.shape],
              // 【便BX】2つ目の穴がある段だけ、影を受け持ちの帯の中に切る(無い段は clip-path を持たない = 今までどおり)
              clipPath: view.extra ? holeClipPath(view.hole, view.band, view.vw) : undefined,
            }}
          />
          {/* 【便BX】2つ目の穴(リード1の楽器種別の行)。見た目は1つ目と同じ .coach-hole(新しい CSS は無い)。影は自分の帯の中だけ。 */}
          {view.extra ? (
            <div
              className="coach-hole"
              aria-hidden="true"
              data-coach-hole="also"
              style={{
                left: view.extra.left, top: view.extra.top, width: view.extra.width, height: view.extra.height,
                borderRadius: HOLE_RADIUS[view.extra.shape],
                clipPath: holeClipPath(view.extra, view.extraBand, view.vw),
              }}
            />
          ) : null}
          {/* 【便BQ】穴の外側の受け(透明)。押したら案内を消すだけ(下へ届かせない)。穴の上には置かない。 */}
          {hitRects(view.pass ?? view.hole, view.vw, view.vh, view.band).map((h) => (
            <div key={h.key} className="coach-hit" aria-hidden="true" data-coach-hit={h.key}
              style={{ left: h.left, top: h.top, width: h.width, height: h.height }}
              onClick={dismiss} />
          ))}
          {/* 【便BX】2つ目の穴の外側の受け(その帯の中の4枚)。2つ目の穴の上にも何も置かない(楽器種別のボタンは押せる)。 */}
          {view.extra ? hitRects(view.extra, view.vw, view.vh, view.extraBand).map((h) => (
            <div key={`x${h.key}`} className="coach-hit" aria-hidden="true" data-coach-hit={`x${h.key}`}
              style={{ left: h.left, top: h.top, width: h.width, height: h.height }}
              onClick={dismiss} />
          )) : null}
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
