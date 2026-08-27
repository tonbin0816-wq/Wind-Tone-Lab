import { compactForFilter, leetForFilter } from "./normalize.js";
import ja from "./generated/ja.json";
import en from "./generated/en.json";

// 起動時に一度だけ照合用に正規化しておく(リスト側も同じ正規化を通すことが重要)。
// 返り値はUI表示用に元の語形(original)を保持し、照合には正規化後(compact)を使う。
function toEntry(original) {
  return { original, compact: compactForFilter(original) };
}

// 短すぎる語(ja 2文字未満 / en 3文字未満)は誤爆源なので照合から外している。
const JA_WORDS = ja.words.map(toEntry).filter((w) => w.compact.length >= 2);

const EN_ENTRIES = en.entries.map((e) => ({
  words: e.words.map(toEntry).filter((w) => w.compact.length >= 3),
  // en.jsonのexceptionsの"*"は「区切り記法」ではなく「ヒットしたNGワードが入る位置」を示すプレースホルダ。
  // 例: bugger の例外 "de*" は de+bugger="debugger"、arse の例外 "co*" は co+arse="coarse" を意味する。
  // そのためロード時点で"*"を除去/展開することはできない(展開にはヒットした語そのものが要る)。
  // ここではcompactForFilterだけ通して"*"を温存し、実際の展開はfindNgWord内でヒット語ごとに行う。
  exceptionTemplates: e.exceptions.map((ex) => compactForFilter(ex)),
}));

export function findNgWord(nickname) {
  const compact = compactForFilter(nickname);
  // leetはnormalizeForFilterから分離されたため、ここで候補としてleet変換後の形も照合する
  // (normalizeForFilterはleet変換を適用しないため、「f3ck」のような偽装を弾くにはここで明示的に適用する必要がある)。
  const leetCompact = leetForFilter(compact);

  for (const w of JA_WORDS) {
    if (compact.includes(w.compact) || leetCompact.includes(w.compact)) return w.original;
  }
  for (const e of EN_ENTRIES) {
    const hit = e.words.find((w) => compact.includes(w.compact) || leetCompact.includes(w.compact));
    if (!hit) continue;
    // 例外は"*"をヒットした語(hit.compact)で置換して完全形に展開してから照合する。
    // NGワード自体がleet経由(leetCompact)でヒットする場合(例: "c4th4rse" -> leetCompactで"arse"にヒット)、
    // 例外もleetCompact側で見ないと保護が効かない(compactは"c4th4rse"のままで展開形"catharse"を含まない)。
    // そのためcompact/leetCompactの両方を例外側でも見る。
    const excepted = e.exceptionTemplates.some((tpl) => {
      const full = tpl.includes("*") ? tpl.replace(/\*/g, hit.compact) : tpl;
      return compact.includes(full) || leetCompact.includes(full);
    });
    if (excepted) continue;
    return hit.original;
  }
  return null;
}
