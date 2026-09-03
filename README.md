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

### デプロイ先には環境変数の設定が要る（コミュニティ機能）

`.env.local` は**リポジトリに入れていない**（Firebase の接続設定なので）。
Vite は `import.meta.env.VITE_*` を**ビルド時に**埋め込むため、デプロイ先で
ビルドする場合は、その環境に同じ4つを設定しないとコミュニティタブが動かない。

| 変数名 | 内容 |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase コンソール → プロジェクトの設定 → ウェブアプリの `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | 同 `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | 同 `projectId` |
| `VITE_FIREBASE_APP_ID` | 同 `appId` |

- Vercel: Settings → Environment Variables に4つ追加 → **再デプロイ**（既存のビルドには反映されない）
- Netlify: Site configuration → Environment variables に4つ追加 → **再デプロイ**

設定が欠けたままだと、コミュニティタブが
「この配信ではコミュニティを利用できません（アプリの接続設定が読み込めていません）」
と表示する。**電波の問題ではないので、待っても再試行しても直らない。**
計測・リード・データの3タブは Firebase を使わないので、設定が無くても通常どおり動く。

