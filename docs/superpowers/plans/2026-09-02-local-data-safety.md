# 記録の保全（書き出し・読み戻し・保存の永続化）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 練習記録がブラウザの領域整理・アプリ削除・端末故障で黙って全損する状態をなくす。全データを1ファイルに書き出し、別端末や再インストール後に読み戻せるようにする。

**Architecture:** IndexedDB の内容をそのまま1つの JSON に直列化して保存し、読み戻しでは形式を検証してから書き戻す。**サーバ処理はゼロ**で、Firestore にも認証にも一切触らない。あわせて `navigator.storage.persist()` を要求し、ブラウザによる自動削除を防ぐ。既存の永続化層(`src/App.jsx` の `idbGet` / `idbSet` / `useSessionsStore`)の**上に載せるだけ**で、その内部には手を入れない。

**Tech Stack:** Vite 5 / React 18 / IndexedDB / vitest

**根拠:** `docs/superpowers/research/2026-09-01-improvement-proposals.md` §2-1。競合10アプリの調査で、星1〜2の最大要因は社交機能ではなく「記録が消えた・同期が失敗した」であり、これは調査で最も再現性の高い発見だった。

## Global Constraints

- **`src/App.jsx` の既存ロジックを変更しない。** 追加するのは import と、データタブ(または設定)への導線1箇所のみ
- **クラウドに一切触らない。** Firestore・Firebase Auth を import しない
- **音声は扱わない**(そもそも保存されていない)
- UI文言はすべて日本語
- 読み戻しは**破壊的操作**。必ず確認を挟み、既存データを黙って消さない
- コミュニティ機能とは独立。この計画だけで完結し、`src/community/` には触れない
- コミットは各タスク末尾で必ず行う

## なぜコミュニティより先にやるか

設計書 §6 は「匿名のままのユーザーは端末の変更・アプリ削除でアカウントが失われる」と自認しているが、**失われるのはアカウントだけではなくセッションの生データ全部**である。クラウドの写しには練習集計と目安しか上げておらず、フレーム列は上げていない(§9.3)。

Google/Apple 連携は代替にならない。**復元対象にセッション生データが含まれず、連携は任意なので大半の匿名ユーザーを救えない。**

コミュニティで他人に見られる状態を作ってから全損が起きると、被害の声も公開の場に出る。

---

### Task 1: 書き出しデータの組み立てと検証(TDD)

**Files:**
- Create: `src/backup/snapshot.js`
- Test: `src/backup/snapshot.test.js`

**Interfaces:**
- Produces:
  - `SNAPSHOT_FORMAT = "ficus-backup"` / `SNAPSHOT_VERSION = 1`
  - `buildSnapshot({ kv, sessions }, now?): object`
  - `validateSnapshot(parsed): { ok: true, data } | { error: string }`
  - `snapshotFileName(now?): string`

- [ ] **Step 1: 失敗するテストを書く**

`src/backup/snapshot.test.js`:

```js
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
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/backup/snapshot.test.js`
Expected: FAIL(モジュール未作成)

- [ ] **Step 3: 実装**

`src/backup/snapshot.js`:

