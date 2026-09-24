import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REPORT_REASONS, buildReportDoc, buildFlagDoc, hideFlagged, hideFlaggedIdeals, reportEntryVisible } from "./report.js";

const RULES = readFileSync(fileURLToPath(new URL("../../firestore.rules", import.meta.url)), "utf8");
// 【綴りを数える検査はコメントを剥がしてから】pitch-test の codeOf() と同じ考え方。
// 剥がさずに数えると、「notBanned() が要る」と**説明しているコメント**自身が
// 数に入って、実際の配線を1本外しても通ってしまう(実際にこれを踏んだ)。
const RULES_CODE = RULES.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("REPORT_REASONS", () => {
  // 【この検査がいちばん大事】列挙が片側だけ増えると、クライアントは通してルールが弾く。
  // 保存の瞬間にだけ失敗する = 一番わかりにくい壊れ方になる。
  it("Firestore ルールの列挙と一致する", () => {
    const m = /request\.resource\.data\.reason in \[([^\]]+)\]/.exec(RULES);
    expect(m, "ルールに reason の列挙が見つからない").not.toBeNull();
    const inRules = m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    expect(inRules).toEqual(REPORT_REASONS);
  });

  // 【便AH 2026-09-23 決定8】写真を使えるようにしたので 3 → 5。
  // 見ているのは数ではなく**自由記述の逃げ道が無いこと**なので、
  // 列挙が固定の配列であることと、写真の2つが入っていることを併せて見る。
  // 【便AW 2026-09-24 本人指示】「他人が写っている」を外して 5 → 4。
  it("自由記述の逃げ道を持たない(列挙の4つだけ)", () => {
    expect(REPORT_REASONS).toEqual(["不適切なニックネーム", "なりすまし", "アイコンの写真が不適切", "その他"]);
    expect(REPORT_REASONS).toContain("アイコンの写真が不適切");
    expect(REPORT_REASONS).not.toContain("他人が写っている");
    expect(REPORT_REASONS[REPORT_REASONS.length - 1]).toBe("その他");
  });
});

describe("buildReportDoc", () => {
  const ok = { targetUid: "them", reporterUid: "me", reason: "なりすまし" };

  it("ルールが要求する docId と5つの鍵を返す", () => {
    const r = buildReportDoc(ok, new Date("2026-09-10T01:00:00Z"));
    expect(r.id).toBe("them_me");
    expect(Object.keys(r.doc).sort()).toEqual(
      ["createdAt", "reason", "reporterUid", "status", "targetUid"]);
    expect(r.doc.status).toBe("open"); // ルールが == 'open' を要求している
    expect(r.doc.createdAt).toBe("2026-09-10T01:00:00.000Z");
  });

  it("自分は通報できない", () => {
    expect(buildReportDoc({ ...ok, targetUid: "me" })).toHaveProperty("error");
  });

  it("列挙にない理由は弾く", () => {
    expect(buildReportDoc({ ...ok, reason: "きらい" })).toHaveProperty("error");
    expect(buildReportDoc({ ...ok, reason: "" })).toHaveProperty("error");
  });

  it("相手や自分の uid が無ければ弾く", () => {
    expect(buildReportDoc({ ...ok, targetUid: "" })).toHaveProperty("error");
    expect(buildReportDoc({ ...ok, reporterUid: null })).toHaveProperty("error");
  });
});

describe("buildFlagDoc", () => {
  // 【通報者を入れない】flags は誰でも読めるので、入れると
  // 「誰が誰を通報したか」が世界中に見える。
  it("createdAt だけを持つ(通報者を入れない)", () => {
    const d = buildFlagDoc(new Date("2026-09-10T01:00:00Z"));
    expect(Object.keys(d)).toEqual(["createdAt"]);
  });
});

describe("hideFlagged", () => {
  const users = [{ uid: "a" }, { uid: "b" }, { uid: "me" }];

  it("通報された人を落とす", () => {
    expect(hideFlagged(users, new Set(["b"])).map((u) => u.uid)).toEqual(["a", "me"]);
  });

  // 【自分だけは残す】本人の画面から自分が消えると、何が起きたのか分からないまま
  // 居なくなる。本人にはマイページの告知で理由を伝えるので、一覧には残す。
  it("自分は落とさない", () => {
    expect(hideFlagged(users, new Set(["me"]), "me").map((u) => u.uid)).toEqual(["a", "b", "me"]);
  });

  it("myUid を渡さなければ自分も落ちる(既定は他人の画面)", () => {
    expect(hideFlagged(users, new Set(["me"])).map((u) => u.uid)).toEqual(["a", "b"]);
  });

  it("配列でも Set でも同じ", () => {
    expect(hideFlagged(users, ["b"]).map((u) => u.uid)).toEqual(["a", "me"]);
  });

  it("空や null で壊れない", () => {
    expect(hideFlagged(null, null)).toEqual([]);
    expect(hideFlagged(users, null).map((u) => u.uid)).toEqual(["a", "b", "me"]);
  });
});

