// 【便BB 2026-09-25 統括の裁定 (b)】iOS のときだけ viewport に maximum-scale=1 を足す。
//
// 本人の報告「意図せず拡大されてしまう」の原因の1つ: iOS は font-size が 16px 未満の入力欄に
// 触れると自動で拡大する(このアプリの入力欄はほぼ 12〜15px)。入力欄の文字の大きさは変えない
// (見た目を変えないため)。代わりに拡大の上限を 1 にする。
//
// 【iOS だけにする理由】
// ・iOS Safari は拡大の上限を**指2本の拡大には使わない**ので、止まるのは入力欄の自動拡大だけ。
//   評価グラフを指2本で拡大して見る操作(pitch-test の F-16 の注記。サポートされた操作)は残る。
// ・Android の Chrome は maximum-scale を守るので、全員に入れると指2本の拡大そのものが止まる。
//   しかも Android は入力欄の自動拡大をしないので、入れる理由が無い。
// → index.html の既定の viewport は変えず、起動の最初(main.jsx)で iOS のときだけ書き換える。
//
// 【アプリ(WKWebView)になったとき】WKWebView は既定では拡大の上限を守る
// (ignoresViewportScaleLimits の既定が NO)ので、このままだと指2本の拡大が止まる恐れがある。
// 扱いは**殻(ネイティブの包み)を作る便で決める**(殻の側で上限を無視させる / ここで分ける 等)。

// iPhone / iPod / iPad、および iPadOS の「Mac 名乗り」(デスクトップ表示の既定で UA が
// Macintosh になる。見分けは指で触れる点の数 = maxTouchPoints > 1。本物の Mac は 0)。
export function isIOSDevice(userAgent, maxTouchPoints) {
  const ua = String(userAgent ?? "");
  if (/iPhone|iPod|iPad/.test(ua)) return true;
  return /Macintosh/.test(ua) && Number(maxTouchPoints) > 1;
}

// viewport の content に maximum-scale=1 を足した文字列(既にあれば置き換える。他の項目はそのまま)。
export function withMaximumScale1(content) {
  const parts = String(content ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    .filter((s) => !/^maximum-scale\s*=/i.test(s));
  parts.push("maximum-scale=1");
  return parts.join(", ");
}

// 起動の最初に1回だけ呼ぶ(main.jsx)。iOS でなければ何もしない。
export function applyIOSViewport(doc = document, nav = navigator) {
  if (!isIOSDevice(nav?.userAgent, nav?.maxTouchPoints)) return false;
  const meta = doc?.querySelector?.('meta[name="viewport"]');
  if (!meta) return false;
  meta.setAttribute("content", withMaximumScale1(meta.getAttribute("content")));
  return true;
}
