import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beginLoad, loadPercent, loadFloor, ficusGrowth, resetLoadProgress } from "./loadProgress.js";
import { TIERS, TRUNK_D, VIEW_W, VIEW_H, SOIL_Y, LEAVES_PER_TIER, tierLeaves } from "./LoadingFicus.jsx";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const NL = String.fromCharCode(10); // 検査の中で改行を書くと、この行自体が壊れる
const FICUS = read("./LoadingFicus.jsx");
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

describe("ficus の育ち方(2026/09/10 本人指示・写真の株)", () => {
  it("0% では株がまだ何も出ていない", () => {
    const g = ficusGrowth(0);
    expect(g.trunk).toBe(0);
    expect(g.tiers.every((t) => t.branch === 0 && t.leaves === 0)).toBe(true);
  });

  // 実際に出しうる最大は 99%(100% は「終わった」の意味なので出さない)。
  // ここで完成しないと、育ちきった株は**一度も画面に出ない**。
  it("99% で株が完成する(%の頭打ちと揃える)", () => {
    const g = ficusGrowth(0.99);
    expect(g.trunk).toBe(1);
    for (const [i, t] of g.tiers.entries()) {
      expect(t.branch, `${i}段目の枝`).toBe(1);
      expect(t.leaves, `${i}段目の葉`).toBe(1);
    }
  });

  // 進捗が戻らない以上、株も縮まないこと。縮むと「読み込みが戻った」に見える。
  it("進むほど育つ(どこも縮まない)", () => {
    let prev = ficusGrowth(0);
    for (let p = 0.005; p <= 1.0001; p += 0.005) {
      const g = ficusGrowth(p);
      expect(g.trunk, `幹 at ${p.toFixed(3)}`).toBeGreaterThanOrEqual(prev.trunk - 1e-12);
      g.tiers.forEach((t, i) => {
        expect(t.branch, `枝${i} at ${p.toFixed(3)}`).toBeGreaterThanOrEqual(prev.tiers[i].branch - 1e-12);
        expect(t.leaves, `葉${i} at ${p.toFixed(3)}`).toBeGreaterThanOrEqual(prev.tiers[i].leaves - 1e-12);
      });
      prev = g;
    }
  });

  // 【本人の指示そのもの】「ロードが進むたびにこの巻いている幹が伸びていく」。
  // 房が幹より先に出ると、**枝が宙に浮く**。
  it("房は下から順に、幹が伸びた分だけ開く", () => {
    const g = ficusGrowth(0.55);
    expect(g.trunk).toBeGreaterThan(0.5);
    expect(g.tiers[0].leaves).toBe(1);
    expect(g.tiers[1].leaves).toBeGreaterThan(0);
    expect(g.tiers[1].leaves).toBeLessThan(1);
    expect(g.tiers[2].leaves).toBe(0);
    expect(g.tiers[3].leaves).toBe(0);
  });

  it("幹が伸びきってから樹冠が開く", () => {
    const g = ficusGrowth(0.72);
    expect(g.trunk).toBe(1);
    expect(g.tiers[3].leaves).toBe(0);
  });

  it("範囲外は端に丸める", () => {
    expect(ficusGrowth(-1).trunk).toBe(0);
    expect(ficusGrowth(9).trunk).toBe(1);
    expect(ficusGrowth(undefined).trunk).toBe(0);
  });
});

