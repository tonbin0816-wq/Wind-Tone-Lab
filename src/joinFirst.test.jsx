// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";
import { startsOnJoinScene, ONBOARDING_FLAGS, coachCandidates } from "./onboarding.jsx";

// ------------------------------------------------------------------
// 【便DC 2026-10-21 本人の指示】「チュートリアルの順番で、利用規約の前にコミュニティのプロフィールを作成する順番にしてください。
// 作成後は今と同じく『まずは計測してみよう』に戻って続けてください」(統括が確認済みの順番)
//   新しい順: ようこそ → 利用規約に同意 → **コミュニティの参加の場面**(JoinIntro のカード → 匿名アカウント → プロフィール作成)→ 計測タブの ① から今までどおり
// **main.jsx が描くのと同じ根(AppRoot)**を描いて確かめる(consentGate.test.jsx と同じ作り)。
//   ・入れたて(同意なし): 同意のあと参加の場面 → 参加(プロフィール作成)→ 自動で計測タブへ戻り ① が出る。参加の場面の間はマイク・案内・広告が無い
//   ・参加を見送って下部タブの「計測」を押すと ① から。印は1つも書かない(参加の場面は join 以外の印を書かない)・拒否のカードは出る
//   ・同意済み・参加済み・案内を始めている既存の利用者は、今までどおり計測タブから(参加の場面を出さない)
//   ・参加した人に ⑭' goCommunity は出ない / 見送った人には今までどおり出る(coachCandidates)
//   ・見本(?tutorialpreview=1)の流れも新しい順 / 参加の場面にも便CO の広告の止めが効く
// サーバーは作り物(accountRepo などを差し替える。Firebase に触らない・実際の匿名アカウントは作らない)。IndexedDB も作り物。
// 【守っていないもの】実寸の見た目(参加のカードが下部タブの上に収まること)・実機の OS のマイクの許可の画面と ATT の並び(判定不能・実機待ち)。
// ------------------------------------------------------------------

const server = vi.hoisted(() => ({ uid: null, profile: null, signIns: 0 }));
vi.mock("./community/accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => server.uid),
  loadProfile: vi.fn(async () => server.profile),
  saveProfile: vi.fn(async (_uid, doc) => { server.profile = doc; }),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => { server.signIns += 1; server.uid = "me"; return "me"; }),
}));
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
let fake; let host; let mod; let root; let realRect; let realSIV; let realFetch; let gum; let micMode; let seenLayers; let observer;

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
const nav = (label) => document.querySelector(`[data-bottom-nav] button[aria-label="${label}"]`);
const layerId = () => document.querySelector("[data-coach-layer]")?.getAttribute("data-coach-layer") ?? null;
const joinCard = () => document.querySelector('[data-join-card][role="button"][aria-label="参加する"]');
const buttonsNamed = (name) => [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === name);
const adHold = () => document.documentElement.getAttribute("data-ad-hold");
const MIC_DENIED = "マイクの使用が許可されていません";
// 1枚目 → 2枚目 → チェック → 次へ → アプリ(下部タブ)
async function passConsent() {
  await click(document.querySelector("[data-consent-start]"));
  await waitFor(() => step() === "terms", "2枚目");
  await click(screen().querySelector('input[type="checkbox"]'));
  await click(document.querySelector("[data-consent-next]"));
  await waitFor(() => navBar(), "アプリ(下部タブ)");
}
// 参加のカード → プロフィールの入力 → 「プロフィールを作る」
async function createProfile() {
  await click(joinCard());
  await waitFor(() => buttonsNamed("プロフィールを作る").length > 0, "プロフィールの入力");
  await click(buttonsNamed("プロフィールを作る")[0]);
}

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
  server.uid = null; server.profile = null; server.signIns = 0;
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
  observer = new MutationObserver(() => { for (const el of document.querySelectorAll("[data-coach-layer]")) seenLayers.add(el.getAttribute("data-coach-layer")); });
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

