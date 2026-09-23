import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar } from "./icons.jsx";
import { ProfileView } from "./CommunityTab.jsx";

// ------------------------------------------------------------------
// 【描いた結果を見る ── 2026-09-23 審査役の指摘】
// 綴りの検査だけだと「マイページの <Avatar> から photo を外す」変異が生き残る。
// 実際に描かせて、写真が画面に出ることを見る(react-dom/server)。
// ------------------------------------------------------------------
const PHOTO_URL = "https://example.test/mine.webp";
const PROFILE = {
  nickname: "てすと", icon: "ic-cat", iconColor: 2,
  saxTypes: ["alto"], gear: { alto: {} }, position: "社会人", startYear: 2015,
  genres: ["ジャズ"], ensembles: ["ソロ"], isPublic: true,
};

describe("描いた結果 ── 写真が本当に画面へ出る", () => {
  it("Avatar は写真を <img> で描き、絵柄のときは描かない", () => {
    const withPhoto = renderToStaticMarkup(<Avatar icon="ic-cat" color={2} photo={PHOTO_URL} size={64} />);
    expect(withPhoto).toContain(`src="${PHOTO_URL}"`);
    expect(withPhoto).not.toContain("#ic-cat");

    const withIcon = renderToStaticMarkup(<Avatar icon="ic-cat" color={2} size={64} />);
    expect(withIcon).toContain("#ic-cat");
    expect(withIcon).not.toContain("<img");
  });

  // ★ 審査役の変異「マイページの <Avatar> から photo={photo} を外す」がここで落ちる。
  it("マイページは自分の写真を描く(渡し漏れがあれば落ちる)", () => {
    const html = renderToStaticMarkup(
      <ProfileView profile={{ ...PROFILE, photo: PHOTO_URL }} uid="u1" />,
    );
    expect(html).toContain(`src="${PHOTO_URL}"`);
  });

  it("写真が無い人のマイページには絵柄が出る(<img> は出ない)", () => {
    const html = renderToStaticMarkup(<ProfileView profile={PROFILE} uid="u1" />);
    expect(html).toContain("#ic-cat");
    expect(html).not.toContain("<img");
  });

  // 決定5: マイページのアイコンは、写真のときだけ「大きく表示」の入口になる。
  it("写真のときだけ、アイコンの読み上げが「写真を大きく表示」になる", () => {
    const withPhoto = renderToStaticMarkup(<ProfileView profile={{ ...PROFILE, photo: PHOTO_URL }} uid="u1" />);
    expect(withPhoto).toContain('aria-label="写真を大きく表示"');
    const withIcon = renderToStaticMarkup(<ProfileView profile={PROFILE} uid="u1" />);
    expect(withIcon).not.toContain('aria-label="写真を大きく表示"');
    // 鉛筆の印(変更の入口)はどちらでも在る ── 写真にしても選び直せなくならない。
    expect(withPhoto).toContain('aria-label="アイコンを変更"');
    expect(withIcon).toContain('aria-label="アイコンを変更"');
  });
});
