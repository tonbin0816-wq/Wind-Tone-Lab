// src/audioDiag.jsx ── 【便CQ 2026-10-12】音の診断の板(普段は見えない)。
// 本人の実機の2件(マイクが入るとメトロノームが小さい / 裏から戻るとメトロノームが動かない)を、
// スクリーンショット1枚で切り分けるためのもの。**読むだけで、音にもマイクにも何もしない。**(【便CT】例外は試し口のボタン(mode・gain)を押したときだけ。【便CU】殻では鳴らし方 playback も)
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
import {
  shellAudioSessionInfo, shellSetAudioTestMode,
  shellNativeClickLoad, shellNativeClickStart, shellNativeClickStop, shellNativeInputStart, shellNativeInputStop, shellNativeAudioInfo,
} from "./shell/audio.js";
import { isNativeShell } from "./shell/native.js";

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
  // 【便CU】試し口「鳴らし方」(殻だけ・保存しない)
  playback: "web",       // "web" | "nativeClick" | "nativeBoth" | "nativeSolo"
  webMic: null,          // 根が置く: { recording(), stop(), restore() }(nativeBoth の Web のマイクの止めと戻し)
  renderClicks: null,    // 根が置く: (sampleRate) => Promise<{ sampleRate, accent, beat, sub }>(App.jsx の renderMetroClickSamples)
  applyAudioSessionType: null, // 【便CW】根が置く: App.jsx の applyAudioSessionType(navigator.audioSession.type = AUDIO_SESSION_TYPE。nativeSolo から戻すとき)
  // 【便CV】silent = 殻の音が出ていないと見なした理由("" = 出ている/まだ分からない)・gen = 鳴らし方を選ぶたびに進む世代(古い処理の失敗を今の選びに掛けない)・watchAt/watchSched = 予約が進んでいるかの見張りの基準・renderTimeoutMs = 描き出しの待ちの上限
  native: { clickKey: null, loadedRate: null, bufPeaks: null, info: undefined, error: "", silent: "", gen: 0, watchAt: 0, watchSched: null, renderTimeoutMs: 5000, held: [], soloHeld: false, releasing: null, chain: Promise.resolve() },
};

