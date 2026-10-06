import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beginLoad, loadPercent, loadFloor, resetLoadProgress } from "./loadProgress.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const NL = String.fromCharCode(10); // 検査の中で改行を書くと、この行自体が壊れる
const RING = read("./LoadingRing.jsx");
const CSS = read("../index.css");

beforeEach(() => resetLoadProgress());

describe("読み込みの%(2026/09/10 本人指示)", () => {
  it("何も始まっていなければ 0", () => {
    expect(loadPercent(0)).toBe(0);
  });

  // 【この検査がこの仕組みの要点】待ちが長引いても次の段階の値を**超えない**。
  // 超えると「95% まで来たのに 45% へ戻る」が起きる。数字は単調に増えるべき。
  it("待ち続けても次の段階の入口を追い越さない", () => {
    beginLoad("chunk", 0);
    // 45/100 が chunk の重み。どれだけ待っても 45 を**超えない**。
    // (十数秒も待つと e^(-t/τ) が倍精度で 0 に落ちてちょうど 45 に着く。
    //  表示は Math.floor なので、次の段階の頭の 45 と同じ数字になるだけで跳ばない。)
    for (const t of [100, 1000, 5000, 60000]) {
      expect(loadPercent(t), `${t}ms で ${loadPercent(t)}`).toBeLessThanOrEqual(45);
    }
    // 現実的な待ち(8秒)のあいだは 45 の手前に居続ける。
    expect(loadPercent(8000)).toBeLessThan(45);
    expect(loadPercent(8000)).toBeGreaterThan(44.9); // ただし限りなく近づく
  });

  it("止まって見えない(時間が経つほど必ず増える)", () => {
    beginLoad("chunk", 0);
    let prev = -1;
    for (let t = 0; t <= 4000; t += 50) {
      const v = loadPercent(t);
      expect(v, `${t}ms`).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it("段階が進むと巻き戻らない", () => {
    beginLoad("chunk", 0);
    const a = loadPercent(3000);
    beginLoad("account", 3000);
    expect(loadPercent(3000)).toBe(45);
    expect(loadPercent(3000)).toBeGreaterThan(a);
    beginLoad("list", 6000);
    expect(loadPercent(6000)).toBe(80);
  });

  // 飛ばされた段階も終わったものとして足す(未参加の人は list を通らない等)。
  it("段階を飛ばしても足し忘れない", () => {
    beginLoad("chunk", 0);
    beginLoad("list", 1000);
    expect(loadPercent(1000)).toBe(80);
  });

  // 2回目に開くと chunk はブラウザに残っていて Suspense の待ちが出ない。
  // 1回目と同じ重みで割ると 45% から始まってしまう。
  it("2回目(chunk を通らない回)は残りだけで 100% を割り直す", () => {
    beginLoad("account", 0);
    expect(loadPercent(0)).toBe(0);
    beginLoad("list", 1000);
    expect(loadPercent(1000)).toBeCloseTo((35 / 55) * 100, 6);
  });

  // React の StrictMode は開発時に effect をわざと2回走らせる。ここで割り直すと
  // 45% → 0% と巻き戻る。**同じ段階の入り直しは何もしない**のが正しい。
  it("同じ段階が二度始まっても巻き戻らない", () => {
    beginLoad("chunk", 0);
    beginLoad("account", 1000);
    const a = loadPercent(1200);
    beginLoad("account", 1200); // StrictMode の2回目 / 要素の作り直し
    expect(loadPercent(1200)).toBe(a);
    expect(loadPercent(1200)).toBeGreaterThanOrEqual(45);
  });

  it("前の段階が始まったら別の回として割り直す", () => {
    beginLoad("chunk", 0);
    beginLoad("account", 1000);
    beginLoad("chunk", 2000); // タブを開き直した
    expect(loadPercent(2000)).toBe(0);
  });

  // 100% は「終わった」の意味。まだ待っているあいだは出さない。
  it("99 で頭打ちにする", () => {
    beginLoad("list", 0);
    expect(loadPercent(600000)).toBe(99);
  });

  it("loadFloor は内挿しない(動きを減らす設定で出す値)", () => {
    beginLoad("chunk", 0);
    expect(loadFloor()).toBe(0);
    beginLoad("account", 5000);
    expect(loadFloor()).toBe(45);
  });
});

// ------------------------------------------------------------------
// 【2026-10-06 本人裁定】輪(09/13〜)をやめ、アイコンの芽の輪郭を線でなぞり、
// 9割で閉じて残りで塗る絵にした。描いた結果(0% / 50% / 90% / 100%)は
// LoadingRing.test.jsx が実際に描いて確かめる。ここは綴りの約束を見張る。
// (株の絵 → 輪 → 芽 の経緯は design/DESIGN-SYSTEM.md §1.12)
// ------------------------------------------------------------------
const SPROUT = read("./sproutPath.js");
describe("読み込みの芽(2026-10-06 本人裁定)", () => {
  // 【0 のときは線を描かない】丸い先端は**長さ 0 の破線も点として描く**。
  // 素直に書くと 0% の芽の先に点が1つ乗る(株では枝の根元に点が4つ、輪では0%に点が1つ浮いた)。
  it("0% では線を描かない(外形も穴も、割合が 0.002 を超えてから)", () => {
    expect(RING).toMatch(/outer > 0\.002 && <path d=\{SPROUT_OUTER\}/);
    expect(RING).toMatch(/hole > 0\.002 && <path d=\{SPROUT_HOLE\}/);
  });

  // 【dashoffset ではなく dasharray】「見せる割合」をそのまま書ける。
  // pathLength=1 と組にしてあるので輪郭の長さを計算しない(形を作り直しても壊れない)。
  it("dasharray でなぞる", () => {
    const code = RING.split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
    expect(code).not.toMatch(/strokeDashoffset/);
    expect(code).toMatch(/pathLength: "1"/);
    expect(code).toMatch(/strokeDasharray=\{`\$\{outer\} 1`\}/);
    expect(code).toMatch(/strokeDasharray=\{`\$\{hole\} 1`\}/);
  });

  // 線は輪郭の**真ん中**を通るので、太さの半分だけ外へ出る。枠からはみ出すと芽の先が欠ける。
  it("芽が枠からはみ出さない(線の太さの半分を足しても viewBox の内側)", () => {
    const vb = /const VIEWBOX = "([^"]+)"/.exec(RING)[1].split(" ").map(Number);
    const w = Number(/const W = (\d+(?:\.\d+)?);/.exec(RING)[1]);
    const nums = [...SPROUT.matchAll(/"(M[^"]+)"/g)].flatMap((m) => m[1].match(/-?\d+(?:\.\d+)?/g).map(Number));
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs) - w / 2).toBeGreaterThanOrEqual(vb[0]);
    expect(Math.min(...ys) - w / 2).toBeGreaterThanOrEqual(vb[1]);
    expect(Math.max(...xs) + w / 2).toBeLessThanOrEqual(vb[0] + vb[2]);
    expect(Math.max(...ys) + w / 2).toBeLessThanOrEqual(vb[1] + vb[3]);
  });
});

