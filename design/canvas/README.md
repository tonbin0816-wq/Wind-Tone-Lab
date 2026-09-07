# Claude Design キャンバス(Ficus 画面カタログ)

**本人が pptx のように直接いじるための実寸モック。**`src/` の「現状」を写したもので、
**提案ではない**。いずれも 375px 幅 = 実機幅。

- 公開先: https://claude.ai/code/artifact/9cee0670-3053-4e82-aa82-6f08a9a1134b
- `canvas.json` … 配置・ページ・付箋

## 面(ページ)

| ページ | 中身 |
|---|---|
| レイアウトの方向案 | My Data の初期4案(R1〜R4) |
| D-9 反映 | My Data の現状(Full / Main / Centroid / Windows)と分析タブ上部・系列シート |
| 検討した案 | 不採用の記録(StackA / PlanA / CompareB / PlanD) |
| レイアウト刷新案 | S1・S1open・S2・S3・A1・A2・Chips |
| **コミュニティ** | **データ / 順位 / シェア / マイページ / 人をタップ(表・裏)** |

My Data 側の本文幅は 347px(375 − 左右余白 14px)。コミュニティ側は 343px
(375 − 左右余白 `--sp-4` = 16px)。**同じ 375px でも余白が違うのは実装がそうだから**で、
揃えてはいけない(揃えるなら先に実装を揃える)。

## 作り直し方

```bash
node design/canvas/generate.mjs      # My Data 系の .dc.html
node design/canvas/community.mjs     # コミュニティ系の .dc.html
```

トークンと `.dc.html` の外枠は `tokens.mjs` が持つ(両方の生成器が読む)。
**写しを2つ作らない** ── 未定義のカスタムプロパティは transparent 扱いで黙って消えるので、
片方だけ直すと色が抜ける事故になる(過去に1度起こしている)。

- `generate.mjs` の幾何(`layout()`)は `NoteAxisLineChart` の `L()` を、色と段は
  `divergingStep` / `matrixCellPaint` を写している。**App.jsx を直したら追随させること**。
- `community.mjs` は `src/community/screens.jsx` と `CommunityTab.jsx` を写している。
  折れ線は `LineChart`、円は `PieChart` の `arcPath` をそのまま移した。
  アイコンの絵柄は `icons.jsx` から**その場で抜いて**埋めるので、貼り直す必要は無い。
  **数値の唯一の答えは実装側**。

### 本人がキャンバス上で直したものは上書きしない

`Main.dc.html` / `Windows.dc.html` / `A1.dc.html` は本人の手直しが正なので、
`generate.mjs` は既定で書き換えない(`--regen-baseline` を付けたときだけ作り直す)。
**公開中のキャンバスを取り込んでから触ること** ── 手順は `design` スキルの
`seed-canvas.mjs --extract` で、取り出した中身を編集して再び種として渡す。
リポジトリの `.dc.html` を直に種にすると、本人の手直しが消える。

`ficus-screens.html`(エディタ同梱・約2.6MB)は成果物なので **git に入れない**。

## 入っていないもの

- **練習カレンダー**(`PracticeCalendarCard`)。D-1c(マスが正典の 34px ではなく 44px)は
  別件で実機待ち
- コミュニティの**参加前の画面**(`JoinIntro`)と**プロフィール作成フォーム**(`ProfileForm`)
- 数値と人名は**ダミー**。実データではないので、値そのものを読み取らないこと
