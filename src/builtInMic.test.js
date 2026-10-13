// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findBuiltInMic, trackIsDevice, preferBuiltInMicStream, trackLeftBuiltInMic, BUILT_IN_MIC_PORT_TYPE } from "./builtInMic.js";

// ------------------------------------------------------------------
// 【便CS 2026-10-13】マイクはいつも端末の内蔵マイク(src/builtInMic.js)。作り物の mediaDevices で確かめる。
// 【守っているもの】内蔵マイクの見分け(殻の名前の一致 / 指で触れる端末で iPhone・iPad・iPod を含む1件)・取り直しの制約
//   (元の audio の制約 + deviceId exact)・元のトラックを止める・見つからなければ取り直さない・取り直しの失敗の扱い。
// 【守っていないもの】実機の WebKit が deviceId exact を setPreferredInput に替えること・iOS が実際に内蔵マイクへ替えること・
//   出力が A2DP / スピーカーへ行くこと(どれも実機待ち)。
// ------------------------------------------------------------------
const MIC = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
const BT = { kind: "audioinput", deviceId: "bt-0001", label: "AirPods Pro", groupId: "g1" };
const BUILTIN = { kind: "audioinput", deviceId: "mic-0001", label: "iPhone マイク", groupId: "g2" };
const WIRED = { kind: "audioinput", deviceId: "wired-01", label: "ヘッドセットマイク", groupId: "g3" };

function makeTrack(dev, { withId = true } = {}) {
  return {
    kind: "audio", readyState: "live", enabled: true, muted: false, label: dev ? dev.label : "", stopped: 0,
    stop() { this.stopped += 1; this.readyState = "ended"; },
    getSettings() { return withId && dev ? { deviceId: dev.deviceId, ...MIC } : { ...MIC }; },
  };
}
const streamOf = (t) => ({ getTracks: () => [t], getAudioTracks: () => [t] });
function fakeMd(devices, { failExact = false, noEnumerate = false } = {}) {
  const md = {
    calls: [],
    async getUserMedia(c) {
      md.calls.push(c);
      const exact = c?.audio?.deviceId?.exact;
      if (exact && failExact) throw Object.assign(new Error("over"), { name: "OverconstrainedError" });
      const dev = exact ? devices.find((d) => d.deviceId === exact) : devices[0];
      return streamOf(makeTrack(dev));
    },
  };
  if (!noEnumerate) md.enumerateDevices = async () => devices.map((d) => ({ ...d }));
  return md;
}
const setTouch = (n) => Object.defineProperty(window.navigator, "maxTouchPoints", { value: n, configurable: true });
// iOS / iPadOS の WebKit の形: 指で触れる + navigator.audioSession(Audio Session API)
const setAudioSession = (on) => {
  if (on) Object.defineProperty(window.navigator, "audioSession", { value: { type: "auto" }, configurable: true });
  else { try { delete window.navigator.audioSession; } catch { /* */ } }
};

beforeEach(() => { setTouch(5); setAudioSession(true); });
afterEach(() => {
  try { delete window.navigator.maxTouchPoints; } catch { /* */ }
  setAudioSession(false);
});

