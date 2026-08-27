// NGワードリストを取得して照合用JSONを生成する。実行: node scripts/fetch-ngwords.mjs
// 出典(いずれもMIT): MosasoM/inappropriate-words-ja, dsojevic/profanity-list
import { writeFileSync, mkdirSync } from "node:fs";

const JA_URLS = [
  "https://raw.githubusercontent.com/MosasoM/inappropriate-words-ja/master/Sexual.txt",
  "https://raw.githubusercontent.com/MosasoM/inappropriate-words-ja/master/Offensive.txt",
];
const EN_URL = "https://raw.githubusercontent.com/dsojevic/profanity-list/main/en.json";

// 誤検知を起こしそうな一般語を除外。
//
// 【なぜ日本語側だけ除外リストが要るのか】
// 日本語には語境界が無いので ja 側は部分一致でしか照合できない(filter.js 参照)。
// そのため「短くて、無関係な語の内部に頻出する」項目は、そのままでは普通のニックネームを
// 巻き添えにする。en 側は severity による段階分け(filter.js)で同じ問題を解けるが、
// ja のリストには severity に相当する情報が無いため、生成時に落とすしかない。
const EXCLUDE = new Set([
  // 元からの除外(一般語との衝突)
  "土方",
  "でべそ",
  // --- ASCII2〜3文字。compactForFilter 後にラテン文字のニックネーム内部へ素で刺さる ---
  "SM", // "Smile" / "jasmine" / "Sax_Smith" が全滅する
  "3P", // 数字を含む普通のニックネーム("3Panda"等)を巻き添えにする
  "NTR", // "central" / "control" の内部に出る
  "SOD", // "Rhapsody" の内部に出る
  // --- 2文字かな。compactForFilter でカタカナ→ひらがなに統一されるため、
  //     カタカナ表記の項目でもひらがなの一般語に刺さる ---
  "イク", // "いくみ" / "ゆういく" / "たいくつ" が全滅する
  "カス", // "かすみ" / "カスミ" が全滅する
]);

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`); // 404ならリポジトリ構成が変わっている。GitHubでファイル名を確認して直すこと
  return res.text();
}

const jaWords = new Set();
for (const url of JA_URLS) {
  for (const line of (await fetchText(url)).split(/\r?\n/)) {
    const w = line.trim();
    if (w && !w.startsWith("#") && !EXCLUDE.has(w)) jaWords.add(w);
  }
}

const enRaw = JSON.parse(await fetchText(EN_URL));
// 形式: [{ match: "word|w0rd", exceptions?: [...] , severity, ... }] を想定。
// match フィールドの * は「前の文字の1回以上の繰り返し」を意味する (lo*ng = "long"/"loong"/"looong" など)
// compactForFilter が区切り文字を落とすため、素の綴りに正規化する
//
// 【severity を落とさずに持ち上げる理由】
// 上流(dsojevic/profanity-list)は語境界での照合を前提にしたライブラリ向けのデータで、
// severity 1 の穏当な語(ass / bugger など)には exceptions が付いていない。境界照合なら
// "bass" は当たらないので例外を書く必要が無いからである。こちらが部分一致で照合すると
// この前提が崩れ、"bass" / "brass" / "Classic" / "Passion" が全て弾かれる。
// filter.js は severity を見て照合の強さを2段階に分けるので、ここで捨ててはいけない。
const enEntries = enRaw.map((e) => ({
  words: String(e.match ?? "").split("|").map((s) => s.trim().replace(/\*/g, "")).filter(Boolean),
  exceptions: (e.exceptions ?? []).map((s) => String(s).trim()).filter(Boolean),
  // 欠損時は「強い側」に倒す(安全側)。上流は 1..4 の整数。
  severity: Number.isFinite(e.severity) ? e.severity : 3,
})).filter((e) => e.words.length > 0);

// 重複を除去: (同じ words 配列を持つエントリを1つに統合)
// severity は統合先の最大値を採る(同じ綴りが強弱2つの分類で現れたら強い方を採用する)。
const uniqueEntries = [];
const seenWords = new Map();
for (const entry of enEntries) {
  const key = JSON.stringify(entry.words.sort());
  const existing = seenWords.get(key);
  if (existing) {
    existing.severity = Math.max(existing.severity, entry.severity);
    continue;
  }
  seenWords.set(key, entry);
  uniqueEntries.push(entry);
}

mkdirSync("src/community/ngwords/generated", { recursive: true });
writeFileSync("src/community/ngwords/generated/ja.json",
  JSON.stringify({ source: "MosasoM/inappropriate-words-ja", license: "MIT", words: [...jaWords] }, null, 1) + "\n");
writeFileSync("src/community/ngwords/generated/en.json",
  JSON.stringify({ source: "dsojevic/profanity-list", license: "MIT", entries: uniqueEntries }, null, 1) + "\n");
console.log(`ja: ${jaWords.size} words / en: ${uniqueEntries.length} entries`);
