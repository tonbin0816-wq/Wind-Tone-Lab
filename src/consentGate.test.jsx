// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便CB 2026-10-08 本人の依頼】起動の最初の同意の画面(src/ConsentScreen.jsx の AppRoot)。
// 【便CC 2026-10-08 本人の直し】2枚になった(1枚目 = ようこそ / 2枚目 = 規約とポリシーの全文 + 下の帯のチェックと「次へ」)。
// 参加のカードの同意のチェックは無くなった(本人「最初に同意撮るのでコミュニティで同意出すのはやめて」)。
// **main.jsx が描くのと同じ根(AppRoot)**を描いて確かめる(アプリ単体 WindToneLabPhaseMode を描くのではない)。
//   ・入れたての人: 1枚目(芽・Ficus・1行・はじめる。チェックは無い)。下部タブ・案内・マイクの取得は無い
//   ・はじめる → 2枚目: 規約 → ポリシーの全文(public/*.html を LegalSheet と同じ読み方で)。チェックするまで「次へ」は押せない
//   ・次へで kv に { at, version } が書かれ、アプリが描かれ、マイクが始まり ① が出る。引継の書き出しにも入る
//   ・2枚目で閉じたら次は1枚目から(枚はメモリの上だけ)/ 同意したら次からは出ない
//   ・本文の中のリンク: mailto: は通す・それ以外は移動を止め、規約・ポリシーへのリンクはその文書へ送る
//   ・参加済み(onboardingDone.join)には出さない / 参加していない既存の利用者(計測あり)には1回だけ / 欠けた記録は数えない
//   ・見本は記録があっても毎回 1枚目 → 2枚目。記録は書かない
//   ・参加のカード: どの人にも同意のチェックは無い
//   ・記録の無い古いバックアップを読み戻したら(本物の validateSnapshot → writeAll → 読み込み直し)、次の起動で同意の画面が出る
// サーバーは作り物(accountRepo などを差し替える。Firebase に触らない・アカウントを作らない)。IndexedDB も作り物。
// public/*.html は fetch の作り物がディスクから返す(jsdom には同じ origin の配信が無い)。
// 【守っていないもの】見た目の実寸(中央・帯の固定・安全域・iPad の列)と殻での ATT・広告の順番・iOS の戻るスワイプ。
//   実寸は headless Chrome の実測(報告)。ATT・広告は「マイクの最初の試みのあと」に始まる(shellStartAdsOnce)ので、
//   マイクが同意の前に0回であることで間接に見ている。戻るスワイプは履歴に何も積まない作り(ここでは history.length を見るだけ)。
// ------------------------------------------------------------------

vi.mock("./community/accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(async () => null),   // 参加していない(参加のカードが出る)
  loadProfile: vi.fn(async () => null),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => { throw new Error("検査: サインインしない"); }),
}));
vi.mock("./community/directory.js", async (orig) => ({ ...(await orig()), listPublicUsers: vi.fn(async () => []), publishStats: vi.fn(async () => {}) }));
vi.mock("./community/idealRepo.js", async (orig) => ({ ...(await orig()), listIdeals: vi.fn(async () => []), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) }));

const W = 375; const H = 812;
const LINE = "サックス奏者のためのチューナー&メトロノーム";
const AGREE = "利用規約とプライバシーポリシーに同意する";
let fake; let host; let mod; let root; let realRect; let realSIV; let realFetch; let gum; let scrolled;

