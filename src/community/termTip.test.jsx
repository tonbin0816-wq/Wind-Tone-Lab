// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BC 2026-09-25 本人選定 モック「イ. 吹き出し」】重心と HNR の用語の説明。
// みんなの平均カード(DataScreen)と人物のページのデータ(PersonSheet)の2箇所を、**実際に描いて押す**(jsdom)。
//   ・選んでいる指標が重心か HNR のときだけ、字の右に「?」。音程では出ない
//   ・選んでいるタブをもう一度押すと開く / もう一度で閉じる。別のタブを押すと閉じる
//   ・×・外を触る・Esc でも閉じる
//   ・文案は一字一句このまま(期待値はここに手で書いた文。画面の定数から読まない)
//   ・グラフの下から「計測環境により…」の一文が消えた(自分の線と重ねているときも)
// あわせて 平均カードは濃紺(.card-accent)で切り替えは濃紺の上の色、人物のページは今までの色。
// 【便BC 統括裁定】切り替えの下の区切り線はどちらにも引かない(本人指示 D-9y / D-30 §7.2 を優先)。
// 【守っていないもの】吹き出しの実寸・三角の位置・画面の端からの距離(jsdom は配置を計算しない)。
//   これはブラウザで 375px 幅にして測った(報告に数値)。
// 描き方は cohortMine.test.jsx と同じ(BottomSheet は中身を描くだけの作り物・幅は種で与える)。
// ------------------------------------------------------------------
vi.mock("../App.jsx", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    BottomSheet: ({ ariaLabel, children }) => <div role="dialog" aria-label={ariaLabel}>{children}</div>,
  };
});

import { MeasuredWidthSeedContext } from "../App.jsx";
import { PersonSheet, DataScreen } from "./screens.jsx";

const CENTROID = "音に含まれる成分が、どの高さに集まっているかを表す値です。高い成分が多いほど値が上がり、明るい音に聞こえます。";
const HNR = "楽器の響きと、息などの雑音の大きさの比です。高いほど芯のある澄んだ音に聞こえます。";
const SHARED = "計測環境により値全体が一律にずれるため、揃えた状態で線の形で比較しています。";
const WAIT = "あなたの計測データもお待ちしています";

const TUNING = 442;
const KEYS = [14, 16, 18, 20, 22];
const USERS = ["a", "b", "c"].map((u) => ({ uid: u, nickname: u, saxTypes: ["alto"], genres: [], position: "学生" }));
const SHAPES = [
  [1450, 1530, 1490, 1600, 1560],
  [1380, 1400, 1470, 1440, 1520],
  [1500, 1610, 1580, 1650, 1700],
];
const IDEALS = USERS.map((u, i) => ({
  id: `${u.uid}_alto`, ownerUid: u.uid, saxType: "alto", sourceSessionCount: 3,
  notes: Object.fromEntries(KEYS.map((k, j) => [k, { spectralCentroidHz: SHAPES[i][j], hnrDb: 17 + j, pitchCentsSigned: 4 - j * 3 }])),
}));
// 自分と 3 音重なる = 自分の線と重ねる(以前はグラフの下に揃えの注記が出ていた場合)
const MINE = { alto: { notes: Object.fromEntries([0, 14, 16, 18].map((k, i) => [k, { centroidHz: 900 + i * 40, hnrDb: 10 + i * 0.5, pitchCentsSigned: -3 + i }])) } };
const PERSON = { uid: "a", nickname: "しろねこ", icon: "ic-cat", iconColor: 2, photo: null, saxTypes: ["alto"], gear: { alto: {} }, position: "学生", genres: [], ensembles: [], stats: { daysAll: 3 } };

let root; let host; let realRect;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = () => ({ width: 360, height: 0, top: 0, left: 0, right: 360, bottom: 0, x: 0, y: 0 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); document.body.innerHTML = "";
  window.Element.prototype.getBoundingClientRect = realRect;
});
const draw = async (el) => { await act(async () => { root.render(<MeasuredWidthSeedContext.Provider value={2000}>{el}</MeasuredWidthSeedContext.Provider>); }); };

