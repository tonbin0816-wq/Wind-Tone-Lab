// src/builtInMic.js ── 【便CS 2026-10-13】マイクは、つないでいる機器にかかわらず、いつも端末の内蔵マイクを使う(Web と殻の両方)。
//
// 本人の実機の診断の板(Bluetooth のイヤホンをつないだ iPhone)で in = BluetoothHFP / out = BluetoothHFP / outputVolume 0.15。
// WebKit はマイクを取るとき、既定の機器(= 音のセッションのいまの入力)を取る。Bluetooth のイヤホンがつながっていると、
// それはイヤホンのマイク(HFP)になり、出力も HFP(通話の経路・狭い帯域・通話の音量)に引きずられる。計測の音も HFP の狭い帯域になる。
//
// WebKit の取り込み機器の選び方(WebKit main。Source/WebCore/platform/mediastream/ios/AVAudioSessionCaptureDeviceManager.mm・
// cocoa/CoreAudioCaptureUnit.cpp・cocoa/BaseAudioCaptureUnit.cpp):
//   ・機器の一覧は availableInputs(WebKit は AllowBluetooth を付けた補助のセッションで読むので、HFP のマイクも並ぶ)。
//     label は portName、deviceId は port の UID を塩でハッシュしたもの。既定(isDefault)は currentRoute.inputs の先頭で、一覧の先頭に並ぶ。
//   ・取り込みの機器が決まると captureDeviceChanged で setPreferredMicrophoneID(既定の機器なら空 / それ以外はその UID)
//     → AVAudioSession.sharedInstance の setPreferredInput(UID が一致する port。空なら nil)。
//     つまり deviceId exact で既定でない機器を選べば、WebKit 自身が setPreferredInput でその port を求める。
//     **既定の機器を選んだときは nil を求める**(iOS に任せる)ので、あとからイヤホンをつなぐと入力が替わりうる → 下の「替わったら取り直す」。
//   ・取り込み中にいまの入力が替わると、トラックの label / deviceId が新しい入力に替わり、configurationchange が出る。
//
// 内蔵マイクの見分け(ラベルの言語に頼らない順):
//   1. 殻: ネイティブの sessionInfo が返す availableInputs の portType が "MicrophoneBuiltIn"(AVAudioSessionPortBuiltInMic の生の値。
//      言語に依らない)の portName と、label がちょうど一致する1件。
//   2. Web(iOS / iPadOS の WebKit だけ): label に端末の種類の名前 iPhone / iPad / iPod を含む audioinput がちょうど1件(「iPhone マイク」
//      「iPhone Microphone」「Micro de l'iPhone」など。端末の種類の名前は翻訳されない)。WebKit は portType も UID も
//      ページへ出さない(deviceId はハッシュ)ので、Web で使える手がかりは label だけ。
//   どちらも当たらなければ null(= 今のまま。取り直さない)。
// AVAudioSession.Port.builtInMic の生の値(殻の sessionInfo の availableInputs[].portType と比べる)
export const BUILT_IN_MIC_PORT_TYPE = "MicrophoneBuiltIn";
const DEVICE_FAMILY_RE = /\b(?:iPhone|iPad|iPod)\b/;

// devices: enumerateDevices の答え。shellInputs: 殻の availableInputs([{ portType, name }])。Web は null。
// nav: Web の見分けを iOS / iPadOS の WebKit に限るための navigator。条件は2つ:
//   ・指で触れる端末(maxTouchPoints > 1)── Mac は 0。Mac のブラウザで Continuity の「iPhone のマイク」を選ばないため
//   ・"audioSession" in navigator(Audio Session API。WebKit だけが持つ)── タッチ画面の Windows(maxTouchPoints 10 等)で
//     「Headset (Taro's iPhone Hands-Free AG Audio)」のような、iPhone の名を含む Bluetooth のヘッドセットを選ばないため(【便CS 審査】)
// UA は読まない(UA を読む行は pitch-test K.2 が既存の2行に固定している)。
export function findBuiltInMic(devices, shellInputs, nav = typeof navigator !== "undefined" ? navigator : null) {
  const inputs = (Array.isArray(devices) ? devices : []).filter((d) => d && d.kind === "audioinput" && d.deviceId && d.label);
  if (!inputs.length) return null;
  const shellName = (Array.isArray(shellInputs) ? shellInputs : []).find((p) => p && p.portType === BUILT_IN_MIC_PORT_TYPE)?.name;
  if (shellName) {
    const hit = inputs.filter((d) => d.label === shellName);
    if (hit.length === 1) return hit[0];
  }
  if (!nav || !(Number(nav.maxTouchPoints) > 1) || !("audioSession" in nav)) return null;
  const family = inputs.filter((d) => DEVICE_FAMILY_RE.test(d.label));
  return family.length === 1 ? family[0] : null;
}

