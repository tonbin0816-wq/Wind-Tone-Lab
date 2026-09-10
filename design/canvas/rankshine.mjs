// 順位色の第2案(2026/09/10)。「案Cも金と銅の色が近い」「光っているように見える
// グラデーションと簡単なアニメーションを入れて」という本人の指摘への案。
//
//   node design/canvas/rankshine.mjs
//
// 【なぜ近くなるのか】金を暗くすると茶色へ向かうので、暗くするほど銅に寄る。
// 現状も案Cも**色相差は 10°しかない**。明度だけで基準を満たそうとする限り、この距離は縮む。
// そこで2つ足す:
//   (1) 銅を赤銅へ寄せて色相を離す(10° → 22°)
//   (2) 金だけを光らせて、色以外の手がかりを1つ増やす
//
// 【光らせても基準を割らない作り】光る = 明るくなる、なので素直にやると
// 光の帯が 3:1 を割る(実測: よくある明るい金 #E3C874 は 1.64:1)。
// **土台を暗くして、光の山を 3.22:1 に着地させる**と、全域で 3:1 以上を保てる。
//   山 #B08A2E 3.22:1 / 土台 #896C24 4.96:1
// 比の数字はすべてこの場で計算している(下の contrast())。
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dcFile } from "./tokens.mjs";

const OUT = fileURLToPath(new URL("./", import.meta.url));

const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a) => {
  const x = lum(a), y = lum("#FFFFFF");
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const hueOf = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((x * 60 + 360) % 360);
};

// 山(明るい側)と土台(暗い側)の対。山のほうが 3:1 の境目に近い。
const P = {
  gold:   { top: "#B08A2E", base: "#896C24" },
  silver: { top: "#77808B", base: "#5D646C" },
  bronze: { top: "#9A5330", base: "#784125" },
};
const NAME = { gold: "1位 金", silver: "2位 銀", bronze: "3位 銅" };
const AV = { gold: "var(--c-avatar-1)", silver: "var(--c-avatar-3)", bronze: "var(--c-avatar-5)" };
const WHO = { gold: "たけし", silver: "みさき", bronze: "ゆうと" };
const DAYS = { gold: 24, silver: 21, bronze: 19 };
const ORDER = ["gold", "silver", "bronze"];

const NOTE = "font-size: var(--fs-xs); color: var(--c-ink-2); line-height: 1.6";
const CAP = "font-size: 10px; font-weight: 600; letter-spacing: .08em; color: var(--c-ink-3)";

// 【動きの作り】背景を3倍に伸ばして位置を送るだけ。要素の数も形も変わらないので、
// 走っている間に版が組み直されない(transform/opacity と同じ扱いで済む)。
// **止まっている時間を長く取る**(60% で行き着いて、残り 40% は動かない)。
// 順位表は読むための画面なので、目が引かれ続けると数字が読みにくくなる。
const STYLE = `
    /* 【割合の効く範囲は 0%〜100% ── 実測で踏んだ】背景位置の割合は
       「画像の x% の点を、器の x% の点に合わせる」という意味なので、
       画像が器の3倍なら 0% で左端そろえ・100% で右端そろえ。**その外を指定すると
       繰り返しの模様が出るだけで、光の帯は窓を通らない。**
       最初 220% → -120% と書いて、動いてはいるのに何も光らなかった。 */
    @keyframes ficus-shine-x { 0% { background-position: 0% 0; } 55%, 100% { background-position: 100% 0; } }
    /* 帯は幅 4px の縦長。横に掃いても一度に1色しか出ないので、**縦に掃く**。 */
    @keyframes ficus-shine-y { 0% { background-position: 0 0%; } 55%, 100% { background-position: 0 100%; } }
    /* 【動きを止める設定を尊重する】§1.11 の作法。止めたら光の山の位置で固定する
       (真っ黒や真っ平らにしない ── 色そのものは動きと無関係に成立している)。 */
    @media (prefers-reduced-motion: reduce) {
      .shine-x, .shine-y, .once-x, .once-y {
        animation: none !important; background-position: 50% 50% !important;
      }
      .ring-spin, .ring-spin-once { animation: none !important; }
    }
    /* 伸ばす指定(background-size)は**インライン側**が持つ。ここに書くと
       インラインの背景指定に打ち消される。class は動きだけを持つ。 */
    /* 【環は回す ── 実測で踏んだ】環は 3px の縁しか見えない。横に掃く光は
       **真ん中(= アバターの裏)を通る**ので、縁には base しか出ず何も光らなかった。
       円には円の掃き方が要る: 角度で色が変わる conic-gradient を敷いて、
       **その層だけを回す**(アバターは別の層に置くので一緒に回らない)。 */
    @keyframes ficus-spin { to { transform: rotate(360deg); } }
    .ring-spin { animation: ficus-spin 3.6s linear infinite; }
    .ring-spin-once { animation: ficus-spin 1.8s ease-out 1 both; }
    .shine-x { animation: ficus-shine-x 3.4s ease-in-out infinite; }
    .shine-y { animation: ficus-shine-y 3.4s ease-in-out infinite; }
    .once-x { animation: ficus-shine-x 1.6s ease-out 1 both; }
    .once-y { animation: ficus-shine-y 1.6s ease-out 1 both; }`;

