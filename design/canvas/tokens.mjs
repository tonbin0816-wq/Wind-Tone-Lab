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
//
// 【便BF 2026-10-01 統括指示】写しのズレを index.css に揃え、欠けていた鍵も全部写した。
// 揃える前にずれていたのは7つ(写し → 正): --r-xs 4 → 8 / --r-lg 16 → 12(便C の角丸3段化)/
// --sp-6 24 → 20 / --sp-8 32 → 20(便C の余白5段化)/ --c-rank-1 #C79A3E → #B08A2E /
// --c-rank-2 #9BA6B4 → #77808B / --c-rank-3 #A9743E → #9A5330(2026/09/10 案G)。
// 欠けていた17(--font-serif --r-1 --r-2 --r-full --d-* --lh-* --c-rank-1-base --c-warn-bg --nav-h
// --page-*)も足した。**写しは index.css と同じ形**(段 + 旧名は段を指す別名)── 実値を平らに並べると
// 段を片方だけ動かせてしまう。index.css の :root を触ったら、同じ周でここを写し、6つの生成器
// (generate / community / detail / rankcolor / rankshine / unify)を全部走らせること。
// 写しの実値が index.css と一致することは pitch-test の 便BF の節が突き合わせる。
// 【便BL 2026-10-02】--ad-h(下部タブの上の広告の帯の高さ)を写し、--page-bottom-gap に足した。
// キャンバスは帯の無い姿(0px)を描く。50px になるのは index.css の :root[data-ad-preview="1"] だけで、写しには持たない。
// 【便BP 2026-10-03】--c-coach-dim(はじめの一手の暗幕。--c-ink の 46%)を写した。キャンバスの画面はまだ使っていない。
// 【便BT 2026-10-03 本人裁定】--page-max-w(案Aの列 640)/ --pane-max-w(2ペインの器 1000)を写した。キャンバスは 375 の画面だけを描くので、どの画面もまだ使っていない。
export const TOKENS = `
    :root {
      --font-jp: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "BIZ UDPGothic", "Noto Sans JP", sans-serif;
      --font-num: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      --font-serif: "Instrument Serif", serif;
      --fs-xs: 12px; --fs-sm: 13px; --fs-md: 15px; --fs-lg: 18px; --fs-xl: 22px;
      --fs-2xl: 28px; --fs-hero: 46px;
      --r-1: 8px; --r-2: 12px; --r-full: 999px;
      --r-xs: var(--r-1); --r-sm: var(--r-1); --r-md: var(--r-2); --r-lg: var(--r-2); --r-pill: var(--r-full);
      --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px;
      --sp-6: var(--sp-5); --sp-8: var(--sp-5);
      --d-fast: 120ms; --d-base: 200ms; --d-slow: 320ms;
      --lh-tight: 1.3; --lh-base: 1.6; --lh-loose: 1.75;
      --tap-min: 44px;
      --c-bg: #FFFFFF; --c-surface: #FFFFFF; --c-sunk: #F6F7F9; --c-sunken: #EEF1F4;
      --c-rule: #E1E6EC;
      --c-ink: #121F32; --c-ink-2: #435266; --c-ink-3: #8D95A1; --c-ink-4: #A6AEBA;
      --c-line: #E9ECF0; --c-line-strong: #C3CAD3;
      --c-accent: #174585; --c-accent-mid: #7FA0CE; --c-accent-dim: #9DB3CC;
      --c-accent-line: #B9C9E4; --c-accent-tint: #EAEFF5;
      --c-on-accent: #FFFFFF; --c-on-accent-dim: #B9C9E4;
      --c-rank-1: #B08A2E; --c-rank-2: #77808B; --c-rank-3: #9A5330; --c-rank-1-base: #896C24;
      --c-avatar-1: #174585; --c-avatar-2: #3E6E8E; --c-avatar-3: #2F6F5E;
      --c-avatar-4: #6B7A3F; --c-avatar-5: #9A6B2F; --c-avatar-6: #A8543C;
      --c-avatar-7: #7D4A6B; --c-avatar-8: #5B5FA3; --c-avatar-9: #4A5567;
      --c-avatar-10: #2C3542;
      --c-disabled: #B7BFC9; --c-danger: #DC2626;
      --c-good: #16A34A; --c-warn: #D97706; --c-bad: #DC2626; --c-warn-bg: #FDF0E1;
      --c-div-1: #43719F; --c-div-2: #658BB1; --c-div-3: #89A6C3; --c-div-4: #B3C6D9;
      --c-div-5: #E2D0A3; --c-div-6: #D1B570; --c-div-7: #C39F45; --c-div-8: #B5891C;
      --c-quiet: #C7CFD9;
      --shadow-card: 0 1px 2px rgba(18, 31, 50, .04), 0 6px 16px rgba(18, 31, 50, .06);
      --shadow-row: 0 1px 2px rgba(18, 31, 50, .04), 0 6px 16px rgba(18, 31, 50, .06);
      --shadow-seg: 0 1px 2px rgba(18, 31, 50, .08), 0 2px 6px rgba(18, 31, 50, .06);
      --c-coach-dim: rgba(18, 31, 50, .46);
      --nav-h: 47px;
      --ad-h: 0px;
      --page-bottom-gap: calc(var(--nav-h) + var(--ad-h) + env(safe-area-inset-bottom));
      --page-side-pad: 14px;
      --page-pad-left: calc(var(--page-side-pad) + env(safe-area-inset-left));
      --page-pad-right: calc(var(--page-side-pad) + env(safe-area-inset-right));
      --page-max-w: 640px;
      --pane-max-w: 1000px;
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
