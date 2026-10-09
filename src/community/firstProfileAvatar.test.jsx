// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便CJ 2026-10-10 本人「一番最初のプロフィール作成の時にアイコン設定も追加 / 通常のプロフィール編集は今のままでok」】
// 参加して最初に出るプロフィールの入力(初回だけ)で、マイページと同じ部品(アイコンと鉛筆の印 → シートの AvatarPicker)で
// アイコン(絵柄・色・写真)を選べる。選ばなくても先へ進める(既定は一覧の先頭と色1 = 今までと同じ)。編集は今のまま(アイコンの欄は無い)。
// 写真はプロフィールを書いたあとで送る(写真の判定の関数は users/{uid} に photo だけを書き足すので、入力の途中でやめると
// photo だけの文書が残り、次に開いたときに「参加済み」と読まれる)。期待値は本人の指示と統括の仕様から手で書いた。
// サーバーは作り物(accountRepo / photoRepo / directory / idealRepo / reportRepo)。写真の書き直し(canvas)も作り物。
// buildProfileDoc は通す形ではなく、渡された入力を記録して整った文書を返す作り物(9項目を埋める操作を省くため。判定は profile.test.js)。
// 【守っていないもの】本物の写真の判定(サーバの関数)・実寸の見た目(dev サーバのスクショ cj_shots/)。
// ------------------------------------------------------------------

globalThis.indexedDB = createFakeIndexedDb();
const h = vi.hoisted(() => ({ order: [], built: [], photoFails: null }));
const account = { uid: "me", profile: null };
vi.mock("./accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => account.uid),
  loadProfile: vi.fn(async () => account.profile),
  saveProfile: vi.fn(async (uid, doc) => { h.order.push(["saveProfile", uid, doc]); }),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => "me"),
}));
vi.mock("./photoRepo.js", async (orig) => ({
  ...(await orig()),
  saveAvatarPhoto: vi.fn(async (uid, blob) => {
    h.order.push(["saveAvatarPhoto", uid, blob]);
    if (h.photoFails) throw h.photoFails;
    return "https://example.invalid/avatars/me/photo.webp";
  }),
}));
vi.mock("./avatarPhoto.js", async (orig) => ({
  ...(await orig()),
  encodeSquarePhoto: vi.fn(async () => ({ size: 18000, type: "image/jpeg", tag: "encoded" })),
}));
vi.mock("./profile.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return {
    ...(await orig()),
    buildProfileDoc: vi.fn((input) => {
      h.built.push(input);
      return { doc: { ...kit.MY_PROFILE, icon: input.icon, iconColor: input.iconColor, ageConfirmed: true } };
    }),
  };
});
vi.mock("./directory.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(async () => kit.SERVER_USERS), publishStats: vi.fn(async () => {}) };
});
vi.mock("./reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));
vi.mock("./idealRepo.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listIdeals: vi.fn(async () => kit.SERVER_IDEALS), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) };
});

const { default: CommunityTab, ProfileForm } = await import("./CommunityTab.jsx");
const { AVATAR_ICONS, AVATAR_COLOR_MIN } = await import("./profile.js");
const kit = await import("./blockKit.testutil.jsx");
const { setupDom, teardownDom, waitFor, buttonsNamed, click } = kit;