// いまのトラックがその機器か(getSettings の deviceId で比べる。出ない環境では label で比べる)
export function trackIsDevice(track, device) {
  if (!track || !device) return false;
  let id = null;
  try { id = typeof track.getSettings === "function" ? track.getSettings()?.deviceId : null; } catch { id = null; }
  if (id) return id === device.deviceId;
  return !!track.label && track.label === device.label;
}

const firstAudioTrack = (stream) => {
  try { return stream?.getAudioTracks?.()[0] || null; } catch { return null; }
};
const stopAll = (stream) => {
  try { stream?.getTracks?.().forEach((t) => t.stop()); } catch { /* noop */ }
};

// 内蔵マイクを探す(許可が取れた後に呼ぶ ── 許可の前は label が空で見分けられない)。
// 戻り値: { device, devices }。見つからなければ device は null。enumerateDevices が無い・失敗したときも null。
export async function lookupBuiltInMic(md, getShellInputs) {
  if (!md || typeof md.enumerateDevices !== "function") return { device: null, devices: [] };
  let devices = [];
  try { devices = await md.enumerateDevices(); } catch { return { device: null, devices: [] }; }
  const labeled = (Array.isArray(devices) ? devices : []).filter((d) => d && d.kind === "audioinput" && d.label);
  if (!labeled.length) return { device: null, devices };
  let shellInputs = null;
  if (typeof getShellInputs === "function") {
    try { shellInputs = await getShellInputs(); } catch { shellInputs = null; }
  }
  return { device: findBuiltInMic(devices, shellInputs), devices };
}

// getUserMedia で取った stream を、内蔵マイクのものへ寄せる。
//   ・内蔵マイクが見つからない / 既にそれを使っている → stream をそのまま返す(今のまま)
//   ・違う → audio の制約はそのまま(ec/ns/agc を変えない)に deviceId: { exact } を足して取り直し、元のトラックは止める
//   ・取り直しが失敗 → 元の stream が使える(live かつ muted でない。WebKit は他の取り込みが始まると古いトラックを live のまま
//     muted にすることがある ── WebKit bug 179363 / 192849)ならそれを返す。使えなければ元の制約でもう一度だけ取る(失敗はそのまま投げる)
export async function preferBuiltInMicStream(md, stream, audioConstraints, getShellInputs) {
  const track = firstAudioTrack(stream);
  if (!track) return stream;
  const { device } = await lookupBuiltInMic(md, getShellInputs);
  if (!device || trackIsDevice(track, device)) return stream;
  let next = null;
  try {
    next = await md.getUserMedia({ audio: { ...audioConstraints, deviceId: { exact: device.deviceId } } });
  } catch { next = null; }
  if (next && firstAudioTrack(next)) {
    if (next !== stream) stopAll(stream);
    return next;
  }
  if (track.readyState === "live" && !track.muted) return stream;
  return md.getUserMedia({ audio: { ...audioConstraints } });
}

// 取り込み中に、いまのトラックが内蔵マイクから外れたか(Web で「替わったら取り直す」の判定)。
// 見つからない(= Web で見分けられない)ときは外れていない扱い(今のまま)。
export async function trackLeftBuiltInMic(md, track, getShellInputs) {
  if (!track || track.readyState !== "live") return false;
  const { device } = await lookupBuiltInMic(md, getShellInputs);
  if (!device) return false;
  return !trackIsDevice(track, device);
}
