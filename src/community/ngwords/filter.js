import { normalizeForFilter, compactForFilter, leetForFilter } from "./normalize.js";
import ja from "./generated/ja.json";
import en from "./generated/en.json";

// ------------------------------------------------------------------
// ニックネームのNGワード照合。
//
// 【照合の強さを2段階に分ける】
// 上流の dsojevic/profanity-list は「語境界での照合」を前提にしたデータである。
// たとえば ass の項目は {"match":"ass","severity":1} で exceptions が空になっているが、
// これは例外が要らないからではなく、境界照合なら "bass" に当たらないからである。
// この前提を無視して全語を部分一致させると、bass / brass / Classic / Passion /
// Bassoon / Grass といった普通のニックネームが軒並み弾かれる。
//
// そこで上流の severity(1..4)を照合の強さの指標として使う:
//
//   severity >= 2 (強い語: fuck / bitch / arse / cock / shit ...)
//     → 区切りを潰した compact + leet 変換後を **部分一致**。
//       "xxfuckxx" / "f-u-c-k" / "b17ch" / "coolarse" のような偽装・埋め込みを弾く。
//       誤爆は上流の exceptions(coarse / hoarse / catharse ...)で救う。
//
//   severity == 1 (穏当な語: ass / bugger ...)
//     → 区切りを **残した** 正規化形の上で **語境界一致**。
//       "bass" は弾かず、"sax ass" / "sax_ass" は弾く。
//       ここで compact を使うと区切りごと境界が消えて "sax ass" を見逃すので、
//       あえて compact ではなく normalize の側を見る。
//       この段は区切り偽装("a-s-s")には弱いが、severity 1 の語に対しては割に合う。
//
// 【日本語側】語境界が存在しないので部分一致しか採れない。代わりに、無関係な語の
// 内部へ頻出する短い項目(SM / 3P / イク / カス など)を生成時に落としている
// (scripts/fetch-ngwords.mjs の EXCLUDE)。
// ------------------------------------------------------------------

// この値より弱い語(= severity 1)は語境界一致に落とす。
const AGGRESSIVE_MIN_SEVERITY = 2;

// 起動時に一度だけ照合用に正規化しておく(リスト側も同じ正規化を通すことが重要)。
// 返り値はUI表示用に元の語形(original)を保持し、照合には正規化後(compact)を使う。
function toEntry(original) {
  return { original, compact: compactForFilter(original) };
}

// 短すぎる語(ja 2文字未満 / en 3文字未満)は誤爆源なので照合から外している。
const JA_WORDS = ja.words.map(toEntry).filter((w) => w.compact.length >= 2);

const EN_ENTRIES = en.entries.map((e) => ({
  words: e.words.map(toEntry).filter((w) => w.compact.length >= 3),
  // severity 欠損は「強い側」に倒す(生成側と同じ安全側の既定)。
  aggressive: (Number.isFinite(e.severity) ? e.severity : 3) >= AGGRESSIVE_MIN_SEVERITY,
  // en.jsonのexceptionsの"*"は「区切り記法」ではなく「ヒットしたNGワードが入る位置」を示すプレースホルダ。
  // 例: bugger の例外 "de*" は de+bugger="debugger"、arse の例外 "co*" は co+arse="coarse" を意味する。
  // そのためロード時点で"*"を除去/展開することはできない(展開にはヒットした語そのものが要る)。
  // ここではcompactForFilterだけ通して"*"を温存し、実際の展開はfindNgWord内でヒット語ごとに行う。
  exceptionTemplates: e.exceptions.map((ex) => compactForFilter(ex)),
}));

// 語境界一致。前後の文字が「語を構成する文字」でないときだけヒットとみなす。
// compact/leet を通した後の文字集合は小文字ラテン+数字+日本語なので、
// 語の一部とみなすのは [a-z0-9] だけでよい(空白・記号・かな漢字はすべて境界)。
// 例: "bass" の "ass" は前が "b" なので不一致 / "sax ass" と "sax_ass" は一致。
const WORD_CHAR = /[a-z0-9]/;
function includesAtWordBoundary(haystack, needle) {
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
    const before = i === 0 ? "" : haystack[i - 1];
    const after = haystack[i + needle.length] ?? "";
    // WORD_CHAR.test("") は false なので、文字列の端はそのまま境界として扱える。
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true;
  }
  return false;
}

export function findNgWord(nickname) {
  // 区切りを残した形(語境界一致用)と、潰した形(部分一致用)の両方を作る。
  const normal = normalizeForFilter(nickname);
  const compact = compactForFilter(nickname);
  // leetはnormalizeForFilterから分離されたため、ここで候補としてleet変換後の形も照合する
  // (normalizeForFilterはleet変換を適用しないため、「f3ck」のような偽装を弾くにはここで明示的に適用する必要がある)。
  const leetNormal = leetForFilter(normal);
  const leetCompact = leetForFilter(compact);

  for (const w of JA_WORDS) {
    if (compact.includes(w.compact) || leetCompact.includes(w.compact)) return w.original;
  }
  for (const e of EN_ENTRIES) {
    const hit = e.aggressive
      ? e.words.find((w) => compact.includes(w.compact) || leetCompact.includes(w.compact))
      : e.words.find((w) => includesAtWordBoundary(normal, w.compact) || includesAtWordBoundary(leetNormal, w.compact));
    if (!hit) continue;
    // 例外は"*"をヒットした語(hit.compact)で置換して完全形に展開してから照合する。
    // NGワード自体がleet経由(leetCompact)でヒットする場合(例: "c4th4rse" -> leetCompactで"arse"にヒット)、
    // 例外もleetCompact側で見ないと保護が効かない(compactは"c4th4rse"のままで展開形"catharse"を含まない)。
    // そのためcompact/leetCompactの両方を例外側でも見る。
    // (境界一致でヒットした語も compact 側で見てよい。compact は normal から区切りを
    //  落としただけなので、normal に連続して現れる展開形は compact にも必ず含まれる。)
    const excepted = e.exceptionTemplates.some((tpl) => {
      const full = tpl.includes("*") ? tpl.replace(/\*/g, hit.compact) : tpl;
      return compact.includes(full) || leetCompact.includes(full);
    });
    if (excepted) continue;
    return hit.original;
  }
  return null;
}
