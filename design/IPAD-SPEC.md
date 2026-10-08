# Ficus iPad 対応 ── 実装仕様(凍結案)

作成: 2026-10-03 / 設計役 / 対象ツリー: `.claude/worktrees/view-other-user-data-ebb07d`(main = `claude/batch13` 相当)
モック: `scratchpad/ficus-ipad.html`(案A / 案B の絵と「現状」の実測表)

この文書は**実装役がこれだけ読めば迷わない**ことを目的にしている。値・場所・分岐の根拠は「ファイル:行」で添える。
行番号は 2026-10-03 時点の作業ツリーのもの(ずれていたら綴りで探す)。

---

## 0. 本人の裁定(写し)と、この文書の決め方

| 裁定 | 内容 |
|---|---|
| 計測タブ・データタブ | **案A**。本文の列を 640 にし、下部タブも 640 にそろえる。計測は幅 700 以上で環の上限を 440 |
| 横向きの計測 | **案Aのまま**(横向きだけ2ペインにしない) |
| リードタブ・コミュニティタブ | **案B(2ペイン)** |
| 向き | **縦横両対応**。`UIRequiresFullScreen` は使わない |
| iPhone | **見た目を 1px も変えない**。変更は幅のしきい値の中でだけ効く |

決め方の優先順位: 本人の裁定 > DESIGN-SYSTEM.md と `【本人裁定】`の注記 > モック(§6.0「見た目についてはモックが唯一の正典」) > この文書の判断。
**新しい値を発明しない**(DESIGN-SYSTEM 冒頭)。この文書が足すトークンは §2.1 の2つだけで、どちらも本人が見たモックの実寸。

用語: 「幅」= `window.innerWidth`(CSS px)。「列」= 案Aの1本の本文(最大 640)。「器」= 2ペインを包む枠(最大 1000)。「ペイン」= 器を左右に割った片方。

---

## 1. しきい値と判定

### 1.1 しきい値は 1つ: `700`(幅 ≥ 700 を「広い」と呼ぶ)

- 定数は `src/App.jsx` に **1か所**: `export const WIDE_LAYOUT_MIN_W = 700;` と `export const WIDE_LAYOUT_QUERY = \`(min-width: ${WIDE_LAYOUT_MIN_W}px)\`;`
- 700 を採る理由(どれも実機の幅の事実):
  - iPhone の最大幅は 440(Pro Max)。700 には届かないので **iPhone では決して「広い」にならない**
  - iPad の全画面の最小幅は 744(iPad mini 縦)。744 で2ペインにすると片方 = (744 − 28 − 20) / 2 = **348**。iPhone 375 の本文 347 と同じ幅なので、iPhone 用に作った部品がそのまま収まる
  - Split View: 11型の横 1180 の 2/3 ≈ 781 → 広い(ペイン 376)。13型の横 1366 の 1/2 ≈ 678 → 狭い(列 640 がほぼ画面いっぱい)。Slide Over 320 → 狭い(iPhone と同じ)
- **縦の 820(iPad 11型の縦)でも2ペインにする**。モック案Bの縦の絵(ペイン 386)が本人の見たもの。

### 1.2 CSS か JS か ── 判定は JS ただ1つ。CSS にメディアクエリは置かない

- ペインの中身の出し分け(右に何を描くか・戻るボタンを消す・はじめの一手の的を1つにする)は JS でしかできない。CSS のメディアクエリと JS の `matchMedia` を両方持つと**しきい値が2か所になる**ので、CSS 側には置かない。
- `src/App.jsx` に `useWideLayout()` を1つ:
  ```js
  function useWideLayout() {
    const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(WIDE_LAYOUT_QUERY).matches;
    const [wide, setWide] = useState(get);
    useEffect(() => {
      if (typeof window.matchMedia !== "function") return undefined; // jsdom: 常に false = 今までの木
      const mq = window.matchMedia(WIDE_LAYOUT_QUERY);
      const on = () => setWide(mq.matches);
      mq.addEventListener("change", on);
      return () => mq.removeEventListener("change", on);
    }, []);
    return wide;
  }
  ```
  `App()` の中で1回呼び、`wide` を **props で配る**: `MeasureView`(環の上限)/ `ReedsTab`(2ペイン)/ `CommunityTab → JoinedView / JoinIntro`(2ペイン)。`AnalysisLabView` には渡さない(列 640 は CSS の `max-width` だけで足りる)。
  - jsdom には `matchMedia` が無いので **既存の検査は全部「狭い」の木を描く**(1文字も変わらない)。広い木の検査は `matchMedia` をモックして描く(§6.3)。
  - 既存の `matchMedia` の呼び手は `prefers-reduced-motion` の3つ(App.jsx:3604 / 7381 / 7819)。形はそれに倣う。
- 幅だけで決める。**向きは見ない**(横向きの計測は案Aのままなので、向きで分岐するものが無い)。高さは今までどおり環の縮み(便BM)が見る。

### 1.3 Split View で狭くなったとき(広い → 狭い)

- `wide` が false になった描画で、**各タブが今までの木(iPhone の形)をそのまま描く**。状態は捨てない:
  - リード: 右ペインに出していたリード(`evaluatingReedId`)があれば、狭い木ではそれが**個体詳細の画面**(戻る導線つき)として出る ── 今の iPhone と同じ画面(App.jsx:11854-11877)
  - コミュニティ: 右ペインに出していた人(`person`)があれば、狭い木では **`PersonSheet`(BottomSheet)** として出る(CommunityTab.jsx:392-403)
  - 計測: 環の上限が 330 に戻り、`ringFitLayout.key` が `innerWidth` を含む(App.jsx:198)ので同じ描画で合わせ直す
- 逆(狭い → 広い)も同じ: 開いていた個体詳細 / 人物シートが右ペインに移る。
- 「変更はしきい値の中でだけ」の読み方: **狭い木は byte 単位で今の綴りのまま**にする(早期 return や三項で広い木を**足す**。既存の return は触らない)。これが「iPhone を 1px も変えない」の構造的な保証で、§6.3 の検査もこの前提で書く。

---

## 2. 共通の器

### 2.1 トークン(`src/index.css` の `:root` に2つ足す。写しは `design/canvas/tokens.mjs` へ同じ周で)

| トークン | 値 | 用途 | 根拠 |
|---|---|---|---|
| `--page-max-w` | `640px` | 案Aの列の上限。本文(`maxWidth: 900` の 11か所)・下部タブ(480)・シート(900)・帯・案内のカードがこれを読む | 本人裁定「本文の列を 640」。モック案Aの実寸 |
| `--pane-max-w` | `1000px` | 2ペインの器の上限(左右 1:1・間 `--sp-5`)。ペイン = (器 − 20) / 2 → 820 縦で 386 / 1032 縦・1180 横・1366 横で 490(器が 1000 で頭打ち) | モック案B横向きの器 `colW: 1000`(ficus-ipad.html:441)。本人が見た絵。ペインが 640 を越えない(1300 だと 13型横で 640 になりタイルが 120px まで伸びる) |

- 左右の比は **1:1**、間は **`--sp-5`(20px)**(モック案Bの `gap 20`。新しい値ではない)。
- 2ペインの器のクラスは index.css に1つ:
  ```css
  /* 【iPad 2026-10-xx 本人裁定】2ペインの器。広い(JS の useWideLayout が true)ときだけ DOM に現れる。
     左右 1:1・間 --sp-5。minmax(0,1fr) は中の長い文字で列が押し広げられないため(screens.jsx:40 の同じ罠)。 */
  .pane-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: var(--sp-5); align-items: start; }
  ```
- DESIGN-SYSTEM §3「レイアウト定数」の表(DESIGN-SYSTEM.md:979-985)に2行足し、理由を上の表の言葉で書く。`scripts/pitch-test.mjs` の便BF の節が index.css と tokens.mjs の実値を突き合わせるので、**両方に同じ値**を書く(メモリ「キャンバスのトークンの写しはズレる」)。

