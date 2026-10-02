// @vitest-environment jsdom
import React, { act, useState } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BK 2026-10-02 本人の実機報告】「My Data から分析へのスクロール移動に引っかかりがある。移動するとき一瞬止まる」。
// SwipePager は、指を離した瞬間に**自分だけ**を描き直して行き先の位置を書き、親への onIndexChange は
// 描いたあと(requestAnimationFrame → setTimeout → startTransition)に渡す。ここでは本物の SwipePager を描き、
// 指の動きを touchstart / touchmove / touchend で流して確かめる。
//   ・離した直後: track はもう行き先の位置。親はまだ知らない(onIndexChange 0回・ページの中身は描き直されていない)
//   ・描いたあと: onIndexChange がちょうど1回、行き先の番号で来る。位置は動かない(行き先のまま)
//   ・しきい値に届かない引き方は今までどおり元の位置へ戻り、親へは何も渡さない
//   ・遅らせているあいだに親が別のページへ動かしたら、親が勝つ(あとから上書きしない)
//   ・親が受け取らなかったら、見た目も親の番号へ戻る(ずれたまま残らない)
//   ・続けて2回引いたら、親へ渡すのは最後の行き先1回だけ
//   ・遅らせているあいだに消えても、あとから呼ばない
// 期待値はここに手で書いた(定数から逆算しない)。jsdom は幅を測れないので、しきい値は「幅が測れなければ 60px」側を通る。
// 【守っていないもの】実際の動きの滑らかさ(フレームの間隔)。375×812・CPU 4x/6x の実測は報告に書いた。
// ------------------------------------------------------------------
const { SwipePager } = await import("./App.jsx");

let root; let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // requestAnimationFrame は「次のフレーム」= 16ms 後の setTimeout として動かす(jsdom の既定に頼らない)。
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  spy = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const renders = { page: 0 };
function Page({ label }) {
  renders.page += 1;
  return <div style={{ height: 100 }}>{label}</div>;
}
let api = null;
// React の外の記録(消えた部品の setState は捨てられるので、呼ばれたかどうかはここで見る)
let spy = [];
function Harness({ pages = 2, accept = true }) {
  const [index, setIndex] = useState(0);
  const [calls, setCalls] = useState([]);
  api = { index, calls, setIndex };
  return (
    <SwipePager index={index} onIndexChange={(i) => { spy.push(i); setCalls((c) => [...c, i]); if (accept) setIndex(i); }}>
      {Array.from({ length: pages }, (_, i) => <Page key={i} label={`p${i}`} />)}
    </SwipePager>
  );
}

const viewport = () => host.firstElementChild;
const track = () => viewport().firstElementChild;
const at = (i) => track().style.transform.startsWith(`translateX(calc(${i === 0 ? "0" : -i * 100}% `);
const touch = (type, x, y = 200) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  const list = type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(ev, "touches", { value: list });
  return ev;
};
// 指で dx だけ横へ引いて離す。離した直後(遅らせた呼び出しの前)で止める。
async function swipe(dx) {
  const el = viewport();
  await act(async () => {
    el.dispatchEvent(touch("touchstart", 200));
    for (let k = 1; k <= 5; k++) el.dispatchEvent(touch("touchmove", 200 + (dx * k) / 5));
    el.dispatchEvent(touch("touchend", 200 + dx));
  });
}
// 遅らせた呼び出し(次のフレーム → setTimeout → startTransition)が済むまで待つ。
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 80)); }); };

describe("SwipePager: 指を離したら今すぐ動き、親へは描いたあとに渡す(便BK)", () => {
  it("左へ100px: 離した直後に行き先の位置・親はまだ知らない → 描いたあとに onIndexChange(1) が1回", async () => {
    await act(async () => { root.render(<Harness />); });
    expect(at(0)).toBe(true);
    const before = renders.page;

    await swipe(-100);
    expect(at(1)).toBe(true);                    // もう行き先(親の描き直しを待っていない)
    expect(api.calls).toEqual([]);               // 親へはまだ渡していない
    expect(spy).toEqual([]);
    expect(api.index).toBe(0);
    expect(renders.page).toBe(before);           // ページの中身は描き直していない

    await settle();
    expect(api.calls).toEqual([1]);
    expect(api.index).toBe(1);
    expect(at(1)).toBe(true);                    // 位置はそのまま(戻ったり跳ねたりしない)

    await swipe(100);                            // 右へ引けば戻る(向きは今までどおり)
    expect(at(0)).toBe(true);
    await settle();
    expect(api.calls).toEqual([1, 0]);
  });

  it("しきい値(幅が測れないときは 60px)に届かない引き方は元へ戻り、親へは何も渡さない", async () => {
    await act(async () => { root.render(<Harness />); });
    await swipe(-40);
    expect(at(0)).toBe(true);
    expect(track().style.transform).toBe("translateX(calc(0% - 0 * var(--sp-4) + 0px))");
    await settle();
    expect(api.calls).toEqual([]);
  });

  it("遅らせているあいだに親が別のページへ動かしたら、親が勝つ(あとから上書きしない)", async () => {
    await act(async () => { root.render(<Harness pages={3} />); });
    await swipe(-100);
    expect(at(1)).toBe(true);
    await act(async () => { api.setIndex(2); });  // 子タブの文字を押した、など
    expect(at(2)).toBe(true);
    await settle();
    expect(api.calls).toEqual([]);
    expect(api.index).toBe(2);
    expect(at(2)).toBe(true);
  });

  it("親が受け取らなかったら、見た目も親の番号へ戻る(ずれたまま残らない)", async () => {
    await act(async () => { root.render(<Harness accept={false} />); });
    await swipe(-100);
    expect(at(1)).toBe(true);
    await settle();
    expect(api.calls).toEqual([1]);
    expect(api.index).toBe(0);
    expect(at(0)).toBe(true);
  });

  it("続けて2回引いたら、親へ渡すのは最後の行き先1回だけ(2回目は見た目の位置から引く)", async () => {
    await act(async () => { root.render(<Harness pages={3} />); });
    await swipe(-100);
    await swipe(-100);
    expect(at(2)).toBe(true);
    await settle();
    expect(api.calls).toEqual([2]);
    expect(api.index).toBe(2);
    expect(at(2)).toBe(true);
  });

  it("遅らせているあいだに消えても、あとから呼ばない", async () => {
    await act(async () => { root.render(<Harness />); });
    await swipe(-100);
    await act(async () => { root.render(<div />); });
    await settle();
    expect(spy).toEqual([]);
  });
});