describe("hideFlaggedIdeals", () => {
  const ideals = [{ ownerUid: "a" }, { ownerUid: "b" }, { ownerUid: "me" }];

  it("所有者が通報されている目安を落とす", () => {
    expect(hideFlaggedIdeals(ideals, new Set(["b"])).map((i) => i.ownerUid)).toEqual(["a", "me"]);
  });

  it("自分の目安は残す", () => {
    expect(hideFlaggedIdeals(ideals, new Set(["me"]), "me").map((i) => i.ownerUid)).toEqual(["a", "b", "me"]);
  });
});

describe("firestore.rules(通報まわり)", () => {
  // 【綴りで縛る】ここが緩むと、通報された本人が自分で解除できたり、
  // 誰が通報したかが読めたりする。値ではなく**規則の存在**を見る。
  it("flags は本人が消せない(解除は運営者のコンソールだけ)", () => {
    const flags = RULES.slice(RULES.indexOf("match /flags/"), RULES.indexOf("match /reports/"));
    expect(flags).toMatch(/allow delete: if false;/);
  });

  it("reports はクライアントから読めない", () => {
    const reports = RULES.slice(RULES.indexOf("match /reports/"), RULES.indexOf("match /banned/"));
    expect(reports).toMatch(/allow read: if false;/);
    // update を許すと、後から理由や時刻を書き換えられる
    expect(reports).toMatch(/allow update, delete: if false;/);
  });

  it("自分自身は通報できない(flags / reports の両方)", () => {
    const flags = RULES.slice(RULES.indexOf("match /flags/"), RULES.indexOf("match /reports/"));
    expect(flags).toMatch(/request\.auth\.uid != targetUid/);
    const reports = RULES.slice(RULES.indexOf("match /reports/"), RULES.indexOf("match /banned/"));
    expect(reports).toMatch(/targetUid != request\.auth\.uid/);
  });

  // 【存在ガードの検査 2026/09/10】この形の罠は2度目(1度目は任意キーの型検査)。
  // 「無いかもしれないもの」を見る式は、必ず「無い場合」を先に通す。
  it("存在しないドキュメントの削除で拒否されない(ideals)", () => {
    const ideals = RULES_CODE.slice(RULES_CODE.indexOf("match /ideals/"));
    const del = ideals.slice(ideals.indexOf("allow delete:"));
    expect(del).toMatch(/resource == null \|\| request\.auth\.uid == resource\.data\.ownerUid/);
  });

  // flags の1件読みは「まだ通報されていない = ドキュメントが無い」が普通の状態。
  // resource を見る式にすると、その普通の状態で拒否される。
  it("flags の1件読みは resource を見ない(無いのが普通の状態)", () => {
    const flags = RULES_CODE.slice(RULES_CODE.indexOf("match /flags/"), RULES_CODE.indexOf("match /reports/"));
    expect(flags).toMatch(/allow get: if true;/);
  });

  it("banned はクライアントから読み書きできない", () => {
    expect(RULES).toMatch(/match \/banned\/\{uid\} \{ allow read, write: if false; \}/);
  });

  // BAN された端末は書けない。プロフィール・目安・通報の4経路すべてに掛ける。
  it("BAN のガードが書き込みの経路すべてに掛かっている", () => {
    expect(RULES_CODE).toMatch(/function notBanned\(\)/);
    // 定義1 + 使い手4(users / ideals / flags / reports)
    expect(RULES_CODE.match(/notBanned\(\)/g)).toHaveLength(5);
  });
});

// 【便AG 2026-09-23 本人裁定「案A」】通報の入口を裏(プロフィール面)だけに寄せた。
// 表(音のデータ)は縦に長く、末尾に置くと「目安に設定」の帯の下に埋もれる ──
// 実際に本人から「通報機能がアプリ側でなくなっている」と報告が出たのがこの形。
// **綴りではなく振る舞いを見る。** 条件が逆に書き換わったらここが落ちる。
describe("通報の入口を出すか(reportEntryVisible)", () => {
  const OTHER = { side: "profile", personUid: "u-them", myUid: "u-me" };

  it("裏で、相手が他人なら出す", () => {
    expect(reportEntryVisible(OTHER)).toBe(true);
  });

  it("表(音のデータ)では出さない ── ここが便AG の要点", () => {
    expect(reportEntryVisible({ ...OTHER, side: "data" })).toBe(false);
  });

  it("自分自身のときは、裏でも出さない(ルールも同じ条件を持つ)", () => {
    expect(reportEntryVisible({ ...OTHER, personUid: "u-me" })).toBe(false);
  });

  it("相手の uid が無いときは出さない", () => {
    expect(reportEntryVisible({ ...OTHER, personUid: undefined })).toBe(false);
    expect(reportEntryVisible({ ...OTHER, personUid: "" })).toBe(false);
  });

  it("自分の uid が無い(サインインしていない)ときは出さない", () => {
    expect(reportEntryVisible({ ...OTHER, myUid: null })).toBe(false);
    expect(reportEntryVisible({ ...OTHER, myUid: "" })).toBe(false);
  });

  it("side が未知の値のときは出さない(既定で出す側へ倒さない)", () => {
    expect(reportEntryVisible({ ...OTHER, side: "gear" })).toBe(false);
    expect(reportEntryVisible({ ...OTHER, side: undefined })).toBe(false);
  });
});