describe("入れたて(同意なし): ようこそ → 規約 → 参加の場面 → プロフィール作成 → 計測 ①", () => {
  it("同意のあとは参加の場面(マイク・案内・広告は無い)。参加を終えると押さずに計測タブへ戻り ① から。参加の場面は印を join の1つしか書かず、到着カードは出ない", async () => {
    mod = await loadApp();
    await launch();
    expect(step()).toBe("welcome");
    await passConsent();
    // --- 参加の場面 ---
    await waitFor(() => joinCard(), "参加の場面(参加のカード)");
    expect(screen()).toBe(null);
    await waitFor(() => kv("termsConsent"), "同意の記録");
    await tick(300);
    expect(gum).toBe(0);                 // マイクは計測タブへ入るまで頼まない
    expect(layerId()).toBe(null);        // 案内のカードは無い
    expect(adHold()).toBe("1");          // 広告は出ない(止まっている)
    expect(server.signIns).toBe(0);      // 参加するまでアカウントは作らない
    expect(kv("onboardingDone")?.join).toBeUndefined();
    // --- 参加(カード → 入力 → 作る)---
    await click(joinCard());
    await waitFor(() => buttonsNamed("プロフィールを作る").length > 0, "プロフィールの入力");
    expect(server.signIns).toBe(1);
    expect(document.querySelector("[data-join-card]")).toBe(null);
    expect(layerId()).toBe(null);
    expect(gum).toBe(0);
    await click(buttonsNamed("プロフィールを作る")[0]);
    // --- 自動で計測タブへ戻り、今までどおり ① ---
    await waitFor(() => kv("onboardingDone")?.join === true, "join の印(参加の完了)");
    await waitFor(() => gum > 0, "計測タブでマイク");
    await waitFor(() => layerId() === "tuner", "① まずは吹いてみよう");
    expect(buttonsNamed("プロフィールを作る")).toHaveLength(0);
    expect(document.querySelector("[data-join-card]")).toBe(null);
    // 参加の場面が書いた印は join だけ(coach の印は ① が出てから先で立つもの以外が無い)
    const d = kv("onboardingDone");
    expect(d.arriveCommunity).toBeUndefined();   // 参加した直後に長い案内(到着カード)を出さない
    expect(d.goCommunity).toBeUndefined();
    expect(d.adoptAverage).toBeUndefined();
    expect(seenLayers.has("arriveCommunity")).toBe(false);
    expect(seenLayers.has("adoptAverage")).toBe(false);
    expect(server.signIns).toBe(1);
    // --- のちにコミュニティタブを開いたとき、到着カード(参加済みの人がタブを開いた直後の今までの道)---
    await click(nav("コミュニティ"));
    await waitFor(() => layerId() === "arriveCommunity", "のちの到着カード");
  }, 60000);

  it("参加を見送って下部タブの「計測」を押すと ① から。印は1つも書かない(join も goCommunity も)・アカウントは作らない", async () => {
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => joinCard(), "参加の場面");
    await tick(100);
    await click(nav("計測"));
    await waitFor(() => layerId() === "tuner", "① まずは吹いてみよう");
    expect(document.querySelector("[data-join-card]")).toBe(null);
    expect(gum).toBeGreaterThan(0);
    await tick(200);
    const d = kv("onboardingDone") ?? {};
    for (const f of ONBOARDING_FLAGS) {
      if (f === "tuner") continue;   // ① が出たあとの印は ① の側(1秒続いたら)
      expect(d[f], `印 ${f}`).toBeUndefined();
    }
    expect(server.signIns).toBe(0);
    expect(seenLayers.has("arriveCommunity")).toBe(false);
    // 見送った人は、あとで自分でコミュニティタブを開いたとき今までどおり(印 goCommunity はその時に立つ)
    await click(nav("コミュニティ"));
    await waitFor(() => joinCard(), "参加のカード");
    await waitFor(() => kv("onboardingDone")?.goCommunity === true, "今までの道で goCommunity");
  }, 60000);

  it("参加を見送ってマイクの許可を断ると、拒否のカードが出る(参加の場面から来た最初の計測タブも起動のときと同じ扱い)", async () => {
    micMode = "deny";
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => joinCard(), "参加の場面");
    expect(gum).toBe(0);
    await click(nav("計測"));
    await waitFor(() => gum > 0, "マイクを頼んだ");
    await waitFor(() => document.body.textContent.includes(MIC_DENIED), "拒否のカード");
    expect(layerId()).toBe(null);   // 許可されないので ① は出ない
    // ほかのタブへ移って計測タブへ戻っても(便DB)静かに保つ = 最初の1回だけが起動と同じ扱い
    await click(nav("リード"));
    await waitFor(() => !document.body.textContent.includes(MIC_DENIED), "他のタブでは拒否のカードが消える");
    await click(nav("計測"));
    await tick(300);
    expect(document.body.textContent.includes(MIC_DENIED)).toBe(false);
  }, 60000);

  it("参加の場面の間は、広告の止めが効いている(便CO の決まり)。案内の印が済んで広告を始めてよい状態でも、参加のカードが出ている間は止める", async () => {
    // onboardingShown が立っている = 2回目以降の起動の扱いで広告を始めてよい(adsAllowed の (b))。それでも参加のカードの間は止まる
    mod = await loadApp();
    await seed({ onboardingShown: true });
    await launch();
    await passConsent();
    await waitFor(() => joinCard(), "参加の場面");
    await tick(300);
    expect(adHold()).toBe("1");
    await click(nav("計測"));   // 場面を抜けるとカードが無くなる。案内のカード ① が出ているあいだも止める
    await waitFor(() => layerId() === "tuner", "①");
    expect(adHold()).toBe("1");
  }, 60000);
});

