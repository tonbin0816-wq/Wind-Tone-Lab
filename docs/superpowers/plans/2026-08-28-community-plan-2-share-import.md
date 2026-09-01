# コミュニティ機能 計画2: 目安の公開・検索・取り込み Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自分の目安プロファイルを公開し、他の奏者の目安を属性で絞り込んで探し、平行移動して自分の目安として取り込めるようにする。

**Architecture:** 平行移動(共通音名の中央値でオフセットを求め、相手の値をずらす)は副作用のない純粋関数として `src/community/align.js` に切り出し、vitest でTDDする。Firestore には `ideals` コレクションを足し、既存の `users` と同じ「キー集合を `hasAll`+`hasOnly` で固定し、値の型と選択肢を全部検査する」方針を踏襲する。UI は計画1の `CommunityTab.jsx` に子タブを増やす形で足す。**既存の目安プロファイルの構造(`notes[semitoneIndex]`)は変更しない** — 取り込んだ目安は普通のプロファイルとして保存され、計測タブは他人由来かどうかを知らないまま動く。

**Tech Stack:** React 18 / Vite 5 / firebase 12 (Auth + Firestore) / vitest

**Spec:** `docs/superpowers/specs/2026-08-27-community-tab-design.md`(§3 平行移動、§4.2 公開目安プロファイル、§5① 目安をさがす、§7.3 第三者の演奏)
**画面案:** `design/community-tab-proposals.html`(01 目安をさがす / 02 目安を重ねて取り込む)

## Global Constraints

- UI文言はすべて日本語
- **既存の目安プロファイルの構造を変えない。** `notes[semitoneIndex]` を引く `getNoteIdeal()` が読める形を保つ
- 共有するのは **ピッチ・倍音構成・スペクトル重心・HNR** のみ。**音量(volumeDb)は共有しない**(spec §3.2)
- 重心とHNRは**平行移動して共有**。ピッチと倍音構成は**そのまま共有**(spec §3.2)
- 平行移動の基準は**共通音名の中央値**。**共通音名が3音未満の相手は一覧に出さない**(spec §3.3)
- 公開できるのは **`performer` が「自分」のセッション由来の目安のみ**(spec §7.3)
- `src/App.jsx` への変更は**この計画では一切行わない**(別セッションがデザイン改修中)
- Firestore ルールは `users` と同じ厳格さ: `hasAll` + `hasOnly` + 全フィールドの型と選択肢を検査
- 属性の選択肢は `学生 / 学生（音大） / 社会人 / 講師・プロ / 独学`(`profile.js` の `POSITIONS` が正)
- **プロフィールの楽器種別は `saxTypes`(配列)、機材は `gear`(種別をキーにした map)**。1人が複数の楽器を吹く。
  一方**目安ドキュメント側の `saxType` は単数**(1つの目安は1つの楽器種別のもの)。混同しないこと
- **非公開に切り替えたら、その人の `ideals` を削除する**(公開状態を `users` の1箇所に保つ。
  読まれてはいけないものを置かない)
- コミットは各タスク末尾で必ず行う

## この計画に含まれないもの(後続計画)

計画3: 練習集計とランキング(Cloud Functions) / 計画4: 機材シェア・コホート平均 / 計画5: モデレーション(通報・自動非公開・BAN)・法務文書 / 計画6: Google/Apple 引き継ぎ連携・Capacitor・ストア提出

**コホート平均(「みんなの平均」)は計画4。** 本計画は個人の目安のみを扱う。画面案の「みんなの平均」カードは計画4で足す。

## 前提(計画1で完成済み)

- `src/community/profile.js`: `POSITIONS / GENRES / ENSEMBLES / PLACES / SAX_TYPES`、`buildProfileDoc`、`validateNickname`
- `src/community/accountRepo.js`: `getSignedInUid()`, `ensureSignedIn()`, `loadProfile(uid)`, `saveProfile`, `deleteAccount`
- `src/community/firebaseClient.js`: `getFirebase()`
- `src/community/CommunityTab.jsx`: 参加 → 登録 → プロフィール表示・削除
- `firestore.rules`: `users/{uid}` のみ。`allow list: if false`

---

### Task 1: 平行移動の算術(TDD)

**Files:**
- Create: `src/community/align.js`
- Test: `src/community/align.test.js`

**Interfaces:**
- Produces:
  - `SHIFTED_METRICS = ["spectralCentroidHz", "hnrDb"]`
  - `COPIED_METRICS = ["pitchCentsSigned", "harmonics"]`
  - `MIN_COMMON_NOTES = 3`
  - `commonNoteKeys(mine, theirs): string[]` — 両方の `notes` に在り、比較対象の値が数値である音名キー
  - `medianOf(values: number[]): number | null`
  - `alignOffset(mine, theirs, metric): number | null` — 共通音名が3未満なら null
  - `alignProfile(mine, theirs): { notes, shiftedBy } | { error: string }`

- [ ] **Step 1: 失敗するテストを書く**

`src/community/align.test.js`:

```js
import { describe, it, expect } from "vitest";
import { commonNoteKeys, medianOf, alignOffset, alignProfile, MIN_COMMON_NOTES } from "./align.js";

// notes[semitoneIndex] の最小形。実際のプロファイルはもっとフィールドを持つが、
// 平行移動が見るのはここに書いた4つだけ。
const note = (c, h, p = 0, harm = [1, .5, .25]) =>
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
  it("外れ値1つに引きずられない（平均ではなく中央値である証拠）", () => {
    const wild = { notes: { 0: note(1800, 16), 2: note(2100, 17), 4: note(9000, 20) } };
    // 相手の中央値は 2100（平均なら 4300 になり、オフセットが1000以上ずれる）
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
    // 重心: 相手の値 + (-500)
    expect(r.notes["0"].spectralCentroidHz).toBe(1300);
    expect(r.notes["4"].spectralCentroidHz).toBe(2100);
    // HNR: 自分中央値 12 / 相手中央値 17 → オフセット -5
    expect(r.notes["0"].hnrDb).toBe(11);
    // ピッチと倍音構成は相手の値のまま
    expect(r.notes["0"].pitchCentsSigned).toBe(0);
    expect(r.notes["0"].harmonics).toEqual([1, .5, .25]);
    expect(r.shiftedBy.spectralCentroidHz).toBe(-500);
    expect(r.shiftedBy.hnrDb).toBe(-5);
  });
  it("相手にしか無い音も、同じオフセットを当てて残す", () => {
    const r = alignProfile(mine, theirs);
    expect(r.notes["7"].spectralCentroidHz).toBe(2500);
  });
  it("音量は結果に含めない", () => {
    const withVol = { notes: { 0: { ...note(1800, 16), volumeDb: -12 }, 2: note(2100, 17), 4: note(2600, 20) } };
    const r = alignProfile(mine, withVol);
    expect(r.notes["0"].volumeDb).toBeUndefined();
  });
  it("共通音が足りなければエラーを返す", () => {
    const few = { notes: { 0: note(1800, 16), 2: note(2100, 17) } };
    expect(alignProfile(mine, few).error).toContain("重なっている音");
  });
  it("自分にデータが無ければエラーを返す", () => {
    expect(alignProfile({ notes: {} }, theirs).error).toContain("自分の計測");
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/community/align.test.js`
Expected: FAIL(モジュール未作成)

- [ ] **Step 3: 実装**

`src/community/align.js`:

