// 【殻 S2】自前のネイティブ部品 FicusAudioSession(ios/App/App/AppDelegate.swift の FicusAudioSessionPlugin)。
// 殻の枝(src/shell/audio.js の shellRouteToSpeaker)からだけ動的 import で読む。
import { registerPlugin } from "@capacitor/core";

const P = registerPlugin("FicusAudioSession");
export const routeToSpeaker = () => P.routeToSpeaker();
// 【便CQ】診断の板が読む音のセッションの値(読むだけ。何も変えない)。殻のビルドが古いと UNIMPLEMENTED で拒否される。
export const sessionInfo = () => P.sessionInfo();
