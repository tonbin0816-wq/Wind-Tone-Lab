// 【殻 S2】自前のネイティブ部品 FicusAudioSession(ios/App/App/AppDelegate.swift の FicusAudioSessionPlugin)。
// 殻の枝(src/shell/audio.js)からだけ動的 import で読む。
import { registerPlugin } from "@capacitor/core";

const P = registerPlugin("FicusAudioSession");
// 【便CQ】診断の板が読む音のセッションの値(読むだけ。何も変えない)。殻のビルドが古いと UNIMPLEMENTED で拒否される。
export const sessionInfo = () => P.sessionInfo();
// 【便CX 2026-10-19】殻の計測の音(メトロノームとマイク)は殻の AVAudioEngine で扱う。src/shell/audio.js の shellNativeAudio からだけ呼ぶ。
// 殻のビルドが古いと UNIMPLEMENTED で拒否される。
export const micStart = (o) => P.micStart(o);
export const micStop = (o) => P.micStop(o);
export const metroLoad = (o) => P.metroLoad(o);
export const metroStart = (o) => P.metroStart(o);
export const metroUpdate = (o) => P.metroUpdate(o);
export const metroStop = (o) => P.metroStop(o);
export const audioClock = () => P.audioClock();
export const audioInfo = () => P.audioInfo();
// 殻からの知らせ("micData" / "metroClicks" / "audioState")の受け手の登録。答えは { remove() } の Promise。
// 【便CX】登録の書き換えは bridge の列で行われ、殻の知らせとは同期しないので、nativeAudio.js の nativeEvents が最初の1回だけ呼ぶ(外さない)
export const addListener = (event, fn) => P.addListener(event, fn);
