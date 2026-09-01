# コミュニティ機能 計画1: 認証とプロフィール基盤 Implementation Plan

> **この計画は実行済み(2026-08-28 完了)。記録として残す。再実行してはならない。**
> チェックボックスは当時の進行管理の跡であって、これから踏む手順ではない。
> 本文のコードは**実装後に現物へ合わせて直してある**(2026-09-02 追随)。それでも
> **値の唯一の答えは `src/community/` の現物と `firestore.rules`** であって、この文書ではない。
> 食い違いを見つけたら現物を正として扱い、この文書を直すこと(逆をしない)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4つ目のタブ「コミュニティ」の骨格を作り、匿名認証でアカウントを作成し、プロフィール(ニックネーム+プルダウン属性+機材)を登録・公開・削除できる状態にする。

**Architecture:** Firebase(Anonymous Auth + Firestore)をクライアントから直接使う。コミュニティ関連コードはすべて新規ディレクトリ `src/community/` に置き、既存の `src/App.jsx` への変更は「4つ目のタブの配線」だけに限定する(別セッションでデザイン改修中のため)。NGワード検証・プロフィール検証は純粋関数として切り出し、vitest でTDDする。

**Tech Stack:** React 18 / Vite 5 / firebase (npm) / vitest

**Spec:** `docs/superpowers/specs/2026-08-27-community-tab-design.md`(§4.1 プロフィール、§6 認証、§7 プライバシー、§8.1 NGワード)

## Global Constraints

- UI文言はすべて日本語
- 自由入力は「ニックネーム」のみ。他はすべて選択式(spec §4.1)
- 収集しない: 本名・生年月日・学校名(spec §7)。年齢は「13歳以上です」チェックのみ
- `src/App.jsx` への変更は4箇所(import / lazy とエラー境界 / レンダ分岐 / BottomNav の項目)。**既存タブの見た目・ロジックに一切触れない**(spec §10)
- Cloud Functions は使わない(この計画は無料 Spark プランで完結。NGワードのサーバ側強制は後続計画のモデレーション実装で行う。それまでの防壁はクライアント検証+Firestoreルールの形式チェック)
- ローカル(IndexedDB)が正。クラウドは公開用の写し(spec §9.3)。この計画でクラウドに書くのはプロフィールのみ
- コミットは各タスク末尾で必ず行う

## この計画に含まれないもの(後続計画)

計画2: 目安プロファイルの公開・検索・取り込み(平行移動の実装) / 計画3: 練習集計とランキング(Blaze移行・Cloud Functions) / 計画4: 機材シェア・コホート平均 / 計画5: モデレーション(通報・自動非公開・BAN・サーバ側NG検証)・法務文書 / 計画6: Google/Apple引き継ぎ連携・Capacitor・ストア提出

---

### Task 0: Firebase プロジェクト作成と SDK 導入

**Files:**
- Create: `.env.local`(gitignore 済みか確認して追記)
- Modify: `package.json`(依存追加)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `import.meta.env.VITE_FIREBASE_*` 環境変数群。後続タスクの `firebaseClient.js` が読む

**このタスクの前半はユーザー(人間)の操作が必要。** エージェントは手順を提示して完了を待つこと。

- [ ] **Step 1: ユーザーに Firebase コンソール操作を依頼する**

以下を依頼する:
1. https://console.firebase.google.com で新規プロジェクト作成(名前例: `ficus-community`。Google アナリティクスは無効でよい)
2. 「ウェブアプリを追加」(</> アイコン)→ 表示される `firebaseConfig`(apiKey, authDomain, projectId, appId)を控える
3. Authentication → Sign-in method → **「匿名」を有効化**
4. Firestore Database → データベースを作成 → **本番モード**(ロックダウン)→ ロケーション `asia-northeast1`
5. 控えた4値をこのセッションに貼ってもらう(Firebase の Web 用 apiKey は秘密情報ではなく、公開されても Firestore ルールが防壁になる)

- [ ] **Step 2: SDK と vitest をインストール**

```bash
npm install firebase
npm install -D vitest
```

- [ ] **Step 3: 環境変数ファイルを作成**

`.env.local`(値はユーザーから受け取ったもの):

```
VITE_FIREBASE_API_KEY=xxxx
VITE_FIREBASE_AUTH_DOMAIN=xxxx.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=xxxx
VITE_FIREBASE_APP_ID=1:xxxx:web:xxxx
```

`.gitignore` に `.env.local` が無ければ追記。さらに `package.json` の scripts に `"test": "vitest run"` を追加。

- [ ] **Step 4: 動作確認**

```bash
npm run test -- --version 2>$null; npx vitest --version
npm run dev
```

Expected: vitest のバージョンが表示される。dev サーバが従来どおり起動し、既存アプリが壊れていない。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "コミュニティ計画1: firebase と vitest を導入"
```

---

### Task 1: 文字正規化モジュール(TDD)

**Files:**
- Create: `src/community/ngwords/normalize.js`
- Test: `src/community/ngwords/normalize.test.js`

**Interfaces:**
- Produces: `normalizeForFilter(input: string): string` — NFKC正規化・小文字化・カタカナ→ひらがな・leet変換を適用した照合用文字列。`compactForFilter(input: string): string` — さらに区切り文字(空白・`._-` ・長音)を除去したもの

- [ ] **Step 1: 失敗するテストを書く**

`src/community/ngwords/normalize.test.js`:

```js
import { describe, it, expect } from "vitest";
import { normalizeForFilter, compactForFilter } from "./normalize.js";

describe("normalizeForFilter", () => {
  it("全角英数を半角小文字にする", () => {
    expect(normalizeForFilter("ＡＢＣ１２３")).toBe("abc123");
  });
  it("カタカナをひらがなにする", () => {
    expect(normalizeForFilter("サックス")).toBe("さつくす".replace("つ", "っ")); // "さっくす"
  });
  it("leet表記を戻す(照合用)", () => {
    expect(normalizeForFilter("s3x")).toBe("sex");
    expect(normalizeForFilter("@ss")).toBe("ass");
  });
  it("nullや数値でも落ちない", () => {
    expect(normalizeForFilter(null)).toBe("");
    expect(normalizeForFilter(123)).toBe("123".replace("1","i").replace("3","e")); // leet適用後 "ize"
  });
});

