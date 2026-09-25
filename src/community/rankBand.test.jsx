// @vitest-environment jsdom
import React, { act } from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { RankScreen } from "./screens.jsx";

// ------------------------------------------------------------------
// 【便BC 2026-09-25 本人選定 モック「い. 帯を太くして順位を入れる」】順位の1〜3位。
// 順位の画面を**実際に描いて**見る(jsdom)。
//   ・上位3件は左端の帯が 44px で、順位の数字は**帯の中**(白 = --c-on-accent)。帯の外に数字の列は無い
//   ・数字の大きさは今までと同じ(1位 --fs-2xl、2・3位 --fs-xl)
//   ・1位の帯は光(rank-shine-bar)のまま、2・3位は順位の色の塗り
//   ・4位以下の行は今までどおり(帯を持たず、数字は --c-ink-3 の列)
// 【守っていないもの】帯の中で数字が真ん中に見えるか(配置)。ブラウザで目で見た(報告)。
// 白と帯の色の比・大きい文字に当たることは rankcolor.test.js がトークンから計算している。
// ------------------------------------------------------------------
let root; let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const NOW = new Date().toISOString();
// 練習日数は順位の数字と紛れない値にする(1〜4 を使わない)
const DAYS = { a: 40, b: 30, c: 20, d: 10 };
const USERS = Object.entries(DAYS).map(([uid, d], i) => ({
  uid, nickname: `ひと${uid}`, icon: "ic-cat", iconColor: i + 1, saxTypes: ["alto"], genres: [], position: "学生",
  stats: { daysAll: d, daysThisYear: d, daysThisMonth: 0, daysThisWeek: 0, secAll: d * 60, computedAt: NOW },
}));

const rowOf = (name) => host.querySelector(`[aria-label="${name} の詳細を見る"]`);
// 行の中で、自分の字(子要素を除く)が ちょうど s の要素
const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
const elementsSaying = (root, s) => [...root.querySelectorAll("*")].filter((e) => ownText(e) === s);

describe("順位の1〜3位: 数字は 44px の帯の中(便BC)", () => {
  it("上位3件は帯の中に順位の数字(白)。帯の外に同じ数字の要素は無い", async () => {
    await act(async () => { root.render(<RankScreen users={USERS} myUid="zz" onOpenPerson={() => {}} />); });
    for (const [uid, rank] of [["a", 1], ["b", 2], ["c", 3]]) {
      const row = rowOf(`ひと${uid}`);
      expect(row, `ひと${uid} の行`).toBeTruthy();
      const band = row.querySelector("[data-rank-band]");
      expect(band, `${rank}位の帯`).toBeTruthy();
      expect(band.textContent).toBe(String(rank));
      expect(band.style.flex).toBe("0 0 44px");
      expect(band.style.color).toBe("var(--c-on-accent)");
      expect(band.style.fontSize).toBe(rank === 1 ? "var(--fs-2xl)" : "var(--fs-xl)");
      // 帯は行の左端(最初の子)
      expect(row.firstElementChild).toBe(band);
      // 帯の外に順位の数字だけを持つ要素は無い(以前の 34px の数字の列が消えた)
      expect(elementsSaying(row, String(rank))).toEqual([band]);
    }
  });

  it("1位の帯は光(rank-shine-bar)で、塗りを直に書かない。2・3位は順位の色の塗り", async () => {
    await act(async () => { root.render(<RankScreen users={USERS} myUid="zz" onOpenPerson={() => {}} />); });
    const b1 = rowOf("ひとa").querySelector("[data-rank-band]");
    expect(b1.className).toBe("rank-shine-bar");
    expect(b1.style.background).toBe("");
    expect(b1.style.backgroundColor).toBe("");
    expect(rowOf("ひとb").querySelector("[data-rank-band]").style.background).toBe("var(--c-rank-2)");
    expect(rowOf("ひとc").querySelector("[data-rank-band]").style.background).toBe("var(--c-rank-3)");
  });

  it("4位以下の行は今までどおり: 帯を持たず、数字は --c-ink-3 の列", async () => {
    await act(async () => { root.render(<RankScreen users={USERS} myUid="zz" onOpenPerson={() => {}} />); });
    const row = rowOf("ひとd");
    expect(row.querySelector("[data-rank-band]")).toBe(null);
    const num = elementsSaying(row, "4");
    expect(num).toHaveLength(1);
    expect(num[0].style.color).toBe("var(--c-ink-3)");
    expect(num[0].style.fontSize).toBe("var(--fs-sm)");
  });
});
