// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeIndexedDb } from "./fakeIndexedDb.testutil.js";
// 最初の検査がアプリのモジュールを読み込む(負荷が高いと 5 秒を越える)。他の App を読む検査と同じ 30 秒にする
vi.setConfig({ testTimeout: 30000 });

// ------------------------------------------------------------------
// 【便BX 2026-10-06 本人の決定 D1・凍結仕様 coach3-spec.md §8.2・§11】「端末を替えるとき」の細い導線(この端末の記録を書き出す)は、
// 殻では BackupPanel と同じ共有シートの枝を通る(useBackupActions の殻の分岐をそのまま使う)。手は backupExport.test.jsx と同じ
// (Filesystem / Share を作り物に差し替え、window.Capacitor で殻を名乗る)。
// 【守っていないもの】実機の共有シートで「ファイルに保存」できること(実機待ち)。
// ------------------------------------------------------------------
const calls = vi.hoisted(() => ({ log: [], shareImpl: null }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    writeFile: vi.fn(async (o) => { calls.log.push(["writeFile", o]); return { uri: `file:///cache/${o.path}` }; }),
    deleteFile: vi.fn(async (o) => { calls.log.push(["deleteFile", o]); }),
  },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn(async (o) => { calls.log.push(["share", o]); if (calls.shareImpl) return calls.shareImpl(o); return {}; }) } }));

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
  return { React, act: React.act, createRoot, openIdb: App.openIdb, Panel: Panel.default };
}
const btn = (t) => [...host.querySelectorAll("button")].find((b) => b.textContent.trim() === t) ?? null;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  calls.log.length = 0; calls.shareImpl = null;
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
});
afterEach(async () => {
  if (root) await mod.act(async () => root.unmount());
  root = null;
  host?.remove();
  document.body.innerHTML = "";
  delete window.Capacitor;
  vi.restoreAllMocks();
});

describe("殻: 「この端末の記録を書き出す」は共有シート(BackupPanel と同じ枝)", () => {
  it("Cache に書き → 共有 → 一時ファイルを消す → 知らせ。<a download> は押さない", async () => {
    mod = await load();
    const db = await mod.openIdb(); db.close?.();
    for (const id of ["s0", "s1"]) fake._peek("windToneLabDB", "sessions").set(id, SESSION(id));
    host = document.createElement("div"); document.body.appendChild(host);
    root = mod.createRoot(host);
    await mod.act(async () => { root.render(mod.React.createElement(mod.Panel)); });
    const aClick = vi.spyOn(window.HTMLAnchorElement.prototype, "click");
    await mod.act(async () => { btn("この端末の記録を書き出す").click(); });
    for (let i = 0; i < 20 || (btn("この端末の記録を書き出す").disabled && i < 600); i++) await mod.act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(calls.log.map((c) => c[0])).toEqual(["writeFile", "share", "deleteFile"]);
    const d = new Date();
    const name = `ficus-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`;
    expect(calls.log[1][1]).toEqual({ title: name, url: `file:///cache/${name}`, dialogTitle: "書き出し先を選ぶ" });
    expect(host.textContent).toContain(`計測2件を ${name} に書き出しました`);
    expect(aClick).not.toHaveBeenCalled();
    // 殻でも Web 版からの1行は置かない(手順1〜3が同じことを言っている)
    expect(host.textContent).not.toContain("Web 版");
  });
  it("共有に失敗したら BackupPanel と同じ文「書き出せませんでした。…」", async () => {
    mod = await load();
    host = document.createElement("div"); document.body.appendChild(host);
    root = mod.createRoot(host);
    await mod.act(async () => { root.render(mod.React.createElement(mod.Panel)); });
    calls.shareImpl = () => { throw new Error("Error sharing item"); };
    await mod.act(async () => { btn("この端末の記録を書き出す").click(); });
    for (let i = 0; i < 20 || (btn("この端末の記録を書き出す").disabled && i < 600); i++) await mod.act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(host.textContent).toContain("書き出せませんでした。端末の設定で保存領域が使えない可能性があります");
  });
});