```js
// 他人の目安を自分の目安として使うための平行移動。
//
// なぜ要るか: スペクトル重心とHNRの絶対値は、マイクの距離・入力ゲイン・部屋の響きで
// 一律にずれる。相手の値をそのまま目標にすると全音で「足りない」と出続け、
// どの音を直せばいいか分からない。共通する音の中央値を合わせてから重ねると、
// 残るのは「音ごとの形の差」= 本物の差だけになる。
// 設計書 docs/superpowers/specs/2026-08-27-community-tab-design.md §3。

// 平行移動して共有する指標(環境で一律にずれるもの)
export const SHIFTED_METRICS = ["spectralCentroidHz", "hnrDb"];
// そのまま共有する指標(ピッチは環境非依存、倍音構成は音の中での比率)
export const COPIED_METRICS = ["pitchCentsSigned", "harmonics"];
// 共通音がこれ未満だと基準が立たない
export const MIN_COMMON_NOTES = 3;

const num = (v) => typeof v === "number" && Number.isFinite(v);

export function commonNoteKeys(mine, theirs, metric) {
  const a = mine?.notes ?? {};
  const b = theirs?.notes ?? {};
  return Object.keys(a)
    .filter((k) => num(a[k]?.[metric]) && num(b[k]?.[metric]))
    .sort((x, y) => Number(x) - Number(y));
}

export function medianOf(values) {
  const v = values.filter(num).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function alignOffset(mine, theirs, metric) {
  const keys = commonNoteKeys(mine, theirs, metric);
  if (keys.length < MIN_COMMON_NOTES) return null;
  const mm = medianOf(keys.map((k) => mine.notes[k][metric]));
  const tm = medianOf(keys.map((k) => theirs.notes[k][metric]));
  if (mm === null || tm === null) return null;
  return mm - tm;
}

export function alignProfile(mine, theirs) {
  const mineNotes = mine?.notes ?? {};
  if (Object.keys(mineNotes).length === 0) {
    return { error: "自分の計測がまだありません。数回吹いてから取り込んでください" };
  }
  const shiftedBy = {};
  for (const metric of SHIFTED_METRICS) {
    const off = alignOffset(mine, theirs, metric);
    if (off === null) {
      return { error: `重なっている音が ${MIN_COMMON_NOTES} 音に足りません` };
    }
    shiftedBy[metric] = off;
  }
  const notes = {};
  for (const [key, src] of Object.entries(theirs?.notes ?? {})) {
    const out = {};
    for (const metric of SHIFTED_METRICS) {
      if (num(src?.[metric])) out[metric] = src[metric] + shiftedBy[metric];
    }
    for (const metric of COPIED_METRICS) {
      if (src?.[metric] !== undefined) out[metric] = src[metric];
    }
    notes[key] = out;
  }
  return { notes, shiftedBy };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/community/align.test.js`
Expected: PASS

- [ ] **Step 5: フルスイートを1回**

Run: `npm run test`
Expected: 計画1の83件を含めて全て PASS

- [ ] **Step 6: Commit**

```bash
git add src/community/align.js src/community/align.test.js
git commit -m "コミュニティ計画2: 目安の平行移動の算術を追加"
```

---

### Task 2: 公開する目安ドキュメントの組み立て(TDD)

**Files:**
- Create: `src/community/idealDoc.js`
- Test: `src/community/idealDoc.test.js`

**Interfaces:**
- Consumes: `SHIFTED_METRICS`, `COPIED_METRICS`(Task 1)
- Produces:
  - `MAX_PUBLISHED_NOTES = 40`
  - `buildIdealDoc(input, now?): { doc } | { error }`
    input: `{ uid, profileId, name, saxType, tuningHz, notes, sourceSessionCount, reed, performerIsSelf }`
    doc keys(必ずこの**11**): `ownerUid, profileId, name, saxType, tuningHz, notes, noteKeys, sourceSessionCount, reedBrand, reedStrength, updatedAt`
    (`adoptionCount` は**この11に入らない**。理由と未決事項は本ファイル末尾の**未決事項1**を読むこと)
  - `sanitizeNotes(notes): object` — 共有してよい指標だけを残し、**volumeDb を必ず落とす**

- [ ] **Step 1: 失敗するテストを書く**

`src/community/idealDoc.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildIdealDoc, sanitizeNotes, MAX_PUBLISHED_NOTES } from "./idealDoc.js";

const base = {
  uid: "u1", profileId: "p1", name: "スケール練習", saxType: "alto", tuningHz: 442,
  notes: {
    0: { spectralCentroidHz: 1800, hnrDb: 16, pitchCentsSigned: -3, harmonics: [1, .5], volumeDb: -12 },
    2: { spectralCentroidHz: 2100, hnrDb: 17, pitchCentsSigned: 2, harmonics: [1, .4], volumeDb: -11 },
    4: { spectralCentroidHz: 2600, hnrDb: 20, pitchCentsSigned: 0, harmonics: [1, .6], volumeDb: -13 },
  },
  sourceSessionCount: 3,
  reed: { brand: "Traditional", strength: "3" },
  performerIsSelf: true,
};

describe("sanitizeNotes", () => {
  it("音量を必ず落とす", () => {
    const out = sanitizeNotes(base.notes);
    expect(out["0"].volumeDb).toBeUndefined();
    expect(out["0"].spectralCentroidHz).toBe(1800);
    expect(out["0"].harmonics).toEqual([1, .5]);
  });
  it("知らないフィールドは通さない", () => {
    const out = sanitizeNotes({ 0: { spectralCentroidHz: 1, hnrDb: 2, evil: "x" } });
    expect(out["0"].evil).toBeUndefined();
  });
});

describe("buildIdealDoc", () => {
  it("正しい入力から11キーちょうどのドキュメントを作る", () => {
    const r = buildIdealDoc(base, new Date("2026-08-28T00:00:00Z"));
    // 【この期待値を「実装が返したキー」から作らないこと】
    // Object.keys(r.doc) を両辺に使うと、実装が何を返しても通る検査になり何も守らない。
    // 数(11)も並びも、ここに手で書いた列だけが正。
    expect(Object.keys(r.doc)).toHaveLength(11);
    expect(Object.keys(r.doc).sort()).toEqual([
      "name", "noteKeys", "notes", "ownerUid", "profileId", "reedBrand",
      "reedStrength", "saxType", "sourceSessionCount", "tuningHz", "updatedAt",
    ]);
    // adoptionCount は目安ドキュメントに含めない(末尾の未決事項1を参照)
    expect(r.doc.adoptionCount).toBeUndefined();
    expect(r.doc.noteKeys).toEqual(["0", "2", "4"]);
  });
  it("他人の演奏由来は公開できない", () => {
    expect(buildIdealDoc({ ...base, performerIsSelf: false }).error).toContain("自分の演奏");
  });
  it("音が3未満なら公開できない", () => {
    const few = { ...base, notes: { 0: base.notes[0], 2: base.notes[2] } };
    expect(buildIdealDoc(few).error).toContain("3音");
  });
  it("音が多すぎるものは公開できない", () => {
    const many = {};
    for (let i = 0; i < MAX_PUBLISHED_NOTES + 1; i++) many[i] = { spectralCentroidHz: 1, hnrDb: 2 };
    expect(buildIdealDoc({ ...base, notes: many }).error).toContain("音が多すぎます");
  });
  it("楽器種別が選択肢外なら弾く", () => {
    expect(buildIdealDoc({ ...base, saxType: "bass" }).error).toContain("楽器種別");
  });
  it("名前が空・長すぎ・NGワードなら弾く", () => {
    expect(buildIdealDoc({ ...base, name: "" }).error).toBeTruthy();
    expect(buildIdealDoc({ ...base, name: "あ".repeat(31) }).error).toBeTruthy();
    expect(buildIdealDoc({ ...base, name: "xxfuckxx" }).error).toBeTruthy();
  });
  it("リードが無くても公開できる", () => {
    const r = buildIdealDoc({ ...base, reed: null });
    expect(r.doc.reedBrand).toBeNull();
    expect(r.doc.reedStrength).toBeNull();
  });
  it("リードの使用日数は公開しない", () => {
    const r = buildIdealDoc(base);
    expect(r.doc.reedDays).toBeUndefined();
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/community/idealDoc.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/community/idealDoc.js`:

