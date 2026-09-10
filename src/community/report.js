// ------------------------------------------------------------------
// 通報の純関数。**Firestore に触らない**(触るのは reportRepo.js)。
//
// 【計画5 モデレーション 2026-09-10】
// docs/superpowers/plans/2026-09-10-community-plan-5-moderation.md
//
// 【なぜ「読む側が隠す」のか】通報者は相手の users/{uid} を書けない
// (ルール: 本人のみ)。だから「通報したら相手の isPublic を落とす」は書けない。
// Cloud Functions も使わない(2026-09-02 設計書の決定1)。そこで通報を別の集合
// (flags)に置き、一覧を読む側がそれを見て当該 uid を落とす。反映は即時。
//
// 【ブロックは作らない】2026-09-10 本人裁定。利用者どうしが接触する経路
// (メッセージ・コメント・フォロー)が無く、他人から受け取るのはニックネームと
// 数値だけなので、通報による全体非公開で足りると判断した。
// ------------------------------------------------------------------

// 【理由は列挙で固定する】自由記述を置かない。
// 公開はされないとはいえ、許すと「自由入力はニックネームだけ」という
// 設計書 §8.1 の前提が1つ崩れる(その前提の上に自動モデレーションが乗っている)。
// **firestore.rules の reports の reason の写し。片方だけ直さないこと。**
// 同期は report.test.js の「Firestore ルールの列挙と一致する」で検査している。
export const REPORT_REASONS = ["不適切なニックネーム", "なりすまし", "その他"];

/** 通報のドキュメントを組む。ルールが要求する形をそのまま返す。 */
export function buildReportDoc({ targetUid, reporterUid, reason }, now = new Date()) {
  if (typeof targetUid !== "string" || targetUid.length === 0) return { error: "通報の相手が分かりません" };
  if (typeof reporterUid !== "string" || reporterUid.length === 0) return { error: "サインインし直してください" };
  // 【自分は通報できない】ルールも同じ条件を持つ。ここで止めるのは、
  // 弾かれると分かっている書き込みを投げないため(画面には出ない経路だが、
  // 呼び出し側が uid を取り違えたときに黙って失敗するのを避ける)。
  if (targetUid === reporterUid) return { error: "自分は通報できません" };
  if (!REPORT_REASONS.includes(reason)) return { error: "理由を選んでください" };
  return {
    id: `${targetUid}_${reporterUid}`,
    doc: {
      targetUid,
      reporterUid,
      reason,
      createdAt: now.toISOString(),
      // 運営者がコンソールで確認するときの状態。クライアントは "open" しか書けない
      // (ルールが == 'open' を要求している)。棄却・確定は運営者がコンソールで書き換える。
      status: "open",
    },
  };
}

/** flags に置くドキュメント。**通報者は入れない**(flags は誰でも読めるため)。 */
export function buildFlagDoc(now = new Date()) {
  return { createdAt: now.toISOString() };
}

/**
 * 隠す相手を落とす。**数える前に通す**のが要点 ──
 * 順位やシェアの母数から消えるのは、落としたあとに数えるからである。
 *
 * @param users 公開ユーザーの配列(uid を持つ)
 * @param flaggedUids Set<string> か配列。flags に居る uid
 * @param myUid 自分の uid。**自分は落とさない**(下記)
 *
 * 【自分だけは残す】通報された本人の画面から自分が消えると、
 * 「何が起きたのか分からないまま居なくなる」という一番わかりにくい壊れ方になる。
 * 本人にはマイページで理由を伝える(設計書 §8.1 追記の1「黙って消さない」)ので、
 * 一覧からも消さずに残す。他人の画面からは消えている。
 */
export function hideFlagged(users, flaggedUids, myUid = null) {
  const set = flaggedUids instanceof Set ? flaggedUids : new Set(flaggedUids ?? []);
  return (users ?? []).filter((u) => !set.has(u?.uid) || (myUid != null && u?.uid === myUid));
}

/** 目安も同じ規則で落とす。こちらは所有者の uid が ownerUid に入っている。 */
export function hideFlaggedIdeals(ideals, flaggedUids, myUid = null) {
  const set = flaggedUids instanceof Set ? flaggedUids : new Set(flaggedUids ?? []);
  return (ideals ?? []).filter((i) => !set.has(i?.ownerUid) || (myUid != null && i?.ownerUid === myUid));
}
