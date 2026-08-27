// NGワードリストを取得して照合用JSONを生成する。実行: node scripts/fetch-ngwords.mjs
// 出典(いずれもMIT): MosasoM/inappropriate-words-ja, dsojevic/profanity-list
import { writeFileSync, mkdirSync } from "node:fs";

const JA_URLS = [
  "https://raw.githubusercontent.com/MosasoM/inappropriate-words-ja/master/Sexual.txt",
  "https://raw.githubusercontent.com/MosasoM/inappropriate-words-ja/master/Offensive.txt",
];
const EN_URL = "https://raw.githubusercontent.com/dsojevic/profanity-list/main/en.json";

// 誤検知を起こしそうな一般語を除外
const EXCLUDE = new Set(["土方", "でべそ"]);

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
const enEntries = enRaw.map((e) => ({
  words: String(e.match ?? "").split("|").map((s) => s.trim().replace(/\*/g, "")).filter(Boolean),
  exceptions: (e.exceptions ?? []).map((s) => String(s).trim()).filter(Boolean),
})).filter((e) => e.words.length > 0);

// 重複を除去: (同じ words 配列を持つエントリを1つに統合)
const uniqueEntries = [];
const seenWords = new Set();
for (const entry of enEntries) {
  const key = JSON.stringify(entry.words.sort());
  if (!seenWords.has(key)) {
    seenWords.add(key);
    uniqueEntries.push(entry);
  }
}

mkdirSync("src/community/ngwords/generated", { recursive: true });
writeFileSync("src/community/ngwords/generated/ja.json",
  JSON.stringify({ source: "MosasoM/inappropriate-words-ja", license: "MIT", words: [...jaWords] }, null, 1) + "\n");
writeFileSync("src/community/ngwords/generated/en.json",
  JSON.stringify({ source: "dsojevic/profanity-list", license: "MIT", entries: uniqueEntries }, null, 1) + "\n");
console.log(`ja: ${jaWords.size} words / en: ${uniqueEntries.length} entries`);
