// ニックネームのNGワード照合用の正規化。表示値には使わない(照合コピー専用)。
// 方針は docs/superpowers/research/2026-08-27-ngword-filter.md 参照。
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s" };

export function normalizeForFilter(input) {
  let s = String(input ?? "");
  s = s.normalize("NFKC").toLowerCase();
  // カタカナ→ひらがな(U+30A1..U+30F6 を -0x60)
  s = s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  return s;
}

export function compactForFilter(input) {
  return normalizeForFilter(input).replace(/[\s._\-ー・]/g, "");
}

export function leetForFilter(s) {
  return String(s ?? "").replace(/[0134578@$]/g, (ch) => LEET[ch] ?? ch);
}
