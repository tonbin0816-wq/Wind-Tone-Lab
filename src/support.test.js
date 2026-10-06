import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SUPPORT_EMAIL, PRIVACY_URL, TERMS_URL } from "./support.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const PRIVACY = read("../public/privacy.html");
const TERMS = read("../public/terms.html");

describe("連絡先の綴り", () => {
  // 【写しが2つある】静的な HTML は import できないので、アドレスが3箇所に書かれる
  // (support.js / privacy.html / terms.html)。**片方だけ直すと食い違う。**
  // 通報された人が辿り着けなくなる = 設計書 §8.1 の「消された側に道を残す」が壊れる。
  it("法務文書のアドレスは support.js と一致する", () => {
    expect(PRIVACY).toContain(SUPPORT_EMAIL);
    expect(TERMS).toContain(SUPPORT_EMAIL);
  });

  it("古いアドレスが残っていない(@ を含む綴りは1種類だけ)", () => {
    const found = new Set([
      ...(PRIVACY.match(/[\w.+-]+@[\w.-]+\.\w+/g) || []),
      ...(TERMS.match(/[\w.+-]+@[\w.-]+\.\w+/g) || []),
    ]);
    expect([...found]).toEqual([SUPPORT_EMAIL]);
  });

  it("mailto: の形で押せるようになっている", () => {
    expect(PRIVACY).toContain(`mailto:${SUPPORT_EMAIL}`);
    expect(TERMS).toContain(`mailto:${SUPPORT_EMAIL}`);
  });
});

describe("法務文書", () => {
  it("public/ に置いてある(Vite がそのまま配る = 本番URLで開ける)", () => {
    expect(PRIVACY_URL).toBe("/privacy.html");
    expect(TERMS_URL).toBe("/terms.html");
  });

  // App Store は「プライバシーポリシーURL」を必須項目として要求する。
  // 中身が空でないこと、要求される論点に触れていることを綴りで見る。
  it("プライバシーポリシーが要求される論点に触れている", () => {
    for (const w of ["収集", "利用目的", "第三者", "削除", "13歳", "お問い合わせ"]) {
      expect(PRIVACY, `「${w}」が無い`).toContain(w);
    }
  });

  it("利用規約が設計書 §7.4 の3点に触れている", () => {
    // 13歳以上 / 第三者の演奏を上げない / 練習量の値は検証していない
    expect(TERMS).toContain("13歳以上");
    expect(TERMS).toContain("第三者の演奏を録音してアップロードしないでください");
    expect(TERMS).toContain("運営者が検証したものではありません");
  });

  // 【録音は端末から出ない】これは本アプリの根本的な約束で、
  // 両方の文書がそう書いている。実装が変わったらここも直すこと。
  // 【殻 S3 2026-10-06】iOS アプリ版は AdMob の帯を出す(殻の仕様 §5.4・付録E)。同じ文書を Web 版も配るので、
  // 「iOS アプリ版のみ」「Web 版では広告を表示しない」と書き分ける。広告を出していないという古い一文は残さない。
  it("プライバシーポリシーが AdMob を開示し、iOS アプリ版だけの話だと書き分けている", () => {
    expect(PRIVACY).toContain("AdMob");
    expect(PRIVACY).not.toContain("現在、本アプリは広告を表示していません");
    expect(PRIVACY).toContain("広告の識別子（iOS アプリ版のみ）");
    expect(PRIVACY).toContain("Web 版では広告を表示しておらず");
    expect(PRIVACY).toContain("トラッキングの許可」を拒否した場合も");
  });

  // 文書はアプリの中のシート(LegalSheet)で描かれる。外のサイトへのリンクを押すと SPA から離れる(C11・C12 の経路)ので、
  // Google のポリシーの URL は文字で書くだけにする(押せる <a> は mailto: と末尾の戻る(シートでは除かれる)だけ)。
  it("プライバシーポリシーに外のサイトへ出るリンク(<a href=\"http…\">)が無い", () => {
    expect(PRIVACY.match(/<a\s[^>]*href="https?:/g) || []).toEqual([]);
  });

  it("両方の文書が「録音した音声は送らない」と書いている", () => {
    expect(PRIVACY).toContain("録音した音声そのものは、いかなる場合もサーバーへ送信しません");
    expect(TERMS).toContain("サーバーへ送信されることはありません");
  });
});
