// 【便BM 2026-10-02 本人裁定(a)】計測タブで、画面の高さが足りないときだけ環(メーター)を縮めて全部を収める。
//
// 本人の選んだ形(a):「画面の高さが足りないときだけ、メーターを小さくして全部を収める」。
// 便BL の実測(375×667 = iPhone SE)で、帯なしでも 67px・帯ありで 117px・メトロノームを開くとさらに 25px
// はみ出し、詳細の矢印が下部タブの下に、録音ボタンが帯の下に入っていた。
//
// 【便BM 差し戻し 統括裁定1】環の大きさは**画面ごとに1回だけ**決める。
// DESIGN-SYSTEM §4.2「環はメトロノームの開閉で大きさを変えない(2026-07-31 確定)」に従い、直径は
// **その画面でいちばん厳しい状態**(メトロノームを開き、音量表示を入れた状態)を前提に決める。
// だからメトロノームの開閉・音量表示の切り替えでは大きさが変わらない。リードの行(案内2行 / リードの1行)だけは
// そのときの実際の状態を使う。
//
// 【何を比べるか】
//   使える高さ availH = ツールバーが出ている状態の高さ(100svh)− 枠の上端 − --page-bottom-gap
//                       (【便BM 再審査】window.innerHeight は Safari のツールバーの出し入れで伸び縮みするので使わない)
//                       (--page-bottom-gap は --ad-h を含むので、帯の有無はここに入っている。
//                        【統括裁定2】visualViewport は使わない ── ソフトキーボード・ピンチ拡大・ツールバーの
//                        一時的な縮みで環を縮めないため)
//   環以外の高さ othersH = いま描いている中身から環を除き、「可変の中間」と音量の行を、いちばん厳しい状態の
//                       ものに入れ替えた高さ(ringFitArgs)
//   環に回せる高さ room = availH − othersH。環の高さは幅そのもの(viewBox が正方形)なので room が直径になる。
//
// 【足りるときは 1px も変えない】room が「縮めないときの環の大きさ」(maxD = 枠の幅で頭打ちした RING_D_FULL)
// 以上なら maxD をそのまま返す(375 幅なら 330)。375×812・帯なしは、いちばん厳しい状態でも足りるので 330 のまま。
// 【足りない分だけ縮める】room を切り捨てた整数(端数で 1px はみ出さない)。
// 【下限】minD。届かない残りはページのスクロールで届く(枠が中身の高さまで伸びる、今までの作り)。

// 下限の直径。環の中のいちばん小さい字(セント値 centsPx)が、比例で縮めても floorPx を割らない直径。
// 切り上げる(切り捨てると floorPx をわずかに割る)。
export function ringMinDiameter(fullD, centsPx, floorPx) {
  return Math.ceil((fullD * floorPx) / centsPx);
}

// 測った値 → fitRingDiameter の引数。**写し間違いを検査で叩けるように**ここへ出す。
//   availH       使える高さ
//   frameH       画面ぶんの枠の高さ(getBoundingClientRect)
//   spacerH      余りを吸収するスペーサーの高さ(はみ出しているときは 0)
//   ringH        環の外枠の高さ(= 描かれている直径)
//   volumeH      いまの音量の行の高さ(出していなければ 0。環の箱の高さ − 環の高さ)
//   middleH      いまの「可変の中間」の高さ(これまでの音 / メトロノームの行)
//   worstMiddleH いちばん厳しい状態の「可変の中間」(メトロノームの行)の高さ
//   worstVolumeH いちばん厳しい状態の音量の行の高さ
//   boxW         環の箱の幅(縮めないときの環の大きさ = min(fullD, boxW))
export function ringFitArgs({
  availH, frameH, spacerH, ringH, boxW,
  volumeH = 0, middleH = 0, worstMiddleH = 0, worstVolumeH = 0,
  fullD, minD,
}) {
  const othersH = frameH - spacerH - ringH - volumeH - middleH + worstMiddleH + worstVolumeH;
  return { availH, othersH, maxD: Math.min(fullD, boxW), fullD, minD };
}

// 収まる直径。
//   availH  使える高さ。0 以下・数でない = まだ測れていない → 縮めない
//   othersH 環以外の高さ(いちばん厳しい状態)
//   maxD    縮めないときの環の実寸(= min(RING_D_FULL, 枠の幅))。足りるときはこれを返す
//   fullD   RING_D_FULL(まだ測れていないときに返す値)
//   minD    下限
export function fitRingDiameter({ availH, othersH, maxD, fullD, minD }) {
  if (!(availH > 0) || !Number.isFinite(othersH) || !(maxD > 0)) return fullD;
  const room = availH - othersH;
  if (room >= maxD) return maxD;
  return Math.max(minD, Math.floor(room));
}

// 今の大きさを据え置くか。録音中(演奏中に主役の大きさが変わると読み取りを妨げる)・入力欄にフォーカスがある間・
// シートを開いている間・ピンチで拡大している間は、前の直径のまま。外れた描画で合わせ直す。
// 【便BT2 2026-10-03 統括の裁定】据え置き中でも**縮む向きだけ**は合わせ直す(min(前, 収まる直径))。回転や Split View で
// 枠が狭く・低くなったときに、大きいまま据え置くとはみ出すため。大きくなる向きは据え置きを守る。
// maxD(描ける大きさ = min(上限, 枠の幅))を渡せば、それで頭打ちにする(描いた環より大きい直径で字の倍率を作らない)。
export function nextRingDiameter(prevD, fitD, frozen, maxD = Infinity) {
  return Math.min(frozen ? Math.min(prevD, fitD) : fitD, maxD);
}

// 環の中の字・間隔の倍率。基準は**縮めないときの直径**(iPhone。baseD = maxD)/ **正典の 330**(iPad。baseD = min(maxD, 330))。
// 枠が狭くて環が 330 より小さく描かれている画面でも、縮めていなければ 1、1px 縮めれば (baseD−1)/baseD で、
// 字が跳ねない。
// 【便BT 2026-10-03 本人裁定】min を外した(d / baseD)。iPhone では常に d ≤ baseD なので値は1つも変わらない。
// iPad(環の上限 440・基準 330)では 440 / 330 = 4/3 → 音名 148 × 4/3 = 197.3px(モック案Aの実寸)。
export function ringScale(d, baseD) {
  return d / baseD;
}
