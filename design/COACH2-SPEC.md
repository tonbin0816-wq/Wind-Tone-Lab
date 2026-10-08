# Ficus はじめの案内(コーチ)の作り直し ── 実装仕様(凍結案)便BW(仮)

作成: 2026-10-06 / 設計役 / 対象ツリー: `.claude/worktrees/view-other-user-data-ebb07d`(ブランチ claude/batch13・**HEAD 79f68e4 = main を基準**。作業ツリーには広告の便 S3 の未コミット差分があり得るので、行番号・綴りは `git show HEAD:path` で読んだもの)

この文書は**実装役(opus)がこれだけ読めば迷わない**ことを目的にしている。値・場所・分岐の根拠は「ファイル:行」で添える(行番号は HEAD のもの。ずれていたら綴りで探す)。書き方の手本は `ipad-spec.md`。

決め方の優先順位: 本人の要望(§0)> 本人のこれまでの決まり(§0.2)> DESIGN-SYSTEM §4.5b と `【本人裁定】`の注記 > この文書の判断。**新しい値(色・寸法・時間)を発明しない。** この便が足す CSS は 0 行(穴の形・カード・暗幕は全部いまの `.coach-*` のまま)。

---

## 0. 本人の要望(2026-10-06 原文)と、この文書の読み方

