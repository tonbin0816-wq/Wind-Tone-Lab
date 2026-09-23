import { describe, it, expect } from "vitest";
import { storageBucketFor } from "./firebaseClient.js";

// 【便AH-2 2026-09-23】写真の置き場の名前を projectId から導く。
//
// なぜ検査を置くか: ここを取り違えると、**手元では動いて本番だけ写真が失敗する**という
// いちばん原因の分かりにくい壊れ方になる(Vite はビルド時に値を埋め込むので、
// Vercel 側の環境変数だけ忘れると再現しない)。綴りではなく答えを見る。
describe("写真の置き場の名前(storageBucketFor)", () => {
  it("環境変数が無ければ projectId から導く", () => {
    expect(storageBucketFor("ficus-caa43")).toBe("ficus-caa43.firebasestorage.app");
  });

  it("環境変数があればそちらが勝つ(既定と違う名前のバケットへ移せる)", () => {
    expect(storageBucketFor("ficus-caa43", "別の置き場.example"))
      .toBe("別の置き場.example");
  });

  // 空文字は「設定したが値が入っていない」形。上書きとして扱うと
  // バケット名が空になり、原因の分からない失敗になる ── 導く側へ倒す。
  it("環境変数が空文字なら、無いものとして導く", () => {
    expect(storageBucketFor("ficus-caa43", "")).toBe("ficus-caa43.firebasestorage.app");
  });

  it("環境変数が文字列でなければ無視する", () => {
    expect(storageBucketFor("ficus-caa43", null)).toBe("ficus-caa43.firebasestorage.app");
    expect(storageBucketFor("ficus-caa43", 7)).toBe("ficus-caa43.firebasestorage.app");
  });

  // projectId は必須の4キーなので、ここへ来る前に FirebaseConfigMissingError が
  // 投げられている。それでも undefined を返すのは、**空の名前でバケットに繋ぎに
  // 行かせない**ため(initializeApp へ storageBucket を渡さない枝に落ちる)。
  it("projectId が無ければ何も返さない(空の名前で繋ぎに行かせない)", () => {
    expect(storageBucketFor(undefined)).toBeUndefined();
    expect(storageBucketFor("")).toBeUndefined();
    expect(storageBucketFor(null)).toBeUndefined();
  });

  // 古い形式。2026-09-23 に ficus-caa43.appspot.com は存在しない(404)ことを
  // 実際に確かめてある。導く既定をこちらへ戻さないための錨。
  it("古い appspot.com の形では導かない", () => {
    expect(storageBucketFor("ficus-caa43")).not.toContain("appspot.com");
  });
});
