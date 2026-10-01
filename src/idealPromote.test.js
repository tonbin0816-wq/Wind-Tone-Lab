import { describe, it, expect } from "vitest";
import { promoteIdealProfiles, isAdoptedIdealProfile } from "./App.jsx";
import { idealForUse } from "./community/align.js";
import { buildAdoptedProfile } from "./community/idealDoc.js";

// ------------------------------------------------------------------
// 【便BF 2026-10-01 統括指示】「目安に設定」の同じ名前の扱い。
// 以前は名前だけで合体先を探したので、取り込んだ目安と同じ名前で作ると合体し、sourceKind が
// "session" に化けて idealForUse の「揃えずに取り込んだ目安から重心・HNR を外す」から漏れた。
// 決まり:
//   ・取り込んだ目安(sourceKind "community" / alignedAtAdopt を持つ)とは合体しない → 別の目安として足して選ぶ
//   ・自分の計測から作った目安どうしは今までどおり合体する(notes を積み上げ・由来も積む・その目安を選ぶ)
// 期待値は上の文から直接書く(実装の関数で期待値を作らない)。取り込んだ目安は本物の buildAdoptedProfile で作る。
// 【守っているもの】足す/積み上げるの判断と、その結果の一覧・選ぶ id。取り込んだ目安が1bit も変わらないこと。
// 【守っていないもの】promoteSessionToIdeal(コンポーネントの中)がこの関数を呼んでいること
//   ── 綴りは pitch-test の 便BF の節が見る。名前の入力欄など画面の側。
// ------------------------------------------------------------------

const theirNotes = { 14: { centroidHz: 1500, hnrDb: 18, pitchCentsSigned: 2 } };
// 揃えずに取り込んだ目安(共通の音が足りなかったとき。shiftedBy が無い → alignedAtAdopt: false)
const adopted = buildAdoptedProfile({
  aligned: { notes: theirNotes, shiftedBy: null },
  theirIdeal: { saxType: "alto" },
  nickname: "しろねこ",
  id: "adopted-1",
  now: new Date("2026-09-30T00:00:00Z"),
}).profile;
const NAME = "しろねこ さんの目安";
const mine = (id, notes, sessionIds) => ({ id, name: NAME, saxType: "alto", notes, sourceKind: "session", sourceSessionIds: sessionIds });
const myNotes = { 16: { centroidHz: 1200, hnrDb: 20, pitchCentsSigned: -1 } };

