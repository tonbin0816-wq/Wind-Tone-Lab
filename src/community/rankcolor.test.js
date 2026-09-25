import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const CSS = read("../index.css");
const SCREENS = read("./screens.jsx");

// 【比は書き写さない。ここで計算する】WCAG 2.x の相対輝度の式そのまま。
// 値を写すと、色を直したときに検査だけが古い数字を守ってしまう。
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b = "#FFFFFF") => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const hueOf = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((x * 60 + 360) % 360);
};
const token = (name) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(CSS);
  expect(m, `--${name} が index.css に無い`).not.toBeNull();
  return m[1].toUpperCase();
};

describe("順位色(2026/09/10 本人裁定「案G」)", () => {
  // 色が乗るのは環3px と 左端の帯4px の2つだけ = **非文字の部品**。
  // WCAG 1.4.11 が求めるのは 3:1(4.5:1 は文字の基準なのでここには掛からない)。
  it("3色とも白地に 3:1 以上", () => {
    for (const n of ["c-rank-1", "c-rank-2", "c-rank-3"]) {
      const v = token(n);
      expect(contrast(v), `${n} ${v} は ${contrast(v).toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  // 【この検査がこの一連の要点】明度だけで 3:1 を満たそうとすると、
  // **金は暗くすると茶色へ向かうので銅に寄る**(前の3色は色相差 10°しかなく、
  // 本人に「金と銅の色が近い」と指摘された)。色相の距離そのものを守る。
  it("金と銅の色相が 18°以上 離れている", () => {
    const gap = Math.abs(hueOf(token("c-rank-1")) - hueOf(token("c-rank-3")));
    expect(gap, `色相差 ${gap}°`).toBeGreaterThanOrEqual(18);
  });

  // 【光っても 3:1 を割らない】光る = 明るくなるので、素直にやると割る。
  // 土台を暗くして**光の山を --c-rank-1 に着地させる**形にしてある。
  // 土台が山より明るくなると、いちばん明るい瞬間が 3:1 を割る。
  // 【便BC 2026-09-25 本人選定 モック「い」】1〜3位の数字は帯の中で白(--c-on-accent)。
  // 数字は太字 700 で 22px / 28px = WCAG の「大きい文字」(太字 18.66px 以上)なので、求められる比は 3:1。
  // 帯の色は 金(光の山)/ 帯の暗い側(光の土台)/ 銀 / 銅 の4つ。4つとも白に対して 3:1 以上であること。
  // 大きさは index.css の段から読む(写した数字を期待値にしない)。
  it("帯の中の白い数字は大きい文字に当たり、4色とも白と 3:1 以上", () => {
    const px = (name) => {
      const m = new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(CSS);
      expect(m, `--${name} が index.css に無い`).not.toBeNull();
      return Number(m[1]);
    };
    for (const n of ["fs-xl", "fs-2xl"]) expect(px(n), `--${n}`).toBeGreaterThanOrEqual(18.66);
    const band = /<span data-rank-band[\s\S]{0,900}?<\/span>/.exec(SCREENS);
    expect(band, "帯の記述が見つからない").not.toBeNull();
    expect(band[0]).toMatch(/fontWeight: 700/);
    expect(band[0]).toMatch(/fontSize: first \? "var\(--fs-2xl\)" : "var\(--fs-xl\)"/);
    expect(band[0]).toMatch(/color: rankColor \? "var\(--c-on-accent\)"/);
    const white = token("c-on-accent");
    for (const n of ["c-rank-1", "c-rank-1-base", "c-rank-2", "c-rank-3"]) {
      const v = token(n);
      expect(contrast(white, v), `白 on ${n} ${v} は ${contrast(white, v).toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it("光の土台は山(--c-rank-1)より暗い", () => {
    const top = token("c-rank-1"), base = token("c-rank-1-base");
    expect(contrast(base), `土台 ${base} ${contrast(base).toFixed(2)}:1 / 山 ${top} ${contrast(top).toFixed(2)}:1`)
      .toBeGreaterThan(contrast(top));
  });
});

describe("光の置き場(§1.11 時間と曲線は index.css だけが持つ)", () => {
  // 【便BC 2026-09-25 実装で踏んだ】帯の注記に1行足したとき、足した行を「*/」で閉じてしまい、
  // 元の注記の残りが CSS として読まれて **.rank-shine-bar の規則ごと効かなくなった**(1位の帯が白くなり、
  // 白い数字が見えなくなった)。下の検査は注記込みの文字列を見ていたので緑のままだった。
  // 注記を外した CSS で、規則が**規則の境目から**始まっていることを見る。
  it("光の規則は注記の外に生きている(注記を外した CSS で、規則の境目から始まる)", () => {
    const code = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\*\//);
    expect(code).toMatch(/\}\s*\.rank-shine-bar\s*\{\s*background-image: linear-gradient\(/);
    expect(code).toMatch(/\}\s*\.rank-shine-ring\s*\{\s*background: conic-gradient\(/);
  });

  it("動きの定義は index.css にある", () => {
    expect(CSS).toMatch(/@keyframes rank-shine-y/);
    expect(CSS).toMatch(/@keyframes rank-shine-spin/);
    expect(CSS).toMatch(/\.rank-shine-bar\s*\{[\s\S]*?animation: rank-shine-y/);
    expect(CSS).toMatch(/\.rank-shine-ring\s*\{[\s\S]*?animation: rank-shine-spin/);
  });

  // 【呼ぶ側は class を名乗るだけ】秒数も曲線も色も screens.jsx に書かない。
  // 書くと、動きの値が2箇所に散って片方だけ古くなる。
  it("screens.jsx は秒数も曲線も持たない", () => {
    const code = SCREENS.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).toMatch(/className="rank-shine-ring"/);
    expect(code).toMatch(/"rank-shine-bar"/);
    expect(code).not.toMatch(/animation:/);
    expect(code).not.toMatch(/@keyframes/);
  });

  // 【帯は background の短縮形を書かない】短縮形は background-size を auto へ戻すので、
  // index.css 側の「3倍に伸ばす」が打ち消され、**動いてはいるのに伸びていない**状態になる。
  // モックを作るときに実際に踏んだ。
  // 【便BC 2026-09-25 本人選定 モック「い」】帯は 44px になり、順位の数字(白)が中に入った。
  // 帯は自閉じの <span /> ではなくなったので、閉じタグまでを切り出して見る。
  it("光る帯に background の短縮形を書いていない", () => {
    const m = /className=\{first \? "rank-shine-bar"[\s\S]{0,900}?<\/span>/.exec(SCREENS);
    expect(m, "光る帯の記述が見つからない").not.toBeNull();
    const firstBranch = /first \? (\{[^}]*\}) :/.exec(m[0]);
    expect(firstBranch, "1位の枝の style が見つからない").not.toBeNull();
    expect(firstBranch[1]).toBe('{ flex: "0 0 44px" }');
    // 枝の外(共通の style)にも background を書かない(書くと1位の帯の光が打ち消される)
    const common = m[0].replace(/\.\.\.\(first \? \{[^}]*\} : \{[^}]*\}\),/, "");
    expect(common).not.toMatch(/\bbackground\b/);
  });

  // 【動きを止める設定を尊重する】§1.11。止めても色だけで3色は見分けられる。
  it("prefers-reduced-motion で止める", () => {
    const m = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g;
    const blocks = CSS.match(m) || [];
    const hit = blocks.filter((b) => /rank-shine-(bar|ring)/.test(b));
    expect(hit.length, "順位の光を止める指定が無い").toBeGreaterThan(0);
    expect(hit.join("")).toMatch(/animation: none/);
  });

  // 1位を立てるための光なので、**全員光ると意味が消える**。
  it("光るのは1位だけ(first のときだけ class を付ける)", () => {
    expect(SCREENS).toMatch(/first \? "rank-shine-bar" : undefined/);
    const ring = /\{first \? \([\s\S]{0,700}?\) : \(/.exec(SCREENS);
    expect(ring, "1位だけ環を分ける分岐が見つからない").not.toBeNull();
    expect(ring[0]).toMatch(/rank-shine-ring/);
  });
});
