// src/audioDiag.jsx ── 【便CQ 2026-10-12】音の診断の板(普段は見えない)。
// 本人の実機の2件(マイクが入るとメトロノームが小さい / 裏から戻るとメトロノームが動かない)を、
// スクリーンショット1枚で切り分けるためのもの。**読むだけで、音にもマイクにも何もしない。**(【便CT】例外は Web の試し口 gain のボタンを押したときだけ)
//
// 開き方: 計測タブにいるとき、下部タブの「計測」(data-coach="nav-measure")を長押しする。
//   【便S4】本番の殻(App Store に出すビルド)では開かない(audioDiagAvailable)。開発版の殻と Web では開ける。
//   長さはリードの並び替えの長押しと同じ値を App.jsx から受け取る(新しい値を作らない)。
//   長押しが成立したら、その直後の click(= 計測タブの再タップ)は飲み込む。
//   新しいボタンは画面に置かない(普段の画面は1px も変わらない)。
//
// 集める値の置き場はモジュールに1つ(AUDIO_DIAG)。METRO_DIAG(D-18b)と同じ理由 ──
// 仕掛ける側(MeasureView・マイクの処理)まで prop を通すと、再レンダーの条件が変わって「観測だけ」でなくなる。
// 項目名は英語のまま(本人がスクリーンショットを送るだけなので、読み手は統括と実装役)。
//
// 【便CX 2026-10-19】殻の計測の音(メトロノームとマイク)を本番で殻(AVAudioEngine)が扱うようになったので、試し口を整理した:
//   ・鳴らし方(web / nativeClick / nativeBoth / nativeSolo)… 消した(本番が殻になった。聞き比べは済んだ)。
//   ・mode(殻のセッションのモード 5種)… 消した。殻のセッションは本番の値(.default)に固定で、動いているエンジンのモードを替えると
//     構成の変化 → エンジンの作り直しになり、板が見せる作り直しの回数を試しが汚す。WebKit のセッションで聞き比べた結果(どれも同じ)は無効だった。
//   ・gain(×1 / ×1.3 / ×1.6)と clickPeak … Web だけに残した(Web Audio のメトロノームのマスターに掛けるもので、殻のクリックは殻で鳴るので届かない。
//     殻のクリックの音は変えない決まり)。殻では出さない。
//   ・板の行は本番の殻の状態を出す(nativeEngine / nativeSched / nativeIn / nativeClock / nativeBuf)。
// 【便CY 2026-10-20】マイクの取り直し(recoverMic)の行 micRecover に、始めるときの様子と、終わったときの結果を足した(記録だけ):
//   「HH:MM:SS 理由 [chunkAge=…ms gap=…ms st=…] → ok | NG start=… err=… ctx=… track=… native: err=… | superseded」
//   ・chunkAge = 殻の塊が最後に届いてからの時間(殻だけ。無音の見張りが動いたとき、塊が途切れていたかが分かる)
//   ・gap = 解析のフレームの直近の間隔(殻だけ。大きければ JS の主スレッドが止まっていた = 塊が積まれたまま古いと読まれた可能性。小さければ殻の塊の途切れ)
//   ・st = 殻が最後に知らせた状態(interrupted/began など。電話・Siri の中断の最中だったかが分かる)
//   ・NG の start= は startListening の答え(false = 殻の micStart が断った・始められなかった)・err= はその断りの理由(殻の文)・
//     ctx= / track= は取り直した後の部品の状態・native: は殻の audioInfo の lastError など(殻だけ。後から届いたら足す)
//   殻の最後の状態は nativeState の行にも出す。【審査】st= と nativeState には知らせてからの経過(4s前)を付ける。状態は micStop・裏へ行く・
//   running を受けた・failed を受けた で下ろす(古い interrupted を残さない。failed は取り直しの始めが st= で読んだ後に下ろす)。
import { useEffect, useRef, useState } from "react";
import { shellAudioSessionInfo, shellNativeAudio } from "./shell/audio.js";
import { isNativeShell, shellBuildKind } from "./shell/native.js";
import { NATIVE_AUDIO, nativeHostClock } from "./shell/nativeAudio.js";

