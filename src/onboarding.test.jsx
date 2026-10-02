// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OnboardingCoach, COACH_STEPS, ONBOARDING_FLAGS, coachCandidates, normalizeOnboardingDone, markOnboardingDone, canScrollOut,
  migrateOnboardingDone, onboardingFlagsForSavedSession, holeOf, placeCoachCard, targetVisible, leaveDurationMs,
} from "./onboarding.jsx";

// ------------------------------------------------------------------
// 【便BP 2026-10-03 本人裁定】はじめの一手。純関数(どの一手を出すか・印・移行・穴とカードの位置)と、
// 部品 OnboardingCoach(出る・出ない・溶ける・reduced-motion・タップを通す)。
// 期待値は凍結仕様の表から**手で書いた**(実装の COACH_STEPS から読まない)。
// 【守っていないもの】本物の画面での的の位置と見た目(375×812 / 375×667 の実測は報告の表。headless Chrome)。
//   アプリへの配線(どの成功の道で印が立つか・移行の門)は onboardingApp.test.jsx と onboardingCommunity.test.jsx。
// ------------------------------------------------------------------

const ALL_FALSE = normalizeOnboardingDone({ migrated: true });
const doneWith = (...flags) => ({ ...ALL_FALSE, ...Object.fromEntries(flags.map((f) => [f, true])) });

describe("文言(凍結仕様の表と一字一句)", () => {
  // 表の [見出し, 1行] を写した。アイコンの名前も仕様の割り当てのまま。
  const SPEC = {
    measure: ["最初の計測を記録しよう", "ボタンタップで計測スタート", "mic"],
    reeds: ["使っているリードを登録しよう", "計測が自動でリードに紐づきます", "reeds"],
    reedsMeasure: ["このリードで計測してみよう", "リードごとの違いが見えてきます", "measure"],
    data: ["計測を始めると、ここに貯まります", "計測タブから計測してみよう", "data"],
    join: ["コミュニティに参加しよう", "みんなの計測データが見られます", "community"],
    openPerson: ["気になる奏者を開いてみよう", "計測データとプロフィールが見られます", "person"],
    adoptAverage: ["みんなの平均を目安にしてみよう", "目安に設定すると自分の音と比べられます", "target"],
  };
  it("7つの一手の見出し・1行・アイコンが表のとおり(過不足なし)", () => {
    expect(Object.keys(COACH_STEPS).sort()).toEqual(Object.keys(SPEC).sort());
    for (const [id, [title, line, icon]] of Object.entries(SPEC)) {
      expect(COACH_STEPS[id].title, id).toBe(title);
      expect(COACH_STEPS[id].line, id).toBe(line);
      expect(COACH_STEPS[id].icon, id).toBe(icon);
    }
  });
  it("データタブの一手は計測タブと同じ印(計測が1件保存された)で済む", () => {
    expect(COACH_STEPS.data.flag).toBe("measure");
    expect(COACH_STEPS.measure.flag).toBe("measure");
  });
});

describe("どの一手を出すか(coachCandidates)", () => {
  it("計測タブ: マイクの許可が済んでいて、まだ計測していないときだけ", () => {
    expect(coachCandidates({ topTab: "measure", done: ALL_FALSE, micReady: true })).toEqual(["measure"]);
    expect(coachCandidates({ topTab: "measure", done: ALL_FALSE, micReady: false })).toEqual([]);   // 未許可・許可前
    expect(coachCandidates({ topTab: "measure", done: doneWith("measure"), micReady: true })).toEqual([]);
  });
  it("リードタブ: 登録 → 登録が済んだら「このリードで計測」 → 両方済んだら出ない", () => {
    expect(coachCandidates({ topTab: "reeds", done: ALL_FALSE })).toEqual(["reeds"]);
    expect(coachCandidates({ topTab: "reeds", done: doneWith("reeds") })).toEqual(["reedsMeasure"]);
    expect(coachCandidates({ topTab: "reeds", done: doneWith("reeds", "reedsMeasure") })).toEqual([]);
  });
  it("データタブ: 計測が済むまで(計測タブと共通の印)", () => {
    expect(coachCandidates({ topTab: "analysis", done: ALL_FALSE })).toEqual(["data"]);
    expect(coachCandidates({ topTab: "analysis", done: doneWith("measure") })).toEqual([]);
  });
  it("コミュニティ: 参加 → 奏者を開く → みんなの平均を目安に(前が済むまで次は出さない)", () => {
    expect(coachCandidates({ topTab: "community", done: ALL_FALSE })).toEqual(["join"]);
    expect(coachCandidates({ topTab: "community", done: doneWith("join") })).toEqual(["openPerson"]);
    // 1段目が済む前に2段目は出さない(平均カードがあっても)
    expect(coachCandidates({ topTab: "community", done: doneWith("join", "adoptAverage") })).toEqual(["openPerson"]);
    expect(coachCandidates({ topTab: "community", done: doneWith("join", "openPerson") })).toEqual(["adoptAverage"]);
    expect(coachCandidates({ topTab: "community", done: doneWith("join", "openPerson", "adoptAverage") })).toEqual([]);
  });
});

