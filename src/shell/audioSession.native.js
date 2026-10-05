// 【殻 S2】自前のネイティブ部品 FicusAudioSession(ios/App/App/AppDelegate.swift の FicusAudioSessionPlugin)。
// 殻の枝(src/shell/audio.js の shellRouteToSpeaker)からだけ動的 import で読む。
import { registerPlugin } from "@capacitor/core";

const P = registerPlugin("FicusAudioSession");
export const routeToSpeaker = () => P.routeToSpeaker();
