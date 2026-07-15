import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Square, Trash2, ChevronDown, ChevronUp, Upload } from "lucide-react";

// ============================================================
// Music theory helpers
// ============================================================
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];

// 無音判定に使う音量(dB)の共通しきい値。メーターと「これまでの音」グラフで同じ値を使い、
// 挙動をそろえる(NOTE_RELEASE_DBと同じ-68)。これを下回ると「無音」とみなし、メーターは
// 中央・音名なし、グラフは中央ラインに落とす。実機で反応が渋い/敏感すぎる場合はここを調整する。
const SILENCE_VOLUME_DB = -68;

// a4: 基準ピッチ(Hz)。音名判定・セント誤差はこの基準に対する平均律で計算する
// (基準を442Hzにすれば、442Hzちょうどの音がA4・誤差0¢と表示される)
function freqToNote(freq, a4 = 440) {
  if (!freq || freq <= 0) return null;
  const midi = 69 + 12 * Math.log2(freq / a4);
  const rounded = Math.round(midi);
  const centsExact = (midi - rounded) * 100; // メーターを滑らかに動かすための丸めていないセント差
  const cents = Math.round(centsExact);       // 表示用(±0.5¢刻みだと数字が落ち着かないため整数)
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return { name, octave, cents, centsExact, midi };
}

function centsBetween(freqA, freqB) {
  if (!freqA || !freqB) return 0;
  return 1200 * Math.log2(freqA / freqB);
}

function speedOfSound(tempC) {
  return 331.3 + 0.606 * tempC;
}

// ============================================================
// Conical tube model (saxophone) — 検証済み実効長プリセット
// 【注記】この固定プリセットは「最低音1点のみの校正」であり、
// 運指が変わる(音域が変わる)たびに理論値がズレる問題がある。
// 下記の「運指ベース管長自動キャリブレーション」で置き換える。
// ============================================================
const SAX_PRESETS = {
  soprano: { label: "ソプラノ", effectiveLengthCm: 73.3, bellRadiusCm: 0.6 },
  alto: { label: "アルト", effectiveLengthCm: 123.4, bellRadiusCm: 0.8 },
  tenor: { label: "テナー", effectiveLengthCm: 164.8, bellRadiusCm: 1.0 },
  baritone: { label: "バリトン", effectiveLengthCm: 261.7, bellRadiusCm: 1.3 },
};

function conicalTubeHarmonics(effectiveLengthCm, bellRadiusCm, tempC, count) {
  const v = speedOfSound(tempC);
  const L = effectiveLengthCm / 100;
  const bellCorr = 0.6 * (bellRadiusCm / 100);
  const Leff = L + bellCorr;
  const harmonics = [];
  for (let n = 1; n <= count; n++) harmonics.push({ n, freq: (n * v) / (2 * Leff) });
  return harmonics;
}

// ============================================================
// 運指ベース管長自動キャリブレーション
// (Python検証: algo_fingering_calibration.py を移植)
//
// サックスは運指(トーンホール開閉)で気柱長を変える楽器のため、
// 最低音1点だけで校正した固定管長では、音域が変わるたびに
// 理論値(絶対周波数)が実測とズレる。
//
// 対処: サックス共通の運指テーブル(記音ベース)を持ち、楽器種別ごとの
// 移調量・基準ピッチでスケーリングした「正しい実音Hz」を求める。
// 実測基音に最も近い運指をテーブルから検索し、そのHzを理論値の基準にする。
// ============================================================
const NOTE_NAMES_SHARP = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];

// 記音: Low B♭(サックス共通の最低音、MIDI 58相当)からの半音距離でテーブルを構築
const LOW_BB_WRITTEN_MIDI = 58;

function writtenNoteLabel(semitoneFromLowBb) {
  const midi = LOW_BB_WRITTEN_MIDI + semitoneFromLowBb;
  const name = NOTE_NAMES_SHARP[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

// 音名表記統一(D#→E♭, A#→B♭)より前に保存されたセッション/理想値プロファイルには
// 旧表記の音名文字列がそのまま残っているため、読み込み時に一度だけ変換する。
function migrateNoteSpelling(label) {
  if (typeof label !== "string") return label;
  if (label.startsWith("D#")) return "E♭" + label.slice(2);
  if (label.startsWith("A#")) return "B♭" + label.slice(2);
  return label;
}

// 楽器種別ごとの移調(記音→実音): アルト/バリトン=E♭管、ソプラノ/テナー=B♭管
// オクターブ差込みの合計半音移調量
const TRANSPOSITION_SEMITONES = {
  soprano: -2,   // B♭管
  alto: -9,       // E♭管
  tenor: -2 - 12, // B♭管、1オクターブ下
  baritone: -9 - 12, // E♭管、1オクターブ下
};

const A4_MIDI = 69;

function writtenMidiToSoundingFreq(writtenMidi, saxType, tuningHz) {
  const transposition = TRANSPOSITION_SEMITONES[saxType];
  const soundingMidi = writtenMidi + transposition;
  const freq440 = 440 * Math.pow(2, (soundingMidi - A4_MIDI) / 12);
  return freq440 * (tuningHz / 440);
}

// 運指テーブルを生成(Low B♭から約2.5オクターブ分)
function buildFingeringTable(saxType, tuningHz, numNotes = 30) {
  const table = [];
  for (let i = 0; i < numNotes; i++) {
    const writtenMidi = LOW_BB_WRITTEN_MIDI + i;
    const freq = writtenMidiToSoundingFreq(writtenMidi, saxType, tuningHz);
    table.push({ semitoneIndex: i, writtenLabel: writtenNoteLabel(i), soundingFreqHz: freq });
  }
  return table;
}

// 実測周波数に最も近い運指をテーブルから検索(セント距離で比較)
function findClosestFingering(measuredHz, fingeringTable) {
  if (!measuredHz || measuredHz <= 0) return null;
  let best = null;
  let bestAbsCents = Infinity;
  for (const entry of fingeringTable) {
    const cents = 1200 * Math.log2(measuredHz / entry.soundingFreqHz);
    if (Math.abs(cents) < bestAbsCents) {
      bestAbsCents = Math.abs(cents);
      best = { ...entry, centsError: cents };
    }
  }
  return best;
}

// 正しい実音Hzから理論上の管長を逆算(開管モデル、基音の式) — 表示用の物理量
function deriveTubeLengthCm(targetHz, bellRadiusCm, tempC) {
  const v = speedOfSound(tempC);
  const bellCorrM = 0.6 * (bellRadiusCm / 100);
  const LeffM = v / (2 * targetHz);
  return (LeffM - bellCorrM) * 100;
}

// テーブルの正しいHzを基音として整数次倍音列を返す(理論値グラフの基準)
function theoreticalHarmonicsFromTarget(targetHz, count) {
  const harmonics = [];
  for (let n = 1; n <= count; n++) harmonics.push({ n, freq: targetHz * n });
  return harmonics;
}


// ============================================================
// Pitch detection: HPS
// ============================================================
function detectPitchHPS(spectrum, sampleRate, fftSize, minFreq = 50, maxFreq = 1200) {
  const numHarmonics = 5;
  const n = spectrum.length;
  const hps = new Float32Array(n);
  for (let i = 0; i < n; i++) hps[i] = spectrum[i];
  for (let h = 2; h <= numHarmonics; h++) {
    for (let i = 0; i < Math.floor(n / h); i++) hps[i] *= spectrum[i * h];
  }
  const minBin = Math.floor((minFreq * fftSize) / sampleRate);
  const maxBin = Math.min(n - 1, Math.floor((maxFreq * fftSize) / sampleRate));
  let maxVal = -Infinity, maxBinIdx = -1;
  for (let i = minBin; i <= maxBin; i++) {
    if (hps[i] > maxVal) { maxVal = hps[i]; maxBinIdx = i; }
  }
  if (maxBinIdx < 0) return null;
  return (maxBinIdx * sampleRate) / fftSize;
}

function freqToBin(freq, sampleRate, fftSize) {
  return Math.round((freq * fftSize) / sampleRate);
}

// ============================================================
// Timbre metrics
// ============================================================
function spectralCentroid(magnitudeSpectrum, freqs) {
  let magSum = 0, weightedSum = 0;
  for (let i = 0; i < magnitudeSpectrum.length; i++) {
    magSum += magnitudeSpectrum[i];
    weightedSum += freqs[i] * magnitudeSpectrum[i];
  }
  if (magSum < 1e-10) return 0;
  return weightedSum / magSum;
}

function harmonicToNoiseRatio(magnitudeSpectrum, freqs, f0, sampleRate, fftSize, numHarmonics = 8, bandwidthHz = 15) {
  if (!f0) return null;
  let harmonicEnergy = 0, totalEnergy = 0;
  const harmonicBins = new Set();
  for (let n = 1; n <= numHarmonics; n++) {
    const target = f0 * n;
    const centerBin = freqToBin(target, sampleRate, fftSize);
    const bwBins = Math.ceil((bandwidthHz * fftSize) / sampleRate);
    for (let b = centerBin - bwBins; b <= centerBin + bwBins; b++) {
      if (b >= 0 && b < magnitudeSpectrum.length) harmonicBins.add(b);
    }
  }
  for (let i = 0; i < magnitudeSpectrum.length; i++) {
    const power = magnitudeSpectrum[i] * magnitudeSpectrum[i];
    totalEnergy += power;
    if (harmonicBins.has(i)) harmonicEnergy += power;
  }
  const noiseEnergy = totalEnergy - harmonicEnergy;
  if (noiseEnergy < 1e-12) return 60;
  if (harmonicEnergy < 1e-12) return -20;
  return 10 * Math.log10(harmonicEnergy / noiseEnergy);
}

// ============================================================
// Match score: pitch & timbre (Python検証: algo_match_score.py を移植)
// ============================================================
function pitchMatchScore(centsError, toleranceCents = 50) {
  const x = centsError / toleranceCents;
  return Math.exp(-0.5 * x * x);
}

function timbreMatchScore(measuredHarmonicsNorm, referenceHarmonicsNorm, measuredCentroid, referenceCentroid, measuredHnr, referenceHnr) {
  const wHarm = 0.6, wCentroid = 0.25, wHnr = 0.15;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < measuredHarmonicsNorm.length; i++) {
    dot += measuredHarmonicsNorm[i] * referenceHarmonicsNorm[i];
    normA += measuredHarmonicsNorm[i] ** 2;
    normB += referenceHarmonicsNorm[i] ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  const harmScore = denom > 1e-10 ? Math.max(0, dot / denom) : 0;

  const relErr = referenceCentroid > 0 ? Math.abs(measuredCentroid - referenceCentroid) / referenceCentroid : 1;
  const centroidScore = Math.exp(-3.0 * relErr);

  const hnrDiff = Math.abs((measuredHnr ?? 0) - (referenceHnr ?? 0));
  const hnrScore = Math.exp(-hnrDiff / 15.0);

  const total = wHarm * harmScore + wCentroid * centroidScore + wHnr * hnrScore;
  return Math.min(1, Math.max(0, total));
}

function scoreToColor(score) {
  const s = Math.min(1, Math.max(0, score));
  // ライトモード(白背景)で視認できる濃色: 0.0=赤#DC2626 / 0.5=アンバー#D97706 / 1.0=緑#16A34A
  const stops = [
    [0.0, [0xdc, 0x26, 0x26]],
    [0.5, [0xd9, 0x77, 0x06]],
    [1.0, [0x16, 0xa3, 0x4a]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [s0, c0] = stops[i];
    const [s1, c1] = stops[i + 1];
    if (s >= s0 && s <= s1) {
      const t = s1 !== s0 ? (s - s0) / (s1 - s0) : 0;
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r},${g},${b})`;
    }
  }
  return "rgb(22,163,74)";
}

// ============================================================
// リード総合評価スコア (Python検証: algo_reed_score.py を移植)
// 企画書v5 10.4(c)節: HNR30% / 音量安定性25% / ピッチ安定性25% / 重心近似度20%
// ============================================================
function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function normalizeHnr(hnrValues, refMin = 0, refMax = 30) {
  if (!hnrValues.length) return 0.5;
  const avg = mean(hnrValues);
  return Math.min(1, Math.max(0, (avg - refMin) / (refMax - refMin)));
}

function stabilityScore(values, tolerance) {
  const sd = stddev(values);
  if (sd === null) return 0.5;
  return Math.exp(-sd / tolerance);
}

function closenessToIdealScore(measuredAvg, idealValue, tolerance) {
  if (idealValue === null || idealValue === undefined || idealValue === 0) return null;
  const relErr = Math.abs(measuredAvg - idealValue) / Math.abs(idealValue);
  return Math.exp(-relErr / tolerance);
}

// sessions: このリードに紐づく複数セッションのフレームを平坦化した配列を想定
// { hnrValues: number[], volumeDbValues: number[], pitchCentsErrorValues: number[], centroidClosenessValues: number[] }
// centroidClosenessValuesは呼び出し側で「フレームごとに、その音に対応する理想値との近さ」を
// 算出済みの配列(理想値は音ごとに異なるため、平均重心を単一の理想値と比較する方式は使えない)。
function reedCompositeScore(input) {
  const weights = { hnr: 0.3, volumeStability: 0.25, pitchStability: 0.25, centroidCloseness: 0.2 };

  const hnrScore = normalizeHnr(input.hnrValues.filter((v) => v !== null && v !== undefined));
  const volumeStability = stabilityScore(input.volumeDbValues, 3.0);
  const pitchStability = stabilityScore(input.pitchCentsErrorValues, 20.0);

  let centroidScore = null;
  if (input.centroidClosenessValues?.length) {
    centroidScore = mean(input.centroidClosenessValues);
  }

  let composite, breakdown;
  if (centroidScore === null) {
    const remaining = weights.hnr + weights.volumeStability + weights.pitchStability;
    const wHnr = weights.hnr / remaining;
    const wVol = weights.volumeStability / remaining;
    const wPitch = weights.pitchStability / remaining;
    composite = wHnr * hnrScore + wVol * volumeStability + wPitch * pitchStability;
    breakdown = { hnr: hnrScore, volumeStability, pitchStability, centroidCloseness: null };
  } else {
    composite =
      weights.hnr * hnrScore +
      weights.volumeStability * volumeStability +
      weights.pitchStability * pitchStability +
      weights.centroidCloseness * centroidScore;
    breakdown = { hnr: hnrScore, volumeStability, pitchStability, centroidCloseness: centroidScore };
  }

  return { composite: Math.min(1, Math.max(0, composite)), breakdown };
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 運指の半音インデックスから音域帯(low/mid/high)を判定する分類(分析タブのクロス集計で使用)。
// 運指(記音)は全楽器共通のため閾値も楽器によらず1つで済む。境界は各楽器の実音での
// 指定(例: アルト低音域=A4以下、中音域=A5〜B♭4、高音域=B♭5以上)を記音の半音
// インデックスに変換したもので、移調量が異なっていても4楽器すべてで同じ値になる
// (低音域<=20=記音F♯5、中音域21〜32=記音G5〜F♯6、高音域>=33=記音G6以上)。
function registerBand(semitoneIndex, lowMax = 20, midMax = 32) {
  if (semitoneIndex === null || semitoneIndex === undefined) return "unknown";
  if (semitoneIndex <= lowMax) return "low";
  if (semitoneIndex <= midMax) return "mid";
  return "high";
}

const REGISTER_BAND_LABELS = { low: "低音域", mid: "中音域", high: "高音域", unknown: "不明" };

// ============================================================
// リード登録用マスタデータ
// 銘柄: 初期リスト(一般的なメーカー) + ユーザーが自由入力した銘柄を自動追加
// 番手: 2.0〜4.0を0.5刻み
// ============================================================
const INITIAL_REED_BRANDS = [
  "Vandoren", "Rico (D'Addario)", "Légère", "Marca", "Rigotti", "Silverstein", "Alexander",
];

const REED_STRENGTHS = ["2.0", "2.5", "3.0", "3.5", "4.0"];

const REED_BOX_SIZE = 10; // リード1箱あたりの枚数

// ============================================================
// リードのグルーピング・表示名ヘルパー
// 銘柄・番手・使用開始日が同じリードは「同じ箱」とみなし、
// 登録順(createdAt)で1からの通し番号を振る。一覧表示・データ分析での
// 個体識別(#N)に共通して使う。
// ============================================================
function reedGroupKey(r) {
  return `${r.brand}|${r.strength}|${r.startDate}`;
}

function groupReeds(reeds) {
  const groups = {};
  for (const r of reeds) {
    const key = reedGroupKey(r);
    if (!groups[key]) groups[key] = { key, brand: r.brand, strength: r.strength, startDate: r.startDate, members: [] };
    groups[key].members.push(r);
  }
  for (const g of Object.values(groups)) {
    // 表示順(sortOrder)は長押し並び替えで変わるが、管理番号(boxNumber)とは独立させている。
    // sortOrder未設定のものは登録順で後ろに続ける。
    g.members.sort((a, b) => {
      const an = a.sortOrder ?? Infinity;
      const bn = b.sortOrder ?? Infinity;
      if (an !== bn) return an - bn;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  }
  return Object.values(groups).sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
}

function reedPosition(reed, reeds) {
  if (reed.boxNumber) return reed.boxNumber; // 手動で編集された番号があれば自動採番より優先する
  const key = reedGroupKey(reed);
  const group = reeds.filter((r) => reedGroupKey(r) === key).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const idx = group.findIndex((r) => r.id === reed.id);
  return idx >= 0 ? idx + 1 : null;
}

function shortDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function reedLabel(reed, reeds) {
  if (!reed) return "";
  const pos = reedPosition(reed, reeds);
  return `${reed.brand} ${reed.strength} #${pos}(${shortDate(reed.startDate)})`;
}

// ============================================================
// データ永続化(IndexedDB)
//
// 「データを撮りためることで検証の質が上がる」という方針のため、
// リード・セッション・理想値プロファイルはページのリロードや再訪問を
// またいで残す必要がある。localStorage(5〜10MB程度)はフレーズ録音の
// フレーム列(100ms間隔)が積み重なるとすぐ枯渇するため、より大きな
// クォータを持つIndexedDBを使う。単一のkvストアにキー毎の値を丸ごと
// 保存する単純な方式(このアプリの規模ではクエリ機能は不要なため)。
// ============================================================
const IDB_NAME = "windToneLabDB";
const IDB_STORE = "kv";
const SESSIONS_STORE = "sessions"; // セッションはレコード単位のストア(理由は下記usePersistedState/useSessionsStoreのコメント参照)
const IDB_VERSION = 2;

function openIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("indexedDB unavailable")); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) db.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined; // プライベートブラウジング等でIndexedDBが使えない場合は諦めて初期値を使う
  }
}

async function idbSet(key, value) {
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 書き込み失敗時も画面操作自体は継続させる(永続化できないだけに留める)
  }
}

// key別にIndexedDBへ自動保存するstateフック。マウント時に非同期で読み込み、
// 以後の変更は逐次書き込む(読み込み完了前の書き込みで初期値により上書きしないようloadedRefで防ぐ)。
function usePersistedState(key, initialValue) {
  const [state, setState] = useState(initialValue);
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    idbGet(key).then((saved) => {
      if (cancelled) return;
      if (saved !== undefined) setState(saved);
      loadedRef.current = true;
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loadedRef.current) idbSet(key, state);
  }, [key, state]);

  return [state, setState];
}

// --- セッション専用のレコード単位ストア -------------------------------
// 【重要】録音停止のたびに10秒以上のラグが発生していた原因はこれだった。
// usePersistedStateはstateが変わるたび配列全体をIndexedDBに書き込むため、
// セッション履歴(フレーム列を含む)が蓄積するほど1回の書き込みが重くなり、
// 「データを撮りためる」というアプリの目的そのものと衝突していた。
// セッションだけはkeyPath:"id"の専用ストアにして、変更のあった1件だけを
// put/deleteする方式にし、書き込みコストをセッション総数と切り離す。
async function idbGetAllSessions() {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, "readonly");
      const req = tx.objectStore(SESSIONS_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function idbPutSessions(sessionsToWrite) {
  if (sessionsToWrite.length === 0) return;
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, "readwrite");
      const store = tx.objectStore(SESSIONS_STORE);
      for (const s of sessionsToWrite) store.put(s);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 書き込み失敗時も画面操作自体は継続させる
  }
}

async function idbDeleteSessions(ids) {
  if (ids.length === 0) return;
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, "readwrite");
      const store = tx.objectStore(SESSIONS_STORE);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 削除失敗時も画面操作自体は継続させる
  }
}

// sessions配列をReact state上では今まで通り扱いつつ、書き込みだけは変更のあった
// レコードに限定する。addSession: 新規1件追加。updateSessions: 関数更新の結果、
// 中身が変わったレコードだけを差分検出してIndexedDBに書き込む。
function useSessionsStore() {
  const [sessions, setSessionsState] = useState([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    idbGetAllSessions().then((all) => {
      if (cancelled) return;
      // 音名表記統一(D#→E♭, A#→B♭)より前に保存されたフレームの音名表記を一度だけ変換して書き戻す
      const migrated = all.map((s) => {
        const frames = s.frames;
        if (!frames?.some((f) => f.matchedWrittenNote?.startsWith("D#") || f.matchedWrittenNote?.startsWith("A#"))) return s;
        return { ...s, frames: frames.map((f) => (f.matchedWrittenNote ? { ...f, matchedWrittenNote: migrateNoteSpelling(f.matchedWrittenNote) } : f)) };
      });
      const changed = migrated.filter((s, i) => s !== all[i]);
      if (changed.length > 0) idbPutSessions(changed);
      setSessionsState(migrated);
      loadedRef.current = true;
    });
    return () => { cancelled = true; };
  }, []);

  const addSession = useCallback((session) => {
    setSessionsState((prev) => [...prev, session]);
    idbPutSessions([session]);
  }, []);

  const updateSessions = useCallback((updater) => {
    setSessionsState((prev) => {
      const next = updater(prev);
      const prevById = new Map(prev.map((s) => [s.id, s]));
      const changed = next.filter((s) => prevById.get(s.id) !== s);
      if (changed.length > 0) idbPutSessions(changed);
      return next;
    });
  }, []);

  const deleteSessions = useCallback((ids) => {
    const idSet = new Set(ids);
    setSessionsState((prev) => prev.filter((s) => !idSet.has(s.id)));
    idbDeleteSessions(ids);
  }, []);

  return [sessions, addSession, updateSessions, deleteSessions];
}

// ============================================================
// アップロード音声の解析
//
// マイク入力(ライブ)と同じ解析パイプラインを、アップロードされた音声/動画ファイルにかける。
// 1フレーム分の解析ロジックはcreateFrameAnalyzer()に切り出し、
// 「AudioBufferを取れた場合(高速なオフライン処理)」「取れなかった場合
// (動画コンテナ等、<video>要素での再生を通す実時間フォールバック)」の
// 両方から共通で使う。
// ============================================================

// 1フレーム分の解析(ピッチ・倍音・ノート区間検出)を行う共通ロジック。
// analyser/sampleRate/経過時間(ms)を渡すたびに呼び、必要ならframesに1件追加する。
// オフライン解析(analyzeAudioBuffer)・リアルタイム解析(analyzeMediaFile)の両方から呼ばれる。
function createFrameAnalyzer({ saxType, tuningHz, instrumentOffsetCents, temperature, selectedIdeal }) {
  const preset = SAX_PRESETS[saxType];
  const fingeringTable = buildFingeringTable(saxType, tuningHz * Math.pow(2, instrumentOffsetCents / 1200), 30);
  const FFT_SIZE = 8192;
  const NUM_HARMONICS = 8;
  const SAMPLE_INTERVAL_MS = 100;
  const NOTE_ONSET_DB = -58; // 管楽器のピアニッシモ程度の弱い入力でも発音開始として拾えるよう低めに設定
  const NOTE_RELEASE_DB = -68;
  const ATTACK_WINDOW_MS = 400;

  const frames = [];
  const noteDetector = { phase: "silence", onsetMs: 0, peakDb: -100, samples: [], events: [] };
  let lastSampleMs = -Infinity;

  const tick = (analyser, sampleRate, elapsedMs) => {
    const freqData = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(freqData);
    const linear = new Float32Array(freqData.length);
    for (let i = 0; i < freqData.length; i++) {
      const db = freqData[i];
      linear[i] = db < -100 ? 0 : Math.pow(10, db / 20);
    }
    const freqs = new Float32Array(linear.length);
    for (let i = 0; i < linear.length; i++) freqs[i] = (i * sampleRate) / FFT_SIZE;

    let sumSquares = 0;
    for (let i = 0; i < linear.length; i++) sumSquares += linear[i] * linear[i];
    const rms = Math.sqrt(sumSquares / linear.length);
    const vDb = 20 * Math.log10(rms + 1e-10);

    const centroid = spectralCentroid(linear, freqs);
    const f0 = detectPitchHPS(linear, sampleRate, FFT_SIZE);

    let levels = [];
    let hnr = null;
    let matchedFinger = null;
    if (f0 && f0 > 40) {
      matchedFinger = findClosestFingering(f0, fingeringTable);
      for (let n = 1; n <= NUM_HARMONICS; n++) {
        const targetFreq = f0 * n;
        const bin = freqToBin(targetFreq, sampleRate, FFT_SIZE);
        let peak = 0;
        for (let b = Math.max(0, bin - 2); b <= bin + 2; b++) {
          if (linear[b] !== undefined) peak = Math.max(peak, linear[b]);
        }
        levels.push({ n, freq: targetFreq, mag: peak });
      }
      const maxMag = Math.max(...levels.map((l) => l.mag), 1e-6);
      levels = levels.map((l) => ({ ...l, norm: l.mag / maxMag }));
      hnr = harmonicToNoiseRatio(linear, freqs, f0, sampleRate, FFT_SIZE, NUM_HARMONICS);
    }

    // --- ノート区間分割・アタック時間検出(企画書2.4節相当) ---
    {
      const det = noteDetector;
      if (det.phase === "silence") {
        if (vDb > NOTE_ONSET_DB) {
          det.phase = "attack"; det.onsetMs = elapsedMs; det.peakDb = vDb; det.samples = [{ t: elapsedMs, vDb }];
        }
      } else if (det.phase === "attack") {
        det.samples.push({ t: elapsedMs, vDb });
        if (vDb > det.peakDb) det.peakDb = vDb;
        if (vDb < NOTE_RELEASE_DB) {
          det.phase = "silence";
        } else if (elapsedMs - det.onsetMs >= ATTACK_WINDOW_MS) {
          const target = det.peakDb - 3;
          const hit = det.samples.find((s) => s.vDb >= target);
          const attackTimeMs = hit ? Math.round(hit.t - det.onsetMs) : null;
          det.events.push({ startT: det.onsetMs / 1000, endT: null, attackTimeMs, peakVolumeDb: det.peakDb });
          det.phase = "sustain"; det.samples = [];
        }
      } else if (det.phase === "sustain") {
        if (vDb > det.peakDb) det.peakDb = vDb;
        if (vDb < NOTE_RELEASE_DB) {
          const last = det.events[det.events.length - 1];
          if (last && last.endT === null) { last.endT = elapsedMs / 1000; last.peakVolumeDb = det.peakDb; }
          det.phase = "silence";
        }
      }
    }

    if (elapsedMs - lastSampleMs >= SAMPLE_INTERVAL_MS) {
      lastSampleMs = elapsedMs;
      const theoFreq = matchedFinger?.soundingFreqHz ?? null;
      const pitchCentsVsTheory = f0 && theoFreq ? centsBetween(f0, theoFreq) : null;
      // 理想値は音(運指の半音インデックス)ごとに持つため、今判定されている音に対応する理想値を都度引く
      const noteIdeal = getNoteIdeal(selectedIdeal, matchedFinger?.semitoneIndex);
      const pitchCentsVsIdeal = f0 && noteIdeal?.pitchHz ? centsBetween(f0, noteIdeal.pitchHz) : null;
      const harmNorm = levels.length === NUM_HARMONICS ? levels.map((l) => l.norm) : new Array(NUM_HARMONICS).fill(0);
      const idealHarmNorm = noteIdeal?.harmonicsProfile ? noteIdeal.harmonicsProfile.map((h) => h.norm) : new Array(NUM_HARMONICS).fill(0);
      const pitchScoreTheory = pitchCentsVsTheory !== null ? pitchMatchScore(pitchCentsVsTheory) : 0;
      const pitchScoreIdeal = pitchCentsVsIdeal !== null ? pitchMatchScore(pitchCentsVsIdeal) : 0;
      const timbreScoreIdeal = noteIdeal
        ? timbreMatchScore(harmNorm, idealHarmNorm, centroid, noteIdeal.centroidHz, hnr, noteIdeal.hnrDb)
        : 0;

      frames.push({
        t: elapsedMs / 1000,
        pitchHz: f0,
        pitchCents: pitchCentsVsTheory,
        matchedWrittenNote: matchedFinger?.writtenLabel ?? null,
        semitoneIndex: matchedFinger?.semitoneIndex ?? null,
        derivedTubeLengthCm: matchedFinger ? deriveTubeLengthCm(matchedFinger.soundingFreqHz, preset.bellRadiusCm, temperature) : null,
        volumeDb: vDb,
        spectralCentroidHz: centroid,
        hnrDb: hnr,
        harmonics: levels.map((l) => ({ n: l.n, freqHz: l.freq, levelNorm: l.norm })),
        matchScore: {
          pitch: { theoretical: pitchScoreTheory, ideal: pitchScoreIdeal },
          timbre: { ideal: timbreScoreIdeal },
        },
      });
    }
  };

  return { tick, frames, noteEvents: noteDetector.events };
}

