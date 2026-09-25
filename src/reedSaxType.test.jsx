// @vitest-environment jsdom
import React, { act, useState, useCallback } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import {
  reedSaxTypeOf, backfillReedSaxTypes, reedsOfSax, reedSelectionForSax, reedSaxInvariantReady,
  measureReedEmptyGuide, pivotValueLabel, PIVOT_DIMENSIONS, reedSelectionToRestore,
  reedGroupKey, reedBrandGroupKey, groupReeds,
  useSessionsStore, useReedSaxBackfill, useReedSaxInvariant, usePersistedState,
  ReedsTab, SessionEditSheet,
} from "./App.jsx";

// ------------------------------------------------------------------
// 【便AY 2026-09-25 本人指示 / 凍結仕様 docs/superpowers/specs/2026-09-25-reed-saxtype.md】
// 「リードに楽器種別の概念をいれます。バンドレンのトラディショナルにはアルトもソプラノも
//   テナーもバリトンも全部あるからです」。
//
// **実物を走らせて・描いて押す**(綴りは見ない。綴りの錨は scripts/pitch-test.mjs が持つ)。
// 期待値は仕様の文(D1〜D5 / E1〜E7)から直接書く。実装の定数から逆算しない。
//
// 【守っているもの】
//   ・推定の純関数(D1 / E4): 多数決 / 同数は最新 / 紐付けなしは alto / 既に値のあるリードは触らない /
//     変更なしは同じ参照 / 知らない値は推定し直す /
//     【2026-09-25 統括の裁定】箱ごと(古い鍵でまとめて合算・全員に同じ楽器・楽器ありの仲間は数えない)
//   ・箱の鍵(E2): 楽器だけが違う2枚が別の箱・別の銘柄の段
//   ・計測タブの絞り込みと、楽器を替えたときの選択の外し方(D2)の**判定**
//   ・リードタブ(D5): チップ4つが全部押せる / 押した楽器の箱だけ / 空の文言と案内 /
//     登録シートの楽器の初期値が一覧の選択 / 登録したリードにその楽器が入る / 比較の候補もその楽器だけ
//   ・計測にリードを付け直すシート(E6)の候補がその計測の楽器だけ
//   ・【審査の差し戻し 2026-09-25】
//     重1 楽器とリードの不変条件(useReedSaxInvariant を描いて走らせる。保存からの読み込み前・推定前では判定しない。
//         全部のリードが楽器を持てば計測の読み込みを待たない(軽4)。削除されたリードの id も外す(軽3))
//     中2 計測タブの案内の判定(measureReedEmptyGuide)
//     中3 登録シートで選んだ楽器が書かれる / 箱の編集で楽器を変えると全員が動く /
//         計測の読み込みを**実際に失敗させる**(開けない / 開けたが getAll が失敗 / IndexedDB が無い)と
//         status が "error" になり推定が走らない
//     軽5 推定の合流で番号を振り直す / 軽7 編集で楽器を変えると一覧の楽器も移る /
//     軽8 開いて閉じただけの箱の編集は楽器を書かない / E7・E8 の裁定(ピボットのリード(個体))
// 【守っていないもの】
//   ・計測タブ(MeasureView)の**配線**そのもの(描くにはマイク・メトロノーム一式が要る)。
//     候補の母集団(reedsForSax)・楽器の一手(changeSaxType)・案内とシートの条件の綴りは
//     pitch-test の検証85が固定する。App が2つのフックを呼んでいることも綴りだけ。
//   ・見た目の寸法(Chrome / 実機で見る。ピル30・当たり44は綴りの検査のみ)。
// ------------------------------------------------------------------

