// ------------------------------------------------------------------
// 通報の純関数。**Firestore に触らない**(触るのは reportRepo.js)。
//
// 【計画5 モデレーション 2026-09-10】
// docs/superpowers/plans/2026-09-10-community-plan-5-moderation.md
//
// 【便BG 2026-10-01 本人指示】通報で一覧から消す動き(全員の画面から隠す)をやめた。
// 通報は、運営に届く reports の書き込みだけ。以前は flags にも書き、一覧を読む側が
// flags に居る uid を落としていた(hideFlagged / hideFlaggedIdeals / buildFlagDoc)。
// クライアントは flags を書きも読みもしなくなったので、その3つはこのファイルから消した。
// 自分の画面から消したい人は、通報のあとに問われる「ブロックする」か、人物のページの
// 「ブロック」で消す(block.js。落とす関数は block.js が自分で持つ)。
// firestore.rules の flags の塊は変えていない ── 許されていることを使わなくなっただけ。
//
// 【ブロックは通報と別に作った】【便BE 2026-09-30 本人裁定「B」】
// 2026-09-10 の本人裁定は「ブロックは作らない」だった(利用者どうしが接触する経路 ──
// メッセージ・コメント・フォロー ── が無く、通報による全体非公開で足りるという判断)。
// これを**覆した**。「自分の画面からだけ消し、自分で解除できる」一手が別に要る(App Store の審査でも必須)。
// ブロックは block.js(純関数)が持つ。サーバーには何も書かず、この端末に保存する。
// ------------------------------------------------------------------

// 【理由は列挙で固定する】自由記述を置かない。
// 公開はされないとはいえ、許すと「自由入力はニックネームだけ」という
// 設計書 §8.1 の前提が1つ崩れる(その前提の上に自動モデレーションが乗っている)。
// **firestore.rules の reports の reason の写し。片方だけ直さないこと。**
// 同期は report.test.js の「Firestore ルールの列挙と一致する」で検査している。
// 【便AH 2026-09-23 決定8】アイコンに写真を使えるようにしたので、理由を2つ足した。
// 「その他」は末尾のまま(ENSEMBLES / GENRES と同じ作法 ── 逃げ道は最後に置く)。
export const REPORT_REASONS = [
  "不適切なニックネーム",
  "なりすまし",
  "アイコンの写真が不適切",
  // 【便AW 2026-09-24 本人指示】「通報理由から他人が写っているを削除」。firestore.rules の写しも同時に外した。
  "その他",
];

/**
 * 人物紹介シートに通報の入口(【便BG】文字は「通報」)を出すか。
 *
 * 【便AG 2026-09-23 本人裁定「案A」】判断をここへ出したのは、条件が
 * JSX の中にしか無いと**綴りを見る検査しか書けない**ため。綴りの検査は
 * 「条件が消えた」ことは掴めても「条件が逆になった」ことを掴めない。
 *
 * 規則は3つ。どれか1つでも欠けたら出さない。
 *  ・裏(プロフィール面)である ── 表(音のデータ)は縦に長く、末尾に置くと届かない。
 *    実際に本人から「通報機能がなくなっている」と報告が出たのがこの形だった。
 *  ・相手の uid と自分の uid が両方とれている。
 *  ・その2つが別人である ── 自分は通報できない(firestore.rules も同じ条件を持つ)。
 */
export function reportEntryVisible({ side, personUid, myUid }) {
  if (side !== "profile") return false;
  if (typeof personUid !== "string" || personUid.length === 0) return false;
  if (typeof myUid !== "string" || myUid.length === 0) return false;
  return personUid !== myUid;
}

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

