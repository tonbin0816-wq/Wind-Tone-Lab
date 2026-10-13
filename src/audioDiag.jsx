// src/audioDiag.jsx ── 【便CQ 2026-10-12】音の診断の板(普段は見えない)。
// 本人の実機の2件(マイクが入るとメトロノームが小さい / 裏から戻るとメトロノームが動かない)を、
// スクリーンショット1枚で切り分けるためのもの。**読むだけで、音にもマイクにも何もしない。**(【便CT】例外は試し口のボタン(mode・gain)を押したときだけ)
//
// 開き方: 計測タブにいるとき、下部タブの「計測」(data-coach="nav-measure")を長押しする。
//   長さはリードの並び替えの長押しと同じ値を App.jsx から受け取る(新しい値を作らない)。
//   長押しが成立したら、その直後の click(= 計測タブの再タップ)は飲み込む。
//   新しいボタンは画面に置かない(普段の画面は1px も変わらない)。
//
// 集める値の置き場はモジュールに1つ(AUDIO_DIAG)。METRO_DIAG(D-18b)と同じ理由 ──
// 仕掛ける側(MeasureView・マイクの処理)まで prop を通すと、再レンダーの条件が変わって「観測だけ」でなくなる。
// 項目名は英語のまま(本人がスクリーンショットを送るだけなので、読み手は統括と実装役)。
import { useEffect, useRef, useState } from "react";
import { shellAudioSessionInfo, shellSetAudioTestMode } from "./shell/audio.js";

// 【便CT 2026-10-13】板の試し口(聞き比べ用。本人の実機「マイクがあると、まだ小さい」)。**どちらも保存しない**(メモリだけ。アプリを開き直せば
// mode は default・倍率は ×1)。ここだけは「読むだけ」ではなく音を変える ── 板を開いてボタンを押したときだけ。
//   mode … 殻の音のセッションのモード(FicusAudioSession.setTestMode)。殻はメモリにだけ持ち、以後の立て直しもそのモードで行う。今の値は sessionInfo の mode の行に出る
//   gain … メトロノームのマスターの倍率(基の値 殻 1.0 / Web 2.6 に掛ける。リミッターの後なので、×1.3 で強拍は 1 を越えうる = 割れの確かめ)
export const AUDIO_DIAG_TEST_MODES = ["default", "videoRecording", "measurement", "spokenAudio", "moviePlayback"];
export const AUDIO_DIAG_METRO_GAINS = [1, 1.3, 1.6];
// 直近のクリックのピークを見る窓(この長さの間の最大)。拍が 60 以上なら窓に1拍は入る
const AUDIO_DIAG_PEAK_WINDOW_MS = 1000;
// ピークを読む間隔。分析の窓(fftSize 2048 = 48kHz で約 43ms)より短くして、取りこぼさない
const AUDIO_DIAG_PEAK_POLL_MS = 20;

export const AUDIO_DIAG = {
  lastHiddenAt: null,    // 最後に隠れた時刻(Date.now())
  lastReturnAt: null,    // 最後に戻った時刻
  lastBgSec: null,       // 最後に裏にいた秒数
  returns: 0,            // 戻った回数(この起動の中)
  lastStart: null,       // 直近の START: { at, prevState, stalled, rebuilt }
  lastMicRecover: null,  // 直近のマイクの取り直し: { at, reason }
  getMetro: null,        // MeasureView が置く: () => ({ ctx, on })
  getMic: null,          // マイクの処理が置く: () => ({ ctxState, track(readyState / muted / enabled / label), settings, recovering, needsRetry })
  // 【便CT】試し口(保存しない)
  metroGainX: 1,         // メトロノームのマスターの倍率(startMetronome が新しい ctx にも当てる)
  testMode: { requested: "default", result: "—" }, // 板で選んだモードと、殻の答え
  peak: { at: [], max: 0 }, // 直近のクリックのピーク: at = [時刻, ピーク] の並び(窓の中だけ)・max = 板を開いてから(倍率・モードを替えたら数え直す)
};

