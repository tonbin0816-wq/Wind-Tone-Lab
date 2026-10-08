import React, { useCallback, useId, useState } from "react";
import WindToneLabPhaseMode, { usePersistedState } from "./App.jsx";
import { SHEET_PRIMARY_BUTTON_STYLE } from "./sheetButtonStyle.js";
import { ONBOARDING_KEY, ONBOARDING_INITIAL, normalizeOnboardingDone } from "./onboarding.jsx";
import { isTutorialPreviewOn } from "./tutorialPreview.js";
import { TERMS_CONSENT_KEY, isConsentRecord, makeConsentRecord, needsConsentScreen } from "./termsConsent.js";
import { AgreeRow, linkButtonStyle } from "./agreeRow.jsx";
// アプリのアイコンの芽(読み込み中の絵の 100% = アイコンと同じ姿)。React と純粋な計算だけを読む部品(firebase を読まない)。
import { LoadingRing as SproutMark } from "./community/LoadingRing.jsx";
// 規約・ポリシーはアプリの中のシートで読む(参加のカードと同じ開き方。外へ出ない ── C11・C12)。
// LegalSheet は App.jsx の BottomSheet を読む。このファイルは App.jsx から読まれないので、循環にはならない。
import LegalSheet from "./community/LegalSheet.jsx";

// ------------------------------------------------------------------
// 【便CB 2026-10-08 本人の依頼】アプリを初めて開いたとき、計測タブより前に出す同意の画面。
// 本人「コミュニティの利用規約に同意させるものがありますよね それこのアプリの一番最初に持ってこれませんか?
// チュートリアルよりも前です」。誰に出すかの判断は termsConsent.js の needsConsentScreen(純関数)。
//
// 【アプリの根(AppRoot)】main.jsx はこれを描く。同意の画面の間は**アプリ(WindToneLabPhaseMode)を描かない**:
//   ・マイク(計測タブの自動の取得)・ATT・広告(どちらもマイクの最初の試みのあとに始まる shellStartAdsOnce)・はじめの案内は
//     アプリの中にあるので、同意の前には**構造的に始まらない**(条件を足して止めるのではなく、描かれていない)
//   ・下部タブと広告の帯もアプリの中にあるので出ない
// 同意したら記録(日時と版)を kv に書き、同じ描画でアプリを描く。記録の判断がつくまで(kv の読み)は何も描かない ──
// main.jsx が温めを待つ間に何も描かないのと同じ(新しい待ち画面は作らない)。温めが済んでいれば1フレーム目から決まる。
//
// 【見本(?tutorialpreview=1)】はじめの案内を毎回最初から見せるための見本なので、同意の画面も毎回出す。
// 本物の記録は読まず・書かない(同意はこの起動のメモリの上だけ。参加のカードもその起動では同意済みとして描く)。
//
// 【見た目】新しい値を作らない。縦横の中央に1列(静かな画面・動きなし):
//   芽(読み込み中の絵の 100%・88px)/ 「Ficus」/ 1行 / 同意のチェック(参加のカードの AgreeRow。2つの語は規約・ポリシーを開く)/ 「はじめる」
//   ・画面の縁からの間は参加のカードの枠と同じ 22px(本人裁定の 22)+ 安全域。列の内側は参加のカードの内側と同じ --sp-5 / --sp-4 / --sp-4・行間 --sp-2
//     (375 幅で中身の幅 299 = 参加のカードの中身と同じ)。列の幅の上限は --page-max-w(iPad でも 640 の列で中央)
//   ・「Ficus」は見出し --fs-xl・700・--lh-tight・--c-ink。英字なので --font-num(§4.3)
//   ・1行は案内のカードの1行(.coach-line = --fs-sm・--lh-loose・--c-ink-2)
//   ・チェックと「はじめる」の塊は上に --sp-4 あけて、名乗りの塊と分ける
//   ・「はじめる」は SHEET_PRIMARY_BUTTON_STYLE。チェックするまで地 --c-disabled で押せない(参加のカードと同じ)
// ------------------------------------------------------------------

export const CONSENT_TITLE = "Ficus";
export const CONSENT_LINE = "サックスの音程と音色を測って記録するアプリです";
export const CONSENT_START = "はじめる";

