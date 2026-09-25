// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BC 2026-09-25 本人選定 ficus-block-mock.html「4. 参加の画面」】規約への同意。
// 参加の画面(JoinIntro)を**実際に描いて押す**(jsdom)。
//   ・「利用規約とプライバシーポリシーに同意します」のチェックが、規約・ポリシーの導線の下・参加の一手の上にある
//   ・行全体(<label>)が押せて高さは --tap-min。中身はネイティブの checkbox(読み上げはチェックボックス)
//   ・入るまで「参加してプロフィールを作る」は disabled で、押しても onJoin は呼ばれない。地は --c-disabled
//   ・入れると押せて onJoin が呼ばれる。外すとまた押せない
//   ・保存しない(描き直すと外れた状態から)
// 【守っていないもの】箱の見た目(20px・角丸 6px・枠・レ点)の実寸。ブラウザで目で見た(報告)。
// ------------------------------------------------------------------
const { JoinIntro } = await import("./CommunityTab.jsx");

let root; let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });

const AGREE = "利用規約とプライバシーポリシーに同意します";
const joinButton = () => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === "参加してプロフィールを作る");
const box = () => host.querySelector('input[type="checkbox"]');
const row = () => box().closest("label");

describe("参加の画面: 規約への同意が入るまで参加は押せない(便BC)", () => {
  it("同意の行がある。行全体が label で高さ --tap-min、中身はネイティブの checkbox で名前は同意の文", async () => {
    await act(async () => { root.render(<JoinIntro onJoin={async () => {}} />); });
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    expect(row()).toBeTruthy();
    expect(row().textContent).toBe(AGREE);
    expect(row().style.minHeight).toBe("var(--tap-min)");
    expect(box().checked).toBe(false);
    // 並び: 規約・ポリシーの導線 → 同意の行 → 参加の一手
    const terms = [...host.querySelectorAll("button")].find((b) => b.textContent === "利用規約");
    const privacy = [...host.querySelectorAll("button")].find((b) => b.textContent === "プライバシーポリシー");
    const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(terms, row()) && follows(privacy, row())).toBe(true);
    expect(follows(row(), joinButton())).toBe(true);
  });

  it("入る前: 参加は disabled・地は --c-disabled。押しても onJoin は呼ばれない", async () => {
    let joined = 0;
    await act(async () => { root.render(<JoinIntro onJoin={async () => { joined += 1; }} />); });
    expect(joinButton().disabled).toBe(true);
    expect(joinButton().style.background).toBe("var(--c-disabled)");
    await act(async () => { joinButton().click(); });
    expect(joined).toBe(0);
  });

  it("行の文字を押しても入る(行全体が押せる)。入ると押せて onJoin が呼ばれる。外すとまた押せない", async () => {
    let joined = 0;
    await act(async () => { root.render(<JoinIntro onJoin={async () => { joined += 1; }} />); });
    const text = [...row().querySelectorAll("span")].find((s) => s.textContent === AGREE);
    await act(async () => { text.click(); });
    expect(box().checked).toBe(true);
    expect(joinButton().disabled).toBe(false);
    expect(joinButton().style.background).toBe("var(--c-accent)");
    await act(async () => { joinButton().click(); });
    expect(joined).toBe(1);
    await act(async () => { box().click(); });
    expect(box().checked).toBe(false);
    expect(joinButton().disabled).toBe(true);
    expect(joinButton().style.background).toBe("var(--c-disabled)");
  });

  it("保存しない: 描き直すと外れた状態から", async () => {
    await act(async () => { root.render(<JoinIntro onJoin={async () => {}} />); });
    await act(async () => { box().click(); });
    expect(box().checked).toBe(true);
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    await act(async () => { root.render(<JoinIntro onJoin={async () => {}} />); });
    expect(box().checked).toBe(false);
    expect(joinButton().disabled).toBe(true);
  });
});
