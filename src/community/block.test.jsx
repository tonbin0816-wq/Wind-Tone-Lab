// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BE 2026-09-30 本人裁定「B」(モック ficus-block-mock.html の 1〜3)】ブロックの画面。
// **実際に描いて押す**(jsdom。シートの器は本物の BottomSheet ── document.body へポータルされる)。
//   1. 人物のページ(プロフィール面)に「この人をブロック」が通報の**上**に出る。自分・データ面では出ない
//   2. 押すと確認のシート(見出し・本文2段落・「ブロックする」「やめる」)。やめる → 何も起きない /
//      ブロックする → onBlock(その人)
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

describe("人物のページの「この人をブロック」", () => {
  it("プロフィール面で、通報の**上**に1つ出る(2つは同じ並びの中・間は --sp-2)", async () => {
    const calls = [];
    await drawPerson({ onBlock: (p) => calls.push(p) });
    await toProfileSide();
    const block = buttonsNamed("この人をブロック");
    const report = buttonsNamed("この人を通報");
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
    const b = buttonsNamed("この人をブロック")[0].style;
    const r = buttonsNamed("この人を通報")[0].style;
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
    expect(buttonsNamed("この人をブロック")).toHaveLength(0); // 開いた直後はデータ面
    await toProfileSide();
    expect(buttonsNamed("この人をブロック")).toHaveLength(1);

    act(() => root.unmount()); root = createRoot(host);
    await drawPerson({ onBlock: () => {}, myUid: "p1" });
    await toProfileSide();
    expect(buttonsNamed("この人をブロック")).toHaveLength(0);
    expect(buttonsNamed("この人を通報")).toHaveLength(0);

    act(() => root.unmount()); root = createRoot(host);
    await drawPerson({});
    await toProfileSide();
    expect(buttonsNamed("この人をブロック")).toHaveLength(0);
    expect(buttonsNamed("この人を通報")).toHaveLength(1);
  });

  it("押すと確認のシート: 見出し・本文2段落・「ブロックする」(危険の塗り)と「やめる」", async () => {
    await drawPerson({ onBlock: () => {} });
    await toProfileSide();
    expect(dialogNamed(CONFIRM)).toBe(null);
    await act(async () => { buttonsNamed("この人をブロック")[0].click(); });
    const d = dialogNamed(CONFIRM);
    expect(d).not.toBe(null);
    const texts = [...d.querySelectorAll("div.sans")].map((x) => x.textContent);
    expect(texts).toContain(CONFIRM);
    expect(texts).toContain("ブロックすると、この人は順位・シェア・データの一覧と、みんなの平均から見えなくなります。相手には知らされません。");
    expect(texts).toContain("マイページの「ブロック中の人」から、いつでも解除できます。");
    expect(BLOCK_NOTE_EFFECT).toBe("ブロックすると、この人は順位・シェア・データの一覧と、みんなの平均から見えなくなります。相手には知らされません。");
    expect(BLOCK_NOTE_UNDO).toBe("マイページの「ブロック中の人」から、いつでも解除できます。");
    const ok = [...d.querySelectorAll("button")].filter((b) => b.textContent.trim() === "ブロックする");
    const no = [...d.querySelectorAll("button")].filter((b) => b.textContent.trim() === "やめる");
    expect(ok).toHaveLength(1);
    expect(no).toHaveLength(1);
    expect(ok[0].style.background).toBe("var(--c-danger)");
    expect(ok[0].style.color).toBe("var(--c-on-accent)");
    expect(ok[0].compareDocumentPosition(no[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("「やめる」は何もしないで閉じる(onBlock は呼ばれない)", async () => {
    const calls = [];
    await drawPerson({ onBlock: (p) => calls.push(p) });
    await toProfileSide();
    await act(async () => { buttonsNamed("この人をブロック")[0].click(); });
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
    await act(async () => { buttonsNamed("この人をブロック")[0].click(); });
    await act(async () => { buttonsNamed("ブロックする")[0].click(); });
    expect(calls).toHaveLength(1);
    expect(calls[0].uid).toBe("p1");
    expect(calls[0].nickname).toBe("しろねこ");
    expect(dialogNamed(CONFIRM)).toBe(null);
  });

  // 【便BE 審査の指摘】以前は描いた style の綴りを突き合わせていた。いまは定義が1つ(screens.jsx の
  // DANGER_FILL_STYLE)なので、**同じものを参照している**ことを見る:
  //   「ブロックする」は DANGER_FILL_STYLE を描き、CommunityTab.jsx の dangerButtonStyle はその別名で、
  //   CommunityTab.jsx に危険の塗りの写し(background: var(--c-danger) の定義)が残っていない。
  it("「ブロックする」とアカウントを削除するの塗りは、同じ1つの定義(DANGER_FILL_STYLE)を参照している", async () => {
    const { DANGER_FILL_STYLE } = await import("./screens.jsx");
    const comm = (await import("./CommunityTab.jsx?raw")).default;
    const scr = (await import("./screens.jsx?raw")).default;
    expect(comm).toMatch(/import \{[^}]*DANGER_FILL_STYLE[^}]*\} from "\.\/screens\.jsx";/);
    expect(comm).toMatch(/const dangerButtonStyle = DANGER_FILL_STYLE;/);
    expect(comm).not.toMatch(/background: "var\(--c-danger\)"/);
    expect(scr).toMatch(/<button type="button" onClick=\{onConfirm\} className="sans" style=\{DANGER_FILL_STYLE\}>/);
    // 描いた結果もその定義どおり
    await drawPerson({ onBlock: () => {} });
    await toProfileSide();
    await act(async () => { buttonsNamed("この人をブロック")[0].click(); });
    const s = buttonsNamed("ブロックする")[0].style;
    expect(s.background).toBe(DANGER_FILL_STYLE.background);
    expect(s.color).toBe(DANGER_FILL_STYLE.color);
    expect(s.fontWeight).toBe(String(DANGER_FILL_STYLE.fontWeight));
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
