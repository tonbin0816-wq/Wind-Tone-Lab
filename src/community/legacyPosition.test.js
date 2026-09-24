import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { POSITIONS, LEGACY_POSITIONS, positionLabel, positionForEdit } from "./profile.js";
import { filterUsers, ANY } from "./directory.js";

// 【便AI 2026-09-24】旧い属性の語のまま登録している人を閉じ込めない。
//
// 属性の語は4世代変わった。ルールは書いたあとの**文書全体**を見るので、新しい4語だけを
// 通すと、旧い語が残っている人は公開の切り替えも、アイコンの変更も、練習記録の更新も
// 弾かれる。順位から自分が消える件と同じ「黙って失敗する」形なので、振る舞いで守る。

describe("画面に出す属性の語(positionLabel)", () => {
  it("いまの4語はそのまま出す", () => {
    for (const p of POSITIONS) expect(positionLabel(p)).toBe(p);
  });

  it("旧い語は新しい語へ読み替える(4世代ぶん全部)", () => {
    expect(positionLabel("中学吹奏楽部")).toBe("学生");
    expect(positionLabel("高校吹奏楽部")).toBe("学生");
    expect(positionLabel("大学吹奏楽・サークル")).toBe("学生");
    expect(positionLabel("音大生")).toBe("学生（音楽専門）");
    expect(positionLabel("学生（音大）")).toBe("学生（音楽専門）");
    expect(positionLabel("講師・プロ")).toBe("職業音楽家");
  });

  it("読み替え先はすべて、いまの4語のどれか(対応表が古い語へ戻していない)", () => {
    for (const to of Object.values(LEGACY_POSITIONS)) expect(POSITIONS).toContain(to);
  });

  // 勝手に寄せると、本人が選んでいない属性が世界中に公開される。
  it("「独学」は対応先が無いので、読み替えずにそのまま出す", () => {
    expect(positionLabel("独学")).toBe("独学");
  });

  it("空・非文字列は null(呼び手が「—」を出す)", () => {
    expect(positionLabel(undefined)).toBeNull();
    expect(positionLabel(null)).toBeNull();
    expect(positionLabel("")).toBeNull();
    expect(positionLabel(3)).toBeNull();
  });

  // `LEGACY_POSITIONS[p]` と書くとプロトタイプの関数が返り、属性の欄に関数が描かれる。
  it("プロトタイプの名前を引いても関数を返さない", () => {
    expect(positionLabel("constructor")).toBe("constructor");
    expect(positionLabel("toString")).toBe("toString");
    expect(positionLabel("__proto__")).toBe("__proto__");
  });
});

describe("編集欄の初期値(positionForEdit)", () => {
  it("いまの4語はそのまま選ばれた状態で開く", () => {
    for (const p of POSITIONS) expect(positionForEdit(p)).toBe(p);
  });

  // これが移行の本体。開いて保存するだけで新しい語で書き直される。
  it("旧い語は新しい語が選ばれた状態で開く(保存すれば書き直される)", () => {
    expect(positionForEdit("学生（音大）")).toBe("学生（音楽専門）");
    expect(positionForEdit("講師・プロ")).toBe("職業音楽家");
    expect(positionForEdit("中学吹奏楽部")).toBe("学生");
  });

  it("「独学」は未選択で開く(選び直してもらう)", () => {
    expect(positionForEdit("独学")).toBe("");
  });

  it("空・未知の語は未選択で開く", () => {
    expect(positionForEdit(undefined)).toBe("");
    expect(positionForEdit("")).toBe("");
    expect(positionForEdit("なにか")).toBe("");
    expect(positionForEdit("constructor")).toBe("");
  });
});

describe("絞り込み(filterUsers)は旧い語の人も拾う", () => {
  const users = [
    { uid: "a", position: "学生（音大）" },
    { uid: "b", position: "学生（音楽専門）" },
    { uid: "c", position: "講師・プロ" },
    { uid: "d", position: "独学" },
  ];

  it("「学生（音楽専門）」で絞ると、旧い「学生（音大）」の人も当たる", () => {
    expect(filterUsers(users, { position: "学生（音楽専門）" }).map((u) => u.uid)).toEqual(["a", "b"]);
  });

  it("「職業音楽家」で絞ると、旧い「講師・プロ」の人も当たる", () => {
    expect(filterUsers(users, { position: "職業音楽家" }).map((u) => u.uid)).toEqual(["c"]);
  });

  it("「独学」の人はどの属性の絞り込みにも当たらない(指定なしなら出る)", () => {
    for (const p of POSITIONS) {
      expect(filterUsers(users, { position: p }).map((u) => u.uid)).not.toContain("d");
    }
    expect(filterUsers(users, { position: ANY }).map((u) => u.uid)).toContain("d");
  });
});

