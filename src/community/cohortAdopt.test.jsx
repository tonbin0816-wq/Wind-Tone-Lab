// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { createHash } from "node:crypto";

// ------------------------------------------------------------------
// 【便BO 2026-10-02 本人指示】「コミュニティでみんなの平均をそのまま目安にする構想を忘れてた。みんなの平均カードを
// タップで、そのとき抽出されている条件の平均の目安に設定するか聞いて設定する導線を作って。表のカードのレイアウトは変えないで」。
// **実際に描いて押す**(jsdom)。描き方は cohortMine.test.jsx / termTip.test.jsx と同じ
// (BottomSheet は中身を描くだけの作り物・幅は種で与える)。
//   ・カード(見出し・人数・グラフ・凡例・台紙の余白)を押すと確認のシートが開く
//   ・指標タブ(押し直しで開く用語の吹き出しを含む)とタブの列を押しても開かない
//   ・吹き出しが開いているときにカードを押したら、吹き出しを閉じるだけ(シートは開かない)
//   ・平均が出ていない(「あと○人…」・同じ音の人が足りない)ときは押しても何も起きない
//   ・本文はそのとき抽出されている条件と人数の1行
//   ・「目安に設定」で受け口(App.jsx の onAdoptIdeal と同じ1つ)へ渡る値 → buildAdoptedProfile が作る目安の形
//   ・「やめる」では何も渡さない
//   ・カードの見た目(要素・クラス・style・字)は便BO の前と同じ
// 期待する平均の値は**手で計算した数**(人ごとに同じ形をずらしただけにしてあるので、揃えると基準の人の値に戻る)。
// 実装の cohortAverage から期待値を作らない(作ると恒真になる)。
// 【守っていないもの】App.jsx の onAdoptIdeal の中身(帯を出す・選ぶ・足す)は描かない ── その配線は
// pitch-test の BO の検査が綴りで見ている。ブラウザでの実寸・フォーカスの輪郭の見え方は 375×812 の実測で見た(報告)。
// ------------------------------------------------------------------
vi.mock("../App.jsx", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    BottomSheet: ({ ariaLabel, children }) => <div role="dialog" aria-label={ariaLabel}>{children}</div>,
  };
});

import { MeasuredWidthSeedContext } from "../App.jsx";
import { DataScreen, PersonSheet } from "./screens.jsx";
import { buildAdoptedProfile } from "./idealDoc.js";
import { idealForUse, idealHasExcluded } from "./align.js";

