// @vitest-environment jsdom
import React, { act, useState } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { ReedsTab, reedAddDefaults } from "./App.jsx";

// ------------------------------------------------------------------
// 【便BR 2026-10-03 本人指示】「リード登録画面で、一番最初はリード銘柄を書かないでください。
//  いまはバンドレンのトラディショナルが入っています。1個目の登録が終わったあとは、すでに登録されている
//  リードをデフォルトで入れるようにして」。
//
// 期待値は統括の仕様の文から直接書く(実装の定数から逆算しない。番手の既定 "3.0" も文字で書く):
//   1. 一覧で選んでいる楽器のリードがあれば、その楽器で最後に登録した箱のメーカー・品名・番手
//   2. その楽器に無ければ、どの楽器でもよいので最後に登録した箱の値
//   3. 1枚も無ければメーカーと品名は空(未選択)・番手は今の既定(3.0)
//   「最後に登録した」は createdAt の最新、無ければ startDate。
//   「その他」(自由入力)で登録したメーカーは、その文字のまま自由入力の欄へ。
//   メーカーと品名が決まるまで「追加」は押せない。開き直すたびに当て直す。編集(mode="edit")は変えない。
//
// 【守っているもの】ReedsTab を描いて＋を押し、開いたシートの見た目の値(選ばれた銘柄の行・厚さのピル・
//   自由入力の欄)と「追加」の押せる/押せないを読む。押したときに保存されるリードの値も読む。
// 【守っていないもの】
//   ・dev サーバ / 実機での見た目(br_shots の撮影で1枚見ただけ。寸法は測っていない)。
//   ・同じ時刻のリードの選び方(配列の後ろを取る)は仕様の外の決め事。下の純関数の検査が1件見るだけ。
// ------------------------------------------------------------------

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
const typeInto = async (input, text) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
};
const escape = async () => { await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); }); };

function Harness({ initialReeds, saxType = "alto", onReeds }) {
  const [reeds, setReedsState] = useState(initialReeds);
  const [compareReedIds, setCompareReedIds] = useState([]);
  const [reedsSubTab, setReedsSubTab] = useState("register");
  const setReeds = (u) => setReedsState((prev) => { const next = typeof u === "function" ? u(prev) : u; onReeds?.(next); return next; });
  return (
    <ReedsTab
      reeds={reeds} setReeds={setReeds} sessions={[]} updateSessions={() => {}}
      setTopTab={() => {}} setSelectedReedId={() => {}} selectedReedId={null}
      selectedIdeal={null} saxType={saxType} setSaxType={() => {}} tuningHz={442}
      compareReedIds={compareReedIds} setCompareReedIds={setCompareReedIds}
      reedsSubTab={reedsSubTab} setReedsSubTab={setReedsSubTab}
      showNotice={() => {}}
    />
  );
}

const sheet = () => document.body.querySelector('[role="dialog"][aria-label="リードを追加"]');
const openAdd = async () => {
  await press(document.body.querySelector('button[aria-label="リードを追加"]'));
  expect(sheet()).not.toBe(null);
};
const chip = (label) => [...host.querySelectorAll('[role="radiogroup"][aria-label="楽器種別"] [role="radio"]')].find((c) => c.textContent === label);
// 選ばれている銘柄の行の値(✕ の左の太字)。未選択なら null。
const pickedReed = () => {
  const clear = sheet().querySelector('button[aria-label="リードの選択を解除"]');
  if (!clear) return null;
  const custom = sheet().querySelector('input[aria-label="新しいメーカー名"]');
  return custom ? { custom: custom.value } : clear.previousElementSibling.textContent;
};
const searchInput = () => sheet().querySelector('input[aria-label="リードを検索"]');
const pressedStrength = () => [...sheet().querySelectorAll('button[aria-label^="厚さ "]')]
  .filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("aria-label"));
const addButton = () => [...sheet().querySelectorAll("button")].find((b) => b.textContent === "追加");
const pickFromSearch = async (query, label) => {
  await typeInto(searchInput(), query);
  await press([...sheet().querySelectorAll("button")].find((b) => b.textContent === label));
};