describe("compactForFilter", () => {
  it("区切り文字を除去して連結語を照合可能にする", () => {
    expect(compactForFilter("s.e-x")).toBe("sex");
    expect(compactForFilter("ば か")).toBe("ばか");
  });
});
```

注: leet 変換はニックネームの表示値には適用しない(照合用コピーのみ)。`123` が `ize` になるのは照合用として意図どおり。

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/community/ngwords/normalize.test.js`
Expected: FAIL(モジュール未作成)

- [ ] **Step 3: 実装**

`src/community/ngwords/normalize.js`:

```js
// ニックネームのNGワード照合用の正規化。表示値には使わない(照合コピー専用)。
// 方針は docs/superpowers/research/2026-08-27-ngword-filter.md 参照。
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s" };

export function normalizeForFilter(input) {
  let s = String(input ?? "");
  s = s.normalize("NFKC").toLowerCase();
  // カタカナ→ひらがな(U+30A1..U+30F6 を -0x60)
  s = s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  s = s.replace(/[013457 8@$]/g, (ch) => LEET[ch] ?? ch);
  return s;
}

export function compactForFilter(input) {
  return normalizeForFilter(input).replace(/[\s._\-ー・]/g, "");
}
```

注意: `LEET` の正規表現 `[013457 8@$]` に空白が紛れないよう `[0134578@$]` と書くこと(上の枠は誤植の見本。実装は `/[0134578@$]/g`)。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/community/ngwords/normalize.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/community/ngwords
git commit -m "コミュニティ計画1: NG照合用の文字正規化を追加"
```

---

### Task 2: NGワードリストの取得スクリプトと生成データ

**Files:**
- Create: `scripts/fetch-ngwords.mjs`
- Create: `src/community/ngwords/generated/ja.json`(スクリプトが生成)
- Create: `src/community/ngwords/generated/en.json`(スクリプトが生成)

**Interfaces:**
- Produces: `ja.json` = `{ "source": "...", "license": "MIT", "words": string[] }` / `en.json` = `{ "source": "...", "license": "MIT", "entries": [{ "words": string[], "exceptions": string[] }] }`

- [ ] **Step 1: 取得スクリプトを書く**

`scripts/fetch-ngwords.mjs`:

```js
// NGワードリストを取得して照合用JSONを生成する。実行: node scripts/fetch-ngwords.mjs
// 出典(いずれもMIT): MosasoM/inappropriate-words-ja, dsojevic/profanity-list
import { writeFileSync, mkdirSync } from "node:fs";

const JA_URLS = [
  "https://raw.githubusercontent.com/MosasoM/inappropriate-words-ja/master/Sexual.txt",
  "https://raw.githubusercontent.com/MosasoM/inappropriate-words-ja/master/Offensive.txt",
];
const EN_URL = "https://raw.githubusercontent.com/dsojevic/profanity-list/main/en.json";

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`); // 404ならリポジトリ構成が変わっている。GitHubでファイル名を確認して直すこと
  return res.text();
}

const jaWords = new Set();
for (const url of JA_URLS) {
  for (const line of (await fetchText(url)).split(/\r?\n/)) {
    const w = line.trim();
    if (w && !w.startsWith("#")) jaWords.add(w);
  }
}

const enRaw = JSON.parse(await fetchText(EN_URL));
// 形式: [{ match: "word|w0rd", exceptions?: [...] , severity, ... }] を想定。
// 想定と違う場合は console.log(enRaw[0]) で実物を見て合わせること。
const enEntries = enRaw.map((e) => ({
  words: String(e.match ?? "").split("|").map((s) => s.trim()).filter(Boolean),
  exceptions: (e.exceptions ?? []).map((s) => String(s).trim()).filter(Boolean),
})).filter((e) => e.words.length > 0);

mkdirSync("src/community/ngwords/generated", { recursive: true });
writeFileSync("src/community/ngwords/generated/ja.json",
  JSON.stringify({ source: "MosasoM/inappropriate-words-ja", license: "MIT", words: [...jaWords] }, null, 1));
writeFileSync("src/community/ngwords/generated/en.json",
  JSON.stringify({ source: "dsojevic/profanity-list", license: "MIT", entries: enEntries }, null, 1));
console.log(`ja: ${jaWords.size} words / en: ${enEntries.length} entries`);
```

- [ ] **Step 2: 実行して生成する**

Run: `node scripts/fetch-ngwords.mjs`
Expected: `ja: 300前後 words / en: 400前後 entries` と表示され、`generated/` に2ファイルできる。404 が出たら該当リポジトリをブラウザで開いて実ファイル名に直す。

- [ ] **Step 3: 中身を目視確認**

`ja.json` の先頭20語程度を読み、明らかな中立語(誤爆しそうな一般語)が混ざっていないか確認。混ざっていれば `EXCLUDE` 配列をスクリプトに足して除外し再生成。

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-ngwords.mjs src/community/ngwords/generated
git commit -m "コミュニティ計画1: NGワードリストの取得スクリプトと生成データ"
```

---

### Task 3: NGワード判定(TDD)

**Files:**
- Create: `src/community/ngwords/filter.js`
- Test: `src/community/ngwords/filter.test.js`

**Interfaces:**
- Consumes: `normalizeForFilter` / `compactForFilter`(Task 1)、`ja.json` / `en.json`(Task 2)
- Produces: `findNgWord(nickname: string): string | null` — 引っかかった語を返す(なければ null)。UIとバリデーションはこれだけを呼ぶ

- [ ] **Step 1: 失敗するテストを書く**

`src/community/ngwords/filter.test.js`:

```js
import { describe, it, expect } from "vitest";
import { findNgWord } from "./filter.js";