```js
import { SHIFTED_METRICS, COPIED_METRICS, MIN_COMMON_NOTES } from "./align.js";
import { SAX_TYPES } from "./profile.js";
import { findNgWord } from "./ngwords/filter.js";

// 1つの目安に含めてよい音の数の上限。実際のサックスの音域(約2.5オクターブ=31音)に
// 余裕を持たせた値。これを超えるものは壊れたデータとみなす。
export const MAX_PUBLISHED_NOTES = 40;

const SHARED = [...SHIFTED_METRICS, ...COPIED_METRICS];
const num = (v) => typeof v === "number" && Number.isFinite(v);

// 共有してよい指標だけを残す。とくに volumeDb は環境に完全に支配されるので
// 決して外へ出さない(設計書 §3.2)。知らないフィールドも落とす。
export function sanitizeNotes(notes) {
  const out = {};
  for (const [key, src] of Object.entries(notes ?? {})) {
    const kept = {};
    for (const m of SHARED) {
      if (m === "harmonics") {
        if (Array.isArray(src?.harmonics)) kept.harmonics = src.harmonics.filter(num);
      } else if (num(src?.[m])) kept[m] = src[m];
    }
    if (Object.keys(kept).length > 0) out[key] = kept;
  }
  return out;
}

export function buildIdealDoc(input, now = new Date()) {
  if (input?.performerIsSelf !== true) {
    return { error: "自分の演奏から作った目安だけを公開できます" };
  }
  const name = String(input?.name ?? "").trim();
  if (name.length === 0) return { error: "目安の名前を入力してください" };
  if ([...name].length > 30) return { error: "目安の名前は30文字までです" };
  if (/[\p{Cc}]/u.test(name)) return { error: "使えない文字が含まれています" };
  if (findNgWord(name)) return { error: "この名前は使用できません" };
  if (!SAX_TYPES.includes(input?.saxType)) return { error: "楽器種別が正しくありません" };
  if (!num(input?.tuningHz) || input.tuningHz < 400 || input.tuningHz > 500) {
    return { error: "基準ピッチが正しくありません" };
  }
  const notes = sanitizeNotes(input?.notes);
  const noteKeys = Object.keys(notes).sort((a, b) => Number(a) - Number(b));
  if (noteKeys.length < MIN_COMMON_NOTES) {
    return { error: `公開できるのは ${MIN_COMMON_NOTES}音 以上を含む目安だけです` };
  }
  if (noteKeys.length > MAX_PUBLISHED_NOTES) return { error: "音が多すぎます" };

  const reed = input?.reed ?? null;
  return {
    doc: {
      ownerUid: String(input.uid),
      profileId: String(input.profileId),
      name,
      saxType: input.saxType,
      tuningHz: input.tuningHz,
      notes,
      noteKeys,
      sourceSessionCount: num(input?.sourceSessionCount) ? input.sourceSessionCount : 1,
      reedBrand: reed?.brand ? String(reed.brand) : null,
      // 使用日数(reedDays)は共有しない(2026-08-29 決定)。
      // 【理由を「画面から消したから」と書かないこと】開封後日数はアプリに現存する
      // (分析タブのピボット軸「開封後日数」・リード詳細の「開封 n日」)。消えていない。
      // 共有しない本当の理由は、**他人のリードの使用日数が比較の役に立たない**こと。
      // 目安は「その人の音がどうだったか」であり、リードの消耗は各自の吹き方と
      // 保管環境の関数なので、他人の日数を見ても自分の何も決まらない。
      // 一方で「◯月◯日に開けた箱を◯日使っている」は生活の粒度の情報であり、
      // 公開する値としては要らない。値が要らない以上、持たない。
      reedStrength: reed?.strength ? String(reed.strength) : null,
      updatedAt: now.toISOString(),
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/community/idealDoc.test.js`
Expected: PASS

- [ ] **Step 5: フルスイートを1回**

Run: `npm run test`
Expected: すべて PASS

- [ ] **Step 6: Commit**

```bash
git add src/community/idealDoc.js src/community/idealDoc.test.js
git commit -m "コミュニティ計画2: 公開する目安ドキュメントの組み立てを追加"
```

---

### Task 3: Firestore ルールに ideals を足す

**Files:**
- Modify: `firestore.rules`
- Modify: `src/community/profile.test.js`(同期テストの拡張)

**Interfaces:**
- Consumes: `buildIdealDoc` の11キー(Task 2)、`SAX_TYPES`(profile.js)
- Produces: `ideals/{docId}` の読み書き規則

**注意: `users` の既存の規則には一切触れない。**

- [ ] **Step 1: ルールを追記**

`firestore.rules` の `match /users/{uid} { ... }` ブロックの**直後**に、次を足す:

```
    // 公開された目安。1人が複数持てるので docId は uid とは別(`${uid}_${profileId}`)。
    // 【src/community/idealDoc.js の buildIdealDoc が作るキーの写し】
    // profile.js ↔ firestore.rules と同じく、片方だけ直すと本番の書き込みが全部失敗する。
    // 同期は src/community/profile.test.js の「firestore.rules との同期」で検査している。
    match /ideals/{docId} {
      // 【allow get: if true; にしない】目安ドキュメント自体は数値の塊だが、docId に
      // ownerUid が入っており「この uid は目安を公開している」が誰にでも分かってしまう。
      // 非公開にした人の目安まで単票で読めるのは、設計書 §5④ の
      // 「OFF にすると他の利用者から見えなくなる」に反する。
      // 所有者の users ドキュメントを引いて公開状態を確かめる。
      // (rules の get() は1件につき1 read を消費する。単票取得は一覧より桁が少ないので許容する。)
      allow get: if (request.auth != null && request.auth.uid == resource.data.ownerUid)
        || get(/databases/$(database)/documents/users/$(resource.data.ownerUid)).data.isPublic == true;

      // 【list は所有者の公開状態をサーバ側で見られない】上の get() は「返る1件ごと」に
      // 評価できるが、list の規則はクエリそのものに対して評価されるため、
      // resource.data.ownerUid を使った他コレクションの参照が書けない。
      // いま非公開の人の目安を一覧から落としているのは **クライアント側の joinOwners だけ**
      // であり、生SDKを叩く相手には効かない。**この穴は未解決**。
      // 末尾の**未決事項2**に代案を書いた。
      // limit 句は必須(下の users の項に理由を書いた)。
      allow list: if request.query.limit <= 50;

      allow create, update: if request.auth != null
        && request.auth.uid == request.resource.data.ownerUid
        && docId == request.auth.uid + "_" + request.resource.data.profileId
        && request.resource.data.keys().hasAll(['ownerUid','profileId','name','saxType','tuningHz','notes','noteKeys','sourceSessionCount','reedBrand','reedStrength','updatedAt'])
        && request.resource.data.keys().hasOnly(['ownerUid','profileId','name','saxType','tuningHz','notes','noteKeys','sourceSessionCount','reedBrand','reedStrength','updatedAt'])
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 120
        && request.resource.data.saxType in ['soprano','alto','tenor','baritone']
        && request.resource.data.tuningHz is number
        && request.resource.data.tuningHz >= 400
        && request.resource.data.tuningHz <= 500
        // ---- notes / noteKeys の中身 ----
        // 【`is map` / `is list` だけでは自由文字列の投入口になる】
        // Global Constraint に書いた「users と同じ厳格さ」を満たすため、書ける範囲を全部書く。
        // 1) 音名キーは半音インデックスの文字列。列挙で固定すれば**キー側の自由文字列は消える**。
        //    0〜47 はサックスの実音域(約2.5オクターブ=31音)に余裕を持たせた範囲。
        // 2) notes のキー集合と noteKeys を hasAll+hasOnly+要素数で完全一致させる。
        //    これで「noteKeys に載っていない音が notes に紛れる」経路が閉じる。
        // 3) 音の**数**の上限を notes 側にも掛ける(noteKeys だけ短く申告する抜けを塞ぐ)。
        && request.resource.data.noteKeys is list
        && request.resource.data.noteKeys.size() >= 3
        && request.resource.data.noteKeys.size() <= 40
        && request.resource.data.noteKeys.hasOnly([
             '0','1','2','3','4','5','6','7','8','9','10','11',
             '12','13','14','15','16','17','18','19','20','21','22','23',
             '24','25','26','27','28','29','30','31','32','33','34','35',
             '36','37','38','39','40','41','42','43','44','45','46','47'])
        && request.resource.data.notes is map
        && request.resource.data.notes.keys().hasAll(request.resource.data.noteKeys)
        && request.resource.data.notes.keys().hasOnly(request.resource.data.noteKeys)
        && request.resource.data.notes.keys().size() == request.resource.data.noteKeys.size()
        // 【ここから先は rules では書けない】各音の中身
        // (spectralCentroidHz / hnrDb / pitchCentsSigned / harmonics)が
        // **数値であること**は検査できない。rules に繰り返しが無く、map の値を1つずつ
        // 見るには 48通りのキーを明示的に展開するしかないためである。
        // いま値の型を保証しているのは `sanitizeNotes`(クライアント)だけ。
        // **サーバ側は「数値であること」を強制していない。** 代案は末尾の
        // 末尾の**未決事項3**に書いた。
        // ---- ここまで ----
        && request.resource.data.sourceSessionCount is int
        && request.resource.data.sourceSessionCount >= 1
        && request.resource.data.sourceSessionCount <= 10000
        && (request.resource.data.reedBrand == null || (request.resource.data.reedBrand is string && request.resource.data.reedBrand.size() <= 60))
        && (request.resource.data.reedStrength == null || (request.resource.data.reedStrength is string && request.resource.data.reedStrength.size() <= 20))
        && request.resource.data.updatedAt is string;
      allow delete: if request.auth != null && request.auth.uid == resource.data.ownerUid;
    }
```

