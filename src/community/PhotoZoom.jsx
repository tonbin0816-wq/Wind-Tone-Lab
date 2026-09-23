import React, { useEffect } from "react";
import { createPortal } from "react-dom";
// 【裏の画面を動かさない】数える仕組みは App.jsx の1箇所(写しを作らない)。
// BottomSheet も同じものを呼んでいる ── この面は器を使わないので自分で呼ぶ。
import { useBackdropScrollLock } from "../App.jsx";

// ------------------------------------------------------------------
// アイコンの写真をそのまま大きく出す(凍結仕様 決定5・2026-09-23 本人指示)。
//
//   「画像タップしたらそのまま画像大きく表示するようにして
//     もう一度任意の場所タップで戻るようにして」
//
// ・**間に選択肢のシートを挟まない。** 押した瞬間に写真が出る
// ・戻るのは**画面のどこをタップしても**。閉じるボタンは置かない
// ・Escape でも閉じる(BottomSheet と同じ作法)。ただし**この1枚だけ**が閉じる
// ・**出すかどうかはここで決めない。** 判断は photoZoomAvailable(avatarPhoto.js)が持つ
//
// 【暗幕・動き・角丸・幅は既存のものだけを使う】
//   暗幕 rgba(15,23,42,0.28) と .sheet-scrim の動きは BottomSheet と同値。
//   角丸は --r-lg。幅は器の内側いっぱい = 375 − --sp-4 × 2 = 343(正典
//   design/canvas/CommPhotoZoom.dc.html と同じ)。**新しい値を作っていない。**
//
// 【重なり順 70 の理由】人物紹介シート(BottomSheet = 60)の**上**に出る必要がある。
//   裏のアイコンはそのシートの中に在るので、60 のままだと暗幕の下に隠れる。
//   シートより上に出るのはアプリでこの1枚だけ(DESIGN-SYSTEM §4.5a)。
// ------------------------------------------------------------------
export const PHOTO_ZOOM_Z = 70;

export default function PhotoZoom({ url, onClose }) {
  useBackdropScrollLock();

  useEffect(() => {
    // 【Escape で閉じるのはこの1枚だけ ── 2026-09-23 審査役の指摘(中6)】
    // BottomSheet も window に keydown を張るので、人物紹介シートの中で拡大を開いて
    // Escape を押すと**両方閉じた**。捕捉の段(capture)で受けて、
    // そこで伝播を打ち切れば、あとから張られた泡の段の聞き手には届かない。
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="写真"
      /* 【写真の上も閉じる】「任意の場所タップで戻る」なので、
         写真そのものを押したときだけ閉じない、という例外を作らない。 */
      onClick={onClose}
      data-noswipe
      className="sheet-scrim"
      style={{
        position: "fixed", inset: 0, zIndex: PHOTO_ZOOM_Z, background: "rgba(15,23,42,0.28)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "var(--sp-4)",
      }}
    >
      {/* 【width が要る 2026-09-23 審査役の指摘(中4)】写真は 256×256 なので、
          max-* だけでは効かず**素の 256px**で出る(正典の 343 より 87px 小さい)。
          幅を器いっぱいに取り、高さが溢れる細長い画面だけ max-height が受け止める。 */}
      <img
        src={url} alt=""
        style={{
          width: "100%", maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
          borderRadius: "var(--r-lg)", display: "block",
        }}
      />
    </div>,
    document.body,
  );
}
