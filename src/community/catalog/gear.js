// 機材カタログ(サックス本体・マウスピース・リガチャー)と部分一致検索。
// データ出典:
//   本体・マウスピース … docs/superpowers/research/2026-08-27-gear-catalog.md
//   リガチャー         … docs/superpowers/research/2026-08-29-ligature-catalog.md
// 確認記号 ◎(一次情報)/○(販売店・専門メディア) の型番のみを転記している。
// △(一般知識・未個別確認)の型番は収録していない。

export const OTHER_BRAND = "その他";

export const INSTRUMENT_CATALOG = {
  YAMAHA: {
    soprano: ["YSS-475", "YSS-82Z", "YSS-875EX"],
    alto: [
      "YAS-280",
      "YAS-480",
      "YAS-62",
      "YAS-82Z",
      "YAS-875EX",
      "YAS-275",
      "YAS-25",
      "YAS-23",
      "YAS-21",
      "YAS-475",
      "YAS-32",
      "YAS-855",
      "YAS-875",
    ],
    tenor: ["YTS-280", "YTS-480", "YTS-62", "YTS-82Z", "YTS-875EX"],
    baritone: ["YBS-62"],
  },
  "Selmer Paris": {
    alto: ["Axos", "Signature", "Supreme", "Series II (SA80II)", "Series III", "Reference 54"],
    tenor: ["Supreme", "Signature", "Series II (SA80II)", "Series III", "Reference 36", "Reference 54"],
  },
  Yanagisawa: {
    soprano: ["S-WO1", "S-WO2", "S-WO10", "S-WO20", "S-WO37"],
    alto: ["A-WO1", "A-WO2", "A-WO10", "A-WO20", "A-WO37"],
    tenor: ["T-WO1", "T-WO2", "T-WO10", "T-WO20", "T-WO37"],
    baritone: ["B-WO1", "B-WO2", "B-WO10", "B-WO20"],
  },
  Cannonball: {
    soprano: ["S5", "SC5", "SA5"],
    alto: ["A5", "Vintage Reborn Alto", "Gerald Albright Signature", "Sceptyr", "Alcazar"],
    tenor: ["T5", "Vintage Reborn Tenor"],
    baritone: ["B5"],
  },
  "P. Mauriat": {
    alto: ["PMXA-67R", "System 76 (2nd Edition)", "Le Bravo (200)"],
    tenor: ["System 76", "Master 97", "Le Bravo 200"],
  },
  Keilwerth: {
    alto: ["SX90R", "MKX"],
    tenor: ["SX90R", "SX90R Shadow", "MKX"],
  },
  Jupiter: {
    alto: ["JAS700", "JAS1100 (JAS1100SG等)"],
    tenor: ["JTS700", "JTS1100 (JTS1100SG等)"],
  },
  Antigua: {
    alto: ["AS3100", "AS4240 (PowerBell)"],
    tenor: ["TS4240 (PowerBell)"],
    baritone: ["BS4240 (PowerBell)"],
  },
};

