import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
