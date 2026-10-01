// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BG 2026-10-01 本人指示】通報の流れ。**実際に描いて押す**(jsdom。シートの器は本物の BottomSheet)。
//   ・通報のシートの説明文「(ニックネーム) さんを通報します。通報すると運営が内容を確認します。」(一字一句)
//   ・「通報する」は塗りなしの赤枠(DANGER_OUTLINE_STYLE)。やめる と縦に積む(間 --sp-2)
//   ・**送れたあと**、同じシートの中身が「通報しました / この奏者をブロックしますか」に替わる
//       ブロックする(赤枠)→ onBlock(その人)。ブロックの確認のシートは重ねて出さない。シートは閉じる
//       ブロックしない(灰色の地)→ シートだけ閉じて人物のページに戻る。onBlock は呼ばれない
//   ・送れなかったとき → 今までどおりエラーを出すだけ。ブロックは問わない
//   ・受け口(onBlock)が無い呼び手では問わない
// サーバーは作り物(reportRepo.js の reportUser だけを差し替える)。
// 【守っていないもの】一覧から消えない・ブロックが保存に載る(reportJoined.test.jsx)。
//   reports の書き込みの中身と「既に在る」の扱い(reportRepo.test.js)。ブラウザでの実寸(jsdom は寸法を持たない)。
// ------------------------------------------------------------------
vi.mock("./reportRepo.js", () => ({ reportUser: vi.fn() }));
const { reportUser } = await import("./reportRepo.js");
const { PersonSheet, DANGER_OUTLINE_STYLE } = await import("./screens.jsx");
const { REPORT_REASONS } = await import("./report.js");

const PERSON = {
  uid: "p1", nickname: "テスト1", icon: "ic-cat", iconColor: 2, photo: null,
  saxTypes: ["alto"], gear: { alto: {} }, position: "学生", genres: [], ensembles: [],
  stats: { daysAll: 24 },
};

let root; let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  reportUser.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const buttonsIn = (el, name) => [...el.querySelectorAll("button")].filter((b) => b.textContent.trim() === name);
const buttonsNamed = (name) => buttonsIn(document, name);
const dialogNamed = (label) => document.querySelector(`[role="dialog"][aria-label="${label}"]`);
const PERSON_PAGE = "テスト1 の詳細";
const REPORT_FORM = "この人を通報";
const REPORT_DONE = "通報しました";
const draw = async (props = {}) => {
  await act(async () => {
    root.render(<PersonSheet person={PERSON} ideals={[]} myIdeals={{}} onClose={() => {}} onAdopt={() => ({})}
                             myUid="me" tuningHz={442} {...props} />);
  });
  const tab = [...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent.trim() === "プロフィール");
  await act(async () => { tab.click(); });
};
const openReport = async () => { await act(async () => { buttonsNamed("通報")[0].click(); }); };
const pickAndSend = async (reason = REPORT_REASONS[0]) => {
  const d = dialogNamed(REPORT_FORM);
  await act(async () => { buttonsIn(d, reason)[0].click(); });
  await act(async () => { buttonsIn(d, "通報する")[0].click(); });
};
const isRedOutline = (s) => s.background === "transparent"
  && s.border === "1px solid var(--c-danger)" && s.color === "var(--c-danger)";

