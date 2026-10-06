// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "./fakeIndexedDb.testutil.js";
// 最初の検査がアプリのモジュールを読み込む(負荷が高いと 5 秒を越える)。他の App を読む検査と同じ 30 秒にする
vi.setConfig({ testTimeout: 30000 });

// ------------------------------------------------------------------
// 【便BX 2026-10-06 本人の決定 D1・凍結仕様 coach3-spec.md §8・§13.2】参加の画面の導線「端末を替えるとき」のシートの中身
// (DeviceTransferPanel)を Web の枝で描いて押す。処理は BackupPanel の useBackupActions(写しを作らない)なので、
// 読み戻し(確認 → 置き換え → 知らせ)・書き出し(<a download>)・失敗の文が BackupPanel と同じ結果になることを見る。
// 期待値は仕様 §8.2 の文(一字一句)と BackupPanel の文から手で書いた。殻の枝(共有シート)は deviceTransferNative.test.jsx。
// 【守っていないもの】読み戻しのあとの window.location.reload(jsdom は画面の読み込み直しを持たない。呼ばれると jsdom が
//   Not implemented を出すだけ)・実機のファイルの選び方(iOS のファイルのピッカー。実機待ち)。
// ------------------------------------------------------------------
const SESSION = (id) => ({ id, recordedAt: "2026-10-01T10:00:00.000Z", saxType: "alto", reedId: null, memo: null, performer: "自分", source: "live", frames: [{ t: 0 }], barlines: [], noteEvents: [] });

