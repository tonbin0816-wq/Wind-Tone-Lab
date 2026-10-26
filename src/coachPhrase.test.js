import { describe, it, expect } from "vitest";
import { COACH_STEPS } from "./onboarding.jsx";
import { coachPhrasesOf, resolveCoachText, CALL_SLOT } from "./coachPhrase.js";

// ------------------------------------------------------------------
// 【便DH 2026-10-26 本人の指示「カードの文の不自然な改行を直す」】文節の切れ目(coachPhrasesOf)。
// 期待値は日本語の文節(自立語 + 助詞)の区切りとして**手で書いた**(関数の出力から写していない)。
// 守っているもの: 案内の全部の文(24段の見出し・1行)の切れ目の位置 / 切れ目は文字を足さない / 語の途中・行頭に来ない字の前では切らない / 呼び名は1つの塊。
// 守っていないもの: 実際の折り返しの位置(幅 × 字の幅で決まる。Chrome の実測は報告の表・iOS の WebView は実機待ち)。
// ------------------------------------------------------------------

// 段ごとの [見出しの文節, 1行の文節(無ければ null)]。呼び名({call})は「たろうさん」で数える。
const PHRASES = {
  tuner: [["まずは", "吹いてみよう"], ["音程が", "リアルタイムで", "表示されます"]],
  metronome: [["メトロノームを", "使ってみよう"], null],
  metroTempo: [["テンポを", "決めよう"], ["下の", "テンポ表示から", "拍子の", "変更も", "できます"]],
  metroStart: [["タップで", "スタート"], ["もう一度押すと", "止まります"]],
  goReeds: [["リードを", "登録しよう"], null],
  reedLinked: [["選んだリードが", "紐づいています"], null],
  measureReed: [["このリードで", "計測してみよう"], ["ボタンタップで", "計測スタート"]],
  measure: [["最初の", "計測を", "記録しよう"], ["ボタンタップで", "計測スタート"]],
  goData: [["計測の", "記録を", "見てみよう"], null],
  finish: [["Ficusで", "たろうさんの", "音を", "分析しよう！"], ["これで", "チュートリアルは", "終了です"]],   // 【便DJ】補足文
  arriveReeds: [["ここは", "リードタブ"], ["自分の", "リードを", "管理できます"]],
  arriveData: [["ここは", "データタブ"], ["計測の", "記録は", "ここに", "貯まります"]],
  arriveCommunity: [["ここは", "コミュニティ"], ["他の", "奏者の", "データを", "見て", "たろうさんの", "データと", "比較できます"]],
  goCommunity: [["みんなの", "データも", "見てみよう"], null],
  goMeasure: [["計測タブに", "戻ろう"], null],
  goCompare: [["目安と", "比べてみよう"], null],
  reeds: [["使っているリードを", "登録しよう"], ["登録したリードは", "計測に", "紐づけることができます"]],
  reedsMeasure: [["このリードで", "計測してみよう"], null],
  data: [["計測を", "始めると、", "ここに", "貯まります"], ["計測タブから", "計測してみよう"]],
  calendarDay: [["計測した日を", "押してみよう"], null],
  daySession: [["記録を", "開いてみよう"], null],
  trend: [["データが", "溜まると、", "平均が", "ここに", "グラフで", "出ます"], null],
  idealSeen: [["みんなの", "平均を", "目安に", "しました"], ["my平均と", "目安を", "重ねて", "見られます"]],
  adoptAverage: [["みんなの", "平均を", "目安に", "してみよう"], ["目安に", "設定すると", "自分の", "音と", "比べられます"]],
};

describe("【便DH】案内の全部の文の文節の切れ目", () => {
  it("手で書いた表が COACH_STEPS の全段(24)を過不足なく覆っている", () => {
    expect(Object.keys(PHRASES).sort()).toEqual(Object.keys(COACH_STEPS).sort());
    expect(Object.keys(PHRASES)).toHaveLength(24);
  });
  for (const [id, [title, line]] of Object.entries(PHRASES)) {
    it(`${id}: 見出し・1行の切れ目`, () => {
      expect(coachPhrasesOf(COACH_STEPS[id].title, "たろうさん")).toEqual(title);
      if (line === null) expect(COACH_STEPS[id].line).toBe(null);
      else expect(coachPhrasesOf(COACH_STEPS[id].line, "たろうさん")).toEqual(line);
    });
  }
});

