// @vitest-environment jsdom
import React, { act, useState } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ------------------------------------------------------------------
// 【便BI 2026-10-02 本人指示】「リード編集の削除を赤の塗りから赤の枠に。アプリ全体で赤の塗りのボタンを赤の枠にそろえる」。
// 枠の形は人物のページの「通報」と同じ DANGER_OUTLINE_STYLE(地なし・枠 1px --c-danger・字 --c-danger)。
// 2つの向きで見る:
//   (1) 綴りの走査: src の全ファイル(検査を除く)で、赤(--c-danger / --c-bad / #DC2626)を地に塗る宣言を探す。
//       値の式の全体(三項の両腕まで)と、赤を値に持つ定数(許可の一覧の外は禁止)の両方で見る。
//       残ってよいのは録音ボタンの中の丸/四角と録音中の点の2つだけ(ボタンの種類ではなく計測の印。対象外)。
//   (2) 描画: 主要な画面を描いて、危険な一手の見た目が赤の枠であること(地が赤でないこと)を見る。
//       リードの箱の編集シートの「削除」/ マイページの「アカウントを削除」と確認のシートの「アカウントを削除する」/
//       すべての計測の選択モードの削除(1件以上選んだとき = .ctl-danger[data-armed])。
//       人物のページの「通報」「通報する」「ブロックする」は block.test.jsx / reportFlow.test.jsx が見る。
// 【守っていないもの】画面の実際の色(jsdom は var() を解決しない。トークンの値と字のコントラストは pitch-test 17.13)。
// ------------------------------------------------------------------
const { ReedsTab, DeleteActionButton, DANGER_OUTLINE_STYLE } = await import("./App.jsx");
const { ProfileView } = await import("./community/CommunityTab.jsx");

const SRC = join(process.cwd(), "src");
// vitest は css の ?raw を空で返すので、index.css はファイルから読む。
const cssText = readFileSync(join(SRC, "index.css"), "utf8");
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(jsx?|css)$/.test(name) && !/\.test\.|\.testutil\./.test(name)) out.push(p);
  }
  return out;
}
// 【便BI 2026-10-02 審査の差し戻し】以前は `background: "var(--c-danger)"` の**値の先頭**しか見ておらず、
// 条件つきの塗り(K: background: count > 0 ? "var(--c-danger)" : "none")と、別名の塗り
// (const red = "var(--c-danger)"; … background: red)を見逃した。走査は scripts/redFillScan.mjs の1つ
// (pitch-test 検証46 B-3 も同じものを読む)。**許可の一覧はこのファイルが自分で持つ。**
const { scanRedFillsAll } = await import("../scripts/redFillScan.mjs");

// 許可の一覧。赤を値に持つ定数は、文字の色(エラーの字)と赤の枠の定義だけ。地には使わない。
const ALLOWED_RED_CONSTS = [
  "App.jsx:DANGER_OUTLINE_STYLE",
  "community/CommunityTab.jsx:errorStyle",
  "community/CommunityTab.jsx:fieldErrorStyle",
  "community/FeedbackSheet.jsx:errorStyle",
  "community/LegalSheet.jsx:errorStyle",
];
// 赤を値に持つ CSS のカスタムプロパティは、トークンの定義そのものの2つだけ。
const ALLOWED_RED_CSS_VARS = ["index.css:--c-danger", "index.css:--c-bad"];
// 【便BI 再審査の差し戻し】本体に赤の綴りを含む名前つきの関数。画面の部品(中で赤の字・録音の印を描く)と、
// 分析の表のセルの字の色を返す pitchCellColor だけ。**許可していても、地の式で呼べば塗りとして拾う**(R1)。
const ALLOWED_RED_FNS = [
  "App.jsx:WindToneLabPhaseMode", "App.jsx:MeasureView", "App.jsx:pitchCellColor",
  "backup/BackupPanel.jsx:BackupPanel", "community/CommunityTab.jsx:ProfileForm",
  // 【便BV 2026-10-04】人物のページの中身は PersonBody へ移った(PersonSheet はシートの器だけ。赤の字 --c-bad は中身の1行)。
  "community/screens.jsx:PersonBody", "community/screens.jsx:ReportSheet",
  // 【便BO 2026-10-02】みんなの平均を目安に設定する確認のシート。取り込めなかったときの1行の**字**が --c-bad
  // (通報のシートの失敗の1行と同じ綴り)。地には使っていない(塗りの走査は (1) が別に見る)。
  "community/screens.jsx:CohortAdoptSheet",
  // (【便BX】参加の場面の「端末を替えるとき」(backup/DeviceTransferPanel.jsx:DeviceTransferPanel)をここで許していた。【便CE 2026-10-08】部品ごと消した)
];
// 審査の変異(便BI 再審査)。検査の中で実際に流し、どれも拾うことを確かめる。
const PROBES_BI3 = [
  // R1 許可した関数(赤を返す pitchCellColor)を地に流す
  ["R1", 'function pitchCellColor(c) { return Math.abs(c) < 10 ? "var(--c-good)" : "var(--c-bad)"; }\nconst S = (c) => <span style={{ background: pitchCellColor(c) }} />;'],
  // R2 rgb の空白区切り
  ["R2", 'const S = () => <span style={{ background: "rgb(220 38 38)" }} />;'],
  // R3 8桁の16進
  ["R3", 'const S = () => <span style={{ backgroundColor: "#DC2626FF" }} />;'],
  // R5 アローの関数が赤を返し、地の式で呼ぶ
  ["R5", 'const dangerBg = (on) => (on ? "var(--c-danger)" : "none");\nconst S = ({ armed }) => <span style={{ background: dangerBg(armed) }} />;'],
  // R8 function 宣言が赤を返し、地の式で呼ぶ
  ["R8", 'function redOf() { return "var(--c-bad)"; }\nconst S = () => <span style={{ backgroundColor: redOf() }} />;'],
];