describe("findBuiltInMic: 内蔵マイクの見分け", () => {
  it("指で触れる端末: label に iPhone / iPad / iPod を含む audioinput がちょうど1件ならそれ(言語に依らない)", () => {
    expect(findBuiltInMic([BT, BUILTIN, WIRED], null)).toEqual(BUILTIN);
    for (const label of ["iPhone Microphone", "Micro de l'iPhone", "iPad マイク", "iPhone麦克风"]) {
      expect(findBuiltInMic([BT, { ...BUILTIN, label }], null)?.deviceId).toBe("mic-0001");
    }
  });
  it("Mac(maxTouchPoints 0)では label で選ばない(Continuity の iPhone のマイクを選ばない)", () => {
    setTouch(0);
    expect(findBuiltInMic([{ ...BT, label: "MacBook Pro Microphone" }, BUILTIN], null)).toBe(null);
  });
  it("【便CS 審査】タッチ画面の Windows(maxTouchPoints 10・audioSession が無い)では、iPhone の名を含むヘッドセットを選ばない", () => {
    setTouch(10);
    setAudioSession(false);
    const win = [
      { kind: "audioinput", deviceId: "default", label: "Default - Microphone Array (Realtek(R) Audio)" },
      { kind: "audioinput", deviceId: "hfp-0001", label: "Headset (Taro's iPhone Hands-Free AG Audio)" },
      { kind: "audioinput", deviceId: "arr-0001", label: "Microphone Array (Realtek(R) Audio)" },
    ];
    expect(findBuiltInMic(win, null)).toBe(null);
    setAudioSession(true);                                            // 同じ並びでも iOS の WebKit の形なら label の道を通る(歯止めは audioSession)
    expect(findBuiltInMic(win, null)?.deviceId).toBe("hfp-0001");
  });
  it("殻: availableInputs の MicrophoneBuiltIn の名前と label がちょうど一致する1件(label に iPhone が無くても・Mac 判定に関係なく)", () => {
    setTouch(0);
    const shell = [{ portType: "BluetoothHFP", name: "AirPods Pro" }, { portType: BUILT_IN_MIC_PORT_TYPE, name: "内蔵のマイク" }];
    expect(findBuiltInMic([BT, { ...BUILTIN, label: "内蔵のマイク" }], shell)?.deviceId).toBe("mic-0001");
  });
  it("見つからない: 候補が2件・label が空(許可の前)・audioinput が無い・iPhone を含む label が無い", () => {
    expect(findBuiltInMic([BUILTIN, { ...BT, label: "iPhone用イヤホン" }], null)).toBe(null);
    expect(findBuiltInMic([{ ...BUILTIN, label: "" }], null)).toBe(null);
    expect(findBuiltInMic([{ ...BUILTIN, kind: "audiooutput" }], null)).toBe(null);
    expect(findBuiltInMic([BT, WIRED], null)).toBe(null);
    expect(findBuiltInMic(undefined, null)).toBe(null);
  });
  it("trackIsDevice: getSettings の deviceId で比べ、出ないときは label で比べる", () => {
    expect(trackIsDevice(makeTrack(BUILTIN), BUILTIN)).toBe(true);
    expect(trackIsDevice(makeTrack(BT), BUILTIN)).toBe(false);
    expect(trackIsDevice(makeTrack(BUILTIN, { withId: false }), BUILTIN)).toBe(true);
    expect(trackIsDevice(makeTrack(BT, { withId: false }), BUILTIN)).toBe(false);
  });
});

