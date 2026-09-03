import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { buildIdealDoc, sanitizeNotes, sanitizeIncomingNotes, MAX_PUBLISHED_NOTES, MIN_PUBLISHED_NOTES, MAX_IDEAL_NAME, MAX_NOTE_KEY } from "./idealDoc.js";

// 【この11キーは実装から import しない】公開ドキュメントの形は凍結された仕様で、
// firestore.rules の hasAll / hasOnly と一致していなければならない。
const DOC_KEYS = ["ownerUid", "profileId", "name", "saxType", "tuningHz", "notes", "noteKeys",
  "sourceSessionCount", "reedBrand", "reedStrength", "updatedAt"];

// App.jsx の目安が持っている形(綴りが公開側と違うことに注意)
const localNote = (c, h, p = 0) => ({
  semitoneIndex: 0, writtenLabel: "C", concertNote: "Eb3", frameCount: 120,
  pitchHz: 220, volumeDb: -14,            // ← volumeDb は絶対に出さない
  centroidHz: c, hnrDb: h, pitchCentsSigned: p,
  pitchStabilityCents: 3, harmonicsProfile: [1, 0.5, 0.25],
});

const base = {
  ownerUid: "uid1", profileId: "p1", name: "いつもの音", saxType: "alto", tuningHz: 442,
  notes: { 0: localNote(1200, 10), 2: localNote(1600, 12), 4: localNote(2000, 14) },
  sourceSessionCount: 5, reedBrand: "Vandoren", reedStrength: "3.0", performerIsSelf: true,
};

describe("sanitizeNotes", () => {
  it("音量を必ず落とす", () => {
    // 【この1件が「音量を共有しない」を守っている】
    const out = sanitizeNotes(base.notes);
    for (const note of Object.values(out)) {
      expect(note.volumeDb).toBeUndefined();
      expect(Object.keys(note)).not.toContain("volumeDb");
    }
  });
  it("ローカルの綴りを公開側の綴りへ移す", () => {
    // centroidHz → spectralCentroidHz / harmonicsProfile → harmonics
    // ここがずれると「値が全部 undefined の目安」が公開され、誰の画面にも線が出ない。
    const out = sanitizeNotes({ 0: localNote(1200, 10) });
    expect(out["0"].spectralCentroidHz).toBe(1200);
    expect(out["0"].hnrDb).toBe(10);
    expect(out["0"].harmonics).toEqual([1, 0.5, 0.25]);
    expect(out["0"].centroidHz).toBeUndefined();
    expect(out["0"].harmonicsProfile).toBeUndefined();
  });
  it("知らない項目は写さない(拾う側で列挙している証拠)", () => {
    const out = sanitizeNotes({ 0: { centroidHz: 1, hnrDb: 2, evil: "x", memo: "秘密" } });
    expect(Object.keys(out["0"]).sort()).toEqual(["hnrDb", "spectralCentroidHz"]);
  });
  it("倍音構成は数値の配列のときだけ写す", () => {
    const bad = sanitizeNotes({ 0: { centroidHz: 1, hnrDb: 2, harmonicsProfile: [1, "x"] } });
    expect(bad["0"].harmonics).toBeUndefined();
    const empty = sanitizeNotes({ 0: { centroidHz: 1, hnrDb: 2, harmonicsProfile: [] } });
    expect(empty["0"].harmonics).toBeUndefined();
  });
  it("比較に使える指標が1つも無い音は載せない", () => {
    const out = sanitizeNotes({ 0: { pitchCentsSigned: 5 }, 2: localNote(1200, 10) });
    expect(Object.keys(out)).toEqual(["2"]);
  });
  it("壊れた入力でも落ちない", () => {
    expect(sanitizeNotes(null)).toEqual({});
    expect(sanitizeNotes({ 0: null, 2: "x" })).toEqual({});
  });
});