describe("済んだ印(立てるだけ・戻さない)", () => {
  it("立てると true になり、既に立っていれば同じ物を返す(書き込みを起こさない)", () => {
    const a = markOnboardingDone({}, "reeds");
    expect(a).toEqual({ reeds: true });
    expect(markOnboardingDone(a, "reeds")).toBe(a);
    expect(markOnboardingDone(a, "measure")).toEqual({ reeds: true, measure: true });
  });
  it("知らない名前では何もしない / 壊れた保存値でも立てられる", () => {
    const a = { reeds: true };
    expect(markOnboardingDone(a, "bogus")).toBe(a);
    expect(markOnboardingDone(null, "join")).toEqual({ join: true });
    expect(markOnboardingDone([1, 2], "join")).toEqual({ join: true });
  });
  it("読む形は true だけが「済み」(文字列や 1 は済みにしない)", () => {
    const n = normalizeOnboardingDone({ measure: true, reeds: "true", join: 1, migrated: true });
    expect(n).toEqual({ measure: true, reeds: false, reedsMeasure: false, join: false, openPerson: false, adoptAverage: false, migrated: true });
    expect(ONBOARDING_FLAGS).toEqual(["measure", "reeds", "reedsMeasure", "join", "openPerson", "adoptAverage"]);
  });
  it("計測が保存されたときの印: リードを紐づけていれば「このリードで計測」も", () => {
    expect(onboardingFlagsForSavedSession({ id: "s", reedId: null })).toEqual(["measure"]);
    expect(onboardingFlagsForSavedSession({ id: "s", reedId: "r1" })).toEqual(["measure", "reedsMeasure"]);
  });
});

describe("既にある人の移行(migrateOnboardingDone)", () => {
  const adopted = (p) => p?.sourceKind === "community";
  it("計測・リード・リードの紐づいた計測・取り込んだ目安があれば、その分を済みにする", () => {
    const r = migrateOnboardingDone({}, {
      sessions: [{ id: "s1", reedId: null }, { id: "s2", reedId: "r1" }],
      reeds: [{ id: "r1" }],
      idealProfiles: [{ id: "p1", sourceKind: "session" }, { id: "p2", sourceKind: "community", name: "しろねこ さんの目安" },
        { id: "p3", sourceKind: "community", name: "みんなの平均（クラシック 学生）" }],
      isAdopted: adopted,
    });
    expect(r).toEqual({ measure: true, reeds: true, reedsMeasure: true, openPerson: true, adoptAverage: true, migrated: true });
  });
  // 【便BP3 2026-10-03 統括の裁定】adoptAverage はみんなの平均の目安があるときだけ。人物の目安だけなら openPerson だけ。
  it("人物の目安だけなら openPerson だけ(adoptAverage は立てない)/ 条件の無いみんなの平均でも adoptAverage", () => {
    const person = migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "community", name: "しろねこ さんの目安" }], isAdopted: adopted });
    expect(person).toEqual({ openPerson: true, migrated: true });
    const avg = migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "community", name: "みんなの平均" }], isAdopted: adopted });
    expect(avg).toEqual({ openPerson: true, adoptAverage: true, migrated: true });
    // 取り込んでいない(自分の計測から作った)目安が「みんなの平均」という名前でも、取り込み扱いにしない
    const mine = migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "session", name: "みんなの平均" }], isAdopted: adopted });
    expect(mine).toEqual({ migrated: true });
  });
  it("何も無い人は migrated だけ(参加は決めない)", () => {
    expect(migrateOnboardingDone({}, { sessions: [], reeds: [], idealProfiles: [], isAdopted: adopted })).toEqual({ migrated: true });
  });
  it("紐づけの無い計測だけなら reedsMeasure は立てない / 自分の計測から作った目安では取り込み扱いにしない", () => {
    const r = migrateOnboardingDone({}, { sessions: [{ id: "s1" }], reeds: [], idealProfiles: [{ sourceKind: "session" }], isAdopted: adopted });
    expect(r).toEqual({ measure: true, migrated: true });
  });
  it("一度移行したら二度と数えない(データを消しても印は戻らない・立っている印を倒さない)", () => {
    const prev = { measure: true, reeds: true, join: true, migrated: true };
    expect(migrateOnboardingDone(prev, { sessions: [], reeds: [], idealProfiles: [], isAdopted: adopted })).toBe(prev);
    // 移行の前に立っていた印(成功の道で立った)も倒さない
    const before = { join: true };
    expect(migrateOnboardingDone(before, { sessions: [], reeds: [], idealProfiles: [], isAdopted: adopted })).toEqual({ join: true, migrated: true });
  });
});

