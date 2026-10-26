// 【便DH 2026-10-26 本人の指示「カードの文の不自然な改行を直す」】はじめの案内のカードの文を、文節の切れ目だけで折り返すための純関数。
//
// 【なぜ要るか】日本語は、規則が無ければほぼ文字と文字の間のどこでも折り返される(禁則の文字だけ避ける)。カードは幅が 299〜326px 前後で
// 見出しは 1 行に 16〜18 字しか入らないので、助詞や語の途中で切れる(「…の音を分|析しよう！」「…あ|なたのデータを…」)。
// CSS だけでは直らない: text-wrap: balance は行の長さをそろえるだけで切れ目の位置を選ばない。word-break: auto-phrase は
// Chrome にしか無い(Safari 相当の iOS の WebView で頼れない)。なので**文節の切れ目の位置を文のほうが持ち**(この関数)、
// 描く側が <wbr> を置き、CSS(index.css の .coach-text)が「<wbr> と空白のほかでは折り返さない」(word-break: keep-all)にする。
//
// 【規則】文節の切れ目 = 助詞(から・まで・より・は・が・を・に・で・と・の・も・へ・や)の直後、て の直後、読点・句点の直後。
//   ・助詞の直前の字が漢字・カタカナ・英数・呼び名なら切る。直前がひらがななら、直後がひらがなでないときだけ切る
//     (「ここに|貯まります」「みんなの|平均を」は切る。「ここに」「この|リード」「してみよう」「ことができます」は切らない)
//   ・て は直後がひらがなでないときだけ(「見て|{呼び名}の」は切る。「見てみよう」は切らない)
//   ・「できます」「やすい」「もう」「にくい」「です」「でした」の頭の字は助詞ではないので切らない(【便DJ】「終了です」を「終了で|す」にしない)
//   ・文の終わりの前・行頭に来ない字(、。！？ など)の前では切らない
// 呼び名({call}。コミュニティの「ニックネーム + さん」/ 無ければ「あなた」)は、切れ目を数えるあいだ**1字の漢字扱い**にして、
// 切らずに1つの塊として運ぶ(「Ficusで|たろうさんの|音を|…」)。呼び名の中に助詞があっても切らない。

// 文の中で呼び名が入る場所の綴り。COACH_STEPS の文はこの綴りを持つ(onboarding.jsx)。
export const CALL_SLOT = "{call}";
// 切れ目を数えるあいだだけ呼び名の代わりに置く字(私用領域の1字。ひらがなでも閉じ字でもない)
const SLOT_CHAR = String.fromCharCode(0xe000);

// ひらがな(U+3041〜U+309F)
const HIRAGANA = new RegExp(`[${String.fromCharCode(0x3041)}-${String.fromCharCode(0x309f)}]`);
// 行頭に来ない字(この字の前では切らない)
const NO_LINE_START = "、。，．！？!?)）」』】…ー";
// 長いものから先に当てる
const PARTICLES = ["から", "まで", "より", "は", "が", "を", "に", "で", "と", "の", "も", "へ", "や"];
// 助詞の綴りに見えて助詞ではない語の頭
const NOT_PARTICLE = ["でき", "やす", "もう", "にく", "です", "でし"];
const STOPS = "、。";

// 呼び名を1字({SLOT_CHAR})に置いた文を、文節ごとの配列にする。
function splitMarked(marked) {
  const chars = [...marked];
  const cuts = new Set();   // 「この添字の直前で切る」
  const hira = (c) => c !== undefined && HIRAGANA.test(c);
  const closer = (c) => c === undefined || NO_LINE_START.includes(c);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (STOPS.includes(c)) { if (!closer(chars[i + 1])) cuts.add(i + 1); continue; }
    if (i === 0) continue;
    const rest = chars.slice(i).join("");
    if (NOT_PARTICLE.some((w) => rest.startsWith(w))) continue;
    // て … 直後がひらがなでないときだけ(「見て|{呼び名}の」は切る。「見てみよう」は切らない)
    if (c === "て") { if (!hira(chars[i + 1]) && !closer(chars[i + 1])) cuts.add(i + 1); continue; }
    const p = PARTICLES.find((w) => rest.startsWith(w));
    if (!p) continue;
    const end = i + [...p].length;
    const next = chars[end];
    if (closer(next)) { i = end - 1; continue; }
    if (hira(chars[i - 1])) {
      // 直前がひらがな(「ここに」「まずは」「みんなの」)は語の中のことが多いので、直後がひらがなでないとき(次の文節が漢字・カタカナ・英数で始まる)だけ切る。
      // 「この・その・あの・どの」は次の語と1つ(切らない)
      if (hira(next)) continue;
      if (p === "の" && "こそあど".includes(chars[i - 1]) && (i - 1 === 0 || !hira(chars[i - 2]))) continue;
    }
    cuts.add(end);
    i = end - 1;
  }
  const out = [];
  let start = 0;
  for (const at of [...cuts].sort((a, b) => a - b)) { out.push(chars.slice(start, at).join("")); start = at; }
  out.push(chars.slice(start).join(""));
  return out;
}

// 文(COACH_STEPS の title / line。{call} を含むことがある)と呼び名から、文節ごとの配列(呼び名は差し替え済み)を返す。
// 配列を全部つなぐと resolveCoachText(text, call) と同じ文字列になる(切れ目は文字を足さない = 画面の textContent も読み上げも変わらない)。
export function coachPhrasesOf(text, call = "あなた") {
  const marked = String(text ?? "").split(CALL_SLOT).join(SLOT_CHAR);
  return splitMarked(marked).map((ph) => ph.split(SLOT_CHAR).join(call));
}

// 文の {call} を呼び名に差し替えた1つの文字列(読み上げ・検査用)。
export function resolveCoachText(text, call = "あなた") {
  return String(text ?? "").split(CALL_SLOT).join(call);
}
