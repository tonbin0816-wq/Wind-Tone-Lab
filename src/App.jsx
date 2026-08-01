import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { Square, Trash2, ChevronDown, ChevronUp, Upload, FileAudio } from "lucide-react";

// 指定要素から祖先(container手前まで)に横スクロール可能な要素があるか判定する。
// あればそこはスワイプでスクロールしたい領域なので、タブ切替スワイプの発火を避ける。
function hasHorizontalScrollAncestor(el, stopEl) {
  let node = el;
  while (node && node !== stopEl && node.nodeType === 1) {
    if (node.scrollWidth > node.clientWidth + 2) {
      const ov = getComputedStyle(node).overflowX;
      if (ov === "auto" || ov === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

// 横スワイプでタブ切替/前画面への戻りを行うための共通フック(モバイルのタッチ操作専用)。
// 縦スクロール・横スクロール要素・スライダー等と競合しないよう、指を離した時点で
// 「横移動が縦移動より十分大きく、しきい値を超え、素早い」場合のみ発火する。
// stopPropagation=true のときは発火時にイベント伝播を止め、親のスワイプ領域(例: サブタブ
// 切替)が二重に反応しないようにする(詳細画面からの戻りスワイプで使う)。
function useHorizontalSwipe({ onSwipeLeft, onSwipeRight, threshold = 60, stopPropagation = false }) {
  const start = useRef(null);
  const onTouchStart = (e) => {
    // スライダー・プルダウン・入力欄・明示的に除外した要素の上では発火させない
    if (e.touches.length !== 1 || e.target.closest?.("input, select, textarea, [data-noswipe]") ||
        hasHorizontalScrollAncestor(e.target, e.currentTarget)) {
      start.current = null;
      return;
    }
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, at: Date.now() };
  };
  const onTouchEnd = (e) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - s.at > 700) return;
    if (stopPropagation) e.stopPropagation();
    if (dx < 0) onSwipeLeft?.(); else onSwipeRight?.();
  };
  return { onTouchStart, onTouchEnd };
}

// 対象要素の上端から画面下端(下部固定ナビの手前)までの高さを返すフック。スワイプ領域を
// この高さ以上に広げることで、コンテンツが短くても画面下側の空白部分までスワイプが効くようにする。
// --page-bottom-gap(= --nav-h + env(safe-area-inset-bottom)) の実効ピクセル値を得る。
// getComputedStyle().getPropertyValue() はカスタムプロパティを「未解決の文字列」
// ("calc(47px + 34px)")のまま返すため parseFloat では読めない。実際に其の高さを持つ
// 要素を一瞬置いて測ることで、calc() と env() を解決させた確定値を取る。
function resolveBottomGap() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;height:var(--page-bottom-gap)";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h > 0 ? h : 47; // 何らかの理由で測れなかった場合はナビ高だけ確保する
}

// 下部固定ナビに隠れる分を差し引いて、要素が画面下端まで占める高さを返す。
// 差し引く量は index.css の --page-bottom-gap(= --nav-h + env(safe-area-inset-bottom))から
// 実測で読む。以前は 72px をJS側にも直書きしていたため、セーフエリアのある端末で
// ナビの実効高(81px)に9px足りず、コンテンツ末尾がナビの下に隠れていた。
// bottomGap に数値を渡した場合はそれを優先する(呼び出し側で上書きしたいケース用)。
// 【iOSでは innerHeight を使わない】window.innerHeight はアドレスバーを含む高さを返すため、
// 実際に見えている領域より大きくなる。その値で minHeight を敷くと、詳細を閉じた素の状態でも
// 常にアドレスバーぶんだけ縦スクロールできてしまう(実機で計測タブ・リードタブの両方で報告)。
// 見えている領域の高さは visualViewport.height が返すので、あればそちらを優先する。
function visibleViewportHeight() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const h = vv && vv.height > 0 ? vv.height : 0;
  return h || window.innerHeight;
}
function useFillViewportHeight(ref, bottomGap = null) {
  const [minH, setMinH] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const gap = bottomGap != null ? bottomGap : resolveBottomGap();
      const h = visibleViewportHeight() - top - gap;
      setMinH(h > 0 ? h : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    // アドレスバーの伸縮は window の resize を伴わないことがあるため visualViewport も購読する
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    const t = setTimeout(measure, 300); // フォント読込等で上の要素高さが変わった後にも測り直す
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      vv?.removeEventListener("resize", measure);
      clearTimeout(t);
    };
  }, [ref, bottomGap]);
  return minH;
}

// 指に追従してページが横からスライドインする、カルーセル型のスワイプpager。
// children(各ページ)を横一列に並べ、ドラッグ量ぶんだけtranslateXで動かす。指を離した時に
// しきい値(幅の20%)を超えていれば隣のページへスナップ、足りなければ元に戻る。
// ・パフォーマンス: ドラッグ中はReactのstateを更新せず、trackのstyleを直接書き換える
//   (重い子ページを毎フレーム再レンダーしないため)。indexはpropで制御(サブタブと同期)。
// ・縦スクロールとの両立: 最初の数pxで縦横どちらのジェスチャーかを判定し、横と決まってから
//   のみ preventDefault(非パッシブ登録)して横へ動かす。縦と判定したら何もせず縦スクロールさせる。
// ・スライダー/プルダウン/横スクロール要素の上では発火しない。
// ・viewportは画面下端まで高さを確保し、コンテンツが短くても画面のどこでもスワイプできる。
function SwipePager({ index, onIndexChange, children }) {
  const pages = (Array.isArray(children) ? children : [children]).filter((c) => c != null);
  const count = pages.length;
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const st = useRef(null);
  const idxRef = useRef(index);
  useEffect(() => { idxRef.current = index; }, [index]);
  const minH = useFillViewportHeight(viewportRef);
  const EASE = "transform 0.32s cubic-bezier(.22,.61,.36,1)";

  const onTouchStart = (e) => {
    if (e.touches.length !== 1 || e.target.closest?.("input, select, textarea, [data-noswipe]") ||
        hasHorizontalScrollAncestor(e.target, e.currentTarget)) { st.current = null; return; }
    const t = e.touches[0];
    st.current = { x: t.clientX, y: t.clientY, dx: 0, decided: false, horizontal: false };
  };

  // touchmoveは非パッシブで登録し、横ドラッグ確定後に縦スクロールを止める。
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onMove = (e) => {
      const s = st.current;
      if (!s || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dxRaw = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (!s.decided) {
        if (Math.abs(dxRaw) < 6 && Math.abs(dy) < 6) return;
        s.decided = true;
        s.horizontal = Math.abs(dxRaw) > Math.abs(dy);
      }
      if (!s.horizontal) return;
      e.preventDefault();
      let dx = dxRaw;
      const i = idxRef.current;
      if ((i === 0 && dx > 0) || (i === count - 1 && dx < 0)) dx *= 0.35; // 端は抵抗をつける
      s.dx = dx;
      const track = trackRef.current;
      if (track) {
        track.style.transition = "none";
        track.style.transform = `translateX(calc(${-i * 100}% + ${dx}px))`;
      }
    };
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  }, [count]);

  const onTouchEnd = () => {
    const s = st.current;
    st.current = null;
    if (!s || !s.horizontal) return;
    const track = trackRef.current;
    const w = viewportRef.current?.clientWidth || 0;
    const threshold = w ? w * 0.2 : 60;
    const i = index;
    let next = i;
    if (s.dx <= -threshold && i < count - 1) next = i + 1;
    else if (s.dx >= threshold && i > 0) next = i - 1;
    if (track) track.style.transition = EASE;
    if (next !== i) {
      onIndexChange(next);                                            // 再レンダーで次ページへスライド
    } else if (track) {
      track.style.transform = `translateX(${-i * 100}%)`;             // しきい値未満は元に戻す
    }
  };

  return (
    <div ref={viewportRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
      style={{ overflow: "hidden", width: "100%", minHeight: minH || undefined }}>
      <div ref={trackRef} style={{
        display: "flex", flexWrap: "nowrap", alignItems: "flex-start",
        transform: `translateX(${-index * 100}%)`, transition: EASE, willChange: "transform",
      }}>
        {pages.map((c, i) => (
          <div key={i} style={{ flex: "0 0 100%", minWidth: 0, boxSizing: "border-box" }}>{c}</div>
        ))}
      </div>
    </div>
  );
}

// 詳細画面の「右スワイプで一覧へ戻る」領域。コンテンツが短くても画面下側の空白まで
// スワイプが効くよう、画面下端まで高さを確保する。
function SwipeBackArea({ onBack, children }) {
  const ref = useRef(null);
  const minH = useFillViewportHeight(ref);
  const swipe = useHorizontalSwipe({ onSwipeRight: onBack });
  return (
    <div ref={ref} {...swipe} style={{ minHeight: minH || undefined }}>
      {children}
    </div>
  );
}

// 縦横どちらにもスクロールできる領域を「1回の操作では縦か横の片方だけ」に制限する
// (斜めスクロール防止)。最初の数pxで優勢な軸を決め、その軸がスクロール可能なら
// preventDefaultして手動でその軸だけ動かす。スクロールできない軸ならページ側の
// スクロールを妨げない。返り値のrefを対象のスクロール要素に付ける。
function useAxisLockScroll() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let sx = 0, sy = 0, sl = 0, stp = 0, axis = null, active = false;
    const onStart = (e) => {
      if (e.touches.length !== 1) { active = false; return; }
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; sl = el.scrollLeft; stp = el.scrollTop;
      axis = null; active = true;
    };
    const onMove = (e) => {
      if (!active || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (axis === null) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      const canX = el.scrollWidth > el.clientWidth + 1;
      const canY = el.scrollHeight > el.clientHeight + 1;
      if (axis === "x" && canX) { e.preventDefault(); el.scrollLeft = sl - dx; }
      else if (axis === "y" && canY) { e.preventDefault(); el.scrollTop = stp - dy; }
      // 優勢軸がスクロール不可の場合は何もしない(ページ側の縦スクロール等を妨げない)
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => { el.removeEventListener("touchstart", onStart); el.removeEventListener("touchmove", onMove); };
  }, []);
  return ref;
}

// ============================================================
// Music theory helpers
// ============================================================
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];

// 楽器音だけを拾うための判定パラメータ。
// ・ノイズゲート: バンドパス後の音量(dBFS)がこの値以下なら無音とみなす(設定で変更可能)。
// ・ヒステリシス: 発音中はゲート-この分まで継続し、境界付近のパタつきを防ぐ。
// ・clarity(MPMの周期明瞭度0..1)がこの値未満なら「音程のない雑音(ブレス/空調)」として排除。
//   楽器音はほぼ完全な周期波形でclarityが0.9以上になる。ブレスや空調は非周期で低い。
const NOISE_GATE_DEFAULT_DB = -50; // 既定のノイズゲート(dBFS)
const GATE_HYSTERESIS_DB = 4;
const PITCH_CLARITY_MIN = 0.8;
const TIMBRE_EXTRA_DB = 8;          // 音色系(重心/HNR/倍音)はゲート+この余裕の音量でだけ測定
// バンドパス(BiquadFilterNode)の中心周波数とQ。楽器の基音帯を通し、
// 空調のうなり(低域)と高域ヒスを抑える。Qを低くして広い帯域を通す。
// 中心周波数は楽器種別ごと(SAX_PRESETSのgateBandpassHz)。500はフォールバック。
const BANDPASS_FREQ_HZ = 500;
const BANDPASS_Q = 0.3;
// 記録データの頑健化パラメータ。
// ・TIMBRE_SUSTAIN_MS: ノート冒頭のアタック過渡は音色(倍音/重心/HNR)の集計から除外する
//   (典型的なアタックは20〜100ms。表示はリアルタイムのまま、平均値の質だけを上げる)。
// ・NOTE_SWITCH_CENTS: 音名グルーピングのヒステリシス。半音境界(±50¢)ちょうどの音で
//   フレームごとに隣の音名と行き来するチャタリングを防ぐ(前の音名から±60¢までは保持)。
// ・PITCH_OUTLIER_CENTS: 前後フレームの中央値からこれ以上外れた単発検出(オクターブ
//   誤検出等)を保存時に無効化する。速いパッセージの実音(隣接音±数百¢)は誤検出しない値。
const TIMBRE_SUSTAIN_MS = 120;
const NOTE_SWITCH_CENTS = 60;
const PITCH_OUTLIER_CENTS = 700;
// 運指テーブルの範囲から大きく外れた音(アルティッシモ・他楽器・誤検出)は運指に紐付けない。
// テーブル範囲内なら最近傍運指との差は必ず±50¢以内のため、これを超えるのは範囲外のみ。
const FINGERING_MATCH_MAX_CENTS = 150;

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
// gateBandpassHz: ノイズゲート判定用バンドパスの中心周波数。楽器の基音域の中心付近に
// 合わせる(バリトンの最低音域65〜100Hzは500Hz中心だと減衰し、ppの低音を拾い損ねるため)。
const SAX_PRESETS = {
  soprano: { label: "ソプラノ", effectiveLengthCm: 73.3, bellRadiusCm: 0.6, gateBandpassHz: 650 },
  alto: { label: "アルト", effectiveLengthCm: 123.4, bellRadiusCm: 0.8, gateBandpassHz: 500 },
  tenor: { label: "テナー", effectiveLengthCm: 164.8, bellRadiusCm: 1.0, gateBandpassHz: 400 },
  baritone: { label: "バリトン", effectiveLengthCm: 261.7, bellRadiusCm: 1.3, gateBandpassHz: 300 },
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

// "A4" / "C♯5" / "B♭3" のような音名ラベルを {name, octave} に分解する(大表示用)。
function parseNoteLabel(label) {
  if (typeof label !== "string") return null;
  const m = /^([A-G][♯♭#b]?)(-?\d+)$/.exec(label);
  return m ? { name: m[1], octave: m[2] } : null;
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

// 楽器種別ごとの実音(コンサートピッチ)の音域(MIDIノート番号, 両端含む)。
// 運指範囲は全機種共通で記音B♭3(58)〜F♯6(90)の33音(High F♯キーまで)とし、
// 各機種の移調量を足した実音がこの範囲になる(以前はソプラノ/テナーだけ
// 記音F♯5止まりで11半音短く、アルトもHigh F♯ぶんが欠けていた)。
//   ソプラノ: A♭3(56)〜E6(88) / アルト: D♭3(49)〜A5(81)
//   テナー:   A♭2(44)〜E5(76) / バリトン: D♭2(37)〜A4(69)
// この範囲外の検出(倍音を基音と誤る1オクターブ上のピーク等)は測定・記録しない。
// 音域の左端は運指テーブルの最低音(記音B♭)の実音と一致する。
const SAX_CONCERT_RANGE = {
  soprano: { lowMidi: 56, highMidi: 88 },
  alto: { lowMidi: 49, highMidi: 81 },
  tenor: { lowMidi: 44, highMidi: 76 },
  baritone: { lowMidi: 37, highMidi: 69 },
};

// 実音MIDI → 周波数(基準ピッチa4基準)
function concertMidiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

// 実音周波数 → 実音の音名ラベル(グラフの横軸などに使う。例: 442基準で139Hz→"D♭3")
function concertFreqLabel(freq, a4 = 440) {
  const n = freqToNote(freq, a4);
  return n ? `${n.name}${n.octave}` : null;
}

// 楽器音域からピッチ検出の下限・上限周波数を出す(±1半音の余裕をつけて、音域端の音を
// ±50¢曲げても外れないようにする)。範囲外の検出はdetectPitchMPMが棄却する。
function saxPitchBounds(saxType, a4 = 440) {
  const r = SAX_CONCERT_RANGE[saxType];
  if (!r) return { minFreq: 55, maxFreq: 1200 };
  return {
    minFreq: concertMidiToFreq(r.lowMidi - 1, a4),
    maxFreq: concertMidiToFreq(r.highMidi + 1, a4),
  };
}

// 運指テーブルを生成。音数は楽器種別ごとの音域(SAX_CONCERT_RANGE)に一致させる
// (記音B♭=音域の左端から、実音の最高音までを1半音刻みで並べる)。
function buildFingeringTable(saxType, tuningHz, numNotes) {
  const r = SAX_CONCERT_RANGE[saxType];
  const n = numNotes ?? (r ? r.highMidi - r.lowMidi + 1 : 30);
  const table = [];
  for (let i = 0; i < n; i++) {
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
// Pitch detection: MPM (McLeod Pitch Method)
//
// 旧実装(HPS=スペクトル積)は2つの致命的問題があった:
//  1. FFTのビン分解能(8192点/48kHz=5.86Hz)そのままでは低音で±30〜70¢の階段状にしか
//     動けず、1¢単位のチューナーとして成立しない。
//  2. AnalyserNodeの床(-100dB)で0になったビンが積に混ざると全域の積が0になり、
//     探索範囲の最初のビン(≒50Hz)を「検出」してしまう→常に最低音(B♭)に判定される。
// MPMは時間領域の正規化自己相関(NSDF)のピークを放物線補間で読むため、
// サブサンプル精度(実測<0.5¢)で基音周期を求められる。fftRadix2による
// FFT自己相関でO(N logN)に抑える。clarity(0..1)は音の周期性の明瞭度で、
// ブレスや空調のような非周期ノイズの排除(楽器音判定)にも使う。
// ============================================================
function detectPitchMPM(timeBuf, sampleRate, minFreq = 55, maxFreq = 1200) {
  const W = 4096;  // 解析窓(約85ms@48kHz。バリトン最低音73Hzでも6周期以上入る)
  const N = 8192;  // ゼロ埋めFFTサイズ(円状自己相関→線形自己相関化)
  if (!timeBuf || timeBuf.length < W) return null;
  const offset = timeBuf.length - W;

  // DC除去(マイクのオフセットで自己相関が歪むのを防ぐ)
  let mean = 0;
  for (let i = 0; i < W; i++) mean += timeBuf[offset + i];
  mean /= W;

  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < W; i++) re[i] = timeBuf[offset + i] - mean;
  fftRadix2(re, im);
  // パワースペクトル(実偶関数)を再度FFTすると実数の自己相関×Nが得られる
  for (let i = 0; i < N; i++) { const p = re[i] * re[i] + im[i] * im[i]; re[i] = p; im[i] = 0; }
  fftRadix2(re, im);

  const r0 = re[0] / N;
  if (r0 <= 1e-12) return null; // 完全な無音

  // m(τ) = Σ(x[j]² + x[j+τ]²) を累積和で O(1) 参照できるようにする
  const sq = new Float64Array(W + 1);
  for (let i = 0; i < W; i++) { const v = timeBuf[offset + i] - mean; sq[i + 1] = sq[i] + v * v; }

  const maxLag = Math.min(W - 1, Math.ceil(sampleRate / minFreq));
  // NSDFはτ=2から計算する。探索をminLag(最高周波数の周期)から始めると、高音では
  // 最初の真のピークがτ=0の自明な正区間と地続きになって「正区間スキップ」に飲み込まれ、
  // 2倍周期(1オクターブ下)を拾ってしまう。τ=2起点ならτ=0のローブを正しく通過できる。
  const nsdf = new Float64Array(maxLag + 2);
  for (let t = 2; t <= maxLag; t++) {
    const rt = re[t] / N;
    const mt = (sq[W - t] - sq[0]) + (sq[W] - sq[t]);
    nsdf[t] = mt > 0 ? (2 * rt) / mt : 0;
  }

  // ピーク選択(McLeod): 正区間ごとの局所最大を列挙し、音域内で最大ピーク×K以上の最初(最小τ)を採る
  const peaks = [];
  let t = 2;
  while (t <= maxLag && nsdf[t] > 0) t++; // τ=0近傍の自明な正区間を飛ばす
  while (t <= maxLag) {
    while (t <= maxLag && nsdf[t] <= 0) t++;
    let peakT = -1, peakV = 0;
    while (t <= maxLag && nsdf[t] > 0) {
      if (nsdf[t] > peakV) { peakV = nsdf[t]; peakT = t; }
      t++;
    }
    if (peakT > 0) { peaks.push([peakT, peakV]); }
  }
  if (peaks.length === 0) return null;
  // 楽器音域の上限(maxFreq)より高いピーク=倍音を基音と誤る「1オクターブ上」のピークは
  // 候補から除外する。McLeodの選択は「最大ピーク×K以上で最もτが小さい(=最も高い)ピーク」
  // を採るため、音域を絞らないと強い倍音を持つ音で幻の高音(オクターブ上)を拾いやすい。
  // 音域内(τ≥minLag)に絞ることで、正しい基音を選ぶ。
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  const cand = peaks.filter((p) => p[0] >= minLag);
  if (cand.length === 0) return null;
  let candMax = 0;
  for (const p of cand) if (p[1] > candMax) candMax = p[1];
  if (candMax < 0.5) return null;
  const K = 0.9;
  let chosen = cand[0];
  for (const p of cand) { if (p[1] >= K * candMax) { chosen = p; break; } }

  // 放物線補間でサブサンプルの周期を求める(これが1¢精度の要)
  const T = chosen[0];
  const a = nsdf[T - 1], b = nsdf[T], c = nsdf[T + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  const tau = T + shift;
  const clarity = Math.max(0, Math.min(1, b - 0.25 * (a - c) * shift));
  const freq = sampleRate / tau;
  if (freq < minFreq || freq > maxFreq) return null;
  return { freq, clarity };
}

function freqToBin(freq, sampleRate, fftSize) {
  return Math.round((freq * fftSize) / sampleRate);
}

// ============================================================
// Timbre metrics (倍音・スペクトル重心・HNR)
//
// 旧実装はAnalyserNodeの周波数データ(smoothingTimeConstant=0.6の時間平滑つき)から
// 計算していたため、次の系統誤差があった:
//  1. 立ち上がりや音替わりの直後は、直前の音(や無音)のスペクトルが混ざった値になる
//  2. ライブ(rAF毎≒60回/秒で平滑)とアップロード解析(100msホップ毎で平滑)では
//     平滑の効きが約6倍違い、同じ演奏でも数値が一致しない
//  3. 倍音レベルはFFTビン格子(5.86Hz刻み)の±2ビン最大値で、ピークがビン間に
//     落ちると過小評価、ビブラートでビンをまたぐと値が揺れる
//  4. HNRの倍音帯域が固定±15Hzで、ビブラート時に上位倍音(第8倍音は±20¢で±40Hz
//     動く)が帯域から外れ「ノイズ」側に計上され、HNRが不当に下がる
//  5. HNR・重心とも全帯域(〜24kHz)を対象にしており、マイクのヒスや低域ランブルが
//     値を左右する(奏者ではなく機材・部屋を測ってしまう)
//
// 本実装は時間波形の直近W=8192サンプルからHann窓つきFFTで毎回独立に計算する。
// 平滑ゼロ・ライブとアップロード解析で完全に同一の計算になる。
//  - 倍音: n×f0を中心とする帯域(±(15Hz + n×f0の1.5%))のエネルギー和の平方根。
//    15Hzの固定分はHann窓のメインローブ+スカート、比例分はビブラートによる
//    周波数の振れ(±25¢で第n倍音はn×f0の約1.5%動く)をカバーする。
//    帯域全体を積分するためビン格子への丸め誤差がほぼ消え、
//    ビブラートで広がったエネルギーも取りこぼさない(MPMのサブセント精度のf0前提)
//  - HNR: 倍音帯域は上と同じ次数比例幅。評価帯域を楽器帯(0.5×f0〜(倍音数+0.5)×f0)に
//    限定し、帯域外のヒス・ランブルを評価から除外する
//  - 重心: 10kHz以下かつ「ピーク-60dB」と「ビン中央値(≒ノイズ床)の6倍」の
//    大きい方を超えるビンだけで加重平均し、弱音時にノイズ床が重心を引っ張るのを防ぐ
//
// 窓長は8192固定(倍音の分離には周波数分解能が要るため短縮しない)。音の遷移で前の音が
// 窓に混ざる問題は、表示側の中央値スムージング(遷移フレームを弾く)と、音替わり直後の
// 測定除外(呼び出し側)で扱う。
// ============================================================
function computeTimbreMetrics(timeBuf, sampleRate, f0, numHarmonics = 8) {
  const W = 8192;
  if (!timeBuf || timeBuf.length < W || !f0 || f0 <= 0) return null;
  // Hann窓は毎tick使うため関数プロパティにキャッシュする(モジュール変数だと
  // scripts/pitch-test.mjsの関数単位抽出で切り離されるため、関数内に閉じる)
  if (!computeTimbreMetrics._hann) {
    const h = new Float64Array(W);
    for (let i = 0; i < W; i++) h[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W);
    computeTimbreMetrics._hann = h;
  }
  const hann = computeTimbreMetrics._hann;
  const offset = timeBuf.length - W;

  // DC除去 + Hann窓
  let mean = 0;
  for (let i = 0; i < W; i++) mean += timeBuf[offset + i];
  mean /= W;
  const re = new Float64Array(W);
  const im = new Float64Array(W);
  for (let i = 0; i < W; i++) re[i] = (timeBuf[offset + i] - mean) * hann[i];
  fftRadix2(re, im);

  const bins = W / 2;
  const binHz = sampleRate / W;
  const mags = new Float64Array(bins);
  for (let k = 0; k < bins; k++) mags[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);

  // --- 倍音レベル: n×f0周辺帯域のエネルギー和の平方根 ---
  const nyquist = sampleRate / 2;
  const harmonics = [];
  for (let n = 1; n <= numHarmonics; n++) {
    const target = f0 * n;
    if (target >= nyquist) { harmonics.push({ n, freq: target, mag: 0 }); continue; }
    const bw = 15 + 0.015 * target; // 窓の広がり(15Hz) + ビブラートの振れ(次数比例)
    const lo = Math.max(1, Math.ceil((target - bw) / binHz));
    const hi = Math.min(bins - 1, Math.floor((target + bw) / binHz));
    let energy = 0;
    for (let k = lo; k <= hi; k++) energy += mags[k] * mags[k];
    harmonics.push({ n, freq: target, mag: Math.sqrt(energy) });
  }

  // --- スペクトル重心: 10kHz以下・ノイズ床より十分上のビンのみで加重平均 ---
  const centroidMaxBin = Math.min(bins - 1, Math.floor(10000 / binHz));
  let peakMag = 0;
  for (let k = 1; k <= centroidMaxBin; k++) if (mags[k] > peakMag) peakMag = mags[k];
  // 除外閾値はノイズ床適応: ビンの中央値はほぼノイズ床の高さになるため、その6倍を
  // 下回るビンはノイズとして捨てる。クリーンな信号では中央値≒0となり、
  // ピーク-60dBの固定閾値だけが効く(弱い倍音を誤って捨てない)。
  const sortedMags = mags.slice(1, centroidMaxBin + 1).sort();
  const medianMag = sortedMags[sortedMags.length >> 1];
  const floorMag = Math.max(peakMag * 1e-3, medianMag * 6);
  let magSum = 0, weighted = 0;
  for (let k = 1; k <= centroidMaxBin; k++) {
    if (mags[k] >= floorMag) { magSum += mags[k]; weighted += k * binHz * mags[k]; }
  }
  const centroidHz = magSum > 1e-12 ? weighted / magSum : 0;

  // --- HNR: 評価帯域(0.5×f0〜(倍音数+0.5)×f0)内で倍音帯域とそれ以外を分ける ---
  const evalLo = Math.max(1, Math.round((0.5 * f0) / binHz));
  const evalHi = Math.min(bins - 1, Math.round(((numHarmonics + 0.5) * f0) / binHz));
  let harmonicEnergy = 0, totalEnergy = 0;
  for (let k = evalLo; k <= evalHi; k++) {
    const p = mags[k] * mags[k];
    totalEnergy += p;
    const fk = k * binHz;
    const n = Math.round(fk / f0);
    if (n >= 1 && n <= numHarmonics) {
      const bw = 15 + 0.015 * f0 * n; // 倍音レベルと同じ帯域定義
      if (Math.abs(fk - n * f0) <= bw) harmonicEnergy += p;
    }
  }
  const noiseEnergy = totalEnergy - harmonicEnergy;
  let hnrDb;
  if (harmonicEnergy <= 0) hnrDb = -20;
  else if (noiseEnergy <= 0) hnrDb = 60;
  else hnrDb = Math.max(-20, Math.min(60, 10 * Math.log10(harmonicEnergy / noiseEnergy)));

  return { harmonics, centroidHz, hnrDb };
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

// フレームの信頼度重み(=MPMのclarity 0..1)。ゲート通過後のclarityは0.8〜1.0の範囲で、
// 際どい検出(0.8近辺)ほど平均値への寄与を下げる。clarity記録前の旧データは1として扱う。
function frameWeight(f) {
  const c = f?.clarity;
  return c === null || c === undefined ? 1 : c;
}

// 音色(倍音・重心・HNR)の集計対象フレームか。ノート冒頭のアタック過渡(noteAgeMs <
// TIMBRE_SUSTAIN_MS)はスペクトルが定常でないため平均から除外する。
// noteAgeMs未記録の旧データは従来どおり集計に含める(後方互換)。
function timbreSustained(f) {
  const age = f?.noteAgeMs;
  return age === null || age === undefined || age >= TIMBRE_SUSTAIN_MS;
}

// clarity重み付き平均。全フレームの平均をとる集計はすべてこれを通す
// (計測タブ・データタブ・ピボットで同じ重み付けになり、値が食い違わない)。
function weightedMean(frames, getValue) {
  let ws = 0, vs = 0;
  for (const f of frames) {
    const v = getValue(f);
    if (v === null || v === undefined || isNaN(v)) continue;
    const w = frameWeight(f);
    ws += w;
    vs += w * v;
  }
  return ws > 0 ? vs / ws : null;
}

// 保存前のフレーム列から単発のピッチ誤検出を除去する。
// 連続する有音3フレームの中央値からPITCH_OUTLIER_CENTS以上外れた真ん中のフレーム
// (オクターブ誤検出=±1200¢が典型)を無音扱いに置き換える。速いパッセージの実音は
// 隣接音でも±数百¢のため閾値未満で残る。2フレーム以上続く誤検出は対象外(実音とみなす)。
function sanitizePitchOutliers(frames, outlierCents = PITCH_OUTLIER_CENTS) {
  if (!frames || frames.length < 3) return frames;
  const cents = frames.map((f) => (f.pitchHz ? 1200 * Math.log2(f.pitchHz / 440) : null));
  const out = frames.slice();
  for (let i = 1; i < frames.length - 1; i++) {
    const a = cents[i - 1], b = cents[i], c = cents[i + 1];
    if (a === null || b === null || c === null) continue;
    const med = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    if (Math.abs(b - med) > outlierCents) {
      // ピッチもそこから導いた音名・音色(誤ったf0で測定されている)もすべて無効化する
      out[i] = {
        ...frames[i],
        pitchHz: null, pitchCents: null, matchedWrittenNote: null, concertNote: null,
        semitoneIndex: null, derivedTubeLengthCm: null, spectralCentroidHz: null,
        hnrDb: null, harmonics: [], clarity: null,
        matchScore: { pitch: { theoretical: 0, ideal: 0 }, timbre: { ideal: 0 } },
      };
    }
  }
  return out;
}

// 音名グルーピングのヒステリシス。実測f0が前フレームの判定音から±holdCents以内なら
// 音名を切り替えない(半音境界±50¢ちょうどの音でフレーム毎に隣の音名と行き来する
// チャタリングを防ぐ)。メーター表示(freqToNote)は正確さ優先で従来どおり生のまま。
function holdFingering(prevEntry, f0, candidate, holdCents = NOTE_SWITCH_CENTS) {
  if (!prevEntry || !candidate || !f0) return candidate;
  if (candidate.semitoneIndex === prevEntry.semitoneIndex) return candidate;
  const centsVsPrev = 1200 * Math.log2(f0 / prevEntry.soundingFreqHz);
  if (Math.abs(centsVsPrev) <= holdCents) return { ...prevEntry, centsError: centsVsPrev };
  return candidate;
}

// 実測f0に対する運指判定の共通処理: 最近傍検索 → 音名ヒステリシス → 範囲外リジェクト。
// 運指テーブルの範囲から±FINGERING_MATCH_MAX_CENTS超外れた音(アルティッシモや
// 他楽器の音等)は「最も近い端の運指」に無理に紐付けず、運指なし(null)として扱う
// (ピッチ・実音名の記録には影響しない。音階グルーピングだけが対象外になる)。
// ライブ計測とオフライン解析の両方からこれを使い、判定を完全に一致させる。
function matchFingering(prevEntry, f0, fingeringTable) {
  const m = holdFingering(prevEntry, f0, findClosestFingering(f0, fingeringTable));
  if (m && Math.abs(m.centsError) > FINGERING_MATCH_MAX_CENTS) return null;
  return m;
}

// RBJ Audio-EQ-Cookbook のバンドパス(ピーク0dB)を1回通すIIRフィルタ。
// Web AudioのBiquadFilterNode(type:"bandpass")と同じ伝達関数で、アップロード解析の
// ノイズゲート判定にライブ計測(バンドパス→gateAnalyser)と同一の帯域限定音量を使うためのもの。
function applyBandpassRBJ(input, sampleRate, centerHz, q) {
  const w0 = (2 * Math.PI * centerHz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW0 = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0;
  const a1 = (-2 * cosW0) / a0, a2 = (1 - alpha) / a0;
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return out;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stddev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
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

// 一覧に生のISO文字列("2026-07-31")を出さないための表示用フォーマッタ。
// 値が無い/壊れている場合は null を返し、呼び出し側で「未設定」の文言に振り替える
// (欠測でも行が崩れないようにするため、ここでは空文字を返さない)。
function formatYmd(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// リード1本ぶんの計測フレーム総数。ReedCompareTab が同じ集計をローカルに持っており
// (「Nフレーム」の表示に使っている)、リード登録一覧の「育てる」表示でも同じ数を使う。
// 新しい集計は足さない: この関数と usageDays() の2つだけで「開封からの日数 / 使用量」を出す。
function frameCountFor(sessions, reedId) {
  return sessions.filter((s) => s.reedId === reedId).reduce((n, s) => n + (s.frames?.length ?? 0), 0);
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
// 楽器音の判定はライブ計測と同一: 計測下限dB(ノイズゲート)+ヒステリシス、MPMのclarity、
// 音色系(重心/HNR/倍音)はさらに余裕(TIMBRE_EXTRA_DB)のある音量でだけ測定する。
// これにより、ほぼ無音の区間やノイズ区間から誤ったピッチ・音色データが記録されるのを防ぐ。
function createFrameAnalyzer({ saxType, tuningHz, instrumentOffsetCents, temperature, selectedIdeal, noiseGateDb = NOISE_GATE_DEFAULT_DB }) {
  const preset = SAX_PRESETS[saxType];
  const effectiveTuningHz = tuningHz * Math.pow(2, instrumentOffsetCents / 1200);
  const fingeringTable = buildFingeringTable(saxType, effectiveTuningHz);
  const { minFreq: pitchMinFreq, maxFreq: pitchMaxFreq } = saxPitchBounds(saxType, effectiveTuningHz);
  const FFT_SIZE = 8192;
  const NUM_HARMONICS = 8;
  const SAMPLE_INTERVAL_MS = 100;
  const ATTACK_WINDOW_MS = 400;

  const frames = [];
  const noteDetector = { phase: "silence", onsetMs: 0, peakDb: -100, samples: [], events: [] };
  let lastSampleMs = -Infinity;
  let sounding = false; // 発音中フラグ(ヒステリシス判定に使う。ライブのsoundingRefに相当)
  let lastFinger = null; // 音名グルーピングのヒステリシス用(前フレームの判定運指)

  const tick = (analyser, sampleRate, elapsedMs) => {
    // 時間領域波形(RMS音量・MPMピッチ検出・音色測定のすべてに使う)。
    // 旧実装はここでanalyser.getFloatFrequencyData(平滑済みスペクトル)も読んで
    // 音色を計算していたが、computeTimbreMetricsが時間波形から自前計算するため不要。
    let timeBuf = null;
    if (analyser.getFloatTimeDomainData) {
      timeBuf = new Float32Array(FFT_SIZE);
      analyser.getFloatTimeDomainData(timeBuf);
    }

    // 音量はライブと同じ時間領域RMS(dBFS)。旧来のFFT振幅由来のdBはスケールが独自で、
    // ライブで設定した計測下限dBと比較できないため使わない。
    let vDb = -100;
    if (timeBuf) {
      let ss = 0;
      for (let i = 0; i < timeBuf.length; i++) ss += timeBuf[i] * timeBuf[i];
      vDb = 20 * Math.log10(Math.sqrt(ss / timeBuf.length) + 1e-10);
    }

    // ゲート判定用の帯域限定音量。ライブ計測はバンドパス後の音量で判定するため、
    // 解析元がバンドパス済み波形(getGateTimeDomainData)を提供できる場合はそれを使う。
    // 提供がない場合はフルバンドRMSにフォールバック(従来動作)。
    let gateDbLevel = vDb;
    if (analyser.getGateTimeDomainData) {
      const gb = new Float32Array(FFT_SIZE);
      analyser.getGateTimeDomainData(gb);
      let s2 = 0;
      for (let i = 0; i < gb.length; i++) s2 += gb[i] * gb[i];
      gateDbLevel = 20 * Math.log10(Math.sqrt(s2 / gb.length) + 1e-10);
    }

    // ピッチ検出はライブと同じMPM(時間領域)+clarityゲート
    let f0 = null;
    let mpmClarity = null; // フレームに信頼度として記録(集計の重み付けに使う)
    if (timeBuf) {
      const mpm = detectPitchMPM(timeBuf, sampleRate, pitchMinFreq, pitchMaxFreq);
      if (mpm && mpm.clarity >= PITCH_CLARITY_MIN) { f0 = mpm.freq; mpmClarity = mpm.clarity; }
    }

    // --- 楽器音の判定(ライブ計測と同一: バンドパス後音量のゲート+ヒステリシス) ---
    const hasPitch = !!(f0 && f0 > 40);
    const aboveGate = gateDbLevel > (sounding ? noiseGateDb - GATE_HYSTERESIS_DB : noiseGateDb);
    sounding = hasPitch && aboveGate;
    const timbreMeasurable = sounding && gateDbLevel > noiseGateDb + TIMBRE_EXTRA_DB;

    let levels = [];
    let hnr = null;
    let centroid = null;
    let matchedFinger = null;
    if (sounding) {
      // 最近傍検索+ヒステリシス+範囲外リジェクト(ライブと同一のmatchFingering)
      matchedFinger = matchFingering(lastFinger, f0, fingeringTable);
      lastFinger = matchedFinger;
    } else {
      lastFinger = null;
    }
    if (timbreMeasurable && timeBuf) {
      // 音色(倍音・重心・HNR)はライブと完全に同一の計算(computeTimbreMetrics)
      const tm = computeTimbreMetrics(timeBuf, sampleRate, f0, NUM_HARMONICS);
      if (tm) {
        const maxMag = Math.max(...tm.harmonics.map((l) => l.mag), 1e-6);
        levels = tm.harmonics.map((l) => ({ ...l, norm: l.mag / maxMag }));
        hnr = tm.hnrDb;
        centroid = tm.centroidHz;
      }
    }

    // --- ノート区間分割・アタック時間検出(企画書2.4節相当) ---
    // ノート境界は「楽器音と判定されているか(sounding)」で決める(ライブと同じ)。
    {
      const det = noteDetector;
      if (det.phase === "silence") {
        if (sounding) {
          det.phase = "attack"; det.onsetMs = elapsedMs; det.peakDb = vDb; det.samples = [{ t: elapsedMs, vDb }];
        }
      } else if (det.phase === "attack") {
        det.samples.push({ t: elapsedMs, vDb });
        if (vDb > det.peakDb) det.peakDb = vDb;
        if (!sounding) {
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
        if (!sounding) {
          const last = det.events[det.events.length - 1];
          if (last && last.endT === null) { last.endT = elapsedMs / 1000; last.peakVolumeDb = det.peakDb; }
          det.phase = "silence";
        }
      }
    }

    if (elapsedMs - lastSampleMs >= SAMPLE_INTERVAL_MS) {
      lastSampleMs = elapsedMs;
      // ピッチのセント誤差はライブと同じ「実効基準ピッチのfreqToNote」で統一する
      const noteNow = sounding ? freqToNote(f0, effectiveTuningHz) : null;
      const pitchCentsVsTheory = noteNow ? noteNow.centsExact : null;
      // 理想値は音(運指の半音インデックス)ごとに持つため、今判定されている音に対応する理想値を都度引く
      const noteIdeal = getNoteIdeal(selectedIdeal, matchedFinger?.semitoneIndex);
      const pitchCentsVsIdeal = sounding && noteIdeal?.pitchHz ? centsBetween(f0, noteIdeal.pitchHz) : null;
      const harmNorm = levels.length === NUM_HARMONICS ? levels.map((l) => l.norm) : new Array(NUM_HARMONICS).fill(0);
      const idealHarmNorm = noteIdeal?.harmonicsProfile ? noteIdeal.harmonicsProfile.map((h) => h.norm) : new Array(NUM_HARMONICS).fill(0);
      const pitchScoreTheory = pitchCentsVsTheory !== null ? pitchMatchScore(pitchCentsVsTheory) : 0;
      const pitchScoreIdeal = pitchCentsVsIdeal !== null ? pitchMatchScore(pitchCentsVsIdeal) : 0;
      const timbreScoreIdeal = noteIdeal && timbreMeasurable && centroid !== null
        ? timbreMatchScore(harmNorm, idealHarmNorm, centroid, noteIdeal.centroidHz, hnr, noteIdeal.hnrDb)
        : 0;

      frames.push({
        t: elapsedMs / 1000,
        pitchHz: sounding ? f0 : null,
        pitchCents: pitchCentsVsTheory,
        matchedWrittenNote: matchedFinger?.writtenLabel ?? null,
        concertNote: noteNow ? `${noteNow.name}${noteNow.octave}` : null,
        semitoneIndex: matchedFinger?.semitoneIndex ?? null,
        derivedTubeLengthCm: matchedFinger ? deriveTubeLengthCm(matchedFinger.soundingFreqHz, preset.bellRadiusCm, temperature) : null,
        clarity: sounding ? mpmClarity : null, // 検出信頼度(集計の重み)
        noteAgeMs: noteDetector.phase !== "silence" ? Math.round(elapsedMs - noteDetector.onsetMs) : null, // ノート開始からの経過(アタック除外判定用)
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

// radix-2の反復型FFT(in-place)。MPMピッチ検出の自己相関と、音色測定
// (computeTimbreMetrics)のスペクトル計算に使う。ブラウザのOfflineAudioContext+
// ScriptProcessorNodeはSafari(iPhone含む)でレンダリングが永遠に完了しない既知の
// 不具合があるため、オーディオグラフに頼らずデコード済みPCMを直接処理する。
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

// ============================================================
// 動画から音声トラックだけをWebCodecsで高速デコードする(スマホ直撮り動画向け)。
// mp4box.jsでMP4/MOVコンテナをデマクスし、音声サンプルだけをAudioDecoderに流す。
// 動画トラックは一切デコードしないため、実時間再生に頼る旧フォールバックより桁違いに速い。
// 非対応環境(古いiOS等)・非対応コーデック・デマクス失敗時は例外を投げ、呼び出し側で
// 従来の<video>再生経路にフォールバックする。返り値は {pcm: Float32Array(モノラル), sampleRate}。
// ============================================================
async function extractAudioViaWebCodecs(file, { onProgress } = {}) {
  if (typeof AudioDecoder === "undefined" || typeof EncodedAudioChunk === "undefined") {
    throw new Error("WebCodecs非対応");
  }
  // 使う時だけ読み込む(メインバンドルを重くしない)。CJS/ESMどちらの形でも拾えるようにする。
  const mod = await import("mp4box");
  const MP4Box = mod.default ?? mod;

  // mp4boxのstsdエントリからAAC等のAudioSpecificConfig(AudioDecoderのdescription)を取り出す
  const getDescription = (mp4file, trackId) => {
    const trak = mp4file.getTrackById(trackId);
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const box = entry.esds || entry.mha1 || entry.mhaC;
      if (entry.esds && entry.esds.esd) {
        try {
          // esd.descs[0](DecoderConfigDescriptor).descs[0](DecoderSpecificInfo).data
          const dsi = entry.esds.esd.descs[0].descs[0];
          if (dsi && dsi.data) return dsi.data;
        } catch { /* 構造が違えばdescriptionなしで試す */ }
      }
      if (box) { /* AAC以外は基本descriptionなしで通す */ }
    }
    return undefined;
  };

  return await new Promise((resolve, reject) => {
    const mp4 = MP4Box.createFile();
    let decoder = null;
    let track = null;
    let sampleRate = 0;
    let totalSec = 0, decodedFrames = 0;
    const pcmChunks = [];
    let settled = false;
    const done = (err, val) => {
      if (settled) return;
      settled = true;
      try { if (decoder && decoder.state !== "closed") decoder.close(); } catch { /* noop */ }
      if (err) reject(err); else resolve(val);
    };

    mp4.onError = (e) => done(new Error("動画コンテナの解析に失敗: " + e));

    mp4.onReady = (info) => {
      track = info.audioTracks && info.audioTracks[0];
      if (!track) { done(new Error("この動画に音声トラックがありません")); return; }
      sampleRate = track.audio.sample_rate;
      totalSec = (info.duration && info.timescale) ? info.duration / info.timescale : 0;
      const numberOfChannels = track.audio.channel_count || 1;

      decoder = new AudioDecoder({
        output: (audioData) => {
          try {
            const nFrames = audioData.numberOfFrames;
            const nCh = audioData.numberOfChannels;
            const mono = new Float32Array(nFrames);
            const plane = new Float32Array(nFrames);
            for (let ch = 0; ch < nCh; ch++) {
              audioData.copyTo(plane, { planeIndex: ch, format: "f32-planar" });
              for (let i = 0; i < nFrames; i++) mono[i] += plane[i];
            }
            if (nCh > 1) for (let i = 0; i < nFrames; i++) mono[i] /= nCh;
            pcmChunks.push(mono);
            decodedFrames += nFrames;
            if (onProgress && totalSec) onProgress(Math.min(0.98, (decodedFrames / sampleRate) / totalSec));
          } finally {
            audioData.close();
          }
        },
        error: (e) => done(new Error("音声デコードに失敗: " + (e?.message ?? e))),
      });

      let description;
      try { description = getDescription(mp4, track.id); } catch { /* noop */ }
      try {
        decoder.configure({ codec: track.codec, sampleRate, numberOfChannels, ...(description ? { description } : {}) });
      } catch (e) {
        done(new Error("このコーデックはWebCodecsで扱えません: " + (e?.message ?? e)));
        return;
      }

      mp4.setExtractionOptions(track.id, null, { nbSamples: 2000 });
      mp4.start();
    };

    mp4.onSamples = (trackId, ref, samples) => {
      if (settled || !decoder) return;
      for (const s of samples) {
        decoder.decode(new EncodedAudioChunk({
          type: s.is_sync ? "key" : "delta",
          timestamp: (s.cts * 1e6) / s.timescale,
          duration: (s.duration * 1e6) / s.timescale,
          data: s.data,
        }));
      }
    };

    // ファイルをチャンクで読み、mp4boxへ順次追記する。スマホ動画はmoovが末尾にあることが多く、
    // onReadyは全チャンク追記後に発火する(=全体を読み終えてから音声デコードを開始する)。
    (async () => {
      try {
        const reader = file.stream().getReader();
        let offset = 0;
        for (;;) {
          const { done: rdone, value } = await reader.read();
          if (rdone) break;
          const ab = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
          ab.fileStart = offset;
          offset += ab.byteLength;
          mp4.appendBuffer(ab);
        }
        mp4.flush();
        // 全サンプル投入後、デコーダをflushしてから連結する
        if (!decoder) { done(new Error("音声トラックを取得できませんでした")); return; }
        await decoder.flush();
        const total = pcmChunks.reduce((a, c) => a + c.length, 0);
        if (total === 0) { done(new Error("音声を取り出せませんでした")); return; }
        const merged = new Float32Array(total);
        let o = 0;
        for (const c of pcmChunks) { merged.set(c, o); o += c.length; }
        if (onProgress) onProgress(0.99);
        done(null, { pcm: merged, sampleRate });
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });
}

// AudioBufferを直接デコードできた場合の高速パス。デコード済みPCMを25ms刻みで
// ライブ計測と同じtick()パイプラインに流す。再生を伴わないためファイル長に関係なく
// 数秒で完了し、ブラウザの自動再生ポリシーやオーディオグラフの実装差の影響も受けない。
// UIをブロックしないよう30msごとにイベントループへ譲る。
// スペクトルの事前計算はしない: 音色測定はtick内のcomputeTimbreMetricsが時間波形から
// 自前で行うため、ここでは生波形の窓を渡すだけでライブ計測と完全に同一の値になる。
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

  // ノイズゲート判定用に、ライブ計測と同じバンドパス(楽器種別ごとの中心周波数)を
  // かけた波形も用意する。ライブはBiquadFilterNode→gateAnalyserの帯域限定音量で
  // ゲート判定するため、オフラインも同じ帯域限定音量で判定しないと結果が一致しない。
  const gateMono = applyBandpassRBJ(mono, sampleRate, SAX_PRESETS[opts.saxType]?.gateBandpassHz ?? BANDPASS_FREQ_HZ, BANDPASS_Q);

  // fa.tick()はAnalyserNode互換のインターフェースだけを使うため、互換オブジェクトを渡す。
  // getFloatTimeDomainDataは現在解析中の窓の生波形(MPMピッチ検出・音色測定用)、
  // getGateTimeDomainDataはバンドパス済み波形(ノイズゲート判定用)を返す。
  const analyserLike = {
    getFloatTimeDomainData: (out) => out.set(mono.subarray(curPos.pos, curPos.pos + FFT_SIZE)),
    getGateTimeDomainData: (out) => out.set(gateMono.subarray(curPos.pos, curPos.pos + FFT_SIZE)),
  };
  const curPos = { pos: 0 };

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
        curPos.pos = pos; // 時間波形窓を現在位置に同期
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
  const { onProgress, onNeedTap } = opts;
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
    // ライブ計測と同じバンドパス→ゲート用アナライザ(ノイズゲート判定を帯域限定音量で行う)
    const bandpass = audioCtx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = SAX_PRESETS[opts.saxType]?.gateBandpassHz ?? BANDPASS_FREQ_HZ;
    bandpass.Q.value = BANDPASS_Q;
    const gateAnalyser = audioCtx.createAnalyser();
    gateAnalyser.fftSize = FFT_SIZE;
    // fa.tick()にはAnalyserNode互換+ゲート波形取得を足したラッパーを渡す
    const analyserLike = {
      getFloatTimeDomainData: (out) => analyser.getFloatTimeDomainData(out),
      getGateTimeDomainData: (out) => gateAnalyser.getFloatTimeDomainData(out),
    };
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
      sourceNode.connect(bandpass);
      bandpass.connect(gateAnalyser);
      analyser.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      const duration = Number.isFinite(mediaEl.duration) ? mediaEl.duration : 0;

      const finish = () => {
        if (finished) return;
        cleanup();
        resolve({ frames: fa.frames, noteEvents: fa.noteEvents });
      };

      // 再生位置が10秒間進まなければ停滞とみなす
      let lastTime = -1;
      let lastAdvance = performance.now();

      const tick = () => {
        if (finished) return;
        // 経過時間は壁時計ではなく再生位置を使う(バッファリング等で再生が波打っても音声内の時刻と一致する)
        const elapsedMs = mediaEl.currentTime * 1000;
        fa.tick(analyserLike, audioCtx.sampleRate, elapsedMs);
        if (onProgress && duration) onProgress(Math.min(1, mediaEl.currentTime / duration));
        if (mediaEl.currentTime !== lastTime) { lastTime = mediaEl.currentTime; lastAdvance = performance.now(); }
        else if (performance.now() - lastAdvance > 10000) { fail("再生が進まないため解析を中断しました"); return; }
        if (mediaEl.ended) { finish(); return; }
        rafId = requestAnimationFrame(tick);
      };

      mediaEl.onended = finish;

      // 再生開始に成功してから各種見張りタイマーを起動する(ユーザーのタップ待ちの間に
      // タイムアウトしてしまわないよう、開始前には仕掛けない)。
      const begin = () => {
        if (finished) return;
        lastAdvance = performance.now();
        // 再生時間+15秒経っても終わらなければ打ち切る(デコード停止などでendedが来ないケースの保険)
        if (duration > 0) timers.push(setTimeout(() => { if (!finished) fail("解析がタイムアウトしました"); }, (duration + 15) * 1000));
        rafId = requestAnimationFrame(tick);
      };
      const tryStart = () => Promise.all([audioCtx.resume(), mediaEl.play()]).then(begin);

      tryStart().catch(() => {
        // 自動再生の制限でブロックされた場合(ファイル選択のタップから時間が経っていると
        // iOS/Chromeはジェスチャ外の再生を拒否する)、失敗にはせず「タップして開始」を
        // 呼び出し側に依頼する。渡した関数は新しいタップのイベント内で呼んでもらう。
        if (onNeedTap) {
          onNeedTap(() => tryStart().catch(() => fail("ブラウザが再生をブロックしました。もう一度お試しください")));
        } else {
          fail("ブラウザが再生をブロックしました。もう一度お試しください");
        }
      });
    };
  });
}

// ============================================================
// マイク接続の生存監視・復旧(iOS対策)
// ============================================================
// 【背景】アプリを一度バックグラウンドにして戻ると、マイクは繋がっている(readyState="live")のに
// 解析バッファが全ゼロのまま=音量が -200dB 付近に張り付いたまま戻らない、という不具合がある。
// -200 は 20*log10(0 + 1e-10) の値、つまり「バッファが完全にゼロ」の状態を意味する。
// 静かな部屋の実測は -60dB 前後なので、-200 近傍は「ストリームが死んでいる」ことの明確な指標になる。

// ウォッチドッグの無音しきい値(dBFS)。これ以下を「バッファが全ゼロ=死んでいる」とみなす。
// -150dB の RMS は約 3.2e-8 で、24bit の最下位ビット(-144dB)より下。実マイクの暗騒音では
// 到達しえない値なので、静かな部屋(-60dB前後)で誤発火しない。全ゼロ(-200)とは 50dB の余裕がある。
const SILENCE_WATCHDOG_DB = -150;
// この時間だけ連続で全ゼロが続いたら壊れているとみなす(起動直後の数フレームでは発火させない)
const SILENCE_WATCHDOG_SUSTAIN_MS = 1500;
// 復旧を連打しないためのクールダウン。マイク再取得は端末のインジケータを点滅させるため間隔を空ける
const MIC_RECOVER_COOLDOWN_MS = 5000;
// ユーザーが「画面をタップしてください」に応えてタップしたときのクールダウン。自動復旧より短くして
// 待たせないが、0にはしない(連打すると連打ぶんだけマイクを取り直してしまうため)。
const MIC_RETRY_TAP_COOLDOWN_MS = 1000;
// 復旧に失敗したときにユーザーへ出す文言(タップで再試行できることを明示する)
const MIC_RECOVER_FAILED_MSG = "マイクを再接続できませんでした。画面をタップしてください";

// iOSはマイク使用中、既定でオーディオ出力を受話口(小音量)側に回すため、メトロノームが極端に
// 小さく聞こえる。setSinkId は iOS Safari 未実装、AVAudioSessionCategoryOptionDefaultToSpeaker は
// ネイティブ専用でWebから触れないため、Web側から確実にルートを変える手段は現状無い。
// navigator.audioSession(Safariのみ実装)への用途宣言だけが唯一試せる手で、どの値が最適かは
// 実機でしか確認できない。後から差し替えられるよう値はこの1箇所の定数にまとめる。
// 候補: "play-and-record"(録音を伴う再生) / "playback" / "ambient" / "auto"
const AUDIO_SESSION_TYPE = "play-and-record";
function applyAudioSessionType() {
  // 未対応環境ではプロパティ自体が無いので何も起きない(例外も握りつぶす)
  try { if (typeof navigator !== "undefined" && navigator.audioSession) navigator.audioSession.type = AUDIO_SESSION_TYPE; } catch { /* noop */ }
}

// AudioContext の state から取るべき手を決める(純関数)。
// iOS Safari は仕様外の "interrupted" を返すことがあるため明示的に扱う
// (=== "suspended" だけの判定では漏れる)。未知の値は安全側=作り直しに倒す。
// 戻り値: "ok"(そのまま使える) | "resume"(resume()で戻せる見込み) | "rebuild"(作り直しが必要)
function audioCtxRecoveryAction(state) {
  if (state === "running") return "ok";
  if (state === "suspended" || state === "interrupted") return "resume";
  return "rebuild"; // "closed" と未知の状態
}

// マイクのトラックが実際に音を運べる状態か(純関数)。readyState が live でも、iOSは中断中に
// muted=true のまま返すことがあるため両方を見る。muted が未実装の環境で誤って毎回取り直さないよう
// 「muted が明示的に true のときだけ駄目」と判定する。
function isMicTrackUsable(track) {
  return !!track && track.readyState === "live" && track.muted !== true;
}
function isMicStreamUsable(stream) {
  const tracks = stream?.getTracks?.() || [];
  return tracks.length > 0 && tracks.some(isMicTrackUsable);
}

// 無音ウォッチドッグの判定(純関数)。解析ループから毎フレーム呼ぶ。
//   volumeDb        : そのフレームの音量(dBFS)
//   prevSilentFrames: 直前フレームまでの連続無音フレーム数
//   frameIntervalMs : 実測したフレーム間隔(ms)。rAFなので端末により16.7〜33msと幅がある
//   isRecording     : 録音中は復旧を走らせない(セッションが壊れるため)
//   nowMs/lastRecoverAtMs: クールダウン判定用
// 戻り値: { silentFrames(更新後のカウンタ), recover(復旧を走らせるか) }
// ※引数の分割代入は関数の本体側で行う(テストハーネスのextractFunctionが波括弧の対応で
//   関数末尾を探すため、シグネチャに { } を書くとそこで切れてしまう)。
function shouldRecoverFromSilence(opts) {
  const o = opts || {};
  const volumeDb = o.volumeDb;
  const prevSilentFrames = o.prevSilentFrames || 0;
  const frameIntervalMs = o.frameIntervalMs || 0;
  const isRecording = o.isRecording === true;
  const nowMs = o.nowMs || 0;
  const lastRecoverAtMs = o.lastRecoverAtMs || 0;
  const thresholdDb = o.thresholdDb === undefined ? SILENCE_WATCHDOG_DB : o.thresholdDb;
  const sustainMs = o.sustainMs === undefined ? SILENCE_WATCHDOG_SUSTAIN_MS : o.sustainMs;
  const cooldownMs = o.cooldownMs === undefined ? MIC_RECOVER_COOLDOWN_MS : o.cooldownMs;
  const silent = Number.isFinite(volumeDb) ? volumeDb <= thresholdDb : true;
  const silentFrames = silent ? prevSilentFrames + 1 : 0;
  if (!silent) return { silentFrames, recover: false };
  if (isRecording) return { silentFrames, recover: false };
  if (!(frameIntervalMs > 0)) return { silentFrames, recover: false };
  if (silentFrames * frameIntervalMs < sustainMs) return { silentFrames, recover: false };
  if (nowMs - lastRecoverAtMs < cooldownMs) return { silentFrames, recover: false };
  return { silentFrames, recover: true };
}

// 中断された AudioContext を running に戻す。resume() を呼んでも running にならなければ、
// そのコンテキストを close() して作り直す。作り直した場合は rebuilt:true を返すので、
// 呼び出し側は「古いノードは新しいコンテキストに繋げない」ため source/analyser/バンドパスを
// すべて作り直さなければならない。
async function recoverAudioContext(ctx, createCtx) {
  const create = createCtx || (() => new (window.AudioContext || window.webkitAudioContext)());
  if (ctx && audioCtxRecoveryAction(ctx.state) === "resume") {
    try { await ctx.resume(); } catch { /* noop */ }
  }
  if (ctx && ctx.state === "running") return { ctx, rebuilt: false };
  if (ctx && ctx.state !== "closed") { try { await ctx.close(); } catch { /* noop */ } }
  const fresh = create();
  try { await fresh.resume(); } catch { /* noop */ }
  return { ctx: fresh, rebuilt: true };
}

// ============================================================
// Main component
// ============================================================
export default function WindToneLabPhaseMode() {
  const [topTab, setTopTab] = useState("measure"); // "measure" | "reeds" | "analysis"
  const [reedsSubTab, setReedsSubTab] = useState("register"); // 「リード」タブ内の子タブ: register | compare | ranking
  // 下部ナビのタップ毎にインクリメントする通し番号。リード/データタブの中身のkeyに使い、
  // タブをタップすると(既にそのタブにいても)子ビューが再マウントされ、開いていた
  // 個別リード/個別セッションの詳細が閉じてトップページに戻るようにする。
  const [navNonce, setNavNonce] = useState(0);
  const handleNavTap = useCallback((key) => {
    if (isRecordingRef.current) return;
    if (key === "reeds") setReedsSubTab("register"); // リードタブのトップは「登録」子タブ
    setTopTab(key);
    setNavNonce((n) => n + 1);
  }, []);
  const [compareReedIds, setCompareReedIds] = useState([]); // 「比較」タブで選択中のリード(タブ切替をまたいで保持)
  // isListening: マイク+ライブ表示が有効か(計測タブ滞在中は自動でON/OFF)。
  // isRecording: 録音ボタンで蓄積中かどうか(セッションとして保存されるのはこの間のフレームのみ)。
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [pitch, setPitch] = useState(null);
  const [harmonicLevels, setHarmonicLevels] = useState([]);
  const [volumeDb, setVolumeDb] = useState(-100);
  const [centroidHz, setCentroidHz] = useState(0);
  const [hnrDb, setHnrDb] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const [saxType, setSaxType] = usePersistedState("saxType", "alto");
  const [noiseGateDb, setNoiseGateDb] = usePersistedState("noiseGateDb", NOISE_GATE_DEFAULT_DB); // 楽器音だけ拾うためのノイズゲート(dBFS)
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
  const isAnalyzingUploadRef = useRef(false); // 可視状態復帰時のWake Lock再取得判定に使う
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadNeedsTap, setUploadNeedsTap] = useState(null); // 自動再生ブロック時の再開関数(タップで呼ぶ)
  const [lastUploadedSession, setLastUploadedSession] = useState(null); // 解析完了直後に「理想値に設定」を出すため

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const gateAnalyserRef = useRef(null); // バンドパス後の音量(ノイズゲート判定)用のアナライザ
  const bandpassRef = useRef(null);     // ゲート用バンドパス(楽器種別変更時に中心周波数を追従させる)
  const [micProcessingWarning, setMicProcessingWarning] = useState(""); // 端末がAGC等を無効化できなかった時の警告
  const rafRef = useRef(null);
  const tickRef = useRef(null); // 描画ループ本体(tick)。タブ切替でマイクを繋ぎ直さずループだけ再開するために保持する
  const streamRef = useRef(null);
  // --- マイク生存監視・復旧(iOS対策。詳細はファイル上部 SILENCE_WATCHDOG_DB 付近のコメント) ---
  const silentFramesRef = useRef(0);      // 連続で「バッファ全ゼロ」だったフレーム数
  const lastFrameAtRef = useRef(0);       // 直前フレームの時刻(フレーム間隔を実測してms換算するため)
  const micRecoverAtRef = useRef(0);      // 直近に復旧を走らせた時刻(クールダウン用)
  const micRecoveringRef = useRef(false); // 復旧処理の多重起動防止
  const micNeedsRetryRef = useRef(false); // 復旧に失敗しユーザーのタップ待ちである
  const recoverMicRef = useRef(() => {});  // 復旧関数の最新版(tick/トラックイベントのクロージャから呼ぶ)
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
  const soundingRef = useRef(false);   // 発音中フラグ(ヒステリシス判定に使う)
  const lastFingerRef = useRef(null);  // 音名グルーピングのヒステリシス用(前フレームの判定運指)
  // --- メトロノーム連携(エンジン本体はMeasureView内。ここは計測との干渉対策用) ---
  const scheduledClicksRef = useRef([]); // クリック予定時刻(performance.now()基準・昇順)。tickが近傍判定に読む
  const metroActiveRef = useRef(false);  // メトロノーム動作中フラグ(録音停止時のWake Lock解放判定に使う)
  const metroBarPerfTimesRef = useRef([]); // メトロノームのアクセント(=小節頭)の予定時刻(performance.now基準)。録音中に貯め、小節線として保存する
  const recStartPerfRef = useRef(null);   // 録音開始時のperformance.now()。小節線を録音相対秒に変換するのに使う(phraseStartTimeRefは停止時にnull化されるため別に持つ)
  // 音色(倍音・重心・HNR)の"表示"を安定させるためのローリングバッファ。
  // 測定はフレーム毎に正確に行い記録するが、画面表示は直近の有効値の中央値にすることで、
  // ・音の遷移(レガート)で一瞬混ざった外れ値を弾き、
  // ・一瞬測れないフレームでも直近値を保持して行が「—」に落ちてガタつくのを防ぐ。
  const timbreDisplayRef = useRef({ centroid: [], hnr: [], harmonics: [], validMs: 0, lastNote: null, changedMs: 0, stale: false, lastComputeMs: 0, lastCentroid: null, lastHnr: null, lastLevels: [] });
  const noiseGateDbRef = useRef(noiseGateDb);
  useEffect(() => { noiseGateDbRef.current = noiseGateDb; }, [noiseGateDb]);
  // マイク接続中に楽器種別を変えたら、ゲート用バンドパスの中心周波数も追従させる
  useEffect(() => {
    if (bandpassRef.current) bandpassRef.current.frequency.value = SAX_PRESETS[saxType]?.gateBandpassHz ?? BANDPASS_FREQ_HZ;
  }, [saxType]);

  // --- ノート区間分割・アタック時間検出(企画書2.4節のnoteEvents、rAFレートで検出) ---
  // 100msフレームではアタック(典型20〜100ms)を測れないため、tick毎(約60fps)に音量エンベロープを監視する。
  // 状態機械: silence → attack(立ち上がり計測中) → sustain → (音量低下で) silence
  const noteDetectorRef = useRef({ phase: "silence", onsetMs: 0, peakDb: -100, samples: [], events: [] });
  const [phraseNoteEvents, setPhraseNoteEvents] = useState([]);
  const ATTACK_WINDOW_MS = 400; // アタック確定までの観測窓
  const SAMPLE_INTERVAL_MS = 100;

  const FFT_SIZE = 8192;
  const NUM_HARMONICS = 8;
  const preset = SAX_PRESETS[saxType];

  // 運指テーブルは saxType / tuningHz / 個体差オフセット が変わった時だけ再計算。
  // 個体差オフセット(セント)は基準ピッチに乗算する形でテーブル全体をシフトする:
  //   実効基準Hz = tuningHz × 2^(offsetCents/1200)
  const fingeringTable = useMemo(
    () => buildFingeringTable(saxType, tuningHz * Math.pow(2, instrumentOffsetCents / 1200)),
    [saxType, tuningHz, instrumentOffsetCents]
  );

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
  // メーターと折れ線グラフ・フレームで0¢の基準を完全に一致させるため、実効基準ピッチ
  // (基準Hz×個体差オフセット)をtickからも読めるようrefで保持する。
  const effectiveTuningHz = tuningHz * Math.pow(2, instrumentOffsetCents / 1200);
  const effectiveTuningRef = useRef(effectiveTuningHz);
  // ピッチ検出の音域(楽器種別+基準ピッチから算出)。音域外の幻の高音を拾わないよう
  // detectPitchMPMに渡す。tickから毎回参照するためref化し、種別・基準変更で更新する。
  const pitchBoundsRef = useRef(saxPitchBounds(saxType, effectiveTuningHz));
  useEffect(() => { pitchBoundsRef.current = saxPitchBounds(saxType, effectiveTuningHz); }, [saxType, effectiveTuningHz]);
  useEffect(() => { fingeringTableRef.current = fingeringTable; }, [fingeringTable]);
  useEffect(() => { presetRef.current = preset; }, [preset]);
  useEffect(() => { temperatureRef.current = temperature; }, [temperature]);
  useEffect(() => { selectedIdealRef.current = selectedIdeal; }, [selectedIdeal]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { effectiveTuningRef.current = effectiveTuningHz; }, [effectiveTuningHz]);

  // 録音停止時、蓄積フレームがあればセッション候補(pendingSession)として保持する。
  // 以前は停止と同時に自動保存していたが、「登録 or 取り直し」を選べるように、ここでは
  // 保存せず候補として持ち、ユーザーが「登録」を押したときにだけ実際に保存する。
  const [pendingSession, setPendingSession] = useState(null);
  const finalizeRecording = useCallback(() => {
    if (phraseFramesRef.current.length > 0) {
      // メトロノームのアクセント(小節頭)が録音中に鳴っていれば、その時刻を録音開始からの
      // 相対秒(フレームのtと同じ座標)に変換して小節線として保存する。
      const startPerf = recStartPerfRef.current;
      const endPerf = performance.now();
      let barlines = [];
      if (startPerf !== null) {
        barlines = metroBarPerfTimesRef.current
          .filter((p) => p >= startPerf - 20 && p <= endPerf + 20)
          .map((p) => (p - startPerf) / 1000)
          .filter((t) => t >= 0);
      }
      const session = {
        id: generateId(),
        recordedAt: new Date().toISOString(),
        saxType,
        reedId: selectedReedId,
        linkedAt: selectedReedId ? "eager" : null,
        memo: null,
        performer: selectedPerformer,
        source: "live",
        frames: sanitizePitchOutliers(phraseFramesRef.current), // 単発のオクターブ誤検出等を除去してから保存
        barlines, // メトロノームのアクセント由来の小節頭の時刻(秒)。タイムラインに縦線として描く
        noteEvents: noteDetectorRef.current.events, // ノート区間分割・アタック時間(企画書2.4節・4節のnoteEvents)
      };
      setPendingSession(session);
    }
  }, [saxType, selectedReedId, selectedPerformer]);
  // 画面スリープ抑止(Wake Lock)。録音中に取得し、停止時に解放する。ブラウザが未対応でも黙って無視。
  // 画面が一度隠れるとWake Lockは自動解放されるため、復帰時に録音中なら再取得する。
  const wakeLockRef = useRef(null);
  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener?.("release", () => { wakeLockRef.current = null; });
      }
    } catch { /* 未対応・失敗時は何もしない */ }
  }, []);
  const releaseWakeLock = useCallback(() => {
    try { wakeLockRef.current?.release(); } catch { /* noop */ }
    wakeLockRef.current = null;
  }, []);

  const registerPendingSession = useCallback(() => {
    if (pendingSession) addSession(pendingSession);
    setPendingSession(null);
    setPhraseFrames([]);
    phraseFramesRef.current = [];
  }, [pendingSession, addSession]);
  const discardPendingSession = useCallback(() => {
    setPendingSession(null);
    setPhraseFrames([]);
    phraseFramesRef.current = [];
  }, []);

  // マイクを完全に止める(画面を隠した時・アンマウント時に呼ぶ)。マイクデバイスを解放し、
  // 端末のマイク使用インジケータも消える。録音中に離脱した場合の保険としてここでも保存する。
  const stopListening = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => {
      // 停止させる前にハンドラを外す(t.stop()自体でendedが飛ぶ実装があり、意図しない復旧を招くため)
      t.onmute = null;
      t.onended = null;
      t.stop();
    });
    streamRef.current = null;
    tickRef.current = null;
    silentFramesRef.current = 0;
    lastFrameAtRef.current = 0;
    // 古いノードを新しいコンテキストに繋がないよう、コンテキストと一緒に必ず捨てる
    analyserRef.current = null;
    gateAnalyserRef.current = null;
    bandpassRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") audioCtxRef.current.close();
    audioCtxRef.current = null;
    if (isRecordingRef.current) finalizeRecording();
    setIsRecording(false);
    setIsListening(false);
  }, [finalizeRecording]);

  // マイクは繋いだまま一時停止する(計測タブから他タブへ移ったときに呼ぶ)。
  // トラックをミュート(enabled=false)して描画ループを止めるだけで、getUserMediaで
  // 取得した接続自体は保持する。これにより計測タブへ戻ってもマイク許可のポップアップが
  // 再び出ない(繋ぎ直さずstartListeningの再利用パスでループを再開する)。
  const pauseListening = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => { t.enabled = false; });
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
    soundingRef.current = false;
    setLiveFrames([]);

    silentFramesRef.current = 0;
    lastFrameAtRef.current = 0;

    // 【マイク権限ポップアップ対策】タブを行き来するたびにgetUserMediaを呼ぶと、
    // 端末によっては毎回マイク許可のポップアップが出る。既にマイク接続が生きていれば
    // 繋ぎ直さず、ミュートを解除して描画ループだけ再開する(pauseListeningと対で使う)。
    // ただし再利用してよいのは「トラックが live かつ muted でない」かつ「AudioContextが実際に
    // running に戻せた」ときだけ。戻せなければ下の完全再取得パスへ落ちる(古いノードを新しい
    // コンテキストに繋ぐことはできないため、部分的な作り直しはしない)。
    const existingTracks = streamRef.current?.getTracks?.() || [];
    const ctxAlive = audioCtxRef.current && audioCtxRef.current.state !== "closed";
    if (isMicStreamUsable(streamRef.current) && ctxAlive && tickRef.current) {
      existingTracks.forEach((t) => { t.enabled = true; });
      // ジェスチャー権限内で同期的にキックする(awaitを挟むと権限が切れる)
      try { audioCtxRef.current.resume().catch(() => {}); } catch { /* noop */ }
      if (audioCtxRef.current.state === "running") {
        setIsListening(true);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        lastFrameAtRef.current = 0;
        rafRef.current = requestAnimationFrame(tickRef.current);
        return true;
      }
    }

    // ここから先は完全再取得。古いコンテキスト・トラックが残っていれば必ず捨てる
    // (中途半端に残すと、新しいコンテキストに古いノードが繋がったままになる)。
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch { /* noop */ } }
    streamRef.current = null;
    tickRef.current = null;
    analyserRef.current = null;
    gateAnalyserRef.current = null;
    bandpassRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") { try { audioCtxRef.current.close(); } catch { /* noop */ } }
    audioCtxRef.current = null;

    try {
      // 【iOS対策・重要】AudioContextの生成とresume()は、getUserMediaのawaitより「前」に、
      // つまりstartListeningがユーザー操作(タップ)の中から呼ばれたならその操作の権限内で同期的に
      // 行う。awaitを先に挟むとジェスチャー権限が切れ、suspendedのまま作られたcontext上のsourceが
      // 二度と音を流さなくなる(=起動直後からずっと-200dB、リロードでしか治らない)不具合になる。
      // iOSはマイク使用中、既定でオーディオ出力を受話口(小音量)に回すため、メトロノームが
      // 極端に小さく聞こえる。audioSessionに用途を明示しておくと対応ブラウザではスピーカー側に
      // 寄せられる(未対応環境ではプロパティ自体が無いので何も起きない)。値は AUDIO_SESSION_TYPE の1箇所。
      applyAudioSessionType();
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      audioCtx.resume().catch(() => {}); // ジェスチャー中に同期発火(awaitしない)。以降tick内でも監視・再resumeする

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;

      // 【トラックの死亡検知】iOSは他アプリにマイクを奪われると readyState は live のまま
      // muted だけ true にして戻ってくることがある。ended/mute のどちらでも復旧を試みる。
      stream.getTracks().forEach((t) => {
        t.onmute = () => { recoverMicRef.current("track-muted"); };
        t.onended = () => { recoverMicRef.current("track-ended"); };
      });

      // 端末が実際にAGC/ノイズ抑制/エコー除去を無効化できたか確認する(iOS Safariは
      // 制約を無視することがある)。有効なままだと音量・音色の測定値に端末側の加工が
      // 入るため、詳細パネルに警告を出してユーザーが気づけるようにする。
      try {
        const st = stream.getAudioTracks()[0]?.getSettings?.() || {};
        const active = [
          st.autoGainControl === true && "自動音量調整(AGC)",
          st.noiseSuppression === true && "ノイズ抑制",
          st.echoCancellation === true && "エコー除去",
        ].filter(Boolean);
        setMicProcessingWarning(active.length ? `端末の${active.join("・")}を無効化できませんでした。音量・音色の測定値に端末側の加工が入っている可能性があります。` : "");
      } catch { setMicProcessingWarning(""); }

      const source = audioCtx.createMediaStreamSource(stream);
      // 生の解析用アナライザ(スペクトル・倍音・重心・ピッチ検出はフルバンドで行う)
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      // 楽器の基音帯だけを通すバンドパス(BiquadFilterNode)→ ゲート判定用アナライザ。
      // 空調のうなり(低域)や高域ヒスを抑えた音量でノイズゲートを判定する。
      // 中心周波数は楽器種別ごと(バリトンの低音域が減衰しないよう低めに)。種別変更に追従する。
      const bandpass = audioCtx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = SAX_PRESETS[saxType]?.gateBandpassHz ?? BANDPASS_FREQ_HZ;
      bandpass.Q.value = BANDPASS_Q;
      bandpassRef.current = bandpass;
      const gateAnalyser = audioCtx.createAnalyser();
      gateAnalyser.fftSize = FFT_SIZE;
      gateAnalyser.smoothingTimeConstant = 0.2;
      source.connect(bandpass);
      bandpass.connect(gateAnalyser);
      gateAnalyserRef.current = gateAnalyser;

      setIsListening(true);

      const tick = () => {
        // 【世代チェック】復旧でマイクを取り直すと新しいtickが作られる。cancelAnimationFrameが
        // 間に合わず古いtickが1回だけ走ってしまうことがあり、そのままだと閉じたコンテキストを見て
        // 復旧を要求したり、二重にループを回し続けたりする。現行世代でなければ次を予約せず静かに終わる。
        if (tickRef.current !== tick) return;
        // tick本体はtry/finallyで包み、1フレームで例外が出ても必ず次フレームを予約して
        // ループが永久停止しない(＝メーターやグラフが固まらない)ようにする。以前は末尾の
        // requestAnimationFrameに到達しないと二度と更新されず、途中で止まる不具合につながっていた。
        try {
        const analyserNode = analyserRef.current;
        if (!analyserNode) return;
        // AudioContextがrunning以外(suspend/iOS固有のinterrupted等)だと解析用データが更新
        // されず検出が止まる。resumeで戻せる状態なら毎フレーム試み、closed等の戻せない状態なら
        // コンテキストごと作り直す復旧に回す(中断からの復帰はユーザー操作外でも通ることが多い)。
        const ctxAction = audioCtxRecoveryAction(audioCtx.state);
        if (ctxAction === "resume") audioCtx.resume().catch(() => {});
        else if (ctxAction === "rebuild") recoverMicRef.current(`audiocontext-${audioCtx.state}`);
        // 測定(ピッチ・倍音・重心・HNR)はすべて時間波形から自前計算する。AnalyserNodeの
        // 平滑済みスペクトルは使わない(スペクトル表示バーを廃止したため周波数データも読まない)。
        const sampleRate = audioCtx.sampleRate;

        // 音量(RMS/dBFS)は時間領域波形から算出する(標準的なdB。無音≒-70〜-90、通常音≒-15〜-35)。
        const timeBuf = new Float32Array(analyserNode.fftSize);
        analyserNode.getFloatTimeDomainData(timeBuf);
        let ss = 0;
        for (let i = 0; i < timeBuf.length; i++) ss += timeBuf[i] * timeBuf[i];
        const rms = Math.sqrt(ss / timeBuf.length);
        const vDb = 20 * Math.log10(rms + 1e-10);
        setVolumeDb(vDb);

        // 【無音ウォッチドッグ】トラックがliveでも、バッファが全ゼロ(=-200dB近傍)のまま
        // 一定時間続いたらストリームは死んでいる。判定は純関数に切り出してテストしている。
        {
          const wNow = performance.now();
          const wInterval = lastFrameAtRef.current ? wNow - lastFrameAtRef.current : 0;
          lastFrameAtRef.current = wNow;
          const wd = shouldRecoverFromSilence({
            volumeDb: vDb,
            prevSilentFrames: silentFramesRef.current,
            frameIntervalMs: wInterval,
            isRecording: isRecordingRef.current,
            nowMs: wNow,
            lastRecoverAtMs: micRecoverAtRef.current,
          });
          silentFramesRef.current = wd.silentFrames;
          if (wd.recover) recoverMicRef.current("silence-watchdog");
        }

        // バンドパス後の音量(dBFS)。空調のうなり・高域ヒスを除いた楽器帯の音量でゲート判定する。
        let bandDb = -Infinity;
        const gateNode = gateAnalyserRef.current;
        if (gateNode) {
          const gb = new Float32Array(gateNode.fftSize);
          gateNode.getFloatTimeDomainData(gb);
          let s2 = 0;
          for (let i = 0; i < gb.length; i++) s2 += gb[i] * gb[i];
          bandDb = 20 * Math.log10(Math.sqrt(s2 / gb.length) + 1e-10);
        }

        // ピッチ検出: 時間領域MPM(サブサンプル精度。1¢単位のメーター動作の要)。
        // clarity(周期の明瞭度)が低いもの=ブレスや空調などの非周期ノイズはここで排除する。
        // 楽器音域(minFreq/maxFreq)を渡し、音域外の幻の高音(倍音の誤検出)を拾わないようにする。
        const { minFreq: pmn, maxFreq: pmx } = pitchBoundsRef.current;
        const mpm = detectPitchMPM(timeBuf, sampleRate, pmn, pmx);
        const f0 = mpm && mpm.clarity >= PITCH_CLARITY_MIN ? mpm.freq : null;

        let levels = [];
        let hnr = null;
        let centroid = null;
        let matchedFinger = null;

        // --- 楽器音の判定(楽器以外=空調・ブレス等を拾わない) ---
        // (1) ノイズゲート: バンドパス後の音量が設定しきい値(dBFS)を超えること。ヒステリシスつき。
        // (2) 音程のある楽音であること: MPMが十分なclarityで基音を検出できること。
        const gateDb = noiseGateDbRef.current;
        const wasSounding = soundingRef.current;
        const hasPitch = !!(f0 && f0 > 40);
        const aboveGate = bandDb > (wasSounding ? gateDb - GATE_HYSTERESIS_DB : gateDb);
        soundingRef.current = hasPitch && aboveGate;
        const sounding = soundingRef.current;
        // 音色系(重心・HNR・倍音・スペクトル)は、ゲート+余裕を持った音量でだけ測定する。
        const timbreMeasurable = sounding && bandDb > gateDb + TIMBRE_EXTRA_DB;

        // メトロノームのクリック近傍(前30ms〜後90ms)で楽器音が無い場合は、スピーカーから
        // マイクに回り込んだクリック音をフレームとして記録しない(音量等の誤データ防止)。
        // 楽器音が鳴っている間は楽器がクリックより支配的でclarityゲートもあるため記録を続ける。
        const skipFrameForMetroClick = !sounding && isNearScheduledClick(scheduledClicksRef.current, performance.now());

        // ピッチのセント誤差は、メーターと同じ実効基準ピッチで1回だけ算出し、表示・グラフ・フレームで
        // 共有する(これで0¢の基準が全音でメーターと一致する)。
        const noteNow = sounding ? freqToNote(f0, effectiveTuningRef.current) : null;
        const pitchCentsUnified = noteNow ? noteNow.centsExact : null;

        if (sounding) {
          setPitch(f0);
          // 実測基音に最も近い運指をテーブルから検索(音名・音域・倍音理論値の基準に使う)。
          // 半音境界のヒステリシスと範囲外リジェクトを含む共通判定(オフライン解析と同一)
          matchedFinger = matchFingering(lastFingerRef.current, f0, fingeringTableRef.current);
          lastFingerRef.current = matchedFinger;
          setMatchedFingering(matchedFinger);
        } else {
          // 無音: ピッチをnullに戻すことで、メーターは中央(音名は「—」)に戻る。
          setPitch(null);
          setMatchedFingering(null);
          lastFingerRef.current = null;
        }

        // 音色(倍音・重心・HNR)は平滑済みAnalyserNodeスペクトルではなく、時間波形から
        // 毎回自前計算する(computeTimbreMetrics)。アップロード解析と完全に同一の計算になり、
        // 立ち上がりで前の音が混ざる系統誤差もない。記録用(centroid/levels/hnr)は生値のまま。
        //
        // 【表示の安定化(倍音が直前の音に汚染される/理想値がガタつく問題への対策)】
        // 解析窓(約170ms)は音の遷移直後に前の音の成分を含む。そこで:
        //  1) 音名(semitoneIndex)が変わってからTIMBRE_SETTLE_MSの間は、遷移で汚れた測定を
        //     表示バッファに積まない(前の音の倍音が混ざるのを防ぐ)。
        //  2) 表示はバッファの中央値。単発の外れ値を弾き、一瞬測れなくても直近値を保持して
        //     行が「—」に落ちてガタつくのを防ぐ。
        //  3) 音が変わったら古い音の値はバッファから捨て、新しい音の定常フレームで入れ替える。
        const disp = timbreDisplayRef.current;
        const DISPLAY_WINDOW = 5;      // 中央値をとる直近フレーム数
        const DISPLAY_HOLD_MS = 600;   // 最後の有効測定からこの間は直近値を保持して行をキープ
        const TIMBRE_SETTLE_MS = 140;  // 音替わり直後この間は遷移フレームを表示に取り込まない
        const TIMBRE_COMPUTE_MS = 66;  // 音色FFT(重い)は毎フレームではなくこの間隔で間引く(メーターの追従はピッチのみで足り、CPU負荷を大きく下げる)
        const nowPerfMs = performance.now();
        const noteKey = matchedFinger?.semitoneIndex ?? (sounding ? "unknown" : null);
        if (noteKey !== disp.lastNote) {
          disp.lastNote = noteKey;
          disp.changedMs = nowPerfMs;
          disp.stale = true; // 次に定常フレームが来たら古い音の値を捨てて入れ替える
          disp.lastCentroid = null; disp.lastHnr = null; disp.lastLevels = []; // 前の音の音色値を持ち越さない
        }
        // 音色(重心・HNR・倍音)は8192点FFTを含み重いため、TIMBRE_COMPUTE_MS間隔に間引く。
        // ピッチ検出(メーターの要)は毎フレーム走らせたまま、音色だけ負荷を落とす。
        if (timbreMeasurable && nowPerfMs - disp.lastComputeMs >= TIMBRE_COMPUTE_MS) {
          disp.lastComputeMs = nowPerfMs;
          const settled = nowPerfMs - disp.changedMs >= TIMBRE_SETTLE_MS;
          const tm = settled ? computeTimbreMetrics(timeBuf, sampleRate, f0, NUM_HARMONICS) : null;
          if (tm) {
            const maxMag = Math.max(...tm.harmonics.map((l) => l.mag), 1e-6);
            disp.lastCentroid = tm.centroidHz;
            disp.lastHnr = tm.hnrDb;
            disp.lastLevels = tm.harmonics.map((l) => ({ ...l, norm: l.mag / maxMag }));
            if (disp.stale) { disp.centroid = []; disp.hnr = []; disp.harmonics = []; disp.stale = false; }
            // 表示用ローリングバッファに積む(直近DISPLAY_WINDOW件を保持)
            disp.centroid.push(disp.lastCentroid); if (disp.centroid.length > DISPLAY_WINDOW) disp.centroid.shift();
            disp.hnr.push(disp.lastHnr); if (disp.hnr.length > DISPLAY_WINDOW) disp.hnr.shift();
            disp.harmonics.push(disp.lastLevels.map((l) => l.norm)); if (disp.harmonics.length > DISPLAY_WINDOW) disp.harmonics.shift();
            disp.validMs = nowPerfMs;
          }
        }
        // フレーム記録用の音色値は、間引きの合間でも直近の計算結果を使う(値が抜けないように)
        if (timbreMeasurable) {
          centroid = disp.lastCentroid;
          hnr = disp.lastHnr;
          levels = disp.lastLevels;
        }
        const holdActive = disp.centroid.length > 0 && nowPerfMs - disp.validMs <= DISPLAY_HOLD_MS;
        if (holdActive) {
          setCentroidHz(median(disp.centroid));
          setHnrDb(median(disp.hnr));
          // 倍音は次数ごとに中央値をとる
          const dispHarm = Array.from({ length: NUM_HARMONICS }, (_, i) => ({
            n: i + 1, norm: median(disp.harmonics.map((h) => h[i] ?? 0)) ?? 0,
          }));
          setHarmonicLevels(dispHarm);
        } else {
          // しばらく測れていない(無音・弱音が続いた)ならバッファを空にして「—」に戻す
          disp.centroid = []; disp.hnr = []; disp.harmonics = [];
          disp.lastCentroid = null; disp.lastHnr = null; disp.lastLevels = [];
          setCentroidHz(null);
          setHarmonicLevels([]);
          setHnrDb(null);
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
            // ノート境界は「楽器音と判定されているか(sounding)」で決める。ブレスや空調では発音開始にしない。
            if (det.phase === "silence") {
              if (sounding) {
                det.phase = "attack";
                det.onsetMs = elapsedMs;
                det.peakDb = vDb;
                det.samples = [{ t: elapsedMs, vDb }];
              }
            } else if (det.phase === "attack") {
              det.samples.push({ t: elapsedMs, vDb });
              if (vDb > det.peakDb) det.peakDb = vDb;
              if (!sounding) {
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
              if (!sounding) {
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

          if (!skipFrameForMetroClick && elapsedMs - lastSampleTimeRef.current >= SAMPLE_INTERVAL_MS) {
            lastSampleTimeRef.current = elapsedMs;

            // ピッチのセント誤差はメーターと同じ実効基準で算出済み(pitchCentsUnified)を使い、
            // 表示メーターと折れ線グラフの0¢基準を完全に一致させる。
            const pitchCentsVsTheory = pitchCentsUnified;
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
            const timbreScoreIdeal = noteIdeal && timbreMeasurable && centroid !== null
              ? timbreMatchScore(harmNorm, idealHarmNorm, centroid, noteIdeal.centroidHz, hnr, noteIdeal.hnrDb)
              : 0;

            const frame = {
              t: elapsedMs / 1000,
              pitchHz: f0,
              pitchCents: pitchCentsVsTheory,
              matchedWrittenNote: matchedFinger?.writtenLabel ?? null,
              concertNote: noteNow ? `${noteNow.name}${noteNow.octave}` : null, // 実音(コンサートピッチ)の音名。メーター・グラフ表示用
              semitoneIndex: matchedFinger?.semitoneIndex ?? null, // 音域軸集計用(企画書11.7節の対応: 運指の半音インデックス)
              derivedTubeLengthCm: matchedFinger ? deriveTubeLengthCm(matchedFinger.soundingFreqHz, preset.bellRadiusCm, temperature) : null,
              clarity: sounding && mpm ? mpm.clarity : null, // 検出信頼度(集計の重み)
              noteAgeMs: noteDetectorRef.current.phase !== "silence" ? Math.round(elapsedMs - noteDetectorRef.current.onsetMs) : null, // ノート開始からの経過(アタック除外判定用)
              volumeDb: vDb,
              spectralCentroidHz: timbreMeasurable ? centroid : null,
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
          if (!skipFrameForMetroClick && liveElapsedMs - lastLiveSampleTimeRef.current >= SAMPLE_INTERVAL_MS) {
            lastLiveSampleTimeRef.current = liveElapsedMs;
            const selectedIdeal = selectedIdealRef.current;
            const noteIdeal = getNoteIdeal(selectedIdeal, matchedFinger?.semitoneIndex);
            const harmNorm = levels.length === NUM_HARMONICS ? levels.map((l) => l.norm) : new Array(NUM_HARMONICS).fill(0);
            const idealHarmNorm = noteIdeal?.harmonicsProfile
              ? noteIdeal.harmonicsProfile.map((h) => h.norm)
              : new Array(NUM_HARMONICS).fill(0);
            const pitchCentsVsTheory = pitchCentsUnified;
            const pitchCentsVsIdeal = f0 && noteIdeal?.pitchHz ? centsBetween(f0, noteIdeal.pitchHz) : null;
            const pitchScoreTheory = pitchCentsVsTheory !== null ? pitchMatchScore(pitchCentsVsTheory) : 0;
            const pitchScoreIdeal = pitchCentsVsIdeal !== null ? pitchMatchScore(pitchCentsVsIdeal) : 0;
            const timbreScoreIdeal = noteIdeal && timbreMeasurable && centroid !== null
              ? timbreMatchScore(harmNorm, idealHarmNorm, centroid, noteIdeal.centroidHz, hnr, noteIdeal.hnrDb)
              : 0;
            const liveFrame = {
              t: liveElapsedMs / 1000,
              pitchHz: f0,
              pitchCents: pitchCentsVsTheory,
              matchedWrittenNote: matchedFinger?.writtenLabel ?? null,
              concertNote: noteNow ? `${noteNow.name}${noteNow.octave}` : null, // 実音の音名(グラフ表示用)
              semitoneIndex: matchedFinger?.semitoneIndex ?? null,
              clarity: sounding && mpm ? mpm.clarity : null,
              noteAgeMs: null, // ノート検出器は録音中のみ稼働(このバッファは保存されない使い捨て)
              volumeDb: vDb,
              spectralCentroidHz: timbreMeasurable ? centroid : null,
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
        } catch { /* 1フレームの失敗ではループを止めない(次フレームで回復) */ }
        finally {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      tickRef.current = tick; // タブ切替後の再開(startListeningのマイク再利用パス)で使う
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
      if (!metroActiveRef.current) releaseWakeLock(); // メトロノーム動作中はスリープ抑止を維持
      return;
    }
    if (!streamRef.current) {
      const ok = await startListening();
      if (!ok) return;
    }
    setPendingSession(null); // 新規録音を始めるので前回の候補は破棄
    setLastUploadedSession(null); // 前回の「解析が完了しました」表示も消す
    phraseStartTimeRef.current = performance.now();
    recStartPerfRef.current = phraseStartTimeRef.current; // 小節線を録音相対秒に変換する基準
    metroBarPerfTimesRef.current = []; // 今回の録音ぶんの小節頭を貯め直す
    lastSampleTimeRef.current = 0;
    setPhraseFrames([]);
    phraseFramesRef.current = [];
    noteDetectorRef.current = { phase: "silence", onsetMs: 0, peakDb: -100, samples: [], events: [] };
    setPhraseNoteEvents([]);
    setIsRecording(true);
    requestWakeLock(); // 録音中は画面スリープを抑止(スリープで録音が止まるのを防ぐ)
  }, [isRecording, startListening, finalizeRecording, requestWakeLock, releaseWakeLock]);

  // 【重要】startListening/stopListeningは(finalizeRecordingの依存経由で)頻繁に再生成され得るため、
  // 依存配列に直接入れると「関数が変わるたびに前回のeffectのクリーンアップとして古い関数が
  // 呼ばれる」という不具合(以前のstop()二重発火バグと同種)を招く。refで最新の関数を保持し、
  // このeffect自体はtopTabが変わったときだけ発火させる。
  const startListeningRef = useRef(startListening);
  const stopListeningRef = useRef(stopListening);
  const pauseListeningRef = useRef(pauseListening);
  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);
  useEffect(() => { stopListeningRef.current = stopListening; }, [stopListening]);
  useEffect(() => { pauseListeningRef.current = pauseListening; }, [pauseListening]);

  // 【マイク復旧の唯一の入口】無音ウォッチドッグ・トラックのmute/ended・AudioContextのclosed検知・
  // 画面タップ、どの経路もここに集約する(経路ごとに別々のクールダウンを持つと連打で
  // マイクが点滅するため)。マイクを完全に解放してから取り直し、AudioContextが本当に
  // running まで戻ったこととトラックが使える状態であることを確認する。戻らなければ
  // errorMsg でユーザーに知らせ、次のタップで再試行できる状態(micNeedsRetryRef)にする。
  //   urgent=true : ユーザーの明示的なタップからの再試行。クールダウンを短いほうに切り替える
  //                 (0にはしない。連打すると連打ぶんだけマイクを取り直してしまうため)
  // 録音中は絶対に走らせない(セッションが壊れるため)。
  const recoverMic = useCallback(async (reason, urgent = false) => {
    if (isRecordingRef.current) return false;
    if (micRecoveringRef.current) return false;
    const now = performance.now();
    const cooldown = urgent ? MIC_RETRY_TAP_COOLDOWN_MS : MIC_RECOVER_COOLDOWN_MS;
    if (now - micRecoverAtRef.current < cooldown) return false;
    micRecoverAtRef.current = now;
    micRecoveringRef.current = true;
    silentFramesRef.current = 0;
    console.warn("mic recovery:", reason);
    try {
      stopListeningRef.current();
      const ok = await startListeningRef.current();
      const ctx = audioCtxRef.current;
      if (ok && ctx && ctx.state !== "running") {
        // resume()しても running にならなければ、そのコンテキストは close() して作り直す。
        const { ctx: next, rebuilt } = await recoverAudioContext(ctx);
        if (rebuilt) {
          // 作り直したコンテキストの上にはまだノードが1つも無い(古いノードは新しい
          // コンテキストに繋げない)。refに入れてから stopListening で確実に閉じ(=放置してリークさせない)、
          // startListening で source/analyser/バンドパスをすべて作り直す。
          audioCtxRef.current = next;
          stopListeningRef.current();
          await startListeningRef.current();
        }
      }
      const healthy = ok
        && audioCtxRef.current
        && audioCtxRef.current.state === "running"
        && isMicStreamUsable(streamRef.current);
      if (healthy) {
        micNeedsRetryRef.current = false;
        setErrorMsg("");
        return true;
      }
      micNeedsRetryRef.current = true;
      setErrorMsg(MIC_RECOVER_FAILED_MSG);
      return false;
    } catch {
      micNeedsRetryRef.current = true;
      setErrorMsg(MIC_RECOVER_FAILED_MSG);
      return false;
    } finally {
      micRecoveringRef.current = false;
      silentFramesRef.current = 0;
      lastFrameAtRef.current = 0;
      micRecoverAtRef.current = performance.now(); // 復旧に要した時間ぶんクールダウンを食われないよう終了時刻で更新
    }
  }, []);
  useEffect(() => { recoverMicRef.current = recoverMic; }, [recoverMic]);

  // 計測タブに滞在中は自動でマイクを起動し、他タブへ移ったら一時停止する(マイク接続は保持)。
  // 繋ぎ直さないことで、タブを行き来してもマイク許可のポップアップが繰り返し出ないようにする。
  useEffect(() => {
    if (topTab === "measure" && !document.hidden) {
      startListeningRef.current();
    } else {
      pauseListeningRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topTab]);

  // 画面が非表示(バックグラウンド化・画面ロック等)になった間はマイクを完全に解放し(裏で
  // 聞き続けず、端末のマイク使用インジケータも消す)、表示に戻った時点で計測タブに滞在して
  // いれば繋ぎ直す。※アプリ内のタブ切替は上のeffectのpauseで扱うため、ここは実際に画面が
  // 隠れた場合のみ。
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopListeningRef.current();
      } else {
        // 復帰時はまず通常どおり繋ぎ直し、実際に「AudioContextがrunning」かつ「トラックが使える」
        // 状態まで戻れたかを確かめる。戻れていなければ復旧経路(recoverMic)に回す。
        // ここまでやらないと、繋ぎ直しは成功したのに解析バッファが全ゼロ(=-200dB)のまま、という
        // 一番厄介な壊れ方を無言で通してしまう。
        if (topTab === "measure") {
          Promise.resolve(startListeningRef.current())
            .then((ok) => {
              const ctx = audioCtxRef.current;
              const healthy = ok && ctx && ctx.state === "running" && isMicStreamUsable(streamRef.current);
              if (!healthy) recoverMicRef.current("visibility-restore");
            })
            .catch(() => recoverMicRef.current("visibility-restore-error"));
        }
        // Wake Lockは非表示で自動解放されるため、録音中またはアップロード解析中なら復帰時に再取得
        if (isRecordingRef.current || isAnalyzingUploadRef.current) requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [topTab]);

  // 【iOS対策】ユーザー操作なしに作られたAudioContextはsuspendedのまま起動し、その上で作られた
  // sourceが音を流さない(=起動直後からずっと-200dB、リロードでしか治らない)。画面をタップした
  // 時に、runningでなければまずこのジェスチャーの権限内で同期的にresumeを試み、それでも駄目なら
  // 復旧経路(recoverMic)へ回す。復旧経路は1本に統一してあるので、ウォッチドッグ・トラックの
  // mute/ended・このタップが同時に起きても多重に走らない(micRecoveringRef + クールダウン)。
  // errorMsgで「画面をタップしてください」と出した後のタップだけは、クールダウンを飛ばして
  // 即座に再試行する(ユーザーの明示的な操作なので待たせない)。
  useEffect(() => {
    const onGesture = () => {
      const c = audioCtxRef.current;
      // ジェスチャー権限内で同期的にキックする(awaitを挟むと権限が切れる)
      if (c && audioCtxRecoveryAction(c.state) === "resume") c.resume().catch(() => {});
      if (topTab !== "measure" || document.hidden || isRecordingRef.current) return;
      // 【重要】suspendedのまま作られたコンテキスト上のsourceはresume()しても音を流さない。
      // よって「runningでない」だけで取り直しの対象にする(closedだけでは足りない)。
      const ctxBroken = !c || c.state !== "running";
      const micBroken = !isMicStreamUsable(streamRef.current);
      const needsRetry = micNeedsRetryRef.current;
      if (needsRetry) recoverMicRef.current("gesture-retry", true);
      else if (ctxBroken || micBroken) recoverMicRef.current("gesture");
    };
    document.addEventListener("touchend", onGesture, { passive: true });
    document.addEventListener("pointerdown", onGesture, { passive: true });
    return () => {
      document.removeEventListener("touchend", onGesture);
      document.removeEventListener("pointerdown", onGesture);
    };
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
  // 【動画の扱い】スマホ直撮り動画はまずWebCodecsで音声トラックだけを高速デコードする
  // (extractAudioViaWebCodecs)。動画本体をデコードしないため実時間再生よりずっと速い。
  // 非対応環境・失敗時のみ、従来の<video>を実際に再生して解析する経路にフォールバックする
  // (この場合のみ解析に再生時間と同じだけ時間がかかる)。
  const handleUploadFile = useCallback(async (file) => {
    if (!file || isAnalyzingUpload) return;
    setErrorMsg("");
    setLastUploadedSession(null); // 前回の「解析が完了しました」表示を消してから始める
    setIsAnalyzingUpload(true);
    isAnalyzingUploadRef.current = true;
    setUploadProgress(0);
    setUploadNeedsTap(null);
    // 解析中は画面スリープを抑止する(スリープで解析が止まって見えるのを防ぐ)。
    // オフライン解析はMessageChannelで進めるためアプリ内のタブ切替では止まらないが、
    // 画面が消えるとiOSはJS実行自体を凍結するため、少なくともスリープは防ぐ。
    requestWakeLock();
    try {
      const analysisOpts = {
        saxType, tuningHz, instrumentOffsetCents, temperature, selectedIdeal,
        noiseGateDb, // 計測下限dB: ライブと同じ値でアップロード解析からもノイズ・無音区間を除外する
        onProgress: setUploadProgress,
        // 自動再生がブロックされた時は「タップして開始」ボタンを出し、新しいタップ内で再開する
        onNeedTap: (startFn) => setUploadNeedsTap(() => startFn),
      };
      const looksLikeVideo = (file.type || "").startsWith("video/") || /\.(mov|mp4|m4v|webm|3gp)$/i.test(file.name || "");
      let frames, noteEvents;
      if (looksLikeVideo) {
        // 動画: まずWebCodecsで音声だけ高速抽出→オフライン解析。失敗したら実時間再生にフォールバック。
        try {
          const { pcm, sampleRate } = await extractAudioViaWebCodecs(file, { onProgress: setUploadProgress });
          const octx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, pcm.length, sampleRate);
          const audioBuffer = octx.createBuffer(1, pcm.length, sampleRate);
          audioBuffer.copyToChannel(pcm, 0);
          ({ frames, noteEvents } = await analyzeAudioBuffer(audioBuffer, analysisOpts));
        } catch (webCodecErr) {
          console.warn("WebCodecs抽出に失敗、実時間再生にフォールバック:", webCodecErr);
          setUploadProgress(0);
          ({ frames, noteEvents } = await analyzeMediaFile(file, analysisOpts));
        }
      } else {
        // 音声ファイル: decodeAudioDataで直接デコード。失敗したら実時間再生。
        try {
          const arrayBuffer = await file.arrayBuffer();
          const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
          const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
          decodeCtx.close();
          ({ frames, noteEvents } = await analyzeAudioBuffer(audioBuffer, analysisOpts));
        } catch {
          ({ frames, noteEvents } = await analyzeMediaFile(file, analysisOpts));
        }
      }

      // 単発のオクターブ誤検出等を除去してから保存する(ライブ録音の保存時と同じ処理)
      frames = sanitizePitchOutliers(frames);

      // フレームは無音区間でも(null値で)積まれるため、「楽器音として判定されたフレームが
      // 1つでもあるか」で有効性を判断する(無音・ノイズだけのファイルは保存しない)。
      const hasSound = frames.some((f) => f.pitchCents !== null && f.pitchCents !== undefined);
      if (hasSound) {
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
      isAnalyzingUploadRef.current = false;
      setUploadProgress(0);
      setUploadNeedsTap(null);
      if (!isRecordingRef.current) releaseWakeLock(); // 録音中でなければスリープ抑止を解除
    }
  }, [saxType, tuningHz, instrumentOffsetCents, temperature, selectedIdeal, selectedReedId, selectedPerformer, addSession, isAnalyzingUpload, noiseGateDb, requestWakeLock, releaseWakeLock]);

  const deleteIdealProfile = (id) => {
    setIdealProfiles((prev) => prev.filter((p) => p.id !== id));
    if (selectedIdealId === id) setSelectedIdealId(null);
  };

  // 音名・セント誤差はレンダー時に実効基準ピッチ(基準Hz×個体差オフセット)で導出する。
  // フレーム(折れ線グラフ)側もtick内で同じ実効基準で算出しており、これで0¢の基準が全音で一致する。
  const note = pitch ? freqToNote(pitch, effectiveTuningHz) : null;
  const centsOffset = note ? note.cents : 0;

  // min-height は index.css の .app-root(100vh → 100dvh のフォールバック付き)で当てる。
  // インラインstyleでは同じプロパティを2回書けず、100dvh 未対応環境の受け皿を用意できない。
  return (
    <div className="app-root" style={{ background: "var(--c-bg)", color: "var(--c-ink)", fontFamily: "var(--font-jp)", padding: "calc(16px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right)) var(--page-bottom-gap) calc(14px + env(safe-area-inset-left))", boxSizing: "border-box" }}>
      <style>{`
        @import url('https://cdnjs.cloudflare.com/ajax/libs/JetBrains-Mono/2.304/web/JetBrainsMono.css');
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&display=swap');
        /* 音名/リード番号の表示にInstrument Serif、数値表示にSpace Grotesk、和文本文は
           OS標準のヒラギノ優先スタック(--font-jp)。Noto Sans JPはヒラギノの無い端末向けの
           フォールバックとしてのみ読み込む(index.cssの:root変数を参照)。 */
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@600;700&display=swap');
        * { box-sizing: border-box; }
        .sans { font-family: var(--font-jp); }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #174585; outline-offset: 2px; }
        input[type=range] { accent-color: #174585; }
        select { background:#F6F7F9; color:#121F32; border:1px solid #E9ECF0; border-radius:4px; padding:6px 8px; font-family: var(--font-jp); font-size:var(--fs-xs); }
        /* ピボットの軸セレクタは丸角カード内に置くため、枠なし・ネイビー太字で見せる */
        select.pivot-axis-select { width:100%; background:transparent; border:none; border-radius:0; padding:0; color:#174585; font-weight:600; font-size:var(--fs-sm); cursor:pointer; }
      `}</style>

      {/* アプリ名ヘッダーは削除(Claude Designに準拠。タブ切替は画面下部の固定ナビ=BottomNavに集約)。 */}

      {/* リードタブ内の子タブ: 登録 / 比較 */}
      {topTab === "reeds" && (
        <div style={{ maxWidth: 900, margin: "0 auto 10px", display: "flex", gap: 6, background: "#EDEFF3", borderRadius: 11, padding: 4 }}>
          {[
            { key: "register", label: "登録" },
            { key: "compare", label: "比較" },
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
          タップで消せるほか、再度マイク接続を試みる操作(タブ再訪問等)でも自動的にクリアされる。
          マイク復旧失敗(MIC_RECOVER_FAILED_MSG)のときは、documentに付けたジェスチャー復旧パスが
          このタップを拾って即座に再試行する(復旧経路は1本に統一してあるのでここでは呼ばない)。
          成功すれば recoverMic 側が errorMsg をクリアする。 */}
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
          note={note} centsOffset={centsOffset}
          harmonicLevels={harmonicLevels}
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
          noiseGateDb={noiseGateDb} setNoiseGateDb={setNoiseGateDb} micProcessingWarning={micProcessingWarning}
          scheduledClicksRef={scheduledClicksRef} metroActiveRef={metroActiveRef} metroBarPerfTimesRef={metroBarPerfTimesRef}
          requestWakeLock={requestWakeLock} releaseWakeLock={releaseWakeLock}
          phraseFrames={phraseFrames} phraseNoteEvents={phraseNoteEvents} liveFrames={liveFrames}
          promoteSessionToIdeal={promoteSessionToIdeal}
          pendingSession={pendingSession} registerPendingSession={registerPendingSession} discardPendingSession={discardPendingSession}
          handleUploadFile={handleUploadFile} isAnalyzingUpload={isAnalyzingUpload}
          uploadProgress={uploadProgress} lastUploadedSession={lastUploadedSession} setLastUploadedSession={setLastUploadedSession}
          uploadNeedsTap={uploadNeedsTap} setUploadNeedsTap={setUploadNeedsTap}
        />
      )}
      {topTab === "reeds" && (
        <ReedsTab
          key={`reeds-${navNonce}`}
          reeds={reeds} setReeds={setReeds}
          sessions={sessions} updateSessions={updateSessions}
          setTopTab={setTopTab} setSelectedReedId={setSelectedReedId}
          selectedIdeal={selectedIdeal} saxType={saxType} tuningHz={effectiveTuningHz}
          compareReedIds={compareReedIds} setCompareReedIds={setCompareReedIds}
          reedsSubTab={reedsSubTab} setReedsSubTab={setReedsSubTab}
        />
      )}
      {topTab === "analysis" && (
        <AnalysisLabView
          key={`data-${navNonce}`}
          sessions={sessions} reeds={reeds} selectedIdeal={selectedIdeal}
          promoteSessionToIdeal={promoteSessionToIdeal}
          NUM_HARMONICS={NUM_HARMONICS}
          updateSessions={updateSessions} deleteSessions={deleteSessions}
          performers={performers} setPerformers={setPerformers}
          saxType={saxType} tuningHz={effectiveTuningHz}
        />
      )}

      {/* 画面下部の固定タブナビ(Claude Designに準拠)。録音中はタブ移動を無効化する。 */}
      <BottomNav topTab={topTab} onNavTap={handleNavTap} isRecording={isRecording} />
    </div>
  );
}

// 画面下部の固定ナビ。計測/リード/分析をアイコン+ラベルで切り替える(モバイルアプリ風)。
function BottomNav({ topTab, onNavTap, isRecording }) {
  const items = [
    {
      key: "measure", label: "計測",
      icon: (c) => (
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
          <path d="M4 15 A8 8 0 0 1 20 15" /><line x1="12" y1="15" x2="15" y2="9" />
          <circle cx="12" cy="15" r="1.4" fill={c} stroke="none" />
        </svg>
      ),
    },
    {
      // 実際のリード1枚を正面から見たピクトグラム: 先端(チップ)はとがらせず、なだらかな
      // ドーム状のアーチにする。中央より少し下のヴァンプ(削り部)を表す直線、下は平らな尻(ヒール)。
      key: "reeds", label: "リード",
      icon: (c) => (
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 22 L9 10 Q9 4 12 4 Q15 4 15 10 L15 22 Z" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
      ),
    },
    {
      key: "analysis", label: "データ",
      icon: (c) => (
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
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
      {/* アイコンのみの1行。ラベルを廃してタブ帯の縦幅を小さくする(演奏中の画面領域を広く取るため) */}
      <div style={{ maxWidth: 480, margin: "0 auto", height: 46, display: "flex", padding: "6px 20px 8px" }}>
        {items.map((t) => {
          const active = topTab === t.key;
          const color = active ? "#174585" : "#8D95A1";
          return (
            <button
              key={t.key}
              onClick={() => onNavTap(t.key)}
              disabled={isRecording}
              aria-label={t.label}
              className="sans"
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                background: "none", border: "none", cursor: isRecording ? "default" : "pointer",
                color, opacity: isRecording && !active ? 0.4 : 1,
              }}
            >
              {t.icon(color)}
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
                scrollSnapAlign: "center", fontSize: 15,
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
const RECENT_NOTES_RANGE_CENTS = 25;

// quiet: 演奏中サーフェス(環のチューナーの下)に置くときの控えめな見せ方。
// 縦軸の数値ラベルを落とし、全体を一段落として環から視線を奪わないようにする。
function PitchDeviationLine({ frames, quiet = false }) {
  const W = 600, H = quiet ? 84 : 110;
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

  // 無音判定: pitchCentsがnull(=発音判定がfalseだったフレーム。メーターと同じ音量フロア判定で
  // 決まる)。無音は中央(0¢)に落とし、線は途切れず中央ライン上に留まる。
  const isSilent = (f) => {
    const c = f.pitchCents;
    return c === null || c === undefined || isNaN(c);
  };

  // 折れ線は単色グレーで統一する(無音は中央0¢に落として線を途切れさせない)。
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
    // 実音(コンサートピッチ)の音名で表示する。旧データにconcertNoteが無い場合のみ記音にフォールバック。
    const nm = isSilent(f) ? null : (f.concertNote || f.matchedWrittenNote || null);
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

  const axisLabel = { position: "absolute", right: 4, fontSize: 12, color: "#A6AEBA", whiteSpace: "nowrap" };

  return (
    <div style={{ padding: quiet ? "10px 0 0" : "18px 0 0", opacity: quiet ? 0.72 : 1 }}>
      <div style={{ display: "flex" }}>
        {/* 縦軸の目盛ラベル: 上=+25¢ / 中央=0 / 下=-25¢。
            演奏中サーフェス(quiet)では出さない。1m先の12px文字は読めず、環の邪魔になるだけのため。
            音名ラベルは「どの音だったか」を伝える実質的な情報なのでquietでも残す。 */}
        {!quiet && (
        <div style={{ position: "relative", width: 34, height: H, flexShrink: 0 }}>
          <span className="sans" style={{ ...axisLabel, top: 0 }}>+{RECENT_NOTES_RANGE_CENTS}¢</span>
          <span className="sans" style={{ ...axisLabel, top: "50%", transform: "translateY(-50%)" }}>0</span>
          <span className="sans" style={{ ...axisLabel, bottom: 0 }}>-{RECENT_NOTES_RANGE_CENTS}¢</span>
        </div>
        )}
        {/* グラフ本体 */}
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
            <rect x="0" y={goodTop} width={W} height={goodBottom - goodTop} fill="#E8F6ED" />
            <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#DDE2E8" strokeWidth="1" />
            {points && <polyline fill="none" stroke="#8D95A1" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
              points={points} />}
          </svg>
          {labels.map((l, i) => (
            <span
              key={i}
              className="sans"
              style={{
                position: "absolute", top: 0, left: `${Math.max(2, Math.min(94, l.pct))}%`, transform: "translateX(-50%)",
                fontSize: 12, fontWeight: 700, color: "#174585", background: "rgba(246,247,249,.85)",
                padding: "1px 5px", borderRadius: 6, whiteSpace: "nowrap", pointerEvents: "none",
              }}
            >
              {l.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// メトロノーム
//
// ・クリック音はWeb Audioの発振器で合成し、「先読みスケジューリング」で正確な拍を刻む
//   (25ms毎のタイマーで120ms先までAudioContextの時計に予約する。タイマー直接発音のブレがない)
// ・拍の解釈: 分母の音符=1拍(6/8なら8分音符が1拍で1小節6クリック。テンポ数値は分母音符の速さ)
// ・振り子はクリックと同じ時計(AudioContext.currentTime)に位相同期し、拍の瞬間に両端へ達する
// ・マイク計測との干渉対策: クリック予定時刻をperformance.now()基準で記録しておき、
//   ライブ計測側が「クリック近傍かつ楽器音なし」のフレーム記録をスキップする
//   (楽器音が鳴っている間は楽器がクリックより支配的で、clarityゲートもあるため記録を続ける)
// ============================================================
const METRO_SIGS = ["1/4", "2/4", "3/4", "4/4", "5/4", "6/4", "3/8", "5/8", "6/8", "7/8", "9/8", "12/8"];
const METRO_SUBDIVS = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3連" },
  { value: 4, label: "4" },
];
const METRO_TEMPO_MIN = 20;
const METRO_TEMPO_MAX = 300;

function clampMetroTempo(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 120;
  return Math.max(METRO_TEMPO_MIN, Math.min(METRO_TEMPO_MAX, n));
}

// "6/8"のような拍子文字列を{num, den}に分解する
function parseMetroSig(sig) {
  const parts = String(sig).split("/");
  const num = parseInt(parts[0], 10);
  const den = parseInt(parts[1], 10);
  return { num: Number.isFinite(num) && num > 0 ? num : 4, den: Number.isFinite(den) && den > 0 ? den : 4 };
}

// X/8拍子で「1拍=8分音符いくつ分か」のグループ配列を返す。3の倍数は全て3、それ以外は
// 3と2で埋める(3→[3] / 5→[3,2] / 6→[3,3] / 7→[3,2,2] / 9→[3,3,3] / 12→[3,3,3,3])。
function metroBeatGroups(num) {
  const g = [];
  let r = num;
  while (r > 0) {
    if (r === 4) { g.push(2, 2); r = 0; }
    else if (r >= 3) { g.push(3); r -= 3; }
    else { g.push(r); r = 0; }
  }
  return g;
}
// X/8拍子で、8分音符インデックス→そこが主拍(グループ)の頭かどうかの集合を作る。
// groups(例:[3,2])を渡せばそのグループ分けを使う(5/8・7/8のユーザー選択用)。合計がnumと
// 合わない/未指定なら自動(metroBeatGroups)にフォールバックする。
function metroX8BeatStarts(num, groups) {
  const g = (Array.isArray(groups) && groups.reduce((a, b) => a + b, 0) === num) ? groups : metroBeatGroups(num);
  const starts = new Set();
  let acc = 0;
  for (const gsize of g) { starts.add(acc); acc += gsize; }
  return starts;
}

// 通算tick番号(0始まり)における、そのtickで鳴らすクリックの強さを返す。
// 返り値: "accent"(小節頭・最強) / "beat"(拍頭・中強) / "sub"(拍内の細分・弱) / "silent"(鳴らさない)。
// 【X/8拍子】グリッドは常に8分音符(1小節=num個)。分子を3と2でグループ分けし、その頭を拍とする。
//   ・subdiv=1: 主拍(グループ頭)だけを鳴らし、拍間の8分音符は"silent"(=主拍のみのクリック)。
//   ・subdiv>=2: 拍を8分音符で埋める。複合拍子なら1拍に8分音符3つ(強-弱-弱)=実質3連符。
// 【X/4等】従来通り。拍頭以外(subdivによる細分)は"sub"、拍頭は先頭accent・他beat。
function metroTickKind(tickIndex, sig, subdiv, accentEnabled, groups) {
  const { num, den } = parseMetroSig(sig);
  const sd = subdiv || 1;
  if (den === 8) {
    const perMeasure = num;
    const idx = ((tickIndex % perMeasure) + perMeasure) % perMeasure;
    const beatStarts = metroX8BeatStarts(num, groups);
    const fill = sd >= 2; // 8分音符で拍を埋めるか
    if (beatStarts.has(idx)) return idx === 0 ? (accentEnabled ? "accent" : "beat") : "beat";
    return fill ? "sub" : "silent";
  }
  const perMeasure = num * sd;
  const idx = ((tickIndex % perMeasure) + perMeasure) % perMeasure;
  const isBeatHead = idx % sd === 0;
  const beatIdx = Math.floor(idx / sd);
  if (!isBeatHead) return "sub";
  if (beatIdx === 0) return accentEnabled ? "accent" : "beat";
  return "beat";
}

// メトロノームのクリック音がマイクに入り得る時間帯か(クリック開始の少し前〜減衰+伝搬遅れ)。
// timesはperformance.now()基準の予定時刻(昇順)。ライブ計測のフレーム記録スキップ判定に使う。
function isNearScheduledClick(times, nowMs, preMs = 30, postMs = 90) {
  for (let i = times.length - 1; i >= 0; i--) {
    const d = nowMs - times[i];
    if (d > postMs) break; // これより古い予定はさらに範囲外なので打ち切り
    if (d >= -preMs) return true;
  }
  return false;
}

// クリック音の元になる白色雑音バッファをAudioContextごとに1回だけ生成しキャッシュする
// (毎tick生成すると無駄なため)。急速減衰エンベロープを焼き込み、短いパーカッシブな
// 「チッ」という質感の種にする(正弦波の柔らかいビープ音ではなく、輪郭のはっきりした
// 抜ける音にするため、倍音の詰まったノイズ+バンドパスで音高感を出す設計にした)。
function getMetroClickBuffer(ctx) {
  if (ctx.__metroClickBuffer) return ctx.__metroClickBuffer;
  const dur = 0.06;
  const n = Math.ceil(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const decay = Math.exp(-i / (n * 0.15));
    data[i] = (Math.random() * 2 - 1) * decay;
  }
  ctx.__metroClickBuffer = buffer;
  return buffer;
}

// メトロノーム出力の共通マスターチェーン(AudioContextごとに1回作りキャッシュ)。
// iOSではマイク(getUserMedia)が有効な間、音声出力が受話口寄り/小音量のルートに切り替わり、
// 端末音量を最大にしてもクリック音が小さくなる問題がある(Web側からルート自体は変えられない)。
// そこで、デジタル段で目一杯持ち上げつつリミッター(DynamicsCompressor)で歪みを抑え、
// 許可の有無によらずできる限り大きく・一定の音量に近づける。
//   [各クリック] → limiter(閾値-3dB・高レシオ) → masterGain(2.6倍) → destination
function getMetroMasterInput(ctx) {
  if (ctx.__metroMasterInput) return ctx.__metroMasterInput;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.05;
  const master = ctx.createGain();
  master.gain.value = 2.6; // マイク有効時の小音量を補うブースト。リミッターが歪みを抑える
  limiter.connect(master);
  master.connect(ctx.destination);
  ctx.__metroMasterInput = limiter;
  return limiter;
}

// クリック音を1回分スケジュールする。白色雑音をバンドパスで整形した短いパーカッシブな
// 「チッ」音(実物のメトロノームや電子ドラムのクリックに近い、はっきり抜ける音)。
// アクセント/拍/分割で中心周波数と音量を変え、聴き分けやすくする。出力はマスターチェーン経由。
function scheduleMetroClick(ctx, t, kind) {
  const src = ctx.createBufferSource();
  src.buffer = getMetroClickBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = kind === "accent" ? 2900 : kind === "beat" ? 2000 : 1300;
  bp.Q.value = 1.6;
  const gain = ctx.createGain();
  const vol = kind === "accent" ? 1.0 : kind === "beat" ? 0.85 : 0.6;
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + src.buffer.duration);
  src.connect(bp);
  bp.connect(gain);
  gain.connect(getMetroMasterInput(ctx));
  src.start(t);
}

// メトロノームアイコン(本体の台形+振り子アーム)
function MetronomeIcon({ color, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 3 L14.5 3 L19 21 L5 21 Z" />
      <line x1="12" y1="17.5" x2="16.2" y2="7.5" />
      <circle cx="16.6" cy="6.5" r="1.4" fill={color} stroke="none" />
    </svg>
  );
}

// 「1拍の分割」を音符アイコンで表す。1=四分音符 / 2=八分音符2つ / 3=三連符 / 4=十六分音符4つ。
// 分割ボタン(現在の選択表示)と分割選択パネルの両方で共通利用する。
// 拍子を楽譜のように分子/分母を縦に積んで表示する(例: 4/4 → 4 の下に 4)。
function TimeSigStacked({ sig, fontSize = 18, color = "#174585" }) {
  const { num, den } = parseMetroSig(sig);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", lineHeight: 0.9, fontFamily: "var(--font-num)", fontWeight: 700, fontSize, color }}>
      <span>{num}</span>
      <span>{den}</span>
    </span>
  );
}

function SubdivNoteIcon({ value, size = 22, color = "#174585" }) {
  const cfg = {
    1: { n: 1, beams: 0, triplet: false },
    2: { n: 2, beams: 1, triplet: false },
    3: { n: 3, beams: 1, triplet: true },
    4: { n: 4, beams: 2, triplet: false },
  }[value] || { n: 1, beams: 0, triplet: false };
  const { n, beams, triplet } = cfg;
  const W = 32, H = 24;
  const yHead = 17, yBeam = 5, headRx = 3.6, headRy = 2.7;
  const xs = n === 1 ? [13] : Array.from({ length: n }, (_, i) => 6 + (20 * i) / (n - 1));
  const stemX = (x) => x + 3.0;
  return (
    <svg width={size} height={(size * H) / W} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} aria-hidden="true">
      {xs.map((x, i) => (
        <ellipse key={`h${i}`} cx={x} cy={yHead} rx={headRx} ry={headRy} fill={color} transform={`rotate(-20 ${x} ${yHead})`} />
      ))}
      {xs.map((x, i) => (
        <line key={`s${i}`} x1={stemX(x)} y1={yHead - 1.5} x2={stemX(x)} y2={n === 1 ? yBeam + 1 : yBeam} stroke={color} strokeWidth={1.3} strokeLinecap="round" />
      ))}
      {beams >= 1 && n >= 2 && (
        <line x1={stemX(xs[0])} y1={yBeam} x2={stemX(xs[n - 1])} y2={yBeam} stroke={color} strokeWidth={2.6} />
      )}
      {beams >= 2 && n >= 2 && (
        <line x1={stemX(xs[0])} y1={yBeam + 4} x2={stemX(xs[n - 1])} y2={yBeam + 4} stroke={color} strokeWidth={2.6} />
      )}
      {triplet && (
        <text x={(stemX(xs[0]) + stemX(xs[n - 1])) / 2} y={3.4} textAnchor="middle" fontSize="8" fontWeight="700" fill={color} fontFamily="var(--font-num)">3</text>
      )}
    </svg>
  );
}

// 【削除済み】MetronomePendulum(振り子・高さ248×scale)
// 375x812 で 334.8px を占め、これ単体でページを194pxはみ出させて録音ボタンを固定ナビの
// 下に押し込んでいた(BACKLOG P0-1)。拍の表示は環(PitchRing)の下側の未使用弧に移した。
// 環が「上弧=ピッチ / 下弧=拍」の二役を持つことで、縦スペースを増やさずに拍を出せる。
// テンポに応じて錘が動く演出(metroWeightTop / METRO_WEIGHT_TOP_*)も併せて削除した。

// 【削除済み】PitchMeter(横一直線のピッチメーター・残像つき)と PITCH_TRAIL_MS
// メトロノーム表示中のコンパクト1行フォールバックが唯一の呼び出し元で、それを廃して
// 環(PitchRing)に一本化した時点で参照0件になった(BACKLOG P1-5)。
// 目盛の "-50/+50"(fontSize:12) を持っていたが、これは DESIGN-SYSTEM §6.1 の
// 「演奏中サーフェスに目盛の数字を置かない/12px禁止」に真っ向から反する要素だった。

// セント差(絶対値)を緑→橙→赤へ滑らかに補間した色を返す。
// 0¢=緑 / 13¢=橙 / 30¢以上=赤。音程の正誤という機能的意味を持つ色で、装飾都合で変えない。
function pitchBarColorRGB(cents) {
  const a = Math.abs(cents);
  const stops = [
    [0, [22, 163, 74]],    // ジャスト=緑 #16A34A
    [13, [217, 119, 6]],   // やや外れ=橙 #D97706
    [30, [220, 38, 38]],   // 大きく外れ=赤 #DC2626
  ];
  if (a <= stops[0][0]) return stops[0][1];
  if (a >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [c0, col0] = stops[i];
    const [c1, col1] = stops[i + 1];
    if (a >= c0 && a <= c1) {
      const t = (a - c0) / (c1 - c0);
      return [0, 1, 2].map((k) => Math.round(col0[k] + (col1[k] - col0[k]) * t));
    }
  }
  return stops[stops.length - 1][1];
}


// ============================================================
// 演奏中サーフェスのチューナー(環)。
//
// このアプリの特殊性: ユーザーは両手で楽器を持ち、口にマウスピースを咥え、スマホは
// 譜面台の上(目から50cm〜1m)にある。手は塞がっていて操作できず、見るのはチラ見・
// 周辺視野。したがってこの画面だけは「文字を読ませない」設計にする。
//
//   - 目盛の数字(-50/+50)は置かない。ズレは環の色と弧の長さだけで伝える
//   - 音名は視線の中心=環の内側に大きく置く
//   - 合った(|¢|<=RING_IN_TUNE_CENTS)ら環が閉じてゆっくり呼吸する。
//     「到達した」を色と動きで返すのがこの画面の唯一の報酬表現
//
// 角度のマッピング: 12時=0¢(ジャスト)を基準に、±RING_MAX_CENTS を ±RING_SWEEP_DEG に
// 割り当てる。上半分だけを使い、下半分は常に空ける(円を一周させると0¢の位置が
// 分からなくなるため)。
//
// 【メトロノーム表示中の環の中身(E案: 振り子＋拍の点)】DESIGN-SYSTEM §6.1。
// 拍マーカーが下弧を往復する形は「既存のメトロノームは上半円なのに下半円で振れる」
// 違和感と、点だけでは今が何拍目か読めない問題があったため作り直した。
//   上半円 = 振り子(予測を担う)。錘が端に近づくのが見えるから身体が次の拍を準備できる。
//            機械式メトロノームの錘が支点の上に来るのは複合振り子の機構上の都合だが、
//            結果としてそれが視覚的な常識になっている。
//   下半円 = 拍の点(今が何拍目かを担う)。点は動かず、灯る場所だけが変わる。
//
// 拍の演出は**毎拍・両端で**出す。実際のメトロノームは両端で鳴るのに、以前の実装は
// 小節頭だけを強調していたため、偶数拍子では cos(π×通算拍) が必ず同じ端に来て
// 片側でしか光らなかった。
//
// DESIGN-SYSTEM §6.1 は「ピッチマーカーと拍の要素が**実寸で**最低6 CSS px 離れること」を
// 要件にしている。viewBox単位ではなく実寸で見るのが要点(330px環では viewBox 1単位が
// 1.1 CSS px)。ここでは軌道半径・錘の大きさを「設計値として素直に決め」、要件を満たすかは
// scripts/pitch-test.mjs が**独立に実寸で計算して**検証する。定数の定義から要件を逆算すると
// テストが恒等式になって何も守らなくなるため、その形にはしない。
// ============================================================
const RING_MAX_CENTS = 50;     // 環の端に対応するセント差
const RING_SWEEP_DEG = 110;    // ±RING_MAX_CENTS を割り当てる角度(上弧)
const RING_IN_TUNE_CENTS = 5;  // これ以内なら「合った」として環を閉じる
// DESIGN-SYSTEM §6.1 が定めるピッチマーカーと拍の要素の最小距離(実寸・CSS px)。
// 振り子の軌道半径と錘の大きさは、この値を満たすように選んである。
const RING_MARKER_MIN_GAP_PX = 6;
// 環の形状。viewBoxは300固定で、実寸はCSSの幅で追従させる。
// rAFでDOMを直接書き換える拍マーカーからも参照するためモジュール定数として持つ。
// (テストハーネスが1つずつ抽出するため、まとめて宣言せず1行1定数にする)
const RING_VB = 300;
const RING_CX = 150;
const RING_CY = 150;
const RING_R = 136;
const RING_SW = 14;
// ピッチマーカー(上弧)の半径。
const RING_PITCH_DOT_R = RING_SW / 2 + 3;

// 環の実寸(直径)。DESIGN-SYSTEM §4.2 の表と対応する。
// **メトロノームの開閉で大きさを変えない。** 以前は開くと 330→250 に縮めていたが、
// 環は演奏中サーフェスの主役で、開閉のたびに主役の大きさが変わるのは読み取りを妨げる。
// 縦スペースはメトロノームを開いている間だけ「これまでの音」を隠して捻出する。
const RING_D_FULL = 330;       // 環の直径(常にこの値)

// --- 音名の組み方(design/DESIGN-SYSTEM.md §4.2/§4.3 で確定) ---
// 音名のサイズは環の直径に比例させる(固定pxにしない)。環が縮んだときに音名だけ据え置くと
// 音名と環内周のクリアランスが 55px/辺 → 14px/辺 のように別物になり、同一サーフェス内で
// 見え方が割れるため。比で持てば環がどの大きさでもクリアランスの比率が保たれる。
// 環が 330px 固定になったので結果として 330 × 0.3576 = 118px 固定になるが、比の仕組みは残す。
const NOTE_FS_RATIO = 0.3576;
// Instrument Serif は既定の送り幅が 0.457em(一般的なserifの64%)と細い。細さ自体は
// 1m先から読む演奏中サーフェスに合っているが、書体既定のままでは「幅を選んでいない」
// 見え方になる。そこで横幅を scaleX で明示的に指定する。
const NOTE_SCALE_X = 1.30;     // 音名の横幅(明示指定)
// scaleX は要素のレイアウト幅を変えないため、変形後のグリフが左右に (1.30-1)/2 = 15%
// はみ出す。隣の臨時記号と重ならないよう、送り幅 0.457em の15%分を左右marginで補う。
const NOTE_SCALE_PAD_EM = 0.457 * (NOTE_SCALE_X - 1) / 2;
// 臨時記号(♯/♭)は音名に付属する記号。本体と近いサイズだと主従が逆転して見えるため
// 明確に小さくする。横幅の指定は本体だけに掛け、記号には掛けない。
const NOTE_ACC_RATIO = 0.34;   // 臨時記号 = 音名の34%
const NOTE_OCT_RATIO = 0.31;   // オクターブ数字 = 音名の31%

// 12時を0として時計回りに測った角度(度) → SVG座標
function ringPoint(deg, r, cx, cy) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
}

// --- 上半円: 振り子(予測を担う) ---
// 【RING_PEND_R を上げる / 錘・輪を大きくすると、ピッチマーカーとの距離が縮む。】
// 要件(RING_MARKER_MIN_GAP_PX)を割ったら pitch-test.mjs が実寸で検証して落ちる。
// 軌道半径は要件を満たす最大の整数値。錘は環のトラック(内縁 r=129)ではなく
// **ピッチマーカー(r=136 の点・半径10 なので内縁は 126)** との距離で効いてくる。
const RING_PEND_R = 94;             // 錘の軌道半径
const RING_PEND_SWING_DEG = 55;     // 振れ角(12時=0°、時計回り)。拍の瞬間が両端になる
const RING_PEND_ARC_SW = 2;         // 軌道の弧の太さ(--c-line)
const RING_PEND_BOB_R = 14;         // 錘の基本半径
const RING_PEND_BOB_GROW = 4;       // 拍の演出での半径の増分
const RING_PEND_HALO_GAP = 7;       // 錘の外側の輪 = 錘の半径 + この値
const RING_PEND_HALO_SW = 2;        // 輪の線幅。輪の実際の外縁は r + SW/2 まで届く
const RING_PEND_HALO_OPACITY = 0.45; // 輪の最大不透明度(演出量 e に比例)

// --- 下半円: 拍の点(今が何拍目かを担う) ---
const RING_BEAT_DOT_ORBIT_R = 112;  // 点を並べる半径
const RING_BEAT_DOT_SPREAD_DEG = 60; // 6時(180°)を中心に左右へこの角度
const RING_BEAT_DOT_R = 4;          // 現在以外の点(--c-accent-line)
const RING_BEAT_DOT_CUR_R = 6.5;    // 現在の拍(小節頭以外)
const RING_BEAT_DOT_CUR_GROW = 2;
const RING_BEAT_DOT_HEAD_R = 8;     // 現在の拍(小節頭)
const RING_BEAT_DOT_HEAD_GROW = 3;

// --- 拍の演出(毎拍・両端で出す) ---
const RING_BEAT_EMPH_DECAY = 2.2;   // 拍内位相 × これ を 1 から引く
const RING_BEAT_EMPH_HEAD = 1;      // 小節頭の係数
const RING_BEAT_EMPH_OTHER = 0.55;  // それ以外の拍の係数

// 到達(inTune)の合図に使う上弧のパス。以前はここで r=RING_R の**全周円**を
// ピッチ色で塗って呼吸させていたが、それだと下弧＝拍の領域までピッチ色に染まり、
// 「上弧=ピッチ / 下弧=拍」の役割分離が**最も見せたい瞬間に崩れていた**
// (DESIGN-SYSTEM §6.1 の注意書き)。到達の表現は上弧の範囲だけに閉じる。
function ringPitchArcD() {
  const [ax, ay] = ringPoint(-RING_SWEEP_DEG, RING_R, RING_CX, RING_CY);
  const [bx, by] = ringPoint(RING_SWEEP_DEG, RING_R, RING_CX, RING_CY);
  // -110° → +110° を12時側まわりで結ぶ。220°>180° なので large-arc=1、時計回りで sweep=1。
  return `M${ax.toFixed(2)},${ay.toFixed(2)} A${RING_R},${RING_R} 0 1,1 ${bx.toFixed(2)},${by.toFixed(2)}`;
}
const RING_PITCH_ARC_D = ringPitchArcD();

// 振り子の錘の角度(12時=0とした度)。位相(拍単位の連続値)を上半円の往復に写す。
// cos(π*phase) なので拍の瞬間(位相が整数)にちょうど両端へ達する。
// 停止中(phase===null)は静止した振り子と同じく最下点=12時(0°)に置く。
function ringPendDeg(phase) {
  if (phase === null || phase === undefined) return 0;
  return RING_PEND_SWING_DEG * Math.cos(Math.PI * phase);
}

// 錘の軌道の弧(薄く描く)。-55°→+55° は110°<180°なので large-arc=0、時計回りで sweep=1。
function ringPendArcD() {
  const [ax, ay] = ringPoint(-RING_PEND_SWING_DEG, RING_PEND_R, RING_CX, RING_CY);
  const [bx, by] = ringPoint(RING_PEND_SWING_DEG, RING_PEND_R, RING_CX, RING_CY);
  return `M${ax.toFixed(2)},${ay.toFixed(2)} A${RING_PEND_R},${RING_PEND_R} 0 0,1 ${bx.toFixed(2)},${by.toFixed(2)}`;
}
const RING_PEND_ARC_D = ringPendArcD();

// 拍の演出量(0〜1)。**毎拍・両端で**出す(実際のメトロノームは両端で鳴る)。
// 拍の瞬間に最大で、拍内位相 × RING_BEAT_EMPH_DECAY のぶんだけ減衰して0になる。
// 強さの係数だけを小節頭(1)とそれ以外(0.55)で分ける。
// ficus-breathe と同じく「静かに立ち上がって消える」量として使い、明滅はさせない。
//
// accentOn = メトロノームの「一拍目にアクセントをつける」設定(metroAccent)。
// これがOFFのときは強拍が"鳴らない"ので、視覚だけが小節頭を主張してはいけない
// (鳴っていないものを見せるのは、P1-6が直そうとした「鳴るのに見えない」の裏返しになる)。
// この設定が効くのは小節頭の"差"だけで、拍そのものの演出は毎拍出る(毎拍鳴っているため)。
function ringBeatEmphasis(phase, beatsPerMeasure, accentOn) {
  if (phase === null || phase === undefined) return 0;
  const beat = Math.floor(phase);
  const emph = Math.max(0, 1 - (phase - beat) * RING_BEAT_EMPH_DECAY);
  return emph * (ringBeatIsHead(phase, beatsPerMeasure, accentOn) ? RING_BEAT_EMPH_HEAD : RING_BEAT_EMPH_OTHER);
}

// 今が小節の何拍目か(0起点)。停止中・拍子未確定は null。下半円の点はこれで灯る場所を変える。
function ringBeatIndex(phase, beatsPerMeasure) {
  if (phase === null || phase === undefined || !(beatsPerMeasure > 0)) return null;
  const beat = Math.floor(phase);
  return ((beat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
}

// 今の拍が小節頭か。アクセント設定がOFFなら鳴り方が同じなので小節頭として扱わない。
function ringBeatIsHead(phase, beatsPerMeasure, accentOn) {
  if (!accentOn) return false;
  return ringBeatIndex(phase, beatsPerMeasure) === 0;
}

// 拍の点の角度(12時=0とした度)。6時を中心に ±RING_BEAT_DOT_SPREAD_DEG に、
// **左から右へ**数える順で並べる(i=0 が左端)。1拍なら6時ちょうど。
function ringBeatDotDeg(i, n) {
  if (!(n > 1)) return 180;
  return (180 + RING_BEAT_DOT_SPREAD_DEG) - ((2 * RING_BEAT_DOT_SPREAD_DEG) / (n - 1)) * i;
}

// 拍の点の半径。点は動かず、大きさと色だけが変わる。
function ringBeatDotR(isCurrent, isHead, e) {
  if (!isCurrent) return RING_BEAT_DOT_R;
  return isHead
    ? RING_BEAT_DOT_HEAD_R + e * RING_BEAT_DOT_HEAD_GROW
    : RING_BEAT_DOT_CUR_R + e * RING_BEAT_DOT_CUR_GROW;
}

// getBeatPhase: メトロノームの位相(拍単位の連続値)を返す関数。渡された時だけ環の下弧に
//   拍マーカーを出す(=メトロノームパネルを開いている時)。位相の計算そのものは
//   MeasureView の getMetroPhase(クリックのスケジュールと同じ音声時計)をそのまま使う。
// beatsPerMeasure: 1小節の拍数。位相の整数部(通算拍)をこれで割った余りが0の拍=小節頭。
// accentOn: メトロノームの「一拍目にアクセントをつける」設定。OFFなら小節頭を強調しない
//   (鳴っていないアクセントを視覚だけが主張しないように)。
// diameter: 環の実寸(直径)。音名のサイズはこれに比例させる(DESIGN-SYSTEM §4.2)。
function PitchRing({ note, centsOffset, diameter = RING_D_FULL, getBeatPhase = null, beatsPerMeasure = 0, accentOn = false }) {
  const sounding = !!note;
  const rawExact = note ? Math.max(-RING_MAX_CENTS, Math.min(RING_MAX_CENTS, note.centsExact ?? centsOffset)) : 0;

  // 生のピッチはフレーム毎に細かく揺れるため指数移動平均で落ち着かせる。ただし音名(半音)が
  // 変わった瞬間はcentsExactが大きく飛ぶのでスナップして平滑をやり直す
  // (隣の音へ不自然にスウィープしない)。
  const smoothRef = useRef({ semi: null, val: 0 });
  let exact = rawExact;
  if (sounding) {
    const semi = Math.round(note.midi);
    if (smoothRef.current.semi !== semi) smoothRef.current = { semi, val: rawExact };
    else smoothRef.current.val += (rawExact - smoothRef.current.val) * 0.15;
    exact = smoothRef.current.val;
  } else {
    smoothRef.current = { semi: null, val: 0 };
  }

  // viewBoxは300固定。実寸は幅に追従させる(上限が diameter)。
  const VB = RING_VB, CX = RING_CX, CY = RING_CY, R = RING_R, SW = RING_SW;
  // 音名のサイズは環の直径に比例(固定pxにしない)。臨時記号・オクターブはそこからの比。
  const noteFs = diameter * NOTE_FS_RATIO;
  const deg = (exact / RING_MAX_CENTS) * RING_SWEEP_DEG;
  const [mx, my] = ringPoint(deg, R, CX, CY);
  const [r, g, b] = pitchBarColorRGB(exact);
  const color = `rgb(${r},${g},${b})`;
  const inTune = sounding && Math.abs(exact) <= RING_IN_TUNE_CENTS;

  // 音名は "A" / "B♭" / "F♯" の形。本体の文字と臨時記号でサイズを変えるため分解する。
  // 【音が入っていないときは文字を出さない】以前は "—" を置いていたが、待っている状態は
  // 環のトラックと12時の基準マーカーだけで読める。文字で説明しない(DESIGN-SYSTEM §6.1)。
  const noteLetter = sounding ? note.name.charAt(0) : "";
  const accidental = sounding ? note.name.slice(1) : "";
  // 文字を消しても箱は残す(§6.1.5)。行の高さは「音名サイズ × 行送り」で、幅は環の内寸いっぱい。
  // これを明示しないと、文字が無いときに行の高さが0になり、環の内側の寸法が状態で変わる。
  const NOTE_LINE_H = 0.82;
  const noteBoxH = noteFs * NOTE_LINE_H;

  // 0¢(12時)から現在位置までの弧。ズレが小さいうちは描かない(点にしかならないため)。
  const [sx, sy] = ringPoint(0, R, CX, CY);
  const arcD = Math.abs(deg) < 1 ? "" : `M${sx.toFixed(2)},${sy.toFixed(2)} A${R},${R} 0 0,${deg > 0 ? 1 : 0} ${mx.toFixed(2)},${my.toFixed(2)}`;

  // --- 拍(上半円=振り子 / 下半円=拍の点) ---
  // 位置は毎フレーム変わるため、Reactの再レンダーを挟まず60fpsでDOMを直接書き換える。
  // 位相は音声時計そのものなので、拍の瞬間にちょうど振り子の端へ達する。
  const bobRef = useRef(null);
  const bobHaloRef = useRef(null);
  const beatDotRefs = useRef([]);
  // 点の数は拍子で決まる(位置は固定・灯る場所だけが変わる)。
  const dotCount = getBeatPhase && beatsPerMeasure > 0 ? beatsPerMeasure : 0;
  useEffect(() => {
    if (!getBeatPhase) return undefined;
    // 動きを減らす設定。属性をrAFで直接書き換えるぶんはCSSの
    // @media (prefers-reduced-motion) が効かないので、ここで自分で見る。
    // 【止めるのは装飾だけ】拍の演出=ふくらみ(装飾)は止め、錘の移動と点の切り替え
    // (機能=拍がどこかを伝える情報そのもの)は残す。DESIGN-SYSTEM §6.1「減速設定」の規則。
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf;
    const loop = () => {
      const phase = getBeatPhase();
      const running = phase !== null;
      const [bx, by] = ringPoint(ringPendDeg(phase), RING_PEND_R, RING_CX, RING_CY);
      // 拍の演出は毎拍・両端で出す。小節頭だけ強い(係数1 / 0.55)。
      const e = reduceMotion.matches ? 0 : ringBeatEmphasis(phase, beatsPerMeasure, accentOn);
      const isHead = ringBeatIsHead(phase, beatsPerMeasure, accentOn);
      const bobR = RING_PEND_BOB_R + e * RING_PEND_BOB_GROW;
      const bob = bobRef.current;
      if (bob) {
        bob.setAttribute("cx", bx.toFixed(2));
        bob.setAttribute("cy", by.toFixed(2));
        bob.setAttribute("r", bobR.toFixed(2));
        bob.setAttribute("fill-opacity", running ? "1" : "0.35");
      }
      const halo = bobHaloRef.current;
      if (halo) {
        halo.setAttribute("cx", bx.toFixed(2));
        halo.setAttribute("cy", by.toFixed(2));
        halo.setAttribute("r", (bobR + RING_PEND_HALO_GAP).toFixed(2));
        halo.setAttribute("stroke-opacity", (e * RING_PEND_HALO_OPACITY).toFixed(3));
      }
      const cur = ringBeatIndex(phase, beatsPerMeasure);
      for (let i = 0; i < beatDotRefs.current.length; i++) {
        const d = beatDotRefs.current[i];
        if (!d) continue;
        const isCur = cur === i;
        d.setAttribute("r", ringBeatDotR(isCur, isCur && isHead, e).toFixed(2));
        d.style.fill = isCur ? "var(--c-accent)" : "var(--c-accent-line)";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getBeatPhase, beatsPerMeasure, accentOn]);

  return (
    <div style={{ width: "100%", maxWidth: diameter, margin: "0 auto", position: "relative" }}>
      <svg viewBox={`0 0 ${VB} ${VB}`} style={{ display: "block", width: "100%", height: "auto" }} aria-hidden="true">
        {/* 環のトラック(常に全周)。色はCSS変数から引くため属性ではなくstyleで指定する
            (SVGのプレゼンテーション属性に var() は書けない)。 */}
        <circle cx={CX} cy={CY} r={R} fill="none" strokeWidth={SW} style={{ stroke: "var(--c-line)" }} />
        {/* 12時=0¢の基準マーカー。トラックを跨いで内外にわずかに出す */}
        <line
          x1={CX} y1={CY - R - SW / 2 - 5} x2={CX} y2={CY - R + SW / 2 + 5}
          strokeWidth="3" strokeLinecap="round" style={{ stroke: "var(--c-accent)" }}
        />
        {sounding && (
          <>
            {/* ズレの弧: 0¢から現在位置まで伸びる。長さと色の両方でズレの大きさを示す */}
            {arcD && <path d={arcD} fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" />}
            {/* 合っている間は上弧が閉じて呼吸する(到達の合図)。
                全周ではなく上弧だけに閉じるのが要点。全周にすると下弧＝拍の領域まで
                ピッチ色に染まり、環の二役が崩れる(DESIGN-SYSTEM §6.1)。 */}
            {inTune && (
              <path
                className="ficus-breathe" d={RING_PITCH_ARC_D} fill="none" stroke={color}
                strokeWidth={SW} strokeLinecap="round"
                style={{ animation: "ficus-breathe 1.9s ease-in-out infinite" }}
              />
            )}
            {/* 現在位置 */}
            <circle cx={mx} cy={my} r={RING_PITCH_DOT_R} fill={color} />
          </>
        )}
        {/* メトロノーム(E案)。ピッチ(環の上弧・機能色)と役割が混ざらないよう、拍はすべて
            紺(--c-accent)で、環より内側に描く。座標・大きさはrAFで直接書き換える。 */}
        {getBeatPhase && (
          <>
            {/* 下半円: 拍の点。位置は固定で、灯る場所だけが変わる */}
            {Array.from({ length: dotCount }).map((_, i) => {
              const [dx, dy] = ringPoint(ringBeatDotDeg(i, dotCount), RING_BEAT_DOT_ORBIT_R, CX, CY);
              return (
                <circle
                  key={i} ref={(el) => { beatDotRefs.current[i] = el; }}
                  cx={dx.toFixed(2)} cy={dy.toFixed(2)} r={RING_BEAT_DOT_R}
                  style={{ fill: "var(--c-accent-line)" }}
                />
              );
            })}
            {/* 上半円: 振り子。軌道の弧を薄く描き、その上を錘が往復する
                (錘が端に近づくのが見えることが「次の拍の予測」を担う) */}
            <path d={RING_PEND_ARC_D} fill="none" strokeWidth={RING_PEND_ARC_SW} style={{ stroke: "var(--c-line)" }} />
            <circle
              ref={bobHaloRef} cx={CX} cy={CY - RING_PEND_R} r={RING_PEND_BOB_R + RING_PEND_HALO_GAP}
              fill="none" strokeWidth={RING_PEND_HALO_SW} strokeOpacity="0" style={{ stroke: "var(--c-accent)" }}
            />
            <circle
              ref={bobRef} cx={CX} cy={CY - RING_PEND_R} r={RING_PEND_BOB_R}
              fillOpacity="0.35" style={{ fill: "var(--c-accent)" }}
            />
          </>
        )}
      </svg>
      {/* 環の内側: 音名(実音)とセント差。数値は「合間に読む」ための補助で、主役は環そのもの。 */}
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", pointerEvents: "none",
      }}>
        <div style={{
          display: "flex", alignItems: "baseline", justifyContent: "center",
          width: "100%", height: noteBoxH,
          lineHeight: NOTE_LINE_H, fontFamily: "var(--font-serif)",
          color: sounding ? "var(--c-ink)" : "var(--c-disabled)",
        }}>
          {/* 音名の文字。横幅は scaleX で明示指定する(書体既定のままにしない) */}
          <span style={{
            fontSize: noteFs, display: "inline-block",
            transform: `scaleX(${NOTE_SCALE_X})`, transformOrigin: "center bottom",
            margin: `0 ${NOTE_SCALE_PAD_EM}em`,
          }}>
            {noteLetter}
          </span>
          {/* 臨時記号。文字として組み、本体より明確に小さくする(scaleXは掛けない) */}
          {accidental && (
            <span style={{ fontSize: noteFs * NOTE_ACC_RATIO }}>{accidental}</span>
          )}
          <span style={{ fontSize: noteFs * NOTE_OCT_RATIO, color: "var(--c-accent-dim)", marginLeft: 3 }}>
            {sounding ? note.octave : ""}
          </span>
        </div>
        {/* セント値。色は環と同じ pitchBarColorRGB() の連続補間で、閾値のベタ判定は混ぜない
            (以前メトロノーム表示中だけ ac<=3 / <=10 の3段階で塗り分けており、環の判定と
            食い違っていた)。「合った」の判定はこの画面では RING_IN_TUNE_CENTS だけを使い、
            到達したときは環と同じ ficus-breathe(透明度のみ)で静かに返す。 */}
        {/* 音が入っていないときはセント値も文字を出さない。ただし箱(高さ--fs-md+--sp-1 =
            文字がある時の行の高さ・幅は環の内寸いっぱい)は残し、音の有無で環の内側の寸法が
            変わらないようにする(DESIGN-SYSTEM §6.1.5)。 */}
        <div className={`sans${inTune ? " ficus-breathe" : ""}`} style={{
          marginTop: "var(--sp-4)", width: "100%", height: "calc(var(--fs-md) + var(--sp-1))",
          textAlign: "center",
          fontFamily: "var(--font-num)", fontSize: "var(--fs-md)", fontWeight: 700,
          letterSpacing: "0.02em", color: sounding ? color : "var(--c-ink-3)",
          animation: inTune ? "ficus-breathe 1.9s ease-in-out infinite" : undefined,
        }}>
          {sounding ? `${centsOffset > 0 ? "+" : ""}${centsOffset}¢` : ""}
        </div>
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
    isRecording, toggleRecording, note, centsOffset,
    harmonicLevels, showIdeal, setShowIdeal,
    selectedIdeal, volumeDb, centroidHz, hnrDb, saxType, setSaxType, temperature, setTemperature,
    tuningHz, setTuningHz, matchedFingering,
    idealProfiles, selectedIdealId, setSelectedIdealId, deleteIdealProfile, NUM_HARMONICS,
    reeds, selectedReedId, setSelectedReedId,
    performers, selectedPerformer, setSelectedPerformer, setPerformers,
    noiseGateDb, setNoiseGateDb, micProcessingWarning,
    scheduledClicksRef, metroActiveRef, metroBarPerfTimesRef, requestWakeLock, releaseWakeLock,
    phraseFrames, phraseNoteEvents, liveFrames, promoteSessionToIdeal,
    pendingSession, registerPendingSession, discardPendingSession,
    handleUploadFile, isAnalyzingUpload, uploadProgress, lastUploadedSession, setLastUploadedSession,
    uploadNeedsTap, setUploadNeedsTap,
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
  // 計測タブを画面いっぱいの縦フレックスにして「上=設定 / 中央=メーター / 下=録音ボタン」に配置する。
  const measureRootRef = useRef(null);
  const measureMinH = useFillViewportHeight(measureRootRef);
  const TUNING_HZ_OPTIONS = [438, 439, 440, 441, 442, 443, 444];
  const SAX_TYPE_OPTIONS = Object.keys(SAX_PRESETS);

  // --- メトロノーム(設定は永続化。ON/OFFはタブ滞在中のみ=タブを離れるとアンマウントで停止) ---
  const [metroTempo, setMetroTempo] = usePersistedState("metroTempo", 120);
  const [metroSig, setMetroSig] = usePersistedState("metroSig", "4/4");
  const [metroSubdiv, setMetroSubdiv] = usePersistedState("metroSubdiv", 1);
  const [metroAccent, setMetroAccent] = usePersistedState("metroAccent", true); // デフォルトON(OFFにしないと拍子が聴き分けられないため)
  // 5/8・7/8のグループ分け(例:[3,2]/[2,2,3])。ユーザーが選べる。他の拍子はnull(自動)。
  const [metroGrouping, setMetroGrouping] = usePersistedState("metroGrouping", null);
  const [metronomeOn, setMetronomeOn] = useState(false); // 実際に音が鳴っている(スケジューラ動作中)か
  // 開閉状態は永続化する。計測タブは他タブへ移るとアンマウントされるため、useStateだと
  // 戻ったときにメトロノームが閉じてしまう(ユーザー報告)。開いたままなら戻っても開いたまま。
  const [showMetroPanel, setShowMetroPanel] = usePersistedState("showMetroPanel", false); // 開いただけでは音は鳴らない
  const [metroPanel, setMetroPanel] = useState(null); // 振り子と入れ替えて表示する設定パネル: null | "sig"(拍子) | "subdiv"(1拍の分割)
  const [tempoEditing, setTempoEditing] = useState(false); // テンポ数値タップで直接入力モード
  const tempoInputRef = useRef(null);
  // autoFocus属性はモバイルブラウザ(ユーザージェスチャー外の文脈等)で確実に効かないことがあるため、
  // マウント時に明示的にfocus+全選択する(数値をすぐ上書き入力できるように)。
  useEffect(() => {
    if (tempoEditing) { tempoInputRef.current?.focus(); tempoInputRef.current?.select(); }
  }, [tempoEditing]);

  // 拍子情報(分子・分母)を都度パースして使う。X/8拍子(分母8)かつ分子が3の倍数
  // (3/8・6/8・9/8・12/8)は複合拍子(1拍=8分音符3つ)として扱う。
  const { num: metroSigNum, den: metroSigDen } = parseMetroSig(metroSig);
  const metroCompoundX8 = metroSigDen === 8 && metroSigNum % 3 === 0;
  // X/8拍子の「1拍の分割」は2択: 1=主拍のみ / 2=8分音符で拍を埋める(複合なら1拍に8分3つ=実質3連)。
  // 表示アイコンは、埋める側を複合拍子では8分音符3つ、非複合(5/8,7/8)では2つで見せる。
  const metroSubdivOptions = metroSigDen === 8
    ? [{ value: 1, icon: 1 }, { value: 2, icon: metroCompoundX8 ? 3 : 2 }]
    : METRO_SUBDIVS.map((s) => ({ ...s, icon: s.value }));
  // 1小節の拍数(=振り子1振りぶんの単位がいくつ入るか)。環の下弧の拍マーカーが
  // 小節頭を強調するために使う「読み取り専用の導出値」で、発音側のロジックには一切触れない。
  // X/4等は分子そのもの。X/8はスケジューラと同じグループ分け(metroBeatGroups)の個数=拍数。
  const metroBeatsPerMeasure = metroSigDen === 8
    ? ((Array.isArray(metroGrouping) && metroGrouping.reduce((a, b) => a + b, 0) === metroSigNum)
        ? metroGrouping.length : metroBeatGroups(metroSigNum).length)
    : metroSigNum;
  // X/8では分割は1か2のみ。それ以外(16分等)が選ばれていたら主拍のみ(1)に戻す。
  useEffect(() => {
    if (metroSigDen === 8 && metroSubdiv !== 1 && metroSubdiv !== 2) setMetroSubdiv(1);
  }, [metroSigDen, metroSubdiv, setMetroSubdiv]);

  // スケジューラは長寿命クロージャのため、最新の設定値はrefから読む
  const metroCtxRef = useRef(null);
  const metroTimerRef = useRef(null);
  const metroNextTimeRef = useRef(0);
  const metroTickIndexRef = useRef(0);
  const metroGBeatRef = useRef(0); // 通算拍数。振り子の位相が小節をまたいでも連続するように増え続ける
  const metroAnchorRef = useRef({ time: 0, gBeat: 0, mBeat: 0 }); // 直近の拍(音声時刻・通算拍・小節内拍)
  const metroOnRef = useRef(false);
  const metroTempoRef = useRef(clampMetroTempo(metroTempo));
  const metroSigRef = useRef(metroSig);
  const metroSubdivRef = useRef(metroSubdiv);
  const metroAccentRef = useRef(metroAccent);
  const metroGroupingRef = useRef(metroGrouping);
  // START呼び出しごとに増える世代番号。古いSTART呼び出し(resume()待ち中)がその間に
  // 発生したSTOPや別のSTARTより後から状態を書き換えてしまう競合を防ぐ(詳細は下記)。
  const metroGenRef = useRef(0);
  useEffect(() => { metroTempoRef.current = clampMetroTempo(metroTempo); }, [metroTempo]);
  useEffect(() => { metroSigRef.current = metroSig; }, [metroSig]);
  useEffect(() => { metroSubdivRef.current = metroSubdiv; }, [metroSubdiv]);
  useEffect(() => { metroAccentRef.current = metroAccent; }, [metroAccent]);
  useEffect(() => { metroGroupingRef.current = metroGrouping; }, [metroGrouping]);
  // 拍子に応じてグループ分けを整える。5/8・7/8以外はnull(自動)、5/8・7/8は現在の選択が
  // 合計と合わなければ既定(5/8→[3,2] / 7/8→[3,2,2])に戻す(有効な選択は保持)。
  useEffect(() => {
    const { num, den } = parseMetroSig(metroSig);
    const needs = den === 8 && (num === 5 || num === 7);
    if (!needs) { if (metroGrouping !== null) setMetroGrouping(null); return; }
    const sum = Array.isArray(metroGrouping) ? metroGrouping.reduce((a, b) => a + b, 0) : 0;
    if (sum !== num) setMetroGrouping(num === 5 ? [3, 2] : [3, 2, 2]);
  }, [metroSig, metroGrouping, setMetroGrouping]);

  // 先読みスケジューラ本体。25ms毎に呼ばれ、120ms先までのクリックを音声時計に予約する。
  //
  // 拍の強弱(kind)の決め方:
  //   ・小節の先頭(eighthIdx===0)は"accent"(アクセント有効時。最強)
  //   ・複合拍子(6/8等)では、8分音符3つごとの先頭(eighthIdx%3===0)を"beat"(中強)、
  //     その中の2・3番目を"sub"(弱)にする → 1拍(付点四分相当)の中に3つの音が
  //     強・弱・弱で鳴る、実際の複合拍子の感じ方に合わせた並びになる
  //   ・単純拍子(4/4等)では、先頭以外の拍はすべて"beat"(均等)、"1拍の分割"による
  //     細分だけが"sub"になる(従来通り)
  const metroSchedulerTick = useCallback(() => {
    const ctx = metroCtxRef.current;
    if (!ctx || !metroOnRef.current) return;
    const LOOKAHEAD = 0.12;
    let guard = 0; // 万一ステップ幅が異常値になっても無限ループでタブが固まらないようにする安全弁
    while (metroNextTimeRef.current < ctx.currentTime + LOOKAHEAD) {
      if (++guard > 512) { metroNextTimeRef.current = ctx.currentTime + LOOKAHEAD; break; }
      const t = metroNextTimeRef.current;
      const { num, den } = parseMetroSig(metroSigRef.current);
      const subdiv = metroSubdivRef.current || 1;
      const isX8 = den === 8;
      // 【テンポの基準】X/8拍子はすべて、テンポ数値を「8分音符3つ分(付点四分)の速さ」として扱う。
      // よって8分音符1つ=その1/3の長さ。複合(6/8等)は1拍=8分3つなので1拍がちょうどテンポ。
      // 非複合の5/8・7/8も同じ8分の長さで、3グループの拍=60/tempo秒、2グループの拍=その2/3秒に
      // なる(8分音符は全グループ均等)。X/4は分母の四分音符1つがテンポの1拍(従来通り)。
      const eighthDur = isX8 ? (60 / metroTempoRef.current) / 3 : (60 / metroTempoRef.current);
      // X/8はグリッドを常に8分音符に固定(perMeasure=num・subdivで割らない)。subdivは
      // 「主拍のみ(1)か、8分で拍を埋めるか(>=2)」の切替。振り子は1拍(グループ)で1振りにする。
      let perMeasure, stepDiv, idx, kind, isBeatAnchor, beatDur;
      if (isX8) {
        perMeasure = num;
        stepDiv = 1;
        idx = metroTickIndexRef.current % perMeasure;
        const gr = metroGroupingRef.current;
        const groups = (Array.isArray(gr) && gr.reduce((a, b) => a + b, 0) === num) ? gr : metroBeatGroups(num);
        // idxが拍(グループ)頭か、そのグループの8分音符数(=1拍の長さ)を求める
        let acc = 0, gsize = 0;
        for (const g of groups) { if (acc === idx) { gsize = g; break; } acc += g; }
        isBeatAnchor = gsize > 0;                 // グループ頭のときだけ振り子を進める
        beatDur = (gsize || num) * eighthDur;     // 1拍=8分音符×グループサイズ(振り子1振り分)
        kind = metroTickKind(metroTickIndexRef.current, metroSigRef.current, subdiv, metroAccentRef.current, groups);
      } else {
        perMeasure = num * subdiv;
        stepDiv = subdiv;
        idx = metroTickIndexRef.current % perMeasure;
        isBeatAnchor = idx % subdiv === 0;        // 拍頭
        beatDur = eighthDur;                       // 1拍=分母音符1つ
        kind = metroTickKind(metroTickIndexRef.current, metroSigRef.current, subdiv, metroAccentRef.current);
      }

      if (kind !== "silent") {
        scheduleMetroClick(ctx, t, kind);
        // ライブ計測の除外判定用にクリック時刻をperformance.now()基準で記録する
        const perfT = performance.now() + (t - ctx.currentTime) * 1000;
        scheduledClicksRef.current.push(perfT);
        if (scheduledClicksRef.current.length > 128) scheduledClicksRef.current.splice(0, 64);
        // アクセント(=小節頭)の時刻は、録音のタイムラインに小節線を引くために別途貯める
        if (kind === "accent" && metroBarPerfTimesRef) {
          metroBarPerfTimesRef.current.push(perfT);
          if (metroBarPerfTimesRef.current.length > 2048) metroBarPerfTimesRef.current.splice(0, 1024);
        }
      }
      if (isBeatAnchor) {
        // 振り子は「1拍(端から端)」で1振り。X/8複合なら1拍=8分3つぶんの時間をかけて振れる。
        metroAnchorRef.current = { time: t, gBeat: metroGBeatRef.current, dur: beatDur };
        metroGBeatRef.current += 1;
      }
      metroNextTimeRef.current = t + eighthDur / stepDiv;
      metroTickIndexRef.current = (idx + 1) % perMeasure;
    }
  }, [scheduledClicksRef, metroBarPerfTimesRef]);

  const startMetronome = useCallback(() => {
    metroGenRef.current++; // 進行中の古い状態を無効化する
    // 出力用AudioContextはマイクの解析用とは分けて持つ(ライフサイクルを絡めないため)。
    // 【iOS対策・重要】アプリを一度バックグラウンドにするとAudioContextはinterrupted/suspendに
    // なり、awaitを挟んでからresume()してもユーザー操作(このタップ)の権限が切れて再開できない。
    // そこで「runningでなければ、このタップの中で同期的にコンテキストを作り直し、resume()も
    // awaitせず同期でキックする」。これで一度閉じてから戻ってもSTARTで必ず鳴らせる。
    // 出力の行き先(受話口/スピーカー)の宣言。マイク使用中に音が小さくなる問題への唯一の試行手段で、
    // 値は AUDIO_SESSION_TYPE の1箇所。効果は実機でしか確認できない(未対応環境では何も起きない)。
    applyAudioSessionType();
    let ctx = metroCtxRef.current;
    if (!ctx || ctx.state !== "running") {
      try { ctx?.close(); } catch { /* noop */ }
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      metroCtxRef.current = ctx;
    }
    ctx.resume().catch(() => {}); // ジェスチャー中に同期的に発火(awaitしない)
    metroTickIndexRef.current = 0;
    metroGBeatRef.current = 0;
    metroNextTimeRef.current = ctx.currentTime + 0.12;
    metroAnchorRef.current = { time: metroNextTimeRef.current, gBeat: 0, mBeat: 0 };
    metroOnRef.current = true;
    metroActiveRef.current = true;
    setMetronomeOn(true);
    requestWakeLock(); // 練習中に画面が消えないように(録音時と同じ)
    if (metroTimerRef.current) clearInterval(metroTimerRef.current);
    metroTimerRef.current = setInterval(metroSchedulerTick, 25);
  }, [metroSchedulerTick, metroActiveRef, requestWakeLock]);

  const stopMetronome = useCallback(() => {
    metroGenRef.current++; // resume()待ち中の古いSTART呼び出しがあれば無効化する
    if (metroTimerRef.current) { clearInterval(metroTimerRef.current); metroTimerRef.current = null; }
    metroOnRef.current = false;
    metroActiveRef.current = false;
    scheduledClicksRef.current = [];
    setMetronomeOn(false);
    // (旧UIの名残 setMetroSettingsOpen(false) は未定義でstopのたびに例外を投げていたため削除。
    //  設定サブパネルの開閉は metroPanel 側で独立管理しているのでここでは触らない)
    // AudioContextはsuspendしない(スケジューラを止めれば無音になるだけで十分軽量なため、
    // suspend/resumeの繰り返しによる不安定化を避ける。タブ離脱時のみアンマウント処理でcloseする)。
    if (!isRecording) releaseWakeLock(); // 録音中はWake Lockを維持
  }, [isRecording, metroActiveRef, scheduledClicksRef, releaseWakeLock]);

  // アンマウント(=計測タブを離れた)時は完全に停止して音を止める
  useEffect(() => {
    const clicksRef = scheduledClicksRef;
    const activeRef = metroActiveRef;
    return () => {
      metroGenRef.current++;
      if (metroTimerRef.current) clearInterval(metroTimerRef.current);
      metroOnRef.current = false;
      activeRef.current = false;
      clicksRef.current = [];
      try { metroCtxRef.current?.close(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // アプリを閉じる(バックグラウンド化・画面ロック)とiOSはAudioContextを中断し、鳴っていた
  // メトロノームは無音のまま状態だけ残る。復帰後にSTOP表示なのに鳴らない混乱を避けるため、
  // 非表示になった時点でクリーンに止めておく(復帰後はSTARTで確実に鳴らせる=上のstartMetronome)。
  useEffect(() => {
    const onVis = () => { if (document.hidden && metroOnRef.current) stopMetronome(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [stopMetronome]);

  // 拍子・分割の変更時は小節の頭から仕切り直す(実行中のみ。テンポ変更は次の拍から自然に反映)
  useEffect(() => {
    const ctx = metroCtxRef.current;
    if (!metroOnRef.current || !ctx) return;
    metroTickIndexRef.current = 0;
    metroGBeatRef.current = 0;
    metroNextTimeRef.current = ctx.currentTime + 0.08;
    metroAnchorRef.current = { time: metroNextTimeRef.current, gBeat: 0, mBeat: 0 };
  }, [metroSig, metroSubdiv]);

  // 振り子の位相(拍単位の連続値)。クリックと同じAudioContextの時計から算出する
  const getMetroPhase = useCallback(() => {
    const ctx = metroCtxRef.current;
    if (!ctx || !metroOnRef.current) return null;
    const a = metroAnchorRef.current;
    // a.dur = この拍(gBeat 1単位)の実時間。X/8複合は1拍=8分3つ=3×(60/tempo)なので、
    // 振り子は「端から端」=1拍(8分3つ)で1振りになる。未設定時は8分1つ分にフォールバック。
    const dur = a.dur || (60 / metroTempoRef.current);
    return a.gBeat + (ctx.currentTime - a.time) / dur;
  }, []);

  return (
    <div ref={measureRootRef} style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* 【縦構造】DESIGN-SYSTEM §6.1.5「レイアウトの安定」。
          画面ぶんの高さ(measureMinH)を持つ枠を1枚だけ敷き、その中を
            上端に固定(設定行) → 固定の間隔(--sp-1) → 主役(環) → 可変の中間(flex:1) → 下端に固定(アクション)
          の順で並べる。余りは必ず「可変の中間」が吸収する。
          ・justify-content を状態で切り替えない(全状態 flex-start)。以前は素の状態だけ center で、
            中身の高さが変わるたびに環と録音ボタンが動いていた(本人の実機フィードバック2026-08-01)。
          ・詳細カードはこの枠の「外・下」に置く。開いても枠の高さは measureMinH のままなので
            環・録音ボタン・詳細トグルは1pxも動かず、増えたぶんだけページがスクロールする。 */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: measureMinH || undefined }}>
      {/* ── 上端に固定 ── 設定行と各種の告知。この塊の下端が「固定の間隔」--sp-1。 */}
      <div style={{ flexShrink: 0 }}>
      {/* 上部設定行(Claude Designの計測タブ提案を反映): 左にリード(pill・箱→個体の二段階)+奏者、
          右に楽器種別・基準ピッチ(タップでスクロール選択、値はテキストリンク風)。
          いずれも演奏前に一度決めたら触らない設定項目のため、1行に収めて画面の縦スペースを確保する。 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: "var(--sp-1)", flexWrap: "wrap" }}>
        <div className="sans" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap", overflowX: "auto" }}>
          {/* メトロノーム(タップでパネルの開閉のみ。実際の音はパネル内のSTART/STOPで制御)。
              楽器種別・基準Hzの反対側=左端に置く */}
          <button
            onClick={() => {
              if (showMetroPanel) {
                if (metronomeOn) stopMetronome(); // パネルを閉じる時、鳴っていれば止める
                setShowMetroPanel(false);
              } else {
                setShowMetroPanel(true);
              }
            }}
            aria-label="メトロノーム"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10,
              border: showMetroPanel ? "1.5px solid #174585" : "1px solid #E9ECF0",
              background: showMetroPanel ? "#EAEFF5" : "#FFFFFF", cursor: "pointer", flexShrink: 0, padding: 0,
            }}
          >
            <MetronomeIcon color={showMetroPanel ? "#174585" : "#8D95A1"} />
          </button>
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
              <option value="">{selectedBoxGroup ? "#" : "—"}</option>
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
        <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginBottom: "var(--sp-1)" }}>「リード」タブでリードを登録できます</div>
      )}

      <input
        ref={fileInputRef} type="file" accept="audio/*,video/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); e.target.value = ""; }}
      />

      {/* メトロノームの設定パネル(拍子 / 1拍の分割)。開いている間はこの枠だけを見せる。
          拍そのものの表示は環(PitchRing)の下弧が担うため、ここには振り子を置かない。
          START/STOP・テンポ・拍子・分割の操作UIは環の下(下記)にまとめている。 */}
      {showMetroPanel && metroPanel !== null && (
        <div style={{ marginTop: 4 }}>
          {metroPanel === "sig" ? (
            <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 14, padding: "12px 14px", minHeight: 180, boxSizing: "border-box" }}>
              {/* 拍子グリッド(分母の音符=1拍。6/8なら8分音符が1拍で1小節6クリック) */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
                {METRO_SIGS.map((sig) => (
                  <button key={sig} onClick={() => { setMetroSig(sig); setMetroPanel(null); }} style={{
                    padding: "8px 0", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-num)",
                    border: metroSig === sig ? "1.5px solid #174585" : "1px solid #E9ECF0",
                    background: metroSig === sig ? "#EAEFF5" : "#FFFFFF",
                    color: metroSig === sig ? "#174585" : "#435266",
                  }}>{sig}</button>
                ))}
              </div>
              {/* アクセント(デフォルトON)。拍子を選ぶとパネルは自動で閉じるため完了ボタンは置かない */}
              <div style={{ display: "flex", alignItems: "center", marginTop: 10 }}>
                <label className="sans" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#435266", cursor: "pointer" }}>
                  <input type="checkbox" checked={metroAccent} onChange={(e) => setMetroAccent(e.target.checked)} />
                  一拍目にアクセントをつける
                </label>
              </div>
            </div>
          ) : metroPanel === "subdiv" ? (
            <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 14, padding: "12px 14px", minHeight: 180, boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
              {/* 1拍の分割を音符アイコンで選択。X/4等は 1/2/3連/16分。
                  X/8拍子は「主拍のみ」か「8分音符で拍を埋める(複合なら1拍に8分3つ=実質3連)」の2択。 */}
              <span className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>1拍の分割</span>
              <div style={{ display: "flex", alignItems: "stretch", gap: 6, marginTop: 10 }}>
                {metroSubdivOptions.map((s) => {
                  const selected = metroSubdiv === s.value;
                  return (
                    <button key={s.value} onClick={() => { setMetroSubdiv(s.value); if (metroSig !== "5/8" && metroSig !== "7/8") setMetroPanel(null); }} aria-label={`分割 ${s.value}`} style={{
                      flex: 1, padding: "12px 0", borderRadius: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      border: selected ? "1.5px solid #174585" : "1px solid #E9ECF0",
                      background: selected ? "#EAEFF5" : "#FFFFFF",
                    }}>
                      <SubdivNoteIcon value={s.icon ?? s.value} size={30} color={selected ? "#174585" : "#435266"} />
                    </button>
                  );
                })}
              </div>
              {/* 5/8・7/8は拍のグループ(8分音符の束ね方=主拍の区切り)をここで選ぶ。 */}
              {(metroSig === "5/8" || metroSig === "7/8") && (() => {
                const choices = metroSig === "5/8" ? [[3, 2], [2, 3]] : [[3, 2, 2], [2, 3, 2], [2, 2, 3]];
                const cur = Array.isArray(metroGrouping) ? metroGrouping.join("+") : "";
                return (
                  <div style={{ marginTop: 14 }}>
                    <span className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>拍のグループ</span>
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      {choices.map((g) => {
                        const label = g.join("+");
                        const selected = cur === label;
                        return (
                          <button key={label} onClick={() => { setMetroGrouping(g); setMetroPanel(null); }} className="sans" style={{
                            flex: 1, padding: "8px 0", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-num)",
                            border: selected ? "1.5px solid #174585" : "1px solid #E9ECF0",
                            background: selected ? "#EAEFF5" : "#FFFFFF", color: selected ? "#174585" : "#435266",
                          }}>{label}</button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {/* 5/8・7/8は分割と拍グループの2つを選ぶため完了ボタンを残す(片方だけ変えたい時の閉じ手段)。
                  他の拍子は分割を選んだ時点で自動で閉じるので完了ボタンは出さない。 */}
              {(metroSig === "5/8" || metroSig === "7/8") && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "auto", paddingTop: 10 }}>
                  <button onClick={() => setMetroPanel(null)} className="sans" style={{ padding: "7px 18px", borderRadius: 999, border: "none", background: "#174585", color: "#FFFFFF", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>完了</button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
      </div>{/* /上端に固定 */}

      {/* ── 主役 ── 環。上端の塊から --sp-1 の固定間隔だけ下、という位置から絶対に動かさない。
          flexShrink:0 を明示して、下の中身が増えても環が痩せないようにする。 */}
      {/* 音名+ピッチ表示。実音(コンサートピッチ)表示。演奏中サーフェスなので、
          メトロノームの開閉にかかわらず環(PitchRing)を主役にする(設計言語を1つに保つ)。
          【大きさは変えない】以前はメトロノームを開くと 330→250 に縮めていたが、主役の
          大きさが開閉のたびに変わるのは読み取りを妨げる。環は常に RING_D_FULL(330)。
          メトロノームを開いている間は、環の内側の上半円が振り子・下半円が拍の点になる。
          以前あった「26pxの音名+横メーター+13pxのセント値」へのフォールバックは廃止した
          (1m先で読めないうえ、セント色の閾値が環と一致していなかった)。 */}
      {!(showMetroPanel && metroPanel !== null) && (
        // 環の下の余白は「可変の中間」側(グラフの marginTop / 操作UIの marginTop)が持つ。
        // ここに状態で変わる padding を足すと、それ自体が状態依存の寸法になるので置かない。
        <div style={{ flexShrink: 0 }}>
          <PitchRing
            note={note} centsOffset={centsOffset}
            diameter={RING_D_FULL}
            getBeatPhase={showMetroPanel ? getMetroPhase : null}
            beatsPerMeasure={metroBeatsPerMeasure}
            accentOn={metroAccent}
          />
        </div>
      )}

      {/* ── 可変の中間 ── flex:1。状態ごとに中身が入れ替わる(素=これまでの音 / メトロノーム=操作UI)。
          余った縦スペースはすべてここが吸収するので、上の環も下のアクションも動かない。 */}
      <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* メトロノームの操作UI: START/STOP・テンポ・拍子・1拍の分割。
          拍の「表示」は環が担うので、ここは操作系だけを環の下にまとめる。
          【当たり判定の注意】拍子/分割ボタンは絶対配置で中央のテンポ行に「重ねて」いる。
          左右のボタンが幅を取りすぎると、見た目には重なりが見えないまま ± ボタンの上に
          乗り、押しても効かない領域ができる(実際に ＋ の実効幅が39.5pxまで削られていた)。
          左右の padding とテンポ行の gap は、この行の合計幅が実効内寸347pxに収まり、
          かつ各ボタンが重ならないことを elementFromPoint で確認したうえでの値。 */}
      {showMetroPanel && metroPanel === null && (
        <div style={{ position: "relative", marginTop: 8 }}>
          <button onClick={() => setMetroPanel((p) => (p === "sig" ? null : "sig"))} aria-label="拍子" style={{
            position: "absolute", left: 2, top: 0, bottom: 0, minHeight: 44, padding: "0 16px", borderRadius: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            border: metroPanel === "sig" ? "1.5px solid var(--c-accent)" : "1px solid var(--c-line)",
            background: metroPanel === "sig" ? "var(--c-accent-tint)" : "var(--c-surface)",
          }}><TimeSigStacked sig={metroSig} fontSize={20} /></button>
          <button onClick={() => setMetroPanel((p) => (p === "subdiv" ? null : "subdiv"))} aria-label="1拍の分割" style={{
            position: "absolute", right: 2, top: 0, bottom: 0, minHeight: 44, padding: "0 8px", borderRadius: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            border: metroPanel === "subdiv" ? "1.5px solid var(--c-accent)" : "1px solid var(--c-line)",
            background: metroPanel === "subdiv" ? "var(--c-accent-tint)" : "var(--c-surface)",
          }}>
            {/* SubdivNoteIcon は色をSVGのプレゼンテーション属性(fill/stroke)に渡すため
                var() が使えない。--c-accent と同値のhexをそのまま渡す。 */}
            <SubdivNoteIcon value={metroSigDen === 8 && metroSubdiv >= 2 ? (metroCompoundX8 ? 3 : 2) : metroSubdiv} size={32} color="#174585" />
          </button>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            {/* 上段: START/STOP(画面中央・大きめ) */}
            <button
              onClick={() => (metronomeOn ? stopMetronome() : startMetronome())}
              className="sans"
              style={{
                width: 210, maxWidth: "82%", minHeight: 44, padding: "12px 0", borderRadius: 999, fontSize: 17, fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em",
                // 停止の赤は --c-danger(中断の操作)。--c-bad(音程が大きく外れている)とは
                // 値が同じでも意味が違うので流用しない(DESIGN-SYSTEM §1.5 / §1.6)。
                border: metronomeOn ? "2px solid var(--c-danger)" : "2px solid transparent",
                background: metronomeOn ? "var(--c-surface)" : "var(--c-accent)",
                // 紺地に乗る白文字は --c-on-accent。面のトークン(--c-surface)を文字色に
                // 流用しない(片方だけ変えたいときに必ず破綻するため)。
                color: metronomeOn ? "var(--c-danger)" : "var(--c-on-accent)",
              }}
            >
              {metronomeOn ? "STOP" : "START"}
            </button>
            {/* 下段: テンポ(−/数値タップで直接入力/+)。STARTと同じく画面中央 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
              <button onClick={() => setMetroTempo((v) => clampMetroTempo((Number(v) || 120) - 1))} aria-label="テンポを下げる" style={{ width: 46, height: 46, borderRadius: "50%", border: "1px solid var(--c-line-strong)", background: "var(--c-surface)", color: "var(--c-ink-2)", fontSize: 24, cursor: "pointer", lineHeight: 1, padding: 0, flexShrink: 0 }}>−</button>
              {tempoEditing ? (
                // Enterでの確定はカスタムkeydown判定ではなく、<form>のsubmit(ブラウザ標準機構、
                // number inputを含む単一フィールドのフォームはEnterで自動submitされる)に任せる。
                // フィールド外タップでの確定はonBlurで引き続き対応する。
                <form
                  onSubmit={(e) => { e.preventDefault(); setMetroTempo(clampMetroTempo(tempoInputRef.current?.value)); setTempoEditing(false); }}
                  style={{ display: "inline-block" }}
                >
                  <input
                    ref={tempoInputRef}
                    type="number" inputMode="numeric"
                    defaultValue={metroTempo}
                    onBlur={(e) => { setMetroTempo(clampMetroTempo(e.target.value)); setTempoEditing(false); }}
                    style={{ width: 104, height: 46, textAlign: "center", fontSize: 36, fontWeight: 600, fontFamily: "var(--font-num)", border: "1px solid var(--c-accent-line)", borderRadius: 8, padding: "3px 0", color: "var(--c-ink)", background: "var(--c-surface)" }}
                  />
                </form>
              ) : (
                <button onClick={() => setTempoEditing(true)} className="num-tight" style={{ minWidth: 104, minHeight: 46, background: "none", border: "none", fontFamily: "var(--font-num)", fontSize: 42, fontWeight: 600, color: "var(--c-ink)", cursor: "pointer", padding: 0, lineHeight: 1 }}>{metroTempo}</button>
              )}
              <button onClick={() => setMetroTempo((v) => clampMetroTempo((Number(v) || 120) + 1))} aria-label="テンポを上げる" style={{ width: 46, height: 46, borderRadius: "50%", border: "1px solid var(--c-line-strong)", background: "var(--c-surface)", color: "var(--c-ink-2)", fontSize: 24, cursor: "pointer", lineHeight: 1, padding: 0, flexShrink: 0 }}>＋</button>
            </div>
          </div>
        </div>
      )}

      {/* 「これまでの音」ミニタイムライン。メーターと同様、録音開始有無に関わらず常時動かす。
          録音中はphraseFrames(セッションになる確定データ)を、それ以外はマイク接続中に常に
          更新され続ける直近30秒のローリングバッファ(liveFrames)を表示に使う。以前は録音を一度
          行うとphraseFramesが残り続け、録音停止後もグラフが過去の録音で固まったままになっていた
          ため、録音していない間はliveFramesを優先してライブ追従させる。 */}
      {/* フレームが無い(マイク未接続・音を出す前)状態でも常にグラフを描き、既定は中央0¢の
          フラットなラインを表示する(空状態の別レイアウトに切り替えず、位置ブレをなくす)。 */}
      {/* quietは常にtrue。環が主役の演奏中サーフェスなので、縦軸の12px数値ラベルを
          出す/出さないで設計言語が割れないようにする。
          【メトロノームを開いている間は隠す】環を330px固定にしたぶんの縦スペースをここから
          捻出する。メトロノーム使用中はリズムに集中していて、ピッチの履歴は合間に読むもの。 */}
      {!showMetroPanel && (
      <div style={{ marginTop: 6 }}>
        <PitchDeviationLine frames={isRecording ? phraseFrames : liveFrames} quiet />
      </div>
      )}

      </div>{/* /可変の中間 */}

      {/* ── 下端に固定 ── 録音・アップロードと詳細トグル。枠の高さが measureMinH で固定なので
          この2つの top は状態が変わっても動かない。
          拍子/リズムの選択パネルを開いている間は、その枠だけを見せるため録音・アップロード・詳細も隠す */}
      {!(showMetroPanel && metroPanel !== null) && (
      <div style={{ flexShrink: 0 }}>
      {/* 録音/アップロード: 「これまでの音」の直下に置き、スクロールなしで押せるようにする。
          アイコンをラベルの上に積んだpill型。均等幅で並べ、録音は塗り、アップロードは輪郭のみ。 */}
      <div style={{ display: "flex", gap: 11, padding: "12px 0 4px" }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isRecording || isAnalyzingUpload}
          className="sans"
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: "#FFFFFF", color: "#174585", border: "1.5px solid #174585", borderRadius: 16, padding: "16px 0", fontSize: 15, fontWeight: 700, cursor: isRecording || isAnalyzingUpload ? "default" : "pointer", opacity: isRecording || isAnalyzingUpload ? 0.5 : 1 }}
        >
          <Upload size={16} />
          {isAnalyzingUpload ? "解析中…" : "録音をアップロード"}
        </button>
        <button
          onClick={toggleRecording}
          className="sans"
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, background: isRecording ? "#DC2626" : "#174585", color: "#FFFFFF", border: "none", borderRadius: 16, padding: "16px 0", fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: isRecording ? "none" : "0 12px 28px rgba(23,69,133,.32)" }}
        >
          {isRecording ? <Square size={16} /> : <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#FFFFFF", display: "inline-block" }} />}
          {isRecording ? "停止" : "録音する"}
        </button>
      </div>

      {/* 詳細トグル: 倍音構成・音量/重心/HNR・計測下限dB・基準を1枚の折りたたみカードにまとめ、
          画面の一番下(録音ボタンより下)に置く。 */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
        <button
          onClick={() => setDetailOpen((v) => !v)}
          aria-label={detailOpen ? "詳細を閉じる" : "詳細を見る"}
          style={{ width: 200, maxWidth: "72%", padding: "9px 0", borderRadius: 999, border: "1px solid #D9E1EC", background: "#F3F6FA", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {detailOpen
            ? <ChevronUp size={24} color="#174585" strokeWidth={2.5} />
            : <ChevronDown size={24} color="#174585" strokeWidth={2.5} />}
        </button>
      </div>
      </div>
      )}
      </div>{/* /画面ぶんの固定枠 */}

      {/* ── 追加表示 ── 詳細カード。固定枠の「外・下」に置く。開いても枠の高さは measureMinH の
          ままなので、環・録音ボタン・詳細トグルは1pxも動かない。増えたぶんだけページが縦に伸び、
          ここから下だけがスクロールする(素の状態・メトロノームだけの状態ではスクロールしない)。 */}
      {detailOpen && !(showMetroPanel && metroPanel !== null) && (
        <div style={{ padding: "16px 0 10px" }}>
          <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 14, padding: 16 }}>
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <span className="sans" style={{ fontSize: 13, fontWeight: 700, color: "#121F32" }}>倍音構成（実測 / 基準）</span>
              <div className="sans" style={{ display: "flex", gap: 10, fontSize: 12, color: "#435266" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={showIdeal} onChange={(e) => setShowIdeal(e.target.checked)} /> 基準</label>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 140, paddingTop: 14 }}>
              {Array.from({ length: NUM_HARMONICS }).map((_, idx) => {
                const n = idx + 1;
                const measured = harmonicLevels.find((h) => h.n === n);
                const measuredHeight = measured ? measured.norm * 100 : 0;
                const idealHarmonic = currentNoteIdeal?.harmonicsProfile?.find((h) => h.n === n);
                const idealHeight = idealHarmonic ? idealHarmonic.norm * 100 : 0;
                const showIdealBar = showIdeal && currentNoteIdeal && !!idealHarmonic;
                return (
                  <div key={n} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
                    <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, position: "relative" }}>
                      <div style={{ width: "38%", height: `${measuredHeight}%`, background: measured ? "#174585" : "transparent", borderRadius: "3px 3px 0 0", minHeight: measured ? 3 : 0, transition: "height 0.1s ease-out" }} />
                      {/* 理想バーの枠(28%)は常に確保する。理想が出ている時と出ていない時で
                          実測バーの横位置が動かないようにするため、非表示時も同じ幅の空スロットを残す。 */}
                      <div style={{ width: "28%", height: showIdealBar ? `${idealHeight}%` : 0, border: showIdealBar ? "1.5px dashed #8D95A1" : "none", borderBottom: "none", borderRadius: "3px 3px 0 0", minHeight: showIdealBar ? 3 : 0, opacity: 0.85, boxSizing: "border-box" }} />
                    </div>
                    <div className="sans" style={{ fontSize: 12, color: "#435266", marginTop: 4 }}>{n}倍</div>
                  </div>
                );
              })}
            </div>
            <div className="sans" style={{ fontSize: 12, color: "#435266", marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "#174585", borderRadius: 2, display: "inline-block" }} />実測</span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, border: "1.5px dashed #8D95A1", borderRadius: 2, display: "inline-block" }} />基準{selectedIdeal ? `: ${selectedIdeal.name}` : "(未選択)"}</span>
            </div>

            <div style={{ height: 1, background: "#EEF1F4", margin: "18px 0 16px" }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 16 }}>
              {/* 値・単位・理想行は常に同じ形で描画し、測れない瞬間も「—」で行をキープする(ガタつき防止) */}
              <MetricCard label="音量" value={volumeDb.toFixed(1)} unit="dB" sub={`基準: ${currentNoteIdeal?.volumeDb != null ? `${currentNoteIdeal.volumeDb.toFixed(1)} dB` : "— dB"}`} />
              <MetricCard label="スペクトル重心" value={centroidHz != null ? String(Math.round(centroidHz)) : "—"} unit="Hz" sub={`基準: ${currentNoteIdeal?.centroidHz != null ? `${Math.round(currentNoteIdeal.centroidHz)} Hz` : "— Hz"}`} />
              <MetricCard label="HNR" value={hnrDb !== null ? hnrDb.toFixed(1) : "—"} unit="dB" sub={`基準: ${currentNoteIdeal?.hnrDb != null ? `${currentNoteIdeal.hnrDb.toFixed(1)} dB` : "— dB"}`} />
            </div>

            <div style={{ height: 1, background: "#EEF1F4", margin: "18px 0 14px" }} />

            {/* 計測下限dB: バンドパス後の音量がこの値以下なら無音とみなす(旧称ノイズゲート)。 */}
            <div className="sans" style={{ fontSize: 12, color: "#121F32", fontWeight: 700, marginBottom: 8 }}>計測下限dB</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range" min="-80" max="-20" step="1" value={noiseGateDb}
                onChange={(e) => setNoiseGateDb(Number(e.target.value))}
                style={{ flex: 1, accentColor: "#174585" }}
              />
              <span style={{ fontFamily: "var(--font-num)", fontSize: 13, fontWeight: 700, color: "#174585", width: 62, textAlign: "right" }}>{noiseGateDb} dB</span>
            </div>

            {/* 端末がAGC等を無効化できなかった場合の警告(iOS Safari等で発生しうる) */}
            {micProcessingWarning && (
              <div className="sans" style={{ marginTop: 10, padding: "8px 10px", background: "#FDF0E1", border: "1px solid #F0D9B8", borderRadius: 8, fontSize: 12, color: "#8A5A00", lineHeight: 1.6 }}>
                {micProcessingWarning}
              </div>
            )}

            {/* 基準(旧・理想値プロファイル)。作成は録音後の「基準に設定」ボタンから行う。
                計測下限dBの下に置き、詳細を閉じると一緒に隠れる。 */}
            {idealProfiles.length > 0 && (
              <>
                <div style={{ height: 1, background: "#EEF1F4", margin: "18px 0 14px" }} />
                <div className="sans" style={{ fontSize: 12, color: "#121F32", fontWeight: 700, marginBottom: 8 }}>基準</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {idealProfiles.map((p) => (
                    <div key={p.id} onClick={() => setSelectedIdealId(p.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", borderRadius: 4, cursor: "pointer", border: selectedIdealId === p.id ? "1.5px solid #174585" : "1px solid #E9ECF0", background: selectedIdealId === p.id ? "#EAEFF5" : "transparent" }}>
                      <div className="sans" style={{ fontSize: 12, color: selectedIdealId === p.id ? "#174585" : "#121F32" }}>{p.name}<span style={{ fontSize: 12, color: "#435266", marginLeft: 6 }}>{SAX_PRESETS[p.saxType]?.label}</span></div>
                      <button onClick={(e) => { e.stopPropagation(); deleteIdealProfile(p.id); }} style={{ background: "none", border: "none", color: "#435266", cursor: "pointer", padding: 4 }}><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 浮かせる告知(レイアウトの流れの外) ───────────────────────────────
          録音中・アップロード・保存確認は「出たり消えたりする過渡的な告知」なので、
          上端固定ブロックの流れに置くと出た瞬間に環・録音ボタン・詳細トグルが下がる
          (F-8。審査役の実測で上端に40px出ると環+40 / アクション+29 / スクロール29)。
          可変の中間へ移す案も、メトロノーム開の中間の余りが2pxしかないため溢れる(F-3)。
          → 流れから外す(position:fixed)のが唯一の解。DESIGN-SYSTEM §6.1.5。 */}

      {/* 過渡的な告知(録音中 / アップロードの進捗・タップ要求・完了)。
          画面上端(=.app-root の padding と同じ式)に浮かせてコンテンツ列に揃える。
          環は上端から147px下なので、環と音名は隠さない。 */}
      {(isRecording || isAnalyzingUpload || lastUploadedSession) && (
        <div
          style={{
            position: "fixed", zIndex: 40,
            top: "calc(16px + env(safe-area-inset-top))",
            left: "calc(14px + env(safe-area-inset-left))",
            right: "calc(14px + env(safe-area-inset-right))",
            pointerEvents: "none", // 告知が出ていない領域は下の操作を邪魔しない
          }}
        >
          <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {isRecording && (
              <div className="sans" style={{ pointerEvents: "auto", alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "var(--sp-2) var(--sp-4)", background: "var(--c-surface)", border: "1px solid var(--c-line)", borderRadius: "var(--r-pill)", boxShadow: "0 8px 24px rgba(15,23,42,0.18)", fontSize: "var(--fs-md)", fontWeight: 600, color: "var(--c-accent)" }}>
                {/* 点滅は index.css の @keyframes pulse。.ficus-pulse を付けると
                    prefers-reduced-motion の端末で止まる(既に用意されていたが未使用だった)。 */}
                <span className="ficus-pulse" style={{ width: 8, height: 8, background: "var(--c-danger)", borderRadius: "50%", display: "inline-block", animation: "pulse 1s infinite" }} />
                録音中
              </div>
            )}
            {/* ブラウザの自動再生制限で動画の再生開始がブロックされた場合は、タップで再開してもらう
                (新しいタップイベントの中でplay()を呼び直せば許可される)。 */}
            {isAnalyzingUpload && uploadNeedsTap && (
              <div style={{ pointerEvents: "auto", display: "flex", gap: "var(--sp-3)", padding: "var(--sp-3) var(--sp-4)", background: "var(--c-accent-tint)", border: "1px solid var(--c-accent-line)", borderRadius: "var(--r-lg)", alignItems: "center", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
                <span className="sans" style={{ fontSize: "var(--fs-md)", color: "var(--c-accent)", fontWeight: 600, flex: 1 }}>タップして動画の解析を開始してください</span>
                <button
                  onClick={() => { const start = uploadNeedsTap; setUploadNeedsTap(null); start(); }}
                  className="sans"
                  style={{ minHeight: "var(--tap-min)", padding: "0 var(--sp-4)", borderRadius: "var(--r-pill)", border: "none", background: "var(--c-accent)", color: "var(--c-on-accent)", fontSize: "var(--fs-md)", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}
                >
                  解析を開始
                </button>
              </div>
            )}
            {/* 解析の進捗(ライブ録音と同じ解析パイプラインを通すため、ファイルの長さと同じだけ時間がかかる) */}
            {isAnalyzingUpload && !uploadNeedsTap && (
              <div style={{ pointerEvents: "auto", padding: "var(--sp-3) var(--sp-4)", background: "var(--c-surface)", border: "1px solid var(--c-line)", borderRadius: "var(--r-lg)", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
                <div style={{ background: "#EEF1F4", borderRadius: "var(--r-xs)", height: 8, overflow: "hidden" }}>
                  <div style={{ width: `${Math.round(uploadProgress * 100)}%`, height: "100%", background: "var(--c-accent)", borderRadius: "var(--r-xs)", transition: "width 0.2s linear" }} />
                </div>
                <div className="sans" style={{ fontFamily: "var(--font-num)", fontSize: "var(--fs-md)", color: "var(--c-ink-2)", marginTop: "var(--sp-1)" }}>{Math.round(uploadProgress * 100)}%</div>
              </div>
            )}
            {!isAnalyzingUpload && lastUploadedSession && (
              <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "var(--sp-1) var(--sp-1) var(--sp-1) var(--sp-4)", background: "var(--c-surface)", border: "1px solid var(--c-line)", borderRadius: "var(--r-lg)", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
                <span className="sans" style={{ fontSize: "var(--fs-md)", color: "var(--c-good)", flex: 1 }}>アップロードの解析が完了しました</span>
                <SetAsIdealButton tapMin frames={lastUploadedSession.frames} saxType={lastUploadedSession.saxType} onSave={promoteSessionToIdeal} />
                {/* タップで表示を閉じる(録音・再アップロード等の他アクションでも自動で消える)。
                    見た目の丸は22pxのまま、当たり判定だけ --tap-min に広げる(DESIGN-SYSTEM §5)。 */}
                <button
                  onClick={() => setLastUploadedSession(null)}
                  className="sans"
                  aria-label="閉じる"
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "var(--tap-min)", height: "var(--tap-min)", background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "var(--r-pill)", border: "1px solid var(--c-line)", background: "var(--c-surface)", color: "var(--c-ink-3)", fontSize: "var(--fs-sm)", lineHeight: 1 }}>×</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 録音停止後: この録音を「登録」(セッションとして保存)するか「取り直し」(破棄)するか選ぶ。
          登録したセッションは分析タブから理想値に設定することもできる。
          【背景タップでは閉じない】誤タップで録音を失わせないため、暗幕に onClick を付けない。
          どちらかを選べば registerPendingSession / discardPendingSession が pendingSession を
          null にするので、そのまま消える。保存・破棄のロジックには触っていない。
          暗幕の色・不透明度・カードの影は ScrollPicker と同値(新しい濃さを発明しない)。
          カードは下寄せ。画面中央に置くと環(top 147〜477)を覆ってしまうため、
          環と音名を隠さない位置=環の下・アクションの上に浮かせる。 */}
      {!isRecording && pendingSession && (
        <div
          role="dialog" aria-modal="true" aria-label="この録音を保存しますか？"
          style={{
            position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.28)",
            display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center",
            padding: "var(--sp-4)",
            paddingBottom: "calc(var(--page-bottom-gap) + var(--sp-4))",
          }}
        >
          <div style={{ width: "100%", maxWidth: 900, background: "var(--c-surface)", borderRadius: "var(--r-lg)", padding: "var(--sp-4)", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
            <div className="sans" style={{ fontSize: "var(--fs-lg)", fontWeight: 700, color: "var(--c-ink)" }}>この録音を保存しますか？</div>
            <div style={{ display: "flex", gap: "var(--sp-3)", marginTop: "var(--sp-4)" }}>
              <button
                onClick={discardPendingSession}
                className="sans"
                style={{ flex: 1, minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)", border: "1px solid var(--c-line-strong)", background: "var(--c-surface)", color: "var(--c-ink-2)", fontSize: "var(--fs-md)", fontWeight: 600, cursor: "pointer" }}
              >
                取り直し
              </button>
              <button
                onClick={registerPendingSession}
                className="sans"
                style={{ flex: 1, minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)", border: "none", background: "var(--c-accent)", color: "var(--c-on-accent)", fontSize: "var(--fs-md)", fontWeight: 700, cursor: "pointer" }}
              >
                登録
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// フレーズのタイムライン+ドリルダウン表示。計測タブ(ライブ直後)とセッション詳細(履歴)の両方から使う共通コンポーネント。
// 理想値プロファイル自体の選択は計測タブの設定欄で行う前提のため、ここでは「基準」として
// 理想値/お手本セッション/(音高のみ)理論値のどれと比較するかだけを選ぶ。
function PhraseTimeline({ frames, noteEvents, selectedIdeal, NUM_HARMONICS, sessions, ownSessionId, barlines }) {
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

  // 音高だけ絶対値(平均律の正しいピッチ)との比較も選べる。それ以外の指標は理想値/お手本セッションのみ。
  const referenceOptions = timelineMetric === "pitch"
    ? [
        { key: "theoretical", label: "絶対値" },
        { key: "ideal", label: `理想値${selectedIdeal ? `(${selectedIdeal.name})` : ""}` },
        { key: "session", label: "別セッション" },
      ]
    : [
        { key: "ideal", label: `理想値${selectedIdeal ? `(${selectedIdeal.name})` : ""}` },
        { key: "session", label: "別セッション" },
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

  // 小節線(メトロノームのアクセント由来)の秒→x座標変換。フレームは約100ms間隔で
  // インデックスi→x=i*6に並ぶため、時刻tに最も近い前後フレームを見つけてxを線形補間する。
  const barlineXs = (() => {
    if (!barlines || barlines.length === 0 || frames.length < 2) return [];
    const xs = [];
    for (const bt of barlines) {
      // frames[i].t <= bt <= frames[i+1].t となるiを探す(単純な線形探索。小節数は多くない)
      if (bt < frames[0].t || bt > frames[frames.length - 1].t) continue;
      let i = 0;
      while (i < frames.length - 1 && frames[i + 1].t < bt) i++;
      const t0 = frames[i].t, t1 = frames[i + 1]?.t ?? t0;
      const frac = t1 > t0 ? (bt - t0) / (t1 - t0) : 0;
      xs.push((i + frac) * 6);
    }
    return xs;
  })();

  return (
    <>
      {/* 表示切り替え・比較基準 */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "10px 14px", marginBottom: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="sans" style={{ fontSize: 12, color: "#435266" }}>表示:</span>
          <select value={timelineMetric} onChange={(e) => setTimelineMetric(e.target.value)}>
            {metricOptions.map((m) => (<option key={m.key} value={m.key}>{m.label}</option>))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="sans" style={{ fontSize: 12, color: "#435266" }}>基準:</span>
          <select value={referenceBasis} onChange={(e) => setReferenceBasis(e.target.value)}>
            {referenceOptions.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
          </select>
          {referenceBasis === "session" && (
            <select value={referenceSessionId || ""} onChange={(e) => setReferenceSessionId(e.target.value || null)}>
              <option value="">別セッションを選択</option>
              {referenceCandidates.map((s) => (
                <option key={s.id} value={s.id}>{new Date(s.recordedAt).toLocaleString("ja-JP")}{s.memo ? ` 「${s.memo}」` : ""}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      {referenceBasis === "session" && referenceSession && (
        <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginBottom: 10 }}>
          最初の発音タイミングを基準に自動で位置合わせして比較します
        </div>
      )}

      {/* タイムライン */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "14px", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 12, color: "#435266", marginBottom: 8 }}>
          タイムライン — ピッチ一致度で色分け（{referenceBasis === "theoretical" ? "絶対値基準" : referenceBasis === "session" ? "別セッション基準" : "理想値基準"}）
          {noteEvents?.length > 0 && (() => {
            const attacks = noteEvents.map((e) => e.attackTimeMs).filter((v) => v !== null);
            const avg = attacks.length ? Math.round(attacks.reduce((a, b) => a + b, 0) / attacks.length) : null;
            return <span style={{ marginLeft: 8 }}>｜ 検出ノート {noteEvents.length}{avg !== null ? ` ・ 平均アタック ${avg}ms` : ""}</span>;
          })()}
        </div>
        <div ref={timelineScrollRef} style={{ overflowX: "auto" }}>
          <svg width={Math.max(600, frames.length * 6)} height="120" style={{ display: "block" }}>
            {/* 小節線(メトロノームのアクセント=小節頭。折れ線より先に描いて背面に置く) */}
            {barlineXs.map((x, k) => (
              <line key={`bar-${k}`} x1={x} y1={0} x2={x} y2={108} stroke="#C3CAD3" strokeWidth="1" />
            ))}
            <polyline
              fill="none" stroke="#174585" strokeWidth="1.5"
              points={frames.map((f, i) => {
                const v = getMetricValue(f);
                const y = v !== null && v !== undefined && !isNaN(v) ? 100 - ((v - minV) / range) * 90 : 100;
                return `${i * 6},${y}`;
              }).join(" ")}
            />
            {/* 検出した音名(記音)を時系列に沿って表示する(計測タブの折れ線と同様) */}
            {(() => {
              const labels = [];
              let curName = null, lastX = -100;
              frames.forEach((f, i) => {
                const nm = f.concertNote || f.matchedWrittenNote || null;
                if (nm && nm !== curName) {
                  const x = i * 6;
                  if (x - lastX >= 22) { labels.push({ name: nm, x }); lastX = x; }
                  curName = nm;
                } else if (!nm) curName = null;
              });
              return labels.map((l, k) => (
                <text key={k} x={l.x} y={9} fontSize="11" fontWeight="700" fill="#174585" fontFamily="var(--font-num)">{l.name}</text>
              ));
            })()}
            {frames.map((f, i) => {
              // 無音・測定外(ピッチ未検出)のフレームは一致度が定義できないためグレーにする
              // (以前はスコア0扱いで赤く表示され、測定できていない区間が「大きく外れている」ように見えていた)。
              const sounding = f.pitchHz != null && !isNaN(f.pitchHz);
              const color = sounding ? scoreToColor(getMatchScore(f, "pitch")) : "#C3CAD3";
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
        <div className="sans" style={{ fontSize: 12, color: "#8D95A1", display: "flex", justifyContent: "space-between" }}>
          <span>0s</span>
          <span>{frames[frames.length - 1]?.t.toFixed(1)}s</span>
        </div>
      </div>

      {/* ドリルダウン: 選択フレームの詳細 */}
      {selectedFrame && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "14px" }}>
          <div className="sans" style={{ fontSize: 12, color: "#435266", marginBottom: 10 }}>
            t = {selectedFrame.t.toFixed(2)}s の詳細
          </div>

          {(() => {
            const target = getComparisonTarget(selectedFrame);
            const noTargetLabel = referenceBasis === "session" ? "対応する別セッションの瞬間がありません" : "この音の理想値が未登録";
            return (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <MetricCard label="ピッチ一致度" value={`${Math.round(getMatchScore(selectedFrame, "pitch") * 100)}%`} sub={selectedFrame.pitchHz ? `${selectedFrame.pitchHz.toFixed(1)} Hz ／ 記音${selectedFrame.matchedWrittenNote ?? "—"}` : "—"} accentColor={scoreToColor(getMatchScore(selectedFrame, "pitch"))} />
                <MetricCard label="音色一致度(比較対象基準)" value={target ? `${Math.round(getMatchScore(selectedFrame, "timbre") * 100)}%` : "—"} sub={target ? `重心 ${Math.round(selectedFrame.spectralCentroidHz)}Hz` : noTargetLabel} accentColor={target ? scoreToColor(getMatchScore(selectedFrame, "timbre")) : undefined} />
              </div>
            );
          })()}

          <div className="sans" style={{ fontSize: 12, color: "#435266", marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span>音量: {selectedFrame.volumeDb?.toFixed(1)} dB</span>
            <span>HNR: {selectedFrame.hnrDb?.toFixed(1) ?? "—"} dB</span>
          </div>
        </div>
      )}
    </>
  );
}

// 主観評価の表示(0.1刻み)。星を部分的に塗って小数の評価を表す。編集はRatingSliderで行う。
function StarRating({ value, size = 13 }) {
  const v = value || 0;
  return (
    <div style={{ display: "flex", gap: 1, alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = Math.max(0, Math.min(1, v - (n - 1)));
        return (
          <span key={n} style={{ position: "relative", fontSize: size, lineHeight: 1, userSelect: "none", display: "inline-block" }}>
            <span style={{ color: "#C3CAD3" }}>★</span>
            <span style={{ position: "absolute", left: 0, top: 0, width: `${fill * 100}%`, overflow: "hidden", color: "#D97706", whiteSpace: "nowrap" }}>★</span>
          </span>
        );
      })}
    </div>
  );
}

// 主観評価の入力(0〜5・0.1刻みスライダー)。数値を右に表示する。onCommitは指を離した時に呼ぶ
// (評価履歴への追記など、確定タイミングで実行したい処理に使う)。
function RatingSlider({ value, onChange, onCommit }) {
  const v = value ?? 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
      <input
        type="range" min="0" max="5" step="0.1" value={v}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={() => onCommit?.()} onKeyUp={() => onCommit?.()}
        style={{ flex: 1, accentColor: "#174585" }}
      />
      <span style={{ fontFamily: "var(--font-num)", fontSize: 15, fontWeight: 700, color: "#174585", width: 30, textAlign: "right" }}>{v.toFixed(1)}</span>
    </div>
  );
}

// 主観評価(総評)の入力: 縦スクロールのダイヤル。0.0〜5.0を0.1刻みで縦に並べ、中央枠に来た値を選ぶ。
// スライダーより指の移動量あたりの分解能が高く、片手で微調整しやすい(ユーザー要望)。
// スクロールが止まってからonCommitするため、履歴が1操作につき1件だけ積まれる。
function RatingDial({ value, onChange, onCommit, height = 96 }) {
  const ref = useRef(null);
  const ITEM = 24;
  const steps = useMemo(() => Array.from({ length: 51 }, (_, i) => i / 10), []);
  const v = Math.max(0, Math.min(5, value ?? 0));
  const settleRef = useRef(null);
  const selfScrollRef = useRef(false);
  // 確定(onCommit)はスクロール停止後に遅れて走るため、scrollハンドラのクロージャに載せると
  // 1レンダー古いonCommit/値を呼んでしまう(保存値が1段ずれる)。最新のハンドラをrefで保持し、
  // 値は引数で明示的に渡す。
  const onCommitRef = useRef(onCommit);
  useEffect(() => { onCommitRef.current = onCommit; });
  // 外から値が変わった時だけスクロール位置を合わせる(自分のスクロール由来なら何もしない)
  useEffect(() => {
    const el = ref.current;
    if (!el || selfScrollRef.current) return;
    const target = Math.round(v * 10) * ITEM;
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
  }, [v]);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const next = Math.max(0, Math.min(5, Math.round(el.scrollTop / ITEM) / 10));
    selfScrollRef.current = true;
    if (Math.abs(next - v) > 0.001) onChange(next);
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      selfScrollRef.current = false;
      onCommitRef.current?.(next);
    }, 400); // 指が止まってから確定
  };
  useEffect(() => () => clearTimeout(settleRef.current), []);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
      {/* data-noswipe: 子タブのスワイプpagerに横取りされないようにする */}
      <div style={{ position: "relative", height, width: 62, flexShrink: 0 }} data-noswipe>
        <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: ITEM, marginTop: -ITEM / 2, background: "#EAEFF5", border: "1px solid #B9C9E4", borderRadius: 5, pointerEvents: "none" }} />
        <div
          ref={ref}
          onScroll={onScroll}
          style={{ position: "absolute", inset: 0, overflowY: "auto", scrollSnapType: "y mandatory", padding: `${(height - ITEM) / 2}px 0`, boxSizing: "border-box", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}
        >
          {steps.map((s) => {
            const on = Math.abs(s - v) < 0.05;
            return (
              <div key={s} style={{ height: ITEM, scrollSnapAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-num)", fontSize: 15, fontWeight: on ? 700 : 400, color: on ? "#174585" : "#A6AEBA", position: "relative" }}>
                {s.toFixed(1)}
              </div>
            );
          })}
        </div>
      </div>
      <StarRating value={v} size={16} />
    </div>
  );
}

// 奏者選択。「自分」固定 + 登録済みの名前 + 「名前を入力」で新規追加できる可変プルダウン。
// 一度追加した名前はperformersに積み上がり、以後の選択肢として残り続ける。
// セッション(またはライブ録音直後のフレーム列)を理想値プロファイルに設定するボタン。
// onSave({frames, saxType}, name) を呼び、実際のプロファイル生成はbuildIdealProfileFromSessionが行う。
// tapMin: 当たり判定を --tap-min(44px) 以上にする(既定は従来どおり。分析タブ側は変えない)。
// 計測タブの「解析が完了しました」告知は浮かせた告知の中に入るため、ここだけ44pt化する。
function SetAsIdealButton({ frames, saxType, onSave, tapMin }) {
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
          style={{ background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "5px 8px", color: "#121F32", fontSize: 12, width: 130 }}
        />
        <button onClick={confirm} className="sans" style={{ fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "none", background: "#174585", color: "#F6F7F9", cursor: "pointer" }}>保存</button>
        <button onClick={() => { setIsNaming(false); setName(""); }} style={{ background: "none", border: "none", color: "#8D95A1", cursor: "pointer", fontSize: 12 }}>×</button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setIsNaming(true)}
      className="sans"
      style={tapMin
        ? { fontSize: "var(--fs-sm)", minHeight: "var(--tap-min)", padding: "0 var(--sp-3)", borderRadius: "var(--r-pill)", border: "1px solid var(--c-accent)", background: "var(--c-accent-tint)", color: "var(--c-accent)", cursor: "pointer", fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }
        : { fontSize: 12, padding: "5px 10px", borderRadius: 5, border: "1px solid #174585", background: "#EAEFF5", color: "#174585", cursor: "pointer", fontWeight: 600 }}
    >
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
          style={{ background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "5px 8px", color: "#121F32", fontSize: 12, width: 110 }}
        />
        <button onClick={confirmAdd} className="sans" style={{ fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "none", background: "#174585", color: "#F6F7F9", cursor: "pointer" }}>追加</button>
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
        const rowsMoved = Math.round(deltaY / info.rowHeight);
        const targetIndex = Math.max(0, Math.min(orderRef.current.length - 1, info.anchorIndex + rowsMoved));
        // 並び替えによって行そのものが (targetIndex - anchorIndex) 行ぶん移動するため、
        // 指の総移動量をそのままtranslateYに使うと二重にずれる(特に上方向へ動かすと
        // 掴んでいる行が指より上に表示される)。動いた行数ぶんを差し引いて指に追従させる。
        setDragOffsetY(deltaY - (targetIndex - info.anchorIndex) * info.rowHeight);
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
  // 子要素(「測定へ」ボタンや★など)がpointerdownを止めた場合はdragInfoが無く、その時は
  // 行タップとして扱わない(＝onRowClickで詳細を開かない)。これがないと、モバイルでボタンを
  // 押しても行のonRowClickが発火して詳細が開いてしまい「測定へ」に飛べなかった。
  const handlePointerUp = (id) => () => {
    const info = dragInfoRef.current;
    if (!info || info.armed) return;
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
          borderRadius: isDragging ? "var(--r-sm)" : 0,
          touchAction: "pan-y",
          cursor: "pointer",
        }}
      >
        {renderRow(r, idx)}
      </div>
    );
  });
}

// 値の行は折り返し禁止+高さ固定にする。桁数が変わるたびに「-18.2 dB」が1行に収まったり
// 単位だけ折り返したりしてカードの高さが変わり、画面全体が上下にブレるのを防ぐ。
// unitを渡すと数値より小さい字で添える(狭いカードでも1行に収まりやすくする)。
function MetricCard({ label, value, unit, sub, accentColor }) {
  return (
    <div style={{ background: "#FFFFFF", border: `1px solid ${accentColor || "#E9ECF0"}`, borderRadius: 14, padding: "12px 14px" }}>
      <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-num)", fontSize: 22, fontWeight: 600, marginTop: 2, color: accentColor || "#121F32", whiteSpace: "nowrap", height: 28, lineHeight: "28px", overflow: "hidden" }}>
        {value}
        {unit && <span className="sans" style={{ fontSize: 12, color: "#8D95A1", marginLeft: 3, fontWeight: 400 }}>{unit}</span>}
      </div>
      {/* subは常に高さを確保して描画する(値が出たり消えたりで行がガタつかないように)。
          内容が無い時も空行として場所だけ残す。 */}
      <div className="sans" style={{ fontSize: 12, color: "#174585", marginTop: 2, height: 15, lineHeight: "15px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub ?? " "}</div>
    </div>
  );
}

// ============================================================
// Reeds view — 企画書v5 10節: リード管理・リード別比較・リード毎比較・ランキング
// ============================================================
// リードタブの親。登録⇄比較をスワイプpagerで行き来し、個別リード詳細の開閉も担う。
// 詳細を開いている間はpagerを出さず(早期return)、右スワイプで一覧へ戻す。
function ReedsTab(props) {
  const {
    reeds, setReeds, sessions, updateSessions, setTopTab, setSelectedReedId,
    selectedIdeal, saxType, tuningHz, compareReedIds, setCompareReedIds,
    reedsSubTab, setReedsSubTab,
  } = props;
  const [evaluatingReedId, setEvaluatingReedId] = useState(null);
  // 展開中の箱は詳細を開いている間もここで保持する。ReedRegisterView側のstateにすると
  // 詳細表示中にアンマウントされ、戻ったとき一覧が畳まれてトップに戻ってしまう(ユーザー報告)。
  const [expandedGroupKey, setExpandedGroupKey] = useState(null);
  // 一覧のスクロール位置。詳細を開く直前に控え、戻ったら同じ位置へ復帰させる。
  const listScrollYRef = useRef(0);
  const openReed = (id) => { listScrollYRef.current = window.scrollY; setEvaluatingReedId(id); };
  const closeReed = () => setEvaluatingReedId(null);

  const evaluatingReed = reeds.find((r) => r.id === evaluatingReedId) || null;
  useEffect(() => {
    if (evaluatingReedId) return; // 一覧へ戻った時だけ復元する
    const y = listScrollYRef.current;
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [evaluatingReedId]);

  if (evaluatingReed) {
    return (
      <SwipeBackArea onBack={closeReed}>
        <ReedEvaluationDetail
          reed={evaluatingReed} reeds={reeds} sessions={sessions} setReeds={setReeds}
          selectedIdeal={selectedIdeal} saxType={saxType} tuningHz={tuningHz}
          onBack={closeReed}
        />
      </SwipeBackArea>
    );
  }

  return (
    <SwipePager
      index={reedsSubTab === "compare" ? 1 : 0}
      onIndexChange={(i) => setReedsSubTab(i === 1 ? "compare" : "register")}
    >
      <ReedRegisterView
        reeds={reeds} setReeds={setReeds}
        sessions={sessions} updateSessions={updateSessions}
        setTopTab={setTopTab} setSelectedReedId={setSelectedReedId}
        selectedIdeal={selectedIdeal} saxType={saxType} tuningHz={tuningHz}
        onOpenReed={openReed}
        expandedGroupKey={expandedGroupKey} setExpandedGroupKey={setExpandedGroupKey}
      />
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <ReedCompareTab reeds={reeds} sessions={sessions} compareReedIds={compareReedIds} setCompareReedIds={setCompareReedIds} saxType={saxType} tuningHz={tuningHz} />
      </div>
    </SwipePager>
  );
}

// ============================================================
// リード登録タブ (企画書10.2/10.3節) — 銘柄/番手プルダウン化、10枚まとめ登録に対応
// ============================================================

// 入力欄・selectの共通スタイル。角丸は --r-xs(4px)、高さは --tap-min(44px)。
// select/input は「見た目＝当たり判定」なので、DESIGN-SYSTEM §5 の minHeight 方式を
// そのまま当てて枠ごと44ptにする(枠より広い透明領域を作ると隣の欄と食い合うため)。
const REED_FORM_CONTROL_STYLE = {
  width: "100%",
  minHeight: "var(--tap-min)",
  borderRadius: "var(--r-xs)",
  padding: "0 8px",
  boxSizing: "border-box",
};

// 削除選択のチェックボックス。18/20pxの箱のままだと当たり判定が44ptに届かないため、
// appearance:none にして「44×44の透明な当たり判定 + 中央に18pxの箱を描いた背景画像」にする。
// 見た目の大きさは変えず当たり判定だけ広げる(DESIGN-SYSTEM §5)。
// 色は data URI 内に直書きするしかないので、パレットの値をそのまま埋めている
// (枠=--c-line-strong #C3CAD3 / 面=--c-surface #FFFFFF / 選択=--c-accent #174585 / チェック=--c-on-accent #FFFFFF)。
const CHECKBOX_OFF_IMG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Crect x='0.75' y='0.75' width='16.5' height='16.5' rx='4' fill='%23FFFFFF' stroke='%23C3CAD3' stroke-width='1.5'/%3E%3C/svg%3E\")";
const CHECKBOX_ON_IMG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Crect width='18' height='18' rx='4' fill='%23174585'/%3E%3Cpath d='M4.4 9.3l3 3 6.2-6.6' fill='none' stroke='%23FFFFFF' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

function reedCheckboxStyle(checked, glyph = 18) {
  return {
    appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
    width: "var(--tap-min)", height: "var(--tap-min)",
    flexShrink: 0, margin: 0, padding: 0, border: "none", background: "transparent",
    backgroundImage: checked ? CHECKBOX_ON_IMG : CHECKBOX_OFF_IMG,
    backgroundRepeat: "no-repeat", backgroundPosition: "center",
    backgroundSize: `${glyph}px ${glyph}px`,
    cursor: "pointer",
  };
}

// 見た目のピルは内側の<span>が持ち、<button>自体は高さ44ptの透明な当たり判定にする。
// これで「見た目の大きさは変えず当たり判定だけ広げる」(DESIGN-SYSTEM §5)が成立する。
// fontSize を明示するのは、<button> のUA既定(13.333px)が7段スケールの外だから。
// 見えている文字は内側の<span>が持つが、素の button を放置するとスケール外の値が残る。
const TAP_BUTTON_RESET = {
  minHeight: "var(--tap-min)",
  display: "flex", alignItems: "center",
  padding: 0, background: "none", border: "none", cursor: "pointer",
  fontSize: "var(--fs-xs)",
};

function ReedRegisterView(props) {
  const { reeds, setReeds, sessions, updateSessions, setTopTab, setSelectedReedId, selectedIdeal, saxType, tuningHz, onOpenReed, expandedGroupKey, setExpandedGroupKey } = props;

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
      thickness: null, // 主観の厚さ(抵抗感/密度)。未評価はnull
      balance: null,   // 主観のバランス(低音〜高音の鳴りの揃い)。未評価はnull
      createdAt: new Date().toISOString(),
    }));
    setReeds((prev) => [...prev, ...newReeds]);
    if (newBrand === "__custom__") setCustomBrand("");
  };

  // 「まとめて追加」タップ時に枚数を尋ねる(以前は事前選択のプルダウンだったが、
  // タップ後にその場で聞く方式に変更)。前回入力した枚数を次回のデフォルト値として覚えておく。
  const promptBulkCount = () => {
    const input = window.prompt(`まとめて追加する枚数を入力してください（1〜${REED_BOX_SIZE}）`, String(bulkCount));
    if (input === null) return; // キャンセル
    const n = parseInt(input, 10);
    if (!Number.isFinite(n) || n < 1) return;
    const clamped = Math.min(n, REED_BOX_SIZE);
    setBulkCount(clamped);
    registerReeds(clamped);
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

  // 個体行の「育てる」行(P1-8)。リードは消耗品なので、開封後日数と使用量が最も育つ/老いる対象。
  // 集計は既存の usageDays() と frameCountFor() だけを使う(新しい指標は作らない)。
  // 主役は張らせない: --fs-xs / --c-ink-3 の副次テキストで、数値が静かに増えるだけ(DESIGN-SYSTEM §7)。
  const today = new Date();
  const growthLine = (r) => {
    const days = usageDays(today, r.startDate);   // 使用開始日が未設定なら null
    const frames = frameCountFor(sessions, r.id); // このリードで記録した総フレーム数
    const sessionCount = sessions.filter((s) => s.reedId === r.id).length;
    // 真偽値で判定する(=== null では足りない)。usageDays() は startDate が空なら null を返すが、
    // パースできない文字列では Math.max(1, NaN) = NaN を返すため、=== null だと NaN が素通りして
    // 「開封 NaN日」と表示される。ピボット側の reedDays も同じ真偽値判定で弾いている。
    // usageDays() の下限は 1 なので、0 を誤って弾く心配はない。
    const left = !days ? "開封日 未設定" : `開封 ${days}日`;
    const right = frames > 0 ? `${sessionCount}セッション` : "未測定";
    return `${left} ・ ${right}`;
  };

  // 箱ヘッダ(2行)。1行目=銘柄+番手 / 2行目=使用開始日・枚数。
  // 以前は3要素を1行に詰めていたため、右の★+chevronを引いた残り約200pxに対し
  // 必要幅が約290pxとなり常時2〜3行に折り返していた(P0-5)。
  const boxHeading = (g) => (
    <span style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "var(--sp-1)" }}>
      {/* 親(箱)を --fs-md(15px) に上げ、子(個体番号)と同じサイズにする。
          階層はサイズではなくインデントと縦罫線が担う(DESIGN-SYSTEM §6.2)。 */}
      <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)", minWidth: 0, maxWidth: "100%" }}>
        <span title={g.brand} style={{ fontSize: 15, color: "#121F32", fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.brand}</span>
        <span style={{ fontSize: 15, color: "#174585", fontWeight: 700, flexShrink: 0 }}>{g.strength}</span>
      </span>
      {/* 生のISO文字列("2026-07-31")をやめ、読める形式にする */}
      <span className="sans" style={{ fontSize: 12, color: "#8D95A1", fontWeight: 400, whiteSpace: "nowrap" }}>
        {formatYmd(g.startDate) ? `開始 ${formatYmd(g.startDate)}` : "開始日 未設定"} ・ {g.members.length}枚
      </span>
    </span>
  );

  // 展開中の箱(expandedGroupKey)は親のReedsTabが保持する。個別リード詳細を開いている間も
  // 状態が消えず、戻ったときに同じ箱が開いたままの一覧へ復帰できるようにするため。
  // 個別リード評価詳細の開閉は親(ReedsTab)が持つ。ここでは行タップでonOpenReed(id)を呼ぶだけ。

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: "var(--r-lg)", padding: "16px 18px", marginBottom: 12 }}>
        <div className="sans" style={{ fontSize: 13, color: "#121F32", fontWeight: 700, marginBottom: 12 }}>新しいリードを登録</div>

        {/* 銘柄は1行フル幅。3カラム(1カラム97.7px)では select のネイティブ矢印を引いた
            文字表示域が約60pxしかなく、"Rico (D'Addario)" や "＋ 新しい銘柄を入力..." が
            ほぼ全て切れていた(P0-5)。番手と使用開始日だけを2カラムに割る。 */}
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="reed-brand-select" className="sans" style={{ fontSize: 12, color: "#435266", display: "block", marginBottom: 4 }}>銘柄</label>
          <select id="reed-brand-select" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} style={REED_FORM_CONTROL_STYLE}>
            {brandOptions.map((b) => (<option key={b} value={b}>{b}</option>))}
            <option value="__custom__">＋ 新しい銘柄を入力...</option>
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div>
            <label htmlFor="reed-strength-select" className="sans" style={{ fontSize: 12, color: "#435266", display: "block", marginBottom: 4 }}>番手</label>
            <select id="reed-strength-select" value={newStrength} onChange={(e) => setNewStrength(e.target.value)} style={REED_FORM_CONTROL_STYLE}>
              {REED_STRENGTHS.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </div>
          <div>
            <label htmlFor="reed-startdate-input" className="sans" style={{ fontSize: 12, color: "#435266", display: "block", marginBottom: 4 }}>使用開始日</label>
            <input
              id="reed-startdate-input"
              type="date" value={newStartDate} onChange={(e) => setNewStartDate(e.target.value)} className="sans"
              style={{ ...REED_FORM_CONTROL_STYLE, background: "#F6F7F9", border: "1px solid #E9ECF0", color: "#121F32", fontSize: 12 }}
            />
          </div>
        </div>

        {newBrand === "__custom__" && (
          <input
            type="text" placeholder="新しい銘柄名を入力" value={customBrand}
            onChange={(e) => setCustomBrand(e.target.value)}
            className="sans"
            style={{ ...REED_FORM_CONTROL_STYLE, background: "#F6F7F9", border: "1px solid #E9ECF0", color: "#121F32", fontSize: 12, marginBottom: 8 }}
          />
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={() => registerReeds(1)}
            disabled={newBrand === "__custom__" && !customBrand.trim()}
            className="sans"
            style={{ flex: 1, minHeight: "var(--tap-min)", padding: "10px 4px", borderRadius: "var(--r-pill)", border: "1px solid #C3CAD3", background: "transparent", color: "#121F32", fontSize: 12, cursor: "pointer" }}
          >
            1枚ずつ追加
          </button>
          <button
            onClick={promptBulkCount}
            disabled={newBrand === "__custom__" && !customBrand.trim()}
            className="sans"
            style={{ flex: 1, minHeight: "var(--tap-min)", padding: "10px 4px", borderRadius: "var(--r-pill)", border: "none", background: "#174585", color: "#F6F7F9", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            まとめて追加
          </button>
        </div>
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: "var(--r-lg)", padding: "16px 18px", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div className="sans" style={{ fontSize: 15, color: "#121F32", fontWeight: 700 }}>登録済みリード <span style={{ color: "#8D95A1", fontWeight: 400 }}>{reeds.length}</span></div>
          {reeds.length > 0 && (
            boxSelectionMode ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={exitBoxSelectionMode}
                  className="sans"
                  style={{ ...TAP_BUTTON_RESET }}
                >
                  <span style={{ padding: "7px 14px", borderRadius: "var(--r-pill)", border: "1px solid #C3CAD3", color: "#435266", fontSize: 12, lineHeight: 1.2 }}>キャンセル</span>
                </button>
                <button
                  onClick={confirmBoxBatchDelete}
                  disabled={selectedBoxesForDelete.size === 0}
                  className="sans"
                  style={{ ...TAP_BUTTON_RESET, cursor: selectedBoxesForDelete.size > 0 ? "pointer" : "default" }}
                >
                  <span style={{ padding: "7px 14px", borderRadius: "var(--r-pill)", background: selectedBoxesForDelete.size > 0 ? "#DC2626" : "#E9ECF0", color: "#FFFFFF", fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>
                    {selectedBoxesForDelete.size > 0 ? `${selectedBoxesForDelete.size}箱を削除` : "削除"}
                  </span>
                </button>
              </div>
            ) : (
              <button
                onClick={startBoxSelectionMode}
                className="sans"
                aria-label="箱を選んで削除"
                style={{ ...TAP_BUTTON_RESET }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 14px", borderRadius: "var(--r-pill)", border: "1px solid #C3CAD3", color: "#435266", fontSize: 12, lineHeight: 1.2 }}>
                  <Trash2 size={13} /> 削除
                </span>
              </button>
            )
          )}
        </div>
        {reeds.length === 0 ? (
          <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>まだリードが登録されていません</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reedGroups.map((g) => {
              const isExpanded = expandedGroupKey === g.key;
              const boxChecked = selectedBoxesForDelete.has(g.key);
              const isMemberSelecting = memberSelectGroupKey === g.key;
              // 箱の平均評価。個体行のメイン評価★と見た目で差をつけるため、薄い色・小さいサイズで表示する
              // (タイポグラフィ指示書5節③)。誰も評価していない箱では表示しない。
              const ratedValues = g.members.map((m) => m.rating).filter((v) => v !== null && v !== undefined);
              const avgRating = ratedValues.length ? ratedValues.reduce((a, b) => a + b, 0) / ratedValues.length : null;
              return (
                <div key={g.key} style={{ border: "1px solid #E9ECF0", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "stretch", background: isExpanded ? "#EAEFF5" : "#FFFFFF" }}>
                    {boxSelectionMode ? (
                      <button
                        onClick={() => toggleBoxSelected(g.key)}
                        className="sans"
                        style={{ flex: 1, minWidth: 0, minHeight: "var(--tap-min)", display: "flex", alignItems: "center", gap: 4, padding: "var(--sp-2) var(--sp-3)", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontSize: "var(--fs-md)" }}
                      >
                        <input
                          type="checkbox" checked={boxChecked} onChange={() => toggleBoxSelected(g.key)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`${g.brand} ${g.strength} の箱を選択`}
                          style={reedCheckboxStyle(boxChecked, 18)}
                        />
                        {boxHeading(g)}
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => setExpandedGroupKey(isExpanded ? null : g.key)}
                          className="sans"
                          aria-expanded={isExpanded}
                          style={{ flex: 1, minWidth: 0, minHeight: "var(--tap-min)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "var(--sp-2) var(--sp-3)", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontSize: "var(--fs-md)" }}
                        >
                          {boxHeading(g)}
                          <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                            {/* 箱の平均★は畳んでいる間だけ出す。開いている間は個体ごとの★が
                                すぐ下に並ぶので重複するうえ、★(64px)+削除ボタン(46px)を同時に置くと
                                銘柄の表示域が108pxまで痩せて "Rico (D'Addario)"(140px)が見切れる。 */}
                            {avgRating !== null && !isExpanded && (
                              <span style={{ opacity: 0.55 }} title={`箱の平均評価 ${avgRating.toFixed(1)}`}>
                                <StarRating value={avgRating} size={12} />
                              </span>
                            )}
                            {isExpanded ? <ChevronUp size={14} color="#435266" /> : <ChevronDown size={14} color="#435266" />}
                          </span>
                        </button>
                        {/* 一覧(個体)が見えている間だけ削除の入り口を出す。閉じている箱では隠す */}
                        {isExpanded && (
                          <button
                            onClick={() => startMemberSelect(g)}
                            title="この箱の中から選んで削除"
                            aria-label="この箱の中から選んで削除"
                            style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", padding: "0 var(--sp-4)", background: "none", border: "none", borderLeft: "1px solid #E9ECF0", color: "#8D95A1", cursor: "pointer", fontSize: "var(--fs-xs)" }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {isExpanded && !boxSelectionMode && (
                    <div style={{ borderTop: "1px solid #E9ECF0", padding: "var(--sp-1) var(--sp-3)" }}>
                      {isMemberSelecting && (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "4px 0" }}>
                          <button
                            onClick={exitMemberSelect}
                            className="sans"
                            style={{ ...TAP_BUTTON_RESET }}
                          >
                            <span style={{ padding: "6px 12px", borderRadius: "var(--r-pill)", border: "1px solid #C3CAD3", color: "#435266", fontSize: 12, lineHeight: 1.2 }}>キャンセル</span>
                          </button>
                          <button
                            onClick={confirmMemberBatchDelete}
                            disabled={selectedMembersForDelete.size === 0}
                            className="sans"
                            style={{ ...TAP_BUTTON_RESET, cursor: selectedMembersForDelete.size > 0 ? "pointer" : "default" }}
                          >
                            <span style={{ padding: "6px 12px", borderRadius: "var(--r-pill)", background: selectedMembersForDelete.size > 0 ? "#DC2626" : "#E9ECF0", color: "#FFFFFF", fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>
                              {selectedMembersForDelete.size > 0 ? `${selectedMembersForDelete.size}枚を削除` : "削除"}
                            </span>
                          </button>
                        </div>
                      )}
                      {/* 個体一覧は左に --sp-3(12px) のインデントと縦罫線1本を入れ、箱に属していることを
                          位置で示す(P1-9)。親子を同サイズ(--fs-md)にしたぶん、階層はここが担う。 */}
                      <div style={{ borderLeft: "1px solid #E9ECF0", paddingLeft: "var(--sp-3)" }}>
                      {isMemberSelecting ? (
                        /* 削除選択中: ドラッグ・評価タップは無効化し、行タップ/チェックボックスで選択する */
                        g.members.map((r, idx) => (
                            <div
                              key={r.id}
                              onClick={() => toggleMemberSelected(r.id)}
                              style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0", borderBottom: idx < g.members.length - 1 ? "1px solid #E9ECF0" : "none", cursor: "pointer" }}
                            >
                              <input
                                type="checkbox" checked={selectedMembersForDelete.has(r.id)}
                                onChange={() => toggleMemberSelected(r.id)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`${idx + 1}枚目を選択`}
                                style={reedCheckboxStyle(selectedMembersForDelete.has(r.id), 20)}
                              />
                              <span style={{ fontFamily: "var(--font-serif)", fontSize: 15, color: "#121F32", width: 24, flexShrink: 0 }}>{reedPosition(r, reeds) ?? idx + 1}</span>
                              <StarRating value={r.rating} size={12} />
                            </div>
                        ))
                      ) : (
                        <ReorderableReedRows
                          members={g.members}
                          onReorder={reorderGroupMembers}
                          onRowClick={(id) => onOpenReed?.(id)}
                          renderRow={(r, idx) => (
                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0", borderBottom: idx < g.members.length - 1 ? "1px solid #E9ECF0" : "none" }}>
                              {/* 子(個体番号)は --fs-md(15px)。親と同サイズにして、子だけが5px大きい反転を解消する */}
                              <span style={{ fontFamily: "var(--font-serif)", fontSize: 15, color: "#121F32", width: 24, flexShrink: 0 }}>{reedPosition(r, reeds) ?? idx + 1}</span>
                              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)", flex: 1, minWidth: 0 }}>
                                <StarRating value={r.rating} size={18} />
                                <span className="sans" style={{ fontSize: 12, color: "#8D95A1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{growthLine(r)}</span>
                              </div>
                              <button
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); goToMeasure(r.id); }}
                                className="sans"
                                style={{ ...TAP_BUTTON_RESET, flexShrink: 0 }}
                              >
                                <span style={{ fontSize: 12, padding: "8px 16px", borderRadius: "var(--r-pill)", border: "1px solid #174585", color: "#174585", fontWeight: 600, lineHeight: 1.2 }}>測定</span>
                              </button>
                            </div>
                          )}
                        />
                      )}
                      </div>
                      {g.members.length > 1 && !isMemberSelecting && (
                        <div className="sans" style={{ fontSize: 12, color: "#8D95A1", padding: "8px 0 4px" }}>
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
  // 平均はすべてclarity重み付き(weightedMean)。音色系(HNR・重心)はさらに
  // アタック過渡フレームを除外(timbreSustained)して定常状態だけを平均する。
  const sustained = frames.filter(timbreSustained);
  // ピッチのブレ(安定度): 符号つきpitchCentsの標準偏差。平均絶対誤差(pitchCents)が
  // 「中心からどれだけズレているか」を表すのに対し、こちらは「値がどれだけ揺れ動くか」を表す
  // 別の指標(My Dataのヒーローと同じ数字の重複表示を避けるために使う)。
  const pitchVals = frames.map((f) => f.pitchCents).filter((v) => v !== null && v !== undefined && !isNaN(v));
  return {
    hnrDb: weightedMean(sustained, (f) => f.hnrDb),
    spectralCentroidHz: weightedMean(sustained, (f) => f.spectralCentroidHz),
    volumeDb: weightedMean(frames, (f) => f.volumeDb),
    pitchCents: weightedMean(frames, (f) => (f.pitchCents === null || f.pitchCents === undefined ? null : Math.abs(f.pitchCents))),
    pitchStabilityCents: stddev(pitchVals),
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
      // 倍音構成もアタック過渡を除外し、clarity重み付きで平均する(音色系の共通方針)
      const sustained = groupFrames.filter(timbreSustained);
      const harmonicsProfile = Array.from({ length: NUM_HARMONICS }, (_, i) => {
        const n = i + 1;
        const wm = weightedMean(sustained, (f) => f.harmonics?.find((h) => h.n === n)?.levelNorm ?? null);
        return { n, norm: wm ?? 0 };
      });
      return {
        semitoneIndex,
        writtenLabel: groupFrames.find((f) => f.matchedWrittenNote)?.matchedWrittenNote ?? null,
        frameCount: groupFrames.length,
        pitchHz: weightedMean(groupFrames, (f) => f.pitchHz),
        volumeDb: m.volumeDb,
        centroidHz: m.spectralCentroidHz,
        hnrDb: m.hnrDb,
        pitchCents: m.pitchCents,                     // 平均ピッチ誤差(絶対値)。音名軸グラフ用
        pitchStabilityCents: m.pitchStabilityCents,   // ピッチの安定度(±stddev)。音名軸グラフ用
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

// ============================================================================
// グラフ共通の仕組み。リード比較(NoteAxisLineChart)とピボット(PivotLineChart)の
// 両方がここから引く。同じ規則を2箇所に書かないためにこの位置に置いている。
// ============================================================================

// グラフSVG内の文字サイズ。SVGの fontSize 属性には var() が書けないため、
// --fs-xs(12px) の値をここで一度だけ数値にする(マジックナンバーを散らさない)。
// DESIGN-SYSTEM §4.1: グラフSVG内の 9/9.5/10/11px は --fs-xs まで引き上げる。
const SVG_FS_XS = 12;

// SVG内の余白。DESIGN-SYSTEM §1.9「目盛ラベルの左右余白は --sp-2(8px) 以上」。
// --sp-1(4px) では足りない: getComputedTextLength() は送り幅で、和文グリフのインクは
// それを最大1.6px程度超えるため、4pxだと「たまたま足りていた」にしかならない。
const SVG_SP1 = 4;
const SVG_SP2 = 8;

// 折れ線グラフの系列スタイル(DESIGN-SYSTEM §1.7 系列色 / §1.8 線の太さ)。
// 機能色(緑/橙/赤)は音程の正誤という意味を持つので系列識別に流用しない。
// グレー(--c-ink-3)は理想値の破線用に予約されているので系列が取らない。
// 紺の明度段階3段 × 線種(実線/破線)の6系列。7系列以上は色を足さず表示を絞る。
// 薄い色ほど太くしないと同じ強さに見えないため、--c-accent-line だけ 3px(§1.8)。
// 色は CSS 変数で持つ(presentation属性では var() が解決されないため style で当てる)。
const SERIES_STYLES = [
  { color: "var(--c-accent)",      width: 2, dash: null },
  { color: "var(--c-accent-mid)",  width: 2, dash: null },
  { color: "var(--c-accent-line)", width: 3, dash: null },
  { color: "var(--c-accent)",      width: 2, dash: "4 3" },
  { color: "var(--c-accent-mid)",  width: 2, dash: "4 3" },
  { color: "var(--c-accent-line)", width: 3, dash: "4 3" },
];

// 理想値(目安)の線。DESIGN-SYSTEM §1.7 が --c-ink-3 を理想値の破線に予約しているので、
// 系列がこの色を取らないようにここで1箇所に定義しておく。破線パターンは §1.8 の "4 3"。
const IDEAL_LINE_STYLE = { color: "var(--c-ink-3)", width: 2, dash: "4 3" };

// SVG内テキストの実描画幅(px)を測る。--font-num / --font-jp は入れ子の var() を含むため
// getComputedStyle().getPropertyValue() では未解決の文字列しか得られない(resolveBottomGap と同じ罠)。
// 実際に文書へ置いた <text> の getComputedTextLength() で測ることで確定値を取る。
let _svgTextProbe = null;
function measureSvgTextPx(s, fontPx, fontFamily = "var(--font-num)") {
  const str = String(s);
  if (typeof document === "undefined") return str.length * fontPx * 0.6;
  if (!_svgTextProbe) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none";
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    svg.appendChild(t);
    document.body.appendChild(svg);
    _svgTextProbe = t;
  }
  _svgTextProbe.style.fontFamily = fontFamily;
  _svgTextProbe.style.fontSize = `${fontPx}px`;
  _svgTextProbe.textContent = str;
  return _svgTextProbe.getComputedTextLength();
}

// ラベルを与えられた幅に収める。入らないときだけ末尾を「…」に畳む。
// 文字数ではなく実描画幅で判定するので、和文/欧文が混じっても切り位置が破綻しない。
// 縦軸の項目ラベルと凡例はこの同一の規則を共有する(同じ値が両方に出たとき表記が食い違わないため)。
function fitLabel(s, maxPx, fontPx, fontFamily = "var(--font-num)") {
  const str = String(s);
  if (maxPx <= 0 || measureSvgTextPx(str, fontPx, fontFamily) <= maxPx) return str;
  let lo = 0, hi = str.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureSvgTextPx(str.slice(0, mid) + "…", fontPx, fontFamily) <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? "…" : str.slice(0, lo) + "…";
}

// 描画コンテナの実ピクセル幅を返す。グラフはこの実測値に追従させ、SVGは viewBox と実寸を
// 1:1 に保つ(preserveAspectRatio による全体縮小はしない。縮小すると 12px の文字が
// 実効 9.6px になり DESIGN-SYSTEM §4.1「グラフ内は --fs-xs 以上」が破れる)。
function useMeasuredWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  // 小数のはみ出しで横スクロールが出ないよう、実測値は必ず切り捨てて使う
  const measure = () => {
    const el = ref.current;
    if (el) setW(Math.floor(el.getBoundingClientRect().width));
  };
  useLayoutEffect(() => {
    if (!ref.current) return;
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // レンダーのたびに測り直す。グラフを描いたことでページが伸びて縦スクロールバーが出ると
  // コンテナはその幅ぶん狭まるが、そこで ResizeObserver を取りこぼすとSVGだけ古い幅のまま
  // 残ってコンテナからはみ出す(768pxで15pxはみ出す実例があった)。値が変わらなければ
  // setState は再レンダーを起こさないので、この測り直しはループしない。
  useLayoutEffect(() => { measure(); });
  return [ref, w];
}

// 系列の線サンプル。色だけでは実線/破線の別が伝わらないので、凡例も選択チップも
// 実際の線種で描く。選択中のチップは --c-accent の面なので、その上でも1本目
// (--c-accent の実線)が沈まないよう、常に --c-on-accent の小さな面の上に置く。
function SeriesSwatch({ style: st, width = 14 }) {
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, background: "var(--c-on-accent)", borderRadius: 2, padding: 2 }}>
      <svg width={width} height={st.width} style={{ display: "block", overflow: "visible" }}>
        <line x1="0" y1={st.width / 2} x2={width} y2={st.width / 2} strokeWidth={st.width} strokeDasharray={st.dash || undefined} style={{ stroke: st.color }} />
      </svg>
    </span>
  );
}

// リード別比較・リード毎比較で共通する比較項目の定義
const REED_COMPARE_METRICS = [
  { key: "hnrDb", label: "HNR", unit: "dB", fmt: (v) => v.toFixed(1) },
  { key: "spectralCentroidHz", label: "スペクトル重心", unit: "Hz", fmt: (v) => Math.round(v).toString() },
  { key: "volumeDb", label: "音量", unit: "dB", fmt: (v) => v.toFixed(1) },
  { key: "pitchCents", label: "ピッチ誤差(絶対値)", unit: "¢", fmt: (v) => v.toFixed(1) },
];

// リード比較の系列スタイルは SERIES_STYLES(DESIGN-SYSTEM §1.7)をそのまま使う。
// 以前はここに専用の hex パレットがあり、4・5番目が機能色(#D97706 注意 / #16A34A 良い)の
// 流用、6番目 #8D95A1 が理想値の破線と同色で6枚目のリードと理想線が見分けられなかった。

// --- 10.4(a): リード別比較(複数リードをグラフで視覚比較) ---
function ReedCompareTab({ reeds, sessions, compareReedIds, setCompareReedIds, saxType, tuningHz }) {
  const toggleReed = (id) => {
    setCompareReedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // 他の画面(計測タブのリード選択・リード登録一覧)と同じく、箱をタップしてから個体一覧が
  // 出るようにする(登録リードが増えるとボタンが一画面に収まらなくなるため)
  const [expandedBoxKey, setExpandedBoxKey] = useState(null);

  const frameCountFor = (reedId) => sessions.filter((s) => s.reedId === reedId).reduce((n, s) => n + (s.frames?.length ?? 0), 0);

  if (reeds.length === 0) {
    return <div className="sans" style={{ fontSize: 12, color: "#8D95A1", textAlign: "center", padding: 30 }}>比較するリードがありません。まず「登録」タブでリードを登録してください</div>;
  }

  const selectedItems = compareReedIds
    .map((id) => reeds.find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => ({ reed: r, label: reedLabel(r, reeds), frameCount: frameCountFor(r.id) }));

  // 見分けのつく系列は6本まで。7本目以降は色を足さず表示を絞る(DESIGN-SYSTEM §1.7)。
  // 選択順に SERIES_STYLES を割り当て、チップの線サンプル・折れ線・凡例で同じ線種を使う。
  const items = selectedItems.slice(0, SERIES_STYLES.length);
  const hiddenCount = selectedItems.length - items.length;
  const styleById = new Map(items.map((it, i) => [it.reed.id, SERIES_STYLES[i]]));

  return (
    <div>
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "14px 16px", marginBottom: 12 }}>
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
                  <span style={{ fontSize: 13 }}>
                    <span style={{ color: "#121F32", fontWeight: 700 }}>{g.brand}</span>{" "}
                    <span style={{ color: "#174585", fontWeight: 700 }}>{g.strength}</span>{" "}
                    <span style={{ color: "#8D95A1", fontSize: 12 }}>（{g.startDate}）{selectedInBox > 0 ? ` ・ ${selectedInBox}枚選択中` : ""}</span>
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
                          {sel && styleById.has(r.id) && <SeriesSwatch style={styleById.get(r.id)} />}
                          {reedPosition(r, reeds) ?? idx + 1}
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
        <div className="sans" style={{ fontSize: 12, color: "#8D95A1", textAlign: "center", padding: 20 }}>リードを選択すると比較グラフが表示されます</div>
      ) : (
        <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "17px" }}>
          {hiddenCount > 0 && (
            <div className="sans" style={{ fontSize: 12, color: "#435266", marginBottom: 12 }}>
              選択中{selectedItems.length}枚のうち先頭6枚を表示しています（見分けのつく系列は6本まで）。残り{hiddenCount}枚は選択を外すと入れ替わります
            </div>
          )}
          {/* 全指標(音量・ピッチ誤差・HNR・重心)を音名ごとの折れ線で比較(横軸=音名, 縦軸=値) */}
          {["volumeDb", "pitchCents", "hnrDb", "spectralCentroidHz"].map((key) => {
            const m = REED_COMPARE_METRICS.find((x) => x.key === key);
            return (
              <NoteAxisLineChart
                key={key}
                label={m.label}
                unit={m.unit}
                metricKey={key}
                series={items.map((it) => ({
                  id: it.reed.id, label: it.label, style: styleById.get(it.reed.id),
                  frames: sessions.filter((s) => s.reedId === it.reed.id).flatMap((s) => s.frames || []),
                }))}
                saxType={saxType}
                tuningHz={tuningHz}
                fmt={m.fmt}
              />
            );
          })}
          <div style={{ marginBottom: 4 }}>
            <div className="sans" style={{ fontSize: 12, color: "#435266", marginBottom: 6 }}>主観評価</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map((it) => (
                <div key={it.reed.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="sans" style={{ fontSize: 12, color: "#121F32", width: 150, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={it.label}>{it.label}</span>
                  <StarRating value={it.reed.rating} size={12} />
                </div>
              ))}
            </div>
          </div>
          <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginTop: 10 }}>
            {items.map((it) => `${it.label}: ${it.frameCount}フレーム`).join(" ・ ")}
          </div>
        </div>
      )}
    </div>
  );
}

// 横軸=音名(選択楽器の音域)、縦軸=指標値の折れ線グラフ。
// 各系列(比較リード or 自分)のフレームを運指(semitoneIndex=音)ごとに平均し、音域の
// 低音→高音の順に線で結ぶ。データのある音だけ点を打ち、連続する音の間を線でつなぐ
// (欠けている音はギャップにする)。横軸の音名は選択中の楽器種別ごとに変わる。
// selectedIdeal+idealKeyを渡すと、音ごとの理想値も破線の折れ線で重ねる。
function NoteAxisLineChart({ label, unit, metricKey, series, saxType, tuningHz, fmt, selectedIdeal, idealKey }) {
  // 幅は固定しない。コンテナの実測幅に音域全体を収める(DESIGN-SYSTEM §1.9)。
  // 以前は COL=26 の固定列幅で W=33音×26=858px あり、375pxでは31%しか見えていなかった。
  const [boxRef, W] = useMeasuredWidth();
  const table = buildFingeringTable(saxType, tuningHz);
  const N = table.length;
  const noteLabels = table.map((e) => concertFreqLabel(e.soundingFreqHz, tuningHz) || "");

  // 系列ごとに音(semitoneIndex)別の平均値を出す(groupFramesByNoteでclarity重み・
  // アタック除外は共通ロジックに従う)。groupFramesByNoteは重心を"centroidHz"で返すため対応づける。
  const groupKey = metricKey === "spectralCentroidHz" ? "centroidHz" : metricKey;
  const seriesData = series.map((s) => {
    const byIdx = {};
    for (const g of groupFramesByNote(s.frames || [])) {
      const v = g[groupKey];
      if (v !== null && v !== undefined && !isNaN(v)) byIdx[g.semitoneIndex] = v;
    }
    return { ...s, byIdx };
  });

  // 理想値プロファイルの音ごとの値(存在する音だけ)。実測と同じ音名軸に破線で重ねる
  let idealByIdx = null;
  if (selectedIdeal && idealKey) {
    const m = {};
    for (let i = 0; i < N; i++) {
      const v = getNoteIdeal(selectedIdeal, i)?.[idealKey];
      if (v !== null && v !== undefined && !isNaN(v)) m[i] = v;
    }
    if (Object.keys(m).length) idealByIdx = m;
  }

  const allVals = [...seriesData.flatMap((s) => Object.values(s.byIdx)), ...(idealByIdx ? Object.values(idealByIdx) : [])];
  const hasData = seriesData.some((s) => Object.keys(s.byIdx).length > 0);
  const minV = allVals.length ? Math.min(...allVals) : 0;
  const maxV = allVals.length ? Math.max(...allVals) : 1;
  const pad = (maxV - minV) * 0.12 || Math.abs(maxV) * 0.1 || 1;
  const lo = minV - pad, hi = maxV + pad, rng = hi - lo || 1;

  // 音名軸の目印: 音域の中央に最も近いE♭を1つだけ強調する(今どのあたりを吹いているか掴みやすくする)
  const ebIndexes = noteLabels.map((nm, i) => (nm.startsWith("E♭") ? i : -1)).filter((i) => i >= 0);
  const axisCenter = (N - 1) / 2;
  const midEbIdx = ebIndexes.length
    ? ebIndexes.reduce((best, i) => (Math.abs(i - axisCenter) < Math.abs(best - axisCenter) ? i : best), ebIndexes[0])
    : null;

  // レイアウトは実測幅から毎回引き直す。音数(N)が増えても列幅が縮むだけで、
  // 横スクロールは出さない。SVGの実寸と viewBox は 1:1 に保つ
  // (preserveAspectRatio で全体を縮めると 12px の文字が実効 9.6px になり §4.1 が破れる)。
  const L = (() => {
    if (!hasData || W <= 0) return null;
    const FS = SVG_FS_XS;
    const plotH = 94;                 // 4指標が縦に積まれるため従来の作図高さを踏襲する
    const padTop = SVG_SP2;

    // 縦軸は上端・中間・下端の3値。中間値が無いと、横に長い折れ線のどこが基準か掴めない。
    const tickVals = [hi, (hi + lo) / 2, lo];
    const tickTexts = tickVals.map((v) => fmt(v));
    const tickW = Math.ceil(Math.max(...tickTexts.map((t) => measureSvgTextPx(t, FS))));
    // 目盛ラベルの左右に --sp-2 以上(§1.9)。measureSvgTextPx は送り幅なので、実インクは
    // 左右どちらにも送り幅を最大1px程度はみ出す(実測: 右 0.7px / 左 0.95px)。
    // --sp-1 を逃げとして足す。足さないと実測が 7.3px / 7.05px と 8px を割る。
    const TICK_GAP = SVG_SP2 + SVG_SP1;      // 目盛ラベルの左右の余白
    const AXW = TICK_GAP + tickW + TICK_GAP;

    // 音名ラベルは中央揃えなので両端で半分ぶん外へ出る。送り幅より実インクが広くなる
    // ぶん(和文で最大1.6px程度)の逃げに --sp-1 を足してからプロット域を決める。
    const maxLblW = Math.ceil(Math.max(0, ...noteLabels.map((nm) => measureSvgTextPx(nm, FS))));
    const halfLbl = Math.ceil(maxLblW / 2) + SVG_SP1;
    const x0 = AXW + halfLbl;
    const x1 = Math.max(x0 + 1, W - SVG_SP2 - halfLbl);
    const colStep = (x1 - x0) / Math.max(1, N - 1);

    // 間引くのは**ラベルだけ**(データ点は全音描く。線の形が比較の実体)。
    // 間引き幅は12の約数から選び、どの幅でもオクターブ単位で同じ音名が残るようにする。
    const need = maxLblW + SVG_SP2;   // 隣り合うラベルの中心間に要る幅(隙間は --sp-2 以上)
    const labelStep = [1, 2, 3, 4, 6, 12].find((s) => s * colStep >= need)
      ?? Math.max(12, Math.ceil(need / colStep / 12) * 12);
    const labelAnchor = midEbIdx ?? 0;
    const showLabel = (i) => (((i - labelAnchor) % labelStep) + labelStep) % labelStep === 0;

    // 点が隣とくっついて見えないよう、直径は音の間隔の6割までに抑える(上限3px)
    const dotR = Math.max(1.5, Math.min(3, colStep * 0.3));
    const labelY = padTop + plotH + SVG_SP2 + Math.round(FS * 0.8);
    return {
      FS, plotH, padTop, AXW, TICK_GAP, tickVals, tickTexts, dotR, labelY, showLabel,
      H: labelY + SVG_SP1,
      xAt: (i) => x0 + i * colStep,
      yAt: (v) => padTop + plotH - ((v - lo) / rng) * plotH,
    };
  })();

  // データのある音を連続区間(欠けで分割)ごとにpolylineにする
  const segmentsFor = (byIdx) => {
    const segs = []; let cur = [];
    for (let i = 0; i < N; i++) {
      if (byIdx[i] !== undefined) cur.push(`${L.xAt(i)},${L.yAt(byIdx[i])}`);
      else { if (cur.length) segs.push(cur); cur = []; }
    }
    if (cur.length) segs.push(cur);
    return segs;
  };

  // 凡例のリード名は縦軸ラベルと同じ規則で畳む(fitLabel を共有)。
  const legendMax = Math.round(W * 0.42);
  const legendPad = L ? L.AXW : 0;

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginBottom: 6 }}>{label}{unit ? `（${unit}）` : ""}</div>
      {!hasData ? (
        <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>この音域のデータがまだありません</div>
      ) : (
        // 実測前(W=0)は箱だけ描いて幅を測る。useLayoutEffect で測るのでちらつきは出ない
        <div ref={boxRef}>
          {L && (
            <svg width={W} height={L.H} viewBox={`0 0 ${W} ${L.H}`} style={{ display: "block" }}>
              {/* 縦軸(値)の目盛と水平グリッド: 上端・中間・下端 */}
              {L.tickVals.map((v, k) => (
                <g key={k}>
                  <line x1={L.AXW} y1={L.yAt(v)} x2={W} y2={L.yAt(v)} strokeWidth="1" style={{ stroke: "var(--c-line)" }} />
                  <text x={L.AXW - L.TICK_GAP} y={L.yAt(v) + Math.round(L.FS * 0.35)} fontSize={L.FS} textAnchor="end" fontFamily="var(--font-num)" style={{ fill: "var(--c-ink-4)" }}>{L.tickTexts[k]}</text>
                </g>
              ))}
              {/* 中央のE♭に縦のガイド線を引く(ラベルも下で色付けする) */}
              {midEbIdx !== null && (
                <line x1={L.xAt(midEbIdx)} y1={L.padTop} x2={L.xAt(midEbIdx)} y2={L.padTop + L.plotH} strokeWidth="1" strokeDasharray="4 3" style={{ stroke: "var(--c-accent-line)" }} />
              )}
              {/* 理想値(破線)は実測より先に描き、実測の線が上に乗るようにする */}
              {idealByIdx && (
                <g style={{ stroke: IDEAL_LINE_STYLE.color }}>
                  {segmentsFor(idealByIdx).map((seg, k) => (
                    <polyline key={k} fill="none" strokeWidth={IDEAL_LINE_STYLE.width} strokeDasharray={IDEAL_LINE_STYLE.dash} points={seg.join(" ")} />
                  ))}
                  {Object.entries(idealByIdx).map(([idx, v]) => (
                    <circle key={idx} cx={L.xAt(+idx)} cy={L.yAt(v)} r={L.dotR} strokeWidth="1" style={{ fill: "var(--c-surface)" }} />
                  ))}
                </g>
              )}
              {/* 系列は紺の明度段階と線種で識別する(§1.7)。機能色は使わない */}
              {seriesData.map((s, si) => {
                const st = s.style || SERIES_STYLES[0];
                return (
                  <g key={s.id ?? si} style={{ stroke: st.color, fill: st.color }}>
                    {segmentsFor(s.byIdx).map((seg, k) => (
                      <polyline key={k} fill="none" strokeWidth={st.width} strokeDasharray={st.dash || undefined} points={seg.join(" ")} />
                    ))}
                    {Object.entries(s.byIdx).map(([idx, v]) => (
                      <circle key={idx} cx={L.xAt(+idx)} cy={L.yAt(v)} r={L.dotR} stroke="none" />
                    ))}
                  </g>
                );
              })}
              {noteLabels.map((nm, i) => (L.showLabel(i) ? (
                <text key={i} x={L.xAt(i)} y={L.labelY} fontSize={L.FS} fontWeight={i === midEbIdx ? 700 : 400} textAnchor="middle" fontFamily="var(--font-num)" style={{ fill: i === midEbIdx ? "var(--c-accent)" : "var(--c-ink-3)" }}>{nm}</text>
              ) : null))}
            </svg>
          )}
        </div>
      )}
      {idealByIdx && hasData && (
        <div className="sans" style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 12, color: "#435266", paddingLeft: legendPad }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><SeriesSwatch style={seriesData[0]?.style || SERIES_STYLES[0]} />実測</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><SeriesSwatch style={IDEAL_LINE_STYLE} />理想</span>
        </div>
      )}
      {series.length > 1 && (
        <div className="sans" style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginTop: 6, fontSize: 12, color: "#435266", paddingLeft: legendPad }}>
          {series.map((s, si) => (
            <span key={s.id ?? si} style={{ display: "flex", alignItems: "center", gap: 4 }} title={s.label}>
              <SeriesSwatch style={s.style || SERIES_STYLES[si % SERIES_STYLES.length]} />
              {W > 0 ? fitLabel(s.label, legendMax, SVG_FS_XS, "var(--font-jp)") : s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// タップで「数値表示 ⇄ 音名軸の折れ線グラフ」を切り替えるメトリクスカード。
// My Data・登録済みリードの測定データ・最新セッション・セッション詳細で共通して使う。
// グラフ表示中はグリッドの全幅に広がり(gridColumn: 1/-1)、理想値があれば破線で重ねる。
function TappableMetricCard({ label, unit, fmt, metricKey, idealKey, frames, saxType, tuningHz, selectedIdeal, value, sub }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      onClick={() => setOpen((v) => !v)}
      style={{ border: "1px solid #E9ECF0", borderRadius: 14, padding: "14px", cursor: "pointer", gridColumn: open ? "1 / -1" : "auto" }}
    >
      {open ? (
        <NoteAxisLineChart
          label={label} unit={unit} metricKey={metricKey}
          series={[{ id: "self", label, style: SERIES_STYLES[0], frames }]}
          saxType={saxType} tuningHz={tuningHz} fmt={fmt}
          selectedIdeal={selectedIdeal} idealKey={idealKey}
        />
      ) : (
        <>
          <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>{label}</div>
          <div style={{ fontFamily: "var(--font-num)", fontSize: 22, fontWeight: 600, margin: "2px 0", color: "#121F32" }}>
            {value}
          </div>
          {sub && <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>{sub}</div>}
        </>
      )}
    </div>
  );
}

// 登録済みリードをタップした際の評価詳細(経時変化グラフ)。旧「リード毎比較」タブの内容を、
// リード登録一覧からのタップ遷移として統合したもの。
function ReedEvaluationDetail({ reed, reeds, sessions, setReeds, selectedIdeal, saxType, tuningHz, onBack }) {
  const reedSessions = sessions
    .filter((s) => s.reedId === reed.id)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  const allFrames = reedSessions.flatMap((s) => s.frames || []);
  const overall = computeFrameMetrics(allFrames);

  // #番号・名前(個体を識別するための自由記述のニックネーム)・メモは打鍵毎の書き込みを避けるため
  // ローカルstateで編集し、フォーカスが外れた時にまとめてリードへ反映する(セッション詳細と同じパターン)。
  // #番号は数字管理の人もいればアルファベットや記号で管理する人もいるため自由記述にする
  // (デフォルトは登録順の連番のまま。空にすればまた自動採番に戻る)。
  const [positionDraft, setPositionDraft] = useState(String(reedPosition(reed, reeds) ?? ""));
  const [memoDraft, setMemoDraft] = useState(reed.memo || "");
  const [ratingDraft, setRatingDraft] = useState(reed.rating ?? 0);
  // 総評とは別軸の主観評価。厚さ=抵抗感/密度、バランス=低音〜高音の鳴りの揃い方。
  const [thicknessDraft, setThicknessDraft] = useState(reed.thickness ?? 0);
  const [balanceDraft, setBalanceDraft] = useState(reed.balance ?? 0);
  useEffect(() => {
    setPositionDraft(String(reedPosition(reed, reeds) ?? ""));
    setMemoDraft(reed.memo || "");
    setRatingDraft(reed.rating ?? 0);
    setThicknessDraft(reed.thickness ?? 0);
    setBalanceDraft(reed.balance ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reed.id]);

  const patchReed = (patch) => setReeds((prev) => prev.map((r) => (r.id === reed.id ? { ...r, ...patch } : r)));
  const commitPosition = () => {
    const trimmed = positionDraft.trim();
    if (trimmed === String(reed.boxNumber ?? "")) return;
    patchReed({ boxNumber: trimmed || null });
  };
  const commitMemo = () => {
    const trimmed = memoDraft.trim();
    if (trimmed === (reed.memo || "")) return;
    patchReed({ memo: trimmed || null });
  };
  // 評価は確定時(スライダーを離した時)に現在値を反映しつつ、過去の評価も履歴として残す。
  // ダイヤルは確定値を引数で渡してくる(遅延確定でstateが1段古くなるのを避けるため)。
  // スライダー等、引数なしで呼ばれた場合は現在のドラフト値を使う。
  const commitRating = (v) => {
    const value = typeof v === "number" ? v : ratingDraft;
    patchReed({
      rating: value,
      ratings: [...(reed.ratings || []), { value, at: new Date().toISOString() }],
    });
  };
  const ratingHistory = [...(reed.ratings || [])].reverse();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <button
        onClick={onBack}
        className="sans"
        style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#174585", fontSize: 12, marginBottom: 10, cursor: "pointer", padding: 0 }}
      >
        <ChevronDown size={13} style={{ transform: "rotate(90deg)" }} /> 一覧に戻る
      </button>

      {/* 個体の識別情報・主観評価・メモ。名前とメモはここでのみ編集する(一覧側の鉛筆編集は廃止) */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "14px 16px", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 13, color: "#121F32", fontWeight: 700, marginBottom: 10 }}>{reedLabel(reed, reeds)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="sans" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#435266", flexShrink: 0, width: 58 }}>#番号:</span>
            <input
              type="text" placeholder="数字・アルファベット・記号など自由に(空欄で自動採番に戻る)"
              value={positionDraft} onChange={(e) => setPositionDraft(e.target.value)} onBlur={commitPosition}
              className="sans"
              style={{ width: 80, flexShrink: 0, background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "6px 10px", color: "#121F32", fontSize: 12 }}
            />
          </div>
          <div className="sans" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#435266", flexShrink: 0, width: 58 }}>総評:</span>
            <RatingDial value={ratingDraft} onChange={setRatingDraft} onCommit={commitRating} />
          </div>
          {/* 総評とは別軸の主観評価。履歴は残さず現在値のみ持つ。 */}
          <div className="sans" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#435266", flexShrink: 0, width: 58 }}>厚さ:</span>
            <RatingSlider value={thicknessDraft} onChange={setThicknessDraft} onCommit={() => patchReed({ thickness: thicknessDraft })} />
            <StarRating value={thicknessDraft} size={16} />
          </div>
          <div className="sans" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#435266", flexShrink: 0, width: 58 }}>バランス:</span>
            <RatingSlider value={balanceDraft} onChange={setBalanceDraft} onCommit={() => patchReed({ balance: balanceDraft })} />
            <StarRating value={balanceDraft} size={16} />
          </div>
          {ratingHistory.length > 0 && (
            <div className="sans" style={{ fontSize: 12, color: "#8D95A1", display: "flex", flexWrap: "wrap", gap: "4px 10px", paddingLeft: 66 }}>
              <span style={{ color: "#435266" }}>履歴:</span>
              {ratingHistory.slice(0, 8).map((h, i) => (
                <span key={i}>{(h.value ?? 0).toFixed(1)} <span style={{ color: "#C3CAD3" }}>({new Date(h.at).toLocaleDateString("ja-JP")})</span></span>
              ))}
            </div>
          )}
          <div className="sans" style={{ fontSize: 12, display: "flex", alignItems: "flex-start", gap: 8 }}>
            <span style={{ color: "#435266", flexShrink: 0, width: 58, marginTop: 6 }}>メモ:</span>
            <textarea
              placeholder="このリードの印象・特徴など(任意)"
              value={memoDraft} onChange={(e) => setMemoDraft(e.target.value)} onBlur={commitMemo}
              rows={2}
              className="sans"
              style={{ flex: 1, background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "6px 10px", color: "#121F32", fontSize: 12, resize: "vertical", fontFamily: "inherit" }}
            />
          </div>
        </div>
      </div>

      {/* 測定データ: 各カードをタップすると横軸=音名の折れ線グラフに切り替わる(再タップで数値に戻る) */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "16px 18px" }}>
        <div className="sans" style={{ fontSize: 13, color: "#121F32", fontWeight: 700, marginBottom: 4 }}>測定データ</div>
        <div className="sans" style={{ fontSize: 12, color: "#435266", marginBottom: 12 }}>{reedSessions.length}セッション</div>
        {reedSessions.length === 0 ? (
          <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>このリードに紐づく測定データがまだありません</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {REED_COMPARE_METRICS.map((m) => {
              const v = overall[m.key];
              return (
                <TappableMetricCard
                  key={m.key}
                  label={m.label} unit={m.unit} fmt={m.fmt}
                  metricKey={m.key} idealKey={METRIC_IDEAL_KEYS[m.key]}
                  frames={allFrames} saxType={saxType} tuningHz={tuningHz} selectedIdeal={selectedIdeal}
                  value={v !== null && v !== undefined ? `${m.fmt(v)}${m.unit ? ` ${m.unit}` : ""}` : "—"}
                />
              );
            })}
          </div>
        )}
      </div>
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

// 音色系(倍音・HNR・重心)はアタック過渡フレームを集計から除外する(timbreSustained。
// セッション詳細・My Dataの平均と同じ方針で、ビューによって値が食い違わないようにする)
const PIVOT_MEASURES = [
  { key: "pitchCents", label: "平均ピッチ偏差(¢)", getValue: (f) => f.pitchCents, fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(1), color: pitchCellColor },
  { key: "pitchHz", label: "ピッチ(Hz)", getValue: (f) => f.pitchHz, fmt: (v) => v.toFixed(1) },
  { key: "volume", label: "音量(dB)", getValue: (f) => f.volumeDb, fmt: (v) => v.toFixed(1) },
  { key: "lowHarm", label: "倍音強度(低次1-4)", getValue: (f) => (timbreSustained(f) ? harmonicSliceMean(f, 0, 4) : null), fmt: (v) => (v * 100).toFixed(0) },
  { key: "highHarm", label: "倍音強度(高次5-8)", getValue: (f) => (timbreSustained(f) ? harmonicSliceMean(f, 4, 8) : null), fmt: (v) => (v * 100).toFixed(0) },
  { key: "hnr", label: "HNR(dB)", getValue: (f) => (timbreSustained(f) ? f.hnrDb : null), fmt: (v) => v.toFixed(1) },
  { key: "centroid", label: "重心(Hz)", getValue: (f) => (timbreSustained(f) ? f.spectralCentroidHz : null), fmt: (v) => Math.round(v).toString() },
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
    if (!cells[rk][ck]) cells[rk][ck] = { sum: 0, count: 0, wsum: 0, wtotal: 0 };
    const w = frameWeight(f); // 平均はclarity重み付き(他ビューの平均と同じ方針)
    cells[rk][ck].sum += v;
    cells[rk][ck].count += 1;
    cells[rk][ck].wsum += w * v;
    cells[rk][ck].wtotal += w;
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

// ピボット集計を縦向きの折れ線グラフで表示する。
//   縦軸 = 縦軸で選んだ項目の値(rowKeys。音名なら上から高い音の順)
//   横軸 = 指標の値(metricDef。平均ピッチ偏差など)
//   系列 = 「指標」セレクタで選んだ次元の値ごと(colKeys)に色分けした折れ線を同じ場所に重ねる
// 値の無いセルは線を途切れさせる。ピッチ偏差では0(ジャスト)の縦基準線を破線で示す。
function PivotLineChart({ rowKeys, colKeys, cells, metricDef }) {
  // グラフ幅は固定値ではなくコンテナの実測幅。375pxでも横に溢れない条件がここで決まる。
  const [boxRef, W] = useMeasuredWidth();

  const cellValue = (rk, ck) => {
    const c = cells[rk]?.[ck];
    if (!c) return null;
    const v = metricDef.agg === "sum" ? c.sum : c.wsum / c.wtotal;
    return v === null || v === undefined || isNaN(v) ? null : v;
  };

  // 7系列以上は色を足さず表示を絞る(DESIGN-SYSTEM §1.7)。絞ったことは凡例の下に明記する。
  const shownKeys = colKeys.slice(0, SERIES_STYLES.length);
  const hiddenCount = colKeys.length - shownKeys.length;
  const styleAt = (i) => SERIES_STYLES[i];

  const allVals = [];
  rowKeys.forEach((rk) => shownKeys.forEach((ck) => { const v = cellValue(rk, ck); if (v !== null) allVals.push(v); }));

  // 項目ラベル(縦軸)と凡例に共通の文字幅の上限。固定文字数では切らず、この幅で畳む。
  // 幅の4割強までをラベルに割き、残りをプロットに回す(375pxで両方が成立する配分)。
  const LABEL_MAX = Math.round(W * 0.42);

  // 実測前(W=0)は箱だけ描いて幅を測る。useLayoutEffect で測るので描画のちらつきは出ない。
  const body = (() => {
    if (allVals.length === 0 || W <= 0) return null;

    let minV = Math.min(...allVals), maxV = Math.max(...allVals);
    // ピッチ偏差は0(ジャスト)を基準線として必ず範囲に含める
    if (metricDef.key === "pitchCents") { minV = Math.min(minV, 0); maxV = Math.max(maxV, 0); }
    const pad = (maxV - minV) * 0.12 || Math.abs(maxV) * 0.1 || 1;
    const lo = minV - pad, hi = maxV + pad, rng = hi - lo || 1;

    const FS = SVG_FS_XS;           // --fs-xs (12px)
    const SP1 = 4, SP2 = 8;         // --sp-1 / --sp-2
    const ROW = 26;                 // 1項目(行)あたりの高さ
    const GAPL = SP2;               // 項目ラベルとプロット領域の間隔
    const RPAD = SP1;               // 右端の内側寄せ。最大値の目盛と点(r=3)が枠外に出ないため
    const BASE = Math.round(FS * 0.8);  // 文字の上端からベースラインまで(組版上の目安。トークンではない)
    const padTop = 6;
    const padBottom = SP1 * 3 + FS * 2; // 目盛(--fs-xs)と指標名(--fs-xs)を --sp-1 の余白で挟む
    const H = padTop + rowKeys.length * ROW + padBottom;

    // 左端も RPAD と同じだけ内側に寄せる。getComputedTextLength() は送り幅で、和文グリフの
    // 実インクは 1px 前後それを超えることがあるため、この余白が無いと左端で欠ける。
    const longest = rowKeys.reduce((m, rk) => Math.max(m, measureSvgTextPx(rk, FS)), 0);
    const LABELW = RPAD + Math.min(Math.ceil(longest), LABEL_MAX) + GAPL;
    const PLOTW = Math.max(1, W - LABELW - RPAD);

    const xAt = (v) => LABELW + ((v - lo) / rng) * PLOTW;
    const yAt = (ri) => padTop + ri * ROW + ROW / 2;

    // 系列(指標の値)ごとに、縦(行)方向へ連続する行をつないだ折れ線を作る(欠けはギャップ)
    const segmentsFor = (ck) => {
      const segs = []; let cur = [];
      rowKeys.forEach((rk, ri) => {
        const v = cellValue(rk, ck);
        if (v !== null) cur.push(`${xAt(v)},${yAt(ri)}`);
        else { if (cur.length) segs.push(cur); cur = []; }
      });
      if (cur.length) segs.push(cur);
      return segs;
    };
    const zeroX = metricDef.key === "pitchCents" && lo < 0 && hi > 0 ? xAt(0) : null;

    // 横軸の目盛はプロット領域の内側に置く。最小=左寄せ、最大=右寄せ、0=中央合わせ。
    // 右端を PLOTW で止めているので、最大値のラベルが枠外に出ることがない。
    const tickY = H - padBottom + SP1 + BASE;
    const titleY = H - SP1 - FS + BASE;
    const loText = metricDef.fmt(lo), hiText = metricDef.fmt(hi);
    const loW = measureSvgTextPx(loText, FS), hiW = measureSvgTextPx(hiText, FS);
    const zeroW = measureSvgTextPx("0", FS);
    // 0の目盛は最小・最大と重なるときだけ省く(基準線そのものは常に引く)
    const showZeroText = zeroX !== null &&
      zeroX - zeroW / 2 > LABELW + loW + SP1 &&
      zeroX + zeroW / 2 < LABELW + PLOTW - hiW - SP1;

    // 指標名は幅に入らなければ同じ規則で畳み、左右どちらにもはみ出さない位置に置く
    const titleText = fitLabel(metricDef.label, W - SP1, FS, "var(--font-jp)");
    const titleW = measureSvgTextPx(titleText, FS, "var(--font-jp)");
    const titleX = Math.min(Math.max(LABELW + PLOTW / 2, titleW / 2 + SP1 / 2), W - titleW / 2 - SP1 / 2);

    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        {/* 行ごとの薄いガイド線と項目ラベル(縦軸) */}
        {rowKeys.map((rk, ri) => (
          <g key={rk}>
            <line x1={LABELW} y1={yAt(ri)} x2={LABELW + PLOTW} y2={yAt(ri)} stroke="#F3F5F7" strokeWidth="1" />
            <text x={LABELW - GAPL} y={yAt(ri) + Math.round(FS * 0.35)} fontSize={FS} fill="#435266" textAnchor="end" fontFamily="var(--font-num)">{fitLabel(rk, LABEL_MAX, FS)}</text>
          </g>
        ))}
        {/* 横軸(指標値)の枠と目盛 */}
        <line x1={LABELW} y1={padTop} x2={LABELW} y2={H - padBottom} stroke="#EEF1F4" strokeWidth="1" />
        <line x1={LABELW} y1={H - padBottom} x2={LABELW + PLOTW} y2={H - padBottom} stroke="#EEF1F4" strokeWidth="1" />
        {zeroX !== null && <line x1={zeroX} y1={padTop} x2={zeroX} y2={H - padBottom} stroke="#DDE2E8" strokeWidth="1" strokeDasharray="4 3" />}
        <text x={LABELW} y={tickY} fontSize={FS} fill="#A6AEBA" textAnchor="start" fontFamily="var(--font-num)">{loText}</text>
        <text x={LABELW + PLOTW} y={tickY} fontSize={FS} fill="#A6AEBA" textAnchor="end" fontFamily="var(--font-num)">{hiText}</text>
        {showZeroText && <text x={zeroX} y={tickY} fontSize={FS} fill="#8D95A1" textAnchor="middle" fontFamily="var(--font-num)">0</text>}
        <text x={titleX} y={titleY} fontSize={FS} fill="#8D95A1" textAnchor="middle" className="sans">{titleText}</text>
        {/* 系列(指標の値ごと)の折れ線を同じ場所に重ねる。識別は紺の明度段階と線種で行う */}
        {shownKeys.map((ck, ci) => {
          const st = styleAt(ci);
          return (
            <g key={ck} style={{ stroke: st.color, fill: st.color }}>
              {segmentsFor(ck).map((seg, k) => (
                <polyline key={k} fill="none" strokeWidth={st.width} strokeDasharray={st.dash || undefined} points={seg.join(" ")} />
              ))}
              {rowKeys.map((rk, ri) => {
                const v = cellValue(rk, ck);
                if (v === null) return null;
                return <circle key={ri} cx={xAt(v)} cy={yAt(ri)} r={3} stroke="none" />;
              })}
            </g>
          );
        })}
      </svg>
    );
  })();

  return (
    <div>
      <div ref={boxRef}>{body}</div>
      {/* 凡例: 系列(指標の値)を色と線種で識別。省略規則は縦軸の項目ラベルと同一
          (同じ値が軸と凡例の両方に出たとき、表記が食い違わないようにするため)。
          描く線が1本も無いときは凡例も出さない(従来どおり何も表示しない) */}
      {body && (
        <div className="sans" style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8, fontSize: 12, color: "#435266", maxHeight: 96, overflowY: "auto" }}>
          {shownKeys.map((ck, ci) => {
            const st = styleAt(ci);
            return (
              <span key={ck} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <svg width="12" height="3" style={{ flexShrink: 0, overflow: "visible" }} aria-hidden="true">
                  <line x1="0" y1="1.5" x2="12" y2="1.5" strokeWidth={st.width} strokeDasharray={st.dash || undefined} style={{ stroke: st.color }} />
                </svg>
                {fitLabel(ck, LABEL_MAX, SVG_FS_XS)}
              </span>
            );
          })}
        </div>
      )}
      {body && hiddenCount > 0 && (
        <div className="sans" style={{ marginTop: 6, fontSize: 12, color: "#8D95A1" }}>
          残り{hiddenCount}件は表示していません（見分けのつく系列は6本まで）。フィルターで絞ると全部見えます
        </div>
      )}
    </div>
  );
}

// 奏者が「自分」のセッションだけを集めた経時変化グラフ。分析タブの一番上に表示し、
// 自分の演奏がどう変化しているかを他のリード・セッションのデータから独立して確認できるようにする。
// My Dataで扱う4指標。idealKeyは理想値プロファイルのnote側フィールド名(ピッチ誤差は理想=0が定義)
const MY_DATA_METRICS = [
  { key: "volumeDb", idealKey: "volumeDb", label: "音量", unit: "dB", fmt: (v) => v.toFixed(1) },
  { key: "spectralCentroidHz", idealKey: "centroidHz", label: "スペクトル重心", unit: "Hz", fmt: (v) => Math.round(v).toString() },
  { key: "hnrDb", idealKey: "hnrDb", label: "HNR", unit: "dB", fmt: (v) => v.toFixed(1) },
  // ヒーローカードが「今日のピッチ誤差」を主役として表示するため、ここでは同じ数字を
  // 繰り返さず、ピッチの安定度(値のブレ幅=標準偏差)という別の切り口を見せる。
  { key: "pitchStabilityCents", idealKey: null, label: "ピッチの安定度", unit: "¢", fmt: (v) => `±${v.toFixed(1)}` },
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
const MY_DATA_RANGES = [
  { key: "yesterday", label: "昨日" },
  { key: "1w", label: "1週間" },
  { key: "1m", label: "1ヶ月" },
  { key: "3m", label: "3ヶ月" },
  { key: "6m", label: "6ヶ月" },
  { key: "1y", label: "1年" },
  { key: "3y", label: "3年" },
  { key: "5y", label: "5年" },
  { key: "all", label: "全期間" },
];

function getMyDataRangeBounds(rangeKey, now) {
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const back = (fn) => { const d = new Date(now); fn(d); return { start: d, end: null }; };
  if (rangeKey === "yesterday") { const s = new Date(startOfToday); s.setDate(s.getDate() - 1); return { start: s, end: startOfToday }; }
  if (rangeKey === "1w") return back((d) => d.setDate(d.getDate() - 7));
  if (rangeKey === "1m") return back((d) => d.setMonth(d.getMonth() - 1));
  if (rangeKey === "3m") return back((d) => d.setMonth(d.getMonth() - 3));
  if (rangeKey === "6m") return back((d) => d.setMonth(d.getMonth() - 6));
  if (rangeKey === "1y") return back((d) => d.setFullYear(d.getFullYear() - 1));
  if (rangeKey === "3y") return back((d) => d.setFullYear(d.getFullYear() - 3));
  if (rangeKey === "5y") return back((d) => d.setFullYear(d.getFullYear() - 5));
  return { start: null, end: null }; // all
}

// My Data: 奏者が「自分」のセッションの集計。期間セレクタで対象期間を絞り、
// 平均値(デフォルト)/推移をタブで切替。平均値は数値同士の比較が目的なので
// グラフにせずスタットカード(実測+理想+差分)で表し、推移は時間変化を見るものなので
// 折れ線(実測=青実線、理想=灰破線)で表す。
function MyDataSection({ sessions, selectedIdeal, saxType, tuningHz }) {
  const allMySessions = sessions.filter((s) => s.performer === "自分");
  // 期間はデフォルト1か月。選択後は永続化し、タブを切り替えて再マウントされても残す。
  const [range, setRange] = usePersistedState("myDataRange", "1m");

  const now = new Date();
  const rangeOptions = MY_DATA_RANGES;

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
      ideals[m.key] = idealAvgForFrames(frames, selectedIdeal, m.idealKey);
    }
    return { date: s.recordedAt, frameCount: frames.length, memo: s.memo, ideals, ...computeFrameMetrics(frames) };
  });

  // ヒーローカード: 今日のピッチ誤差を、対象期間の平均と比較して色分けする。
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const todayFrames = allMySessions
    .filter((s) => new Date(s.recordedAt) >= startOfToday)
    .flatMap((s) => s.frames || []);
  const todayVal = todayFrames.length ? computeFrameMetrics(todayFrames).pitchCents : null; // 今日の平均ピッチ偏差(符号つき)
  const periodVal = overall.pitchCents;                                                    // 対象期間の平均
  const rangeLabel = rangeOptions.find((o) => o.key === range)?.label ?? "";
  const sparkVals = points.map((p) => p.pitchCents).filter((v) => v !== null && v !== undefined && !isNaN(v));

  // 色分け: 完全一致(≒0)=ミント / 平均より大きく改善=緑 / 平均並み=オレンジ / 平均より悪化=赤。
  // 誤差は0からの距離(絶対値)で評価する。ネイビー背景で映えるよう明るめの色を使う。
  const todayErr = todayVal != null ? Math.abs(todayVal) : null;
  const periodErr = periodVal != null ? Math.abs(periodVal) : null;
  const MARGIN = 3;
  let heroColor = "#FFFFFF", heroStatus = null;
  if (todayErr != null) {
    if (todayErr < 2) { heroColor = "#6EE7B7"; heroStatus = "ほぼ完璧"; }
    else if (periodErr != null && todayErr < periodErr - MARGIN) { heroColor = "#4ADE80"; heroStatus = "平均より改善"; }
    else if (periodErr != null && todayErr > periodErr + MARGIN) { heroColor = "#F87171"; heroStatus = "平均より悪化"; }
    else { heroColor = "#FBBF24"; heroStatus = "平均並み"; }
  }
  const displayVal = todayVal != null ? todayVal : periodVal;

  return (
    <>
      {/* 今日のピッチ誤差ヒーローカード。対象期間平均と比較して色分けする */}
      <div style={{ background: "#174585", borderRadius: 20, padding: 20, marginBottom: 12, color: "#FFFFFF" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#B9C9E4" }}>{todayVal != null ? "今日のピッチ誤差" : "平均ピッチ誤差"}</div>
          <select value={range} onChange={(e) => setRange(e.target.value)} style={{ fontSize: 12 }}>
            {rangeOptions.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-num)", fontSize: 46, fontWeight: 600, lineHeight: 0.9, color: heroColor }}>
            {displayVal !== null && displayVal !== undefined ? `${displayVal > 0 ? "+" : ""}${displayVal.toFixed(1)}` : "—"}
            <span style={{ fontSize: 22, color: "#9DB3D6" }}>¢</span>
          </span>
          {heroStatus && (
            <span className="sans" style={{
              display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700, padding: "4px 10px", borderRadius: 999, marginBottom: 8,
              background: heroColor, color: "#04130D",
            }}>
              {heroStatus}
            </span>
          )}
        </div>
        {todayVal != null && periodVal != null && (
          <div style={{ fontSize: 12, color: "#9DB3D6", marginTop: 6 }}>
            対象期間平均 {periodVal > 0 ? "+" : ""}{periodVal.toFixed(1)}¢（{rangeLabel}）と比較
          </div>
        )}
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
        <div style={{ fontSize: 12, color: "#9DB3D6", marginTop: 2 }}>{rangeLabel} ・ {points.length}セッション</div>
      </div>

    <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "16px 18px", marginBottom: 12 }}>
      <div className="sans" style={{ fontSize: 15, color: "#121F32", fontWeight: 700, marginBottom: 12 }}>My Data</div>
      {!selectedIdeal && (
        <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginBottom: 12 }}>目安未設定</div>
      )}

      {points.length === 0 ? (
        <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>この期間の「自分」のセッションはありません</div>
      ) : (
        // 全セッション・全フレームの平均。各カードをタップすると横軸=音名の折れ線グラフに
        // 切り替わり、再タップで数値表示に戻る(理想値があれば破線で重ねる)。
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {MY_DATA_METRICS.map((m) => {
            const measured = overall[m.key];
            const ideal = idealAvgForFrames(allFrames, selectedIdeal, m.idealKey);
            const diff = measured !== null && ideal !== null ? measured - ideal : null;
            return (
              <TappableMetricCard
                key={m.key}
                label={m.label} unit={m.unit} fmt={m.fmt}
                metricKey={m.key} idealKey={m.idealKey}
                frames={allFrames} saxType={saxType} tuningHz={tuningHz} selectedIdeal={selectedIdeal}
                value={measured !== null ? `${m.fmt(measured)} ${m.unit}` : "—"}
                sub={ideal !== null ? (
                  <>
                    <span>理想: {m.fmt(ideal)} {m.unit}</span>
                    {diff !== null && <span style={{ color: "#174585" }}>Δ {diff > 0 ? "+" : ""}{m.fmt(diff)}</span>}
                  </>
                ) : null}
              />
            );
          })}
        </div>
      )}
    </div>
    </>
  );
}

// REED_COMPARE_METRICSの各指標に対応する理想値プロファイル側のフィールド名
// (音名軸グラフに理想の破線を重ねるための対応表。ピッチ誤差は理想=0のため対象外)
const METRIC_IDEAL_KEYS = { hnrDb: "hnrDb", spectralCentroidHz: "centroidHz", volumeDb: "volumeDb", pitchCents: null };

// 直近追加された最新セッション単体の内訳。My Dataの平均(複数セッション)とは別に、
// 「今撮ったばかりの1回分」を単独で確認できるようにする。カードはタップで音名軸グラフに切替。
function LatestSessionCard({ session, reeds, selectedIdeal, tuningHz }) {
  const reed = reeds.find((r) => r.id === session.reedId) || null;
  const m = computeFrameMetrics(session.frames || []);

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "16px 18px", marginBottom: 12 }}>
      <div className="sans" style={{ fontSize: 15, color: "#121F32", fontWeight: 700, marginBottom: 4 }}>最新セッション</div>
      <div className="sans" style={{ fontSize: 12, color: "#435266", marginBottom: 12 }}>
        {new Date(session.recordedAt).toLocaleString("ja-JP")} ・ {session.performer || "—"} ・ {reed ? reedLabel(reed, reeds) : "未紐付け"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {REED_COMPARE_METRICS.map((mt) => {
          const v = m[mt.key];
          return (
            <TappableMetricCard
              key={mt.key}
              label={mt.label} unit={mt.unit} fmt={mt.fmt}
              metricKey={mt.key} idealKey={METRIC_IDEAL_KEYS[mt.key]}
              frames={session.frames || []}
              saxType={session.saxType} tuningHz={tuningHz} selectedIdeal={selectedIdeal}
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
    saxType, tuningHz,
  } = props;

  // データタブ内の子タブ: My Data(推移・平均・セッション一覧) / 分析(クロス集計)
  const [dataSubTab, setDataSubTab] = useState("mydata");
  const [pivotRow, setPivotRow] = useState("note");
  const [pivotCol, setPivotCol] = useState("brand");
  const [pivotMetric, setPivotMetric] = useState("pitchCents");
  // 集計対象抽出: [{dimKey, values: string[]}]。他機種のデータが混ざると平均が意味を失うため、
  // 初期状態で「サックス種別=今の楽器」を入れておく(不要なら×で消せる)。
  const [pivotFilters, setPivotFilters] = useState(() => {
    const label = SAX_PRESETS[saxType]?.label;
    return label ? [{ dimKey: "saxType", values: [label], rangeMin: null, rangeMax: null }] : [];
  });
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  // セッション一覧の絞り込み(並び替えではなく絞り込み)。期間・奏者・リードで絞る。
  const [sessionFilterPerformer, setSessionFilterPerformer] = useState(""); // "" = すべて
  const [sessionFilterReed, setSessionFilterReed] = useState(""); // "" = すべて / "__none__" = 未紐付け
  const [sessionFilterDateFrom, setSessionFilterDateFrom] = useState(""); // "YYYY-MM-DD" or ""
  const [sessionFilterDateTo, setSessionFilterDateTo] = useState("");
  // 削除はリードタブと同様、行ごとのボタンではなくチェックボックスによる複数選択削除にする。
  // (selectedSessionがある時の早期returnより前で呼ぶ必要があるため、ここでまとめて宣言する)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState(() => new Set());
  const [bulkReedId, setBulkReedId] = useState(""); // 選択セッションにまとめて紐付けるリード

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
      <SwipeBackArea onBack={() => setSelectedSessionId(null)}>
        <SessionDetailView
          session={selectedSession} reeds={reeds} sessions={sessions} selectedIdeal={selectedIdeal}
          NUM_HARMONICS={NUM_HARMONICS} promoteSessionToIdeal={promoteSessionToIdeal}
          updateSessions={updateSessions} performers={performers} setPerformers={setPerformers}
          tuningHz={tuningHz}
          onBack={() => setSelectedSessionId(null)}
        />
      </SwipeBackArea>
    );
  }

  const latestSession = [...sessions].sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))[0] || null;
  // 一覧は常に新しい順。期間(録音日)・奏者・リードで絞り込む(並び替えではなく絞り込み)。
  const sessionPerformerOptions = [...new Set(sessions.map((s) => s.performer).filter(Boolean))];
  const fromMs = sessionFilterDateFrom ? new Date(sessionFilterDateFrom).setHours(0, 0, 0, 0) : null;
  const toMs = sessionFilterDateTo ? new Date(sessionFilterDateTo).setHours(23, 59, 59, 999) : null;
  const sessionFilterActive = !!(sessionFilterPerformer || sessionFilterReed || sessionFilterDateFrom || sessionFilterDateTo);
  const filteredSessions = [...sessions]
    .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
    .filter((s) => {
      if (sessionFilterPerformer && (s.performer || "") !== sessionFilterPerformer) return false;
      if (sessionFilterReed === "__none__" && s.reedId) return false;      // 未紐付けのみ
      if (sessionFilterReed && sessionFilterReed !== "__none__" && s.reedId !== sessionFilterReed) return false; // 特定リードのみ
      const t = new Date(s.recordedAt).getTime();
      if (fromMs !== null && t < fromMs) return false;
      if (toMs !== null && t > toMs) return false;
      return true;
    });
  const clearSessionFilters = () => {
    setSessionFilterPerformer(""); setSessionFilterReed(""); setSessionFilterDateFrom(""); setSessionFilterDateTo("");
  };

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
    setBulkReedId("");
  };

  const confirmBatchDeleteSessions = () => {
    if (selectedForDelete.size === 0) return;
    if (!window.confirm(`選択した${selectedForDelete.size}件のセッションを削除しますか？(元に戻せません)`)) return;
    deleteSessions([...selectedForDelete]);
    exitSelectionMode();
  };

  // 選択したセッションのリードをまとめて変更する。
  const applyBulkReed = () => {
    if (selectedForDelete.size === 0 || !bulkReedId) return;
    const ids = new Set(selectedForDelete);
    const reedId = bulkReedId === "__none__" ? null : bulkReedId;
    updateSessions((prev) => prev.map((s) => (ids.has(s.id) ? { ...s, reedId, linkedAt: reedId ? "eager" : null } : s)));
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

      <SwipePager index={dataSubTab === "analysis" ? 1 : 0} onIndexChange={(i) => setDataSubTab(i === 1 ? "analysis" : "mydata")}>
      <>
      {/* --- My Data: 「自分」のセッションの推移 --- */}
      <MyDataSection sessions={sessions} selectedIdeal={selectedIdeal} saxType={saxType} tuningHz={tuningHz} />

      {/* --- 最新セッション: 直近1回分の内訳を単独表示 --- */}
      {latestSession && <LatestSessionCard session={latestSession} reeds={reeds} selectedIdeal={selectedIdeal} tuningHz={tuningHz} />}

      {/* --- セッション一覧(録音+アップロード。アップロードは計測タブに統合済み) --- */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "16px 18px", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="sans" style={{ fontSize: 15, color: "#121F32", fontWeight: 700 }}>
            セッション一覧 <span style={{ color: "#8D95A1", fontWeight: 400 }}>{sessionFilterActive ? `${filteredSessions.length}/${sessions.length}` : sessions.length}</span>
          </div>
          {sessions.length > 0 && (
            selectionMode ? (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={exitSelectionMode}
                  className="sans"
                  style={{ padding: "7px 12px", borderRadius: 999, border: "1px solid #C3CAD3", background: "transparent", color: "#435266", fontSize: 12, cursor: "pointer" }}
                >
                  キャンセル
                </button>
                <button
                  onClick={confirmBatchDeleteSessions}
                  disabled={selectedForDelete.size === 0}
                  className="sans"
                  style={{ padding: "7px 12px", borderRadius: 999, border: "none", background: selectedForDelete.size > 0 ? "#DC2626" : "#E9ECF0", color: "#FFFFFF", fontSize: 12, fontWeight: 600, cursor: selectedForDelete.size > 0 ? "pointer" : "default" }}
                >
                  {selectedForDelete.size > 0 ? `${selectedForDelete.size}件を削除` : "削除"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSelectionMode(true)}
                className="sans"
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 12px", borderRadius: 999, border: "1px solid #C3CAD3", background: "transparent", color: "#435266", fontSize: 12, cursor: "pointer" }}
              >
                選択
              </button>
            )
          )}
        </div>

        {/* 絞り込み: 奏者・リード・期間(いつからいつまで)。すべて空=絞り込みなし。新しい順で表示。 */}
        {sessions.length > 0 && !selectionMode && (
          <div className="sans" style={{ marginBottom: 10, padding: "10px 12px", background: "#F6F7F9", borderRadius: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "#8D95A1", flexShrink: 0 }}>絞り込み</span>
              <select value={sessionFilterPerformer} onChange={(e) => setSessionFilterPerformer(e.target.value)} style={{ fontSize: 12 }}>
                <option value="">奏者: すべて</option>
                {sessionPerformerOptions.map((p) => (<option key={p} value={p}>{p}</option>))}
              </select>
              <select value={sessionFilterReed} onChange={(e) => setSessionFilterReed(e.target.value)} style={{ fontSize: 12 }}>
                <option value="">リード: すべて</option>
                <option value="__none__">未紐付け</option>
                {reeds.map((r) => (<option key={r.id} value={r.id}>{reedLabel(r, reeds)}</option>))}
              </select>
              {sessionFilterActive && (
                <button onClick={clearSessionFilters} className="sans" style={{ padding: "5px 10px", borderRadius: 999, border: "1px solid #C3CAD3", background: "#FFFFFF", color: "#435266", fontSize: 12, cursor: "pointer" }}>クリア</button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "#8D95A1", flexShrink: 0 }}>期間</span>
              <input type="date" value={sessionFilterDateFrom} onChange={(e) => setSessionFilterDateFrom(e.target.value)} style={{ fontSize: 12 }} />
              <span style={{ fontSize: 12, color: "#8D95A1" }}>〜</span>
              <input type="date" value={sessionFilterDateTo} onChange={(e) => setSessionFilterDateTo(e.target.value)} style={{ fontSize: 12 }} />
            </div>
          </div>
        )}

        {/* 選択中: 選んだセッションのリードをまとめて変更 */}
        {selectionMode && (
          <div className="sans" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap", padding: "10px 12px", background: "#F6F7F9", borderRadius: 12 }}>
            <span style={{ fontSize: 12, color: "#435266" }}>選択した{selectedForDelete.size}件のリードを</span>
            <select value={bulkReedId} onChange={(e) => setBulkReedId(e.target.value)} style={{ fontSize: 12 }}>
              <option value="">選択…</option>
              <option value="__none__">未紐付けにする</option>
              {reeds.map((r) => (<option key={r.id} value={r.id}>{reedLabel(r, reeds)}</option>))}
            </select>
            <button
              onClick={applyBulkReed}
              disabled={selectedForDelete.size === 0 || !bulkReedId}
              className="sans"
              style={{ padding: "6px 14px", borderRadius: 999, border: "none", background: selectedForDelete.size > 0 && bulkReedId ? "#174585" : "#E9ECF0", color: "#FFFFFF", fontSize: 12, fontWeight: 600, cursor: selectedForDelete.size > 0 && bulkReedId ? "pointer" : "default" }}
            >
              変更
            </button>
          </div>
        )}

        {filteredSessions.length === 0 ? (
          <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>{sessions.length === 0 ? "まだ記録がありません" : "条件に合うセッションがありません"}</div>
        ) : (
          // 表示枠は5件分の高さに収め、それ以上はスクロールで過去分も見られるようにする(約38px/行)。
          <div style={{ maxHeight: 190, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
            {filteredSessions.map((s) => {
              const reed = reeds.find((r) => r.id === s.reedId) || null;
              return (
                <div
                  key={s.id}
                  onClick={() => (selectionMode ? toggleSessionSelected(s.id) : setSelectedSessionId(s.id))}
                  className="sans"
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 6px", borderBottom: "1px solid #EEF1F4", cursor: "pointer", fontSize: 12 }}
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
                  {s.source === "upload" && <FileAudio size={12} strokeWidth={1.8} style={{ color: "#8D95A1", flexShrink: 0 }} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>
      {/* --- 分析(11.6節): クロス集計(ピボット型マトリクス) --- */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 16, padding: "16px 18px" }}>
        <div className="sans" style={{ fontSize: 15, color: "#174585", fontWeight: 700, marginBottom: 4 }}>
          PIVOT
        </div>
        <div className="sans" style={{ fontSize: 12, color: "#8D95A1", lineHeight: 1.6, marginBottom: 12 }}>
          集計対象抽出(フィルター)・縦軸・横軸・指標を組み合わせて、蓄積データをマトリクスで俯瞰します。各セルはその組み合わせに該当するフレームの平均値です。
        </div>

        {/* 集計対象抽出(フィルター): 任意の次元の値で絞り込み。値を1つも選んでいないフィルターは全選択と同じ扱い */}
        <div style={{ marginBottom: 12, padding: "12px 14px", background: "#F6F7F9", borderRadius: 14, border: "1px solid #E9ECF0" }}>
          <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginBottom: 10, display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
            <button
              onClick={() => setPivotFilters((prev) => [...prev, { dimKey: PIVOT_DIMENSIONS[0].key, values: [], rangeMin: null, rangeMax: null }])}
              className="sans"
              style={{ fontSize: 12, padding: "6px 13px", borderRadius: 999, border: "1px dashed #A6AEBA", background: "#FFFFFF", color: "#435266", cursor: "pointer" }}
            >
              ＋ 条件を追加
            </button>
          </div>
          {pivotFilters.length === 0 ? (
            <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>フィルターなし（全データを集計）</div>
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
                        <div className="sans" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#435266" }}>
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
                        <div className="sans" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#435266" }}>
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
                                        fontSize: 12, padding: "3px 10px", borderRadius: 10, cursor: "pointer",
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
                                <span className="sans" style={{ fontSize: 12, color: "#8D95A1", padding: "4px 0" }}>該当する値がありません</span>
                              ) : options.map((v) => {
                                const selected = flt.values.includes(v);
                                return (
                                  <button
                                    key={v}
                                    onClick={() => updateFilter({ values: selected ? flt.values.filter((x) => x !== v) : [...flt.values, v] })}
                                    className="sans"
                                    style={{
                                      fontSize: 12, padding: "3px 8px", borderRadius: 10, cursor: "pointer",
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

        {/* 縦軸・横軸・指標のセレクタ(Claude Design: 3枚の丸角カード)。
            縦軸=グラフの縦に並ぶ項目 / 横軸=値そのもの(指標値) / 指標=色分けして重ねる系列。 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[
            { label: "縦軸", node: (
              <select value={pivotRow} onChange={(e) => setPivotRow(e.target.value)} className="pivot-axis-select">
                {PIVOT_DIMENSIONS.map((d) => (<option key={d.key} value={d.key}>{d.label}</option>))}
              </select>
            ) },
            { label: "横軸", node: (
              <select value={pivotMetric} onChange={(e) => setPivotMetric(e.target.value)} className="pivot-axis-select">
                {PIVOT_MEASURES.map((m) => (<option key={m.key} value={m.key}>{m.label}</option>))}
              </select>
            ) },
            { label: "指標", node: (
              <select value={pivotCol} onChange={(e) => setPivotCol(e.target.value)} className="pivot-axis-select">
                <option value="none">なし（全体）</option>
                {PIVOT_DIMENSIONS.map((d) => (<option key={d.key} value={d.key}>{d.label}</option>))}
              </select>
            ) },
          ].map((z) => (
            <div key={z.label} style={{ flex: 1, minWidth: 0, background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 11, padding: "10px 11px" }}>
              <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginBottom: 4 }}>{z.label}</div>
              {z.node}
            </div>
          ))}
        </div>

        {pivot.rowKeys.length === 0 ? (
          <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>
            この軸の組み合わせに該当するデータがまだありません。運指判定・リード紐付けつきで録音するとここに折れ線が育ちます
          </div>
        ) : (
          <div>
            {/* 折れ線グラフ: 縦=縦軸の項目、横=指標値、指標で選んだ次元の値ごとに色分けした線を重ねる */}
            <PivotLineChart
              rowKeys={pivot.rowKeys} colKeys={pivot.colKeys} cells={pivot.cells}
              metricDef={metricDef}
            />
            <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginTop: 10, lineHeight: 1.6 }}>
              縦に「{PIVOT_DIMENSIONS.find((d) => d.key === pivotRow)?.label}」、横に「{metricDef.label}」。{pivotCol === "none" ? "全体を1本の折れ線で表示します。" : `「${PIVOT_DIMENSIONS.find((d) => d.key === pivotCol)?.label}」ごとに色分けした折れ線を重ねて比較します。`}
            </div>
          </div>
        )}
      </div>
      </SwipePager>
    </div>
  );
}

// セッション詳細ビュー。録音/アップロードいずれかのセッションを、計測タブに近いレイアウトで振り返る。
function SessionDetailView({ session, reeds, sessions, selectedIdeal, NUM_HARMONICS, promoteSessionToIdeal, updateSessions, performers, setPerformers, tuningHz, onBack }) {
  const frames = session.frames || [];
  // 「音階ごとの平均」表は縦横スクロールするが、1操作では縦か横の片方だけ動くようにする(斜め防止)
  const noteAvgScrollRef = useAxisLockScroll();
  // 1回のデータには複数の音(スケール等)が含まれることがあるため、音階(運指)ごとにも分解して平均を出す
  const noteGroups = groupFramesByNote(frames, NUM_HARMONICS);
  const reed = reeds.find((r) => r.id === session.reedId) || null;
  const sessionMetrics = computeFrameMetrics(frames);

  // 記録後に気づいた誤り(奏者・リードの紐付け間違い等)をその場で修正できるようにする
  const setSessionPerformer = (name) => {
    updateSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, performer: name } : s)));
  };
  const setSessionReedId = (reedId) => {
    updateSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, reedId: reedId || null, linkedAt: reedId ? "retroactive" : null } : s)));
  };
  // 日付も後から修正できる(録音日を間違えた場合等)。開封後日数などの集計はこの日付に追従する。
  const setSessionRecordedAt = (value) => {
    const d = value ? new Date(value) : null;
    if (!d || isNaN(d.getTime())) return;
    updateSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, recordedAt: d.toISOString() } : s)));
  };
  // datetime-local入力はローカル時刻の "YYYY-MM-DDTHH:mm" 形式を要求するため変換する
  const recordedAtLocal = (() => {
    const d = new Date(session.recordedAt);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

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
        style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#174585", fontSize: 12, marginBottom: 10, cursor: "pointer", padding: 0 }}
      >
        <ChevronDown size={13} style={{ transform: "rotate(90deg)" }} /> 一覧に戻る
      </button>

      {/* 1. セッション情報 */}
      <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "14px 16px", marginBottom: 10 }}>
        <div style={{ marginBottom: 6 }}>
          <input
            type="datetime-local"
            value={recordedAtLocal}
            onChange={(e) => setSessionRecordedAt(e.target.value)}
            className="sans"
            style={{ background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "4px 8px", color: "#121F32", fontSize: 13, fontWeight: 700, boxSizing: "border-box" }}
          />
        </div>
        {/* 日付の下段に奏者・リード・楽器種別を横一列で並べる(1行に収める。はみ出す分は横スクロール) */}
        <div className="sans" style={{ fontSize: 12, color: "#435266", display: "flex", alignItems: "center", gap: 12, flexWrap: "nowrap", overflowX: "auto" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            奏者:
            <PerformerSelector performers={performers} selectedPerformer={session.performer || "自分"} setSelectedPerformer={setSessionPerformer} setPerformers={setPerformers} />
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            リード:
            <select value={session.reedId || ""} onChange={(e) => setSessionReedId(e.target.value || null)}>
              <option value="">未紐付け</option>
              {reeds.map((r) => (<option key={r.id} value={r.id}>{reedLabel(r, reeds)}</option>))}
            </select>
          </span>
          <span style={{ flexShrink: 0 }}>{SAX_PRESETS[session.saxType]?.label ?? session.saxType}</span>
        </div>
        {session.source === "upload" && (
          <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>アップロード: {session.sourceFileName}</div>
        )}
        <div className="sans" style={{ fontSize: 12, marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#435266", flexShrink: 0 }}>メモ:</span>
          <input
            type="text" placeholder="何を試したか(例: マウスピース変更・アンブシュアを緩めた 等)"
            value={memoDraft} onChange={(e) => setMemoDraft(e.target.value)} onBlur={commitMemo}
            className="sans"
            style={{ flex: 1, background: "#F6F7F9", border: "1px solid #E9ECF0", borderRadius: 4, padding: "6px 10px", color: "#121F32", fontSize: 12 }}
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
          barlines={session.barlines}
        />
      )}

      {/* 2.5. セッション平均の指標カード。タップで横軸=音名の折れ線グラフに切り替わる(再タップで数値に戻る) */}
      {frames.length > 0 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "14px 16px", marginTop: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {REED_COMPARE_METRICS.map((mt) => {
              const v = sessionMetrics[mt.key];
              return (
                <TappableMetricCard
                  key={mt.key}
                  label={mt.label} unit={mt.unit} fmt={mt.fmt}
                  metricKey={mt.key} idealKey={METRIC_IDEAL_KEYS[mt.key]}
                  frames={frames} saxType={session.saxType} tuningHz={tuningHz} selectedIdeal={selectedIdeal}
                  value={v !== null && v !== undefined ? `${mt.fmt(v)}${mt.unit ? ` ${mt.unit}` : ""}` : "—"}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* 3. 音階ごとの平均値。1回のデータに複数の音が含まれる場合、音ごとの理想値との差もここで確認できる */}
      {noteGroups.length > 0 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #E9ECF0", borderRadius: 6, padding: "10px 16px", marginTop: 10 }}>
          <div className="sans" style={{ fontSize: 12, color: "#435266", marginBottom: 10 }}>
            音階ごとの平均（{noteGroups.length}音）
          </div>
          {/* 表示枠は5行分にとどめ、それ以上はスクロールで閲覧する(見出し行は上に固定) */}
          <div ref={noteAvgScrollRef} style={{ overflowX: "auto", maxHeight: 133, overflowY: "auto" }}>
          <table className="sans" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 480 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", top: 0, background: "#FFFFFF", textAlign: "left", padding: "5px 8px", color: "#435266", fontSize: 12, borderBottom: "1px solid #E9ECF0" }}>記音</th>
                <th style={{ position: "sticky", top: 0, background: "#FFFFFF", textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 12, borderBottom: "1px solid #E9ECF0" }}>ピッチ</th>
                <th style={{ position: "sticky", top: 0, background: "#FFFFFF", textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 12, borderBottom: "1px solid #E9ECF0" }}>音量</th>
                <th style={{ position: "sticky", top: 0, background: "#FFFFFF", textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 12, borderBottom: "1px solid #E9ECF0" }}>重心</th>
                <th style={{ position: "sticky", top: 0, background: "#FFFFFF", textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 12, borderBottom: "1px solid #E9ECF0" }}>HNR</th>
                <th style={{ position: "sticky", top: 0, background: "#FFFFFF", textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 12, borderBottom: "1px solid #E9ECF0" }}>理想値との差</th>
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
        </div>
      )}
    </div>
  );
}
