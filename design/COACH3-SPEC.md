# Ficus はじめの案内(コーチ)の見直し ── 実装仕様(凍結案)便BX

作成: 2026-10-06 / 設計役 / 対象ツリー: `.claude/worktrees/view-other-user-data-ebb07d`(ブランチ claude/batch13・**HEAD c702ea0 = main(便BW)**を基準)。
作業ツリーには別の担当の**未コミットの直し3点**(⑥ の見出し「楽器を選択してリードを登録しよう」+ 楽器種別の行の2つ目の穴 `also` / ⑧ の1行「計測データに選択したリードが紐づきます」/ プロフィール作成のあと文書を先頭へ戻す)が入っている。**この文書はその3点が入った姿を前提に書く**(行番号は作業ツリーのもの。ずれていたら綴りで探す)。

この文書は**実装役(opus)がこれだけ読めば迷わない**ことを目的にしている。値・場所・分岐の根拠は「ファイル:行」で添える。書き方の手本は `coach2-spec.md`(前の便の仕様。同じ scratchpad にある。この文書は差分ではなく**今の姿の全部**を書くので、前の仕様を読み直さなくてよい)。

決め方の優先順位: 本人の決定(§0)> 本人のこれまでの決まり(§0.2)> DESIGN-SYSTEM §4.5b と `【本人裁定】`の注記 > この文書の判断。**新しい値(色・寸法・時間)を発明しない。** この便が足す CSS は §6・§7 に書いた規則だけ(全部トークン)。

---

## 0. 本人の決定(2026-10-06。モック `coach3-mock.html` を見て選んだもの)と、この文書の読み方

