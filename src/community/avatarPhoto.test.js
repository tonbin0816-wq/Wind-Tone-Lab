import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  planPhotoEncode, encodeSquarePhoto, avatarPaint, avatarWriteOnClose, photoZoomAvailable, photoFailureKind,
} from "./avatarPhoto.js";
import { AVATAR_ICONS } from "./profile.js";

// 【期待値は実装から引かない】凍結仕様 docs/superpowers/specs/2026-09-23-avatar-photo.md の
// 決定3(「端末で正方形に切り、256px、WebP に書き直す」)をそのまま数字で書く。
// 定数を import して突き合わせると、定数を変えた瞬間に検査も一緒に動いて何も守らない(罠3)。
const EDGE = 256;
const MIME = "image/webp";

describe("planPhotoEncode ── 端末側の書き直しの手順", () => {
  it("横長は左右を落として中央の正方形を取る", () => {
    // 4000×3000 → 一辺 3000・左右から (4000-3000)/2 = 500 ずつ
    const p = planPhotoEncode({ width: 4000, height: 3000 });
    expect(p.source).toEqual({ x: 500, y: 0, width: 3000, height: 3000 });
  });

  it("縦長は上下を落として中央の正方形を取る", () => {
    // 1080×1920 → 一辺 1080・上下から (1920-1080)/2 = 420 ずつ
    const p = planPhotoEncode({ width: 1080, height: 1920 });
    expect(p.source).toEqual({ x: 0, y: 420, width: 1080, height: 1080 });
  });

  it("奇数の余りは切り捨てる(はみ出す矩形を作らない)", () => {
    const p = planPhotoEncode({ width: 101, height: 100 });
    expect(p.source).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(p.source.x + p.source.width).toBeLessThanOrEqual(101);
  });

  it("書き出しは 256×256 の WebP", () => {
    const p = planPhotoEncode({ width: 4000, height: 3000 });
    expect(p.output.width).toBe(EDGE);
    expect(p.output.height).toBe(EDGE);
    expect(p.output.type).toBe(MIME);
  });

  // 【EXIF が残らないことの根拠】素通しの道が1つでもあると、その経路だけ
  // 向きや撮影位置が付いてくる。**既に 256px の WebP でも作り直す。**
  it("既に 256px の WebP でも素通ししない(作り直す)", () => {
    const p = planPhotoEncode({ width: 256, height: 256 });
    expect(p.reencode).toBe(true);
    expect(p.output).toEqual({ width: EDGE, height: EDGE, type: MIME, quality: p.output.quality });
    expect(p.source).toEqual({ x: 0, y: 0, width: 256, height: 256 });
  });

  it("大きさが読めないものは手順を返さない", () => {
    expect(planPhotoEncode({ width: 0, height: 100 })).toHaveProperty("error");
    expect(planPhotoEncode({ width: -4, height: 100 })).toHaveProperty("error");
    expect(planPhotoEncode({ width: NaN, height: 100 })).toHaveProperty("error");
    expect(planPhotoEncode()).toHaveProperty("error");
  });
});

// ------------------------------------------------------------------
// 【作り物は本物より甘くしない(罠19)】この作り物の canvas は
//  ・大きさを勝手に直さない ・drawImage の引数をそのまま覚える
//  ・toBlob に渡された type / quality をそのまま返す
// ので、「正方形に切った」「256 にした」「WebP にした」のどれが抜けても見える。
// **返る Blob が元のファイルでないこと**も見る ── 素通しを許すと EXIF が残る。
// ------------------------------------------------------------------
function fakeEnv({ width, height }) {
  const calls = { draw: null, canvas: null, toBlob: null, closed: false };
  const source = { width, height, close() { calls.closed = true; } };
  const deps = {
    loadImage: async (f) => { calls.file = f; return source; },
    makeCanvas: (w, h) => {
      calls.canvas = { width: w, height: h };
      return {
        width: w, height: h,
        getContext: () => ({
          drawImage: (...args) => { calls.draw = args; },
        }),
      };
    },
    toBlob: async (canvas, type, quality) => {
      calls.toBlob = { type, quality, from: canvas };
      // 本物の canvas.toBlob と同じく、**元のファイルではなく新しい Blob** を返す。
      return { size: 12345, type, __fromCanvas: canvas };
    },
  };
  return { calls, deps, source };
}