さらに `users/{uid}` の `allow list: if false;` を次に差し替える(一覧に所有者の属性を出すのに要る):

```
      // 【条件が2つ要る。片方だけでは穴が開く】
      // (1) resource.data.isPublic == true
      //     **rules はフィルタではない。** 条件を書かずに list を開けると、
      //     クエリが返し得るドキュメントに非公開のものが混ざるため、非公開プロフィールが
      //     そのまま全世界に読める。設計書 §9.3 の「非公開でも他人に見えなくなるだけ」が崩れる。
      //     この条件を書くと、Firestore は**クエリの制約と規則を突き合わせ**、
      //     `where("isPublic","==",true)` を持たないクエリを実行前に拒否する。
      //     したがって**クエリ側にも同じ where を書かなければ動かない**(Task 4 で書く)。
      // (2) request.query.limit <= 50
      //     limit 句の無いクエリはコレクション全体を返し得るので拒否される。
      //     こちらも**クエリ側に limit() が必要**。
      // https://firebase.google.com/docs/firestore/security/rules-query
      allow list: if resource.data.isPublic == true && request.query.limit <= 50;
```

- [ ] **Step 2: 同期テストを拡張**

`src/community/profile.test.js` の「firestore.rules との同期」の describe に、次のテストを足す:

```js
  it("ideals のキー集合が buildIdealDoc の出力と一致する", async () => {
    const { buildIdealDoc } = await import("./idealDoc.js");
    const r = buildIdealDoc({
      uid: "u1", profileId: "p1", name: "テスト", saxType: "alto", tuningHz: 442,
      notes: { 0: { spectralCentroidHz: 1, hnrDb: 2 }, 1: { spectralCentroidHz: 1, hnrDb: 2 },
               2: { spectralCentroidHz: 1, hnrDb: 2 } },
      sourceSessionCount: 1, reed: null, performerIsSelf: true,
    });
    const keys = Object.keys(r.doc).sort();
    const listed = keys.map((k) => `'${k}'`).join(",");
    // rules 側は宣言順で書いてあるので、ソートして突き合わせる
    const m = rules.match(/hasAll\(\[([^\]]+)\]\)[\s\S]*?match \/ideals/);
    const inRules = (rules.split("match /ideals/{docId}")[1].match(/hasAll\(\[([^\]]+)\]\)/)[1])
      .split(",").map((s) => s.trim()).sort().join(",");
    expect(inRules).toBe(listed);
  });
```

- [ ] **Step 3: テストが通ることを確認**

Run: `npm run test`
Expected: すべて PASS。落ちる場合は**ルール側のキー一覧を直す**(コード側が正)

- [ ] **Step 4: Commit**

```bash
git add firestore.rules src/community/profile.test.js
git commit -m "コミュニティ計画2: Firestoreルールに ideals を追加"
```

- [ ] **Step 5: 人間にデプロイを依頼する**

`firestore.rules` の全文を提示し、Firebase コンソール → Firestore Database → ルール →
全消しして貼り付け → **「公開」を押す**ところまで依頼する。
**「公開」を押し忘れると変更が反映されない**(計画1で実際に起きた)。

---

### Task 4: 目安の公開・検索・取得の層

**Files:**
- Create: `src/community/idealRepo.js`

**Interfaces:**
- Consumes: `getFirebase()`(firebaseClient.js)、`buildIdealDoc`(Task 2)
- Produces:
  - `publishIdeal(uid, input): Promise<{ ok: true } | { error: string }>`
  - `unpublishIdeal(uid, profileId): Promise<void>`
  - `listMyIdeals(uid): Promise<object[]>`
  - `searchIdeals({ saxType, limit }): Promise<object[]>` — 自分の目安は除いて返す
  - `loadOwnerProfiles(uids): Promise<Map<string, object>>` — 一覧に属性を出すため。**公開プロフィールだけが返る**(非公開はサーバ側で落ちる)

**このタスクに単体テストは書かない。** Firebase SDK の薄い糊で、モックを組んでも
モックの挙動を確かめるだけになる。検証は Task 7 の実機確認で行う。

- [ ] **Step 1: 実装**

`src/community/idealRepo.js`:

```js
import { collection, doc, setDoc, deleteDoc, getDocs, query, where, limit as qLimit, documentId } from "firebase/firestore";
import { getFirebase } from "./firebaseClient.js";
import { buildIdealDoc } from "./idealDoc.js";

const idealId = (uid, profileId) => `${uid}_${profileId}`;

export async function publishIdeal(uid, input) {
  const built = buildIdealDoc({ ...input, uid });
  if (built.error) return { error: built.error };
  const { db } = getFirebase();
  await setDoc(doc(db, "ideals", idealId(uid, input.profileId)), built.doc);
  return { ok: true };
}

export async function unpublishIdeal(uid, profileId) {
  const { db } = getFirebase();
  await deleteDoc(doc(db, "ideals", idealId(uid, profileId)));
}

export async function listMyIdeals(uid) {
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, "ideals"), where("ownerUid", "==", uid), qLimit(50)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 楽器種別が同じものだけを引く。目安は同じ楽器種別としか比べられないため(設計書 §3)。
// 属性での絞り込みは、取得したあとクライアント側で行う(所有者の属性は users にあり、
// Firestore は別コレクションを跨いだ絞り込みができないため)。
export async function searchIdeals({ saxType, limit = 50 }) {
  const { db } = getFirebase();
  const snap = await getDocs(query(collection(db, "ideals"), where("saxType", "==", saxType), qLimit(limit)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// uid の配列から公開プロフィールをまとめて引く。documentId() の in は1度に30件までなので分割する。
//
// 【where("isPublic","==",true) と limit(CHUNK) は、どちらも省くとクエリごと拒否される】
// users の list 規則は `resource.data.isPublic == true && request.query.limit <= 50` である。
// **Firestore の規則はフィルタではない**ので、規則に書いた条件はクエリ側の制約と
// 突き合わされ、条件を満たすことがクエリの形から保証できないと**実行前に拒否**される。
//   ・isPublic の where が無い  → 非公開ドキュメントを返し得るクエリなので拒否
//   ・limit() が無い            → コレクション全体を返し得るクエリなので拒否
// どちらも「0件が返る」ではなく **permission-denied** になる。
// https://firebase.google.com/docs/firestore/security/rules-query
//
// limit の値は chunk の上限と同じ 30。`in` が最大30件なので返る件数は元々30以下であり、
// 30 を渡しても結果は変わらない。規則の上限 50 の内側でもある。
const OWNER_CHUNK = 30;

export async function loadOwnerProfiles(uids) {
  const { db } = getFirebase();
  const uniq = [...new Set(uids)].filter(Boolean);
  const out = new Map();
  for (let i = 0; i < uniq.length; i += OWNER_CHUNK) {
    const chunk = uniq.slice(i, i + OWNER_CHUNK);
    const snap = await getDocs(query(
      collection(db, "users"),
      where("isPublic", "==", true),
      where(documentId(), "in", chunk),
      qLimit(OWNER_CHUNK),
    ));
    snap.docs.forEach((d) => out.set(d.id, d.data()));
  }
  return out;
}
```

