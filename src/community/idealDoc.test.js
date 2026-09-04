import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  buildIdealDoc, sanitizeNotes, sanitizeIncomingNotes, selectOwnSessions, isSelfSession,
  MAX_PUBLISHED_NOTES, MIN_PUBLISHED_NOTES, MAX_NOTE_KEY,
  toLocalNotes, buildAdoptedProfile, ADOPTED_SOURCE,
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

describe("取り込み(他人の目安を自分の目安にする)", () => {
  const shared = (c, h, p) => ({ spectralCentroidHz: c, hnrDb: h, pitchCentsSigned: p, harmonics: [1, 0.5, 0.25] });
  const aligned = { notes: { 0: shared(1300, 11, -1), 2: shared(1600, 12, 3), 4: shared(2100, 15, 6) } };
  const theirIdeal = { saxType: "tenor", ownerUid: "u1" };

  it("公開の綴りをローカルの綴りへ戻す", () => {
    // spectralCentroidHz → centroidHz / harmonics → harmonicsProfile
    // ここがずれると、取り込んだ目安が App.jsx から読めず、計測タブで何も比較できない。
    const out = toLocalNotes(aligned.notes);
    expect(out["0"].centroidHz).toBe(1300);
    // 倍音構成は [{n, norm}] へ戻る(計測タブが h.norm と読むため)
    expect(out["0"].harmonicsProfile).toEqual([{ n: 1, norm: 1 }, { n: 2, norm: 0.5 }, { n: 3, norm: 0.25 }]);
    expect(out["0"].hnrDb).toBe(11);
    expect(out["0"].spectralCentroidHz).toBeUndefined();
    expect(out["0"].harmonics).toBeUndefined();
  });
  it("半音インデックスを数値で持たせる", () => {
    expect(toLocalNotes(aligned.notes)["4"].semitoneIndex).toBe(4);
  });
  it("倍音構成の配列を共有しない(元を書き換えても取り込み側が変わらない)", () => {
    const src = { 0: shared(1, 2, 3) };
    const out = toLocalNotes(src);
    src[0].harmonics.push(999);
    expect(out["0"].harmonicsProfile).toHaveLength(3); // map で作り直しているので影響を受けない
  });
  it("音量は復元されない(そもそも共有していない)", () => {
    const withVol = { 0: { ...shared(1, 2, 3), volumeDb: -12 } };
    const out = toLocalNotes(withVol);
    expect(out["0"].volumeDb).toBeUndefined();
  });

  it("取り込んだ目安は誰のものか分かる名前を持つ", () => {
    const r = buildAdoptedProfile({ aligned, theirIdeal, nickname: "まつり", id: "x1", now: new Date("2026-09-04") });
    expect(r.error).toBeUndefined();
    expect(r.profile.name).toContain("まつり");
    expect(r.profile.id).toBe("x1");
    expect(r.profile.saxType).toBe("tenor");
  });
  it("由来を community にし、セッションの由来を空にする", () => {
    // 【ここが空でないと、関係の無いセッションが「目安設定中」と表示される】
    // 取り込んだ目安は自分の録音から作ったものではない。
    const r = buildAdoptedProfile({ aligned, theirIdeal, nickname: "まつり", id: "x1" });
    expect(r.profile.sourceKind).toBe(ADOPTED_SOURCE);
    expect(r.profile.sourceKind).not.toBe("session");
    expect(r.profile.sourceKind).not.toBe("performer");
    expect(r.profile.sourceSessionIds).toEqual([]);
  });
  it("App.jsx が読む形(notes[半音インデックス])になっている", () => {
    const r = buildAdoptedProfile({ aligned, theirIdeal, nickname: "まつり", id: "x1" });
    expect(Object.keys(r.profile.notes).sort()).toEqual(["0", "2", "4"]);
    expect(r.profile.notes["2"].centroidHz).toBe(1600);
  });
  it("取り込める音が無ければエラーを返す(空の目安を作らない)", () => {
    expect(buildAdoptedProfile({ aligned: { notes: {} }, theirIdeal, nickname: "x", id: "y" })).toHaveProperty("error");
    expect(buildAdoptedProfile({ aligned: null, theirIdeal, nickname: "x", id: "y" })).toHaveProperty("error");
  });
});