### 2.2 `maxWidth: 900` の置き換え(全部 `var(--page-max-w)` に。11か所。どれも iPhone では上限に届かないので見た目は変わらない)

| 場所 | 何 | 行 |
|---|---|---|
| ActionNotice(操作の合図の帯)の内箱 | `maxWidth: 900` → `"var(--page-max-w)"` | App.jsx:3716 |
| エラーの暗幕のカード | 同 | App.jsx:5185 |
| 計測タブの根 `measureRootRef` | 同 | App.jsx:9226 |
| 「この録音を保存しますか」のカード | 同 | App.jsx:10132 |
| リードの比較の包み | 同(広い木では §3.5 の形になる) | App.jsx:11945 |
| ReedRegisterView の根 | 同 | App.jsx:12827 |
| ReedEvaluationDetail の根 | 同 | App.jsx:14373 |
| BottomSheet のカード | `width: "100%", maxWidth: 900` → `"var(--page-max-w)"` | App.jsx:15991 |
| AnalysisLabView(My Data / 分析)の内箱 | 同 | App.jsx:17425 |
| アップロードの告知の内箱 | 同 | App.jsx:17443 |
| 分析タブの内箱 / SessionDetailView の根 | 同 | App.jsx:17925 / 18226 |

- **下部タブ**: `BottomNav` の内箱 `maxWidth: 480` → `"var(--page-max-w)"`(App.jsx:5471)。375 では 375 のまま(480 も 640 も届かない)。iPad では本文の列と同じ 640 に揃い、1つのタブの幅は (640 − 左右 20×2) / 4 = **150**(今は (480 − 40)/4 = 110。375 では (375 − 40)/4 = 83.75 のまま)。2ペインのタブでも下部タブは 640 のまま(本人裁定「下部タブも 640 にそろえる」)。
- 綴りを `900` から変えるので、pitch-test の次の正規表現を一緒に直す(**先に落として、直して、通す**): 6884(My Data の return の `maxWidth: 900`)/ 13043(BottomSheet の `style={{ width: "100%", maxWidth: 900`)。他に `900` を綴りで見ている箇所が無いことを `grep -n "maxWidth: 900" scripts/pitch-test.mjs src/*.test.jsx src/community/*.test.jsx` で確かめる(いまは上の2つだけ)。

### 2.3 浮かせるボタン(`FloatingAction`)の右端 ── 列・ペインの右下にそろえる

今は `right: var(--page-pad-right)`(App.jsx:12102)= **画面の右端から 14**。820 幅の列 640 では、列の右端(x=730)からさらに 76px 右に浮く。§4.5「主要動作は**面の右下**」の「面」は iPad では列・ペインなので、そこへそろえる。iPhone では式の値が今と同じになるので 1px も変わらない。

`FloatingAction` に `pane` を足す(`undefined | "left" | "right"`。渡さない呼び手は今までの名乗りのまま):

| `pane` | `right` の式 | いつ |
|---|---|---|
| (渡さない) | `max(var(--page-pad-right), calc((100% - var(--page-max-w)) / 2))` | 列 640 の画面(My Data の取り込み・狭い木の個体詳細の計測 など全部) |
| `"left"` | `calc(50% + var(--sp-5) / 2)` | 2ペインの**左**の主要動作(リード一覧の ＋) |
| `"right"` | `max(var(--page-pad-right), calc((100% - var(--pane-max-w)) / 2))` | 2ペインの**右**の主要動作(個体詳細の 計測) |

- `position: fixed` の `right` の % は viewport 幅。器(`margin: 0 auto`)は中央に居て左右 1:1 なので、**左ペインの右端 = 画面中央 − 間/2**、**右ペインの右端 = 器の右端**。`max()` は iPhone(375)で `(375 − 640)/2 < 0` となるので `--page-pad-right` が勝つ = 今と同じ値。
- `bottom` は変えない(`calc(var(--page-bottom-gap) + var(--sp-3))`。帯 `--ad-h` もここに入っている)。
- **2ペインで ＋ と 計測 が同じ角に重なるのを避けるのが主目的**(§3.4)。式を3つ持つのは FloatingAction の中だけ。
- モックは ＋ を画面の端に描いていた(ficus-ipad.html:422)。ここは本人の目に触れる差なので **§7-(2)** に回す。既定はこの表。

### 2.4 広告の帯 / 告知 / はじめの一手 / シート ── 列 640 と 2ペインでどこに出るか

| 物 | 列 640(計測・データ・比較・シェア・マイページ) | 2ペイン(リード登録・コミュニティのデータ・順位) | 変更 |
|---|---|---|---|
| 広告の帯 `AdPreviewStrip` / `--ad-h` | 画面いっぱい(`left:0; right:0`。App.jsx:5522)。本物の AdMob の帯も画面幅なので揃えない | 同 | **なし** |
| 操作の合図の帯 `ActionNotice`(z50) | 下部タブの上・`--page-max-w` で中央(§2.2) | 同(帯はタブごとに変えない) | maxWidth のみ |
| アップロードの告知(z40・データタブ) | 上端・`--page-max-w` で中央(§2.2) | ─ | maxWidth のみ |
| はじめの一手のカード `.coach-card`(z55) | 画面中央・**幅の上限 `--page-max-w`**(今は左右 22 固定 → 820 で 776 幅になる) | 同 | index.css:824 の `left: 22px; right: 22px` を `left: max(22px, calc((100% - var(--page-max-w)) / 2)); right: 同` に。375 では 22 のまま |
| はじめの一手の穴・暗幕 | 的の矩形から作る(onboarding.jsx:242)。的の位置が変わるだけ | 的が左ペインに居ても右ペインに居ても同じ仕組み | **なし**(的の重複だけ §3.6 / §4.6) |
| 参加前の画面 `JoinIntro`(カード1枚) | ─ | §4.7 | `.join-frame` に `justify-content: center`、`.coach-card.join-card` に `max-width: var(--page-max-w)`(index.css:842-846)。375 では 331 幅のまま |
| BottomSheet(z60) | 下寄せ・**`--page-max-w` で中央**(§2.2)。上限 `calc(100dvh - var(--nav-h))` は変えない | 同(ペインから開くシートも body へ portal されるので同じ) | maxWidth のみ |
| 写真の拡大 `PhotoZoom`(z70) | 画面いっぱい(portal。PhotoZoom.jsx:46/55) | 同 | **なし** |
| エラー / 保存の確認(z60) | 下寄せ・`--page-max-w` で中央 | ─ | maxWidth のみ |

- `--page-bottom-gap` / `--nav-h` / `--ad-h` / `PAGE_TOP_PAD` は **1つも触らない**。
- SwipePager の `bleed`(データタブのグラフカードを画面いっぱいに伸ばす負マージン)は列 640 の中で ±14 はみ出すだけ(地は白)。触らない。

---

## 3. リードタブ(案B・2ペイン)

### 3.1 いまの構造(App.jsx:11765-11953)

- `ReedsTab` は `evaluatingReedId` を持ち、**あれば `.surf-card` の個体詳細だけを返す**(早期 return。11854-11877。`SwipeBackArea` で右スワイプ = 戻る・左スワイプ = 比較へ)。無ければ `.surf-rule` の Top: `SubTabs(登録|比較)` + `ReedSaxChipRow` + `SwipePager[ReedRegisterView, ReedCompareTab]`(11882-11952)。
- タイルを押す → `onTileTap` → 編集中なら番号のシート、そうでなければ `onOpenReed(id)` = `openReed`(12901 / 11792)。
- 個体詳細の「計測」と一覧の「＋」はどちらも `FloatingAction`(body へ portal・右下固定)(14442 / 12945)。
- 面の作法: Top は罫(`.surf-rule`)、個体詳細はカード(`.surf-card`)。**入れ子にしない**(index.css:456-460 / pitch-test 6659)。

### 3.2 広い木(`wide === true`)の構造 ── `ReedsTab` に **3つ目の return** を足す(既存2つは触らない)