| 決定 | 中身 | この文書 |
|---|---|---|
| **A: A1-e「ごく薄い紺の地」** | 案内のカードの地を `--c-accent-tint`(#EAEFF5)に。字は今の濃い色のまま。アイコンの丸は白(`--c-surface`)。B2 と組み合わさったときの見分けは実装後のスクショで本人が判断。見分けを補う手を**1つだけ**用意しておく(既存のトークンだけ) | §6 |
| **B: B1 到着のカード + B2 章の目印** | B1: 章が変わってタブに着いた直後、穴なしの暗幕で「ここは○○タブ / 一言」を1枚。どこを押しても次へ。リード・データ・コミュニティ・最後の計測の4か所。B2: カードの上部に4章(計測・リード・データ・コミュニティ)の細い目印を常設。今の章が紺、済んだ章は薄い紺 | §4・§5 |
| **C: 新しい流れはモックの C のとおり** | 計測(①〜⑤)→ リード → 計測(⑧⑨・保存・⑩)→ データ(⑫⑬⑭ + 新「みんなのデータも見てみよう」)→ コミュニティ(参加の画面 → 到着 → 目安に → 見る)→ データ(⑮ → 新「計測タブに戻ろう」)→ 計測(終わりの段。穴なし)。保存したあとは「保存しました」の帯と**同時に** ⑩ を出す(帯の間は段を出さない裁定の**唯一の例外**。カードは帯より上・帯の「開く」は押せる)。⑤ の文は到着カードと重複しないよう整理してよい | §2・§3・§7 |
| **D: D1「端末を替えるとき」** | 参加のカードの導線から開くシートを、汎用の「記録の保存」ではなく参加の場面用の中身に。導線の名前「アカウント引継」→「端末を替えるとき」。参加のカードの文「機種変更やアプリの削除で」→「端末を替えたりアプリを削除したりすると」。マイページ側の汎用「記録の保存」は変えない。読み戻し・書き出しの処理は BackupPanel の関数を使い回す(写しを作らない)。殻では書き出しは共有シート | §8 |
| 既存の利用者(計測が1件でもある人)には新しい段を出さない | 新しい印の移行も同じ考え方 | §10 |

### 0.2 守る決まり(本人のこれまでの裁定。DESIGN-SYSTEM §4.5b・onboarding.jsx 冒頭)

- カードは見える範囲(下部タブ・広告の帯を除く)の中央。外(暗幕・カード)を押すとその起動の間は消える(印は立てない)。**到着カードは例外**(穴なし・どこを押しても「次へ進む」= 印を立てる。群は消さない。§4)。
- 穴の縁に青い枠を付けない。下手なアニメーションはしない(動きは済んだときに 350ms 溶けるだけ)。
- 文は短く。照らしている所を文で言い直さない。
- 告知の帯(ActionNotice)が出ている間は段を出さない。**例外は「保存しました」の帯 + ⑩ の1組だけ**(§7)。
- 語彙: 「機材/機種」を使わない。楽器種別は S.Sax 等。
- iPhone 縦が基準。iPad の2ペイン(高さ固定の `.pane-frame`)と殻(計測タブを離れるとマイクを止める・広告の帯 `--ad-h` を `readBottomLimit` が引く)でも成り立つこと(§11)。
- 完了の印は kv の `onboardingDone`。立てるだけで倒さない。見本は `?tutorialpreview=1`(本物の印は書かない)。

### 0.3 これまでの罠(前の便の審査で実際に起きたもの)と、この便での避け方

| 罠 | この便での避け方 |
|---|---|
| メトロノームの面が開いたままタブをまたぐと、面の中の分岐が残って流れが止まった | 新しい段(到着4枚・goCommunity・goMeasure・finish)は**どれも面の開閉を読まない**。計測タブの新しい段 finish は穴なしで、マイクの門・面の分岐より**前**に判定する(§3) |
| 案内のカードの位置に、利用者が続けて押す部品があると、その1回が外押しになり、群がまるごと消えた(④ の2回目のタップ・③ のあとの −/＋) | 新しい段ごとに「直前の操作 → 続けて押しそうな所 → カード・受けがそこに来ないか」を §2.5 の表で点検し、検査の手順(§13.1 の「続けて押す」の節)に落とした。到着カードは穴なし・「どこを押しても次へ」なので、外押しで群が消える扱いにしない(`dismissedRef` に入れない。§4) |
| 自動スクロールが、前の段を待っている間に走った | 新しい段に `scrollIntoView` を持つものは無い(的が下部タブか、穴なし)。既存の `earlierInDom` の門は変えない |
| 穴を小さくしすぎて、当たり判定の 44 を下回った | 新しい穴は 下部タブの絵柄(直径 52。既存の pad 11)と 帯(ActionNotice の箱。高さ ≥ 68 = `--tap-min` 44 + 上下 `--sp-3`)だけ。到着カードは穴なし |

---

## 1. いまの作り(HEAD + 3点の直し)の要点 ── 触る前に知っておくこと

| 何 | 場所 | 要点 |
|---|---|---|
| 段の表 | `src/onboarding.jsx:95-212` `COACH_STEPS` | 17段(tuner / metronome / metroTempo / metroStart / goReeds / reedLinked / measureReed / measure / goData / reeds(+`also`) / reedsMeasure / data / calendarDay / daySession / trend / idealSeen / adoptAverage)。どの段も `target`(CSS セレクタ)を持つ。`dismissWith` = 外を押して一緒に消す群、`markOnDismiss` = 押す=済、`scrollIntoView` = 的へ1回送る、`passThrough` = 受けを置かない祖先、`also` = 2つ目の穴 |
| 印の名前 | `:53` `ONBOARDING_FLAGS`(17)/ `:57` `MEASURE_STEPS_MIGRATED` / `:59` `COACH2_MIGRATED` / `:61` `MEASURE_TAB_STEPS`(9)/ `:63` `MEASURE_TAB_STEPS_LEGACY` / `:65` `DATA_TAB_STEPS`(3)/ `:67` `MEASURE_CHAPTER_FLAGS`(7) | `normalizeOnboardingDone`(:221)は true だけを済みと読み、3つの門の印も別に読む |
| どの段を出すか | `:308-348` `coachCandidates({ topTab, done, micReady, hasSessions, sessionsKnown, metroPanelOpen, metronomeOn, metroTempoQuiet, hasSelectedReed, idealRequested })` | タブごとに候補の並び。計測タブは1つだけ・データタブは並び。`OnboardingCoach` が「的が画面にまるごと見えている最初の1つ」を出す(:579-611) |
| 移行 | `:262-291` `migrateOnboardingDone` | 3つの門(`migrated` / `migratedMeasureSteps` / `migratedCoach2`)。計測が1件でもあれば新しい段は全部済み |
| 部品 | `:535-769` `OnboardingCoach({ candidates, done, hidden, onMark })` | `measure()` で的を探して `view` を作る。`dismiss`(:641)は `dismissWith` を `dismissedRef` へ入れて消す・`markOnDismiss` なら `onMark(flag)`。描画(:702-768): `.coach-hole`(+ `also` の2つ目)・`.coach-hit` 4枚(×2)・`.coach-card`(アイコン・見出し・1行) |
| 2つ目の穴の道具 | `:482-499` `holesSplit` / `bandOfHole` / `holeClipPath`、`:503` `hitRects(hole, vw, vh, band)` | 2つの穴を縦に分ける線で帯を分け、穴ごとに影と受け4枚 |
| カードの位置 | `:386` `placeCoachCard({ hole, cardH, vh, bottomLimit, gap })` | 見える範囲の縦の中央。`hole` が null なら中央のまま(便BS の名残。**到着カードがこの道を使う**) |
| 見える範囲の下端 | `:458` `readBottomLimit(vh)` | 下部タブの上端 − `--ad-h`(殻の帯も同じ) |
| App の配線 | `src/App.jsx:3862-3876`(`coachRequest` / `trendFocusRequest` / `openTrendFromNotice`)/ `3989-4032`(印・見本・移行・`onboardingReady`・`coachReady`・`markSessionSaved`)/ `5138-5183`(tuner・metronome・面・鳴り・`hasSelectedReed`・依頼を畳む・タブ移動の印)/ `5522-5529`(`<OnboardingCoach>`。`hidden` の式) | `hidden` = `!coachReady \|\| isRecording \|\| anySheetOpen \|\| errorScrimShown \|\| saveConfirmShown \|\| isAnalyzingUpload \|\| Boolean(notice)` |
| 帯(ActionNotice) | `App.jsx:3655` `NOTICE_MS = 5000` / `3690-3739` `useActionNoticeStore`(`showNotice({ text, actionLabel, onAction, done, undo })`)/ `3748-3802` 描画(外箱 `position: fixed; zIndex 50; bottom: calc(var(--page-bottom-gap) + var(--sp-3))`、内箱 `className="action-notice"` が白いカード)/ `4232-4237` 保存の帯 `「HH:mm の計測を保存しました」+「開く」` / `5478` 目安の帯 `ADOPTED_DONE_NOTE + 「見る」` | `--page-bottom-gap = calc(var(--nav-h) + var(--ad-h) + env(safe-area-inset-bottom))`(index.css:269) |
| 下部タブ | `App.jsx:5613-5648` `BottomNav`(`data-bottom-nav`。各ボタン `data-coach={\`nav-${t.key}\`}`。絵柄 30) | 的は `[data-coach="nav-○○"] svg` を pad 11 の円(直径 52) |
| コミュニティ | `src/community/CommunityTab.jsx:507` `CommunityTabBody`(phase: loading / notJoined / form / profile)/ `534-536` phase が profile なら `onOnboarding("join")` / `608-628` JoinIntro / `629-662` ProfileForm(保存 → `setPhase("profile")`)/ `876-981` `JoinIntro`(`.coach-layer` + `.coach-dim` + `.join-frame` + `.coach-card.join-card`。920 の文・944-946 の導線「アカウント引継」→ `BackupSheet`)/ `481-504` `BackupSheet`(`<BottomSheet ariaLabel="アカウント引継"><BackupPanel /></BottomSheet>`。ProfileView 2125 からも開く) | |
| 記録の保存 | `src/backup/BackupPanel.jsx`(`handleExport` :56 … 殻は `backupExport.native.js` の共有シート / `handleFile` :91 … `validateSnapshot` → `window.confirm` → `writeAll` → reload / 文 :141-187) | 検査: pitch-test 73.5(`BackupPanel.jsx` の5つの文の綴りと**出てくる順**)・`src/shell/backupExport*.test.jsx`・`src/community/joinIntroBackup.test.jsx`・`joinCard.test.jsx` |
| CSS | `src/index.css:866-918` `.coach-*`(`.coach-card` 地 `--c-surface`・角丸 18・影 `0 8px 24px rgba(15,23,42,0.18)` / `.coach-icon` 地 `--c-accent-tint` / `.coach-dim` / `.join-frame` / `.coach-card.join-card`) | pitch-test BW.7(33133)が**この塊の長さ 3145 と fnv1a ハッシュ**を固定している → この便で意図して変わる(§13.3) |
| 見本 | `src/tutorialPreview.js` / `App.jsx:4001`(見本の初期値に3つの門) | |
| 検査 | `src/onboarding.test.jsx`(純関数・部品)/ `src/onboardingApp.test.jsx`(App を描く)/ `src/idealSeenFlow.test.jsx` / `src/community/joinCard.test.jsx` / `joinIntroBackup.test.jsx` / pitch-test の節 BW(32949-33146)・88.2(31045)・73.5(28173)・K.12(32576)・46(23030) | §13 |

---

## 2. 一本の流れ ── 段の一覧(これが仕様の中心)

記法: **flag** = kv `onboardingDone` の印の名前。**的** = CSS セレクタ(的の要素が `data-coach` で名乗る)。**章** = B2 の目印で「今の章」として紺になる章(`chapter`)。**群** = 外を押して消したときに一緒に消す段(`dismissWith`)。「押す=済」= `markOnDismiss`。「到着」= `arrival: true`(穴なし・どこを押しても次へ = 印を立てる・群なし。§4)。**新** = この便で足す段、**改** = 文や作りを変える段、無印 = 今のまま。

### 2.1 全体の流れ(章立て)

```
1章 計測     ① ② ③ ④ ⑤ ──(本人が下部タブ「リード」)──▶
2章 リード   [到着: ここはリードタブ] ⑥ ⑦ ──(⑦ の「計測」で計測タブへ)──▶
3章 計測     ⑧ ⑨ (録音 → 登録) ⑩(保存の帯と同時) ──(本人が下部タブ「データ」)──▶
4章 データ   [到着: ここはデータタブ] ⑫ ⑬ (詳細) ⑭ ⑭' みんなのデータも見てみよう ──(本人が下部タブ「コミュニティ」)──▶
5章 コミュニティ (参加の画面 = JoinIntro。段ではない) → 参加・プロフィール → [到着: ここはコミュニティ] ⑯ 目安に ──(帯「見る」)──▶
6章 データ   ⑮ みんなの平均を目安にしました → ⑰ 計測タブに戻ろう ──(本人が下部タブ「計測」)──▶
終わり 計測  ⑱ チューナーとメトロノームを使って、あなたのデータを貯めよう！(穴なし・押したら終わり)
```

番号は便BW の番号を引き継ぐ(⑪ = データタブの計測なし。流れの外)。新しい段の id: `arriveReeds` / `arriveData` / `arriveCommunity` / `goCommunity`(⑭')/ `goMeasure`(⑰)/ `finish`(⑱)。

### 2.2 段の表

#### 計測タブ(topTab = "measure")

| # | id | flag | 章 | 出る条件 | 的(穴) | 見出し / 1行 | 済む条件 | 群 |
|---|---|---|---|---|---|---|---|---|
| ⑱ **新・到着** | `finish` | `finish` | 計測 | `done.goMeasure && done.measure && done.goData && !done.finish`。**マイクの門・面の分岐より前**(穴なしなのでマイクを待たない) | **穴なし**(画面いっぱいの暗幕) | チューナーとメトロノームを使って、あなたのデータを貯めよう！ / はじめの案内はこれで終わりです | **どこを押しても済**(外・カード。印 `finish`) | なし |
| ① | `tuner` | `tuner` | 計測 | 既存 | 既存 | 既存 | 既存 | `MEASURE_TAB_STEPS` |
| ② | `metronome` | `metronome` | 計測 | 既存 | 既存 | 既存 | 既存 | 同 |
| ③ | `metroTempo` | `metroTempo` | 計測 | 既存 | 既存 | 既存 | 既存 | 同 |
| ④ | `metroStart` | `metroStart` | 計測 | 既存 | 既存 | 既存 | 既存 | 同 |
| ⑤ | `goReeds` | `goReeds` | 計測 | 既存 | 既存(下部タブ「リード」) | 次はリードを登録しよう / (なし)── **変えない**(到着カードは「ここはリードタブ」= 場所、⑤ は「次にやること」で役が違う。§16 の「決めたもの」) | 既存 | 同 |
| ⑧ | `reedLinked` | `reedLinked` | 計測 | 既存 | 既存 | 既存(1行は作業ツリーの「計測データに選択したリードが紐づきます」) | 押す=済 | なし |
| ⑨ | `measureReed` / `measure` | `measure` | 計測 | 既存 | 既存 | 既存 | 既存 | `MEASURE_TAB_STEPS` |
| ⑩ **改** | `goData` | `goData` | 計測 | 既存(`hasSessions && !done.goData`)。**保存の帯が出ている間も出す**(§7) | 下部タブ「データ」の絵柄(既存)+ **2つ目の穴 `also`: 帯の箱 `[data-action-notice]`(rect・pad 0)**。帯が無ければ1つ目だけ | 計測の記録を見てみよう / (なし) | 既存(計測があるときにデータタブへ移った) | `MEASURE_TAB_STEPS` |

#### リードタブ(topTab = "reeds")

| # | id | flag | 章 | 出る条件 | 的 | 見出し / 1行 | 済む条件 | 群 |
|---|---|---|---|---|---|---|---|---|
| **新・到着** | `arriveReeds` | `arriveReeds` | リード | `!done.arriveReeds`(⑥⑦ より先) | 穴なし | ここはリードタブ / 使っているリードを登録して、計測に紐づけます | どこを押しても済 | なし |
| ⑥ | `reeds` | `reeds` | リード | 既存 | 既存(FAB + 楽器種別の行) | 既存(作業ツリーの文) | 既存 | なし |
| ⑦ | `reedsMeasure` | `reedsMeasure` | リード | 既存 | 既存 | 既存 | 既存 | なし |

#### データタブ(topTab = "analysis")

| # | id | flag | 章 | 出る条件 | 的 | 見出し / 1行 | 済む条件 | 群 |
|---|---|---|---|---|---|---|---|---|
| ⑮ | `idealSeen` | `idealSeen` | データ | 既存(`idealRequested && !done.idealSeen`。**到着より先**) | 既存(音の傾向カード) | 既存 | 押す=済 | なし |
| ⑪ | `data` | `measure` | データ | 既存(計測が無い) | 既存 | 既存 | 既存 | なし |
| **新・到着** | `arriveData` | `arriveData` | データ | 計測が**ある**(`sessionsKnown && hasSessions`)・`!done.arriveData`。⑫⑬⑭ より先。計測が無いときは出さない(⑪ の文「ここに貯まります」と重なる) | 穴なし | ここはデータタブ / 計測の記録はここに貯まります | どこを押しても済 | なし |
| ⑫ | `calendarDay` | `calendarDay` | データ | 既存 | 既存 | 既存 | 既存 | `DATA_TAB_STEPS` |
| ⑬ | `daySession` | `daySession` | データ | 既存 | 既存 | 既存 | 既存 | 同 |
| ⑭ | `trend` | `trend` | データ | 既存 | 既存 | 既存 | 押す=済 | なし |
| ⑭' **新** | `goCommunity` | `goCommunity` | データ | `done.trend && !done.join && !done.goCommunity`(参加済みの人には出さない) | `[data-coach="nav-community"] svg`・circle・pad 11 | みんなのデータも見てみよう / (なし) | コミュニティタブへ移った(§9 の effect) | なし(自分だけ) |
| ⑰ **新** | `goMeasure` | `goMeasure` | データ | `done.idealSeen && !done.goMeasure` | `[data-coach="nav-measure"] svg`・circle・pad 11(⑪ と同じ的) | 計測タブに戻ろう / (なし) | ⑮ を見てから計測タブへ移った(§9 の effect) | なし |

- データタブの候補は並びで返す(既存)。`[calendarDay?, daySession?, trend?, goCommunity?, goMeasure?]`。的が見えている最初の1つが出る。⑭(押す=済)を押した次の描画で ⑭' の的(下部タブ)は必ず見えているので、⑭ → ⑭' と続く。⑮ を押した次の描画で ⑰ が続く。

#### コミュニティタブ(topTab = "community")

| # | id | flag | 章 | 出る条件 | 的 | 見出し / 1行 | 済む条件 | 群 |
|---|---|---|---|---|---|---|---|---|
| ─ | (参加の画面 `JoinIntro`) | ─ | ─ | 参加していない(phase notJoined)。段ではない(既存) | ─ | コミュニティに参加しよう / みんなの計測データが見られます(既存) | 参加する → プロフィールを作る | ─ |
| **新・到着** | `arriveCommunity` | `arriveCommunity` | コミュニティ | `done.join && !done.arriveCommunity`(⑯ より先)。`join` は phase が profile になった描画で立つ(CommunityTab.jsx:534-536)= プロフィールを作った直後・参加済みの人がタブを開いた直後 | 穴なし | ここはコミュニティ / 参加した人の計測データと、みんなの平均が見られます | どこを押しても済 | なし |
| ⑯ | `adoptAverage` | `adoptAverage` | コミュニティ | 既存(`done.join && !done.adoptAverage`) | 既存(平均カード) | 既存 | 既存 | なし |

### 2.3 文言の表(一字一句。`onboarding.test.jsx` の「文言」の節がこの表を固定する。既存17段 + 新6段 = 23段)

| id | icon | chapter | title | line |
|---|---|---|---|---|
| tuner | tuner | measure | まずは吹いてみよう | 音程がリアルタイムで表示されます |
| metronome | metro | measure | メトロノームも使えます | テンポを決めて練習できます |
| metroTempo | metro | measure | テンポを決めよう | ♩=n を押すと拍子も変えられます |
| metroStart | metro | measure | タップでスタート | もう一度押すと止まります |
| goReeds | reeds | measure | 次はリードを登録しよう | null |
| reedLinked | reeds | measure | 選んだリードが紐づいています | 計測データに選択したリードが紐づきます |
| measureReed | mic | measure | このリードで計測してみよう | ボタンタップで計測スタート |
| measure | mic | measure | 最初の計測を記録しよう | ボタンタップで計測スタート |
| goData | data | measure | 計測の記録を見てみよう | null |
| **finish** | tuner | measure | チューナーとメトロノームを使って、あなたのデータを貯めよう！ | はじめの案内はこれで終わりです |
| **arriveReeds** | reeds | reeds | ここはリードタブ | 使っているリードを登録して、計測に紐づけます |
| reeds | reeds | reeds | 楽器を選択してリードを登録しよう | 計測に登録したリードを紐づけることができます |
| reedsMeasure | measure | reeds | このリードで計測してみよう | null |
| data | data | data | 計測を始めると、ここに貯まります | 計測タブから計測してみよう |
| **arriveData** | data | data | ここはデータタブ | 計測の記録はここに貯まります |
| calendarDay | data | data | 計測した日を押してみよう | null |
| daySession | data | data | 記録を開いてみよう | null |
| trend | data | data | データが溜まると、平均がここにグラフで出ます | null |
| **goCommunity** | community | data | みんなのデータも見てみよう | null |
| idealSeen | target | data | みんなの平均を目安にしました | my平均と目安を重ねて見られます |
| **goMeasure** | measure | data | 計測タブに戻ろう | null |
| **arriveCommunity** | community | community | ここはコミュニティ | 参加した人の計測データと、みんなの平均が見られます |
| adoptAverage | target | community | みんなの平均を目安にしてみよう | 目安に設定すると自分の音と比べられます |

- `chapter` は各段の **`flag: …, icon: …` の行の末尾**に書く(例 `flag: "tuner", icon: "tuner", chapter: "measure",`)。`target: …` の行には足さない ── pitch-test BW.1 が tuner(32989)と idealSeen(32992)の `target:` の行を**行ごと**正規表現で見ているため。
- アイコンは既存の8種(`ICONS`: tuner / metro / mic / reeds / measure / data / community / target。onboarding.jsx:432-441)から選ぶ。**新しい絵は足さない。** `goMeasure` の `measure` は下部タブ「計測」の絵柄(メーターの針)と同じ系統、`goCommunity` の `community` は参加のカードと同じ。
- 「！」は全角(アプリの「？」と同じ)。「ここはコミュニティ」は「タブ」を付けない(モックのとおり。4文字 + 3文字で 375 幅の見出しに収まる)。

### 2.4 印の一覧(`ONBOARDING_FLAGS`。順番はこのまま。既存17 + 新6 = 23)

```
["measure", "reeds", "reedsMeasure", "join", "adoptAverage", "tuner", "metronome", "dataSeen",
 "metroTempo", "metroStart", "goReeds", "reedLinked", "goData", "calendarDay", "daySession", "trend", "idealSeen",
 "arriveReeds", "arriveData", "arriveCommunity", "goCommunity", "goMeasure", "finish"]
```

移行の門の印(印の表の外。`normalizeOnboardingDone` が別に読む): 既存 `migrated` / `migratedMeasureSteps` / `migratedCoach2` に **`migratedCoach3`** を足す(定数名 `COACH3_MIGRATED`。§10)。

群の定数は変えない(`MEASURE_TAB_STEPS` 9・`DATA_TAB_STEPS` 3・`MEASURE_CHAPTER_FLAGS` 7・`MEASURE_TAB_STEPS_LEGACY` 3)。新しい段はどれも群を持たない(到着・押す=済・下部タブの段 goCommunity / goMeasure は自分だけ)。

### 2.5 「続けて押す罠」の点検(新しい段ごと。実装後に §13.1 の手順で確かめる)

| 段 | 直前の操作(本人の指がどこにあるか) | 続けて押しそうな所 | カード・受けの位置 | 判定 |
|---|---|---|---|---|
| 到着 arriveReeds | 下部タブ「リード」(画面の下端)を押した | 無い(新しいタブを見る)。二度押しなら下部タブの同じ所 | カードは中央・受けは画面いっぱい。二度押しは受けに当たり「次へ」= ⑥ が出る(害なし。⑥ の的は FAB で下部タブと離れている) | 可 |
| 到着 arriveData | 下部タブ「データ」を押した / 帯の「開く」を押した | 同上 | 同上。「開く」から来た(詳細の上)でも出す(場所を言う札なので詳細の上でよい)。次へ進んでも詳細の中では ⑫⑬⑭ の的が無いので何も出ない(既存) | 可 |
| 到着 arriveCommunity | 「プロフィールを作る」(フォームの最下部)を押した(保存 → JoinedView に差し替わり、文書は先頭へ戻る) | 無い | カードは中央・受けは画面いっぱい。差し替えの前の指の位置には何も無い | 可 |
| ⑩ goData(帯と同時) | 保存の確認(z60)の「登録」を押した(シートの下部) | 帯の「開く」(右下)・下部タブ「データ」 | カードは中央(375×812: 上端 ≈ 300・下端 ≈ 470)。帯(上端 ≈ 685)と下部タブ(765)は穴の中で受けが無い。「登録」のあった所(≈ 700 付近)は帯の穴に重なるか、帯の外なら受け(消すだけ・下へ届かない)── 二度押しで「登録」の下に在った物が押されることは無い | 可 |
| ⑭' goCommunity | ⑭ を押した(カードか外。中央付近) | 無い | 下部タブ「コミュニティ」の穴。カードは中央(⑭ と同じ所)。二度押しは受けに当たり **⑭' が消える**(群は自分だけ。次の起動で出る) | 可(二度押しは自然な続きではない。⑧ → ⑨ と同じ型で便BW が受け入れている) |
| ⑰ goMeasure | ⑮ を押した | 無い | 同上(下部タブ「計測」) | 可 |
| 到着 finish | 下部タブ「計測」を押した | 無い | 受けは画面いっぱい。二度押しは「次へ」= 終わり | 可 |

- 到着カードの受けは**下部タブも覆う**(COACH_Z 55 > 30)。到着カードが出ている間に下部タブを押すと、その1回は「次へ」になりタブは移らない(1回だけ。本人の決定「どこを押しても次へ」の帰結。§16 の「決めたもの」)。

---

## 3. 判定の関数 `coachCandidates`(onboarding.jsx:308)── 書き換え後の全文(この形で書く)

```js
export function coachCandidates({
  topTab, done, micReady = false, hasSessions = false, sessionsKnown = true,
  metroPanelOpen = false, metronomeOn = false, metroTempoQuiet = true, hasSelectedReed = false, idealRequested = false,
}) {
  const d = done ?? {};
  switch (topTab) {
    case "measure": {
      // 【便BX】⑱ 終わり(穴なし)。⑮ を見て計測タブへ戻り(goMeasure)、計測の章(measure)とデータへの橋(goData)も済んでいれば。
      // 穴なしなのでマイクも面の開閉も待たない(殻でタブへ戻った直後の取り直しの間にも出る)
      if (d.goMeasure && d.measure && d.goData && !d.finish) return ["finish"];
      if (!micReady) return [];
      if (!d.tuner) return ["tuner"];
      if (!d.metronome) return ["metronome"];
      if (metroPanelOpen && !d.metroTempo) return ["metroTempo"];
      if (metroPanelOpen && !d.metroStart) return metroTempoQuiet ? ["metroStart"] : [];
      if (metroPanelOpen && metronomeOn) return [];
      if (!d.goReeds && !d.reeds) return ["goReeds"];
      if (hasSelectedReed && !d.reedLinked) return ["reedLinked"];
      if (!d.measure) return [hasSelectedReed ? "measureReed" : "measure"];
      if (hasSessions && !d.goData) return ["goData"];
      return [];
    }
    case "reeds": {
      // 【便BX】到着(穴なし)。⑥⑦ より先
      if (!d.arriveReeds) return ["arriveReeds"];
      return !d.reeds ? ["reeds"] : !d.reedsMeasure ? ["reedsMeasure"] : [];
    }
    case "analysis": {
      if (idealRequested && !d.idealSeen) return ["idealSeen"];
      if (!sessionsKnown) return [];
      if (!hasSessions) return !d.measure ? ["data"] : [];
      // 【便BX】到着(穴なし)。計測があるときだけ(無いときは ⑪ の文「ここに貯まります」が場所を言っている)
      if (!d.arriveData) return ["arriveData"];
      const out = [];
      if (!d.calendarDay) out.push("calendarDay");
      if (!d.daySession) out.push("daySession");
      if (d.daySession && !d.trend && !d.idealSeen) out.push("trend");
      // 【便BX】⑭' データ → コミュニティの橋(参加済みの人には出さない)/ ⑰ ⑮ を見たあと計測タブへ戻る橋
      if (d.trend && !d.join && !d.goCommunity) out.push("goCommunity");
      if (d.idealSeen && !d.goMeasure) out.push("goMeasure");
      return out;
    }
    case "community": {
      if (!d.join) return [];
      // 【便BX】到着(穴なし)。参加した直後(プロフィールを作った)・参加済みの人がタブを開いた直後。⑯ より先
      if (!d.arriveCommunity) return ["arriveCommunity"];
      return !d.adoptAverage ? ["adoptAverage"] : [];
    }
    default: return [];
  }
}
```

- 引数は変えない(署名の綴りを pitch-test BW.2 が見ている。そのまま通る)。
- 計測タブの既存の分岐(① 〜 ⑩)は**1文字も変えない**(BW.2 の正規表現がそのまま通る)。足すのは先頭の `finish` の1行だけ。
- `case "analysis"` の `idealSeen` の出現は 3 → **4**(goMeasure の条件)。BW.2 の数の期待を 4 に改める(§13.3)。

### 3.1 順番を外れた操作(段を飛ばした)の吸収

| 本人の操作 | 立つ印 | 結果 |
|---|---|---|
| ⑤ を見ずにリードタブへ | `goReeds`(既存)| 到着 arriveReeds → ⑥ |
| データタブを計測の前に覗いた | 何も(goData は計測があるときだけ・arriveData も計測があるときだけ)| ⑪。最初の保存のあと ⑩ → データタブで到着 arriveData → ⑫ |
| 帯の「開く」で詳細へ直行 | `goData`・`daySession`(既存)| 詳細の上に到着 arriveData(押せば済)。戻ると ⑫ → 日を開く → ⑭ → ⑭' |
| ⑭ を見ずにコミュニティへ(自分で)| `goCommunity`(タブを移った結果)| ⑭' は二度と出ない(⑤⑩ と同じ型)。戻れば ⑭ は出る |
| データの章を飛ばしてコミュニティで目安にし、「見る」| `adoptAverage`・(帯)→ ⑮ `idealSeen`(押す=済)| ⑮ → ⑰(計測タブに戻ろう)。⑫⑬ が未なら、カレンダーの日が見えている所に送れば ⑫ も出る(⑰ は下部タブが的なので、⑮ のあとの送り位置(最下段)では ⑰ が先に出る。受け入れる) |
| 計測を1件もせずに ⑰ まで来て計測タブへ | `goMeasure` | ⑱ は `measure && goData` が未なので出ない。① から普段の流れ。保存 → 帯 + ⑩ → データ → 戻る → ⑱ |
| 参加済みの人(計測なし)が初めてこの版でコミュニティを開いた | `join`(既存)。移行で `arriveCommunity` は立つ(§10)| 到着は出ない。⑯ は既存どおり |
| ⑱ を押さずに別のタブへ | 何も | 戻れば ⑱ がまた出る(穴なし・常に見える) |
| 外を押して ⑭' / ⑰ を消した | 何も(群は自分だけ)| この起動では出ない。次の起動で出る |

---

## 4. 到着カード(B1)の作り ── `OnboardingCoach` の変更(onboarding.jsx)

### 4.1 段の属性

`COACH_STEPS` の到着4段(`arriveReeds` / `arriveData` / `arriveCommunity` / `finish`)は **`arrival: true`** を持ち、**`target` を持たない**(`target: null` とも書かない。pitch-test BW.1「`target: null` が0件」はそのまま通す。BX の節で「`arrival: true` の段は4つで、どれも `target` を持たない」を見る)。`pad` / `shape` / `dismissWith` / `markOnDismiss` / `scrollIntoView` / `also` も持たない。`chapter` と `icon` / `title` / `line` / `flag` だけ。

### 4.2 `measure()`(onboarding.jsx:570)

候補の走査(579-611)の中、`const step = COACH_STEPS[id]; if (!step) continue;` の直後に:

```js
      // 【便BX】到着(穴なし)。的を探さず、この段を出す(候補は到着1つだけで返るので、前の段を待つことは無い)
      if (step.arrival) { found = { id, arrival: true }; break; }
```

`if (!found) { … }` のあと、穴を作る前に分岐:

```js
    if (found.arrival) {
      const sameStep0 = cur && cur.id === found.id;
      const cardH0 = sameStep0 ? (cardRef.current?.getBoundingClientRect().height || 0) : 0;
      const place0 = placeCoachCard({ hole: null, cardH: cardH0, vh, bottomLimit: readBottomLimit(vh) });
      const next0 = { id: found.id, arrival: true, hole: null, pass: null, extra: null, split: null, band: null, extraBand: null,
        top: place0.top, side: "center", measured: cardH0 > 0, leaving: false, vw, vh };
      if (!sameView(cur, next0) || cur.vw !== vw || cur.vh !== vh) commit(next0);
      return true;
    }
```

- `placeCoachCard` は `hole` が null なら中央を返す(既存 :389。便BS の名残で残っている道。コメントの「【便BS】穴の無い段」を「【便BX】到着カード」に書き替える)。
- `sameView`(:402)は `!a.hole || !b.hole` のとき `a.hole === b.hole`(両方 null)で同じと判定する(既存)。変えない。

### 4.3 `advance`(新しい関数。`dismiss` の隣)

```js
  // 【便BX】到着カード(穴なし): どこを押しても「次へ進む」= 印を立てる。外押しではないので dismissedRef には入れない(群も消さない)。
  const advance = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = viewRef.current;
    if (!cur || cur.leaving || !COACH_STEPS[cur.id]?.arrival) return;
    onMarkRef.current?.(COACH_STEPS[cur.id].flag);
  };
```

印が立つと `done` が変わり、`useLayoutEffect`(657)→ `leaveIfDone` → 350ms 溶けて消える(既存の道)。溶けている間は受けもカードも当たりを持たない(index.css:907-908。既存)。見本(`tutorialPreview`)でも `onMark` が previewDone に立てるので同じ。

### 4.4 描画(onboarding.jsx:706-765)

`view.hole` の有無で分ける。穴がある段は**今の描画のまま**(1文字も変えない)。到着は:

```jsx
          {view.arrival ? (
            <>
              {/* 【便BX】到着カード: 穴なし。暗幕を画面いっぱいに敷き(.coach-dim。参加の画面と同じ規則)、受け1枚で「どこを押しても次へ」 */}
              <div className="coach-dim" aria-hidden="true" />
              <div className="coach-hit" aria-hidden="true" data-coach-hit="all" style={{ left: 0, top: 0, width: view.vw, height: view.vh }} onClick={advance} />
            </>
          ) : (
            … 既存の穴・2つ目の穴・受け4枚(×2)…
          )}
          <div ref={cardRef} className="coach-card sans" … onClick={view.arrival ? advance : dismiss}>
            <ChapterMarks … />   ← §5
            <CoachIcon name={step.icon} />
            <div className="coach-title">{step.title}</div>
            {step.line ? <div className="coach-line">{step.line}</div> : null}
          </div>
```

- `.coach-dim` は index.css:874 にある既存の規則(`pointer-events: none`)。受けは `.coach-hit`(`pointer-events: auto`)。
- `data-coach-layer={view.id}` は既存どおり(検査が `[data-coach-layer="arriveReeds"]` で探す)。
- 冒頭の注記(:29-40)に【便BX】の段落を足す(到着・章の目印・帯と同時・地の色)。:530 の「【便BW】的なしの段の道は外した」の行は「【便BX】到着カード(穴なし・どこを押しても次へ)だけが暗幕を画面いっぱいに敷く」と書き替える。

---

## 5. 章の目印(B2)の作り

### 5.1 判定(純関数。onboarding.jsx に export)

```js
// 【便BX 2026-10-06 本人の決定 B2】カードの上部の4章の目印。今いる章 = 出している段の chapter。済んだ章は印で決める(数を数えない)。
export const COACH_CHAPTERS = Object.freeze([
  { key: "measure", label: "計測" }, { key: "reeds", label: "リード" }, { key: "data", label: "データ" }, { key: "community", label: "コミュニティ" },
]);
export function chapterDone(key, done) {
  const d = done ?? {};
  switch (key) {
    case "measure": return d.measure === true || d.goReeds === true;   // 保存した、または1章を終えてリードへ渡った
    case "reeds": return d.reeds === true;                               // リードを登録した
    case "data": return d.trend === true;                                // 4章の最後(音の傾向)まで見た
    case "community": return d.adoptAverage === true;                    // みんなの平均を目安にした
    default: return false;
  }
}
export function chapterMarks(stepId, done) {
  const cur = COACH_STEPS[stepId]?.chapter ?? null;
  return COACH_CHAPTERS.map((c) => ({ key: c.key, label: c.label, state: c.key === cur ? "cur" : chapterDone(c.key, done) ? "done" : "" }));
}
```

- 「今の章」が「済んだ章」でもあるとき(⑧⑨⑩ で `goReeds` 済・⑱ で全部済)は **cur が勝つ**(紺)。
- 位置(i < cur を済みにする)で決めない ── 流れは計測・データへ2度戻る(3章・6章)ので、位置だと「戻ってきた章の前が未」に見える。
- 検査(§13.1)で全段 × 代表的な done の組を固定する。

### 5.2 描画(カードの先頭の子)

```jsx
function ChapterMarks({ stepId, done }) {
  return (
    <div className="coach-marks" aria-hidden="true">
      {chapterMarks(stepId, done).map((m) => (
        <div key={m.key} data-coach-mark={m.state || "todo"}><i className={m.state} /><span>{m.label}</span></div>
      ))}
    </div>
  );
}
```

`<OnboardingCoach>` の中で `<ChapterMarks stepId={view.id} done={done} />` をカードの**最初の子**に置く(アイコンの上)。読み上げ(`.coach-live`)の文は変えない(目印は装飾。カードは既に `aria-hidden`)。

### 5.3 CSS(index.css の `.coach-line` の直後に足す。**トークンだけ**)

```css
/* 【便BX 2026-10-06 本人の決定 B2】章の目印(計測・リード・データ・コミュニティ)。カードの最初の子。今の章 = 紺・済んだ章 = 薄い紺(--c-accent-mid。
   系列色の第2段)・まだ = 中立の灰(--c-line-strong。地が --c-accent-tint なので --c-line では見えない)。棒の高さと間は --sp-1、字は --fs-xs。 */
.coach-marks { justify-self: stretch; display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--sp-1); }
.coach-marks i { display: block; height: var(--sp-1); border-radius: var(--r-full); background: var(--c-line-strong); }
.coach-marks i.done { background: var(--c-accent-mid); }
.coach-marks i.cur { background: var(--c-accent); }
.coach-marks span { display: block; margin-top: var(--sp-1); font-size: var(--fs-xs); line-height: var(--lh-tight); text-align: center; white-space: nowrap; color: var(--c-ink-3); }
.coach-marks .cur + span { color: var(--c-accent); font-weight: 700; }
```

- 幅の確認(375): カード 331 − 内側 16×2 = 299。列 = (299 − 4×3) / 4 = 71.75px。「コミュニティ」は `--fs-xs` 12px × 6字 = 72px → **0.25px のはみ出し**は `white-space: nowrap` + `text-align: center` で左右に均等に出る(見えない)。モックの 10px は型の段(7段)に無いので使わない。iPad(カード 640)は余裕。
- モックの棒 3px も段に無いので `--sp-1`(4px。シートのつまみ(`.grip` 36×4)と同じ太さ)。色の `--c-ink-4` は「本文には使わない・軸目盛まで」(index.css:108)の注記があるので、章の名は `--c-ink-3`。
- カードの縦: 20(上)+ 目印 ≈ 4 + 4 + 16 = 24 + 8(gap)+ アイコン 44 + 4 + … → 既存より **約 32px 高い**。375×812 で中央に置いても下部タブ・帯にかからない(§7.3 の実寸)。

---

## 6. A1-e の見た目(index.css。既存のトークンだけ)と、見分けを補う手

### 6.1 変える規則(`.coach-card` / `.coach-icon` / `.coach-card.join-card`)

```css
.coach-card {
  position: fixed; left: …; right: …; pointer-events: auto;           /* 変えない */
  background: var(--c-accent-tint); border-radius: 18px; box-shadow: 0 8px 24px rgba(15,23,42,0.18);   /* 【便BX A1-e】地を --c-surface → --c-accent-tint */
  padding: …; display: grid; …                                       /* 変えない */
}
.coach-icon {
  width: 44px; height: 44px; border-radius: 50%; margin-bottom: var(--sp-1);
  background: var(--c-surface); color: var(--c-accent);               /* 【便BX A1-e】丸を --c-accent-tint → --c-surface(地と区別がつくように) */
  display: grid; place-items: center;
}
/* 【便BX】参加の画面のカード(JoinIntro)は**今までの白のまま**(同意・主ボタン・導線を持つ対話の面で、照らす相手が無い。本人の決定 A は「案内のカード」)。 */
.coach-card.join-card { …既存の宣言…; background: var(--c-surface); }
.join-card > .coach-icon { background: var(--c-accent-tint); }
```

- 字(`.coach-title` `--c-ink` / `.coach-line` `--c-ink-2`)は変えない。#EAEFF5 の上の #121F32 / #435266 はどちらもコントラスト比 4.5 以上。
- `.coach-marks` の棒(`--c-line-strong` #C3CAD3)は #EAEFF5 の上で見える(明度差あり)。
- DESIGN-SYSTEM §1 の色の表(86 行目 `--c-accent-tint` = 「選択状態の背景」)に「はじめの一手のカードの地(【便BX】)」を足す。§4.5b の表の「カード」「アイコン」の行を改める(§12)。
- pitch-test BT.4(31823)は `.coach-card {…}` の left/right だけを読むので通る。BW.7(33133)の**長さとハッシュの固定は意図して落ちる** → §13.3 のとおり構造の検査に替える。

### 6.2 見分けを補う手(1つだけ。**今は実装しない。** 本人がスクショで「白いカードと見分けにくい」と言ったときに足す)

- 本人の例「影を既存トークンの中で強めのものに」は**できない**: 今のカードの影 `0 8px 24px rgba(15,23,42,0.18)` はアプリの中で最も強い「浮き」(シート・浮かせるボタン・告知と同値)で、体系の影のトークン(`--shadow-card` / `--shadow-row` / `--shadow-seg`)はどれもこれより弱い。強めるには新しい値を作ることになる。
- 代わりの手: **カードの縁に 1px の線 `border: 1px solid var(--c-accent-line)`**(#B9C9E4。「紺系の罫線」のトークン。index.css:114)。アプリの白いカードは「浮きは影だけが担う・縁を持たない」(index.css:614)ので、縁を持つだけで「画面の部品ではない」と分かる。穴の縁ではなくカードの縁なので「穴の縁に青い枠を付けない」には触れない。
- 足すときは `.coach-card` に1宣言、`.coach-card.join-card` に `border: 0;`(参加のカードは変えない)。それだけ。

---

## 7. 帯と同時に出す例外 ── 「保存しました」の帯 + ⑩

### 7.1 帯に「案内を出してよい」印を持たせる(App.jsx)

- `useActionNoticeStore` の `showNotice`(3709-3722)が作る帯の中身に **`coach: next.coach === true`** を1つ足す(他の帯は undefined → false)。
- `registerPendingSession`(4232-4237)の `showNotice({ text: …, done: true, actionLabel: "開く", onAction: …, })` に **`coach: true,`** を足す(`text:` の行は変えない。pitch-test 46 がその行を見ている)。取り込みの保存の帯(5092)・目安の帯(5478)・その他は変えない。
- `<OnboardingCoach hidden=…>`(5527)の式を:

```jsx
        hidden={!coachReady || isRecording || anySheetOpen || errorScrimShown || saveConfirmShown || isAnalyzingUpload || (Boolean(notice) && !notice.coach)}
```

  に改める(変更はこの1か所。pitch-test BW.5 と `onboardingApp.test.jsx:460` の「一字一句」の期待を新しい式に改める。§13)。
- 帯が出ている間に候補が ⑩ 以外になることは無いか: 保存の直後、計測タブの候補は `MEASURE_CHAPTER_FLAGS` が全部立つので ⑩(`hasSessions && !goData`)か `[]`(面が開いて鳴っている・goData 済)だけ。⑱ は `goMeasure` が要るので普段は出ないが、§3.1 の「計測を1件もせずに ⑰ まで来た」人は保存の瞬間に `goMeasure` 済・`measure` 済・`goData` 未 → ⑩ が出る(⑱ は `goData` が要るので出ない)。帯と同時に出得るのは ⑩ だけ。

### 7.2 帯を2つ目の穴で照らす(onboarding.jsx / App.jsx)

- `COACH_STEPS.goData` に **`also: { target: "[data-action-notice]", pad: 0, shape: "rect" }`** を足す(便BX の作業ツリーが ⑥ に足した `also` と同じ道具。帯が無ければ `document.querySelector` が null → 1つ目だけ = 今までどおり)。
- `ActionNotice`(App.jsx:3767)の**内箱**(`className={notice.leaving ? "action-notice is-leaving" : "action-notice"}` の div)に **`data-action-notice=""`** を足す(属性だけ。style は変えない)。外箱は幅いっぱい・`pointerEvents: none` なので的にしない。
- 帯の穴の中には受けを置かない(既存の作り)ので「開く」はそのまま押せる。帯の穴の角丸は `--r-2`(帯の `--r-md` = `--r-2`。同じ)。
- 帯が消える(`is-leaving` 200ms → 外れる)と 2つ目の穴も消え、1つ目だけになる(`sameView` が `extra` の有無を比べる。既存)。

### 7.3 位置の実寸(375×812・広告なし・安全域 0。**実装後に `getBoundingClientRect` で確かめて報告に書く**)

| 物 | 上端 | 下端 | 根拠 |
|---|---|---|---|
| 下部タブ | 765 | 812 | `--nav-h` 47 |
| 「データ」の絵柄 30 | ≈ 772 | ≈ 802 | 内箱 46(上 6・下 8)の中央 |
| ⑩ の穴(直径 52) | ≈ 761 | ≈ 813 | 絵柄の中心 ± 26 |
| 帯の内箱 | ≈ 685 | ≈ 753 | 下端 = 812 − (`--page-bottom-gap` 47 + `--sp-3` 12)。高さ = 44(`--tap-min`)+ 12×2 |
| 2つの穴を分ける線 `holesSplit` | 757 | ─ | (753 + 761) / 2。**null にならない**(帯の下端 753 < 穴の上端 761。差 8 = `--sp-3` − pad の分で端末に依らない) |
| カード(高さ ≈ 150。目印込み) | ≈ 308 | ≈ 458 | `placeCoachCard`: 中央 (765 − 150) / 2。穴(761)の 22 以内にかからないので中央のまま |

広告あり(`--ad-h` = 58): 帯は広告の上(下端 695)、穴は下部タブ(761)。線は 728。カードの見える範囲の下端は 707 → 中央 ≈ 278。iPhone SE(375×667): 帯 540〜608・穴 616〜668・線 612・カード (620 − 150)/2 = 235。iPad(820×1180): 列 640 の中。どれも成り立つ。

### 7.4 帯の文は変えない

「HH:mm の計測を保存しました」+「開く」のまま(pitch-test 46)。

---

## 8. D1「端末を替えるとき」のシート

### 8.1 処理を使い回す ── `useBackupActions`(`src/backup/BackupPanel.jsx`)

`BackupPanel` の中の state 5つ(`persistence` 以外: `busy` / `notice` / `failure`)と `handleExport` / `handleFile` / `fileInputRef` を **フック `useBackupActions()` に出して export** する。`BackupPanel` はそのフックを呼ぶだけにし、**描く中身(文・順・ボタンの語・style)は1文字も変えない**(pitch-test 73.5 が `BackupPanel.jsx` の5つの文の綴りと出てくる順を見ている。フックは return の前に在るので順は変わらない。`persistence` / `estimate` は BackupPanel だけが使うので中に残す)。

```js
export function useBackupActions() {
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [failure, setFailure] = useState(null);
  const exportNow = async () => { …handleExport の中身そのまま(殻の分岐を含む)… };
  const importFile = async (file) => { …handleFile の中身そのまま… };
  const pickFile = () => fileInputRef.current?.click();
  const fileInput = (
    <input ref={fileInputRef} type="file" accept="application/json,.json" style={{ display: "none" }}
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); }} />
  );
  return { busy, notice, failure, exportNow, pickFile, fileInput };
}
```

- `BackupPanel` の `<input …>` は `{fileInput}` に、`onClick={handleExport}` は `onClick={exportNow}`、`onClick={() => fileInputRef.current?.click()}` は `onClick={pickFile}` に。出力の DOM は同じ。
- 文言の定数化はしない(73.5 が綴りを JSX の中で見ている)。
- `src/shell/backupExport.test.jsx` / `backupExportWeb.test.jsx`(BackupPanel を描いて書き出す)はそのまま通ること。

### 8.2 新しい板 `DeviceTransferPanel`(**新しいファイル** `src/backup/DeviceTransferPanel.jsx`。BackupPanel.jsx には足さない ── 73.5 の「出てくる順」の検査がファイル全体を見るため)

```jsx
import { useBackupActions } from "./BackupPanel.jsx";
export const DEVICE_TRANSFER_TITLE = "端末を替えるとき";
export const DEVICE_TRANSFER_LEAD = "記録(計測のデータとリード)はファイルで移せます。コミュニティの匿名アカウントは、この端末だけのもので移せません。参加し直すと新しいアカウントになります。";
export const DEVICE_TRANSFER_STEPS = Object.freeze([
  "前の端末のマイページで「ファイルに書き出す」",
  "そのファイルをこの端末に送る(AirDrop・メールなど)",
  "ここで「ファイルから読み戻す」",
]);
export const DEVICE_TRANSFER_EXPORT = "この端末の記録を書き出す";
export default function DeviceTransferPanel() {
  const { busy, notice, failure, exportNow, pickFile, fileInput } = useBackupActions();
  return (
    <div>
      <div className="sans" style={{ fontSize: "var(--fs-lg)", fontWeight: 700, lineHeight: "var(--lh-tight)", color: "var(--c-ink)" }}>{DEVICE_TRANSFER_TITLE}</div>
      <div className="sans" style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: "var(--lh-loose)", marginTop: "var(--sp-1)" }}>{DEVICE_TRANSFER_LEAD}</div>
      <ol className="sans" style={{ listStyle: "none", margin: "var(--sp-3) 0 0", padding: 0, display: "grid", gap: "var(--sp-2)" }}>
        {DEVICE_TRANSFER_STEPS.map((t, i) => (
          <li key={i} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: "var(--sp-2)", alignItems: "start", fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: "var(--lh-base)" }}>
            <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--c-accent-tint)", color: "var(--c-accent)", fontSize: "var(--fs-xs)", fontWeight: 700, display: "grid", placeItems: "center" }}>{i + 1}</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={pickFile} disabled={busy} className="sans" style={{ ...PRIMARY_BUTTON, marginTop: "var(--sp-4)" }}>ファイルから読み戻す</button>
      <div className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", lineHeight: 1.6, marginTop: 6 }}>読み戻すと、いまの記録はすべて置き換わります。実行する前に確認します。</div>
      <button type="button" onClick={exportNow} disabled={busy} className="sans" style={{ ...QUIET_LINK, marginTop: "var(--sp-3)" }}>{DEVICE_TRANSFER_EXPORT}</button>
      {notice && <div className="sans" style={{ fontSize: 12, color: "var(--c-ink-2)", lineHeight: 1.6, marginTop: 8 }}>{notice}</div>}
      {failure && <div className="sans" style={{ fontSize: 12, color: "var(--c-danger)", lineHeight: 1.6, marginTop: 8 }}>{failure}</div>}
      {fileInput}
    </div>
  );
}
```

- `PRIMARY_BUTTON` は BackupPanel.jsx の定数を **export して import**(写しを作らない)。`QUIET_LINK` = CommunityTab.jsx の `JOIN_QUIET_LINK_STYLE` と同じ値(`width 100% / minHeight --tap-min / padding 0 / background none / border none / color --c-ink-2 / --fs-sm / 600 / pointer`)。CommunityTab.jsx から export して import する(`export const JOIN_QUIET_LINK_STYLE`。pitch-test 88.2 の正規表現 `const JOIN_QUIET_LINK_STYLE = \{` は `export const` でも後方一致するが、念のため BX の節で見直す。§13.3)。
- 文の体裁は既存の BackupPanel の注記(11px・12px の直書き)と `sheetTitleStyle`(screens.jsx:1975 `--fs-lg` 700 `--c-ink`。シートの見出しの既存の体裁)に合わせる。番号の丸 24 は「絵 24」(`.coach-icon svg`)と同じ既存の寸法、地と字は `.coach-icon` と同じ組(`--c-accent-tint` / `--c-accent`)。
- 殻では `exportNow` が共有シートへ(既存の分岐)。Web 版からの移し方の1行(BackupPanel の殻だけの文)は D1 には**置かない**(手順1〜3が同じことを言っている)。
- `window.confirm` の文・reload は `importFile` の中(既存のまま)。

### 8.3 器と導線(`src/community/CommunityTab.jsx`)

- `BackupSheet`(498-504)は**変えない**(マイページの「アカウント引継」はそのまま。pitch-test 73.5 / 88.2 の `<BottomSheet ariaLabel="アカウント引継">` の綴りも残る)。
- 新しい器を隣に:

```jsx
// 【便BX 2026-10-06 本人の決定 D1】参加の画面(JoinIntro)の導線「端末を替えるとき」から開くシート。中身は参加の場面に絞った DeviceTransferPanel
// (記録はファイルで移せる / 匿名アカウントは移せない / 手順3つ / 主ボタン「ファイルから読み戻す」/ 細い導線「この端末の記録を書き出す」)。
// 書き出し・読み戻しの処理は BackupPanel の useBackupActions を使い回す(写しを作らない)。マイページの BackupSheet(汎用の「記録の保存」)は変えない。
export function DeviceTransferSheet({ onClose }) {
  return (
    <BottomSheet ariaLabel={DEVICE_TRANSFER_TITLE} onClose={onClose}>
      <DeviceTransferPanel />
    </BottomSheet>
  );
}
```

- `JoinIntro`:
  - 920 行の文 → `匿名のアカウントはこの端末にだけ残ります。端末を替えたりアプリを削除したりすると失われ、元に戻せません。`
  - 944-946 の導線の文 → `{DEVICE_TRANSFER_TITLE}`(= 端末を替えるとき)。style(`JOIN_QUIET_LINK_STYLE`)・位置(カードの最後の子)は変えない。
  - 977 行 `{backup ? <BackupSheet …> : null}` → `{backup ? <DeviceTransferSheet onClose={() => setBackup(false)} /> : null}`。
  - 注記(883-885・942-943)を D1 の説明に書き替える。
- `App.jsx:18465`(殻・記録 0 件のときの移し方の1行)「コミュニティタブ → マイページ(参加前なら参加の画面)の「アカウント引継」で移せます。」→ **「コミュニティタブ → マイページの「アカウント引継」(参加前なら参加の画面の「端末を替えるとき」)で移せます。」**(pitch-test K.12 の綴りを合わせる。§13.3)。
- `privacy.html` 等の外の文書に「アカウント引継」の語があっても触らない(マイページの名前は残る)。

---

## 9. 印を立てる口(配線)── App.jsx

| 何 | どこ | 中身 |
|---|---|---|
| タブ移動の印 | 5179-5183 の effect | ```useEffect(() => {\n  if (!coachReady) return;\n  if (topTab === "reeds") markOnboarding("goReeds");\n  if (topTab === "analysis" && sessions.length > 0) markOnboarding("goData");\n  // 【便BX】⑭' コミュニティへ移った / ⑰ ⑮ を見てから計測タブへ戻った\n  if (topTab === "community") markOnboarding("goCommunity");\n  if (topTab === "measure" && coachDone.idealSeen) markOnboarding("goMeasure");\n}, [coachReady, topTab, sessions.length, coachDone.idealSeen, markOnboarding]);``` ── `goMeasure` は「⑮ を見た人が計測タブに居る描画」で立つ(⑮ がデータタブで立ち、その後に計測タブへ移った描画で effect が走る。⑮ 前から計測タブに居ることは無い) |
| 到着・⑱ の印 | 無し(部品の `advance` が `onMark(flag)` で立てる。既存の `onMark={markOnboarding}`) | |
| 帯の `coach` | §7.1 | |
| 見本の初期値 | 4001 の2か所 | `{ …, [MEASURE_STEPS_MIGRATED]: true, [COACH2_MIGRATED]: true, [COACH3_MIGRATED]: true }` |
| `onboardingReady` | 4023 | `&& onboardingDone[COACH3_MIGRATED]` を足す |
| import | 42 | `import { COACH2_MIGRATED, COACH3_MIGRATED } from "./onboarding.jsx";` |
| 下部タブの的 | 5633 | 既存(4つとも `nav-${t.key}`)。`nav-community` に読み手(⑭')ができる |
| `ActionNotice` | 3767 | `data-action-notice=""`(§7.2) |
| 移し方の1行 | 18465 | §8.3 |

CommunityTab.jsx の `onOnboarding?.("join")`(534-536)は変えない(到着 arriveCommunity の門)。

---

## 10. 移行(`migrateOnboardingDone` onboarding.jsx:262)── 4つ目の門 `migratedCoach3`

```js
export const COACH3_MIGRATED = "migratedCoach3";
…
export function migrateOnboardingDone(prev, { sessions = [], reeds = [], idealProfiles = [], isAdopted = () => false } = {}) {
  const base = isObj(prev) ? prev : {};
  if (base.migrated === true && base[MEASURE_STEPS_MIGRATED] === true && base[COACH2_MIGRATED] === true && base[COACH3_MIGRATED] === true) return prev;
  … 既存(便BP・便BS・便BW の3つの門)はそのまま …
  // 【便BX 2026-10-06 本人の決定】4つ目の門。計測が1件でもある人には新しい段(到着4枚・⑭'・⑰)を1つも出さない。
  if (base[COACH3_MIGRATED] !== true) {
    if (ss.length > 0) for (const f of ["arriveReeds", "arriveData", "arriveCommunity", "goCommunity", "goMeasure", "finish"]) next[f] = true;
    if (rs.length > 0) next.arriveReeds = true;                                  // リードタブを知っている
    if (next.join === true) { next.arriveCommunity = true; next.goCommunity = true; }   // 参加している(コミュニティを知っている)
    if (next.idealSeen === true) next.goMeasure = true;                          // 便BW の門で idealSeen が立った人(目安を取り込んである)に「計測タブに戻ろう」を出さない
    next[COACH3_MIGRATED] = true;
  }
  return next;
}
```

- `normalizeOnboardingDone` に `out[COACH3_MIGRATED] = src[COACH3_MIGRATED] === true;` を足す。
- `next.join` / `next.idealSeen` は**同じ呼び出しの中で3つ目までの門が立てた値も含めて**読む(`base` ではなく `next`)。
- 結果の表:

| 誰 | 立つ | 結果 |
|---|---|---|
| 計測が1件でもある人(本人・既存の利用者のほぼ全員) | 新6つ全部 | **新しい段は1つも出ない**。カードの地の色・章の目印・D1 のシートは既存の人にも見える(段ではなく見た目・導線) |
| リードはあるが計測が無い人 | arriveReeds | リードタブで到着は出ない。計測タブは ① から。保存のあと ⑩(帯と同時)→ データで到着 → … |
| 参加しているが計測が無い人 | arriveCommunity・goCommunity | コミュニティで到着は出ない。⑯ は既存どおり |
| 目安を取り込んである人(計測なし) | goMeasure | ⑰ は出ない。⑱ は `measure && goData` が立つまで出ない(計測 → データ → 戻ったら出る) |
| 何も無い人(入れたて) | 門の印だけ | 流れの全部(§15 の見本と同じ順) |
| 前の3つの門だけ済んでいる保存値 | 4つ目だけ走る(他の印は倒さない) | ─ |
| 4つの門が全部 true | **同じ物(`===`)を返す** | 書き込みを起こさない |

- `onboardingReady`(App.jsx:4023)に `COACH3_MIGRATED` を足す(移行の前に案内が一瞬出ない)。
- 既存の便BP・便BS・便BW の移行の結果は**変わらない**(既存の it をそのまま通す。`migratedCoach2` の分岐の中身は1文字も触らない)。

---

## 11. iPad と殻(Capacitor)

| 場面 | 成り立つか | 根拠 |
|---|---|---|
| 到着カード(穴なし)| `.coach-dim` は `position: fixed; inset: 0` で全体。カードは `.coach-card` の left/right(列 640 で中央)・縦は `placeCoachCard`(bottomLimit = 下部タブ上端 − `--ad-h`)。2ペインの中の送り位置に依らない | index.css:874・880 |
| ⑭'⑰ 下部タブの絵柄 | 既存の ⑤⑩⑪ と同じ(内箱 640・1つ 150。絵柄 30 は中央) | 便BT |
| ⑩ + 帯 | 帯の内箱は `maxWidth: var(--page-max-w)`・中央(App.jsx:3771)。穴は内箱の矩形。下部タブの穴とは縦に離れている(§7.3) | ─ |
| 殻: タブへ戻ると `micReady` が遅れる | ⑱ はマイクの門の前なので遅れない。⑭'⑰ はデータタブ(マイク不要)。到着はどのタブでも門の外 | ─ |
| 殻: 広告の帯 | `readBottomLimit` が `--ad-h` を引く(既存)。帯(ActionNotice)は `--page-bottom-gap` が `--ad-h` を含むので広告の上に出る。⑩ の2つの穴は広告をまたぐ(帯の穴が上・下部タブの穴が下。広告は暗幕の下) | index.css:269 |
| 殻: 書き出し(D1 の細い導線) | `exportNow` の殻の分岐(共有シート)をそのまま使う | BackupPanel.jsx:64-72 |
| 殻: 見本 | 便BW と同じ(Safari で `?tutorialpreview=1`。殻の server.url には付けない) | coach2-spec §14(4) |
| 殻の判定 | `onboarding.jsx` は `isNativeShell` を読まない(BW.3 のまま) | ─ |

---

## 12. 触るファイル(一覧)

| ファイル | 触る所 |
|---|---|
| `src/onboarding.jsx` | 冒頭の注記【便BX】/ `ONBOARDING_FLAGS`(+6 = 23)/ `COACH3_MIGRATED` / `COACH_STEPS`(全段に `chapter`・新6段・`goData` に `also`)/ `COACH_CHAPTERS` `chapterDone` `chapterMarks`(export)/ `normalizeOnboardingDone` / `migrateOnboardingDone`(4つ目の門)/ `coachCandidates`(§3 の全文)/ `OnboardingCoach`(`measure()` の到着の道・`advance`・描画の分岐・`ChapterMarks`)/ `placeCoachCard` のコメント |
| `src/App.jsx` | import `COACH3_MIGRATED` / `showNotice` の `coach` / 保存の帯に `coach: true` / `ActionNotice` に `data-action-notice` / `hidden` の式 / タブ移動の effect(+2)/ 見本の初期値 ×2 / `onboardingReady` / 18465 の移し方の1行 |
| `src/index.css` | `.coach-card` の地 / `.coach-icon` の地 / `.coach-card.join-card` に地 / `.join-card > .coach-icon` / `.coach-marks` 6規則 / 注記(857-859・872-874 の「的なしの段」→「到着カード」) |
| `src/backup/BackupPanel.jsx` | `useBackupActions` を切り出して export / `PRIMARY_BUTTON` を export / 描く中身は不変 |
| `src/backup/DeviceTransferPanel.jsx` | **新規**(§8.2) |
| `src/community/CommunityTab.jsx` | `DeviceTransferSheet` / `JoinIntro` の文・導線の名前・開くシート / `JOIN_QUIET_LINK_STYLE` を export / 注記 |
| `design/DESIGN-SYSTEM.md` | §1 色の表(`--c-accent-tint` の用途)/ §4.5b: 表に新6段・到着の作り・章の目印・帯と同時の例外・地の色・参加のカードの導線「端末を替えるとき」と文・4つ目の門・見本の段数 |
| `src/onboarding.test.jsx` / `src/onboardingApp.test.jsx` / `src/idealSeenFlow.test.jsx` / `src/community/joinCard.test.jsx` / `src/community/joinIntroBackup.test.jsx` | §13.1・§13.2 |
| `src/backup/deviceTransfer.test.jsx` | **新規**(§13.2) |
| `scripts/pitch-test.mjs` | 節 BW の期待を改める(BW.1 門の正規表現・BW.2 idealSeen の数・BW.3 受け・BW.5 hidden と effect と見本の初期値・BW.7 CSS と DESIGN-SYSTEM)/ 88.2 / K.12 / 新節「BX」(§13.3) |
| 触らない | `src/community/idealDoc.js` / `src/community/screens.jsx` / `src/tutorialPreview.js` / `src/shell/*` / `codemagic.yaml` / マイページの `BackupSheet` と `ProfileView` |

---

## 13. 検査

3ゲート: `npm run test` / `node scripts/pitch-test.mjs` / `npm run build`。vitest は総件数を見る(「PASS (0)」は合格ではない。rtk を迂回するなら `rtk proxy npx vitest run`)。pitch-test の PASS 数は下げない・FAIL 0。この端末の Bash の罠(ヒアドキュメントのバックスラッシュ・pitch-test は `grep -a`)はメモリのとおり。

### 13.1 `src/onboarding.test.jsx`(純関数と部品)

書き換えるもの(理由を注記に書く):
- 「【便BW】17 の一手の見出し・1行・アイコン」→ **23 の段**(§2.3 の表を一字一句。`chapter` も)。
- 「どの段も的を持つ(的なしは無い)」→ **到着4段(`arrival: true`)だけ `target` を持たず、他の19段は `target` が文字列**。
- `coachCandidates` の節: §3 の分岐を1つずつ(下の表)。
- 「押す=済は3つで群を持たない」→ そのまま(到着は `markOnDismiss` ではなく `arrival`)。
- 移行の節: 4つの門。

足すもの:

| 場面 | 入力 | 期待 |
|---|---|---|
| 計測タブ ⑱ | done: goMeasure・measure・goData 済・finish 未・**micReady false** | `["finish"]`(マイクを待たない)。finish 済 → micReady false なら `[]`。goData 未 → `[]`(micReady false)/ micReady true なら普段の結果(`goData`)。measure 未 → ① から |
| リードタブ | done 空 | `["arriveReeds"]`。arriveReeds 済 → `["reeds"]`(既存) |
| データタブ 到着 | hasSessions・done 空 | `["arriveData"]`。hasSessions false → `["data"]`(到着は出ない)。sessionsKnown false → `[]`。idealRequested → `["idealSeen"]` が先(到着より) |
| データタブ ⑭'⑰ | arriveData・calendarDay・daySession・trend 済 | `["goCommunity"]`。join 済 → `[]`。goCommunity 済 → `[]`。+ idealSeen 済 → `["goMeasure"]`(trend 済・join 済)/ `["goCommunity", "goMeasure"]`(join 未)。goMeasure 済 → 空 |
| コミュニティ | join 済・done 他は空 | `["arriveCommunity"]`。arriveCommunity 済 → `["adoptAverage"]`。join 未 → `[]` |
| `chapterDone` | 各章の印の組 | measure: `measure` か `goReeds` で true / reeds: `reeds` / data: `trend` / community: `adoptAverage`。空なら全部 false |
| `chapterMarks` | (`goData`, {goReeds}) | 計測 cur(done より cur が勝つ)・他 "" /(`arriveData`, {measure, reeds}) → 計測 done・リード done・データ cur・コミュニティ "" /(`idealSeen`, {measure, reeds, trend, adoptAverage}) → データ cur・他 done /(`finish`, 全部) → 計測 cur・他 done |
| 移行(4つ目の門) | `{ migrated, migratedMeasureSteps, migratedCoach2 }` + sessions 1件 | 新6つ true・`migratedCoach3` true。sessions 0・reeds 1 → arriveReeds だけ。sessions 0・`join: true` → arriveCommunity・goCommunity。sessions 0・adoptAverage(便BW の門が idealSeen を立てる)→ goMeasure。4つ全部 true なら同じ物(`===`)。便BP・便BS・便BW の既存の it はそのまま通る |
| 到着の描画 | 候補 `["arriveReeds"]`・的なし | `[data-coach-layer="arriveReeds"]` の中に `.coach-dim` が1枚・`.coach-hit[data-coach-hit="all"]` が1枚(0,0,vw,vh)・`.coach-hole` は**無い**。カードは中央(`placeCoachCard` の center)。受けを押すと `onMark("arriveReeds")` が呼ばれ、`dismissedRef` には入らない(印を立てずに描き直しても同じ段がまた出る = 外押しで消えていない)。カードを押しても同じ |
| 到着 → 次の段 | 到着を押して印を立てる(done を更新) | 溶けて消え(`data-leaving="true"`)、次の候補が出る |
| 章の目印の描画 | 候補 `["goData"]`・done {goReeds} | カードの最初の子が `.coach-marks`・子4つ・`[data-coach-mark]` が `cur,todo,todo,todo`。`i.cur` の順も |
| ⑩ の2つ目の穴 | `[data-coach="nav-analysis"] svg`(761〜813)と `[data-action-notice]`(685〜753)を置く | `.coach-hole` が2枚(`data-coach-hole="also"` が帯の矩形・pad 0・角丸 `--r-2`)。受けは帯の中にも下部タブの穴の中にも無い(帯の中心の点を含む `.coach-hit` が無い)。帯を外すと穴は1枚に戻る |
| `holesSplit` の実寸 | 上の2つの矩形 | `757`(null ではない) |

### 13.2 App を描く検査(`src/onboardingApp.test.jsx` 等)

書き換えるもの:
- 「配線の綴り」:460 の `hidden` の正規表現 → `(Boolean\(notice\) && !notice\.coach)`。:463 `onboardingReady` に `COACH3_MIGRATED`。
- 「既にある人の移行」: 計測1件で起動 → **どのタブでも何も出ない**(到着も)。kv に新6印 + `migratedCoach3`。
- 「見本」: 初期値に `migratedCoach3`。
- 既存の「リードタブで ⑥ が出る」「データタブで ⑫ が出る」「コミュニティで adoptAverage が出る」の it は、**到着カードを1回押してから**続ける(入れたての人・見本の場面)。到着を押す手: `[data-coach-layer="arriveReeds"] .coach-hit` を click。
- `idealSeenFlow.test.jsx`: ⑮ を押したあとに `[data-coach-layer="goMeasure"]`(下部タブ「計測」の svg が穴)が出ること。計測タブへ移ると kv に `goMeasure`、計測タブで `[data-coach-layer="finish"]`(穴なし・`.coach-dim`)。押すと `finish` が立ち、以後どのタブでも出ない。
- `joinCard.test.jsx:85`「機種変更やアプリの削除で」→ 新しい文。`:97` `アカウント引継` → `端末を替えるとき`。`:161-166` 導線を押すと `[role="dialog"][aria-label="端末を替えるとき"]` が開き、中に「ファイルから読み戻す」(1つ)・「この端末の記録を書き出す」(1つ)・手順3つ・「記録の保存」は**無い**。
- `joinIntroBackup.test.jsx`: 入口の名前と dialog の aria-label を「端末を替えるとき」に。「マイページの入口(地のあるボタン)とは別」は ProfileView 側が「アカウント引継」のままなので名前で分ける。

足すもの:

| 場面 | 操作 | 期待 |
|---|---|---|
| 保存 → 帯と同時に ⑩ | 入れたて・マイクあり・⑤⑧⑨ まで進めて録音 → 保存の確認で「登録」 | 帯「HH:mm の計測を保存しました / 開く」が出ている**同じ描画**で `[data-coach-layer="goData"]` が在る。`.coach-hole` が2枚(1つ目 = 下部タブ「データ」の svg・2つ目 `[data-coach-hole="also"]` = `[data-action-notice]` の矩形)。帯の「開く」を click すると `openSessionFromNotice` が走り(詳細が開く)、案内は消えて(タブが変わる)kv に goData・daySession。帯が 5 秒で消えても ⑩ は残る(穴は1枚に戻る) |
| 帯の種類 | 取り込みの保存の帯・目安の帯・削除の帯(undo) | `coach` が無いので従来どおり**どの段も出ない** |
| 到着 arriveData | ⑩ で下部タブ「データ」 | `[data-coach-layer="arriveData"]`(`.coach-dim`)。押すと kv に arriveData → `[data-coach-layer="calendarDay"]` |
| ⑭ → ⑭' | ⑭ を押す | kv に trend → すぐ `[data-coach-layer="goCommunity"]`(穴は `[data-coach="nav-community"] svg`)。join 済の人には出ない |
| ⑭' → 到着 arriveCommunity | 下部タブ「コミュニティ」(参加済みのモックで phase profile) | kv に goCommunity。`[data-coach-layer="arriveCommunity"]` → 押すと adoptAverage の段(既存) |
| ⑮ → ⑰ → ⑱ | `idealSeenFlow` の手で ⑮ → 押す → 下部タブ「計測」 | 上の書き換えのとおり |
| 到着の受けは外押しではない | 到着が出ている状態で `.coach-hit[data-coach-hit="all"]` を押す → 印を立てない onMark(見本で `markOnboarding` をスパイ) | `dismissedRef` に入っていない(印を立てずに再描画しても同じ到着が出る)。印を立てると次の段 |
| 到着カードの下部タブ | 到着が出ている間に下部タブを押す | タブは移らない(その1回は「次へ」) |
| D1 シート | `JoinIntro` の導線を押す → 「ファイルから読み戻す」 | `fileInput` の click が1回(`pickFile`)。ファイルを選ぶ → `validateSnapshot` → `window.confirm`(モック)→ `writeAll` → reload(モック)。「この端末の記録を書き出す」→ Web では `<a download>` 1回・殻(`isNativeShell` を true にモック)では `exportSnapshotFile`(`backupExport.test.jsx` と同じ手)。失敗の文は BackupPanel と同じ。`BackupPanel` 自身の描画は変わらない(`backupExport*.test.jsx` がそのまま通る) |
| 既存の利用者 | 計測1件・参加済み・目安あり | どのタブでも 0 枚。D1 のシートは開ける |
| 見本 | 全部済みの印 + `?tutorialpreview=1` | §15 の順で 21 枚が1枚ずつ。同時に2枚出る瞬間が無い(帯と ⑩ は「案内1枚 + 帯」で、案内は1枚) |
| 殻 | `isNativeShell` true・タブを往復 | ⑱ は `isListening` false でも出る。到着も。⑭'⑰ はデータタブ |

### 13.3 pitch-test(節 BW の期待の更新 + 新節「BX」)

節 BW(32949-33146)で**意図して変わる**期待(他は通る):
- BW.1(32977-32982)門の正規表現: 早期 return の条件に `&& base[COACH3_MIGRATED] === true` が加わる。
- BW.1(32985)`target: null` 0件・`anchor` なし・`dataSeen` の段なし → **そのまま通る**(到着は `target` を書かない)。
- BW.2(33001-33004)`idealSeen` の出現 3 → **4**。先頭の正規表現(`case "analysis": {\n if (idealRequested…` → `if (!sessionsKnown)`)はそのまま通る。
- BW.3(33018-33021)`!/data-coach-hit="all"|key: "all"/` → 到着の受けで `data-coach-hit="all"` が**1件**になる。期待を「`data-coach-hit="all"` は `view.arrival ?` の枝の中に1件だけ・穴の段の受けは `hitRects` のまま」に改める。`!/coach-dim/.test(ob)` → `.coach-dim` は到着の枝に**1件**。「`className="coach-dim"` は onboarding.jsx に1件(到着)・CommunityTab.jsx に1件(参加)」に改める。
- BW.5(33061-33063)`hidden` の一字一句 → 新しい式。(33064-33066)見本の初期値 `[COACH2_MIGRATED]: true, [COACH3_MIGRATED]: true }` ×2・`onboardingReady` に `COACH3_MIGRATED`。(33070-33073)タブ移動の effect の正規表現に `goCommunity` / `goMeasure` の2行を足す。
- BW.7(33133-33134)CSS の長さとハッシュ → **構造の検査に替える**: `.coach-card {` の塊に `background: var(--c-accent-tint);`・`.coach-icon {` に `background: var(--c-surface);`・`.coach-card.join-card {` に `background: var(--c-surface);`・`.join-card > .coach-icon { background: var(--c-accent-tint); }`・`.coach-marks` の6規則(§5.3 の宣言)・`.coach-card` の `box-shadow: 0 8px 24px rgba(15,23,42,0.18)` と `border-radius: 18px` は不変・この塊に `#` 始まりの色の直書きが無い(全部 `var(`)・`.coach-dim` の規則は不変。
- BW.7(33137-33143)DESIGN-SYSTEM の見出し一覧に新6段の見出しを足す(23)。
- 88.2(31045-31047)JoinIntro の導線 → 綴り `{DEVICE_TRANSFER_TITLE}`(または「端末を替えるとき」)・開くのは `<DeviceTransferSheet`・`<BackupPanel />` は CommunityTab.jsx に1件(BackupSheet)のまま。
- K.12(32576-32577)移し方の1行の綴り → §8.3 の新しい文。
- 73.5(28173-28207)→ そのまま通ること(BackupPanel.jsx の文と順は不変。`backup73` の中に `useBackupActions` が増えるが5つの文の順は変わらない)。

新節「BX」(節 BW の直後。綴りの検査。描いて押す検査は vitest):
- `onboarding.jsx`: `ONBOARDING_FLAGS` が §2.4 の23個をこの順 / `COACH3_MIGRATED = "migratedCoach3"` / `arrival: true` の段が4つ(`arriveReeds` `arriveData` `arriveCommunity` `finish`)で、その4つに `target:` が無い / 全23段に `chapter:` があり値は 4 種のどれか / `finish` の文(一字一句)/ `goData` に `also: { target: "[data-action-notice]", pad: 0, shape: "rect" }` / `coachCandidates` に `if (d.goMeasure && d.measure && d.goData && !d.finish) return ["finish"];` が `if (!micReady) return [];` の**直前** / `if (!d.arriveReeds) return ["arriveReeds"];` / `if (!d.arriveData) return ["arriveData"];` が `if (!hasSessions)` の後 / `if (d.trend && !d.join && !d.goCommunity) out.push("goCommunity");` / `if (d.idealSeen && !d.goMeasure) out.push("goMeasure");` / `if (!d.arriveCommunity) return ["arriveCommunity"];` / `advance` が `dismissedRef` に触らない(`const advance = (e) => {…}` の塊に `dismissedRef` が無く `onMarkRef.current?.(` がある)/ `chapterDone` の4分岐の綴り / 移行の4つ目の門の6印 + `rs.length > 0` → arriveReeds + `next.join === true` + `next.idealSeen === true` / `scrollIntoView` は今も1回。
- `App.jsx`: `coach: next.coach === true,` が `showNotice` の中 / `coach: true,` が保存の帯の `showNotice` の中に1回で、他の `showNotice({` には無い / `data-action-notice=""` が `ActionNotice` に1回 / `hidden` の式 / effect の2行 / `COACH3_MIGRATED` の import と使用3か所。
- `index.css`: §13.3 BW.7 の構造(上)。
- `BackupPanel.jsx`: `export function useBackupActions()` / `export const PRIMARY_BUTTON` / `BackupPanel` の return の中に `handleExport` `handleFile` `fileInputRef` の綴りが無い(フックの中だけ)/ 殻の分岐 `isNativeShell()` と `backupExport.native.js` の import は1回ずつ(写しが無い)。
- `DeviceTransferPanel.jsx`: 文の定数4つの綴り(§8.2 一字一句)/ `useBackupActions` を import / `window.confirm` `writeAll` `readAll` `buildSnapshot` の綴りが**無い**(処理はフックの中)/ `PRIMARY_BUTTON` を BackupPanel から import / 「機種」「機材」の語が無い。
- `CommunityTab.jsx`: `JoinIntro` に「機種変更」が無く「端末を替えたりアプリを削除したりすると失われ、元に戻せません。」がある / 導線の中身が `{DEVICE_TRANSFER_TITLE}` / `<DeviceTransferSheet onClose=` が JoinIntro に1回 / `BackupSheet` の定義は不変 / `export function DeviceTransferSheet`。
- `src` 全体: 利用者に見える文に「機種」「機材」が無い(コメントを除く。`codeOf`)。
- `DESIGN-SYSTEM.md` §4.5b に【便BX】・23 の見出し・「端末を替えるとき」・`--c-accent-tint`。

### 13.4 変異で確かめる点(実装後、写しの作業ツリーで1つずつ壊して、どの検査が落ちるかを見る。壊したら必ず戻して3ゲートを通し直す。メモリ「変異試験が実ツリーへ漏れた事故」)

| 変異 | 落ちるべき検査 |
|---|---|
| `advance` が `dismissedRef.current.add(cur.id)` もする | 13.1「到着の受けは外押しではない」 |
| `finish` の行を `if (!micReady)` の後ろへ | 13.1「⑱ micReady false」・BX |
| `arriveData` の行を `if (!hasSessions)` の前へ | 13.1「hasSessions false → data」 |
| `goCommunity` の条件から `!d.join` を外す | 13.1「join 済 → []」 |
| `hidden` を `Boolean(notice)` に戻す | 13.2「保存 → 帯と同時に ⑩」・BX |
| `coach: true` を目安の帯にも付ける | 13.2「帯の種類」・BX(1回) |
| `goData` の `also` を外す | 13.1「⑩ の2つ目の穴」 |
| `chapterDone("measure")` を `d.measure` だけに | 13.1 `chapterMarks`(`goData`, {goReeds}) は cur なので落ちない → (`arriveReeds`, {goReeds}) で計測 done を見る it を**足す** |
| 移行の `next.join` を `base.join` に | 13.1 移行(join が同じ呼び出しで立つ場面は無いので落ちない → 既存の挙動と同値。変異として無効。注記に書く) |
| `.coach-card` の地を `--c-surface` に戻す | BX(CSS) |
| `DeviceTransferPanel` に `window.confirm` を書く | BX |
| JoinIntro の文に「機種変更」を戻す | joinCard.test・BX |

---

## 14. 合格ライン

1. 3ゲート全部通る。vitest の総件数は**増える**。pitch-test の PASS は下げない・FAIL 0。
2. §13.1・§13.2 の表の場面が**全部**検査にあり、通る。§13.4 の変異で、無効と注記した1つ以外は全部どれかの検査が落ちる。
3. 既存の利用者(計測あり)の起動で、新しい段が **0 枚**(到着を含む。`migrateOnboardingDone` の結果を kv で確認)。
4. 見本で、§15 の順に **21 枚**がこの順で1枚ずつ出る。同時に2枚出る瞬間が無い。⑩ は保存の帯と**同じ描画**で出て、帯の「開く」が押せる(実機または dev サーバで、帯の「開く」を押して詳細が開くことを確かめる)。
5. ⑩ + 帯の実寸(375×812・広告なし/あり)を `getBoundingClientRect` で測って報告に書く: 帯の穴・下部タブの穴・分ける線・カードの上下。カードが帯にも下部タブにも重ならない。帯は暗くない(穴の中)。
6. 到着カード4枚: 穴なし・暗幕は画面いっぱい・どこを押しても次へ・外押しで群が消えない(⑥ の後に到着を押しても ⑥ が出る)。
7. 帯(ActionNotice)が出ている間はどの段も出ない ── **保存の帯 + ⑩ の1組を除く**(取り込みの帯・目安の帯・削除の帯の3つで確認)。
8. カードの地が `--c-accent-tint`・アイコンの丸が白・参加のカードは白のまま。章の目印が全カードの先頭にあり、§5.1 の規則どおり(スクショ: ⑤・到着リード・⑧・⑩+帯・到着データ・⑭'・到着コミュニティ・⑮・⑰・⑱ の10枚を報告に添える。本人が A の見分けを判断する材料)。
9. D1: 参加のカードの導線「端末を替えるとき」→ シートの中身が §8.2 のとおり。読み戻しと書き出しが BackupPanel と同じ結果(確認・置き換え・reload / 殻は共有シート)。マイページの「アカウント引継」は1文字も変わらない。
10. `index.css` の差分は §5.3・§6.1 の規則と注記だけ。`App.jsx` の差分は属性・1宣言・1行・effect の2行・文の1か所だけで、見た目の値(style)に差分が無い(diff を報告に添える)。
11. DESIGN-SYSTEM §4.5b が §2 の表と一致。「機種」「機材」の語が利用者に見える文に無い。
12. `onboarding.jsx` に `isNativeShell` が無い。殻の判定に新しい分岐を足していない。

---

## 15. 本人に見せる手順(`?tutorialpreview=1`)

- **本番の反映**: 検収が通ったら統括が `git push origin HEAD:main`(Vercel。待たない)。Ficus Dev(TestFlight の ios-dev)は本番の Web を読むので開き直すだけで反映。本人の端末の本物の印は「計測あり」なので、普段の起動では新しい段は出ない(§10)。地の色・章の目印・D1 は見本でなくても見える(D1 は参加前の画面にしか無いので、本人の端末では見本でも出ない → **D1 は dev サーバのスクショで見せる**)。
- **見本の入り方**(本人の端末。iPhone の Safari で `https://wind-tone-lab.vercel.app/?tutorialpreview=1`):
  1. 計測タブ: マイクを許可 → ① 吹く → ② メトロノームのアイコン → ③ − / ＋ → ④ 環を押す → ⑤ 下部タブ「リード」。
  2. リードタブ: **到着「ここはリードタブ」**(どこかを押す)→ ⑥ ＋ で1枚登録(本物のリードが1枚増える)→ ⑦ タイル → 詳細の「計測」。
  3. 計測タブ: ⑧ 左上の枠(押せば消える)→ ⑨ 録音 → 「登録」(本物の計測が1件増える)→ **帯「保存しました / 開く」と同時に ⑩**(下部タブ「データ」。「開く」も押せる)→ 下部タブ「データ」。
  4. データタブ: **到着「ここはデータタブ」** → ⑫ 今日のマス → ⑬ 先頭の行 → 詳細 → `< 一覧` → ⑭ 傾向カード(自動で見える所まで)→ 押す → **⑭'「みんなのデータも見てみよう」**(下部タブ「コミュニティ」)。
  5. コミュニティ: 本人は参加済みなので参加の画面は出ない → **到着「ここはコミュニティ」** → ⑯ 平均カード → 目安に設定(本物の目安が1つ増える)→ 帯「目安に設定しました **見る**」→ 押す。
  6. データタブ: ⑮ 傾向カード → 押す → **⑰「計測タブに戻ろう」**(下部タブ「計測」)→ 押す。
  7. 計測タブ: **⑱「チューナーとメトロノームを使って、あなたのデータを貯めよう！ / はじめの案内はこれで終わりです」**(穴なし)→ 押す → 終わり(以後どのタブでも出ない)。
  8. 見本をやめる: `…/?tutorialpreview=0`。見本の「済んだ」は Safari の localStorage に残るので途中でやめても続きから。最初からは `=1`。
  - 枚数: ①②③④⑤(5)+ 到着(1)+ ⑥⑦(2)+ ⑧⑨⑩(3)+ 到着(1)+ ⑫⑬⑭⑭'(4)+ 到着(1)+ ⑯(1)+ ⑮⑰(2)+ ⑱(1)= **21 枚**。
- **参加の画面(D1)と「ここはコミュニティ」の参加直後**: 本人の端末では見られない(参加済み)。実装役が dev サーバ(`ficus-dev`・375×812)で未参加のモックを使って撮ったスクショを報告に添える。コミュニティは dev では Firebase に繋がらないので、vitest(参加済み・未参加のモック)のスクショ代わりに DOM の確認で代える(メモリ「dev サーバ実測の罠」)。
- 実装役の確認は dev サーバ + Browser の 375×812。マイクの暗幕は JS クリックで回避。

---

## 16. 本人に聞く分かれ道(既定付き。返事が無ければ既定で進める)

**(1) 参加のカード(JoinIntro)の地の色**
- 既定 **ア**: 白のまま(§6.1)。理由: 同意・主ボタン・導線を持つ対話の面で、照らす相手(白いカード)が無い。本人の決定 A は「案内のカード」。
- イ: 案内のカードと同じ `--c-accent-tint` にする(`.coach-card.join-card` の上書きを置かない)。「同じ見た目」(便BS)を優先するならこちら。
- 聞く理由: 便BS で「はじめの一手のカードと同じ見た目」と決めていたので、黙って分けない。

**(2) 到着カードの「ここはデータタブ」を、計測が無いとき(⑪ の場面)にも出すか**
- 既定 **ア**: 出さない(§2.2)。⑪「計測を始めると、ここに貯まります」が場所を言っている。計測ができてから1回出る。
- イ: 計測が無くても出す(⑪ の前に1枚)。「タブに着いたら必ず到着」を厳密に守るならこちら。文が重なる。

決めてよいとしてこの文書が決めたもの(本人の目に触れるが小さい): ⑤ の文は変えない(到着「ここはリードタブ」は場所、⑤ は次の一手で役が違う)/ 到着カードが出ている間の下部タブの1回は「次へ」に使われる(どこを押しても次へ、の帰結)/ 章の目印の「済み」は印で決める(§5.1。位置で決めない)/ 章の名の字は `--fs-xs`(モックの 10px は段に無い)・棒は `--sp-1`・まだの棒は `--c-line-strong` / ⑭'「みんなのデータも見てみよう」は参加済みの人には出さない / ⑰ のアイコンは下部タブ「計測」と同じ `measure`、⑱ は `tuner` / 見分けを補う手は「縁 1px `--c-accent-line`」で、本人が言うまで足さない(§6.2)/ D1 の見出しは `--fs-lg` 700(モックの .h2。シートの見出し `sheetTitleStyle` と同じ)/ D1 に殻だけの「Web 版から」の1行は置かない / 「ここはコミュニティ」に「タブ」を付けない(モックのまま)。

---

## 付録A. 根拠の位置(この文書が読んだ所。作業ツリー = HEAD c702ea0 + 便BX の3点)

- `src/onboarding.jsx`: 1-44 冒頭の決まり(39-40 便BX の3点)/ 53-54 `ONBOARDING_FLAGS` / 57-67 門と群 / 95-212 `COACH_STEPS`(102 tuner・126 goReeds・129-134 reedLinked・149-153 goData・154-164 reeds + also・180-186 calendarDay・194-205 trend / idealSeen・207 adoptAverage)/ 221-229 `normalizeOnboardingDone` / 241-243 `onboardingFlagsForSavedSession` / 262-291 `migrateOnboardingDone` / 308-348 `coachCandidates` / 363 `targetVisible` / 369 `holeOf` / 386-399 `placeCoachCard`(389 hole null → 中央)/ 402-412 `sameView` / 432-446 `ICONS` `CoachIcon` / 448 `HOLE_RADIUS` / 458-478 `readBottomLimit` `resolveAdHeight` / 482-499 `holesSplit` `bandOfHole` `holeClipPath` / 503-516 `hitRects` / 535-769 `OnboardingCoach`(545 dismissedRef・570-639 measure・641-654 dismiss・657-661 useLayoutEffect・702-768 描画)
- `src/App.jsx`: 38-42 import / 3655 `NOTICE_MS` / 3690-3739 `useActionNoticeStore`(3709-3722 showNotice)/ 3748-3802 `ActionNotice`(3759-3765 外箱・3767-3776 内箱)/ 3843-3849 `handleNavTap` / 3856-3861 `openSessionFromNotice` / 3862-3876 `coachRequest` `openTrendFromNotice` / 3989-4032 印・見本(4001)・移行(4014-4019)・`onboardingReady`(4023)・`coachReady`・`markSessionSaved` / 4225-4242 `registerPendingSession`(4232-4237 保存の帯)/ 5092 取り込みの帯 / 5138-5183 tuner・metronome・面・鳴り・`hasSelectedReed`(5173)・依頼を畳む(5175-5176)・タブ移動の印(5179-5183)/ 5478-5481 目安の帯と印 / 5500 `<ActionNotice>` / 5503 `<BottomNav>` / 5522-5529 `<OnboardingCoach>` / 5613-5648 `BottomNav`(5633 data-coach)/ 16355-16414 `useAnyBottomSheetOpen` `BottomSheet` / 17112-17127 `toggleDay` `trendFocusRequest` / 17263 傾向カード / 17769 daySession の印 / 18465 移し方の1行
- `src/index.css`: 27 `--r-2` / 37 `--r-pill` / 66 `--tap-min` / 83 `--c-surface` / 108 `--c-ink-4`(本文に使わない)/ 109 `--c-line` / 110 `--c-line-strong` / 112 `--c-accent-mid` / 114 `--c-accent-line` / 115 `--c-accent-tint` / 242-246 影のトークン / 250 `--c-coach-dim` / 269 `--page-bottom-gap` / 614 「浮きは影だけ」/ 847-918 `.coach-*`(869-871・874 `.coach-dim`・876 `.coach-hit`・879-884 `.coach-card`・885-890 `.coach-icon`・891-892 title/line・900-905 join-frame / join-card・907-908 溶けている間・911-914 `.coach-live`)/ 1266 11px の先例(`.slist-sub`)
- `src/community/CommunityTab.jsx`: 28 import / 50 BackupPanel の import / 481-504 `BackupSheet` / 507-700 `CommunityTabBody`(508 phase・534-536 join の印・545-550 先頭へ戻す・608-628 JoinIntro・629-662 ProfileForm・663 JoinedView)/ 737-738 `bodyStyle` `noteStyle` / 783 `secondaryButtonStyle` / 798 `linkButtonStyle` / 849-858 `JOIN_TITLE` `JOIN_LINE` `joinLeadStyle` `JOIN_QUIET_LINK_STYLE` / 862-872 `useJoinFrameHeight` / 876-981 `JoinIntro`(886 backup・902-949 カード・920 文・944-946 導線・977 BackupSheet)/ 2125-2126 ProfileView の「アカウント引継」
- `src/backup/BackupPanel.jsx`: 17-20 import / 26-37 ボタンの style / 39-45 state / 56-89 `handleExport`(64-72 殻)/ 91-124 `handleFile` / 141-188 描画
- `src/community/screens.jsx`: 1975 `sheetTitleStyle` / 2031-2034 `SHEET_PRIMARY_BUTTON_STYLE` / 1312 平均カードの的
- `src/community/idealDoc.js`: 244 `ADOPTED_DONE_NOTE` / 246 `ADOPTED_DONE_LINE`(触らない)
- `src/tutorialPreview.js` 全文(触らない)
- `design/DESIGN-SYSTEM.md`: 86 `--c-accent-tint` / 221 `--c-coach-dim` / 1530 z55 / 1543-1644 §4.5b(1553-1570 表・1616-1618 カードとアイコンの行・1601-1607 参加の画面)
- `scripts/pitch-test.mjs`: 23030(46 保存の帯の文)/ 28173-28207(73.5 BackupPanel の文と順)/ 31045-31050(88.2 JoinIntro の導線)/ 31823-31829(BT.4 `.coach-card` の left/right)/ 32576-32577(K.12 移し方の1行)/ 32949-33146(節 BW: 32968-32995 BW.1・32997-33010 BW.2・33012-33023 BW.3・33025-33057 BW.4・33059-33077 BW.5・33079-33125 BW.6・33127-33144 BW.7)
- 検査: `src/onboarding.test.jsx`(describe 31 文言・121 coachCandidates・243 印・286 移行・334 3つ目の門・372 位置・…)/ `src/onboardingApp.test.jsx`(189 入れたて・217 外押し・339 移行・442-484 配線の綴り・489 見本・681 データタブの3段・871 計測タブの流れ・1002 ⑦⑧⑨⑩)/ `src/idealSeenFlow.test.jsx:144-230` / `src/community/joinCard.test.jsx:65-200`(85 文・97 導線・161-166 シート)/ `src/community/joinIntroBackup.test.jsx:43-100` / `src/shell/backupExport.test.jsx` / `backupExportWeb.test.jsx`
- モック `coach3-mock.html`: 107-148(カードと目印の CSS: `.cc.l2` = A1-e・`.steps`)/ 532-591(B のコマ)/ 593-640(C の流れ)/ 314-378(D のシート。332-349 D1)
- メモリ: 工程(統括が凍結 → jisso → shinsa → 統括が push)/ vitest の PASS (0) / dev サーバの罠 / 変異試験の漏れ / Bash の罠 / 本人の端末は PowerShell 5.1(`&&` 不可)/ 語彙の禁則
