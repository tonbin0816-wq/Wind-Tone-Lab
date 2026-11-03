// 審査用のデモ奏者を本番のコミュニティに入れる(2026-11-03・Guideline 2.1(a) への対応)。
// 実行: node --env-file=.env.local scripts/seed-review-demo.mjs   (--dry で書かずに中身だけ表示)
// 承認後に消す: Firebase コンソールで users と ideals の「デモ奏者」を削除(出力の uid の一覧が目印)。
// 書く形は src/community/profile.js の buildProfileDoc・idealDoc.js の buildIdealDoc と firestore.rules に合わせてある。
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { writeFileSync } from "node:fs";
import { INSTRUMENT_CATALOG, MOUTHPIECE_CATALOG, LIGATURE_CATALOG, REED_CATALOG } from "../src/community/catalog/gear.js";

const DRY = process.argv.includes("--dry");
const NOW = new Date();

// 1 人ごとに別の匿名アカウントが要る(1 アカウント = 1 プロフィール)
const PLAYERS = [
  { nick: "デモ奏者A", saxTypes: ["alto"], position: "社会人", start: 2014, genres: ["ジャズ"], ensembles: ["ビッグバンド"], icon: "ic-music-notes", color: 3, days: [5, 16, 120, 640], hrs: [3.5, 14, 160, 900] },
  { nick: "デモ奏者B", saxTypes: ["alto", "soprano"], position: "学生", start: 2021, genres: ["クラシック", "ポップス"], ensembles: ["吹奏楽"], icon: "ic-leaf", color: 7, days: [6, 20, 160, 380], hrs: [5, 22, 210, 520] },
  { nick: "デモ奏者C", saxTypes: ["tenor"], position: "職業音楽家", start: 2005, genres: ["ジャズ"], ensembles: ["ソロ", "アンサンブル"], icon: "ic-moon-stars", color: 1, days: [7, 27, 300, 2100], hrs: [9, 38, 420, 3000] },
  { nick: "デモ奏者D", saxTypes: ["tenor", "baritone"], position: "社会人", start: 2017, genres: ["ポップス"], ensembles: ["アンサンブル"], icon: "ic-star", color: 5, days: [3, 11, 90, 410], hrs: [2, 9, 110, 560] },
  { nick: "デモ奏者E", saxTypes: ["alto", "tenor"], position: "学生（音楽専門）", start: 2019, genres: ["クラシック"], ensembles: ["アンサンブル", "オーケストラ"], icon: "ic-flower-lotus", color: 9, days: [6, 24, 210, 700], hrs: [7, 30, 280, 960] },
  { nick: "デモ奏者F", saxTypes: ["soprano", "baritone"], position: "社会人", start: 2010, genres: ["ジャズ", "ポップス"], ensembles: ["ビッグバンド"], icon: "ic-sun", color: 2, days: [4, 14, 100, 520], hrs: [3, 12, 130, 700] },
];

// 目安の音(サックスの音域の中ほどの 20 音)。キーは半音インデックスの文字列(rules は 0..47)
const NOTE_KEYS = Array.from({ length: 20 }, (_, i) => String(14 + i));
const rand = (seed) => { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); };

function firstValid(catalogEntry, pick) { return pick(catalogEntry); }
function gearFor(saxType) {
  const instBrand = Object.keys(INSTRUMENT_CATALOG).find((b) => INSTRUMENT_CATALOG[b][saxType]?.length);
  const mpBrand = Object.keys(MOUTHPIECE_CATALOG)[0];
  const ligBrand = Object.keys(LIGATURE_CATALOG)[0];
  const reedBrand = Object.keys(REED_CATALOG)[0];
  return {
    instrumentBrand: instBrand, instrumentModel: INSTRUMENT_CATALOG[instBrand][saxType][0],
    mpBrand, mpModel: MOUTHPIECE_CATALOG[mpBrand].models[0],
    ligBrand, ligModel: LIGATURE_CATALOG[ligBrand].models[0],
    reedBrand, reedModel: REED_CATALOG[reedBrand].models[0], reedStrength: "3.0",
  };
}

function statsOf(p) {
  const [w, m, y, a] = p.days; const [hw, hm, hy, ha] = p.hrs;
  return {
    daysThisWeek: w, daysThisMonth: m, daysThisYear: y, daysAll: a, computedAt: NOW.toISOString(),
    secThisWeek: Math.round(hw * 3600), secThisMonth: Math.round(hm * 3600), secThisYear: Math.round(hy * 3600), secAll: Math.round(ha * 3600),
  };
}

function idealOf(uid, saxType, seed) {
  const r = rand(seed);
  const notes = {};
  NOTE_KEYS.forEach((k, i) => {
    const harmonics = [1, 0.62, 0.38, 0.27, 0.18, 0.12, 0.08, 0.05].map((v) => Math.round(Math.min(1, v * (0.85 + r() * 0.3)) * 1000) / 1000);
    notes[k] = {
      pitchCentsSigned: Math.round((-14 + r() * 28 + (i > 14 ? 6 : 0)) * 10) / 10, // 高い音ほど少し高め
      spectralCentroidHz: Math.round(1100 + i * 55 + r() * 200),
      hnrDb: Math.round((18 + r() * 9) * 10) / 10,
      harmonics,
    };
  });
  return { ownerUid: uid, saxType, tuningHz: 442, notes, noteKeys: [...NOTE_KEYS], sourceSessionCount: 12 + Math.floor(r() * 40), updatedAt: NOW.toISOString() };
}

function profileOf(p) {
  const gear = {};
  for (const t of p.saxTypes) gear[t] = gearFor(t);
  return {
    nickname: p.nick, icon: p.icon, iconColor: p.color, saxTypes: p.saxTypes, position: p.position, startYear: p.start,
    genres: p.genres, ensembles: p.ensembles, gear, stats: statsOf(p),
    deviceClass: "ios", isPublic: true, ageConfirmed: true, updatedAt: NOW.toISOString(),
  };
}

if (DRY) {
  console.log(JSON.stringify(PLAYERS.map((p) => ({ profile: profileOf(p), ideals: p.saxTypes.length })), null, 1).slice(0, 2500));
  process.exit(0);
}

const need = ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) { console.error("環境変数が足りません:", missing.join(", ")); process.exit(1); }

const uids = [];
for (const [i, p] of PLAYERS.entries()) {
  // 1 人ごとに別のアプリ名で初期化する(同じ名前だと同じ匿名アカウントになる)
  const app = initializeApp({
    apiKey: process.env.VITE_FIREBASE_API_KEY, authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID, appId: process.env.VITE_FIREBASE_APP_ID,
  }, `demo-${i}`);
  const { user } = await signInAnonymously(getAuth(app));
  const db = getFirestore(app);
  await setDoc(doc(db, "users", user.uid), profileOf(p));
  for (const [j, t] of p.saxTypes.entries()) {
    await setDoc(doc(db, "ideals", `${user.uid}_${t}`), idealOf(user.uid, t, 1000 * (i + 1) + j));
  }
  uids.push({ uid: user.uid, nickname: p.nick, saxTypes: p.saxTypes });
  console.log("OK", p.nick, user.uid);
}
writeFileSync("demo-players-uids.json", JSON.stringify(uids, null, 1));
console.log("done. 消すときの目印: demo-players-uids.json");
process.exit(0);