let mod; let root; let host; let fake;
async function load() {
  vi.resetModules();
  fake = createFakeIndexedDb();
  globalThis.indexedDB = fake;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("../App.jsx");
  const Panel = await import("./DeviceTransferPanel.jsx");
  const Backup = await import("./BackupPanel.jsx");
  const Community = await import("../community/CommunityTab.jsx");
  const snap = await import("./snapshot.js");
  return { React, act: React.act, createRoot, openIdb: App.openIdb, Panel, Backup, Community, snap };
}
async function seed(n) {
  const db = await mod.openIdb();
  db.close?.();
  for (let i = 0; i < n; i++) fake._peek("windToneLabDB", "sessions").set(`s${i}`, SESSION(`s${i}`));
}
async function render(el) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = mod.createRoot(host);
  await mod.act(async () => { root.render(el ?? mod.React.createElement(mod.Panel.default)); });
}
const btn = (t) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === t) ?? null;
const settle = async () => { for (let i = 0; i < 40; i++) await mod.act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function chooseFile(text) {
  const input = host.querySelector('input[type="file"]');
  // jsdom の File は text() を持たないので、読み戻しが使う text() だけを持つ形で渡す(本物のブラウザの File と同じ呼び方)
  const file = { name: "ficus-backup.json", type: "application/json", text: async () => text };
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await mod.act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
}

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("「端末を替えるとき」の中身(仕様 §8.2)", () => {
  it("見出し・説明・手順3つ・主ボタン「ファイルから読み戻す」・注記・細い導線「この端末の記録を書き出す」。記録の保存・Web 版の1行は無い", async () => {
    mod = await load();
    await render();
    const root0 = host.firstElementChild;
    const kids = [...root0.children];
    expect(kids[0].textContent).toBe("端末を替えるとき");
    expect([kids[0].style.fontSize, kids[0].style.fontWeight, kids[0].style.color]).toEqual(["var(--fs-lg)", "700", "var(--c-ink)"]);
    expect(kids[1].textContent).toBe("記録(計測のデータとリード)はファイルで移せます。コミュニティの匿名アカウントは、この端末だけのもので移せません。参加し直すと新しいアカウントになります。");
    expect(kids[2].tagName).toBe("OL");
    // 【便BX 審査 統括の裁定】手順1は参加前の人にも当てはまる文・手順2は詰めた。断片(inline-block)の間でだけ折れる
    expect([...kids[2].children].map((li) => li.lastElementChild.textContent)).toEqual([
      "前の端末で書き出す(参加前はこの画面の下から、参加後はマイページから)", "ファイルをこの端末に送る(AirDrop・メールなど)", "ここで「ファイルから読み戻す」",
    ]);
    expect([...kids[2].children].map((li) => [...li.lastElementChild.children].map((x) => [x.textContent, x.style.display]))).toEqual([
      [["前の端末で書き出す", "inline-block"], ["(参加前はこの画面の下から、", "inline-block"], ["参加後はマイページから)", "inline-block"]],
      [["ファイルをこの端末に送る", "inline-block"], ["(AirDrop・メールなど)", "inline-block"]],
      [["ここで「ファイルから読み戻す」", "inline-block"]],
    ]);
    expect([...kids[2].children].map((li) => li.firstElementChild.textContent)).toEqual(["1", "2", "3"]);
    const dot = kids[2].children[0].firstElementChild.style;
    expect([dot.width, dot.height, dot.background, dot.color]).toEqual(["24px", "24px", "var(--c-accent-tint)", "var(--c-accent)"]);
    expect(kids[3].textContent).toBe("ファイルから読み戻す");
    expect(kids[4].textContent).toBe("読み戻すと、いまの記録はすべて置き換わります。実行する前に確認します。");
    expect(kids[5].textContent).toBe("この端末の記録を書き出す");
    expect(host.textContent).not.toContain("記録の保存");
    expect(host.textContent).not.toContain("Web 版");
    expect(host.textContent).not.toMatch(/機種|機材/);
    expect(host.querySelectorAll('input[type="file"]')).toHaveLength(1);
    // 主ボタンは BackupPanel の主ボタンと同じ塗り(PRIMARY_BUTTON を読む)・細い導線は参加のカードの細い導線と同じ体裁
    const p = kids[3].style;
    expect([p.width, p.minHeight, p.borderRadius, p.background, p.color, p.fontSize, p.fontWeight, p.marginTop])
      .toEqual(["100%", "var(--tap-min)", "var(--r-pill)", "var(--c-accent)", "var(--c-on-accent)", "var(--fs-md)", "700", "var(--sp-4)"]);
    const q = kids[5].style;
    expect([q.width, q.minHeight, q.background, q.color, q.fontSize, q.fontWeight, q.marginTop])
      .toEqual(["100%", "var(--tap-min)", "none", "var(--c-ink-2)", "var(--fs-sm)", "600", "var(--sp-3)"]);
    expect(mod.Panel.DEVICE_TRANSFER_TITLE).toBe("端末を替えるとき");
  });
  it("主ボタンは BackupPanel の定数そのもの・細い導線は CommunityTab の定数そのもの(写しを作らない)", async () => {
    mod = await load();
    expect(mod.Backup.PRIMARY_BUTTON.background).toBe("var(--c-accent)");
    expect(mod.Community.JOIN_QUIET_LINK_STYLE.minHeight).toBe("var(--tap-min)");
    expect(typeof mod.Backup.useBackupActions).toBe("function");
  });
});

describe("保存領域の申請(BackupPanel と同じ)", () => {
  it("開いたときに1回だけ navigator.storage.persist を呼ぶ(描き直しでは呼ばない)。結果は表示しない", async () => {
    mod = await load();
    const persist = vi.fn(async () => true);
    const real = Object.getOwnPropertyDescriptor(window.navigator, "storage");
    Object.defineProperty(window.navigator, "storage", { value: { persist, persisted: async () => false, estimate: async () => ({ usage: 0, quota: 1 }) }, configurable: true });
    try {
      await render();
      await settle();
      expect(persist).toHaveBeenCalledTimes(1);
      await mod.act(async () => { root.render(mod.React.createElement(mod.Panel.default)); });
      await settle();
      expect(persist).toHaveBeenCalledTimes(1);
      expect(host.textContent).not.toMatch(/保存されています|自動削除|MB を使用中/);
    } finally {
      if (real) Object.defineProperty(window.navigator, "storage", real); else delete window.navigator.storage;
    }
  });
});

describe("読み戻し(BackupPanel と同じ処理)", () => {
  it("主ボタンを押すと隠したファイルの入力が1回押される", async () => {
    mod = await load();
    await render();
    const clicks = vi.spyOn(window.HTMLInputElement.prototype, "click").mockImplementation(() => {});
    await mod.act(async () => { btn("ファイルから読み戻す").click(); });
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(clicks.mock.contexts[0].type).toBe("file");
  });
  it("ファイルを選ぶ → 件数を見せて確認 → はい: いまの記録が置き換わり「読み戻しました。…」", async () => {
    mod = await load();
    await seed(2);
    await render();
    const file = JSON.stringify(mod.snap.buildSnapshot({ kv: { onboardingDone: { migrated: true } }, sessions: [SESSION("n1"), SESSION("n2"), SESSION("n3")] }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await chooseFile(file);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toBe("このファイルには 計測3件が入っています。\nいまの記録(2回)はすべて置き換わります。よろしいですか？(元に戻せません)");
    expect([...fake._peek("windToneLabDB", "sessions").keys()].sort()).toEqual(["n1", "n2", "n3"]);
    expect(fake._peek("windToneLabDB", "kv").get("onboardingDone")).toEqual({ migrated: true });
    expect(host.textContent).toContain("読み戻しました。画面を読み込み直します");
    expect(host.textContent).not.toContain("読み戻せませんでした");
  });
  it("確認で「いいえ」: 何も変わらない", async () => {
    mod = await load();
    await seed(2);
    await render();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await chooseFile(JSON.stringify(mod.snap.buildSnapshot({ kv: {}, sessions: [SESSION("n1")] })));
    expect([...fake._peek("windToneLabDB", "sessions").keys()].sort()).toEqual(["s0", "s1"]);
    expect(host.textContent).not.toContain("読み戻しました");
  });
  it("Ficus のファイルでなければ BackupPanel と同じ失敗の文(確認は出さない)", async () => {
    mod = await load();
    await render();
    const confirm = vi.spyOn(window, "confirm");
    await chooseFile(JSON.stringify({ format: "other" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Ficus の書き出したファイルではありません");
    await chooseFile("{ not json");
    expect(host.textContent).toContain("ファイルの形式が読み取れません");
  });
});

describe("書き出し(Web の枝)", () => {
  it("細い導線を押すと <a download> が1回・知らせは BackupPanel と同じ文", async () => {
    mod = await load();
    await seed(3);
    await render();
    const aClick = vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const realCreate = URL.createObjectURL; const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:x"; URL.revokeObjectURL = () => {};
    try {
      await mod.act(async () => { btn("この端末の記録を書き出す").click(); });
      await settle();
    } finally { URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke; }
    expect(aClick).toHaveBeenCalledTimes(1);
    const d = new Date();
    const name = `ficus-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
    expect(host.textContent).toContain(`計測3件を ${name} に書き出しました`);
  });
});
