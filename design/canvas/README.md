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
| **統一の比較** | **UnifyPad / UnifySheet / UnifyAction / RankColor ── 裁定のために「いま何種類あるか」を並べた絵** |

本文幅は3種類ある。いずれも **`app-root` の左右 14px の内側**にさらに足す形なので、
実測(2026/09/09・375px 実機幅)はこうなる:

| どこ | 足す分 | 本文幅 | カード内の文字の左端 |
|---|---|---|---|
| My Data・分析・詳細2画面 | なし | 347px | 30px |
| リードタブ | +10（`REED_LIST_EXTRA_PAD_PX`） | 327px | 40px |
| コミュニティ | +16（`pageStyle` の `--sp-4`） | 315px | 46px |

**同じ 375px でも余白が違うのは実装がそうだから**で、モックの側で揃えてはいけない
(揃えるなら先に実装を揃える。裁定待ちは `design/UNIFY-AUDIT.md` の B10)。
> **2026/09/09 に1度間違えた。** ここには「コミュニティは 343px(375 − `--sp-4`)」と
> 書いてあり、`community.mjs` もそう作られていた。`--sp-4` は `app-root` の 14px を
> **置き換えるのではなく内側に足す**ので、28px ぶん外枠が広すぎた。ブラウザで実測して直した。

## 作り直し方

```bash
node design/canvas/generate.mjs      # My Data 系の .dc.html
node design/canvas/community.mjs     # コミュニティ系の .dc.html
node design/canvas/unify.mjs         # 統一の比較(Unify*.dc.html)
node design/canvas/rankcolor.mjs     # 順位色のコントラスト(RankColor.dc.html)
node design/canvas/rankshine.mjs     # 順位色 金と銅を離して光らせる(RankShine.dc.html)
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
- `unify.mjs` は**提案ではなく実測の展示**。`UNIFY-AUDIT.md` の B10 / C14-16 / D6 / D7 を、
  文章では判断できないという本人の指摘を受けて絵にしたもの。**寸法をここで発明しない** ──
  数字はすべてブラウザで測ったか、実装のコードから拾ったもの。

### 取り込んだキャンバスを無条件に正典にしない

`Main.dc.html` / `Windows.dc.html` は本人がキャンバス上で直したものが正なので、
`generate.mjs` は既定で書き換えない(`--regen-baseline` を付けたときだけ作り直す)。

**ただし「公開中のキャンバスにある版」＝「新しい版」ではない。** 公開が古ければ、
取り込んだものはリポジトリより**古い**。2026/09/08 に実際にこれを踏んだ:
`A1.dc.html` を「本人の手直しが入っている」と誤読して公開版で上書きしたが、
中身は D-10c(2026/08/26 本人裁定で軸の行を3カラムの格子へ作り直した)より**前**の写しだった。

**判別のしかた**: 取り込んだ版と `generate.mjs` の出力が違ったら、
まず `node scripts/pitch-test.mjs` を通すこと。**この検査は
`design/canvas/*.dc.html` を正典として読んでいる**(A1 は D-10c、S1 は影と寸法)ので、
古い版で上書きすると検査が落ちる。落ちたら上書きが間違い。

`ficus-screens.html`(エディタ同梱・約2.6MB)は成果物なので **git に入れない**。

## 入っていないもの

- **練習カレンダー**(`PracticeCalendarCard`)。D-1c(マスが正典の 34px ではなく 44px)は
  別件で実機待ち
- コミュニティの**参加前の画面**(`JoinIntro`)と**プロフィール作成フォーム**(`ProfileForm`)
- 数値と人名は**ダミー**。実データではないので、値そのものを読み取らないこと
