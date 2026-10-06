// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OnboardingCoach, COACH_STEPS, ONBOARDING_FLAGS, coachCandidates, normalizeOnboardingDone, markOnboardingDone,
  migrateOnboardingDone, onboardingFlagsForSavedSession, holeOf, placeCoachCard, targetVisible, leaveDurationMs,
  holesSplit, bandOfHole, holeClipPath,
  MEASURE_TAB_STEPS, MEASURE_STEPS_MIGRATED, TUNER_SUSTAIN_MS, useSustained,
  COACH2_MIGRATED, MEASURE_TAB_STEPS_LEGACY, DATA_TAB_STEPS, MEASURE_CHAPTER_FLAGS,
  COACH3_MIGRATED, coachProgress, COACH_TABS, COACH_SKIPPED,
  COACH4_MIGRATED, coachScrollPlan, floatingCovers, goCompareOpen, coachCameFromCompare, coachDuringNotice, COACH_WITH_NOTICE,
} from "./onboarding.jsx";

// ------------------------------------------------------------------
// 【便BP 2026-10-03 本人裁定 / 便BQ 2026-10-03 本人の実機指示】はじめの一手。純関数(どの一手を出すか・印・移行・穴とカードの位置)と、
// 部品 OnboardingCoach(出る・出ない・外を押したら消える・穴は下へ通す・溶ける・reduced-motion・読み上げ・追従の止め方)。
// 期待値は凍結仕様の表と本人の指示から**手で書いた**(実装の COACH_STEPS から読まない)。
// 【便BQ で消した検査】便BP3〜6 の置き場所(押せる部品を避ける・重み・スクロールで出せるか・部品の縁の候補・いまの位置を保つ・
//   スクロール中は置き直さない・告知の帯の祖先の fixed・disabled・data-coach-avoid)の検査は、カードを中央に置くようになって
//   守る物が無くなったので消した。参加後1(openPerson)の検査も消し、「無いこと」の検査に替えた。
// 【守っていないもの】本物の画面での的の位置と見た目(375×812 / 375×667 の実測は報告の表。headless Chrome)。
// 【便BW 2026-10-06 本人の要望・凍結仕様 coach2-spec.md】一本の流れ(17 の段)に作り直した。期待値は仕様 §2.6 の表・§6 の分岐・§8 の移行と、
//   本人裁定(⑮ はデータタブの音の傾向カード・文「みんなの平均を目安にしました / my平均と目安を重ねて見られます」)から**手で書いた**。
//   便BS の dataSeen(的なし)・dataSeenDeferred の検査は段ごと無くなったので消し、「無いこと」の検査に替えた(各所に【便BW】)。
// 【便BX 2026-10-06 本人の決定・凍結仕様 coach3-spec.md】到着カード4つ(穴なし・どこを押しても次へ)・⑭' goCommunity・⑰ goMeasure・
//   章の目印(chapter / chapterDone / chapterMarks)・⑩ の2つ目の穴(帯の箱)・4つ目の門(migratedCoach3)。期待値は仕様 §2.3 の表・§3 の分岐・
//   §5.1 の規則・§10 の表から**手で書いた**。既存の「リード・データ(計測あり)・コミュニティの最初の段」の期待は、到着が先に出るようになったので
//   到着の印を立てた done で書き直した(各所に【便BX】)。「どの段も的を持つ」は「到着4段だけ的を持たない」に改めた。
// 【便BY 2026-10-07 本人の指示】⑥ の見出しを便BW に戻し、楽器種別の行の2つ目の穴を外した(穴は1つ)。章の目印(chapter / chapterDone /
//   chapterMarks)を外し、枚数の目印(COACH_ORDER / coachProgress)に替えた。期待値の 21 枚の順は仕様 coach3-spec.md §15 から**手で書いた**。
// ------------------------------------------------------------------

// 【便BZ】5つ目の門(migratedCoach4)も
const ALL_FALSE = normalizeOnboardingDone({ migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true });
const doneWith = (...flags) => ({ ...ALL_FALSE, ...Object.fromEntries(flags.map((f) => [f, true])) });

describe("文言(凍結仕様の表と本人の指示のとおり、一字一句)", () => {
  // [見出し, 1行(無ければ null), アイコン]
  const SPEC = {
    measure: ["最初の計測を記録しよう", "ボタンタップで計測スタート", "mic"],
    reeds: ["使っているリードを登録しよう", "計測に登録したリードを紐づけることができます", "reeds"],   // 【便BQ】本人の指示・【便BY】見出しを便BW に戻した
    reedsMeasure: ["このリードで計測してみよう", null, "measure"],                                    // 【便BQ】1行は無し
    data: ["計測を始めると、ここに貯まります", "計測タブから計測してみよう", "data"],
    adoptAverage: ["みんなの平均を目安にしてみよう", "目安に設定すると自分の音と比べられます", "target"],
    // 【便BS 2026-10-03 本人裁定(ficus-tutorial2.html の表)】計測タブの1段目・2段目
    tuner: ["まずは吹いてみよう", "音程がリアルタイムで表示されます", "tuner"],
    metronome: ["メトロノームも使えます", "テンポを決めて練習できます", "metro"],
    // 【便BW 2026-10-06 凍結仕様 §2.6】
    metroTempo: ["テンポを決めよう", "♩=n を押すと拍子も変えられます", "metro"],
    metroStart: ["タップでスタート", "もう一度押すと止まります", "metro"],
    goReeds: ["次はリードを登録しよう", null, "reeds"],
    reedLinked: ["選んだリードが紐づいています", "計測データに選択したリードが紐づきます", "reeds"],   // 【便BX】1行を本人の指示で替えた
    measureReed: ["このリードで計測してみよう", "ボタンタップで計測スタート", "mic"],
    goData: ["計測の記録を見てみよう", null, "data"],
    calendarDay: ["計測した日を押してみよう", null, "data"],
    daySession: ["記録を開いてみよう", null, "data"],
    trend: ["データが溜まると、平均がここにグラフで出ます", null, "data"],
    // 【便BW 本人裁定 2026-10-06】⑮ はデータタブの音の傾向カード
    idealSeen: ["みんなの平均を目安にしました", "my平均と目安を重ねて見られます", "target"],
    // 【便BX 2026-10-06 凍結仕様 §2.3】到着4つ・⑭'・⑰(「！」は全角・「ここはコミュニティ」に「タブ」を付けない)
    finish: ["チューナーとメトロノームを使って、あなたのデータを貯めよう！", "はじめの案内はこれで終わりです", "tuner"],
    arriveReeds: ["ここはリードタブ", "使っているリードを登録して、計測に紐づけます", "reeds"],
    arriveData: ["ここはデータタブ", "計測の記録はここに貯まります", "data"],
    goCommunity: ["みんなのデータも見てみよう", null, "community"],
    goMeasure: ["計測タブに戻ろう", null, "measure"],
    arriveCommunity: ["ここはコミュニティ", "参加した人の計測データと、みんなの平均が見られます", "community"],
    // 【便BZ 2026-10-07 統括の裁定】⑯ の次(見出しは短く・1行は無し。行き先の下部タブ「データ」と同じ絵)
    goCompare: ["目安と比べてみよう", null, "data"],
  };
  // 【便BS】参加前(join)の段は外した(参加の画面そのものがカードになった。community/joinCard.test.jsx)。
  it("【便BX】23 の段(【便BZ】24)の見出し・1行・アイコンが表のとおり(過不足なし。dataSeen「計測したデータがここに貯まります」・参加後1・参加前は無い)", () => {
    expect(Object.keys(SPEC)).toHaveLength(24);
    // 【便BY】章の目印を外したので、段は章(chapter)を持たない
    for (const id of Object.keys(SPEC)) expect("chapter" in COACH_STEPS[id], id).toBe(false);
    expect(Object.keys(COACH_STEPS).sort()).toEqual(Object.keys(SPEC).sort());
    for (const [id, [title, line, icon]] of Object.entries(SPEC)) {
      expect(COACH_STEPS[id].title, id).toBe(title);
      expect(COACH_STEPS[id].line, id).toBe(line);
      expect(COACH_STEPS[id].icon, id).toBe(icon);
    }
    expect("dataSeen" in COACH_STEPS).toBe(false);
    expect(Object.values(COACH_STEPS).some((s) => s.title === "計測したデータがここに貯まります")).toBe(false);
    expect(Object.values(COACH_STEPS).some((s) => s.title === "気になる奏者を開いてみよう")).toBe(false);
    expect(Object.values(COACH_STEPS).some((s) => s.title === "コミュニティに参加しよう")).toBe(false);
    expect(Object.values(COACH_STEPS).some((s) => s.title === "楽器を選択してリードを登録しよう")).toBe(false);   // 【便BY】便BX の見出しは残っていない
    // アイコンは既存の8種から(新しい絵は足していない。【便BX】community は参加のカードと同じ絵を ⑭' と到着が使う)
    expect(new Set(Object.values(COACH_STEPS).map((s) => s.icon))).toEqual(new Set(["tuner", "metro", "mic", "reeds", "measure", "data", "target", "community"]));
  });
  // 【便BX 2026-10-06 本人の決定 B1】「どの段も的を持つ」は、到着カード4段(穴なし)だけ的を持たない形に改めた
  it("【便BX】的: 到着4段(arrival: true)だけ target を持たず、他の19段(【便BZ】20段)は target が文字列。① は環の箱を角丸の矩形・pad 0", () => {
    const arrivals = Object.entries(COACH_STEPS).filter(([, s]) => s.arrival === true).map(([id]) => id).sort();
    expect(arrivals).toEqual(["arriveCommunity", "arriveData", "arriveReeds", "finish"]);
    for (const id of arrivals) {
      for (const k of ["target", "pad", "shape", "dismissWith", "markOnDismiss", "scrollIntoView", "also", "passThrough"]) expect(k in COACH_STEPS[id], `${id}.${k}`).toBe(false);
    }
    const others = Object.entries(COACH_STEPS).filter(([, s]) => !s.arrival);
    expect(others).toHaveLength(20);
    expect(others.every(([, s]) => typeof s.target === "string" && s.target.length > 0)).toBe(true);
    expect(Object.values(COACH_STEPS).some((s) => "anchor" in s)).toBe(false);
    // [target, pad, shape](仕様 §2.1 / §2.3 の表)
    const T = {
      tuner: ['[data-coach="tuner"]', 0, "rect"],
      metronome: ['[data-coach="metronome"]', 0, "circle"],
      metroTempo: ['[data-coach="metroTempo"]', 6, "pill"],
      metroStart: ['[data-coach="tuner"]', 0, "rect"],
      goReeds: ['[data-coach="nav-reeds"]', 0, "rect"],   // 【便BZ 統括の裁定】下部タブはボタンの箱(絵柄 + 名前)を角丸の矩形で
      reedLinked: ['[data-coach="reedChip"]', 6, "pill"],
      measureReed: ['[data-coach="measure"]', 14, "circle"],
      measure: ['[data-coach="measure"]', 14, "circle"],
      goData: ['[data-coach="nav-analysis"]', 0, "rect"],
      data: ['[data-coach="nav-measure"]', 0, "rect"],
      calendarDay: ['[data-coach="calendarDay"]', 5, "circle"],   // 【再審査】中の丸 34 + pad 5×2 = 直径 44(§5)
      daySession: ['[data-coach="daySession"]', 4, "rect"],
      trend: ['[data-coach="trend"]', 0, "rect"],
      idealSeen: ['[data-coach="trend"]', 0, "rect"],
      goCommunity: ['[data-coach="nav-community"]', 0, "rect"],   // 【便BX】⑤⑩ と同じ的の形
      goMeasure: ['[data-coach="nav-measure"]', 0, "rect"],       // 【便BX】⑪ と同じ的
    };
    for (const [id, want] of Object.entries(T)) {
      expect([COACH_STEPS[id].target, COACH_STEPS[id].pad, COACH_STEPS[id].shape], id).toEqual(want);
    }
    expect(TUNER_SUSTAIN_MS).toBe(1000);
  });
  it("データタブの一手は計測タブと同じ印(計測が1件保存された)で済む。⑨ の2つの文も同じ印 measure", () => {
    expect(COACH_STEPS.data.flag).toBe("measure");
    expect(COACH_STEPS.measure.flag).toBe("measure");
    expect(COACH_STEPS.measureReed.flag).toBe("measure");
    // 他の新しい段は自分の名前の印
    for (const id of ["metroTempo", "metroStart", "goReeds", "reedLinked", "goData", "calendarDay", "daySession", "trend", "idealSeen",
      "arriveReeds", "arriveData", "arriveCommunity", "goCommunity", "goMeasure", "finish"]) {
      expect(COACH_STEPS[id].flag, id).toBe(id);
    }
  });
  it("【便BW】群と押す=済: 計測タブの9段・データタブの3段。押す=済は reedLinked・trend・idealSeen の3つで、群を持たない", () => {
    expect([...MEASURE_TAB_STEPS]).toEqual(["tuner", "metronome", "metroTempo", "metroStart", "goReeds", "reedLinked", "measure", "measureReed", "goData"]);
    expect([...DATA_TAB_STEPS]).toEqual(["calendarDay", "daySession", "trend"]);
    expect([...MEASURE_TAB_STEPS_LEGACY]).toEqual(["tuner", "metronome", "measure"]);
    const marks = Object.entries(COACH_STEPS).filter(([, s]) => s.markOnDismiss).map(([id]) => id).sort();
    expect(marks).toEqual(["idealSeen", "reedLinked", "trend"]);
    for (const id of marks) expect(COACH_STEPS[id].dismissWith, id).toBeUndefined();
    for (const id of ["tuner", "metronome", "metroTempo", "metroStart", "goReeds", "measure", "measureReed", "goData"]) {
      expect(COACH_STEPS[id].dismissWith, id).toBe(MEASURE_TAB_STEPS);
    }
    for (const id of ["calendarDay", "daySession"]) expect(COACH_STEPS[id].dismissWith, id).toBe(DATA_TAB_STEPS);
    // 的へスクロールするのは音の傾向カードの2段だけ
    expect(Object.entries(COACH_STEPS).filter(([, s]) => s.scrollIntoView).map(([id]) => id).sort()).toEqual(["idealSeen", "trend"]);
    // 【便BX】新しい段は群を持たない(到着・⑭'・⑰ は自分だけ)。群の定数は変えていない
    for (const id of ["arriveReeds", "arriveData", "arriveCommunity", "finish", "goCommunity", "goMeasure"]) {
      expect(COACH_STEPS[id].dismissWith, id).toBeUndefined();
      expect(COACH_STEPS[id].markOnDismiss, id).toBeUndefined();
    }
  });
});

