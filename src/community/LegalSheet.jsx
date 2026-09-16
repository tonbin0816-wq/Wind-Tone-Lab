import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { BACK_BUTTON_STYLE, BottomSheet } from "../App.jsx";
import { PRIVACY_URL, TERMS_URL } from "../support.js";

// ------------------------------------------------------------------
// 利用規約・プライバシーポリシーを**アプリの中で**読むシート。
//
// 【C11・C12 2026-09-16 実機の指摘】以前は NavRow / JoinIntro のリンクが target="_blank" で
// public/terms.html を開いていたが、本人の実機では同じ画面で開き(SPA から離れる)、戻ると
// SPA が再起動して計測タブの useEffect がマイクの許可を求め、応答しなくなった(見立て)。
// **アプリの外へ出ない**ことで戻る手段(C11)と再起動の経路(C12)を1つで消す。
//
// 【文の正は public の terms.html / privacy.html の1つ】同じ origin の静的 HTML を fetch し、<body> の中身を描く。
// (行コメントに「スラッシュ + アスタリスク」の綴りを書かないこと。検査の codeOf() がブロックコメントの
//  開始と読み、下の実装を丸ごと消す。BottomSheet の注記と同じ罠。)
// ここに文を写さない(ストア審査の URL として public/ の2枚はそのまま残す)。
// 体裁は index.css の .legal-doc(legal.css の**スコープ付きの写し**。legal.css は body/h1 など
// 素の要素セレクタなので、アプリには読み込めない)。
// ------------------------------------------------------------------

const DOC = {
  terms: { path: TERMS_URL, label: "利用規約" },
  privacy: { path: PRIVACY_URL, label: "プライバシーポリシー" },
};

// 取得結果はモジュール内に持つ。2回目は即時(同じセッションの中で文が変わることは無い)。
const cache = new Map();

// <body> の中身から、文書末尾の「← Ficus に戻る」(.back)を除く。**アプリの中では戻る先が無い**
// (シートを閉じれば元の画面)ので、残すと押しても意味の無い行になる。
// .back を包む <p> が空になったら、それも除く(空の段落の余白が残らないように)。
export function extractLegalBody(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.body.querySelectorAll(".back")) {
    const parent = el.parentElement;
    el.remove();
    if (parent && parent.tagName === "P" && parent.textContent.trim() === "") parent.remove();
  }
  return doc.body.innerHTML;
}

export async function loadLegalHtml(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const res = await fetch(DOC[kind].path);
  if (!res.ok) throw new Error(`legal ${kind}: ${res.status}`);
  const html = extractLegalBody(await res.text());
  cache.set(kind, html);
  return html;
}

// CommunityTab.jsx の errorStyle と同値(あちらは export していない。import すると循環参照)。
const errorStyle = { fontSize: "var(--fs-sm)", color: "var(--c-danger)", lineHeight: 1.6 };

/**
 * @param kind "terms" | "privacy"
 * @param onClose 閉じる(× / つまみ / Esc / 暗幕タップ。後ろ3つは BottomSheet が持つ)
 */
export default function LegalSheet({ kind, onClose }) {
  const [state, setState] = useState(() => (cache.has(kind) ? { html: cache.get(kind) } : { loading: true }));
  useEffect(() => {
    let alive = true;
    if (cache.has(kind)) { setState({ html: cache.get(kind) }); return undefined; }
    setState({ loading: true });
    loadLegalHtml(kind)
      .then((html) => { if (alive) setState({ html }); })
      .catch(() => { if (alive) setState({ error: true }); });
    return () => { alive = false; };
  }, [kind]);

  return (
    <BottomSheet ariaLabel={DOC[kind].label} onClose={onClose}>
      {/* 【先頭に閉じる手段】左上。44×44・地なし(BACK_BUTTON_STYLE と同じ考え)。
          つまみ・Esc・暗幕タップも BottomSheet の既存どおり効く。 */}
      <button type="button" onClick={onClose} aria-label="閉じる" className="sans"
        style={{ ...BACK_BUTTON_STYLE, width: "var(--tap-min)", justifyContent: "center", alignSelf: "flex-start" }}>
        <X size={17} strokeWidth={1.9} aria-hidden="true" />
      </button>
      {state.error ? (
        <div className="sans" role="alert" style={errorStyle}>読み込めませんでした</div>
      ) : state.html ? (
        /* 本文は同じ origin の自分の静的 HTML(public/*.html)。外から来た文字列ではない。 */
        <div className="legal-doc" dangerouslySetInnerHTML={{ __html: state.html }} />
      ) : null}
    </BottomSheet>
  );
}
