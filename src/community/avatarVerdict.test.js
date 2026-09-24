import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  safeSearchVerdict, uploadAcceptable, uploadPathOf, avatarPathOf, avatarPrefixOf, downloadUrlOf,
} from "../../functions/avatarVerdict.js";

// 判定の線引きは配信しないと確かめられない場所に置かない(functions/avatarVerdict.js)。
// ここは**引数を与えて実際に走らせる**。綴りは見ない。

const CLEAN = { adult: "VERY_UNLIKELY", violence: "UNLIKELY", racy: "UNLIKELY", medical: "VERY_UNLIKELY" };

describe("safeSearchVerdict ── 載せてよいかを決める", () => {
  it("4つとも低ければ通す", () => {
    expect(safeSearchVerdict(CLEAN)).toEqual({ ok: true, reason: null });
  });

  it("POSSIBLE までは通す(逆光の顔や赤い服で落とさない)", () => {
    expect(safeSearchVerdict({ ...CLEAN, racy: "POSSIBLE" }).ok).toBe(true);
    expect(safeSearchVerdict({ ...CLEAN, violence: "POSSIBLE" }).ok).toBe(true);
  });

  it("LIKELY 以上は落とす(4つのどれでも)", () => {
    for (const k of ["adult", "violence", "racy", "medical"]) {
      expect(safeSearchVerdict({ ...CLEAN, [k]: "LIKELY" }), k).toEqual({ ok: false, reason: k });
      expect(safeSearchVerdict({ ...CLEAN, [k]: "VERY_LIKELY" }).ok, k).toBe(false);
    }
  });

  // 【判定できなかったものを通さない(fail closed)】通すと
  // 「判定を通っていない写真が載る経路」ができる ── 決定6 が禁じているのはそれ。
  it("答えが無いものは落とす", () => {
    expect(safeSearchVerdict(null).ok).toBe(false);
    expect(safeSearchVerdict(undefined).ok).toBe(false);
    expect(safeSearchVerdict({}).ok).toBe(false);
    expect(safeSearchVerdict("VERY_UNLIKELY").ok).toBe(false);
  });

  it("段が1つでも読めなければ落とす(未知の綴りを「安全」と読まない)", () => {
    expect(safeSearchVerdict({ ...CLEAN, medical: undefined }).ok).toBe(false);
    expect(safeSearchVerdict({ ...CLEAN, adult: 0 }).ok).toBe(false);
    const { adult, ...noAdult } = CLEAN;
    expect(safeSearchVerdict(noAdult).ok).toBe(false);
  });
});

describe("uploadAcceptable ── 上がってきた形を見る", () => {
  it("256KiB 以下の WebP なら通す", () => {
    expect(uploadAcceptable({ size: 20000, contentType: "image/webp" }).ok).toBe(true);
    expect(uploadAcceptable({ size: "262144", contentType: "image/webp" }).ok).toBe(true);
  });
  it("大きすぎるものは落とす(境界のすぐ上)", () => {
    expect(uploadAcceptable({ size: 262145, contentType: "image/webp" }))
      .toEqual({ ok: false, reason: "too-large" });
  });
  // 【便AP 2026-09-24】iPhone の Safari は canvas を WebP で書き出せないので、JPEG も受ける
  // (EXIF は関数が判定の前に取り除く ── avatarJpeg.test.jsx)。それ以外は落とす。
  it("WebP と JPEG のほかは落とす", () => {
    expect(uploadAcceptable({ size: 20000, contentType: "image/jpeg" }).ok).toBe(true);
    expect(uploadAcceptable({ size: 20000, contentType: "image/png" }).ok).toBe(false);
    expect(uploadAcceptable({ size: 20000, contentType: "image/heic" }).ok).toBe(false);
    expect(uploadAcceptable({ size: 20000 }).ok).toBe(false);
  });
  it("空のものは落とす", () => {
    expect(uploadAcceptable({ size: 0, contentType: "image/webp" }).ok).toBe(false);
    expect(uploadAcceptable(null).ok).toBe(false);
  });
});

