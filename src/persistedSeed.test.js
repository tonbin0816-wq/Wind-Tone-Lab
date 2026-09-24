import { describe, it, expect } from "vitest";
import { seedPersistedCache } from "./App.jsx";

// 【便AL 2026-09-24】まだ一度も保存されていない鍵の最初の変更が、黙って捨てられないように。
//
// フック(usePersistedState)は、キャッシュに鍵が在れば「読み込み済み」で始まる。
// 先読みが全部の鍵を読み切っていれば、無い鍵に初期値を仮に置いて「読み込み済み」にする。
// **フック全体の振る舞い(描画・IndexedDB)はこの環境では走らせられない**(jsdom も
// fake-indexeddb も入っていない)。判断はこの関数に出してあり、フックがこれを
// useState より前に呼ぶことは pitch-test の 83.5b が位置で見ている。
describe("seedPersistedCache ── まだ無い鍵を待たせない", () => {
  it("読み切っていて鍵が無ければ、初期値を仮に置く(= フックは読み込み済みで始まる)", () => {
    const cache = new Map();
    seedPersistedCache(cache, true, "showVolume", false);
    expect(cache.has("showVolume")).toBe(true);
    expect(cache.get("showVolume")).toBe(false);
  });

  // 保存されている値を初期値で隠さない。
  it("鍵が在れば触らない(保存されている値が勝つ)", () => {
    const cache = new Map([["tuningHz", 440]]);
    seedPersistedCache(cache, true, "tuningHz", 442);
    expect(cache.get("tuningHz")).toBe(440);
  });

  // null は正当な保存値(selectedReedId など)。「値が偽っぽい」で上書きしない。
  it("保存されている値が null でも上書きしない", () => {
    const cache = new Map([["selectedReedId", null]]);
    seedPersistedCache(cache, true, "selectedReedId", "r1");
    expect(cache.get("selectedReedId")).toBeNull();
  });

  it("初期値が null の鍵も置ける(有無は has で見る)", () => {
    const cache = new Map();
    seedPersistedCache(cache, true, "selectedReedId", null);
    expect(cache.has("selectedReedId")).toBe(true);
    expect(cache.get("selectedReedId")).toBeNull();
  });

  // 先読みが失敗・時間切れ = 無いかどうか分からない。決めつけると保存値を隠す。
  it("読み切っていなければ何もしない(従来どおり読み込みを待つ)", () => {
    const cache = new Map();
    seedPersistedCache(cache, false, "showVolume", false);
    expect(cache.has("showVolume")).toBe(false);
  });
});