describe("倍音構成の形(出す側と取り込む側)", () => {
  // 【一度これを踏んだ】ローカルの harmonicsProfile は [{n, norm}] のオブジェクト配列。
  // 数値配列を期待して弾いていたため、**倍音構成が一度も公開されていなかった。**
  // エラーにならず黙って消えるので、画面を見ても気づけない。
  const objArr = [{ n: 1, norm: 0.8 }, { n: 2, norm: 0.4 }, { n: 3, norm: 0.2 }];

  it("出すときは norm だけの数値配列にする", () => {
    const out = sanitizeNotes({ 0: { centroidHz: 1200, hnrDb: 10, harmonicsProfile: objArr } });
    expect(out["0"].harmonics).toEqual([0.8, 0.4, 0.2]);
  });
  it("数値配列がそのまま来ても受ける(取り込んだ目安を出し直す経路)", () => {
    const out = sanitizeNotes({ 0: { centroidHz: 1200, hnrDb: 10, harmonicsProfile: [0.8, 0.4] } });
    expect(out["0"].harmonics).toEqual([0.8, 0.4]);
  });
  it("norm が数値でない要素が混ざれば丸ごと落とす", () => {
    const bad = sanitizeNotes({ 0: { centroidHz: 1, hnrDb: 2, harmonicsProfile: [{ n: 1, norm: "x" }] } });
    expect(bad["0"].harmonics).toBeUndefined();
  });
  it("取り込むときは [{n, norm}] へ戻す", () => {
    // 【戻さないと計測タブで NaN になる】あちらは harmonicsProfile.map((h) => h.norm) と書いている。
    const local = toLocalNotes({ 0: { spectralCentroidHz: 1, hnrDb: 2, harmonics: [0.8, 0.4, 0.2] } });
    expect(local["0"].harmonicsProfile).toEqual([{ n: 1, norm: 0.8 }, { n: 2, norm: 0.4 }, { n: 3, norm: 0.2 }]);
    // 計測タブと同じ読み方で数値になること
    expect(local["0"].harmonicsProfile.map((h) => h.norm)).toEqual([0.8, 0.4, 0.2]);
  });
  it("出して取り込むと元の形に戻る", () => {
    const shared = sanitizeNotes({ 0: { centroidHz: 1200, hnrDb: 10, harmonicsProfile: objArr } });
    const back = toLocalNotes(shared);
    expect(back["0"].harmonicsProfile).toEqual(objArr);
  });
});

describe("取り込んだ目安のピッチ目標", () => {
  const aligned = { notes: {
    0: { spectralCentroidHz: 1300, hnrDb: 11, pitchCentsSigned: 0 },
    2: { spectralCentroidHz: 1600, hnrDb: 12, pitchCentsSigned: 12 },
    4: { spectralCentroidHz: 2100, hnrDb: 15, pitchCentsSigned: -12 },
  } };
  const theirIdeal = { saxType: "alto", ownerUid: "u1" };
  // 自分の基準ピッチでの理論周波数(半音インデックス→Hz)
  const baseFreqOf = (i) => ({ 0: 200, 2: 400, 4: 800 }[i] ?? null);

  it("相手のずれ(セント)を自分の理論周波数に当てて作る", () => {
    // 【相手の Hz をそのまま使わない】調弦が違うと常にずれて出る。
    const r = buildAdoptedProfile({ aligned, theirIdeal, nickname: "x", id: "y", baseFreqOf });
    expect(r.profile.notes["0"].pitchHz).toBeCloseTo(200, 6);        // ずれ0 → 理論値そのもの
    expect(r.profile.notes["2"].pitchHz).toBeCloseTo(400 * Math.pow(2, 12 / 1200), 6);  // +12¢
    expect(r.profile.notes["4"].pitchHz).toBeCloseTo(800 * Math.pow(2, -12 / 1200), 6); // -12¢
  });
  it("理論周波数を引けない音には pitchHz を作らない", () => {
    // でたらめな Hz を入れると、合っているのに「ずれている」と出続ける。
    const r = buildAdoptedProfile({ aligned, theirIdeal, nickname: "x", id: "y", baseFreqOf: () => null });
    for (const n of Object.values(r.profile.notes)) expect(n.pitchHz).toBeUndefined();
  });
  it("baseFreqOf を渡さなければ pitchHz は入らない", () => {
    const r = buildAdoptedProfile({ aligned, theirIdeal, nickname: "x", id: "y" });
    expect(r.profile.notes["0"].pitchHz).toBeUndefined();
  });
});
