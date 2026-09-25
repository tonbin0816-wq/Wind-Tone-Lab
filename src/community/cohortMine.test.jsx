// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BA 2026-09-25 本人指示】データタブの「みんなの平均」で「重なっている音が 3 音に足りません」が出て、
// 平均そのものが出なかった(本人の T.Sax の計測が少ない)。本人「ここはみんなの平均なので、
// 自分の計測数が少なくても、その条件のみんなの平均値が出ればいい」。
//   ・みんなの平均 … 自分の計測に関係なく出す。自分と共通の音が 3 音以上なら平均を自分へ揃えて自分の線と重ねる。
//                    足りなければ(自分の計測が無いときも)自分の線は出さず「あなたの計測データもお待ちしています」
//   ・人物紹介     … その人の線はいつも出す。同じ規則で自分の線と1行を出し分ける
//   ・目安に設定   … 共通の音が足りなくても押せる。足りないときは揃えない値を取り込む
// **実際に描いて押す**(jsdom)。自分の計測が無い / 0音 / 2音 / 3音 重なる、の4通り。
// 描き方は personChart.test.jsx / mineFullLine.test.jsx と同じ(BottomSheet は中身を描くだけの作り物・幅は種で与える)。
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

const TUNING = 442;
const WAIT = "あなたの計測データもお待ちしています";
const THEIR_KEYS = [14, 16, 18, 20, 22];
const sharedNotes = (keys, base) => Object.fromEntries(keys.map((k, i) => [k, {
  spectralCentroidHz: base + i * 55, hnrDb: 17 + i * 1.5, pitchCentsSigned: 4 - i * 3,
}]));
const localNotes = (keys, base) => Object.fromEntries(keys.map((k, i) => [k, {
  centroidHz: base + i * 40, hnrDb: 10 + i * 0.5, pitchCentsSigned: -3 + i,
}]));
// 自分の計測の4通り(相手はみんな 14/16/18/20/22 を持つ)
const CASES = [
  ["自分の計測が無い", {}, false],
  ["自分と0音重なる", { alto: { notes: localNotes([0, 1, 2, 3], 900) } }, false],
  ["自分と2音重なる", { alto: { notes: localNotes([0, 14, 16], 900) } }, false],
  ["自分と3音重なる", { alto: { notes: localNotes([0, 14, 16, 18], 900) } }, true],
];

const USERS = ["a", "b", "c"].map((u) => ({ uid: u, nickname: u, saxTypes: ["alto"], genres: [], position: "学生" }));
// 【便BA 再審査 中2】人ごとに**形が違う**(ずらしただけの写しではない)。平均の形も自分の形(直線)とも違う。
const SHAPES = [
  { c: [1450, 1530, 1490, 1600, 1560], h: [17, 19.5, 18, 21, 20] },
  { c: [1380, 1400, 1470, 1440, 1520], h: [15, 16, 18.5, 17, 19] },
  { c: [1500, 1610, 1580, 1650, 1700], h: [18, 17, 20, 22.5, 21] },
];
const shapedNotes = ({ c, h }) => Object.fromEntries(THEIR_KEYS.map((k, i) => [k, {
  spectralCentroidHz: c[i], hnrDb: h[i], pitchCentsSigned: 4 - i * 3,
}]));
const IDEALS = USERS.map((u, i) => ({ id: `${u.uid}_alto`, ownerUid: u.uid, saxType: "alto", notes: shapedNotes(SHAPES[i]), sourceSessionCount: 3 }));

