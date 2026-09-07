// キャンバスのアートボードが使うトークン。**src/index.css の :root の写し。**
//
// 【1箇所に寄せた理由 2026/09/07】generate.mjs が自前で持っていた写しは
// My Data が使う分だけの部分集合で、`--c-sunken` `--r-lg` `--shadow-card`
// `--c-rank-*` `--c-avatar-*` を持っていなかった。コミュニティの画面は
// それらを使うので、2つ目の写しを作るのではなく上位集合を1つ置いて両方から読む。
// **未定義のカスタムプロパティは transparent 扱いになり、黙って消える。**
// 過去に同じ事故(カレンダーの薄い段が消えた)を1度起こしている。
//
// 値を足すときは index.css から写すこと。ここで新しい値を発明しない。
export const TOKENS = `
    :root {
      --font-jp: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "BIZ UDPGothic", "Noto Sans JP", sans-serif;
      --font-num: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      --fs-xs: 12px; --fs-sm: 13px; --fs-md: 15px; --fs-lg: 18px; --fs-xl: 22px;
      --fs-2xl: 28px; --fs-hero: 46px;
      --r-xs: 4px; --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-pill: 999px;
      --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px; --sp-6: 24px; --sp-8: 32px;
      --tap-min: 44px;
      --c-bg: #FFFFFF; --c-surface: #FFFFFF; --c-sunk: #F6F7F9; --c-sunken: #EEF1F4;
      --c-rule: #E1E6EC;
      --c-ink: #121F32; --c-ink-2: #435266; --c-ink-3: #8D95A1; --c-ink-4: #A6AEBA;
      --c-line: #E9ECF0; --c-line-strong: #C3CAD3;
      --c-accent: #174585; --c-accent-mid: #7FA0CE; --c-accent-dim: #9DB3CC;
      --c-accent-line: #B9C9E4; --c-accent-tint: #EAEFF5;
      --c-on-accent: #FFFFFF; --c-on-accent-dim: #B9C9E4;
      --c-rank-1: #C79A3E; --c-rank-2: #9BA6B4; --c-rank-3: #A9743E;
      --c-avatar-1: #174585; --c-avatar-2: #3E6E8E; --c-avatar-3: #2F6F5E;
      --c-avatar-4: #6B7A3F; --c-avatar-5: #9A6B2F; --c-avatar-6: #A8543C;
      --c-avatar-7: #7D4A6B; --c-avatar-8: #5B5FA3; --c-avatar-9: #4A5567;
      --c-avatar-10: #2C3542;
      --c-disabled: #B7BFC9; --c-danger: #DC2626;
      --c-good: #16A34A; --c-warn: #D97706; --c-bad: #DC2626;
      --c-div-1: #43719F; --c-div-2: #658BB1; --c-div-3: #89A6C3; --c-div-4: #B3C6D9;
      --c-div-5: #E2D0A3; --c-div-6: #D1B570; --c-div-7: #C39F45; --c-div-8: #B5891C;
      --c-quiet: #C7CFD9;
      --shadow-card: 0 1px 2px rgba(18, 31, 50, .04), 0 6px 16px rgba(18, 31, 50, .06);
      --shadow-row: 0 1px 2px rgba(18, 31, 50, .04), 0 6px 16px rgba(18, 31, 50, .06);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { margin: 0; background: var(--c-bg); font-family: var(--font-jp); font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; }
    a { color: var(--c-accent); } a:hover { color: #123A70; }`;

// .dc.html の外枠。中身(body)だけが画面ごとに変わる。
export function dcFile(body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>${TOKENS}
  </style>
</helmet>
${body}
</x-dc>
</body>
</html>
`;
}
