// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便CK 2026-10-10 本人「よくある下にスワイプでリロードの仕様も追加して」】コミュニティタブの引っ張って更新。
// 統括の凍結仕様(便CK)から手で書いた期待値:
//   ・画面の一番上で、しきい値を越えて離すと「もう一度試す」と同じ読み直し(アカウントの確認・プロフィール・名簿・目安)が1回ずつ走る
//   ・越えない / 一番上でない / 横の引き / 更新中の2回目 / シート・写真の拡大・案内のカード・入力中 / 参加前 は走らない
//   ・失敗の画面・名簿の失敗からも更新できる
//   ・コミュニティタブの間だけ <html> の印 → index.css がページの overscroll-behavior-y を止める
// しきい値の期待値は index.css のトークン(--tap-min + 2 × --sp-2)から読む(実装の定数から逆算しない)。
// サーバーは作り物(accountRepo / directory / idealRepo の読みを数える・止める・落とす)。
// 【守っていないもの】本物の指(iOS の WKWebView / Safari でスクロールと取り合ったときの感触・touchmove が止められるか)・
// 本物の overscroll-behavior の効き目(Chrome でも判定できない。実機待ち)。
// ------------------------------------------------------------------

globalThis.indexedDB = createFakeIndexedDb();
const srv = vi.hoisted(() => ({
  uid: "me", profile: null, failProfile: false, failList: false, holdList: null,
}));
vi.mock("./accountRepo.js", async (orig) => ({
  ...(await orig()),
  getSignedInUid: vi.fn(() => Promise.resolve(srv.uid)),
  loadProfile: vi.fn(() => (srv.failProfile ? Promise.reject(Object.assign(new Error("net"), { code: "unavailable" })) : Promise.resolve(srv.profile))),
  watchMyPhoto: vi.fn(() => () => {}),
  ensureSignedIn: vi.fn(async () => "me"),
}));
vi.mock("./directory.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return {
    ...(await orig()),
    listPublicUsers: vi.fn(() => {
      if (srv.holdList) return srv.holdList.promise;
      return srv.failList ? Promise.reject(new Error("net")) : Promise.resolve(kit.SERVER_USERS);
    }),
    publishStats: vi.fn(async () => {}),
  };
});
vi.mock("./reportRepo.js", async () => ({ reportUser: vi.fn(async () => ({ already: false })) }));
vi.mock("./idealRepo.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listIdeals: vi.fn(() => Promise.resolve(kit.SERVER_IDEALS)), publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}) };
});

const accountRepo = await import("./accountRepo.js");
const directory = await import("./directory.js");
const idealRepo = await import("./idealRepo.js");
const { resetLoadProgress } = await import("./loadProgress.js");
const { default: CommunityTab } = await import("./CommunityTab.jsx");
const ptr = await import("./PullToRefresh.jsx");
const { SWIPE_BACK_THRESHOLD_MIN } = await import("../App.jsx");
const kit = await import("./blockKit.testutil.jsx");
const { setupDom, teardownDom, waitFor, buttonsNamed, bodyText, rankRowOf } = kit;

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "index.css"), "utf8").replace(/\r\n/g, "\n");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rootToken = (name) => {
  const m = new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(/:root\s*\{([\s\S]*?)\n\}/.exec(cssNoComments)[1]);
  return m ? m[1].trim() : null;
};
// 期待値: 印(--tap-min)+ 上下の --sp-2。index.css から読む
const TH = parseFloat(rootToken("--tap-min")) + 2 * parseFloat(rootToken("--sp-2"));

