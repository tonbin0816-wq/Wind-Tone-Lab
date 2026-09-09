// 統一の裁定に要る比較モック(2026/09/09)。design/UNIFY-AUDIT.md の B10 / C14-16 / D6 / D7。
//
//   node design/canvas/unify.mjs
//
// **これは提案ではなく「いま何種類あるか」を実寸で見せる絵。**寸法はすべて実測値で、
// 発明していない。実測は 2026/09/09 に Browser pane(375×812)で取った:
//   .app-root / .surf-card = 幅375・左右 padding 14 → 本文 347
//   My Data の .card       = 左端 14 / 幅 347 / 内側 315 → 文字の左端 30
//   リードタブ             = さらに左右 +10 → 本文 327 / 内側 295 → 文字の左端 40
//   コミュニティ           = さらに pageStyle の 16 → 本文 315 / 内側 283 → 文字の左端 46
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dcFile } from "./tokens.mjs";

const OUT = fileURLToPath(new URL("./", import.meta.url));
const CARD = "background: var(--c-surface); border-radius: var(--r-lg); padding: var(--sp-4); box-shadow: var(--shadow-card)";
const NOTE = "font-size: var(--fs-xs); color: var(--c-ink-2); line-height: 1.6";
const CAP = "font-size: 10px; font-weight: 600; letter-spacing: .08em; color: var(--c-ink-3)";

// ---- B10 ページ左右余白が3種 --------------------------------------------
// 目盛りの線を左に引いて、文字の左端が画面のどこに来るかを見えるようにする。
function pad(title, sidePad, extra, note) {
  const textLeft = sidePad + extra + 16;
  const drift = textLeft === 30 ? "基準" : `基準から +${textLeft - 30}px`;
  return `      <div style="${CAP}; margin-bottom: 6px">${title}　文字の左端 ${textLeft}px（${drift}）</div>
      <div style="position: relative; width: 375px; background: var(--c-sunk); padding: 10px 0">
        <!-- 基準(30px)からのずれを塗る。0 のときは幅0で消える -->
        <div style="position: absolute; left: 30px; top: 0; bottom: 0; width: ${textLeft - 30}px; background: var(--c-danger); opacity: .12"></div>
        <div style="position: absolute; left: ${textLeft}px; top: 0; bottom: 0; width: 1px; background: var(--c-danger); opacity: .55"></div>
        <div style="padding: 0 ${sidePad + extra}px">
          <div style="${CARD}">
            <div style="font-size: var(--fs-sm); font-weight: 700; color: var(--c-ink)">同じカード・同じ中身</div>
            <div style="${NOTE}; margin-top: 4px">${note}</div>
          </div>
        </div>
      </div>`;
}

const buildPad = () => `<div style="width: 375px; background: var(--c-bg); padding: 14px 0 18px; box-sizing: border-box">
      <div style="padding: 0 14px 12px">
        <div style="font-size: var(--fs-md); font-weight: 700; color: var(--c-ink)">B10 ページの左右余白が3種類</div>
        <div style="${NOTE}; margin-top: 4px">赤い線が<b>カードの中の文字の左端</b>。一番多い <b>30px</b> を基準にして、そこからの食い違いを薄い赤で塗ってある。</div>
      </div>
${pad("My Data・分析・セッション詳細・すべてのセッション", 14, 0, "根の 14px だけ。カードは本文いっぱい(347px)")}
      <div style="height: 14px"></div>
${pad("リードタブ", 14, 10, "REED_LIST_EXTRA_PAD_PX = 24 − 14 で +10px。本文 327px")}
      <div style="height: 14px"></div>
${pad("コミュニティタブ", 14, 16, "pageStyle が --sp-4 を足す。本文 315px")}
      <div style="padding: 16px 14px 0">
        <div style="${NOTE}"><b>子タブとカードの 16px は「ずれ」ではない。</b> コミュニティは子タブの文字が 30・カードの文字が 46 だが、My Data も 14 と 30 で<b>同じ 16px 差</b>。これはカード自身の余白で、どの画面にもある。コミュニティは<b>塊ごと 16px 右にある</b>だけ。</div>
      </div>
    </div>`;

