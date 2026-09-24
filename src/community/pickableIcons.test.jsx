import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { AVATAR_ICONS, AVATAR_PICKABLE_ICONS, buildProfileDoc } from "./profile.js";
import { avatarPaint } from "./avatarPhoto.js";
import { AvatarPicker } from "./CommunityTab.jsx";

// ------------------------------------------------------------------
// 【便AS 2026-09-24 本人指示】「プロフィールのアイコンの種類を減らそう。写真を入れて5×3になるように絞って」
//
// 選べるのは14種。**描ける・保存できるのは24種のまま**(外した10種を使っている人を閉じ込めない)。
// 期待値は本人の言葉から数字で書く: 5列 × 3行 = 15 マス = 写真枠 1 + 絵柄 14。
// ------------------------------------------------------------------
const COLS = 5;
const ROWS = 3;
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const draw = (props = {}) => renderToStaticMarkup(
  <AvatarPicker icon="ic-cat" color={2} photo={null} onChange={() => {}} onPickPhoto={async () => {}} {...props} />,
);
// 絵柄と写真の格子(radiogroup)の中の radio を数える
const gridOf = (html) => {
  const at = html.indexOf('role="radiogroup" aria-label="アイコンの絵柄と写真"');
  const end = html.indexOf('role="radiogroup"', at + 10);
  return html.slice(at, end < 0 ? undefined : end);
};
const radios = (html) => [...gridOf(html).matchAll(/role="radio"[^>]*aria-checked="(true|false)"/g)].map((m) => m[1]);

describe("選べる絵柄は14種(写真枠と合わせて 5 × 3)", () => {
  it("格子は写真枠 + 絵柄で ちょうど 5 × 3 = 15 マス、5列", () => {
    const html = draw();
    expect(radios(html)).toHaveLength(COLS * ROWS);
    expect(gridOf(html)).toMatch(/grid-template-columns:repeat\(5, minmax\(0, 1fr\)\)/);
  });

  it("選べる絵柄は描ける絵柄の中の14種で、重なりが無い", () => {
    expect(AVATAR_PICKABLE_ICONS).toHaveLength(COLS * ROWS - 1);
    expect(new Set(AVATAR_PICKABLE_ICONS).size).toBe(AVATAR_PICKABLE_ICONS.length);
    for (const id of AVATAR_PICKABLE_ICONS) expect(AVATAR_ICONS).toContain(id);
    // 既定(絵柄が無い人に出すもの)は選べる側に在る
    expect(AVATAR_PICKABLE_ICONS).toContain(AVATAR_ICONS[0]);
  });

  it("格子に並ぶ絵柄は選べる14種そのもの(外した絵柄は並ばない)", () => {
    const html = gridOf(draw());
    for (const id of AVATAR_PICKABLE_ICONS) expect(html).toContain(`href="#${id}"`);
    for (const id of AVATAR_ICONS.filter((i) => !AVATAR_PICKABLE_ICONS.includes(i))) {
      expect(html).not.toContain(`href="#${id}"`);
    }
  });
});

describe("外した絵柄を使っている人を閉じ込めない", () => {
  const legacy = AVATAR_ICONS.find((i) => !AVATAR_PICKABLE_ICONS.includes(i));

  it("外した絵柄もそのまま描く(既定の絵柄に化けない)", () => {
    expect(legacy).toBeTruthy();
    expect(avatarPaint({ icon: legacy, color: 3 })).toEqual({ kind: "icon", icon: legacy, color: 3 });
  });

  it("外した絵柄のままプロフィールを保存し直せる(端末の検査で弾かない)", () => {
    const base = {
      nickname: "さっくす太郎", icon: legacy, iconColor: 1, saxTypes: ["alto"], position: "社会人", startYear: 2015,
      genres: ["クラシック"], ensembles: ["吹奏楽"], ageConfirmed: true, isPublic: true,
      gear: { alto: { instrumentBrand: "YAMAHA", instrumentModel: "YAS-62", mpBrand: "Selmer", mpModel: "S80 C*", ligBrand: "Rovner", ligModel: "Dark", reedBrand: "Vandoren", reedModel: "Traditional", reedStrength: "3.0" } },
    };
    const doc = buildProfileDoc(base);
    expect(doc.error).toBeUndefined();
    expect(doc.icon ?? doc.doc?.icon).toBe(legacy);
  });

  it("サーバーのルールも外した絵柄を受ける(24種の列挙のまま)", () => {
    const rules = read("../../firestore.rules");
    const list = "[" + AVATAR_ICONS.map((i) => `'${i}'`).join(",") + "]";
    expect(rules).toContain(`request.resource.data.icon in ${list}`);
  });

  it("外した絵柄の人の格子では、どの絵柄も選択中にならない(写真も選択中でない)", () => {
    const checked = radios(draw({ icon: legacy }));
    expect(checked).toHaveLength(COLS * ROWS);
    expect(checked.filter((c) => c === "true")).toHaveLength(0);
  });
});
