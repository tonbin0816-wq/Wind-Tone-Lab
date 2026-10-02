// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BM 再審査 2026-10-02 統括 1】計測タブの環の大きさの「据え置き(hold)」が解けない経路を塞いだ。
// useRingFitLayout(App.jsx)を実際に描いて、hold の上げ下げを3つの経路で確かめる:
//   (1) focusout で下りる(見張りの rAF は止めておく = イベントの経路だけを見る)
//   (2) visualViewport の resize で上がる(ピンチ拡大。見張りは止めておく)
//   (3) **イベントなしで入力欄が DOM から消える**と、hold 中だけ回る rAF の見張りが下ろす
//       (focusout を window の捕捉の段で握りつぶし、フックへ届かせない)
// rAF はここで手回しにする(本物のフレームを待たない)。
// 【守っていないもの】実機の Safari が入力欄の消滅で focusout を出すかどうか。それを当てにしない作りであることだけを見る。
// ------------------------------------------------------------------
const { useRingFitLayout } = await import("./App.jsx");

let root; let host; let last; let rafQ; let rafOn;
function Probe() {
  last = useRingFitLayout();
  return null;
}
const flushRaf = async (n = 3) => {
  for (let i = 0; i < n; i++) {
    const q = rafQ; rafQ = [];
    await act(async () => { q.forEach((cb) => cb(performance.now())); });
  }
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  rafQ = []; rafOn = true;
  vi.stubGlobal("requestAnimationFrame", (cb) => { if (rafOn) rafQ.push(cb); return rafQ.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  delete window.visualViewport;
});

const addInput = () => { const i = document.createElement("input"); document.body.appendChild(i); return i; };

describe("環の大きさの据え置き(useRingFitLayout の hold)", () => {
  it("入力欄にフォーカスすると hold が上がる / focusout で下りる(見張りなし)", async () => {
    rafOn = false; // 見張りを回さない = イベントの経路だけ
    await act(async () => { root.render(<Probe />); });
    expect(last.hold).toBe(false);
    const i = addInput();
    await act(async () => { i.focus(); });
    expect(last.hold).toBe(true);
    await act(async () => { i.blur(); await new Promise((r) => setTimeout(r, 10)); });
    expect(last.hold).toBe(false);
  });

  it("visualViewport の resize でピンチ拡大を拾って hold が上がる / 戻すと下りる(見張りなし)", async () => {
    rafOn = false;
    const vv = new EventTarget();
    vv.scale = 1; vv.height = 667; vv.width = 375;
    window.visualViewport = vv;
    await act(async () => { root.render(<Probe />); });
    expect(last.hold).toBe(false);
    vv.scale = 2;
    await act(async () => { vv.dispatchEvent(new Event("resize")); });
    expect(last.hold).toBe(true);
    vv.scale = 1;
    await act(async () => { vv.dispatchEvent(new Event("resize")); });
    expect(last.hold).toBe(false);
  });

  it("イベントなしで入力欄が消えても、hold 中の見張り(rAF)が下ろす", async () => {
    await act(async () => { root.render(<Probe />); });
    const i = addInput();
    await act(async () => { i.focus(); });
    expect(last.hold).toBe(true);
    // focusout / blur をフックへ届かせない(window の捕捉の段で止める)
    const stop = (e) => e.stopImmediatePropagation();
    window.addEventListener("focusout", stop, true);
    window.addEventListener("blur", stop, true);
    try {
      await act(async () => { i.remove(); await new Promise((r) => setTimeout(r, 10)); });
      expect(document.activeElement === i).toBe(false);
      await flushRaf();
      expect(last.hold).toBe(false);
      // 下ろしたあと見張りは止まる(次のフレームを予約しない)
      expect(rafQ.length).toBe(0);
    } finally {
      window.removeEventListener("focusout", stop, true);
      window.removeEventListener("blur", stop, true);
    }
  });

  it("hold が立っていない間は見張りを回さない(rAF を予約しない)", async () => {
    await act(async () => { root.render(<Probe />); });
    expect(last.hold).toBe(false);
    expect(rafQ.length).toBe(0);
  });
});
