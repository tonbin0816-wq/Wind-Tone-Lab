import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ringMinDiameter, ringFitArgs, fitRingDiameter, nextRingDiameter, ringScale } from "./measureRingFit.js";

// ------------------------------------------------------------------
// 【便BM 2026-10-02 本人裁定(a)】計測タブで、画面の高さが足りないときだけ環(メーター)を縮めて全部を収める。
// 【便BM 差し戻し】統括裁定1(画面ごとに1回・いちばん厳しい状態で決める)/ 裁定2(visualViewport の縮みでは
// 合わせ直さない・フォーカス中とシート中は据え置く)/ 裁定3(字の倍率の基準は縮めないときの直径)。
//   ・足りるときは縮めない(縮めないときの直径 maxD をそのまま返す = 375×812 帯なしは 330)
//   ・足りないときは足りない分だけ縮める(切り捨て。端数で 1px はみ出さない)
//   ・下限: 環の中のいちばん小さい字(セント値 21px)が §4.2「演奏中サーフェスの最小は15px」を割らない直径(本人裁定で 236)
//   ・据え置き(録音中・入力欄・シート・ピンチ拡大)
// 期待値はここに手で書いた数(定数から逆算しない)。境界は、丸め方・不等号の向きを間違えると答えが変わる値で書く。
// 【守っていないもの】実寸(jsdom は配置を計算しない)。375×667 / 375×812 の実測は報告に書いた。
// ------------------------------------------------------------------

const FULL = 330;
const MIN = 236;

describe("ringMinDiameter(下限)", () => {
  it("330 の環でセント値 21px を 15px で止める直径は 236(330×15/21 = 235.71… を切り上げ)", () => {
    expect(ringMinDiameter(330, 21, 15)).toBe(236);
  });
  it("切り上げなので、下限でもセント値は 15px を割らない / 1つ小さいと割る", () => {
    const d = ringMinDiameter(330, 21, 15);
    expect((d * 21) / 330).toBeGreaterThanOrEqual(15);
    expect(((d - 1) * 21) / 330).toBeLessThan(15);
  });
});

describe("ringFitArgs(測った値 → fitRingDiameter の引数)", () => {
  it("812(実測): 使える高さ 761・枠 761・スペーサー 78・環 330 → 環以外 353 → 330(縮めない)", () => {
    const a = ringFitArgs({ availH: 761, frameH: 761, spacerH: 78, ringH: 330, boxW: 347, fullD: FULL, minD: MIN });
    expect(a.othersH).toBe(353);
    expect(a.maxD).toBe(330);
    expect(fitRingDiameter(a)).toBe(330);
  });
  it("667(審査の実測): 使える高さ 616・枠 683・スペーサー 0・環 330 → 環以外 353 → 263", () => {
    const a = ringFitArgs({ availH: 616, frameH: 683, spacerH: 0, ringH: 330, boxW: 347, fullD: FULL, minD: MIN });
    expect(a.othersH).toBe(353);
    expect(fitRingDiameter(a)).toBe(263);
  });
  it("どの欄も別々に効く(足す欄・引く欄を取り違えると 416 にならない)", () => {
    // 700 − 10 − 300 − 20 − 100 + 125 + 21 = 416
    const a = ringFitArgs({
      availH: 800, frameH: 700, spacerH: 10, ringH: 300, boxW: 347,
      volumeH: 20, middleH: 100, worstMiddleH: 125, worstVolumeH: 21, fullD: FULL, minD: MIN,
    });
    expect(a.othersH).toBe(416);
  });
  it("いちばん厳しい状態に入れ替える: メトロノームを閉じて音量も出していない今でも、開いて出したときの高さで比べる", () => {
    // 今: これまでの音 100・音量なし。いちばん厳しい: メトロノームの行 124.58・音量 21
    const now = ringFitArgs({ availH: 616, frameH: 683, spacerH: 0, ringH: 330, boxW: 347, middleH: 100, worstMiddleH: 124.58, worstVolumeH: 21, fullD: FULL, minD: MIN });
    // 開いて音量も出しているとき(今 = いちばん厳しい)
    const worst = ringFitArgs({ availH: 616, frameH: 728.58, spacerH: 0, ringH: 330, boxW: 347, volumeH: 21, middleH: 124.58, worstMiddleH: 124.58, worstVolumeH: 21, fullD: FULL, minD: MIN });
    expect(now.othersH).toBeCloseTo(398.58, 9);
    expect(worst.othersH).toBeCloseTo(398.58, 9);
    expect(fitRingDiameter(now)).toBe(fitRingDiameter(worst));
  });
  it("縮めないときの直径 maxD は min(330, 環の箱の幅)", () => {
    expect(ringFitArgs({ availH: 1, frameH: 0, spacerH: 0, ringH: 0, boxW: 292, fullD: FULL, minD: MIN }).maxD).toBe(292);
    expect(ringFitArgs({ availH: 1, frameH: 0, spacerH: 0, ringH: 0, boxW: 347, fullD: FULL, minD: MIN }).maxD).toBe(330);
  });
});

