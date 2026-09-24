import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AvatarPicker } from "./CommunityTab.jsx";

// ------------------------------------------------------------------
// 【便AM 2026-09-24 本人の実機報告「写真の選択も出てこない」】
//
// 写真枠は **<label> で写真選択の input を包む**。押した瞬間にブラウザ自身が選択を開く
// (プログラムから .click() を叩かない ── iOS の WebKit ではその叩き方で開かないことがある)。
// 見出しが「絵柄」で25個並ぶ中の1つだったので、このマスにだけ「写真」の文字を添える。
//
// 実際に描かせて形を見る(react-dom/server)。**選択が本当に開くかは実機でしか分からない**
// ので、ここが見るのは「開く形になっているか」まで。
// ------------------------------------------------------------------
const draw = (props = {}) => renderToStaticMarkup(
  <AvatarPicker icon="ic-cat" color={2} photo={null} onChange={() => {}} onPickPhoto={async () => {}} {...props} />,
);

// 写真枠の <label ...>...</label> を切り出す。見つからなければ空文字(= 下の検査が落ちる)。
const photoCellOf = (html) => {
  const at = html.indexOf('aria-label="写真を選ぶ"');
  if (at < 0) return "";
  const open = html.lastIndexOf("<label", at);
  const close = html.indexOf("</label>", at);
  return open < 0 || close < 0 ? "" : html.slice(open, close + "</label>".length);
};

describe("写真枠 ── 押せば写真選択が開く形になっている", () => {
  it("写真枠は <label> で、その中に写真選択の input が在る", () => {
    const cell = photoCellOf(draw());
    expect(cell.startsWith("<label")).toBe(true);
    expect(cell).toMatch(/<input[^>]*type="file"/);
  });

  // display:none の input は、端末によっては label からも開かない。
  it("写真選択の input は display:none にしていない(見えないだけで在る)", () => {
    const cell = photoCellOf(draw());
    const input = (cell.match(/<input[^>]*>/) || [""])[0];
    expect(input).not.toBe("");
    expect(input).not.toMatch(/display:\s*none/);
    expect(input).toMatch(/opacity:\s*0/);
  });

  it("写真選択の input が格子の外に残っていない(1つだけで、写真枠の中)", () => {
    const html = draw();
    expect((html.match(/type="file"/g) || []).length).toBe(1);
    expect(photoCellOf(html)).toContain('type="file"');
  });

  it("このマスにだけ「写真」の文字が在る(絵柄の25個の中で見分けがつく)", () => {
    const html = draw();
    expect(photoCellOf(html)).toContain(">写真<");
    expect((html.match(/>写真</g) || []).length).toBe(1);
  });

  it("写真を持っている人も、写真枠は同じ形(縮小と「写真」の文字と input)", () => {
    const cell = photoCellOf(draw({ photo: "https://example.test/mine.webp" }));
    expect(cell).toContain('src="https://example.test/mine.webp"');
    expect(cell).toContain(">写真<");
    expect(cell).toMatch(/<input[^>]*type="file"/);
  });

  it("写真枠は radiogroup の中の radio として読まれる", () => {
    const cell = photoCellOf(draw());
    expect(cell).toContain('role="radio"');
    expect(draw()).toContain('aria-label="アイコンの絵柄と写真"');
  });
});