describe("今までの利用者の流れは変えない(参加の場面を出さない)", () => {
  it("同意済み・参加済み(記録も join もある)は計測タブから。参加のカードは出ない", async () => {
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES, join: true, measure: true, tuner: true } }, [SESSION("s1")]);
    await launch();
    expect(screen()).toBe(null);
    await waitFor(() => gum > 0, "計測タブのマイク");
    await tick(200);
    expect(joinCard()).toBe(null);
    expect(server.signIns).toBe(0);
  }, 60000);

  it("同意済みで入れたて同然(参加していない・印なし)の2回目の起動は、計測タブから ① ── 参加の場面を毎回出さない", async () => {
    mod = await loadApp();
    await seed({ termsConsent: REC, onboardingDone: { ...GATES } });
    await launch();
    expect(screen()).toBe(null);
    await waitFor(() => layerId() === "tuner", "① まずは吹いてみよう");
    expect(joinCard()).toBe(null);
  }, 60000);

  it("同意の画面を通した入れたての人でも、次の起動からは計測タブから(参加の場面は同意した起動の1回だけ)", async () => {
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => joinCard(), "参加の場面");
    await waitFor(() => kv("termsConsent"), "同意の記録");
    await mod.act(async () => root.unmount());
    host.remove(); document.body.innerHTML = "";
    mod = await loadApp();
    await launch();
    expect(screen()).toBe(null);
    await waitFor(() => layerId() === "tuner", "2回目の起動は計測の ①");
    expect(joinCard()).toBe(null);
  }, 60000);

  it("参加していない既存の利用者(計測あり・案内の印あり)が同意の画面を通っても、参加の場面ではなく計測タブへ", async () => {
    mod = await loadApp();
    await seed({ onboardingDone: { ...GATES, measure: true, tuner: true, metronome: true } }, [SESSION("s1")]);
    await launch();
    expect(step()).toBe("welcome");
    await passConsent();
    await waitFor(() => gum > 0, "計測タブのマイク");
    await tick(200);
    expect(joinCard()).toBe(null);
  }, 60000);
});

describe("見本(?tutorialpreview=1)も新しい順", () => {
  const PREVIEW_DONE = "ficus.tutorialPreviewDone";
  it("見本: 同意のあと参加の場面 → 参加 → 自動で計測タブへ戻り ①。本物の印・同意の記録は書かない", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => joinCard(), "見本の参加の場面");
    expect(layerId()).toBe(null);
    expect(gum).toBe(0);
    await createProfile();
    await waitFor(() => layerId() === "tuner", "見本の ①");
    expect(JSON.parse(window.localStorage.getItem(PREVIEW_DONE)).join).toBe(true);   // 見本の「済んだ」(localStorage)に join
    expect(kv("termsConsent")).toBeUndefined();
    expect(kv("onboardingDone")).toBeUndefined();
  }, 60000);

  it("見本: 参加を見送って「計測」を押すと ① から", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => joinCard(), "見本の参加の場面");
    await click(nav("計測"));
    await waitFor(() => layerId() === "tuner", "見本の ①");
    expect(window.localStorage.getItem(PREVIEW_DONE) ?? "{}").not.toContain('"join"');
  }, 60000);

  it("見本: この端末のアカウントがもう参加済みなら、参加の場面は一瞬で抜けて計測の ①(アカウントは作らない)", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    server.uid = "me"; server.profile = { nickname: "n" };
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => layerId() === "tuner", "見本の ①");
    expect(joinCard()).toBe(null);
    expect(server.signIns).toBe(0);
  }, 60000);

  it("見本: 見本の「済んだ」に join が既にあれば、参加の場面は出さない(計測タブから ①)", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    window.localStorage.setItem(PREVIEW_DONE, JSON.stringify({ join: true }));
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => layerId() === "tuner", "見本の ①");
    expect(joinCard()).toBe(null);
  }, 60000);
});

describe("純関数: startsOnJoinScene / 参加した人に ⑭' goCommunity は出ない", () => {
  it("startsOnJoinScene: この起動で同意した・印が1つも無い人だけ", () => {
    expect(startsOnJoinScene({ justAgreed: true, done: {} })).toBe(true);
    expect(startsOnJoinScene({ justAgreed: true, done: { migrated: true } })).toBe(true);   // 移行の印は案内の印ではない
    expect(startsOnJoinScene({ justAgreed: true, done: null })).toBe(true);
    expect(startsOnJoinScene({ justAgreed: false, done: {} })).toBe(false);                 // 次の起動以降は出さない
    expect(startsOnJoinScene({ done: {} })).toBe(false);
    for (const f of ONBOARDING_FLAGS) expect(startsOnJoinScene({ justAgreed: true, done: { [f]: true } }), `印 ${f}`).toBe(false);
  });
  const TREND_DONE = { measure: true, tuner: true, arriveData: true, calendarDay: true, daySession: true, trend: true };
  const base = { topTab: "analysis", hasSessions: true, sessionsKnown: true };
  it("参加した人にはデータタブの橋 ⑭' goCommunity を出さない・見送った人には今までどおり出す", () => {
    expect(coachCandidates({ ...base, done: { ...TREND_DONE, join: true } })).not.toContain("goCommunity");
    expect(coachCandidates({ ...base, done: { ...TREND_DONE } })).toContain("goCommunity");
  });
});
