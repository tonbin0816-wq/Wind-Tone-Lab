import React, { useRef, useState } from "react";
import { BottomSheet } from "../App.jsx";
import { ensureSignedIn } from "./accountRepo.js";
import { sendFeedback, FEEDBACK_MAX } from "./feedbackRepo.js";

// ------------------------------------------------------------------
// お問い合わせ・要望/感想を**アプリの中で**書いて送るシート。
//
// 【束3 2026-09-19 本人指示・裁定ずみ】本人「お問い合わせはメールに飛ばす形ではなくて
// 添付画像のような形を採用できますか？」。mailto: は端末にメールアプリが無いと何も起きず、
// 有っても**アプリの外へ出る**(戻ると SPA が再起動する。C11・C12 で規約・ポリシーを
// アプリの中へ入れたのと同じ理由)。書いた文字はそのまま feedback へ書き込む。
//
// 【器は BottomSheet(App.jsx export)】アプリ唯一のシートの器。暗幕・角丸・つまみ・
// 下スワイプ・Esc はすべて器が持つので、ここでは写さない。
//
// 【新しい通知面を作らない】送信できたことは**このシートの中**で言う。下端の帯
// (ActionNotice)は App の根にあり、遅延読み込みのこちらからは届かない。
// 送った直後にシートが黙って消えると「送れたのか」が分からないので、
// 同じ場所に一言出し、同じ一手(主要動作の位置)で閉じられるようにする。
// ------------------------------------------------------------------

// 見出し。**シートの読み上げ名(ariaLabel)と画面の見出しは同じ綴り**にする
// ── 目で読む人と読み上げで聞く人が、別の名前の画面に居ることにならないように。
const SHEET_TITLE = "お問い合わせ・要望/感想";

// 送信に失敗したときの言い方。既存の失敗(AVATAR_ERROR / DELETE_ERROR)と同じ調子に揃える
// ── 利用者にできることは同じ(電波の良いところでやり直す)なので、言い方まで変えない。
const SEND_ERROR = "送信できませんでした。電波の良いところでもう一度お試しください。";

// 【主要動作の高さ】App.jsx の ACTION_LG_PX と同じ 56(--tap-min の 1.25 倍。
// 既存のトークンに 56 の段は無い、とあちらの注記が書いている)。
// App.jsx は export していないので**ここは写し**になる。片方だけ動かすと
// 追加シートの一手とこのシートの一手が違う高さになるので、検証64 が
// 両方をソースから取り出して同値であることを見ている。
const ACTION_LG_PX = 56;

// 入力欄の高さ。**新しい数を作らない** ── シートが使える高さ(BottomSheet の上限と
// 同じ式 = 画面の高さ − 下部ナビ1つぶん)の半分。本人の添付画像がおよそ画面の半分。
// dvh 未対応の環境ではこの宣言ごと落ち、textarea の既定の高さになる(BottomSheet の
// maxHeight と同じ性質。地・枠・角丸は index.css の入力欄の規則が配るので残る)。
const INPUT_H = "calc((100dvh - var(--nav-h)) / 2)";

// CommunityTab.jsx の同名の定数と同値(あちらは export していない。import すると循環参照。
// LegalSheet.jsx の errorStyle と同じ事情)。検証64 が綴りの一致を見ている。
const titleStyle = { fontSize: "var(--fs-md)", fontWeight: 700, color: "var(--c-ink)" };
const bodyStyle = { fontSize: "var(--fs-sm)", color: "var(--c-ink)", lineHeight: 1.7 };
const noteStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", lineHeight: 1.6 };
const errorStyle = { fontSize: "var(--fs-sm)", color: "var(--c-danger)", lineHeight: 1.6 };

// 入力欄。地・枠・角丸は index.css の入力欄の1つの規則(--c-sunken / 1px transparent /
// --r-xs)が配る。ここが持つのは寸法と文字だけで、新しい色も角丸も作らない。
const inputStyle = {
  width: "100%", minHeight: INPUT_H, padding: "var(--sp-3)",
  fontSize: "var(--fs-sm)", color: "var(--c-ink)", lineHeight: 1.7,
  appearance: "none", WebkitAppearance: "none",
};

// 主要動作。作法は追加シート(ReedBoxSheet)・累計シートの一手と同じ:
// 幅いっぱい / 高さ ACTION_LG_PX / --r-pill / 塗り --c-accent(§6.7 の意図した例外5)。
// **押せないときの地は --c-line-strong** ── スイッチの切(App.jsx)と同じ、
// 「いまは効かない」を表す既存の色。新しい色を作らない。
const actionStyle = (enabled) => ({
  width: "100%", height: ACTION_LG_PX,
  display: "flex", alignItems: "center", justifyContent: "center",
  borderRadius: "var(--r-pill)", border: "none",
  background: enabled ? "var(--c-accent)" : "var(--c-line-strong)",
  color: "var(--c-on-accent)",
  fontSize: "var(--fs-md)", fontWeight: 700,
  cursor: enabled ? "pointer" : "not-allowed",
});