// ------------------------------------------------------------------
// 【決定の記録】マウスピースの「開き(facing / tip opening)」は独立した項目にしない。
//
// 設計書 §4.1 は「マウスピース開き」をプロフィールの項目として挙げており、計画 Task 4 の
// インタフェースにも任意項目 `facings` が宣言されていたが、実装では使わなかった。
// 実際の格納形は、開きを **モデル名の文字列に畳み込んだもの** である:
//
//   "S80 C*" / "Meyer 6M" / "Tone Edge 7*" / "V16 A7" / "GIANT 8*"
//     → 開きは型番の一部として文字列の中に入っている(取り出すには解析が要る)
//
// この畳み込みで **開きが完全に失われる** のが以下:
//
//   Selmer "Concept" / "Soloist"     … 開きの表記を持たない単一項目にした
//   Guardala "MB II"                 … 同上
//   Theo Wanne 全モデル(DURGA/SHIVA/GAIA/AMBIKA/…)
//                                    … 実機は 5〜9 相当の開きが選べるが、
//                                       カタログはモデル名までしか持っていない
//
// 畳み込みを選んだ理由: 開きの刻み方はブランドごとにばらばら(数字+*、数字のみ、
// .095 のような実寸)で、共通の選択肢集合が作れない。モデルごとに候補を持つと
// カタログが数倍に膨らむ割に、v1 の用途(機材シェアの円グラフ)はブランド粒度で足りる。
//
// **次の計画への申し送り**: 開きを本当に項目として持つなら、(a) モデル名から開きを
// 剥がす、(b) モデルごとの開き候補表を足す、の両方が要る。既存プロフィールの
// モデル文字列は開き込みなので、移行時に解析が必要になる。ここで黙って足してはいけない。
// ------------------------------------------------------------------
export const MOUTHPIECE_CATALOG = {
  Selmer: {
    models: [
      "S80 C",
      "S80 C*",
      "S80 C**",
      "S80 D",
      "S80 E",
      "S80 F",
      "S90 170",
      "S90 180",
      "S90 190",
      "S90 200",
      "Concept",
      "Soloist",
    ],
  },
  Vandoren: {
    models: [
      "Optimum AL3",
      "Optimum AL4",
      "Optimum AL5",
      "V5 S15",
      "V5 S25",
      "V5 S27",
      "V5 A15",
      "V5 A17",
      "V5 A20",
      "V5 A25",
      "V5 A27",
      "V5 A28",
      "V5 A35",
      "V5 T15",
      "V5 T20",
      "V5 T25",
      "V5 T27",
      "V5 T35",
      "V5 B25",
      "V5 B27",
      "V16 A5",
      "V16 A6",
      "V16 A7",
      "V16 A8",
      "V16 A9",
      "Java A35",
      "Java A45",
      "Java A55",
      "Java A75",
      "Java T45",
      "Java T55",
      "Java T75",
      "Java T95",
    ],
  },
  Meyer: {
    models: ["4MM", "5MM", "6MM", "7MM", "8MM", "5M", "6M", "7M", "8M"],
  },
  "Otto Link": {
    models: [
      "Tone Edge 5",
      "Tone Edge 5*",
      "Tone Edge 6",
      "Tone Edge 6*",
      "Tone Edge 7",
      "Tone Edge 7*",
      "Tone Edge 8",
      "Tone Edge 8*",
      "Super Tone Master 6*",
      "Super Tone Master 7",
      "Super Tone Master 7*",
    ],
  },
  JodyJazz: {
    models: [
      "HR* 5",
      "HR* 6",
      "HR* 6*",
      "HR* 7",
      "HR* 7*",
      "HR* 8",
      "HR* 8*",
      "HR* Custom Dark 5",
      "HR* Custom Dark 6",
      "HR* Custom Dark 6*",
      "HR* Custom Dark 7",
      "HR* Custom Dark 7*",
      "HR* Custom Dark 8",
      "HR* Custom Dark 8*",
      // 以下 DV / DV NY / DV HR / JET / Super Jet の各6件は、研究md 2.3節が
      // 「6〜8*(テナー定番7*/8*)」と範囲表記している箇所を、同md 2.1節の
      // 「*=半段階」規則に基づいて 6, 6*, 7, 7*, 8, 8* の6段階に展開したもの。
      // 研究mdに個別列挙されている型番の逐語転記ではない点に注意。
      "DV 6",
      "DV 6*",
      "DV 7",
      "DV 7*",
      "DV 8",
      "DV 8*",
      "DV NY 6",
      "DV NY 6*",
      "DV NY 7",
      "DV NY 7*",
      "DV NY 8",
      "DV NY 8*",
      "DV HR 6",
      "DV HR 6*",
      "DV HR 7",
      "DV HR 7*",
      "DV HR 8",
      "DV HR 8*",
      "JET 6",
      "JET 6*",
      "JET 7",
      "JET 7*",
      "JET 8",
      "JET 8*",
      "Super Jet 6",
      "Super Jet 6*",
      "Super Jet 7",
      "Super Jet 7*",
      "Super Jet 8",
      "Super Jet 8*",
      // GIANT は研究mdが「6*(.095)/7*(.105)/8(.110)/8*(.115)、Garzone版は9*/10*も」
      // と個別列挙している行の逐語転記(範囲展開ではない)。
      "GIANT 6*",
      "GIANT 7*",
      "GIANT 8",
      "GIANT 8*",
      "GIANT 9*",
      "GIANT 10*",
    ],
  },
  "D'Addario": {
    models: ["Select Jazz D5M", "Select Jazz D6M", "Select Jazz D7M", "Select Jazz D8M", "Select Jazz D9M"],
  },
  Yamaha: {
    models: ["3C", "4C", "5C", "6C"],
  },
  Dukoff: {
    models: ["D5", "D6", "D7", "D8", "D9", "D10"],
  },
  Guardala: {
    models: ["MB II"],
  },
  "Claude Lakey": {
    models: ["4*3", "6*3", "7*3"],
  },
  Beechler: {
    models: ["S5", "S6S", "S7", "S8", "M7", "M8"],
  },
  "Theo Wanne": {
    models: [
      "DURGA",
      "SHIVA",
      "GAIA",
      "AMBIKA",
      "LAKSHMI",
      "MANTRA",
      "MINDI",
      "BRAHMA",
      "NY",
      "SLANT Sig",
      "Elements Fire",
      "Elements Earth",
      "Elements Water",
      "Essentials Concert",
      "Essentials Contemporary",
      "Essentials Jazz",
      "Essentials Jazz Fusion",
    ],
  },
};

