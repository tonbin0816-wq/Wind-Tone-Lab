import React, { useEffect, useId, useRef, useState } from "react";
import WindToneLabPhaseMode, { usePersistedState } from "./App.jsx";
import { SHEET_PRIMARY_BUTTON_STYLE } from "./sheetButtonStyle.js";
import { ONBOARDING_KEY, ONBOARDING_INITIAL, normalizeOnboardingDone } from "./onboarding.jsx";
import { isTutorialPreviewOn } from "./tutorialPreview.js";
import { TERMS_CONSENT_KEY, makeConsentRecord, needsConsentScreen } from "./termsConsent.js";
import { AgreeRow } from "./agreeRow.jsx";
// アプリのアイコンの芽(読み込み中の絵の 100% = アイコンと同じ姿)。React と純粋な計算だけを読む部品(firebase を読まない)。
import { LoadingRing as SproutMark } from "./community/LoadingRing.jsx";
// 【便CC】規約・ポリシーの本文は LegalSheet と同じ読み方(public の terms.html・privacy.html を fetch して <body> の中身を描く。文の正は public の1つ)。
// 写しを作らない。LegalSheet.jsx は App.jsx の BottomSheet を読むが、このファイルは App.jsx から読まれないので循環にはならない。
import { loadLegalHtml, errorStyle } from "./community/LegalSheet.jsx";
import { PRIVACY_URL, TERMS_URL } from "./support.js";

// ------------------------------------------------------------------
// 【便CB 2026-10-08 本人の依頼】アプリを初めて開いたとき、計測タブより前に出す同意の画面。
// 本人「コミュニティの利用規約に同意させるものがありますよね それこのアプリの一番最初に持ってこれませんか?
// チュートリアルよりも前です」。誰に出すかの判断は termsConsent.js の needsConsentScreen(純関数)。
//
// 【便CC 2026-10-08 本人の直し】2枚にした。本人「サックスの音程と音色を測って記録するアプリです → サックス奏者のためのチューナー&メトロノーム
// に変更 / 最初にアイコンと一文だけ出して、はじめるのボタンおいておいてそのタップで、その後(別アプリ画面)のように利用規約と
// プライバシーポリシーを元々出しておいて同意ボタンおいておいて」:
//   1枚目(ようこそ) … 芽・「Ficus」・1行・「はじめる」(最初から押せる。押すと2枚目)。チェックは置かない
//   2枚目(規約)     … 利用規約の全文 → プライバシーポリシーの全文を1本のスクロールにつなぐ(それぞれ本文の先頭の見出し h1 が名乗る)。
//                      下に固定の帯(チェック「利用規約とプライバシーポリシーに同意する」+「次へ」。チェックするまで押せない)
//   どちらの枚かはこの起動のメモリの上だけ(保存しない)。同意の前に閉じたら、次は1枚目から。2枚目から戻る導線は置かない。
//   履歴(history)にも積まないので、iOS の端からの戻るスワイプで枚が変わることも無い。
//   2つを切り替え(セグメント)にしなかった理由: 手本の画面は本文を1本で読み下ろす形で、同意の文も「2つに同意する」1つ。
//   切り替えにすると、片方だけ読んで同意できる見た目になる。
// 【便CC 本人「最初に同意撮るのでコミュニティで同意出すのはやめて」】参加のカードの同意のチェックは無くなった。記録の無い人
// (古いバックアップの読み戻しなど)は、読み戻しのあとの再読み込みでこの根が記録を確かめ、無ければここで同意を取る
// (例外: 参加の印がある人には出さない ── 参加のときに参加のカードで同意している)。
//
// 【アプリの根(AppRoot)】main.jsx はこれを描く。同意の画面の間は**アプリ(WindToneLabPhaseMode)を描かない**:
//   ・マイク(計測タブの自動の取得)・ATT・広告(どちらもマイクの最初の試みのあとに始まる shellStartAdsOnce)・はじめの案内は
//     アプリの中にあるので、同意の前には**構造的に始まらない**(条件を足して止めるのではなく、描かれていない)
//   ・下部タブと広告の帯もアプリの中にあるので出ない
// 同意したら記録(日時と版)を kv に書き、同じ描画でアプリを描く。記録の判断がつくまで(kv の読み)は何も描かない ──
// main.jsx が温めを待つ間に何も描かないのと同じ(新しい待ち画面は作らない)。温めが済んでいれば1フレーム目から決まる。
//
// 【見本(?tutorialpreview=1)】はじめの案内を毎回最初から見せるための見本なので、同意の画面(1枚目 → 2枚目)も毎回出す。
// 本物の記録は読まず・書かない(同意はこの起動のメモリの上だけ)。
//
// 【見た目】新しい値を作らない。動きなし。
//   ・1枚目: 縦横の中央に1列。縁から 22px(参加のカードの枠と同じ本人裁定の 22)+ 安全域。列の内側は参加のカードの内側と同じ
//     --sp-5 / --sp-4 / --sp-4・行間 --sp-2。芽 88px / 「Ficus」--fs-xl・700・--lh-tight・--c-ink・--font-num(英字 §4.3)/
//     1行は .coach-line / 「はじめる」は SHEET_PRIMARY_BUTTON_STYLE(上に --sp-4)
//   ・2枚目: 画面を縦の flex で「本文(スクロール)」と「帯」に分ける ── 帯は流れの中の最後の子なので、本文の最後が帯の裏に隠れない。
//     本文は縁から 22px + 安全域・列の上限 --page-max-w・体裁は LegalSheet と同じ .legal-doc。2つの文書の間は --sp-6。
//     帯は地 --c-bg・上に 1px --c-line(下部タブの上の罫と同じ役)・内側 --sp-3・左右 22px + 安全域・下は --sp-3 + 安全域(安全域の上に置く)。
//     中身は列の上限 --page-max-w・行間 --sp-2・チェックは中央(手本と同じ)・「次へ」は SHEET_PRIMARY_BUTTON_STYLE(チェックまで --c-disabled)
//   ・本文の中のリンク: mailto: 以外は既定の移動を止める(殻の中で SPA から離れない・C11/C12)。規約・ポリシーへのリンクなら同じ画面の中のその文書へ送る
// ------------------------------------------------------------------