```jsx
if (wide) {
  return (
    <div>                                                           {/* 作法のクラスは付けない(左右で作法が違う) */}
      <div style={{ maxWidth: "var(--pane-max-w)", margin: "0 auto" }}>
        <SubTabs items=… value={reedsSubTab} onChange=…>{/* 「完了」は今の綴りのまま */}</SubTabs>
        <ReedSaxChipRow value={listSax} onPick={setListSax} />
        <SwipePager index={reedsSubTab === "compare" ? 1 : 0} onIndexChange=…>
          {/* 登録 = 2ペイン */}
          <div className="pane-2">
            <div className="surf-rule">
              <ReedRegisterView … onOpenReed={openReed} pane="left" coachSuppressed={paneReed !== null} />
            </div>
            <div className="surf-card" data-noswipe>
              {paneReed
                ? <ReedEvaluationDetail reed={paneReed} … onBack={null} onMeasure=… pane="right" actionsActive={reedsSubTab === "register"} />
                : <PaneEmpty>リードを選ぶと、ここに詳細が表示されます</PaneEmpty>}
            </div>
          </div>
          {/* 比較 = 列 640 */}
          <div className="surf-rule">
            <div style={{ maxWidth: "var(--page-max-w)", margin: "0 auto" }}>
              <ReedCompareTab … />
            </div>
          </div>
        </SwipePager>
      </div>
    </div>
  );
}
```

- **`SwipeBackArea` は使わない**(右ペインは「押して入った画面」ではないので戻る先が無い)。`listScrollYRef` の控え・復元も広い木では読まない(`openReed` は `wide` なら `setEvaluatingReedId(id)` だけ)。
- 右ペインの包みに **`data-noswipe`**: SwipePager は `closest("[data-noswipe]")` の中で始まったドラッグを拾わない(App.jsx:509)。右ペインで横に引いても子タブは動かない(iPhone で個体詳細の上で引いても子タブが動かないのと同じ)。左ペインでは今までどおり子タブが動く。
- `.surf-card` の負マージン(index.css:569-572)は右ペインのセルを左右 14px ずつはみ出すが、はみ出す地は白(`--c-bg`)なので見えない。右端は `.app-root` の padding-right(= 14 + inset)と同じ量だけはみ出すので画面の外には出ない。**新しい規則(`.surf-card.pane` など)は足さない**(pitch-test 6421-6441 の作法の一覧に手を入れないため)。
- `SubTabs` と `ReedSaxChipRow` は作法のクラスに依らない(どちらもインライン。App.jsx:15705 / 11726)。器の中・左端は `.app-root` の 14 のまま(1180 横では器が中央に寄るので (1180 − 1000)/2 = 90 から始まる)。

### 3.3 右ペインに出すリード(`paneReed`)の決め方 ── 導出で決める(閉じる操作が無いため)

```js
const saxReeds = reedsOfSax(reeds, listSax);
const has = (id) => id != null && saxReeds.some((r) => r.id === id);
const paneReedId = !wide ? null : has(evaluatingReedId) ? evaluatingReedId : has(selectedReedId) ? selectedReedId : null;
const paneReed = paneReedId ? reeds.find((r) => r.id === paneReedId) : null;
```

- **最初に出すのは計測タブで選んでいるリード**(`selectedReedId`。見ている楽器種別のものなら)。無ければ空の状態。タブを開き直すと `ReedsTab` は作り直される(`key={reeds-${navNonce}}`。App.jsx:5126)ので、開くたびにここから始まる ── 今の「開くたびに計測タブの楽器から始まる」(11777-11780)と同じ性質。
- 楽器種別のチップを替えると、別の種別のリードは `has` で外れて空(または選んでいるリード)に戻る。消したリードも同じ。**`evaluatingReedId` を手で消す処理は要らない**。
- 狭い木(iPhone)の `evaluatingReed` の決め方(11798)は触らない。

### 3.4 タイルを押したとき・個体詳細の中身・戻る・主要動作

| 事柄 | 狭い木(今) | 広い木 |
|---|---|---|
| タイルを押す(編集中でない) | 個体詳細の画面へ(`SwipeBackArea`・`< 一覧`) | **右の中身が替わるだけ**。ページは動かない・スクロールも動かさない |
| `< 一覧`(DetailHeader の戻る) | 出す | **出さない**。`DetailHeader` を `onBack == null` なら戻るの行を描かない形にする(App.jsx:16252-16257 を `onBack ? … : null`。見出しの行の `marginTop: 6` は戻るの行があるときだけ)。狭い木は `onBack` を渡すので 1px も変わらない |
| 個体詳細の中のシート(評価の3列ダイヤル `ReedScoreEditor` = BottomSheet App.jsx:10820 / メモは入力欄) | BottomSheet | 同じ。body へ portal されるので SwipePager の `transform` の中に居ても覆える(§6.3 の罠に当たらない) |
| 一覧側のシート(番号の変更 `ReedNumberSheet` / 追加 / 箱の編集) | BottomSheet | 同じ |
| 「計測」(個体詳細の FloatingAction App.jsx:14442) | 右下 | `pane="right"`(右ペインの右下)。**`actionsActive`** を新設し false なら描かない ── SwipePager は比較のページも描いたまま(track の隣)なので、比較を見ているときに右ペインの「計測」が body に浮いて出るのを止める。`ReedRegisterView` の ＋ が `pageActive` で同じことをしている(12944) |
| 「＋」(一覧の FloatingAction 12945) | 右下 | `pane="left"`(左ペインの右下 = 画面中央の少し左)。`pageActive` の門は今のまま |
| `FloatingActionSpacer` | 一覧の末尾・詳細の末尾 | 同じ(それぞれのペインの末尾) |
| `onMeasure`(計測タブへ移る。11872) | 同じ | 同じ |

### 3.5 「比較」の子タブ ── **列 640(2ペインにしない)**

候補の一覧とグラフ1枚の縦の流れで、左右に割る自然な切れ目が無い。640 のグラフは iPhone の 1.8 倍で足りる。将来「候補 | グラフ」に割るとしても別の便。

### 3.6 はじめの一手(リード2 = `reedsMeasure`)が2ペインで成り立つか ── 成り立つ。的を**1つ**にする

- 今: 一覧の先頭の箱の先頭のタイルと、個体詳細の「計測」ボタンの**両方**が `data-coach="reedsMeasure"` を名乗る(onboarding.jsx:100-107 / App.jsx:12904 / 14447)。iPhone では同時に存在しないが、2ペインでは**同時に存在する**。`document.querySelector` は DOM 順の先(= 左のタイル)を返すので、右に詳細が出ていてもタイルに穴が開く。
- 規則: **右ペインにリードが出ているときは、タイルは名乗らない**(`ReedRegisterView` に `coachSuppressed` を渡し、`coachFirst={gi === 0 && !coachSuppressed}`)。右が空のときはタイルが的(今までどおり)。右にリードが出たら詳細の「計測」が的(今までどおり「2つの画面をまたぐ同じ一手」)。
- `targetVisible`(onboarding.jsx:236)は的が画面に**まるごと**見えることを求める。右ペインの「計測」は fixed の丸(56)で常に見えている。左のタイルは 1 行目なので縦 1180 / 820 どちらでも見える。
- `onboardingApp.test.jsx:593` が「`[data-coach="reedsMeasure"]` が 0 個」を見ている場面がある。広い木の検査では「**最大 1 個**」を足す(§6.3)。
- リード1(`reeds` = ＋ の丸)は `pane="left"` で位置が変わるだけ。穴は `getBoundingClientRect` から作るので追従する。

### 3.7 長押しの編集モード(タイルが揺れる)と右ペイン

- 右ペインは**そのまま**(出していたリードの詳細を出し続ける)。編集中にタイルを押すと番号のシート(今と同じ。12901)。
- 「どこを押しても編集を終える」(`reedListPressEndsEditing`。12826-12828)は一覧の根(左ペイン)だけ。**右ペインを押しても編集は終わらない**(右ペインは「一覧」ではない)。
- 揺れている間は ＋ もタイルも的を名乗らない(今の規則。12949 / 11331 の注記)。右ペインの「計測」は名乗る ── 揺れていても右の一手は生きているので矛盾しない。
- `SwipePager` の「並び替え中は横スワイプを止める」(`reedTileDragActive`)は今のまま効く。

