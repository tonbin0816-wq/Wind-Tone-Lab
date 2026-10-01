// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  downloadUrlOf, pathOfDownloadUrl, tokenOfDownloadUrl, photoRevAt, photoRevKeyOf, isOlderPhoto,
  monotonicClock, shouldRevokePhotoUrl, uploadOrderOf,
} from "../../functions/avatarVerdict.js";

// ------------------------------------------------------------------
// 【便BH 2026-10-01 本人裁定】写真の2つの穴を、**functions/index.js をそのまま**走らせて確かめる。
//   (a) 公開をやめたら、古い写真の URL を効かなくする(鍵の入れ替え)
//   (b) 同じ人がほぼ同時に2枚上げても、最後に上げた写真が必ず残る
// 【便BH 差し戻し】(b) の物差しを「上げた順」に、(a) の手順を「古い,新しい → users → 新しい」に、
// 掃除を「合図の時刻より前の版だけ」にした。それぞれの反例をここに足した。
//
// 【何を作り物にしたか】Firestore と Storage の **Admin SDK だけ**(と Vision)。
// index.js の配線(トランザクション・一覧・鍵の書き換え)と avatarJobs の判断は本物が走る。
//
// 【作り物は本物より甘くしない(罠19)】
//  ・トランザクションは、読んだ文書が書く前に変わっていたら**やり直す**(本物と同じ直列化)
//  ・鍵付き URL は「実体が在り、鍵が firebaseStorageDownloadTokens(カンマ区切り)に在る」ときだけ読める
//  ・置き場の上げ直しのたびに timeCreated と generation が進む(本物と同じく、同じ名前でも世代は別)
//  ・delete は ifGenerationMatch を守る(合わなければ 412)。setMetadata は実体が無ければ 404
//  ・users の書き込みはすべて時刻つきで記録し、cleanAvatarPhoto を起動し直せる(onDocumentWritten の代わり)。
//    合図の二重配信と、順番の入れ替わりも作れる(settle の duplicate / reverse)
//  ・途中で止める栓(hooks)を持ち、2本の関数の進み方を順番どおりに交差させられる
//  ・Storage と Firestore は**同じ時計**(clock)で時刻を打つ(上げた時刻と合図の時刻を比べられる)
//
// 【モジュールの差し替えは functions/node_modules の実体の道で行う】index.js が import する
// "firebase-admin/firestore" などは functions/node_modules から解決されるので、
// 名前("firebase-admin/firestore")で vi.mock しても index.js には効かない(実測で本物が走った)。
// ------------------------------------------------------------------

const world = vi.hoisted(() => ({ fs: null, st: null, vision: null }));
vi.mock("../../functions/node_modules/firebase-admin/lib/esm/app/index.js", () => ({ initializeApp: () => ({}) }));
vi.mock("../../functions/node_modules/firebase-admin/lib/esm/firestore/index.js", () => ({ getFirestore: () => world.fs }));
vi.mock("../../functions/node_modules/firebase-admin/lib/esm/storage/index.js", () => ({
  getStorage: () => ({ bucket: () => world.st.bucket }),
}));
vi.mock("../../functions/node_modules/@google-cloud/vision/build/src/index.js", () => ({
  ImageAnnotatorClient: class { safeSearchDetection(req) { return world.vision(req); } },
}));

const CLEAN = { adult: "VERY_UNLIKELY", violence: "UNLIKELY", racy: "UNLIKELY", medical: "VERY_UNLIKELY" };
const BUCKET = "b1.appspot.com";
const UPLOAD = "avatarUploads/u1/photo.webp";
const T0 = 1_759_276_800_000;   // 2026-10-01T00:00:00Z

/** 外から開ける栓。 */
function gate() {
  let open;
  const p = new Promise((r) => { open = r; });
  return { wait: () => p, open: () => open() };
}
/** cond が真になるまで待つ(マイクロタスクとタイマーを回す)。 */
async function until(cond, label) {
  for (let i = 0; i < 500; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`待ちきれなかった: ${label}`);
}
const gone = () => Object.assign(new Error("No such object"), { code: 404 });

// ---------------------------------------------------------------- 共通の時計
function makeClock() {
  let ms = T0;
  return { tick: (step = 1000) => (ms += step), now: () => ms };
}

// ---------------------------------------------------------------- Firestore(Admin)の作り物
function makeFirestore(clock) {
  const docs = new Map();            // path → { data, version }
  const log = [];                    // users の書き込み { path, before, after, by, time }
  const hooks = { beforeCommit: null };
  let txCount = 0;
  const snapOf = (path) => {
    const d = docs.get(path);
    return { exists: !!d, get: (k) => d?.data?.[k], data: () => (d ? { ...d.data } : undefined) };
  };
  const write = (path, data, merge, by) => {
    const before = docs.get(path)?.data ?? null;
    const after = merge ? { ...(before ?? {}), ...data } : { ...data };
    docs.set(path, { data: after, version: (docs.get(path)?.version ?? 0) + 1 });
    log.push({ path, before: before && { ...before }, after: { ...after }, by, time: new Date(clock.tick()).toISOString() });
  };
  const fs = {
    doc: (path) => ({ path, get: async () => snapOf(path) }),
    async runTransaction(fn) {
      const n = ++txCount;
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map();
        const writes = [];
        const tx = {
          get: async (ref) => { reads.set(ref.path, docs.get(ref.path)?.version ?? 0); return snapOf(ref.path); },
          set: (ref, data, opts) => { writes.push({ path: ref.path, data, merge: !!opts?.merge }); return tx; },
        };
        const result = await fn(tx);
        if (hooks.beforeCommit) await hooks.beforeCommit(n, attempt);
        // 読んでから書くまでに変わっていたら、やり直し(本物と同じく、関数の頭から)。
        const stale = [...reads].some(([p, v]) => (docs.get(p)?.version ?? 0) !== v);
        if (stale) continue;
        for (const w of writes) write(w.path, w.data, w.merge, "function");
        return result;
      }
      throw new Error("ABORTED: too much contention");
    },
  };
  return {
    fs, docs, log, hooks,
    seed: (path, data) => docs.set(path, { data: { ...data }, version: 1 }),
    /** 端末(クライアント)の updateDoc の代わり。記録に残るので cleanAvatarPhoto の合図になる。 */
    clientUpdate: (path, patch) => write(path, patch, true, "client"),
    /** 端末の deleteDoc(アカウント削除)の代わり。 */
    clientDelete: (path) => {
      const before = docs.get(path)?.data ?? null;
      docs.delete(path);
      log.push({ path, before: before && { ...before }, after: null, by: "client", time: new Date(clock.tick()).toISOString() });
    },
    /** 判定の関数以外(別の関数)が users を書き換えた形を、合図を残さずに作る。 */
    poke: (path, patch) => { const d = docs.get(path); d.data = { ...d.data, ...patch }; d.version += 1; },
    photo: (uid) => docs.get(`users/${uid}`)?.data?.photo ?? null,
    txCount: () => txCount,
  };
}

