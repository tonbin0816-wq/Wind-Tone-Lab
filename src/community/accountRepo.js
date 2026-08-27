import { signInAnonymously, onAuthStateChanged, deleteUser, signOut } from "firebase/auth";
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { getFirebase } from "./firebaseClient.js";

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

export async function saveProfile(uid, profileDoc) {
  await setDoc(userRef(uid), profileDoc);
}

export async function loadProfile(uid) {
  const snap = await getDoc(userRef(uid));
  return snap.exists() ? snap.data() : null;
}

export async function setProfilePublic(uid, isPublic) {
  await updateDoc(userRef(uid), { isPublic: !!isPublic });
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
