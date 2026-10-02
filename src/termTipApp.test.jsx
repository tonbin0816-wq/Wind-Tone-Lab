// @vitest-environment jsdom
import React, { act, useState } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BI 2026-10-02 本人指示】重心・HNR の用語の吹き出しを、コミュニティ以外の「重心・HNR を切り替えるタブ」
// にも入れる。部品はコミュニティ(便BC)と同じ1つ(src/termTip.jsx の TermTip)。
// 置き場(リードタブ・データタブの指標タブ。App.jsx の MetricUnderlineTabs の呼び手の全部):
//   ・セッション詳細 / リード詳細 … 同じ MetricTabCard
//   ・リードの比較                … ReedCompareTab(ReedsTab の「比較」ページ)
//   ・My Data の音の傾向カード     … MyDataSection
// (分析タブの「横軸」は PlainSelect の選択欄でタブではないので対象外。コミュニティの2箇所は termTip.test.jsx。)
// **実際に描いて押す**。期待値はここに手で書いた文(画面の定数から読まない)。
//   ・選んでいる指標が重心か HNR のときだけ「?」。音程・音量では出ない・押しても開かない
//   ・選んでいるタブをもう一度押すと開く / もう一度で閉じる。別のタブで閉じる
//   ・文案は一字一句このまま。**共通の一文(揃えて比べる説明)は出ない**(自分のデータどうしの比較で揃えていない)
//   ・×・外を触る・Esc で閉じる。Esc は吹き出しで止まり、閉じたあとの Esc は止めない
//   ・本物の BottomSheet の中でも、Esc 1回目は吹き出しだけ・2回目でいちばん上のシート1枚だけ(便BG の器)
//   ・横スワイプでページが替わったら閉じる(比較・My Data)/ My Data のタブ列の右端のセレクタは「外」
// 【守っていないもの】吹き出しの実寸・三角の位置・画面の端からの距離(jsdom は配置を計算しない)。
//   ブラウザ(375px)で測った値は報告に書いた。
// ------------------------------------------------------------------
const { MetricTabCard, MyDataSection, ReedsTab, BottomSheet, MeasuredWidthSeedContext } = await import("./App.jsx");

const CENTROID = "音に含まれる成分が、どの高さに集まっているかを表す値です。高い成分が多いほど値が上がり、明るい音に聞こえます。";
const HNR = "楽器の響きと、息などの雑音の大きさの比です。高いほど芯のある澄んだ音に聞こえます。";
const SHARED = "計測環境により値全体が一律にずれるため、揃えた状態で線の形で比較しています。";

let root; let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  // 音名軸のグラフが字の幅を測る(jsdom に無い)。termTip.test.jsx と同じ作り物。
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});
const draw = async (el) => {
  await act(async () => { root.render(<MeasuredWidthSeedContext.Provider value={340}>{el}</MeasuredWidthSeedContext.Provider>); });
};
const click = async (el) => { await act(async () => { el.click(); }); };

// ---- 3つの置き場 ----------------------------------------------------------------
function CardHarness() {
  const [metric, setMetric] = useState("pitchCentsSigned");
  return <MetricTabCard frames={[]} saxType="alto" tuningHz={442} selectedIdeal={null} metric={metric} onMetricChange={setMetric} />;
}
const REEDS = [
  { id: "a1", brand: "Vandoren", model: "Traditional", strength: "3.0", startDate: "2026-09-10", saxType: "alto", createdAt: "2026-09-10T01:00:00Z" },
  { id: "a2", brand: "Vandoren", model: "Traditional", strength: "3.0", startDate: "2026-09-10", saxType: "alto", createdAt: "2026-09-10T01:00:01Z" },
];
function ReedsHarness() {
  const [reeds, setReeds] = useState(REEDS);
  const [compareReedIds, setCompareReedIds] = useState(["a1", "a2"]);
  const [reedsSubTab, setReedsSubTab] = useState("compare");
  return (
    <ReedsTab
      reeds={reeds} setReeds={setReeds} sessions={[]} updateSessions={() => {}}
      setTopTab={() => {}} setSelectedReedId={() => {}} selectedReedId={null}
      selectedIdeal={null} saxType="alto" setSaxType={() => {}} tuningHz={442}
      compareReedIds={compareReedIds} setCompareReedIds={setCompareReedIds}
      reedsSubTab={reedsSubTab} setReedsSubTab={setReedsSubTab}
      showNotice={() => {}}
    />
  );
}
function MyDataHarness({ pageActive = true }) {
  const [dataSax, setDataSax] = useState("alto");
  const [range, setRange] = useState("all");
  return (
    <MyDataSection
      sessions={[]} reeds={[]} selectedIdeal={null} saxType="alto" tuningHz={442}
      dataSax={dataSax} setDataSax={setDataSax} range={range} setRange={setRange}
      totalSessionCount={0} onOpenSession={() => {}} onOpenAllSessions={() => {}}
      onCompareOthers={() => {}} onOpenCommunityIdeals={() => {}}
      idealProfiles={[]} selectedIdealId={null} setSelectedIdealId={() => {}} onDeleteIdeal={() => {}}
      pageActive={pageActive}
    />
  );
}
const PLACES = [
  ["セッション詳細・リード詳細(MetricTabCard)", () => <CardHarness />],
  ["リードの比較(ReedCompareTab)", () => <ReedsHarness />],
  ["My Data の音の傾向カード(MyDataSection)", () => <MyDataHarness />],
];

