import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Mic, Square, Wind, Trash2, ChevronDown, ChevronUp, Upload, Pencil } from "lucide-react";

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

// 運指の半音インデックスから音域帯(low/mid/high)を判定する簡易分類(分析タブのクロス集計で使用)
function registerBand(semitoneIndex, lowMax = 12, midMax = 24) {
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
    g.members.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
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

  const deleteSession = useCallback((id) => {
    setSessionsState((prev) => prev.filter((s) => s.id !== id));
    idbDeleteSessions([id]);
  }, []);

  return [sessions, addSession, updateSessions, deleteSession];
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
  const NOTE_ONSET_DB = -45;
  const NOTE_RELEASE_DB = -55;
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

// AudioBufferを直接デコードできた場合の高速パス。OfflineAudioContextでレンダリングすることで、
// 実時間再生を待たずCPUが処理できる速さでそのまま解析を完了できる
// (体感、ファイル長に関わらず数秒程度)。AnalyserNodeの読み出しは
// ScriptProcessorNodeのonaudioprocessで駆動し、経過時間はoffline側コンテキストのcurrentTimeを使う。
function analyzeAudioBuffer(audioBuffer, opts) {
  const { onProgress } = opts;
  const FFT_SIZE = 8192;
  const PROCESSOR_BUFFER_SIZE = 1024; // 約23ms(44.1kHz時)ごとにonaudioprocessが発火
  const fa = createFrameAnalyzer(opts);

  const offlineCtx = new OfflineAudioContext(audioBuffer.numberOfChannels, audioBuffer.length, audioBuffer.sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  const analyser = offlineCtx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.6;
  const processor = offlineCtx.createScriptProcessor(PROCESSOR_BUFFER_SIZE, audioBuffer.numberOfChannels, 1);
  source.connect(analyser);
  analyser.connect(processor);
  processor.connect(offlineCtx.destination);

  processor.onaudioprocess = () => {
    const elapsedMs = offlineCtx.currentTime * 1000; // レンダリング位置=音声内の経過時間
    fa.tick(analyser, offlineCtx.sampleRate, elapsedMs);
    if (onProgress) onProgress(Math.min(1, elapsedMs / 1000 / audioBuffer.duration));
  };

  source.start();
  return offlineCtx.startRendering().then(() => {
    processor.onaudioprocess = null;
    return { frames: fa.frames, noteEvents: fa.noteEvents };
  });
}

// decodeAudioDataでデコードできなかったファイル(動画コンテナ等、ブラウザによっては
// 音声トラックの取り出しに対応しないことがある)向けのフォールバック。
// 実際に<video>要素で再生し、MediaElementAudioSourceNode経由でtickにかける。
// オフライン処理ができないため、解析にはファイルの再生時間と同じだけ実時間がかかる。
function analyzeMediaFile(file, opts) {
  const { onProgress } = opts;
  const FFT_SIZE = 8192;
  const fa = createFrameAnalyzer(opts);

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const mediaEl = document.createElement("video"); // 音声のみのファイルも<video>要素で再生可能
    mediaEl.src = url;
    mediaEl.muted = true; // 実際の音は出さず解析だけ行う(AnalyserNodeへの経路は別途destinationに無音接続)
    mediaEl.preload = "auto";

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.6;
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;

    let rafId;
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (rafId) cancelAnimationFrame(rafId);
      try { audioCtx.close(); } catch { /* noop */ }
      URL.revokeObjectURL(url);
    };

    mediaEl.onerror = () => {
      cleanup();
      reject(new Error("この形式のファイルは読み込めませんでした"));
    };

    mediaEl.onloadedmetadata = () => {
      let sourceNode;
      try {
        sourceNode = audioCtx.createMediaElementSource(mediaEl);
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }
      sourceNode.connect(analyser);
      analyser.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      const startTime = performance.now();
      const duration = mediaEl.duration || 0;

      const finish = () => {
        cleanup();
        resolve({ frames: fa.frames, noteEvents: fa.noteEvents });
      };

      const tick = () => {
        if (finished) return;
        const elapsedMs = performance.now() - startTime;
        fa.tick(analyser, audioCtx.sampleRate, elapsedMs);
        if (onProgress && duration) onProgress(Math.min(1, elapsedMs / 1000 / duration));
        if (mediaEl.ended) { finish(); return; }
        rafId = requestAnimationFrame(tick);
      };

      mediaEl.onended = finish;
      mediaEl.play().then(() => {
        rafId = requestAnimationFrame(tick);
      }).catch((err) => {
        cleanup();
        reject(err);
      });
    };
  });
}

