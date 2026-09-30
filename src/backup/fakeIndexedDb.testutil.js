// ------------------------------------------------------------------
// 検査用の小さな IndexedDB の作り物。【便BE 2026-09-30】
//
// jsdom には indexedDB が無いので、App.jsx の usePersistedState(保存)と backup/localStore.js の
// readAll / writeAll(アカウント引継の書き出し・読み戻し)が**同じ入れ物**を読み書きする姿を、
// 実物のまま走らせるために置く。アプリが使う API だけを持つ:
//   indexedDB.open(name, version) → onupgradeneeded / onsuccess
//   db.objectStoreNames.contains / db.createObjectStore(name, { keyPath })
//   db.transaction(names, mode) → objectStore(name) / oncomplete / onerror / onabort / abort()
//   store.get / put / clear / getAll / getAllKeys
// 値は structuredClone で写す(本物も値を複製して持つ ── 呼び手の配列を後から書き換えても中身は変わらない)。
// 鍵は昇順で返す(本物と同じ。readAll は getAllKeys と getAll の添字が対応することに頼っている)。
// **本番のコードからは import しないこと**(名前が .test で終わらないので収集はされない)。
// ------------------------------------------------------------------
export function createFakeIndexedDb() {
  const dbs = new Map(); // name -> Map(storeName -> { keyPath, data: Map })

  const later = (fn) => setTimeout(fn, 0);
  const sortKeys = (keys) => [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  function openDb(name) {
    if (!dbs.has(name)) dbs.set(name, new Map());
    const stores = dbs.get(name);
    return {
      objectStoreNames: { contains: (n) => stores.has(n) },
      createObjectStore(n, opts = {}) {
        stores.set(n, { keyPath: opts.keyPath ?? null, data: new Map() });
      },
      transaction(names, mode = "readonly") {
        const list = Array.isArray(names) ? names : [names];
        let pending = 0;
        let finished = false;
        let aborted = false;
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
        const settle = () => {
          if (finished || pending > 0) return;
          finished = true;
          later(() => { if (!aborted) tx.oncomplete?.(); });
        };
        tx.abort = () => {
          if (aborted) return;
          aborted = true; finished = true;
          later(() => tx.onabort?.());
        };
        // 書き込みは transaction の中の写し(staged)に当てつつ手順(ops)を控え、完了のときに
        // **本物の中身へ手順だけを当て直す**(途中の abort では何も当てない = 巻き戻る)。
        // 読むだけの transaction は何も書き戻さない ── 写しを丸ごと書き戻すと、並んで走った
        // 書き込みを古い写しで潰してしまう(本物の IndexedDB では起きない。最初の版がこれを踏んでいた)。
        const staged = new Map(list.map((n) => [n, new Map(stores.get(n)?.data ?? [])]));
        const ops = [];
        const request = (compute) => {
          const req = { result: undefined, error: null, onsuccess: null, onerror: null };
          pending += 1;
          later(() => {
            pending -= 1;
            if (aborted) return;
            try { req.result = compute(); req.onsuccess?.(); } catch (e) { req.error = e; req.onerror?.(); }
            settle();
          });
          return req;
        };
        tx.objectStore = (n) => {
          if (!list.includes(n) || !stores.has(n)) throw new Error(`NotFoundError: ${n}`);
          const meta = stores.get(n);
          const data = staged.get(n);
          return {
            get: (k) => request(() => (data.has(k) ? structuredClone(data.get(k)) : undefined)),
            getAll: () => request(() => sortKeys(data.keys()).map((k) => structuredClone(data.get(k)))),
            getAllKeys: () => request(() => sortKeys(data.keys())),
            clear: () => request(() => { data.clear(); ops.push({ n, op: "clear" }); }),
            put: (value, key) => {
              const k = meta.keyPath ? value?.[meta.keyPath] : key;
              if (k === undefined) throw new Error("DataError: 鍵がありません");
              const copy = structuredClone(value);
              return request(() => { data.set(k, copy); ops.push({ n, op: "put", k, v: copy }); return k; });
            },
          };
        };
        const origComplete = () => {
          if (mode !== "readwrite") return;
          for (const o of ops) {
            const live = stores.get(o.n).data;
            if (o.op === "clear") live.clear();
            else live.set(o.k, structuredClone(o.v));
          }
        };
        // oncomplete の直前に反映する(読み取りだけの transaction でも同じ中身を書き戻すだけ)。
        Object.defineProperty(tx, "oncomplete", {
          get() { return this._oc; },
          set(fn) { this._oc = fn ? () => { origComplete(); fn(); } : () => origComplete(); },
          configurable: true,
        });
        tx.oncomplete = null;
        later(settle);
        return tx;
      },
      close() {},
    };
  }

  return {
    open(name, _version) {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      later(() => {
        const fresh = !dbs.has(name);
        req.result = openDb(name);
        if (fresh) req.onupgradeneeded?.();
        else req.onupgradeneeded?.(); // App.jsx の onupgradeneeded は「無ければ作る」なので何度呼んでもよい
        req.onsuccess?.();
      });
      return req;
    },
    // 検査から中身を直に覗く・仕込むための口(本物には無い)。
    _peek(name, store) { return dbs.get(name)?.get(store)?.data ?? null; },
  };
}