// A.Sax の箱2つ・T.Sax の箱1つ。**配列の並びと登録の新しさをわざと逆にしてある**
// (A.Sax の配列の最後は古い V16、登録が新しいのは Select Jazz。全体で一番新しいのは T.Sax の Marca)。
const R = (id, brand, model, strength, saxType, startDate, createdAt) => ({ id, brand, model, strength, saxType, startDate, createdAt });
const MIXED = [
  R("a-new1", "D'Addario", "Select Jazz", "3.5", "alto", "2025-06-01", "2025-06-01T01:00:00Z"),
  R("a-new2", "D'Addario", "Select Jazz", "3.5", "alto", "2025-06-01", "2025-06-01T01:00:01Z"),
  R("t-newest", "Marca", "Jazz", "2.75", "tenor", "2025-07-01", "2025-07-01T01:00:00Z"),
  R("a-old", "Vandoren", "V16", "2.5", "alto", "2025-05-01", "2025-05-01T01:00:00Z"),
];

describe("便BR 登録のシートの初期値(規則 1・2・3)", () => {
  it("規則1: 一覧で選んでいる楽器のリードがあれば、その楽器で最後に登録した箱の値(配列の並びではなく createdAt)", async () => {
    let last = null;
    await draw(<Harness initialReeds={MIXED} saxType="alto" onReeds={(r) => { last = r; }} />);
    await openAdd();
    expect(pickedReed()).toBe("D'Addario Select Jazz");
    expect(pressedStrength()).toEqual(["厚さ 3.5"]);
    expect(addButton().disabled).toBe(false);
    // 押すとその値のまま登録される(見えている値 = 保存される値)
    await press(addButton());
    const added = last.filter((r) => !MIXED.some((x) => x.id === r.id));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((r) => r.brand === "D'Addario" && r.model === "Select Jazz" && r.strength === "3.5" && r.saxType === "alto")).toBe(true);
  });

  it("規則2: その楽器に1枚も無ければ、どの楽器でもよいので最後に登録した箱の値", async () => {
    await draw(<Harness initialReeds={MIXED} saxType="alto" />);
    await press(chip("S.Sax"));
    await openAdd();
    expect(pickedReed()).toBe("Marca Jazz");
    expect(pressedStrength()).toEqual(["厚さ 2.75"]);
    expect(addButton().disabled).toBe(false);
  });

  it("規則3: リードが1枚も無ければ、メーカーと品名は空(検索欄だけ)・番手は 3.0・「追加」は押せない", async () => {
    let calls = 0;
    await draw(<Harness initialReeds={[]} saxType="alto" onReeds={() => { calls++; }} />);
    await openAdd();
    expect(pickedReed()).toBe(null);
    expect(searchInput()).not.toBe(null);
    expect(searchInput().value).toBe("");
    // 以前の既定(バンドレンのトラディショナル)はシートのどこにも書かれていない
    expect(sheet().textContent).not.toContain("Vandoren");
    expect(sheet().textContent).not.toContain("Traditional");
    expect(pressedStrength()).toEqual(["厚さ 3.0"]);
    expect(addButton().disabled).toBe(true);
    await press(addButton());
    expect(calls).toBe(0);
    expect(sheet()).not.toBe(null);
  });

  it("createdAt が無いリードは startDate で新しさを決める", async () => {
    const reeds = [
      { id: "x1", brand: "Vandoren", model: "Java", strength: "3.0", saxType: "alto", startDate: "2025-09-05" },
      { id: "x2", brand: "Légère", model: "Classic", strength: "2.25", saxType: "alto", startDate: "2025-08-05" },
    ];
    await draw(<Harness initialReeds={reeds} saxType="alto" />);
    await openAdd();
    expect(pickedReed()).toBe("Vandoren Java");
    expect(pressedStrength()).toEqual(["厚さ 3.0"]);
  });

  it("「その他」で登録していたメーカーは、その文字のまま自由入力の欄に入る。押すとその名前で登録される", async () => {
    let last = null;
    const reeds = [
      R("v1", "Vandoren", "V16", "3.0", "alto", "2025-05-01", "2025-05-01T01:00:00Z"),
      R("g1", "Ishimori", null, "3.25", "alto", "2025-06-01", "2025-06-01T01:00:00Z"),
    ];
    // Ishimori はカタログ(REED_CATALOG)に無いメーカー(あれば自由入力ではなく銘柄の行に出る)。
    await draw(<Harness initialReeds={reeds} saxType="alto" onReeds={(r) => { last = r; }} />);
    await openAdd();
    expect(pickedReed()).toEqual({ custom: "Ishimori" });
    expect(searchInput()).toBe(null);
    expect(pressedStrength()).toEqual(["厚さ 3.25"]);
    expect(addButton().disabled).toBe(false);
    await press(addButton());
    const added = last.filter((r) => !reeds.some((x) => x.id === r.id));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((r) => r.brand === "Ishimori" && r.model === null && r.strength === "3.25")).toBe(true);
  });
});