export const CONSENT_TITLE = "Ficus";
export const CONSENT_LINE = "サックス奏者のためのチューナー&メトロノーム";
export const CONSENT_START = "はじめる";
export const CONSENT_AGREE = "利用規約とプライバシーポリシーに同意する";
export const CONSENT_NEXT = "次へ";

const EDGE_X = { paddingLeft: "calc(22px + env(safe-area-inset-left))", paddingRight: "calc(22px + env(safe-area-inset-right))" };
const frameStyle = {
  position: "fixed", inset: 0, overflowY: "auto", background: "var(--c-bg)",
  display: "flex", boxSizing: "border-box",
  paddingTop: "calc(22px + env(safe-area-inset-top))",
  paddingBottom: "calc(22px + env(safe-area-inset-bottom))",
  ...EDGE_X,
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
// 2枚目: 画面いっぱいの縦の flex(本文 + 帯)
const termsFrameStyle = { position: "fixed", inset: 0, background: "var(--c-bg)", display: "flex", flexDirection: "column" };
const termsScrollStyle = {
  flex: "1 1 auto", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", boxSizing: "border-box",
  paddingTop: "calc(22px + env(safe-area-inset-top))", paddingBottom: "22px", ...EDGE_X,
};
const barStyle = {
  flex: "none", background: "var(--c-bg)", borderTop: "1px solid var(--c-line)", boxSizing: "border-box",
  paddingTop: "var(--sp-3)", paddingBottom: "calc(var(--sp-3) + env(safe-area-inset-bottom))", ...EDGE_X,
};
const readColumn = { maxWidth: "var(--page-max-w)", margin: "0 auto" };

// 1枚目(ようこそ)
function WelcomeStep({ onStart }) {
  const titleId = useId();
  return (
    <div className="sans" data-consent-screen="" data-consent-step="welcome" style={frameStyle}>
      <main aria-labelledby={titleId} style={columnStyle}>
        <div style={{ justifySelf: "center", marginBottom: "var(--sp-1)" }}><SproutMark p={1} /></div>
        <h1 id={titleId} style={titleStyle}>{CONSENT_TITLE}</h1>
        <p className="coach-line" style={{ textAlign: "center" }}>{CONSENT_LINE}</p>
        <button type="button" onClick={onStart} className="sans" data-consent-start=""
          style={{ ...SHEET_PRIMARY_BUTTON_STYLE, marginTop: "var(--sp-4)" }}>
          {CONSENT_START}
        </button>
      </main>
    </div>
  );
}

// 規約・ポリシーの本文(LegalSheet と同じ loadLegalHtml。取得結果はモジュールの中に覚えるので2回目は即時)
function useLegalHtml(kind) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    loadLegalHtml(kind)
      .then((html) => { if (alive) setState({ html }); })
      .catch(() => { if (alive) setState({ error: true }); });
    return () => { alive = false; };
  }, [kind]);
  return state;
}
function LegalSection({ kind, state, style }) {
  if (state.error) {
    return <section data-legal-section={kind} style={style}><div className="sans" role="alert" style={errorStyle}>読み込めませんでした</div></section>;
  }
  /* 本文は同じ origin の自分の静的 HTML(public の terms.html・privacy.html)。外から来た文字列ではない。 */
  return <section data-legal-section={kind} className="legal-doc" style={style} dangerouslySetInnerHTML={{ __html: state.html ?? "" }} />;
}

