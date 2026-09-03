# サックス用リガチャーカタログ 初版データ (2026-08-29)

サックス練習支援アプリのユーザープロフィール用カタログ。ユーザーは「ブランド → モデル」を部分一致検索でここから選ぶ(自由入力なし)前提。
後で JavaScript のオブジェクト(`{ブランド: [モデル配列]}`)へ転記するため、1行=1モデル名で表にしている。
`2026-08-27-gear-catalog.md`(楽器・マウスピース編)と同じ書き方に揃えた。

## 凡例(確認状況)

| 記号 | 意味 |
|---|---|
| ◎ | メーカー公式サイト等の一次情報で確認(今回Webで実ページを取得) |
| ○ | 販売店・専門店・専門メディアの記載で確認(Web検索で実在確認済み) |
| △ | 定番として広く知られるが今回の検索では一次・二次情報での裏取りができていない(JSON化前に要再確認) |

モデル名は「検索で実在確認したものだけ載せる」方針。確認できなかったブランドは末尾の「今後追加すべきブランド」に名前だけ列挙した。

## サイズ体系についての前提(重要)

リガチャーは楽器本体・マウスピースと違い、**「モデル名」と「サイズ」が別軸**である。多くのブランドで
モデル名は共通で、サイズ記号(または管別型番)だけが soprano / alto / tenor / baritone で変わる。
そのためカタログのデータ構造は次を推奨する。

- `brand` → `models[]`(モデル名のみ。サイズ記号は含めない)
- サイズ(soprano/alto/tenor/baritone)は別フィールドで持つ

表の「対応」列は、そのモデルが**どの管まで用意されているか**の目安であり、モデル名の一部ではない。
ただし Selmer のように「アルト用/テナー用」で製品ページ自体が分かれるブランドは、その旨を備考に書いた。

---

# 1. 主要ブランド

## 1.1 Rovner(米)