describe("便BR メーカーと品名が決まるまで「追加」は押せない", () => {
  it("空 → 押せない / 検索で選ぶ → 押せる / ✕ で外す → 押せない / その他で空・空白だけ → 押せない / 名前を打つ → 押せる", async () => {
    let calls = 0;
    await draw(<Harness initialReeds={[]} saxType="alto" onReeds={() => { calls++; }} />);
    await openAdd();
    expect(addButton().disabled).toBe(true);
    await pickFromSearch("Select Jazz", "D'Addario Select Jazz");
    expect(pickedReed()).toBe("D'Addario Select Jazz");
    expect(addButton().disabled).toBe(false);
    await press(sheet().querySelector('button[aria-label="リードの選択を解除"]'));
    expect(pickedReed()).toBe(null);
    expect(addButton().disabled).toBe(true);
    await press([...sheet().querySelectorAll("button")].find((b) => b.textContent === "その他"));
    expect(pickedReed()).toEqual({ custom: "" });
    expect(addButton().disabled).toBe(true);
    await typeInto(sheet().querySelector('input[aria-label="新しいメーカー名"]'), "   ");
    expect(addButton().disabled).toBe(true);
    await press(addButton());
    expect(calls).toBe(0);
    await typeInto(sheet().querySelector('input[aria-label="新しいメーカー名"]'), "Ishimori");
    expect(addButton().disabled).toBe(false);
  });
});

