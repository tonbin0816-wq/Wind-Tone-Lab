# Ficus 1.0.0 App Store 提出の書類(下書き)

便S4(2026-10-25)。本人が App Store Connect(以下 ASC)に**貼るだけ**にするための文。
元の仕様は design/SHELL-SPEC.md §6・§7-G・付録F・付録G。この文書はそれを今の作り(iPhone だけ・初回のプロフィール作成は必須・殻の音声エンジン)に合わせて直したもの。

- 「→ 貼る」の枠は、そのまま ASC の欄に貼る文。
- **【本人が画面で確認】** と書いた所は、ASC の画面の項目名や選択肢が変わっている恐れがある所。画面に合わせて読み替える。
- 事実でないこと(No.1・受賞・ダウンロード数)は書いていない。

---

## 0. 提出の手順(本人がやる順番)

1. **この便が main に入ったことを確かめる**(統括が commit・push する)。Vercel の配信が終わったら、ブラウザで
   https://wind-tone-lab.vercel.app/app-ads.txt を開き、次の1行だけが出ることを確かめる。
   `google.com, pub-8488624336436415, DIRECT, f08c47fec0942fa0`
2. **Codemagic で ios-release を走らせる**: codemagic.io → アプリ → **Start new build** → workflow **ios-release** → branch **main** → Start。
   - 最初の手順「Refuse the demo ad IDs」は、本番の広告 ID が揃っていなければ赤で止まる(止まったら、その赤い行をチャットに貼る)。
   - 15〜25 分で終わる。終わると ASC にビルドが上がる(ASC 側の「処理中」が 10〜30 分続く)。
3. **(任意・おすすめ)TestFlight で本番のビルドを1回だけ確かめる**: 帯に**本物の広告**が出る(**絶対に押さない**)・計測タブで下部タブ「計測」を長押ししても診断の板が**開かない**・版が 1.0.0。
   - 本番のビルドと開発版(Ficus Dev)は同じアプリの枠(jp.tobine.ficus)なので、入れると Ficus Dev が置き換わる。確かめたら TestFlight で開発版(99.0)を入れ直す。本番のビルドのまま毎日触らない(本物の広告を誤って押すと AdMob の無効なトラフィックになる)。
   - TestFlight の「自動アップデート」が有効だと、本番のビルドが自動で入ることがある。**【本人が画面で確認】** TestFlight アプリ → Ficus → 自動アップデート。
4. **ASC → アプリ → 「App 情報」**:
   - サブタイトル(§3.1)
   - カテゴリ: プライマリ **ミュージック**・セカンダリ **教育**
   - コンテンツ配信権(「第三者のコンテンツを含む・表示する・アクセスするか」): このアプリは**他の利用者のニックネーム・プロフィール・アイコンの写真(UGC)を表示する**ので、「はい」に当たる可能性がある。ASC の画面の説明を読み、UGC が第三者のコンテンツに当たるなら「はい」(必要な権利を持っている = 利用規約で利用者が自分の権利のある写真だけを使うと定め、通報で取り外せる)、当たらないなら「いいえ」。**【本人が画面で確認】**
   - 年齢区分: §2 の答えで入力 → 13+ になることを確かめる
5. **「価格および配信状況」**: 価格 **無料(0 円)**・配信地域 **日本だけ**(他の国・地域はすべて外す)。
6. **「App のプライバシー」**:
   - プライバシーポリシー URL: `https://wind-tone-lab.vercel.app/privacy.html`
   - データの収集: §1 の表のとおり入力 → 公開