describe("【便DH】切れ目の規則", () => {
  const allTexts = () => Object.values(COACH_STEPS).flatMap((s) => [s.title, s.line]).filter((t) => typeof t === "string");
  it("切れ目は文字を足さない: つないだ文字列は resolveCoachText と同じ(呼び名が「たろうさん」でも「あなた」でも)", () => {
    for (const t of allTexts()) {
      for (const call of ["たろうさん", "あなた", "Taroさん"]) expect(coachPhrasesOf(t, call).join("")).toBe(resolveCoachText(t, call));
    }
    expect(resolveCoachText("Ficusで{call}の音を分析しよう！", "たろうさん")).toBe("Ficusでたろうさんの音を分析しよう！");
  });
  it("語の途中では切らない: 次の語は1つの文節の中に残る(カタカナ語・熟語・活用)", () => {
    const WORDS = ["リアルタイム", "メトロノーム", "コミュニティ", "リードタブ", "データタブ", "分析しよう", "管理できます", "比較できます", "表示されます", "貯まります", "計測スタート", "テンポ表示", "ボタンタップ", "記録しよう", "登録しよう", "紐づけることができます", "してみよう", "見られます", "比べられます", "止まります"];
    const cut = (t) => coachPhrasesOf(t, "たろうさん");
    for (const t of allTexts()) {
      const phrases = cut(t);
      for (const w of WORDS) {
        if (!resolveCoachText(t, "たろうさん").includes(w)) continue;
        expect(phrases.some((p) => p.includes(w)), `${t} は「${w}」を1つの文節の中に持つ`).toBe(true);
      }
    }
  });
  it("文節が行頭に来てはいけない字(、。！？ー)で始まらない。空の文節は無い。「、」「。」の前では切らない", () => {
    for (const t of allTexts()) {
      for (const call of ["たろうさん", "あなた"]) {
        const ps = coachPhrasesOf(t, call);
        expect(ps.every((p) => p.length > 0), t).toBe(true);
        expect(ps.every((p) => !/^[、。，．！？!?)）」』】…ー]/.test(p)), t).toBe(true);
      }
    }
  });
  it("「、」は直後で切る(「溜まると、|平均が」)。助詞の直前の字がひらがなのとき(ここに・まずは・この)は直後がひらがななら切らない", () => {
    expect(coachPhrasesOf("計測を始めると、ここに貯まります")).toEqual(["計測を", "始めると、", "ここに", "貯まります"]);
    expect(coachPhrasesOf("ここにあります")).toEqual(["ここにあります"]);
    expect(coachPhrasesOf("このリードで")).toEqual(["このリードで"]);   // 「この」は次の語と1つ
    expect(coachPhrasesOf("その人のために")).toEqual(["その人の", "ために"]);
  });
  it("「て」は直後がひらがなでないときだけ切る(「見て|たろうさんの」は切る。「見てみよう」は切らない)", () => {
    expect(coachPhrasesOf("データを見て{call}のデータ", "たろうさん")).toEqual(["データを", "見て", "たろうさんの", "データ"]);
    expect(coachPhrasesOf("記録を見てみよう")).toEqual(["記録を", "見てみよう"]);
  });
  it("「できます」「やすい」「です」「でした」の頭は助詞ではないので切らない(「管理で|きます」「終了で|す」にならない)", () => {
    expect(coachPhrasesOf("終了です")).toEqual(["終了です"]);
    expect(coachPhrasesOf("終了でした")).toEqual(["終了でした"]);
    expect(coachPhrasesOf("管理できます")).toEqual(["管理できます"]);
    expect(coachPhrasesOf("見やすい画面")).toEqual(["見やすい画面"]);
  });
  it("呼び名は1つの塊: 中に助詞(の・と)が入っていても切らない。長い(20字)呼び名も同じ", () => {
    const call = "山の上のうさぎの太郎と花子の会のひとびとさん";
    expect(coachPhrasesOf("Ficusで{call}の音を分析しよう！", call)).toEqual(["Ficusで", `${call}の`, "音を", "分析しよう！"]);
    expect(coachPhrasesOf("Ficusで{call}の音を分析しよう！")).toEqual(["Ficusで", "あなたの", "音を", "分析しよう！"]);
  });
  it("呼び名の綴り {call} は1つだけ決まっている(文の側と同じ綴り)", () => {
    expect(CALL_SLOT).toBe("{call}");
    expect(coachPhrasesOf(undefined)).toEqual([""]);
  });
});
