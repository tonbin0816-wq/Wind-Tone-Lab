import { describe, it, expect } from "vitest";
import { buildSnapshot, validateSnapshot, snapshotFileName, SNAPSHOT_FORMAT, SNAPSHOT_VERSION } from "./snapshot.js";

const kv = { saxType: "alto", tuningHz: 442, reeds: [{ id: "r1", brand: "Traditional", strength: "3" }] };
const sessions = [{ id: "s1", recordedAt: "2026-08-01T00:00:00.000Z", saxType: "alto", frames: [{ pitchHz: 440 }] }];

describe("buildSnapshot", () => {
  it("形式・版・書き出し時刻・中身を持つ", () => {
    const s = buildSnapshot({ kv, sessions }, new Date("2026-09-02T03:04:05Z"));
    expect(s.format).toBe(SNAPSHOT_FORMAT);
    expect(s.version).toBe(SNAPSHOT_VERSION);
    expect(s.exportedAt).toBe("2026-09-02T03:04:05.000Z");
    expect(s.kv.tuningHz).toBe(442);
    expect(s.sessions).toHaveLength(1);
  });
  it("件数を数えて持つ(読み戻し前に人へ見せるため)", () => {
    const s = buildSnapshot({ kv, sessions });
    expect(s.counts.sessions).toBe(1);
    expect(s.counts.frames).toBe(1);
  });
});

describe("validateSnapshot", () => {
  it("正しい雪形を受理する", () => {
    const s = buildSnapshot({ kv, sessions });
    expect(validateSnapshot(s).ok).toBe(true);
  });
  it("別のアプリのファイルを弾く", () => {
    expect(validateSnapshot({ format: "something-else", version: 1 }).error).toContain("Ficus");
  });
  it("未来の版を弾く", () => {
    const s = buildSnapshot({ kv, sessions });
    expect(validateSnapshot({ ...s, version: 99 }).error).toContain("新しい");
  });
  it("壊れた中身を弾く", () => {
    const s = buildSnapshot({ kv, sessions });
    expect(validateSnapshot({ ...s, sessions: "配列ではない" }).error).toBeTruthy();
    expect(validateSnapshot({ ...s, kv: null }).error).toBeTruthy();
  });
  it("null や文字列でも落ちない", () => {
    expect(validateSnapshot(null).error).toBeTruthy();
    expect(validateSnapshot("{}").error).toBeTruthy();
  });
});

describe("snapshotFileName", () => {
  it("日付が入った名前を返す", () => {
    expect(snapshotFileName(new Date("2026-09-02T00:00:00Z"))).toBe("ficus-backup-2026-09-02.json");
  });
});