describe("encodeSquarePhoto ── 実際に走らせて何を描いたかを見る", () => {
  const FILE = { name: "photo.jpg", type: "image/jpeg", size: 4_000_000 };

  it("中央の正方形だけを 256×256 の canvas へ描く", async () => {
    const { calls, deps, source } = fakeEnv({ width: 4000, height: 3000 });
    await encodeSquarePhoto(FILE, deps);
    expect(calls.canvas).toEqual({ width: EDGE, height: EDGE });
    // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
    expect(calls.draw).toEqual([source, 500, 0, 3000, 3000, 0, 0, EDGE, EDGE]);
  });

  it("書き出しは WebP(元のファイルの形式に引きずられない)", async () => {
    const { calls, deps } = fakeEnv({ width: 1200, height: 1600 });
    const out = await encodeSquarePhoto(FILE, deps);
    expect(calls.toBlob.type).toBe(MIME);
    expect(out.type).toBe(MIME);
  });

  it("返るのは canvas が作った Blob で、元のファイルではない(= EXIF は運ばれない)", async () => {
    const { calls, deps } = fakeEnv({ width: 800, height: 800 });
    const out = await encodeSquarePhoto(FILE, deps);
    expect(out).not.toBe(FILE);
    expect(out.__fromCanvas).toBe(calls.toBlob.from);
  });

  it("縦長は上下を落とす(切り出しの向きを取り違えていない)", async () => {
    const { calls, deps, source } = fakeEnv({ width: 1080, height: 1920 });
    await encodeSquarePhoto(FILE, deps);
    expect(calls.draw).toEqual([source, 0, 420, 1080, 1080, 0, 0, EDGE, EDGE]);
  });

  it("上限を超えた書き出しは受け取らない", async () => {
    const { deps } = fakeEnv({ width: 800, height: 800 });
    const big = { ...deps, toBlob: async (c, type) => ({ size: 9_000_000, type }) };
    await expect(encodeSquarePhoto(FILE, big)).rejects.toThrow(/PHOTO_TOO_LARGE/);
  });

  it("書き出せなかったら失敗する(空のまま進まない)", async () => {
    const { deps } = fakeEnv({ width: 800, height: 800 });
    const nul = { ...deps, toBlob: async () => null };
    await expect(encodeSquarePhoto(FILE, nul)).rejects.toThrow(/PHOTO_ENCODE_FAILED/);
  });
});

describe("avatarPaint ── 写真と絵柄のどちらを描くか", () => {
  const ICON = { icon: "ic-cat", color: 3 };

  it("写真があれば写真を描く", () => {
    expect(avatarPaint({ ...ICON, photo: "https://example.test/a.webp" }))
      .toEqual({ kind: "photo", url: "https://example.test/a.webp" });
  });

  it("写真が無ければ絵柄と地の色を描く", () => {
    expect(avatarPaint(ICON)).toEqual({ kind: "icon", icon: "ic-cat", color: 3 });
    expect(avatarPaint({ ...ICON, photo: null })).toEqual({ kind: "icon", icon: "ic-cat", color: 3 });
  });

  it("空文字や空白だけの写真は「無い」として扱う(空の丸を出さない)", () => {
    expect(avatarPaint({ ...ICON, photo: "" }).kind).toBe("icon");
    expect(avatarPaint({ ...ICON, photo: "   " }).kind).toBe("icon");
  });

  it("文字列でない写真は「無い」として扱う", () => {
    expect(avatarPaint({ ...ICON, photo: 1 }).kind).toBe("icon");
    expect(avatarPaint({ ...ICON, photo: {} }).kind).toBe("icon");
    expect(avatarPaint({ ...ICON, photo: true }).kind).toBe("icon");
  });

  it("未知の絵柄・範囲外の色は既定へ落とす(色の無い丸を出さない)", () => {
    expect(avatarPaint({ icon: "ic-unicorn", color: 3 }).icon).toBe(AVATAR_ICONS[0]);
    expect(avatarPaint({ icon: "ic-cat", color: 0 }).color).toBe(1);
    expect(avatarPaint({ icon: "ic-cat", color: 11 }).color).toBe(1);
    expect(avatarPaint({ icon: "ic-cat", color: "3" }).color).toBe(1);
    expect(avatarPaint({}).icon).toBe(AVATAR_ICONS[0]);
  });
});