describe("置き場 ── クライアントが書ける場所と、画面に出る場所を分ける", () => {
  it("上げる先と、載る先は別の場所", () => {
    expect(uploadPathOf("u1")).toBe("avatarUploads/u1/photo.webp");
    expect(avatarPathOf("u1", "abc")).toBe("avatars/u1/abc.webp");
    expect(avatarPathOf("u1", "abc").startsWith(uploadPathOf("u1"))).toBe(false);
  });
  it("差し替えると場所の名前が変わる(古い場所に新しい写真が出ない)", () => {
    expect(avatarPathOf("u1", "aaa")).not.toBe(avatarPathOf("u1", "bbb"));
  });
  it("消すときの接頭辞は、その人の写真だけに当たる", () => {
    expect(avatarPrefixOf("u1")).toBe("avatars/u1/");
    expect(avatarPathOf("u1", "x").startsWith(avatarPrefixOf("u1"))).toBe(true);
    expect(avatarPathOf("u2", "x").startsWith(avatarPrefixOf("u1"))).toBe(false);
  });
  it("読む場所は場所と鍵から組み立てる(スラッシュは逃がす)", () => {
    const url = downloadUrlOf("b1.appspot.com", "avatars/u1/x.webp", "t0");
    expect(url).toContain("avatars%2Fu1%2Fx.webp");
    expect(url).toContain("token=t0");
    expect(url).not.toContain("avatars/u1/x.webp");
  });
});

// ------------------------------------------------------------------
// ルールの側。**値ではなく規則の存在**を見る(report.test.js と同じ作法)。
// ここが緩むと、判定を通っていない写真が載る経路ができる。
// ------------------------------------------------------------------
const readRoot = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const codeOf = (t) => t.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// ------------------------------------------------------------------
// 【エミュレータが無い ── 2026-09-23】この環境には Java も firebase-tools も
// @firebase/rules-unit-testing も入っていないので、`@firebase/rules-unit-testing`
// でルールを走らせることはできない。**代わりに、ルールの写真の門の式を
// firestore.rules から切り出し、それをそのまま JavaScript として評価する。**
// 式は `'x' in obj` / `!=` / `==` / `||` / `&&` だけでできており、JS の文法と
// 意味が一致する範囲に収まっているのでこれが成り立つ。
//
// **これで掴めること**: 門の論理が壊れたこと(`true ||` での短絡、条件の反転、
// 節の削除)。審査役の変異「`true ||` で短絡」はここで落ちる。
// **これで掴めないこと**: 式が本当に users の書き込み規則に繋がっているか
// (下の「門が users の create/update の中に在る」が位置だけを見ている)、
// Firestore の実際の型変換、他の節との相互作用。**実機・エミュレータ待ち。**
// ------------------------------------------------------------------
function extractPhotoGuard(rulesCode) {
  const key = "(!('photo' in request.resource.data)";
  const at = rulesCode.indexOf(key);
  if (at < 0) throw new Error("firestore.rules に写真の門が無い");
  let depth = 0; let i = at;
  for (; i < rulesCode.length; i++) {
    if (rulesCode[i] === "(") depth += 1;
    else if (rulesCode[i] === ")") { depth -= 1; if (depth === 0) { i += 1; break; } }
  }
  if (depth !== 0) throw new Error("写真の門の括弧が閉じていない");
  return { expr: rulesCode.slice(at, i), at };
}

