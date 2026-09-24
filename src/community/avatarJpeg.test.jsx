import React from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { encodeSquarePhoto, photoProgressAt, PHOTO_MIMES as CLIENT_MIMES } from "./avatarPhoto.js";
import { PhotoProgressRing } from "./CommunityTab.jsx";
import { runVetAvatarPhoto } from "../../functions/avatarJobs.js";
import {
  photoKindOf, stripJpegMetadata, uploadAcceptable, avatarPathOf, PHOTO_MIMES as FN_MIMES,
} from "../../functions/avatarVerdict.js";

// ------------------------------------------------------------------
// 【便AP 2026-09-24 本人の実機報告】
// 「写真はなにを選んでもこの写真は使えません。別の写真をお試しくださいになる」
// 「その表示がでるまでも数秒あるが、読み込んでいるのか、正しく挙動していないかわからない」
//
// 根元: iPhone の Safari は canvas.toBlob('image/webp') に**黙って PNG を返す**。
// アプリはそれに「WebP」の札を付けて送り、関数は中身を見て必ず落としていた。
// ここでは Safari と同じ振る舞いの作り物で、端末 → 置き場 → 関数 の道を実際に走らせる。
// 期待値は凍結仕様から数字で書く(定数を import して突き合わせない ── 罠3)。
// ------------------------------------------------------------------
const WEBP = "image/webp";
const JPEG = "image/jpeg";
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Safari を真似た canvas。WebP を頼まれても PNG を返す。 */
function safariEnv({ jpegWorks = true } = {}) {
  const asked = [];
  const canvases = [];
  const deps = {
    loadImage: async () => ({ width: 1000, height: 800, close() {} }),
    makeCanvas: (w, h) => {
      // 描いた順を覚える canvas。塗り(fill)と描き(draw)を1本の列に積む。
      const ops = [];
      const ctx = {
        fillStyle: null,
        fillRect: (...a) => ops.push({ op: "fill", style: ctx.fillStyle, a }),
        drawImage: (src, ...a) => ops.push({ op: "draw", src, a }),
      };
      const c = { width: w, height: h, ops, getContext: () => ctx };
      canvases.push(c);
      return c;
    },
    toBlob: async (canvas, type, quality) => {
      asked.push({ type, quality, canvas });
      if (type === JPEG && jpegWorks) return { size: 18000, type: JPEG };
      return { size: 60000, type: "image/png" };
    },
  };
  return { asked, deps, canvases };
}

describe("encodeSquarePhoto ── WebP を書き出せない端末(iPhone の Safari)", () => {
  const FILE = { name: "IMG_0001.HEIC", type: "image/heic", size: 3_000_000 };

  it("WebP を頼んで PNG が返ったら、JPEG で書き直す(PNG に WebP の札を付けない)", async () => {
    const { asked, deps } = safariEnv();
    const out = await encodeSquarePhoto(FILE, deps);
    expect(asked.map((a) => a.type)).toEqual([WEBP, JPEG]);
    expect(out.type).toBe(JPEG);
    // 品質は WebP と同じ帯(0.82)
    expect(asked[1].quality).toBe(0.82);
  });

  // JPEG は透明を持てない(透明な所が黒くなる)。白い地を先に塗ってから、写真を描いた canvas を重ねる。
  it("JPEG に落とすときは、白い地を塗ってから描き直した canvas を書き出す", async () => {
    const { asked, deps, canvases } = safariEnv();
    await encodeSquarePhoto(FILE, deps);
    const [first, flat] = canvases;
    expect(canvases).toHaveLength(2);
    expect(asked[1].canvas).toBe(flat);
    expect(flat.width).toBe(256);
    expect(flat.height).toBe(256);
    expect(flat.ops.map((o) => o.op)).toEqual(["fill", "draw"]);
    expect(flat.ops[0].style.toLowerCase()).toBe("#ffffff");
    expect(flat.ops[0].a).toEqual([0, 0, 256, 256]);
    expect(flat.ops[1].src).toBe(first);
  });

  it("JPEG も出なければ失敗する(PNG を送らない)", async () => {
    const { deps } = safariEnv({ jpegWorks: false });
    await expect(encodeSquarePhoto(FILE, deps)).rejects.toThrow(/PHOTO_ENCODE_FAILED/);
  });

  it("WebP が出る端末では1回で済む(JPEG に落ちない)", async () => {
    const asked = [];
    const deps = {
      ...safariEnv().deps,
      toBlob: async (c, type) => { asked.push(type); return { size: 15000, type }; },
    };
    const out = await encodeSquarePhoto(FILE, deps);
    expect(asked).toEqual([WEBP]);
    expect(out.type).toBe(WEBP);
  });
});

