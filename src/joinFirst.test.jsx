// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";
import { startsOnJoinScene, coachCandidates } from "./onboarding.jsx";

// ------------------------------------------------------------------
// 【便DC 2026-10-21 本人の指示】「チュートリアルの順番で、利用規約の前にコミュニティのプロフィールを作成する順番にしてください。
// 作成後は今と同じく『まずは計測してみよう』に戻って続けてください」(統括が確認済みの順番)
//   新しい順: ようこそ → 利用規約に同意 → **コミュニティの参加の場面**(JoinIntro のカード → 匿名アカウント → プロフィール作成)→ 計測タブの ① から今までどおり
// 【便DE 2026-10-25 本人の指示】「規約同意のあと、いきなりプロフィール入力画面」
//   同意のあと最初に見える画面はプロフィールの入力。読み込み画面も参加のカード(JoinIntro)も出さない(ふだんのコミュニティタブは今までどおり)。
//   匿名サインインとプロフィールの既存確認は画面を出してから裏で進める(同意の前にはアカウントを作らない)。保存はサインインを待つ。
//   裏の確認で参加済みのプロフィールが見つかったらフォームを畳んで計測へ。失敗はフォームの上に「もう一度試す」(入力は消さない)。
// 【便DD 2026-10-21 本人の指示】「プロフィールの作成を必須にして。作成中に離脱できないように変更」
//   見送りの道をなくした: 参加の場面の間は下部タブを描かない・押せない。作成画面に出られる口(やめる)は無い。
//   参加するまで毎回参加の場面から始める(同意の記録があり、参加の印 join が無い人。保存の状態から決める)。
// **main.jsx が描くのと同じ根(AppRoot)**を描いて確かめる(consentGate.test.jsx と同じ作り)。
//   ・入れたて(同意なし): 同意のあと参加の場面 → 参加(プロフィール作成)→ 自動で計測タブへ戻り ① が出る。参加の場面の間はマイク・案内・下部タブ・広告が無い
//   ・参加の場面の間: 下部タブが無い(押せない)・プロフィール作成中も出られない・Escape でも抜けない
//   ・途中で閉じて開き直しても(同意の画面を飛ばして開いても)参加の場面から。参加済み(join)の人は今までどおり計測タブから
//   ・通信の失敗でも「もう一度試す」がある(出られない代わりに必ず再試行できる)
//   ・参加した人に ⑭' goCommunity は出ない / 見本(?tutorialpreview=1)の流れも新しい順 / 参加の場面にも便CO の広告の止めが効く
// サーバーは作り物(accountRepo などを差し替える。Firebase に触らない・実際の匿名アカウントは作らない)。IndexedDB も作り物。
// 【守っていないもの】実寸の見た目(参加のカード・作成画面が下部タブ無しで収まること)・実機の OS のマイクの許可の画面と ATT の並び(判定不能・実機待ち)。
// ------------------------------------------------------------------

const server = vi.hoisted(() => ({ uid: null, profile: null, signIns: 0, signInCalls: 0, signInGate: null, releaseSignIn: null, loadGate: null, hangLoadProfile: false, savedUids: [], failSignIn: false, failLoad: false, configMissing: null, hangSignIn: false, hangSave: false, saves: 0 }));
// (設定の欠落の失敗は呼ばれたときに firebaseClient を読んで作る ── 各検査の vi.resetModules のあとの、アプリが読んでいる側の同じクラスで投げる(instanceof が通る))
const configMissing = async () => { const { FirebaseConfigMissingError } = await import("./community/firebaseClient.js"); return new FirebaseConfigMissingError(["VITE_FIREBASE_API_KEY"]); };
vi.mock("./community/accountRepo.js", async (orig) => {
  return {
    ...(await orig()),
    getSignedInUid: vi.fn(async () => {
      if (server.configMissing === "load") throw await configMissing();
      if (server.failLoad) throw new Error("検査: 通信に失敗");
      return server.uid;
    }),
    loadProfile: vi.fn(async () => {
      if (server.loadGate) await server.loadGate;                       // 既存プロフィールの確認の返りを遅らせる(検査が手で解く)
      if (server.hangLoadProfile) return new Promise(() => {});          // 返ってこない確認
      return server.profile;
    }),
    deleteAccount: vi.fn(async () => { server.uid = null; server.profile = null; return { credentialRemoved: true }; }),
    saveProfile: vi.fn(async (uid, doc) => {
      server.saves += 1; server.savedUids.push(uid);
      if (server.hangSave) return new Promise(() => {});   // 返ってこない保存
      server.profile = doc;
    }),
    watchMyPhoto: vi.fn(() => () => {}),
    ensureSignedIn: vi.fn(async () => {
      server.signInCalls += 1;
      if (server.signInGate) await server.signInGate;   // 返りを遅らせる(検査が手で解く)
      if (server.configMissing === "signin") throw await configMissing();
      if (server.failSignIn) throw new Error("検査: サインインに失敗");
      if (server.hangSignIn) await new Promise((r) => { server.releaseSignIn = r; });   // 返ってこないサインイン(検査が手で返す)
      server.signIns += 1; server.uid = server.signIns === 1 ? "me" : `me${server.signIns}`; return server.uid;
    }),
  };
});
// 【便DD 審査】書き込み・サインインの上限(本物は 15 秒 = actionLimit.test.js が値を見る)は、ここでは 0.8 秒に縮めて配線(上限のあとに再試行できること)を見る
vi.mock("./community/loadLimit.js", async (orig) => {
  const real = await orig();
  return { ...real, withinActionLimit: (p) => real.withinActionLimit(p, 800), withinLoadLimit: (p) => real.withinLoadLimit(p, 800) };
});
vi.mock("./community/profile.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return { ...(await orig()), buildProfileDoc: vi.fn(() => ({ doc: { ...kit.MY_PROFILE, ageConfirmed: true } })) };
});
vi.mock("./community/directory.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(async () => kit.SERVER_USERS), publishStats: vi.fn(async () => {}) };
});
vi.mock("./community/reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));
vi.mock("./community/idealRepo.js", async (orig) => {
  const kit = await import("./community/blockKit.testutil.jsx");
  return { ...(await orig()), listIdeals: vi.fn(async () => kit.SERVER_IDEALS), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) };
});

