// 【便BO3 2026-10-03 統括の裁定】シートの中の主ボタンの標準。値は目安に設定のシートの「保存」・リード追加の「追加」
// (App.jsx)と同じ: 高さ --tap-min / --r-pill / 枠なし / 地 --c-accent / 字 --c-on-accent / --fs-md / 700 / 影なし。
// 幅いっぱいは、縦に積む「やめる」(SHEET_QUIET_BUTTON_STYLE)と同じ。
// 【便BS 2026-10-03】参加の画面のカードの「参加する」(CommunityTab.jsx の JoinIntro)も、この標準を読む(写しを作らない)。
// 【便CB 2026-10-08】置き場所を screens.jsx からここへ移した(値は1文字も変えていない)。起動の最初の同意の画面
// (src/ConsentScreen.jsx の「はじめる」)も読むため ── screens.jsx は遅延読み込みの向こう(コミュニティ)にあり、
// 起動の最初の画面がそこから import すると、待たせたくないコミュニティの部品まで最初に読むことになる。このファイルは何も import しない。
// screens.jsx はこれを import してそのまま export し直す(CommunityTab.jsx の読み口は変わらない)。
export const SHEET_PRIMARY_BUTTON_STYLE = {
  width: "100%", minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)", border: "none",
  background: "var(--c-accent)", color: "var(--c-on-accent)", fontSize: "var(--fs-md)", fontWeight: 700, cursor: "pointer",
};
