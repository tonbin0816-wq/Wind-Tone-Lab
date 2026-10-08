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
//   ・【便CD 2026-10-08 本人「まででいい / それ以下の利用規約やボタン自体もいらない」】中身はアイコン・見出し・1行・説明2段落だけ。
//     ボタン・導線は無い。**カードを押すと参加が始まる**(Enter / Space も)。読み上げではカード全体が「参加する」のボタン。準備中は押せない
//   ・カードの外を押しても・Escape でも消えない(【便CD 統括の裁定】本人「参加しないという選択肢ないです」)
//   ・下部タブは押せる(暗幕・枠・層はタップを通し、カードは見える範囲 = 下部タブの上端より上に収まる)
// index.css をそのまま読み込む(jsdom は stylesheet の宣言を getComputedStyle に通す)。
// 【守っていないもの】実寸の見た目と、375×667 でカードが切れないこと(headless Chrome で実測。報告の表)。
// 【便BX 2026-10-06 本人の決定 D1】説明の2段落目「機種変更やアプリの削除で」→「端末を替えたりアプリを削除したりすると」。
//   細い導線「アカウント引継」→「端末を替えるとき」。開くのは参加の場面に絞ったシート(記録の保存ではない)。期待値は仕様 §8 から手で書いた。
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
const tick = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const key = (el, k) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
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
  // 【便CD 2026-10-08 本人「コミュニティに参加しよう / みんなの計測データが見られます / (2段落) / まででいい / それ以下の利用規約やボタン自体もいらない」】
  it("【便CD】カードの中身はアイコン・見出し・1行・説明2段落の5つだけ(文は4つ・一字一句)。ボタン・導線・チェックは無い", async () => {
    await draw();
    const c = card();
    expect(c).not.toBe(null);
    const kids = [...c.children];
    expect(kids).toHaveLength(5);
    // 1. 丸いアイコン(コミュニティの絵)
    expect(kids[0].className).toBe("coach-icon");
    expect(kids[0].querySelector("circle").getAttribute("cx")).toBe("9");
    // 2. 見出し / 3. 1行
    expect(kids[1].className).toBe("coach-title");
    expect(kids[1].textContent).toBe("コミュニティに参加しよう");
    expect(kids[2].className).toBe("coach-line");
    expect(kids[2].textContent).toBe("みんなの計測データが見られます");
    // 4. 説明(以前の JoinIntro の2段落のまま)。1段落目は --fs-sm、2段落目は小さく --c-ink-3
    // 【便BS 審査】句点のあとに半角の空白を入れない(以前は JSX の改行が空白になっていた)
    expect(kids[3].textContent).toBe("参加すると匿名のアカウントが作られ、他の奏者のデータが見られるようになります。メールアドレスなどの個人情報は公表されません。");
    expect(kids[3].style.fontSize).toBe("var(--fs-sm)");
    expect(kids[4].textContent).toBe("匿名のアカウントはこの端末にだけ残ります。端末を替えたりアプリを削除したりすると失われ、元に戻せません。");
    expect([kids[4].style.fontSize, kids[4].style.color]).toEqual(["var(--fs-xs)", "var(--c-ink-3)"]);
    // カードの文はこの4つをつないだものだけ(ほかの文が1字も無い)
    expect(c.textContent).toBe(kids.slice(1).map((k) => k.textContent).join(""));
    expect(c.textContent).not.toMatch(/機種/);
    // 押せる部品(ボタン・リンク・入力)はカードの中に1つも無い。外した導線の語も無い
    expect(c.querySelectorAll("button, a, input, label, select, textarea")).toHaveLength(0);
    // (「参加する」は1段落目の「参加すると」に含まれるので語では見ない。上の textContent の一致が、ボタンの字が無いことを見ている)
    for (const w of ["準備中", "利用規約", "プライバシーポリシー", "お問い合わせ", "端末を替えるとき", "アカウント引継", "同意"]) {
      expect(c.textContent, w).not.toContain(w);
    }
    // カードの外(JoinIntro の全体)にもボタンは無い(下部タブの代わりの1つだけ)
    // (裏の見本の子タブの行は inert の中の形だけなので数えない)
    const back = document.querySelector("[data-join-preview]");
    expect([...document.querySelectorAll("button")].filter((b) => !back.contains(b)).map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["データ"]);
    // 以前の見出し「コミュニティ」・ボタンの文字「参加してプロフィールを作る」は無い
    expect(document.body.textContent).not.toContain("参加してプロフィールを作る");
  });

  it("【便CD】読み上げではカード全体が「参加する」のボタン(role・名前・フォーカスが入る)", async () => {
    await draw();
    const c = card();
    expect(c.getAttribute("role")).toBe("button");
    expect(c.getAttribute("aria-label")).toBe("参加する");
    expect(c.tabIndex).toBe(0);
    expect(c.hasAttribute("aria-disabled")).toBe(false);
    expect(c.hasAttribute("aria-labelledby")).toBe(false);   // 名前は aria-label の1つ(見出しを名前にしない)
  });

  it("削除の結果の説明(notice)は見出しの1行のすぐ下に出る(機能を落とさない)", async () => {
    await act(async () => { root.render(<JoinIntro onJoin={async () => {}} notice="一部を消せませんでした" />); });
    const kids = [...card().children];
    expect(kids[3].getAttribute("role")).toBe("status");
    expect(kids[3].textContent).toBe("一部を消せませんでした");
  });

  it("【便CD】カードを押すと参加が始まる(onJoin。今までの「参加する」と同じ口)。どこを押しても(見出し・段落・アイコン)同じ", async () => {
    let joined = 0;
    await draw({ onJoin: async () => { joined += 1; } });
    await act(async () => { card().click(); });
    expect(joined).toBe(1);
    for (const i of [0, 1, 4]) {
      await act(async () => { card().children[i].click(); });
    }
    expect(joined).toBe(4);
  });

  it("【便CD】キーボード: Enter と Space で参加が始まる(ネイティブの button と同じ)。ほかのキーでは始まらない", async () => {
    let joined = 0;
    await draw({ onJoin: async () => { joined += 1; } });
    await key(card(), "Enter");
    expect(joined).toBe(1);
    await key(card(), " ");
    expect(joined).toBe(2);
    await key(card(), "a");
    await key(card(), "Escape");
    expect(joined).toBe(2);
  });

  // 【便BS 審査 2026-10-03 統括の指示】二度押しの歯止めを振る舞いで守る(参加の処理 = 匿名のアカウント作りを二重に走らせない)。
  // 続けて2回押す(2回目は描き直しの前)。onJoin は終わらせずに待たせておく。【便CD】押す先はカードそのもの。
  it("準備中(参加の処理が終わる前)は押せない: もう一度押しても・Enter でも onJoin は1回。読み上げは aria-disabled。終わればまた押せる", async () => {
    let calls = 0; let finish = null;
    await draw({ onJoin: () => { calls += 1; return new Promise((r) => { finish = r; }); } });
    await act(async () => { card().click(); card().click(); });
    expect(calls).toBe(1);
    expect(card().getAttribute("aria-disabled")).toBe("true");
    await act(async () => { card().click(); });
    await key(card(), "Enter");
    expect(calls).toBe(1);
    await act(async () => { finish(); });
    expect(card().hasAttribute("aria-disabled")).toBe(false);
    await act(async () => { card().click(); });
    expect(calls).toBe(2);
    await act(async () => { finish(); });
  });

  // 【便CD 2026-10-08 本人「参加しないという選択肢ないです」・統括の裁定】外を押しても閉じない(今までどおりの例外)。外を押しても参加も始まらない。
  it("カードの外(暗幕・裏・枠)を押しても、Escape でも消えない。外を押しても参加は始まらない", async () => {
    let joined = 0;
    await draw({ onJoin: async () => { joined += 1; } });
    await act(async () => { document.querySelector(".coach-dim").click(); });
    await act(async () => { document.querySelector("[data-join-preview]").click(); });
    await act(async () => { document.querySelector(".join-frame").click(); });
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await tick();
    expect(card()).not.toBe(null);
    expect(document.querySelector("[data-join-layer]")).not.toBe(null);
    expect(joined).toBe(0);
  });

  it("【便CD】規約・ポリシー・お問い合わせ・「端末を替えるとき」のシートは参加のカードから開かない(導線ごと外した)", async () => {
    await draw();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    for (const name of ["利用規約", "プライバシーポリシー", "お問い合わせ", "端末を替えるとき", "アカウント引継"]) expect(buttonNamed(name), name).toHaveLength(0);
    await act(async () => { card().click(); });
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  });

  it("下部タブは押せる: 層・暗幕・枠はタップを通す。枠(カードの置き場)は下部タブの上端までで止まる。カードは中で縦にスクロールできる", async () => {
    let nav = 0; let joined = 0;
    await draw({ onNav: () => { nav += 1; }, onJoin: async () => { joined += 1; } });
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
    expect(joined).toBe(0);   // 下部タブを押しても参加は始まらない(カードの外)
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