// radix-2の反復型FFT(in-place)。アップロード解析でAnalyserNode相当のスペクトルを
// 自前計算するために使う。ブラウザのOfflineAudioContext+ScriptProcessorNodeは
// Safari(iPhone含む)でレンダリングが永遠に完了しない既知の不具合があるため、
// オーディオグラフに頼らずデコード済みPCMを直接処理する。
function fftRadix2(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const vRe = re[b] * curRe - im[b] * curIm;
        const vIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - vRe; im[b] = im[a] - vIm;
        re[a] += vRe; im[a] += vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

// AudioBufferを直接デコードできた場合の高速パス。デコード済みPCMを25ms刻みで
// 自前FFTにかけ、ライブ計測と同じtick()パイプラインに流す。再生を伴わないため
// ファイル長に関係なく数秒で完了し、ブラウザの自動再生ポリシーやオーディオグラフの
// 実装差の影響も受けない。UIをブロックしないよう30msごとにイベントループへ譲る。
function analyzeAudioBuffer(audioBuffer, opts) {
  const { onProgress } = opts;
  const FFT_SIZE = 8192;
  const HOP_MS = 25; // ノート検出の音量エンベロープ追跡に十分な分解能(ライブ時のrAF≒16msに近い)
  const fa = createFrameAnalyzer(opts);
  const sampleRate = audioBuffer.sampleRate;
  const n = audioBuffer.length;

  // モノラルにミックスダウン
  const mono = new Float32Array(n);
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < n; i++) mono[i] += data[i] / audioBuffer.numberOfChannels;
  }

  // AnalyserNodeと同じBlackman窓・1/Nスケール・時間平滑(0.6)を再現し、
  // ライブ計測と同じdBスケール(音量閾値など)で解析できるようにする
  const win = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    win[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE) + 0.08 * Math.cos((4 * Math.PI * i) / FFT_SIZE);
  }
  const bins = FFT_SIZE / 2;
  const smoothed = new Float32Array(bins);
  const dbOut = new Float32Array(bins).fill(-200);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  // fa.tick()はAnalyserNode互換のインターフェースだけを使うため、互換オブジェクトを渡す
  const analyserLike = {
    frequencyBinCount: bins,
    getFloatFrequencyData: (out) => out.set(dbOut),
  };

  const hop = Math.max(1, Math.round((sampleRate * HOP_MS) / 1000));
  return new Promise((resolve) => {
    let pos = 0;
    // チャンク間のyieldにはsetTimeoutではなくMessageChannelを使う。
    // setTimeoutはタブが非アクティブだと1回/秒以下に絞られ、解析が何十秒もかかったり
    // 止まったように見える。MessageChannelのpostMessageはこの絞りを受けない。
    const channel = new MessageChannel();
    const processChunk = () => {
      const deadline = performance.now() + 30;
      while (pos + FFT_SIZE <= n && performance.now() < deadline) {
        for (let i = 0; i < FFT_SIZE; i++) { re[i] = mono[pos + i] * win[i]; im[i] = 0; }
        fftRadix2(re, im);
        for (let k = 0; k < bins; k++) {
          const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / FFT_SIZE;
          smoothed[k] = 0.6 * smoothed[k] + 0.4 * mag;
          dbOut[k] = smoothed[k] > 1e-10 ? 20 * Math.log10(smoothed[k]) : -200;
        }
        fa.tick(analyserLike, sampleRate, ((pos + FFT_SIZE) / sampleRate) * 1000);
        pos += hop;
      }
      if (onProgress) onProgress(Math.min(1, pos / n));
      if (pos + FFT_SIZE <= n) {
        channel.port2.postMessage(null);
      } else {
        channel.port1.onmessage = null;
        resolve({ frames: fa.frames, noteEvents: fa.noteEvents });
      }
    };
    channel.port1.onmessage = processChunk;
    processChunk();
  });
}

// decodeAudioDataでデコードできなかったファイル(動画コンテナ等、ブラウザによっては
// 音声トラックの取り出しに対応しないことがある)向けのフォールバック。
// 実際に<video>要素で再生し、AnalyserNode経由でtickにかける。
// オフライン処理ができないため、解析にはファイルの再生時間と同じだけ実時間がかかる。
// ハング防止のため、メタデータ読み込み・再生停滞・全体時間のそれぞれに見張りを置く。
function analyzeMediaFile(file, opts) {
  const { onProgress } = opts;
  const FFT_SIZE = 8192;
  const fa = createFrameAnalyzer(opts);

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const mediaEl = document.createElement("video"); // 音声のみのファイルも<video>要素で再生可能
    mediaEl.src = url;
    mediaEl.preload = "auto";
    mediaEl.playsInline = true; // iOSで全画面再生に切り替わるのを防ぐ
    // 【注記】muted=trueにするとブラウザによってはMediaElementAudioSourceNodeが受け取る
    // 信号自体が無音になり解析が空振りするため、ミュートはしない。要素の音声出力は
    // オーディオグラフに引き込まれるので、下のsilentGain(=0)経由でスピーカーには出ない。

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.6;
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;

    let rafId;
    let finished = false;
    const timers = [];
    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (rafId) cancelAnimationFrame(rafId);
      timers.forEach(clearTimeout);
      try { mediaEl.pause(); } catch { /* noop */ }
      mediaEl.removeAttribute("src");
      try { audioCtx.close(); } catch { /* noop */ }
      URL.revokeObjectURL(url);
    };
    const fail = (message) => { cleanup(); reject(new Error(message)); };

    mediaEl.onerror = () => fail("この形式のファイルは読み込めませんでした（動画の場合、コーデック非対応の可能性があります）");

    // メタデータがいつまでも来ない(コンテナを解釈できない等)場合の見張り
    timers.push(setTimeout(() => { if (!finished && mediaEl.readyState === 0) fail("ファイルの読み込みがタイムアウトしました"); }, 20000));

    mediaEl.onloadedmetadata = () => {
      if (finished) return;
      let sourceNode;
      try {
        sourceNode = audioCtx.createMediaElementSource(mediaEl);
      } catch (err) {
        fail(err?.message ?? String(err));
        return;
      }
      sourceNode.connect(analyser);
      analyser.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      const duration = Number.isFinite(mediaEl.duration) ? mediaEl.duration : 0;

      const finish = () => {
        if (finished) return;
        cleanup();
        resolve({ frames: fa.frames, noteEvents: fa.noteEvents });
      };

      // 再生時間+15秒経っても終わらなければ打ち切る(デコード停止などでendedが来ないケースの保険)
      if (duration > 0) timers.push(setTimeout(() => { if (!finished) fail("解析がタイムアウトしました"); }, (duration + 15) * 1000));

      // 再生位置が10秒間進まなければ停滞とみなす
      let lastTime = -1;
      let lastAdvance = performance.now();

      const tick = () => {
        if (finished) return;
        // 経過時間は壁時計ではなく再生位置を使う(バッファリング等で再生が波打っても音声内の時刻と一致する)
        const elapsedMs = mediaEl.currentTime * 1000;
        fa.tick(analyser, audioCtx.sampleRate, elapsedMs);
        if (onProgress && duration) onProgress(Math.min(1, mediaEl.currentTime / duration));
        if (mediaEl.currentTime !== lastTime) { lastTime = mediaEl.currentTime; lastAdvance = performance.now(); }
        else if (performance.now() - lastAdvance > 10000) { fail("再生が進まないため解析を中断しました"); return; }
        if (mediaEl.ended) { finish(); return; }
        rafId = requestAnimationFrame(tick);
      };

      mediaEl.onended = finish;
      audioCtx.resume().catch(() => { /* noop */ });
      mediaEl.play().then(() => {
        rafId = requestAnimationFrame(tick);
      }).catch(() => {
        fail("ブラウザが再生をブロックしました。もう一度お試しください");
      });
    };
  });
}