const W = 375; const H = 812;
let fake; let host; let mod; let root; let realRect; let realSIV; let realFetch; let gum; let micMode; let seenLayers; let observer; let seenLoading; let seenJoinCard;

async function loadApp() {
  vi.resetModules();
  globalThis.indexedDB = fake;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("./App.jsx");
  const gate = await import("./ConsentScreen.jsx");
  return { React, act: React.act, createRoot, AppRoot: gate.default, openIdb: App.openIdb, warm: App.warmPersistedStateCache };
}
const kv = (key) => fake._peek("windToneLabDB", "kv")?.get(key);
async function seed(kvEntries = {}, sessions = []) {
  const db = await mod.openIdb();
  db.close?.();
  for (const [k, v] of Object.entries(kvEntries)) fake._peek("windToneLabDB", "kv").set(k, structuredClone(v));
  for (const s of sessions) fake._peek("windToneLabDB", "sessions").set(s.id, structuredClone(s));
}
async function launch() {
  await mod.warm();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = mod.createRoot(host);
  await mod.act(async () => { root.render(mod.React.createElement(mod.AppRoot)); });
}
// 閉じて開き直す(= 読み込み直し。モジュールごと作り直す。kv と作り物のサーバーは同じ)
async function relaunch() {
  await mod.act(async () => root.unmount());
  host.remove(); document.body.innerHTML = "";
  mod = await loadApp();
  await launch();
}
const tick = (ms = 10) => mod.act(async () => { await new Promise((r) => setTimeout(r, ms)); });
async function waitFor(pred, label, deadline = 10000) {
  const end = Date.now() + deadline;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`待っても揃わなかった: ${label}`);
    await tick();
  }
}
const click = (el) => mod.act(async () => { el.click(); });
const screen = () => document.querySelector("[data-consent-screen]");
const step = () => screen()?.getAttribute("data-consent-step") ?? null;
const navBar = () => document.querySelector("[data-bottom-nav]");
const navButtons = () => document.querySelectorAll("[data-bottom-nav] button");
const nav = (label) => document.querySelector(`[data-bottom-nav] button[aria-label="${label}"]`);
const layerId = () => document.querySelector("[data-coach-layer]")?.getAttribute("data-coach-layer") ?? null;
const joinCard = () => document.querySelector('[data-join-card][role="button"][aria-label="参加する"]');
const buttonsNamed = (name) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === name);
const adHold = () => document.documentElement.getAttribute("data-ad-hold");
const MIC_DENIED = "マイクの使用が許可されていません";
// 1枚目 → 2枚目 → チェック → 次へ(同意の画面が消えるまで。そのあとは参加の場面 = 下部タブは無い)
async function passConsent() {
  await click(document.querySelector("[data-consent-start]"));
  await waitFor(() => step() === "terms", "2枚目");
  await click(screen().querySelector('input[type="checkbox"]'));
  await click(document.querySelector("[data-consent-next]"));
  await waitFor(() => !screen(), "同意の画面が消える");
}
// 【便DE】参加の場面 = いきなりプロフィールの入力(「プロフィールを作る」のボタンがあるフォーム)。保存 = そのボタン
const formBtn = () => buttonsNamed("プロフィールを作る")[0];
const waitScene = () => waitFor(() => formBtn(), "参加の場面(プロフィールの入力)");
const createProfile = async () => { await waitScene(); await click(formBtn()); };

