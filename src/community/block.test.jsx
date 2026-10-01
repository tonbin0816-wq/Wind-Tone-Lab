// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BE 2026-09-30 本人裁定「B」(モック ficus-block-mock.html の 1〜3)】ブロックの画面。
// **実際に描いて押す**(jsdom。シートの器は本物の BottomSheet ── document.body へポータルされる)。
//   1. 人物のページ(プロフィール面)に「ブロック」が通報の**上**に出る。自分・データ面では出ない
//   2. 押すと確認のシート(見出し・本文2段落・「ブロックする」「やめる」)。やめる → 何も起きない /
//      ブロックする → onBlock(その人)
// 【便BG 2026-10-01 本人指示】入口の文字を「この人をブロック」→「ブロック」、「この人を通報」→「通報」。
//   確認のシートの本文1段落目を書き換え、「ブロックする」を赤の塗りから塗りなしの赤枠(DANGER_OUTLINE_STYLE)にした。
//   通報の流れ(送れたあとにブロックを問う)は reportFlow.test.jsx が見る。
//   3. マイページの「ブロック中の人」の行(0人でも出る・カードの一番上)とシート(0人の文言・解除)
// 【守っていないもの】一覧から実際に消えること・保存・引継(blockJoined.test.jsx が見る)。
//   ブラウザでの実寸(jsdom は寸法を持たない ── style の綴りで見る)。
// ------------------------------------------------------------------
const { PersonSheet, BLOCK_NOTE_EFFECT, BLOCK_NOTE_UNDO } = await import("./screens.jsx");
const { ProfileView } = await import("./CommunityTab.jsx");

const PERSON = {
  uid: "p1", nickname: "しろねこ", icon: "ic-cat", iconColor: 2, photo: null,
  saxTypes: ["alto"], gear: { alto: {} }, position: "学生", genres: [], ensembles: [],
  stats: { daysAll: 24 },
};
const PROFILE = {
  nickname: "てすと", icon: "ic-cat", iconColor: 2,
  saxTypes: ["alto"], gear: { alto: {} }, position: "社会人", startYear: 2015,
  genres: ["ジャズ"], ensembles: ["ソロ"], isPublic: true,
};

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

const buttonsNamed = (name) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === name);
const dialogNamed = (label) => document.querySelector(`[role="dialog"][aria-label="${label}"]`);
const styleOf = (el) => el.getAttribute("style") ?? "";
const drawPerson = async (props = {}) => {
  await act(async () => {
    root.render(<PersonSheet person={PERSON} ideals={[]} myIdeals={{}} onClose={() => {}} onAdopt={() => ({})}
                             myUid="me" tuningHz={442} {...props} />);
  });
};
const toProfileSide = async () => {
  const tab = [...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent.trim() === "プロフィール");
  await act(async () => { tab.click(); });
};
const CONFIRM = "しろねこ をブロックしますか";