describe("どの一手を出すか(coachCandidates)", () => {
  const M = (done, o = {}) => coachCandidates({ topTab: "measure", done, micReady: true, ...o });
  // 【便BW 2026-10-06 凍結仕様 §6 / §11.1】計測タブは一本の流れ。1つずつ出す
  it("【便BW】計測タブの順(面が閉じている): ① → ② → ⑤ → ⑧ → ⑨ → ⑩ → 空", () => {
    expect(M(ALL_FALSE)).toEqual(["tuner"]);
    expect(M(doneWith("tuner"))).toEqual(["metronome"]);
    expect(M(doneWith("tuner", "metronome"))).toEqual(["goReeds"]);                                       // リード未登録
    expect(M(doneWith("tuner", "metronome", "reeds"), { hasSelectedReed: true })).toEqual(["reedLinked"]);
    expect(M(doneWith("tuner", "metronome", "reeds", "reedLinked"), { hasSelectedReed: true })).toEqual(["measureReed"]);
    expect(M(doneWith("tuner", "metronome", "reeds"), { hasSelectedReed: false })).toEqual(["measure"]);   // 枠にリードが無い
    expect(M(doneWith("tuner", "metronome", "reeds", "measure"), { hasSessions: true })).toEqual(["goData"]);
    expect(M(doneWith("tuner", "metronome", "reeds", "measure", "goData"), { hasSessions: true })).toEqual([]);
    // goReeds を済ませた(リードタブへ行った)人は、リードを登録していなくても ⑤ を抜ける
    expect(M(doneWith("tuner", "metronome", "goReeds"))).toEqual(["measure"]);
    // ⑩ は計測があるときだけ
    expect(M(doneWith("tuner", "metronome", "reeds", "measure"), { hasSessions: false })).toEqual([]);
    // 先の段が済んでいなければ、後の段の印が立っていても先の段から
    expect(M(doneWith("metronome"))).toEqual(["tuner"]);
    expect(M(doneWith("tuner", "measure"))).toEqual(["metronome"]);
  });
  // 【便BW 審査 2026-10-06 統括の裁定】面の中の分岐は ③④ が済むまでだけ。済めば面が開いていても ⑤→⑧→⑨→⑩ に合流する
  // (以前の「面が開いている間は ⑧⑨⑩ を返さない」は、⑦ の「計測」で面を開いたまま戻る本筋の道で流れを止めていた ── その期待を直した)
  it("【便BW 審査】面が開いている: ③ → ④ → 済めば閉じているときと同じ ⑤ → ⑧ → ⑨ → ⑩ に合流", () => {
    const o = { metroPanelOpen: true, hasSelectedReed: true, hasSessions: true };
    expect(M(doneWith("tuner", "metronome"), o)).toEqual(["metroTempo"]);
    expect(M(doneWith("tuner", "metronome", "metroTempo"), o)).toEqual(["metroStart"]);
    expect(M(doneWith("tuner", "metronome", "metroTempo", "metroStart"), o)).toEqual(["goReeds"]);
    expect(M(doneWith("tuner", "metronome", "metroTempo", "metroStart", "reeds"), o)).toEqual(["reedLinked"]);
    expect(M(doneWith("tuner", "metronome", "metroTempo", "metroStart", "reeds", "reedLinked"), o)).toEqual(["measureReed"]);
    expect(M(doneWith("tuner", "metronome", "metroTempo", "metroStart", "reeds", "reedLinked"), { ...o, hasSelectedReed: false })).toEqual(["measure"]);
    expect(M(doneWith("tuner", "metronome", "metroTempo", "metroStart", "reeds", "reedLinked", "measure"), o)).toEqual(["goData"]);
    // 面が開いているかどうかで ③④ の後の結果は変わらない
    const after = doneWith("tuner", "metronome", "metroTempo", "metroStart", "goReeds");
    for (const extra of [{}, { hasSelectedReed: false }, { hasSessions: false }]) {
      expect(M(after, { ...o, ...extra })).toEqual(M(after, { ...o, ...extra, metroPanelOpen: false }));
    }
    // 面が開いていても、まだ済んでいない前の段はそのまま
    expect(M(ALL_FALSE, o)).toEqual(["tuner"]);
    expect(M(doneWith("tuner"), o)).toEqual(["metronome"]);
    // 面を閉じれば ③④ を済ませていなくても ⑤ へ(③④ は面を次に開いたときに出る)
    expect(M(doneWith("tuner", "metronome"), { metroPanelOpen: false })).toEqual(["goReeds"]);
  });
  // 【便BW 審査 統括の裁定(a)】④ の文が促す2回目のタップが次の段の受けに当たらないよう、面が開いていて鳴っている間は ④ の次を出さない
  // 【便BW 再審査 統括の裁定(a)】④ はテンポ行に触れずに TUNER_SUSTAIN_MS 経ってから(③ のあと続けて − / ＋ を押す人を ④ のカードが遮らない)
  it("【便BW 再審査】④ はテンポ行が静かなとき(metroTempoQuiet)だけ。触れている間は何も出さない。③ と ⑤ 以降には関係しない", () => {
    const o = { metroPanelOpen: true };
    expect(M(doneWith("tuner", "metronome", "metroTempo"), { ...o, metroTempoQuiet: false })).toEqual([]);
    expect(M(doneWith("tuner", "metronome", "metroTempo"), { ...o, metroTempoQuiet: true })).toEqual(["metroStart"]);
    expect(M(doneWith("tuner", "metronome", "metroTempo"), o)).toEqual(["metroStart"]);   // 既定は静か
    expect(M(doneWith("tuner", "metronome"), { ...o, metroTempoQuiet: false })).toEqual(["metroTempo"]);
    expect(M(doneWith("tuner", "metronome", "metroTempo", "metroStart"), { ...o, metroTempoQuiet: false })).toEqual(["goReeds"]);
    expect(M(doneWith("tuner", "metronome", "metroTempo"), { metroPanelOpen: false, metroTempoQuiet: false })).toEqual(["goReeds"]);
  });
  it("【便BW 審査】面が開いていて鳴っている間は ④ の次の段を出さない。止まれば出る。面が閉じていれば鳴っていても関係しない", () => {
    const o = { metroPanelOpen: true, hasSelectedReed: true, hasSessions: true };
    const d34 = doneWith("tuner", "metronome", "metroTempo", "metroStart");
    expect(M(d34, { ...o, metronomeOn: true })).toEqual([]);
    expect(M(d34, { ...o, metronomeOn: false })).toEqual(["goReeds"]);
    expect(M(doneWith("tuner", "metronome", "metroTempo", "metroStart", "reeds"), { ...o, metronomeOn: true })).toEqual([]);
    expect(M(d34, { ...o, metroPanelOpen: false, metronomeOn: true })).toEqual(["goReeds"]);
    // ③④ がまだなら、鳴っていても面の中の段は出す(④ は鳴れば済む)
    expect(M(doneWith("tuner", "metronome"), { ...o, metronomeOn: true })).toEqual(["metroTempo"]);
    expect(M(doneWith("tuner", "metronome", "metroTempo"), { ...o, metronomeOn: true })).toEqual(["metroStart"]);
  });
  it("【便BW】マイクの門: micReady が false なら計測タブでは何も出さない(⑮ は計測タブに無い。本人裁定でデータタブへ)", () => {
    expect(M(ALL_FALSE, { micReady: false })).toEqual([]);
    expect(M(doneWith("tuner"), { micReady: false })).toEqual([]);
    expect(M(ALL_FALSE, { micReady: false, idealRequested: true })).toEqual([]);
    expect(M(ALL_FALSE, { idealRequested: true })).toEqual(["tuner"]);
  });
  // 【便BX】到着(arriveReeds)が先。到着を済ませた done で、登録 → 「このリードで計測」の順は今までどおり
  it("リードタブ: 到着 → 登録 → 登録が済んだら「このリードで計測」 → 両方済んだら出ない", () => {
    expect(coachCandidates({ topTab: "reeds", done: ALL_FALSE })).toEqual(["arriveReeds"]);
    expect(coachCandidates({ topTab: "reeds", done: doneWith("arriveReeds") })).toEqual(["reeds"]);
    expect(coachCandidates({ topTab: "reeds", done: doneWith("arriveReeds", "reeds") })).toEqual(["reedsMeasure"]);
    expect(coachCandidates({ topTab: "reeds", done: doneWith("arriveReeds", "reeds", "reedsMeasure") })).toEqual([]);
    // 到着がまだなら、⑥⑦ が済んでいても到着だけ(場所を言う札は1回)
    expect(coachCandidates({ topTab: "reeds", done: doneWith("reeds", "reedsMeasure") })).toEqual(["arriveReeds"]);
  });
  it("データタブ・計測が無い: 計測が済むまで(計測タブと共通の印。今までどおり)", () => {
    expect(coachCandidates({ topTab: "analysis", done: ALL_FALSE })).toEqual(["data"]);
    expect(coachCandidates({ topTab: "analysis", done: doneWith("measure") })).toEqual([]);
    expect(coachCandidates({ topTab: "analysis", done: ALL_FALSE, hasSessions: false, sessionsKnown: true })).toEqual(["data"]);
  });
  // 【便BW】計測があるときは ⑫ 日のマス → ⑬ 記録の行 → ⑭ 音の傾向(並びで返す。的の在り方で ⑫⑬ のどちらかが決まる)
  // 【便BX】到着(arriveData)と ⑭'(goCommunity)の印を立てた done で、⑫⑬⑭ の並びは今までどおり(到着・⑭' は下の【便BX】の節)
  it("【便BW】データタブ・計測がある: [⑫, ⑬] → ⑬ 済で [⑫, ⑭] → 全部済で空。読み込み中は出さない。dataSeen は返さない", () => {
    const A = (done, o = {}) => coachCandidates({ topTab: "analysis", done: { ...done, arriveData: true, goCommunity: true }, hasSessions: true, ...o });
    expect(A(ALL_FALSE)).toEqual(["calendarDay", "daySession"]);
    expect(A(doneWith("calendarDay"))).toEqual(["daySession"]);
    expect(A(doneWith("daySession"))).toEqual(["calendarDay", "trend"]);
    expect(A(doneWith("calendarDay", "daySession"))).toEqual(["trend"]);
    expect(A(doneWith("calendarDay", "daySession", "trend"))).toEqual([]);
    expect(A(ALL_FALSE, { sessionsKnown: false })).toEqual([]);
    expect(coachCandidates({ topTab: "analysis", done: ALL_FALSE, hasSessions: false, sessionsKnown: false })).toEqual([]);
    // 便BS の dataSeen は段ごと無い(印 dataSeen が立っていてもいなくても同じ)
    expect(A(doneWith("dataSeen"))).toEqual(["calendarDay", "daySession"]);
  });
  // 【便BW 本人裁定 2026-10-06】⑮ は帯の「見る」でデータタブへ来たときだけ。他のどの段より先・1回だけ。計測の有無を待たない
  // 【便BX】到着・⑭'・⑰ を済ませた done で(⑮ の後の ⑰ は下の【便BX】の節)
  it("【便BW 本人裁定】データタブ ⑮: idealRequested のときだけ・先頭に1つだけ。済めば普段の結果。⑮ を見た人に ⑭ は出さない", () => {
    const A = (done, o = {}) => coachCandidates({ topTab: "analysis", done: { ...done, arriveData: true, goCommunity: true, goMeasure: true }, hasSessions: true, ...o });
    expect(A(ALL_FALSE, { idealRequested: true })).toEqual(["idealSeen"]);
    expect(A(ALL_FALSE, { idealRequested: true, sessionsKnown: false })).toEqual(["idealSeen"]);     // 読み込みを待たない
    expect(A(ALL_FALSE, { idealRequested: true, hasSessions: false })).toEqual(["idealSeen"]);       // 計測が無くても(カードは在る)
    expect(A(doneWith("calendarDay", "daySession"), { idealRequested: true })).toEqual(["idealSeen"]); // ⑭ より先
    expect(A(doneWith("idealSeen"), { idealRequested: true })).toEqual(["calendarDay", "daySession"]);
    expect(A(ALL_FALSE, { idealRequested: false })).toEqual(["calendarDay", "daySession"]);
    // 同じ的(音の傾向カード)なので、⑮ を見た人には ⑭ を出さない。⑭ を先に見た人にも ⑮ は出る
    expect(A(doneWith("calendarDay", "daySession", "idealSeen"))).toEqual([]);
    expect(A(doneWith("calendarDay", "daySession", "trend"), { idealRequested: true })).toEqual(["idealSeen"]);
    // 他のタブでは出さない(【便BZ】コミュニティは目安にしたあと goCompare。⑮ の依頼では変わらない)
    expect(coachCandidates({ topTab: "community", done: doneWith("join", "arriveCommunity", "adoptAverage"), idealRequested: true })).toEqual(["goCompare"]);
    expect(coachCandidates({ topTab: "reeds", done: doneWith("arriveReeds", "reeds", "reedsMeasure"), idealRequested: true })).toEqual([]);
  });
  it("【便BW】引数に dataSeenDeferred は無い(渡しても結果は変わらない)", () => {
    const base = { topTab: "analysis", done: ALL_FALSE, hasSessions: true };
    expect(coachCandidates({ ...base, dataSeenDeferred: true })).toEqual(coachCandidates(base));
    expect(/dataSeenDeferred/.test(coachCandidates.toString())).toBe(false);
  });
  // 【便BS】参加前の段は無い。印 join(参加した)はみんなの平均の段の門として残る
  // 【便BX】参加したら到着(arriveCommunity)が先。到着を済ませた done で、みんなの平均の段は今までどおり
  it("コミュニティ: 参加したら(印 join)、到着 → みんなの平均を目安に(【便BQ】奏者を開く段は無い・【便BS】参加前の段も無い)", () => {
    expect(coachCandidates({ topTab: "community", done: ALL_FALSE })).toEqual([]);
    expect(coachCandidates({ topTab: "community", done: doneWith("join") })).toEqual(["arriveCommunity"]);
    expect(coachCandidates({ topTab: "community", done: doneWith("join", "arriveCommunity") })).toEqual(["adoptAverage"]);
    // 【便BZ】⑯ の次は「目安と比べてみよう」。比べに行った(goCompare)・⑮ を見た(idealSeen)・終わった(finish)あとは出さない
    expect(coachCandidates({ topTab: "community", done: doneWith("join", "arriveCommunity", "adoptAverage") })).toEqual(["goCompare"]);
    expect(coachCandidates({ topTab: "community", done: doneWith("join", "arriveCommunity", "adoptAverage", "goCompare") })).toEqual([]);
    expect(coachCandidates({ topTab: "community", done: doneWith("join", "arriveCommunity", "adoptAverage", "idealSeen") })).toEqual([]);
    expect(coachCandidates({ topTab: "community", done: doneWith("join", "arriveCommunity", "adoptAverage", "finish") })).toEqual([]);
    expect(coachCandidates({ topTab: "community", done: doneWith("arriveCommunity") })).toEqual([]);   // 参加していなければ何も(参加の画面が出る)
  });
});

describe("済んだ印(立てるだけ・戻さない)", () => {
  it("立てると true になり、既に立っていれば同じ物を返す(書き込みを起こさない)", () => {
    const a = markOnboardingDone({}, "reeds");
    expect(a).toEqual({ reeds: true });
    expect(markOnboardingDone(a, "reeds")).toBe(a);
    expect(markOnboardingDone(a, "measure")).toEqual({ reeds: true, measure: true });
  });
  it("知らない名前(外した openPerson を含む)では何もしない / 壊れた保存値でも立てられる", () => {
    const a = { reeds: true };
    expect(markOnboardingDone(a, "bogus")).toBe(a);
    expect(markOnboardingDone(a, "openPerson")).toBe(a);
    expect(markOnboardingDone(null, "join")).toEqual({ join: true });
  });
  it("読む形は true だけが「済み」。前の版で保存された openPerson は読み捨てる", () => {
    const n = normalizeOnboardingDone({ measure: true, reeds: "true", join: 1, openPerson: true, migrated: true, tuner: true, dataSeen: "yes",
      goData: true, trend: "true", migratedCoach2: true });
    // 【便BS】tuner / metronome / dataSeen と、計測タブの3段の移行の印(migratedMeasureSteps)が加わった
    // 【便BW】新しい9つの印と、3つ目の門の印(migratedCoach2)が加わった
    // 【便BX】新しい6つの印と、4つ目の門の印(migratedCoach3)が加わった
    expect(n).toEqual({ measure: true, reeds: false, reedsMeasure: false, join: false, adoptAverage: false,
      tuner: true, metronome: false, dataSeen: false,
      metroTempo: false, metroStart: false, goReeds: false, reedLinked: false, goData: true, calendarDay: false, daySession: false, trend: false, idealSeen: false,
      arriveReeds: false, arriveData: false, arriveCommunity: false, goCommunity: false, goMeasure: false, finish: false,
      goCompare: false,   // 【便BZ】目安と比べてみよう
      migrated: true, migratedMeasureSteps: false, migratedCoach2: true, migratedCoach3: false, migratedCoach4: false });
    // 【便BZ】5つ目の門の印も true だけが「済み」
    expect(normalizeOnboardingDone({ migratedCoach4: true, goCompare: "true" })).toMatchObject({ migratedCoach4: true, goCompare: false });
    expect(normalizeOnboardingDone({ migratedCoach3: true, finish: true, goMeasure: "true" })).toMatchObject({ migratedCoach3: true, finish: true, goMeasure: false });
    expect(ONBOARDING_FLAGS).toEqual(["measure", "reeds", "reedsMeasure", "join", "adoptAverage", "tuner", "metronome", "dataSeen",
      "metroTempo", "metroStart", "goReeds", "reedLinked", "goData", "calendarDay", "daySession", "trend", "idealSeen",
      "arriveReeds", "arriveData", "arriveCommunity", "goCommunity", "goMeasure", "finish", "goCompare"]);
    expect(MEASURE_STEPS_MIGRATED).toBe("migratedMeasureSteps");
    expect(COACH4_MIGRATED).toBe("migratedCoach4");
    expect(markOnboardingDone({}, "migratedCoach4")).toEqual({});   // 【便BZ】5つ目の門も印の表の外
    expect(markOnboardingDone({}, "goCompare")).toEqual({ goCompare: true });
    expect(COACH2_MIGRATED).toBe("migratedCoach2");
    expect(COACH3_MIGRATED).toBe("migratedCoach3");
    expect(markOnboardingDone({}, "migratedCoach3")).toEqual({});   // 【便BX】4つ目の門も印の表の外
    // 新しい印も立てられる(表に載っている)
    expect(markOnboardingDone({}, "idealSeen")).toEqual({ idealSeen: true });
    expect(markOnboardingDone({}, "migratedCoach2")).toEqual({});   // 門の印は印の表の外(立てられない)
  });
  // 【便BW】保存されたら計測タブの章を閉じる(計測したことがある人に初めての人向けの案内を出さない)
  it("【便BW】計測が保存されたときの印: 計測タブの章の7つ。リードを紐づけていれば「このリードで計測」も", () => {
    const CHAPTER = ["measure", "tuner", "metronome", "metroTempo", "metroStart", "goReeds", "reedLinked"];
    expect([...MEASURE_CHAPTER_FLAGS]).toEqual(CHAPTER);
    expect(onboardingFlagsForSavedSession({ id: "s", reedId: null })).toEqual(CHAPTER);
    expect(onboardingFlagsForSavedSession({ id: "s", reedId: "r1" })).toEqual([...CHAPTER, "reedsMeasure"]);
    // goData とデータタブの段は立てない(保存のあとに ⑩ → ⑫ が続く)
    for (const f of ["goData", "calendarDay", "daySession", "trend", "idealSeen", "dataSeen"]) {
      expect(onboardingFlagsForSavedSession({ id: "s", reedId: "r1" }).includes(f), f).toBe(false);
    }
  });
});

