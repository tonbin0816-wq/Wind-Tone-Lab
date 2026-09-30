// @vitest-environment jsdom
import React, { act, useState } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BE 2026-09-30 本人指示・統括の裁定「案(a)」】目安から重心・HNR を外したときの知らせ。
// セッション詳細とリード詳細が共有する指標カード(MetricTabCard)を**実際に描いてタブを押す**。
//   ・出る: 重心か HNR のタブを見ていて、その指標が selectedIdeal.excludedMetrics に入っている
//   ・出ない: 音程・音量のタブ / 外していない方の指標のタブ / 目安を選んでいない / 何も外していない目安
//   ・跳ねない: 外している指標が1つでもあれば、行はどのタブでも置かれ、出さないタブでは visibility: hidden
// 目安は本物の idealForUse(App の selectedIdeal を作る関数)で作る ── 揃えずに取り込んだ目安を、
// 自分の計測が無い状態で使うと重心・HNR が外れる。
// 【守っていないもの】2画面(セッション詳細・リード詳細)がこの部品に selectedIdeal を渡していること
// (pitch-test 28.4 D-7 が両方の呼び出しを見ている)。ブラウザでの実寸。
// ------------------------------------------------------------------
const { MetricTabCard, MeasuredWidthSeedContext } = await import("./App.jsx");
const { idealForUse, IDEAL_EXCLUDED_NOTE } = await import("./community/align.js");

const NOTE = "My Data が不足しています";
const notes = Object.fromEntries([14, 16, 18].map((k, i) => [k, { centroidHz: 1500 + i * 40, hnrDb: 18 + i, pitchCentsSigned: 2 - i, volumeDb: -20 }]));
// 揃えずに取り込んだ目安(コミュニティの「目安に設定」で共通の音が足りなかったとき)
const ADOPTED_UNALIGNED = { id: "i1", name: "しろねこ さんの目安", saxType: "alto", sourceKind: "community", alignedAtAdopt: false, notes };
const BOTH_OUT = idealForUse(ADOPTED_UNALIGNED, null);
const HNR_OUT = { ...BOTH_OUT, excludedMetrics: ["hnrDb"] };
const OWN = idealForUse({ id: "i2", name: "自分の目安", saxType: "alto", sourceKind: "session", notes }, null);

let root; let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

function Harness({ selectedIdeal, initial }) {
  const [metric, setMetric] = useState(initial);
  return (
    <MeasuredWidthSeedContext.Provider value={340}>
      <MetricTabCard frames={[]} saxType="alto" tuningHz={442} selectedIdeal={selectedIdeal} metric={metric} onMetricChange={setMetric} />
    </MeasuredWidthSeedContext.Provider>
  );
}
const draw = async (selectedIdeal, initial = "spectralCentroidHz") => {
  await act(async () => { root.render(<Harness selectedIdeal={selectedIdeal} initial={initial} />); });
};
const noteEl = () => host.querySelector("[data-ideal-excluded-note]");
const shown = () => {
  const el = noteEl();
  return Boolean(el) && el.style.visibility !== "hidden" && el.getAttribute("aria-hidden") !== "true" && el.textContent === NOTE;
};
const tab = async (label) => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent.trim() === label);
  expect(b, label).toBeTruthy();
  await act(async () => { b.click(); });
};

describe("目安から外した指標の知らせ(指標カード)", () => {
  it("前提: 揃えずに取り込んだ目安を自分の計測なしで使うと、重心・HNR が外れる(自分の計測から作った目安は外れない)", () => {
    expect(BOTH_OUT.excludedMetrics).toEqual(["centroidHz", "hnrDb"]);
    expect(OWN.excludedMetrics).toBeUndefined();
    expect(IDEAL_EXCLUDED_NOTE).toBe(NOTE);
  });

  it("重心と HNR のタブでは出る。音程・音量のタブでは出ない(行は置いたまま隠す)", async () => {
    await draw(BOTH_OUT, "spectralCentroidHz");
    expect(shown()).toBe(true);
    const el = noteEl();
    expect(el.style.fontSize).toBe("var(--fs-xs)");
    expect(el.style.color).toBe("var(--c-ink-3)");
    await tab("HNR");
    expect(shown()).toBe(true);
    await tab("音程");
    expect(noteEl()).not.toBe(null);
    expect(noteEl().style.visibility).toBe("hidden");
    expect(shown()).toBe(false);
    await tab("音量");
    expect(shown()).toBe(false);
    expect(noteEl()).not.toBe(null);
    await tab("重心");
    expect(shown()).toBe(true);
  });

  it("HNR だけを外した目安: HNR のタブでだけ出て、重心のタブでは出ない", async () => {
    await draw(HNR_OUT, "spectralCentroidHz");
    expect(shown()).toBe(false);
    expect(noteEl()).not.toBe(null); // 高さは予約してある
    await tab("HNR");
    expect(shown()).toBe(true);
  });

  it("タブを替えても行は同じ1つの要素のまま(カードの高さが動かない)", async () => {
    await draw(BOTH_OUT, "pitchCentsSigned");
    const first = noteEl();
    expect(first).not.toBe(null);
    for (const t of ["HNR", "重心", "音量", "音程"]) {
      await tab(t);
      expect(noteEl()).toBe(first);
      expect(host.querySelectorAll("[data-ideal-excluded-note]")).toHaveLength(1);
    }
  });

  it("目安を選んでいない・何も外していない目安では、行ごと置かない", async () => {
    for (const ideal of [null, OWN, { ...BOTH_OUT, excludedMetrics: [] }]) {
      await draw(ideal, "spectralCentroidHz");
      expect(noteEl()).toBe(null);
      await tab("HNR");
      expect(noteEl()).toBe(null);
      expect(host.textContent).not.toContain(NOTE);
    }
  });
});