### 3.8 横スワイプ(`SwipePager`)と2ペイン

- 器の幅 = SwipePager の viewport 幅 = 器(最大 1000)。しきい値は幅の 20%(§6.3)= 820 縦で 158 / 1180 横で 200。
- ページは2枚(登録 = 2ペイン / 比較 = 列 640)。track の `transform`(App.jsx:371)は今までどおり**常に在る**ので、ペインの中の `position: fixed` は**必ず portal**で出す(いま fixed で中に居るものは無い: FloatingAction / BottomSheet / PhotoZoom は全部 portal)。
- 右ペイン(`data-noswipe`)の上で始めた横の指は子タブを動かさない(§3.2)。

---

## 4. コミュニティタブ(案B・2ペイン)

### 4.1 いまの構造(CommunityTab.jsx:171-412 / screens.jsx)

- `JoinedView`: `SubTabs(データ|順位|シェア|マイページ)` + `SwipePager[DataScreen, RankScreen, ShareScreen, ProfileView]`、兄弟に `PersonSheet`(BottomSheet。`person` が在るとき)と `BackupSheet`。`go(k)` は子タブを替えるとき `setPerson(null)`(360)。
- 人物のページは `onOpenPerson` から開く: データの一覧の行(screens.jsx:1339-1343)と順位の行(668 / 677)。シェアとマイページには人を開く口が無い。
- 「みんなの平均」カードを押すと `CohortAdoptSheet`(BottomSheet。1312-1318)。用語の吹き出し `TermTip` は自分の箱(`position: relative`)の下に `absolute` で出す(termTip.jsx:159-176)。
- `PersonSheet`(screens.jsx:1477-1862): BottomSheet の中に `pageStyle`(paddingTop 0)の本文 → 空き(`ADOPT_STICKY_SPACER_H`)→ `position: sticky; bottom: 0` の「目安に設定」→ ブロックの確認 / 通報のシート(BottomSheet を重ねる)/ PhotoZoom(z70・portal)。
- コミュニティ全体は App の `.surf-card` の中(App.jsx:5297)。人物のページの中身は `.card` を使っていない(screens.jsx の `className="card"` は 673 / 862 / 897 / 1093 / 1104 / 1258 / 1336 で、全部一覧側)。**シートから面へ移しても見た目は変わらない。**

### 4.2 広い木の構造 ── 子タブごとに「2ペイン」か「列 640」かを決める

| 子タブ | 広い木 | 右ペインの中身 |
|---|---|---|
| データ | **2ペイン**。左 = `DataScreen`(条件の行・平均カード・一覧) | その人のページ(`PersonBody`)。選んでいなければ空の状態 |
| 順位 | **2ペイン**。左 = `RankScreen` | 同上 |
| シェア | **列 640**(中央) | ─(人を開く口が無い。円グラフと組み合わせの一本の流れ) |
| マイページ | **列 640**(中央) | ─(自分の設定の一本の流れ。開くもの(アイコン変更・ブロック中の人・削除・引継)は全部シート) |

`JoinedView` の return は狭い木を触らず、`wide` のときの木を足す:

```jsx
const paneRight = (k) => (tab === k && person
  ? <PersonBody person={person} ideals={shownIdeals ?? []} myIdeals={myIdeals} tuningHz={tuningHz} onAdopt={onAdoptIdeal} myUid={uid} onBlock={block} inPane />
  : <PaneEmpty>奏者を選ぶと、ここに詳しいデータが表示されます</PaneEmpty>);
const twoPane = (k, left) => (
  <div className="pane-2">
    <div>{left}</div>
    <div data-noswipe>{paneRight(k)}</div>
  </div>
);
const column = (node) => <div style={{ maxWidth: "var(--page-max-w)", margin: "0 auto" }}>{node}</div>;

return (
  <div style={{ maxWidth: "var(--pane-max-w)", margin: "0 auto" }}>
    <SubTabs items={SUB_TABS} value={tab} onChange={go} />
    <SwipePager index={index} onIndexChange={(i) => go(SUB_TABS[i].key)}>
      {twoPane("data", dirGate ?? (ideals === null ? <LoadingRing /> : <DataScreen … />))}
      {twoPane("rank", dirGate ?? <RankScreen … />)}
      {column(dirGate ?? <ShareScreen … />)}
      {column(<ProfileView … />)}
    </SwipePager>
    {/* PersonSheet は描かない(右ペインに居る)。BackupSheet は今までどおり */}
    {backup ? <BackupSheet onClose=… /> : null}
  </div>
);
```

- **人のページは「いま表に出ている子タブ」のペインにだけ描く**(`tab === k`)。SwipePager は4ページとも描いたままなので、条件を付けないとデータと順位の両方に同じ人物が描かれ、`TermTip` の id や `role="status"` が二重になる。
- `go(k)` が `setPerson(null)` を呼ぶ規則(360)はそのまま。**子タブを替えると右は空の状態に戻る**(下の画面が別人の一覧に替わるため、という今の理由のまま)。
- 器(`--pane-max-w`)は App の `.surf-card` の中なので、地は画面の端まで白のまま。

### 4.3 `PersonSheet` → `PersonBody` + `PersonSheet`(写しを作らない)

- `PersonSheet` の BottomSheet の**中身**を `PersonBody({ …同じ props, inPane = false })` に出し、`PersonSheet` は `<BottomSheet ariaLabel=… onClose=…><PersonBody … /></BottomSheet>` だけにする。狭い木の見た目は 1px も変えない。
- `inPane` で変わるのは**3点だけ**:
  1. 本文の器の style: シートでは `{ ...pageStyle, paddingTop: 0, paddingBottom: "var(--sp-6, 40px)" }`(1599)。ペインでは **`subPageStyle`**(paddingTop 0・下 `--sp-4`。screens.jsx:60)── 左ペインのデータ・順位と同じ器を読む(便BN の規則「子タブの行のすぐ下の先頭との余白」も左と同じ 0 になる)
  2. 「目安に設定」の貼り付く器の `bottom`: シートでは `0`(シートのカードが scroll container。1797)。ペインでは scroll container が document なので `0` だと**下部タブの下に潜る**。**`calc(var(--page-bottom-gap) + var(--sp-3))`**(FloatingAction の `bottom` と同じ式。App.jsx:12103)にして、下部タブ・帯の上に留める。右端はペインの右端(sticky は自分の列の中)
  3. `onClose` を読まない(ペインに閉じる操作は無い)
- 変えないもの: 名前の行 / `SegmentedTabs`(データ|プロフィール)/ `SaxTypeRow` / `MetricTabs`(用語の吹き出し)/ グラフ / 凡例 / ブロック・通報の入口 / 「通報しました」の1行 / `BlockConfirmSheet` / `ReportSheet` / `PhotoZoom` / `ADOPT_STICKY_SPACER_H` の空き。
- `pageStyle` の `gridTemplateColumns: minmax(0, 1fr)`(49)はそのまま効くので、長い型番が右ペインを押し広げることは無い。

### 4.4 人物のページの中の操作がペインで成り立つか