// ---------------------------------------------------------------- Storage(Admin)の作り物
function makeStorage(clock) {
  const objects = new Map();         // name → { bytes, contentType, tokens, timeCreated, generation }
  const hooks = { afterSave: null, beforeSetMetadata: null, beforeGetFiles: null };
  const calls = { setMetadata: [], deleted: [] };
  let gen = 1_000_000;
  const opts = { noTimes: false };
  const file = (p) => ({
    name: p,
    exists: async () => [objects.has(p)],
    getMetadata: async () => {
      const o = objects.get(p);
      if (!o) throw gone();
      const times = opts.noTimes ? {} : { timeCreated: o.timeCreated, generation: o.generation };
      return [{ size: o.bytes.length, contentType: o.contentType, metadata: { firebaseStorageDownloadTokens: o.tokens }, ...times }];
    },
    download: async () => { const o = objects.get(p); if (!o) throw gone(); return [o.bytes]; },
    save: async (bytes, o2) => {
      objects.set(p, {
        bytes, contentType: o2?.contentType, cacheControl: o2?.metadata?.cacheControl,
        tokens: o2?.metadata?.metadata?.firebaseStorageDownloadTokens ?? null,
        timeCreated: new Date(clock.now()).toISOString(), generation: String(++gen),
      });
      if (hooks.afterSave) await hooks.afterSave(p, bytes);
    },
    setMetadata: async (md) => {
      if (hooks.beforeSetMetadata) await hooks.beforeSetMetadata(p, md, calls.setMetadata.length);
      const o = objects.get(p);
      if (!o) throw gone();
      // 本物と同じく、名指しした自前の項目だけを書き換える(他は残る)。
      const custom = md?.metadata ?? {};
      if ("firebaseStorageDownloadTokens" in custom) o.tokens = custom.firebaseStorageDownloadTokens;
      calls.setMetadata.push({ path: p, token: custom.firebaseStorageDownloadTokens });
      return [{}];
    },
    delete: async (o2) => {
      const o = objects.get(p);
      if (!o) throw gone();
      if (o2?.ifGenerationMatch !== undefined && String(o2.ifGenerationMatch) !== o.generation) {
        throw Object.assign(new Error("precondition failed"), { code: 412 });
      }
      objects.delete(p);
      calls.deleted.push(p);
    },
  });
  const bucket = {
    name: BUCKET,
    file,
    getFiles: async ({ prefix }) => {
      const names = [...objects.keys()].filter((k) => k.startsWith(prefix));
      if (hooks.beforeGetFiles) await hooks.beforeGetFiles(prefix);
      return [names.map(file)];
    },
  };
  return {
    bucket, objects, hooks, calls, opts,
    /** 端末が置き場へ上げる / 既に在る写真を置く。上げるたびに時刻と世代が進む。 */
    put: (p, bytes, contentType = "image/webp", tokens = null, { at = clock.tick() } = {}) => objects.set(p, {
      bytes, contentType, tokens, timeCreated: new Date(at).toISOString(), generation: String(++gen),
    }),
    /** Firebase の取り出し口と同じ判定: 実体が在り、URL の鍵が実体の鍵の並びに在る。 */
    canFetch: (url) => {
      const o = objects.get(pathOfDownloadUrl(url));
      const t = tokenOfDownloadUrl(url);
      return !!o && !!t && String(o.tokens ?? "").split(",").includes(t);
    },
    avatarsOf: (uid) => [...objects.keys()].filter((k) => k.startsWith(`avatars/${uid}/`)).sort(),
  };
}

const webp = (tag) => Buffer.concat([Buffer.from("RIFF    WEBP", "latin1"), Buffer.from(tag)]);
const tagOf = (bytes) => Buffer.from(bytes).subarray(12).toString();
/** 写真の版(時刻・世代・乱数)。 */
const rv = (ms, gen = "0", salt = "abcd1234") => photoRevAt(ms, gen, salt);

let fns;
let C;   // 共通の時計
let F;   // Firestore の作り物
let S;   // Storage の作り物
let invocations;

beforeEach(async () => {
  C = makeClock();
  F = makeFirestore(C);
  S = makeStorage(C);
  world.fs = F.fs;
  world.st = S;
  world.vision = async () => [{ safeSearchAnnotation: CLEAN }];
  invocations = 0;
  fns ??= await import("../../functions/index.js");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  return () => vi.restoreAllMocks();
}, 30_000);

const eventOf = (w) => ({
  params: { uid: w.path.split("/")[1] },
  time: w.time,
  data: { before: { data: () => w.before }, after: { data: () => w.after } },
});