// ============================================================
// Main component
// ============================================================
export default function WindToneLabPhaseMode() {
  const [topTab, setTopTab] = useState("measure"); // "measure" | "reeds" | "analysis"
  const [reedsSubTab, setReedsSubTab] = useState("register"); // 「リード」タブ内の子タブ: register | compare | ranking
  const [compareReedIds, setCompareReedIds] = useState([]); // 「比較」タブで選択中のリード(タブ切替をまたいで保持)
  // isListening: マイク+ライブ表示が有効か(計測タブ滞在中は自動でON/OFF)。
  // isRecording: 録音ボタンで蓄積中かどうか(セッションとして保存されるのはこの間のフレームのみ)。
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [pitch, setPitch] = useState(null);
  const [harmonicLevels, setHarmonicLevels] = useState([]);
  const [spectrumBars, setSpectrumBars] = useState(new Array(64).fill(0));
  const [volumeDb, setVolumeDb] = useState(-100);
  const [centroidHz, setCentroidHz] = useState(0);
  const [hnrDb, setHnrDb] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const [saxType, setSaxType] = usePersistedState("saxType", "alto");
  const [temperature, setTemperature] = useState(20);
  const [tuningHz, setTuningHz] = usePersistedState("tuningHz", 442); // 基準ピッチ: 440〜444Hzのボタン、デフォルト442Hz
  const [instrumentOffsetCents, setInstrumentOffsetCents] = usePersistedState("instrumentOffsetCents", 0); // 楽器個体差の補正(セント)。運指テーブル全体をシフトする(企画書3節末尾の注記への対応)
  const [showIdeal, setShowIdeal] = useState(true);

  // 理想値プロファイルは「撮りためたデータ」の中核のひとつのため永続化する
  const [idealProfiles, setIdealProfiles] = usePersistedState("idealProfiles", []);
  const [selectedIdealId, setSelectedIdealId] = usePersistedState("selectedIdealId", null);

  // 音名表記統一(D#→E♭, A#→B♭)より前に保存された理想値プロファイルのwrittenLabelを
  // 読み込み後に一度だけ変換する(セッション側はuseSessionsStoreの読み込み時に対応済み)。
  useEffect(() => {
    const needsMigration = idealProfiles.some((p) =>
      Object.values(p.notes || {}).some((n) => n.writtenLabel?.startsWith("D#") || n.writtenLabel?.startsWith("A#"))
    );
    if (!needsMigration) return;
    setIdealProfiles((prev) => prev.map((p) => ({
      ...p,
      notes: Object.fromEntries(Object.entries(p.notes || {}).map(([k, n]) => [k, { ...n, writtenLabel: migrateNoteSpelling(n.writtenLabel) }])),
    })));
  }, [idealProfiles, setIdealProfiles]);

  // --- 運指ベース管長自動キャリブレーション state ---
  const [matchedFingering, setMatchedFingering] = useState(null); // 直近フレームで判定された運指(理論値計算の基準に使う)

  // --- 録音結果の時系列データ(単音/フレーズの区別はnoteEvents数から事後判定する) ---
  // タイムライン表示切替・ドリルダウン選択の状態はPhraseTimelineコンポーネント内にローカル化した
  const [phraseFrames, setPhraseFrames] = useState([]); // データ構造は企画書3節のframesに準拠

  // --- リード管理 state (企画書v5 10節) ---
  // reeds/sessionsは練習を重ねるほど価値が増す蓄積データのため、IndexedDBに永続化する(usePersistedState)
  const [reeds, setReeds] = usePersistedState("reeds", []); // リードマスタ一覧
  const [sessions, addSession, updateSessions, deleteSessions] = useSessionsStore(); // 録音セッション一覧(reedIdで紐付け、10.5節のsessionWithReedに準拠。レコード単位で永続化)
  const [selectedReedId, setSelectedReedId] = usePersistedState("selectedReedId", null); // 録音前に選択する「今回使うリード」

  // --- 奏者(演奏者)管理 ---
  // 「自分」は常に選べる固定選択肢。ユーザーが「名前を入力」で追加した名前をperformersに積み上げていく
  const [performers, setPerformers] = usePersistedState("performers", []);
  const [selectedPerformer, setSelectedPerformer] = usePersistedState("selectedPerformer", "自分");

  // --- 音声ファイルアップロード解析(分析タブ) ---
  const [isAnalyzingUpload, setIsAnalyzingUpload] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [lastUploadedSession, setLastUploadedSession] = useState(null); // 解析完了直後に「理想値に設定」を出すため

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const phraseStartTimeRef = useRef(null);
  const lastSampleTimeRef = useRef(0);
  const phraseFramesRef = useRef([]); // stop()のクロージャから最新フレーム配列を参照するためのref

  // --- 常時ライブのタイムライン用ローリングバッファ ---
  // 録音(isRecording)開始前でも、マイク接続中(tick稼働中)は直近30秒分のフレームを
  // 保持し続け、タイムラインを録音の有無によらず常時動かす。セッション保存には使わない
  // 使い捨てのバッファなので、録音中のphraseFramesとは別に持つ(録音ロジックには触れない)。
  const [liveFrames, setLiveFrames] = useState([]);
  const liveStartTimeRef = useRef(null);
  const lastLiveSampleTimeRef = useRef(0);
  const LIVE_WINDOW_MAX_FRAMES = 300; // 100ms間隔で約30秒分(「これまでの音」ミニタイムラインが必要とする幅)

  // --- ノート区間分割・アタック時間検出(企画書2.4節のnoteEvents、rAFレートで検出) ---
  // 100msフレームではアタック(典型20〜100ms)を測れないため、tick毎(約60fps)に音量エンベロープを監視する。
  // 状態機械: silence → attack(立ち上がり計測中) → sustain → (音量低下で) silence
  const noteDetectorRef = useRef({ phase: "silence", onsetMs: 0, peakDb: -100, samples: [], events: [] });
  const [phraseNoteEvents, setPhraseNoteEvents] = useState([]);
  const NOTE_ONSET_DB = -58;   // 無音→発音の閾値(管楽器のピアニッシモ程度から拾えるよう低めに設定)
  const NOTE_RELEASE_DB = -68; // 発音→無音の閾値(ヒステリシスでバタつきを防ぐ)
  const ATTACK_WINDOW_MS = 400; // アタック確定までの観測窓
  const SAMPLE_INTERVAL_MS = 100;

  const FFT_SIZE = 8192;
  const NUM_HARMONICS = 8;
  const preset = SAX_PRESETS[saxType];

  // 運指テーブルは saxType / tuningHz / 個体差オフセット が変わった時だけ再計算。
  // 個体差オフセット(セント)は基準ピッチに乗算する形でテーブル全体をシフトする:
  //   実効基準Hz = tuningHz × 2^(offsetCents/1200)
  const fingeringTable = useMemo(
    () => buildFingeringTable(saxType, tuningHz * Math.pow(2, instrumentOffsetCents / 1200), 30),
    [saxType, tuningHz, instrumentOffsetCents]
  );

  // 理論値の基音は「実測に最も近い運指の正しいHz」を基準にする(未検出時はプリセットのフォールバック)
  const theoreticalBaseFreq = matchedFingering?.soundingFreqHz ?? conicalTubeHarmonics(preset.effectiveLengthCm, preset.bellRadiusCm, temperature, 1)[0].freq;
  const theoreticalHarmonics = theoreticalHarmonicsFromTarget(theoreticalBaseFreq, NUM_HARMONICS);

  // 【注記】音色一致度は理論値基準を持たない方針とした(企画書v3 2.8節参照)。
  // 理論モデルは絶対周波数のみを持ち、倍音の相対強度情報を持たないため、
  // 倍音パターン比較の基準として使うと精度が低くなるのが理由。
  // ピッチ一致度のみ、理論値(運指テーブル)・理想値の両方を基準として選べる。

  const selectedIdeal = idealProfiles.find((p) => p.id === selectedIdealId) || null;

  // マイクは計測タブ滞在中ずっと繋ぎっぱなしにする(録音の開始/停止では繋ぎ直さない)ため、
  // tick()は長寿命のクロージャになる。設定変更(サックス種別・基準ピッチ・気温・理想値等)を
  // 反映するため、クロージャ変数ではなくrefから毎回読む。
  const fingeringTableRef = useRef(fingeringTable);
  const presetRef = useRef(preset);
  const temperatureRef = useRef(temperature);
  const selectedIdealRef = useRef(selectedIdeal);
  const isRecordingRef = useRef(false);
  useEffect(() => { fingeringTableRef.current = fingeringTable; }, [fingeringTable]);
  useEffect(() => { presetRef.current = preset; }, [preset]);
  useEffect(() => { temperatureRef.current = temperature; }, [temperature]);
  useEffect(() => { selectedIdealRef.current = selectedIdeal; }, [selectedIdeal]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);

  // 録音中に蓄積したフレームがあればセッションとして保存する(企画書v5 10.3節)。
  // reedIdは選択されていればそのまま紐付け、未選択ならnull(後で事後紐付け可能)。
  // memo(「何を変えて試したか」の自由記述)は計測タブでは入力せず、分析タブのセッション詳細から後付けで編集する。
  const finalizeRecording = useCallback(() => {
    if (phraseFramesRef.current.length > 0) {
      const session = {
        id: generateId(),
        recordedAt: new Date().toISOString(),
        saxType,
        reedId: selectedReedId,
        linkedAt: selectedReedId ? "eager" : null,
        memo: null,
        performer: selectedPerformer,
        source: "live",
        frames: phraseFramesRef.current,
        noteEvents: noteDetectorRef.current.events, // ノート区間分割・アタック時間(企画書2.4節・4節のnoteEvents)
      };
      addSession(session);
    }
  }, [saxType, selectedReedId, selectedPerformer, addSession]);

  // マイクを止める(計測タブを離れたときに呼ぶ)。録音中に離脱した場合の保険としてここでも保存する。
  const stopListening = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") audioCtxRef.current.close();
    if (isRecordingRef.current) finalizeRecording();
    setIsRecording(false);
    setIsListening(false);
  }, [finalizeRecording]);

  // マイクへの接続自体はrefのみで完結させ、依存配列は空にする(サックス種別等の変更で
  // マイクを繋ぎ直す必要はない。tick()は設定値をrefから読むため常に最新の値を反映できる)。
  const startListening = useCallback(async () => {
    setErrorMsg("");
    liveStartTimeRef.current = null;
    lastLiveSampleTimeRef.current = 0;
    setLiveFrames([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsListening(true);

      const tick = () => {
        const analyserNode = analyserRef.current;
        if (!analyserNode) return;
        const freqData = new Float32Array(analyserNode.frequencyBinCount);
        analyserNode.getFloatFrequencyData(freqData);

        const linear = new Float32Array(freqData.length);
        for (let i = 0; i < freqData.length; i++) {
          const db = freqData[i];
          linear[i] = db < -100 ? 0 : Math.pow(10, db / 20);
        }

        const sampleRate = audioCtx.sampleRate;
        const freqs = new Float32Array(linear.length);
        for (let i = 0; i < linear.length; i++) freqs[i] = (i * sampleRate) / FFT_SIZE;

        let sumSquares = 0;
        for (let i = 0; i < linear.length; i++) sumSquares += linear[i] * linear[i];
        const rms = Math.sqrt(sumSquares / linear.length);
        const vDb = 20 * Math.log10(rms + 1e-10);
        setVolumeDb(vDb);

        const centroid = spectralCentroid(linear, freqs);
        setCentroidHz(centroid);

        const f0 = detectPitchHPS(linear, sampleRate, FFT_SIZE);

        let levels = [];
        let hnr = null;
        let matchedFinger = null;
        // 発音中の判定はメーターとグラフで共通: ピッチが取れていて、かつ音量が無音しきい値以上。
        // 音量ゲートを入れることで、無音時に背景ノイズを拾って音名が出続けるのを防ぐ。
        const sounding = f0 && f0 > 40 && vDb >= SILENCE_VOLUME_DB;
        if (sounding) {
          setPitch(f0);

          // --- 運指ベース管長自動キャリブレーション ---
          // 実測基音に最も近い運指をテーブルから検索し、正しい実音Hzを求める。
          // この正しい実音Hzが、以後の理論値グラフ(倍音構成)の基準になる。
          matchedFinger = findClosestFingering(f0, fingeringTableRef.current);
          if (matchedFinger) setMatchedFingering(matchedFinger);

          for (let n = 1; n <= NUM_HARMONICS; n++) {
            const targetFreq = f0 * n;
            const bin = freqToBin(targetFreq, sampleRate, FFT_SIZE);
            let peak = 0;
            for (let b = Math.max(0, bin - 2); b <= bin + 2; b++) {
              if (linear[b] !== undefined) peak = Math.max(peak, linear[b]);
            }
            levels.push({ n, freq: targetFreq, mag: peak });
          }
          const maxMag = Math.max(...levels.map((l) => l.mag), 1e-6);
          levels = levels.map((l) => ({ ...l, norm: l.mag / maxMag }));
          setHarmonicLevels(levels);

          hnr = harmonicToNoiseRatio(linear, freqs, f0, sampleRate, FFT_SIZE, NUM_HARMONICS);
          setHnrDb(hnr);
        } else {
          // 無音: ピッチをnullに戻すことで、メーターは中央(音名は「—」)に戻る。
          // (以前は最後に検出した音が残り続けていた)
          setPitch(null);
          setMatchedFingering(null);
        }


        // --- 100ms周期でフレームを蓄積(録音ボタンでisRecordingがtrueの間だけ) ---
        if (isRecordingRef.current && phraseStartTimeRef.current !== null) {
          const elapsedMs = performance.now() - phraseStartTimeRef.current;
          const selectedIdeal = selectedIdealRef.current;
          const preset = presetRef.current;
          const temperature = temperatureRef.current;

          // --- ノート区間分割・アタック時間検出(rAFレート、100msゲートの外で毎tick実行) ---
          {
            const det = noteDetectorRef.current;
            if (det.phase === "silence") {
              if (vDb > NOTE_ONSET_DB) {
                det.phase = "attack";
                det.onsetMs = elapsedMs;
                det.peakDb = vDb;
                det.samples = [{ t: elapsedMs, vDb }];
              }
            } else if (det.phase === "attack") {
              det.samples.push({ t: elapsedMs, vDb });
              if (vDb > det.peakDb) det.peakDb = vDb;
              if (vDb < NOTE_RELEASE_DB) {
                det.phase = "silence"; // 観測窓の途中で消えた短すぎる音はノートとして扱わない
              } else if (elapsedMs - det.onsetMs >= ATTACK_WINDOW_MS) {
                // アタック確定: 観測窓内のピーク-3dBに初到達した時刻までをアタック時間とする
                const target = det.peakDb - 3;
                const hit = det.samples.find((s) => s.vDb >= target);
                const attackTimeMs = hit ? Math.round(hit.t - det.onsetMs) : null;
                det.events.push({ startT: det.onsetMs / 1000, endT: null, attackTimeMs, peakVolumeDb: det.peakDb });
                setPhraseNoteEvents([...det.events]);
                det.phase = "sustain";
                det.samples = [];
              }
            } else if (det.phase === "sustain") {
              if (vDb > det.peakDb) det.peakDb = vDb;
              if (vDb < NOTE_RELEASE_DB) {
                const last = det.events[det.events.length - 1];
                if (last && last.endT === null) {
                  last.endT = elapsedMs / 1000;
                  last.peakVolumeDb = det.peakDb;
                  setPhraseNoteEvents([...det.events]);
                }
                det.phase = "silence";
              }
            }
          }

          if (elapsedMs - lastSampleTimeRef.current >= SAMPLE_INTERVAL_MS) {
            lastSampleTimeRef.current = elapsedMs;

            // ピッチ: 理論値(運指テーブルの正しいHz、このtickで判定したmatchedFinger)と
            // 理想値の両方を基準として持つ(企画書v3方針: ピッチのみ絶対的な正解があるため理論値も残す)
            const theoFreq = matchedFinger?.soundingFreqHz ?? null;
            const pitchCentsVsTheory = f0 && theoFreq ? centsBetween(f0, theoFreq) : null;
            // 理想値は音(運指の半音インデックス)ごとに持つため、今判定されている音に対応する理想値を都度引く。
            // これにより演奏中の音が変わるたびに比較対象の理想値も自動で切り替わる。
            const noteIdeal = getNoteIdeal(selectedIdeal, matchedFinger?.semitoneIndex);
            const pitchCentsVsIdeal = f0 && noteIdeal?.pitchHz ? centsBetween(f0, noteIdeal.pitchHz) : null;

            const harmNorm = levels.length === NUM_HARMONICS ? levels.map((l) => l.norm) : new Array(NUM_HARMONICS).fill(0);
            const idealHarmNorm = noteIdeal?.harmonicsProfile
              ? noteIdeal.harmonicsProfile.map((h) => h.norm)
              : new Array(NUM_HARMONICS).fill(0);

            const pitchScoreTheory = pitchCentsVsTheory !== null ? pitchMatchScore(pitchCentsVsTheory) : 0;
            const pitchScoreIdeal = pitchCentsVsIdeal !== null ? pitchMatchScore(pitchCentsVsIdeal) : 0;

            // 音色一致度: 理論モデルは倍音の相対強度情報を持たないため、理想値のみを基準とする
            // (企画書v3 2.8節の方針: ピッチ以外は理想値との比較に絞る)
            const timbreScoreIdeal = noteIdeal
              ? timbreMatchScore(harmNorm, idealHarmNorm, centroid, noteIdeal.centroidHz, hnr, noteIdeal.hnrDb)
              : 0;

            const frame = {
              t: elapsedMs / 1000,
              pitchHz: f0,
              pitchCents: pitchCentsVsTheory,
              matchedWrittenNote: matchedFinger?.writtenLabel ?? null,
              semitoneIndex: matchedFinger?.semitoneIndex ?? null, // 音域軸集計用(企画書11.7節の対応: 運指の半音インデックス)
              derivedTubeLengthCm: matchedFinger ? deriveTubeLengthCm(matchedFinger.soundingFreqHz, preset.bellRadiusCm, temperature) : null,
              volumeDb: vDb,
              spectralCentroidHz: centroid,
              hnrDb: hnr,
              harmonics: levels.map((l) => ({ n: l.n, freqHz: l.freq, levelNorm: l.norm })),
              matchScore: {
                // ピッチは理論値・理想値の両方を保持(絶対的な正解=理論値があるため)
                pitch: { theoretical: pitchScoreTheory, ideal: pitchScoreIdeal },
                // 音色は理想値のみ(理論値基準は倍音の相対強度を持たず精度が低いため)
                timbre: { ideal: timbreScoreIdeal },
              },
            };
            setPhraseFrames((prev) => {
              const next = [...prev, frame];
              phraseFramesRef.current = next;
              return next;
            });
          }
        } else {
          // --- 録音していない間も、タイムラインを常時動かすための直近30秒ローリングバッファ ---
          // (セッションには保存しない使い捨てのバッファ。録音中はここには積まず、
          // phraseFramesの方をそのままタイムラインに渡す)
          if (liveStartTimeRef.current === null) liveStartTimeRef.current = performance.now();
          const liveElapsedMs = performance.now() - liveStartTimeRef.current;
          if (liveElapsedMs - lastLiveSampleTimeRef.current >= SAMPLE_INTERVAL_MS) {
            lastLiveSampleTimeRef.current = liveElapsedMs;
            const selectedIdeal = selectedIdealRef.current;
            const noteIdeal = getNoteIdeal(selectedIdeal, matchedFinger?.semitoneIndex);
            const harmNorm = levels.length === NUM_HARMONICS ? levels.map((l) => l.norm) : new Array(NUM_HARMONICS).fill(0);
            const idealHarmNorm = noteIdeal?.harmonicsProfile
              ? noteIdeal.harmonicsProfile.map((h) => h.norm)
              : new Array(NUM_HARMONICS).fill(0);
            const theoFreq = matchedFinger?.soundingFreqHz ?? null;
            const pitchCentsVsTheory = f0 && theoFreq ? centsBetween(f0, theoFreq) : null;
            const pitchCentsVsIdeal = f0 && noteIdeal?.pitchHz ? centsBetween(f0, noteIdeal.pitchHz) : null;
            const pitchScoreTheory = pitchCentsVsTheory !== null ? pitchMatchScore(pitchCentsVsTheory) : 0;
            const pitchScoreIdeal = pitchCentsVsIdeal !== null ? pitchMatchScore(pitchCentsVsIdeal) : 0;
            const timbreScoreIdeal = noteIdeal
              ? timbreMatchScore(harmNorm, idealHarmNorm, centroid, noteIdeal.centroidHz, hnr, noteIdeal.hnrDb)
              : 0;
            const liveFrame = {
              t: liveElapsedMs / 1000,
              pitchHz: f0,
              pitchCents: pitchCentsVsTheory,
              matchedWrittenNote: matchedFinger?.writtenLabel ?? null,
              semitoneIndex: matchedFinger?.semitoneIndex ?? null,
              volumeDb: vDb,
              spectralCentroidHz: centroid,
              hnrDb: hnr,
              harmonics: levels.map((l) => ({ n: l.n, freqHz: l.freq, levelNorm: l.norm })),
              matchScore: {
                pitch: { theoretical: pitchScoreTheory, ideal: pitchScoreIdeal },
                timbre: { ideal: timbreScoreIdeal },
              },
            };
            setLiveFrames((prev) => [...prev, liveFrame].slice(-LIVE_WINDOW_MAX_FRAMES));
          }
        }

        // スペクトル表示バー
        const displayBars = 64;
        const maxDisplayFreq = 4000;
        const maxBin = Math.min(linear.length - 1, freqToBin(maxDisplayFreq, sampleRate, FFT_SIZE));
        const bars = new Array(displayBars).fill(0);
        for (let i = 0; i < displayBars; i++) {
          const t0 = i / displayBars, t1 = (i + 1) / displayBars;
          const startBin = Math.floor(Math.pow(t0, 2) * maxBin);
          const endBin = Math.max(startBin + 1, Math.floor(Math.pow(t1, 2) * maxBin));
          let peak = 0;
          for (let b = startBin; b <= Math.min(endBin, maxBin); b++) peak = Math.max(peak, linear[b] || 0);
          bars[i] = peak;
        }
        const maxBar = Math.max(...bars, 1e-6);
        setSpectrumBars(bars.map((b) => b / maxBar));

        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      return true;
    } catch (err) {
      // 詳細な原因(権限拒否・デバイスなし等)はコンソールにのみ残し、画面上のアラートは
      // 常に同じ簡潔な一文にする(原因の切り分けはユーザーの手を煩わせない)。
      console.error("getUserMedia failed:", err.name, err.message, err);
      setErrorMsg("マイクにアクセスできませんでした");
      setIsListening(false);
      return false;
    }
  }, []);

  // 録音ボタンのトグル。マイクがまだ繋がっていなければ先に接続を試みる(権限エラー時の再試行も兼ねる)。
  // phraseStartTimeRefをrefで即座にnullにすることで、isRecording stateの反映を待たずに
  // tick()側のフレーム蓄積を同期的に止められるようにしている。
  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      phraseStartTimeRef.current = null;
      finalizeRecording();
      setIsRecording(false);
      return;
    }
    if (!streamRef.current) {
      const ok = await startListening();
      if (!ok) return;
    }
    phraseStartTimeRef.current = performance.now();
    lastSampleTimeRef.current = 0;
    setPhraseFrames([]);
    phraseFramesRef.current = [];
    noteDetectorRef.current = { phase: "silence", onsetMs: 0, peakDb: -100, samples: [], events: [] };
    setPhraseNoteEvents([]);
    setIsRecording(true);
  }, [isRecording, startListening, finalizeRecording]);

  // 【重要】startListening/stopListeningは(finalizeRecordingの依存経由で)頻繁に再生成され得るため、
  // 依存配列に直接入れると「関数が変わるたびに前回のeffectのクリーンアップとして古い関数が
  // 呼ばれる」という不具合(以前のstop()二重発火バグと同種)を招く。refで最新の関数を保持し、
  // このeffect自体はtopTabが変わったときだけ発火させる。
  const startListeningRef = useRef(startListening);
  const stopListeningRef = useRef(stopListening);
  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);
  useEffect(() => { stopListeningRef.current = stopListening; }, [stopListening]);

  // 計測タブに滞在中は自動でマイクを起動し、離れたら自動で止める(常時ライブ表示)。
  useEffect(() => {
    if (topTab === "measure" && !document.hidden) {
      startListeningRef.current();
    } else {
      stopListeningRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topTab]);

  // 画面が非表示(タブ切替・バックグラウンド化・画面ロック等)になった間はマイクを止め、
  // 表示に戻った時点で計測タブに滞在していれば再開する(裏で聞き続けないようにする)。
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopListeningRef.current();
      } else if (topTab === "measure") {
        startListeningRef.current();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [topTab]);

  useEffect(() => () => stopListeningRef.current(), []);

  // セッション(またはライブ録音直後のフレーム列)全体を平均して理想値プロファイルとして保存する。
  // 計測タブの録音停止後・アップロード解析完了後・セッション詳細画面のいずれからも共通で呼ばれる。
  // 数十音を1つずつ手動設定するのは非現実的なため、同じ名前のプロファイルが既にあれば
  // そのnotesに今回のデータの音だけをマージ(上書き)する。ない場合は新規作成する。
  // これにより、複数回に分けて録音した音をまとめて1つの理想値プロファイルに積み上げていける。
  const promoteSessionToIdeal = useCallback((sessionLike, name) => {
    const trimmedName = name.trim();
    const newProfile = buildIdealProfileFromSession(sessionLike, trimmedName, NUM_HARMONICS);
    setIdealProfiles((prev) => {
      const existingIdx = prev.findIndex((p) => p.name === trimmedName);
      if (existingIdx === -1) {
        setSelectedIdealId(newProfile.id);
        return [...prev, newProfile];
      }
      const existing = prev[existingIdx];
      const merged = { ...existing, notes: { ...existing.notes, ...newProfile.notes } };
      setSelectedIdealId(merged.id);
      return prev.map((p, i) => (i === existingIdx ? merged : p));
    });
  }, [NUM_HARMONICS]);

  // アップロードされた音声/動画ファイルを、ライブ録音と同じ解析パイプラインで処理し、通常の録音と同じ
  // セッション構造で保存する(企画書のフレームデータ構造に準拠。source:"upload"で区別)。
  // 音声ファイル(wav/mp3/m4a等)はdecodeAudioDataで直接デコードして高速なオフライン解析にかける。
  // 動画ファイル(スマホの録画データ等)はブラウザによってはdecodeAudioDataが音声トラックを
  // 取り出せないことがあるため、その場合は<video>要素で実際に再生する経路にフォールバックする
  // (この場合のみ解析に再生時間と同じだけ時間がかかる)。
  const handleUploadFile = useCallback(async (file) => {
    if (!file || isAnalyzingUpload) return;
    setErrorMsg("");
    setIsAnalyzingUpload(true);
    setUploadProgress(0);
    try {
      const analysisOpts = { saxType, tuningHz, instrumentOffsetCents, temperature, selectedIdeal, onProgress: setUploadProgress };
      let frames, noteEvents;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
        decodeCtx.close();
        ({ frames, noteEvents } = await analyzeAudioBuffer(audioBuffer, analysisOpts));
      } catch {
        ({ frames, noteEvents } = await analyzeMediaFile(file, analysisOpts));
      }

      if (frames.length > 0) {
        const session = {
          id: generateId(),
          recordedAt: new Date().toISOString(),
          saxType,
          reedId: selectedReedId,
          linkedAt: selectedReedId ? "eager" : null,
          memo: null,
          performer: selectedPerformer,
          source: "upload",
          sourceFileName: file.name,
          frames,
          noteEvents,
        };
        addSession(session);
        setLastUploadedSession(session);
      } else {
        setErrorMsg("アップロードした音声から有効な音が検出できませんでした");
      }
    } catch (err) {
      setErrorMsg(`音声ファイルの解析に失敗しました: ${err?.message ?? String(err)}`);
    } finally {
      setIsAnalyzingUpload(false);
      setUploadProgress(0);
    }
  }, [saxType, tuningHz, instrumentOffsetCents, temperature, selectedIdeal, selectedReedId, selectedPerformer, addSession, isAnalyzingUpload]);

  const deleteIdealProfile = (id) => {
    setIdealProfiles((prev) => prev.filter((p) => p.id !== id));
    if (selectedIdealId === id) setSelectedIdealId(null);
  };

  // 音名・セント誤差はレンダー時に最新の基準ピッチ(tuningHz)で導出する。
  // tick()内で計算するとクロージャに古い基準ピッチが残るため、基準変更が即座に表示へ反映されない。
  const note = pitch ? freqToNote(pitch, tuningHz) : null;
  const centsOffset = note ? note.cents : 0;

  return (
    <div style={{ minHeight: "100vh", background: "#F6F7F9", color: "#121F32", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace", padding: "16px 14px 96px", boxSizing: "border-box" }}>
      <style>{`
        @import url('https://cdnjs.cloudflare.com/ajax/libs/JetBrains-Mono/2.304/web/JetBrainsMono.css');
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap');
        /* Claude Designの提案を反映したフォント: 音名/リード番号の表示にInstrument Serif、
           数値表示にSpace Grotesk。基本フォント(Noto Sans JP)は変更せず、inlineのfontFamilyで
           必要箇所にのみ適用する(計測・リード・分析タブで使用)。 */
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@500;600;700&display=swap');
        * { box-sizing: border-box; }
        .sans { font-family: 'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #174585; outline-offset: 2px; }
        input[type=range] { accent-color: #174585; }
        select { background:#F6F7F9; color:#121F32; border:1px solid #E9ECF0; border-radius:4px; padding:6px 8px; font-family: 'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size:12px; }
        /* ピボットの軸セレクタは丸角カード内に置くため、枠なし・ネイビー太字で見せる */
        select.pivot-axis-select { width:100%; background:transparent; border:none; border-radius:0; padding:0; color:#174585; font-weight:600; font-size:12px; cursor:pointer; }
      `}</style>

      {/* アプリ名ヘッダーは削除(Claude Designに準拠。タブ切替は画面下部の固定ナビ=BottomNavに集約)。 */}

      {/* リードタブ内の子タブ: 登録 / 比較 / ランキング */}
      {topTab === "reeds" && (
        <div style={{ maxWidth: 900, margin: "0 auto 10px", display: "flex", gap: 6, background: "#EDEFF3", borderRadius: 11, padding: 4 }}>
          {[
            { key: "register", label: "登録" },
            { key: "compare", label: "比較" },
            { key: "ranking", label: "ランキング" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setReedsSubTab(t.key)}
              className="sans"
              style={{
                flex: 1, padding: "9px 4px", borderRadius: 8, border: "none",
                background: reedsSubTab === t.key ? "#FFFFFF" : "transparent",
                color: reedsSubTab === t.key ? "#174585" : "#8D95A1",
                fontWeight: reedsSubTab === t.key ? 700 : 400, fontSize: 13,
                boxShadow: reedsSubTab === t.key ? "0 1px 3px rgba(0,0,0,.06)" : "none",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* 計測タブでのみ発生しうるエラー(マイク接続・アップロード解析)のため、他タブでは表示しない。
          タップで消せるほか、再度マイク接続を試みる操作(タブ再訪問等)でも自動的にクリアされる。 */}
      {errorMsg && topTab === "measure" && (
        <div
          onClick={() => setErrorMsg("")}
          className="sans"
          style={{ maxWidth: 900, margin: "0 auto 10px", background: "#FEF2F2", border: "1px solid #DC2626", color: "#DC2626", borderRadius: 5, padding: "10px 14px", fontSize: 12, cursor: "pointer" }}
        >
          {errorMsg}
        </div>
      )}

      {topTab === "measure" && (
        <MeasureView
          isRecording={isRecording} toggleRecording={toggleRecording}
          note={note} pitch={pitch} centsOffset={centsOffset}
          spectrumBars={spectrumBars}
          harmonicLevels={harmonicLevels} theoreticalHarmonics={theoreticalHarmonics}
          showIdeal={showIdeal} setShowIdeal={setShowIdeal}
          selectedIdeal={selectedIdeal}
          volumeDb={volumeDb} centroidHz={centroidHz} hnrDb={hnrDb}
          saxType={saxType} setSaxType={setSaxType}
          temperature={temperature} setTemperature={setTemperature}
          tuningHz={tuningHz} setTuningHz={setTuningHz}
          matchedFingering={matchedFingering}
          idealProfiles={idealProfiles}
          selectedIdealId={selectedIdealId} setSelectedIdealId={setSelectedIdealId}
          deleteIdealProfile={deleteIdealProfile}
          NUM_HARMONICS={NUM_HARMONICS}
          reeds={reeds} selectedReedId={selectedReedId} setSelectedReedId={setSelectedReedId}
          performers={performers} selectedPerformer={selectedPerformer}
          setSelectedPerformer={setSelectedPerformer} setPerformers={setPerformers}
          phraseFrames={phraseFrames} phraseNoteEvents={phraseNoteEvents} liveFrames={liveFrames}
          promoteSessionToIdeal={promoteSessionToIdeal}
          handleUploadFile={handleUploadFile} isAnalyzingUpload={isAnalyzingUpload}
          uploadProgress={uploadProgress} lastUploadedSession={lastUploadedSession}
        />
      )}
      {topTab === "reeds" && reedsSubTab === "register" && (
        <ReedRegisterView
          reeds={reeds} setReeds={setReeds}
          sessions={sessions} updateSessions={updateSessions}
          setTopTab={setTopTab} setSelectedReedId={setSelectedReedId}
        />
      )}
      {topTab === "reeds" && reedsSubTab === "compare" && (
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <ReedCompareTab reeds={reeds} sessions={sessions} compareReedIds={compareReedIds} setCompareReedIds={setCompareReedIds} />
        </div>
      )}
      {topTab === "reeds" && reedsSubTab === "ranking" && (
        <ReedRankingSection reeds={reeds} sessions={sessions} selectedIdeal={selectedIdeal} />
      )}
      {topTab === "analysis" && (
        <AnalysisLabView
          sessions={sessions} reeds={reeds} selectedIdeal={selectedIdeal}
          promoteSessionToIdeal={promoteSessionToIdeal}
          NUM_HARMONICS={NUM_HARMONICS}
          updateSessions={updateSessions} deleteSessions={deleteSessions}
          performers={performers} setPerformers={setPerformers}
        />
      )}

      {/* 画面下部の固定タブナビ(Claude Designに準拠)。録音中はタブ移動を無効化する。 */}
      <BottomNav topTab={topTab} setTopTab={setTopTab} isRecording={isRecording} />
    </div>
  );
}

// 画面下部の固定ナビ。計測/リード/分析をアイコン+ラベルで切り替える(モバイルアプリ風)。
function BottomNav({ topTab, setTopTab, isRecording }) {
  const items = [
    {
      key: "measure", label: "計測",
      icon: (c) => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
          <path d="M4 15 A8 8 0 0 1 20 15" /><line x1="12" y1="15" x2="15" y2="9" />
          <circle cx="12" cy="15" r="1.4" fill={c} stroke="none" />
        </svg>
      ),
    },
    {
      // 実際のリード1枚を正面から見たピクトグラム: 上に向かって細くなる先端(チップ)、
      // 中央のヴァンプ(削り部)の曲線、下は平らな尻(ヒール)。
      key: "reeds", label: "リード",
      icon: (c) => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 22 L9 8 C9 4 10.5 2.5 12 2.5 C13.5 2.5 15 4 15 8 L15 22 Z" />
          <path d="M9 9.5 Q12 12 15 9.5" />
        </svg>
      ),
    },
    {
      key: "analysis", label: "データ",
      icon: (c) => (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
          <line x1="7" y1="20" x2="7" y2="13" /><line x1="12" y1="20" x2="12" y2="7" /><line x1="17" y1="20" x2="17" y2="11" />
        </svg>
      ),
    },
  ];
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 30,
      background: "rgba(255,255,255,.92)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      borderTop: "1px solid #ECEEF1", paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      <div style={{ maxWidth: 480, margin: "0 auto", height: 68, display: "flex", padding: "8px 20px 14px" }}>
        {items.map((t) => {
          const active = topTab === t.key;
          const color = active ? "#174585" : "#8D95A1";
          return (
            <button
              key={t.key}
              onClick={() => { if (!isRecording) setTopTab(t.key); }}
              disabled={isRecording}
              className="sans"
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
                background: "none", border: "none", cursor: isRecording ? "default" : "pointer",
                color, opacity: isRecording && !active ? 0.4 : 1,
              }}
            >
              {t.icon(color)}
              <span style={{ fontSize: 10, fontWeight: active ? 700 : 400 }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// iOS風のスクロールスナップピッカー。中央行が現在値で、スクロールが止まった位置の
// 値を確定してonChangeを呼ぶ(確定ボタンは持たず、選ぶ動作=決定とする)。
// 背景タップ or Escで閉じる。optionsは表示順の配列、labelFnで見た目のラベルに変換する。
function ScrollPicker({ options, value, onChange, onClose, labelFn }) {
  const ROW_H = 38;
  const VISIBLE_ROWS = 3;
  const containerRef = useRef(null);
  const scrollTimerRef = useRef(null);

  useEffect(() => {
    const idx = Math.max(0, options.indexOf(value));
    const el = containerRef.current;
    if (el) el.scrollTop = idx * ROW_H;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleScroll = () => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const el = containerRef.current;
      if (!el) return;
      const idx = Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / ROW_H)));
      el.scrollTo({ top: idx * ROW_H, behavior: "smooth" });
      if (options[idx] !== value) onChange(options[idx]);
    }, 130);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.28)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", width: 140, background: "#FFFFFF", borderRadius: 12, boxShadow: "0 8px 24px rgba(15,23,42,0.18)", overflow: "hidden" }}
      >
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="sans"
          style={{ height: ROW_H * VISIBLE_ROWS, overflowY: "auto", scrollSnapType: "y mandatory", WebkitOverflowScrolling: "touch" }}
        >
          <div style={{ height: ROW_H }} />
          {options.map((o) => (
            <div
              key={o}
              style={{
                height: ROW_H, display: "flex", alignItems: "center", justifyContent: "center",
                scrollSnapAlign: "center", fontSize: 16,
                fontWeight: o === value ? 700 : 400,
                color: o === value ? "#174585" : "#121F32",
              }}
            >
              {labelFn ? labelFn(o) : o}
            </div>
          ))}
          <div style={{ height: ROW_H }} />
        </div>
        {/* 中央行のハイライト帯(選択中の値がここに来る) */}
        <div style={{ position: "absolute", top: ROW_H, left: 0, right: 0, height: ROW_H, borderTop: "1px solid #E9ECF0", borderBottom: "1px solid #E9ECF0", background: "rgba(37,99,235,0.05)", pointerEvents: "none" }} />
      </div>
    </div>
  );
}

// 計測タブの「これまでの音」ミニタイムライン。SessionDetailView等で使う履歴振り返り用の
// PhraseTimeline(スクラブ・ドリルダウンつき)とは別物として実装する: こちらは直近30秒の
// 理論値(運指テーブル)からのピッチ偏差(セント)をそのまま折れ線で表す。縦軸はメーターと
// 揃えて-50¢〜+50¢に固定し、±10¢の良好ゾーンを帯で示す。
const RECENT_NOTES_WINDOW_SEC = 30;
const RECENT_NOTES_RANGE_CENTS = 50;

function PitchDeviationLine({ frames }) {
  const W = 600, H = 110;
  const latestT = frames.length ? frames[frames.length - 1].t : 0;
  const windowFrames = frames.filter((f) => f.t >= latestT - RECENT_NOTES_WINDOW_SEC);

  // x: 「今から何秒前か」を右端=現在・左端=30秒前に固定でマッピングする。
  const x = (t) => W - ((latestT - t) / RECENT_NOTES_WINDOW_SEC) * W;
  // y: -50¢〜+50¢を上下の帯全体にマッピングする(0¢が中央)。範囲外の値は見切れさせず端に寄せる。
  const y = (cents) => {
    const clamped = Math.max(-RECENT_NOTES_RANGE_CENTS, Math.min(RECENT_NOTES_RANGE_CENTS, cents));
    return H / 2 - (clamped / RECENT_NOTES_RANGE_CENTS) * (H / 2 - 6);
  };
  const goodTop = y(10), goodBottom = y(-10);

  // 無音判定: ピッチ未検出、または音量が閾値未満のフレーム。無音は背景ノイズ由来の
  // 誤検出ピッチを描かず、中央(0¢)に落とす(線は途切れず中央ライン上に留まる)。
  const isSilent = (f) => {
    const c = f.pitchCents;
    if (c === null || c === undefined || isNaN(c)) return true;
    if (typeof f.volumeDb === "number" && f.volumeDb < SILENCE_VOLUME_DB) return true;
    return false;
  };

  const points = windowFrames
    .map((f) => `${x(f.t)},${y(isSilent(f) ? 0 : f.pitchCents)}`)
    .join(" ");

  // 感知した音名(運指の記音)を時系列に沿ってラベル表示する。連続する同じ音をひとまとまりにし、
  // 各まとまりの先頭位置に音名を出す。無音フレームはまとまりを区切る。SVGはpreserveAspectRatio=none
  // で横に引き伸ばされ文字が歪むため、ラベルはSVGの上にHTMLで重ねて配置する。
  const noteRuns = [];
  let cur = null;
  const MIN_RUN = 2;
  for (const f of windowFrames) {
    const nm = isSilent(f) ? null : (f.matchedWrittenNote || null);
    if (nm) {
      if (!cur || cur.name !== nm) {
        if (cur && cur.count >= MIN_RUN) noteRuns.push(cur);
        cur = { name: nm, startT: f.t, count: 1 };
      } else cur.count += 1;
    } else {
      if (cur && cur.count >= MIN_RUN) noteRuns.push(cur);
      cur = null;
    }
  }
  if (cur && cur.count >= MIN_RUN) noteRuns.push(cur);
  // ラベルが重なりすぎないよう、直前に置いた位置から一定以上離れているものだけ表示する。
  const labels = [];
  let lastPct = -100;
  for (const r of noteRuns) {
    const pct = (x(r.startT) / W) * 100;
    if (pct - lastPct >= 9) { labels.push({ name: r.name, pct }); lastPct = pct; }
  }

  const axisLabel = { position: "absolute", right: 4, fontSize: 9, color: "#A6AEBA", whiteSpace: "nowrap" };

  return (
    <div style={{ padding: "18px 0 0" }}>
      <div style={{ display: "flex" }}>
        {/* 縦軸の目盛ラベル: 上=+50¢ / 中央=0 / 下=-50¢ */}
        <div style={{ position: "relative", width: 34, height: H, flexShrink: 0 }}>
          <span className="sans" style={{ ...axisLabel, top: 0 }}>+50¢</span>
          <span className="sans" style={{ ...axisLabel, top: "50%", transform: "translateY(-50%)" }}>0</span>
          <span className="sans" style={{ ...axisLabel, bottom: 0 }}>-50¢</span>
        </div>
        {/* グラフ本体 */}
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
            <rect x="0" y={goodTop} width={W} height={goodBottom - goodTop} fill="#E8F6ED" />
            <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#DDE2E8" strokeWidth="1" />
            {points && <polyline fill="none" stroke="#174585" strokeWidth="2" points={points} />}
          </svg>
          {labels.map((l, i) => (
            <span
              key={i}
              className="sans"
              style={{
                position: "absolute", top: 0, left: `${Math.max(2, Math.min(94, l.pct))}%`, transform: "translateX(-50%)",
                fontSize: 10, fontWeight: 700, color: "#174585", background: "rgba(246,247,249,.85)",
                padding: "1px 5px", borderRadius: 6, whiteSpace: "nowrap", pointerEvents: "none",
              }}
            >
              {l.name}
            </span>
          ))}
        </div>
      </div>
      {/* 横軸: 左=30秒前 / 右=今 */}
      <div className="sans" style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "#A6AEBA", marginTop: 4, paddingLeft: 34 }}>
        <span>30秒前</span><span>今</span>
      </div>
    </div>
  );
}

// ============================================================
// 計測ビュー(単音・フレーズ統合)
//
// 単音/フレーズはモードとして分けず、1つの録音フローで扱う。
// リアルタイム表示(音高・スペクトル・倍音構成等)は録音中/停止後を問わず常時表示し、
// 「単音」の結果はこの常時表示がそのまま最終評価になる(停止後も最後の値が残る)。
// 「フレーズ」かどうかは録音停止後(または録音中)にnoteEvents(検出ノート数)から
// 事後判定し、2音以上検出された場合のみ下部にタイムライン(旧フレーズモード相当)を追加表示する。
// ============================================================
function MeasureView(props) {
  const {
    isRecording, toggleRecording, note, pitch, centsOffset, spectrumBars,
    harmonicLevels, theoreticalHarmonics, showIdeal, setShowIdeal,
    selectedIdeal, volumeDb, centroidHz, hnrDb, saxType, setSaxType, temperature, setTemperature,
    tuningHz, setTuningHz, matchedFingering,
    idealProfiles, selectedIdealId, setSelectedIdealId, deleteIdealProfile, NUM_HARMONICS,
    reeds, selectedReedId, setSelectedReedId,
    performers, selectedPerformer, setSelectedPerformer, setPerformers,
    phraseFrames, phraseNoteEvents, liveFrames, promoteSessionToIdeal,
    handleUploadFile, isAnalyzingUpload, uploadProgress, lastUploadedSession,
  } = props;

  const selectedReed = reeds?.find((r) => r.id === selectedReedId) || null;
  // 理想値は音(運指)ごとに持つため、今演奏している音に対応する理想値を都度引く
  const currentNoteIdeal = getNoteIdeal(selectedIdeal, matchedFingering?.semitoneIndex);
  const fileInputRef = useRef(null);

  // リード選択は箱→個体の二段階にする(枚数が増えるとフラットな一覧では選びにくいため)。
  const reedGroups = groupReeds(reeds || []);
  const [selectedBoxKey, setSelectedBoxKey] = useState(() => (selectedReed ? reedGroupKey(selectedReed) : null));
  // リードタブの「測定へ」等、外部からselectedReedIdが変わった場合は箱の選択も追従させる。
  // ただし本画面で箱を選び直してreedIdをnullにクリアした場合は上書きしない。
  useEffect(() => {
    if (!selectedReedId) return;
    const r = (reeds || []).find((x) => x.id === selectedReedId) || null;
    const key = r ? reedGroupKey(r) : null;
    if (key) setSelectedBoxKey((prev) => (prev === key ? prev : key));
  }, [selectedReedId, reeds]);
  const selectedBoxGroup = reedGroups.find((g) => g.key === selectedBoxKey) || null;

  // メーター内の基準ピッチ・楽器種別は、タップでスクロールピッカーを開いて選ぶ(下段の設定より
  // 優先的に触る値のため、演奏姿勢のまま指の届く位置に置く)。どちらか一方だけ開く。
  const [openPicker, setOpenPicker] = useState(null); // null | "tuning" | "sax"
  const [detailOpen, setDetailOpen] = useState(false); // 倍音構成・スペクトル・補助指標をまとめた詳細カードの開閉。デフォルトは閉じておく
  const TUNING_HZ_OPTIONS = [438, 439, 440, 441, 442, 443, 444];
  const SAX_TYPE_OPTIONS = Object.keys(SAX_PRESETS);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* 上部設定行(Claude Designの計測タブ提案を反映): 左にリード(pill・箱→個体の二段階)+奏者、
          右に楽器種別・基準ピッチ(タップでスクロール選択、値はテキストリンク風)。
          いずれも演奏前に一度決めたら触らない設定項目のため、1行に収めて画面の縦スペースを確保する。 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <div className="sans" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap", overflowX: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 2, background: selectedReedId ? "#EAEFF5" : "#F6F7F9", borderRadius: 999, padding: "2px 4px 2px 10px", flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: selectedReedId ? "#174585" : "#C3CAD3", flexShrink: 0, marginRight: 2 }} />
            <select
              value={selectedBoxKey || ""}
              onChange={(e) => { setSelectedBoxKey(e.target.value || null); setSelectedReedId(null); }}
              disabled={isRecording}
              style={{ minWidth: 0, maxWidth: 110, background: "none", border: "none", color: selectedReedId ? "#174585" : "#435266", fontWeight: selectedReedId ? 600 : 400 }}
            >
              <option value="">リードを選択</option>
              {reedGroups.map((g) => (<option key={g.key} value={g.key}>{g.brand} {g.strength}</option>))}
            </select>
            <select
              value={selectedReedId || ""}
              onChange={(e) => setSelectedReedId(e.target.value || null)}
              disabled={isRecording || !selectedBoxGroup}
              style={{ minWidth: 0, maxWidth: 60, background: "none", border: "none", color: selectedReedId ? "#174585" : "#C3CAD3", fontWeight: selectedReedId ? 600 : 400 }}
            >
              <option value="">{selectedBoxGroup ? "個体" : "—"}</option>
              {selectedBoxGroup?.members.map((r) => (<option key={r.id} value={r.id}>#{reedPosition(r, reeds) ?? "?"}</option>))}
            </select>
          </div>
          <PerformerSelector
            performers={performers} selectedPerformer={selectedPerformer}
            setSelectedPerformer={setSelectedPerformer} setPerformers={setPerformers}
            disabled={isRecording}
          />
        </div>
        <div className="sans" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#8D95A1", flexShrink: 0 }}>
          <button onClick={() => setOpenPicker("sax")} style={{ background: "none", border: "none", color: "#8D95A1", cursor: "pointer", padding: 4, fontSize: 12 }}>{SAX_PRESETS[saxType]?.label}</button>
          <span>·</span>
          <button onClick={() => setOpenPicker("tuning")} style={{ background: "none", border: "none", color: "#8D95A1", cursor: "pointer", padding: 4, fontSize: 12 }}>{tuningHz}Hz</button>
        </div>
        {openPicker === "tuning" && (
          <ScrollPicker
            options={TUNING_HZ_OPTIONS} value={tuningHz}
            onChange={setTuningHz} onClose={() => setOpenPicker(null)}
            labelFn={(hz) => `${hz} Hz`}
          />
        )}
        {openPicker === "sax" && (
          <ScrollPicker
            options={SAX_TYPE_OPTIONS} value={saxType}
            onChange={setSaxType} onClose={() => setOpenPicker(null)}
            labelFn={(key) => SAX_PRESETS[key]?.label}
          />
        )}
      </div>
      {(!reeds || reeds.length === 0) && (
        <div className="sans" style={{ fontSize: 9, color: "#8D95A1", marginBottom: 4 }}>「リード」タブでリードを登録できます</div>
      )}

      {isRecording && (
        <div className="sans" style={{ fontSize: 11, color: "#174585", display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={{ width: 8, height: 8, background: "#DC2626", borderRadius: "50%", display: "inline-block", animation: "pulse 1s infinite" }} />
          録音中 · {phraseFrames.length}フレーム
          {phraseNoteEvents.length > 0 && <span style={{ color: "#435266", marginLeft: 6 }}>· {phraseNoteEvents.length}ノート</span>}
        </div>
      )}
      <input
        ref={fileInputRef} type="file" accept="audio/*,video/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); e.target.value = ""; }}
      />

      {/* 音声ファイルのアップロード解析中/完了(ライブ録音と同じ解析パイプラインを通す。ファイルの長さと同じだけ時間がかかる) */}
      {isAnalyzingUpload && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ background: "#EEF1F4", borderRadius: 4, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${Math.round(uploadProgress * 100)}%`, height: "100%", background: "#174585", borderRadius: 4, transition: "width 0.2s linear" }} />
          </div>
          <div className="sans" style={{ fontSize: 9, color: "#435266", marginTop: 4 }}>{Math.round(uploadProgress * 100)}%</div>
        </div>
      )}
      {!isAnalyzingUpload && lastUploadedSession && (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span className="sans" style={{ fontSize: 10, color: "#16A34A" }}>アップロードの解析が完了しました</span>
          <SetAsIdealButton frames={lastUploadedSession.frames} saxType={lastUploadedSession.saxType} onSave={promoteSessionToIdeal} />
        </div>
      )}

      {/* 録音停止直後、その結果をそのまま理想値プロファイルに設定できるようにする */}
      {!isRecording && phraseFrames.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <SetAsIdealButton frames={phraseFrames} saxType={saxType} onSave={promoteSessionToIdeal} />
        </div>
      )}

      {/* 音名(大表示)。半円のアーク式メーターは実機で見づらかったため、横一直線のメーターに変更した。 */}
      <div style={{ textAlign: "center", padding: "12px 0 0" }}>
        <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 72, lineHeight: 1, color: note ? "#121F32" : "#435266" }}>
          {note ? note.name : "—"}<span style={{ fontSize: 32, color: "#9DB3CC" }}>{note ? note.octave : ""}</span>
        </span>
      </div>
      <div style={{ textAlign: "center", marginTop: 6, marginBottom: 4 }}>
        {(() => {
          const ac = note ? Math.abs(centsOffset) : null;
          const centsColor = ac === null ? "#435266" : ac <= 3 ? "#16A34A" : ac <= 10 ? "#D97706" : "#DC2626";
          const centsBg = ac === null ? "#F6F7F9" : ac <= 3 ? "#E8F6ED" : ac <= 10 ? "#FDF0E1" : "#FBE9E9";
          return (
            <span className="sans" style={{ display: "inline-block", fontSize: 15, fontWeight: 700, color: centsColor, background: centsBg, padding: "6px 18px", borderRadius: 999 }}>
              {note ? `${centsOffset > 0 ? "+" : ""}${centsOffset}¢` : "0¢"}
            </span>
          );
        })()}
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 11, color: "#8D95A1", marginTop: 8 }}>{pitch ? `${pitch.toFixed(1)} Hz` : "未検出"}</div>
      </div>

      {/* ピッチメーター(横一直線): 両端が-50¢/+50¢固定。中央付近(±10¢)を良好ゾーンとして薄く塗り、
          つまみが現在のセント値の位置まで中心から帯状に伸びる。 */}
      <div style={{ padding: "18px 4px 0" }}>
        {(() => {
          const ac = note ? Math.abs(centsOffset) : null;
          const meterColor = ac === null ? "#8D95A1" : ac <= 3 ? "#16A34A" : ac <= 10 ? "#D97706" : "#DC2626";
          // 位置は丸めていないセント差(centsExact)を使い、1¢刻みのカクつきをなくす。
          // さらにleft/widthにCSSトランジションをかけ、100ms間隔の更新の間を滑らかに補間する。
          const exact = note ? Math.max(-50, Math.min(50, note.centsExact ?? centsOffset)) : 0;
          const thumbPct = 50 + exact; // -50¢→0% ・ 0¢→50% ・ +50¢→100%
          const ease = "left 0.11s linear, width 0.11s linear, background 0.15s linear";
          return (
            <div style={{ position: "relative", height: 18 }}>
              <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 8, marginTop: -4, background: "#E9ECF0", borderRadius: 4 }} />
              <div style={{ position: "absolute", left: "40%", width: "20%", top: "50%", height: 8, marginTop: -4, background: "#E8F6ED", borderRadius: 4 }} />
              <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 2, background: "#C3CAD3" }} />
              {note && (
                <div style={{
                  position: "absolute", top: "50%", height: 8, marginTop: -4, borderRadius: 4, background: meterColor,
                  left: `${Math.min(50, thumbPct)}%`, width: `${Math.abs(thumbPct - 50)}%`, transition: ease,
                }} />
              )}
              <div style={{ position: "absolute", left: `${thumbPct}%`, top: "50%", width: 18, height: 18, marginLeft: -9, marginTop: -9, borderRadius: "50%", background: meterColor, border: "3px solid #FFFFFF", boxShadow: "0 1px 4px rgba(15,23,42,.18)", transition: ease }} />
            </div>
          );
        })()}
        <div className="sans" style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontFamily: "'Space Grotesk', sans-serif", fontSize: 10, color: "#8D95A1" }}>
          <span>-50</span>
          <span>+50</span>
        </div>
      </div>

      {/* 「これまでの音」ミニタイムライン。メーターと同様、録音開始有無に関わらず常時動かす。
          録音中はphraseFrames(セッションになる確定データ)を、それ以外はマイク接続中に常に
          更新され続ける直近30秒のローリングバッファ(liveFrames)を表示に使う。以前は録音を一度
          行うとphraseFramesが残り続け、録音停止後もグラフが過去の録音で固まったままになっていた
          ため、録音していない間はliveFramesを優先してライブ追従させる。 */}
      {(() => {
        const timelineFrames = isRecording ? phraseFrames : liveFrames;
        return timelineFrames.length > 0 ? (
          <PitchDeviationLine frames={timelineFrames} />
        ) : (
          <div style={{ padding: "18px 0 0", textAlign: "center" }}>
            <div className="sans" style={{ fontSize: 10, color: "#8D95A1" }}>音を出すと、ここに演奏の推移が表示されます</div>
          </div>
        );
      })()}

      {/* 詳細トグル(Claude Design提案): 倍音構成・スペクトル・補助指標(音量/重心/HNR)を1枚の
          折りたたみカードにまとめる。デフォルトは展開(常に情報が見える今までの挙動を維持)で、
          コンパクトにしたい時だけ閉じられるようにする。 */}
      <div style={{ textAlign: "center", marginTop: 4 }}>
        <span
          onClick={() => setDetailOpen((v) => !v)}
          className="sans"
          style={{ fontSize: 13, color: "#174585", borderBottom: "1px solid #B9C9E4", paddingBottom: 3, cursor: "pointer" }}
        >
          {detailOpen ? "詳細を閉じる ︿" : "詳細を見る ﹀"}
        </span>
      </div>
      {detailOpen && (
        <div style={{ padding: "16px 0 10px" }}>
          <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 14, padding: 16 }}>
            {selectedIdeal && (
              // 文言は音によって長さが変わるため、高さを固定して音が切り替わるたびに
              // カード内の他要素がガタつかないようにする(2行分を確保)
              <div className="sans" style={{ fontSize: 10, color: "#8D95A1", marginBottom: 14, minHeight: 24, lineHeight: 1.4 }}>
                {matchedFingering
                  ? currentNoteIdeal
                    ? `記音${matchedFingering.writtenLabel}の理想値と比較中: ${selectedIdeal.name}`
                    : `記音${matchedFingering.writtenLabel}はこのプロファイルに未登録です`
                  : "音を検出すると、その音に対応する理想値と比較します"}
              </div>
            )}
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <span className="sans" style={{ fontSize: 13, fontWeight: 700, color: "#121F32" }}>倍音構成（実測 / 理想）</span>
              <div className="sans" style={{ display: "flex", gap: 10, fontSize: 10, color: "#435266" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={showIdeal} onChange={(e) => setShowIdeal(e.target.checked)} /> 理想</label>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 140, paddingTop: 14 }}>
              {Array.from({ length: NUM_HARMONICS }).map((_, idx) => {
                const n = idx + 1;
                const measured = harmonicLevels.find((h) => h.n === n);
                const measuredHeight = measured ? measured.norm * 100 : 0;
                const theoHarmonic = theoreticalHarmonics[idx];
                const idealHarmonic = currentNoteIdeal?.harmonicsProfile?.find((h) => h.n === n);
                const idealHeight = idealHarmonic ? idealHarmonic.norm * 100 : 0;
                return (
                  // minWidth:0 が無いとflexアイテムは中身(倍音Hz表示の桁数)より縮められず、
                  // 音が変わって桁数が変わるたびに行全体の幅がガタつく(flexboxの既定挙動への対策)
                  <div key={n} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
                    <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, position: "relative" }}>
                      <div style={{ width: "38%", height: `${measuredHeight}%`, background: measured ? "#174585" : "transparent", borderRadius: "3px 3px 0 0", minHeight: measured ? 3 : 0, transition: "height 0.1s ease-out" }} />
                      {showIdeal && currentNoteIdeal && (<div style={{ width: "28%", height: `${idealHeight}%`, border: idealHarmonic ? "1.5px dashed #8D95A1" : "none", borderBottom: "none", borderRadius: "3px 3px 0 0", minHeight: idealHarmonic ? 3 : 0, opacity: 0.85, boxSizing: "border-box" }} />)}
                    </div>
                    <div className="sans" style={{ fontSize: 9, color: "#435266", marginTop: 4 }}>{n}倍</div>
                    <div className="sans" style={{ fontSize: 8, color: "#8D95A1", whiteSpace: "nowrap" }}>{theoHarmonic ? `${Math.round(theoHarmonic.freq)}Hz` : "—"}</div>
                  </div>
                );
              })}
            </div>
            <div className="sans" style={{ fontSize: 9, color: "#435266", marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "#174585", borderRadius: 2, display: "inline-block" }} />実測</span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, border: "1.5px dashed #8D95A1", borderRadius: 2, display: "inline-block" }} />理想{selectedIdeal ? `: ${selectedIdeal.name}` : "(未選択)"}</span>
            </div>

            <div style={{ height: 1, background: "#EEF1F4", margin: "18px 0 16px" }} />

            <div className="sans" style={{ fontSize: 10, color: "#8D95A1", marginBottom: 8 }}>スペクトル (0–4000 Hz)</div>
            <div style={{ display: "flex", alignItems: "flex-end", height: 44, gap: 2, marginBottom: 4 }}>
              {spectrumBars.map((v, i) => (<div key={i} style={{ flex: 1, height: `${Math.max(2, v * 100)}%`, background: "#9DB3CC", borderRadius: "2px 2px 0 0" }} />))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 16 }}>
              <MetricCard label="音量" value={`${volumeDb.toFixed(1)} dB`} sub={currentNoteIdeal ? `理想: ${currentNoteIdeal.volumeDb?.toFixed(1)} dB` : null} />
              <MetricCard label="スペクトル重心" value={`${Math.round(centroidHz)} Hz`} sub={currentNoteIdeal ? `理想: ${Math.round(currentNoteIdeal.centroidHz)} Hz` : null} />
              <MetricCard label="HNR" value={hnrDb !== null ? `${hnrDb.toFixed(1)} dB` : "—"} sub={currentNoteIdeal?.hnrDb != null ? `理想: ${currentNoteIdeal.hnrDb.toFixed(1)} dB` : null} />
            </div>
          </div>
        </div>
      )}

      {/* 録音/アップロードボタン(Claude Design提案): アイコンをラベルの上に積んだpill型。
          均等幅で並べ、録音は塗り、アップロードは輪郭のみで区別する。 */}
      <div style={{ display: "flex", gap: 11, padding: "22px 0 4px" }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isRecording || isAnalyzingUpload}
          className="sans"
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: "#FFFFFF", color: "#174585", border: "1.5px solid #174585", borderRadius: 16, padding: "16px 0", fontSize: 14, fontWeight: 700, cursor: isRecording || isAnalyzingUpload ? "default" : "pointer", opacity: isRecording || isAnalyzingUpload ? 0.5 : 1 }}
        >
          <Upload size={16} />
          {isAnalyzingUpload ? "解析中…" : "録音をアップロード"}
        </button>
        <button
          onClick={toggleRecording}
          className="sans"
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: isRecording ? "#DC2626" : "#174585", color: "#FFFFFF", border: "none", borderRadius: 16, padding: "16px 0", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: isRecording ? "none" : "0 12px 28px rgba(23,69,133,.32)" }}
        >
          {isRecording ? <Square size={16} /> : <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#FFFFFF", display: "inline-block" }} />}
          {isRecording ? "停止" : "録音する"}
        </button>
      </div>

      {/* 理想値プロファイル選択(作成は録音後の「理想値に設定」ボタンから行う)。
          サックス種別・基準ピッチはメーターのタップ→スクロール選択に統合済みのため、ここには置かない。 */}
      {idealProfiles.length > 0 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "12px 16px" }}>
          <div className="sans" style={{ fontSize: 10, color: "#435266", marginBottom: 6 }}>理想値プロファイル</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {idealProfiles.map((p) => (
              <div key={p.id} onClick={() => setSelectedIdealId(p.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", borderRadius: 4, cursor: "pointer", border: selectedIdealId === p.id ? "1.5px solid #174585" : "1px solid #E9ECF0", background: selectedIdealId === p.id ? "#EAEFF5" : "transparent" }}>
                <div className="sans" style={{ fontSize: 11, color: selectedIdealId === p.id ? "#174585" : "#121F32" }}>{p.name}<span style={{ fontSize: 9, color: "#435266", marginLeft: 6 }}>{SAX_PRESETS[p.saxType]?.label}</span></div>
                <button onClick={(e) => { e.stopPropagation(); deleteIdealProfile(p.id); }} style={{ background: "none", border: "none", color: "#435266", cursor: "pointer", padding: 4 }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// フレーズのタイムライン+ドリルダウン表示。計測タブ(ライブ直後)とセッション詳細(履歴)の両方から使う共通コンポーネント。
// 理想値プロファイル自体の選択は計測タブの設定欄で行う前提のため、ここでは「基準」として
// 理想値/お手本セッション/(音高のみ)理論値のどれと比較するかだけを選ぶ。
function PhraseTimeline({ frames, noteEvents, selectedIdeal, NUM_HARMONICS, sessions, ownSessionId }) {
  const [timelineMetric, setTimelineMetric] = useState("pitch");
  const [referenceBasis, setReferenceBasis] = useState("theoretical"); // "theoretical"(音高のみ) | "ideal" | "session"
  const [selectedFrameIdx, setSelectedFrameIdx] = useState(null);
  const [referenceSessionId, setReferenceSessionId] = useState(null);
  const timelineScrollRef = useRef(null);

  // 音高以外の指標では理論値基準を選べないため、指標切替時に無効な組み合わせを補正する
  useEffect(() => {
    if (timelineMetric !== "pitch" && referenceBasis === "theoretical") {
      setReferenceBasis("ideal");
    }
  }, [timelineMetric, referenceBasis]);

  // スライダーでフレームを選ぶたびに、選択位置が常に見えるようグラフを横スクロールさせる
  // (グラフ幅はframes.length*6pxでコンテナ幅を超えることが多いため)。
  useEffect(() => {
    if (selectedFrameIdx === null) return;
    const container = timelineScrollRef.current;
    if (!container) return;
    const x = selectedFrameIdx * 6;
    container.scrollLeft = Math.max(0, x - container.clientWidth / 2);
  }, [selectedFrameIdx]);

  const referenceCandidates = (sessions || []).filter((s) => s.id !== ownSessionId && (s.frames?.length ?? 0) > 0);
  const referenceSession = referenceCandidates.find((s) => s.id === referenceSessionId) || null;

  // 自分とお手本、それぞれの最初の発音タイミング(noteEvents[0].startT)を基準に位置を揃え、
  // 「発音開始からの経過時間」が近いフレーム同士を対応づける(吹き始めのタイミングのズレを吸収する簡易アライメント)。
  const referenceLookup = useMemo(() => {
    if (!referenceSession) return null;
    const ownOnset = noteEvents?.[0]?.startT ?? 0;
    const refOnset = referenceSession.noteEvents?.[0]?.startT ?? 0;
    const refFrames = referenceSession.frames || [];
    return (frameT) => {
      const ownRel = frameT - ownOnset;
      let best = null;
      let bestDiff = Infinity;
      for (const rf of refFrames) {
        const diff = Math.abs((rf.t - refOnset) - ownRel);
        if (diff < bestDiff) { bestDiff = diff; best = rf; }
      }
      return bestDiff <= 0.2 ? best : null; // 200ms以上離れていたら対応フレームなしとみなす
    };
  }, [referenceSession, noteEvents]);

  // 比較対象(理想値 or お手本セッションの対応フレーム)を、noteIdealと同じ形({pitchHz, centroidHz, hnrDb, harmonicsProfile})に揃えて返す
  const getComparisonTarget = (frame) => {
    if (referenceBasis === "session") {
      if (!referenceLookup) return null;
      const refFrame = referenceLookup(frame.t);
      if (!refFrame) return null;
      return {
        pitchHz: refFrame.pitchHz,
        centroidHz: refFrame.spectralCentroidHz,
        hnrDb: refFrame.hnrDb,
        harmonicsProfile: refFrame.harmonics?.map((h) => ({ n: h.n, norm: h.levelNorm })),
      };
    }
    return getNoteIdeal(selectedIdeal, frame.semitoneIndex);
  };

  const metricOptions = [
    { key: "pitch", label: "ピッチ" },
    { key: "volume", label: "音量" },
    { key: "centroid", label: "重心" },
    { key: "hnr", label: "HNR" },
  ];

  // 音高だけ理論値(運指テーブル)との比較も選べる。それ以外の指標は理想値/お手本セッションのみ。
  const referenceOptions = timelineMetric === "pitch"
    ? [
        { key: "theoretical", label: "理論値(運指テーブル)" },
        { key: "ideal", label: `理想値${selectedIdeal ? `(${selectedIdeal.name})` : ""}` },
        { key: "session", label: "お手本セッション" },
      ]
    : [
        { key: "ideal", label: `理想値${selectedIdeal ? `(${selectedIdeal.name})` : ""}` },
        { key: "session", label: "お手本セッション" },
      ];

  const getMetricValue = (frame) => {
    switch (timelineMetric) {
      case "pitch": return frame.pitchHz;
      case "volume": return frame.volumeDb;
      case "centroid": return frame.spectralCentroidHz;
      case "hnr": return frame.hnrDb;
      default: return null;
    }
  };

  // 比較対象(音ごとの理想値、またはお手本セッションの対応フレーム)は都度引き直してスコアを再計算する。
  // これにより、あとから理想値やお手本の選択を変えても、各瞬間ごとに正しい基準と比較できる。
  // 理論値基準は録音時の値のまま使う。
  const getMatchScore = (frame, kind) => {
    if (kind === "pitch" && referenceBasis === "theoretical") {
      return frame.matchScore?.pitch?.theoretical ?? 0;
    }
    const target = getComparisonTarget(frame);
    if (!target) return 0;
    if (kind === "timbre") {
      const harmNorm = frame.harmonics?.length === NUM_HARMONICS ? frame.harmonics.map((h) => h.levelNorm) : new Array(NUM_HARMONICS).fill(0);
      const idealHarmNorm = target.harmonicsProfile ? target.harmonicsProfile.map((h) => h.norm) : new Array(NUM_HARMONICS).fill(0);
      return timbreMatchScore(harmNorm, idealHarmNorm, frame.spectralCentroidHz, target.centroidHz, frame.hnrDb, target.hnrDb);
    }
    // kind === "pitch" && referenceBasis !== "theoretical"
    if (!frame.pitchHz || !target.pitchHz) return 0;
    return pitchMatchScore(centsBetween(frame.pitchHz, target.pitchHz));
  };

  const values = frames.map(getMetricValue).filter((v) => v !== null && v !== undefined && !isNaN(v));
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;
  const range = maxV - minV || 1;
  const selectedFrame = selectedFrameIdx !== null ? frames[selectedFrameIdx] : null;

  return (
    <>
      {/* 表示切り替え・比較基準 */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "10px 14px", marginBottom: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="sans" style={{ fontSize: 10, color: "#435266" }}>表示:</span>
          <select value={timelineMetric} onChange={(e) => setTimelineMetric(e.target.value)}>
            {metricOptions.map((m) => (<option key={m.key} value={m.key}>{m.label}</option>))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="sans" style={{ fontSize: 10, color: "#435266" }}>基準:</span>
          <select value={referenceBasis} onChange={(e) => setReferenceBasis(e.target.value)}>
            {referenceOptions.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
          </select>
          {referenceBasis === "session" && (
            <select value={referenceSessionId || ""} onChange={(e) => setReferenceSessionId(e.target.value || null)}>
              <option value="">お手本セッションを選択</option>
              {referenceCandidates.map((s) => (
                <option key={s.id} value={s.id}>{new Date(s.recordedAt).toLocaleString("ja-JP")}{s.memo ? ` 「${s.memo}」` : ""}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      {referenceBasis === "session" && referenceSession && (
        <div className="sans" style={{ fontSize: 9, color: "#8D95A1", marginBottom: 10 }}>
          最初の発音タイミングを基準に自動で位置合わせして比較します
        </div>
      )}

      {/* タイムライン */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "14px", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 10, color: "#435266", marginBottom: 8 }}>
          タイムライン — ピッチ一致度で色分け（{referenceBasis === "theoretical" ? "理論値基準" : referenceBasis === "session" ? "お手本基準" : "理想値基準"}）
          {noteEvents?.length > 0 && (() => {
            const attacks = noteEvents.map((e) => e.attackTimeMs).filter((v) => v !== null);
            const avg = attacks.length ? Math.round(attacks.reduce((a, b) => a + b, 0) / attacks.length) : null;
            return <span style={{ marginLeft: 8 }}>｜ 検出ノート {noteEvents.length}{avg !== null ? ` ・ 平均アタック ${avg}ms` : ""}</span>;
          })()}
        </div>
        <div ref={timelineScrollRef} style={{ overflowX: "auto" }}>
          <svg width={Math.max(600, frames.length * 6)} height="120" style={{ display: "block" }}>
            <polyline
              fill="none" stroke="#174585" strokeWidth="1.5"
              points={frames.map((f, i) => {
                const v = getMetricValue(f);
                const y = v !== null && v !== undefined && !isNaN(v) ? 100 - ((v - minV) / range) * 90 : 100;
                return `${i * 6},${y}`;
              }).join(" ")}
            />
            {frames.map((f, i) => {
              const score = getMatchScore(f, "pitch");
              const color = scoreToColor(score);
              return (
                <rect key={i} x={i * 6} y={110} width={5} height={8} fill={color}
                  onClick={() => setSelectedFrameIdx(i)}
                  style={{ cursor: "pointer" }}
                />
              );
            })}
            {selectedFrameIdx !== null && (
              <line x1={selectedFrameIdx * 6 + 2.5} y1={0} x2={selectedFrameIdx * 6 + 2.5} y2={118} stroke="#121F32" strokeWidth="1" strokeDasharray="2,2" />
            )}
          </svg>
        </div>
        <input
          type="range" min={0} max={frames.length - 1}
          value={selectedFrameIdx ?? 0}
          onChange={(e) => setSelectedFrameIdx(Number(e.target.value))}
          style={{ width: "100%", marginTop: 8 }}
        />
        <div className="sans" style={{ fontSize: 9, color: "#8D95A1", display: "flex", justifyContent: "space-between" }}>
          <span>0s</span>
          <span>{frames[frames.length - 1]?.t.toFixed(1)}s</span>
        </div>
      </div>

      {/* ドリルダウン: 選択フレームの詳細 */}
      {selectedFrame && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "14px" }}>
          <div className="sans" style={{ fontSize: 10, color: "#435266", marginBottom: 10 }}>
            t = {selectedFrame.t.toFixed(2)}s の詳細
          </div>

          {(() => {
            const target = getComparisonTarget(selectedFrame);
            const noTargetLabel = referenceBasis === "session" ? "対応するお手本の瞬間がありません" : "この音の理想値が未登録";
            return (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <MetricCard label="ピッチ一致度" value={`${Math.round(getMatchScore(selectedFrame, "pitch") * 100)}%`} sub={selectedFrame.pitchHz ? `${selectedFrame.pitchHz.toFixed(1)} Hz ／ 記音${selectedFrame.matchedWrittenNote ?? "—"}` : "—"} accentColor={scoreToColor(getMatchScore(selectedFrame, "pitch"))} />
                <MetricCard label="音色一致度(比較対象基準)" value={target ? `${Math.round(getMatchScore(selectedFrame, "timbre") * 100)}%` : "—"} sub={target ? `重心 ${Math.round(selectedFrame.spectralCentroidHz)}Hz` : noTargetLabel} accentColor={target ? scoreToColor(getMatchScore(selectedFrame, "timbre")) : undefined} />
              </div>
            );
          })()}

          <div className="sans" style={{ fontSize: 9, color: "#435266", marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span>音量: {selectedFrame.volumeDb?.toFixed(1)} dB</span>
            <span>HNR: {selectedFrame.hnrDb?.toFixed(1) ?? "—"} dB</span>
          </div>
        </div>
      )}
    </>
  );
}

// 主観評価の5段階星レーティング。クリックで1〜5をセット、同じ星を再クリックで解除(null)。
function StarRating({ value, onChange, size = 13, readOnly = false }) {
  // タップ操作の場合、見た目のフォントサイズだけだと当たり判定が小さすぎて押しにくいため、
  // 星そのものは変えずにpaddingで実際のタップ領域だけ広げる。
  return (
    <div style={{ display: "flex", gap: readOnly ? 1 : 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          onClick={readOnly ? undefined : () => onChange(n === value ? null : n)}
          style={{
            cursor: readOnly ? "default" : "pointer",
            color: value && n <= value ? "#D97706" : "#C3CAD3",
            fontSize: size,
            lineHeight: 1,
            userSelect: "none",
            padding: readOnly ? 0 : 6,
            margin: readOnly ? 0 : -6,
          }}
        >
          ★
        </span>
      ))}
    </div>
  );
}

// 奏者選択。「自分」固定 + 登録済みの名前 + 「名前を入力」で新規追加できる可変プルダウン。
// 一度追加した名前はperformersに積み上がり、以後の選択肢として残り続ける。
// セッション(またはライブ録音直後のフレーム列)を理想値プロファイルに設定するボタン。
// onSave({frames, saxType}, name) を呼び、実際のプロファイル生成はbuildIdealProfileFromSessionが行う。
function SetAsIdealButton({ frames, saxType, onSave }) {
  const [isNaming, setIsNaming] = useState(false);
  const [name, setName] = useState("");

  if (!frames || frames.length === 0) return null;

  const confirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave({ frames, saxType }, trimmed);
    setName("");
    setIsNaming(false);
  };

  if (isNaming) {
    return (
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          type="text" autoFocus placeholder="理想値の名前" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") confirm(); if (e.key === "Escape") { setIsNaming(false); setName(""); } }}
          className="sans"
          style={{ background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "5px 8px", color: "#121F32", fontSize: 11, width: 130 }}
        />
        <button onClick={confirm} className="sans" style={{ fontSize: 10, padding: "5px 8px", borderRadius: 5, border: "none", background: "#174585", color: "#F6F7F9", cursor: "pointer" }}>保存</button>
        <button onClick={() => { setIsNaming(false); setName(""); }} style={{ background: "none", border: "none", color: "#8D95A1", cursor: "pointer", fontSize: 12 }}>×</button>
      </div>
    );
  }

  return (
    <button onClick={() => setIsNaming(true)} className="sans" style={{ fontSize: 10, padding: "5px 10px", borderRadius: 5, border: "1px solid #174585", background: "#EAEFF5", color: "#174585", cursor: "pointer", fontWeight: 600 }}>
      ★ 理想値に設定
    </button>
  );
}

function PerformerSelector({ performers, selectedPerformer, setSelectedPerformer, setPerformers, disabled }) {
  const [addingName, setAddingName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const options = ["自分", ...performers];

  const confirmAdd = () => {
    const name = addingName.trim();
    if (!name) return;
    setPerformers((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setSelectedPerformer(name);
    setAddingName("");
    setIsAdding(false);
  };

  if (isAdding) {
    return (
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          type="text" autoFocus placeholder="名前を入力" value={addingName}
          onChange={(e) => setAddingName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") confirmAdd(); if (e.key === "Escape") { setIsAdding(false); setAddingName(""); } }}
          className="sans"
          style={{ background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "5px 8px", color: "#121F32", fontSize: 11, width: 110 }}
        />
        <button onClick={confirmAdd} className="sans" style={{ fontSize: 10, padding: "5px 8px", borderRadius: 5, border: "none", background: "#174585", color: "#F6F7F9", cursor: "pointer" }}>追加</button>
        <button onClick={() => { setIsAdding(false); setAddingName(""); }} style={{ background: "none", border: "none", color: "#8D95A1", cursor: "pointer", fontSize: 12 }}>×</button>
      </div>
    );
  }

  return (
    <select
      value={selectedPerformer}
      onChange={(e) => { if (e.target.value === "__add__") setIsAdding(true); else setSelectedPerformer(e.target.value); }}
      disabled={disabled}
    >
      {options.map((name) => (<option key={name} value={name}>{name}</option>))}
      <option value="__add__">＋ 名前を入力...</option>
    </select>
  );
}

// 登録済みリードの並び替え(長押し+スライド)。
// pointerdownから400ms・移動量8px以内を維持できたら長押し成立とみなしてドラッグを開始する
// (成立前の移動は通常のスクロール等とみなしてキャンセルする)。
// 長押し成立後のpointermove/up/cancelはwindowに直接addEventListenerして拾う。
// ドラッグ中の並び替えで対象行自身がDOM上で移動するため、setPointerCaptureで対象要素に
// 紐付ける方式だと(要素の移動を「切断」とみなされて)途中でcaptureが暗黙的に外れてしまう。
// windowへの登録なら要素の位置が変わっても影響を受けない。
// 長押しが成立しなかった場合(＝ただのタップ)はonRowClickを呼び、成立した場合は
// 最終順序をonReorderで返す(呼び出し側がboxNumberとして1から振り直す)。
function ReorderableReedRows({ members, onReorder, onRowClick, renderRow }) {
  const [order, setOrder] = useState(() => members.map((m) => m.id));
  const [draggingId, setDraggingId] = useState(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const longPressTimerRef = useRef(null);
  const dragInfoRef = useRef(null);
  const orderRef = useRef(order);

  useEffect(() => { orderRef.current = order; }, [order]);
  useEffect(() => { setOrder(members.map((m) => m.id)); }, [members]);

  const membersById = new Map(members.map((m) => [m.id, m]));
  const orderedMembers = order.map((id) => membersById.get(id)).filter(Boolean);

  const cancelLongPress = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  };

  // ドラッグ中に(箱の折りたたみ等で)アンマウントされた場合にwindowリスナーが残らないようにする
  useEffect(() => () => {
    cancelLongPress();
    const info = dragInfoRef.current;
    if (info?.onMove) {
      window.removeEventListener("pointermove", info.onMove);
      window.removeEventListener("pointerup", info.onUp);
      window.removeEventListener("pointercancel", info.onUp);
    }
  }, []);

  const detachNativeListeners = () => {
    const info = dragInfoRef.current;
    if (info?.onMove) {
      window.removeEventListener("pointermove", info.onMove);
      window.removeEventListener("pointerup", info.onUp);
      window.removeEventListener("pointercancel", info.onUp);
    }
  };

  const finishDrag = (committed) => {
    detachNativeListeners();
    cancelLongPress();
    dragInfoRef.current = null;
    setDraggingId(null);
    setDragOffsetY(0);
    if (committed) onReorder(orderRef.current);
  };

  const handlePointerDown = (id, index) => (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const startY = e.clientY;
    const target = e.currentTarget;
    cancelLongPress();
    dragInfoRef.current = { armed: false, startY, id, index };
    longPressTimerRef.current = setTimeout(() => {
      if (!dragInfoRef.current) return;
      const rect = target.getBoundingClientRect();
      // anchorY/anchorIndexは押下時点に固定し、以後は動かさない(移動量は常に押下位置からの
      // 累積距離として計算する。moveのたびに基準点を更新すると1歩ごとの差分に矮小化されてしまう)。
      const info = { armed: true, anchorY: startY, anchorIndex: index, rowHeight: rect.height, id };

      const onMove = (ev) => {
        ev.preventDefault();
        const deltaY = ev.clientY - info.anchorY;
        setDragOffsetY(deltaY);
        const rowsMoved = Math.round(deltaY / info.rowHeight);
        const targetIndex = Math.max(0, Math.min(orderRef.current.length - 1, info.anchorIndex + rowsMoved));
        setOrder((prev) => {
          const currentIndex = prev.indexOf(info.id);
          if (currentIndex === -1 || currentIndex === targetIndex) return prev;
          const next = [...prev];
          const [moved] = next.splice(currentIndex, 1);
          next.splice(targetIndex, 0, moved);
          return next;
        });
      };
      const onUp = () => finishDrag(true);

      info.onMove = onMove;
      info.onUp = onUp;
      dragInfoRef.current = info;
      setDraggingId(id);
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }, 400);
  };

  // 長押し成立前(まだネイティブリスナーを付けていない間)だけ使う。大きく動いたら
  // スクロール等の通常操作とみなしてキャンセルする。
  const handlePointerMove = (e) => {
    const info = dragInfoRef.current;
    if (!info || info.armed) return;
    if (Math.abs(e.clientY - info.startY) > 8) { cancelLongPress(); dragInfoRef.current = null; }
  };

  // 長押しが成立せずに指が離れた場合(＝ただのタップ)のみここで処理する。
  // 成立した場合はネイティブのonUpがfinishDrag(true)を呼ぶのでここでは何もしない。
  const handlePointerUp = (id) => () => {
    const info = dragInfoRef.current;
    if (info?.armed) return;
    cancelLongPress();
    dragInfoRef.current = null;
    onRowClick(id);
  };

  const handlePointerCancel = () => {
    const info = dragInfoRef.current;
    if (info?.armed) return;
    cancelLongPress();
    dragInfoRef.current = null;
  };

  return orderedMembers.map((r, idx) => {
    const isDragging = draggingId === r.id;
    return (
      <div
        key={r.id}
        onPointerDown={handlePointerDown(r.id, idx)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp(r.id)}
        onPointerCancel={handlePointerCancel}
        style={{
          position: "relative",
          zIndex: isDragging ? 2 : 1,
          transform: isDragging ? `translateY(${dragOffsetY}px)` : "none",
          boxShadow: isDragging ? "0 6px 14px rgba(15,23,42,0.18)" : "none",
          background: isDragging ? "#EAEFF5" : "transparent",
          borderRadius: isDragging ? 6 : 0,
          touchAction: "pan-y",
          cursor: "pointer",
        }}
      >
        {renderRow(r, idx)}
      </div>
    );
  });
}

function MetricCard({ label, value, sub, accentColor }) {
  return (
    <div style={{ background: "#FFFFFF", border: `1px solid ${accentColor || "#E9ECF0"}`, borderRadius: 14, padding: "12px 14px" }}>
      <div className="sans" style={{ fontSize: 10, color: "#8D95A1" }}>{label}</div>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 600, marginTop: 2, color: accentColor || "#121F32" }}>{value}</div>
      {sub && <div className="sans" style={{ fontSize: 9, color: "#174585", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ============================================================
// Reeds view — 企画書v5 10節: リード管理・リード別比較・リード毎比較・ランキング
// ============================================================
// ============================================================
// リード登録タブ (企画書10.2/10.3節) — 銘柄/番手プルダウン化、10枚まとめ登録に対応
// ============================================================
function ReedRegisterView(props) {
  const { reeds, setReeds, sessions, updateSessions, setTopTab, setSelectedReedId } = props;

  const [newBrand, setNewBrand] = useState(INITIAL_REED_BRANDS[0]);
  const [customBrand, setCustomBrand] = useState("");
  const [newStrength, setNewStrength] = useState(REED_STRENGTHS[2]); // 初期値3.0
  const [newStartDate, setNewStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bulkCount, setBulkCount] = useState(10); // 「まとめて追加」の枚数(上限10)

  // ユーザーが自由入力した銘柄を選択肢に自動追加(初期リスト+動的追加分)
  const [extraBrands, setExtraBrands] = useState([]);
  const brandOptions = [...INITIAL_REED_BRANDS, ...extraBrands];

  const resolveBrand = () => {
    if (newBrand === "__custom__") return customBrand.trim();
    return newBrand;
  };

  const registerReeds = (count) => {
    const brand = resolveBrand();
    if (!brand) return;

    // 自由入力の銘柄は選択肢に自動追加(重複は避ける)
    if (newBrand === "__custom__" && !brandOptions.includes(brand)) {
      setExtraBrands((prev) => [...prev, brand]);
    }

    const newReeds = Array.from({ length: count }).map((_, i) => ({
      id: generateId(),
      brand,
      strength: newStrength,
      startDate: newStartDate,
      boxLabel: count > 1 ? `#${i + 1}/${count}` : null, // まとめ登録時の箱内通し番号(参考情報。表示上の番号はグループ内の登録順で振り直す)
      rating: null, // 主観の5段階評価(1〜5)。未評価はnull
      createdAt: new Date().toISOString(),
    }));
    setReeds((prev) => [...prev, ...newReeds]);
    if (newBrand === "__custom__") setCustomBrand("");
  };

  const deleteReeds = (ids) => {
    const idSet = new Set(ids);
    setReeds((prev) => prev.filter((r) => !idSet.has(r.id)));
    updateSessions((prev) => prev.map((s) => (idSet.has(s.reedId) ? { ...s, reedId: null, linkedAt: null } : s)));
  };

  const rateReed = (id, rating) => {
    setReeds((prev) => prev.map((r) => (r.id === id ? { ...r, rating } : r)));
  };

  // 削除は誤タップが多かったため、行ごとの削除ボタンをやめてチェックボックスによる複数選択削除にする。
  // 2種類の削除操作を分けている: 「登録済みリード」列の削除ボタンは箱ごとまとめて選んで削除、
  // 各箱の銘柄列の削除ボタンはその箱の中から個体を選んで削除。同時には片方しか使えない。
  const [boxSelectionMode, setBoxSelectionMode] = useState(false);
  const [selectedBoxesForDelete, setSelectedBoxesForDelete] = useState(() => new Set());
  const [memberSelectGroupKey, setMemberSelectGroupKey] = useState(null); // 個体選択削除中の箱のkey(nullなら非選択中)
  const [selectedMembersForDelete, setSelectedMembersForDelete] = useState(() => new Set());

  const startBoxSelectionMode = () => {
    setMemberSelectGroupKey(null);
    setSelectedMembersForDelete(new Set());
    setBoxSelectionMode(true);
  };
  const toggleBoxSelected = (key) => {
    setSelectedBoxesForDelete((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const exitBoxSelectionMode = () => {
    setBoxSelectionMode(false);
    setSelectedBoxesForDelete(new Set());
  };
  const confirmBoxBatchDelete = () => {
    if (selectedBoxesForDelete.size === 0) return;
    const targetGroups = reedGroups.filter((g) => selectedBoxesForDelete.has(g.key));
    const ids = targetGroups.flatMap((g) => g.members.map((m) => m.id));
    if (!window.confirm(`選択した${targetGroups.length}箱（${ids.length}枚）を削除しますか？(元に戻せません)`)) return;
    deleteReeds(ids);
    exitBoxSelectionMode();
  };

  const startMemberSelect = (g) => {
    setBoxSelectionMode(false);
    setSelectedBoxesForDelete(new Set());
    setMemberSelectGroupKey(g.key);
    setSelectedMembersForDelete(new Set());
    setExpandedGroupKey(g.key); // 選べるよう箱を開く
  };
  const toggleMemberSelected = (id) => {
    setSelectedMembersForDelete((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exitMemberSelect = () => {
    setMemberSelectGroupKey(null);
    setSelectedMembersForDelete(new Set());
  };
  const confirmMemberBatchDelete = () => {
    if (selectedMembersForDelete.size === 0) return;
    if (!window.confirm(`選択した${selectedMembersForDelete.size}枚を削除しますか？(元に戻せません)`)) return;
    deleteReeds([...selectedMembersForDelete]);
    exitMemberSelect();
  };

  const goToMeasure = (id) => {
    setSelectedReedId(id);
    setTopTab("measure");
  };

  // 長押し+スライドでの並び替え確定時、表示順(sortOrder)だけを更新する。
  // 管理番号(boxNumber)は並び替えても変えない(リードそのものの識別に使うため)。
  const reorderGroupMembers = (newOrderIds) => {
    const orderById = new Map(newOrderIds.map((id, i) => [id, i + 1]));
    setReeds((prev) => prev.map((r) => (orderById.has(r.id) ? { ...r, sortOrder: orderById.get(r.id) } : r)));
  };

  const reedGroups = groupReeds(reeds);
  const [expandedGroupKey, setExpandedGroupKey] = useState(null); // タップした箱だけ中身を展開する
  const [evaluatingReedId, setEvaluatingReedId] = useState(null); // タップした登録済みリードの評価詳細を表示

  const evaluatingReed = reeds.find((r) => r.id === evaluatingReedId) || null;
  if (evaluatingReed) {
    return (
      <ReedEvaluationDetail
        reed={evaluatingReed} reeds={reeds} sessions={sessions} setReeds={setReeds}
        onBack={() => setEvaluatingReedId(null)}
      />
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "16px 18px", marginBottom: 12 }}>
        <div className="sans" style={{ fontSize: 12, color: "#121F32", fontWeight: 700, marginBottom: 12 }}>新しいリードを登録</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div>
            <label className="sans" style={{ fontSize: 9, color: "#435266", display: "block", marginBottom: 3 }}>銘柄</label>
            <select value={newBrand} onChange={(e) => setNewBrand(e.target.value)} style={{ width: "100%" }}>
              {brandOptions.map((b) => (<option key={b} value={b}>{b}</option>))}
              <option value="__custom__">＋ 新しい銘柄を入力...</option>
            </select>
          </div>
          <div>
            <label className="sans" style={{ fontSize: 9, color: "#435266", display: "block", marginBottom: 3 }}>番手（硬さ）</label>
            <select value={newStrength} onChange={(e) => setNewStrength(e.target.value)} style={{ width: "100%" }}>
              {REED_STRENGTHS.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </div>
        </div>

        {newBrand === "__custom__" && (
          <input
            type="text" placeholder="新しい銘柄名を入力" value={customBrand}
            onChange={(e) => setCustomBrand(e.target.value)}
            className="sans"
            style={{ width: "100%", background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "7px 10px", color: "#121F32", fontSize: 11, marginBottom: 8, boxSizing: "border-box" }}
          />
        )}

        <div style={{ marginBottom: 10 }}>
          <label className="sans" style={{ fontSize: 9, color: "#435266", display: "block", marginBottom: 3 }}>使用開始日</label>
          <input type="date" value={newStartDate} onChange={(e) => setNewStartDate(e.target.value)} className="sans" style={{ background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "7px 10px", color: "#121F32", fontSize: 11 }} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => registerReeds(1)}
            disabled={newBrand === "__custom__" && !customBrand.trim()}
            className="sans"
            style={{ flex: 1, padding: "10px 4px", borderRadius: 999, border: "1px solid #C3CAD3", background: "transparent", color: "#121F32", fontSize: 12, cursor: "pointer" }}
          >
            1枚ずつ追加
          </button>
          <select value={bulkCount} onChange={(e) => setBulkCount(Number(e.target.value))} style={{ flexShrink: 0 }}>
            {Array.from({ length: REED_BOX_SIZE }, (_, i) => i + 1).map((n) => (<option key={n} value={n}>{n}枚</option>))}
          </select>
          <button
            onClick={() => registerReeds(bulkCount)}
            disabled={newBrand === "__custom__" && !customBrand.trim()}
            className="sans"
            style={{ flex: 1, padding: "10px 4px", borderRadius: 999, border: "none", background: "#174585", color: "#F6F7F9", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            まとめて追加
          </button>
        </div>
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "16px 18px", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="sans" style={{ fontSize: 14, color: "#121F32", fontWeight: 700 }}>登録済みリード <span style={{ color: "#8D95A1", fontWeight: 400 }}>{reeds.length}</span></div>
          {reeds.length > 0 && (
            boxSelectionMode ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={exitBoxSelectionMode}
                  className="sans"
                  style={{ padding: "7px 14px", borderRadius: 999, border: "1px solid #C3CAD3", background: "transparent", color: "#435266", fontSize: 11, cursor: "pointer" }}
                >
                  キャンセル
                </button>
                <button
                  onClick={confirmBoxBatchDelete}
                  disabled={selectedBoxesForDelete.size === 0}
                  className="sans"
                  style={{ padding: "7px 14px", borderRadius: 999, border: "none", background: selectedBoxesForDelete.size > 0 ? "#DC2626" : "#E9ECF0", color: "#FFFFFF", fontSize: 11, fontWeight: 600, cursor: selectedBoxesForDelete.size > 0 ? "pointer" : "default" }}
                >
                  {selectedBoxesForDelete.size > 0 ? `${selectedBoxesForDelete.size}箱を削除` : "削除"}
                </button>
              </div>
            ) : (
              <button
                onClick={startBoxSelectionMode}
                className="sans"
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 14px", borderRadius: 999, border: "1px solid #C3CAD3", background: "transparent", color: "#435266", fontSize: 11, cursor: "pointer" }}
              >
                <Trash2 size={13} /> 削除
              </button>
            )
          )}
        </div>
        {reeds.length === 0 ? (
          <div className="sans" style={{ fontSize: 11, color: "#8D95A1" }}>まだリードが登録されていません</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reedGroups.map((g) => {
              const isExpanded = expandedGroupKey === g.key;
              const boxChecked = selectedBoxesForDelete.has(g.key);
              const isMemberSelecting = memberSelectGroupKey === g.key;
              return (
                <div key={g.key} style={{ border: "1px solid #E9ECF0", borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "stretch", background: isExpanded ? "#EAEFF5" : "#FFFFFF" }}>
                    {boxSelectionMode ? (
                      <button
                        onClick={() => toggleBoxSelected(g.key)}
                        className="sans"
                        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                      >
                        <input
                          type="checkbox" checked={boxChecked} onChange={() => toggleBoxSelected(g.key)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: 18, height: 18, flexShrink: 0, cursor: "pointer" }}
                        />
                        <span style={{ fontSize: 12 }}>
                          <span style={{ color: "#121F32", fontWeight: 700 }}>{g.brand}</span>{" "}
                          <span style={{ color: "#174585", fontWeight: 700 }}>{g.strength}</span>{" "}
                          <span style={{ color: "#8D95A1", fontSize: 10, fontWeight: 400 }}>使用開始 {g.startDate} ・ {g.members.length}枚</span>
                        </span>
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => setExpandedGroupKey(isExpanded ? null : g.key)}
                          className="sans"
                          style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                        >
                          <span style={{ fontSize: 12 }}>
                            <span style={{ color: "#121F32", fontWeight: 700 }}>{g.brand}</span>{" "}
                            <span style={{ color: "#174585", fontWeight: 700 }}>{g.strength}</span>{" "}
                            <span style={{ color: "#8D95A1", fontSize: 10, fontWeight: 400 }}>使用開始 {g.startDate} ・ {g.members.length}枚</span>
                          </span>
                          {isExpanded ? <ChevronUp size={14} color="#435266" /> : <ChevronDown size={14} color="#435266" />}
                        </button>
                        <button
                          onClick={() => startMemberSelect(g)}
                          title="この箱の中から選んで削除"
                          style={{ flexShrink: 0, display: "flex", alignItems: "center", padding: "0 12px", background: "none", border: "none", borderLeft: "1px solid #E9ECF0", color: "#8D95A1", cursor: "pointer" }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                  {isExpanded && !boxSelectionMode && (
                    <div style={{ borderTop: "1px solid #E9ECF0", padding: "4px 12px" }}>
                      {isMemberSelecting ? (
                        <>
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "8px 0" }}>
                            <button
                              onClick={exitMemberSelect}
                              className="sans"
                              style={{ padding: "6px 12px", borderRadius: 4, border: "1px solid #E9ECF0", background: "transparent", color: "#435266", fontSize: 11, cursor: "pointer" }}
                            >
                              キャンセル
                            </button>
                            <button
                              onClick={confirmMemberBatchDelete}
                              disabled={selectedMembersForDelete.size === 0}
                              className="sans"
                              style={{ padding: "6px 12px", borderRadius: 4, border: "none", background: selectedMembersForDelete.size > 0 ? "#DC2626" : "#E9ECF0", color: "#FFFFFF", fontSize: 11, fontWeight: 600, cursor: selectedMembersForDelete.size > 0 ? "pointer" : "default" }}
                            >
                              {selectedMembersForDelete.size > 0 ? `${selectedMembersForDelete.size}枚を削除` : "削除"}
                            </button>
                          </div>
                          {/* 削除選択中: ドラッグ・評価タップは無効化し、行タップ/チェックボックスで選択する */}
                          {g.members.map((r, idx) => (
                            <div
                              key={r.id}
                              onClick={() => toggleMemberSelected(r.id)}
                              style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: idx < g.members.length - 1 ? "1px solid #EEF1F4" : "none", cursor: "pointer" }}
                            >
                              <input
                                type="checkbox" checked={selectedMembersForDelete.has(r.id)}
                                onChange={() => toggleMemberSelected(r.id)}
                                onClick={(e) => e.stopPropagation()}
                                style={{ width: 20, height: 20, flexShrink: 0, cursor: "pointer" }}
                              />
                              <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 18, color: "#121F32", width: 28, flexShrink: 0 }}>#{reedPosition(r, reeds) ?? idx + 1}</span>
                              <StarRating value={r.rating} onChange={() => {}} readOnly size={11} />
                            </div>
                          ))}
                        </>
                      ) : (
                        <ReorderableReedRows
                          members={g.members}
                          onReorder={reorderGroupMembers}
                          onRowClick={(id) => setEvaluatingReedId(id)}
                          renderRow={(r, idx) => (
                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: idx < g.members.length - 1 ? "1px solid #ECEEF1" : "none" }}>
                              <span style={{ fontFamily: "'Instrument Serif', serif", fontSize: 18, color: "#121F32", width: 28, flexShrink: 0 }}>#{reedPosition(r, reeds) ?? idx + 1}</span>
                              <span onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                                <StarRating value={r.rating} onChange={(v) => rateReed(r.id, v)} size={19} />
                              </span>
                              <button
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); goToMeasure(r.id); }}
                                className="sans"
                                style={{ fontSize: 11, padding: "8px 16px", borderRadius: 999, border: "1px solid #174585", background: "transparent", color: "#174585", cursor: "pointer", fontWeight: 600, flexShrink: 0, marginLeft: "auto" }}
                              >
                                測定へ
                              </button>
                            </div>
                          )}
                        />
                      )}
                      {g.members.length > 1 && !isMemberSelecting && (
                        <div className="sans" style={{ fontSize: 9, color: "#8D95A1", padding: "6px 0 2px" }}>
                          長押ししてスライドすると並び替えられます・タップで詳細
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

// ============================================================
// データ分析タブ (企画書10.4節) — リード別比較・リード毎比較・ランキング
// ============================================================
// フレーム配列から比較用の平均値を算出(リード別比較・リード毎比較で共通利用)
function computeFrameMetrics(frames) {
  const avg = (key, abs) => {
    const vals = frames.map((f) => (abs ? Math.abs(f[key]) : f[key])).filter((v) => v !== null && v !== undefined && !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    hnrDb: avg("hnrDb"),
    spectralCentroidHz: avg("spectralCentroidHz"),
    volumeDb: avg("volumeDb"),
    pitchCents: avg("pitchCents", true),
  };
}

// フレーム配列をsemitoneIndex(判定運指の半音インデックス)ごとにグループ化し、
// それぞれの音の平均値(音高・音量・重心・HNR・倍音構成)を算出する。
// 「1つのデータには様々な音が含まれる」ため、理想値・セッション詳細画面の両方で
// 音階ごとの内訳を出すのに使う共通ロジック。semitoneIndexが取れないフレーム(無音等)は除外する。
function groupFramesByNote(frames, NUM_HARMONICS = 8) {
  const groups = {};
  for (const f of frames) {
    if (f.semitoneIndex === null || f.semitoneIndex === undefined) continue;
    if (!groups[f.semitoneIndex]) groups[f.semitoneIndex] = [];
    groups[f.semitoneIndex].push(f);
  }
  return Object.entries(groups)
    .map(([key, groupFrames]) => {
      const semitoneIndex = Number(key);
      const m = computeFrameMetrics(groupFrames);
      const pitchVals = groupFrames.map((f) => f.pitchHz).filter((v) => v !== null && v !== undefined && !isNaN(v));
      const harmonicsProfile = Array.from({ length: NUM_HARMONICS }, (_, i) => {
        const n = i + 1;
        const vals = groupFrames.map((f) => f.harmonics?.find((h) => h.n === n)?.levelNorm).filter((v) => v !== null && v !== undefined);
        return { n, norm: vals.length ? mean(vals) : 0 };
      });
      return {
        semitoneIndex,
        writtenLabel: groupFrames.find((f) => f.matchedWrittenNote)?.matchedWrittenNote ?? null,
        frameCount: groupFrames.length,
        pitchHz: pitchVals.length ? mean(pitchVals) : null,
        volumeDb: m.volumeDb,
        centroidHz: m.spectralCentroidHz,
        hnrDb: m.hnrDb,
        harmonicsProfile,
      };
    })
    .sort((a, b) => b.semitoneIndex - a.semitoneIndex); // 音が高い順(半音インデックスが大きいほど高音)
}

// 理想値プロファイルのnotesマップから、指定した音(semitoneIndex)の理想値を取り出す。
// 該当する音がまだ理想値に登録されていない場合はnull(比較の対象外として扱う)。
function getNoteIdeal(profile, semitoneIndex) {
  if (!profile || semitoneIndex === null || semitoneIndex === undefined) return null;
  return profile.notes?.[semitoneIndex] ?? null;
}

// セッション全体のフレームを音階(運指)ごとに分解し、理想値プロファイルを組み立てる。
// 1回の録音/アップロードに複数の音(スケール等)が含まれていても、それぞれの音ごとに
// 平均値を算出して理想値として持つ。計測タブの録音後・アップロード解析後・
// セッション詳細画面の「理想値に設定」ボタンから共通で使う。
function buildIdealProfileFromSession(session, name, NUM_HARMONICS = 8) {
  const noteGroups = groupFramesByNote(session.frames || [], NUM_HARMONICS);
  const notes = {};
  for (const g of noteGroups) notes[g.semitoneIndex] = g;
  return {
    id: generateId(),
    name,
    saxType: session.saxType,
    recordedAt: new Date().toISOString(),
    notes,
  };
}

// リード別比較・リード毎比較で共通する比較項目の定義
const REED_COMPARE_METRICS = [
  { key: "hnrDb", label: "HNR", unit: "dB", fmt: (v) => v.toFixed(1) },
  { key: "spectralCentroidHz", label: "スペクトル重心", unit: "Hz", fmt: (v) => Math.round(v).toString() },
  { key: "volumeDb", label: "音量", unit: "dB", fmt: (v) => v.toFixed(1) },
  { key: "pitchCents", label: "ピッチ誤差(絶対値)", unit: "¢", fmt: (v) => v.toFixed(1) },
];

// リード比較で複数リードを色分けするためのパレット(選択順に割り当て)
const REED_COMPARE_COLORS = ["#174585", "#7FA0CE", "#B9C9E4", "#D97706", "#16A34A", "#8D95A1"];

// ランキングタブ: リードごとのフレームを集約してスコアリングし、ReedRankingTabで並び替え表示する。
// (「登録」「比較」と並列の独立タブ。以前はDataAnalysisView内の「評価」子タブに比較と同居していた)
function ReedRankingSection({ reeds, sessions, selectedIdeal }) {
  // リードごとにセッションのフレームを集約し、スコアリング用の配列を作る
  const buildReedMetrics = (reedId) => {
    const reedSessions = sessions.filter((s) => s.reedId === reedId);
    const allFrames = reedSessions.flatMap((s) => s.frames || []);
    const hnrValues = allFrames.map((f) => f.hnrDb).filter((v) => v !== null && v !== undefined);
    const volumeDbValues = allFrames.map((f) => f.volumeDb).filter((v) => v !== null && v !== undefined);
    const pitchCentsErrorValues = allFrames.map((f) => f.pitchCents).filter((v) => v !== null && v !== undefined);
    // 重心の理想値は音ごとに異なるため、フレーム毎にそのフレームの音に対応する理想値と比較してから平均する
    const centroidClosenessValues = allFrames
      .map((f) => {
        const noteIdeal = getNoteIdeal(selectedIdeal, f.semitoneIndex);
        if (!noteIdeal?.centroidHz || f.spectralCentroidHz === null || f.spectralCentroidHz === undefined) return null;
        return closenessToIdealScore(f.spectralCentroidHz, noteIdeal.centroidHz, 0.25);
      })
      .filter((v) => v !== null && v !== undefined);
    return { reedSessions, allFrames, hnrValues, volumeDbValues, pitchCentsErrorValues, centroidClosenessValues };
  };

  const reedRankings = reeds.map((reed) => {
    const m = buildReedMetrics(reed.id);
    const scoreResult = reedCompositeScore(
      { hnrValues: m.hnrValues, volumeDbValues: m.volumeDbValues, pitchCentsErrorValues: m.pitchCentsErrorValues, centroidClosenessValues: m.centroidClosenessValues }
    );
    return { reed, rating: reed.rating ?? null, sessionCount: m.reedSessions.length, frameCount: m.allFrames.length, ...scoreResult };
  }).sort((a, b) => b.composite - a.composite);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <ReedRankingTab reedRankings={reedRankings} hasIdeal={!!selectedIdeal} reeds={reeds} />
    </div>
  );
}


// --- 10.4(a): リード別比較(複数リードをグラフで視覚比較) ---
function ReedCompareTab({ reeds, sessions, compareReedIds, setCompareReedIds }) {
  const toggleReed = (id) => {
    setCompareReedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // 他の画面(計測タブのリード選択・リード登録一覧)と同じく、箱をタップしてから個体一覧が
  // 出るようにする(登録リードが増えるとボタンが一画面に収まらなくなるため)
  const [expandedBoxKey, setExpandedBoxKey] = useState(null);

  const frameCountFor = (reedId) => sessions.filter((s) => s.reedId === reedId).reduce((n, s) => n + (s.frames?.length ?? 0), 0);

  const summaryFor = (reedId) => {
    const frames = sessions.filter((s) => s.reedId === reedId).flatMap((s) => s.frames || []);
    return computeFrameMetrics(frames);
  };

  if (reeds.length === 0) {
    return <div className="sans" style={{ fontSize: 11, color: "#8D95A1", textAlign: "center", padding: 30 }}>比較するリードがありません。まず「登録」タブでリードを登録してください</div>;
  }

  const items = compareReedIds
    .map((id) => reeds.find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => ({ reed: r, label: reedLabel(r, reeds), summary: summaryFor(r.id), frameCount: frameCountFor(r.id) }));

  // 複数リードを色で識別するためのパレット(Claude Designのネイビー系グラデーション)。
  // 選択順にitemsへ割り当て、チップの色ドットと各項目の棒グラフ色を揃える。
  const colorForIndex = (i) => REED_COMPARE_COLORS[i % REED_COMPARE_COLORS.length];
  const colorById = new Map(items.map((it, i) => [it.reed.id, colorForIndex(i)]));

  return (
    <div>
      {/* 選択中リードの色チップ(比較グラフの凡例を兼ねる) */}
      {items.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {items.map((it) => (
            <span key={it.reed.id} onClick={() => toggleReed(it.reed.id)} className="sans" style={{
              display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, cursor: "pointer",
              background: "#FFFFFF", border: "1px solid #E1E7EF", color: "#121F32", padding: "8px 13px", borderRadius: 999,
            }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: colorById.get(it.reed.id) }} />
              {it.label}
              <span style={{ color: "#8D95A1" }}>×</span>
            </span>
          ))}
        </div>
      )}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "14px 16px", marginBottom: 12 }}>
        <div className="sans" style={{ fontSize: 11, color: "#8D95A1", marginBottom: 10 }}>比較するリードを選択（複数可）。箱をタップすると中の個体が選べます</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groupReeds(reeds).map((g) => {
            const isExpanded = expandedBoxKey === g.key;
            const selectedInBox = g.members.filter((r) => compareReedIds.includes(r.id)).length;
            return (
              <div key={g.key} style={{ border: "1px solid #E9ECF0", borderRadius: 14, overflow: "hidden" }}>
                <button
                  onClick={() => setExpandedBoxKey(isExpanded ? null : g.key)}
                  className="sans"
                  style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", background: isExpanded ? "#EAEFF5" : "#FFFFFF", border: "none", cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ fontSize: 12 }}>
                    <span style={{ color: "#121F32", fontWeight: 700 }}>{g.brand}</span>{" "}
                    <span style={{ color: "#174585", fontWeight: 700 }}>{g.strength}</span>{" "}
                    <span style={{ color: "#8D95A1", fontSize: 10 }}>（{g.startDate}）{selectedInBox > 0 ? ` ・ ${selectedInBox}枚選択中` : ""}</span>
                  </span>
                  {isExpanded ? <ChevronUp size={14} color="#435266" /> : <ChevronDown size={14} color="#435266" />}
                </button>
                {isExpanded && (
                  <div style={{ padding: "10px 14px", borderTop: "1px solid #E9ECF0", display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {g.members.map((r, idx) => {
                      const sel = compareReedIds.includes(r.id);
                      return (
                        <button key={r.id} onClick={() => toggleReed(r.id)} className="sans" style={{
                          display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                          border: sel ? "none" : "1px solid #E9ECF0",
                          background: sel ? "#174585" : "transparent",
                          color: sel ? "#FFFFFF" : "#435266",
                        }}>
                          {sel && <span style={{ width: 8, height: 8, borderRadius: 2, background: colorById.get(r.id) || "#FFFFFF" }} />}
                          #{r.boxNumber ?? idx + 1}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="sans" style={{ fontSize: 11, color: "#8D95A1", textAlign: "center", padding: 20 }}>リードを選択すると比較グラフが表示されます</div>
      ) : (
        <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "17px" }}>
          {REED_COMPARE_METRICS.map((m) => (
            <ReedMetricBarRow
              key={m.key}
              label={m.label}
              unit={m.unit}
              items={items.map((it) => ({ id: it.reed.id, label: it.label, value: it.summary[m.key], color: colorById.get(it.reed.id) }))}
              fmt={m.fmt}
            />
          ))}
          <div style={{ marginBottom: 4 }}>
            <div className="sans" style={{ fontSize: 10, color: "#435266", marginBottom: 6 }}>主観評価</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map((it) => (
                <div key={it.reed.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="sans" style={{ fontSize: 9, color: "#121F32", width: 150, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={it.label}>{it.label}</span>
                  <StarRating value={it.reed.rating} onChange={() => {}} readOnly size={12} />
                </div>
              ))}
            </div>
          </div>
          <div className="sans" style={{ fontSize: 9, color: "#8D95A1", marginTop: 10 }}>
            {items.map((it) => `${it.label}: ${it.frameCount}フレーム`).join(" ・ ")}
          </div>
        </div>
      )}
    </div>
  );
}

// 1項目分の横棒グラフ行(複数リードを同じスケールで比較)。棒の色は呼び出し側で
// リードごとに割り当てた色(color)を使い、凡例チップと対応させる。
function ReedMetricBarRow({ label, unit, items, fmt }) {
  const values = items.map((i) => i.value).filter((v) => v !== null && v !== undefined && !isNaN(v));
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1e-6);
  return (
    <div style={{ marginBottom: 17 }}>
      <div className="sans" style={{ fontSize: 11, color: "#8D95A1", marginBottom: 9 }}>{label}{unit ? ` (${unit})` : ""}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it) => (
          <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, background: "#EEF1F4", borderRadius: 5, height: 17, position: "relative", overflow: "hidden" }}>
              <div style={{ width: it.value !== null && it.value !== undefined ? `${Math.max(2, (Math.abs(it.value) / maxAbs) * 100)}%` : 0, height: "100%", background: it.color || "#174585", borderRadius: 5 }} />
            </div>
            <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 11, color: "#435266", width: 54, textAlign: "right", flexShrink: 0 }}>{it.value !== null && it.value !== undefined ? fmt(it.value) : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- 10.4(b): リード毎比較(1本のリードの経時変化。HNR以外の項目も切替可能) ---
// 1項目分の折れ線グラフ(セッション毎の推移)
function MetricLineChart({ metricDef, points }) {
  const validPoints = points.filter((p) => p[metricDef.key] !== null && p[metricDef.key] !== undefined);
  const vals = validPoints.map((p) => p[metricDef.key]);
  const minV = vals.length ? Math.min(...vals) : 0;
  const maxV = vals.length ? Math.max(...vals) : 1;
  const range = maxV - minV || 1;

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="sans" style={{ fontSize: 10, color: "#435266", marginBottom: 6 }}>
        {metricDef.label}の推移{metricDef.unit ? `（${metricDef.unit}）` : ""}
      </div>
      {validPoints.length === 0 ? (
        <div className="sans" style={{ fontSize: 10, color: "#8D95A1" }}>データがありません</div>
      ) : (
        <>
          <svg width="100%" height="90" viewBox={`0 0 ${Math.max(300, validPoints.length * 60)} 90`} style={{ display: "block" }}>
            <polyline
              fill="none" stroke="#174585" strokeWidth="2"
              points={validPoints.map((p, i) => {
                const x = i * 60 + 30;
                const y = 70 - ((p[metricDef.key] - minV) / range) * 55;
                return `${x},${y}`;
              }).join(" ")}
            />
            {validPoints.map((p, i) => {
              const x = i * 60 + 30;
              const y = 70 - ((p[metricDef.key] - minV) / range) * 55;
              return <circle key={i} cx={x} cy={y} r={3.5} fill="#174585" />;
            })}
          </svg>
          <div className="sans" style={{ fontSize: 9, color: "#435266", display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
            {validPoints.map((p, i) => (
              <span key={i} title={p.memo || undefined}>
                {new Date(p.date).toLocaleDateString("ja-JP")}: {metricDef.fmt(p[metricDef.key])}
                {p.memo && <span style={{ color: "#174585" }}> 「{p.memo}」</span>}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// 登録済みリードをタップした際の評価詳細(経時変化グラフ)。旧「リード毎比較」タブの内容を、
// リード登録一覧からのタップ遷移として統合したもの。
function ReedEvaluationDetail({ reed, reeds, sessions, setReeds, onBack }) {
  const reedSessions = sessions
    .filter((s) => s.reedId === reed.id)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  const points = reedSessions.map((s) => {
    const frames = s.frames || [];
    return { date: s.recordedAt, frameCount: frames.length, memo: s.memo, ...computeFrameMetrics(frames) };
  });

  const allFrames = reedSessions.flatMap((s) => s.frames || []);
  const overall = computeFrameMetrics(allFrames);

  const [view, setView] = useState("avg"); // "avg" | "trend"(My Dataと同じ形式)

  // #番号・名前(個体を識別するための自由記述のニックネーム)・メモは打鍵毎の書き込みを避けるため
  // ローカルstateで編集し、フォーカスが外れた時にまとめてリードへ反映する(セッション詳細と同じパターン)。
  // #番号は数字管理の人もいればアルファベットや記号で管理する人もいるため自由記述にする
  // (デフォルトは登録順の連番のまま。空にすればまた自動採番に戻る)。
  const [positionDraft, setPositionDraft] = useState(String(reedPosition(reed, reeds) ?? ""));
  const [nicknameDraft, setNicknameDraft] = useState(reed.nickname || "");
  const [memoDraft, setMemoDraft] = useState(reed.memo || "");
  useEffect(() => {
    setPositionDraft(String(reedPosition(reed, reeds) ?? ""));
    setNicknameDraft(reed.nickname || "");
    setMemoDraft(reed.memo || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reed.id]);

  const patchReed = (patch) => setReeds((prev) => prev.map((r) => (r.id === reed.id ? { ...r, ...patch } : r)));
  const commitPosition = () => {
    const trimmed = positionDraft.trim();
    if (trimmed === String(reed.boxNumber ?? "")) return;
    patchReed({ boxNumber: trimmed || null });
  };
  const commitNickname = () => {
    const trimmed = nicknameDraft.trim();
    if (trimmed === (reed.nickname || "")) return;
    patchReed({ nickname: trimmed || null });
  };
  const commitMemo = () => {
    const trimmed = memoDraft.trim();
    if (trimmed === (reed.memo || "")) return;
    patchReed({ memo: trimmed || null });
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <button
        onClick={onBack}
        className="sans"
        style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#174585", fontSize: 11, marginBottom: 10, cursor: "pointer", padding: 0 }}
      >
        <ChevronDown size={13} style={{ transform: "rotate(90deg)" }} /> 一覧に戻る
      </button>

      {/* 個体の識別情報・主観評価・メモ。名前とメモはここでのみ編集する(一覧側の鉛筆編集は廃止) */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "14px 16px", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 12, color: "#121F32", fontWeight: 700, marginBottom: 10 }}>{reedLabel(reed, reeds)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="sans" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#435266", flexShrink: 0, width: 44 }}>#番号:</span>
            <input
              type="text" placeholder="数字・アルファベット・記号など自由に(空欄で自動採番に戻る)"
              value={positionDraft} onChange={(e) => setPositionDraft(e.target.value)} onBlur={commitPosition}
              className="sans"
              style={{ width: 80, flexShrink: 0, background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "6px 10px", color: "#121F32", fontSize: 11 }}
            />
          </div>
          <div className="sans" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#435266", flexShrink: 0, width: 44 }}>名前:</span>
            <input
              type="text" placeholder="このリードの呼び名(任意)"
              value={nicknameDraft} onChange={(e) => setNicknameDraft(e.target.value)} onBlur={commitNickname}
              className="sans"
              style={{ flex: 1, background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "6px 10px", color: "#121F32", fontSize: 11 }}
            />
          </div>
          <div className="sans" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#435266", flexShrink: 0, width: 44 }}>評価:</span>
            <StarRating value={reed.rating} onChange={(v) => patchReed({ rating: v })} size={22} />
          </div>
          <div className="sans" style={{ fontSize: 11, display: "flex", alignItems: "flex-start", gap: 8 }}>
            <span style={{ color: "#435266", flexShrink: 0, width: 44, marginTop: 6 }}>メモ:</span>
            <textarea
              placeholder="このリードの印象・特徴など(任意)"
              value={memoDraft} onChange={(e) => setMemoDraft(e.target.value)} onBlur={commitMemo}
              rows={2}
              className="sans"
              style={{ flex: 1, background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "6px 10px", color: "#121F32", fontSize: 11, resize: "vertical", fontFamily: "inherit" }}
            />
          </div>
        </div>
      </div>

      {/* My Data(分析タブ)と同じ形式: 平均値(デフォルト)/推移をタブで切替 */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
          <div className="sans" style={{ fontSize: 12, color: "#121F32", fontWeight: 700 }}>測定データ</div>
          <div style={{ display: "flex", gap: 4 }}>
            {[{ key: "avg", label: "平均値" }, { key: "trend", label: "推移" }].map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className="sans"
                style={{
                  fontSize: 10, padding: "4px 12px", borderRadius: 4, cursor: "pointer",
                  border: view === t.key ? "1.5px solid #174585" : "1px solid #E9ECF0",
                  background: view === t.key ? "#EAEFF5" : "transparent",
                  color: view === t.key ? "#174585" : "#435266",
                  fontWeight: view === t.key ? 600 : 400,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="sans" style={{ fontSize: 10, color: "#435266", marginBottom: 12 }}>{points.length}セッション</div>
        {points.length === 0 ? (
          <div className="sans" style={{ fontSize: 11, color: "#8D95A1" }}>このリードに紐づく測定データがまだありません</div>
        ) : view === "avg" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {REED_COMPARE_METRICS.map((m) => {
              const v = overall[m.key];
              return (
                <div key={m.key} style={{ border: "1px solid #E9ECF0", borderRadius: 5, padding: "10px 12px" }}>
                  <div className="sans" style={{ fontSize: 9, color: "#435266" }}>{m.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2, color: "#121F32" }}>
                    {v !== null && v !== undefined ? `${m.fmt(v)}${m.unit ? ` ${m.unit}` : ""}` : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          REED_COMPARE_METRICS.map((m) => (
            <MetricLineChart key={m.key} metricDef={m} points={points} />
          ))
        )}
      </div>
    </div>
  );
}

// --- 10.4(c): ランキング(総合スコア。各項目で昇順/降順ソート可能) ---
const RANKING_SORT_OPTIONS = [
  { key: "composite", label: "総合スコア" },
  { key: "rating", label: "主観評価" },
  { key: "hnr", label: "HNR" },
  { key: "volumeStability", label: "音量安定" },
  { key: "pitchStability", label: "ピッチ安定" },
  { key: "centroidCloseness", label: "重心近似" },
];

function getRankingSortValue(item, key) {
  if (key === "composite") return item.composite;
  if (key === "rating") return item.rating;
  return item.breakdown[key];
}

function ReedRankingTab({ reedRankings, hasIdeal, reeds }) {
  const [sortKey, setSortKey] = useState("composite");
  const [sortDir, setSortDir] = useState("desc"); // "desc" | "asc"

  if (reedRankings.length === 0) {
    return <div className="sans" style={{ fontSize: 11, color: "#8D95A1", textAlign: "center", padding: 30 }}>リードが登録されていません</div>;
  }

  const sorted = [...reedRankings].sort((a, b) => {
    const va = getRankingSortValue(a, sortKey);
    const vb = getRankingSortValue(b, sortKey);
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return sortDir === "desc" ? vb - va : va - vb;
  });

  // スコアバッジの背景色(3段階の淡色)と順位番号の色
  const scoreBg = (score) => (score >= 0.75 ? "#E8F6ED" : score >= 0.5 ? "#FDF0E1" : "#FBE9E9");
  const rankColor = (idx) => (idx === 0 ? "#174585" : idx === 1 ? "#8D95A1" : "#C3CAD3");

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <span className="sans" style={{ fontSize: 11, color: "#8D95A1" }}>並び替え</span>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
          {RANKING_SORT_OPTIONS.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
        </select>
        <button
          onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
          className="sans"
          style={{ padding: "7px 12px", borderRadius: 999, border: "1px solid #E9ECF0", background: "#FFFFFF", color: "#174585", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
        >
          {sortDir === "desc" ? "降順 ▼" : "昇順 ▲"}
        </button>
      </div>

      {!hasIdeal && (
        <div className="sans" style={{ fontSize: 10, color: "#435266", marginBottom: 12, padding: "10px 14px", background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 12 }}>
          理想値プロファイル未選択のため、スペクトル重心近似度は評価に含まれていません（HNR・音量安定性・ピッチ安定性の3要素で算出）
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sorted.map((item, idx) => (
          <div key={item.reed.id} style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 23, fontWeight: 700, color: rankColor(idx), width: 26, flexShrink: 0, textAlign: "center" }}>{idx + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sans" style={{ fontSize: 14, fontWeight: 700, color: "#121F32", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reedLabel(item.reed, reeds)}</div>
                <div className="sans" style={{ fontSize: 10, color: "#8D95A1", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>{item.sessionCount}セッション ・ {item.frameCount}フレーム</span>
                  <StarRating value={item.rating} onChange={() => {}} readOnly size={11} />
                </div>
              </div>
              <div style={{ textAlign: "center", background: scoreBg(item.composite), borderRadius: 12, padding: "7px 13px", flexShrink: 0 }}>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 25, fontWeight: 700, color: scoreToColor(item.composite), lineHeight: 1 }}>
                  {Math.round(item.composite * 100)}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 13 }}>
              {item.breakdown.hnr !== null && <ScoreChip label="HNR" value={item.breakdown.hnr} />}
              <ScoreChip label="音量安定" value={item.breakdown.volumeStability} />
              <ScoreChip label="ピッチ安定" value={item.breakdown.pitchStability} />
              {item.breakdown.centroidCloseness !== null && <ScoreChip label="重心近似" value={item.breakdown.centroidCloseness} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoreChip({ label, value }) {
  return (
    <span className="sans" style={{ fontSize: 9, padding: "3px 8px", borderRadius: 10, background: "#F6F7F9", border: `1px solid ${scoreToColor(value)}`, color: scoreToColor(value) }}>
      {label} {Math.round(value * 100)}
    </span>
  );
}

// ============================================================
// 分析ラボ (③) — 企画書v6 11節
//
// 11.4(b)(c)の「体の使い方」原因推定: リード軸・音域軸の両方が実働。
// (音域軸はフレームにsemitoneIndexを保存する拡張により有効化済み)
// 11.6節の自由軸集計: ピボット型クロス集計として実装。
// 縦軸(音名/音域帯) × 横軸(リード/リード×使用日数/録音日) の交点に
// 選択した指標(平均ピッチ偏差・高次倍音強度・HNR・重心)を数値表示する。
// ============================================================
// ピッチ偏差セルの色分け(絶対値: <10¢緑 / <25¢アンバー / それ以上赤)
function pitchCellColor(cents) {
  const a = Math.abs(cents);
  if (a < 10) return "#16A34A";
  if (a < 25) return "#D97706";
  return "#DC2626";
}

function usageDays(recordedAt, startDate) {
  if (!startDate) return null;
  const days = Math.floor((new Date(recordedAt) - new Date(startDate)) / 86400000) + 1;
  return Math.max(1, days);
}

// ============================================================
// クロス集計(ピボット) — Excelのピボットテーブル風の自由軸集計
//
// 「次元」(カテゴリ値)はフィルター(集計対象抽出)・縦軸・横軸のどこにでも配置でき、
// 「指標」(数値)はセルの集計値として選ぶ。フレームは呼び出し側でセッション情報
// (録音日時・奏者・サックス種別・録音/アップロード・メモ・リードオブジェクト)を
// 付与した形(enriched frame)で渡す。getValue(f, ctx)のctxは{reeds}。
// ============================================================
const PIVOT_BAND_ORDER = { low: 0, mid: 1, high: 2 };

const PIVOT_DIMENSIONS = [
  {
    key: "note", label: "音名",
    getValue: (f) => f.matchedWrittenNote ?? null,
    // 縦軸では上から、横軸では左から高い音が来るように、半音インデックスの降順(符号反転)で
    // ソートする(未判定は999で従来通り末尾に置く)。行・列とも同じ昇順ソートを共通で使う
    // buildPivotの仕組み上、ここでソートキーを反転させるのが一番シンプルな実装になる。
    getSort: (f) => (f.semitoneIndex === null || f.semitoneIndex === undefined ? 999 : -f.semitoneIndex),
  },
  {
    key: "band", label: "音域帯",
    getValue: (f) => {
      const band = registerBand(f.semitoneIndex);
      return band === "unknown" ? null : REGISTER_BAND_LABELS[band];
    },
    getSort: (f) => PIVOT_BAND_ORDER[registerBand(f.semitoneIndex)] ?? 9,
  },
  {
    key: "reed", label: "リード(個体)",
    getValue: (f, ctx) => (f.reed ? reedLabel(f.reed, ctx.reeds) : "未紐付け"),
  },
  {
    key: "brand", label: "リード銘柄",
    getValue: (f) => f.reed?.brand ?? "未紐付け",
  },
  {
    key: "strength", label: "リード番手",
    getValue: (f) => (f.reed ? String(f.reed.strength) : "未紐付け"),
    getSort: (f) => (f.reed ? parseFloat(f.reed.strength) : 999),
  },
  {
    key: "rating", label: "リード主観評価",
    getValue: (f) => (f.reed ? (f.reed.rating ? `★${f.reed.rating}` : "未評価") : "未紐付け"),
    getSort: (f) => (f.reed ? (f.reed.rating ?? 0) : -1),
  },
  {
    key: "reedDays", label: "開封後日数",
    // フィルターでは範囲選択(numberRange)にするため、値そのものの取得はgetRangeValueで行う
    getValue: (f) => {
      if (!f.reed) return null;
      const d = usageDays(f.recordedAt, f.reed.startDate);
      return d ? `${d}日目` : null;
    },
    getSort: (f) => (f.reed ? usageDays(f.recordedAt, f.reed.startDate) ?? 999 : 999),
    filterKind: "numberRange",
    getRangeValue: (f) => (f.reed ? usageDays(f.recordedAt, f.reed.startDate) : null),
  },
  {
    key: "date", label: "録音日",
    getValue: (f) => new Date(f.recordedAt).toLocaleDateString("ja-JP"),
    getSort: (f) => new Date(f.recordedAt).setHours(0, 0, 0, 0),
    filterKind: "dateRange",
    getRangeValue: (f) => new Date(f.recordedAt).setHours(0, 0, 0, 0),
  },
  {
    key: "performer", label: "奏者",
    getValue: (f) => f.performer || "—",
  },
  {
    key: "saxType", label: "サックス種別",
    getValue: (f) => SAX_PRESETS[f.saxType]?.label ?? f.saxType ?? null,
  },
  {
    key: "source", label: "データ種別",
    getValue: (f) => (f.source === "upload" ? "アップロード" : "録音"),
  },
  {
    key: "memo", label: "メモ",
    getValue: (f) => f.memo || "（メモなし）",
  },
];

function harmonicSliceMean(f, lo, hi) {
  const hs = f.harmonics?.slice(lo, hi).map((h) => h.levelNorm) ?? [];
  return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null;
}

const PIVOT_MEASURES = [
  { key: "pitchCents", label: "平均ピッチ偏差(¢)", getValue: (f) => f.pitchCents, fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(1), color: pitchCellColor },
  { key: "pitchHz", label: "ピッチ(Hz)", getValue: (f) => f.pitchHz, fmt: (v) => v.toFixed(1) },
  { key: "volume", label: "音量(dB)", getValue: (f) => f.volumeDb, fmt: (v) => v.toFixed(1) },
  { key: "lowHarm", label: "倍音強度(低次1-4)", getValue: (f) => harmonicSliceMean(f, 0, 4), fmt: (v) => (v * 100).toFixed(0) },
  { key: "highHarm", label: "倍音強度(高次5-8)", getValue: (f) => harmonicSliceMean(f, 4, 8), fmt: (v) => (v * 100).toFixed(0) },
  { key: "hnr", label: "HNR(dB)", getValue: (f) => f.hnrDb, fmt: (v) => v.toFixed(1) },
  { key: "centroid", label: "重心(Hz)", getValue: (f) => f.spectralCentroidHz, fmt: (v) => Math.round(v).toString() },
  { key: "count", label: "フレーム数", getValue: () => 1, agg: "sum", fmt: (v) => String(v) },
];

// 指定した次元がとりうる値の一覧を、ソートキーつきで返す(音域帯まとめ選択など値→ソートキーの
// 対応が必要な場面用)。次元のソート順で並ぶ。
function pivotDimensionValueEntries(frames, ctx, dimKey) {
  const dim = PIVOT_DIMENSIONS.find((d) => d.key === dimKey);
  if (!dim) return [];
  const sortByValue = new Map();
  for (const f of frames) {
    const v = dim.getValue(f, ctx);
    if (v === null || v === undefined) continue;
    if (!sortByValue.has(v)) sortByValue.set(v, dim.getSort ? dim.getSort(f, ctx) : v);
  }
  return [...sortByValue.entries()]
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([value, sortKey]) => ({ value, sortKey }));
}

// 指定した次元がとりうる値の一覧(フィルターUIの選択肢用)。次元のソート順で返す
function pivotDimensionValues(frames, ctx, dimKey) {
  return pivotDimensionValueEntries(frames, ctx, dimKey).map((e) => e.value);
}

// filters: 通常は{dimKey, values: string[]}(値が1つ以上選ばれているフィルターだけ有効)。
// dimKindが"dateRange"/"numberRange"の次元は{dimKey, rangeMin, rangeMax}を使い、
// どちらか一方でも指定されていれば有効(未指定側は無制限)。
// colKey === "none" の場合は横軸なし(「全体」1列)として集計する。
function buildPivot(frames, ctx, rowKey, colKey, measureKey, filters) {
  const rowDim = PIVOT_DIMENSIONS.find((d) => d.key === rowKey);
  const colDim = colKey === "none" ? null : PIVOT_DIMENSIONS.find((d) => d.key === colKey);
  const measure = PIVOT_MEASURES.find((m) => m.key === measureKey);
  if (!rowDim || !measure) return { cells: {}, rowKeys: [], colKeys: [], measure: null };

  const activeFilters = (filters || [])
    .map((flt) => ({ ...flt, dim: PIVOT_DIMENSIONS.find((d) => d.key === flt.dimKey) }))
    .filter((flt) => {
      if (!flt.dim) return false;
      if (flt.dim.filterKind) return flt.rangeMin != null || flt.rangeMax != null;
      return (flt.values || []).length > 0;
    });

  const cells = {}; // rowKey -> colKey -> {sum, count}
  const rowSort = {};
  const colSort = {};
  for (const f of frames) {
    const rejected = activeFilters.some((flt) => {
      if (flt.dim.filterKind) {
        const rv = flt.dim.getRangeValue(f, ctx);
        if (rv === null || rv === undefined) return true;
        if (flt.rangeMin != null && rv < flt.rangeMin) return true;
        if (flt.rangeMax != null && rv > flt.rangeMax) return true;
        return false;
      }
      return !flt.values.includes(flt.dim.getValue(f, ctx));
    });
    if (rejected) continue;
    const rk = rowDim.getValue(f, ctx);
    const ck = colDim ? colDim.getValue(f, ctx) : "全体";
    const v = measure.getValue(f);
    if (rk === null || rk === undefined || ck === null || ck === undefined || v === null || v === undefined || isNaN(v)) continue;
    if (!cells[rk]) cells[rk] = {};
    if (!cells[rk][ck]) cells[rk][ck] = { sum: 0, count: 0 };
    cells[rk][ck].sum += v;
    cells[rk][ck].count += 1;
    if (rowSort[rk] === undefined) rowSort[rk] = rowDim.getSort ? rowDim.getSort(f, ctx) : rk;
    if (colDim && colSort[ck] === undefined) colSort[ck] = colDim.getSort ? colDim.getSort(f, ctx) : ck;
  }

  const bySort = (sortMap) => (a, b) => {
    const sa = sortMap[a], sb = sortMap[b];
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  };
  const rowKeys = Object.keys(cells).sort(bySort(rowSort));
  const colKeys = colDim
    ? [...new Set(Object.values(cells).flatMap((row) => Object.keys(row)))].sort(bySort(colSort))
    : ["全体"];
  return { cells, rowKeys, colKeys, measure };
}

// 奏者が「自分」のセッションだけを集めた経時変化グラフ。分析タブの一番上に表示し、
// 自分の演奏がどう変化しているかを他のリード・セッションのデータから独立して確認できるようにする。
// My Dataで扱う4指標。idealKeyは理想値プロファイルのnote側フィールド名(ピッチ誤差は理想=0が定義)
const MY_DATA_METRICS = [
  { key: "volumeDb", idealKey: "volumeDb", label: "音量", unit: "dB", fmt: (v) => v.toFixed(1) },
  { key: "spectralCentroidHz", idealKey: "centroidHz", label: "スペクトル重心", unit: "Hz", fmt: (v) => Math.round(v).toString() },
  { key: "hnrDb", idealKey: "hnrDb", label: "HNR", unit: "dB", fmt: (v) => v.toFixed(1) },
  { key: "pitchCents", idealKey: null, label: "ピッチ誤差(絶対値)", unit: "¢", fmt: (v) => v.toFixed(1) },
];

// フレーム列に対する「理想値の加重平均」。各フレームの音(semitoneIndex)に対応する
// 理想値をフレーム数で加重平均する(音の構成が違うセッション同士でも公平に比較できる)
function idealAvgForFrames(frames, profile, idealKey) {
  if (!profile || !idealKey) return null;
  const vals = frames
    .map((f) => getNoteIdeal(profile, f.semitoneIndex)?.[idealKey])
    .filter((v) => v !== null && v !== undefined && !isNaN(v));
  return vals.length ? mean(vals) : null;
}

// 3ヶ月/6ヶ月/1年は「直近Nヶ月」のローリング期間。1年より前のデータは1年単位の
// 期間(2年目=1〜2年前、3年目=2〜3年前…)で追加抽出できるようにする。
const MY_DATA_BASE_RANGES = [
  { key: "3m", label: "3ヶ月" },
  { key: "6m", label: "6ヶ月" },
  { key: "1y", label: "1年" },
];

function getMyDataRangeBounds(rangeKey, now) {
  if (rangeKey === "3m") { const d = new Date(now); d.setMonth(d.getMonth() - 3); return { start: d, end: null }; }
  if (rangeKey === "6m") { const d = new Date(now); d.setMonth(d.getMonth() - 6); return { start: d, end: null }; }
  if (rangeKey === "1y") { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return { start: d, end: null }; }
  const m = /^year(\d+)$/.exec(rangeKey);
  if (m) {
    const n = Number(m[1]);
    const start = new Date(now); start.setFullYear(start.getFullYear() - n);
    const end = new Date(now); end.setFullYear(end.getFullYear() - (n - 1));
    return { start, end };
  }
  return { start: null, end: null };
}

// My Data: 奏者が「自分」のセッションの集計。期間セレクタで対象期間を絞り、
// 平均値(デフォルト)/推移をタブで切替。平均値は数値同士の比較が目的なので
// グラフにせずスタットカード(実測+理想+差分)で表し、推移は時間変化を見るものなので
// 折れ線(実測=青実線、理想=灰破線)で表す。
function MyDataSection({ sessions, selectedIdeal }) {
  const [view, setView] = useState("avg"); // "avg" | "trend"
  const allMySessions = sessions.filter((s) => s.performer === "自分");
  const [range, setRange] = useState("1y");

  const now = new Date();
  const oldestMs = allMySessions.length ? Math.min(...allMySessions.map((s) => new Date(s.recordedAt).getTime())) : null;
  const yearsOfData = oldestMs ? Math.max(1, Math.ceil((now - oldestMs) / (365.25 * 24 * 3600 * 1000))) : 1;
  const rangeOptions = [
    ...MY_DATA_BASE_RANGES,
    ...Array.from({ length: Math.max(0, yearsOfData - 1) }, (_, i) => ({ key: `year${i + 2}`, label: `${i + 2}年目` })),
  ];

  const { start, end } = getMyDataRangeBounds(range, now);
  const mySessions = allMySessions
    .filter((s) => {
      const t = new Date(s.recordedAt);
      if (start && t < start) return false;
      if (end && t >= end) return false;
      return true;
    })
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  const allFrames = mySessions.flatMap((s) => s.frames || []);
  const overall = computeFrameMetrics(allFrames);

  const points = mySessions.map((s) => {
    const frames = s.frames || [];
    const ideals = {};
    for (const m of MY_DATA_METRICS) {
      ideals[m.key] = m.key === "pitchCents" ? (selectedIdeal ? 0 : null) : idealAvgForFrames(frames, selectedIdeal, m.idealKey);
    }
    return { date: s.recordedAt, frameCount: frames.length, memo: s.memo, ideals, ...computeFrameMetrics(frames) };
  });

  // ヒーローカード用: 平均ピッチ偏差(符号つき)と、期間内前半→後半の改善幅、スパークライン用の系列
  const heroVal = overall.pitchCents;
  const rangeLabel = rangeOptions.find((o) => o.key === range)?.label ?? "";
  const sparkVals = points.map((p) => p.pitchCents).filter((v) => v !== null && v !== undefined && !isNaN(v));
  let improve = null; // { delta } deltaが負なら改善(絶対値が小さくなった)
  if (sparkVals.length >= 4) {
    const mid = Math.floor(sparkVals.length / 2);
    const avgAbs = (a) => a.reduce((s, v) => s + Math.abs(v), 0) / a.length;
    improve = { delta: avgAbs(sparkVals.slice(mid)) - avgAbs(sparkVals.slice(0, mid)) };
  }

  return (
    <>
      {/* 今期の平均ピッチ偏差ヒーローカード(Claude Design) */}
      <div style={{ background: "#174585", borderRadius: 20, padding: 20, marginBottom: 12, color: "#FFFFFF" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#B9C9E4" }}>平均ピッチ偏差</div>
          <select value={range} onChange={(e) => setRange(e.target.value)} style={{ fontSize: 11 }}>
            {rangeOptions.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 48, fontWeight: 600, lineHeight: 0.9 }}>
            {heroVal !== null && heroVal !== undefined ? `${heroVal > 0 ? "+" : ""}${heroVal.toFixed(1)}` : "—"}
            <span style={{ fontSize: 22, color: "#9DB3D6" }}>¢</span>
          </span>
          {improve && (
            <span className="sans" style={{
              display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999, marginBottom: 8,
              background: improve.delta <= 0 ? "#2FB673" : "#EBC66B", color: "#04130D",
            }}>
              {improve.delta <= 0 ? "▲" : "▼"} 期間内 {improve.delta > 0 ? "+" : ""}{improve.delta.toFixed(1)}¢ {improve.delta <= 0 ? "改善" : "悪化"}
            </span>
          )}
        </div>
        {sparkVals.length >= 2 && (() => {
          const W = 320, H = 48;
          const minV = Math.min(...sparkVals), maxV = Math.max(...sparkVals);
          const rng = maxV - minV || 1;
          const xy = sparkVals.map((v, i) => {
            const x = sparkVals.length > 1 ? (i / (sparkVals.length - 1)) * W : W / 2;
            const y = H - 6 - ((v - minV) / rng) * (H - 14);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          });
          return (
            <svg width="100%" height="48" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ marginTop: 12, display: "block" }}>
              <polyline points={`${xy.join(" ")} ${W},${H} 0,${H}`} fill="rgba(143,180,255,.15)" stroke="none" />
              <polyline points={xy.join(" ")} fill="none" stroke="#8FB4FF" strokeWidth="2.5" />
            </svg>
          );
        })()}
        <div style={{ fontSize: 11, color: "#9DB3D6", marginTop: 2 }}>0に近いほど良い ・ {rangeLabel} ・ {points.length}セッション</div>
      </div>

    <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "16px 18px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div className="sans" style={{ fontSize: 14, color: "#121F32", fontWeight: 700 }}>My Data</div>
        <div style={{ display: "flex", gap: 6, background: "#EDEFF3", borderRadius: 10, padding: 3 }}>
          {[{ key: "avg", label: "平均値" }, { key: "trend", label: "推移" }].map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className="sans"
              style={{
                fontSize: 12, padding: "6px 16px", borderRadius: 7, border: "none", cursor: "pointer",
                background: view === t.key ? "#FFFFFF" : "transparent",
                color: view === t.key ? "#174585" : "#8D95A1",
                fontWeight: view === t.key ? 700 : 400,
                boxShadow: view === t.key ? "0 1px 3px rgba(0,0,0,.06)" : "none",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="sans" style={{ fontSize: 10, color: "#8D95A1", marginBottom: 12 }}>
        奏者が「自分」のセッション（{points.length}件）{!selectedIdeal && " ・ 理想値プロファイル未選択のため理想値は表示されません"}
      </div>

      {points.length === 0 ? (
        <div className="sans" style={{ fontSize: 11, color: "#8D95A1" }}>この期間の「自分」のセッションはありません</div>
      ) : view === "avg" ? (
        // 平均値: 全セッション・全フレームの平均。実測と理想(音ごとの理想値のフレーム加重平均)を差分つきで並べる
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {MY_DATA_METRICS.map((m) => {
            const measured = overall[m.key];
            const ideal = m.key === "pitchCents" ? (selectedIdeal ? 0 : null) : idealAvgForFrames(allFrames, selectedIdeal, m.idealKey);
            const diff = measured !== null && ideal !== null ? measured - ideal : null;
            const valueColor = m.key === "pitchCents" && measured !== null ? pitchCellColor(measured) : "#121F32";
            return (
              <div key={m.key} style={{ border: "1px solid #E9ECF0", borderRadius: 14, padding: "14px" }}>
                <div className="sans" style={{ fontSize: 11, color: "#8D95A1" }}>{m.label}</div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 23, fontWeight: 600, margin: "2px 0", color: valueColor }}>
                  {measured !== null ? `${m.fmt(measured)} ${m.unit}` : "—"}
                </div>
                {ideal !== null && (
                  <div className="sans" style={{ fontSize: 9, color: "#8D95A1", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span>理想: {m.fmt(ideal)} {m.unit}</span>
                    {diff !== null && m.key !== "pitchCents" && (
                      <span style={{ color: "#174585" }}>Δ {diff > 0 ? "+" : ""}{m.fmt(diff)}</span>
                    )}
                    {m.key === "pitchCents" && <span style={{ color: "#8D95A1" }}>0に近いほど良い</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        // 推移: セッション毎の平均値の時系列。実測=青実線、理想=灰破線
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {MY_DATA_METRICS.map((m) => (
              <MyTrendChart key={m.key} metric={m} points={points} />
            ))}
          </div>
          <div className="sans" style={{ fontSize: 9, color: "#435266", marginTop: 8, display: "flex", gap: 12 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 12, height: 2, background: "#174585", display: "inline-block" }} />実測</span>
            {selectedIdeal && <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 12, height: 0, borderTop: "2px dashed #8D95A1", display: "inline-block" }} />理想</span>}
          </div>
        </>
      )}
    </div>
    </>
  );
}

// My Data推移用のコンパクトな折れ線。点にホバーすると日付・値・メモを表示する
function MyTrendChart({ metric, points }) {
  const measuredVals = points.map((p) => p[metric.key]).filter((v) => v !== null && v !== undefined && !isNaN(v));
  const idealVals = points.map((p) => p.ideals?.[metric.key]).filter((v) => v !== null && v !== undefined && !isNaN(v));
  const all = [...measuredVals, ...idealVals];
  if (all.length === 0) {
    return (
      <div style={{ border: "1px solid #E9ECF0", borderRadius: 5, padding: "8px 10px" }}>
        <div className="sans" style={{ fontSize: 9, color: "#435266" }}>{metric.label}（{metric.unit}）</div>
        <div className="sans" style={{ fontSize: 10, color: "#8D95A1", marginTop: 8 }}>データなし</div>
      </div>
    );
  }
  const minV = Math.min(...all);
  const maxV = Math.max(...all);
  const range = maxV - minV || 1;
  const W = Math.max(160, points.length * 36);
  const H = 64;
  const x = (i) => (points.length > 1 ? (i / (points.length - 1)) * (W - 20) + 10 : W / 2);
  const y = (v) => H - 8 - ((v - minV) / range) * (H - 18);

  const linePoints = (getVal) =>
    points
      .map((p, i) => ({ v: getVal(p), i }))
      .filter(({ v }) => v !== null && v !== undefined && !isNaN(v))
      .map(({ v, i }) => `${x(i)},${y(v)}`)
      .join(" ");

  return (
    <div style={{ border: "1px solid #E9ECF0", borderRadius: 5, padding: "8px 10px" }}>
      <div className="sans" style={{ fontSize: 9, color: "#435266", marginBottom: 4 }}>{metric.label}（{metric.unit}）</div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
        {idealVals.length > 0 && (
          <polyline fill="none" stroke="#8D95A1" strokeWidth="1.5" strokeDasharray="4,3" points={linePoints((p) => p.ideals?.[metric.key])} />
        )}
        <polyline fill="none" stroke="#174585" strokeWidth="2" points={linePoints((p) => p[metric.key])} />
        {points.map((p, i) => {
          const v = p[metric.key];
          if (v === null || v === undefined || isNaN(v)) return null;
          return (
            <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="#174585">
              <title>{new Date(p.date).toLocaleDateString("ja-JP")}: {metric.fmt(v)}{metric.unit}{p.memo ? ` 「${p.memo}」` : ""}</title>
            </circle>
          );
        })}
      </svg>
      <div className="sans" style={{ fontSize: 8, color: "#8D95A1", display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span>{new Date(points[0].date).toLocaleDateString("ja-JP")}</span>
        {points.length > 1 && <span>{new Date(points[points.length - 1].date).toLocaleDateString("ja-JP")}</span>}
      </div>
    </div>
  );
}

// 直近追加された最新セッション単体の内訳。My Dataの推移グラフ(複数セッションの平均的な変化)とは別に、
// 「今撮ったばかりの1回分」を単独で確認できるようにする。
function LatestSessionCard({ session, reeds }) {
  const reed = reeds.find((r) => r.id === session.reedId) || null;
  const m = computeFrameMetrics(session.frames || []);

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "16px 18px", marginBottom: 12 }}>
      <div className="sans" style={{ fontSize: 14, color: "#121F32", fontWeight: 700, marginBottom: 4 }}>最新セッション</div>
      <div className="sans" style={{ fontSize: 10, color: "#435266", marginBottom: 12 }}>
        {new Date(session.recordedAt).toLocaleString("ja-JP")} ・ {session.performer || "—"} ・ {reed ? reedLabel(reed, reeds) : "未紐付け"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
        {REED_COMPARE_METRICS.map((mt) => {
          const v = m[mt.key];
          return (
            <MetricCard
              key={mt.key} label={mt.label}
              value={v !== null && v !== undefined ? `${mt.fmt(v)}${mt.unit ? ` ${mt.unit}` : ""}` : "—"}
            />
          );
        })}
      </div>
    </div>
  );
}

function AnalysisLabView(props) {
  const {
    sessions, reeds, selectedIdeal, promoteSessionToIdeal,
    NUM_HARMONICS,
    updateSessions, deleteSessions, performers, setPerformers,
  } = props;

  // データタブ内の子タブ: My Data(推移・平均・セッション一覧) / 分析(クロス集計)
  const [dataSubTab, setDataSubTab] = useState("mydata");
  const [pivotRow, setPivotRow] = useState("note");
  const [pivotCol, setPivotCol] = useState("reed");
  const [pivotMetric, setPivotMetric] = useState("pitchCents");
  const [pivotFilters, setPivotFilters] = useState([]); // 集計対象抽出: [{dimKey, values: string[]}]
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(3); // 一覧は直近3件のみ。「もっと見る」で全件展開
  // 削除はリードタブと同様、行ごとのボタンではなくチェックボックスによる複数選択削除にする。
  // (selectedSessionがある時の早期returnより前で呼ぶ必要があるため、ここでまとめて宣言する)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState(() => new Set());

  // 全セッションのフレームを、セッション情報(リード・録音日時・奏者・種別・メモ)つきで平坦化する
  // (semitoneIndexはフレーム自体が保持: 企画書11.7節の記録拡張を実施済み)
  const framesWithContext = sessions.flatMap((s) => {
    const reed = reeds.find((r) => r.id === s.reedId) || null;
    return (s.frames || []).map((f) => ({
      ...f, reedId: s.reedId, reed, recordedAt: s.recordedAt,
      performer: s.performer, saxType: s.saxType, source: s.source, memo: s.memo,
    }));
  });

  // --- ピボット集計 ---
  const pivotCtx = { reeds };
  const pivot = buildPivot(framesWithContext, pivotCtx, pivotRow, pivotCol, pivotMetric, pivotFilters);
  const metricDef = PIVOT_MEASURES.find((m) => m.key === pivotMetric);

  const selectedSession = selectedSessionId ? sessions.find((s) => s.id === selectedSessionId) : null;
  if (selectedSession) {
    return (
      <SessionDetailView
        session={selectedSession} reeds={reeds} sessions={sessions} selectedIdeal={selectedIdeal}
        NUM_HARMONICS={NUM_HARMONICS} promoteSessionToIdeal={promoteSessionToIdeal}
        updateSessions={updateSessions} performers={performers} setPerformers={setPerformers}
        onBack={() => setSelectedSessionId(null)}
      />
    );
  }

  const sortedSessions = [...sessions].sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
  const visibleSessions = sortedSessions.slice(0, visibleCount);
  const latestSession = sortedSessions[0] || null;

  const toggleSessionSelected = (id) => {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedForDelete(new Set());
  };

  const confirmBatchDeleteSessions = () => {
    if (selectedForDelete.size === 0) return;
    if (!window.confirm(`選択した${selectedForDelete.size}件のセッションを削除しますか？(元に戻せません)`)) return;
    deleteSessions([...selectedForDelete]);
    exitSelectionMode();
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* データタブ内の子タブ: My Data / 分析(クロス集計) */}
      <div style={{ display: "flex", gap: 6, background: "#EDEFF3", borderRadius: 11, padding: 4, marginBottom: 12 }}>
        {[
          { key: "mydata", label: "My Data" },
          { key: "analysis", label: "分析" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setDataSubTab(t.key)}
            className="sans"
            style={{
              flex: 1, padding: "9px 4px", borderRadius: 8, border: "none",
              background: dataSubTab === t.key ? "#FFFFFF" : "transparent",
              color: dataSubTab === t.key ? "#174585" : "#8D95A1",
              fontWeight: dataSubTab === t.key ? 700 : 400, fontSize: 13,
              boxShadow: dataSubTab === t.key ? "0 1px 3px rgba(0,0,0,.06)" : "none",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {dataSubTab === "mydata" && (<>
      {/* --- My Data: 「自分」のセッションの推移 --- */}
      <MyDataSection sessions={sessions} selectedIdeal={selectedIdeal} />

      {/* --- 最新セッション: 直近1回分の内訳を単独表示 --- */}
      {latestSession && <LatestSessionCard session={latestSession} reeds={reeds} />}

      {/* --- セッション一覧(録音+アップロード。アップロードは計測タブに統合済み) --- */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "16px 18px", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="sans" style={{ fontSize: 14, color: "#121F32", fontWeight: 700 }}>セッション一覧 <span style={{ color: "#8D95A1", fontWeight: 400 }}>{sessions.length}</span></div>
          {sortedSessions.length > 0 && (
            selectionMode ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={exitSelectionMode}
                  className="sans"
                  style={{ padding: "7px 12px", borderRadius: 4, border: "1px solid #E9ECF0", background: "transparent", color: "#435266", fontSize: 11, cursor: "pointer" }}
                >
                  キャンセル
                </button>
                <button
                  onClick={confirmBatchDeleteSessions}
                  disabled={selectedForDelete.size === 0}
                  className="sans"
                  style={{ padding: "7px 12px", borderRadius: 4, border: "none", background: selectedForDelete.size > 0 ? "#DC2626" : "#E9ECF0", color: "#FFFFFF", fontSize: 11, fontWeight: 600, cursor: selectedForDelete.size > 0 ? "pointer" : "default" }}
                >
                  {selectedForDelete.size > 0 ? `${selectedForDelete.size}件を削除` : "削除"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSelectionMode(true)}
                className="sans"
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 12px", borderRadius: 4, border: "1px solid #E9ECF0", background: "transparent", color: "#435266", fontSize: 11, cursor: "pointer" }}
              >
                <Trash2 size={13} /> 削除
              </button>
            )
          )}
        </div>
        {sortedSessions.length === 0 ? (
          <div className="sans" style={{ fontSize: 11, color: "#8D95A1" }}>まだ記録がありません</div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {visibleSessions.map((s) => {
                const reed = reeds.find((r) => r.id === s.reedId) || null;
                return (
                  <div
                    key={s.id}
                    onClick={() => (selectionMode ? toggleSessionSelected(s.id) : setSelectedSessionId(s.id))}
                    className="sans"
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: "1px solid #EEF1F4", cursor: "pointer", fontSize: 11 }}
                  >
                    {selectionMode && (
                      <input
                        type="checkbox" checked={selectedForDelete.has(s.id)}
                        onChange={() => toggleSessionSelected(s.id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: 20, height: 20, flexShrink: 0, cursor: "pointer" }}
                      />
                    )}
                    <span style={{ color: "#121F32", minWidth: 110, flexShrink: 0 }}>{new Date(s.recordedAt).toLocaleString("ja-JP")}</span>
                    <span style={{ color: "#174585", minWidth: 60, flexShrink: 0 }}>{s.performer || "—"}</span>
                    <span style={{ color: "#435266", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reed ? reedLabel(reed, reeds) : "未紐付け"}</span>
                    {s.source === "upload" && <span style={{ color: "#8D95A1", fontSize: 9, flexShrink: 0 }}>📁</span>}
                  </div>
                );
              })}
            </div>
            {visibleCount < sortedSessions.length ? (
              <button
                onClick={() => setVisibleCount(sortedSessions.length)}
                className="sans"
                style={{ width: "100%", marginTop: 10, padding: "8px 4px", borderRadius: 4, border: "1px solid #E9ECF0", background: "transparent", color: "#174585", fontSize: 11, cursor: "pointer" }}
              >
                もっと見る（残り{sortedSessions.length - visibleCount}件）
              </button>
            ) : visibleCount > 3 && (
              <button
                onClick={() => setVisibleCount(3)}
                className="sans"
                style={{ width: "100%", marginTop: 10, padding: "8px 4px", borderRadius: 4, border: "1px solid #E9ECF0", background: "transparent", color: "#435266", fontSize: 11, cursor: "pointer" }}
              >
                閉じる
              </button>
            )}
          </>
        )}
      </div>
      </>)}

      {dataSubTab === "analysis" && (
      /* --- 11.6節: クロス集計(ピボット型マトリクス) --- */
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "16px 18px" }}>
        <div className="sans" style={{ fontSize: 14, color: "#174585", fontWeight: 700, marginBottom: 4 }}>
          クロス集計（ピボット）
        </div>
        <div className="sans" style={{ fontSize: 10, color: "#8D95A1", lineHeight: 1.6, marginBottom: 12 }}>
          集計対象抽出(フィルター)・縦軸・横軸・指標を組み合わせて、蓄積データをマトリクスで俯瞰します。各セルはその組み合わせに該当するフレームの平均値です。
        </div>

        {/* 集計対象抽出(フィルター): 任意の次元の値で絞り込み。値を1つも選んでいないフィルターは全選択と同じ扱い */}
        <div style={{ marginBottom: 12, padding: "12px 14px", background: "#F6F7F9", borderRadius: 14, border: "1px solid #E9ECF0" }}>
          <div className="sans" style={{ fontSize: 11, color: "#8D95A1", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>集計対象抽出（フィルター）</span>
            <button
              onClick={() => setPivotFilters((prev) => [...prev, { dimKey: PIVOT_DIMENSIONS[0].key, values: [], rangeMin: null, rangeMax: null }])}
              className="sans"
              style={{ fontSize: 11, padding: "6px 13px", borderRadius: 999, border: "1px dashed #A6AEBA", background: "#FFFFFF", color: "#435266", cursor: "pointer" }}
            >
              ＋ 条件を追加
            </button>
          </div>
          {pivotFilters.length === 0 ? (
            <div className="sans" style={{ fontSize: 10, color: "#8D95A1" }}>フィルターなし（全データを集計）</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pivotFilters.map((flt, i) => {
                const dim = PIVOT_DIMENSIONS.find((d) => d.key === flt.dimKey);
                const updateFilter = (patch) => setPivotFilters((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
                return (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <select
                      value={flt.dimKey}
                      onChange={(e) => setPivotFilters((prev) => prev.map((p, j) => (j === i ? { dimKey: e.target.value, values: [], rangeMin: null, rangeMax: null } : p)))}
                      style={{ flexShrink: 0 }}
                    >
                      {PIVOT_DIMENSIONS.map((d) => (<option key={d.key} value={d.key}>{d.label}</option>))}
                    </select>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 180 }}>
                      {dim?.filterKind === "dateRange" ? (
                        <div className="sans" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#435266" }}>
                          <input
                            type="date"
                            value={flt.rangeMin ? new Date(flt.rangeMin).toISOString().slice(0, 10) : ""}
                            onChange={(e) => updateFilter({ rangeMin: e.target.value ? new Date(e.target.value).setHours(0, 0, 0, 0) : null })}
                          />
                          <span>〜</span>
                          <input
                            type="date"
                            value={flt.rangeMax ? new Date(flt.rangeMax).toISOString().slice(0, 10) : ""}
                            onChange={(e) => updateFilter({ rangeMax: e.target.value ? new Date(e.target.value).setHours(0, 0, 0, 0) : null })}
                          />
                        </div>
                      ) : dim?.filterKind === "numberRange" ? (
                        <div className="sans" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#435266" }}>
                          <input
                            type="number" min={1} placeholder="最小" value={flt.rangeMin ?? ""}
                            onChange={(e) => updateFilter({ rangeMin: e.target.value === "" ? null : Number(e.target.value) })}
                            style={{ width: 64 }}
                          />
                          <span>日目 〜</span>
                          <input
                            type="number" min={1} placeholder="最大" value={flt.rangeMax ?? ""}
                            onChange={(e) => updateFilter({ rangeMax: e.target.value === "" ? null : Number(e.target.value) })}
                            style={{ width: 64 }}
                          />
                          <span>日目</span>
                        </div>
                      ) : (
                        <>
                          {flt.dimKey === "note" && (() => {
                            const entries = pivotDimensionValueEntries(framesWithContext, pivotCtx, "note");
                            return (
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {["high", "mid", "low"].map((band) => {
                                  const bandValues = entries.filter((e) => registerBand(e.sortKey) === band).map((e) => e.value);
                                  if (bandValues.length === 0) return null;
                                  const allSelected = bandValues.every((v) => flt.values.includes(v));
                                  return (
                                    <button
                                      key={band}
                                      onClick={() => updateFilter({
                                        values: allSelected
                                          ? flt.values.filter((v) => !bandValues.includes(v))
                                          : [...new Set([...flt.values, ...bandValues])],
                                      })}
                                      className="sans"
                                      style={{
                                        fontSize: 10, padding: "3px 10px", borderRadius: 10, cursor: "pointer",
                                        border: allSelected ? "1.5px solid #174585" : "1px dashed #8D95A1",
                                        background: allSelected ? "#EAEFF5" : "#FFFFFF",
                                        color: allSelected ? "#174585" : "#435266", fontWeight: 600,
                                      }}
                                    >
                                      {REGISTER_BAND_LABELS[band]}
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })()}
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {(() => {
                              const options = pivotDimensionValues(framesWithContext, pivotCtx, flt.dimKey);
                              return options.length === 0 ? (
                                <span className="sans" style={{ fontSize: 10, color: "#8D95A1", padding: "4px 0" }}>該当する値がありません</span>
                              ) : options.map((v) => {
                                const selected = flt.values.includes(v);
                                return (
                                  <button
                                    key={v}
                                    onClick={() => updateFilter({ values: selected ? flt.values.filter((x) => x !== v) : [...flt.values, v] })}
                                    className="sans"
                                    style={{
                                      fontSize: 10, padding: "3px 8px", borderRadius: 10, cursor: "pointer",
                                      border: selected ? "1.5px solid #174585" : "1px solid #E9ECF0",
                                      background: selected ? "#EAEFF5" : "#FFFFFF",
                                      color: selected ? "#174585" : "#435266",
                                      fontWeight: selected ? 600 : 400,
                                    }}
                                  >
                                    {v}
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => setPivotFilters((prev) => prev.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", color: "#8D95A1", cursor: "pointer", fontSize: 13, flexShrink: 0, padding: "2px 4px" }}
                      title="このフィルターを削除"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 縦軸・横軸・指標のセレクタ(Claude Design: 3枚の丸角カード) */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[
            { label: "縦軸", node: (
              <select value={pivotRow} onChange={(e) => setPivotRow(e.target.value)} className="pivot-axis-select">
                {PIVOT_DIMENSIONS.map((d) => (<option key={d.key} value={d.key}>{d.label}</option>))}
              </select>
            ) },
            { label: "横軸", node: (
              <select value={pivotCol} onChange={(e) => setPivotCol(e.target.value)} className="pivot-axis-select">
                <option value="none">なし（全体）</option>
                {PIVOT_DIMENSIONS.map((d) => (<option key={d.key} value={d.key}>{d.label}</option>))}
              </select>
            ) },
            { label: "指標", node: (
              <select value={pivotMetric} onChange={(e) => setPivotMetric(e.target.value)} className="pivot-axis-select">
                {PIVOT_MEASURES.map((m) => (<option key={m.key} value={m.key}>{m.label}</option>))}
              </select>
            ) },
          ].map((z) => (
            <div key={z.label} style={{ flex: 1, minWidth: 0, background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 11, padding: "10px 11px" }}>
              <div className="sans" style={{ fontSize: 9, color: "#8D95A1", marginBottom: 4 }}>{z.label}</div>
              {z.node}
            </div>
          ))}
        </div>

        {pivot.rowKeys.length === 0 ? (
          <div className="sans" style={{ fontSize: 11, color: "#8D95A1" }}>
            この軸の組み合わせに該当するデータがまだありません。運指判定・リード紐付けつきで録音するとここに表が育ちます
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 6, fontSize: 12, minWidth: 300 }}>
              <thead>
                <tr>
                  <th className="sans" style={{ position: "sticky", left: 0, background: "#FFFFFF", textAlign: "left", padding: "2px 6px", color: "#8D95A1", fontSize: 9, fontWeight: 600, verticalAlign: "bottom" }}>
                    {PIVOT_DIMENSIONS.find((d) => d.key === pivotRow)?.label} ＼ {pivotCol === "none" ? "全体" : PIVOT_DIMENSIONS.find((d) => d.key === pivotCol)?.label}
                  </th>
                  {pivot.colKeys.map((ck) => (
                    <th key={ck} style={{ textAlign: "center", padding: "2px 6px", color: "#174585", fontSize: 10, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", whiteSpace: "nowrap" }}>
                      {ck}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pivot.rowKeys.map((rk) => (
                  <tr key={rk}>
                    <td style={{ position: "sticky", left: 0, background: "#FFFFFF", padding: "0 6px", color: "#121F32", fontWeight: 700, whiteSpace: "nowrap", fontFamily: pivotRow === "note" ? "'Instrument Serif', serif" : "'Noto Sans JP', sans-serif", fontSize: pivotRow === "note" ? 15 : 11 }}>
                      {rk}
                    </td>
                    {pivot.colKeys.map((ck) => {
                      const cell = pivot.cells[rk]?.[ck];
                      if (!cell) {
                        return <td key={ck} style={{ textAlign: "center", color: "#C3CAD3", background: "#F6F7F9", borderRadius: 8, padding: "9px 8px" }}>—</td>;
                      }
                      const value = metricDef.agg === "sum" ? cell.sum : cell.sum / cell.count;
                      const color = metricDef.color ? metricDef.color(value) : "#121F32";
                      // ピッチ偏差は良否が明確なのでセルを淡色で塗る(緑/橙/赤)。他の指標は中立の淡色。
                      const bg = pivotMetric === "pitchCents"
                        ? (Math.abs(value) < 10 ? "#E8F6ED" : Math.abs(value) < 25 ? "#FDF0E1" : "#FBE9E9")
                        : "#F6F7F9";
                      return (
                        <td key={ck} title={`${cell.count}フレーム`} style={{ textAlign: "center", color, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif", background: bg, borderRadius: 8, padding: "9px 10px", whiteSpace: "nowrap" }}>
                          {metricDef.fmt(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sans" style={{ fontSize: 9, color: "#8D95A1", marginTop: 10, lineHeight: 1.6 }}>
              セルをタップ長押しで集計フレーム数を表示。ピッチ偏差は ±10¢未満=緑 / ±25¢未満=橙 / それ以上=赤 で色分けしています。
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// セッション詳細ビュー。録音/アップロードいずれかのセッションを、計測タブに近いレイアウトで振り返る。
function SessionDetailView({ session, reeds, sessions, selectedIdeal, NUM_HARMONICS, promoteSessionToIdeal, updateSessions, performers, setPerformers, onBack }) {
  const frames = session.frames || [];
  // 1回のデータには複数の音(スケール等)が含まれることがあるため、音階(運指)ごとにも分解して平均を出す
  const noteGroups = groupFramesByNote(frames, NUM_HARMONICS);
  const reed = reeds.find((r) => r.id === session.reedId) || null;

  // 記録後に気づいた誤り(奏者・リードの紐付け間違い等)をその場で修正できるようにする
  const setSessionPerformer = (name) => {
    updateSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, performer: name } : s)));
  };
  const setSessionReedId = (reedId) => {
    updateSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, reedId: reedId || null, linkedAt: reedId ? "retroactive" : null } : s)));
  };

  // メモは計測タブでは入力せず、ここで後から追記・修正する。打鍵毎の書き込みを避けるため
  // ローカルstateで編集し、フォーカスが外れた時にまとめてセッションへ反映する。
  const [memoDraft, setMemoDraft] = useState(session.memo || "");
  useEffect(() => { setMemoDraft(session.memo || ""); }, [session.id, session.memo]);
  const commitMemo = () => {
    const trimmed = memoDraft.trim();
    if (trimmed === (session.memo || "")) return;
    updateSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, memo: trimmed || null } : s)));
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <button
        onClick={onBack}
        className="sans"
        style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#174585", fontSize: 11, marginBottom: 10, cursor: "pointer", padding: 0 }}
      >
        <ChevronDown size={13} style={{ transform: "rotate(90deg)" }} /> 一覧に戻る
      </button>

      {/* 1. セッション情報 */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "14px 16px", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 12, color: "#121F32", fontWeight: 700, marginBottom: 6 }}>
          {new Date(session.recordedAt).toLocaleString("ja-JP")}
        </div>
        <div className="sans" style={{ fontSize: 10, color: "#435266", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            奏者:
            <PerformerSelector performers={performers} selectedPerformer={session.performer || "自分"} setSelectedPerformer={setSessionPerformer} setPerformers={setPerformers} />
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            リード:
            <select value={session.reedId || ""} onChange={(e) => setSessionReedId(e.target.value || null)}>
              <option value="">未紐付け</option>
              {reeds.map((r) => (<option key={r.id} value={r.id}>{reedLabel(r, reeds)}</option>))}
            </select>
          </span>
          <span>{SAX_PRESETS[session.saxType]?.label ?? session.saxType}</span>
          {session.source === "upload" && <span>アップロード: {session.sourceFileName}</span>}
        </div>
        <div className="sans" style={{ fontSize: 11, marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#435266", flexShrink: 0 }}>メモ:</span>
          <input
            type="text" placeholder="何を試したか(例: マウスピース変更・アンブシュアを緩めた 等)"
            value={memoDraft} onChange={(e) => setMemoDraft(e.target.value)} onBlur={commitMemo}
            className="sans"
            style={{ flex: 1, background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "6px 10px", color: "#121F32", fontSize: 11 }}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <SetAsIdealButton frames={frames} saxType={session.saxType} onSave={promoteSessionToIdeal} />
        </div>
      </div>

      {/* 2. 録音データグラフ(時間変化のタイムライン。単音でも音の立ち上がり等の変化があるため常に表示) */}
      {frames.length > 0 && (
        <PhraseTimeline
          frames={frames} noteEvents={session.noteEvents} selectedIdeal={selectedIdeal}
          NUM_HARMONICS={NUM_HARMONICS} sessions={sessions} ownSessionId={session.id}
        />
      )}

      {/* 3. 音階ごとの平均値。1回のデータに複数の音が含まれる場合、音ごとの理想値との差もここで確認できる */}
      {noteGroups.length > 0 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "10px 16px", marginTop: 10, overflowX: "auto" }}>
          <div className="sans" style={{ fontSize: 10, color: "#435266", marginBottom: 10 }}>
            音階ごとの平均（{noteGroups.length}音）
          </div>
          <table className="sans" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 480 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "5px 8px", color: "#435266", fontSize: 10, borderBottom: "1px solid #E9ECF0" }}>記音</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 10, borderBottom: "1px solid #E9ECF0" }}>ピッチ</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 10, borderBottom: "1px solid #E9ECF0" }}>音量</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 10, borderBottom: "1px solid #E9ECF0" }}>重心</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 10, borderBottom: "1px solid #E9ECF0" }}>HNR</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 10, borderBottom: "1px solid #E9ECF0" }}>理想値との差</th>
              </tr>
            </thead>
            <tbody>
              {noteGroups.map((g) => {
                const noteIdeal = getNoteIdeal(selectedIdeal, g.semitoneIndex);
                const cents = noteIdeal?.pitchHz && g.pitchHz ? centsBetween(g.pitchHz, noteIdeal.pitchHz) : null;
                return (
                  <tr key={g.semitoneIndex}>
                    <td style={{ padding: "5px 8px", color: "#121F32", fontWeight: 600, borderBottom: "1px solid #EEF1F4" }}>{g.writtenLabel ?? "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", color: "#121F32", borderBottom: "1px solid #EEF1F4" }}>{g.pitchHz ? `${g.pitchHz.toFixed(1)}Hz` : "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", color: "#121F32", borderBottom: "1px solid #EEF1F4" }}>{g.volumeDb !== null ? `${g.volumeDb.toFixed(1)}dB` : "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", color: "#121F32", borderBottom: "1px solid #EEF1F4" }}>{g.centroidHz !== null ? `${Math.round(g.centroidHz)}Hz` : "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", color: "#121F32", borderBottom: "1px solid #EEF1F4" }}>{g.hnrDb !== null ? `${g.hnrDb.toFixed(1)}dB` : "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", fontWeight: 600, borderBottom: "1px solid #EEF1F4", color: cents !== null ? pitchCellColor(cents) : "#8D95A1" }}>
                      {cents !== null ? `${cents > 0 ? "+" : ""}${cents.toFixed(1)}¢` : noteIdeal ? "—" : "未登録"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
