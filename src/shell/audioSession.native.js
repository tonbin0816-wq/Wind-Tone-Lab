// 【殻 S2】自前のネイティブ部品 FicusAudioSession(ios/App/App/AppDelegate.swift の FicusAudioSessionPlugin)。
// 殻の枝(src/shell/audio.js の shellRouteToSpeaker)からだけ動的 import で読む。
import { registerPlugin } from "@capacitor/core";

const P = registerPlugin("FicusAudioSession");
export const routeToSpeaker = () => P.routeToSpeaker();
// 【便CQ】診断の板が読む音のセッションの値(読むだけ。何も変えない)。殻のビルドが古いと UNIMPLEMENTED で拒否される。
export const sessionInfo = () => P.sessionInfo();
// 【便CT】診断の板の試し口: モードを替えて聞き比べる(殻はメモリにだけ持つ。保存しない)。殻のビルドが古いと UNIMPLEMENTED で拒否される。
export const setTestMode = (mode) => P.setTestMode({ mode });
// 【便CU】診断の板の試し口「鳴らし方」: 殻の AVAudioEngine でクリックを鳴らす・マイクを取る(src/shell/audio.js の shellNative* からだけ呼ぶ)。殻のビルドが古いと UNIMPLEMENTED で拒否される。
export const nativeClickLoad = (o) => P.nativeClickLoad(o);
export const nativeClickStart = (o) => P.nativeClickStart(o);
export const nativeClickStop = () => P.nativeClickStop();
export const nativeInputStart = () => P.nativeInputStart();
export const nativeInputStop = () => P.nativeInputStop();
export const nativeAudioInfo = () => P.nativeAudioInfo();
