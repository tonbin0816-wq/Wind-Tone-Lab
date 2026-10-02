// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";

// ------------------------------------------------------------------
// 【便BK 2026-10-02 本人の実機報告】「My Data タブにいるときに、もう一度 My Data タブのアイコンをタップすると、
// 目安くらいの位置に動く。この挙動を削除」。
// アプリ全体(WindToneLabPhaseMode)を描き、下部ナビの「データ」を押し直して確かめる。
//   ・My Data の一覧を出しているとき … 何も起きない。画面は**作り直されない**(同じ DOM のまま)、
//     中で選んでいた指標タブもそのまま、子タブは My Data のまま、スクロールの位置にも触らない
//   ・分析を出しているとき          … 今までどおり作り直して My Data の一覧へ戻る
//   ・すべての計測を出しているとき  … 今までどおり My Data の一覧へ戻る
//   ・セッション詳細を出しているとき … 今までどおり作り直して My Data の一覧へ戻る(My Data の日付から開いた詳細)
//   ・リードタブの押し直し          … 今までどおり作り直す(データタブだけの例外であること)
// 期待値はここに手で書いた(画面の定数から読まない)。
// 【守っていないもの】スクロール位置が**ブラウザの配置で**動かないこと。実機で動いたのは、作り直しの途中で
// 文書が一瞬短くなり、ブラウザがスクロール位置を詰めたため(jsdom は配置を計算しないので起きない)。
// ここでは原因の側 ── 作り直さないこと(同じ DOM のまま)と、スクロールを動かす呼び出しが1つも無いこと ── を見る。
// 375×812 の Chrome(スクロールアンカーを切って Safari に寄せた)での前後の実測は報告に書いた。
// 【便BK 審査の差し戻し 2026-10-02】ページャはリードタブにもある。track を「最初に見つかった物」で取っていたので、
// データタブへ移れなかったときにリードのページャ(0%)を読んで緑のままだった(印の後始末を消す変異が生き残った)。
// track は**データタブの子タブ行と同じ画面の**ページャに絞り、データへ移ったことは子タブの綴りで確かめる。
// ------------------------------------------------------------------
const { default: App, openIdb } = await import("./App.jsx");
import { createFakeIndexedDb } from "./backup/fakeIndexedDb.testutil.js";

let root; let host; let scrollCalls; let savedScrollIntoView;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  scrollCalls = [];
  window.scrollTo = (...a) => { scrollCalls.push(["scrollTo", ...a]); };
  window.scrollBy = (...a) => { scrollCalls.push(["scrollBy", ...a]); };
  savedScrollIntoView = window.Element.prototype.scrollIntoView;
  window.Element.prototype.scrollIntoView = function () { scrollCalls.push(["scrollIntoView"]); };
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (!window.SVGElement.prototype.getComputedTextLength) {
    window.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || "").length * 7; };
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  window.Element.prototype.scrollIntoView = savedScrollIntoView;
});

const nav = (label) => {
  const b = document.querySelector(`button[aria-label="${label}"]`);
  expect(b, label).toBeTruthy();
  return b;
};
const click = async (el) => { await act(async () => { el.click(); }); };
// 子タブ(素のテキストのボタン)。見つからなければ null。
const subTab = (label) => [...host.querySelectorAll("button")].find((b) => b.textContent === label) ?? null;
// **データタブの**ページャの track。My Data が表なら translateX(calc(0% …)、分析なら -100%。
// 子タブ「My Data」から祖先へ上り、最初にページャの track を含む祖先の中の track を返す(リードのページャは拾わない)。
// データタブが出ていなければ null。
const isTrack = (d) => (d.style.transform || "").startsWith("translateX(calc(");
const track = () => {
  const b = subTab("My Data");
  for (let el = b?.parentElement ?? null; el && el !== host.parentElement; el = el.parentElement) {
    const t = [...el.querySelectorAll("div")].find(isTrack);
    if (t) return t;
  }
  return null;
};
const onMyData = () => {
  const t = track();
  return !!t && t.style.transform.startsWith("translateX(calc(0%");
};
// My Data の指標タブ(音程 / HNR / 重心 / 音量)。押されているものは aria-pressed="true"。
const metricTabs = () => [...host.querySelectorAll("[data-term-tab]")];
const metricTab = (label) => metricTabs().find((t) => t.textContent.replace("?", "").trim() === label);
const pressedMetric = () => metricTabs().find((t) => t.getAttribute("aria-pressed") === "true")?.textContent.replace("?", "").trim();

async function openData() {
  await act(async () => { root.render(<App />); });
  await click(nav("データ"));
  expect(subTab("My Data"), "データタブの子タブが出ている").toBeTruthy();
  expect(onMyData()).toBe(true);
}