describe("firestore.rules の写真の門を**実際に評価する**(決定6)", () => {
  const rules = codeOf(readRoot("../../firestore.rules"));
  const { expr, at } = extractPhotoGuard(rules);
  // 切り出した式をそのまま走らせる。request / resource は呼び出しで与える。
  const allows = new Function("request", "resource", `return (${expr});`);
  const req = (data) => ({ resource: { data } });
  const res = (data) => (data === null ? null : { data });

  it("式を切り出せている(空回りしていない)", () => {
    expect(expr.length).toBeGreaterThan(80);
    expect(expr).toContain("request.resource.data.photo");
  });

  it("門は users の create / update の規則の中に在る", () => {
    const start = rules.indexOf("allow create, update:");
    const end = rules.indexOf("ageConfirmed == true;");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(at).toBeGreaterThan(start);
    expect(at).toBeLessThan(end);
  });

  it("写真のキーを持たない書き込みは通る(大多数の人が弾かれない)", () => {
    expect(allows(req({ nickname: "t", icon: "ic-cat" }), res(null))).toBe(true);
    expect(allows(req({ nickname: "t" }), res({ nickname: "t", photo: "https://a" }))).toBe(true);
  });

  it("null を書くのは通る(絵柄を選び直して消す ── 決定4)", () => {
    expect(allows(req({ photo: null }), res({ photo: "https://a" }))).toBe(true);
    expect(allows(req({ photo: null }), res(null))).toBe(true);
  });

  it("いま載っている値をそのまま書き戻すのは通る(公開・練習日数・絵柄の更新)", () => {
    expect(allows(req({ photo: "https://a" }), res({ photo: "https://a" }))).toBe(true);
  });

  // 【これが決定6 の中身】**新しい値は1つも入れられない。**
  it("他人(クライアント)が新しい値を入れるのは通らない", () => {
    expect(allows(req({ photo: "https://evil" }), res({ photo: "https://a" }))).toBe(false);
    expect(allows(req({ photo: "https://evil" }), res({ nickname: "t" }))).toBe(false);
    expect(allows(req({ photo: "https://evil" }), res(null))).toBe(false);
    expect(allows(req({ photo: "" }), res(null))).toBe(false);
    expect(allows(req({ photo: 1 }), res(null))).toBe(false);
  });

  it("photo は hasOnly には在り、hasAll には無い(持たない人が弾かれない)", () => {
    const hasAll = (rules.match(/hasAll\(\['nickname'[^\]]*\]\)/) || [""])[0];
    const hasOnly = (rules.match(/hasOnly\(\['nickname'[^\]]*\]\)/) || [""])[0];
    expect(hasOnly).toContain("'photo'");
    expect(hasAll).not.toContain("'photo'");
  });

  it("通報の理由の写しが REPORT_REASONS と同じ5つ(写真の2つを含む)", () => {
    expect(rules).toContain("'アイコンの写真が不適切'");
    expect(rules).toContain("'他人が写っている'");
  });
});