describe("promoteIdealProfiles ── 取り込んだ目安とは合体しない(便BF)", () => {
  it("前提: 作り物ではなく本物の取り込みの印を持っている(名前・sourceKind・alignedAtAdopt)", () => {
    expect(adopted.name).toBe(NAME);
    expect(adopted.sourceKind).toBe("community");
    expect(adopted.alignedAtAdopt).toBe(false);
  });

  it("取り込んだ目安と同じ名前で作ると、合体せずに別の目安として足して、それを選ぶ", () => {
    const fresh = mine("n1", myNotes, ["s1"]);
    const r = promoteIdealProfiles([adopted], fresh, NAME);
    expect(r.profiles).toHaveLength(2);
    expect(r.profiles[0]).toBe(adopted);                    // 取り込んだ目安は同じ実体のまま(1bit も変わらない)
    expect(r.profiles[0].sourceKind).toBe("community");
    expect(r.profiles[0].notes).toEqual({ 14: expect.any(Object) });
    expect(r.profiles[1]).toBe(fresh);
    expect(r.selectedId).toBe("n1");
  });

  it("合体しなかったので、取り込んだ目安を使うときは今までどおり重心・HNR が外れる", () => {
    const r = promoteIdealProfiles([adopted], mine("n1", myNotes, ["s1"]), NAME);
    const used = idealForUse(r.profiles[0], null);
    expect(used.excludedMetrics).toEqual(["centroidHz", "hnrDb"]);
    expect(used.notes[14]).not.toHaveProperty("centroidHz");
    expect(used.notes[14]).not.toHaveProperty("hnrDb");
  });

  it("自分の目安どうしは今までどおり合体する(notes を積み上げ・由来も積む・その目安を選ぶ)", () => {
    const own = mine("o1", { 14: { centroidHz: 1400, hnrDb: 17 } }, ["s0"]);
    const r = promoteIdealProfiles([own], mine("n1", myNotes, ["s1"]), NAME);
    expect(r.profiles).toHaveLength(1);
    expect(r.profiles[0].id).toBe("o1");
    expect(Object.keys(r.profiles[0].notes).sort()).toEqual(["14", "16"]);
    expect(r.profiles[0].sourceKind).toBe("session");
    expect(r.profiles[0].sourceSessionIds).toEqual(["s0", "s1"]);
    expect(r.selectedId).toBe("o1");
  });

  // 【便BF 審査の変異 M11 が生き残っていた】合体すると由来(sourceKind)は**新しく作った目安のもの**で上書きする
  // (以前からの振る舞い。上の検査は session どうしなので、上書きを消しても通っていた)。
  it("合体すると sourceKind は新しい目安のもので上書きする(performer → session / session → performer)", () => {
    const perf = { ...mine("o1", { 14: { centroidHz: 1400 } }, ["s0"]), sourceKind: "performer" };
    const toSession = promoteIdealProfiles([perf], mine("n1", myNotes, ["s1"]), NAME);
    expect(toSession.profiles).toHaveLength(1);
    expect(toSession.profiles[0].id).toBe("o1");
    expect(toSession.profiles[0].sourceKind).toBe("session");
    const own = mine("o2", { 14: { centroidHz: 1400 } }, ["s0"]);
    const toPerf = promoteIdealProfiles([own], { ...mine("n2", myNotes, ["s1", "s2"]), sourceKind: "performer" }, NAME);
    expect(toPerf.profiles[0].id).toBe("o2");
    expect(toPerf.profiles[0].sourceKind).toBe("performer");
  });

  it("取り込んだ目安と自分の目安が同じ名前で並んでいたら、自分の目安のほうへ積み上げる(取り込んだ目安は触らない)", () => {
    const own = mine("o1", { 18: { centroidHz: 1300 } }, ["s0"]);
    const r = promoteIdealProfiles([adopted, own], mine("n1", myNotes, ["s1"]), NAME);
    expect(r.profiles).toHaveLength(2);
    expect(r.profiles[0]).toBe(adopted);
    expect(r.profiles[1].id).toBe("o1");
    expect(Object.keys(r.profiles[1].notes).sort()).toEqual(["16", "18"]);
    expect(r.selectedId).toBe("o1");
  });

  it("別の目安として足したあと、同じ名前でもう1回作ると、足したほう(自分の目安)へ積み上がる", () => {
    const first = promoteIdealProfiles([adopted], mine("n1", myNotes, ["s1"]), NAME);
    const second = promoteIdealProfiles(first.profiles, mine("n2", { 20: { centroidHz: 1100 } }, ["s2"]), NAME);
    expect(second.profiles).toHaveLength(2);
    expect(second.profiles[0]).toBe(adopted);
    expect(second.profiles[1].id).toBe("n1");
    expect(Object.keys(second.profiles[1].notes).sort()).toEqual(["16", "20"]);
    expect(second.selectedId).toBe("n1");
  });

  it("印(alignedAtAdopt)の無い古い取り込みの目安とも合体しない(sourceKind が community)", () => {
    const old = { ...adopted };
    delete old.alignedAtAdopt;
    const r = promoteIdealProfiles([old], mine("n1", myNotes, ["s1"]), NAME);
    expect(r.profiles).toHaveLength(2);
    expect(r.profiles[0]).toBe(old);
  });

  it("この穴で既に合体して sourceKind が session に化けた目安にも、それ以上は積み上げない(alignedAtAdopt で見分ける)", () => {
    const leaked = { ...adopted, sourceKind: "session" };
    const r = promoteIdealProfiles([leaked], mine("n1", myNotes, ["s1"]), NAME);
    expect(r.profiles).toHaveLength(2);
    expect(r.profiles[0]).toBe(leaked);
  });

  it("名前が違えば、今までどおり別の目安として足す", () => {
    const own = { ...mine("o1", {}, []), name: "自分の目安" };
    const r = promoteIdealProfiles([own], mine("n1", myNotes, ["s1"]), NAME);
    expect(r.profiles).toHaveLength(2);
    expect(r.selectedId).toBe("n1");
  });
});

describe("isAdoptedIdealProfile ── 取り込んだ目安の見分け", () => {
  it("取り込みの印のどちらかがあれば取り込んだ目安", () => {
    expect(isAdoptedIdealProfile(adopted)).toBe(true);
    expect(isAdoptedIdealProfile({ sourceKind: "community" })).toBe(true);
    expect(isAdoptedIdealProfile({ sourceKind: "session", alignedAtAdopt: true })).toBe(true);
  });
  it("自分の計測から作った目安(session / performer / 印の無い古い形)は違う", () => {
    expect(isAdoptedIdealProfile({ sourceKind: "session" })).toBe(false);
    expect(isAdoptedIdealProfile({ sourceKind: "performer" })).toBe(false);
    expect(isAdoptedIdealProfile({ name: "x", notes: {} })).toBe(false);
    expect(isAdoptedIdealProfile(null)).toBe(false);
  });
});