// 【便CT 2026-10-13】板の試し口 gain(聞き比べ用。**保存しない** = アプリを開き直せば ×1)。【便CX】Web だけ。
//   gain … メトロノームのマスターの倍率(基の値 Web 2.6 に掛ける。リミッターの後なので、×1.3 で強拍は 1 を越えうる = 割れの確かめ)
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
  lastMicRecover: null,  // 直近のマイクの取り直し: { at, reason, pre, result: { at, outcome("ok" / "NG" / "superseded"), detail, native } }
  lastFrameGapMs: null,  // 【便CY】解析のフレームの直近の間隔(ms)。取り直しの始めの gap= に出す
  lastMicStartError: null, // 【便CY】直近の startListening の失敗の理由: { at, text }(殻の micStart の断りの文・getUserMedia のエラー名)
  getMetro: null,        // MeasureView が置く: () => ({ ctx, on })(殻の ctx は殻のメトロノームの時計の口)
  getMic: null,          // マイクの処理が置く: () => ({ ctxState, track(readyState / muted / enabled / label), settings, recovering, needsRetry })
  // 【便CT】試し口(保存しない。【便CX】Web だけ)
  metroGainX: 1,         // メトロノームのマスターの倍率(startMetronome が新しい ctx にも当てる)
  peak: { at: [], max: 0 }, // 直近のクリックのピーク: at = [時刻, ピーク] の並び(窓の中だけ)・max = 板を開いてから(倍率を替えたら数え直す)
  // 【便CX】殻の audioInfo の答え(板が1秒ごとに読む。undefined = まだ読んでいない)
  nativeInfo: undefined,
};