// ------------------------------------------------------------------
// ブランド名のカタカナ別名。
//
// カタログのブランド名はすべてラテン文字だが、主要な利用者(学校・アマチュアの
// 日本人奏者)は検索欄に「ヤマハ」「メイヤー」「セルマー」と打つ。別名が無いと
// 候補が0件になり、実在の機材を持っている人まで「カタログに無い(その他)」へ
// 流れて機材データが失われる。フォームのプレースホルダ(CommunityTab.jsx)が
// まさにカタカナを例示しているので、無いままでは案内が嘘になる。
//
// キーは各カタログのブランドキーと**完全に一致**させること。
// YAMAHA(本体)と Yamaha(マウスピース)、Selmer Paris(本体)と Selmer
// (マウスピース)は別キーなので、両方に別名が要る。
// 半角カナ("ﾔﾏﾊ")は norm() の NFKC が全角カナに畳むので、ここには全角だけ置けばよい。
// ------------------------------------------------------------------
export const BRAND_ALIASES = {
  // 本体(INSTRUMENT_CATALOG)
  YAMAHA: ["ヤマハ"],
  "Selmer Paris": ["セルマー", "セルマーパリ"],
  Yanagisawa: ["ヤナギサワ", "柳澤", "柳沢"],
  Cannonball: ["キャノンボール"],
  "P. Mauriat": ["ピーモーリア", "モーリア"],
  Keilwerth: ["カイルヴェルト", "カイルベルト"],
  Jupiter: ["ジュピター"],
  Antigua: ["アンティグア"],
  // マウスピース(MOUTHPIECE_CATALOG)
  Selmer: ["セルマー"],
  Vandoren: ["バンドーレン"],
  Meyer: ["メイヤー"],
  "Otto Link": ["オットーリンク", "オットリンク"],
  JodyJazz: ["ジョディジャズ"],
  "D'Addario": ["ダダリオ"],
  Yamaha: ["ヤマハ"],
  Dukoff: ["デュコフ"],
  Guardala: ["ガーデラ", "グアルダーラ"],
  "Claude Lakey": ["クロードレイキー"],
  Beechler: ["ビーチラー"],
  "Theo Wanne": ["セオワニ", "テオワニ"],
  // リガチャー(LIGATURE_CATALOG)
  // 既存キーと同名のブランド(Vandoren / Selmer / Yamaha / JodyJazz / Theo Wanne /
  // Yanagisawa / D'Addario)は上の別名をそのまま共有する。ここには足さない。
  Rovner: ["ロブナー", "ロヴナー"],
  BG: ["ビージー", "ベーゲー"],
  Silverstein: ["シルバースタイン", "シルヴァスタイン"],
  Ishimori: ["イシモリ", "石森", "ウッドストーン", "ウッドストン"],
  Harrison: ["ハリソン"],
  // 「ç」は NFKC で「c」に畳まれないので、アクセント無しの綴りも別名で持たせる。
  // これが無いと "francois" と打った人が0件になる。
  "François Louis": ["フランソワルイ", "フランソワルイス", "Francois Louis"],
  "Marc Jean": ["マークジャン", "マルクジャン"],
  Bois: ["ボワ", "ボア"],
  Ligaphone: ["リガフォン", "リガフォーン"],
  Winslow: ["ウィンスロー", "ウインスロー"],
  SAXXAS: ["サクサス", "サクザス"],
  Oleg: ["オレグ"],
  Brancher: ["ブランシェ", "ブランチャー"],
  "JLV Sound": ["ジェイエルヴィ", "ジェイエルブイ"],
  // 「ú」も NFKC で「u」にならないので、アクセント無しの綴りを別名に入れる。
  "Bambú": ["バンブー", "Bambu"],
  Gottsu: ["ゴッツ"],
  AIZEN: ["アイゼン"],
  // リード(REED_CATALOG)
  // 既存キーと同名のブランド(Vandoren / D'Addario / Silverstein)は上の別名を共有する。
  // 「é」は NFKC で「e」に畳まれないので、アクセント無しの綴りも別名に入れる
  // (これが無いと "legere" と打った人が0件になる)。
  "Légère": ["レジェール", "レジェーレ", "Legere"],
  Marca: ["マーカ", "マルカ"],
  Rigotti: ["リゴッティ"],
  Alexander: ["アレキサンダー", "アレクサンダー"],
  Forestone: ["フォレストーン"],
  Fiberreed: ["ファイバーリード"],
  Fibracell: ["ファイブラセル", "フィブラセル"],
  BARI: ["バリ"],
  Gonzalez: ["ゴンザレス"],
  Steuer: ["シュトイヤー", "ステューヤー"],
};

