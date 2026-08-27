# App Store 審査要件 裏取り調査(Ficus コミュニティ機能)

- 調査日: 2026-08-27
- 一次ソース: https://developer.apple.com/app-store/review/guidelines/ (2026-08-27 取得)
- 前提: UGC は「ニックネーム(自由入力)」のみ。共有は数値データのみ。通報1件で対象プロフィールを即自動非公開にする設計。認証は Firebase 匿名認証のみ。Kids カテゴリには入れない。

---

## 1. Guideline 1.2 — User-Generated Content

### 原文(2026-08-27 時点)

> Apps with user-generated content present particular challenges, ranging from intellectual property infringement to anonymous bullying. To prevent abuse, apps with user-generated content or social networking services must include:
>
> - A method for filtering objectionable material from being posted to the app
> - A mechanism to report offensive content and timely responses to concerns
> - The ability to block abusive users from the service
> - Published contact information so users can easily reach you
>
> It is your responsibility to remove content that violates this guideline, your terms of service, or your community standards. If we find such content, we will ask you to remove it, and provide a plan to improve your compliance with this guideline. Based on your response, your app may be removed from the App Store until you can demonstrate improvements that bring your app into compliance. Egregious or repeated behavior is grounds for immediate removal of your app from the App Store, and from the Apple Developer Program.

出典: https://developer.apple.com/app-store/review/guidelines/#user-generated-content (一次情報)

### 「24時間以内」は書かれているか

**ガイドライン本文には書かれていない。** 本文の時間表現は "timely responses to concerns"(懸念への迅速な対応)のみ。

ただし、App Review の実際のリジェクト通知テンプレートには次の文言が使われている実例がある(Apple 公式 Developer Forums、2021年8月投稿の開発者によるリジェクト文引用):

> "The developer must act on objectionable content reports within 24 hours by removing the content and ejecting the user who provided the offending content"

出典: https://developer.apple.com/forums/thread/688227 (Apple 公式フォーラム上の開発者引用 = 準一次。Apple が公開文書として明文化したものではない)

つまり「24時間」は**ガイドラインの成文規定ではなく、App Review の運用上の事実上の基準**。2026年時点のリジェクト文面でも同一文言かは未確認(後述)。

### 「通報→自動非公開」で要件を満たせるかの解釈

要求される4要素に照らすと:

| 要素 | 本設計での充足 |
|---|---|
| フィルタリング | **別途必要。** ニックネームが唯一の自由入力なので、投稿時のNGワード/不適切語フィルタを入れる。プルダウン/数値のみの共有部分はそれ自体がフィルタリングと説明できる |
| 通報 + 迅速な対応 | **通報→即時自動非公開は "timely" を満たす強い実装。** 24時間基準を事実上ゼロ秒で満たす。審査ノートに明記する価値あり |
| 悪質ユーザーのブロック | **自動非公開だけでは満たせない。** これは「ユーザーが他のユーザーをブロックできる機能」の要求。リジェクトテンプレも "ejecting the user"(コンテンツ削除だけでなく発信者の排除)まで求める。ユーザー単位のブロック機能を別途実装すべき |
| 連絡先の公開 | **別途必要。** アプリ内(またはApp Storeサポート URL)に到達容易な連絡先を掲示 |

**結論: 通報→自動非公開は「通報+迅速対応」1要素の充足にすぎない。フィルタリング・ブロック・連絡先公開の3要素を追加実装しないと 1.2 リジェクトの可能性が高い。** なお「ニックネームだけなら UGC 扱いを免れる」という公式の免除規定は探したが見つからなかった。プロフィールを他ユーザーに見せる時点で UGC 扱いと想定するのが安全。

---

## 2. Guideline 4.8 — Login Services

### 原文(2026-08-27 時点)

> Apps that use a third-party or social login service (such as Facebook Login, Google Sign-In, Log in with X, Sign In with LinkedIn, Login with Amazon, or WeChat Login) to set up or authenticate the user's primary account with the app must also offer as an equivalent option another login service with the following features:
>
> - the login service limits data collection to the user's name and email address;
> - the login service allows users to keep their email address private as part of setting up their account; and
> - the login service does not collect interactions with your app for advertising purposes without consent.
>
> Another login service is not required if:
>
> - Your app exclusively uses your company's own account setup and sign-in systems.
> - (中略: 代替マーケットプレイス / 教育・企業アプリ / 政府ID / 特定サードパーティサービス専用クライアントの各例外)

出典: https://developer.apple.com/app-store/review/guidelines/#login-services (一次情報)

### 日本語要約と本アプリ設計への影響

- 4.8 が発動するのは「**第三者/ソーシャルログインでプライマリアカウントを作る場合**」のみ。しかも現行文言では Sign in with Apple 固定ではなく「同等のプライバシー保護を持つ別のログイン」で足りる。
- **Firebase 匿名認証のみの場合、ユーザーに提示される第三者ソーシャルログインは存在しないため 4.8 は発動しない。Sign in with Apple は不要。**(Firebase はインフラであってユーザーが第三者IDでサインインするわけではない。実態としても「自社のアカウント設定・サインインシステムのみ」の例外に相当)
- **注意:** 将来 Google Sign-In 等を追加した瞬間に 4.8 が発動し、Sign in with Apple(または同等要件を満たすログイン)の併設が必要になる。機種変更時のデータ引き継ぎ手段として第三者ログインを足す時が要注意点。
- 反証として「匿名認証のみで SIWA を要求された」という公式記述・確度の高い事例は探したが見つからなかった。

---

## 3. Guideline 5.1.1(v) — Account Sign-In / アカウント削除

