import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ------------------------------------------------------------------
// 【便BP 2026-10-03 本人裁定】はじめの一手(最初に開いたときの案内)。
// 正典 = scratchpad の ficus-tutorial.html(版4)。ただし「参加後の2段目」は凍結仕様で差し替え
// (人物のページの「目安に設定」ではなく、データのページの「みんなの平均」カード)。
//
// 決まり:
//   ・説明ではなく、最初の一手へ導く。各一手が起きるまで、起動のたびに出る
//   ・画面をうっすら暗くし(--c-coach-dim = --c-ink の 46%)、押してほしい所(的)だけを明るく残す。
//     明るい所の縁に枠線は付けない
//   ・カードは白・角丸 18・浮きの影。中身は丸いアイコン・見出し・1行(1行の無い一手もある)。文は押し方を書かない
//   ・動きは、一手が済んだときに暗幕とカードが 0.35 秒で溶けて消えるだけ(時間は index.css の .coach-layer が持つ)。
//     prefers-reduced-motion では溶けもしない(即座に消す)
//   ・【便BQ 2026-10-03 本人の実機指示】
//     「他のところタップで案内は消えるようにして」 … 的(穴)以外のどこを押しても(カードも暗幕も)案内は消える。
//       消えるのは**この起動の間だけ**で、印は立てない(一手はまだ済んでいない)。次の起動で、まだ済んでいなければまた出る。
//       同じ起動の中では、一度消した一手はタブを行き来しても出さない。外を押したその1回は**消すだけ**(暗幕が受け、下の部品には届かない)。
//       的(穴)を押したときは今までどおり下へ通して一手を起こす(穴の上には何も置かない)
//     「案内のポップアップは全て画面中央に出すようにして」 … カードは見える範囲(下部タブ・広告の帯を除く)の縦横の中央。
//       的に重なる場面だけ、的を避けて上か下にずらす(placeCoachCard)。便BP4〜6 の置き場所の決め方(重みの走査・
//       スクロールで出せるかの判定・部品の縁の候補・スクロール中は置き直さない・data-coach-avoid)は片付けた
//     「気になる奏者を開いてみようのパートは削除」 … 参加後1(openPerson)を外した。参加したら、すぐ参加後2
//   ・【便BS 2026-10-03 本人裁定】正典 = scratchpad の ficus-tutorial2.html。
//     参加前(join)の段は外した ── 参加の画面そのものが暗幕とカード1枚になった(CommunityTab.jsx の JoinIntro)。
//       印 join は「参加した」の印として残す(参加後の段 adoptAverage を出す門)
//     (便BS のときの計測タブの3段・データタブの dataSeen・的なしの段の作りは、【便BW】で下のとおり作り直した。印 join の扱いは今も同じ)
//   ・【便BW 2026-10-06 本人の要望・凍結仕様 coach2-spec.md】一本の流れに作り直した。
//     計測タブ: ① チューナー(的は環の箱。暗幕で隠していたのが本人の不満1。的なしの段は無くなった)→ ② メトロノーム →
//       (面の中・③④ が済むまで)③ テンポ行 → ④ 環を押してスタート → ⑤ 下部タブ「リード」→ リードタブ ⑥ 登録 → ⑦ このリードで計測 →
//       計測タブ ⑧ 左上のリードの枠 → ⑨ 計測(リードが選ばれていれば「このリードで計測してみよう」)→ ⑩ 下部タブ「データ」
//     データタブ: ⑫ 最新の計測の日のマス → ⑬ その日の先頭の記録 →(詳細)→ ⑭ 音の傾向カード(初回だけ的へスクロール)
//     ⑮ みんなの平均を目安にしたあと、帯の「見る」でデータタブの My Data へ移り、音の傾向カードを照らす
//       (【本人裁定 2026-10-06】計測タブではなくデータタブ。My Data の折れ線の既定は目安があれば my平均 × 目安)。
//       ⑭ と同じ的なので、⑮ を見た人には ⑭ を出さない(coachCandidates)
//     案内は自動でタブを移さない(⑤⑩ は下部タブを照らして待つ)。例外は帯の「見る」(本人が押した帯の操作)だけ。
//     押す=済(markOnDismiss)の段は ⑧⑭⑮ の3つ。この3つは外を押しても群(dismissWith)を消さない(次の段へ進ませるため)
//   ・【便BX 2026-10-06 本人の実機指示】⑧ の1行を「計測データに選択したリードが紐づきます」に
//     (⑥ リード登録の見出しの変更と楽器種別の行の2つ目の穴は、【便BY 2026-10-07 本人の指示】で便BW の形に戻した)
//   ・【便BX 2026-10-06 本人の決定・凍結仕様 coach3-spec.md(モック coach3-mock.html の A1-e・B1+B2・C・D1)】
//     流れ: 計測 ①〜⑤ → リード(到着 → ⑥⑦)→ 計測 ⑧⑨ → 保存の帯と同時に ⑩ → データ(到着 → ⑫⑬⑭ → ⑭' みんなのデータも見てみよう)→
//       コミュニティ(参加の画面 → 到着 → ⑯ 目安に)→ 帯「見る」→ データ(⑮ → ⑰ 計測タブに戻ろう)→ 計測 ⑱ 終わり(穴なし)
//     到着カード(arrival: true。リード・データ・コミュニティ・終わりの4つ): 穴なしの暗幕を画面いっぱいに敷き、どこを押しても「次へ」
//       (印を立てる)。外押しではないので群を消さない(dismissedRef に入れない)。どの到着も的を探さない
//     (章の目印(B2)は【便BY】で外し、枚数の目印に替えた ── 下の【便BY】)
//     帯と同時(⑩): 「保存しました」の帯が出ている間も ⑩ だけは出し、帯の箱を2つ目の穴(also)で明るく残す(「開く」は押せる)
//     カードの地(A1-e): --c-accent-tint・アイコンの丸は白(index.css。参加のカードは白のまま)
//   ・【便BY 2026-10-07 本人の指示「全ての案内において上の四つのタブ案内も削除 / 代わりにチュートリアルの案内の枚数を------で表して」】
//     章の目印(4章)を外し、カードの先頭に枚数の目印(Instagram のストーリーのような細い横棒。案内の全体の枚数 21本)を置いた。
//     (【便BZ】4本の棒に替え、流れの順 COACH_ORDER は消した ── 下の【便BZ】④。【便CF】1本の棒にし、COACH_ORDER を戻した)。時間で伸びる動きはしない(塗りだけ)。参加の画面のカード(JoinIntro)には付けない
//   ・【便BZ 2026-10-07 本人の実機の指摘・統括の裁定】
//     ① カードの置き場所: 的の上にも下にも収まらないときは、中央ではなく「的(穴)との重なりが最小の位置」(見える範囲の上端か下端)に置く
//       (placeCoachCard)。中央に落ちると、環の箱の真ん中 = 音名・セントにカードが重なっていた
//     ② ⑭⑮ の的へ送る判定: 「画面の外なら送る」→「見える範囲(上端 〜 readBottomLimit)に収まっていなければ送る」(coachScrollPlan)。
//       的が見える範囲の中央に来るように送り、見える範囲より高ければ上端をそろえる。この起動で1回だけ・前の段を待っている間は送らない(今までどおり)
//       浮かせるボタン(FloatingAction。z45)が穴の中に入っていると暗幕(穴の影)がかからず明るいまま的に重なっていた。穴にかかる浮かせるボタンには、
//       暗幕と同じ色の覆い(.coach-cover)を案内の層(z55)に置く(暗幕の下に入る扱い。押すと外押し)。そのボタン自身が的なら覆わない(押せる)
//     ③ 新しい段 goCompare「目安と比べてみよう」(⑯ の次)。目安の帯(「目安に設定しました · 見る」)と同時に出し(⑩ と同じ型)、
//       帯の箱と下部タブ「データ」を照らす。帯が消えたあとも、コミュニティタブにいる間は下部タブ「データ」だけを照らして出す。
//       コミュニティタブからデータタブへ移る(「見る」でも下部タブでも)と済み、⑮ を出す(App.jsx)。印は24・枚数は22・5つ目の門(migratedCoach4)
//     ④ 【本人の指示「22本だとかなり多く感じるので、棒は4本(タブの数)にしてその棒の中の塗りつぶしでそのタブ内での進捗を表現して」】
//       便BY の 21(22)本の棒を、下部タブと同じ並びの4本(計測・リード・コミュニティ・データ。字なし)に替えた。棒の中を、そのタブの段の
//       進み具合の割合だけ塗る(COACH_TABS / coachProgress)。今の段のタブの棒だけ濃い紺。⑱ では4本とも全部塗られる
//       (【便CF】1本の棒に替え、COACH_TABS は消した ── 下の【便CF】)
//   ・【便CF 2026-10-09 本人の選択(モック progress-mock.html の案1「全体で1本の棒」。数字は添えない)】
//     4本の棒を、流れの全体(22枚)のうち何枚目までかを左から塗る1本の棒に替えた。流れの順は1か所の定数 COACH_ORDER に戻した
//     (DESIGN-SYSTEM §4.5b の22枚。流れの外の ⑪ は数えない)。塗る量 = (済んだ段 + その利用者に出ない段(COACH_SKIPPED)+ 今の段)/ 22。
//     外を押して消しただけの段は済んだ扱いにしない(便BZ のまま)。動き・transition は無い。参加の画面のカード(JoinIntro)には付けない
//     【便CF 審査 統括の裁定】塗る数 = max(上の数, 今の段の位置 + 1, この起動の中で見せた最大)。⑦⑧ で止まり ⑩ で2つ進む段差を消し、
//     ⑱ は必ず 22/22・手前の段に戻っても表示は前より少なくならない(最大は OnboardingCoach の ref。保存はしない)
//   ・【便CG 2026-10-09 本人の要望「(進み具合の目印は)もうなくてもいいかなあ 全部終わらせなくたってこのアプリは使えるわけだし」】
//     目印(1本の棒)をカードから外した。流れの順の定数 COACH_ORDER・塗りの計算 coachProgress・もう出ない段 COACH_SKIPPED・
//     ⑨ と同じ段の読み替え COACH_STEP_ALIAS・その起動の最大(shownMaxRef)は使い手が無くなったので消した。カードの最初の子はアイコン
//   ・【便CG 本人の要望「チュートリアル中は広告なしにできませんか」・統括の裁定】はじめの案内が終わるまで広告の帯を出さない(adsAllowed)。
//     ⑱ が済んだとき、または「初めて案内のカードが出た起動」(kv の ONBOARDING_SHOWN_KEY)の次の起動から始める。
//     カードが出たことは OnboardingCoach が onShown で知らせる(1回の部品の間に1回)
//
// **判断はこのファイルの純関数が持つ**(どの一手を出すか・印の立て方・移行・穴とカードの位置)。
// App.jsx は「いまの状態」を渡し、成功の道で markOnboardingDone を呼ぶだけ。
// ------------------------------------------------------------------