describe("buildIdealDoc", () => {
  it("正しい入力から11キーちょうどのドキュメントを作る", () => {
    // 【この期待値を実装が返したキーから作らないこと】
    // Object.keys(r.doc) を両辺に使うと、実装が何を返しても通る検査になる。
    const r = buildIdealDoc(base, new Date("2026-08-28T00:00:00Z"));
    expect(r.error).toBeUndefined();
    expect(Object.keys(r.doc).sort()).toEqual([...DOC_KEYS].sort());
    expect(Object.keys(r.doc)).toHaveLength(11);
    expect(r.doc.noteKeys).toEqual(["0", "2", "4"]);
    expect(r.doc.updatedAt).toBe("2026-08-28T00:00:00.000Z");
  });
  it("noteKeys と notes のキーが必ず一致する", () => {
    const r = buildIdealDoc(base, new Date("2026-08-28"));
    expect(r.doc.noteKeys.sort()).toEqual(Object.keys(r.doc.notes).sort());
  });
  it("noteKeys は数の順に並ぶ(文字列の辞書順ではない)", () => {
    const notes = { 10: localNote(1, 1), 2: localNote(2, 2), 1: localNote(3, 3) };
    const r = buildIdealDoc({ ...base, notes }, new Date("2026-08-28"));
    expect(r.doc.noteKeys).toEqual(["1", "2", "10"]);
  });

  it("他人の演奏は公開させない", () => {
    // 録られた本人の同意がないまま音が世界中に出るのを防ぐ(設計書 §7)
    expect(buildIdealDoc({ ...base, performerIsSelf: false }).error).toContain("自分の演奏");
    expect(buildIdealDoc({ ...base, performerIsSelf: undefined }).error).toContain("自分の演奏");
  });
  it("音が3音に足りなければ弾く", () => {
    const few = { ...base, notes: { 0: localNote(1200, 10), 2: localNote(1600, 12) } };
    expect(buildIdealDoc(few).error).toContain(String(MIN_PUBLISHED_NOTES));
  });
  it("音が多すぎれば弾く", () => {
    const many = {};
    for (let i = 0; i <= MAX_PUBLISHED_NOTES; i++) many[i] = localNote(1000 + i, 10);
    expect(buildIdealDoc({ ...base, notes: many }).error).toContain("音が多すぎます");
  });
  it("楽器種別が選択肢外なら弾く", () => {
    expect(buildIdealDoc({ ...base, saxType: "bass" }).error).toContain("楽器種別");
  });
  it("名前が空・長すぎ・NGワードなら弾く", () => {
    expect(buildIdealDoc({ ...base, name: "" })).toHaveProperty("error");
    expect(buildIdealDoc({ ...base, name: "   " })).toHaveProperty("error");
    expect(buildIdealDoc({ ...base, name: "あ".repeat(MAX_IDEAL_NAME + 1) })).toHaveProperty("error");
    // 【名前も自由入力なので必ずNG検査を通す】飛ばすと公開される自由文が2つになり、
    // 「通報の対象はニックネームだけ」という前提が崩れる。
    expect(buildIdealDoc({ ...base, name: "xxfuckxx" })).toHaveProperty("error");
  });
  it("前後の空白を落として保存する", () => {
    const r = buildIdealDoc({ ...base, name: "  いい音  " }, new Date("2026-08-28"));
    expect(r.doc.name).toBe("いい音");
  });
  it("基準ピッチが範囲外なら弾く", () => {
    for (const bad of [379, 501, "442", null, NaN]) {
      expect(buildIdealDoc({ ...base, tuningHz: bad })).toHaveProperty("error");
    }
  });
  it("もとにした録音の数が整数でなければ弾く", () => {
    for (const bad of [0, -1, 1.5, "5", null]) {
      expect(buildIdealDoc({ ...base, sourceSessionCount: bad })).toHaveProperty("error");
    }
  });
  it("リードは未設定でもよいが、壊れた値は弾く", () => {
    const none = buildIdealDoc({ ...base, reedBrand: null, reedStrength: null }, new Date("2026-08-28"));
    expect(none.error).toBeUndefined();
    expect(none.doc.reedBrand).toBeNull();
    const blank = buildIdealDoc({ ...base, reedBrand: "  " }, new Date("2026-08-28"));
    expect(blank.doc.reedBrand).toBeNull(); // 空白だけは未設定として扱う
    expect(buildIdealDoc({ ...base, reedBrand: 12345 })).toHaveProperty("error");
    expect(buildIdealDoc({ ...base, reedBrand: "あ".repeat(61) })).toHaveProperty("error");
  });
  it("公開したドキュメントに音量が残らない", () => {
    const r = buildIdealDoc(base, new Date("2026-08-28"));
    expect(JSON.stringify(r.doc)).not.toContain("volumeDb");
  });
});