// ---------- 作り物の指 ----------
const touch = (type, x, y) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "touches", { value: type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: y }] });
  return ev;
};
// 押して dx, dy まで動かす(離さない)。最後の touchmove が preventDefault されたかを返す。
async function press(el, dx, dy, steps = 6) {
  let last = null;
  await act(async () => {
    el.dispatchEvent(touch("touchstart", 100, 100));
    for (let k = 1; k <= steps; k++) {
      last = touch("touchmove", 100 + (dx * k) / steps, 100 + (dy * k) / steps);
      el.dispatchEvent(last);
    }
  });
  return last.defaultPrevented;
}
async function release(el, type = "touchend") {
  await act(async () => { el.dispatchEvent(touch(type, 0, 0)); });
}
async function pullAndRelease(el, dy, type = "touchend") {
  await press(el, 0, dy);
  await release(el, type);
}
const settle = async (ms = 60) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

const calls = () => ({
  uid: accountRepo.getSignedInUid.mock.calls.length,
  profile: accountRepo.loadProfile.mock.calls.length,
  list: directory.listPublicUsers.mock.calls.length,
  ideals: idealRepo.listIdeals.mock.calls.length,
});
const busyMark = () => document.querySelector('[data-pull-state="busy"] [data-pull-mark]');
const anyMark = () => document.querySelector("[data-pull-mark]");
const joinedShown = () => ["データ", "順位", "シェア", "マイページ"].every((l) => buttonsNamed(l).length > 0);
const namesShown = () => bodyText().includes("しろねこ") || bodyText().includes("目安を公開している");
// SwipePager の track(静止時も translateX を持つ)
const track = () => [...document.querySelectorAll("div")].find((d) => (d.style.transform || "").startsWith("translateX(calc("));
const trackAt = (i) => (track()?.style.transform || "").startsWith(`translateX(calc(${i === 0 ? "0" : -i * 100}% `);

let host = null; let root = null;
async function draw() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<CommunityTab sessions={[]} tuningHz={442} onAdoptIdeal={() => ({})} />); });
}
// 引っ張って更新の包み(CommunityTab の根: AvatarSprite の次)
const wrap = () => host.children[1];
// 引く場所: 子タブの行の「データ」(包みの中・SwipePager の外)
const subTabBtn = () => buttonsNamed("データ")[0];

describe("【便CK】引っ張って更新の判断(純関数)", () => {
  it("しきい値 = 印(--tap-min)+ 上下の --sp-2(index.css から)= 60。トークンが読めなければ §6.3 の 60", () => {
    expect(TH).toBe(60);
    expect(ptr.pullThreshold(rootToken("--tap-min"), rootToken("--sp-2"))).toBe(TH);
    expect(ptr.pullThreshold("", "")).toBe(SWIPE_BACK_THRESHOLD_MIN);
    expect(ptr.pullThreshold("44px", "8px")).toBe(60);
  });
  it("下げる量は下向きだけ・しきい値で止まる", () => {
    expect(ptr.pullOffset(-20, 60)).toBe(0);
    expect(ptr.pullOffset(30, 60)).toBe(30);
    expect(ptr.pullOffset(200, 60)).toBe(60);
  });
  it("更新するのは、縦の引きを指で離して(中断でなく)しきい値以上のときだけ", () => {
    expect(ptr.pullShouldRefresh(true, false, 60, 60)).toBe(true);
    expect(ptr.pullShouldRefresh(true, false, 59, 60)).toBe(false);
    expect(ptr.pullShouldRefresh(true, true, 200, 60)).toBe(false);
    expect(ptr.pullShouldRefresh(null, false, 200, 60)).toBe(false);
  });
  it("一番上か: 文書のスクロール・触れた点から包みまでのどこかのスクロールを見る", () => {
    const rootEl = document.createElement("div");
    const pane = document.createElement("div");
    const leaf = document.createElement("span");
    rootEl.appendChild(pane); pane.appendChild(leaf);
    expect(ptr.pullAtTop(leaf, rootEl, 0)).toBe(true);
    expect(ptr.pullAtTop(leaf, rootEl, 1)).toBe(false);
    Object.defineProperty(pane, "scrollTop", { value: 5, configurable: true });
    expect(ptr.pullAtTop(leaf, rootEl, 0)).toBe(false);
  });
  it("掴まない間: aria-modal(シート・写真の拡大)/ .coach-layer(案内のカード)/ 入力欄のフォーカス", () => {
    document.body.innerHTML = "";
    expect(ptr.pullBlocked(document)).toBe(false);
    const d = document.createElement("div"); d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true");
    document.body.appendChild(d);
    expect(ptr.pullBlocked(document)).toBe(true);
    d.remove();
    const c = document.createElement("div"); c.className = "coach-layer"; document.body.appendChild(c);
    expect(ptr.pullBlocked(document)).toBe(true);
    c.remove();
    const i = document.createElement("input"); document.body.appendChild(i); i.focus();
    expect(ptr.pullBlocked(document)).toBe(true);
    i.blur(); i.remove();
    expect(ptr.pullBlocked(document)).toBe(false);
  });
});