const TUNING = 442;
const KEYS = [14, 16, 18, 20, 22];
const TITLE = "みんなの平均を目安に設定しますか";
// 人 a を基準に、b は重心 +100Hz・HNR +2dB、c は重心 -40Hz・HNR -1dB だけずらした同じ形。
// 他の人どうしで揃える(重心・HNR を共通音の中央値で合わせる)と、3人とも a の値に重なる → 平均 = a の値。
// 音程は揃えずに平均する: (0 + 3 + -3) / 3 = 0 …(音ごとに +1)。
const A_C = [1000, 1100, 1200, 1300, 1400];
const A_H = [10, 11, 12, 13, 14];
const PITCH = { a: [0, 1, 2, 3, 4], b: [3, 4, 5, 6, 7], c: [-3, -2, -1, 0, 1], d: [20, 21, 22, 23, 24] };
const SHIFT = { a: [0, 0], b: [100, 2], c: [-40, -1], d: [3000, 5] };
// 【便BO2 2026-10-02】倍音構成(公開の綴り harmonics = 次数ごとの比の配列)。どの音も人ごとに同じ配列。
// 平均は次数ごとの算術平均(揃えない・正規化し直さない)。期待値は下に手で書いた。
const HARM = {
  a: [1, 0.5, 0.3, 0.2, 0.1, 0.05, 0.02, 0.01],
  b: [1, 0.7, 0.5, 0.3, 0.2, 0.1, 0.05, 0.02],
  c: [0.8, 1, 0.4, 0.2, 0.1, 0.1, 0.05, 0],
  d: [1, 1, 1, 1, 1, 1, 1, 1],
};
// a・b・c の3人の平均 / d も入った4人の平均(手計算)
const HARM_ABC = [2.8 / 3, 2.2 / 3, 1.2 / 3, 0.7 / 3, 0.4 / 3, 0.25 / 3, 0.12 / 3, 0.03 / 3];
const HARM_ABCD = [3.8 / 4, 3.2 / 4, 2.2 / 4, 1.7 / 4, 1.4 / 4, 1.25 / 4, 1.12 / 4, 1.03 / 4];
const notesOf = (u) => Object.fromEntries(KEYS.map((k, i) => [k, {
  spectralCentroidHz: A_C[i] + SHIFT[u][0], hnrDb: A_H[i] + SHIFT[u][1], pitchCentsSigned: PITCH[u][i],
  harmonics: HARM[u],
}]));
// 取り込んだ目安の倍音構成(ローカルの綴り [{ n, norm }])を、手計算の配列と比べる
const expectHarm = (got, want) => {
  expect(got).toHaveLength(want.length);
  want.forEach((w, i) => { expect(got[i].n).toBe(i + 1); expect(got[i].norm).toBeCloseTo(w, 9); });
};
const user = (uid, genres, position) => ({ uid, nickname: uid, saxTypes: ["alto"], genres, position });
// d だけジャズ・社会人。条件を付けないと d も平均に入る(音程の平均が変わる)。
const USERS = [user("a", ["クラシック"], "学生"), user("b", ["クラシック"], "学生"), user("c", ["クラシック"], "学生"), user("d", ["ジャズ"], "社会人")];
const IDEALS = USERS.map((u) => ({ id: `${u.uid}_alto`, ownerUid: u.uid, saxType: "alto", notes: notesOf(u.uid), sourceSessionCount: 3 }));
const ABC_USERS = USERS.slice(0, 3);
const ABC_IDEALS = IDEALS.slice(0, 3);
// 自分の計測(ローカルの綴り)。14/16/18 で平均と3音重なる → 平均を自分へ揃えられる。
// 重心 900/1000/1100 と平均 1000/1100/1200 の中央値の差 -100、HNR 8/9/10 と 10/11/12 の差 -2。
const MINE_LOCAL = { notes: Object.fromEntries([14, 16, 18].map((k, i) => [k, { centroidHz: 900 + i * 100, hnrDb: 8 + i, pitchCentsSigned: 0 }])) };
const MINE = { alto: MINE_LOCAL };

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
const screen = (props = {}) => (
  <DataScreen users={USERS} ideals={IDEALS} myIdeals={{}} myUid="me" saxTypes={["alto"]} tuningHz={TUNING} {...props} />
);