> **非公開の所有者はここで落ちる。** `joinOwners`(Task 5)の `owner.isPublic === true` は
> 二重の防壁として残す(サーバ側が正で、クライアント側は表示の保険)。片側だけ緩めない。
>
> **索引の確認が要る**: `isPublic` の等値 + `documentId()` の `in` という組み合わせは、
> 単一フィールド索引(`isPublic` 昇順 + `__name__`)で足りるはずだが、実地で
> `failed-precondition`(索引が要る)が返ることがある。返ったらコンソールが提示する
> 複合索引をそのまま作る。**Task 7 Step 5 の実機確認までは「通る」と書かないこと。**

- [ ] **Step 2: ビルドが通ることを確認**

Run: `npm run build`
Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
git add src/community/idealRepo.js
git commit -m "コミュニティ計画2: 目安の公開・検索・取得の層を追加"
```

---

### Task 5: 一覧の絞り込みと並べ替え(TDD)

**Files:**
- Create: `src/community/idealSearch.js`
- Test: `src/community/idealSearch.test.js`

**Interfaces:**
- Consumes: `commonNoteKeys`, `MIN_COMMON_NOTES`(Task 1)
- 注: `filterIdeals` は所有者の属性で絞る。所有者は `saxTypes`(配列)を持つが、
  目安側が単数 `saxType` を持ち Firestore の where で既に絞られているので、
  **この関数は楽器種別を見ない**
- Produces:
  - `EXPERIENCE_MIN = 1950`
  - `joinOwners(ideals, ownerMap): object[]` — 公開プロフィールを持たない所有者の目安は落とす
  - `filterIdeals(rows, criteria): object[]` — criteria: `{ positions, genres, ensembles, places, deviceClasses, startYearFrom, startYearTo }`
  - `sortByAdoption(rows): object[]`
  - `hasEnoughOverlap(myProfile, row): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`src/community/idealSearch.test.js`:

```js
import { describe, it, expect } from "vitest";
import { joinOwners, filterIdeals, sortByAdoption, hasEnoughOverlap } from "./idealSearch.js";

// 【これは users ドキュメント(所有者のプロフィール)であって、目安ドキュメントではない】
// したがって楽器種別は**複数形の saxTypes(配列)**、機材は**種別をキーにした gear map**。
// 単数の saxType や空の gear:{} を置くと、buildProfileDoc が実際に返す形と食い違い、
// このテストは「本番に存在しない形」を守るだけの検査になる。
const owner = (over) => ({
  nickname: "n", saxTypes: ["alto"], position: "学生", startYear: 2020,
  genres: ["クラシック"], ensembles: ["吹奏楽"], places: ["自宅"],
  gear: {
    alto: {
      instrumentBrand: "YAMAHA", instrumentModel: "YAS-62",
      mpBrand: "Selmer", mpModel: "S80 C*",
      ligBrand: null, ligModel: null,
    },
  },
  deviceClass: "ios", isPublic: true, ageConfirmed: true, updatedAt: "", ...over,
});
const ideal = (uid, over) => ({ id: uid + "_p", ownerUid: uid, adoptionCount: 0, ...over });

describe("joinOwners", () => {
  it("所有者の属性を行に合流させる", () => {
    const rows = joinOwners([ideal("a")], new Map([["a", owner()]]));
    expect(rows[0].owner.position).toBe("学生");
  });
  it("非公開の所有者の目安は落とす", () => {
    expect(joinOwners([ideal("a")], new Map([["a", owner({ isPublic: false })]]))).toHaveLength(0);
  });
  it("プロフィールが見つからない目安は落とす", () => {
    expect(joinOwners([ideal("a")], new Map())).toHaveLength(0);
  });
});

describe("filterIdeals", () => {
  const rows = joinOwners(
    [ideal("a"), ideal("b"), ideal("c")],
    new Map([
      ["a", owner({ position: "学生", startYear: 2020, genres: ["クラシック"] })],
      // POSITIONS に無い値(旧「音大生」等)を書かないこと。profile.js の POSITIONS が正。
      ["b", owner({ position: "学生（音大）", startYear: 2010, genres: ["ジャズ"] })],
      ["c", owner({ position: "社会人", startYear: 2000, genres: ["クラシック", "ジャズ"] })],
    ]));
  it("属性で絞る", () => {
    expect(filterIdeals(rows, { positions: ["学生（音大）"] }).map((r) => r.ownerUid)).toEqual(["b"]);
  });
  it("「学生」で絞っても「学生（音大）」は混ざらない(完全一致であることの確認)", () => {
    expect(filterIdeals(rows, { positions: ["学生"] }).map((r) => r.ownerUid)).toEqual(["a"]);
  });
  it("演奏開始年の範囲で絞る(上限と下限)", () => {
    expect(filterIdeals(rows, { startYearFrom: 2005, startYearTo: 2015 }).map((r) => r.ownerUid)).toEqual(["b"]);
  });
  it("ジャンルは1つでも重なれば残す", () => {
    expect(filterIdeals(rows, { genres: ["ジャズ"] }).map((r) => r.ownerUid)).toEqual(["b", "c"]);
  });
  it("条件が空なら全部返す", () => {
    expect(filterIdeals(rows, {})).toHaveLength(3);
  });
  it("複数の条件は AND で効く", () => {
    expect(filterIdeals(rows, { genres: ["クラシック"], positions: ["社会人"] }).map((r) => r.ownerUid)).toEqual(["c"]);
  });
});

describe("sortByAdoption", () => {
  it("採用数の多い順、同数なら新しい順", () => {
    const rows = [
      { id: "x", adoptionCount: 1, updatedAt: "2026-01-01" },
      { id: "y", adoptionCount: 5, updatedAt: "2026-01-01" },
      { id: "z", adoptionCount: 1, updatedAt: "2026-02-01" },
    ];
    expect(sortByAdoption(rows).map((r) => r.id)).toEqual(["y", "z", "x"]);
  });
});

describe("hasEnoughOverlap", () => {
  const mine = { notes: { 0: { spectralCentroidHz: 1, hnrDb: 1 }, 1: { spectralCentroidHz: 1, hnrDb: 1 }, 2: { spectralCentroidHz: 1, hnrDb: 1 } } };
  it("共通音が3以上なら true", () => {
    expect(hasEnoughOverlap(mine, { notes: mine.notes })).toBe(true);
  });
  it("共通音が2以下なら false", () => {
    expect(hasEnoughOverlap(mine, { notes: { 0: { spectralCentroidHz: 1, hnrDb: 1 }, 9: { spectralCentroidHz: 1, hnrDb: 1 } } })).toBe(false);
  });
  it("自分にデータが無ければ false", () => {
    expect(hasEnoughOverlap({ notes: {} }, { notes: mine.notes })).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/community/idealSearch.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/community/idealSearch.js`:

```js
import { commonNoteKeys, MIN_COMMON_NOTES, SHIFTED_METRICS } from "./align.js";

// 演奏開始年の下限。これより古い年は入力ミスとみなす。
export const EXPERIENCE_MIN = 1950;

// 目安の行に、所有者の公開プロフィールを合流させる。
// **非公開の人とプロフィールが引けない人の目安は落とす。** 目安ドキュメント自体は
// 誰でも読めるが、誰のものか分からないものを一覧に並べても選べないため。
export function joinOwners(ideals, ownerMap) {
  return (ideals ?? []).reduce((acc, row) => {
    const owner = ownerMap?.get?.(row.ownerUid);
    if (owner && owner.isPublic === true) acc.push({ ...row, owner });
    return acc;
  }, []);
}

const anyOf = (selected, values) =>
  !selected || selected.length === 0 || (values ?? []).some((v) => selected.includes(v));

export function filterIdeals(rows, criteria = {}) {
  const { positions, genres, ensembles, places, deviceClasses, startYearFrom, startYearTo } = criteria;
  return (rows ?? []).filter((r) => {
    const o = r.owner ?? {};
    if (!anyOf(positions, [o.position])) return false;
    if (!anyOf(genres, o.genres)) return false;
    if (!anyOf(ensembles, o.ensembles)) return false;
    if (!anyOf(places, o.places)) return false;
    if (!anyOf(deviceClasses, [o.deviceClass])) return false;
    if (typeof startYearFrom === "number" && !(o.startYear >= startYearFrom)) return false;
    if (typeof startYearTo === "number" && !(o.startYear <= startYearTo)) return false;
    return true;
  });
}

export function sortByAdoption(rows) {
  return (rows ?? []).slice().sort((a, b) =>
    (b.adoptionCount ?? 0) - (a.adoptionCount ?? 0) ||
    String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

// 平行移動の基準が立つだけ音が重なっているか。足りない相手は一覧に出さない(設計書 §3.3)。
export function hasEnoughOverlap(myProfile, row) {
  return SHIFTED_METRICS.every(
    (m) => commonNoteKeys(myProfile, row, m).length >= MIN_COMMON_NOTES);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/community/idealSearch.test.js`
Expected: PASS

- [ ] **Step 5: フルスイートを1回**

Run: `npm run test`
Expected: すべて PASS

- [ ] **Step 6: Commit**

```bash
git add src/community/idealSearch.js src/community/idealSearch.test.js
git commit -m "コミュニティ計画2: 目安一覧の絞り込みと並べ替えを追加"
```

---

### Task 6: 取り込んだ目安をローカルへ保存する形(TDD)

**Files:**
- Create: `src/community/importIdeal.js`
- Test: `src/community/importIdeal.test.js`

**Interfaces:**
- Consumes: `alignProfile`(Task 1)
- Produces:
  - `buildImportedProfile(myProfile, row, now?): { profile } | { error }`
    返す `profile` は**既存の理想値プロファイルと同じ構造**:
    `{ id, name, saxType, recordedAt, notes, sourceKind: "community", sourceSessionIds: [], communityMeta }`
  - `importedName(row, now?): string`

**重要: 相手の名前は残さない(匿名化)。** 設計書の決定事項。

- [ ] **Step 1: 失敗するテストを書く**

`src/community/importIdeal.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildImportedProfile, importedName } from "./importIdeal.js";

const note = (c, h) => ({ spectralCentroidHz: c, hnrDb: h, pitchCentsSigned: 0, harmonics: [1, .5] });
const mine = { notes: { 0: note(1200, 10), 2: note(1600, 12), 4: note(2000, 14) } };
const row = {
  id: "u2_p1", ownerUid: "u2", saxType: "alto", tuningHz: 442,
  notes: { 0: note(1800, 16), 2: note(2100, 17), 4: note(2600, 20) },
  owner: { nickname: "まつり", position: "学生", startYear: 2023 },
};

describe("importedName", () => {
  it("相手の名前を含めない", () => {
    const n = importedName(row, new Date("2026-08-28"));
    expect(n).not.toContain("まつり");
    expect(n).toContain("学生");
    expect(n).toContain("2026");
  });
});

describe("buildImportedProfile", () => {
  it("既存のプロファイルと同じ構造を返す", () => {
    const r = buildImportedProfile(mine, row, new Date("2026-08-28T00:00:00Z"));
    expect(r.profile.saxType).toBe("alto");
    expect(typeof r.profile.id).toBe("string");
    expect(r.profile.notes["0"].spectralCentroidHz).toBe(1300); // 平行移動が効いている
    expect(r.profile.sourceKind).toBe("community");
    expect(Array.isArray(r.profile.sourceSessionIds)).toBe(true);
  });
  it("相手の識別子を残さない", () => {
    const json = JSON.stringify(buildImportedProfile(mine, row).profile);
    expect(json).not.toContain("まつり");
    expect(json).not.toContain("u2");
  });
  it("平行移動できない相手はエラーになる", () => {
    const few = { ...row, notes: { 0: note(1800, 16), 9: note(2100, 17) } };
    expect(buildImportedProfile(mine, few).error).toBeTruthy();
  });
  it("由来が分かる記録は残す", () => {
    const r = buildImportedProfile(mine, row, new Date("2026-08-28T00:00:00Z"));
    expect(r.profile.communityMeta.position).toBe("学生");
    expect(r.profile.communityMeta.shiftedBy.spectralCentroidHz).toBe(-500);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/community/importIdeal.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/community/importIdeal.js`:

```js
import { alignProfile } from "./align.js";

// 取り込んだ目安の名前。**相手のニックネームは入れない。**
// 相手がアカウントを削除した後も名前が手元に残るのを避けるため(設計書の決定事項)。
// 代わりに属性と取り込んだ日付で見分けられるようにする。
export function importedName(row, now = new Date()) {
  const pos = row?.owner?.position ?? "他の奏者";
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `取り込んだ目安（${pos}・${y}/${m}/${d}）`;
}

// ローカルに保存する形。**既存の理想値プロファイルと同じ構造**にすること。
// getNoteIdeal(profile, semitoneIndex) が notes[semitoneIndex] を引くので、
// ここが違うと計測タブが取り込んだ目安を読めなくなる。
export function buildImportedProfile(myProfile, row, now = new Date()) {
  const aligned = alignProfile(myProfile, row);
  if (aligned.error) return { error: aligned.error };
  return {
    profile: {
      id: `community-${now.getTime()}-${Math.floor((now.getTime() % 100000))}`,
      name: importedName(row, now),
      saxType: row.saxType,
      recordedAt: now.toISOString(),
      notes: aligned.notes,
      sourceKind: "community",
      // 由来セッションは存在しないので空。isSessionInIdeal() が
      // Array.isArray() で確かめる契約なので、undefined ではなく空配列にする。
      sourceSessionIds: [],
      // 何を取り込んだかの記録。**相手を特定できる値(ニックネーム・uid)は入れない。**
      communityMeta: {
        position: row?.owner?.position ?? null,
        startYear: row?.owner?.startYear ?? null,
        tuningHz: row?.tuningHz ?? null,
        shiftedBy: aligned.shiftedBy,
        importedAt: now.toISOString(),
      },
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/community/importIdeal.test.js`
Expected: PASS

- [ ] **Step 5: フルスイートを1回**

Run: `npm run test`
Expected: すべて PASS

- [ ] **Step 6: Commit**

```bash
git add src/community/importIdeal.js src/community/importIdeal.test.js
git commit -m "コミュニティ計画2: 取り込んだ目安の組み立てを追加"
```

---

### Task 7: 画面(子タブ・一覧・詳細・公開設定)と実機確認

**Files:**
- Create: `src/community/SearchIdealsView.jsx`
- Create: `src/community/IdealDetailView.jsx`
- Modify: `src/community/CommunityTab.jsx`

**Interfaces:**
- Consumes: Task 1〜6 のすべて、`loadProfile`/`getSignedInUid`(accountRepo.js)
- Produces: `CommunityTab` に子タブ **データ / 順位 / シェア / マイページ** の4つを持たせる
  (設計書 §5。「目安」という子タブは無い。目安をさがす画面は**データ**の中身)