| 操作 | 成り立つか | 根拠 |
|---|---|---|
| ブロック(確認のシート → `onBlock`) | 成り立つ。`block(p)` は一覧に足して `setPerson(null)`(CommunityTab.jsx:351-354)→ **右ペインは空の状態に戻り、左の一覧からその人が消える**(`shownDirUsers` が落とす。197) | 変更なし |
| 通報(シート → 送れたら「ブロックしますか」) | 成り立つ。シートは BottomSheet(portal)。「ブロックする」は上と同じ道。「ブロックしない」はシートだけ閉じて右ペインに戻る。「通報しました」の1行は右ペインの末尾に出る(1852-1856) | 変更なし |
| 目安に設定(sticky のボタン) | 成り立つ(§4.3 の 2 で `bottom` を上げる)。押した結果の1行(`ADOPTED_DONE_NOTE`)は右ペインの中(1713-1718) | `bottom` だけ |
| 写真の拡大 `PhotoZoom` | 成り立つ。`createPortal` で body へ・`position: fixed`・z70(PhotoZoom.jsx:46/55)。SwipePager の transform の中に居ても覆える | 変更なし |
| 用語の吹き出し `TermTip` | 成り立つ。箱は `position: relative`(termTip.jsx:159)、吹き出しは `absolute; left:0; right:0`(166)で**箱の幅 = ペインの幅**。三角の x は `face.getBoundingClientRect() − box.left` で箱の中の相対値(149-154)なので、箱がどこに居ても合う | 変更なし。実測で左右の端が画面内に収まることだけ確かめる(§6.4) |
| データ|プロフィールのタブ(`SegmentedTabs`) | 成り立つ(状態は `PersonBody` が持つ。人が替わると作り直される) | 変更なし |

### 4.5 みんなの平均カード・用語の吹き出しの位置

- 平均カード(`.card.card-accent`。screens.jsx:1258)は左ペイン(820 縦で 386 幅)。押すと `CohortAdoptSheet`(BottomSheet・列 640 で中央)。カードの中の `MetricTabs` の吹き出しはカードの箱の幅(§4.4 の TermTip と同じ仕組み)。
- 幅 386 は iPhone 375 の本文 347 より広いので、折れ線(`NoteAxisLineChart` はコンテナ幅に追従。§1.9)もピルの行も iPhone と同じかそれより余裕がある。**744(iPad mini 縦)でペイン 348 が最も狭い**(iPhone 375 と同じ)。
- はじめの一手(参加後 = `adoptAverage`)の的は `[data-coach="adoptAverage"]` = 左ペインの平均カード(1259)。`targetVisible` が「まるごと見えている」を求めるので、カードの高さ(グラフ 190 + 凡例 + 見出し ≈ 400)が縦 820(横向き)の見える範囲(820 − 4 − 47 − inset)に入ることを実測で確かめる(§6.4)。入らなければ案内は出ない(今の規則どおり。スクロールで入れば出る)。

### 4.6 空の状態(右に何も選んでいないとき)── `PaneEmpty`(App.jsx に1つ・screens.jsx からも import)

- 見た目は `Empty`(screens.jsx:381-396)と同じ: `--fs-xs` / `--c-ink-3` / 行間 1.6 / 上下 `--sp-4` / 中央揃え。**新しい体裁を作らない**。ペインの**上端**に置く(左ペインの先頭 = 条件の行 / 箱の見出し と同じ高さから始まる)。
- 文言(用語の禁則: 「機材 / 機種」は使わない。楽器種別は S.Sax 等):
  - リード: 「リードを選ぶと、ここに詳細が表示されます」
  - コミュニティ(データ・順位): 「奏者を選ぶと、ここに詳しいデータが表示されます」
- 縦の中央に置く案も考えたが、ペインの高さは中身で決まり(grid の `align-items: start`)、左の一覧が短いと「中央」が画面の上のほうに来て意味を持たない。上寄せの1行で足りる(§6.0 の「静けさ」)。

### 4.7 参加前の画面(`JoinIntro`。便BS のカード1枚)を2ペインでどう見せるか

- カード(`.coach-card.join-card`)は **幅の上限 `--page-max-w`・中央**(§2.4 の CSS 2行)。中身・文言・ボタンは触らない。
- 裏の見本(`JoinPreviewDataScreen`。CommunityTab.jsx:862-865)は参加後のデータの子タブの「見本」なので、**参加後と同じ2ペインの形**で敷く: `wide` なら `<div style={{maxWidth: "var(--pane-max-w)", margin: "0 auto"}}><SubTabs …/><div className="pane-2"><div><JoinPreviewDataScreen/></div><div><PaneEmpty>奏者を選ぶと、ここに詳しいデータが表示されます</PaneEmpty></div></div></div>`。`inert` の包みはそのまま(触れない見本)。
- 暗幕(`.coach-dim`)は画面いっぱい・下部タブは押せる、のまま。

### 4.8 横スワイプとの関係

- 器の幅 = 4ページの幅(最大 1000)。しきい値 20%。
- 右ペイン(`data-noswipe`)の上では子タブが動かない(人物のページで横に引いても一覧が替わらない。iPhone でシートの上で引いても子タブが動かないのと同じ)。左ペイン・列 640 のページでは今までどおり。
- 人物のページを右ペインで開いたまま横に引いて順位へ移ると `go("rank")` で `person` が消える(今の規則)。

---

## 5. 計測タブ・データタブ(案A)

### 5.1 環の上限を幅で 440 にする仕組み(便BM の縮みの決まりと両立させる)

いまの決まり(App.jsx:9173-9221 / src/measureRingFit.js):

- `maxD = min(fullD, boxW)`、`room = availH − othersH`。`room ≥ maxD` なら `maxD`、足りなければ `floor(room)`、下限 `minD = 236`。**画面ごとに1回・いちばん厳しい状態(メトロノームを開き音量を出した状態)で決める**(統括裁定1)。録音中・シート中・入力中・ピンチ中は据え置く。
- 字の倍率 `ringK = ringScale(diameter, scaleBase)`(7319)。`scaleBase = ringBaseD = maxD`。`ringScale(d, baseD) = min(d, baseD) / baseD`(measureRingFit.js:75-77)── 「枠が狭くて 330 より小さく描かれていても、縮めていなければ 1」。

変更(**この4点だけ**):

1. 定数 `const RING_D_WIDE = 440;` を `RING_D_FULL` の直後(App.jsx:6487)に置く。注記: 「【iPad 本人裁定】幅 ≥ `WIDE_LAYOUT_MIN_W` のときの環の上限。モック案A(環 440・音名 197px)を本人が選んだ。330 × 4/3」。
2. `MeasureView` は `wide` を props で受け、`ringFitArgs({ …, fullD: wide ? RING_D_WIDE : RING_D_FULL, minD: RING_D_MIN })`(9214)。`useLayoutEffect` の依存に `wide` を足す(9221)。`RING_D_MIN` は **330 から導いたまま**(236。6558。セント値 21px × 236/330 = 15.02 ≥ `--fs-md` 15 の論理は変わらない)。
3. 字の基準は**正典の 330 を越えない**: `setRingBaseD((prev) => nextRingDiameter(prev, Math.min(args.maxD, RING_D_FULL), held))`(9220)。iPhone では `maxD ≤ 330` なので今と同じ値(375 → 330 / 320 幅 → 292)。iPad では `maxD = 440` → 基準 330。
4. `ringScale(d, baseD)` を **`d / baseD`** にする(`min` を外す)。iPhone では常に `d ≤ baseD` なので値は 1つも変わらない(測定: `ringScale(330,330)=1` / `(292,292)=1` / `(291,292)` / `(236,330)` は既存の検査 measureRingFit.test.js:119-133 がそのまま通る)。iPad では `440/330 = 1.333…` → 音名 148 × 4/3 = **197.3px**、オクターブ 58.7、セント値 28、間 13.3。横向きで高さに縛られて 330 前後に縮めば `≈ 1`(iPhone と同じ字)。

結果(いちばん厳しい状態で決める規則はそのまま):

| 画面 | `availH` ≈ | `room` ≈ | 直径 | 字の倍率 |
|---|---|---|---|---|
| 375×812(iPhone) | 761 | ≥ 330 | **330**(不変) | 1 |
| 375×667(iPhone SE) | 616 | < 330 | 236〜246(不変。便BM) | d/330 |
| 820×1180(iPad 縦) | 1129 − inset | ≫ 440 | **440** | 4/3 |
| 1032×1376(iPad 13 縦) | ≫ | ≫ 440 | **440** | 4/3 |
| 1180×820(iPad 横) | 769 − inset(20) ≈ 749 | ≈ 320〜340 | **≈ 330**(高さが決める。便BM の縮みがそのまま働く) | ≈ 1 |

