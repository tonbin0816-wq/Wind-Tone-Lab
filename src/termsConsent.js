// ------------------------------------------------------------------
// 【便CB 2026-10-08 本人の依頼】利用規約とプライバシーポリシーへの同意を、アプリの一番最初(はじめの案内より前)に移した。
// 本人「アプリインストールしてから同意だとコミュニティに辿り着くまでワンステップ増えてこのアプリの真価が半減するので」。
// このファイルは**判断だけ**を持つ純粋な関数(React も IndexedDB も読まない)。画面は ConsentScreen.jsx。
//
// 【同意の記録】この端末の保存(IndexedDB の kv)の1つの鍵 TERMS_CONSENT_KEY に { at, version } を持つ。
//   ・at      … 同意した日時(ISO 8601 の文字列。UTC)
//   ・version … 同意した規約の版。public/terms.html の「最終更新日」を YYYY-MM-DD にした文字列(TERMS_VERSION)
// 置き場所は はじめの案内の印(onboardingDone)と同じ層。アカウント引継は kv を丸ごと書き出す/読み戻すので、
// onboardingDone と同じく引継のファイルにも入る(backup/localStore.js の readAll)。
//
// 【誰に同意の画面を出すか】(needsConsentScreen)
//   1. 記録がある … 出さない(1回だけ)
//   2. 記録は無いが、コミュニティに参加した印(onboardingDone.join)がある … 出さない。
//      参加のときに参加のカードで同意している(便BC)。記録は**書かない**(その版に同意した事実は無いので、日時を作らない)
//   3. それ以外(入れたての人・参加していない既存の利用者) … 出す
// 見本(?tutorialpreview=1)は毎回出す(ConsentScreen.jsx の AppRoot。本物の記録は読まず・書かない)。
// ------------------------------------------------------------------

/** IndexedDB(kv)の鍵。**綴りを変えないこと** ── 変えると保存済みの同意と引継のファイルが読めなくなる。 */
export const TERMS_CONSENT_KEY = "termsConsent";

/** 同意した規約の版。public/terms.html の「最終更新日: 2026年10月8日」と同じ日(検査 termsConsent.test.js が突き合わせる)。 */
export const TERMS_VERSION = "2026-10-08";

/** 同意の記録として読める形か(日時と版の2つが文字列で揃っている)。 */
export function isConsentRecord(v) {
  return Boolean(v) && typeof v === "object" && typeof v.at === "string" && v.at !== ""
    && typeof v.version === "string" && v.version !== "";
}

/** 同意したときに保存する記録。now は検査で差し替える口。 */
export function makeConsentRecord(now = new Date()) {
  return { at: now.toISOString(), version: TERMS_VERSION };
}

/**
 * 起動の最初に同意の画面を出すか。
 * @param consent        kv の TERMS_CONSENT_KEY の値(無ければ null / undefined)
 * @param onboardingDone はじめの案内の印(normalizeOnboardingDone を通した物)。join が「参加した」の印
 */
export function needsConsentScreen({ consent, onboardingDone }) {
  if (isConsentRecord(consent)) return false;
  if (onboardingDone && onboardingDone.join === true) return false;
  return true;
}