// 【便CT】メトロノームの ctx にマスターの倍率を当てる。鎖がまだ無ければ ctx に置くだけ(getMetroMasterInput が組むときに掛ける)、
// あれば今のマスターの節点に基の値 × 倍率を入れる(鳴らしている最中でも効く)。基の値と節点は App.jsx の getMetroMasterInput が ctx に置く。
export function audioDiagApplyMetroGain(ctx, x) {
  if (!ctx) return;
  ctx.__metroDiagGainX = x;
  const m = ctx.__metroMasterGain;
  if (m && ctx.__metroMasterBase > 0) m.gain.value = ctx.__metroMasterBase * x;
}
function audioDiagResetPeak() { AUDIO_DIAG.peak = { at: [], max: 0 }; }
export function audioDiagSetMetroGain(x) {
  if (!AUDIO_DIAG_METRO_GAINS.includes(x)) return;
  AUDIO_DIAG.metroGainX = x;
  const m = AUDIO_DIAG.getMetro ? AUDIO_DIAG.getMetro() : null;
  audioDiagApplyMetroGain(m ? m.ctx : null, x);
  audioDiagResetPeak();
}
// 殻のモードを替える(Web は何もしない)。答えは板の testMode の行に出る。
export function audioDiagSetTestMode(mode, setMode = shellSetAudioTestMode) {
  if (!AUDIO_DIAG_TEST_MODES.includes(mode)) return Promise.resolve();
  AUDIO_DIAG.testMode = { requested: mode, result: "…" };
  audioDiagResetPeak();
  return setMode(mode).then((r) => {
    if (AUDIO_DIAG.testMode.requested !== mode) return;
    const result = r === null ? "n/a (web)"
      : !r || r.error ? `err: ${r?.error ?? "?"}`
      : strip(r.mode, "AVAudioSessionMode");
    AUDIO_DIAG.testMode = { requested: mode, result };
  });
}
// 【便CT 審査】板を閉じたときの戻し: gain は ×1、mode は default。殻へは毎回 default を頼む(板の覚えと殻の覚えがずれていても戻る。Web は何もしない)。
export function audioDiagResetTests(setMode = shellSetAudioTestMode) {
  audioDiagSetMetroGain(1);
  return audioDiagSetTestMode("default", setMode);
}
// メトロノームのマスターの出口(リミッターとマスターの後・出口の手前)のピークを1回読む。分析の節点は板が開いている間だけ付ける
// (ctx.__metroPeakTap。出口へはつながない = 音には何もしない)。鎖がまだ無いとき・作れないときは null。
export function audioDiagReadPeak(ctx, now = Date.now()) {
  const m = ctx && ctx.__metroMasterGain;
  if (!m || ctx.state === "closed") return null;
  let tap = ctx.__metroPeakTap;
  if (!tap) {
    try {
      tap = ctx.createAnalyser();
      tap.fftSize = 2048;
      m.connect(tap);
    } catch { return null; }
    ctx.__metroPeakTap = tap;
    tap.__buf = new Float32Array(tap.fftSize);
  }
  tap.getFloatTimeDomainData(tap.__buf);
  let pk = 0;
  for (let i = 0; i < tap.__buf.length; i++) pk = Math.max(pk, Math.abs(tap.__buf[i]));
  const p = AUDIO_DIAG.peak;
  p.at = p.at.filter(([t]) => now - t <= AUDIO_DIAG_PEAK_WINDOW_MS);
  p.at.push([now, pk]);
  p.max = Math.max(p.max, pk);
  return pk;
}
// 板を閉じたら分析の節点を外す
export function audioDiagDropPeakTap(ctx) {
  const tap = ctx && ctx.__metroPeakTap;
  if (!tap) return;
  try { ctx.__metroMasterGain.disconnect(tap); } catch { /* noop */ }
  ctx.__metroPeakTap = null;
}

// 隠れた / 戻ったの時刻を控える(純粋に記録だけ)。
export function audioDiagNoteVisibility(hidden, now = Date.now()) {
  if (hidden) { AUDIO_DIAG.lastHiddenAt = now; return; }
  AUDIO_DIAG.lastReturnAt = now;
  AUDIO_DIAG.returns += 1;
  AUDIO_DIAG.lastBgSec = AUDIO_DIAG.lastHiddenAt === null ? null : (now - AUDIO_DIAG.lastHiddenAt) / 1000;
}
export function audioDiagNoteStart(info) {
  AUDIO_DIAG.lastStart = { at: Date.now(), ...info };
}
export function audioDiagNoteMicRecover(reason) {
  AUDIO_DIAG.lastMicRecover = { at: Date.now(), reason: String(reason) };
}

