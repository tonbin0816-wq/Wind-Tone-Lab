// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { RankScreen, SegmentedTabs } from "./screens.jsx";
import { ProfileView } from "./CommunityTab.jsx";

// ------------------------------------------------------------------
// 【便AT 2026-09-24 本人指示】
//   1・3「タブ切り替えを4枚目(『打撃成績 | 投手成績』)のデザインと同じに」── 溝型 SegmentedTabs。
//        【便AU で訂正】溝型にするのは人物紹介の「データ | プロフィール」。楽器の行(人物紹介・マイページ)は
//        前のチップに戻し、登録していない楽器も並ぶが押せない。押した楽器の中身に切り替わる。
//   2  「練習日数と練習時間の切り替えをこのタブ切り替えに。期間は上部の楽器ジャンル属性と同じように
//        4つ横並びにして一番右側に加えて」
// 実際に描いて押す(jsdom)。綴りは見ない。
// ------------------------------------------------------------------
let root; let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const draw = async (el) => { await act(async () => { root.render(el); }); };
const group = (label) => host.querySelector(`[role="radiogroup"][aria-label="${label}"]`);
const radios = (g) => [...g.querySelectorAll('[role="radio"]')];
const checkedLabel = (g) => radios(g).find((r) => r.getAttribute("aria-checked") === "true")?.textContent;

describe("SegmentedTabs ── 溝型の切り替え", () => {
  it("選べない項目は並ぶが押せない(<button> にも radio にもしない)。選んでいる面は白", async () => {
    let picked = null;
    await draw(<SegmentedTabs ariaLabel="t" value="b" onChange={(k) => { picked = k; }}
      items={[{ key: "a", label: "A", disabled: true }, { key: "b", label: "B" }, { key: "c", label: "C" }]} />);
    const g = group("t");
    expect(g.textContent).toBe("ABC");                       // 3つとも並ぶ
    expect(radios(g).map((r) => r.textContent)).toEqual(["B", "C"]); // 押せるのは2つ
    expect(g.querySelectorAll("button")).toHaveLength(2);
    expect(checkedLabel(g)).toBe("B");
    const face = (label) => [...g.querySelectorAll("span")].find((s) => s.textContent === label && s.children.length === 0);
    expect(face("B").style.background).toBe("var(--c-surface)");
    expect(face("C").style.background).toBe("transparent");
    expect(face("A").style.color).toBe("var(--c-line-strong)");
    await act(async () => { radios(g)[1].click(); });
    expect(picked).toBe("c");
  });
});

// ---- 順位 ------------------------------------------------------------------
const NOW = new Date();
const stats = (o) => ({
  daysThisWeek: 0, daysThisMonth: 0, daysThisYear: 0, daysAll: 0,
  secThisWeek: 0, secThisMonth: 0, secThisYear: 0, secAll: 0, computedAt: NOW.toISOString(), ...o,
});
const USERS = [
  { uid: "a", nickname: "あか", icon: "ic-cat", iconColor: 1, saxTypes: ["alto"], genres: [], position: "学生", startYear: 2015,
    stats: stats({ daysAll: 10, daysThisYear: 10, daysThisMonth: 3, secAll: 3600 }) },
  { uid: "b", nickname: "あお", icon: "ic-dog", iconColor: 2, saxTypes: ["alto"], genres: [], position: "社会人", startYear: 2010,
    stats: stats({ daysAll: 5, daysThisYear: 5, daysThisMonth: 5, daysThisWeek: 2, secAll: 7200, secThisWeek: 1800 }) },
];
const namesInOrder = () => ["あか", "あお"]
  .map((n) => ({ n, at: host.textContent.indexOf(n) })).filter((x) => x.at >= 0)
  .sort((x, y) => x.at - y.at).map((x) => x.n);

