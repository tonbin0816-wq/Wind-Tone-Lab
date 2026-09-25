import { describe, it, expect } from "vitest";
import { commonNoteKeys, medianOf, alignOffset, alignProfile, copyProfile, cohortAverage, cohortOrder, cohortNoteCount, cohortPlainProfile, alignIdealToMine, MIN_COMMON_NOTES, MIN_COHORT } from "./align.js";

// notes[semitoneIndex] の最小形。実際のプロファイルはもっと持つが、
// 平行移動が見るのはここに書いた4つだけ。
const note = (c, h, p = 0, harm = [1, 0.5, 0.25]) =>
  ({ spectralCentroidHz: c, hnrDb: h, pitchCentsSigned: p, harmonics: harm });

const mine = { notes: { 0: note(1200, 10), 2: note(1600, 12), 4: note(2000, 14), 5: note(2400, 15) } };
const theirs = { notes: { 0: note(1800, 16), 2: note(2100, 17), 4: note(2600, 20), 7: note(3000, 22) } };

describe("commonNoteKeys", () => {
  it("両方に在る音だけを返す", () => {
    expect(commonNoteKeys(mine, theirs, "spectralCentroidHz")).toEqual(["0", "2", "4"]);
  });
  it("値が数値でない音は共通に数えない", () => {
    const a = { notes: { 0: note(1200, 10), 2: { spectralCentroidHz: null, hnrDb: 5 } } };
    const b = { notes: { 0: note(1800, 16), 2: note(2100, 17) } };
    expect(commonNoteKeys(a, b, "spectralCentroidHz")).toEqual(["0"]);
  });
  it("notes が無くても落ちない", () => {
    expect(commonNoteKeys(null, theirs, "spectralCentroidHz")).toEqual([]);
    expect(commonNoteKeys({}, {}, "spectralCentroidHz")).toEqual([]);
  });
});

describe("medianOf", () => {
  it("奇数個は真ん中", () => { expect(medianOf([3, 1, 2])).toBe(2); });
  it("偶数個は中央2つの平均", () => { expect(medianOf([1, 2, 3, 4])).toBe(2.5); });
  it("空なら null", () => { expect(medianOf([])).toBeNull(); });
});

describe("alignOffset", () => {
  it("共通音の中央値の差を返す", () => {
    // 共通は 0,2,4。自分 [1200,1600,2000] 中央値1600 / 相手 [1800,2100,2600] 中央値2100
    expect(alignOffset(mine, theirs, "spectralCentroidHz")).toBe(-500);
  });
  it("外れ値1つに引きずられない(平均ではなく中央値である証拠)", () => {
    const wild = { notes: { 0: note(1800, 16), 2: note(2100, 17), 4: note(9000, 20) } };
    // 相手の中央値は 2100(平均なら 4300 になり、オフセットが1000以上ずれる)
    expect(alignOffset(mine, wild, "spectralCentroidHz")).toBe(-500);
  });
  it("共通音が3未満なら null", () => {
    const few = { notes: { 0: note(1800, 16), 2: note(2100, 17) } };
    expect(alignOffset(mine, few, "spectralCentroidHz")).toBeNull();
  });
});

