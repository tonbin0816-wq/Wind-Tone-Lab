import { signInAnonymously, onAuthStateChanged, deleteUser, signOut } from "firebase/auth";
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { getFirebase } from "./firebaseClient.js";
import { unpublishAllIdeals } from "./idealRepo.js";

function currentUser() {
  const { auth } = getFirebase();
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); });
  });
}

// 現在のサインイン状態を返すだけ。**アカウントは作らない。**
// コミュニティタブを開いただけで signInAnonymously が走ると、参加の説明文
// (「参加すると匿名のアカウントが作られます」)を読んでいる時点で既にアカウントが
// 存在することになり、覗いて去った人にもアカウントが残る。
// タブの初期表示はこちらを使い、ensureSignedIn は参加を押してから呼ぶ。
export async function getSignedInUid() {
  const user = await currentUser();
  return user ? user.uid : null;
}

export async function ensureSignedIn() {
  const { auth } = getFirebase();
  const existing = await currentUser();
  if (existing) return existing.uid;
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}

const userRef = (uid) => doc(getFirebase().db, "users", uid);

// プロフィールの保存。**文書まるごとの置き換え**で、練習記録(stats)だけを持ち越す。
//
// 【merge を使ってはいけない ── 便W 2026-09-21 本人報告「サーバーに保存を拒否されました」】
// 便Q で「stats が消える」を直すために `{ merge: true }` にしたが、**これが別のバグを作った。**
// merge は**入れ子の辞書をキーごとに混ぜる**。`gear` は楽器種別をキーにした辞書なので、
// 楽器種別を1つ外して保存しても、**サーバ側には外した種別の組が残り続ける**。
// firestore.rules は
//   gear.keys().hasOnly(saxTypes) / hasAll(saxTypes) / saxTypes.size() == gear.keys().size()
// の3つで「キー集合が saxTypes と完全に一致すること」を要求するので、居残った1つで
// **その後の保存が永久に拒否される**(バリトンを足して外した本人の端末がこの状態になった)。
// 便Q の注記は「配列は merge でも丸ごと置き換わる」とだけ書いて、**辞書を見落としていた**。
//
// 【だから置き換えに戻し、stats は自分で持ち越す】
// buildProfileDoc が返すのは13キーで stats を含まない ── 練習記録はプロフィールとは別の
// 機会(タブを開いたとき)に publishStats が書き足すものだから。置き換えるだけだと消え、
// 順位は stats を持つ人だけを並べる(aggregate.js の `if (!s) continue;`)ので
// 保存した人がその場で順位から落ちる(便Q の症状)。だから**書く前に1回読んで連れて行く**。
//
// 【places は連れて行かない】2026/09/06 に廃止した項目で、クライアントはもう書かない。
// ルールは「在るなら中身を見る」の形なので、**無くなるぶんには通る**。
// 置き換えのついでに古い項目が落ちるのは、こちらの望む向き。
//
// 【読みが失敗したら stats 無しで書く】保存そのものを止めない。順位は次にタブを開いた
// ときの publishStats が書き直す。**保存できないことのほうが利用者にとって重い。**
// 【便AH 2026-09-23 写真も連れて行く】stats とまったく同じ理由。置き換えるだけだと
// **プロフィールを編集した瞬間に写真が消える**(クライアントは写真の値を書けないので、
// 一度消えたら二度と戻せない ── 決定6)。だから書く前の1回の読みで一緒に連れて行く。
// firestore.rules は「写真は null か、**いま載っている値と同じ**ときだけ通す」形にして
// あるので、この持ち越しは通り、新しい値を入れることは相変わらずできない。
export async function saveProfile(uid, profileDoc) {
  let carried = null;
  let carriedPhoto = null;
  try {
    const snap = await getDoc(userRef(uid));
    const prev = snap.exists() ? snap.data() : null;
    if (prev && prev.stats) carried = prev.stats;
    if (prev && typeof prev.photo === "string" && prev.photo.length > 0) carriedPhoto = prev.photo;
  } catch (e) {
    // 【黙って捨てない】読めなかった事実は残す。文言は出さない(保存は続ける)。
    console.error("[community] 保存前の練習記録の読み出しに失敗", e?.code, e);
  }
  const next = { ...profileDoc };
  if (carried) next.stats = carried;
  if (carriedPhoto) next.photo = carriedPhoto;
  await setDoc(userRef(uid), next);
}