// ---------------------------------------------------------------- JPEG の組み立て
const seg = (marker, payload) => {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
};
const ascii = (s) => [...Buffer.from(s, "latin1")];
const APP0 = seg(0xe0, ascii("JFIF\0\x01\x01\0\0\x01\0\x01\0\0"));
const APP1_EXIF = seg(0xe1, ascii("Exif\0\0GPS-35.6812N-139.7671E"));
const APP13 = seg(0xed, ascii("Photoshop 3.0\0IPTC"));
const COM = seg(0xfe, ascii("taken at home"));
const DQT = seg(0xdb, [0, ...Array(64).fill(1)]);
const SOF0 = seg(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]);
const SOS = seg(0xda, [1, 1, 0, 0, 0x3f, 0]);
// 画素の走査。FF 00(詰め物)と FF D3(区切り RST3)は画素の一部で、区画の始まりではない。
const SCAN = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd3, 0x78, 0x9a];
const SCAN2 = [0x21, 0x43, 0xff, 0x00, 0x65];
const DHT = seg(0xc4, [0x00, ...Array(16).fill(0)]);
const ICC = seg(0xe2, ascii("ICC_PROFILE\0\x01\x01colordata"));
const ADOBE = seg(0xee, ascii("Adobe\0\x64\0\0\0\0\x01"));   // 12バイトの本物の形
const EOI = [0xff, 0xd9];
const jpegWith = (...parts) => Uint8Array.from([0xff, 0xd8, ...parts.flat()]);
const hasSeq = (bytes, seq) => {
  const b = [...bytes];
  outer: for (let i = 0; i + seq.length <= b.length; i += 1) {
    for (let j = 0; j < seq.length; j += 1) if (b[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
};

describe("photoKindOf ── 形式は中身から決める(申告は見ない)", () => {
  it("WebP / JPEG を見分け、それ以外は null", () => {
    expect(photoKindOf(Buffer.from("RIFF    WEBPVP8 ", "latin1"))).toBe(WEBP);
    expect(photoKindOf(jpegWith(APP0, SOS, SCAN, EOI))).toBe(JPEG);
    expect(photoKindOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(null); // PNG
    expect(photoKindOf(Buffer.from([0xff, 0xd8]))).toBe(null);
    expect(photoKindOf(null)).toBe(null);
  });
});

describe("stripJpegMetadata ── EXIF(撮影位置)を判定の前に取り除く", () => {
  const src = jpegWith(APP0, APP1_EXIF, DQT, APP13, COM, SOF0, SOS, SCAN, EOI);

  it("APP0・APP1・APP13 と注釈を落とし、画像そのものは残す", () => {
    const out = stripJpegMetadata(src);
    expect([...out]).toEqual([0xff, 0xd8, ...DQT, ...SOF0, ...SOS, ...SCAN, ...EOI]);
    expect(hasSeq(out, ascii("GPS"))).toBe(false);
    expect(hasSeq(out, ascii("Exif"))).toBe(false);
    expect(hasSeq(out, ascii("JFIF"))).toBe(false);
    expect(hasSeq(out, ascii("taken at home"))).toBe(false);
  });

  it("画素の中の詰め物(FF 00)と区切り(FF D3)は画素として残す(画像を壊さない)", () => {
    const out = stripJpegMetadata(src);
    expect(hasSeq(out, SCAN)).toBe(true);
  });

  // ★ 審査役の指摘(中2): 最初の SOS から末尾までを丸写しすると、次の4つで位置情報が残った。
  it("プログレッシブの走査の間に挟んだ APP1 も落とす(2つ目の走査は残す)", () => {
    const out = stripJpegMetadata(jpegWith(DQT, SOF0, DHT, SOS, SCAN, APP1_EXIF, DHT, SOS, SCAN2, EOI));
    expect([...out]).toEqual([0xff, 0xd8, ...DQT, ...SOF0, ...DHT, ...SOS, ...SCAN, ...DHT, ...SOS, ...SCAN2, ...EOI]);
  });

  it("EOI の後ろに足した物は捨てる(APP1 でも、EXIF 付きの2枚目の JPEG でも)", () => {
    const tail1 = stripJpegMetadata(jpegWith(DQT, SOF0, SOS, SCAN, EOI, APP1_EXIF));
    const second = [...jpegWith(APP1_EXIF, DQT, SOF0, SOS, SCAN, EOI)];
    const tail2 = stripJpegMetadata(Uint8Array.from([...jpegWith(DQT, SOF0, SOS, SCAN, EOI), ...second]));
    for (const out of [tail1, tail2]) {
      expect([...out]).toEqual([0xff, 0xd8, ...DQT, ...SOF0, ...SOS, ...SCAN, ...EOI]);
      expect(hasSeq(out, ascii("GPS"))).toBe(false);
    }
  });

  it("JFIF でない APP0 に入れた文字も落とす", () => {
    const junk0 = seg(0xe0, ascii("Lat35.68Lon139.76"));
    const out = stripJpegMetadata(jpegWith(junk0, DQT, SOF0, SOS, SCAN, EOI));
    expect(hasSeq(out, ascii("Lat35"))).toBe(false);
  });

  it("区画の前の詰め物の FF(FF FF E1 …)も区画として読んで落とす", () => {
    const out = stripJpegMetadata(jpegWith(DQT, [0xff], APP1_EXIF, SOF0, SOS, SCAN, [0xff], EOI));
    expect(out).not.toBe(null);
    expect(hasSeq(out, ascii("GPS"))).toBe(false);
    expect(hasSeq(out, [...SOF0])).toBe(true);
  });

  // 軽6: APP2 の色の定義と APP14 の色変換の印は復号に使う。落とすと色が崩れる JPEG がある。
  it("色の定義(ICC_PROFILE)と Adobe の印は残す。同じ番号でも中身が違えば落とす", () => {
    const fakeIcc = seg(0xe2, ascii("MPF\0GPS-here"));
    const fakeAdobe = seg(0xee, ascii("Adobe\0GPS-35.68-139.76-longer"));
    const out = stripJpegMetadata(jpegWith(ICC, ADOBE, fakeIcc, fakeAdobe, DQT, SOF0, SOS, SCAN, EOI));
    expect([...out]).toEqual([0xff, 0xd8, ...ICC, ...ADOBE, ...DQT, ...SOF0, ...SOS, ...SCAN, ...EOI]);
  });

  // ★ 再審査の指摘(軽2): 番号を問わず残すと、復号に要らない区画で文字を運べた。名前で許した物だけ残す。
  it("決まっていない番号の区画(JPGn・予約・C8・DE・DF)が入った JPEG は落とす", () => {
    for (const m of [0xf0, 0xfd, 0x02, 0xbf, 0xc8, 0xde, 0xdf]) {
      const odd = seg(m, ascii("GPS-35.68-139.76"));
      expect(stripJpegMetadata(jpegWith(DQT, odd, SOF0, SOS, SCAN, EOI))).toBe(null);
    }
  });

  it("DRI・複数の DHT・DAC・SOF2(プログレッシブ)は残す", () => {
    const DRI = seg(0xdd, [0x00, 0x04]);
    const DAC = seg(0xcc, [0x00, 0x10]);
    const SOF2 = seg(0xc2, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]);
    const parts = [DQT, SOF2, DHT, DHT, DRI, DAC, SOS, SCAN, DHT, SOS, SCAN2, EOI];
    const out = stripJpegMetadata(jpegWith(...parts));
    expect([...out]).toEqual([0xff, 0xd8, ...parts.flat()]);
  });

  // ★ 再審査の指摘(軽3): 長さを持たない印が区画の位置に来るのは壊れた形。
  it("区画の位置に RST・TEM・2つ目の SOI が来たら null", () => {
    for (const m of [0xd0, 0xd7, 0x01, 0xd8]) {
      expect(stripJpegMetadata(jpegWith(DQT, [0xff, m], SOF0, SOS, SCAN, EOI))).toBe(null);
    }
  });

  it("EOI が無い・走査が無い JPEG は null(途中で切れた物を載せない)", () => {
    expect(stripJpegMetadata(jpegWith(DQT, SOF0, SOS, SCAN))).toBe(null);
    expect(stripJpegMetadata(jpegWith(DQT, SOF0, EOI))).toBe(null);
  });

  it("元のバイト列を書き換えない(新しい列を返す)", () => {
    const copy = Uint8Array.from(src);
    stripJpegMetadata(src);
    expect([...src]).toEqual([...copy]);
  });

  it("壊れた JPEG は null(長さが末尾を越える・区画の頭が FF でない)", () => {
    expect(stripJpegMetadata(jpegWith([0xff, 0xe1, 0x7f, 0xff, 1, 2]))).toBe(null);
    expect(stripJpegMetadata(jpegWith([0x00, 0x11]))).toBe(null);
    expect(stripJpegMetadata(Buffer.from("RIFF    WEBP", "latin1"))).toBe(null);
  });
});

// ---------------------------------------------------------------- 関数を実際に走らせる
const CLEAN = { adult: "VERY_UNLIKELY", violence: "UNLIKELY", racy: "UNLIKELY", medical: "VERY_UNLIKELY" };
function fakeFn({ contentType, bytes }) {
  const calls = { saved: [], removed: [], visionGot: [], wrote: [] };
  const deps = {
    bucketName: "b1.appspot.com",
    exists: async () => true,
    getMetadata: async () => ({ size: bytes.length, contentType }),
    download: async () => bytes,
    safeSearch: async (b) => { calls.visionGot.push(b); return CLEAN; },
    save: async (p, b, t, type) => { calls.saved.push({ path: p, bytes: b, token: t, type }); },
    remove: async (p) => { calls.removed.push(p); },
    dropOthers: async () => {},
    dropAll: async () => {},
    writeUserPhoto: async (uid, url) => { calls.wrote.push({ uid, url }); },
    readUserPhoto: async () => calls.wrote.at(-1)?.url ?? null,
    rev: () => "rev1",
    token: () => "tok1",
  };
  return { calls, deps };
}

describe("runVetAvatarPhoto ── JPEG の道", () => {
  const withExif = jpegWith(APP0, APP1_EXIF, DQT, SOF0, SOS, SCAN, EOI);

  it("JPEG を受け、付帯情報を落とした列を判定し、**同じ列**を .jpg として保存する", async () => {
    const { calls, deps } = fakeFn({ contentType: JPEG, bytes: withExif });
    const res = await runVetAvatarPhoto({ uid: "u1" }, deps);
    expect(calls.saved).toHaveLength(1);
    const saved = calls.saved[0];
    expect(saved.path).toBe("avatars/u1/rev1.jpg");
    expect(saved.type).toBe(JPEG);
    expect(saved.bytes).toBe(calls.visionGot[0]);          // 判定したものと載せるものが同一
    expect(hasSeq(saved.bytes, ascii("GPS"))).toBe(false);  // 撮影位置は載らない
    expect(res.photo).toContain(encodeURIComponent("avatars/u1/rev1.jpg"));
  });

  it("PNG に WebP の札(以前の iPhone の形)は落とし、上げた物を消す", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const { calls, deps } = fakeFn({ contentType: WEBP, bytes: png });
    await expect(runVetAvatarPhoto({ uid: "u1" }, deps)).rejects.toThrow(/photo-rejected/);
    expect(calls.saved).toHaveLength(0);
    expect(calls.removed).toHaveLength(1);
  });

  it("中身と札が食い違えば落とす(JPEG に WebP の札 / WebP に JPEG の札)", async () => {
    const a = fakeFn({ contentType: WEBP, bytes: withExif });
    await expect(runVetAvatarPhoto({ uid: "u1" }, a.deps)).rejects.toThrow(/photo-rejected/);
    const b = fakeFn({ contentType: JPEG, bytes: Buffer.from("RIFF    WEBPVP8 ", "latin1") });
    await expect(runVetAvatarPhoto({ uid: "u1" }, b.deps)).rejects.toThrow(/photo-rejected/);
    expect(a.calls.saved.length + b.calls.saved.length).toBe(0);
  });

  it("壊れた JPEG は判定に回さず落とす", async () => {
    const { calls, deps } = fakeFn({ contentType: JPEG, bytes: jpegWith([0xff, 0xe1, 0x7f, 0xff, 1]) });
    await expect(runVetAvatarPhoto({ uid: "u1" }, deps)).rejects.toThrow(/broken-jpeg/);
    expect(calls.visionGot).toHaveLength(0);
    expect(calls.removed).toHaveLength(1);
  });

  it("置き場の名前は形式で拡張子が変わる", () => {
    expect(avatarPathOf("u", "r")).toBe("avatars/u/r.webp");
    expect(avatarPathOf("u", "r", JPEG)).toBe("avatars/u/r.jpg");
    expect(uploadAcceptable({ size: 1000, contentType: JPEG }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------- 写しが食い違わない
describe("端末・置き場の門・関数で、受ける形式と地域がそろっている", () => {
  const rules = read("../../storage.rules");
  const fnIndex = read("../../functions/index.js");
  const repo = read("./photoRepo.js");

  it("受ける形式は3か所とも WebP と JPEG", () => {
    expect(CLIENT_MIMES).toEqual([WEBP, JPEG]);
    expect(FN_MIMES).toEqual([WEBP, JPEG]);
    expect(rules).toMatch(/request\.resource\.contentType in \['image\/webp', 'image\/jpeg'\]/);
  });

  // ★ 再審査の指摘(中1): 綴り(setGlobalOptions)を見ていたが、関数ごとの region がそれより優先される。
  // **組み上がった関数の設定そのもの**(__endpoint)を読む。ネットワークには出ない。
  it("判定の関数は、端末が呼ぶ地域に置かれている(組み上がった設定を読む)", async () => {
    const fns = await import("../../functions/index.js");
    const clientRegion = repo.match(/PHOTO_FUNCTIONS_REGION = "([^"]+)"/)?.[1];
    expect(clientRegion).toBe("asia-northeast1");
    expect(repo).toMatch(/getFunctions\(app, PHOTO_FUNCTIONS_REGION\)/);
    // 移し替えの間は us-central1 が並ぶことがある。**端末が呼ぶ東京が抜けていないこと**を見る。
    expect(fns.vetAvatarPhoto.__endpoint.region).toContain(clientRegion);
    // 掃除はデータベースと同じ東京に1つだけ(2地域で二重に動かさない)
    expect(fns.cleanAvatarPhoto.__endpoint.region).toEqual(["asia-northeast1"]);
  });

  it("送るときの札は Blob の中身から取る(決め打ちの image/webp を付けない)", () => {
    expect(repo).not.toMatch(/contentType: PHOTO_MIME\b/);
    expect(repo).toMatch(/PHOTO_MIMES\.includes\(blob\?\.type\) \? blob\.type : null/);
    expect(repo).toMatch(/uploadBytesResumable\(storageRef\(getStorage\(app\), photoUploadPath\(uid\)\), blob, \{ contentType \}\)/);
  });
});

// ---------------------------------------------------------------- 進み具合の輪
describe("photoProgressAt ── 輪の埋まり具合", () => {
  it("段が進むほど増える(書き出し < 送信の頭 < 送信の終わり ≤ 判定の頭)", () => {
    const e = photoProgressAt({ stage: "encode" }, 0);
    const u0 = photoProgressAt({ stage: "upload", fraction: 0 }, 0);
    const u1 = photoProgressAt({ stage: "upload", fraction: 1 }, 0);
    const v0 = photoProgressAt({ stage: "vet", startedAt: 1000 }, 1000);
    expect(e).toBeGreaterThan(0);
    expect(u0).toBeGreaterThan(e);
    expect(u1).toBeGreaterThan(u0);
    expect(v0).toBeGreaterThanOrEqual(u1);
  });

  it("判定の段は時間とともに増えるが、返事が来るまで 100% にならない", () => {
    const at = (ms) => photoProgressAt({ stage: "vet", startedAt: 0 }, ms);
    expect(at(1000)).toBeGreaterThan(at(0));
    expect(at(4000)).toBeGreaterThan(at(1000));
    expect(at(60_000)).toBeLessThan(1);
    expect(at(60_000)).toBeLessThanOrEqual(0.95);
    // 1秒で半分を越える(止まって見えない)。判定の実際の秒数は配信後に測る。
    expect(at(1000)).toBeGreaterThan(0.5);
  });

  it("返事が来たら満ちる / 段が無ければ空", () => {
    expect(photoProgressAt({ stage: "done" }, 0)).toBe(1);
    expect(photoProgressAt(null, 0)).toBe(0);
    expect(photoProgressAt({ stage: "upload", fraction: NaN }, 0)).toBeGreaterThan(0);
  });
});

describe("PhotoProgressRing ── 描いた結果", () => {
  const offsetOf = (html) => Number(html.match(/stroke-dashoffset="([^"]+)"/)?.[1]);
  const arrayOf = (html) => Number(html.match(/stroke-dasharray="([^"]+)"/)?.[1]);

  it("進み具合が 0% なら弧は空、100% なら一周", () => {
    const empty = renderToStaticMarkup(<PhotoProgressRing progress={0} />);
    const full = renderToStaticMarkup(<PhotoProgressRing progress={1} />);
    expect(offsetOf(empty)).toBeCloseTo(arrayOf(empty), 5);
    expect(offsetOf(full)).toBeCloseTo(0, 5);
  });

  // 輪は radio(写真枠)の中にあるので読み上げからは隠す。名前は写真枠の側が「写真を保存中」になる
  // (photoSaveFlow.test.jsx が実際に描いて見る)。
  it("送っている写真が中に出る・輪は読み上げから隠す", () => {
    const html = renderToStaticMarkup(<PhotoProgressRing progress={0.42} preview="blob:x" />);
    expect(html).toContain('data-progress="42"');
    expect(html).toMatch(/^<span aria-hidden="true"/);
    expect(html).toContain('src="blob:x"');
    expect(html).toContain("var(--c-accent)");
  });

  it("書き出しの間(まだ写真が無い)は写真の絵柄を出す", () => {
    const html = renderToStaticMarkup(<PhotoProgressRing progress={0.04} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("<svg");
  });
});
