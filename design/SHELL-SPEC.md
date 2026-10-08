# Ficus 殻の便(Capacitor で包んで App Store へ)── 実装仕様(凍結案)

作成: 2026-10-04 / 設計役 / 対象ツリー: `.claude/worktrees/view-other-user-data-ebb07d`(`claude/batch13` = main 96dc334)
前例の書式: `ipad-spec.md`(iPad 対応の凍結仕様)。行番号は 2026-10-04 時点の作業ツリー(ずれていたら綴りで探す)。

この文書は**実装役(opus)がこれだけ読めば迷わない**ことを目的にしている。本人の作業(資格情報・コンソール)と実装の作業を分け、
どちらにも「済んだかを機械的に判定できる形」を付けた。本人の端末は PowerShell 5.1(`&&` は構文エラー。`;` でつなぐ)。

---

## 0. 本人の裁定(写し)と、この文書の決め方

| 裁定 | 内容 |
|---|---|
| 作る物 | Web 版(Vite + React)を **Capacitor の WKWebView で包んだ iOS アプリ**。Web 版(Vercel)は今後も動き続け、殻の追加で Web 版の挙動を変えない |
| 建てる場所 | 本人は Windows と iPhone だけ。iOS のビルドと署名は **Codemagic**(クラウドの Mac・無料枠 月500分・App Store Connect API キーで署名)。確認は **TestFlight** で本人の iPhone |
| 配信 | 個人・無料・日本のみ。Android は今はやらない |
| ID と名前 | バンドル ID `jp.tobine.ficus`(登録済み)。App Store Connect の枠は作成済み(名前「Ficus サックス奏者のためのチューナー&メトロノーム」・SKU `ficus-ios`)。ホーム画面の名前は **Ficus** |
| 向き | iPhone は**縦固定**。iPad は**全方向**。`UIRequiresFullScreen` は付けない。iPad のレイアウトは済(便BT/BU/BV) |
| 広告 | **AdMob のバナーを下部タブのすぐ上に1本**。計測タブにも出す。**シートが開いている間は隠す**。Web 側の受け皿 `--ad-h` → `--page-bottom-gap` は済(便BL。`?adpreview=1` で見本) |
| 秘密 | App Store Connect の API キー(.p8)とその ID は**チャットに貼らせない**。本人が Codemagic の画面にだけ入れる |
| 本人の作業 | 資格情報を作る操作(Codemagic・Firebase の iOS アプリ登録・AdMob)は本人。秘密の値(.p8・API キーの ID)と秘密でない値(AdMob のアプリ ID・広告ユニット ID・GoogleService-Info.plist の中身)は区別する(§7) |
| 語彙 | 「機材 / 機種」を使わない(既存の「機種変更」は対象外)。楽器種別は S.Sax 等 |
| 判定 | **殻の中かどうかの判定は1か所**(§1.1) |

決め方の優先順位: 本人の裁定 > DESIGN-SYSTEM.md と `【本人裁定】` の注記 > 罠の目録(BACKLOG.md 冒頭) > この文書の判断。
用語: 「殻」= Capacitor の iOS アプリ。「Web 版」= Vercel で配っている今のアプリ。「ネイティブ」= Swift 側。「実機」= TestFlight で入れた本人の iPhone。

---

## 1. 全体の構え(どの便にも共通)

### 1.1 殻の判定は `src/shell/native.js` の1か所。`@capacitor/*` の静的 import は禁止

```js
// src/shell/native.js ── 殻(Capacitor の iOS アプリ)かどうかの判定。**アプリ全体でここだけが window.Capacitor を読む。**
// Web 版(Vercel・dev サーバ・jsdom)には window.Capacitor が無いので false。殻の中では Capacitor のランタイムが
// 描画の前に window.Capacitor を置く(capacitor://localhost の起動時に注入される)。
// @capacitor/core を import しない ── Web 版のバンドルに殻の部品を1バイトも入れないため(§1.2)。
export function isNativeShell() {
  try { return typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.() === true; } catch { return false; }
}
// "ios" | "android" | "web"。殻の中では UA を見ずに答えが出る(iPad の Mac 名乗り対策。§3.9)
export function shellPlatform() {
  try { return isNativeShell() ? String(window.Capacitor.getPlatform()) : "web"; } catch { return "web"; }
}
```

- 呼び手は **`isNativeShell()` を読んで分岐する**だけ。`navigator.userAgent` や `location.protocol === "capacitor:"` で殻を見分ける綴りは**どこにも書かない**(pitch-test で禁止。§8.2)。
- 分岐の作法: **Web の枝は byte 単位で今の綴りのまま**(ipad-spec §1.3 と同じ構造の保証)。殻の枝を三項・早期 return で**足す**。`if (isNativeShell()) { … return; }` の形を基本にし、既存行は触らない。

### 1.2 ネイティブの部品(プラグイン)は `src/shell/*.native.js` に閉じ、**動的 import だけ**で読む

```
src/shell/
  native.js                 isNativeShell / shellPlatform(上)
  policy.js                 殻での振る舞いの定数と純関数(micActionOnTabLeave / metroMasterGain / adBannerMargin …)。Web からも import してよい(Capacitor に触れない)
  backupExport.native.js    @capacitor/filesystem + @capacitor/share(書き出し。§4.1)
  keepAwake.native.js       @capacitor-community/keep-awake(§4.2)
  audioSession.native.js    registerPlugin("FicusAudioSession")(自前のネイティブ部品。§4.4)
  ads.native.js             @capacitor-community/admob(§5)
  adsConfig.js              広告の ID と試験/本番の切り替え(1か所。§5.2)
```

- `*.native.js` だけが `@capacitor/core` `@capacitor/*` `@capacitor-community/*` を import してよい。他の全ファイルは **`await import("./shell/xxx.native.js")`** で、しかも `isNativeShell()` が true の枝の中でだけ読む。
- Vite はこれを別チャンクに切るので、**Web 版の `index-*.js` にはネイティブの部品が入らない**(§8.3 で `registerPlugin` の綴りが index チャンクに 0 件であることを見る)。
- `@capacitor/core` は dependencies に入れる(プラグインの peer)。静的 import は `*.native.js` の中だけ。

### 1.3 版の固定(2026-10-04 確認。全部 **exact**(`^` `~` を付けない)。上げるのは専用の便でだけ)

| パッケージ | 版 | 根拠 |
|---|---|---|
| `@capacitor/core` `@capacitor/cli`(dev) `@capacitor/ios` | **8.5.2** | https://registry.npmjs.org/@capacitor/core/latest ・ /@capacitor/cli/latest(engines node ≥ 22)・ /@capacitor/ios/latest |
| `@capacitor/share` | **8.0.3** | https://registry.npmjs.org/@capacitor/share/latest |
| `@capacitor/filesystem` | **8.1.4** | https://registry.npmjs.org/@capacitor/filesystem/latest |
| `@capacitor-community/keep-awake` | **8.0.1**(SPM 対応: Package.swift あり) | https://registry.npmjs.org/@capacitor-community/keep-awake/latest ・ https://unpkg.com/@capacitor-community/keep-awake@8.0.1/Package.swift |
| `@capacitor-community/admob` | **8.1.0**(Capacitor 8 用は v8。SPM 対応: Package.swift が Google Mobile Ads SDK 13.6.0 を固定) | https://registry.npmjs.org/@capacitor-community/admob/latest ・ https://github.com/capacitor-community/admob (README / Package.swift) |
| `@capacitor/assets`(dev) | **3.0.5** | https://registry.npmjs.org/@capacitor/assets/latest |
| `@fontsource/instrument-serif` | **5.3.0**(OFL 1.1) | https://registry.npmjs.org/@fontsource/instrument-serif/latest ・ https://unpkg.com/@fontsource/instrument-serif@5.3.0/LICENSE |
| Capacitor 8 の要件 | Node **22+**(手元は v22.20.0 で足りる)・Xcode **26.0+**・iOS **15.0+**・iOS は **SPM が既定**(CocoaPods は使わない) | https://capacitorjs.com/docs/updating/8-0 |
| Codemagic | `mac_mini_m2`・Xcode **26.2**(26.2 / 26.3 / 26.4 が提供中)・無料枠 **500 分/月**(毎月1日に戻る。超過は $0.095/分) | https://docs.codemagic.io/specs-macos/xcode-26-4 ・ https://docs.codemagic.io/billing/pricing/ |

### 1.4 リポジトリ構成の決め(新しく入るもの)

| 物 | 置き場 | git に入れるか |
|---|---|---|
| `capacitor.config.json` | リポジトリの根(付録A) | **入れる** |
| `ios/` | `npx cap add ios` が作る Xcode プロジェクト(SPM 版)。`ios/App/App/Info.plist`・`ios/App/App/AppDelegate.swift`・`ios/App/App/Base.lproj/Main.storyboard`・`ios/App/App/Assets.xcassets`・`ios/App/CapApp-SPM/Package.swift` を**手で直す**(§3) | **入れる**。`cap sync` が生成する `ios/App/App/public/` と `ios/App/App/capacitor.config.json`・`ios/App/build`・`DerivedData`・`xcuserdata` は **ios/.gitignore** で除外(テンプレートが置く。無ければ作る) |
| `codemagic.yaml` | 根(付録B) | **入れる**。秘密は1つも書かない(§8.2 が `-----BEGIN` `AuthKey_` の不在を見る) |
| `assets/logo.png`(1024×1024。`public/icon.svg` から作る) | 根の `assets/`(`@capacitor/assets` の既定の入力) | **入れる**(生成物の `ios/App/App/Assets.xcassets/AppIcon.appiconset` `Splash.imageset` も入れる) |
| `design/ring-proto.html` | `public/ring-proto.html` を**移す**(dist に試作が入っていた件。§3.8) | 入れる |
| `package.json` | `"ficus": "file:.claude/worktrees/view-other-user-data-ebb07d"` の行を**消す**(HEAD に入っている。Codemagic の `npm ci` は存在しない path で**必ず落ちる**)。依存の追加(§1.3)。`npm install` で lock を作り直す | 入れる |

- **Vercel への影響**: 根に `ios/` `codemagic.yaml` が増えても Vercel は `npm run build` の出力(`dist/`)しか見ない。`package.json` の依存が増えるぶん install が長くなるだけ。
- **`ios/` の生成は Windows でできる**(`npx cap add ios` はファイルを写すだけ。Xcode は要らない。CocoaPods は SPM 既定なので要らない)。もし CLI が OS を理由に拒んだら、付録B-2 の「bootstrap」ワークフローで Codemagic に作らせ、成果物の zip を実装役が展開してコミットする。

---

## 2. 便の分け方と順番

4便。**各便が単独で合格ラインを持つ**。Windows で確かめられるもの(W)と、実機でしか確かめられないもの(T)を便ごとに分ける。