describe("storage.rules(決定7)", () => {
  const rules = codeOf(readRoot("../../storage.rules"));

  it("画面に出る側はクライアントが書けない", () => {
    const seg = rules.slice(rules.indexOf("match /avatars/"), rules.indexOf("match /avatarUploads/"));
    expect(seg).toMatch(/allow read: if true;/);
    expect(seg).toMatch(/allow write: if false;/);
  });

  it("置き場は自分の uid の下・1人1枚・256KiB・WebP か JPEG だけ", () => {
    const seg = rules.slice(rules.indexOf("match /avatarUploads/"));
    expect(rules).toContain("match /avatarUploads/{uid}/photo.webp");
    expect(seg).toMatch(/request\.auth\.uid == uid/);
    expect(seg).toMatch(/request\.resource\.size <= 262144/);
    expect(seg).toMatch(/request\.resource\.contentType in \['image\/webp', 'image\/jpeg'\]/);
  });

  it("名指ししていない場所は読み書きできない", () => {
    expect(rules).toMatch(/match \/\{allPaths=\*\*\} \{\s*\n\s*allow read, write: if false;/);
  });

  it("上限の値は端末側・関数側と同じ(3つが食い違わない)", () => {
    const client = readRoot("./avatarPhoto.js");
    const fn = readRoot("../../functions/avatarVerdict.js");
    expect(client).toMatch(/PHOTO_MAX_BYTES = 262144;/);
    expect(fn).toMatch(/PHOTO_MAX_BYTES = 262144;/);
    expect(rules).toContain("262144");
  });
});

// 【index.js は配線だけ】仕事の中身は functions/avatarJobs.js に在り、
// そちらは src/community/avatarJobs.test.js が**作り物を渡して実際に走らせて**いる。
// ここが見るのは「配線が繋がっていること」と「index.js に判断が戻っていないこと」。
describe("functions/index.js ── 配線だけで、判断を持たない", () => {
  const fn = codeOf(readRoot("../../functions/index.js"));

  it("2つの入口が avatarJobs を呼んでいる", () => {
    expect(fn).toMatch(/runVetAvatarPhoto\(\{ uid: req\.auth\?\.uid \?\? null \}, storageDeps\(\)\)/);
    expect(fn).toMatch(/onDocumentWritten\("users\/\{uid\}"/);
    expect(fn).toMatch(/runCleanAvatarPhoto\(\{/);
  });

  it("users へ書く道具は1つだけ(別の枝から書けない)", () => {
    // 【便AJ 2026-09-24】掃除の直前に「いま載っている写真」を**読む**道具を足した。
    // 読むだけなので決定6(値を入れるのは判定を通った1箇所だけ)は動かない。ただし
    // 「読む」を口実に書く道を増やせないよう、**すべての db().doc( が「その場で .get() する」か
    // 「唯一の書き込み(set/update/delete/create)」のどちらかであること**を見る。
    // 変数に取っておいて後で書く形(`const r = db().doc(...); r.set(...)`)は、
    // どちらにも数えられないので all と一致せず落ちる。
    const all = fn.match(/db\(\)\.doc\(/g) || [];
    const reads = fn.match(/db\(\)\.doc\([^)]*\)\.get\(\)/g) || [];
    const writes = fn.match(/db\(\)\.doc\([^)]*\)\.(set|update|delete|create)\(/g) || [];
    expect(writes).toHaveLength(1);
    expect(all.length).toBe(reads.length + writes.length);
    expect(fn).toMatch(/writeUserPhoto: \(uid, url\) => db\(\)\.doc\(`users\/\$\{uid\}`\)\.set\(\{ photo: url \}, \{ merge: true \}\)/);
  });

  // 【重1】置き場から写す(copy)道を残さない。載るのは download したバイト列だけ。
  it("置き場を copy で写す道具が無い(読んだバイト列をそのまま save する)", () => {
    expect(fn).not.toMatch(/\.copy\(/);
    expect(fn).not.toMatch(/gcsImageUri|gs:\/\//);
    expect(fn).toMatch(/save: \(p, bytes, token, contentType = "image\/webp"\) => bucket\(\)\.file\(p\)\.save\(Buffer\.from\(bytes\), \{\s*contentType,\s*metadata:/);
    // 【便AP 審査の変異 M14】中身から決めた形式が、保存の設定まで届いている(決め打ちの image/webp にしない)。
    expect(fn).not.toMatch(/save\(Buffer\.from\(bytes\), \{\s*contentType: "/);
    expect(fn).toMatch(/safeSearchDetection\(\{ image: \{ content: Buffer\.from\(bytes\) \} \}\)/);
  });

  // 【配線が空になっていないこと】avatarJobs は「消せ」と言うだけなので、
  // ここが何もしない道具を渡すと、users から消えても実体が残り続ける(決定9 が崩れる)。
  it("掃除の道具は本当に消す(門で殺されていない)", () => {
    expect(fn).toMatch(/dropAll: async \(prefix\) => \{ await bucket\(\)\.deleteFiles\(\{ prefix \}\); \}/);
    expect(fn).toMatch(/remove: async \(p\) => \{ try \{ await bucket\(\)\.file\(p\)\.delete\(\); \}/);
    expect(fn).toMatch(/dropOthers: async \(prefix, keep\) => \{[\s\S]{0,300}?f\.delete\(\)/);
    // 「消す」を門の中へ入れていない(`if (false)` で殺す形が入らない)。
    expect(fn).not.toMatch(/if \([^)]*\)[^\n]*deleteFiles/);
  });

  it("判断(if)を index.js へ戻していない", () => {
    // 例外の種別を HttpsError へ翻訳する1つを除いて、分岐を持たない。
    const ifs = fn.match(/\bif \(/g) || [];
    expect(ifs.length).toBeLessThanOrEqual(1);
  });

  it("ランタイムは Node 22(EOL のものを配信しない)", () => {
    const pkg = JSON.parse(readRoot("../../functions/package.json"));
    expect(pkg.engines.node).toBe("22");
  });
});