- `PitchRing` の外枠は `maxWidth: diameter`(7588)で列 640 の中央。`viewBox 300` 固定なので線の太さ(14)・振り子・拍の点は直径と一緒に 4/3 倍(§6.1「実寸 = viewBox × 直径/300」)。
- `RING_D_FULL` を 330 のまま残すのは pitch-test 3410(「既定の直径は RING_D_FULL(330)」)と 2319(`PitchRing` の署名)を守るため。`PitchRing` の署名は変えない。
- 字の最小(§4.2 演奏中サーフェスの 15px)は縮むときの話で、大きくなる側は縛りが無い。音名 197px の環内周とのクリアランスは比が保たれるので 330 の実測(App.jsx:6520-6532)と同じ比率(`§4.2` の 10% 要件は比例で保たれる)。
- `measureMinH`(`useFillViewportHeight`。8798)・`PAGE_TOP_PAD`・`--page-bottom-gap` は触らない。

### 5.2 データタブ ── 列 640 だけ

- AnalysisLabView の3つの return の内箱(My Data / 分析 17425、セッション詳細 17322→18226、すべてのセッション 17393→内側)と告知の内箱(17443)を `var(--page-max-w)` に(§2.2)。
- セッション詳細は画面(`SwipeBackArea` の中の `SessionDetailView`)で、列 640 の中央に出る。そこから開くシート(リードの紐づけ・奏者など BottomSheet)は **640 で中央**(§2.2 の BottomSheet)。
- 「録音を取り込む」の FloatingAction(11002)は列の右下にそろう(§2.3 の既定)。
- カレンダーのマスは 7 列 → (640 − 32)/7 ≈ **87×44**(モック案Aの値)。累計・指標のカードは列いっぱい。

### 5.3 横向き 1180×820 の見え方(案Aのまま)

- 計測: 列 640 が中央(x = 270〜910)。環は高さで ≈ 330 に縮む(§5.1 の表)。設定行は列の左端から。録音ボタンは下端固定。下部タブ 640 が中央(x = 270〜910)で、本文と揃う。**左右に 270 ずつ余白が出る**── これは本人が承知の上で採った形(統括のおすすめ「横だけ2ペイン」を採らなかった)。
- データ: 列 640 中央。カードは縦に流れ、下はスクロール(モック A_LAND の絵)。
- リード・コミュニティ: 器 1000 中央(x = 90〜1090)。ペイン 490 ずつ。比較・シェア・マイページは器の中の列 640(x = 270〜910)。

---

## 6. 実装の順序と分け方・触るファイル・検査

### 6.1 便の分け方(3便。1便ごとに3ゲート: `npm run test` / `node scripts/pitch-test.mjs` / `npm run build`)

本人の端末は PowerShell 5.1 なので、渡すコマンドは `;` でつなぐ(`&&` は構文エラー)。vitest の「PASS (0)」は合格ではない(メモリ)。

| 便 | 中身 | iPhone が変わらない理由 |
|---|---|---|
| **便1 案Aの土台** | §2.1 トークン2つ(index.css + tokens.mjs + DESIGN-SYSTEM §3)/ §2.2 `maxWidth: 900`×11 と `480` → トークン / §2.3 FloatingAction の既定の `right` / §2.4 coach-card・join-card の上限 / §1.2 `useWideLayout` + `WIDE_LAYOUT_*` / §5.1 環 440(`RING_D_WIDE`・`ringScale`・`ringBaseD`)/ 検査(§6.3 の便1ぶん) | 全部「375 では上限に届かない」か「max() が今の値を選ぶ」か「`wide` が false」 |
| **便2 リード 案B** | §3 全部(ReedsTab の3つ目の return / `paneReed` / `PaneEmpty` / `DetailHeader` の戻る無し / FloatingAction `pane` / `actionsActive` / `coachSuppressed`)/ 検査 | 狭い木の2つの return は byte 単位で不変 |
| **便3 コミュニティ 案B** | §4 全部(`PersonBody` の切り出し / `JoinedView` の広い木 / `JoinIntro` の見本の2ペイン)/ 検査 | 狭い木の return は不変。`PersonSheet` = BottomSheet + PersonBody(見た目同値) |
| (殻) | Capacitor の `Info.plist`: `UISupportedInterfaceOrientations~ipad` に4方向、`UIRequiresFullScreen` は書かない。リポジトリに `ios/` は無いので**本人の宿題**。`public/manifest.webmanifest` の `"orientation": "portrait"`(9行目)は iOS が読まないので据え置き(Android の PWA の縦固定を今回動かさない) | ─ |

便1だけでも「iPad で引き伸ばしに見えない」状態(審査の最低線)になる。便2・便3は独立(どちらが先でもよい)。

### 6.2 触るファイルと部品(一覧)

| ファイル | 触る所 |
|---|---|
| `src/index.css` | `:root` に `--page-max-w` `--pane-max-w` / `.pane-2` / `.coach-card` の left/right / `.join-frame` `justify-content` / `.join-card` `max-width` |
| `design/canvas/tokens.mjs` | 2トークンの写し(便BF の節が突き合わせる) |
| `design/DESIGN-SYSTEM.md` | §3 レイアウト定数に2行 / §4.5 に「面 = iPad では列・ペイン」の1文 / §4.5b にカードの上限 / 新節「iPad の器」(この文書の §1〜§2 の要約) |
| `src/App.jsx` | `WIDE_LAYOUT_MIN_W` `WIDE_LAYOUT_QUERY` `useWideLayout` `PaneEmpty`(export)/ `RING_D_WIDE` / MeasureView(`wide`・fullD・ringBaseD)/ BottomNav 480 / FloatingAction `pane` / ReedsTab 広い木 / ReedRegisterView `pane` `coachSuppressed` / ReedEvaluationDetail `pane` `actionsActive` / DetailHeader `onBack` 無し / `maxWidth: 900` ×11 / App() で `wide` を配る |
| `src/measureRingFit.js` | `ringScale` の `min` を外す(注記を書き換える) |
| `src/community/CommunityTab.jsx` | `JoinedView` 広い木 / `JoinIntro` 見本の2ペイン / `CommunityTab` が `wide` を受けて配る |
| `src/community/screens.jsx` | `PersonSheet` → `PersonBody` + `PersonSheet` / `PaneEmpty` の import |
| `scripts/pitch-test.mjs` | 6884・13043 の綴り / 新節「iPad」(§6.3) |
| `src/measureRingFit.test.js` | `ringScale(440, 330)` / `fitRingDiameter` の fullD 440 |
| 新規 `src/wideLayout.test.jsx` | 広い木の描画(§6.3) |

### 6.3 検査の作り方 ── 「375 は今のまま通し、820 / 1032 / 1180×820 を足す」

**(a) 今の検査は1つも書き換えない**(綴りだけを直す 6884・13043 を除く)。jsdom に `matchMedia` が無いので、既存の全検査は狭い木を描く。`npm run test` と pitch-test の合格数が**減らないこと**を便ごとに記録する。

**(b) 純関数(vitest。`src/measureRingFit.test.js` に足す)**
- `ringScale(440, 330)` = 4/3、`148 × … ≈ 197.33`、`21 × … = 28`。既存の 4 件(330/292/291/236)はそのまま。
- `fitRingDiameter({ availH: 1100, othersH: 500, maxD: 440, fullD: 440, minD: 236 })` = 440 / `({ availH: 749, othersH: 420, maxD: 440, … })` = 329(足りない分だけ) / `maxD: Math.min(440, 347)` = 347(枠で頭打ち)。
- `ringFitArgs` の `maxD` が `min(fullD, boxW)` のまま(fullD 440・boxW 640 → 440 / boxW 347 → 347)。

