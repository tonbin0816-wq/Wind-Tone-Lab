import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ------------------------------------------------------------------
// 【便S4 2026-10-25】提出の書類 design/SUBMISSION.md の「貼る」枠が App Store Connect の上限に収まること。
// 上限は Apple の欄の上限(サブタイトル 30 字・キーワード 100 バイト・プロモーション用テキスト 170 字・説明 4000 字・審査メモ 4000 字)を手で写した。
// 【守っていないもの】ASC が実際に受け付けること(数え方が Apple と違えば本人の画面で分かる)・文の中身が事実であること(審査役と本人が読む)。
// ------------------------------------------------------------------
const doc = readFileSync(join(process.cwd(), "design", "SUBMISSION.md"), "utf8");
// 見出し(### 3.1 など)の直後の最初の ``` 枠の中身
function blockAfter(heading) {
  const i = doc.indexOf(heading);
  if (i < 0) return null;
  const m = /```\n([\s\S]*?)\n```/.exec(doc.slice(i));
  return m ? m[1] : null;
}
const chars = (s) => [...s].length;
const NAME = "Ficus サックス奏者のためのチューナー&メトロノーム";

const subtitle = blockAfter("### 3.1 サブタイトル");
const keywords = blockAfter("### 3.3 キーワード");
const promo = blockAfter("### 3.4 プロモーション用テキスト");
const desc = blockAfter("### 3.5 説明");
const notes = blockAfter("## 4. 審査メモ");

describe("SUBMISSION.md の貼る枠", () => {
  it("5つの枠が全部ある", () => {
    for (const b of [subtitle, keywords, promo, desc, notes]) expect(typeof b === "string" && b.length > 0).toBe(true);
  });
  it("上限: サブタイトル 30 字・キーワード 100 バイト・プロモーション用テキスト 170 字・説明 4000 字・審査メモ 4000 字", () => {
    expect(chars(subtitle)).toBeLessThanOrEqual(30);
    expect(Buffer.byteLength(keywords, "utf8")).toBeLessThanOrEqual(100);
    expect(chars(promo)).toBeLessThanOrEqual(170);
    expect(chars(desc)).toBeLessThanOrEqual(4000);
    expect(chars(notes)).toBeLessThanOrEqual(4000);
  });
  it("キーワード: 1行・空白なし・空の語なし・重複なし・名前とサブタイトルの語を重ねない", () => {
    expect(keywords).not.toMatch(/\s/);
    const words = keywords.split(",");
    expect(words.every((w) => w.length > 0)).toBe(true);
    expect(new Set(words).size).toBe(words.length);
    for (const w of ["サックス", "チューナー", "メトロノーム", "リード", "音程", "倍音", "練習", "記録"]) {
      expect(NAME.includes(w) || subtitle.includes(w)).toBe(true);
      expect(words.some((k) => k.includes(w))).toBe(false);
    }
  });
  it("事実でない言い方(No.1・受賞・ダウンロード数)と語彙の禁則(機材・機種)が無い", () => {
    for (const t of [subtitle, keywords, promo, desc, notes]) {
      expect(t).not.toMatch(/No\.?\s?1|ナンバーワン|1位|受賞|ダウンロード|万人|機材|機種/i);
    }
    expect(doc).not.toMatch(/機材|機種/);
  });
  it("審査メモは日本語と英語の両方・アカウント削除の場所・通報とブロック・週1回・マイク・ログイン不要を書く", () => {
    for (const w of ["【日本語】", "【English】", "アカウントを削除", "通報", "ブロック", "週1回", "マイク", "ログインは不要", "匿名", "4.2", "5.1.1(v)", "1.2", "ficus.help@gmail.com"]) {
      expect(notes, w).toContain(w);
    }
    for (const w of ["No login is required", "Account deletion", "at least once a week", "Microphone", "anonymous"]) {
      expect(notes, w).toContain(w);
    }
  });
  // 【便DF 審査】機内モードで動くのは初回のプロフィール作成のあと(作成はサーバーへの保存が要る)
  it("審査メモの 4.2: 機内モードの一文は「初回のプロフィール作成のあと」と限る(日本語・英語とも)", () => {
    expect(notes).toContain("初回のプロフィール作成のあとは、機内モードでも計測・リード管理・記録の閲覧が動きます");
    expect(notes).toContain("after the first-run profile creation, measuring, reeds and records work in Airplane Mode");
    expect(notes.match(/機内モード/g)).toHaveLength(1);
    expect(notes.match(/Airplane Mode/g)).toHaveLength(1);
    expect(desc).toContain("プロフィール作成のあとは、機内モードでも");
  });
});

