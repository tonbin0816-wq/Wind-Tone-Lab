import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Mic, Square, Wind, Save, Trash2, ChevronDown, ChevronUp, Play } from "lucide-react";

// ============================================================
// Music theory helpers
// ============================================================
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const A4 = 440;

function freqToNote(freq) {
  if (!freq || freq <= 0) return null;
  const midi = 69 + 12 * Math.log2(freq / A4);
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return { name, octave, cents, midi };
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
const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// 記音: Low B♭(サックス共通の最低音、MIDI 58相当)からの半音距離でテーブルを構築
const LOW_BB_WRITTEN_MIDI = 58;

function writtenNoteLabel(semitoneFromLowBb) {
  const midi = LOW_BB_WRITTEN_MIDI + semitoneFromLowBb;
  const name = NOTE_NAMES_SHARP[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
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
// { hnrValues: number[], volumeDbValues: number[], pitchCentsErrorValues: number[], centroidValues: number[] }
function reedCompositeScore(input, idealCentroidHz = null) {
  const weights = { hnr: 0.3, volumeStability: 0.25, pitchStability: 0.25, centroidCloseness: 0.2 };

  const hnrScore = normalizeHnr(input.hnrValues.filter((v) => v !== null && v !== undefined));
  const volumeStability = stabilityScore(input.volumeDbValues, 3.0);
  const pitchStability = stabilityScore(input.pitchCentsErrorValues, 20.0);

  let centroidScore = null;
  if (input.centroidValues?.length && idealCentroidHz) {
    const avgCentroid = mean(input.centroidValues);
    centroidScore = closenessToIdealScore(avgCentroid, idealCentroidHz, 0.25);
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

// ============================================================
// 「体の使い方」原因推定ロジック (企画書v6 11.4節)
// Python検証: algo_technique_diagnosis.py / algo_axis_aggregation.py を移植
//
// マイクでは口腔の広さ・息のスピード・体の使い方を直接測れない。
// しかし理想値との差分パターン(高次倍音の減衰・ピッチの方向性・重心)から
// 根本原因を「推測レベル」で提示する。断定はしない。
// ============================================================
function highHarmonicDecayScore(measuredHarmonicsNorm, idealHarmonicsNorm, loOrder = 5, hiOrder = 8) {
  const mSlice = measuredHarmonicsNorm.slice(loOrder - 1, hiOrder);
  const iSlice = idealHarmonicsNorm.slice(loOrder - 1, hiOrder);
  const measuredHigh = mean(mSlice) ?? 0;
  const idealHigh = mean(iSlice) ?? 0;
  if (idealHigh < 1e-6) return 0;
  const decayRatio = 1 - measuredHigh / idealHigh;
  return Math.min(1, Math.max(0, decayRatio));
}

function normalizeDiff(measured, ideal, scale) {
  if (ideal === null || ideal === undefined || ideal === 0) return 0;
  const diff = (measured - ideal) / scale;
  return Math.min(2, Math.max(-2, diff));
}

// pitchCentsError: 実測 - 理想(セント、正=シャープ、負=フラット)
function diagnoseTechnique({
  pitchCentsError, measuredHarmonicsNorm, idealHarmonicsNorm,
  measuredCentroidHz, idealCentroidHz, isHighRegister = false,
}) {
  const highDecay = highHarmonicDecayScore(measuredHarmonicsNorm, idealHarmonicsNorm);
  const centroidDiff = normalizeDiff(measuredCentroidHz, idealCentroidHz, 300);
  const pitchDiffNorm = Math.min(2, Math.max(-2, pitchCentsError / 30.0));
  const registerWeight = isHighRegister ? 1.3 : 1.0;

  const flatComponent = Math.min(2, Math.max(0, -pitchDiffNorm)) / 2;
  const breathShortage = Math.min(1, Math.max(0, (0.6 * highDecay + 0.4 * flatComponent) * registerWeight));

  const sharpComponent = Math.min(2, Math.max(0, pitchDiffNorm)) / 2;
  const centroidHighComponent = Math.min(2, Math.max(0, centroidDiff)) / 2;
  const overBiting = Math.min(1, Math.max(0, (0.5 * sharpComponent + 0.5 * centroidHighComponent) * registerWeight));

  const compensating = Math.min(1, Math.max(0, Math.min(highDecay, sharpComponent) * registerWeight));

  return {
    breathShortage, overBiting, compensating,
    evidence: {
      highHarmonicDecay: highDecay,
      pitchCentsError,
      centroidDiffHz: idealCentroidHz ? measuredCentroidHz - idealCentroidHz : null,
    },
  };
}

// 閾値はノイズ入り合成データでのスイープ検証(algo_diagnosis_tuning.py)に基づく:
// - 息不足/噛みすぎ=0.4: 誤検出0%・検出率95〜100%
// - 複合=0.3: min関数ベースで保守的なスコアのため個別に低め設定(検出率56%→81%、誤検出は良好0%・噛みすぎ単独2%)
const DIAGNOSIS_THRESHOLD = 0.4;
const DIAGNOSIS_THRESHOLD_COMPENSATING = 0.3;

function formatSuggestions(diagnosis) {
  const suggestions = [];
  if (diagnosis.compensating >= DIAGNOSIS_THRESHOLD_COMPENSATING) {
    suggestions.push({ label: "複合(噛みで息不足を代償)", score: diagnosis.compensating, text: "息のスピード不足を、噛む力で補っている可能性があります" });
  }
  if (diagnosis.breathShortage >= DIAGNOSIS_THRESHOLD) {
    suggestions.push({ label: "息のスピード不足", score: diagnosis.breathShortage, text: "息のスピードが足りていない可能性があります" });
  }
  if (diagnosis.overBiting >= DIAGNOSIS_THRESHOLD) {
    suggestions.push({ label: "噛みすぎ", score: diagnosis.overBiting, text: "アンブシュアが締まりすぎ(噛みすぎ)の可能性があります" });
  }
  suggestions.sort((a, b) => b.score - a.score);
  return suggestions;
}

// 運指の半音インデックスから音域帯(low/mid/high)を判定する簡易分類
function registerBand(semitoneIndex, lowMax = 12, midMax = 24) {
  if (semitoneIndex === null || semitoneIndex === undefined) return "unknown";
  if (semitoneIndex <= lowMax) return "low";
  if (semitoneIndex <= midMax) return "mid";
  return "high";
}

const REGISTER_BAND_LABELS = { low: "低音域", mid: "中音域", high: "高音域", unknown: "不明" };

// フレーム配列を診断し、リード軸・音域軸それぞれで平均集計する
// frames: sessionsから展開したフレーム配列。各フレームは reedId, semitoneIndex を持つ想定
function aggregateDiagnosisByAxis(framesWithContext, axisKeyFn, idealHarmonicsNorm, idealCentroidHz) {
  const groups = {};
  for (const f of framesWithContext) {
    const key = axisKeyFn(f);
    if (key === null || key === undefined) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }

  const results = {};
  for (const [key, groupFrames] of Object.entries(groups)) {
    const diagnoses = groupFrames.map((f) => {
      const harmNorm = f.harmonics?.map((h) => h.levelNorm) ?? new Array(8).fill(0);
      const isHigh = registerBand(f.semitoneIndex) === "high";
      return diagnoseTechnique({
        pitchCentsError: f.pitchCents ?? 0,
        measuredHarmonicsNorm: harmNorm,
        idealHarmonicsNorm,
        measuredCentroidHz: f.spectralCentroidHz ?? idealCentroidHz,
        idealCentroidHz,
        isHighRegister: isHigh,
      });
    });
    results[key] = {
      frameCount: groupFrames.length,
      avgBreathShortage: mean(diagnoses.map((d) => d.breathShortage)) ?? 0,
      avgOverBiting: mean(diagnoses.map((d) => d.overBiting)) ?? 0,
      avgCompensating: mean(diagnoses.map((d) => d.compensating)) ?? 0,
    };
  }
  return results;
}

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
    g.members.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }
  return Object.values(groups).sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
}

function reedPosition(reed, reeds) {
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
      setSessionsState(all);
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

  return [sessions, addSession, updateSessions];
}

// ============================================================
// Main component
// ============================================================
export default function WindToneLabPhaseMode() {
  const [topTab, setTopTab] = useState("measure"); // "measure" | "reeds" | "analysis"
  const [reedsSubTab, setReedsSubTab] = useState("register"); // 「リード」タブ内の子タブ: register | data
  const [isRunning, setIsRunning] = useState(false);
  const [pitch, setPitch] = useState(null);
  const [note, setNote] = useState(null);
  const [harmonicLevels, setHarmonicLevels] = useState([]);
  const [spectrumBars, setSpectrumBars] = useState(new Array(64).fill(0));
  const [volumeDb, setVolumeDb] = useState(-100);
  const [centroidHz, setCentroidHz] = useState(0);
  const [hnrDb, setHnrDb] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const [saxType, setSaxType] = usePersistedState("saxType", "alto");
  const [temperature, setTemperature] = useState(20);
  const [tuningHz, setTuningHz] = usePersistedState("tuningHz", 442); // 基準ピッチ: 440/442/443Hz
  const [instrumentOffsetCents, setInstrumentOffsetCents] = usePersistedState("instrumentOffsetCents", 0); // 楽器個体差の補正(セント)。運指テーブル全体をシフトする(企画書3節末尾の注記への対応)
  const [showTheory, setShowTheory] = useState(true);
  const [showIdeal, setShowIdeal] = useState(true);
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  // 理想値プロファイルは「撮りためたデータ」の中核のひとつのため永続化する
  const [idealProfiles, setIdealProfiles] = usePersistedState("idealProfiles", []);
  const [selectedIdealId, setSelectedIdealId] = usePersistedState("selectedIdealId", null);
  const [newProfileName, setNewProfileName] = useState("");

  // --- 運指ベース管長自動キャリブレーション state ---
  const [matchedFingering, setMatchedFingering] = useState(null); // 直近フレームで判定された運指
  const [derivedTubeLengthCm, setDerivedTubeLengthCm] = useState(null); // 逆算された理論管長(表示用)

  // --- 録音結果の時系列データ(単音/フレーズの区別はnoteEvents数から事後判定する) ---
  const [phraseFrames, setPhraseFrames] = useState([]); // データ構造は企画書3節のframesに準拠
  const [selectedFrameIdx, setSelectedFrameIdx] = useState(null);
  const [timelineFormat, setTimelineFormat] = useState("line"); // "line" | "heatmap"
  const [timelineMetric, setTimelineMetric] = useState("pitch"); // pitch | volume | centroid | hnr
  const [matchBasis, setMatchBasis] = useState("theoretical"); // "theoretical" | "ideal"

  // --- リード管理 state (企画書v5 10節) ---
  // reeds/sessionsは練習を重ねるほど価値が増す蓄積データのため、IndexedDBに永続化する(usePersistedState)
  const [reeds, setReeds] = usePersistedState("reeds", []); // リードマスタ一覧
  const [sessions, addSession, updateSessions] = useSessionsStore(); // 録音セッション一覧(reedIdで紐付け、10.5節のsessionWithReedに準拠。レコード単位で永続化)
  const [selectedReedId, setSelectedReedId] = usePersistedState("selectedReedId", null); // 録音前に選択する「今回使うリード」
  const [pendingLinkSessionId, setPendingLinkSessionId] = useState(null); // 事後紐付け対象のセッション
  const [sessionMemo, setSessionMemo] = useState(""); // 録音前に入力する「何を試したか」の自由記述メモ

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const latestReadingRef = useRef(null);
  const phraseStartTimeRef = useRef(null);
  const lastSampleTimeRef = useRef(0);
  const phraseFramesRef = useRef([]); // stop()のクロージャから最新フレーム配列を参照するためのref

  // --- ノート区間分割・アタック時間検出(企画書2.4節のnoteEvents、rAFレートで検出) ---
  // 100msフレームではアタック(典型20〜100ms)を測れないため、tick毎(約60fps)に音量エンベロープを監視する。
  // 状態機械: silence → attack(立ち上がり計測中) → sustain → (音量低下で) silence
  const noteDetectorRef = useRef({ phase: "silence", onsetMs: 0, peakDb: -100, samples: [], events: [] });
  const [phraseNoteEvents, setPhraseNoteEvents] = useState([]);
  const NOTE_ONSET_DB = -45;   // 無音→発音の閾値
  const NOTE_RELEASE_DB = -55; // 発音→無音の閾値(ヒステリシスでバタつきを防ぐ)
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

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") audioCtxRef.current.close();

    // 単音・フレーズどちらのモードでも、録音中に蓄積したフレームがあればセッションとして保存する(企画書v5 10.3節)
    // reedIdは選択されていればそのまま紐付け、未選択ならnull(後で事後紐付け可能)
    // memoは「何を変えて試したか」を残す自由記述(例: マウスピース変更・アンブシュア調整など)。次回録音に向けてリセットする
    if (phraseFramesRef.current.length > 0) {
      const session = {
        id: generateId(),
        recordedAt: new Date().toISOString(),
        saxType,
        reedId: selectedReedId,
        linkedAt: selectedReedId ? "eager" : null,
        memo: sessionMemo.trim() || null,
        frames: phraseFramesRef.current,
        noteEvents: noteDetectorRef.current.events, // ノート区間分割・アタック時間(企画書2.4節・4節のnoteEvents)
      };
      addSession(session);
      setSessionMemo("");
    }

    setIsRunning(false);
  }, [saxType, selectedReedId, sessionMemo, addSession]);

  const start = useCallback(async () => {
    setErrorMsg("");
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

      setIsRunning(true);
      // フレーム蓄積(100ms周期のサンプリング)は常に行う。単音かフレーズかはモードで分けず、
      // 録音停止後にnoteEvents(検出されたノート数)から事後判定する(2音以上ならフレーズ扱い)。
      phraseStartTimeRef.current = performance.now();
      lastSampleTimeRef.current = 0;
      setPhraseFrames([]);
      phraseFramesRef.current = [];
      noteDetectorRef.current = { phase: "silence", onsetMs: 0, peakDb: -100, samples: [], events: [] };
      setPhraseNoteEvents([]);

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
        if (f0 && f0 > 40) {
          setPitch(f0);
          setNote(freqToNote(f0));

          // --- 運指ベース管長自動キャリブレーション ---
          // 実測基音に最も近い運指をテーブルから検索し、正しい実音Hzを求める。
          // この正しい実音Hzが、以後の理論値グラフ(倍音構成)の基準になる。
          matchedFinger = findClosestFingering(f0, fingeringTable);
          if (matchedFinger) {
            setMatchedFingering(matchedFinger);
            const L = deriveTubeLengthCm(matchedFinger.soundingFreqHz, preset.bellRadiusCm, temperature);
            setDerivedTubeLengthCm(L);
          }

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
        }

        latestReadingRef.current = { pitchHz: f0, volumeDb: vDb, centroidHz: centroid, hnrDb: hnr, harmonics: levels };

        // --- 100ms周期でフレームを蓄積(単音・フレーズ共通) ---
        if (phraseStartTimeRef.current !== null) {
          const elapsedMs = performance.now() - phraseStartTimeRef.current;

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
            const pitchCentsVsIdeal = f0 && selectedIdeal?.pitchHz ? centsBetween(f0, selectedIdeal.pitchHz) : null;

            const harmNorm = levels.length === NUM_HARMONICS ? levels.map((l) => l.norm) : new Array(NUM_HARMONICS).fill(0);
            const idealHarmNorm = selectedIdeal?.harmonicsProfile
              ? selectedIdeal.harmonicsProfile.map((h) => h.norm)
              : new Array(NUM_HARMONICS).fill(0);

            const pitchScoreTheory = pitchCentsVsTheory !== null ? pitchMatchScore(pitchCentsVsTheory) : 0;
            const pitchScoreIdeal = pitchCentsVsIdeal !== null ? pitchMatchScore(pitchCentsVsIdeal) : 0;

            // 音色一致度: 理論モデルは倍音の相対強度情報を持たないため、理想値のみを基準とする
            // (企画書v3 2.8節の方針: ピッチ以外は理想値との比較に絞る)
            const timbreScoreIdeal = selectedIdeal
              ? timbreMatchScore(harmNorm, idealHarmNorm, centroid, selectedIdeal.centroidHz, hnr, selectedIdeal.hnrDb)
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
    } catch (err) {
      console.error("getUserMedia failed:", err.name, err.message, err);
      const hints = {
        NotAllowedError: "マイクへのアクセスが拒否されています。ブラウザのアドレスバー付近のマイクアイコン、またはサイト設定から許可してください。",
        NotFoundError: "マイクデバイスが見つかりません。PCにマイクが接続されているか確認してください。",
        NotReadableError: "マイクが他のアプリで使用中の可能性があります。他のアプリ（Zoom等）を閉じて再試行してください。",
        SecurityError: "この接続はマイクアクセスに必要なセキュア(HTTPS/localhost)条件を満たしていません。",
      };
      setErrorMsg(`マイクにアクセスできませんでした [${err.name}]: ${hints[err.name] || err.message}`);
      setIsRunning(false);
    }
  }, [selectedIdeal, fingeringTable, preset, temperature]);

  // 【重要】stopは(sessionMemo等の変化で)頻繁に再生成されるため、
  // 依存配列に直接stopを入れると「stopが変わるたびに前回のeffectのクリーンアップとして
  // 古いstop()が呼ばれる」→録音終了ボタン1回のクリックでstop()が実質2回走り、
  // セッションが重複保存される不具合があった(停止時の体感ラグの一因でもあった)。
  // refで最新のstopを保持し、このeffect自体はマウント/アンマウント時のみ発火させる。
  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; }, [stop]);
  useEffect(() => () => stopRef.current(), []);

  // 理想値は単一フレーム(1/60秒)のスナップショットだとノイズの影響を強く受けるため、
  // 直近1秒分(100ms間隔サンプリング×10フレーム)の平均を保存する。定量比較の基準としての安定性を上げる。
  const saveIdealProfile = () => {
    const recent = phraseFramesRef.current.slice(-10);
    const reading = latestReadingRef.current;
    if ((recent.length === 0 && !reading) || !newProfileName.trim()) return;

    const avgOf = (arr, key) => mean(arr.map((f) => f[key]).filter((v) => v !== null && v !== undefined && !isNaN(v)));

    let pitchHz, volumeDb, centroidHz, hnrDb, harmonicsProfile;
    if (recent.length > 0) {
      pitchHz = avgOf(recent, "pitchHz");
      volumeDb = avgOf(recent, "volumeDb");
      centroidHz = avgOf(recent, "spectralCentroidHz");
      hnrDb = avgOf(recent, "hnrDb");
      harmonicsProfile = Array.from({ length: NUM_HARMONICS }, (_, i) => {
        const n = i + 1;
        const vals = recent.map((f) => f.harmonics?.find((h) => h.n === n)?.levelNorm).filter((v) => v !== null && v !== undefined);
        return { n, norm: vals.length ? mean(vals) : 0 };
      });
    } else {
      // フレーム蓄積が間に合っていない場合(録音直後など)は直近の瞬間値にフォールバック
      pitchHz = reading.pitchHz;
      volumeDb = reading.volumeDb;
      centroidHz = reading.centroidHz;
      hnrDb = reading.hnrDb;
      harmonicsProfile = reading.harmonics.map((h) => ({ n: h.n, norm: h.norm }));
    }

    const profile = {
      id: generateId(),
      name: newProfileName.trim(),
      saxType,
      recordedAt: new Date().toISOString(),
      pitchHz, volumeDb, centroidHz, hnrDb, harmonicsProfile,
    };
    setIdealProfiles((prev) => [...prev, profile]);
    setSelectedIdealId(profile.id);
    setNewProfileName("");
  };

  const deleteIdealProfile = (id) => {
    setIdealProfiles((prev) => prev.filter((p) => p.id !== id));
    if (selectedIdealId === id) setSelectedIdealId(null);
  };

  const centsOffset = note ? note.cents : 0;
  const needleRotation = Math.max(-50, Math.min(50, centsOffset)) * 0.9;

  const selectedFrame = selectedFrameIdx !== null ? phraseFrames[selectedFrameIdx] : null;

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", color: "#0F172A", fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace", padding: "16px 14px 40px", boxSizing: "border-box" }}>
      <style>{`
        @import url('https://cdnjs.cloudflare.com/ajax/libs/JetBrains-Mono/2.304/web/JetBrainsMono.css');
        * { box-sizing: border-box; }
        .sans { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #2563EB; outline-offset: 2px; }
        input[type=range] { accent-color: #2563EB; }
        select { background:#F8FAFC; color:#0F172A; border:1px solid #E2E8F0; border-radius:6px; padding:6px 8px; font-family: inherit; font-size:12px; }
      `}</style>

      {/* Header */}
      <div style={{ maxWidth: 900, margin: "0 auto 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 17, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <Wind size={17} color="#2563EB" strokeWidth={2} />
          Wind Tone Lab
        </h1>
      </div>

      {/* Top-level tabs: 音計測 / リード / 分析 */}
      <div style={{ maxWidth: 900, margin: "0 auto 10px", display: "flex", gap: 6, background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: 4 }}>
        {[
          { key: "measure", label: "計測" },
          { key: "reeds", label: "リード" },
          { key: "analysis", label: "分析" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => { if (!isRunning) setTopTab(t.key); }}
            disabled={isRunning}
            className="sans"
            style={{
              flex: 1, padding: "9px 4px", borderRadius: 7, border: "none",
              background: topTab === t.key ? "#EFF6FF" : "transparent",
              color: topTab === t.key ? "#2563EB" : "#64748B",
              fontWeight: topTab === t.key ? 600 : 400, fontSize: 12,
              cursor: isRunning ? "default" : "pointer", opacity: isRunning && topTab !== t.key ? 0.4 : 1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* リードタブ内の子タブ: 登録 / データ分析 */}
      {topTab === "reeds" && (
        <div style={{ maxWidth: 900, margin: "0 auto 10px", display: "flex", gap: 6 }}>
          {[
            { key: "register", label: "登録" },
            { key: "data", label: "評価" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setReedsSubTab(t.key)}
              className="sans"
              style={{
                flex: 1, padding: "7px 4px", borderRadius: 7,
                border: reedsSubTab === t.key ? "1.5px solid #2563EB" : "1px solid #E2E8F0",
                background: reedsSubTab === t.key ? "#EFF6FF" : "transparent",
                color: reedsSubTab === t.key ? "#2563EB" : "#64748B",
                fontWeight: reedsSubTab === t.key ? 600 : 400, fontSize: 11, cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {errorMsg && (
        <div className="sans" style={{ maxWidth: 900, margin: "0 auto 10px", background: "#FEF2F2", border: "1px solid #DC2626", color: "#DC2626", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
          {errorMsg}
        </div>
      )}

      {topTab === "measure" && (
        <MeasureView
          isRunning={isRunning} start={start} stop={stop}
          note={note} pitch={pitch} needleRotation={needleRotation} centsOffset={centsOffset}
          spectrumBars={spectrumBars}
          harmonicLevels={harmonicLevels} theoreticalHarmonics={theoreticalHarmonics}
          showTheory={showTheory} setShowTheory={setShowTheory}
          showIdeal={showIdeal} setShowIdeal={setShowIdeal}
          selectedIdeal={selectedIdeal}
          volumeDb={volumeDb} centroidHz={centroidHz} hnrDb={hnrDb}
          saxType={saxType} setSaxType={setSaxType}
          temperature={temperature} setTemperature={setTemperature}
          tuningHz={tuningHz} setTuningHz={setTuningHz}
          matchedFingering={matchedFingering} derivedTubeLengthCm={derivedTubeLengthCm}
          settingsExpanded={settingsExpanded} setSettingsExpanded={setSettingsExpanded}
          newProfileName={newProfileName} setNewProfileName={setNewProfileName}
          saveIdealProfile={saveIdealProfile} idealProfiles={idealProfiles}
          selectedIdealId={selectedIdealId} setSelectedIdealId={setSelectedIdealId}
          deleteIdealProfile={deleteIdealProfile} preset={preset}
          NUM_HARMONICS={NUM_HARMONICS}
          reeds={reeds} selectedReedId={selectedReedId} setSelectedReedId={setSelectedReedId}
          sessionMemo={sessionMemo} setSessionMemo={setSessionMemo}
          phraseFrames={phraseFrames} phraseNoteEvents={phraseNoteEvents}
          timelineFormat={timelineFormat} setTimelineFormat={setTimelineFormat}
          timelineMetric={timelineMetric} setTimelineMetric={setTimelineMetric}
          matchBasis={matchBasis} setMatchBasis={setMatchBasis}
          selectedFrameIdx={selectedFrameIdx} setSelectedFrameIdx={setSelectedFrameIdx}
          selectedFrame={selectedFrame}
        />
      )}
      {topTab === "reeds" && reedsSubTab === "register" && (
        <ReedRegisterView
          reeds={reeds} setReeds={setReeds}
          sessions={sessions} updateSessions={updateSessions}
          pendingLinkSessionId={pendingLinkSessionId} setPendingLinkSessionId={setPendingLinkSessionId}
          setTopTab={setTopTab} setSelectedReedId={setSelectedReedId}
        />
      )}
      {topTab === "reeds" && reedsSubTab === "data" && (
        <DataAnalysisView
          reeds={reeds} sessions={sessions} selectedIdeal={selectedIdeal}
        />
      )}
      {topTab === "analysis" && <AnalysisLabView sessions={sessions} reeds={reeds} selectedIdeal={selectedIdeal} />}
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
    isRunning, start, stop, note, pitch, needleRotation, centsOffset, spectrumBars,
    harmonicLevels, theoreticalHarmonics, showTheory, setShowTheory, showIdeal, setShowIdeal,
    selectedIdeal, volumeDb, centroidHz, hnrDb, saxType, setSaxType, temperature, setTemperature,
    tuningHz, setTuningHz, matchedFingering, derivedTubeLengthCm,
    settingsExpanded, setSettingsExpanded, newProfileName, setNewProfileName, saveIdealProfile,
    idealProfiles, selectedIdealId, setSelectedIdealId, deleteIdealProfile, preset, NUM_HARMONICS,
    reeds, selectedReedId, setSelectedReedId, sessionMemo, setSessionMemo,
    phraseFrames, phraseNoteEvents,
    timelineFormat, setTimelineFormat, timelineMetric, setTimelineMetric,
    matchBasis, setMatchBasis, selectedFrameIdx, setSelectedFrameIdx, selectedFrame,
  } = props;

  const selectedReed = reeds?.find((r) => r.id === selectedReedId) || null;
  // 2音以上のノートが検出されていればフレーズとして扱い、タイムラインを表示する
  const isPhraseResult = phraseNoteEvents.length > 1 && phraseFrames.length > 0;

  const metricOptions = [
    { key: "pitch", label: "音高" },
    { key: "volume", label: "音量" },
    { key: "centroid", label: "重心" },
    { key: "hnr", label: "HNR" },
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

  const getMatchScore = (frame, kind) => {
    // kind: "pitch" | "timbre"
    // ピッチは理論値・理想値どちらも選択可(matchBasisに従う)。
    // 音色は理論値基準を持たない(企画書v3方針)ため、常に理想値を使う。
    if (!frame.matchScore) return 0;
    if (kind === "timbre") return frame.matchScore.timbre?.ideal ?? 0;
    return frame.matchScore[kind]?.[matchBasis] ?? 0;
  };

  const values = isPhraseResult ? phraseFrames.map(getMetricValue).filter((v) => v !== null && v !== undefined && !isNaN(v)) : [];
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;
  const range = maxV - minV || 1;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* 使用リード選択(企画書v5 10.3節: 事前選択) */}
      <div className="sans" style={{ fontSize: 11, marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#64748B" }}>使用リード:</span>
        <select value={selectedReedId || ""} onChange={(e) => setSelectedReedId(e.target.value || null)} disabled={isRunning}>
          <option value="">未選択(後で紐付け可能)</option>
          {(reeds || []).map((r) => (<option key={r.id} value={r.id}>{reedLabel(r, reeds)}</option>))}
        </select>
        {selectedReed && <span style={{ color: "#2563EB", fontSize: 10 }}>選択中: {reedLabel(selectedReed, reeds)}</span>}
        {(!reeds || reeds.length === 0) && <span style={{ color: "#94A3B8", fontSize: 10 }}>「リード」タブでリードを登録できます</span>}
      </div>

      {/* 何を変えて試したかのメモ(自由記述)。何を変えたら何が変わったかを後から追いやすくする */}
      <div className="sans" style={{ fontSize: 11, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "#64748B", flexShrink: 0 }}>メモ:</span>
        <input
          type="text" placeholder="何を試したか(例: マウスピース変更・アンブシュアを緩めた 等)"
          value={sessionMemo} onChange={(e) => setSessionMemo(e.target.value)} disabled={isRunning}
          className="sans"
          style={{ flex: 1, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, padding: "6px 10px", color: "#0F172A", fontSize: 11 }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        {isRunning ? (
          <div className="sans" style={{ fontSize: 11, color: "#2563EB", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, background: "#DC2626", borderRadius: "50%", display: "inline-block", animation: "pulse 1s infinite" }} />
            録音中 · {phraseFrames.length}フレーム
            {phraseNoteEvents.length > 0 && <span style={{ color: "#64748B", marginLeft: 6 }}>· {phraseNoteEvents.length}ノート</span>}
          </div>
        ) : <span />}
        <button onClick={isRunning ? stop : start} className="sans" style={{ display: "flex", alignItems: "center", gap: 6, background: isRunning ? "#DC2626" : "#2563EB", color: "#F8FAFC", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          {isRunning ? <Square size={14} /> : <Mic size={14} />}
          {isRunning ? "停止" : "録音"}
        </button>
      </div>

      {/* 音高 */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px", marginBottom: 10, display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ textAlign: "center", minWidth: 90 }}>
          <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1, color: note ? "#0F172A" : "#64748B" }}>
            {note ? note.name : "—"}<span style={{ fontSize: 16, color: "#64748B" }}>{note ? note.octave : ""}</span>
          </div>
          <div className="sans" style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>{pitch ? `${pitch.toFixed(1)} Hz` : "未検出"}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ position: "relative", height: 30 }}>
            <svg width="100%" height="30" style={{ overflow: "visible" }}>
              <line x1="0" y1="15" x2="100%" y2="15" stroke="#E2E8F0" strokeWidth="2" />
              {[-50, -25, 0, 25, 50].map((c) => (
                <line key={c} x1={`${50 + c}%`} y1="9" x2={`${50 + c}%`} y2="21" stroke={c === 0 ? "#2563EB" : "#CBD5E1"} strokeWidth="2" />
              ))}
            </svg>
            <div style={{ position: "absolute", left: `calc(50% + ${needleRotation}%)`, top: 0, transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `10px solid ${Math.abs(centsOffset) > 15 ? "#DC2626" : "#2563EB"}`, transition: "left 0.1s ease-out" }} />
          </div>
          <div className="sans" style={{ fontSize: 10, color: note ? (Math.abs(centsOffset) > 15 ? "#DC2626" : "#2563EB") : "#64748B", textAlign: "center" }}>
            {note ? `${centsOffset > 0 ? "+" : ""}${centsOffset}¢` : "0¢"}
          </div>
        </div>
      </div>

      {/* スペクトル */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 16px", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 6 }}>スペクトル (0–4000 Hz)</div>
        <div style={{ display: "flex", alignItems: "flex-end", height: 70, gap: 2 }}>
          {spectrumBars.map((v, i) => (<div key={i} style={{ flex: 1, height: `${Math.max(2, v * 100)}%`, background: "#2563EB", borderRadius: "2px 2px 0 0" }} />))}
        </div>
      </div>

      {/* 倍音構成 */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 16px", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 10, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
          <span>倍音構成（実測 / 理論 / 理想）</span>
          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={showTheory} onChange={(e) => setShowTheory(e.target.checked)} /> 理論</label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={showIdeal} onChange={(e) => setShowIdeal(e.target.checked)} /> 理想</label>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 130, paddingTop: 14 }}>
          {Array.from({ length: NUM_HARMONICS }).map((_, idx) => {
            const n = idx + 1;
            const measured = harmonicLevels.find((h) => h.n === n);
            const measuredHeight = measured ? measured.norm * 100 : 0;
            const theoHarmonic = theoreticalHarmonics[idx];
            const idealHarmonic = selectedIdeal?.harmonicsProfile?.find((h) => h.n === n);
            const idealHeight = idealHarmonic ? idealHarmonic.norm * 100 : 0;
            return (
              <div key={n} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
                <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, position: "relative" }}>
                  {showTheory && (<div style={{ position: "absolute", bottom: 0, width: "90%", height: "100%", border: "1.5px dashed #D97706", borderBottom: "none", borderRadius: "3px 3px 0 0", opacity: 0.45 }} />)}
                  <div style={{ width: "38%", height: `${measuredHeight}%`, background: measured ? "#2563EB" : "transparent", borderRadius: "3px 3px 0 0", minHeight: measured ? 3 : 0, transition: "height 0.1s ease-out" }} />
                  {showIdeal && selectedIdeal && (<div style={{ width: "28%", height: `${idealHeight}%`, background: idealHarmonic ? "#94A3B8" : "transparent", borderRadius: "3px 3px 0 0", minHeight: idealHarmonic ? 3 : 0, opacity: 0.85 }} />)}
                </div>
                <div className="sans" style={{ fontSize: 9, color: "#64748B", marginTop: 4 }}>{n}倍</div>
                <div className="sans" style={{ fontSize: 8, color: "#94A3B8" }}>{theoHarmonic ? `${Math.round(theoHarmonic.freq)}Hz` : "—"}</div>
              </div>
            );
          })}
        </div>
        <div className="sans" style={{ fontSize: 9, color: "#64748B", marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "#2563EB", borderRadius: 2, display: "inline-block" }} />実測</span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, border: "1.5px dashed #D97706", borderRadius: 2, display: "inline-block" }} />理論(絶対周波数)</span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "#2563EB", borderRadius: 2, display: "inline-block" }} />理想{selectedIdeal ? `: ${selectedIdeal.name}` : "(未選択)"}</span>
        </div>
      </div>

      {/* 補助指標 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
        <MetricCard label="音量" value={`${volumeDb.toFixed(1)} dB`} sub={selectedIdeal ? `理想: ${selectedIdeal.volumeDb?.toFixed(1)} dB` : null} />
        <MetricCard label="スペクトル重心" value={`${Math.round(centroidHz)} Hz`} sub={selectedIdeal ? `理想: ${Math.round(selectedIdeal.centroidHz)} Hz` : null} />
        <MetricCard label="HNR" value={hnrDb !== null ? `${hnrDb.toFixed(1)} dB` : "—"} sub={selectedIdeal?.hnrDb != null ? `理想: ${selectedIdeal.hnrDb.toFixed(1)} dB` : null} />
      </div>

      {/* サックスプリセット + 設定 */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px" }}>
        <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 8 }}>サックス種別</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {Object.entries(SAX_PRESETS).map(([key, p]) => (
            <button key={key} onClick={() => setSaxType(key)} className="sans" style={{ flex: 1, padding: "9px 4px", borderRadius: 8, border: saxType === key ? "1.5px solid #2563EB" : "1px solid #E2E8F0", background: saxType === key ? "#EFF6FF" : "transparent", color: saxType === key ? "#2563EB" : "#64748B", cursor: "pointer", fontSize: 12, fontWeight: saxType === key ? 600 : 400 }}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 8 }}>基準ピッチ</div>
        <div style={{ display: "flex", gap: 8 }}>
          {[440, 442, 443].map((hz) => (
            <button key={hz} onClick={() => setTuningHz(hz)} className="sans" style={{ flex: 1, padding: "7px 4px", borderRadius: 8, border: tuningHz === hz ? "1.5px solid #2563EB" : "1px solid #E2E8F0", background: tuningHz === hz ? "#EFF6FF" : "transparent", color: tuningHz === hz ? "#2563EB" : "#64748B", cursor: "pointer", fontSize: 11, fontWeight: tuningHz === hz ? 600 : 400 }}>
              {hz} Hz
            </button>
          ))}
        </div>

        {/* 運指ベース管長自動キャリブレーション: 現在判定されている運指をライブ表示 */}
        <div className="sans" style={{ fontSize: 10, color: "#94A3B8", marginTop: 10, padding: "8px 10px", background: "#F8FAFC", borderRadius: 6, border: "1px solid #E2E8F0" }}>
          {matchedFingering ? (
            <>
              判定運指: <span style={{ color: "#2563EB" }}>記音{matchedFingering.writtenLabel}</span>　
              理論実音: <span style={{ color: "#D97706" }}>{matchedFingering.soundingFreqHz.toFixed(1)} Hz</span>　
              逆算管長: {derivedTubeLengthCm?.toFixed(1) ?? "—"} cm
            </>
          ) : (
            <span style={{ color: "#64748B" }}>録音を開始すると、運指の自動判定結果がここに表示されます</span>
          )}
        </div>

        <button onClick={() => setSettingsExpanded((v) => !v)} className="sans" style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#64748B", fontSize: 11, marginTop: 10, cursor: "pointer", padding: 0 }}>
          {settingsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />} 詳細設定・理想値プロファイル
        </button>

        {settingsExpanded && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E2E8F0" }}>
            <label className="sans" style={{ fontSize: 10, color: "#64748B" }}>気温 {temperature}°C</label>
            <input type="range" min="0" max="40" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} style={{ width: "100%", marginBottom: 12 }} />
            <label className="sans" style={{ fontSize: 10, color: "#64748B" }}>
              楽器オフセット {instrumentOffsetCents > 0 ? "+" : ""}{instrumentOffsetCents}¢
              <span style={{ color: "#94A3B8", marginLeft: 6 }}>（個体差の補正。チューナーで合わせた状態で誤差が偏る場合に調整）</span>
            </label>
            <input type="range" min="-50" max="50" value={instrumentOffsetCents} onChange={(e) => setInstrumentOffsetCents(Number(e.target.value))} style={{ width: "100%", marginBottom: 12 }} />
            <div className="sans" style={{ fontSize: 10, color: "#94A3B8", marginBottom: 12 }}>
              理論基音(現在の運指): <span style={{ color: "#D97706" }}>{theoreticalHarmonics[0]?.freq.toFixed(1)} Hz</span>
            </div>
            <div className="sans" style={{ fontSize: 11, color: "#0F172A", marginBottom: 6, fontWeight: 600 }}>理想値プロファイル</div>
            <div className="sans" style={{ fontSize: 9, color: "#94A3B8", marginBottom: 6 }}>
              保存ボタンを押す直前の約1秒間を平均して保存します。安定した音を1秒ほど伸ばしてから押してください
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input type="text" placeholder="名前を付けて現在の音を保存" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} className="sans" style={{ flex: 1, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, padding: "7px 10px", color: "#0F172A", fontSize: 11 }} />
              <button onClick={saveIdealProfile} disabled={!isRunning || !pitch || !newProfileName.trim()} className="sans" style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 12px", borderRadius: 6, border: "none", background: (!isRunning || !pitch || !newProfileName.trim()) ? "#E2E8F0" : "#2563EB", color: (!isRunning || !pitch || !newProfileName.trim()) ? "#64748B" : "#F8FAFC", fontSize: 11, cursor: (!isRunning || !pitch || !newProfileName.trim()) ? "default" : "pointer" }}>
                <Save size={12} /> 保存
              </button>
            </div>
            {idealProfiles.length === 0 ? (
              <div className="sans" style={{ fontSize: 10, color: "#94A3B8" }}>保存済みの理想値はありません</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {idealProfiles.map((p) => (
                  <div key={p.id} onClick={() => setSelectedIdealId(p.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", borderRadius: 6, cursor: "pointer", border: selectedIdealId === p.id ? "1.5px solid #2563EB" : "1px solid #E2E8F0", background: selectedIdealId === p.id ? "#EFF6FF" : "transparent" }}>
                    <div className="sans" style={{ fontSize: 11, color: selectedIdealId === p.id ? "#2563EB" : "#0F172A" }}>{p.name}<span style={{ fontSize: 9, color: "#64748B", marginLeft: 6 }}>{SAX_PRESETS[p.saxType]?.label}</span></div>
                    <button onClick={(e) => { e.stopPropagation(); deleteIdealProfile(p.id); }} style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", padding: 4 }}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* フレーズ判定時のみ表示(2音以上検出): タイムライン(旧フレーズモード相当) */}
      {isPhraseResult && (
        <>
          {idealProfiles.length > 0 && (
            <div className="sans" style={{ fontSize: 11, margin: "10px 0", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#64748B" }}>理想値プロファイル:</span>
              <select value={selectedIdealId || ""} onChange={(e) => setSelectedIdealId(e.target.value || null)}>
                <option value="">未選択</option>
                {idealProfiles.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
            </div>
          )}
          {/* 表示切り替え */}
          <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 14px", marginBottom: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span className="sans" style={{ fontSize: 10, color: "#64748B" }}>表示:</span>
              <select value={timelineMetric} onChange={(e) => setTimelineMetric(e.target.value)}>
                {metricOptions.map((m) => (<option key={m.key} value={m.key}>{m.label}</option>))}
              </select>
              <select value={timelineFormat} onChange={(e) => setTimelineFormat(e.target.value)}>
                <option value="line">折れ線</option>
                <option value="heatmap">ヒートマップ</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span className="sans" style={{ fontSize: 10, color: "#64748B" }}>音高の基準:</span>
              <select value={matchBasis} onChange={(e) => setMatchBasis(e.target.value)}>
                <option value="theoretical">理論値(運指テーブル)</option>
                <option value="ideal">理想値{selectedIdeal ? `(${selectedIdeal.name})` : ""}</option>
              </select>
            </div>
          </div>
          <div className="sans" style={{ fontSize: 9, color: "#94A3B8", marginBottom: 10 }}>
            音高はピッチに絶対的な正解があるため理論値/理想値を選べます。音量・音色・重心・HNRは理想値(お手本)との比較のみです。
          </div>

          {/* タイムライン */}
          <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "14px", marginBottom: 10 }}>
            <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 8 }}>
              タイムライン — ピッチ一致度で色分け（{matchBasis === "theoretical" ? "理論値基準" : "理想値基準"}）
              {phraseNoteEvents?.length > 0 && (() => {
                const attacks = phraseNoteEvents.map((e) => e.attackTimeMs).filter((v) => v !== null);
                const avg = attacks.length ? Math.round(attacks.reduce((a, b) => a + b, 0) / attacks.length) : null;
                return <span style={{ marginLeft: 8 }}>｜ 検出ノート {phraseNoteEvents.length}{avg !== null ? ` ・ 平均アタック ${avg}ms` : ""}</span>;
              })()}
            </div>
            <div style={{ overflowX: "auto" }}>
              <svg width={Math.max(600, phraseFrames.length * 6)} height="120" style={{ display: "block" }}>
                {timelineFormat === "line" ? (
                  <polyline
                    fill="none" stroke="#2563EB" strokeWidth="1.5"
                    points={phraseFrames.map((f, i) => {
                      const v = getMetricValue(f);
                      const y = v !== null && v !== undefined && !isNaN(v) ? 100 - ((v - minV) / range) * 90 : 100;
                      return `${i * 6},${y}`;
                    }).join(" ")}
                  />
                ) : null}
                {phraseFrames.map((f, i) => {
                  const score = getMatchScore(f, "pitch");
                  const color = scoreToColor(score);
                  if (timelineFormat === "heatmap") {
                    return <rect key={i} x={i * 6} y={0} width={6} height={110} fill={color} opacity={0.8} />;
                  }
                  return (
                    <rect key={i} x={i * 6} y={110} width={5} height={8} fill={color}
                      onClick={() => setSelectedFrameIdx(i)}
                      style={{ cursor: "pointer" }}
                    />
                  );
                })}
                {selectedFrameIdx !== null && (
                  <line x1={selectedFrameIdx * 6 + 2.5} y1={0} x2={selectedFrameIdx * 6 + 2.5} y2={118} stroke="#0F172A" strokeWidth="1" strokeDasharray="2,2" />
                )}
              </svg>
            </div>
            <input
              type="range" min={0} max={phraseFrames.length - 1}
              value={selectedFrameIdx ?? 0}
              onChange={(e) => setSelectedFrameIdx(Number(e.target.value))}
              style={{ width: "100%", marginTop: 8 }}
            />
            <div className="sans" style={{ fontSize: 9, color: "#94A3B8", display: "flex", justifyContent: "space-between" }}>
              <span>0s</span>
              <span>{phraseFrames[phraseFrames.length - 1]?.t.toFixed(1)}s</span>
            </div>
          </div>

          {/* ドリルダウン: 選択フレームの詳細 */}
          {selectedFrame && (
            <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "14px" }}>
              <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 10 }}>
                t = {selectedFrame.t.toFixed(2)}s の詳細
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <MetricCard label="音高一致度" value={`${Math.round(getMatchScore(selectedFrame, "pitch") * 100)}%`} sub={selectedFrame.pitchHz ? `${selectedFrame.pitchHz.toFixed(1)} Hz ／ 記音${selectedFrame.matchedWrittenNote ?? "—"}` : "—"} accentColor={scoreToColor(getMatchScore(selectedFrame, "pitch"))} />
                <MetricCard label="音色一致度(理想値基準)" value={selectedIdeal ? `${Math.round(getMatchScore(selectedFrame, "timbre") * 100)}%` : "—"} sub={selectedIdeal ? `重心 ${Math.round(selectedFrame.spectralCentroidHz)}Hz` : "理想値未選択"} accentColor={selectedIdeal ? scoreToColor(getMatchScore(selectedFrame, "timbre")) : undefined} />
              </div>

              {/* 倍音構成バー(ドリルダウン表示) */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100, paddingTop: 10 }}>
                {Array.from({ length: NUM_HARMONICS }).map((_, idx) => {
                  const n = idx + 1;
                  const measured = selectedFrame.harmonics?.find((h) => h.n === n);
                  const measuredHeight = measured ? measured.levelNorm * 100 : 0;
                  const theoHarmonic = theoreticalHarmonics[idx];
                  const idealHarmonic = selectedIdeal?.harmonicsProfile?.find((h) => h.n === n);
                  const idealHeight = idealHarmonic ? idealHarmonic.norm * 100 : 0;
                  return (
                    <div key={n} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
                      <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, position: "relative" }}>
                        <div style={{ position: "absolute", bottom: 0, width: "90%", height: "100%", border: "1.5px dashed #D97706", borderBottom: "none", borderRadius: "3px 3px 0 0", opacity: 0.4 }} />
                        <div style={{ width: "38%", height: `${measuredHeight}%`, background: "#2563EB", borderRadius: "3px 3px 0 0", minHeight: measured ? 3 : 0 }} />
                        {selectedIdeal && (<div style={{ width: "28%", height: `${idealHeight}%`, background: idealHarmonic ? "#94A3B8" : "transparent", borderRadius: "3px 3px 0 0", minHeight: idealHarmonic ? 3 : 0, opacity: 0.85 }} />)}
                      </div>
                      <div className="sans" style={{ fontSize: 8, color: "#64748B", marginTop: 3 }}>{n}倍</div>
                    </div>
                  );
                })}
              </div>

              <div className="sans" style={{ fontSize: 9, color: "#64748B", marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
                <span>音量: {selectedFrame.volumeDb?.toFixed(1)} dB</span>
                <span>HNR: {selectedFrame.hnrDb?.toFixed(1) ?? "—"} dB</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 主観評価の5段階星レーティング。クリックで1〜5をセット、同じ星を再クリックで解除(null)。
function StarRating({ value, onChange, size = 13, readOnly = false }) {
  return (
    <div style={{ display: "flex", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          onClick={readOnly ? undefined : () => onChange(n === value ? null : n)}
          style={{
            cursor: readOnly ? "default" : "pointer",
            color: value && n <= value ? "#D97706" : "#CBD5E1",
            fontSize: size,
            lineHeight: 1,
            userSelect: "none",
          }}
        >
          ★
        </span>
      ))}
    </div>
  );
}

function MetricCard({ label, value, sub, accentColor }) {
  return (
    <div style={{ background: "#FFFFFF", border: `1px solid ${accentColor || "#E2E8F0"}`, borderRadius: 8, padding: "8px 10px" }}>
      <div className="sans" style={{ fontSize: 9, color: "#64748B" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2, color: accentColor || "#0F172A" }}>{value}</div>
      {sub && <div className="sans" style={{ fontSize: 8, color: "#2563EB", marginTop: 1 }}>{sub}</div>}
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
  const { reeds, setReeds, sessions, updateSessions, pendingLinkSessionId, setPendingLinkSessionId, setTopTab, setSelectedReedId } = props;

  const [newBrand, setNewBrand] = useState(INITIAL_REED_BRANDS[0]);
  const [customBrand, setCustomBrand] = useState("");
  const [newStrength, setNewStrength] = useState(REED_STRENGTHS[2]); // 初期値3.0
  const [newStartDate, setNewStartDate] = useState(() => new Date().toISOString().slice(0, 10));

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

  const deleteReed = (id) => {
    setReeds((prev) => prev.filter((r) => r.id !== id));
    updateSessions((prev) => prev.map((s) => (s.reedId === id ? { ...s, reedId: null, linkedAt: null } : s)));
  };

  const rateReed = (id, rating) => {
    setReeds((prev) => prev.map((r) => (r.id === id ? { ...r, rating } : r)));
  };

  const goToMeasure = (id) => {
    setSelectedReedId(id);
    setTopTab("measure");
  };

  const linkSession = (sessionId, reedId) => {
    updateSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, reedId, linkedAt: "retroactive" } : s)));
    setPendingLinkSessionId(null);
  };

  const unlinkedSessions = sessions.filter((s) => !s.reedId);
  const reedGroups = groupReeds(reeds);
  const [expandedGroupKey, setExpandedGroupKey] = useState(null); // タップした箱だけ中身を展開する

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 11, color: "#0F172A", fontWeight: 600, marginBottom: 10 }}>新しいリードを登録</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div>
            <label className="sans" style={{ fontSize: 9, color: "#64748B", display: "block", marginBottom: 3 }}>銘柄</label>
            <select value={newBrand} onChange={(e) => setNewBrand(e.target.value)} style={{ width: "100%" }}>
              {brandOptions.map((b) => (<option key={b} value={b}>{b}</option>))}
              <option value="__custom__">＋ 新しい銘柄を入力...</option>
            </select>
          </div>
          <div>
            <label className="sans" style={{ fontSize: 9, color: "#64748B", display: "block", marginBottom: 3 }}>番手（硬さ）</label>
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
            style={{ width: "100%", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, padding: "7px 10px", color: "#0F172A", fontSize: 11, marginBottom: 8, boxSizing: "border-box" }}
          />
        )}

        <div style={{ marginBottom: 10 }}>
          <label className="sans" style={{ fontSize: 9, color: "#64748B", display: "block", marginBottom: 3 }}>使用開始日</label>
          <input type="date" value={newStartDate} onChange={(e) => setNewStartDate(e.target.value)} className="sans" style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, padding: "7px 10px", color: "#0F172A", fontSize: 11 }} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => registerReeds(1)}
            disabled={newBrand === "__custom__" && !customBrand.trim()}
            className="sans"
            style={{ flex: 1, padding: "9px 4px", borderRadius: 6, border: "1px solid #E2E8F0", background: "transparent", color: "#0F172A", fontSize: 11, cursor: "pointer" }}
          >
            1枚だけ追加
          </button>
          <button
            onClick={() => registerReeds(REED_BOX_SIZE)}
            disabled={newBrand === "__custom__" && !customBrand.trim()}
            className="sans"
            style={{ flex: 1, padding: "9px 4px", borderRadius: 6, border: "none", background: "#2563EB", color: "#F8FAFC", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >
            1箱({REED_BOX_SIZE}枚)まとめて追加
          </button>
        </div>
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 11, color: "#0F172A", fontWeight: 600, marginBottom: 10 }}>登録済みリード（{reeds.length}）</div>
        {reeds.length === 0 ? (
          <div className="sans" style={{ fontSize: 11, color: "#94A3B8" }}>まだリードが登録されていません</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reedGroups.map((g) => {
              const isExpanded = expandedGroupKey === g.key;
              return (
                <div key={g.key} style={{ border: "1px solid #E2E8F0", borderRadius: 8, overflow: "hidden" }}>
                  <button
                    onClick={() => setExpandedGroupKey(isExpanded ? null : g.key)}
                    className="sans"
                    style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: isExpanded ? "#EFF6FF" : "#FFFFFF", border: "none", cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ fontSize: 11 }}>
                      <span style={{ color: "#0F172A", fontWeight: 600 }}>{g.brand}</span>{" "}
                      <span style={{ color: "#2563EB", fontWeight: 600 }}>{g.strength}</span>{" "}
                      <span style={{ color: "#64748B", fontSize: 10 }}>使用開始 {g.startDate} ・ {g.members.length}枚</span>
                    </span>
                    {isExpanded ? <ChevronUp size={14} color="#64748B" /> : <ChevronDown size={14} color="#64748B" />}
                  </button>
                  {isExpanded && (
                    <div style={{ borderTop: "1px solid #E2E8F0", padding: "4px 12px" }}>
                      {g.members.map((r, idx) => (
                        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: idx < g.members.length - 1 ? "1px solid #F1F5F9" : "none" }}>
                          <span className="sans" style={{ fontSize: 10, fontWeight: 700, color: "#0F172A", width: 22, flexShrink: 0 }}>#{idx + 1}</span>
                          <StarRating value={r.rating} onChange={(v) => rateReed(r.id, v)} size={11} />
                          <button
                            onClick={() => goToMeasure(r.id)}
                            className="sans"
                            style={{ fontSize: 9, padding: "4px 10px", borderRadius: 5, border: "1px solid #2563EB", background: "#EFF6FF", color: "#2563EB", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}
                          >
                            測定へ
                          </button>
                          <button onClick={() => deleteReed(r.id)} style={{ background: "none", border: "none", color: "#94A3B8", cursor: "pointer", padding: 2, marginLeft: "auto", flexShrink: 0 }}><Trash2 size={12} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {unlinkedSessions.length > 0 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #D97706", borderRadius: 10, padding: "14px 16px" }}>
          <div className="sans" style={{ fontSize: 11, color: "#D97706", fontWeight: 600, marginBottom: 10 }}>
            未紐付けのセッション（{unlinkedSessions.length}）— 事後紐付け
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {unlinkedSessions.map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="sans" style={{ fontSize: 10, color: "#64748B" }}>
                  {new Date(s.recordedAt).toLocaleString("ja-JP")} ・ {s.frames?.length ?? 0}フレーム
                  {s.memo && <span style={{ color: "#2563EB", marginLeft: 6 }}>「{s.memo}」</span>}
                </span>
                <select onChange={(e) => { if (e.target.value) linkSession(s.id, e.target.value); }} defaultValue="">
                  <option value="" disabled>リードを選択して紐付け</option>
                  {reeds.map((r) => (<option key={r.id} value={r.id}>{reedLabel(r, reeds)}</option>))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
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

// リード別比較・リード毎比較で共通する比較項目の定義
const REED_COMPARE_METRICS = [
  { key: "hnrDb", label: "HNR", unit: "dB", fmt: (v) => v.toFixed(1) },
  { key: "spectralCentroidHz", label: "スペクトル重心", unit: "Hz", fmt: (v) => Math.round(v).toString() },
  { key: "volumeDb", label: "音量", unit: "dB", fmt: (v) => v.toFixed(1) },
  { key: "pitchCents", label: "ピッチ誤差(絶対値)", unit: "¢", fmt: (v) => v.toFixed(1) },
];

function DataAnalysisView(props) {
  const { reeds, sessions, selectedIdeal } = props;

  const [subTab, setSubTab] = useState("compare"); // compare | history | ranking
  const [compareReedIds, setCompareReedIds] = useState([]);
  const [historyReedId, setHistoryReedId] = useState(null);

  // リードごとにセッションのフレームを集約し、スコアリング用の配列を作る
  const buildReedMetrics = (reedId) => {
    const reedSessions = sessions.filter((s) => s.reedId === reedId);
    const allFrames = reedSessions.flatMap((s) => s.frames || []);
    const hnrValues = allFrames.map((f) => f.hnrDb).filter((v) => v !== null && v !== undefined);
    const volumeDbValues = allFrames.map((f) => f.volumeDb).filter((v) => v !== null && v !== undefined);
    const pitchCentsErrorValues = allFrames.map((f) => f.pitchCents).filter((v) => v !== null && v !== undefined);
    const centroidValues = allFrames.map((f) => f.spectralCentroidHz).filter((v) => v !== null && v !== undefined);
    return { reedSessions, allFrames, hnrValues, volumeDbValues, pitchCentsErrorValues, centroidValues };
  };

  const reedRankings = reeds.map((reed) => {
    const m = buildReedMetrics(reed.id);
    const scoreResult = reedCompositeScore(
      { hnrValues: m.hnrValues, volumeDbValues: m.volumeDbValues, pitchCentsErrorValues: m.pitchCentsErrorValues, centroidValues: m.centroidValues },
      selectedIdeal?.centroidHz ?? null
    );
    return { reed, rating: reed.rating ?? null, sessionCount: m.reedSessions.length, frameCount: m.allFrames.length, ...scoreResult };
  }).sort((a, b) => b.composite - a.composite);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 6, background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: 4, marginBottom: 10 }}>
        {[
          { key: "compare", label: "リード別比較" },
          { key: "history", label: "リード毎比較" },
          { key: "ranking", label: "ランキング" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className="sans"
            style={{
              flex: 1, padding: "8px 4px", borderRadius: 7, border: "none",
              background: subTab === t.key ? "#EFF6FF" : "transparent",
              color: subTab === t.key ? "#2563EB" : "#64748B",
              fontWeight: subTab === t.key ? 600 : 400, fontSize: 11, cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "compare" && (
        <ReedCompareTab reeds={reeds} sessions={sessions} compareReedIds={compareReedIds} setCompareReedIds={setCompareReedIds} />
      )}
      {subTab === "history" && (
        <ReedHistoryTab reeds={reeds} sessions={sessions} historyReedId={historyReedId} setHistoryReedId={setHistoryReedId} />
      )}
      {subTab === "ranking" && (
        <ReedRankingTab reedRankings={reedRankings} hasIdeal={!!selectedIdeal} reeds={reeds} />
      )}
    </div>
  );
}


// --- 10.4(a): リード別比較(複数リードをグラフで視覚比較) ---
function ReedCompareTab({ reeds, sessions, compareReedIds, setCompareReedIds }) {
  const toggleReed = (id) => {
    setCompareReedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const frameCountFor = (reedId) => sessions.filter((s) => s.reedId === reedId).reduce((n, s) => n + (s.frames?.length ?? 0), 0);

  const summaryFor = (reedId) => {
    const frames = sessions.filter((s) => s.reedId === reedId).flatMap((s) => s.frames || []);
    return computeFrameMetrics(frames);
  };

  if (reeds.length === 0) {
    return <div className="sans" style={{ fontSize: 11, color: "#94A3B8", textAlign: "center", padding: 30 }}>比較するリードがありません。まず「登録」タブでリードを登録してください</div>;
  }

  const items = compareReedIds
    .map((id) => reeds.find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => ({ reed: r, label: reedLabel(r, reeds), summary: summaryFor(r.id), frameCount: frameCountFor(r.id) }));

  return (
    <div>
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 8 }}>比較するリードを選択(複数可)。箱ごとにグループ化しています</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groupReeds(reeds).map((g) => (
            <div key={g.key}>
              <div className="sans" style={{ fontSize: 9, color: "#64748B", marginBottom: 4 }}>
                {g.brand} {g.strength}（{g.startDate}）
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {g.members.map((r, idx) => (
                  <button key={r.id} onClick={() => toggleReed(r.id)} className="sans" style={{
                    padding: "6px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                    border: compareReedIds.includes(r.id) ? "1.5px solid #2563EB" : "1px solid #E2E8F0",
                    background: compareReedIds.includes(r.id) ? "#EFF6FF" : "transparent",
                    color: compareReedIds.includes(r.id) ? "#2563EB" : "#64748B",
                  }}>
                    #{idx + 1}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="sans" style={{ fontSize: 11, color: "#94A3B8", textAlign: "center", padding: 20 }}>リードを選択すると比較グラフが表示されます</div>
      ) : (
        <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "14px 16px" }}>
          {REED_COMPARE_METRICS.map((m) => (
            <ReedMetricBarRow
              key={m.key}
              label={m.label}
              unit={m.unit}
              items={items.map((it) => ({ id: it.reed.id, label: it.label, value: it.summary[m.key] }))}
              fmt={m.fmt}
            />
          ))}
          <div style={{ marginBottom: 4 }}>
            <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 6 }}>主観評価</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map((it) => (
                <div key={it.reed.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="sans" style={{ fontSize: 9, color: "#0F172A", width: 150, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={it.label}>{it.label}</span>
                  <StarRating value={it.reed.rating} onChange={() => {}} readOnly size={12} />
                </div>
              ))}
            </div>
          </div>
          <div className="sans" style={{ fontSize: 9, color: "#94A3B8", marginTop: 10 }}>
            {items.map((it) => `${it.label}: ${it.frameCount}フレーム`).join(" ・ ")}
          </div>
        </div>
      )}
    </div>
  );
}

// 1項目分の横棒グラフ行(複数リードを同じスケールで比較)
function ReedMetricBarRow({ label, unit, items, fmt }) {
  const values = items.map((i) => i.value).filter((v) => v !== null && v !== undefined && !isNaN(v));
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1e-6);
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 6 }}>{label}{unit ? ` (${unit})` : ""}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {items.map((it) => (
          <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="sans" style={{ fontSize: 9, color: "#0F172A", width: 150, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={it.label}>{it.label}</span>
            <div style={{ flex: 1, background: "#F1F5F9", borderRadius: 4, height: 14, position: "relative", overflow: "hidden" }}>
              <div style={{ width: it.value !== null && it.value !== undefined ? `${Math.max(2, (Math.abs(it.value) / maxAbs) * 100)}%` : 0, height: "100%", background: "#2563EB", borderRadius: 4 }} />
            </div>
            <span className="sans" style={{ fontSize: 9, color: "#64748B", width: 54, textAlign: "right", flexShrink: 0 }}>{it.value !== null && it.value !== undefined ? fmt(it.value) : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- 10.4(b): リード毎比較(1本のリードの経時変化。HNR以外の項目も切替可能) ---
function ReedHistoryTab({ reeds, sessions, historyReedId, setHistoryReedId }) {
  const [historyMetric, setHistoryMetric] = useState("hnrDb");
  // リードが100枚規模になっても選びやすいよう、箱→箱内の個別リードの2段階選択にする
  const reedGroups = groupReeds(reeds);
  const currentReedForGroup = reeds.find((r) => r.id === historyReedId) || null;
  const [historyGroupKey, setHistoryGroupKey] = useState(() => (currentReedForGroup ? reedGroupKey(currentReedForGroup) : null));
  const selectedGroup = reedGroups.find((g) => g.key === historyGroupKey) || null;

  const reedSessions = sessions
    .filter((s) => s.reedId === historyReedId)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  const points = reedSessions.map((s) => {
    const frames = s.frames || [];
    return { date: s.recordedAt, frameCount: frames.length, memo: s.memo, ...computeFrameMetrics(frames) };
  });

  const metricDef = REED_COMPARE_METRICS.find((m) => m.key === historyMetric);
  const validPoints = points.filter((p) => p[historyMetric] !== null && p[historyMetric] !== undefined);
  const vals = validPoints.map((p) => p[historyMetric]);
  const minV = vals.length ? Math.min(...vals) : 0;
  const maxV = vals.length ? Math.max(...vals) : 1;
  const range = maxV - minV || 1;

  const historyReed = reeds.find((r) => r.id === historyReedId) || null;

  if (reeds.length === 0) {
    return <div className="sans" style={{ fontSize: 11, color: "#94A3B8", textAlign: "center", padding: 30 }}>リードが登録されていません</div>;
  }

  return (
    <div>
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 8 }}>経時変化を見るリードを選択</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            value={historyGroupKey || ""}
            onChange={(e) => { setHistoryGroupKey(e.target.value || null); setHistoryReedId(null); }}
          >
            <option value="">箱を選択</option>
            {reedGroups.map((g) => (<option key={g.key} value={g.key}>{g.brand} {g.strength}（{g.startDate}・{g.members.length}枚）</option>))}
          </select>
          <select
            value={historyReedId || ""}
            onChange={(e) => setHistoryReedId(e.target.value || null)}
            disabled={!selectedGroup}
          >
            <option value="">{selectedGroup ? "番号を選択" : "先に箱を選択してください"}</option>
            {selectedGroup?.members.map((r, idx) => (<option key={r.id} value={r.id}>#{idx + 1}</option>))}
          </select>
        </div>
      </div>

      {historyReedId && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <span className="sans" style={{ fontSize: 10, color: "#64748B" }}>
              {metricDef.label}の推移（セッション毎の平均値、{validPoints.length}セッション）
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="sans" style={{ fontSize: 9, color: "#64748B" }}>主観評価:</span>
              <StarRating value={historyReed?.rating} onChange={() => {}} readOnly size={12} />
              <span className="sans" style={{ fontSize: 9, color: "#64748B" }}>項目:</span>
              <select value={historyMetric} onChange={(e) => setHistoryMetric(e.target.value)}>
                {REED_COMPARE_METRICS.map((m) => (<option key={m.key} value={m.key}>{m.label}</option>))}
              </select>
            </div>
          </div>
          {validPoints.length === 0 ? (
            <div className="sans" style={{ fontSize: 11, color: "#94A3B8" }}>このリードに紐づく測定データがまだありません</div>
          ) : (
            <>
              <svg width="100%" height="140" viewBox={`0 0 ${Math.max(300, validPoints.length * 60)} 140`} style={{ display: "block" }}>
                <polyline
                  fill="none" stroke="#2563EB" strokeWidth="2"
                  points={validPoints.map((p, i) => {
                    const x = i * 60 + 30;
                    const y = 110 - ((p[historyMetric] - minV) / range) * 90;
                    return `${x},${y}`;
                  }).join(" ")}
                />
                {validPoints.map((p, i) => {
                  const x = i * 60 + 30;
                  const y = 110 - ((p[historyMetric] - minV) / range) * 90;
                  return <circle key={i} cx={x} cy={y} r={4} fill="#2563EB" />;
                })}
              </svg>
              <div className="sans" style={{ fontSize: 9, color: "#64748B", display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
                {validPoints.map((p, i) => (
                  <span key={i} title={p.memo || undefined}>
                    {new Date(p.date).toLocaleDateString("ja-JP")}: {metricDef.fmt(p[historyMetric])}{metricDef.unit}
                    {p.memo && <span style={{ color: "#2563EB" }}> 「{p.memo}」</span>}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
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
    return <div className="sans" style={{ fontSize: 11, color: "#94A3B8", textAlign: "center", padding: 30 }}>リードが登録されていません</div>;
  }

  const sorted = [...reedRankings].sort((a, b) => {
    const va = getRankingSortValue(a, sortKey);
    const vb = getRankingSortValue(b, sortKey);
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    return sortDir === "desc" ? vb - va : va - vb;
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span className="sans" style={{ fontSize: 10, color: "#64748B" }}>並び替え:</span>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
          {RANKING_SORT_OPTIONS.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
        </select>
        <button
          onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
          className="sans"
          style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #E2E8F0", background: "transparent", color: "#0F172A", fontSize: 11, cursor: "pointer" }}
        >
          {sortDir === "desc" ? "降順 ▼" : "昇順 ▲"}
        </button>
      </div>

      {!hasIdeal && (
        <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 10, padding: "8px 12px", background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 8 }}>
          理想値プロファイル未選択のため、スペクトル重心近似度は評価に含まれていません（HNR・音量安定性・ピッチ安定性の3要素で算出）
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.map((item, idx) => (
          <div key={item.reed.id} style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "12px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div className="sans" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#64748B", fontWeight: 700, width: 18 }}>{idx + 1}</span>
                <span style={{ color: "#0F172A", fontWeight: 600 }}>{reedLabel(item.reed, reeds)}</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: scoreToColor(item.composite) }}>
                {Math.round(item.composite * 100)}
              </div>
            </div>
            <div className="sans" style={{ fontSize: 9, color: "#64748B", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <span>{item.sessionCount}セッション ・ {item.frameCount}フレーム</span>
              <StarRating value={item.rating} onChange={() => {}} readOnly size={11} />
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
    <span className="sans" style={{ fontSize: 9, padding: "3px 8px", borderRadius: 10, background: "#F8FAFC", border: `1px solid ${scoreToColor(value)}`, color: scoreToColor(value) }}>
      {label} {Math.round(value * 100)}
    </span>
  );
}

// 原因推定スコア(0.0〜1.0)を横棒グラフで表示する行。分析タブの息不足/噛みすぎ/複合スコアに使用
function DiagnosisBarRow({ label, value }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color = scoreToColor(value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="sans" style={{ fontSize: 9, color: "#64748B", width: 40, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, background: "#F1F5F9", borderRadius: 4, height: 10, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
      </div>
      <span className="sans" style={{ fontSize: 9, color, width: 24, textAlign: "right", flexShrink: 0 }}>{pct}</span>
    </div>
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
const PIVOT_ROW_AXES = [
  { key: "note", label: "音名" },
  { key: "band", label: "音域帯" },
];
const PIVOT_COL_AXES = [
  { key: "reed", label: "リード" },
  { key: "reedDay", label: "リード×日数" },
  { key: "date", label: "録音日" },
];
const PIVOT_METRICS = [
  { key: "pitchCents", label: "平均ピッチ偏差(¢)", fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(1) },
  { key: "highHarm", label: "高次倍音強度(5-8)", fmt: (v) => (v * 100).toFixed(0) },
  { key: "hnr", label: "HNR(dB)", fmt: (v) => v.toFixed(1) },
  { key: "centroid", label: "重心(Hz)", fmt: (v) => Math.round(v).toString() },
];

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

function buildPivot(framesWithContext, reeds, rowAxis, colAxis, metricKey) {
  const rowKeyFn = (f) => {
    if (rowAxis === "note") return f.matchedWrittenNote ?? null;
    const band = registerBand(f.semitoneIndex);
    return band === "unknown" ? null : band;
  };
  const colKeyFn = (f) => {
    const reed = reeds.find((r) => r.id === f.reedId);
    if (colAxis === "reed") return reed ? `${reed.brand} ${reed.strength}` : null;
    if (colAxis === "reedDay") {
      if (!reed) return null;
      const d = usageDays(f.recordedAt, reed.startDate);
      return d ? `${reed.brand} ${reed.strength} ${d}日目` : `${reed.brand} ${reed.strength}`;
    }
    return new Date(f.recordedAt).toLocaleDateString("ja-JP");
  };
  const metricFn = (f) => {
    switch (metricKey) {
      case "pitchCents": return f.pitchCents;
      case "highHarm": {
        const hs = f.harmonics?.slice(4, 8).map((h) => h.levelNorm) ?? [];
        return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null;
      }
      case "hnr": return f.hnrDb;
      case "centroid": return f.spectralCentroidHz;
      default: return null;
    }
  };

  const cells = {}; // rowKey -> colKey -> {sum, count}
  const rowMeta = {}; // rowKey -> semitoneIndex(ソート用)
  const colSet = new Set();
  for (const f of framesWithContext) {
    const rk = rowKeyFn(f);
    const ck = colKeyFn(f);
    const v = metricFn(f);
    if (rk === null || ck === null || v === null || v === undefined || isNaN(v)) continue;
    if (!cells[rk]) cells[rk] = {};
    if (!cells[rk][ck]) cells[rk][ck] = { sum: 0, count: 0 };
    cells[rk][ck].sum += v;
    cells[rk][ck].count += 1;
    colSet.add(ck);
    if (rowMeta[rk] === undefined && f.semitoneIndex !== null && f.semitoneIndex !== undefined) rowMeta[rk] = f.semitoneIndex;
  }

  const bandOrder = { low: 0, mid: 1, high: 2 };
  const rowKeys = Object.keys(cells).sort((a, b) => {
    if (rowAxis === "band") return (bandOrder[a] ?? 9) - (bandOrder[b] ?? 9);
    return (rowMeta[a] ?? 999) - (rowMeta[b] ?? 999); // 音名は半音インデックス順(低→高)
  });
  const colKeys = [...colSet].sort();
  return { cells, rowKeys, colKeys };
}

function AnalysisLabView({ sessions, reeds, selectedIdeal }) {
  const [axisType, setAxisType] = useState("reed"); // "reed" | "register"
  const [pivotRow, setPivotRow] = useState("note");
  const [pivotCol, setPivotCol] = useState("reed");
  const [pivotMetric, setPivotMetric] = useState("pitchCents");

  const canDiagnose = !!selectedIdeal?.harmonicsProfile;

  // 全セッションのフレームを、リードID・録音日時つきで平坦化する
  // (semitoneIndexはフレーム自体が保持: 企画書11.7節の記録拡張を実施済み)
  const framesWithContext = sessions.flatMap((s) =>
    (s.frames || []).map((f) => ({ ...f, reedId: s.reedId, recordedAt: s.recordedAt }))
  );

  const idealHarmonicsNorm = selectedIdeal?.harmonicsProfile
    ? Array.from({ length: 8 }, (_, i) => selectedIdeal.harmonicsProfile.find((h) => h.n === i + 1)?.norm ?? 0)
    : new Array(8).fill(0);

  // --- 原因推定: リード軸 ---
  const reedAggregation = canDiagnose
    ? aggregateDiagnosisByAxis(framesWithContext, (f) => f.reedId, idealHarmonicsNorm, selectedIdeal.centroidHz)
    : {};
  const reedRows = Object.entries(reedAggregation)
    .filter(([key]) => key !== "null" && key !== "undefined")
    .map(([reedId, agg]) => ({ label: null, reed: reeds.find((r) => r.id === reedId), reedId, ...agg }))
    .filter((row) => row.reed)
    .sort((a, b) => (b.avgBreathShortage + b.avgOverBiting) - (a.avgBreathShortage + a.avgOverBiting));

  // --- 原因推定: 音域軸 ---
  const registerAggregation = canDiagnose
    ? aggregateDiagnosisByAxis(
        framesWithContext.filter((f) => f.semitoneIndex !== null && f.semitoneIndex !== undefined),
        (f) => registerBand(f.semitoneIndex),
        idealHarmonicsNorm,
        selectedIdeal.centroidHz
      )
    : {};
  const registerRows = ["low", "mid", "high"]
    .filter((band) => registerAggregation[band])
    .map((band) => ({ bandKey: band, label: REGISTER_BAND_LABELS[band], ...registerAggregation[band] }));

  const activeRows = axisType === "reed" ? reedRows : registerRows;

  // --- ピボット集計 ---
  const pivot = buildPivot(framesWithContext, reeds, pivotRow, pivotCol, pivotMetric);
  const metricDef = PIVOT_METRICS.find((m) => m.key === pivotMetric);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* --- 11.4節: 体の使い方 原因推定 --- */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "16px 18px", marginBottom: 12 }}>
        <div className="sans" style={{ fontSize: 11, color: "#0F172A", fontWeight: 600, marginBottom: 4 }}>
          体の使い方 原因推定（推測）
        </div>
        <div className="sans" style={{ fontSize: 10, color: "#64748B", lineHeight: 1.6, marginBottom: 12 }}>
          理想値との差分パターン（高次倍音の減衰・ピッチの方向性・スペクトル重心）から、
          息のスピードやアンブシュアの締まり具合を推測レベルで提示します。マイクからの間接推定のため断定はしません。
        </div>

        {!canDiagnose ? (
          <div className="sans" style={{ fontSize: 11, color: "#D97706", padding: "10px 12px", background: "#FFFBEB", borderRadius: 6 }}>
            理想値プロファイルが選択されていません。「計測」タブでお手本の音を保存・選択すると、ここに診断結果が表示されます
          </div>
        ) : framesWithContext.length === 0 ? (
          <div className="sans" style={{ fontSize: 11, color: "#94A3B8" }}>
            測定データがまだありません。「計測」→「フレーズ」で録音してください
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[{ key: "reed", label: "リード軸" }, { key: "register", label: "音域軸" }].map((a) => (
                <button
                  key={a.key}
                  onClick={() => setAxisType(a.key)}
                  className="sans"
                  style={{
                    padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                    border: axisType === a.key ? "1.5px solid #2563EB" : "1px solid #E2E8F0",
                    background: axisType === a.key ? "#EFF6FF" : "transparent",
                    color: axisType === a.key ? "#2563EB" : "#64748B",
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>

            {activeRows.length === 0 ? (
              <div className="sans" style={{ fontSize: 11, color: "#94A3B8" }}>
                {axisType === "reed"
                  ? "リードに紐づく測定データがまだありません。録音時にリードを選択するか、「リード」タブで事後紐付けしてください"
                  : "運指判定つきの測定データがまだありません。この拡張後に録音したデータから音域別の集計が表示されます"}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {activeRows.map((row) => {
                  const diagLike = { breathShortage: row.avgBreathShortage, overBiting: row.avgOverBiting, compensating: row.avgCompensating };
                  const suggestions = formatSuggestions(diagLike);
                  const title = axisType === "reed" ? `${row.reed.brand} ${row.reed.strength}` : row.label;
                  const rowKey = axisType === "reed" ? row.reedId : row.bandKey;
                  return (
                    <div key={rowKey} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "10px 12px" }}>
                      <div className="sans" style={{ fontSize: 11, color: "#0F172A", fontWeight: 600, marginBottom: 6 }}>
                        {title}
                        <span style={{ fontSize: 9, color: "#64748B", fontWeight: 400, marginLeft: 8 }}>{row.frameCount}フレーム</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: suggestions.length ? 8 : 4 }}>
                        <DiagnosisBarRow label="息不足" value={row.avgBreathShortage} />
                        <DiagnosisBarRow label="噛みすぎ" value={row.avgOverBiting} />
                        <DiagnosisBarRow label="複合" value={row.avgCompensating} />
                      </div>
                      {suggestions.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {suggestions.map((s, i) => (
                            <div key={i} className="sans" style={{ fontSize: 10, color: scoreToColor(s.score) }}>
                              ・{s.text}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* --- 11.6節: クロス集計(ピボット型マトリクス) --- */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "16px 18px" }}>
        <div className="sans" style={{ fontSize: 11, color: "#0F172A", fontWeight: 600, marginBottom: 4 }}>
          クロス集計（ピボット）
        </div>
        <div className="sans" style={{ fontSize: 10, color: "#64748B", lineHeight: 1.6, marginBottom: 12 }}>
          縦軸・横軸・指標を組み合わせて、蓄積データをマトリクスで俯瞰します。各セルはその組み合わせに該当するフレームの平均値です。
        </div>

        <div className="sans" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12, fontSize: 10 }}>
          <span style={{ color: "#64748B" }}>縦軸:</span>
          <select value={pivotRow} onChange={(e) => setPivotRow(e.target.value)}>
            {PIVOT_ROW_AXES.map((a) => (<option key={a.key} value={a.key}>{a.label}</option>))}
          </select>
          <span style={{ color: "#64748B" }}>横軸:</span>
          <select value={pivotCol} onChange={(e) => setPivotCol(e.target.value)}>
            {PIVOT_COL_AXES.map((a) => (<option key={a.key} value={a.key}>{a.label}</option>))}
          </select>
          <span style={{ color: "#64748B" }}>指標:</span>
          <select value={pivotMetric} onChange={(e) => setPivotMetric(e.target.value)}>
            {PIVOT_METRICS.map((m) => (<option key={m.key} value={m.key}>{m.label}</option>))}
          </select>
        </div>

        {pivot.rowKeys.length === 0 ? (
          <div className="sans" style={{ fontSize: 11, color: "#94A3B8" }}>
            この軸の組み合わせに該当するデータがまだありません。運指判定・リード紐付けつきで録音するとここに表が育ちます
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 320 }}>
              <thead>
                <tr>
                  <th className="sans" style={{ position: "sticky", left: 0, background: "#FFFFFF", textAlign: "left", padding: "6px 10px", color: "#64748B", fontSize: 10, fontWeight: 600, borderBottom: "1px solid #E2E8F0" }}>
                    {PIVOT_ROW_AXES.find((a) => a.key === pivotRow)?.label} ＼ {PIVOT_COL_AXES.find((a) => a.key === pivotCol)?.label}
                  </th>
                  {pivot.colKeys.map((ck) => (
                    <th key={ck} className="sans" style={{ textAlign: "right", padding: "6px 10px", color: "#2563EB", fontSize: 10, fontWeight: 600, borderBottom: "1px solid #E2E8F0", whiteSpace: "nowrap" }}>
                      {ck}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pivot.rowKeys.map((rk) => (
                  <tr key={rk}>
                    <td className="sans" style={{ position: "sticky", left: 0, background: "#FFFFFF", padding: "5px 10px", color: "#0F172A", fontSize: 11, fontWeight: 600, borderBottom: "1px solid #E2E8F0", whiteSpace: "nowrap" }}>
                      {pivotRow === "band" ? REGISTER_BAND_LABELS[rk] : rk}
                    </td>
                    {pivot.colKeys.map((ck) => {
                      const cell = pivot.cells[rk]?.[ck];
                      if (!cell) {
                        return <td key={ck} style={{ textAlign: "right", padding: "5px 10px", color: "#94A3B8", borderBottom: "1px solid #E2E8F0" }}>—</td>;
                      }
                      const avg = cell.sum / cell.count;
                      const color = pivotMetric === "pitchCents" ? pitchCellColor(avg) : "#0F172A";
                      return (
                        <td key={ck} title={`${cell.count}フレーム`} style={{ textAlign: "right", padding: "5px 10px", color, fontWeight: 600, borderBottom: "1px solid #E2E8F0", whiteSpace: "nowrap" }}>
                          {metricDef.fmt(avg)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sans" style={{ fontSize: 9, color: "#94A3B8", marginTop: 8 }}>
              セルにカーソルを合わせると集計フレーム数を表示します。ピッチ偏差は ±10¢未満=緑 / ±25¢未満=橙 / それ以上=赤 で色分けしています
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
