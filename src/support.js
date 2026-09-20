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

// 【束3 2026-09-19】アプリの中のお問い合わせフォームができたので、**画面からは
// このアドレスを出さなくなった**(src/community は mailto: を1つも持たない)。
// **定義は残す。読み手は src/support.test.js。** public/privacy.html と public/terms.html は
// 静的な HTML なのでこの定数を import できず、同じアドレスを綴りで持っている。
// App Store ガイドライン 1.2 が求める「運営者に到達できる連絡先」はその2枚が担っており、
// ここを消すと**3箇所の綴りが一致していることを見る唯一の検査が消える**。
export const SUPPORT_EMAIL = "ficus.help@gmail.com";
export const PRIVACY_URL = "/privacy.html";
export const TERMS_URL = "/terms.html";

// 【束3 2026-09-19 本人指示】本人「お問い合わせの上にレビューを送る を追加して
// タップで App Store のレビュー画面に遷移するよう機能を追加」。
//
// **まだストアに出していないので飛び先が無い。** 飛び先の無いボタンを置くのは
// DESIGN-SYSTEM §6.1.5「押しても何も起きない一手を作らない」に反するので、
// **null の間はマイページに行ごと出さない**(CommunityTab.jsx の ProfileView が出し分ける)。
//
// **ストアに出して URL が決まったら、ここを埋めると行が出る。** 綴りは
// https://apps.apple.com/app/id<数字>?action=write-review の形。
// 別タブでは開かない(便H で target="_blank" はアプリから0件にしてある)。
export const APP_STORE_REVIEW_URL = null;
