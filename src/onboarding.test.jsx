// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OnboardingCoach, COACH_STEPS, ONBOARDING_FLAGS, coachCandidates, normalizeOnboardingDone, markOnboardingDone,
  migrateOnboardingDone, onboardingFlagsForSavedSession, holeOf, placeCoachCard, targetVisible, leaveDurationMs,
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

const ALL_FALSE = normalizeOnboardingDone({ migrated: true });
const doneWith = (...flags) => ({ ...ALL_FALSE, ...Object.fromEntries(flags.map((f) => [f, true])) });

describe("文言(凍結仕様の表と本人の指示のとおり、一字一句)", () => {
  // [見出し, 1行(無ければ null), アイコン]
  const SPEC = {
    measure: ["最初の計測を記録しよう", "ボタンタップで計測スタート", "mic"],
    reeds: ["使っているリードを登録しよう", "計測に登録したリードを紐づけることができます", "reeds"],   // 【便BQ】本人の指示
    reedsMeasure: ["このリードで計測してみよう", null, "measure"],                                    // 【便BQ】1行は無し
    data: ["計測を始めると、ここに貯まります", "計測タブから計測してみよう", "data"],
    join: ["コミュニティに参加しよう", "みんなの計測データが見られます", "community"],
    adoptAverage: ["みんなの平均を目安にしてみよう", "目安に設定すると自分の音と比べられます", "target"],
  };
  it("6つの一手の見出し・1行・アイコンが表のとおり(過不足なし。参加後1「気になる奏者を開いてみよう」は無い)", () => {
    expect(Object.keys(COACH_STEPS).sort()).toEqual(Object.keys(SPEC).sort());
    for (const [id, [title, line, icon]] of Object.entries(SPEC)) {
      expect(COACH_STEPS[id].title, id).toBe(title);
      expect(COACH_STEPS[id].line, id).toBe(line);
      expect(COACH_STEPS[id].icon, id).toBe(icon);
    }
    expect(Object.values(COACH_STEPS).some((s) => s.title === "気になる奏者を開いてみよう")).toBe(false);
  });
  it("データタブの一手は計測タブと同じ印(計測が1件保存された)で済む", () => {
    expect(COACH_STEPS.data.flag).toBe("measure");
    expect(COACH_STEPS.measure.flag).toBe("measure");
  });
});

describe("どの一手を出すか(coachCandidates)", () => {
  it("計測タブ: マイクの許可が済んでいて、まだ計測していないときだけ", () => {
    expect(coachCandidates({ topTab: "measure", done: ALL_FALSE, micReady: true })).toEqual(["measure"]);
    expect(coachCandidates({ topTab: "measure", done: ALL_FALSE, micReady: false })).toEqual([]);
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
  it("コミュニティ: 参加 → 参加したら、すぐみんなの平均を目安に(【便BQ】奏者を開く段は無い)", () => {
    expect(coachCandidates({ topTab: "community", done: ALL_FALSE })).toEqual(["join"]);
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
    const n = normalizeOnboardingDone({ measure: true, reeds: "true", join: 1, openPerson: true, migrated: true });
    expect(n).toEqual({ measure: true, reeds: false, reedsMeasure: false, join: false, adoptAverage: false, migrated: true });
    expect(ONBOARDING_FLAGS).toEqual(["measure", "reeds", "reedsMeasure", "join", "adoptAverage"]);
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
    expect(r).toEqual({ measure: true, reeds: true, reedsMeasure: true, adoptAverage: true, migrated: true });
  });
  it("人物の目安だけなら何も立てない / 自分の計測から作った目安が「みんなの平均」という名前でも取り込み扱いにしない", () => {
    expect(migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "community", name: "しろねこ さんの目安" }], isAdopted: adopted }))
      .toEqual({ migrated: true });
    expect(migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "session", name: "みんなの平均" }], isAdopted: adopted }))
      .toEqual({ migrated: true });
    expect(migrateOnboardingDone({}, { idealProfiles: [{ sourceKind: "community", name: "みんなの平均" }], isAdopted: adopted }))
      .toEqual({ adoptAverage: true, migrated: true });
  });
  it("何も無い人は migrated だけ(参加は決めない)", () => {
    expect(migrateOnboardingDone({}, { sessions: [], reeds: [], idealProfiles: [], isAdopted: adopted })).toEqual({ migrated: true });
  });
  it("一度移行したら二度と数えない(データを消しても印は戻らない・立っている印を倒さない)", () => {
    const prev = { measure: true, reeds: true, join: true, migrated: true };
    expect(migrateOnboardingDone(prev, { sessions: [], reeds: [], idealProfiles: [], isAdopted: adopted })).toBe(prev);
    expect(migrateOnboardingDone({ join: true }, { sessions: [], reeds: [], idealProfiles: [], isAdopted: adopted })).toEqual({ join: true, migrated: true });
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
  it("中央のカードが的にかかる場面(参加前)だけ、的の下へずらす", async () => {
    await draw({ candidates: ["join"], target: <Target name="join" r="14,283,347,44" /> });
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