```js
// 練習記録の書き出しと読み戻し。
//
// なぜ要るか: このアプリはローカル(IndexedDB)が正で、セッションの生データはクラウドに
// 上げていない。ブラウザの領域整理・アプリ削除・端末故障で、数か月分の練習履歴が
// 黙って全損する。競合10アプリの調査で、星1〜2の最大要因は社交機能ではなく
// 「記録が消えた」だった(docs/superpowers/research/2026-09-01-improvement-proposals.md §2-1)。
//
// クラウドには一切触らない。ファイル1つで完結させる。

export const SNAPSHOT_FORMAT = "ficus-backup";
// 形式を変えたら上げる。読み戻し側は「自分より新しい版」を拒否する
// (古いアプリで新しいファイルを開くと、知らないフィールドを黙って捨ててしまうため)。
export const SNAPSHOT_VERSION = 1;

export function buildSnapshot({ kv, sessions }, now = new Date()) {
  const list = Array.isArray(sessions) ? sessions : [];
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    exportedAt: now.toISOString(),
    // 読み戻しの確認画面で「何を戻そうとしているか」を人に見せるために数えておく。
    // ファイルを開かずに中身の規模が分かる。
    counts: {
      sessions: list.length,
      frames: list.reduce((n, s) => n + (Array.isArray(s?.frames) ? s.frames.length : 0), 0),
    },
    kv: kv ?? {},
    sessions: list,
  };
}

export function validateSnapshot(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "ファイルの形式が読み取れません" };
  }
  if (parsed.format !== SNAPSHOT_FORMAT) {
    return { error: "Ficus の書き出したファイルではありません" };
  }
  if (!Number.isInteger(parsed.version) || parsed.version > SNAPSHOT_VERSION) {
    return { error: "このファイルは新しいバージョンのアプリで作られています" };
  }
  if (!parsed.kv || typeof parsed.kv !== "object" || Array.isArray(parsed.kv)) {
    return { error: "ファイルの中身が壊れています" };
  }
  if (!Array.isArray(parsed.sessions)) {
    return { error: "ファイルの中身が壊れています" };
  }
  return { ok: true, data: parsed };
}

export function snapshotFileName(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `ficus-backup-${y}-${m}-${d}.json`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/backup/snapshot.test.js`
Expected: PASS

- [ ] **Step 5: フルスイートを1回**

Run: `npm run test`
Expected: 既存137件を含めて全て PASS

- [ ] **Step 6: Commit**

```bash
git add src/backup/snapshot.js src/backup/snapshot.test.js
git commit -m "記録の保全: 書き出しデータの組み立てと検証を追加"
```

---

### Task 2: IndexedDB の読み書きと保存の永続化

**Files:**
- Create: `src/backup/localStore.js`
- Modify: `src/App.jsx`(**export を足すだけ。既存ロジックは変えない**)

**Interfaces:**
- Produces:
  - `readAll(): Promise<{ kv, sessions }>`
  - `writeAll({ kv, sessions }): Promise<void>` — 既存を全消しして書き戻す
  - `requestPersistence(): Promise<"granted" | "denied" | "unsupported">`
  - `storageEstimate(): Promise<{ usageMB, quotaMB } | null>`

**このタスクに単体テストは書かない。** IndexedDB と `navigator.storage` の薄い糊で、モックを組んでもモックの挙動を確かめるだけになる。検証は Task 4 の実機確認で行う。

- [ ] **Step 1: App.jsx から永続化層を export する**

`src/App.jsx` の `IDB_NAME` / `IDB_STORE` / `SESSIONS_STORE` の定義と、`idbGet` / `idbSet` /
セッションの読み書き関数を**探し**、`src/backup/localStore.js` から使えるように `export` を付ける。
**関数の中身は1行も変えない。** `export` キーワードを足すだけ。

どの関数を export すべきかは実物を読んで判断すること。最低限、次ができる必要がある:
- kv ストアの全キーと値を読む
- sessions ストアの全レコードを読む
- 両ストアを空にして書き戻す

App.jsx に該当する関数が無ければ(全消しなど)、`localStore.js` 側で
`indexedDB.open(IDB_NAME, IDB_VERSION)` を直接呼んで実装してよい。その場合も
**DB名・ストア名・バージョンは App.jsx の定数を import して使う**(2箇所に書かない)。

- [ ] **Step 2: localStore.js を実装**