/**
 * @param onClose 閉じる(つまみ / 下スワイプ / Esc / 暗幕タップ。すべて BottomSheet が持つ)
 * @param signIn  匿名の資格情報を得る口。既定は accountRepo の実物(ensureSignedIn)。
 * @param send    投書を書く口。既定は feedbackRepo の実物(sendFeedback)。
 *
 * 【既定を差し替えられる理由】**本番の資格情報を作らず・本番へ1文字も書かずに
 * 画面の振る舞い(空なら押せない・1回しか呼ばれない・上限で切れる)を確かめる**ため。
 * 既定は実物なので、アプリの側は1つも渡さない(渡している呼び手は CommunityTab に無い)。
 * 同じ作法は reportRepo / profile.js の `now = new Date()` で既に使っている。
 */
export default function FeedbackSheet({ onClose, signIn = ensureSignedIn, send = sendFeedback }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  // 【busy だけでは二重送信を止めきれない(2026-09-20 実測)】`busy` は state なので、
  // setBusy(true) が効くのは**次の描画から**。同じ1ティックに2回押しが入ると、
  // 2回目のハンドラは busy=false のままの閉包を見て素通りし、**2件送られる**
  // (実測: stub が2回呼ばれた)。押した瞬間に立つ印が要るので ref で持つ。
  // 画面の見た目(disabled)は今までどおり busy が決める ── ref は描画を起こさないため。
  const sending = useRef(false);

  // 【空のときは押せない】空の投書が届いても運営者にできることが無い。
  // 空白だけも同じなので trim で見る(送る中身は trim しない ── 本人が書いた形のまま残す)。
  const canSend = text.trim().length > 0;

  const submit = async () => {
    if (sending.current || busy || !canSend) return; // 二重送信を止める(押している間は busy)
    sending.current = true;
    setBusy(true); setError(null);
    try {
      // 【ここで初めて資格情報を作る】タブを開いただけでは作らない、という
      // accountRepo の約束(getSignedInUid / ensureSignedIn の書き分け)に乗る。
      // **users は書かない** ので、これはコミュニティへの参加ではない。
      const uid = await signIn();
      // 【送る前に切り詰める】maxLength は貼り付け・日本語入力の確定・古い WebView で
      // すり抜けうるので、**送る側でももう一度**上限に収める。ルール(firestore.rules)も
      // 同じ上限を持っているので、ここで切らないとサーバーに拒まれて行き止まりになる。
      await send({ uid, text: text.slice(0, FEEDBACK_MAX) });
      setDone(true);
    } catch (e) {
      // 入力は消さない ── 書いた文字が消えると、書き直す気力ごと失う。
      console.error("[community] お問い合わせの送信に失敗", e?.code, e);
      setError(SEND_ERROR);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <BottomSheet ariaLabel={SHEET_TITLE} onClose={onClose}>
      <div className="sans" style={{ ...titleStyle, marginBottom: "var(--sp-2)" }}>{SHEET_TITLE}</div>
      {done ? (
        <div style={{ display: "grid", gap: "var(--sp-4)" }}>
          <div className="sans" role="status" style={bodyStyle}>送信しました。ありがとうございます</div>
          <button type="button" onClick={onClose} className="sans" style={actionStyle(true)}>閉じる</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "var(--sp-1)" }}>
          <div className="sans" style={bodyStyle}>ひとことだけでも構いません。</div>
          <div className="sans" style={bodyStyle}>お気軽にお問い合わせください。</div>
          {/* 例は「何を書けばいいか分からない」を外すためのもの。見出しと3行を離さない。 */}
          <div className="sans" style={{ ...bodyStyle, marginTop: "var(--sp-3)" }}>例)</div>
          <div className="sans" style={bodyStyle}>・使ってみた感想</div>
          <div className="sans" style={bodyStyle}>・機能などのご要望</div>
          <div className="sans" style={bodyStyle}>・不具合の報告</div>
          <textarea
            value={text} onChange={(e) => setText(e.target.value)}
            maxLength={FEEDBACK_MAX} aria-label={SHEET_TITLE} placeholder="ここに入力..."
            className="sans" style={{ ...inputStyle, marginTop: "var(--sp-3)" }}
          />
          {/* 【何が起きるかを押す前に言う】匿名とはいえ資格情報は作られる。
              押した後に知らせると「勝手に作られた」になる(JoinIntro と同じ考え)。 */}
          <div className="sans" style={noteStyle}>送信するとこの端末に匿名のIDが作られます。名前や連絡先は送られません。</div>
          {error ? <div className="sans" role="alert" style={errorStyle}>{error}</div> : null}
          <button
            type="button" onClick={submit} disabled={!canSend || busy}
            className="sans" style={{ ...actionStyle(canSend && !busy), marginTop: "var(--sp-3)" }}
          >送信</button>
        </div>
      )}
    </BottomSheet>
  );
}
