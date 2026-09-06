# 13点の修正 — 設計

作成: 2026-09-06 / 状態: 設計(実装前) / 対象ブランチ: `claude/adopt-ideal` から派生

**この文書の読み方。** §0 は実際にコードを開いて確認した事実だけを行番号つきで書く。
§1〜§13 が依頼主の13点それぞれの仕様、§14 が設計上の分かれ道(争点A〜G)の裁定、
§15 が本人に聞かないと決められないこと、§16 が実装順、§17 が検収方法。
「未確認」と書いたものは、コードでは裏が取れず実機か本人でしか確かめられないもの。

行番号は 2026-09-06 時点の `src/App.jsx`(15443行) / `src/community/*` / `src/index.css` /
`firestore.rules` / `scripts/pitch-test.mjs` / `design/DESIGN-SYSTEM.md` のもの。

---

## 0. 現状の事実確認

### 0.1 面の作法と地の色

| 事実 | 出典 |
|---|---|
| ページ地 `--c-bg: #FFFFFF`、沈めた面 `--c-sunk: #F6F7F9`、もう1段 `--c-sunken: #EEF1F4` | `src/index.css:59,66,78` |
| `.surf-card { background: var(--c-sunk); margin-left/right: calc(-1 * var(--page-pad-*)); padding-left/right: var(--page-pad-*) }` | `src/index.css:469-478` |
| `.surf-card .card { background: var(--c-surface); border: 0; border-radius: var(--r-lg); padding: var(--sp-4); box-shadow: var(--shadow-card) }` | `src/index.css:480-486` |
| `.surf-card .rowcard { … box-shadow: var(--shadow-row) }` | `src/index.css:510-516` |
| 計測タブの根は `<div className="surf-rule">`(地は白) | `src/App.jsx:4098` |
| リードタブ Top の return は `.surf-rule`、リード個体詳細の return は `.surf-card` | `src/App.jsx:10006` / `:9988` |
| データタブ(My Data / 分析、セッション詳細、すべてのセッション)の3つの return は3つとも `.surf-card` | `src/App.jsx:14504,14560,14589` |
| コミュニティタブの根は `<div className="surf-card">`(地は `--c-sunk`) | `src/App.jsx:4173` |
| App.jsx のコメントは「§6.6 の表の追記行『コミュニティ(全画面)』で確定」と書いているが、**`design/DESIGN-SYSTEM.md` に「コミュニティ」の語は0件**。追記文面は `design/DESIGN-SYSTEM-community-addendum.md` に「貼り込み待ち」のまま残っている | `src/App.jsx:4159-4164` / `grep -c コミュニティ design/DESIGN-SYSTEM.md` = 0 / addendum 冒頭 |
| コミュニティの画面は `.card` クラスを使わず、`cardStyle` / `rowcardStyle` をインライン(`--c-surface` + `--shadow-card` / `--shadow-row`)で持つ | `src/community/screens.jsx:20-29` |
| 人物紹介(`PersonSheet`)の地は `background: "var(--c-app, #F6F7F9)"`。**`--c-app` は index.css に定義が無い**ので、実際にはフォールバックの `#F6F7F9`(hex 直書き)が効いている | `src/community/screens.jsx:822` / index.css に `--c-app` 0件 |
| `--c-sunk` の他の使い手: My Data のマトリクスの帯と PIVOT の面 | `src/App.jsx:12628, 13108` |
| pitch-test は `.surf-card` の地が `var(--c-sunk)` であることを固定している | `scripts/pitch-test.mjs:6350-6351` |
| pitch-test は `--c-sunk` が `--c-bg` と別の値で、差が 1.0719:1 以上であることを固定している(値ではなく差) | `scripts/pitch-test.mjs:6178-6187` |
| pitch-test は「作法を名乗る根は7箇所(罫2 + カード5)」を固定している | `scripts/pitch-test.mjs:6738-6740` |
| pitch-test は `CommunityTab.jsx` の中に `surf-card` / `surf-rule` の**綴りそのもの**(コメント含む)が無いことを固定している | `scripts/pitch-test.mjs:6788-6791` |
| DESIGN-SYSTEM §1.2 は「My Data と分析タブだけは地を `--c-sunk` へ下げ、その上に白いカードを浮かせる」、§6.6 のカードの節は「ページの地 `--c-sunk`」 | `design/DESIGN-SYSTEM.md:44-46` / `:1462-1468` |
| §1.10 に影のトークン `--shadow-card` / `--shadow-row`(同値・別名) | `design/DESIGN-SYSTEM.md:302-320` |

### 0.2 子タブと横スワイプ

| 事実 | 出典 |
|---|---|
| コミュニティの子タブは4つ `data / rank / share / me`(データ / 順位 / シェア / マイページ) | `src/community/CommunityTab.jsx:69-74` |
| 子タブの見た目は**セグメンテッドコントロール**(溝 `--c-sunken`、選択中だけ白く浮く、minHeight 38)。`margin: "var(--page-pad) var(--page-pad) 0"` と書いてあるが **`--page-pad` は index.css に無い**(あるのは `--page-side-pad` / `--page-pad-left` / `--page-pad-right`。`:211-222`)ので、この margin は無効 | `src/community/CommunityTab.jsx:76-102` |
| 本体は `body()` の if 分岐で1画面だけ描く(切り替えると前の画面はアンマウントされ、絞り込み等の state が消える) | `src/community/CommunityTab.jsx:164-179` |
| 人物紹介は `position: fixed; inset: 0; zIndex: 40` の全画面オーバーレイ。子タブとは別の state `person` で持ち、子タブを切り替えると閉じる | `src/community/screens.jsx:820-822` / `CommunityTab.jsx:107-109, 178, 180-188` |
| App.jsx の子タブ部品は `SubTabs({ items, value, onChange, children })`。見出し型(選択中 `--fs-xl`/600、非選択 `--fs-md`/400、`--c-ink` / `--c-ink-3`)。間隔は `SUBTAB_GAP_PX = 18` を半分ずつ padding にして当たり判定 44 を作る | `src/App.jsx:13285-13286, 13325-13355` |
| 横スワイプ部品は `SwipePager({ index, onIndexChange, bleed, children })`。touch イベント、非パッシブ touchmove、`input, select, textarea, [data-noswipe]` と横スクロール祖先の上では始めない、viewport は `useFillViewportHeight` で画面下端まで伸びる、track は静止時も `transform: translateX(...)` を持つ | `src/App.jsx:272-416`(除外は `:318-320`、transform は `:403-404`) |
| リードタブ: `<SubTabs items=[登録,比較]>` → `<SwipePager index=…>`。データタブ: `<SubTabs items=[My Data,分析]>` → `<SwipePager bleed …>` | `src/App.jsx:10006-10063` / `:14670-14678` |
| App.jsx が export しているのは `IDB_STORE / SESSIONS_STORE / openIdb / buildIdealProfileFromSessions` の4つだけ。`SubTabs` / `SwipePager` は export されていない | `src/App.jsx:2018-2022, 11082` |
| コミュニティ側は既に `import { buildIdealProfileFromSessions } from "../App.jsx"` をしている(App.jsx 側は `lazy()` で読む) | `src/community/CommunityTab.jsx:8` / `src/App.jsx:11` |
| pitch-test の `srcOfFn` は `function ${name}(` の綴りで関数本体を切り出す(`export function` でも見つかる) | `scripts/pitch-test.mjs:80-81` |
| pitch-test は `SwipePager` 本体の綴り(しきい値 20%/60px・端の抵抗 0.35・軸判定・非パッシブ touchmove)を固定している | `scripts/pitch-test.mjs:5563-5581` |
| pitch-test は `SubTabs` の呼び手(ReedsTab / AnalysisLabView)を綴りで固定している。**呼び手が増えることは禁じていない** | `scripts/pitch-test.mjs:9477-9481` |
| §6.3「この作法はアプリ内で1つだけ。『指に追従する』以外の横スワイプを作らない」/「静止時に `transform` を残さない…`position: fixed` の子孫の包含ブロックになり、モーダルの暗幕が画面全体を覆えなくなる」 | `design/DESIGN-SYSTEM.md:1146-1182` |
| コミュニティタブは `topTab === "community" &&` の条件描画。**上部タブを離れるとアンマウントされる**(`key` は無い) | `src/App.jsx:4172-4173` |

### 0.3 公開スイッチ・アカウント削除・目安の公開

| 事実 | 出典 |
|---|---|
| 公開ユーザー一覧は `usePublicUsers()` が**マウント時に1回だけ** `listPublicUsers()`(`getDocs` + `where("isPublic","==",true)` + `limit(50)`)で読む。再読み込みの手段を返していない | `src/community/screens.jsx:180-195` / `src/community/directory.js:28-37` |
| `dir` は `JoinedView` が持つ。子タブを切り替えても JoinedView は残るので再読しない | `src/community/CommunityTab.jsx:112` |
| 公開スイッチは `setProfilePublic(uid, v)`(users doc の `isPublic` だけを `updateDoc`)→ 成功後に `setProfile({...profile, isPublic: v})`。**`dir.users` には触らない** | `src/community/CommunityTab.jsx:303-306` / `src/community/accountRepo.js:41-43` |
| **`ideals` は非公開にしても消えない。** `idealRepo.js:54-58` と `firestore.rules:185-189` は「非公開にしたら ideals から消す(accountRepo の setProfilePublic が取り下げる)」と書いているが、`accountRepo.setProfilePublic` は `updateDoc` 1行だけ。`unpublishIdeal` は `src/community/CommunityTab.jsx:7` / `screens.jsx:8` の import に含まれておらず、呼び手が無い | `src/community/accountRepo.js:41-43` / `src/community/idealRepo.js:19-23, 51-58` / `firestore.rules:185-189` |
| `deleteAccount` は `deleteDoc(users/uid)` → `deleteUser`。**`ideals/{uid}_{saxType}` は消さない** | `src/community/accountRepo.js:61-75` |
| 練習日数(`publishStats`)と目安(`publishMyIdeals`)は `[uid]` 依存の effect でタブを開いたときに1回書く | `src/community/CommunityTab.jsx:142-162` |
| 公開スイッチの説明文: `note="既定は公開です。OFFにすると他の利用者から見えなくなります"` | `src/community/CommunityTab.jsx:954-958` |
| 削除の説明文: 「アカウントを削除すると、サーバー上のプロフィールと匿名アカウントが完全に消えます。この端末に保存されている計測データは消えません。」。確認ダイアログは `window.confirm("アカウントとサーバー上のプロフィールを完全に削除します。この端末の計測データは消えません。よろしいですか？")` | `src/community/CommunityTab.jsx:974-977` / `:908` |
| `buildProfileDoc` が返す doc に `stats` は無い(14キー)。一方 `firestore.rules:19` の `hasAll` は `'stats'` を要求している。`saveProfile` は `setDoc`(merge 無し) | `src/community/profile.js:228-244` / `src/community/profile.test.js:150-170` / `firestore.rules:18-20` / `src/community/accountRepo.js:32-34` |
| Firestore は `getFirestore(app)` の既定(永続キャッシュの設定なし) | `src/community/firebaseClient.js:35` |

