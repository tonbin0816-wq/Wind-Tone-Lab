// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【殻 S2 2026-10-05】記録の書き出し(BackupPanel の「ファイルに書き出す」)の殻の枝と Web の枝。凍結仕様 shell-spec.md §4.1・§8.1-S2。
//   殻: Filesystem.writeFile(Cache・ficus-backup-YYYY-MM-DD.json・UTF8)→ その uri で Share.share → deleteFile → 知らせ
//       共有シートを閉じた("Share canceled")ら知らせも失敗も出さない。それ以外の例外は「書き出せませんでした。…」
//   Web: <a download> の click が1回。プラグインのモジュールは読まれもしない(vi.mock の factory が呼ばれない)
// IndexedDB は作り物(fakeIndexedDb.testutil.js)。BackupPanel を直に描く。
// 【守っていないもの】実機の共有シートで「ファイルに保存」できること・保存した .json が読み戻しのピッカーで選べること(実機待ち)。
// ------------------------------------------------------------------
const calls = vi.hoisted(() => ({ log: [], factories: [], shareImpl: null }));
vi.mock("@capacitor/filesystem", () => {
  calls.factories.push("filesystem");
  return {
    Directory: { Cache: "CACHE" },
    Encoding: { UTF8: "utf8" },
    Filesystem: {
      writeFile: vi.fn(async (o) => { calls.log.push(["writeFile", o]); return { uri: `file:///cache/${o.path}` }; }),
      deleteFile: vi.fn(async (o) => { calls.log.push(["deleteFile", o]); }),
    },
  };
});
vi.mock("@capacitor/share", () => {
  calls.factories.push("share");
  return { Share: { share: vi.fn(async (o) => { calls.log.push(["share", o]); if (calls.shareImpl) return calls.shareImpl(o); return {}; }) } };
});

const SESSION = (id) => ({ id, recordedAt: "2026-10-01T10:00:00.000Z", saxType: "alto", reedId: null, memo: null, performer: "自分", source: "live", frames: [{ t: 0 }], barlines: [], noteEvents: [] });

let mod; let root; let host; let fake;
async function load() {
  vi.resetModules();
  fake = createFakeIndexedDb();
  globalThis.indexedDB = fake;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const App = await import("../App.jsx");
  const Panel = await import("../backup/BackupPanel.jsx");
  return { React, act: React.act, createRoot, openIdb: App.openIdb, BackupPanel: Panel.default };
}
async function seed(n) {
  const db = await mod.openIdb();
  db.close?.();
  for (let i = 0; i < n; i++) fake._peek("windToneLabDB", "sessions").set(`s${i}`, SESSION(`s${i}`));
}
async function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = mod.createRoot(host);
  await mod.act(async () => { root.render(mod.React.createElement(mod.BackupPanel)); });
}
const exportButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "ファイルに書き出す");
const pressExport = async () => {
  await mod.act(async () => { exportButton().click(); });
  // 押している間はボタンが disabled(busy)。終わる(finally で busy が戻る)まで待つ。負荷で動的 import が遅れても足りるように上限は 3 秒
  for (let i = 0; i < 20 || (exportButton().disabled && i < 600); i++) await mod.act(async () => { await new Promise((r) => setTimeout(r, 5)); });
};
const today = () => {
  const d = new Date();
  return `ficus-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  calls.log.length = 0; calls.factories.length = 0; calls.shareImpl = null;
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  delete window.Capacitor;
  vi.restoreAllMocks();
});

describe("殻: 書き出しは Filesystem + Share(共有シート)", () => {
  beforeEach(() => { window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" }; });

  it("Cache に今日の名前で書き、その uri で共有し、一時ファイルを消し、知らせを出す。<a download> は押さない", async () => {
    mod = await load();
    await seed(3);
    await render();
    const aClick = vi.spyOn(window.HTMLAnchorElement.prototype, "click");
    await pressExport();
    const name = today();
    expect(calls.log.map((c) => c[0])).toEqual(["writeFile", "share", "deleteFile"]);
    const w = calls.log[0][1];
    expect([w.path, w.directory, w.encoding]).toEqual([name, "CACHE", "utf8"]);
    const written = JSON.parse(w.data);
    expect([written.format, written.counts.sessions, written.sessions.map((s) => s.id)]).toEqual(["ficus-backup", 3, ["s0", "s1", "s2"]]);
    expect(calls.log[1][1]).toEqual({ title: name, url: `file:///cache/${name}`, dialogTitle: "書き出し先を選ぶ" });
    expect(calls.log[2][1]).toEqual({ path: name, directory: "CACHE" });
    expect(host.textContent).toContain(`計測3件を ${name} に書き出しました`);
    expect(host.textContent).not.toContain("書き出せませんでした");
    expect(aClick).not.toHaveBeenCalled();
  });

  it("共有シートを閉じた(Share canceled)ら、知らせも失敗も出さない(一時ファイルは消す)", async () => {
    mod = await load();
    await seed(1);
    await render();
    calls.shareImpl = () => { throw new Error("Share canceled"); };
    await pressExport();
    expect(calls.log.map((c) => c[0])).toEqual(["writeFile", "share", "deleteFile"]);
    expect(host.textContent).not.toContain("書き出しました");
    expect(host.textContent).not.toContain("書き出せませんでした");
    // ボタンは押せる状態に戻っている(busy が残らない)
    expect(exportButton().disabled).toBe(false);
  });

  it("それ以外の失敗は「書き出せませんでした。…」(文言は Web と同じ)", async () => {
    mod = await load();
    await seed(1);
    await render();
    calls.shareImpl = () => { throw new Error("Error sharing item"); };
    await pressExport();
    expect(host.textContent).toContain("書き出せませんでした。端末の設定で保存領域が使えない可能性があります");
    expect(host.textContent).not.toContain("書き出しました");
    expect(calls.log.map((c) => c[0])).toEqual(["writeFile", "share", "deleteFile"]);
  });

  it("説明の下に Web 版からの移し方の1行が出る", async () => {
    mod = await load();
    await render();
    expect(host.textContent).toContain("Web 版で使っていた記録は、Web 版の同じ画面で「ファイルに書き出す」→ ここで「ファイルから読み戻す」の順で移せます。コミュニティの匿名アカウントは移せません。");
  });
});

describe("Web: 書き出しは今までどおり <a download>(プラグインは読まれもしない)", () => {
  it("a.click が1回・ファイル名は今日の名前・中身は記録の写し。Filesystem / Share のモジュールは import されない", async () => {
    mod = await load();
    await seed(2);
    await render();
    let anchor = null;
    const aClick = vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(function () { anchor = this; });
    let blob = null;
    window.URL.createObjectURL = vi.fn((b) => { blob = b; return "blob:fake"; });
    window.URL.revokeObjectURL = vi.fn();
    await pressExport();
    expect(aClick).toHaveBeenCalledTimes(1);
    expect([anchor.download, anchor.getAttribute("href")]).toEqual([today(), "blob:fake"]);
    // jsdom の Blob は text() を持たないので FileReader で読む
    const text = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsText(blob); });
    expect(JSON.parse(text).counts.sessions).toBe(2);
    expect(blob.type).toBe("application/json");
    expect(host.textContent).toContain(`計測2件を ${today()} に書き出しました`);
    expect(calls.log).toEqual([]);
    expect(calls.factories).toEqual([]);   // 動的 import すら起きていない
    // 移し方の1行は殻だけ
    expect(host.textContent).not.toContain("Web 版で使っていた記録は");
  });
});