const PLACES = [
  ["みんなの平均カード", () => <DataScreen users={USERS} ideals={IDEALS} myIdeals={MINE} myUid="me" saxTypes={["alto"]} tuningHz={TUNING} />],
  ["人物のページ", () => <PersonSheet person={PERSON} ideals={[IDEALS[0]]} myIdeals={MINE} onClose={() => {}} onAdopt={() => ({ ok: true })} myUid="me" tuningHz={TUNING} />],
];

const tablist = () => host.querySelector('[role="tablist"][aria-label="見る指標"]');
const tabs = () => [...tablist().querySelectorAll('[role="tab"]')];
// タブの見えている字(「?」は飾りなので除く)
const tabText = (t) => [...t.querySelector("span").childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("");
const tab = (label) => tabs().find((t) => tabText(t) === label);
const selected = () => tabs().find((t) => t.getAttribute("aria-selected") === "true");
const mark = () => tablist().querySelector("[data-term-mark]");
const tip = () => host.querySelector("[data-term-tip]");
const click = async (el) => { await act(async () => { el.click(); }); };
const tipParts = () => [...tip().children].filter((c) => c.tagName === "DIV");

for (const [place, make] of PLACES) {
  describe(`用語の説明(吹き出し): ${place}`, () => {
    it("重心を選んでいると「?」が重心の右に1つ。押す前は吹き出しが無く、揃えの注記は本文に無い", async () => {
      await draw(make());
      expect(tabText(selected())).toBe("重心");
      expect(tablist().querySelectorAll("[data-term-mark]")).toHaveLength(1);
      expect(selected().contains(mark())).toBe(true);
      expect(mark().getAttribute("aria-hidden")).toBe("true");
      expect(mark().textContent).toBe("?");
      // 読み上げ: 選んでいるタブの名前に「用語の説明」。閉じている
      expect(selected().getAttribute("aria-label")).toBe("重心 用語の説明");
      expect(selected().getAttribute("aria-expanded")).toBe("false");
      expect(tip()).toBe(null);
      // 自分と 3 音重なる(以前はグラフの下に揃えの注記が出ていた場合)でも、本文には出ない
      expect(host.querySelector("svg g")).toBeTruthy(); // グラフは描かれている(空回りしていない)
      expect(host.textContent).not.toContain(SHARED);
      expect(host.textContent).not.toContain(WAIT); // 自分の線と重ねているので「お待ちしています」も出ない
    });

    it("選んでいるタブをもう一度押すと開き、文案は一字一句このまま。もう一度押すと閉じる", async () => {
      await draw(make());
      await click(tab("重心"));
      expect(tip()).not.toBe(null);
      expect(selected().getAttribute("aria-expanded")).toBe("true");
      expect(selected().getAttribute("aria-controls")).toBe(tip().id);
      const [head, body, note] = tipParts().length === 3 ? tipParts() : [null, null, null];
      expect(head.textContent).toBe("重心×"); // 見出し(指標名)+ 閉じる
      expect(body.textContent).toBe(CENTROID);
      expect(note.textContent).toBe(SHARED);
      expect(tabText(selected())).toBe("重心"); // 押しても指標は変わっていない
      await click(tab("重心"));
      expect(tip()).toBe(null);
      expect(selected().getAttribute("aria-expanded")).toBe("false");
    });

    it("開いたまま別のタブ(HNR)を押すと閉じる。HNR でも「?」から同じように開き、HNR の文案", async () => {
      await draw(make());
      await click(tab("重心"));
      expect(tip()).not.toBe(null);
      await click(tab("HNR"));
      expect(tabText(selected())).toBe("HNR");
      expect(tip()).toBe(null);
      expect(selected().contains(mark())).toBe(true);
      await click(tab("HNR"));
      const [head, body, note] = tipParts();
      expect(head.textContent).toBe("HNR×");
      expect(body.textContent).toBe(HNR);
      expect(note.textContent).toBe(SHARED);
    });

    it("音程では「?」が出ず、選んでいる音程を押しても吹き出しは開かない", async () => {
      await draw(make());
      await click(tab("音程"));
      expect(tabText(selected())).toBe("音程");
      expect(mark()).toBe(null);
      expect(selected().getAttribute("aria-label")).toBe(null);
      expect(selected().getAttribute("aria-expanded")).toBe(null);
      await click(tab("音程"));
      expect(tip()).toBe(null);
      expect(host.textContent).not.toContain(SHARED);
    });

    it("× で閉じる", async () => {
      await draw(make());
      await click(tab("重心"));
      const x = tip().querySelector('button[aria-label="用語の説明を閉じる"]');
      expect(x).toBeTruthy();
      await click(x);
      expect(tip()).toBe(null);
    });

    it("吹き出しの外を触ると閉じる(吹き出しの中を触っても閉じない)", async () => {
      await draw(make());
      await click(tab("重心"));
      await act(async () => { tipParts()[1].dispatchEvent(new Event("pointerdown", { bubbles: true })); });
      expect(tip()).not.toBe(null);
      await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
      expect(tip()).toBe(null);
    });

    // 【便BC 審査】内側とみなすのは吹き出しとタブのボタンだけ。タブ列の空いたところ(「音程」より右の帯)は外。
    it("タブ列の空いたところ(tablist 自体)を触ると閉じる。タブのボタン(字の上)を触っても閉じない", async () => {
      await draw(make());
      await click(tab("重心"));
      await act(async () => { selected().querySelector("span").dispatchEvent(new Event("pointerdown", { bubbles: true })); });
      expect(tip()).not.toBe(null);
      await act(async () => { tablist().dispatchEvent(new Event("pointerdown", { bubbles: true })); });
      expect(tip()).toBe(null);
    });

    it("× で閉じるとフォーカスは選んでいるタブへ戻る(body に落とさない)", async () => {
      await draw(make());
      await click(tab("重心"));
      const x = tip().querySelector('button[aria-label="用語の説明を閉じる"]');
      x.focus();
      expect(document.activeElement).toBe(x);
      await click(x);
      expect(tip()).toBe(null);
      expect(document.activeElement).toBe(selected());
      expect(tabText(document.activeElement)).toBe("重心");
    });

    it("フォーカスが吹き出しとタブの外へ出たら閉じる(キーボードだけの操作で裏に残さない)。その後の Esc はシートへ届く", async () => {
      await draw(make());
      selected().focus();
      await click(tab("重心"));
      // 中(× / タブ)へ移っても閉じない
      await act(async () => { tip().querySelector('button[aria-label="用語の説明を閉じる"]').focus(); });
      expect(tip()).not.toBe(null);
      await act(async () => { tab("HNR").focus(); });
      expect(tip()).not.toBe(null);
      // 外へ出ると閉じる
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      await act(async () => { outside.focus(); });
      expect(tip()).toBe(null);
      let reachedWindow = 0;
      const onWin = (e) => { if (e.key === "Escape") reachedWindow += 1; };
      window.addEventListener("keydown", onWin);
      try {
        await act(async () => { outside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
        expect(reachedWindow).toBe(1); // 最初の Esc が見えない吹き出しに吸われない
      } finally {
        window.removeEventListener("keydown", onWin);
      }
    });

    // 【便BC 審査】「浮かぶ」と「上向きの三角」。流れの中に置くとグラフを押し下げ、三角が下向きだとタブを指さない。
    it("吹き出しは浮かぶ(absolute・タブ列の真下)。三角は上向き(上辺から外へ出て、下辺だけが塗り)", async () => {
      await draw(make());
      await click(tab("重心"));
      expect(tip().style.position).toBe("absolute");
      expect(tip().style.top).toBe("100%");
      expect(tip().parentElement.style.position).toBe("relative");
      const arrow = tip().querySelector("[data-term-arrow]");
      expect(arrow.style.position).toBe("absolute");
      expect(parseFloat(arrow.style.top)).toBeLessThan(0);
      expect(arrow.style.bottom).toBe("");
      expect(arrow.style.borderBottom).toContain("var(--c-ink)");
      expect(arrow.style.borderTop).toBe("");
      expect(arrow.style.borderLeft).toContain("transparent");
      expect(arrow.style.borderRight).toContain("transparent");
    });

    it("Esc で閉じる。Esc はそこで止まり、window(シートの Esc)へは届かない", async () => {
      await draw(make());
      await click(tab("重心"));
      let reachedWindow = 0;
      const onWin = (e) => { if (e.key === "Escape") reachedWindow += 1; };
      window.addEventListener("keydown", onWin);
      try {
        await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
        expect(tip()).toBe(null);
        expect(reachedWindow).toBe(0);
        // 閉じたあとの Esc は止めない(シートを閉じる Esc を奪わない)
        await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
        expect(reachedWindow).toBe(1);
      } finally {
        window.removeEventListener("keydown", onWin);
      }
    });
  });
}

describe("横スワイプでページが替わったら閉じる(便BC 審査)", () => {
  it("平均カードが裏へ回る(active=false)と閉じる。表へ戻っても閉じたまま", async () => {
    const at = (active) => <DataScreen users={USERS} ideals={IDEALS} myIdeals={MINE} myUid="me" saxTypes={["alto"]} tuningHz={TUNING} active={active} />;
    await draw(at(true));
    await click(tab("重心"));
    expect(tip()).not.toBe(null);
    await draw(at(false));
    expect(tip()).toBe(null);
    await draw(at(true));
    expect(tip()).toBe(null);
  });
});

describe("濃紺の上の切り替えは平均カードだけ(便BC モック「C」)", () => {
  it("平均カードは .card-accent。見出し・人数は濃紺の上の字、切り替えは選択 = --c-on-accent + 同色の下線 / 非選択 = --c-on-accent-dim / 区切り線は無い", async () => {
    await draw(PLACES[0][1]());
    const card = host.querySelector(".card.card-accent");
    expect(card).toBeTruthy();
    expect(card.contains(tablist())).toBe(true);
    const face = (t) => t.querySelector("span");
    expect(face(selected()).style.color).toBe("var(--c-on-accent)");
    expect(face(selected()).style.boxShadow).toContain("var(--c-on-accent)");
    for (const t of tabs().filter((x) => x !== selected())) expect(face(t).style.color).toBe("var(--c-on-accent-dim)");
    // 区切り線は引かない(統括裁定)。tablist の中の要素はタブのボタンだけ。
    expect([...tablist().children].every((c) => c.getAttribute("role") === "tab")).toBe(true);
    // 見出しと人数
    const eyebrow = [...card.querySelectorAll("div")].find((d) => d.textContent === "みんなの平均");
    expect(eyebrow.style.color).toBe("var(--c-on-accent-dim)");
    const count = [...card.querySelectorAll("div")].find((d) => d.textContent === "目安を公開している3人");
    expect(count.style.color).toBe("var(--c-on-accent-dim)");
    expect(count.querySelector("span").style.color).toBe("var(--c-on-accent)");
  });

  it("切り替えより下(グラフ・凡例)は白い台紙(--c-surface・--r-1)の中。0件の知らせも台紙の中", async () => {
    await draw(PLACES[0][1]());
    const inset = host.querySelector("[data-avg-inset]");
    expect(inset.style.background).toBe("var(--c-surface)");
    expect(inset.style.borderRadius).toBe("var(--r-1)");
    expect(inset.contains(host.querySelector("svg g"))).toBe(true);
    expect(inset.contains(host.querySelector("svg[data-legend-swatch]"))).toBe(true);
    expect(inset.contains(tablist())).toBe(false);
    // 音程のデータが無い → 「この指標のデータがありません」も台紙の中
    const noPitch = IDEALS.map((x) => ({ ...x, notes: Object.fromEntries(Object.entries(x.notes).map(([k, n]) => [k, { spectralCentroidHz: n.spectralCentroidHz, hnrDb: n.hnrDb }])) }));
    await draw(<DataScreen users={USERS} ideals={noPitch} myIdeals={{}} myUid="me" saxTypes={["alto"]} tuningHz={TUNING} />);
    // 自分の線が無いときの「お待ちしています」は残る(台紙の中)
    expect(host.querySelector("[data-avg-inset]").textContent).toContain(WAIT);
    await click(tab("音程"));
    expect(host.querySelector("[data-avg-inset]").textContent).toContain("この指標のデータがありません");
  });

  it("人物のページの切り替えは今までの色(--c-ink / --c-ink-3)で、区切り線も濃紺のカードも持たない", async () => {
    await draw(PLACES[1][1]());
    expect(host.querySelector(".card-accent")).toBe(null);
    const face = (t) => t.querySelector("span");
    expect(face(selected()).style.color).toBe("var(--c-ink)");
    expect(face(selected()).style.boxShadow).toBe("inset 0 -2px 0 0 var(--c-ink)");
    for (const t of tabs().filter((x) => x !== selected())) expect(face(t).style.color).toBe("var(--c-ink-3)");
    expect([...tablist().children].every((c) => c.getAttribute("role") === "tab")).toBe(true);
  });
});