describe("alignProfile", () => {
  it("重心とHNRは平行移動し、ピッチと倍音構成はそのまま写す", () => {
    const r = alignProfile(mine, theirs);
    expect(r.notes["0"].spectralCentroidHz).toBe(1300);
    expect(r.notes["4"].spectralCentroidHz).toBe(2100);
    // HNR: 自分中央値 12 / 相手中央値 17 → オフセット -5
    expect(r.notes["0"].hnrDb).toBe(11);
    expect(r.notes["0"].pitchCentsSigned).toBe(0);
    expect(r.notes["0"].harmonics).toEqual([1, 0.5, 0.25]);
    expect(r.shiftedBy.spectralCentroidHz).toBe(-500);
    expect(r.shiftedBy.hnrDb).toBe(-5);
  });
  it("相手にしか無い音も、同じオフセットを当てて残す", () => {
    expect(alignProfile(mine, theirs).notes["7"].spectralCentroidHz).toBe(2500);
  });
  it("音量は結果に含めない", () => {
    // 【この1件が「音量を共有しない」を守っている】写す指標の一覧に入れないこと自体が実装。
    const withVol = { notes: { 0: { ...note(1800, 16), volumeDb: -12 }, 2: note(2100, 17), 4: note(2600, 20) } };
    const r = alignProfile(mine, withVol);
    expect(r.notes["0"].volumeDb).toBeUndefined();
    expect(Object.keys(r.notes["0"])).not.toContain("volumeDb");
  });
  // 【便BA 2026-09-25 本人指示】合わせられないときは文言ではなく null を返す(画面は相手の線だけを出す)。
  // 文言「重なっている音が 3 音に足りません」「自分の計測がまだありません」は読み手を失って定義ごと消えた。
  it("共通音が足りなければ null(文言は返さない)", () => {
    const few = { notes: { 0: note(1800, 16), 2: note(2100, 17) } };
    expect(alignProfile(mine, few)).toBeNull();
  });
  it("自分にデータが無ければ null", () => {
    expect(alignProfile({ notes: {} }, theirs)).toBeNull();
    expect(alignProfile(null, theirs)).toBeNull();
  });
});

describe("copyProfile(揃えない写し。便BA)", () => {
  it("重心・HNR・音程・倍音構成を値のまま写し、音量は写さない。移動量は null", () => {
    const withVol = { notes: { 0: { ...note(1800, 16, 3), volumeDb: -12 }, 7: note(3000, 22) } };
    const r = copyProfile(withVol);
    expect(r.shiftedBy).toBeNull();
    expect(r.notes["0"]).toEqual({ spectralCentroidHz: 1800, hnrDb: 16, pitchCentsSigned: 3, harmonics: [1, 0.5, 0.25] });
    expect(r.notes["7"].spectralCentroidHz).toBe(3000);
    expect(Object.keys(r.notes["0"])).not.toContain("volumeDb");
  });
});

