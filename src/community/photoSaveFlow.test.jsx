// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便AP 2026-09-24 本人指示】「読み込んでいるなら、左上の写真アイコンの周りを円形で囲って
//  100%完了するまで円グラフで表す」── その輪を**実際にマイページから**動かして見る。
//
// 【審査役の指摘(重1)で足した】純関数 photoProgressAt と、単独で描いた輪しか見ていなかったので、
//   ・マイページ → 保存 → 段の知らせ、の配線を切る
//   ・保存中に輪を出す分岐を消す
//   ・判定の間の時刻の刻みを消す
//   ・後片付け(プレビューの解放・段の消去)を消す
// のどれをしても全部緑のままだった。ここはマイページ(ProfileView)を jsdom に描き、
// 鉛筆 → 写真枠 → 写真を選ぶ、を本物の手順で踏む。止めておける保存で途中の姿を見る。
//
// 作り物にするのは「写真を書き直す」(canvas が無い)と「送る」(Firebase)の2つだけ。
// ------------------------------------------------------------------
const h = vi.hoisted(() => ({ saves: [], urls: 0 }));

vi.mock("./photoRepo.js", async (orig) => ({
  ...(await orig()),
  saveAvatarPhoto: vi.fn((uid, blob, onStage) => new Promise((resolve, reject) => {
    h.saves.push({ uid, blob, onStage, resolve, reject });
  })),
}));
vi.mock("./avatarPhoto.js", async (orig) => ({
  ...(await orig()),
  encodeSquarePhoto: vi.fn(async () => ({ size: 18000, type: "image/jpeg" })),
}));

const { ProfileView } = await import("./CommunityTab.jsx");

const PROFILE = {
  nickname: "てすと", icon: "ic-cat", iconColor: 2,
  saxTypes: ["alto"], gear: { alto: {} }, position: "社会人", startYear: 2015,
  genres: ["ジャズ"], ensembles: ["ソロ"], isPublic: true,
};

let root; let host; let revoked;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  h.saves.length = 0;
  h.urls = 0;
  revoked = [];
  window.scrollTo = () => {};   // jsdom に無い(シートを開くときに呼ばれる)
  URL.createObjectURL = vi.fn(() => `blob:preview-${++h.urls}`);
  URL.revokeObjectURL = vi.fn((u) => revoked.push(u));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const $ = (sel) => document.querySelector(sel);
const ring = () => $("[data-photo-ring]");
const progress = () => Number(ring()?.getAttribute("data-progress"));
const photoCell = () => document.querySelector('label[role="radio"]');

async function openPicker() {
  await act(async () => { root.render(<ProfileView profile={PROFILE} uid="u1" onChangeAvatar={() => {}} />); });
  const pencil = [...document.querySelectorAll('button[aria-label="アイコンを変更"]')].at(-1);
  await act(async () => { pencil.click(); });
}
async function pickPhoto() {
  const input = photoCell().querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { configurable: true, value: [{ name: "a.heic", type: "image/heic", size: 1 }] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("マイページで写真を選ぶと、写真枠が進み具合の輪になる", () => {
  it("選ぶ前は輪が無く、写真枠には「写真」の文字", async () => {
    await openPicker();
    expect(photoCell()).not.toBe(null);
    expect(ring()).toBe(null);
    expect(photoCell().textContent).toContain("写真");
  });

  it("保存の段が輪に届き、判定の間も時間とともに進み、返事で 100% になってから消える", async () => {
    await openPicker();
    await pickPhoto();

    // 送る手順へ、段を知らせる口が**渡っている**(配線が切れていれば、輪は判定の間ずっと止まる)
    expect(h.saves).toHaveLength(1);
    expect(h.saves[0].uid).toBe("u1");
    expect(h.saves[0].blob.type).toBe("image/jpeg");
    expect(typeof h.saves[0].onStage).toBe("function");

    // 輪が出ている。写真枠の文字は引っ込み、名前は「写真を保存中」
    expect(ring()).not.toBe(null);
    expect(photoCell().getAttribute("aria-label")).toBe("写真を保存中");
    expect(photoCell().textContent).not.toContain("写真");
    // 送っている写真が輪の中に出る
    expect(ring().querySelector("img")?.getAttribute("src")).toBe("blob:preview-1");

    const { onStage, resolve } = h.saves[0];
    await act(async () => { onStage({ stage: "upload", fraction: 0 }); });
    const atUpload0 = progress();
    await act(async () => { onStage({ stage: "upload", fraction: 0.5 }); });
    const atHalf = progress();
    expect(atHalf).toBeGreaterThan(atUpload0);

    await act(async () => { onStage({ stage: "vet", startedAt: Date.now() }); });
    const atVet0 = progress();
    expect(atVet0).toBeGreaterThanOrEqual(atHalf);
    // 途中経過は返らない。時刻の刻みだけで進む(刻みが止まっていれば、ここで動かない)
    await act(async () => { vi.advanceTimersByTime(1000); });
    const atVet1 = progress();
    expect(atVet1).toBeGreaterThan(atVet0);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(progress()).toBeGreaterThan(atVet1);
    expect(progress()).toBeLessThan(100);            // 返事が来るまで満ちない

    await act(async () => { resolve("https://example.test/u1.jpg"); });
    expect(progress()).toBe(100);                    // 満ちた姿を見せる
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(ring()).toBe(null);                       // それから消える
    expect(photoCell().getAttribute("aria-label")).toBe("写真を選ぶ");
    expect(revoked).toContain("blob:preview-1");     // プレビューは解放する
    // 載った写真が写真枠の縮小に出る
    expect(photoCell().querySelector("img")?.getAttribute("src")).toBe("https://example.test/u1.jpg");
  });

  it("落ちたら輪は消え、文言が出て、プレビューは解放される。次の保存は段の頭から", async () => {
    await openPicker();
    await pickPhoto();
    await act(async () => { h.saves[0].onStage({ stage: "vet", startedAt: Date.now() }); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    const err = Object.assign(new Error("photo-rejected: adult"), { code: "functions/failed-precondition" });
    await act(async () => { h.saves[0].reject(err); });

    expect(ring()).toBe(null);
    expect($('[role="alert"]')?.textContent).toContain("この写真は使えません");
    expect(revoked).toContain("blob:preview-1");

    // もう一度選ぶ: 前の段(判定の途中)を引きずらず、書き出しの頭から始まる
    await pickPhoto();
    expect(h.saves).toHaveLength(2);
    expect(ring()).not.toBe(null);
    expect(progress()).toBeLessThanOrEqual(10);
    expect(ring().querySelector("img")?.getAttribute("src")).toBe("blob:preview-2");
  });

  it("保存の途中で画面を離れても、プレビューは解放される", async () => {
    await openPicker();
    await pickPhoto();
    expect(ring()).not.toBe(null);
    act(() => root.unmount());
    expect(revoked).toContain("blob:preview-1");
    root = createRoot(host);   // afterEach の片付け用
  });
});