describe("backfillReedSaxTypes ── 楽器種別の推定(D1 / E4)", () => {
  const S = (reedId, saxType, recordedAt) => ({ id: `${reedId}-${saxType}-${recordedAt}`, reedId, saxType, recordedAt });
  // 【2026-09-25 統括の裁定】推定は箱ごと(古い鍵 = メーカー|番手|開封日)。箱を分けたいリードは開封日を変える。
  const R = (id, startDate = "2026-08-01", extra = {}) => ({ id, brand: "Vandoren", strength: "3.0", startDate, createdAt: `${startDate}T01:00:0${id.slice(-1)}Z`, ...extra });

  it("いちばん多い楽器になる", () => {
    const reeds = [{ id: "r1" }];
    const sessions = [S("r1", "tenor", "2026-09-01"), S("r1", "tenor", "2026-09-02"), S("r1", "alto", "2026-09-20")];
    expect(backfillReedSaxTypes(reeds, sessions)[0].saxType).toBe("tenor");
  });

  it("同数なら、その中でいちばん新しい計測の楽器", () => {
    const reeds = [{ id: "r1" }];
    // tenor 2件(最新 9/10)・soprano 2件(最新 9/15)・alto 1件(9/30 だが同数ではない)
    const sessions = [
      S("r1", "tenor", "2026-09-01"), S("r1", "tenor", "2026-09-10"),
      S("r1", "soprano", "2026-09-02"), S("r1", "soprano", "2026-09-15"),
      S("r1", "alto", "2026-09-30"),
    ];
    expect(backfillReedSaxTypes(reeds, sessions)[0].saxType).toBe("soprano");
    // 並びを入れ替えても答えは変わらない(配列の順ではなく時刻で決まる)
    expect(backfillReedSaxTypes(reeds, [...sessions].reverse())[0].saxType).toBe("soprano");
  });

  it("紐付いた計測が1件も無ければ alto(他のリードの計測は数えない)", () => {
    const reeds = [R("r1", "2026-08-01"), R("r2", "2026-08-20")];   // 別の箱
    const sessions = [S("r2", "baritone", "2026-09-01")];
    const out = backfillReedSaxTypes(reeds, sessions);
    expect(out[0].saxType).toBe("alto");
    expect(out[1].saxType).toBe("baritone");
  });

  it("既に知っている値を持つリードは触らない(同じ実体のまま)", () => {
    const keep = { id: "r1", saxType: "soprano" };
    const reeds = [keep, { id: "r2" }];
    const sessions = [S("r1", "tenor", "2026-09-01"), S("r1", "tenor", "2026-09-02")];
    const out = backfillReedSaxTypes(reeds, sessions);
    expect(out[0]).toBe(keep);
    expect(out[0].saxType).toBe("soprano");
  });

  it("変更が無ければ同じ配列を返す(参照が同じ = 書き戻さない)", () => {
    const reeds = [{ id: "r1", saxType: "alto" }, { id: "r2", saxType: "tenor" }];
    expect(backfillReedSaxTypes(reeds, [S("r1", "tenor", "2026-09-01")])).toBe(reeds);
    const empty = [];
    expect(backfillReedSaxTypes(empty, [])).toBe(empty);
  });

  it("知らない値(「Alto」など)は持っていないのと同じに扱って推定し直す", () => {
    const reeds = [R("r1", "2026-08-01", { saxType: "Alto" }), R("r2", "2026-08-20", { saxType: "clarinet" })];   // 別の箱
    const sessions = [S("r1", "tenor", "2026-09-01")];
    const out = backfillReedSaxTypes(reeds, sessions);
    expect(out).not.toBe(reeds);
    expect(out.map((r) => r.saxType)).toEqual(["tenor", "alto"]);
    // 計測の側の知らない楽器は数えない
    expect(backfillReedSaxTypes([{ id: "r3" }], [S("r3", "oboe", "2026-09-01")])[0].saxType).toBe("alto");
  });

  // ---- 【2026-09-25 統括の裁定】箱ごとの推定 ----
  it("同じ箱の2枚の片方だけにテナーの計測、もう片方は計測なし → 2枚ともテナー・同じ箱のまま", () => {
    const reeds = [R("b1"), R("b2")];
    const out = backfillReedSaxTypes(reeds, [S("b1", "tenor", "2026-09-01")]);
    expect(out.map((r) => r.saxType)).toEqual(["tenor", "tenor"]);
    const boxes = groupReeds(out);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].members.map((m) => m.id)).toEqual(["b1", "b2"]);   // 番号(並び)も割れない
  });

  it("箱の全員の計測を合算して多数決(1枚ずつなら割れる組み合わせでも、箱の答えは1つ)", () => {
    const reeds = [R("b1"), R("b2"), R("b3")];
    // b1: tenor 1件 / b2: alto 1件 / b3: alto 1件 → 箱の合算は alto 2 : tenor 1
    const out = backfillReedSaxTypes(reeds, [S("b1", "tenor", "2026-09-05"), S("b2", "alto", "2026-09-01"), S("b3", "alto", "2026-09-02")]);
    expect(out.map((r) => r.saxType)).toEqual(["alto", "alto", "alto"]);
  });

  it("箱の合算でも同数なら最新の計測の楽器 / 別の箱は別に決まる", () => {
    const reeds = [R("b1"), R("b2"), R("c1", "2026-08-20")];
    const out = backfillReedSaxTypes(reeds, [
      S("b1", "tenor", "2026-09-01"), S("b2", "soprano", "2026-09-09"),   // 箱 A: 1:1 → 新しい soprano
      S("c1", "baritone", "2026-09-03"),                                  // 箱 C: baritone
    ]);
    expect(out.map((r) => r.saxType)).toEqual(["soprano", "soprano", "baritone"]);
  });

  it("同じ古い鍵に楽器ありと楽器なしが混ざるときは、楽器なしの側だけで推定する(楽器ありは触らない)", () => {
    const keep = R("k1", "2026-08-01", { saxType: "tenor" });
    const reeds = [keep, R("u1"), R("u2")];
    const out = backfillReedSaxTypes(reeds, [
      S("k1", "tenor", "2026-09-01"), S("k1", "tenor", "2026-09-02"), S("k1", "tenor", "2026-09-03"),   // 楽器ありの計測は数えない
      S("u2", "soprano", "2026-09-04"),
    ]);
    expect(out[0]).toBe(keep);
    expect(out.slice(1).map((r) => r.saxType)).toEqual(["soprano", "soprano"]);
    // 楽器なしの側に計測が1件も無ければ alto(楽器ありの tenor を引き継がない)
    const out2 = backfillReedSaxTypes([keep, R("u3")], [S("k1", "tenor", "2026-09-01")]);
    expect(out2[1].saxType).toBe("alto");
  });

  it("推定のあとにもう一度通すと何も変わらない(起動のたびに走っても書き戻さない)", () => {
    const once = backfillReedSaxTypes([{ id: "r1" }], [S("r1", "tenor", "2026-09-01")]);
    expect(backfillReedSaxTypes(once, [S("r1", "alto", "2026-09-02"), S("r1", "alto", "2026-09-03")])).toBe(once);
  });

  it("読むときの既定(E3): saxType が無い・知らない値のリードは推定前でも alto として読む", () => {
    expect(reedSaxTypeOf({})).toBe("alto");
    expect(reedSaxTypeOf({ saxType: "Alto" })).toBe("alto");
    expect(reedSaxTypeOf({ saxType: "baritone" })).toBe("baritone");
  });
});