describe("photoZoomAvailable ── 拡大表示を出すか(決定5)", () => {
  const PHOTO = { photo: "https://example.test/a.webp", icon: "ic-cat", color: 3 };

  it("マイページの自分のアイコンは出す", () => {
    expect(photoZoomAvailable({ ...PHOTO, place: "mypage" })).toBe(true);
  });

  it("人物紹介の裏(プロフィール面)は出す", () => {
    expect(photoZoomAvailable({ ...PHOTO, place: "personBack" })).toBe(true);
  });

  it("表(音のデータ面)の名前の行では出さない ── 行全体がプロフィールへの入口", () => {
    expect(photoZoomAvailable({ ...PHOTO, place: "personFront" })).toBe(false);
  });

  it("順位・一覧の行では出さない ── 行全体がその人を開く", () => {
    expect(photoZoomAvailable({ ...PHOTO, place: "rank" })).toBe(false);
    expect(photoZoomAvailable({ ...PHOTO, place: "directory" })).toBe(false);
  });

  it("絵柄のときは、裏でもマイページでも出さない", () => {
    expect(photoZoomAvailable({ icon: "ic-cat", color: 3, place: "mypage" })).toBe(false);
    expect(photoZoomAvailable({ icon: "ic-cat", color: 3, photo: null, place: "personBack" })).toBe(false);
  });

  it("場所が未知のときは出さない(既定で出す側へ倒さない)", () => {
    expect(photoZoomAvailable({ ...PHOTO, place: "gear" })).toBe(false);
    expect(photoZoomAvailable({ ...PHOTO, place: undefined })).toBe(false);
    expect(photoZoomAvailable({ ...PHOTO })).toBe(false);
  });
});

describe("photoFailureKind ── 文言の出し分け(決定3)", () => {
  it("関数が拒んだものは「判定で落ちた」", () => {
    expect(photoFailureKind({ code: "functions/failed-precondition", message: "photo-rejected" })).toBe("rejected");
    expect(photoFailureKind({ code: "functions/invalid-argument" })).toBe("rejected");
  });
  it("端末側で書き直せなかったものも「判定で落ちた」(同じ写真では通らない)", () => {
    expect(photoFailureKind(new Error("PHOTO_ENCODE_FAILED"))).toBe("rejected");
    expect(photoFailureKind(new Error("PHOTO_TOO_LARGE"))).toBe("rejected");
  });
  // 【中8 2026-09-23 審査役の指摘】HEIC を開けない端末では**必ず**ここに来る。
  // 「電波の良いところで」と案内すると、電波を変えても永久に直らない行き止まりになる。
  it("復号できなかったものは「読み取れなかった」── 通信の失敗にしない", () => {
    expect(photoFailureKind(new Error("PHOTO_UNREADABLE"))).toBe("unreadable");
    const dom = new Error("The source image could not be decoded");
    dom.name = "EncodingError";
    expect(photoFailureKind(dom)).toBe("unreadable");
    const dom2 = new Error("The source image could not be decoded");
    dom2.name = "DOMException"; // 名前が違っても本文で拾う
    expect(photoFailureKind(dom2)).toBe("unreadable");
    expect(photoFailureKind(new Error("Unsupported image format"))).toBe("unreadable");
  });
  it("それ以外は「通信で落ちた」", () => {
    expect(photoFailureKind({ code: "functions/unavailable" })).toBe("network");
    expect(photoFailureKind(new Error("network error"))).toBe("network");
    expect(photoFailureKind(null)).toBe("network");
  });
  it("読み取れない失敗には、通信とは別の文言が用意されている", () => {
    const comm = read("./CommunityTab.jsx");
    expect(comm).toMatch(/const PHOTO_READ_ERROR = "[^"]+";/);
    const m = /const PHOTO_READ_ERROR = "([^"]+)";/.exec(comm);
    expect(m[1]).not.toContain("電波");
    expect(comm).toMatch(/unreadable: PHOTO_READ_ERROR/);
  });
});