describe("穴とカードの位置", () => {
  it("穴: 円は的の中心に長い辺 + pad×2 / ピル・角丸は的の矩形 + pad", () => {
    expect(holeOf({ left: 153.5, top: 616, width: 68, height: 68 }, { pad: 14, shape: "circle" }))
      .toEqual({ left: 139.5, top: 602, width: 96, height: 96, shape: "circle" });
    expect(holeOf({ left: 10, top: 20, width: 84, height: 32 }, { pad: 4, shape: "circle" }))
      .toEqual({ left: 6, top: -10, width: 92, height: 92, shape: "circle" });
    expect(holeOf({ left: 30, top: 442, width: 315, height: 57 }, { pad: 2, shape: "rect" }))
      .toEqual({ left: 28, top: 440, width: 319, height: 61, shape: "rect" });
    expect(holeOf({ left: 14, top: 283, width: 347, height: 44 }, { pad: 0, shape: "pill" }))
      .toEqual({ left: 14, top: 283, width: 347, height: 44, shape: "pill" });
  });
  // 【便BP5 2026-10-03 統括の裁定】画面の上端から下端まで 8px 刻みに置ける位置を全部試す(的から 22px ちょうどの上下と、いまの位置も)。
  //   (a) 重なりの重みが一番少ない → (b) 的に一番近い → (c) いまの位置を保つ
  const R = (left, top, right, bottom, label = "", fixed = false) => ({ left, top, right, bottom, label, fixed });
  it("何も無ければ、的から 22px ちょうど(的に一番近い所)に置く", () => {
    const rec = { left: 139.5, top: 602, width: 96, height: 96 };   // 録音ボタン: 下には入らないので上
    const a = placeCoachCard({ hole: rec, cardH: 146, vh: 812 });
    expect(a.side).toBe("above");
    expect(a.top + 146).toBe(602 - 22);
    expect(a.dist).toBe(22);
    expect(a.overlaps).toBe(false);
    const hi = { left: 14, top: 100, width: 347, height: 44 };     // 上には入らないので下
    const b = placeCoachCard({ hole: hi, cardH: 146, vh: 812 });
    expect(b.side).toBe("below");
    expect(b.top).toBe(100 + 44 + 22);
  });
  it("参加前: 的の上下 22px の位置は部品にかかる → 部品にかからない中で的に一番近い所(引継の下・8px 刻み)", () => {
    const hole = { left: 14, top: 283, width: 347, height: 44 };
    const avoid = [R(14, 186, 361, 208, "規約"), R(14, 230, 361, 262, "同意"), R(14, 341, 361, 385, "アカウント引継")];
    const p = placeCoachCard({ hole, cardH: 146, vw: 375, vh: 812, avoid });
    expect(p.hits).toEqual([]);
    expect(p.side).toBe("below");
    // 【便BP6】候補は部品の縁から作る: 引継の下端 385 + 余白 8 = 393
    expect(p.top).toBe(393);
    expect(p.dist).toBe(393 - 327);   // 上側で空いているのは 規約の上端 186 − 8 − 146 = 32 以下(的まで 105)なので、下のほうが近い
  });
  it("データタブ: 取り込みのボタン(貼り付いた部品)にも My Data / 分析にもかけない。そのうえで的(下部タブ)に一番近い所", () => {
    const hole = { left: 35.88, top: 762, width: 52, height: 52 };
    const avoid = [R(305, 697, 361, 753, "録音ファイルを取り込む", true), R(28, 580, 200, 610, "音程"), R(28, 40, 140, 70, "My Data"), R(150, 40, 220, 70, "分析"),
      R(320, 90, 350, 120, "累計の定義を見る")];
    const p = placeCoachCard({ hole, cardH: 146, vw: 375, vh: 812, bottomLimit: 765, avoid, scroll: { min: 0, max: 600 } });
    expect(p.hits).toEqual([]);
    expect(p.side).toBe("above");
    expect(p.top).toBe(426);          // 【便BP6】音程の上端 580 − 余白 8 − 146。取り込み・My Data・分析・累計の定義には重ならない
  });
  it("重み: 貼り付いた部品と、その位置でスクロールしても出せない部品は 10、出せる部品は 1", () => {
    // ページの先頭(scrollY 0)の子タブ(40〜70)。カードを画面の上端(22〜168)に置くと、上へは逃がせない(先頭)・
    // 下へ逃がすにはページを戻す必要があるが scrollY 0 で戻せない → 出せない
    const tab = R(28, 40, 140, 70, "My Data");
    expect(canScrollOut(tab, 22, 168, { min: 0, max: 600 }, 0, 765)).toBe(false);
    // 同じ部品でも、ページを 300 下げたところ(戻せる幅がある)なら、カードの下へ出せる
    expect(canScrollOut(tab, 22, 168, { min: -300, max: 300 }, 0, 765)).toBe(true);
    // ページの途中の部品(580〜610)はカード(450〜596)の下から上へ逃がせる
    expect(canScrollOut(R(28, 580, 200, 610), 450, 596, { min: 0, max: 600 }, 0, 765)).toBe(true);
    // 置き場所での数え方: 的(下部タブ)の上は貼り付いた部品(236〜760。浮かせるボタンの代わり)でふさがっている。
    // 残るのは上の方だけで、(ア)ページの先頭の背の高い子タブ(30〜80。カードの上に逃がせない = 10)にかかる位置か、
    // (イ)ページの途中の2行(180〜225。スクロールで出せる = 1 ずつ)にかかる位置。(イ)のほうが軽い。
    const hole = { left: 35.88, top: 762, width: 52, height: 52 };
    const p = placeCoachCard({ hole, cardH: 146, vw: 375, vh: 812, bottomLimit: 765, scroll: { min: 0, max: 600 },
      avoid: [R(28, 30, 140, 80, "My Data"), R(28, 180, 361, 200, "行1"), R(28, 205, 361, 225, "行2"), R(28, 236, 361, 760, "貼り付いた部品", true)] });
    expect(p.hits.map((h) => h.label)).toEqual(["行1", "行2"]);   // 子タブにも貼り付いた部品にもかけない
    expect(p.weight).toBe(2);
    expect(p.top).toBe(88);           // 【便BP6】子タブの下端 80 + 余白 8
  });
  it("同じ重み・同じ近さなら、いまの位置を保つ(スクロールで上下に跳ばない)/ いまの位置が重くなれば移る", () => {
    const hole = { left: 30, top: 440, width: 319, height: 61 };   // 上(272)も下(523)も的から 22px
    expect(placeCoachCard({ hole, cardH: 146, vw: 375, vh: 812 }).top).toBe(272);
    const kept = placeCoachCard({ hole, cardH: 146, vw: 375, vh: 812, prevTop: 523 });
    expect(kept.top).toBe(523);
    expect(kept.side).toBe("below");
    const moved = placeCoachCard({ hole, cardH: 146, vw: 375, vh: 812, prevTop: 523, avoid: [R(14, 600, 361, 640, "下の行")] });
    expect(moved.top).toBe(272);
    expect(moved.side).toBe("above");
  });
  it("両側とも足りないときだけ画面の中(上下 22px)に寄せる(そのときは重なりを報告する)", () => {
    const big = { left: 14, top: 100, width: 347, height: 560 };
    const c = placeCoachCard({ hole: big, cardH: 146, vh: 812 });
    expect(c.top).toBeGreaterThanOrEqual(22);
    expect(c.top + 146).toBeLessThanOrEqual(812 - 22);
    expect(c.overlaps).toBe(true);
  });
  it("的が画面の中にまるごと見えているときだけ出す(大きさ 0・はみ出しは出さない)", () => {
    const r = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
    expect(targetVisible(r(10, 10, 50, 50), 375, 812)).toBe(true);
    expect(targetVisible(r(0, 0, 0, 0), 375, 812)).toBe(false);
    expect(targetVisible(r(10, 790, 50, 50), 375, 812)).toBe(false);   // 下にはみ出す(スクロールの先)
    expect(targetVisible(r(400, 10, 50, 50), 375, 812)).toBe(false);   // ページャの隣のページ
    expect(targetVisible(r(10, -5, 50, 50), 375, 812)).toBe(false);
    expect(targetVisible(r(-5, 10, 50, 50), 375, 812)).toBe(false);   // 左にはみ出す(R11)
  });
  it("溶ける時間は計算済みの style から読む(0.35s / 350ms / 一括指定)。読めなければ 0", () => {
    expect(leaveDurationMs({ animationDuration: "0.35s" })).toBe(350);
    expect(leaveDurationMs({ animationDuration: "350ms" })).toBe(350);
    expect(leaveDurationMs({ animationDuration: "", animation: "coach-out 350ms ease-out forwards" })).toBe(350);
    expect(leaveDurationMs({ animationDuration: "", animation: "" })).toBe(0);
  });
});