// 済んだ印の保存の鍵(usePersistedState = IndexedDB の kv)。アカウント引継は kv を丸ごと書き出すので、
// この鍵もファイルに入る(backup/localStore.js の readAll)。
export const ONBOARDING_KEY = "onboardingDone";
// 印の名前。**一度 true になったら戻さない**(計測やリードを消しても戻らない)。
// 【便BQ】openPerson(参加後1)は外した。前の版で保存された openPerson は読み捨てる(残っていても害は無い)。
// 【便BS】tuner / metronome(計測タブの1段目・2段目)と dataSeen(データタブの計測があるときの段)を足した。
// 【便BW】新しい9つ(metroTempo 〜 idealSeen)を足した。dataSeen は段が無くなったが、前の版が保存した値を移行で読むので印の名前は残す。
// 【便BX】新しい6つ(到着4つ・⑭' goCommunity・⑰ goMeasure)を足した(23)。
export const ONBOARDING_FLAGS = ["measure", "reeds", "reedsMeasure", "join", "adoptAverage", "tuner", "metronome", "dataSeen",
  "metroTempo", "metroStart", "goReeds", "reedLinked", "goData", "calendarDay", "daySession", "trend", "idealSeen",
  "arriveReeds", "arriveData", "arriveCommunity", "goCommunity", "goMeasure", "finish",
  // 【便BZ】目安と比べてみよう(⑯ の次。コミュニティ → データの橋)
  "goCompare"];
// 【便BS】計測タブの3段の移行を済ませたかの印。便BP の移行(migrated)を済ませた人(配信済み)にも、
// 計測があれば tuner・metronome を済みにするために、別の印で1回だけ走らせる(migrateOnboardingDone)。
export const MEASURE_STEPS_MIGRATED = "migratedMeasureSteps";
// 【便BW】新しい段の移行を済ませたかの印(3つ目の門)。計測が1件でもある人には新しい段を1つも出さない。
export const COACH2_MIGRATED = "migratedCoach2";
// 【便BX】新しい段(到着4つ・⑭'・⑰)の移行を済ませたかの印(4つ目の門)。計測が1件でもある人には新しい段を1つも出さない。
export const COACH3_MIGRATED = "migratedCoach3";
// 【便BZ】新しい段(goCompare)の移行を済ませたかの印(5つ目の門)。計測が1件でもある人・⑮ を見た人には出さない。
export const COACH4_MIGRATED = "migratedCoach4";
// 【便BW】計測タブの段(出す順の id)。外を押して消したら、この全部をこの起動の間は出さない(押す=済の reedLinked を除く。COACH_STEPS)。
export const MEASURE_TAB_STEPS = Object.freeze(["tuner", "metronome", "metroTempo", "metroStart", "goReeds", "reedLinked", "measure", "measureReed", "goData"]);
// 【便BS】の移行(migratedMeasureSteps)が「計測があれば済み」にしていた3段。移行の結果を変えないため、この便で広げた群とは別に持つ。
export const MEASURE_TAB_STEPS_LEGACY = Object.freeze(["tuner", "metronome", "measure"]);
// 【便BW】データタブの段(計測があるとき)。外を押して消したら、この全部をこの起動の間は出さない。
export const DATA_TAB_STEPS = Object.freeze(["calendarDay", "daySession", "trend"]);
// 【便BW】計測が1件保存されたら、計測タブの章を閉じる(計測したことがある人に初めての人向けの案内を出さない)。
export const MEASURE_CHAPTER_FLAGS = Object.freeze(["measure", "tuner", "metronome", "metroTempo", "metroStart", "goReeds", "reedLinked"]);
// 【便BS】チューナーの段が済むまでの長さ。音程が**続けて**この長さ取れたら済み(本人裁定「音程が1秒ほど続けて取れた」)。
// 動きの時間ではなく「待つ長さ」(DESIGN-SYSTEM §1.11 の段の外)。
export const TUNER_SUSTAIN_MS = 1000;
// usePersistedState の初期値(まだ一度も保存されていない)。
export const ONBOARDING_INITIAL = Object.freeze({});
// 出し得る一手が無いときに渡す空の並び(描くたびに新しい [] を作らない)。
export const NO_COACH = Object.freeze([]);

// 【便BZ 2026-10-07 統括の裁定】下部タブを照らす段(⑤⑩⑪⑭'⑰・goCompare)の的は、絵柄(svg)ではなく**ボタンの箱**(絵柄 + 名前。44 の高さ)。
// 形は角丸の矩形(--r-2)・pad 0(環の箱・音の傾向カードと同じ「箱」の値)。下部タブに名前を足したので、絵柄を中心にした直径 52 の丸では
// 名前の字の左右が暗幕の下に入っていた。ボタンの箱なら絵柄と字がどちらも明るく入り、押せる範囲(ボタン)と照らす範囲が一致する。
// 重なり順(DESIGN-SYSTEM §4.5a)。下部タブ(30)・浮かぶボタン(45)・一時的な告知(50)より上、
// シートの暗幕(60)より下。暗幕は下部タブも含めて全体を覆う(データタブの的が下部タブのため)。
export const COACH_Z = 55;
// カードと画面の左右の間隔・的とカードの間隔(版4の .coach の left/right 22 と、的の下に置くときの + 22)。
export const COACH_EDGE_PX = 22;

