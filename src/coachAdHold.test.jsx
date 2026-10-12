// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { useCoachAdHold, coachWaiting, coachCandidates, COACH_WAIT_RELIEF } from "./onboarding.jsx";

// ------------------------------------------------------------------
// 【便CO 2026-10-12 本人の実機指示・審査のあとの統括の決定】案内の流れの途中は広告の帯を止める ── 止め方の時機(useCoachAdHold)と、
// (c)「次の段が利用者の操作を待っているだけ」(coachWaiting)。統括の決定から手で書いた期待値:
//   ・止めを始めるのは engage((a) カード・(d) 参加の画面のカード)だけ。立った描画で止める
//   ・keep((b) 一時的に隠している・(c) 操作待ち・シート)は、止めている間だけ続ける。止めていなければ始めない(放置した人に止め続けない境目)
//   ・engage も keep も無くなってから待ちの長さ続いたら戻す。待ちのうちに次のカードが出たら一度も戻さない
//   ・(c) は「待ちの条件(テンポ行の静けさ・鳴り止む・計測の有無の読み込み)が明ければ出る段がある」こと。外押しで飛ばした段・済んだ段・
//     マイクの許可が無いことは待ちに数えない
// 時間は作り物の時計で進める。待ちの長さは引数で渡した値(1000)で振る舞いを見る(定数から期待値を作らない)。
// 待ちの長さそのもの(1秒)は App を描く検査 coachAdHoldApp.test.jsx の「外押しで飛ばした直後」が時間で見る。
// ------------------------------------------------------------------

let host; let root; let seen;
function Probe({ engage, keep, ms }) {
  const v = useCoachAdHold({ engage, keep }, ms);
  seen.push(v);
  return null;
}
async function draw(props) { await act(async () => { root.render(<Probe ms={1000} {...props} />); }); }
const last = () => seen[seen.length - 1];
async function advance(ms) { await act(async () => { vi.advanceTimersByTime(ms); }); }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  seen = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("【便CO】useCoachAdHold", () => {
  it("何も無いまま始まれば止めない", async () => {
    await draw({ engage: false, keep: false });
    expect(seen.every((v) => v === false)).toBe(true);
  });

  it("engage が立った描画で止める。下りても待ちの長さまでは止めたまま、過ぎたら戻す", async () => {
    await draw({ engage: false, keep: false });
    seen = [];
    await draw({ engage: true, keep: false });
    expect(seen[0]).toBe(true);   // 同じ描画で(state が追いつく前に)止まる
    await draw({ engage: false, keep: false });
    await advance(999);
    expect(last()).toBe(true);
    await advance(1);
    expect(last()).toBe(false);
  });

  it("待ちのうちに次のカードが出たら一度も戻さない(段の切り替わりでちらつかない)", async () => {
    await draw({ engage: true, keep: false });
    for (let i = 0; i < 5; i++) {
      await draw({ engage: false, keep: false });
      await advance(600);
      await draw({ engage: true, keep: false });
      await advance(100);
    }
    expect(seen.every((v) => v === true)).toBe(true);
  });

  it("止めている間は keep が続く限り戻さない。keep が下りてから待ちの長さで戻す", async () => {
    await draw({ engage: true, keep: false });
    await draw({ engage: false, keep: true });
    await advance(10000);
    expect(last()).toBe(true);
    await draw({ engage: false, keep: false });
    await advance(999);
    expect(last()).toBe(true);
    await advance(1);
    expect(last()).toBe(false);
  });

  it("【境目】止めていなければ keep だけでは止めない(戻ったあとも止め直さない)", async () => {
    await draw({ engage: false, keep: true });
    await advance(5000);
    expect(seen.every((v) => v === false)).toBe(true);
    // 一度止めて戻ったあと、keep だけが立っても止め直さない
    await draw({ engage: true, keep: false });
    await draw({ engage: false, keep: false });
    await advance(1000);
    expect(last()).toBe(false);
    seen = [];
    await draw({ engage: false, keep: true });
    await advance(3000);
    expect(seen.every((v) => v === false)).toBe(true);
  });
});

// 計測タブの、マイクが動いている人の引数(① ② は済み・面は開いている)
const BASE = {
  topTab: "measure", done: { tuner: true, metronome: true }, micReady: true, hasSessions: false, sessionsKnown: true,
  metroPanelOpen: true, metronomeOn: false, metroTempoQuiet: true, hasSelectedReed: false, idealRequested: false,
};

describe("【便CO】coachWaiting((c) 次の段が操作を待っているだけ)", () => {
  it("③ が済んでテンポ行に触っている間(④ は静けさ待ち)は待ち。静まれば ④ が出るので待ちではない", () => {
    const touching = { ...BASE, done: { ...BASE.done, metroTempo: true }, metroTempoQuiet: false };
    expect(coachCandidates(touching)).toEqual([]);
    expect(coachWaiting(touching)).toBe(true);
    expect(coachCandidates({ ...touching, metroTempoQuiet: true })).toEqual(["metroStart"]);
    expect(coachWaiting({ ...touching, metroTempoQuiet: true })).toBe(false);
  });

  it("④ のあと鳴っている間(⑤ は鳴り止むのを待つ)は待ち", () => {
    const playing = { ...BASE, done: { ...BASE.done, metroTempo: true, metroStart: true }, metronomeOn: true };
    expect(coachCandidates(playing)).toEqual([]);
    expect(coachWaiting(playing)).toBe(true);
  });

  it("鳴っていても、この起動で外押しで飛ばした段しか残っていなければ待ちではない(出る見込みが無い)", () => {
    const playing = { ...BASE, done: { ...BASE.done, metroTempo: true, metroStart: true }, metronomeOn: true };
    expect(coachWaiting({ ...playing, dismissed: ["goReeds", "measure"] })).toBe(false);
  });

  it("マイクの許可が無いことは待ちに数えない(許可されなかったら待っても出ない)", () => {
    expect(coachWaiting({ ...BASE, done: {}, micReady: false })).toBe(false);
  });

  it("データタブで計測の有無を読み込んでいる間は待ち(読み終われば出る)", () => {
    const loading = { ...BASE, topTab: "analysis", done: { arriveData: true }, hasSessions: true, sessionsKnown: false };
    expect(coachWaiting(loading)).toBe(true);
  });

  it("待ちの条件の表は3つだけ(テンポ行の静けさ・鳴り止む・計測の有無の読み込み)", () => {
    expect(COACH_WAIT_RELIEF).toEqual({ metroTempoQuiet: true, metronomeOn: false, sessionsKnown: true });
  });
});