let root; let host; let realRect;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  // jsdom は SVG の文字幅を測れない(折れ線の目盛の柱の幅に使う)。字数 × 7px の概算で置き換える。
  // 【守っていないもの】ブラウザでの実寸。ここで見るのは線・凡例・1行・ボタンの有無だけ。
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  // jsdom は配置を計算しない(幅 0)。グラフは実測幅で描くので、器の幅を 360px と答えさせる。
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
// 系列の <g>(線と点の色を style で持つ)。自分 = 紺、相手 = --c-ink-3
const groups = () => [...host.querySelectorAll("svg g")].filter((g) => /stroke:/.test(g.getAttribute("style") || ""));
const mineLine = () => groups().find((g) => (g.getAttribute("style") || "").includes("var(--c-accent)"));
const otherLine = () => groups().find((g) => (g.getAttribute("style") || "").includes("var(--c-ink-3)"));
// 線の点(circle)を x の順に並べて返す
const dots = (g) => [...g.querySelectorAll("circle")].map((c) => ({ x: +c.getAttribute("cx"), y: +c.getAttribute("cy") })).sort((p, q) => p.x - q.x);
// 【便BA 再審査 中2】線の**値**を読む。縦軸は1次(yAt)なので、値の分かっている自分の点2つから写し方を決め、
// 相手(平均・その人)の点を値へ戻す。自分の 14/16/18 の重心は localNotes どおり 940 / 980 / 1020 Hz。
const MINE_C = { 14: 940, 16: 980, 18: 1020 };
const decodeCommon = () => {
  const mine = dots(mineLine()).slice(-3); // 自分は 0/14/16/18(0 は軸の外なら描かれない)。後ろ3つが 14/16/18
  const other = dots(otherLine()).slice(0, 3); // 相手は 14..22。前3つが 14/16/18
  expect(mine.map((p) => p.x)).toEqual(other.map((p) => p.x)); // 同じ音の位置どうし
  const slope = (MINE_C[18] - MINE_C[14]) / (mine[2].y - mine[0].y);
  const valueAt = (y) => MINE_C[14] + (y - mine[0].y) * slope;
  expect(valueAt(mine[1].y)).toBeCloseTo(MINE_C[16], 6); // 写し方の確かめ(真ん中の点が戻る)
  return [14, 16, 18].map((k, i) => ({ key: k, mine: MINE_C[k], other: valueAt(other[i].y) }));
};
const median = (xs) => { const a = [...xs].sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
const legendLabels = () => [...host.querySelectorAll("svg[data-legend-swatch]")].map((s) => s.parentElement.textContent);

describe("みんなの平均は自分の計測に関係なく出る(便BA)", () => {
  for (const [name, myIdeals, aligned] of CASES) {
    it(`${name}: 平均の線は出る。自分の線は${aligned ? "出る" : "出ない"}・1行は${aligned ? "出ない" : "出る"}`, async () => {
      await draw(<DataScreen users={USERS} ideals={IDEALS} myIdeals={myIdeals} myUid="me" saxTypes={["alto"]} tuningHz={TUNING} />);
      expect(host.textContent).not.toContain("重なっている音");
      expect(host.textContent).not.toContain("自分の計測がまだありません");
      expect(host.textContent).toContain("目安を公開している3人");
      expect(otherLine()).toBeTruthy();
      expect(otherLine().querySelectorAll("circle").length).toBe(THEIR_KEYS.length);
      expect(Boolean(mineLine())).toBe(aligned);
      expect(legendLabels()).toEqual(aligned ? ["みんなの平均", "自分"] : ["みんなの平均"]);
      expect(host.textContent.includes(WAIT)).toBe(!aligned);
      // 【便BC 2026-09-25 本人指示】揃えの注記はグラフの下から消え、重心・HNR の用語の説明(吹き出し)へ移った。
      // 吹き出しは閉じて描かれるので、揃えていても本文には出ない(開け閉めは termTip.test.jsx)。
      expect(host.textContent.includes("揃えた状態で線の形で比較しています")).toBe(false);
    });
  }
  it("【便BA 再審査 中2】3音重なる: 平均の線は**自分の高さへ動いている**(共通の音での中央値が自分と一致)。形は平均のまま", async () => {
    await draw(<DataScreen users={USERS} ideals={IDEALS} myIdeals={CASES[3][1]} myUid="me" saxTypes={["alto"]} tuningHz={TUNING} />);
    const rows = decodeCommon();
    // 揃え方は align.js の alignOffset(共通の音での中央値どうしを合わせる)。
    // 揃えていなければ平均は 1400〜1650 Hz 台(自分は 940〜1020)で、中央値の差は数百 Hz になる
    expect(Math.abs(median(rows.map((r) => r.other)) - median(rows.map((r) => r.mine)))).toBeLessThan(0.01);
    // 平均の形は自分の形(40 Hz 刻みの直線)の写しではない = 平均そのものを動かしている
    const d = rows.map((r) => r.other - r.mine);
    expect(Math.max(...d) - Math.min(...d)).toBeGreaterThan(5);
  });
  it("【便BA 再審査 軽3】公開している人は3人いるのに同じ音で揃えられるのが3人未満 → 「あと○人」ではなく2行の文", async () => {
    const lone = { ...IDEALS[2], notes: shapedNotes(SHAPES[2]) };
    // c だけ別の音(0/2/4/6/8)を持つ = a・b と共通の音が無く、平均に入れられない
    lone.notes = Object.fromEntries(Object.values(lone.notes).map((n, i) => [i * 2, n]));
    await draw(<DataScreen users={USERS} ideals={[IDEALS[0], IDEALS[1], lone]} myIdeals={{}} myUid="me" saxTypes={["alto"]} tuningHz={TUNING} />);
    expect(host.textContent).toContain("同じ音を計測している人が、まだ足りません");
    expect(host.textContent).toContain("みなさまのデータをお待ちしています");
    expect(host.textContent).not.toContain("人のデータが必要です");
    expect(otherLine()).toBeFalsy();
  });
  it("【便BA 再審査 軽5】この指標のデータが無い(グラフが無い)ときは、揃えの注記も「お待ちしています」も出さない", async () => {
    const noPitch = IDEALS.map((x) => ({ ...x, notes: Object.fromEntries(Object.entries(x.notes).map(([k, n]) => [k, { spectralCentroidHz: n.spectralCentroidHz, hnrDb: n.hnrDb }])) }));
    await draw(<DataScreen users={USERS} ideals={noPitch} myIdeals={{}} myUid="me" saxTypes={["alto"]} tuningHz={TUNING} />);
    // 重心のタブ(グラフあり)では1行が出ている = 下の不在が「そもそも描いていない」ではないことの確かめ
    expect(host.textContent).toContain(WAIT);
    const tab = [...host.querySelectorAll("button")].find((b) => b.textContent === "音程");
    expect(tab).toBeTruthy();
    await act(async () => { tab.click(); });
    expect(host.textContent).toContain("この指標のデータがありません");
    expect(host.textContent).not.toContain(WAIT);
    expect(host.textContent).not.toContain("揃えた状態で線の形で比較しています");
  });
  it("人数が足りなければ今までどおり「あと○人…」(自分の計測に関係なく)", async () => {
    await draw(<DataScreen users={USERS} ideals={IDEALS.slice(0, 2)} myIdeals={{}} myUid="me" saxTypes={["alto"]} tuningHz={TUNING} />);
    expect(host.textContent).toContain("あと1人のデータが必要です");
    expect(otherLine()).toBeFalsy();
  });
});

describe("人物紹介: その人の線はいつも出る。目安に設定は共通の音が足りなくても押せる(便BA)", () => {
  const PERSON = { uid: "a", nickname: "しろねこ", icon: "ic-cat", iconColor: 2, photo: null, saxTypes: ["alto"], gear: { alto: {} }, position: "学生", genres: [], ensembles: [], stats: { daysAll: 3 } };
  for (const [name, myIdeals, aligned] of CASES) {
    it(`${name}: その人の線は出る。自分の線は${aligned ? "出る" : "出ない"}・1行は${aligned ? "出ない" : "出る"}・目安に設定が押せる`, async () => {
      let adopted = null;
      await draw(<PersonSheet person={PERSON} ideals={[IDEALS[0]]} myIdeals={myIdeals} onClose={() => {}}
                               onAdopt={(x) => { adopted = x; return { ok: true }; }} myUid="me" tuningHz={TUNING} />);
      expect(host.textContent).not.toContain("重なっている音");
      expect(host.textContent).not.toContain("自分の計測がまだありません");
      expect(otherLine()).toBeTruthy();
      expect(Boolean(mineLine())).toBe(aligned);
      expect(host.textContent.includes(WAIT)).toBe(!aligned);
      const btn = [...host.querySelectorAll("button")].find((b) => b.textContent === "目安に設定");
      expect(btn).toBeTruthy();
      await act(async () => { btn.click(); });
      expect(adopted).not.toBe(null);
      expect(host.textContent).toContain("目安に設定しました");
      // 取り込む値: 揃えられたら揃えた値(shiftedBy あり)、揃えられなければ揃えない値そのもの
      const raw = IDEALS[0].notes["14"].spectralCentroidHz;
      if (aligned) {
        expect(adopted.aligned.shiftedBy).not.toBe(null);
        expect(adopted.aligned.notes["14"].spectralCentroidHz).not.toBe(raw);
      } else {
        expect(adopted.aligned.shiftedBy).toBe(null);
        expect(adopted.aligned.notes["14"].spectralCentroidHz).toBe(raw);
        expect(adopted.aligned.notes["14"].hnrDb).toBe(IDEALS[0].notes["14"].hnrDb);
      }
      expect(Object.keys(adopted.aligned.notes["14"])).not.toContain("volumeDb");
      // 【便BA 再審査 中2】描いた線の値も確かめる。揃えたときはその人の線が自分の高さへ動いている
      if (aligned) {
        const rows = decodeCommon();
        expect(Math.abs(median(rows.map((r) => r.other)) - median(rows.map((r) => r.mine)))).toBeLessThan(0.01);
      }
    });
  }
});