describe("データタブの押し直し(便BK 本人の実機報告)", () => {
  it("My Data の一覧で押し直しても何も動かない: 作り直さない・指標タブの選択も子タブもそのまま・スクロールに触らない", async () => {
    await openData();
    // 既定(音程)から外しておく。作り直されると音程へ戻る。
    await click(metricTab("音量"));
    expect(pressedMetric()).toBe("音量");
    const before = { subTabNode: subTab("My Data"), trackNode: track(), transform: track().style.transform };
    scrollCalls = [];

    await click(nav("データ"));
    await click(nav("データ"));   // 2回続けても同じ

    expect(subTab("My Data")).toBe(before.subTabNode);           // 同じ DOM(作り直していない)
    expect(before.subTabNode.isConnected).toBe(true);
    expect(track()).toBe(before.trackNode);
    expect(track().style.transform).toBe(before.transform);      // 子タブは My Data のまま
    expect(onMyData()).toBe(true);
    expect(pressedMetric()).toBe("音量");                         // 中の選択も残っている
    expect(scrollCalls).toEqual([]);                             // スクロールを動かす呼び出しが無い
  });

  it("分析を出しているときに押し直すと、今までどおり作り直して My Data の一覧へ戻る", async () => {
    await openData();
    await click(subTab("分析"));
    expect(onMyData()).toBe(false);
    expect(track().style.transform.startsWith("translateX(calc(-100%")).toBe(true);
    const oldNode = subTab("My Data");

    await click(nav("データ"));

    expect(onMyData()).toBe(true);
    expect(oldNode.isConnected).toBe(false);                     // 作り直した(以前と同じ動き)
    expect(pressedMetric()).toBe("音程");                         // 指標タブも既定へ戻る
    // 戻った先の My Data でもう一度押すと、今度は何も起きない
    const node = subTab("My Data");
    await click(nav("データ"));
    expect(subTab("My Data")).toBe(node);
  });

  it("すべての計測を出しているときに押し直すと、今までどおり My Data の一覧へ戻る", async () => {
    await openData();
    const entry = [...host.querySelectorAll("button")].find((b) => b.textContent.startsWith("すべての計測"));
    expect(entry, "すべての計測の入口").toBeTruthy();
    await click(entry);
    expect(subTab("My Data"), "全件一覧では子タブは出ない").toBe(null);

    await click(nav("データ"));

    expect(subTab("My Data")).toBeTruthy();
    expect(onMyData()).toBe(true);
  });

  it("データ以外は今までどおり: リードタブを押し直すと作り直す / データからリードへ移るのも今までどおり", async () => {
    await openData();
    await click(nav("リード"));
    const reedNode = subTab("登録");
    expect(reedNode, "リードタブの子タブ「登録」").toBeTruthy();
    await click(nav("リード"));
    expect(reedNode.isConnected).toBe(false);                    // 作り直した(以前と同じ動き)
    expect(subTab("登録")).toBeTruthy();
    // データへ戻ると My Data の一覧(新しく描かれる)。そこでの押し直しは何もしない
    await click(nav("データ"));
    const node = subTab("My Data");
    expect(node, "データタブへ移れた(子タブ My Data がある)").toBeTruthy();
    expect(subTab("登録"), "リードタブはもう出ていない").toBe(null);
    expect(onMyData()).toBe(true);
    await click(nav("データ"));
    expect(subTab("My Data")).toBe(node);
    expect(subTab("登録")).toBe(null);
  });

  // 【便BK 審査の差し戻し 2026-10-02】セッション詳細(My Data の日付から開く)での押し直しは、今までどおり
  // 作り直して My Data の一覧へ戻る。全件一覧を通らずに開くので、印の条件から「詳細なし」を外すとここで落ちる。
  // 計測1件は作り物の IndexedDB に仕込む(本物の読み込み useSessionsStore → openIdb を通す)。
  it("セッション詳細を出しているときに押し直すと、今までどおり My Data の一覧へ戻る", async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "indexedDB", { value: createFakeIndexedDb(), configurable: true, writable: true });
    try {
      const db = await openIdb();
      const now = new Date();
      await new Promise((res, rej) => {
        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").put({
          id: "bk3_s1", recordedAt: now.toISOString(), saxType: "alto", reedId: null, linkedAt: null,
          memo: null, performer: "自分", source: "live", frames: [], barlines: [], noteEvents: [],
        });
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      await openData();
      // 読み込みが済んで、今日の日付が押せるようになるまで待つ
      let day = null;
      for (let k = 0; k < 100 && !day; k += 1) {
        await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
        day = host.querySelector(`button[data-calendar-day][aria-label^="${now.getDate()}日 計測1件"]`);
      }
      expect(day, "今日の日付(計測1件)").toBeTruthy();
      await click(day);
      const row = [...host.querySelectorAll(".day-panel button")][0];
      expect(row, "その日のセッションの行").toBeTruthy();
      await click(row);
      expect(subTab("My Data"), "セッション詳細では子タブは出ない").toBe(null);

      await click(nav("データ"));

      expect(subTab("My Data"), "My Data の一覧へ戻った").toBeTruthy();
      expect(onMyData()).toBe(true);
      // 戻った先の一覧での押し直しは何もしない
      const node = subTab("My Data");
      await click(nav("データ"));
      expect(subTab("My Data")).toBe(node);
    } finally {
      if (saved) Object.defineProperty(globalThis, "indexedDB", saved);
      else delete globalThis.indexedDB;
    }
  });
});