```js
// IndexedDB の中身をまるごと読み書きする。書き出し・読み戻しのためだけに使う。
// 通常のアプリの読み書きは App.jsx 側の usePersistedState / useSessionsStore が担う。
// **DB名・ストア名は App.jsx から import する。2箇所に書くと必ずずれる。**

// ... 実装は Step 1 で調べた形に合わせる

// ブラウザに「この保存領域を勝手に消さないでほしい」と申請する。
// Chrome は利用実績などから自動で判断し、Safari は7日間未使用で消す既定を持つ。
// 申請が通らなくても致命的ではないので、結果は表示に使うだけで処理は止めない。
export async function requestPersistence() {
  if (!navigator.storage?.persist) return "unsupported";
  try {
    if (await navigator.storage.persisted?.()) return "granted";
    return (await navigator.storage.persist()) ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usageMB: (usage ?? 0) / 1048576, quotaMB: (quota ?? 0) / 1048576 };
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: ビルドが通ることを確認**

Run: `npm run build`
Expected: エラーなし

- [ ] **Step 4: フルスイートを1回**

Run: `npm run test`
Expected: 全て PASS(既存テストが App.jsx の export 追加で壊れていないこと)

- [ ] **Step 5: Commit**

```bash
git add src/backup/localStore.js src/App.jsx
git commit -m "記録の保全: IndexedDB の一括読み書きと保存の永続化を追加"
```

---

### Task 3: 画面(書き出し・読み戻し・保存状態)

**Files:**
- Create: `src/backup/BackupPanel.jsx`
- Modify: `src/App.jsx`(**導線1箇所の追加のみ**)

**Interfaces:**
- Consumes: Task 1 の全て、Task 2 の全て
- Produces: `export default function BackupPanel()`

**画面の作法は既存のデータタブに合わせる。** `design/DESIGN-SYSTEM.md` の値だけを使い、
新しい色・角丸・影を発明しない。

- [ ] **Step 1: BackupPanel を実装**

構成(上から):

1. **保存状態** — `storageEstimate()` の結果を「◯◯ MB を使用中」と出す。
   `requestPersistence()` が `"denied"` のときだけ
   「このブラウザは空き容量が減ると記録を自動削除することがあります」と注意を出す。
   `"granted"` なら「この端末に保存されています」
2. **書き出し** — ボタン1つ。押すと `readAll()` → `buildSnapshot()` → JSON化 → ダウンロード。
   件数を添えて「1,204 回の計測を書き出します」のように出す
3. **読み戻し** — ファイル選択。選ぶと `validateSnapshot()` して、
   **確認を挟む**: 「このファイルには 1,204 回の計測が入っています。
   いまの記録(89 回)はすべて置き換わります。よろしいですか?」
   → OK で `writeAll()` → **画面を再読み込み**(React の state が古いままになるため)

ダウンロードの実装は `Blob` + `URL.createObjectURL` + `<a download>` のクリック。
**`URL.revokeObjectURL` を必ず呼ぶこと**(呼ばないとメモリに残る)。

- [ ] **Step 2: 導線を App.jsx に足す**

データタブ(または設定)に `BackupPanel` を出す。**既存の要素を消したり並べ替えたりしない。**
追加のみ。`React.lazy` は使わず、通常の import でよい(小さいため)。

- [ ] **Step 3: ビルドとテスト**

Run: `npm run build`
Expected: エラーなし

Run: `npm run test`
Expected: 全て PASS

- [ ] **Step 4: Commit**

```bash
git add src/backup/BackupPanel.jsx src/App.jsx
git commit -m "記録の保全: 書き出し・読み戻しの画面を追加"
```

---

### Task 4: 実機確認 — 完了(2026-09-02)

**Files:** なし(確認のみ)

ブラウザ枠が `computer` のクリックに応答しなかったため、**同じ経路を JavaScript から
呼んで**確認した。押す手段が違うだけで、通る道(`readAll` → `buildSnapshot` →
JSON → `validateSnapshot` → `writeAll`)は画面のボタンと同一。

- [x] **Step 1: 書き出しを確認**

検証用に kv 2件(`saxType=tenor` / リード1本)とセッション1件(フレーム2)を入れ、
`buildSnapshot(await readAll())` の中身を確認:

| 確認項目 | 結果 |
|---|---|
| ファイル名 | `ficus-backup-2026-09-02.json` |
| `counts` | `{sessions: 1, frames: 2}` |
| `kv` のキー数 | 18 |
| `kv.saxType` | `"tenor"` |
| `kv.reeds` | 投入したリードがそのまま |
| `sessions[0].frames` | 2件(**生データが入っている**) |
| JSON 往復後の `validateSnapshot` | 通過 |

- [x] **Step 2: 読み戻しを確認 — 全損から完全一致で戻った**

1. `indexedDB.deleteDatabase("windToneLabDB")` で**全損を再現**
2. 直後の `readAll()` → **kv 0 / セッション 0**(確かに全部消えた)
3. 書き出した JSON を `validateSnapshot` → `writeAll`
4. `readAll()` → **kv 18 / セッション 1**、`saxType` `reeds` フレーム数すべて復帰
5. 復元後をもう一度 `buildSnapshot` して**元の JSON と完全一致**(`kv`・`sessions` とも)

- [x] **Step 3: 壊れたファイルを弾くことを確認**

7種すべて拒否。**通ってしまったものは無し**、かつ**既存データは 18 キー / 1 セッションのまま無傷**。

| 与えたもの | 反応 |
|---|---|
| `{}` | Ficus の書き出したファイルではありません |
| 別アプリの `format` | Ficus の書き出したファイルではありません |
| `version: 99` | このファイルは新しいバージョンのアプリで作られています |
| `sessions` が文字列 | ファイルの中身が壊れています |
| `kv` が null | ファイルの中身が壊れています |
| 文字列 / `null` | ファイルの形式が読み取れません |
| 正しいファイル | **通過**(弾きすぎていない) |

- [x] **Step 4: 保存の永続化を確認**

この環境では `persisted()` が false。計画どおり**画面に注意が出ている**ことを確認した:
「`0.1 MB を使用中 · このブラウザは空き容量が減ると記録を自動削除することがあります`」。
false 自体は異常ではない(申請が通るかはブラウザ次第)。**黙って false になっていないこと**が要点。

- [x] **Step 5: 既存機能が壊れていないことを確認**

4つのタブ(計測 / リード / データ / コミュニティ)を一巡し、すべて描画された。
コンソールのエラーは 0件。`npx vitest run` 145件 PASS / `node scripts/pitch-test.mjs` 7231 PASS・0 FAIL。

- [x] **Step 6: Commit**

**残した確認(この環境では手が届かない)**

ブラウザ自身が出す**保存ダイアログとファイル選択ダイアログ**は自動では操作できないため、
「ダウンロードが実際に始まるか」「選んだファイルが `FileReader` で読めるか」は未確認。
中身の組み立てと解釈は上記のとおり検証済みなので、残るのはブラウザ標準の受け渡し部分のみ。
**次に実機で触るとき、まずここを確認すること。**

---

## Self-Review 結果

- **根拠との対応**: 提案 §2-1 の (a) 書き出し/読み戻し → Task 1・3、(b) `storage.persist()` → Task 2・3。
- **App.jsx への影響**: Task 2 で export を足す(中身は変えない)、Task 3 で導線を1箇所足す。
  デザイン改修中の別セッションと衝突しうるが、いずれも追加のみで既存行を書き換えない。
- **Placeholder scan**: Task 2 Step 1 は「実物を読んで判断する」と書いてあり具体的な関数名が無いが、
  これは App.jsx の現在の形が読む時点で変わっている可能性があるため意図的にそうしている。
  代わりに「何ができる必要があるか」を3点で明示し、無い場合の代替(直接 open する)も書いた。
- **やらないこと**: クラウド同期・自動バックアップ・差分マージは含めない。
  読み戻しは全置換のみ(マージの実装を持たない、という §6 の既存方針と揃える)。