// 作り物のマイク。micMode "grant" = 許可 / "deny" = 許可されない(NotAllowedError)
function installFakeMic() {
  const node = () => ({ connect() {}, disconnect() {} });
  const analyser = () => ({
    ...node(), fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0,
    getFloatTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = (Math.random() - 0.5) * 2e-3; },
    getFloatFrequencyData(a) { a.fill(-120); }, getByteFrequencyData(a) { a.fill(0); }, getByteTimeDomainData(a) { a.fill(128); },
  });
  class FakeAudioContext {
    constructor() { this.state = "running"; this.sampleRate = 48000; this.currentTime = 0; this.destination = node(); }
    resume() { this.state = "running"; return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
    createMediaStreamSource() { return node(); }
    createAnalyser() { return analyser(); }
    createBiquadFilter() { return { ...node(), type: "", frequency: { value: 0 }, Q: { value: 0 } }; }
    createGain() { return { ...node(), gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
    createOscillator() { return { ...node(), frequency: { value: 0, setValueAtTime() {} }, start() {}, stop() {} }; }
  }
  window.AudioContext = FakeAudioContext;
  const track = { enabled: true, readyState: "live", muted: false, kind: "audio", stop() {}, getSettings() { return {}; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  gum = 0;
  Object.defineProperty(window.navigator, "mediaDevices", {
    value: { getUserMedia: async () => {
      gum += 1;
      if (micMode === "deny") throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      return stream;
    } },
    configurable: true,
  });
}

beforeEach(() => {
  fake = createFakeIndexedDb();
  server.uid = null; server.profile = null; server.signIns = 0; server.signInCalls = 0; server.signInGate = null; server.releaseSignIn = null; server.loadGate = null; server.hangLoadProfile = false; server.savedUids = []; server.failSignIn = false; server.failLoad = false; server.configMissing = null; server.hangSignIn = false; server.hangSave = false; server.saves = 0;
  micMode = "grant";
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-tutorial-preview");
  window.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = () => {};
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  // ① の的(環の箱)とカードの矩形(375×812 の実測と同じ値)
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    const b = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
    if (this.classList?.contains("coach-card")) return b(22, 0, W - 44, 146);
    if (this.getAttribute?.("data-coach") === "tuner") return b(14, 96, 347, 330);
    return b(0, 0, 0, 0);
  };
  realSIV = window.Element.prototype.scrollIntoView;
  window.Element.prototype.scrollIntoView = function () {};
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const name = String(url).replace(/^\//, "");
    if (!/^(terms|privacy)\.html$/.test(name)) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => readFileSync(join(process.cwd(), "public", name), "utf8") };
  };
  installFakeMic();
  // 案内の層(data-coach-layer)が一度でも出た id を控える(出てすぐ消えたものも拾う)
  seenLayers = new Set();
  // 読み込み画面(LoadingRing = role="img" の「読み込み中」)と参加のカード(JoinIntro)が一度でも出たかも控える(出てすぐ消えたものも拾う)
  seenLoading = false; seenJoinCard = false;
  observer = new MutationObserver(() => {
    for (const el of document.querySelectorAll("[data-coach-layer]")) seenLayers.add(el.getAttribute("data-coach-layer"));
    if (document.querySelector('[role="img"][aria-label="読み込み中"]')) seenLoading = true;
    if (document.querySelector("[data-join-card]")) seenJoinCard = true;
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-coach-layer"] });
});
afterEach(async () => {
  observer?.disconnect();
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-tutorial-preview");
  document.documentElement.removeAttribute("data-ad-hold");
  window.Element.prototype.getBoundingClientRect = realRect;
  window.Element.prototype.scrollIntoView = realSIV;
  globalThis.fetch = realFetch;
  delete window.matchMedia;
  delete window.AudioContext;
  try { delete window.navigator.mediaDevices; } catch { /* */ }
});

const GATES = { migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true };
const REC = { at: "2026-10-08T00:00:00.000Z", version: "2026-10-08" };
const NOW_ISO = new Date(Date.now() - 60 * 1000).toISOString();
const SESSION = (id) => ({ id, recordedAt: NOW_ISO, saxType: "alto", reedId: null, linkedAt: null, memo: null, performer: "自分", source: "live", frames: [], barlines: [], noteEvents: [] });

describe("入れたて(同意なし): ようこそ → 規約 → プロフィールの入力 → 計測 ①", () => {
  it("同意のあとは、読み込み画面も参加のカードも出ずに、すぐプロフィールの入力(下部タブ・マイク・案内・広告は無い)。保存すると押さずに計測タブへ戻り ① から。印は join の1つだけ・到着カードは出ない", async () => {
    mod = await loadApp();
    await launch();
    expect(step()).toBe("welcome");
    expect(server.signInCalls).toBe(0);
    await passConsent();
    // --- 参加の場面 = いきなりプロフィールの入力 ---
    await waitScene();
    expect(seenLoading).toBe(false);     // 読み込み画面(輪と %)は一度も出ていない
    expect(seenJoinCard).toBe(false);    // 参加のカード(JoinIntro)も一度も出ていない
    expect(screen()).toBe(null);
    expect(navBar()).toBe(null);         // 【便DD】下部タブは描かない
    await waitFor(() => kv("termsConsent"), "同意の記録");
    expect(gum).toBe(0);                 // マイクは計測タブへ入るまで頼まない
    expect(layerId()).toBe(null);        // 案内のカードは無い
    expect(adHold()).toBe("1");          // 広告は出ない(止まっている)
    expect(kv("onboardingDone")?.join).toBeUndefined();
    // 匿名サインインは同意のあと裏で進む(押さなくても。同意の前には呼ばれていない)
    await waitFor(() => server.signIns === 1, "裏の匿名サインイン");
    expect(server.signInCalls).toBe(1);
    await tick(300);
    expect(seenLoading).toBe(false);
    expect(seenJoinCard).toBe(false);
    expect(navBar()).toBe(null);
    // --- 保存 → 自動で計測タブへ戻り、今までどおり ① ---
    await click(formBtn());
    await waitFor(() => kv("onboardingDone")?.join === true, "join の印(参加の完了)");
    await waitFor(() => gum > 0, "計測タブでマイク");
    await waitFor(() => layerId() === "tuner", "① まずは吹いてみよう");
    expect(navBar()).not.toBe(null);     // 抜けたあとは下部タブがある
    expect(formBtn()).toBe(undefined);
    expect(seenLoading).toBe(false);
    expect(seenJoinCard).toBe(false);
    const d = kv("onboardingDone");
    expect(d.arriveCommunity).toBeUndefined();   // 参加した直後に長い案内(到着カード)を出さない
    expect(d.goCommunity).toBeUndefined();
    expect(d.adoptAverage).toBeUndefined();
    expect(seenLayers.has("arriveCommunity")).toBe(false);
    expect(seenLayers.has("adoptAverage")).toBe(false);
    expect(server.signIns).toBe(1);
    expect(server.signInCalls).toBe(1);
    // --- のちにコミュニティタブを開いたとき、到着カード(参加済みの人がタブを開いた直後の今までの道)---
    await click(nav("コミュニティ"));
    await waitFor(() => layerId() === "arriveCommunity", "のちの到着カード");
  }, 60000);

  it("【便DD 審査】参加を終えたあと、参加の場面は戻らない: コミュニティタブを開き直しても下部タブがあり(押せる)、印もふつうに立つ", async () => {
    mod = await loadApp();
    await launch();
    await passConsent();
    await createProfile();
    await waitFor(() => layerId() === "tuner", "参加のあとの ①");
    for (const label of ["コミュニティ", "計測", "コミュニティ", "リード", "コミュニティ"]) {
      await click(nav(label));
      await tick(100);
      expect(navBar(), `「${label}」のあとも下部タブがある(場面の旗が降りている)`).not.toBe(null);
      expect(joinCard()).toBe(null);
    }
    await waitFor(() => kv("onboardingDone")?.goCommunity === true, "ふつうの道で goCommunity");
  }, 60000);

  it("【便DD】参加の場面のあいだは見送れない: 下部タブが無い(押せない)・作成中も出られない(「やめる」が無い・Escape でも抜けない)・印は書かない", async () => {
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitScene();
    await tick(100);
    expect(navBar()).toBe(null);
    expect(navButtons()).toHaveLength(0);
    expect(buttonsNamed("やめる")).toHaveLength(0);
    await mod.act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await mod.act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await tick(100);
    expect(formBtn()).toBeTruthy();
    expect(navBar()).toBe(null);
    expect(adHold()).toBe("1");
    expect(gum).toBe(0);
    expect(layerId()).toBe(null);
    for (const f of ["goCommunity", "arriveCommunity", "goReeds", "goData", "tuner", "finish"]) expect(kv("onboardingDone")?.[f], `印 ${f}`).toBeUndefined();
  }, 60000);

  it("保存してマイクの許可を断ると、拒否のカードが出る(参加の場面から来た最初の計測タブも起動のときと同じ扱い)", async () => {
    micMode = "deny";
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitScene();
    expect(gum).toBe(0);
    await createProfile();
    await waitFor(() => gum > 0, "マイクを頼んだ");
    await waitFor(() => document.body.textContent.includes(MIC_DENIED), "拒否のカード");
    expect(layerId()).toBe(null);
    await click(nav("リード"));
    await waitFor(() => !document.body.textContent.includes(MIC_DENIED), "他のタブでは拒否のカードが消える");
    await click(nav("計測"));
    await tick(300);
    expect(document.body.textContent.includes(MIC_DENIED)).toBe(false);
  }, 60000);

  it("参加の場面の間は、広告の止めが効いている(便CO の決まり)。広告を始めてよい状態でも、参加の場面の間は止める", async () => {
    mod = await loadApp();
    await seed({ onboardingShown: true });
    await launch();
    await passConsent();
    await waitScene();
    await tick(1500);   // 止めの戻し(COACH_AD_RELEASE_MS = 1秒)より長く待つ。参加のカードは出ないので止めは参加の場面そのもの(joinSceneNow)が持つ
    expect(adHold()).toBe("1");
    await click(formBtn());
    await waitFor(() => layerId() === "tuner", "①");
    expect(adHold()).toBe("1");
  }, 60000);
});

describe("【便DE】同意の前にアカウントを作らない・保存はサインインを待つ", () => {
  it("同意の画面(1枚目・2枚目)の間はサインインも読みも走らない。「次へ」を押してから裏でサインインする", async () => {
    mod = await loadApp();
    await launch();
    await tick(300);
    expect(server.signInCalls).toBe(0);
    await click(document.querySelector("[data-consent-start]"));
    await waitFor(() => step() === "terms", "2枚目");
    await click(screen().querySelector('input[type="checkbox"]'));
    await tick(300);
    expect(server.signInCalls).toBe(0);   // チェックしただけ(「次へ」の前)ではまだ
    expect(server.uid).toBe(null);
    await click(document.querySelector("[data-consent-next]"));
    await waitFor(() => server.signInCalls === 1, "「次へ」のあとの裏のサインイン");
  }, 60000);

  it("保存を押したときサインインがまだなら、待ってから保存する(サインインは二重にしない)。サインインが済むまで下部タブも計測も出ない", async () => {
    let release;
    server.signInGate = new Promise((r) => { release = r; });
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitScene();
    await waitFor(() => server.signInCalls === 1, "裏のサインインが始まった(まだ返らない)");
    await click(formBtn());
    await tick(200);
    expect(server.saves).toBe(0);            // サインイン前なので保存はまだ
    expect(server.signInCalls).toBe(1);      // 保存の直前のサインインは、裏の同じ約束を待っている
    expect(navBar()).toBe(null);
    expect(document.body.textContent.includes("保存中")).toBe(true);   // 押した保存は待っている(ボタンは「保存中…」)
    await mod.act(async () => { release(); });
    await waitFor(() => server.saves === 1, "サインインのあとに保存");
    await waitFor(() => layerId() === "tuner", "計測の ①");
    expect(server.signInCalls).toBe(1);
    expect(server.signIns).toBe(1);
  }, 60000);
});

describe("【便DD】参加するまで毎回この場面から(保存の状態から決める)", () => {
  it("途中で閉じて開き直しても、すぐプロフィールの入力から(サインイン済みでも)。保存したら次の起動からは計測タブ", async () => {
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitScene();
    await waitFor(() => kv("termsConsent"), "同意の記録");
    await waitFor(() => server.signIns === 1, "裏のサインイン");
    await relaunch();
    expect(screen()).toBe(null);                 // 同意の記録があるので同意の画面は出ない
    await waitScene();
    expect(navBar()).toBe(null);
    expect(gum).toBe(0);
    await relaunch();
    await waitScene();
    expect(seenJoinCard).toBe(false);
    await tick(300);
    expect(server.signIns).toBe(1);              // 開き直しでアカウントを増やさない
    expect(server.signInCalls).toBe(1);
    await createProfile();
    await waitFor(() => layerId() === "tuner", "参加のあとの ①");
    await relaunch();
    await waitFor(() => layerId() === "tuner", "次の起動は計測の ①");
    expect(formBtn()).toBe(undefined);
    expect(navBar()).not.toBe(null);
  }, 90000);

  it("同意の画面を飛ばして開いた起動(同意の記録あり・参加の印なし)でも、すぐプロフィールの入力から。案内の印・計測がある既存の利用者でも同じ", async () => {
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES, measure: true, tuner: true, metronome: true } }, [SESSION("s1")]);
    await launch();
    expect(screen()).toBe(null);
    await waitScene();
    expect(seenLoading).toBe(false);
    expect(seenJoinCard).toBe(false);
    expect(navBar()).toBe(null);
    await tick(200);
    expect(gum).toBe(0);
  }, 60000);

  it("参加済み(join の印がある)の人は、今までどおり計測タブから。プロフィールの入力は出ない", async () => {
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES, join: true, measure: true, tuner: true } }, [SESSION("s1")]);
    await launch();
    expect(screen()).toBe(null);
    await waitFor(() => gum > 0, "計測タブのマイク");
    await tick(200);
    expect(formBtn()).toBe(undefined);
    expect(joinCard()).toBe(null);
    expect(navBar()).not.toBe(null);
    expect(server.signInCalls).toBe(0);
  }, 60000);

  it("参加済みなのに印が無い人(サーバーに参加済みのプロフィールがある)は、裏の確認でフォームが畳まれて計測の ①(アカウントは作らない・参加のカードも出ない)", async () => {
    server.uid = "me"; server.profile = { nickname: "n" };
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES } });
    await launch();
    await waitFor(() => layerId() === "tuner", "計測の ①");
    expect(formBtn()).toBe(undefined);
    expect(server.signInCalls).toBe(0);
    expect(seenJoinCard).toBe(false);
    expect(seenLoading).toBe(false);
    await waitFor(() => kv("onboardingDone")?.join === true, "join の印");
  }, 60000);
});

