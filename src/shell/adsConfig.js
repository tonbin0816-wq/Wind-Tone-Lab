// 【殻 S3 → 便S4】広告の ID。**値の唯一の答えはここ**(と Info.plist の GADApplicationIdentifier の1行)。秘密ではない(アプリの中に入る値)。
//
// 【便S4 2026-10-25 本人「これでリリースしよう」】本番の ID に切り替えた。ただし**開発版(Ficus Dev)は試験の広告のまま**:
//   ・本番(codemagic.yaml の ios-release / ios-testflight。同梱の資産を読むビルド)… 本人の AdMob の値(下の ADMOB_*)
//   ・開発版(ios-dev。server.url で Vercel の配信を読むビルド)… Google の demo の値(下の ADMOB_DEV_*)
//     本人が毎日触るので、本物の広告を誤って押すと AdMob の無効なトラフィックになる。
// どちらのビルドかは src/shell/native.js の shellBuildKind() が決める(ページの scheme。理由はそちらの注記)。
// JS は admobIds() で選ぶ(ads.native.js)。Info.plist のアプリ ID は、開発版だけ ios-dev の手順
// (scripts/shell-ads-ids.mjs dev)が ADMOB_DEV_APP_ID_IOS に書き戻す。ios-release はビルドの前に
// 本番の値が揃っていることを確かめる(scripts/shell-ads-ids.mjs release)。
//
// 本人の値(2026-10-06 本人が AdMob で作成。殻の仕様 §7-E):
//   ・アプリ ID          ca-app-pub-8488624336436415~1796275239
//   ・バナー bottom-banner ca-app-pub-8488624336436415/6801189906
// Google の demo の値(アカウントに紐づかない。押しても誰にも課金されない)。写した元(2026-10-06 に取得・ページの Last updated 2026-10-02):
//   ・バナーの広告ユニット ID: https://developers.google.com/admob/ios/test-ads の「Demo ad units」の表の Anchored Adaptive Banner(iOS)
//   ・アプリ ID: https://developers.google.com/admob/ios/quick-start の「Update your Info.plist」の「Sample AdMob app ID」
//
// **試験の広告か本番の広告かは、ユニット ID だけで決まる**(demo のユニットは常に試験の広告を返す)。
// useTestAds(ADMOB_USE_TEST_ADS / ADMOB_DEV_USE_TEST_ADS)は initialize({ initializeForTesting }) に渡すだけで、
// プラグインの中では testingDevices(試験の端末の一覧)を登録するかどうかを決めるだけ(一覧は渡していない。AdMobPlugin.swift の
// setRequestConfiguration)。段の目印として ID と揃える(検査 src/shell/adsRelease.test.jsx・pitch-test K.19)。
//
// このファイルは何も import しない(node の手順 scripts/shell-ads-ids.mjs が npm ci の前にそのまま読むため)。

// 本番(同梱の資産を読むビルド)
export const ADMOB_USE_TEST_ADS = false;
export const ADMOB_BANNER_UNIT_ID_IOS = "ca-app-pub-8488624336436415/6801189906";
export const ADMOB_APP_ID_IOS = "ca-app-pub-8488624336436415~1796275239";   // Info.plist の GADApplicationIdentifier と同じ(検査が突き合わせる)

// 開発版(Ficus Dev。server.url で Vercel の配信を読むビルド)
export const ADMOB_DEV_USE_TEST_ADS = true;
export const ADMOB_DEV_BANNER_UNIT_ID_IOS = "ca-app-pub-3940256099942544/2435281174";
export const ADMOB_DEV_APP_ID_IOS = "ca-app-pub-3940256099942544~1458002511";   // ios-dev が Info.plist に書き戻す値

// ビルドの種類(native.js の shellBuildKind() の答え)から、initialize と showBanner に渡す値を選ぶ。
// "release" だけが本番。それ以外("dev"・"web"・知らない値)は試験の値(迷ったら本物の広告を出さない側へ倒す)。
export function admobIds(kind) {
  return kind === "release"
    ? { useTestAds: ADMOB_USE_TEST_ADS, bannerUnitId: ADMOB_BANNER_UNIT_ID_IOS }
    : { useTestAds: ADMOB_DEV_USE_TEST_ADS, bannerUnitId: ADMOB_DEV_BANNER_UNIT_ID_IOS };
}
