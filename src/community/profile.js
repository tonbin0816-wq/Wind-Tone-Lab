import { findNgWord } from "./ngwords/filter.js";
import { isValidInstrument, isValidMouthpiece, isValidLigature, isValidReed } from "./catalog/gear.js";

// spec §4.1 の選択肢。文言を変えるときは設計書も直すこと。
//
// 【firestore.rules に同じ列挙の写しがある】計画1に Cloud Functions は無いので、
// サーバ側でこれを検査できる場所はセキュリティルールしかない。ルール側が「文字列」までしか
// 見ないと、生SDKを叩く相手が position などに自由文を入れられてしまい、
// 設計書 §8.1 の「通報の対象はニックネームだけ」が崩れる。
// **ここを足し引きしたら firestore.rules の該当行も必ず直すこと**(逆も同じ)。
// 食い違いは profile.test.js の「Firestore ルールの列挙と一致する」が検出する。
export const SAX_TYPES = ["soprano", "alto", "tenor", "baritone"];
// 画面に出す表示名。CommunityTab.jsx にも同じ地図があったが、機材の照合エラーが
// 「どの楽器の話か」を言えないと直しようがないので、こちら(判断を持つ側)へ移して1つにした。
export const SAX_LABELS = { soprano: "Soprano", alto: "Alto", tenor: "Tenor", baritone: "Baritone" };
export const POSITIONS = ["学生", "学生（音大）", "社会人", "講師・プロ", "独学"];
export const GENRES = ["クラシック", "ジャズ", "ポップス", "その他"];
// 【「その他」を末尾に置く 2026-09-02】3つの多選択はすべて1つ以上必須にした。
// 必須にする以上、当てはまらない人の逃げ道が要る。GENRES には元から在ったので
// ENSEMBLES / PLACES にも足した。**firestore.rules の写しも同時に直すこと。**
export const ENSEMBLES = ["ソロ", "アンサンブル", "ビッグバンド", "吹奏楽", "オーケストラ", "その他"];
export const PLACES = ["自宅", "学校の音楽室", "個人練習室", "スタジオ", "カラオケ", "屋外", "その他"];

// 【アイコンの絵柄。ここが「選べるもの」の正】絵の形は icons.jsx が持っている。
// **片方だけ足さないこと。** ここにだけ足すと絵の無い識別子が保存でき、
// 画面には色だけの丸が出る。icons.jsx にだけ足しても誰も選べない。
// 食い違いは icons.test.js が検出する。firestore.rules にも同じ写しがある。
export const AVATAR_ICONS = [
  "ic-cat",
  "ic-dog",
  "ic-bird",
  "ic-rabbit",
  "ic-butterfly",
  "ic-fish",
  "ic-paw-print",
  "ic-flower-lotus",
  "ic-leaf",
  "ic-tree",
  "ic-star",
  "ic-heart",
  "ic-moon-stars",
  "ic-sun",
  "ic-cloud",
  "ic-rainbow",
  "ic-fire",
  "ic-snowflake",
  "ic-sparkle",
  "ic-crown-simple",
  "ic-diamond",
  "ic-ghost",
  "ic-music-notes",
  "ic-guitar",
];

// 【地の色は番号で持つ。色そのものは保存しない】実値は index.css の
// --c-avatar-1..10 にあり、後から色を調整しても保存済みのプロフィールを
// 書き直さずに済む。16進数で保存すると、色を変えた瞬間に
// 「古い色のまま固まった人」と「新しい色の人」が混在する。
export const AVATAR_COLOR_MIN = 1;
export const AVATAR_COLOR_MAX = 10;

export function startYearOptions(now = new Date()) {
  const y = now.getFullYear();
  const out = [];
  for (let i = y; i >= y - 80; i--) out.push(i);
  return out;
}

