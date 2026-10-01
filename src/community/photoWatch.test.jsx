// @vitest-environment jsdom
import React, { act, useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便BH 2026-10-01 本人裁定 (a) → 差し戻し(不合格2)】本人の画面に、古い写真の URL の写しを残さない。
//
// 公開をやめると、関数が写真の鍵を入れ替えて users.photo を新しい URL に書き直す(古い鍵の URL は
// 読めなくなる)。参加中の画面(JoinedView)は自分の users.photo を見張り続け、届いた値を changePhoto に
// 流して、profile と一覧の自分の行の両方を直す。ここでは**本物の JoinedView を描き**、見張りだけを
// 作り物(watchPhoto)にして、届く順番を作って確かめる。
//   (i)   関数より早く公開に戻した(切る → 入れる → そのあとで新しい URL が届く)
//   (ii)  アイコンのシートを開いたまま入れ替わった(閉じても古い URL が書き戻されない)
//   (iii) 2回入れ替わった / 同じ合図が2回届いた
//   そして、写真が読めなかったら(onError)その人の絵柄に戻ること。
//
// 親(CommunityTabBody)は Firebase に繋がないと描けないので、ここでは**同じ形の親**(Host)を置く。
// 親が本物と同じ形であること(写真はその時点の profile に重ねる・見張りは watchMyPhoto)は
// accountRepo.test.js の綴りの検査が見ている。
// ------------------------------------------------------------------

const fakeIdb = createFakeIndexedDb();
globalThis.indexedDB = fakeIdb;

vi.mock("./directory.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(async () => kit.SERVER_USERS), publishStats: vi.fn(async () => {}) };
});
vi.mock("./reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));
// 【便BH 再審査】写真の保存は止めておける作り物(canvas も Firebase も無いので)。
const saves = vi.hoisted(() => []);
vi.mock("./photoRepo.js", async (orig) => ({
  ...(await orig()),
  saveAvatarPhoto: vi.fn((uid, blob, onStage) => new Promise((resolve, reject) => { saves.push({ resolve, reject }); })),
}));
vi.mock("./avatarPhoto.js", async (orig) => ({
  ...(await orig()),
  encodeSquarePhoto: vi.fn(async () => ({ size: 18000, type: "image/jpeg" })),
}));
vi.mock("./idealRepo.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return {
    ...(await orig()),
    listIdeals: vi.fn(async () => kit.SERVER_IDEALS),
    publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}),
  };
});

const { JoinedView } = await import("./CommunityTab.jsx");
const { Avatar } = await import("./icons.jsx");
const { AVATAR_ICONS } = await import("./profile.js");
const kit = await import("./blockKit.testutil.jsx");
const { setupDom, teardownDom, waitFor, click, MY_PROFILE } = kit;

// 自分が順位に並ぶよう、練習を20日ぶん持たせる(他の4人は10〜13日)。
const SESSIONS = Array.from({ length: 20 }, (_, i) => ({ recordedAt: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(), durationSec: 60 }));

const OLD = "https://firebasestorage.googleapis.com/v0/b/b/o/avatars%2Fme%2Fr.webp?alt=media&token=t0";
const NEW = "https://firebasestorage.googleapis.com/v0/b/b/o/avatars%2Fme%2Fr.webp?alt=media&token=t1";
const NEWER = "https://firebasestorage.googleapis.com/v0/b/b/o/avatars%2Fme%2Fr.webp?alt=media&token=t2";

beforeEach(setupDom);
afterEach(teardownDom);

/** 見張りの作り物。emit で「users が変わった」合図を届ける。 */
function makeWatcher() {
  const w = { calls: 0, uid: null, cb: null, unsub: vi.fn() };
  w.watch = (uid, cb) => { w.calls += 1; w.uid = uid; w.cb = cb; return w.unsub; };
  w.emit = (photo) => act(async () => { w.cb(photo); });
  return w;
}

/** CommunityTabBody と同じ形の親。profile を持ち、子からの知らせで書き換える。 */
// 書き込み(setProfilePublic / setProfileAvatar)の待ちは host.write が決める(既定はすぐ終わる)。
const host = { profile: null, changeAvatar: [], write: () => Promise.resolve() };
function Host({ watcher, initial }) {
  const [profile, setProfile] = useState(initial);
  host.profile = profile;
  return (
    <JoinedView
      profile={profile} uid="me" sessions={SESSIONS} tuningHz={442} onAdoptIdeal={() => ({})} onEdit={() => {}}
      onTogglePublic={async (v) => { await host.write(); setProfile((p) => (p ? { ...p, isPublic: v } : p)); }}
      onChangeAvatar={async (v) => {
        host.changeAvatar.push(v);
        await host.write();
        setProfile((p) => (p ? { ...p, icon: v.icon, iconColor: v.iconColor, ...(v.photo === null && !v.keepPhoto ? { photo: null } : {}) } : p));
      }}
      onPhotoChanged={(photo) => setProfile((p) => (p ? { ...p, photo } : p))}
      onDelete={async () => {}} initialTab="rank" watchPhoto={watcher.watch}
    />
  );
}