describe("sanitizeIncomingNotes", () => {
  // ルールには繰り返しが無く、各音の値が数値であることをサーバ側では検査できない。
  // 書き込みを塞げない以上、壊れた値が画面へ届かないようにするのが上限(設計書の宿題2)。
  it("数値でない値を落とす", () => {
    const out = sanitizeIncomingNotes({
      0: { spectralCentroidHz: "1200", hnrDb: 10 },
      2: { spectralCentroidHz: 1600, hnrDb: null },
      4: { spectralCentroidHz: 2000, hnrDb: 14 },
    });
    expect(out["0"].spectralCentroidHz).toBeUndefined();
    expect(out["0"].hnrDb).toBe(10);
    expect(out["2"].hnrDb).toBeUndefined();
    expect(out["4"]).toEqual({ spectralCentroidHz: 2000, hnrDb: 14 });
  });
  it("両方の指標が壊れている音は丸ごと落とす", () => {
    const out = sanitizeIncomingNotes({ 0: { spectralCentroidHz: "x", hnrDb: {} } });
    expect(out).toEqual({});
  });
  it("知らない項目は通さない(注入の入口を作らない)", () => {
    const out = sanitizeIncomingNotes({ 0: { spectralCentroidHz: 1, hnrDb: 2, script: "<img>" } });
    expect(Object.keys(out["0"]).sort()).toEqual(["hnrDb", "spectralCentroidHz"]);
  });
  it("読み込んだ側にも音量を通さない", () => {
    const out = sanitizeIncomingNotes({ 0: { spectralCentroidHz: 1, hnrDb: 2, volumeDb: -12 } });
    expect(out["0"].volumeDb).toBeUndefined();
  });
});

describe("firestore.rules との同期", () => {
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");

  it("11キーの列挙がルールと一致する", () => {
    // 【食い違うと本番でしか壊れない】実装が11キーを書き、ルールが違う集合を許すと、
    // 公開の瞬間に permission-denied になる。手元にルールは無いので気づけない。
    const list = "[" + DOC_KEYS.map((k) => `'${k}'`).join(",") + "]";
    expect(rules).toContain(`request.resource.data.keys().hasAll(${list})`);
    expect(rules).toContain(`request.resource.data.keys().hasOnly(${list})`);
  });
  it("音の数の上限が実装と一致する", () => {
    // ここが実装40・ルール30のようにずれると、31音の目安が「保存を押した瞬間だけ失敗」する。
    expect(rules).toContain(`request.resource.data.noteKeys.size() <= ${MAX_PUBLISHED_NOTES}`);
    expect(rules).toContain(`request.resource.data.noteKeys.size() >= ${MIN_PUBLISHED_NOTES}`);
  });
  it("音名キーの範囲が実装と一致する", () => {
    for (let n = 0; n <= MAX_NOTE_KEY; n++) expect(rules).toContain(`'${n}'`);
    expect(rules).not.toContain(`'${MAX_NOTE_KEY + 1}',`);
  });
  it("基準ピッチの範囲が実装と一致する", () => {
    expect(rules).toContain("request.resource.data.tuningHz >= 400");
    expect(rules).toContain("request.resource.data.tuningHz <= 500");
  });
  it("名前のバイト長の上限が、実装の文字数上限と辻褄が合う", () => {
    // ルールの size() は UTF-8 のバイト長。1文字最大4バイトなので、
    // 文字数の上限 x 4 が厳密な最悪値の上界になる。
    expect(rules).toContain(`request.resource.data.name.size() <= ${MAX_IDEAL_NAME * 4}`);
  });
  it("docId が uid_profileId であることをルールが要求している", () => {
    // これが無いと、他人の uid を名乗るドキュメントを別のIDで作れる
    expect(rules).toContain('docId == request.auth.uid + "_" + request.resource.data.profileId');
  });
  it("単票の読み取りが所有者の公開状態を見ている", () => {
    expect(rules).toContain("get(/databases/$(database)/documents/users/$(resource.data.ownerUid)).data.isPublic == true");
  });
});
