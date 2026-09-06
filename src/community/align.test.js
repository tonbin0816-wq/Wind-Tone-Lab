import { describe, it, expect } from "vitest";
import { commonNoteKeys, medianOf, alignOffset, alignProfile, cohortAverage, alignIdealToMine, MIN_COMMON_NOTES, MIN_COHORT } from "./align.js";

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
  it("共通音が足りなければエラーを返す", () => {
    const few = { notes: { 0: note(1800, 16), 2: note(2100, 17) } };
    expect(alignProfile(mine, few).error).toContain("重なっている音");
  });
  it("自分にデータが無ければエラーを返す", () => {
    expect(alignProfile({ notes: {} }, theirs).error).toContain("自分の計測");
  });
});

describe("cohortAverage", () => {
  // 自分に合わせたあとの値で平均されることを確かめる。
  const a = { notes: { 0: note(1800, 16), 2: note(2100, 17), 4: note(2600, 20) } }; // オフセット -500 / -5
  const b = { notes: { 0: note(1900, 17), 2: note(2200, 18), 4: note(2700, 21) } }; // 中央値2200/18 → -600 / -6
  const c = { notes: { 0: note(1700, 15), 2: note(2000, 16), 4: note(2500, 19) } }; // 中央値2000/16 → -400 / -4

  it("一人ずつ自分に合わせてから平均する", () => {
    const r = cohortAverage(mine, [a, b, c]);
    expect(r.error).toBeUndefined();
    expect(r.count).toBe(3);
    // a: 1800-500=1300 / b: 1900-600=1300 / c: 1700-400=1300 → 平均 1300
    expect(r.notes["0"].spectralCentroidHz.value).toBeCloseTo(1300, 6);
    expect(r.notes["0"].spectralCentroidHz.n).toBe(3);
  });
  it("先に平均してから合わせた場合と結果が違う(順序が意味を持つ証拠)", () => {
    // 【材料の選び方に注意】上の a/b/c はずれ量が -500/-600/-400 で平均がちょうど -500 になり、
    // 「先に平均 → 1つのオフセットで移動」でも同じ答えに着いてしまう。
    // それでは順序の意味を確かめたことにならないので、ここでは**環境が大きく違う人**を混ぜる。
    const far = { notes: { 0: note(3000, 30), 2: note(3300, 31), 4: note(3800, 34) } }; // 中央値3300 → -1700
    const r = cohortAverage(mine, [a, b, far]);
    // 一人ずつ合わせてから平均: (1800-500 + 1900-600 + 3000-1700)/3 = 1300
    expect(r.notes["0"].spectralCentroidHz.value).toBeCloseTo(1300, 6);
    // 先に平均してから1つのオフセットで動かすと別の値になる
    const naiveMean = (1800 + 1900 + 3000) / 3; // 2233.33...
    expect(naiveMean - 500).not.toBeCloseTo(1300, 6);
  });
  it("合わせられない人は平均に入れない", () => {
    // 共通音が2つしかない人。素通しで混ぜると環境のずれごと平均に入る。
    const few = { notes: { 0: note(9999, 99), 2: note(9999, 99) } };
    const r = cohortAverage(mine, [a, b, c, few]);
    expect(r.count).toBe(3);
    expect(r.notes["0"].spectralCentroidHz.value).toBeCloseTo(1300, 6);
  });
  it("音ごとに母数が違うことを n で返す", () => {
    // d は音4を持たない。音4の n だけ小さくなる。
    const d = { notes: { 0: note(1800, 16), 2: note(2100, 17), 5: note(2900, 22) } };
    const r = cohortAverage(mine, [a, b, c, d]);
    expect(r.count).toBe(4);
    expect(r.notes["0"].spectralCentroidHz.n).toBe(4);
    expect(r.notes["4"].spectralCentroidHz.n).toBe(3);
  });
  it("3人に足りなければ平均を出さない", () => {
    // 少数の平均は個人の特定に近づき、平均として意味も無い
    expect(MIN_COHORT).toBe(3);
    expect(cohortAverage(mine, [a, b]).error).toContain("3");
    expect(cohortAverage(mine, [a, b]).notes).toBeUndefined();
  });
  it("自分の計測が無いときと、誰とも重ならないときで文言が違う", () => {
    // どちらも「出ない」だが、利用者がすべきことが違う
    expect(cohortAverage({ notes: {} }, [a, b, c]).error).toContain("自分の計測");
    const few = { notes: { 0: note(9999, 99) } };
    expect(cohortAverage(mine, [few]).error).toContain("重なっている音");
  });
  it("誰もいなければエラーを返す(0除算しない)", () => {
    expect(cohortAverage(mine, []).error).toBeTruthy();
    expect(cohortAverage(mine, null).error).toBeTruthy();
  });
  it("音量は平均にも現れない", () => {
    const withVol = (o) => ({ notes: Object.fromEntries(Object.entries(o.notes).map(([k, v]) => [k, { ...v, volumeDb: -12 }])) });
    const r = cohortAverage(mine, [withVol(a), withVol(b), withVol(c)]);
    expect(Object.keys(r.notes["0"])).not.toContain("volumeDb");
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
