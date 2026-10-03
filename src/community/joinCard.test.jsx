// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ------------------------------------------------------------------
// 【便BS 2026-10-03 本人裁定(ficus-tutorial2.html「1. コミュニティ参加の画面を、カード1枚にまとめる」)】
// 参加していない人のコミュニティタブ(JoinIntro)を実際に描いて確かめる(jsdom)。
//   ・3層: 裏(参加後の画面の見本。inert・aria-hidden・pointer-events: none)/ 暗幕(--c-coach-dim・タップを通す)/ カード(中央)
//   ・カードの中身の順と文言(一字一句。期待値は版と以前の JoinIntro の文から手で書いた)
//   ・同意するまで「参加する」は押せない(地 --c-disabled)。見た目はシートの主ボタンの標準
//   ・カードの外を押しても・Escape でも消えない
//   ・導線(規約・ポリシー・お問い合わせ)とアカウント引継は今と同じシートを開く
//   ・下部タブは押せる(暗幕・枠・層はタップを通し、カードは見える範囲 = 下部タブの上端より上に収まる)
// index.css をそのまま読み込む(jsdom は stylesheet の宣言を getComputedStyle に通す)。
// 【守っていないもの】実寸の見た目と、375×667 でカードが切れないこと(headless Chrome で実測。報告の表)。
// ------------------------------------------------------------------
const { JoinIntro } = await import("./CommunityTab.jsx");

let root; let host; let styleEl; let realRect;
const NAV_TOP = 765;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  styleEl = document.createElement("style");
  styleEl.textContent = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
  document.head.appendChild(styleEl);
  Object.defineProperty(window, "innerWidth", { value: 375, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 812, configurable: true, writable: true });
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    const box = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
    if (this.hasAttribute?.("data-bottom-nav")) return box(0, NAV_TOP, 375, 47);
    return box(0, 0, 0, 0);
  };
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
});

const card = () => document.querySelector("[data-join-card]");
const buttonNamed = (name) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === name);
const joinButton = () => buttonNamed("参加する")[0];
const tick = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
// 下部タブの代わり(App の BottomNav と同じ目印)。JoinIntro の外に置く
function Page({ onNav = () => {}, onJoin = async () => {} }) {
  return (
    <>
      <JoinIntro onJoin={onJoin} />
      <div data-bottom-nav=""><button type="button" aria-label="データ" onClick={onNav}>データ</button></div>
    </>
  );
}
const draw = async (props) => { await act(async () => { root.render(<Page {...props} />); }); };