// ============================================================
// Main component
// ============================================================
export default function WindToneLabPhaseMode() {
  const [topTab, setTopTab] = useState("measure"); // "measure" | "reeds" | "analysis"
  const [reedsSubTab, setReedsSubTab] = useState("register"); // 「リード」タブ内の子タブ: register | data
  // isListening: マイク+ライブ表示が有効か(計測タブ滞在中は自動でON/OFF)。
  // isRecording: 録音ボタンで蓄積中かどうか(セッションとして保存されるのはこの間のフレームのみ)。
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
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
  const [tuningHz, setTuningHz] = usePersistedState("tuningHz", 442); // 基準ピッチ: 435〜445Hzのスライダー、デフォルト442Hz
  const [instrumentOffsetCents, setInstrumentOffsetCents] = usePersistedState("instrumentOffsetCents", 0); // 楽器個体差の補正(セント)。運指テーブル全体をシフトする(企画書3節末尾の注記への対応)
  const [showIdeal, setShowIdeal] = useState(true);

  // 理想値プロファイルは「撮りためたデータ」の中核のひとつのため永続化する
  const [idealProfiles, setIdealProfiles] = usePersistedState("idealProfiles", []);
  const [selectedIdealId, setSelectedIdealId] = usePersistedState("selectedIdealId", null);

  // --- 運指ベース管長自動キャリブレーション state ---
  const [matchedFingering, setMatchedFingering] = useState(null); // 直近フレームで判定された運指(理論値計算の基準に使う)

  // --- 録音結果の時系列データ(単音/フレーズの区別はnoteEvents数から事後判定する) ---
  // タイムライン表示切替・ドリルダウン選択の状態はPhraseTimelineコンポーネント内にローカル化した
  const [phraseFrames, setPhraseFrames] = useState([]); // データ構造は企画書3節のframesに準拠

  // --- リード管理 state (企画書v5 10節) ---
  // reeds/sessionsは練習を重ねるほど価値が増す蓄積データのため、IndexedDBに永続化する(usePersistedState)
  const [reeds, setReeds] = usePersistedState("reeds", []); // リードマスタ一覧
  const [sessions, addSession, updateSessions, deleteSession] = useSessionsStore(); // 録音セッション一覧(reedIdで紐付け、10.5節のsessionWithReedに準拠。レコード単位で永続化)
  const [selectedReedId, setSelectedReedId] = usePersistedState("selectedReedId", null); // 録音前に選択する「今回使うリード」
  const [pendingLinkSessionId, setPendingLinkSessionId] = useState(null); // 事後紐付け対象のセッション
  const [sessionMemo, setSessionMemo] = useState(""); // 録音前に入力する「何を試したか」の自由記述メモ

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
  // memoは「何を変えて試したか」を残す自由記述(例: マウスピース変更・アンブシュア調整など)。次回録音に向けてリセットする。
  const finalizeRecording = useCallback(() => {
    if (phraseFramesRef.current.length > 0) {
      const session = {
        id: generateId(),
        recordedAt: new Date().toISOString(),
        saxType,
        reedId: selectedReedId,
        linkedAt: selectedReedId ? "eager" : null,
        memo: sessionMemo.trim() || null,
        performer: selectedPerformer,
        source: "live",
        frames: phraseFramesRef.current,
        noteEvents: noteDetectorRef.current.events, // ノート区間分割・アタック時間(企画書2.4節・4節のnoteEvents)
      };
      addSession(session);
      setSessionMemo("");
    }
  }, [saxType, selectedReedId, sessionMemo, selectedPerformer, addSession]);

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
        if (f0 && f0 > 40) {
          setPitch(f0);
          setNote(freqToNote(f0));

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
      console.error("getUserMedia failed:", err.name, err.message, err);
      const hints = {
        NotAllowedError: "マイクへのアクセスが拒否されています。ブラウザのアドレスバー付近のマイクアイコン、またはサイト設定から許可してください。",
        NotFoundError: "マイクデバイスが見つかりません。PCにマイクが接続されているか確認してください。",
        NotReadableError: "マイクが他のアプリで使用中の可能性があります。他のアプリ（Zoom等）を閉じて再試行してください。",
        SecurityError: "この接続はマイクアクセスに必要なセキュア(HTTPS/localhost)条件を満たしていません。",
      };
      setErrorMsg(`マイクにアクセスできませんでした [${err.name}]: ${hints[err.name] || err.message}`);
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
    if (topTab === "measure") {
      startListeningRef.current();
    } else {
      stopListeningRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          memo: sessionMemo.trim() || null,
          performer: selectedPerformer,
          source: "upload",
          sourceFileName: file.name,
          frames,
          noteEvents,
        };
        addSession(session);
        setSessionMemo("");
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
  }, [saxType, tuningHz, instrumentOffsetCents, temperature, selectedIdeal, selectedReedId, sessionMemo, selectedPerformer, addSession, isAnalyzingUpload]);

  const deleteIdealProfile = (id) => {
    setIdealProfiles((prev) => prev.filter((p) => p.id !== id));
    if (selectedIdealId === id) setSelectedIdealId(null);
  };

  const centsOffset = note ? note.cents : 0;
  const needleRotation = Math.max(-50, Math.min(50, centsOffset)) * 0.9;

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
            onClick={() => { if (!isRecording) setTopTab(t.key); }}
            disabled={isRecording}
            className="sans"
            style={{
              flex: 1, padding: "9px 4px", borderRadius: 7, border: "none",
              background: topTab === t.key ? "#EFF6FF" : "transparent",
              color: topTab === t.key ? "#2563EB" : "#64748B",
              fontWeight: topTab === t.key ? 600 : 400, fontSize: 12,
              cursor: isRecording ? "default" : "pointer", opacity: isRecording && topTab !== t.key ? 0.4 : 1,
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
          isRecording={isRecording} toggleRecording={toggleRecording}
          note={note} pitch={pitch} needleRotation={needleRotation} centsOffset={centsOffset}
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
          sessionMemo={sessionMemo} setSessionMemo={setSessionMemo}
          performers={performers} selectedPerformer={selectedPerformer}
          setSelectedPerformer={setSelectedPerformer} setPerformers={setPerformers}
          phraseFrames={phraseFrames} phraseNoteEvents={phraseNoteEvents}
          promoteSessionToIdeal={promoteSessionToIdeal} sessions={sessions}
          handleUploadFile={handleUploadFile} isAnalyzingUpload={isAnalyzingUpload}
          uploadProgress={uploadProgress} lastUploadedSession={lastUploadedSession}
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
      {topTab === "analysis" && (
        <AnalysisLabView
          sessions={sessions} reeds={reeds} selectedIdeal={selectedIdeal}
          promoteSessionToIdeal={promoteSessionToIdeal}
          idealProfiles={idealProfiles} selectedIdealId={selectedIdealId} setSelectedIdealId={setSelectedIdealId}
          NUM_HARMONICS={NUM_HARMONICS}
          updateSessions={updateSessions} deleteSession={deleteSession}
          performers={performers} setPerformers={setPerformers}
        />
      )}
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
    isRecording, toggleRecording, note, pitch, needleRotation, centsOffset, spectrumBars,
    harmonicLevels, theoreticalHarmonics, showIdeal, setShowIdeal,
    selectedIdeal, volumeDb, centroidHz, hnrDb, saxType, setSaxType, temperature, setTemperature,
    tuningHz, setTuningHz, matchedFingering,
    idealProfiles, selectedIdealId, setSelectedIdealId, deleteIdealProfile, NUM_HARMONICS,
    reeds, selectedReedId, setSelectedReedId, sessionMemo, setSessionMemo,
    performers, selectedPerformer, setSelectedPerformer, setPerformers,
    phraseFrames, phraseNoteEvents, promoteSessionToIdeal, sessions,
    handleUploadFile, isAnalyzingUpload, uploadProgress, lastUploadedSession,
  } = props;

  const selectedReed = reeds?.find((r) => r.id === selectedReedId) || null;
  // 理想値は音(運指)ごとに持つため、今演奏している音に対応する理想値を都度引く
  const currentNoteIdeal = getNoteIdeal(selectedIdeal, matchedFingering?.semitoneIndex);
  const fileInputRef = useRef(null);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* 使用リード選択(企画書v5 10.3節: 事前選択) + 奏者選択 */}
      <div className="sans" style={{ fontSize: 11, marginBottom: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#64748B" }}>使用リード:</span>
        <select value={selectedReedId || ""} onChange={(e) => setSelectedReedId(e.target.value || null)} disabled={isRecording}>
          <option value="">未選択(後で紐付け可能)</option>
          {(reeds || []).map((r) => (<option key={r.id} value={r.id}>{reedLabel(r, reeds)}</option>))}
        </select>
        {selectedReed && <span style={{ color: "#2563EB", fontSize: 10 }}>選択中: {reedLabel(selectedReed, reeds)}</span>}
        {(!reeds || reeds.length === 0) && <span style={{ color: "#94A3B8", fontSize: 10 }}>「リード」タブでリードを登録できます</span>}
        <span style={{ color: "#64748B", marginLeft: 8 }}>奏者:</span>
        <PerformerSelector
          performers={performers} selectedPerformer={selectedPerformer}
          setSelectedPerformer={setSelectedPerformer} setPerformers={setPerformers}
          disabled={isRecording}
        />
      </div>

      {/* 何を変えて試したかのメモ(自由記述)。何を変えたら何が変わったかを後から追いやすくする */}
      <div className="sans" style={{ fontSize: 11, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "#64748B", flexShrink: 0 }}>メモ:</span>
        <input
          type="text" placeholder="何を試したか(例: マウスピース変更・アンブシュアを緩めた 等)"
          value={sessionMemo} onChange={(e) => setSessionMemo(e.target.value)} disabled={isRecording}
          className="sans"
          style={{ flex: 1, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, padding: "6px 10px", color: "#0F172A", fontSize: 11 }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        {isRecording ? (
          <div className="sans" style={{ fontSize: 11, color: "#2563EB", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, background: "#DC2626", borderRadius: "50%", display: "inline-block", animation: "pulse 1s infinite" }} />
            録音中 · {phraseFrames.length}フレーム
            {phraseNoteEvents.length > 0 && <span style={{ color: "#64748B", marginLeft: 6 }}>· {phraseNoteEvents.length}ノート</span>}
          </div>
        ) : <span />}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={fileInputRef} type="file" accept="audio/*,video/*" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); e.target.value = ""; }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isRecording || isAnalyzingUpload}
            className="sans"
            style={{ display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", color: "#2563EB", border: "1.5px solid #2563EB", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: isRecording || isAnalyzingUpload ? "default" : "pointer", opacity: isRecording || isAnalyzingUpload ? 0.5 : 1 }}
          >
            <Upload size={14} />
            {isAnalyzingUpload ? "解析中…" : "アップロード"}
          </button>
          <button onClick={toggleRecording} className="sans" style={{ display: "flex", alignItems: "center", gap: 6, background: isRecording ? "#DC2626" : "#2563EB", color: "#F8FAFC", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {isRecording ? <Square size={14} /> : <Mic size={14} />}
            {isRecording ? "停止" : "録音"}
          </button>
        </div>
      </div>
      <div className="sans" style={{ fontSize: 9, color: "#94A3B8", textAlign: "right", marginBottom: 8 }}>
        wav/mp3/m4a等の音声ファイルに加え、スマホのボイスメモや動画(mp4/mov等)もアップロードできます
      </div>

      {/* 音声ファイルのアップロード解析中/完了(ライブ録音と同じ解析パイプラインを通す。ファイルの長さと同じだけ時間がかかる) */}
      {isAnalyzingUpload && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ background: "#F1F5F9", borderRadius: 4, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${Math.round(uploadProgress * 100)}%`, height: "100%", background: "#2563EB", borderRadius: 4, transition: "width 0.2s linear" }} />
          </div>
          <div className="sans" style={{ fontSize: 9, color: "#64748B", marginTop: 4 }}>{Math.round(uploadProgress * 100)}%</div>
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
          <span>倍音構成（実測 / 理想）</span>
          <div style={{ display: "flex", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={showIdeal} onChange={(e) => setShowIdeal(e.target.checked)} /> 理想</label>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 130, paddingTop: 14 }}>
          {Array.from({ length: NUM_HARMONICS }).map((_, idx) => {
            const n = idx + 1;
            const measured = harmonicLevels.find((h) => h.n === n);
            const measuredHeight = measured ? measured.norm * 100 : 0;
            const theoHarmonic = theoreticalHarmonics[idx];
            const idealHarmonic = currentNoteIdeal?.harmonicsProfile?.find((h) => h.n === n);
            const idealHeight = idealHarmonic ? idealHarmonic.norm * 100 : 0;
            return (
              <div key={n} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
                <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, position: "relative" }}>
                  <div style={{ width: "38%", height: `${measuredHeight}%`, background: measured ? "#2563EB" : "transparent", borderRadius: "3px 3px 0 0", minHeight: measured ? 3 : 0, transition: "height 0.1s ease-out" }} />
                  {showIdeal && currentNoteIdeal && (<div style={{ width: "28%", height: `${idealHeight}%`, border: idealHarmonic ? "1.5px dashed #94A3B8" : "none", borderBottom: "none", borderRadius: "3px 3px 0 0", minHeight: idealHarmonic ? 3 : 0, opacity: 0.85, boxSizing: "border-box" }} />)}
                </div>
                <div className="sans" style={{ fontSize: 9, color: "#64748B", marginTop: 4 }}>{n}倍</div>
                <div className="sans" style={{ fontSize: 8, color: "#94A3B8" }}>{theoHarmonic ? `${Math.round(theoHarmonic.freq)}Hz` : "—"}</div>
              </div>
            );
          })}
        </div>
        <div className="sans" style={{ fontSize: 9, color: "#64748B", marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "#2563EB", borderRadius: 2, display: "inline-block" }} />実測</span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, border: "1.5px dashed #94A3B8", borderRadius: 2, display: "inline-block" }} />理想{selectedIdeal ? `: ${selectedIdeal.name}` : "(未選択)"}</span>
        </div>
        {selectedIdeal && (
          <div className="sans" style={{ fontSize: 9, color: "#94A3B8", marginTop: 6 }}>
            {matchedFingering
              ? currentNoteIdeal
                ? `記音${matchedFingering.writtenLabel}の理想値と比較中`
                : `記音${matchedFingering.writtenLabel}はこのプロファイルに未登録です`
              : "音を検出すると、その音に対応する理想値と比較します"}
          </div>
        )}
      </div>

      {/* 補助指標 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
        <MetricCard label="音量" value={`${volumeDb.toFixed(1)} dB`} sub={currentNoteIdeal ? `理想: ${currentNoteIdeal.volumeDb?.toFixed(1)} dB` : null} />
        <MetricCard label="スペクトル重心" value={`${Math.round(centroidHz)} Hz`} sub={currentNoteIdeal ? `理想: ${Math.round(currentNoteIdeal.centroidHz)} Hz` : null} />
        <MetricCard label="HNR" value={hnrDb !== null ? `${hnrDb.toFixed(1)} dB` : "—"} sub={currentNoteIdeal?.hnrDb != null ? `理想: ${currentNoteIdeal.hnrDb.toFixed(1)} dB` : null} />
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

        <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
          <span>基準ピッチ</span>
          <span style={{ color: "#2563EB", fontWeight: 600 }}>{tuningHz} Hz</span>
        </div>
        <input
          type="range" min={435} max={445} step={1} value={tuningHz}
          onChange={(e) => setTuningHz(Number(e.target.value))}
          style={{ width: "100%" }}
        />
        <div className="sans" style={{ fontSize: 9, color: "#94A3B8", display: "flex", justifyContent: "space-between", marginTop: 2 }}>
          <span>435 Hz</span>
          <span>445 Hz</span>
        </div>

        {/* 理想値プロファイル選択(作成は録音後の「理想値に設定」ボタンから行う) */}
        {idealProfiles.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
            <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 6 }}>理想値プロファイル</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {idealProfiles.map((p) => (
                <div key={p.id} onClick={() => setSelectedIdealId(p.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", borderRadius: 6, cursor: "pointer", border: selectedIdealId === p.id ? "1.5px solid #2563EB" : "1px solid #E2E8F0", background: selectedIdealId === p.id ? "#EFF6FF" : "transparent" }}>
                  <div className="sans" style={{ fontSize: 11, color: selectedIdealId === p.id ? "#2563EB" : "#0F172A" }}>{p.name}<span style={{ fontSize: 9, color: "#64748B", marginLeft: 6 }}>{SAX_PRESETS[p.saxType]?.label}</span></div>
                  <button onClick={(e) => { e.stopPropagation(); deleteIdealProfile(p.id); }} style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", padding: 4 }}><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 録音データグラフ(時間変化のタイムライン)。単音でも音の立ち上がり等の変化があるため常に表示する */}
      {phraseFrames.length > 0 && (
        <PhraseTimeline
          frames={phraseFrames} noteEvents={phraseNoteEvents} selectedIdeal={selectedIdeal}
          idealProfiles={idealProfiles} selectedIdealId={selectedIdealId} setSelectedIdealId={setSelectedIdealId}
          NUM_HARMONICS={NUM_HARMONICS} sessions={sessions}
        />
      )}
    </div>
  );
}

// フレーズのタイムライン+ドリルダウン表示。計測タブ(ライブ直後)とセッション詳細(履歴)の両方から使う共通コンポーネント。
function PhraseTimeline({ frames, noteEvents, selectedIdeal, idealProfiles, selectedIdealId, setSelectedIdealId, NUM_HARMONICS, sessions, ownSessionId }) {
  const [timelineFormat, setTimelineFormat] = useState("line");
  const [timelineMetric, setTimelineMetric] = useState("pitch");
  const [matchBasis, setMatchBasis] = useState("theoretical");
  const [selectedFrameIdx, setSelectedFrameIdx] = useState(null);
  // 比較対象: 音ごとの理想値プロファイル、または「お手本セッション」を選んで演奏全体を時間軸で重ねて比較する
  const [compareMode, setCompareMode] = useState("ideal"); // "ideal" | "session"
  const [referenceSessionId, setReferenceSessionId] = useState(null);
  const timelineScrollRef = useRef(null);

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
    if (compareMode === "session") {
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

  // 比較対象(音ごとの理想値、またはお手本セッションの対応フレーム)は都度引き直してスコアを再計算する。
  // これにより、あとから理想値やお手本の選択を変えても、各瞬間ごとに正しい基準と比較できる。
  // 理論値基準は録音時の値のまま使う。
  const getMatchScore = (frame, kind) => {
    if (kind === "pitch" && matchBasis === "theoretical") {
      return frame.matchScore?.pitch?.theoretical ?? 0;
    }
    const target = getComparisonTarget(frame);
    if (!target) return 0;
    if (kind === "timbre") {
      const harmNorm = frame.harmonics?.length === NUM_HARMONICS ? frame.harmonics.map((h) => h.levelNorm) : new Array(NUM_HARMONICS).fill(0);
      const idealHarmNorm = target.harmonicsProfile ? target.harmonicsProfile.map((h) => h.norm) : new Array(NUM_HARMONICS).fill(0);
      return timbreMatchScore(harmNorm, idealHarmNorm, frame.spectralCentroidHz, target.centroidHz, frame.hnrDb, target.hnrDb);
    }
    // kind === "pitch" && matchBasis === "ideal"
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
      {/* 比較対象の選択: 音ごとの理想値プロファイル、またはお手本セッション(自動アライメント比較) */}
      <div className="sans" style={{ fontSize: 11, margin: "10px 0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#64748B" }}>比較対象:</span>
        <select value={compareMode} onChange={(e) => setCompareMode(e.target.value)}>
          <option value="ideal">理想値プロファイル</option>
          <option value="session">お手本セッション</option>
        </select>
        {compareMode === "ideal" && idealProfiles && idealProfiles.length > 0 && (
          <select value={selectedIdealId || ""} onChange={(e) => setSelectedIdealId(e.target.value || null)}>
            <option value="">未選択</option>
            {idealProfiles.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
        )}
        {compareMode === "session" && (
          <select value={referenceSessionId || ""} onChange={(e) => setReferenceSessionId(e.target.value || null)}>
            <option value="">お手本セッションを選択</option>
            {referenceCandidates.map((s) => (
              <option key={s.id} value={s.id}>{new Date(s.recordedAt).toLocaleString("ja-JP")}{s.memo ? ` 「${s.memo}」` : ""}</option>
            ))}
          </select>
        )}
        {compareMode === "session" && referenceSession && (
          <span style={{ color: "#94A3B8", fontSize: 9 }}>最初の発音タイミングを基準に自動で位置合わせして比較します</span>
        )}
      </div>
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
            <option value="ideal">{compareMode === "session" ? "お手本セッション" : `理想値${selectedIdeal ? `(${selectedIdeal.name})` : ""}`}</option>
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
          {noteEvents?.length > 0 && (() => {
            const attacks = noteEvents.map((e) => e.attackTimeMs).filter((v) => v !== null);
            const avg = attacks.length ? Math.round(attacks.reduce((a, b) => a + b, 0) / attacks.length) : null;
            return <span style={{ marginLeft: 8 }}>｜ 検出ノート {noteEvents.length}{avg !== null ? ` ・ 平均アタック ${avg}ms` : ""}</span>;
          })()}
        </div>
        <div ref={timelineScrollRef} style={{ overflowX: "auto" }}>
          <svg width={Math.max(600, frames.length * 6)} height="120" style={{ display: "block" }}>
            {timelineFormat === "line" ? (
              <polyline
                fill="none" stroke="#2563EB" strokeWidth="1.5"
                points={frames.map((f, i) => {
                  const v = getMetricValue(f);
                  const y = v !== null && v !== undefined && !isNaN(v) ? 100 - ((v - minV) / range) * 90 : 100;
                  return `${i * 6},${y}`;
                }).join(" ")}
              />
            ) : null}
            {frames.map((f, i) => {
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
          type="range" min={0} max={frames.length - 1}
          value={selectedFrameIdx ?? 0}
          onChange={(e) => setSelectedFrameIdx(Number(e.target.value))}
          style={{ width: "100%", marginTop: 8 }}
        />
        <div className="sans" style={{ fontSize: 9, color: "#94A3B8", display: "flex", justifyContent: "space-between" }}>
          <span>0s</span>
          <span>{frames[frames.length - 1]?.t.toFixed(1)}s</span>
        </div>
      </div>

      {/* ドリルダウン: 選択フレームの詳細 */}
      {selectedFrame && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "14px" }}>
          <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 10 }}>
            t = {selectedFrame.t.toFixed(2)}s の詳細
          </div>

          {(() => {
            const target = getComparisonTarget(selectedFrame);
            const noTargetLabel = compareMode === "session" ? "対応するお手本の瞬間がありません" : "この音の理想値が未登録";
            return (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                  <MetricCard label="音高一致度" value={`${Math.round(getMatchScore(selectedFrame, "pitch") * 100)}%`} sub={selectedFrame.pitchHz ? `${selectedFrame.pitchHz.toFixed(1)} Hz ／ 記音${selectedFrame.matchedWrittenNote ?? "—"}` : "—"} accentColor={scoreToColor(getMatchScore(selectedFrame, "pitch"))} />
                  <MetricCard label="音色一致度(比較対象基準)" value={target ? `${Math.round(getMatchScore(selectedFrame, "timbre") * 100)}%` : "—"} sub={target ? `重心 ${Math.round(selectedFrame.spectralCentroidHz)}Hz` : noTargetLabel} accentColor={target ? scoreToColor(getMatchScore(selectedFrame, "timbre")) : undefined} />
                </div>

                {/* 倍音構成バー(ドリルダウン表示) */}
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100, paddingTop: 10 }}>
                  {Array.from({ length: NUM_HARMONICS }).map((_, idx) => {
                    const n = idx + 1;
                    const measured = selectedFrame.harmonics?.find((h) => h.n === n);
                    const measuredHeight = measured ? measured.levelNorm * 100 : 0;
                    const targetHarmonic = target?.harmonicsProfile?.find((h) => h.n === n);
                    const targetHeight = targetHarmonic ? targetHarmonic.norm * 100 : 0;
                    return (
                      <div key={n} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
                        <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, position: "relative" }}>
                          <div style={{ width: "38%", height: `${measuredHeight}%`, background: "#2563EB", borderRadius: "3px 3px 0 0", minHeight: measured ? 3 : 0 }} />
                          {target && (<div style={{ width: "28%", height: `${targetHeight}%`, background: targetHarmonic ? "#94A3B8" : "transparent", borderRadius: "3px 3px 0 0", minHeight: targetHarmonic ? 3 : 0, opacity: 0.85 }} />)}
                        </div>
                        <div className="sans" style={{ fontSize: 8, color: "#64748B", marginTop: 3 }}>{n}倍</div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}

          <div className="sans" style={{ fontSize: 9, color: "#64748B", marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
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
          style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, padding: "5px 8px", color: "#0F172A", fontSize: 11, width: 130 }}
        />
        <button onClick={confirm} className="sans" style={{ fontSize: 10, padding: "5px 8px", borderRadius: 5, border: "none", background: "#2563EB", color: "#F8FAFC", cursor: "pointer" }}>保存</button>
        <button onClick={() => { setIsNaming(false); setName(""); }} style={{ background: "none", border: "none", color: "#94A3B8", cursor: "pointer", fontSize: 12 }}>×</button>
      </div>
    );
  }

  return (
    <button onClick={() => setIsNaming(true)} className="sans" style={{ fontSize: 10, padding: "5px 10px", borderRadius: 5, border: "1px solid #2563EB", background: "#EFF6FF", color: "#2563EB", cursor: "pointer", fontWeight: 600 }}>
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
          style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, padding: "5px 8px", color: "#0F172A", fontSize: 11, width: 110 }}
        />
        <button onClick={confirmAdd} className="sans" style={{ fontSize: 10, padding: "5px 8px", borderRadius: 5, border: "none", background: "#2563EB", color: "#F8FAFC", cursor: "pointer" }}>追加</button>
        <button onClick={() => { setIsAdding(false); setAddingName(""); }} style={{ background: "none", border: "none", color: "#94A3B8", cursor: "pointer", fontSize: 12 }}>×</button>
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

  const deleteReed = (id) => {
    setReeds((prev) => prev.filter((r) => r.id !== id));
    updateSessions((prev) => prev.map((s) => (s.reedId === id ? { ...s, reedId: null, linkedAt: null } : s)));
  };

  const rateReed = (id, rating) => {
    setReeds((prev) => prev.map((r) => (r.id === id ? { ...r, rating } : r)));
  };

  // 登録済みリードの銘柄・番手・番号(箱内の通し番号)をその場で修正できるようにする。
  // 番号は自動採番(登録順)を手動で上書きするためのフィールド(reedPositionが優先的に参照する)。
  const [editingReedId, setEditingReedId] = useState(null);
  const [editForm, setEditForm] = useState({ brand: "", strength: "", boxNumber: 1 });

  const startEditReed = (r) => {
    setEditingReedId(r.id);
    setEditForm({ brand: r.brand, strength: r.strength, boxNumber: reedPosition(r, reeds) ?? 1 });
  };

  const saveEditReed = () => {
    const brand = editForm.brand.trim();
    if (!brand) return;
    setReeds((prev) => prev.map((r) => (
      r.id === editingReedId
        ? { ...r, brand, strength: editForm.strength, boxNumber: Number(editForm.boxNumber) || null }
        : r
    )));
    setEditingReedId(null);
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
  const [evaluatingReedId, setEvaluatingReedId] = useState(null); // タップした登録済みリードの評価詳細を表示

  const evaluatingReed = reeds.find((r) => r.id === evaluatingReedId) || null;
  if (evaluatingReed) {
    return (
      <ReedEvaluationDetail
        reed={evaluatingReed} reeds={reeds} sessions={sessions}
        onBack={() => setEvaluatingReedId(null)}
      />
    );
  }

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
            1枚ずつ追加
          </button>
          <select value={bulkCount} onChange={(e) => setBulkCount(Number(e.target.value))} style={{ flexShrink: 0 }}>
            {Array.from({ length: REED_BOX_SIZE }, (_, i) => i + 1).map((n) => (<option key={n} value={n}>{n}枚</option>))}
          </select>
          <button
            onClick={() => registerReeds(bulkCount)}
            disabled={newBrand === "__custom__" && !customBrand.trim()}
            className="sans"
            style={{ flex: 1, padding: "9px 4px", borderRadius: 6, border: "none", background: "#2563EB", color: "#F8FAFC", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >
            まとめて追加
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
                      {g.members.map((r, idx) => {
                        if (editingReedId === r.id) {
                          return (
                            <div
                              key={r.id}
                              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0", borderBottom: idx < g.members.length - 1 ? "1px solid #F1F5F9" : "none", flexWrap: "wrap" }}
                            >
                              <input
                                type="text" value={editForm.brand}
                                onChange={(e) => setEditForm((f) => ({ ...f, brand: e.target.value }))}
                                className="sans"
                                style={{ width: 110, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, padding: "5px 8px", color: "#0F172A", fontSize: 11 }}
                              />
                              <select value={editForm.strength} onChange={(e) => setEditForm((f) => ({ ...f, strength: e.target.value }))}>
                                {REED_STRENGTHS.map((s) => (<option key={s} value={s}>{s}</option>))}
                              </select>
                              <span className="sans" style={{ fontSize: 9, color: "#64748B" }}>番号:</span>
                              <input
                                type="number" min={1} value={editForm.boxNumber}
                                onChange={(e) => setEditForm((f) => ({ ...f, boxNumber: e.target.value }))}
                                className="sans"
                                style={{ width: 48, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, padding: "5px 8px", color: "#0F172A", fontSize: 11 }}
                              />
                              <button
                                onClick={saveEditReed}
                                className="sans"
                                style={{ fontSize: 9, padding: "4px 10px", borderRadius: 5, border: "none", background: "#2563EB", color: "#F8FAFC", cursor: "pointer", fontWeight: 600 }}
                              >
                                保存
                              </button>
                              <button
                                onClick={() => setEditingReedId(null)}
                                className="sans"
                                style={{ fontSize: 9, padding: "4px 10px", borderRadius: 5, border: "1px solid #E2E8F0", background: "transparent", color: "#64748B", cursor: "pointer" }}
                              >
                                キャンセル
                              </button>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={r.id}
                            onClick={() => setEvaluatingReedId(r.id)}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: idx < g.members.length - 1 ? "1px solid #F1F5F9" : "none", cursor: "pointer" }}
                          >
                            <span className="sans" style={{ fontSize: 10, fontWeight: 700, color: "#0F172A", width: 22, flexShrink: 0 }}>#{reedPosition(r, reeds) ?? idx + 1}</span>
                            <span onClick={(e) => e.stopPropagation()}>
                              <StarRating value={r.rating} onChange={(v) => rateReed(r.id, v)} size={11} />
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); goToMeasure(r.id); }}
                              className="sans"
                              style={{ fontSize: 9, padding: "4px 10px", borderRadius: 5, border: "1px solid #2563EB", background: "#EFF6FF", color: "#2563EB", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}
                            >
                              測定へ
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); startEditReed(r); }} style={{ background: "none", border: "none", color: "#94A3B8", cursor: "pointer", padding: 2, marginLeft: "auto", flexShrink: 0 }}><Pencil size={12} /></button>
                            <button onClick={(e) => { e.stopPropagation(); deleteReed(r.id); }} style={{ background: "none", border: "none", color: "#94A3B8", cursor: "pointer", padding: 2, flexShrink: 0 }}><Trash2 size={12} /></button>
                          </div>
                        );
                      })}
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

function DataAnalysisView(props) {
  const { reeds, sessions, selectedIdeal } = props;

  const [subTab, setSubTab] = useState("compare"); // compare | ranking
  const [compareReedIds, setCompareReedIds] = useState([]);

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
      <div style={{ display: "flex", gap: 6, background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: 4, marginBottom: 10 }}>
        {[
          { key: "compare", label: "リード別比較" },
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
                    #{r.boxNumber ?? idx + 1}
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
// 1項目分の折れ線グラフ(セッション毎の推移)
function MetricLineChart({ metricDef, points }) {
  const validPoints = points.filter((p) => p[metricDef.key] !== null && p[metricDef.key] !== undefined);
  const vals = validPoints.map((p) => p[metricDef.key]);
  const minV = vals.length ? Math.min(...vals) : 0;
  const maxV = vals.length ? Math.max(...vals) : 1;
  const range = maxV - minV || 1;

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 6 }}>
        {metricDef.label}の推移{metricDef.unit ? `（${metricDef.unit}）` : ""}
      </div>
      {validPoints.length === 0 ? (
        <div className="sans" style={{ fontSize: 10, color: "#94A3B8" }}>データがありません</div>
      ) : (
        <>
          <svg width="100%" height="90" viewBox={`0 0 ${Math.max(300, validPoints.length * 60)} 90`} style={{ display: "block" }}>
            <polyline
              fill="none" stroke="#2563EB" strokeWidth="2"
              points={validPoints.map((p, i) => {
                const x = i * 60 + 30;
                const y = 70 - ((p[metricDef.key] - minV) / range) * 55;
                return `${x},${y}`;
              }).join(" ")}
            />
            {validPoints.map((p, i) => {
              const x = i * 60 + 30;
              const y = 70 - ((p[metricDef.key] - minV) / range) * 55;
              return <circle key={i} cx={x} cy={y} r={3.5} fill="#2563EB" />;
            })}
          </svg>
          <div className="sans" style={{ fontSize: 9, color: "#64748B", display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
            {validPoints.map((p, i) => (
              <span key={i} title={p.memo || undefined}>
                {new Date(p.date).toLocaleDateString("ja-JP")}: {metricDef.fmt(p[metricDef.key])}
                {p.memo && <span style={{ color: "#2563EB" }}> 「{p.memo}」</span>}
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
function ReedEvaluationDetail({ reed, reeds, sessions, onBack }) {
  const reedSessions = sessions
    .filter((s) => s.reedId === reed.id)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  const points = reedSessions.map((s) => {
    const frames = s.frames || [];
    return { date: s.recordedAt, frameCount: frames.length, memo: s.memo, ...computeFrameMetrics(frames) };
  });

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <button
        onClick={onBack}
        className="sans"
        style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#2563EB", fontSize: 11, marginBottom: 10, cursor: "pointer", padding: 0 }}
      >
        <ChevronDown size={13} style={{ transform: "rotate(90deg)" }} /> 一覧に戻る
      </button>

      {/* My Data(分析タブ)と同じ形式: 太字タイトル+グレーの説明文+指標ごとの推移グラフ */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "16px 18px" }}>
        <div className="sans" style={{ fontSize: 11, color: "#0F172A", fontWeight: 600, marginBottom: 4 }}>{reedLabel(reed, reeds)}</div>
        <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <span>{points.length}セッションの推移 ・ 主観評価:</span>
          <StarRating value={reed.rating} onChange={() => {}} readOnly size={12} />
        </div>
        {points.length === 0 ? (
          <div className="sans" style={{ fontSize: 11, color: "#94A3B8" }}>このリードに紐づく測定データがまだありません</div>
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

// 奏者が「自分」のセッションだけを集めた経時変化グラフ。分析タブの一番上に表示し、
// 自分の演奏がどう変化しているかを他のリード・セッションのデータから独立して確認できるようにする。
function MyDataSection({ sessions }) {
  const mySessions = sessions
    .filter((s) => s.performer === "自分")
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  const points = mySessions.map((s) => {
    const frames = s.frames || [];
    return { date: s.recordedAt, frameCount: frames.length, memo: s.memo, ...computeFrameMetrics(frames) };
  });

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "16px 18px", marginBottom: 12 }}>
      <div className="sans" style={{ fontSize: 11, color: "#0F172A", fontWeight: 600, marginBottom: 4 }}>My Data</div>
      <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 12 }}>
        奏者が「自分」のセッション（{points.length}件）の推移
      </div>
      {points.length === 0 ? (
        <div className="sans" style={{ fontSize: 11, color: "#94A3B8" }}>「自分」のセッションがまだありません</div>
      ) : (
        REED_COMPARE_METRICS.map((m) => (
          <MetricLineChart key={m.key} metricDef={m} points={points} />
        ))
      )}
    </div>
  );
}

// 直近追加された最新セッション単体の内訳。My Dataの推移グラフ(複数セッションの平均的な変化)とは別に、
// 「今撮ったばかりの1回分」を単独で確認できるようにする。
function LatestSessionCard({ session, reeds }) {
  const reed = reeds.find((r) => r.id === session.reedId) || null;
  const m = computeFrameMetrics(session.frames || []);

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "16px 18px", marginBottom: 12 }}>
      <div className="sans" style={{ fontSize: 11, color: "#0F172A", fontWeight: 600, marginBottom: 4 }}>最新セッション</div>
      <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 12 }}>
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
    idealProfiles, selectedIdealId, setSelectedIdealId, NUM_HARMONICS,
    updateSessions, deleteSession, performers, setPerformers,
  } = props;

  const [pivotRow, setPivotRow] = useState("note");
  const [pivotCol, setPivotCol] = useState("reed");
  const [pivotMetric, setPivotMetric] = useState("pitchCents");
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(10);

  // 全セッションのフレームを、リードID・録音日時つきで平坦化する
  // (semitoneIndexはフレーム自体が保持: 企画書11.7節の記録拡張を実施済み)
  const framesWithContext = sessions.flatMap((s) =>
    (s.frames || []).map((f) => ({ ...f, reedId: s.reedId, recordedAt: s.recordedAt }))
  );

  // --- ピボット集計 ---
  const pivot = buildPivot(framesWithContext, reeds, pivotRow, pivotCol, pivotMetric);
  const metricDef = PIVOT_METRICS.find((m) => m.key === pivotMetric);

  const selectedSession = selectedSessionId ? sessions.find((s) => s.id === selectedSessionId) : null;
  if (selectedSession) {
    return (
      <SessionDetailView
        session={selectedSession} reeds={reeds} sessions={sessions} selectedIdeal={selectedIdeal}
        idealProfiles={idealProfiles} selectedIdealId={selectedIdealId} setSelectedIdealId={setSelectedIdealId}
        NUM_HARMONICS={NUM_HARMONICS} promoteSessionToIdeal={promoteSessionToIdeal}
        updateSessions={updateSessions} performers={performers} setPerformers={setPerformers}
        onBack={() => setSelectedSessionId(null)}
      />
    );
  }

  const sortedSessions = [...sessions].sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
  const visibleSessions = sortedSessions.slice(0, visibleCount);
  const latestSession = sortedSessions[0] || null;

  const handleDeleteSession = (e, id) => {
    e.stopPropagation();
    if (window.confirm("このセッションを削除しますか？(元に戻せません)")) deleteSession(id);
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* --- My Data: 「自分」のセッションの推移 --- */}
      <MyDataSection sessions={sessions} />

      {/* --- 最新セッション: 直近1回分の内訳を単独表示 --- */}
      {latestSession && <LatestSessionCard session={latestSession} reeds={reeds} />}

      {/* --- セッション一覧(録音+アップロード。アップロードは計測タブに統合済み) --- */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "16px 18px", marginBottom: 12 }}>
        <div className="sans" style={{ fontSize: 11, color: "#0F172A", fontWeight: 600, marginBottom: 10 }}>
          セッション一覧（{sessions.length}）
        </div>
        {sortedSessions.length === 0 ? (
          <div className="sans" style={{ fontSize: 11, color: "#94A3B8" }}>まだ記録がありません</div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {visibleSessions.map((s) => {
                const reed = reeds.find((r) => r.id === s.reedId) || null;
                return (
                  <div
                    key={s.id}
                    onClick={() => setSelectedSessionId(s.id)}
                    className="sans"
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: "1px solid #F1F5F9", cursor: "pointer", fontSize: 11 }}
                  >
                    <span style={{ color: "#0F172A", minWidth: 110, flexShrink: 0 }}>{new Date(s.recordedAt).toLocaleString("ja-JP")}</span>
                    <span style={{ color: "#2563EB", minWidth: 60, flexShrink: 0 }}>{s.performer || "—"}</span>
                    <span style={{ color: "#64748B", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reed ? reedLabel(reed, reeds) : "未紐付け"}</span>
                    {s.source === "upload" && <span style={{ color: "#94A3B8", fontSize: 9, flexShrink: 0 }}>📁</span>}
                    <button onClick={(e) => handleDeleteSession(e, s.id)} style={{ background: "none", border: "none", color: "#94A3B8", cursor: "pointer", padding: 2, flexShrink: 0 }}><Trash2 size={12} /></button>
                  </div>
                );
              })}
            </div>
            {visibleCount < sortedSessions.length && (
              <button
                onClick={() => setVisibleCount((v) => v + 10)}
                className="sans"
                style={{ width: "100%", marginTop: 10, padding: "8px 4px", borderRadius: 6, border: "1px solid #E2E8F0", background: "transparent", color: "#2563EB", fontSize: 11, cursor: "pointer" }}
              >
                もっと見る（残り{sortedSessions.length - visibleCount}件）
              </button>
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

// セッション詳細ビュー。録音/アップロードいずれかのセッションを、計測タブに近いレイアウトで振り返る。
function SessionDetailView({ session, reeds, sessions, selectedIdeal, idealProfiles, selectedIdealId, setSelectedIdealId, NUM_HARMONICS, promoteSessionToIdeal, updateSessions, performers, setPerformers, onBack }) {
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

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <button
        onClick={onBack}
        className="sans"
        style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#2563EB", fontSize: 11, marginBottom: 10, cursor: "pointer", padding: 0 }}
      >
        <ChevronDown size={13} style={{ transform: "rotate(90deg)" }} /> 一覧に戻る
      </button>

      {/* 1. セッション情報 */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 12, color: "#0F172A", fontWeight: 600, marginBottom: 6 }}>
          {new Date(session.recordedAt).toLocaleString("ja-JP")}
        </div>
        <div className="sans" style={{ fontSize: 10, color: "#64748B", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
          {session.memo && <span style={{ color: "#2563EB" }}>「{session.memo}」</span>}
        </div>
        <div style={{ marginTop: 10 }}>
          <SetAsIdealButton frames={frames} saxType={session.saxType} onSave={promoteSessionToIdeal} />
        </div>
      </div>

      {/* 2. 録音データグラフ(時間変化のタイムライン。単音でも音の立ち上がり等の変化があるため常に表示) */}
      {frames.length > 0 && (
        <PhraseTimeline
          frames={frames} noteEvents={session.noteEvents} selectedIdeal={selectedIdeal}
          idealProfiles={idealProfiles} selectedIdealId={selectedIdealId} setSelectedIdealId={setSelectedIdealId}
          NUM_HARMONICS={NUM_HARMONICS} sessions={sessions} ownSessionId={session.id}
        />
      )}

      {/* 3. 音階ごとの平均値。1回のデータに複数の音が含まれる場合、音ごとの理想値との差もここで確認できる */}
      {noteGroups.length > 0 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 16px", marginTop: 10, overflowX: "auto" }}>
          <div className="sans" style={{ fontSize: 10, color: "#64748B", marginBottom: 10 }}>
            音階ごとの平均（{noteGroups.length}音）
          </div>
          <table className="sans" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 480 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "5px 8px", color: "#64748B", fontSize: 10, borderBottom: "1px solid #E2E8F0" }}>記音</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#64748B", fontSize: 10, borderBottom: "1px solid #E2E8F0" }}>音高</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#64748B", fontSize: 10, borderBottom: "1px solid #E2E8F0" }}>音量</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#64748B", fontSize: 10, borderBottom: "1px solid #E2E8F0" }}>重心</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#64748B", fontSize: 10, borderBottom: "1px solid #E2E8F0" }}>HNR</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#64748B", fontSize: 10, borderBottom: "1px solid #E2E8F0" }}>理想値との差</th>
              </tr>
            </thead>
            <tbody>
              {noteGroups.map((g) => {
                const noteIdeal = getNoteIdeal(selectedIdeal, g.semitoneIndex);
                const cents = noteIdeal?.pitchHz && g.pitchHz ? centsBetween(g.pitchHz, noteIdeal.pitchHz) : null;
                return (
                  <tr key={g.semitoneIndex}>
                    <td style={{ padding: "5px 8px", color: "#0F172A", fontWeight: 600, borderBottom: "1px solid #F1F5F9" }}>{g.writtenLabel ?? "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", color: "#0F172A", borderBottom: "1px solid #F1F5F9" }}>{g.pitchHz ? `${g.pitchHz.toFixed(1)}Hz` : "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", color: "#0F172A", borderBottom: "1px solid #F1F5F9" }}>{g.volumeDb !== null ? `${g.volumeDb.toFixed(1)}dB` : "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", color: "#0F172A", borderBottom: "1px solid #F1F5F9" }}>{g.centroidHz !== null ? `${Math.round(g.centroidHz)}Hz` : "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", color: "#0F172A", borderBottom: "1px solid #F1F5F9" }}>{g.hnrDb !== null ? `${g.hnrDb.toFixed(1)}dB` : "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", fontWeight: 600, borderBottom: "1px solid #F1F5F9", color: cents !== null ? pitchCellColor(cents) : "#94A3B8" }}>
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