describe("【便DE】裏の確認・サインインの失敗: 入力は消えず、フォームの上に「もう一度試す」", () => {
  const typeNickname = async (text) => {
    const input = document.querySelector('input[type="text"][maxlength="20"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await mod.act(async () => { setter.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
    return input;
  };
  const retryBtn = () => document.querySelector("[data-join-retry] button");

  it("読み込み(アカウントの確認)の失敗: フォームは残ったまま「もう一度試す」が出る。入力は消えず、押して直れば参加を終えて ①", async () => {
    server.failLoad = true;
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES } });
    await launch();
    await waitScene();
    await waitFor(() => retryBtn(), "フォームの上の「もう一度試す」");
    expect(navBar()).toBe(null);
    expect(seenJoinCard).toBe(false);
    const input = await typeNickname("ふぃかす");
    expect(input.value).toBe("ふぃかす");
    server.failLoad = false;
    await click(retryBtn());
    await waitFor(() => !retryBtn(), "直ったので「もう一度試す」が消える");
    await waitFor(() => server.signIns === 1, "やり直しの裏のサインイン");
    expect(document.querySelector('input[type="text"][maxlength="20"]')).toBe(input);   // 同じ入力欄(作り直されていない)
    expect(input.value).toBe("ふぃかす");
    await click(formBtn());
    await waitFor(() => layerId() === "tuner", "直ったので計測の ①");
  }, 60000);

  it("匿名サインインの失敗: 同じく「もう一度試す」が出て入力は消えない。直ってから保存できる。サインインは直るまで走り直す", async () => {
    server.failSignIn = true;
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitScene();
    await waitFor(() => retryBtn(), "フォームの上の「もう一度試す」");
    expect(navBar()).toBe(null);
    const input = await typeNickname("ふぃかす");
    server.failSignIn = false;
    await click(retryBtn());
    await waitFor(() => server.signIns === 1, "やり直しのサインイン");
    await waitFor(() => !retryBtn(), "「もう一度試す」が消える");
    expect(input.value).toBe("ふぃかす");
    await click(formBtn());
    await waitFor(() => layerId() === "tuner", "計測の ①");
    expect(server.signIns).toBe(1);
  }, 60000);

  it("サインインに失敗したまま保存を押すと、フォームに「保存に失敗しました」が出る(入力は残る)。もう一度押せば通る", async () => {
    server.failSignIn = true;
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitScene();
    await waitFor(() => retryBtn(), "裏のサインインの失敗");
    await click(formBtn());
    await waitFor(() => document.body.textContent.includes("保存に失敗しました"), "保存の失敗の文言");
    expect(server.saves).toBe(0);
    expect(formBtn()).toBeTruthy();
    server.failSignIn = false;
    await click(formBtn());
    await waitFor(() => layerId() === "tuner", "直ったので計測の ①");
  }, 60000);

  it("通信の失敗(設定の欠落ではない)では場面を畳まない: 下部タブは出ない", async () => {
    server.failLoad = true;
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES } });
    await launch();
    await waitFor(() => retryBtn(), "「もう一度試す」");
    await tick(300);
    expect(navBar()).toBe(null);
  }, 60000);
});