async function loadApp() {
  vi.resetModules();
  globalThis.indexedDB = fake;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("./App.jsx");
  const gate = await import("./ConsentScreen.jsx");
  const local = await import("./backup/localStore.js");
  const snap = await import("./backup/snapshot.js");
  return { React, act: React.act, createRoot, AppRoot: gate.default, openIdb: App.openIdb, warm: App.warmPersistedStateCache, readAll: local.readAll, writeAll: local.writeAll, snap };
}
const kv = (key) => fake._peek("windToneLabDB", "kv")?.get(key);
async function seed({ kvEntries = {}, sessions = [] } = {}) {
  const db = await mod.openIdb();
  db.close?.();
  for (const [k, v] of Object.entries(kvEntries)) fake._peek("windToneLabDB", "kv").set(k, structuredClone(v));
  for (const s of sessions) fake._peek("windToneLabDB", "sessions").set(s.id, structuredClone(s));
}
// main.jsx と同じ順: 温めてから根を描く
async function launch() {
  await mod.warm();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = mod.createRoot(host);
  await mod.act(async () => { root.render(mod.React.createElement(mod.AppRoot)); });
}
// 閉じて開き直す(= 読み込み直し。モジュールごと作り直す)
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
const screen = () => document.querySelector("[data-consent-screen]");
const step = () => screen()?.getAttribute("data-consent-step") ?? null;
const startBtn = () => document.querySelector("[data-consent-start]");
const nextBtn = () => document.querySelector("[data-consent-next]");
const box = () => screen().querySelector('input[type="checkbox"]');
const section = (k) => document.querySelector(`[data-legal-section="${k}"]`);
const navBar = () => document.querySelector("[data-bottom-nav]");
const layerId = () => document.querySelector("[data-coach-layer]")?.getAttribute("data-coach-layer") ?? null;
const click = (el) => mod.act(async () => { el.click(); });
const joinCard = () => document.querySelector("[data-join-card]");
// 【便CD 2026-10-08】「参加する」はカードそのもの(role="button"・名前「参加する」。カードの中にボタンは無い)
const joinBtn = () => (joinCard()?.getAttribute("role") === "button" && joinCard().getAttribute("aria-label") === "参加する" ? joinCard() : null);
// 1枚目 → 2枚目 → チェック → 次へ
async function passConsent() {
  await click(startBtn());
  await waitFor(() => step() === "terms", "2枚目");
  await click(box());
  await click(nextBtn());
  await waitFor(() => navBar(), "アプリ(下部タブ)");
}

// 作り物のマイク(onboardingApp.test.jsx の installFakeMic と同じ形)。getUserMedia の呼ばれた回数を数える。
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
  Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => { gum += 1; return stream; } }, configurable: true });
}

beforeEach(() => {
  fake = createFakeIndexedDb();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-tutorial-preview");
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  window.scrollTo = () => {};
  Object.defineProperty(window, "innerWidth", { value: W, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: H, configurable: true, writable: true });
  // ① の的(環の箱)とカードの矩形(375×812 の実測と同じ値)。それ以外は jsdom の既定(0)のまま。
  realRect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function () {
    const b = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t });
    if (this.classList?.contains("coach-card")) return b(22, 0, W - 44, 146);
    if (this.getAttribute?.("data-coach") === "tuner") return b(14, 96, 347, 330);
    return b(0, 0, 0, 0);
  };
  scrolled = [];
  realSIV = window.Element.prototype.scrollIntoView;
  window.Element.prototype.scrollIntoView = function () { scrolled.push(this.getAttribute?.("data-legal-section") ?? this.tagName); };
  // 同じ origin の public/*.html(LegalSheet の loadLegalHtml が fetch する)
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const name = String(url).replace(/^\//, "");
    if (!/^(terms|privacy)\.html$/.test(name)) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, status: 200, text: async () => readFileSync(join(process.cwd(), "public", name), "utf8") };
  };
  installFakeMic();
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-tutorial-preview");
  window.Element.prototype.getBoundingClientRect = realRect;
  window.Element.prototype.scrollIntoView = realSIV;
  globalThis.fetch = realFetch;
  delete window.AudioContext;
  try { delete window.navigator.mediaDevices; } catch { /* */ }
});

const GATES = { migrated: true, migratedMeasureSteps: true, migratedCoach2: true, migratedCoach3: true, migratedCoach4: true };
const NOW_ISO = new Date(Date.now() - 60 * 1000).toISOString();
const SESSION = (id) => ({ id, recordedAt: NOW_ISO, saxType: "alto", reedId: null, linkedAt: null, memo: null, performer: "自分", source: "live", frames: [], barlines: [], noteEvents: [] });