// 【便CU 2026-10-17】試し口「鳴らし方」(本人の実機: 殻のセッションのモード 5種も ×1/1.3/1.6 も、聞こえる音量が変わらなかった)。
// 仮説: Web Audio の音とマイクの取り込みは WebKit の GPU プロセス側の音のセッションで動き、取り込み中 WebKit はそれを playAndRecord + videoChat(通話)に
// 立て直す。殻(アプリのプロセス)のセッションを替えても聞こえる音に効かないのはそのため。1回のビルドで切り分ける(本番の鳴らし方は変えない):
//   web         … 既定・今のまま(Web Audio のクリック + Web のマイク)
//   nativeClick … クリックを殻の AVAudioEngine で鳴らす(Web のマイクはそのまま)。Web Audio のメトロノームはマスターを 0 にしてミュート(止めない。拍の表示は今のまま)
//   nativeBoth  … nativeClick + Web のマイクを止め(既存の stopListening = トラックの stop)、殻の AVAudioEngine の inputNode にタップを付けてマイクを取る
//                 (標本は捨てる。入力のレベルを板の nativeIn に出す = 本当に取れている証拠)。その間 recoverMic は取り直さない(App.jsx)
// **保存しない**(メモリだけ)。板を閉じる・計測タブを離れる(MeasureView が外れて getMetro が消える)・裏へ行く、で web に戻す
// (殻の取り込みとクリックを止め、Web のマイクは既存の recoverMic / startListening で戻す)。殻も裏へ行けば自分で止める(AppDelegate.swift)。
// Web(殻でない)では試し口を出さない(殻の新しいメソッドが無い)。殻のクリックと拍の表示のズレはこの試しでは問わない。
//   nativeSolo  … 【便CW 2026-10-18】nativeBoth + Web の AudioContext をすべて suspend(メトロノームの ctx と、あればマイクの解析の ctx)+ navigator.audioSession.type を "auto"。
//                 本人の実機: 殻で鳴らしても(nativeClick / nativeBoth)音量は web と同じ・nativeBoth で mode 5種も変わらない。参考のネイティブアプリは録音中(オレンジの点)でも大きく、
//                 音量の段も違った。統括の読み: nativeBoth でも Web Audio のメトロノームの ctx がマスター 0 で動き続け、type も "play-and-record" のままなので、
//                 WebKit の GPU プロセスのセッションが PlayAndRecord + videoChat で生き残り、アプリ全体が通話の段に縛られている。WebKit 側の音のセッションを
//                 非活性にして、アプリのプロセスの PlayAndRecord(mode は desiredMode)だけを残す試し。拍の表示などは止まってよい(試し)。
//                 止めている間に START で作られた ctx・誰かが resume した ctx も、板が 20ms ごとに止め直す(type も auto へ)。
//                 戻す(web へ・閉じる・タブを離れる・裏・録音の開始)と、ctx の resume と type の戻し(AUDIO_SESSION_TYPE)はボタンを押したその場で
//                 (iOS は resume にタップの中を求める。Web のマスターは殻のクリックを止め終わるまで 0 なので二重には鳴らない)、殻のクリックの停止 → 殻の取り込みの停止 →
//                 Web のマイクの戻し → Web のマスターの戻し、は nativeBoth と同じ順。resume で running に戻らない ctx はメトロノームを止める(次の START が既存の道で作り直す)。
//                 止めている間は ctx の時計も止まるので、スケジューラは予約を溜めない(戻しても一気に鳴らない)。
export const AUDIO_DIAG_PLAYBACKS = ["web", "nativeClick", "nativeBoth", "nativeSolo"];
// Web のマイクを止める鳴らし方(nativeBoth・nativeSolo)。App.jsx の recoverMic の門と録音の開始が読む
export function audioDiagWebMicStopped(p = AUDIO_DIAG.playback) { return p === "nativeBoth" || p === "nativeSolo"; }
// Web の AudioContext を止め、type を auto にする鳴らし方
const holdsWebAudio = (p) => p === "nativeSolo";
// 【便CW】resume のあと running に戻るのを待つ上限(超えて戻らなければメトロノームを止める)
export const AUDIO_DIAG_RESUME_WAIT_MS = 500;
// 止めた ctx の onstatechange(殻では「止まったら resume する」手当てが付いている。止めている間は外し、戻すときに付け直す)
const heldStateHandlers = new WeakMap();
// 今の Web の AudioContext(メトロノーム・マイクの解析。無いものは除く)
function webAudioContexts() {
  const m = AUDIO_DIAG.getMetro ? AUDIO_DIAG.getMetro() : null;
  const mic = AUDIO_DIAG.webMic && typeof AUDIO_DIAG.webMic.ctx === "function" ? AUDIO_DIAG.webMic.ctx() : null;
  return [m ? m.ctx : null, mic].filter((c) => c && c.state !== "closed");
}
// Web の音のセッションを非活性にする(nativeSolo)。何度呼んでもよい(新しい ctx・running に戻った ctx を止め直す・type を auto に戻す)
function webAudioHold() {
  const st = AUDIO_DIAG.native;
  st.held = (st.held || []).filter((c) => c.state !== "closed");
  for (const ctx of webAudioContexts()) {
    if (!st.held.includes(ctx)) {
      heldStateHandlers.set(ctx, ctx.onstatechange || null);
      ctx.onstatechange = null;
      st.held.push(ctx);
    } else if (ctx.state !== "running") continue;
    try { const r = ctx.suspend(); if (r && typeof r.catch === "function") r.catch(() => {}); } catch { /* noop */ }
  }
  try {
    if (typeof navigator !== "undefined" && navigator.audioSession && navigator.audioSession.type !== "auto") navigator.audioSession.type = "auto";
  } catch { /* noop */ }
}
// 止めた ctx を resume し(onstatechange も付け直す)、type を AUDIO_SESSION_TYPE に戻す。resume の終わりは native.releasing に置く(戻す道が待って確かめる)
function webAudioRelease() {
  const st = AUDIO_DIAG.native;
  const ctxs = (st.held || []).filter((c) => c.state !== "closed");
  const waits = ctxs.map((ctx) => {
    if (heldStateHandlers.has(ctx)) { ctx.onstatechange = heldStateHandlers.get(ctx); heldStateHandlers.delete(ctx); }
    try { return Promise.resolve(ctx.resume()).catch(() => {}); } catch { return Promise.resolve(); }
  });
  st.held = [];
  st.soloHeld = false;
  if (AUDIO_DIAG.applyAudioSessionType) AUDIO_DIAG.applyAudioSessionType();
  st.releasing = ctxs.length ? { ctxs, done: Promise.all(waits) } : null;
}
// 戻したあと(列の中)、止めていたメトロノームの ctx が running に戻ったかを確かめる。戻らなければメトロノームを止める(次の START が既存の道で作り直す)
async function webAudioCheckReleased() {
  const st = AUDIO_DIAG.native;
  const rel = st.releasing;
  st.releasing = null;
  if (!rel) return;
  let t;
  await Promise.race([rel.done, new Promise((r) => { t = setTimeout(r, AUDIO_DIAG_RESUME_WAIT_MS); })]);
  clearTimeout(t);
  const m = AUDIO_DIAG.getMetro ? AUDIO_DIAG.getMetro() : null;
  if (m && m.on && m.ctx && rel.ctxs.includes(m.ctx) && m.ctx.state !== "running" && m.ctx.state !== "closed") {
    if (typeof m.stop === "function") m.stop();
    st.error = `webCtx: resume → ${m.ctx.state}(メトロノームを止めた。START で作り直す)`;
  }
}
const SHELL_NATIVE = {
  load: shellNativeClickLoad, start: shellNativeClickStart, stop: shellNativeClickStop,
  inStart: shellNativeInputStart, inStop: shellNativeInputStop, info: shellNativeAudioInfo,
};
const nativeErr = (r) => (r && r.error ? String(r.error) : "");
// 殻への呼び出しは1本の列で順に送る(開始と停止が入れ替わって音が残らないように)
function nativeEnqueue(fn) {
  const st = AUDIO_DIAG.native;
  st.chain = st.chain.then(fn).catch((e) => { st.error = String(e?.message || e); });
  return st.chain;
}
// Float32 の標本 → base64(殻へ1回だけ渡す)
export function audioDiagFloat32ToBase64(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const absPeak = (d) => { let p = 0; for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i])); return p; };
// 【便CV 2026-10-18】本人の実機「web 以外で鳴らすと音が消える」。殻の音が出ていないのに Web のマスターを 0 のまま続けると、聞き比べができない。
// 次のどれかになったら「殻の音が出ていない」と見なし(native.silent に理由)、Web のマスターを戻して板に native=silent と出す(playback の選びはそのまま。選び直すと消える):
//   start  … nativeClickStart が失敗した(reject・失敗を返す)
//   load   … nativeClickLoad が失敗した
//   render … 描き出しが AUDIO_DIAG_RENDER_TIMEOUT_MS 終わらない・失敗した
//   buf    … 描き出した3段のどれかのピークが AUDIO_DIAG_MIN_CLICK_PEAK 未満(実機の WebKit で無音に描かれた)
//   noSched… メトロノームが鳴っているのに、殻の予約の累計が一定時間(AUDIO_DIAG_NATIVE_SILENT_MS 以上・クリックの最長の間隔の2倍)1つも進まない
export const AUDIO_DIAG_RENDER_TIMEOUT_MS = 5000;
export const AUDIO_DIAG_MIN_CLICK_PEAK = 0.05;
export const AUDIO_DIAG_NATIVE_SILENT_MS = 3000;
// 【便CV 審査】gen = その処理を始めたときの世代。選び直したあと(世代が進んだあと)に古い処理が時間切れ・失敗しても、今の選びには silent を立てない。
function nativeMarkSilent(reason, gen = AUDIO_DIAG.native.gen) {
  const st = AUDIO_DIAG.native;
  if (gen !== st.gen) return;
  if (AUDIO_DIAG.playback === "web" || st.silent) return;
  st.silent = reason;
  // 【便CW】nativeSolo なら、Web の ctx を resume し type も戻してから(止め直しは silent の間しない)。
  // 【便CW 審査】silent はタップの外で立つので resume が効かないことがある。戻ったかをすぐに確かめ、running に戻らなければメトロノームを止める
  // (ON の表示のまま無音で残さない。次の START が既存の道で作り直す。板に js=webCtx: …)。列には積まない(列が詰まっていても確かめる)
  if ((st.held && st.held.length) || st.soloHeld) {
    webAudioRelease();
    webAudioCheckReleased().catch(() => {});
  }
  const m = AUDIO_DIAG.getMetro ? AUDIO_DIAG.getMetro() : null;
  audioDiagApplyMetroGain(m ? m.ctx : null, AUDIO_DIAG.metroGainX); // Web のマスターを戻す(silent の間は倍率を当てる)
}
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(label)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}
// クリックの3段を描き出して殻へ渡す(sampleRate が替わったときだけ描き直す)。描いた3段のピークは板の nativeBuf に出す。
// 失敗・無音は native.silent にして false を返す(呼び手は始めない)。
async function nativeEnsureLoaded(sampleRate, api, gen) {
  const st = AUDIO_DIAG.native;
  if (st.loadedRate === sampleRate) return true;
  if (!AUDIO_DIAG.renderClicks) { st.error = "load: no renderer"; nativeMarkSilent("render", gen); return false; }
  let r;
  try {
    r = await withTimeout(Promise.resolve(AUDIO_DIAG.renderClicks(sampleRate)), st.renderTimeoutMs ?? AUDIO_DIAG_RENDER_TIMEOUT_MS, "render timeout");
  } catch (e) {
    st.error = `render: ${e?.message || e}`;
    nativeMarkSilent("render", gen);
    return false;
  }
  st.bufPeaks = { rate: sampleRate, accent: absPeak(r.accent), beat: absPeak(r.beat), sub: absPeak(r.sub) };
  if (Math.min(st.bufPeaks.accent, st.bufPeaks.beat, st.bufPeaks.sub) < AUDIO_DIAG_MIN_CLICK_PEAK) {
    st.error = "render: silent buffer";
    nativeMarkSilent("buf", gen);
    return false;
  }
  let res;
  try {
    res = await api.load({
      sampleRate, accent: audioDiagFloat32ToBase64(r.accent), beat: audioDiagFloat32ToBase64(r.beat), sub: audioDiagFloat32ToBase64(r.sub),
    });
  } catch (e) { res = { error: String(e?.message || e) }; }
  if (!res || res.error) { st.error = `load: ${nativeErr(res) || "?"}`; nativeMarkSilent("load", gen); return false; }
  st.loadedRate = sampleRate;
  return true;
}
// 殻の予約が進んでいるかの見張り(板が1秒ごとに殻の状態を読むたびに呼ぶ)。メトロノームが鳴っていて、殻の予約の累計(ni.scheduled)が
// 最長の間隔の2倍(下限 AUDIO_DIAG_NATIVE_SILENT_MS)のあいだ進まなければ、silent("noSched")。止まっている間・殻の状態が読めない間は基準を取り直すだけ。
export function audioDiagCheckNativeSilence(ni, now = Date.now()) {
  const st = AUDIO_DIAG.native;
  if (AUDIO_DIAG.playback === "web" || st.silent) return;
  const m = AUDIO_DIAG.getMetro ? AUDIO_DIAG.getMetro() : null;
  const sched = ni && !ni.error && typeof ni.scheduled === "number" ? ni.scheduled : null;
  const pat = m && m.on && typeof m.clickPattern === "function" ? m.clickPattern() : null;
  if (!pat || sched === null) { st.watchAt = now; st.watchSched = sched; return; }
  if (sched !== st.watchSched) { st.watchSched = sched; st.watchAt = now; return; }
  if (now - st.watchAt >= Math.max(AUDIO_DIAG_NATIVE_SILENT_MS, nativeMaxGapMs(pat) * 2)) nativeMarkSilent("noSched");
}
// 1小節の並び(巡回)で、鳴らす音("silent" でない)と次の音の間の最長(ミリ秒)。鳴らす音が無ければ 0。
function nativeMaxGapMs(pat) {
  const idx = [];
  pat.kinds.forEach((k, i) => { if (k !== "silent") idx.push(i); });
  if (!idx.length) return 0;
  let gap = 0;
  for (let j = 0; j < idx.length; j++) {
    const next = j + 1 < idx.length ? idx[j + 1] : idx[0] + pat.kinds.length;
    gap = Math.max(gap, next - idx[j]);
  }
  return gap * pat.stepSec * 1000;
}
// 殻のクリックをメトロノームに合わせる(板が開いている間、ピークの読み取りと同じ間隔で呼ぶ)。
// 鳴っていれば今の設定の1小節の並びで開始(設定が変わったら渡し直す)、止まれば停止。計測タブを離れた・裏へ行ったら web に戻す。
export function audioDiagSyncNativeClick(api = SHELL_NATIVE) {
  if (AUDIO_DIAG.playback === "web") return;
  const st = AUDIO_DIAG.native;
  const m = AUDIO_DIAG.getMetro ? AUDIO_DIAG.getMetro() : null;
  if (!m || (typeof document !== "undefined" && document.hidden)) { audioDiagSetPlayback("web", api); return; }
  // 【便CW】nativeSolo の間は Web の音のセッションを非活性に保つ(START で作られた ctx・resume された ctx を止め直す・type を auto に)。silent の間はしない
  if (AUDIO_DIAG.playback === "nativeSolo" && st.soloHeld && !st.silent) webAudioHold();
  const want = m.on && m.ctx && typeof m.clickPattern === "function" ? m.clickPattern() : null;
  const rate = m.ctx ? m.ctx.sampleRate : null;
  const key = want ? JSON.stringify([rate, want.stepSec, want.kinds]) : null;
  if (key === st.clickKey) return;
  st.clickKey = key;
  const gen = st.gen; // この処理を始めたときの世代(選び直したあとの古い失敗を今の選びに掛けない)
  st.watchAt = Date.now(); st.watchSched = null; // 新しく始める(設定が変わった)ので、予約が進んでいるかの見張りの基準を取り直す
  nativeEnqueue(async () => {
    if (st.clickKey !== key) return; // 列で待っている間に替わった(鳴らし方を戻した等)
    if (!want) {
      const r = await api.stop();
      if (nativeErr(r)) st.error = `stop: ${nativeErr(r)}`;
      return;
    }
    if (!(await nativeEnsureLoaded(rate, api, gen))) return;
    if (st.clickKey !== key) return; // 描いている間に替わった(止めた・web に戻した)
    let r;
    try { r = await api.start({ stepSec: want.stepSec, kinds: want.kinds }); } catch (e) { r = { error: String(e?.message || e) }; }
    if (nativeErr(r)) { st.error = `start: ${nativeErr(r)}`; nativeMarkSilent("start", gen); }
  });
}
// 鳴らし方を選ぶ。同じものをもう一度押すと開き直す(殻は構成の変化・中断の終わりでは自分で作り直す〈便CV〉。ここは、作り直しを諦めた〈err=rebuild: loop・失敗 5 回〉ときの手動の再開)。
// 【便CU 審査】戻す道(web)は**殻のクリックを先に止めてから** Web の音を戻す(二重に鳴らさない): 列の先頭で nativeClickStop →
// 殻の取り込みを止める(nativeInputStop。殻はクリックが止まっているので鳴らし直さない)→ Web のマイクを戻す → Web のマスターを戻す。
// 戻すと決めた時点の ctx はその場でマスター 0 にし、殻のクリックを止め終わった時点で(そのときの ctx に)基の値 × 倍率を当て直す。
// 【便CU 再審査 統括の裁定 (a)】「止め終わるまで」の印は audioDiagApplyMetroGain の判定に入れない ── 列の前の処理(描き出し・前の restore・殻の呼び出し)が
// 終わらないと印が残り、以後の本番の START(startMetronome → audioDiagApplyMetroGain)が新しい ctx を 0 にしてメトロノームが無音になるため。
// 止め終わる前に START で作り直した ctx が殻と一瞬二重に鳴るのは、試し口の範囲として許す。
// opts.skipRestore: Web のマイクを戻さない(呼び手が自分で取る。録音の開始〈App.jsx の toggleRecording〉が使う)。
export function audioDiagSetPlayback(mode, api = SHELL_NATIVE, opts = {}) {
  if (!AUDIO_DIAG_PLAYBACKS.includes(mode)) return Promise.resolve();
  const st = AUDIO_DIAG.native;
  if (audioDiagWebMicStopped(mode) && (!AUDIO_DIAG.webMic || AUDIO_DIAG.webMic.recording())) {
    st.error = AUDIO_DIAG.webMic ? `${mode}: recording` : `${mode}: no web mic`;
    return Promise.resolve();
  }
  const prev = AUDIO_DIAG.playback;
  AUDIO_DIAG.playback = mode;
  st.clickKey = null;
  st.error = "";
  st.silent = ""; // 選び直すと、また殻の音が出ているかを見る(Web のマスターは 0 に戻る)
  st.gen = (st.gen || 0) + 1; // 古い処理(描き出しの時間切れ・load/start の失敗)が、この選びに silent を立てないようにする
  const gen = st.gen;
  st.watchAt = Date.now(); st.watchSched = null;
  // 【便CW】nativeSolo から離れるなら、止めた ctx の resume と type の戻しはその場で(iOS は resume にタップの中を求める)。Web のマスターは下で 0 のまま
  const leavingHold = holdsWebAudio(prev) && !holdsWebAudio(mode);
  if (leavingHold) webAudioRelease();
  const applyGain = () => {
    const m = AUDIO_DIAG.getMetro ? AUDIO_DIAG.getMetro() : null;
    audioDiagApplyMetroGain(m ? m.ctx : null, AUDIO_DIAG.metroGainX);
  };
  if (mode === "web" && prev !== "web") {
    // 戻すと決めた時点の ctx は、殻のクリックを止め終わるまで 0 のまま(二重に鳴らさない)
    const m = AUDIO_DIAG.getMetro ? AUDIO_DIAG.getMetro() : null;
    audioDiagApplyMetroGain(m ? m.ctx : null, 0);
  } else {
    // Web Audio のメトロノームのミュート(native の間はマスター 0)
    applyGain();
  }
  audioDiagResetPeak();
  return nativeEnqueue(async () => {
    if (mode === "web" && prev !== "web") {
      const r = await api.stop();
      if (nativeErr(r)) st.error = `stop: ${nativeErr(r)}`;
    }
    if (audioDiagWebMicStopped(prev) && !audioDiagWebMicStopped(mode)) {
      const r = await api.inStop();
      if (nativeErr(r)) st.error = `inStop: ${nativeErr(r)}`;
      if (AUDIO_DIAG.webMic && !opts.skipRestore) await AUDIO_DIAG.webMic.restore();
    }
    if (leavingHold) await webAudioCheckReleased(); // 【便CW】止めていた ctx が戻ったか(戻らなければメトロノームを止める)
    if (mode === "web") {
      if (AUDIO_DIAG.playback === "web") applyGain(); // 殻のクリックを止め終わってから Web のマスターを戻す
      return;
    }
    if (audioDiagWebMicStopped(mode)) {
      // 殻の取り込みを先に始める(Web の取り込みが動いている = 種別が playAndRecord の間に)。それから Web のマイクを止める。
      // 【便CU 審査】殻の取り込みが始められなかった(失敗を返した・投げた)ら、Web のマイクは止めず、鳴らし方を前の値に戻し、Web のマスターも戻す。
      // 開き直し(前も nativeBoth)で失敗したときは、Web のマイクはもう止まっているので戻し、殻のクリックだけの nativeClick にする
      let err = "";
      try { err = nativeErr(await api.inStart()); } catch (e) { err = String(e?.message || e); }
      if (err) {
        st.error = `inStart: ${err}`;
        if (AUDIO_DIAG.playback === mode && st.gen === gen) {
          AUDIO_DIAG.playback = audioDiagWebMicStopped(prev) ? "nativeClick" : prev;
          st.clickKey = null; // 列で待っているクリックの開始は捨てる(戻した鳴らし方で合わせ直す)
          if ((st.held && st.held.length) || st.soloHeld) webAudioRelease(); // 【便CW】押し直しの nativeSolo で失敗したら、止めていた Web の ctx も戻す
          applyGain();
          if (audioDiagWebMicStopped(prev) && AUDIO_DIAG.webMic) await AUDIO_DIAG.webMic.restore();
          await webAudioCheckReleased();
        }
        return;
      }
      if (AUDIO_DIAG.playback === mode && st.gen === gen && AUDIO_DIAG.webMic) AUDIO_DIAG.webMic.stop();
      // 【便CW】nativeSolo: 殻の取り込みが始まり Web のマイクを止めたあとで、Web の AudioContext を止め type を auto にする(古い世代では止めない)。
      // 止めるのは、この列のすぐあとの audioDiagSyncNativeClick(.then)と、板の 20ms ごとの合わせ(どちらも soloHeld を見て webAudioHold)
      if (mode === "nativeSolo" && AUDIO_DIAG.playback === "nativeSolo" && st.gen === gen) st.soloHeld = true;
    }
  }).then(() => { audioDiagSyncNativeClick(api); });
}