const card = () => host.querySelector(".card.card-accent");
const inset = () => host.querySelector("[data-avg-inset]");
const sheet = () => host.querySelector(`[role="dialog"][aria-label="${TITLE}"]`);
const tip = () => host.querySelector("[data-term-tip]");
const tablist = () => host.querySelector('[role="tablist"][aria-label="見る指標"]');
const tabs = () => [...tablist().querySelectorAll('[role="tab"]')];
const tab = (label) => tabs().find((t) => (t.firstChild?.firstChild?.textContent ?? "") === label);
const click = async (el) => { await act(async () => { el.click(); }); };
// 指で押す: pointerdown(吹き出しは document でこれを聞いて閉じる)→ click
const press = async (el) => {
  await act(async () => { el.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
  await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
};
const key = async (el, k) => { await act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); }); };
const btn = (root0, label) => [...root0.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
// 条件の行の select(楽器 / ジャンル / 属性 の順)
const pickFilter = async (i, value) => {
  const sel = host.querySelectorAll("select")[i];
  await act(async () => {
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

describe("みんなの平均カードを押すと、目安に設定するかの確認のシートが開く(便BO)", () => {
  // 押せる場所: 見出し・人数・グラフ(svg)・凡例・台紙そのもの・カードの余白(カード自身)
  const TARGETS = [
    ["見出し「みんなの平均」", () => [...card().querySelectorAll("div")].find((d) => d.textContent === "みんなの平均")],
    ["人数", () => [...card().querySelectorAll("div")].find((d) => d.textContent === "目安を公開している4人")],
    ["グラフ", () => inset().querySelector("svg")],
    ["凡例", () => inset().querySelector("svg[data-legend-swatch]").parentElement],
    ["白い台紙", () => inset()],
    ["カードの余白(カードそのもの)", () => card()],
  ];
  for (const [name, get] of TARGETS) {
    it(`${name}を押すと開く`, async () => {
      await draw(screen({ onAdopt: () => ({ ok: true }) }));
      expect(sheet()).toBe(null);
      const el = get();
      expect(el).toBeTruthy();
      await press(el);
      expect(sheet()).not.toBe(null);
      expect(sheet().textContent).toContain(TITLE);
    });
  }

  it("キーボード: 台紙は role=button・tabIndex 0・名前「みんなの平均を目安に設定」。Enter でも Space でも開く", async () => {
    await draw(screen({ onAdopt: () => ({ ok: true }) }));
    expect(inset().getAttribute("role")).toBe("button");
    expect(inset().getAttribute("tabindex")).toBe("0");
    // 【便BO2】名前は見えない要素を aria-labelledby で指す(aria-label は中身の読み上げを置き換えるので使わない)
    expect(inset().getAttribute("aria-label")).toBe(null);
    const nameEl = document.getElementById(inset().getAttribute("aria-labelledby"));
    expect(nameEl.textContent).toBe("みんなの平均を目安に設定");
    expect(nameEl.hidden).toBe(true);
    expect(card().contains(nameEl)).toBe(false); // カードの中の要素は増やさない
    // カードそのものは押せる部品を名乗らない(名乗ると中の指標タブが読み上げから消える)
    expect(card().getAttribute("role")).toBe(null);
    expect(card().getAttribute("tabindex")).toBe(null);
    await key(inset(), "Enter");
    expect(sheet()).not.toBe(null);
    await click(btn(sheet(), "やめる"));
    expect(sheet()).toBe(null);
    await key(inset(), " ");
    expect(sheet()).not.toBe(null);
  });

  // 【便BO2 2026-10-02 統括の裁定】名前のほかに、凡例と下の1行が読み上げから消えないこと(aria-describedby)。
  it("読み上げ: 台紙の説明(aria-describedby)は凡例と「あなたの計測データもお待ちしています」。自分の線があれば凡例だけ・グラフが無ければ0件の文", async () => {
    const described = () => inset().getAttribute("aria-describedby").split(" ").map((id) => document.getElementById(id).textContent);
    await draw(screen({ onAdopt: () => ({ ok: true }) }));
    expect(described()).toEqual(["みんなの平均", "あなたの計測データもお待ちしています"]);
    await draw(screen({ onAdopt: () => ({ ok: true }), myIdeals: MINE }));
    expect(described()).toEqual(["みんなの平均自分"]);
    const noPitch = IDEALS.map((x) => ({ ...x, notes: Object.fromEntries(Object.entries(x.notes).map(([k, v]) => [k, { spectralCentroidHz: v.spectralCentroidHz, hnrDb: v.hnrDb }])) }));
    await draw(screen({ onAdopt: () => ({ ok: true }), ideals: noPitch }));
    expect(described()).toEqual(["この指標のデータがありません"]);
    // 受け口が無いときは名前も説明も付けない
    await draw(screen());
    expect(inset().getAttribute("aria-describedby")).toBe(null);
    expect(inset().getAttribute("aria-labelledby")).toBe(null);
  });

  it("受け口(onAdopt)を渡さない呼び手では、押しても開かず、台紙は押せる部品を名乗らない", async () => {
    await draw(screen());
    await press(inset().querySelector("svg"));
    expect(sheet()).toBe(null);
    expect(inset().getAttribute("role")).toBe(null);
    expect(inset().getAttribute("tabindex")).toBe(null);
  });
});

describe("指標タブとぶつからない(便BO)", () => {
  // 【便BQ 2026-10-03 本人の実機指示】タブと同じ行の右側(タブ列の空いた所)は、押すとシートが開く。開かないのはタブのボタンそのものだけ。
  it("どのタブを押しても開かない。選んでいるタブの押し直し(吹き出しを開く)でも開かない。タブの列の空いたところは開く", async () => {
    const onAdopt = vi.fn(() => ({ ok: true }));
    await draw(screen({ onAdopt }));
    for (const label of ["音程", "HNR", "重心"]) {
      await press(tab(label));
      expect(tab(label).getAttribute("aria-selected")).toBe("true");
      expect(sheet()).toBe(null);
    }
    // 重心を選んでいる。もう一度押すと吹き出しが開く(シートは開かない)
    await press(tab("重心"));
    expect(tip()).not.toBe(null);
    expect(sheet()).toBe(null);
    // もう一度で閉じる
    await press(tab("重心"));
    expect(tip()).toBe(null);
    expect(sheet()).toBe(null);
    expect(onAdopt).not.toHaveBeenCalled();
    // タブの列そのもの(一番右のタブより右の帯)。吹き出しが開いているときは閉じるだけ(便BC の決まり)
    await press(tab("重心"));
    expect(tip()).not.toBe(null);
    await press(tablist());
    expect(tip()).toBe(null);
    expect(sheet()).toBe(null);
    // 吹き出しが閉じていれば、空いた所でシートが開く
    await press(tablist());
    expect(sheet()).not.toBe(null);
    expect(onAdopt).not.toHaveBeenCalled();   // 開くだけ(設定は確認のシートの主ボタンで)
  });

  it("吹き出しが開いているあいだにカード(グラフ)を押すと、吹き出しを閉じるだけ。もう一度押すと開く", async () => {
    await draw(screen({ onAdopt: () => ({ ok: true }) }));
    await press(tab("HNR"));
    await press(tab("HNR"));
    expect(tip()).not.toBe(null);
    await press(inset().querySelector("svg"));
    expect(tip()).toBe(null);
    expect(sheet()).toBe(null);
    await press(inset().querySelector("svg"));
    expect(sheet()).not.toBe(null);
  });

  it("吹き出しの中(本文・×)を押しても開かない", async () => {
    await draw(screen({ onAdopt: () => ({ ok: true }) }));
    await press(tab("HNR"));
    await press(tab("HNR"));
    await press(tip().lastElementChild);
    expect(tip()).not.toBe(null);
    expect(sheet()).toBe(null);
    await press(tip().querySelector('button[aria-label="用語の説明を閉じる"]'));
    expect(tip()).toBe(null);
    expect(sheet()).toBe(null);
  });
});

describe("平均が出ていないときは押しても何も起きない(便BO)", () => {
  const CASES = [
    ["あと1人(公開している人が2人)", ABC_USERS.slice(0, 2), ABC_IDEALS.slice(0, 2), "あと1人のデータが必要です"],
    // 3人公開しているが、同じ音が無い(c だけ別の音)→ 平均に入るのは2人
    ["同じ音を計測している人が足りない", ABC_USERS, [ABC_IDEALS[0], ABC_IDEALS[1],
      { ...ABC_IDEALS[2], notes: Object.fromEntries([30, 32, 34].map((k) => [k, { spectralCentroidHz: 1200, hnrDb: 12, pitchCentsSigned: 0 }])) }],
      "同じ音を計測している人が、まだ足りません"],
  ];
  for (const [name, users, ideals, text] of CASES) {
    it(name, async () => {
      const onAdopt = vi.fn(() => ({ ok: true }));
      await draw(<DataScreen users={users} ideals={ideals} myIdeals={{}} myUid="me" saxTypes={["alto"]} tuningHz={TUNING} onAdopt={onAdopt} />);
      expect(inset().textContent).toContain(text);
      for (const el of [inset(), card(), [...card().querySelectorAll("div")].find((d) => d.textContent === "みんなの平均")]) {
        await press(el);
        expect(sheet()).toBe(null);
      }
      await key(inset(), "Enter");
      expect(sheet()).toBe(null);
      expect(inset().getAttribute("role")).toBe(null);
      expect(inset().getAttribute("tabindex")).toBe(null);
      expect(onAdopt).not.toHaveBeenCalled();
    });
  }
});

describe("確認のシートの中身(便BO)", () => {
  // 【便BO3 2026-10-03 統括の裁定】本文は記号で区切らず、余白(gap)で並べた語の列。語ごとに読む。
  const lineEl = () => sheet().querySelector("[data-cohort-adopt-line]");
  const lineOf = () => [...lineEl().children].map((c) => c.textContent);
  it("見出し・本文(楽器と条件と人数)・ボタン2つ。条件の付いていない項目は出さない。中黒も「・」も使わない", async () => {
    await draw(screen({ onAdopt: () => ({ ok: true }) }));
    await press(inset());
    expect(sheet().getAttribute("aria-label")).toBe(TITLE);
    // 条件なし(ジャンル・属性は「すべて」)→ 楽器と 4人
    expect(lineOf()).toEqual(["A.Sax", "の4人の平均"]);
    expect([...sheet().querySelectorAll("button")].map((b) => b.textContent.trim())).toEqual(["目安に設定", "やめる"]);
    // 余白で並べる(WhoLine / InfoLine と同じ gap 9)
    expect(lineEl().style.display).toBe("flex");
    expect(lineEl().style.gap).toBe("9px");
    await click(btn(sheet(), "やめる"));

    await pickFilter(1, "クラシック");
    await press(inset());
    expect(lineOf()).toEqual(["A.Sax", "クラシック", "の3人の平均"]);
    await click(btn(sheet(), "やめる"));

    await pickFilter(2, "学生");
    await press(inset());
    expect(lineOf()).toEqual(["A.Sax", "クラシック", "学生", "の3人の平均"]);
    expect(lineEl().textContent).not.toMatch(/[·・×]/);
    await click(btn(sheet(), "やめる"));

    await pickFilter(1, "__any__");
    await press(inset());
    expect(lineOf()).toEqual(["A.Sax", "学生", "の3人の平均"]);
  });

  it("人数はカードの「目安を公開している○人」と同じ数", async () => {
    await draw(screen({ onAdopt: () => ({ ok: true }) }));
    await pickFilter(1, "クラシック");
    expect(card().textContent).toContain("目安を公開している3人");
    await press(inset());
    expect(sheet().querySelector("[data-cohort-adopt-line]").textContent).toContain("の3人の平均");
  });

  // 【便BO3 2026-10-03 統括の裁定】シートの中の主ボタンの標準(目安に設定のシートの「保存」・リード追加の「追加」)。
  // 期待値は手で書いた値(App.jsx の「保存」「追加」の style に書いてある値。実装の定数からは読まない)。
  it("「目安に設定」はシートの中の主ボタンの標準(--fs-md・700・影なし・地 --c-accent・字 --c-on-accent・高さ --tap-min)", async () => {
    await draw(screen({ onAdopt: () => ({ ok: true }) }));
    await press(inset());
    const b = btn(sheet(), "目安に設定");
    expect(b.style.fontSize).toBe("var(--fs-md)");
    expect(b.style.fontWeight).toBe("700");
    expect(b.style.boxShadow).toBe("");
    expect(b.style.background).toBe("var(--c-accent)");
    expect(b.style.color).toBe("var(--c-on-accent)");
    expect(b.style.minHeight).toBe("var(--tap-min)");
    expect(b.style.borderRadius).toBe("var(--r-pill)");
  });

  it("人物のページの貼り付く「目安に設定」は今までの見た目のまま(浮かせるボタン。手で書いた値)", async () => {
    const PERSON = { uid: "a", nickname: "しろねこ", icon: "ic-cat", iconColor: 2, photo: null, saxTypes: ["alto"], gear: { alto: {} }, position: "学生", genres: [], ensembles: [], stats: { daysAll: 3 } };
    await draw(<PersonSheet person={PERSON} ideals={[IDEALS[0]]} myIdeals={{}} onClose={() => {}} onAdopt={() => ({ ok: true })} myUid="me" tuningHz={TUNING} />);
    const person = btn(host, "目安に設定");
    expect(person.style.background).toBe("var(--c-accent)");
    expect(person.style.color).toBe("var(--c-on-accent)");
    expect(person.style.borderRadius).toBe("var(--r-pill)");
    expect(person.style.minHeight).toBe("var(--tap-min)");
    expect(person.style.padding).toBe("0 var(--sp-5)");
    expect(person.style.fontSize).toBe("var(--fs-sm)");
    expect(person.style.fontWeight).toBe("600");
    expect(person.style.boxShadow).toBe("0 8px 24px rgba(15,23,42,0.18)");
  });

  // 【便BO3 審査の変異 R4】取り込めなかった文は、シートを開き直したら消えている。
  it("取り込めなかった文は、やめる → 開き直すと消えている", async () => {
    await draw(screen({ onAdopt: () => ({ error: "取り込める音がありませんでした" }) }));
    await press(inset());
    await click(btn(sheet(), "目安に設定"));
    expect(sheet().querySelector('[role="alert"]')).not.toBe(null);
    await click(btn(sheet(), "やめる"));
    expect(sheet()).toBe(null);
    await press(inset());
    expect(sheet()).not.toBe(null);
    expect(sheet().querySelector('[role="alert"]')).toBe(null);
  });
});

describe("「目安に設定」で取り込む目安の形(便BO)", () => {
  // 受け口に渡った値を、App.jsx の onAdoptIdeal と同じく buildAdoptedProfile へ通す(baseFreqOf は渡さない)。
  const adoptVia = async (myIdeals, filters) => {
    const onAdopt = vi.fn(() => ({ ok: true }));
    await draw(screen({ onAdopt, myIdeals }));
    for (const [i, v] of filters) await pickFilter(i, v);
    await press(inset());
    await click(btn(sheet(), "目安に設定"));
    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(sheet()).toBe(null); // 設定したら閉じる
    const arg = onAdopt.mock.calls[0][0];
    const r = buildAdoptedProfile({ ...arg, id: "x1" });
    expect(r.error).toBeUndefined();
    return { arg, profile: r.profile };
  };

  it("自分の計測が無い: 揃えない写し(印 alignedAtAdopt: false)。値は条件で絞った3人の平均そのもの", async () => {
    const { arg, profile } = await adoptVia({}, [[1, "クラシック"], [2, "学生"]]);
    expect(arg.announce).toBe(true);
    expect(arg.theirIdeal.saxType).toBe("alto");
    // 【便BO3】楽器は入れない(一覧が後ろに付ける)。全角の括弧・条件の区切りは半角の空白1つ
    expect(arg.name).toBe("みんなの平均（クラシック 学生）");
    expect(profile.name).toBe("みんなの平均（クラシック 学生）");
    expect(profile.sourceKind).toBe("community");
    expect(profile.alignedAtAdopt).toBe(false);
    expect(profile.saxType).toBe("alto");
    expect(profile.sourceSessionIds).toEqual([]);
    expect(Object.keys(profile.notes).map(Number)).toEqual(KEYS);
    KEYS.forEach((k, i) => {
      const n = profile.notes[k];
      expect(n.centroidHz).toBeCloseTo(A_C[i], 9);
      expect(n.hnrDb).toBeCloseTo(A_H[i], 9);
      expect(n.pitchCentsSigned).toBeCloseTo(i, 9); // (0+3-3)/3 = 0, …
      expect(n.semitoneIndex).toBe(k);
      // 【便BO2】倍音構成は a・b・c の平均(d は条件で外れる)。音量は公開していないので持たない
      expectHarm(n.harmonicsProfile, HARM_ABC);
      expect(n.volumeDb).toBeUndefined();
    });
    // 【便BE】使うとき自分へ揃えられなければ、重心・HNR を外す(「My Data が不足しています」)
    const used = idealForUse(profile, { notes: {} });
    expect(used.excludedMetrics).toEqual(["centroidHz", "hnrDb"]);
    expect(idealHasExcluded(used)).toBe(true);
    // 自分の計測が揃えられるだけあれば外さない
    expect(idealHasExcluded(idealForUse(profile, MINE_LOCAL))).toBe(false);
  });

  it("自分と3音重なる: 自分へ揃えた値(印 alignedAtAdopt: true)。カードが描いているのと同じ高さ", async () => {
    const { profile } = await adoptVia(MINE, [[1, "クラシック"]]);
    expect(profile.name).toBe("みんなの平均（クラシック）");
    expect(profile.alignedAtAdopt).toBe(true);
    KEYS.forEach((k, i) => {
      expect(profile.notes[k].centroidHz).toBeCloseTo(A_C[i] - 100, 9);
      expect(profile.notes[k].hnrDb).toBeCloseTo(A_H[i] - 2, 9);
      expect(profile.notes[k].pitchCentsSigned).toBeCloseTo(i, 9); // 音程は揃えない
      expectHarm(profile.notes[k].harmonicsProfile, HARM_ABC); // 【便BO2】倍音構成も揃えない(揃えない写しと同じ値)
    });
    expect(idealHasExcluded(idealForUse(profile, MINE_LOCAL))).toBe(false);
  });

  it("条件を付けないと d(ジャズ・社会人)も平均に入る: 音程の平均が (0+3-3+20)/4 = 5 から始まる", async () => {
    const { profile } = await adoptVia({}, []);
    expect(profile.name).toBe("みんなの平均"); // 【便BO3】楽器のほかに条件が無ければ括弧ごと付けない
    KEYS.forEach((k, i) => {
      expect(profile.notes[k].pitchCentsSigned).toBeCloseTo(5 + i, 9);
      expect(profile.notes[k].centroidHz).toBeCloseTo(A_C[i], 9); // 同じ形をずらしただけなので揃えると a に重なる
      expectHarm(profile.notes[k].harmonicsProfile, HARM_ABCD); // 【便BO2】d の倍音構成も入る
    });
  });

  // 【便BO2 2026-10-02 統括の裁定】人物の取り込みと同じ綴り・同じ尺度。計測タブの音色一致度が読む形
  // (App.jsx: noteIdeal.harmonicsProfile.map((h) => h.norm))で、倍音の項に数が入る。
  it("倍音構成は人物の取り込みと同じ綴り([{ n, norm }]・8次)で、音色一致度が読む数の配列になる", async () => {
    const { profile } = await adoptVia({}, [[1, "クラシック"]]);
    const person = buildAdoptedProfile({ aligned: { notes: IDEALS[0].notes, shiftedBy: null }, theirIdeal: { saxType: "alto" }, nickname: "a", id: "p" }).profile;
    const shape = (h) => h.map((x) => Object.keys(x).sort().join(","));
    expect(shape(profile.notes[14].harmonicsProfile)).toEqual(shape(person.notes[14].harmonicsProfile));
    expectHarm(person.notes[14].harmonicsProfile, HARM.a);
    const forScore = profile.notes[14].harmonicsProfile.map((h) => h.norm);
    expect(forScore.every((v) => typeof v === "number" && Number.isFinite(v))).toBe(true);
    expect(forScore.some((v) => v > 0)).toBe(true);
    // 使うとき(idealForUse)も倍音構成は外さない(外すのは重心・HNR だけ)
    expectHarm(idealForUse(profile, { notes: {} }).notes[14].harmonicsProfile, HARM_ABC);
  });

  it("取り込めなかった(受け口がエラーを返した)ときはシートを閉じず、その文を出す", async () => {
    await draw(screen({ onAdopt: () => ({ error: "取り込める音がありませんでした" }) }));
    await press(inset());
    await click(btn(sheet(), "目安に設定"));
    expect(sheet()).not.toBe(null);
    expect(sheet().querySelector('[role="alert"]').textContent).toBe("取り込める音がありませんでした");
  });

  it("「やめる」では何も渡さない(受け口が呼ばれない)・シートを閉じる", async () => {
    const onAdopt = vi.fn(() => ({ ok: true }));
    await draw(screen({ onAdopt }));
    await press(inset());
    await click(btn(sheet(), "やめる"));
    expect(sheet()).toBe(null);
    expect(onAdopt).not.toHaveBeenCalled();
  });

  it("名前の付け方: 条件が無ければ「みんなの平均」(buildAdoptedProfile は渡された名前をそのまま使う)", () => {
    const r = buildAdoptedProfile({ aligned: { notes: { 14: { spectralCentroidHz: 1, hnrDb: 1 } }, shiftedBy: null }, theirIdeal: { saxType: "alto" }, nickname: null, name: "みんなの平均", id: "x" });
    expect(r.profile.name).toBe("みんなの平均");
    // 人物は name を渡さない → 今までどおり
    const p = buildAdoptedProfile({ aligned: { notes: { 14: { spectralCentroidHz: 1, hnrDb: 1 } }, shiftedBy: null }, theirIdeal: { saxType: "alto" }, nickname: "しろねこ", id: "y" });
    expect(p.profile.name).toBe("しろねこ さんの目安");
  });
});

// ------------------------------------------------------------------
// 【便BO3 2026-10-03 審査の指摘】足した検査(R1・R12・全角の括弧の属性・pointercancel)
// ------------------------------------------------------------------
describe("審査の変異で落とす(便BO3)", () => {
  // R1: キーボードで「×」を押す(Enter はボタンに pointerdown を伴わない click を起こす)
  it("R1: 吹き出しの「×」をキーボードで押す(pointerdown の無い click)→ 吹き出しが閉じ、シートは開かない", async () => {
    await draw(screen({ onAdopt: () => ({ ok: true }) }));
    await press(tab("HNR"));
    await press(tab("HNR"));
    expect(tip()).not.toBe(null);
    await click(tip().querySelector('button[aria-label="用語の説明を閉じる"]'));
    expect(tip()).toBe(null);
    expect(sheet()).toBe(null);
  });

  // R12: 自分の目安は平均に入らない(myUid の人を除く)。期待値は手計算(b・c・d の3人)
  it("R12: 自分の目安は平均に入らない(人数・音程・倍音構成)", async () => {
    const onAdopt = vi.fn(() => ({ ok: true }));
    await draw(screen({ onAdopt, myUid: "a" }));
    expect(card().textContent).toContain("目安を公開している3人");
    await press(inset());
    await click(btn(sheet(), "目安に設定"));
    const profile = buildAdoptedProfile({ ...onAdopt.mock.calls[0][0], id: "x" }).profile;
    const HARM_BCD = [2.8 / 3, 2.7 / 3, 1.9 / 3, 1.5 / 3, 1.3 / 3, 1.2 / 3, 1.1 / 3, 1.02 / 3];
    KEYS.forEach((k, i) => {
      expect(profile.notes[k].pitchCentsSigned).toBeCloseTo((3 - 3 + 20) / 3 + i, 9);
      expectHarm(profile.notes[k].harmonicsProfile, HARM_BCD);
    });
  });

  it("属性の値が全角の括弧を持つ(学生（音楽専門）)とき、名前は「みんなの平均（クラシック 学生（音楽専門））」", async () => {
    const SP = "学生（音楽専門）";
    const users = USERS.map((u) => ({ ...u, position: SP }));
    const onAdopt = vi.fn(() => ({ ok: true }));
    await draw(screen({ onAdopt, users }));
    await pickFilter(1, "クラシック");
    await pickFilter(2, SP);
    await press(inset());
    expect([...sheet().querySelector("[data-cohort-adopt-line]").children].map((c) => c.textContent)).toEqual(["A.Sax", "クラシック", SP, "の3人の平均"]);
    await click(btn(sheet(), "目安に設定"));
    expect(onAdopt.mock.calls[0][0].name).toBe("みんなの平均（クラシック 学生（音楽専門））");
  });

  it("押し始めが中断された(pointercancel)ら控えた印を戻す: 吹き出しが開いていた押し始めのあとでも、次の click で開く", async () => {
    await draw(screen({ onAdopt: () => ({ ok: true }) }));
    await press(tab("HNR"));
    await press(tab("HNR"));
    expect(tip()).not.toBe(null);
    const g = inset().querySelector("svg");
    // 吹き出しが開いている状態で押し始め → スクロールに変わって中断(click は来ない)
    await act(async () => { g.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    await act(async () => { g.dispatchEvent(new Event("pointercancel", { bubbles: true })); });
    expect(tip()).toBe(null);
    expect(sheet()).toBe(null);
    // pointerdown を伴わない click(キーボードの起こす click と同じ形)
    await act(async () => { g.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(sheet()).not.toBe(null);
  });
});

// ------------------------------------------------------------------
// カードの見た目が変わっていないこと。カードの中の全要素の「タグ・クラス・style・直下の字」を並べた写しで比べる。
// 読み上げと押す処理の属性(role / tabindex / aria-*)は見た目ではないので並べない。
// 期待値 CARD_BEFORE_SHA は**便BO の前のコミット(8df151a)の screens.jsx を複製のツリーで描いて**、この同じ関数で
// 取った写しのハッシュ(実装の外から読んだ値)。場面は 4人・条件なし・自分の計測なし・最初の指標(音程)。
// ------------------------------------------------------------------
const visualOf = (el) => {
  const out = [];
  const walk = (n, depth) => {
    if (n.nodeType === 3) { if (n.textContent.trim()) out.push(`${depth}#${n.textContent.trim()}`); return; }
    if (n.nodeType !== 1) return;
    out.push(`${depth}<${n.tagName.toLowerCase()} class="${n.getAttribute("class") ?? ""}" style="${n.getAttribute("style") ?? ""}">`);
    for (const c of n.childNodes) walk(c, depth + 1);
  };
  walk(el, 0);
  return out.join("\n");
};
const CARD_BEFORE_SHA = "33a0c4deb6c6bde3cc7c292e81119d9a850dd2630f073364b87948474dafc1a5";

describe("カードの見た目は便BO の前と同じ(要素・クラス・style・字)", () => {
  it("受け口を渡しても渡さなくても、カードの写しは1字も違わない", async () => {
    await draw(screen({ onAdopt: () => ({ ok: true }) }));
    const withEntry = visualOf(card());
    await draw(screen());
    const without = visualOf(card());
    expect(withEntry.length).toBeGreaterThan(2000); // 写しが空回りしていない(グラフの要素まで並んでいる)
    expect(withEntry).toBe(without);
  });

  it("便BO の前のコミットで取った写しのハッシュと一致する", async () => {
    await draw(screen({ onAdopt: () => ({ ok: true }) }));
    const sha = createHash("sha256").update(visualOf(card())).digest("hex");
    if (process.env.BO_PRINT_CARD_SHA) console.log(`BO_CARD_SHA=${sha}`);
    expect(sha).toBe(CARD_BEFORE_SHA);
  });
});