// 検索正規化: 全角→半角・大文字→小文字(NFKC)、空白・ハイフンを除去。
// 例: "ｙａｓ６２" -> "yas62", "YAS-62" -> "yas62", "ﾔﾏﾊ" -> "ヤマハ"
// (半角カナ→全角カナ、半角の濁点の合成も NFKC がやる)
const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[\s\-]/g, "");

// ブランド名そのものと、カタカナ別名のどちらでも引けるようにする。
const brandMatches = (brand, q) =>
  norm(brand).includes(q) || (BRAND_ALIASES[brand] ?? []).some((alias) => norm(alias).includes(q));

export function searchInstrumentModels(query, saxType) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  for (const [brand, byType] of Object.entries(INSTRUMENT_CATALOG)) {
    const brandHit = brandMatches(brand, q);
    for (const model of byType[saxType] ?? []) {
      if (norm(model).includes(q) || brandHit) out.push({ brand, model });
    }
  }
  return out;
}

export function searchMouthpieces(query) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  for (const [brand, { models }] of Object.entries(MOUTHPIECE_CATALOG)) {
    const brandHit = brandMatches(brand, q);
    for (const model of models) {
      if (norm(model).includes(q) || brandHit) out.push({ brand, model });
    }
  }
  return out;
}

// 【未選択(null/null)と「その他」を同じ値に潰さない】
// 機材欄を飛ばした人と、「カタログに無い(その他)」を自分で選んだ人は別の情報である。
// 計画4の機材シェア円グラフはこの欄をそのまま読むので、片方に寄せると母数が壊れ、
// しかも書き込み済みのプロフィールからは後で復元できない。
// したがって「未選択」は brand も model も null という正当な状態として通す。
// (Firestore ルール側も gear の各値に null を許してある。)
export function isValidInstrument(brand, model, saxType) {
  if (brand === null && model === null) return true; // 未選択
  if (brand === OTHER_BRAND) return model === null; // 明示的に選ばれた「その他」
  return (INSTRUMENT_CATALOG[brand]?.[saxType] ?? []).includes(model);
}

