import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { AVATAR_ICONS, AVATAR_COLOR_MIN, AVATAR_COLOR_MAX } from "./profile.js";
import { EMPTY_PICKS, picksToGearEntry } from "./CommunityTab.jsx";

// 【この2つは実装から import しない】機材1組の形と、選べる絵柄の数は凍結された仕様。
// 実装から引くと「実装が何を出そうと一致する」検査になり、何も守らない。
const GEAR_KEYS = ["instrumentBrand", "instrumentModel", "mpBrand", "mpModel", "ligBrand", "ligModel", "reedBrand", "reedModel"];
const ICON_COUNT = 24;

const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("アイコンの絵柄", () => {
  // 【なぜ検査するか】「選べるもの」の正は profile.js の AVATAR_ICONS、
  // 絵の形を持つのは icons.jsx。片方だけ足すと、
  //  - AVATAR_ICONS だけ: 絵の無い識別子が保存でき、画面には色だけの丸が出る
  //  - icons.jsx だけ:    誰も選べない絵が増える(害は無いが死蔵)
  // どちらも動きはするので、テストが無いと気づけない。
  const sprite = readSrc("./icons.jsx");
  const spriteIds = [...sprite.matchAll(/id="(ic-[a-z0-9-]+)"/g)].map((m) => m[1]);

  it("絵柄は24種で、重複が無い", () => {
    expect(AVATAR_ICONS).toHaveLength(ICON_COUNT);
    expect(new Set(AVATAR_ICONS).size).toBe(ICON_COUNT);
  });
  it("選べる絵柄と、スプライトが持つ絵の形が過不足なく一致する", () => {
    expect([...spriteIds].sort()).toEqual([...AVATAR_ICONS].sort());
  });
  it("識別子はすべて ic- で始まる(use href の綴りと揃える)", () => {
    for (const id of AVATAR_ICONS) expect(id).toMatch(/^ic-[a-z0-9-]+$/);
  });
});

describe("アイコンの地の色", () => {
  const css = readSrc("../index.css");
  it("色は1から10の番号で、10色とも index.css に実値がある", () => {
    expect(AVATAR_COLOR_MIN).toBe(1);
    expect(AVATAR_COLOR_MAX).toBe(10);
    for (let n = AVATAR_COLOR_MIN; n <= AVATAR_COLOR_MAX; n++) {
      expect(css).toMatch(new RegExp(`--c-avatar-${n}:\\s*#[0-9A-Fa-f]{6};`));
    }
  });
  it("Firestore ルールが色の範囲を 1..10 に固定している", () => {
    const rules = readSrc("../../firestore.rules");
    expect(rules).toContain("request.resource.data.iconColor is int");
    expect(rules).toContain("request.resource.data.iconColor >= 1");
    expect(rules).toContain("request.resource.data.iconColor <= 10");
  });
  it("Firestore ルールの絵柄の列挙が AVATAR_ICONS と一致する", () => {
    const rules = readSrc("../../firestore.rules");
    const list = "[" + AVATAR_ICONS.map((i) => `'${i}'`).join(",") + "]";
    expect(rules).toContain(`request.resource.data.icon in ${list}`);
  });
});

// ------------------------------------------------------------------
// 【この describe が塞いでいる穴】機材の欄を1つ足すとき、直す場所は3つある:
//   (a) 保存済みの値を画面の形へ読む gearEntryToPicks
//   (b) 空の初期値 EMPTY_PICKS
//   (c) 画面の値を保存の形へ書き出す picksToGearEntry
// 実際にリードを足したとき (b) と (c) を忘れた。buildProfileDoc のテストは
// 直接ドキュメントを渡すので**全部通ったまま**で、画面からだけ保存できない状態だった。
// しかもリードは必須なので、利用者から見ると「正しく選んでいるのに永久に登録できない」。
// ------------------------------------------------------------------
describe("画面の機材と保存の形の対応づけ", () => {
  it("書き出しの結果は仕様の8キーちょうど(数も綴りも)", () => {
    expect(Object.keys(picksToGearEntry(EMPTY_PICKS)).sort()).toEqual([...GEAR_KEYS].sort());
  });
  it("空の初期値は8欄すべてを持ち、すべて null になる", () => {
    // EMPTY_PICKS に欄が足りないと、その欄は「選んでも保存されない」。
    const out = picksToGearEntry(EMPTY_PICKS);
    for (const k of GEAR_KEYS) expect(out[k]).toBeNull();
    expect(Object.keys(EMPTY_PICKS).sort()).toEqual(["instrument", "ligature", "mouthpiece", "reed"]);
  });
  it("選んだ4つがそれぞれ対応する2キーへ落ちる", () => {
    const out = picksToGearEntry({
      instrument: { brand: "YAMAHA", model: "YAS-62" },
      mouthpiece: { brand: "Selmer", model: "S80 C*" },
      ligature: { brand: "Rovner", model: "Dark" },
      reed: { brand: "Vandoren", model: "Traditional" },
    });
    expect(out).toEqual({
      instrumentBrand: "YAMAHA", instrumentModel: "YAS-62",
      mpBrand: "Selmer", mpModel: "S80 C*",
      ligBrand: "Rovner", ligModel: "Dark",
      reedBrand: "Vandoren", reedModel: "Traditional",
    });
  });
  it("型番の無い「その他」は brand だけが入り model は null になる", () => {
    const out = picksToGearEntry({ ...EMPTY_PICKS, reed: { brand: "__other__", model: null } });
    expect(out.reedBrand).toBe("__other__");
    expect(out.reedModel).toBeNull();
  });
});

