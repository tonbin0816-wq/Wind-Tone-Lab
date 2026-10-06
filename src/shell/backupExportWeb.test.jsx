// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【殻 S3 審査 2026-10-06】Web の検査をこのファイルに分けた。vi.mock の factory は1つのファイルの中で1回しか走らず、
// vi.resetModules の後にも走り直さない。殻の検査と同じファイルに置くと、先に流れる殻の検査が factory を走らせたあとなので、
// 「factory が呼ばれない = プラグインのモジュールは読まれもしない」が張りぼてになっていた(同じファイルに殻の検査が無いので、ここでは本当に守れる)。
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