// 【枠から出ていないか】樹冠を枠の外へ出しかけた(葉の先が上で切れる)。
// 絵では気づきにくいので、葉の外接矩形をここで計算して確かめる。
describe("絵が枠に収まっている", () => {
  // 傾いた楕円の外接矩形。半径 len/2 が葉の向き、half がそれと直角。
  const bbox = ([x, y, deg, len, half]) => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s2 = Math.sin(a);
    const cx = x + (len / 2) * c, cy = y + (len / 2) * s2;
    const ex = Math.hypot((len / 2) * c, half * s2);
    const ey = Math.hypot((len / 2) * s2, half * c);
    return [cx - ex, cy - ey, cx + ex, cy + ey];
  };

  // 【枚数を変えても枠に収まること】葉は枚数から組み立てるので、1房を何枚に
  // しても端の葉が枠から出てはいけない。房の開きに上限(FAN_MAX_DEG)を置いて
  // あるのはこのため ── 上限が無いと、枚数を増やしたとき端の葉が真下を向いて
  // 鉢へ突っ込む。1〜5枚まで全部を確かめる。
  it("葉はどれも枠の中にある(1〜5枚のどれでも)", () => {
    for (let n = 1; n <= 5; n++) {
      for (const [ti, tier] of TIERS.entries()) {
        for (const [li, leaf] of tierLeaves(tier.branch, n).entries()) {
          const [x0, y0, x1, y1] = bbox(leaf);
          const where = `${n}枚 / ${ti}段目の${li}枚目 [${x0.toFixed(1)}, ${y0.toFixed(1)}, ${x1.toFixed(1)}, ${y1.toFixed(1)}]`;
          expect(x0, where).toBeGreaterThanOrEqual(0);
          expect(y0, where).toBeGreaterThanOrEqual(0);
          expect(x1, where).toBeLessThanOrEqual(VIEW_W);
          // 【土より下へ垂れない】下は切り抜きで消えるので、はみ出すと葉が欠ける。
          expect(y1, where).toBeLessThanOrEqual(SOIL_Y);
        }
      }
    }
  });

  // 【1つの房は3枚まで 2026/09/12 本人指示】27枚は「葉の数が多すぎる」。
  // 房を濃くするのではなく、足したくなったら**房を1つ足す**(TIERS に1行)。
  // 3枚は「左右へ開いて、間から幹が見える」限界の枚数でもある。
  it("1つの房に葉は3枚まで", () => {
    expect(LEAVES_PER_TIER).toBeLessThanOrEqual(3);
    expect(LEAVES_PER_TIER).toBeGreaterThan(0);
    for (const tier of TIERS) {
      expect(tierLeaves(tier.branch).length).toBe(LEAVES_PER_TIER);
    }
  });

  // 【房の開きには上限がある】枚数を増やしても扇が回りきらないこと。
  // 上限が無いと、枚数を上げたとき端の葉が真下や真上を向いて、房が
  // 「扇」ではなく「花火」になる(枠に収まるかどうかとは別の話)。
  it("房の開きは 110°を超えない", () => {
    for (const n of [2, 3, 5, 8]) {
      const angles = tierLeaves(TIERS[0].branch, n).map((l) => l[2]);
      const width = Math.max(...angles) - Math.min(...angles);
      expect(width, `${n}枚で ${width.toFixed(0)}°`).toBeLessThanOrEqual(110.0001);
    }
  });

  // 【枚数は1箇所で決める】房ごとに枚数を書けるようにすると、また房が濃くなる。
  it("葉の座標を手で置いていない", () => {
    const table = FICUS.slice(FICUS.indexOf("export const TIERS"), FICUS.indexOf("export const LEAVES_PER_TIER"));
    expect(table).not.toMatch(/leaves:/);
    expect(table.match(/branch: \[/g).length).toBe(TIERS.length);
  });

  // 房の数が育ちの段取りと合っていないと、g.tiers[ti] が undefined になって落ちる。
  it("房の数が育ちの段取りと一致する", () => {
    expect(TIERS.length).toBe(ficusGrowth(1).tiers.length);
  });

  // 【房は左右交互に出す】同じ側へ続けて出すと株が片側へ傾いて見える。
  // いちばん上も「片側へ出る房」(2026/09/13 本人指示で上・左・右の放射をやめた)。
  it("房は左右交互に出る", () => {
    const side = TIERS.map(({ branch: [ax, , bx] }) => Math.sign(bx - ax));
    expect(side.every((v) => v !== 0), "真上か真下へ出る枝がある").toBe(true);
    for (let i = 1; i < side.length; i++) {
      expect(side[i], `${i}段目が ${i - 1}段目と同じ側`).not.toBe(side[i - 1]);
    }
  });

  // 【株は土の高さで切る】鉢は塗らない輪郭なので、切らないと幹の丸い先端が
  // 空の鉢の中に浮いて見える(本人評「下の幹が鉢よりも前に出ているように見える」)。
  // 鉢を**株より後に**描くのも同じ理由 ── 先に描くと口の罫を幹が跨ぐ。
  it("株を土の高さで切り、鉢を後に描く", () => {
    expect(FICUS).toContain('<rect x="0" y="0" width={VIEW_W} height={SOIL_Y} />');
    expect(FICUS).toContain("<g clipPath={`url(#${clipId})`}>");
    expect(FICUS.indexOf("d={POT_D}"), "鉢が株より先に描かれている")
      .toBeGreaterThan(FICUS.indexOf("clipPath={`url"));
  });
});

