import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MeasuredWidthSeedContext, NoteAxisLineChart, concertNoteLabelOf, noteAxisGuideName } from "./App.jsx";

// ------------------------------------------------------------------
// 【便AZ 2026-09-25 本人指示 D】音名軸の折れ線グラフの目印の音(縦の点線・太字の音名・
// 横軸の音名の間引きの起点)。本人「A.Sax と B.Sax はそのまま E♭。S.Sax と T.Sax は B♭」。
// **実際に描いて読む**(react-dom/server。personChart.test.jsx と同じ描き方)。
// 期待値は本人の言葉(楽器 → 音名の表)をそのまま書く。実装の式(移調量から導く)から逆算しない。
//
// 【守っていないもの】ブラウザでの実寸(文字の送り幅はサーバ描画では概算)。
// ------------------------------------------------------------------
const TUNING = 442;
const EXPECT = { soprano: "B♭", alto: "E♭", tenor: "B♭", baritone: "E♭" };

const axisOf = (saxType) => {
  const out = [];
  for (let i = 0; i < 100; i++) { const l = concertNoteLabelOf(i, saxType, TUNING); if (!l) break; out.push(l); }
  return out;
};
const draw = (saxType, width) => renderToStaticMarkup(
  <MeasuredWidthSeedContext.Provider value={width}>
    <NoteAxisLineChart
      label="HNR" unit="dB" metricKey="hnrDb" saxType={saxType} tuningHz={TUNING}
      fmt={(v) => v.toFixed(1)}
      series={[{ id: "s", label: "s", byIdx: { 5: 10, 12: 12, 20: 11, 28: 13 } }]}
    />
  </MeasuredWidthSeedContext.Provider>,
);
const read = (html) => {
  const svg = (html.match(/<svg[\s\S]*?<\/svg>/) || [""])[0];
  const labels = [...svg.matchAll(/<text x="([-\d.]+)"[^>]*font-weight="(\d+)"[^>]*text-anchor="middle"[^>]*>([^<]*)<\/text>/g)]
    .map((m) => ({ x: m[1], bold: m[2] === "700", name: m[3] }));
  const guide = (svg.match(/<line x1="([-\d.]+)"[^>]*stroke-dasharray="4 3"/) || [])[1] ?? null;
  return { labels, guide };
};

describe("音名軸の目印の音は楽器で変わる(E♭管は E♭、B♭管は B♭)", () => {
  it("規則: 楽器 → 目印の音名(本人の表そのまま)。知らない楽器は以前と同じ E♭", () => {
    for (const [sax, name] of Object.entries(EXPECT)) expect(noteAxisGuideName(sax)).toBe(name);
    expect(noteAxisGuideName(undefined)).toBe("E♭");
  });

  for (const [sax, name] of Object.entries(EXPECT)) {
    it(`${sax}: 縦の点線と太字の音名は ${name} で、音域の中央に最も近いその音`, () => {
      const { labels, guide } = read(draw(sax, 2000));   // 2000px なら間引かず全音に名札が立つ
      const axis = axisOf(sax);
      expect(labels.map((l) => l.name)).toEqual(axis);
      const bold = labels.filter((l) => l.bold);
      expect(bold).toHaveLength(1);
      expect(bold[0].name.startsWith(name)).toBe(true);
      expect(bold[0].name.startsWith(name === "E♭" ? "B♭" : "E♭")).toBe(false);
      expect(guide).toBe(bold[0].x);                     // 縦線は太字の音名の真上
      // 「音域の中央に最も近い」その音
      const center = (axis.length - 1) / 2;
      const candidates = axis.map((n, i) => (n.startsWith(name) ? i : -1)).filter((i) => i >= 0);
      const nearest = candidates.reduce((b, i) => (Math.abs(i - center) < Math.abs(b - center) ? i : b), candidates[0]);
      expect(axis.indexOf(bold[0].name)).toBe(nearest);
    });

    it(`${sax}: 間引いたとき、横軸の音名は ${name} を起点に等間隔(${name} は必ず残る)`, () => {
      const { labels } = read(draw(sax, 360));
      const axis = axisOf(sax);
      const at = labels.map((l) => axis.indexOf(l.name));
      expect(at.length).toBeGreaterThan(2);
      expect(at.length).toBeLessThan(axis.length);        // 実際に間引いている
      const step = at[1] - at[0];
      expect(at.every((v, k) => k === 0 || v - at[k - 1] === step)).toBe(true);
      const bold = labels.find((l) => l.bold);
      expect(bold).toBeTruthy();
      expect(bold.name.startsWith(name)).toBe(true);
      expect(labels.filter((l) => l.name.startsWith(name)).length).toBeGreaterThan(0);
    });
  }
});