describe("箱の鍵に楽器が入る(E2)", () => {
  const base = { brand: "Vandoren", model: "Traditional", strength: "3.0", startDate: "2026-09-10" };
  it("楽器だけが違う2枚は別の箱(同じ日の Traditional 3.0 でもアルトとテナーは別)", () => {
    const reeds = [
      { ...base, id: "a", saxType: "alto", createdAt: "2026-09-10T01:00:00Z" },
      { ...base, id: "t", saxType: "tenor", createdAt: "2026-09-10T01:00:01Z" },
    ];
    expect(reedGroupKey(reeds[0])).not.toBe(reedGroupKey(reeds[1]));
    const boxes = groupReeds(reeds);
    expect(boxes).toHaveLength(2);
    expect(boxes.map((g) => g.members.map((m) => m.id))).toEqual(expect.arrayContaining([["a"], ["t"]]));
    // 銘柄の段(計測タブのリード選び)も楽器で分かれる
    expect(reedBrandGroupKey(reeds[0])).not.toBe(reedBrandGroupKey(reeds[1]));
  });
  it("楽器も同じなら同じ箱のまま(楽器を持たない記録は alto の箱に入る)", () => {
    const reeds = [
      { ...base, id: "a1", saxType: "alto", createdAt: "2026-09-10T01:00:00Z" },
      { ...base, id: "a2", createdAt: "2026-09-10T01:00:01Z" },
    ];
    expect(groupReeds(reeds)).toHaveLength(1);
  });
});

describe("計測タブの候補と、楽器を替えたときの選択(D2 / 重1)", () => {
  const base = { brand: "Vandoren", strength: "3.0", startDate: "2026-08-01" };
  const reeds = [
    { ...base, id: "a1", saxType: "alto", createdAt: "2026-08-01T01:00:01Z" },
    { ...base, id: "t1", saxType: "tenor", createdAt: "2026-08-01T01:00:02Z" },
    { ...base, id: "x1", createdAt: "2026-08-01T01:00:03Z" },
    { ...base, id: "t2", saxType: "tenor", createdAt: "2026-08-01T01:00:04Z" },
  ];
  const A = reedGroupKey(reeds[0]);   // アルトの箱
  const T = reedGroupKey(reeds[1]);   // テナーの箱
  it("候補はいま選んでいる楽器のリードだけ", () => {
    expect(reedsOfSax(reeds, "tenor").map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(reedsOfSax(reeds, "alto").map((r) => r.id)).toEqual(["a1", "x1"]);
    expect(reedsOfSax(reeds, "baritone")).toEqual([]);
  });
  it("選んでいたリードが別の楽器のものなら、リードも箱も外す", () => {
    expect(reedSelectionForSax(reeds, "a1", A, "tenor")).toEqual({ reedId: null, boxKey: null });
    expect(reedSelectionForSax(reeds, "x1", A, "soprano")).toEqual({ reedId: null, boxKey: null });
  });
  it("同じ楽器のものなら残し、箱はそのリードの箱にそろえる", () => {
    expect(reedSelectionForSax(reeds, "t1", T, "tenor")).toEqual({ reedId: "t1", boxKey: T });
    expect(reedSelectionForSax(reeds, "t1", null, "tenor")).toEqual({ reedId: "t1", boxKey: T });
    expect(reedSelectionForSax(reeds, "x1", null, "alto")).toEqual({ reedId: "x1", boxKey: A });
  });
  it("リードを選んでいないときは、別の楽器の箱だけを外す", () => {
    expect(reedSelectionForSax(reeds, null, A, "tenor")).toEqual({ reedId: null, boxKey: null });
    expect(reedSelectionForSax(reeds, null, T, "tenor")).toEqual({ reedId: null, boxKey: T });
    expect(reedSelectionForSax(reeds, null, null, "tenor")).toEqual({ reedId: null, boxKey: null });
  });
  it("一覧に見つからない id(削除されたリード)を選んでいたら、リードも箱も外す(軽3 の裁定)", () => {
    expect(reedSelectionForSax(reeds, "gone", T, "tenor")).toEqual({ reedId: null, boxKey: null });
    expect(reedSelectionForSax(reeds, "gone", null, "alto")).toEqual({ reedId: null, boxKey: null });
  });
  it("リードを選んでいないとき、一覧に無い箱はそのまま(外す理由は楽器の違いだけ)", () => {
    expect(reedSelectionForSax(reeds, null, "gone|box", "tenor")).toEqual({ reedId: null, boxKey: "gone|box" });
  });
  it("判定してよいのは、保存から読み込み済みで、楽器を持たないリードが残っていないときだけ(軽4 / 軽5)", () => {
    const known = reeds.filter((r) => r.saxType);
    expect(reedSaxInvariantReady(true, known)).toBe(true);       // 計測の読み込みは待たない(軽4)
    expect(reedSaxInvariantReady(true, reeds)).toBe(false);      // x1 がまだ推定前
    expect(reedSaxInvariantReady(false, known)).toBe(false);     // 楽器・リード・選択の読み込み前(軽5)
    expect(reedSaxInvariantReady(true, [])).toBe(true);
  });
  it("計測タブの案内(中2): 今の楽器のリードが0枚なら「T.Sax のリードはまだ登録されていません」、あれば出さない", () => {
    expect(measureReedEmptyGuide("tenor", 0)).toBe("T.Sax のリードはまだ登録されていません");
    expect(measureReedEmptyGuide("tenor", 1)).toBe(null);   // 1枚でもあれば出さない(境目)
    expect(measureReedEmptyGuide("tenor", 2)).toBe(null);
    expect(measureReedEmptyGuide("baritone", 0)).toBe("B.Sax のリードはまだ登録されていません");
  });
});

describe("ピボットの「リード(個体)」(E8 の裁定)", () => {
  const dim = PIVOT_DIMENSIONS.find((d) => d.key === "reed");
  const base = { brand: "Vandoren", model: "Traditional", strength: "3.0", startDate: "2026-09-10" };
  const a = { ...base, id: "ra", saxType: "alto", createdAt: "2026-09-10T01:00:00Z" };
  const t = { ...base, id: "rt", saxType: "tenor", createdAt: "2026-09-10T01:00:01Z" };
  const ctx = { reeds: [a, t] };
  it("楽器違いで同じリード名でも別の値(リードの id で束ねる)", () => {
    expect(dim.getValue({ reed: a }, ctx)).not.toBe(dim.getValue({ reed: t }, ctx));
  });
  it("表示は「A.Sax · 」を前に付ける(すべてのセッションの選択肢と同じ形)", () => {
    expect(pivotValueLabel(dim, dim.getValue({ reed: a }, ctx), ctx)).toBe("A.Sax · Vandoren Traditional 3.0 #1(2026/09/10)");
    expect(pivotValueLabel(dim, dim.getValue({ reed: t }, ctx), ctx)).toBe("T.Sax · Vandoren Traditional 3.0 #1(2026/09/10)");
    // 他の次元は値がそのまま表示
    const brand = PIVOT_DIMENSIONS.find((d) => d.key === "brand");
    expect(pivotValueLabel(brand, "Vandoren", ctx)).toBe("Vandoren");
  });
});

describe("推定の合流で番号を振り直す(軽5)", () => {
  it("old1/old2(楽器なし・テナーの計測)が、テナーの new1/new2 と同じ鍵になって合流 → new1,new2,old1,old2 の順で 1..4", () => {
    const b = { brand: "Vandoren", strength: "3.0", startDate: "2026-08-01" };
    const reeds = [
      { ...b, id: "old1", sortOrder: 1, createdAt: "2026-08-01T01:00:00Z" },
      { ...b, id: "old2", sortOrder: 2, createdAt: "2026-08-01T01:00:01Z" },
      { ...b, id: "new1", saxType: "tenor", sortOrder: 1, createdAt: "2026-09-01T01:00:00Z" },
      { ...b, id: "new2", saxType: "tenor", sortOrder: 2, createdAt: "2026-09-01T01:00:01Z" },
    ];
    const out = backfillReedSaxTypes(reeds, [{ reedId: "old1", saxType: "tenor", recordedAt: "2026-08-05" }]);
    const boxes = groupReeds(out);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].members.map((m) => m.id)).toEqual(["new1", "new2", "old1", "old2"]);   // 交互に入り込まない
    expect(boxes[0].members.map((m) => m.sortOrder)).toEqual([1, 2, 3, 4]);
    // 楽器は既存の2枚のまま(楽器を持つリードの楽器は触らない)
    expect(out.find((r) => r.id === "new1").saxType).toBe("tenor");
  });
  it("合流しないときは番号に触らない", () => {
    const reeds = [{ id: "o1", brand: "X", strength: "3.0", startDate: "2026-08-01", sortOrder: 5 }];
    expect(backfillReedSaxTypes(reeds, [])[0].sortOrder).toBe(5);
  });
});