describe("既にある人の移行(migrateOnboardingDone)", () => {
  const adopted = (p) => p?.sourceKind === "community";
  // 【便BW】門の印3つ(どの移行の結果にも付く)。【便BX】4つ目の門(migratedCoach3)も。【便BZ】5つ目の門(migratedCoach4)も
  const GATES = { migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true };
  // 【便BZ】計測が1件でもある人・idealSeen が立つ人に立てる新しい1つ
  const NEW1 = { goCompare: true };
  // 【便BX】計測が1件でもある人に立てる新しい6つ
  const NEW6 = { arriveReeds: true, arriveData: true, arriveCommunity: true, goCommunity: true, goMeasure: true, finish: true };
  // 【便BW】計測が1件でもある人に立てる新しい8つ
  // 【便BW 審査】計測がある人には idealSeen も(本人裁定「既存の利用者には新しい段0枚」)。名前は前のまま
  const NEW8 = { metroTempo: true, metroStart: true, goReeds: true, reedLinked: true, goData: true, calendarDay: true, daySession: true, trend: true, idealSeen: true };
  it("計測・リード・リードの紐づいた計測・みんなの平均の目安があれば、その分を済みにする(openPerson は立てない)", () => {
    const r = migrateOnboardingDone({}, {
      sessions: [{ id: "s1", reedId: null }, { id: "s2", reedId: "r1" }],
      reeds: [{ id: "r1" }],
      idealProfiles: [{ id: "p1", sourceKind: "session" }, { id: "p2", sourceKind: "community", name: "しろねこ さんの目安" },
        { id: "p3", sourceKind: "community", name: "みんなの平均（クラシック 学生）" }],
      isAdopted: adopted,
    });
    // 【便BS】計測があるので計測タブの3段(tuner・metronome・measure)も済み。dataSeen は立てない
    // 【便BW】計測があるので新しい8つも済み。みんなの平均の目安があるので idealSeen も
    // 【便BX】計測があるので新しい6つも済み
    expect(r).toEqual({ measure: true, reeds: true, reedsMeasure: true, adoptAverage: true, tuner: true, metronome: true, ...NEW8, idealSeen: true, ...NEW6, ...NEW1, ...GATES });
  });
  it("人物の目安だけなら何も立てない / 自分の計測から作った目安が「みんなの平均」という名前でも取り込み扱いにしない", () => {
    // 【便BS】どの移行の結果にも、計測タブの3段の移行の印(migratedMeasureSteps)が付く。【便BW】3つ目の門(migratedCoach2)も
    expect(migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "community", name: "しろねこ さんの目安" }], isAdopted: adopted }))
      .toEqual(GATES);
    expect(migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "session", name: "みんなの平均" }], isAdopted: adopted }))
      .toEqual(GATES);
    // 【便BX】便BW の門で idealSeen が立った人には goMeasure(「計測タブに戻ろう」を出さない)
    expect(migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "community", name: "みんなの平均" }], isAdopted: adopted }))
      .toEqual({ adoptAverage: true, idealSeen: true, goMeasure: true, ...NEW1, ...GATES });   // 【便BZ】idealSeen が立つ人には goCompare も
  });
  it("何も無い人は門の印だけ(参加は決めない・新しい段は全部まだ)", () => {
    expect(migrateOnboardingDone({}, { sessions: [], reeds: [], idealProfiles: [], isAdopted: adopted })).toEqual(GATES);
  });
  it("一度移行したら二度と数えない(データを消しても印は戻らない・立っている印を倒さない)", () => {
    const prev = { measure: true, reeds: true, join: true, ...GATES };
    expect(migrateOnboardingDone(prev, { sessions: [{ id: "s1" }], reeds: [], idealProfiles: [], isAdopted: adopted })).toBe(prev);
    // 【便BX】参加している人には arriveCommunity・goCommunity
    expect(migrateOnboardingDone({ join: true }, { sessions: [], reeds: [], idealProfiles: [], isAdopted: adopted })).toEqual({ join: true, arriveCommunity: true, goCommunity: true, ...GATES });
  });
  // 【便BS 2026-10-03 本人裁定】便BP の移行を済ませた人(配信済み。migrated だけを持つ)にも、計測タブの3段の移行を1回だけ当てる
  it("便BP の移行を済ませた人: 計測があれば tuner・metronome・measure を済みにする(便BP の移行はやり直さない・dataSeen は立てない)", () => {
    const old = { migrated: true };
    const r = migrateOnboardingDone(old, { sessions: [{ id: "s1", reedId: "r1" }], reeds: [{ id: "r1" }], idealProfiles: [], isAdopted: adopted });
    // reeds / reedsMeasure は便BP の移行の分なので、ここでは立てない(やり直さない)。【便BW】新しい8つは立つ
    expect(r).toEqual({ measure: true, tuner: true, metronome: true, ...NEW8, ...NEW6, ...NEW1, ...GATES });
    // 計測が無ければ印だけ(段は出る)
    expect(migrateOnboardingDone({ migrated: true }, { sessions: [] })).toEqual(GATES);
    // 2回目は何もしない(同じ物を返す)
    expect(migrateOnboardingDone(r, { sessions: [] })).toBe(r);
  });
  // 【便BW 2026-10-06 本人裁定(§14 の 2 = 既定 ア)】3つ目の門。便BS の移行を済ませた人(配信済み)にも1回だけ当てる
  describe("【便BW】3つ目の門(migratedCoach2)", () => {
    const BS = { migrated: true, migratedMeasureSteps: true };
    it("計測がある人: 新しい8つを立てる・dataSeen は立てない・既存の印は倒さない(新しい段は1つも出ない)", () => {
      const r = migrateOnboardingDone({ ...BS, measure: true, tuner: true }, { sessions: [{ id: "s1" }] });
      expect(r).toEqual({ ...BS, measure: true, tuner: true, metronome: true, ...NEW8, migratedCoach2: true, ...NEW6, migratedCoach3: true, ...NEW1, migratedCoach4: true });
      expect(r.dataSeen).toBeUndefined();
      // 計測があれば、計測タブ・データタブのどの段も出ない
      const d = normalizeOnboardingDone(r);
      expect(coachCandidates({ topTab: "measure", done: d, micReady: true, hasSessions: true, hasSelectedReed: true })).toEqual([]);
      expect(coachCandidates({ topTab: "measure", done: d, micReady: true, hasSessions: true, metroPanelOpen: true })).toEqual([]);
      expect(coachCandidates({ topTab: "analysis", done: d, hasSessions: true })).toEqual([]);
    });
    it("リードはあるが計測が無い人: goReeds だけ(reeds は便BP の門で立つ)。計測タブは ① から", () => {
      const r = migrateOnboardingDone({}, { sessions: [], reeds: [{ id: "r1" }] });
      expect(r).toEqual({ reeds: true, goReeds: true, arriveReeds: true, ...GATES });   // 【便BX】リードがあれば arriveReeds
      expect(coachCandidates({ topTab: "measure", done: normalizeOnboardingDone(r), micReady: true })).toEqual(["tuner"]);
    });
    it("前の版で dataSeen を押した人: データタブの3段を済みに / みんなの平均を取り込んである人(adoptAverage): idealSeen", () => {
      expect(migrateOnboardingDone({ ...BS, dataSeen: true }, { sessions: [] }))
        .toEqual({ ...BS, dataSeen: true, calendarDay: true, daySession: true, trend: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true });
      expect(migrateOnboardingDone({ ...BS, adoptAverage: true }, { sessions: [] }))
        .toEqual({ ...BS, adoptAverage: true, idealSeen: true, migratedCoach2: true, goMeasure: true, migratedCoach3: true, ...NEW1, migratedCoach4: true });   // 【便BX】goMeasure・【便BZ】goCompare
    });
    // 【便BX】門は4つになった(GATES に migratedCoach3 が入っている)。【便BZ】5つ(migratedCoach4)
    it("5つの門が全部立っていれば同じ物を返す(書き込みを起こさない)。2つだけなら新しい門を1回走らせる", () => {
      const all = { ...GATES, measure: true };
      expect(migrateOnboardingDone(all, { sessions: [{ id: "s1" }] })).toBe(all);
      const two = { ...BS };
      const r = migrateOnboardingDone(two, { sessions: [] });
      expect(r).not.toBe(two);
      expect(r).toEqual(GATES);
    });
    it("便BS の移行の結果は変わらない(計測があれば tuner・metronome・measure。LEGACY の3つ)", () => {
      const r = migrateOnboardingDone({ migrated: true, migratedCoach2: true }, { sessions: [{ id: "s1" }] });
      // 【便BX】4つ目の門も1回走る(計測があるので新しい6つ)
      expect(r).toEqual({ migrated: true, migratedCoach2: true, migratedMeasureSteps: true, measure: true, tuner: true, metronome: true, ...NEW6, migratedCoach3: true, ...NEW1, migratedCoach4: true });
    });
  });
});

describe("穴とカードの位置", () => {
  it("穴: 円は的の中心に長い辺 + pad×2 / ピル・角丸は的の矩形 + pad", () => {
    expect(holeOf({ left: 153.5, top: 616, width: 68, height: 68 }, { pad: 14, shape: "circle" }))
      .toEqual({ left: 139.5, top: 602, width: 96, height: 96, shape: "circle" });
    expect(holeOf({ left: 14, top: 283, width: 347, height: 44 }, { pad: 0, shape: "pill" }))
      .toEqual({ left: 14, top: 283, width: 347, height: 44, shape: "pill" });
  });
  // 【便BQ 2026-10-03 本人指示「案内のポップアップは全て画面中央に出すようにして」】
  it("カードは見える範囲(画面の上端 〜 下部タブの上端)の縦の中央", () => {
    const rec = { left: 139.5, top: 602, width: 96, height: 96 };   // 計測(375×812・下部タブの上端 765)
    const a = placeCoachCard({ hole: rec, cardH: 146, vh: 812, bottomLimit: 765 });
    expect(a.top).toBe((765 - 146) / 2);
    expect(a.side).toBe("center");
    expect(a.shifted).toBe(false);
    // 375×667(下部タブの上端 620)
    const b = placeCoachCard({ hole: { left: 139.5, top: 457, width: 96, height: 96 }, cardH: 146, vh: 667, bottomLimit: 620 });
    expect(b.top).toBe((620 - 146) / 2);
  });
  it("中央のカードが的(穴)の上下 22px にかかるときだけ、上か下の中央に近いほうへずらす", () => {
    // 参加前(的 283〜327): 中央 309.5 は的にかかる → 下(327 + 22 = 349)が中央に近い
    const join = placeCoachCard({ hole: { left: 14, top: 283, width: 347, height: 44 }, cardH: 146, vh: 812, bottomLimit: 765 });
    expect(join.top).toBe(283 + 44 + 22);
    expect(join.side).toBe("below");
    expect(join.shifted).toBe(true);
    // みんなの平均(108〜422): 上には入らない → 下(444)
    const avg = placeCoachCard({ hole: { left: 14, top: 108, width: 347, height: 314 }, cardH: 146, vh: 812, bottomLimit: 765 });
    expect(avg.top).toBe(422 + 22);
    // 的が中央より下なら上へ(中央に近いほう)
    const low = placeCoachCard({ hole: { left: 14, top: 400, width: 347, height: 40 }, cardH: 146, vh: 812, bottomLimit: 765 });
    expect(low.top).toBe(400 - 22 - 146);
    expect(low.side).toBe("above");
  });
  // 【便BZ 2026-10-07 本人の実機の指摘】上にも下にも収まらないときは、中央ではなく的(穴)との重なりが最小の位置(見える範囲の上端か下端)
  it("【便BZ】上にも下にも収まらないときは、重なりが最小の端(上 gap / 下 = 下端 − gap − カード)。中央には置かない", () => {
    // 実機(iPhone 393×852・本物の広告)のスクショから読んだ値: 環の箱 161〜490・見える範囲の下端 703(カードの中央置き 264 から逆算)・カード 175(便BX の高さ)。
    // 上(161 − 22 − 175 < 22)にも下(490 + 22 + 175 = 687 > 703 − 22)にも収まらない。以前は中央 264 = 264〜439 で、環の真ん中(音名・セント)に重なった
    const ring = placeCoachCard({ hole: { left: 14, top: 161, width: 365, height: 329 }, cardH: 175, vh: 852, bottomLimit: 703 });
    expect(ring.top).toBe(506);                 // 703 − 22 − 175。穴の下端 490 より下なので重なり 0
    expect(ring.side).toBe("below");
    expect(ring.shifted).toBe(true);
    expect(ring.overlaps).toBe(false);
    // 大きな的(100〜660): 上の端 22 は 68 重なる・下の端 597 は 63 重なる → 下。重なりが残るので overlaps
    const big = placeCoachCard({ hole: { left: 14, top: 100, width: 347, height: 560 }, cardH: 146, vh: 812, bottomLimit: 765 });
    expect(big.top).toBe(597);
    expect(big.side).toBe("below");
    expect(big.overlaps).toBe(true);
    // 的が高い所(40〜620): 上の端 22 は 128 重なる・下の端 597 は 23 重なる → 下
    expect(placeCoachCard({ hole: { left: 14, top: 40, width: 347, height: 580 }, cardH: 146, vh: 812, bottomLimit: 765 }).top).toBe(597);
    // 的が低い所(150〜700): 上の端 22 は 18 重なる・下の端 597 は 103 重なる → 上
    const up = placeCoachCard({ hole: { left: 14, top: 150, width: 347, height: 550 }, cardH: 146, vh: 812, bottomLimit: 765 });
    expect(up.top).toBe(22);
    expect(up.side).toBe("above");
    // 両端とも重ならない(180〜585)ときは中央に近いほう(同じ距離なら上)
    expect(placeCoachCard({ hole: { left: 14, top: 180, width: 347, height: 405 }, cardH: 146, vh: 812, bottomLimit: 765 }).top).toBe(22);
  });
  it("カードが見える範囲より高く置ける所が無いときだけ中央のまま(重なりを返す)", () => {
    const tall = placeCoachCard({ hole: { left: 14, top: 100, width: 347, height: 560 }, cardH: 730, vh: 812, bottomLimit: 765 });
    expect(tall.top).toBe((765 - 730) / 2);
    expect(tall.side).toBe("center");
    expect(tall.overlaps).toBe(true);
  });
  // 【便BZ】⑭⑮ の的へ送るかの判定と送り方(見える範囲 = 上端 0 〜 下部タブ・広告の帯の上端)
  it("【便BZ】coachScrollPlan: 見える範囲に収まっていれば送らない / 帯・下部タブの裏に隠れていれば送る(中央・高ければ上端)", () => {
    const R = (top, height) => ({ left: 14, top, width: 347, height });
    // 実機(393×852・広告あり)の再現: 音の傾向カード 614.6〜759.6・見える範囲の下端 713 → 画面の中だが 46.6 隠れている → 送る
    expect(coachScrollPlan(R(614.6, 145), 852, 713)).toEqual({ block: "center", marginBottom: 139 });
    // 収まっている(555.6〜700.6 ≦ 707)→ 送らない
    expect(coachScrollPlan(R(555.6, 145), 812, 707)).toBe(null);
    // 下端ちょうど(562〜707)も収まっている
    expect(coachScrollPlan(R(562, 145), 812, 707)).toBe(null);
    // 画面の外(下)・上にはみ出し → 送る
    expect(coachScrollPlan(R(1400, 380), 812, 707)).toEqual({ block: "center", marginBottom: 105 });
    expect(coachScrollPlan(R(-10, 145), 812, 707)).toEqual({ block: "center", marginBottom: 105 });
    // 見える範囲(707)より高い的(720)は上端をそろえる
    expect(coachScrollPlan(R(300, 720), 812, 707)).toEqual({ block: "start", marginBottom: 105 });
    // 大きさ 0(描かれていない)は送らない
    expect(coachScrollPlan(R(900, 0), 812, 707)).toBe(null);
    // 下部タブ・帯が無ければ(bottomLimit = vh)今までの「画面の外なら」と同じ
    expect(coachScrollPlan(R(700, 100), 812, 812)).toBe(null);
    expect(coachScrollPlan(R(750, 100), 812, 812)).toEqual({ block: "center", marginBottom: 0 });
  });
  // 【便BZ】穴にかかる浮かせるボタンの覆い
  it("【便BZ】floatingCovers: 穴にかかる浮かせるボタンだけ覆う(的そのもの・穴にかからないボタンは覆わない)", () => {
    const fab = (top, isTarget = false) => ({ rect: { left: 305, top, width: 56, height: 56 }, radius: "9999px", isTarget });
    const trendHole = { left: 14, top: 555.6, width: 347, height: 145 };
    // 実測(375×812・広告あり・HEAD): 取り込みの丸 305,639,56,56 は音の傾向カードの穴(555.6〜700.6)の中
    // 【便BZ 審査】覆いはボタンと穴が重なる所だけ(clip: 下 56 − (700.6 − 639) = 0 → はみ出しなし / 穴の下端より下が切られる場面は下)
    expect(floatingCovers([fab(639)], [trendHole])).toEqual([{ left: 305, top: 639, width: 56, height: 56, radius: "9999px", clip: "inset(0px 0px 0px 0px)" }]);
    // 穴の下端 700.6 をまたぐボタン(680〜736): 穴の外の 35.4 を切る(二重に暗くしない)
    expect(floatingCovers([fab(680)], [trendHole])[0].clip).toBe("inset(0px 0px 35.4px 0px)");
    expect(floatingCovers([fab(639, true)], [trendHole])).toEqual([]);          // 的そのもの(リードを追加の段など)は押せるまま
    expect(floatingCovers([fab(720)], [trendHole])).toEqual([]);                // 穴の外(暗幕がかかっている)は覆わない
    // 【便BZ 審査】呼び手は1つ目の穴だけを渡す(帯の箱 = 2つ目の穴にかかるボタンは覆わない)。渡した穴にかかれば覆う(純関数の決まり)
    expect(floatingCovers([fab(639)], [null, { left: 14, top: 600, width: 347, height: 68 }])).toHaveLength(1);
    expect(floatingCovers([{ rect: { left: 0, top: 0, width: 0, height: 0 }, radius: "0px", isTarget: false }], [trendHole])).toEqual([]);
  });
  it("的が画面の中にまるごと見えているときだけ出す(大きさ 0・はみ出しは出さない)", () => {
    const r = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
    expect(targetVisible(r(10, 10, 50, 50), 375, 812)).toBe(true);
    expect(targetVisible(r(0, 0, 0, 0), 375, 812)).toBe(false);
    expect(targetVisible(r(10, 790, 50, 50), 375, 812)).toBe(false);
    expect(targetVisible(r(400, 10, 50, 50), 375, 812)).toBe(false);
    expect(targetVisible(r(10, -5, 50, 50), 375, 812)).toBe(false);
    expect(targetVisible(r(-5, 10, 50, 50), 375, 812)).toBe(false);   // 左にはみ出す(R11)
  });
  it("溶ける時間は計算済みの style から読む(0.35s / 350ms / 一括指定)。読めなければ 0", () => {
    expect(leaveDurationMs({ animationDuration: "0.35s" })).toBe(350);
    expect(leaveDurationMs({ animationDuration: "", animation: "coach-out 350ms ease-out forwards" })).toBe(350);
    expect(leaveDurationMs({ animationDuration: "", animation: "" })).toBe(0);
  });
});

// ------------------------------------------------------------------
// 部品。index.css をそのまま読み込み(jsdom は stylesheet の宣言を getComputedStyle に通す)、
// 的の要素の矩形は data-r="left,top,width,height" で決める(jsdom は配置を計算しないので)。
// 下部タブの代わりに [data-bottom-nav](上端 765)を置く(見える範囲の下端)。
// ------------------------------------------------------------------
let root; let host; let realRect; let realMM; let styleEl; let realRaf; let realSetTimeout;
let cardH = 146; let rafCalls = 0; let pollCalls = 0;
const W = 375; const H = 812; const NAV_TOP = 765;
const CENTER = (NAV_TOP - 146) / 2;   // 309.5
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  styleEl = document.createElement("style");
  styleEl.textContent = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
  document.head.appendChild(styleEl);
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    const box = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
    if (this.classList?.contains("coach-card")) return box(22, parseFloat(this.style?.top) || 0, W - 44, cardH);
    const d = this.getAttribute?.("data-r");
    if (d) { const [l, t, w, h] = d.split(",").map(Number); return box(l, t, w, h); }
    return box(0, 0, 0, 0);
  };
  realMM = window.matchMedia;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  cardH = 146; rafCalls = 0; pollCalls = 0;
  realRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = (fn) => { rafCalls += 1; return realRaf.call(window, fn); };
  realSetTimeout = window.setTimeout;
  window.setTimeout = (fn, ms, ...a) => { if (ms === 250) pollCalls += 1; return realSetTimeout.call(window, fn, ms, ...a); };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  styleEl.remove();
  document.body.innerHTML = "";
  window.Element.prototype.getBoundingClientRect = realRect;
  window.matchMedia = realMM;
  window.requestAnimationFrame = realRaf;
  window.setTimeout = realSetTimeout;
});

const frames = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const layer = () => document.querySelector("[data-coach-layer]");
const live = () => document.querySelector("[data-coach-live]");
const Nav = () => <div data-bottom-nav="" data-r={`0,${NAV_TOP},375,47`} />;
function Target({ name = "measure", r = "153.5,616,68,68", onClick }) {
  return <button type="button" data-coach={name} data-r={r} onClick={onClick}>的</button>;
}
async function draw({ candidates = ["measure"], done = ALL_FALSE, hidden = false, target = <Target /> } = {}) {
  await act(async () => {
    root.render(<><Nav />{target}<OnboardingCoach candidates={candidates} done={done} hidden={hidden} /></>);
  });
  await frames();
}
const redraw = (target, { candidates = ["measure"], done = ALL_FALSE, hidden = false } = {}) => act(async () => {
  root.render(<><Nav />{target}<OnboardingCoach candidates={candidates} done={done} hidden={hidden} /></>);
});
// 押下の流れ(pointerdown → pointerup → click)を、その点にある要素へ送る(jsdom は当たり判定を持たないので、どの要素が
// 一番上かは呼び手が渡す)。
const clickOn = (el) => act(async () => { el.click(); });