// 【便CT】メトロノームの ctx にマスターの倍率を当てる。鎖がまだ無ければ ctx に置くだけ(getMetroMasterInput が組むときに掛ける)、
// あれば今のマスターの節点に基の値 × 倍率を入れる(鳴らしている最中でも効く)。基の値と節点は App.jsx の getMetroMasterInput が ctx に置く。
// 【便CX】殻のメトロノームの ctx(時計の口)には鎖が無いので、置くだけで何も起きない(殻のクリックは殻で鳴る)。
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
// 【便CT 審査】板を閉じたときの戻し: gain は ×1。
export function audioDiagResetTests() {
  audioDiagSetMetroGain(1);
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
  if (hidden) {
    AUDIO_DIAG.lastHiddenAt = now;
    NATIVE_AUDIO.state = null; // 【便CY 審査】裏へ行ったら、殻の最後の状態(interrupted など)は古くなる。戻った後の板に残さない
    return;
  }
  AUDIO_DIAG.lastReturnAt = now;
  AUDIO_DIAG.returns += 1;
  AUDIO_DIAG.lastBgSec = AUDIO_DIAG.lastHiddenAt === null ? null : (now - AUDIO_DIAG.lastHiddenAt) / 1000;
}
export function audioDiagNoteStart(info) {
  AUDIO_DIAG.lastStart = { at: Date.now(), ...info };
}
export function audioDiagNoteMicRecover(reason) {
  AUDIO_DIAG.lastMicRecover = { at: Date.now(), reason: String(reason), pre: audioDiagMicPre() };
}
// 【便CY 審査】知らせてからの経過(秒。「4s前」)。長いものは古い ── 殻はこの後の running / failed で下ろすが、取りこぼした知らせの跡かもしれない
export function audioDiagAgo(at, nowMs = Date.now()) {
  return typeof at === "number" ? `${Math.max(0, Math.round((nowMs - at) / 1000))}s前` : "—";
}
// 【便CY】取り直しを始めるときの殻の様子(殻だけ。Web は空)。塊が最後に届いてからの時間と、殻が最後に知らせた状態
export function audioDiagMicPre(perfNow = performance.now(), nowMs = Date.now()) {
  if (!isNativeShell()) return "";
  const m = NATIVE_AUDIO.mic;
  const age = typeof m.lastRecvAt === "number" ? `${Math.max(0, Math.round(perfNow - m.lastRecvAt))}ms` : "—";
  const st = NATIVE_AUDIO.state;
  const gap = typeof AUDIO_DIAG.lastFrameGapMs === "number" && AUDIO_DIAG.lastFrameGapMs > 0 ? `${Math.round(AUDIO_DIAG.lastFrameGapMs)}ms` : "—";
  return `chunkAge=${age} gap=${gap} st=${st ? `${st.state}/${st.reason || "—"}(${audioDiagAgo(st.at, nowMs)})` : "—"}`;
}
// 【便CY】startListening が失敗した理由を控える(殻の micStart の断りの文 = code か message・Web は getUserMedia のエラー名)
export function audioDiagNoteMicStartError(err) {
  AUDIO_DIAG.lastMicStartError = err === null ? null : { at: Date.now(), text: String((err && (err.code || err.message || err.name)) || err).slice(0, 120) };
}
// 【便CY】取り直しの結果を、直近の取り直しの記録に足す。outcome = "ok" / "NG" / "superseded"。取り直しが始まっていなければ何もしない
export function audioDiagNoteMicRecoverResult(outcome, detail = "") {
  const r = AUDIO_DIAG.lastMicRecover;
  if (!r) return;
  r.result = { at: Date.now(), outcome, detail: String(detail) };
}
// 【便CY】失敗の詳細の一言(純関数)。start = startListening の答え・err = その失敗の理由・ctx / track = 取り直した後の部品の状態
export function audioDiagMicRecoverDetail({ ok, err, ctxState, track }) {
  const t = track ? `${track.readyState}${track.muted === true ? "/muted" : ""}` : "none";
  return `start=${ok === true ? "ok" : String(ok)} err=${err || "—"} ctx=${ctxState || "none"} track=${t}`;
}
// 【便CY】殻だけ: 失敗の結果に、殻の audioInfo の lastError などを足す(読むだけ。返事が来たとき、まだ同じ取り直しの記録なら足す)
export function audioDiagAddNativeToRecoverResult() {
  const api = shellNativeAudio();
  const rec = AUDIO_DIAG.lastMicRecover;
  if (!api || !rec || !rec.result) return Promise.resolve();
  const result = rec.result;
  return api.info().then((ni) => {
    if (!ni || ni.error || AUDIO_DIAG.lastMicRecover !== rec || rec.result !== result) return;
    result.native = `native: err=${ni.lastError || "—"} running=${yn(ni.engineRunning)} mic=${yn(ni.micOn)} cfg=${ni.configChanges ?? 0} rb=${ni.rebuilds ?? 0}`;
  }, () => {});
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

// 【便CX】殻の行(本番の殻の状態)。ni は殻の audioInfo の答え(undefined = まだ・{ error } = 古い殻のビルド)。
//   nativeEngine … running = エンジンが動いているか・act = このプロセスで setActive(true) かエンジンの start を一度でも成功させたか・mic / metro = 殻が取り込み中か・鳴らし中か・
//                  cfg = 構成の変化と中断の終わりの回数・rb = 作り直しに成功した回数・err = 殻の最後のエラー(js= は JS 側の失敗)
//   nativeSched  … sched = 予約した累計個数・played = そのうち再生し終わった累計個数・play = player.isPlaying・lrt = player.lastRenderTime が有効か・
//                  tick = 直近の予約の時計が早く返った理由(ok / idle / noEngine / notRunning / noPlayer / replay / noRender / noPlayerTime / badRate)
//   nativeIn     … 殻の取り込みの入力レベル(直近の塊の RMS の dBFS)・入力の標本化周波数・via = 取り方(sink = AVAudioSinkNode / tap = installTap に戻った)・
//                  cb = 1回の受け手のフレーム数(直近/最大)・send = 塊を送る間隔(直近/最大 ms)・送った塊の数(殻 / JS が受けた数)・JS が最後に塊を受けてからの時間・
//                  ovr = 読み手が遅れて輪の分を捨てた回数(0 のとき出さない)
//   nativeClock  … 殻の時計と performance.now() の対応のずれの上限(使っている標本の往復の半分)・往復・合わせた回数。往復が上限(20ms)を越える標本しか無ければ rtt>20
//   nativeBuf    … 殻へ渡したクリックの3段のピーク @標本化周波数(この端末の OfflineAudioContext で描いた値)
export function audioDiagNativeRows(ni, now = performance.now(), nowMs = Date.now()) {
  const rows = [];
  const bad = ni === undefined ? "…" : !ni || ni.error ? `n/a (要ビルド: ${ni?.error ?? "?"})` : null;
  const jsErr = [NATIVE_AUDIO.mic.error && `mic: ${NATIVE_AUDIO.mic.error}`, NATIVE_AUDIO.metro.error && `metro: ${NATIVE_AUDIO.metro.error}`].filter(Boolean).join(" / ");
  rows.push(["nativeEngine", (bad ?? `running=${yn(ni.engineRunning)} act=${yn(ni.activated)} mic=${yn(ni.micOn)} metro=${yn(ni.metroOn)} cfg=${ni.configChanges ?? 0} rb=${ni.rebuilds ?? 0} err=${ni.lastError || "—"}`)
    + (jsErr ? ` js=${jsErr}` : "")]);
  rows.push(["nativeSched", bad ? "—"
    : `sched=${ni.scheduled ?? "—"} played=${ni.played ?? "—"} play=${yn(ni.playing)} lrt=${yn(ni.lastRender)} tick=${ni.tick ?? "—"}`]);
  const age = typeof NATIVE_AUDIO.mic.lastRecvAt === "number" ? `${Math.max(0, Math.round(now - NATIVE_AUDIO.mic.lastRecvAt))}ms` : "—";
  const ms = (v) => (typeof v === "number" ? Math.round(v) : "—");
  rows.push(["nativeIn", bad ? "—"
    : `${typeof ni.inputDb === "number" ? `${ni.inputDb.toFixed(1)} dBFS` : "—"} @${ni.inputRate || "—"} via=${ni.via || "—"} cb=${ni.cbFrames ?? "—"}/${ni.cbMax ?? "—"} send=${ms(ni.sendMs)}/${ms(ni.sendMaxMs)}ms chunks=${ni.chunks ?? 0} js=${NATIVE_AUDIO.mic.chunks} age=${age}${ni.overruns ? ` ovr=${ni.overruns}` : ""}`]);
  const c = nativeHostClock();
  rows.push(["nativeClock", c.synced
    ? `±${c.errorBoundMs.toFixed(1)}ms rtt=${c.state.rttMs.toFixed(1)}ms syncs=${c.state.syncs}${c.state.rttWarn ? " rtt>20" : ""}`
    : `— syncs=${c.state.syncs} fails=${c.state.fails}`]);
  const bp = NATIVE_AUDIO.metro.bufPeaks;
  rows.push(["nativeBuf", bp ? `${bp.accent.toFixed(3)}/${bp.beat.toFixed(3)}/${bp.sub.toFixed(3)} @${bp.rate}` : "—"]);
  // 【便CY】殻が最後に知らせた状態(audioState。interrupted / running / failed と理由・いつ・マイクとメトロノームが動いていたか)
  const ns = NATIVE_AUDIO.state;
  rows.push(["nativeState", ns ? `${ns.state}/${ns.reason || "—"} ${clock(ns.at)}(${audioDiagAgo(ns.at, nowMs)}) mic=${yn(ns.mic)} metro=${yn(ns.metro)}` : "—"]);
  return rows;
}

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
  // 【便CX】殻だけ phase = 振り子の位相(拍の表示が読む値。殻の時計で数える)を足す。Web の行は今のまま
  const phase = isNativeShell() && m && typeof m.phase === "number" ? ` phase=${m.phase.toFixed(2)}` : "";
  rows.push(["metro", m ? `on=${yn(m.on)} ctx=${ctx ? `${ctx.state} t=${Number(ctx.currentTime).toFixed(3)}` : "none"}${phase}` : "n/a"]);
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
  const rr = r && r.result;
  rows.push(["micRecover", r
    ? `${clock(r.at)} ${r.reason}${r.pre ? ` [${r.pre}]` : ""}${rr ? ` → ${rr.outcome}${rr.detail ? ` ${rr.detail}` : ""}${rr.native ? ` ${rr.native}` : ""}` : ""}`
    : "—"]);
  let webType = "—";
  try { if (typeof navigator !== "undefined" && navigator.audioSession) webType = String(navigator.audioSession.type); } catch { /* noop */ }
  rows.push(["web.audioSession", webType]);
  if (isNativeShell()) {
    // 【便CX】殻: 本番の殻のエンジン・予約・入力・時計・クリックの描き出し
    rows.push(...audioDiagNativeRows(AUDIO_DIAG.nativeInfo));
  } else {
    // 【便CT】Web の試し口 gain の今の値と、直近のクリックのピーク(窓 AUDIO_DIAG_PEAK_WINDOW_MS の最大・板を開いてからの最大。1 を越えたら clip)
    rows.push(["metroGain", `x${AUDIO_DIAG.metroGainX}`]);
    const pk = AUDIO_DIAG.peak;
    const recent = pk.at.reduce((a, [, v]) => Math.max(a, v), 0);
    rows.push(["clickPeak", pk.at.length ? `${recent.toFixed(3)} max=${pk.max.toFixed(3)}${pk.max > 1 ? " clip" : ""}` : "—"]);
  }
  return rows;
}

