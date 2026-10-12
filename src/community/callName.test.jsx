// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeIndexedDb } from "../backup/fakeIndexedDb.testutil.js";

// ------------------------------------------------------------------
// 【便CP 2026-10-12 本人指示】コミュニティタブで利用者を「あなた」と呼んでいた所を「ニックネーム + さん」に。
//   ・みんなの平均カードの1行   「○○さんの計測データもお待ちしています」
//   ・人物のページ(データ面)の1行 同上
//   ・ブロックの確認のシートの本文 「ブロックすると、この奏者のデータは○○さんのコミュニティから非表示になります。…」
//   ・ニックネームが無いとき(文字列でない・空・空白だけ)は「あなた」のまま
//   ・順位とデータの一覧の自分の行の札「あなた」は変えない(同じ行にニックネームが出ているので、呼び名にすると名前が2回並ぶ)
// **本物の画面(JoinedView)を描いて押す。** ニックネームは JoinedView が持つ profile.nickname から届く(新しく読まない)。
// サーバーは作り物(directory / reportRepo / idealRepo)。IndexedDB も作り物(blockJoined.test.jsx と同じ)。
// 【守っていないもの】ブラウザでの折り返しの見た目(jsdom は寸法を持たない ── 文の要素が1行に閉じ込める style を
//   持たないことだけを見る)。アカウント削除のあとの知らせ(DELETE_PARTIAL_NOTICE)は削除後でニックネームが無いので
//   「あなた」のまま・変えていない(この検査は見ない)。
// ------------------------------------------------------------------

const fakeIdb = createFakeIndexedDb();
globalThis.indexedDB = fakeIdb;

vi.mock("./directory.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return { ...(await orig()), listPublicUsers: vi.fn(async () => kit.SERVER_USERS), publishStats: vi.fn(async () => {}) };
});
vi.mock("./reportRepo.js", async () => ({
  reportUser: vi.fn(async () => ({ already: false })),
}));
vi.mock("./idealRepo.js", async (orig) => {
  const kit = await import("./blockKit.testutil.jsx");
  return {
    ...(await orig()),
    listIdeals: vi.fn(async () => kit.SERVER_IDEALS),
    publishMyIdeals: vi.fn(async () => {}), unpublishAllIdeals: vi.fn(async () => {}),
  };
});

const { JoinedView } = await import("./CommunityTab.jsx");
const { warmPersistedStateCache } = await import("../App.jsx");
const { callNameOf, mineWaitingNoteOf, blockNoteEffectOf } = await import("./screens.jsx");
const { validateNickname } = await import("./profile.js");
const kit = await import("./blockKit.testutil.jsx");
const { setupDom, teardownDom, drawJoined, bodyText, buttonsNamed, dialogNamed, rankRowOf, click } = kit;

beforeEach(setupDom);
afterEach(teardownDom);

// 期待値はここに文字で書く(画面の関数から逆算しない)。
const waitLine = (who) => `${who}の計測データもお待ちしています`;
const blockLine = (who) => `ブロックすると、この奏者のデータは${who}のコミュニティから非表示になります。相手には通知されません。`;
// 文の要素(div)のうち、中身がちょうどその文のもの
const divsSaying = (text) => [...document.querySelectorAll("div")].filter((d) => d.textContent === text);

// 自分の行の札(NameLine の2つ目の span)。順位の行の中で、文字がちょうど「あなた」の span
const myBadges = () => [...document.querySelectorAll("span")].filter((s) => s.textContent === "あなた");

// みんなの平均カードの1行・人物のページの1行・ブロックの確認の本文を、画面を押して順に集める。
async function collectLines(profile) {
  await drawJoined(JoinedView, { profile, initialTab: "data" }, undefined, warmPersistedStateCache);
  const avg = bodyText();
  // 人物のページ(データ面)を開く。自分の計測は無い(sessions = [])ので、自分の線は出ず1行が出る
  await click(rankRowOf("しろねこ"));
  const sheet = dialogNamed("しろねこ の詳細");
  expect(sheet).not.toBe(null);
  const person = sheet.textContent;
  // 人物のページの1行の要素(葉の div)。プロフィール面へ移ると消えるので、文字と style をここで写しておく
  const personNotes = [...sheet.querySelectorAll("div")]
    .filter((d) => d.children.length === 0 && d.textContent.endsWith("の計測データもお待ちしています"))
    .map((d) => ({ textContent: d.textContent, style: { whiteSpace: d.style.whiteSpace, textOverflow: d.style.textOverflow } }));
  await click([...sheet.querySelectorAll('[role="radio"]')].find((b) => b.textContent.trim() === "プロフィール"));
  await click(buttonsNamed("ブロック")[0]);
  const confirm = dialogNamed("しろねこ をブロックしますか");
  expect(confirm).not.toBe(null);
  const blockTexts = [...confirm.querySelectorAll("div.sans")].map((x) => x.textContent);
  return { avg, person, personNotes, blockTexts };
}