**(c) 綴り(pitch-test に新節「iPad」。他の節は触らない)**
- `WIDE_LAYOUT_MIN_W === 700` と、`WIDE_LAYOUT_QUERY` がそれを読む綴り。index.css に `@media (min-width` が**増えていない**(しきい値が CSS に写っていない)。
- `App.jsx` に `maxWidth: 900` / `maxWidth: 480` が **0 件**(数字の直書きが戻らない)。
- index.css と tokens.mjs の `--page-max-w: 640px` / `--pane-max-w: 1000px` が一致(便BF の節に2鍵を足すだけでもよい)。
- `.pane-2` が `grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)` と `column-gap: var(--sp-5)` を持つ。
- `ringScale` の本文が `return d / baseD;`。`setRingBaseD` の引数が `Math.min(args.maxD, RING_D_FULL)`。`ringFitArgs` に `fullD: wide ? RING_D_WIDE : RING_D_FULL`。
- `FloatingAction` の `right` が3つの式(§2.3 の表)を `pane` で選ぶ。
- `ReedsTab` に `if (wide)` の return があり、その中に `className="surf-rule"` と `className="surf-card"` が**兄弟**として在る(同じタグに同時に付いていないのは 6659 がそのまま見る)。狭い木の2つの return の綴りが**変更前と同一**(git の diff で確認する手順を実装の報告に書く)。
- `PersonSheet` の本文が `<BottomSheet …><PersonBody` の形だけ(本文の写しが残っていない: `SegmentedTabs ariaLabel="表示する内容"` が screens.jsx に **1 回**)。

**(d) 広い木の描画(新規 `src/wideLayout.test.jsx`。jsdom + `window.matchMedia` のモック)**
- `matchMedia` を `{ matches: query === WIDE_LAYOUT_QUERY, addEventListener(){}, removeEventListener(){} }` にして App を描く。
- 広い: リードタブに `.pane-2` が1つ・左に `.surf-rule`・右に `.surf-card` と `data-noswipe`。右が空なら「リードを選ぶと、ここに詳細が表示されます」。タイルを押す(`onTileTap`)と右に `DetailHeader` の見出しが出て、**戻るの `< 一覧` が無い**、ページが替わらない(`.pane-2` が残る)。`[data-coach="reedsMeasure"]` は **常に 1 個以下**(右が空 → タイル / 右にリード → 計測ボタン)。比較へ `setReedsSubTab("compare")` すると body に「このリードで計測する」の button が**無い**(`actionsActive`)。
- 広い: コミュニティ(参加済みの見本は `subTabGap.test.jsx` の `SERVER_*` を流用)でデータの行を押すと `.pane-2` の右に人物の名前が出て、`role="dialog"` の BottomSheet は**開かない**。`go("rank")` で右が空の文言に戻る。ブロック(`BlockConfirmSheet` → ブロックする)で右が空・左の一覧からその人が消える。
- 狭い(`matches: false`): 上の操作で BottomSheet が開く・`.pane-2` が **0 個**(今の挙動の固定)。
- 広い: `JoinIntro` の見本が `.pane-2` の中に `JoinPreviewDataScreen` を持つ。

**(e) 実寸(dev サーバ `ficus-dev` + Browser の `resize_window`。本人の実機の代わりではない ── 罠15)**

測り方は便BM と同じ(`getBoundingClientRect`)。数は**この表の値**と突き合わせる(便ごとに全部測る)。

| 測るもの | 375×812(不変の確認) | 820×1180 | 1032×1376 | 1180×820 | 744×1133 |
|---|---|---|---|---|---|
| 本文の列の左右(計測・データ) | 14 / 361 | 90 / 730 | 196 / 836 | 270 / 910 | 52 / 692 |
| 下部タブの内箱の幅 / 1つ(内側 20 を除く) | 375 / 83.75 | 640 / 150 | 640 / 150 | 640 / 150 | 640 / 150 |
| 環の直径 / 音名の font-size | 330 / 148 | 440 / 197.33 | 440 / 197.33 | 300〜345 / 比例 | 440 / 197.33 |
| 環の上端(設定行の下)・録音ボタンの上端 | 96 / 616(便BM の実測と同じ) | 記録する | 記録する | 記録する | 記録する |
| リード: 器の左右 / ペインの幅 | ─(列 347) | 14 / 806 ・ 386 | 16 / 1016 ・ 490 | 90 / 1090 ・ 490 | 14 / 730 ・ 348 |
| リードのタイル1枚(5列・gap 10) | 61.4 | 69.2 | 90 | 90 | 61.6 |
| ＋ の右端 / 計測の右端(2ペイン) | 361 / ─ | 400 / 806 | 506 / 1016 | 580 / 1090 | 362 / 730 |
| コミュニティ: ペインの幅 / 人物の「目安に設定」の下端 | ─ | 386 / 下部タブの上 12 | 490 / 同 | 490 / 同 | 348 / 同 |
| BottomSheet の幅 / 左端 | 375 / 0 | 640 / 90 | 640 / 196 | 640 / 270 | 640 / 52 |
| はじめの一手のカードの幅 | 331 | 640 | 640 | 640 | 640 |
| 参加のカードの幅 | 331 | 640 | 640 | 640 | 640 |
| 用語の吹き出し(平均カード・人物)の左右が画面内 | 便BI の実測と同じ | 確認 | 確認 | 確認 | 確認 |
| はじめの一手(参加後)の的(平均カード)が見える範囲に収まるか | ─ | 確認 | 確認 | 確認(横 820 が最も厳しい) | 確認 |

- 「1px も変わらない」の判定は **375 の列を変更前のツリーでも同じ手順で測って比べる**(罠16: 変更前も同じ手順で測る)。
- 1180×820 の環は高さで決まるので「幅 ≥ 700 なら 440」ではなく **330 前後**になる。440 と書いてしまわないこと。
- Split View の境: 600×820(狭い木: 列 572・`.pane-2` 無し・環 330)と 700×820(広い木: ペイン 326・環は高さで ≈ 330)。
- dev サーバでコミュニティを描くにはモックのデータが要る(メモリ「dev サーバ実測の罠」: マイクの暗幕は JS クリックで回避・コミュニティは描かれない・空データの作り方)。入れたデータは消す。

### 6.4 実装役への注意(踏みやすい所)

1. **狭い木の return を 1 文字も動かさない。** 広い木は「足す」。差分で既存 return の行が出たら手戻り。
2. `SwipePager` の中に `position: fixed` を**直に**置かない(track の `transform` が包含ブロックになる。§6.3 / App.jsx:371)。浮かせる物は全部 `createPortal`(FloatingAction / BottomSheet / PhotoZoom は既にそう)。
3. `.surf-rule` と `.surf-card` を同じタグに付けない・入れ子にしない。広い木では**兄弟**(§3.2)。
4. `useWideLayout` は `matchMedia` が無い環境で false を返し、購読もしない(jsdom)。
5. `FloatingAction` の `right` の式は `max()` と `calc()` の中の `var()`。インライン style の文字列でよい(React は値を素通しする)。
6. `.coach-card` の `left/right` を変えるとき、`COACH_EDGE_PX = 22`(onboarding.jsx:62)は**触らない**(穴とカードの間隔の値で、横の位置ではない)。
7. `ringScale` の注記(measureRingFit.js:72-74)を「基準は縮めないときの直径(iPhone)/ 正典の 330(iPad。440 なら 4/3)」に書き換える。
8. pitch-test は CRLF を潰して読む(先頭の注記)。綴りを見る正規表現は改行をまたぐので、JSX の改行位置を変えると落ちる ── 落ちたら**検査の期待値を今の綴りに合わせる**のではなく、落ちた理由を読む。
9. 便BF の節(tokens.mjs の写し)は**実値**で突き合わせる。`--pane-max-w` を片方だけ書くと落ちる。

---

## 7. 本人に追加で聞く分かれ道(2つ。どちらも既定を書いてあるので、返事が無ければ既定で進める)