describe("【便DD 審査】参加が不可能な失敗(設定の欠落)では場面を畳む", () => {
  const CONFIG_TEXT = "この配信ではコミュニティを利用できません";
  it("読み込みで設定の欠落: 失敗の画面のまま下部タブが出て、計測へ進める。join の印は書かない・アカウントは作らない", async () => {
    server.configMissing = "load";
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES } });
    await launch();
    await waitFor(() => document.body.textContent.includes(CONFIG_TEXT), "設定の欠落の失敗の画面");
    expect(buttonsNamed("もう一度試す")).toHaveLength(0);
    await waitFor(() => navBar(), "場面が畳まれて下部タブが出る");
    await click(nav("計測"));
    await waitFor(() => gum > 0, "計測タブでマイク");
    await waitFor(() => layerId() === "tuner", "① まずは吹いてみよう");
    await tick(200);
    expect(kv("onboardingDone")?.join).toBeUndefined();
    expect(server.signIns).toBe(0);
  }, 60000);

  it("裏のサインインで設定の欠落: 同じく場面が畳まれて下部タブが出る。join の印は書かない", async () => {
    server.configMissing = "signin";
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => document.body.textContent.includes(CONFIG_TEXT), "設定の欠落の失敗の画面");
    await waitFor(() => navBar(), "場面が畳まれて下部タブが出る");
    await click(nav("計測"));
    await waitFor(() => layerId() === "tuner", "① まずは吹いてみよう");
    expect(kv("onboardingDone")?.join).toBeUndefined();
  }, 60000);
});

