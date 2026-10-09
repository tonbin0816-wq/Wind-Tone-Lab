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
//   ・【便CI 2026-10-10 本人「コミュニティの最初の以下の説明文削除 / … / コミュニティに参加しようのカード以外の箇所をタップしても次に進めるように変更」】
//     説明の2段落は外した(文は見出しと1行の2つだけ)。カードの外を押しても参加が始まる ── 受けは枠(.join-frame。画面の上端 〜 下部タブの上端)。
//     暗幕と層はタップを通したまま、下部タブは枠の外なので押せばタブが移り、参加は始まらない。二度押し・準備中の歯止めは外を押しても効く。
//     【守っていないもの(jsdom は当たり判定をしない)】実画面のどの点を押すと枠に当たるか。ここで見るのは枠の当たりの有無と高さ(= 下部タブの上端)で、
//     実際の当たりは dev サーバで elementFromPoint を測った(報告の表)。
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
  it("【便CI】カードの中身はアイコン・見出し・1行の3つだけ(文は2つ・一字一句)。説明の2段落・ボタン・導線・チェックは無い", async () => {
    await draw();
    const c = card();
    expect(c).not.toBe(null);
    const kids = [...c.children];
    expect(kids).toHaveLength(3);
    // 1. 丸いアイコン(コミュニティの絵)
    expect(kids[0].className).toBe("coach-icon");
    expect(kids[0].querySelector("circle").getAttribute("cx")).toBe("9");
    // 2. 見出し / 3. 1行
    expect(kids[1].className).toBe("coach-title");
    expect(kids[1].textContent).toBe("コミュニティに参加しよう");
    expect(kids[2].className).toBe("coach-line");
    expect(kids[2].textContent).toBe("みんなの計測データが見られます");
    // (【便CI】ここにあった説明の2段落「参加すると匿名のアカウントが…」「匿名のアカウントはこの端末にだけ…」は外した)
    // カードの文は見出しと1行の2つをつないだものだけ(ほかの文が1字も無い。期待値は本人の原文から手で書いた)
    expect(c.textContent).toBe("コミュニティに参加しようみんなの計測データが見られます");
    expect(c.textContent).not.toMatch(/機種/);
    for (const w of ["匿名", "アカウント", "端末", "個人情報", "元に戻せません"]) expect(c.textContent, w).not.toContain(w);
    // 押せる部品(ボタン・リンク・入力)はカードの中に1つも無い。外した導線の語も無い
    expect(c.querySelectorAll("button, a, input, label, select, textarea")).toHaveLength(0);
    // (上の textContent の一致が、ボタンの字「参加する」も無いことを見ている)
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

  // 【便CE 2026-10-08】カードは role="button" で、中身は読み上げでは「参加する」に畳まれる。見た目の説明はカードの中(見出しの1行のすぐ下)のまま
  //   aria-hidden にし、読み上げはカードの外(カードの兄弟)の status が持つ。
  it("削除の結果の説明(notice)は見出しの1行のすぐ下に出る(機能を落とさない)。読み上げはカードの外の status が持つ", async () => {
    await act(async () => { root.render(<JoinIntro onJoin={async () => {}} notice="一部を消せませんでした" />); });
    const kids = [...card().children];
    expect(kids[3].textContent).toBe("一部を消せませんでした");
    expect(kids[3].getAttribute("aria-hidden")).toBe("true");
    expect(kids[3].hasAttribute("role")).toBe(false);
    expect(kids[3].style.fontSize).toBe("var(--fs-sm)");
    // カード(role="button")の中に status は無い。status はカードの外で、同じ層の中
    expect(card().querySelector('[role="status"]')).toBe(null);
    const live = document.querySelector("[data-join-notice-live]");
    expect(live.getAttribute("role")).toBe("status");
    expect(live.textContent).toBe("一部を消せませんでした");
    expect(card().contains(live) || live.contains(card())).toBe(false);
    expect(live.closest("[data-join-layer]")).not.toBe(null);
    expect(live.className).toBe("coach-live");   // 見た目には出さない(はじめの一手の読み上げの入れ物と同じ規則)
  });

  it("notice が無いときは、読み上げの入れ物は空でカードの中に説明の行も無い(3つの子のまま)", async () => {
    await draw();
    expect(document.querySelector("[data-join-notice-live]").textContent).toBe("");
    expect(card().children).toHaveLength(3);
  });

  it("【便CD】カードを押すと参加が始まる(onJoin。今までの「参加する」と同じ口)。どこを押しても(アイコン・見出し・1行)同じ。1回の押下で1回", async () => {
    let joined = 0;
    await draw({ onJoin: async () => { joined += 1; } });
    await act(async () => { card().click(); });
    expect(joined).toBe(1);
    for (const i of [0, 1, 2]) {
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

  // 【便CD 2026-10-08 本人「参加しないという選択肢ないです」・統括の裁定】外を押しても閉じない(今までどおりの例外)。
  // 【便CI 2026-10-10 本人「コミュニティに参加しようのカード以外の箇所をタップしても次に進めるように変更」】外を押すと、カードを押したときと同じく参加が始まる。
  //   実画面で暗幕・裏の見本の上を押すと当たるのは枠(.join-frame。pointer-events: auto・画面の上端 〜 下部タブの上端)。
  //   暗幕と裏は当たりを持たない(下の「下部タブは押せる」で pointer-events を見る)ので、ここでは枠を押す。
  it("【便CI】カードの外(枠 = 暗幕・裏の見本の上)を押すと参加が始まる。1回の押下で1回。Escape では消えず・始まらない", async () => {
    let joined = 0;
    await draw({ onJoin: async () => { joined += 1; } });
    await act(async () => { document.querySelector(".join-frame").click(); });
    expect(joined).toBe(1);
    await act(async () => { document.querySelector(".join-frame").click(); });
    expect(joined).toBe(2);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await tick();
    expect(joined).toBe(2);
    expect(card()).not.toBe(null);
    expect(document.querySelector("[data-join-layer]")).not.toBe(null);
  });

  // 【便CI】外を押しても二度押しの歯止め(busyRef)と準備中の扱いはカードと同じ 1 つ。onJoin は終わらせずに待たせておく。
  it("【便CI】準備中は外を押しても始まらない: 外を続けて2回・外 → カード・カード → 外 のどれでも onJoin は1回。終われば外でまた押せる", async () => {
    let calls = 0; let finish = null;
    await draw({ onJoin: () => { calls += 1; return new Promise((r) => { finish = r; }); } });
    const frame = () => document.querySelector(".join-frame");
    await act(async () => { frame().click(); frame().click(); });   // 2回目は描き直しの前
    expect(calls).toBe(1);
    expect(card().getAttribute("aria-disabled")).toBe("true");
    await act(async () => { card().click(); frame().click(); });
    await key(card(), "Enter");
    expect(calls).toBe(1);
    await act(async () => { finish(); });
    expect(card().hasAttribute("aria-disabled")).toBe(false);
    await act(async () => { card().click(); frame().click(); });   // カード → 外(描き直しの前)
    expect(calls).toBe(2);
    await act(async () => { finish(); });
    await act(async () => { frame().click(); });
    expect(calls).toBe(3);
    await act(async () => { finish(); });
  });

  it("【便CD】規約・ポリシー・お問い合わせ・「端末を替えるとき」のシートは参加のカードから開かない(導線ごと外した)", async () => {
    await draw();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    for (const name of ["利用規約", "プライバシーポリシー", "お問い合わせ", "端末を替えるとき", "アカウント引継"]) expect(buttonNamed(name), name).toHaveLength(0);
    await act(async () => { card().click(); });
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  });

  it("下部タブは押せる: 層・暗幕はタップを通す。枠(カードの置き場・【便CI】外の押下の受け)は画面の上端から下部タブの上端までで止まる。カードは中で縦にスクロールできる", async () => {
    let nav = 0; let joined = 0;
    await draw({ onNav: () => { nav += 1; }, onJoin: async () => { joined += 1; } });
    const pe = (el) => getComputedStyle(el).pointerEvents;
    const layer = document.querySelector("[data-join-layer]");
    expect(layer.parentElement).toBe(document.body);
    expect(Number(layer.style.zIndex)).toBe(55);   // はじめの一手と同じ。シートの暗幕(60)より下
    expect(pe(layer)).toBe("none");
    expect(pe(document.querySelector(".coach-dim"))).toBe("none");
    // 【便CI】枠は当たりを持つ(外の押下を受ける)。覆うのは画面の上端・左右いっぱい 〜 下部タブの上端(= 下部タブは枠の外)
    const frameCss = getComputedStyle(document.querySelector(".join-frame"));
    expect(pe(document.querySelector(".join-frame"))).toBe("auto");
    expect([frameCss.position, frameCss.top, frameCss.left, frameCss.right]).toEqual(["fixed", "0px", "0px", "0px"]);
    expect(pe(card())).toBe("auto");
    expect(document.querySelector(".join-frame").style.height).toBe(`${NAV_TOP}px`);
    // 下部タブの代わりは層(枠)の中に居ない
    expect(document.querySelector("[data-join-layer]").contains(document.querySelector("[data-bottom-nav]"))).toBe(false);
    expect(getComputedStyle(card()).overflowY).toBe("auto");
    expect(getComputedStyle(card()).maxHeight).toBe("100%");
    expect(getComputedStyle(document.querySelector(".join-frame")).padding).toBe("22px");
    await act(async () => { document.querySelector('button[aria-label="データ"]').click(); });
    expect(nav).toBe(1);
    expect(joined).toBe(0);   // 下部タブを押しても参加は始まらない(枠の外)
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