// ------------------------------------------------------------------
// 【便BA 2026-09-25 本人指示・統括の決定】みんなの平均は**自分の計測に関係なく**、他の人どうしで揃えてから出す。
//   基準 = いちばん多くの音を持っている人(同数なら録音回数、さらに同数なら ownerUid の辞書順)
//   残りを音の多い順に、その時点までの平均へ揃えて足す。共通音 3 音未満の人は入れない。
//   音程は揃えずに平均。入った人数が 3 人未満なら「あと○人…」。
// 期待値は上の決まりを手で当てはめて書く(実装の式から逆算しない)。
// ------------------------------------------------------------------
describe("cohortAverage(他の人どうしで揃える。便BA)", () => {
  const P = (uid, notes, sourceSessionCount = 1) => ({ ownerUid: uid, sourceSessionCount, notes });
  // a は4音(基準)。b・c は3音で a と 0/2/4 が重なる。
  const a = P("a", { 0: note(1000, 10, 2), 2: note(1400, 12, 4), 4: note(1800, 14, 6), 5: note(2000, 15, 8) }, 5);
  const b = P("b", { 0: note(1600, 20, 0), 2: note(2000, 22, 0), 4: note(2400, 24, 0) }, 3);  // a より +600 / +10
  const c = P("c", { 0: note(700, 5, -2), 2: note(1100, 7, -4), 4: note(1500, 9, -6) }, 2);   // a より -300 / -5

  it("自分の計測を受け取らない(引数は他の人だけ)。平均は基準(いちばん音の多い a)の高さに揃う", () => {
    expect(cohortAverage.length).toBe(1);
    const r = cohortAverage([b, c, a]);
    expect(r.error).toBeUndefined();
    expect(r.count).toBe(3);
    expect(r.baseUid).toBe("a");
    // b・c は a の高さへ揃えて足されるので、音0の重心はどれも 1000 → 平均 1000
    expect(r.notes["0"].spectralCentroidHz.value).toBeCloseTo(1000, 6);
    expect(r.notes["0"].hnrDb.value).toBeCloseTo(10, 6);
    expect(r.notes["0"].spectralCentroidHz.n).toBe(3);
    // 基準だけが持つ音5はそのまま(n = 1)
    expect(r.notes["5"].spectralCentroidHz.value).toBe(2000);
    expect(r.notes["5"].spectralCentroidHz.n).toBe(1);
  });
  it("音程は揃えずに平均する(環境非依存)", () => {
    const r = cohortAverage([a, b, c]);
    expect(r.notes["0"].pitchCentsSigned.value).toBeCloseTo((2 + 0 - 2) / 3, 6);
    expect(r.notes["2"].pitchCentsSigned.value).toBeCloseTo((4 + 0 - 4) / 3, 6);
  });
  it("入力の順に依らない(基準の選び方と足す順番が決定的)", () => {
    const orders = [[a, b, c], [c, b, a], [b, a, c], [c, a, b]];
    const vals = orders.map((o) => JSON.stringify(cohortAverage(o)));
    expect(new Set(vals).size).toBe(1);
  });
  it("基準の選び方: 音の数 → 録音回数 → ownerUid の辞書順", () => {
    const x = P("x", { 0: note(1, 1), 1: note(1, 1), 2: note(1, 1) }, 1);
    const y = P("y", { 0: note(1, 1), 1: note(1, 1), 2: note(1, 1) }, 9);
    const z = P("z", { 0: note(1, 1), 1: note(1, 1), 2: note(1, 1), 3: note(1, 1) }, 0);
    expect(cohortOrder([x, y, z]).map((p) => p.ownerUid)).toEqual(["z", "y", "x"]);  // 音4 > 音3(録音9 > 1)
    const m = P("m", { 0: note(1, 1) }, 1);
    const k = P("k", { 0: note(1, 1) }, 1);
    expect(cohortOrder([m, k]).map((p) => p.ownerUid)).toEqual(["k", "m"]);            // 全部同じなら uid の辞書順
    expect(cohortNoteCount(z)).toBe(4);
  });
  it("足すのは「その時点までの平均」へ(基準だけに揃えるのではない)", () => {
    // B(6音)が基準。X は B と 0/1/2 が重なって入り、音 10/11 を足す。
    // D は B とは音0 しか重ならない(基準だけに揃えるなら入れない)が、
    // その時点までの平均(B + X)とは 0/10/11 の3音が重なる → 入る。
    const B = P("B", { 0: note(1000, 10), 1: note(1100, 11), 2: note(1200, 12), 3: note(1300, 13), 4: note(1400, 14), 5: note(1500, 15) }, 1);
    const X = P("X", { 0: note(2000, 20), 1: note(2100, 21), 2: note(2200, 22), 10: note(3000, 30), 11: note(3100, 31) }, 1);
    const D = P("D", { 0: note(500, 5), 10: note(1500, 15), 11: note(1600, 16) }, 1);
    const r = cohortAverage([D, X, B]);
    expect(r.baseUid).toBe("B");
    expect(r.count).toBe(3);
    // X は -1000 / -10 で B に揃う(音10 → 2000)。D は平均(音0=1000, 10=2000, 11=2100)と中央値 2000 vs 1500 → +500
    expect(r.notes["10"].spectralCentroidHz.value).toBeCloseTo(2000, 6);
    expect(r.notes["0"].spectralCentroidHz.value).toBeCloseTo(1000, 6);
  });
  it("揃えられない人(その時点までの平均と共通音 3 音未満)は平均に入れない", () => {
    const few = P("few", { 0: note(9999, 99), 2: note(9999, 99) }, 1);
    const r = cohortAverage([a, b, c, few]);
    expect(r.count).toBe(3);
    expect(r.notes["0"].spectralCentroidHz.value).toBeCloseTo(1000, 6);
  });
  it("公開している人が 3 人未満なら「あと○人」(○は足りない人数)", () => {
    expect(MIN_COHORT).toBe(3);
    expect(cohortAverage([a, b]).error).toBe("あと1人のデータが必要です\nみなさまのデータをお待ちしています");
    expect(cohortAverage([a]).error).toBe("あと2人のデータが必要です\nみなさまのデータをお待ちしています");
    expect(cohortAverage([]).error).toBe("あと3人のデータが必要です\nみなさまのデータをお待ちしています");
    expect(cohortAverage(null).error).toBeTruthy();
    expect(cohortAverage([a, b]).notes).toBeUndefined();
  });
  // 【便BA 再審査 2026-09-25 統括の裁定】公開している人は 3 人以上いるのに、同じ音で揃えられて平均に入った人が
  // 3 人未満 → 「あと○人」を出さない(もう 3 人いるのに増やせと読める)。
  it("公開している人は 3 人以上・平均に入れた人が 3 人未満 → 「同じ音を計測している人が、まだ足りません」", () => {
    const few = P("few", { 0: note(9999, 99) }, 1); // a・b と共通の音が 1 つ → 揃えられず入らない
    const r = cohortAverage([a, b, few]);
    expect(r.error.split("\n")).toEqual(["同じ音を計測している人が、まだ足りません", "みなさまのデータをお待ちしています"]);
    expect(r.error).not.toContain("あと");
    expect(r.notes).toBeUndefined();
    // 入らない人が 2 人いても同じ(2 人しか入らない)
    const few2 = P("few2", { 9: note(1, 1) }, 1);
    expect(cohortAverage([a, b, few, few2]).error).toBe("同じ音を計測している人が、まだ足りません\nみなさまのデータをお待ちしています");
    // 3 人入れば文は出ない(平均が出る)
    expect(cohortAverage([a, b, c, few]).error).toBeUndefined();
  });
  it("文言「重なっている音が…」「自分の計測が…」はもう出ない", () => {
    for (const r of [cohortAverage([a]), cohortAverage([]), cohortAverage([a, P("f", { 0: note(1, 1) })])]) {
      expect(r.error).not.toContain("重なっている音");
      expect(r.error).not.toContain("自分の計測");
    }
  });
  // 【C2 2026-09-16 実機の指摘】2行の文言は改行で分ける。句点と「...」は持たない。
  it("2行の文言は改行1つで分かれ、句点・「...」を持たない(C2)", () => {
    const c2 = cohortAverage([]).error;
    expect(c2.split("\n")).toEqual(["あと3人のデータが必要です", "みなさまのデータをお待ちしています"]);
    expect(c2).not.toMatch(/[。…]/);
    expect(c2).not.toContain("...");
  });
  it("音量は平均にも現れない", () => {
    const withVol = (o) => ({ ...o, notes: Object.fromEntries(Object.entries(o.notes).map(([k, v]) => [k, { ...v, volumeDb: -12 }])) });
    const r = cohortAverage([withVol(a), withVol(b), withVol(c)]);
    expect(Object.keys(r.notes["0"])).not.toContain("volumeDb");
  });
  it("平均の素の形(cohortPlainProfile)を自分へ揃えられる(平均の側を動かす)", () => {
    const avg = cohortAverage([a, b, c]);
    const plain = cohortPlainProfile(avg);
    expect(plain.notes["0"].spectralCentroidHz).toBeCloseTo(1000, 6);
    // 自分は a より +200 の高さ。平均を自分へ揃えると音0 は 1200 になる(自分の値は動かない)
    const me = { notes: { 0: note(1200, 11), 2: note(1600, 13), 4: note(2000, 15) } };
    const r = alignProfile(me, plain);
    expect(r.shiftedBy.spectralCentroidHz).toBeCloseTo(200, 6);
    expect(r.notes["0"].spectralCentroidHz).toBeCloseTo(1200, 6);
    expect(me.notes["0"].spectralCentroidHz).toBe(1200);
  });
});