// 【便CT】メトロノームの ctx にマスターの倍率を当てる。鎖がまだ無ければ ctx に置くだけ(getMetroMasterInput が組むときに掛ける)、
// あれば今のマスターの節点に基の値 × 倍率を入れる(鳴らしている最中でも効く)。基の値と節点は App.jsx の getMetroMasterInput が ctx に置く。
// 【便CU】試し口「鳴らし方」が native の間は倍率の代わりに 0 を当てる(Web Audio のメトロノームのミュート。止めない)。web(既定)なら x のまま = 今までどおり。
export function audioDiagApplyMetroGain(ctx, x) {
  if (!ctx) return;
  // 【便CV】殻の音が出ていないと見なしたとき(native.silent)は、native のままでも Web のマスターを戻す(聞き比べができなくなるのを避ける)
  const eff = AUDIO_DIAG.playback === "web" || AUDIO_DIAG.native.silent ? x : 0;
  ctx.__metroDiagGainX = eff;
  const m = ctx.__metroMasterGain;
  if (m && ctx.__metroMasterBase > 0) m.gain.value = ctx.__metroMasterBase * eff;
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
// 【便CU】鳴らし方も web に戻す(選んでいなければ殻を1回も呼ばない)。
export function audioDiagResetTests(setMode = shellSetAudioTestMode, api = SHELL_NATIVE) {
  audioDiagSetMetroGain(1);
  const playback = AUDIO_DIAG.playback !== "web" ? audioDiagSetPlayback("web", api) : Promise.resolve();
  return Promise.all([audioDiagSetTestMode("default", setMode), playback]);
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
  // 【便CU】試し口「鳴らし方」(殻だけ)。nativeEngine = 殻の AVAudioEngine の状態(running か・act = このプロセスで setActive(true) かエンジンの start を一度でも成功させたか・クリック・取り込み・構成の変化の回数・最後のエラー。js= は JS 側の失敗)、
  // nativeBuf = 殻へ渡したクリックの3段のピーク(この端末の OfflineAudioContext で描いた値。Web の出口と同じ鎖)、nativeIn = 殻の取り込みの入力レベル(nativeBoth のとき)
  if (isNativeShell()) {
    const st = AUDIO_DIAG.native;
    const ni = st.info;
    rows.push(["playback", AUDIO_DIAG.playback]);
    rows.push(["nativeEngine", (ni === undefined ? "…"
      : !ni || ni.error ? `n/a (要ビルド: ${ni?.error ?? "?"})`
      : `running=${yn(ni.engineRunning)} act=${yn(ni.activated)} click=${yn(ni.clickOn)} in=${yn(ni.inputOn)} cfg=${ni.configChanges ?? 0} err=${ni.lastError || "—"}`)
      + (st.silent ? ` native=silent(${st.silent})` : "")
      + (st.error ? ` js=${st.error}` : "")]);
    // 【便CV】予約の様子: sched = 予約した累計個数・played = そのうち再生し終わった(.dataPlayedBack)累計個数(sched だけ増えて played が増えない = 予約したが再生されていない)・play = player.isPlaying・lrt = player.lastRenderTime が有効か・cfg = 構成の変化と中断の終わりの回数・
    // rb = 作り直しに成功した回数・tick = 直近の clickTick が早く返った理由(ok / idle / noEngine / notRunning / noPlayer / replay / noRender / noPlayerTime / badRate)
    rows.push(["nativeSched", ni && !ni.error
      ? `sched=${ni.scheduled ?? "—"} played=${ni.played ?? "—"} play=${yn(ni.playing)} lrt=${yn(ni.lastRender)} cfg=${ni.configChanges ?? 0} rb=${ni.rebuilds ?? 0} tick=${ni.tick ?? "—"}`
      : "—"]);
    const bp = st.bufPeaks;
    rows.push(["nativeBuf", bp ? `${bp.accent.toFixed(3)}/${bp.beat.toFixed(3)}/${bp.sub.toFixed(3)} @${bp.rate}` : "—"]);
    // 【便CW】Web の AudioContext の state(nativeSolo で止まっているか)。web.audioSession の行は上(今の navigator.audioSession.type)
    const micInfo = AUDIO_DIAG.getMic ? AUDIO_DIAG.getMic() : null;
    rows.push(["webCtx", `metro=${ctx ? ctx.state : "none"} mic=${micInfo ? micInfo.ctxState : "n/a"}`]);
    if (audioDiagWebMicStopped()) {
      rows.push(["nativeIn", ni && typeof ni.inputDb === "number" ? `${ni.inputDb.toFixed(1)} dBFS` : "—"]);
    }
  }
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
      // 【便CU】殻では殻の AVAudioEngine の状態も読む(読むだけ)。Web は読まない
      const nat = isNativeShell()
        ? shellNativeAudioInfo().then((ni) => { AUDIO_DIAG.native.info = ni; audioDiagCheckNativeSilence(ni); })
        : Promise.resolve();
      Promise.all([shellAudioSessionInfo(), nat]).then(([session]) => { if (alive) setRows(audioDiagRows(session)); });
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
      // 【便CU】鳴らし方が native の間、殻のクリックをメトロノームに合わせる(同じ間隔。web なら何もしない)
      audioDiagSyncNativeClick();
    };
    const pid = setInterval(readPeak, AUDIO_DIAG_PEAK_POLL_MS);
    // 【便CU】裏へ行ったら鳴らし方を web に戻す(殻のクリックと取り込みを止める。Web のマイクは戻ったときの既存の取り直しで戻る)
    const onHide = () => { if (document.hidden && AUDIO_DIAG.playback !== "web") audioDiagSetPlayback("web"); };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      alive = false; clearInterval(id); clearInterval(pid);
      document.removeEventListener("visibilitychange", onHide);
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
  // 【便CU】鳴らし方(殻だけ)。選んだら行を読み直す
  const shell = isNativeShell();
  const pickPlayback = (p) => {
    audioDiagSetPlayback(p)
      .then(() => Promise.all([shellAudioSessionInfo(), shellNativeAudioInfo().then((ni) => { AUDIO_DIAG.native.info = ni; })]))
      .then(([s]) => { setPick((n) => n + 1); setRows(audioDiagRows(s)); });
    setPick((n) => n + 1);
  };
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
      {/* 【便CU】鳴らし方(殻だけ。Web は出さない)。保存しない・閉じたら web に戻る */}
      {shell && (
        <div data-diag-test="playback" style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)", marginTop: "var(--sp-1)" }}>
          {AUDIO_DIAG_PLAYBACKS.map((p) => (
            <button key={p} type="button" className="sans" data-diag-playback={p}
              aria-pressed={AUDIO_DIAG.playback === p}
              style={pill(AUDIO_DIAG.playback === p)} onClick={() => pickPlayback(p)}>{p}</button>
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
