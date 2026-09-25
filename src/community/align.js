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

/**
 * グラフの1本の線にする「音の番号 → 値」。**その線が持っている音をすべて**拾う。
 *
 * 【便AQ 2026-09-24 本人の実機報告「少なくとも自分の音は全部揃ってるはずなのに出てない」】
 * 以前は、比べる相手(みんなの平均・その人)に値がある音だけを横に並べ、自分の線も
 * その音でしか拾っていなかった。テスト奏者が数音しか録っていないと、自分の線が数点に削られた。
 * 線ごとに自分の音で拾えば、相手の音が少なくても自分の線は全音出る
 * (横軸はもともと楽器の音域の全音 ── NoteAxisLineChart)。
 *
 * @param notes  notes[音の番号][指標] = 値 か { value }
 * @param read   セルから数値を取り出す(平均は { value, n } なので c => c?.value)
 */
export function noteValues(notes, metric, read = (cell) => cell) {
  const out = {};
  for (const [k, note] of Object.entries(notes ?? {})) {
    const v = read(note?.[metric]);
    if (num(v)) out[k] = v;
  }
  return out;
}

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

/**
 * 相手(theirs)を自分(mine)の高さへ平行移動した写しを返す。**合わせられないときは null**。
 *   ・自分の計測が無い / 重心・HNR のどちらかで共通音が MIN_COMMON_NOTES 未満 → null
 *   ・音程と倍音構成は写すだけ(環境非依存)。音量は写さない(共有しない)
 *
 * 【便BA 2026-09-25 本人指示で返し方が変わった】以前は合わせられないとき
 * { error: "重なっている音が 3 音に足りません" / "自分の計測がまだありません…" } を返し、
 * 画面がその文言を出して**グラフそのものを出していなかった**。本人「ここはみんなの平均なので、
 * 自分の計測数が少なくても、その条件のみんなの平均値が出ればいい」。合わせられないときは
 * 画面が「自分の線を出さず、相手(平均)の線だけを出す」ようになったので、文言は読み手を失い、
 * 定義ごと消した。合わせられるかどうかだけを null で返す。
 */
export function alignProfile(mine, theirs) {
  const mineNotes = mine?.notes ?? {};
  if (Object.keys(mineNotes).length === 0) return null;
  const shiftedBy = {};
  for (const metric of SHIFTED_METRICS) {
    const off = alignOffset(mine, theirs, metric);
    if (off === null) return null;
    shiftedBy[metric] = off;
  }
  return { notes: shiftProfileNotes(theirs, shiftedBy), shiftedBy };
}

/**
 * 【便BA 2026-09-25 本人指示】揃えずに写す(alignProfile と同じ形・同じ指標、移動量 0)。
 * 人物紹介で自分と共通の音が足りないとき、その人の線はこの値で描き、「目安に設定」もこの値を取り込む。
 * 【便BA 再審査 統括の裁定】揃えずに取り込んだ目安は、その印(alignedAtAdopt: false)を持つ。使うとき
 * (下の idealForUse)に自分の平均へ揃えられれば揃えて使い、揃えられなければ揃えが要る指標(重心・HNR)を
 * 目安から外す(音程と倍音構成は残す)。
 */
export function copyProfile(theirs) {
  return { notes: shiftProfileNotes(theirs, null), shiftedBy: null };
}

// 公開の指標だけを写し、重心・HNR は shiftedBy だけ動かす(null なら動かさない)。
// 【音量は写さない】ここで out に入れないことが「音量を共有しない」の実装そのもの。
function shiftProfileNotes(theirs, shiftedBy) {
  const notes = {};
  for (const [key, src] of Object.entries(theirs?.notes ?? {})) {
    const out = {};
    for (const metric of SHIFTED_METRICS) {
      if (num(src?.[metric])) out[metric] = src[metric] + (shiftedBy ? shiftedBy[metric] : 0);
    }
    for (const metric of COPIED_METRICS) {
      if (src?.[metric] !== undefined) out[metric] = src[metric];
    }
    notes[key] = out;
  }
  return notes;
}