describe("通報のシート(送る前)", () => {
  it("説明文はニックネームを差し込んだ一字一句「テスト1 さんを通報します。通報すると運営が内容を確認します。」", async () => {
    await draw({ onBlock: () => {} });
    await openReport();
    const d = dialogNamed(REPORT_FORM);
    expect(d).not.toBe(null);
    const texts = [...d.querySelectorAll("div.sans")].map((x) => x.textContent);
    expect(texts[0]).toBe("通報");
    expect(texts[1]).toBe("テスト1 さんを通報します。通報すると運営が内容を確認します。");
    // 一覧から消える旨はもう言わない
    expect(d.textContent).not.toContain("見えなくなり");
  });

  it("ニックネームが違えばその名前が入る(固定の文字ではない)", async () => {
    await act(async () => {
      root.render(<PersonSheet person={{ ...PERSON, nickname: "くろねこ" }} ideals={[]} myIdeals={{}} onClose={() => {}}
                               onAdopt={() => ({})} myUid="me" tuningHz={442} onBlock={() => {}} />);
    });
    const tab = [...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent.trim() === "プロフィール");
    await act(async () => { tab.click(); });
    await openReport();
    const texts = [...dialogNamed(REPORT_FORM).querySelectorAll("div.sans")].map((x) => x.textContent);
    expect(texts[1]).toBe("くろねこ さんを通報します。通報すると運営が内容を確認します。");
  });

  it("「通報する」は塗りなしの赤枠(DANGER_OUTLINE_STYLE)。やめる と縦に積み、間は --sp-2。どちらも 44px 以上", async () => {
    await draw({ onBlock: () => {} });
    await openReport();
    const d = dialogNamed(REPORT_FORM);
    const send = buttonsIn(d, "通報する");
    const cancel = buttonsIn(d, "やめる");
    expect(send).toHaveLength(1);
    expect(cancel).toHaveLength(1);
    const s = send[0].style;
    expect(isRedOutline(s)).toBe(true);
    for (const k of ["width", "minHeight", "borderRadius", "border", "background", "color", "fontSize", "fontWeight"]) {
      expect([k, s[k]]).toEqual([k, String(DANGER_OUTLINE_STYLE[k])]);
    }
    expect(s.minHeight).toBe("var(--tap-min)");
    expect(cancel[0].style.minHeight).toBe("var(--tap-min)");
    expect(send[0].parentElement).toBe(cancel[0].parentElement);
    expect(send[0].parentElement.style.display).toBe("grid");
    expect(send[0].parentElement.style.gap).toBe("var(--sp-2)");
    expect(send[0].compareDocumentPosition(cancel[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 理由の選び方は今のまま(4つの列挙・選ぶまで押せない)
    for (const r of REPORT_REASONS) expect(buttonsIn(d, r)).toHaveLength(1);
    expect(send[0].disabled).toBe(true);
    await act(async () => { buttonsIn(d, REPORT_REASONS[1])[0].click(); });
    expect(send[0].disabled).toBe(false);
    expect(buttonsIn(d, REPORT_REASONS[1])[0].getAttribute("aria-pressed")).toBe("true");
  });
});

describe("送れたあと: 同じシートで「この奏者をブロックしますか」", () => {
  it("中身が「通報しました / この奏者をブロックしますか / ブロックする・ブロックしない」に替わる", async () => {
    reportUser.mockResolvedValue({ already: false });
    await draw({ onBlock: () => {} });
    await openReport();
    await pickAndSend(REPORT_REASONS[2]);
    expect(reportUser).toHaveBeenCalledTimes(1);
    expect(reportUser.mock.calls[0][0]).toEqual({ targetUid: "p1", reporterUid: "me", reason: REPORT_REASONS[2] });
    expect(dialogNamed(REPORT_FORM)).toBe(null);
    const d = dialogNamed(REPORT_DONE);
    expect(d).not.toBe(null);
    const texts = [...d.querySelectorAll("div.sans")].map((x) => x.textContent);
    expect(texts).toEqual(["通報しました", "この奏者をブロックしますか"]);
    const yes = buttonsIn(d, "ブロックする");
    const no = buttonsIn(d, "ブロックしない");
    expect(yes).toHaveLength(1);
    expect(no).toHaveLength(1);
    // つまみ(aria-label="閉じる")のほかに押せるものは、この2つだけ
    expect([...d.querySelectorAll("button")].filter((x) => x.getAttribute("aria-label") !== "閉じる")).toHaveLength(2);
    // ブロックする = 赤枠 / ブロックしない = 灰色の地(やめる と同じ作法: .ctl-plain + .ctl-pill・字 --c-ink-2)
    expect(isRedOutline(yes[0].style)).toBe(true);
    expect(no[0].className).toContain("ctl-plain");
    expect(no[0].className).toContain("ctl-pill");
    expect(no[0].style.color).toBe("var(--c-ink-2)");
    expect(no[0].style.border).toBe("");
    // 縦に2つ・間 8px(--sp-2)・どちらも 44px 以上
    expect(yes[0].parentElement).toBe(no[0].parentElement);
    expect(yes[0].parentElement.style.display).toBe("grid");
    expect(yes[0].parentElement.style.gap).toBe("var(--sp-2)");
    expect(yes[0].compareDocumentPosition(no[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(yes[0].style.minHeight).toBe("var(--tap-min)");
    expect(no[0].style.minHeight).toBe("var(--tap-min)");
  });

  it("「ブロックする」→ onBlock(その人) が1回。シートは閉じ、ブロックの確認のシートは重ねて出さない", async () => {
    reportUser.mockResolvedValue({ already: false });
    const calls = [];
    await draw({ onBlock: (p) => calls.push(p) });
    await openReport();
    await pickAndSend();
    await act(async () => { buttonsIn(dialogNamed(REPORT_DONE), "ブロックする")[0].click(); });
    expect(calls).toHaveLength(1);
    expect(calls[0].uid).toBe("p1");
    expect(calls[0].nickname).toBe("テスト1");
    expect(dialogNamed(REPORT_DONE)).toBe(null);
    expect(dialogNamed("テスト1 をブロックしますか")).toBe(null);
    expect(document.body.textContent).not.toContain("この奏者のデータはあなたのコミュニティから非表示になります");
  });

  it("「ブロックしない」→ シートだけ閉じて人物のページに戻る。onBlock は呼ばれない", async () => {
    reportUser.mockResolvedValue({ already: false });
    const calls = [];
    await draw({ onBlock: (p) => calls.push(p) });
    await openReport();
    await pickAndSend();
    await act(async () => { buttonsIn(dialogNamed(REPORT_DONE), "ブロックしない")[0].click(); });
    expect(calls).toHaveLength(0);
    expect(dialogNamed(REPORT_DONE)).toBe(null);
    expect(dialogNamed(REPORT_FORM)).toBe(null);
    const page = dialogNamed(PERSON_PAGE);
    expect(page).not.toBe(null);
    // 人物のページには「通報しました」の知らせだけが残る(一覧から消える旨は言わない)
    const status = page.querySelector('[role="status"]');
    expect(status.textContent).toBe("通報しました");
    expect(page.textContent).not.toContain("見えなくなります");
    expect(buttonsIn(page, "ブロック")).toHaveLength(1);
    expect(buttonsIn(page, "通報")).toHaveLength(1);
  });

  it("既に通報済み(reportRepo が already: true を返す)でも、同じくブロックを問う", async () => {
    reportUser.mockResolvedValue({ already: true });
    await draw({ onBlock: () => {} });
    await openReport();
    await pickAndSend();
    const d = dialogNamed(REPORT_DONE);
    expect(d).not.toBe(null);
    expect(d.textContent).toContain("この奏者をブロックしますか");
  });

  it("受け口(onBlock)が無い呼び手では問わない(シートを閉じて「通報しました」)", async () => {
    reportUser.mockResolvedValue({ already: false });
    await draw({});
    await openReport();
    await pickAndSend();
    expect(dialogNamed(REPORT_DONE)).toBe(null);
    expect(dialogNamed(REPORT_FORM)).toBe(null);
    expect(document.body.textContent).not.toContain("この奏者をブロックしますか");
    expect(dialogNamed(PERSON_PAGE).querySelector('[role="status"]').textContent).toBe("通報しました");
  });
});

describe("送れなかったとき: ブロックは問わない", () => {
  // 【便BG 審査】エラーは**通報のシートの中**(ボタンの上)に出す。以前は人物のページの末尾に出していて、
  // 開いたままの通報のシートに隠れて見えなかった。人物のページの側には出さない。
  it("エラーは通報のシートの中(ボタンの上)に1行。人物のページには出さない。「この奏者をブロックしますか」は出ない", async () => {
    reportUser.mockRejectedValue(Object.assign(new Error("offline"), { code: "unavailable" }));
    const calls = [];
    await draw({ onBlock: (p) => calls.push(p) });
    await openReport();
    await pickAndSend();
    expect(reportUser).toHaveBeenCalledTimes(1);
    expect(dialogNamed(REPORT_DONE)).toBe(null);
    expect(document.body.textContent).not.toContain("この奏者をブロックしますか");
    expect(buttonsNamed("ブロックしない")).toHaveLength(0);
    // 送る前のシートが残り、もう一度押せる
    const d = dialogNamed(REPORT_FORM);
    expect(d).not.toBe(null);
    const send = buttonsIn(d, "通報する")[0];
    expect(send.disabled).toBe(false);
    // エラーの文は通報のシートの中に1つ。文言は以前と同じ
    const alerts = [...d.querySelectorAll('[role="alert"]')];
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toBe("通報を送れませんでした。電波の良いところでもう一度お試しください");
    // ボタンの上(ボタンの並びより前)・理由の列より後
    expect(alerts[0].compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const lastReason = buttonsIn(d, REPORT_REASONS[REPORT_REASONS.length - 1])[0];
    expect(lastReason.compareDocumentPosition(alerts[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 画面全体でエラーはこの1つだけ(人物のページの末尾には出ていない)
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(dialogNamed(PERSON_PAGE).querySelector('[role="alert"]')).toBe(null);
    expect(dialogNamed(PERSON_PAGE).querySelector('[role="status"]')).toBe(null);
    expect(calls).toHaveLength(0);
    // もう一度押すと、送っている間にエラーは消える(前の失敗を出したまま「送信中…」にしない)。
    // 送れたら問いに替わる
    let release;
    reportUser.mockImplementation(() => new Promise((r) => { release = r; }));
    await act(async () => { send.click(); });
    expect(buttonsIn(d, "送信中…")).toHaveLength(1);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
    await act(async () => { release({ already: false }); });
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(dialogNamed(REPORT_DONE)).not.toBe(null);
  });
});

describe("二度押しの歯止め(便BG 審査)", () => {
  it("同じ処理単位で「通報する」を2回押しても、reportUser は1回だけ", async () => {
    let release;
    reportUser.mockImplementation(() => new Promise((r) => { release = r; }));
    await draw({ onBlock: () => {} });
    await openReport();
    const d = dialogNamed(REPORT_FORM);
    await act(async () => { buttonsIn(d, REPORT_REASONS[0])[0].click(); });
    const send = buttonsIn(d, "通報する")[0];
    await act(async () => { send.click(); send.click(); });
    expect(reportUser).toHaveBeenCalledTimes(1);
    // 送信中は押せず、「送信中…」
    const busyBtn = buttonsIn(d, "送信中…")[0];
    expect(busyBtn).toBeTruthy();
    expect(busyBtn.disabled).toBe(true);
    await act(async () => { busyBtn.click(); });
    expect(reportUser).toHaveBeenCalledTimes(1);
    await act(async () => { release({ already: false }); });
    expect(dialogNamed(REPORT_DONE)).not.toBe(null);
    expect(reportUser).toHaveBeenCalledTimes(1);
  });
});

// 【便BG 審査 / 統括裁定「器を直す」】Escape で閉じるのはいちばん上のシートだけ(App.jsx の BottomSheet)。
const pressEscape = () => act(async () => {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});
describe("Escape はいちばん上のシートだけを閉じる", () => {
  it("通報の送信中に Escape → 通報のシートだけ閉じ、人物のページは残る", async () => {
    let release;
    reportUser.mockImplementation(() => new Promise((r) => { release = r; }));
    await draw({ onBlock: () => {} });
    await openReport();
    const d = dialogNamed(REPORT_FORM);
    await act(async () => { buttonsIn(d, REPORT_REASONS[0])[0].click(); });
    await act(async () => { buttonsIn(d, "通報する")[0].click(); });
    expect(buttonsIn(d, "送信中…")).toHaveLength(1);
    await pressEscape();
    expect(dialogNamed(REPORT_FORM)).toBe(null);
    expect(dialogNamed(PERSON_PAGE)).not.toBe(null);
    // 送信があとで終わっても、問いのシートは開き直さない。人物のページは残る
    await act(async () => { release({ already: false }); });
    expect(dialogNamed(REPORT_DONE)).toBe(null);
    expect(dialogNamed(PERSON_PAGE)).not.toBe(null);
  });

  it("問いのシート(通報しました)で Escape → 問いだけ閉じ(ブロックしないと同じ)、人物のページは残る", async () => {
    reportUser.mockResolvedValue({ already: false });
    const calls = [];
    await draw({ onBlock: (p) => calls.push(p) });
    await openReport();
    await pickAndSend();
    expect(dialogNamed(REPORT_DONE)).not.toBe(null);
    await pressEscape();
    expect(dialogNamed(REPORT_DONE)).toBe(null);
    expect(dialogNamed(PERSON_PAGE)).not.toBe(null);
    expect(calls).toHaveLength(0);
  });

  it("2枚重ね(人物のページ + ブロックの確認): Escape 1回で上だけ、2回で両方閉じる", async () => {
    const closed = [];
    await draw({ onBlock: () => {}, onClose: () => closed.push("person") });
    await act(async () => { buttonsNamed("ブロック")[0].click(); });
    expect(dialogNamed("テスト1 をブロックしますか")).not.toBe(null);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    await pressEscape();
    expect(dialogNamed("テスト1 をブロックしますか")).toBe(null);
    expect(dialogNamed(PERSON_PAGE)).not.toBe(null);
    expect(closed).toEqual([]);
    await pressEscape();
    expect(closed).toEqual(["person"]); // 人物のページの onClose が1回(呼び出し側が閉じる)
  });
});
