import React, { useEffect, useMemo, useState } from "react";
import { getSignedInUid, ensureSignedIn, saveProfile, loadProfile, setProfilePublic, setProfileAvatar, deleteAccount } from "./accountRepo.js";
import { FirebaseConfigMissingError } from "./firebaseClient.js";
import { buildProfileDoc, validateNickname, REED_STRENGTHS, POSITIONS, GENRES, ENSEMBLES, SAX_TYPES, SAX_LABELS, startYearOptions, AVATAR_ICONS, AVATAR_COLOR_MIN, AVATAR_COLOR_MAX } from "./profile.js";
import { AvatarSprite, Avatar, RowChevron, PickChevron } from "./icons.jsx";
// 【M3 2026-09-19 本人指示】アイコンが編集の導線であることを示す鉛筆の印。
// 本人「添付はカメラのアイコンだが鉛筆マークにして」。lucide はこの階層でも
// 既に使っている(LegalSheet の ×)ので、置き場所を増やさない。
import { Pencil } from "lucide-react";
import { RankScreen, ShareScreen, DataScreen, PersonSheet, usePublicUsers } from "./screens.jsx";
// 【計画5 モデレーション 2026-09-10】自分が通報で隠れているかを見る。
import { isFlagged } from "./reportRepo.js";
// 【束3 2026-09-19 本人指示】レビューの飛び先。**null の間は行ごと出さない**
// (理由は support.js)。お問い合わせのアドレス(SUPPORT_EMAIL)はもう画面に出さないので
// ここでは読まない ── 連絡はアプリの中のフォーム(FeedbackSheet)が受ける。
import { APP_STORE_REVIEW_URL } from "../support.js";
import { listIdeals, buildMyIdeals, publishMyIdeals, unpublishAllIdeals } from "./idealRepo.js";
// 【BottomSheet 2026/09/09 本人裁定】シートの器はアプリで1つ。下スワイプの配線
// (useSheetDismiss)も Escape も器の中にあるので、ここは器を呼ぶだけでよくなった。
import { buildIdealProfileFromSessions, SubTabs, SwipePager, OptionPills, BottomSheet } from "../App.jsx";
// 【アカウント引継の中身は My Data の「記録の保存」そのもの】写しを作らない。
// 書き出し・読み戻しの規則は backup/ 側だけが持ち、こちらは置き場所を1つ増やすだけ。
import BackupPanel from "../backup/BackupPanel.jsx";
import { publishStats, withMyRow } from "./directory.js";
import { computePracticeStats } from "./stats.js";
import { searchInstrumentModels, searchMouthpieces, searchLigatures, searchReeds, OTHER_BRAND } from "./catalog/gear.js";
// 【読み込み中の絵 2026/09/10 → 09/13 本人指示】App.jsx の Suspense と同じ要素。
// 待ちは chunk → アカウント確認 → 名簿 と続くが、要素が入れ替わっても
// 数字が巻き戻らないよう、進捗の帳簿は React の外(loadProgress.js)にある。
import LoadingRing from "./LoadingRing.jsx";
// 【C11・C12 2026-09-16】規約・ポリシーはアプリの中で読む(外へ出ない)。
import LegalSheet from "./LegalSheet.jsx";
// 【束3 2026-09-19 本人指示】お問い合わせもアプリの中で完結する(メールへ飛ばさない)。
import FeedbackSheet from "./FeedbackSheet.jsx";

// ------------------------------------------------------------------
// コミュニティタブ。画面は3状態: 未参加 → 登録フォーム → プロフィール表示。
//
// 【判断の中身はここに書かない】入力の妥当性は profile.js の buildProfileDoc、
// カタログの照合は catalog/gear.js だけが決める(どちらも単体テスト済み)。
// このファイルは「並べる・押す・返ってきたエラー文言を出す」だけを持つ。
// ここに if を足したくなったら、それは profile.js に置くべき規則である合図。
//
// 【見た目】新しい値を発明しない(design/DESIGN-SYSTEM.md)。色・角丸・余白・
// 文字サイズはすべて index.css のトークン(var(--c-*) / --r-* / --sp-* / --fs-*)から引く。
// 操作するものの型(§6.7)も守る:
//   ・普通のボタン・入力欄 = B型(枠なし。地は --c-sunken か、主要動作なら --c-accent の塗り)
//   ・選択中/非選択が切り替わるピル = A型(枠 --c-line-strong。選択中は枠を透明にして地だけで塗る)
// 面の作法(.card / .tile)は使わない。あれはタブの根に付いた .surf-* が決めるもので、
// このタブの根がどちらになるかは App.jsx 側(Task 9)の話だから。
// ------------------------------------------------------------------

// SAX_LABELS は profile.js が持つ(楽器の照合エラーが「どの楽器の話か」を言うために
// あちら側でも要る)。写しを2つ置かない。

// 通信系の失敗はどれも利用者にできることが同じ(電波の良いところでやり直す)なので、
// 文言も1つにまとめる。原因の切り分け(権限/オフライン/期限切れ)を見せても操作は変わらない。
const NET_ERROR = "通信に失敗しました。電波の良いところでもう一度お試しください";
// 【設定の欠落は通信の失敗と分ける】接続設定が読み込めていない状態は待っても直らない。
// 「電波の良いところで」と案内すると、利用者を無駄に待たせたうえ原因も伝わらない。
// この配信をビルドした環境に VITE_FIREBASE_* が無いことが原因なので、
// 利用者の操作では解決できない。そう分かる文言にする。
const CONFIG_ERROR = "この配信ではコミュニティを利用できません(アプリの接続設定が読み込めていません)";
// 失敗の種類で文言を選ぶ。ここ以外で NET_ERROR を直に使わない。
const connectErrorOf = (e) => (e instanceof FirebaseConfigMissingError ? CONFIG_ERROR : NET_ERROR);
const SAVE_ERROR = "保存に失敗しました。電波の良いところでもう一度お試しください";
const TOGGLE_ERROR = "公開設定を変更できませんでした。電波の良いところでもう一度お試しください";
// 【サーバーに拒まれたのは通信の失敗ではない】2026/09/06。
// Firestore の permission-denied を「電波の良いところで」と案内すると、
// 電波は良いのに何度やっても同じ所で失敗する行き止まりになる(実際に起きた)。
// これが出るのは**公開されているセキュリティルールと、アプリが書こうとする形が
// 食い違っているとき**で、利用者の操作では直せない。原因が伝わる文言にし、
// 直せる人(開発者)が見て分かるように理由もそのまま出す。
const RULE_ERROR = "サーバーに保存を拒まれました。アプリの更新をお待ちください(電波の問題ではありません)";
const isPermissionDenied = (e) =>
  e?.code === "permission-denied" || /permission[- ]denied|insufficient permissions/i.test(String(e?.message ?? ""));
const saveErrorOf = (e) => (isPermissionDenied(e) ? RULE_ERROR : SAVE_ERROR);
const toggleErrorOf = (e) => (isPermissionDenied(e) ? RULE_ERROR : TOGGLE_ERROR);
// 【削除の文言は「実際に起きたこと」に合わせる】
// 【「まだ何も消えていません」とは言えない 2026/09/06】deleteAccount は目安を4件消して
// からプロフィールを消すようになった(そうしないと画面の「完全に消えます」が嘘になる)ので、
// 途中で失敗すると**一部だけ消えている**ことがある。言えるのは「押し直せば続きから
// 完了できる」ことだけ ── 存在しないドキュメントの削除は何もしないので、何度押しても壊れない。
// (deleteUser の失敗は accountRepo 側でサインアウトに落とし込んでいる。匿名ユーザーは
//  再認証できないので、押し直しを促すと永久に失敗し続ける行き止まりになるため。)
// 【M3 2026-09-19 本人指示】アイコンが編集の導線であることを示す印の直径。
// 64 の円に対して 3/8 = 24(本人の添付画像と同じ割合)。絵柄は鉛筆。
const AVATAR_EDIT_BADGE_PX = 24;
// アイコンの変更に失敗したときの文言。公開設定の失敗と同じ言い方に揃える。
const AVATAR_ERROR = "アイコンを変更できませんでした。電波の良いところでもう一度お試しください。";
const DELETE_ERROR = "削除を最後まで終えられませんでした。電波の良いところでもう一度「アカウントを削除」を押してください。途中まで消えていても、押し直せば続きから完了できます";
// deleteUser だけが失敗した場合(auth/requires-recent-login など)。データは消えている。
// 「消えていない」と誤解させないよう、消えたものと残ったものを分けて言う。
const DELETE_PARTIAL_NOTICE =
  "サーバー上のプロフィールは削除しました。この端末に残っていた匿名のログイン情報だけは取り消せなかったため、サインアウトしました。あなたのデータはもう残っていません。";

// 【スプライトはここに1つだけ置く】<use href="#ic-..."> は同じ文書の中にある
// <symbol> を参照する。アイコンを出す画面ごとに置くと、同じ id が複数現れたときに
// どれが引かれるかが不定になる。中身を別の関数に分け、外側で1回だけ描く。
// 【D3 2026-09-16 実機の指摘】landTab / onLanded = App から「開く子タブ」を渡す口
// (My Data の「他の人と比べてみる」→ "rank")。受け取ったら onLanded で App 側を null に
// 戻す(同じ値を2回押しても2回効くように)。普段は null で、何も変わらない。
export default function CommunityTab({ sessions, tuningHz, onAdoptIdeal, landTab = null, onLanded = null }) {
  return (
    <>
      <AvatarSprite />
      <CommunityTabBody sessions={sessions} tuningHz={tuningHz} onAdoptIdeal={onAdoptIdeal} landTab={landTab} onLanded={onLanded} />
    </>
  );
}

// 子タブ。マイページは「自分のこと」、他の3つは「他人のこと」。
const SUB_TABS = [
  { key: "data", label: "データ" },
  { key: "rank", label: "順位" },
  { key: "share", label: "シェア" },
  { key: "me", label: "マイページ" },
];