export async function loadProfile(uid) {
  const snap = await getDoc(userRef(uid));
  return snap.exists() ? snap.data() : null;
}

export async function setProfilePublic(uid, isPublic) {
  await updateDoc(userRef(uid), { isPublic: !!isPublic });
}

// 【M 2026-09-19 本人指示】アイコンの変更はプロフィールの**表示画面**から行う
// (編集フォームからは外した)。setProfilePublic と同じく updateDoc で2つのキーだけを
// 差し替える ── setDoc の全置換だと他の項目を巻き添えにする。
// ルールは「書いた結果のドキュメント全体」を見るので、icon / iconColor の検査
// (絵柄の集合・色は 1〜10 の整数)はそのまま効く。**ルールの変更は要らない。**
// 【便AH 2026-09-23 決定4「絵柄に戻す導線は作らない」】
// 格子で絵柄を選び直せば戻る ── つまり**絵柄を選ぶことが写真を消すこと**である。
// 「写真をやめる」ボタンを作らない代わりに、写真を消す意図を **photo: null** で受ける。
//
// 【photo が値を持っているなら、写真のキーを1文字も書かない ── 重2 の直し】
// 2026-09-23 審査役の指摘。以前はここが**無条件に null を書いていた**ので、
//   ① 色を押す → ② 写真を選んで成功 → ③ 閉じる
// の順で、③ が「色が変わった」ことだけを理由に呼ばれ、**いま載せたばかりの写真を
// 消していた**(掃除の関数が Storage の実体まで消す)。消す意図は呼び出し側が
// 明示する ── 下書きに写真が載っているなら、それは「消す」ではない。
// null はクライアントが書ける唯一の値(決定6)なので、消す側の経路はルールを通る。
export async function setProfileAvatar(uid, { icon, iconColor, photo = null }) {
  const patch = { icon, iconColor };
  if (photo === null) patch.photo = null;
  await updateDoc(userRef(uid), patch);
}

// spec §8: アカウント削除はアプリ内から完全削除できることが必須(匿名でも適用)。
//
// 【順序は deleteDoc → deleteUser で固定】auth ユーザーを先に消すと、
// Firestore ルールの `request.auth.uid == uid` が満たせなくなり doc を消せなくなる。
// つまり「公開プロフィールだけがサーバーに残り、本人には二度と消せない」状態になる。
//
// 【deleteUser の失敗を握りつぶしてサインアウトする理由】
// deleteUser は最後のサインインから時間が経っていると auth/requires-recent-login を投げる。
// 通常のアカウントなら再認証すれば済むが、**匿名ユーザーは再認証の手段を持たない**ため、
// この失敗はその端末で永久に解消しない。ここで例外を投げて「もう一度削除を押してください」と
// 案内すると、押すたびに同じ所で失敗する行き止まりになる(5.1.1(v) を満たせない)。
// 利用者のデータ(= Firestore の doc)は既に消えているので、残っているのは
// 中身の無い匿名の資格情報だけである。サインアウトして未参加の状態へ戻すのが正しい終わり方。
//
// 返り値の credentialRemoved で、資格情報まで消せたかどうかを呼び出し側に伝える
// (画面の文言を「実際に起きたこと」に合わせるため)。
export async function deleteAccount() {
  const { auth } = getFirebase();
  const user = await currentUser();
  if (!user) return { credentialRemoved: true };
  // 【目安を先に消す】画面は「サーバー上のプロフィールと匿名アカウントが完全に消えます」
  // と言っている。users だけ消して ideals/{uid}_{種別} を残すと、その言葉が嘘になる。
  // 順序が deleteDoc(users) より前なのは deleteUser の前後と同じ理由 ── ideals の
  // 削除規則も request.auth.uid == resource.data.ownerUid を要求するので、
  // 資格情報を失った後では二度と消せない。ここが失敗したら users も消さずに
  // 例外を投げる(「まだ何も消えていない」という案内が嘘にならない)。
  await unpublishAllIdeals(user.uid);
  await deleteDoc(userRef(user.uid)); // ここが失敗したら何も消えていないので例外はそのまま投げる
  try {
    await deleteUser(user);
    return { credentialRemoved: true };
  } catch {
    // サインアウト自体はローカル状態の破棄なので、通信が死んでいても成立する。
    // 万一失敗しても「データは消えている」という事実は変わらないので握りつぶす。
    await signOut(auth).catch(() => {});
    return { credentialRemoved: false };
  }
}