describe("OnboardingCoach(出る・出ない)", () => {
  it("出る: 穴は的の矩形 + pad、カードは見える範囲の中央。読み上げは常に在る role=status・フォーカスは奪わない", async () => {
    const before = document.activeElement;
    await draw();
    const L = layer();
    expect(L.getAttribute("data-coach-layer")).toBe("measure");
    const hole = L.querySelector(".coach-hole");
    expect([hole.style.left, hole.style.top, hole.style.width, hole.style.height]).toEqual(["139.5px", "602px", "96px", "96px"]);
    expect(hole.getAttribute("aria-hidden")).toBe("true");
    const card = L.querySelector(".coach-card");
    expect(card.getAttribute("aria-hidden")).toBe("true");
    expect(parseFloat(card.style.top)).toBe(CENTER);
    expect(card.getAttribute("data-coach-side")).toBe("center");
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(live().textContent).toBe("最初の計測を記録しよう。ボタンタップで計測スタート");
    expect(card.querySelector(".coach-title").textContent).toBe("最初の計測を記録しよう");
    expect(card.querySelector(".coach-line").textContent).toBe("ボタンタップで計測スタート");
    expect(document.activeElement).toBe(before);
    expect(Number(L.style.zIndex)).toBe(55);
    expect(L.parentElement).toBe(document.body);
  });
  it("リード2は見出しだけ(1行を描かない・読み上げも見出しだけ)", async () => {
    await draw({ candidates: ["reedsMeasure"], target: <button type="button" data-coach="reedsMeasure" data-r="14,170,59,59">1</button> });
    const card = layer().querySelector(".coach-card");
    expect(card.querySelector(".coach-title").textContent).toBe("このリードで計測してみよう");
    expect(card.querySelector(".coach-line")).toBe(null);
    expect(live().textContent).toBe("このリードで計測してみよう");
  });
  it("出ない: hidden / 候補が空 / 的が無い / 左にはみ出した的(R11)", async () => {
    await draw({ hidden: true });
    expect(layer()).toBe(null);
    await draw({ candidates: [] });
    expect(layer()).toBe(null);
    await draw({ candidates: ["adoptAverage"], target: <Target name="somethingElse" /> });
    expect(layer()).toBe(null);
    await draw({ target: <Target r="-4,616,68,68" /> });
    expect(layer()).toBe(null);
  });
  it("的が画面の外なら出さず、スクロールで戻れば出る(探し直しは 250ms ごと)", async () => {
    await draw({ target: <Target r="153.5,900,68,68" /> });
    expect(layer()).toBe(null);
    await act(async () => { document.querySelector('[data-coach="measure"]').setAttribute("data-r", "153.5,616,68,68"); });
    await frames(320);
    expect(layer()?.getAttribute("data-coach-layer")).toBe("measure");
  });
  it("追従: 的が動けば穴も動く(rAF)。カードは中央のまま", async () => {
    await draw();
    await act(async () => { document.querySelector('[data-coach="measure"]').setAttribute("data-r", "153.5,700,68,68"); });
    await frames();
    expect(layer().querySelector(".coach-hole").style.top).toBe("686px");
    expect(parseFloat(layer().querySelector(".coach-card").style.top)).toBe(CENTER);
  });
  // 【便BS】参加前の段は外したので、同じ位置(283〜327)の的を平均カードの段で置き直した(ずらす決まりは同じ)
  it("中央のカードが的にかかる場面だけ、的の下へずらす", async () => {
    await draw({ candidates: ["adoptAverage"], target: <Target name="adoptAverage" r="14,283,347,44" /> });
    const card = layer().querySelector(".coach-card");
    expect(parseFloat(card.style.top)).toBe(283 + 44 + 22);
    expect(card.getAttribute("data-coach-side")).toBe("below");
  });
  it("測る前(カードの高さが 0 の間)はカードを見せない(R10)", async () => {
    cardH = 0;
    await draw();
    expect(layer().querySelector(".coach-card").style.visibility).toBe("hidden");
    cardH = 146;
    await frames();
    expect(layer().querySelector(".coach-card").style.visibility).toBe("visible");
  });
  it("表に出ている間に hidden になったら・候補から外れたら、溶かさずに即座に消える", async () => {
    await draw();
    await redraw(<Target />, { hidden: true });
    expect(layer()).toBe(null);
    await draw();
    await redraw(<Target />, { candidates: [] });
    await frames(30);
    expect(layer()).toBe(null);
  });
  it("タブを切り替えた描画のうちに測り直す(古い案内を1フレームも残さない)", async () => {
    const both = <><Target /><span data-coach="nav-measure" data-r="20,760,83.75,44"><svg data-r="46.88,767,30,30" /></span></>;
    await draw({ target: both });
    await redraw(both, { candidates: ["data"] });
    expect(layer()?.getAttribute("data-coach-layer")).toBe("data");
  });
});

// ------------------------------------------------------------------
// 【便BQ 2026-10-03 本人の実機指示「他のところタップで案内は消えるようにして」】
// ------------------------------------------------------------------
describe("外を押したら消える / 穴は下へ通す", () => {
  it("穴の外側は透明な受け4枚(上・下・左・右)が覆い、穴の上には何も無い。穴の見た目(影)はタップを通す", async () => {
    await draw();
    const hits = [...layer().querySelectorAll(".coach-hit")];
    expect(hits.map((h) => h.getAttribute("data-coach-hit"))).toEqual(["t", "b", "l", "r"]);
    const px = (h, k) => parseFloat(h.style[k]);
    const [t, b, l, r] = hits;
    // 穴(139.5, 602, 96, 96)の外側をちょうど覆う
    expect([px(t, "top"), px(t, "height")]).toEqual([0, 602]);
    expect([px(b, "top"), px(b, "height")]).toEqual([698, 812 - 698]);
    expect([px(l, "left"), px(l, "width"), px(l, "top"), px(l, "height")]).toEqual([0, 139.5, 602, 96]);
    expect([px(r, "left"), px(r, "width"), px(r, "top"), px(r, "height")]).toEqual([235.5, 375 - 235.5, 602, 96]);
    for (const h of hits) expect(getComputedStyle(h).pointerEvents).toBe("auto");
    expect(getComputedStyle(layer()).pointerEvents).toBe("none");
    expect(getComputedStyle(layer().querySelector(".coach-hole")).pointerEvents).toBe("none");
    expect(getComputedStyle(layer().querySelector(".coach-card")).pointerEvents).toBe("auto");
  });
  it("外(受け)を押すと案内が消える。その1回は下の部品に届かない(受けが取る)。印は立てない", async () => {
    let under = 0;
    let bubbled = 0;
    const page = <><Target /><button type="button" data-r="22,100,331,40" onClick={() => { under += 1; }}>下の部品</button></>;
    await draw({ target: <div onClick={() => { bubbled += 1; }}>{page}</div> });
    expect(layer()).not.toBe(null);
    // 下の部品(100〜140)の上は受け「上」(0〜602)が覆っている。押下は受けに当たる
    await clickOn(layer().querySelector('[data-coach-hit="t"]'));
    expect(layer()).toBe(null);
    expect(under).toBe(0);
    expect(bubbled).toBe(0);
    expect(live().textContent).toBe("");   // 読み上げも下ろす
  });
  it("カードを押しても消える(外を押したのと同じ)", async () => {
    await draw();
    await clickOn(layer().querySelector(".coach-card"));
    expect(layer()).toBe(null);
  });
  it("穴(的)を押せば、下の的に届いて一手が起きる(案内は消さない ── 消えるのは一手が済んだとき)", async () => {
    let clicked = 0;
    await draw({ target: <Target onClick={() => { clicked += 1; }} /> });
    // 穴の上には案内の要素が無いので、押下は的そのものに届く
    const covering = [...layer().querySelectorAll(".coach-hit, .coach-card")].filter((el) => {
      const s = el.style; const l = parseFloat(s.left) || 22; const t = parseFloat(s.top) || 0;
      const w = parseFloat(s.width) || (375 - 44); const h = parseFloat(s.height) || 146;
      const cx = 153.5 + 34; const cy = 616 + 34;
      return cx >= l && cx <= l + w && cy >= t && cy <= t + h;
    });
    expect(covering).toEqual([]);
    await clickOn(document.querySelector('[data-coach="measure"]'));
    expect(clicked).toBe(1);
    expect(layer()).not.toBe(null);
  });
  it("同じ起動の中では、一度消した一手はタブを行き来しても出さない。ほかの一手は出る", async () => {
    const both = <><Target /><span data-coach="nav-measure" data-r="20,760,83.75,44"><svg data-r="46.88,767,30,30" /></span></>;
    await draw({ target: both });
    await clickOn(layer().querySelector('[data-coach-hit="t"]'));
    expect(layer()).toBe(null);
    await redraw(both, { candidates: ["data"] });     // データタブへ
    expect(layer()?.getAttribute("data-coach-layer")).toBe("data");
    await redraw(both, { candidates: ["measure"] });  // 計測タブへ戻る
    await frames(320);
    expect(layer()).toBe(null);
  });
  it("次の起動(部品を作り直す)では、まだ済んでいなければまた出る", async () => {
    await draw();
    await clickOn(layer().querySelector('[data-coach-hit="b"]'));
    expect(layer()).toBe(null);
    act(() => root.unmount());
    root = createRoot(host);
    await draw();
    expect(layer()?.getAttribute("data-coach-layer")).toBe("measure");
  });
  it("溶けている間は受けもカードも押させない(済んだ一手の受けが次の押下を飲み込まない)", async () => {
    await draw();
    await redraw(<Target />, { candidates: [], done: doneWith("measure") });
    expect(layer()?.getAttribute("data-leaving")).toBe("true");
    expect(getComputedStyle(layer().querySelector(".coach-hit")).pointerEvents).toBe("none");
    expect(getComputedStyle(layer().querySelector(".coach-card")).pointerEvents).toBe("none");
  });
});

describe("OnboardingCoach(追従の止め方・読み上げ)", () => {
  it("候補が無く、出しているものも無い間は何も走らせない(rAF も 250ms の時計も無い)", async () => {
    await draw({ candidates: [] });
    rafCalls = 0; pollCalls = 0;
    await frames(600);
    expect(rafCalls).toBe(0);
    expect(pollCalls).toBe(0);
  });
  it("候補はあるが的が無い間は rAF を回さず、250ms ごとに探す。的が現れたら出して rAF で追う", async () => {
    await draw({ target: null });
    rafCalls = 0; pollCalls = 0;
    await frames(600);
    expect(layer()).toBe(null);
    expect(rafCalls).toBe(0);
    expect(pollCalls).toBeGreaterThanOrEqual(2);
    await redraw(<Target />);
    await frames(320);
    expect(layer()?.getAttribute("data-coach-layer")).toBe("measure");
    expect(rafCalls).toBeGreaterThan(0);
  });
  it("読み上げの入れ物は常に1つ。文は一手が変わったときと済んだときだけ変わる(隠れてまた出ても読み直さない)", async () => {
    await draw({ hidden: true });
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(live().textContent).toBe("");
    const el = live();
    let changes = 0;
    const mo = new MutationObserver((ms) => { changes += ms.length; });
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    await redraw(<Target />); await frames();
    expect(el.textContent).toBe("最初の計測を記録しよう。ボタンタップで計測スタート");
    const afterFirst = changes;
    await redraw(<Target />, { hidden: true }); await frames();
    await redraw(<Target />); await frames();
    expect(layer()).not.toBe(null);
    expect(changes).toBe(afterFirst);
    await redraw(<Target />, { candidates: [], done: doneWith("measure") });
    await act(async () => { layer().dispatchEvent(new Event("animationend", { bubbles: true })); });
    await frames();
    expect(el.textContent).toBe("");
    mo.disconnect();
  });
});

describe("リード2(2つの画面をまたぐ同じ一手)", () => {
  it("一覧のタイル(四角・角丸 --r-2)→ 詳細の計測ボタン(data-coach-shape=circle で丸)へ的が移る。文は同じ", async () => {
    await draw({ candidates: ["reedsMeasure"], target: <button key="tile" type="button" className="reedtile" data-coach="reedsMeasure" data-r="14,170,59,59">1</button> });
    let hole = layer().querySelector(".coach-hole");
    expect([hole.style.left, hole.style.top, hole.style.width, hole.style.height, hole.style.borderRadius]).toEqual(["10px", "166px", "67px", "67px", "var(--r-2)"]);
    await act(async () => {
      root.render(<><Nav /><button key="fab" type="button" data-coach="reedsMeasure" data-coach-shape="circle" data-r="305,697,56,56">計測</button>
        <OnboardingCoach candidates={["reedsMeasure"]} done={ALL_FALSE} hidden={false} /></>);
    });
    await frames();
    expect(layer()?.getAttribute("data-leaving")).toBe("false");
    hole = layer().querySelector(".coach-hole");
    expect([hole.style.left, hole.style.top, hole.style.width, hole.style.height, hole.style.borderRadius]).toEqual(["301px", "693px", "64px", "64px", "50%"]);
    expect(parseFloat(layer().querySelector(".coach-card").style.top)).toBe(CENTER);
  });
});

describe("OnboardingCoach(済んだら溶ける / reduced-motion)", () => {
  it("一手が済むと data-leaving で 0.35 秒の溶けに入り、animationend で消える", async () => {
    await draw();
    await redraw(<Target />, { candidates: [], done: doneWith("measure") });
    const L = layer();
    expect(L.getAttribute("data-leaving")).toBe("true");
    expect(getComputedStyle(L).animation).toBe("coach-out 350ms ease-out forwards");
    await act(async () => { L.dispatchEvent(new Event("animationend", { bubbles: true })); });
    expect(layer()).toBe(null);
  });
  it("animationend が来なくても、CSS の時間(350ms)が経てば消える", async () => {
    await draw();
    await redraw(<Target />, { candidates: [], done: doneWith("measure") });
    await frames(200);
    expect(layer()).not.toBe(null);
    await frames(260);
    expect(layer()).toBe(null);
  });
  it("prefers-reduced-motion では溶けもしない(済んだ瞬間に消える)", async () => {
    window.matchMedia = (q) => ({ matches: q.includes("prefers-reduced-motion: reduce"), addEventListener() {}, removeEventListener() {} });
    await draw();
    await redraw(<Target />, { candidates: [], done: doneWith("measure") });
    expect(layer()).toBe(null);
    expect(styleEl.textContent).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.coach-layer\[data-leaving="true"\] \{ animation: none; \}\s*\}/);
  });
});

// ------------------------------------------------------------------
// 【便BS 2026-10-03 本人裁定(ficus-tutorial2.html)】メトロノームの的・計測タブの段を一緒に消す・チューナーの「音程が続けて1秒」(useSustained)。
// 【便BW 2026-10-06 凍結仕様 coach2-spec.md】的なしの段(チューナー・dataSeen)は無くなった。① は環の箱の穴(【審査】帯全体から絞った)。
//   新しい段の穴(③ テンポ行・④ 環の箱・⑤ 下部タブ・⑧ リードの枠・⑫ 日のマスの丸・⑬ 記録の行・⑭⑮ 音の傾向カード)、
//   群(計測タブの9段・データタブの3段)、押す=済(⑧⑭⑮)、⑭⑮ の「的へ1回だけスクロール」。
// 期待値は仕様の表(pad / shape)と 375×812 の的の矩形から手で書いた(COACH_STEPS から読まない)。
// ------------------------------------------------------------------
const layerId = () => layer()?.getAttribute("data-coach-layer") ?? null;
const drawBS = (candidates, { done = ALL_FALSE, hidden = false, onMark = null, extra = null } = {}) => act(async () => {
  root.render(<><Nav />{extra}<OnboardingCoach candidates={candidates} done={done} hidden={hidden} onMark={onMark} /></>);
});
const MetroBtn = () => <button type="button" data-coach="metronome" data-r="317,30,44,44">m</button>;
// 375×812 の計測タブの的(環の箱 = 上部設定行の直下 〜 環の下端 / テンポ行 / 左上のリードの枠 / 下部タブの絵柄)
const Band = () => <div data-coach="tuner" data-r="14,96,347,330">環</div>;
const TempoRow = () => <div data-coach="metroTempo" data-r="43.6,470,287.8,57.6">− ♩=120 ＋</div>;
const ReedChip = () => <div data-coach="reedChip" data-r="14,46,190,30">V16 3 #1</div>;
// 【便BZ 統括の裁定】下部タブの的はボタンの箱(375×812・新しい下部タブの実測: 内箱の上端 754 + 6 = 760・高さ 44・1つ 83.75)
const NAV_BTN_X = { measure: 20, reeds: 103.75, community: 187.5, analysis: 271.25 };
const NavSvg = ({ k, x }) => <span data-coach={`nav-${k}`} data-r={`${NAV_BTN_X[k]},760,83.75,44`}><svg data-r={`${x},767,30,30`} /></span>;
const MEASURE_PAGE = <><Band /><MetroBtn /><TempoRow /><ReedChip /><Target /><NavSvg k="reeds" x="130.6" /><NavSvg k="analysis" x="298.1" /></>;
const holeBox = () => { const h = layer().querySelector(".coach-hole"); return [h.style.left, h.style.top, h.style.width, h.style.height, h.style.borderRadius]; };