**(1) リードのタイルの列数(2ペイン・横向きのとき)**
- 既定 **ア: 5列固定**(正典 `.rgrid` の 5列・箱 = 5×2 の形を保つ)。タイルは 820 縦で 69px、1180 横で **90px**(iPhone 61 の 1.5 倍)。コードは触らない。
- イ: 幅から列数を決めて 60px 台を保つ(1180 横で 7〜8 列)。箱の 10 枚が 5×2 に並ばなくなる。`REED_GRID_COLS` を関数にする(pitch-test 355 / 14064 が定数として読んでいるので検査も変わる)。
- 聞く理由: 90px のタイルは本人の目に明らかに映る差で、箱の形(5×2)を本人がどれだけ大事にしているかで答えが変わる。

**(2) 浮かせるボタン(＋ / 計測 / 録音を取り込む)の右端**
- 既定 **ア: 列・ペインの右下にそろえる**(§2.3。「主要動作は面の右下」の面を列・ペインと読む。2ペインで ＋ と 計測 が同じ角に重ならない)。＋ は 820 縦で画面中央の少し左(x ≈ 400)に浮く。
- イ: モックのとおり画面の右端から 14 のまま(列から 76〜270 離れる)。2ペインでは ＋ と 計測 が同じ角に来るので、＋ を 計測 の**上**に積む(bottom を 56 + 12 上げる)。
- 聞く理由: モックは イ で描いてあり、本人が見た絵と違う。

決めてよいとしてこの文書が決めたもの(本人の目に触れるが小さい): 右ペインの空の状態の文言と上寄せ(§4.6)/ 右ペインの初期表示 = 計測タブで選んでいるリード(§3.3)/ 比較・シェア・マイページは列 640(§3.5 / §4.2)/ はじめの一手と参加のカードの上限 640(§2.4)/ 右ペインを押しても編集は終わらない(§3.7)/ 子タブを替えると右は空に戻る(§4.2)。

---

## 付録A. 寸法の計算(全部 CSS px。左右の余白 14 は `--page-side-pad`。安全域は 0 とした)

| 幅 W | 本文 W−28 | 列 min(640, 本文) | 列の左端 | 器 min(1000, 本文) | ペイン (器−20)/2 | 下部タブ 1つ (内箱−40)/4 |
|---|---|---|---|---|---|---|
| 375 | 347 | 347 | 14 | ─ | ─ | 83.75 |
| 600(Split) | 572 | 572 | 14 | ─(狭い) | ─ | 140 |
| 700(境) | 672 | 640 | 30 | 672 | 326 | 150 |
| 744(mini 縦) | 716 | 640 | 52 | 716 | 348 | 150 |
| 820(11 縦) | 792 | 640 | 90 | 792 | 386 | 150 |
| 1032(13 縦) | 1004 | 640 | 196 | 1000(左端 16) | 490 | 150 |
| 1180(11 横) | 1152 | 640 | 270 | 1000(左端 90) | 490 | 150 |
| 1366(13 横) | 1338 | 640 | 363 | 1000(左端 183) | 490 | 150 |

- タイル(5列・gap 10)= (ペイン − 40)/5: 348 → 61.6 / 386 → 69.2 / 490 → 90。
- 環の字: 直径 d のとき 音名 148 × d/330、オクターブ 44 × d/330、セント値 21 × d/330、間 10 × d/330。

## 付録B. 根拠の位置(この文書が読んだ所)

- 裁定・規範: `design/DESIGN-SYSTEM.md` §3(949-1046 余白・レイアウト定数)/ §4.5(1218 シートは器を1つ・主要動作は面の右下)/ §4.5a(1253 重なり順)/ §4.5b(1278 はじめの一手・参加の画面)/ §6.1.5(1683 レイアウトの安定)/ §6.3(1774 横スワイプ・1808 transform の罠)/ §6.6(1945 面の作法・D-29 2039)
- トークン: `src/index.css` 261-280(`--nav-h` `--ad-h` `--page-bottom-gap` `--page-side-pad`)/ 346(`.app-root`)/ 482-529(`.surf-rule`)/ 557-581(`.surf-card`)/ 780-791(シートの動き)/ 815-859(はじめの一手・参加のカード)/ 1051-1083(`.reedtile`)。写し `design/canvas/tokens.mjs` 24-66
- App.jsx: 170 `PAGE_TOP_PAD` / 196-244 `useRingFitLayout`(198 で innerWidth)/ 246 `useFillViewportHeight` / 371 track の transform / 427 `SwipePager`(509 `data-noswipe`)/ 1117 `SwipeBackArea` / 3716 ActionNotice / 5075 `.app-root` / 5116-5135 リードの mount / 5174-5185 エラー / 5210 計測の根 / 5297-5349 コミュニティの根 / 5357 ActionNotice / 5360 BottomNav / 5375-5382 OnboardingCoach / 5406-5471 BottomNav(480)/ 5513 AdPreviewStrip / 6487 `RING_D_FULL` / 6499-6502 音名の実寸 / 6557-6558 下限 / 7298-7319 PitchRing・ringK / 7588 外枠 / 8644 MeasureView / 9187-9221 環の縮み / 9226 計測の maxWidth / 9520 ringBox / 10132 保存の確認 / 10820 ReedScoreEditor / 11002 My Data の FAB / 11234 `REED_GRID_COLS` / 11428 ReedTileGrid / 11726 ReedSaxChipRow / 11765-11953 ReedsTab / 11970 ReedNumberSheet / 12066-12129 FloatingAction / 12826-12954 ReedRegisterView(12901 onTileTap・12904 coachFirst・12945 ＋)/ 13550 ReedCompareTab / 14306-14456 ReedEvaluationDetail(14373 maxWidth・14374 DetailHeader・14442 計測)/ 15705 SubTabs / 15949-16017 BottomSheet(15991 maxWidth)/ 16249-16277 DetailHeader / 17182 AnalysisLabView(17322・17393・17424-17443)/ 18168・18226 SessionDetailView
- measureRingFit.js: 44-51 `ringFitArgs` / 59-64 `fitRingDiameter` / 68-70 `nextRingDiameter` / 75-77 `ringScale`
- onboarding.jsx: 60 `COACH_Z` / 62 `COACH_EDGE_PX` / 74-126 一手の表(102-107 リード2)/ 236 `targetVisible` / 242 `holeOf` / 259 `placeCoachCard` / 399-433 `measure`(416 querySelector)
- termTip.jsx: 146-155 三角の位置 / 159 箱 / 166 吹き出し
- CommunityTab.jsx: 171 JoinedView / 177 person / 351-360 block・go / 362-411 return / 439 CommunityTabBody / 784-872 JoinIntro
- screens.jsx: 49-60 pageStyle・subPageStyle / 84-89 目安に設定の空きとボタン / 381-396 Empty / 635 RankScreen / 801 ShareScreen / 1128 DataScreen(1258 平均カード・1312 CohortAdoptSheet・1336-1350 一覧の行)/ 1477-1862 PersonSheet(1579 showAdopt・1592 BottomSheet・1599 pageStyle・1788-1811 sticky・1814-1859 重ねるシート)
- PhotoZoom.jsx: 46 createPortal / 55 fixed z70
- pitch-test.mjs: 2319 PitchRing の署名 / 3410 既定の直径 / 4730 W=375 / 6421-6441 作法の一覧 / 6659 同時付与の禁止 / 6873 計測の根 / 6884 My Data の return / 6890・6898 詳細・すべての return / 13043 BottomSheet の綴り / 13837-13841 ringK の綴り / 14064-14069 タイル ≥ 44
- 検査: `src/measureRingFit.test.js` 119-133(ringScale)/ `src/subTabGap.test.jsx`(アプリ全体を描く手本・SERVER_* の見本データ)/ `src/onboardingApp.test.jsx:593`
- モック: `scratchpad/ficus-ipad.html` 118-132(現状の実測)/ 137(案A)/ 149(案B)/ 172-186(おすすめ・触るものの表)/ 437-443(各案の寸法: A = colW 640・ringD 440、B = ペイン 386、B_LAND = colW 1000・ペイン 490)