const frameStyle = {
  position: "fixed", inset: 0, overflowY: "auto", background: "var(--c-bg)",
  display: "flex", boxSizing: "border-box",
  paddingTop: "calc(22px + env(safe-area-inset-top))",
  paddingBottom: "calc(22px + env(safe-area-inset-bottom))",
  paddingLeft: "calc(22px + env(safe-area-inset-left))",
  paddingRight: "calc(22px + env(safe-area-inset-right))",
};
// margin: auto … 縦横の中央。中身が画面より高いときは上端から並び、枠(frameStyle)が縦にスクロールする(中身を切らない)。
const columnStyle = {
  margin: "auto", width: "100%", maxWidth: "var(--page-max-w)", boxSizing: "border-box",
  padding: "var(--sp-5) var(--sp-4) var(--sp-4)", display: "grid", gap: "var(--sp-2)",
};
const titleStyle = {
  justifySelf: "center", fontFamily: "var(--font-num)", fontSize: "var(--fs-xl)", fontWeight: 700,
  lineHeight: "var(--lh-tight)", color: "var(--c-ink)",
};

export function ConsentScreen({ onAgree }) {
  const titleId = useId();
  const [agreed, setAgreed] = useState(false);
  // 規約・ポリシーのシート("terms" | "privacy" | null)。参加のカードと同じ。
  const [legal, setLegal] = useState(null);
  // 導線は <label> の中にあるので、押してもチェックが入らないよう既定の動き(ラベルの活性化)を止める。
  const openLegal = (kind) => (e) => { e.preventDefault(); setLegal(kind); };
  const start = () => {
    if (!agreed) return; // 同意の前は押せない(disabled と二重に守る)
    onAgree();
  };
  return (
    <div className="sans" data-consent-screen="" style={frameStyle}>
      <main aria-labelledby={titleId} style={columnStyle}>
        <div style={{ justifySelf: "center", marginBottom: "var(--sp-1)" }}><SproutMark p={1} /></div>
        <h1 id={titleId} style={titleStyle}>{CONSENT_TITLE}</h1>
        <p className="coach-line" style={{ textAlign: "center" }}>{CONSENT_LINE}</p>
        <div style={{ display: "grid", gap: "var(--sp-2)", marginTop: "var(--sp-4)" }}>
          <div style={{ justifySelf: "center", maxWidth: "100%" }}>
            <AgreeRow checked={agreed} onChange={setAgreed}>
              <button type="button" onClick={openLegal("terms")} className="sans" style={linkButtonStyle}>利用規約</button>
              と
              <button type="button" onClick={openLegal("privacy")} className="sans" style={linkButtonStyle}>プライバシーポリシー</button>
              に同意します
            </AgreeRow>
          </div>
          <button type="button" onClick={start} disabled={!agreed} className="sans" data-consent-start=""
            style={{ ...SHEET_PRIMARY_BUTTON_STYLE, background: agreed ? "var(--c-accent)" : "var(--c-disabled)",
                     cursor: agreed ? "pointer" : "default" }}>
            {CONSENT_START}
          </button>
        </div>
      </main>
      {legal ? <LegalSheet kind={legal} onClose={() => setLegal(null)} /> : null}
    </div>
  );
}

// アプリの根。同意が済むまでは同意の画面だけを描き、済んだらアプリを描く。
export default function AppRoot() {
  const [preview] = useState(() => isTutorialPreviewOn());
  const [consent, setConsent, consentLoaded] = usePersistedState(TERMS_CONSENT_KEY, null);
  // 参加した印(onboardingDone.join)を読むだけ。**ここでは書かない**(書くのはアプリの markOnboarding だけ)。
  const [onboardingRaw, , onboardingLoaded] = usePersistedState(ONBOARDING_KEY, ONBOARDING_INITIAL);
  const [previewAgreed, setPreviewAgreed] = useState(false);
  // 【便CB 統括の指示】記録の無い人が参加のカードでチェックを入れて参加できたとき(匿名のアカウントが作られたとき)にも記録を書く。
  // 書くのはこの根の1か所だけ(同じ鍵を2か所で持たない)。呼ぶのは CommunityTab の参加の成功の道(onJoin の ensureUid のあと)。
  const recordFromJoin = useCallback(() => setConsent(makeConsentRecord()), [setConsent]);

  if (preview) {
    if (!previewAgreed) return <ConsentScreen onAgree={() => setPreviewAgreed(true)} />;
    // 見本は記録を書かない(参加のカードも同意済みとして描くので、呼ばれることも無い)
    return <WindToneLabPhaseMode termsAgreed />;
  }
  if (!consentLoaded || !onboardingLoaded) return null;
  if (needsConsentScreen({ consent, onboardingDone: normalizeOnboardingDone(onboardingRaw) })) {
    return <ConsentScreen onAgree={() => setConsent(makeConsentRecord())} />;
  }
  return <WindToneLabPhaseMode termsAgreed={isConsentRecord(consent)} onTermsAgreed={recordFromJoin} />;
}
