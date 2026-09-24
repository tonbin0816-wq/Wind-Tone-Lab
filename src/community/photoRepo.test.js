import { describe, it, expect, vi, beforeEach } from "vitest";

// ------------------------------------------------------------------
// 【便AP 審査役の指摘(重1)】saveAvatarPhoto を作り物の Firebase で**実際に走らせ**、
// 段の知らせが 送信(割合) → 判定 → 済み の順に届くこと、札が中身から付くこと、
// 関数を東京に向けて呼ぶことを見る。綴りでは見ない。
//
// 【作り物は本物より甘くしない】送信は本物と同じく state_changed を何度か知らせてから終わる。
// ------------------------------------------------------------------
const h = vi.hoisted(() => ({ uploads: [], calls: [], fnArgs: [], vetResult: { data: { photo: "https://example.test/p.jpg" } }, uploadFails: false }));

vi.mock("firebase/storage", () => ({
  getStorage: vi.fn(() => ({ kind: "storage" })),
  ref: vi.fn((s, path) => ({ path })),
  uploadBytesResumable: vi.fn((ref, blob, meta) => {
    h.uploads.push({ ref, blob, meta });
    return {
      on(ev, next, error, complete) {
        expect(ev).toBe("state_changed");
        queueMicrotask(() => {
          next({ bytesTransferred: 0, totalBytes: 200 });
          next({ bytesTransferred: 100, totalBytes: 200 });
          if (h.uploadFails) { error(Object.assign(new Error("storage/unauthorized"), { code: "storage/unauthorized" })); return; }
          next({ bytesTransferred: 200, totalBytes: 200 });
          complete();
        });
      },
    };
  }),
}));
vi.mock("firebase/functions", () => ({
  getFunctions: vi.fn((app, region) => { h.fnArgs.push(region); return { region }; }),
  httpsCallable: vi.fn((fns, name) => async () => { h.calls.push({ region: fns.region, name }); return h.vetResult; }),
}));
vi.mock("./firebaseClient.js", () => ({ getFirebase: () => ({ app: { name: "test" } }) }));

const { saveAvatarPhoto } = await import("./photoRepo.js");

beforeEach(() => {
  h.uploads.length = 0; h.calls.length = 0; h.fnArgs.length = 0;
  h.vetResult = { data: { photo: "https://example.test/p.jpg" } };
  h.uploadFails = false;
});

describe("saveAvatarPhoto ── 段の知らせ・札・呼び先", () => {
  it("段は 送信0 → 送信の割合 → 判定 → 済み の順に届く", async () => {
    const stages = [];
    const url = await saveAvatarPhoto("u1", { type: "image/jpeg", size: 200 }, (s) => stages.push(s));
    expect(url).toBe("https://example.test/p.jpg");
    expect(stages.map((s) => s.stage)).toEqual(["upload", "upload", "upload", "upload", "vet", "done"]);
    expect(stages.filter((s) => s.stage === "upload").map((s) => s.fraction)).toEqual([0, 0, 0.5, 1]);
    expect(typeof stages[4].startedAt).toBe("number");
  });

  it("札は Blob の中身(JPEG なら image/jpeg)。置き場は自分の uid の下", async () => {
    await saveAvatarPhoto("u1", { type: "image/jpeg", size: 200 });
    expect(h.uploads[0].meta).toEqual({ contentType: "image/jpeg" });
    expect(h.uploads[0].ref.path).toBe("avatarUploads/u1/photo.webp");
    await saveAvatarPhoto("u1", { type: "image/webp", size: 200 });
    expect(h.uploads[1].meta).toEqual({ contentType: "image/webp" });
  });

  it("WebP / JPEG 以外(Safari の PNG)は送らずに止める", async () => {
    await expect(saveAvatarPhoto("u1", { type: "image/png", size: 200 })).rejects.toThrow(/PHOTO_ENCODE_FAILED/);
    expect(h.uploads).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it("判定は東京(asia-northeast1)の vetAvatarPhoto を呼ぶ", async () => {
    await saveAvatarPhoto("u1", { type: "image/jpeg", size: 200 });
    expect(h.calls).toEqual([{ region: "asia-northeast1", name: "vetAvatarPhoto" }]);
  });

  it("送信で落ちたら判定を呼ばず、済みも知らせない", async () => {
    h.uploadFails = true;
    const stages = [];
    await expect(saveAvatarPhoto("u1", { type: "image/jpeg", size: 200 }, (s) => stages.push(s))).rejects.toThrow(/storage/);
    expect(h.calls).toHaveLength(0);
    expect(stages.some((s) => s.stage === "vet" || s.stage === "done")).toBe(false);
  });

  it("URL が返らなければ失敗にする(済みを知らせない)", async () => {
    h.vetResult = { data: {} };
    const stages = [];
    await expect(saveAvatarPhoto("u1", { type: "image/jpeg", size: 200 }, (s) => stages.push(s))).rejects.toThrow(/PHOTO_NOT_STORED/);
    expect(stages.at(-1).stage).toBe("vet");
  });
});