// ------------------------------------------------------------------
// 【重2 2026-09-23 審査役の指摘】
// 「色を試してから、やっぱり写真にする」順で、成功表示が出た写真が黙って消えていた。
// 手順を**そのまま並べて**確かめる。
// ------------------------------------------------------------------
describe("avatarWriteOnClose ── シートを閉じたときに何を書くか", () => {
  const URL_A = "https://example.test/a.webp";
  const URL_B = "https://example.test/b.webp";
  const SAVED = { icon: "ic-cat", iconColor: 1, photo: null };

  it("何も変えずに閉じたら書かない", () => {
    expect(avatarWriteOnClose({ draft: { icon: "ic-cat", iconColor: 1, photo: null }, saved: SAVED })).toBeNull();
  });

  it("絵柄を変えたら、絵柄と色と「写真は無い」を書く", () => {
    expect(avatarWriteOnClose({ draft: { icon: "ic-dog", iconColor: 1, photo: null }, saved: SAVED }))
      .toEqual({ icon: "ic-dog", iconColor: 1, photo: null });
  });

  it("写真が載っている人が絵柄を選んだら、写真を消す答えになる(決定4)", () => {
    const w = avatarWriteOnClose({
      draft: { icon: "ic-dog", iconColor: 1, photo: null },
      saved: { icon: "ic-cat", iconColor: 1, photo: URL_A },
    });
    expect(w).toEqual({ icon: "ic-dog", iconColor: 1, photo: null });
  });

  // ★ 重2 の再現。この順序が前は写真を消していた。
  it("色を変えてから写真を選んで閉じても、写真を消さない", () => {
    // ① 開く: 下書き = 保存されている物
    // ② 色を押す → 下書きの写真は null になる(決定4 のとおり)
    // ③ 写真枠から選んで成功 → 下書きにも保存側にも新しい写真が載る
    // ④ 閉じる
    const w = avatarWriteOnClose({
      draft: { icon: "ic-cat", iconColor: 7, photo: URL_B },
      saved: { icon: "ic-cat", iconColor: 1, photo: URL_B },
    });
    expect(w).not.toBeNull();            // 色が変わったので書く
    expect(w.iconColor).toBe(7);
    expect(w.photo).toBe(URL_B);         // **null ではない** ── 写真を消さない
  });

  it("写真だけが載ったなら、閉じても何も書かない(サーバが既に書いている)", () => {
    expect(avatarWriteOnClose({
      draft: { icon: "ic-cat", iconColor: 1, photo: URL_A },
      saved: { icon: "ic-cat", iconColor: 1, photo: URL_A },
    })).toBeNull();
  });

  it("下書きが組み上がっていない(開いていない)ときは書かない", () => {
    expect(avatarWriteOnClose({ draft: { icon: null, iconColor: null, photo: null }, saved: SAVED })).toBeNull();
    expect(avatarWriteOnClose()).toBeNull();
  });

  it("保存されている側の既定(絵柄の先頭・色1)と比べる", () => {
    expect(avatarWriteOnClose({ draft: { icon: AVATAR_ICONS[0], iconColor: 1, photo: null }, saved: {} })).toBeNull();
    expect(avatarWriteOnClose({ draft: { icon: AVATAR_ICONS[1], iconColor: 1, photo: null }, saved: {} })).not.toBeNull();
  });
});

