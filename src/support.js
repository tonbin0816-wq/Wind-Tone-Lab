// ------------------------------------------------------------------
// 運営者への連絡先と、法務文書の置き場。
//
// 【計画5 モデレーション 2026-09-10】App Store ガイドライン 1.2 は UGC のあるアプリに
// 「利用者が運営者に到達できる連絡先の公開」を求める(原文の you = 開発者)。
// App Store Connect は別に**サポートURL**(メールアドレスではなくWebページ)も要求する。
//
// 【文書は public/ に静的な HTML で置く】Vite が本番へそのまま配る。
// 独自ドメインは要らない ── いまの配信先(Vercel の無料枠)の URL がそのまま
// プライバシーポリシーURL / サポートURL として使える。
//
// 【綴りの写しは1つある】public/privacy.html と public/terms.html にも同じアドレスが
// 書かれている(静的な HTML なので import できない)。**片方だけ直すと食い違う**ので、
// src/support.test.js が両方を読んでこの定数と一致することを検査している。
// ------------------------------------------------------------------

export const SUPPORT_EMAIL = "ficus.help@gmail.com";
export const PRIVACY_URL = "/privacy.html";
export const TERMS_URL = "/terms.html";