// App の根から1回だけ呼ぶ。戻り値は片付け。
export function installAudioDiagClock() {
  const onVis = () => audioDiagNoteVisibility(document.hidden);
  const onShow = (e) => { if (e && e.persisted) audioDiagNoteVisibility(false); };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pageshow", onShow);
  return () => {
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pageshow", onShow);
  };
}

// AVAudioSession.CategoryOptions の生の値 → 名前(Apple の AVAudioSessionCategoryOptions の値)。
const OPTION_BITS = [
  [0x1, "mixWithOthers"], [0x2, "duckOthers"], [0x4, "allowBluetoothHFP"], [0x8, "defaultToSpeaker"],
  [0x10, "interruptSpokenAudio"], [0x20, "allowBluetoothA2DP"], [0x40, "allowAirPlay"], [0x80, "overrideMutedMic"],
];
export function audioDiagOptionNames(raw) {
  if (typeof raw !== "number") return "—";
  const names = OPTION_BITS.filter(([bit]) => (raw & bit) === bit).map(([, n]) => n);
  return `0x${raw.toString(16)} ${names.join(" ") || "none"}`;
}
// AVAudioSession.RouteSharingPolicy の生の値 → 名前。
const POLICY_NAMES = { 0: "default", 1: "longFormAudio", 2: "independent", 3: "longFormVideo" };
export function audioDiagPolicyName(raw) {
  if (typeof raw !== "number") return "—";
  return `${POLICY_NAMES[raw] ?? "?"}(${raw})`;
}

// 【便CS】殻の port({ portType, name })→「portType:名前」。portType の接頭辞は付けない(生の値のまま。例 MicrophoneBuiltIn:iPhone マイク)。
// 優先の入力が無い(nil)とき殻は空の辞書を返すので「none」。
export function audioDiagPort(p) {
  if (!p || typeof p !== "object" || !p.portType) return "none";
  return `${p.portType}:${p.name ?? "?"}`;
}
// 板の micTrack に出す deviceId の先頭の文字数(見分けがつけば足りる。全部出すと長く、板の1行に収まらない)。値は便CS の指示「先頭数文字」を 8 にしたもの
export const AUDIO_DIAG_ID_HEAD = 8;