let host = null; let root = null; let urls = 0; let revoked = [];
beforeEach(() => {
  setupDom();
  account.uid = "me"; account.profile = null;
  h.order = []; h.built = []; h.photoFails = null;
  urls = 0; revoked = [];
  URL.createObjectURL = vi.fn(() => `blob:first-${++urls}`);
  URL.revokeObjectURL = vi.fn((u) => revoked.push(u));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; host?.remove(); host = null;
  teardownDom();
  vi.restoreAllMocks();
});
async function draw(el) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(el); });
}
const editButtons = () => [...document.querySelectorAll('button[aria-label="アイコンを変更"]')];
const sheet = () => document.querySelector('[role="dialog"][aria-label="アイコンを変更"]');
const shownAvatarImg = () => document.querySelector('.sans > div button[aria-label="アイコンを変更"] img');
const closeSheet = () => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
async function pickPhoto() {
  const input = sheet().querySelector('label[role="radio"] input[type="file"]');
  Object.defineProperty(input, "files", { configurable: true, value: [{ name: "a.jpg", type: "image/jpeg", size: 1 }] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await waitFor(() => !sheet().querySelector("[data-photo-ring]"), "写真の書き直しが終わる");
}
const PROFILE = { ...{ nickname: "じぶん", icon: "ic-dog", iconColor: 5, saxTypes: ["alto"], gear: { alto: {} }, position: "社会人", startYear: 2015, genres: [], ensembles: [], isPublic: true, ageConfirmed: true } };

describe("【便CJ】最初のプロフィールの入力にアイコンの設定(マイページと同じ部品)", () => {
  it("初回の入力: タイトルの下にアイコン(64)と鉛筆の印。押すとマイページと同じシート(AvatarPicker)が開く", async () => {
    await draw(<ProfileForm initial={null} onSubmit={async () => null} onCancel={null} />);
    expect(editButtons()).toHaveLength(2);   // アイコンそのものと鉛筆の印(マイページと同じ2つ)
    const badge = editButtons()[1];
    expect(badge.style.width).toBe("24px");   // 印の直径 24(マイページと同じ AVATAR_EDIT_BADGE_PX)
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    expect(sheet()).toBe(null);
    await click(badge);
    expect(sheet()).not.toBe(null);
    expect(sheet().querySelector('[role="radiogroup"][aria-label="アイコンの絵柄と写真"]')).not.toBe(null);
    expect(editButtons()[1].getAttribute("aria-expanded")).toBe("true");
  });

  it("編集(initial がある): 今までどおりアイコンの欄も印も無い(マイページから変える)", async () => {
    await draw(<ProfileForm initial={PROFILE} onSubmit={async () => null} onCancel={() => {}} />);
    expect(editButtons()).toHaveLength(0);
    expect(document.querySelector('[role="radiogroup"][aria-label="アイコンの絵柄と写真"]')).toBe(null);
  });

  it("選ばずに進める(任意): 既定は一覧の先頭と色1(今までと同じ)・写真なし", async () => {
    const got = [];
    await draw(<ProfileForm initial={null} onSubmit={async (input) => { got.push(input); return "止める"; }} onCancel={null} />);
    await click(buttonsNamed("プロフィールを作る")[0]);
    expect(got).toHaveLength(1);
    expect([got[0].icon, got[0].iconColor, got[0].photoBlob]).toEqual([AVATAR_ICONS[0], AVATAR_COLOR_MIN, null]);
  });

  it("絵柄と色を選ぶと、フォームの値になる(保存の入力に入る)。アイコンの見た目も替わる", async () => {
    const got = [];
    await draw(<ProfileForm initial={null} onSubmit={async (input) => { got.push(input); return "止める"; }} onCancel={null} />);
    await click(editButtons()[0]);
    const glyph = sheet().querySelector('button[role="radio"][aria-label="dog"]');
    expect(glyph).not.toBe(null);
    await click(glyph);
    const color3 = sheet().querySelector('[role="radiogroup"][aria-label="アイコンの背景"] button[aria-label="色 3"]');
    expect(color3).not.toBe(null);
    await click(color3);
    await closeSheet();
    expect(sheet()).toBe(null);
    await click(buttonsNamed("プロフィールを作る")[0]);
    expect(got[0].icon).toBe("ic-dog");
    expect(got[0].iconColor).toBe(3);
    expect(got[0].photoBlob).toBe(null);
  });

  it("写真を選ぶと(マイページと同じ書き直し)、その場では送らずにアイコンが写真になる。保存の入力に photoBlob。絵柄を選び直すと写真は外れる", async () => {
    const got = [];
    await draw(<ProfileForm initial={null} onSubmit={async (input) => { got.push(input); return "止める"; }} onCancel={null} />);
    await click(editButtons()[1]);
    await pickPhoto();
    expect(h.order).toEqual([]);   // 選んだ時点では送らない
    expect(sheet().querySelector('label[role="radio"]').getAttribute("aria-checked")).toBe("true");
    await closeSheet();
    // 一時 URL は2つ: シートの輪の中の見本(AvatarPicker が作って片付ける)と、フォームのアイコン(最後に作った方)
    const formUrl = `blob:first-${urls}`;
    expect(urls).toBe(2);
    expect(shownAvatarImg()?.getAttribute("src")).toBe(formUrl);
    await click(buttonsNamed("プロフィールを作る")[0]);
    expect(got[0].photoBlob).toMatchObject({ tag: "encoded" });
    // 絵柄を選び直すと写真は外れる(一時 URL は捨てる)
    await click(editButtons()[1]);
    await click(sheet().querySelector('button[role="radio"][aria-label="dog"]'));
    await closeSheet();
    expect(shownAvatarImg()).toBe(null);
    expect(revoked).toContain(formUrl);
    await click(buttonsNamed("プロフィールを作る")[0]);
    expect(got[1].photoBlob).toBe(null);
    expect(got[1].icon).toBe("ic-dog");
  });
});

describe("【便CJ】参加して最初のプロフィール: 写真はプロフィールを書いたあとで送る(マイページと同じ saveAvatarPhoto)", () => {
  const joinCard = () => document.querySelector('[data-join-card][role="button"][aria-label="参加する"]');
  const joinedShown = () => ["データ", "順位", "シェア", "マイページ"].every((l) => buttonsNamed(l).length > 0);
  async function toForm() {
    await draw(<CommunityTab sessions={[]} tuningHz={442} onAdoptIdeal={() => ({})} />);
    await waitFor(() => joinCard(), "参加の画面");
    await click(joinCard());
    await waitFor(() => buttonsNamed("プロフィールを作る").length > 0, "最初のプロフィールの入力");
  }

  it("写真を選んで「プロフィールを作る」: saveProfile → saveAvatarPhoto(同じ uid・選んだ写真)の順。参加後のマイページのアイコンは写真", async () => {
    await toForm();
    await click(editButtons()[1]);
    await pickPhoto();
    await closeSheet();
    expect(h.order).toEqual([]);
    await click(buttonsNamed("プロフィールを作る")[0]);
    await waitFor(() => joinedShown(), "参加後の画面");
    expect(h.order.map((x) => x[0])).toEqual(["saveProfile", "saveAvatarPhoto"]);
    expect(h.order[1][1]).toBe("me");
    expect(h.order[1][2]).toMatchObject({ tag: "encoded" });
    await click(buttonsNamed("マイページ")[0]);
    await waitFor(() => document.querySelector('button[aria-label="写真を大きく表示"] img'), "マイページのアイコンが写真");
    expect(document.querySelector('button[aria-label="写真を大きく表示"] img').getAttribute("src")).toBe("https://example.invalid/avatars/me/photo.webp");
  });

  it("写真を選ばずに「プロフィールを作る」: saveAvatarPhoto は呼ばない(今までどおり)。絵柄は既定", async () => {
    await toForm();
    await click(buttonsNamed("プロフィールを作る")[0]);
    await waitFor(() => joinedShown(), "参加後の画面");
    expect(h.order.map((x) => x[0])).toEqual(["saveProfile"]);
    expect([h.order[0][2].icon, h.order[0][2].iconColor]).toEqual([AVATAR_ICONS[0], AVATAR_COLOR_MIN]);
  });

  it("写真が通らなかった: フォームを開いたまま写真の文言(プロフィールは書けている)。絵柄を選び直して押し直すと参加後へ", async () => {
    h.photoFails = Object.assign(new Error("photo-rejected: unsafe"), { code: "functions/failed-precondition" });
    await toForm();
    await click(editButtons()[1]);
    await pickPhoto();
    await closeSheet();
    await click(buttonsNamed("プロフィールを作る")[0]);
    await waitFor(() => document.querySelector('[role="alert"]'), "文言");
    expect(document.querySelector('[role="alert"]').textContent).toBe("この写真は使えません。別の写真をお試しください。");
    expect(joinedShown()).toBe(false);
    expect(h.order.map((x) => x[0])).toEqual(["saveProfile", "saveAvatarPhoto"]);
    await click(editButtons()[1]);
    await click(sheet().querySelector('button[role="radio"][aria-label="dog"]'));
    await closeSheet();
    await click(buttonsNamed("プロフィールを作る")[0]);
    await waitFor(() => joinedShown(), "参加後の画面");
    expect(h.order.map((x) => x[0])).toEqual(["saveProfile", "saveAvatarPhoto", "saveProfile"]);
    expect(h.order[2][2].icon).toBe("ic-dog");
  });
});