// 指標タブ = 「?」の印(data-term-tab)を持つボタン。見えている字は「?」(飾り)を除いて読む。
// 比較のページャは「登録」のページも描いたままなので、比較のページの中だけを見る(表にあるタブは1列)。
const visible = (el) => [...el.childNodes].map((n) => (n.nodeType === 1 ? (n.hasAttribute("data-term-mark") ? "" : visible(n)) : n.textContent)).join("");
const tabs = () => [...document.body.querySelectorAll("[data-term-tab]")];
const tab = (label) => {
  const hit = tabs().filter((t) => visible(t).trim() === label);
  expect(hit, label).toHaveLength(1);
  return hit[0];
};
const selected = () => tabs().find((t) => t.getAttribute("aria-pressed") === "true");
const tip = () => document.body.querySelector("[data-term-tip]");
const tipParts = () => [...tip().children].filter((c) => c.tagName === "DIV");
const marks = () => document.body.querySelectorAll("[data-term-mark]");
// 【便BI 2026-10-02 審査の差し戻し】読み上げ: aria-pressed のボタンの名前は見えている字のまま(状態で変えない。
// W3C APG)。「用語の説明」は aria-describedby の先の文(見せない要素)。
const nameOf = (el) => el.getAttribute("aria-label") ?? visible(el).trim();
const descOf = (el) => {
  const id = el.getAttribute("aria-describedby");
  const d = id ? document.getElementById(id) : null;
  return d ? { text: d.textContent, hidden: d.hidden } : null;
};

for (const [place, make] of PLACES) {
  describe(`用語の説明(吹き出し): ${place}`, () => {
    it("タブは 音程 / HNR / 重心 / 音量 の4つ。最初の音程では「?」が無く、押しても開かない", async () => {
      await draw(make());
      expect(tabs().map((t) => visible(t).trim())).toEqual(["音程", "HNR", "重心", "音量"]);
      expect(visible(selected()).trim()).toBe("音程");
      expect(marks()).toHaveLength(0);
      expect(selected().getAttribute("aria-label")).toBe(null);
      expect(tabs().filter((t) => t.hasAttribute("aria-describedby") || t.hasAttribute("aria-expanded"))).toHaveLength(0);
      await click(selected());
      expect(tip()).toBe(null);
    });

    it("重心を選ぶと「?」が重心の右に1つ。もう一度押すと開き、文案はこのまま・共通の一文は出ない。もう一度で閉じる", async () => {
      await draw(make());
      await click(tab("重心"));
      expect(visible(selected()).trim()).toBe("重心");
      expect(marks()).toHaveLength(1);
      expect(selected().contains(marks()[0])).toBe(true);
      expect(marks()[0].getAttribute("aria-hidden")).toBe("true");
      expect(marks()[0].textContent).toBe("?");
      // 名前は「重心」のまま(押された状態でも変わらない)。説明に「用語の説明」
      expect(selected().getAttribute("aria-label")).toBe(null);
      expect(selected().getAttribute("aria-pressed")).toBe("true");
      expect(nameOf(selected())).toBe("重心");
      expect(descOf(selected())).toEqual({ text: "用語の説明", hidden: true });
      expect(selected().getAttribute("aria-expanded")).toBe("false");
      expect(tip()).toBe(null);
      await click(tab("重心"));
      expect(tip()).not.toBe(null);
      expect(selected().getAttribute("aria-expanded")).toBe("true");
      expect(selected().getAttribute("aria-controls")).toBe(tip().id);
      expect(tip().getAttribute("aria-label")).toBe("重心 用語の説明");
      const parts = tipParts();
      expect(parts.map((p) => p.textContent)).toEqual(["重心×", CENTROID]);   // 見出し + 用語の説明だけ
      expect(document.body.textContent).not.toContain(SHARED);
      expect(visible(selected()).trim()).toBe("重心");   // 押しても指標は変わらない
      expect(nameOf(selected())).toBe("重心");           // 開いても名前は変わらない
      expect(descOf(selected())).toEqual({ text: "用語の説明", hidden: true });
      await click(tab("重心"));
      expect(tip()).toBe(null);
      expect(selected().getAttribute("aria-expanded")).toBe("false");
      expect(nameOf(selected())).toBe("重心");
    });

    it("開いたまま別のタブ(HNR)を押すと閉じる。HNR でも同じように開き、HNR の文案(共通の一文は無い)", async () => {
      await draw(make());
      await click(tab("重心"));
      await click(tab("重心"));
      expect(tip()).not.toBe(null);
      await click(tab("HNR"));
      expect(visible(selected()).trim()).toBe("HNR");
      expect(tip()).toBe(null);
      await click(tab("HNR"));
      expect(tipParts().map((p) => p.textContent)).toEqual(["HNR×", HNR]);
      expect(document.body.textContent).not.toContain(SHARED);
    });

    it("音量では「?」が出ず、選んでいる音量を押しても開かない", async () => {
      await draw(make());
      await click(tab("音量"));
      expect(marks()).toHaveLength(0);
      expect(selected().getAttribute("aria-describedby")).toBe(null);
      expect(selected().getAttribute("aria-expanded")).toBe(null);
      await click(tab("音量"));
      expect(tip()).toBe(null);
    });

    it("× で閉じ、フォーカスは選んでいるタブへ戻る", async () => {
      await draw(make());
      await click(tab("HNR"));
      await click(tab("HNR"));
      const x = tip().querySelector('button[aria-label="用語の説明を閉じる"]');
      x.focus();
      await click(x);
      expect(tip()).toBe(null);
      expect(document.activeElement).toBe(selected());
      expect(visible(document.activeElement).trim()).toBe("HNR");
    });

    it("外を触ると閉じる。吹き出しの中・タブの字の上を触っても閉じない", async () => {
      await draw(make());
      await click(tab("重心"));
      await click(tab("重心"));
      await act(async () => { tipParts()[1].dispatchEvent(new Event("pointerdown", { bubbles: true })); });
      expect(tip()).not.toBe(null);
      await act(async () => { selected().querySelector("span").dispatchEvent(new Event("pointerdown", { bubbles: true })); });
      expect(tip()).not.toBe(null);
      await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
      expect(tip()).toBe(null);
    });

    it("Esc で閉じる。Esc はそこで止まり window へは届かない。閉じたあとの Esc は止めない", async () => {
      await draw(make());
      await click(tab("重心"));
      await click(tab("重心"));
      let reached = 0;
      const onWin = (e) => { if (e.key === "Escape") reached += 1; };
      window.addEventListener("keydown", onWin);
      try {
        await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
        expect(tip()).toBe(null);
        expect(reached).toBe(0);
        await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
        expect(reached).toBe(1);
      } finally {
        window.removeEventListener("keydown", onWin);
      }
    });
  });
}

