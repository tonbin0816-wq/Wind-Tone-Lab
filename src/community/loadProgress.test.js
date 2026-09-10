import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beginLoad, loadPercent, loadFloor, ficusGrowth, resetLoadProgress } from "./loadProgress.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

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

describe("ficus の育ち方", () => {
  it("0% でも茎だけは見えている(絵が抜けて見えない)", () => {
    const g = ficusGrowth(0);
    expect(g.stem).toBeGreaterThan(0);
    expect(g.bladeX).toBeGreaterThan(0); // scale(0) は描画が消える
    expect(g.bladeY).toBeGreaterThan(0);
  });

  // 実際に出しうる最大は 99%(100% は「終わった」の意味なので出さない)。
  // ここで完成しないと、葉が完成した姿は**一度も画面に出ない**。
  it("99% で葉が完成する(%の頭打ちと揃える)", () => {
    const g = ficusGrowth(0.99);
    expect(g.midrib).toBe(1);
    expect(g.veins).toEqual([1, 1, 1, 1]);
  });

  // 100% で public/icon.svg の葉と同じ姿になる = すべての部品が引き終わる。
  it("100% で葉が完成する", () => {
    const g = ficusGrowth(1);
    expect(g.stem).toBe(1);
    expect(g.bladeX).toBe(1);
    expect(g.bladeY).toBe(1);
    expect(g.midrib).toBe(1);
    expect(g.veins).toEqual([1, 1, 1, 1]);
  });

  // 進捗が戻らない以上、葉も縮まないこと。縮むと「読み込みが戻った」に見える。
  it("進むほど育つ(どの部品も縮まない)", () => {
    let prev = ficusGrowth(0);
    for (let p = 0.01; p <= 1.0001; p += 0.01) {
      const g = ficusGrowth(p);
      for (const k of ["stem", "bladeX", "bladeY", "midrib"]) {
        expect(g[k], `${k} at ${p.toFixed(2)}`).toBeGreaterThanOrEqual(prev[k] - 1e-12);
      }
      g.veins.forEach((v, i) => expect(v, `vein${i} at ${p.toFixed(2)}`).toBeGreaterThanOrEqual(prev.veins[i] - 1e-12));
      prev = g;
    }
  });

  // 側脈は根元から先端へ**1対ずつ**。同時に4対出ると「育つ」に見えない。
  it("側脈は根元から順に引かれる", () => {
    const g = ficusGrowth(0.8);
    expect(g.veins[0]).toBe(1);
    expect(g.veins[1]).toBeGreaterThan(0);
    expect(g.veins[1]).toBeLessThan(1);
    expect(g.veins[2]).toBe(0);
    expect(g.veins[3]).toBe(0);
  });

  it("範囲外は端に丸める", () => {
    expect(ficusGrowth(-1).midrib).toBe(0);
    expect(ficusGrowth(9).midrib).toBe(1);
    expect(ficusGrowth(undefined).stem).toBeCloseTo(0.15, 10);
  });
});

describe("置き場所(§1.11 / 遅延読み込みの前提)", () => {
  const FICUS = read("./LoadingFicus.jsx");
  const CSS = read("../index.css");

  // 【待つ画面が、待たせている当のものを読み込んではいけない】
  // App.jsx の Suspense の fallback がこの要素を描くので、ここが firebase を
  // 連れてくると遅延読み込みの意味が消える。
  it("LoadingFicus は React と loadProgress 以外を import しない", () => {
    const imports = [...FICUS.matchAll(/^import .*? from "(.+?)";/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./loadProgress.js", "react"]);
  });

  // 揺れ(待ちが長引いたときに止まって見えないための動き)は index.css だけが持つ。
  it("揺れの秒数と曲線は index.css にある", () => {
    expect(CSS).toMatch(/@keyframes ficus-grow-sway/);
    expect(CSS).toMatch(/\.ficus-grow\s*\{[\s\S]*?animation: ficus-grow-sway/);
    const code = FICUS.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/animation:/);
    expect(code).toMatch(/className="ficus-grow"/);
  });

  it("動きを減らす設定で揺れを止める", () => {
    const blocks = CSS.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) || [];
    const hit = blocks.filter((b) => /\.ficus-grow\b/.test(b));
    expect(hit.length, "揺れを止める指定が無い").toBeGreaterThan(0);
    expect(hit.join("")).toMatch(/animation: none/);
  });

  // 【脈は葉身の中だけ】icon.svg は脈を**地と同じ紺**で描いているので、
  // 葉からはみ出した分は地に溶けて見えない。白地のこちらでそのまま写すと
  // 葉の外に線が突き出る(実際に描いて気づいた)。切り抜きを外さないこと。
  it("脈を葉身で切り抜いている", () => {
    expect(FICUS).toMatch(/<clipPath id=\{clipId\}><path d=\{BLADE_D} \/><\/clipPath>/);
    expect(FICUS).toMatch(/<g clipPath=\{`url\(#\$\{clipId}\)`}>/);
    // 輪郭の綴りは1つ。塗りと切り抜きが別々の d を持つと、片方だけ直る。
    expect((FICUS.match(/d=\{BLADE_D}/g) || []).length).toBe(2);
    expect(FICUS).not.toMatch(/Q 46 38\.35[\s\S]*Q 46 38\.35/);
  });

  // 色は必ずトークンから引く(DESIGN-SYSTEM §1)。hex 直書きを増やさない。
  it("色を直書きしない", () => {
    expect(FICUS).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });
});