/**
 * users の書き込みの記録を cleanAvatarPhoto へ流す(onDocumentWritten の代わり)。
 * 関数自身の書き込みもまた合図になる。cap 回を越えたら「止まらない」として落とす。
 *  ・duplicate: 同じ合図を2回ずつ届ける(本物は「少なくとも1回」なので、2回届くことがある)
 *  ・reverse:   その時点で溜まっている合図を、新しい順(逆順)に届ける(順番は保証されない)
 */
async function settle({ from = 0, cap = 12, duplicate = false, reverse = false } = {}) {
  let i = from;
  while (i < F.log.length) {
    const batch = F.log.slice(i);
    i = F.log.length;
    const order = reverse ? [...batch].reverse() : batch;
    for (const w of order) {
      for (let k = 0; k < (duplicate ? 2 : 1); k++) {
        if (invocations >= cap) throw new Error(`cleanAvatarPhoto が止まらない(${invocations}回)`);
        invocations += 1;
        await fns.cleanAvatarPhoto.run(eventOf(w));
      }
    }
  }
  return i;
}
/** 写真の URL が「無い」か「読める」か(読めない URL を指したまま残っていない)。 */
const photoIsSound = (uid) => F.photo(uid) === null || S.canFetch(F.photo(uid));

// ================================================================ 純関数
describe("版の物差しと新旧(便BH (b) / 差し戻し)", () => {
  it("版は「時刻 → 世代 → 乱数」の順に並ぶ(文字列のままでも、鍵で比べても)", () => {
    const a = rv(1_700_000_000_000, "999", "ffff");
    const b = rv(1_700_000_000_001, "1", "0000");
    expect(a < b).toBe(true);
    expect(isOlderPhoto(`avatars/u1/${a}.webp`, `avatars/u1/${b}.jpg`)).toBe(true);
    expect(isOlderPhoto(`avatars/u1/${b}.jpg`, `avatars/u1/${a}.webp`)).toBe(false);
    expect(isOlderPhoto(`avatars/u1/${a}.webp`, `avatars/u1/${a}.webp`)).toBe(false); // 自分自身は古くない
  });

  // 【差し戻し: 変異 M21 が生き残っていた】同じミリ秒どうしの決め方を固定する。
  it("同じミリ秒なら世代の大きいほうが新しい(上げ直すと世代は必ず進む)", () => {
    const first = `avatars/u1/${rv(T0, "1759276800000001", "ffffffff")}.webp`;
    const second = `avatars/u1/${rv(T0, "1759276800000002", "00000000")}.webp`;
    expect(isOlderPhoto(first, second)).toBe(true);
    expect(isOlderPhoto(second, first)).toBe(false);
    // 桁数が違う世代でも数の大小で比べる(20桁にそろえてあるので文字列で比べても数の順)
    const short = `avatars/u1/${rv(T0, "9", "ffffffff")}.webp`;
    const long = `avatars/u1/${rv(T0, "10", "00000000")}.webp`;
    expect(isOlderPhoto(short, long)).toBe(true);
    expect(isOlderPhoto(long, short)).toBe(false);
  });

  it("同じミリ秒・同じ世代なら乱数の並びで決まり、必ずどちらか一方だけが古い", () => {
    const a = `avatars/u1/${rv(T0, "5", "aaaaaaaa")}.webp`;
    const b = `avatars/u1/${rv(T0, "5", "bbbbbbbb")}.webp`;
    expect(isOlderPhoto(a, b)).toBe(true);
    expect(isOlderPhoto(b, a)).toBe(false);
  });

  it("置き場のメタデータから上げた順を取り出す。取れなければ関数に入った時刻", () => {
    expect(uploadOrderOf({ timeCreated: "2026-10-01T00:00:01.234Z", generation: "1759276801234567" }, 5))
      .toEqual({ ms: Date.parse("2026-10-01T00:00:01.234Z"), gen: "1759276801234567" });
    expect(uploadOrderOf({}, 4242)).toEqual({ ms: 4242, gen: "0" });
    expect(uploadOrderOf({ timeCreated: "壊れた", generation: "12a" }, 7)).toEqual({ ms: 7, gen: "0" });
    expect(uploadOrderOf(null, 9)).toEqual({ ms: 9, gen: "0" });
  });

  it("前の形(乱数16桁)の写真は、時刻を持つどの写真よりも古い", () => {
    const legacy = "avatars/u1/0123456789abcdef.webp";
    expect(photoRevKeyOf(legacy).time).toBe(0);
    expect(isOlderPhoto(legacy, `avatars/u1/${rv(1)}.webp`)).toBe(true);
    expect(isOlderPhoto(`avatars/u1/${rv(1)}.webp`, legacy)).toBe(false);
  });

  it("読めない形・別の人の写真は「古い」と言わない(消してよいと言い切れないものは消さない)", () => {
    const mine = `avatars/u1/${rv(5)}.webp`;
    expect(isOlderPhoto(`avatars/u2/${rv(1)}.webp`, mine)).toBe(false);
    expect(isOlderPhoto("avatars/u1/notes.txt", mine)).toBe(false);
    expect(isOlderPhoto(`avatars/u1/${rv(1)}.webp`, null)).toBe(false);
    expect(isOlderPhoto(null, mine)).toBe(false);
  });

  it("時計は同じミリ秒の中で2回呼ばれても必ず増える", () => {
    const tick = monotonicClock(() => 1000);
    expect([tick(), tick(), tick()]).toEqual([1000, 1001, 1002]);
    const back = monotonicClock(((xs) => () => xs.shift())([5000, 4000]));
    expect(back()).toBe(5000);
    expect(back()).toBe(5001);   // 時計が戻っても戻らない
  });

  it("鍵の入れ替えは「公開(true)→ 非公開(false)」のときだけ", () => {
    expect(shouldRevokePhotoUrl({ isPublic: true }, { isPublic: false })).toBe(true);
    expect(shouldRevokePhotoUrl({ isPublic: false }, { isPublic: true })).toBe(false);
    expect(shouldRevokePhotoUrl({ isPublic: false }, { isPublic: false })).toBe(false);
    expect(shouldRevokePhotoUrl({ isPublic: true }, { isPublic: true })).toBe(false);
    expect(shouldRevokePhotoUrl(null, { isPublic: false })).toBe(false);
    expect(shouldRevokePhotoUrl({ isPublic: true }, null)).toBe(false);   // 文書ごと消えた(削除)は掃除の側
  });

  it("URL から鍵を取り出せる(downloadUrlOf の逆)", () => {
    expect(tokenOfDownloadUrl(downloadUrlOf(BUCKET, "avatars/u1/r.webp", "tok-1"))).toBe("tok-1");
    expect(tokenOfDownloadUrl("https://example.com/x.webp")).toBeNull();
    expect(tokenOfDownloadUrl(null)).toBeNull();
  });
});