describe("呼び名(callNameOf)", () => {
  it("ニックネームがあれば「ニックネーム + さん」(全角の「さん」をそのまま付ける。中の空白は保存された綴りのまま)", () => {
    expect(callNameOf("たろう")).toBe("たろうさん");
    expect(callNameOf("Taro")).toBe("Taroさん");
    expect(callNameOf("た ろう")).toBe("た ろうさん");
  });
  it("ニックネームが無い(null・undefined・空・空白だけ・文字列でない)ときは「あなた」", () => {
    for (const v of [null, undefined, "", " ", "　", 0, {}, []]) expect([v, callNameOf(v)]).toEqual([v, "あなた"]);
  });
  it("文の組み立て: 1行とブロックの本文は呼び名を差し込むだけ(ほかの綴りは便CP の前と同じ)", () => {
    expect(mineWaitingNoteOf("たろう")).toBe("たろうさんの計測データもお待ちしています");
    expect(mineWaitingNoteOf(null)).toBe("あなたの計測データもお待ちしています");
    expect(blockNoteEffectOf("たろう")).toBe("ブロックすると、この奏者のデータはたろうさんのコミュニティから非表示になります。相手には通知されません。");
    expect(blockNoteEffectOf(null)).toBe("ブロックすると、この奏者のデータはあなたのコミュニティから非表示になります。相手には通知されません。");
  });
});

describe("コミュニティの画面: 自分のニックネームがあれば「○○さん」", () => {
  it("みんなの平均カード・人物のページ・ブロックの確認の3か所とも「じぶんさん」。「あなたの」はどこにも無い。行の札は「あなた」のまま", { timeout: 30000 }, async () => {
    const { avg, person, blockTexts } = await collectLines(kit.MY_PROFILE); // nickname: "じぶん"
    expect(avg).toContain(waitLine("じぶんさん"));
    expect(avg).not.toContain("あなたの");
    // 平均カードの1行は台紙の読み上げの説明(aria-describedby)からも指されている(読み上げも同じ呼び名)
    const [note] = divsSaying(waitLine("じぶんさん")).filter((d) => d.id);
    expect(note).toBeTruthy();
    const describedBy = [...document.querySelectorAll("[aria-describedby]")].filter((el) => el.getAttribute("aria-describedby").split(" ").includes(note.id));
    expect(describedBy).toHaveLength(1);
    expect(person).toContain(waitLine("じぶんさん"));
    expect(person).not.toContain("あなたの");
    expect(blockTexts).toEqual([
      "しろねこ をブロックしますか",
      blockLine("じぶんさん"),
      "マイページの「ブロック中の人」から、いつでも解除できます。",
    ]);
    // 画面全体(シートを含む)に「あなたの」は無い
    expect(bodyText()).not.toContain("あなたの");
  });

  it("順位の自分の行の札は「あなた」のまま(同じ行に名前「じぶん」が出ているので、「じぶんさん」にして名前を2回並べない)", { timeout: 30000 }, async () => {
    // 自分の練習記録が1日ぶんあれば、順位に自分の行が出る(数えるのはこの端末 ── computePracticeStats)
    const sessions = [{ recordedAt: new Date(Date.now() - 86_400_000).toISOString(), durationSec: 60 }];
    await drawJoined(JoinedView, { sessions, initialTab: "rank" }, undefined, warmPersistedStateCache);
    const badges = myBadges();
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) {
      // 札の1つ前の兄弟が名前(NameLine)。名前は「じぶん」、札は「あなた」
      expect(b.previousElementSibling?.textContent).toBe("じぶん");
    }
    expect([...document.querySelectorAll("span")].some((x) => x.textContent === "じぶんさん")).toBe(false);
  });

  it("長いニックネーム(20文字)は省かずに文の中で出し、1行に閉じ込めない(折り返してよい)", { timeout: 30000 }, async () => {
    const LONG = "あいうえおかきくけこさしすせそたちつてと";
    expect([...LONG]).toHaveLength(20);
    expect(validateNickname(LONG).value).toBe(LONG); // 登録できる長さの上限ちょうど
    const { avg, person, personNotes, blockTexts } = await collectLines({ ...kit.MY_PROFILE, nickname: LONG });
    expect(avg).toContain(waitLine(`${LONG}さん`));
    expect(person).toContain(waitLine(`${LONG}さん`));
    expect(blockTexts[1]).toBe(blockLine(`${LONG}さん`));
    // 文の要素は折り返しを止めない(nowrap / ellipsis を持たない)
    // 平均カードの1行・人物のページの1行・ブロックの本文の3つ
    const els = [...divsSaying(waitLine(`${LONG}さん`)), ...personNotes, ...divsSaying(blockLine(`${LONG}さん`))];
    expect(els.map((e) => e.textContent)).toEqual([waitLine(`${LONG}さん`), waitLine(`${LONG}さん`), blockLine(`${LONG}さん`)]);
    for (const el of els) {
      expect(el.style.whiteSpace).not.toBe("nowrap");
      expect(el.style.textOverflow).toBe("");
    }
  });
});

describe("コミュニティの画面: ニックネームが無ければ「あなた」のまま", () => {
  for (const [name, nickname] of [["無い(undefined)", undefined], ["空", ""], ["空白だけ", "  "]]) {
    it(`ニックネームが${name}: 3か所とも「あなた」`, { timeout: 30000 }, async () => {
      const { avg, person, blockTexts } = await collectLines({ ...kit.MY_PROFILE, nickname });
      expect(avg).toContain(waitLine("あなた"));
      expect(person).toContain(waitLine("あなた"));
      expect(blockTexts[1]).toBe(blockLine("あなた"));
      expect(bodyText()).not.toContain("さんの計測データ");
      expect(bodyText()).not.toContain("さんのコミュニティ");
    });
  }
});
