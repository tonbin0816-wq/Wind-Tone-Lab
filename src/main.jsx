import React from 'react'
import ReactDOM from 'react-dom/client'
import { warmPersistedStateCache } from './App.jsx'
// 【便CB 2026-10-08 本人の依頼】アプリの根は同意の門(AppRoot)。初めて開いたときは計測タブより前に同意の画面を出し、
// 同意が済むまでアプリ(App.jsx の WindToneLabPhaseMode)を描かない(マイク・ATT・広告・はじめの案内は同意のあとにしか始まらない)。
import AppRoot from './ConsentScreen.jsx'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import './index.css'
import { applyIOSViewport } from './iosViewport.js'
import { applyAdPreview } from './adPreview.js'
import { applyTutorialPreview } from './tutorialPreview.js'

// 【便BB 2026-09-25 統括の裁定】iOS のときだけ viewport に maximum-scale=1 を足す
// (入力欄に触れたときの自動拡大を止める。指2本の拡大は iOS では残る)。理由と判定は iosViewport.js。
// 描く前に1回だけ。index.html の既定の viewport は変えない(iOS 以外はそのまま)。
applyIOSViewport()

// 【便BL 2026-10-02 本人指示】見本の広告の帯の合図(?adpreview=1 / 0)を読み、<html> に印を付ける。
// **最初の描画の前に**付ける ── 後から付けると、帯の高さ(--ad-h)ぶんページ下端が1フレーム跳ねる。
applyAdPreview()

// 【便BP3 2026-10-03 本人の依頼】はじめの一手の見本の合図(?tutorialpreview=1 / 0)。読み方は見本の広告の帯と同じ。
// 最初の描画の前に <html> に印を付ける(App.jsx が1回だけ読む)。
applyTutorialPreview()

// 【AD-3 2026-09-21 本人指示】「アプリ起動時に計測タブのリードが一瞬未選択の時の仕様になる」。
// **最初の描画の前に**保存された値を読み込み、App.jsx の persistedStateCache を温める。
// usePersistedState はそのキャッシュを見て初期値を決めるので、温めてから描けば
// どのキーも1フレーム目から保存値で始まる ──「リードを選択」(未選択の姿)も、
// 既定の楽器・基準ピッチも一瞬たりとも出ない。
//
// **温めはいちばん先に始める。** createRoot より前に呼ぶので、React の用意と
// IndexedDB の読みが重なる(読みは非同期なので、待っているあいだ主スレッドは空く)。
//
// 【待っているあいだ何も描かないのはなぜか ── 実測で決めた】
// 本番ビルドの A/B(375×812・各5回・同じ端末。origin ごとに同じ保存値を入れて比べた):
//   ・変更前(温めない)           … 正しい姿が出るまで 30.6 / 37.3 / 41.2 / 41.5 / 42.0ms。
//                                  その手前で「リードを選択」が 4.1〜11.0ms 見えていた
//   ・輪(LoadingRing)を1枚挟む   … 59.0 / 64.0 / 75.6 / 86.3 / 101.6ms(**約 39ms 遅い**)
//   ・何も描かない(この形)        … 29.4 / 33.2 / 37.5 / 40.1 / 52.4ms(**変更前と同じ**)
// 輪を1枚描くと、React の根がもう一度 render を通り、それだけで起動1回ぶんに匹敵する
// 時間がかかる。**温めそのものは 0.9〜11.2ms**(実測)なので、その数msのために
// 39ms 払うことになる ── 本人の条件「起動が目に見えて遅くならないこと」に反する。
// ここで出さない「何も無い状態」は、JS が評価され終わるまでの間に既に出ているものと
// 同じ(新しい待ち画面は作っていない)。
//
// **読めても読めなくても必ずアプリを描く**(finally)。温めは速く正しく出すためのもので、
// 出す・出さないを決めるものではない(warmPersistedStateCache 自身も例外を飲んで戻る)。
const warming = warmPersistedStateCache()
const root = ReactDOM.createRoot(document.getElementById('root'))
warming.finally(() => {
  root.render(
    <React.StrictMode>
      <AppRoot />
    </React.StrictMode>,
  )
})