// ---- 描いて押す -----------------------------------------------------------
let root; let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});
const draw = async (el) => { await act(async () => { root.render(el); }); };
const press = async (el) => { await act(async () => { el.click(); }); };

const REEDS = [
  // A.Sax の箱2つ・T.Sax の箱1つ。S.Sax と B.Sax は0枚(モック版2と同じ例)
  { id: "a1", brand: "Vandoren", model: "Traditional", strength: "3.0", startDate: "2026-09-10", saxType: "alto", createdAt: "2026-09-10T01:00:00Z" },
  { id: "a2", brand: "Vandoren", model: "Traditional", strength: "3.0", startDate: "2026-09-10", saxType: "alto", createdAt: "2026-09-10T01:00:01Z" },
  { id: "a3", brand: "Vandoren", model: "V16", strength: "3.0", startDate: "2026-08-02", saxType: "alto", createdAt: "2026-08-02T01:00:00Z" },
  { id: "t1", brand: "Vandoren", model: "Traditional", strength: "3.0", startDate: "2026-09-10", saxType: "tenor", createdAt: "2026-09-10T02:00:00Z" },
];

function Harness({ initialReeds = REEDS, saxType = "alto", subTab = "register", onReeds, onSaxType, onTopTab, onSelected }) {
  const [reeds, setReedsState] = useState(initialReeds);
  const [compareReedIds, setCompareReedIds] = useState([]);
  const [reedsSubTab, setReedsSubTab] = useState(subTab);
  const setReeds = (u) => setReedsState((prev) => { const next = typeof u === "function" ? u(prev) : u; onReeds?.(next); return next; });
  return (
    <ReedsTab
      reeds={reeds} setReeds={setReeds} sessions={[]} updateSessions={() => {}}
      setTopTab={(t) => onTopTab?.(t)} setSelectedReedId={(id) => onSelected?.(id)} selectedReedId={null}
      selectedIdeal={null} saxType={saxType} setSaxType={(t) => onSaxType?.(t)} tuningHz={442}
      compareReedIds={compareReedIds} setCompareReedIds={setCompareReedIds}
      reedsSubTab={reedsSubTab} setReedsSubTab={setReedsSubTab}
      showNotice={() => {}}
    />
  );
}
const chipRow = () => host.querySelector('[role="radiogroup"][aria-label="楽器種別"]');
const chips = () => [...chipRow().querySelectorAll('[role="radio"]')];
const chip = (label) => chips().find((c) => c.textContent === label);
const checkedChip = () => chips().find((c) => c.getAttribute("aria-checked") === "true")?.textContent;
// 登録の一覧の箱の見出し(「… のメーカーと番手を編集」のボタン)。比較の側の見出しは押せないので混ざらない。
const registerBoxes = () => [...host.querySelectorAll('button[aria-label$="のメーカーと番手を編集"]')].map((b) => b.textContent);
const tiles = () => host.querySelectorAll(".reedtile");
const compareChips = () => host.querySelectorAll('button[aria-label$="枚目を比較に入れる"]');

