// ------------------------------------------------------------------
// 【便CJ 2026-10-10 本人の実機の指摘「コミュニティタブで63%くらいで止まることが多いので修正」】
// コミュニティタブの読み込み(輪と % の待ち)で、返ってこない1往復を待ち続けない上限。
//
// 63% は「アカウントの確認 + 自分のプロフィールの読み」(loadProgress.js の段 account)の行き着く値:
// 2回目以降に開いたとき(画面のコードは端末に残っていて段 chunk を通らない)は account から割り直すので、
// account の重み 35 / (35 + 20) = 63.6%。内挿は「次の段の値へ漸近して追い越さない」ので、account が終わらない間は
// 63% のまま動かない(動きを減らす設定の端末は、次の段 list の入口の 63% のまま名簿と目安の読みを待つ)。
// 待っている当のものは Firebase の1往復(匿名アカウントの確認・users の1件読み・名簿・目安)で、
// どれも進捗も時間の上限も持たない。返ってこなければ、輪はいつまでも 63% のままだった。
//
// 上限を過ぎたら**失敗として扱う**(新しい画面は作らない): アカウントの確認・プロフィールの読みは今までの
// 「通信に失敗しました」+「もう一度試す」、名簿は「みんなのデータを読み込めませんでした」、目安は空(順位とシェアは見せる)。
// 上限の値は新しく作らない: 殻が「アプリの外の答えを待つ上限」に使っている ATT_FOCUS_WAIT_MAX_MS(10 秒)を読む
// (Firestore の SDK が「つながらない」と判断するまでの時間もおおよそこの程度)。
// このファイルは firebase を import しない(呼び手が渡した約束を待つだけ)。
// ------------------------------------------------------------------
import { ATT_FOCUS_WAIT_MAX_MS } from "../shell/policy.js";

export const COMMUNITY_LOAD_MAX_MS = ATT_FOCUS_WAIT_MAX_MS;

// 上限を過ぎたことを表す失敗。code は Firestore の「期限切れ」と同じ綴り(呼び手の文言の選び方は今までの通信の失敗と同じ)。
export class CommunityLoadTimeoutError extends Error {
  constructor(ms) {
    super(`コミュニティの読み込みが ${ms}ms を過ぎても返りませんでした`);
    this.name = "CommunityLoadTimeoutError";
    this.code = "deadline-exceeded";
  }
}

// promise が ms のうちに片付かなければ CommunityLoadTimeoutError で棄却する。片付いたら時計を外す(残さない)。
// 元の約束は止められない(Firebase の読みに取り消しは無い)ので、後から返った値は捨てられる(呼び手は alive で見ている)。
export function withinLoadLimit(promise, ms = COMMUNITY_LOAD_MAX_MS) {
  let timer = 0;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CommunityLoadTimeoutError(ms)), ms);
  });
  return Promise.race([Promise.resolve(promise), limit]).finally(() => clearTimeout(timer));
}