describe("preferBuiltInMicStream: 内蔵マイクの deviceId で取り直す", () => {
  it("いまのトラックが Bluetooth のマイク → 元の制約 + deviceId exact で取り直し、元のトラックを止めて新しい stream を返す", async () => {
    const md = fakeMd([BT, BUILTIN]);
    const first = await md.getUserMedia({ audio: MIC });
    const got = await preferBuiltInMicStream(md, first, MIC, null);
    expect(md.calls).toEqual([{ audio: MIC }, { audio: { ...MIC, deviceId: { exact: "mic-0001" } } }]);
    expect(got).not.toBe(first);
    expect(got.getAudioTracks()[0].label).toBe("iPhone マイク");
    expect(first.getAudioTracks()[0].stopped).toBe(1);
  });
  it("有線のヘッドセットのマイクでも内蔵マイクへ取り直す(統括の方針: 計測の質のため、常に内蔵マイク)", async () => {
    const md = fakeMd([WIRED, BUILTIN]);
    const got = await preferBuiltInMicStream(md, await md.getUserMedia({ audio: MIC }), MIC, null);
    expect(md.calls[1]).toEqual({ audio: { ...MIC, deviceId: { exact: "mic-0001" } } });
    expect(got.getAudioTracks()[0].label).toBe("iPhone マイク");
  });
  it("殻: 名前は getShellInputs(ネイティブの availableInputs)から読む", async () => {
    setTouch(0);
    const md = fakeMd([BT, { ...BUILTIN, label: "内蔵のマイク" }]);
    const shell = async () => [{ portType: BUILT_IN_MIC_PORT_TYPE, name: "内蔵のマイク" }];
    const got = await preferBuiltInMicStream(md, await md.getUserMedia({ audio: MIC }), MIC, shell);
    expect(md.calls.length).toBe(2);
    expect(got.getAudioTracks()[0].label).toBe("内蔵のマイク");
  });
  it("既に内蔵マイク → 取り直さない(同じ stream)", async () => {
    const md = fakeMd([BUILTIN, BT]);
    const first = await md.getUserMedia({ audio: MIC });
    expect(await preferBuiltInMicStream(md, first, MIC, null)).toBe(first);
    expect(md.calls.length).toBe(1);
  });
  it("見つからなければ今のまま(取り直さない): 内蔵マイクが無い・enumerateDevices が無い・Mac・stream が null", async () => {
    const md1 = fakeMd([BT, WIRED]);
    const s1 = await md1.getUserMedia({ audio: MIC });
    expect(await preferBuiltInMicStream(md1, s1, MIC, null)).toBe(s1);
    expect(md1.calls.length).toBe(1);
    const md2 = fakeMd([BT, BUILTIN], { noEnumerate: true });
    const s2 = await md2.getUserMedia({ audio: MIC });
    expect(await preferBuiltInMicStream(md2, s2, MIC, null)).toBe(s2);
    expect(md2.calls.length).toBe(1);
    setTouch(0);
    const md3 = fakeMd([BT, BUILTIN]);
    const s3 = await md3.getUserMedia({ audio: MIC });
    expect(await preferBuiltInMicStream(md3, s3, MIC, null)).toBe(s3);
    expect(md3.calls.length).toBe(1);
    expect(await preferBuiltInMicStream(md3, null, MIC, null)).toBe(null);
  });
  it("取り直しが失敗: 元のトラックが live なら元の stream。止まっていたら元の制約(deviceId 無し)でもう一度だけ取る", async () => {
    const md = fakeMd([BT, BUILTIN], { failExact: true });
    const first = await md.getUserMedia({ audio: MIC });
    expect(await preferBuiltInMicStream(md, first, MIC, null)).toBe(first);
    expect(first.getAudioTracks()[0].stopped).toBe(0);
    const muted = await md.getUserMedia({ audio: MIC });
    muted.getAudioTracks()[0].muted = true;                           // live のまま muted(WebKit bug 179363 / 192849)は使えない扱い
    md.calls.length = 0;
    const gotMuted = await preferBuiltInMicStream(md, muted, MIC, null);
    expect(md.calls).toEqual([{ audio: { ...MIC, deviceId: { exact: "mic-0001" } } }, { audio: MIC }]);
    expect(gotMuted).not.toBe(muted);
    const second = await md.getUserMedia({ audio: MIC });
    second.getAudioTracks()[0].readyState = "ended";
    md.calls.length = 0;
    const got = await preferBuiltInMicStream(md, second, MIC, null);
    expect(md.calls).toEqual([{ audio: { ...MIC, deviceId: { exact: "mic-0001" } } }, { audio: MIC }]);
    expect(got.getAudioTracks()[0].readyState).toBe("live");
  });
});

describe("trackLeftBuiltInMic: 取り込み中に内蔵マイクから外れたか", () => {
  it("外れた(Bluetooth)= true・内蔵 = false・見分けられない = false・止まったトラック = false", async () => {
    expect(await trackLeftBuiltInMic(fakeMd([BT, BUILTIN]), makeTrack(BT), null)).toBe(true);
    expect(await trackLeftBuiltInMic(fakeMd([BT, BUILTIN]), makeTrack(BUILTIN), null)).toBe(false);
    expect(await trackLeftBuiltInMic(fakeMd([BT, WIRED]), makeTrack(BT), null)).toBe(false);
    const ended = makeTrack(BT); ended.readyState = "ended";
    expect(await trackLeftBuiltInMic(fakeMd([BT, BUILTIN]), ended, null)).toBe(false);
  });
});
