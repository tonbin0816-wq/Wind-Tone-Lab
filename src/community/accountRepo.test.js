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
const updateDoc = vi.fn();
const onSnapshot = vi.fn();

vi.mock("firebase/firestore", () => ({
  doc: (...args) => ({ __ref: args.slice(1).join("/") }),
  setDoc: (...args) => setDoc(...args),
  getDoc: (...args) => getDoc(...args),
  updateDoc: (...args) => updateDoc(...args),
  deleteDoc: vi.fn(),
  onSnapshot: (...args) => onSnapshot(...args),
}));
vi.mock("firebase/auth", () => ({
  signInAnonymously: vi.fn(),
  onAuthStateChanged: vi.fn(),
  deleteUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("./firebaseClient.js", () => ({ getFirebase: () => ({ db: {}, auth: {} }) }));
vi.mock("./idealRepo.js", () => ({ unpublishAllIdeals: vi.fn() }));

const { saveProfile, setProfileAvatar, watchMyPhoto } = await import("./accountRepo.js");
// 【便AH 重2】シートを閉じたときに何を書くかを決める純関数。
// 「色を押してから写真を選ぶ」順を**端から端まで**通すために、ここで一緒に使う。
const { avatarWriteOnClose } = await import("./avatarPhoto.js");

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
  updateDoc.mockReset();
  onSnapshot.mockReset();
  setDoc.mockResolvedValue(undefined);
  updateDoc.mockResolvedValue(undefined);
});

// ------------------------------------------------------------------
// 【重2 2026-09-23 審査役の指摘】
// 「色を試してから、やっぱり写真にする」順で、成功表示が出た写真が黙って消えていた。
// 判断(avatarWriteOnClose)と書き込み(setProfileAvatar)を**繋いだまま**確かめる。
// 片方だけ直しても、もう片方が無条件に null を書けば同じ事故が戻るため。
// ------------------------------------------------------------------
describe("アイコンのシートを閉じたときの書き込み", () => {
  const URL = "https://example.test/mine.webp";
  const close = async (draft, saved) => {
    const w = avatarWriteOnClose({ draft, saved });
    if (w) await setProfileAvatar("u1", w);
    return w;
  };
  const patch = () => updateDoc.mock.calls[0][1];

  it("色を変えてから写真を選んで閉じても、写真のキーを1文字も書かない", async () => {
    // ① 開く → ② 色を押す(下書きの写真は null になる) → ③ 写真が載る → ④ 閉じる
    const w = await close(
      { icon: "ic-cat", iconColor: 7, photo: URL },
      { icon: "ic-cat", iconColor: 1, photo: URL },
    );
    expect(w).not.toBeNull();                 // 色が変わったので書く
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(patch()).toEqual({ icon: "ic-cat", iconColor: 7 });
    expect("photo" in patch()).toBe(false);   // ← ここが重2。null を書けば落ちる
  });

  it("絵柄を選んで閉じたら、写真を消す(決定4)", async () => {
    await close(
      { icon: "ic-dog", iconColor: 1, photo: null },
      { icon: "ic-cat", iconColor: 1, photo: URL },
    );
    expect(patch()).toEqual({ icon: "ic-dog", iconColor: 1, photo: null });
  });

  it("何も変えずに閉じたら1度も書かない", async () => {
    const w = await close(
      { icon: "ic-cat", iconColor: 1, photo: URL },
      { icon: "ic-cat", iconColor: 1, photo: URL },
    );
    expect(w).toBeNull();
    expect(updateDoc).not.toHaveBeenCalled();
  });

  // 【便BH 再審査】色を押してから写真を選び、**判定の途中で閉じた**。下書きの写真は null だが
  // 「保存中」の印がある。以前は null を書き、掃除が判定中の写真を消していた(閉じたので何も知らされない)。
  it("写真の保存の途中で閉じたら、色・絵柄だけを書き、写真のキーは1文字も書かない", async () => {
    const w = await close(
      { icon: "ic-cat", iconColor: 7, photo: null, photoSaving: true },
      { icon: "ic-cat", iconColor: 1, photo: URL },
    );
    expect(w).toMatchObject({ keepPhoto: true });
    expect(patch()).toEqual({ icon: "ic-cat", iconColor: 7 });
  });

  it("写真を持たない人でも、保存の途中で閉じたら null を書かない", async () => {
    await close(
      { icon: "ic-dog", iconColor: 3, photo: null, photoSaving: true },
      { icon: "ic-cat", iconColor: 1, photo: null },
    );
    expect(patch()).toEqual({ icon: "ic-dog", iconColor: 3 });
  });

  it("写真を持たない人が色だけ変えたときは、今までどおり null を書く", async () => {
    await close(
      { icon: "ic-cat", iconColor: 5, photo: null },
      { icon: "ic-cat", iconColor: 1, photo: null },
    );
    expect(patch()).toEqual({ icon: "ic-cat", iconColor: 5, photo: null });
  });
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

  // 【便AH 2026-09-23】写真も stats と同じ理由で連れて行く。
  // クライアントは写真の値を書けない(決定6)ので、置き換えで落とすと**二度と戻せない**。
  it("写真は持ち越す(プロフィールを編集しても消えない)", async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ ...docOf(["alto"]), photo: "https://example.test/a.webp" }),
    });
    await saveProfile("u1", docOf(["alto"]));
    expect(setDoc.mock.calls[0][1].photo).toBe("https://example.test/a.webp");
  });

  it("写真を持たない人には photo を書かない(空の欄を作らない)", async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => docOf(["alto"]) });
    await saveProfile("u1", docOf(["alto"]));
    expect("photo" in setDoc.mock.calls[0][1]).toBe(false);
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

