// IndexedDB の中身をまるごと読み書きする。書き出し・読み戻しのためだけに使う。
// 通常のアプリの読み書きは App.jsx 側の usePersistedState / useSessionsStore が担う。
// **DB名・ストア名は App.jsx から import する。2箇所に書くと必ずずれる。**
//
// クラウドには一切触らない。Firestore にも認証にも触れず、その手の module を1つも import しない。
//
// 【App.jsx との循環 import について】App.jsx → BackupPanel.jsx → localStore.js → App.jsx。
// ここが App.jsx から取るのは**呼び出し時にしか読まない**もの(関数宣言と、関数の中でしか
// 参照しない定数)だけなので、モジュールの評価順に依存しない。
// ここでトップレベルに `const X = IDB_STORE` のような**読み取り**を書かないこと
// (循環の途中では未初期化になり得る)。
import { IDB_STORE, SESSIONS_STORE, openIdb } from "../App.jsx";

// kv ストアと sessions ストアを**1つの読み取りトランザクション**で読む。
// 途中で片方だけ新しくなった中間状態を書き出さないため(分けて読むと、その隙に
// 録音が1件保存されるとセッションと設定の辻褄が合わない写しができる)。
//
// 失敗は握り潰さず投げる。App.jsx の idbGet / idbGetAllSessions は「読めなければ
// 初期値で画面を出す」ために例外を飲むが、書き出しで同じことをすると
// **中身が空のバックアップができて、しかも成功したように見える**。これがいちばん危ない。
export async function readAll() {
  const db = await openIdb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORE, SESSIONS_STORE], "readonly");
    const kvStore = tx.objectStore(IDB_STORE);
    // kv は keyPath を持たないストア(値と鍵が別)なので、鍵と値を別々に取って組み直す。
    // getAllKeys と getAll はどちらも鍵の昇順で返るので、同じ添字が対応する。
    const keysReq = kvStore.getAllKeys();
    const valuesReq = kvStore.getAll();
    const sessionsReq = tx.objectStore(SESSIONS_STORE).getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result || [];
      const values = valuesReq.result || [];
      const kv = {};
      keys.forEach((k, i) => { kv[k] = values[i]; });
      resolve({ kv, sessions: sessionsReq.result || [] });
    };
    tx.onerror = () => reject(tx.error || new Error("読み取りに失敗しました"));
    tx.onabort = () => reject(tx.error || new Error("読み取りが中断されました"));
  });
}

// 既存を全消しして書き戻す。**破壊的**。呼ぶ前に必ず人へ確認を取ること。
//
// 全消しと書き込みを**1つのトランザクション**でやるのが要点。途中で失敗しても
// IndexedDB がまるごと巻き戻すので、「消えたが戻らなかった」が構造的に起きない。
// 途中の put が同期例外を投げた場合も、自分で abort してから投げ直す
// (投げっぱなしにするとトランザクションはそのまま commit され、消しただけで終わる)。
export async function writeAll({ kv, sessions }) {
  const db = await openIdb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORE, SESSIONS_STORE], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("書き込みに失敗しました"));
    tx.onabort = () => reject(tx.error || new Error("書き込みが中断されました"));
    try {
      const kvStore = tx.objectStore(IDB_STORE);
      const sessionsStore = tx.objectStore(SESSIONS_STORE);
      kvStore.clear();
      sessionsStore.clear();
      for (const [key, value] of Object.entries(kv ?? {})) kvStore.put(value, key);
      // sessions は keyPath:"id" のストア。id を持たないレコードは put が例外を投げ、
      // 下の catch で全体が巻き戻る(黙って捨てない ── 捨てるとその1件だけ静かに失われる)。
      for (const s of Array.isArray(sessions) ? sessions : []) sessionsStore.put(s);
    } catch (e) {
      try { tx.abort(); } catch { /* 既に中断済みなら何もしない */ }
      reject(e);
    }
  });
}

// ブラウザに「この保存領域を勝手に消さないでほしい」と申請する。
// Chrome は利用実績などから自動で判断し、Safari は7日間未使用で消す既定を持つ。
// 申請が通らなくても致命的ではないので、結果は表示に使うだけで処理は止めない。
export async function requestPersistence() {
  if (!navigator.storage?.persist) return "unsupported";
  try {
    if (await navigator.storage.persisted?.()) return "granted";
    return (await navigator.storage.persist()) ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usageMB: (usage ?? 0) / 1048576, quotaMB: (quota ?? 0) / 1048576 };
  } catch {
    return null;
  }
}