| 便 | 中身 | 合格ライン(W) | 実機(T) | 前に済んでいる必要がある本人の作業 |
|---|---|---|---|---|
| **便S1 殻の骨** | Capacitor 導入・`ios/` 生成・Info.plist(説明文・向き・暗号化の申告)・自前の ViewController(拡大)・`codemagic.yaml`・アイコンと起動画面・Google Fonts の同梱・ring-proto の移動・package.json の修正・`isNativeShell`・Firebase の `initializeAuth`・iPad の端末種別 | 3ゲート + 新規検査 §8.1-S1 + Web 退行なし §8.3 | 起動する・計測が動く・コミュニティに入れる(匿名認証)・写真が選べる・向きが縦固定・指2本で拡大できる | §7-A(Codemagic)・§7-B(API キー)・§7-C(署名)・§7-D(Firebase の API キーの制限の確認)。**TestFlight に入れる段で**必要。コードは先に書ける |
| **便S2 殻の中の振る舞い** | 書き出しを Share へ・読み込みの確認・スリープ防止をネイティブへ・計測タブを離れたらマイクを止める・音の出口をスピーカーへ(+メトロノームのゲイン)・Web 版の記録の移し方の案内 | 3ゲート + §8.1-S2 | 書き出しが「ファイル」に保存できる・読み戻せる・録音中に画面が消えない・他タブで橙の印が消える・メトロノームが大きく割れずに鳴る | S1 と同じ(TestFlight の仕組みが動いていること) |
| **便S3 広告と ATT** | AdMob のバナー・`--ad-h` を実寸で・シート中は隠す・ATT・privacy.html の改定・ID の切り替えを1か所に | 3ゲート + §8.1-S3 | 帯が下部タブの直上に出る・シートで消えて戻る・ATT の許可画面が出る・下端の余白が帯ぶん上がる | §7-E(AdMob の登録)。試験用 ID で先に書ける |
| **便S4 提出の準備** | 本番 ID への切り替え・版の数字・審査の点検(4.2 / 5.1.1 / 1.2)・栄養表示・スクリーンショット・審査メモ | 3ゲート + §8.1-S4 | 本番 ID のビルドで帯が出る(押さない) | §7-F(TestFlight 済)・§7-G(App Store Connect の入力) |

- S1 と S2 は同じ TestFlight ビルドで確かめてもよいが、**便としては分けて検収する**(S1 の検査は S2 の有無に依らず通る)。
- 順番は S1 → S2 → S3 → S4 の一本道。S3 の実装は S2 と並行してよいが、検収は S2 の後。
- 3ゲート = `npm run test` / `node scripts/pitch-test.mjs` / `npm run build`。vitest の件数は毎回見る(「PASS (0)」は合格ではない。メモリ)。

---

## 3. 便S1 殻の骨 ── 詳細

### 3.1 導入の手順(実装役・Windows)

```
npm pkg delete dependencies.ficus
npm install --save-exact @capacitor/core@8.5.2 @capacitor/ios@8.5.2
npm install --save-exact --save-dev @capacitor/cli@8.5.2 @capacitor/assets@3.0.5
npm install --save-exact @fontsource/instrument-serif@5.3.0
npx cap init Ficus jp.tobine.ficus --web-dir dist     # 生成物の capacitor.config.* を 付録A の JSON に置き換える(TS 版が出来たら消す)
npm run build
npx cap add ios                                       # SPM 版。ios/ ができる
```

- `npx cap sync ios` は Windows でも走る(web の写しと Package.swift の更新)。生成物(`ios/App/App/public` 等)が `ios/.gitignore` で除外されていることを `git status` で確かめる。除外されていなければ `ios/.gitignore` に `App/App/public` `App/App/capacitor.config.json` `App/App/config.xml` `App/build` `App/Pods` `App/output` `DerivedData` `xcuserdata` を書く。
- **Firebase に触らない。匿名認証を含め資格情報を作らない**(工程の掟)。

### 3.2 `capacitor.config.json`(付録A)の決め

| 鍵 | 値 | 理由 |
|---|---|---|
| `appId` | `jp.tobine.ficus` | 本人裁定 |
| `appName` | `Ficus` | ホーム画面の名前 |
| `webDir` | `dist` | Vite の出力 |
| `zoomEnabled` | `true` | false(既定)だと Capacitor が scrollView の拡大そのものを止める(CAPBridgeViewController: `if !configuration.zoomingEnabled { aWebView.scrollView.delegate = … }`)。指2本の拡大(F-16)を残すため true。作者の `maximum-scale` の扱いは §3.5 |
| `backgroundColor` | `#FFFFFF` | `--c-bg`(index.html の theme-color と同じ) |
| `server.hostname` / `server.iosScheme` | 書かない(既定 `localhost` / `capacitor` → オリジンは `capacitor://localhost`) | https://capacitorjs.com/docs/config |
| `ios.contentInset` | 書かない(既定 `never`) | `viewport-fit=cover` + `env(safe-area-inset-*)` を Web 側が既に扱っている(index.css 262-269) |
| `ios.preferredContentMode` | 書かない | iPad の UA 問題は §3.9 の `shellPlatform()` で解く(UA に依らない) |
| `server.url` | **書かない**(書くと Vercel を表示する Web ラッパーになり、4.2 の論点そのもの) | ─ |

### 3.3 `ios/App/App/Info.plist` に足す・直す鍵(S1 ぶん。S3 で足すものは §5.4)

テンプレートの既存キーは残し、以下を追加・置換する。文字列は日本語(日本のみ配信。`CFBundleDevelopmentRegion` を `ja` にする)。

| 鍵 | 値 |
|---|---|
| `CFBundleDisplayName` | `Ficus` |
| `CFBundleDevelopmentRegion` | `ja` |
| `NSMicrophoneUsageDescription` | `音程・音量・音色を計測するために、マイクで演奏を聴き取ります。録音した音声は端末の中だけで解析し、サーバーへ送りません。` |
| `NSCameraUsageDescription` | `コミュニティのアイコンに使う写真を撮るために使います。` |
| `NSPhotoLibraryUsageDescription` | `コミュニティのアイコンに使う写真を選ぶために使います。` |
| `ITSAppUsesNonExemptEncryption` | `false`(通信は HTTPS だけ。TestFlight の「輸出コンプライアンス」の質問を毎回出さないため) |
| `UISupportedInterfaceOrientations` | `UIInterfaceOrientationPortrait` **だけ**(iPhone 縦固定) |
| `UISupportedInterfaceOrientations~ipad` | `UIInterfaceOrientationPortrait` `UIInterfaceOrientationPortraitUpsideDown` `UIInterfaceOrientationLandscapeLeft` `UIInterfaceOrientationLandscapeRight` の4つ |
| `UIRequiresFullScreen` | **書かない**(あれば消す) |

