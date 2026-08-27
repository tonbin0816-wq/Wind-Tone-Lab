import { signInAnonymously, onAuthStateChanged, deleteUser } from "firebase/auth";
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

// spec §8: アカウント削除はアプリ内から完全削除できることが必須(匿名でも適用)
export async function deleteAccount() {
  const { auth } = getFirebase();
  const user = await currentUser();
  if (!user) return;
  await deleteDoc(userRef(user.uid));
  await deleteUser(user);
}