### 0.4 音程グラフ・平行移動・目安の重ね方

| 事実 | 出典 |
|---|---|
| コミュニティの折れ線 `LineChart` は縦の範囲を全系列の min/max で決め、目盛線は上下2本だけ。0 の線は無い | `src/community/screens.jsx:544-565` |
| 指標は `spectralCentroidHz / hnrDb / pitchCentsSigned` の3つ | `src/community/screens.jsx:529-533` |
| App.jsx の `NoteAxisLineChart` は `pitchCentsSigned` のとき 0 中心の対称ドメイン。**中央線を引くのは My Data(`myData`)だけ**で、色は `--c-line-strong` 1px の実線 | `src/App.jsx:11648-11671, 11821-11823` |
| DESIGN-SYSTEM §1.8 は「破線のパターン `4 3`。§1.7 の破線系列と**ゼロ基準線**で共通」と書くが、実装の中央線(上記)は実線 | `design/DESIGN-SYSTEM.md:171-172` |
| `selectedIdeal` は `idealProfiles.find((p) => p.id === selectedIdealId) \|\| null` の1行で導き、ref 経由で解析ループにも渡す | `src/App.jsx:3045, 3053, 3066` |
| pitch-test は**その1行の綴り**を固定している(F-76「1本道」) | `scripts/pitch-test.mjs:13279-13280` |
| 目安を読む場所: (a) 解析ループ `getNoteIdeal(selectedIdeal, si)` → `timbreMatchScore(harmNorm, idealHarmNorm, centroid, noteIdeal.centroidHz, hnr, noteIdeal.hnrDb)` | `src/App.jsx:2334-2341, 3577-3591, 3629-3640` |
| (b) 計測タブ: `currentNoteIdeal` → 倍音バーの破線、`MetricCard` の `sub="目安: … dB / Hz"`(音量・重心・HNR) | `src/App.jsx:7218, 8069-8081, 8095-8097` |
| (c) `PhraseTimeline` の比較対象 `getComparisonTarget = (frame) => getNoteIdeal(selectedIdeal, frame.semitoneIndex)` | `src/App.jsx:8568` |
| (d) `NoteAxisLineChart` が `selectedIdeal + idealKey` から `idealByIdx` を作り、破線で重ねる(`IDEAL_LINE_STYLE`)。縦スケールは目安も含めて決める | `src/App.jsx:11616-11622, 11632-11636, 11830-11839` |
| (d) の呼び手は `MetricTabCard`(セッション詳細 / リード個体詳細)だけ。`METRIC_IDEAL_KEYS = { hnrDb, spectralCentroidHz→centroidHz, volumeDb, pitchCentsSigned: null }` | `src/App.jsx:13437-13468, 14380` |
| リード比較(`ReedCompareTab`)は `NoteAxisLineChart` に `selectedIdeal` を**渡していない** | `src/App.jsx:11510-11520` |
| My Data は `selectedIdeal={null}`(N-8)。「目安未設定」の告知だけ残る | `src/App.jsx:14269, 14278-14280` |
| `align.js` の `alignOffset(mine, theirs, metric)` / `medianOf` / `commonNoteKeys` は **指標名を引数に取る汎用関数**(`notes[key][metric]` を読むだけ)。`SHIFTED_METRICS` は公開側の綴り `["spectralCentroidHz","hnrDb"]`、`MIN_COMMON_NOTES = 3`。音量は「写さないことで共有しない」。`align.js` は他のモジュールを import しない(firebase 非依存) | `src/community/align.js:13-43, 67` |
| ローカル綴り ↔ 公開綴りの対応表は `idealDoc.js` の `LOCAL_TO_SHARED`(centroidHz / hnrDb / pitchCentsSigned / harmonicsProfile) | `src/community/idealDoc.js:30-35` |
| 取り込んだ目安は**取り込み時点で**平行移動済みの値を持つ(`buildAdoptedProfile({ aligned, … })`) | `src/community/idealDoc.js:246-284` / `src/App.jsx:4186-4200` |
| 「自分の平均」はコミュニティ側では `buildMyIdeals` が `selectOwnSessions(sessions, t)` → `buildProfile(own, "", 8, tuningHz)` で作る。App.jsx 側の同じ母集団は `myDataOwnSessions(sessions, saxType, dataSax)`(奏者=自分 かつ `s.saxType ?? saxType` が一致) | `src/community/idealRepo.js:78-93` / `src/community/idealDoc.js:183-186` / `src/App.jsx:13252-13254` |

### 0.5 リードの番手

| 事実 | 出典 |
|---|---|
| `REED_STRENGTHS = ["2.0","2.5","3.0","3.5","4.0"]`(文字列)。コメント「番手: 2.0〜4.0を0.5刻み」 | `src/App.jsx:1836-1842` |
| 箱のキーは `${brand}\|${strength}\|${startDate}`、表示名は `${brand} ${strength} #n(...)`。PIVOT の並びは `parseFloat(f.reed.strength)` | `src/App.jsx:1852-1853, 1990, 12286` |
| 追加シートの番手ピル: `REED_STRENGTHS.map` で 12.5px / padding 4px 11px / radius 999 / 選択は `--c-accent` の塗り + `--c-on-accent`。外側の `<button>` が 44 の当たり判定。`flexWrap: "wrap"` | `src/App.jsx:10491-10510` |
| 既定値は `REED_STRENGTHS[2]`(= 3.0)を追加・編集の2箇所で使う | `src/App.jsx:10615, 10634` |
| pitch-test は「番手は5種のまま」(長さ5・`2.0,2.5,3.0,3.5,4.0`)と、`REED_STRENGTHS.map((s) => (` の綴りを固定している | `scripts/pitch-test.mjs:8797-8800` |
| コミュニティのプロフィールのリードは銘柄・型番だけ(「リードは番手を持たない」)。1組は8キー | `src/community/profile.js:195-198, 212` |
| 8キーは `firestore.rules` の4ブロック(`hasAll` / `hasOnly` / 型検査)、`profile.test.js:19` と `icons.test.js:8` の `GEAR_KEYS`(実装から import しない凍結値)、`CommunityTab.jsx:663-679` の `gearEntryToPicks / EMPTY_PICKS / picksToGearEntry` に写されている | `firestore.rules:91-138` / `src/community/profile.test.js:15-19, 524-536` / `src/community/icons.test.js:6-8, 57-75` |
| `firestore.rules` の `create, update` は `request.resource.data`(更新後の doc 全体)に `hasAll` を当てる。`publishStats` と `setProfilePublic` は `updateDoc` | `firestore.rules:18-20` / `src/community/directory.js:47` / `src/community/accountRepo.js:42` |
| 「厚さ」はリード個体詳細の主観評価の軸名として**既に使われている**(総評 / 厚さ / バランス) | `src/App.jsx:11939, 12120` / `scripts/pitch-test.mjs:8747-8750` |

### 0.6 楽器種別の表記

| 事実 | 出典 |
|---|---|
| App.jsx の表示名は `SAX_PRESETS[*].label` の1箇所(`Soprano / Alto / Tenor / Baritone`)。読み手は 7643(計測タブの楽器ボタン)、8150(目安一覧)、8195(`ScrollPicker` の `labelFn`)、12318 / 12336(PIVOT)、14335 / 14368(My Data の楽器セレクタ)、15371(セッション詳細のメタ) | `src/App.jsx:1021-1026` と上記各行 |
| App.jsx に日本語の「アルト」等が出るのは**コメントだけ**(1079, 1102-1103, 1173, 1202, 2905, 3262, 11101, 12244) | grep 結果 |
| コミュニティ側は `SAX_LABELS = { soprano: "Soprano", alto: "Alto", tenor: "Tenor", baritone: "Baritone" }`。読み手は `FilterRow` / Chip / エラー文言(`${SAX_LABELS[t]}の楽器を選んでください` 等)/ `ProfileView` / `PersonSheet` | `src/community/profile.js:15, 175, 204-211` / `screens.jsx:152, 456, 461, 472, 476, 660, 854` / `CommunityTab.jsx:782, 794, 796, 808, 813, 820, 932, 939` |
| 内部値 `"soprano" / "alto" / "tenor" / "baritone"` は `SAX_TYPES`、`firestore.rules:42, 204`、`ideals` の docId `<uid>_<saxType>`、端末内セッションの `saxType`、`usePersistedState("saxType", "alto")`、カタログ(`catalog/gear.js:12-57`)、pitch-test の多数の検査が参照する | `src/community/profile.js:12` / `firestore.rules:42, 204` / `src/community/idealRepo.js:6-8` / `src/App.jsx:2919` / `scripts/pitch-test.mjs:531-...` |
| pitch-test は `SAX_PRESETS` の key が英小文字4つで過不足なく、label が `Soprano / Alto / Tenor / Baritone` であることを固定している | `scripts/pitch-test.mjs:7532-7560` |
| pitch-test 26.1 は `design/canvas/S1.dc.html` の中の `">Alto` の直前の `font-size` を読んで `MY_DATA_SCOPE_FS` と突き合わせる(**モックの綴りに依存**) | `scripts/pitch-test.mjs:14721-14729` |
| `profile.test.js` は「エラー文言はどの楽器種別の話かを言う」で `toContain("Tenor")` | `src/community/profile.test.js:342-345` |
| DESIGN-SYSTEM §6.0 表記の項「サックス種別は英語表記（Alto / Tenor / Soprano / Baritone）」 | `design/DESIGN-SYSTEM.md:975` |
| カタログの型番に `"Vintage Reborn Alto"` がある(製品名) | `src/community/catalog/gear.js:43` |

### 0.7 シェア画面の横幅

| 事実 | 出典 |
|---|---|
| 4画面共通の `pageStyle = { padding: "var(--sp-4)", display: "grid", gap: "var(--sp-4)" }`。**`gridTemplateColumns` を指定していない** | `src/community/screens.jsx:15` / `CommunityTab.jsx:323` |
| 凡例の行は `flex` + `minWidth: 0` + `ellipsis` を付けてあるが、それを包むカードは pageStyle の grid の子 | `src/community/screens.jsx:414-436, 464-474, 497-503` |
| 同じファイルに「`1fr` の最小値は auto なので…格子が画面より広くなる…`minmax(0, 1fr)` にすると…はみ出しがページに伝播しない」という**同種の事故の記録**がある(アイコン格子) | `src/community/CommunityTab.jsx:500-507` |
| **実測(本設計で行った)**: 375px 幅・`.root{padding:14px}` の中に、pageStyle と同じ構造(grid → card → flex[svg120 + 凡例(minWidth 0, ellipsis)])を置き、長い型番 1 行を入れると、**カード幅 619.7px / grid の scrollWidth 636px**(clientWidth 347)。`grid-template-columns: minmax(0, 1fr)` を足すと **カード幅 315px / scrollWidth 347px** で文字は 93.8px に省略された | 本設計時に Browser pane(`wind-tone-lab.vercel.app` の DOM に一時挿入)で計測 |