// 【便S4 2026-10-25】診断の板を開けるビルドか。本番の殻(同梱の資産を読むビルド = ios-release / ios-testflight)では開かない。
// 開発版の殻(Ficus Dev)と Web(Vercel・dev サーバ)では今までどおり開ける。判定は広告の ID と同じ印(native.js の shellBuildKind)。
export function audioDiagAvailable(kind = shellBuildKind()) {
  return kind !== "release";
}

// 計測タブの「計測」の長押しで開く。enabled が false の間は何もしない。
// 【便S4】本番の殻(audioDiagAvailable() が false)でも何もしない(長押しを見張らない = 板は開かず、その後の click も飲み込まない)。
export function useAudioDiagLongPress(enabled, holdMs, onOpen) {
  const openRef = useRef(onOpen);
  useEffect(() => { openRef.current = onOpen; }, [onOpen]);
  useEffect(() => {
    if (!enabled || !audioDiagAvailable()) return undefined;
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
  const shell = isNativeShell();
  useEffect(() => {
    let alive = true;
    const read = () => {
      // 【便CX】殻では殻のエンジンの状態(audioInfo)も読む(読むだけ)。Web は読まない
      const api = shellNativeAudio();
      const nat = api
        ? api.info().then((ni) => { AUDIO_DIAG.nativeInfo = ni; }, (e) => { AUDIO_DIAG.nativeInfo = { error: String(e?.code || e?.message || e) }; })
        : Promise.resolve();
      Promise.all([shellAudioSessionInfo(), nat]).then(([session]) => { if (alive) setRows(audioDiagRows(session)); });
    };
    read();
    const id = setInterval(read, 1000);
    // 【便CT】直近のクリックのピーク(Web だけ。板が開いている間だけ読む。閉じたら分析の節点を外す)
    audioDiagResetPeak();
    const tapped = new Set();
    const readPeak = () => {
      const m = AUDIO_DIAG.getMetro ? AUDIO_DIAG.getMetro() : null;
      const ctx = m ? m.ctx : null;
      if (ctx && audioDiagReadPeak(ctx) !== null) tapped.add(ctx);
    };
    const pid = isNativeShell() ? null : setInterval(readPeak, AUDIO_DIAG_PEAK_POLL_MS);
    return () => {
      alive = false; clearInterval(id); if (pid) clearInterval(pid);
      for (const ctx of tapped) audioDiagDropPeakTap(ctx);
      // 【便CT 審査 統括の裁定】板を閉じたら試し口を元に戻す(gain ×1)。
      // 戻し忘れると、その起動のあいだ割れが続き、計測の値も変わるため。開いている間の聞き比べは今のまま
      audioDiagResetTests();
    };
  }, []);
  const [, setPick] = useState(0);
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
      {/* 【便CT】試し口 gain(保存しない)。【便CX】Web だけ(殻のクリックは殻で鳴るので、Web のマスターの倍率は届かない) */}
      {!shell && (
        <div data-diag-test="gain" style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", marginTop: "var(--sp-2)" }}>
          {AUDIO_DIAG_METRO_GAINS.map((x) => (
            <button key={x} type="button" className="sans" data-diag-gain={x}
              aria-pressed={AUDIO_DIAG.metroGainX === x}
              style={pill(AUDIO_DIAG.metroGainX === x)} onClick={() => pickGain(x)}>{`x${x}`}</button>
          ))}
        </div>
      )}
      <button
        type="button" onClick={onClose} className="sans"
        style={{ marginTop: "var(--sp-1)", minHeight: "var(--tap-min)", width: "100%", background: "none", border: "none", color: "var(--c-accent)", fontSize: "var(--fs-sm)", cursor: "pointer" }}
      >閉じる</button>
    </div>
  );
}
