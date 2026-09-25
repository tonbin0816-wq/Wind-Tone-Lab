import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// ------------------------------------------------------------------
// 【便AO 2026-09-24 本人の実機報告と指示】
//   1.「重心とかHNRとか音程の横軸が D2 E2 F#2 の3つしかない。
//      その楽器の該当の音は横軸に出るようにして」
//   2.「他の奏者のページはこのアプリの他のタブ切り替えに倣って
//      データとプロフィールがタブ切り替えになるように変更して」
//
// **実際に描かせて見る**(react-dom/server。avatarRender.test.jsx と同じ形)。
// 綴りを grep するだけだと「部品は差し替えたが saxType を渡し忘れた」が生き残る。
//
// 【作り物は2つだけ】
//   ・BottomSheet … 本物は document.body へポータルするので、サーバ描画では描けない。
//     作り物は**中身をそのまま描く**だけ(本物も中身は渡されたまま描く)。閉じ方の作法は
//     この検査の対象ではない。
//   ・幅 … NoteAxisLineChart は実測した幅で描き、測るのは useLayoutEffect(サーバ描画では
//     走らない)。MeasuredWidthSeedContext で「測れた幅」を与える。本番は Provider を置かず 0。
//
// 【守っていないもの】ブラウザでの実寸(文字の送り幅はサーバ描画では概算になる)、
// タブを押したあとの切り替わり(サーバ描画は初期状態しか描けない。出し分けの条件は
// side のままで、その値ごとの中身は下の reportEntryVisible / showAdopt の既存検査が見ている)。
// ------------------------------------------------------------------
vi.mock("../App.jsx", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    BottomSheet: ({ ariaLabel, children }) => <div role="dialog" aria-label={ariaLabel}>{children}</div>,
  };
});

import { MeasuredWidthSeedContext, concertNoteLabelOf, NoteAxisLineChart } from "../App.jsx";
import { PersonSheet, DataScreen, SegmentedTabs } from "./screens.jsx";

const TUNING = 442;
// 【データは3音だけ】14 / 16 / 18。A.Sax なら実音 E♭4 / F4 / G4(記音 C5 / D5 / E5)。
const KEYS = [14, 16, 18];
const localNotes = (base) => Object.fromEntries(KEYS.map((k, i) => [k, {
  centroidHz: base + i * 40, hnrDb: 18 + i, pitchCentsSigned: -3 + i * 2,
}]));
const sharedNotes = (base) => Object.fromEntries(KEYS.map((k, i) => [k, {
  spectralCentroidHz: base + i * 55, hnrDb: 17 + i * 1.5, pitchCentsSigned: 4 - i * 3,
}]));

const PERSON = (saxType) => ({
  uid: "p1", nickname: "しろねこ", icon: "ic-cat", iconColor: 2, photo: null,
  saxTypes: [saxType], gear: { [saxType]: {} }, position: "学生", genres: [], ensembles: [],
  stats: { daysAll: 24 },
});
const IDEAL = (saxType) => ({ id: `p1_${saxType}`, ownerUid: "p1", saxType, notes: sharedNotes(1500), sourceSessionCount: 12 });
const MINE = (saxType) => ({ [saxType]: { notes: localNotes(1400) } });

const drawPerson = ({ width = 2000, saxType = "alto", person = PERSON(saxType), ...rest } = {}) => renderToStaticMarkup(
  <MeasuredWidthSeedContext.Provider value={width}>
    <PersonSheet person={person} ideals={[IDEAL(saxType)]} myIdeals={MINE(saxType)}
                 onClose={() => {}} onAdopt={() => ({})} myUid="me" tuningHz={TUNING} {...rest} />
  </MeasuredWidthSeedContext.Provider>,
);