describe("findNgWord", () => {
  it("普通のニックネームは通す", () => {
    expect(findNgWord("さっくす太郎")).toBeNull();
    expect(findNgWord("AltoLove442")).toBeNull();
  });
  it("英語の不適切語を部分一致で弾く", () => {
    expect(findNgWord("xxfuckxx")).not.toBeNull();
  });
  it("leetや区切りで偽装しても弾く", () => {
    expect(findNgWord("f-u-c-k")).not.toBeNull();
    expect(findNgWord("fuck".replace("u", "u"))).not.toBeNull();
  });
  it("日本語の不適切語を弾く(リスト先頭の実語で確認)", async () => {
    const ja = (await import("./generated/ja.json")).default;
    expect(findNgWord(`前後${ja.words[0]}前後`)).toBe(ja.words[0]);
  });
  it("例外リスト(Scunthorpe対策)を尊重する", async () => {
    const en = (await import("./generated/en.json")).default;
    const withEx = en.entries.find((e) => e.exceptions.length > 0);
    if (withEx) expect(findNgWord(withEx.exceptions[0])).toBeNull();
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/community/ngwords/filter.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/community/ngwords/filter.js`:

```js
import { normalizeForFilter, compactForFilter } from "./normalize.js";
import ja from "./generated/ja.json";
import en from "./generated/en.json";

// 起動時に一度だけ照合用に正規化しておく(リスト側も同じ正規化を通すことが重要)
const JA_WORDS = ja.words.map((w) => compactForFilter(w)).filter((w) => w.length >= 2);
const EN_ENTRIES = en.entries.map((e) => ({
  words: e.words.map((w) => compactForFilter(w)).filter((w) => w.length >= 3),
  exceptions: e.exceptions.map((w) => compactForFilter(w)),
}));

export function findNgWord(nickname) {
  const norm = normalizeForFilter(nickname);
  const compact = compactForFilter(nickname);
  for (const w of JA_WORDS) {
    if (compact.includes(w)) return w;
  }
  for (const e of EN_ENTRIES) {
    const hit = e.words.find((w) => compact.includes(w));
    if (!hit) continue;
    if (e.exceptions.some((ex) => norm.includes(ex) || compact.includes(ex))) continue;
    return hit;
  }
  return null;
}
```

短すぎる語(ja 2文字未満 / en 3文字未満)は誤爆源なので照合から外している。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/community/ngwords/filter.test.js`
Expected: PASS。落ちる場合、リスト由来の想定違い(形式・語形)はテストではなく変換側(Task 2 スクリプトか本タスクの正規化)を直す。

- [ ] **Step 5: Commit**

```bash
git add src/community/ngwords
git commit -m "コミュニティ計画1: NGワード判定を追加"
```

---

### Task 4: 機材カタログと部分一致検索(TDD)

**Files:**
- Create: `src/community/catalog/gear.js`
- Test: `src/community/catalog/gear.test.js`

**Interfaces:**
- Produces:
  - `INSTRUMENT_CATALOG: { [brand: string]: { [saxType: string]: string[] } }`
  - `MOUTHPIECE_CATALOG: { [brand: string]: { models: string[], facings?: string[] } }`
  - `OTHER_BRAND = "その他"` 定数
  - `searchInstrumentModels(query: string, saxType: string): { brand: string, model: string }[]`
  - `searchMouthpieces(query: string): { brand: string, model: string }[]`
  - `isValidInstrument(brand, model, saxType): boolean` / `isValidMouthpiece(brand, model): boolean` / `isValidLigature(brand, model): boolean`(`その他` は model=null のみ許可)

> ここでの `saxType`(単数)は**カタログ照合の引数**であって、プロフィールの項目名ではない。
> カタログは楽器種別ごとに分かれており(Alto の YAS-62 は Tenor には無い)、1回の照合は
> 必ず1種別に対して行う。プロフィール側の項目は複数形の `saxTypes`(配列)で、
> 呼び出し側が種別ごとにこの関数を回す。混同しないこと。
>
> リガチャーのカタログ(`isValidLigature` / `LIGATURE_CATALOG`)は本計画の起草より後に
> 足した。出典は `docs/superpowers/research/2026-08-29-ligature-catalog.md`。

- [ ] **Step 1: 失敗するテストを書く**

`src/community/catalog/gear.test.js`:

```js
import { describe, it, expect } from "vitest";
import { searchInstrumentModels, searchMouthpieces, isValidInstrument, isValidMouthpiece, OTHER_BRAND } from "./gear.js";

describe("searchInstrumentModels", () => {
  it("部分一致・大文字小文字無視で引ける", () => {
    const hits = searchInstrumentModels("yas-8", "alto");
    expect(hits.some((h) => h.brand === "YAMAHA" && h.model === "YAS-875EX")).toBe(true);
  });
  it("楽器種別で絞られる", () => {
    expect(searchInstrumentModels("YTS", "alto")).toHaveLength(0);
  });
  it("全角入力でも引ける", () => {
    expect(searchInstrumentModels("ｙａｓ６２", "alto").length).toBeGreaterThan(0);
  });
});

describe("searchMouthpieces", () => {
  it("ブランド名でもモデル名でも引ける", () => {
    expect(searchMouthpieces("meyer").length).toBeGreaterThan(0);
    expect(searchMouthpieces("S90").some((h) => h.brand === "Selmer")).toBe(true);
  });
});

describe("validation", () => {
  it("カタログに実在する組だけ valid", () => {
    expect(isValidInstrument("YAMAHA", "YAS-62", "alto")).toBe(true);
    expect(isValidInstrument("YAMAHA", "存在しない", "alto")).toBe(false);
    expect(isValidInstrument(OTHER_BRAND, null, "alto")).toBe(true);
    expect(isValidInstrument(OTHER_BRAND, "自由入力", "alto")).toBe(false);
    expect(isValidMouthpiece("Meyer", "6M")).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/community/catalog/gear.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/community/catalog/gear.js` — カタログの中身は `docs/superpowers/research/2026-08-27-gear-catalog.md` の表から**確認記号◎○の型番を全て転記する**(△は除外)。下は構造を示す抜粋。検索の正規化には `yas６２`→`yas62` のためNFKC+小文字化を使う(ハイフン除去も行う):

```js
export const OTHER_BRAND = "その他";

export const INSTRUMENT_CATALOG = {
  "YAMAHA": {
    soprano: ["YSS-475", "YSS-875EX"],
    alto: ["YAS-280", "YAS-380", "YAS-480", "YAS-62", "YAS-82Z", "YAS-875", "YAS-875EX"],
    tenor: ["YTS-280", "YTS-380", "YTS-480", "YTS-62", "YTS-82Z", "YTS-875EX"],
    baritone: ["YBS-62"],
  },
  "Selmer Paris": {
    alto: ["Axos", "Signature", "Supreme", "Series II (SA80II)", "Series III", "Reference 54"],
    tenor: ["Axos", "Signature", "Supreme", "Series II (SA80II)", "Series III", "Reference 36", "Reference 54"],
    soprano: ["Series II (SA80II)", "Series III"],
    baritone: ["Series II (SA80II)", "Series III"],
  },
  "Yanagisawa": { /* research md から転記 */ },
  "Cannonball": { /* 同上 */ },
  "P. Mauriat": { /* 同上 */ },
  "Keilwerth": { /* 同上 */ },
  "Jupiter": { /* 同上 */ },
  "Antigua": { /* 同上 */ },
};

export const MOUTHPIECE_CATALOG = {
  "Selmer": { models: ["S80 C*", "S80 C**", "S80 D", "S80 E", "S90 170", "S90 180", "S90 190", "S90 200", "Concept", "Soloist"] },
  "Vandoren": { models: ["Optimum AL3", "Optimum AL4", "Optimum AL5", "V5 A15", "V5 A17", "V5 A20", "V5 A25", "V5 A27", "V5 A28", "V16 A5M", "V16 A6M", "V16 A7M", "Java T45", "Java T55", "Java T75", "V16 T7", "V16 T8"] },
  "Meyer": { models: ["5M", "6M", "7M", "8M"] },
  "Otto Link": { models: ["Tone Edge 5*", "Tone Edge 6*", "Tone Edge 7*", "Super Tone Master 6*", "Super Tone Master 7*", "Super Tone Master 8*"] },
  "JodyJazz": { models: ["HR* 5", "HR* 6", "HR* 7", "DV 6", "DV 7", "JET 6", "JET 7"] },
  "D'Addario": { models: ["Select Jazz D5M", "Select Jazz D6M", "Select Jazz D7M", "Reserve AS10E", "Reserve AS15E"] },
  "Yamaha": { models: ["4C", "5C", "6C", "Custom 5CM"] },
  /* Dukoff, Guardala, Claude Lakey, Beechler, Theo Wanne … research md から転記 */
};

const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[\s\-]/g, "");

export function searchInstrumentModels(query, saxType) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  for (const [brand, byType] of Object.entries(INSTRUMENT_CATALOG)) {
    for (const model of byType[saxType] ?? []) {
      if (norm(model).includes(q) || norm(brand).includes(q)) out.push({ brand, model });
    }
  }
  return out;
}

export function searchMouthpieces(query) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  for (const [brand, { models }] of Object.entries(MOUTHPIECE_CATALOG)) {
    for (const model of models) {
      if (norm(model).includes(q) || norm(brand).includes(q)) out.push({ brand, model });
    }
  }
  return out;
}

export function isValidInstrument(brand, model, saxType) {
  if (brand === OTHER_BRAND) return model === null;
  return (INSTRUMENT_CATALOG[brand]?.[saxType] ?? []).includes(model);
}

export function isValidMouthpiece(brand, model) {
  if (brand === OTHER_BRAND) return model === null;
  return (MOUTHPIECE_CATALOG[brand]?.models ?? []).includes(model);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/community/catalog/gear.test.js`
Expected: PASS

- [ ] **Step 5: research md からの転記の完了確認**

`/* 転記 */` コメントが残っていないこと、◎○印の型番が全ブランド分入っていることを `docs/superpowers/research/2026-08-27-gear-catalog.md` と突き合わせて確認。

- [ ] **Step 6: Commit**

```bash
git add src/community/catalog
git commit -m "コミュニティ計画1: 機材カタログと部分一致検索を追加"
```

---

### Task 5: プロフィール検証とドキュメント生成(TDD)

**Files:**
- Create: `src/community/profile.js`
- Test: `src/community/profile.test.js`

**Interfaces:**
- Consumes: `findNgWord`(Task 3)、`isValidInstrument` / `isValidMouthpiece` / `isValidLigature`(Task 4)
- Produces:
  - 選択肢定数 `POSITIONS, GENRES, ENSEMBLES, PLACES, SAX_TYPES, SAX_LABELS, startYearOptions(now): number[]`
  - `validateNickname(raw): { value: string } | { error: string }`
  - `buildProfileDoc(input, now?): { doc: object } | { error: string }` — Firestore に書く形を返す
  - `detectDeviceClass(ua?): "ios" | "android" | "pc"`

- [ ] **Step 1: 失敗するテストを書く**

`src/community/profile.test.js`:

```js
import { describe, it, expect } from "vitest";
import { validateNickname, buildProfileDoc, detectDeviceClass, POSITIONS, SAX_TYPES } from "./profile.js";

const base = {
  nickname: "さっくす太郎",
  // 楽器種別は複数。掛け持ちの奏者が居るので配列で持つ
  saxTypes: ["alto"],
  position: "社会人",
  startYear: 2015,
  genres: ["クラシック"],
  ensembles: ["吹奏楽"],
  places: ["自宅"],
  ageConfirmed: true,
  isPublic: true,
  // gear は「楽器種別をキーにした map」。キー集合は saxTypes と完全に一致させる
  gear: {
    alto: {
      instrumentBrand: "YAMAHA", instrumentModel: "YAS-62",
      mpBrand: "Selmer", mpModel: "S80 C*",
      ligBrand: null, ligModel: null,
    },
  },
};

describe("validateNickname", () => {
  it("前後の空白を落として受理する", () => {
    expect(validateNickname("  太郎 ")).toEqual({ value: "太郎" });
  });
  it("空・21文字以上・改行・NGワードを弾く", () => {
    expect(validateNickname("")).toHaveProperty("error");
    expect(validateNickname("あ".repeat(21))).toHaveProperty("error");
    expect(validateNickname("a\nb")).toHaveProperty("error");
    expect(validateNickname("xxfuckxx")).toHaveProperty("error");
  });
});

describe("buildProfileDoc", () => {
  it("正しい入力からドキュメントを作る", () => {
    const r = buildProfileDoc(base, new Date("2026-08-27"));
    expect(r.doc.nickname).toBe("さっくす太郎");
    expect(r.doc.startYear).toBe(2015);
    expect(r.doc.deviceClass).toMatch(/ios|android|pc/);
  });
  it("選択肢に無い値・未来の開始年・年齢未確認を弾く", () => {
    expect(buildProfileDoc({ ...base, position: "宇宙人" })).toHaveProperty("error");
    expect(buildProfileDoc({ ...base, startYear: 2199 })).toHaveProperty("error");
    expect(buildProfileDoc({ ...base, ageConfirmed: false })).toHaveProperty("error");
    expect(buildProfileDoc({ ...base, gear: { alto: { ...base.gear.alto, instrumentModel: "でたらめ" } } })).toHaveProperty("error");
  });
  it("gear のキー集合が saxTypes と完全に一致しないと弾く", () => {
    // 少ない(選んだ楽器の欄が無い)
    expect(buildProfileDoc({ ...base, saxTypes: ["alto", "tenor"] })).toHaveProperty("error");
    // 多い(持っていない楽器の機材が入っている)
    expect(buildProfileDoc({ ...base, gear: { ...base.gear, tenor: {} } })).toHaveProperty("error");
  });
  it("doc は単数の saxType を持たず、複数形の saxTypes だけを持つ", () => {
    const r = buildProfileDoc(base, new Date("2026-08-27"));
    expect(Object.keys(r.doc)).not.toContain("saxType");
    expect(r.doc.saxTypes).toEqual(["alto"]);
  });
  it("複数選択は許可リスト外を黙って除外する", () => {
    const r = buildProfileDoc({ ...base, genres: ["クラシック", "演歌"] });
    expect(r.doc.genres).toEqual(["クラシック"]);
  });
});

describe("detectDeviceClass", () => {
  it("UA文字列から判定する", () => {
    expect(detectDeviceClass("Mozilla/5.0 (iPhone; ...)")).toBe("ios");
    expect(detectDeviceClass("Mozilla/5.0 (Linux; Android 14; ...)")).toBe("android");
    expect(detectDeviceClass("Mozilla/5.0 (Windows NT 10.0)")).toBe("pc");
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/community/profile.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/community/profile.js`:

```js
import { findNgWord } from "./ngwords/filter.js";
import { isValidInstrument, isValidMouthpiece, isValidLigature } from "./catalog/gear.js";

// spec §4.1 の選択肢。文言を変えるときは設計書も firestore.rules も直すこと
export const SAX_TYPES = ["soprano", "alto", "tenor", "baritone"];
// 画面に出す表示名。機材の照合エラーが「どの楽器の話か」を言えるように、
// 判断を持つ側(profile.js)に置いて1つにする。CommunityTab.jsx 側に写しを作らない。
export const SAX_LABELS = { soprano: "Soprano", alto: "Alto", tenor: "Tenor", baritone: "Baritone" };
// 【学校段階を選択肢に置かない】spec §7.1(2026-08-28 変更)。「中学吹奏楽部」は
// 公開プロフィール上で実質「私は12〜15歳です」と宣言することになり、未成年であることを
// 不特定多数に晒す。進度は演奏開始年で足りるので、学校段階は捨てても失うものが無い。
// **ここに中学/高校/大学の段階を復活させないこと。**
export const POSITIONS = ["学生", "学生（音大）", "社会人", "講師・プロ", "独学"];
export const GENRES = ["クラシック", "ジャズ", "ポップス", "その他"];
export const ENSEMBLES = ["ソロ", "アンサンブル", "ビッグバンド", "吹奏楽", "オーケストラ"];
export const PLACES = ["自宅", "学校の音楽室", "個人練習室", "スタジオ", "カラオケ", "屋外"];

export function startYearOptions(now = new Date()) {
  const y = now.getFullYear();
  const out = [];
  for (let i = y; i >= y - 80; i--) out.push(i);
  return out;
}

export function validateNickname(raw) {
  const value = String(raw ?? "").trim();
  if (value.length === 0) return { error: "ニックネームを入力してください" };
  if ([...value].length > 20) return { error: "ニックネームは20文字までです" };
  if (/[\r\n\t]/.test(value)) return { error: "使えない文字が含まれています" };
  const ng = findNgWord(value);
  if (ng) return { error: "このニックネームは使用できません" };
  return { value };
}

export function detectDeviceClass(ua = (typeof navigator !== "undefined" ? navigator.userAgent : "")) {
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "pc";
}

const pickAllowed = (arr, allowed) => (Array.isArray(arr) ? arr.filter((v) => allowed.includes(v)) : []);

export function buildProfileDoc(input, now = new Date()) {
  const nick = validateNickname(input.nickname);
  if (nick.error) return { error: nick.error };

  // 【楽器種別は複数】1人が soprano / alto / tenor / baritone を掛け持ちする(spec §4.1)。
  const types = input.saxTypes;
  if (!Array.isArray(types) || types.length === 0) return { error: "楽器種別を選んでください" };
  if (types.length > SAX_TYPES.length) return { error: "楽器種別は4つまでです" };
  if (!types.every((t) => SAX_TYPES.includes(t))) return { error: "楽器種別を選んでください" };
  // 重複を通すと「saxTypes の要素数」と「gear のキー数」が食い違ったまま
  // hasOnly/hasAll(集合の検査)は通ってしまう。数の一致で完全一致を言えるようにここで潰す。
  if (new Set(types).size !== types.length) return { error: "楽器種別が重複しています" };

  if (!POSITIONS.includes(input.position)) return { error: "属性を選んでください" };
  const year = Number(input.startYear);
  if (!Number.isInteger(year) || year < now.getFullYear() - 80 || year > now.getFullYear()) {
    return { error: "演奏開始年が正しくありません" };
  }
  if (input.ageConfirmed !== true) return { error: "13歳以上であることの確認が必要です" };

  // 【gear は楽器種別をキーにした map】1種別につき1組(楽器・マウスピース・リガチャーの6キー)。
  // キー集合は saxTypes と**完全に一致**させる。多いと計画4の機材シェアの母数が壊れ
  // (吹かない楽器の機材が票になる)、少ないと画面側の取りこぼしを保存後に知ることになる。
  const gearIn = input.gear;
  if (gearIn === null || typeof gearIn !== "object" || Array.isArray(gearIn)) {
    return { error: "機材の指定が正しくありません" };
  }
  const gearKeys = Object.keys(gearIn);
  if (gearKeys.length !== types.length || !types.every((t) => gearKeys.includes(t))) {
    return { error: "選んだ楽器種別と機材の欄が一致していません" };
  }

  const gear = {};
  for (const t of types) {
    const g = gearIn[t];
    if (g === null || typeof g !== "object" || Array.isArray(g)) {
      return { error: `${SAX_LABELS[t]}の機材の指定が正しくありません` };
    }
    // 【未選択を「その他」に寄せない】機材欄を飛ばした人(null)と「カタログに無い(その他)」を
    // 自分で選んだ人は別の情報。?? OTHER_BRAND に潰すと計画4の円グラフから両者が
    // 区別できなくなり、書き込み後は復元もできない。undefined は null に正規化するだけ。
    const instBrand = g.instrumentBrand ?? null;
    const instModel = g.instrumentModel ?? null;
    const mpBrand = g.mpBrand ?? null;
    const mpModel = g.mpModel ?? null;
    const ligBrand = g.ligBrand ?? null;
    const ligModel = g.ligModel ?? null;
    // 楽器だけは種別ごとに照合する(カタログが種別で分かれているため第3引数が要る)。
    // マウスピースとリガチャーのカタログは種別を持たないので2引数。
    if (!isValidInstrument(instBrand, instModel, t)) return { error: `${SAX_LABELS[t]}の楽器がカタログにありません` };
    if (!isValidMouthpiece(mpBrand, mpModel)) return { error: `${SAX_LABELS[t]}のマウスピースがカタログにありません` };
    if (!isValidLigature(ligBrand, ligModel)) return { error: `${SAX_LABELS[t]}のリガチャーがカタログにありません` };
    gear[t] = { instrumentBrand: instBrand, instrumentModel: instModel, mpBrand, mpModel, ligBrand, ligModel };
  }

  return {
    doc: {
      nickname: nick.value,
      saxTypes: [...types],
      position: input.position,
      startYear: year,
      genres: pickAllowed(input.genres, GENRES),
      ensembles: pickAllowed(input.ensembles, ENSEMBLES),
      places: pickAllowed(input.places, PLACES),
      gear,
      deviceClass: detectDeviceClass(),
      isPublic: input.isPublic !== false, // 既定は公開(spec 決定事項)
      ageConfirmed: true,
      updatedAt: now.toISOString(),
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/community/profile.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/community/profile.js src/community/profile.test.js
git commit -m "コミュニティ計画1: プロフィール検証とドキュメント生成を追加"
```

---

### Task 6: Firebase クライアントと認証・プロフィール保存層

**Files:**
- Create: `src/community/firebaseClient.js`
- Create: `src/community/accountRepo.js`

**Interfaces:**
- Consumes: `.env.local` の `VITE_FIREBASE_*`(Task 0)
- Produces:
  - `getFirebase(): { app, auth, db }`(遅延初期化)
  - `ensureSignedIn(): Promise<string>` — 匿名サインインし uid を返す(サインイン済みならそのまま)
  - `saveProfile(uid, doc): Promise<void>` / `loadProfile(uid): Promise<object|null>` / `setProfilePublic(uid, isPublic): Promise<void>`
  - `deleteAccount(): Promise<void>` — Firestore の users/{uid} を削除してから Auth ユーザーを削除

- [ ] **Step 1: 実装**

`src/community/firebaseClient.js`:

```js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

let cached = null;
export function getFirebase() {
  if (!cached) {
    const app = initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    });
    cached = { app, auth: getAuth(app), db: getFirestore(app) };
  }
  return cached;
}
```

`src/community/accountRepo.js`:

```js
import { signInAnonymously, onAuthStateChanged, deleteUser } from "firebase/auth";
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { getFirebase } from "./firebaseClient.js";

function currentUser() {
  const { auth } = getFirebase();
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); });
  });
}

export async function ensureSignedIn() {
  const { auth } = getFirebase();
  const existing = await currentUser();
  if (existing) return existing.uid;
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}

const userRef = (uid) => doc(getFirebase().db, "users", uid);

export async function saveProfile(uid, profileDoc) {
  await setDoc(userRef(uid), profileDoc);
}

export async function loadProfile(uid) {
  const snap = await getDoc(userRef(uid));
  return snap.exists() ? snap.data() : null;
}

export async function setProfilePublic(uid, isPublic) {
  await updateDoc(userRef(uid), { isPublic: !!isPublic });
}

// spec §8: アカウント削除はアプリ内から完全削除できることが必須(匿名でも適用)
export async function deleteAccount() {
  const { auth } = getFirebase();
  const user = await currentUser();
  if (!user) return;
  await deleteDoc(userRef(user.uid));
  await deleteUser(user);
}
```

- [ ] **Step 2: ビルドが通ることを確認**

Run: `npm run build`
Expected: エラーなし(この層のUIはまだ無いのでバンドルされるだけ)

- [ ] **Step 3: Commit**

```bash
git add src/community/firebaseClient.js src/community/accountRepo.js
git commit -m "コミュニティ計画1: Firebase接続と認証・プロフィール保存層を追加"
```

---

### Task 7: Firestore セキュリティルール

**Files:**
- Create: `firestore.rules`

**Interfaces:**
- Consumes: users/{uid} のドキュメント形(Task 5 の `buildProfileDoc` が返す keys)
- Produces: デプロイ済みルール。「公開プロフィールは誰でも読める / 自分のものだけ書ける」の強制

- [ ] **Step 1: ルールを書く**

`firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      // 公開プロフィールは誰でも読める。非公開は本人のみ(spec: 非公開でも復元用にクラウド保存する)
      allow get: if resource.data.isPublic == true || (request.auth != null && request.auth.uid == uid);
      allow list: if false; // 一覧APIは計画2まで封鎖(公開一覧の設計とセットで開ける)
      allow create, update: if request.auth != null && request.auth.uid == uid
        // キー集合は hasAll + hasOnly の両方で挟んで完全一致にする。
        // 楽器種別は**複数形の saxTypes(配列)**。単数の saxType というキーは存在しない。
        && request.resource.data.keys().hasAll(['nickname','saxTypes','position','startYear','genres','ensembles','places','gear','deviceClass','isPublic','ageConfirmed','updatedAt'])
        && request.resource.data.keys().hasOnly(['nickname','saxTypes','position','startYear','genres','ensembles','places','gear','deviceClass','isPublic','ageConfirmed','updatedAt'])
        && request.resource.data.nickname is string
        && request.resource.data.nickname.size() > 0
        && request.resource.data.nickname.size() <= 80  // バイト長。文字数20の実強制はクライアント(NG検証のサーバ側強制は計画5)
        && request.resource.data.isPublic is bool
        && request.resource.data.ageConfirmed == true;
      allow delete: if request.auth != null && request.auth.uid == uid;
    }
    match /{document=**} { allow read, write: if false; } // 未定義コレクションは全拒否
  }
}
```

> **実際にデプロイされているルールは上より厳しい。現物は `firestore.rules` を読むこと。**
> 実装時に、`position` / `genres` / `ensembles` / `places` の**選択肢そのものの列挙**、
> `saxTypes` の要素数と選択肢、`gear` のキー集合(`saxTypes` と完全一致)と
> 4種別ぶんの中身の型・長さ検査を足した。ここに写しを置くと二重管理になるので写さない。
> `src/community/profile.js` の定数を足し引きしたら `firestore.rules` も必ず直すこと(逆も同じ)。
> 食い違いは `src/community/profile.test.js` の「Firestore ルールの列挙と一致する」が検出する。

- [ ] **Step 2: デプロイ**

Firebase CLI が無ければ `npm install -D firebase-tools`。次に:

```bash
npx firebase login
npx firebase use <プロジェクトID>
npx firebase deploy --only firestore:rules
```

(`firebase.json` が無いと言われたら `{"firestore": {"rules": "firestore.rules"}}` の内容で作成してコミットに含める)

Expected: Deploy complete

- [ ] **Step 3: Commit**

```bash
git add firestore.rules firebase.json
git commit -m "コミュニティ計画1: Firestoreセキュリティルールを追加"
```

---

### Task 8: コミュニティタブ UI(参加 → プロフィール表示/編集 → 削除)

**Files:**
- Create: `src/community/CommunityTab.jsx`

**Interfaces:**
- Consumes: `ensureSignedIn, saveProfile, loadProfile, setProfilePublic, deleteAccount`(Task 6)、`buildProfileDoc` と選択肢定数(Task 5)、`searchInstrumentModels, searchMouthpieces, INSTRUMENT_CATALOG, MOUTHPIECE_CATALOG, OTHER_BRAND`(Task 4)
- Produces: `export default function CommunityTab()` — App.jsx が topTab === "community" のときに描画する(Task 9)

画面は3状態: **未参加**(説明+参加ボタン) → **登録フォーム** → **プロフィール表示**。スタイルは既存アプリと同じくインラインstyle+CSS変数(`var(--c-ink)` 等)を使い、新しい見た目の発明はしない。

- [ ] **Step 1: 実装**

`src/community/CommunityTab.jsx` の骨格(そのまま使える完成コード。フォーム部分は選択肢定数を map するだけの単純な作り):

```jsx
import React, { useEffect, useState } from "react";
import { ensureSignedIn, saveProfile, loadProfile, setProfilePublic, deleteAccount } from "./accountRepo.js";
import { buildProfileDoc, POSITIONS, GENRES, ENSEMBLES, PLACES, SAX_TYPES, SAX_LABELS, startYearOptions } from "./profile.js";
import { searchInstrumentModels, searchMouthpieces, searchLigatures, OTHER_BRAND, INSTRUMENT_CATALOG, MOUTHPIECE_CATALOG } from "./catalog/gear.js";

// 【SAX_LABELS はここに定義しない】表示名は英語表記(Soprano / Alto / Tenor / Baritone)で、
// 定義は profile.js 側にただ1つ置く。ここに写しを作ると、機材の照合エラーが
// 「どの楽器の話か」を言えなくなる(判断を持つのは profile.js の側)。

export default function CommunityTab() {
  const [phase, setPhase] = useState("loading"); // loading | notJoined | form | profile | error
  const [uid, setUid] = useState(null);
  const [profile, setProfile] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const id = await ensureSignedIn();
        if (!alive) return;
        setUid(id);
        const p = await loadProfile(id);
        if (!alive) return;
        setProfile(p);
        setPhase(p ? "profile" : "notJoined");
      } catch (e) {
        if (alive) { setErrorMsg("通信に失敗しました。電波の良いところでもう一度お試しください"); setPhase("error"); }
      }
    })();
    return () => { alive = false; };
  }, []);

  if (phase === "loading") return <Centered>読み込み中…</Centered>;
  if (phase === "error") return <Centered>{errorMsg}</Centered>;
  if (phase === "notJoined") return <JoinIntro onJoin={() => setPhase("form")} />;
  if (phase === "form") return (
    <ProfileForm
      initial={profile}
      onSubmit={async (input) => {
        const r = buildProfileDoc(input);
        if (r.error) return r.error; // フォーム側がエラー文言を表示する
        await saveProfile(uid, r.doc);
        setProfile(r.doc);
        setPhase("profile");
        return null;
      }}
    />
  );
  return (
    <ProfileView
      profile={profile}
      onEdit={() => setPhase("form")}
      onTogglePublic={async (v) => { await setProfilePublic(uid, v); setProfile({ ...profile, isPublic: v }); }}
      onDelete={async () => {
        await deleteAccount();
        setProfile(null); setUid(null); setPhase("notJoined");
      }}
    />
  );
}

function Centered({ children }) {
  return <div className="sans" style={{ padding: 24, textAlign: "center", color: "var(--c-ink-3)", fontSize: 13 }}>{children}</div>;
}

function JoinIntro({ onJoin }) {
  return (
    <div className="sans" style={{ padding: 16, display: "grid", gap: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-ink)" }}>コミュニティ</div>
      <div style={{ fontSize: 13, color: "var(--c-ink)", lineHeight: 1.7 }}>
        他の奏者の目安・機材・練習量を見られるようになります。参加すると匿名のアカウントが作られます。
        メールアドレスなどの個人情報は収集しません。
      </div>
      <button type="button" onClick={onJoin}
        style={{ padding: "12px 16px", borderRadius: 8, border: "1px solid var(--c-ink)", background: "var(--c-ink)", color: "#fff", fontSize: 14, fontWeight: 700 }}>
        参加してプロフィールを作る
      </button>
    </div>
  );
}
```

`ProfileForm` は次の要素を上から並べる(すべて `<select>`、ニックネームだけ `<input type="text" maxLength={20}>`):

1. ニックネーム — 直下に注意書き `ニックネームは他の利用者に公開されます。本名は使わないでください`(12px, `var(--c-ink-3)`)
2. 楽器種別(SAX_TYPES → SAX_LABELS の英語表記)。**チェックボックスの複数選択**。掛け持ちの奏者が居るため単一選択にしない
3. 機材 — **選んだ楽器種別ごとに1組**(楽器・マウスピース・リガチャーの6キー)を並べる。楽器はテキスト入力に打つと `searchInstrumentModels(query, その欄の楽器種別)` の結果を最大10件リスト表示し、タップで確定。確定後は「YAMAHA YAS-62 ✕」のチップ表示。見つからない場合のために `カタログに無い(その他)` ボタンを常に末尾に出す(選ぶと brand=その他, model=null)
4. 同じ組の中で マウスピースは `searchMouthpieces(query)`、リガチャーは `searchLigatures(query)`(どちらも楽器種別を引数に取らない)
   - **入力状態のキーは saxTypes からしか作らない。** チェックを外した種別の入力状態が残ると `gear` のキーが `saxTypes` より多くなり、保存が弾かれる
5. 属性(POSITIONS) / 演奏開始年(startYearOptions()) / ジャンル(GENRES, チェックボックス複数) / 編成(ENSEMBLES, 複数) / 練習場所(PLACES, 複数)
6. `☑ 13歳以上です`(必須チェック)
7. 保存ボタン。`onSubmit` が返したエラー文字列を赤字(`#B4232A`)で表示

`ProfileView` は登録内容の一覧カード+3つの操作:
- `公開する`トグル(`profile.isPublic`、説明文 `ONにすると他の利用者から見えます`)
- `編集` ボタン → form へ
- `アカウントを削除` — 押すと `window.confirm("アカウントとサーバー上のプロフィールを完全に削除します。この端末の計測データは消えません。よろしいですか?")` を出し、OKなら `onDelete()`

- [ ] **Step 2: ビルド確認**

Run: `npm run build`
Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
git add src/community/CommunityTab.jsx
git commit -m "コミュニティ計画1: コミュニティタブUI(参加・プロフィール・削除)を追加"
```

---

### Task 9: App.jsx への配線と実機フロー検証

**Files:**
- Modify: `src/App.jsx`(4箇所: react の import に `lazy, Suspense, Component` を足す / `lazy()` 定義とエラー境界クラス / `topTab === "community"` のレンダ分岐 / BottomNav の items 配列)

**Interfaces:**
- Consumes: `CommunityTab`(Task 8)

**注意: App.jsx は別セッションでデザイン改修中。行番号ではなく検索で位置を特定し、差分は最小にする。**

- [ ] **Step 1: 遅延importを追加**

App.jsx 先頭の import 群の近く(`grep -n "^import" src/App.jsx`)に:

```jsx
const CommunityTab = React.lazy(() => import("./community/CommunityTab.jsx"));
```

(`React` が default import されていない場合は `import { lazy, Suspense } from "react"` 相当の既存の書き方に合わせる)

- [ ] **Step 2: BottomNav に4つ目の項目を追加**

`grep -n "key: \"analysis\"" src/App.jsx` で BottomNav の items 配列を見つけ、analysis の後に追加:

```jsx
    {
      key: "community", label: "コミュニティ",
      icon: (c) => (
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 20 Q3.5 14.5 9 14.5 Q14.5 14.5 14.5 20" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M15.5 13.6 Q20.5 13.6 20.5 18" />
        </svg>
      ),
    },
```

(人が2人並ぶピクトグラム。既存アイコンと同じ 30×30 / stroke 文法)

- [ ] **Step 3: タブ本体のレンダ分岐を追加**

`grep -n "topTab === \"analysis\" &&" src/App.jsx` で分析タブのレンダ分岐を見つけ、同じ階層に:

```jsx
      {topTab === "community" && (
        <React.Suspense fallback={null}>
          <CommunityTab />
        </React.Suspense>
      )}
```

- [ ] **Step 4: ブラウザで全フロー検証**

`npm run dev` でプレビューを開き、順に確認:

1. 下部ナビに4つ目のアイコンが出る。タップでコミュニティタブに切り替わる
2. 「参加してプロフィールを作る」→ フォームが出る
3. ニックネームにNGワード(`fuck` 等)を入れて保存 → 「このニックネームは使用できません」が出て保存されない
4. 楽器欄に `yas` と打つ → 候補が出る → タップで確定できる
5. 13歳チェック無しで保存 → エラーが出る
6. 正しく入力して保存 → プロフィール表示になる。Firebase コンソールの Firestore に users/{uid} ができている
7. リロードしてコミュニティタブを開く → プロフィールが復元されている(匿名認証の永続を確認)
8. 公開トグルOFF → Firestore 上の isPublic が false になる
9. アカウント削除 → confirm → Firestore のドキュメントと Authentication のユーザーが両方消え、「未参加」画面に戻る
10. **既存3タブの表示・動作が一切変わっていないこと**(計測タブの録音、リードタブ、My Data を一巡)

Expected: すべて成功。7 で復元されない場合はブラウザのストレージ設定(プライベートモード)を疑う。

- [ ] **Step 5: セキュリティルールの実地確認**

ブラウザの開発者コンソールで(サインイン済み状態で):

```js
// 他人のuidを読もうとすると拒否されること(適当なuidでget → permission-denied が正)
const { getFirestore, doc, getDoc } = await import("firebase/firestore");
await getDoc(doc(getFirestore(), "users", "someone-elses-uid")).catch((e) => e.code);
```

Expected: 存在しない/非公開のドキュメントに対して `permission-denied`(list も封鎖済み)

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "コミュニティ計画1: 4つ目のタブを配線"
```

---

## Self-Review 結果

- **Spec coverage(計画1スコープ)**: §4.1 プロフィール項目 → Task 5/8。§6 匿名認証 → Task 6(Google/Apple連携は計画6)。§7.1 13歳チェック・学校名なし → Task 5。§7.3 は目安公開の話なので計画2。§8 削除導線 → Task 6/8。§8.1 NGフィルタ(クライアント) → Task 1-3(サーバ側強制は計画5と明記済み)
- **Placeholder scan**: Task 4 のカタログ転記は research md という具体的な出典と「◎○を全て、△は除外」という規準を示した(Step 5 で完了確認)。他に TBD なし
- **Type consistency**: `buildProfileDoc` の doc keys と firestore.rules の hasOnly リストが一致することを確認済み