// 参加済みの人に見せる画面。子タブで4つを切り替える。
function JoinedView({ profile, uid, sessions, tuningHz, onAdoptIdeal, onEdit, onTogglePublic, onChangeAvatar, onDelete, initialTab = "data" }) {
  // 【初期値としてしか読まない】この画面は編集フォームとの行き来で作り直されるので、
  // 「どのタブで開くか」は作り直しのたびに親が渡す。以後の切り替えはここが持つ。
  const [tab, setTab] = useState(initialTab);
  // タップされた人。**子タブとは別に持つ** ── 開いたまま子タブを切り替えられると、
  // 下の画面が変わったのに上に別人の紹介が乗っている、という状態になる。
  const [person, setPerson] = useState(null);
  // アカウント引継のシート。**人物紹介と同じ理由で SwipePager の外に置く**ので、
  // 開いているかどうかもここが持つ(ProfileView からは開く合図だけ受ける)。
  const [backup, setBackup] = useState(false);
  // 【公開ユーザーは1度だけ読む】タブを切り替えるたびに読み直さない。
  // 読み取り回数は費用そのもので、利用者数の2乗で増える(設計書の決定1-b)。
  // 【計画5 2026-09-10】myUid を渡す ── 通報された人を落とすときに
  // **自分だけは残す**ため(黙って消さない。理由はマイページの告知で伝える)。
  const dir = usePublicUsers(uid);
  // 【便Z 2026-09-21】自分の練習記録は**この端末が数える**。サーバの写しを待たない。
  // 便Q(保存が消していた)・便S(読みと書きの順)・便W(差分が古いキーを残す)と
  // 原因を1つずつ潰しても本人の端末で再発したのは、**自分が順位に出るかどうかを
  // サーバに委ねていた**から。委ねるのをやめる。
  const myStats = useMemo(() => computePracticeStats(sessions ?? []), [sessions]);
  // 名簿に自分の行を必ず置く(規則は directory.js の withMyRow に1つだけ)。
  const users = useMemo(() => withMyRow(dir.users, uid, profile, myStats),
    [dir.users, uid, profile, myStats]);

  // 自分が通報で隠れているか。**一覧の結果からは判定しない** ── 一覧は上限50で
  // 切れるので、切れた先に自分が居ると本人にだけ何も知らせないまま隠れてしまう。
  // 1 read 増やして確実に見る(reportRepo.isFlagged のコメントも参照)。
  const [flaggedMe, setFlaggedMe] = useState(false);
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    (async () => {
      try {
        const v = await isFlagged(uid);
        if (alive) setFlaggedMe(v);
      } catch (e) {
        // 【便Q 2026-09-20】読めなければ告知を出さないだけで、順位や一覧は今までどおり出る。
        // ただし**黙って捨てない** ── 拒まれたのか通信が切れたのかは別の話。
        console.error("[community] 通報の確認に失敗", e?.code, e);
      }
    })();
    return () => { alive = false; };
  }, [uid]);

  // 【自分の目安を種別ごとに作る】公開するものと、データ画面で自分の線として
  // 描くものは**同じ値**にする。別々に作ると、公開した値と画面の値が食い違う。
  // 平均の作り方は計測タブと同じ関数(buildIdealProfileFromSessions)を使う。
  const myIdeals = useMemo(() => buildMyIdeals({
    sessions, saxTypes: profile?.saxTypes ?? [], tuningHz, buildProfile: buildIdealProfileFromSessions,
  }), [sessions, profile?.saxTypes, tuningHz]);
  // 目安も1度だけ読む。データタブを開くまで読まないのではなく、
  // 公開ユーザーと同じ1回で済ませる(タブを行き来しても読み直さない)。
  const [ideals, setIdeals] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await listIdeals();
        if (alive) setIdeals(list);
      } catch (e) {
        if (alive) setIdeals([]); // 読めなくても順位とシェアは見せる
      }
    })();
    return () => { alive = false; };
  }, []);

  // 【練習日数はタブを開いたときに1度だけ書く】練習のたびには書かない。
  // 書き込み回数が無駄に増えるだけで、順位は開いて見るものなので即時性が要らない。
  //
  // **失敗しても黙って諦める。** これは本人の操作ではなく副次的な更新なので、
  // 順位が1日古いだけの話に対してエラーを出しても、利用者にできることが無い。
  // (プロフィールの保存は本人の操作なので、あちらは必ず文言を出す。)
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    (async () => {
      try {
        // 【便Z 2026-09-21】ここは**他人に見せるため**の書き込みだけ。
        // 自分の順位は withMyRow が手元の値で必ず置くので、
        // この書き込みが拒まれても・遅れても、自分が消えることは無い。
        if (alive) await publishStats(uid, myStats);
      } catch (e) {
        // 【便Q 2026-09-20】**利用者に見せないことと、記録に残さないことは別**。
        // ここが空だったせいで、ルールに拒まれて順位が更新されない状態が
        // 画面にもコンソールにも一切出ず、原因の切り分けに1周かかった。
        // 文言は出さないまま(本人の操作ではないので直せることが無い)、綴りだけ残す。
        // プロフィールの保存(下の onSubmit)は既にこの形になっている。
        console.error("[community] 練習記録の公開に失敗", e?.code, e);
      }
      // 【目安も同じ機会に公開する】目安は「選んで出すもの」ではなく、
      // 登録した楽器種別ごとの自分の平均が1つあるだけ(2026-09-03 本人裁定)。
      // したがって公開ボタンは無く、練習日数と同じくタブを開いたときに更新する。
      // 【非公開の人の目安は出し直さない】ここに公開状態の判定が無いと、
      // 公開スイッチを OFF にした人がタブを開くたびに目安が復活する。
      try {
        if (alive && profile?.isPublic !== false && Array.isArray(profile?.saxTypes)) {
          await publishMyIdeals(uid, myIdeals);
        }
      } catch (e) {
        // 【便Q 2026-09-20】上と同じ理由で綴りを残す。文言は出さない。
        console.error("[community] 目安の公開に失敗", e?.code, e);
      }
    })();
    return () => { alive = false; };
    // sessions を依存に入れない ── 録音のたびに書き直すことになる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // 【便Z 2026-09-21】便S の「書いた直後に手元の名簿を継ぎ当てる」は**消した**。
  // 継ぎ当ては「サーバの写しが正で、届くまでの繋ぎ」という形だったが、
  // 自分の順位についてはそもそも写しが正ではない。withMyRow が毎回置くので、
  // 繋ぎは要らなくなった(死んだ経路を残さない)。
  // 【4ページを同時に持つので、読み込み中の告知はページごとに出す】
  // 横スワイプは4枚を並べて動かす作法なので、body() の早期 return
  // (「読み込み中なら1枚だけ返す」)は使えない。
  const dirGate = dir.phase === "loading" ? <LoadingRing step="list" />
    : dir.phase === "error" ? <Centered>{dir.error}</Centered> : null;

  // 【公開スイッチはその場で反映する】サーバへは書くが**読み直さない**
  // (読み取り回数は費用そのもの)。自分の行だけ手元の配列で差し引く。
  // ここに置いてあるのは、差し引く相手(dir.users / ideals / myIdeals)を
  // 持っているのがこの階層だけだから。users への書き込みは親(onTogglePublic)。
  //
  // 【順序】非公開にするときは**先に目安を消してから** users を書く。逆にすると、
  // 目安の削除に失敗したときに「非公開なのに音のデータがサーバに残る」状態になり、
  // しかも画面は「変更できませんでした」と言う(利用者には直しようがない)。この順なら、
  // 最初の一手で失敗した時点では**まだ何も変わっていない**ので、その文言が正しい。
  // 2手目が失敗しても残るのは「公開のままだが目安が無い」だけで、次にタブを開いた
  // ときの effect が出し直す。
  // 【M2 2026-09-19】アイコンを変えたら、**手元の名簿の自分の行も直す**。
  // 順位・データの一覧は dir.users の絵柄で人を描くので、直さないと
  // 次に読み直すまで自分だけ古い絵柄のまま並ぶ(公開設定と同じ考え)。
  const changeAvatar = async (v) => {
    await onChangeAvatar(v);   // users の icon / iconColor を書き、profile を更新する
    dir.setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, ...v } : u)));
  };

  const togglePublic = async (v) => {
    if (!v) await unpublishAllIdeals(uid); // 非公開にしたら音のデータをサーバに残さない
    await onTogglePublic(v);               // users.isPublic を書き、profile を更新する
    // 【一覧の差し引きは users を書いた直後】ここから先で失敗しても、
    // 一覧は users.isPublic(見え方の唯一の正)と一致した状態で残る。
    dir.setUsers((prev) => {
      const rest = prev.filter((u) => u.uid !== uid);
      if (!v) return rest;
      // 【stats を落とさない】rankByPractice は u.stats を要求する。
      // 元の行が持っていた練習日数を捨てると、公開に戻した瞬間だけ順位から消える。
      const mine = prev.find((u) => u.uid === uid);
      return [...rest, { uid, ...profile, isPublic: true, stats: mine?.stats ?? computePracticeStats(sessions ?? []) }];
    });
    setIdeals((prev) => {
      const rest = (prev ?? []).filter((x) => x.ownerUid !== uid);
      return v ? [...rest, ...Object.values(myIdeals ?? {})] : rest;
    });
    if (v) await publishMyIdeals(uid, myIdeals);
  };

  const index = Math.max(0, SUB_TABS.findIndex((x) => x.key === tab));
  // 子タブを動かしたら人物紹介は閉じる(下の画面が別人のものに変わるため)
  const go = (k) => { setPerson(null); setTab(k); };

  return (
    <div>
      {/* 【子タブは計測・リード・My Data と同じ見出し型】2026/09/06 本人指示。
          【B10 2026/09/09】以前はここを padding: 0 var(--sp-4) で包んで本文の左端に
          合わせていたが、その本文が 14px へ動いた(pageStyle 参照)ので包みは要らない。
          My Data 側の SubTabs も包み無しで .app-root の 14px に居る。 */}
      <SubTabs items={SUB_TABS} value={tab} onChange={go} />
      {/* 【bleed は渡さない】コミュニティのカードは左右の余白を食い破らない。 */}
      <SwipePager index={index} onIndexChange={(i) => go(SUB_TABS[i].key)}>
        {/* 【step を渡さない】目安の一覧は名簿と並行に走る。段階を足すと、
            先に終わった側で数字が巻き戻る。今の値のまま育った ficus を出す。 */}
        {dirGate ?? (ideals === null ? <LoadingRing /> : (
          <DataScreen users={users} ideals={ideals} myIdeals={myIdeals} myUid={uid} saxTypes={profile?.saxTypes ?? []} onOpenPerson={setPerson} />
        ))}
        {dirGate ?? <RankScreen users={users} myUid={uid} onOpenPerson={setPerson} />}
        {dirGate ?? <ShareScreen users={users} saxTypes={profile?.saxTypes ?? []} />}
        {/* 【B-3 2026-09-15 本人裁定】削除のシートが「外から見えなくなるもの」を数えるのに
            公開している目安の数が要る。myIdeals を持っているのはこの階層だけなので渡す。 */}
        <ProfileView flaggedMe={flaggedMe} uid={uid} profile={profile} myIdeals={myIdeals} onEdit={onEdit} onTogglePublic={togglePublic} onChangeAvatar={changeAvatar} onDelete={onDelete} onOpenBackup={() => setBackup(true)} />
      </SwipePager>
      {/* 【人物紹介は SwipePager の外(兄弟)】中に入れると、track が静止時も持つ
          transform が position: fixed の包含ブロックになり、画面全体を覆えなくなる
          (DESIGN-SYSTEM §6.3 が名指しで警告している事故)。
          【2026/09/09】中身は BottomSheet になり document.body へポータルされるので
          包含ブロックの事故そのものは器の側で防がれるが、**兄弟のまま置く**
          ── ポータルするかどうかは器の都合で、呼び出し側がそれに寄りかからない。 */}
      {person ? (
        <PersonSheet
          person={person}
          ideals={ideals ?? []}
          myIdeals={myIdeals}
          onAdopt={onAdoptIdeal}
          onClose={() => setPerson(null)}
          myUid={uid}
          onReported={(targetUid) => {
            // 【読み直さない】50件ぶんの読み取りを1回増やさずに、手元の配列から落とす。
            // 目安も一緒に落とす ── データタブの線が通報した相手のまま残らないように。
            dir.setUsers((prev) => prev.filter((u) => u.uid !== targetUid));
            setIdeals((prev) => (prev ?? []).filter((i) => i.ownerUid !== targetUid));
          }}
        />
      ) : null}
      {/* 【アカウント引継も SwipePager の外】上の人物紹介と同じ理由。
          中に入れると track の transform が position: fixed の包含ブロックになる。
          【2026/09/09】BottomSheet へ畳んだので body へポータルされる。作法のクラスの
          継承は切れるが、BackupSheet 自身が中身を `.surf-card` で包んで連れて行くので
          中の .card はそのままカードとして描かれる(BackupSheet の注記を参照)。 */}
      {backup ? <BackupSheet onClose={() => setBackup(false)} /> : null}
    </div>
  );
}