// 光る面の背景。山を挟んで両側が土台。
//
// 【`background:` の短縮形で書かない ── 実測で踏んだ】インラインの短縮形は
// background-size を auto へ戻すので、class 側の `background-size: 300%` が
// 打ち消される。**動いてはいるのに伸びていない**という、絵では気づきにくい壊れ方をした。
// だから伸ばす指定もインラインに置き、性質は `background-image` だけを上書きする。
const shineBg = (k, deg) =>
  `linear-gradient(${deg}, ${P[k].base} 0%, ${P[k].base} 30%, ${P[k].top} 50%, ${P[k].base} 70%, ${P[k].base} 100%)`;
// 光る面の style 断片(gradient と伸ばす指定を必ず対で置く)。
// axis "x" = 横に掃く(環のように横幅のある面) / "y" = 縦に掃く(帯のように縦長の面)。
const shineStyle = (k, axis) => axis === "y"
  ? `background-image: ${shineBg(k, "185deg")}; background-size: 100% 300%`
  : `background-image: ${shineBg(k, "100deg")}; background-size: 300% 100%`;
const flatStyle = (k) => `background: ${P[k].top}`;

// 環はグラデーションを掛けられない(box-shadow は単色)ので、**色を敷いた層**を
// 3px 大きく置き、その上にアバターを重ねる。
// 光らせるときは色の層に conic-gradient を敷いて**その層だけを回す**
// (アバターは別の層なので一緒に回らない)。
function avatar(k, size, cls) {
  const outer = size + 6;
  const conic = `conic-gradient(from 0deg, ${P[k].base} 0deg, ${P[k].top} 40deg, ${P[k].base} 110deg, ${P[k].base} 180deg, ${P[k].top} 220deg, ${P[k].base} 290deg, ${P[k].base} 360deg)`;
  const spin = cls === "shine" ? "ring-spin" : cls === "once" ? "ring-spin-once" : null;
  return `<span style="position: relative; width: ${outer}px; height: ${outer}px; flex-shrink: 0; display: inline-block">
            <span ${spin ? `class="${spin}"` : ""} style="position: absolute; inset: 0; border-radius: 999px; ${cls ? `background: ${conic}` : flatStyle(k)}"></span>
            <span style="position: absolute; inset: 3px; border-radius: 999px; background: ${AV[k]}"></span>
          </span>`;
}

function row(k, big, cls) {
  const av = big ? 56 : 34;
  return `        <div style="position: relative; overflow: hidden; background: var(--c-surface); border-radius: var(--r-lg); box-shadow: var(--shadow-card); padding: ${big ? "14px" : "10px 14px"}; display: flex; align-items: center; gap: var(--sp-3); margin-bottom: 8px">
          <span ${cls ? `class="${cls}-y"` : ""} style="position: absolute; left: 0; top: 0; bottom: 0; width: 4px; ${cls ? shineStyle(k, "y") : flatStyle(k)}"></span>
          <span style="width: 22px; text-align: center; flex-shrink: 0; font-family: var(--font-num); font-weight: 700; font-size: ${big ? "var(--fs-2xl)" : "var(--fs-md)"}; color: var(--c-ink)">${ORDER.indexOf(k) + 1}</span>
          ${avatar(k, av, cls)}
          <span style="flex: 1 1 0; min-width: 0; font-size: ${big ? "var(--fs-lg)" : "var(--fs-sm)"}; font-weight: 600; color: var(--c-ink)">${WHO[k]}</span>
          <span style="font-family: var(--font-num); font-weight: 700; font-size: ${big ? "var(--fs-2xl)" : "var(--fs-lg)"}; color: var(--c-ink)">${DAYS[k]}<span style="font-size: var(--fs-xs); font-weight: 600; color: var(--c-ink-3)">日</span></span>
        </div>`;
}