describe("【便DD 審査】返ってこない通信には上限があり、上限のあとに再試行できる", () => {
  it("裏の匿名サインインが返らない: 上限のあと、フォームの上に「もう一度試す」。再試行が重なっても元の呼び出しの続きを待つ(サインインは二重にしない)。返れば保存できる", async () => {
    server.hangSignIn = true;
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitScene();
    await waitFor(() => document.querySelector("[data-join-retry] button"), "上限のあとの「もう一度試す」", 5000);
    expect(navBar()).toBe(null);
    expect(server.signIns).toBe(0);
    expect(server.signInCalls).toBe(1);
    // まだ返らないうちに再試行: 元の呼び出しの続きを待つ(新しい呼び出しを作らない)。もう一度上限のあと、また「もう一度試す」
    await click(document.querySelector("[data-join-retry] button"));
    await waitFor(() => document.querySelector("[data-join-retry] button"), "2回目の上限のあとの「もう一度試す」", 5000);
    expect(server.signInCalls).toBe(1);
    // 元の呼び出しが返る → 再試行で確認できて、保存できる(サインインはそのまま1回)
    server.hangSignIn = false;
    await mod.act(async () => { server.releaseSignIn(); });
    await waitFor(() => server.signIns === 1, "元のサインインが返った");
    await click(document.querySelector("[data-join-retry] button"));
    await waitFor(() => !document.querySelector("[data-join-retry] button"), "直ったので「もう一度試す」が消える");
    expect(server.signInCalls).toBe(1);
    await click(formBtn());
    await waitFor(() => layerId() === "tuner", "直ったので計測の ①");
    expect(server.signInCalls).toBe(1);
  }, 60000);

  it("保存が返らない: 上限のあと、フォームを開いたまま「保存に失敗しました」が出て、もう一度押せる。下部タブは出ない。直れば参加を終えて ①", async () => {
    server.hangSave = true;
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitScene();
    await click(formBtn());
    await waitFor(() => document.body.textContent.includes("保存に失敗しました"), "上限のあとの失敗の文言", 5000);
    expect(server.saves).toBe(1);
    expect(navBar()).toBe(null);
    expect(formBtn()).toBeTruthy();
    expect(kv("onboardingDone")?.join).toBeUndefined();
    server.hangSave = false;
    await click(formBtn());
    await waitFor(() => server.saves === 2, "再送");
    await waitFor(() => layerId() === "tuner", "再送が通って計測の ①");
    expect(server.signIns).toBe(1);   // 再送でアカウントを増やさない
  }, 60000);
});