export function isValidMouthpiece(brand, model) {
  if (brand === null && model === null) return true; // 未選択
  if (brand === OTHER_BRAND) return model === null; // 明示的に選ばれた「その他」
  return (MOUTHPIECE_CATALOG[brand]?.models ?? []).includes(model);
}

// ─────────────────────────────────────────────────────────────
// リガチャー（マウスピースにリードを固定する締具）
//
// 楽器・マウスピースと同じく「ブランド → モデル」を部分一致で選ばせる。
// 自由入力を確定させないことで、モデレーション対象を増やさない方針は同じ。
// カタログの出どころは docs/superpowers/research/2026-08-29-ligature-catalog.md。
// 同レポートの ◎(一次情報)/○(販売店・専門メディア)の行だけを転記した。
// △(未裏取り)は収録しない ─ 具体的には Rovner "Legacy" と、Harrison オリジナルの
// サイズ記号 A1 / S1 / T / TD / TO の2件(レポート §2 の△一覧はこの2件のみ)。
//
// 【サイズを持たない】レポート §「サイズ体系についての前提」のとおり、リガチャーは
// モデル名と管(soprano/alto/tenor/baritone)が別軸で、同じモデル名が全管にまたがる。
// よって models[] はモデル名だけを持ち、管もサイズ記号も畳み込まない。
// 例外は下の Selmer / Yamaha(理由は各ブランドのコメント参照)。
//
// 【生産終了品も残す】Bois と Winslow(SAXXAS の前身)は販売店表記・フォーラムで
// 製造終了とされる(レポート §4)。それでも中古で使っている人がいるので、楽器本体の
// カタログが YAS-23 のような旧モデルを含めているのと同じ扱いで残す。
export const LIGATURE_CATALOG = {
  Rovner: {
    // 型番は「接頭辞(モデル)+サイズ記号」。接頭辞だけがモデル名にあたる。
    models: [
      "Dark",
      "Light",
      "MKIII",
      "Star Series",
      "Versa",
      "Versa-X",
      "LGX",
      "Platinum",
      "Platinum Gold",
      "Van Gogh",
      // "Legacy" は△(公式の製品ページを確認できず)。収録しない。
    ],
  },
  Vandoren: {
    models: ["Optimum", "M|O", "Leather", "Klassik", "Carbon", "Masters（旧）"],
  },
  // ------------------------------------------------------------------
  // Selmer / Yamaha は**愛称つきモデル名を持たない**(レポート §4)。部品番号
  // (YAC-1607, M404)か「メタルマウスピース用」のような管別・用途別の一般名しかない。
  // 他ブランドと同じようにラテン文字の型番だけを並べると、日本語で検索する利用者が
  // 自分の持ち物を見つけられず「その他」へ流れて機材データが失われる。
  // そこでモデル名の末尾に日本語の補足を括弧で付け、**表示名と検索キーを兼ねさせる**。
  // norm() の NFKC が全角括弧を半角に畳むので、全角/半角どちらで打っても当たる。
  // ------------------------------------------------------------------
  // ブランドキーは MOUTHPIECE_CATALOG と同じ "Selmer"(本体側の "Selmer Paris" とは別キー)。
  Selmer: {
    models: [
      "FIBRA Ligature（フィブラ）",
      "標準リガチャー（ラバーマウスピース用）",
      "メタルマウスピース用リガチャー（アルト・テナー用）",
      "メタルマウスピース用リガチャー ゴールド（テナー用）",
      "M404（テナー・メタルマウスピース用）",
      "Tribute（2nd Gen M404・テナー用）",
    ],
  },
  BG: {
    models: [
      "Standard（布＋ラバープレート）",
      "Super Revelation",
      "Revelation Silver",
      "Revelation Jazz",
      "Standard Jazz",
      "Revelation Silver Jazz",
      "FLEX",
      "Tradition",
      "Duo",
      "Universal Jazz",
    ],
  },
  Silverstein: {
    // 世代(Gen.4/5/6)とサイズ番号(05〜11)は更新が速いので持たない(レポート §1.5 の推奨)。
    // ALTA は同社の合成リードでリガチャーではないため入れない。
    models: ["Original", "CRYO4", "QUATTRO", "HEXA", "ESTRO"],
  },
  Ishimori: {
    models: [
      "Wood Stone スタンダード（逆締）",
      "Wood Stone AMIME（順締）",
      "Wood Stone KODAMA I（逆締）",
      "Wood Stone KODAMA II（逆締）",
      "Wood Stone CLASSIC",
    ],
  },
  Harrison: {
    // オリジナルは創業者死去で製造終了、現行は日本製復刻。両方を選べるようにする。
    // サイズ記号(A2/A3/S2/B.S. は○、A1/S1/T/TD/TO は△)はモデル名に畳み込まない。
    models: ["Harrison（オリジナル・ヴィンテージ）", "Harrison（日本製復刻）"],
  },
  "François Louis": {
    models: ["Ultimate", "Pure Brass", "Basic"],
  },
  "Theo Wanne": {
    models: ["Enlightened Ligature", "Liberty Ligature"],
  },
  JodyJazz: {
    models: ["POWER RING Ligature", "Ring Ligature（旧）"],
  },
  "Marc Jean": {
    // 仏ではなくカナダ・ケベックの工房(レポート §4)。公式ページが取得できず
    // Model 701/800/850 は未確認のため入れない。
    models: ["Generation II（Model 700 系）", "Evolution 4"],
  },
  Bois: {
    models: ["Classique（リング型）"],
  },
  Yamaha: {
    // 公式に単体ページが無く、YAC-#### / WF###### の部品番号で流通する。
    // レポートの表は1行(対応=ソプラノ〜バリトン)だが、部品番号が管ごとに違う以上
    // 利用者は「アルト用」で探す。よって 対応 列の管を1モデルずつに開き、
    // 唯一裏取りできた部品番号(アルト用 YAC-1607)だけを名前に添えた。
    // 他の管の部品番号は出典が無いので**書かない**(でっち上げない)。
    models: [
      "標準リガチャー（ソプラノ用）",
      "標準リガチャー（アルト用・YAC-1607）",
      "標準リガチャー（テナー用）",
      "標準リガチャー（バリトン用）",
    ],
  },
  Ligaphone: {
    models: ["UNIVERSAL", "CL.AS"],
  },
  Winslow: {
    // 製造終了とされるが中古が主戦場のため残す。番号(#8, #16N…)が対応MPを表す。
    models: ["Winslow Ligature（番号サイズ体系 #8 / #16N ほか）"],
  },
  SAXXAS: {
    models: ["SAXXAS Ligature"],
  },
  Oleg: {
    models: ["Olegature"],
  },
  Brancher: {
    models: ["Brancher セミリジッド（semi-rigid）", "Brancher メタル（ワイヤー式）"],
  },
  Yanagisawa: {
    models: ["Yany Ligature"],
  },
  "D'Addario": {
    models: ["H-Ligature", "Rico Ligature"],
  },
  "JLV Sound": {
    models: ["JLV Ligature"],
  },
  "Bambú": {
    models: ["Bambú 手織りリガチャー（Hand Woven / Braided）", "Bambú NOVA"],
  },
  Gottsu: {
    models: ["Gottsu Signature", "Gottsu Copper Signature", "Gottsu SV950 Signature"],
  },
  AIZEN: {
    models: ["AIZEN フリーダムリガチャー（Freedom Ligature）"],
  },
};