// ------------------------------------------------------------------
// 部品。index.css をそのまま読み込み(jsdom は stylesheet の宣言を getComputedStyle に通す)、
// 的の要素の矩形は data-r="left,top,width,height" で決める(jsdom は配置を計算しないので)。
// ------------------------------------------------------------------
let root; let host; let realRect; let realMM; let styleEl; let realRaf; let realSetTimeout;
let cardH = 146; let rafCalls = 0; let pollCalls = 0;
const W = 375; const H = 812;
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
  // rAF と「250ms の探し直し」を数える(便BP3 統括の裁定 5)。中身はそのまま呼ぶ。
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
// 的(録音ボタンの代わり)。data-coach は実装の綴り、矩形は 375×812 の実測と同じ。
function Target({ name = "measure", r = "153.5,616,68,68" }) {
  return <button type="button" data-coach={name} data-r={r}>的</button>;
}
async function draw({ candidates = ["measure"], done = ALL_FALSE, hidden = false, target = <Target /> } = {}) {
  await act(async () => {
    root.render(<>{target}<OnboardingCoach candidates={candidates} done={done} hidden={hidden} /></>);
  });
  await frames();
}

describe("OnboardingCoach(出る・出ない)", () => {
  it("出る: 暗幕の穴は的の矩形 + pad、カードは role=status で見出しと1行を読ませる・フォーカスは奪わない", async () => {
    const before = document.activeElement;
    await draw();
    const L = layer();
    expect(L).not.toBe(null);
    expect(L.getAttribute("data-coach-layer")).toBe("measure");
    const hole = L.querySelector(".coach-hole");
    expect([hole.style.left, hole.style.top, hole.style.width, hole.style.height]).toEqual(["139.5px", "602px", "96px", "96px"]);
    expect(hole.style.borderRadius).toBe("50%");
    expect(hole.getAttribute("aria-hidden")).toBe("true");
    const card = L.querySelector(".coach-card");
    // 【便BP3】読み上げは常に在る空の role=status が持つ(カードは同じ文を見せるだけなので aria-hidden)
    expect(card.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(live().textContent).toBe("最初の計測を記録しよう。ボタンタップで計測スタート");
    expect(card.querySelector(".coach-title").textContent).toBe("最初の計測を記録しよう");
    expect(card.querySelector(".coach-line").textContent).toBe("ボタンタップで計測スタート");
    expect(card.style.visibility).toBe("visible");
    // カードは的(穴)の上に 22px 離れて置かれる(下端 = 602 - 22)
    expect(parseFloat(card.style.top) + 146).toBe(580);
    expect(card.hasAttribute("tabindex")).toBe(false);
    expect(document.activeElement).toBe(before);
    // 重なり順はシート(60)より下・浮かぶボタン(45)より上
    expect(Number(L.style.zIndex)).toBe(55);
    // body へ出ている(SwipePager の transform の中に入らない)
    expect(L.parentElement).toBe(document.body);
  });
  // 【便BP3 2026-10-03 統括の裁定】便BP2 の「カードも通す」を改めた。カードは当たり判定を持ち、押せる部品と重ならない所に置く。
  it("暗幕と穴はタップを下へ通す(pointer-events: none)。カードだけが当たり判定を持つ。穴の縁に枠線は無い", async () => {
    await draw();
    const L = layer();
    expect(getComputedStyle(L).pointerEvents).toBe("none");
    expect(getComputedStyle(L.querySelector(".coach-hole")).pointerEvents).toBe("none");
    expect(getComputedStyle(L.querySelector(".coach-card")).pointerEvents).toBe("auto");
    const hs = getComputedStyle(L.querySelector(".coach-hole"));
    expect(hs.borderTopStyle === "" || hs.borderTopStyle === "none").toBe(true);
    expect(hs.boxShadow).toContain("var(--c-coach-dim)");
    // 的そのものは押せる(暗幕は的の上に何も置かない ── 的のクリックはそのまま届く)
    let clicked = 0;
    await act(async () => {
      root.render(<><button type="button" data-coach="measure" data-r="153.5,616,68,68" onClick={() => { clicked += 1; }}>的</button>
        <OnboardingCoach candidates={["measure"]} done={ALL_FALSE} hidden={false} /></>);
    });
    await frames();
    await act(async () => { document.querySelector('[data-coach="measure"]').click(); });
    expect(clicked).toBe(1);
    // 当たり判定を持つのはカードだけ(暗幕の層と穴は持たない)
    const own = [L, L.querySelector(".coach-hole"), L.querySelector(".coach-card")].map((el) => getComputedStyle(el).pointerEvents);
    expect(own).toEqual(["none", "none", "auto"]);
    // カードを押しても何も起きない(案内は残る・下の的にも届かない)
    clicked = 0;
    await act(async () => { layer().querySelector(".coach-card").click(); });
    expect(layer()).not.toBe(null);
    expect(clicked).toBe(0);
  });
  it("出ない: hidden(録音中・シートが開いている・読み込み前)", async () => {
    await draw({ hidden: true });
    expect(layer()).toBe(null);
  });
  it("出ない: 出し得る一手が無い(済み・マイク未許可で候補が空)", async () => {
    await draw({ candidates: [] });
    expect(layer()).toBe(null);
  });
  it("出ない: 的が無い(一覧が空・平均が出ていない = 的が名乗らない)", async () => {
    await draw({ candidates: ["openPerson"], target: <Target name="somethingElse" r="30,442,315,57" /> });
    expect(layer()).toBe(null);
  });
  it("的が画面の外なら出さず、スクロールで戻れば出る", async () => {
    await draw({ candidates: ["openPerson"], target: <Target name="openPerson" r="30,900,315,57" /> });
    expect(layer()).toBe(null);
    await act(async () => { document.querySelector('[data-coach="openPerson"]').setAttribute("data-r", "30,442,315,57"); });
    await frames(320);   // 的が無い間は 250ms ごとに探し直す
    expect(layer()?.getAttribute("data-coach-layer")).toBe("openPerson");
    const hole = layer().querySelector(".coach-hole");
    expect([hole.style.left, hole.style.top, hole.style.width, hole.style.height]).toEqual(["28px", "440px", "319px", "61px"]);
    expect(hole.style.borderRadius).toBe("var(--r-2)");
  });
  it("追従: 的が動けば穴も動く(rAF)", async () => {
    await draw();
    await act(async () => { document.querySelector('[data-coach="measure"]').setAttribute("data-r", "153.5,471,68,68"); });
    await frames();
    expect(layer().querySelector(".coach-hole").style.top).toBe("457px");
  });
  it("表に出ている間に hidden になったら(シートが開いた)、溶かさずに即座に消える", async () => {
    await draw();
    expect(layer()).not.toBe(null);
    await act(async () => {
      root.render(<><Target /><OnboardingCoach candidates={["measure"]} done={ALL_FALSE} hidden /></>);
    });
    expect(layer()).toBe(null);
  });
  it("一手が済まずに候補から外れた(タブを移った)ときも、溶かさずに即座に消える", async () => {
    await draw();
    await act(async () => {
      root.render(<><Target /><OnboardingCoach candidates={[]} done={ALL_FALSE} hidden={false} /></>);
    });
    await frames(30);
    expect(layer()).toBe(null);
  });
});

describe("OnboardingCoach(便BP3: 置き場所・追従の止め方・読み上げ・測る前)", () => {
  it("押せる部品の上には置かない(的の上に部品があれば、空いている所へ)", async () => {
    await draw({ target: <><Target /><button type="button" data-r="22,440,331,40">上の部品</button></> });
    const card = layer().querySelector(".coach-card");
    const top = parseFloat(card.style.top);
    expect(top + 146 <= 440 || top >= 480).toBe(true);    // 部品(440〜480)と重ならない
    expect(top + 146 <= 602 || top >= 698).toBe(true);    // 穴とも重ならない
  });
  // 【便BP5 2026-10-03 統括の裁定 3】スクロール中は部品を読み直さず(200ms に1回まで)、ページが動いた分を差し引いて置く。
  it("スクロールで部品が動いたら、読み直しを待たずに(差し引きで)避ける", async () => {
    await draw({ target: <><Target /><button type="button" data-r="22,440,331,40">部品</button></> });
    expect(parseFloat(layer().querySelector(".coach-card").style.top)).toBe(286);   // 部品の上端 440 − 余白 8 − 146(的に一番近い縁)
    // ページを 100 下げた: 部品は 340〜380 へ(的は画面に貼り付いたまま)。読み直しの間隔(200ms)より前に見る
    Object.defineProperty(window, "scrollY", { value: 100, configurable: true });
    await act(async () => { document.querySelector("button:not([data-coach])").setAttribute("data-r", "22,340,331,40"); });
    await frames(60);
    const top = parseFloat(layer().querySelector(".coach-card").style.top);
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    expect(top + 146 <= 340 || top >= 380).toBe(true);   // 動いた先の部品と重ならない
    expect(top).toBe(434);                               // 的から 22px(部品が上へどいたので、的に一番近い所が空いた)
  });
  // 【便BP6 2026-10-03 統括の裁定】スクロールしている間は置き直さない(画面に固定)。止まってから1回だけ。
  // 穴の上下 22px の内側に入ったときだけ即座に置き直す。審査の値(参加後1・375×812)で、1px ずつ 200px スクロールする。
  it("1px ずつスクロールしても、カードが動くのは止まったあとの1回と、穴の上下 22px に入ったときだけ。向きの反転は 0 回", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 2000, configurable: true });
    // [left, top, width, height](ページの座標。scrollY ぶん上へずらして画面の座標にする)
    const PAGE = { tabs: [14, 10, 347, 40], pills: [14, 58, 347, 34], avg: [14, 108, 347, 314], inset: [30, 205, 315, 200],
      row1: [30, 441.97, 315, 57], row2: [30, 498.97, 315, 57], row3: [30, 555.97, 315, 57], row4: [30, 612.97, 315, 57] };
    const at = (k, sy) => { const [l, t, w, h] = PAGE[k]; return `${l},${t - sy},${w},${h}`; };
    const page = (sy) => (<>
      <button type="button" data-r={at("tabs", sy)}>子タブ</button>
      <button type="button" data-r={at("pills", sy)}>条件</button>
      <div data-coach-avoid="" data-r={at("avg", sy)}><div role="button" data-r={at("inset", sy)}>平均の台紙</div></div>
      <div role="button" data-coach="openPerson" data-r={at("row1", sy)}>しろねこ</div>
      <div role="button" data-r={at("row2", sy)}>くろねこ</div>
      <div role="button" data-r={at("row3", sy)}>みけねこ</div>
      <div role="button" data-r={at("row4", sy)}>とらねこ</div>
      <div style={{ position: "fixed" }}><button type="button" data-r="0,765,375,47">下部タブ</button></div>
    </>);
    const drawAt = (sy) => act(async () => {
      Object.defineProperty(window, "scrollY", { value: sy, configurable: true });
      root.render(<>{page(sy)}<OnboardingCoach candidates={["openPerson"]} done={ALL_FALSE} hidden={false} /></>);
    });
    await drawAt(0);
    await frames(260);
    const card = () => layer().querySelector(".coach-card");
    const cardTop = () => parseFloat(card().style.top);
    const holeOfNow = () => { const h = layer().querySelector(".coach-hole").style; return { top: parseFloat(h.top), height: parseFloat(h.height) }; };
    const sideNow = () => (cardTop() + 146 <= holeOfNow().top ? "above" : "below");
    const firstSide = sideNow();
    let prevTop = cardTop();
    const changes = [];
    let flips = 0;
    let lastSide = firstSide;
    let intrusions = 0;
    // 下へ 200px スクロールして、上へ 200px 戻す(戻すときは穴がカードへ近づくので、22px に入る置き直しも通る)
    const seq = [...Array.from({ length: 200 }, (_, i) => i + 1), ...Array.from({ length: 200 }, (_, i) => 199 - i)];
    for (const sy of seq) {
      await drawAt(sy);
      await act(async () => { document.dispatchEvent(new Event("scroll")); await new Promise((r) => setTimeout(r, 16)); });
      if (!layer()) break;   // 的が画面の外へ出たら隠れる(この値では出ない)
      const t = cardTop();
      if (Math.abs(t - prevTop) > 0.01) {
        // 置き直してよいのは、いままでの位置が新しい穴の上下 22px の内側に入ったときだけ
        const h = holeOfNow();
        changes.push({ sy, from: prevTop, to: t, intruded: prevTop < h.top + h.height + 22 && prevTop + 146 > h.top - 22 });
        prevTop = t;
      }
      const sd = sideNow();
      if (sd !== lastSide) { flips += 1; lastSide = sd; }
      // どの瞬間も、カードは穴の上下 22px の内側に居ない(入ったら即座に置き直している)
      const hh = holeOfNow();
      intrusions += (t < hh.top + hh.height + 22 - 1 && t + 146 > hh.top - 22 + 1) ? 1 : 0;
    }
    expect(intrusions).toBe(0);
    expect(layer()).not.toBe(null);
    expect(changes.filter((c) => !c.intruded)).toEqual([]);     // スクロール中の置き直しは、22px に入ったときだけ
    // 止まる(最後の scroll から 150ms 以上)→ 1回だけ置き直す(または今の位置を保つ)
    const before = cardTop();
    await frames(300);
    const afterStop = cardTop();
    await frames(300);
    expect(cardTop()).toBe(afterStop);                          // 止まったあとは動かない
    const moves = changes.length + (Math.abs(afterStop - before) > 0.01 ? 1 : 0);
    expect(moves).toBeLessThanOrEqual(3);
    if (sideNow() !== lastSide) flips += 1;
    expect(flips).toBe(0);                                      // 向きの反転は 0 回
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    delete document.documentElement.scrollHeight;
  }, 20000);
  it("スクロールで穴がカードに近づき、上下 22px に入ったときだけ即座に置き直す(それ以外は画面に固定)", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 2000, configurable: true });
    const drawAt = (sy) => act(async () => {
      Object.defineProperty(window, "scrollY", { value: sy, configurable: true });
      root.render(<><button type="button" data-coach="measure" data-r={`153.5,${616 - sy},68,68`}>的</button>
        <OnboardingCoach candidates={["measure"]} done={ALL_FALSE} hidden={false} /></>);
    });
    await drawAt(0);
    await frames(60);
    const cardTop = () => parseFloat(layer().querySelector(".coach-card").style.top);
    expect(cardTop()).toBe(434);   // 的の上 22px
    const tops = [];
    let intrusions = 0;
    for (let sy = 1; sy <= 300; sy++) {
      await drawAt(sy);
      await act(async () => { document.dispatchEvent(new Event("scroll")); await new Promise((r) => setTimeout(r, 16)); });
      const t = cardTop();
      const holeTop = 602 - sy; const holeBottom = 698 - sy;
      if (t < holeBottom + 22 - 1 && t + 146 > holeTop - 22 + 1) intrusions += 1;
      if (tops.length === 0 || tops[tops.length - 1] !== t) tops.push(t);
    }
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    delete document.documentElement.scrollHeight;
    expect(intrusions).toBe(0);
    // 434 のまま固定 → 穴が近づいて入った瞬間に置き直す。置き直しは数回まで(1px ごとに付いて動かない)
    expect(tops[0]).toBe(434);
    expect(tops.length).toBeGreaterThanOrEqual(2);
    expect(tops.length).toBeLessThanOrEqual(4);
  }, 20000);
  // 【便BP6】告知の帯の「元に戻す」「開く」は、帯の箱(祖先)が fixed。貼り付いた部品として重く数える。
  it("祖先が fixed の部品(告知の帯のボタン)は貼り付いた部品として数え、ほかの部品より先に避ける", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 3000, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
    await draw({ target: <>
      <Target />
      <div style={{ position: "fixed" }}><div><button type="button" data-r="22,450,331,40">元に戻す</button></div></div>
      <button type="button" data-r="22,30,331,20">a</button><button type="button" data-r="22,130,331,20">b</button>
      <button type="button" data-r="22,230,331,20">c</button><button type="button" data-r="22,330,331,20">d</button>
    </> });
    const top = parseFloat(layer().querySelector(".coach-card").style.top);
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    delete document.documentElement.scrollHeight;
    expect(top + 146 <= 450 || top >= 490).toBe(true);   // 帯のボタン(450〜490)には重ねない(ページの中の部品 a〜d のどれかには重なってよい)
  });
  // 【便BP5 2026-10-03 統括の裁定 P13】押せない(disabled)部品も避ける(条件がそろえば押す物なので隠さない)。
  it("disabled の部品にも重ねない", async () => {
    await draw({ target: <><Target /><button type="button" disabled data-r="22,440,331,40">押せない部品</button></> });
    const top = parseFloat(layer().querySelector(".coach-card").style.top);
    expect(top + 146 <= 440 || top >= 480).toBe(true);
  });
  // 【便BP4 2026-10-03 統括の裁定】画面の側が data-coach-avoid を付けた要素(読んでほしい文)にも重ねない。
  it("data-coach-avoid の印を付けた要素(押せない文)にも重ねない。印が無い文には重ねてよい", async () => {
    // 参加前と同じ形: 的(参加のボタン)の上に文、下にアカウント引継。画面の上寄りに説明文
    // 【便BP5】的の下に押せる部品(400〜560)。文に印が無ければ、文の上(的の上側の空き・的に近い)に置く。
    // 【便BP6】印を付けると、いまの位置(文の上)が重くなるので置き直す(下の部品のさらに下 = 568)
    const page = (avoidMark) => (<>
      <div data-r="14,40,347,120" {...(avoidMark ? { "data-coach-avoid": "" } : {})}>説明文</div>
      <button type="button" data-r="14,186,347,22">規約</button>
      <button type="button" data-coach="join" data-r="14,283,347,44">参加</button>
      <button type="button" data-r="14,341,347,44">アカウント引継</button>
      <button type="button" data-r="14,400,347,160">下の部品</button>
    </>);
    const overlapsText = () => { const t = parseFloat(layer().querySelector(".coach-card").style.top); return t < 160 && t + 146 > 40; };
    await draw({ candidates: ["join"], target: page(false) });
    expect(overlapsText()).toBe(true);    // 印が無ければ文の上に置く(文は数えない)
    await act(async () => { root.render(<>{page(true)}<OnboardingCoach candidates={["join"]} done={ALL_FALSE} hidden={false} /></>); });
    await frames(260);   // 部品の矩形は 200ms ごとに読み直す
    const top = parseFloat(layer().querySelector(".coach-card").style.top);
    expect(overlapsText()).toBe(false);   // 説明文(40〜160)と重ならない
    expect(top + 146 <= 341 || top >= 385).toBe(true);    // アカウント引継とも重ならない
  });
  it("測る前(カードの高さが 0 の間)はカードを見せない(R10)", async () => {
    cardH = 0;
    await draw();
    expect(layer()).not.toBe(null);
    expect(layer().querySelector(".coach-card").style.visibility).toBe("hidden");
    cardH = 146;
    await frames();
    expect(layer().querySelector(".coach-card").style.visibility).toBe("visible");
  });
  it("左にはみ出した的には出さない(R11)", async () => {
    await draw({ target: <Target r="-4,616,68,68" /> });
    expect(layer()).toBe(null);
  });
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
    await act(async () => { root.render(<><Target /><OnboardingCoach candidates={["measure"]} done={ALL_FALSE} hidden={false} /></>); });
    await frames(320);
    expect(layer()?.getAttribute("data-coach-layer")).toBe("measure");
    expect(rafCalls).toBeGreaterThan(0);
  });
  it("タブを切り替えた描画のうちに測り直す(古い案内を1フレームも残さない)", async () => {
    const both = <><Target /><span data-coach="nav-measure"><svg data-r="46.88,773,30,30" /></span></>;
    await draw({ target: both });
    expect(layer()?.getAttribute("data-coach-layer")).toBe("measure");
    await act(async () => { root.render(<>{both}<OnboardingCoach candidates={["data"]} done={ALL_FALSE} hidden={false} /></>); });
    // 時計も rAF も待たずに、同じ描画のうちに切り替わっている
    expect(layer()?.getAttribute("data-coach-layer")).toBe("data");
  });
  it("読み上げの入れ物は常に1つ。文は一手が変わったときと済んだときだけ変わる(隠れてまた出ても読み直さない)", async () => {
    await draw({ hidden: true });
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(live().textContent).toBe("");
    const el = live();
    let changes = 0;
    const mo = new MutationObserver((ms) => { changes += ms.length; });
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    const at = (hidden, done = ALL_FALSE, candidates = ["measure"]) => act(async () => {
      root.render(<><Target /><OnboardingCoach candidates={candidates} done={done} hidden={hidden} /></>);
    });
    await at(false); await frames();
    expect(el.textContent).toBe("最初の計測を記録しよう。ボタンタップで計測スタート");
    const afterFirst = changes;
    expect(afterFirst).toBeGreaterThan(0);
    await at(true); await frames();        // シートが開いた(案内は消える)
    expect(layer()).toBe(null);
    await at(false); await frames();       // 閉じた(同じ一手がまた出る)
    expect(layer()).not.toBe(null);
    expect(changes).toBe(afterFirst);      // 文は変わっていない = 読み直さない
    expect(live()).toBe(el);               // 入れ物も同じ物のまま
    await at(false, doneWith("measure"), []);   // 済んだ → 溶ける → 消えたら文を下ろす
    await act(async () => { layer().dispatchEvent(new Event("animationend", { bubbles: true })); });
    await frames();
    expect(el.textContent).toBe("");
    mo.disconnect();
  });
});