describe("【便CK】指の状態機械(作り物の io)", () => {
  const ev = (x, y, target = null) => ({ target, touches: [{ clientX: x, clientY: y }] });
  const io = (over = {}) => {
    const log = { show: [], refresh: 0 };
    return { log, io: { atTop: () => true, blocked: () => false, busy: () => false, threshold: () => 60, still: () => false,
      show: (px) => log.show.push(px), refresh: () => { log.refresh++; }, ...over } };
  };
  it("更新中(busy)は新しい指を掴まない(包みの側の二重の止め)", () => {
    const a = io({ busy: () => true });
    const g = ptr.createPullGesture(a.io);
    g.start(ev(0, 0));
    expect(g.move(ev(0, 100))).toBe(false);
    g.end("touchend");
    expect(a.log.refresh).toBe(0);
    const b = io();
    const g2 = ptr.createPullGesture(b.io);
    g2.start(ev(0, 0));
    expect(g2.move(ev(0, 100))).toBe(true);
    g2.end("touchend");
    expect(b.log.refresh).toBe(1);
  });
  it("縦と決まる前(6px 未満)は preventDefault しない(§6.3)。縦と決まってから止める", () => {
    const a = io();
    const g = ptr.createPullGesture(a.io);
    g.start(ev(0, 0));
    expect(g.move(ev(0, 3))).toBe(false);
    expect(g.move(ev(4, 5))).toBe(false);   // 縦成分が 1.5 倍に届かない = 未確定
    expect(g.move(ev(0, 12))).toBe(true);
    expect(a.log.show.at(-1)).toBe(12);
  });
  it("2本目の指(別の start)は進行中の引きを戻してから始め直す(中断の終端は対象判定より前)", () => {
    let top = true;
    const a = io({ atTop: () => top });
    const g = ptr.createPullGesture(a.io);
    g.start(ev(0, 0));
    g.move(ev(0, 40));
    top = false;                 // 対象外の start でも、前の引きは必ず戻す
    g.start(ev(0, 0));
    expect(a.log.show.at(-1)).toBe(0);
    g.end("touchend");
    expect(a.log.refresh).toBe(0);
  });
});

describe("【便CK】ページの標準の動きを抑えるのはコミュニティタブの間だけ", () => {
  it("index.css: html[data-pull-refresh] だけが overscroll-behavior-y: none を持つ(html の素の規則は持たない)", () => {
    expect(ptr.PULL_REFRESH_ATTR).toBe("data-pull-refresh");
    expect(/\nhtml\[data-pull-refresh\] \{\s*overscroll-behavior-y: none;\s*\}/.test("\n" + cssNoComments)).toBe(true);
    const htmlRules = [...cssNoComments.matchAll(/(^|\n)([^{}\n]*\bhtml\b[^{}\n]*)\{([^}]*)\}/g)];
    const withOsb = htmlRules.filter((m) => /overscroll-behavior/.test(m[3])).map((m) => m[2].trim());
    expect(withOsb).toEqual(["html[data-pull-refresh]"]);
  });
});