// ================================================================ (a) 公開をやめたら古い URL を効かなくする
describe("cleanAvatarPhoto ── 便BH (a): 公開をやめたら鍵を入れ替え、users.photo を書き直す", () => {
  const P = `avatars/u1/${rv(T0 - 60_000, "1", "abcd1234")}.webp`;
  const url0 = downloadUrlOf(BUCKET, P, "t0");
  const seedPublic = (extra = {}) => {
    S.put(P, webp("me"), "image/webp", "t0", { at: T0 - 60_000 });
    F.seed("users/u1", { nickname: "て", isPublic: true, photo: url0, ...extra });
  };

  it("true → false で、古い鍵の URL は読めなくなり、新しい URL が users.photo に入って読める", async () => {
    seedPublic();
    expect(S.canFetch(url0)).toBe(true);
    F.clientUpdate("users/u1", { isPublic: false });       // 端末が公開スイッチを切った
    await settle();
    const now = F.photo("u1");
    expect(now).not.toBe(url0);
    expect(pathOfDownloadUrl(now)).toBe(P);                 // 同じ実体のまま(上げ直していない)
    expect(S.canFetch(url0)).toBe(false);                   // 公開中に配られた URL はもう読めない
    expect(S.canFetch(now)).toBe(true);                     // 本人の画面は新しい URL で出る
    expect(S.objects.get(P).tokens).toBe(tokenOfDownloadUrl(now)); // 最後は鍵1つだけ
    // 書いたのは photo だけ(他の項目を巻き添えにしない)
    expect(F.docs.get("users/u1").data).toEqual({ nickname: "て", isPublic: false, photo: now });
  });

  // 【差し戻し(統括裁定1)】途中で落ちても、users.photo が読めない URL を指したまま残らない順番。
  it("手順は「古い,新しい」→ users を書き直す → 新しい1つ、の順", async () => {
    seedPublic();
    const seen = [];
    S.hooks.beforeSetMetadata = async (p, md) => { seen.push({ tokens: md.metadata.firebaseStorageDownloadTokens, photo: F.photo("u1") }); };
    F.clientUpdate("users/u1", { isPublic: false });
    await settle();
    const t1 = tokenOfDownloadUrl(F.photo("u1"));
    expect(seen).toEqual([
      { tokens: `t0,${t1}`, photo: url0 },                  // users を書き直す前に、両方読める形にする
      { tokens: t1, photo: F.photo("u1") },                 // users を書き直したあとで、新しい1つにする
    ]);
  });

  it("users の書き直しで落ちても、users.photo は読める URL のまま(古い鍵も新しい鍵も生きている)", async () => {
    seedPublic();
    F.hooks.beforeCommit = async () => { throw new Error("UNAVAILABLE"); };
    F.clientUpdate("users/u1", { isPublic: false });
    await expect(settle()).rejects.toThrow(/UNAVAILABLE/);
    expect(F.photo("u1")).toBe(url0);
    expect(S.canFetch(url0)).toBe(true);
  });

  it("最後に鍵を1つにするところで落ちても、新しい URL は読める", async () => {
    seedPublic();
    S.hooks.beforeSetMetadata = async (p, md, n) => { if (n === 1) throw new Error("UNAVAILABLE"); };
    F.clientUpdate("users/u1", { isPublic: false });
    await expect(settle()).rejects.toThrow(/UNAVAILABLE/);
    expect(F.photo("u1")).not.toBe(url0);
    expect(S.canFetch(F.photo("u1"))).toBe(true);
  });

  it("実体が在ると確かめたあとで消えていたら(setMetadata の 404)、静かに終える", async () => {
    seedPublic();
    S.hooks.beforeSetMetadata = async (p) => { S.objects.delete(p); };
    F.clientUpdate("users/u1", { isPublic: false });
    await settle();                                         // 投げない
    expect(F.photo("u1")).toBe(url0);                       // users は書き換えない
    expect(F.log.filter((w) => w.by === "function")).toHaveLength(0);
  });

  it("自分の書き直しでもう一度起動しても何もしない(2回で止まる・無限に回らない)", async () => {
    seedPublic();
    F.clientUpdate("users/u1", { isPublic: false });
    await settle();
    expect(invocations).toBe(2);                            // 端末の書き込み1回 + 関数自身の書き直し1回
    expect(F.log.filter((w) => w.by === "function")).toHaveLength(1);
    expect(S.calls.setMetadata).toHaveLength(2);            // 「古い,新しい」と「新しい」の2回だけ
    const second = F.log[1];
    expect(second.before.isPublic).toBe(false);
    expect(second.after.isPublic).toBe(false);
  });

  // 【差し戻し(統括裁定5)】合図は「少なくとも1回」届く。2回届いても、読めない URL を残さず止まる。
  it("合図が2回届いても、最後に users.photo が読め、古い URL は読めない", async () => {
    seedPublic();
    F.clientUpdate("users/u1", { isPublic: false });
    await settle({ duplicate: true });
    expect(F.photo("u1")).not.toBe(url0);
    expect(S.canFetch(F.photo("u1"))).toBe(true);
    expect(S.canFetch(url0)).toBe(false);
    expect(S.objects.get(P).tokens).toBe(tokenOfDownloadUrl(F.photo("u1")));
  });

  it("切る → 入れる の合図が逆順に届いても、最後に users.photo が読め、古い URL は読めない", async () => {
    seedPublic();
    F.clientUpdate("users/u1", { isPublic: false });
    F.clientUpdate("users/u1", { isPublic: true });        // 関数より早く公開に戻した
    await settle({ reverse: true });
    expect(F.photo("u1")).not.toBe(url0);
    expect(S.canFetch(F.photo("u1"))).toBe(true);
    expect(S.canFetch(url0)).toBe(false);
  });

  it("false → true(公開に戻す)では入れ替えない", async () => {
    seedPublic({ isPublic: false });
    F.clientUpdate("users/u1", { isPublic: true });
    await settle();
    expect(S.calls.setMetadata).toHaveLength(0);
    expect(F.photo("u1")).toBe(url0);
    expect(S.canFetch(url0)).toBe(true);
    expect(F.txCount()).toBe(0);
  });

  it("写真が無い人には何もしない", async () => {
    F.seed("users/u1", { nickname: "て", isPublic: true });
    F.clientUpdate("users/u1", { isPublic: false });
    await settle();
    expect(S.calls.setMetadata).toHaveLength(0);
    expect(F.txCount()).toBe(0);
    expect("photo" in F.docs.get("users/u1").data).toBe(false);
  });

  it("photo が avatars/{自分}/ 以外を指していたら何もしない(よその URL・別の人の写真・置き場)", async () => {
    const other = `avatars/u2/${rv(T0, "1", "ffff0000")}.webp`;
    S.put(other, webp("u2"), "image/webp", "tu2");
    for (const photo of ["https://example.com/x.webp", downloadUrlOf(BUCKET, other, "tu2"), downloadUrlOf(BUCKET, UPLOAD, "tx")]) {
      F.seed("users/u1", { isPublic: true, photo });
      F.log.length = 0;
      F.clientUpdate("users/u1", { isPublic: false });
      await settle();
      expect(F.photo("u1")).toBe(photo);
    }
    expect(S.calls.setMetadata).toHaveLength(0);
    expect(S.objects.get(other).tokens).toBe("tu2");      // 別の人の鍵に触っていない
  });

  it("実体が無ければ何もしない(users を書き換えない)", async () => {
    F.seed("users/u1", { isPublic: true, photo: url0 });   // 実体は置かない
    F.clientUpdate("users/u1", { isPublic: false });
    await settle();
    expect(S.calls.setMetadata).toHaveLength(0);
    expect(F.photo("u1")).toBe(url0);
    expect(F.txCount()).toBe(0);
  });

  it("入れ替えている間に新しい写真が載っていたら、その写真を上書きしない", async () => {
    seedPublic();
    const fresh = `avatars/u1/${rv(T0 + 60_000, "9", "00ff00ff")}.webp`;
    S.put(fresh, webp("fresh"), "image/webp", "tf");
    S.hooks.beforeSetMetadata = async () => {
      S.hooks.beforeSetMetadata = null;
      F.poke("users/u1", { photo: downloadUrlOf(BUCKET, fresh, "tf") });   // 判定の関数が新しい写真を載せた
    };
    F.clientUpdate("users/u1", { isPublic: false });
    await settle();
    expect(F.photo("u1")).toBe(downloadUrlOf(BUCKET, fresh, "tf"));
    expect(S.canFetch(F.photo("u1"))).toBe(true);
  });

  // 同じ写真を2本の関数が同時に入れ替える(合図の二重配信・切る → 入れる → 切る を素早く)。
  it("2本が同時に入れ替えても、最後に users.photo の URL が読める", async () => {
    seedPublic();
    const ev = {
      params: { uid: "u1" }, time: new Date(C.tick()).toISOString(),
      data: { before: { data: () => ({ isPublic: true, photo: url0 }) }, after: { data: () => ({ isPublic: false, photo: url0 }) } },
    };
    const metaDone = [];
    S.hooks.beforeSetMetadata = async (p, md) => { metaDone.push(md.metadata.firebaseStorageDownloadTokens); };
    const firstCommit = gate();
    F.hooks.beforeCommit = async (n) => {
      if (n === 1) { await until(() => metaDone.length >= 2, "2本とも鍵を書いた"); firstCommit.open(); }
      if (n === 2) await firstCommit.wait();
    };
    await Promise.all([fns.cleanAvatarPhoto.run(ev), fns.cleanAvatarPhoto.run(ev)]);
    const now = F.photo("u1");
    expect(now).not.toBe(url0);
    expect(S.canFetch(url0)).toBe(false);
    expect(S.canFetch(now)).toBe(true);
    // 負けた側が「いま載っている URL の鍵」に実体を合わせ直した(最後の書き換え)
    expect(S.calls.setMetadata).toHaveLength(4);
    expect(S.calls.setMetadata.at(-1).token).toBe(tokenOfDownloadUrl(now));
  });

  it("写真を外した(photo: null)・文書を消した、は今までどおり掃除の側(鍵は触らない)", async () => {
    seedPublic();
    F.clientUpdate("users/u1", { isPublic: false, photo: null });
    await settle();
    expect(S.calls.setMetadata).toHaveLength(0);
    expect(S.avatarsOf("u1")).toEqual([]);
  });

  it("新しく保存する写真の Cache-Control は private(手前の共有キャッシュに古い鍵の応答を持たせない)", async () => {
    S.put(UPLOAD, webp("Solo"), "image/webp");
    const r = await fns.vetAvatarPhoto.run({ auth: { uid: "u1" }, data: {} });
    expect(S.objects.get(pathOfDownloadUrl(r.photo)).cacheControl).toBe("private, max-age=31536000, immutable");
  });
});

