// 他人の音のデータを自分の目安として使うための平行移動。
//
// 【なぜ要るか】スペクトル重心とHNRの絶対値は、マイクの距離・入力ゲイン・部屋の響きで
// 一律にずれる。相手の値をそのまま目標にすると全音で「足りない」と出続け、
// どの音を直せばいいか分からない。共通する音の中央値を合わせてから重ねると、
// 残るのは「音ごとの形の差」= 本物の差だけになる。
// 設計書 docs/superpowers/specs/2026-08-27-community-tab-design.md §3。
//
// 【中央値で合わせる。平均ではない】平均だと、相手の1音が外れ値だっただけで
// 全体のずらし量が狂う。中央値なら外れ値1つでは動かない。

// 平行移動して共有する指標(環境で一律にずれるもの)
export const SHIFTED_METRICS = ["spectralCentroidHz", "hnrDb"];
// そのまま共有する指標(ピッチは環境非依存、倍音構成は音の中での比率)
export const COPIED_METRICS = ["pitchCentsSigned", "harmonics"];
// 共通音がこれ未満だと基準が立たない
export const MIN_COMMON_NOTES = 3;

const num = (v) => typeof v === "number" && Number.isFinite(v);

export function commonNoteKeys(mine, theirs, metric) {
  const a = mine?.notes ?? {};
  const b = theirs?.notes ?? {};
  return Object.keys(a)
    .filter((k) => num(a[k]?.[metric]) && num(b[k]?.[metric]))
    .sort((x, y) => Number(x) - Number(y));
}