describe("【便CK】コミュニティタブの引っ張って更新(作り物のサーバー・作り物の指)", () => {
  beforeEach(() => {
    setupDom();
    resetLoadProgress();
    Object.assign(srv, { uid: "me", profile: kit.MY_PROFILE, failProfile: false, failList: false, holdList: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    accountRepo.getSignedInUid.mockClear(); accountRepo.loadProfile.mockClear();
    directory.listPublicUsers.mockClear(); idealRepo.listIdeals.mockClear();
  });
  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    root = null; host?.remove(); host = null;
    teardownDom();
    vi.restoreAllMocks();
    delete window.matchMedia;
    delete window.scrollY;
  });
  async function drawJoined() {
    await draw();
    await waitFor(() => joinedShown() && namesShown(), "参加後の画面と名簿");
    await waitFor(() => calls().ideals >= 1 && calls().list >= 1, "名簿と目安の読み");
    await settle();
  }
  const holdList = () => {
    let resolve = null;
    const promise = new Promise((r) => { resolve = r; });
    srv.holdList = { promise, resolve: () => { srv.holdList = null; resolve(kit.SERVER_USERS); } };
    return srv.holdList;
  };

  it("<html> の印はタブを開いている間だけ(閉じれば外れる)", async () => {
    expect(document.documentElement.hasAttribute("data-pull-refresh")).toBe(false);
    await drawJoined();
    expect(document.documentElement.hasAttribute("data-pull-refresh")).toBe(true);
    await act(async () => root.unmount()); root = null;
    expect(document.documentElement.hasAttribute("data-pull-refresh")).toBe(false);
  });

  it("静止時は包みに style も印も無い(transform を残さない)", async () => {
    await drawJoined();
    expect(wrap().style.cssText).toBe("");   // 宣言が1つも残らない(React が外したあとの空の style 属性は残り得る)
    expect(wrap().hasAttribute("data-pull-state")).toBe(false);
    expect(anyMark()).toBe(null);
  });

  it("一番上でしきい値を越えて離す → 読み直し(アカウント・プロフィール・名簿・目安)が1回ずつ。更新中は印を出し、片付いたら消す。開いていた子タブはそのまま", async () => {
    await drawJoined();
    await act(async () => { buttonsNamed("順位")[0].click(); });
    await settle(80);
    expect(trackAt(1)).toBe(true);
    const before = calls();
    const hold = holdList();
    // 途中: 引いた量に合わせて中身が下がり、印が描かれていく(しきい値で止まる)
    const prevented = await press(subTabBtn(), 0, 40);
    expect(prevented).toBe(true);
    expect(wrap().style.transform).toBe("translateY(40px)");
    expect(anyMark()).not.toBe(null);
    await act(async () => { subTabBtn().dispatchEvent(touch("touchmove", 100, 100 + 150)); });
    expect(wrap().style.transform).toBe(`translateY(${TH}px)`);
    await release(subTabBtn());
    await waitFor(() => calls().list === before.list + 1, "名簿の読み直し");
    expect(busyMark()).not.toBe(null);
    expect(wrap().style.transform).toBe(`translateY(${TH}px)`);
    // 画面は入れ替わらない(読み込み中の大きな輪へ戻らない)
    expect(joinedShown()).toBe(true);
    expect(document.querySelector('[role="img"][aria-label="読み込み中"]')).toBe(null);
    hold.resolve();
    await waitFor(() => !busyMark(), "片付いたら印が消える");
    await settle();
    const after = calls();
    expect(after).toEqual({ uid: before.uid + 1, profile: before.profile + 1, list: before.list + 1, ideals: before.ideals + 1 });
    expect(anyMark()).toBe(null);
    expect(wrap().style.cssText).toBe("");   // 宣言が1つも残らない(React が外したあとの空の style 属性は残り得る)
    expect(trackAt(1)).toBe(true);   // 順位のまま
  });

  it("しきい値に届かずに離す → 戻るだけで何も読まない", async () => {
    await drawJoined();
    const before = calls();
    await pullAndRelease(subTabBtn(), TH - 5);
    await settle();
    expect(calls()).toEqual(before);
    expect(anyMark()).toBe(null);
    expect(wrap().style.cssText).toBe("");   // 宣言が1つも残らない(React が外したあとの空の style 属性は残り得る)
  });

  it("touchcancel(中断)はしきい値を越えていても更新しない", async () => {
    await drawJoined();
    const before = calls();
    await pullAndRelease(subTabBtn(), TH + 40, "touchcancel");
    await settle();
    expect(calls()).toEqual(before);
    expect(wrap().style.cssText).toBe("");   // 宣言が1つも残らない(React が外したあとの空の style 属性は残り得る)
  });

  it("一番上でない(文書がスクロールしている / 触れた点の祖先がスクロールしている)ときは反応しない", async () => {
    await drawJoined();
    const before = calls();
    Object.defineProperty(window, "scrollY", { value: 120, configurable: true });
    expect(await press(subTabBtn(), 0, TH + 40)).toBe(false);
    expect(wrap().style.transform).toBe("");
    await release(subTabBtn());
    delete window.scrollY;
    const inner = subTabBtn().parentElement;
    Object.defineProperty(inner, "scrollTop", { value: 30, configurable: true });
    await pullAndRelease(subTabBtn(), TH + 40);
    await settle();
    expect(calls()).toEqual(before);
  });

  it("横の引きでは反応しない(子タブの横スワイプ = SwipePager が動く)", async () => {
    await drawJoined();
    expect(trackAt(0)).toBe(true);
    const before = calls();
    const page = track().firstElementChild.firstElementChild;
    // 横に 100・下に 20(横が勝つ)
    expect(await press(page, -100, 20)).toBe(true);    // preventDefault は SwipePager のもの
    expect(wrap().style.transform).toBe("");
    await release(page);
    await settle(120);
    expect(trackAt(1)).toBe(true);
    expect(calls()).toEqual(before);
    expect(anyMark()).toBe(null);
  });

  it("上向きの縦の引き(スクロール)では反応しない・preventDefault もしない", async () => {
    await drawJoined();
    const before = calls();
    expect(await press(subTabBtn(), 0, -120)).toBe(false);
    await release(subTabBtn());
    await settle();
    expect(calls()).toEqual(before);
  });

  it("更新中にもう一度引いても二重に走らない", async () => {
    await drawJoined();
    const before = calls();
    const hold = holdList();
    await pullAndRelease(subTabBtn(), TH + 20);
    await waitFor(() => calls().list === before.list + 1, "1回目の名簿の読み直し");
    await pullAndRelease(subTabBtn(), TH + 20);
    await pullAndRelease(subTabBtn(), TH + 20);
    await settle();
    expect(calls().uid).toBe(before.uid + 1);
    expect(calls().list).toBe(before.list + 1);
    hold.resolve();
    await waitFor(() => !busyMark(), "片付く");
    await settle();
    expect(calls()).toEqual({ uid: before.uid + 1, profile: before.profile + 1, list: before.list + 1, ideals: before.ideals + 1 });
  });

  it("シート(人物のページ)が開いている間は反応しない", async () => {
    await drawJoined();
    await act(async () => { buttonsNamed("順位")[0].click(); });
    await settle(80);
    await act(async () => { rankRowOf("しろねこ").click(); });
    await waitFor(() => Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')), "人物のページ");
    const before = calls();
    await pullAndRelease(subTabBtn(), TH + 40);
    await settle();
    expect(calls()).toEqual(before);
    expect(anyMark()).toBe(null);
  });

  it("案内のカード(.coach-layer)が出ている間・入力欄にフォーカスがある間は反応しない", async () => {
    await drawJoined();
    const before = calls();
    const coach = document.createElement("div"); coach.className = "coach-layer"; document.body.appendChild(coach);
    await pullAndRelease(subTabBtn(), TH + 40);
    coach.remove();
    const input = document.createElement("input"); document.body.appendChild(input); input.focus();
    await pullAndRelease(subTabBtn(), TH + 40);
    input.blur(); input.remove();
    await settle();
    expect(calls()).toEqual(before);
    // 外したあとは効く(上の2つが「効かない作り」で通っていたのではない)
    await pullAndRelease(subTabBtn(), TH + 40);
    await waitFor(() => calls().uid === before.uid + 1, "外したら効く");
  });

  it("動きを減らす設定: 引いている間は追従しない・越えて離せば更新する", async () => {
    window.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    await drawJoined();
    const before = calls();
    await press(subTabBtn(), 0, TH + 40);
    expect(wrap().style.transform).toBe("");
    expect(anyMark()).toBe(null);
    await release(subTabBtn());
    await waitFor(() => calls().uid === before.uid + 1, "更新");
    await waitFor(() => !busyMark(), "片付く");
  });

  it("名簿の読み込みに失敗した状態からも更新できる", async () => {
    srv.failList = true;
    await draw();
    await waitFor(() => bodyText().includes("みんなのデータを読み込めませんでした"), "名簿の失敗");
    await settle();
    srv.failList = false;
    const before = calls();
    await pullAndRelease(subTabBtn(), TH + 20);
    await waitFor(() => namesShown(), "名簿が出る");
    await waitFor(() => !busyMark(), "片付く");
    expect(bodyText().includes("みんなのデータを読み込めませんでした")).toBe(false);
    expect(calls().list).toBe(before.list + 1);
  });

  it("読み込みの失敗の画面からも更新できる(「もう一度試す」と同じ読み)", async () => {
    srv.failProfile = true;
    await draw();
    await waitFor(() => bodyText().includes("通信に失敗しました"), "失敗の画面");
    srv.failProfile = false;
    const before = calls();
    const el = buttonsNamed("もう一度試す")[0].parentElement;
    await pullAndRelease(el, TH + 20);
    await waitFor(() => joinedShown(), "参加後の画面が開く");
    expect(calls().uid).toBe(before.uid + 1);
    expect(calls().profile).toBe(before.profile + 1);
    await waitFor(() => namesShown(), "名簿");
    expect(anyMark()).toBe(null);
  });

  it("失敗の画面で引いてまた失敗したら、失敗の画面のまま印が消える", async () => {
    srv.failProfile = true;
    await draw();
    await waitFor(() => bodyText().includes("通信に失敗しました"), "失敗の画面");
    const before = calls();
    await pullAndRelease(buttonsNamed("もう一度試す")[0].parentElement, TH + 20);
    await waitFor(() => calls().profile === before.profile + 1, "読み直し");
    await waitFor(() => !busyMark(), "印が消える");
    expect(bodyText().includes("通信に失敗しました")).toBe(true);
    expect(buttonsNamed("もう一度試す")).toHaveLength(1);
  });

  it("参加前(参加のカードの間)は反応しない", async () => {
    srv.profile = null;
    await draw();
    await waitFor(() => bodyText().includes("コミュニティに参加しよう"), "参加のカード");
    await settle();
    const before = calls();
    const card = [...document.querySelectorAll("*")].find((n) => n.textContent === "コミュニティに参加しよう");
    await pullAndRelease(card, TH + 40);
    // 参加のカードの層(.coach-layer)は「掴まない間」にも当たるので、それを外しても反応しないこと(包みが無いこと)を見る
    document.querySelector("[data-join-layer]")?.classList.remove("coach-layer");
    expect(document.querySelector(".coach-layer")).toBe(null);
    await pullAndRelease(host.children[1], TH + 40);
    await pullAndRelease(document.querySelector("[data-join-intro]") ?? host.children[1], TH + 40);
    await settle();
    expect(calls()).toEqual(before);
    expect(document.querySelector("[data-pull-state]")).toBe(null);
  });
});