// ------------------------------------------------------------------
// firestore.rules の属性の門を**実際に評価する**
//
// 写真の門(avatarVerdict.test.js)と同じく、式を括弧の釣り合いで切り出して JS で走らせる。
// ただし**そのままでは走らせられない**: ルールの `x in [一覧]` は「一覧に含まれるか」だが、
// JS の `in` は「添字(キー)が在るか」を見る。`'学生' in ['学生']` は JS では false になる。
// 置き換えずに評価すると前半が常に偽になり、**構造上落ちない検査**になる。
// だから `X in [一覧]` を `[一覧].includes(X)` に書き換えてから評価する。
//
// 掴めること: 門の論理(短絡・反転・節の削除)。掴めないこと: Firestore の実際の型変換、
// 他の節との相互作用。**実機待ち。**
// ------------------------------------------------------------------
const readRoot = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const codeOf = (t) => t.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

function extractPositionGuard(rulesCode) {
  const key = "(request.resource.data.position in [";
  const at = rulesCode.indexOf(key);
  if (at < 0) throw new Error("firestore.rules に属性の門が無い");
  let depth = 0; let i = at;
  for (; i < rulesCode.length; i++) {
    if (rulesCode[i] === "(") depth += 1;
    else if (rulesCode[i] === ")") { depth -= 1; if (depth === 0) { i += 1; break; } }
  }
  if (depth !== 0) throw new Error("属性の門の括弧が閉じていない");
  return { expr: rulesCode.slice(at, i), at };
}

describe("firestore.rules の属性の門を実際に評価する", () => {
  const rules = codeOf(readRoot("../../firestore.rules"));
  const { expr, at } = extractPositionGuard(rules);
  const js = expr.replace(/([A-Za-z_][\w.]*) in (\[[^\]]*\])/g, "$2.includes($1)");
  const allows = new Function("request", "resource", `return (${js});`);
  const req = (position) => ({ resource: { data: { position } } });
  const res = (position) => (position === undefined ? null : { data: { position } });

  it("式を切り出せ、一覧の in を includes へ書き換えられている(空回りしていない)", () => {
    expect(expr).toContain("resource.data.position");
    expect(js).toContain(".includes(request.resource.data.position)");
    expect(js).not.toMatch(/position in \[/);
  });

  it("門は users の create / update の規則の中に在る", () => {
    const start = rules.indexOf("allow create, update:");
    const end = rules.indexOf("ageConfirmed == true;");
    expect(start).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(start);
    expect(at).toBeLessThan(end);
  });

  it("新しく作るとき、いまの4語は通る", () => {
    for (const p of POSITIONS) expect(allows(req(p), res(undefined))).toBe(true);
  });

  it("新しく作るとき、旧い語も任意の文字列も通らない", () => {
    for (const p of Object.keys(LEGACY_POSITIONS)) expect(allows(req(p), res(undefined))).toBe(false);
    expect(allows(req("独学"), res(undefined))).toBe(false);
    expect(allows(req("中傷の文字列"), res(undefined))).toBe(false);
  });

  // **これが便AI の中身。** 旧い語のままでも、公開の切り替え・アイコン・練習記録は書ける。
  it("旧い語が載っている人が、その語のまま書き戻すのは通る", () => {
    for (const p of [...Object.keys(LEGACY_POSITIONS), "独学"]) {
      expect(allows(req(p), res(p))).toBe(true);
    }
  });

  it("旧い語から、いまの4語へ書き直すのは通る(移行)", () => {
    expect(allows(req("学生（音楽専門）"), res("学生（音大）"))).toBe(true);
    expect(allows(req("職業音楽家"), res("講師・プロ"))).toBe(true);
    expect(allows(req("学生"), res("独学"))).toBe(true);
  });

  it("旧い語へ、あるいは別の旧い語へ書き換えるのは通らない(旧い語を増やさない)", () => {
    expect(allows(req("講師・プロ"), res("学生（音大）"))).toBe(false);
    expect(allows(req("学生（音大）"), res("学生（音楽専門）"))).toBe(false);
    expect(allows(req("独学"), res("社会人"))).toBe(false);
    expect(allows(req("中傷の文字列"), res("社会人"))).toBe(false);
  });
});