// ------------------------------------------------------------------
// 配線。**純関数を守っても、描画側が正しい引数で呼ばなければ意味がない**(罠2)。
// 錨は「呼び出しに隣接する綴り」にする。
// ------------------------------------------------------------------
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
// 行コメントと /* */ を落とす。**綴りを数える検査はコメントを剥がしてから**
// (剥がさないと、規則を説明している注釈そのものが数に入る)。
const codeOf = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("配線 ── 判断を通らずに描く経路が無い", () => {
  it("Avatar() は avatarPaint の答えだけを見て描く", () => {
    const icons = read("./icons.jsx");
    const fn = (icons.match(/export function Avatar\(\{[\s\S]*?\n\}/) || [""])[0];
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).toMatch(/avatarPaint\(\{ photo, icon, color \}\)/);
    // 写真のときは <img>、絵柄のときは <use>。どちらも paint.kind の分岐の中にある。
    expect(fn).toMatch(/paint\.kind === "photo"/);
    expect(fn).toMatch(/src=\{paint\.url\}/);
    expect(fn).toMatch(/href=\{`#\$\{paint\.icon\}`\}/);
    expect(fn).toMatch(/var\(--c-avatar-\$\{paint\.color\}\)/);
  });

  it("拡大表示の出し分けは photoZoomAvailable に通してある(2箇所とも)", () => {
    const comm = read("./CommunityTab.jsx");
    const screens = read("./screens.jsx");
    expect(comm).toMatch(/photoZoomAvailable\(\{[\s\S]{0,200}?place: "mypage"/);
    // 裏は1枚のシートが表と裏を兼ねるので、場所の名前を側で切り替えて渡す。
    expect(screens).toMatch(/photoZoomAvailable\(\{[\s\S]{0,300}?side === "profile" \? "personBack" : "personFront"/);
  });

  it("裏のアイコンも写真を受け取る(渡し漏れがあれば絵柄が出てしまう)", () => {
    const screens = read("./screens.jsx");
    // 綴りは1つ。押せる器で包むかどうかだけが変わる。
    expect(screens).toMatch(/const personAvatar = \([\s\S]{0,300}?photo=\{personPhoto\}/);
    expect(screens).toMatch(/\{canZoomPerson \? \([\s\S]{0,300}?\{personAvatar\}[\s\S]{0,60}?\) : personAvatar\}/);
    // 順位・一覧の行も写真を渡す(ここが抜けると自分だけ絵柄で並ぶ)。
    expect((screens.match(/photo=\{row\.photo \?\? null\}/g) || []).length).toBe(2);
    expect(screens).toMatch(/photo=\{owner\.photo \?\? null\}/);
  });

  // 【中4 2026-09-23】正典 CommPhotoZoom.dc.html は 343px(= 375 − --sp-4 × 2)。
  // max-* だけだと 256px の素の大きさで出る ── 幅を取る指定が要る。
  it("拡大表示は器の内側いっぱいに広がる(正典と同じ幅になる)", () => {
    const zoom = read("./PhotoZoom.jsx");
    expect(zoom).toMatch(/width: "100%", maxWidth: "100%", maxHeight: "100%"/);
    expect(zoom).toMatch(/padding: "var\(--sp-4\)"/);
    const canon = readFileSync(fileURLToPath(new URL("../../design/canvas/CommPhotoZoom.dc.html", import.meta.url)), "utf8");
    expect(canon).toContain("width: 343px");   // 375 − 16 × 2
  });

  // 【中6 2026-09-23】BottomSheet も window に keydown を張る。捕捉の段で打ち切らないと
  // 人物紹介シートの中で拡大を開いたとき、Escape が2枚とも閉じる。
  it("Escape で閉じるのは拡大の1枚だけ(捕捉の段で伝播を打ち切る)", () => {
    const zoom = read("./PhotoZoom.jsx");
    expect(zoom).toMatch(/e\.stopImmediatePropagation\(\);/);
    expect(zoom).toMatch(/window\.addEventListener\("keydown", onKey, true\)/);
    expect(zoom).toMatch(/window\.removeEventListener\("keydown", onKey, true\)/);
  });

  // 【中7 2026-09-23】マイページの拡大は BottomSheet を通らないので、自分で止める。
  it("拡大中は裏の画面が動かない(数える仕組みは App.jsx の1つ)", () => {
    const zoom = read("./PhotoZoom.jsx");
    expect(zoom).toMatch(/import \{ useBackdropScrollLock \} from "\.\.\/App\.jsx";/);
    expect(zoom).toMatch(/useBackdropScrollLock\(\);/);
    const app = readFileSync(fileURLToPath(new URL("../App.jsx", import.meta.url)), "utf8");
    // 写しを作っていない(定義は1つだけ)。
    expect((app.match(/function useBackdropScrollLock\(\)/g) || [])).toHaveLength(1);
    expect(app).toMatch(/export function useBackdropScrollLock\(\)/);
  });

  it("端末側の書き直しを通らずに送る経路が無い(送る前に必ず encodeSquarePhoto)", () => {
    const comm = read("./CommunityTab.jsx");
    const repo = read("./photoRepo.js");
    expect(comm).toMatch(/encodeSquarePhoto\(/);
    // 送る側は Blob しか受け取らない。File をそのまま渡す道を作らない。
    expect(repo).toMatch(/uploadBytes\(/);
    expect(repo).not.toMatch(/uploadString\(/);
  });

  it("「確認中 / 保留 / pending」に相当する綴りがアイコンまわりに無い(決定3)", () => {
    // 【コメントを剥がしてから数える】「保留を作らない」と**説明している注釈**が
    // 数に入ると、実際に保留を作っても通ってしまう(report.test.js が踏んだ形)。
    const files = ["./avatarPhoto.js", "./photoRepo.js", "./icons.jsx", "./PhotoZoom.jsx"];
    for (const f of files) {
      expect(codeOf(read(f)), f).not.toMatch(/確認中|保留|pending|reviewing/i);
    }
    // 画面側は通報の告知(既存)で「確認」の語を使うが、写真の状態は持たない。
    const comm = read("./CommunityTab.jsx");
    expect(comm.match(/photoStatus|photoPending|photoReview/g)).toBeNull();
  });
});
