import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// ------------------------------------------------------------------
// 【便S4 2026-10-25 本人「これでリリースしよう」】提出の準備の設定ファイル(殻の仕様 §6.1・§8.1 S4 を「開発版は試験・本番は本物」の形にしたもの)。
//   ・Info.plist: GADApplicationIdentifier = 本人のアプリ ID(Google の sample と違う)・iPad の向き(~ipad)を書かない
//   ・project.pbxproj: App ターゲットの全 configuration で TARGETED_DEVICE_FAMILY = 1(iPhone だけ)・MARKETING_VERSION = 1.0.0
//   ・codemagic.yaml: ios-dev だけが Info.plist のアプリ ID を試験に戻す・ios-release の最初の手順が本番の値の門
//   ・scripts/shell-ads-ids.mjs: 戻す処理と門の中身(関数を呼んで確かめる)
//   ・public/app-ads.txt: AdMob の1行
// 期待値は本人の AdMob の値(2026-10-06)・Google の文書(quick-start の Sample AdMob app ID)・本人の裁定から手で写した。
// 【守っていないもの】Codemagic の上で手順が実際に走ること・Xcode が iPhone だけのビルドを作ること・
//   審査のサイトが app-ads.txt を読めること(配信後に AdMob の画面で確かめる)。
// ------------------------------------------------------------------
const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8");
const REAL_APP_ID = "ca-app-pub-8488624336436415~1796275239";   // 本人の AdMob のアプリ ID
const SAMPLE_APP_ID = "ca-app-pub-3940256099942544~1458002511"; // https://developers.google.com/admob/ios/quick-start の Sample AdMob app ID
const REAL_UNIT = "ca-app-pub-8488624336436415/6801189906";
const DEMO_UNIT = "ca-app-pub-3940256099942544/2435281174";

const plist = read("ios/App/App/Info.plist");
const plistString = (key) => (new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist) || [])[1];

describe("Info.plist", () => {
  it("GADApplicationIdentifier は本人のアプリ ID(Google の sample と違う)・1つだけ", () => {
    expect(plistString("GADApplicationIdentifier")).toBe(REAL_APP_ID);
    expect(plistString("GADApplicationIdentifier")).not.toBe(SAMPLE_APP_ID);
    expect(plist.split("<key>GADApplicationIdentifier</key>").length).toBe(2);
    expect(plist).not.toContain("3940256099942544");
  });
  it("iPhone だけ: ~ipad の向きを書かない・iPhone は縦1つだけ", () => {
    expect(plist).not.toContain("~ipad");
    const m = /<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist);
    expect([...m[1].matchAll(/<string>([^<]+)<\/string>/g)].map((x) => x[1])).toEqual(["UIInterfaceOrientationPortrait"]);
  });
});

describe("project.pbxproj(App ターゲット)", () => {
  const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
  const appCfgs = [...pbx.matchAll(/\/\* (Debug|Release) \*\/ = \{\n\t\t\tisa = XCBuildConfiguration;[\s\S]*?\n\t\t\tname = (?:Debug|Release);\n\t\t\};/g)]
    .filter((m) => m[0].includes("INFOPLIST_FILE = App/Info.plist;"));
  it("App ターゲットの configuration は Debug と Release の2つ", () => {
    expect(appCfgs.map((m) => m[1]).sort()).toEqual(["Debug", "Release"]);
  });
  it("全ての configuration で TARGETED_DEVICE_FAMILY = 1(iPhone だけ)。iPad を含む値はどこにも無い", () => {
    for (const m of appCfgs) expect(m[0]).toMatch(/\n\t\t\t\tTARGETED_DEVICE_FAMILY = 1;\n/);
    expect(pbx.match(/TARGETED_DEVICE_FAMILY = [^;]*;/g)).toEqual(["TARGETED_DEVICE_FAMILY = 1;", "TARGETED_DEVICE_FAMILY = 1;"]);
  });
  it("全ての configuration で MARKETING_VERSION = 1.0.0(CURRENT_PROJECT_VERSION は Codemagic が上書きするので触らない)", () => {
    for (const m of appCfgs) expect(m[0]).toMatch(/\n\t\t\t\tMARKETING_VERSION = 1\.0\.0;\n/);
    expect(pbx.match(/MARKETING_VERSION = [^;]*;/g)).toEqual(["MARKETING_VERSION = 1.0.0;", "MARKETING_VERSION = 1.0.0;"]);
    for (const m of appCfgs) expect(m[0]).toMatch(/\n\t\t\t\tCURRENT_PROJECT_VERSION = 1;\n/);
  });
});

