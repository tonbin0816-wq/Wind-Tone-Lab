// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OnboardingCoach, COACH_STEPS, ONBOARDING_FLAGS, coachCandidates, normalizeOnboardingDone, markOnboardingDone,
  migrateOnboardingDone, onboardingFlagsForSavedSession, holeOf, placeCoachCard, targetVisible, leaveDurationMs,
  MEASURE_TAB_STEPS, MEASURE_STEPS_MIGRATED, TUNER_SUSTAIN_MS, useSustained,
  COACH2_MIGRATED, MEASURE_TAB_STEPS_LEGACY, DATA_TAB_STEPS, MEASURE_CHAPTER_FLAGS,
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
// ------------------------------------------------------------------

const ALL_FALSE = normalizeOnboardingDone({ migrated: true, migratedMeasureSteps: true, migratedCoach2: true });
const doneWith = (...flags) => ({ ...ALL_FALSE, ...Object.fromEntries(flags.map((f) => [f, true])) });

describe("文言(凍結仕様の表と本人の指示のとおり、一字一句)", () => {
  // [見出し, 1行(無ければ null), アイコン]
  const SPEC = {
    measure: ["最初の計測を記録しよう", "ボタンタップで計測スタート", "mic"],
    reeds: ["使っているリードを登録しよう", "計測に登録したリードを紐づけることができます", "reeds"],   // 【便BQ】本人の指示
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
    reedLinked: ["選んだリードが紐づいています", "計測の記録にこのリードが残ります", "reeds"],
    measureReed: ["このリードで計測してみよう", "ボタンタップで計測スタート", "mic"],
    goData: ["計測の記録を見てみよう", null, "data"],
    calendarDay: ["計測した日を押してみよう", null, "data"],
    daySession: ["記録を開いてみよう", null, "data"],
    trend: ["データが溜まると、平均がここにグラフで出ます", null, "data"],
    // 【便BW 本人裁定 2026-10-06】⑮ はデータタブの音の傾向カード
    idealSeen: ["みんなの平均を目安にしました", "my平均と目安を重ねて見られます", "target"],
  };
  // 【便BS】参加前(join)の段は外した(参加の画面そのものがカードになった。community/joinCard.test.jsx)。
  it("【便BW】17 の一手の見出し・1行・アイコンが表のとおり(過不足なし。dataSeen「計測したデータがここに貯まります」・参加後1・参加前は無い)", () => {
    expect(Object.keys(SPEC)).toHaveLength(17);
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
    // アイコンは既存の8種から(新しい絵は足していない)
    expect(new Set(Object.values(COACH_STEPS).map((s) => s.icon))).toEqual(new Set(["tuner", "metro", "mic", "reeds", "measure", "data", "target"]));
  });
  it("【便BW】的: どの段も的を持つ(的なしは無い)。① は環の箱を角丸の矩形・pad 0(便BS の「的なし」をやめた)", () => {
    expect(Object.values(COACH_STEPS).every((s) => typeof s.target === "string" && s.target.length > 0)).toBe(true);
    expect(Object.values(COACH_STEPS).some((s) => "anchor" in s)).toBe(false);
    // [target, pad, shape](仕様 §2.1 / §2.3 の表)
    const T = {
      tuner: ['[data-coach="tuner"]', 0, "rect"],
      metronome: ['[data-coach="metronome"]', 0, "circle"],
      metroTempo: ['[data-coach="metroTempo"]', 6, "pill"],
      metroStart: ['[data-coach="tuner"]', 0, "rect"],
      goReeds: ['[data-coach="nav-reeds"] svg', 11, "circle"],
      reedLinked: ['[data-coach="reedChip"]', 6, "pill"],
      measureReed: ['[data-coach="measure"]', 14, "circle"],
      measure: ['[data-coach="measure"]', 14, "circle"],
      goData: ['[data-coach="nav-analysis"] svg', 11, "circle"],
      data: ['[data-coach="nav-measure"] svg', 11, "circle"],
      calendarDay: ['[data-coach="calendarDay"]', 5, "circle"],   // 【再審査】中の丸 34 + pad 5×2 = 直径 44(§5)
      daySession: ['[data-coach="daySession"]', 4, "rect"],
      trend: ['[data-coach="trend"]', 0, "rect"],
      idealSeen: ['[data-coach="trend"]', 0, "rect"],
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
    for (const id of ["metroTempo", "metroStart", "goReeds", "reedLinked", "goData", "calendarDay", "daySession", "trend", "idealSeen"]) {
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
  it("リードタブ: 登録 → 登録が済んだら「このリードで計測」 → 両方済んだら出ない", () => {
    expect(coachCandidates({ topTab: "reeds", done: ALL_FALSE })).toEqual(["reeds"]);
    expect(coachCandidates({ topTab: "reeds", done: doneWith("reeds") })).toEqual(["reedsMeasure"]);
    expect(coachCandidates({ topTab: "reeds", done: doneWith("reeds", "reedsMeasure") })).toEqual([]);
  });
  it("データタブ・計測が無い: 計測が済むまで(計測タブと共通の印。今までどおり)", () => {
    expect(coachCandidates({ topTab: "analysis", done: ALL_FALSE })).toEqual(["data"]);
    expect(coachCandidates({ topTab: "analysis", done: doneWith("measure") })).toEqual([]);
    expect(coachCandidates({ topTab: "analysis", done: ALL_FALSE, hasSessions: false, sessionsKnown: true })).toEqual(["data"]);
  });
  // 【便BW】計測があるときは ⑫ 日のマス → ⑬ 記録の行 → ⑭ 音の傾向(並びで返す。的の在り方で ⑫⑬ のどちらかが決まる)
  it("【便BW】データタブ・計測がある: [⑫, ⑬] → ⑬ 済で [⑫, ⑭] → 全部済で空。読み込み中は出さない。dataSeen は返さない", () => {
    const A = (done, o = {}) => coachCandidates({ topTab: "analysis", done, hasSessions: true, ...o });
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
  it("【便BW 本人裁定】データタブ ⑮: idealRequested のときだけ・先頭に1つだけ。済めば普段の結果。⑮ を見た人に ⑭ は出さない", () => {
    const A = (done, o = {}) => coachCandidates({ topTab: "analysis", done, hasSessions: true, ...o });
    expect(A(ALL_FALSE, { idealRequested: true })).toEqual(["idealSeen"]);
    expect(A(ALL_FALSE, { idealRequested: true, sessionsKnown: false })).toEqual(["idealSeen"]);     // 読み込みを待たない
    expect(A(ALL_FALSE, { idealRequested: true, hasSessions: false })).toEqual(["idealSeen"]);       // 計測が無くても(カードは在る)
    expect(A(doneWith("calendarDay", "daySession"), { idealRequested: true })).toEqual(["idealSeen"]); // ⑭ より先
    expect(A(doneWith("idealSeen"), { idealRequested: true })).toEqual(["calendarDay", "daySession"]);
    expect(A(ALL_FALSE, { idealRequested: false })).toEqual(["calendarDay", "daySession"]);
    // 同じ的(音の傾向カード)なので、⑮ を見た人には ⑭ を出さない。⑭ を先に見た人にも ⑮ は出る
    expect(A(doneWith("calendarDay", "daySession", "idealSeen"))).toEqual([]);
    expect(A(doneWith("calendarDay", "daySession", "trend"), { idealRequested: true })).toEqual(["idealSeen"]);
    // 他のタブでは出さない
    expect(coachCandidates({ topTab: "community", done: doneWith("join", "adoptAverage"), idealRequested: true })).toEqual([]);
    expect(coachCandidates({ topTab: "reeds", done: doneWith("reeds", "reedsMeasure"), idealRequested: true })).toEqual([]);
  });
  it("【便BW】引数に dataSeenDeferred は無い(渡しても結果は変わらない)", () => {
    const base = { topTab: "analysis", done: ALL_FALSE, hasSessions: true };
    expect(coachCandidates({ ...base, dataSeenDeferred: true })).toEqual(coachCandidates(base));
    expect(/dataSeenDeferred/.test(coachCandidates.toString())).toBe(false);
  });
  // 【便BS】参加前の段は無い。印 join(参加した)はみんなの平均の段の門として残る
  it("コミュニティ: 参加したら(印 join)、すぐみんなの平均を目安に(【便BQ】奏者を開く段は無い・【便BS】参加前の段も無い)", () => {
    expect(coachCandidates({ topTab: "community", done: ALL_FALSE })).toEqual([]);
    expect(coachCandidates({ topTab: "community", done: doneWith("join") })).toEqual(["adoptAverage"]);
    expect(coachCandidates({ topTab: "community", done: doneWith("join", "adoptAverage") })).toEqual([]);
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
    expect(n).toEqual({ measure: true, reeds: false, reedsMeasure: false, join: false, adoptAverage: false,
      tuner: true, metronome: false, dataSeen: false,
      metroTempo: false, metroStart: false, goReeds: false, reedLinked: false, goData: true, calendarDay: false, daySession: false, trend: false, idealSeen: false,
      migrated: true, migratedMeasureSteps: false, migratedCoach2: true });
    expect(ONBOARDING_FLAGS).toEqual(["measure", "reeds", "reedsMeasure", "join", "adoptAverage", "tuner", "metronome", "dataSeen",
      "metroTempo", "metroStart", "goReeds", "reedLinked", "goData", "calendarDay", "daySession", "trend", "idealSeen"]);
    expect(MEASURE_STEPS_MIGRATED).toBe("migratedMeasureSteps");
    expect(COACH2_MIGRATED).toBe("migratedCoach2");
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
  // 【便BW】門の印3つ(どの移行の結果にも付く)
  const GATES = { migrated: true, migratedMeasureSteps: true, migratedCoach2: true };
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
    expect(r).toEqual({ measure: true, reeds: true, reedsMeasure: true, adoptAverage: true, tuner: true, metronome: true, ...NEW8, idealSeen: true, ...GATES });
  });
  it("人物の目安だけなら何も立てない / 自分の計測から作った目安が「みんなの平均」という名前でも取り込み扱いにしない", () => {
    // 【便BS】どの移行の結果にも、計測タブの3段の移行の印(migratedMeasureSteps)が付く。【便BW】3つ目の門(migratedCoach2)も
    expect(migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "community", name: "しろねこ さんの目安" }], isAdopted: adopted }))
      .toEqual(GATES);
    expect(migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "session", name: "みんなの平均" }], isAdopted: adopted }))
      .toEqual(GATES);
    expect(migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "community", name: "みんなの平均" }], isAdopted: adopted }))
      .toEqual({ adoptAverage: true, idealSeen: true, ...GATES });
  });
  it("何も無い人は門の印だけ(参加は決めない・新しい段は全部まだ)", () => {
    expect(migrateOnboardingDone({}, { sessions: [], reeds: [], idealProfiles: [], isAdopted: adopted })).toEqual(GATES);
  });
  it("一度移行したら二度と数えない(データを消しても印は戻らない・立っている印を倒さない)", () => {
    const prev = { measure: true, reeds: true, join: true, ...GATES };
    expect(migrateOnboardingDone(prev, { sessions: [{ id: "s1" }], reeds: [], idealProfiles: [], isAdopted: adopted })).toBe(prev);
    expect(migrateOnboardingDone({ join: true }, { sessions: [], reeds: [], idealProfiles: [], isAdopted: adopted })).toEqual({ join: true, ...GATES });
  });
  // 【便BS 2026-10-03 本人裁定】便BP の移行を済ませた人(配信済み。migrated だけを持つ)にも、計測タブの3段の移行を1回だけ当てる
  it("便BP の移行を済ませた人: 計測があれば tuner・metronome・measure を済みにする(便BP の移行はやり直さない・dataSeen は立てない)", () => {
    const old = { migrated: true };
    const r = migrateOnboardingDone(old, { sessions: [{ id: "s1", reedId: "r1" }], reeds: [{ id: "r1" }], idealProfiles: [], isAdopted: adopted });
    // reeds / reedsMeasure は便BP の移行の分なので、ここでは立てない(やり直さない)。【便BW】新しい8つは立つ
    expect(r).toEqual({ measure: true, tuner: true, metronome: true, ...NEW8, ...GATES });
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
      expect(r).toEqual({ ...BS, measure: true, tuner: true, metronome: true, ...NEW8, migratedCoach2: true });
      expect(r.dataSeen).toBeUndefined();
      // 計測があれば、計測タブ・データタブのどの段も出ない
      const d = normalizeOnboardingDone(r);
      expect(coachCandidates({ topTab: "measure", done: d, micReady: true, hasSessions: true, hasSelectedReed: true })).toEqual([]);
      expect(coachCandidates({ topTab: "measure", done: d, micReady: true, hasSessions: true, metroPanelOpen: true })).toEqual([]);
      expect(coachCandidates({ topTab: "analysis", done: d, hasSessions: true })).toEqual([]);
    });
    it("リードはあるが計測が無い人: goReeds だけ(reeds は便BP の門で立つ)。計測タブは ① から", () => {
      const r = migrateOnboardingDone({}, { sessions: [], reeds: [{ id: "r1" }] });
      expect(r).toEqual({ reeds: true, goReeds: true, ...GATES });
      expect(coachCandidates({ topTab: "measure", done: normalizeOnboardingDone(r), micReady: true })).toEqual(["tuner"]);
    });
    it("前の版で dataSeen を押した人: データタブの3段を済みに / みんなの平均を取り込んである人(adoptAverage): idealSeen", () => {
      expect(migrateOnboardingDone({ ...BS, dataSeen: true }, { sessions: [] }))
        .toEqual({ ...BS, dataSeen: true, calendarDay: true, daySession: true, trend: true, migratedCoach2: true });
      expect(migrateOnboardingDone({ ...BS, adoptAverage: true }, { sessions: [] }))
        .toEqual({ ...BS, adoptAverage: true, idealSeen: true, migratedCoach2: true });
    });
    it("3つの門が全部立っていれば同じ物を返す(書き込みを起こさない)。2つだけなら新しい門を1回走らせる", () => {
      const all = { ...GATES, measure: true };
      expect(migrateOnboardingDone(all, { sessions: [{ id: "s1" }] })).toBe(all);
      const two = { ...BS };
      const r = migrateOnboardingDone(two, { sessions: [] });
      expect(r).not.toBe(two);
      expect(r).toEqual(GATES);
    });
    it("便BS の移行の結果は変わらない(計測があれば tuner・metronome・measure。LEGACY の3つ)", () => {
      const r = migrateOnboardingDone({ migrated: true, migratedCoach2: true }, { sessions: [{ id: "s1" }] });
      expect(r).toEqual({ migrated: true, migratedCoach2: true, migratedMeasureSteps: true, measure: true, tuner: true, metronome: true });
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
  it("上にも下にも収まらないときは中央のまま(重なりを返す)", () => {
    const big = placeCoachCard({ hole: { left: 14, top: 100, width: 347, height: 560 }, cardH: 146, vh: 812, bottomLimit: 765 });
    expect(big.top).toBe((765 - 146) / 2);
    expect(big.overlaps).toBe(true);
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
    const both = <><Target /><span data-coach="nav-measure"><svg data-r="46.88,773,30,30" /></span></>;
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
    const both = <><Target /><span data-coach="nav-measure"><svg data-r="46.88,773,30,30" /></span></>;
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
const NavSvg = ({ k, x }) => <span data-coach={`nav-${k}`}><svg data-r={`${x},773,30,30`} /></span>;
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
    expect(holeBox()).toEqual(["119.6px", "762px", "52px", "52px", "50%"]);
    expect(layer().querySelector(".coach-line")).toBe(null);   // 1行なし
    await drawBS(["goData"], { extra: MEASURE_PAGE });
    await frames();
    expect(layerId()).toBe("goData");
    expect(holeBox()).toEqual(["287.1px", "762px", "52px", "52px", "50%"]);
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