- 写真の選択(`<input type="file" accept={PHOTO_ACCEPT}>`。CommunityTab.jsx:1232)は WKWebView が「写真を撮る / フォトライブラリ / ファイル」を出す。カメラとフォトの説明文が無いと**「写真を撮る」で落ちる**(https://developer.apple.com/forums/thread/772332)。
- マイクの許可は **OS の許可が1回だけ**。Capacitor の WebViewDelegationHandler は WebKit 側の「"localhost" にマイクの使用を許可しますか」を `decisionHandler(.grant)` で自動で通す(https://github.com/ionic-team/capacitor/blob/main/ios/Capacitor/Capacitor/WebViewDelegationHandler.swift)。→ §4.3 の「タブを離れたら止める」の前提。
- `window.confirm`(読み戻しの確認。BackupPanel.jsx:91)はネイティブの UIAlertController で出る(同ファイルの `runJavaScriptConfirmPanelWithMessage`)。変更不要。

### 3.4 自前の ViewController(`ios/App/App/AppDelegate.swift` の**末尾に追記**。新しい .swift ファイルは作らない)

新しいファイルを足すと `project.pbxproj` を手で編集することになる。AppDelegate.swift は既にターゲットに入っているので、そこへクラスを**追記**する(付録D の全文)。

```swift
// 【殻 S1】Capacitor の ViewController を継ぐ。目的は2つ: (1) WKWebView の拡大の規則を Safari と同じにする
// (2) 自前のネイティブ部品(音の出口。便S2)を登録する。
class FicusViewController: CAPBridgeViewController {
    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let c = super.webViewConfiguration(for: instanceConfiguration)
        c.ignoresViewportScaleLimits = true   // §3.5
        return c
    }
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FicusAudioSessionPlugin())   // §4.4(S1 では空の実装でも登録しておく)
    }
}
```

- `webViewConfiguration(for:)` `capacitorDidLoad()` は `open`(https://github.com/ionic-team/capacitor/blob/main/ios/Capacitor/Capacitor/CAPBridgeViewController.swift)。登録の作法は https://capacitorjs.com/docs/ios/custom-code 。
- `ios/App/App/Base.lproj/Main.storyboard` の `customClass="CAPBridgeViewController" customModule="Capacitor"` を **`customClass="FicusViewController" customModule="App" customModuleProvider="target"`** に書き換える(https://capacitorjs.com/docs/ios/viewcontroller の「Identity Inspector で class を変える」を XML で行う)。`App` はターゲットのモジュール名(PRODUCT_MODULE_NAME)。
- Swift は Windows ではコンパイルできない。**誤りは Codemagic のビルドで初めて出る**。付録D を一字一句写す。

### 3.5 拡大(不都合7): `ignoresViewportScaleLimits = true` + 今の `maximum-scale=1` のまま

- 今: 起動時に iOS なら viewport に `maximum-scale=1`(src/iosViewport.js。入力欄の自動拡大を止める)。Safari はこの上限を指2本の拡大には使わないので F-16(評価グラフの拡大)が残る。WKWebView は既定で上限を守る(`ignoresViewportScaleLimits` 既定 NO)ので、そのままだと**指2本の拡大が消える**。
- 決め: `ignoresViewportScaleLimits = true`(§3.4)で **WKWebView を Safari と同じ規則にする**。この旗は「user-scalable=no / maximum-scale を**指2本の拡大だけ**無視する」ためのもの(WebKit r203075 / bug 159668「Ignoring user-scalable=no should only affect pinch to zoom on iOS」)。入力欄の自動拡大は作者の上限を見るので止まったまま。
- iosViewport.js は**触らない**(殻の UA は iPhone / iPad なので `isIOSDevice` は true → 今までどおり上限が付く)。pitch-test 88.4 もそのまま通る。
- 実機の点検(T): データタブの評価グラフを指2本で広げられる / 計測タブの設定行の入力欄(12〜15px)を押しても画面が寄らない。**広げられなければ** F-16 は殻では諦める(他に手は無い。DESIGN-SYSTEM に「殻では無効」と書く)。寄ってしまうなら受け入れる(便BB の前の状態に戻るだけ)。

### 3.6 `codemagic.yaml`(付録B)の決め

| 項目 | 値 | 理由 |
|---|---|---|
| `instance_type` | `mac_mini_m2` | 無料枠の対象 |
| `environment.xcode` | `26.2` | Capacitor 8 は Xcode 26.0+(§1.3)。Codemagic に 26.2 がある |
| `environment.node` | `22` | Capacitor CLI の engines |
| `integrations.app_store_connect` | `ficus-asc`(本人が Codemagic に付ける**キーの名前**。§7-B) | 署名と TestFlight 送信の両方がこれを使う |
| `ios_signing` | `distribution_type: app_store` / `bundle_identifier: jp.tobine.ficus` | Codemagic が本人の上げた証明書とプロファイルから一致するものを選ぶ(§7-C) |
| 手順 | `npm ci` → `npm run build` → `npx cap sync ios` → `cd ios/App; agvtool new-version -all $BUILD_NUMBER` → `xcode-project use-profiles` → `xcode-project build-ipa --project ios/App/App.xcodeproj --scheme App` | SPM 版なので `pod install` は無い。`build-ipa` は `--project` を受ける(https://github.com/codemagic-ci-cd/cli-tools/blob/master/docs/xcode-project/build-ipa.md)。ビルド番号は Codemagic の `$BUILD_NUMBER`(単調増加)|
| 環境変数 | グループ `ficus_firebase`: `VITE_FIREBASE_API_KEY` `VITE_FIREBASE_AUTH_DOMAIN` `VITE_FIREBASE_PROJECT_ID` `VITE_FIREBASE_APP_ID`(値は Vercel の環境変数と同じ。本人が Codemagic に入れる。§7-D) | Vite はビルド時に埋め込む。無いとコミュニティタブが `FirebaseConfigMissingError` |
| `publishing.app_store_connect` | `auth: integration` / `submit_to_testflight: true` / `submit_to_app_store: false` | TestFlight までを自動。審査提出は本人が App Store Connect で押す |
| 起動 | **手で開始**(Codemagic の「Start new build」)。タグ `ios-v*` の push でも動く設定を書くが、無料枠を守るため最初は手で | 1回 15〜25 分の見込み(SPM が Google Mobile Ads SDK を取るので S3 以降は長い)。500 分 ≈ 20〜30 回 |
| artifacts | `build/ios/ipa/*.ipa` と dSYM | ─ |

### 3.7 アイコンと起動画面

```
node -e "require('sharp')('public/icon.svg').resize(1024,1024).png().toFile('assets/logo.png')"   # sharp は @capacitor/assets の依存として入っている
npx capacitor-assets generate --ios --iconBackgroundColor '#174585' --splashBackgroundColor '#FFFFFF' --splashBackgroundColorDark '#FFFFFF'
```

- `assets/logo.png` は 1024×1024・**透過なし**(icon.svg は紺 `#174585` の矩形が地)。起動画面は白地の中央にロゴ(`Splash.imageset` 2732px)。生成物を `ios/App/App/Assets.xcassets/` にコミットする(https://capacitorjs.com/docs/guides/splash-screens-and-icons)。
- `@capacitor/splash-screen` プラグインは**入れない**(テンプレートの LaunchScreen.storyboard が Splash を描く。それで足りる)。
- ダークモードの起動画面も白(アプリに暗い配色は無い)。

### 3.8 Google Fonts の同梱・ring-proto の移動(不都合8)

- `index.html` 20-25 行の `preconnect` ×2 と `fonts.googleapis.com/css2?family=Instrument+Serif` の `<link>` を**消す**。`src/main.jsx` の `import './index.css'` の**前**に
  ```js
  import '@fontsource/instrument-serif/400.css'
  import '@fontsource/instrument-serif/400-italic.css'
  ```
  を足す(ファイル名は https://unpkg.com/@fontsource/instrument-serif@5.3.0/?meta で確認済み。`latin` と `latin-ext` の woff2 がバンドルに入る)。Vite が CSS を `<head>` の `<link>` に抜き出すので、取得の開始は今の `<link>` と同じ段(HTML の解析時)。`font-display: swap` は fontsource の既定。
- 注記の更新: index.css:11「読み込みはindex.htmlのlinkが担う」→「@fontsource(main.jsx の import)が担う。殻ではオフラインでも崩れない」。App.jsx:5129 周辺の F-43 の注記の「index.html の link」も同じく。index.html の F-43 コメントは消す。
- `THIRD_PARTY_NOTICES.md` に「Instrument Serif(@fontsource/instrument-serif 5.3.0)— SIL Open Font License 1.1 / Copyright 2022 The Instrument Serif Project Authors」の節と OFL 全文(unpkg の LICENSE から写す)を足す。
- **これは Web 版も変わる**(字の取得元が Google から自分のオリジンへ。見た目は同じ。第三者への接続が1つ減る)。§9-(2) に分かれ道として置く。既定は「両方とも同梱」。
- `public/ring-proto.html` → `design/ring-proto.html` に `git mv`。App.jsx:6978 / 6989 と pitch-test.mjs:251 / 2712 の注記の綴り `public/ring-proto.html` を `design/ring-proto.html` に直す(どれも注記。pitch-test はこのファイルを読んでいない)。

### 3.9 iPad が "pc" と記録される件: UA を見ずに `shellPlatform()` で決める

- `src/community/profile.js:193` の `detectDeviceClass(ua)` を `detectDeviceClass(ua = …, platform = shellPlatform())` にし、先頭に `if (platform === "ios") return "ios"; if (platform === "android") return "android";` を足す。Web では `shellPlatform()` が `"web"` を返すので**今までの判定へ落ちる**(1文字も変わらない結果)。
- 殻の iPad は WKWebView が Mac を名乗る(Safari の既定と同じ)が、`Capacitor.getPlatform()` は `"ios"` を返すので UA に依らず正しく記録される。`feedbackRepo.js:42` も同じ関数を呼ぶので両方直る。
- 検査: `detectDeviceClass(Mac の UA, "ios") === "ios"` / `detectDeviceClass(Mac の UA, "web") === "pc"` / `detectDeviceClass(Android の UA, "web") === "android"`(§8.1-S1)。
- iosViewport.js の `isIOSDevice`(Mac 名乗り + maxTouchPoints)はそのまま(殻の iPad でも true になる)。

### 3.10 Firebase Auth(不都合2): 殻だけ `initializeAuth(indexedDBLocalPersistence)`

`src/community/firebaseClient.js:2` と 65 を次にする(Web の枝は `getAuth(app)` のまま):

```js
import { getAuth, initializeAuth, indexedDBLocalPersistence } from "firebase/auth";
import { isNativeShell } from "../shell/native.js";
…
    // 【殻 S1】Capacitor の WKWebView では既定の getAuth(永続化の自動選択)が onAuthStateChanged を返さないことがある。
    // Firebase の案内(ハイブリッドアプリは initializeAuth + indexedDBLocalPersistence)に従う。Web 版は今までどおり getAuth。
    const auth = isNativeShell() ? initializeAuth(app, { persistence: indexedDBLocalPersistence }) : getAuth(app);
    cached = { app, auth, db: getFirestore(app) };
```

- 根拠: https://firebase.google.com/docs/auth/web/custom-dependencies (「Capacitor/Cordova/hybrid」向けの `initializeAuth({ persistence: indexedDBLocalPersistence })`)。
- **Web 版への影響: 無し**(`getAuth` の枝は同じ呼び出し。`initializeAuth` と `indexedDBLocalPersistence` は同じ `firebase/auth` の束の中なので Web バンドルの中身は増えない)。`accountRepo.js` の `signInAnonymously / onAuthStateChanged / deleteUser` は `auth` を受けるだけで変更なし。
- Firestore は v10 以降 `experimentalAutoDetectLongPolling` が既定で有効。殻で一覧が来ないときだけ `initializeFirestore(app, { experimentalForceLongPolling: true })` を**殻の枝に**足す(S1 の実機点検で決める。先に書かない)。

### 3.11 Google Cloud の API キーの制限(本人のコンソール作業。§7-D)

殻のオリジンは `capacitor://localhost`。Firebase の Web SDK は `VITE_FIREBASE_API_KEY` を HTTP で送るので、そのキーに**「HTTP リファラー」の制限**が付いていると殻からの Identity Toolkit / Firestore の呼び出しが拒否され得る。本人がコンソールで確かめ、制限があるなら**殻専用のキー**を作って Codemagic の `VITE_FIREBASE_API_KEY` に入れる(手順は §7-D。コードは変えない)。

### 3.12 DESIGN-SYSTEM の更新(S1)

- §3「iPad の器」末尾の「**殻の宿題**: Info.plist …」(DESIGN-SYSTEM.md:1172)を「済(便S1。`ios/App/App/Info.plist`)」に。
- 新節「殻(iOS アプリ)」を §3 の後に: §1.1〜1.2 の規則(判定1か所・`*.native.js` 動的 import)・§3.5(拡大)・§4.3(マイク)・§4.4(音の出口とゲイン)・§5.3(`--ad-h` は実寸)の要約。

---

## 4. 便S2 殻の中の振る舞い ── 詳細

### 4.1 書き出し(不都合1): `<a download>` → Filesystem + Share

`src/backup/BackupPanel.jsx:53-78` の `handleExport`。`a.href = url; a.download = name; … a.click()` の Web の枝は**そのまま**。その手前に殻の枝を足す:

```js
    try {
      const all = await readAll();
      const snapshot = buildSnapshot(all);
      const name = snapshotFileName();
      const json = JSON.stringify(snapshot);
      if (isNativeShell()) {
        // 【殻 S2】WKWebView は <a download> で何も起きない(しかも成功の表示が出ていた)。ファイルに書いて共有シートへ。
        const { exportSnapshotFile } = await import("../shell/backupExport.native.js");
        const r = await exportSnapshotFile({ name, json });
        if (r.cancelled) return;                                  // 共有シートを閉じただけ。知らせは出さない
        setNotice(`計測${jpNum(snapshot.counts.sessions)}件を ${name} に書き出しました`);
        return;
      }
      const blob = new Blob([json], { type: "application/json" });
      … 以下は今の綴りのまま(url / a / click / setNotice)
```

`src/shell/backupExport.native.js`:

```js
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
// 一時ファイルは Cache に書き、共有が終わったら消す(端末に写しを残さない。保存先は利用者が共有シートで選ぶ)。
export async function exportSnapshotFile({ name, json }) {
  const { uri } = await Filesystem.writeFile({ path: name, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
  try {
    await Share.share({ title: name, url: uri, dialogTitle: "書き出し先を選ぶ" });
    return { shared: true };
  } catch (e) {
    if (/cancel/i.test(String(e?.message ?? e))) return { cancelled: true };   // iOS は "Share canceled" で reject する
    throw e;
  } finally {
    try { await Filesystem.deleteFile({ path: name, directory: Directory.Cache }); } catch { /* 消せなくても害は無い(Cache) */ }
  }
}
```

- 失敗(throw)は今の `catch` に落ちて「書き出せませんでした。…」が出る(文言は変えない)。
- 読み込み(`<input type="file" accept="application/json,.json">` BackupPanel.jsx:95-98)は WKWebView が「ファイル」のピッカーを出す。**コードは変えない**。実機の点検(T)で、書き出した `.json` が**灰色で選べない**ときだけ、殻の枝で `accept` を外す(`accept={isNativeShell() ? undefined : "application/json,.json"}`。`validateSnapshot` が形式を弾くので安全)。
- 読み戻し後の `window.location.reload()` は殻でも動く(capacitor://localhost を再読込)。

### 4.2 スリープ防止(不都合4): `navigator.wakeLock` → KeepAwake

`src/App.jsx:4176-4188` の `requestWakeLock` / `releaseWakeLock`。Web の枝は触らず、先頭に殻の枝:

```js
  const requestWakeLock = useCallback(async () => {
    if (isNativeShell()) {
      try { const m = await import("./shell/keepAwake.native.js"); await m.keepAwake(); } catch { /* 未対応・失敗は無視(Web と同じ姿勢) */ }
      return;
    }
    try { if ("wakeLock" in navigator && !wakeLockRef.current) { … 今のまま
  }, []);
  const releaseWakeLock = useCallback(() => {
    if (isNativeShell()) { import("./shell/keepAwake.native.js").then((m) => m.allowSleep()).catch(() => {}); return; }
    try { wakeLockRef.current?.release(); } catch { /* noop */ }
    wakeLockRef.current = null;
  }, []);
```

`src/shell/keepAwake.native.js`: `import { KeepAwake } from "@capacitor-community/keep-awake"; export const keepAwake = () => KeepAwake.keepAwake(); export const allowSleep = () => KeepAwake.allowSleep();`

- 呼び手(録音・メトロノーム・取り込み解析。App.jsx:4775 / 4792 / 4899 / 4979 / 5056 / 9143)は変えない。`visibilitychange` の再取得(4899)も同じ関数を通る。
- 実機(T): 録音を始めて 2 分放置 → 画面が消えない。止めて 1 分 → 自動ロックの設定どおり消える。

### 4.3 計測タブ以外でマイクを止める(不都合6): 殻では `pause` ではなく `stop`

- Web の決まり(1fb310e「タブを行き来しても許可ポップアップが繰り返し出ないように」)は **WebKit の許可ダイアログ**が毎回出る端末があったため。殻では Capacitor が WebKit の許可を自動で通す(§3.3)ので、`getUserMedia` を呼び直しても **OS の許可は最初の1回だけ**。前提が消えたので殻では止める。
- `src/shell/policy.js`:
  ```js
  // 【殻 S2】計測タブを離れたときのマイク。Web は "pause"(接続を保つ。1fb310e の決まり)。殻は "stop"(解放。橙の印が消える)。
  // 殻で止めると許可の直後に固まる(Web の C12 の再来)なら、この定数を false にして Web と同じ振る舞いへ戻す(1か所)。
  export const SHELL_STOP_MIC_ON_TAB_LEAVE = true;
  export function micActionOnTabLeave(native) { return native && SHELL_STOP_MIC_ON_TAB_LEAVE ? "stop" : "pause"; }
  ```
- `src/App.jsx:4867-4873` の effect:
  ```js
    if (topTab === "measure" && !document.hidden) {
      startListeningRef.current();
    } else if (micActionOnTabLeave(isNativeShell()) === "stop") {
      stopListeningRef.current();     // 【殻 S2】解放。戻るときは startListening の完全再取得(画面復帰と同じ道)
    } else {
      pauseListeningRef.current();
    }
  ```
- 戻ったときの道は**既にある**: `startListening` は `isMicStreamUsable` が偽なら完全再取得へ落ちる(4283-4296)。これは `visibilitychange` の復帰(4877-4895)で毎回通っている道なので、新しい経路ではない。
- 実機(T): 計測タブ → リードタブで**橙の印が消える** → 計測タブに戻って 1 秒以内に環が動く(許可ダイアログは出ない)。固まる・-200dB のままなら `SHELL_STOP_MIC_ON_TAB_LEAVE = false` にして再ビルド(それでも S2 の合格ライン)。

### 4.4 音の出口(不都合5): AVAudioSession を playAndRecord + defaultToSpeaker に。ゲインは殻で 1.0

- 症状: マイクを開いている間、iOS は出力を受話口に回し、メトロノームが最大音量でも小さい。Web は `navigator.audioSession.type = "play-and-record"`(App.jsx:3512-3516)と**ゲイン 4.53 × 2.6 + リミッター**で補っていて割れ気味。
- ネイティブ部品 `FicusAudioSession.routeToSpeaker()`(付録D。AppDelegate.swift に追記・§3.4 で登録済み):
  `setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])` → `overrideOutputAudioPort(.speaker)`。`setActive` は呼ばない(WebKit が同じ共有セッションを有効にしている)。
  - **Bluetooth は許可しない**(`allowBluetoothHFP` / `allowBluetoothA2DP` を付けない)。HFP を許すと Bluetooth のヘッドセットの**マイク**が本体のマイクに代わり、チューナーの入力が変わる。A2DP の出力は遅延 100ms 級でメトロノームの拍に合わない。有線イヤホンは `.defaultToSpeaker` でも**挿せばそちらに出る**(受話口 vs スピーカーの既定を変えるだけ)。§9-(1) に分かれ道。
- `src/shell/audioSession.native.js`:
  ```js
  import { registerPlugin } from "@capacitor/core";
  const P = registerPlugin("FicusAudioSession");
  export const routeToSpeaker = () => P.routeToSpeaker();
  ```
- 呼ぶ場所は**2つ**(どちらも `isNativeShell()` の枝・待たない・失敗は無視):
  1. `startListening` で `streamRef.current = stream;`(App.jsx:4313)の**直後**。WebKit は取り込みの開始時にセッションの種別を自分で立て直すので、その**後**に上書きする。
  2. メトロノームを鳴らし始める関数(`startMetronome`。`metroActiveRef` を true にする所)の先頭。マイクが止まっている(他タブから戻る前など)状態で鳴らす場合に効く。
  共通の呼び口は `src/shell/audio.js` の `export function shellRouteToSpeaker() { if (!isNativeShell()) return; import("./audioSession.native.js").then((m) => m.routeToSpeaker()).catch(() => {}); }`(Web では即 return。`*.native.js` ではないので静的 import してよい)。
- **ゲイン**: `src/shell/policy.js` に `export const METRO_MASTER_GAIN_SHELL = 1.0; export function metroMasterGain(native) { return native ? METRO_MASTER_GAIN_SHELL : 2.6; }`。App.jsx:6252 を `master.gain.value = metroMasterGain(isNativeShell());` に(Web は 2.6 のまま。D-24 §1.5 の凍結はこの値のこと)。リミッター(閾値 -3dB・ratio 20)と `makeup 4.53`(クリックの波形の一部。D-25)は**触らない**。
  - 実機(T)の判定: スピーカーで鳴り、割れていない(S2 の合格)。**まだ小さい**なら `METRO_MASTER_GAIN_SHELL = 2.6` にして再ビルド(受話口の問題が直っていれば 2.6 でも割れないはず。これも S2 の合格ライン)。スピーカーから出ない(受話口のまま)なら、`routeToSpeaker` を `getUserMedia` の 300ms 後にもう1回呼ぶ変更を足す(WebKit が後から上書きする端末への備え)。それでも駄目なら本便は「ゲイン 2.6 のまま」で合格とし、起票する。
- Web 版: `applyAudioSessionType()` と `AUDIO_SESSION_TYPE` は**そのまま**(pitch-test 3626-3627 が綴りを見ている)。

### 4.5 Web 版の記録を移す案内(不都合9): 2か所に1行ずつ。殻だけ・記録が 0 件の間だけ

- (a) データタブの My Data の「まだ記録がありません」(App.jsx:18247)の**下**に、殻かつ `sessions.length === 0` のときだけ1行:
  `Web 版の記録は、このアプリへ自動では移りません。コミュニティタブ → マイページ(参加前なら参加の画面)の「アカウント引継」で移せます。`
  体裁は同じ行の style(`fontSize: 12, color: var(--c-ink-3)`)に `marginTop: 6, lineHeight: 1.6`。記録が1件でも入れば消える(鍵・保存なし)。
- (b) `BackupPanel` の説明文「記録はこの端末の中だけにあります。…」(BackupPanel.jsx:124-126)の**次**に、殻のときだけ1行(同じ style):
  `Web 版で使っていた記録は、Web 版の同じ画面で「ファイルに書き出す」→ ここで「ファイルから読み戻す」の順で移せます。コミュニティの匿名アカウントは移せません。`
- 禁則: 「ブラウザ」「再読み込み」「リロード」は動く側に書けない(pitch-test 88.3)。「Web 版」で書く。「機種変更」は書かない(既存文言のみ対象外)。
- 一度きりの帯やシートは**作らない**(起動時はマイクの許可・ATT が出る。重ねない)。§9-(3)。

---

## 5. 便S3 広告と ATT ── 詳細

### 5.1 使う物と Info.plist

- `@capacitor-community/admob@8.1.0`(§1.3)。README の iOS 節(https://github.com/capacitor-community/admob#ios)どおりに Info.plist へ:
  - `GADApplicationIdentifier`: AdMob の**アプリ ID**(`ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY`。本人が §7-E で作る。秘密ではない)。本人の値が届くまでは **Google の案内ページ(https://developers.google.com/admob/ios/quick-start の「Update your Info.plist」の sample)に載っている sample のアプリ ID を実装時にそのページから写す**(`ca-app-pub-3940256099942544~…` の形。桁は写す。見覚えの数字を打たない)。その値を `src/shell/adsConfig.js` に `ADMOB_APP_ID_PLACEHOLDER` として**も**書く(S4 の検査が「plist の値がこれと違う」ことを見るため)
  - `SKAdNetworkItems`: Google の案内(https://developers.google.com/admob/ios/quick-start の「Update your Info.plist」)の `SKAdNetworkIdentifier` の一覧を**実装時にそのページから丸ごと写す**(2026-10 時点で 43 件。先頭は `cstr6suwn9.skadnetwork`)
  - `NSUserTrackingUsageDescription`: `広告の表示に使う識別子の利用を許可すると、あなたに合った広告が表示されます。許可しなくても、アプリの機能はすべて使えます。`
  - README が他に求める鍵(例: `GADIsAdManagerApp`)は**インストールした版の README のとおり**にする(AdMob 用なら不要)。
- UMP(GDPR の同意)は**入れない**(日本のみ配信。EU へ広げる便で入れる)。

### 5.2 ID と試験/本番の切り替えは `src/shell/adsConfig.js` の1か所

```js
// 【殻 S3】広告の ID。**値の唯一の答えはここ**。秘密ではない(アプリの中に入る値)。
// 試験用は Google の demo ID(アカウントに紐づかない。https://developers.google.com/admob/ios/test-ads)。
// 本番の ID は本人が AdMob で作る(§7-E)。切り替え = この2行を変えるだけ(便S4)。
export const ADMOB_USE_TEST_ADS = true;                                      // 本番ビルドでは false
export const ADMOB_BANNER_UNIT_ID_IOS = "ca-app-pub-3940256099942544/2435281174";   // 本番では本人のバナーのユニット ID
```

- 試験用のユニット ID の綴りはこのファイル**以外に現れない**(§8.2)。`isTesting` と `initializeForTesting` は `ADMOB_USE_TEST_ADS` を読む。

### 5.3 `src/shell/ads.native.js` と App.jsx の配線

```js
import { AdMob, BannerAdSize, BannerAdPosition, BannerAdPluginEvents } from "@capacitor-community/admob";
import { ADMOB_USE_TEST_ADS, ADMOB_BANNER_UNIT_ID_IOS } from "./adsConfig.js";
import { adBannerMargin } from "./policy.js";

let started = false;
export async function startAds({ onHeight, navTop }) {
  if (started) return; started = true;
  await AdMob.initialize({ initializeForTesting: ADMOB_USE_TEST_ADS });
  // ATT: 未決定のときだけ尋ねる(iOS 14+)。拒否でも非追跡の広告が出る。
  try { const { status } = await AdMob.trackingAuthorizationStatus(); if (status === "notDetermined") await AdMob.requestTrackingAuthorization(); } catch { /* 続ける */ }
  AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => { if (size?.height > 0) onHeight(size.height); });
  AdMob.addListener(BannerAdPluginEvents.FailedToLoad, () => onHeight(0));
  await AdMob.showBanner({
    adId: ADMOB_BANNER_UNIT_ID_IOS, adSize: BannerAdSize.ADAPTIVE_BANNER, position: BannerAdPosition.BOTTOM_CENTER,
    margin: adBannerMargin({ innerHeight: window.innerHeight, navTop }), isTesting: ADMOB_USE_TEST_ADS,
  });
}
export const setAdsHidden = (hidden) => (hidden ? AdMob.hideBanner() : AdMob.resumeBanner()).catch(() => {});
```

`src/shell/policy.js`:
```js
// 【殻 S3】バナーの下端は下部タブの上端。plugin の margin は下端からの距離(dp = CSS px)。
// AD_MARGIN_MODE "screen" = 画面の下端から / "safe-area" = 安全域の下端から(実機で帯が inset ぶん浮いたら "safe-area" に)。
export const AD_MARGIN_MODE = "screen";
export function adBannerMargin({ innerHeight, navTop, inset = 0, mode = AD_MARGIN_MODE }) {
  const m = Math.max(0, Math.round(innerHeight - navTop));
  return mode === "safe-area" ? Math.max(0, m - inset) : m;
}
export const AD_H_INITIAL_PX = 50;   // 最初の広告が来るまでの帯の高さの仮の値(アンカー型アダプティブの iPhone の実寸は 50 前後)
```

App.jsx の配線(**3点**):

1. **始める時機**: 起動時の最初の `getUserMedia` の試み(`startListening` の完全再取得の枝)が**成功・失敗どちらでも終わった直後**に1回だけ(`shellAdsStartedRef`)。OS のマイク許可の画面と ATT の画面を**重ねない**ため。呼び口は `src/shell/ads.js` の `shellStartAdsOnce({ navTop })`(Web では即 return。`isNativeShell()` の枝で `import("./ads.native.js")`)。`navTop` は `BottomNav` の根の `getBoundingClientRect().top`(`ref` を1つ足す)。`onHeight(h)` は `document.documentElement.style.setProperty("--ad-h", `${h}px`)`。開始時に `AD_H_INITIAL_PX` を先に入れる(来るまでの跳ねを1回に)。`FailedToLoad` で 0 に戻す。
2. **シート中は隠す**: `AdPreviewStrip`(App.jsx:5570)の隣に `ShellAdBannerSync` を1つ置く:
   ```jsx
   function ShellAdBannerSync() {
     const sheetOpen = useAnyBottomSheetOpen();
     useEffect(() => { shellSetAdsHidden(sheetOpen); }, [sheetOpen]);   // Web では no-op
     return null;
   }
   ```
   `--ad-h` は**戻さない**(便BL の規則。裏のページが跳ねないため)。`hideBanner` / `resumeBanner` は見せる・隠すだけで高さを変えない。
3. **見本の帯との共存**: 殻では `AdPreviewStrip` を描かない(`?adpreview=1` は Web 版の確認用)。`AdPreviewStrip` の先頭に `if (isNativeShell()) return null;` を足す(Web の枝は不変)。`applyAdPreview()`(main.jsx)は殻でも走ってよい(属性が付いても帯を描かない。`--ad-h` は殻側の inline style が勝つ)。

- 帯は**ネイティブのビュー**で WKWebView の上に載る。暗幕・はじめの一手のカード・PhotoZoom の上に出る。シート(BottomSheet)の間だけ隠す(本人裁定)。PhotoZoom は §9-(4)。
- 実機(T): 帯の下端 = 下部タブの上端(ずれるなら `AD_MARGIN_MODE`)/ 浮かせるボタンと計測の枠が帯ぶん上がる(`--ad-h` の実寸)/ シートを開くと帯が消え閉じると戻る / 初回だけ ATT の画面が出る(設定 → プライバシー → トラッキングに Ficus が載る)。

### 5.4 プライバシーポリシーの改定(public/privacy.html。付録E)

- §2 の表に行「広告の識別子(iOS アプリ版のみ)」を足す。§4 の「現在、本アプリは広告を表示していません。広告ネットワークや解析サービスへの情報提供もありません。将来…」の段落を AdMob の開示に**置き換える**。「最終更新日」を改定日に。
- 変えないもの: `mailto:` の綴り・「録音した音声そのものは、いかなる場合もサーバーへ送信しません」・「収集 / 利用目的 / 第三者 / 削除 / 13歳 / お問い合わせ」の語(support.test.js が見る)・`<a class="back" href="/">`(pitch-test 52.9)。
- Web 版も同じ文書を配る(LegalSheet が fetch)。「iOS アプリ版のみ」と明記するので Web の利用者にも正しい。

---

## 6. 便S4 提出の準備 ── 詳細

### 6.1 コードで変えるもの

- `adsConfig.js`: `ADMOB_USE_TEST_ADS = false`・`ADMOB_BANNER_UNIT_ID_IOS` を本人のユニット ID に。Info.plist の `GADApplicationIdentifier` を本人のアプリ ID に(§7-E で受け取る。どちらも秘密ではない)。
- `ios/App/App.xcodeproj/project.pbxproj` の `MARKETING_VERSION` を `1.0.0`(全 configuration)。`CURRENT_PROJECT_VERSION` は Codemagic の `agvtool` が毎回上書き。
- `src/support.js` の `APP_STORE_REVIEW_URL` は**まだ null のまま**(公開後に `https://apps.apple.com/jp/app/id<数字>?action=write-review` を入れる別の便。殻では `<a href>` のまま App Store アプリに渡る)。

### 6.2 審査で落ちやすい点の点検(不都合11)── 根拠を審査メモに書く(付録G)

| 指針 | 状態 | 根拠・やること |
|---|---|---|
| 4.2 最低限の機能(Web をただ包んだだけ) | **根拠あり** | (1) 全資産を同梱し**オフラインで動く**(`server.url` 無し・字も同梱)。(2) マイクの実時間解析(音程・倍音・HNR)と録音の保存は**端末内で完結**。(3) ネイティブの部品: 共有シート(書き出し)・スリープ防止・音の出口の制御・AdMob・ATT。(4) iPhone / iPad それぞれの画面(2ペイン)。(5) 録音の取り込み(動画 / 音声ファイル)の端末内解析。審査メモに「Web 版は体験版、アプリは本体」とは書かず、上の 5 点を箇条書きで |
| 5.1.1(v) アカウント削除 | **済** | マイページ「アカウントを削除」(CommunityTab.jsx:2132。Firestore の users / ideals / 写真 / 匿名アカウント)。審査メモに場所を書く |
| 1.2 UGC: 通報・ブロック・連絡先 | **済** | 通報(ReportSheet)・ブロック(BlockConfirmSheet・マイページ「ブロック中の人」)・連絡先(規約・ポリシー・support.html の `ficus.help@gmail.com`)。「timely responses」: 本人が **Firestore の `reports` を週1回見る**運用を審査メモに書く(通知の仕組みは起票のまま) |
| 5.1.2 ATT | S3 で済 | 許可の前に追跡しない(`requestTrackingAuthorization` → `showBanner` の順) |
| 5.1.1 目的の説明文 | S1/S3 で済 | マイク・カメラ・写真・ATT の4つ |
| 2.1 完成度 | T | TestFlight で主要導線を一周(付録G の点検票) |
| 2.3 正確なメタデータ | 本人 | スクリーンショットは**アプリの実画面**(headless Chrome で 1290×2796(6.7")・2064×2752(13" iPad)を撮る。iPad は実機が無いのでこれで)|
| 年齢 | 本人 | 13+(UGC あり・規約 13 歳以上) |

### 6.3 プライバシーの栄養表示(App Store Connect「App のプライバシー」。本人が入力。付録F の表)

---

## 7. 本人の作業の手順書(順番どおり。秘密の値は画面にだけ入れ、チャットに貼らない)

### 7-A Codemagic のアカウント(S1 の TestFlight の前)

1. https://codemagic.io/signup を GitHub でサインアップ。「Add application」→ GitHub → Ficus のリポジトリ(Vercel が見ているもの)を選ぶ → プロジェクトの種類は **「Other / codemagic.yaml」**。
2. 無料枠は 500 分/月(mac_mini_m2)。「Team settings → Billing」で**上限額を 0 にする**(超過課金を止める)。

### 7-B App Store Connect の API キー(秘密。Codemagic にだけ入れる)

1. https://appstoreconnect.apple.com → ユーザとアクセス → **統合 → App Store Connect API → チームキー** → 「+」。名前 `codemagic`・アクセス **App Manager**。
2. **.p8 は1回しか落とせない**。落としたファイルは PC の安全な場所へ(クラウド同期フォルダに置かない)。画面の **Issuer ID** と **Key ID** を控える(チャットに貼らない)。
3. Codemagic → **Team settings → Team integrations → Developer Portal → Manage keys → Add key**: 名前 **`ficus-asc`**(codemagic.yaml の `integrations.app_store_connect` と同じ綴り)・Issuer ID・Key ID・.p8 をアップロード → Save。(https://docs.codemagic.io/yaml-code-signing/signing-ios/)

### 7-C 署名(証明書とプロファイル。秘密は Codemagic の中で作る)

1. Codemagic → **Team settings → codemagic.yaml settings → Code signing identities → iOS certificates → Generate certificate**: Reference name `ficus-dist`・種類 **Apple Distribution**・API キー `ficus-asc` → Create。Codemagic が鍵と証明書を作って保存する(画面の指示で**ダウンロードして再アップロード**が要るならそのとおりに)。
2. ブラウザで https://developer.apple.com/account/resources/profiles/list → 「+」→ **App Store Connect**(配布)→ App ID `jp.tobine.ficus` → 証明書は 1 で作った Apple Distribution → 名前 `Ficus App Store` → Generate(落とさなくてよい)。
3. Codemagic → Code signing identities → **iOS provisioning profiles → Fetch profiles** → `Ficus App Store` を選び Reference name `ficus-appstore` → Download selected。
4. 以後 `ios_signing: { distribution_type: app_store, bundle_identifier: jp.tobine.ficus }` が自動でこの2つを選ぶ。証明書は 1 年で切れる(切れたら 1 と 2 をやり直す)。

### 7-D Firebase と Google Cloud(秘密ではないが、キーは「Secure」で入れる)

1. **Codemagic の環境変数**: Codemagic → アプリ → **Environment variables** → グループ名 `ficus_firebase` で `VITE_FIREBASE_API_KEY` `VITE_FIREBASE_AUTH_DOMAIN` `VITE_FIREBASE_PROJECT_ID` `VITE_FIREBASE_APP_ID` の4つ(値は **Vercel のプロジェクト設定 → Environment Variables と同じ**。「Secure」にチェック)。
2. **API キーの制限の確認**: https://console.cloud.google.com/apis/credentials (プロジェクト `ficus-caa43`)→ `VITE_FIREBASE_API_KEY` と同じ値のキー(名前は「Browser key (auto created by Firebase)」のことが多い)を開く → **「アプリケーションの制限」**を見る。
   - **「なし」** → 何もしない(そのまま殻でも通る)。
   - **「HTTP リファラー」** → **「キーを作成」**で殻専用のキーを作る: 名前 `Ficus iOS shell`・アプリケーションの制限 **なし**・**API の制限**: Identity Toolkit API / Token Service API / Cloud Firestore API / Cloud Storage for Firebase API / Firebase Installations API(無いものは飛ばす)→ 保存。その値を 1 の `VITE_FIREBASE_API_KEY` に入れる(Vercel の値は変えない)。Firebase の API キーは「公開されても鍵ではない」(https://firebase.google.com/docs/projects/api-keys)。
3. **Firebase の iOS アプリ登録(省略可)**: この殻は Firebase の **Web SDK** を使うので `GoogleService-Info.plist` は**使わない**(プロジェクトに入れない)。Firebase コンソール → プロジェクトの設定 → 「アプリを追加 → iOS」でバンドル ID `jp.tobine.ficus` を登録しても害は無いが、必要になるのはネイティブ SDK(App Check / Crashlytics)を入れる将来の便。やるなら plist は落とさなくてよい。

### 7-E AdMob(S3 の前。値は秘密ではない。チャットに貼ってよい)

1. https://admob.google.com にログイン(Google アカウント)→ 支払い情報と**税務情報**(個人)を入れる(収益の受け取りに要る。審査には要らない)。
2. **アプリ → アプリを追加 → iOS → 「App Store に掲載済みですか」= いいえ** → 名前 `Ficus` → 作成。**アプリ ID**(`ca-app-pub-…~…`)を控える → 実装役へ(Info.plist の `GADApplicationIdentifier`)。
3. そのアプリ → **広告ユニット → バナー** → 名前 `bottom-banner` → 作成。**広告ユニット ID**(`ca-app-pub-…/…`)を実装役へ(便S4 で `adsConfig.js` に入れる)。
4. 公開後: アプリ → **アプリの設定 → App Store のリンクを追加**(審査の通過後に App Store の URL を入れる。それまで広告の配信は限定的)。
5. Apple 側: App Store Connect → アプリ → **App のプライバシー → 「広告の識別子(IDFA)を使用しますか」= はい**(提出時の質問)。

### 7-F TestFlight で入れる(S1 の最初のビルドから)

1. iPhone に **TestFlight** アプリを入れる(App Store)。
2. Codemagic → アプリ → **Start new build** → workflow `ios-testflight` → branch は main(実装が main に入ったあと)→ Start。終わるまで 15〜25 分。失敗したら「Build log」の最後の赤い行を**そのままチャットに貼る**(.p8 や鍵の中身はログに出ない)。
3. App Store Connect → アプリ → **TestFlight** → 内部テスト → グループ「内部」を作り自分を追加 → ビルドが「テスト可能」になったら iPhone の TestFlight に出る → インストール。
4. 各便の実機の点検票(付録G の T 列)を**上から順に**やり、結果をチャットに(実測だけ。「たぶん」は書かない)。

### 7-G App Store Connect の入力(S4)

名前(済)・サブタイトル・カテゴリ(ミュージック / 教育)・価格(無料)・配信地域(日本)・年齢(13+)・**プライバシーポリシー URL** `https://wind-tone-lab.vercel.app/privacy.html`・**サポート URL** `https://wind-tone-lab.vercel.app/support.html`・スクリーンショット(実装役が撮って渡す)・**App のプライバシー**(付録F)・**審査メモ**(付録G)・「IDFA を使用」= はい・輸出コンプライアンス = Info.plist で申告済み。

---

## 8. 合格ラインと検収

### 8.1 新しい検査(vitest。jsdom。`window.Capacitor` を**モック**して殻の枝を描く)

**S1**
- `src/shell/native.test.js`: `isNativeShell()` は `window.Capacitor` 無しで false / `{ isNativePlatform: () => true, getPlatform: () => "ios" }` で true / `isNativePlatform` が例外を投げても false。`shellPlatform()` は Web で `"web"`・殻で `"ios"`。
- `src/community/profile.test.js` に足す: `detectDeviceClass(Mac の UA, "ios") === "ios"` / `(Mac の UA, "web") === "pc"` / `(Android の UA, "web") === "android"` / 省略時(platform 既定)は jsdom で今までの結果。
- `src/community/firebaseClient.test.js` に足す: ソースを読み `isNativeShell() ? initializeAuth(app, { persistence: indexedDBLocalPersistence }) : getAuth(app)` の綴りが**1回**・`getAuth(app)` が**1回**(Web の枝が残っている)。
- `index.html` に `fonts.googleapis` が無い / `src/main.jsx` が `@fontsource/instrument-serif/400.css` と `400-italic.css` を import している(`src/support.test.js` の隣に `shellAssets.test.js` として読む)。
- `public/ring-proto.html` が無く `design/ring-proto.html` がある。

**S2**
- `src/shell/backupExport.test.jsx`(`fakeIndexedDb.testutil.js` で IndexedDB を用意。`vi.mock("@capacitor/filesystem")` `vi.mock("@capacitor/share")`):
  - 殻: 「ファイルに書き出す」→ `Filesystem.writeFile` が `Directory.Cache` と `ficus-backup-YYYY-MM-DD.json` で呼ばれ、その `uri` で `Share.share` が呼ばれ、`deleteFile` が呼ばれ、知らせ「計測N件を … に書き出しました」が出る。`Share.share` が `Error("Share canceled")` を投げると**知らせも失敗も出ない**。それ以外の例外で「書き出せませんでした。…」。
  - Web(`window.Capacitor` 無し): `HTMLAnchorElement.prototype.click` のスパイが1回・`Share` のモックは**呼ばれない**(動的 import もされない: `vi.mock` の factory が呼ばれない)。
- `src/shell/policy.test.js`: `micActionOnTabLeave(true) === "stop"` / `(false) === "pause"` / `SHELL_STOP_MIC_ON_TAB_LEAVE` を false にした仮定の式。`metroMasterGain(false) === 2.6` / `(true) === METRO_MASTER_GAIN_SHELL`。
- `src/shell/keepAwake.test.jsx`: App を殻モックで描き、録音開始(既存の検査の起こし方 `measureRingFitHold.test.jsx` に倣う)で `KeepAwake.keepAwake` が呼ばれる・停止で `allowSleep`。Web では `navigator.wakeLock.request` のスパイだけが呼ばれる。
- 移行の案内: 殻 + sessions 0 件で My Data に「Web 版の記録は、このアプリへ自動では移りません」が出る / 1件あると出ない / Web では 0 件でも出ない。BackupPanel の1行も同様(殻だけ)。

**S3**
- `src/shell/ads.test.jsx`(`vi.mock("@capacitor-community/admob")`): 殻で `startAds` → `initialize({ initializeForTesting: ADMOB_USE_TEST_ADS })` → `trackingAuthorizationStatus` が `notDetermined` なら `requestTrackingAuthorization` → `showBanner({ adId: ADMOB_BANNER_UNIT_ID_IOS, adSize: ADAPTIVE_BANNER, position: BOTTOM_CENTER, isTesting: ADMOB_USE_TEST_ADS, margin: … })` の**順**(呼び出し順を配列で記録して比べる)。`SizeChanged({height: 56})` で `document.documentElement.style.getPropertyValue("--ad-h") === "56px"`。`FailedToLoad` で `0px`。2回目の `startAds` は何もしない。
- `adBannerMargin({ innerHeight: 812, navTop: 731 }) === 81` / `({…, inset: 34, mode: "safe-area"}) === 47`。
- `ShellAdBannerSync`: BottomSheet を開くと `hideBanner`・閉じると `resumeBanner`(殻)。Web では `--ad-h` も AdMob のモックも触らない。殻で `AdPreviewStrip` は `data-ad-preview="1"` でも描かれない。
- `support.test.js` に足す: privacy.html が「AdMob」を含み「現在、本アプリは広告を表示していません」を含まない。

**S4**
- `adsConfig.js` の `ADMOB_USE_TEST_ADS === false` と `ADMOB_BANNER_UNIT_ID_IOS` が `3940256099942544`(demo)を含まない(**S4 だけ**。S1〜S3 では逆に demo であること)。
- `Info.plist` の `GADApplicationIdentifier` が `adsConfig.js` の `ADMOB_APP_ID_PLACEHOLDER`(S1〜S3 で使った sample)と**違う**(S4)。S1〜S3 では逆に**同じ**。

### 8.2 pitch-test の新節「殻」(他の節は触らない。綴りの検査)

- `src/**`(`src/shell/*.native.js` を除く)に `from "@capacitor/` `from "@capacitor-community/` が **0 件**。`*.native.js` を**静的に** import する綴り(`from "./shell/…native.js"` / `from "../shell/…native.js"`)が 0 件(`import(` の中だけ)。
- `window.Capacitor` の綴りは `src/shell/native.js` だけ。`capacitor:` `isNativePlatform` も同じ。`navigator.userAgent` で殻を見分ける新しい綴りが無い(`isIOSDevice` / `detectDeviceClass` は UA を**種別**の判定に使うだけ。既存)。
- App.jsx: `micActionOnTabLeave(isNativeShell()) === "stop"` の分岐が topTab の effect に在る / `master.gain.value = metroMasterGain(isNativeShell());` / `streamRef.current = stream;` の直後 3 行以内に `shellRouteToSpeaker()` / `requestWakeLock` の先頭が `if (isNativeShell())`。`audioSession.type = AUDIO_SESSION_TYPE;`(既存 3626)は残る。
- BackupPanel.jsx: `a.download = name;` と `a.click();` が残る(Web の枝)/ `exportSnapshotFile` の動的 import が `isNativeShell()` の枝の中。
- firebaseClient.js: §8.1 と同じ綴り。
- `capacitor.config.json`: `"appId": "jp.tobine.ficus"` `"appName": "Ficus"` `"webDir": "dist"` `"zoomEnabled": true`、`"server"` に `"url"` が無い。
- `ios/App/App/Info.plist`: `NSMicrophoneUsageDescription` `NSCameraUsageDescription` `NSPhotoLibraryUsageDescription` が非空・マイクの文に「サーバーへ送りません」/ `UISupportedInterfaceOrientations` の配列が `UIInterfaceOrientationPortrait` **1 つだけ** / `~ipad` が 4 つ / `UIRequiresFullScreen` **無し** / `ITSAppUsesNonExemptEncryption` = false。(S3+)`NSUserTrackingUsageDescription` 非空・`GADApplicationIdentifier` が `/^ca-app-pub-\d{16}~\d{10}$/`・`SKAdNetworkItems` に `cstr6suwn9.skadnetwork` を含み 40 件以上。
- `ios/App/App/AppDelegate.swift`: `class FicusViewController: CAPBridgeViewController` / `ignoresViewportScaleLimits = true` / `registerPluginInstance(FicusAudioSessionPlugin())` / `options: [.defaultToSpeaker]`(`allowBluetooth` の綴りが無い)/ `overrideOutputAudioPort(.speaker)`。`Main.storyboard` に `customClass="FicusViewController"` があり `customClass="CAPBridgeViewController"` が無い。
- `codemagic.yaml`: `bundle_identifier: jp.tobine.ficus` / `submit_to_app_store: false` / `instance_type: mac_mini_m2` / `xcode-project build-ipa` に `--project` / **秘密の不在**: `-----BEGIN` `AuthKey_` と `/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/`(Issuer ID の形)が 0 件。
- `package.json`: `"ficus": "file:` が無い / `@capacitor/` `@capacitor-community/` `@fontsource/` の版が全部 `^` `~` 無しの exact。
- `.gitignore` or `ios/.gitignore` に `App/App/public` と `App/App/capacitor.config.json`。
- `index.html`: `fonts.googleapis` `fonts.gstatic` が 0 件。`maximum-scale` の既存検査(88.4)はそのまま通る。
- demo のユニット ID `3940256099942544/2435281174` の綴りは `src/shell/adsConfig.js` にだけ(S1〜S3)。

### 8.3 Web 版の退行がないことの確かめ方(便ごと)

1. `npm run test` の**総件数**が「変更前 + 新しく足した件数」。`node scripts/pitch-test.mjs` の PASS が減らず FAIL 0(既存の検査は1つも書き換えない。ただし §3.8 の注記の綴りだけ)。
2. `npm run build` が通り、`grep -c "registerPlugin" dist/assets/index-*.js` が **0**(ネイティブの部品が Web のメインチャンクに入っていない)。`dist/assets/` に `*.native-*.js` 相当の別チャンクが**出来ている**(殻の枝が削除されていない証拠)。
3. `dist/index.html` と `git show HEAD~:index.html` の差が**フォントの link 3 行(+注記)だけ**。
4. dev サーバ(`ficus-dev`)で: 起動 → 計測タブの環が動く(マイクの暗幕は JS クリックで回避。メモリ)→ `?adpreview=1` で見本の帯が出て `--ad-h` が 50px → コミュニティ → 参加前の画面の「アカウント引継」→「ファイルに書き出す」で **ダウンロードが起きる**(Chrome の `<a download>` の枝)。コンソールに `Capacitor` 由来のエラーが無い。
5. 変更前のツリーで 4 を同じ手順で見る(罠16: 「変わっていない」と言うなら従来を測る)。

### 8.4 実機の点検票(T。本人がやる。付録G に写しを置く)

S1: 起動(白い起動画面 → アプリ)/ 計測タブで許可を求められ 1 回許可 → 環が動く / iPhone を横にしても回らない / データタブの評価グラフを指2本で広げられる / 設定行の入力欄を押しても画面が寄らない / コミュニティに参加できる(匿名)・アプリを一度終了して開き直しても参加したまま(= Auth の永続化)/ マイページで写真を選べる(写真を撮る・フォトライブラリの両方で落ちない)/ 機内モードでも計測・リード・データが動く(字が崩れない)。
S2: 書き出し → 共有シート → 「ファイルに保存」→ 保存できる / その .json を「ファイルから読み戻す」で選べて読み戻せる / 録音中に 2 分放置しても画面が消えない / リードタブに移ると橙の印が消える・戻ると 1 秒以内に環が動く / メトロノームがスピーカーから出て割れない(有線イヤホンを挿すとイヤホンから)/ My Data が 0 件のとき移行の1行が出る。
S3: 帯が下部タブの直上・画面幅 / 浮かせるボタンが帯の上 / シートで消えて閉じると戻る / 初回に ATT の画面(許可・拒否のどちらでも帯が出る)。
S4: 本番 ID のビルドで帯が出る(**押さない**)。

---

## 9. 本人に聞く分かれ道(既定を書いてある。返事が無ければ既定で進める)

**(1) Bluetooth の音の出口(§4.4)**
- 既定 **ア: 許可しない**(本体のスピーカー / 受話口 / 有線だけ)。Bluetooth のヘッドセットを使うと**マイクも**そちらに替わりチューナーの入力が変わる。A2DP の出力は 100ms 級の遅延でメトロノームが合わない。
- イ: `allowBluetoothA2DP` を足す(出力だけ Bluetooth。マイクは本体)。遅延は残る。
- 聞く理由: 本人が Bluetooth のスピーカーで鳴らす習慣があるかで変わる。

**(2) 字(Instrument Serif)の同梱を Web 版にも効かせるか(§3.8)**
- 既定 **ア: 両方とも同梱**(index.html は1枚。見た目は同じ。Google への接続が1つ減る)。
- イ: Web は Google Fonts のまま、殻だけ同梱 ── Vite の `transformIndexHtml` で殻のビルド(`--mode shell`)のときだけ link を差し替える仕組みが要る。分岐が1つ増える。
- 聞く理由: 「殻の追加で Web 版の挙動を変えない」の読み方(字の取得元を「挙動」に含めるか)。

**(3) Web 版の記録の移し方の案内の出し方(§4.5)**
- 既定 **ア: 2か所に1行**(My Data の 0 件の下・BackupPanel の説明の下。殻だけ。記録が入れば消える)。
- イ: 初回起動に一度だけシートで案内(マイクの許可・ATT と重なる。閉じる操作が増える)。
- 聞く理由: 本人の目に触れる文言の追加。

**(4) 写真の拡大(PhotoZoom。z70・画面いっぱい)の間も帯を隠すか(§5.3)**
- 既定 **ア: 隠さない**(本人裁定は「シートが開いている間」。PhotoZoom はシートではない。Web の見本の帯の挙動も変えずに済む)。
- イ: 隠す ── PhotoZoom を BottomSheet と同じ「開いている数」に登録する。Web の見本の帯も PhotoZoom 中に消える(小さな Web の変化)。
- 聞く理由: 他人の写真の上に広告が載る絵を本人が許すか。

**(5) 計測タブを離れたときのマイク(§4.3)**
- 既定 **ア: 殻では止める**(橙の印が消える。Capacitor が WebKit の許可を自動で通すので再許可は出ない)。実機で固まれば定数1つで Web と同じに戻せる。
- イ: Web と同じ(繋いだまま。印は点きっぱなし)。
- 聞く理由: 本人が挙げた不都合そのものなので既定は「止める」だが、C12 の記憶があるため確認。

決めてよいとしてこの文書が決めたもの: 殻の判定の置き場(§1.1)/ プラグインの版の exact 固定(§1.3)/ `ios/` をコミット(§1.4)/ ATT を**最初のマイクの試みの直後**に 1 回(§5.3)/ メトロノームのゲインは殻で 1.0 から始め実機で 2.6 に戻す判断(§4.4)/ `ring-proto.html` を design へ(§3.8)/ Firebase の iOS アプリ登録は省略可(§7-D-3)/ UMP を入れない(§5.1)/ Codemagic のビルドは手で開始(§3.6)。

---

## 付録A `capacitor.config.json`

```json
{
  "appId": "jp.tobine.ficus",
  "appName": "Ficus",
  "webDir": "dist",
  "zoomEnabled": true,
  "backgroundColor": "#FFFFFF"
}
```

## 付録B `codemagic.yaml`

```yaml
# Ficus の iOS の殻(Capacitor 8・SPM)。手で開始する(無料枠 500 分/月)。タグ ios-v* の push でも動く。
# 秘密(API キー・.p8・証明書)はこのファイルに書かない。Codemagic の Team integrations / Code signing identities / Environment variables に本人が入れる。
workflows:
  ios-testflight:
    name: Ficus iOS (TestFlight)
    instance_type: mac_mini_m2
    max_build_duration: 60
    integrations:
      app_store_connect: ficus-asc          # §7-B で付けた API キーの名前
    environment:
      ios_signing:
        distribution_type: app_store
        bundle_identifier: jp.tobine.ficus
      groups:
        - ficus_firebase                    # VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID(§7-D)
      vars:
        XCODE_PROJECT: ios/App/App.xcodeproj
        XCODE_SCHEME: App
      node: 22
      xcode: 26.2
    triggering:
      events:
        - tag
      tag_patterns:
        - pattern: 'ios-v*'
      cancel_previous_builds: true
    scripts:
      - name: Install npm dependencies
        script: npm ci
      - name: Build web
        script: npm run build
      - name: Capacitor sync (copies dist into ios/App/App/public, updates CapApp-SPM)
        script: npx cap sync ios
      - name: Set build number
        script: |
          cd ios/App
          agvtool new-version -all $BUILD_NUMBER
      - name: Set up code signing
        script: xcode-project use-profiles
      - name: Build ipa
        script: xcode-project build-ipa --project "$XCODE_PROJECT" --scheme "$XCODE_SCHEME"
    artifacts:
      - build/ios/ipa/*.ipa
      - $HOME/Library/Developer/Xcode/DerivedData/**/Build/**/*.dSYM
    publishing:
      app_store_connect:
        auth: integration
        submit_to_testflight: true
        submit_to_app_store: false
```

### 付録B-2 `ios/` を Windows で作れなかったときだけ使う bootstrap(同じファイルに2つ目の workflow として置き、使ったら消す)

```yaml
  ios-bootstrap:
    name: Bootstrap ios folder (one-off)
    instance_type: mac_mini_m2
    max_build_duration: 20
    environment:
      node: 22
      xcode: 26.2
    scripts:
      - script: npm ci
      - script: npm run build
      - script: npx cap add ios
      - script: cd ios && zip -r $CM_EXPORT_DIR/ios.zip . -x "App/App/public/*"
    artifacts:
      - ios.zip
```

## 付録C `Info.plist` に足す鍵(XML。S1 ぶん。S3 で `NSUserTrackingUsageDescription` `GADApplicationIdentifier` `SKAdNetworkItems` を足す)

```xml
<key>CFBundleDisplayName</key><string>Ficus</string>
<key>CFBundleDevelopmentRegion</key><string>ja</string>
<key>ITSAppUsesNonExemptEncryption</key><false/>
<key>NSMicrophoneUsageDescription</key><string>音程・音量・音色を計測するために、マイクで演奏を聴き取ります。録音した音声は端末の中だけで解析し、サーバーへ送りません。</string>
<key>NSCameraUsageDescription</key><string>コミュニティのアイコンに使う写真を撮るために使います。</string>
<key>NSPhotoLibraryUsageDescription</key><string>コミュニティのアイコンに使う写真を選ぶために使います。</string>
<key>UISupportedInterfaceOrientations</key>
<array><string>UIInterfaceOrientationPortrait</string></array>
<key>UISupportedInterfaceOrientations~ipad</key>
<array>
  <string>UIInterfaceOrientationPortrait</string>
  <string>UIInterfaceOrientationPortraitUpsideDown</string>
  <string>UIInterfaceOrientationLandscapeLeft</string>
  <string>UIInterfaceOrientationLandscapeRight</string>
</array>
<!-- S3 -->
<key>NSUserTrackingUsageDescription</key><string>広告の表示に使う識別子の利用を許可すると、あなたに合った広告が表示されます。許可しなくても、アプリの機能はすべて使えます。</string>
<key>GADApplicationIdentifier</key><string>ca-app-pub-3940256099942544~XXXXXXXXXX</string>   <!-- S1〜S3: Google の quick-start の sample の値を写す(§5.1)。S4: 本人の値(§7-E) -->
<key>SKAdNetworkItems</key>
<array>
  <dict><key>SKAdNetworkIdentifier</key><string>cstr6suwn9.skadnetwork</string></dict>
  <!-- 以下 https://developers.google.com/admob/ios/quick-start の一覧を丸ごと写す -->
</array>
```

## 付録D `ios/App/App/AppDelegate.swift` の末尾に追記する Swift(全文。一字一句写す)

```swift
// ============================================================
// 【殻 S1/S2】Ficus のネイティブ側。新しい .swift を足さず(project.pbxproj を触らないため)ここに置く。
// ============================================================
import WebKit
import AVFoundation

// S1: 自前の ViewController。Main.storyboard の customClass をこれに替える。
class FicusViewController: CAPBridgeViewController {
    // 作者の maximum-scale を「指2本の拡大」だけ無視する = Safari と同じ規則。入力欄の自動拡大は止まったまま(§3.5)。
    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.ignoresViewportScaleLimits = true
        return configuration
    }
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FicusAudioSessionPlugin())
    }
}

// S2: 音の出口。マイクを開いている間、iOS は出力を受話口へ回す。playAndRecord + defaultToSpeaker で本体のスピーカーへ。
// Bluetooth は許可しない(マイクが替わる・遅延)。有線は挿せばそちらへ出る。
@objc(FicusAudioSessionPlugin)
public class FicusAudioSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FicusAudioSessionPlugin"
    public let jsName = "FicusAudioSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "routeToSpeaker", returnType: CAPPluginReturnPromise)
    ]

    @objc func routeToSpeaker(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.overrideOutputAudioPort(.speaker)
            call.resolve([
                "category": session.category.rawValue,
                "outputs": session.currentRoute.outputs.map { $0.portType.rawValue }
            ])
        } catch {
            call.reject("audio session: \(error.localizedDescription)")
        }
    }
}
```

`Main.storyboard` の置換: `customClass="CAPBridgeViewController" customModule="Capacitor"` → `customClass="FicusViewController" customModule="App" customModuleProvider="target"`。

## 付録E `public/privacy.html` の差し替え文(S3)

§2 の表に足す行:

| 情報 | 内容 | 他の利用者から見えるか |
|---|---|---|
| 広告の識別子(iOS アプリ版のみ) | iOS アプリ版では Google AdMob の広告を表示します。AdMob は広告の表示と計測のために、端末の広告識別子(IDFA。iOS の「トラッキング」を許可したときだけ)、IP アドレス、広告の表示・操作の記録を Google へ送ります。Web 版では広告を表示しません。 | 見えません(Google と運営者のみ) |

§4 の「現在、本アプリは広告を表示していません。…本アプリ内でお知らせします。」を次に置き換える:

> iOS アプリ版では、Google LLC の広告配信サービス「Google AdMob」を利用して広告を表示します。AdMob は広告の配信と不正の検知のため、端末の広告識別子・IP アドレス・広告の表示や操作の記録を取得します。iOS の「トラッキングの許可」を拒否した場合も、追跡をしない広告が表示され、本アプリの機能はすべて使えます。Google による情報の扱いは Google のプライバシーポリシー(https://policies.google.com/privacy)と広告の設定(https://adssettings.google.com)をご覧ください。Web 版では広告を表示しておらず、広告ネットワークや解析サービスへの情報提供もありません。

「最終更新日」を改定日に。他の文・`mailto:`・末尾の `.back` は変えない。

## 付録F App のプライバシー(栄養表示)の入力案(本人が App Store Connect に入れる)

| データの種類 | 項目 | 目的 | ユーザーに紐づく | トラッキング | 出どころ |
|---|---|---|---|---|---|
| 識別子 | デバイス ID(IDFA) | 第三者の広告 / アナリティクス | いいえ | **はい** | AdMob(https://developers.google.com/admob/ios/data-disclosure) |
| 位置情報 | おおよその位置情報(IP から) | 第三者の広告 | いいえ | いいえ | AdMob |
| 使用状況データ | 広告データ / 製品の操作 | 第三者の広告 / アナリティクス | いいえ | いいえ | AdMob |
| 診断 | クラッシュデータ / パフォーマンスデータ | アプリの機能 | いいえ | いいえ | AdMob SDK |
| 識別子 | ユーザー ID(匿名アカウント ID) | アプリの機能 | はい | いいえ | Firebase Auth(コミュニティ参加時のみ) |
| ユーザーコンテンツ | その他のユーザーコンテンツ(ニックネーム・プロフィール・目安の数値・練習の日数と時間) | アプリの機能 | はい | いいえ | Firestore |
| ユーザーコンテンツ | 写真またはビデオ(アイコンの写真) | アプリの機能 | はい | いいえ | Cloud Storage |
| ユーザーコンテンツ | カスタマーサポート(お問い合わせ・通報) | アプリの機能 | はい | いいえ | Firestore |
| 音声データ | ─ **収集しない**(端末内で解析。送らない) | ─ | ─ | ─ | ─ |

「IDFA を使用」= はい。年齢 13+。

## 付録G 審査メモの下書き(App Review Information → メモ。日本語で可)

```
Ficus はサックス奏者のためのチューナー・メトロノーム・練習記録アプリです。
- マイクは音程・音量・音色の実時間解析と録音の保存に使います。音声は端末内で解析し、サーバーへ送りません(アプリ起動直後の計測タブで許可を求めます)。
- 全ての画面と書体を同梱しており、機内モードでも計測・リード管理・記録の閲覧が動きます。共有シートでの記録の書き出し、画面のスリープ防止、音声出力の制御、AdMob/ATT はネイティブの機能です。iPad では2ペインの画面になります。
- コミュニティ(匿名認証。氏名・メール不要)は任意です。参加・アカウント削除は下部タブ「コミュニティ」→「マイページ」→「アカウントを削除」。
- UGC の通報は各奏者のページの「通報」、ブロックは同じページの「ブロック」。運営者は Firestore の reports を定期的(週1回以上)に確認し、規約 6 章に従って対応します。連絡先: ficus.help@gmail.com(規約・プライバシーポリシー・サポートページに記載)。
- 広告は AdMob のバナー1本(下部タブの上)。ATT の許可を求める前に追跡しません。
- テスト用のアカウントは不要です(匿名認証)。
```

実機の点検票(§8.4)の写しもここに置く。

## 付録H 根拠の URL(版・仕様)

- Capacitor 8 の要件・SPM 既定: https://capacitorjs.com/docs/updating/8-0 / 設定: https://capacitorjs.com/docs/config / ViewController の継承: https://capacitorjs.com/docs/ios/viewcontroller / 自前の部品: https://capacitorjs.com/docs/ios/custom-code / アイコン・起動画面: https://capacitorjs.com/docs/guides/splash-screens-and-icons
- Capacitor の実装(`zoomingEnabled` / `open func` / `requestMediaCapturePermissionFor → .grant` / `runJavaScriptConfirmPanel`): https://github.com/ionic-team/capacitor/blob/main/ios/Capacitor/Capacitor/CAPBridgeViewController.swift ・ https://github.com/ionic-team/capacitor/blob/main/ios/Capacitor/Capacitor/WebViewDelegationHandler.swift
- WebKit の `ignoresViewportScaleLimits` の意味(指2本の拡大だけ): https://bugs.webkit.org/show_bug.cgi?id=159668 ・ https://trac.webkit.org/r203075
- 版: https://registry.npmjs.org/@capacitor/core/latest ・ /@capacitor/cli/latest ・ /@capacitor/ios/latest ・ /@capacitor/share/latest ・ /@capacitor/filesystem/latest ・ /@capacitor-community/keep-awake/latest ・ /@capacitor-community/admob/latest ・ /@capacitor/assets/latest ・ /@fontsource/instrument-serif/latest
- AdMob プラグイン: https://github.com/capacitor-community/admob (README・Package.swift) / 試験用 ID: https://developers.google.com/admob/ios/test-ads / Info.plist: https://developers.google.com/admob/ios/quick-start / 栄養表示: https://developers.google.com/admob/ios/data-disclosure
- Firebase: https://firebase.google.com/docs/auth/web/custom-dependencies / API キー: https://firebase.google.com/docs/projects/api-keys / 制限: https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys
- Codemagic: https://docs.codemagic.io/yaml-quick-start/building-an-ionic-app/ ・ https://docs.codemagic.io/yaml-code-signing/signing-ios/ ・ https://docs.codemagic.io/yaml-publishing/app-store-connect/ ・ https://docs.codemagic.io/billing/pricing/ ・ https://docs.codemagic.io/specs-macos/xcode-26-4 ・ build-ipa: https://github.com/codemagic-ci-cd/cli-tools/blob/master/docs/xcode-project/build-ipa.md
- WKWebView で `<input type=file>` の「写真を撮る」が落ちる件: https://developer.apple.com/forums/thread/772332
- このツリーで読んだ所: `src/main.jsx` / `index.html` 20-25 / `src/index.css` 11-12・262-269・295-297 / `src/iosViewport.js` / `src/adPreview.js` / `src/App.jsx` 3512-3516(audioSession)・4176-4188(wakeLock)・4208-4248(stop/pause)・4283-4320(startListening)・4864-4903(topTab・visibility)・6238-6255(master gain)・6285(makeup)・5418・5570(AdPreviewStrip)・16190(useAnyBottomSheetOpen)・18247(My Data 0 件) / `src/backup/BackupPanel.jsx` 53-78・95-98・124-126 / `src/community/firebaseClient.js` 1-3・64-65 / `src/community/profile.js` 193-197 / `src/community/CommunityTab.jsx` 496(BackupSheet)・1232(写真の input)・2132(アカウント削除) / `src/community/LegalSheet.jsx` / `public/privacy.html` / `public/support.html` / `scripts/pitch-test.mjs` 251・2712・3626-3627・24997-25005・31015-31064 / `package.json` 13 / メモリ `app-store-readiness.md`