describe("リード2(2つの画面をまたぐ同じ一手)", () => {
  it("一覧のタイル(四角・角丸 --r-2)→ 詳細の計測ボタン(data-coach-shape=circle で丸)へ的が移る。文は同じ", async () => {
    await draw({ candidates: ["reedsMeasure"], target: <button key="tile" type="button" className="reedtile" data-coach="reedsMeasure" data-r="14,170,59,59">1</button> });
    expect(layer()?.getAttribute("data-coach-layer")).toBe("reedsMeasure");
    let hole = layer().querySelector(".coach-hole");
    expect([hole.style.left, hole.style.top, hole.style.width, hole.style.height, hole.style.borderRadius]).toEqual(["10px", "166px", "67px", "67px", "var(--r-2)"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("このリードで計測してみよう");
    expect(layer().querySelector(".coach-line").textContent).toBe("リードごとの違いが見えてきます");
    // 個体詳細へ(タイルは消え、計測ボタンが名乗る)
    await act(async () => {
      // 一覧のタイルと詳細の計測ボタンは別の要素(key を変えて別の DOM にする。本物も別の画面の別の要素)
      root.render(<><button key="fab" type="button" data-coach="reedsMeasure" data-coach-shape="circle" data-r="305,697,56,56">計測</button>
        <OnboardingCoach candidates={["reedsMeasure"]} done={ALL_FALSE} hidden={false} /></>);
    });
    await frames();
    expect(layer()?.getAttribute("data-coach-layer")).toBe("reedsMeasure");
    expect(layer().getAttribute("data-leaving")).toBe("false");
    hole = layer().querySelector(".coach-hole");
    expect([hole.style.left, hole.style.top, hole.style.width, hole.style.height, hole.style.borderRadius]).toEqual(["301px", "693px", "64px", "64px", "50%"]);
    expect(layer().querySelector(".coach-title").textContent).toBe("このリードで計測してみよう");
    // 【便BP6】的の要素が替わったら、いまの位置(一覧での位置)は保たず、新しい的のそばに置き直す
    await frames(60);
    const top = parseFloat(layer().querySelector(".coach-card").style.top);
    expect(top + 146).toBe(693 - 22);   // 詳細の計測ボタンの穴(693〜757)の上 22px
  });
});

describe("OnboardingCoach(済んだら溶ける / reduced-motion)", () => {
  it("一手が済むと data-leaving で 0.35 秒の溶けに入り、animationend で消える", async () => {
    await draw();
    await act(async () => {
      root.render(<><Target /><OnboardingCoach candidates={[]} done={doneWith("measure")} hidden={false} /></>);
    });
    const L = layer();
    expect(L).not.toBe(null);
    expect(L.getAttribute("data-leaving")).toBe("true");
    expect(getComputedStyle(L).animation).toBe("coach-out 350ms ease-out forwards");
    await act(async () => { L.dispatchEvent(new Event("animationend", { bubbles: true })); });
    expect(layer()).toBe(null);
  });
  it("animationend が来なくても、CSS の時間(350ms)が経てば消える(残らない)", async () => {
    await draw();
    await act(async () => {
      root.render(<><Target /><OnboardingCoach candidates={[]} done={doneWith("measure")} hidden={false} /></>);
    });
    expect(layer()?.getAttribute("data-leaving")).toBe("true");
    await frames(200);
    expect(layer()).not.toBe(null);          // まだ溶けている途中
    await frames(260);
    expect(layer()).toBe(null);
  });
  it("prefers-reduced-motion では溶けもしない(済んだ瞬間に消える。data-leaving の姿を一度も描かない)", async () => {
    window.matchMedia = (q) => ({ matches: q.includes("prefers-reduced-motion: reduce"), addEventListener() {}, removeEventListener() {} });
    await draw();
    expect(layer()).not.toBe(null);
    await act(async () => {
      root.render(<><Target /><OnboardingCoach candidates={[]} done={doneWith("measure")} hidden={false} /></>);
    });
    expect(layer()).toBe(null);
    // CSS の側も reduced-motion では溶けの動きを止める(同じ設定を両側で見る)
    expect(styleEl.textContent).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.coach-layer\[data-leaving="true"\] \{ animation: none; \}\s*\}/);
  });
  it("データタブの一手も、計測が保存された印(measure)で溶ける", async () => {
    await draw({ candidates: ["data"], target: <span data-coach="nav-measure"><svg data-r="46.88,773,30,30" /></span> });
    expect(layer()?.getAttribute("data-coach-layer")).toBe("data");
    const hole = layer().querySelector(".coach-hole");
    expect([hole.style.width, hole.style.height]).toEqual(["52px", "52px"]);
    await act(async () => {
      root.render(<><span data-coach="nav-measure"><svg data-r="46.88,773,30,30" /></span>
        <OnboardingCoach candidates={[]} done={doneWith("measure")} hidden={false} /></>);
    });
    expect(layer()?.getAttribute("data-leaving")).toBe("true");
  });
});
