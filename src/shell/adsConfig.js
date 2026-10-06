// 【殻 S3】広告の ID。**値の唯一の答えはここ**(と Info.plist の GADApplicationIdentifier の1行)。秘密ではない(アプリの中に入る値)。
// 今は Google の demo の ID(アカウントに紐づかない。押しても誰にも課金されない)。写した元(2026-10-06 に取得・ページの Last updated 2026-10-02):
//   ・バナーの広告ユニット ID: https://developers.google.com/admob/ios/test-ads の「Demo ad units」の表の Anchored Adaptive Banner(iOS)
//   ・Info.plist のアプリ ID: https://developers.google.com/admob/ios/quick-start の「Update your Info.plist」の「Sample AdMob app ID」
// **試験の広告か本番の広告かは、ユニット ID だけで決まる**(demo のユニットは常に試験の広告を返す)。
// ADMOB_USE_TEST_ADS は広告の動きには効いていない: 渡し先の initialize({ initializeForTesting }) は、プラグインの中で
// testingDevices(試験の端末の一覧)を登録するかどうかを決めるだけで、ここでは一覧を渡していない(AdMobPlugin.swift の
// setRequestConfiguration)。この旗は「今は試験の段」の目印で、検査(pitch-test K.19)が ID との揃いを見る。
// 便S4 で本人のユニット ID のまま自分の端末で試したいときは、startAds の initialize に testingDevices(端末の ID)を渡す余地がある
// (https://developers.google.com/admob/ios/test-ads の「Enable test devices」)。
// 本番の ID は本人が AdMob で作る(殻の仕様 §7-E)。**切り替え(便S4)= この下の2つの値と、Info.plist の GADApplicationIdentifier の1行だけ**。
// 審査に出すビルドは codemagic.yaml の ios-release で作る。ios-release は、このファイルと Info.plist に demo の発行元の番号が
// 1つでも残っていればビルドの前に止まる(このファイルの注記にもその番号を書かないこと)。
export const ADMOB_USE_TEST_ADS = true;                                             // 本番の段では false(目印)
export const ADMOB_BANNER_UNIT_ID_IOS = "ca-app-pub-3940256099942544/2435281174";   // 本番では本人のバナーのユニット ID