describe("【便BW】環の箱・メトロノームの的", () => {
  it("① チューナー: 環の箱を穴で照らす(角丸の矩形・pad 0)。画面いっぱいの暗幕(.coach-dim)は無い・受けは4枚。カードは環の下", async () => {
    await drawBS(["tuner"], { extra: <Band /> });
    await frames();
    const L = layer();
    expect(L.getAttribute("data-coach-layer")).toBe("tuner");
    expect(holeBox()).toEqual(["14px", "96px", "347px", "330px", "var(--r-2)"]);
    expect(document.querySelector(".coach-dim")).toBe(null);
    expect([...L.querySelectorAll(".coach-hit")].map((h) => h.getAttribute("data-coach-hit"))).toEqual(["t", "b", "l", "r"]);
    // 中央(309.5)は環にかかる → 上(96 − 22 − 146 < 22)には入らない → 下(426 + 22 = 448)
    const card = L.querySelector(".coach-card");
    expect(parseFloat(card.style.top)).toBe(448);
    expect(card.getAttribute("data-coach-side")).toBe("below");
    expect(card.querySelector(".coach-title").textContent).toBe("まずは吹いてみよう");
    expect(card.querySelector(".coach-line").textContent).toBe("音程がリアルタイムで表示されます");
    expect(live().textContent).toBe("まずは吹いてみよう。音程がリアルタイムで表示されます");
    // アイコンは版の tuner(半円の弧)
    expect(card.querySelector(".coach-icon svg path").getAttribute("d")).toBe("M3 17 A9 9 0 0 1 21 17");
    // 環の箱が無ければ出さない(的なしの道は無い)
    await drawBS(["tuner"]);
    await frames(320);
    expect(layer()).toBe(null);
  });
  it("メトロノーム: 的は右上のアイコン(44 角)。穴は丸で直径 44(pad 0)。文とアイコン(線 1.6)は表のとおり", async () => {
    await drawBS(["metronome"], { extra: <MetroBtn /> });
    await frames();
    expect(layerId()).toBe("metronome");
    expect(holeBox()).toEqual(["317px", "30px", "44px", "44px", "50%"]);
    const card = layer().querySelector(".coach-card");
    expect(card.querySelector(".coach-title").textContent).toBe("メトロノームも使えます");
    expect(card.querySelector(".coach-line").textContent).toBe("テンポを決めて練習できます");
    const svg = card.querySelector(".coach-icon svg");
    expect(svg.getAttribute("stroke-width")).toBe("1.6");
    expect(svg.querySelector("path").getAttribute("d")).toBe("M8 20h8l-2-14h-4z");
    // 穴の上には受けを置かない(的を押せば下のボタンに届く)
    expect([...layer().querySelectorAll(".coach-hit")].map((h) => h.getAttribute("data-coach-hit"))).toEqual(["t", "b", "l", "r"]);
  });
  it("③ テンポ行はピル(pad 6)/ ④ は ① と同じ環の箱の穴 / ⑤ ⑩ は下部タブの絵柄を直径 52 の丸 / ⑧ はリードの枠のピル(pad 6)", async () => {
    await drawBS(["metroTempo"], { extra: MEASURE_PAGE });
    await frames();
    expect(layerId()).toBe("metroTempo");
    expect(holeBox()).toEqual(["37.6px", "464px", "299.8px", "69.6px", "var(--r-full)"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("テンポを決めよう");
    await drawBS(["metroStart"], { extra: MEASURE_PAGE });
    await frames();
    expect(layerId()).toBe("metroStart");
    expect(holeBox()).toEqual(["14px", "96px", "347px", "330px", "var(--r-2)"]);
    await drawBS(["goReeds"], { extra: MEASURE_PAGE });
    await frames();
    expect(layerId()).toBe("goReeds");
    expect(holeBox()).toEqual(["103.75px", "760px", "83.75px", "44px", "var(--r-2)"]);   // 【便BZ】ボタンの箱
    expect(layer().querySelector(".coach-line")).toBe(null);   // 1行なし
    await drawBS(["goData"], { extra: MEASURE_PAGE });
    await frames();
    expect(layerId()).toBe("goData");
    expect(holeBox()).toEqual(["271.25px", "760px", "83.75px", "44px", "var(--r-2)"]);
    await drawBS(["reedLinked"], { extra: MEASURE_PAGE });
    await frames();
    expect(layerId()).toBe("reedLinked");
    expect(holeBox()).toEqual(["8px", "40px", "202px", "42px", "var(--r-full)"]);
    await drawBS(["measureReed"], { extra: MEASURE_PAGE });
    await frames();
    expect(layerId()).toBe("measureReed");
    expect(holeBox()).toEqual(["139.5px", "602px", "96px", "96px", "50%"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("このリードで計測してみよう");
  });
  it("hidden なら出ない。済んだら溶ける(data-leaving)", async () => {
    await drawBS(["tuner"], { hidden: true, extra: <Band /> });
    await frames();
    expect(layer()).toBe(null);
    await drawBS(["tuner"], { extra: <><Band /><MetroBtn /></> });
    await frames();
    expect(layerId()).toBe("tuner");
    await drawBS(["metronome"], { done: doneWith("tuner"), extra: <><Band /><MetroBtn /></> });
    expect(layer().getAttribute("data-leaving")).toBe("true");
    expect(layerId()).toBe("tuner");
  });
});

describe("【便BW】計測タブの段: 外を押したら群の9段とも、この起動の間は出さない(押す=済の ⑧ を除く)", () => {
  for (const [first, how] of [["tuner", "受け"], ["metronome", "受け"], ["metroTempo", "受け"], ["goReeds", "受け"], ["measure", "カード"], ["goData", "受け"]]) {
    it(`${first} の段で${how}を押すと消え、計測タブの9段とも出ない。印は立てない。他のタブの一手は出る`, async () => {
      const marks = [];
      const onMark = (f) => marks.push(f);
      await drawBS([first], { onMark, extra: MEASURE_PAGE });
      await frames();
      expect(layerId()).toBe(first);
      await clickOn(how === "カード" ? layer().querySelector(".coach-card") : layer().querySelector(".coach-hit"));
      expect(layer()).toBe(null);
      for (const id of ["tuner", "metronome", "metroTempo", "metroStart", "goReeds", "reedLinked", "measure", "measureReed", "goData"]) {
        await drawBS([id], { onMark, extra: MEASURE_PAGE });
        await frames(320);
        expect(layer(), id).toBe(null);
      }
      expect(marks).toEqual([]);
      await drawBS(["reeds"], { onMark, extra: <button type="button" data-coach="reeds" data-r="305,697,56,56">+</button> });
      await frames();
      expect(layerId()).toBe("reeds");
    });
  }
  it("次の起動(部品を作り直す)では、まだ済んでいなければまた出る", async () => {
    await drawBS(["tuner"], { extra: <Band /> });
    await frames();
    await clickOn(layer().querySelector(".coach-hit"));
    act(() => root.unmount());
    root = createRoot(host);
    await drawBS(["tuner"], { extra: <Band /> });
    await frames();
    expect(layerId()).toBe("tuner");
  });
  for (const where of ["受け", "カード"]) {
    it(`⑧ リードの枠: ${where}を押すと消えて印 reedLinked を立てる。群は消さないので ⑨ は続けて出る(その1回は下に届かない)`, async () => {
      const marks = [];
      let under = 0;
      await drawBS(["reedLinked"], { onMark: (f) => marks.push(f), extra: <div onClick={() => { under += 1; }}>{MEASURE_PAGE}</div> });
      await frames();
      expect(layer().querySelector(".coach-title").textContent).toBe("選んだリードが紐づいています");
      await clickOn(where === "カード" ? layer().querySelector(".coach-card") : layer().querySelector('[data-coach-hit="b"]'));
      expect(layer()).toBe(null);
      expect(marks).toEqual(["reedLinked"]);
      expect(under).toBe(0);
      await drawBS(["measureReed"], { done: doneWith("reedLinked"), extra: MEASURE_PAGE });
      await frames();
      expect(layerId()).toBe("measureReed");
    });
  }
});

// 375×812 の My Data(累計 → カレンダー → 開いた日の枠 → すべての計測 → 音の傾向)
// 【便BW 再審査】⑫ の的は押せる日のボタン(マス)の中の丸(34)。r はマスの矩形で、丸はその中央
const DayCell = ({ r = "61,300,45,44", onClick }) => {
  const [l, t, w, h] = r.split(",").map(Number);
  return <button type="button" data-r={r} onClick={onClick}><span data-coach="calendarDay" data-r={`${l + w / 2 - 17},${t + h / 2 - 17},34,34`}>6</span></button>;
};
const DayRow = () => <button type="button" data-coach="daySession" data-r="16,560,343,50">10:00</button>;
const TrendCard = ({ r = "14,2000,347,380" }) => <div data-coach="trend" data-r={r}>音の傾向</div>;

describe("【便BW】データタブの段: ⑫ 日のマス・⑬ 記録の行・⑭⑮ 音の傾向カード", () => {
  it("⑫ は中の丸(34)+ pad 5 = 直径 44(§5)/ ⑬ は角丸の矩形(pad 4)。並びは的が在る最初の1つ", async () => {
    await drawBS(["calendarDay", "daySession"], { extra: <><DayCell /></> });
    await frames();
    expect(layerId()).toBe("calendarDay");
    expect(holeBox()).toEqual(["61.5px", "300px", "44px", "44px", "50%"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("計測した日を押してみよう");
    // 日を開いたらマスは名乗らない(枠の先頭の行が名乗る)→ ⑬
    await drawBS(["calendarDay", "daySession"], { extra: <><DayRow /></> });
    await frames(320);
    await frames();
    expect(layerId()).toBe("daySession");
    expect(holeBox()).toEqual(["12px", "556px", "351px", "58px", "var(--r-2)"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("記録を開いてみよう");
  });
  // 【便BW 再審査】丸の外でもマス(押せる日のボタン)の中は外押しにしない。iPad のマスは幅 87 でも穴は直径 44 のまま
  for (const [label, cellR, hole, pass] of [
    ["iPhone(マス 45×44)", "61,300,45,44", ["61.5px", "300px", "44px", "44px"], [61, 300, 45, 44]],
    ["iPad(マス 87×44)", "459.7,293.6,86.9,44", ["481.15px", "293.6px", "44px", "44px"], [459.7, 293.6, 86.9, 44]],
  ]) {
    it(`⑫ ${label}: 穴は直径 44。受けはマス(押せる日のボタン)の外にだけ置き、マスの中は丸の外でも下へ通す`, async () => {
      let opened = 0;
      if (pass[0] > 300) Object.defineProperty(window, "innerWidth", { value: 1180, configurable: true, writable: true });   // iPad の幅
      await drawBS(["calendarDay"], { extra: <DayCell r={cellR} onClick={() => { opened += 1; }} /> });
      await frames();
      holeBox().slice(0, 4).forEach((v, i) => expect(parseFloat(v)).toBeCloseTo(parseFloat(hole[i]), 5));
      const px = (h, k) => parseFloat(h.style[k]);
      const v = (el, k, d) => (el.style[k] === "" ? d : parseFloat(el.style[k]));
      const [, , l, r] = [...layer().querySelectorAll(".coach-hit")];
      // 左右の受けはマスの縁で切れる(丸の縁ではない)
      expect(px(l, "width")).toBeCloseTo(pass[0], 5);
      expect(px(r, "left")).toBeCloseTo(pass[0] + pass[2], 5);
      expect(px(l, "top")).toBeCloseTo(pass[1], 5);
      expect(px(l, "height")).toBeCloseTo(pass[3], 5);
      // 丸の外・マスの中の点(左端から 2px)を覆う受けは無い
      const x = pass[0] + 2; const y = pass[1] + pass[3] / 2;
      const covering = [...layer().querySelectorAll(".coach-hit, .coach-card")].filter((el) => {
        const b = { l: v(el, "left", 22), t: v(el, "top", 0), w: v(el, "width", 331), h: v(el, "height", 146) };
        return x >= b.l && x <= b.l + b.w && y >= b.t && y <= b.t + b.h;
      });
      expect(covering).toEqual([]);
      await clickOn(document.querySelector("button[data-r]:not([data-coach])"));
      expect(opened).toBe(1);
    });
  }
  it("⑫ で外を押すと、データタブの3段(⑫⑬⑭)はこの起動の間は出さない。印は立てない。⑮ は群の外なので出る", async () => {
    const marks = [];
    const onMark = (f) => marks.push(f);
    await drawBS(["calendarDay", "daySession"], { onMark, extra: <DayCell /> });
    await frames();
    await clickOn(layer().querySelector('[data-coach-hit="t"]'));
    expect(layer()).toBe(null);
    for (const [ids, extra] of [[["daySession"], <DayRow key="r" />], [["trend"], <TrendCard key="t" r="14,300,347,380" />], [["calendarDay"], <DayCell key="c" />]]) {
      await drawBS(ids, { onMark, extra });
      await frames(320);
      expect(layer(), ids[0]).toBe(null);
    }
    expect(marks).toEqual([]);
    await drawBS(["idealSeen"], { onMark, extra: <TrendCard r="14,300,347,380" /> });
    await frames(320);
    await frames();
    expect(layerId()).toBe("idealSeen");
  });
  for (const id of ["trend", "idealSeen"]) {
    for (const where of ["受け", "カード"]) {
      it(`${id}: ${where}を押すと消えて印 ${id} を立てる(その1回は下に届かない)`, async () => {
        const marks = [];
        let under = 0;
        await drawBS([id], { onMark: (f) => marks.push(f), extra: <div onClick={() => { under += 1; }}><TrendCard r="14,300,347,380" /></div> });
        await frames();
        expect(layerId()).toBe(id);
        await clickOn(where === "カード" ? layer().querySelector(".coach-card") : layer().querySelector('[data-coach-hit="t"]'));
        expect(layer()).toBe(null);
        expect(marks).toEqual([id]);
        expect(under).toBe(0);
      });
    }
  }
  it("⑮ の文とアイコン(本人裁定)・穴は音の傾向カードの矩形(pad 0)", async () => {
    await drawBS(["idealSeen"], { extra: <TrendCard r="14,300,347,380" /> });
    await frames();
    const card = layer().querySelector(".coach-card");
    expect(card.querySelector(".coach-title").textContent).toBe("みんなの平均を目安にしました");
    expect(card.querySelector(".coach-line").textContent).toBe("my平均と目安を重ねて見られます");
    expect(card.querySelector(".coach-icon svg circle").getAttribute("r")).toBe("8");   // target の絵(二重丸)
    expect(holeBox()).toEqual(["14px", "300px", "347px", "380px", "var(--r-2)"]);
  });
  it("他の段は外を押しても印を立てない(データ・計測なし / リード / ⑫)", async () => {
    const marks = [];
    const onMark = (f) => marks.push(f);
    await drawBS(["data"], { onMark, extra: <NavSvg k="measure" x="46.88" /> });
    await frames();
    await clickOn(layer().querySelector('[data-coach-hit="t"]'));
    await drawBS(["reeds"], { onMark, extra: <button type="button" data-coach="reeds" data-r="305,697,56,56">+</button> });
    await frames();
    await clickOn(layer().querySelector(".coach-card"));
    await drawBS(["metroStart"], { onMark, extra: <Band /> });
    await frames();
    await clickOn(layer().querySelector(".coach-card"));
    expect(marks).toEqual([]);
  });
});

describe("【便BW】⑭⑮ 的へスクロールするのは、この起動で1回だけ", () => {
  let realSIV; let calls;
  beforeEach(() => {
    realSIV = window.Element.prototype.scrollIntoView;
    calls = [];
    // jsdom は scrollIntoView を持たない(または何もしない)ので、呼ばれた要素と引数を控える作り物に替える。
    window.Element.prototype.scrollIntoView = function (arg) { calls.push([this.getAttribute("data-coach"), arg]); };
  });
  afterEach(() => { window.Element.prototype.scrollIntoView = realSIV; });
  it("画面の外(top 2000)の音の傾向カード: 1回だけ中央へ送る(即座)。見えたら出る。送り返されても引き戻さない", async () => {
    await drawBS(["trend"], { extra: <TrendCard /> });
    await frames(320);
    expect(calls).toEqual([["trend", { block: "center", behavior: "auto" }]]);
    expect(layer()).toBe(null);
    // 送った結果、見える所に来た → 出る
    await act(async () => { document.querySelector('[data-coach="trend"]').setAttribute("data-r", "14,216,347,380"); });
    await frames(320);
    await frames();
    expect(layerId()).toBe("trend");
    // 本人が送り返した(また画面の外)→ 案内は消えるが、もう一度は送らない
    await act(async () => { document.querySelector('[data-coach="trend"]').setAttribute("data-r", "14,2000,347,380"); });
    await frames(600);
    expect(layer()).toBe(null);
    expect(calls).toHaveLength(1);
  });
  it("【便BW 審査】前の候補の的(⑫ のマス)が DOM に在る間は、後の ⑭ のために送らない。前の的が無くなれば送る", async () => {
    await drawBS(["calendarDay", "trend"], { extra: <><DayCell r="61,1500,45,44" /><TrendCard /></> });
    await frames(600);
    expect(calls).toEqual([]);
    expect(layer()).toBe(null);
    await drawBS(["calendarDay", "trend"], { extra: <><TrendCard /></> });
    await frames(320);
    expect(calls).toEqual([["trend", { block: "center", behavior: "auto" }]]);
  });
  it("⑮ も1回だけ(⑭ とは別に数える)。⑫ の段は画面の外でも送らない(待つ)", async () => {
    await drawBS(["idealSeen"], { extra: <TrendCard /> });
    await frames(320);
    expect(calls).toEqual([["trend", { block: "center", behavior: "auto" }]]);
    await drawBS(["calendarDay"], { extra: <DayCell r="61,1500,45,44" /> });
    await frames(600);
    expect(calls).toHaveLength(1);
    expect(layer()).toBe(null);
  });
});

describe("【便BS】useSustained(チューナー: 音程が**続けて** ms 取れたら1回)", () => {
  function Probe({ on, ms, onReached }) { useSustained(on, ms, onReached); return null; }
  const put = (on, onReached) => act(async () => { root.render(<Probe on={on} ms={150} onReached={onReached} />); });
  it("続けば1回呼ぶ。途中で途切れたら数え直す。続いている間に2回は呼ばない", async () => {
    let n = 0;
    const cb = () => { n += 1; };
    await put(true, cb);
    await frames(100);
    expect(n).toBe(0);
    await put(false, cb);          // 途切れた
    await put(true, cb);           // 数え直し
    await frames(100);
    expect(n).toBe(0);             // 合計 200ms 経っているが、続けては 100ms
    await frames(100);
    expect(n).toBe(1);
    await frames(250);
    expect(n).toBe(1);
  });
  it("on が false のままなら呼ばない", async () => {
    let n = 0;
    await put(false, () => { n += 1; });
    await frames(250);
    expect(n).toBe(0);
  });
});

// ------------------------------------------------------------------
// 【便BY 2026-10-07 本人の指示「リード登録の時の楽器を選択して〜の案内はやっぱり削除」】⑥ リード登録は便BW の形(穴は「リードを追加」の1つ)に戻した。
//   便BX0 の楽器種別の行の2つ目の穴は外した。行は暗幕の下(受けが覆う = 押せば外押しで案内が消える。便BX0 より前と同じ)。
// 期待値は 375×812 の実測の矩形(リードを追加 305,697,56,56 / 楽器種別の行 14,48,347,44)から手で計算した:
//   穴 = 丸・pad 10 → 直径 76(295,687)。下の holesSplit の純関数の検査は、⑩ の2つ目の穴(保存の帯)が今も使うので残す
// ------------------------------------------------------------------
const AddFab = ({ onClick }) => <button type="button" data-coach="reeds" data-r="305,697,56,56" onClick={onClick}>+</button>;
// 本物の ReedSaxChipRow と同じく data-coach を名乗らない楽器種別の行
function SaxRow({ r = "14,48,347,44", onPick = () => {} }) {
  const [l, t, , h] = r.split(",").map(Number);
  return (
    <div role="radiogroup" aria-label="楽器種別" data-r={r}>
      {["S.Sax", "A.Sax", "T.Sax", "B.Sax"].map((x, i) => (
        <button key={x} type="button" role="radio" data-r={`${l + i * 87.75},${t},83.75,${h}`} onClick={() => onPick(x)}>{x}</button>
      ))}
    </div>
  );
}
const holeStyles = () => [...layer().querySelectorAll(".coach-hole")].map((h) => ({
  box: [h.style.left, h.style.top, h.style.width, h.style.height, h.style.borderRadius], clip: h.style.clipPath || null, also: h.getAttribute("data-coach-hole"),
}));
const hitBoxes = () => [...layer().querySelectorAll(".coach-hit")].map((h) => [h.getAttribute("data-coach-hit"), ...["left", "top", "width", "height"].map((k) => parseFloat(h.style[k]))]);

describe("【便BX】2つの穴(holesSplit / bandOfHole / holeClipPath)", () => {
  it("線は上の穴の下端と下の穴の上端の真ん中(整数)。どちらの順で渡しても同じ。縦に重なれば null", () => {
    const fab = { left: 295, top: 687, width: 76, height: 76 };
    const row = { left: 14, top: 48, width: 347, height: 44 };
    expect(holesSplit(fab, row)).toBe(390);
    expect(holesSplit(row, fab)).toBe(390);
    expect(holesSplit(row, { left: 0, top: 80, width: 10, height: 10 })).toBe(null);   // 48〜92 と 80〜90 は重なる
    // すき間が 1 未満でも線は2つの穴の間に収まる(穴の中に線を引かない)
    expect(holesSplit({ left: 0, top: 0, width: 10, height: 10.2 }, { left: 0, top: 10.6, width: 10, height: 10 })).toBeGreaterThanOrEqual(10.2);
    expect(holesSplit({ left: 0, top: 0, width: 10, height: 10.2 }, { left: 0, top: 10.6, width: 10, height: 10 })).toBeLessThanOrEqual(10.6);
  });
  it("帯: 線より上の穴は 0〜線、下の穴は 線〜画面の下端。影は帯と画面の縁まで外へ広げた枠で切る", () => {
    const fab = { left: 295, top: 687, width: 76, height: 76 };
    const row = { left: 14, top: 48, width: 347, height: 44 };
    expect(bandOfHole(row, 390, 812)).toEqual({ top: 0, bottom: 390 });
    expect(bandOfHole(fab, 390, 812)).toEqual({ top: 390, bottom: 812 });
    // inset(上 右 下 左): 上 = 390 − 687、右 = 371 − 375、下 = 763 − 812、左 = −295
    expect(holeClipPath(fab, { top: 390, bottom: 812 }, 375)).toBe("inset(-297px -4px -49px -295px)");
    expect(holeClipPath(row, { top: 0, bottom: 390 }, 375)).toBe("inset(-48px -14px -298px -14px)");
  });
});

describe("【便BY】⑥ リード登録: 穴は「リードを追加」の1つ(楽器種別の行は照らさない)", () => {
  it("見出しは便BW の「使っているリードを登録しよう」。楽器種別の行が画面に在っても穴は1つ・clip-path なし・受けは4枚で行を覆う", async () => {
    await drawBS(["reeds"], { extra: <><SaxRow /><AddFab /></> });
    await frames();
    expect(layerId()).toBe("reeds");
    expect(layer().querySelector(".coach-title").textContent).toBe("使っているリードを登録しよう");
    expect(layer().querySelector(".coach-line").textContent).toBe("計測に登録したリードを紐づけることができます");
    expect(holeStyles()).toEqual([{ box: ["295px", "687px", "76px", "76px", "50%"], clip: null, also: null }]);
    expect(hitBoxes()).toEqual([["t", 0, 0, 375, 687], ["b", 0, 763, 375, 49], ["l", 0, 687, 295, 76], ["r", 371, 687, 4, 76]]);
    // 4つの楽器種別のボタンの中央は、上の受け(t)が覆う(暗幕の下)
    for (const [i] of ["S.Sax", "A.Sax", "T.Sax", "B.Sax"].entries()) {
      const x = 14 + i * 87.75 + 83.75 / 2; const y = 48 + 22;
      const covering = [...layer().querySelectorAll(".coach-hit")].filter((el) => {
        const v = (k) => parseFloat(el.style[k]);
        return x >= v("left") && x <= v("left") + v("width") && y >= v("top") && y <= v("top") + v("height");
      }).map((el) => el.getAttribute("data-coach-hit"));
      expect(covering, String(i)).toEqual(["t"]);
    }
  });
  it("楽器種別の行の上の受けを押すと消える(外押し)。印は立たない", async () => {
    const marks = [];
    await drawBS(["reeds"], { onMark: (f) => marks.push(f), extra: <><SaxRow /><AddFab /></> });
    await frames();
    await clickOn(layer().querySelector('[data-coach-hit="t"]'));
    expect(layer()).toBe(null);
    expect(marks).toEqual([]);
  });
  // 【便BX 本人の決定 C】⑩ goData の2つ目の穴(保存の帯の箱)は残る(下の【便BX】⑩ の節)。【便BZ】goCompare も帯の箱(⑩ と同じ値)
  it("2つ目の穴を持つのは ⑩ と【便BZ】goCompare だけ(⑥ は持たない)", () => {
    expect(Object.entries(COACH_STEPS).filter(([, s]) => s.also).map(([id]) => id)).toEqual(["goData", "goCompare"]);
    expect("also" in COACH_STEPS.reeds).toBe(false);
    expect(COACH_STEPS.goData.also).toEqual({ target: "[data-action-notice]", pad: 0, shape: "rect" });
    expect(COACH_STEPS.goCompare.also).toEqual({ target: "[data-action-notice]", pad: 0, shape: "rect" });
    expect([COACH_STEPS.goCompare.target, COACH_STEPS.goCompare.pad, COACH_STEPS.goCompare.shape]).toEqual(['[data-coach="nav-analysis"]', 0, "rect"]);
  });
});

// ------------------------------------------------------------------
// 【便BX 2026-10-06 本人の決定・凍結仕様 coach3-spec.md §3・§4・§5・§7・§10・§13.1】
//   到着カード4つ(穴なし・どこを押しても次へ・群なし)・⑭' goCommunity・⑰ goMeasure・⑱ finish(マイクを待たない)・
//   ⑩ の2つ目の穴(保存の帯の箱)・4つ目の門(migratedCoach3)。(【便BY】章の目印の検査は枚数の目印の検査に替えた)
// 期待値は仕様の表から手で書いた(COACH_STEPS から読まない)。実寸は 375×812 の仕様 §7.3 の表の値(帯 685〜753・データの絵柄 772〜802)。
// 【守っていないもの】本物の画面の見た目(地の色・目印の色)。jsdom は色を描かないので、規則の綴りは pitch-test の BX、見た目はスクショ。
// ------------------------------------------------------------------
describe("【便BX】どの段を出すか(到着・⑭'・⑰・⑱)", () => {
  const M = (done, o = {}) => coachCandidates({ topTab: "measure", done, micReady: true, ...o });
  it("計測タブ ⑱: goMeasure・measure・goData 済で finish 未なら、マイクを待たずに finish だけ。どれか欠ければ普段の流れ", () => {
    const d = doneWith("goMeasure", "measure", "goData");
    expect(M(d, { micReady: false })).toEqual(["finish"]);
    expect(M(d)).toEqual(["finish"]);
    expect(M(d, { metroPanelOpen: true, metronomeOn: true })).toEqual(["finish"]);   // 面の開閉も読まない
    expect(M(doneWith("goMeasure", "measure", "goData", "finish"), { micReady: false })).toEqual([]);
    // goData がまだ: micReady false なら何も出さない / true なら普段の結果(⑩)
    expect(M(doneWith("goMeasure", "measure", "tuner", "metronome", "goReeds"), { micReady: false, hasSessions: true })).toEqual([]);
    expect(M(doneWith("goMeasure", "measure", "tuner", "metronome", "goReeds"), { hasSessions: true })).toEqual(["goData"]);
    // measure がまだ(計測を1件もせずに ⑰ まで来た人)→ ① から
    expect(M(doneWith("goMeasure", "goData"))).toEqual(["tuner"]);
    expect(M(doneWith("goMeasure", "goData"), { micReady: false })).toEqual([]);
    // goMeasure も goCommunity もまだ → ⑱ は出ない
    expect(M(doneWith("measure", "goData"), { micReady: false })).toEqual([]);
    // 【便BX 審査 統括の裁定】コミュニティを見た(goCommunity)だけでも ⑱(参加・目安・「見る」は要らない)
    expect(M(doneWith("goCommunity", "measure", "goData"), { micReady: false })).toEqual(["finish"]);
    // 計測の前にコミュニティを覗いた人(measure・goData がまだ)には出さない(① から)
    expect(M(doneWith("goCommunity"))).toEqual(["tuner"]);
    expect(M(doneWith("goCommunity", "measure", "tuner", "metronome", "goReeds"), { hasSessions: true })).toEqual(["goData"]);
  });
  // 【便BX 審査 統括の裁定】⑱ に「参加・目安にする・5秒以内の『見る』」が全部要って、どれかが欠けると案内が黙って止まっていた。3つの道を守る
  describe("【便BX 審査】⑱ への3つの道(参加を見送る・「見る」を押さない・「見る」の前にアプリを閉じる)", () => {
    const DATA_DONE = ["tuner", "metronome", "goReeds", "reeds", "reedsMeasure", "reedLinked", "measure", "goData", "arriveReeds", "arriveData", "calendarDay", "daySession", "trend"];
    const A = (done) => coachCandidates({ topTab: "analysis", done, hasSessions: true });
    const C = (done) => coachCandidates({ topTab: "community", done });
    it("参加を見送る: ⑭' のあとコミュニティを見ただけ(join なし)→ データタブは何も出ず、計測タブで ⑱(マイクを待たない)。終わったあとは4タブとも何も出ない", () => {
      const d = doneWith(...DATA_DONE, "goCommunity");
      expect(A(d)).toEqual([]);
      expect(C(d)).toEqual([]);
      expect(M(d, { micReady: false })).toEqual(["finish"]);
      const fin = doneWith(...DATA_DONE, "goCommunity", "finish");
      expect([M(fin), A(fin), C(fin), coachCandidates({ topTab: "reeds", done: fin })]).toEqual([[], [], [], []]);
    });
    it("「見る」を押さない: 目安にした(adoptAverage)だけで、データタブに来れば ⑰。計測タブに来れば ⑱", () => {
      const d = doneWith(...DATA_DONE, "goCommunity", "join", "arriveCommunity", "adoptAverage");
      expect(A(d)).toEqual(["goMeasure"]);
      expect(M(d, { micReady: false })).toEqual(["finish"]);
      // ⑮ は「見る」から来たときだけ(変えていない)
      expect(coachCandidates({ topTab: "analysis", done: d, hasSessions: true, idealRequested: false })).not.toContain("idealSeen");
      const fin = doneWith(...DATA_DONE, "goCommunity", "join", "arriveCommunity", "adoptAverage", "goMeasure", "finish");
      expect([M(fin), A(fin), C(fin)]).toEqual([[], [], []]);
    });
    it("「見る」の前にアプリを閉じる: 開き直すと計測タブ(起動のタブ)で ⑱(goMeasure は App が立てる)", () => {
      const d = doneWith(...DATA_DONE, "goCommunity", "join", "arriveCommunity", "adoptAverage");
      expect(M(d, { micReady: false })).toEqual(["finish"]);
      expect(M(doneWith(...DATA_DONE, "goCommunity", "join", "arriveCommunity", "adoptAverage", "goMeasure"), { micReady: false })).toEqual(["finish"]);
    });
    it("⑱ のあと: ⑰ は出さない(後から目安にして「見る」から ⑮ を見ても)。⑯ は参加していて未済なら出る", () => {
      const fin = doneWith(...DATA_DONE, "goCommunity", "join", "arriveCommunity", "finish");
      expect(C(fin)).toEqual(["adoptAverage"]);
      const seen = doneWith(...DATA_DONE, "goCommunity", "join", "arriveCommunity", "finish", "adoptAverage", "idealSeen");
      expect(A(seen)).toEqual([]);
    });
  });
  it("リードタブ: 何も済んでいなければ到着だけ。到着が済めば ⑥(既存)", () => {
    expect(coachCandidates({ topTab: "reeds", done: ALL_FALSE })).toEqual(["arriveReeds"]);
    expect(coachCandidates({ topTab: "reeds", done: doneWith("arriveReeds") })).toEqual(["reeds"]);
  });
  it("データタブ 到着: 計測があるときだけ・⑫⑬⑭ より先。計測が無ければ ⑪。読み込み中は何も。⑮ の依頼は到着より先", () => {
    const A = (done, o = {}) => coachCandidates({ topTab: "analysis", done, hasSessions: true, ...o });
    expect(A(ALL_FALSE)).toEqual(["arriveData"]);
    expect(A(ALL_FALSE, { hasSessions: false })).toEqual(["data"]);
    expect(A(doneWith("measure"), { hasSessions: false })).toEqual([]);
    expect(A(ALL_FALSE, { sessionsKnown: false })).toEqual([]);
    expect(A(ALL_FALSE, { idealRequested: true })).toEqual(["idealSeen"]);
    expect(A(doneWith("arriveData"))).toEqual(["calendarDay", "daySession"]);
  });
  it("データタブ ⑭'⑰: trend 済で参加していなければ goCommunity。参加済み・goCommunity 済なら出ない。idealSeen 済で goMeasure", () => {
    const A = (done, o = {}) => coachCandidates({ topTab: "analysis", done, hasSessions: true, ...o });
    const base = ["arriveData", "calendarDay", "daySession", "trend"];
    expect(A(doneWith(...base))).toEqual(["goCommunity"]);
    expect(A(doneWith(...base, "join"))).toEqual([]);
    expect(A(doneWith(...base, "goCommunity"))).toEqual([]);
    expect(A(doneWith(...base, "join", "idealSeen"))).toEqual(["goMeasure"]);
    expect(A(doneWith(...base, "idealSeen"))).toEqual(["goCommunity", "goMeasure"]);
    expect(A(doneWith(...base, "join", "idealSeen", "goMeasure"))).toEqual([]);
    // 【便BX 審査 統括の裁定】目安にしただけ(adoptAverage)でも ⑰。終わった後(finish)は出さない
    expect(A(doneWith(...base, "join", "adoptAverage"))).toEqual(["goMeasure"]);
    expect(A(doneWith(...base, "join", "adoptAverage", "finish"))).toEqual([]);
    expect(A(doneWith(...base, "join", "idealSeen", "finish"))).toEqual([]);
    // ⑭ を見ずに目安にして ⑮ を見た人(trend 未・idealSeen 済): ⑭ は出ず、⑰ は出る
    expect(A(doneWith("arriveData", "calendarDay", "daySession", "idealSeen", "join"))).toEqual(["goMeasure"]);
  });
  it("コミュニティ: 参加したら到着 → ⑯。参加していなければ何も", () => {
    expect(coachCandidates({ topTab: "community", done: doneWith("join") })).toEqual(["arriveCommunity"]);
    expect(coachCandidates({ topTab: "community", done: doneWith("join", "arriveCommunity") })).toEqual(["adoptAverage"]);
    expect(coachCandidates({ topTab: "community", done: ALL_FALSE })).toEqual([]);
  });
});

// 【便BY】流れの順・【便BZ】4本の棒。期待値は仕様 coach3-spec.md §15 の手順(①〜⑤・到着・⑥⑦・⑧⑨⑩・到着・⑫⑬⑭⑭'・到着・⑯・goCompare・⑮⑰・⑱)と
// 本人の指示・統括の裁定(「そのタブの段のうち、済んだ段 + 今の段」・段はカードが出るタブに属する)から手で書いた(COACH_TABS から読まない)。
// 【便BZ 審査】流れの順の定数 COACH_ORDER は使い手が無くなったので消した。順はこの検査が手で持つ(FLOW)。
const FLOW = ["tuner", "metronome", "metroTempo", "metroStart", "goReeds", "arriveReeds", "reeds", "reedsMeasure",
  "reedLinked", "measure", "goData", "arriveData", "calendarDay", "daySession", "trend", "goCommunity",
  "arriveCommunity", "adoptAverage", "goCompare", "idealSeen", "goMeasure", "finish"];
const fillsOf = (id, done = ALL_FALSE) => coachProgress(id, done).bars.map((b) => b.filled);
describe("【便BY】流れの順・【便BZ】4本の棒(COACH_TABS / coachProgress)", () => {
  it("【便BZ】棒は4本(左から 計測・リード・コミュニティ・データ)・段の数は 9・3・3・8。段はカードが出るタブに属する", () => {
    const { bars } = coachProgress("tuner", ALL_FALSE);
    expect(bars.map((b) => [b.tab, b.label, b.total])).toEqual([["measure", "計測", 9], ["reeds", "リード", 3], ["community", "コミュニティ", 3], ["analysis", "データ", 8]]);
    // 全部の段(到着・⑪ を含む。⑨ の measureReed は measure と同じ段)がどれか1本に1回
    expect(COACH_TABS.flatMap((t) => t.steps).sort()).toEqual([...FLOW, "data"].sort());
    const tabOf = (id) => coachProgress(id, ALL_FALSE).current?.tab ?? null;
    // goCompare はコミュニティ(照らすのは下部タブ「データ」だが出るのはコミュニティタブ)・⑤⑩⑱ は計測・⑭' ⑰ はデータ・⑪ data はデータ
    expect(["goCompare", "goReeds", "goData", "finish", "goCommunity", "goMeasure", "data", "measureReed", "measure"].map(tabOf))
      .toEqual(["community", "measure", "measure", "measure", "analysis", "analysis", "analysis", "measure", "measure"]);
    for (const id of Object.keys(COACH_STEPS)) expect(coachProgress(id, ALL_FALSE).bars.filter((b) => b.current), id).toHaveLength(1);
    expect(coachProgress("bogus", ALL_FALSE).current).toBe(null);
    // ⑪ はデータタブにいる間はデータの棒が今の棒(1/8)
    expect(coachProgress("data", ALL_FALSE).current).toMatchObject({ tab: "analysis", label: "データ", filled: 1, total: 8 });
  });
  it("【便BZ 審査】塗る数 = そのタブの済んだ段 + もう出ない段 + 今の段。流れの順で手前でも、印の無い段(外を押して消しただけ)は塗らない", () => {
    expect(fillsOf("tuner")).toEqual([1, 0, 0, 0]);
    expect(fillsOf("arriveReeds")).toEqual([0, 1, 0, 0]);     // ①〜⑤ を外押しで消しただけの人: 計測の棒は 0(便BZ の前は 5)
    expect(fillsOf("goData")).toEqual([1, 0, 0, 0]);
    expect(fillsOf("finish")).toEqual([1, 0, 0, 0]);
    expect(fillsOf("arriveData", doneWith("trend", "adoptAverage"))).toEqual([0, 0, 1, 2]);
    // もう出ない段(COACH_SKIPPED)は済んだ扱い: リードがある → ⑤ / 参加している → ⑭' / ⑮ を見た → ⑭ と goCompare / ⑰ を済ませた → ⑮ / 終わった → goCompare・⑮・⑰
    expect(fillsOf("tuner", doneWith("reeds"))).toEqual([2, 1, 0, 0]);
    expect(fillsOf("arriveData", doneWith("join"))).toEqual([0, 0, 0, 2]);
    expect(fillsOf("goMeasure", doneWith("idealSeen"))).toEqual([0, 0, 1, 3]);
    expect(fillsOf("finish", doneWith("goMeasure"))).toEqual([1, 0, 0, 2]);
    expect(fillsOf("finish", doneWith("finish"))).toEqual([1, 0, 1, 2]);
    expect(Object.keys(COACH_SKIPPED).sort()).toEqual(["goCommunity", "goCompare", "goMeasure", "goReeds", "idealSeen", "trend"]);
    // ⑪(印 measure)は計測が済めば済み: データの棒の1つ
    expect(fillsOf("goData", doneWith("measure"))).toEqual([2, 0, 0, 1]);
  });
  // 本人が通す流れ(仕様 §15)を coachCandidates で1枚ずつ進め、出た段の順が FLOW と同じことを確かめる(順の検査)。
  it("coachCandidates の出る順(本人の通す流れ)は FLOW のとおり。棒の塗りは戻らず、⑱ で4本とも全部", () => {
    let done = { ...ALL_FALSE };
    const seen = []; const fills = [];
    const run = (ctx, max = 8) => {
      for (let i = 0; i < max; i++) {
        const c = coachCandidates({ ...ctx, done });
        if (c.length === 0) return;
        seen.push(c[0]);
        fills.push(fillsOf(c[0], done));
        done = { ...done, [COACH_STEPS[c[0]].flag]: true };
      }
    };
    run({ topTab: "measure", micReady: true }, 2);                                           // ① ②
    run({ topTab: "measure", micReady: true, metroPanelOpen: true }, 2);                     // ③ ④(面の中)
    run({ topTab: "measure", micReady: true }, 1);                                           // ⑤
    run({ topTab: "reeds" });                                                                // 到着・⑥⑦
    run({ topTab: "measure", micReady: true, hasSelectedReed: true, hasSessions: true });     // ⑧⑨⑩
    run({ topTab: "analysis", hasSessions: true });                                          // 到着・⑫⑬⑭⑭'
    done = { ...done, join: true };                                                          // 参加の画面(段ではない)で参加した
    run({ topTab: "community" });                                                            // 到着・⑯・【便BZ】目安と比べてみよう
    run({ topTab: "analysis", hasSessions: true, idealRequested: true });                    // ⑮⑰
    run({ topTab: "measure", micReady: true });                                              // ⑱
    expect(seen.map((id) => (id === "measureReed" ? "measure" : id))).toEqual(FLOW);
    expect(seen).toContain("measureReed");   // ⑨ はリードが選ばれている文
    expect(fills).toEqual([
      [1, 0, 0, 0], [2, 0, 0, 0], [3, 0, 0, 0], [4, 0, 0, 0], [5, 0, 0, 0],
      [5, 1, 0, 0], [5, 2, 0, 0], [5, 3, 0, 0],
      [6, 3, 0, 0], [7, 3, 0, 0], [8, 3, 0, 1],
      [8, 3, 0, 2], [8, 3, 0, 3], [8, 3, 0, 4], [8, 3, 0, 5], [8, 3, 0, 6],
      [8, 3, 1, 6], [8, 3, 2, 6], [8, 3, 3, 6],
      [8, 3, 3, 7], [8, 3, 3, 8],
      [9, 3, 3, 8],
    ]);
  });
  it("リードが既にあり参加済みの人: ⑤ ⑥ ⑦ と到着2枚・⑭' は出ないが、もう出ない段は済んだ扱いで ⑱ で4本とも全部", () => {
    let done = doneWith("reeds", "reedsMeasure", "arriveReeds", "join", "arriveCommunity");
    const fills = [];
    const run = (ctx, max = 8) => {
      for (let i = 0; i < max; i++) {
        const c = coachCandidates({ ...ctx, done });
        if (c.length === 0) return;
        fills.push(fillsOf(c[0], done));
        done = { ...done, [COACH_STEPS[c[0]].flag]: true };
      }
    };
    run({ topTab: "measure", micReady: true }, 2);
    run({ topTab: "measure", micReady: true, metroPanelOpen: true }, 2);
    run({ topTab: "measure", micReady: true, hasSelectedReed: true, hasSessions: true });
    run({ topTab: "analysis", hasSessions: true });
    run({ topTab: "community" });
    run({ topTab: "analysis", hasSessions: true, idealRequested: true });
    run({ topTab: "measure", micReady: true });
    expect(fills[0]).toEqual([2, 3, 1, 1]);   // ① + ⑤(リードがある)・リードの3つ・コミュニティの到着・⑭'(参加している)
    for (let i = 1; i < fills.length; i++) for (let k = 0; k < 4; k++) expect(fills[i][k] >= fills[i - 1][k]).toBe(true);
    expect(fills.at(-1)).toEqual([9, 3, 3, 8]);
  });
  it("【便BZ 審査】順番どおりに進まない人(データタブ → コミュニティ → 計測 → リード …): 済んだ段の塗りは戻らない(変わるのは今の段の1つだけ)", () => {
    let done = doneWith("join");
    const doneOnly = [];
    const step = (id, set = true) => {
      const p = coachProgress(id, done);
      doneOnly.push(p.bars.map((b) => b.filled - (b.current ? 1 : 0)));
      if (set) done = { ...done, [COACH_STEPS[id].flag]: true };
    };
    step("data", false);            // ⑪ を見ただけ(計測はまだ)
    step("arriveCommunity"); step("adoptAverage", false);   // ⑯ は外押しで消した
    step("tuner"); step("metronome");
    step("arriveReeds"); step("reeds");
    step("goReeds", false);         // リードがあるので本当は出ない(済んだ扱い)
    step("measure"); step("arriveData"); step("trend");
    for (let i = 1; i < doneOnly.length; i++) for (let k = 0; k < 4; k++) expect(doneOnly[i][k] >= doneOnly[i - 1][k], `${i} ${k}`).toBe(true);
    expect(fillsOf("adoptAverage", done)).toEqual([4, 2, 2, 4]);   // 外押しの ⑯ は今の段として1つだけ
  });
});

describe("【便BX】4つ目の門(migratedCoach3)", () => {
  const OLD3 = { migrated: true, migratedMeasureSteps: true, migratedCoach2: true };
  const NEW6 = { arriveReeds: true, arriveData: true, arriveCommunity: true, goCommunity: true, goMeasure: true, finish: true };
  it("前の3つの門だけ済んだ人 + 計測1件: 新しい6つと門の印。他の印は倒さない", () => {
    const prev = { ...OLD3, measure: true, tuner: true, join: false };
    const r = migrateOnboardingDone(prev, { sessions: [{ id: "s1" }] });
    expect(r).toEqual({ ...prev, metronome: true, ...NEW6, migratedCoach3: true, goCompare: true, migratedCoach4: true });   // metronome は便BS の LEGACY(計測があれば毎回立てる)・【便BZ】5つ目の門も1回走る
    // どのタブでも新しい段は出ない
    const d = normalizeOnboardingDone({ ...r, goData: true, metronome: true, goReeds: true, reeds: true, trend: true, calendarDay: true, daySession: true, idealSeen: true, join: true, adoptAverage: true });
    expect(coachCandidates({ topTab: "measure", done: d, micReady: false })).toEqual([]);
    expect(coachCandidates({ topTab: "reeds", done: d })).toEqual(["reedsMeasure"]);   // ⑦ は便BW の印(到着は出ない)
    expect(coachCandidates({ topTab: "analysis", done: d, hasSessions: true })).toEqual([]);
    expect(coachCandidates({ topTab: "community", done: d })).toEqual([]);
  });
  it("計測 0・リード 1 → arriveReeds だけ / 計測 0・join → arriveCommunity・goCommunity / 計測 0・idealSeen → goMeasure", () => {
    // 【便BZ】5つ目の門も1回走る(migratedCoach4。idealSeen が立っていれば goCompare)
    expect(migrateOnboardingDone(OLD3, { sessions: [], reeds: [{ id: "r1" }] })).toEqual({ ...OLD3, arriveReeds: true, migratedCoach3: true, migratedCoach4: true });
    expect(migrateOnboardingDone({ ...OLD3, join: true }, { sessions: [] })).toEqual({ ...OLD3, join: true, arriveCommunity: true, goCommunity: true, migratedCoach3: true, migratedCoach4: true });
    expect(migrateOnboardingDone({ ...OLD3, idealSeen: true }, { sessions: [] })).toEqual({ ...OLD3, idealSeen: true, goMeasure: true, migratedCoach3: true, goCompare: true, migratedCoach4: true });
    // 便BW の門が同じ呼び出しで idealSeen を立てた人(みんなの平均を取り込んである。adoptAverage)にも goMeasure
    expect(migrateOnboardingDone({ migrated: true, migratedMeasureSteps: true, adoptAverage: true }, { sessions: [] }))
      .toEqual({ migrated: true, migratedMeasureSteps: true, adoptAverage: true, idealSeen: true, migratedCoach2: true, goMeasure: true, migratedCoach3: true, goCompare: true, migratedCoach4: true });
    // 何も無い人(入れたて)は門の印だけ(流れの全部が出る)
    expect(migrateOnboardingDone(OLD3, { sessions: [] })).toEqual({ ...OLD3, migratedCoach3: true, migratedCoach4: true });
  });
  it("5つの門が全部 true なら同じ物(===)を返す。3つだけなら4つ目(と5つ目)を1回走らせる", () => {
    const all = { ...OLD3, migratedCoach3: true, migratedCoach4: true, measure: true };   // 【便BZ】門は5つ
    expect(migrateOnboardingDone(all, { sessions: [{ id: "s1" }] })).toBe(all);
    const three = { ...OLD3 };
    const r = migrateOnboardingDone(three, { sessions: [] });
    expect(r).not.toBe(three);
    expect(migrateOnboardingDone(r, { sessions: [{ id: "s1" }] })).toBe(r);
  });
});

// 到着カードの描画。的は置かない(到着は的を探さない)。下部タブ(上端 765)は Nav が置く。
describe("【便BX】到着カード(穴なし・どこを押しても次へ・群なし)", () => {
  it("暗幕(.coach-dim)が1枚・受けは画面いっぱいの1枚(data-coach-hit=all)・穴は無い。カードは見える範囲の中央。文は表のとおり", async () => {
    await drawBS(["arriveReeds"]);
    await frames();
    const L = layer();
    expect(layerId()).toBe("arriveReeds");
    expect(L.querySelectorAll(".coach-dim")).toHaveLength(1);
    expect(L.querySelector(".coach-hole")).toBe(null);
    const hits = [...L.querySelectorAll(".coach-hit")];
    expect(hits.map((h) => h.getAttribute("data-coach-hit"))).toEqual(["all"]);
    expect(["left", "top", "width", "height"].map((k) => parseFloat(hits[0].style[k]))).toEqual([0, 0, 375, 812]);
    expect(getComputedStyle(hits[0]).pointerEvents).toBe("auto");
    expect(getComputedStyle(L.querySelector(".coach-dim")).pointerEvents).toBe("none");
    const card = L.querySelector(".coach-card");
    expect(parseFloat(card.style.top)).toBe(CENTER);
    expect(card.getAttribute("data-coach-side")).toBe("center");
    expect(card.querySelector(".coach-title").textContent).toBe("ここはリードタブ");
    expect(card.querySelector(".coach-line").textContent).toBe("使っているリードを登録して、計測に紐づけます");
    expect(live().textContent).toBe("ここはリードタブ。使っているリードを登録して、計測に紐づけます");
    // 受けは下部タブ(765〜812)も覆う(重なり順 55 > 下部タブ 30)。到着の間の下部タブの1回は「次へ」になる(仕様 §2.5)
    expect(Number(L.style.zIndex)).toBe(55);
    expect(parseFloat(hits[0].style.top) + parseFloat(hits[0].style.height)).toBeGreaterThanOrEqual(NAV_TOP + 47);
  });
  for (const where of ["受け", "カード"]) {
    it(`${where}を押すと onMark(到着の印)。外押しではないので dismissedRef に入らず、印を立てずに描き直すと同じ到着がまた出る`, async () => {
      const marks = [];
      let under = 0;
      await drawBS(["arriveReeds"], { onMark: (f) => marks.push(f), extra: <button type="button" data-r="22,100,331,40" onClick={() => { under += 1; }}>下</button> });
      await frames();
      await clickOn(where === "カード" ? layer().querySelector(".coach-card") : layer().querySelector('[data-coach-hit="all"]'));
      expect(marks).toEqual(["arriveReeds"]);
      expect(under).toBe(0);                                  // その1回は下へ届かない
      expect(layerId()).toBe("arriveReeds");                  // 印が立つまでは出たまま(消すのは印 → 溶ける)
      // 印を立てずに描き直しても同じ到着が出る(dismissedRef に入っていない)
      await drawBS(["arriveReeds"], { onMark: (f) => marks.push(f) });
      await frames(320);
      await frames();
      expect(layerId()).toBe("arriveReeds");
      expect(layer().getAttribute("data-leaving")).toBe("false");
    });
  }
  it("到着 → 印が立つと溶けて消え、次の候補(⑥)が出る。到着を押したあとでも ⑥ は群で消えていない", async () => {
    const marks = [];
    await drawBS(["arriveReeds"], { onMark: (f) => marks.push(f), extra: <><SaxRow /><AddFab /></> });
    await frames();
    await clickOn(layer().querySelector('[data-coach-hit="all"]'));
    expect(marks).toEqual(["arriveReeds"]);
    await drawBS(["reeds"], { done: doneWith("arriveReeds"), extra: <><SaxRow /><AddFab /></> });
    expect(layer().getAttribute("data-leaving")).toBe("true");
    expect(layerId()).toBe("arriveReeds");
    await frames(400);
    await frames();
    expect(layerId()).toBe("reeds");
    expect(layer().querySelector(".coach-dim")).toBe(null);
    expect(layer().querySelectorAll(".coach-hole")).toHaveLength(1);   // 【便BY】楽器種別の行の穴は外した
  });
  it("溶けている間は受けもカードも押させない(到着の受けが次の押下を飲み込まない)", async () => {
    await drawBS(["arriveData"]);
    await frames();
    await drawBS([], { done: doneWith("arriveData") });
    expect(layer()?.getAttribute("data-leaving")).toBe("true");
    expect(getComputedStyle(layer().querySelector(".coach-hit")).pointerEvents).toBe("none");
    expect(getComputedStyle(layer().querySelector(".coach-card")).pointerEvents).toBe("none");
  });
  it("4つの到着の文とアイコン(⑱ は tuner の絵・コミュニティは参加のカードと同じ絵)", async () => {
    const W4 = {
      finish: ["チューナーとメトロノームを使って、あなたのデータを貯めよう！", "はじめの案内はこれで終わりです", "M3 17 A9 9 0 0 1 21 17"],
      arriveData: ["ここはデータタブ", "計測の記録はここに貯まります", "M16 16L16 8"],
      arriveCommunity: ["ここはコミュニティ", "参加した人の計測データと、みんなの平均が見られます", null],
    };
    for (const [id, [title, line, d0]] of Object.entries(W4)) {
      act(() => root.unmount());
      root = createRoot(host);
      await drawBS([id]);
      await frames();
      expect(layerId(), id).toBe(id);
      expect(layer().querySelector(".coach-title").textContent, id).toBe(title);
      expect(layer().querySelector(".coach-line").textContent, id).toBe(line);
      if (d0) expect(layer().querySelector(".coach-icon svg path").getAttribute("d"), id).toBe(d0);
      else expect(layer().querySelector(".coach-icon svg circle").getAttribute("cx"), id).toBe("9");
    }
  });
  it("hidden なら出ない(帯・シートの間は到着も出さない)", async () => {
    await drawBS(["arriveReeds"], { hidden: true });
    await frames();
    expect(layer()).toBe(null);
  });
});

// 【便BY】→【便BZ】目印の描画(4本の棒)。期待値(塗る数)は上の規則から手で数えた
const ALL_STEP_FLAGS = ["tuner", "metronome", "metroTempo", "metroStart", "goReeds", "reedLinked", "measure", "goData",
  "arriveReeds", "reeds", "reedsMeasure", "arriveCommunity", "adoptAverage", "goCompare",
  "arriveData", "calendarDay", "daySession", "trend", "goCommunity", "idealSeen", "goMeasure"];
describe("【便BZ】4本の棒の描画(カードの最初の子)", () => {
  const bars = () => [...layer().querySelector(".coach-card").firstElementChild.children];
  const widths = () => bars().map((b) => Math.round(parseFloat(b.firstElementChild.style.width) * 100) / 100);
  it("⑩: 子は棒4本(i・左から 計測・リード・コミュニティ・データ・字なし)・今の棒(計測)だけ now。⑤ 済み + ⑩ = 計測 2/9。「案内 計測 2/9」", async () => {
    await drawBS(["goData"], { done: doneWith("goReeds"), extra: MEASURE_PAGE });
    await frames();
    const card = layer().querySelector(".coach-card");
    const bar = card.firstElementChild;
    expect(bar.className).toBe("coach-progress");
    expect(bar.getAttribute("role")).toBe("img");
    expect(bar.getAttribute("aria-label")).toBe("案内 計測 2/9");
    expect(bars().map((b) => [b.tagName, b.getAttribute("data-tab"), b.className, b.textContent])).toEqual([
      ["I", "measure", "now", ""], ["I", "reeds", "", ""], ["I", "community", "", ""], ["I", "analysis", "", ""]]);
    expect(bars().every((b) => b.children.length === 1 && b.firstElementChild.tagName === "B")).toBe(true);
    expect(widths()).toEqual([22.22, 0, 0, 0]);
    expect(card.children[1].className).toBe("coach-icon");   // 目印の次がアイコン
    expect(layer().querySelector(".coach-marks, [data-coach-mark]")).toBe(null);
    expect(live().textContent).toBe("計測の記録を見てみよう");   // 読み上げの文は変えていない
  });
  it("① は計測 1/9・リードの到着はリード 1/3・コミュニティの到着はコミュニティ 1/3・⑱(ほかの段が全部済み)は4本とも 100%", async () => {
    const CASES = [
      ["tuner", ALL_FALSE, <Band key="b" />, "案内 計測 1/9", "measure", [11.11, 0, 0, 0]],
      ["arriveReeds", ALL_FALSE, null, "案内 リード 1/3", "reeds", [0, 33.33, 0, 0]],
      ["arriveCommunity", ALL_FALSE, null, "案内 コミュニティ 1/3", "community", [0, 0, 33.33, 0]],
      ["finish", doneWith(...ALL_STEP_FLAGS), null, "案内 計測 9/9", "measure", [100, 100, 100, 100]],
    ];
    for (const [id, done, extra, label, now, w] of CASES) {
      act(() => root.unmount());
      root = createRoot(host);
      await drawBS([id], { done, extra });
      await frames();
      expect(layerId(), id).toBe(id);
      expect(layer().querySelector(".coach-progress").getAttribute("aria-label"), id).toBe(label);
      expect(bars().filter((b) => b.className === "now").map((b) => b.getAttribute("data-tab")), id).toEqual([now]);
      expect(widths(), id).toEqual(w);
    }
  });
  it("済んだ段(done)は順に関係なく塗る(データの到着: 計測・⑤(リードあり)・リード・⑯ が済み・⑪ と ⑭ が済み → データ 3/8)", async () => {
    await drawBS(["arriveData"], { done: doneWith("measure", "reeds", "trend", "adoptAverage") });
    await frames();
    expect(layer().querySelector(".coach-progress").getAttribute("aria-label")).toBe("案内 データ 3/8");
    expect(widths()).toEqual([22.22, 33.33, 33.33, 37.5]);
  });
  it("塗りに動き(transition / animation)を付けない・色はトークン(今の棒 --c-accent / ほか --c-accent-mid / まだ --c-line-strong)", () => {
    const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
    const rules = css.split("\n").filter((l) => l.startsWith(".coach-progress"));
    expect(rules).toEqual([
      ".coach-progress { justify-self: stretch; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: var(--sp-1); }",
      ".coach-progress i { display: block; height: var(--sp-1); border-radius: var(--r-full); background: var(--c-line-strong); overflow: hidden; }",
      ".coach-progress i b { display: block; height: 100%; background: var(--c-accent-mid); }",
      ".coach-progress i.now b { background: var(--c-accent); }",
    ]);
    expect(/coach-progress[^{]*\{[^}]*(transition|animation)/.test(css)).toBe(false);
  });
});

// ⑩ と保存の帯(375×812・広告なし・仕様 §7.3): データの絵柄 298.1,772,30,30 → 穴 761〜813 / 帯の内箱 14,685,347,68
const NoticeBox = ({ r = "14,685,347,68", onOpen }) => (
  <div data-action-notice="" data-r={r}><span>10:00 の計測を保存しました</span><button type="button" data-r="300,697,40,44" onClick={onOpen}>開く</button></div>
);
// 【便BZ】下部タブ「データ」のボタンの箱(760〜804)。帯 685〜753 との間の線は round((753 + 760) / 2) = 757(変わらない)
const DataNav = () => <span data-coach="nav-analysis" data-r="271.25,760,83.75,44"><svg data-r="298.1,767,30,30" /></span>;
describe("【便BX】⑩ と保存の帯(2つ目の穴)", () => {
  it("holesSplit の実寸: 帯 685〜753 と下部タブの穴 761〜813 の間の線は 757(null ではない)", () => {
    expect(holesSplit({ left: 287.1, top: 761, width: 52, height: 52 }, { left: 14, top: 685, width: 347, height: 68 })).toBe(757);
  });
  it("穴は2枚(1つ目 = データの絵柄の丸・2つ目 = 帯の矩形 pad 0 角丸 --r-2)。帯の中にも下部タブの穴の中にも受けは無い。「開く」は押せる", async () => {
    let opened = 0;
    await drawBS(["goData"], { extra: <><DataNav /><NoticeBox onOpen={() => { opened += 1; }} /></> });
    await frames();
    expect(layerId()).toBe("goData");
    const hs = holeStyles();
    expect(hs.map((h) => [h.box, h.also])).toEqual([
      [["271.25px", "760px", "83.75px", "44px", "var(--r-2)"], null],
      [["14px", "685px", "347px", "68px", "var(--r-2)"], "also"],
    ]);
    // 帯の中心・「開く」の中心・下部タブの絵柄の中心を覆う受け・カードは無い
    const v = (el, k, d) => (el.style[k] === "" ? d : parseFloat(el.style[k]));
    for (const [x, y] of [[187.5, 719], [320, 719], [313.1, 787]]) {
      const covering = [...layer().querySelectorAll(".coach-hit, .coach-card")].filter((el) => {
        const b = { l: v(el, "left", 22), t: v(el, "top", 0), w: v(el, "width", 331), h: v(el, "height", 146) };
        return x >= b.l && x <= b.l + b.w && y >= b.t && y <= b.t + b.h;
      });
      expect(covering, `${x},${y}`).toEqual([]);
    }
    // 受けは帯ごとに4枚(線 757 で分ける)
    expect(hitBoxes().map((h) => h[0])).toEqual(["t", "b", "l", "r", "xt", "xb", "xl", "xr"]);
    expect(hitBoxes().find((h) => h[0] === "t").slice(1)).toEqual([0, 757, 375, 3]);
    expect(hitBoxes().find((h) => h[0] === "xb").slice(1)).toEqual([0, 753, 375, 4]);
    // カードは中央(帯にも下部タブにもかからない)
    const top = parseFloat(layer().querySelector(".coach-card").style.top);
    expect(top).toBe(CENTER);
    expect(top + 146).toBeLessThan(685);
    await clickOn([...document.querySelectorAll("button")].find((b) => b.textContent === "開く"));
    expect(opened).toBe(1);
    expect(layerId()).toBe("goData");   // 外押しになっていない
  });
  it("帯が無ければ穴は1枚(今までどおり)。帯が消えると2枚 → 1枚に戻る", async () => {
    await drawBS(["goData"], { extra: <><DataNav /><NoticeBox /></> });
    await frames();
    expect(holeStyles()).toHaveLength(2);
    await drawBS(["goData"], { extra: <><DataNav /></> });
    await frames();
    expect(holeStyles()).toHaveLength(1);
    expect(holeStyles()[0].clip).toBe(null);
    expect(hitBoxes().map((h) => h[0])).toEqual(["t", "b", "l", "r"]);
  });
});

// ------------------------------------------------------------------
// 【便BZ 2026-10-07 本人の実機の指摘・統括の裁定】
//   ① 置き場所(上の「穴とカードの位置」の【便BZ】)/ 溶ける前のカードは不透明
//   ② ⑭⑮ の的は「見える範囲(上端 〜 下部タブ・広告の帯の上端)に収まっていなければ」送る / 穴にかかる浮かせるボタンは暗幕と同じ色で覆う
//   ③ 新しい段 goCompare「目安と比べてみよう」(目安の帯と同時に・この段から来たら ⑮)
// 期待値は実機のスクショ・headless Chrome の実測(報告の表)と統括の裁定の文から手で書いた。
// ------------------------------------------------------------------
describe("【便BZ】② ⑭⑮ の的へ送る: 見える範囲に収まっていなければ(画面の中でも下部タブ・帯の裏なら)", () => {
  let realSIV; let calls;
  beforeEach(() => {
    realSIV = window.Element.prototype.scrollIntoView;
    calls = [];
    // 呼ばれた要素・引数と、呼ばれた瞬間の scroll-margin-bottom を控える(送る間だけ付いて、すぐ外れること)
    window.Element.prototype.scrollIntoView = function (arg) { calls.push([this.getAttribute("data-coach"), arg, this.style.scrollMarginBottom]); };
  });
  afterEach(() => { window.Element.prototype.scrollIntoView = realSIV; });
  it("⑭: 画面の中(600〜800 ≦ 812)でも下部タブの上端 765 より下にはみ出していれば1回送る(見える範囲の中央 = 下へ 812 − 765 = 47 の余白)。送り終えたら余白は外す", async () => {
    await drawBS(["trend"], { extra: <TrendCard r="14,600,347,200" /> });
    await frames(320);
    expect(calls).toEqual([["trend", { block: "center", behavior: "auto" }, "47px"]]);
    expect(document.querySelector('[data-coach="trend"]').style.scrollMarginBottom).toBe("");
    // 作り物の scrollIntoView は的を動かさない → 2回目は送らない(この起動で1回だけ)。画面の中には居るので出す(今までどおり)
    expect(layerId()).toBe("trend");
    await act(async () => { document.querySelector('[data-coach="trend"]').setAttribute("data-r", "14,300,347,200"); });
    await frames(320);
    expect(layerId()).toBe("trend");
    expect(calls).toHaveLength(1);
  });
  it("⑮: 見える範囲(765)より高い的(800)は上端をそろえる(block start)", async () => {
    await drawBS(["idealSeen"], { extra: <TrendCard r="14,900,347,800" /> });
    await frames(320);
    expect(calls).toEqual([["trend", { block: "start", behavior: "auto" }, "47px"]]);
  });
  it("見える範囲に収まっていれば送らずに出す(556〜701 ≦ 765)", async () => {
    await drawBS(["trend"], { extra: <TrendCard r="14,555.6,347,145" /> });
    await frames(320);
    expect(calls).toEqual([]);
    expect(layerId()).toBe("trend");
  });
  it("前の段(⑫ のマス)の的が画面に在る間は、⑭ の的が帯の裏でも送らない(前の段を待つ・今までどおり)", async () => {
    await drawBS(["calendarDay", "trend"], { extra: <><DayCell /><TrendCard r="14,600,347,200" /></> });
    await frames(320);
    expect(calls).toEqual([]);
    expect(layerId()).toBe("calendarDay");
  });
});

// 浮かせるボタン(本物の FloatingAction と同じく data-floating-action を名乗る)
const FloatBtn = ({ r = "305,639,56,56", coach, onClick }) => (
  <button type="button" data-floating-action="" data-coach={coach} data-r={r} onClick={onClick} style={{ borderRadius: "999px" }}>↑</button>
);
describe("【便BZ】② 穴にかかる浮かせるボタンは暗幕の下に入る(覆い)。的そのもののボタンは押せる", () => {
  it("⑭ の穴(音の傾向カード)の中の取り込みの丸: 覆いが1枚(ボタンの矩形・角丸)。覆いを押すと外押し(⑭ は押す=済)でボタンには届かない", async () => {
    const marks = []; let fabClicks = 0;
    await drawBS(["trend"], { onMark: (f) => marks.push(f), extra: <><TrendCard r="14,555.6,347,145" /><FloatBtn onClick={() => { fabClicks += 1; }} /></> });
    await frames();
    const covers = [...layer().querySelectorAll(".coach-cover")];
    expect(covers).toHaveLength(1);
    const c = covers[0];
    expect([c.style.left, c.style.top, c.style.width, c.style.height, c.style.borderRadius]).toEqual(["305px", "639px", "56px", "56px", "999px"]);
    expect(c.getAttribute("aria-hidden")).toBe("true");
    // 色は暗幕と同じトークン(index.css の .coach-cover の宣言)
    const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
    expect(/\n\.coach-cover \{ position: fixed; pointer-events: auto; background: var\(--c-coach-dim\); \}/.test(css)).toBe(true);
    await clickOn(c);
    expect(fabClicks).toBe(0);
    expect(marks).toEqual(["trend"]);
    expect(layer()).toBe(null);
  });
  // 【便BZ 審査 統括の裁定】iPad 744×1133 の2ペインで、右ペインの「目安に設定」(浮かせるボタン)の覆いが目安の帯の「見る」に乗って押せなくなっていた。
  // 覆いは1つ目の穴(下部タブ)にかかるボタンだけ。帯の箱(2つ目の穴)にかかっても覆わない。覆いは穴と重なる所だけに切る(clip-path)
  it("【便BZ 審査】帯の箱(2つ目の穴)にかかる浮かせるボタンは覆わない(帯の「見る」は押せる)", async () => {
    let seen = 0;
    const AdoptNotice = () => <div data-action-notice="" data-r="14,685,347,68"><span>目安に設定しました</span><button type="button" data-r="300,697,40,44" onClick={() => { seen += 1; }}>見る</button></div>;
    // 744×1133 の実測(帯 52,936,640,68 /「目安に設定」625.1,960,104.9,44 = 帯の箱に重なり「見る」の 40/44 を覆っていた)を、
    // この作り物の 375×812 の座標に置き直した: 帯 14,685,347,68 /「見る」300,697,40,44 / 浮かせるボタン 290,700,80,44
    await drawBS(["goCompare"], { extra: <><DataNav /><AdoptNotice /><FloatBtn r="290,700,80,44" /></> });
    await frames();
    expect(layerId()).toBe("goCompare");
    expect(layer().querySelectorAll(".coach-hole")).toHaveLength(2);
    expect(layer().querySelectorAll(".coach-cover")).toHaveLength(0);
    await clickOn([...document.querySelectorAll("button")].find((b) => b.textContent === "見る"));
    expect(seen).toBe(1);
    expect(layerId()).toBe("goCompare");
  });
  it("【便BZ 審査】覆いはボタンと穴が重なる所だけ(穴の外の部分は切る = 暗幕が二重にならない)", async () => {
    await drawBS(["trend"], { extra: <><TrendCard r="14,555.6,347,145" /><FloatBtn r="305,680,56,56" /></> });
    await frames();
    const c = layer().querySelector(".coach-cover");
    expect(c.style.clipPath).toBe("inset(0px 0px 35.4px 0px)");
  });
  it("穴にかからない浮かせるボタン(暗幕の影がかかっている)は覆わない / 的そのもの(⑥ リードを追加)は覆わずに押せる", async () => {
    await drawBS(["trend"], { extra: <><TrendCard r="14,300,347,145" /><FloatBtn /></> });
    await frames();
    expect(layerId()).toBe("trend");
    expect(layer().querySelectorAll(".coach-cover")).toHaveLength(0);
    act(() => root.unmount());
    root = createRoot(host);
    let added = 0;
    await drawBS(["reeds"], { extra: <FloatBtn coach="reeds" r="305,697,56,56" onClick={() => { added += 1; }} /> });
    await frames();
    expect(layerId()).toBe("reeds");
    expect(layer().querySelectorAll(".coach-cover")).toHaveLength(0);
    await clickOn(document.querySelector('[data-coach="reeds"]'));
    expect(added).toBe(1);
  });
});

describe("【便BZ】① 溶ける前のカードは不透明(半透明に見えたのは済んだあとの溶け)", () => {
  it("出ている間は層に溶けの動き(coach-out)が無く、カードに透明度の指定も無い。済んだら層だけが coach-out で溶ける", async () => {
    await drawBS(["tuner"], { extra: <Band /> });
    await frames();
    const L = layer();
    expect(L.getAttribute("data-leaving")).toBe("false");
    expect(`${getComputedStyle(L).animationName} ${getComputedStyle(L).animation}`).not.toMatch(/coach-out/);
    expect(L.querySelector(".coach-card").style.opacity).toBe("");
    // 地のトークンはアルファを持たない 6 桁の色(index.css の :root から読む)
    const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
    expect(/--c-accent-tint:\s*(#[0-9A-Fa-f]{6})\s*;/.exec(css)?.[1]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    // 済んだ → 溶ける(層の animation が coach-out)
    await drawBS(["tuner"], { done: doneWith("tuner"), extra: <Band /> });
    await frames();
    expect(layer()?.getAttribute("data-leaving")).toBe("true");
    expect(`${getComputedStyle(layer()).animationName} ${getComputedStyle(layer()).animation}`).toMatch(/coach-out/);
  });
});

describe("【便BZ】③ 目安と比べてみよう(goCompare)の判定", () => {
  it("goCompareOpen: 目安にした・比べに行っていない・⑮ を見ていない・終わっていない", () => {
    expect(goCompareOpen(doneWith("adoptAverage"))).toBe(true);
    expect(goCompareOpen(doneWith())).toBe(false);
    expect(goCompareOpen(doneWith("adoptAverage", "goCompare"))).toBe(false);
    expect(goCompareOpen(doneWith("adoptAverage", "idealSeen"))).toBe(false);
    expect(goCompareOpen(doneWith("adoptAverage", "finish"))).toBe(false);
    expect(goCompareOpen(undefined)).toBe(false);
  });
  it("coachCameFromCompare: コミュニティ → データ のときだけ(帯の「見る」でも下部タブでも同じ判定)", () => {
    const d = doneWith("join", "arriveCommunity", "adoptAverage");
    expect(coachCameFromCompare({ from: "community", to: "analysis", done: d })).toBe(true);
    expect(coachCameFromCompare({ from: "measure", to: "analysis", done: d })).toBe(false);   // 他のタブから来たら「この段から」ではない
    expect(coachCameFromCompare({ from: "community", to: "measure", done: d })).toBe(false);
    expect(coachCameFromCompare({ from: "community", to: "analysis", done: { ...d, goCompare: true } })).toBe(false);
    expect(coachCameFromCompare({ from: "analysis", to: "analysis", done: d })).toBe(false);
  });
  // 【便BZ 統括の裁定】帯が出ている間は、その帯が名乗る段だけ(保存の帯 = ⑩ / 目安の帯 = goCompare)。⑱ などは帯が消えるまで出さない
  it("coachDuringNotice: 帯が名乗るタブにいる間だけ・その帯の段だけ(計測 = ⑩・コミュニティ = goCompare)・違うタブ・名乗らない帯は出さない", () => {
    const cands = ["arriveCommunity", "goCompare"];
    expect(coachDuringNotice({ candidates: cands, notice: null, topTab: "community" })).toEqual({ candidates: cands, hidden: false });
    expect(coachDuringNotice({ candidates: cands, notice: { coach: "community" }, topTab: "community" })).toEqual({ candidates: ["goCompare"], hidden: false });
    expect(coachDuringNotice({ candidates: ["goData", "finish"], notice: { coach: "measure" }, topTab: "measure" })).toEqual({ candidates: ["goData"], hidden: false });
    // 保存の帯の間の ⑱(計測タブの先頭の候補)・目安の帯の間の到着・⑯ は出さない(帯の「開く」「見る」を覆わない)
    expect(coachDuringNotice({ candidates: ["finish"], notice: { coach: "measure" }, topTab: "measure" })).toEqual({ candidates: [], hidden: false });
    expect(coachDuringNotice({ candidates: ["arriveCommunity"], notice: { coach: "community" }, topTab: "community" })).toEqual({ candidates: [], hidden: false });
    expect(coachDuringNotice({ candidates: ["adoptAverage"], notice: { coach: "community" }, topTab: "community" }).candidates).toEqual([]);
    expect(COACH_WITH_NOTICE.measure).toEqual(["goData"]);
    expect(COACH_WITH_NOTICE.community).toEqual(["goCompare"]);
    // 帯の間にタブを移った(便BX の罠: 着いた先の段が帯の「開く」「見る」を覆う)→ 出さない
    expect(coachDuringNotice({ candidates: ["idealSeen"], notice: { coach: "community" }, topTab: "analysis" }).hidden).toBe(true);
    expect(coachDuringNotice({ candidates: ["finish"], notice: { coach: "community" }, topTab: "measure" }).hidden).toBe(true);
    expect(coachDuringNotice({ candidates: ["arriveData"], notice: { coach: "measure" }, topTab: "analysis" }).hidden).toBe(true);
    // 名乗らない帯(取り込み・削除など)はどのタブでも出さない
    expect(coachDuringNotice({ candidates: ["goCompare"], notice: { coach: null }, topTab: "community" }).hidden).toBe(true);
    expect(Object.keys(COACH_WITH_NOTICE).sort()).toEqual(["community", "measure"]);
  });
  it("目安の帯の箱と下部タブ「データ」の2つの穴。帯が消えたら下部タブ「データ」だけ(1つ)", async () => {
    let seen = 0;
    const AdoptNotice = () => <div data-action-notice="" data-r="14,685,347,68"><span>目安に設定しました</span><button type="button" data-r="300,697,40,44" onClick={() => { seen += 1; }}>見る</button></div>;
    await drawBS(["goCompare"], { extra: <><DataNav /><AdoptNotice /></> });
    await frames();
    expect(layerId()).toBe("goCompare");
    expect(layer().querySelectorAll(".coach-hole")).toHaveLength(2);
    expect(layer().querySelector('[data-coach-hole="also"]').style.top).toBe("685px");
    // 「見る」は押せる(2つ目の穴の上に受けは無い)
    await clickOn([...document.querySelectorAll("button")].find((b) => b.textContent === "見る"));
    expect(seen).toBe(1);
    expect(layerId()).toBe("goCompare");
    // 帯が消えた → 下部タブ「データ」の穴だけ(【便BZ】ボタンの箱の角丸の矩形)
    await drawBS(["goCompare"], { extra: <DataNav /> });
    await frames();
    expect(layerId()).toBe("goCompare");
    const hs = layer().querySelectorAll(".coach-hole");
    expect(hs).toHaveLength(1);
    expect([hs[0].style.width, hs[0].style.height, hs[0].style.borderRadius]).toEqual(["83.75px", "44px", "var(--r-2)"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("目安と比べてみよう");
    expect(layer().querySelector(".coach-line")).toBe(null);
  });
});