export function medianOf(values) {
  const v = values.filter(num).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function alignOffset(mine, theirs, metric) {
  const keys = commonNoteKeys(mine, theirs, metric);
  if (keys.length < MIN_COMMON_NOTES) return null;
  const mm = medianOf(keys.map((k) => mine.notes[k][metric]));
  const tm = medianOf(keys.map((k) => theirs.notes[k][metric]));
  if (mm === null || tm === null) return null;
  return mm - tm;
}

export function alignProfile(mine, theirs) {
  const mineNotes = mine?.notes ?? {};
  if (Object.keys(mineNotes).length === 0) {
    return { error: "自分の計測がまだありません。数回吹いてから取り込んでください" };
  }
  const shiftedBy = {};
  for (const metric of SHIFTED_METRICS) {
    const off = alignOffset(mine, theirs, metric);
    if (off === null) {
      return { error: `重なっている音が ${MIN_COMMON_NOTES} 音に足りません` };
    }
    shiftedBy[metric] = off;
  }
  const notes = {};
  for (const [key, src] of Object.entries(theirs?.notes ?? {})) {
    const out = {};
    for (const metric of SHIFTED_METRICS) {
      if (num(src?.[metric])) out[metric] = src[metric] + shiftedBy[metric];
    }
    for (const metric of COPIED_METRICS) {
      if (src?.[metric] !== undefined) out[metric] = src[metric];
    }
    // 【音量は写さない】ここで out に入れないことが「音量を共有しない」の実装そのもの。
    // 元の src に volumeDb が入っていても、SHIFTED / COPIED のどちらにも無いので落ちる。
    notes[key] = out;
  }
  return { notes, shiftedBy };
}

// ------------------------------------------------------------------
// コホート平均(みんなの平均)
//
// 【一人ずつ自分に合わせてから平均する】先に平均してから合わせると、
// 環境のばらつきが平均に混ざったまま残る。平行移動は「その人と自分」の間の話なので、
// 人ごとに移動量が違う。順序を逆にできない。
// ------------------------------------------------------------------

// これ未満の人数では平均を出さない。少数の平均は個人の特定に近づき、
// かつ平均として意味が無い(設計書の決定5)。
export const MIN_COHORT = 3;

/**
 * @param mine 自分のプロファイル { notes }
 * @param others 他人のプロファイルの配列
 * @returns { notes, count } | { error }
 *   notes[音名][指標] = 平均値。指標ごとに「その音に値があった人数」も返す。
 */
export function cohortAverage(mine, others) {
  const usable = [];
  for (const o of others ?? []) {
    const r = alignProfile(mine, o);
    // 【合わせられない人は平均に入れない】共通音が足りない人を素通しで平均に混ぜると、
    // その人だけ環境のずれを持ったまま入り、平均が引きずられる。
    if (r.error) continue;
    usable.push(r.notes);
  }
  if (usable.length === 0) {
    // 自分の計測が無いのか、誰とも重ならないのかを言い分ける。
    // どちらも「出ない」だが、利用者がすべきことが違う。
    const first = alignProfile(mine, (others ?? [])[0] ?? { notes: {} });
    return { error: first.error ?? "比べられる人がまだいません" };
  }
  if (usable.length < MIN_COHORT) {
    return { error: `この条件に合う人が ${MIN_COHORT} 人に足りません` };
  }

  const sums = {}; // notes[key][metric] = { sum, n }
  for (const notes of usable) {
    for (const [key, note] of Object.entries(notes)) {
      for (const metric of SHIFTED_METRICS) {
        if (!num(note[metric])) continue;
        sums[key] ??= {};
        sums[key][metric] ??= { sum: 0, n: 0 };
        sums[key][metric].sum += note[metric];
        sums[key][metric].n += 1;
      }
      // ピッチも平均する(環境非依存なので移動しないが、平均は取れる)
      if (num(note.pitchCentsSigned)) {
        sums[key] ??= {};
        sums[key].pitchCentsSigned ??= { sum: 0, n: 0 };
        sums[key].pitchCentsSigned.sum += note.pitchCentsSigned;
        sums[key].pitchCentsSigned.n += 1;
      }
    }
  }

  const notes = {};
  for (const [key, metrics] of Object.entries(sums)) {
    notes[key] = {};
    for (const [metric, { sum, n }] of Object.entries(metrics)) {
      // 【その音に値があった人数も返す】音ごとに母数が違う。
      // 「42人のデータ」と出しておきながら、ある音だけ3人ぶんの平均、が起きる。
      notes[key][metric] = { value: sum / n, n };
    }
  }
  return { notes, count: usable.length };
}

// ------------------------------------------------------------------
// 端末の中で使う平行移動(2026/09/06 本人指示)
//
// 本人の言葉:「HNR・重心・音量の『揃えて線の形で比較』の仕組みを、コミュニティ
// タブ以外でも採用。この場合、自分の平均に、目安に設定しているものが揃えられる」。
// つまり **動かすのは目安の側**、基準は **自分の平均**。
//
// 【上の共有用と何が違うか】
// ・綴りがローカルのもの(centroidHz。公開側は spectralCentroidHz)。
// ・**音量も動かす。** 共有では音量を写さないが、それは「他人の環境の絶対値は
//   目標にならない」からで、自分の端末の中で日をまたいだ自分の目安と合わせるのは
//   まさにマイク距離とゲインのずれを消す操作。重心・HNR と同じ理屈が当たる。
// ・**合わせられなくてもエラーにしない。** 端末内の目安は自分の録音から作ったもの
//   (環境がほぼ同じ)か、取り込み時点で平行移動済みのものなので、動かせなくても
//   絶対値の比較が壊れていない。共有のように「出さない」にする理由が無い。
// ------------------------------------------------------------------
export const LOCAL_SHIFTED_METRICS = ["centroidHz", "hnrDb", "volumeDb"];

/**
 * 目安 ideal を、自分の平均 mine に合わせて平行移動した写しを返す。
 * ピッチと倍音構成は動かさない(環境非依存 / 音の中での比率)ので、写すだけ。
 * **保存はしない。** 呼ぶ側が表示のたびに導く。
 */
export function alignIdealToMine(ideal, mine) {
  if (!ideal) return null;
  const shiftedBy = {};
  for (const metric of LOCAL_SHIFTED_METRICS) {
    const off = alignOffset(mine, ideal, metric);
    if (off !== null) shiftedBy[metric] = off;
  }
  // 1つも合わせられない(共通音が足りない・自分の平均が無い)ならそのまま使う
  if (Object.keys(shiftedBy).length === 0) return ideal;
  const notes = {};
  for (const [key, src] of Object.entries(ideal.notes ?? {})) {
    const out = { ...src };
    for (const metric of LOCAL_SHIFTED_METRICS) {
      if (num(src?.[metric]) && shiftedBy[metric] !== undefined) out[metric] = src[metric] + shiftedBy[metric];
    }
    notes[key] = out;
  }
  return { ...ideal, notes, alignedTo: shiftedBy };
}