出典: [Rovner公式 リガチャー一覧](https://rovnerproducts.com/product-category/ligatures/)(一次情報)、[Rovner公式 Ligature Models Revealed(型番接頭辞の解説)](https://rovnerproducts.com/ligature-models-revealed/)(一次情報)、[Rovner公式 Dark Ligature(サイズ記号一覧)](https://rovnerproducts.com/product/dark-ligature/)(一次情報)

**フリーサイズではない。** モデル名は管共通で、型番が「接頭辞(モデル)+サイズ記号」になる。
接頭辞: Dark=なし / Light=`L-` / MKIII=`C-` / Versa=`V-` / Versa-X=`X-` / Star Series=`SS-` / LGX=`LGX-` / Platinum=`P-` / Platinum Gold=`PG-` / Van Gogh=`VG-`。
サイズ記号(公式Darkページ記載): ソプラノ=`HR1RVS` / `HR1RXS` / `RSM`(メタル)、アルト=`HR1RL` / `RAM`(メタル)、テナー=`2R` / `3RS` / `RTM`(メタル)、バリトン=`3R` / `4R`。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Dark | ソプラノ〜バリトン | 定番。接頭辞なし(唯一) | ◎ |
| Light | ソプラノ〜バリトン | 接頭辞 `L-` | ◎ |
| MKIII | ソプラノ〜バリトン | 接頭辞 `C-`。Dark と Light の中間 | ◎ |
| Star Series | ソプラノ〜バリトン | 接頭辞 `SS-`。廉価ライン | ◎ |
| Versa | ソプラノ〜バリトン | 接頭辞 `V-`。インサート差し替えで6通り | ◎ |
| Versa-X | ソプラノ〜バリトン | 接頭辞 `X-` | ◎ |
| LGX | ソプラノ〜バリトン | 接頭辞 `LGX-` | ◎ |
| Platinum | ソプラノ〜バリトン | 接頭辞 `P-` | ◎ |
| Platinum Gold | ソプラノ〜バリトン | 接頭辞 `PG-`。Platinum の金仕上げ版(別モデル扱い) | ◎ |
| Van Gogh | ソプラノ〜バリトン | 接頭辞 `VG-` | ◎ |
| Legacy | 要確認 | 接頭辞 `LG-`。公式サポートのサイズ検索URLパラメータに存在するが製品ページ未確認 | △ |

## 1.2 Vandoren(仏)

出典: [Vandoren公式 サックス用リガチャー一覧](https://vandoren.fr/en/saxophone-ligatures/)(一次情報)、[Vandoren公式 M|O](https://vandoren.fr/en/vandoren-ligatures/mo-saxophone-ligature/)(一次情報)、[Reverb: LC18M Masters テナー](https://reverb.com/p/vandoren-lc18m-masters-series-tenor-saxophone-ligature-and-cap)(販売店)

型番は `LC` + 数字(例: Optimum テナー = `LC08P`、M|O アルト金メッキ = `LC57DP`)。仕上げ違いも型番が変わる。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Optimum | ソプラノ / アルト / テナー / バリトン・バス | Gold, Pink Gold。圧力プレート3枚差し替え式 | ◎ |
| M\|O | ソプラノ / アルト / テナー / バリトン・バス | Gold, Aged Gold, Gold-plated, Pink Gold。逆締め・2点接触 | ◎ |
| Leather | ソプラノ / アルト / テナー / バリトン・バス | 本革。プレート3枚差し替え式 | ◎ |
| Klassik | **ソプラノ / アルトのみ** | 織物(布)製。公式一覧でソプラノ・アルトに限定 | ◎ |
| Carbon | **アルトのみ**(公式表記) | カーボンファイバー。サムスクリューが Gold / Red | ◎ |
| Masters(旧) | アルト / テナー ほか | 生産終了寄り。M\|O の前身。中古・在庫流通あり | ○ |

## 1.3 Selmer Paris(仏)

出典: [Selmer公式 サックス用リガチャー一覧](https://www.selmer.fr/en-int/collections/ligature-pour-saxophone)(一次情報)、[Weiner Music: M404 メタル用テナー](https://store.weinermusic.com/products/selmer-tenor-sax-silver-plated-ligature-model-m404lig)(販売店)、[Kessler: Tribute(2nd Gen M404)](https://kesslerandsons.com/product/selmer-paris-tribute-tenor-sax-ligature-m404-gen-2/)(専門店)

**モデル名が「素材/対応マウスピース+管別」で立っており、Rovner のような愛称モデル名を持たない。**
公式ではラッカー / 銀メッキの2仕上げ。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| FIBRA Ligature | ソプラノ / アルト / テナー / バリトン | 公式の上位ライン。管ごとに別製品 | ◎ |
| 標準リガチャー(ラバー用) | ソプラニーノ / ソプラノ / アルト / テナー / バリトン・バス | 真鍮製、ラッカーまたは銀メッキ | ◎ |
| メタルマウスピース用リガチャー | アルト / テナー | 真鍮製、銀メッキ | ◎ |
| メタルマウスピース用 ゴールド | テナー | 金仕上げ(公式に別品番で存在) | ◎ |
| M404 | テナー(メタルMP用) | 銀メッキ。順締め(ネジ下)。現在は生産終了扱い | ○ |
| Tribute(2nd Gen M404) | テナー(メタルMP用) | 真鍮・ゴールドラッカー。Tribute MP 用に再設計 | ○ |

## 1.4 BG(BG Franck Bichon、仏)

出典: [BG公式 サックス用リガチャー一覧](https://bgfrance.com/en/4-ligature-saxophone)(一次情報)、[BG公式 Super Revelation](https://bgfrance.com/en/ligature-saxophone/23-ligature-super-revelation.html)、[BG公式 Tradition](https://bgfrance.com/en/ligature-saxophone/35-ligature-tradition.html)、[BG公式 FLEX](https://bgfrance.com/en/ligature-saxophone/1-ligature-flex.html)、[BG公式 DUO](https://bgfrance.com/en/ligature/42-ligature-duo.html)、[BG公式 Revelation Jazz](https://bgfrance.com/en/fabric/65-ligature-revelation-jazz.html)(いずれも一次情報)

型番体系: `L` + 数字。**数字が管を表す**(12=アルト、13=テナー、14=ソプラノ、15=バリトン、16=ソプラニーノ)。
接尾辞 `SR`=Super Revelation、`RS`=Revelation Silver、`J`/`SJ`=Jazz。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Standard(布 + ラバープレート) | ソプラニーノ / ソプラノ(L14) / アルト(L12) / テナー(L13) / バリトン(L15) | 布製。BG の基本形 | ◎ |
| Super Revelation | ソプラノ(L14SR) / アルト(L12SR) / テナー(L13SR) / バリトン(L15SR) | 布 + 24K金メッキ金属プレート | ◎ |
| Revelation Silver | アルト(L12RS) ほか | 銀メッキプレート | ◎ |
| Revelation Jazz | アルト / テナー ほか | 金属リードプレート。ジャズ向き | ○ |
| Standard Jazz | アルト(L21SJ) / テナー(L24SJ) ほか | 布製ジャズ仕様 | ◎ |
| Revelation Silver Jazz | アルト(L12RSJ) ほか | 銀メッキ + ジャズ仕様 | ◎ |
| FLEX | ソプラノ(LFSY) / アルト(LFA, LFA9) / テナー(LFT, LFT9) ほか | 布 + ラバープレート。Jazz 版 LFJ 系あり | ◎ |
| Tradition | ソプラノ / アルト / テナー / バリトン | 金属製。ゴールドラッカー / 24K金メッキ / 銀メッキ / ローズゴールド | ◎ |
| Duo | ソプラノ / アルト / テナー / バリトン | 金属製。複数仕上げ | ◎ |
| Universal Jazz | ソプラノ〜バリトン | 金属製。複数仕上げ | ◎ |

## 1.5 Silverstein Works(米/韓)

出典: [Silverstein公式 CRYO/Gen(製品ページ)](https://www.silversteinworks.com/product/cryo-gen-5/)、[Silverstein公式 ESTRO Gen 6](https://www.silversteinworks.com/product/estro-gen-6/)(いずれも公式URLだが今回のフェッチは403で本文取得できず。以下は販売店で裏取り)、[SAX(saxshop.com) Silverstein 一覧](https://saxshop.com/collections/silverstein-ligatures)(販売店)、[Saxquest Silverstein](https://www.saxquest.com/product/view/silverstein-works-ligature-for-alto-sax-in-original-silver-or-cryo4-gold-P8729)(専門店)、[MRW Artisan: Cryo4 Gen.5](https://www.artisanclarinets.com/products/silverstein-cryo4-saxophone-ligature-gen-5)(販売店)

**サイズが番号(05 / 06 / 07 / 08 / 09 / 10 / 11)で、管ではなくマウスピース外径で選ぶ。**
またフレーム形状の世代名(T-Frame → A-Frame)と世代番号(Gen.4 / Gen.5 / Gen.6)が併記されて流通する。
カタログにはモデル名のみ載せ、世代・サイズは持たないことを推奨(更新負荷が高いため)。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Original | ソプラノ〜バリトン(番号サイズ) | シルバー。基本ライン | ○ |
| CRYO4 | ソプラノ〜バリトン(番号サイズ) | 極低温処理合金。Gold / Silver | ○ |
| QUATTRO | ソプラノ〜バリトン(番号サイズ) | 廉価ライン。コード4ループ + 微調整バー2本。OmniCap 付属 | ○ |
| HEXA | ソプラノ〜バリトン(番号サイズ) | 上位。18Kシャンパンゴールド。コード6ループ + 微調整バー4本 | ○ |
| ESTRO | ソプラノ〜バリトン(番号サイズ) | 上位ライン(Gen.6 が公式にあり) | ○ |

> 注: **`ALTA` は Silverstein の合成リード(ALTA Ambipoly)のブランド名であり、リガチャーではない。**
> 依頼文の例示に含まれていたが、カタログには載せていない([出典: Silverstein公式 ALTA リード](https://www.silversteinworks.com/product/alta-ambipoly-alto-saxophone-jazz-reed/))。

## 1.6 Ishimori / Wood Stone(石森管楽器、日)

出典: [石森管楽器 公式オンライン サックス用リガチャー一覧](https://www.ishimori-online.jp/product-list/116)(一次情報)、[石森管楽器 公式 Wood Stone / CLASSIC](https://www.ishimori-online.jp/product-list/322)(一次情報・URLのみ確認)、[SAXMEN: Wood Stone リガチャー(SS/総銀製)](https://saxmen.jp/i/ws_liga)(専門店)

**「モデル名 × 対応マウスピース × 管 × 素材/仕上げ」の4軸で製品が細分化されている国内屈指の多品種ブランド。**
素材: ブラス / 銅 / 総銀製(SS)。仕上げ: 金メッキ(GP) / 銀メッキ(SP) / ピンクゴールド / ブラッシュゴールド 等。
対応マウスピース別に別製品(例: アルト「Meyer ラバー用」「SELMER ラバー用」「Dave Guardala メタル用」「YANAGISAWA メタル用」など)。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Wood Stone スタンダード(逆締) | ソプラノ / アルト / テナー / バリトン | ブラス / 銅 / 総銀製。対応MP別に細分化 | ◎ |
| Wood Stone AMIME(順締) | アルト(AM-1用 / AM-2用) / テナー(TM-1用) | 網目意匠。Wood Stone 製メタルMP向け | ◎ |
| Wood Stone KODAMA I(逆締) | ソプラノ / アルト / テナー / バリトン | グラナディラ材 + 特殊素材の紐 | ◎ |
| Wood Stone KODAMA II(逆締) | ソプラノ / アルト / テナー / バリトン | 限定色あり | ◎ |
| Wood Stone CLASSIC | ソプラノ / アルト / テナー / バリトン | 受注生産寄り。素材・仕上げを選択 | ○ |

## 1.7 Harrison(英 → 日本製復刻)

出典: [Amazon: Harrison Hearts Alto A3 Gold Plated](https://www.amazon.com/Harrison-Hearts-Saxophone-Ligature-Plated/dp/B01BL91YV2)(販売店)、[SaxAlley: Harrison Vintage Baritone(B.S. サイズ)](https://www.saxalley.com/shop/c/p/Harrison-Vintage-Baritone-Saxophone-Ligatures--Selmer-Size-BS-x85531216.htm)(専門店)、[Sax on the Web: Harrison ligature size(サイズ体系の議論)](https://www.saxontheweb.net/threads/harrison-ligature-size.60354/)(フォーラム=伝聞)

**創業者 Bob Harrison の死去後、オリジナルは製造終了。現在流通しているのは日本製の復刻品が中心。**
公式サイトを探したが見つからなかった。モデル名は事実上「サイズ記号」で呼ばれる。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Harrison(オリジナル・ヴィンテージ) | ソプラノ(S1/S2) / アルト(A1/A2/A3) / テナー(T/TD/TO) / バリトン(B.S.) | 金メッキ / 銀メッキ。中古市場のみ | ○(A2, A3, S2, B.S.)・△(A1, S1, T, TD, TO) |
| Harrison(日本製復刻) | ソプラノ / アルト / テナー / バリトン | ゴールドマット / シルバーマット / シルバー / ゴールド / ブロンズ / ピンクゴールド 等 | ○ |

## 1.8 François Louis(白)

出典: [François Louis公式 Ligatures](https://francois-louis.com/ligatures/ligatures)(一次情報)、[Pro Winds: Pure Brass シリーズ](https://www.prowinds.com/product/ULSSXL01PB/528)(販売店)

**サイズ記号 S / M / L / XL があり、管ではなくマウスピースの太さで選ぶ。**
XL=一般的なラバー(Selmer, Vandoren, Meyer, Otto Link)、L=薄型ラバー(Berg Larsen, Ponzol, Zinner)、M=大型メタルソプラノ、S=メタル(Otto Link, Dukoff 等)。
型番例: `ULTSXL01`(Ultimate テナー XL)、`ULTSXL01PB`(Pure Brass テナー XL)。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Ultimate | ソプラノ / アルト / テナー / バリトン | Brass / Silver / Gold。共鳴パイプ + ステンレスワイヤー | ◎ |
| Pure Brass | ソプラノ / アルト / テナー / バリトン | ワイヤーを真鍮ブレースに置換。ラバー・木製MP向け | ◎ |
| Basic | ソプラノ / アルト / テナー / バリトン | プリフォーム済ブレースの廉価版 | ◎ |

## 1.9 Theo Wanne(米)

出典: [Theo Wanne公式 Enlightened Ligature](https://theowanne.com/products/ligature)(一次情報)、[Theo Wanne公式 GAIA テナーMP(Liberty同梱の記載)](https://theowanne.com/products/gaia-tenor-mouthpiece)(一次情報)

サイズ記号: ソプラノ=`A-TW`、アルト=`A-TW` / `A-XL`、テナー=`T-TW` / `T-XL` / `T-OL`、バリトン=`T-TW` / `T-XL`。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Enlightened Ligature | ソプラノ / アルト / テナー / バリトン | ゴールド。3点接触。プレッシャープレート(Alive Gold / Titanium / Stainless Steel / Vintified / Heavy Copper)は別売 | ◎ |
| Liberty Ligature | アルト / テナー ほか | 24K金メッキ・2点接触。メタルMP(GAIA / DURGA 等)に一体同梱 | ○ |

## 1.10 JodyJazz(米)

出典: [JodyJazz公式 POWER RING Ligature](https://jodyjazz.com/power-ring-ligature/)(一次情報)、[JodyJazz公式 POWER RING フィットチャート(アルト)](https://jodyjazz.com/power-ring-fit-chart/power-ring-ligature-fit-chart-alto/) / [(テナー)](https://jodyjazz.com/power-ring-fit-chart/power-ring-ligature-fit-chart-tenor/)(一次情報)

サイズ記号(現行 HR\*, Custom Dark, Jet, DV HR, Giant 向け): ソプラノ=`HRS1`、アルト HR\*/Jet=`HRA1`、アルト Custom Dark/DV HR=`AS1`、テナー=`HRT1`、バリトン=`HRB1`。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| POWER RING Ligature | ソプラノ / アルト / テナー / バリトン | Gold / Silver / Hand Hammered Gold ほか。リング型・凹面内側 | ◎ |
| Ring Ligature(旧) | ソプラノ / アルト / テナー / バリトン | POWER RING の前身 | ○ |

## 1.11 Marc Jean(加・ケベック)

出典: [Musique de Marc 公式(今回500エラーで本文取得できず)](https://www.musiquedemarc.com/En/Ligature.aspx)、[Morgan Mouthpieces: Marc Jean Gen II(Brass/Silver)](https://www.morganmouthpieces.com/products/partner-product-marc-jean-gen-ii-saxophone-ligature-brass)(専門店)、[NeffMusic: Marc Jean Ligature II Model 700 レビュー](https://www.neffmusic.com/blog/2017/07/marc-jean-saxophone-ligature-ii-model-700-review/)(専門メディア)、[Best. Saxophone. Website. Ever.: Evolution 4 レビュー](https://bestsaxophonewebsiteever.com/reviewing-the-marc-jean-evolution-4-ligature/)(専門メディア)

**「フランス製」ではなくカナダ・モントリオール近郊の工房製**(依頼文の想定と異なる点に注意)。
公式は「4仕上げ × 57モデル」を謳うが、公式ページ本文が取得できなかったため型番の全量は未確認。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Generation II(Model 700 系) | ソプラノ / アルト / テナー / バリトン | 真鍮 + グラナディラ材リードプレート。1本ネジ。Brass / Silver 仕上げ | ○ |
| Evolution 4 | ソプラノ / アルト / テナー / バリトン | リードプレートをドイツ製ハードラバーに変更。225種以上のMPに対応と表記 | ○ |

## 1.12 Bois(米)

出典: [Bill Lewington: Bois Ring Ligature サイズチャート](https://www.bill-lewington.com/bois/bois_chart.htm)(販売店)、[The Mighty Quinn: Bois Classique バリトン用(BLBS)](https://www.brassandwinds.com/products/bois-blbs-classique-ligature-for-baritone-saxophone-mouthpiece)(販売店)

リング型。リードの外縁とマウスピース背面のみに接触する設計。型番例 `BLBS`(バリトン用)。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Classique(リング型) | ソプラノ / アルト / テナー / バリトン(ラバー用・メタル用が別品) | 内側Oリング付き。専用キャップ同梱 | ○ |

## 1.13 Yamaha(日)

出典: [Weiner Music: Yamaha Alto Sax Ligature YAC-1607](https://store.weinermusic.com/products/yamaha-alto-sax-ligature-yac-1607)(販売店)、[West Music: Yamaha Alto Saxophone Ligature](https://www.westmusic.com/yamaha-alto-saxophone-ligature-lacquer-451591)(販売店)、[長江楽器: ヤマハ アルトサックスリガチャー GL(WF930210)](https://www.nagae-g.co.jp/fs/inst/lsa_ym_gl)(販売店)

**ヤマハは「愛称つきモデル名」を持たず、`YAC-####` や `WF######` の部品番号で流通する。**
公式サイトのサックス用アクセサリ一覧にリガチャー単体のページが見当たらず(今回フェッチしたが記載なし)、一次情報での型番網羅ができなかった。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Yamaha 標準リガチャー | ソプラノ / アルト / テナー / バリトン | 真鍮。ゴールドラッカー(GL) / 銀メッキ。アルト用 `YAC-1607` など | ○ |

## 1.14 Ligaphone(仏・パリ)

出典: [Ligaphone-Paris公式 UNIVERSAL Ligature](https://ligaphone-paris.myshopify.com/en/collections/ligature-universelle)(一次情報・検索結果経由)、[Ligaphone-Paris公式 CL.AS Ligature](https://ligaphone-paris.myshopify.com/en/products/ligature-cl-as-finition-vintage-toile-fine-avec-couvre-bec)(一次情報・検索結果経由)、[Musician's Friend: Ligaphone Alto Sax / Clarinet](https://www.musiciansfriend.com/woodwinds/ligaphone-alto-sax--clarinet-ligatures)(販売店)

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| UNIVERSAL | ソプラノ〜バリトン(**メタルソプラノMPを除きフリーサイズ**) | 24K金メッキ / ヴィンテージ仕上げ。布(toile fine)併用 | ○ |
| CL.AS | アルト(+ B♭クラリネット) | ラバーMP専用。ヴィンテージ仕上げ等 | ○ |

## 1.15 Winslow(米)

出典: [DC Sax: Winslow Alto Saxophone Ligature(ラバーMP用)](https://www.dcsax.com/products/winslow-alto-saxophone-ligature-for-hard-rubber-mouthpieces)(販売店)、[Sax Stable: Winslow 16N](https://www.saxstable.com/products/winslow-hard-rubber-tenor-saxophone-ligature-fits-otto-link-meyer-style)(販売店)、[La Musa: WINSLOW 8 Soprano/Alto](https://lamusainstrumentos.es/en/winslow-8-sopranoalto-saxophone-ligature.html)(販売店)

**モデル名は番号(`#8`, `#16N` 等)で、番号が対応MPを表す。公式サイトは探したが見つからなかった(製造終了とされる)。**

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Winslow Ligature(番号サイズ体系: #8, #16N ほか) | ソプラノ / アルト / テナー / バリトン(ラバー用・メタル用が別番号) | ゴムクッション位置で音色可変。現在は中古中心 | ○ |

## 1.16 SAXXAS(Winslow の後継ブランド)

出典: [Meridian Winds: SAXXAS Saxophone Ligatures](https://www.meridianwinds.com/shop/c/p/SAXXAS-Saxophone-Ligatures-x38304684.htm)(販売店)、[Edinburgh Music Centre: SAXXAS (Winslow) Alto](https://edinburghmusiccentre.com/products/saxxas-alto-saxophone-ligature)(販売店)

サイズ記号: `SS HR`(ソプラノ・ラバー) / `AS DU`(アルト・メタル) / `TS HR`(テナー・ラバー) / `TS OL`(テナー・Otto Link メタル) / `BS HRM`, `BS HRXL`(バリトン)。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| SAXXAS Ligature | ソプラノ / アルト / テナー / バリトン | ゴムクッション可動式。Winslow と同設計。キャップ + 予備クッション同梱 | ○ |

## 1.17 Oleg(米)

出典: [Oleg Products公式 Olegature(サックス用リガチャー)](https://olegproducts.com/saxophone-ligatures/oleg-maestro-tenor-saxophone)(一次情報)、[Oleg Products公式トップ](https://olegproducts.com/)(一次情報)

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Olegature | ソプラノ / アルト / テナー / バリトン(+クラリネット) | チェーンメッシュ構造(特許)。仕上げ違いの一次情報は取得できず | ○ |

## 1.18 Brancher(仏)

出典: [Brancher France公式 Ligatures](http://www.brancher-france.com/ligatures.html)(一次情報。ただし詳細が画像内で本文取得は限定的)、[Brancher公式ショップ ligatures](https://www.brancher-shop.com/en/18-ligatures)(一次情報)、[Poppa's Music: Brancher Gold Plated Alto ラバー用(6 AHG)](https://poppasmusic.com/products/brancher-gold-plated-ligature-alto-sax-hard-rubber-mpcs-6-ahg)(販売店)

型番例: `6 AHG`(アルト・ラバー・24K金)、`THG`(テナー・エボナイト・24K金)。

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Brancher セミリジッド(semi-rigid) | ソプラノ / アルト / テナー / バリトン | MP付属の標準品 | ○ |
| Brancher メタル(ワイヤー式) | ソプラノ / アルト / テナー / バリトン | 24K金メッキ / シルバーグレー。スチールワイヤーの点接触 | ○ |

## 1.19 Yanagisawa(Yany Ligature、日)

出典: [ヤナギサワ公式 Yany Ligature 製品情報](https://www.yanagisawasax.co.jp/saxophones/view/661)(一次情報)

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Yany Ligature | ソプラノ / アルト / テナー / バリトン(管別に4製品) | ブラス製・金メッキ仕上。各 ¥12,100(税込) | ◎ |

## 1.20 D'Addario Woodwinds / Rico(米)

出典: [D'Addario公式 Rico Ligature テナー](https://www.daddario.com/products/tenor-saxophone-rico-ligature)(一次情報)、[Ernie Williamson Music: D'Addario H-Ligature テナー(ラバーMP用・ゴールド)](https://erniewilliamson.com/p-64739-daddario-h-ligature-cap-tenor-saxophone-hard-rubber-mouthpieces-gold.aspx)(販売店)

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| H-Ligature | アルト / テナー / バリトン(ラバー用・メタル用が別品) | Harrison 復刻設計。Gold / Silver 仕上げ | ○ |
| Rico Ligature | ソプラノ / アルト / テナー / バリトン | ニッケルメッキ。4点均等・2本ネジ逆締め | ◎ |

## 1.21 JLV Sound(仏)

出典: [JLV公式 サックス用リガチャー](https://www.ligature-jlv.com/en/the-jlv-ligature-for-saxophones-xml-358_421_406_357-819.html)(一次情報)、[NeffMusic: JLV テナー用レビュー](https://www.neffmusic.com/blog/2020/09/jlv-tenor-saxophone-mouthpiece-sound-resurfacing-ligature-review/)(専門メディア)

**製品ラインは事実上1モデル。差分は仕上げのみ。**

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| JLV Ligature | ソプラノ / アルト / テナー / バリトン・バス | Brushed Brass / Silver Plated / Black Edition / 24K Gold Plated / Rose Gold Plated / Platinum Plated。ラバー・メタル両対応 | ◎ |

## 1.22 Bambú(西)

出典: [Saxquest: Bambu Hand Woven Ligature アルト](https://www.saxquest.com/product/view/new-bambu-hand-woven-ligature-for-alto-sax-P9909) / [ソプラノ](https://www.saxquest.com/product/view/new-bambu-hand-woven-ligature-for-soprano-sax-P9910)(専門店)、[Pro Winds: Bambu Ligatures](https://www.prowinds.com/category/754)(販売店)

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Bambú 手織りリガチャー(Hand Woven / Braided) | ソプラノ / アルト / テナー / バリトン | 合成繊維。多色展開 | ○ |
| Bambú NOVA | テナー ほか | 織り紐 + 機械式調整 + プレート | ○ |

## 1.23 Gottsu(ゴッツ、日)

出典: [楽器堂管楽器専門ショップ: Gottsu サックス用リガチャー一覧](https://www.gakkido-kangakki.jp/product-list/536)(専門店)、[Sax Fun: Gottsu Copper Signature Ligature アルト用](https://www.sax-fun.com/product/3561)(専門店)

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| Gottsu Signature | アルト / テナー ほか | ヴィンテージブラス削り出し・アンダースクリュー型 | ○ |
| Gottsu Copper Signature | アルト / テナー ほか | 銅製。2024年9月の工場移転記念モデル | ○ |
| Gottsu SV950 Signature | アルト / テナー ほか | 高純度銀(SV950)。最上位。SV950 スクリュー / プレートは別売もあり | ○ |

## 1.24 AIZEN(アイゼン、日)

出典: [イー楽器ドットコム: AIZEN フリーダムリガチャー](https://www.egakki.com/user_data/aizen-freedom-ligature)(専門店)

| モデル名 | 対応 | 素材・仕上げ / 備考 | 確認 |
|---|---|---|---|
| AIZEN フリーダムリガチャー(Freedom Ligature) | アルト / テナー(+ B♭クラリネット)、ラバーMP用 | ATH 版。真鍮ネジ付属 | ○ |

---

# 2. △印(要再確認)の一覧

JSON化前に、以下は必ず一次情報または販売店で再確認すること。

| ブランド | 項目 | 再確認すべき理由 |
|---|---|---|
| Rovner | `Legacy`(接頭辞 `LG-`) | 公式サポートのサイズ検索URLパラメータには `LEGACY=LG-2M` が存在するが、公式の製品ページを見つけられなかった。廃番の可能性あり |
| Harrison | オリジナルのサイズ記号 `A1` / `S1` / `T` / `TD` / `TO` | 出典が Sax on the Web フォーラム(伝聞)のみ。`A2` `A3` `S2` `B.S.` は販売店で実在確認済み |

△はこの2件のみ。他はすべて ◎ または ○ で裏取りした。

---

# 3. 今後追加すべきブランド(名前のみ・今回は確認できず初版未収録)

いずれも実在の可能性は高いが、今回の調査でサックス用リガチャーとしての一次・二次情報を確認できなかったため未収録。

**未確認**: Bonade(主にクラリネット。サックス用の現行有無を未確認)/ Luyben(樹脂製。サックス用の現行有無を未確認)/ Bari / Ponzol / Ted Klum / Drake / Sugal / Klangbogen / Eastern Music(Winslow 型のコピー品)/ Lomax / Paraschos(木製。サックス用の流通は確認したが公式情報未取得)/ Forestone / Ishimori 以外の国内工房系(Kanee 等)/ Otto Link 純正リガチャー(MP付属品としての型番体系が未確認)/ P. Mauriat 純正 / Cannonball 純正 / Jupiter 純正 / Antigua 純正 / Keilwerth 純正

**方針メモ**: 楽器メーカー純正リガチャー(Cannonball / Jupiter / Antigua / Keilwerth 等)は「楽器付属品」であり、
ユーザーが能動的に選ぶ対象になりにくい。初版では Yamaha / Yanagisawa / Selmer / Brancher のみ収録した。
需要を見て第2版で判断する。

---

# 4. 反証・注意点

結論(=このカタログ)に都合の悪い情報も記録する。

- **Bois は「生産終了」との販売店表記がある。** Bill Lewington のサイズチャートに "Bois Ligatures are no longer available." と明記([出典](https://www.bill-lewington.com/bois/bois_chart.htm))。一方で boisligatures.com のドメインは検索結果に出るが、今回のアクセスは 404 / 500 で本文を取得できなかった。**現行品かどうかは確定できていない。**
- **Winslow も公式サイトを見つけられず、製造停止の書き込みが複数ある**([Sax on the Web](https://www.saxontheweb.net/threads/winslow-ligatures.378462/)=伝聞)。後継とされる SAXXAS は販売店在庫を確認できた。中古市場が主戦場のため、カタログには残す判断とした。
- **Harrison は創業者死去によりオリジナルは製造終了。** 現在流通するのは日本製復刻および D'Addario H-Ligature(復刻設計)。「Harrison」を選んだユーザーがどちらを指すかは区別できない。
- **`Silverstein ALTA` はリガチャーではなくリード(ALTA Ambipoly)。** 依頼文の例示に含まれていたが、公式のリード製品ページで確認したうえで除外した。
- **Marc Jean は「フランスのブランド」ではない。** カナダ・ケベック州の工房製(ネジ類のみフランス調達)。依頼文の想定(仏ブランド群と並記)と異なる。
- **Selmer / Yamaha は「愛称つきモデル名」を持たない。** 部分一致検索のUXでは、他ブランドと同列に「モデル名」を出すと違和感が出る可能性がある。UI側で「標準リガチャー(アルト用)」等の日本語表示を当てる設計を推奨。
- 各ブランドの「フリーサイズか否か」については、**フリーサイズと明記されているのは Ligaphone UNIVERSAL のみ**(メタルソプラノMPを除く)。他はすべて管別またはMP外径別のサイズ選択が必要。「フリーサイズのブランド」を探したが、これ以外は見つからなかった。

---

# 5. わからなかったこと(調べきれなかった範囲)

- **Silverstein 公式サイト(silversteinworks.com)は今回すべて HTTP 403 で本文を取得できなかった。** モデル名・世代は販売店情報で裏取りしたが、現行世代(Gen.5 / Gen.6)がどのモデルまで進んでいるかは一次情報で確認できていない。
- **Marc Jean 公式(musiquedemarc.com)は HTTP 500 で取得できず。** 公式が謳う「57モデル × 4仕上げ」の内訳は未確認。Model 701 / 800 / 850 の存在はレビュー記事の記述にとどまるため本文には載せていない。
- **Oleg の Olegature の仕上げ・素材バリエーション**(真鍮/銀メッキ/金メッキ等)は一次情報で確認できなかった。
- **Yamaha のサックス用リガチャーの公式型番一覧**。公式サックスアクセサリページにリガチャー単体の記載が見当たらず、`YAC-1607` などは販売店情報。`Yamaha Custom` リガチャーの有無も未確認。
- **Brancher の管別・仕上げ別の全型番**。公式ページの情報が画像内にあり、テキストとして取得できなかった。
- **各ブランドの日本国内専売モデル**は未調査(Wood Stone / Gottsu / AIZEN / Yany 以外)。
- **バリトン用の網羅は全ブランドで薄い。** 需要を見て第2版で拡充する。
- 「現行 / 廃番」の区分は 2026-08 時点の Web 情報に基づく。リガチャーは楽器本体よりモデルチェンジが速く、Silverstein のように世代番号が毎年動くブランドもある。
