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
// 【便CJ】殻だけ initializeFirestore(app, { experimentalForceLongPolling: true })・Web は getFirestore(app) を見るため、どちらも作り物で呼ばれ方を記録する
const fsApi = vi.hoisted(() => ({
  getFirestore: vi.fn(() => ({ tag: "getFirestore" })),
  initializeFirestore: vi.fn(() => ({ tag: "initializeFirestore" })),
}));
vi.mock("firebase/firestore", () => ({ getFirestore: fsApi.getFirestore, initializeFirestore: fsApi.initializeFirestore }));

beforeEach(() => {
  vi.resetModules();                       // getFirebase は結果を覚えるので、毎回まっさらなモジュールで読む
  authApi.getAuth.mockClear();
  authApi.initializeAuth.mockClear();
  fsApi.getFirestore.mockClear();
  fsApi.initializeFirestore.mockClear();
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

// 【便CJ 2026-10-10 統括の裁定】WKWebView では Firestore の既定の通信(WebChannel のストリーミング)が返らなくなる事例があるので、殻だけ長いポーリングを強制する。
// 入っている版の既定(experimentalAutoDetectLongPolling = true)は firebaseClient.js の注記に根拠を書いた。期待値は統括の裁定の文から手で書いた。
describe("【便CJ】getFirebase の Firestore ── 殻だけ長いポーリングを強制", () => {
  it("Web 版は今までどおり getFirestore(app)。initializeFirestore は呼ばない", async () => {
    const { getFirebase } = await import("./firebaseClient.js");
    const fb = getFirebase();
    expect(fb.db).toEqual({ tag: "getFirestore" });
    expect(fsApi.getFirestore).toHaveBeenCalledTimes(1);
    expect(fsApi.getFirestore.mock.calls[0]).toEqual([fb.app]);
    expect(fsApi.initializeFirestore).not.toHaveBeenCalled();
  });
  it("殻は initializeFirestore(app, { experimentalForceLongPolling: true })。自動判定(experimentalAutoDetectLongPolling)は一緒に渡さない。getFirestore は呼ばない", async () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
    const { getFirebase } = await import("./firebaseClient.js");
    const fb = getFirebase();
    expect(fb.db).toEqual({ tag: "initializeFirestore" });
    expect(fsApi.initializeFirestore).toHaveBeenCalledTimes(1);
    const [app, settings] = fsApi.initializeFirestore.mock.calls[0];
    expect(app).toBe(fb.app);
    expect(settings).toEqual({ experimentalForceLongPolling: true });
    expect("experimentalAutoDetectLongPolling" in settings).toBe(false);   // 2つは一緒に指定できない(SDK が投げる)
    expect(fsApi.getFirestore).not.toHaveBeenCalled();
    getFirebase();
    expect(fsApi.initializeFirestore).toHaveBeenCalledTimes(1);   // 2回目は作り直さない(initializeFirestore を2回呼ぶと SDK が投げる)
  });
});