describe("fitRingDiameter(収まる直径)", () => {
  const base = { maxD: 330, fullD: FULL, minD: MIN };
  it("足りるときは縮めない(余りがあっても大きくはしない)", () => {
    expect(fitRingDiameter({ ...base, availH: 700, othersH: 300 })).toBe(330);
    expect(fitRingDiameter({ ...base, availH: 2000, othersH: 300 })).toBe(330);
  });
  it("ちょうど足りる(room = maxD)ときも縮めない", () => {
    expect(fitRingDiameter({ ...base, availH: 630, othersH: 300 })).toBe(330);
    expect(fitRingDiameter({ availH: 592, othersH: 300, maxD: 292, fullD: FULL, minD: MIN })).toBe(292);
  });
  it("境界の不等号: 端数の maxD でちょうど足りるときは maxD のまま(> にすると切り捨てて 291 になる)", () => {
    expect(fitRingDiameter({ availH: 591.5, othersH: 300, maxD: 291.5, fullD: FULL, minD: MIN })).toBe(291.5);
  });
  it("枠が狭い画面で足りるときは maxD(環の箱の幅)を返す", () => {
    expect(fitRingDiameter({ availH: 700, othersH: 300, maxD: 292, fullD: FULL, minD: MIN })).toBe(292);
  });
  it("足りない分だけ縮める(1px 足りない → 329 / 67px 足りない → 263)", () => {
    expect(fitRingDiameter({ ...base, availH: 629, othersH: 300 })).toBe(329);
    expect(fitRingDiameter({ ...base, availH: 563, othersH: 300 })).toBe(263);
    expect(fitRingDiameter({ availH: 591, othersH: 300, maxD: 292, fullD: FULL, minD: MIN })).toBe(291);
  });
  it("端数は切り捨てる(room 238.6 → 238。四捨五入・切り上げなら 239)", () => {
    expect(fitRingDiameter({ ...base, availH: 538.6, othersH: 300 })).toBe(238);
    expect(fitRingDiameter({ ...base, availH: 600, othersH: 361.58 })).toBe(238);
  });
  it("下限で止まる(残りはスクロール)", () => {
    expect(fitRingDiameter({ ...base, availH: 500, othersH: 300 })).toBe(236);
    expect(fitRingDiameter({ ...base, availH: 300, othersH: 300 })).toBe(236);
    expect(fitRingDiameter({ ...base, availH: 100, othersH: 300 })).toBe(236);
  });
  it("下限の前後(room 236.6 → 236 / 237.9 → 237)", () => {
    expect(fitRingDiameter({ ...base, availH: 536.6, othersH: 300 })).toBe(236);
    expect(fitRingDiameter({ ...base, availH: 537.9, othersH: 300 })).toBe(237);
  });
  it("まだ測れていない(使える高さ 0 / 数でない)ときは縮めない", () => {
    expect(fitRingDiameter({ ...base, availH: 0, othersH: 300 })).toBe(330);
    expect(fitRingDiameter({ ...base, availH: NaN, othersH: 300 })).toBe(330);
    expect(fitRingDiameter({ ...base, availH: 600, othersH: NaN })).toBe(330);
  });
});

