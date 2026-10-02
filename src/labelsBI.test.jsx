// @vitest-environment jsdom
import React, { act, useState } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BI 2026-10-02 本人指示】選択肢の逃げ道の文字を「その他」にそろえる。**実際に描いて押す**。
//   3 プロフィール編集のカタログの選択肢: 「カタログに無い(その他)」→「その他」。
//     楽器・マウスピース・リガチャー・リードの4欄が同じ GearPicker を読むので4つそろって変わる。
//     押したときに入る値(メーカー名「その他」)は変えていない。
//   4 リードタブの追加シートの「＋ 新しいメーカーを入力」→「その他」。
//     押したときの動き(メーカーを手で入力できる。打った名前がメーカーになる)は変えていない。
// 期待値はここに手で書いた文(画面の定数から読まない)。
// 【守っていないもの】ボタンの見た目の寸法(綴りは pitch-test が見る)。
// ------------------------------------------------------------------
const { ProfileForm } = await import("./community/CommunityTab.jsx");
const { ReedsTab } = await import("./App.jsx");

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
const buttons = () => [...document.body.querySelectorAll("button")];

describe("3 プロフィール編集: カタログの選択肢の逃げ道は「その他」", () => {
  const PROFILE = {
    nickname: "てすと", icon: "ic-cat", iconColor: 2,
    saxTypes: ["alto"], gear: { alto: {} }, position: "社会人", startYear: 2015,
    genres: ["ジャズ"], ensembles: ["ソロ"], isPublic: true,
  };

  it("楽器・マウスピース・リガチャー・リードの4欄すべてに「その他」の一手があり、「カタログに無い」の語はどこにも無い", async () => {
    await draw(<ProfileForm initial={PROFILE} onSubmit={() => {}} onCancel={() => {}} />);
    // 4欄の検索欄(楽器の種別ごと)。欄ごとに「その他」が1つ(ジャンルなどのピルにも「その他」があるので欄の中で数える)
    for (const w of ["楽器", "マウスピース", "リガチャー", "リード"]) {
      const input = document.body.querySelector(`input[aria-label="A.Saxの${w}を検索"]`);
      expect(input, w).not.toBe(null);
      expect([...input.parentElement.querySelectorAll("button")].filter((b) => b.textContent === "その他"), w).toHaveLength(1);
    }
    expect(document.body.textContent).not.toContain("カタログに無い");
  });

  it("「その他」を押すと、その欄の値が「その他」になる(押したときに入る値は変えていない)", async () => {
    await draw(<ProfileForm initial={PROFILE} onSubmit={() => {}} onCancel={() => {}} />);
    const input = document.body.querySelector('input[aria-label="A.Saxのマウスピースを検索"]');
    const field = input.parentElement;
    const other = [...field.querySelectorAll("button")].find((b) => b.textContent === "その他");
    expect(other).toBeTruthy();
    await press(other);
    // 選んだ姿(値のピル + 解除の ✕)。値は OTHER_BRAND = 「その他」
    const clear = document.body.querySelector('button[aria-label="A.Saxのマウスピースの選択を解除"]');
    expect(clear).not.toBe(null);
    expect(clear.parentElement.textContent).toBe("その他✕");
    expect(document.body.querySelector('input[aria-label="A.Saxのマウスピースを検索"]')).toBe(null);
    // 残りの3欄の「その他」はそのまま
    for (const w of ["楽器", "リガチャー", "リード"]) {
      const rest = document.body.querySelector(`input[aria-label="A.Saxの${w}を検索"]`);
      expect([...rest.parentElement.querySelectorAll("button")].filter((b) => b.textContent === "その他"), w).toHaveLength(1);
    }
  });
});

describe("4 リードタブの追加シート: 逃げ道の一手は「その他」、押すとメーカーを手で入力できる", () => {
  function Harness({ onReeds }) {
    const [reeds, setReedsState] = useState([]);
    const [compareReedIds, setCompareReedIds] = useState([]);
    const [reedsSubTab, setReedsSubTab] = useState("register");
    const setReeds = (u) => setReedsState((prev) => { const next = typeof u === "function" ? u(prev) : u; onReeds?.(next); return next; });
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
  const sheet = () => document.body.querySelector('[role="dialog"][aria-label="リードを追加"]');
  const openAdd = async (onReeds) => {
    await draw(<Harness onReeds={onReeds} />);
    await press(document.body.querySelector('button[aria-label="リードを追加"]'));
    const clear = sheet().querySelector('button[aria-label="リードの選択を解除"]');
    if (clear) await press(clear);   // 空の検索欄の姿にする
  };

  it("検索欄の行に「その他」があり、「新しいメーカーを入力」の語はシートのどこにも無い", async () => {
    await openAdd();
    const input = sheet().querySelector('input[aria-label="リードを検索"]');
    expect(input).not.toBe(null);
    const other = [...input.parentElement.querySelectorAll("button")].filter((b) => b.textContent === "その他");
    expect(other).toHaveLength(1);
    expect(sheet().textContent).not.toContain("新しいメーカーを入力");
    expect(sheet().textContent).not.toContain("＋");
  });

  it("「その他」を押すとメーカーの名前を打つ欄が出て、打った名前のメーカーで追加される(動きは便BI の前のまま)", async () => {
    let last = null;
    await openAdd((r) => { last = r; });
    const other = [...sheet().querySelectorAll("button")].find((b) => b.textContent === "その他");
    await press(other);
    const typed = sheet().querySelector('input[aria-label="新しいメーカー名"]');
    expect(typed).not.toBe(null);
    expect(typed.getAttribute("placeholder")).toBe("新しいメーカー名を入力");
    // React の制御された入力へ値を入れる
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(typed, "Gonzalez");
      typed.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press([...sheet().querySelectorAll("button")].find((b) => b.textContent === "追加"));
    expect(last).not.toBe(null);
    expect(last.length).toBeGreaterThan(0);
    expect(last.every((r) => r.brand === "Gonzalez")).toBe(true);
  });
});