// ------------------------------------------------------------------
// 【便BH 2026-10-01 本人裁定 (a) → 差し戻し(不合格2)】自分の users.photo を見張る道具(watchMyPhoto)。
// 最初の版(followPhotoChange)は「写真が変わるまで1回だけ」だったが、関数より早く公開に戻した場合・
// 2回入れ替わった場合に古い URL が手元に残るので、参加中の画面がある間ずっと見張る形にした。
// ここでは道具の振る舞い(何を渡し、いつ外れるか)を onSnapshot の作り物で確かめる。
// 画面の側(届いた値で profile と一覧を直す)は photoWatch.test.jsx が本物の画面を描いて確かめる。
// ------------------------------------------------------------------
describe("watchMyPhoto ── 参加中の画面がある間、自分の写真を見張る", () => {
  const OLD = "https://example.test/o/avatars%2Fu1%2Fr.webp?alt=media&token=t0";
  const NEW = "https://example.test/o/avatars%2Fu1%2Fr.webp?alt=media&token=t1";
  const snap = (data) => ({ exists: () => data !== null, data: () => data });
  const arm = () => {
    const unsub = vi.fn();
    let emit = null;
    let fail = null;
    onSnapshot.mockImplementation((ref, next, error) => { emit = next; fail = error; return unsub; });
    const got = vi.fn();
    const stop = watchMyPhoto("u1", got);
    return { unsub, got, stop, emit: (d) => emit(snap(d)), fail: (e) => fail(e) };
  };

  it("自分の users を1つだけ見張る", () => {
    arm();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot.mock.calls[0][0]).toEqual({ __ref: "users/u1" });
  });

  it("届くたびに、いまの photo を渡す(1回で止めない ── 2回入れ替わっても両方届く)", () => {
    const w = arm();
    w.emit({ isPublic: false, photo: OLD });
    w.emit({ isPublic: false, photo: NEW });
    w.emit({ isPublic: true, photo: "https://example.test/third" });
    expect(w.got.mock.calls.map((c) => c[0])).toEqual([OLD, NEW, "https://example.test/third"]);
    expect(w.unsub).not.toHaveBeenCalled();
  });

  it("写真が無い・文書が無いときは null を渡す", () => {
    const w = arm();
    w.emit({ isPublic: true });
    w.emit(null);
    expect(w.got.mock.calls.map((c) => c[0])).toEqual([null, null]);
  });

  it("返した関数で外せる(画面を離れたとき)", () => {
    const w = arm();
    expect(w.stop).toBe(w.unsub);
    w.stop();
    expect(w.unsub).toHaveBeenCalledTimes(1);
  });

  it("見張れなかったら記録を残す(画面は止めない)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = arm();
    w.fail(Object.assign(new Error("denied"), { code: "permission-denied" }));
    expect(w.got).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// 【綴りの検査 ── 振る舞いは photoWatch.test.jsx】CommunityTabBody は Firebase に繋がないと描けないので、
// 「本物の見張りを JoinedView に渡している」「届いた写真をその時点の profile に重ねる」
// 「保存のあとに手元の写真と練習記録を持ち越す」の3つの配線は綴りでしか守れない。
describe("参加中の画面への配線(便BH 差し戻し・綴り)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./CommunityTab.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const body = src.slice(src.indexOf("function CommunityTabBody("));

  it("本物の見張り(watchMyPhoto)を JoinedView に渡している", () => {
    expect(body).toMatch(/watchPhoto=\{watchMyPhoto\}/);
  });

  it("届いた写真は、その時点の profile に重ねる(続けて届いても巻き戻さない)", () => {
    expect(body).toMatch(/onPhotoChanged=\{\(photo\) => \{[\s\S]{0,300}?setProfile\(\(p\) => \(p \? \{ \.\.\.p, photo \} : p\)\);/);
  });

  it("プロフィールの保存のあと、手元の写真と練習記録を持ち越す", () => {
    expect(body).toMatch(/setProfile\(profileAfterSave\(profile, r\.doc\)\);/);
    expect(body).not.toMatch(/setProfile\(r\.doc\)/);
  });

  it("公開の切り替え・アイコンの変更のあとも、その時点の profile に重ねる(見張りが届けた URL を巻き戻さない)", () => {
    expect(body).toMatch(/setProfile\(\(p\) => \(p \? \{ \.\.\.p, isPublic: v \} : p\)\);/);
    expect(body).toMatch(/setProfile\(\(p\) => \(p \? \{ \.\.\.p, icon: v\.icon, iconColor: v\.iconColor, \.\.\.\(v\.photo === null && !v\.keepPhoto \? \{ photo: null \} : \{\}\) \} : p\)\);/);
    expect(body).not.toMatch(/setProfile\(\{ \.\.\.profile, /);
  });

  it("最初の版の「1回だけの見張り」は残っていない", () => {
    expect(src).not.toMatch(/followPhotoChange|photoWatch/);
  });
});
