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

// 【便Q 2026-09-20 本人報告「順位タブに今まであった自分のデータが表示されなくなった」】
// **merge を外すと順位から自分が消える。** buildProfileDoc が返すのは 13キーで、
// その中に stats(練習日数・練習時間)は**入っていない** ── 練習記録はプロフィールとは
// 別の機会(タブを開いたとき)に publishStats が書き足すものだから。
// 素の setDoc は文書まるごとの置き換えなので、保存するたびにサーバ上の stats が消えていた。
// 順位は stats を持つ人だけを並べる(aggregate.js の `if (!s) continue;`)ので、
// **プロフィールを保存した人がその場で順位から落ちる。**
//
// 引き金は束6 の属性の語替え ── 旧語で登録していた人の属性が未選択になり、
// 選び直して保存した。保存の作りは前からこうで、今回の語替えが初めて踏ませた。
//
// merge で残るのは stats と places の2つだけ(どちらも firestore.rules の hasOnly に在る)。
// 13キーは毎回すべて書き直されるので、外した選択肢が居残ることは無い
// (配列は merge でも丸ごと置き換わる)。
export async function saveProfile(uid, profileDoc) {
  await setDoc(userRef(uid), profileDoc, { merge: true });
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
export async function setProfileAvatar(uid, { icon, iconColor }) {
  await updateDoc(userRef(uid), { icon, iconColor });
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
