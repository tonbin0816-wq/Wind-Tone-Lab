// NGワードリストを取得して照合用JSONを生成する。実行: node scripts/fetch-ngwords.mjs
// 出典(いずれもMIT): MosasoM/inappropriate-words-ja, dsojevic/profanity-list
import { writeFileSync, mkdirSync } from "node:fs";

const JA_URLS = [
  "https://raw.githubusercontent.com/MosasoM/inappropriate-words-ja/master/Sexual.txt",
  "https://raw.githubusercontent.com/MosasoM/inappropriate-words-ja/master/Offensive.txt",
];
const EN_URL = "https://raw.githubusercontent.com/dsojevic/profanity-list/main/en.json";

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`); // 404ならリポジトリ構成が変わっている。GitHubでファイル名を確認して直すこと
  return res.text();
}

const jaWords = new Set();
for (const url of JA_URLS) {
  for (const line of (await fetchText(url)).split(/\r?\n/)) {
    const w = line.trim();
    if (w && !w.startsWith("#")) jaWords.add(w);
  }
}

const enRaw = JSON.parse(await fetchText(EN_URL));
// 形式: [{ match: "word|w0rd", exceptions?: [...] , severity, ... }] を想定。
// 想定と違う場合は console.log(enRaw[0]) で実物を見て合わせること。
const enEntries = enRaw.map((e) => ({
  words: String(e.match ?? "").split("|").map((s) => s.trim()).filter(Boolean),
  exceptions: (e.exceptions ?? []).map((s) => String(s).trim()).filter(Boolean),
})).filter((e) => e.words.length > 0);

mkdirSync("src/community/ngwords/generated", { recursive: true });
writeFileSync("src/community/ngwords/generated/ja.json",
  JSON.stringify({ source: "MosasoM/inappropriate-words-ja", license: "MIT", words: [...jaWords] }, null, 1));
writeFileSync("src/community/ngwords/generated/en.json",
  JSON.stringify({ source: "dsojevic/profanity-list", license: "MIT", entries: enEntries }, null, 1));
console.log(`ja: ${jaWords.size} words / en: ${enEntries.length} entries`);
