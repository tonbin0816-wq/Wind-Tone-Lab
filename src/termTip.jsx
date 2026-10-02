import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

// ------------------------------------------------------------------
// 【便BC 2026-09-25 本人選定 モック「イ. 吹き出し」】重心と HNR の用語の説明。
// 【便BI 2026-10-02 本人指示】コミュニティだけでなく、リードタブとデータタブの「重心・HNR を切り替えるタブ」
// の全部にも同じ吹き出しを出す。**部品はこの1つ**(写しを作らない)。置き場を community/screens.jsx から
// ここへ移したのは、App.jsx(リード・データ)と screens.jsx(コミュニティ)の両方が読めるようにするため
// (screens.jsx は App.jsx を読む向きなので、screens.jsx に置いたままだと App.jsx から読めない)。
// 使っている場所:
//   コミュニティ … みんなの平均カード(DataScreen)・人物のページのデータ(PersonSheet)
//   リード / データ … セッション詳細・リード詳細(MetricTabCard)・リードの比較(ReedCompareTab)・
//                   My Data の音の傾向カード(MyDataSection)
//   ・選んでいる指標が重心か HNR のときだけ、字の右に「?」。音程・音量では出さない(TERM_TEXT に無い)
//   ・選んでいるタブをもう一度押すと開く / 閉じる。別のタブを押して指標が変わったら閉じる
//   ・×・吹き出しの外を触る・Esc・横スワイプでページが替わったときも閉じる。画面は暗くしない(暗幕を持たない)
// 文案は本人が選んだもの(一字一句このまま。モックの案2)。共通の一文は、以前グラフの下に出していた
// 注意書き(便BA まで chart.withMine のとき)をコミュニティでここへ移したもの。
// 【便BI 本人指示】共通の一文はコミュニティの「揃えて比べる」説明なので、**コミュニティだけ**に出す
// (sharedNote)。リード・データのグラフは自分のデータどうしの比較で揃えていないので、用語の説明だけ。
// ------------------------------------------------------------------
export const TERM_TEXT = {
  spectralCentroidHz: "音に含まれる成分が、どの高さに集まっているかを表す値です。高い成分が多いほど値が上がり、明るい音に聞こえます。",
  hnrDb: "楽器の響きと、息などの雑音の大きさの比です。高いほど芯のある澄んだ音に聞こえます。",
};
export const TERM_SHARED_NOTE = "計測環境により値全体が一律にずれるため、揃えた状態で線の形で比較しています。";
// 上向きの三角の大きさ。モック .bubble::before の border 7px。
const TERM_ARROW_PX = 7;
// 三角を吹き出しの角丸(--r-2 = 12px)の上に載せない。端へ寄るときはここで止める。
const TERM_ARROW_EDGE_PX = 12;
// 「?」の丸。モック .q の 18px
const HINT_MARK_PX = 18;

// ------------------------------------------------------------------
// タブの側の作法(2つの下線タブ ── screens.jsx の UnderlineTabs と App.jsx の MetricUnderlineTabs ── が
// 同じこの2つを読む)。hint = { keys, open, id, descId, onToggle } は TermTip が renderTabs へ渡す。
//   termTabProps … タブの <button> に足す属性。選んでいる指標が keys に入っていれば、
//                  aria-describedby で「用語の説明」を**説明として**足し、aria-expanded / aria-controls で
//                  吹き出しとつなぐ。data-term-tab は「吹き出しの内側とみなすタブ」の印(外を触ったかの判定に使う)。
//   【便BI 2026-10-02 審査の差し戻し】以前は aria-label で名前そのものを「重心 用語の説明」に替えていた。
//   App.jsx の指標タブは aria-pressed のボタンなので、押された状態に合わせて名前が変わることになり、
//   W3C APG の「トグルボタンの名前は状態で変えない」に反した。名前は見えている字(「重心」)のまま変えず、
//   「用語の説明」は名前の外(aria-describedby)で足す。開いているかどうかは aria-expanded が言う。
//   コミュニティのタブ(role="tab")も同じ付け方にそろえた(部品が1つなので片方だけ違う形にならない)。
//   TermMark     … 字の右の「?」。<button> の入れ子にしないため飾り(aria-hidden)で、押す場所はタブそのもの。
// 選んでいるタブの見える字の器には data-tab-face を付けること(三角の位置と、× で閉じたときの
// フォーカスの戻り先をそこから引く)。
// ------------------------------------------------------------------
export function termTabHinted(hint, key, sel) {
  return Boolean(sel && hint && hint.keys.includes(key));
}
// 説明の文(aria-describedby の先)。見せない要素(hidden)だが、参照された説明としては読み上げられる。
export const TERM_TAB_DESCRIPTION = "用語の説明";
export function termTabProps(hint, hinted) {
  return {
    "data-term-tab": "",
    "aria-describedby": hinted ? hint.descId : undefined,
    "aria-expanded": hinted ? hint.open : undefined,
    "aria-controls": hinted && hint.open ? hint.id : undefined,
  };
}
export function TermMark() {
  return (
    <span aria-hidden="true" data-term-mark style={{
      width: HINT_MARK_PX, height: HINT_MARK_PX, boxSizing: "border-box", marginLeft: "var(--sp-1)",
      borderRadius: "50%", border: "1.5px solid currentColor",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: "var(--fs-xs)", fontWeight: 700, lineHeight: 1,
    }}>?</span>
  );
}