describe("人物のページの「ブロック」", () => {
  // 【便BG 2026-10-01 本人指示】入口の文字は「ブロック」「通報」(以前の「この人を〜」は無い)。
  it("入口の文字は「ブロック」と「通報」だけ(「この人をブロック」「この人を通報」は無い)", async () => {
    await drawPerson({ onBlock: () => {} });
    await toProfileSide();
    const sheet = dialogNamed("しろねこ の詳細");
    const labels = [...sheet.querySelectorAll("button")].map((b) => b.textContent.trim());
    expect(labels).toContain("ブロック");
    expect(labels).toContain("通報");
    expect(sheet.textContent).not.toContain("この人をブロック");
    expect(sheet.textContent).not.toContain("この人を通報");
  });

  it("プロフィール面で、通報の**上**に1つ出る(2つは同じ並びの中・間は --sp-2)", async () => {
    const calls = [];
    await drawPerson({ onBlock: (p) => calls.push(p) });
    await toProfileSide();
    const block = buttonsNamed("ブロック");
    const report = buttonsNamed("通報");
    expect(block).toHaveLength(1);
    expect(report).toHaveLength(1);
    // 並び: ブロックが先(上)
    expect(block[0].compareDocumentPosition(report[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 同じ器の兄弟で、器の間隔は 8px(--sp-2)
    expect(block[0].parentElement).toBe(report[0].parentElement);
    expect(block[0].parentElement.style.gap).toBe("var(--sp-2)");
    expect(block[0].parentElement.style.display).toBe("grid");
  });

  it("見た目: 地なし・枠 1px --c-line-strong・字 --c-ink-2。形(幅・高さ・角丸・字の大きさ・余白)は通報と同じ", async () => {
    await drawPerson({ onBlock: () => {} });
    await toProfileSide();
    const b = buttonsNamed("ブロック")[0].style;
    const r = buttonsNamed("通報")[0].style;
    expect(b.border).toBe("1px solid var(--c-line-strong)");
    expect(b.color).toBe("var(--c-ink-2)");
    expect(b.background).toBe("transparent");
    for (const k of ["width", "minHeight", "borderRadius", "fontSize", "fontWeight", "padding"]) {
      expect([k, b[k]]).toEqual([k, r[k]]);
    }
    expect(b.minHeight).toBe("var(--tap-min)"); // 44px 以上
    expect(b.width).toBe("100%");
    // 通報の赤は変わっていない
    expect(r.border).toBe("1px solid var(--c-danger)");
  });

  it("データ面・自分の人物のページ・受け口(onBlock)が無いときは出ない", async () => {
    await drawPerson({ onBlock: () => {} });
    expect(buttonsNamed("ブロック")).toHaveLength(0); // 開いた直後はデータ面
    await toProfileSide();
    expect(buttonsNamed("ブロック")).toHaveLength(1);

    act(() => root.unmount()); root = createRoot(host);
    await drawPerson({ onBlock: () => {}, myUid: "p1" });
    await toProfileSide();
    expect(buttonsNamed("ブロック")).toHaveLength(0);
    expect(buttonsNamed("通報")).toHaveLength(0);

    act(() => root.unmount()); root = createRoot(host);
    await drawPerson({});
    await toProfileSide();
    expect(buttonsNamed("ブロック")).toHaveLength(0);
    expect(buttonsNamed("通報")).toHaveLength(1);
  });

  // 【便BG 2026-10-01 本人指示】本文は次の2段落(一字一句)。見出しはそのまま。
  //   「ブロックすると、この奏者のデータはあなたのコミュニティから非表示になります。相手には通知されません。」
  //   「マイページの「ブロック中の人」から、いつでも解除できます。」
  // 「ブロックする」は赤の塗りから、塗りなしの赤枠(人物のページの通報の入口と同じ DANGER_OUTLINE_STYLE)へ。
  it("押すと確認のシート: 見出し・本文2段落(一字一句)・「ブロックする」(塗りなしの赤枠)と「やめる」", async () => {
    await drawPerson({ onBlock: () => {} });
    await toProfileSide();
    expect(dialogNamed(CONFIRM)).toBe(null);
    await act(async () => { buttonsNamed("ブロック")[0].click(); });
    const d = dialogNamed(CONFIRM);
    expect(d).not.toBe(null);
    const texts = [...d.querySelectorAll("div.sans")].map((x) => x.textContent);
    // 見出し + 本文の2段落が、この順で、この3つだけ
    expect(texts).toEqual([
      CONFIRM,
      "ブロックすると、この奏者のデータはあなたのコミュニティから非表示になります。相手には通知されません。",
      "マイページの「ブロック中の人」から、いつでも解除できます。",
    ]);
    expect(BLOCK_NOTE_EFFECT).toBe("ブロックすると、この奏者のデータはあなたのコミュニティから非表示になります。相手には通知されません。");
    expect(BLOCK_NOTE_UNDO).toBe("マイページの「ブロック中の人」から、いつでも解除できます。");
    const ok = [...d.querySelectorAll("button")].filter((b) => b.textContent.trim() === "ブロックする");
    const no = [...d.querySelectorAll("button")].filter((b) => b.textContent.trim() === "やめる");
    expect(ok).toHaveLength(1);
    expect(no).toHaveLength(1);
    // 塗りなしの赤枠: 地なし・枠 1px --c-danger・字 --c-danger(赤の塗り --c-danger / 白字 ではない)
    expect(ok[0].style.background).toBe("transparent");
    expect(ok[0].style.border).toBe("1px solid var(--c-danger)");
    expect(ok[0].style.color).toBe("var(--c-danger)");
    // 人物のページの通報の入口と同じ形(寸法・角丸・字)
    // 確認のシートの下(人物のページ)に通報の入口がある
    const entry = buttonsNamed("通報")[0].style;
    for (const k of ["width", "minHeight", "borderRadius", "fontSize", "fontWeight", "border", "color", "background"]) {
      expect([k, ok[0].style[k]]).toEqual([k, entry[k]]);
    }
    expect(ok[0].style.minHeight).toBe("var(--tap-min)"); // 44px 以上
    // 縦に2つ(上が ブロックする・下が やめる)、間は --sp-2(8px)
    expect(ok[0].compareDocumentPosition(no[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ok[0].parentElement).toBe(no[0].parentElement);
    expect(ok[0].parentElement.style.display).toBe("grid");
    expect(ok[0].parentElement.style.gap).toBe("var(--sp-2)");
    expect(no[0].style.minHeight).toBe("var(--tap-min)");
  });

  it("「やめる」は何もしないで閉じる(onBlock は呼ばれない)", async () => {
    const calls = [];
    await drawPerson({ onBlock: (p) => calls.push(p) });
    await toProfileSide();
    await act(async () => { buttonsNamed("ブロック")[0].click(); });
    await act(async () => { buttonsNamed("やめる")[0].click(); });
    expect(dialogNamed(CONFIRM)).toBe(null);
    expect(calls).toHaveLength(0);
    // 人物のページはそのまま
    expect(dialogNamed("しろねこ の詳細")).not.toBe(null);
  });

  it("「ブロックする」で onBlock(その人) が1回だけ呼ばれ、確認のシートが閉じる", async () => {
    const calls = [];
    await drawPerson({ onBlock: (p) => calls.push(p) });
    await toProfileSide();
    await act(async () => { buttonsNamed("ブロック")[0].click(); });
    await act(async () => { buttonsNamed("ブロックする")[0].click(); });
    expect(calls).toHaveLength(1);
    expect(calls[0].uid).toBe("p1");
    expect(calls[0].nickname).toBe("しろねこ");
    expect(dialogNamed(CONFIRM)).toBe(null);
  });

  // 【便BE 審査の指摘】以前は描いた style の綴りを突き合わせていた。定義は1つ(screens.jsx)に置き、
  // **同じものを参照している**ことを見る。
  // 【便BG 2026-10-01 本人指示】「ブロックする」は赤の塗り(DANGER_FILL_STYLE)から塗りなしの赤枠
  // (DANGER_OUTLINE_STYLE)に替わった。アカウントを削除するは赤の塗りのまま(CommunityTab.jsx の
  // dangerButtonStyle = DANGER_FILL_STYLE の別名)。危険の塗りの写しが CommunityTab.jsx に無いことも見る。
  it("「ブロックする」は DANGER_OUTLINE_STYLE を参照し、アカウントを削除するの塗り(DANGER_FILL_STYLE)とは別", async () => {
    const { DANGER_FILL_STYLE, DANGER_OUTLINE_STYLE } = await import("./screens.jsx");
    const comm = (await import("./CommunityTab.jsx?raw")).default;
    const scr = (await import("./screens.jsx?raw")).default;
    expect(comm).toMatch(/import \{[^}]*DANGER_FILL_STYLE[^}]*\} from "\.\/screens\.jsx";/);
    expect(comm).toMatch(/const dangerButtonStyle = DANGER_FILL_STYLE;/);
    expect(comm).not.toMatch(/background: "var\(--c-danger\)"/);
    expect(scr).toMatch(/<button type="button" onClick=\{onConfirm\} className="sans" style=\{DANGER_OUTLINE_STYLE\}>/);
    expect(scr).not.toMatch(/style=\{DANGER_FILL_STYLE\}/);
    // 描いた結果もその定義どおり
    await drawPerson({ onBlock: () => {} });
    await toProfileSide();
    await act(async () => { buttonsNamed("ブロック")[0].click(); });
    const s = buttonsNamed("ブロックする")[0].style;
    expect(s.background).toBe(DANGER_OUTLINE_STYLE.background);
    expect(s.border).toBe(DANGER_OUTLINE_STYLE.border);
    expect(s.color).toBe(DANGER_OUTLINE_STYLE.color);
    expect(s.background).not.toBe(DANGER_FILL_STYLE.background);
  });
});

describe("マイページの「ブロック中の人」", () => {
  const rowButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("ブロック中の人"));
  const LIST = [
    { uid: "p1", nickname: "しろねこ", icon: "ic-cat", iconColor: 2, blockedAt: "2026-09-30T00:00:00.000Z" },
    { uid: "p2", nickname: "くろねこ", icon: "ic-dog", iconColor: 4, blockedAt: "2026-09-30T00:00:01.000Z" },
  ];

  it("0人でも行は出る(「0人」)。お問い合わせ・規約・ポリシーと同じカードの一番上", async () => {
    await act(async () => { root.render(<ProfileView profile={PROFILE} uid="me" onOpenBackup={() => {}} />); });
    const row = rowButton();
    expect(row).toBeTruthy();
    expect(row.textContent).toBe("ブロック中の人0人");
    const card = row.parentElement;
    expect(card.className).toBe("card");
    const labels = [...card.children].map((c) => c.textContent);
    expect(labels[0]).toBe("ブロック中の人0人");
    expect(labels.slice(1)).toEqual(["お問い合わせ", "利用規約", "プライバシーポリシー"]);
    // 右の添え字は --c-ink-3 の小さな字、その右に山形(›)
    const value = [...row.querySelectorAll("span")].find((s) => s.textContent === "0人");
    expect(value.style.color).toBe("var(--c-ink-3)");
    expect(value.nextElementSibling.tagName.toLowerCase()).toBe("svg");
  });

  it("0人のシートは「ブロック中の人はいません」", async () => {
    await act(async () => { root.render(<ProfileView profile={PROFILE} uid="me" onOpenBackup={() => {}} />); });
    await act(async () => { rowButton().click(); });
    const d = dialogNamed("ブロック中の人");
    expect(d).not.toBe(null);
    expect(d.textContent).toContain("ブロック中の人はいません");
    expect([...d.querySelectorAll("button")].filter((b) => b.textContent.trim() === "解除")).toHaveLength(0);
  });

  it("人数を出し、シートにアイコン・ニックネーム・「解除」を並べる。解除は確認なしで onUnblock(uid)", async () => {
    const calls = [];
    await act(async () => { root.render(<ProfileView profile={PROFILE} uid="me" onOpenBackup={() => {}} blocked={LIST} onUnblock={(u) => calls.push(u)} />); });
    expect(rowButton().textContent).toBe("ブロック中の人2人");
    await act(async () => { rowButton().click(); });
    const d = dialogNamed("ブロック中の人");
    expect(d.textContent).not.toContain("ブロック中の人はいません");
    expect(d.textContent).toContain("しろねこ");
    expect(d.textContent).toContain("くろねこ");
    const pills = [...d.querySelectorAll("button")].filter((b) => b.textContent.trim() === "解除");
    expect(pills).toHaveLength(2);
    // アイコンが行ごとに出る(36px の円。色はブロックした時点の写しの iconColor)
    const avatars = [...d.querySelectorAll('span[aria-hidden="true"]')].filter((x) => x.style.width === "36px");
    expect(avatars.map((x) => x.style.background)).toEqual(["var(--c-avatar-2)", "var(--c-avatar-4)"]);
    await act(async () => { pills[1].click(); });
    expect(calls).toEqual(["p2"]);
    // 確認のシートは挟まない
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it("解除のピル: 地 --c-sunken(B型)・字 --c-ink-2・見た目 32px・押せる範囲は上下に 6px ずつ広げて 44px", async () => {
    await act(async () => { root.render(<ProfileView profile={PROFILE} uid="me" onOpenBackup={() => {}} blocked={LIST} onUnblock={() => {}} />); });
    await act(async () => { rowButton().click(); });
    const pill = [...dialogNamed("ブロック中の人").querySelectorAll("button")].find((b) => b.textContent.trim() === "解除");
    expect(pill.className).toContain("ctl-plain");
    expect(pill.className).toContain("ctl-pill");
    expect(pill.style.color).toBe("var(--c-ink-2)");
    expect(pill.style.minHeight).toBe("32px");
    expect(pill.style.position).toBe("relative");
    const hit = pill.querySelector('span[aria-hidden="true"]');
    expect(hit.style.position).toBe("absolute");
    expect(hit.style.top).toBe("-6px");
    expect(hit.style.bottom).toBe("-6px");
  });

  it("壊れた保存値(nickname がオブジェクト・icon が数・iconColor が文字列)でも落ちずに描け、解除もできる", async () => {
    const broken = [
      { uid: "x1", nickname: { evil: true }, icon: 42, iconColor: "red", photo: { url: 1 }, blockedAt: 7 },
      { uid: "x2", nickname: null },
    ];
    const calls = [];
    await act(async () => { root.render(<ProfileView profile={PROFILE} uid="me" onOpenBackup={() => {}} blocked={broken} onUnblock={(u) => calls.push(u)} />); });
    expect(rowButton().textContent).toBe("ブロック中の人2人");
    await act(async () => { rowButton().click(); });
    const d = dialogNamed("ブロック中の人");
    expect(d).not.toBe(null);
    const pills = [...d.querySelectorAll("button")].filter((b) => b.textContent.trim() === "解除");
    expect(pills).toHaveLength(2);
    expect(d.textContent).not.toContain("[object Object]");
    await act(async () => { pills[0].click(); });
    expect(calls).toEqual(["x1"]);
  });

  it("一覧が変われば(親が解除を反映すれば)シートの中もその場で減り、0人になれば「いません」", async () => {
    const draw = (blocked) => root.render(<ProfileView profile={PROFILE} uid="me" onOpenBackup={() => {}} blocked={blocked} onUnblock={() => {}} />);
    await act(async () => { draw(LIST); });
    await act(async () => { rowButton().click(); });
    await act(async () => { draw(LIST.slice(1)); });
    expect(dialogNamed("ブロック中の人").textContent).not.toContain("しろねこ");
    expect(rowButton().textContent).toBe("ブロック中の人1人");
    await act(async () => { draw([]); });
    expect(dialogNamed("ブロック中の人").textContent).toContain("ブロック中の人はいません");
    expect(rowButton().textContent).toBe("ブロック中の人0人");
  });
});
