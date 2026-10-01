// @vitest-environment jsdom
import React, { act, useState } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BG 2026-10-01 統括裁定「器を直す」】Escape で閉じるのは、開いている BottomSheet の**いちばん上の1枚だけ**。
// 以前はどの器も window の keydown で閉じていたので、重なったシートが Escape 1回で全部閉じた。
// 守るもの:
//   ・2枚重ね: 1回目で上だけ、2回目で下も閉じる(3枚でも同じく1枚ずつ)
//   ・同じ描画で親子が一緒に開いた場合も、閉じるのは子(上)から
//   ・Escape 以外のキーでは閉じない
// 用語の吹き出し → シート の順(吹き出しが先に止める)は termTip.test.jsx が見る。
// ------------------------------------------------------------------
const { BottomSheet } = await import("./App.jsx");

let root; let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const dialog = (label) => document.querySelector(`[role="dialog"][aria-label="${label}"]`);
const press = (key) => act(async () => {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
});

// 下から順に開いていく3枚(A の中から B、B の中から C)。initial で最初に開いているものを決める。
function Stack({ initial }) {
  const [open, setOpen] = useState(initial);
  const close = (k) => () => setOpen((o) => ({ ...o, [k]: false }));
  return (
    <>
      {open.A ? (
        <BottomSheet ariaLabel="A" onClose={close("A")}>
          <div>A</div>
          {open.B ? (
            <BottomSheet ariaLabel="B" onClose={close("B")}>
              <div>B</div>
              {open.C ? <BottomSheet ariaLabel="C" onClose={close("C")}><div>C</div></BottomSheet> : null}
            </BottomSheet>
          ) : null}
        </BottomSheet>
      ) : null}
      <button type="button" data-open-b onClick={() => setOpen((o) => ({ ...o, B: true }))}>B</button>
      <button type="button" data-open-c onClick={() => setOpen((o) => ({ ...o, C: true }))}>C</button>
    </>
  );
}

describe("BottomSheet の Escape はいちばん上の1枚だけ", () => {
  it("2枚重ね(あとから開いた上の1枚): 1回目で上だけ、2回目で下も閉じる", async () => {
    await act(async () => { root.render(<Stack initial={{ A: true }} />); });
    await act(async () => { host.querySelector("[data-open-b]").click(); });
    expect(dialog("A")).not.toBe(null);
    expect(dialog("B")).not.toBe(null);
    await press("Escape");
    expect(dialog("B")).toBe(null);
    expect(dialog("A")).not.toBe(null);
    await press("Escape");
    expect(dialog("A")).toBe(null);
  });

  it("同じ描画で親子が一緒に開いても、閉じるのは子(上)から1枚ずつ", async () => {
    await act(async () => { root.render(<Stack initial={{ A: true, B: true, C: true }} />); });
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(3);
    await press("Escape");
    expect(dialog("C")).toBe(null);
    expect(dialog("B")).not.toBe(null);
    expect(dialog("A")).not.toBe(null);
    await press("Escape");
    expect(dialog("B")).toBe(null);
    expect(dialog("A")).not.toBe(null);
    await press("Escape");
    expect(dialog("A")).toBe(null);
  });

  it("上を閉じたあとに開き直した1枚が、また上になる", async () => {
    await act(async () => { root.render(<Stack initial={{ A: true, B: true }} />); });
    await press("Escape");
    expect(dialog("B")).toBe(null);
    await act(async () => { host.querySelector("[data-open-b]").click(); });
    expect(dialog("B")).not.toBe(null);
    await press("Escape");
    expect(dialog("B")).toBe(null);
    expect(dialog("A")).not.toBe(null);
  });

  it("Escape 以外のキーでは閉じない", async () => {
    await act(async () => { root.render(<Stack initial={{ A: true, B: true }} />); });
    await press("Enter");
    await press("a");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
  });
});
