import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REPORT_REASONS, buildReportDoc, buildFlagDoc, hideFlagged, hideFlaggedIdeals } from "./report.js";

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

  it("自由記述の逃げ道を持たない(3つだけ)", () => {
    expect(REPORT_REASONS).toHaveLength(3);
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
