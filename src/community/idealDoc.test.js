import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  buildIdealDoc, sanitizeNotes, sanitizeIncomingNotes, selectOwnSessions, isSelfSession,
  MAX_PUBLISHED_NOTES, MIN_PUBLISHED_NOTES, MAX_NOTE_KEY,
} from "./idealDoc.js";

// 【この7キーは実装から import しない】公開ドキュメントの形は凍結された仕様で、
// firestore.rules の hasAll / hasOnly と一致していなければならない。
// 2026-09-03: 目安は「楽器種別ごとに1つ」に変わり、選んで公開するものではなくなった。
// これに伴い profileId / name / reedBrand / reedStrength が消えて 11→7 キー。
// **name が無いことで、公開される自由入力がニックネームだけになった。**
const DOC_KEYS = ["ownerUid", "saxType", "tuningHz", "notes", "noteKeys", "sourceSessionCount", "updatedAt"];

// App.jsx の目安が持っている形(綴りが公開側と違うことに注意)
const localNote = (c, h, p = 0) => ({
  semitoneIndex: 0, writtenLabel: "C", concertNote: "Eb3", frameCount: 120,
  pitchHz: 220, volumeDb: -14,            // ← volumeDb は絶対に出さない
  centroidHz: c, hnrDb: h, pitchCentsSigned: p,
  pitchStabilityCents: 3, harmonicsProfile: [1, 0.5, 0.25],
});

