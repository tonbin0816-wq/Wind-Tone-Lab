// 練習記録の書き出しと読み戻し。
//
// なぜ要るか: このアプリはローカル(IndexedDB)が正で、セッションの生データはクラウドに
// 上げていない。ブラウザの領域整理・アプリ削除・端末故障で、数か月分の練習履歴が
// 黙って全損する。競合10アプリの調査で、星1〜2の最大要因は社交機能ではなく
// 「記録が消えた」だった(docs/superpowers/research/2026-09-01-improvement-proposals.md §2-1)。
//
// クラウドには一切触らない。ファイル1つで完結させる。

export const SNAPSHOT_FORMAT = "ficus-backup";
// 形式を変えたら上げる。読み戻し側は「自分より新しい版」を拒否する
// (古いアプリで新しいファイルを開くと、知らないフィールドを黙って捨ててしまうため)。
export const SNAPSHOT_VERSION = 1;

export function buildSnapshot({ kv, sessions }, now = new Date()) {
  const list = Array.isArray(sessions) ? sessions : [];
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    exportedAt: now.toISOString(),
    // 読み戻しの確認画面で「何を戻そうとしているか」を人に見せるために数えておく。
    // ファイルを開かずに中身の規模が分かる。
    counts: {
      sessions: list.length,
      frames: list.reduce((n, s) => n + (Array.isArray(s?.frames) ? s.frames.length : 0), 0),
    },
    kv: kv ?? {},
    sessions: list,
  };
}

export function validateSnapshot(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "ファイルの形式が読み取れません" };
  }
  if (parsed.format !== SNAPSHOT_FORMAT) {
    return { error: "Ficus の書き出したファイルではありません" };
  }
  if (!Number.isInteger(parsed.version) || parsed.version > SNAPSHOT_VERSION) {
    return { error: "このファイルは新しいバージョンのアプリで作られています" };
  }
  if (!parsed.kv || typeof parsed.kv !== "object" || Array.isArray(parsed.kv)) {
    return { error: "ファイルの中身が壊れています" };
  }
  if (!Array.isArray(parsed.sessions)) {
    return { error: "ファイルの中身が壊れています" };
  }
  return { ok: true, data: parsed };
}

export function snapshotFileName(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `ficus-backup-${y}-${m}-${d}.json`;
}