async function draw(watcher, initial = { ...MY_PROFILE, photo: OLD }) {
  host.changeAvatar = [];
  host.write = () => Promise.resolve();
  await act(async () => { createdRoot().render(<Host watcher={watcher} initial={initial} />); });
  await waitFor(() => document.body.textContent.includes("目安を公開している"), "名簿と目安の読み込み");
}
// 描く器(setupDom は jsdom の下ごしらえにだけ使う)。検査ごとに1つ作って、終わったら外す。
let _root = null;
function createdRoot() {
  if (_root) return _root.r;
  const el = document.createElement("div");
  document.body.appendChild(el);
  _root = { host: el, r: createRoot(el) };
  return _root.r;
}
const dropRoot = () => { if (_root) { act(() => _root.r.unmount()); _root.host.remove(); _root = null; } };
beforeEach(dropRoot);
afterEach(dropRoot);

const imgSrcs = () => [...document.querySelectorAll("img")].map((i) => i.getAttribute("src"));
const myRankRow = () => [...document.querySelectorAll('[role="button"]')].find((el) => el.textContent.includes(MY_PROFILE.nickname));
const publicSwitch = () => document.querySelector('[role="switch"][aria-label="公開"]');
const sheet = () => document.querySelector('[role="dialog"][aria-label="アイコンを変更"]');

describe("参加中の画面は自分の写真を見張り続け、古い URL の写しを残さない", () => {
  it("張るのは自分の uid に1回だけ。画面を離れたら外す", async () => {
    const w = makeWatcher();
    await draw(w);
    expect(w.calls).toBe(1);
    expect(w.uid).toBe("me");
    act(() => { _root.r.unmount(); });
    expect(w.unsub).toHaveBeenCalledTimes(1);
    _root.host.remove(); _root = null;
  });

  it("新しい URL が届いたら、マイページと一覧の自分の行の両方が新しい URL になる", async () => {
    const w = makeWatcher();
    await draw(w);
    expect(myRankRow().querySelector("img").getAttribute("src")).toBe(OLD);
    await w.emit(NEW);
    expect(myRankRow().querySelector("img").getAttribute("src")).toBe(NEW);
    expect(imgSrcs()).not.toContain(OLD);
    expect(imgSrcs().filter((s) => s === NEW).length).toBeGreaterThanOrEqual(2);   // 一覧の行とマイページ
    expect(host.profile.photo).toBe(NEW);
  });

  it("(i) 関数より早く公開に戻しても、あとから届いた新しい URL に揃う", async () => {
    const w = makeWatcher();
    await draw(w);
    await click(publicSwitch());                           // 切る
    await waitFor(() => !myRankRow(), "一覧から自分が消えた");
    await click(publicSwitch());                           // 関数が書き直す前に入れる
    await waitFor(() => Boolean(myRankRow()), "一覧に自分が戻った");
    expect(myRankRow().querySelector("img").getAttribute("src")).toBe(OLD);   // この時点では古い
    await w.emit(NEW);                                     // 関数の書き直しがあとから届く
    expect(myRankRow().querySelector("img").getAttribute("src")).toBe(NEW);
    expect(imgSrcs()).not.toContain(OLD);
    expect(host.profile).toMatchObject({ isPublic: true, photo: NEW });
  });

  it("(i') 公開に戻す書き込みの最中に新しい URL が届いても、書き込みのあとで古い URL に巻き戻らない", async () => {
    const w = makeWatcher();
    await draw(w);
    await click(publicSwitch());                           // 切る
    await waitFor(() => !myRankRow(), "一覧から自分が消えた");
    let release;
    host.write = () => new Promise((r) => { release = r; });
    await click(publicSwitch());                           // 入れる(書き込みはまだ終わらない)
    await w.emit(NEW);                                     // その間に関数の書き直しが届く
    await act(async () => { release(); });
    await waitFor(() => Boolean(myRankRow()), "一覧に自分が戻った");
    expect(host.profile).toMatchObject({ isPublic: true, photo: NEW });
    expect(imgSrcs()).not.toContain(OLD);
  });

  it("(ii) アイコンのシートを開いたまま入れ替わったら、シートの写真も新しい URL になり、閉じても古い URL は戻らない", async () => {
    const w = makeWatcher();
    await draw(w);
    await click(document.querySelector('button[aria-label="アイコンを変更"]'));
    await waitFor(() => Boolean(sheet()), "シートが開いた");
    expect([...sheet().querySelectorAll("img")].map((i) => i.getAttribute("src"))).toContain(OLD);
    await w.emit(NEW);
    expect([...sheet().querySelectorAll("img")].map((i) => i.getAttribute("src"))).not.toContain(OLD);
    expect([...sheet().querySelectorAll("img")].map((i) => i.getAttribute("src"))).toContain(NEW);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    await waitFor(() => !sheet(), "シートが閉じた");
    expect(host.changeAvatar).toEqual([]);                 // 何も変えていないので書かない
    expect(host.profile.photo).toBe(NEW);
    expect(imgSrcs()).not.toContain(OLD);
  });

  it("(ii') シートで絵柄を選んでいたら、入れ替わっても絵柄の選択はそのまま(写真に戻さない)", async () => {
    const w = makeWatcher();
    await draw(w);
    await click(document.querySelector('button[aria-label="アイコンを変更"]'));
    await waitFor(() => Boolean(sheet()), "シートが開いた");
    await click(sheet().querySelector('[role="radio"][aria-label="dog"]'));
    await w.emit(NEW);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    await waitFor(() => !sheet(), "シートが閉じた");
    expect(host.changeAvatar).toHaveLength(1);
    expect(host.changeAvatar[0]).toMatchObject({ icon: "ic-dog", photo: null });
  });

  it("(iii) 2回入れ替わっても、最後の URL に揃う", async () => {
    const w = makeWatcher();
    await draw(w);
    await w.emit(NEW);
    await w.emit(NEWER);
    expect(myRankRow().querySelector("img").getAttribute("src")).toBe(NEWER);
    expect(imgSrcs()).not.toContain(OLD);
    expect(imgSrcs()).not.toContain(NEW);
    expect(host.profile.photo).toBe(NEWER);
  });

  it("(iii) 同じ合図が2回届いても、描き直す前に続けて届いても、最後の URL のまま", async () => {
    const w = makeWatcher();
    await draw(w);
    await act(async () => { w.cb(NEW); w.cb(NEW); w.cb(NEWER); w.cb(NEWER); });   // 描き直しを挟まずに届く
    expect(host.profile.photo).toBe(NEWER);
    expect(myRankRow().querySelector("img").getAttribute("src")).toBe(NEWER);
    await w.emit(NEWER);                                   // 同じ値がもう一度
    expect(host.profile.photo).toBe(NEWER);
  });

  it("写真以外の変更(同じ photo)の合図では何も書き換えない", async () => {
    const w = makeWatcher();
    await draw(w);
    const before = host.profile;
    await w.emit(OLD);
    expect(host.profile).toBe(before);                     // 親の profile は同じもの(描き直しを起こさない)
  });
});