// ------------------------------------------------------------------
// コホート平均(みんなの平均)
//
// 【便BA 2026-09-25 本人指示・統括の決定】**自分の計測に関係なく出す。他の人どうしで揃えてから平均する。**
// 以前は一人ずつ「自分に」揃えてから平均していたので、自分と 3 音重ならない人は平均に入らず、
// 自分の計測が少ない楽器(本人の T.Sax)では「重なっている音が 3 音に足りません」で平均そのものが出なかった。
//   1. 基準は「いちばん多くの音を持っている人」。同数なら sourceSessionCount の多い人、
//      さらに同数なら ownerUid の辞書順(並べ方は cohortOrder。入力の順に依らず決まる)
//   2. 残りの人を音の多い順に、**その時点までの平均**(基準から始めて、揃えて足した人の平均)へ
//      揃えて足していく。揃えるのは重心・HNR を共通音の中央値の差で(alignOffset と同じ算術)。
//      共通音が 3 音未満の人は入れない(素通しで混ぜると環境のずれごと平均に入る)
//   3. 音程は揃えずに平均する(環境非依存)
//   4. 平均に入った人数が MIN_COHORT 未満なら「あと○人…」
// 平均の高さは基準の人の高さになる(絶対値に意味は無い。自分と重ねるときは平均の側を自分へ動かす)。
// ------------------------------------------------------------------

// これ未満の人数では平均を出さない。少数の平均は個人の特定に近づき、
// かつ平均として意味が無い(設計書の決定5)。
export const MIN_COHORT = 3;

// その人が持っている「重心か HNR の値がある音」の数。基準の選び方と足す順番の物差し。
export function cohortNoteCount(profile) {
  return Object.values(profile?.notes ?? {}).filter((n) => SHIFTED_METRICS.some((m) => num(n?.[m]))).length;
}

// 平均に足す順番。音の多い順 → 録音回数の多い順 → ownerUid の辞書順(決定的)。
// 音を1つも持たない人は並べない(誰にも揃えられず、基準にもなれない)。
export function cohortOrder(others) {
  const sessionsOf = (p) => (num(p?.sourceSessionCount) ? p.sourceSessionCount : 0);
  const uidOf = (p) => String(p?.ownerUid ?? "");
  return (others ?? [])
    .filter((o) => o && cohortNoteCount(o) > 0)
    .slice()
    .sort((x, y) => (cohortNoteCount(y) - cohortNoteCount(x))
      || (sessionsOf(y) - sessionsOf(x))
      || (uidOf(x) < uidOf(y) ? -1 : uidOf(x) > uidOf(y) ? 1 : 0));
}

/**
 * @param others 他人のプロファイルの配列(公開の目安。notes / sourceSessionCount / ownerUid)
 * @returns { notes, count, baseUid } | { error }
 *   notes[音の番号][指標] = { value, n }(その音に値があった人数 n も返す)
 */
export function cohortAverage(others) {
  const order = cohortOrder(others);
  const sums = {}; // notes[key][metric] = { sum, n }
  const addPerson = (notes, shift) => {
    for (const [key, note] of Object.entries(notes ?? {})) {
      for (const metric of SHIFTED_METRICS) {
        if (!num(note?.[metric])) continue;
        sums[key] ??= {};
        sums[key][metric] ??= { sum: 0, n: 0 };
        sums[key][metric].sum += note[metric] + shift[metric];
        sums[key][metric].n += 1;
      }
      // ピッチも平均する(環境非依存なので移動しない)
      if (num(note?.pitchCentsSigned)) {
        sums[key] ??= {};
        sums[key].pitchCentsSigned ??= { sum: 0, n: 0 };
        sums[key].pitchCentsSigned.sum += note.pitchCentsSigned;
        sums[key].pitchCentsSigned.n += 1;
      }
    }
  };
  // その時点までの平均(alignOffset に渡せる形: notes[key][metric] = 値)
  const runningAverage = () => ({
    notes: Object.fromEntries(Object.entries(sums).map(([key, ms]) =>
      [key, Object.fromEntries(Object.entries(ms).map(([m, { sum, n }]) => [m, sum / n]))])),
  });

  let count = 0;
  for (const person of order) {
    if (count === 0) {
      addPerson(person.notes, { spectralCentroidHz: 0, hnrDb: 0 });
      count = 1;
      continue;
    }
    const base = runningAverage();
    const shift = {};
    let ok = true;
    for (const metric of SHIFTED_METRICS) {
      const off = alignOffset(base, person, metric);
      if (off === null) { ok = false; break; }
      shift[metric] = off;
    }
    // 【揃えられない人は平均に入れない】その時点までの平均と共通音が 3 音未満。
    if (!ok) continue;
    addPerson(person.notes, shift);
    count += 1;
  }

  // 【C2 2026-09-16 実機の指摘】「...」と句点を消し、2行に分ける(表示側は white-space: pre-line)。
  // 〇 は「あと何人で出せるか」。
  // 【便BA 再審査 2026-09-25 統括の裁定】公開している人は足りているのに、同じ音で揃えられて平均に入った人が
  // 足りないときは「あと○人」と言わない(もう○人いるのに増やせと読める)。人数そのものが足りないときだけ「あと○人」。
  const published = (others ?? []).filter(Boolean).length;
  if (count < MIN_COHORT && published >= MIN_COHORT) {
    return { error: "同じ音を計測している人が、まだ足りません\nみなさまのデータをお待ちしています" };
  }
  if (count < MIN_COHORT) {
    return { error: `あと${MIN_COHORT - count}人のデータが必要です\nみなさまのデータをお待ちしています` };
  }

  const notes = {};
  for (const [key, metrics] of Object.entries(sums)) {
    notes[key] = {};
    for (const [metric, { sum, n }] of Object.entries(metrics)) {
      // 【その音に値があった人数も返す】音ごとに母数が違う。
      notes[key][metric] = { value: sum / n, n };
    }
  }
  return { notes, count, baseUid: order[0]?.ownerUid ?? null };
}

