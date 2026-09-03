// 記録の保存(書き出し・読み戻し・保存状態)。
//
// なぜ要るか: 記録はこの端末の IndexedDB だけにあり、クラウドに写しを持っていない。
// ブラウザの領域整理・アプリ削除・端末故障で、数か月分の練習履歴が黙って全損する
// (docs/superpowers/research/2026-09-01-improvement-proposals.md §2-1)。
//
// **クラウドには一切触らない。** Firestore にも認証にも触れない。ファイル1つで完結する。
//
// 【見た目の作法】データタブはカードの作法(.surf-card)。器は `.card` 1枚で、
// 地・枠・角丸・余白・影は index.css の `.surf-card .card` がそのまま持つ
// (インライン style で上書きしない)。色・文字寸法・角丸・当たり判定は
// design/DESIGN-SYSTEM.md のトークンだけを使い、新しい値を作らない。
import { useEffect, useRef, useState } from "react";
import { buildSnapshot, validateSnapshot, snapshotFileName } from "./snapshot.js";
import { readAll, writeAll, requestPersistence, storageEstimate } from "./localStore.js";

const jpNum = (n) => Number(n ?? 0).toLocaleString("ja-JP");

// 主要動作の塗り(--c-accent + --c-on-accent)。既にアプリの中で「主要動作の合図」として
// 使われている語彙をそのまま写す(新しいボタンの見た目を発明しない)。
const PRIMARY_BUTTON = {
  width: "100%", minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)",
  border: "none", background: "var(--c-accent)", color: "var(--c-on-accent)",
  fontSize: "var(--fs-md)", fontWeight: 700, cursor: "pointer",
};
// 中立の一手は B型(.ctl-plain = 枠なし / 地 --c-sunken)。読み戻しはファイルを選ぶ時点では
// まだ何も壊れない(壊れるのは確認のあと)ので、危険色の塗りは持たせない
// ── index.css の .ctl-danger の但し書き「破壊がまだ起きない入口は中立」に従う。
const NEUTRAL_BUTTON = {
  width: "100%", minHeight: "var(--tap-min)",
  color: "var(--c-ink-2)", fontSize: "var(--fs-md)", fontWeight: 600, cursor: "pointer",
};

export default function BackupPanel() {
  const fileInputRef = useRef(null);
  const [persistence, setPersistence] = useState(null); // granted / denied / unsupported
  const [estimate, setEstimate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);   // 成功・経過の知らせ
  const [failure, setFailure] = useState(null); // 失敗の知らせ

  // 保存領域の申請は画面に出た時点で1回だけ。**通らなくても処理は止めない**
  // (結果は下の一文の出し分けに使うだけ)。
  useEffect(() => {
    let cancelled = false;
    requestPersistence().then((r) => { if (!cancelled) setPersistence(r); });
    storageEstimate().then((e) => { if (!cancelled) setEstimate(e); });
    return () => { cancelled = true; };
  }, []);

  const handleExport = async () => {
    if (busy) return;
    setBusy(true); setNotice(null); setFailure(null);
    let url = null;
    try {
      const all = await readAll();
      const snapshot = buildSnapshot(all);
      const name = snapshotFileName();
      const blob = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setNotice(`${jpNum(snapshot.counts.sessions)} 回の計測を ${name} に書き出しました`);
    } catch {
      setFailure("書き出せませんでした。ブラウザの設定でこの端末の保存領域が使えない可能性があります");
    } finally {
      // 呼ばないとメモリに残る。
      if (url) URL.revokeObjectURL(url);
      setBusy(false);
    }
  };

  const handleFile = async (file) => {
    if (!file || busy) return;
    setBusy(true); setNotice(null); setFailure(null);
    try {
      let parsed;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        setFailure("ファイルの形式が読み取れません");
        return;
      }
      const checked = validateSnapshot(parsed);
      if (!checked.ok) { setFailure(checked.error); return; }

      // 「いまの記録が何件あるか」を数えてから訊く。人が置き換えの大きさを見て決められるように。
      const current = await readAll();
      const currentCount = current.sessions.length;
      const incomingCount = checked.data.counts?.sessions ?? checked.data.sessions.length;
      const ok = window.confirm(
        `このファイルには ${jpNum(incomingCount)} 回の計測が入っています。\n`
        + `いまの記録(${jpNum(currentCount)} 回)はすべて置き換わります。よろしいですか？(元に戻せません)`
      );
      if (!ok) return;

      await writeAll({ kv: checked.data.kv, sessions: checked.data.sessions });
      setNotice("読み戻しました。画面を読み込み直します");
      // React の state と App.jsx のキャッシュが古いままなので、読み込み直す。
      window.location.reload();
    } catch {
      setFailure("読み戻せませんでした。いまの記録はそのまま残っています");
    } finally {
      setBusy(false);
    }
  };

  const storageLine = (() => {
    if (!estimate) return null;
    return `${estimate.usageMB.toFixed(1)} MB を使用中`;
  })();

  const persistenceLine = (() => {
    if (persistence === "granted") return "この端末に保存されています";
    if (persistence === "denied") return "このブラウザは空き容量が減ると記録を自動削除することがあります";
    return null;
  })();

  return (
    /* 【作法】.card の style は**オブジェクトリテラル直書き**にする(検査が中身を読んで
       地・枠・padding をインラインで殺していないことを確かめる)。 */
    <div className="card" style={{ marginTop: "var(--sp-3)" }}>
      <div className="sans" style={{ fontSize: 17, fontWeight: 600, color: "var(--c-ink)", letterSpacing: "-.01em" }}>
        記録の保存
      </div>
      <div className="sans" style={{ fontSize: 12, color: "var(--c-ink-3)", lineHeight: 1.6, marginTop: 6 }}>
        記録はこの端末の中だけにあります。ファイルに書き出しておくと、別の端末や入れ直したあとに戻せます。
      </div>

      {(storageLine || persistenceLine) && (
        <div className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", lineHeight: 1.6, marginTop: 8 }}>
          {[storageLine, persistenceLine].filter(Boolean).join(" · ")}
        </div>
      )}

      <button
        type="button" onClick={handleExport} disabled={busy}
        className="sans" style={{ ...PRIMARY_BUTTON, marginTop: "var(--sp-4)" }}
      >
        ファイルに書き出す
      </button>

      <input
        ref={fileInputRef} type="file" accept="application/json,.json" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleFile(f); }}
      />
      <button
        type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}
        className="sans ctl-plain ctl-pill" style={{ ...NEUTRAL_BUTTON, marginTop: "var(--sp-2)" }}
      >
        ファイルから読み戻す
      </button>
      <div className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", lineHeight: 1.6, marginTop: 6 }}>
        読み戻すと、いまの記録はすべて置き換わります。実行する前に確認します。
      </div>

      {notice && (
        <div className="sans" style={{ fontSize: 12, color: "var(--c-ink-2)", lineHeight: 1.6, marginTop: 8 }}>{notice}</div>
      )}
      {failure && (
        <div className="sans" style={{ fontSize: 12, color: "var(--c-danger)", lineHeight: 1.6, marginTop: 8 }}>{failure}</div>
      )}
    </div>
  );
}
