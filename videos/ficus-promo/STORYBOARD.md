---
format: 1080x1920
duration: 40s
message: "自分の癖を、なんとなくで終わらせない"
arc: 癖 → 数字になる → いつもの道具が貯める → 貯まったものが見える → 揃えて比べる → 参加
audience: 個人で練習しているサックス奏者
mode: collaborative
music: none
---

## Frame 1 — なんとなく

- scene: 音名がひとつずつ並び、3つだけが輪郭のぼやけた状態で残る
- duration: 5s
- transition_in: cut
- status: built
- src: compositions/frames/01-vague.html
- asset_candidates: none-rebuilt-in-html

**役割: hook。** 奏者の言葉で痛みを名指す。「あの辺が苦手」で止まっている状態そのものを画にする。
機能の話も製品名もまだ出さない。出るのは音名と、はっきりしない3つの音だけ。

画面の言葉:「なんとなく、ここが苦手」／小さく「で、止まっている。」

**なぜこの絵か:** 音名は Ficus が実際に画面へ出す唯一の固有語彙で、他のアプリの動画には
そのまま置けない（story-spine §4）。ぼやけは装飾ではなく「測っていない」ことの図。

## Frame 2 — 数字になる

- scene: ぼやけていた3音に平均差分の数字が入り、輪郭が締まる
- duration: 6s
- transition_in: cut
- status: built
- src: compositions/frames/02-numbers.html
- asset_candidates: none-rebuilt-in-html
- handoff_out: 音名の行 — x: 中央, y: 画面の 46%, scale: 1.0, opacity: 1, 動き: 静止

**役割: value。** 本人の言葉「自分の癖を数字で把握し調整」。ここで動画の主張が出そろう。
Frame 1 と**同じ位置の同じ音名**が、ぼやけたまま数字を得る。画面が切り替わるのではなく、
同じものの解像度が上がる。

画面の言葉:「その癖は、数字で出る。」／音の下に −7.3¢ / +4.1¢ / −11.0¢

**なぜこの絵か:** 「分かる」を言葉で言わず、同じ絵の状態変化で見せる
（アプリ側の原則「説明を消して形に語らせる」と同じ構え）。

## Frame 3 — いつもの道具

- scene: チューナーの環とメトロノームが動き、録音ボタンが押されてセッションが1つ落ちる
- duration: 6s
- transition_in: crossfade
- status: built
- src: compositions/frames/03-tools.html
- asset_candidates: none-rebuilt-in-html
- handoff_in: 音名の行 — x: 中央, y: 画面の 46%, scale: 1.0, opacity: 1 → 0（0.4s で退く）

**役割: mechanism。** 本人の言葉「いつもの練習の友のチューナーとメトロノームがあなたのデータを蓄積」。
**新しい習慣を足せ、とは言わない。**すでに使っている道具がそのまま計測器になる、が要点。

画面の言葉:「チューナーとメトロノームは、いつも出している。」／「そのまま、記録になる。」

**なぜこの絵か:** 導入の障壁が「また続かないのでは」だから、それを先に潰す。

## Frame 4 — 貯まる

- scene: カレンダーの日が順に埋まり、累計の数字が回って止まる
- duration: 5s
- transition_in: cut
- status: built
- src: compositions/frames/04-accumulate.html
- asset_candidates: none-rebuilt-in-html

**役割: proof（蓄積）。** 吹いた日がそのままデータになる。数字は count-up で、止まった値が読める。

画面の言葉:「吹いた日が、そのまま貯まる。」

**なぜこの絵か:** 「蓄積」を言葉ではなく時間の経過で見せる。動画にしかできない見せ方。

## Frame 5 — 揃えて比べる

- scene: 自分の線と他人の線が上下に離れて描かれ、共通する音で高さが揃い、形の差だけが残る
- duration: 7s
- transition_in: crossfade
- status: built
- src: compositions/frames/05-align.html
- asset_candidates: none-rebuilt-in-html
- handoff_out: 揃った2本の折れ線 — x: 中央, y: 画面の 52%, scale: 1.0, opacity: 1, 動き: 静止

**役割: 差別化の証拠。** このアプリだけの仕組み。マイクの距離も部屋の響きも人によって違うので、
絶対値をそのまま比べても全音で「足りない」と出る。共通する音の中央値を合わせてから重ねると、
残るのは音ごとの形の差＝本物の差だけになる。

画面の言葉:「環境のちがいを消して、形で比べる。」

**なぜこの絵か:** 動画の中で唯一「他ではできない」と言い切れる場面。文章で説明すると長いが、
**線が上下に動いて揃う1つの動き**で終わる。

## Frame 6 — 順位とシェア

- scene: 練習日数の順位が3行立ち上がり、続いて楽器の組の円グラフが描かれる
- duration: 6s
- transition_in: cut
- status: built
- src: compositions/frames/06-rank-share.html
- asset_candidates: none-rebuilt-in-html
- handoff_in: 揃った2本の折れ線 — x: 中央, y: 画面の 52%, scale: 1.0 → 0.85, opacity: 1 → 0（0.3s）

**役割: 広がり。** コミュニティで見えるものは音のデータだけではない。練習日数の順位と、
みんなが何を吹いているか（楽器・マウスピース・リガチャー・リード）。

画面の言葉:「続けた日数も、使っているものも。」

**なぜこの絵か:** 本人の依頼「4つの画面を順に見せる」に対する残り2画面。1フレームに畳んで、
主題（比べる）を薄めない。

## Frame 7 — 締め

- scene: アプリ名が置かれ、下に一行だけ残る
- duration: 5s
- transition_in: crossfade
- status: built
- src: compositions/frames/07-close.html
- asset_candidates: none-rebuilt-in-html

**役割: CTA。** 名前と、どこで手に入るか。飾らない。

画面の言葉: Ficus ／「サックス練習支援アプリ」／ wind-tone-lab.vercel.app

**なぜこの絵か:** ここまでで主張は済んでいる。最後の5秒は名前を覚えてもらうためだけに使う。