### 0.8 シェア / データ画面の楽器種別

| 事実 | 出典 |
|---|---|
| 条件行 `FilterRow` は 楽器 × ジャンル × 属性。各ピルは `<option value={ANY}>{label}（すべて）</option>` を先頭に持つ | `src/community/screens.jsx:113-159`(ANY の option は `:127`) |
| `ShareScreen` は `filter.saxType` を常に `ANY` に固定し、別 state `saxType`(既定 `"alto"`)を `Chip` 4つで選ぶ。`ShareScreen` に `saxTypes` は渡されていない | `src/community/screens.jsx:438-458` / `CommunityTab.jsx:171` |
| `DataScreen` も同じ形。既定は `saxTypes[0] ?? "alto"` | `src/community/screens.jsx:602-606, 656-662` |
| `tallyGear(users, saxType)` / `tallyCombos(users, saxType, depth)` は `u.gear[saxType]` を読む。**種別1つが前提** | `src/community/aggregate.js:80-87, 116-123` |

### 0.9 人気の組み合わせ

| 事実 | 出典 |
|---|---|
| `COMBO_SLOTS = { 2: [mouthpiece, reed], 3: [instrument, mouthpiece, reed], 4: [instrument, mouthpiece, ligature, reed] }` | `src/community/aggregate.js:110-114` |
| 画面は `Chip` 3つ(`{d}項目`)+ その下に `COMBO_SLOTS[depth].map(SLOT_LABEL).join(" × ")` の注記1行 | `src/community/screens.jsx:480-489` |
| `Chip` は当たり判定 44 / 見えるピル 30(A型) | `src/community/screens.jsx:69-94` |
| App.jsx に `role="radio"` / `radiogroup` / `type="radio"` は0件。**縦に並ぶ単一選択**の既存の形は (a) 計測タブの目安一覧(`.ctl-state` の行、`aria-pressed`、選択中は枠と文字が `--c-accent`)、(b) `DataOptionSheet`(シートの中の 44px の行、選択中は `--c-accent` 600、行間に `--c-line`) | `src/App.jsx:8121-8156` / `:13535-13560` / `src/index.css:644` |

### 0.10 語彙

| 事実 | 出典 |
|---|---|
| 利用者に見える「機材」: `この人はまだ機材も目安も公開していません` / 見出し `機材` / `この楽器の機材は登録されていません` | `src/community/screens.jsx:849, 858, 866` |
| 「機種変更」(端末の機種)は未参加の説明文にある。楽器の話ではない | `src/community/CommunityTab.jsx:376` |
| App.jsx のコメントに「全機種共通」「各機種の移調量」「機材・部屋」「他機種のデータ」 | `src/App.jsx:1100-1101, 1381, 12330, 14430` |
| 識別子: Firestore のキー `gear`(rules `:75-77`)、`catalog/gear.js`、`GEAR_SLOTS / tallyGear / gearKey`(aggregate.js)、`gearPicks / GearPicker / gearLabel / gearEntryToPicks / picksToGearEntry`(CommunityTab.jsx)、`GearLine / gearLabelOf`(screens.jsx) | 各ファイル |
| コメント中の「機材」: profile.js 13, 123-131, 177-179 / aggregate.js 5, 53-56, 69, 77 / CommunityTab.jsx 30, 328, 565, 656-658, 692-696, 714-717, 818, 933 / screens.jsx 373, 604, 743, 762 / profile.test.js・icons.test.js の describe 名 | grep 結果 |

---

## 1. 公開スイッチをその場で反映する

- **いま**: §0.3。`onTogglePublic` は users doc の `isPublic` を書いて `profile` state を更新するだけ(`CommunityTab.jsx:303-306`)。`dir.users` は `usePublicUsers` がマウント時に1回読んだ配列のまま(`screens.jsx:180-195`)。したがって**同じタブに居る間**は、OFF にしても順位・データ画面に自分が出続け、ON に戻しても出てこない。上部タブを離れて戻ると `CommunityTab` ごとアンマウント → 再マウントで読み直す(`App.jsx:4172`)。
  - **未確認**: 本人は「アプリを再起動するまで」と言っているが、コードの読みでは上部タブの往復で直るはず。実機で「他の上部タブへ行って戻る」を試しても直らないなら、原因は別(Firestore の応答キャッシュ等)で、本設計の範囲外。§17 で確認手順を書く。
  - さらに、**目安(`ideals`)は非公開にしても消えず**(`accountRepo.js:41-43`)、ルール側のコメント(`firestore.rules:185-189`)と食い違っている。`joinOwners` が非公開の人を落とすので画面には出ないが、`ideals/{uid}_{t}` に音のデータが残る。

- **こうする**:
  1. `usePublicUsers()` の戻りに `setUsers`(関数)を足す。`JoinedView` の公開切替を次の1関数に集約する:
     ```
     onTogglePublic(v):
       await setProfilePublic(uid, v)                 // users.isPublic
       if (!v) await unpublishAllIdeals(uid)          // ideals/{uid}_{t} を SAX_TYPES ぶん deleteDoc(無ければ no-op)
       else    await publishMyIdeals(uid, myIdeals)   // 公開に戻したら目安も出し直す(既存関数)
       setProfile({...profile, isPublic: v})
       setUsers(prev => v ? upsert(prev, { uid, ...profile, stats: 既存の自分の行の stats ?? computePracticeStats(sessions) })
                          : prev.filter(u => u.uid !== uid))
       ideals も同様にローカルで差し引き(setIdeals)
     ```
     順序は「OFF: users を書く → ideals を消す」「ON: users を書く → ideals を出す」。途中で失敗した場合、OFF なら `users.isPublic=false` が先に立っているので `ideals` の `get` は所有者の公開状態で塞がれ(`firestore.rules:182-183`)、`list` は `joinOwners` が落とす ── 読まれる経路は無い。ON で目安の出し直しに失敗しても「公開だが目安が無い」だけで、次回タブを開いたときの effect(`CommunityTab.jsx:142-162`)が出し直す。
  2. `accountRepo.js` に `unpublishAllIdeals(uid)` を置かず、`idealRepo.js` に置く(`unpublishIdeal` の隣。コレクションごとにファイルが分かれている現状に合わせる)。`accountRepo.setProfilePublic` は users だけを書く1行のまま。**呼び順は画面側(JoinedView)が持つ**(コメント `idealRepo.js:54-58` / `firestore.rules:185-189` の「accountRepo が取り下げる」は事実と違うので書き換える)。
  3. **サーバへは書き直すが、読み直さない**(`getDocs` を再発行しない)。他人の変更まで即時に追う必要は無く、読み取り回数は費用(`directory.js:13-17`)。自分の行だけローカルで差し引く。

- **触るファイル**: `src/community/screens.jsx`(`usePublicUsers`)、`src/community/CommunityTab.jsx`(`JoinedView` / `CommunityTabBody`)、`src/community/idealRepo.js`(`unpublishAllIdeals`)、`firestore.rules:185-189`(コメントのみ)。
- **波及**: 項目12(削除でも `ideals` を消す)。`JoinedView` の `[uid]` effect で `publishMyIdeals` を呼ぶ条件に `profile.isPublic !== false` を足す(非公開の人がタブを開くたびに目安を出し直してしまうため。**今もそうなっている**: `CommunityTab.jsx:153-157` は公開状態を見ていない)。
- **落とし穴**: (a) ON に戻すとき `dir.users` に足す自分の行に `stats` が無いと順位に出ない(`rankByPractice` は `u.stats` を要求。`aggregate.js:26-27`)。旧配列の自分の行を捨てずに取っておくか、`computePracticeStats(sessions)` で作る。(b) `profile` は `buildProfileDoc` の doc なので `uid` を持たない。行に `uid` を足すこと。(c) §0.3 最終行: **`buildProfileDoc` の doc に `stats` が無いのに rules は `hasAll` で `stats` を要求している**。初回 `setDoc` がリポジトリのルールでは弾かれるはず。§15 参照。

## 2. My Data とコミュニティの地を計測・リードに揃える

