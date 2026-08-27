// 機材カタログ(サックス本体・マウスピース)と部分一致検索。
// データ出典: docs/superpowers/research/2026-08-27-gear-catalog.md
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

// 検索正規化: 全角→半角・大文字→小文字(NFKC)、空白・ハイフンを除去。
// 例: "ｙａｓ６２" -> "yas62", "YAS-62" -> "yas62"
const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/[\s\-]/g, "");

export function searchInstrumentModels(query, saxType) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  for (const [brand, byType] of Object.entries(INSTRUMENT_CATALOG)) {
    for (const model of byType[saxType] ?? []) {
      if (norm(model).includes(q) || norm(brand).includes(q)) out.push({ brand, model });
    }
  }
  return out;
}

export function searchMouthpieces(query) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  for (const [brand, { models }] of Object.entries(MOUTHPIECE_CATALOG)) {
    for (const model of models) {
      if (norm(model).includes(q) || norm(brand).includes(q)) out.push({ brand, model });
    }
  }
  return out;
}

export function isValidInstrument(brand, model, saxType) {
  if (brand === OTHER_BRAND) return model === null;
  return (INSTRUMENT_CATALOG[brand]?.[saxType] ?? []).includes(model);
}

export function isValidMouthpiece(brand, model) {
  if (brand === OTHER_BRAND) return model === null;
  return (MOUTHPIECE_CATALOG[brand]?.models ?? []).includes(model);
}