describe("便BR 開き直すたびに当て直す(前回の入力を引きずらない)", () => {
  it("変えて閉じても、開き直すと規則どおりの値に戻る", async () => {
    await draw(<Harness initialReeds={MIXED} saxType="alto" />);
    await openAdd();
    await press(sheet().querySelector('button[aria-label="リードの選択を解除"]'));
    await press(sheet().querySelector('button[aria-label="厚さ 4.0"]'));
    expect(pickedReed()).toBe(null);
    expect(pressedStrength()).toEqual(["厚さ 4.0"]);
    await escape();
    expect(sheet()).toBe(null);
    await openAdd();
    expect(pickedReed()).toBe("D'Addario Select Jazz");
    expect(pressedStrength()).toEqual(["厚さ 3.5"]);
  });

  it("リード0枚で「その他」に打って閉じても、開き直すと空に戻る", async () => {
    await draw(<Harness initialReeds={[]} saxType="alto" />);
    await openAdd();
    await press([...sheet().querySelectorAll("button")].find((b) => b.textContent === "その他"));
    await typeInto(sheet().querySelector('input[aria-label="新しいメーカー名"]'), "Ishimori");
    await press(sheet().querySelector('button[aria-label="厚さ 2.0"]'));
    await escape();
    await openAdd();
    expect(pickedReed()).toBe(null);
    expect(searchInput()).not.toBe(null);
    expect(pressedStrength()).toEqual(["厚さ 3.0"]);
    expect(addButton().disabled).toBe(true);
    // 前回打った名前は自由入力の欄にも残っていない
    await press([...sheet().querySelectorAll("button")].find((b) => b.textContent === "その他"));
    expect(pickedReed()).toEqual({ custom: "" });
  });

  it("1箱目を登録したあとに開くと、いま登録した箱の値が入る。楽器を替えて開けば、その楽器の規則で決め直す", async () => {
    await draw(<Harness initialReeds={[]} saxType="alto" />);
    await openAdd();
    await pickFromSearch("Juno", "Vandoren Juno");
    await press(sheet().querySelector('button[aria-label="厚さ 2.0"]'));
    await press(addButton());
    expect(sheet()).toBe(null);
    await openAdd();
    expect(pickedReed()).toBe("Vandoren Juno");
    expect(pressedStrength()).toEqual(["厚さ 2.0"]);
    // T.Sax で 2箱目(Marca Jazz 2.75)を登録
    await escape();
    await press(chip("T.Sax"));
    await openAdd();
    expect(pickedReed()).toBe("Vandoren Juno");          // T.Sax に無いので規則2(全体で最後)
    await press(sheet().querySelector('button[aria-label="リードの選択を解除"]'));
    await pickFromSearch("Marca", "Marca Jazz");
    await press(sheet().querySelector('button[aria-label="厚さ 2.75"]'));
    await press(addButton());
    // A.Sax に戻して開くと、全体で最後(Marca)ではなく A.Sax の最後(Juno)
    await press(chip("A.Sax"));
    await openAdd();
    expect(pickedReed()).toBe("Vandoren Juno");
    expect(pressedStrength()).toEqual(["厚さ 2.0"]);
    await escape();
    await press(chip("T.Sax"));
    await openAdd();
    expect(pickedReed()).toBe("Marca Jazz");
    expect(pressedStrength()).toEqual(["厚さ 2.75"]);
  });
});

describe("便BR 編集(mode=\"edit\")は変えない", () => {
  it("古い箱を編集で開くと、その箱の値(最後に登録した箱の値ではない)", async () => {
    await draw(<Harness initialReeds={MIXED} saxType="alto" />);
    await press(host.querySelector('button[aria-label="Vandoren 2.5 のメーカーと番手を編集"]'));
    const edit = document.body.querySelector('[role="dialog"][aria-label="箱を編集"]');
    expect(edit).not.toBe(null);
    const clear = edit.querySelector('button[aria-label="リードの選択を解除"]');
    expect(clear.previousElementSibling.textContent).toBe("Vandoren V16");
    expect([...edit.querySelectorAll('button[aria-label^="厚さ "]')].filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.getAttribute("aria-label"))).toEqual(["厚さ 2.5"]);
  });
});

describe("便BR reedAddDefaults(純関数)── 画面から読みにくい端の決め事", () => {
  it("リードが無い(null / 空配列)なら空・番手は 3.0", () => {
    expect(reedAddDefaults([], "alto")).toEqual({ brand: null, model: null, customBrand: "", strength: "3.0" });
    expect(reedAddDefaults(null, "alto")).toEqual({ brand: null, model: null, customBrand: "", strength: "3.0" });
  });
  it("同じ時刻なら配列の後ろ(後から足された)を取る", () => {
    const t = "2025-06-01T01:00:00Z";
    const out = reedAddDefaults([R("p", "Vandoren", "V16", "3.0", "alto", "2025-06-01", t), R("q", "Marca", "Jazz", "2.5", "alto", "2025-06-01", t)], "alto");
    expect(out.brand).toBe("Marca");
  });
  it("カタログに無い銘柄は入れない(保存のときと同じ通し方)。番手が選択肢に無い古い値なら 3.0", () => {
    const out = reedAddDefaults([R("p", "Vandoren", "Blue Box", "3", "alto", "2025-06-01", "2025-06-01T01:00:00Z")], "alto");
    expect(out).toEqual({ brand: "Vandoren", model: null, customBrand: "", strength: "3.0" });
  });
});
