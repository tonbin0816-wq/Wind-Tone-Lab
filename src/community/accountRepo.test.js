// プロフィールの保存の振る舞いを、綴りではなく**実際に呼ばれた引数**で確かめる。
//
// 【なぜこの試験が要るのか】2026-09-21、本人の端末で「サーバーに保存を拒否されました」が
// 出続ける状態になった。原因は前日に入れた `setDoc(..., { merge: true })`。
// merge は**入れ子の辞書をキーごとに混ぜる**ので、楽器種別を1つ外して保存しても
// サーバ側の `gear` には外した種別が残り続ける。firestore.rules は
//   gear.keys().hasOnly(saxTypes) / hasAll(saxTypes) / saxTypes.size() == gear.keys().size()
// で「キー集合が saxTypes と完全に一致すること」を求めるので、居残った1つで
// **以後の保存が永久に拒否される**。
//
// このとき pitch-test は 8440 件すべて緑だった ── 綴りを見る検査は
// 「merge で書いている」ことは確かめられても、**merge が何をするか**は知らないため。
// だから「実際に setDoc へ渡った引数」を見る試験をここに置く。

import { describe, it, expect, vi, beforeEach } from "vitest";

const setDoc = vi.fn();
const getDoc = vi.fn();

vi.mock("firebase/firestore", () => ({
  doc: (...args) => ({ __ref: args.slice(1).join("/") }),
  setDoc: (...args) => setDoc(...args),
  getDoc: (...args) => getDoc(...args),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));
vi.mock("firebase/auth", () => ({
  signInAnonymously: vi.fn(),
  onAuthStateChanged: vi.fn(),
  deleteUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("./firebaseClient.js", () => ({ getFirebase: () => ({ db: {}, auth: {} }) }));
vi.mock("./idealRepo.js", () => ({ unpublishAllIdeals: vi.fn() }));

const { saveProfile } = await import("./accountRepo.js");

const docOf = (saxTypes) => ({
  nickname: "てすと",
  icon: "ic-cat",
  iconColor: 1,
  saxTypes,
  position: "社会人",
  startYear: 2015,
  genres: ["クラシック"],
  ensembles: ["吹奏楽"],
  gear: Object.fromEntries(saxTypes.map((t) => [t, { instrumentBrand: null }])),
  deviceClass: "pc",
  isPublic: true,
  ageConfirmed: true,
  updatedAt: "2026-09-21T00:00:00.000Z",
});

beforeEach(() => {
  setDoc.mockReset();
  getDoc.mockReset();
  setDoc.mockResolvedValue(undefined);
});

describe("saveProfile", () => {
  it("merge を使わない（使うと外した楽器種別が gear に居残り、以後の保存が拒否される）", async () => {
    getDoc.mockResolvedValue({ exists: () => false });
    await saveProfile("u1", docOf(["alto"]));
    expect(setDoc).toHaveBeenCalledTimes(1);
    // 第3引数そのものが無いこと。{ merge: false } でも「書いてある」ので通さない。
    expect(setDoc.mock.calls[0]).toHaveLength(2);
  });

  it("楽器種別を減らすと、書き込む gear のキーも減る", async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ ...docOf(["alto", "baritone"]), stats: { daysAll: 3 } }),
    });
    await saveProfile("u1", docOf(["alto"]));
    const written = setDoc.mock.calls[0][1];
    expect(Object.keys(written.gear)).toEqual(["alto"]);
    expect(written.saxTypes).toEqual(["alto"]);
    // ルールが求める「キー集合 == saxTypes」を、書き込む中身そのもので確かめる
    expect(Object.keys(written.gear).sort()).toEqual([...written.saxTypes].sort());
    expect(Object.keys(written.gear)).toHaveLength(written.saxTypes.length);
  });

  it("練習記録は持ち越す（置き換えても消えない）", async () => {
    const stats = { daysThisWeek: 2, daysAll: 30, computedAt: "2026-09-21T00:00:00.000Z" };
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ ...docOf(["alto"]), stats }) });
    await saveProfile("u1", docOf(["alto"]));
    expect(setDoc.mock.calls[0][1].stats).toEqual(stats);
  });

  it("練習記録がまだ無い人には stats を書かない（空の器を作らない）", async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => docOf(["alto"]) });
    await saveProfile("u1", docOf(["alto"]));
    expect("stats" in setDoc.mock.calls[0][1]).toBe(false);
  });

  it("廃止した places は連れて行かない（置き換えのついでに落ちる）", async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ ...docOf(["alto"]), places: ["自宅"], stats: { daysAll: 1 } }),
    });
    await saveProfile("u1", docOf(["alto"]));
    expect("places" in setDoc.mock.calls[0][1]).toBe(false);
  });

  it("読み出しが失敗しても保存そのものは止めない", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getDoc.mockRejectedValue(Object.assign(new Error("unavailable"), { code: "unavailable" }));
    await expect(saveProfile("u1", docOf(["alto"]))).resolves.toBeUndefined();
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect("stats" in setDoc.mock.calls[0][1]).toBe(false);
    expect(spy).toHaveBeenCalled(); // 黙って捨てない
    spy.mockRestore();
  });
});
