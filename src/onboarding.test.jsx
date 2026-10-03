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
} from "./onboarding.jsx";

// ------------------------------------------------------------------
// 【便BP 2026-10-03 本人裁定 / 便BQ 2026-10-03 本人の実機指示】はじめの一手。純関数(どの一手を出すか・印・移行・穴とカードの位置)と、
// 部品 OnboardingCoach(出る・出ない・外を押したら消える・穴は下へ通す・溶ける・reduced-motion・読み上げ・追従の止め方)。
// 期待値は凍結仕様の表と本人の指示から**手で書いた**(実装の COACH_STEPS から読まない)。
// 【便BQ で消した検査】便BP3〜6 の置き場所(押せる部品を避ける・重み・スクロールで出せるか・部品の縁の候補・いまの位置を保つ・
//   スクロール中は置き直さない・告知の帯の祖先の fixed・disabled・data-coach-avoid)の検査は、カードを中央に置くようになって
//   守る物が無くなったので消した。参加後1(openPerson)の検査も消し、「無いこと」の検査に替えた。
// 【守っていないもの】本物の画面での的の位置と見た目(375×812 / 375×667 の実測は報告の表。headless Chrome)。
// ------------------------------------------------------------------

const ALL_FALSE = normalizeOnboardingDone({ migrated: true, migratedMeasureSteps: true });
const doneWith = (...flags) => ({ ...ALL_FALSE, ...Object.fromEntries(flags.map((f) => [f, true])) });

describe("文言(凍結仕様の表と本人の指示のとおり、一字一句)", () => {
  // [見出し, 1行(無ければ null), アイコン]
  const SPEC = {
    measure: ["最初の計測を記録しよう", "ボタンタップで計測スタート", "mic"],
    reeds: ["使っているリードを登録しよう", "計測に登録したリードを紐づけることができます", "reeds"],   // 【便BQ】本人の指示
    reedsMeasure: ["このリードで計測してみよう", null, "measure"],                                    // 【便BQ】1行は無し
    data: ["計測を始めると、ここに貯まります", "計測タブから計測してみよう", "data"],
    adoptAverage: ["みんなの平均を目安にしてみよう", "目安に設定すると自分の音と比べられます", "target"],
    // 【便BS 2026-10-03 本人裁定(ficus-tutorial2.html の表)】計測タブの1段目・2段目と、データタブの計測があるときの段
    tuner: ["まずは吹いてみよう", "音程がリアルタイムで表示されます", "tuner"],
    metronome: ["メトロノームも使えます", "テンポを決めて練習できます", "metro"],
    dataSeen: ["計測したデータがここに貯まります", "練習の記録と音の傾向を振り返れます", "data"],
  };
  // 【便BS】参加前(join)の段は外した(参加の画面そのものがカードになった。community/joinCard.test.jsx)。
  it("8つの一手の見出し・1行・アイコンが表のとおり(過不足なし。参加後1「気になる奏者を開いてみよう」・参加前「コミュニティに参加しよう」は無い)", () => {
    expect(Object.keys(COACH_STEPS).sort()).toEqual(Object.keys(SPEC).sort());
    for (const [id, [title, line, icon]] of Object.entries(SPEC)) {
      expect(COACH_STEPS[id].title, id).toBe(title);
      expect(COACH_STEPS[id].line, id).toBe(line);
      expect(COACH_STEPS[id].icon, id).toBe(icon);
    }
    expect(Object.values(COACH_STEPS).some((s) => s.title === "気になる奏者を開いてみよう")).toBe(false);
    expect(Object.values(COACH_STEPS).some((s) => s.title === "コミュニティに参加しよう")).toBe(false);
  });
  it("【便BS】的: チューナーとデータ(計測あり)は的なし・メトロノームは右上のアイコン(丸・pad 0)", () => {
    expect(COACH_STEPS.tuner.target).toBe(null);
    expect(COACH_STEPS.dataSeen.target).toBe(null);
    expect(COACH_STEPS.dataSeen.anchor).toBe('[data-coach-anchor="mydata"]');
    expect([COACH_STEPS.metronome.target, COACH_STEPS.metronome.pad, COACH_STEPS.metronome.shape]).toEqual(['[data-coach="metronome"]', 0, "circle"]);
    expect(TUNER_SUSTAIN_MS).toBe(1000);
  });
  it("データタブの一手は計測タブと同じ印(計測が1件保存された)で済む", () => {
    expect(COACH_STEPS.data.flag).toBe("measure");
    expect(COACH_STEPS.measure.flag).toBe("measure");
  });
});