describe("リードタブの楽器のチップの行(D5)", () => {
  it("4つとも押せる(押せない印も disabled も無い)。最初は計測タブの楽器", async () => {
    await draw(<Harness saxType="tenor" />);
    expect(chips().map((c) => c.textContent)).toEqual(["S.Sax", "A.Sax", "T.Sax", "B.Sax"]);
    for (const c of chips()) {
      expect(c.tagName).toBe("BUTTON");
      expect(c.disabled).toBe(false);
    }
    expect(checkedChip()).toBe("T.Sax");
    // リードが無い楽器(S.Sax / B.Sax)も、ある楽器と同じ見た目(薄くしない)
    const face = (label) => chip(label).querySelector("span").style;
    expect(face("S.Sax").color).toBe(face("A.Sax").color);
    expect(face("S.Sax").border).toBe(face("A.Sax").border);
  });

  it("押した楽器の箱だけが並ぶ(箱の見出しに楽器名は足さない)", async () => {
    await draw(<Harness saxType="alto" />);
    expect(registerBoxes()).toEqual(["Vandoren Traditional 3.0", "Vandoren V16 3.0"]);
    await press(chip("T.Sax"));
    expect(checkedChip()).toBe("T.Sax");
    expect(registerBoxes()).toEqual(["Vandoren Traditional 3.0"]);
    // タイルは T.Sax の1枚だけ(登録の一覧のタイル)
    expect(tiles()).toHaveLength(1);
    expect(host.textContent).not.toContain("T.Sax のリードはまだ登録されていません");
  });

  it("リードが無い楽器は空の1行だけ。「長押しで編集」は出さない", async () => {
    await draw(<Harness saxType="alto" />);
    expect(host.textContent).toContain("長押しで編集");
    await press(chip("B.Sax"));
    expect(checkedChip()).toBe("B.Sax");
    expect(registerBoxes()).toEqual([]);
    expect(host.textContent).toContain("B.Sax のリードはまだ登録されていません");
    expect(host.textContent).not.toContain("長押しで編集");
  });

  it("登録のシートの楽器の初期値は一覧で選んでいる楽器。登録したリードにその楽器が入る", async () => {
    let lastReeds = null;
    await draw(<Harness saxType="alto" onReeds={(r) => { lastReeds = r; }} />);
    await press(chip("B.Sax"));
    await press(document.body.querySelector('button[aria-label="リードを追加"]'));
    const sheet = document.body.querySelector('[role="dialog"][aria-label="リードを追加"]');
    expect(sheet).not.toBe(null);
    const saxPills = [...sheet.querySelectorAll('button[aria-label^="楽器 "]')];
    expect(saxPills.map((b) => b.getAttribute("aria-label"))).toEqual(["楽器 S.Sax", "楽器 A.Sax", "楽器 T.Sax", "楽器 B.Sax"]);
    expect(saxPills.find((b) => b.getAttribute("aria-pressed") === "true").getAttribute("aria-label")).toBe("楽器 B.Sax");
    await press([...sheet.querySelectorAll("button")].find((b) => b.textContent === "追加"));
    const added = lastReeds.filter((r) => !REEDS.some((x) => x.id === r.id));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((r) => r.saxType === "baritone")).toBe(true);
    // 登録した楽器(B.Sax)の一覧に箱が出る
    expect(registerBoxes()).toHaveLength(1);
    // 一覧で T.Sax を選び直してから開くと、T.Sax から始まる(開くたびに一覧の選択から)
    await press(chip("T.Sax"));
    await press(document.body.querySelector('button[aria-label="リードを追加"]'));
    const sheet2 = document.body.querySelector('[role="dialog"][aria-label="リードを追加"]');
    expect([...sheet2.querySelectorAll('button[aria-label^="楽器 "]')]
      .find((b) => b.getAttribute("aria-pressed") === "true").getAttribute("aria-label")).toBe("楽器 T.Sax");
  });

  it("比較の候補も選んだ楽器のリードだけ(同じチップの行を読む)", async () => {
    await draw(<Harness saxType="alto" subTab="compare" />);
    expect(compareChips()).toHaveLength(3);          // A.Sax の3枚
    await press(chip("T.Sax"));
    expect(compareChips()).toHaveLength(1);          // T.Sax の1枚
    await press(chip("S.Sax"));
    expect(compareChips()).toHaveLength(0);
    expect(host.textContent).toContain("S.Sax のリードはまだ登録されていません");
  });
});

describe("計測にリードを付け直すシート(E6)", () => {
  const reeds = [
    { id: "a1", brand: "Vandoren", model: "V16", strength: "2.5", startDate: "2026-08-01", saxType: "alto", createdAt: "2026-08-01T01:00:00Z" },
    { id: "t1", brand: "Vandoren", model: "Java", strength: "3.0", startDate: "2026-08-02", saxType: "tenor", createdAt: "2026-08-02T01:00:00Z" },
    { id: "t2", brand: "D'Addario", model: "Select Jazz", strength: "3.0", startDate: "2026-08-03", saxType: "tenor", createdAt: "2026-08-03T01:00:00Z" },
  ];
  const drawSheet = (saxType, reedId = null) => draw(
    <SessionEditSheet
      recordedAtLocal="2026-09-01T10:00" onSetRecordedAt={() => {}}
      performers={[]} setPerformers={() => {}} performer="自分" onSetPerformer={() => {}}
      reeds={reeds} sessions={[]} reedId={reedId} onSetReedId={() => {}}
      saxType={saxType}
      onClose={() => {}}
    />,
  );
  const openPick = async () => press(document.body.querySelector('button[aria-label="紐付けるリード"]'));
  const brandRows = () => {
    const list = document.body.querySelector('[role="listbox"][aria-label="銘柄を選ぶ"]');
    return list ? [...list.querySelectorAll('[role="option"]')].map((o) => o.textContent.replace("✓", "")) : null;
  };

  it("候補はその計測の楽器のリードだけ(テナーの計測にアルトのリードは出ない)", async () => {
    await drawSheet("tenor");
    await openPick();
    expect(brandRows().slice().sort()).toEqual(["D'Addario Select Jazz 3", "Vandoren Java 3"]);
  });

  it("アルトの計測なら、アルトのリードだけ(1箱なので番号の段から)", async () => {
    await drawSheet("alto");
    await openPick();
    expect(brandRows()).toBe(null);
    expect([...document.body.querySelectorAll(".reedtile")].map((t) => t.getAttribute("aria-label"))).toEqual(["1枚目"]);
  });

  it("すでに付いている別の楽器のリードは外さない(枠の表示はそのまま)", async () => {
    await drawSheet("tenor", "a1");
    const field = document.body.querySelector('button[aria-label="紐付けるリード"]');
    expect(field.textContent).toContain("Vandoren V16 2.5");
  });
});

