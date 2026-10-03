// 【便BP3 2026-10-03 本人の依頼】はじめの一手の見本の合図。
//
// 本人は計測もリードも参加も済んでいるので、本物の印では案内が1つも出ず、見て確かめられない。
// 便BL の見本の広告の帯(adPreview.js)と同じ作りで、合図を付けた端末でだけ**全部の一手を「まだ」として**出す。
//
//   ・URL に ?tutorialpreview=1 … この端末に覚える(以後は URL に付けなくても見本になる)
//   ・URL に ?tutorialpreview=0 … 覚えたのを消す
//   ・どちらでもない             … 覚えているとおり(覚えていなければ見本にしない)
//   ・合図を読んだら、URL からその問い合わせだけを消す(history.replaceState。他の問い合わせと # は残す)
//
// 【見本のときにすること(App.jsx)】保存してある onboardingDone を**読まずに**全部「まだ」として扱う。
// 一手を済ませたら、その場で溶けて消える。**本物の印は書かない・移行もしない**
// 【便BQ 2026-10-03 統括の裁定】見本の「済んだ」はメモリではなく localStorage の見本専用の鍵(TUTORIAL_PREVIEW_DONE_KEY)に持つ。
// 見本の最中にアプリを開き直しても、済ませた一手は出ない(前はメモリだけだったので、開き直すたびに全部また出た)。
// ?tutorialpreview=1 を付けて開いたら見本の「済んだ」を空にして最初から。=0 で見本の鍵ごと消す。引継のファイルには乗らない
// (本人の本物の印はもう済んでいる。見本で触っただけで書き換えない)。段の順(リード1→2・参加後1→2)は見本でも同じ。
//
// 【保存先は localStorage】IndexedDB の kv に置くとアカウント引継の書き出し(readAll が kv を丸ごと読む)に乗り、
// 読み戻した別の端末まで見本になる。端末ごとの確認用の印なので、書き出しに乗らない localStorage に置く。
// 読み書きは必ず try/catch(プライベートブラウジング等で投げる)。
// 【印は <html> の属性】見本の広告の帯と同じく、最初の描画の前に main.jsx が付け、App.jsx はそれを読む。

export const TUTORIAL_PREVIEW_STORAGE_KEY = "ficus.tutorialPreview";
export const TUTORIAL_PREVIEW_QUERY = "tutorialpreview";
export const TUTORIAL_PREVIEW_ATTR = "data-tutorial-preview";
// 【便BQ】見本の中で済ませた一手(本物の onboardingDone とは別。localStorage なので引継のファイルに乗らない)。
export const TUTORIAL_PREVIEW_DONE_KEY = "ficus.tutorialPreviewDone";

// この端末の localStorage(読めない環境では null)。App.jsx は localStorage を直に触らない(保存の仕組みは IndexedDB の1つ。
// pitch-test 83.5)ので、見本の鍵の読み書きはこのファイルが持つ。
const deviceStorage = () => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } };
// 見本の「済んだ」を読む。壊れていれば空(全部まだ)。
export function readTutorialPreviewDone(storage = deviceStorage()) {
  try {
    const v = JSON.parse(storage?.getItem(TUTORIAL_PREVIEW_DONE_KEY) ?? "null");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
export function writeTutorialPreviewDone(storage = deviceStorage(), done = {}) {
  try { storage?.setItem(TUTORIAL_PREVIEW_DONE_KEY, JSON.stringify(done ?? {})); } catch { /* 覚えられなくても見本は続ける */ }
}

// URL の問い合わせから合図を読む。"1" → "on" / "0" → "off" / それ以外 → null。
export function tutorialPreviewFromSearch(search) {
  let v = null;
  try { v = new URLSearchParams(String(search ?? "")).get(TUTORIAL_PREVIEW_QUERY); } catch { v = null; }
  if (v == null) return null;
  const s = v.trim();
  if (s === "1") return "on";
  if (s === "0") return "off";
  return null;
}

// 問い合わせから tutorialpreview だけを消した URL(パス + 残りの問い合わせ + #)。
export function urlWithoutTutorialPreview(loc) {
  let params;
  try { params = new URLSearchParams(String(loc?.search ?? "")); } catch { return null; }
  params.delete(TUTORIAL_PREVIEW_QUERY);
  const q = params.toString();
  return `${loc?.pathname ?? ""}${q ? `?${q}` : ""}${loc?.hash ?? ""}`;
}

export function readTutorialPreviewStored(storage) {
  try { return storage?.getItem(TUTORIAL_PREVIEW_STORAGE_KEY) === "1"; } catch { return false; }
}

// 起動の最初(main.jsx)に1回だけ呼ぶ。返り値は「見本にするか」。
export function applyTutorialPreview({
  location: loc = typeof window !== "undefined" ? window.location : null,
  history: hist = typeof window !== "undefined" ? window.history : null,
  storage = (() => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } })(),
  doc = typeof document !== "undefined" ? document : null,
} = {}) {
  const signal = tutorialPreviewFromSearch(loc?.search);
  // 【便BQ】=1 で開いたら見本の「済んだ」を空にして最初から。=0 で見本の鍵ごと消す。
  if (signal === "on") {
    try { storage?.setItem(TUTORIAL_PREVIEW_STORAGE_KEY, "1"); } catch { /* 覚えられなくてもこの起動では見本にする */ }
    try { storage?.removeItem(TUTORIAL_PREVIEW_DONE_KEY); } catch { /* noop */ }
  }
  if (signal === "off") {
    try { storage?.removeItem(TUTORIAL_PREVIEW_STORAGE_KEY); } catch { /* noop */ }
    try { storage?.removeItem(TUTORIAL_PREVIEW_DONE_KEY); } catch { /* noop */ }
  }
  let hasQuery = false;
  try { hasQuery = new URLSearchParams(String(loc?.search ?? "")).has(TUTORIAL_PREVIEW_QUERY); } catch { hasQuery = false; }
  if (hasQuery) {
    const next = urlWithoutTutorialPreview(loc);
    if (next != null) { try { hist?.replaceState(hist.state ?? null, "", next); } catch { /* noop */ } }
  }
  const on = signal === "on" ? true : signal === "off" ? false : readTutorialPreviewStored(storage);
  const el = doc?.documentElement;
  if (el) {
    if (on) el.setAttribute(TUTORIAL_PREVIEW_ATTR, "1");
    else el.removeAttribute(TUTORIAL_PREVIEW_ATTR);
  }
  return on;
}

export function isTutorialPreviewOn(doc = typeof document !== "undefined" ? document : null) {
  return doc?.documentElement?.getAttribute(TUTORIAL_PREVIEW_ATTR) === "1";
}
