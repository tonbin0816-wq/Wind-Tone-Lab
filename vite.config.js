import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // 【殻 S2】Capacitor の部品だけでできた別チャンク(@capacitor/core の共有分・プラグインの Web 実装)は名前に
        // .native を付ける。どれも殻の枝の動的 import(src/shell/*.native.js)からしか読まれないが、既定の名前だと
        // @capacitor/core の共有分が index-*.js になり、Web のメインチャンクと見分けがつかない(殻の仕様 §8.3 の検査)。
        // 名前を変えるだけで、チャンクの切り方と中身は変えない。それ以外のチャンクは Vite の既定の名前のまま。
        chunkFileNames: (chunk) =>
          chunk.moduleIds.length > 0 && chunk.moduleIds.every((id) => /[\\/]node_modules[\\/]@capacitor(-community)?[\\/]/.test(id))
            ? "assets/capacitor-[name].native-[hash].js"
            : "assets/[name]-[hash].js",
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    // 【worktree の中を走査させない】このリポジトリは .claude/worktrees/ 配下に
    // 作業用の複製を持つことがある。既定の除外にこれが入っていないため、
    // 複製側のテストまで拾って**同じテストを二重に数える**(実測で 137 → 274 になった)。
    // 数が増えるだけなら害は小さいが、複製が別のブランチだと**古いテストが混ざり**、
    // 本体を直していないのに緑になったり、その逆が起きる。
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/worktrees/**"],
    // 【殻 S3】AdMob のプラグインは ESM の入口(dist/esm/index.js)を Vite に通して読む(検査の中だけの設定。ビルドの出力は変わらない)。
    // 素の名前だと検査では package.json の main(CommonJS の dist/plugin.cjs.js)に解決され、その中の require("@capacitor/core") が
    // vi.mock を素通りして本物を読む。本物は読まれた瞬間に window.Capacitor を自分の版で上書きする(jsdom では isNativePlatform() が
    // false になる)ので、殻を作り物で描く検査(shellApp.test.jsx など)の途中で殻の判定が Web に化け、スリープ防止やマイクの止め方の
    // 検査が偽の理由で落ちる。実機では起きない(ビルドは module の ESM を使い、window.Capacitor は殻が先に置く)。
    alias: [{ find: /^@capacitor-community\/admob$/, replacement: fileURLToPath(new URL("./node_modules/@capacitor-community/admob/dist/esm/index.js", import.meta.url)) }],
    server: { deps: { inline: ["@capacitor-community/admob"] } },
  },
})