### 原文(2026-08-27 時点、抜粋)

> If your app doesn't include significant account-based features, let people use it without a login. If your app supports account creation, you must also offer account deletion within the app. Apps may not require users to enter personal information to function, except when directly relevant to the core functionality of the app or required by law.

出典: https://developer.apple.com/app-store/review/guidelines/#5.1.1 (一次情報)

### 匿名認証のみのアプリにも適用されるか

**適用される。** Apple 公式サポートページ「Offering account deletion in your app」に自動生成アカウント(ゲストアカウント)への明示的言及がある:

> "Users should have the option to delete automatically generated accounts (sometimes called 'guest' accounts) and the data associated with those accounts."

> "Offer to delete the entire account record, along with associated personal data. You may include additional options, but only offering to temporarily deactivate or disable an account is insufficient."

> "People expect that all data associated with their account will be deleted when the account is deleted."

出典: https://developer.apple.com/support/offering-account-deletion-in-your-app/ (一次情報。2022-06-30 発効)

### 本アプリ設計への影響

- Firebase 匿名認証は「自動生成アカウント」に該当。**アプリ内から開始できる完全削除(Firebase Auth ユーザー + Firestore 等のサーバ側レコードの削除)が必須。**
- 「一時的な非公開化・無効化では不十分」と明記されている。通報時の自動非公開はモデレーション施策としては良いが、**アカウント削除要件の代わりにはならない**(別機能として両方持つ)。
- ニックネームは任意入力にする(個人情報の入力をアプリ利用の必須条件にしない)。コア機能(練習記録)はコミュニティ参加なしで使える設計を維持するのが 5.1.1(v) 前段("let people use it without a login")とも整合。

---

## 4. 補足 — 未成年利用と年齢まわりの要求(非 Kids カテゴリ)

### ガイドライン上の年齢確認義務

現行ガイドラインで「verified or declared age による年齢制限メカニズム」を明示的に要求しているのは以下の2箇所のみで、**いずれも本アプリには該当しない**:

> **1.2.1(a)** Creator apps must provide a way for users to identify content that exceeds the app's age rating, and use an age restriction mechanism based on verified or declared age to limit access by underage users.

> **4.7.5** (Mini apps/プラットフォーム型アプリ向け) Your app must provide a way for users to identify software that exceeds the app's age rating, and use an age restriction mechanism based on verified or declared age to limit access by underage users.

出典: https://developer.apple.com/app-store/review/guidelines/ (一次情報)

→ 数値データ共有コミュニティは Creator app でもミニアプリプラットフォームでもないため、**一般アプリとしての年齢確認(本人確認)義務は現時点でない。**

### ただし実務上効いてくるもの(一次情報)

1. **年齢レーティング刷新(4+/9+/13+/16+/18+)**: 更新版質問票への回答が 2026-01-31 までに必須化済み。未回答だと更新申請が止まる。
   出典: https://developer.apple.com/news/?id=ks775ehf / https://developer.apple.com/news/upcoming-requirements/?id=07242025a (一次情報)
2. **ソーシャルメディア質問の追加(2026-07-09 発表)**: 質問票に social media capability("the ability to redistribute, amplify, or interact with user-generated content through a social feed or similar discovery method")の設問が追加され、**2026年9月以降の新規申請・アップデートで回答必須**。該当するとストアページに Social Media コンテンツ記述子が表示され、ペアレンタルコントロールの Time Allowance 区分にも影響。13歳未満に対してソーシャル機能を無効化していると申告すれば、13歳未満向けの Social Media 区分から外れる。
   出典: https://developer.apple.com/news/?id=tlur8uvi (一次情報)
   → **コミュニティ機能(他ユーザーの数値データを閲覧・比較するフィード)が social media capability に該当すると判定される可能性がある。** 申請時にこの設問へ正直に回答する必要があり、レーティングが上がる可能性を織り込む。
3. **2.3.6(レーティングの正直な申告)** と **5.1.4(b)**: 未成年から個人情報(名前・永続識別子との組み合わせ等)を収集し得るアプリはプライバシーポリシー必須+各国の児童プライバシー法(COPPA 等)遵守。ニックネーム+匿名UID の組み合わせでも「個人情報の収集」に当たり得るため、プライバシーポリシーには明記する。
   出典: https://developer.apple.com/app-store/review/guidelines/ (一次情報)

---

## 反証・限界

- **反証(1.2)**: 「通報→自動非公開で十分」という結論への最大の反証は、App Review テンプレが "removing the content **and ejecting the user**" まで要求している点と、ガイドラインが4要素(フィルタ/通報/ブロック/連絡先)を並列で要求している点。自動非公開単体では2〜3要素が欠ける。
- **反証(4.8)**: 匿名認証のみで Sign in with Apple を要求された公式記述・確度の高い実例は探したが見つからなかった。
- **反証(5.1.1(v))**: 匿名認証なら削除不要とする公式記述は存在しない。逆にゲストアカウントも削除対象と公式 FAQ に明記。

## わからなかったこと

- 「24時間」文言が **2026年現在の** リジェクトテンプレでも維持されているか(確認できた実例は2021年のもの。ガイドライン本文には過去も現在も無い)。
- 「数値データのみの共有フィード」が新質問票の social media capability に該当するかの公式判定細目(定義文はあるが線引きの実例が未公開)。
- Firebase 匿名認証のみのアプリが 5.1.1(v) で実際にリジェクトされた/通過した審査実例。
- 米国一部州の年齢確認法(App Store Accountability Act 系)への Apple 側対応(Declared Age Range API 等)が個々のアプリに追加義務を課すかの詳細。
