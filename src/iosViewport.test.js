// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { isIOSDevice, withMaximumScale1, applyIOSViewport } from "./iosViewport.js";

// 【便BB 2026-09-25 統括の裁定 (b)】iOS のときだけ viewport に maximum-scale=1 を足す。
// UA は実在の端末の書式(版数だけ代表値)。期待値は端末の種類から手で決める。
const UA = {
  iPhone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iPod: "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
  iPadOld: "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
  // iPadOS 13 以降の既定(デスクトップ表示)は Mac を名乗る
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  // iPhone の Chrome(CriOS)も中身は WebKit(iOS の決まり)なので iOS に入る
  iPhoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.46 Mobile/15E148 Safari/604.1",
};

describe("isIOSDevice(UA と maxTouchPoints の組)", () => {
  const cases = [
    ["iPhone", UA.iPhone, 5, true],
    ["iPhone の Chrome", UA.iPhoneChrome, 5, true],
    ["iPod", UA.iPod, 5, true],
    ["古い iPad(iPad を名乗る)", UA.iPadOld, 5, true],
    ["iPadOS の Mac 名乗り(指で触れる点 5)", UA.mac, 5, true],
    ["本物の Mac(指で触れる点 0)", UA.mac, 0, false],
    ["Mac 名乗りでも点 1 は iPad としない(> 1 が条件)", UA.mac, 1, false],
    ["Android の Chrome", UA.android, 5, false],
    ["Windows の Chrome(タッチ画面)", UA.windows, 10, false],
    ["UA が無い", undefined, undefined, false],
  ];
  for (const [name, ua, mtp, want] of cases) {
    it(`${name} → ${want}`, () => { expect(isIOSDevice(ua, mtp)).toBe(want); });
  }
});

describe("withMaximumScale1", () => {
  it("今の既定の viewport に maximum-scale=1 を足す(他の項目はそのまま・順も保つ)", () => {
    expect(withMaximumScale1("width=device-width, initial-scale=1.0, viewport-fit=cover"))
      .toBe("width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1");
  });
  it("既に maximum-scale があれば置き換える(2つにしない)", () => {
    expect(withMaximumScale1("width=device-width, maximum-scale=5")).toBe("width=device-width, maximum-scale=1");
  });
});

describe("applyIOSViewport(起動の最初に meta を書き換える)", () => {
  const DEFAULT = "width=device-width, initial-scale=1.0, viewport-fit=cover";
  const docWithMeta = () => {
    document.head.innerHTML = `<meta name="viewport" content="${DEFAULT}">`;
    return document;
  };
  const content = () => document.querySelector('meta[name="viewport"]').getAttribute("content");

  it("iPhone では maximum-scale=1 が足される", () => {
    expect(applyIOSViewport(docWithMeta(), { userAgent: UA.iPhone, maxTouchPoints: 5 })).toBe(true);
    expect(content()).toBe(`${DEFAULT}, maximum-scale=1`);
  });
  it("iPadOS の Mac 名乗りでも足される", () => {
    applyIOSViewport(docWithMeta(), { userAgent: UA.mac, maxTouchPoints: 5 });
    expect(content()).toContain("maximum-scale=1");
  });
  it("Android・本物の Mac では何も変えない(指2本の拡大を止めない)", () => {
    expect(applyIOSViewport(docWithMeta(), { userAgent: UA.android, maxTouchPoints: 5 })).toBe(false);
    expect(content()).toBe(DEFAULT);
    expect(applyIOSViewport(docWithMeta(), { userAgent: UA.mac, maxTouchPoints: 0 })).toBe(false);
    expect(content()).toBe(DEFAULT);
  });
  it("2回呼んでも maximum-scale は1つ", () => {
    const doc = docWithMeta();
    applyIOSViewport(doc, { userAgent: UA.iPhone, maxTouchPoints: 5 });
    applyIOSViewport(doc, { userAgent: UA.iPhone, maxTouchPoints: 5 });
    expect(content().match(/maximum-scale/g)).toHaveLength(1);
  });
  it("meta が無くても落ちない", () => {
    document.head.innerHTML = "";
    expect(applyIOSViewport(document, { userAgent: UA.iPhone, maxTouchPoints: 5 })).toBe(false);
  });
});