// ================================================================ (b) 最後に上げた写真が残る
describe("vetAvatarPhoto ── 便BH (b): 同じ人がほぼ同時に2枚上げても、あとから上げたほうが残る", () => {
  // Old = 先に上げた写真、New = あとから上げた写真(**期待値は上げた順で決める**)。
  // 栓: Vision(判定)の手前・保存の直後。どちらの写真かはバイト列の印で見分ける。
  function twoUploads() {
    const g = { visionOld: gate(), visionNew: gate(), savedOld: gate(), savedNew: gate() };
    const reached = { visionOld: false, visionNew: false, savedOld: false, savedNew: false };
    world.vision = async (req) => {
      const who = tagOf(req.image.content);
      reached[`vision${who}`] = true;
      await g[`vision${who}`].wait();
      return [{ safeSearchAnnotation: CLEAN }];
    };
    S.hooks.afterSave = async (p, bytes) => {
      const who = tagOf(bytes);
      reached[`saved${who}`] = true;
      await g[`saved${who}`].wait();
    };
    const start = async () => {
      // 端末 A が上げて判定を呼ぶ → 判定が読み終わってから、端末 B が同じ置き場へ上げて判定を呼ぶ
      S.put(UPLOAD, webp("Old"), "image/webp");
      const old = fns.vetAvatarPhoto.run({ auth: { uid: "u1" }, data: {} });
      await until(() => reached.visionOld, "先に上げたほうが判定に入った");
      S.put(UPLOAD, webp("New"), "image/webp");
      const neu = fns.vetAvatarPhoto.run({ auth: { uid: "u1" }, data: {} });
      await until(() => reached.visionNew, "あとから上げたほうが判定に入った");
      return { old, neu };
    };
    return { g, reached, start };
  }
  const prevPath = "avatars/u1/0123456789abcdef.webp";     // 前の形の、いま載っている写真
  const seedPrev = () => {
    S.put(prevPath, webp("prev"), "image/webp", "tp");
    F.seed("users/u1", { isPublic: true, photo: downloadUrlOf(BUCKET, prevPath, "tp") });
  };
  const pathOfTag = (tag) => [...S.objects.keys()].find((k) => k.startsWith("avatars/u1/") && tagOf(S.objects.get(k).bytes) === tag) ?? null;
  const finalCheck = (tag) => {
    const now = F.photo("u1");
    expect(tagOf(S.objects.get(pathOfDownloadUrl(now))?.bytes ?? Buffer.alloc(12))).toBe(tag);
    expect(S.canFetch(now)).toBe(true);                    // 全員の画面で読める
    expect(S.avatarsOf("u1")).toEqual([pathOfDownloadUrl(now)]); // 負けたほう・前の写真は消えた(1人1枚)
  };

  // 【差し戻し(不合格1)の反例】判定の速さで順が入れ替わる形。以前は判定のあとで時刻を取っていたので、
  // 判定が先に終わった B が「古い」ことになり、あとから終わった A(先に上げた写真)が勝っていた。
  it("A が上げる → A の判定開始 → B が上げる → B の判定が先に終わる → A の判定が終わる: B が残る", async () => {
    seedPrev();
    const { g, start } = twoUploads();
    const { old, neu } = await start();
    g.visionNew.open(); g.savedNew.open();                 // B の判定が先に終わり、B が最後まで走る
    const rNew = await neu;
    g.visionOld.open(); g.savedOld.open();                 // A の判定があとから終わる
    const rOld = await old;
    finalCheck("New");
    expect(rNew.photo).toBe(F.photo("u1"));
    expect(rOld.photo).toBe(F.photo("u1"));                // 負けた A も「いま載っている写真」を返す
  });

  it("同じ反例で、A が保存まで済ませてから B が載っても、B が残る", async () => {
    seedPrev();
    const { g, reached, start } = twoUploads();
    const { old, neu } = await start();
    g.visionOld.open();
    await until(() => reached.savedOld, "A を保存した");   // A の判定は終わったが、users はまだ
    g.visionNew.open(); g.savedNew.open();
    await neu;
    g.savedOld.open();
    await old;
    finalCheck("New");
  });

  it("あとから上げたほうが先に終わっても(新 → 旧の順)、あとから上げたほうが残る", async () => {
    seedPrev();
    const { g, reached, start } = twoUploads();
    const { old, neu } = await start();
    g.visionOld.open();
    await until(() => reached.savedOld, "先に上げたほうを保存した");
    g.visionNew.open(); g.savedNew.open();
    const rNew = await neu;
    g.savedOld.open();
    const rOld = await old;
    finalCheck("New");
    expect(rOld.photo).toBe(F.photo("u1"));
    expect(rNew.photo).toBe(F.photo("u1"));
  });

  it("先に上げたほうが先に終わっても(旧 → 新の順)、あとから上げたほうが残る", async () => {
    seedPrev();
    const { g, start } = twoUploads();
    const { old, neu } = await start();
    g.visionOld.open(); g.savedOld.open();
    const rOld = await old;                                // 先に上げたほうが最後まで走る(いったん載る)
    expect(F.photo("u1")).toBe(rOld.photo);
    g.visionNew.open(); g.savedNew.open();
    await neu;
    finalCheck("New");
  });

  // 以前の dropOthers で全員の画面が壊れた形: あとのほうが保存を終えて users を書く前に、
  // 先のほうが users を書いて片付けを走らせる。「いま載せた1枚以外」を消すとあとのほうの実体が消える。
  it("あとのほうの保存のあとに先のほうが片付けても、あとのほうの実体は消えない", async () => {
    seedPrev();
    const { g, reached, start } = twoUploads();
    const { old, neu } = await start();
    g.visionOld.open();
    await until(() => reached.savedOld, "先のほうを保存した");
    g.visionNew.open();
    await until(() => reached.savedNew, "あとのほうを保存した");
    const newPath = pathOfTag("New");
    g.savedOld.open();
    await old;
    expect(S.objects.has(newPath)).toBe(true);             // ← 以前はここで消えていた
    g.savedNew.open();
    await neu;
    finalCheck("New");
  });

  it("置き場の時刻が同じミリ秒でも、世代(上げ直した順)で、あとから上げたほうが残る", async () => {
    seedPrev();
    const g = { Old: gate(), New: gate() };
    const reached = { Old: false, New: false };
    world.vision = async (req) => {
      const who = tagOf(req.image.content);
      reached[who] = true;
      await g[who].wait();
      return [{ safeSearchAnnotation: CLEAN }];
    };
    S.put(UPLOAD, webp("Old"), "image/webp", null, { at: T0 + 5000 });
    const old = fns.vetAvatarPhoto.run({ auth: { uid: "u1" }, data: {} });
    await until(() => reached.Old, "先のほうが判定に入った");
    S.put(UPLOAD, webp("New"), "image/webp", null, { at: T0 + 5000 });   // 同じミリ秒に上げ直した
    const neu = fns.vetAvatarPhoto.run({ auth: { uid: "u1" }, data: {} });
    await until(() => reached.New, "あとのほうが判定に入った");
    g.New.open(); await neu;                               // あとのほうが先に終わる
    g.Old.open(); await old;
    finalCheck("New");
    // 2つの版は同じミリ秒で、世代だけが違った(この検査が世代の比べ方を見ていることの確かめ)
    expect(photoRevKeyOf(pathOfDownloadUrl(F.photo("u1"))).time).toBe(T0 + 5000);
  });

  it("置き場の時刻が取れないときは、関数に入った順で決める(判定の速さでは決めない)", async () => {
    seedPrev();
    S.opts.noTimes = true;
    const { g, start } = twoUploads();
    const { old, neu } = await start();
    g.visionNew.open(); g.savedNew.open();
    await neu;
    g.visionOld.open(); g.savedOld.open();
    await old;
    finalCheck("New");
  });

  // 【差し戻し】先に上げたほうの判定が、あとから上げ直された置き場を消すと、あとのほうの判定が
  // 「置き場に何も無い」で落ちる。置き場は自分が読んだ世代のときだけ消す。
  it("先に上げたほうの判定は、あとから上げ直された置き場を消さない", async () => {
    seedPrev();
    const savedOld = gate();
    let reachedSave = false;
    S.hooks.afterSave = async (p, bytes) => { if (tagOf(bytes) === "Old") { reachedSave = true; await savedOld.wait(); } };
    S.put(UPLOAD, webp("Old"), "image/webp");
    const old = fns.vetAvatarPhoto.run({ auth: { uid: "u1" }, data: {} });
    await until(() => reachedSave, "先のほうを保存した");
    S.put(UPLOAD, webp("New"), "image/webp");             // 判定を呼ぶ前に上げ直した
    savedOld.open();
    await old;
    expect(S.objects.has(UPLOAD)).toBe(true);              // あとのほうの置き場は残っている
    const r = await fns.vetAvatarPhoto.run({ auth: { uid: "u1" }, data: {} });
    expect(r.photo).toBe(F.photo("u1"));
    finalCheck("New");
  });

  // トランザクションの中身: 読んでから書くまでの間に、より新しい写真が載った形。
  it("users を読んでから書くまでに新しい写真が載ったら、やり直して書かず、自分の実体を消す", async () => {
    seedPrev();
    const newer = `avatars/u1/${rv(T0 + 9_000_000, "99", "99999999")}.webp`;
    S.put(newer, webp("Newer"), "image/webp", "tn");
    let injected = 0;
    F.hooks.beforeCommit = async (n, attempt) => {
      if (attempt > 0) return;
      injected += 1;
      F.poke("users/u1", { photo: downloadUrlOf(BUCKET, newer, "tn") });
    };
    S.put(UPLOAD, webp("Mine"), "image/webp");
    const r = await fns.vetAvatarPhoto.run({ auth: { uid: "u1" }, data: {} });
    expect(injected).toBe(1);
    expect(F.photo("u1")).toBe(downloadUrlOf(BUCKET, newer, "tn"));
    expect(r.photo).toBe(F.photo("u1"));
    expect(pathOfTag("Mine")).toBeNull();                  // 自分が保存した実体は消した
    expect(S.objects.has(newer)).toBe(true);
  });

  it("1枚だけなら今までどおり: 載って、前の写真と置き場が消える", async () => {
    seedPrev();
    S.put(UPLOAD, webp("Solo"), "image/webp");
    const r = await fns.vetAvatarPhoto.run({ auth: { uid: "u1" }, data: {} });
    finalCheck("Solo");
    expect(S.objects.has(UPLOAD)).toBe(false);
    expect(Object.keys(r)).toEqual(["photo"]);             // 戻り値の形は変えていない
  });

  it("版には置き場の時刻と世代が入る", async () => {
    S.put(UPLOAD, webp("A"), "image/webp", null, { at: T0 + 1234 });
    const gen = S.objects.get(UPLOAD).generation;
    const a = await fns.vetAvatarPhoto.run({ auth: { uid: "u1" }, data: {} });
    const k = photoRevKeyOf(pathOfDownloadUrl(a.photo));
    expect(k.time).toBe(T0 + 1234);
    expect(BigInt(k.gen)).toBe(BigInt(gen));
  });
});