// ------------------------------------------------------------------
// 【この describe が塞いでいる穴】アイコンの選択欄を足したとき、色を10列で並べた。
// 当たり判定は44px角を割れないので 10*44 + 隙間9*4 = 476px 必要になるが、
// 375px の端末で使える幅は 375 - 左右の余白32 = 343px しかない。
// 親が grid なので、はみ出した1行が**兄弟もろともページ全体を476pxへ広げ**、
// ニックネーム欄まで画面外へ出た。
//
// 見た目の崩れは単体テストで直接は測れないが、**入るかどうかは算術で判る。**
// 列数と当たり判定と隙間から必要幅を出し、いちばん狭い端末の幅と突き合わせる。
// ------------------------------------------------------------------
describe("アイコンの選択欄が狭い端末に収まる", () => {
  const src = readSrc("./CommunityTab.jsx");
  // 凍結された値。**実装から読まない** ── 実装が変えたら検査も変わるのでは何も守れない。
  const TAP_MIN = 44;      // --tap-min: 当たり判定の下限。これを割る解は採らない
  const GAP = 4;           // --sp-1
  const PAGE_PADDING = 16; // --sp-4 が左右に1つずつ
  const NARROWEST = 320;   // iPhone SE 相当。ここに入れば 375 にも入る
  const available = NARROWEST - PAGE_PADDING * 2;
  const needed = (cols) => cols * TAP_MIN + (cols - 1) * GAP;

  const gridOf = (label) => {
    const at = src.indexOf(`aria-label="${label}"`);
    if (at < 0) throw new Error(`${label} が見つからない`);
    const near = src.slice(at, at + 220);
    const m = near.match(/gridTemplateColumns: "([^"]+)"/);
    if (!m) throw new Error(`${label} の列指定が見つからない`);
    return m[1];
  };
  const columnsOf = (label) => {
    const spec = gridOf(label);
    const m = spec.match(/^repeat\((\d+), minmax\(0, 1fr\)\)$/);
    if (!m) throw new Error(`${label} の列指定が想定の形ではない: ${spec}`);
    return Number(m[1]);
  };

  it("絵柄の格子が320pxの端末に収まる", () => {
    expect(needed(columnsOf("アイコンの絵柄"))).toBeLessThanOrEqual(available);
  });
  it("地の色の格子が320pxの端末に収まる", () => {
    expect(needed(columnsOf("アイコンの地の色"))).toBeLessThanOrEqual(available);
  });
  it("10色を1行に並べる形は入らない(この検査が効いていることの確認)", () => {
    // 実際に踏んだ形。これが available 以下になるなら、上の2件は何も守っていない。
    expect(needed(10)).toBeGreaterThan(available);
  });
  it("列は minmax(0, 1fr) で指定する(1fr だと中身の幅が列の下限になる)", () => {
    // `repeat(N, 1fr)` は最小値が auto なので、中の44pxがそのまま列の下限になり、
    // 縮まずにページを押し広げる。minmax(0, ...) なら0まで縮むので伝播しない。
    for (const label of ["アイコンの絵柄", "アイコンの地の色"]) {
      expect(gridOf(label)).toMatch(/^repeat\(\d+, minmax\(0, 1fr\)\)$/);
    }
  });
});
