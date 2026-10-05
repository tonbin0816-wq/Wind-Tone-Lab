import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  },
})
