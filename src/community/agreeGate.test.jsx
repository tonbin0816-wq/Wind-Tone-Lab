// @vitest-environment jsdom
import React, { act, useState } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BC 2026-09-25 本人選定 ficus-block-mock.html「4. 参加の画面」】規約への同意のチェック(AgreeRow)。
// 【便CC 2026-10-08 本人「最初に同意撮るのでコミュニティで同意出すのはやめて」】参加の画面(JoinIntro)の同意のチェックは外した。
// 同意は起動の最初の同意の画面(src/ConsentScreen.jsx)で取る(根の振る舞いは src/consentGate.test.jsx)。ここでは:
//   ・参加の画面にチェックボックスが1つも無く、最初から押せて onJoin が呼ばれる(【便CD】押す先はカードそのもの = 「参加する」のボタン)
//   ・部品 AgreeRow(同意の画面の2枚目の帯が使う): 行全体が label で高さ --tap-min・中身はネイティブの checkbox・行の文字を押しても入る
// 【守っていないもの】箱の見た目(20px・角丸 6px・枠・レ点)の実寸。ブラウザで目で見た(報告)。
// ------------------------------------------------------------------
const { JoinIntro } = await import("./CommunityTab.jsx");
const { AgreeRow } = await import("../agreeRow.jsx");

let root; let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });

// 【便CD 2026-10-08】「参加する」のボタンはカードそのもの(role="button"・名前「参加する」)
const joinButton = () => document.querySelector('[data-join-card][role="button"][aria-label="参加する"]');

describe("参加の画面に同意のチェックは無い(便CC)", () => {
  it("チェックボックスも同意の文も無い。「参加する」(カード)は最初から押せて onJoin が呼ばれる", async () => {
    let joined = 0;
    await act(async () => { root.render(<JoinIntro onJoin={async () => { joined += 1; }} />); });
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(document.body.textContent).not.toContain("同意します");
    expect(joinButton().hasAttribute("aria-disabled")).toBe(false);
    await act(async () => { joinButton().click(); });
    expect(joined).toBe(1);
  });
});

describe("部品 AgreeRow(同意の画面の2枚目の帯)", () => {
  function Probe() {
    const [v, setV] = useState(false);
    return <AgreeRow checked={v} onChange={setV}>利用規約とプライバシーポリシーに同意する</AgreeRow>;
  }
  it("行全体が label で高さ --tap-min。中身はネイティブの checkbox。行の文字を押しても入り、もう一度押すと外れる", async () => {
    await act(async () => { root.render(<Probe />); });
    const box = document.querySelector('input[type="checkbox"]');
    const row = box.closest("label");
    expect(row.style.minHeight).toBe("var(--tap-min)");
    expect(row.textContent).toBe("利用規約とプライバシーポリシーに同意する");
    expect(box.checked).toBe(false);
    await act(async () => { [...row.querySelectorAll("span")].find((s) => s.textContent === "利用規約とプライバシーポリシーに同意する").click(); });
    expect(box.checked).toBe(true);
    await act(async () => { box.click(); });
    expect(box.checked).toBe(false);
  });
});