describe("Avatar ── 写真が読めなかったら、その人の絵柄と色に戻す", () => {
  const drawAvatar = async (props) => {
    await act(async () => { createdRoot().render(<Avatar {...props} />); });
    return _root.host;
  };
  const fail = (img) => act(async () => { img.dispatchEvent(new Event("error")); });

  it("読めなかったら img を外し、その人の絵柄(icon)と色の地にする", async () => {
    const el = await drawAvatar({ icon: "ic-dog", color: 7, photo: OLD, size: 40 });
    expect(el.querySelector("img").getAttribute("src")).toBe(OLD);
    await fail(el.querySelector("img"));
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("use").getAttribute("href")).toBe("#ic-dog");
    expect(el.firstElementChild.style.background).toBe("var(--c-avatar-7)");
  });

  it("絵柄も色も無い人は既定の絵柄と色にする", async () => {
    const el = await drawAvatar({ photo: OLD, size: 24 });
    await fail(el.querySelector("img"));
    expect(el.querySelector("use").getAttribute("href")).toBe(`#${AVATAR_ICONS[0]}`);
    expect(el.firstElementChild.style.background).toBe("var(--c-avatar-1)");
  });

  it("別の URL が来たら、写真をもう一度試す", async () => {
    const el = await drawAvatar({ icon: "ic-dog", color: 7, photo: OLD, size: 40 });
    await fail(el.querySelector("img"));
    await drawAvatar({ icon: "ic-dog", color: 7, photo: NEW, size: 40 });
    expect(el.querySelector("img").getAttribute("src")).toBe(NEW);
  });
});