export function searchLigatures(query) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  for (const [brand, { models }] of Object.entries(LIGATURE_CATALOG)) {
    const brandHit = brandMatches(brand, q);
    for (const model of models) {
      if (norm(model).includes(q) || brandHit) out.push({ brand, model });
    }
  }
  return out;
}

export function isValidLigature(brand, model) {
  if (brand === null && model === null) return true; // 未選択
  if (brand === OTHER_BRAND) return model === null;  // 明示的に選ばれた「その他」
  return (LIGATURE_CATALOG[brand]?.models ?? []).includes(model);
}

// ------------------------------------------------------------------
// リード(REED_CATALOG)
//
// 【番手(3・3半 など)は持たない】この欄はプロフィールの機材、つまり
// 「何を使っているか」であって「いまの1枚」ではない。番手はセッション側
// (App.jsx の reeds)が持っており、そちらは同じ銘柄でも人や日で変わる。
// ここに番手を入れると、同じ「Vandoren Traditional」使いが番手ぶんに割れて、
// 機材シェアの内訳が実態より細かく散る。
//
// 【収録の基準は他の3カタログと同じ】製品ラインとして公式に確認できるものだけを入れ、
// 怪しいものは**入れない**。過去に実在しない型番を書いて差し戻された経緯があるので、
// 「たぶんある」で足さないこと。銘柄を増やすときは公式の製品ページを見てから。
// ここに無い銘柄の人は「カタログに無い(その他)」を選ぶ。
// ------------------------------------------------------------------
export const REED_CATALOG = {
  Vandoren: {
    // 通称で呼ばれることが多いが、本人裁定により**正式名称で持つ**
    // (青箱 = Traditional、緑箱 = Java、赤箱 = Java Red Cut)。
    models: ["Traditional", "V16", "Java", "Java Red Cut", "ZZ", "V21"],
  },
  "D'Addario": {
    // Rico は D'Addario の製品ラインであってブランドではない。
    // App.jsx の INITIAL_REED_BRANDS は "Rico (D'Addario)" と持っているが、
    // あちらは利用者が自分の箱を選ぶための一覧で、こちらは公開して数える用。
    // **正式名称で揃える**(本人裁定)。
    models: ["Rico", "Rico Royal", "La Voz", "Select Jazz", "Reserve", "Plasticover", "Hemke"],
  },
  "Légère": {
    // 樹脂製。番手を持たない点は木製と同じ扱い。
    models: ["Classic", "Signature", "Studio Cut", "American Cut"],
  },
  Marca: {
    models: ["Superieure", "Excel", "Jazz", "Tradition", "American Vintage"],
  },
  Rigotti: {
    models: ["Gold Jazz", "Gold Classic"],
  },
  Silverstein: {
    models: ["AMBIPOLY Jazz", "AMBIPOLY Classic", "AMBIPOLY Studio"],
  },
  Alexander: {
    models: ["Superial", "Superial DC", "NY", "Classique"],
  },
  Forestone: {
    models: ["Traditional", "Black Bamboo", "White Bamboo", "Hinoki", "Rui"],
  },
  Fiberreed: {
    models: ["Classic", "Hemp", "Carbon", "Copper Carbon", "Natural", "Onyx"],
  },
  Fibracell: {
    models: ["Premier"],
  },
  BARI: {
    models: ["Star", "Original"],
  },
  Gonzalez: {
    models: ["Local 627", "Classic"],
  },
  Steuer: {
    models: ["Classic", "Jazz", "Solist"],
  },
};

export function searchReeds(query) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  for (const [brand, { models }] of Object.entries(REED_CATALOG)) {
    const brandHit = brandMatches(brand, q);
    for (const model of models) {
      if (norm(model).includes(q) || brandHit) out.push({ brand, model });
    }
  }
  return out;
}

export function isValidReed(brand, model) {
  if (brand === null && model === null) return true; // 未選択
  if (brand === OTHER_BRAND) return model === null;  // 明示的に選ばれた「その他」
  return (REED_CATALOG[brand]?.models ?? []).includes(model);
}