// ---- C14-16 / D6 シートの形と閉じ方 --------------------------------------
// 実装にある4つの形をそのまま並べる。閉じ方は**見えない手も含めて**列挙する。
const SCRIM = "background: rgba(15,23,42,0.28)";
const SHEET = "background: var(--c-surface); box-shadow: 0 8px 24px rgba(15,23,42,0.18)";
const grip = `<span style="width: 36px; height: 4px; border-radius: 2px; background: var(--c-line-strong); display: block; margin: 0 auto 10px"></span>`;

function sheetForm(name, who, ways, body) {
  return `        <div>
          <div style="${CAP}">${name}</div>
          <div style="position: relative; width: 165px; height: 124px; border-radius: 8px; overflow: hidden; border: 1px solid var(--c-line); ${SCRIM}; margin: 5px 0 6px">
${body}
          </div>
          <div style="${NOTE}">${who}</div>
          <div style="${NOTE}; margin-top: 5px"><b>閉じ方</b>　${ways}</div>
        </div>`;
}
const GRID = "display: grid; grid-template-columns: 165px 165px; gap: 16px 17px; align-items: start";

const buildSheets = () => `<div style="width: 375px; background: var(--c-bg); padding: 14px; box-sizing: border-box">
      <div style="font-size: var(--fs-md); font-weight: 700; color: var(--c-ink)">C14-16 / D6 シートの形が4種類</div>
      <div style="${NOTE}; margin: 4px 0 14px">同じ「開いて選んで閉じる」なのに、位置・角丸・閉じ方が揃っていない。灰色が暗幕。</div>
      <div style="${GRID}">
${sheetForm("① 下寄せ + つまみ", "BottomSheet の5枚 ── データの選択 / セッションの編集 / リードの操作 / リード番号 / リードの追加",
  "つまみ・暗幕タップ・下スワイプ・Escape。<b>高さの上限あり</b>",
  `          <div style="position: absolute; left: 0; right: 0; bottom: 0; ${SHEET}; border-radius: 28px 28px 0 0; padding: 12px 14px 18px">
            ${grip}
            <div style="height: 8px; background: var(--c-sunken); border-radius: 4px; margin-bottom: 6px"></div>
            <div style="height: 8px; background: var(--c-sunken); border-radius: 4px; width: 70%"></div>
          </div>`)}
${sheetForm("② 下寄せ + つまみ無し", "目安に設定",
  "暗幕タップ・Escape・「やめる」。<b>下スワイプ無し</b>",
  `          <div style="position: absolute; left: 8px; right: 8px; bottom: 8px; ${SHEET}; border-radius: var(--r-lg); padding: 14px">
            <div style="height: 8px; background: var(--c-sunken); border-radius: 4px; margin-bottom: 6px"></div>
            <div style="height: 8px; background: var(--c-sunken); border-radius: 4px; width: 60%"></div>
          </div>`)}
${sheetForm("③ 中央", "リードの評価",
  "暗幕タップ・Escape・「完了」。<b>下スワイプもつまみも無し</b>",
  `          <div style="position: absolute; left: 14px; right: 14px; top: 50%; transform: translateY(-50%); ${SHEET}; border-radius: var(--r-lg); padding: 14px">
            <div style="height: 8px; background: var(--c-sunken); border-radius: 4px; margin-bottom: 6px"></div>
            <div style="height: 8px; background: var(--c-sunken); border-radius: 4px; width: 50%"></div>
          </div>`)}
${sheetForm("④ 全画面", "人をタップしたとき(コミュニティ)",
  "<b>左上の「&lt; 一覧」だけ。</b>暗幕もつまみも下スワイプも Escape も無い。重なり順も別(40 / 他は 60)",
  `          <div style="position: absolute; inset: 0; background: var(--c-bg); padding: 12px">
            <div style="display: inline-flex; align-items: center; height: 22px; padding: 0 10px; border-radius: var(--r-md); background: var(--c-sunken); color: var(--c-ink-2); font-size: 11px; font-weight: 600">&lt; 一覧</div>
            <div style="height: 8px; background: var(--c-sunken); border-radius: 4px; margin: 10px 0 6px"></div>
            <div style="height: 8px; background: var(--c-sunken); border-radius: 4px; width: 70%"></div>
          </div>`)}
      </div>
      <div style="${NOTE}; margin-top: 14px"><b>もう1枚、①の写しがある</b> ── バックアップのシートは①と同じ見た目を<b>別実装で持っている</b>。portal に出していないので、祖先に transform が乗ると暗幕が画面全体を覆わない。</div>
    </div>`;