// 【アカウント引継】プロフィールの一番下から開く。中身は My Data の「記録の保存」を
// **そのまま**出すだけで、このファイルは器を1つも持たない。
//
// 【C-14 / D-6 2026/09/09 本人裁定「シートは①(下寄せ + つまみ)に統一する」】
// ここは以前 App.jsx の BottomSheet を**別実装で写して**いた(暗幕・角丸 28 / つまみ 36×4 /
// 影 / maxHeight / Escape の useEffect / useSheetDismiss を自分で持っていた)。
// 写しをやめて BottomSheet ただ1つに畳んだので、この関数は中身しか持たない。
//
// 【便R 2026-09-20 本人指示】「引き継ぎの中の文をカード形式にする必要ない」。
// BackupPanel の外側から `card` を外したので、**`.surf-card` の包みも一緒に外した**。
// この包みは `.card` のためだけに在った ── index.css が `.card` の寸法を
// `.surf-card .card` として持っており、document.body へ portal されると
// `.surf-card` の子孫でなくなって寸法が丸ごと効かなくなる、という1点だけが理由だった。
// 他に落ちる作法は無い: `.surf-card` の地は --c-bg でシートの --c-surface と同色、
// 左右の負マージンと padding は同じトークンで打ち消し合って幅を1px も変えない。
// BackupPanel が使う .sans / .ctl-plain / .ctl-pill はどれも `.surf-card` に
// ぶら下がっていない(index.css の単独規則)。
export function BackupSheet({ onClose }) {
  return (
    <BottomSheet ariaLabel="アカウント引継" onClose={onClose}>
      <BackupPanel />
    </BottomSheet>
  );
}

function CommunityTabBody({ sessions, tuningHz, onAdoptIdeal, landTab: landTabRequest = null, onLanded = null }) {
  const [phase, setPhase] = useState("loading"); // loading | notJoined | form | profile | error
  const [uid, setUid] = useState(null);
  const [profile, setProfile] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 削除の結果、未参加へ戻ったときに一度だけ出す説明(DELETE_PARTIAL_NOTICE)。
  const [notice, setNotice] = useState(null);
  // 【編集から戻ったときに開く子タブ】プロフィールの編集は**マイページから開く**ので、
  // 保存しても「やめる」でも、出てきた場所へ戻すのが道理(2026/09/07 本人指示)。
  // 素直に書くと必ずデータタブに戻る ── フォームと JoinedView は別の要素なので、
  // 行き来のたびに JoinedView が作り直され、子タブの状態が初期値に戻るため。
  // 初回の作成だけは "data" のまま(作ったばかりの自分の欄より、まず中身を見せる)。
  // 【D3 2026-09-16】App から「開く子タブ」(landTabRequest)が来ていればそれで始める。
  // このタブは topTab が community のときだけ描かれる(離れると消える)ので、来るのは
  // いつも作り直しの直後 = JoinedView がまだ無い loading の間。JoinedView は initialTab を
  // **初期値としてしか読まない**ので、その前に state を合わせておく必要がある。
  const [landTab, setLandTab] = useState(landTabRequest || "data");
  useEffect(() => {
    if (!landTabRequest) return;
    setLandTab(landTabRequest);
    // 受け取ったので App 側の要求を消してもらう(次に同じ子タブを頼まれても効くように)。
    if (onLanded) onLanded();
  }, [landTabRequest, onLanded]);
  // 未参加(JoinIntro)のときは landTab を読む相手が居ないので、何も起きない。参加して
  // プロフィールを作ったあとは onSubmit の setLandTab(profile ? "me" : "data") が上書きする
  // ── 「初回の作成は "data" のまま」の規則はそのまま。

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    (async () => {
      try {
        // 【ここで ensureSignedIn を呼ばない】呼ぶと「参加すると匿名のアカウントが
        // 作られます」という説明を読んでいる時点で既にアカウントが存在してしまい、
        // 覗いて去っただけの人にもアカウントが残る。同意より先に作らない。
        // 既にサインイン済みの端末では getSignedInUid が既存の uid を返すので、
        // 2回目以降の体験は変わらない(匿名セッションは端末に永続する)。
        const id = await getSignedInUid();
        if (!alive) return;
        if (!id) { setPhase("notJoined"); return; } // まだ誰でもない。作らずに説明だけ出す
        setUid(id);
        const p = await loadProfile(id);
        if (!alive) return;
        setProfile(p);
        setPhase(p ? "profile" : "notJoined");
      } catch (e) {
        if (alive) { setErrorMsg(connectErrorOf(e)); setPhase("error"); }
      }
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  // 【匿名アカウントを作る唯一の場所】呼ばれるのは (a) 参加ボタン (b) 保存の直前 の2つだけ。
  // どちらも利用者が「参加する」と決めたあとなので、説明文と実態がずれない。
  // アカウント削除の直後は uid が null に戻るが、そこで即座にサインインし直すと
  // 「消したのに新しいアカウントができる」ので、次に参加を押すまで作らない。
  // (b) が要るのは、削除 → 参加 の流れで骨格のまま saveProfile(null, doc) を呼ぶと
  // Firestore の doc パスが壊れるため。(a) があっても保険として残す(冪等)。
  const ensureUid = async () => {
    if (uid) return uid;
    const id = await ensureSignedIn();
    setUid(id);
    return id;
  };

  if (phase === "loading") return <LoadingRing step="account" />;
  if (phase === "error") {
    return (
      <Centered>
        <div>{errorMsg}</div>
        {/* 【設定の欠落では再試行を出さない】押しても同じ結果にしかならないボタンは、
            利用者に「自分の操作で直せる」と誤解させたうえで裏切る。通信の失敗のときだけ出す。 */}
        {errorMsg !== CONFIG_ERROR && (
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="sans" style={{ ...secondaryButtonStyle, marginTop: "var(--sp-4)", width: "auto", padding: "0 var(--sp-5)" }}>
            もう一度試す
          </button>
        )}
      </Centered>
    );
  }
  if (phase === "notJoined") {
    return (
      <JoinIntro
        notice={notice}
        onJoin={async () => {
          // ここで初めて匿名アカウントが作られる。9項目を埋めきってから
          // 「圏外でした」と分かるより、押した瞬間に失敗を見せたほうが親切。
          try {
            setNotice(null);
            await ensureUid();
            setPhase("form");
          } catch (e) {
            setErrorMsg(connectErrorOf(e));
            setPhase("error");
          }
        }}
      />
    );
  }
  if (phase === "form") {
    return (
      <ProfileForm
        initial={profile}
        onCancel={profile ? () => { setLandTab("me"); setPhase("profile"); } : null}
        onSubmit={async (input) => {
          const r = buildProfileDoc(input);
          if (r.error) return r.error; // フォーム側がエラー文言を表示する
          try {
            const id = await ensureUid();
            await saveProfile(id, r.doc);
          } catch (e) {
            // 黙って失敗させない。フォームは開いたままにして再送できるようにする。
            // 【原因を握りつぶさない】ルールに拒まれたのか通信が切れたのかは
            // 利用者にとっても開発者にとっても別の話なので、コンソールにも残す。
            console.error("[community] プロフィールの保存に失敗", e?.code, e);
            return saveErrorOf(e);
          }
          // 編集(既にプロフィールがある)ならマイページへ、初回の作成ならデータへ。
          // 削除して入り直した場合は profile が null に戻っているので、
          // 前回の "me" が残ったまま新しい人をマイページに落とすことはない。
          setLandTab(profile ? "me" : "data");
          setProfile(r.doc);
          setPhase("profile");
          return null;
        }}
      />
    );
  }
  return (
    <JoinedView
      profile={profile}
      uid={uid}
      sessions={sessions}
      tuningHz={tuningHz}
      onAdoptIdeal={onAdoptIdeal}
      initialTab={landTab}
      onEdit={() => setPhase("form")}
      onTogglePublic={async (v) => {
        await setProfilePublic(uid, v); // 失敗は ProfileView が受けて文言を出す
        setProfile({ ...profile, isPublic: v });
      }}
      onChangeAvatar={async (v) => {
        await setProfileAvatar(uid, v); // 失敗は ProfileView が受けて文言を出す
        setProfile({ ...profile, ...v });
      }}
      onDelete={async () => {
        // 例外が出るのは削除の途中で失敗したとき。一部だけ消えていることがあるので、
        // ProfileView は「押し直せば続きから完了できる」と言う(DELETE_ERROR)。
        const r = await deleteAccount();
        setProfile(null); setUid(null);
        // 資格情報まで消せたかどうかで、未参加画面に出す説明を切り替える。
        setNotice(r?.credentialRemoved === false ? DELETE_PARTIAL_NOTICE : null);
        setPhase("notJoined");
      }}
    />
  );
}

// ------------------------------------------------------------------
// 共有のスタイル。値はトークンから引くだけで、新しい寸法・色は作らない。
// ------------------------------------------------------------------

/* 【minmax(0, 1fr) を外さないこと】grid の子の min-width は既定 auto なので、
   中の長い文字(型番・メーカー)が列そのものを押し広げ、**ページ全体の X 軸がずれる**。
   凡例の行に minWidth: 0 と省略記号は付けてあるが、それは flex の中でしか効かない。
   実測: 375px 幅でカードが 619.7px まで広がった。minmax(0, 1fr) で 315px に収まる。
   同じ事故がアイコンの色の格子でも起きている(CommunityTab.jsx の格子のコメント)。 */
// 【B10 2026/09/09 本人裁定「30に寄せる」】左右は .app-root の 14px だけにする。
// ここに --sp-4 を足すと**打ち消しではなく上乗せ**になり、カードの中の文字が
// 14+16+16 = 46px と、My Data 側の 30px より 16px 右へずれる(ブラウザ実測)。
// 縦の --sp-4 と カード間の gap はそのまま。
const pageStyle = { padding: "var(--sp-4) 0", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "var(--sp-4)" };
const titleStyle = { fontSize: "var(--fs-md)", fontWeight: 700, color: "var(--c-ink)" };
const bodyStyle = { fontSize: "var(--fs-sm)", color: "var(--c-ink)", lineHeight: 1.7 };
const noteStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", lineHeight: 1.6 };
const labelStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", fontWeight: 600 };
// 楽器種別ごとの楽器の組のまとまりの頭。項目の見出し(labelStyle)より一段濃いだけで、
// 新しい寸法・色は作らない(--fs-sm と --c-ink はどちらも既存のトークン)。
const gearHeadingStyle = { fontSize: "var(--fs-sm)", color: "var(--c-ink)", fontWeight: 700 };
const errorStyle = { fontSize: "var(--fs-sm)", color: "var(--c-danger)", lineHeight: 1.6 };
// 【A-3 / F3・F4 2026-09-15 本人裁定】**欄の直下**に出す赤文字。画面下のまとめ(errorStyle)より
// 1段小さい --fs-xs ── 添え物であって、画面の主張ではないため。
const fieldErrorStyle = { fontSize: "var(--fs-xs)", color: "var(--c-danger)", lineHeight: 1.6 };
// 【束4 2026-09-19 本人指示】「楽器やマウスピースのグレーのカードをニックネームの
// グレーのカードの形に統一」「演奏開始年も同様に統一」。
// **欄の綴りはこの1つだけ**にする(寸法・地・角丸はここと index.css の入力欄の規則が持ち、
// 欄ごとにインラインで作り直さない)。地 --c-sunken・枠 1px transparent・角丸 --r-xs は
// index.css の `input[type=...] , select, textarea` の1つの規則が全員に配る。
//
// 【appearance: none が要る理由】同じ宣言を当てても、**ブラウザが要素ごとに別の
// 描き方(UA の appearance)を持っている**ので形が揃わない。
//   ・<select> は右端に ▾ を描き、iOS では地と高さの扱いも input と違う
//   ・input[type="search"] は iOS Safari で高さ・角丸を UA が握り、min-height が効かない
// 「同じ形」を綴りだけで約束しても描き分けられてしまうので、UA の描き方そのものを外す。
// **新しい寸法・色・角丸は1つも作っていない**(appearance は値ではなく描き方の指定)。
// 選び方(押すと ▾ の一覧 / iOS ではピッカー)は器の見た目とは別なので変わらない。
const controlStyle = {
  width: "100%", minHeight: "var(--tap-min)", padding: "0 var(--sp-3)", fontSize: "var(--fs-sm)", color: "var(--c-ink)",
  appearance: "none", WebkitAppearance: "none",
};
// 引けない状態(楽器種別が未選択)のときだけ薄くする。**寸法・地・角丸は上を継ぐ**
// ── 欄ごとにインラインで上書きしないための名前(GearPicker が読む)。
const controlDisabledStyle = { ...controlStyle, opacity: 0.6, cursor: "not-allowed" };
// 【便O 2026-09-20 本人指示】「プロフィール欄の演奏開始年も透明にして」。
// 演奏開始年は**選ぶだけ**の欄で、上下を挟むのは属性とジャンルのピル ── その並びの中で
// ここだけ灰色の箱になっていた。地を打ち消して周りと揃える。
// 打ち込む欄(ニックネーム・機材の検索)は controlStyle のまま地を持つ
// ── 「打つ場所には地がある / 選ぶ場所には無い」。リードの開封日と同じ考え方
// (あちらの綴りは App.jsx の PICK_CONTROL_PLAIN)。
// **枠の 1px solid transparent は外さない**(index.css の注記。0 にすると 2px 縮む)。
const controlPlainStyle = { ...controlStyle, background: "transparent" };

// 主要動作(参加する・保存する)。B型 = 枠なし + 塗り。
const primaryButtonStyle = {
  width: "100%", minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)", border: "none",
  background: "var(--c-accent)", color: "var(--c-on-accent)",
  fontSize: "var(--fs-md)", fontWeight: 700, cursor: "pointer",
};
// 主要でない動作(編集する・やり直す・やめる)。B型 = 枠なし + 沈めた地。
const secondaryButtonStyle = {
  width: "100%", minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)", border: "none",
  background: "var(--c-sunken)", color: "var(--c-ink-2)",
  fontSize: "var(--fs-md)", fontWeight: 600, cursor: "pointer",
};
// 破壊的な一手。index.css の .ctl-danger と同じ考え方(枠は持たず、地と文字色だけ)。
const dangerButtonStyle = {
  width: "100%", minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)", border: "none",
  background: "var(--c-danger)", color: "var(--c-on-accent)",
  fontSize: "var(--fs-sm)", fontWeight: 700, cursor: "pointer",
};