// 【便BA】平均(notes[key][metric] = { value, n })を、alignProfile に渡せる素の形
// (notes[key][metric] = 値)にする。自分と重ねるとき、平均の側を自分の高さへ動かすのに使う。
export function cohortPlainProfile(avg) {
  const notes = {};
  for (const [key, metrics] of Object.entries(avg?.notes ?? {})) {
    notes[key] = Object.fromEntries(Object.entries(metrics).map(([m, c]) => [m, c?.value]));
  }
  return { notes };
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
// ・**合わせられなくてもエラーにしない。** 自分の録音から作った目安(環境がほぼ同じ)や、
//   取り込み時点で平行移動済みの目安は、動かせなくても絶対値の比較が壊れていない。
//   【便BA 再審査 2026-09-25 統括の裁定】ただし**揃えずに取り込んだ目安**(alignedAtAdopt: false)は
//   他人の環境の生の値なので、揃えられないまま使うと比較が壊れる。取り込みのとき揃えられなかった
//   (= 自分と共通の音が足りなかった)なら、使うときも同じ自分のデータでは揃えられないことが多い。
//   その場合の扱いは下の idealForUse が持つ(揃えが要る指標を外す)。
// ------------------------------------------------------------------
export const LOCAL_SHIFTED_METRICS = ["centroidHz", "hnrDb", "volumeDb"];
// 【便BA 再審査】揃えずに取り込んだ目安で、揃えられなければ外す指標(SHIFTED_METRICS = 重心・HNR のローカルの綴り)。
// 音量は公開していない(取り込んだ目安に入っていない)ので対象に入れない。音程と倍音構成は環境非依存なので残す。
export const ADOPT_ALIGN_REQUIRED = ["centroidHz", "hnrDb"];
// 取り込んだ目安の印(idealDoc.js の ADOPTED_SOURCE と同じ値。あちらがこのファイルを import しているので、
// 循環を作らないためにここでは値で持つ。一致は検査が突き合わせる)。
export const ADOPTED_SOURCE_KIND = "community";

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

/**
 * 【便BA 再審査 2026-09-25 統括の裁定】目安を**使う**ときの形。端末の中で目安を読む場所はこれ1つを通す
 * (App.jsx の selectedIdeal。計測タブの判定・音色一致度・セッション詳細・リード詳細・My Data がそれを読む)。
 *   1. 自分の平均へ揃える(alignIdealToMine)
 *   2. 揃えずに取り込んだ目安(alignedAtAdopt === false、取り込んだもの)で、揃えられなかった指標
 *      (ADOPT_ALIGN_REQUIRED のうち alignedTo に入らなかったもの)は**目安から外す**。
 *      外した指標はグラフに目安の線を描かず、音色一致度にも使わない(excludedMetrics で知らせる)。
 *      自分の計測が増えて揃えられるようになれば、外れずに揃った値で戻る。
 *   3. 自分の計測から作った目安・揃えて取り込んだ目安・印の無い古い目安は、今まで通り(1 だけ)。
 */
export function idealForUse(ideal, mine) {
  const aligned = alignIdealToMine(ideal, mine);
  if (!aligned || ideal.alignedAtAdopt !== false || ideal.sourceKind !== ADOPTED_SOURCE_KIND) return aligned;
  const shifted = aligned.alignedTo ?? {};
  const drop = ADOPT_ALIGN_REQUIRED.filter((m) => shifted[m] === undefined);
  if (drop.length === 0) return aligned;
  const notes = {};
  for (const [key, src] of Object.entries(aligned.notes ?? {})) {
    const out = { ...src };
    for (const m of drop) delete out[m];
    notes[key] = out;
  }
  return { ...aligned, notes, excludedMetrics: drop };
}