// ---- D7 主要動作の置き場 --------------------------------------------------
const frame = (title, note, body) => `      <div style="margin-bottom: 16px">
        <div style="${CAP}">${title}</div>
        <div style="${NOTE}; margin: 3px 0 6px">${note}</div>
        <div style="position: relative; width: 200px; height: 150px; border-radius: 8px; overflow: hidden; border: 1px solid var(--c-line); background: var(--c-bg)">
${body}
        </div>
      </div>`;
const bar = (w, top) => `          <div style="position: absolute; left: 12px; top: ${top}px; width: ${w}px; height: 7px; background: var(--c-sunken); border-radius: 4px"></div>`;
const pill = (style, text) => `          <div style="position: absolute; ${style}; display: inline-flex; align-items: center; height: 22px; padding: 0 10px; border-radius: var(--r-pill); background: var(--c-accent); color: var(--c-on-accent); font-size: 11px; font-weight: 600">${text}</div>`;

const buildAction = () => `<div style="width: 375px; background: var(--c-bg); padding: 14px; box-sizing: border-box">
      <div style="font-size: var(--fs-md); font-weight: 700; color: var(--c-ink)">D7 「この画面の主要動作」の置き場が3箇所</div>
      <div style="${NOTE}; margin: 4px 0 14px">同じ役目のボタンが画面ごとに別の場所にある。紺が主要動作。</div>
${frame("① 右下に浮かせる", "リード個体詳細の「計測」",
  [bar(150, 14), bar(120, 30), bar(160, 60), bar(140, 76), pill("right: 12px; bottom: 12px", "計測")].join("\n"))}
${frame("② ヘッダの右", "セッション個別詳細の「★目安に設定」「編集」",
  [`          <div style="position: absolute; right: 12px; top: 12px; display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: var(--r-pill); border: 1px solid var(--c-line-strong); color: var(--c-accent); font-size: 10px; font-weight: 600">★ 目安に設定</div>`,
   bar(60, 14), bar(150, 46), bar(120, 62), bar(160, 92)].join("\n"))}
${frame("③ 本文の中", "人をタップしたときの「目安に設定」",
  [bar(150, 14), bar(120, 30), bar(160, 60), pill("left: 12px; top: 86px", "目安に設定"), bar(140, 120)].join("\n"))}
      <div style="${NOTE}; margin-top: 2px"><b>D8 も同じ形の揺れ</b> ── 保存した後、コミュニティだけ画面を移る(マイページへ)。セッションの編集・リードの評価・目安の設定・人物紹介の目安設定は<b>その場に留まる</b>。</div>
    </div>`;

for (const [name, build, label] of [
  ["UnifyPad.dc.html", buildPad, "B10 ページ左右余白が3種"],
  ["UnifySheet.dc.html", buildSheets, "C14-16/D6 シートの形が4種"],
  ["UnifyAction.dc.html", buildAction, "D7 主要動作の置き場が3箇所"],
]) {
  writeFileSync(OUT + name, dcFile(build()));
  console.log(`${name.padEnd(22)} ${label}`);
}