// ---- 【審査の差し戻し 2026-09-25】-----------------------------------------------
const sheetOf = (label) => document.body.querySelector(`[role="dialog"][aria-label="${label}"]`);
const saxPillIn = (sheet, label) => sheet.querySelector(`button[aria-label="楽器 ${label}"]`);
const pressedSaxIn = (sheet) => [...sheet.querySelectorAll('button[aria-label^="楽器 "]')]
  .find((b) => b.getAttribute("aria-pressed") === "true")?.getAttribute("aria-label");
const escape = () => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });

describe("登録と箱の編集で選んだ楽器が書かれる(中3 / 軽7 / 軽8)", () => {
  it("登録シートの楽器ピルで別の楽器を選ぶと、登録したリードにはシートで選んだ楽器が入る(一覧の楽器ではない)", async () => {
    let last = null;
    await draw(<Harness saxType="alto" onReeds={(r) => { last = r; }} />);
    await press(chip("B.Sax"));                                         // 一覧は B.Sax
    await press(document.body.querySelector('button[aria-label="リードを追加"]'));
    const sheet = sheetOf("リードを追加");
    expect(pressedSaxIn(sheet)).toBe("楽器 B.Sax");
    await press(saxPillIn(sheet, "T.Sax"));                            // シートの中で T.Sax に替える
    expect(pressedSaxIn(sheet)).toBe("楽器 T.Sax");
    await press([...sheet.querySelectorAll("button")].find((b) => b.textContent === "追加"));
    const added = last.filter((r) => !REEDS.some((x) => x.id === r.id));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((r) => r.saxType === "tenor")).toBe(true);
  });

  it("箱の編集で楽器を変えて閉じると、箱の全員の楽器が変わり(同じ鍵の箱へ合流)、一覧もその楽器へ移る", async () => {
    let last = null;
    await draw(<Harness saxType="alto" onReeds={(r) => { last = r; }} />);
    // A.Sax の Traditional 3.0(a1 / a2)の箱を開く
    const head = [...host.querySelectorAll('button[aria-label$="のメーカーと番手を編集"]')]
      .find((b) => b.textContent === "Vandoren Traditional 3.0");
    await press(head);
    const sheet = sheetOf("箱を編集");
    expect(pressedSaxIn(sheet)).toBe("楽器 A.Sax");                    // 編集はその箱の楽器から開く
    await press(saxPillIn(sheet, "T.Sax"));
    await escape();                                                     // 閉じたときに反映(便P の作法)
    expect(sheetOf("箱を編集")).toBe(null);
    expect(last.filter((r) => ["a1", "a2"].includes(r.id)).map((r) => r.saxType)).toEqual(["tenor", "tenor"]);
    // 軽7: 一覧は T.Sax へ移り、合流した箱(t1 + a1 + a2)が見えている
    expect(checkedChip()).toBe("T.Sax");
    expect(registerBoxes()).toEqual(["Vandoren Traditional 3.0"]);
    expect(tiles()).toHaveLength(3);
  });

  it("箱の編集を開いて閉じただけでは楽器を書かない(楽器を持たないリードに alto を確定させない)", async () => {
    const noSax = REEDS.map(({ saxType, ...r }) => r).filter((r) => r.id === "a3");
    let last = null;
    await draw(<Harness initialReeds={noSax} saxType="alto" onReeds={(r) => { last = r; }} />);
    await press(host.querySelector('button[aria-label$="のメーカーと番手を編集"]'));
    await escape();
    // 何も変えずに閉じた = 書き込みがあっても楽器の欄は作らない
    const after = last ?? noSax;
    expect(after.every((r) => !("saxType" in r))).toBe(true);
    expect(checkedChip()).toBe("A.Sax");                                // 一覧も動かない
  });
});