- **いま**: §0.1。計測タブ Top・リードタブ Top は `.surf-rule`(地 `--c-bg` 白)。My Data・分析・セッション詳細・すべてのセッション・リード個体詳細・コミュニティは `.surf-card`(地 `--c-sunk` #F6F7F9、白いカードを影で浮かせる)。

- **こうする**: **`.surf-card` の地を `--c-bg` にする**(index.css:470 の1宣言)。カードは `--c-surface` + `--shadow-card` のまま。つまり「カードの作法」の定義を「薄い地 + 白いカード + 影」から「**白い地 + 白いカード + 影**」へ変える。カードの浮きは影だけが担う。
  - 変える宣言は `background: var(--c-sunk)` → `background: var(--c-bg)` の**1行**。`margin-left/right` / `padding-left/right`(地を画面端まで届かせる式)は残す ── 白同士なので見た目には効かないが、`.surf-card` が「作法の根」である構造(`.surf-card .card` の詳細度)は変えない。
  - `.surf-card` を名乗る根は7箇所(§0.1)そのまま。My Data だけでなく、本人が名指ししていない分析・セッション詳細・すべてのセッション・リード個体詳細も一緒に白くなる。**これは意図した波及**: 作法は index.css の1箇所が持ち、画面ごとに地を分けると「作法が3つ」になる(§6.6 が禁じる入れ子と同じ壊れ方)。本人の言葉「計測タブもリードタブも背景色使われてないでしょ」(D-7)とも整合する。
  - コミュニティのインライン `cardStyle` / `rowcardStyle`(`screens.jsx:20-29`)は値がトークンのままなので**変更なし**。
  - `PersonSheet` の地 `var(--c-app, #F6F7F9)` → `var(--c-bg)`(`screens.jsx:822`)。hex 直書きと未定義トークンをここで消す。
  - **影の強さ**: `--shadow-card` = `0 1px 2px rgba(18,31,50,.04), 0 6px 16px rgba(18,31,50,.06)`(§1.10)。白地の上でカードの縁が読めるかは**実機でしか判定できない**(§17)。足りなければ**枠線を足さず**(§6.7: 枠線は状態を持つものだけ)、`--shadow-card` / `--shadow-row` のアルファを1段上げる。§1.10 は「役割が違うので名前を分けてあり、片方だけ調整できる」と書いているので、トークンの値を変えるのは体系内の手。**新しい色・枠を発明しない。**
  - `--c-sunk` トークンは残す(App.jsx:12628, 13108 の使い手がある)。pitch-test 6178-6187 の「地と別の値」「差 1.0719 以上」も残る。

- **触るファイル**: `src/index.css:470`(+ コメント 52-58, 362-364, 446-468)、`src/community/screens.jsx:822`、`scripts/pitch-test.mjs:6350-6351`(期待値を `var(--c-bg)` へ)、`design/DESIGN-SYSTEM.md`(§1.2 :44-46 / §6.6 :1315-1332, 1462-1468 / §1.10 :304-308)、`src/App.jsx` のコメント(9983-9987「薄い地 --c-sunk」、4159-4164)。
- **波及**: 規約の書き換え(争点A)。`design/DESIGN-SYSTEM-community-addendum.md` の「§6.6 の表へ1行」を**この機会に貼り込む**(App.jsx のコメントが「貼り込み済み」と嘘を書いている状態を直す)。addendum は貼り込み後に削除(addendum 自身の指示)。
- **落とし穴**: (a) pitch-test 6456-6458 は `.surf-card` が `background` を**宣言していること**を見るので、宣言を消してはいけない(値を変えるだけ)。(b) `.surf-card .card.card-accent`(累計カードの濃紺)は地だけを変える規則なので影響なし。(c) index.css 末尾に `.surf-card { background: … }` を追記して上書きする形は禁止(§6.6 作法に共通)。**470行目の値を書き換える。**

## 3. コミュニティの子タブを計測/リード/My Data と同じ方式にし、横スワイプで行き来する

- **いま**: §0.2。セグメンテッドコントロール + `body()` の分岐で1画面ずつ描く。計測タブには子タブが無く、「同じ方式」の実体は**リードタブ・データタブの `SubTabs`(見出し型) + `SwipePager`**。

- **こうする**:
  1. App.jsx の `SubTabs` と `SwipePager` を **`export`** する(`buildIdealProfileFromSessions` と同じ手。新しいファイルへ切り出さない ── pitch-test が `srcOfFn(src, "SwipePager")` で App.jsx から本体を切り出しているため、移すと 5563-5581 が全滅する)。
  2. `CommunityTab.jsx` の `SubTabs`(セグメンテッド)を削除し、`JoinedView` を次の形にする:
     ```
     <SubTabs items={SUB_TABS} value={tab} onChange={(k) => { setPerson(null); setTab(k); }} />
     <SwipePager index={SUB_TABS.findIndex(t => t.key === tab)} onIndexChange={(i) => { setPerson(null); setTab(SUB_TABS[i].key); }}>
       <DataScreen … />   // 順は SUB_TABS の配列順(データ / 順位 / シェア / マイページ)
       <RankScreen … />
       <ShareScreen … />
       <ProfileView … />
     </SwipePager>
     {person ? <PersonSheet … /> : null}   // ← SwipePager の**外**(兄弟)に置く
     ```
     `bleed` は渡さない(コミュニティのカードは左右の余白を食い破らない)。
  3. 各ページの中の読み込み中/エラー表示(`dir.phase`, `ideals === null`)は**ページごと**に出す(4ページが同時にマウントされるので、`body()` の早期 return は使えない)。
  4. 見出し型 `SubTabs` の文字: 選択中 `--fs-xl`(22px)/600、非選択 `--fs-md`(15px)/400。4項目「データ 順位 シェア マイページ」の幅は、選択中が最長の「マイページ」(5字×22=110px)でも 110 + (45+30+45) + padding 9×8 = 302px < 343px(375px 端末の本文幅)。**折り返さない。未確認: 実機の書体での実寸**(§17)。
  5. `SubTabs` の左右余白: リードタブは `REED_LIST_EXTRA_PAD_PX` を足した div の中、データタブは `maxWidth: 900` の div の中に置いている。コミュニティは `.surf-card` の根(`.app-root` の padding 14px)の直下に置く。`pageStyle` の `padding: var(--sp-4)` は各ページが持つので、子タブ行だけ 14px、中身は 14+16=30px と揃わない。**子タブ行を `padding: 0 var(--sp-4)` の div で包む**(データタブと同じく「行の位置は本文の左端に揃える」)。
  6. `SUB_TABS` の並びは今のまま(data / rank / share / me)。既定は `data`。

- **触るファイル**: `src/App.jsx:272, 13325`(export の2語)、`src/community/CommunityTab.jsx`(`SubTabs` 削除、`JoinedView` 書き換え)、`scripts/pitch-test.mjs`(6788-6791 は綴り検査なので `SwipePager` / `SubTabs` の語は通る。**「作法を名乗る根は7箇所」は変わらない**)。
- **波及**: 各画面の state(絞り込み・期間・指標)が**子タブをまたいで保持される**ようになる(今は切り替えるたびに捨てている)。これは改善だが、`ShareScreen` / `DataScreen` の `saxType` の既定値(項目10)が「マウント時に1回」決まる点は変わらないので、プロフィール編集で楽器を変えても既定は追従しない ── 今と同じ。`PersonSheet` を `SwipePager` の中に入れると `position: fixed` が track の `transform` に捕まって画面を覆えない(§6.3。`App.jsx:403-404` は静止時も transform を持つ)。**必ず外に置く。**
- **落とし穴**: (a) `SwipePager` は `input, select, textarea` の上ではジェスチャーを始めない(`App.jsx:318-320`)。`FilterPill` は透明な `<select>` を全面に重ねているので、条件行の上から始めたスワイプは効かない。My Data の楽器セレクタと同じ挙動なので受け入れる。(b) `SwipePager` の viewport は `useFillViewportHeight` で画面下端まで伸びる。`.app-root` の `padding-bottom: var(--page-bottom-gap)` が下部ナビの逃げを持つ(App.jsx:4165-4167 のコメント)ので、二重に足さない。(c) `srcOfFn` は `function SubTabs(` を最初に見つけた位置から切る。App.jsx に `function SubTabs(` は1つだけ(13325)なので、CommunityTab.jsx 側の同名関数を**消す**こと(残すと import 名が衝突する)。

## 4. コミュニティの音程グラフに ±0 の線を足す

- **いま**: §0.4。`LineChart` は min/max の2本の目盛線だけ。音程(`pitchCentsSigned`)も他と同じ扱いで、0 が枠内に無いことすらある。
- **こうする**: `LineChart` に `centerAt`(値)を受け口として足し、`DataScreen` / `PersonSheet` は `m.key === "pitchCentsSigned" ? 0 : null` を渡す。
  - `centerAt !== null` のとき: ドメインを中央値の周りで**対称**にする(`half = max|v − center|`、`hi = center + half`、`lo = center − half`。全値が 0 のときは `half = 1`)。目盛は `hi / center / lo` の3本(数値ラベルも3つ)。
  - 中央線: `stroke: var(--c-line-strong)` / 1px / **実線**。App.jsx の My Data の中央線(`:11821-11823`)と同じ。**§1.8 の「ゼロ基準線は破線 4 3」は実装(D-9u)と食い違っている**ので、規約のその1文を「ゼロ基準線(中央線)は `--c-line-strong` 1px の実線(D-9u)。破線 `4 3` は §1.7 の破線系列のもの」に直す。
  - 上下の目盛線(`--c-line`)は今のまま残す(コミュニティは My Data の文法ではない。App.jsx の他3画面と同じく上下の線あり)。
  - 重心・HNR は変えない(`centerAt = null`)。
- **触るファイル**: `src/community/screens.jsx:544-587`(`LineChart`)、`:682, 881`(呼び手)、`design/DESIGN-SYSTEM.md:171-172`。
- **波及**: なし(App.jsx の `NoteAxisLineChart` は既に同じ形を持つ)。
- **落とし穴**: 対称ドメインにすると、片側に偏ったデータでは線が上半分(または下半分)に寄る。それは「0 からどれだけ外れているか」を読む画面の性質なので受け入れる(App.jsx の平均差分と同じ)。

## 5. リードの番手を 2〜4 の 0.25 刻みにし、コミュニティのプロフィールにも持たせる

- **いま**: §0.5。アプリ本体は 0.5 刻み5種。コミュニティのプロフィールのリードは銘柄・型番だけ。
- **こうする**:
  1. **アプリ本体** `REED_STRENGTHS = ["2.0","2.25","2.5","2.75","3.0","3.25","3.5","3.75","4.0"]`(9種・文字列)。既存の5値はそのまま含まれるので、**保存済みの箱(`strength` 文字列)は1件も書き換えない**(`reedGroupKey` の文字列一致も保たれる)。既定値 `REED_STRENGTHS[2]` は「2.5」になってしまうので **`REED_STRENGTHS[4]`(3.0)** に直す(10615, 10634 の2箇所。「初期値3.0」のコメントが正)。ピル行は `flexWrap: "wrap"` 済みなので9個は2段に折り返す(実寸は §17)。PIVOT の `parseFloat` は "2.25" を正しく読む。
  2. **コミュニティ**: `gear[t]` に **`reedStrength`**(文字列。`REED_STRENGTHS` の1つ)を足して**9キー**にする。
     - 画面(`ProfileForm`): リードの `GearPicker` の直下に番手のピル行を置く。**見た目は App.jsx:10491-10510 の番手ピルと同じ値**(12.5px / padding 4px 11px / radius 999 / 選択は `--c-accent` の塗り + `--c-on-accent` / 非選択は枠 `--c-line-strong`、外側 44 の当たり判定)。同じ機能は現行に揃える(本人の方針)。実装は App.jsx のピル行を `ReedStrengthPills({ value, onChange })` として関数に切り出し `export`、追加シート・箱の編集・プロフィールの3箇所から呼ぶ(**綴りを2箇所に持たない**)。`REED_STRENGTHS` も export する。
     - 必須(2026-09-02 の本人裁定「未選択のまま登録させない」に揃える)。未選択なら `${SAX_LABELS[t]}のリードの番手を選んでください`。
     - **語は「番手」**。本人は依頼で「厚さ」と書いたが、アプリ内で「厚さ」はリード個体詳細の主観評価の軸名(§0.5 最終行)として既に使われており、同じ画面群で2つの意味になる。番手はアプリの既存語(`App.jsx:1836, 10495`)。
     - 表示: `ProfileView` の「リード」行と `PersonSheet` の `GearLine` に `Vandoren Traditional 3.0` の形で番手を続ける(`gearLabel` / `GearLine` の末尾に付ける)。**番手の数字は `--font-num`**(§4.3: 数値)。
     - `firestore.rules`: 4ブロックの `hasOnly` に `'reedStrength'` を足す。**`hasAll` には足さない**(後方互換。下記)。型検査は `(reedStrength == null || reedStrength in ['2.0','2.25',…,'4.0'])`(列挙で固定。自由文の入口を作らない)。
     - `buildProfileDoc`: `reedStrength` が `REED_STRENGTHS` に無ければエラー。doc には必ず入れる。
     - 集計(`tallyGear` / `tallyCombos`)の鍵は**銘柄+型番のまま**(番手を鍵に混ぜない)。§15-1 参照。
- **触るファイル**: `src/App.jsx:1842, 10491-10510, 10615, 10634`、`src/community/profile.js:195-212`(+ `REED_STRENGTHS` を import するか、`profile.js` 側に列挙を持って App.jsx がそれを読むか ── **`profile.js` に置き、App.jsx が import する**。理由: `firestore.rules` の列挙との同期検査は `profile.test.js` にあり、そこが読める場所に正を置く)、`src/community/CommunityTab.jsx:663-679, 817-823, 943`、`src/community/screens.jsx:748-758, 864`、`firestore.rules:91-138`、`src/community/profile.test.js:15-19, 524-536`、`src/community/icons.test.js:8, 65-75`、`scripts/pitch-test.mjs:8797-8800`(9種へ)。
- **波及**: (a) `REED_STRENGTHS` の正が `profile.js` へ移るなら、pitch-test の `extractConst("REED_STRENGTHS")`(`:323`)は App.jsx から定数を切り出せなくなる → その検査を「`profile.js` から import した配列が9種」に書き換える。App.jsx 側に `const REED_STRENGTHS = [...]` を残して二重に持つほうが pitch-test には楽だが、**綴りを2箇所に持たない**ほうを取る。(b) `icons.test.js:57-75` の「機材の欄を1つ足すとき直す場所は3つ」が今回まさに当たる: `gearEntryToPicks` / `EMPTY_PICKS` / `picksToGearEntry` の3箇所に `reedStrength` を足す(`picks.reed` を `{ brand, model, strength }` にするか、`picks.reedStrength` を並べるか ── **`EMPTY_PICKS` に `reedStrength: null` を並べる**。`GearPicker` の `value` の形を変えない)。(c) `ProfileView` の `Row` / `PersonSheet` の `GearLine` の表示。
- **落とし穴**: **`hasAll` に足すと、既存の利用者の `updateDoc`(公開スイッチ・練習日数)が全部失敗する。** rules の `create, update` は更新後の doc 全体に `hasAll` を当てる(§0.5)ので、`reedStrength` を持たない旧 doc への `updateDoc({isPublic})` は「更新後の doc に `reedStrength` が無い」で弾かれる。プロフィールを保存し直すまで公開スイッチも順位も止まる。**必ず `hasOnly` だけに足し、null を許す**(`firestore.rules:62-69` の「ルールは上位集合のまま置く」の方針そのもの)。読む側は `reedStrength` が無い/null の doc を「番手なし」として扱う(表示は銘柄・型番だけ)。

## 6. 人気の組み合わせ: 「n項目」をやめ、中身を出して選ぶ

- **いま**: §0.9。`Chip` 3つ(「2項目 / 3項目 / 4項目」)+ 注記1行。
- **こうする**: **縦並びの単一選択リスト**(3行)。各行は「マウスピース × リード」「楽器 × マウスピース × リード」「楽器 × マウスピース × リガチャー × リード」。注記の行は消す(行そのものがラベル)。
  - 形: 計測タブの目安一覧(`App.jsx:8121-8156`)と同じ **A型の行**。`role="radiogroup"` の中に `role="radio"` の `<button>` 3つ。外側 `<button>` は `minHeight: var(--tap-min)`(44)・`padding: 0`・地なし。中の見えるボックスは `minHeight: 36` / `padding: 0 12px` / `borderRadius: var(--r-sm)` / `border: 1px solid var(--c-line-strong)`、選択中は枠と文字が `var(--c-accent)`、非選択は文字 `var(--c-ink-2)`、`fontSize: var(--fs-sm)` / 600、左寄せ。行の縦 gap は 0(44−36 = 8px が見た目の間隔になる。`PillGroup` と同じ理屈 `CommunityTab.jsx:403-405`)。
  - 「×」の前後は半角スペース1つ。`white-space: nowrap` は付けない(最長行「楽器 × マウスピース × リガチャー × リード」は 13px で約 230px。343 − 32(カード) − 24(ボックスの padding) = 287px に収まる。**未確認: 実機書体の実寸**)。
- **触るファイル**: `src/community/screens.jsx:480-489`。`Chip` は他の呼び手(期間・人物紹介の種別)が残るので削除しない。
- **波及**: `aggregate.js` の `COMBO_SLOTS` / `SLOT_LABEL` は変えない(ラベルは `COMBO_SLOTS[d].map(SLOT_LABEL).join(" × ")` で今と同じ式から作る)。
- **落とし穴**: `aria-label` に「2項目」の語を残さない(読み上げも中身で言う)。

## 7. 楽器種別の表記を S.Sax / A.Sax / T.Sax / B.Sax にする

- **いま**: §0.6。表示名は App.jsx の `SAX_PRESETS[*].label` と `profile.js` の `SAX_LABELS` の**2箇所**(綴りは同じ4語)。内部値は英小文字。
- **こうする**: **ラベルだけ**を変える。内部値 `"soprano" / "alto" / "tenor" / "baritone"` は1文字も変えない(争点D)。
  - `src/App.jsx:1023-1026` の `label` → `"S.Sax" / "A.Sax" / "T.Sax" / "B.Sax"`。
  - `src/community/profile.js:15` の `SAX_LABELS` → 同じ4語。
  - 表記のピリオドは半角 `.`。前後にスペース無し。
  - 2箇所を1箇所にしない。App.jsx の `SAX_PRESETS` は音響パラメータの表で、`profile.js` はカタログ側の正。**ただし同じ4語であることを `profile.test.js` で固定する**(App.jsx を import せず、`SAX_PRESETS` の綴りを正規表現で読む ── pitch-test の `extractConst` と同じ手)。
- **触るファイル**: `src/App.jsx:1023-1026`、`src/community/profile.js:15`、`scripts/pitch-test.mjs:7532, 7556`(期待値の表を新4語へ)、`src/community/profile.test.js:344`(`"Tenor"` → `"T.Sax"`)、`design/DESIGN-SYSTEM.md:975`、コメント: `src/community/CommunityTab.jsx:399`(`表示 "Alto"`)、`src/community/idealDoc.js:11`(「Alto の平均」)、`firestore.rules:201`(「Alto の平均」)。
- **波及**: (a) 幅が縮む方向(`Baritone` 8字 → `B.Sax` 5字)なので、計測タブの楽器ボタン(7643)、My Data の `A.Sax ▾`(14335)、`ScrollPicker`、セッション詳細のメタ(15371)、PIVOT の楽器列(12318)、コミュニティの Chip / 条件ピルは全部そのまま入る。(b) `design/canvas/*.dc.html` の「Alto」は**触らない**。pitch-test 26.1(`:14721-14729`)が S1.dc.html の `">Alto` を目印に読んでいるので、モックを直すとその検査が空回りする。モックは本人がキャンバスで決めた時点の記録であり、表記の変更で書き換える対象ではない。(c) カタログの `"Vintage Reborn Alto"` は製品名なので触らない。(d) BACKLOG / 過去の設計書の「Alto」は記録なので触らない。
- **落とし穴**: `SAX_PRESETS` の `label` を機械置換するとき `"Alto"` を含む製品名(gear.js:43)やコメントを巻き込まないこと。置換対象は上の2箇所と検査だけ。

## 8. 「揃えて線の形で比較」をコミュニティ以外にも採用する

- **いま**: §0.4。App.jsx は目安(`selectedIdeal`)の値を**そのまま**使う: 解析ループの音色一致度、計測タブの「目安: n Hz」、`PhraseTimeline` の比較対象、セッション詳細・リード個体詳細の破線。コミュニティだけが `alignProfile`(共通音の中央値を合わせる平行移動)を持つ。
- **本人の言葉の解釈**: 「自分の平均に、目安に設定しているものが揃えられる」= **動かすのは目安の側**、基準は**自分の平均**(コミュニティの `buildMyIdeals` と同じ「奏者=自分 かつ その楽器種別」のセッション全部の平均)。差を取る指標は重心・HNR・音量(本人が名指し)。ピッチは環境非依存、倍音構成は音の中の比率なので動かさない(`align.js:12-15` の理由がそのまま当たる)。
- **こうする**:
  1. `src/community/align.js` に **ローカル綴りの定数** `LOCAL_SHIFTED_METRICS = ["centroidHz", "hnrDb", "volumeDb"]` と、`alignIdealToMine(ideal, mine)` を足す(既存の `alignOffset` / `medianOf` は指標名を引数に取る汎用関数なのでそのまま使える)。
     ```
     alignIdealToMine(ideal, mine):
       if (!ideal) return null
       shiftedBy = {}
       for m of LOCAL_SHIFTED_METRICS:
         off = alignOffset(mine, ideal, m)      // 共通音 3 未満なら null
         if (off !== null) shiftedBy[m] = off
       if (Object.keys(shiftedBy).length === 0) return ideal   // 動かせないときは**そのまま**
       notes = ideal.notes を写し、各音の m に shiftedBy[m] を足す(他の項目は写すだけ)
       return { ...ideal, notes, alignedTo: shiftedBy }
     ```
     **コミュニティと違い、合わせられないときに描かない・エラーにしない。** 端末内の目安は (a) 自分の録音から作ったもの(環境がほぼ同じ)か、(b) 取り込み時点で平行移動済みのもの(`buildAdoptedProfile`)なので、動かせなくても絶対値の比較が意味を持つ。
  2. `src/App.jsx:3045` を次にする:
     ```
     const selectedIdealRaw = idealProfiles.find((p) => p.id === selectedIdealId) || null;
     const myAverageForIdeal = useMemo(() => {
       if (!selectedIdealRaw) return null;
       const t = selectedIdealRaw.saxType ?? saxType;
       const own = myDataOwnSessions(sessions, saxType, t);
       return own.length ? buildIdealProfileFromSessions(own, "", NUM_HARMONICS, effectiveTuningHz) : null;
     }, [selectedIdealRaw, sessions, saxType, effectiveTuningHz]);
     const selectedIdeal = useMemo(() => alignIdealToMine(selectedIdealRaw, myAverageForIdeal), [selectedIdealRaw, myAverageForIdeal]);
     ```
     **下流は1箇所も変えない。** `selectedIdealRef`、`MeasureView`、`ReedsTab`、`AnalysisLabView`、`MetricTabCard`、`PhraseTimeline` は今までどおり `selectedIdeal` を受ける。したがって**動く画面とグラフ**は次のとおり:
     | 画面 | 何が変わるか |
     |---|---|
     | 計測タブ(録音中) | 音色一致度(`timbreMatchScore` の `noteIdeal.centroidHz / hnrDb`)、`MetricCard` の「目安: n dB / n Hz」(音量・重心・HNR)、`PhraseTimeline` の比較対象 |
     | セッション詳細 `MetricTabCard` | HNR・重心・音量の破線(平均差分は `idealKey: null` なので元から描かない) |
     | リード個体詳細 `MetricTabCard` | 同上 |
     | リード比較 | 変わらない(目安を渡していない) |
     | My Data | 変わらない(N-8 で目安を描かない) |
     | 倍音バー(計測タブ) | 変わらない(`harmonicsProfile` は動かさない) |
     | 目安の一覧・「目安に設定」・削除 | 変わらない(id で見る。`idealProfiles` には生の値を保存したまま。**平行移動は表示時だけで、保存しない**) |
  3. `myDataOwnSessions` は `App.jsx:13252` にある既存関数を使う(母集団の規則を2箇所に写さない)。`buildIdealProfileFromSessions` は既に export 済みの同じ関数。
  4. **音量も動かす。** 音量(dB)はマイク距離と入力ゲインで一律にずれる、という点で重心・HNR と同じ性質。コミュニティが音量を**共有しない**のは「他人の環境の絶対値に意味が無い」からで(`idealDoc.js:60-63, 204-206`)、自分の端末の中で日をまたいだ自分の目安と合わせるのは別の話。本人が「HNR・重心・音量」と名指ししている。取り込んだ目安には音量が無いので、そのときは音量の項は空のまま(`alignOffset` が null を返して動かさない)。

- **触るファイル**: `src/community/align.js`(追記)、`src/App.jsx:3045`(+ import `alignIdealToMine`)、`scripts/pitch-test.mjs:13279-13280`(F-76 の綴り検査。`const selectedIdealRaw = idealProfiles.find(...) || null;` に更新し、「`alignIdealToMine(null, …)` は null を返す」を純関数として足す ── 「解除は selectedIdeal を null にすることで伝わる」という検査の意図を保つ)、`src/community/align.test.js`(追記)。
- **波及**: (a) `App.jsx` が `./community/align.js` を静的 import する。`align.js` は import を持たない純粋なモジュールなので、コミュニティ(firebase)を計測タブに引き込まない。(b) 計測タブの「目安: 1234 Hz」の数字が、目安一覧で選んだ生の値と一致しなくなる。生の値を画面に出す場所は無い(目安一覧は名前だけ)ので矛盾は見えない。(c) コミュニティの `PersonSheet` の注記「計測環境により値全体が一律にずれるため、揃えた状態で線の形で比較しています」を App.jsx 側にも置くかは**置かない**(本人は説明を削る方針。§6.0 原則1)。
- **落とし穴**: (a) `buildIdealProfileFromSessions` は全フレームを音ごとに集計するので、`sessions` が大きいと重い。`useMemo` の依存を `[selectedIdealRaw, sessions, saxType, effectiveTuningHz]` に閉じ、`selectedIdealRaw` が null のときは計算しない。(b) 解析ループは `selectedIdealRef.current` を読む(`App.jsx:3053, 3066`)。`selectedIdeal` の参照が変わるたびに ref を更新する既存の effect がそのまま効く。(c) 目安が自分のセッションの一部から作られているとき、自分の平均との差は小さいが 0 ではない ── 線がわずかに動く。それが仕様(「揃える」)。(d) `alignedTo` を doc に足しても IndexedDB へは書かない(`idealProfiles` は `selectedIdealRaw` の側)。

## 9. シェア画面の凡例が長いと画面の横幅が広がる

- **いま**: §0.7。`pageStyle` の grid に列テンプレートが無く、grid の子(カード)の `min-width: auto` が中身の最小幅(= 凡例の長い文字)まで列を広げる。凡例の `minWidth: 0` + `ellipsis` は flex の中では効いているが、**その外側の grid が縮ませない**。実測でカード 619.7px。
- **こうする**: `pageStyle` に **`gridTemplateColumns: "minmax(0, 1fr)"`** を足す(`screens.jsx:15` と `CommunityTab.jsx:323` の2箇所。`PersonSheet` も同じ `pageStyle` を使うので一緒に直る)。実測で 315px に収まり、文字は省略される。
- **触るファイル**: `src/community/screens.jsx:15`、`src/community/CommunityTab.jsx:323`。
- **波及**: 人気の組み合わせの行(`:497-503`)、順位の名前(`NameLine`)、データ画面の一覧も同じ grid の中なので一緒に守られる。
- **落とし穴**: `pageStyle` を2ファイルで別々に持っている(`screens.jsx:15` / `CommunityTab.jsx:323`)。片方だけ直すと `ProfileForm` / `ProfileView` で再発する。**両方**。

## 10. データ・シェア画面の楽器種別ボタンを消す

- **いま**: §0.8。条件行の楽器ピルは `ANY` に固定して使わず、別の `Chip` 行で種別を選ぶ。
- **こうする**: `Chip` 行を消し、**条件行の楽器ピルで選ぶ**。ただしシェアとデータの楽器ピルには**「すべて」を出さない**(争点B)。
  - `FilterPill` に `allowAny`(既定 true)を足し、false のときは `<option value={ANY}>` を描かない。`FilterRow` に `saxAny`(既定 true)を足して楽器ピルへ渡す。
  - `ShareScreen` / `DataScreen` の初期値: `{ ...EMPTY_FILTER, saxType: saxTypes[0] ?? "alto" }`。`ShareScreen` にも `saxTypes` を渡す(`CommunityTab.jsx:171`)。
  - `tallyGear(shown, filter.saxType)` / `joinOwners(...).filter(p => p.ideal.saxType === filter.saxType)` のように、種別は `filter.saxType` 1つから読む。`shown = filterUsers(users, filter)`(種別でも絞る。今は `ANY` で外していたが、`tallyGear` が `gear[saxType]` の無い人を落とすので結果は同じ。データ画面も `pairs` を目安の種別で絞っているので同じ)。
  - 順位画面は「すべて」を残す(練習日数は種別に依らない)。
  - 楽器ピルは常に値を持つので `FilterPill` の「選択中は太字・`--c-ink`」の見た目で出る。`isFiltered(filter)` は種別が ANY でないと常に true になる ── **`isFiltered` の呼び手(空表示の文言の分岐 `screens.jsx:329, 361, 695`)は、種別を除いた `genre / position` だけで判定する** `isFilteredBy(filter, ["genre","position"])` へ変える(順位は従来どおり3つで見る)。
- **触るファイル**: `src/community/screens.jsx:113-161, 438-458, 602-662`、`src/community/directory.js:78-81`、`src/community/CommunityTab.jsx:171`。
- **波及**: 人物紹介(`PersonSheet`)の種別 `Chip` は**残す**(あれはその人が登録している種別を切り替えるもので、絞り込みではない)。
- **落とし穴**: `FilterPill` の `on = value !== ANY` は「すべて」の無いピルでは常に true。文字の濃さで「選んでいる」を返す設計(`screens.jsx:103-109`)なので、そのまま「選んでいる」が正しい。

## 11. 公開スイッチの説明文

- **いま**: `note="既定は公開です。OFFにすると他の利用者から見えなくなります"`(`CommunityTab.jsx:957`)。
- **こうする**: 本人の指示どおり `note="プロフィール、奏者自分のデータが公開されます"`。**ただし §15-2 のとおり、この文は日本語として読めない箇所がある**ので、実装は本人の返答を待ってから。
- **触るファイル**: `src/community/CommunityTab.jsx:957`。
- **波及**: なし。
- **落とし穴**: 文言の検査は無い(grep 済み: pitch-test に「既定は公開」の綴りは無い)。

## 12. アカウント削除の説明文

- **いま**: `CommunityTab.jsx:974-977` の2文。確認ダイアログ(`:908`)は別。
- **こうする**: 説明文を1文 **「サーバー上のプロフィールと匿名アカウントが完全に消えます」** だけにする(「アカウントを削除すると、」の前置きと「この端末に保存されている計測データは消えません。」を落とす)。確認ダイアログ(`window.confirm`)の文言は**そのまま**(端末内の計測データが消えないことは、押す直前のダイアログが引き続き言う)。
- **触るファイル**: `src/community/CommunityTab.jsx:974-977`、`src/community/accountRepo.js:61-75`。
- **波及**: **「完全に消えます」を本当にする。** `deleteAccount` は `users/{uid}` だけを消し、`ideals/{uid}_{t}` を残す(§0.3)。`deleteDoc(users)` の**前**に `unpublishAllIdeals(uid)`(項目1で作る)を呼ぶ。順序の理由は `accountRepo.js:47-49` と同じ ── `deleteUser` の後では `request.auth.uid == resource.data.ownerUid`(`firestore.rules:239`)が満たせず二度と消せない。`ideals` の削除が失敗したら `users` も消さず例外を投げる(「まだ何も消えていない」の文言 `DELETE_ERROR` が嘘にならない)。
- **落とし穴**: `SAX_TYPES` 4つぶん `deleteDoc` を投げる。存在しない doc の `deleteDoc` は Firestore では成功扱い(no-op)なので、`listMyIdeals` で先に読む必要は無い(読むと 1 read 増える)。

## 13. 関連箇所の同時修正(語彙の是正を含む)

本人の「これを変更するならこれも変更」は各項目の**波及**に書いた。ここには横断のものだけ。

### 13.1 「機材 / 機種」の是正

本人は楽器を「機材」「機種」と呼ばない。マウスピース・リガチャー・リード・楽器と個別に呼ぶ。

| 区分 | どうする |
|---|---|
| **利用者に見える文字**(必ず直す) | `screens.jsx:849` → 「この人はまだ何も公開していません」/ `:858` の見出し「機材」→ **見出しごと削除**(下の4行が 楽器 / マウスピース / リガチャー / リード と自分で名乗っている。§6.0 原則1)/ `:866` → 「この楽器の登録はまだありません」 |
| **コメント**(同じコミットで直す) | App.jsx 1100-1101「全機種共通 / 各機種の」→「全種別共通 / 各種別の」、1381「機材・部屋」→「楽器や部屋」、12330 / 14430「他機種」→「他の楽器種別」。community 側のコメント中の「機材」は「楽器・マウスピース・リガチャー・リード」または文脈に応じて「楽器の組」。テストの describe 名も同じ |
| **識別子**(**変えない**) | Firestore のキー `gear`(保存データ・rules・テストが参照。変えると既存 doc が読めない)、`catalog/gear.js`、`GEAR_SLOTS / tallyGear / gearKey / gearPicks / GearPicker / GearLine / gearLabel`。識別子は利用者に見えず、変えると差分が全面に広がって審査できない。**コメントで「`gear` = 楽器・マウスピース・リガチャー・リードの1組(保存キー。改名しない)」と1箇所に断る**(`profile.js:123` の見出しコメント) |
| 「機種変更」(`CommunityTab.jsx:376`) | 端末の機種の話なので**残す** |

### 13.2 規約(DESIGN-SYSTEM)の書き換え

争点A(§14)の結論に従い、次を同じコミットで直す:
- §1.2 `:44-46`: 「My Data と分析タブだけは地を `--c-sunk` へ下げ、その上に白いカードを浮かせる」→「カードの作法の画面も地は白。カードは影(§1.10)だけで浮かせる(2026/09/06 本人裁定)」。`--c-sunk` の用途欄「データタブのパネル」→「My Data のマトリクスの帯・PIVOT の面」(実際の使い手 App.jsx:12628, 13108)。
- §6.6 見出し `:1315` の「(地が白になったので、まとめ方をタブごとに決める)」は残る(正しい)。表 `:1320-1323` に「コミュニティ(全画面) | カード | `.surf-card`」を足す(addendum 追記3)。カードの節 `:1462-1468` の「ページの地 `--c-sunk`」→「ページの地 `--c-bg`(白)」。
- §1.10 `:304-308`: 「D-10 で…『薄い地 + 白いカード』の作法へ戻ったので、カードを地から浮かせる影が要る」→「地が白なので、カードを浮かせる手段は影だけ」。
- §1.8 `:171-172`: ゼロ基準線の記述(項目4)。
- §6.0 `:975`: 楽器種別の表記(項目7)。
- addendum の追記1・2(順位の色・アイコンの色)もこの機会に貼り込み、`design/DESIGN-SYSTEM-community-addendum.md` を削除する(memory の宿題2番。同じ文書を2度開かない)。

### 13.4 審査で見つかった追加の修正(2026/09/06)

| 見つかったもの | どうしたか |
|---|---|
| 公開切替が2手目で失敗すると、スイッチとエラー文言と一覧の3つが食い違う | 非公開のときは**先に目安を消してから** users を書く順に変え、一覧の差し引きを users を書いた直後へ移した。最初の一手で失敗すれば「まだ何も変わっていない」が正しく、2手目の失敗は「公開のままだが目安が無い」だけで次回の effect が直す |
| `deleteAccount` が目安を先に消すようになったので「まだ何も消えていません」が嘘になりうる | `DELETE_ERROR` を「途中まで消えていても、押し直せば続きから完了できます」に変えた(存在しない doc の削除は no-op なので再実行は安全) |
| `index.css` と `screens.jsx` のコメントが「地は --c-sunk」のまま | 4箇所を書き換えた |
| `CommunityTab.jsx` / `idealDoc.js` / `firestore.rules` のコメントに「Alto」が残っていた | 3箇所を「A.Sax」へ |
| `ReedStrengthPills` の検査が App.jsx しか見ておらず、コミュニティ側の呼び手を消しても通る | `CommunityTab.jsx` も読み、呼び手が各1箇所であることと、番手の綴りを写していないことを見る |
| `ReedStrengthPills` が `marginTop: 12` を内蔵していた | 呼び手が決めるプロパティにした(シートは 12、ラベル付きの欄では 0) |
| `catalog/gear.js` と `pitch-test.mjs` に「機材」「機種」が13件残っていた | 一掃した |

### 13.3 検査の更新一覧

| 検査 | 変更 |
|---|---|
| `scripts/pitch-test.mjs:6350-6351` | `.surf-card` の地は `var(--c-bg)` |
| `:7556` | `want` を新4語へ |
| `:8797-8800` | 番手9種 `2.0,2.25,…,4.0`。`REED_STRENGTHS` の置き場を `profile.js` にするなら `extractConst`(`:323`)の代わりに import |
| `:13279-13280` | `selectedIdealRaw` の綴り + `alignIdealToMine(null)` は null |
| `src/community/profile.test.js:19, 344, 524-536` | `GEAR_KEYS` 9キー(`reedStrength` は `hasOnly` だけ)・`"T.Sax"` |
| `src/community/icons.test.js:8, 65-75` | 9キー |
| `src/community/align.test.js` | `alignIdealToMine` の検査(null 通過 / 共通音不足はそのまま返す / 音量も動く / ピッチ・倍音は動かない) |
| `src/community/aggregate.test.js` | `tallyGear` の鍵に番手が混ざらないこと |

---

## 14. 争点 A〜G の裁定

### A(項目2)背景を揃えると §6.6「カードの地は沈めた面」が成立しなくなる

**結論: 成立しなくなる。だから規約の側を書き換える。カードの浮きは影だけが担う。**

事実: 計測・リード Top の地は `--c-bg` #FFFFFF(`.surf-rule`)、My Data・コミュニティは `--c-sunk` #F6F7F9(`.surf-card`)。差は 1.0719:1 / ΔL\* 2.79(index.css:66 のコメント・§1.2)。本人の指示は「My Data とコミュニティを計測・リードに揃える」= 地を白にする、以外に読みようが無い(逆方向は「計測タブもリードタブも背景色使われてないでしょ」D-7 と矛盾する)。

根拠:
1. §1.2 が言うとおり、白地では「地より明るい面」でカードを区別できない。残る手段は §6.0 囲いの序列の 3(罫)か 4(面)だが、カードの作法は「罫を1本も引かない」(D-10 本人裁定)。**面を残すなら影しか無い**。影のトークンは §1.10 に既にある。
2. §6.7 は「枠線は状態を持つものにだけ」。カードに枠線を足す案は規約違反なので採らない。
3. 「地を白にする」は index.css の1宣言で済み、7つの根の全部に同時に効く。画面ごとに地を分ける案(My Data とコミュニティだけ白、他は薄い地)は作法を3つに増やし、§6.6 が禁じる入れ子と同じ「index.css の行の順序で勝敗が決まる形」を作る。採らない。
4. 影 `.06` が白地で足りるかは実機でしか分からない(§17)。足りなければ `--shadow-card` / `--shadow-row` の値を上げる(トークンの調整であって発明ではない)。

書き換える条文は §13.2 に列挙した。**「D-10 §0 A の『地を --c-sunk へ下げる』部分は 2026/09/06 の本人指示で取り消し。カード + 影 + 罫なしは生きている」**と記録する。

### B(項目10)楽器種別ボタンを消してシェア画面が成立するか

**結論: 成立する。ただしシェアとデータの楽器ピルには「すべて」を出さない。**

事実: `tallyGear` / `tallyCombos` は `gear[saxType]` を読む(種別1つが前提)。データ画面の目安も `ideal.saxType === saxType` で絞る。条件行の楽器ピルは今 `ANY` に固定されている。

「すべて」のときに何を出すかの選択肢: (i) 4種別ぶんを合算 ── アルトのマウスピースとテナーのマウスピースを同じ票に数えることになり、内訳として嘘(`aggregate.js:127-131` が「未選択を含む組は嘘」として落としているのと同じ理由)。(ii) 4種別を並べて4つ出す ── 画面が4倍になり、本人の「要素を減らす」に反する。(iii) **「すべて」を選べなくする** ── 集計の前提と画面が一致する。既定は自分が登録した最初の種別(データ画面が今そうしている `screens.jsx:606`)。

(iii) を採る。順位画面は練習日数が種別に依らないので「すべて」を残す。`isFiltered` の扱いは §10。

### C(項目5)0.25 刻みなら本体の `REED_STRENGTHS` も同じ刻みにするのか

**結論: する(9種)。既存データは書き換えない。コミュニティにも番手を足すが、rules は `hasOnly` にだけ足す。**

根拠:
1. 番手の刻みが本体 0.5 / コミュニティ 0.25 だと、同じ利用者が同じリードを2つの語彙で登録することになる。本人の「現行のアプリと同じ機能は現行に揃えて」に反する。
2. 新しい9値は旧5値の**上位集合**なので、保存済みの箱の `strength`("3.0" 等の文字列)はそのまま有効。`reedGroupKey`(文字列連結)も `parseFloat`(PIVOT)も壊れない。**移行処理は不要**。既定値の添字だけ `[2]` → `[4]` に直す。
3. コミュニティの `reedStrength` は必須(クライアント)だが rules では null 可(`hasOnly` のみ)。理由は §5 の落とし穴 ── `hasAll` に足すと既存利用者の `updateDoc` が全滅する。これは `firestore.rules:62-69` が既に採っている「ルールは上位集合のまま置く」方針。旧 doc は「番手なし」として読む。
4. `REED_STRENGTHS` の正は `profile.js` に置き、App.jsx が import する(rules との同期検査 `profile.test.js` が読める場所に正を置く)。pitch-test の `extractConst("REED_STRENGTHS")` はそれに合わせて書き換える。

集計の鍵に番手を入れるかは §15-1(要相談)。既定は「入れない」。

### D(項目7)S.Sax への改名の影響範囲

**結論: ラベルだけ。内部値は1文字も変えない。**

根拠: 内部値 `"alto"` 等は (a) Firestore の `users.saxTypes` / `gear` のキー / `ideals.saxType` と docId(`firestore.rules:42, 76-77, 198, 204`)、(b) 端末内の全セッションの `saxType` と `usePersistedState("saxType")`、(c) カタログ(`gear.js`)、(d) pitch-test の数十の検査(`531` 以降)、(e) `SAX_PRESETS` の key(pitch-test 7557 が「保存データの互換」として固定)が参照する。変えると既存の公開 doc と端末内データが全部読めなくなり、移行処理を4箇所に書くことになる。表記の変更に見合わない。

変える場所は `App.jsx:1023-1026` と `profile.js:15` の**2箇所のラベル**と、それを固定している検査(`pitch-test:7556`、`profile.test.js:344`)、規約 `:975`、コメント3箇所。`scripts/pitch-test.mjs` の他の検査は key しか使っていないので波及しない(§0.6 で確認)。`design/canvas` のモックは触らない(pitch-test 26.1 がモックの「Alto」を目印に読んでいる)。

### E(項目8)「自分の平均に、目安に設定しているものが揃えられる」の正確な意味

**結論: 選択中の目安を、その楽器種別の自分の全セッションの平均(コミュニティの `buildMyIdeals` と同じ母集団・同じ関数)に、共通音の中央値で平行移動してから使う。動かすのは重心・HNR・音量の3つ。適用は `selectedIdeal` の導出1箇所で行い、下流は変えない。音量も動かす。**

現状の目安の重ね方と、変わるグラフの列挙は §8 の表。要点:
- 現状 App.jsx で目安は**生の値**で (a) 音色一致度 (b) 計測タブの「目安: n」 (c) `PhraseTimeline` (d) セッション詳細・リード個体詳細の破線 に使われる。My Data とリード比較は目安を描かない。
- 平行移動を `selectedIdeal` の導出(`App.jsx:3045`)に入れると、(a)〜(d) が**同じ動かした値**を見る。グラフだけ動かして (a)(b) を生のままにすると、破線の高さと「目安: n Hz」の数字が食い違う。本人の言葉に「グラフだけ」という限定は無い。
- **音量**: 共有しないのは「他人の環境の絶対値は目標にならない」から(`idealDoc.js:204-206`)。自分の端末内で、日をまたいだ自分の目安と自分の平均を合わせるのは、まさにマイク距離・ゲインのずれを消す操作で、重心・HNR と同じ理屈が当たる。本人が名指ししている。取り込んだ目安には音量が無いので、そのときは動かない(何も起きない)。
- 共通音が3音未満のときは**そのまま使う**(コミュニティのように「出さない」にしない)。端末内の目安は環境が近いか、取り込み時点で合わせ済みなので、絶対値の比較が壊れていない。
- 保存はしない。`idealProfiles`(IndexedDB)は生のまま。表示のたびに導く。

### F(項目3)横スワイプ

**結論: App.jsx の `SwipePager` を export してそのまま使う。人物紹介は `SwipePager` の外(兄弟)に置いた `position: fixed` のまま。人物紹介の上でのスワイプは何もしない(今と同じ)。**

根拠:
1. §6.3「この作法はアプリ内で1つだけ」。コミュニティ用に別のスワイプを書くことは規約違反。`SwipePager` は index 制御の汎用部品で、4ページも受ける(`count` は children の数)。
2. export は `buildIdealProfileFromSessions` の前例どおり。pitch-test は `function SwipePager(` の綴りで本体を切り出すので `export function` でも通る(§0.2)。
3. 人物紹介を `SwipePager` の中に入れると、track の `transform` が `position: fixed` の包含ブロックになり画面を覆えない(§6.3 が名指しで警告)。外に置けば fixed のまま成立し、オーバーレイが画面全体を覆うのでスワイプは pager に届かない。
4. 人物紹介に `SwipeBackArea`(右スワイプで戻る)を付けるかは本人が求めていない。付けるなら `SwipeBackArea` も export すればよいが、今回は入れない(範囲を広げない)。BACKLOG に1行起票する。

### G(項目6)ラジオボタン形式

**結論: 縦並びの単一選択リスト(3行)。形は計測タブの目安一覧(A型の行)に揃える。`Chip` 横並びは採らない。**

根拠:
1. 添付画像の趣旨は「候補が少ないなら、開かずに比較できる形に = 選択肢を全部見せる」。今の `Chip` 3つも全部見えてはいるが、中身(「マウスピース × リード」)は注記1行に1つしか出ず、**比較できていない**。
2. 中身を `Chip` の中に出すと最長「楽器 × マウスピース × リガチャー × リード」(約230px)が横一列に3つ並ばない(`Chip` は `nowrap`)。横並びは物理的に成立しない。
3. 「現行のアプリに揃える」との競合: 現行に「縦に並ぶ単一選択」は**ある**(計測タブの目安一覧 `App.jsx:8121-8156`。A型の行、`aria-pressed`、選択中は枠と文字が紺)。ラジオリストの見た目をそこに揃えれば、画像とも現行とも矛盾しない。`DataOptionSheet`(シート)は「開かずに」に反するので採らない。ラジオの丸印は現行に無いので足さない(選択は枠と文字の色で返す = §6.7 A型)。
4. 行の当たり判定は 44、見えるボックスは 36(箱を大きくせず中身を小さくする、本人が採用済みの解き方)。

---

## 15. 要相談 → **3件とも回答済み(2026/09/06)**

> **回答1: 集計に番手を「含める」。** §5・§13.3・§15-1 は「含めない」を推奨していたが、
> 人数の少ないうちは内訳が細かく割れることを示したうえで本人が「含める」と裁定した。
> 実装は `aggregate.js` の `gearKey(brand, model, extra)` と `SLOTS.reed` の第3要素。
> `catalog/gear.js` の「番手を入れると内訳が細かく散る」というコメントも、この裁定に
> 合わせて書き換えてある。**以下の §15-1 の推奨は失効している。**
>
> **回答2: 公開スイッチの文言は「プロフィールと奏者が「自分」のデータが公開されます」。**
> 本人が示した文。公開されるのは、プロフィールと、**奏者が「自分」であるセッション**から
> 作った目安・練習日数。アプリのセッションは奏者名を持ち、公開の対象はそのうち
> 「自分」のものだけ、という区別をこの1文が言っている。§15-2 の推奨案は採らない。
>
> **回答3: 本番のルールの版は不明(本人が確認する)。** そのため §15-3 の不整合は
> リポジトリ側で解消した ── `firestore.rules` の直下の `hasAll` から `'stats'` を外した
> (`hasOnly` には残す)。どの版が本番に出ていても、新しいルール文を公開すれば直る。
> `profile.test.js` に「ルールが doc に無いキーを hasAll で要求していないこと」の検査を足した。

## 15. 要相談(本人に聞くべきこと。上の回答を参照)

1. **人気の組み合わせとリードの内訳に、番手を含めるか。** 項目5で番手をプロフィールに足すが、集計の鍵(`gearKey`)に番手を混ぜると「Vandoren Traditional」が「Vandoren Traditional 2.5 / 2.75 / 3.0 …」に9分割され、上限50人の母集団では1票ずつになって内訳が成立しにくい。一方「マウスピース × リードの番手」は組み合わせとして本人が見たいものかもしれない。**推奨: 含めない(表示は人物紹介・マイページだけ)。** 人数が増えてから「番手を含む」を別項目として足す。
2. **項目11の文言「プロフィール、奏者自分のデータが公開されます」は、このままでよいか。** 「奏者自分の」が日本語として繋がらず、入力ミスの可能性がある。**推奨: 「プロフィールと自分の音のデータが公開されます」**(公開されるのはプロフィール・練習日数・楽器種別ごとの目安。「奏者」は他人のセッションの奏者名を指すので、ここで使うと「他人のデータも出る」と読める)。文言が決まるまで項目11は保留し、他の12点を先に進める。
3. **`stats` の必須化と初回保存の整合。** `buildProfileDoc` の doc に `stats` が無いのに、リポジトリの `firestore.rules:19` は `hasAll` で `stats` を要求している。この rules が本番に公開されていれば**新規のプロフィール保存が弾かれる**はず(§0.3)。実際にはどの版のルールが公開されているか(memory の宿題2「Firestore ルールの再デプロイ 未完了」)は本人にしか分からない。項目1・12はルールの `create/update` に触るので、**本番のルールが今どの版かを先に確認してほしい**。推奨: rules の `hasAll` から `'stats'` を外す(`hasOnly` には残す)か、`buildProfileDoc` が `stats` を空で入れるかのどちらかに揃える。前者が「上位集合のまま置く」方針に合う。

## 16. 実装順序

依存関係と「1コミットにする塊」:

1. **語彙と表記(コミット1)**: 項目7(S.Sax)+ 項目13.1(機材/機種)+ 規約 `:975` + 検査(`pitch-test:7556`、`profile.test.js:344`)。他のどれにも依存せず、他のコミットの差分に「Alto」が混ざらなくなる。
2. **地とレイアウト(コミット2)**: 項目2(`.surf-card` の地)+ 項目9(`minmax(0,1fr)`)+ `PersonSheet` の地 + 規約 §1.2 / §1.10 / §6.6 + addendum 貼り込みと削除 + `pitch-test:6350`。見た目の変更をここに集める(本人が1回で確認できる)。
3. **子タブ + スワイプ(コミット3)**: 項目3。`SubTabs` / `SwipePager` の export、`JoinedView` の書き換え。項目10(楽器ボタンの削除)と項目6(組み合わせのリスト)と項目4(±0 線)は同じ `screens.jsx` の画面単位の変更なので**ここに同乗**させる。項目10 は `ShareScreen` に `saxTypes` を渡す配線が `JoinedView` にあるため、コミット3と切り離すと `JoinedView` を2度書き換えることになる。
4. **番手(コミット4)**: 項目5。App.jsx の `REED_STRENGTHS` / ピルの切り出し / `profile.js` / rules / 3つのテスト / `pitch-test:8797`。**rules の変更は本人の再デプロイが要る**(§15-3)。クライアントは `reedStrength` を書くが、旧ルールのままだと `hasOnly` で弾かれて保存できないので、**このコミットを本番へ出すのは rules 公開の後**。
5. **公開・削除(コミット5)**: 項目1 + 項目12 + `unpublishAllIdeals` + `publishMyIdeals` の公開状態ガード + rules のコメント修正。項目11は §15-2 の返答が来てから同じコミットに入れる(1行)。
6. **平行移動(コミット6)**: 項目8。`align.js` 追記 → `App.jsx:3045` → `pitch-test:13280` → `align.test.js`。他に依存しないが、計測の数値が動く唯一の変更なので**最後に単独で**入れ、退行の切り分けをしやすくする。

## 17. 検収方法

共通: `npx vitest run` / `node scripts/pitch-test.mjs`(FAIL 0)/ `npx vite build`。ブラウザは 375×812。

| 項目 | ブラウザで見るもの(1行) |
|---|---|
| 1 | マイページで公開を OFF → 順位・データ画面から自分の行が**その場で**消え、ON に戻すと戻る。Firestore コンソールで `ideals/{uid}_*` が OFF で消え ON で復活する。**併せて、修正前の版で「他の上部タブへ行って戻る」で直るかを実機で確かめ、本人報告(再起動まで)との差を記録する** |
| 2 | My Data・分析・セッション詳細・すべてのセッション・リード個体詳細・コミュニティの地が計測タブと同じ白で、カードの縁が影で読める(実機で判定。読めなければ影の値を1段上げる) |
| 3 | コミュニティの子タブが「データ 順位 シェア マイページ」の見出し型(選択中 22px)で1行に収まり、横スワイプで4画面を行き来でき、人物紹介が開いている間は画面全体を覆う |
| 4 | データ画面と人物紹介の「音程」で、中央に `--c-line-strong` の線が1本あり、目盛が上/0/下の3つで上下対称 |
| 5 | リード追加シートの番手が 2.0〜4.0 の9個(2段)で既定 3.0、既存の箱の番手表示が変わらない。プロフィール編集でリードの番手が必須で、マイページと人物紹介に「銘柄 型番 番手」で出る |
| 6 | 人気の組み合わせが3行の縦リストで、押した行だけ枠と文字が紺になり、下の一覧が切り替わる。「n項目」の文字が無い |
| 7 | 計測タブ上部・My Data の楽器セレクタ・目安一覧・セッション詳細・コミュニティの条件ピルと Chip がすべて `S.Sax / A.Sax / T.Sax / B.Sax` |
| 8 | 同じセッション詳細を、目安を選んだ状態で修正前後に開き、HNR・重心・音量の破線が上下に平行移動していて、平均差分は動いていない。計測タブの「目安: n Hz」がその破線の高さと一致する |
| 9 | シェア画面で型番の長い項目(例「Series II (SA80II)」)を含む内訳を出して、`document.documentElement.scrollWidth === 375` のまま、凡例が省略記号で切れる |
| 10 | シェア・データ画面の上部に楽器の Chip 行が無く、条件行の楽器ピルに「すべて」が無い。順位画面には「すべて」が残る |
| 11 | 公開スイッチの説明が本人確定の1文 |
| 12 | 削除の説明が「サーバー上のプロフィールと匿名アカウントが完全に消えます」の1文。削除後に Firestore の `users/{uid}` と `ideals/{uid}_*` が両方無い |
| 13 | `grep -n "機材\|機種" src/community/*.jsx src/community/*.js src/App.jsx` の結果に、利用者に見える文字列が0件(コメントの残りは `gear` の断り書き1箇所だけ)。`grep -c コミュニティ design/DESIGN-SYSTEM.md` が 1 以上で addendum が消えている |