describe("どの一手を出すか(coachCandidates)", () => {
  // 【便BS 2026-10-03 本人裁定】計測タブは チューナー → メトロノーム → 計測 の3段。1つずつ出す
  it("計測タブ: マイクの許可が済んでいるときだけ。チューナー → メトロノーム → 計測の順に1つずつ", () => {
    expect(coachCandidates({ topTab: "measure", done: ALL_FALSE, micReady: true })).toEqual(["tuner"]);
    expect(coachCandidates({ topTab: "measure", done: ALL_FALSE, micReady: false })).toEqual([]);
    expect(coachCandidates({ topTab: "measure", done: doneWith("tuner"), micReady: true })).toEqual(["metronome"]);
    expect(coachCandidates({ topTab: "measure", done: doneWith("tuner"), micReady: false })).toEqual([]);
    expect(coachCandidates({ topTab: "measure", done: doneWith("tuner", "metronome"), micReady: true })).toEqual(["measure"]);
    expect(coachCandidates({ topTab: "measure", done: doneWith("tuner", "metronome", "measure"), micReady: true })).toEqual([]);
    // 先の段が済んでいなければ、後の段の印が立っていても先の段から(メトロノームを先に開いた人はチューナー → 計測)
    expect(coachCandidates({ topTab: "measure", done: doneWith("metronome"), micReady: true })).toEqual(["tuner"]);
    expect(coachCandidates({ topTab: "measure", done: doneWith("tuner", "measure"), micReady: true })).toEqual(["metronome"]);
    expect(MEASURE_TAB_STEPS).toEqual(["tuner", "metronome", "measure"]);
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
  // 【便BS 2026-10-03 本人裁定】計測があるときは「ここに貯まります」(dataSeen)。計測の有無で排他(同時には出ない)
  it("データタブ・計測がある: dataSeen が済むまで。計測が無い段とは計測の有無で排他。読み込み中はどちらも出さない", () => {
    expect(coachCandidates({ topTab: "analysis", done: ALL_FALSE, hasSessions: true })).toEqual(["dataSeen"]);
    expect(coachCandidates({ topTab: "analysis", done: doneWith("measure"), hasSessions: true })).toEqual(["dataSeen"]);
    expect(coachCandidates({ topTab: "analysis", done: doneWith("dataSeen"), hasSessions: true })).toEqual([]);
    // 計測が無ければ dataSeen の印に関係なく今までどおり
    expect(coachCandidates({ topTab: "analysis", done: doneWith("dataSeen"), hasSessions: false })).toEqual(["data"]);
    expect(coachCandidates({ topTab: "analysis", done: ALL_FALSE, hasSessions: true, sessionsKnown: false })).toEqual([]);
    expect(coachCandidates({ topTab: "analysis", done: ALL_FALSE, hasSessions: false, sessionsKnown: false })).toEqual([]);
    // 他のタブでは出さない
    expect(coachCandidates({ topTab: "measure", done: doneWith(...MEASURE_TAB_STEPS), hasSessions: true, micReady: true })).toEqual([]);
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
    const n = normalizeOnboardingDone({ measure: true, reeds: "true", join: 1, openPerson: true, migrated: true, tuner: true, dataSeen: "yes" });
    // 【便BS】tuner / metronome / dataSeen と、計測タブの3段の移行の印(migratedMeasureSteps)が加わった
    expect(n).toEqual({ measure: true, reeds: false, reedsMeasure: false, join: false, adoptAverage: false,
      tuner: true, metronome: false, dataSeen: false, migrated: true, migratedMeasureSteps: false });
    expect(ONBOARDING_FLAGS).toEqual(["measure", "reeds", "reedsMeasure", "join", "adoptAverage", "tuner", "metronome", "dataSeen"]);
    expect(MEASURE_STEPS_MIGRATED).toBe("migratedMeasureSteps");
  });
  it("計測が保存されたときの印: リードを紐づけていれば「このリードで計測」も", () => {
    expect(onboardingFlagsForSavedSession({ id: "s", reedId: null })).toEqual(["measure"]);
    expect(onboardingFlagsForSavedSession({ id: "s", reedId: "r1" })).toEqual(["measure", "reedsMeasure"]);
  });
});

describe("既にある人の移行(migrateOnboardingDone)", () => {
  const adopted = (p) => p?.sourceKind === "community";
  it("計測・リード・リードの紐づいた計測・みんなの平均の目安があれば、その分を済みにする(openPerson は立てない)", () => {
    const r = migrateOnboardingDone({}, {
      sessions: [{ id: "s1", reedId: null }, { id: "s2", reedId: "r1" }],
      reeds: [{ id: "r1" }],
      idealProfiles: [{ id: "p1", sourceKind: "session" }, { id: "p2", sourceKind: "community", name: "しろねこ さんの目安" },
        { id: "p3", sourceKind: "community", name: "みんなの平均（クラシック 学生）" }],
      isAdopted: adopted,
    });
    // 【便BS】計測があるので計測タブの3段(tuner・metronome・measure)も済み。dataSeen は立てない
    expect(r).toEqual({ measure: true, reeds: true, reedsMeasure: true, adoptAverage: true, tuner: true, metronome: true, migrated: true, migratedMeasureSteps: true });
  });
  it("人物の目安だけなら何も立てない / 自分の計測から作った目安が「みんなの平均」という名前でも取り込み扱いにしない", () => {
    // 【便BS】どの移行の結果にも、計測タブの3段の移行の印(migratedMeasureSteps)が付く
    expect(migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "community", name: "しろねこ さんの目安" }], isAdopted: adopted }))
      .toEqual({ migrated: true, migratedMeasureSteps: true });
    expect(migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "session", name: "みんなの平均" }], isAdopted: adopted }))
      .toEqual({ migrated: true, migratedMeasureSteps: true });
    expect(migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "community", name: "みんなの平均" }], isAdopted: adopted }))
      .toEqual({ adoptAverage: true, migrated: true, migratedMeasureSteps: true });
  });
  it("何も無い人は migrated だけ(参加は決めない)", () => {
    expect(migrateOnboardingDone({}, { sessions: [], reeds: [], idealProfiles: [], isAdopted: adopted })).toEqual({ migrated: true, migratedMeasureSteps: true });
  });
  it("一度移行したら二度と数えない(データを消しても印は戻らない・立っている印を倒さない)", () => {
    const prev = { measure: true, reeds: true, join: true, migrated: true, migratedMeasureSteps: true };
    expect(migrateOnboardingDone(prev, { sessions: [{ id: "s1" }], reeds: [], idealProfiles: [], isAdopted: adopted })).toBe(prev);
    expect(migrateOnboardingDone({ join: true }, { sessions: [], reeds: [], idealProfiles: [], isAdopted: adopted })).toEqual({ join: true, migrated: true, migratedMeasureSteps: true });
  });
  // 【便BS 2026-10-03 本人裁定】便BP の移行を済ませた人(配信済み。migrated だけを持つ)にも、計測タブの3段の移行を1回だけ当てる
  it("便BP の移行を済ませた人: 計測があれば tuner・metronome・measure を済みにする(便BP の移行はやり直さない・dataSeen は立てない)", () => {
    const old = { migrated: true };
    const r = migrateOnboardingDone(old, { sessions: [{ id: "s1", reedId: "r1" }], reeds: [{ id: "r1" }], idealProfiles: [], isAdopted: adopted });
    // reeds / reedsMeasure は便BP の移行の分なので、ここでは立てない(やり直さない)
    expect(r).toEqual({ measure: true, tuner: true, metronome: true, migrated: true, migratedMeasureSteps: true });
    // 計測が無ければ印だけ(3段は出る)
    expect(migrateOnboardingDone({ migrated: true }, { sessions: [] })).toEqual({ migrated: true, migratedMeasureSteps: true });
    // 2回目は何もしない(同じ物を返す)
    expect(migrateOnboardingDone(r, { sessions: [] })).toBe(r);
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
// 【便BS 2026-10-03 本人裁定(ficus-tutorial2.html)】的なしの段(チューナー・データの計測あり)・メトロノームの的・
// 計測タブの3段を一緒に消す・押したら印を立てる段(dataSeen)・チューナーの「音程が続けて1秒」(useSustained)。
// 期待値は版の表から手で書いた(COACH_STEPS から読まない)。
// ------------------------------------------------------------------
const layerId = () => layer()?.getAttribute("data-coach-layer") ?? null;
const drawBS = (candidates, { done = ALL_FALSE, hidden = false, onMark = null, extra = null } = {}) => act(async () => {
  root.render(<><Nav />{extra}<OnboardingCoach candidates={candidates} done={done} hidden={hidden} onMark={onMark} /></>);
});
const MetroBtn = () => <button type="button" data-coach="metronome" data-r="317,30,44,44">m</button>;

describe("【便BS】的なしの段・メトロノームの的", () => {
  it("チューナー: 穴を開けず暗幕(.coach-dim)を画面いっぱいに敷く。受けは画面いっぱいの1枚。カードは中央・文とアイコンは表のとおり", async () => {
    await drawBS(["tuner"]);
    await frames();
    const L = layer();
    expect(L.getAttribute("data-coach-layer")).toBe("tuner");
    expect(L.querySelector(".coach-hole")).toBe(null);
    const dim = L.querySelector(".coach-dim");
    expect(dim.getAttribute("aria-hidden")).toBe("true");
    expect(getComputedStyle(dim).position).toBe("fixed");
    expect(getComputedStyle(dim).pointerEvents).toBe("none");
    expect(styleEl.textContent).toMatch(/\.coach-dim \{ position: fixed; inset: 0; pointer-events: none; background: var\(--c-coach-dim\); \}/);
    const hits = [...L.querySelectorAll(".coach-hit")];
    expect(hits.map((h) => h.getAttribute("data-coach-hit"))).toEqual(["all"]);
    expect([hits[0].style.left, hits[0].style.top, hits[0].style.width, hits[0].style.height]).toEqual(["0px", "0px", "375px", "812px"]);
    const card = L.querySelector(".coach-card");
    expect(parseFloat(card.style.top)).toBe(CENTER);
    expect(card.getAttribute("data-coach-side")).toBe("center");
    expect(card.querySelector(".coach-title").textContent).toBe("まずは吹いてみよう");
    expect(card.querySelector(".coach-line").textContent).toBe("音程がリアルタイムで表示されます");
    expect(live().textContent).toBe("まずは吹いてみよう。音程がリアルタイムで表示されます");
    // アイコンは版の tuner(半円の弧)
    expect(card.querySelector(".coach-icon svg path").getAttribute("d")).toBe("M3 17 A9 9 0 0 1 21 17");
  });
  it("メトロノーム: 的は右上のアイコン(44 角)。穴は丸で直径 44(pad 0)。文とアイコン(線 1.6)は表のとおり", async () => {
    await drawBS(["metronome"], { extra: <MetroBtn /> });
    await frames();
    expect(layerId()).toBe("metronome");
    const hole = layer().querySelector(".coach-hole");
    expect([hole.style.left, hole.style.top, hole.style.width, hole.style.height, hole.style.borderRadius]).toEqual(["317px", "30px", "44px", "44px", "50%"]);
    const card = layer().querySelector(".coach-card");
    expect(card.querySelector(".coach-title").textContent).toBe("メトロノームも使えます");
    expect(card.querySelector(".coach-line").textContent).toBe("テンポを決めて練習できます");
    const svg = card.querySelector(".coach-icon svg");
    expect(svg.getAttribute("stroke-width")).toBe("1.6");
    expect(svg.querySelector("path").getAttribute("d")).toBe("M8 20h8l-2-14h-4z");
    // 穴の上には受けを置かない(的を押せば下のボタンに届く)
    expect([...layer().querySelectorAll(".coach-hit")].map((h) => h.getAttribute("data-coach-hit"))).toEqual(["t", "b", "l", "r"]);
  });
  it("的なしの段も hidden なら出ない。済んだら溶ける(data-leaving)", async () => {
    await drawBS(["tuner"], { hidden: true });
    await frames();
    expect(layer()).toBe(null);
    await drawBS(["tuner"]);
    await frames();
    expect(layerId()).toBe("tuner");
    await drawBS(["metronome"], { done: doneWith("tuner"), extra: <MetroBtn /> });
    expect(layer().getAttribute("data-leaving")).toBe("true");
    expect(layerId()).toBe("tuner");
  });
});

describe("【便BS】計測タブの3段: 外を押したら3段とも、この起動の間は出さない", () => {
  const page = <><MetroBtn /><Target /></>;
  for (const [first, how] of [["tuner", "受け"], ["metronome", "受け"], ["measure", "カード"]]) {
    it(`${first} の段で${how}を押すと消え、計測タブの3段とも出ない。印は立てない。他のタブの一手は出る`, async () => {
      const marks = [];
      const onMark = (f) => marks.push(f);
      await drawBS([first], { onMark, extra: page });
      await frames();
      expect(layerId()).toBe(first);
      await clickOn(how === "カード" ? layer().querySelector(".coach-card") : layer().querySelector(".coach-hit"));
      expect(layer()).toBe(null);
      for (const id of ["tuner", "metronome", "measure"]) {
        await drawBS([id], { onMark, extra: page });
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
    await drawBS(["tuner"]);
    await frames();
    await clickOn(layer().querySelector(".coach-hit"));
    act(() => root.unmount());
    root = createRoot(host);
    await drawBS(["tuner"]);
    await frames();
    expect(layerId()).toBe("tuner");
  });
});

describe("【便BS】データ・計測がある(dataSeen): My Data の目印が在るときだけ・押したら印を立てる", () => {
  const Anchor = () => <div data-coach-anchor="mydata" />;
  it("目印が無ければ出さない(分析の子タブ・詳細)。目印が現れたら出る。文とアイコンは表のとおり", async () => {
    await drawBS(["dataSeen"]);
    await frames(320);
    expect(layer()).toBe(null);
    await drawBS(["dataSeen"], { extra: <Anchor /> });
    await frames(320);   // 探し直し(250ms ごと)で見つかる
    await frames();      // 出たあと rAF でカードの高さを測って中央へ
    expect(layerId()).toBe("dataSeen");
    expect(layer().querySelector(".coach-hole")).toBe(null);
    expect(layer().querySelector(".coach-dim")).not.toBe(null);
    const card = layer().querySelector(".coach-card");
    expect(card.querySelector(".coach-title").textContent).toBe("計測したデータがここに貯まります");
    expect(card.querySelector(".coach-line").textContent).toBe("練習の記録と音の傾向を振り返れます");
    expect(card.querySelector(".coach-icon svg path").getAttribute("d")).toBe("M16 16L16 8");
    expect(parseFloat(card.style.top)).toBe(CENTER);
  });
  for (const where of ["受け", "カード"]) {
    it(`${where}を押すと消え、印 dataSeen を立てる(その1回は下に届かない)`, async () => {
      const marks = [];
      let under = 0;
      await drawBS(["dataSeen"], { onMark: (f) => marks.push(f), extra: <div onClick={() => { under += 1; }}><Anchor /></div> });
      await frames();
      await clickOn(where === "カード" ? layer().querySelector(".coach-card") : layer().querySelector('[data-coach-hit="all"]'));
      expect(layer()).toBe(null);
      expect(marks).toEqual(["dataSeen"]);
      expect(under).toBe(0);
    });
  }
  it("他の段は外を押しても印を立てない(データ・計測なし / リード)", async () => {
    const marks = [];
    const onMark = (f) => marks.push(f);
    await drawBS(["data"], { onMark, extra: <span data-coach="nav-measure"><svg data-r="46.88,773,30,30" /></span> });
    await frames();
    await clickOn(layer().querySelector('[data-coach-hit="t"]'));
    await drawBS(["reeds"], { onMark, extra: <button type="button" data-coach="reeds" data-r="305,697,56,56">+</button> });
    await frames();
    await clickOn(layer().querySelector(".coach-card"));
    expect(marks).toEqual([]);
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