describe("nextRingDiameter(据え置き)", () => {
  it("据え置き中は前の直径のまま", () => {
    expect(nextRingDiameter(263, 238, true)).toBe(263);
    expect(nextRingDiameter(330, 236, true)).toBe(330);
  });
  it("据え置きでなければ新しい直径", () => {
    expect(nextRingDiameter(263, 238, false)).toBe(238);
    expect(nextRingDiameter(236, 330, false)).toBe(330);
  });
});

describe("ringScale(中の字の倍率。基準は縮めないときの直径)", () => {
  it("縮めていないときはちょうど 1(375 幅でも 320 幅でも)", () => {
    expect(ringScale(330, 330)).toBe(1);
    expect(ringScale(292, 292)).toBe(1);
    expect(148 * ringScale(330, 330)).toBe(148);
  });
  it("320 幅(縮めないとき 292)で 1px 縮めても字は跳ねない(292 基準の比)", () => {
    expect(ringScale(291, 292)).toBeCloseTo(291 / 292, 12);
    expect(148 * ringScale(291, 292)).toBeGreaterThan(147.4);
  });
  it("縮めたときは直径の比(236 → セント値 15.02px・音名 105.8px)", () => {
    expect(21 * ringScale(236, 330)).toBeCloseTo(15.018, 3);
    expect(148 * ringScale(236, 330)).toBeCloseTo(105.84, 2);
  });
});