const clock = (ms) => {
  if (typeof ms !== "number") return "—";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const yn = (b) => (b === true ? "yes" : b === false ? "no" : "—");
const strip = (s, prefix) => (typeof s === "string" ? s.replace(prefix, "") : "—");

// 板に出す行([名前, 値] の並び)。session は殻の sessionInfo の答え(Web は null・古いビルドは { error })。
export function audioDiagRows(session, now = Date.now()) {
  const rows = [["time", clock(now)]];
  if (session === undefined) rows.push(["session", "…"]);
  else if (session === null) rows.push(["session", "n/a (web)"]);
  else if (!session || session.error) rows.push(["session", `n/a (要ビルド: ${session?.error ?? "?"})`]);
  else {
    rows.push(["category", strip(session.category, "AVAudioSessionCategory")]);
    rows.push(["mode", strip(session.mode, "AVAudioSessionMode")]);
    rows.push(["options", audioDiagOptionNames(session.options)]);
    rows.push(["policy", audioDiagPolicyName(session.routeSharingPolicy)]);
    rows.push(["out", (session.outputs || []).join(" ") || "—"]);
    rows.push(["in", (session.inputs || []).join(" ") || "—"]);
    // 【便CS】入力の候補(availableInputs の portType と名前)と優先の入力(preferredInput)。古い殻のビルドは返さない(「—」)
    rows.push(["inputs", Array.isArray(session.availableInputs) ? (session.availableInputs.map(audioDiagPort).join(" / ") || "none") : "—"]);
    rows.push(["preferredIn", session.preferredInput === undefined ? "—" : audioDiagPort(session.preferredInput)]);
    rows.push(["outputVolume", typeof session.outputVolume === "number" ? session.outputVolume.toFixed(2) : "—"]);
    rows.push(["otherAudio", yn(session.otherAudioPlaying)]);
  }
  const m = AUDIO_DIAG.getMetro ? AUDIO_DIAG.getMetro() : null;
  const ctx = m ? m.ctx : null;
  rows.push(["metro", m ? `on=${yn(m.on)} ctx=${ctx ? `${ctx.state} t=${Number(ctx.currentTime).toFixed(3)}` : "none"}` : "n/a"]);
  const s = AUDIO_DIAG.lastStart;
  rows.push(["lastStart", s ? `${clock(s.at)} rebuilt=${yn(s.rebuilt)} prev=${s.prevState} stalled=${yn(s.stalled)}` : "—"]);
  rows.push(["lastHidden", clock(AUDIO_DIAG.lastHiddenAt)]);
  rows.push(["lastReturn", AUDIO_DIAG.lastReturnAt === null ? "—"
    : `${clock(AUDIO_DIAG.lastReturnAt)} bg=${AUDIO_DIAG.lastBgSec === null ? "—" : AUDIO_DIAG.lastBgSec.toFixed(1)}s #${AUDIO_DIAG.returns}`]);
  const mic = AUDIO_DIAG.getMic ? AUDIO_DIAG.getMic() : null;
  rows.push(["mic", mic ? `ctx=${mic.ctxState} track=${mic.track ? `${mic.track.readyState} muted=${yn(mic.track.muted)} enabled=${yn(mic.track.enabled)}` : "none"} recovering=${yn(mic.recovering)} retry=${yn(mic.needsRetry)}` : "n/a"]);
  const st = mic && mic.settings ? mic.settings : null;
  rows.push(["micSettings", st ? `ec=${yn(st.echoCancellation)} ns=${yn(st.noiseSuppression)} agc=${yn(st.autoGainControl)}` : "—"]);
  // 【便CS】使っているマイクのトラックの label と deviceId の先頭(AUDIO_DIAG_ID_HEAD 文字)
  rows.push(["micTrack", mic && mic.track
    ? `label=${mic.track.label || "—"} id=${st && st.deviceId ? String(st.deviceId).slice(0, AUDIO_DIAG_ID_HEAD) : "—"}`
    : "—"]);
  const r = AUDIO_DIAG.lastMicRecover;
  rows.push(["micRecover", r ? `${clock(r.at)} ${r.reason}` : "—"]);
  let webType = "—";
  try { if (typeof navigator !== "undefined" && navigator.audioSession) webType = String(navigator.audioSession.type); } catch { /* noop */ }
  rows.push(["web.audioSession", webType]);
  // 【便CT】試し口の今の値と、直近のクリックのピーク(窓 AUDIO_DIAG_PEAK_WINDOW_MS の最大・板を開いてからの最大。1 を越えたら clip)
  const tm = AUDIO_DIAG.testMode;
  rows.push(["testMode", `${tm.requested} → ${tm.result}`]);
  rows.push(["metroGain", `x${AUDIO_DIAG.metroGainX}`]);
  const pk = AUDIO_DIAG.peak;
  const recent = pk.at.reduce((a, [, v]) => Math.max(a, v), 0);
  rows.push(["clickPeak", pk.at.length ? `${recent.toFixed(3)} max=${pk.max.toFixed(3)}${pk.max > 1 ? " clip" : ""}` : "—"]);
  return rows;
}

// 計測タブの「計測」の長押しで開く。enabled が false の間は何もしない。
export function useAudioDiagLongPress(enabled, holdMs, onOpen) {
  const openRef = useRef(onOpen);
  useEffect(() => { openRef.current = onOpen; }, [onOpen]);
  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    let fired = false;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const onDown = (e) => {
      fired = false;
      clear();
      const t = e.target;
      if (!t || typeof t.closest !== "function" || !t.closest('[data-coach="nav-measure"]')) return;
      timer = setTimeout(() => { timer = null; fired = true; openRef.current(); }, holdMs);
    };
    // 長押しが成立したあとの click(計測タブの再タップ)は飲み込む
    const onClick = (e) => {
      if (!fired) return;
      fired = false;
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", clear, true);
    document.addEventListener("pointercancel", clear, true);
    document.addEventListener("click", onClick, true);
    return () => {
      clear();
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", clear, true);
      document.removeEventListener("pointercancel", clear, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [enabled, holdMs]);
}

// 板。1秒に1回だけ読み直す(読むだけ)。position: fixed で画面の流れに入らない。
export function AudioDiagPanel({ onClose }) {
  const [rows, setRows] = useState(() => audioDiagRows(undefined));
  useEffect(() => {
    let alive = true;
    const read = () => {
      shellAudioSessionInfo().then((session) => { if (alive) setRows(audioDiagRows(session)); });
    };
    read();
    const id = setInterval(read, 1000);
    // 【便CT】直近のクリックのピーク(板が開いている間だけ読む。閉じたら分析の節点を外す)
    audioDiagResetPeak();
    const tapped = new Set();
    const readPeak = () => {
      const m = AUDIO_DIAG.getMetro ? AUDIO_DIAG.getMetro() : null;
      const ctx = m ? m.ctx : null;
      if (ctx && audioDiagReadPeak(ctx) !== null) tapped.add(ctx);
    };
    const pid = setInterval(readPeak, AUDIO_DIAG_PEAK_POLL_MS);
    return () => {
      alive = false; clearInterval(id); clearInterval(pid);
      for (const ctx of tapped) audioDiagDropPeakTap(ctx);
      // 【便CT 審査 統括の裁定】板を閉じたら試し口を元に戻す(gain ×1・殻の mode default)。
      // 戻し忘れると、その起動のあいだ割れが続き、計測の値も変わるため。開いている間の聞き比べは今のまま
      audioDiagResetTests();
    };
  }, []);
  const [, setPick] = useState(0);
  const pickMode = (mode) => {
    audioDiagSetTestMode(mode).then(() => { setPick((n) => n + 1); shellAudioSessionInfo().then((s) => setRows(audioDiagRows(s))); });
    setPick((n) => n + 1);
  };
  const pickGain = (x) => { audioDiagSetMetroGain(x); setPick((n) => n + 1); };
  const pill = (on) => ({
    minHeight: "var(--tap-min)", padding: "0 var(--sp-2)", borderRadius: "var(--r-2)",
    border: `1px solid ${on ? "var(--c-accent)" : "var(--c-line-strong)"}`, background: "none",
    color: on ? "var(--c-accent)" : "var(--c-ink)", fontSize: "var(--fs-xs)", cursor: "pointer",
  });
  return (
    <div
      role="dialog" aria-label="audio diag" data-audio-diag=""
      style={{
        position: "fixed", zIndex: 50,
        top: "calc(env(safe-area-inset-top) + var(--sp-2))",
        left: "var(--page-pad-left)", right: "var(--page-pad-right)",
        maxHeight: "calc(100svh - var(--page-bottom-gap) - env(safe-area-inset-top) - var(--sp-4))",
        overflowY: "auto",
        background: "var(--c-surface)", border: "1px solid var(--c-line-strong)", borderRadius: "var(--r-2)",
        padding: "var(--sp-2) var(--sp-3)",
        fontSize: "var(--fs-xs)", lineHeight: 1.35, color: "var(--c-ink)",
      }}
    >
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: "var(--sp-2)" }}>
          <span style={{ color: "var(--c-ink-2)", flexShrink: 0 }}>{k}</span>
          <span data-diag-key={k} style={{ fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{v}</span>
        </div>
      ))}
      {/* 【便CT】試し口(保存しない)。mode は殻だけ効く(Web は n/a)・gain は殻と Web の両方 */}
      <div data-diag-test="mode" style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", marginTop: "var(--sp-2)" }}>
        {AUDIO_DIAG_TEST_MODES.map((md) => (
          <button key={md} type="button" className="sans" data-diag-mode={md}
            aria-pressed={AUDIO_DIAG.testMode.requested === md}
            style={pill(AUDIO_DIAG.testMode.requested === md)} onClick={() => pickMode(md)}>{md}</button>
        ))}
      </div>
      <div data-diag-test="gain" style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", marginTop: "var(--sp-1)" }}>
        {AUDIO_DIAG_METRO_GAINS.map((x) => (
          <button key={x} type="button" className="sans" data-diag-gain={x}
            aria-pressed={AUDIO_DIAG.metroGainX === x}
            style={pill(AUDIO_DIAG.metroGainX === x)} onClick={() => pickGain(x)}>{`x${x}`}</button>
        ))}
      </div>
      <button
        type="button" onClick={onClose} className="sans"
        style={{ marginTop: "var(--sp-1)", minHeight: "var(--tap-min)", width: "100%", background: "none", border: "none", color: "var(--c-accent)", fontSize: "var(--fs-sm)", cursor: "pointer" }}
      >閉じる</button>
    </div>
  );
}