const base = {
  ownerUid: "uid1", saxType: "alto", tuningHz: 442,
  notes: { 0: localNote(1200, 10), 2: localNote(1600, 12), 4: localNote(2000, 14) },
  sourceSessionCount: 5,
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

describe("selectOwnSessions", () => {
  // 【ここが「他人の演奏を公開しない」を守っている唯一の場所】
  // 先生や友人の音を録ったセッションは performer に名前が入っているので落ちる。
  const s = (over) => ({ saxType: "alto", frames: [{}], ...over });
  it("performer が未設定・「自分」のセッションだけを選ぶ", () => {
    const list = [
      s({ id: "a" }),                        // 未設定 = 自分
      s({ id: "b", performer: "自分" }),
      s({ id: "c", performer: "" }),         // 空も既定値なので自分
      s({ id: "d", performer: "先生" }),     // ← 他人。落とす
      s({ id: "e", performer: "友人A" }),    // ← 他人。落とす
    ];
    expect(selectOwnSessions(list, "alto").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("楽器種別が違うセッションは選ばない", () => {
    const list = [s({ id: "a" }), s({ id: "b", saxType: "tenor" })];
    expect(selectOwnSessions(list, "alto").map((x) => x.id)).toEqual(["a"]);
  });
  it("フレームが無いセッションは選ばない(平均が作れない)", () => {
    const list = [s({ id: "a" }), s({ id: "b", frames: [] }), s({ id: "c", frames: undefined })];
    expect(selectOwnSessions(list, "alto").map((x) => x.id)).toEqual(["a"]);
  });
  it("壊れた入力でも落ちない", () => {
    expect(selectOwnSessions(null, "alto")).toEqual([]);
    expect(selectOwnSessions([null, undefined], "alto")).toEqual([]);
  });
  it("isSelfSession の判定が単体でも正しい", () => {
    expect(isSelfSession({})).toBe(true);
    expect(isSelfSession({ performer: "自分" })).toBe(true);
    expect(isSelfSession({ performer: "先生" })).toBe(false);
    expect(isSelfSession(null)).toBe(true); // 既定値として扱う
  });
});

describe("buildIdealDoc", () => {
  it("正しい入力から7キーちょうどのドキュメントを作る", () => {
    // 【この期待値を実装が返したキーから作らないこと】
    // Object.keys(r.doc) を両辺に使うと、実装が何を返しても通る検査になる。
    const r = buildIdealDoc(base, new Date("2026-08-28T00:00:00Z"));
    expect(r.error).toBeUndefined();
    expect(Object.keys(r.doc).sort()).toEqual([...DOC_KEYS].sort());
    expect(Object.keys(r.doc)).toHaveLength(7);
    expect(r.doc.noteKeys).toEqual(["0", "2", "4"]);
    expect(r.doc.updatedAt).toBe("2026-08-28T00:00:00.000Z");
  });
  it("名前を持たない(公開される自由入力をニックネームだけに保つ)", () => {
    const r = buildIdealDoc({ ...base, name: "勝手な名前" }, new Date("2026-08-28"));
    expect(r.doc.name).toBeUndefined();
    // 渡されても写さない。写すと hasOnly に弾かれて保存できなくなる。
    expect(Object.keys(r.doc)).not.toContain("name");
  });
  it("リードを持たない(平均は複数のセッションにまたがるので1本に決まらない)", () => {
    const r = buildIdealDoc({ ...base, reedBrand: "Vandoren" }, new Date("2026-08-28"));
    expect(Object.keys(r.doc)).not.toContain("reedBrand");
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
  it("音名キーが範囲外のものは落とす", () => {
    const notes = { 0: localNote(1, 1), 2: localNote(2, 2), 4: localNote(3, 3), 99: localNote(4, 4) };
    const r = buildIdealDoc({ ...base, notes }, new Date("2026-08-28"));
    expect(r.doc.noteKeys).toEqual(["0", "2", "4"]);
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
    expect(buildIdealDoc({ ...base, saxType: undefined }).error).toContain("楽器種別");
  });
  it("基準ピッチが範囲外なら弾く", () => {
    for (const bad of [399, 501, "442", null, NaN]) {
      expect(buildIdealDoc({ ...base, tuningHz: bad })).toHaveProperty("error");
    }
  });
  it("もとにした録音の数が整数でなければ弾く", () => {
    for (const bad of [0, -1, 1.5, "5", null]) {
      expect(buildIdealDoc({ ...base, sourceSessionCount: bad })).toHaveProperty("error");
    }
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
    expect(sanitizeIncomingNotes({ 0: { spectralCentroidHz: "x", hnrDb: {} } })).toEqual({});
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
  const idealsBlock = rules.slice(rules.indexOf("match /ideals/"));

  it("7キーの列挙がルールと一致する", () => {
    // 【食い違うと本番でしか壊れない】実装が7キーを書き、ルールが違う集合を許すと、
    // 公開の瞬間に permission-denied になる。手元にルールは無いので気づけない。
    const list = "[" + DOC_KEYS.map((k) => `'${k}'`).join(",") + "]";
    expect(idealsBlock).toContain(`request.resource.data.keys().hasAll(${list})`);
    expect(idealsBlock).toContain(`request.resource.data.keys().hasOnly(${list})`);
  });
  it("消した項目がルールにも残っていない", () => {
    // name / profileId / reed* を検査する行が残っていると、
    // 「実装は送らないのにルールは要求する」= 何も保存できない状態になりうる。
    for (const gone of ["profileId", "reedBrand", "reedStrength"]) {
      expect(idealsBlock).not.toContain(`request.resource.data.${gone}`);
    }
    expect(idealsBlock).not.toContain("request.resource.data.name");
  });
  it("docId が uid_saxType であることをルールが要求している", () => {
    // これが無いと、他人の uid を名乗るドキュメントを別のIDで作れる。
    // また、同じ人が同じ種別で複数持てるようになり「種別ごとに1つ」が崩れる。
    expect(idealsBlock).toContain('docId == request.auth.uid + "_" + request.resource.data.saxType');
  });
  it("音の数の上限が実装と一致する", () => {
    expect(idealsBlock).toContain(`request.resource.data.noteKeys.size() <= ${MAX_PUBLISHED_NOTES}`);
    expect(idealsBlock).toContain(`request.resource.data.noteKeys.size() >= ${MIN_PUBLISHED_NOTES}`);
  });
  it("音名キーの範囲が実装と一致する", () => {
    for (let n = 0; n <= MAX_NOTE_KEY; n++) expect(idealsBlock).toContain(`'${n}'`);
    expect(idealsBlock).not.toContain(`'${MAX_NOTE_KEY + 1}',`);
  });
  it("基準ピッチの範囲が実装と一致する", () => {
    expect(idealsBlock).toContain("request.resource.data.tuningHz >= 400");
    expect(idealsBlock).toContain("request.resource.data.tuningHz <= 500");
  });
  it("単票の読み取りが所有者の公開状態を見ている", () => {
    expect(idealsBlock).toContain("get(/databases/$(database)/documents/users/$(resource.data.ownerUid)).data.isPublic == true");
  });
});