describe("入れたての人: 1枚目(ようこそ)→ 2枚目(規約)", () => {
  it("1枚目: 芽・Ficus・1行・はじめる(最初から押せる)だけ。チェックは無い。下部タブ・案内・マイクは無い", async () => {
    mod = await loadApp();
    await launch();
    expect(step()).toBe("welcome");
    expect(screen().querySelector("h1").textContent).toBe("Ficus");
    const p = screen().querySelector("p");
    expect(p.textContent).toBe(LINE);
    expect(p.textContent).toContain("&");            // 半角の & がそのまま出る(&amp; の字のまま見えない)
    expect(p.textContent).not.toContain("&amp;");
    const svg = screen().querySelector("svg");       // アイコンの芽(読み込み中の絵の 100% = 塗りの1枚)
    expect(svg.getAttribute("width")).toBe("88");
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    expect(screen().querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(screen().textContent).not.toContain("同意");
    expect(startBtn().textContent).toBe("はじめる");
    expect(startBtn().disabled).toBe(false);
    // 【便CD 2026-10-08 本人「始めるを塗りつぶしじゃなくて枠線で」】地は抜き、枠と字が紺。枠の太さは My Data のカレンダーの「今日」の印
    // (App.jsx の inset 0 0 0 1.5px var(--c-accent))と同じ 1.5px。期待値は仕様から手で書いた(定数から読まない)。形・高さ・字の大きさは主ボタンの標準のまま
    const sb = startBtn().style;
    // (jsdom は var() を含む border を幅・線・色に分けないので、まとめ書きのまま比べる)
    expect([sb.backgroundColor || sb.background, sb.color, sb.border])
      .toEqual(["transparent", "var(--c-accent)", "1.5px solid var(--c-accent)"]);
    expect([sb.minHeight, sb.borderRadius, sb.fontSize, sb.fontWeight, sb.width])
      .toEqual(["var(--tap-min)", "var(--r-pill)", "var(--fs-md)", "700", "100%"]);
    await tick(300);
    expect(navBar()).toBe(null);
    expect(layerId()).toBe(null);
    expect(gum).toBe(0);
  }, 30000);

  it("はじめる → 2枚目: 規約 → ポリシーの全文が最初から出る。チェックするまで「次へ」は押せない。履歴に積まない", async () => {
    mod = await loadApp();
    await launch();
    const histBefore = window.history.length;
    await click(startBtn());
    await waitFor(() => step() === "terms", "2枚目");
    await waitFor(() => section("terms")?.querySelector("h1") && section("privacy")?.querySelector("h1"), "2つの本文");
    expect(section("terms").className).toBe("legal-doc");
    expect(section("terms").querySelector("h1").textContent).toBe("利用規約");
    expect(section("privacy").querySelector("h1").textContent).toBe("プライバシーポリシー");
    expect(section("terms").textContent).toContain("本アプリの利用開始時（初めて起動したとき）に、本規約とプライバシーポリシーへの同意をいただいています。");
    expect(section("privacy").textContent).toContain("Google AdMob");
    expect(section("terms").querySelector(".back")).toBe(null);   // 「← Ficus に戻る」は描かない(LegalSheet と同じ)
    expect(Boolean(section("terms").compareDocumentPosition(section("privacy")) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    // 本文はスクロールの器の中・帯はその外(流れの最後の子)
    const scroller = document.querySelector("[data-consent-scroll]");
    const bar = document.querySelector("[data-consent-bar]");
    expect(scroller.contains(section("privacy"))).toBe(true);
    expect(scroller.contains(bar)).toBe(false);
    expect(screen().lastElementChild).toBe(bar);
    expect(bar.querySelector("label").textContent).toBe(AGREE);
    expect(nextBtn().textContent).toBe("次へ");
    expect(nextBtn().disabled).toBe(true);
    expect(nextBtn().style.background).toBe("var(--c-disabled)");
    await click(nextBtn());
    await tick(100);
    expect(step()).toBe("terms");
    expect(kv("termsConsent")).toBeUndefined();
    expect(gum).toBe(0);
    expect(navBar()).toBe(null);
    expect(window.history.length).toBe(histBefore);
  }, 30000);

  it("チェック → 次へ: kv に日時と版を書き、アプリが描かれ、マイクが始まり ① が出る。引継の書き出しにも入る", async () => {
    mod = await loadApp();
    await launch();
    await click(startBtn());
    await waitFor(() => step() === "terms", "2枚目");
    await click(screen().querySelector("label > span:last-child"));   // 行の文字を押しても入る
    expect(box().checked).toBe(true);
    expect(nextBtn().disabled).toBe(false);
    expect(nextBtn().style.background).toBe("var(--c-accent)");
    const before = Date.now();
    await click(nextBtn());
    await waitFor(() => navBar(), "アプリ(下部タブ)");
    expect(screen()).toBe(null);
    await waitFor(() => kv("termsConsent"), "同意の記録(kv)");
    const rec = kv("termsConsent");
    expect(Object.keys(rec).sort()).toEqual(["at", "version"]);
    expect(rec.version).toBe("2026-10-08");
    expect(Math.abs(Date.parse(rec.at) - before)).toBeLessThan(5000);
    expect(new Date(rec.at).toISOString()).toBe(rec.at);
    await waitFor(() => gum > 0, "マイク");
    await waitFor(() => layerId() === "tuner", "① まずは吹いてみよう");
    const snap = await mod.readAll();
    expect(snap.kv.termsConsent).toEqual(rec);
  }, 30000);

  it("2枚目で閉じたら、次は1枚目から(記録は無い)", async () => {
    mod = await loadApp();
    await launch();
    await click(startBtn());
    await waitFor(() => step() === "terms", "2枚目");
    await click(box());   // チェックしただけで次へは押さない
    await relaunch();
    expect(step()).toBe("welcome");
    expect(kv("termsConsent")).toBeUndefined();
    expect(gum).toBe(0);
  }, 30000);

  it("同意したら、起動し直しても出ない。記録は書き換えない", async () => {
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => kv("termsConsent"), "同意の記録");
    const rec = structuredClone(kv("termsConsent"));
    await relaunch();
    expect(screen()).toBe(null);
    expect(navBar()).not.toBe(null);
    await tick(200);
    expect(kv("termsConsent")).toEqual(rec);
  }, 30000);

  it("本文の中のリンク: mailto: は止めない。規約・ポリシーへのリンクは移動を止めて、その文書へ送る", async () => {
    mod = await loadApp();
    await launch();
    await click(startBtn());
    await waitFor(() => section("privacy")?.querySelector("h1"), "2つの本文");
    // 画面の受け(React の onClick。根の要素で受ける)のあとに window で defaultPrevented を読み、そのあと jsdom の移動を起こさないよう止める
    const clickAndRead = async (el) => {
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
      let seen = null;
      const onWin = (e) => { if (e === ev) { seen = e.defaultPrevented; e.preventDefault(); } };
      window.addEventListener("click", onWin);
      await mod.act(async () => { el.dispatchEvent(ev); });
      window.removeEventListener("click", onWin);
      return seen;
    };
    const mail = section("terms").querySelector('a[href^="mailto:"]');
    expect(mail).not.toBe(null);
    expect(await clickAndRead(mail)).toBe(false);   // 本文の mailto: は止めない(メールのアプリへ)
    const toPrivacy = document.createElement("a"); toPrivacy.setAttribute("href", "/privacy.html"); toPrivacy.textContent = "p";
    section("terms").appendChild(toPrivacy);
    expect(await clickAndRead(toPrivacy)).toBe(true);
    expect(scrolled).toEqual(["privacy"]);
    const outside = document.createElement("a"); outside.setAttribute("href", "https://example.com/"); outside.textContent = "o";
    section("privacy").appendChild(outside);
    expect(await clickAndRead(outside)).toBe(true);
    expect(scrolled).toEqual(["privacy"]);
    expect(step()).toBe("terms");
  }, 30000);
});

describe("既存の利用者", () => {
  it("参加済み(onboardingDone.join)の人には出さない。記録は書かない", async () => {
    mod = await loadApp();
    await seed({ kvEntries: { onboardingDone: { ...GATES, join: true, measure: true } }, sessions: [SESSION("s1")] });
    await launch();
    expect(screen()).toBe(null);
    expect(navBar()).not.toBe(null);
    await tick(300);
    expect(kv("termsConsent")).toBeUndefined();
  }, 30000);

  it("参加していない人(計測あり)には1回だけ出す。マイクは同意の前に始まらない", async () => {
    mod = await loadApp();
    await seed({ kvEntries: { onboardingDone: { ...GATES, measure: true, tuner: true, metronome: true } }, sessions: [SESSION("s1")] });
    await launch();
    expect(step()).toBe("welcome");
    await tick(300);
    expect(gum).toBe(0);
    expect(navBar()).toBe(null);
    await passConsent();
    await waitFor(() => gum > 0, "同意のあとにマイク");
    await waitFor(() => kv("termsConsent"), "同意の記録");
    await relaunch();
    expect(screen()).toBe(null);
  }, 30000);

  it("壊れた記録(版が無い)は記録として数えない(出す)", async () => {
    mod = await loadApp();
    await seed({ kvEntries: { termsConsent: { at: "2026-10-08T00:00:00.000Z" }, onboardingDone: { ...GATES } } });
    await launch();
    expect(step()).toBe("welcome");
  }, 30000);
});

describe("記録の無い古いバックアップを読み戻したとき(本物の validateSnapshot → writeAll → 読み込み直し)", () => {
  const oldFile = (kvEntries) => JSON.parse(JSON.stringify(mod.snap.buildSnapshot({ kv: kvEntries, sessions: [SESSION("old1")] })));
  it("同意済みの端末に記録の無いファイルを読み戻すと、次の起動で同意の画面(1枚目)が出る", async () => {
    mod = await loadApp();
    await launch();
    await passConsent();
    await waitFor(() => kv("termsConsent"), "同意の記録");
    const checked = mod.snap.validateSnapshot(oldFile({ onboardingDone: { ...GATES, measure: true } }));
    expect(checked.ok).toBe(true);
    expect(checked.data.kv.termsConsent).toBeUndefined();
    await mod.writeAll({ kv: checked.data.kv, sessions: checked.data.sessions });   // BackupPanel の読み戻しと同じ呼び出し(このあと reload)
    expect(kv("termsConsent")).toBeUndefined();
    await relaunch();
    expect(step()).toBe("welcome");
    expect(navBar()).toBe(null);
    await passConsent();
    await waitFor(() => kv("termsConsent")?.version === "2026-10-08", "同意し直した記録");
  }, 40000);

  it("参加の印のあるファイルなら、記録が無くても出さない(参加のときに同意している)", async () => {
    mod = await loadApp();
    await launch();
    await passConsent();
    const checked = mod.snap.validateSnapshot(oldFile({ onboardingDone: { ...GATES, join: true } }));
    await mod.writeAll({ kv: checked.data.kv, sessions: checked.data.sessions });
    await relaunch();
    expect(screen()).toBe(null);
    expect(navBar()).not.toBe(null);
  }, 40000);
});

describe("見本(?tutorialpreview=1)", () => {
  it("記録があっても毎回 1枚目 → 2枚目。同意しても記録は書かない(書き換えない)", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    const REC = { at: "2026-10-08T00:00:00.000Z", version: "2026-10-08" };
    mod = await loadApp();
    await seed({ kvEntries: { termsConsent: REC, onboardingDone: { ...GATES } } });
    await launch();
    expect(step()).toBe("welcome");
    expect(gum).toBe(0);
    await passConsent();
    await waitFor(() => layerId() === "tuner", "見本の ①");
    expect(kv("termsConsent")).toEqual(REC);
    await relaunch();
    expect(step()).toBe("welcome");   // 開き直してもまた出る
  }, 30000);

  it("記録の無い端末の見本でも、同意しても記録は書かない", async () => {
    document.documentElement.setAttribute("data-tutorial-preview", "1");
    mod = await loadApp();
    await launch();
    await passConsent();
    await tick(300);
    expect(kv("termsConsent")).toBeUndefined();
  }, 30000);
});

describe("参加のカード(根 → アプリ → コミュニティ → JoinIntro)に同意のチェックは無い", () => {
  const openCommunity = async () => {
    await click(document.querySelector('button[aria-label="コミュニティ"]'));
    await waitFor(() => joinCard(), "参加のカード", 20000);
  };
  const expectNoCheck = () => {
    expect(joinCard().querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(joinCard().textContent).not.toContain("同意します");
    expect(joinBtn()).not.toBe(null);
    expect(joinBtn().hasAttribute("aria-disabled")).toBe(false);
    expect(joinCard().querySelectorAll("button")).toHaveLength(0);
  };
  it("起動の最初に同意した人", async () => {
    mod = await loadApp();
    await launch();
    await passConsent();
    await openCommunity();
    expectNoCheck();
  }, 40000);

  it("記録が無く参加の印だけある人(同意の画面は出ない)にも出さない", async () => {
    mod = await loadApp();
    await seed({ kvEntries: { onboardingDone: { ...GATES, join: true } } });
    await launch();
    expect(screen()).toBe(null);
    await openCommunity();
    expectNoCheck();
  }, 40000);
});