describe("参加の画面はカード1枚(便BS)", () => {
  it("カードの中身の順と文言(一字一句)", async () => {
    await draw();
    const c = card();
    expect(c).not.toBe(null);
    expect(c.getAttribute("role")).toBe("dialog");
    const kids = [...c.children];
    // 1. 丸いアイコン(コミュニティの絵)
    expect(kids[0].className).toBe("coach-icon");
    expect(kids[0].querySelector("circle").getAttribute("cx")).toBe("9");
    // 2. 見出し / 3. 1行
    expect(kids[1].className).toBe("coach-title");
    expect(kids[1].textContent).toBe("コミュニティに参加しよう");
    expect(c.getAttribute("aria-labelledby")).toBe(kids[1].id);
    expect(kids[2].className).toBe("coach-line");
    expect(kids[2].textContent).toBe("みんなの計測データが見られます");
    // 4. 説明(以前の JoinIntro の2段落のまま)。1段落目は --fs-sm、2段落目は小さく --c-ink-3
    expect(kids[3].textContent).toBe("参加すると匿名のアカウントが作られ、他の奏者のデータが見られるようになります。 メールアドレスなどの個人情報は公表されません。");
    expect(kids[3].style.fontSize).toBe("var(--fs-sm)");
    expect(kids[4].textContent).toBe("匿名のアカウントはこの端末にだけ残ります。機種変更やアプリの削除で失われ、元に戻せません。");
    expect([kids[4].style.fontSize, kids[4].style.color]).toEqual(["var(--fs-xs)", "var(--c-ink-3)"]);
    // 5. 導線
    expect([...kids[5].querySelectorAll("button")].map((b) => b.textContent)).toEqual(["利用規約", "プライバシーポリシー", "お問い合わせ"]);
    // 6. 同意のチェック(AgreeRow)
    expect(kids[6].tagName).toBe("LABEL");
    expect(kids[6].textContent).toBe("利用規約とプライバシーポリシーに同意します");
    expect(kids[6].querySelector('input[type="checkbox"]')).not.toBe(null);
    // 7. 主ボタン / 8. 細い導線
    expect(kids[7].tagName).toBe("BUTTON");
    expect(kids[7].textContent).toBe("参加する");
    expect(kids[8].tagName).toBe("BUTTON");
    expect(kids[8].textContent.trim()).toBe("アカウント引継");
    expect(kids).toHaveLength(9);
    // 以前の見出し「コミュニティ」・ボタンの文字「参加してプロフィールを作る」は無い
    expect(document.body.textContent).not.toContain("参加してプロフィールを作る");
  });

  it("削除の結果の説明(notice)は見出しの1行のすぐ下に出る(機能を落とさない)", async () => {
    await act(async () => { root.render(<JoinIntro onJoin={async () => {}} notice="一部を消せませんでした" />); });
    const kids = [...card().children];
    expect(kids[3].getAttribute("role")).toBe("status");
    expect(kids[3].textContent).toBe("一部を消せませんでした");
  });

  it("同意するまで「参加する」は押せない(地 --c-disabled)。同意すると押せて onJoin。見た目はシートの主ボタンの標準", async () => {
    let joined = 0;
    await draw({ onJoin: async () => { joined += 1; } });
    expect(joinButton().disabled).toBe(true);
    expect(joinButton().style.background).toBe("var(--c-disabled)");
    await act(async () => { joinButton().click(); });
    expect(joined).toBe(0);
    await act(async () => { document.querySelector('input[type="checkbox"]').click(); });
    expect(joinButton().disabled).toBe(false);
    const s = joinButton().style;
    // SHEET_PRIMARY_BUTTON_STYLE(--tap-min / --r-pill / 枠なし / --c-accent / --c-on-accent / --fs-md / 700・幅いっぱい)
    expect([s.minHeight, s.borderRadius, s.background, s.color, s.fontSize, s.fontWeight, s.width])
      .toEqual(["var(--tap-min)", "var(--r-pill)", "var(--c-accent)", "var(--c-on-accent)", "var(--fs-md)", "700", "100%"]);
    expect(joinButton().getAttribute("style")).not.toMatch(/box-shadow/);
    await act(async () => { joinButton().click(); });
    expect(joined).toBe(1);
  });

  it("カードの外(暗幕・裏)を押しても、Escape でも消えない", async () => {
    await draw();
    await act(async () => { document.querySelector(".coach-dim").click(); });
    await act(async () => { document.querySelector("[data-join-preview]").click(); });
    await act(async () => { document.querySelector(".join-frame").click(); });
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await tick();
    expect(card()).not.toBe(null);
    expect(document.querySelector("[data-join-layer]")).not.toBe(null);
  });

  it("導線: 利用規約・プライバシーポリシー・お問い合わせ・アカウント引継が、今と同じシートを開く", async () => {
    await draw();
    const sheet = (label) => document.querySelector(`[role="dialog"][aria-label="${label}"]`);
    await act(async () => { buttonNamed("アカウント引継")[0].click(); });
    expect(sheet("アカウント引継")).not.toBe(null);
    expect(sheet("アカウント引継").textContent).toContain("記録の保存");
    // ほかの3つ: 押すと、今と同じシート(LegalSheet の「利用規約」「プライバシーポリシー」/ FeedbackSheet)が開く
    for (const [name, label] of [["利用規約", "利用規約"], ["プライバシーポリシー", "プライバシーポリシー"], ["お問い合わせ", "お問い合わせ・要望/感想"]]) {
      expect(sheet(label), label).toBe(null);
      await act(async () => { buttonNamed(name)[0].click(); });
      expect(sheet(label), label).not.toBe(null);
    }
  });

  it("下部タブは押せる: 層・暗幕・枠はタップを通す。枠(カードの置き場)は下部タブの上端までで止まる。カードは中で縦にスクロールできる", async () => {
    let nav = 0;
    await draw({ onNav: () => { nav += 1; } });
    const pe = (el) => getComputedStyle(el).pointerEvents;
    const layer = document.querySelector("[data-join-layer]");
    expect(layer.parentElement).toBe(document.body);
    expect(Number(layer.style.zIndex)).toBe(55);   // はじめの一手と同じ。シートの暗幕(60)より下
    expect(pe(layer)).toBe("none");
    expect(pe(document.querySelector(".coach-dim"))).toBe("none");
    expect(pe(document.querySelector(".join-frame"))).toBe("none");
    expect(pe(card())).toBe("auto");
    expect(document.querySelector(".join-frame").style.height).toBe(`${NAV_TOP}px`);
    expect(getComputedStyle(card()).overflowY).toBe("auto");
    expect(getComputedStyle(card()).maxHeight).toBe("100%");
    expect(getComputedStyle(document.querySelector(".join-frame")).padding).toBe("22px");
    await act(async () => { document.querySelector('button[aria-label="データ"]').click(); });
    expect(nav).toBe(1);
  });

  it("裏は参加後の画面の見本で、触れない(inert・aria-hidden・pointer-events: none)。子タブ・条件・平均カード・人の行3つ", async () => {
    await draw();
    const back = document.querySelector("[data-join-preview]");
    expect(back.hasAttribute("inert")).toBe(true);
    expect(back.getAttribute("aria-hidden")).toBe("true");
    expect(back.style.pointerEvents).toBe("none");
    expect(card().contains(back) || back.contains(card())).toBe(false);
    const text = back.textContent;
    for (const w of ["データ", "順位", "シェア", "マイページ", "みんなの平均", "参加すると表示されます"]) expect(text, w).toContain(w);
    expect(back.querySelector(".card.card-accent")).not.toBe(null);
    expect(back.querySelectorAll("[data-join-preview-row]")).toHaveLength(3);
    expect(back.querySelectorAll("select").length).toBeGreaterThan(0);   // 条件のピル(本物と同じ部品)
  });
});