describe("置き場所(§1.11 / 遅延読み込みの前提)", () => {
  // 【待つ画面が、待たせている当のものを読み込んではいけない】
  // App.jsx の Suspense の fallback がこの要素を描くので、ここが firebase を
  // 連れてくると遅延読み込みの意味が消える。芽の形(sproutPath.js)は import を持たない純粋なデータ。
  it("LoadingRing は React と loadProgress と sproutPath 以外を import しない", () => {
    const imports = [...RING.matchAll(/^import .*? from "(.+?)";/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./loadProgress.js", "./sproutPath.js", "react"]);
    expect(SPROUT).not.toMatch(/^import /m);
  });

  // 【この絵は CSS の動きを1つも持たない 2026/09/13 本人指示】
  // 以前は株元を軸にした揺れ(ficus-grow-sway)を index.css に置いていたが、
  // 「左右に揺れるアニメーションを削除」で外した。**動くのは進み具合で決まる線と塗りと数字だけ。**
  // ここが緩むと、また「止まって見えないから」と回るスピナーが戻ってくる。
  it("動きを持たない", () => {
    // コメントを剥がしてから数える。外した理由を index.css に書き残してあり、
    // その説明文の中に綴りが出てくる(この罠は pitch-test の codeOf() と
    // firestore.rules で既に2度踏んでいる)。
    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/@keyframes ficus-grow-sway/);
    expect(css).not.toMatch(/\.ficus-grow\s*\{/);
    const code = RING.split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
    expect(code).not.toMatch(/animation/);
    expect(code).not.toMatch(/@keyframes/);
    expect(code).not.toMatch(/transform/);
  });

  // 【色は2つ】芽(線と塗り)は --c-accent(アイコンと同じ紺)、%の数字は --c-ink-3。
  // 絵の中では INK の定数だけを使い、色を名指ししない。
  // 透かすのは「塗りが濃くなるぶん線が消える」入れ替わりだけ(どちらも進み具合で決まる)。
  // 淡い段を固定で足すと、小さく出したとき色の数だけが目に付いて形が読めない。
  it("色は「芽」と「数字」の2つだけ。透かすのは塗りと線の入れ替わりだけ", () => {
    const used = [...RING.matchAll(/var\(--c-[a-z0-9-]+\)/g)].map((m) => m[0]);
    const uniq = [...new Set(used)].sort();
    expect(uniq, `使っている色: ${uniq.join(" ")}`).toEqual(["var(--c-accent)", "var(--c-ink-3)"]);
    expect(used.filter((c) => c === "var(--c-accent)").length, "INK 以外で芽の色を名指ししている").toBe(1);
    const draw = RING.slice(RING.indexOf("export function LoadingRing"),
      RING.indexOf("export default function"));
    expect(draw).not.toMatch(/var\(--c-/);
    const opac = [...draw.matchAll(/opacity[=:] ?\{?([a-z]+)\}?/g)].map((m) => m[1]).sort();
    expect(opac, `透かしている値: ${opac.join(" ")}`).toEqual(["fill", "line"]);
  });

  // 色は必ずトークンから引く(DESIGN-SYSTEM §1)。hex 直書きを増やさない。
  it("色を直書きしない", () => {
    expect(RING).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });
});
