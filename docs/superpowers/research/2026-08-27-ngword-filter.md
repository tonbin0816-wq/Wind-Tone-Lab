# NGワードフィルタ調達調査(ニックネーム欄向け)

- 調査日: 2026-08-27
- 対象: アプリのニックネーム欄(唯一の自由入力・公開・未成年含む・日本語中心+英語ニックネーム想定)
- 調査者: Claude(調査部隊)

---

## 1. 日本語の不適切語リスト(オープンソース・商用利用可)

| 候補 | 収録規模 | ライセンス | 最終更新(push) | 特徴 |
|---|---|---|---|---|
| [MosasoM/inappropriate-words-ja](https://github.com/MosasoM/inappropriate-words-ja) | Sexual.txt 281語 + Offensive.txt 49語(暫定) ≒ 330語 | **MIT** | 2021-12-01(GitHub API) | 「単語それ自体が不適切と断定できるもの」だけを人力収集する方針。文脈依存語を除外しており誤検知が少ない設計。★208 |
| [LDNOOBW/…/ja](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/blob/master/ja) | 180行 | **CC BY 4.0**(要クレジット表記) | リポジトリ全体で2024-08-05 | 旧Shutterstock製。「エクスタシー」「人妻」「ランジェリー」「プレイボーイ」など単独では中立的な語が混在し、そのまま使うと誤検知源になる。★3,432 |
| [censor-text/profanity-list ja.txt](https://github.com/censor-text/profanity-list) | 172行 | **Unlicense**(パブリックドメイン相当) | **2024-11-22にアーカイブ化(更新停止)** | 22言語以上。日本語表記の単語リスト。メンテ終了済み |
| [LDNOOBWV2(PeterGraebner)ja.txt](https://github.com/LDNOOBWV2/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words_V2) | 468語 | **CC0-1.0** | 継続的コミットあり(具体日付未確認) | 複数リストの機械的統合による「V1後継」。日本語分の品質は未レビューで不明 |

ライセンス確認は各リポジトリのGitHub表示およびGitHub APIによる(一次情報)。

参考(採用不可): [whymのgist「Japanese bad words list」](https://gist.github.com/whym/b5ac3feb2a78797c9d98)等のgist系はライセンス表記が無く、商用調達の根拠にできない。

**所見**: 日本語で「攻撃的・差別語」を広くカバーする商用可リストは薄い(MosasoMのOffensive.txtが49語で暫定扱い)。放送禁止用語系の包括的リストでライセンスが明確なOSSは**探したが見つからなかった**。

## 2. 英語の不適切語リスト

| 候補 | 収録規模 | ライセンス | 最終更新 | 特徴 |
|---|---|---|---|---|
| [dsojevic/profanity-list](https://github.com/dsojevic/profanity-list) | en: 434語・809マッチパターン | **MIT** | 2021-10-23(GitHub API) | **severity(1〜4)・exceptions(誤検知除外語)・tags付きのJSON**。Scunthorpe対策のexceptionsを同梱する唯一の候補。日本語なし。★82 |
| [LDNOOBW/…/en](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/blob/master/en) | 約540語(複数語フレーズ含む) | **CC BY 4.0** | 2024-08-05 | 事実上の定番。ただしプレーンリストで重大度・例外情報なし |
| [LDNOOBWV2 en.txt](https://github.com/LDNOOBWV2/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words_V2) | 12,996語 | **CC0-1.0** | 継続更新 | 約75言語5万語超の統合リスト。規模が過剰で、短いニックネーム照合では誤検知源になりやすい |
| (参考ライブラリ)[jo3-l/obscenity](https://github.com/jo3-l/obscenity) | 英語プリセット内蔵 | **MIT** | 活発(292コミット) | リストではなくTS/JS検出ライブラリ。leet・Unicode confusables変換とホワイトリストを実装済み。英語のみ |

## 3. ニックネーム検証のベストプラクティス

### 3.1 正規化(どこまでやるか)

照合前にサーバ側で以下のパイプラインを通し、**正規化後の文字列に対してリスト照合**する。

1. **Unicode NFKC正規化**([UAX #15](https://unicode.org/reports/tr15/)、一次情報) — 全角英数→半角、半角カナ→全角カナ、互換文字の統一が一括で片付く。OWASPもフリーテキスト検証の第一手段に正規化(canonical encoding)を挙げる([Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)、一次情報に準ずる標準文書)。
2. **小文字化(case fold)** — 英語ニックネームの大小文字ゆれ対策。
3. **カタカナ→ひらがな変換(独自1対1マップ)** — NFKCはカナ種を統一しないため自前で行う。リスト側も同じ変換をかけて照合する。
4. **leet変換(英字列に限定)** — `0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s` 程度の保守的なマップ。[obscenity](https://github.com/jo3-l/obscenity)の実装が参考になる。
5. **Unicode confusables(見た目が同じ文字)** — 厳密にやるなら [Unicode TS #39](https://unicode.org/reports/tr39/) のskeletonアルゴリズム(一次情報)。初期リリースでは「ニックネームに許可する文字種を制限する(ひらがな・カタカナ・漢字・英数と一部記号のみ許可)」方が確実で、confusables問題自体を大幅に減らせる。
6. **高severity語のみ、記号・空白・長音を除去した文字列でも再照合**(`f_u_c_k`型の回避対策)。全語に適用すると誤検知が増えるため限定する。

### 3.2 部分一致と誤検知(Scunthorpe問題)

- 英単語を部分一致で探すと正当な語を誤ブロックする([Scunthorpe problem - Wikipedia](https://en.wikipedia.org/wiki/Scunthorpe_problem)、二次資料だが事例集として有用)。Wikipediaも実務資料も**許可リスト(例外リスト)が最有効**とし、完全解決は困難としている。
- 日本語は分かち書きがないため部分一致が前提になる。だからこそ「単独で不適切と断定できる語だけ収録する」というMosasoMの方針がニックネーム用途に合う(リスト設計側で誤検知を抑える)。
- 英語はdsojevicの `exceptions` フィールド+自前の許可リストで対処。ブロック時は理由(どの語に当たったか)をユーザーに返さない — 回避方法の学習を防ぐため。

### 3.3 クライアントとサーバ両方で検証する理由

- **サーバ側は必須**: OWASPは「クライアント側のJS検証はJS無効化やWebプロキシで回避できるため、サーバ側で必ず検証せよ」と明記([出典](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html))。公開されるニックネームの最終ゲートはサーバの正規化+照合ロジック一箇所に置く。
- **クライアント側はUX目的**: 送信前に同じ判定を走らせ即時フィードバックする(リスト同梱はAPKやバンドルから抽出され得るが、判定の真実はサーバ側にあるため実害は小さい)。

### 3.4 リスト方式そのものの限界(反証として重要)

Dodge et al. (2021) はLDNOOBWリストによる機械的フィルタが、文脈を見ないために少数者に関する無害なテキストまで過剰に排除することを実証した([Documenting Large Webtext Corpora (C4)](https://www.semanticscholar.org/paper/1adadbfa95e43a70fcd17e6ce947a0652b86bfc3)、査読論文)。リストは「明白な語を機械で止める一次防壁」にとどめ、**通報機能+事後の人的モデレーションを併設する**のが、未成年を含む公開欄では前提になる。

## 4. 推奨構成(1案)

**リスト**
- 日本語: **MosasoM/inappropriate-words-ja(MIT)を主軸**。Offensive系の薄さは、LDNOOBW jaから中立語(エクスタシー・人妻等)を除いた選別サブセットを自前レビューのうえ追加して補う(CC BY 4.0のためREADME等にクレジット表記)。
- 英語: **dsojevic/profanity-list の en.json(MIT)を主軸**とし、severity 2以上をブロック、exceptionsをそのまま許可リストに使う。主軸2本がともにMITで、表記義務なしに揃う。
- 追加語・許可リストは自前のJSON 1ファイルで上書き管理(運用で必ず追加・除外が発生する)。

**マッチング方式(サーバ側、公開前の唯一のゲート)**
1. 文字種ホワイトリスト(ひらがな/カタカナ/漢字/英数/一部記号のみ許可、長さ上限)
2. 正規化: NFKC → 小文字化 → カタカナ→ひらがな → 英字列にleetマップ
3. 正規化済み文字列に対しAho-Corasick等で**部分一致照合**(語数約900なら単純走査でも十分)
4. 高severity語のみ記号除去版でも再照合
5. 許可リスト該当は通過。ブロック時は「この名前は使えません」とだけ返す

クライアントは同じリスト・同じ正規化で送信前チェック(UXのみ)。加えて公開名の通報機能と管理画面での差し替えを用意する。

## 反証・リスク

- リスト単独では過剰検知と検知漏れの両方が不可避(上記Dodge et al.)。ゼロにする手段は見つからなかった。
- 主軸2リストはともに2021年から実質更新停止。新語・ネットスラングは自前追加分で追う運用が必要。
- LDNOOBW jaの品質問題(中立語混在)は実ファイル確認で裏取り済み。無選別の流用は不可。

## わからなかったこと

- 各日本語リストの網羅率の定量比較(共通ベンチマークが存在しない)。差別語・いじめ語彙の商用可の包括リストは探したが見つからなかった。
- LDNOOBWV2 ja(468語)の中身の品質(未レビュー。機械統合のため要目視確認)。
- dsojevic enの検知漏れ率(LDNOOBW enとの差分検証は未実施)。

## 出典一覧(信頼度)

- https://github.com/MosasoM/inappropriate-words-ja — 一次情報(リポジトリ本体・GitHub API)
- https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words — 一次情報(ja/enの実ファイル・API確認済み)
- https://github.com/dsojevic/profanity-list — 一次情報
- https://github.com/censor-text/profanity-list — 一次情報(アーカイブ表示確認)
- https://github.com/LDNOOBWV2/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words_V2 — 一次情報(中身の品質は未検証)
- https://github.com/jo3-l/obscenity — 一次情報(実装参考)
- https://unicode.org/reports/tr15/ , https://unicode.org/reports/tr39/ — 一次情報(Unicode公式仕様)
- https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html — 標準的実務文書(OWASP公式)
- https://en.wikipedia.org/wiki/Scunthorpe_problem — 二次資料(事例集)
- https://www.semanticscholar.org/paper/1adadbfa95e43a70fcd17e6ce947a0652b86bfc3 — 査読論文(Dodge et al. 2021)
