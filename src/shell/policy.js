// src/shell/policy.js ── 殻(Capacitor の iOS アプリ)での振る舞いの定数と純関数。
// Capacitor に触れないので Web からも静的に import してよい(殻の仕様 §1.2)。値を変えるならここの1か所だけ。

// 【殻 S2】計測タブを離れたときのマイク。Web は "pause"(接続を保つ。1fb310e の決まり)。殻は "stop"(解放。橙の印が消える)。
// 殻では Capacitor が WebKit の許可を自動で通すので、getUserMedia を呼び直しても OS の許可は最初の1回だけ(殻の仕様 §4.3)。
// 殻で止めると許可の直後に固まる(Web の C12 の再来)なら、この定数を false にして Web と同じ振る舞いへ戻す(1か所)。
export const SHELL_STOP_MIC_ON_TAB_LEAVE = true;
export function micActionOnTabLeave(native, stopOnLeave = SHELL_STOP_MIC_ON_TAB_LEAVE) {
  return native && stopOnLeave ? "stop" : "pause";
}

// 【殻 S2】殻のメトロノームのマスターゲイン。殻はネイティブで出口をスピーカーへ回す(FicusAudioSession)ので 1.0 から始める。
// 実機でまだ小さいなら 2.6 にして再ビルド(殻の仕様 §4.4)。Web の 2.6 は App.jsx の getMetroMasterInput の行が唯一の答え
// (D-24 §1.5 の凍結値。ここに写しを持たない)。殻の値は startMetronome が ctx に置き、getMetroMasterInput が読む。
export const METRO_MASTER_GAIN_SHELL = 1.0;

// 【殻 S3】広告の帯(AdMob のバナー)の下端は、下部タブの上端からすき間 gap(= --sp-2。押せない・地は塗らない)だけ上。
// 【殻 S3 統括の裁定】帯を下部タブにすき間なく接して置くのは、AdMob が誤クリックを招くとして避けるよう求める置き方
// (https://support.google.com/admob/answer/6275345)。プラグインの margin は「下端からの距離」(pt = CSS px)。
// AD_MARGIN_MODE "safe-area" = 安全域の下端から / "screen" = 画面の下端から。
// 既定は "safe-area": @capacitor-community/admob 8.1.0 の iOS(ios/Sources/AdMobPlugin/Banner/BannerExecutor.swift の
// bannerViewDidReceiveAd)は帯の .bottom を rootViewController.view.safeAreaLayoutGuide の .bottom に
// constant = -margin で結ぶ ── margin は安全域の下端から数える。"screen" の値を渡すと帯がホームバーの高さ(inset)ぶん浮く。
// 実機で帯と下部タブの間が --sp-2 のすき間より広い(ホームバーの高さぶん浮く)・重なるなら、ここを "screen" に替えて再ビルド(1か所)。
export const AD_MARGIN_MODE = "safe-area";
export function adBannerMargin({ innerHeight, navTop, inset = 0, gap = 0, mode = AD_MARGIN_MODE }) {
  const m = Math.max(0, Math.round(innerHeight - navTop));
  return (mode === "safe-area" ? Math.max(0, m - inset) : m) + Math.max(0, Math.round(gap));
}
// 最初の広告が来るまでの帯の高さの仮の値(アンカー型アダプティブの iPhone の実寸は 50 前後)。来たら実寸(SizeChanged)で上書きする。
export const AD_H_INITIAL_PX = 50;
// 【殻 S3 統括の裁定】iPad を回したとき、アダプティブの帯の幅は showBanner のときの1回だけ決まるので、幅が変わったら帯を取り直す。
// resize は続けて来るので、最後の1回から AD_RELOAD_DEBOUNCE_MS 待ってから1回だけ取り直す(間引き)。
// 300 は App.jsx の useFillViewportHeight が「フォント読込等の後に測り直す」のに使っている待ちと同じ値。
export const AD_RELOAD_DEBOUNCE_MS = 300;
// 【殻 S3 統括の裁定】ATT を尋ねても未決定のまま返ったとき(マイクの許可の画面の直後で、アプリがまだ前面に戻り切っていない)、
// 画面が見えてフォーカスが戻るのを待ってから、この時間おいて1回だけ尋ね直す。
export const ATT_RETRY_DELAY_MS = 1500;
// 【殻 S3 統括の裁定】その「見えていてフォーカスがある」状態を待つのはこの時間まで。過ぎたら尋ね直さない(次の起動でまた尋ねる)。
// WKWebView で document.hasFocus() が true にならない端末があっても、尋ね直しの待ちが残り続けないように。
// 【便CH】同意の画面の「次へ」の直後に ATT を尋ねるとき、答えを待ってアプリ本体へ進むまでの上限にも使う(ads.js の shellAskTrackingAfterConsent)。
export const ATT_FOCUS_WAIT_MAX_MS = 10000;