const USERS = ["a", "b", "c"].map((u) => ({ uid: u, nickname: u, saxTypes: ["alto"], genres: [], position: "学生" }));
const drawData = ({ width = 2000 } = {}) => renderToStaticMarkup(
  <MeasuredWidthSeedContext.Provider value={width}>
    <DataScreen users={USERS}
                ideals={USERS.map((u, i) => ({ id: `${u.uid}_alto`, ownerUid: u.uid, saxType: "alto", notes: sharedNotes(1450 + i * 30), sourceSessionCount: 3 }))}
                myIdeals={MINE("alto")} myUid="me" saxTypes={["alto"]} tuningHz={TUNING} />
  </MeasuredWidthSeedContext.Provider>,
);

// ---- 描いた SVG を読む ------------------------------------------------------
// NoteAxisLineChart の SVG は「実寸 = viewBox」(§1.9)。アイコンの小さな SVG と見分ける印にする
const svgOf = (html) => (html.match(/<svg width="(\d+)" height="[\d.]+" viewBox="0 0 \1 [\s\S]*?<\/svg>/) || [""])[0];
// 横軸の音名 = 中央揃えの <text>(縦軸の目盛は右揃え)
const axisLabels = (svg) => [...svg.matchAll(/<text x="([-\d.]+)"[^>]*text-anchor="middle"[^>]*>([^<]*)<\/text>/g)]
  .map((m) => ({ x: m[1], name: m[2] }));
// 系列ごとの <g>(線と点の色を style で持つ)
const seriesGroups = (svg) => [...svg.matchAll(/<g style="stroke:([^;]+);fill:[^"]+">([\s\S]*?)<\/g>/g)]
  .map((m) => ({ color: m[1], body: m[2], dots: [...m[2].matchAll(/<circle cx="([-\d.]+)"/g)].map((c) => c[1]) }));
// その楽器の音域の実音の音名を、答え(concertNoteLabelOf)から並べる
const concertAxis = (saxType) => {
  const out = [];
  for (let i = 0; i < 100; i++) { const l = concertNoteLabelOf(i, saxType, TUNING); if (!l) break; out.push(l); }
  return out;
};

describe("コミュニティのグラフ ── 横軸はその楽器の音域の全音・実音の音名(便AO 変更1)", () => {
  it("答えの側の前提: A.Sax の 14 / 16 / 18 は実音 E♭4 / F4 / G4、音域は 37 音(C♯3 = D♭3 から)", () => {
    // 楽器の外の事実(アルトの最低音 記音B♭3 = 実音C♯3(D♭3)、フラジオ込み 37 音)で答えそのものを確かめる
    expect(KEYS.map((k) => concertNoteLabelOf(k, "alto", TUNING))).toEqual(["E♭4", "F4", "G4"]);
    const axis = concertAxis("alto");
    expect(axis.length).toBe(37);
    expect(axis[0]).toBe("C♯3"); // アプリの音名表は C♯ で綴る(NOTE_NAMES)
  });

  for (const [name, draw] of [["人物紹介", () => drawPerson()], ["データの「みんなの平均」", () => drawData()]]) {
    it(`${name}: 点の真下の音名は concertNoteLabelOf と一致し、D2 / E2 / F#2 ではない`, () => {
      const svg = svgOf(draw());
      expect(svg).not.toBe("");
      const labels = axisLabels(svg);
      const groups = seriesGroups(svg);
      expect(groups.length).toBe(2);
      for (const g of groups) {
        expect(g.dots.length).toBe(3);
        const under = g.dots.map((x) => labels.find((l) => l.x === x)?.name);
        expect(under).toEqual(KEYS.map((k) => concertNoteLabelOf(k, "alto", TUNING)));
      }
      for (const bad of ["D2", "E2", "F#2"]) expect(labels.map((l) => l.name)).not.toContain(bad);
    });

    it(`${name}: データが3音しか無くても、横軸はその楽器の音域の全音(数も並びも答えと一致)`, () => {
      // 幅 2000 なら間引きが起きない(1音ごとに名札が立つ)ので、横軸の音をそのまま数えられる
      const labels = axisLabels(svgOf(draw()));
      expect(labels.map((l) => l.name)).toEqual(concertAxis("alto"));
    });
  }

  it("人物紹介は画面で選んでいる楽器種別で名付ける(T.Sax の人なら T.Sax の実音)", () => {
    const labels = axisLabels(svgOf(drawPerson({ saxType: "tenor" })));
    expect(labels.map((l) => l.name)).toEqual(concertAxis("tenor"));
    expect(concertAxis("tenor")).not.toEqual(concertAxis("alto")); // 取り違えれば落ちる前提
  });

  // 【便AR 2026-09-24 本人採用 案B】計測タブの「実測と目安」と同じ決まり。
  //   比べる相手(1本目) = 目安の見た目: --c-ink-3・破線 4 3・白抜きの点
  //   自分(2本目)       = 実測の見た目: --c-accent・実線・塗りの点
  for (const [name, draw, other] of [["人物紹介", () => drawPerson(), "しろねこ"], ["データの「みんなの平均」", () => drawData(), "みんなの平均"]]) {
    it(`${name}: 相手は灰の破線と白抜きの点、自分は紺の実線と塗りの点。凡例の見本も同じ`, () => {
      const html = draw();
      const groups = seriesGroups(svgOf(html));
      expect(groups.map((g) => g.color)).toEqual(["var(--c-ink-3)", "var(--c-accent)"]);
      // 相手: 破線・点はすべて白抜き(地 --c-surface)
      expect(groups[0].body).toMatch(/<polyline[^>]*stroke-dasharray="4 3"/);
      const theirDots = [...groups[0].body.matchAll(/<circle [^>]*>/g)].map((m) => m[0]);
      expect(theirDots.length).toBeGreaterThan(0);
      for (const d of theirDots) expect(d).toMatch(/fill:var\(--c-surface\)/);
      // 自分: 実線・点は塗り(縁なし)
      expect(groups[1].body).not.toMatch(/stroke-dasharray/);
      const mineDots = [...groups[1].body.matchAll(/<circle [^>]*>/g)].map((m) => m[0]);
      expect(mineDots.length).toBeGreaterThan(0);
      for (const d of mineDots) { expect(d).toMatch(/stroke="none"/); expect(d).not.toMatch(/--c-surface/); }
      // 凡例の見本: 相手は白抜き、自分は塗り(並びも同じ)
      expect(html).toMatch(new RegExp(`data-legend-swatch="hollow"[\\s\\S]*?${other}[\\s\\S]*?data-legend-swatch="fill"[\\s\\S]*?自分`));
      expect(html).toMatch(/data-legend-swatch="hollow"[\s\S]*?stroke-dasharray="4 3"[\s\S]*?stroke:var\(--c-ink-3\)/);
      // 見本の点そのもの: 相手の見本は白抜き(地 --c-surface)、自分の見本は塗り
      const swatchOf = (kind) => (html.match(new RegExp(`<svg[^>]*data-legend-swatch="${kind}"[\\s\\S]*?</svg>`)) || [""])[0];
      expect(swatchOf("hollow")).toMatch(/<circle[^>]*fill:var\(--c-surface\)/);
      expect(swatchOf("fill")).toMatch(/<circle[^>]*fill:var\(--c-accent\)/);
      expect(swatchOf("fill")).not.toMatch(/--c-surface/);
    });
  }

  it("見出し(label / unit)は出さない(単位は画面の側が出している)", () => {
    const html = drawPerson();
    expect(html).toContain("Hz　計測12件");
    expect(html).not.toMatch(/重心\(Hz\)/);
  });
});

describe("R12 ── 指標を切り替えても縦軸の柱の幅(= 折れ線の左端)が動かない(byMetric)", () => {
  const byMetric = {
    spectralCentroidHz: { 14: 1502, 16: 1611, 18: 1742 },
    hnrDb: { 14: 17.2, 16: 19.8, 18: 21.6 },
    pitchCentsSigned: { 14: -5, 16: 1.2, 18: 4.8 },
  };
  const fmts = { spectralCentroidHz: (v) => Math.round(v).toString(), hnrDb: (v) => v.toFixed(1), pitchCentsSigned: (v) => v.toFixed(1) };
  const tickX = (key, withByMetric) => {
    const svg = svgOf(renderToStaticMarkup(
      <MeasuredWidthSeedContext.Provider value={360}>
        <NoteAxisLineChart plain metricKey={key} fmt={fmts[key]} saxType="alto" tuningHz={TUNING}
          series={[{ id: "a", label: "a", style: { color: "var(--c-accent)", width: 2, dash: null },
                     byIdx: byMetric[key], ...(withByMetric ? { byMetric } : {}) }]}
          selectedIdeal={null} idealKey={null} />
      </MeasuredWidthSeedContext.Provider>));
    return (svg.match(/<text x="([-\d.]+)"[^>]*text-anchor="end"/) || [])[1];
  };
  it("byMetric を渡せば、重心 / HNR / 音程で目盛の x が同じ", () => {
    const xs = Object.keys(byMetric).map((k) => tickX(k, true));
    expect(xs[0]).toBeDefined();
    expect(new Set(xs).size).toBe(1);
  });
  it("(検査が効いている証拠)byMetric が無いと、同じデータで x が動く", () => {
    const xs = Object.keys(byMetric).map((k) => tickX(k, false));
    expect(new Set(xs).size).toBeGreaterThan(1);
  });
  it("コミュニティの2画面は byMetric を渡している(3指標とも値を持つ)", () => {
    // 描いた結果からは渡したかどうかが読めないので、呼び出しの綴りで見る(十分条件ではない)
    return import("node:fs").then(({ readFileSync }) => {
      const src = readFileSync(new URL("./screens.jsx", import.meta.url), "utf8");
      expect(src).toMatch(/byIdx: s\.values, byMetric: s\.byMetric/);
      const data = src.slice(src.indexOf("export function DataScreen("), src.indexOf("export function PersonSheet("));
      const person = src.slice(src.indexOf("export function PersonSheet("), src.indexOf("function ReportSheet("));
      expect(data).toMatch(/label: "みんなの平均", values: avgBy\[m\.key\], byMetric: avgBy,/);
      expect(data).toMatch(/label: "自分", values: mineBy\[m\.key\], byMetric: mineBy,/);
      expect(person).toMatch(/values: theirBy\[m\.key\], byMetric: theirBy,/);
      expect(person).toMatch(/label: "自分", values: mineBy\[m\.key\], byMetric: mineBy,/);
    });
  });
});

// 【便AU 2026-09-24 本人指示】部品は SubTabs から溝型(SegmentedTabs)に替わった。
describe("人物紹介は溝型の [データ | プロフィール](便AO 変更2 / 便AU)", () => {
  const TAB_ITEMS = [{ key: "data", label: "データ" }, { key: "profile", label: "プロフィール" }];
  const html = drawPerson({ width: 360 });
  const drawTabs = () => renderToStaticMarkup(
    <SegmentedTabs ariaLabel="表示する内容" items={TAB_ITEMS} value="data" onChange={() => {}} />);

  it("溝型の切り替え(SegmentedTabs)がそのまま描かれ、初期はデータのタブ", () => {
    const tabs = drawTabs();
    expect(html).toContain(tabs);
  });

  it("タブは名前の行(アイコン・名前)の下", () => {
    const tabs = drawTabs();
    expect(html.indexOf("しろねこ")).toBeGreaterThan(-1);
    expect(html.indexOf(tabs)).toBeGreaterThan(html.indexOf("しろねこ"));
  });

  // 【便AZ 2026-09-25 本人指示 C】「< 一覧」も消した(閉じ方はシートのつまみ・暗幕・下スワイプ・Escape)。
  it("上端に戻るボタンは無い(「< 一覧」も「< 音のデータ」も無い)", () => {
    expect(html).not.toContain("&lt; 一覧");
    expect(html).not.toContain('aria-label="一覧に戻る"');
    expect(html).not.toContain("音のデータ");
  });

  it("名前の行は押せる行ではない(role=\"button\" も右端の山形も無い)", () => {
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('d="M4 2l3 3-3 3"');
    expect(html).not.toContain("のプロフィールを見る");
  });

  it("写真の人は、データのタブでも写真の拡大が出る", () => {
    const withPhoto = drawPerson({ width: 360, person: { ...PERSON("alto"), photo: "https://example.test/p.webp" } });
    expect(withPhoto).toContain('aria-label="写真を大きく表示"');
    expect(html).not.toContain('aria-label="写真を大きく表示"'); // 絵柄の人には出ない
  });

  it("データのタブには「目安に設定」が出て、通報の入口は出ない(通報はプロフィールのタブだけ)", () => {
    expect(html).toContain(">目安に設定</button>");
    expect(html).not.toContain("この人を通報");
  });
});

// ------------------------------------------------------------------
// 正典(design/canvas)も同じ姿に直してある ── 生成器 community.mjs の出力を読む。
// 改善案の面(CommDataB / C / D)は当時の記録なので対象にしない。
// ------------------------------------------------------------------
describe("正典 CommData / CommPerson / CommPersonBack(便AO)", () => {
  const read = (f) => import("node:fs").then(({ readFileSync }) =>
    readFileSync(new URL(`../../design/canvas/${f}`, import.meta.url), "utf8").replace(/<!--[\s\S]*?-->/g, ""));

  for (const f of ["CommData.dc.html", "CommPerson.dc.html"]) {
    it(`${f}: 横軸は A.Sax の音域の全音にわたる実音の音名(番号を 12 で回した名前ではない)`, async () => {
      const svg = svgOf(await read(f));
      expect(svg).not.toBe("");
      const names = [...svg.matchAll(/text-anchor="middle"[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]);
      const axis = concertAxis("alto");
      const at = names.map((n) => axis.indexOf(n));
      expect(at.length).toBeGreaterThan(1);
      expect(at.every((i) => i >= 0)).toBe(true);
      // 間引きは等間隔で、軸の両端まで届いている(= 横軸はデータの音ではなく音域の全音)
      const steps = new Set(at.slice(1).map((i, k) => i - at[k]));
      expect(steps.size).toBe(1);
      const step = [...steps][0];
      expect(at[0]).toBeLessThan(step);
      expect(at[at.length - 1]).toBeGreaterThan(axis.length - 1 - step);
      for (const bad of ["D2", "E2", "F#2"]) expect(names).not.toContain(bad);
    });
  }

  // 【便AZ 2026-09-25】正典も上端の「< 一覧」を消した(生成器 community.mjs を直して出し直した)。
  it("CommPerson / CommPersonBack: 溝型の [データ | プロフィール](便AU)、上端に < 一覧は無い、名前の行に山形が無い", async () => {
    // 選んでいる側だけが白い面(--shadow-seg)に乗る
    const tab = (html, label) => new RegExp(`box-shadow: var\\(--shadow-seg\\)">${label}<`).test(html);
    const front = await read("CommPerson.dc.html");
    const back = await read("CommPersonBack.dc.html");
    expect(tab(front, "データ")).toBe(true);
    expect(tab(back, "プロフィール")).toBe(true);
    for (const html of [front, back]) {
      expect(html).not.toContain("&lt; 一覧");
      expect(html).not.toContain("音のデータ");
      expect(html).not.toContain('d="M4 2l3 3-3 3"');
      expect(html).toMatch(/>データ<\/span>[\s\S]{0,1200}>プロフィール<\/span>/);
    }
  });
});