describe("楽器とリードの不変条件を App の1箇所で(重1 / useReedSaxInvariant を描いて走らせる)", () => {
  const base = { brand: "Vandoren", strength: "3.0", startDate: "2026-08-01" };
  const alto = { ...base, id: "a1", saxType: "alto", createdAt: "2026-08-01T01:00:01Z" };
  const tenor = { ...base, id: "t1", saxType: "tenor", createdAt: "2026-08-01T01:00:02Z" };
  // loaded = 楽器・リード一覧・選んでいるリードが保存から読み込み済みか(軽5)。既定は読み込み済み。
  function InvHarness({ loaded = true, reeds, saxType, reedId, boxKey, out }) {
    const [selectedReedId, setSelectedReedId] = useState(reedId);
    const [selectedBoxKey, setSelectedBoxKey] = useState(boxKey);
    useReedSaxInvariant({ persistedLoaded: loaded, reeds, saxType, selectedReedId, setSelectedReedId, selectedBoxKey, setSelectedBoxKey });
    out.reedId = selectedReedId; out.boxKey = selectedBoxKey;
    return null;
  }
  it("選んでいるリードの楽器が計測タブの楽器と違えば、リードも箱も外す", async () => {
    const out = {};
    await draw(<InvHarness reeds={[alto, tenor]} saxType="tenor" reedId="a1" boxKey={reedGroupKey(alto)} out={out} />);
    expect(out).toEqual({ reedId: null, boxKey: null });
  });
  it("あとから楽器が変わっても(箱の編集・推定)同じく外す", async () => {
    const out = {};
    await draw(<InvHarness reeds={[alto, tenor]} saxType="alto" reedId="a1" boxKey={reedGroupKey(alto)} out={out} />);
    expect(out.reedId).toBe("a1");
    const moved = { ...alto, saxType: "baritone" };                     // 箱の編集でバリトンへ
    await draw(<InvHarness reeds={[moved, tenor]} saxType="alto" reedId="a1" boxKey={reedGroupKey(alto)} out={out} />);
    expect(out).toEqual({ reedId: null, boxKey: null });
  });
  it("同じ楽器なら何も外さない", async () => {
    const out = {};
    await draw(<InvHarness reeds={[alto, tenor]} saxType="tenor" reedId="t1" boxKey={reedGroupKey(tenor)} out={out} />);
    expect(out).toEqual({ reedId: "t1", boxKey: reedGroupKey(tenor) });
  });
  for (const [label, loaded, extra] of [
    ["保存からの読み込み前(楽器がまだ初期値 alto かもしれない)", false, []],
    ["推定前(楽器なしのリードが残る)", true, [{ ...base, id: "x1" }]],
  ]) {
    it(`${label}では判定しない`, async () => {
      const out = {};
      await draw(<InvHarness loaded={loaded} reeds={[alto, tenor, ...extra]} saxType="tenor" reedId="a1" boxKey={reedGroupKey(alto)} out={out} />);
      expect(out).toEqual({ reedId: "a1", boxKey: reedGroupKey(alto) });
    });
  }
  it("全部のリードが楽器を持っていれば、計測の読み込みを待たずに判定する(軽4)", async () => {
    // 計測の読み込みの状態はこのフックの門に入っていない(渡してもいない)
    const out = {};
    await draw(<InvHarness reeds={[alto, tenor]} saxType="tenor" reedId="a1" boxKey={reedGroupKey(alto)} out={out} />);
    expect(out).toEqual({ reedId: null, boxKey: null });
  });
  it("一覧に無いリード(削除された)を選んでいたら、リードも箱も外す(軽3)", async () => {
    const out = {};
    await draw(<InvHarness reeds={[alto, tenor]} saxType="alto" reedId="deleted" boxKey={reedGroupKey(alto)} out={out} />);
    expect(out).toEqual({ reedId: null, boxKey: null });
  });
});

