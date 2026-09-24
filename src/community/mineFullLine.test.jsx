import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { noteValues } from "./align.js";

// ------------------------------------------------------------------
// 【便AQ 2026-09-24 本人の実機報告】
// 「コミュニティのグラフがまだできてない。少なくとも自分の音は全部揃ってるはずなのに出てない」
//
// 根元: みんなの平均・人物紹介のどちらも、**相手に値がある音だけ**を拾い、自分の線もその音で
// しか拾っていなかった。テスト奏者は数音しか録っていないので、自分の線が数点に削られていた。
// ここは実際に描かせ、自分の線が**自分の持っている音をすべて**点にしていることを見る。
// 描き方は personChart.test.jsx と同じ(BottomSheet は中身を描くだけの作り物・幅は種で与える)。
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
// 自分は 10 音(10〜19 の続き)。相手は 3 音(14 / 16 / 18。自分と3音重なる = 合わせられる最小)。
const MY_KEYS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const THEIR_KEYS = [14, 16, 18];
const localNotes = (keys, base) => Object.fromEntries(keys.map((k, i) => [k, {
  centroidHz: base + i * 40, hnrDb: 18 + i * 0.5, pitchCentsSigned: -3 + i,
}]));
const sharedNotes = (keys, base) => Object.fromEntries(keys.map((k, i) => [k, {
  spectralCentroidHz: base + i * 55, hnrDb: 17 + i * 1.5, pitchCentsSigned: 4 - i * 3,
}]));
const MINE = { alto: { notes: localNotes(MY_KEYS, 1400) } };

const svgOf = (html) => (html.match(/<svg width="(\d+)" height="[\d.]+" viewBox="0 0 \1 [\s\S]*?<\/svg>/) || [""])[0];
const seriesGroups = (svg) => [...svg.matchAll(/<g style="stroke:([^;]+);fill:[^"]+">([\s\S]*?)<\/g>/g)]
  .map((m) => ({ color: m[1], dots: [...m[2].matchAll(/<circle cx="([-\d.]+)"/g)].length }));
// 【便AR】自分 = 紺(実測の見た目)、相手 = --c-ink-3(目安の見た目)
const mineGroup = (html) => seriesGroups(svgOf(html)).find((g) => g.color === "var(--c-accent)");
const otherGroup = (html) => seriesGroups(svgOf(html)).find((g) => g.color === "var(--c-ink-3)");

const USERS = ["a", "b", "c"].map((u) => ({ uid: u, nickname: u, saxTypes: ["alto"], genres: [], position: "学生" }));
const drawData = () => renderToStaticMarkup(
  <MeasuredWidthSeedContext.Provider value={2000}>
    <DataScreen users={USERS}
                ideals={USERS.map((u, i) => ({ id: `${u.uid}_alto`, ownerUid: u.uid, saxType: "alto", notes: sharedNotes(THEIR_KEYS, 1450 + i * 30), sourceSessionCount: 3 }))}
                myIdeals={MINE} myUid="me" saxTypes={["alto"]} tuningHz={TUNING} />
  </MeasuredWidthSeedContext.Provider>,
);
const PERSON = {
  uid: "p1", nickname: "しろねこ", icon: "ic-cat", iconColor: 2, photo: null,
  saxTypes: ["alto"], gear: { alto: {} }, position: "学生", genres: [], ensembles: [], stats: { daysAll: 3 },
};
const drawPerson = (theirKeys = THEIR_KEYS) => renderToStaticMarkup(
  <MeasuredWidthSeedContext.Provider value={2000}>
    <PersonSheet person={PERSON}
                 ideals={[{ id: "p1_alto", ownerUid: "p1", saxType: "alto", notes: sharedNotes(theirKeys, 1500), sourceSessionCount: 3 }]}
                 myIdeals={MINE} onClose={() => {}} onAdopt={() => ({})} myUid="me" tuningHz={TUNING} />
  </MeasuredWidthSeedContext.Provider>,
);

describe("自分の線は、自分の持っている音をすべて描く(相手の音で削らない)", () => {
  it("データの「みんなの平均」: 平均は3音でも、自分の線は10音", () => {
    const html = drawData();
    expect(otherGroup(html)?.dots).toBe(THEIR_KEYS.length);
    expect(mineGroup(html)?.dots).toBe(MY_KEYS.length);
  });

  it("人物紹介: その人が3音でも、自分の線は10音", () => {
    const html = drawPerson();
    expect(otherGroup(html)?.dots).toBe(THEIR_KEYS.length);
    expect(mineGroup(html)?.dots).toBe(MY_KEYS.length);
  });

  it("人物紹介: その人の方が音が多ければ、その人の線はその人の音をすべて描く", () => {
    const many = [8, 9, 14, 16, 18, 20, 21, 22];
    const html = drawPerson(many);
    expect(otherGroup(html)?.dots).toBe(many.length);
    expect(mineGroup(html)?.dots).toBe(MY_KEYS.length);
  });
});

describe("noteValues ── 1本の線の「音 → 値」", () => {
  it("その線が持っている音をすべて拾い、数でない値は捨てる", () => {
    const notes = { 3: { hnrDb: 10 }, 5: { hnrDb: NaN }, 7: { hnrDb: "12" }, 9: { hnrDb: 14 }, 11: {} };
    expect(noteValues(notes, "hnrDb")).toEqual({ 3: 10, 9: 14 });
  });
  it("平均のセル({ value, n })は読み方を渡して拾う", () => {
    const avg = { 4: { hnrDb: { value: 20, n: 3 } }, 6: { hnrDb: { value: 21, n: 1 } } };
    expect(noteValues(avg, "hnrDb", (c) => c?.value)).toEqual({ 4: 20, 6: 21 });
  });
  it("何も無ければ空", () => {
    expect(noteValues(undefined, "hnrDb")).toEqual({});
  });
});