// 2枚目(規約)
function TermsStep({ onAgree }) {
  const [agreed, setAgreed] = useState(false);
  const terms = useLegalHtml("terms");
  const privacy = useLegalHtml("privacy");
  const scrollRef = useRef(null);
  // 本文の中のリンク: mailto: 以外は既定の移動を止める(殻の中で SPA から離れない)。規約・ポリシーへのリンクならその文書へ送る。
  const onDocClick = (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (/^mailto:/i.test(href)) return;
    e.preventDefault();
    const kind = href.includes(PRIVACY_URL) ? "privacy" : href.includes(TERMS_URL) ? "terms" : null;
    if (kind) scrollRef.current?.querySelector(`[data-legal-section="${kind}"]`)?.scrollIntoView({ block: "start" });
  };
  const next = () => {
    if (!agreed) return; // 同意の前は押せない(disabled と二重に守る)
    onAgree();
  };
  return (
    <div className="sans" data-consent-screen="" data-consent-step="terms" style={termsFrameStyle}>
      <div ref={scrollRef} data-consent-scroll="" onClick={onDocClick} style={termsScrollStyle}>
        <main aria-label="利用規約とプライバシーポリシー" style={readColumn}>
          <LegalSection kind="terms" state={terms} />
          <LegalSection kind="privacy" state={privacy} style={{ marginTop: "var(--sp-6)" }} />
        </main>
      </div>
      <div data-consent-bar="" style={barStyle}>
        <div style={{ ...readColumn, display: "grid", gap: "var(--sp-2)" }}>
          <div style={{ justifySelf: "center", maxWidth: "100%" }}>
            <AgreeRow checked={agreed} onChange={setAgreed}>{CONSENT_AGREE}</AgreeRow>
          </div>
          <button type="button" onClick={next} disabled={!agreed} className="sans" data-consent-next=""
            style={{ ...SHEET_PRIMARY_BUTTON_STYLE, background: agreed ? "var(--c-accent)" : "var(--c-disabled)",
                     cursor: agreed ? "pointer" : "default" }}>
            {CONSENT_NEXT}
          </button>
        </div>
      </div>
    </div>
  );
}

// 同意の画面(1枚目 → 2枚目)。どちらの枚かはメモリの上だけ(閉じたら次は1枚目から)。
export function ConsentScreen({ onAgree }) {
  const [step, setStep] = useState("welcome");
  if (step === "welcome") return <WelcomeStep onStart={() => setStep("terms")} />;
  return <TermsStep onAgree={onAgree} />;
}

// アプリの根。同意が済むまでは同意の画面だけを描き、済んだらアプリを描く。
export default function AppRoot() {
  const [preview] = useState(() => isTutorialPreviewOn());
  const [consent, setConsent, consentLoaded] = usePersistedState(TERMS_CONSENT_KEY, null);
  // 参加した印(onboardingDone.join)を読むだけ。**ここでは書かない**(書くのはアプリの markOnboarding だけ)。
  const [onboardingRaw, , onboardingLoaded] = usePersistedState(ONBOARDING_KEY, ONBOARDING_INITIAL);
  const [previewAgreed, setPreviewAgreed] = useState(false);

  if (preview) {
    if (!previewAgreed) return <ConsentScreen onAgree={() => setPreviewAgreed(true)} />;
    return <WindToneLabPhaseMode />;   // 見本は記録を書かない
  }
  if (!consentLoaded || !onboardingLoaded) return null;
  if (needsConsentScreen({ consent, onboardingDone: normalizeOnboardingDone(onboardingRaw) })) {
    return <ConsentScreen onAgree={() => setConsent(makeConsentRecord())} />;
  }
  return <WindToneLabPhaseMode />;
}