describe("計測の読み込みを実際に失敗させる(中3 / 懸念2)", () => {
  // IndexedDB の要求を作り物に差し替える。本物の useSessionsStore → idbGetAllSessions → openIdb を通す。
  let realIdb;
  beforeEach(() => { realIdb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"); });
  afterEach(() => {
    if (realIdb) Object.defineProperty(globalThis, "indexedDB", realIdb);
    else delete globalThis.indexedDB;
  });
  const setIdb = (v) => Object.defineProperty(globalThis, "indexedDB", { value: v, configurable: true, writable: true });
  const fakeIdb = (mode, rows = []) => ({
    open() {
      const req = {};
      setTimeout(() => {
        if (mode === "fail") { req.error = new Error("open failed"); req.onerror?.(); return; }
        req.result = {
          transaction: () => ({ objectStore: () => ({ getAll: () => {
            const r2 = {};
            setTimeout(() => {
              // 【再審査 中1】開けたあとで getAll が失敗する枝(onerror)。
              if (mode === "getAllFail") { r2.error = new Error("getAll failed"); r2.onerror?.(); return; }
              r2.result = rows; r2.onsuccess?.();
            }, 0);
            return r2;
          } }) }),
        };
        req.onsuccess?.();
      }, 0);
      return req;
    },
  });
  function StoreHarness({ initialReeds, out }) {
    const [sessions, , , , , status] = useSessionsStore();
    const [reeds, setReedsState] = useState(initialReeds);
    const setReeds = useCallback((u) => { out.writes += 1; setReedsState(u); }, [out]);
    useReedSaxBackfill(status, reeds, sessions, setReeds);
    out.status = status; out.reeds = reeds;
    return null;
  }
  // 【2026-09-25 統括】固定の 30ms だけ待つと、全件を並べて走らせたときに作り物の IndexedDB の返事が
  // 間に合わず、まれに "loading" のまま判定して落ちた(単独では通る)。out を渡したら、状態が決まるまで
  // 20ms 刻みで待つ(上限 2 秒)。渡さなければ今までどおり 1 回だけ待つ。
  const settle = async (out) => {
    for (let i = 0; i < 100; i += 1) {
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      if (!out || (out.status !== undefined && out.status !== "loading")) break;
    }
    // 状態が決まったあとに走る effect(推定の書き込み)の分をもう 1 回待つ
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  };
  const old = [{ id: "o1", brand: "Vandoren", strength: "3.0", startDate: "2026-08-01", createdAt: "2026-08-01T01:00:00Z" }];

  it("読み込みに失敗すると status は error になり、推定は走らない(何も書かない)", async () => {
    setIdb(fakeIdb("fail"));
    const out = { writes: 0 };
    await draw(<StoreHarness initialReeds={old} out={out} />);
    await settle(out);
    expect(out.status).toBe("error");
    expect(out.writes).toBe(0);
    expect(out.reeds[0].saxType).toBeUndefined();
  });
  it("開けたあとで getAll が失敗しても error になり、推定は走らない(何も書かない)", async () => {
    setIdb(fakeIdb("getAllFail", [{ id: "s1", reedId: "o1", saxType: "tenor", recordedAt: "2026-09-01", frames: [] }]));
    const out = { writes: 0 };
    await draw(<StoreHarness initialReeds={old} out={out} />);
    await settle(out);
    expect(out.status).toBe("error");
    expect(out.writes).toBe(0);
    expect(out.reeds[0].saxType).toBeUndefined();
  });
  it("IndexedDB そのものが無い環境でも error(読めなかったことを ready と取り違えない)", async () => {
    setIdb(undefined);
    const out = { writes: 0 };
    await draw(<StoreHarness initialReeds={old} out={out} />);
    await settle(out);
    expect(out.status).toBe("error");
    expect(out.writes).toBe(0);
  });
  it("読み込めたら ready になり、推定が走る(比べるための成功の枝)", async () => {
    setIdb(fakeIdb("ok", [{ id: "s1", reedId: "o1", saxType: "tenor", recordedAt: "2026-09-01", frames: [] }]));
    const out = { writes: 0 };
    await draw(<StoreHarness initialReeds={old} out={out} />);
    await settle(out);
    expect(out.status).toBe("ready");
    expect(out.writes).toBe(1);
    expect(out.reeds[0].saxType).toBe("tenor");
  });
});

describe("usePersistedState は読み込みが済んだかを返す(軽5)", () => {
  // 温まっていない鍵(キャッシュに無い)を、作り物の IndexedDB が遅れて返す。
  let realIdb;
  beforeEach(() => { realIdb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"); });
  afterEach(() => {
    if (realIdb) Object.defineProperty(globalThis, "indexedDB", realIdb);
    else delete globalThis.indexedDB;
  });
  const slowKv = (value) => ({
    open() {
      const req = {};
      setTimeout(() => {
        req.result = {
          transaction: () => ({ objectStore: () => ({ get: () => {
            const r2 = {};
            setTimeout(() => { r2.result = value; r2.onsuccess?.(); }, 10);
            return r2;
          }, put: () => {} }), oncomplete: null }),
        };
        req.onsuccess?.();
      }, 0);
      return req;
    },
  });
  function KvHarness({ k, out }) {
    const [v, , loaded] = usePersistedState(k, "alto");
    out.push({ v, loaded });
    return null;
  }
  it("読み込み前は loaded=false で初期値、読めたら loaded=true で保存値(初期値のうちに判定させない)", async () => {
    Object.defineProperty(globalThis, "indexedDB", { value: slowKv("tenor"), configurable: true, writable: true });
    const out = [];
    await draw(<KvHarness k={`test-loaded-${Date.now()}`} out={out} />);
    expect(out[0]).toEqual({ v: "alto", loaded: false });
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(out[out.length - 1]).toEqual({ v: "tenor", loaded: true });
    // 保存値が入る前に loaded だけが先に立つ描画は無い
    expect(out.some((x) => x.loaded && x.v === "alto")).toBe(false);
  });
});

// 【便AY 審査の起票A 2026-09-25】削除 →「元に戻す」で、消える前に選んでいたリードを選び直す。
describe("reedSelectionToRestore ── 元に戻すときに選び直すリード", () => {
  it("消えるリードを選んでいたら、その id を返す", () => {
    expect(reedSelectionToRestore(["a1", "a2"], "a1")).toBe("a1");
  });
  it("別のリードを選んでいた・何も選んでいなかったなら、選択に触らない(null)", () => {
    expect(reedSelectionToRestore(["a1"], "t1")).toBe(null);
    expect(reedSelectionToRestore(["a1"], null)).toBe(null);
    expect(reedSelectionToRestore(undefined, "a1")).toBe(null);
  });
});

// ------------------------------------------------------------------
// 【便AZ 2026-09-25 本人の実機報告と指示 A】リードの追加シート。
//   A1 検索欄と「＋ 新しいメーカーを入力…」が縦に重なる → 行を縮ませない(flexShrink 0)
//   A2 見出し「追加」を消す(読み上げの名前「リードを追加」は残す)
//   A3 主ボタンの縦幅を標準(--tap-min。「目安に設定」の保存と同じ)に、語は「追加」
// 【守っていないもの】jsdom は配置を計算しないので、**重ならないこと**そのものは測れない。
// ここで見ているのは「行が縮まない宣言を持つ」ことまで(Chrome 375×560 の実測は報告に書いた)。
// ------------------------------------------------------------------
describe("リードの追加シート(便AZ A)", () => {
  const openAdd = async () => {
    await draw(<Harness saxType="alto" />);
    await press(document.body.querySelector('button[aria-label="リードを追加"]'));
    return sheetOf("リードを追加");
  };
  it("A2: 見出し「追加」は無い(読み上げの名前は「リードを追加」のまま)", async () => {
    const sheet = await openAdd();
    expect(sheet).not.toBe(null);
    const titles = [...sheet.querySelectorAll("div")].filter((d) => d.children.length === 0 && d.textContent === "追加");
    expect(titles).toHaveLength(0);
  });
  it("A3: 主ボタンは「追加」、高さは --tap-min(56 の height を持たない)", async () => {
    const sheet = await openAdd();
    const btn = [...sheet.querySelectorAll("button")].find((b) => b.textContent === "追加");
    expect(btn).toBeTruthy();
    expect(btn.style.minHeight).toBe("var(--tap-min)");
    expect(btn.style.height).toBe("");
    expect([...sheet.querySelectorAll("button")].some((b) => b.textContent === "この箱を追加する")).toBe(false);
  });
  it("A1: 検索欄の行(空の検索欄と「＋ 新しいメーカーを入力…」)も、ほかの行も縮まない(flexShrink 0)", async () => {
    const sheet = await openAdd();
    await press(sheet.querySelector('button[aria-label="リードの選択を解除"]'));   // 空の検索欄の姿にする
    const input = sheet.querySelector('input[aria-label="リードを検索"]');
    expect(input).not.toBe(null);
    const row = input.parentElement;
    expect([...row.querySelectorAll("button")].some((b) => b.textContent.includes("新しいメーカーを入力"))).toBe(true);
    expect(row.style.flexShrink).toBe("0");
    // 検索欄と逃げ道の一手の間は、写し元のプロフィールの GearPicker(Field)と同じ --sp-1(隙間 0 で接しない)
    expect(row.style.gap).toBe("var(--sp-1)");
    // 楽器・厚さ・枚数の行も同じ枠(縮むとピルが次の行へはみ出す)
    for (const label of ["楽器", "厚さ", "枚数"]) {
      const lab = [...sheet.querySelectorAll("span")].find((sp) => sp.textContent === label);
      expect(lab, label).toBeTruthy();
      expect(lab.parentElement.style.flexShrink, label).toBe("0");
    }
  });
});