// ------------------------------------------------------------------
// 計測タブへの配線(綴り)。純関数が正しくても、呼ばれていなければ何も守らない。
// ------------------------------------------------------------------
describe("計測タブの配線(App.jsx)", () => {
  const src = readFileSync(join(process.cwd(), "src", "App.jsx"), "utf8");
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
  const measStart = src.indexOf("function MeasureView(");
  const meas = src.slice(measStart, src.indexOf("\nfunction ", measStart + 10));
  const effAt = meas.indexOf("const args = ringFitArgs({");
  const effStart = meas.lastIndexOf("useLayoutEffect(", effAt);
  const eff = meas.slice(effStart, meas.indexOf("]);", effAt) + 3);

  it("下限は RING_D_FULL・セント値・15px から導く(数を直書きしない)", () => {
    expect(/const RING_D_MIN = ringMinDiameter\(RING_D_FULL, NOTE_CENTS_PX, RING_TEXT_FLOOR_PX\);/.test(src)).toBe(true);
  });
  it("15px は --fs-md の値(index.css から読む)", () => {
    const m = src.match(/const RING_TEXT_FLOOR_PX = (\d+);/);
    const fsMd = css.match(/--fs-md:\s*(\d+)px;/);
    expect(m && fsMd).toBeTruthy();
    expect(Number(m[1])).toBe(Number(fsMd[1]));
  });
  it("環の直径は ringD、字の倍率の基準は ringBaseD で渡す(初期値はどちらも RING_D_FULL)", () => {
    expect(meas.includes("<PitchRing note={note} centsOffset={centsOffset} diameter={ringD} scaleBase={ringBaseD} />")).toBe(true);
    expect(meas.includes("const [ringD, setRingD] = useState(RING_D_FULL);")).toBe(true);
    expect(meas.includes("const [ringBaseD, setRingBaseD] = useState(RING_D_FULL);")).toBe(true);
    expect(src.includes("const ringK = ringScale(diameter, scaleBase);")).toBe(true);
  });
  it("縮める計算は描く前(useLayoutEffect)。依存は「画面の寸法・据え置きの合図2つ・リードの行2つ」の5つちょうど", () => {
    expect(effAt).toBeGreaterThan(0);
    expect(effStart).toBeGreaterThan(0);
    expect(eff.endsWith("}, [ringFitLayout.key, ringFitLayout.hold, ringFitHoldNow, reedEmptyGuide, ringFitBoxHint]);")).toBe(true);
  });
  it("据え置き = 録音中・シート・ピッカー・テンポのシート + 入力欄/ピンチ(その場で ringFitHold() を読む)", () => {
    expect(meas.includes("const ringFitHoldNow = isRecording || anySheetOpen || openPicker !== null || tempoSheetOpen;")).toBe(true);
    expect(eff.includes("const held = ringFitHoldNow || ringFitHold();")).toBe(true);
    expect(eff.includes("setRingD((prev) => nextRingDiameter(prev, fit, held));")).toBe(true);
    expect(eff.includes("setRingBaseD((prev) => nextRingDiameter(prev, args.maxD, held));")).toBe(true);
    expect(meas.includes("const ringFitBoxHint = !reedEmptyGuide && !selectedBoxGroup;")).toBe(true);
  });
  it("測った値の写し(各欄がどの要素から来るか)", () => {
    for (const line of [
      "const ringEl = ringBox?.firstElementChild;",
      "const availH = fillViewportMinHeight(frame.getBoundingClientRect().top, scrollY, resolveSmallViewportHeight(), resolveBottomGap());",
      "frameH: hOf(frame),",
      "spacerH: hOf(spacer),",
      "ringH,",
      "boxW: ringBox.getBoundingClientRect().width,",
      "volumeH: hOf(ringBox) - ringH,",
      "middleH: hOf(middle),",
      "worstMiddleH: hOf(worstMiddle),",
      "worstVolumeH: hOf(worstVolume),",
      "fullD: RING_D_FULL,",
      "minD: RING_D_MIN,",
      "const fit = fitRingDiameter(args);",
    ]) {
      expect(eff.includes(line), line).toBe(true);
    }
    // 使える高さに visualViewport を使わない(統括裁定2)
    expect(eff.includes("visibleViewportHeight")).toBe(false);
    expect(eff.includes("visualViewport")).toBe(false);
    expect(eff.includes("window.innerHeight")).toBe(false);
  });
  it("合わせ直す入力の鍵は 100svh・innerWidth・向き・帯。innerHeight と visualViewport の高さは鍵に入れない(再審査 3)", () => {
    const k = src.slice(src.indexOf("function ringFitLayoutKey()"), src.indexOf("function ringFitHold()"));
    expect(k.includes("resolveSmallViewportHeight()")).toBe(true);
    expect(k.includes("innerHeight")).toBe(false);
    const sv = src.slice(src.indexOf("function resolveSmallViewportHeight()"), src.indexOf("function ringFitLayoutKey()"));
    expect(sv.includes("height:100svh")).toBe(true);
    expect(sv.includes("return h > 0 ? h : window.innerHeight;")).toBe(true);
    expect(k.includes("window.innerWidth")).toBe(true);
    expect(k.includes("screen.orientation")).toBe(true);
    expect(k.includes('hasAttribute("data-ad-preview")')).toBe(true);
    expect(k.includes("visualViewport")).toBe(false);
    const h = src.slice(src.indexOf("function ringFitHold()"), src.indexOf("function useRingFitLayout()"));
    expect(h.includes('a.tagName === "INPUT" || a.tagName === "TEXTAREA"')).toBe(true);
    expect(h.includes("return typing || scale > 1;")).toBe(true);
  });
  it("測る相手(枠・スペーサー・環の箱・可変の中間)に ref が付いている", () => {
    expect(meas.includes("<div ref={measureFrameRef} style={{ position: \"relative\", display: \"flex\", flexDirection: \"column\", minHeight: measureMinH || undefined }}>")).toBe(true);
    expect(meas.includes("<div ref={ringFitSpacerRef} style={{ flex: \"1 1 auto\", minHeight: 0 }} />")).toBe(true);
    expect(/<div ref=\{ringBoxRef\} style=\{\{ flexShrink: 0 \}\}>\s*<PitchRing/.test(meas)).toBe(true);
    expect(meas.includes("<div ref={ringFitMiddleRef} style={{ display: \"flex\", flexDirection: \"column\" }}>")).toBe(true);
  });
  it("【再審査】本物のテンポ行の高さ = 見本の高さ(METRO_PM_H_CSS)。高さに効く値を全部数え、数でも確かめる", () => {
    const rowOpen = 'className="tap-through" style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: METRO_PM_GAP_CSS }}>';
    const rs = meas.indexOf(rowOpen);
    expect(rs).toBeGreaterThan(0);
    const row = meas.slice(rs + rowOpen.length, meas.indexOf("</div>", rs));
    const styles = [...row.matchAll(/style=\{\{([^}]*)\}\}/g)].map((m) => m[1]);
    expect(styles.length).toBe(3); // − / ♩=n / ＋
    // 高さに効くプロパティだけを抜き出す(足し忘れ・書き換えを両方拾うため、完全一致で比べる)
    const KEYS = /\b(height|minHeight|maxHeight|padding|paddingTop|paddingBottom|margin|marginTop|marginBottom|border|borderTop|borderBottom|lineHeight|fontSize|boxSizing)\b\s*:\s*([^,]+)/g;
    const pick = (st) => [...st.matchAll(KEYS)].map((m) => `${m[1]}=${m[2].trim()}`).join(" ");
    const pm = "height=METRO_PM_H_CSS border=\"none\" padding=0 fontSize=METRO_PM_FS_CSS lineHeight=1";
    expect(styles.map(pick)).toEqual([
      pm,
      "minHeight=\"var(--tap-min)\" border=\"none\" fontSize=METRO_BPM_FS_CSS padding=0 lineHeight=1",
      pm,
    ]);
    // 数: ♩=n の最小の高さ(--tap-min)も字の高さも、− / ＋ の高さ(METRO_PM_H × METRO_SCALE)を越えない
    const num = (re) => Number((src.match(re) || [])[1]);
    const H = num(/const METRO_PM_H = (\d+(?:\.\d+)?);/) * num(/const METRO_SCALE = (\d+(?:\.\d+)?);/);
    const tapMin = Number((css.match(/--tap-min:\s*(\d+)px;/) || [])[1]);
    expect(H).toBeGreaterThan(0);
    expect(tapMin).toBeGreaterThan(0);
    expect(tapMin).toBeLessThanOrEqual(H);
    expect(num(/const METRO_BPM_FS = (\d+);/) * num(/const METRO_SCALE = (\d+(?:\.\d+)?);/)).toBeLessThanOrEqual(H);
    expect(num(/const METRO_PM_FS = (\d+);/) * num(/const METRO_SCALE = (\d+(?:\.\d+)?);/)).toBeLessThanOrEqual(H);
  });
  it("いちばん厳しい状態の見本は本物と同じ style の文字列(ずれたら落ちる)", () => {
    const volStyle = 'style={{ marginTop: "var(--sp-1)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-num)", fontSize: 12, color: "var(--c-ink-3)" }}';
    // 本物(showVolume の行)と見本の2つ
    expect(meas.split(volStyle).length - 1).toBe(2);
    expect(meas.includes(volStyle + ">0.0dB</div>")).toBe(true);
    const metroStyle = 'style={{ marginTop: "var(--sp-2)", display: "flex", flexDirection: "column", alignItems: "center", gap: `calc(var(--sp-2) * ${METRO_SCALE})` }}';
    expect(meas.split(metroStyle).length - 1).toBe(2);
    expect(meas.includes("<MetroPendulumMemo getBeatPhase={null} getBeatDur={null} beatsPerMeasure={metroBeatsPerMeasure} accentOn={metroAccent} sig={metroSig} />")).toBe(true);
    // テンポ行の高さ = − / ＋ の高さ(本物の − / ＋ が METRO_PM_H_CSS を使っていること)
    expect(meas.includes("<div style={{ height: METRO_PM_H_CSS }} />")).toBe(true);
    expect(meas.split("height: METRO_PM_H_CSS,").length - 1).toBe(2);
    // 見本は見えない・押せない・流れの外
    expect(meas.includes('<div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: 0, visibility: "hidden", pointerEvents: "none" }}>')).toBe(true);
    expect(meas.includes("<div ref={ringFitWorstVolumeRef} style={{ display: \"flex\", flexDirection: \"column\" }}>")).toBe(true);
    expect(meas.includes("<div ref={ringFitWorstMiddleRef} style={{ display: \"flex\", flexDirection: \"column\" }}>")).toBe(true);
  });
});