**画面の作法は `design/community-tab-proposals.html` の 01・02 節に従う。**
地は `--c-sunk`、カードは角丸16px+`--shadow-card`、**行の区切り線は引かない**(1行=1枚の小カード)。

- [ ] **Step 1: 一覧画面を実装**

`src/community/SearchIdealsView.jsx`。上から順に:

1. 最上段に **ニックネーム検索**。特定の人を1人探す操作は、条件で母集団を狭める操作と目的が違うので、条件のどれよりも上に置く
2. **抽出条件のカード** — 「Alto × クラシック × 学生」と「◯人のデータ」を出すだけの表示。タップすると条件を選ぶ画面へ移る。ここでは選ばせない
3. **さらに絞り込む** の1行 — 抽出条件で設定していない条件だけ(編成 / 練習場所 / 演奏開始年の範囲。内部では `startYearFrom`/`startYearTo`)
4. **個人一覧** — 1行=1枚の小カード。アイコン・ニックネーム・属性・機材の小片3つ・採用数

読み込みの流れ:
```js
const uid = await getSignedInUid();
const me = uid ? await loadProfile(uid) : null;
// 見たい楽器種別は画面で選ぶ。既定は me.saxTypes[0]
const rows = await searchIdeals({ saxType: selectedSaxType });
const owners = await loadOwnerProfiles(rows.map((r) => r.ownerUid));
const joined = joinOwners(rows, owners).filter((r) => r.ownerUid !== uid);
const usable = joined.filter((r) => hasEnoughOverlap(myIdealProfile, r));
setList(sortByAdoption(filterIdeals(usable, criteria)));
```

`myIdealProfile` は**計測タブが持っている自分の目安**。`CommunityTab` は App.jsx から
それを受け取れないので、**props で渡す**。`CommunityTab` に `myIdeals` プロパティを足し、
Task 8(計画3以降)で App.jsx から渡すまでは `[]` を既定にする。
`myIdeals` が空のときは一覧を出さず、「まず自分の目安を作ってください」と案内する。

0件のときの文言: `条件に合う人がまだいません` ではなく、**外すと見つかる条件を示す**:
`いまの条件では見つかりません。「属性」を外すと ◯人 見つかります`(条件を1つずつ外して再計算する)

- [ ] **Step 2: 詳細画面を実装**

`src/community/IdealDetailView.jsx`。上から:

1. 相手の情報(ニックネーム・属性・歴・機材)
2. **音名ごとの折れ線** — **横軸に音名**(既存のグラフと同じ向き)。指標は音程 / 重心 / HNR をタブで切り替える。自分は実線(`--c-accent`)、
   相手は破線(`--c-ink-3`)。**破線は平行移動した後の値**。凡例に「自分」「(相手の名前)」
3. 説明文: `計測環境により値全体が一律にずれるため、揃えた状態で線の形で比較`
4. `目安に設定` ボタン

**解釈の文(「低いドが暗い」等)は置かない。** 設計書の決定事項。

取り込みの処理:
```js
const built = buildImportedProfile(myIdealProfile, row);
if (built.error) { setError(built.error); return; }
onImport(built.profile);   // 親が既存の idealProfiles へ追加する
```

- [ ] **Step 3: CommunityTab に子タブを足す**

既存の `phase === "profile"` の表示を **マイページ** 子タブに移し、**データ** 子タブを足す。子タブは **データ / 順位 / シェア / マイページ** の4つ(順位とシェアは計画3・4で中身を入れる)。Step 1 の `SearchIdealsView` は**データ**の中身として置く。

**抽出条件を選ぶ画面**(`SelectCohortView.jsx`)も作る。楽器種別 / ジャンル / 属性 の3軸を選ぶ。
楽器種別の選択肢は**自分の `saxTypes` に限らず4種すべて**(他の楽器の平均を見たい場合があるため)。
ジャンルと属性には「指定しない」を置く。
子タブの見た目は画面案の `.tabs`(文字タブ+選択中に下線)。
プロフィール未登録のときは子タブを出さず、これまでどおり参加・登録の画面を出す。

マイページに**公開設定**を足す:
- 自分の目安の一覧(`myIdeals` から)。各行にトグル
- ONにすると `publishIdeal(uid, {...})`、OFFで `unpublishIdeal(uid, profileId)`
- **`performer` が「自分」でない目安はトグルを出さない**(設計書 §7.3)。
  `myIdeals` の各要素に `performerIsSelf` を持たせて渡す前提にする

- [ ] **Step 4: ビルドとテスト**

Run: `npm run build`
Expected: エラーなし

Run: `npm run test`
Expected: すべて PASS

- [ ] **Step 5: 実機確認(Firestore ルールのデプロイ後)**

`npm run dev` でプレビューを開き、順に確認:

1. コミュニティタブに子タブ **データ / 順位 / シェア / マイページ** の4つが出る
2. マイページで自分の目安を公開ONにすると、Firebase コンソールの `ideals` に文書ができる
3. 文書の中身に **`volumeDb` が1つも含まれていない**(コンソールで確認)
4. データタブに自分以外の公開目安が並ぶ。**自分の目安は並ばない**
5. 属性・ジャンルのピルで絞り込むと件数が変わる
6. 0件になる条件を選ぶと、外すと見つかる条件が案内される
7. 1件タップ → 折れ線が2本出る。破線が実線の近くにある(平行移動が効いている証拠。
   **効いていないと破線が画面の端に寄る**)
8. 取り込む → 計測タブの目安一覧に「取り込んだ目安（…）」が増える
9. 取り込んだ目安を選ぶと、計測タブの比較が動く(破線と「目安: n」が出る)
10. **既存3タブの表示・動作が変わっていない**
11. **`loadOwnerProfiles` が拒否されないこと。** データタブを開いて一覧に属性(ニックネーム・
    属性タグ)が出れば通っている。**属性だけが空で目安の行は出る**という見え方をしたら、
    `users` の list が拒否されている(コンソールに `permission-denied` か
    `failed-precondition`)。前者なら where/limit の抜け、後者なら索引の未作成。
12. **非公開の人の目安が一覧に出ないこと。** 別アカウントで目安を公開 → その人の
    プロフィールを非公開に切り替える → こちらの一覧から消える(消えるのは
    `loadOwnerProfiles` が返さなくなるため)。
    **ただしこれはクライアント経由の確認にすぎない。** 生SDKからの直読みは
    末尾の**未決事項2**のとおり**塞げていない**。
    ここで「守られている」と書かないこと

- [ ] **Step 6: Commit**

```bash
git add src/community
git commit -m "コミュニティ計画2: 目安の検索・詳細・公開設定の画面を追加"
```

---

## Self-Review 結果

- **Spec coverage**: §3.2 指標ごとの扱い → Task 1(`SHIFTED_METRICS`/`COPIED_METRICS`)+ Task 2(`sanitizeNotes` が volumeDb を落とす)。§3.3 共通音名の中央値・3音未満は出さない → Task 1 + Task 5(`hasEnoughOverlap`)。§3.4 自分にデータが無い場合 → Task 1(`alignProfile` のエラー)+ Task 7 Step 1 の案内。§4.2 公開プロファイルの項目 → Task 2。§5① 絞り込みと一覧 → Task 5 + Task 7。§7.3 自分の演奏のみ公開 → Task 2(`performerIsSelf`)+ Task 7 Step 3。匿名化の決定 → Task 6。
- **本計画のスコープ外**: コホート平均(§4.3)は計画4。採用数(`adoptionCount`)を実際に書き込む処理は**集計が要るので計画3**。本計画では読むだけで、未設定なら0として扱う(`sortByAdoption` が `?? 0`)。**ただし「計画3でやる」で済む話ではない。**下の未決事項1を読むこと。
- **Placeholder scan**: TBD なし。Task 4 と Task 7 に単体テストを置かない理由を明示済み。
- **Type consistency**: `notes[key]` のキーは全タスクで文字列。`shiftedBy` のキーは `SHIFTED_METRICS` と同じ。`buildIdealDoc` の**11キー**と Task 3 のルールの一覧が一致(同期テストで固定)。なお同期テストは**両辺とも11要素**なので「数が合っていること」は守らない。数は Task 2 の `toHaveLength(11)` が手書きの期待値として押さえている。
- **既知の制約**: `searchIdeals` は最大50件を引いてクライアント側で絞る。公開目安が50件を超えると
  絞り込みの結果が偏る。**利用者が増えたら計画3の集計と合わせてサーバ側の絞り込みに移す**必要がある。
  この上限は Task 4 のコメントと Task 7 Step 5 の確認項目に反映済み。