// ------------------------------------------------------------------
// 【便BH 再審査】写真の保存(判定)の途中でシートを閉じると、選んだ写真が黙って捨てられていた。
//   色(絵柄)を押す → 写真 B を選ぶ(判定へ) → 判定の途中で閉じる → 閉じたときの書き込みが photo: null
//   → 掃除が B を消し、判定は superseded で失敗(閉じているので何も知らされない)
// いまは選んだ時点で下書きに「保存中」の印を置き、閉じても写真を書かない。判定が終われば B が載る。
// ------------------------------------------------------------------
describe("写真の保存の途中でシートを閉じても、選んだ写真は捨てられない", () => {
  const B = "https://firebasestorage.googleapis.com/v0/b/b/o/avatars%2Fme%2FB.webp?alt=media&token=tb";
  beforeEach(() => {
    saves.length = 0;
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
  });
  const pick = async () => {
    const input = sheet().querySelector('label[role="radio"] input[type="file"]');
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "b.jpg", type: "image/jpeg", size: 1 }] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await waitFor(() => saves.length === 1, "保存(判定)が始まった");
  };
  const openSheet = async () => {
    await click(document.querySelector('button[aria-label="アイコンを変更"]'));
    await waitFor(() => Boolean(sheet()), "シートが開いた");
  };
  const closeSheet = async () => {
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    await waitFor(() => !sheet(), "シートが閉じた");
  };

  it("色を押してから写真を選び、判定の途中で閉じても、写真を null にせず、判定が終われば B が載る", async () => {
    const w = makeWatcher();
    await draw(w);
    await openSheet();
    await click(sheet().querySelector('[role="radio"][aria-label="cat"]'));   // 絵柄を変える(下書きの写真が null になる)
    await pick();                                         // 写真 B を選んだ(判定中)
    await closeSheet();                                   // 判定の途中で閉じる
    expect(host.changeAvatar).toHaveLength(1);
    expect(host.changeAvatar[0]).toMatchObject({ icon: "ic-cat", keepPhoto: true });
    expect(host.changeAvatar[0].photo).not.toBeNull();    // 写真を消す答えを出していない
    expect(host.profile.photo).toBe(OLD);                 // 手元の写真も消していない
    await act(async () => { saves[0].resolve(B); });      // 判定が終わる
    await waitFor(() => host.profile.photo === B, "B が載った");
    expect(myRankRow().querySelector("img").getAttribute("src")).toBe(B);
  });

  it("判定の途中で閉じて開き直し、絵柄を押してから閉じても、写真を null にしない", async () => {
    const w = makeWatcher();
    await draw(w);
    await openSheet();
    await pick();                                         // 写真 B を選んだ(判定中)
    await closeSheet();                                   // 何も変えていないので書かない
    expect(host.changeAvatar).toHaveLength(0);
    await openSheet();                                    // 判定の途中で開き直す
    await click(sheet().querySelector('[role="radio"][aria-label="cat"]'));
    await closeSheet();
    expect(host.changeAvatar).toHaveLength(1);
    expect(host.changeAvatar[0]).toMatchObject({ icon: "ic-cat", keepPhoto: true });
    await act(async () => { saves[0].resolve(B); });
    await waitFor(() => host.profile.photo === B, "B が載った");
  });

  it("保存が失敗して終わったあとなら、絵柄を選んで閉じれば今までどおり写真を消す", async () => {
    const w = makeWatcher();
    await draw(w);
    await openSheet();
    await pick();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { saves[0].reject(Object.assign(new Error("photo-rejected: adult"), { code: "functions/failed-precondition" })); });
    await waitFor(() => !sheet().querySelector("[data-photo-ring]"), "保存の輪が消えた");
    spy.mockRestore();
    await click(sheet().querySelector('[role="radio"][aria-label="cat"]'));
    await closeSheet();
    expect(host.changeAvatar).toHaveLength(1);
    expect(host.changeAvatar[0]).toEqual({ icon: "ic-cat", iconColor: MY_PROFILE.iconColor, photo: null });
  });

  it("判定の途中で写真が外された(superseded)ときは、文言を出さない", async () => {
    const w = makeWatcher();
    await draw(w);
    await openSheet();
    await pick();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { saves[0].reject(Object.assign(new Error("photo-superseded: superseded"), { code: "functions/aborted" })); });
    await waitFor(() => !sheet().querySelector("[data-photo-ring]"), "保存の輪が消えた");
    expect(sheet().textContent).not.toMatch(/電波の良いところ|使えません|読み取れません/);
    spy.mockRestore();
  });

  it("通信の失敗のときは、今までどおり文言を出す", async () => {
    const w = makeWatcher();
    await draw(w);
    await openSheet();
    await pick();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { saves[0].reject(Object.assign(new Error("photo-unavailable: no-verdict"), { code: "functions/unavailable" })); });
    await waitFor(() => /電波の良いところ/.test(sheet().textContent), "通信の文言が出た");
    spy.mockRestore();
  });
});
