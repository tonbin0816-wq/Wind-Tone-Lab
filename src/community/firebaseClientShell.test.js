// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 【殻 S1】getFirebase() が作る Auth を、殻 / Web の両方で実際に呼んで確かめる(綴りの錨は firebaseClient.test.js)。
// Firebase の SDK はモックにする(通信しない・資格情報を作らない)。返り値に印を付け、どちらの作り方で作ったかを見る。
const idbPersistence = { tag: "indexedDBLocalPersistence" };
const authApi = vi.hoisted(() => ({
  getAuth: vi.fn(() => ({ tag: "getAuth" })),
  initializeAuth: vi.fn(() => ({ tag: "initializeAuth" })),
}));
vi.mock("firebase/app", () => ({ initializeApp: vi.fn((conf) => ({ tag: "app", conf })) }));
vi.mock("firebase/auth", () => ({
  getAuth: authApi.getAuth,
  initializeAuth: authApi.initializeAuth,
  get indexedDBLocalPersistence() { return idbPersistence; },
}));
vi.mock("firebase/firestore", () => ({ getFirestore: vi.fn(() => ({ tag: "db" })) }));

beforeEach(() => {
  vi.resetModules();                       // getFirebase は結果を覚えるので、毎回まっさらなモジュールで読む
  authApi.getAuth.mockClear();
  authApi.initializeAuth.mockClear();
  vi.stubEnv("VITE_FIREBASE_API_KEY", "test-key");
  vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "test.example");
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv("VITE_FIREBASE_APP_ID", "test-app");
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete window.Capacitor;
});

describe("getFirebase の Auth ── 殻だけ initializeAuth(indexedDBLocalPersistence)", () => {
  it("Web 版(window.Capacitor 無し)は getAuth(app) で作り、initializeAuth は呼ばない", async () => {
    const { getFirebase } = await import("./firebaseClient.js");
    const fb = getFirebase();
    expect(fb.auth).toEqual({ tag: "getAuth" });
    expect(authApi.getAuth).toHaveBeenCalledTimes(1);
    expect(authApi.getAuth.mock.calls[0][0]).toBe(fb.app);
    expect(authApi.initializeAuth).not.toHaveBeenCalled();
  });

  it("殻(isNativePlatform が true)は initializeAuth(app, { persistence: indexedDBLocalPersistence }) で作り、getAuth は呼ばない", async () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
    const { getFirebase } = await import("./firebaseClient.js");
    const fb = getFirebase();
    expect(fb.auth).toEqual({ tag: "initializeAuth" });
    expect(authApi.initializeAuth).toHaveBeenCalledTimes(1);
    const [app, opts] = authApi.initializeAuth.mock.calls[0];
    expect(app).toBe(fb.app);
    expect(opts).toEqual({ persistence: idbPersistence });
    expect(opts.persistence).toBe(idbPersistence);
    expect(authApi.getAuth).not.toHaveBeenCalled();
  });

  it("殻でも2回目の getFirebase は作り直さない(initializeAuth は1回だけ ── 2回呼ぶと Firebase が投げる)", async () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
    const { getFirebase } = await import("./firebaseClient.js");
    const a = getFirebase();
    const b = getFirebase();
    expect(b).toBe(a);
    expect(authApi.initializeAuth).toHaveBeenCalledTimes(1);
  });
});
