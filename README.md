# Ficus

サックス練習支援アプリ。マイクからリアルタイムに音を解析し、ピッチ・倍音構成・スペクトル重心・HNR等を理論値/理想値と比較する。

詳細な機能仕様は [docs/wind-tone-lab-plan.md](docs/wind-tone-lab-plan.md) を参照。

## セットアップ

```bash
npm install
npm run dev
```

`http://localhost:5173` を開き、マイクへのアクセスを許可する。

## ビルド

```bash
npm run build
```

## デプロイ（iOS Safari含む実機テスト用）

マイク入力（`getUserMedia`）は HTTPS または `localhost` でのみ動作する。実機（iPhone等）でテストするには Vercel か Netlify にデプロイし、発行された HTTPS URL でアクセスする。

- Vercel: リポジトリを Import → Framework は Vite を自動検出 → Build command `npm run build` / Output directory `dist`
- Netlify: リポジトリを Import → Build command `npm run build` / Publish directory `dist`