function Centered({ children }) {
  return <div className="sans" style={{ padding: "var(--sp-6)", textAlign: "center", color: "var(--c-ink-3)", fontSize: "var(--fs-sm)", lineHeight: 1.7 }}>{children}</div>;
}

// 文章の中のリンクの見た目をした <button>。JoinIntro の規約・ポリシー用(押すとシートが開く)。
// 以前の <a>(色だけ指定・下線はブラウザ既定)と同じ見え方にする。文字の大きさは行(noteStyle)を継ぐ。
const linkButtonStyle = {
  background: "none", border: "none", padding: 0, font: "inherit",
  color: "var(--c-accent)", textDecoration: "underline", cursor: "pointer",
};

function JoinIntro({ onJoin, notice = null }) {
  const [busy, setBusy] = useState(false);
  // 【C11・C12】規約・ポリシーのシート("terms" | "privacy" | null)
  const [legal, setLegal] = useState(null);
  // 【束3】お問い合わせのシート。**未参加の人も送れる**(送信のときに匿名の資格情報だけを
  // 作る。users は書かないので参加にはならない)。
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const join = async () => {
    if (busy) return; // 二度押しで signInAnonymously が二重に走らないようにする
    setBusy(true);
    try { await onJoin(); } finally { setBusy(false); }
  };
  return (
    <div className="sans" style={pageStyle}>
      <div style={titleStyle}>コミュニティ</div>
      {notice ? <div className="sans" role="status" style={bodyStyle}>{notice}</div> : null}
      <div style={bodyStyle}>
        参加すると匿名のアカウントが作られ、他の奏者のデータが見られるようになります。
        メールアドレスなどの個人情報は公表されません。
      </div>
      {/* spec §6: 匿名のままのアカウントは機種変更・アプリ削除で失われる。この告知は本来
          アカウント連携の画面(後続の計画)に付くものだが、その画面が出来る前から
          「失われうるアカウント」は作られてしまうので、作る前のここで先に言っておく。 */}
      <div style={noteStyle}>
        匿名のアカウントはこの端末にだけ残ります。機種変更やアプリの削除で失われ、元に戻せません。
      </div>
      {/* 【計画5 2026-09-10】参加する前に、規約と扱いを読める場所を出しておく。
          **参加した後にしか読めない、という形にしない** ── 同意して押すものなので。 */}
      <div className="sans" style={{ ...noteStyle, display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
        {/* 【C11・C12 2026-09-16】外へ出さず、アプリの中のシートで読む(波及。理由は LegalSheet.jsx)。
            【束3 2026-09-19】お問い合わせも同じ形にした ── 以前の mailto: は端末に
            メールアプリが無いと何も起きず、有ってもアプリの外へ出る。3つとも同じ
            「押すとシートが開く」になったので、見た目も同じ linkButtonStyle に揃う。 */}
        <button type="button" onClick={() => setLegal("terms")} className="sans" style={linkButtonStyle}>利用規約</button>
        <button type="button" onClick={() => setLegal("privacy")} className="sans" style={linkButtonStyle}>プライバシーポリシー</button>
        <button type="button" onClick={() => setFeedbackOpen(true)} className="sans" style={linkButtonStyle}>お問い合わせ</button>
      </div>
      <button type="button" onClick={join} disabled={busy} className="sans" style={{ ...primaryButtonStyle, opacity: busy ? 0.6 : 1 }}>
        {busy ? "準備中…" : "参加してプロフィールを作る"}
      </button>
      {legal ? <LegalSheet kind={legal} onClose={() => setLegal(null)} /> : null}
      {feedbackOpen ? <FeedbackSheet onClose={() => setFeedbackOpen(false)} /> : null}
    </div>
  );
}

// 1項目 = 見出し + 中身(+ 注意書き)。フォームと表示の両方がこれを使う。
function Field({ label, note, children }) {
  return (
    <div style={{ display: "grid", gap: "var(--sp-1)" }}>
      <div className="sans jp-label" style={labelStyle}>{label}</div>
      {children}
      {note ? <div className="sans" style={noteStyle}>{note}</div> : null}
    </div>
  );
}

// 複数選べる選択肢の並び。A型(枠 = --c-line-strong)。
// 選択中は「枠を透明にして地だけで塗る」= §6.7 の芯1(枠と違う地を同時に持たない)を守る書き方。
// 見た目・寸法は App.jsx の拍のグループ選択ピルと同値(新しい値を作らない)。
// labelOf: 保存する値と画面に出す文字が違うとき(楽器種別は値 "alto" / 表示 "A.Sax")に渡す。
// 既定は「値をそのまま出す」なので、既存の呼び手(ジャンル・編成)は書き換え不要。
//
// single: **1つだけ選ぶ**並び(属性)。既定は false なので、複数選べる既存の呼び手
// (楽器種別・ジャンル・編成)は書き換え不要。**新しい部品を作らない**ための引数1つ。
// 【読み上げは作法が変わる】複数選べる並びは押しボタンの入/切なので aria-pressed、
// 1つだけ選ぶ並びは選択肢の集合なので role="radiogroup" + role="radio" + aria-checked。
// 見た目(A型のピル)は同じでも、読み手に伝わる意味が違うので綴りを分ける。
// 「1つだけ」を守るのは呼び手側(selected に1つしか入れない)。ここは描くだけ。
function PillGroup({ options, selected, onToggle, ariaPrefix, labelOf = (v) => v, single = false }) {
  return (
    /* 【行間は 0 でよい】ボタンが 44px、中の見えるピルが 30px なので、
       ボタン自体が上下 7px ずつの余白を持っている。ここに縦の gap を足すと
       見た目の間隔が 52px になり、本人指摘の「明らかに大きすぎる」に戻る。 */
    <div
      role={single ? "radiogroup" : undefined} aria-label={single ? ariaPrefix : undefined}
      style={{ display: "flex", flexWrap: "wrap", gap: "0 var(--sp-1)" }}
    >
      {options.map((opt) => {
        const on = selected.includes(opt);
        const text = labelOf(opt);
        return (
          <button
            key={opt} type="button" onClick={() => onToggle(opt)}
            role={single ? "radio" : undefined}
            aria-checked={single ? on : undefined}
            aria-pressed={single ? undefined : on}
            aria-label={`${ariaPrefix} ${text}`}
            className="sans no-select"
            style={{
              minHeight: "var(--tap-min)", padding: 0, background: "transparent", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}
          >
            {/* 【A型: ON は枠線の色だけ】§6.7「ON の合図に地を足さないこと」。
               地を足すと「枠線＋違う地」になり、規則そのものを破る。
               見た目は 30px、当たり判定は上のボタンの 44px（§5「見た目の大きさは変えない。
               当たり判定だけ広げる」を、箱ではなく中身を小さくする形で満たす）。 */}
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              minHeight: 30, padding: "0 13px", borderRadius: "var(--r-pill)",
              border: `1px solid ${on ? "var(--c-accent)" : "var(--c-line-strong)"}`,
              color: on ? "var(--c-accent)" : "var(--c-ink-2)",
              fontSize: "var(--fs-xs)", fontWeight: 600, whiteSpace: "nowrap",
            }}>{text}</span>
          </button>
        );
      })}
    </div>
  );
}

// 16px の四角い箱の見た目は App.jsx の reedCheckboxStyle が持っているが、あれは
// App.jsx の内部関数なのでここからは引けない(import すると循環参照になる)。
// ネイティブの checkbox を accentColor だけ紺に寄せて使う。当たり判定は label 側の 44px。
// 公開の切替はスイッチ。**チェックボックスとは役割が違う。**
// チェックボックスは「保存ボタンを押したときに効く申告」(この画面では「13歳以上です」)、
// スイッチは「触った瞬間に効く設定」。公開の切替は押すとその場で Firestore へ書きに行くので、
// 保存を待つ見た目にすると、切ったつもりで切れていない誤解を生む。
// 寸法は design/community-tab-proposals.html の .tog に合わせた(軌道 44x26 / つまみ 20)。
// 当たり判定は軌道ではなくボタン側の 44px 角で確保する(軌道は 26px しかなく単独では足りない)。
function SwitchRow({ checked, onChange, disabled = false, label, note }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-3)" }}>
      <div style={{ display: "grid", gap: "var(--sp-1)", minWidth: 0 }}>
        <div className="sans" style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--c-ink)" }}>{label}</div>
        {note ? <div className="sans" style={noteStyle}>{note}</div> : null}
      </div>
      <button
        type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
        onClick={() => onChange(!checked)}
        className="no-select"
        style={{
          flex: "0 0 auto", width: "var(--tap-min)", minHeight: "var(--tap-min)", padding: 0,
          background: "transparent", border: "none", cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <span style={{
          display: "block", width: 44, height: 26, borderRadius: "var(--r-pill)", position: "relative",
          // 【OFF の軌道に --c-line を使わない】あれは白地との差が 1.1:1 しかなく、
          // 白いつまみが軌道に溶けて**OFF のときスイッチが消えて見える**。
          // --c-line-strong(#C3CAD3 / 白地と 1.65:1)は設計システムが
          // 「入力欄・丸ボタンの枠」に充てている段で、つまみの輪郭が出る。新しい値は作らない。
          background: checked ? "var(--c-accent)" : "var(--c-line-strong)", transition: "background 120ms ease",
        }}>
          <span style={{
            position: "absolute", top: 3, left: checked ? 21 : 3, width: 20, height: 20,
            borderRadius: "50%", background: "#fff", transition: "left 120ms ease",
            boxShadow: "0 1px 2px rgba(0,0,0,.2)",
          }} />
        </span>
      </button>
    </div>
  );
}

