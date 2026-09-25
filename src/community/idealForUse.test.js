import { describe, it, expect } from "vitest";
import { idealForUse, alignIdealToMine, alignProfile, copyProfile, ADOPT_ALIGN_REQUIRED, ADOPTED_SOURCE_KIND } from "./align.js";
import { buildAdoptedProfile, ADOPTED_SOURCE } from "./idealDoc.js";
import { buildSnapshot, validateSnapshot } from "../backup/snapshot.js";

// ------------------------------------------------------------------
// 【便BA 再審査 2026-09-25 統括の裁定】揃えずに取り込んだ目安(共通の音が足りないまま「目安に設定」)を、
// 使うときも揃えられないなら、揃えが要る指標(重心・HNR)を目安から外す。音程と倍音構成は残す。
// 自分の計測が増えて揃えられるようになれば、揃った値で戻る。古い目安(印なし)と自分の目安は今まで通り。
// 取り込み(buildAdoptedProfile)→ 使う形(idealForUse)を**実物どうしでつないで**確かめる。
// 期待値は手で出した数(下のコメント)で、実装の定数から逆算しない。
// ------------------------------------------------------------------

// 相手の公開の形。人ごとに形が違う値(直線ではない)
const KEYS = [14, 16, 18, 20, 22];
const C = [1450, 1530, 1490, 1600, 1560];
const H = [17, 19.5, 18, 21, 20];
const P = [4, 1, -2, -5, -8];
const theirs = {
  notes: Object.fromEntries(KEYS.map((k, i) => [k, {
    spectralCentroidHz: C[i], hnrDb: H[i], pitchCentsSigned: P[i], harmonics: [1, 0.5 - i * 0.02, 0.25],
  }])),
};
const adopt = (aligned) => buildAdoptedProfile({
  aligned, theirIdeal: { saxType: "alto" }, nickname: "しろねこ", id: "x1", now: new Date("2026-09-25"),
}).profile;

// 自分の平均(端末の中の綴り。App.jsx の buildIdealProfileFromSessions と同じ形)
const local = (c, h) => ({ centroidHz: c, hnrDb: h, volumeDb: -14, pitchCentsSigned: 0 });
const myFew = { notes: { 14: local(940, 10), 16: local(1000, 11) } }; // 共通 2 音(足りない)
// 共通 3 音。重心: 自分の中央値 980 / 相手 1490 → -510。HNR: 自分 10.5 / 相手 18 → -7.5
const myEnough = { notes: { 14: local(940, 10), 16: local(1000, 11), 18: local(980, 10.5) } };

describe("取り込むときの印(alignedAtAdopt)", () => {
  it("揃えずに取り込んだら false、揃えて取り込んだら true", () => {
    expect(adopt(copyProfile(theirs)).alignedAtAdopt).toBe(false);
    const mineShared = { notes: { 14: { spectralCentroidHz: 940, hnrDb: 10 }, 16: { spectralCentroidHz: 1000, hnrDb: 11 }, 18: { spectralCentroidHz: 980, hnrDb: 10.5 } } };
    const aligned = alignProfile(mineShared, theirs);
    expect(aligned).not.toBe(null);
    expect(adopt(aligned).alignedAtAdopt).toBe(true);
  });
  it("取り込んだ目安の印の値は idealDoc.js と align.js で同じ(循環 import を避けて値で持っている)", () => {
    expect(ADOPTED_SOURCE_KIND).toBe(ADOPTED_SOURCE);
  });
  it("保存の形が印を落とさない(JSON の往復・バックアップの書き出しと検証)", () => {
    const p = adopt(copyProfile(theirs));
    expect(JSON.parse(JSON.stringify(p)).alignedAtAdopt).toBe(false);
    const snap = JSON.parse(JSON.stringify(buildSnapshot({ kv: { idealProfiles: [p] }, sessions: [] })));
    const v = validateSnapshot(snap);
    expect(v.ok).toBe(true);
    expect(v.data.kv.idealProfiles[0].alignedAtAdopt).toBe(false);
  });
});

describe("使うときの形(idealForUse)", () => {
  const unaligned = adopt(copyProfile(theirs));

  for (const [name, mine] of [["自分の計測が無い", null], ["共通の音が 2 音", myFew]]) {
    it(`揃えずに取り込んだ目安 × ${name} → 重心・HNR を外す。音程と倍音構成は残る`, () => {
      const r = idealForUse(unaligned, mine);
      expect(r.excludedMetrics).toEqual(["centroidHz", "hnrDb"]);
      for (const k of KEYS) {
        expect(r.notes[k]).not.toHaveProperty("centroidHz");
        expect(r.notes[k]).not.toHaveProperty("hnrDb");
        expect(r.notes[k].pitchCentsSigned).toBe(unaligned.notes[k].pitchCentsSigned);
        expect(r.notes[k].harmonicsProfile).toEqual(unaligned.notes[k].harmonicsProfile);
      }
      // 保存している目安そのものは書き換えない(使うたびに導く)
      expect(unaligned.notes[14].centroidHz).toBe(1450);
    });
  }

  it("自分の計測が増えて揃えられる → 全指標が戻り、揃った値になる", () => {
    const r = idealForUse(unaligned, myEnough);
    expect(r.excludedMetrics).toBeUndefined();
    // 重心は -510、HNR は -7.5(上の手計算)
    expect(r.notes[14].centroidHz).toBeCloseTo(940, 9);
    expect(r.notes[22].centroidHz).toBeCloseTo(1050, 9);
    expect(r.notes[20].hnrDb).toBeCloseTo(13.5, 9);
    expect(r.notes[16].pitchCentsSigned).toBe(1);
  });

  it("片方だけ揃えられる(HNR の共通音が 2 音)→ 揃えられなかった HNR だけ外す", () => {
    const mine = { notes: { 14: local(940, 10), 16: local(1000, 11), 18: { centroidHz: 980, volumeDb: -14 } } };
    const r = idealForUse(unaligned, mine);
    expect(r.excludedMetrics).toEqual(["hnrDb"]);
    expect(r.notes[14].centroidHz).toBeCloseTo(940, 9);
    expect(r.notes[14]).not.toHaveProperty("hnrDb");
  });

  it("古い目安(印なし)は今まで通り: 揃えられなくても外さない(alignIdealToMine と同じ)", () => {
    const old = { ...unaligned };
    delete old.alignedAtAdopt;
    const r = idealForUse(old, myFew);
    expect(r).toEqual(alignIdealToMine(old, myFew));
    expect(r.notes[14].centroidHz).toBe(1450);
    expect(r.excludedMetrics).toBeUndefined();
  });

  it("揃えて取り込んだ目安・自分の計測から作った目安は対象外", () => {
    const alignedAdopt = { ...unaligned, alignedAtAdopt: true };
    expect(idealForUse(alignedAdopt, myFew).notes[14].centroidHz).toBe(1450);
    const own = { ...unaligned, sourceKind: "session", alignedAtAdopt: false };
    expect(idealForUse(own, null).notes[14].centroidHz).toBe(1450);
    expect(idealForUse(own, null).excludedMetrics).toBeUndefined();
  });

  it("目安が無いときは null のまま", () => {
    expect(idealForUse(null, myEnough)).toBe(null);
  });

  it("外す指標は重心・HNR の2つ(音量は公開していない・音程と倍音構成は環境非依存)", () => {
    expect(ADOPT_ALIGN_REQUIRED).toEqual(["centroidHz", "hnrDb"]);
  });
});