describe("順位 ── 種類は溝型、期間は条件行の4つ目", () => {
  it("条件行は 楽器・ジャンル・属性・期間 の4つ。期間の既定は「すべて」で、ピルは項目名「期間」", async () => {
    await draw(<RankScreen users={USERS} myUid={null} onOpenPerson={() => {}} />);
    const selects = [...host.querySelectorAll("select")];
    expect(selects.map((s) => s.getAttribute("aria-label"))).toEqual(
      ["楽器で絞り込む", "ジャンルで絞り込む", "属性で絞り込む", "期間で絞り込む"]);
    const period = selects[3];
    expect([...period.options].map((o) => o.textContent)).toEqual(["期間(すべて)", "今週", "今月", "今年"]);
    // 期間のチップの行は無い
    expect(group("期間")).toBe(null);
    expect(namesInOrder()).toEqual(["あか", "あお"]); // すべての期間: 10日 > 5日
  });

  it("期間のピルで今週を選ぶと、今週の日数で並ぶ(今週0日の人は消える)", async () => {
    await draw(<RankScreen users={USERS} myUid={null} onOpenPerson={() => {}} />);
    const period = host.querySelectorAll("select")[3];
    await act(async () => {
      period.value = "week";
      period.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(namesInOrder()).toEqual(["あお"]);
    // ピルの見た目は選んだ期間に替わる
    expect(period.parentElement.textContent).toContain("今週");
  });

  it("練習日数 | 練習時間 は溝型。練習時間を押すと秒で並び替わる", async () => {
    await draw(<RankScreen users={USERS} myUid={null} onOpenPerson={() => {}} />);
    const g = group("順位の種類");
    expect(radios(g).map((r) => r.textContent)).toEqual(["練習日数", "練習時間"]);
    expect(checkedLabel(g)).toBe("練習日数");
    await act(async () => { radios(g)[1].click(); });
    expect(checkedLabel(group("順位の種類"))).toBe("練習時間");
    expect(namesInOrder()).toEqual(["あお", "あか"]); // 7200秒 > 3600秒
  });
});

// ---- マイページ ----------------------------------------------------------------
const GEAR = (inst, mp) => ({ instrumentBrand: inst[0], instrumentModel: inst[1], mpBrand: mp[0], mpModel: mp[1],
  ligBrand: "Rovner", ligModel: "Dark", reedBrand: "Vandoren", reedModel: "Java", reedStrength: "2.5" });
const PROFILE = {
  nickname: "てすと", icon: "ic-cat", iconColor: 2, position: "社会人", startYear: 2015,
  saxTypes: ["tenor", "alto"],     // 保存の並びに依らず S→A→T→B の順で扱う
  gear: { alto: GEAR(["YAMAHA", "YAS-875"], ["Selmer", "S90 180"]), tenor: GEAR(["Selmer", "Supreme"], ["Otto Link", "Tone Edge 7"]) },
  genres: ["ジャズ"], ensembles: ["ソロ"], isPublic: true,
};

// ---- 人物紹介 ---------------------------------------------------------------
// 【便AU 2026-09-24 本人指示】「人物のページのタブはデータとプロフィールを新しいタブ形式にして欲しかった。
// 楽器の形式は前のやつに戻して。プロフィールのページも。前のやつの該当の楽器をタップしたらその楽器のデータに」
const doc$ = (sel) => document.querySelector(sel);
const docGroup = (label) => doc$(`[role="radiogroup"][aria-label="${label}"]`);
const PERSON = {
  uid: "p1", nickname: "しろねこ", icon: "ic-cat", iconColor: 2, photo: null,
  saxTypes: ["alto", "tenor"], position: "学生", genres: [], ensembles: [], stats: { daysAll: 3 },
  gear: { alto: GEAR_P(["YAMAHA", "YAS-62"]), tenor: GEAR_P(["Selmer", "Reference 54"]) },
};
function GEAR_P(inst) {
  return { instrumentBrand: inst[0], instrumentModel: inst[1], mpBrand: "Selmer", mpModel: "S80 C*",
    ligBrand: "Rovner", ligModel: "Dark", reedBrand: "Vandoren", reedModel: "Traditional", reedStrength: "3.0" };
}
const { PersonSheet } = await import("./screens.jsx");

describe("人物紹介 ── データ | プロフィール は溝型、楽器はチップ", () => {
  const open = () => draw(<PersonSheet person={PERSON} ideals={[]} myIdeals={{}} onClose={() => {}}
    onAdopt={() => ({})} myUid="me" tuningHz={442} />);

  it("データ | プロフィール は溝型(地 --c-sunken)。押すとプロフィールに切り替わる", async () => {
    await open();
    const tabs = docGroup("表示する内容");
    expect(tabs.style.background).toBe("var(--c-sunken)");
    expect(checkedLabel(tabs)).toBe("データ");
    await act(async () => { radios(tabs)[1].click(); });
    expect(checkedLabel(docGroup("表示する内容"))).toBe("プロフィール");
    expect(document.body.textContent).toContain("YAMAHA YAS-62");     // プロフィール側の楽器の組
  });

  it("楽器の行は溝型ではなく前のチップ。吹かない楽器は押せず、T.Sax を押すと T.Sax の組になる", async () => {
    await open();
    await act(async () => { radios(docGroup("表示する内容"))[1].click(); });
    const row = docGroup("楽器種別");
    expect(row.style.background).toBe("");                  // 溝(--c-sunken)ではない
    expect(row.textContent).toBe("S.SaxA.SaxT.SaxB.Sax");
    expect(radios(row).map((r) => r.textContent)).toEqual(["A.Sax", "T.Sax"]);
    // チップの選択中は枠と字が紺(前の形)
    const pill = (r) => r.querySelector("span");
    expect(pill(radios(row)[0]).style.border).toContain("var(--c-accent)");
    await act(async () => { radios(row)[1].click(); });
    expect(checkedLabel(docGroup("楽器種別"))).toBe("T.Sax");
    expect(document.body.textContent).toContain("Selmer Reference 54");
    expect(document.body.textContent).not.toContain("YAS-62");
  });
});

// 【便AV 2026-09-24 本人指示】
//  「楽器の組というテキストは削除」「個人ページではアイコンと名前だけに」
//  「リード行の下線とその下の横線は削除」「この人を通報ボタンをタブ切り替えの横幅と同じに」
describe("人物紹介 ── 見出し・名前の行・下線・通報ボタン(便AV)", () => {
  const open = () => draw(<PersonSheet person={{ ...PERSON, startYear: 2020, genres: ["ジャズ"] }} ideals={[]} myIdeals={{}}
    onClose={() => {}} onAdopt={() => ({})} myUid="me" tuningHz={442} />);
  const toProfile = async () => { await act(async () => { radios(docGroup("表示する内容"))[1].click(); }); };
  const dialog = () => document.querySelector('[role="dialog"]') ?? document.body;

  it("名前の行はアイコンと名前だけ(属性・歴・ジャンルはデータのタブに出ない)", async () => {
    await open();
    const text = dialog().textContent;
    expect(text).toContain("しろねこ");
    expect(text).not.toContain("学生");
    expect(text).not.toMatch(/歴\d+年/);
    expect(text).not.toContain("ジャズ");
  });

  it("プロフィールのタブ: 「楽器の組」の文字が無く、リードの行だけ下線が無い", async () => {
    await open();
    await toProfile();
    expect(dialog().textContent).not.toContain("楽器の組");
    const rowOf = (label) => [...dialog().querySelectorAll("div")].find((d) => d.firstChild?.textContent === label && d.children.length === 2);
    // (jsdom は border-bottom の「none」を style から落とすので、「1px の下線が在るか」で比べる)
    expect(rowOf("リード").getAttribute("style")).not.toMatch(/border-bottom: 1px/);
    expect(rowOf("楽器").getAttribute("style")).toMatch(/border-bottom: 1px solid/);
  });

  it("「この人を通報」は横幅いっぱい(タブと同じ幅)で、上に区切りの線が無い", async () => {
    await open();
    await toProfile();
    const btn = [...dialog().querySelectorAll("button")].find((b) => b.textContent === "この人を通報");
    expect(btn).toBeTruthy();
    expect(btn.style.width).toBe("100%");
    expect(btn.parentElement.style.borderTop).toBe("");
  });
});

describe("マイページ ── 楽器の組は楽器の切り替えで1組ずつ", () => {
  it("楽器の行は溝型ではなく前のチップ(人物紹介と同じ部品)", async () => {
    await draw(<ProfileView profile={PROFILE} uid="u1" />);
    const g = group("楽器種別");
    expect(g.style.background).toBe("");
    expect(radios(g)[0].querySelector("span").style.border).toContain("var(--c-accent)");
  });

  it("4つの楽器が並び、登録していない S.Sax / B.Sax は押せない。最初は登録している最初の楽器(A.Sax)", async () => {
    await draw(<ProfileView profile={PROFILE} uid="u1" />);
    const g = group("楽器種別");
    expect(g.textContent).toBe("S.SaxA.SaxT.SaxB.Sax");
    expect(radios(g).map((r) => r.textContent)).toEqual(["A.Sax", "T.Sax"]);
    expect(checkedLabel(g)).toBe("A.Sax");
    expect(host.textContent).toContain("YAMAHA YAS-875");
    expect(host.textContent).not.toContain("Supreme");     // 他の楽器の組は出さない
  });

  it("T.Sax を押すと、4行が T.Sax の組に入れ替わる", async () => {
    await draw(<ProfileView profile={PROFILE} uid="u1" />);
    await act(async () => { radios(group("楽器種別"))[1].click(); });
    expect(checkedLabel(group("楽器種別"))).toBe("T.Sax");
    expect(host.textContent).toContain("Selmer Supreme");
    expect(host.textContent).toContain("Otto Link Tone Edge 7");
    expect(host.textContent).not.toContain("YAS-875");
  });

  it("選んでいた楽器が登録から外れたら、登録している最初の楽器に戻る", async () => {
    await draw(<ProfileView profile={PROFILE} uid="u1" />);
    await act(async () => { radios(group("楽器種別"))[1].click(); });   // T.Sax
    await draw(<ProfileView profile={{ ...PROFILE, saxTypes: ["alto"], gear: { alto: PROFILE.gear.alto } }} uid="u1" />);
    expect(checkedLabel(group("楽器種別"))).toBe("A.Sax");
    expect(host.textContent).toContain("YAMAHA YAS-875");
  });
});