describe("置き場所(§1.11 / 遅延読み込みの前提)", () => {

  // 【待つ画面が、待たせている当のものを読み込んではいけない】
  // App.jsx の Suspense の fallback がこの要素を描くので、ここが firebase を
  // 連れてくると遅延読み込みの意味が消える。
  it("LoadingFicus は React と loadProgress 以外を import しない", () => {
    const imports = [...FICUS.matchAll(/^import .*? from "(.+?)";/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./loadProgress.js", "react"]);
  });

  // 【この絵は CSS の動きを1つも持たない 2026/09/13 本人指示】
  // 以前は株元を軸にした揺れ(ficus-grow-sway)を index.css に置いていたが、
  // 「左右に揺れるアニメーションを削除」で外した。**動くのは育つ株と数字だけ。**
  // ここが緩むと、また「止まって見えないから」と揺れが戻ってくる。
  it("揺れは残っていない", () => {
    // 【コメントを剥がしてから数える】外した理由を index.css に書き残してあり、
    // その説明文の中に綴りが出てくる。生のまま探すと**説明そのものを数える**
    // (この罠は pitch-test の codeOf() と firestore.rules で既に2度踏んでいる)。
    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/@keyframes ficus-grow-sway/);
    expect(css).not.toMatch(/\.ficus-grow\s*\{/);
    const code = FICUS.split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
    expect(code).not.toMatch(/ficus-grow/);
    expect(code).not.toMatch(/animation/);
    expect(code).not.toMatch(/@keyframes/);
  });

  // 【長さ 0 の枝を描かない】丸い先端は長さ 0 の破線も**点として描く**ので、
  // 素直に書くと株が伸びる前に枝の根元へ点が5つ浮かぶ(実際に出た)。
  it("伸びていない幹・枝は描かない", () => {
    expect(FICUS).toMatch(/function Stem\(\{ d, width, len \}\)/);
    expect(FICUS).toMatch(/if \(len <= 0\.001\) return null;/);
    const code = FICUS.split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
    // 幹も枝も Stem を通す。<path> で直に描くと、この番人を素通りする。
    expect(code).not.toMatch(/<path d=\{TRUNK_D}/);
    expect((code.match(/strokeDasharray=/g) || []).length, "破線を書く場所は Stem の中だけ").toBe(1);
    expect((code.match(/<Stem /g) || []).length).toBe(3);
  });

  // 【伸びは dashoffset ではなく dasharray で書く】「見せる長さ」をそのまま
  // 書けるので読み違えようがない。offset は「隠す長さ」なので符号を間違えやすい。
  it("幹も枝も dasharray で伸ばす", () => {
    const code = FICUS.split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
    expect(code).not.toMatch(/strokeDashoffset/);
    expect(code).toMatch(/strokeDasharray=\{grownDash\(len\)}/);
  });

  // 色は必ずトークンから引く(DESIGN-SYSTEM §1)。hex 直書きを増やさない。
  it("色を直書きしない", () => {
    expect(FICUS).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });

  // 【2026/09/11 本人指示「アイコンは単色で」】色は1つだけ。
  // 淡い段を足すと、小さく出したとき色の数だけが目に付いて姿が読めない。
  it("絵は色を1つしか使わない", () => {
    // 【2026/09/12 本人指示】絵は**%の数字と同じ色**。待っているあいだの絵が、
    // 待つことより目立ってはいけない。色の名前を書いてよい場所は INK ただ1つ。
    expect(FICUS).toMatch(/const INK = "var\(--c-ink-3\)";/);
    const used = [...FICUS.matchAll(/var\(--c-[a-z0-9-]+\)/g)].map((m) => m[0]);
    const uniq = [...new Set(used)].sort();
    // 出てよいのはこの2つだけ:
    //   --c-ink-3 = INK(唯一のインク)と、下に出る%の文字色。**同じ色**なので1つ
    //   --c-bg    = **葉と葉のあいだの隙間**。塗りではなく「地が透けている幅」で、
    //               これが無いと房の3枚が根元で融けて一塊になる(実際にそうなった)
    expect(uniq, `使っている色: ${uniq.join(" ")}`).toEqual(["var(--c-bg)", "var(--c-ink-3)"]);
    // INK の定義と%の文字色の2箇所だけ。絵の中で色を名指ししない。
    expect(used.filter((c) => c === "var(--c-ink-3)").length, "INK 以外で色を名指ししている").toBe(2);
    // 隙間は葉にだけ。幹や鉢に地の色を回すと、そこが「2色目」に見え始める。
    expect(used.filter((c) => c === "var(--c-bg)").length, "地の色を葉以外にも使っている").toBe(1);
    // 絵は FicusMark ただ1つ。%の数字を持つ LoadingFicus はその後ろなので外す。
    const draw = FICUS.slice(FICUS.indexOf("export function FicusMark"),
      FICUS.indexOf("export default function LoadingFicus"));
    expect(draw).not.toMatch(/var\(--c-/);
    // 【透かすのも「2色目」】opacity で濃淡を作らない。Leaf は FicusMark より
    // 前に居るので、ここは**ファイル全体**を見ること(切り出すと素通りする)。
    const code = FICUS.split(NL).filter((l) => !l.trim().startsWith("//")).join(NL);
    expect(code).not.toMatch(/opacity/);
  });

  // 【鉢は塗らない】単色のまま実物の白い鉢を出すための唯一の手。
  // 塗ると株と一体の塊になり、鉢なのか土なのか読めなくなる。
  it("鉢は輪郭で描く", () => {
    expect(FICUS).toMatch(/fill="none" stroke=\{INK} strokeWidth="2\.4"/);
  });
});
