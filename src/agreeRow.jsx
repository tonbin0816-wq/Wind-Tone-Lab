import React from "react";

// ------------------------------------------------------------------
// 【便CB 2026-10-08】規約への同意の部品。置き場所を CommunityTab.jsx からここへ移した(中身は1文字も変えていない)。
// 起動の最初の同意の画面(ConsentScreen.jsx)と参加のカード(CommunityTab.jsx の JoinIntro)の2つが読む。
// CommunityTab.jsx は firebase を読むので遅延読み込みの向こうにある ── 起動の最初の画面がそこから import すると、
// 待たせたくない firebase まで最初に読むことになる。このファイルは React しか読まない。
// ------------------------------------------------------------------

// 文章の中のリンクの見た目をした <button>。JoinIntro の規約・ポリシー用(押すとシートが開く)。
// 以前の <a>(色だけ指定・下線はブラウザ既定)と同じ見え方にする。文字の大きさは行(noteStyle)を継ぐ。
export const linkButtonStyle = {
  background: "none", border: "none", padding: 0, font: "inherit",
  color: "var(--c-accent)", textDecoration: "underline", cursor: "pointer",
};

// 【便BC 2026-09-25 本人選定 ficus-block-mock.html「4. 参加の画面」】規約への同意のチェック。
// 行全体が押せる <label>(高さ --tap-min)。中身はネイティブの checkbox なので読み上げはそのまま
// 「チェックボックス・オン/オフ」。見た目だけ appearance を外して描き直す:
// 箱 20px・角丸 6px・枠 1.5px --c-line-strong(モック .box の値)/ 入ると --c-accent の塗りに白いレ点。
// 13歳以上の CheckRow(ネイティブの見た目 18px)とは別の部品 ── あちらは本人が見た目を決めていないので触らない。
export const AGREE_BOX_PX = 20;
export function AgreeRow({ checked, onChange, children }) {
  return (
    <label className="sans no-select" style={{
      minHeight: "var(--tap-min)", display: "flex", alignItems: "center", gap: "var(--sp-2)",
      fontSize: "var(--fs-sm)", color: "var(--c-ink)", cursor: "pointer",
    }}>
      <span style={{ position: "relative", flex: "none", width: AGREE_BOX_PX, height: AGREE_BOX_PX, display: "inline-flex" }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
          style={{
            appearance: "none", WebkitAppearance: "none", margin: 0, boxSizing: "border-box",
            width: AGREE_BOX_PX, height: AGREE_BOX_PX, borderRadius: 6, cursor: "pointer",
            border: `1.5px solid ${checked ? "var(--c-accent)" : "var(--c-line-strong)"}`,
            background: checked ? "var(--c-accent)" : "transparent",
          }} />
        {checked ? (
          <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20" width={AGREE_BOX_PX} height={AGREE_BOX_PX}
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ position: "absolute", inset: 0, pointerEvents: "none", color: "var(--c-on-accent)" }}>
            <polyline points="5.5,10.5 8.5,13.5 14.5,7" />
          </svg>
        ) : null}
      </span>
      <span>{children}</span>
    </label>
  );
}