// ================================================================ 掃除: 合図の時刻より前の版だけを消す
describe("cleanAvatarPhoto ── 便BH 差し戻し(統括裁定3): 判定の途中で絵柄に戻しても、読めない URL を残さない", () => {
  const P0 = `avatars/u1/${rv(T0 - 60_000, "1", "00000000")}.webp`;
  const seedPhoto = () => {
    S.put(P0, webp("P0"), "image/webp", "t0", { at: T0 - 60_000 });
    F.seed("users/u1", { isPublic: true, photo: downloadUrlOf(BUCKET, P0, "t0") });
  };
  // 上げる → 判定が保存まで済む(users はまだ)ところで止める。
  async function uploadAndHoldAfterSave(tag) {
    const held = gate();
    let reached = false;
    S.hooks.afterSave = async (p, bytes) => { if (tagOf(bytes) === tag) { reached = true; await held.wait(); } };
    S.put(UPLOAD, webp(tag), "image/webp");
    const run = fns.vetAvatarPhoto.run({ auth: { uid: "u1" }, data: {} });
    await until(() => reached, `${tag} を保存した`);
    return { run, release: () => held.open() };
  }

  // 審査の反例: 上げる → 判定中に絵柄に戻す → 掃除が先に走り、判定中の実体を消す → 判定が users を書く。
  // 以前は users.photo が消えた実体を指して残った(全員の画面で読めない)。
  it("掃除が判定中の実体を消したあとで判定が users を書いても、読めない URL は残らない", async () => {
    seedPhoto();
    const v = await uploadAndHoldAfterSave("P1");
    F.clientUpdate("users/u1", { photo: null });           // 判定の途中で絵柄に戻した
    const n = await settle();                              // 掃除: 合図より前に上げた P0・P1 を消す
    expect(S.avatarsOf("u1")).toEqual([]);
    v.release();
    // 判定は書いたあとで実体が無いと気づき、外す。通信の失敗(unavailable)ではなく aborted で返す。
    await expect(v.run).rejects.toMatchObject({ code: "aborted", message: expect.stringMatching(/photo-superseded/) });
    await settle({ from: n });
    expect(F.photo("u1")).toBeNull();
    expect(photoIsSound("u1")).toBe(true);
  });

  it("掃除が users を読んだあと・消す前に判定が書き終えても、掃除のほうが外す", async () => {
    seedPhoto();
    const v = await uploadAndHoldAfterSave("P1");
    F.clientUpdate("users/u1", { photo: null });
    let ran = false;
    S.hooks.beforeGetFiles = async () => {                 // 掃除が一覧を取った直後に、判定を最後まで走らせる
      if (ran) return;
      ran = true;
      S.hooks.beforeGetFiles = null;
      v.release();
      await v.run;
    };
    await settle();
    expect(ran).toBe(true);
    expect(photoIsSound("u1")).toBe(true);
    expect(F.photo("u1")).toBeNull();
  });

  it("絵柄に戻したあとで上げ直した写真は、遅れて来た掃除に消されない", async () => {
    seedPhoto();
    F.clientUpdate("users/u1", { photo: null });           // 絵柄に戻す(合図)
    const v = await uploadAndHoldAfterSave("P2");          // そのあとで上げ直した(判定中)
    await settle();                                        // 掃除が遅れて来る: いま載っている写真は無い
    expect(S.avatarsOf("u1")).toEqual([pathOfTag("P2")]);  // 合図より前の P0 だけが消えた
    v.release();
    const r = await v.run;
    await settle({ from: 1 });
    expect(F.photo("u1")).toBe(r.photo);
    expect(S.canFetch(r.photo)).toBe(true);
  });

  // 【便BH 再審査】関数自身が書いた photo: null を合図にすると、合図の時刻(関数が外した時刻)より前に
  // 上げられた版をもう一度消す。本人がその間に上げ直した写真まで消えていた。
  it("関数が外した photo: null は合図にならない(そのあと上げ直した写真は消されない)", async () => {
    seedPhoto();
    const v = await uploadAndHoldAfterSave("P1");
    F.clientUpdate("users/u1", { photo: null });           // 本人が絵柄に戻した(合図)
    const n = await settle();                              // 掃除: P0・P1 を消す
    const c = await uploadAndHoldAfterSave("C");           // 本人が上げ直した(判定中)
    v.release();
    await expect(v.run).rejects.toMatchObject({ code: "aborted" });   // P1 の判定が自分の URL を外す(関数の null)
    expect(F.log.at(-1)).toMatchObject({ by: "function", after: { photo: null } });
    await settle({ from: n });                             // 関数の null が掃除へ届く
    expect(pathOfTag("C")).not.toBeNull();                 // ← 合図にしていたら、ここで C が消えていた
    c.release();
    const r = await c.run;
    await settle({ from: F.log.length - 1 });
    expect(F.photo("u1")).toBe(r.photo);
    expect(S.canFetch(r.photo)).toBe(true);
  });

  it("アカウント削除は、外した写真の実体が無くても(壊れていても)いつもどおり掃除する", async () => {
    S.put(P0, webp("P0"), "image/webp", "t0", { at: T0 - 60_000 });
    const gonePath = `avatars/u1/${rv(T0 - 30_000, "2", "11111111")}.webp`;   // 実体は置かない
    F.seed("users/u1", { isPublic: true, photo: downloadUrlOf(BUCKET, gonePath, "tg") });
    F.clientDelete("users/u1");
    await settle();
    expect(S.avatarsOf("u1")).toEqual([]);
  });

  it("本人が絵柄に戻した null は、今までどおり合図になる(外した写真の実体がまだ在る)", async () => {
    seedPhoto();
    F.clientUpdate("users/u1", { photo: null });
    await settle();
    expect(S.avatarsOf("u1")).toEqual([]);
  });

  it("掃除の合図が2回・逆順に届いても、読めない URL を残さない", async () => {
    seedPhoto();
    const v = await uploadAndHoldAfterSave("P1");
    F.clientUpdate("users/u1", { photo: null });
    v.release();
    await v.run.catch(() => {});
    await settle({ duplicate: true, reverse: true });
    expect(photoIsSound("u1")).toBe(true);
  });

  const pathOfTag = (tag) => [...S.objects.keys()].find((k) => k.startsWith("avatars/u1/") && tagOf(S.objects.get(k).bytes) === tag) ?? null;
});