// value … 選んでいる指標のキー / label … その指標の名前(吹き出しの見出し)
// active … ページャの裏へ回ったら false(閉じる)。ページャの外は常に true
// sharedNote … 共通の一文(揃えて比べる説明)を出すか。コミュニティだけ true
// renderTabs(hint) … タブの列を描く。hint をタブへ渡すこと
export function TermTip({ value, label, active = true, sharedNote = false, renderTabs }) {
  const [open, setOpen] = useState(false);
  const [arrowLeft, setArrowLeft] = useState(TERM_ARROW_EDGE_PX);
  const boxRef = useRef(null);
  const tipRef = useRef(null);
  const tipId = useId();
  const descId = useId();
  const term = TERM_TEXT[value] ?? null;

  // 指標が変わったら閉じる(別のタブを押したとき。外から value が変わったときも)。
  useEffect(() => { setOpen(false); }, [value]);
  // 【便BC 審査】横スワイプでページが替わったら閉じる(ページャは裏のページも描いたままなので、
  // 閉じないと裏で開いたまま残る)。active はページャの index から呼び手が渡す。ページャの外は常に true。
  useEffect(() => { if (!active) setOpen(false); }, [active]);

  // 【便BC 審査】「内側」とみなすのは吹き出しの要素と、タブのボタン(data-term-tab)だけ。
  // タブ列の外枠で判定すると、「音程」より右の空いた帯を押しても閉じなかった。
  // 【便BI】My Data のタブ列の右端に相乗りする集計範囲のセレクタも「外」(data-term-tab を持たない)。
  const isInside = (t) => Boolean(t && t.closest
    && ((tipRef.current && tipRef.current.contains(t))
      || (boxRef.current && boxRef.current.contains(t) && t.closest("[data-term-tab]"))));

  // 外を触る・フォーカスが外へ出る・Esc で閉じる。開いている間だけ聞く。
  // 【Esc は document で受けて止める】人物のページは BottomSheet の中にあり、あちらは window の keydown で
  // シートを閉じる(【便BG】いちばん上の1枚だけ)。document は window より先に届くので、ここで止めれば
  // Esc 1回で閉じるのは吹き出しだけ。閉じたあとの Esc は止めない(シートの Esc を奪わない)。
  // 【focusin】キーボードだけで操作すると、Tab で先へ進んでも吹き出しが裏に開いたまま残り、最初の Esc が
  // 見えない吹き出しに吸われていた(便BC 審査)。フォーカスが吹き出しとタブの外へ出たら閉じる。
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!isInside(e.target)) setOpen(false); };
    const onFocus = (e) => { if (!isInside(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 選んでいるタブ(開いた場所)。見える字の器(data-tab-face)を包むタブのボタン。
  const selectedTab = () => {
    const face = boxRef.current && boxRef.current.querySelector("[data-tab-face]");
    return face ? face.closest("[data-term-tab]") : null;
  };
  // × で閉じたら、フォーカスを選んでいるタブへ戻す。body に落とさない(便BC 審査)。
  const closeByX = () => {
    setOpen(false);
    const sel = selectedTab();
    if (sel) sel.focus();
  };

  // 三角は「?」の付いたタブ(選んでいる字の器)の真下。吹き出しの横幅は器(この箱)いっぱいで、
  // 器の幅は置き場ごとに違う。【便BI 2026-10-02 実測 375px 幅。左端 / 右端の x】
  //   My Data の音の傾向カード(.card)            … 30 / 345
  //   セッション詳細・リード詳細(.card.card-outline) … 31 / 344(リード詳細のカードの内側で実測。同じ部品)
  //   リードの比較(カードに入っていない)          … 14 / 361(画面の端から 14px。本文の左右余白 --page-side-pad だけ)
  //   コミュニティのみんなの平均カード(.card)      … 左 30(便BC の実測。dev サーバではコミュニティが描かれず測り直せない)
  //   人物のページ(シートの中・内側 24px)          … 左 24(同じく便BC の実測)
  // 測れたものはどれも画面(0〜375)の内側に収まる。リードの比較だけは端から 14px で、16px より近い。
  useLayoutEffect(() => {
    if (!open || !boxRef.current) return;
    const face = boxRef.current.querySelector("[data-tab-face]");
    const box = boxRef.current.getBoundingClientRect();
    if (!face || !(box.width > 0)) return;
    const f = face.getBoundingClientRect();
    const center = f.left + f.width / 2 - box.left;
    const max = box.width - TERM_ARROW_EDGE_PX - TERM_ARROW_PX * 2;
    setArrowLeft(Math.max(TERM_ARROW_EDGE_PX, Math.min(max, center - TERM_ARROW_PX)));
  }, [open, value]);

  const hint = { keys: Object.keys(TERM_TEXT), open, id: tipId, descId, onToggle: () => setOpen((o) => !o) };
  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      {/* 【便BI 審査の差し戻し】選んでいるタブの説明(aria-describedby の先)。hidden なので描かれず、場所も取らない。 */}
      <span id={descId} hidden>{TERM_TAB_DESCRIPTION}</span>
      {renderTabs(hint)}
      {open && term ? (
        <div ref={tipRef} id={tipId} role="dialog" aria-label={`${label} 用語の説明`} className="sans" data-term-tip
          style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 2,
            background: "var(--c-ink)", color: "var(--c-on-accent)", borderRadius: "var(--r-2)",
            /* 影は既存の浮かぶ物(シート・右下の浮かぶボタン)と同値。新しい濃さを発明しない。 */
            boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
            padding: "var(--sp-3)", display: "grid", gap: "var(--sp-2)", textAlign: "left",
          }}>
          <span aria-hidden="true" data-term-arrow style={{
            position: "absolute", top: -TERM_ARROW_PX, left: arrowLeft, width: 0, height: 0,
            borderLeft: `${TERM_ARROW_PX}px solid transparent`, borderRight: `${TERM_ARROW_PX}px solid transparent`,
            borderBottom: `${TERM_ARROW_PX}px solid var(--c-ink)`,
          }} />
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--sp-2)" }}>
            <div style={{ fontSize: "var(--fs-md)", fontWeight: 700, lineHeight: "var(--lh-base)" }}>{label}</div>
            {/* 当たり判定は 44px 角。上と右と下は吹き出しの内側の余白へ食い込ませ、見出しの行を高くしない。 */}
            <button type="button" aria-label="用語の説明を閉じる" onClick={closeByX} className="sans"
              style={{
                minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", flex: "none",
                margin: "calc(-1 * var(--sp-3)) calc(-1 * var(--sp-3)) calc(-1 * var(--sp-3)) 0",
                display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0,
                background: "none", border: "none", cursor: "pointer",
                color: "var(--c-on-accent-dim)", fontSize: "var(--fs-md)", lineHeight: 1,
              }}>×</button>
          </div>
          <div style={{ fontSize: "var(--fs-sm)", lineHeight: "var(--lh-loose)" }}>{term}</div>
          {sharedNote ? (
            <div style={{ fontSize: "var(--fs-xs)", lineHeight: "var(--lh-loose)", color: "var(--c-on-accent-dim)" }}>{TERM_SHARED_NOTE}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