// ------------------------------------------------------------------
// 【便DF 審査】栄養表示(§1)を Google の開示(https://developers.google.com/admob/ios/data-disclosure)と1行ずつ揃え、
// プライバシーポリシー(public/privacy.html)と食い違わないこと。期待値は Google の原文の言葉(user-associated / non-user related /
// app- or developer-bounded)から手で決めた。
// 【守っていないもの】Google の開示がこの先変わらないこと(取得した日の写し)・ASC の分類名が画面と同じであること(本人が画面で確認)。
// ------------------------------------------------------------------
describe("栄養表示(§1)とプライバシーポリシーの突き合わせ", () => {
  const s1 = doc.slice(doc.indexOf("## 1. App のプライバシー"), doc.indexOf("## 2. 年齢区分"));
  // 表の行: | 種類 | 項目 | 目的 | 紐づく | トラッキング | 根拠 |
  const row = (item) => {
    const line = s1.split("\n").find((l) => l.startsWith("|") && l.includes(`**${item}**`));
    return line ? line.split("|").slice(1, -1).map((c) => c.trim()) : null;
  };
  const strip = (c) => c.replace(/\*\*/g, "").replace(/\(.*$/, "").trim();
  it("AdMob の6行が Google の一覧6つに当たる(原文の引用つき)", () => {
    for (const [item, quote] of [
      ["デバイス ID", "A Device ID, such as the device's advertising identifier or other app- or developer-bounded device identifiers"],
      ["おおよその位置情報", "IP address, which may be used to estimate the general location of a device"],
      ["広告データ", "Advertising data, such as advertisements the user has seen"],
      ["製品の操作", "Other user product interactions like app launch taps"],
      ["クラッシュデータ", "Non-user related crash logs"],
      ["パフォーマンスデータ", "User-associated performance data such as app launch time, hang rate, or energy usage"],
    ]) {
      const r = row(item);
      expect(r, item).not.toBe(null);
      expect(r[5], item).toContain(quote);
    }
  });
  it("紐づく: パフォーマンスは「はい」(user-associated)・クラッシュは「いいえ」(non-user related)。トラッキング: デバイス ID は「はい」", () => {
    expect(strip(row("パフォーマンスデータ")[3])).toBe("はい");
    expect(strip(row("クラッシュデータ")[3])).toBe("いいえ");
    expect(strip(row("デバイス ID")[4])).toBe("はい");
    expect(strip(row("ユーザー ID")[3])).toBe("はい");
  });
  it("デバイス ID の注記: IDFA は ATT で許可したときだけ・アプリや開発者に限った識別子(IDFV など)は ATT に関係なく", () => {
    const r = row("デバイス ID")[5];
    expect(r).toContain("IDFA は ATT で「許可」したときだけ");
    expect(r).toContain("アプリ・開発者に限った端末識別子(IDFV など)は ATT に関係なく集まる");
  });
  it("プライバシーポリシーの AdMob の段(4章)と表の行(2章)が、識別子(IDFA・アプリや開発者に限った識別子)・IP・広告の記録・診断(クラッシュ・動作の記録)を言う", () => {
    const pv = readFileSync(join(process.cwd(), "public", "privacy.html"), "utf8");
    const ch4 = pv.slice(pv.indexOf("<h2>4. 第三者への提供</h2>"), pv.indexOf("<h2>5."));
    const ch2row = (/<td>広告の識別子（iOS アプリ版のみ）<\/td>\s*<td>([\s\S]*?)<\/td>/.exec(pv) || [])[1] || "";
    for (const t of [ch4, ch2row]) {
      expect(t).toContain("広告識別子（IDFA");
      expect(t).toContain("このアプリや開発者に限った端末の識別子");
      expect(t).toContain("トラッキングの許可に関係なく");
      expect(t).toContain("IP アドレス");
      expect(t).toContain("診断の情報（クラッシュの記録");
      expect(t).toContain("起動時間");
    }
  });
  it("コンテンツ配信権: 他の利用者の UGC を表示するので「はい」の可能性を書き、本人が画面で確認する印を付ける", () => {
    const line = doc.split("\n").find((l) => l.includes("コンテンツ配信権(「第三者のコンテンツ"));
    expect(line).toBeTruthy();
    expect(line).toContain("他の利用者のニックネーム・プロフィール・アイコンの写真(UGC)を表示する");
    expect(line).toContain("「はい」に当たる可能性がある");
    expect(line).toContain("【本人が画面で確認】");
    expect(doc).not.toContain("第三者のコンテンツを含まない(「いいえ」)");
  });
});
