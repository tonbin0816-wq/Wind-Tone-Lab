// 【便BL 2026-10-02 本人指示】見本の広告の帯の合図。
//
// 本人「広告を入れたらボタン類が重ならないか、先に実機で見たい」。アプリ化のときに AdMob の下部の帯
// (高さ 50px・下部タブのすぐ上・計測タブにも出す)を入れると決めているので、本物の広告ではなく
// **見本の帯**を、合図を付けた端末でだけ本番の Web 版に出す。将来の本物の帯の受け皿も兼ねる。
//
//   ・URL に ?adpreview=1 … この端末に覚える(以後は URL に付けなくても出る)
//   ・URL に ?adpreview=0 … 覚えたのを消す
//   ・どちらでもない     … 覚えているとおり(覚えていなければ出ない)
//   ・合図を読んだら、URL からその問い合わせだけを消す(history.replaceState。他の問い合わせと # は残す)
//
// 【帯の高さは CSS が1か所で持つ】index.css の --ad-h(既定 0px)を、根の要素
// (<html>)に data-ad-preview="1" が付いているときだけ 50px にする。--page-bottom-gap が
// --ad-h を足すので、ページ下端の余白・下部に浮かせるボタン・計測タブの画面ぶんの高さが
// まとめて帯の上へずれる。帯を描くかどうか(App.jsx の AdPreviewStrip)も**同じ属性**を読む
// ── 余白と帯が別々の合図を見ると、片方だけ出る姿があり得る。
//
// 【保存先は localStorage】このアプリの保存は IndexedDB の kv ストアが正だが、そこへ置くと
// バックアップの書き出し(backup/localStore.js の readAll が kv を丸ごと読む)に乗り、
// 読み戻した別の端末にまで帯が出る。これは**端末ごとの確認用の印**で練習の記録ではないので
// 書き出しに乗らない localStorage に置く。最初の描画の前に同期で読めるのも、帯の有無で
// ページが跳ねないために要る。読み書きは必ず try/catch(プライベートブラウジング等で投げる)。

export const AD_PREVIEW_STORAGE_KEY = "ficus.adPreview";
export const AD_PREVIEW_QUERY = "adpreview";
export const AD_PREVIEW_ATTR = "data-ad-preview";

// URL の問い合わせ(location.search)から合図を読む。"1" → "on" / "0" → "off" / それ以外 → null。
export function adPreviewFromSearch(search) {
  let v = null;
  try { v = new URLSearchParams(String(search ?? "")).get(AD_PREVIEW_QUERY); } catch { v = null; }
  if (v == null) return null;
  const s = v.trim();
  if (s === "1") return "on";
  if (s === "0") return "off";
  return null;
}

// 問い合わせから adpreview だけを消した URL(パス + 残りの問い合わせ + #)。
export function urlWithoutAdPreview(loc) {
  let params;
  try { params = new URLSearchParams(String(loc?.search ?? "")); } catch { return null; }
  params.delete(AD_PREVIEW_QUERY);
  const q = params.toString();
  return `${loc?.pathname ?? ""}${q ? `?${q}` : ""}${loc?.hash ?? ""}`;
}

export function readAdPreviewStored(storage) {
  try { return storage?.getItem(AD_PREVIEW_STORAGE_KEY) === "1"; } catch { return false; }
}

// 起動の最初(main.jsx)に1回だけ呼ぶ。返り値は「見本の帯を出すか」。
export function applyAdPreview({
  location: loc = typeof window !== "undefined" ? window.location : null,
  history: hist = typeof window !== "undefined" ? window.history : null,
  storage = (() => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } })(),
  doc = typeof document !== "undefined" ? document : null,
} = {}) {
  const signal = adPreviewFromSearch(loc?.search);
  if (signal === "on") { try { storage?.setItem(AD_PREVIEW_STORAGE_KEY, "1"); } catch { /* 覚えられなくてもこの起動では出す */ } }
  if (signal === "off") { try { storage?.removeItem(AD_PREVIEW_STORAGE_KEY); } catch { /* noop */ } }
  // 問い合わせに adpreview が在れば(1 / 0 以外の値でも)消す。読んだ合図を URL に残すと、
  // 共有した URL を開いた人の端末にまで覚えさせてしまう。
  let hasQuery = false;
  try { hasQuery = new URLSearchParams(String(loc?.search ?? "")).has(AD_PREVIEW_QUERY); } catch { hasQuery = false; }
  if (hasQuery) {
    const next = urlWithoutAdPreview(loc);
    if (next != null) { try { hist?.replaceState(hist.state ?? null, "", next); } catch { /* noop */ } }
  }
  const on = signal === "on" ? true : signal === "off" ? false : readAdPreviewStored(storage);
  const el = doc?.documentElement;
  if (el) {
    if (on) el.setAttribute(AD_PREVIEW_ATTR, "1");
    else el.removeAttribute(AD_PREVIEW_ATTR);
  }
  return on;
}

// 帯を描くかどうか。**余白(--ad-h)と同じ属性を読む**(上の注記)。
export function isAdPreviewOn(doc = typeof document !== "undefined" ? document : null) {
  return doc?.documentElement?.getAttribute(AD_PREVIEW_ATTR) === "1";
}

// 【便CG 2026-10-09 本人の要望「チュートリアル中は広告なしにできませんか」・統括の裁定】はじめの案内が終わるまで広告の帯を出さない。
// その間 <html> に付ける印。index.css の :root[data-ad-hold="1"] が --ad-h を 0px に戻し、見本の帯(App.jsx の AdPreviewStrip)も描かない。
// 合図の印(data-ad-preview。端末が見本を望んでいるか)とは別に持つ ── 合図の印を外すと、部品を作り直したときに望みが消えるため。
// 付け外しは App.jsx だけ(時機の判断は onboarding.jsx の adsAllowed)。
export const AD_HOLD_ATTR = "data-ad-hold";
// held に合わせて印を付け外しする。戻り値は「変わったか」(変わったときだけ呼び手が測り直しの知らせを出す)。
export function setAdHold(held, doc = typeof document !== "undefined" ? document : null) {
  const el = doc?.documentElement;
  if (!el) return false;
  const before = el.getAttribute(AD_HOLD_ATTR) === "1";
  if (before === Boolean(held)) return false;
  if (held) el.setAttribute(AD_HOLD_ATTR, "1");
  else el.removeAttribute(AD_HOLD_ATTR);
  return true;
}
export function isAdHeld(doc = typeof document !== "undefined" ? document : null) {
  return doc?.documentElement?.getAttribute(AD_HOLD_ATTR) === "1";
}