describe("見本(?tutorialpreview=1)も新しい順", () => {
  const PREVIEW_DONE = "ficus.tutorialPreviewDone";
  it("見本: 同意のあとすぐプロフィールの入力(下部タブ無し・参加のカードなし)→ 保存 → 自動で計測タブへ戻り ①。本物の印・同意の記録は書かない", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitScene();
    expect(navBar()).toBe(null);
    expect(layerId()).toBe(null);
    expect(gum).toBe(0);
    expect(seenJoinCard).toBe(false);
    await createProfile();
    await waitFor(() => layerId() === "tuner", "見本の ①");
    expect(navBar()).not.toBe(null);
    expect(JSON.parse(window.localStorage.getItem(PREVIEW_DONE)).join).toBe(true);
    expect(kv("termsConsent")).toBeUndefined();
    expect(kv("onboardingDone")).toBeUndefined();
  }, 60000);

  it("見本: 参加するまで見本を開き直しても(見本の「済んだ」に join が無い間は)プロフィールの入力から", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitScene();
    await relaunch();
    await passConsent();
    await waitScene();
    expect(navBar()).toBe(null);
  }, 60000);

  it("見本: この端末のアカウントがもう参加済みなら、フォームは裏の確認で畳まれて計測の ①(アカウントは作らない)", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    server.uid = "me"; server.profile = { nickname: "n" };
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => layerId() === "tuner", "見本の ①");
    expect(formBtn()).toBe(undefined);
    expect(server.signInCalls).toBe(0);
  }, 60000);

  it("見本: 見本の「済んだ」に join が既にあれば、参加の場面は出さない(計測タブから ①)", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    window.localStorage.setItem(PREVIEW_DONE, JSON.stringify({ join: true }));
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => layerId() === "tuner", "見本の ①");
    expect(formBtn()).toBe(undefined);
    expect(navBar()).not.toBe(null);
  }, 60000);
});

describe("【便DE 審査】既存プロフィールの確認が済むまで保存を押せない", () => {
  const retryBtn = () => document.querySelector("[data-join-retry] button");
  const checking = () => document.querySelector("[data-join-checking]");

  it("確認(loadProfile)を止めたままだと、保存は押せない(無効・小さな待ちの表示)。確認が返って新しい人なら押せて、保存できる", async () => {
    let release;
    server.uid = "me"; server.profile = null;
    server.loadGate = new Promise((r) => { release = r; });
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES } });
    await launch();
    await waitScene();
    expect(formBtn().disabled).toBe(true);
    expect(checking()).toBeTruthy();
    expect(checking().textContent).toBe("確認しています…");
    await click(formBtn());
    await tick(200);
    expect(server.saves).toBe(0);                       // 押しても保存されない
    expect(navBar()).toBe(null);
    await mod.act(async () => { release(); });
    await waitFor(() => formBtn()?.disabled === false, "確認が返って保存が押せる");
    expect(checking()).toBe(null);
    await click(formBtn());
    await waitFor(() => layerId() === "tuner", "保存できて計測の ①");
    expect(server.saves).toBe(1);
    expect(server.savedUids).toEqual(["me"]);
  }, 60000);

  it("確認が返って参加済みのプロフィールが見つかったら、フォームを畳んで計測へ。新規の入力で上書きしない(保存は1回も走らない)", async () => {
    let release;
    server.uid = "me"; server.profile = { nickname: "いる人" };
    server.loadGate = new Promise((r) => { release = r; });
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES } });
    await launch();
    await waitScene();
    expect(formBtn().disabled).toBe(true);
    await click(formBtn());
    await mod.act(async () => { release(); });
    await waitFor(() => layerId() === "tuner", "畳まれて計測の ①");
    expect(server.saves).toBe(0);
    expect(server.profile).toEqual({ nickname: "いる人" });
    await waitFor(() => kv("onboardingDone")?.join === true, "join の印");
  }, 60000);

  it("確認の読みが失敗: 「もう一度試す」が出て、保存は押せないまま。再試行で確認できれば押せる", async () => {
    server.failLoad = true;
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES } });
    await launch();
    await waitScene();
    await waitFor(() => retryBtn(), "「もう一度試す」");
    expect(formBtn().disabled).toBe(true);
    expect(checking()).toBe(null);                      // 失敗の間は待ちの表示ではなく、再試行の表示
    await click(formBtn());
    await tick(100);
    expect(server.saves).toBe(0);
    server.failLoad = false;
    await click(retryBtn());
    await waitFor(() => formBtn()?.disabled === false, "確認できて保存が押せる");
    expect(retryBtn()).toBe(null);
  }, 60000);

  it("確認の読みが上限を超えて返らない: 「もう一度試す」が出て、保存は押せないまま。再試行で確認できれば押せる", async () => {
    server.uid = "me"; server.profile = null; server.hangLoadProfile = true;
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES } });
    await launch();
    await waitScene();
    await waitFor(() => retryBtn(), "上限のあとの「もう一度試す」", 5000);
    expect(formBtn().disabled).toBe(true);
    server.hangLoadProfile = false;
    await click(retryBtn());
    await waitFor(() => formBtn()?.disabled === false, "確認できて保存が押せる");
    await click(formBtn());
    await waitFor(() => layerId() === "tuner", "計測の ①");
    expect(server.savedUids).toEqual(["me"]);
  }, 60000);

  it("サーバーにアカウントがまだ無い端末は、読むものが無いので確認は一瞬で済み、保存が押せる(サインインは保存の中で待つ)", async () => {
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => formBtn()?.disabled === false, "保存が押せる");
    expect(checking()).toBe(null);
  }, 60000);
});

