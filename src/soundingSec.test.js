import { describe, it, expect } from "vitest";
import { sessionSoundingSec, frameIntervalSec, isSoundingFrame } from "./soundingSec.js";

// フレームの最小形。実物はもっと持つが、練習時間が読むのは t と pitchCents だけ。
const on = (t, cents = 3.2) => ({ t, pitchHz: 440, pitchCents: cents });
const off = (t) => ({ t, pitchHz: null, pitchCents: null });
// ライブ経路の「基音は拾えたがゲートを通っていない」フレーム(pitchHz あり・pitchCents なし)。
const gated = (t) => ({ t, pitchHz: 442, pitchCents: null });

describe("sessionSoundingSec", () => {
  it("frames が無い / 空なら 0", () => {
    expect(sessionSoundingSec(null)).toBe(0);
    expect(sessionSoundingSec({})).toBe(0);
    expect(sessionSoundingSec({ frames: [] })).toBe(0);
  });
  it("発音フレームが 0 なら 0(録音の長さがあっても数えない)", () => {
    const frames = [off(0), off(0.1), off(0.2), off(0.3), off(0.4)];
    expect(sessionSoundingSec({ frames })).toBe(0);
  });
  it("混在: 発音フレーム数 × 間隔(録音の長さ 0.9 秒ではなく 0.4 秒)", () => {
    const frames = [off(0), on(0.1), on(0.2), off(0.3), on(0.4), off(0.5), off(0.6), on(0.7), off(0.8), off(0.9)];
    expect(sessionSoundingSec({ frames })).toBeCloseTo(0.4, 9);
  });
  it("t の間隔が不揃いでも中央値で数える(長い隙間に引きずられない)", () => {
    // 差 = 0.1, 0.1, 0.7, 0.1, 0.1 → 中央値 0.1(平均なら 0.22)
    const frames = [on(0), on(0.1), on(0.2), off(0.9), off(1.0), off(1.1)];
    expect(frameIntervalSec(frames)).toBeCloseTo(0.1, 9);
    expect(sessionSoundingSec({ frames })).toBeCloseTo(0.3, 9);
  });
  it("1フレームだけなら間隔が出せないので 0", () => {
    expect(sessionSoundingSec({ frames: [on(0)] })).toBe(0);
  });
  it("ゲートを通っていないフレーム(pitchHz あり・pitchCents なし)は数えない", () => {
    const frames = [gated(0), gated(0.1), on(0.2), gated(0.3)];
    expect(isSoundingFrame(gated(0))).toBe(false);
    expect(sessionSoundingSec({ frames })).toBeCloseTo(0.1, 9);
  });
  it("全部が発音なら フレーム数 × 間隔", () => {
    const frames = Array.from({ length: 50 }, (_, i) => on(i * 0.1));
    expect(sessionSoundingSec({ frames })).toBeCloseTo(5.0, 9);
  });
  it("t が数値でないフレームは間隔の計算から外す(壊れた記録で NaN にしない)", () => {
    const frames = [on(0), { t: null, pitchCents: 1 }, on(0.2), on(0.3)];
    expect(Number.isFinite(sessionSoundingSec({ frames }))).toBe(true);
    expect(sessionSoundingSec({ frames })).toBeCloseTo(0.4, 9);
  });
});