---

## 未決事項(この計画では解いていない。着手前に決めること)

### 未決事項1: `adoptionCount` の置き場所が決まっていない

**何が起きているか。** 本計画は `adoptionCount` を**読む**(`sortByAdoption`、Task 5 の
テスト fixture、一覧カードの「◯票」)。一方 Task 3 の `ideals` の規則は
`keys().hasOnly([...11キー...])` で `adoptionCount` を**書き込み時に禁じている**。

読むだけなら矛盾しないように見えるが、しない。計画3が集計で `adoptionCount` を
書き込んだとして、**本人がクライアントから同じ目安を公開し直した瞬間に消える**。
`publishIdeal` は `setDoc`(全置換)で 11キーの文書を書くからである。しかも
`hasOnly` がある以上、クライアントは `adoptionCount` を書き戻すこともできない。
結果、票数は「誰かが公開し直すたびに 0 に戻る」振る舞いになる。
ランキング(設計書 §5②「目安採用数」)がこれに乗る以上、放置できない。

**着手前に、次のどれかを選ぶこと。どれも本計画では実装しない。**

- **案A: 採用数を別コレクションに出す。** `idealStats/{docId}` を作り、
  `{ adoptionCount, updatedAt }` だけを置く。書けるのは Cloud Functions だけ
  (`allow write: if false`、読みは誰でも)。`ideals` は 11キーのまま触らない。
  - 利点: `setDoc` の全置換と衝突しない。権限の切り分けが素直
  - 欠点: 一覧のたびに読み取りが倍になる。並べ替えのために2コレクションを突き合わせる
- **案B: `ideals` に `adoptionCount` を持たせ、クライアントは `updateDoc` で書く。**
  `hasOnly` に `adoptionCount` を足したうえで、規則で
  「`request.resource.data.adoptionCount == resource.data.adoptionCount`
  (= クライアントは既存値を変えられない)」を要求する。公開し直しは
  `setDoc(..., { merge: true })` ではなく、11キーを名指しする `updateDoc` にする。
  - 利点: 一覧の読み取りが1回で済む。`orderBy("adoptionCount")` がそのまま使える
  - 欠点: 新規作成時だけ `adoptionCount == 0` を許す分岐が要る。
    `publishIdeal` が全置換をやめるので、Task 4 の実装を書き換えることになる
- **案C: 採用の事実を `adoptions/{uid}_{idealId}` として1件1文書で持ち、
  数は集計側だけが持つ。** 目安ドキュメントには一切足さない。
  - 利点: 誰が何を採用したかが残るので、重複採用を弾ける。取り消しも自然
  - 欠点: 一覧の並べ替えに使うには結局どこかに数を持つ必要があり、案Aと合わせ技になる

**決まるまで、一覧の「◯票」は 0 固定で出さないこと**(常に 0 が並ぶ画面は嘘になる)。
未設定のあいだは票の表示自体を出さず、並べ替えは `updatedAt` の新しい順にしておく。

### 決定事項: 非公開に切り替えたら、その人の `ideals` を削除する(2026-09-02 裁定)

**何が問題だったか。** `users` の list は `resource.data.isPublic == true` で塞いだが、
`ideals` の list は同じ手で塞げない。list の規則はクエリに対して評価されるため、
返る1件ごとに所有者の `users` を `get()` することができないからである。
クライアントの `joinOwners` が落としているだけでは、生SDKを叩く相手に効かない。
**目安の中身は数値だが、`docId` から「この uid は目安を公開している」が漏れる。**

**採る解: 非公開にしたら `ideals` から消す。**

公開状態を持つ場所を `users` の1箇所に保ち、**そもそも読まれてはいけないものを置かない。**

- `setProfilePublic(uid, false)` を呼ぶときに、同じ人の `ideals` を
  `listMyIdeals(uid)` で引いて `unpublishIdeal` で全部消す
- 再公開しても目安は自動では戻らない。マイページの公開トグルの近くに
  「非公開にすると、公開中の目安も取り下げられます」と**事前に**書く
- **目安そのものはローカル(IndexedDB)にあるので失われない。** 消えるのは公開の写しだけで、
  再公開は同じ画面のトグルで済む

**なぜ他の案を採らなかったか。**

- **`ideals` に `ownerIsPublic` を持たせる案**: 公開状態が2箇所に散る。切り替えたときに
  全 `ideals` を書き換える処理が要り、取りこぼすと**「非公開にしたのに漏れ続ける」**という
  最悪の壊れ方をする。二重管理は必ずずれる
- **Cloud Functions の集約索引から引く案**: 設計として正しい方向だが、計画2は無料枠で
  完結させる約束(Global Constraints)なので、この計画には入らない。
  **利用者が増えて50件の頭打ち(下記「既知の制約」)が問題になった時点で、計画3の集計と
  一緒にこちらへ移す。** そのとき `ideals` の `list` は `allow list: if false` に戻す

**この決定で変わること**: `ideals` のキーは **11 のまま**(増やさない)。
Task 4 の `idealRepo.js` に「非公開化と同時に取り下げる」処理を足す。
Task 7 のマイページに事前の注意書きを足す。

### 未決事項3: `notes` の値の型がサーバ側で検査できない

Task 3 のとおり、`noteKeys` の列挙・`notes` とのキー集合の一致・音数の上限までは
規則で書けたが、**各音の中身(重心・HNR・音程・倍音構成)が数値であることは書けない**。
規則に繰り返しが無く、map の値を1つずつ見るには 48通りのキーを明示的に展開するしかない。
いま型を保証しているのは `sanitizeNotes`(クライアント)だけである。

- **案A: 計画5(モデレーション)の Cloud Functions で、書き込みトリガに型検査を載せる。**
  違反した文書はその場で削除する。規則は今のまま
  - 利点: 繰り返しが書ける。NGワードのサーバ側強制と同じ場所に置ける
  - 欠点: 書き込みが一度は成立する(事後削除)。計画5まで穴が開いたままになる
- **案B: 48通りのキーを規則に展開する。**
  `users` の `gear` を4種別ぶん展開したのと同じやり方
  - 利点: 追加の基盤が要らない。書き込み時点で弾ける
  - 欠点: 規則が数百行になる。半音インデックスの範囲を変えるたびに全部書き直す
- **案C: `notes` を「音名の配列 + 指標ごとの数値配列」の平置きに変える。**
  `noteKeys: ['0','2']`, `centroid: [1800,2100]`, `hnr: [...]` のように持つ
  - 利点: `is list` と `size()` の一致までは規則で書ける
  - 欠点: **要素が数値であることは結局書けない**(list の要素型を見る術が無い)ので、
    穴は狭まるだけで塞がらない。既存の `notes[semitoneIndex]` からの変換も増える

**現時点の被害の範囲**(判定不能ではなく、規則の文面から言えること): 文書全体は
Firestore の 1 MiB 上限と音数40の上限に収まる。値は画面で数値としてしか読まれないため
文字列が他人の画面に文言として出ることは無い(グラフが描けないだけ)。
**それでも自由文字列がサーバに保存できる状態であることは変わらない。**
設計書 §8.1 の「自由入力はニックネームだけ」は、この穴が開いている間は正確ではない。