// ------------------------------------------------------------------
// 端末の中の平行移動(目安を自分の平均へ揃える)
// ------------------------------------------------------------------
describe("alignIdealToMine", () => {
  const p = (notes) => ({ id: "x", name: "目安", notes });
  // 共通音は3音以上ないと基準が立たない(MIN_COMMON_NOTES)
  const mine = p({
    60: { centroidHz: 1200, hnrDb: 20, volumeDb: -18, pitchCentsSigned: 3 },
    62: { centroidHz: 1300, hnrDb: 21, volumeDb: -17, pitchCentsSigned: -2 },
    64: { centroidHz: 1400, hnrDb: 22, volumeDb: -16, pitchCentsSigned: 1 },
  });

  it("目安が無ければ null(平行移動が値を作り出さない)", () => {
    expect(alignIdealToMine(null, mine)).toBeNull();
  });

  it("重心・HNR・音量を、共通音の中央値の差だけ動かす", () => {
    const ideal = p({
      60: { centroidHz: 1000, hnrDb: 15, volumeDb: -28 },
      62: { centroidHz: 1100, hnrDb: 16, volumeDb: -27 },
      64: { centroidHz: 1150, hnrDb: 18, volumeDb: -26 },
    });
    const out = alignIdealToMine(ideal, mine);
    // 中央値: 自分 1300 / 目安 1100 → +200
    expect(out.notes[60].centroidHz).toBe(1200);
    expect(out.notes[64].centroidHz).toBe(1350); // 形は保たれる(1150 → 1350)
    // 中央値: 自分 21 / 目安 16 → +5
    expect(out.notes[64].hnrDb).toBe(23);
    // 中央値: 自分 -17 / 目安 -27 → +10。**音量も動かす**(端末内の比較なので)
    expect(out.notes[60].volumeDb).toBe(-18);
    expect(out.alignedTo).toEqual({ centroidHz: 200, hnrDb: 5, volumeDb: 10 });
  });

  it("ピッチと倍音構成は動かさない(環境非依存 / 音の中での比率)", () => {
    const ideal = p({
      60: { centroidHz: 1000, pitchCentsSigned: -9, harmonicsProfile: [{ n: 1, norm: 1 }] },
      62: { centroidHz: 1100, pitchCentsSigned: 4 },
      64: { centroidHz: 1150, pitchCentsSigned: 0 },
    });
    const out = alignIdealToMine(ideal, mine);
    expect(out.notes[60].pitchCentsSigned).toBe(-9);
    expect(out.notes[60].harmonicsProfile).toEqual([{ n: 1, norm: 1 }]);
  });

  it("共通音が足りないときはエラーにせず、そのまま返す", () => {
    // 端末内の目安は自分の録音か取り込み時に揃え済みなので、絶対値の比較が壊れていない。
    const ideal = p({ 60: { centroidHz: 1000 }, 62: { centroidHz: 1100 } });
    const out = alignIdealToMine(ideal, mine);
    expect(out).toBe(ideal);
  });

  it("自分の平均がまだ無いときもそのまま返す", () => {
    const ideal = p({ 60: { centroidHz: 1000 }, 62: { centroidHz: 1100 }, 64: { centroidHz: 1150 } });
    expect(alignIdealToMine(ideal, null)).toBe(ideal);
  });

  it("音量だけ持つ目安は音量だけが動く(取り込んだ目安のように欠けた指標があっても落ちない)", () => {
    const ideal = p({
      60: { volumeDb: -28 }, 62: { volumeDb: -27 }, 64: { volumeDb: -26 },
    });
    const out = alignIdealToMine(ideal, mine);
    expect(out.alignedTo).toEqual({ volumeDb: 10 });
    expect(out.notes[62].volumeDb).toBe(-17);
  });
});