// 見比べ用の色見本。山と土台の両方の比を出す。
function swatches(keys, withBase) {
  return `        <div style="display: flex; gap: 8px; margin: 10px 0 6px">
${keys.map((k) => `          <div style="flex: 1 1 0; text-align: center">
            <div style="height: 26px; border-radius: var(--r-sm); ${withBase ? shineStyle(k, "x") : flatStyle(k)}"></div>
            <div style="font-family: var(--font-num); font-size: 11px; font-weight: 700; color: var(--c-good); margin-top: 4px">${contrast(P[k].top).toFixed(2)}:1${withBase ? ` 〜 ${contrast(P[k].base).toFixed(2)}` : ""}</div>
            <div style="font-size: 9px; color: var(--c-ink-3)">${P[k].top}${withBase ? ` / ${P[k].base}` : ""}</div>
          </div>`).join("\n")}
        </div>`;
}

function plan(id, note, cls, withBase) {
  return `      <div style="margin-bottom: 24px">
        <div style="${CAP}; margin-bottom: 6px">${id}</div>
${ORDER.map((k) => row(k, k === "gold", cls && k === "gold" ? cls : null)).join("\n")}
${swatches(ORDER, withBase)}
        <div style="${NOTE}">${note}</div>
      </div>`;
}

const gap = Math.abs(hueOf(P.gold.top) - hueOf(P.bronze.top));

const body = `<style>${STYLE}</style>
    <div style="width: 375px; background: var(--c-bg); padding: 14px; box-sizing: border-box">
      <div style="font-size: var(--fs-md); font-weight: 700; color: var(--c-ink)">順位色 ── 金と銅を離して、金を光らせる</div>
      <div style="${NOTE}; margin: 4px 0 6px"><b>金と銅が近いのは明度を下げたから。</b> 金は暗くすると茶色へ向かうので、基準を満たそうとするほど銅に寄る。現状も案Cも<b>色相差は 10°</b>しかない。</div>
      <div style="${NOTE}; margin-bottom: 14px">そこで2つ足した ── <b>銅を赤銅へ寄せて色相を ${gap}° に開く</b>／<b>金だけを光らせて色以外の手がかりを1つ増やす</b>。比の数字はこのページを作るときに計算した実測値。</div>

${plan("案F 色を離すだけ(動かない)", `銅を赤銅へ。金 ${contrast(P.gold.top).toFixed(2)}:1 / 銀 ${contrast(P.silver.top).toFixed(2)}:1 / 銅 ${contrast(P.bronze.top).toFixed(2)}:1 で<b>3色とも基準を満たす</b>。色相差は 10° → ${gap}°。<b>動きを足さなくても、これだけで金と銅は見分けられる。</b>`, null, false)}

${plan("案G 金がゆっくり光り続ける", `<b>光る = 明るくなるので、素直にやると基準を割る</b>(よくある明るい金 #E3C874 は 1.64:1)。そこで<b>土台を暗くして、光の山を ${contrast(P.gold.top).toFixed(2)}:1 に着地させた</b> ── いちばん明るい瞬間でも 3:1 を保つ。上の数字は「山 〜 土台」。<br>動きは背景の位置を送るだけで、要素の形は変わらない。<b>3.4秒のうち動くのは半分強で、残りは止まっている</b>(順位表は読む画面なので、目が引かれ続けると数字が読みにくい)。`, "shine", true)}

${plan("案H 開いたときに1回だけ光る", `同じ光を<b>1回で終わらせる</b>形。開いた瞬間に「1位はここ」と目を向けさせて、あとは静かになる。<br><b>このページを読み込み直すともう一度見られる。</b>`, "once", true)}

      <div style="${NOTE}"><b>動きを止めている端末では光らない。</b> OS の「視差効果を減らす」を入れている人には <code>prefers-reduced-motion</code> が届くので、その場合は光の山の位置で止める(色そのものは動きと無関係に成立しているので、止めても3色は見分けられる)。</div>
    </div>`;

writeFileSync(OUT + "RankShine.dc.html", dcFile(body));
console.log("RankShine.dc.html");
for (const k of ORDER) {
  console.log(`  ${NAME[k].padEnd(6)} 山 ${P[k].top} ${contrast(P[k].top).toFixed(2)}:1 / 土台 ${P[k].base} ${contrast(P[k].base).toFixed(2)}:1  色相 ${hueOf(P[k].top)}°`);
}
console.log(`  金と銅の色相差 ${gap}° (現状と案C は 10°)`);