7. **バージョン「1.0.0」のページ**(「iOS App」→ 1.0 提出準備中):
   - スクリーンショット: iPhone の5枚(別の枝で完成済み)。iPad の欄は出ない(iPhone だけのビルド)。
   - プロモーション用テキスト(§3.4)・説明(§3.5)・キーワード(§3.3)
   - サポート URL: `https://wind-tone-lab.vercel.app/support.html`
   - マーケティング URL: `https://wind-tone-lab.vercel.app/`(AdMob が app-ads.txt を探す「開発者のサイト」はこの欄。https://support.google.com/admob/answer/9363762)
   - 著作権: `2026 <販売元の名前(本名)>` **【本人が画面で確認】**
   - ビルド: 「ビルドを追加」→ 2 で上げた **1.0.0 (番号)** を選ぶ
     - 輸出コンプライアンス: Info.plist で申告済み(`ITSAppUsesNonExemptEncryption = false`)なので、質問は出ない(出たら「いいえ(暗号化を使っていない / 免除のもののみ)」)。
   - App Review に関する情報:
     - サインインが必要: **オフ**(ログインは無い。匿名認証)
     - 連絡先: 本人の名前・電話・メール
     - メモ: §4 の文
   - バージョンのリリース: 「このバージョンを手動でリリースする」がおすすめ(承認後に自分で公開の時機を選べる)。
8. **広告の識別子(IDFA)**: 提出の途中で「この App は広告識別子(IDFA)を使用しますか」と聞かれたら **はい**。
   今の ASC はこの質問を出さず、App のプライバシー(§1 のデバイス ID・トラッキング = はい)で申告する形のことがある。**【本人が画面で確認】**
9. 「審査用に追加」→「審査へ提出」。
10. **承認のあと**(公開の前でもよい):
    - AdMob → アプリ → Ficus → **アプリの設定 → App Store のリンクを追加**(殻の仕様 §7-E-4)。リンクするまで広告の配信は限られる。
    - AdMob の「app-ads.txt」の画面で、確認済みになるのを待つ(数日かかることがある)。
    - レビューの行(src/support.js の APP_STORE_REVIEW_URL)は公開後の別の便。

---

## 1. App のプライバシー(栄養表示)

SHELL-SPEC 付録F を今の作りで見直した表。「集める」= このアプリまたは組み込んだ SDK(Firebase・Google Mobile Ads)が端末の外へ送るもの。
AdMob の行は Google の開示(https://developers.google.com/admob/ios/data-disclosure。Google Mobile Ads SDK 7.68.0 以降の一覧)と1行ずつ突き合わせた。引用は英語の原文のまま。
Google の一覧は6つ(IP address / Crash logs / Performance data / Device ID / Advertising data / Other product interactions)で、下の AdMob の6行がそれぞれに当たる。

| データの種類(ASC の分類) | 項目 | 目的 | ユーザーに紐づく | トラッキング | 出どころ・根拠 |
|---|---|---|---|---|---|
| 識別子 | **ユーザー ID**(匿名アカウント ID) | App の機能 | はい | いいえ | Firebase Authentication の匿名認証。初回のプロフィール作成で必ず作られる |
| 識別子 | **デバイス ID** | サードパーティ広告・分析 | いいえ | **はい** | AdMob「A Device ID, such as the device's advertising identifier or other app- or developer-bounded device identifiers」「used for the purpose of third-party advertising and analytics」。IDFA は ATT で「許可」したときだけ。ほかに、アプリ・開発者に限った端末識別子(IDFV など)は ATT に関係なく集まる |
| 位置情報 | **おおよその位置情報**(IP アドレスから) | サードパーティ広告・分析 | いいえ | いいえ | AdMob「IP address, which may be used to estimate the general location of a device」(目的は Google が明記していない。広告の配信と計測に使う前提で申告) |
| 使用状況データ | **広告データ**(見た広告など) | サードパーティ広告・分析 | いいえ | **はい**(下の注) | AdMob「Advertising data, such as advertisements the user has seen, may be used to power analytics and advertising features」 |
| 使用状況データ | **製品の操作**(起動のタップ・動画の視聴など) | サードパーティ広告 | いいえ | いいえ | AdMob「Other user product interactions like app launch taps, and interaction information, like video views」「used to improve advertising performance」 |
| 診断 | **クラッシュデータ** | App の機能・サードパーティ広告・分析 | いいえ | いいえ | AdMob「Non-user related crash logs, which may be used to diagnose problems and improve the SDK」「Diagnostic information may also be used for advertising and analytics purposes」。Google が non-user related と書いているので「紐づく = いいえ」 |
| 診断 | **パフォーマンスデータ**(起動時間・応答なし・電力) | 分析・サードパーティ広告 | **はい** | いいえ | AdMob「User-associated performance data such as app launch time, hang rate, or energy usage」(利用の様子の評価と機能の計画に使い、「may also be used for displaying ads, including sharing with other entities that display ads」)。Google が user-associated と書いているので「紐づく = はい」 |
| ユーザーコンテンツ | **写真またはビデオ**(アイコンの写真1枚・選んだ人だけ) | App の機能 | はい | いいえ | Cloud Storage for Firebase。保存の前に Cloud Vision API で自動判定 |
| ユーザーコンテンツ | **その他のユーザーコンテンツ**(ニックネーム・プロフィールの項目・楽器の組・目安の数値・練習の日数と時間・通報) | App の機能 | はい | いいえ | Cloud Firestore(users / ideals / reports) |
| ユーザーコンテンツ | **カスタマーサポート**(お問い合わせ・要望/感想の本文) | App の機能 | はい | いいえ | Cloud Firestore(feedback。匿名アカウント ID・端末の種別と一緒に) |
| 音声データ | ─ **集めない** | ─ | ─ | ─ | マイクの音は端末の中で解析して数値にするだけ。音声は保存も送信もしない |
| 連絡先情報(名前・メール・電話) | ─ **集めない** | ─ | ─ | ─ | 入力欄が無い(お問い合わせの本文に書くかは利用者しだい) |
| 位置情報(正確な位置) | ─ **集めない** | ─ | ─ | ─ | 写真は作り直して Exif(撮影場所)を取り除いてから送る |

- 注(広告データのトラッキング): ATT で「許可」した人の広告データは IDFA と一緒に広告の配信と計測に使われうるので、**多く申告する側(はい)**にした。Google の開示は「紐づくか・トラッキングか」を Apple の言葉では書いていない(書いているのは crash logs の non-user related と performance data の user-associated だけ)。迷ったら多く申告するのが安全(少なく申告すると審査で差し戻される)。
- 「ユーザーに紐づく」は、Google が書いている2行(クラッシュ = いいえ・パフォーマンス = はい)だけ Google の言葉に従い、残りの AdMob の行は付録F と同じ「いいえ」(運営者が AdMob のデータを匿名アカウントや本人と結び付けないため)。
- パフォーマンスデータの「トラッキング」は「いいえ」にしたが、Google は「広告を表示する他の事業者との共有」に触れている。ASC の画面の説明を読んで「はい」に当たると思えば「はい」にする。**【本人が画面で確認】**
- Google の開示は「任意の機能や試験を使うと、追加の開示が要ることがある」と書いている。このアプリは任意の機能(メディエーションなど)を使っていない。
- データの「販売」はしない。Firebase は保存先(運営者の処理の委託先)。

---

## 2. 年齢区分の質問への推奨の答え(13+ 見込み)

Apple の年齢区分は 2025 年に改められ、4+ / 9+ / 13+ / 16+ / 18+ になった。質問は「App 内の機能」「成人向けのテーマ」「医療・健康」「性的な内容・ヌード」「暴力」「偶然性のある活動」などの群に分かれている。
**項目名と選択肢は ASC の画面で必ず確かめること。【本人が画面で確認】**

| 群 | 質問(要旨) | 推奨の答え | 理由 |
|---|---|---|---|
| App 内の機能 | ペアレンタルコントロール | いいえ | 無い |
| App 内の機能 | 年齢の確認(年齢の保証) | いいえ **【本人が画面で確認】** | 「13歳以上です」の自己申告のチェックだけ(身元の確認はしない) |
| App 内の機能 | 制限のない Web アクセス | いいえ | 規約・ポリシーはアプリの中で表示。外のサイトへ出る導線は mailto だけ |
| App 内の機能 | ユーザー生成コンテンツ | **はい** | ニックネーム・プロフィール・アイコンの写真が他の利用者に見える。通報・ブロックあり |
| App 内の機能 | メッセージ・チャット | いいえ | 利用者どうしでやりとりする機能は無い |
| App 内の機能 | 広告 | **はい** | AdMob のバナー |
| 成人向けのテーマ | 下品な言葉・粗野なユーモア / ホラー・恐怖 / アルコール・タバコ・薬物 / 成人向け・示唆的なテーマ | すべて「なし」 | 無い(利用者の投稿は NG ワードと写真の自動判定・通報で抑える) |
| 医療・健康 | 医療・治療の情報 / 健康・ウェルネス | なし | 無い |
| 性的な内容・ヌード | すべて | なし | 無い(写真は Cloud Vision の自動判定で不適切なものを保存しない) |
| 暴力 | アニメ・漫画・ファンタジー / リアル / 長時間・無償の暴力 | すべて「なし」 | 無い |
| 偶然性のある活動 | ギャンブル / 模擬ギャンブル / コンテスト / ルートボックス | すべて「なし」 | 無い(練習の日数・時間の順位はあるが賞品は無い) |

- 答えの計算で 13+ より下に出たら、**「より高い年齢区分を選ぶ」の項目で 13+ にする**(規約 1 章: コミュニティは 13歳以上。初回にプロフィールを作るので、アプリ全体が 13歳以上向け)。その項目が無い場合は統括に相談。**【本人が画面で確認】**
- 「子ども向けカテゴリ」には入れない。

---

## 3. 掲載の文

名前(済・変えない): **Ficus サックス奏者のためのチューナー&メトロノーム**
ストアの絵の流れ: ① サックス練習の決定版 ② チューナー&メトロノームがあなたの音を計測 ③ 傾向がグラフで見える ④ みんなの音と比べられる ⑤ リードごとの傾向。

### 3.1 サブタイトル(上限 30 字)→ 貼る

```
リード管理・音程と倍音・練習記録
```

(16 字。既存の案のまま)

### 3.2 カテゴリ

プライマリ: ミュージック / セカンダリ: 教育

### 3.3 キーワード(上限 100 バイト。半角カンマ区切り・空白なし)→ 貼る

```
アルト,テナー,ソプラノ,吹奏楽,ジャズ,音色,ロングトーン,管楽器,楽器
```

- 名前とサブタイトルにある語(サックス・チューナー・メトロノーム・リード・音程・倍音・練習・記録)は入れない(重ねても効かない)。
- 字数は §6。

### 3.4 プロモーション用テキスト(上限 170 字)→ 貼る

```
吹くたびに、音程・音量・音色を計測。練習の傾向がグラフで見え、リードごとの違いや、同じ楽器のみんなの音との違いもわかります。チューナーとメトロノームをひとつにした、サックス練習の決定版。
```

### 3.5 説明(上限 4000 字)→ 貼る

```
Ficus は、サックス奏者のためのチューナー&メトロノームです。
録音ボタンを押して吹くと、音程・音量・音色を計測して記録します。記録がたまるほど、自分の音のクセが見えてきます。

■ チューナー&メトロノームがあなたの音を計測
・音程(セント)・音量・音色(倍音の構成・スペクトル重心・HNR)を、吹いている間ずっと表示
・メトロノームを鳴らしながら計測できます。小節の頭は記録のグラフにも線で残ります
・S.Sax / A.Sax / T.Sax / B.Sax に対応

■ 傾向がグラフで見える
・計測ごとに、音ごとの音程のずれと音色をグラフで振り返れます
・すべての計測をまとめて、音の傾向を見られます
・分析では、リードやメーカーなどの項目ごとに数値を並べて比べられます

■ みんなの音と比べられる
・コミュニティでは、同じ楽器の奏者の平均と自分の音を比べられます
・楽器・マウスピース・リガチャー・リードの組み合わせごとの傾向も見られます
・みんなの平均や気になる奏者の数値を「目安」にすると、自分の音との違いがわかります
・練習した日数と時間の順位もあります
・コミュニティは匿名です。メールアドレスや電話番号の登録はいりません

■ リードごとの傾向
・リードを1枚ずつ登録して、計測に結び付けられます
・リードごとの音程・音色の違いを重ねて比べられます

■ 記録は端末の中に
・計測の記録は端末の中に保存されます。音声そのものは保存も送信もしません
・はじめのプロフィール作成のあとは、機内モードでも計測・リード・記録の閲覧が使えます
・「アカウント引継」で記録をファイルに書き出し、端末を替えたあとに読み戻せます

■ ご利用にあたって
・はじめて起動したとき、利用規約とプライバシーポリシーへの同意のあと、コミュニティのプロフィール(ニックネームなど)を作成します
・コミュニティは13歳以上の方が対象です
・広告を表示します(無料)
・計測の値はマイクや周りの環境の影響を受けます。ご自身の演奏の変化を見るための目安としてお使いください

お問い合わせ: アプリのマイページの「お問い合わせ」または ficus.help@gmail.com
```

---

## 4. 審査メモ(App Review Information → メモ)→ 貼る

日本語のあとに英語を併記する。上限 4000 字に収まる(§6)。

```
【日本語】
Ficus はサックス奏者のためのチューナー・メトロノーム・練習記録のアプリです。ログインは不要で、すべての機能をそのまま試せます(テスト用のアカウントはありません)。

■ 起動してからの流れ
1. 「はじめる」→ 利用規約とプライバシーポリシーに同意 →「次へ」(このとき iOS のトラッキングの許可を尋ねます。拒否しても全機能が使えます)
2. コミュニティのプロフィールを作成します(必須)。ニックネームを入れ、ほかの項目は一覧から選ぶだけです(楽器・マウスピースなどに該当が無ければ「その他」)。「13歳以上です」にチェックして保存してください。
   ・必須にしている理由: 本アプリの中心は「自分の音を、同じ楽器・同じ組み合わせの奏者と比べる」ことで、比べる相手の分類(楽器種別・楽器の組・属性など)がプロフィールから決まるためです。
   ・匿名です: Firebase の匿名認証を使い、氏名・メールアドレス・電話番号は一切集めません。作成後はマイページの「公開」スイッチで非公開にでき、いつでもアカウントを削除できます。
3. 計測タブでマイクの許可を求めます。

■ マイクの用途
音程・音量・音色(倍音)を実時間で解析するために使います。解析は端末の中で行い、音声そのものは保存も送信もしません(数値だけを端末に記録します)。

■ ガイドライン 4.2(最低限の機能)について
1. 画面・書体・処理をすべてアプリに同梱しています。リモートの Web ページを読み込む作りではなく、初回のプロフィール作成のあとは、機内モードでも計測・リード管理・記録の閲覧が動きます。
2. マイクの音はネイティブの音声エンジン(AVAudioEngine)で取り込み、音程・倍音・HNR の解析を端末の中だけで行います。
3. メトロノームもネイティブの音声エンジンで鳴らし、音の出口(本体のスピーカー・有線イヤホン・Bluetooth の出力)を制御します。
4. ネイティブの機能: 共有シートによる記録の書き出し(ファイル)、録音中の画面のスリープ防止、AdMob の広告と App Tracking Transparency。
5. 計測の記録の蓄積とグラフでの分析、リードの管理、動画・音声ファイルの取り込みの端末内解析。

■ アカウントの削除(5.1.1(v))
下部タブ「コミュニティ」→ 上の「マイページ」→ 一番下の「アカウントを削除」→ 確認の画面で「アカウントを削除する」。サーバー上のプロフィール・練習の記録・目安・アイコンの写真・匿名アカウントを削除します。

■ ユーザー生成コンテンツ(1.2)
・通報: 他の奏者のページにある「通報」
・ブロック: 同じページの「ブロック」(マイページの「ブロック中の人」から解除)
・ニックネームは NG ワードで、アイコンの写真は保存の前に自動判定(Google Cloud Vision)で確かめます
・連絡先: アプリ内の「お問い合わせ」(マイページ)と ficus.help@gmail.com(利用規約・プライバシーポリシー・サポートページに記載)
・運営者は通報(Firestore の reports)を週1回以上確認し、利用規約 6 章に従って、プロフィールや写真の公開停止・アカウントの利用停止を行います

■ 広告
AdMob のバナー1本(下部タブの上)。シートを開いている間と、はじめの案内の間は表示しません。トラッキングの許可を尋ねる前に追跡はしません。

■ 対応する端末
iPhone だけです(縦向き)。

【English】
Ficus is a tuner, metronome and practice log for saxophone players. No login is required; every feature can be tried as is (no test account).

First launch: "はじめる" (Start) → agree to the Terms and Privacy Policy → "次へ" (Next); iOS then asks for tracking permission (all features work if declined). Creating a community profile is then required: enter any nickname, pick the other items from the lists ("その他" = Other if nothing matches), check "13歳以上です" (13 or older) and save. It is required because the core of the app is comparing your sound with players of the same instrument and gear, and those groups come from the profile. It is anonymous (Firebase Anonymous Authentication): no name, email or phone number is collected. The profile can be made private ("公開" switch) or deleted at any time.

Microphone: requested on the Measure tab, used to analyze pitch, volume and timbre in real time. Analysis runs on the device; audio is never stored or sent (only numbers are saved on the device).

Guideline 4.2: (1) All screens, fonts and logic are bundled; no remote website is loaded, and after the first-run profile creation, measuring, reeds and records work in Airplane Mode. (2) Microphone input is captured with a native audio engine (AVAudioEngine) and analyzed only on the device. (3) The metronome plays through the native audio engine with audio-route control (speaker, wired, Bluetooth output). (4) Native features: share-sheet export, keep-awake while recording, AdMob with App Tracking Transparency. (5) Graphs and analysis of accumulated measurements, reed management, on-device analysis of imported video/audio files.

Account deletion (5.1.1(v)): tab "コミュニティ" (Community) → "マイページ" (My Page) → "アカウントを削除" (Delete account) at the bottom → confirm "アカウントを削除する".

UGC (1.2): "通報" (Report) and "ブロック" (Block) are on every other player's page; unblock from "ブロック中の人" on My Page. Nicknames are filtered and icon photos are checked automatically (Google Cloud Vision). Contact: in-app "お問い合わせ" on My Page and ficus.help@gmail.com. The developer reviews reports at least once a week and acts under section 6 of the Terms.

Ads: one AdMob banner, hidden while a sheet is open and during the first-run guide. No tracking before the permission is requested. Devices: iPhone only (portrait).
```

---

## 5. 本人が ASC に入力する項目の一覧(写し)

| 画面 | 項目 | 入れる値 |
|---|---|---|
| App 情報 | 名前 | 済(変えない) |
| App 情報 | サブタイトル | §3.1 |
| App 情報 | カテゴリ | ミュージック / 教育 |
| App 情報 | コンテンツ配信権 | 他の利用者の UGC を表示する → 「はい」の可能性(§0-4)【本人が画面で確認】 |
| App 情報 | 年齢区分 | §2 → 13+ |
| 価格および配信状況 | 価格 / 配信地域 | 無料 / 日本だけ |
| App のプライバシー | プライバシーポリシー URL | https://wind-tone-lab.vercel.app/privacy.html |
| App のプライバシー | データの収集 | §1 |
| 1.0.0 | スクリーンショット | iPhone 5枚(別の枝) |
| 1.0.0 | プロモーション用テキスト / 説明 / キーワード | §3.4 / §3.5 / §3.3 |
| 1.0.0 | サポート URL / マーケティング URL | https://wind-tone-lab.vercel.app/support.html / https://wind-tone-lab.vercel.app/ |
| 1.0.0 | 著作権 | 2026 販売元の名前 |
| 1.0.0 | ビルド | ios-release の 1.0.0 |
| 1.0.0 | サインイン情報 | 不要(オフ) |
| 1.0.0 | 連絡先 / メモ | 本人 / §4 |
| 1.0.0 | 輸出コンプライアンス | 申告済み(出たら「いいえ」) |
| 提出時 | IDFA の使用 | はい |
| 承認後 | AdMob の App Store のリンク | アプリの設定から追加 |

---

## 6. 字数の数え方(この文書の値の根拠)

src/submissionDoc.test.js が、この文書の §3.1・§3.3・§3.4・§3.5 の枠(``` の中)を読んで数える:
サブタイトル ≤ 30 字・キーワード ≤ 100 バイト(UTF-8。日本語は1字 3 バイト)・プロモーション用テキスト ≤ 170 字・説明 ≤ 4000 字。
数えた値(2026-10-25): サブタイトル 16 字 / キーワード 95 バイト / プロモーション用テキスト 93 字 / 説明 936 字 / 審査メモ 3823 字(上限 4000)。
文を直したら検査を回す(検査は上限だけを見る。この行の数は手で直す)。