// ニックネームは既定で公開されるため、表示偽装に使える不可視・双方向制御文字を明示的に拒否する。
// \p{Cf}(書式文字カテゴリ)を一括拒否すると絵文字が壊れる(ZWJ=U+200D は絵文字合成に必須、
// 異体字セレクタ=U+FE0E/U+FE0F は絵文字の表示形指定に必須)ため、それらは拒否リストから除外している。
// 拒否対象:
//   - \p{Cc}: C0/C1 制御文字全般(従来の \r\n\t を含む)
//   - U+200B (ゼロ幅スペース), U+200C (ゼロ幅非接合子)
//   - U+200E, U+200F (左横書き/右横書きマーク)
//   - U+202A-U+202E (双方向埋め込み・上書き。U+202E は表示順反転による偽装に使われる)
//   - U+2066-U+2069 (双方向分離)
//   - U+FEFF (ゼロ幅ノーブレークスペース / BOM)
const FORBIDDEN_CHARS = /\p{Cc}|[\u200B\u200C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;

// 【拒否リストだけでは「完全に見えない名前」を止められない】上の拒否リストは
// 「偽装に使える文字を列挙して弾く」形なので、列挙から漏れた不可視文字を並べただけの
// ニックネーム(点字空白・ハングルフィラー・ZWJ だけ・結合文字だけ 等)が登録できてしまう。
// 見えない名前は通報も同定もできないので、設計書 §8.1 のモデレーション設計
// (「自由入力はニックネーム1つだけ → だから通報で自動的に非公開にできる」)が土台から崩れる。
// そこで拒否リストは残したまま、**可視の文字が最低1つ含まれること**を別途要求する。
// 判定は NFKC 正規化した後の文字列に対して行う(互換分解を持つ文字を分解後の姿で1度に扱う)。
const VISIBLE_CATEGORY = /[\p{L}\p{N}\p{P}\p{S}]/u;
// 【カテゴリ上は可視だが実際には何も描かれない文字】2026-08-30 実測。
// VISIBLE_CATEGORY だけでは次の3つが「可視」として素通りする:
//   U+2800 点字空白             … So(記号)なので \p{S} に当たる
//   U+115F ハングル初声フィラー … Lo(文字)なので \p{L} に当たる
//   U+1160 ハングル中声フィラー … 同上。U+3164(ハングルフィラー)と U+FFA0(半角ハングル
//                                フィラー)は NFKC でここへ畳まれる
// いずれも幅を持たない/空白として描かれるので、可視の数に入れない。
// (U+3164 / U+FFA0 は NFKC 後には現れないが、綴りで分かるよう併記しておく。)
const BLANK_LOOKING = /[\u115F\u1160\u2800\u3164\uFFA0]/u;

function hasVisibleChar(value) {
  return [...value.normalize("NFKC")].some((ch) => VISIBLE_CATEGORY.test(ch) && !BLANK_LOOKING.test(ch));
}

export function validateNickname(raw) {
  const value = String(raw ?? "").trim();
  if (value.length === 0) return { error: "ニックネームを入力してください" };
  if ([...value].length > 20) return { error: "ニックネームは20文字までです" };
  if (FORBIDDEN_CHARS.test(value)) return { error: "使えない文字が含まれています" };
  // 絵文字本体は \p{S} なのでここを通る(ZWJ と異体字セレクタを許した上の判断は壊さない)。
  if (!hasVisibleChar(value)) return { error: "表示される文字を1文字以上入れてください" };
  const ng = findNgWord(value);
  if (ng) return { error: "このニックネームは使用できません" };
  return { value };
}

export function detectDeviceClass(ua = (typeof navigator !== "undefined" ? navigator.userAgent : "")) {
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "pc";
}

const pickAllowed = (arr, allowed) => (Array.isArray(arr) ? arr.filter((v) => allowed.includes(v)) : []);

// 【機材は楽器種別ごとに1組】サックス奏者は soprano / alto / tenor / baritone を
// 掛け持ちすることがあり、持ち替えれば楽器もマウスピースもリガチャーも別物になる。
// 同じ種別を2本持つ人は稀なので、1種別につき1組だけ持つ。
//
// 【gear のキー集合は saxTypes と完全に一致させる】多くても少なくてもエラーにする。
//   ・多い(持っていない楽器の機材が入っている) … 集計(計画4の機材シェア)の母数が壊れる。
//     「テナーを吹かない人のテナーのマウスピース」が票として数えられてしまう。
//   ・少ない(選んだ楽器の欄が無い)             … 画面側の取りこぼし(チェックを入れたのに
//     入力状態を作り忘れた等)を、保存が成立してから気付くことになる。
// Firestore ルール側も hasOnly + hasAll で同じ完全一致を要求している。片側だけ緩めない。

export function buildProfileDoc(input, now = new Date()) {
  const nick = validateNickname(input.nickname);
  if (nick.error) return { error: nick.error };

  const types = input.saxTypes;
  if (!Array.isArray(types) || types.length === 0) return { error: "楽器種別を選んでください" };
  if (types.length > SAX_TYPES.length) return { error: "楽器種別は4つまでです" };
  if (!types.every((t) => SAX_TYPES.includes(t))) return { error: "楽器種別を選んでください" };
  // 重複を通すと「saxTypes の要素数」と「gear のキー数」が食い違ったまま
  // hasOnly/hasAll(集合の検査)は通ってしまう。数の一致で完全一致を言えるようにここで潰す。
  if (new Set(types).size !== types.length) return { error: "楽器種別が重複しています" };

  if (!POSITIONS.includes(input.position)) return { error: "属性を選んでください" };
  const year = Number(input.startYear);
  if (!Number.isInteger(year) || year < now.getFullYear() - 80 || year > now.getFullYear()) {
    return { error: "演奏開始年が正しくありません" };
  }
  if (input.ageConfirmed !== true) return { error: "13歳以上であることの確認が必要です" };

  // アイコンは必須。画面側が既定を1つ選んだ状態で出すので、空で来るのは異常。
  if (!AVATAR_ICONS.includes(input.icon)) return { error: "アイコンを選んでください" };
  // 【Number.isInteger で見る】"3" のような文字列や 3.5 を通すと、
  // ルール側の `is int` で弾かれて**保存の瞬間まで気づけない**。ここで同じ厳しさにする。
  if (!Number.isInteger(input.iconColor)
      || input.iconColor < AVATAR_COLOR_MIN || input.iconColor > AVATAR_COLOR_MAX) {
    return { error: "アイコンの色を選んでください" };
  }

  const gearIn = input.gear;
  if (gearIn === null || typeof gearIn !== "object" || Array.isArray(gearIn)) {
    return { error: "機材の指定が正しくありません" };
  }
  const gearKeys = Object.keys(gearIn);
  if (gearKeys.length !== types.length || !types.every((t) => gearKeys.includes(t))) {
    return { error: "選んだ楽器種別と機材の欄が一致していません" };
  }

  const gear = {};
  for (const t of types) {
    const g = gearIn[t];
    if (g === null || typeof g !== "object" || Array.isArray(g)) {
      return { error: `${SAX_LABELS[t]}の機材の指定が正しくありません` };
    }
    // 【未選択を「その他」に寄せない】機材欄を飛ばした人(null)と、「カタログに無い(その他)」を
    // 自分で選んだ人(OTHER_BRAND)は別の情報である。ここで ?? OTHER_BRAND に潰すと、
    // 計画4の機材シェア円グラフから見て両者が区別できなくなり、しかも書き込み済みの
    // ドキュメントからは後で復元できない(欠測が「その他」の票として数えられてしまう)。
    // undefined は null に正規化するだけにとどめる。妥当性は gear.js が判定する。
    //
    // 【2026-09-02 本人裁定: 未選択のまま登録させない】該当が無ければ「その他」を選ぶ。
    // **それでも上の「潰さない」は生きている。** この検査が効くのは*これから書く*
    // ドキュメントだけで、(a) 既に null で保存された物は残り、(b) firestore.rules は
    // null を許したままなので、生SDKからは今後も null が書ける。
    // 読む側(計画4)は欠測を想定しなくてよくなったのではなく、
    // 「新しく増えることはない」だけ。null を見たら「その他」ではなく欠測として扱うこと。
    const instBrand = g.instrumentBrand ?? null;
    const instModel = g.instrumentModel ?? null;
    const mpBrand = g.mpBrand ?? null;
    const mpModel = g.mpModel ?? null;
    const ligBrand = g.ligBrand ?? null;
    const ligModel = g.ligModel ?? null;
    // 【リードは番手を持たない】番手はセッション側(App.jsx の reeds)の情報で、
    // 同じ銘柄でも日によって変わる。ここは「何を使っているか」だけを持つ。
    const reedBrand = g.reedBrand ?? null;
    const reedModel = g.reedModel ?? null;
    // 【楽器だけは種別ごとに照合する】カタログは種別で分かれていて、アルトの YAS-62 は
    // テナーには無い。第3引数にそのキーの種別を渡さないと、種別違いの型番が通ってしまう。
    // マウスピースとリガチャーは種別を持たないカタログなので今までどおり2引数。
    // 「カタログに無い」より先に「選んでいない」を見る。順序を逆にすると、
    // 何も選ばずに保存した人が「カタログにありません」と言われて探し直す羽目になる。
    if (instBrand === null) return { error: `${SAX_LABELS[t]}の楽器を選んでください` };
    if (mpBrand === null) return { error: `${SAX_LABELS[t]}のマウスピースを選んでください` };
    if (ligBrand === null) return { error: `${SAX_LABELS[t]}のリガチャーを選んでください` };
    if (reedBrand === null) return { error: `${SAX_LABELS[t]}のリードを選んでください` };
    if (!isValidInstrument(instBrand, instModel, t)) return { error: `${SAX_LABELS[t]}の楽器がカタログにありません` };
    if (!isValidMouthpiece(mpBrand, mpModel)) return { error: `${SAX_LABELS[t]}のマウスピースがカタログにありません` };
    if (!isValidLigature(ligBrand, ligModel)) return { error: `${SAX_LABELS[t]}のリガチャーがカタログにありません` };
    if (!isValidReed(reedBrand, reedModel)) return { error: `${SAX_LABELS[t]}のリードがカタログにありません` };
    gear[t] = { instrumentBrand: instBrand, instrumentModel: instModel, mpBrand, mpModel, ligBrand, ligModel, reedBrand, reedModel };
  }

  // 【2026-09-02 本人裁定: 多選択も1つ以上必須】このタブの用途は条件で絞り込んで
  // 他人と比べることなので、空欄のままだと**どの絞り込みにも現れない**。
  // 本人は登録できたつもりでいるのに誰からも見つからない、という一番わかりにくい壊れ方をする。
  // 逃げ道として ENSEMBLES / PLACES にも「その他」を足してある(上の定義を参照)。
  const genres = pickAllowed(input.genres, GENRES);
  const ensembles = pickAllowed(input.ensembles, ENSEMBLES);
  const places = pickAllowed(input.places, PLACES);
  // pickAllowed は選択肢に無い値を捨てるので、「1つ以上渡したのに全部捨てられて空」も
  // ここに落ちる。渡した数ではなく**残った数**を見るのが要点。
  if (genres.length === 0) return { error: "ジャンルを1つ以上選んでください" };
  if (ensembles.length === 0) return { error: "編成を1つ以上選んでください" };
  if (places.length === 0) return { error: "練習場所を1つ以上選んでください" };

  return {
    doc: {
      nickname: nick.value,
      icon: input.icon,
      iconColor: input.iconColor,
      saxTypes: [...types],
      position: input.position,
      startYear: year,
      genres,
      ensembles,
      places,
      gear,
      deviceClass: detectDeviceClass(),
      isPublic: input.isPublic !== false, // 既定は公開(spec 決定事項)
      ageConfirmed: true,
      updatedAt: now.toISOString(),
    },
  };
}