// 一手の表(【便BS】参加前を外し、チューナー・メトロノーム・データ(計測あり)を足して8つ。【便BW】dataSeen を外し、10段を足して17)。文は凍結仕様の表のまま(一字一句。【便BQ】リード1・リード2は本人の指示で替えた)。pad / shape は版4の .spot の値。
//   pad   … 的の矩形から穴を広げる幅(px)
//   shape … circle = 的の中心に、長い辺 + pad×2 の円 / pill = 角丸 999 / rect = 角丸 12(--r-2)
//   line  … 1行。null なら出さない(見出しだけ)
// target は的を探す CSS セレクタ。的の要素は各画面が data-coach で名乗る(無ければ出さない)。
// (便BP〜便BY: データタブの的は下部タブの「計測」ボタンの絵柄 30×30 を pad 11 の円(直径 52)で囲んでいた。
//  【便BZ】下部タブに名前を足したので、ボタンの箱(角丸の矩形・pad 0)に替えた ── 上の【便BZ】)
// (【便BW】的なし(target: null)の段は無くなった。【便BX】到着カード(arrival: true)の4段だけは target を持たない ── 穴なしで的を探さない)
//   arrival … 【便BX 本人の決定 B1】到着カード。穴なし・画面いっぱいの暗幕・どこを押しても「次へ」(印を立てる)・群なし
//   dismissWith … 外を押して消したときに、一緒にこの起動の間は出さない段(既定はその段だけ)
//   markOnDismiss … 外(暗幕・カード)を押したら、その段の印を立てる(押すことが一手そのものの段)。群は持たない(次の段へ進ませる)
//   scrollIntoView … 的が見える範囲(上端 〜 下部タブ・広告の帯の上端)に収まっていなければ、この起動で1回だけ送る(【便BW】音の傾向カード。【便BZ】判定は coachScrollPlan)
//   also … 【便BX】2つ目の穴({ target, pad, shape })。的(1つ目)が見えているときだけ探し、画面にまるごと見えていて
//          1つ目と縦に重ならなければ一緒に明るく残す(見えていなければ1つ目だけ)。カードの位置は1つ目で決める
//          (【便BY】⑥ の楽器種別の行の穴は外した。持つのは ⑩ goData(保存の帯の箱)と【便BZ】goCompare(目安の帯の箱))
export const COACH_STEPS = {
  // 【便BW 2026-10-06 本人の要望1】計測タブ1段目。的は環の箱(環と音名。吹いて動く所)。
  // 【便BW 審査 統括の裁定】最初はチューナーの帯(環 + 折れ線)全体だったが、カードが帯の中央に重なって環を覆った(広告あり・iPad 横)ので環に絞った。
  // 便BS では「押す所が無い」ので的なし(画面いっぱいの暗幕)にしていたが、吹いて変わる所まで暗くなっていた。
  tuner: {
    flag: "tuner", icon: "tuner",
    title: "まずは吹いてみよう", line: "音程がリアルタイムで表示されます",
    target: '[data-coach="tuner"]', pad: 0, shape: "rect", dismissWith: MEASURE_TAB_STEPS,
  },
  // 【便BS】計測タブ2段目。的は右上のメトロノームのアイコンのボタン(44 角)。版の .spot の pad 0 で丸く囲む。
  metronome: {
    flag: "metronome", icon: "metro",
    title: "メトロノームも使えます", line: "テンポを決めて練習できます",
    target: '[data-coach="metronome"]', pad: 0, shape: "circle", dismissWith: MEASURE_TAB_STEPS,
  },
  // 【便BW 本人の要望2】メトロノームの面の中の2段。③ テンポ行(− ♩=n ＋)。♩=n を押すと拍子・分割のシート(本人裁定 ア)。
  metroTempo: {
    flag: "metroTempo", icon: "metro",
    title: "テンポを決めよう", line: "♩=n を押すと拍子も変えられます",
    target: '[data-coach="metroTempo"]', pad: 6, shape: "pill", dismissWith: MEASURE_TAB_STEPS,
  },
  // ④ 帯のどこを押しても開始(A-1 の背面レイヤ)。的は①と同じ環の箱(環は当たり判定を持たないので、押すと背面レイヤに届いて鳴る)。
  metroStart: {
    flag: "metroStart", icon: "metro",
    title: "タップでスタート", line: "もう一度押すと止まります",
    target: '[data-coach="tuner"]', pad: 0, shape: "rect", dismissWith: MEASURE_TAB_STEPS,
  },
  // 【便BW 本人の要望3】⑤ 下部タブ「リード」。自動では移さない(押してもらうのを待つ)。【便BZ】的はボタンの箱(絵柄 + 名前)・pad 0・角丸の矩形。
  goReeds: {
    flag: "goReeds", icon: "reeds",
    title: "次はリードを登録しよう", line: null,
    target: '[data-coach="nav-reeds"]', pad: 0, shape: "rect", dismissWith: MEASURE_TAB_STEPS,
  },
  // 【便BW 本人の要望5】⑧ 左上のリードの枠(点 + メーカー + 厚さ + 開封日 + #n)。押す=済(外でもカードでも)。
  reedLinked: {
    flag: "reedLinked", icon: "reeds",
    // 【便BX 2026-10-06 本人の実機指示】1行を「計測データに選択したリードが紐づきます」に。
    title: "選んだリードが紐づいています", line: "計測データに選択したリードが紐づきます",
    target: '[data-coach="reedChip"]', pad: 6, shape: "pill", markOnDismiss: true,
  },
  // 【便BW 本人の要望6】⑨ リードが選ばれているときの計測の段。印は measure(リードなしの段と同じ印で文が2つ)。
  measureReed: {
    flag: "measure", icon: "mic",
    title: "このリードで計測してみよう", line: "ボタンタップで計測スタート",
    target: '[data-coach="measure"]', pad: 14, shape: "circle", dismissWith: MEASURE_TAB_STEPS,
  },
  measure: {
    flag: "measure", icon: "mic",
    title: "最初の計測を記録しよう", line: "ボタンタップで計測スタート",
    target: '[data-coach="measure"]', pad: 14, shape: "circle",
    // 【便BS】計測タブの段。外を押したら計測タブの段を全部出さない
    dismissWith: MEASURE_TAB_STEPS,
  },
  // 【便BW 本人の要望7】⑩ 下部タブ「データ」(【便BZ】ボタンの箱・pad 0・角丸の矩形)。計測があるときだけ。
  goData: {
    flag: "goData", icon: "data",
    title: "計測の記録を見てみよう", line: null,
    target: '[data-coach="nav-analysis"]', pad: 0, shape: "rect", dismissWith: MEASURE_TAB_STEPS,
    // 【便BX 2026-10-06 本人の決定 C】保存の帯(「HH:mm の計測を保存しました」+「開く」)と同時に出す。帯の箱(App.jsx の ActionNotice の内箱が
    // data-action-notice で名乗る)を2つ目の穴で明るく残す(穴の中には受けを置かないので「開く」は押せる)。帯が無ければ1つ目だけ(今までどおり)
    also: { target: "[data-action-notice]", pad: 0, shape: "rect" },
  },
  // 【便BX 2026-10-06 本人の決定 B1】到着カード(穴なし・どこを押しても次へ = 印を立てる・群なし)。章が変わってタブに着いた直後に1枚。
  // target を持たない(的を探さない)。pad / shape / dismissWith / markOnDismiss / scrollIntoView / also も持たない。
  // ⑱ 終わり。⑮ を見て計測タブへ戻ったら(goMeasure)。穴なしなのでマイクも面の開閉も待たない
  finish: {
    flag: "finish", icon: "tuner",
    title: "チューナーとメトロノームを使って、あなたのデータを貯めよう！", line: "はじめの案内はこれで終わりです",
    arrival: true,
  },
  // リードタブに着いた(⑥⑦ より先)
  arriveReeds: {
    flag: "arriveReeds", icon: "reeds",
    title: "ここはリードタブ", line: "使っているリードを登録して、計測に紐づけます",
    arrival: true,
  },
  // データタブに着いた(計測があるときだけ。⑫⑬⑭ より先。計測が無いときは ⑪ の文が場所を言っている)
  arriveData: {
    flag: "arriveData", icon: "data",
    title: "ここはデータタブ", line: "計測の記録はここに貯まります",
    arrival: true,
  },
  // コミュニティに着いた(参加した直後・参加済みの人がタブを開いた直後。⑯ より先)。「タブ」を付けない(モックのまま)
  arriveCommunity: {
    flag: "arriveCommunity", icon: "community",
    title: "ここはコミュニティ", line: "参加した人の計測データと、みんなの平均が見られます",
    arrival: true,
  },
  // 【便BX 本人の決定 C】⑭' データ → コミュニティの橋。下部タブ「コミュニティ」(【便BZ】ボタンの箱・pad 0・角丸の矩形)。参加済みの人には出さない
  goCommunity: {
    flag: "goCommunity", icon: "community",
    title: "みんなのデータも見てみよう", line: null,
    target: '[data-coach="nav-community"]', pad: 0, shape: "rect",
  },
  // 【便BX 本人の決定 C】⑰ ⑮ を見たあと計測タブへ戻る橋。的は ⑪ と同じ下部タブ「計測」(【便BZ】ボタンの箱)。アイコンは下部タブ「計測」と同じ系統(measure)
  goMeasure: {
    flag: "goMeasure", icon: "measure",
    title: "計測タブに戻ろう", line: null,
    target: '[data-coach="nav-measure"]', pad: 0, shape: "rect",
  },
  // 【便BZ 2026-10-07 本人の指摘「目安に設定した後どうしたらいいかわからない」・統括の裁定】⑯ の次。コミュニティ → データの橋。
  // 的は下部タブ「データ」のボタンの箱(⑩ と同じ・pad 0・角丸の矩形)。目安の帯(「目安に設定しました · 見る」)が出ていれば、
  // ⑩ と同じく帯の箱を2つ目の穴で明るく残す(「見る」は押せる)。帯が消えたら下部タブ「データ」だけ(also の今までの道)。
  // 済む条件(App.jsx): コミュニティタブからデータタブへ移った(「見る」でも下部タブでも)。そのとき ⑮ を頼む
  goCompare: {
    flag: "goCompare", icon: "data",
    title: "目安と比べてみよう", line: null,
    target: '[data-coach="nav-analysis"]', pad: 0, shape: "rect",
    also: { target: "[data-action-notice]", pad: 0, shape: "rect" },
  },
  reeds: {
    flag: "reeds", icon: "reeds",
    // 【便BQ 2026-10-03 本人指示】1行を「計測に登録したリードを紐づけることができます」に。
    // 【便BY 2026-10-07 本人の指示「リード登録の時の楽器を選択して〜の案内はやっぱり削除」】見出しを便BW の「使っているリードを登録しよう」に戻し、
    // 便BX の楽器種別の行の2つ目の穴(also)を外した(穴は「リードを追加」の1つ)。
    title: "使っているリードを登録しよう", line: "計測に登録したリードを紐づけることができます",
    target: '[data-coach="reeds"]', pad: 10, shape: "circle",
  },
  // 【便BP2 2026-10-03 統括の裁定】2つの画面をまたいで同じ一手を案内する。一覧では先頭の箱の先頭のタイル(角丸 12 の四角)、
  // タイルを押して個体詳細に入ったら詳細の計測ボタン(丸。data-coach-shape="circle" で形を名乗る)。済む条件は同じ。
  reedsMeasure: {
    flag: "reedsMeasure", icon: "measure",
    // 【便BQ 2026-10-03 本人指示】1行は無し(見出しだけ)。
    title: "このリードで計測してみよう", line: null,
    target: '[data-coach="reedsMeasure"]', pad: 4, shape: "rect",
  },
  data: {
    flag: "measure", icon: "data",
    title: "計測を始めると、ここに貯まります", line: "計測タブから計測してみよう",
    target: '[data-coach="nav-measure"]', pad: 0, shape: "rect",
  },
  // (【便BS】の dataSeen「計測したデータがここに貯まります」(的なし)はここにあった。【便BW】役目は ⑫⑬⑭ が継いだ。印の名前は残す)
  // 【便BW 本人の要望7】⑫ カレンダーの最新の計測の日のマス(その日の枠が閉じているときだけ名乗る)。
  calendarDay: {
    flag: "calendarDay", icon: "data",
    title: "計測した日を押してみよう", line: null,
    // 【便BW 再審査】的は中の丸(34)。pad 5 で直径 44(§5 の当たりの最小)。iPhone・iPad とも同じ大きさ。
    // passThrough: 丸の外でもマス(押せる日のボタン)の中は下へ通す(外押しにしない。iPad のマスは幅 87)
    target: '[data-coach="calendarDay"]', pad: 5, shape: "circle", passThrough: "button", dismissWith: DATA_TAB_STEPS,
  },
  // ⑬ 開いた日の枠の先頭の記録の行。押すと計測の詳細(詳細の中にカードは置かない)。
  daySession: {
    flag: "daySession", icon: "data",
    title: "記録を開いてみよう", line: null,
    target: '[data-coach="daySession"]', pad: 4, shape: "rect", dismissWith: DATA_TAB_STEPS,
  },
  // 【便BW 本人の要望8】⑭ 音の傾向カード。My Data の最下段なので、初回だけ的へスクロール。押す=済。
  trend: {
    flag: "trend", icon: "data",
    title: "データが溜まると、平均がここにグラフで出ます", line: null,
    target: '[data-coach="trend"]', pad: 0, shape: "rect", markOnDismiss: true, scrollIntoView: true,
  },
  // 【便BW 本人の要望9・本人裁定 2026-10-06】⑮ みんなの平均を目安にしたあと、帯の「見る」で来たときだけ。的は ⑭ と同じ音の傾向カード
  // (目安があれば折れ線の既定は my平均 × 目安)。押す=済。
  idealSeen: {
    flag: "idealSeen", icon: "target",
    title: "みんなの平均を目安にしました", line: "my平均と目安を重ねて見られます",
    target: '[data-coach="trend"]', pad: 0, shape: "rect", markOnDismiss: true, scrollIntoView: true,
  },
  // (【便BS】参加前(join)の段はここにあった。参加の画面そのものが暗幕とカード1枚になったので外した。CommunityTab.jsx の JoinIntro)
  adoptAverage: {
    flag: "adoptAverage", icon: "target",
    title: "みんなの平均を目安にしてみよう", line: "目安に設定すると自分の音と比べられます",
    target: '[data-coach="adoptAverage"]', pad: 0, shape: "rect",
  },
};
// 読み上げる文(見出しと1行。1行が無ければ見出しだけ)。
export function coachSpeech(step) {
  return step.line ? `${step.title}。${step.line}` : step.title;
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// 保存された値を読む形にそろえる(true 以外は「まだ」)。migrated は移行を済ませたかの印。
export function normalizeOnboardingDone(raw) {
  const src = isObj(raw) ? raw : {};
  const out = {};
  for (const k of ONBOARDING_FLAGS) out[k] = src[k] === true;
  out.migrated = src.migrated === true;
  out[MEASURE_STEPS_MIGRATED] = src[MEASURE_STEPS_MIGRATED] === true;
  out[COACH2_MIGRATED] = src[COACH2_MIGRATED] === true;
  out[COACH3_MIGRATED] = src[COACH3_MIGRATED] === true;
  out[COACH4_MIGRATED] = src[COACH4_MIGRATED] === true;
  return out;
}

// 成功の道で印を立てる。**立てるだけ**(false へ戻す道は無い)。既に立っていれば同じ物を返す(書き込みを起こさない)。
export function markOnboardingDone(prev, flag) {
  if (!ONBOARDING_FLAGS.includes(flag)) return prev;
  if (isObj(prev) && prev[flag] === true) return prev;
  return { ...(isObj(prev) ? prev : {}), [flag]: true };
}

// 【便CG 2026-10-09 本人の要望「チュートリアル中は広告なしにできませんか」・統括の裁定】はじめの案内が終わるまで、広告の帯を出さない。
// 「初めて案内のカードが出た起動」の印。kv の1つの鍵に true を持つ(onboardingDone とは別の鍵。印の表 ONBOARDING_FLAGS には入れない)。
// カードが出たら立てる(OnboardingCoach の onShown)。**起動の最初に読んだ値**が true なら、その起動は2回目以降(下の adsAllowed の (b))。
export const ONBOARDING_SHOWN_KEY = "onboardingShown";
// 広告の帯(殻の本物の帯と ATT・Web の見本の帯)を始めてよいか。次のどちらかが先に起きたら始める:
//   (a) 最後の段 ⑱ が済んだ(印 finish。移行で案内が全部済んだ既存の利用者も finish が立っている = 今までどおり最初から)
//   (b) 2回目以降の起動(初めて案内が出た起動を終えて、次に開いた)。案内を全部終わらせない人に広告がずっと出ないのを避ける
// 引数:
//   preview     … はじめの一手の見本(?tutorialpreview=1)。見本の案内は毎回最初から見せるので、見本の印の finish だけを見る((b) は使わない)
//   loaded      … 印(onboardingDone と ONBOARDING_SHOWN_KEY)の読み込みが済んだか。済むまでは始めない
//   readOk      … 本当に読めたか。読めない起動は案内を出さない(App.jsx の coachReady が立たない)ので、今までどおり始める
//   done        … 案内が読む印(normalizeOnboardingDone の形)
//   shownBefore … 起動の最初に読んだ ONBOARDING_SHOWN_KEY(この起動で立てた分は入れない)
export function adsAllowed({ preview = false, loaded = false, readOk = false, done = null, shownBefore = false } = {}) {
  if (preview) return done?.finish === true;
  if (!loaded) return false;
  if (!readOk) return true;
  return done?.finish === true || shownBefore === true;
}

// 計測が1件保存されたときに立てる印(録音の保存・取り込みの保存の両方が呼ぶ)。
// リードを紐づけた計測なら「このリードで計測」(reedsMeasure)も済む。
// 【便BW】計測タブの章(MEASURE_CHAPTER_FLAGS)を全部閉じる ── 計測したことがある人に初めての人向けの案内を出さない。
export function onboardingFlagsForSavedSession(session) {
  return session?.reedId ? [...MEASURE_CHAPTER_FLAGS, "reedsMeasure"] : [...MEASURE_CHAPTER_FLAGS];
}

// みんなの平均を取り込んだ目安か(名前が「みんなの平均」で始まる。screens.jsx の cohortAdoptName が付ける)。
export const COHORT_AVERAGE_NAME_PREFIX = "みんなの平均";
export function isCohortAverageProfile(p) {
  return typeof p?.name === "string" && p.name.startsWith(COHORT_AVERAGE_NAME_PREFIX);
}

// 既にある人の移行(更新後の最初の起動で1回だけ)。**読み込みが済んでから**呼ぶこと(呼び手の門)。
//   計測があれば measure / リードがあれば reeds / リードの紐づいた計測があれば reedsMeasure /
//   取り込んだ目安のうち、みんなの平均の目安があれば adoptAverage(【便BQ】openPerson は外した)。
// 参加(join)はここでは決めない ── 参加しているかはコミュニティタブが Firebase に訊いて初めて分かる。
// コミュニティタブが「参加済み」と分かった時点(プロフィールの画面に入った時点)で印を立てる。
// 立てるだけで、既に立っている印を倒さない。migrated が立っていれば何もしない(同じ物を返す)。
// 【便BS 2026-10-03 本人裁定】計測が1件でもあれば、計測タブの3段(tuner・metronome・measure)を済みにする
// (使い方を知っている人に出さない)。便BP の移行を済ませた人(migrated)にも、別の印(migratedMeasureSteps)で1回だけ当てる。
// dataSeen は移行で立てない(既存の人も、次にデータタブを開いたとき1回だけ出る)。
// 【便BW 2026-10-06 本人裁定(§14 の 2 = 既定 ア)】3つ目の門(migratedCoach2)。計測が1件でもある人には新しい段を1つも出さない
// (新しい8つの印を立てる)。リードがあれば goReeds、前の版で dataSeen を押した人はデータタブの3段、みんなの平均を取り込んである人は idealSeen。
// 【便BX 2026-10-06 本人の決定】4つ目の門(migratedCoach3)。計測が1件でもある人には新しい6つ(到着4つ・⑭'・⑰)を立てる。
// リードがあれば arriveReeds、参加していれば arriveCommunity・goCommunity、idealSeen が立っていれば goMeasure。
// 【便BZ】5つ目の門(migratedCoach4)。計測が1件でもある人・idealSeen が立っている人には goCompare を立てる。
export function migrateOnboardingDone(prev, { sessions = [], reeds = [], idealProfiles = [], isAdopted = () => false } = {}) {
  const base = isObj(prev) ? prev : {};
  if (base.migrated === true && base[MEASURE_STEPS_MIGRATED] === true && base[COACH2_MIGRATED] === true && base[COACH3_MIGRATED] === true
    && base[COACH4_MIGRATED] === true) return prev;
  const next = { ...base };
  const ss = Array.isArray(sessions) ? sessions : [];
  const rs = Array.isArray(reeds) ? reeds : [];
  // 【便BP3】みんなの平均の目安は、名前が「みんなの平均」で始まる取り込んだ目安で見分ける。
  const hasCohortIdeal = (Array.isArray(idealProfiles) ? idealProfiles : []).some((p) => isAdopted(p) && isCohortAverageProfile(p));
  if (base.migrated !== true) {
    if (ss.length > 0) next.measure = true;
    if (rs.length > 0) next.reeds = true;
    if (ss.some((s) => Boolean(s?.reedId))) next.reedsMeasure = true;
    // 【便BP3】adoptAverage は**みんなの平均の目安**があるときだけ。
    if (hasCohortIdeal) next.adoptAverage = true;
    next.migrated = true;
  }
  // 【便BS】計測タブの3段。立てるだけ(既に立っている印は倒さない)。【便BW】群が広がったので、便BS の3段は別の定数で持つ。
  if (ss.length > 0) { for (const f of MEASURE_TAB_STEPS_LEGACY) next[f] = true; }
  next[MEASURE_STEPS_MIGRATED] = true;
  // 【便BW】新しい段。1回だけ。
  if (base[COACH2_MIGRATED] !== true) {
    // 【便BW 審査】idealSeen も(本人裁定「既存の利用者には新しい段0枚」。計測がある人には「見る」は移動とスクロールだけ)
    if (ss.length > 0) for (const f of ["metroTempo", "metroStart", "goReeds", "reedLinked", "goData", "calendarDay", "daySession", "trend", "idealSeen"]) next[f] = true;
    if (rs.length > 0) next.goReeds = true;
    if (base.dataSeen === true) for (const f of DATA_TAB_STEPS) next[f] = true;
    if (hasCohortIdeal || base.adoptAverage === true) next.idealSeen = true;
    next[COACH2_MIGRATED] = true;
  }
  // 【便BX 2026-10-06 本人の決定】4つ目の門。計測が1件でもある人には新しい段(到着4枚・⑭'・⑰)を1つも出さない。
  // join / idealSeen は同じ呼び出しの中で3つ目までの門が立てた値も含めて読む(base ではなく next)。
  if (base[COACH3_MIGRATED] !== true) {
    if (ss.length > 0) for (const f of ["arriveReeds", "arriveData", "arriveCommunity", "goCommunity", "goMeasure", "finish"]) next[f] = true;
    if (rs.length > 0) next.arriveReeds = true;                                  // リードタブを知っている
    if (next.join === true) { next.arriveCommunity = true; next.goCommunity = true; }   // 参加している(コミュニティを知っている)
    if (next.idealSeen === true) next.goMeasure = true;                          // 便BW の門で idealSeen が立った人(目安を取り込んである)に「計測タブに戻ろう」を出さない
    next[COACH3_MIGRATED] = true;
  }
  // 【便BZ 2026-10-07 統括の裁定】5つ目の門。計測が1件でもある人には新しい段(goCompare)を出さない。
  // ⑮ を見た人(idealSeen。前の門が同じ呼び出しの中で立てた値も含めて next で読む)にも出さない(目安と比べる所はもう知っている)。
  if (base[COACH4_MIGRATED] !== true) {
    if (ss.length > 0 || next.idealSeen === true) next.goCompare = true;
    next[COACH4_MIGRATED] = true;
  }
  return next;
}

// 【便BZ】goCompare(目安と比べてみよう)がまだ開いているか: 目安にした(⑯)・まだ比べに行っていない・⑮ を見ていない・終わっていない(⑰ と同じく ⑱ のあとは出さない)。
// コミュニティタブの候補(coachCandidates)と、「この段から来た」の判定(coachCameFromCompare)が同じ式を読む(写しを作らない)。
export function goCompareOpen(d) {
  const x = d ?? {};
  return Boolean(x.adoptAverage) && !x.goCompare && !x.idealSeen && !x.finish;
}
// 【便BZ】この段から来たか: goCompare が開いている間に、コミュニティタブからデータタブへ移った(「見る」でも下部タブ「データ」でも)。
// 真なら App.jsx が goCompare の印を立て、⑮ を頼む(idealRequested)。
export function coachCameFromCompare({ from, to, done }) {
  return from === "community" && to === "analysis" && goCompareOpen(done);
}
// 【便BZ】帯(ActionNotice)が出ている間の決まり。帯が名乗るタブ(notice.coach)と、いま表に出ているタブが同じときだけ、
// **その帯が名乗る段だけ**を出してよい(【便BZ 統括の裁定】それ以外の段(⑱ など)は帯が消えるまで出さない ── 帯の「開く」「見る」を覆わない)。
//   計測(保存の帯)       … ⑩ goData だけ
//   コミュニティ(目安の帯) … goCompare だけ
// 違うタブ(帯の間にタブを移った)では出さない ── 着いた先の段(到着・⑮ など)が帯の「開く」「見る」を覆わない(便BX の罠)。
export const COACH_WITH_NOTICE = Object.freeze({ measure: Object.freeze(["goData"]), community: Object.freeze(["goCompare"]) });
export function coachDuringNotice({ candidates, notice, topTab }) {
  if (!notice) return { candidates, hidden: false };
  if (!notice.coach || notice.coach !== topTab || !(topTab in COACH_WITH_NOTICE)) return { candidates, hidden: true };
  const only = COACH_WITH_NOTICE[topTab];
  return { candidates: (candidates ?? []).filter((id) => only.includes(id)), hidden: false };
}

// いまのタブで出し得る一手(順番どおり。的が画面に在る最初の1つを出す)。
//   計測   … マイクの許可が済んでいる(micReady)ときだけ。【便BW】① → ② →(面の中)③ → ④ → ⑤ →(面の外)⑤ → ⑧ → ⑨ → ⑩ の順に1つずつ
//   リード … 登録 → 登録が済んだら「このリードで計測」
//   データ … 計測の有無で分ける(同時には出ない)。計測が無い: 計測タブへ(計測が済むまで。計測タブと共通の印。今までどおり) /
//            計測がある: 【便BW】⑫ 日のマス → ⑬ 記録の行 → ⑭ 音の傾向。計測の有無が読めるまで(sessionsKnown)はどちらも出さない
//   コミュニティ … 参加したら(印 join)、すぐみんなの平均を目安に(【便BQ】奏者を開く段は外した。【便BS】参加前の段も外した)
// 【便BS 審査 2026-10-03 統括の裁定】
//   metroPanelOpen … メトロノームの面が開いている間は、計測の段(measure)を出さない(面の上に出て最初のテンポ操作を食べるため)。
//                    面を閉じたら出る。メトロノームの印は今までどおり面を開いたときに立てる
//   (【便BW】dataSeenDeferred は dataSeen の段と一緒に外した。0件 → 1件の起動では ⑩ → ⑫ と続いてほしい)
// 【便BW 2026-10-06 凍結仕様 §6・本人裁定】
//   hasSelectedReed … 計測タブの枠にリードが出ている(いまの楽器のリードが選ばれている)。⑧ と ⑨ の文を決める
//   idealRequested  … 帯の「見る」からデータタブへ来た(⑮)。他のどの段より先・1回だけ。計測の有無を待たない(音の傾向カードは 0件でも在る)
//   計測タブは1つだけ返す(的が無ければ何も出ない)。データタブは並びで返す(日の枠の開閉で ⑫⑬ のどちらの的が在るかが決まる)。
//   ⑭ と ⑮ は同じ的(音の傾向カード)。⑮ を見た人には ⑭ を出さない(同じカードの案内を2回続けない)。⑭ を先に見た人にも ⑮ は出る(目安の話は新しい)
// 【便BX 2026-10-06 凍結仕様 coach3-spec.md §3】到着(リード・データ(計測があるとき)・コミュニティ(参加したら))はそのタブの先頭。
//   ⑱ finish は計測タブの先頭(マイクの門・面の分岐より前)。データタブの並びの後ろに ⑭' goCommunity・⑰ goMeasure。引数は変えていない
export function coachCandidates({
  topTab, done, micReady = false, hasSessions = false, sessionsKnown = true,
  metroPanelOpen = false, metronomeOn = false, metroTempoQuiet = true, hasSelectedReed = false, idealRequested = false,
}) {
  const d = done ?? {};
  switch (topTab) {
    case "measure": {
      // 【便BX】⑱ 終わり(穴なし)。穴なしなのでマイクも面の開閉も待たない(殻でタブへ戻った直後の取り直しの間にも出る)
      // 【便BX 審査 統括の裁定】コミュニティを見た(goCommunity)あと計測タブにいれば出す。参加・目安にする・「見る」が済んでいなくても出す
      // (参加を見送った人・「見る」を押さなかった人・途中でアプリを閉じた人も、計測タブに戻れば ⑱ で終わる)。
      // 計測の章(measure)とデータへの橋(goData)が済んでいることは今までどおり要る(計測の前にコミュニティを覗いた人・
      // 参加していて計測が無い人(移行で goCommunity が立つ)に、① より先に「終わり」を出さない)。goMeasure は ⑰ から来た道
      if ((d.goCommunity || d.goMeasure) && d.measure && d.goData && !d.finish) return ["finish"];
      if (!micReady) return [];
      if (!d.tuner) return ["tuner"];
      if (!d.metronome) return ["metronome"];
      // 面の中の段(③④)は、面が開いていて ③④ が済んでいないときだけ。
      // 【便BW 審査 2026-10-06 統括の裁定】③④ が済んでいれば、面が開いていても閉じているときと同じ ⑤→⑧→⑨→⑩ に合流する
      // (面はタブをまたいで開いたままなので、⑦ の「計測」で戻る本筋の道で流れが止まっていた)。面を閉じる段は足さない(閉じると鳴りやむ)。
      if (metroPanelOpen && !d.metroTempo) return ["metroTempo"];
      // 【便BW 再審査 統括の裁定(a)】④ はテンポ行に最後に触れてから TUNER_SUSTAIN_MS の間なにも触れなかったとき(metroTempoQuiet)に出す
      // (③ のあと続けて − / ＋ を押すと、④ のカードがテンポ行を覆っていて、その1回が外押しになって計測タブの段がまるごと消えていた)
      if (metroPanelOpen && !d.metroStart) return metroTempoQuiet ? ["metroStart"] : [];
      // 【便BW 審査】面が開いていて鳴っている間は ④ の次の段を出さない(④ の文が促す2回目のタップが次の段の受けに当たり、
      // 外押しとして計測タブの段がこの起動の間まるごと消えていた)。止まったら出す
      if (metroPanelOpen && metronomeOn) return [];
      if (!d.goReeds && !d.reeds) return ["goReeds"];
      if (hasSelectedReed && !d.reedLinked) return ["reedLinked"];
      if (!d.measure) return [hasSelectedReed ? "measureReed" : "measure"];
      if (hasSessions && !d.goData) return ["goData"];
      return [];
    }
    case "reeds": {
      // 【便BX】到着(穴なし)。⑥⑦ より先
      if (!d.arriveReeds) return ["arriveReeds"];
      return !d.reeds ? ["reeds"] : !d.reedsMeasure ? ["reedsMeasure"] : [];
    }
    case "analysis": {
      if (idealRequested && !d.idealSeen) return ["idealSeen"];
      if (!sessionsKnown) return [];
      if (!hasSessions) return !d.measure ? ["data"] : [];
      // 【便BX】到着(穴なし)。計測があるときだけ(無いときは ⑪ の文「ここに貯まります」が場所を言っている)
      if (!d.arriveData) return ["arriveData"];
      const out = [];
      if (!d.calendarDay) out.push("calendarDay");
      if (!d.daySession) out.push("daySession");
      if (d.daySession && !d.trend && !d.idealSeen) out.push("trend");
      // 【便BX】⑭' データ → コミュニティの橋(参加済みの人には出さない)/ ⑰ ⑮ を見たあと計測タブへ戻る橋
      if (d.trend && !d.join && !d.goCommunity) out.push("goCommunity");
      // 【便BX 審査 統括の裁定】⑰ は目安にした(adoptAverage)だけでも出す(「見る」を押さずにデータタブへ来た人)。終わった後(finish)は出さない
      if ((d.idealSeen || d.adoptAverage) && !d.goMeasure && !d.finish) out.push("goMeasure");
      return out;
    }
    case "community": {
      if (!d.join) return [];
      // 【便BX】到着(穴なし)。参加した直後(プロフィールを作った)・参加済みの人がタブを開いた直後。⑯ より先
      if (!d.arriveCommunity) return ["arriveCommunity"];
      if (!d.adoptAverage) return ["adoptAverage"];
      // 【便BZ】⑯ の次: 目安と比べてみよう(目安の帯と同時に・帯が消えたあともコミュニティタブにいる間)
      return goCompareOpen(d) ? ["goCompare"] : [];
    }
    default: return [];
  }
}

// 【便BS】チューナーの段が済む条件: on(マイクが動いていて・エラーが無く・環に音名が出ている)が ms のあいだ**途切れずに**続いた。
// 途切れたら数え直す。on が続いている間に ms が経ったら onReached を1回呼ぶ(呼び手が印を立てる)。
export function useSustained(on, ms, onReached) {
  const cbRef = useRef(onReached);
  cbRef.current = onReached;
  useEffect(() => {
    if (!on) return undefined;
    const t = setTimeout(() => cbRef.current?.(), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
}

// 的が画面の中に**まるごと**見えているか。大きさ 0(描かれていない)・画面の外(スクロール・ページャの隣のページ)は出さない。
export function targetVisible(r, vw, vh) {
  if (!r || !(r.width > 0) || !(r.height > 0)) return false;
  return r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh;
}

// 明るく残す穴(画面の座標)。的の getBoundingClientRect から作る。
export function holeOf(r, step) {
  const pad = step.pad;
  if (step.shape === "circle") {
    const d = Math.max(r.width, r.height) + pad * 2;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return { left: cx - d / 2, top: cy - d / 2, width: d, height: d, shape: "circle" };
  }
  return { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2, shape: step.shape };
}

// カードの縦の位置。【便BQ 2026-10-03 本人指示「案内のポップアップは全て画面中央に出すようにして」】
// 見える範囲(画面の上端 〜 下部タブ・広告の帯の上端 = bottomLimit)の縦の中央。横は CSS(.coach-card の left/right 22px)で中央。
// 中央のカードが的(穴)の上下 gap の内側にかかるときだけ、的を避けて上(穴の上端 − gap − カードの高さ)か
// 下(穴の下端 + gap)にずらす。見える範囲(上下に gap を残す)に収まるほうのうち、中央に近いほう。
// 【便BZ 2026-10-07 本人の実機の指摘(① の環の箱で音名・セントが読めない)】どちらも収まらなければ、中央ではなく
// **的(穴)との重なりが最小の位置**に置く。置ける範囲は見える範囲の上下に gap を残した [gap, 下端 − gap − カードの高さ] で、
// 重なりはその範囲の両端のどちらかで最小になる(重なりは位置について「増える → 平ら → 減る」の形)ので、両端を比べる。
// 同じなら中央に近いほう。以前の「中央のまま」は、大きな的(環の箱)の真ん中 = 音名・セントにカードを重ねていた。
// 置ける範囲が無い(カードが見える範囲より高い)ときだけ中央のまま。重なりが残れば overlaps で返す。
// 【便BX】到着カード(hole が null)は中央のまま。
export function placeCoachCard({ hole, cardH, vh, bottomLimit = vh, gap = COACH_EDGE_PX }) {
  const viewBottom = Math.min(bottomLimit, vh);
  const center = (viewBottom - cardH) / 2;
  if (!hole) return { top: center, side: "center", shifted: false, overlaps: false };
  const holeTop = hole.top;
  const holeBottom = hole.top + hole.height;
  const near = (t) => t < holeBottom + gap && t + cardH > holeTop - gap;
  if (!near(center)) return { top: center, side: "center", shifted: false, overlaps: false };
  const fits = (t) => t >= gap - 1e-6 && t + cardH <= viewBottom - gap + 1e-6;
  const options = [holeTop - gap - cardH, holeBottom + gap].filter(fits);
  const nearer = (a, b) => (Math.abs(b - center) < Math.abs(a - center) ? b : a);
  if (options.length > 0) {
    const top = options.reduce(nearer);
    return { top, side: top < holeTop ? "above" : "below", shifted: true, overlaps: false };
  }
  const lo = gap;
  const hi = viewBottom - gap - cardH;
  if (!(hi >= lo)) return { top: center, side: "center", shifted: false, overlaps: true };
  const overlap = (t) => Math.max(0, Math.min(t + cardH, holeBottom) - Math.max(t, holeTop));
  const top = overlap(lo) < overlap(hi) ? lo : overlap(hi) < overlap(lo) ? hi : nearer(lo, hi);
  return { top, side: top + cardH / 2 < holeTop + hole.height / 2 ? "above" : "below", shifted: true, overlaps: overlap(top) > 0 };
}

// 【便BZ 2026-10-07 本人の実機の指摘(⑭ の音の傾向カードが下部タブ・広告の帯の裏に半分隠れていた)】的へ送るかの判定と送り方。
// 的が見える範囲(画面の上端 0 〜 bottomLimit = 下部タブ・広告の帯の上端)にまるごと収まっていれば null(送らない)。
// 収まっていなければ送る: 的が見える範囲より低ければ見える範囲の縦の中央へ(block "center" に、下部タブ・帯のぶん
// (vh − bottomLimit)の scroll-margin-bottom を付ける = 中央に並べる箱を下へ広げて、見える範囲の中央に来るようにする)、
// 見える範囲より高ければ上端をそろえる(block "start")。marginBottom は幾何の値(見える範囲の外の高さ)で、見た目の値ではない。
export function coachScrollPlan(r, vh, bottomLimit) {
  if (!r || !(r.height > 0)) return null;
  const limit = Math.min(bottomLimit, vh);
  if (r.top >= 0 && r.top + r.height <= limit) return null;
  return { block: r.height > limit ? "start" : "center", marginBottom: Math.max(0, vh - limit) };
}
// 送る(即座。behavior: "auto")。scroll-margin-bottom はこの呼び出しの間だけ付けて、すぐ元に戻す(的の見た目は変えない)。
function scrollTargetIntoView(el, plan) {
  const prev = el.style.scrollMarginBottom;
  el.style.scrollMarginBottom = `${plan.marginBottom}px`;
  try { el.scrollIntoView?.({ block: plan.block, behavior: "auto" }); } finally { el.style.scrollMarginBottom = prev; }
}

// 【便BZ】穴にかかる浮かせるボタン(FloatingAction。data-floating-action)の覆い。浮かせるボタン(z45)は案内(z55)より下だが、
// 穴の中は暗幕(穴の影)がかからないので、穴に入ったボタンは明るいまま的に重なっていた。穴にかかるボタンだけ、そのボタンの形の
// 覆い(暗幕と同じ色)を案内の層に置く(= 暗幕の下に入る。押すと外押し)。的そのもの(と的を含む・的に含まれる)ボタンは覆わない(押せる)。
// 【便BZ 審査 統括の裁定】
//   ・渡す穴は**1つ目の穴だけ**(呼び手が [hole] を渡す)。2つ目の穴(帯の箱)にかかるボタンは覆わない ── 覆いが帯の「見る」「開く」の上に乗って
//     押せなくしていた(iPad 744×1133 の2ペインで右ペインの「目安に設定」が目安の帯に重なる)。
//   ・覆いは**ボタンと穴が重なる所だけ**に切る(clip: ボタンの矩形を基準にした inset)。穴の外はもう暗幕(穴の影)がかかっているので、
//     ボタン全体に乗せると二重に濃くなっていた。
//   fabs  … [{ rect, radius, isTarget }](rect は getBoundingClientRect の形)
//   holes … 穴の矩形の並び(null は飛ばす)
export function floatingCovers(fabs, holes) {
  const hs = (holes ?? []).filter(Boolean);
  const hits = (a, h) => a.left < h.left + h.width && a.left + a.width > h.left && a.top < h.top + h.height && a.top + a.height > h.top;
  const r2c = (v) => Math.round(Math.max(0, v) * 100) / 100;
  return (fabs ?? [])
    .filter((f) => !f.isTarget && f.rect && f.rect.width > 0 && f.rect.height > 0 && hs.some((h) => hits(f.rect, h)))
    .map((f) => {
      const a = f.rect; const h = hs.find((x) => hits(a, x));
      const clip = `inset(${r2c(h.top - a.top)}px ${r2c(a.left + a.width - (h.left + h.width))}px ${r2c(a.top + a.height - (h.top + h.height))}px ${r2c(h.left - a.left)}px)`;
      return { left: a.left, top: a.top, width: a.width, height: a.height, radius: f.radius, clip };
    });
}

const r2 = (v) => Math.round(v * 100) / 100;
function sameView(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const same = a.id === b.id && a.leaving === b.leaving && a.measured === b.measured && a.side === b.side && r2(a.top) === r2(b.top);
  // 【便BS】穴の無い段は穴を比べない(両方 null なら同じ)
  if (!a.hole || !b.hole) return same && a.hole === b.hole;
  const sameBox = (p, q) => r2(p.left) === r2(q.left) && r2(p.top) === r2(q.top) && r2(p.width) === r2(q.width) && r2(p.height) === r2(q.height);
  // 【便BX】2つ目の穴(片方だけ在る・位置が違う)も比べる。無い段同士は今までどおり
  const sameExtra = !a.extra && !b.extra ? true : Boolean(a.extra && b.extra && sameBox(a.extra, b.extra) && a.split === b.split);
  // 【便BZ】浮かせるボタンの覆い(数・位置)も比べる。無い段同士は今までどおり
  const sameCovers = !a.covers && !b.covers ? true : Boolean(a.covers && b.covers && a.covers.length === b.covers.length
    && a.covers.every((c, i) => sameBox(c, b.covers[i]) && c.radius === b.covers[i].radius && c.clip === b.covers[i].clip));
  return same && sameBox(a.hole, b.hole) && sameExtra && sameCovers;
}

// 溶ける時間(ms)を計算済みの style から読む。"0.35s" / "350ms"(animation-duration)、無ければ
// animation の一括指定("coach-out 350ms ease-out forwards")の最初の時間。読めなければ 0(= 溶かさずに消す)。
export function leaveDurationMs(cs) {
  const src = String(cs?.animationDuration || cs?.animation || "");
  const m = /(\d*\.?\d+)(ms|s)\b/.exec(src);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  return m[2] === "ms" ? n : n * 1000;
}
const prefersReducedMotion = () => {
  try { return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches); } catch { return false; }
};

// アイコン(版4の SVG をそのまま)。計測=マイク / リード1=リード / リード2=計測(MeasureIcon と同じ針) /
// データ=データ / 参加前=コミュニティ / 参加後=的。
// 【便BS】チューナー=tuner(針のある半円)・メトロノーム=metro(線の太さ 1.6)を ficus-tutorial2.html の SVG のまま足した。
// コミュニティ(community)は参加の画面のカード(CommunityTab.jsx の JoinIntro)が CoachIcon で読む。
const SV = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" };
const ICONS = {
  tuner: <svg {...SV}><path d="M3 17 A9 9 0 0 1 21 17" /><line x1="12" y1="8" x2="12" y2="10" /><line x1="12" y1="17" x2="14.2" y2="11.4" /><circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" /></svg>,
  metro: <svg {...SV} strokeWidth={1.6}><path d="M8 20h8l-2-14h-4z" /><path d="M12 14l5-8" /></svg>,
  mic: <svg {...SV}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><line x1="12" y1="17.5" x2="12" y2="21" /></svg>,
  reeds: <svg {...SV}><g transform="translate(0.7 -1.9) rotate(35 12 13)" strokeWidth="1.8"><path d="M9.5 22 L9.5 10 Q9.5 4.5 12 4.5 Q14.5 4.5 14.5 10 L14.5 22 Z" /><path d="M9.5 15 Q12 11.8 14.5 15" /></g></svg>,
  measure: <svg {...SV}><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></svg>,
  data: <svg {...SV}><path d="M16 16L16 8" /><path d="M12 16L12 11" /><path d="M8 16L8 13" /><path d="M3 20.4V3.6C3 3.3 3.3 3 3.6 3H20.4C20.7 3 21 3.3 21 3.6V20.4C21 20.7 20.7 21 20.4 21H3.6C3.3 21 3 20.7 3 20.4Z" /></svg>,
  community: <svg {...SV}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20 Q3.5 14.5 9 14.5 Q14.5 14.5 14.5 20" /><circle cx="17" cy="9" r="2.4" /><path d="M15.5 13.6 Q20.5 13.6 20.5 18" /></svg>,
  target: <svg {...SV}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" /></svg>,
};

// 【便BS】カードの丸いアイコン(.coach-icon の中身)。参加の画面のカード(JoinIntro)も同じ絵を読む(写しを作らない)。
export function CoachIcon({ name }) {
  return <span className="coach-icon">{ICONS[name]}</span>;
}

const HOLE_RADIUS = { circle: "50%", pill: "var(--r-full)", rect: "var(--r-2)" };

// 的が見つからない間に探し直す間隔(ms)。この間は rAF を回さない(便BP3 統括の裁定 5)。
export const COACH_POLL_MS = 250;

// 見える範囲の下端 = 下部タブの上端 − 広告の帯の高さ(--ad-h の計算値)。下部タブが無ければ画面の下端から。
// 【便BS】参加の画面のカード(JoinIntro)も同じ見える範囲の中央に置くので export する(CommunityTab.jsx はこれを読む。読み方はここ1か所)。
// 【殻 S3 2026-10-06 統括の裁定】以前は見本の帯の要素([data-ad-preview-strip])の上端を見ていたが、殻の本物の帯は
// ネイティブのビューで DOM に無い。帯の高さの唯一の答え --ad-h(帯 + すき間 --sp-2。index.css / 殻は src/shell/ads.js が inline で置く)
// から引く形にして、Web の見本と殻で同じ値にする(見本の帯の上端 = 下部タブの上端 − --ad-h)。
export function readBottomLimit(vh) {
  let lim = vh;
  const nav = document.querySelector("[data-bottom-nav]");
  if (nav) {
    const r = nav.getBoundingClientRect();
    if (r.height > 0 && r.top < lim) lim = r.top;
  }
  return lim - resolveAdHeight();
}

// --ad-h の確定値(px)。カスタムプロパティは getPropertyValue では未解決の文字列("calc(50px + 8px)")のまま返るので、
// その高さを持つ要素を一瞬置いて測る(App.jsx の resolveBottomGap と同じ作法)。測れなければ 0。
export function resolveAdHeight() {
  if (typeof document === "undefined" || !document.body) return 0;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;height:var(--ad-h)";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h > 0 ? h : 0;
}

// 【便BX】2つの穴を縦に分ける線(画面の座標)。上の穴の下端と下の穴の上端の真ん中を整数に丸め、2つの穴の間に収める。
// 縦に重なっていれば null(2つ目の穴は出さない)。暗幕(穴の影)と受けは、この線より上を上の穴が、下を下の穴が受け持つ。
export function holesSplit(a, b) {
  const aBottom = a.top + a.height;
  const bBottom = b.top + b.height;
  const [upperBottom, lowerTop] = aBottom <= b.top ? [aBottom, b.top] : bBottom <= a.top ? [bBottom, a.top] : [null, null];
  if (upperBottom === null) return null;
  return Math.min(lowerTop, Math.max(upperBottom, Math.round((upperBottom + lowerTop) / 2)));
}
// 【便BX】穴が受け持つ縦の帯(線より上の穴は 0 〜 線、下の穴は 線 〜 画面の下端)。
export function bandOfHole(hole, split, vh) {
  return hole.top + hole.height <= split ? { top: 0, bottom: split } : { top: split, bottom: vh };
}
// 【便BX】穴の影(暗幕)を受け持ちの帯の中だけに切る clip-path。影は穴の要素の外へ 150vmax 広がるので、
// 切り取りの枠を穴の要素の縁から画面の縁・帯の縁まで外へ広げる(負の inset)。2つの穴の影が重なって二重に暗くならない。
export function holeClipPath(hole, band, vw) {
  const r = hole.left + hole.width;
  const b = hole.top + hole.height;
  return `inset(${band.top - hole.top}px ${r - vw}px ${b - band.bottom}px ${-hole.left}px)`;
}

// 穴の外側を覆う4枚の受け(上・下・左・右)。【便BQ】外を押したら案内を消す。穴の上には何も置かない(的は押せる)。
// 【便BX】band を渡すと、上下の受けをその帯の中に収める(2つ目の穴がある段。渡さなければ画面の上端 〜 下端で今までどおり)。
function hitRects(hole, vw, vh, band = null) {
  const top = hole.top;
  const bottom = hole.top + hole.height;
  const left = hole.left;
  const right = hole.left + hole.width;
  const top0 = band ? band.top : 0;
  const bottom0 = band ? band.bottom : vh;
  return [
    { key: "t", left: 0, top: top0, width: vw, height: Math.max(0, top - top0) },
    { key: "b", left: 0, top: bottom, width: vw, height: Math.max(0, bottom0 - bottom) },
    { key: "l", left: 0, top, width: Math.max(0, left), height: hole.height },
    { key: "r", left: right, top, width: Math.max(0, vw - right), height: hole.height },
  ];
}

// ------------------------------------------------------------------
// 暗幕・穴・カード。document.body へ出す(SwipePager の transform の中だと position: fixed が画面を基準にしない)。
//   candidates … いま出し得る一手(coachCandidates の結果)
//   done       … 済んだ印(normalizeOnboardingDone の結果)。出している一手の印が立ったら溶けて消える
//   hidden     … 出してはいけない(録音中・シートや z60 の暗幕が出ている・解析中・読み込み前)。立ったら溶かさずに即座に消す
//
// 【追従】出すもの(候補)が無く出しているものも無い間は何も走らせない / 候補はあるが的が見つからない間は rAF を回さず
// COACH_POLL_MS ごとに探す / 出している間は rAF で的の矩形を1回読む / 候補が変わった描画は useLayoutEffect で測り直す。
// 【読み上げ】空の role="status" を常に1つ置き、文だけを差し替える(同じ一手の間に読み直さない)。カードは aria-hidden。
// 【外を押したら消す】(便BQ)消した一手はこの部品が生きている間(= この起動の間)覚えておき、二度と出さない。印は立てない。
//   【便BS】dismissWith を持つ段は、その全部をこの起動の間は出さない(【便BW】計測タブの段・データタブの段)。
//   markOnDismiss の段(【便BW】reedLinked・trend・idealSeen)だけは、外を押したら onMark(印の名前)で印を立てる(押すことが一手そのもの)
// 【便BX】到着カード(穴なし・どこを押しても次へ)だけが暗幕を画面いっぱいに敷く(.coach-dim と受け1枚)。他の段は穴と受け4枚。
//   到着の受け・カードを押すと advance(印を立てる)。外押しではないので dismissedRef に入れない(群も消さない)。
//   scrollIntoView の段は、的が見える範囲に収まっていなければ(【便BZ】coachScrollPlan)、この起動で1回だけ送る(scrolledRef)。
// 【便BX】also を持つ段(【便BY】⑩ goData だけ。保存の帯が出ているとき)は穴が2つ。画面を2つの穴の間の線(holesSplit)で上下に分け、穴ごとに自分の帯の中だけ
//   影(暗幕)を落とし(clip-path)、受けも帯の中に4枚ずつ置く。穴の影が1つなので、穴を広げずに離れた2か所を照らせる。
// ------------------------------------------------------------------
export function OnboardingCoach({ candidates, done, hidden, onMark = null, onShown = null }) {
  const [view, setView] = useState(null);
  const [announcedId, setAnnouncedId] = useState(null);
  const viewRef = useRef(null);
  const layerRef = useRef(null);
  const cardRef = useRef(null);
  const candidatesRef = useRef(candidates);
  const doneRef = useRef(done);
  const hiddenRef = useRef(hidden);
  // 【便BQ】この起動の間に外を押して消した一手(タブを行き来しても出さない。次の起動では空から)。
  const dismissedRef = useRef(new Set());
  // 【便BW】的へスクロールした段(scrollIntoView の段。この起動で1回だけ。送り返されても引き戻さない)。
  const scrolledRef = useRef(new Set());
  const onMarkRef = useRef(onMark);
  onMarkRef.current = onMark;
  // 【便CG】カードが初めて見えたことの知らせ(App.jsx が「初めて案内が出た起動」の印を立てる)。この部品の間に1回だけ
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  const shownOnceRef = useRef(false);
  candidatesRef.current = candidates;
  doneRef.current = done;
  hiddenRef.current = hidden;
  const candKey = (candidates ?? []).join(",");

  const commit = (v) => {
    viewRef.current = v;
    setView(v);
    if (v && !v.leaving) setAnnouncedId((a) => (a === v.id ? a : v.id));
  };
  // 出している一手の印が立ったら溶かす(reduced-motion は即座に消す)。立っていなければ何もしない。
  const leaveIfDone = () => {
    const cur = viewRef.current;
    if (!cur || cur.leaving) return Boolean(cur?.leaving);
    if (!doneRef.current?.[COACH_STEPS[cur.id].flag]) return false;
    if (prefersReducedMotion()) commit(null);
    else commit({ ...cur, leaving: true });
    return true;
  };
  // 1回測る。戻り値は「出している(溶けている)か」── 出していれば次は rAF、出していなければ時計で探し直す。
  const measure = () => {
    if (hiddenRef.current) { if (viewRef.current) commit(null); return false; }
    if (leaveIfDone()) return true;
    const cur = viewRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let found = null;
    // 【便BZ】見える範囲の下端(下部タブ・広告の帯の上端)。測るのは1回の測り直しに1回だけ(要るときに読む)
    let limit0 = null;
    const bottomLimit = () => (limit0 === null ? (limit0 = readBottomLimit(vh)) : limit0);
    // 【便BW 審査】前の候補の的が DOM に在る間(見えていなくても)は、後の段のために画面を送らない(前の段を待っている)。
    let earlierInDom = false;
    for (const id of candidatesRef.current ?? []) {
      if (dismissedRef.current.has(id)) continue;
      const step = COACH_STEPS[id];
      if (!step) continue;
      // 【便BX】到着(穴なし)。的を探さず、この段を出す(候補は到着1つだけで返るので、前の段を待つことは無い)
      if (step.arrival) { found = { id, arrival: true }; break; }
      // (【便BW】的なし(target: null)の段の道はここにあった。段が無くなったので外した)
      const el = document.querySelector(step.target);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // 【便BW】音の傾向カード(My Data の最下段)は初期のスクロールでは画面の外。この起動で1回だけ的へ送る
      // (behavior: "auto" = 即座。なめらかに流さない)。次の測り直しで見えていれば出る。
      // 【便BZ】送るのは「画面の外」ではなく「見える範囲(上端 〜 下部タブ・広告の帯の上端)に収まっていない」とき(coachScrollPlan)。
      // 画面の中でも下部タブ・帯の裏に隠れていれば送る(実機で、的の下半分が帯と下部タブの裏のまま照らされていた)。
      if (step.scrollIntoView && !earlierInDom && r.height > 0 && !scrolledRef.current.has(id)) {
        const plan = coachScrollPlan(r, vh, bottomLimit());
        if (plan) {
          scrolledRef.current.add(id);
          scrollTargetIntoView(el, plan);
          earlierInDom = true;
          continue;
        }
      }
      if (!targetVisible(r, vw, vh)) {
        earlierInDom = true;
        continue;
      }
      // 【便BV3 2026-10-04】iPad の2ペインでは左右がそれぞれ自分でスクロールする(index.css の .pane-frame)。的がペインの中で
      // 送られて**ペインの縁に切られている**ときは、画面の中に居ても見えていないので出さない(穴が空いた所を照らさない)。
      // ペインの外(iPhone を含む今までの画面)には効かない。測るのは毎フレーム(下の rAF)なので、ペインを送ると穴も追う。
      const paneCell = el.closest(".pane-frame .pane-2 > *");
      if (paneCell) {
        const c = paneCell.getBoundingClientRect();
        // (大きさ 0 のペイン = まだ配置されていない・jsdom は測らない。そのときは今までどおり画面だけで決める)
        if (c.height > 0 && (r.top < c.top || r.bottom > c.bottom || r.left < c.left || r.right > c.right)) continue;
      }
      // 的の要素が形を名乗っていれば、その形で囲む(リード2の詳細の計測ボタン = 丸)。
      // 【便BW 再審査】passThrough を持つ段は、的の要素を含むその祖先(押せる日のボタン)の矩形も下へ通す(受けを置かない)
      const pt = step.passThrough ? el.closest(step.passThrough) : null;
      found = { id, el, r, shape: el.getAttribute("data-coach-shape"), pass: pt ? pt.getBoundingClientRect() : null };
      break;
    }
    if (!found) { if (cur) commit(null); return false; }
    if (found.arrival) {
      const sameStep0 = cur && cur.id === found.id;
      const cardH0 = sameStep0 ? (cardRef.current?.getBoundingClientRect().height || 0) : 0;
      const place0 = placeCoachCard({ hole: null, cardH: cardH0, vh, bottomLimit: bottomLimit() });
      const next0 = { id: found.id, arrival: true, hole: null, pass: null, extra: null, split: null, band: null, extraBand: null, covers: null,
        top: place0.top, side: "center", measured: cardH0 > 0, leaving: false, vw, vh };
      if (!sameView(cur, next0) || cur.vw !== vw || cur.vh !== vh) commit(next0);
      return true;
    }
    const step0 = COACH_STEPS[found.id];
    const hole = holeOf(found.r, found.shape ? { ...step0, shape: found.shape } : step0);
    const sameStep = cur && cur.id === found.id;
    const cardH = sameStep ? (cardRef.current?.getBoundingClientRect().height || 0) : 0;
    const place = placeCoachCard({ hole, cardH, vh, bottomLimit: bottomLimit() });
    // 受けを置かない範囲 = 穴の外接矩形(と passThrough の祖先の矩形を足した外接矩形)
    const pr = found.pass;
    const pass = pr ? {
      left: Math.min(hole.left, pr.left), top: Math.min(hole.top, pr.top),
      width: Math.max(hole.left + hole.width, pr.right) - Math.min(hole.left, pr.left),
      height: Math.max(hole.top + hole.height, pr.bottom) - Math.min(hole.top, pr.top),
    } : hole;
    // 【便BX】2つ目の穴(also)。画面にまるごと見えていて、1つ目と縦に重ならないときだけ。見えていなければ1つ目だけ(今までどおり)
    let extra = null; let split = null; let band = null; let extraBand = null;
    if (step0.also) {
      const xe = document.querySelector(step0.also.target);
      const xr = xe ? xe.getBoundingClientRect() : null;
      if (xr && targetVisible(xr, vw, vh)) {
        const xh = holeOf(xr, step0.also);
        const sp = holesSplit(pass, xh);
        if (sp !== null) { extra = xh; split = sp; band = bandOfHole(pass, sp, vh); extraBand = bandOfHole(xh, sp, vh); }
      }
    }
    // 【便BZ】穴にかかる浮かせるボタンの覆い(的そのもののボタンは覆わない)
    const fabs = [...document.querySelectorAll("[data-floating-action]")].map((b) => ({
      rect: b.getBoundingClientRect(), radius: getComputedStyle(b).borderRadius,
      isTarget: b === found.el || b.contains(found.el) || found.el.contains(b),
    }));
    const covers = floatingCovers(fabs, [hole]);   // 【便BZ 審査】1つ目の穴だけ(帯の箱の上には覆いを置かない)
    const next = { id: found.id, hole, pass, extra, split, band, extraBand, covers: covers.length ? covers : null, top: place.top, side: place.side, measured: cardH > 0, leaving: false, vw, vh };
    if (!sameView(cur, next) || cur.vw !== vw || cur.vh !== vh) commit(next);
    return true;
  };
  // 【便BQ】外(暗幕・カード)を押した: この1回は消すだけ(下の部品へ届かせない)。印は立てない。
  const dismiss = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = viewRef.current;
    if (!cur || cur.leaving) return;
    const step = COACH_STEPS[cur.id];
    // 【便BS】計測タブの段は一緒に消す(次の段がすぐ出て連打にならないように)。【便BW】データタブの段も同じ
    for (const id of step.dismissWith ?? [cur.id]) dismissedRef.current.add(id);
    dismissedRef.current.add(cur.id);
    setAnnouncedId(null);
    commit(null);
    // 【便BS】押すことが一手そのものの段(【便BW】reedLinked・trend・idealSeen)は、ここで印を立てる(二度と出さない)
    if (step.markOnDismiss) onMarkRef.current?.(step.flag);
  };
  // 【便BX】到着カード(穴なし): どこを押しても「次へ進む」= 印を立てる。外押しではないので dismissedRef には入れない(群も消さない)。
  const advance = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cur = viewRef.current;
    if (!cur || cur.leaving || !COACH_STEPS[cur.id]?.arrival) return;
    onMarkRef.current?.(COACH_STEPS[cur.id].flag);
  };

  // 印が立った描画・hidden が変わった描画・候補が変わった描画(タブの切替)の直後(rAF より先)に判定して測る。
  useLayoutEffect(() => {
    if (hidden) { if (viewRef.current) commit(null); return; }
    if (!leaveIfDone()) measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, hidden, candKey]);

  // 済んだ一手の文は読み上げから下ろす(次の一手が出れば、その文に差し替わる)。
  useEffect(() => {
    if (!announcedId || !done?.[COACH_STEPS[announcedId].flag]) return;
    if (view?.id === announcedId) return;   // 溶けている間はまだ下ろさない
    setAnnouncedId(null);
  }, [done, announcedId, view]);

  const active = (!hidden && (candidates?.length ?? 0) > 0) || view !== null;
  const shown = view !== null;
  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    let to = 0;
    let stopped = false;
    const step = () => {
      if (stopped) return;
      if (measure()) raf = requestAnimationFrame(step);
      else to = setTimeout(step, COACH_POLL_MS);
    };
    if (shown) raf = requestAnimationFrame(step);
    else to = setTimeout(step, COACH_POLL_MS);
    return () => { stopped = true; cancelAnimationFrame(raf); clearTimeout(to); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, shown, candKey]);

  // 溶けている間。時間は CSS(.coach-layer[data-leaving])だけが持つので、そこから読んで後始末の時計にする。
  const leaving = Boolean(view?.leaving);
  useEffect(() => {
    if (!leaving) return undefined;
    const el = layerRef.current;
    const ms = el ? leaveDurationMs(getComputedStyle(el)) : 0;
    if (!(ms > 0)) { commit(null); return undefined; }
    const t = setTimeout(() => { if (viewRef.current?.leaving) commit(null); }, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const said = announcedId ? COACH_STEPS[announcedId] : null;
  const step = view ? COACH_STEPS[view.id] : null;
  // 【便CG】「出た」は測り終えて見えているカード(view.measured)だけ。測る前の隠れたカード(タブを移った直後に一瞬だけ候補になった段)は数えない
  const visibleNow = Boolean(view?.measured && !view.leaving);
  useEffect(() => {
    if (!visibleNow || shownOnceRef.current) return;
    shownOnceRef.current = true;
    onShownRef.current?.();
  }, [visibleNow]);
  return createPortal(
    <>
      {/* 読み上げの入れ物は常に1つ(空のときも在る)。文だけを差し替える。 */}
      <div className="coach-live" role="status" data-coach-live="">{said ? coachSpeech(said) : ""}</div>
      {view ? (
        <div
          ref={layerRef}
          className="coach-layer"
          data-coach-layer={view.id}
          data-leaving={view.leaving ? "true" : "false"}
          style={{ zIndex: COACH_Z }}
          onAnimationEnd={(e) => { if (e.target === e.currentTarget && viewRef.current?.leaving) commit(null); }}
        >
          {view.arrival ? (
            <>
              {/* 【便BX】到着カード: 穴なし。暗幕を画面いっぱいに敷き(.coach-dim。参加の画面と同じ規則)、受け1枚で「どこを押しても次へ」 */}
              <div className="coach-dim" aria-hidden="true" />
              <div className="coach-hit" aria-hidden="true" data-coach-hit="all" style={{ left: 0, top: 0, width: view.vw, height: view.vh }} onClick={advance} />
            </>
          ) : (<>
          {/* 【便BW】穴を持つ段(到着カード以外)。ここから下の穴・受けの描き方は便BX の前と同じ。 */}
          <div
            className="coach-hole"
            aria-hidden="true"
            style={{
              left: view.hole.left, top: view.hole.top, width: view.hole.width, height: view.hole.height,
              borderRadius: HOLE_RADIUS[view.hole.shape],
              // 【便BX】2つ目の穴がある段だけ、影を受け持ちの帯の中に切る(無い段は clip-path を持たない = 今までどおり)
              clipPath: view.extra ? holeClipPath(view.hole, view.band, view.vw) : undefined,
            }}
          />
          {/* 【便BX】2つ目の穴(【便BY】⑩ の保存の帯の箱)。見た目は1つ目と同じ .coach-hole(新しい CSS は無い)。影は自分の帯の中だけ。 */}
          {view.extra ? (
            <div
              className="coach-hole"
              aria-hidden="true"
              data-coach-hole="also"
              style={{
                left: view.extra.left, top: view.extra.top, width: view.extra.width, height: view.extra.height,
                borderRadius: HOLE_RADIUS[view.extra.shape],
                clipPath: holeClipPath(view.extra, view.extraBand, view.vw),
              }}
            />
          ) : null}
          {/* 【便BQ】穴の外側の受け(透明)。押したら案内を消すだけ(下へ届かせない)。穴の上には置かない。 */}
          {hitRects(view.pass ?? view.hole, view.vw, view.vh, view.band).map((h) => (
            <div key={h.key} className="coach-hit" aria-hidden="true" data-coach-hit={h.key}
              style={{ left: h.left, top: h.top, width: h.width, height: h.height }}
              onClick={dismiss} />
          ))}
          {/* 【便BX】2つ目の穴の外側の受け(その帯の中の4枚)。2つ目の穴の上にも何も置かない(帯の「開く」は押せる)。 */}
          {view.extra ? hitRects(view.extra, view.vw, view.vh, view.extraBand).map((h) => (
            <div key={`x${h.key}`} className="coach-hit" aria-hidden="true" data-coach-hit={`x${h.key}`}
              style={{ left: h.left, top: h.top, width: h.width, height: h.height }}
              onClick={dismiss} />
          )) : null}
          {/* 【便BZ】穴にかかる浮かせるボタンの覆い(暗幕と同じ色・ボタンの形)。押したら外押し(受けと同じ dismiss)。 */}
          {(view.covers ?? []).map((c, i) => (
            <div key={`c${i}`} className="coach-cover" aria-hidden="true" data-coach-cover=""
              style={{ left: c.left, top: c.top, width: c.width, height: c.height, borderRadius: c.radius, clipPath: c.clip }}
              onClick={dismiss} />
          ))}
          </>)}
          {/* カードは画面の中央。押しても案内が消えるだけ(外を押したのと同じ)。測る前は見せない。
              【便BX】到着カードは押すと「次へ」(advance)。【便CG】枚数の目印は外した(先頭の子はアイコン)。 */}
          <div
            ref={cardRef}
            className="coach-card sans"
            aria-hidden="true"
            data-coach-side={view.side}
            style={{ top: view.top, visibility: view.measured ? "visible" : "hidden" }}
            onClick={view.arrival ? advance : dismiss}
          >
            <CoachIcon name={step.icon} />
            <div className="coach-title">{step.title}</div>
            {step.line ? <div className="coach-line">{step.line}</div> : null}
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
