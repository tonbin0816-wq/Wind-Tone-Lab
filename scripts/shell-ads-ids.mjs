// scripts/shell-ads-ids.mjs ── 【便S4 2026-10-25】広告の ID の「開発版は試験・本番は本物」を Codemagic の手順で守る。
// 値の唯一の答えは src/shell/adsConfig.js(このファイルは値を1つも持たない。そこから読む)。
//
//   node scripts/shell-ads-ids.mjs dev      … codemagic.yaml の ios-dev だけが走らせる。
//       ios/App/App/Info.plist の GADApplicationIdentifier を Google の sample(adsConfig.js の ADMOB_DEV_APP_ID_IOS)に書き戻す。
//       git に入っている Info.plist は本番の値。この書き換えはそのビルドの中だけ(Codemagic の作業場の写し)。
//       JS の側は native.js の shellBuildKind() が開発版("dev")と見て、試験のバナー(ADMOB_DEV_BANNER_UNIT_ID_IOS)を選ぶ。
//   node scripts/shell-ads-ids.mjs release  … codemagic.yaml の ios-release の最初の手順(npm ci より前)。
//       本番の値が揃っていなければ exit 1(試験の ID のままの提出を止める門。殻の S3 の門を S4 の形にしたもの)。
//
// npm ci の前に走るので、node の組み込みと adsConfig.js(何も import しない)だけを読む。
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PLIST_PATH = join(root, "ios", "App", "App", "Info.plist");
// Google の demo の発行元の番号(https://developers.google.com/admob/ios/test-ads)。本番の値に混ざっていたら止める
export const DEMO_PUBLISHER = "3940256099942544";
const APP_ID_RE = /^ca-app-pub-\d{16}~\d{10}$/;
const UNIT_ID_RE = /^ca-app-pub-\d{16}\/\d{10}$/;
const KEY_RE = /(<key>GADApplicationIdentifier<\/key>\s*<string>)([^<]*)(<\/string>)/g;

// Info.plist の GADApplicationIdentifier の値。無い・2つ以上なら null。
export function readPlistAppId(plistText) {
  const all = [...String(plistText).matchAll(KEY_RE)];
  return all.length === 1 ? all[0][2] : null;
}

// GADApplicationIdentifier の値だけを appId に替えた Info.plist の文。鍵がちょうど1つでなければ投げる。
export function setPlistAppId(plistText, appId) {
  if (!APP_ID_RE.test(String(appId))) throw new Error(`アプリ ID の形ではない: ${appId}`);
  const n = [...String(plistText).matchAll(KEY_RE)].length;
  if (n !== 1) throw new Error(`GADApplicationIdentifier が ${n} 個ある(1個のはず)`);
  return String(plistText).replace(KEY_RE, (_, a, _old, c) => `${a}${appId}${c}`);
}

// 本番のビルドに出してよい形か。問題の一覧(空なら合格)。cfg = adsConfig.js のモジュール。
export function releaseAdsProblems(cfg, plistText) {
  const out = [];
  const isDemo = (s) => String(s).includes(DEMO_PUBLISHER);
  if (cfg.ADMOB_USE_TEST_ADS !== false) out.push("adsConfig.js の ADMOB_USE_TEST_ADS が false ではない");
  if (!UNIT_ID_RE.test(String(cfg.ADMOB_BANNER_UNIT_ID_IOS)) || isDemo(cfg.ADMOB_BANNER_UNIT_ID_IOS)) out.push("adsConfig.js の ADMOB_BANNER_UNIT_ID_IOS が本番のユニット ID ではない");
  if (!APP_ID_RE.test(String(cfg.ADMOB_APP_ID_IOS)) || isDemo(cfg.ADMOB_APP_ID_IOS)) out.push("adsConfig.js の ADMOB_APP_ID_IOS が本番のアプリ ID ではない");
  const plistId = readPlistAppId(plistText);
  if (plistId === null) out.push("Info.plist の GADApplicationIdentifier がちょうど1つではない");
  else if (isDemo(plistId) || plistId !== cfg.ADMOB_APP_ID_IOS) out.push(`Info.plist の GADApplicationIdentifier(${plistId})が adsConfig.js の ADMOB_APP_ID_IOS と違う`);
  // JS の選び方: 本番("release")で本番のユニット・試験でない、を実際に呼んで確かめる
  const rel = typeof cfg.admobIds === "function" ? cfg.admobIds("release") : null;
  if (!rel || rel.useTestAds !== false || rel.bannerUnitId !== cfg.ADMOB_BANNER_UNIT_ID_IOS || isDemo(rel.bannerUnitId)) out.push("adsConfig.js の admobIds(\"release\") が本番の値を返さない");
  return out;
}

async function main(mode) {
  const cfg = await import(pathToFileURL(join(root, "src", "shell", "adsConfig.js")).href);
  const plist = readFileSync(PLIST_PATH, "utf8");
  if (mode === "dev") {
    const next = setPlistAppId(plist, cfg.ADMOB_DEV_APP_ID_IOS);
    writeFileSync(PLIST_PATH, next);
    const now = readPlistAppId(readFileSync(PLIST_PATH, "utf8"));
    if (now !== cfg.ADMOB_DEV_APP_ID_IOS) { console.error(`[shell-ads] 書き戻せなかった: ${now}`); process.exit(1); }
    console.log(`[shell-ads] 開発版: Info.plist の GADApplicationIdentifier = ${now}(試験のアプリ ID。バナーは JS が試験のユニットを選ぶ)`);
    return;
  }
  if (mode === "release") {
    const problems = releaseAdsProblems(cfg, plist);
    if (problems.length) {
      for (const p of problems) console.error(`[shell-ads] ${p}`);
      console.error("[shell-ads] 本番の広告 ID が揃っていません。src/shell/adsConfig.js と ios/App/App/Info.plist を確かめてから ios-release を走らせてください(殻の仕様 便S4)。");
      process.exit(1);
    }
    console.log(`[shell-ads] 本番: バナー ${cfg.ADMOB_BANNER_UNIT_ID_IOS}・アプリ ID ${readPlistAppId(plist)}`);
    return;
  }
  console.error("使い方: node scripts/shell-ads-ids.mjs dev | release");
  process.exit(1);
}

// node で直に走らせたときだけ動く(検査が import しても何も書かない)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch((e) => { console.error(`[shell-ads] ${e?.message || e}`); process.exit(1); });
}