// 絵柄と地の色を選ぶ。**上に実物大の1つを出す。**
// 画面案の初期の版は上部の見本が横長で、実際にどう見えるか分からなかった
// (2026-08-28 本人指摘)。選んだ結果そのものを、順位や一覧で出るのと同じ大きさで見せる。
function AvatarPicker({ icon, color, onChange }) {
  const cell = (selected) => ({
    minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", padding: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: selected ? "var(--c-accent-tint)" : "transparent",
    border: "none", borderRadius: "var(--r-md)", cursor: "pointer",
  });
  return (
    <div style={{ display: "grid", gap: "var(--sp-3)" }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Avatar icon={icon} color={color} size={64} />
      </div>

      <div className="sans jp-label" style={labelStyle}>絵柄</div>
      {/* 【列は minmax(0, 1fr) にする】`1fr` の最小値は auto なので、
          中の当たり判定(44px)がそのまま列の下限になり、**格子が画面より広くなる**。
          親は grid なので、広がった子は兄弟もろともページ全体を押し広げる
          (実際にこれで色の行が476pxになり、375pxの画面でニックネーム欄まで画面外へ出た)。
          minmax(0, ...) にすると列は0まで縮められるので、はみ出しがページに伝播しない。 */}
      <div role="radiogroup" aria-label="アイコンの絵柄" style={{
        display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "var(--sp-1)",
      }}>
        {AVATAR_ICONS.map((id) => (
          <button
            key={id} type="button" role="radio" aria-checked={id === icon}
            aria-label={id.replace(/^ic-/, "")}
            onClick={() => onChange({ icon: id, color })}
            style={cell(id === icon)}
          >
            {/* 一覧の中は選択の判別が要るだけなので、地の色は付けず絵柄だけを出す。
                地の色まで付けると24個ぶん色が散り、いま選んでいるものが埋もれる。 */}
            <svg width={24} height={24} fill="var(--c-ink)" aria-hidden="true">
              <use href={`#${id}`} />
            </svg>
          </button>
        ))}
      </div>

      <div className="sans jp-label" style={labelStyle}>背景</div>
      {/* 【10色を1行に並べない】当たり判定は44px角を割れないので、10列だと
          10*44 + 隙間9*4 = 476px 必要になる。375px の端末で使える幅は
          375 - 左右の余白32 = 343px しかない。**5列2段にすると 5*44 + 4*4 = 236px で収まる。**
          「列を狭くして1行に収める」は当たり判定を割るので採らない。 */}
      <div role="radiogroup" aria-label="アイコンの背景" style={{
        display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "var(--sp-1)",
      }}>
        {Array.from({ length: AVATAR_COLOR_MAX - AVATAR_COLOR_MIN + 1 }, (_, i) => i + AVATAR_COLOR_MIN).map((n) => (
          <button
            key={n} type="button" role="radio" aria-checked={n === color}
            aria-label={`色 ${n}`}
            onClick={() => onChange({ icon, color: n })}
            style={cell(n === color)}
          >
            <span style={{
              display: "block", width: 24, height: 24, borderRadius: "50%",
              background: `var(--c-avatar-${n})`,
              // 選択中は輪で示す。**地の色そのものを変えない** ── 見本と食い違う。
              boxShadow: n === color ? "0 0 0 2px var(--c-surface), 0 0 0 4px var(--c-accent)" : "none",
            }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function CheckRow({ checked, onChange, children }) {
  return (
    <label className="sans no-select" style={{ minHeight: "var(--tap-min)", display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--fs-sm)", color: "var(--c-ink)", cursor: "pointer" }}>
      <input
        type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, flex: "0 0 auto", accentColor: "var(--c-accent)", cursor: "pointer" }}
      />
      <span>{children}</span>
    </label>
  );
}

// ------------------------------------------------------------------
// 楽器の組の選び方。**自由入力は確定できない。**
// 検索欄に打った文字はカタログを絞るためだけに使い、値にはならない。
// 確定できるのは (a) 候補リストの1件 (b)「カタログに無い(その他)」の2通りだけなので、
// 打った文字がそのまま保存される経路が構造的に存在しない。
// (buildProfileDoc 側でも isValidInstrument / isValidMouthpiece が同じことを検査している。
//  ここは「押せないようにする」担当で、正しさの最終判断はあちら。)
// ------------------------------------------------------------------
function gearLabel(v) {
  if (!v || !v.brand) return "—";
  return v.model ? `${v.brand} ${v.model}` : v.brand;
}

// リードだけは番手が続く。番手を持たない古いドキュメントはメーカー・銘柄だけで出す
// (ルールが null を許しているので、保存し直すまで番手の無い人がいる)。
function reedLabel(g = {}) {
  const base = gearLabel({ brand: g.reedBrand, model: g.reedModel });
  if (!g.reedBrand || !g.reedStrength) return base;
  return `${base} ${g.reedStrength}`;
}

// disabled: 検索してもカタログを引けない状態(楽器種別が未選択のとき)。
// searchInstrumentModels(q, "") は必ず空を返すので、打てるままにしておくと
// 「カタログに自分の楽器があるのに、候補が出ないので『その他』で登録する」人が出る。
// 引けないなら打たせない。
function GearPicker({ label, note, value, onPick, runSearch, ariaPrefix, disabled = false }) {
  const [query, setQuery] = useState("");
  const results = !disabled && query.trim() ? runSearch(query).slice(0, 10) : [];

  if (value) {
    return (
      <Field label={label} note={note}>
        <div style={{ display: "flex" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "var(--sp-2)", minHeight: "var(--tap-min)",
            padding: "0 var(--sp-2) 0 var(--sp-3)", borderRadius: "var(--r-pill)",
            background: "var(--c-sunken)", color: "var(--c-ink)", fontSize: "var(--fs-sm)", fontWeight: 600,
          }}>
            {gearLabel(value)}
            <button
              type="button"
              onClick={() => { setQuery(""); onPick(null); }}
              aria-label={`${ariaPrefix}の選択を解除`}
              className="sans no-select"
              style={{
                minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", padding: 0,
                background: "transparent", border: "none", color: "var(--c-ink-3)",
                fontSize: "var(--fs-md)", lineHeight: 1, cursor: "pointer",
              }}
            >
              ✕
            </button>
          </span>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} note={note}>
      {/* 【束4】ニックネームの欄と**まったく同じ綴り**にする(type も style も同じ1つ)。
          以前は type="search" で、iOS Safari が searchfield として別に描くため
          「グレーのカードの形」がニックネームと揃っていなかった。
          打った文字で候補を絞る仕掛けは type に依らない(onChange と runSearch が持つ)ので、
          1つも壊れない。読み上げは aria-label の「○○を検索」がそのまま担う。 */}
      <input
        type="text" value={query} onChange={(e) => setQuery(e.target.value)}
        aria-label={`${ariaPrefix}を検索`}
        disabled={disabled}
        className="sans" style={disabled ? controlDisabledStyle : controlStyle}
      />
      {results.length > 0 && (
        <div style={{ display: "grid", gap: 0 }}>
          {results.map((r) => (
            <button
              key={`${r.brand}/${r.model}`} type="button"
              onClick={() => { setQuery(""); onPick({ brand: r.brand, model: r.model }); }}
              className="sans"
              style={{
                width: "100%", minHeight: "var(--tap-min)", padding: "0 var(--sp-3)", textAlign: "left",
                background: "transparent", border: "none", borderBottom: "1px solid var(--c-line)",
                borderRadius: 0, color: "var(--c-ink)", fontSize: "var(--fs-sm)", cursor: "pointer",
              }}
            >
              <span style={{ color: "var(--c-ink-3)" }}>{r.brand}</span> {r.model}
            </button>
          ))}
        </div>
      )}
      {/* 候補が出ていなくても常に末尾に置く。打った文字が候補ゼロだったときの逃げ道がこれ。 */}
      <button
        type="button"
        onClick={() => { setQuery(""); onPick({ brand: OTHER_BRAND, model: null }); }}
        className="sans"
        style={{ ...secondaryButtonStyle, fontSize: "var(--fs-sm)", fontWeight: 600 }}
      >
        カタログに無い(その他)
      </button>
    </Field>
  );
}

// ------------------------------------------------------------------
// 登録フォーム。自由入力はニックネームだけ。他はすべて選択。
// ------------------------------------------------------------------
// 保存されている楽器の組(6キー)を、画面が持つ形(3つの選択)へ開く。
// 【保存の形と画面の形の対応づけは、この2つの関数だけが持つ】
// 楽器の組の欄を1つ足すたびに、直す場所は (a) 読み込み (b) 空の初期値 (c) 書き出し の3つある。
// 実際にリードを足したとき (b) と (c) を忘れ、**選んでも保存されない**状態になった。
// 必須の欄でこれが起きると、利用者から見て「正しく選んでいるのに永久に登録できない」。
// 対応づけを関数に閉じ込め、picksToGearEntry の出力が仕様の8キーと一致することを
// community-form.test.js で検査している。
const gearEntryToPicks = (g = {}) => ({
  instrument: g.instrumentBrand ? { brand: g.instrumentBrand, model: g.instrumentModel ?? null } : null,
  mouthpiece: g.mpBrand ? { brand: g.mpBrand, model: g.mpModel ?? null } : null,
  ligature: g.ligBrand ? { brand: g.ligBrand, model: g.ligModel ?? null } : null,
  reed: g.reedBrand ? { brand: g.reedBrand, model: g.reedModel ?? null } : null,
  // 番手はメーカーと別の欄。GearPicker の value の形({brand, model})を変えないため、
  // reed の中に入れず並べて持つ。
  reedStrength: g.reedStrength ?? null,
});
export const EMPTY_PICKS = { instrument: null, mouthpiece: null, ligature: null, reed: null, reedStrength: null };
export const picksToGearEntry = (p = EMPTY_PICKS) => ({
  instrumentBrand: p.instrument?.brand ?? null,
  instrumentModel: p.instrument?.model ?? null,
  mpBrand: p.mouthpiece?.brand ?? null,
  mpModel: p.mouthpiece?.model ?? null,
  ligBrand: p.ligature?.brand ?? null,
  ligModel: p.ligature?.model ?? null,
  reedBrand: p.reed?.brand ?? null,
  reedModel: p.reed?.model ?? null,
  reedStrength: p.reedStrength ?? null,
});

function ProfileForm({ initial, onSubmit, onCancel }) {
  const [nickname, setNickname] = useState(initial?.nickname ?? "");
  // 【既定を選んだ状態で出す】アイコンは必須なので、未選択で始めると
  // 「何も触っていないのに保存できない」になる。初期値は一覧の先頭と色1。
  // 【M1 2026-09-19 本人指示】アイコンの編集は**この画面から外した**
  // (「プロフィール編集画面からアイコン編集を削除 / プロフィール画面でアイコンを
  // タップしたら変更できるように」)。ただし**保存する値としては残す** ──
  // 初回作成では既定の絵柄で1枚のプロフィールを書き切る必要があり、
  // 編集では今の絵柄をそのまま持ち回らないと保存のたびに既定へ戻ってしまう。
  // 触らないので state ではなく定数。変更は ProfileView → setProfileAvatar が行う。
  const icon = initial?.icon ?? AVATAR_ICONS[0];
  const iconColor = initial?.iconColor ?? AVATAR_COLOR_MIN;
  const [position, setPosition] = useState(initial?.position ?? "");
  const [startYear, setStartYear] = useState(initial?.startYear ? String(initial.startYear) : "");
  const [genres, setGenres] = useState(initial?.genres ?? []);
  const [ensembles, setEnsembles] = useState(initial?.ensembles ?? []);
  // 【楽器種別と楽器の組を2つの state に分けない】掛け持ちの奏者が居るので楽器種別は複数だが、
  // 「選んだ種別」と「その楽器の組」を別々の state に持つと、両方を1つの操作で更新するときに
  // 片方が古い値を読んで**キー集合がずれる**(gear.keys() ≠ saxTypes → 保存が弾かれる)。
  // そこで持つのは楽器の組の側だけにして、**選んだ種別はそのキーから導く**。
  // 集合の一致が構造的に崩せなくなり、「外したら楽器の組も捨てる」も delete 1つで済む。
  const [gearPicks, setGearPicks] = useState(() => {
    const src = initial?.gear ?? {};
    const out = {};
    for (const t of SAX_TYPES) if ((initial?.saxTypes ?? []).includes(t)) out[t] = gearEntryToPicks(src[t]);
    return out;
  });
  // 値は SAX_TYPES の並び順(保存されている順に依らず、画面も doc も同じ並びになる)。
  const saxTypes = SAX_TYPES.filter((t) => Object.prototype.hasOwnProperty.call(gearPicks, t));
  const [ageConfirmed, setAgeConfirmed] = useState(initial?.ageConfirmed === true);
  // 【モジュール直下で作らない】このアプリは PWA として何日も開きっぱなしになりうる。
  // 読み込み時に一度だけ年の一覧を作ると年をまたいだとき新年が選べない。フォームを開くたびに作る。
  const [yearOptions] = useState(() => startYearOptions());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const toggle = (list, setList) => (v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // 【A-3】入力のたびに**保存時と同じ判定**(validateNickname)を通す。
  // 判定を2つ持たない ── 欄が独自の規則を持つと、欄は緑なのに保存だけ弾かれる画面ができる。
  // 空欄は「まだ入れていない」であって誤りではないので、赤を出さない。
  const nickLength = [...nickname].length;
  const nickError = nickname.length === 0 ? null : (validateNickname(nickname).error ?? null);

  // 【外したら楽器の組の入力状態も捨てる】キーを消すことが「種別を外す」ことそのものなので、
  // 入力状態が取り残される経路が無い(残ると gear のキーが saxTypes より多くなり、
  // buildProfileDoc と Firestore ルールの「完全一致」に弾かれて保存できなくなる。
  // しかも弾かれる理由が画面に出ていない楽器の組なので、利用者からは直しようがない)。
  const toggleSaxType = (t) => {
    setGearPicks((prev) => {
      if (Object.prototype.hasOwnProperty.call(prev, t)) { const next = { ...prev }; delete next[t]; return next; }
      return { ...prev, [t]: EMPTY_PICKS };
    });
  };
  const setPick = (t, slot, v) => setGearPicks((prev) => ({ ...prev, [t]: { ...(prev[t] ?? EMPTY_PICKS), [slot]: v } }));

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    // 【try/finally が要る理由】onSubmit が万一 reject すると busy が true のまま固まり、
    // 保存ボタンが永久に無効化される。初回登録には「やめる」が無いので、
    // タブの中で唯一の行き止まりになる。いまは親が全て catch しているので保険。
    try {
      const msg = await onSubmit({
        nickname,
        icon,
        iconColor,
        saxTypes,
        position,
        startYear,
        genres,
        ensembles,
        ageConfirmed,
        // 【編集のときに公開設定を巻き戻さない】buildProfileDoc の既定は「公開」なので、
        // 非公開にしていた人が編集しただけで公開に戻ってしまう。元の値を持ち回す。
        isPublic: initial ? initial.isPublic !== false : true,
        // gear のキーは saxTypes からしか作らない。gearPicks に取り残しがあっても混ざらない。
        gear: Object.fromEntries(saxTypes.map((t) => {
          return [t, picksToGearEntry(gearPicks[t])];
        })),
      });
      // 成功時は親が phase を切り替えてこの要素ごと消える。失敗時だけ文言が残る。
      // 【A-3】ニックネーム由来のエラーは**欄の直下に既に出ている**ので下に重ねない。
      // 空欄のときは欄に赤が出ていない(nickError が null)ので、その場合は下に出す
      // ── でないと「押しても何も起きない」になる。
      setError(nickError && msg === nickError ? null : msg);
    } catch (e) {
      console.error("[community] プロフィールの保存に失敗", e?.code, e);
      setError(saveErrorOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sans" style={pageStyle}>
      <div style={titleStyle}>{initial ? "プロフィールを編集" : "プロフィールを作る"}</div>

      {/* 【A-3 / F3・F4 2026-09-15 本人裁定】補助文は「公開される」の1文だけ。
          文字数・使える文字の規則を先に読ませない ── 規則は**破ったときに**言えばよい。
          右端の「n / 20」は数え方を validateNickname と揃える(コードポイント)。
          赤は欄の直下に出し、空欄のときは出さない(まだ何も入れていない人に赤を見せない)。 */}
      <Field
        label="ニックネーム"
        note={(
          <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--sp-2)" }}>
            <span>ニックネームは他の利用者に公開されます</span>
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--c-ink-3)", flexShrink: 0 }}>{nickLength} / 20</span>
          </span>
        )}
      >
        <input
          type="text" value={nickname} maxLength={20}
          onChange={(e) => setNickname(e.target.value)}
          aria-label="ニックネーム"
          aria-invalid={nickError ? true : undefined}
          className="sans"
          style={nickError ? { ...controlStyle, boxShadow: "inset 0 0 0 1px var(--c-danger)" } : controlStyle}
        />
        {nickError ? <div className="sans" style={fieldErrorStyle}>{nickError}</div> : null}
      </Field>

      <Field label="楽器種別(複数選択可)">
        <PillGroup
          options={SAX_TYPES} selected={saxTypes} onToggle={toggleSaxType}
          ariaPrefix="楽器種別" labelOf={(t) => SAX_LABELS[t]}
        />
      </Field>

      {saxTypes.length === 0 ? (
        // カタログは楽器種別ごとに分かれているので、種別が決まるまで楽器は引けない。
        // 引けない検索欄を出すより、何をすれば出るかだけを言う。
        <div className="sans" style={noteStyle}>楽器種別を選ぶと、種別ごとに入力欄が出ます</div>
      ) : null}

      {saxTypes.map((t) => (
        <div key={t} style={{ display: "grid", gap: "var(--sp-4)" }}>
          <div className="sans jp-label" style={gearHeadingStyle}>{SAX_LABELS[t]}</div>
          <GearPicker
            label="楽器" ariaPrefix={`${SAX_LABELS[t]}の楽器`}
            /* 【2026-09-02 本人裁定で補助文を削除】以前ここには探し方と
               「選ばなくても登録できます」が出ていた。後者は必須化で嘘になったので消し、
               前者も併せて落とした。**代わりの案内を足さないこと。**
               打つ手が分からない人の逃げ道は、常に見えている「カタログに無い(その他)」の
               ボタンが担っている(下の runSearch の結果が0件でも消えない)。 */
            value={gearPicks[t]?.instrument ?? null} onPick={(v) => setPick(t, "instrument", v)}
            /* カタログは種別ごとに分かれている(アルトの YAS-62 はテナーには無い)ので、
               この欄の種別をそのまま渡す。渡し違えると保存の瞬間に弾かれる。 */
            runSearch={(q) => searchInstrumentModels(q, t)}
          />
          <GearPicker
            label="マウスピース" ariaPrefix={`${SAX_LABELS[t]}のマウスピース`}
            value={gearPicks[t]?.mouthpiece ?? null} onPick={(v) => setPick(t, "mouthpiece", v)}
            runSearch={(q) => searchMouthpieces(q)}
          />
          <GearPicker
            label="リガチャー" ariaPrefix={`${SAX_LABELS[t]}のリガチャー`}
            value={gearPicks[t]?.ligature ?? null} onPick={(v) => setPick(t, "ligature", v)}
            runSearch={(q) => searchLigatures(q)}
          />
          <GearPicker
            label="リード" ariaPrefix={`${SAX_LABELS[t]}のリード`}
            value={gearPicks[t]?.reed ?? null} onPick={(v) => setPick(t, "reed", v)}
            runSearch={(q) => searchReeds(q)}
          />
          {/* 【番手はリードタブと同じピル行】2026/09/06 本人指示で追加。
              リードタブ(App.jsx)の箱は1枚ごとの番手を持つが、ここが持つのは
              「普段使っている番手」1つ。見た目の部品は App.jsx から借りて1つにする。
              【便R 2026-09-20】部品の名前が ReedStrengthPills → OptionPills になった
              (厚さ・枚数・楽器も同じ見た目を要るようになり、選択肢を引数で受ける形に畳んだ)。
              **ここが渡す選択肢と並びは REED_STRENGTHS のまま**で、見た目は1px も変わらない。 */}
          <Field label="リードの番手">
            <OptionPills options={REED_STRENGTHS} value={gearPicks[t]?.reedStrength ?? null} marginTop={0}
                         ariaPrefix="番手"
                         onChange={(v) => setPick(t, "reedStrength", v)} />
          </Field>
        </div>
      ))}

      {/* 【束4 2026-09-19 本人指示】「属性はダイヤルではなくジャンルなどの他と同様に
          選択肢をボタンで提示して選択式に変更」。**ジャンル・編成と同じ部品**をそのまま使う
          (新しい部品を作らない)。違いは「1つだけ選ぶ」ことだけなので、引数を1つ足した。
          押すたびに切り替わり(同じものを押し直すと外れる)、別のものを押すと前のが外れる。
          **保存される値は変えていない** ── 選ばなければ空文字のまま(select の "選択" と同じ)。 */}
      <Field label="属性">
        <PillGroup
          options={POSITIONS} selected={position ? [position] : []}
          onToggle={(p) => setPosition(position === p ? "" : p)}
          ariaPrefix="属性" single
        />
      </Field>

      <Field label="演奏開始年">
        {/* 【便O 2026-09-20 本人指示「印もつけて」】地を外したぶん、
            「押すと選択肢が開く」を ▾ が返す(§6.1.5 の裏返し ── 押せるものは
            押せると分かること)。上下を挟むのは属性とジャンルのピルなので、
            印が無いと年の値が文字として並んでいるようにしか見えない。
            【欄の寸法は1つも変えない】paddingRight を足していない ── 値は
            「2015年」の5字で、幅いっぱいの欄の左端に出るので ▾ と重ならない。
            【▾ は当たり判定を持たない】pointerEvents: none。押す先は <select> 1つだけで、
            押せる物が2つ重なる形を作らない。右端の位置は欄の左の余白と同じ --sp-3。 */}
        <div style={{ position: "relative", display: "grid" }}>
          <select value={startYear} onChange={(e) => setStartYear(e.target.value)} aria-label="演奏開始年" className="sans" style={controlPlainStyle}>
            <option value="">選択</option>
            {yearOptions.map((y) => <option key={y} value={y}>{y}年</option>)}
          </select>
          <span style={{
            position: "absolute", right: "var(--sp-3)", top: 0, bottom: 0,
            display: "flex", alignItems: "center", pointerEvents: "none",
          }}><PickChevron /></span>
        </div>
      </Field>

      <Field label="ジャンル(複数選択可)">
        <PillGroup options={GENRES} selected={genres} onToggle={toggle(genres, setGenres)} ariaPrefix="ジャンル" />
      </Field>

      <Field label="編成(複数選択可)">
        <PillGroup options={ENSEMBLES} selected={ensembles} onToggle={toggle(ensembles, setEnsembles)} ariaPrefix="編成" />
      </Field>


      <CheckRow checked={ageConfirmed} onChange={setAgeConfirmed}>13歳以上です</CheckRow>

      {error ? <div className="sans" role="alert" style={errorStyle}>{error}</div> : null}

      <button type="button" onClick={submit} disabled={busy} className="sans" style={{ ...primaryButtonStyle, opacity: busy ? 0.6 : 1 }}>
        {/* 【A-2 / F7 2026-09-15 本人裁定】ボタンの語は**押した先で起きること**。
            「作成」は何が作られるのかを言っていない。
            【この部品は編集でも使われている】initial があるときは同じボタンが
            「プロフィールを編集」の画面に出る(見出しの分岐と同じ initial)。
            裁定は**初回作成の語だけ**なので、編集側は busy の「保存中…」と揃えて「保存」。
            F7 の対象ではないので語を発明せず、既にこのボタンが名乗っている語を使う。 */}
        {busy ? "保存中…" : (initial ? "保存" : "プロフィールを作る")}
      </button>
      {onCancel ? (
        <button type="button" onClick={onCancel} disabled={busy} className="sans" style={secondaryButtonStyle}>
          やめる
        </button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------
// プロフィール表示。登録内容の一覧 + 公開トグル + 編集 + アカウント削除。
// ------------------------------------------------------------------
// 【押すと別の場所へ行く行 2026-09-10】参考にした他アプリの設定画面に寄せた形。
// Row(ラベルと値)とは役目が違う ── こちらは**押せる**。
// 地も枠も足さず、押せることは右端の山形だけで返す(§6.7)。
// 幅いっぱいが当たりになるので、横に並べた文字のリンクより押し分けやすい(§5)。
// 【C11・C12 2026-09-16】href か onClick(アプリの中のシートを開く)のどちらか。
// 以前あった external(別タブで開く)の経路は消した ── アプリの外へ出ると戻る手段が無く、
// 戻ると SPA が再起動する(理由は LegalSheet.jsx)。
// **href に target は付けない**(便H で target="_blank" はアプリから0件にしてある)。
//
// 【束3 2026-09-19】副題(sub)の受け口を消した。唯一の使い手だった「お問い合わせ」が
// mailto: をやめてアプリの中のフォームになり、**アドレスを写して使う必要が無くなった**ため
// (以前は「メールアプリを入れていない端末でも写せるように」という理由で出していた)。
// 受け口だけ残すと、次に行を足す人が「何のための副題か」を読めない死んだ引数になる。
function NavRow({ label, href = null, onClick = null, last = false }) {
  const style = {
    display: "flex", alignItems: "center", gap: "var(--sp-3)",
    width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
    minHeight: "var(--tap-min)", padding: "var(--sp-2) var(--sp-4)",
    borderBottom: last ? "none" : "1px solid var(--c-line)",
    color: "var(--c-ink)", fontSize: "var(--fs-sm)", fontWeight: 600,
    // 【下線を消す】これは文章の中のリンクではなく**行**。押せることは
    // 右端の山形だけで返す(§6.7)ので、下線は二重の印になる。
    textDecoration: "none",
  };
  const inner = (
    <>
      <span style={{ flex: "1 1 0", minWidth: 0 }}>{label}</span>
      <RowChevron />
    </>
  );
  if (href) return <a href={href} className="sans" style={style}>{inner}</a>;
  return <button type="button" onClick={onClick} className="sans" style={style}>{inner}</button>;
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "baseline", padding: "var(--sp-2) 0", borderBottom: "1px solid var(--c-line)" }}>
      <div className="sans jp-label" style={{ ...labelStyle, flex: "0 0 6.5em" }}>{label}</div>
      <div className="sans" style={{ ...bodyStyle, flex: "1 1 0", minWidth: 0 }}>{value}</div>
    </div>
  );
}

// 【区切りは記号ではなく余白 2026/09/08 本人裁定「中黒は廃止」】
// §6.0 囲いの序列「1. 余白で分ける」。幅は WhoLine と同じ 9px に揃える。
// WhoLine(screens.jsx)は前から余白だったのに、ここだけ中黒のままだった。
const listOrDash = (a) => (Array.isArray(a) && a.length > 0
  ? <span style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>{a.map((v) => <span key={v}>{v}</span>)}</span>
  : "—");

export function ProfileView({ profile, onEdit, onTogglePublic, onChangeAvatar, onDelete, onOpenBackup, flaggedMe = false, uid = null, myIdeals = null }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // 【C11・C12】規約・ポリシーのシート("terms" | "privacy" | null)
  const [legal, setLegal] = useState(null);
  // 【束3 2026-09-19】お問い合わせのシート(アプリの中のフォーム)。
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // 【B-3 / T7 2026-09-15 本人裁定】削除の確認は window.confirm ではなくシート1枚。
  // 確認の文には**何が消えて何が残るか**が要り、confirm は1行しか持てない。
  const [deleteOpen, setDeleteOpen] = useState(false);
  // 【M2 2026-09-19】アイコンを選び直すシート。下書きはシートの中だけで動かし、
  // 閉じたときに**変わっていたら1回だけ**書く。
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState({ icon: null, iconColor: null });
  const gear = profile?.gear ?? {};
  // 表示順は SAX_TYPES の並びに揃える(保存されている配列の順に依らず同じ画面になる)。
  const types = SAX_TYPES.filter((t) => (profile?.saxTypes ?? []).includes(t));
  const isPublic = profile?.isPublic !== false;

  // 【M2】開くときに今の値を下書きへ写す(シートを閉じて開き直しても、
  // いつも「いま保存されている絵柄」から始まる)。
  const openAvatar = () => {
    setAvatarDraft({
      icon: profile?.icon ?? AVATAR_ICONS[0],
      iconColor: profile?.iconColor ?? AVATAR_COLOR_MIN,
    });
    setAvatarOpen(true);
  };
  const closeAvatar = async () => {
    setAvatarOpen(false);
    const same = avatarDraft.icon === (profile?.icon ?? AVATAR_ICONS[0])
      && avatarDraft.iconColor === (profile?.iconColor ?? AVATAR_COLOR_MIN);
    if (same || !onChangeAvatar) return;   // 変わっていなければ書かない
    setError(null);
    try {
      await onChangeAvatar({ icon: avatarDraft.icon, iconColor: avatarDraft.iconColor });
    } catch (e) {
      // 公開設定と同じ作法 ── 失敗したら画面の絵柄は元のまま(profile が唯一の正)で、
      // この文言と一致する。
      console.error("[community] アイコンの変更に失敗", e?.code, e);
      setError(AVATAR_ERROR);
    }
  };

  const togglePublic = async (v) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await onTogglePublic(v);
    } catch (e) {
      // 【スイッチの見た目は profile.isPublic が決める】users を書く前に失敗したときは
      // 元の位置に戻り、この文言(「変更できませんでした」)と一致する。
      // users を書いた後に失敗しうるのは「公開に戻したが目安を出し直せなかった」場合だけで、
      // そのときスイッチは新しい位置のまま ── 公開設定そのものは変わっているのでそれが正しい。
      // 目安は次にタブを開いたときの effect が出し直す。
      console.error("[community] 公開設定の変更に失敗", e?.code, e);
      setError(toggleErrorOf(e));
    } finally {
      setBusy(false);
    }
  };

  // 【B-3】消えるもの・外から見えなくなるもの・残るものは**シートが**言い切る。
  // ここは「押されたら消す」だけ(確認は器の側が済ませている)。
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(DELETE_ERROR); // ボタンは残るので、そのまま押し直せる
      setBusy(false);
    }
    // 成功時はこの要素ごと消えるので busy は戻さない(戻す先が無い)
  };

  // 【B-3】「非公開にする」= 公開スイッチを切るのと**同じ一手**。別の道を作らない。
  // 目安の公開の取り消しまで togglePublic(→ onTogglePublic)が引き受ける。
  const goPrivate = async () => {
    await togglePublic(false);
    setDeleteOpen(false);
  };
  // 外から見えなくなるもの。目安の**本体はこの端末**にあり、消えるのは
  // サーバーの公開コピーだけ(accountRepo の unpublishAllIdeals)。「消える」と書かない。
  const publicIdealCount = Object.keys(myIdeals ?? {}).length;

  return (
    <div className="sans" style={pageStyle}>

      {/* 【計画5 2026-09-10】通報で隠れているときの告知。
          設計書 §8.1 の追記1「黙って消さない」。**一番上に置く** ── 下に置くと、
          プロフィールを見に来ただけの人が気づかずに閉じる。
          地は --c-warn-bg(§1.5 が名前を与えている警告の面)。危険色は使わない ──
          本人が何かを失ったわけではなく、確認待ちの状態にすぎない。
          【連絡先へ送る 2026-09-10】設計書 §8.1 追記1「黙って消さない」の要点は、
          消された側に**道を残す**こと。行き先はこのページの下にある。 */}
      {flaggedMe ? (
        <div role="status" style={{
          background: "var(--c-warn-bg)", borderRadius: "var(--r-md)",
          padding: "var(--sp-3) var(--sp-4)", fontSize: "var(--fs-sm)",
          color: "var(--c-ink)", lineHeight: 1.7,
        }}>
          通報があったため、あなたのプロフィールは一時的に他の人から見えなくなっています。
          運営が内容を確認し、問題がなければ元に戻します。
          お急ぎの場合は、このページ下部の「お問い合わせ」からご連絡ください。
        </div>
      ) : null}
      {/* 【見出しは置かない 2026/09/06 本人指示】子タブの「マイページ」が既に
          どこに居るかを言っている。同じことを2度言わない(説明は減らす方向)。 */}

      {/* 名前より先にアイコンを出す。順位や一覧では絵柄で人を探すので、
          自分がどう見えているかが最初に分かるようにする。
          【M2 / M3 2026-09-19 本人指示】**ここが編集の導線**になった
          (「プロフィール画面でアイコンをタップしたら変更できるように」)。
          押せることは**右下の小さな印**が返す(本人の添付画像の形。絵柄は
          カメラではなく鉛筆)。当たり判定は 64 の円そのもので --tap-min を超える。
          押すと選び直すシートが開くので、状態は aria-expanded で返す。 */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <button
          type="button"
          onClick={openAvatar}
          aria-label="アイコンを変更"
          aria-expanded={avatarOpen}
          style={{
            position: "relative", display: "inline-flex", padding: 0,
            background: "none", border: "none", borderRadius: "var(--r-full)", cursor: "pointer",
          }}
        >
          <Avatar icon={profile?.icon ?? AVATAR_ICONS[0]} color={profile?.iconColor ?? AVATAR_COLOR_MIN} size={64} />
          <span aria-hidden="true" style={{
            position: "absolute", right: 0, bottom: 0,
            width: AVATAR_EDIT_BADGE_PX, height: AVATAR_EDIT_BADGE_PX, borderRadius: "var(--r-full)",
            background: "var(--c-ink)", color: "var(--c-surface)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <Pencil size={13} strokeWidth={1.9} />
          </span>
        </button>
      </div>

      {/* 【M2】絵柄を選び直すシート。**部品は編集フォームが使っていた AvatarPicker
          そのもの**(選び方を2つ作らない)。書き込みは**閉じたときの1回だけ**で、
          絵柄と色を続けて選んでも users への書き込みは1回になる
          (リードの点数のダイアログと同じ手)。変わっていなければ書かない。 */}
      {avatarOpen && (
        <BottomSheet ariaLabel="アイコンを変更" onClose={closeAvatar}>
          <AvatarPicker
            icon={avatarDraft.icon}
            color={avatarDraft.iconColor}
            onChange={(v) => setAvatarDraft({ icon: v.icon, iconColor: v.color })}
          />
        </BottomSheet>
      )}

      <div>
        <Row label="ニックネーム" value={profile?.nickname ?? "—"} />
        <Row label="楽器種別" value={listOrDash(types.map((t) => SAX_LABELS[t]))} />
        {/* 楽器の組は楽器種別ごとに1組。どの楽器の楽器の組かが分からないと読めないので、
            種別の見出しを挟んでから3行を出す。 */}
        {types.map((t) => {
          const g = gear[t] ?? {};
          return (
            <React.Fragment key={t}>
              <div className="sans jp-label" style={{ ...gearHeadingStyle, padding: "var(--sp-3) 0 var(--sp-1)" }}>{SAX_LABELS[t]}</div>
              <Row label="楽器" value={gearLabel({ brand: g.instrumentBrand, model: g.instrumentModel })} />
              <Row label="マウスピース" value={gearLabel({ brand: g.mpBrand, model: g.mpModel })} />
              <Row label="リガチャー" value={gearLabel({ brand: g.ligBrand, model: g.ligModel })} />
              <Row label="リード" value={reedLabel(g)} />
            </React.Fragment>
          );
        })}
        <Row label="属性" value={profile?.position ?? "—"} />
        <Row label="演奏開始年" value={profile?.startYear ? `${profile.startYear}年` : "—"} />
        <Row label="ジャンル" value={listOrDash(profile?.genres)} />
        <Row label="編成" value={listOrDash(profile?.ensembles)} />
      </div>

      <SwitchRow
        checked={isPublic} onChange={togglePublic} disabled={busy}
        label="公開"
        note="プロフィールと奏者：自分のデータが公開されます"
      />

      {/* 【B-3】削除のシートを開いている間は、まとめの側に出さない
          ── DELETE_ERROR はシートの中(押したボタンの隣)に出す。 */}
      {error && !deleteOpen ? <div className="sans" role="alert" style={errorStyle}>{error}</div> : null}

      {/* 【並び C10 2026-09-16 実機の指摘】公開スイッチ → error → お問い合わせ / 規約 / ポリシー → uid →
          編集 → アカウント引継 → アカウントを削除。**破壊的な一手が最後**は保ったまま、
          自分のアカウントを動かす3つ(編集・引継・削除)を続けて最下部に置く。 */}

      {/* 【計画5 2026-09-10 / 参考にした他アプリの設定画面に寄せた 2026-09-10】
          お問い合わせと法務文書。
          通報で隠された人が「お急ぎの場合は…」で辿り着く先でもあるので、
          告知(このページの一番上)と同じページの中に無いと導線が切れる。
          【素のリンクを並べるのをやめた】以前は文字のリンク3つを横に並べていたが、
          横に並ぶぶん**1つあたりの当たりが狭く**、押し分けにくかった。
          行にすれば幅いっぱいが当たりになる(§5)。押せることは右端の山形だけで返す(§6.7)。
          【C11・C12 2026-09-16】規約・ポリシーはアプリの中のシート(LegalSheet)。外へ出ない。 */}
      <div className="card" style={{ padding: 0, marginTop: "var(--sp-4)" }}>
        {/* 【束3 2026-09-19 本人指示】レビューの行は**お問い合わせの上**。
            飛び先(APP_STORE_REVIEW_URL)が決まるまでは**行ごと出さない** ──
            押しても何も起きない一手を並べない(§6.1.5)。理由と埋め方は support.js。 */}
        {APP_STORE_REVIEW_URL ? <NavRow label="レビューを送る" href={APP_STORE_REVIEW_URL} /> : null}
        {/* 【束3 2026-09-19 本人指示】メールへ飛ばすのをやめ、アプリの中のフォームを開く。
            アドレスの副題は出さない ── フォームで送るので写す先が無い。 */}
        <NavRow label="お問い合わせ" onClick={() => setFeedbackOpen(true)} />
        <NavRow label="利用規約" onClick={() => setLegal("terms")} />
        <NavRow label="プライバシーポリシー" onClick={() => setLegal("privacy")} last />
      </div>

      {/* 【匿名アカウントの識別子を出す 2026-09-10】
          **これが無いと問い合わせが成立しない。** このアプリのアカウントは匿名で、
          名前もメールアドレスも運営者側に無い。「通報されたので確認してほしい」と
          連絡が来ても、運営者は**その人をコンソールで見つけられない**。
          利用者が自分の識別子を写して送れる形が要る(参考にした他アプリも設定の末尾に出していた)。
          読ませる文章ではないので --c-ink-3。 */}
      {uid ? (
        <div className="sans" style={{
          fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", textAlign: "center",
          wordBreak: "break-all", marginTop: "var(--sp-2)",
        }}>{uid}</div>
      ) : null}

      <button type="button" onClick={onEdit} disabled={busy} className="sans" style={{ ...secondaryButtonStyle, marginTop: "var(--sp-4)" }}>
        編集
      </button>

      {/* 【アカウント引継】「編集」と同じ体裁(secondaryButtonStyle)の一手を1つ増やすだけ。
          説明は付けない ── 押せば中身が出るものに、押す前の説明は要らない。
          並びは「アカウントを削除」より上。**破壊的な一手が最後**という並びを崩さない。 */}
      <button type="button" onClick={onOpenBackup} disabled={busy} className="sans" style={secondaryButtonStyle}>
        アカウント引継
      </button>

      {/* 【説明はボタンの下に置かない 2026/09/06 本人指示】常時出していた一文は
          削除の確認へ移した(2026-09-15 にその確認がシートになった)。 */}
      <div style={{ display: "grid", marginTop: "var(--sp-4)" }}>
        <button type="button" onClick={() => setDeleteOpen(true)} disabled={busy} className="sans" style={{ ...dangerButtonStyle, opacity: busy ? 0.6 : 1 }}>
          アカウントを削除
        </button>
      </div>

      {legal ? <LegalSheet kind={legal} onClose={() => setLegal(null)} /> : null}
      {feedbackOpen ? <FeedbackSheet onClose={() => setFeedbackOpen(false)} /> : null}

      {/* 【B-3 / T7 2026-09-15 本人裁定】削除の確認。器はアプリで1つの BottomSheet。
          【「戻せるか」の行は置かない】本人裁定。戻せないことは「消えるもの」の行が
          既に言っており、もう一度言うと読む量だけが増える。
          【「消える」と「見えなくなる」を言い分ける】目安の本体はこの端末にあり、
          サーバーの公開コピーだけが消える。まとめて「消える」と書かない。 */}
      {deleteOpen ? (
        <BottomSheet ariaLabel="アカウントを削除しますか" onClose={() => setDeleteOpen(false)}>
          <div className="sans" style={{ ...titleStyle, marginBottom: "var(--sp-2)" }}>アカウントを削除しますか</div>
          <Row label="消えるもの" value={`ニックネーム「${profile?.nickname ?? "—"}」・プロフィール`} />
          {publicIdealCount > 0 ? (
            <Row label="外から見えなくなるもの" value={`公開している目安 ${publicIdealCount}件`} />
          ) : null}
          <Row label="残るもの" value="この端末の計測・リード・目安の記録" />
          {/* 区切り(Row の罫)の下に、削除以外の道を1行だけ。 */}
          <div className="sans" style={{ ...noteStyle, padding: "var(--sp-3) 0" }}>
            外部公開を停止したい場合は、削除せずに非公開にできます
          </div>
          {error ? <div className="sans" role="alert" style={errorStyle}>{error}</div> : null}
          <div style={{ display: "grid", gap: "var(--sp-2)", marginTop: "var(--sp-2)" }}>
            {/* 【すでに非公開なら出さない】押しても何も変わらない一手を並べない。 */}
            {isPublic ? (
              <button type="button" onClick={goPrivate} disabled={busy} className="sans" style={secondaryButtonStyle}>
                非公開にする
              </button>
            ) : null}
            <button type="button" onClick={remove} disabled={busy} className="sans" style={{ ...dangerButtonStyle, opacity: busy ? 0.6 : 1 }}>
              アカウントを削除する
            </button>
          </div>
        </BottomSheet>
      ) : null}
    </div>
  );
}
