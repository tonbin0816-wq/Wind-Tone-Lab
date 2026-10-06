// 【便BX 2026-10-06 本人の決定 D1】参加の画面(CommunityTab.jsx の JoinIntro)の導線「端末を替えるとき」から開くシートの中身。
// 汎用の「記録の保存」(BackupPanel。マイページの「アカウント引継」)は変えずに、参加の場面で知りたいことに絞った:
//   見出し / 記録はファイルで移せる・匿名アカウントは移せない / 手順3つ / 主ボタン「ファイルから読み戻す」/ 注記 / 細い導線「この端末の記録を書き出す」
// **書き出し・読み戻しの処理は BackupPanel の useBackupActions を使い回す**(写しを作らない。確認の文・reload・殻の共有シートもそちら)。
// 殻だけの「Web 版から」の1行は置かない(手順1〜3が同じことを言っている)。
// 体裁は既存の値だけ: 見出しはシートの見出し(screens.jsx の sheetTitleStyle と同じ --fs-lg 700 --c-ink)・説明は参加のカードの
// 説明と同じ(--fs-sm・--c-ink-2・--lh-loose)・番号の丸 24 は .coach-icon の絵 24 と同じ寸法で地と字も同じ組
// (--c-accent-tint / --c-accent)・注記 11px と知らせ 12px は BackupPanel の注記と同じ直書き。
import { useEffect } from "react";
import { useBackupActions, PRIMARY_BUTTON } from "./BackupPanel.jsx";
import { requestPersistence } from "./localStore.js";
import { JOIN_QUIET_LINK_STYLE as QUIET_LINK } from "../community/CommunityTab.jsx";

export const DEVICE_TRANSFER_TITLE = "端末を替えるとき";
export const DEVICE_TRANSFER_LEAD = "記録(計測のデータとリード)はファイルで移せます。コミュニティの匿名アカウントは、この端末だけのもので移せません。参加し直すと新しいアカウントになります。";
// 【便BX 審査 統括の裁定】手順1は参加前の人にも当てはまる文に(参加前の人にはマイページが無い。この画面の下の細い導線で書き出す)。
// 手順2は 375 幅で「ど)」だけが次の行に落ちていたので詰めた。
// 各手順は「折れてよい所」で区切った断片の並び。断片は inline-block で描き、行は断片の間でだけ折れる
// (日本語は字の間のどこでも折れるので、画面の幅しだいで「参加 | 後」のように語の途中から折れていた。実測は報告)。
export const DEVICE_TRANSFER_STEPS = Object.freeze([
  Object.freeze(["前の端末で書き出す", "(参加前はこの画面の下から、", "参加後はマイページから)"]),
  Object.freeze(["ファイルをこの端末に送る", "(AirDrop・メールなど)"]),
  Object.freeze(["ここで「ファイルから読み戻す」"]),
]);
export const DEVICE_TRANSFER_EXPORT = "この端末の記録を書き出す";

export default function DeviceTransferPanel() {
  const { busy, notice, failure, exportNow, pickFile, fileInput } = useBackupActions();
  // 【便BX 審査】保存領域の申請は、BackupPanel と同じく開いたときに1回だけ(結果は表示しない。通らなくても処理は止めない)。
  useEffect(() => { requestPersistence(); }, []);
  return (
    <div>
      <div className="sans" style={{ fontSize: "var(--fs-lg)", fontWeight: 700, lineHeight: "var(--lh-tight)", color: "var(--c-ink)" }}>{DEVICE_TRANSFER_TITLE}</div>
      <div className="sans" style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: "var(--lh-loose)", marginTop: "var(--sp-1)" }}>{DEVICE_TRANSFER_LEAD}</div>
      <ol className="sans" style={{ listStyle: "none", margin: "var(--sp-3) 0 0", padding: 0, display: "grid", gap: "var(--sp-2)" }}>
        {DEVICE_TRANSFER_STEPS.map((t, i) => (
          <li key={i} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: "var(--sp-2)", alignItems: "start", fontSize: "var(--fs-sm)", color: "var(--c-ink-2)", lineHeight: "var(--lh-base)" }}>
            <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--c-accent-tint)", color: "var(--c-accent)", fontSize: "var(--fs-xs)", fontWeight: 700, display: "grid", placeItems: "center" }}>{i + 1}</span>
            <span>{t.map((seg, j) => <span key={j} style={{ display: "inline-block" }}>{seg}</span>)}</span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={pickFile} disabled={busy} className="sans" style={{ ...PRIMARY_BUTTON, marginTop: "var(--sp-4)" }}>ファイルから読み戻す</button>
      <div className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", lineHeight: 1.6, marginTop: 6 }}>読み戻すと、いまの記録はすべて置き換わります。実行する前に確認します。</div>
      <button type="button" onClick={exportNow} disabled={busy} className="sans" style={{ ...QUIET_LINK, marginTop: "var(--sp-3)" }}>{DEVICE_TRANSFER_EXPORT}</button>
      {notice && <div className="sans" style={{ fontSize: 12, color: "var(--c-ink-2)", lineHeight: 1.6, marginTop: 8 }}>{notice}</div>}
      {failure && <div className="sans" style={{ fontSize: 12, color: "var(--c-danger)", lineHeight: 1.6, marginTop: 8 }}>{failure}</div>}
      {fileInput}
    </div>
  );
}