describe("codemagic.yaml", () => {
  const cm = read("codemagic.yaml");
  const blocks = {};
  const heads = [...cm.matchAll(/^  ([a-z][a-z-]*):\n/gm)];
  heads.forEach((h, i) => { blocks[h[1]] = cm.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : cm.length); });
  const code = (b) => (b || "").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const steps = (b) => [...code(b).matchAll(/\n\s+script: (.+)/g)].map((m) => m[1].trim());
  it("ios-dev は cap sync の後・build-ipa の前に Info.plist のアプリ ID を試験に戻す(node scripts/shell-ads-ids.mjs dev)", () => {
    const s = steps(blocks["ios-dev"]);
    const iSync = s.indexOf("npx cap sync ios");
    const iAds = s.indexOf("node scripts/shell-ads-ids.mjs dev");
    const iIpa = s.findIndex((x) => x.startsWith("xcode-project build-ipa"));
    expect(iSync).toBeGreaterThanOrEqual(0);
    expect(iAds).toBeGreaterThan(iSync);
    expect(iIpa).toBeGreaterThan(iAds);
  });
  it("ios-release の最初の手順(npm ci より前)が本番の値の門(node scripts/shell-ads-ids.mjs release)", () => {
    const s = steps(blocks["ios-release"]);
    expect(s[0]).toBe("node scripts/shell-ads-ids.mjs release");
    expect(s[1]).toBe("npm ci");
  });
  it("ios-testflight(本番)は試験に戻さない・門も無い(git の本番の値のまま)", () => {
    expect(code(blocks["ios-testflight"])).not.toMatch(/shell-ads-ids|GADApplicationIdentifier|3940256099942544/);
  });
  it("iPad 用の上書き(TARGETED_DEVICE_FAMILY・~ipad)を手順に書かない", () => {
    expect(code(cm)).not.toMatch(/TARGETED_DEVICE_FAMILY|~ipad|UIDeviceFamily/);
  });
});

describe("scripts/shell-ads-ids.mjs(開発版の書き戻しと ios-release の門)", () => {
  it("dev の書き戻し: GADApplicationIdentifier の値だけが Google の sample になる(他の行は同じ)", async () => {
    const { setPlistAppId, readPlistAppId } = await import("../../scripts/shell-ads-ids.mjs");
    const next = setPlistAppId(plist, SAMPLE_APP_ID);
    expect(readPlistAppId(next)).toBe(SAMPLE_APP_ID);
    const a = plist.split("\n"); const b = next.split("\n");
    expect(b.length).toBe(a.length);
    expect(a.filter((l, i) => l !== b[i])).toEqual([`\t<string>${REAL_APP_ID}</string>`]);
    expect(() => setPlistAppId(plist.replace("<key>GADApplicationIdentifier</key>", ""), SAMPLE_APP_ID)).toThrow();
    expect(() => setPlistAppId(plist, "not-an-id")).toThrow();
  });
  it("dev が書き戻す値は adsConfig.js の開発版のアプリ ID = Google の sample", async () => {
    const cfg = await import("./adsConfig.js");
    expect(cfg.ADMOB_DEV_APP_ID_IOS).toBe(SAMPLE_APP_ID);
    expect(cfg.ADMOB_APP_ID_IOS).toBe(REAL_APP_ID);
  });
  it("release の門: いまの値は合格・試験の値が1つでも混ざれば不合格", async () => {
    const { releaseAdsProblems, setPlistAppId } = await import("../../scripts/shell-ads-ids.mjs");
    const cfg = { ...(await import("./adsConfig.js")) };
    expect(releaseAdsProblems(cfg, plist)).toEqual([]);
    expect(releaseAdsProblems(cfg, setPlistAppId(plist, SAMPLE_APP_ID)).length).toBeGreaterThan(0);
    expect(releaseAdsProblems({ ...cfg, ADMOB_USE_TEST_ADS: true }, plist).length).toBeGreaterThan(0);
    expect(releaseAdsProblems({ ...cfg, ADMOB_BANNER_UNIT_ID_IOS: DEMO_UNIT }, plist).length).toBeGreaterThan(0);
    expect(releaseAdsProblems({ ...cfg, admobIds: () => ({ useTestAds: true, bannerUnitId: DEMO_UNIT }) }, plist).length).toBeGreaterThan(0);
    expect(releaseAdsProblems({ ...cfg, ADMOB_APP_ID_IOS: SAMPLE_APP_ID }, setPlistAppId(plist, SAMPLE_APP_ID)).length).toBeGreaterThan(0);
    // Info.plist に鍵が無い・2つある(AdMob の SDK は起動時に落ちる)
    const noKey = plist.replace(/\t<key>GADApplicationIdentifier<\/key>\n\t<string>[^<]*<\/string>\n/, "");
    expect(noKey).not.toContain("GADApplicationIdentifier");
    expect(releaseAdsProblems(cfg, noKey).length).toBeGreaterThan(0);
    const twoKeys = plist.replace("\t<key>ITSAppUsesNonExemptEncryption</key>", `\t<key>GADApplicationIdentifier</key>\n\t<string>${REAL_APP_ID}</string>\n\t<key>ITSAppUsesNonExemptEncryption</key>`);
    expect(releaseAdsProblems(cfg, twoKeys).length).toBeGreaterThan(0);
    expect(cfg.ADMOB_BANNER_UNIT_ID_IOS).toBe(REAL_UNIT);
  });
  it("release を node で走らせると exit 0(いまのツリー。書き込みはしない)", () => {
    const out = execFileSync(process.execPath, [join(root, "scripts", "shell-ads-ids.mjs"), "release"], { encoding: "utf8" });
    expect(out).toContain(REAL_UNIT);
    expect(read("ios/App/App/Info.plist")).toBe(plist);
  });
});

describe("public/app-ads.txt", () => {
  it("AdMob の1行だけ(google.com・本人の発行元 ID・DIRECT・Google の認証 ID)", () => {
    expect(read("public/app-ads.txt")).toBe("google.com, pub-8488624336436415, DIRECT, f08c47fec0942fa0\n");
  });
});
