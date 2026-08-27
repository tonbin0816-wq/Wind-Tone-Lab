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
  // en.jsonのexceptionsは"cath*"のようにワイルドカード"*"付きの語形のまま生成されている。
  // 照合は部分一致のため"*"を含んだままでは絶対にヒットせず、Scunthorpe対策が機能しない。
  // そのため"*"を除去してから正規化する(コントローラ裁定)。
  // *除去後に1〜2文字まで短くなった例外(例: "co*" -> "co")は、あらゆる箇所に部分一致してしまい
  // 過剰保護の温床になるため、NGワードリスト本体の短語フィルタ(en>=3)と同じ閾値で足切りする。
  exceptions: e.exceptions
    .map((ex) => compactForFilter(ex.replace(/\*/g, "")))
    .filter((ex) => ex.length >= 3),
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
    // NGワード自体がleet経由(leetCompact)でヒットする場合(例: "c4th4rse" -> leetCompactで"arse"にヒット)、
    // 例外もleetCompact側で見ないと保護が効かない(compactは"c4th4rse"のままで"cath"を含まない)。
    // そのためcompact/leetCompactの両方を例外側でも見る。
    // (normalizeForFilterの結果=normは、exが常にcompactForFilterを通っていて区切り文字を含み得ないため
    //  compactでの判定が常に上位互換になり不要だったので使わない)
    if (e.exceptions.some((ex) => compact.includes(ex) || leetCompact.includes(ex))) continue;
    return hit.original;
  }
  return null;
}
