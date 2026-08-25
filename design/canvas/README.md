# Claude Design キャンバス(My Data)

**本人が pptx のように直接いじるための実寸モック。** D-8 直後の `src/App.jsx` の
「現状」を写したもので、**提案ではない**。

- 公開先: https://claude.ai/code/artifact/9cee0670-3053-4e82-aa82-6f08a9a1134b
- アートボード3枚(いずれも 375px 幅 = 実機幅。左右余白 14px を引いた本文幅 347px):
  - `Main.dc.html` … 平均差分 × 折れ線(0中心 + 「合っている」帯 + 凡例 + 重ねた軸ラベル)
  - `Centroid.dc.html` … 重心 × 折れ線(実数 + 比較対象の破線)
  - `Windows.dc.html` … 平均差分 × 窓型(8段の発散スケール + 帯の灰 + 2枚)
- `canvas.json` … 3枚の配置と付箋

## 作り直し方

```bash
node design/canvas/generate.mjs      # .dc.html を書き出す
```

幾何(`layout()`)は `NoteAxisLineChart` の `L()` を、色と段は
`divergingStep` / `matrixCellPaint` を写している。**App.jsx を直したら
generate.mjs も追随させること**(数値の唯一の答えは App.jsx 側)。

`ficus-my-data.html`(エディタ同梱・約2MB)は成果物なので **git に入れない**
(`.gitignore` 済み)。`design` スキルの `seed-canvas.mjs` で作り直す。

## 入っていないもの

- **練習カレンダー**(`PracticeCalendarCard`)。D-1c(マスが正典の 34px ではなく 44px)は
  別件で実機待ちのため、この3枚には含めていない
- 数値は**ダミー**。実データではないので、値そのものを読み取らないこと