describe("横スワイプでページが替わったら閉じる / タブ列の右端のセレクタは「外」", () => {
  it("リードの比較: 「登録」へ切り替える(比較のページが裏へ回る)と閉じ、戻っても閉じたまま", async () => {
    await draw(<ReedsHarness />);
    await click(tab("重心"));
    await click(tab("重心"));
    expect(tip()).not.toBe(null);
    const sub = (label) => [...document.body.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent === label && !b.hasAttribute("data-term-tab"));
    await click(sub("登録"));
    expect(tip()).toBe(null);
    await click(sub("比較"));
    expect(tip()).toBe(null);
  });

  it("My Data: 分析へ回る(pageActive=false)と閉じる", async () => {
    await draw(<MyDataHarness pageActive />);
    await click(tab("HNR"));
    await click(tab("HNR"));
    expect(tip()).not.toBe(null);
    await draw(<MyDataHarness pageActive={false} />);
    expect(tip()).toBe(null);
  });

  it("My Data: 指標タブの行の右端の集計範囲のセレクタを触ると閉じる(吹き出しの内側ではない)", async () => {
    await draw(<MyDataHarness />);
    await click(tab("重心"));
    await click(tab("重心"));
    const picker = document.body.querySelector('button[aria-label="集計する楽器種別を選ぶ"]');
    expect(picker).toBeTruthy();
    // 同じ行(タブ列の箱)の中にある
    expect(tip().parentElement.contains(picker)).toBe(true);
    await act(async () => { picker.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(tip()).toBe(null);
  });
});

// 【便BG の器】Esc で閉じるのはいちばん上のシート1枚だけ。シートの中の吹き出しはそれより先に Esc を受けて止める。
describe("本物の BottomSheet の中の吹き出しと Esc の順番(便BG)", () => {
  function Stack() {
    const [open, setOpen] = useState({ A: true, B: true });
    return open.A ? (
      <BottomSheet ariaLabel="A" onClose={() => setOpen((o) => ({ ...o, A: false }))}>
        <div>A</div>
        {open.B ? (
          <BottomSheet ariaLabel="B" onClose={() => setOpen((o) => ({ ...o, B: false }))}>
            <CardHarness />
          </BottomSheet>
        ) : null}
      </BottomSheet>
    ) : null;
  }
  const sheet = (label) => document.body.querySelector(`[role="dialog"][aria-modal="true"][aria-label="${label}"]`);
  const esc = () => act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });

  it("1回目: 吹き出しだけ閉じる(シートは2枚とも残る) / 2回目: 上の B だけ / 3回目: A", async () => {
    await draw(<Stack />);
    await click(tab("重心"));
    await click(tab("重心"));
    expect(tip()).not.toBe(null);
    await esc();
    expect(tip()).toBe(null);
    expect(sheet("A")).not.toBe(null);
    expect(sheet("B")).not.toBe(null);
    await esc();
    expect(sheet("B")).toBe(null);
    expect(sheet("A")).not.toBe(null);
    await esc();
    expect(sheet("A")).toBe(null);
  });
});