describe("(1) 綴りの走査: 赤の塗りのボタンはアプリに1つも無い", () => {
  const files = walk(SRC).map((f) => [relative(SRC, f).replace(/\\/g, "/"), readFileSync(f, "utf8")]);
  const scan = scanRedFillsAll(files);
  const lineOf = (file, line) => files.find(([n]) => n === file)[1].split("\n")[line - 1];

  it("走査が空回りしていない(src のファイルを読めている。App.jsx と index.css と screens.jsx を含む)", () => {
    const names = files.map(([n]) => n);
    expect(names.length).toBeGreaterThan(30);
    for (const n of ["App.jsx", "index.css", "community/screens.jsx", "community/CommunityTab.jsx", "termTip.jsx"]) expect(names).toContain(n);
  });

  // 審査の2つの変異をそのまま流し、どちらも拾うことを確かめる(拾えない走査は何も守らない)。
  it("走査は条件つきの塗り(K)と別名の塗りを拾う。CSS の別名・塗りの値の途中の赤も拾う", () => {
    const K = scanRedFillsAll([["K.jsx", 'const P = () => <span style={{ background: count > 0 ? "var(--c-danger)" : "none" }} />;']]);
    expect(K.fills).toHaveLength(1);
    const alias = scanRedFillsAll([["A.jsx", 'const red = "var(--c-danger)";\nconst B = () => <span style={{ background: red }} />;']]);
    expect(alias.redConsts.map((c) => c.name)).toEqual(["red"]);
    expect(alias.fills).toHaveLength(1);
    // 許可した定数の色を地へ流す形(定数の名前が塗りの式に入る)
    const viaAllowed = scanRedFillsAll([["C.jsx", 'const DANGER_OUTLINE_STYLE = { color: "var(--c-danger)" };\nconst X = { backgroundColor: DANGER_OUTLINE_STYLE.color };']]);
    expect(viaAllowed.fills).toHaveLength(1);
    // CSS: 宣言の途中の赤・別名のカスタムプロパティ
    expect(scanRedFillsAll([["a.css", ".x { background: none, var(--c-bad); }"]]).fills).toHaveLength(1);
    const cssAlias = scanRedFillsAll([["b.css", ":root { --x: var(--c-danger); } .y { background-color: var(--x); }"]]);
    expect(cssAlias.cssVars.map((v) => v.name)).toEqual(["--x"]);
    expect(cssAlias.fills).toHaveLength(1);
    // el.style.background = … の代入と、複数行にまたがる三項の後ろの腕
    expect(scanRedFillsAll([["d.js", 'el.style.background = on\n  ? "var(--c-surface)"\n  : "#DC2626";']]).fills).toHaveLength(1);
    // 赤の枠(地は transparent)は塗りではない
    expect(scanRedFillsAll([["e.jsx", 'const s = { border: "1px solid var(--c-danger)", background: "transparent" };']]).fills).toHaveLength(0);
  });

  it("【便BI 再審査】審査の変異 R1(許可した関数を地へ)・R2(rgb の空白区切り)・R3(8桁の16進)・R5(アロー)・R8(function 宣言)をどれも拾う", () => {
    for (const [id, code] of PROBES_BI3) {
      const r = scanRedFillsAll([[`${id}.jsx`, code]]);
      expect(r.fills, id).toHaveLength(1);
    }
    // 関数として集めていること(R1 の pitchCellColor・R5 のアロー・R8 の宣言)
    expect(scanRedFillsAll([["R5.jsx", PROBES_BI3[3][1]]]).redFns.map((f) => [f.name, f.kind])).toEqual([["dangerBg", "arrow"]]);
    expect(scanRedFillsAll([["R8.jsx", PROBES_BI3[4][1]]]).redFns.map((f) => [f.name, f.kind])).toEqual([["redOf", "function"]]);
    // 関数を呼ばずに字の色にだけ使うのは塗りではない(pitchCellColor の正当な使い道)
    expect(scanRedFillsAll([["ok.jsx", 'function pitchCellColor(c) { return "var(--c-bad)"; }\nconst S = (c) => <span style={{ color: pitchCellColor(c) }} />;']]).fills).toHaveLength(0);
    // JSX の中にアローを持つだけの値は関数と取り違えない(定数でも関数でもない = 中の塗りだけを ① が見る)
    const jsx = scanRedFillsAll([["j.jsx", 'const tree = (<div onClick={() => go()} style={{ color: "var(--c-danger)" }} />);']]);
    expect(jsx.redFns).toHaveLength(0);
    expect(jsx.redConsts).toHaveLength(0);
  });

  it("赤を地に塗るのは録音ボタンの中の丸/四角と録音中の点の2つだけ(どちらも App.jsx・計測の印)", () => {
    const shown = scan.fills.map((h) => `${h.file}:${h.line}: ${lineOf(h.file, h.line).trim().slice(0, 120)}`);
    expect(scan.fills, shown.join("\n")).toHaveLength(2);
    expect(scan.fills.every((h) => h.file === "App.jsx"), shown.join("\n")).toBe(true);
    expect(scan.fills.some((h) => /borderRadius: s\.radius, background: "var\(--c-danger\)"/.test(lineOf(h.file, h.line))), shown.join("\n")).toBe(true);
    expect(scan.fills.some((h) => /className="ficus-pulse"/.test(lineOf(h.file, h.line))), shown.join("\n")).toBe(true);
  });

  it("赤を値に持つ定数・赤を含む関数・CSS のカスタムプロパティは、許可の一覧の外に無い(別名の塗りの元を作らせない)", () => {
    expect(scan.redConsts.map((c) => `${c.file}:${c.name}`).sort()).toEqual([...ALLOWED_RED_CONSTS].sort());
    expect(scan.redFns.map((c) => `${c.file}:${c.name}`).sort()).toEqual([...ALLOWED_RED_FNS].sort());
    expect(scan.cssVars.map((v) => `${v.file}:${v.name}`).sort()).toEqual([...ALLOWED_RED_CSS_VARS].sort());
  });

  it("赤の塗りの定義(DANGER_FILL_STYLE / dangerButtonStyle)はコードに無い。赤の枠の定義は App.jsx の1つだけ", () => {
    const code = (t) => t.replace(/(^|[\s{(,;=])\/\*[\s\S]*?\*\//g, "$1").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const all = files.map(([n, t]) => [n, code(t)]);
    expect(all.filter(([, t]) => /DANGER_FILL_STYLE|dangerButtonStyle/.test(t)).map(([n]) => n)).toEqual([]);
    expect(all.filter(([, t]) => /const DANGER_OUTLINE_STYLE\s*=/.test(t)).map(([n]) => n)).toEqual(["App.jsx"]);
    expect(DANGER_OUTLINE_STYLE.background).toBe("transparent");
    expect(DANGER_OUTLINE_STYLE.border).toBe("1px solid var(--c-danger)");
    expect(DANGER_OUTLINE_STYLE.color).toBe("var(--c-danger)");
  });
});

// ---- (2) 描画 -----------------------------------------------------------------
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
  document.head.innerHTML = "";
});
const draw = async (el) => { await act(async () => { root.render(el); }); };
const press = async (el) => { await act(async () => { el.click(); }); };
const sheetOf = (label) => document.body.querySelector(`[role="dialog"][aria-label="${label}"]`);
const isRedOutline = (s) => s.background === "transparent" && s.border === "1px solid var(--c-danger)" && s.color === "var(--c-danger)";

describe("(2) 描画: 危険な一手は赤の枠", () => {
  it("リードの箱の編集シートの「削除」は赤の枠(地なし・枠と字が --c-danger)。高さ --tap-min・角丸 --r-pill・字 --fs-sm / 700 は前のまま", async () => {
    const REEDS = [{ id: "a1", brand: "Vandoren", model: "Traditional", strength: "3.0", startDate: "2026-09-10", saxType: "alto", createdAt: "2026-09-10T01:00:00Z" }];
    function Harness() {
      const [reeds, setReeds] = useState(REEDS);
      const [compareReedIds, setCompareReedIds] = useState([]);
      const [reedsSubTab, setReedsSubTab] = useState("register");
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
    await draw(<Harness />);
    await press(host.querySelector('button[aria-label$="のメーカーと番手を編集"]'));
    const del = [...sheetOf("箱を編集").querySelectorAll("button")].find((b) => b.textContent === "削除");
    expect(del).toBeTruthy();
    const s = del.style;
    expect(isRedOutline(s), `${s.background} / ${s.border} / ${s.color}`).toBe(true);
    expect(s.minHeight).toBe("var(--tap-min)");
    expect(s.borderRadius).toBe("var(--r-pill)");
    expect(s.fontSize).toBe("var(--fs-sm)");
    expect(s.fontWeight).toBe("700");
    expect(s.flex).toBe("1 1 0px");
  });

  it("マイページの「アカウントを削除」と、確認のシートの「アカウントを削除する」はどちらも赤の枠", async () => {
    const PROFILE = {
      nickname: "てすと", icon: "ic-cat", iconColor: 2,
      saxTypes: ["alto"], gear: { alto: {} }, position: "社会人", startYear: 2015,
      genres: ["ジャズ"], ensembles: ["ソロ"], isPublic: true,
    };
    await draw(<ProfileView profile={PROFILE} uid="u1" onEdit={() => {}} onTogglePublic={async () => {}} onChangeAvatar={() => {}} onDelete={async () => {}} onOpenBackup={() => {}} />);
    const entry = [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === "アカウントを削除");
    expect(entry).toBeTruthy();
    expect(isRedOutline(entry.style), `${entry.style.background} / ${entry.style.border}`).toBe(true);
    await press(entry);
    const sheet = sheetOf("アカウントを削除しますか");
    expect(sheet).not.toBe(null);
    const last = [...sheet.querySelectorAll("button")].find((b) => b.textContent.trim() === "アカウントを削除する");
    expect(last).toBeTruthy();
    expect(isRedOutline(last.style), `${last.style.background} / ${last.style.border} / ${last.style.color}`).toBe(true);
    // シートの中に赤の地のボタンは1つも無い
    expect([...sheet.querySelectorAll("button")].filter((b) => /--c-danger/.test(b.style.background))).toHaveLength(0);
  });

  it("すべての計測の選択モードの削除: 1件以上選ぶと赤の枠(地なし・inset 1px・字 --c-danger)。0件では B型の地のまま", async () => {
    const style = document.createElement("style");
    style.textContent = cssText;
    document.head.appendChild(style);
    await draw(<DeleteActionButton count={1} ariaLabel="選んだ計測1件を削除" onClick={() => {}} />);
    const pill = host.querySelector(".ctl-danger");
    expect(pill.getAttribute("data-armed")).toBe("true");
    // インラインに地・色・枠を書いていない(クラスが決める)
    expect(pill.style.background).toBe("");
    expect(pill.style.color).toBe("");
    // index.css を読み込み、**描いた要素に当たる規則**を書かれた順に重ねて、効いている宣言を見る
    // (jsdom の getComputedStyle は box-shadow を返さず、var() も解決しないので、規則を自分で重ねて綴りで比べる。
    //  ここで重なるのは .ctl-plain → .ctl-pill → .ctl-danger → .ctl-danger[data-armed] で、書かれた順と詳細度の順が同じ)。
    const rules = [...style.sheet.cssRules].filter((r) => r.selectorText);
    expect(rules.length).toBeGreaterThan(50);   // index.css を読めている(空回りしていない)
    const applied = (el, prop) => {
      let v = "";
      for (const r of rules) if (el.matches(r.selectorText) && r.style.getPropertyValue(prop)) v = r.style.getPropertyValue(prop);
      return v.trim();
    };
    expect(applied(pill, "box-shadow")).toBe("inset 0 0 0 1px var(--c-danger)");
    expect(applied(pill, "color")).toBe("var(--c-danger)");
    expect(applied(pill, "background") || applied(pill, "background-color")).toBe("transparent");
    expect(applied(pill, "border")).not.toContain("--c-danger");   // 枠は inset の影だけ(寸法を動かさない)
    await draw(<DeleteActionButton count={0} ariaLabel="計測を削除" onClick={() => {}} />);
    const off = host.querySelector(".ctl-danger");
    expect(off.getAttribute("data-armed")).toBe("false");
    expect(applied(off, "box-shadow")).not.toContain("--c-danger");
    expect(applied(off, "color")).toBe("var(--c-ink-3)");
    expect(applied(off, "background") || applied(off, "background-color")).toBe("var(--c-sunken)");
  });
});