describe("【便DE 審査】ふだんの経路: アカウントを削除したあとの入り直しは、新しいサインインで保存する", () => {
  it("参加 → マイページ → アカウントを削除 → 参加のカード → プロフィール作成: サインインは2回走り、保存の uid は新しいもの", async () => {
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES, join: true, measure: true, tuner: true, arriveCommunity: true, goCommunity: true, adoptAverage: true } }, [SESSION("s1")]);
    await launch();
    await waitFor(() => navBar(), "計測タブ");
    await click(nav("コミュニティ"));
    await waitFor(() => joinCard(), "ふだんのタブの参加のカード");
    await click(joinCard());                                  // 1回目の参加(サインイン #1)
    await waitFor(() => formBtn(), "プロフィールの入力");
    await click(formBtn());
    await waitFor(() => server.saves === 1, "1回目の保存");
    expect(server.savedUids).toEqual(["me"]);
    // マイページ → アカウントを削除 → 確認のシート → 削除する
    await waitFor(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "マイページ"), "マイページ");
    await click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "マイページ"));
    const entry = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "アカウントを削除");
    await waitFor(() => entry(), "アカウントを削除");
    await click(entry());
    await waitFor(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "アカウントを削除する"), "確認のシート");
    await click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "アカウントを削除する"));
    await waitFor(() => joinCard(), "削除のあとの参加のカード");
    expect(server.uid).toBe(null);
    // すぐ入り直す(2回目の参加)
    await click(joinCard());
    await waitFor(() => formBtn(), "2回目のプロフィールの入力");
    await click(formBtn());
    await waitFor(() => server.saves === 2, "2回目の保存");
    expect(server.signInCalls).toBe(2);                        // サインインは2回(1回目の約束を持ち越さない)
    expect(server.savedUids).toEqual(["me", "me2"]);           // 2回目の保存は新しい uid(削除済みの "me" ではない)
  }, 90000);
});

describe("ふだんのコミュニティタブ(参加していない人が自分で開く)は変えない", () => {
  it("参加の印がある人が下部タブでコミュニティを開くと、今までどおり参加のカード(JoinIntro)。サーバーに無ければ読み込みのあとにカード", async () => {
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES, join: true, measure: true, tuner: true } }, [SESSION("s1")]);
    await launch();
    await waitFor(() => navBar(), "計測タブ");
    await click(nav("コミュニティ"));
    await waitFor(() => joinCard(), "ふだんのタブの参加のカード");
    expect(formBtn()).toBe(undefined);
    expect(server.signInCalls).toBe(0);   // カードを出すだけ。アカウントは作らない
  }, 60000);
});

describe("純関数: startsOnJoinScene / 参加した人に ⑭' goCommunity は出ない", () => {
  it("startsOnJoinScene: 参加の印(join)が無いときだけ true(ほかの印は関係しない・保存の状態だけで決める)", () => {
    expect(startsOnJoinScene({ done: {} })).toBe(true);
    expect(startsOnJoinScene({ done: null })).toBe(true);
    expect(startsOnJoinScene({})).toBe(true);
    expect(startsOnJoinScene({ done: { migrated: true, measure: true, tuner: true, finish: true } })).toBe(true);
    expect(startsOnJoinScene({ done: { join: false } })).toBe(true);
    expect(startsOnJoinScene({ done: { join: true } })).toBe(false);
    expect(startsOnJoinScene({ done: { join: true, measure: true, finish: true } })).toBe(false);
  });
  const TREND_DONE = { measure: true, tuner: true, arriveData: true, calendarDay: true, daySession: true, trend: true };
  const base = { topTab: "analysis", hasSessions: true, sessionsKnown: true };
  it("参加した人にはデータタブの橋 ⑭' goCommunity を出さない・参加していない人には今までどおり出す", () => {
    expect(coachCandidates({ ...base, done: { ...TREND_DONE, join: true } })).not.toContain("goCommunity");
    expect(coachCandidates({ ...base, done: { ...TREND_DONE } })).toContain("goCommunity");
  });
});
