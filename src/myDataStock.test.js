import { describe, it, expect } from "vitest";
import { myDataStockSessions } from "./App.jsx";

// ------------------------------------------------------------------
// 【便AW 2026-09-24 本人指示】
// 「mydata タブの上の累計は、楽器ごとではなく全楽器、全期間の累計を表示。
//  つまり下の折れ線グラフで選択される楽器種別や期間の影響を受けない」
// 累計の母集団は **奏者=自分 の計測すべて**。楽器種別でも日付でも絞らない。
// ------------------------------------------------------------------
const S = (id, performer, saxType, recordedAt = "2026-09-01T10:00:00Z") => ({ id, performer, saxType, recordedAt });

describe("myDataStockSessions ── 累計の母集団", () => {
  const sessions = [
    S("a1", "自分", "alto"),
    S("t1", "自分", "tenor"),
    S("s1", "自分", "soprano", "2019-01-01T10:00:00Z"),   // 何年も前でも数える
    S("x1", "先生", "alto"),                                // 他の奏者は数えない
    S("u1", "自分", undefined),                             // 楽器が書かれていない古い記録も数える
  ];

  it("自分の計測はすべての楽器・すべての期間を数え、他の奏者の計測は数えない", () => {
    expect(myDataStockSessions(sessions).map((s) => s.id)).toEqual(["a1", "t1", "s1", "u1"]);
  });

  it("空・壊れた入力では空", () => {
    expect(myDataStockSessions(undefined)).toEqual([]);
    expect(myDataStockSessions([])).toEqual([]);
  });
});