| # | 原文 | この文書の読み(→ 段の番号は §2) |
|---|---|---|
| 1 | チュートリアルでまず吹いてみようで吹いて変化があるのはチューナー部分なのにそこがグレーアウトされている | 1段目(tuner)の**的なし**(画面いっぱいの暗幕)をやめ、チューナーの帯(環 + 折れ線)を穴で照らす(§4)→ 段① |
| 2 | メトロノームを使ったとき、テンポや表示の変更とタップでスタートという点もチュートリアルに入れる | メトロノームの面の**中**に2段足す: テンポ行(− ♩=n ＋。♩=n を押すと拍子・分割のシート = 「表示の変更」と読む。§14 分かれ道(3))→ 帯のどこでもタップで開始 → 段③④ |
| 3 | タップでスタートが終わったらリードタブに切り替え案内してリード登録のチュートリアルに飛ばして | 下部タブの「リード」を照らして待つ(自動では移さない)→ 段⑤。リードタブに入れば既存のリード1(登録)→ リード2(このリードで計測)→ 段⑥⑦ |
| 4 | そこから計測に繋げる | リード2の的(個体詳細の「計測」)を押すと既存の道で計測タブへ移り、そのリードが選ばれる(App.jsx:12077・12119 `onMeasure`)。新しい配線は要らない |
| 5 | リードタブから計測タブに戻ったときに左上に注目させてリードが紐づいていることも案内 | 上部設定行2行目のリードの枠(点 + メーカー + 厚さ + 開封日 + #n)を照らす → 段⑧ |
| 6 | 計測タブで戻ったらこのリードの演奏データを計測してみようという案内で計測ボタンのタップを誘導 | 既存の計測の段の**文だけ**をリードが選ばれているときに替える → 段⑨ |
| 7 | 計測後は計測タブに誘導してさっきとったデータの見方(カレンダーから個別計測ページへの遷移)を案内 | **データタブへの誘導**と読む(統括の解釈に同意。根拠: カレンダー `PracticeCalendarCard` と計測の詳細 `SessionDetailView` はデータタブ(`AnalysisLabView`)にしか無い。App.jsx:16679 / 17062 / 17620。計測タブに「カレンダー」も「個別計測ページ」も無い)。下部タブの「データ」を照らす → 段⑩。データタブでは カレンダーの印の付いた日 → その日の記録の行 → (詳細が開く)→ 段⑫⑬ |
| 8 | データが溜まると自分の平均値がグラフ化されることも案内 | My Data の「音の傾向」カード(App.jsx:17108)を照らす説明の段 → 段⑭ |
| 9 | みんなのデータを目安に設定したときに下に計測タブで見れますの案内をタップで計測タブの折れ線グラフと目安の箇所に誘導 | 帯(ActionNotice)に「見る」を足し、押したら計測タブへ移してチューナーの帯を照らす → 段⑮(§5)。**ただし計測タブには今、目安を描いている所が無い**(§5.1)。既定は「嘘を言わずに帯を照らす」。目安の破線を折れ線に足すのは §14 分かれ道(1) |

### 0.2 守る決まり(本人のこれまでの裁定。DESIGN-SYSTEM §4.5b・onboarding.jsx 冒頭)

- カードは見える範囲の中央。外(暗幕・カード)を押すとその起動の間は消える(印は立てない)。溶けるのは済んだときの 350ms だけ。穴の縁に枠線は付けない。下手な動きは足さない。
- 文は B 案くらい簡潔に。照らしている所で分かることを「下の〜をタップ」と言い直さない。
- 告知の帯(ActionNotice)が出ている間はすべてのコーチを隠す(App.jsx:5460 `Boolean(notice)`)。**この便でも変えない。**
- メトロノームの面が開いている間は計測の段(録音ボタン)を出さない。この便では面の**中の段**(③④)と、面の外の下部タブを照らす段(⑤)だけを面が開いている間に出す(§6)。
- 計測したことがある人に初めての人向けの案内を出さない(移行で済みにする。§8)。既存の利用者に新しい段がいきなり大量に出ない(§8: 計測が1件でもあれば新しい段は全部済み)。
- 完了の印は kv の `onboardingDone`(バックアップに乗る)。立てるだけで倒さない。
- 見本は `?tutorialpreview=1`(localStorage `ficus.tutorialPreviewDone`)。本物の印は書かない。
- 語彙: 「機材/機種」を使わない。楽器種別は S.Sax 等。
- iPhone 縦が基準。iPad(`useWideLayout`。幅 700 かつ高さ 500 以上)と殻(Capacitor)でも成り立つこと(§9)。

---

## 1. いまの作り(HEAD)の要点 ── 触る前に知っておくこと

| 何 | 場所 | 要点 |
|---|---|---|
| 段の表 | `src/onboarding.jsx:74-127` `COACH_STEPS` | 8段: tuner(**target: null**)/ metronome / measure / reeds / reedsMeasure / data / dataSeen(target: null・anchor・markOnDismiss)/ adoptAverage |
| 印の名前 | `onboarding.jsx:44` `ONBOARDING_FLAGS`(8つ)/ `:47` `MEASURE_STEPS_MIGRATED` / `:49` `MEASURE_TAB_STEPS = ["tuner","metronome","measure"]` | 印は `normalizeOnboardingDone` が true だけを済みと読む |
| どの段を出すか | `onboarding.jsx:202-223` `coachCandidates({ topTab, done, micReady, hasSessions, sessionsKnown, metroPanelOpen, dataSeenDeferred })` | タブごとに**順番どおりの候補の並び**を返し、`OnboardingCoach` が「的が画面にまるごと見えている最初の1つ」を出す(`:405-433`) |
| 移行 | `onboarding.jsx:172-191` `migrateOnboardingDone` | `migrated` と `migratedMeasureSteps` の2つの門。計測が1件でもあれば計測タブの3段を済みにする |
| 保存時の印 | `onboarding.jsx:153-155` `onboardingFlagsForSavedSession(session)` → `["measure"(, "reedsMeasure")]` | 録音の保存(App.jsx:4203)と取り込みの保存(App.jsx:5061)が呼ぶ |
| 的なしの段の描き方 | `onboarding.jsx:411-415`(target null なら anchor だけ見る)/ `:528`(`.coach-dim` を画面いっぱい) | **本人の不満 1 の原因**(§4) |
| 外を押したら消す | `onboarding.jsx:445-457` `dismiss` … `dismissWith` の全部を `dismissedRef` へ・`markOnDismiss` なら `onMark(flag)` | 起動の間だけ(部品が生きている間) |
| App の配線 | `src/App.jsx:3965-4007`(印・見本・移行・`coachReady`)/ `5110-5131`(tuner の useSustained・metronome の口・`metroPanelOpen`・`sawNoSessionsThisLaunch`)/ `5455-5462`(`<OnboardingCoach candidates=… hidden=… onMark=…>`) | `hidden` の式は変えない |
| MeasureView の口 | `App.jsx:8926-8936`(`showMetroPanel` → `onMetroPanelShown` / `onMetroPanelChange`)/ `9141` `startMetronome` / `8923` `metronomeOn` | 面の開閉と鳴っているかは MeasureView の state |
| 的の名乗り | `App.jsx:9528`(メトロノームのボタン `data-coach="metronome"`)/ `9764`(録音ボタン `data-coach="measure"`)/ `5564`(下部タブの計測の絵柄 `nav-measure`)/ `13228`(リード追加の FAB `coach="reeds"`)/ `11787`・`14735`(リード2)/ `17720`(My Data の目印 `data-coach-anchor="mydata"`)/ screens.jsx:1312(平均カード) | 的は各画面が `data-coach` で名乗る。見た目は変えない |
| 帯(ActionNotice) | `App.jsx:3681-3729` `useActionNoticeStore`(`showNotice({ text, actionLabel, onAction, done, undo })`)/ `3739-3790` 描画 / `5415` みんなの平均の取り込み後 `showNotice({ text: ADOPTED_DONE_NOTE, done: true })` | 文は `src/community/idealDoc.js:241` `"目安に設定しました。計測タブで比べられます"` |
| タブの切替 | `App.jsx:3834-3840` `handleNavTap` / `3848` `openSessionFromNotice`(帯の「開く」→ データタブの計測の詳細) | `topTab` は `"measure" | "reeds" | "analysis" | "community"` |
| 計測タブで目安を描いている所 | **無い**(§5.1) | MeasureView は `selectedIdeal` を受け取ってすらいない(App.jsx:5290-5310 の props) |
| 見本 | `src/tutorialPreview.js` / `src/main.jsx:22` / `App.jsx:3972-3986` | 見本の `previewDoneRaw` の初期値は `{ migrated: true, [MEASURE_STEPS_MIGRATED]: true }`(新しい移行の門もここに足す。§8.3) |
| 検査 | `src/onboarding.test.jsx` / `src/onboardingApp.test.jsx` / `src/onboardingAppCommunity.test.jsx` / `src/tutorialPreview.test.js` / pitch-test `6924-6927`・`31790`(`data-coach-anchor` の綴り)・`30185-30187`(リード2の門)・`31122-31124`(平均カード) | §11 |

---

## 2. 一本の流れ ── 段の一覧(これが仕様の中心)

記法: **flag** = kv `onboardingDone` の印の名前。**的** = CSS セレクタ(的の要素が `data-coach` で名乗る)。pad / shape は版4の `.spot` の値の体系(`holeOf`)。**群** = 外を押して消したときに一緒に消す段(`dismissWith`)。「押す=済」= `markOnDismiss: true`(外でもカードでも押したら印を立てる。dataSeen と同じ型)。

### 2.1 計測タブ(topTab = "measure")

| # | id | flag | 出る条件(前の段が済んでいることに加えて) | 的(穴) | 見出し / 1行 | 済む条件 | 外を押したら |
|---|---|---|---|---|---|---|---|
| ① | `tuner` | `tuner`(既存) | マイクが動いている(`micReady`) | `[data-coach="tuner"]` = **チューナーの帯**(App.jsx:9585 の `<div style={{ position: "relative", flexShrink: 0 }}>`。環 + 音量 + 折れ線。面が開いていれば環 + 振り子 + テンポ行)。rect・pad 0 | まずは吹いてみよう / 音程がリアルタイムで表示されます(既存のまま) | 音名が1秒続けて出た(既存 `useSustained`) | 消える(計測タブ群) |
| ② | `metronome` | `metronome`(既存) | ①済 | `[data-coach="metronome"]` 右上のアイコン(既存。circle・pad 0) | メトロノームも使えます / テンポを決めて練習できます(既存のまま) | 面を開いた(既存 `onMetroPanelShown`) | 同上 |
| ③ | `metroTempo` | `metroTempo`(新) | ②済・**面が開いている** | `[data-coach="metroTempo"]` = テンポ行の箱(App.jsx:9683 付近 `<div className="tap-through" style={{ position: "relative", zIndex: 1, display: "flex", … gap: METRO_PM_GAP_CSS }}>`)。pill・pad 6 | テンポを決めよう / ♩=n を押すと拍子も変えられます | − か ＋ を押した / ♩=n(テンポと拍子のシート)を開いた / **鳴らし始めた**(飛ばして始めた人も済み) | 同上 |
| ④ | `metroStart` | `metroStart`(新) | ③済・面が開いている・まだ鳴っていない | `[data-coach="tuner"]`(帯。①と同じ要素。面が開いているので環 + 振り子 + テンポ行が1枚の穴) rect・pad 0 | タップでスタート / もう一度押すと止まります | 鳴り始めた(`metronomeOn` が true。新しい口 `onMetronomeStarted`) | 同上 |
| ⑤ | `goReeds` | `goReeds`(新) | ②済・(面が開いていれば ④済)・リードをまだ登録していない(`!done.reeds`) | `[data-coach="nav-reeds"] svg` 下部タブ「リード」の絵柄(circle・pad 11。データの段と同じ 30 + 11×2 = 52) | 次はリードを登録しよう / (1行なし) | リードタブへ移った(`topTab === "reeds"`) | 同上 |
| ⑧ | `reedLinked` | `reedLinked`(新) | 面が閉じている・⑤を抜けた(`done.goReeds || done.reeds`)・**リードが選ばれている**(`hasSelectedReed`。§7.1) | `[data-coach="reedChip"]` = 2行目のリードの枠の包み(App.jsx:9439 `<div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>`。点 + メーカー + 厚さ + 開封日 + #n)。pill・pad 6 | 選んだリードが紐づいています / 計測の記録にこのリードが残ります | **押す=済**(外でもカードでも)。計測を保存しても済み | 押す=済 |
| ⑨ | `measureReed` / `measure` | `measure`(既存。**同じ印で文が2つ**。data / dataSeen が同じ印を分け合っていたのと同じ型) | 面が閉じている・⑧を抜けた | `[data-coach="measure"]` 録音ボタン(既存。circle・pad 14) | リードあり(`measureReed`): **このリードで計測してみよう** / ボタンタップで計測スタート。リードなし(`measure`): 最初の計測を記録しよう / ボタンタップで計測スタート(既存のまま) | 計測が1件保存された(既存) | 同上 |
| ⑩ | `goData` | `goData`(新) | 面が閉じている・計測がある(`hasSessions`) | `[data-coach="nav-analysis"] svg` 下部タブ「データ」の絵柄(circle・pad 11) | 計測の記録を見てみよう / (1行なし) | データタブへ移った(`topTab === "analysis"` かつ計測がある) | 同上 |
| ⑮ | `idealSeen` | `idealSeen`(新) | 帯の「見る」を押してこのタブへ来た(`coachRequest === "idealSeen"`)。**マイクを待たない**・他のどの段より先 | `[data-coach="tuner"]`(帯)rect・pad 0 | 目安を設定しました / 計測の記録で、目安の破線と比べられます(§5・§14 分かれ道(1)) | **押す=済** | 押す=済 |

- 計測タブ群(`MEASURE_TAB_STEPS`、外を押したら一緒にこの起動の間は出さない)= `["tuner","metronome","metroTempo","metroStart","goReeds","reedLinked","measure","measureReed","goData"]`。⑮ は群に入れない(押すことが一手そのもの)。
- ①〜⑤ は「マイクが動いている」が門(既存どおり。許可されなかった人には出さない)。⑧⑨⑩ も同じ門(計測タブの段の門は1つ)。⑮ だけ門の外(§5.3)。
- 「計測の段(⑨)は面が開いている間は出さない」は維持。面が開いている間に出すのは ③④⑤ だけ。⑩ も面が閉じているときだけ。
- **保存されたら計測タブの章は閉じる**: `onboardingFlagsForSavedSession` が `measure` と一緒に `tuner / metronome / metroTempo / metroStart / goReeds / reedLinked` も返す(リード付きなら `reedsMeasure` も。既存)。「計測したことがある人に初めての人向けの案内を出さない」の実装はこれ1つ(§7.3)。

### 2.2 リードタブ(topTab = "reeds")── 既存のまま(文も的も変えない)

| # | id | flag | 出る条件 | 的 | 見出し / 1行 | 済む条件 |
|---|---|---|---|---|---|---|
| ⑥ | `reeds` | `reeds` | `!done.reeds` | FAB「リードを追加」(App.jsx:13228 `coach="reeds"`) | 使っているリードを登録しよう / 計測に登録したリードを紐づけることができます | リードが1枚登録された(App.jsx:13004) |
| ⑦ | `reedsMeasure` | `reedsMeasure` | ⑥済・`!done.reedsMeasure` | 一覧の先頭のタイル → 個体詳細の「計測」FAB(便BP2。iPad は的1つ。便BU) | このリードで計測してみよう / (なし) | リードを紐づけた計測が保存された |

- ⑦の的(計測 FAB)を押すと既存の `onMeasure` が `setSelectedReedId(id)` → `setSaxType(そのリードの楽器種別)` → `setTopTab("measure")`(App.jsx:12077 / 12119)。これが「そこから計測に繋げる」。配線は足さない。
- リードタブへ**移った**時点で ⑤ `goReeds` が済む(§7.2)。

### 2.3 データタブ(topTab = "analysis")

| # | id | flag | 出る条件 | 的 | 見出し / 1行 | 済む条件 | 外を押したら |
|---|---|---|---|---|---|---|---|
| ⑪ | `data` | `measure`(既存) | 計測が**無い**(`!hasSessions`)・読み込み済み | `[data-coach="nav-measure"] svg`(既存) | 計測を始めると、ここに貯まります / 計測タブから計測してみよう(既存) | 計測が保存された | 消える(単独。既存) |
| ⑫ | `calendarDay` | `calendarDay`(新) | 計測がある・`!done.calendarDay` | `[data-coach="calendarDay"]` = カレンダーの**最新の計測の日のマス**(§7.4。その日の枠が閉じているときだけ名乗る)。circle・pad 0 | 計測した日を押してみよう / (なし) | その日の枠が開いた(`toggleDay` で `next !== null`) | 消える(データタブ群) |
| ⑬ | `daySession` | `daySession`(新) | 計測がある・`!done.daySession` | `[data-coach="daySession"]` = 開いた日の枠の**先頭の記録の行**(`DaySessionRow` の1つ目)。rect・pad 4 | 記録を開いてみよう / (なし) | 計測の詳細が開いた(`AnalysisLabView` の `selectedSession` が非 null。帯の「開く」から入っても済む) | 同上 |
| ⑭ | `trend` | `trend`(新) | ⑬済・`!done.trend` | `[data-coach="trend"]` = 音の傾向カード(App.jsx:17108 `<div className="card" style={{ marginTop: "var(--sp-3)" }}>`)。rect・pad 0。**初回だけ的へスクロール**(§7.5) | データが溜まると、平均がここにグラフで出ます / (なし) | **押す=済** | 押す=済 |

- データタブ群(`DATA_TAB_STEPS`)= `["calendarDay","daySession","trend"]`。
- **`dataSeen` の段は無くす**(「計測したデータがここに貯まります」)。役目は ⑫⑬⑭ が継ぐ。印の名前 `dataSeen` は `ONBOARDING_FLAGS` に**残す**(前の版が保存した値を移行で読むため。§8.1)。`COACH_STEPS.dataSeen`・`anchor`・`dataSeenDeferred`・App.jsx:5126-5131 の `sawNoSessionsThisLaunch` は消す(0件 → 1件の起動で2枚続くのを避ける決まりは、新しい流れでは**続いてほしい**ので要らない。帯が 5 秒出ている間はどのみち隠れる)。
- `data-coach-anchor="mydata"`(App.jsx:17720)は**残す**(pitch-test 6927 / 31790 が綴りを見ている。読み手は無くなるが、消すと検査2本を触ることになる。消すなら §11 の検査も直すこと。既定は残す)。
- 候補の並びは `[calendarDay?, daySession?, trend?]`(済んでいないものだけ。`trend` は `daySession` 済のときだけ)。`OnboardingCoach` は的が見えている最初の1つを出すので、日の枠が閉じていれば ⑫、開いていれば(⑫の的は名乗らないので)⑬ が出る。詳細を開いている間はどの的も無いので何も出ない(詳細の中にカードは置かない。本人「要素は減らす方向」)。

### 2.4 コミュニティタブ ── 既存のまま

| id | flag | 出る条件 | 的 | 見出し / 1行 | 済む条件 |
|---|---|---|---|---|---|
| `adoptAverage` | `adoptAverage` | `done.join && !done.adoptAverage` | 平均カード(screens.jsx:1312) | みんなの平均を目安にしてみよう / 目安に設定すると自分の音と比べられます | みんなの平均を取り込んだ(App.jsx:5418) |

取り込んだ**あと**の導線(帯の「見る」→ ⑮)は §5。

### 2.5 印の一覧(`ONBOARDING_FLAGS`。順番はこのまま。既存8 + 新9 = 17)

`["measure", "reeds", "reedsMeasure", "join", "adoptAverage", "tuner", "metronome", "dataSeen", "metroTempo", "metroStart", "goReeds", "reedLinked", "goData", "calendarDay", "daySession", "trend", "idealSeen"]`

移行の門の印(印の表の外。`normalizeOnboardingDone` が別に読む): 既存 `migrated` / `migratedMeasureSteps` に **`migratedCoach2`** を足す(定数名 `COACH2_MIGRATED`。§8)。

### 2.6 文言の表(一字一句。`onboarding.test.jsx` の「文言」の節がこの表を固定する)

| id | icon | title | line |
|---|---|---|---|
| tuner | tuner | まずは吹いてみよう | 音程がリアルタイムで表示されます |
| metronome | metro | メトロノームも使えます | テンポを決めて練習できます |
| metroTempo | metro | テンポを決めよう | ♩=n を押すと拍子も変えられます |
| metroStart | metro | タップでスタート | もう一度押すと止まります |
| goReeds | reeds | 次はリードを登録しよう | null |
| reeds | reeds | 使っているリードを登録しよう | 計測に登録したリードを紐づけることができます |
| reedsMeasure | measure | このリードで計測してみよう | null |
| reedLinked | reeds | 選んだリードが紐づいています | 計測の記録にこのリードが残ります |
| measureReed | mic | このリードで計測してみよう | ボタンタップで計測スタート |
| measure | mic | 最初の計測を記録しよう | ボタンタップで計測スタート |
| goData | data | 計測の記録を見てみよう | null |
| data | data | 計測を始めると、ここに貯まります | 計測タブから計測してみよう |
| calendarDay | data | 計測した日を押してみよう | null |
| daySession | data | 記録を開いてみよう | null |
| trend | data | データが溜まると、平均がここにグラフで出ます | null |
| idealSeen | target | 目安を設定しました | 計測の記録で、目安の破線と比べられます |
| adoptAverage | target | みんなの平均を目安にしてみよう | 目安に設定すると自分の音と比べられます |

- アイコンは既存の7種(`ICONS`: tuner / metro / mic / reeds / measure / data / community / target)から選ぶ。**新しい絵は足さない。**
- 「♩=n」の綴りはテンポ行のボタンの表示 `♩= {metroTempo}`(App.jsx:9698)に合わせた記号 ♩(U+2669)。

---

## 3. タブの切り替えの持ち主・途中で抜けたとき・順番を外れたとき

### 3.1 誰が切り替えるか

- **案内は自動でタブを移さない。** 移ってほしいときは下部タブの絵柄を照らして待つ(⑤ `goReeds`・⑩ `goData`)。本人がタブを押したら、`topTab` の変化を App の effect が見て印を立てる(§7.2)。
- 例外は1つ: 帯(ActionNotice)の「見る」(§5)。本人がボタンを押した結果として `setTopTab("measure")` する。これは案内ではなく帯の操作(帯の「開く」が計測の詳細へ移るのと同じ型。App.jsx:3848)。
- リード → 計測 の切り替えは、リード2の的(個体詳細の「計測」FAB)を押した結果(既存の `onMeasure`)。案内が移すのではない。

### 3.2 途中で抜けたとき(外を押して消した・別のタブへ行った・アプリを閉じた)

- 外を押して消した: その段の群(`dismissWith`)がこの起動の間は出ない。印は立たない。**次の起動**で、まだ済んでいなければ流れの続き(済んでいない最初の段)から出る。これは既存の決まりそのまま。
- 別のタブへ行った: 候補はタブごとに計算されるので、行った先のタブに出し得る段があればそれが出る(例: ⑤ を見ずにデータタブへ行けば ⑪ か ⑫)。戻れば続き。
- アプリを閉じた: 印は kv に残っているので続きから。鳴っていたメトロノームは止まる(既存)。

### 3.3 順番を外れた操作(段を飛ばした)

段は「印が立っていない最初のもの」を出すだけなので、飛ばした操作は**その操作が立てる印**で吸収する:

| 本人の操作 | 立つ印 | 結果 |
|---|---|---|
| ③ を見ずに帯を押してメトロノームを鳴らした | `metroStart` と **`metroTempo`**(鳴らせたなら知っている) | ⑤ へ進む |
| 面を閉じた(③④ を済ませずに) | 何も立たない | 面が閉じていれば ⑤ へ進む(③④ は面を次に開いたときに出る。保存すれば一緒に済む) |
| ⑤ を見ずに自分でリードタブへ行った | `goReeds` | ⑥ へ |
| リードを登録せずに計測タブへ戻った | 何も立たない | ⑤ がまた出る(リードがまだ無いから)。外を押せばこの起動の間は出ない |
| リード2の的を押さずに自分で計測タブへ戻り、枠でリードを選んだ | 何も立たない | リードが選ばれていれば ⑧ → ⑨。リード2の印 `reedsMeasure` は紐づけた計測の保存で立つ(既存) |
| リードを選ばずに計測した | `measure` ほか計測タブ群 | ⑨ は「最初の計測を記録しよう」の文で出ていた。保存で計測タブの章は閉じる。リードタブへ行けば ⑥ は出る(既存) |
| 帯の「開く」で計測の詳細へ直行した | `goData`(データタブへ移った・計測がある)と **`daySession`**(詳細が開いた) | 戻ると ⑫(カレンダー)が出る → 日を開くと(⑬ は済なので)⑭ |
| データタブで先に ⑭ の所まで送った(⑫⑬ が未) | 何も立たない | ⑭ は `daySession` 済が条件なので出ない。⑫ の的が見える所へ戻れば出る |
| みんなの平均を取り込んだが帯の「見る」を押さなかった | `adoptAverage` だけ | ⑮ は出ない(帯から来たときだけ)。「見る」は帯が消えるまでの 5 秒(`NOTICE_MS`)。押さなかった人には二度と出ない(目安の一覧から選び直す道は既存のまま) |

---

## 4. 最初の段でチューナーが暗幕に隠れている問題 ── 原因と直し方

### 4.1 原因(file:line)

- `src/onboarding.jsx:79` … `tuner: { …, target: null, anchor: null, dismissWith: MEASURE_TAB_STEPS }` ── 便BS で「吹けば済む(押す所が無い)ので的なし」と決めた。
- `src/onboarding.jsx:411-415` … `target === null` の段は穴を作らず `found = { id, r: null, shape: null }`。
- `src/onboarding.jsx:528` … 穴が無い段は `<div className="coach-dim" aria-hidden="true" />`(`src/index.css:871` `.coach-dim { position: fixed; inset: 0; … background: var(--c-coach-dim) }`)を**画面いっぱい**に敷く。環も折れ線も 46% 暗くなる。

「押す所が無い」と「照らす所が無い」を同じにしてしまったのが原因。吹いて変わるのは環(音名・セント・弧)と折れ線で、照らす所はある。

### 4.2 直し方

1. `COACH_STEPS.tuner` を `target: '[data-coach="tuner"]', pad: 0, shape: "rect", dismissWith: MEASURE_TAB_STEPS` にする(`anchor` は消す)。
2. `App.jsx:9585` のチューナーの帯の箱 `<div style={{ position: "relative", flexShrink: 0 }}>` に `data-coach="tuner"` を足す(属性だけ。style は 1 文字も変えない)。この箱は F-74 で作った「上部設定行の直下 〜 テンポ操作行の下端」(App.jsx:9577-9590 の注記)で、面が閉じていれば 環 + 音量(出していれば)+ 折れ線、開いていれば 環 + 振り子 + テンポ行。**背面レイヤ(メトロノームの開始/停止の透明なボタン。App.jsx:9612-9630)もこの箱の中**なので、④ で穴の中を押せば鳴り始める。
3. 穴は rect(角丸 `--r-2`)・pad 0。帯の左右は本文の列(375 では 347 幅)。
4. `OnboardingCoach` の **target: null の道(411-415・528 の `.coach-dim`)は消す**(使う段が無くなる。dataSeen も無くなる。§2.3)。`.coach-dim` の CSS 規則は**残す**(参加の画面 `JoinIntro` が使う。CommunityTab.jsx:822)。`anchor` の読み取りも消す。
5. カードの位置は既存の `placeCoachCard` のまま: 375×812 では帯(上端 ≈ 96・下端 ≈ 520。環 330 + 折れ線 84 + 余白)の**下**(穴の下端 + 22)に置かれ、下部タブの上に収まる。375×667(SE)では下に収まらないので中央(帯に重なる。`overlaps: true`)── 既存の決まり「どちらも収まらなければ中央のまま」。本人の端末は 812 以上なのでそのまま。iPad(環 440)も下に収まる。
6. 何も押させない段なので、穴の中(帯)を押しても何も起きない(環は `pointerEvents: none`。面が閉じていれば背面レイヤは無い)。外を押せば消える(既存)。

---

## 5. 「目安に設定」のあとの導線 ── 帯の「見る」と ⑮

### 5.1 事実: 計測タブに目安を描いている所は無い

- `MeasureView`(App.jsx:8734-10360)の中に `selectedIdeal` / `ideal` の読み手は無い(注記だけ。8763・8786・9863-9866)。props にも無い(App.jsx:5290-5310)。
- 目安の破線を描くのは `NoteAxisLineChart`(App.jsx:14075。`selectedIdeal` と `idealKey` を受けると破線で重ねる)で、呼び手は**計測の詳細**(`SessionDetailView` 18562)と**リードの個体詳細**(14707)。My Data からは外れている(15276「目安の破線と Δ は My Data の全グラフから外れた」)。
- 計測タブで目安が効いているのは**録音の中の音色一致度の計算**(`createFrameAnalyzer` App.jsx:2957 / 4624-4739)だけで、画面には出ない(10530「音色一致度(目安)を外した」)。
- つまり帯の文 `"目安に設定しました。計測タブで比べられます"`(idealDoc.js:241。便BO で本人が見た綴り)は、今の計測タブでは**見て比べる所が無い**。本人の要望 9 の「計測タブの折れ線グラフと目安の箇所」は、本人の頭の中にある絵で、画面にはまだ無い。

### 5.2 既定の作り(嘘を言わず、要望の形は満たす)

1. `App.jsx:5415` の `showNotice({ text: ADOPTED_DONE_NOTE, done: true })` に **`actionLabel: "見る"`** と **`onAction`** を足す。`onAction` = `() => { setTopTab("measure"); setCoachRequest("idealSeen"); }`。帯の見た目は既存の「開く」と同じ(App.jsx:3773-3789。右端の青い太字。地も枠も無い)。
   - 人物のページの「目安に設定」はシートの中の1行(screens.jsx:1803)のままで帯は出さない(便BO)。この便でも触らない(本人の要望は「みんなのデータを目安に設定したとき」)。
2. App に `const [coachRequest, setCoachRequest] = useState(null)`(`"idealSeen" | null`。起動の間だけ・保存しない)。消す条件: `topTab !== "measure"` になった描画(effect)/ `coachDone.idealSeen` が true になった描画。
3. `coachCandidates` に `idealRequested`(boolean)を渡す。計測タブで `idealRequested && !done.idealSeen` なら、**マイクの門より前に** `["idealSeen"]` を返す(§6)。
4. ⑮ の的は帯(`[data-coach="tuner"]`。①と同じ要素)。文は「目安を設定しました / 計測の記録で、目安の破線と比べられます」。押す=済(`markOnDismiss`)。印 `idealSeen` は一度立てば二度と出ない(目安を2回取り込んでも、2回目は「見る」で計測タブへ移るだけ)。
5. 帯の「見る」を押すと `runNoticeAction` が `onAction` → `hideNotice`(App.jsx:3716-3722)。帯が消えるので `hidden` の `Boolean(notice)` が外れ、同じ描画で ⑮ が出る(帯の is-leaving の間は `notice` が非 null なので、消え切ってから。350ms 以内)。
6. `ADOPTED_DONE_NOTE` の綴りは**変えない**(既定。§14 分かれ道(1) で本人が ア を選べば自然に正しくなる。イ' のままなら本人に「計測タブで比べられます」を「見る」で開く先の説明に直すかを聞く)。

### 5.3 ⑮ がマイクを待たない理由

殻(iOS アプリ)では他タブへ移るとマイクを止め、計測タブへ戻ると `startListening` の完全再取得(App.jsx:4883-4893)。許可を拒んでいる人は `micReady` が true にならない。「見る」を押した人には必ず応えたいので、⑮ だけ門の外に置く(他の段は門の中。①が出るのを待つ人は吹く前提なので門の中でよい)。

### 5.4 iPad / 2ペイン

平均カードはコミュニティの「データ」子タブの左ペイン(便BV)。帯は App の根(列 640・下部タブの直上)。「見る」→ 計測タブ(列 640)→ 帯の穴。成り立つ。

---

## 6. 判定の関数 `coachCandidates`(onboarding.jsx:202)── 書き換え後の全文(擬似コードではなく、この形で書く)

```js
export function coachCandidates({
  topTab, done, micReady = false, hasSessions = false, sessionsKnown = true,
  metroPanelOpen = false, hasSelectedReed = false, idealRequested = false,
}) {
  const d = done ?? {};
  switch (topTab) {
    case "measure": {
      // 【便BW】帯の「見る」から来た(⑮)。マイクの門より先・1回だけ
      if (idealRequested && !d.idealSeen) return ["idealSeen"];
      if (!micReady) return [];
      if (!d.tuner) return ["tuner"];
      if (!d.metronome) return ["metronome"];
      // 面の中の段(③④)と、面の外の下部タブ(⑤)。計測の段(⑨)と ⑧⑩ は面が開いている間は出さない(便BS 審査の決まり)
      if (metroPanelOpen) {
        if (!d.metroTempo) return ["metroTempo"];
        if (!d.metroStart) return ["metroStart"];
        if (!d.goReeds && !d.reeds) return ["goReeds"];
        return [];
      }
      if (!d.goReeds && !d.reeds) return ["goReeds"];
      if (hasSelectedReed && !d.reedLinked) return ["reedLinked"];
      if (!d.measure) return [hasSelectedReed ? "measureReed" : "measure"];
      if (hasSessions && !d.goData) return ["goData"];
      return [];
    }
    case "reeds": return !d.reeds ? ["reeds"] : !d.reedsMeasure ? ["reedsMeasure"] : [];
    case "analysis": {
      if (!sessionsKnown) return [];
      if (!hasSessions) return !d.measure ? ["data"] : [];
      const out = [];
      if (!d.calendarDay) out.push("calendarDay");
      if (!d.daySession) out.push("daySession");
      if (d.daySession && !d.trend) out.push("trend");
      return out;
    }
    case "community": return d.join && !d.adoptAverage ? ["adoptAverage"] : [];
    default: return [];
  }
}
```

- 引数から `dataSeenDeferred` を**消す**。足すのは `hasSelectedReed` と `idealRequested`。
- 計測タブは**1つだけ**返す(的が無ければ何も出ない。例: ⑧ はリードの枠が名乗っていなければ出ない → 次の描画で名乗れば出る)。データタブは**並び**で返す(的の在り方で ⑫⑬ のどちらかが決まるため)。
- `COACH_STEPS` の `dismissWith`: 計測タブの9段 → `MEASURE_TAB_STEPS`(§2.1)。データタブの3段 → `DATA_TAB_STEPS`。他は既定(自分だけ)。
- `markOnDismiss: true` は `reedLinked` / `trend` / `idealSeen` の3つ。

---

## 7. 印を立てる口(配線)── どこで何を呼ぶか

### 7.1 App.jsx(根)

| 何 | どこ | 中身 |
|---|---|---|
| `hasSelectedReed` | 5110 付近(tuner の判定の隣) | `const hasSelectedReed = Boolean(selectedReedId) && reeds.some((r) => r.id === selectedReedId && reedSaxTypeOf(r) === saxType);`(`reedSaxTypeOf` は App.jsx:2226。計測タブの枠に出る候補は `reedsOfSax(reeds, saxType)` App.jsx:8855 なので、楽器種別も揃える) |
| `coachRequest` | 同上 | §5.2 の 2。`useEffect(() => { if (topTab !== "measure") setCoachRequest(null); }, [topTab])` と `useEffect(() => { if (coachDone.idealSeen) setCoachRequest(null); }, [coachDone.idealSeen])` |
| タブ移動の印 | 同上 | `useEffect(() => { if (!coachReady) return; if (topTab === "reeds") markOnboarding("goReeds"); if (topTab === "analysis" && sessions.length > 0) markOnboarding("goData"); }, [coachReady, topTab, sessions.length, markOnboarding]);` ── `goData` は**計測があるとき**だけ(計測の前にデータタブを覗いた人には、最初の保存のあとに ⑩ を出したい) |
| メトロノームの口 | 5116-5121 の隣 | `const markMetroTempo = useCallback(() => markOnboarding("metroTempo"), [markOnboarding]);` / `const markMetroStarted = useCallback(() => { markOnboarding("metroStart"); markOnboarding("metroTempo"); }, [markOnboarding]);` MeasureView へ `onMetroTempoTouched={coachReady ? markMetroTempo : undefined}` / `onMetronomeStarted={coachReady ? markMetroStarted : undefined}`(5306 の `onMetroPanelShown` と同じ渡し方。印が読めるまで渡さない) |
| 消す | 5126-5131 | `sawNoSessionsThisLaunch` と effect、`dataSeenDeferred` の受け渡し |
| `<OnboardingCoach>` | 5455-5462 | `coachCandidates({ topTab, done: coachDone, micReady: isListening && !errorMsg, hasSessions: sessions.length > 0, sessionsKnown: sessionsStatus !== "loading", metroPanelOpen, hasSelectedReed, idealRequested: coachRequest === "idealSeen" })`。`hidden` の式は**変えない**。`onMark` も既存 |
| 帯の「見る」 | 5415 | §5.2 の 1 |
| 下部タブの的 | 5564 | `data-coach={t.key === "measure" ? "nav-measure" : undefined}` → `data-coach={\`nav-${t.key}\`}`(4つとも名乗る。見た目は変えない。`nav-community` は読み手なし・害なし) |
| データタブへ渡す口 | 5340-5360(`<AnalysisLabView …>`) | `onOnboarding={markOnboarding}` を足す(既存の `onReedLinked` は残す) |
| 見本の初期値 | 3977 | `{ …readTutorialPreviewDone(), migrated: true, [MEASURE_STEPS_MIGRATED]: true, [COACH2_MIGRATED]: true }`(見本でない側も同じく `[COACH2_MIGRATED]: true` を足す) |
| `onboardingReady` | 3998 | `&& onboardingDone[COACH2_MIGRATED]` を足す |
| 移行の呼び出し | 3994 | 引数は変えない(`migrateOnboardingDone(prev, { sessions, reeds, idealProfiles, isAdopted })`。新しい門の判定は関数の中。§8) |

### 7.2 `MeasureView`(App.jsx:8734)

| 何 | どこ | 中身 |
|---|---|---|
| props | 8755-8757 の隣 | `onMetroTempoTouched`, `onMetronomeStarted` を受ける(既定 undefined) |
| 鳴り始めの知らせ | 8929-8931 の隣 | `useEffect(() => { if (metronomeOn) onMetronomeStarted?.(); }, [metronomeOn, onMetronomeStarted]);`(面を開いた知らせと同じ形。口が後から渡された(印が読めた)ときも、鳴っていればそこで知らせる) |
| テンポに触れた知らせ | − のボタン(9687-9690。`aria-label="テンポを下げる"`)・＋ のボタン(9702-9705。`aria-label="テンポを上げる"`)の `onClick` の先頭と、`openTempoSheet`(8945 `const openTempoSheet = useCallback(() => setTempoSheetOpen(true), [])`。振り子 9662 `onOpenSheet={openTempoSheet}` から開く)の中に `onMetroTempoTouched?.()` を1行足す。♩=n のボタン(9694 `onClick={() => setTempoSheetOpen(true)}`)は `onClick={openTempoSheet}` に揃える(見た目は同じ。知らせる所が1つ減る)。`openTempoSheet` の依存配列に `onMetroTempoTouched` を足す |
| 帯の的 | 9585 | `data-coach="tuner"`(§4.2) |
| テンポ行の的 | 9678 の `<div className="tap-through" style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: METRO_PM_GAP_CSS }}>` | `data-coach="metroTempo"` を足す。穴は pill・pad 6(行は 57.6 高 → 穴 69.6)。`.tap-through` の箱は当たり判定を持たず、中の3つのボタンだけが受ける(既存)。穴の中の隙間を押せば背面レイヤへ落ちて鳴り始める ── A-1 の既存の挙動で、③ で起きれば `metroStart` と `metroTempo` が立つ(飛ばした人の扱い。§3.3) |
| リードの枠の的 | 9439 `<div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>` | `data-coach={selectedReedId && selectedBoxGroup?.members?.some((r) => r.id === selectedReedId) ? "reedChip" : undefined}`(**枠に本当にリードが出ているときだけ**名乗る。「リードを選択」の姿を照らして「紐づいています」と言わない) |

### 7.3 `onboardingFlagsForSavedSession(session)`(onboarding.jsx:153)

```js
export const MEASURE_CHAPTER_FLAGS = Object.freeze(["measure", "tuner", "metronome", "metroTempo", "metroStart", "goReeds", "reedLinked"]);
export function onboardingFlagsForSavedSession(session) {
  return session?.reedId ? [...MEASURE_CHAPTER_FLAGS, "reedsMeasure"] : [...MEASURE_CHAPTER_FLAGS];
}
```
呼び手(App.jsx:4006 `markSessionSaved`)は変えない(返った印を全部立てるだけ)。`markOnboardingDone` は立っている印には触れない(書き込みが増えない)。

### 7.4 データタブ(`AnalysisLabView` 17478 → `MyDataPage` 18389 → `MyDataSection` 16881 → `PracticeCalendarCard` 16679 / `DaySessionRow` 16803)

| 何 | どこ | 中身 |
|---|---|---|
| 受け口 | `AnalysisLabView` の props(17479-17499) | `onOnboarding = null` を足す |
| 詳細が開いた | `AnalysisLabView`(17597 `selectedSession` の隣) | `useEffect(() => { if (selectedSession) onOnboarding?.("daySession"); }, [selectedSession, onOnboarding]);` ── 帯の「開く」(`openSessionRequest` 17561-17564)から開いても立つ |
| 引き回し | 17797 `<MyDataPage …>` → 18412 `<MyDataSection …>` | `onOnboarding` をそのまま渡す |
| 日を開いた | `MyDataSection` の `toggleDay`(16971-16975) | `if (next !== null) { setShownDayKey(next); onOnboarding?.("calendarDay"); }` |
| 最新の日 | `MyDataSection` | `const coachDayKey = useMemo(() => latestLocalDayKey(calendarSessions), [calendarSessions])`。`calendarSessions` = カレンダーに渡している母集団(便AX で「選んでいる楽器関係なく」。17062 の `sessions=` に渡しているものと同じ変数を読む)。`latestLocalDayKey(list)` は `recordedAt` が最大の1件の `localDayKey(new Date(s.recordedAt))`(`localDayKey` は既存。16689 で使っている)。空なら null。**純関数として export**(検査で読む) |
| カレンダーの的 | 16679 `PracticeCalendarCard({ sessions, openDayKey, onToggleDay })` | prop `coachDayKey = null` を足す。押せる日の `<button>`(16772-16790)に `data-coach={c.key === coachDayKey && openDayKey !== c.key ? "calendarDay" : undefined}`(開いている日は名乗らない → ⑬ へ譲る)。表示中の月に無ければ的が無い = 出ない(月を送った人は自分で分かっている) |
| 記録の行の的 | 17084 `daySessions.map((s) => <DaySessionRow …>)` / 16803 | `DaySessionRow` に prop `coach = false` を足し、`<button … data-coach={coach ? "daySession" : undefined}>`。呼び手は `coach={i === 0}`(先頭の1行だけ) |
| 傾向カードの的 | 17108 | `<div className="card" style={{ marginTop: "var(--sp-3)" }} data-coach="trend">`(style は不変。pitch-test 6884 系が My Data の return の綴りを見ている可能性があるので、落ちたら理由を読む。§11) |

### 7.5 ⑭ の「初回だけ的へスクロール」(`OnboardingCoach` の小さな追加)

- 音の傾向カードは My Data の最下段(累計 → カレンダー → すべての計測 → 傾向。16842)。375×812 では初期スクロールで画面の外。`targetVisible` は「まるごと見えている」を求めるので、何もしないと本人が偶然そこまで送るまで出ない。
- 段に `scrollIntoView: true` を持たせ、`measure()` の中で「的の要素は在るが `targetVisible` でない」とき、**その段 id についてこの起動で1回だけ** `el.scrollIntoView({ block: "center", behavior: "auto" })` を呼ぶ(`scrolledRef = new Set()`)。`behavior: "auto"` = 即座(なめらかに流さない。本人「下手なアニメーションはノイズ」)。1回だけなので、本人が送り返しても引き戻さない。
- 対象は ⑭ だけ。他の段は従来どおり待つ(⑫ のマスは初期スクロールで見えている: 累計カード ≈ 110 + カレンダー上部。見えていなければ 250ms ごとに探す既存の動き)。

---

## 8. 移行の規則(`migrateOnboardingDone` onboarding.jsx:172)

### 8.1 新しい門 `migratedCoach2`(`COACH2_MIGRATED`)── 1回だけ

既存の2つの門(`migrated` / `migratedMeasureSteps`)はそのまま残し、3つ目を足す。関数の形:

```js
export function migrateOnboardingDone(prev, { sessions = [], reeds = [], idealProfiles = [], isAdopted = () => false } = {}) {
  const base = isObj(prev) ? prev : {};
  if (base.migrated === true && base[MEASURE_STEPS_MIGRATED] === true && base[COACH2_MIGRATED] === true) return prev;
  const next = { ...base };
  const ss = Array.isArray(sessions) ? sessions : [];
  const rs = Array.isArray(reeds) ? reeds : [];
  const hasCohortIdeal = (Array.isArray(idealProfiles) ? idealProfiles : []).some((p) => isAdopted(p) && isCohortAverageProfile(p));
  if (base.migrated !== true) { /* 既存のまま */ }
  if (ss.length > 0) { for (const f of MEASURE_TAB_STEPS_LEGACY /* tuner, metronome, measure */) next[f] = true; }
  next[MEASURE_STEPS_MIGRATED] = true;
  // 【便BW】
  if (base[COACH2_MIGRATED] !== true) {
    if (ss.length > 0) for (const f of ["metroTempo", "metroStart", "goReeds", "reedLinked", "goData", "calendarDay", "daySession", "trend"]) next[f] = true;
    if (rs.length > 0) next.goReeds = true;
    if (base.dataSeen === true) for (const f of ["calendarDay", "daySession", "trend"]) next[f] = true;
    if (hasCohortIdeal || base.adoptAverage === true) next.idealSeen = true;
    next[COACH2_MIGRATED] = true;
  }
  return next;
}
```

| 誰 | 何が立つ | 結果 |
|---|---|---|
| **計測が1件でもある人**(本人・既存の利用者のほぼ全員) | 計測タブ群の全部(既存の tuner/metronome/measure + 新しい metroTempo/metroStart/goReeds/reedLinked)+ goData + データタブ群の全部 | **新しい段は1つも出ない**(「いきなり大量に出ない」の最も強い形。本人は見本で見る。§13) |
| リードはあるが計測が無い人 | reeds(既存)・goReeds | 計測タブ: ① → ② → ③④ → ⑧(枠にリードが出ていれば)→ ⑨ → …。⑤ は出ない(リードタブを知っている) |
| 何も無い人(入れたて) | 門の印だけ | 流れの全部 |
| 前の版で `dataSeen` を押していた人 | calendarDay/daySession/trend | データタブで何も出ない(計測がある人なので上の行でも立つ。念のため) |
| みんなの平均を取り込んである人 | idealSeen | 帯の「見る」は計測タブへ移るだけ |
| 参加(join) | 既存どおり移行では決めない(コミュニティタブが Firebase に訊いて立てる) | ─ |

- `MEASURE_TAB_STEPS` の名前は §2.1 で9段の群に広げる。既存の移行(便BS)で「計測があれば3段」に使っていた箇所は **`["tuner","metronome","measure"]` の別の定数(`MEASURE_TAB_STEPS_LEGACY`)に差し替える**(移行の結果が変わらないように。新しい6段は新しい門で立てる)。
- `onboardingReady`(App.jsx:3998)に `COACH2_MIGRATED` を足す(§7.1)。移行の前に案内が一瞬出ない。
- `normalizeOnboardingDone`(onboarding.jsx:132)で `out[COACH2_MIGRATED] = src[COACH2_MIGRATED] === true` を足す。

### 8.2 計測済みの人に初めての人向けを出さない

移行(8.1)と保存時の印(§7.3)の2つで保証する。数を数えて決めない(計測を消しても印は戻らない。既存の決まり)。

### 8.3 見本(`?tutorialpreview=1`)

- 見本の初期値に `[COACH2_MIGRATED]: true` を足す(App.jsx:3977。移行はしないので門だけ済みにする。`MEASURE_STEPS_MIGRATED` と同じ扱い)。
- 見本は保存の印を読まないので、本人の端末でも流れの全部が出る。`hasSelectedReed` は本物の state を読むので、本人の端末では枠にリードが出ている → ⑤ のあと(見本では `reeds` も「まだ」なので ⑤ は出る)→ リードタブで ⑥(登録。**本物のリードが1枚増える**。既存の見本の性質。onboardingApp.test 532 の場面)→ ⑦ → 計測タブへ → ⑧ → ⑨「このリードで計測してみよう」→ 保存(**本物の計測が1件増える**。既存の性質)→ 帯 5 秒 → ⑩ → データタブ ⑫(今日のマス)→ ⑬ → 詳細 → 戻る → ⑭。
- 見本の「済んだ」は localStorage の `ficus.tutorialPreviewDone`(既存)。新しい印もそこに乗る(`markOnboardingDone` は印の名前を `ONBOARDING_FLAGS` で確かめるので、表に足せば乗る)。
- 見本で ⑮ を見るには、みんなの平均を取り込む(本物の目安が1つ増える)→ 帯の「見る」。見本では `idealSeen` も「まだ」なので出る。

---

## 9. iPad と殻(Capacitor)

| 場面 | 成り立つか | 根拠 |
|---|---|---|
| ①④⑮ 帯(環 440) | 成り立つ。帯は列 640 の中。カードは帯の下(820×1180 なら 96 + 440 + 84 ≈ 640 の下に 140 のカード → 下部タブ 1134 の上) | 便BT・便BM |
| ③ テンポ行 | 成り立つ(テンポ行は列の中央) | ─ |
| ⑤⑩ 下部タブの絵柄 | 成り立つ(内箱 640・1つ 150。絵柄 30 は中央) | 便BT 「下部タブも 640」 |
| ⑥⑦ リードの2ペイン | 既存のまま(的は1つ。右にリードが出ていればタイルは名乗らない `coachSuppressed`) | 便BU・DESIGN-SYSTEM 1097 |
| ⑧ リードの枠 | 成り立つ(上部設定行は列 640 の左) | ─ |
| ⑫⑬⑭ データタブ | 列 640 だけ(2ペインにしない)。`scrollIntoView` は window のスクロール | ipad-spec §5.2 |
| ⑮ コミュニティ 2ペイン → 帯 → 計測タブ | 成り立つ(§5.4) | ─ |
| 殻: タブを離れるとマイクを止める | 計測タブへ戻ると `startListening` の再取得 → `micReady` が true になってから ①〜⑩ が出る(数百 ms の遅れ。待つのは既存の 250ms の探し直し)。⑮ は待たない(§5.3) | App.jsx:4883-4893 / `shell/policy.js` `micActionOnTabLeave` |
| 殻: メトロノームが鳴ったままタブを移る | 鳴り続ける(`metroActiveRef`)。⑤ の的(下部タブ)は鳴っていても押せる | 便S2 |
| 殻: Ficus Dev で見本に入る | URL の問い合わせを付けられない(server.url は codemagic の `scripts/shell-dev-server-url.mjs` が固定)。見本は **iPhone の Safari** で `https://wind-tone-lab.vercel.app/?tutorialpreview=1` を開いて見る(§13)。殻で見るのは §14 分かれ道(4) | codemagic.yaml:55-91 |

---

## 10. 触るファイル(一覧)

| ファイル | 触る所 |
|---|---|
| `src/onboarding.jsx` | `ONBOARDING_FLAGS`(+9)/ `COACH2_MIGRATED` / `MEASURE_TAB_STEPS`(9段)・`MEASURE_TAB_STEPS_LEGACY`(3段)・`DATA_TAB_STEPS` / `MEASURE_CHAPTER_FLAGS` / `COACH_STEPS`(tuner の的・dataSeen を消す・新 9 段を足す。文は §2.6)/ `normalizeOnboardingDone` / `onboardingFlagsForSavedSession` / `migrateOnboardingDone` / `coachCandidates`(§6 の全文)/ `OnboardingCoach`(target null と anchor の道を消す・`scrollIntoView` の1回)/ 冒頭の注記に【便BW】の段落 |
| `src/App.jsx` | §7.1(根: `hasSelectedReed`・`coachRequest`・タブ移動の印・メトロノームの口・`sawNoSessionsThisLaunch` の削除・`<OnboardingCoach>` の引数・帯の「見る」・下部タブの `data-coach`・`AnalysisLabView` へ `onOnboarding`・見本の初期値・`onboardingReady`)/ §7.2(MeasureView: props 2つ・effect・`onMetroTempoTouched?.()` ×3・`data-coach` ×3)/ §7.4(AnalysisLabView・MyDataPage・MyDataSection・PracticeCalendarCard・DaySessionRow・傾向カード)/ `latestLocalDayKey`(export) |
| `src/community/idealDoc.js` | **触らない**(`ADOPTED_DONE_NOTE` は既定で据え置き。§14(1)) |
| `src/index.css` | **触らない** |
| `design/DESIGN-SYSTEM.md` | §4.5b の表を §2 の表に差し替える(1503-1575)。「一手は8つ」→ 17 の印・15 の段。tuner の的・dataSeen の削除・面の中の段・帯の「見る」・移行の第3の門・`scrollIntoView` の1回・⑮ がマイクを待たない理由。§4.5a の z55 の行の注記は不変 |
| `src/onboarding.test.jsx` | §11.1 |
| `src/onboardingApp.test.jsx` | §11.2 |
| `src/tutorialPreview.test.js` | 変えない(見本の鍵の読み書きは不変)。App 側の初期値の検査は onboardingApp.test |
| `scripts/pitch-test.mjs` | 新節「BW」(§11.3)。既存の節は触らない(落ちたら理由を読む。§11.4) |

---

## 11. 検査

3ゲート: `npm run test` / `node scripts/pitch-test.mjs` / `npm run build`。vitest は総件数を見る(「PASS (0)」は合格ではない。rtk を迂回するなら `rtk proxy npx vitest run`)。pitch-test の PASS 数は下げない・FAIL 0。

### 11.1 `src/onboarding.test.jsx`(純関数と部品)

書き換えるもの(既存の期待が仕様と食い違う所。**理由を注記に書いて直す**):
- 「8つの一手の見出し・1行・アイコンが表のとおり」→ **17 の段**(§2.6 の表を一字一句。dataSeen が**無い**こと)。
- 「的: チューナーとデータ(計測あり)は的なし」→ **tuner の的は `[data-coach="tuner"]`・rect・pad 0**。target null の段が**1つも無い**(`Object.values(COACH_STEPS).every((s) => typeof s.target === "string")`)。
- 「チューナー: 穴を開けず暗幕(.coach-dim)を画面いっぱいに敷く」→ 的 `data-coach="tuner"` を置いて描き、穴が的の矩形(pad 0)・`.coach-dim` が**無い**・受けは4枚。
- 「【便BS】データ・計測がある(dataSeen)」の describe → 消す(段が無い)。
- 「計測タブの3段: 外を押したら3段とも」→ **9段**(`MEASURE_TAB_STEPS` の全部が `dismissedRef` に入る。表に書かれた群と `dismissWith` が一致)。
- `coachCandidates` の節 → §6 の全分岐を1つずつ(下の表)。`dataSeenDeferred` の it は消す。

足すもの(純関数):

| 場面 | 入力 | 期待 |
|---|---|---|
| 計測タブの順 | done が空・micReady | `["tuner"]`。tuner 済 → `["metronome"]`。metronome 済・面閉 → `["goReeds"]`(reeds 未)。reeds 済・面閉・hasSelectedReed → `["reedLinked"]`。reedLinked 済 → `["measureReed"]`。hasSelectedReed=false → `["measure"]`。measure 済・hasSessions → `["goData"]`。goData 済 → `[]` |
| 面が開いている | metronome 済・metroPanelOpen | `["metroTempo"]` → 済で `["metroStart"]` → 済で `["goReeds"]`(reeds 未)→ reeds 済なら `[]`(**measure は返さない**) |
| マイクの門 | micReady=false | `[]`。ただし `idealRequested && !idealSeen` なら `["idealSeen"]`(micReady に関係なく・tuner 未でも先) |
| idealSeen 済 | idealRequested・idealSeen 済 | 門の中の普段の結果 |
| データタブ | hasSessions・done 空 | `["calendarDay","daySession"]`。daySession 済 → `["calendarDay","trend"]`。全部済 → `[]`。hasSessions=false → `["data"]`(measure 未)。sessionsKnown=false → `[]` |
| 保存時の印 | `onboardingFlagsForSavedSession({ reedId: "r1" })` | `MEASURE_CHAPTER_FLAGS` の7つ + `reedsMeasure`。reedId なし → 7つだけ |
| 移行(第3の門) | `{ migrated: true, migratedMeasureSteps: true }` + sessions 1件 | 新 8 印が true・`migratedCoach2` true・`dataSeen` は立てない。sessions 0・reeds 1 → `goReeds` だけ true(reeds は既存の門で true)。`{ …, dataSeen: true }` + sessions 0 → calendarDay/daySession/trend true。`adoptAverage: true` → idealSeen true。3つの門が全部 true なら**同じ物**(`===`)を返す。既存の便BS の移行の結果は**変わらない**(既存の it をそのまま通す) |
| `latestLocalDayKey` | 2件(日付が前後) | 遅いほうの `localDayKey`。空 → null |
| `scrollIntoView` の1回 | 的を画面の外(top 2000)に置き `trend` を候補に | `el.scrollIntoView` が**1回**呼ばれる(jsdom では no-op なので spy)。もう一度 measure が回っても呼ばれない。他の段(calendarDay)は呼ばれない |
| markOnDismiss | reedLinked / trend / idealSeen | 外を押すと `onMark(flag)`。他の新しい段(metroTempo 等)は呼ばれない |

### 11.2 `src/onboardingApp.test.jsx`(App を描く)

書き換えるもの:
- 「【便BS】データタブ・計測がある: 「計測したデータがここに貯まります」」の describe と「不合格1」(dataSeenDeferred)→ 消す。代わりに下の「データタブの3段」。
- 「配線の綴り(App.jsx)」の it で `dataSeenDeferred: sawNoSessionsThisLaunch` を見ている所 → 新しい引数(`hasSelectedReed, idealRequested: coachRequest === "idealSeen"`)の綴りに。
- 「既にある人の移行」の「データは「ここに貯まります」が1回出る」→ **データタブで何も出ない**(計測がある人は全部済み)。
- 「入れたての人」はそのまま通るはず(計測タブはマイクが無いので出ない・データタブで ⑪)。

足すもの(App を描いて操作する。マイクは `isListening` をモックできる既存の手(subTabGap.test / onboardingApp.test の前例)で):

| 場面 | 操作 | 期待 |
|---|---|---|
| ① 帯の穴 | 入れたて・マイクあり | `[data-coach-layer="tuner"]` の `.coach-hole` が `[data-coach="tuner"]` の矩形(pad 0・角丸 `--r-2`)。`.coach-dim` が無い |
| ②→③ | メトロノームのボタンを押す | kv に metronome。面の上で `[data-coach-layer="metroTempo"]`。穴がテンポ行(pill) |
| ③ 済 | − を押す / ♩=n を押す(シートが開く → 隠れる → 閉じる) | kv に metroTempo。次に `metroStart`(穴は帯) |
| ③ を飛ばす | 帯(背面レイヤ)を押して鳴らす | metroStart と metroTempo が同時に立つ。次に `goReeds`(下部タブ「リード」の svg が穴) |
| ⑤ | 下部タブ「リード」を押す | kv に goReeds。リードタブで ⑥(既存) |
| ⑦→⑧→⑨ | リードを登録 → タイル → 詳細の「計測」 | 計測タブへ移り、枠に `data-coach="reedChip"`、`[data-coach-layer="reedLinked"]`。カードを押すと kv に reedLinked、次に `measureReed`(見出し「このリードで計測してみよう」・的は録音ボタン) |
| ⑨ リードなし | リードを選ばない状態 | `measure`(「最初の計測を記録しよう」)。枠は `reedChip` を名乗らない |
| 保存 | 録音 → 保存 | kv に measure/tuner/metronome/metroTempo/metroStart/goReeds/reedLinked(リード付きなら reedsMeasure)。帯「保存しました / 開く」の間は何も出ない。帯が消えると `goData`(下部タブ「データ」の svg) |
| ⑩→⑫ | 「データ」を押す | kv に goData。My Data で `[data-coach-layer="calendarDay"]`(今日のマス `data-coach="calendarDay"`) |
| ⑫→⑬ | マスを押す | kv に calendarDay。マスは名乗らなくなり、先頭の行が `data-coach="daySession"`、`[data-coach-layer="daySession"]` |
| ⑬→(詳細)→⑭ | 行を押す → 詳細 → `< 一覧` | kv に daySession。詳細の間は案内なし。戻ると `[data-coach-layer="trend"]`(的は `data-coach="trend"`)。`scrollIntoView` が1回 |
| ⑭ | カードを押す | kv に trend。もう何も出ない |
| 帯の「開く」から | 保存 → 帯の「開く」 | 詳細が開く → kv に goData・daySession。戻ると calendarDay が出る。日を開くと trend |
| ⑮ | みんなの平均を取り込む(既存の cohortAdopt の手)→ 帯に「見る」→ 押す | 計測タブ・`[data-coach-layer="idealSeen"]`(マイク無しでも出る)。押すと kv に idealSeen。取り込みをもう一度 → 「見る」はタブを移すだけ |
| 「見る」を押さない | 帯を 5 秒待つ | idealSeen は出ない・立たない。別のタブへ行っても出ない |
| 既存の利用者 | 計測1件で起動 | 計測タブ・データタブで**何も出ない**。kv に新 8 印 + migratedCoach2 |
| 見本 | 全部済みの印 + `?tutorialpreview=1` | ① から出る。見本の初期値に migratedCoach2。本物の印は不変 |
| 外を押す(群) | ⑧ で外を押す | この起動では計測タブの9段が出ない。データタブの段は出る。開き直すと ⑧ から |
| 殻 | `isNativeShell` を true にモックしてタブを往復 | 戻った直後は `micReady` false で何も出ず、`isListening` が立てば出る。⑮ は `isListening` false でも出る |

### 11.3 pitch-test(新節「BW」。他の節は触らない)

綴りの検査(実際に描くのは vitest):
- `onboarding.jsx`: `ONBOARDING_FLAGS` が §2.5 の17個をこの順で持つ / `COACH_STEPS` に `target: null` が **0 件** / `tuner` の的が `'[data-coach="tuner"]'`・`shape: "rect"`・`pad: 0` / `dataSeen:` の段が無い / `MEASURE_TAB_STEPS` が9個・`DATA_TAB_STEPS` が3個・`MEASURE_TAB_STEPS_LEGACY` が `["tuner", "metronome", "measure"]` / `coachCandidates` の署名に `hasSelectedReed = false, idealRequested = false` があり `dataSeenDeferred` が無い / `scrollIntoView({ block: "center", behavior: "auto" })` が **1 回**だけ書かれている / `.coach-dim` の綴りが onboarding.jsx に**無い**(JoinIntro 側 CommunityTab.jsx には在る)。
- `App.jsx`: `data-coach="tuner"` が MeasureView の中に1回 / `data-coach="metroTempo"` 1回 / `"reedChip"` 1回 / `data-coach={\`nav-${t.key}\`}` が BottomNav に1回(`nav-measure` の直書きが無い)/ `onMetronomeStarted?.()` が `metronomeOn` の effect の中 / `onMetroTempoTouched?.()` が3回 / `sawNoSessionsThisLaunch` が **0 件** / `<OnboardingCoach` の `candidates` に `hasSelectedReed` と `idealRequested: coachRequest === "idealSeen"` / `hidden=` の式が**変更前と同一**(`!coachReady || isRecording || anySheetOpen || errorScrimShown || saveConfirmShown || isAnalyzingUpload || Boolean(notice)`)/ `actionLabel: "見る"` が `ADOPTED_DONE_NOTE` の `showNotice` の中 / `onOnboarding?.("daySession")`・`onOnboarding?.("calendarDay")` が各1回 / `data-coach="trend"` 1回 / `[COACH2_MIGRATED]: true` が見本の初期値の両方に。
- `index.css`: `.coach-*` の規則が**変更前と同一**(この便は CSS を触らない)。
- `idealDoc.js`: `ADOPTED_DONE_NOTE` が既定なら変更前と同一(分かれ道(1) で変えたら期待値も変える)。
- `DESIGN-SYSTEM.md` §4.5b に §2.6 の17の見出しが全部ある。

### 11.4 既存の検査で落ちそうな所(落ちたら期待値を今の綴りに合わせるのではなく、理由を読む)

- pitch-test 6884 系(My Data の return の綴り)。17108 の傾向カードに属性を足して落ちるなら、**属性は `className` の後ろ・`style` の前**に置き、正規表現が何を見ているかを読んでから直す。
- pitch-test 6927 / 31790(`data-coach-anchor`)── 残すので落ちない。
- pitch-test 30185-30187(リード2の門)── 触らない。
- `onboardingAppCommunity.test.jsx` ── 触らない(join の印は不変)。
- `src/community/cohortAdopt.test.jsx:376`(`arg.announce` が true)── `onAdopt` の引数を見ているだけなので落ちない。
- **pitch-test 31655(BO.1「帯の知らせは announce のときだけ…」)** ── `adoptBO.indexOf("if (announce) showNotice({ text: ADOPTED_DONE_NOTE, done: true });")` と**1行の綴り**で探している。帯に `actionLabel: "見る"` と `onAction` を足すと見つからず **落ちる(意図した変更)**。直し方: 探す綴りを新しい形(例: `if (announce) showNotice({ text: ADOPTED_DONE_NOTE, done: true, actionLabel: "見る", onAction: …`)の**先頭部分** `if (announce) showNotice({ text: ADOPTED_DONE_NOTE, done: true,` に替え、注記に【便BW】を書く。順序の条件(選ぶ → 帯 → 返す・`showNotice(` が1回)は**そのまま通す**こと。`onAction` の中で `setTopTab("measure"); setCoachRequest("idealSeen");` と書く(`showNotice(` の文字列を増やさない)。
- `src/onboardingApp.test.jsx:411`(`setSelectedIdealId(r.profile.id);[\s\S]{0,600}?if (announce) markOnboarding("adoptAverage");`)── 帯の行が長くなると 600 字の窓を越えうる。越えて落ちたら、`onAction` を1行(`onAction: () => { setTopTab("measure"); setCoachRequest("idealSeen"); },`)に収め、それでも越えるなら窓を 800 に広げる(注記に理由)。

---

## 12. 合格ライン

1. 3ゲート全部通る。vitest の総件数は**増える**(減ったら収集失敗)。pitch-test の PASS は下げない・FAIL 0。
2. §11.1・§11.2 の表の場面が**全部**検査にあり、通る。
3. ①の暗幕: dev サーバ(`ficus-dev`、375×812)で計測タブを開き、マイクを許可(Browser ペインのマイクは出ない → `isListening` をモックした vitest の描画と、`?tutorialpreview=1` の実機で確かめる)したとき、環と折れ線が**暗くない**(穴の矩形 = 帯の矩形。`getBoundingClientRect` の実測を報告に書く)。
4. 既存の利用者(計測あり)の起動で、新しい段が **0 枚**(`migrateOnboardingDone` の結果を kv で確認)。
5. 見本で、§8.3 の順に 15 枚(①②③④⑤⑥⑦⑧⑨⑩⑫⑬⑭ + ⑮ + コミュニティの adoptAverage)が**この順で1枚ずつ**出る。同時に2枚出る瞬間が無い。
6. 帯(ActionNotice)が出ている間はどの段も出ない(既存。保存の帯・取り込みの帯・目安の帯の3つで確認)。
7. 面が開いている間に録音ボタンの段が出ない(既存の決まり。③④⑤ だけ)。
8. `index.css` の差分 0 行。`App.jsx` の差分は属性・props・effect・1行の呼び出しだけで、見た目の値(style)に差分が無い(diff を報告に添える)。
9. DESIGN-SYSTEM §4.5b が §2 の表と一致。
10. 殻の判定(`isNativeShell`)に新しい分岐を足していない(殻の違いは `micReady` の遅れだけで、既存の門が吸収する)。

---

## 13. 本人に見せる方法

- **本番の反映**: 検収が通ったら統括が `git push origin HEAD:main`(Vercel が配信。待たない)。開発版のアプリ **Ficus Dev**(TestFlight の ios-dev)は本番の Web(`https://wind-tone-lab.vercel.app`)を読むので、**アプリを開き直すだけで反映**される(codemagic.yaml:91)。本人の端末の本物の印は「計測あり」なので、普段の起動では新しい段は出ない(§8)。
- **見本の入り方**(本人の端末。全部「まだ」として出す):
  1. iPhone の **Safari** で `https://wind-tone-lab.vercel.app/?tutorialpreview=1` を開く(URL の問い合わせは読んだあと消える。端末に覚えるので、以後は Safari でこの URL を開くたび見本)。
  2. 計測タブ: マイクを許可 → ① 吹く → ② メトロノームのアイコン → ③ − / ＋ か ♩=n → ④ 帯を押す → ⑤ 下部タブ「リード」。
  3. リードタブ: ⑥ ＋ で1枚登録(本物のリードが1枚増える。あとで消してよい。消しても印は戻らない)→ ⑦ タイル → 詳細の「計測」。
  4. 計測タブ: ⑧ 左上の枠(押せば消える)→ ⑨ 録音 → 保存(本物の計測が1件増える)→ 帯 5 秒 → ⑩ 下部タブ「データ」。
  5. データタブ: ⑫ 今日のマス → ⑬ 先頭の行 → 詳細 → `< 一覧` → ⑭ 傾向カード(自動で見える所まで送られる)。
  6. コミュニティ: 平均カード(adoptAverage)→ 目安に設定 → 帯「目安に設定しました。計測タブで比べられます **見る**」→ 押す → 計測タブで ⑮。
  7. 見本をやめる: `…/?tutorialpreview=0`。
  - 見本の「済んだ」は Safari の localStorage に残るので、途中でやめても開き直せば続きから。最初からやり直すときはもう一度 `=1`。
- **殻(Ficus Dev)で見本を見るには** server.url に問い合わせを足す必要がある(§14 分かれ道(4)。既定はやらない)。
- 実装役の確認は dev サーバ(`.claude/launch.json` の `ficus-dev`)+ Browser の 375×812。マイクの暗幕は JS クリックで回避(メモリ「dev サーバ実測の罠」)。コミュニティは dev では描かれない(⑮ は vitest と実機で)。

---

## 14. 本人に聞く分かれ道(既定を書いてあるので、返事が無ければ既定で進める)

**(1) 「計測タブの折れ線グラフと目安の箇所」── 計測タブには目安を描いている所が無い(§5.1)**
- 既定 **イ'**: 計測タブの絵は変えない。帯の「見る」→ 計測タブ → チューナーの帯を照らして「目安を設定しました / 計測の記録で、目安の破線と比べられます」(§5.2)。`ADOPTED_DONE_NOTE` の綴りは据え置き。
- **ア**: 折れ線(`PitchDeviationLine` App.jsx:5985。右端 = 今・中央 0¢・±50¢)に**目安の破線**を1本足す。`MeasureView` に `selectedIdeal` を渡し、いま環に出ている音(`matchedFingering.semitoneIndex`。App.jsx:8786)の目安 `getNoteIdeal(selectedIdeal, idx)?.pitchHz` を `1200 * log2(idealHz / matchedFingering.soundingFreqHz)` でセントにして、`PitchDeviationLine` に `idealCents`(number | null)で渡す。線は `IDEAL_LINE_STYLE`(App.jsx:13646。`--c-ink-3`・破線 "4 3"。§1.7 で目安に予約された色)の横線を y(idealCents) に。音が無いとき・目安に無い音のときは描かない。⑮ の文は「目安の破線と比べながら吹いてみよう / (なし)」に替え、`ADOPTED_DONE_NOTE` は正しい文になる。検査: 純関数 `idealCentsFor(selectedIdeal, matchedFingering)` と、`PitchDeviationLine` が `idealCents` で破線を1本描く/描かない。
- 聞く理由: 本人が見ている絵は ア で、ア は計測タブ(本人がいちばん見ている画面)の見た目を変える。黙って足せない。

**(2) 既存の利用者(計測あり)に新しい段を 0 枚にする(§8.1)**
- 既定 **ア**: 0 枚。本人は見本で見る。
- イ: データタブの ⑭(「データが溜まると、平均がここにグラフで出ます」)だけは既存の人にも1回出す(便BS で dataSeen を1回出したのと同じ扱い)。移行で `trend` を立てない。
- 聞く理由: 便BS のときは「既存の人にも1回」を選んでいた。

**(3) 「表示の変更」の読み(§0 の 2・段③)**
- 既定 **ア**: ♩=n を押して開く「テンポと拍子」のシート(拍子・1拍の分割・拍グループ・小節アクセント)のこと。③の1行は「♩=n を押すと拍子も変えられます」。
- イ: 振り子(拍の●・拍子表示)のこと。③の的を振り子まで広げる(帯ごと照らす = ④と同じ穴になる)。1行は「− ＋ でテンポ、♩=n で拍子」。
- 聞く理由: 原文の「表示」が何を指すか読めない。

**(4) 殻(Ficus Dev)で見本を見る**
- 既定 **ア**: やらない。見本は iPhone の Safari で(§13)。
- イ: `scripts/shell-dev-server-url.mjs` の server.url に `?tutorialpreview=1` を足した**別の workflow**(ios-dev-tutorial)を Codemagic に足す。`=1` は開くたびに見本の「済んだ」を空にするので、**毎回最初から**になる(続きから見られない)。
- 聞く理由: 殻の挙動(マイクの止め方・音の出口)で見たいなら イ しか無い。

**(5) ⑧「選んだリードが紐づいています」を出す条件**
- 既定 **ア**: 枠にリードが出ていれば、どこから来ても(リードタブから戻った・枠で自分で選んだ・前の起動から選ばれていた)1回出す。
- イ: リードタブの「計測」FAB から戻ったときだけ(App に「リードタブから来た」の起動内の印を足す)。
- 聞く理由: ア は「リードが選ばれているだけで出る」ので、前の起動からリードが選ばれている人(計測は無い)にも ① → ② のあとに出る。それで自然だと判断して既定にした。

決めてよいとしてこの文書が決めたもの(本人の目に触れるが小さい): 文言(§2.6。B 案の長さ)/ ⑧⑭⑮ を「押す=済」に / 詳細の中にカードを置かない / ⑭ だけ的へ1回スクロール / 外を押したときの群(計測タブ9段・データタブ3段)/ `goData` は計測があるときだけタブ移動で立つ / `data-coach-anchor="mydata"` を残す / 帯の「見る」の綴り(「開く」「元に戻す」と同じ2文字の動詞)。

---

## 付録A. 根拠の位置(この文書が読んだ所。HEAD 79f68e4)

- `src/onboarding.jsx`: 1-38 冒頭の決まり / 44 `ONBOARDING_FLAGS` / 47 `MEASURE_STEPS_MIGRATED` / 49 `MEASURE_TAB_STEPS` / 52 `TUNER_SUSTAIN_MS` / 74-127 `COACH_STEPS`(76 tuner・82 metronome・87 measure・94 reeds・102 reedsMeasure・108 data・115 dataSeen・121 adoptAverage)/ 132 `normalizeOnboardingDone` / 143 `markOnboardingDone` / 153 `onboardingFlagsForSavedSession` / 158-162 `isCohortAverageProfile` / 172-191 `migrateOnboardingDone` / 202-223 `coachCandidates` / 225 `useSustained` / 236 `targetVisible` / 242 `holeOf` / 259 `placeCoachCard` / 366 `OnboardingCoach`(405-433 的の探し方・411-415 target null・445-457 dismiss・528 `.coach-dim`)
- `src/App.jsx`: 51 `micActionOnTabLeave` / 2226 `reedSaxTypeOf` / 2957 `createFrameAnalyzer` / 3635-3790 ActionNotice(3646 `NOTICE_MS`・3700-3713 `showNotice` の形・3716-3722 `runNoticeAction`・3773-3789 操作のボタン)/ 3834-3840 `handleNavTap` / 3848 `openSessionFromNotice` / 3935 `selectedReedId` / 3965-4007 印・見本・移行・`coachReady`・`markSessionSaved` / 4119 `selectedIdeal` / 4203-4215 録音の保存と帯 / 4883-4893 タブを離れたときのマイク / 5061-5070 取り込みの保存と帯 / 5110-5131 tuner・metronome・`metroPanelOpen`・`sawNoSessionsThisLaunch` / 5140-5143 z60 の式 / 5203-5207 ReedsTab の props / 5290-5310 MeasureView の props / 5340-5360 AnalysisLabView の props / 5395-5422 コミュニティの `onAdoptIdeal`(5415 帯・5418 印)/ 5437 ActionNotice / 5455-5462 OnboardingCoach / 5486-5580 BottomNav(5564 `data-coach`)/ 5985 `PitchDeviationLine` / 7388 `PitchRing`(7668-7690 外枠)/ 8734 `MeasureView`(8755-8757 口・8850-8884 リードの候補・8885 `detailOpen`・8923 `metronomeOn`・8926-8936 面の知らせ・9141 `startMetronome`・9192 `stopMetronome`・9300-9380 上部設定行の始まり・9439 リードの枠の包み・9518-9545 メトロノームのボタン・9577-9590 チューナーの帯の注記・9585 帯の箱・9612-9630 背面レイヤ・9639 PitchRing・8945 `openTempoSheet`・9658-9710 振り子とテンポ行(9662 `onOpenSheet`・9678 行の箱・9687-9690 −・9694 ♩=n・9702-9705 ＋)・9727-9731 折れ線・9734 帯の閉じ・9764 録音ボタン・9830-9845 隠した測り用の写し・10022 テンポシート)/ 11078 `SetAsIdealButton` / 12059・12181 `onReedsRegistered` / 12077・12119 `onMeasure` / 13004 リード登録の印 / 13228 リード追加の FAB / 13646 `IDEAL_LINE_STYLE` / 14075 `NoteAxisLineChart` / 14735 詳細の「計測」/ 15879 `CALENDAR_DAY_ATTR` / 16543 `DetailHeader` / 16679-16800 `PracticeCalendarCard`(16772-16790 押せる日)/ 16803 `DaySessionRow` / 16840-16845 My Data の並び / 16881 `MyDataSection`(16948 `openDayKey`・16971-16975 `toggleDay`・17062 カレンダー・17078-17084 日の枠と行・17094 すべての計測・17108 傾向カード・17184 0件の文言)/ 17478 `AnalysisLabView`(17502 子タブ・17519 `selectedSessionId`・17561-17564 帯の「開く」・17597-17602 `selectedSession`・`atMyDataTop`・17620 SessionDetailView・17720 `data-coach-anchor`・17797 MyDataPage)/ 18389 `MyDataPage` / 18412 MyDataSection の呼び出し / 18471 `SessionDetailView`(18530 DetailHeader・18562 selectedIdeal)
- `src/index.css`: 250 `--c-coach-dim` / 866-915 `.coach-*`(871 `.coach-dim`)/ 937-945 `.action-notice`
- `src/community/idealDoc.js`: 239-241 `ADOPTED_DONE_NOTE`
- `src/community/screens.jsx`: 1284-1296 `adoptNow`(`announce: true`)/ 1309-1312 平均カードの `data-coach` / 1366 `CohortAdoptSheet` の呼び出し / 1801-1805 人物のページの1行 / 2035 `CohortAdoptSheet`
- `src/community/CommunityTab.jsx`: 28 import(`CoachIcon, COACH_Z, readBottomLimit`)/ 533 `onOnboarding?.("join")` / 822-846 JoinIntro の暗幕(`.coach-dim`)
- `src/tutorialPreview.js` 全文 / `src/main.jsx:22`
- `design/DESIGN-SYSTEM.md`: 221 `--c-coach-dim` / 535 溶ける 350ms / 1490 z55 / 1503-1575 §4.5b
- `scripts/pitch-test.mjs`: 6924-6927・31790(`data-coach-anchor`)/ 30183-30187(リード2の門)/ 31122-31124(平均カード)/ 32023(onboarding.jsx を読む節 BV)
- 検査: `src/onboarding.test.jsx`(describe の一覧 26-724)/ `src/onboardingApp.test.jsx`(155-863)/ `src/onboardingAppCommunity.test.jsx:70-72` / `src/tutorialPreview.test.js`
- 殻: `codemagic.yaml:55-91`(ios-dev の server.url)/ `capacitor.config.json`
- メモリ: 工程(統括が凍結 → jisso → shinsa → 統括が push)/ 配信は待たない / vitest の PASS (0) / dev サーバの罠 / 本人の端末は PowerShell 5.1(`&&` 不可)
