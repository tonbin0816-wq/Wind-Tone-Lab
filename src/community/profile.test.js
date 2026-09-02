import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  validateNickname,
  buildProfileDoc,
  detectDeviceClass,
  POSITIONS,
  SAX_TYPES,
  GENRES,
  ENSEMBLES,
  PLACES,
} from "./profile.js";
import { OTHER_BRAND } from "./catalog/gear.js";

// 【この8つは実装から import しない】機材1組の形は凍結された仕様であって、
// 実装が持っている定数ではない。実装側から引くと「実装が何を出そうと一致する」検査になる。
// 2026-09-02: リード(reedBrand / reedModel)を追加して6→8。番手は持たない
// (番手はセッション側の情報で、同じ銘柄でも日によって変わるため)。
const GEAR_KEYS = ["instrumentBrand", "instrumentModel", "mpBrand", "mpModel", "ligBrand", "ligModel", "reedBrand", "reedModel"];
// 空の機材1組(何も選ばなかった状態)。必須化後は保存できない値だが、
// 「弾かれること」を確かめるために必要なので残す。
const NO_GEAR = { instrumentBrand: null, instrumentModel: null, mpBrand: null, mpModel: null, ligBrand: null, ligModel: null, reedBrand: null, reedModel: null };
// 埋まった機材1組。**機材以外を確かめる検査の穴埋め用。**
// 全部「その他」にしてあるのは、これが**どの楽器種別でも通る唯一の値**だから。
// カタログの型番は種別ごとに違う(YAS-62 は alto にしか無い)ので、実在の型番で埋めると
// 種別を変えるたびに書き換えることになり、そのうち誰かが検査の主題ごと壊す。
const ANY_GEAR = { instrumentBrand: OTHER_BRAND, instrumentModel: null, mpBrand: OTHER_BRAND, mpModel: null, ligBrand: OTHER_BRAND, ligModel: null, reedBrand: OTHER_BRAND, reedModel: null };

const base = {
  nickname: "さっくす太郎",
  // アイコンは必須。画面側が既定を選んだ状態で出すので、空で来ることは無い。
  icon: "ic-cat",
  iconColor: 1,
  saxTypes: ["alto"],
  position: "社会人",
  startYear: 2015,
  genres: ["クラシック"],
  ensembles: ["吹奏楽"],
  places: ["自宅"],
  ageConfirmed: true,
  isPublic: true,
  // 【リガチャーまで埋める】機材3欄は必須になったので、欠けていると base 自体が弾かれ、
  // 機材と無関係な検査まで巻き添えで落ちる。
  gear: { alto: { instrumentBrand: "YAMAHA", instrumentModel: "YAS-62", mpBrand: "Selmer", mpModel: "S80 C*", ligBrand: "Rovner", ligModel: "Dark", reedBrand: "Vandoren", reedModel: "Traditional" } },
};

describe("validateNickname", () => {
  it("前後の空白を落として受理する", () => {
    expect(validateNickname("  太郎 ")).toEqual({ value: "太郎" });
  });
  it("空・21文字以上・改行・NGワードを弾く", () => {
    expect(validateNickname("")).toHaveProperty("error");
    expect(validateNickname("あ".repeat(21))).toHaveProperty("error");
    expect(validateNickname("a\nb")).toHaveProperty("error");
    expect(validateNickname("xxfuckxx")).toHaveProperty("error");
  });
  it("表示偽装に使える不可視・双方向制御文字を弾く", () => {
    expect(validateNickname("\u202E太郎")).toHaveProperty("error"); // 右横書き上書き(表示順反転)
    expect(validateNickname("太\u200B郎")).toHaveProperty("error"); // ゼロ幅スペース
  });
  it("ZWJ を使った絵文字ニックネームは受理する", () => {
    // 👨‍👩‍👧 = U+1F468 U+200D U+1F469 U+200D U+1F467 (家族の絵文字、ZWJ結合列)
    const nick = "太郎👨‍👩‍👧";
    expect(validateNickname(nick)).toEqual({ value: nick });
  });
  // 【見えない名前は通報も同定もできない】設計書 §8.1 のモデレーション設計は
  // 「自由入力はニックネーム1つだけ → 通報の対象もそれだけ → だから自動で非公開にできる」を
  // 土台にしている。完全に見えないニックネームが登録できると、この土台が崩れる。
  // 【1件ずつ独立の it にする】1つの it に7件並べると最初の1件で落ちた時点で
  // 残りが評価されず、どの文字が素通りしているのか分からなくなる。
  describe("不可視文字だけのニックネームを弾く", () => {
    it("点字空白(U+2800)だけを弾く", () => {
      expect(validateNickname("\u2800".repeat(3))).toHaveProperty("error");
    });
    it("ハングルフィラー(U+3164)だけを弾く", () => {
      expect(validateNickname("\u3164".repeat(3))).toHaveProperty("error");
    });
    it("初声フィラー(U+115F)だけを弾く", () => {
      expect(validateNickname("\u115F".repeat(3))).toHaveProperty("error");
    });
    it("モンゴル母音区切り(U+180E)だけを弾く", () => {
      expect(validateNickname("\u180E".repeat(3))).toHaveProperty("error");
    });
    it("ZWJ(U+200D)だけを弾く", () => {
      expect(validateNickname("\u200D".repeat(3))).toHaveProperty("error");
    });
    it("異体字セレクタ(U+FE0F)だけを弾く", () => {
      expect(validateNickname("\uFE0F".repeat(3))).toHaveProperty("error");
    });
    it("結合文字(U+0301)だけを弾く", () => {
      expect(validateNickname("\u0301".repeat(3))).toHaveProperty("error");
    });
    it("中声フィラー(U+1160)と半角ハングルフィラー(U+FFA0)も弾く", () => {
      // U+3164 / U+FFA0 は NFKC で U+1160 に畳まれる。畳まれた先も可視に数えないこと。
      expect(validateNickname("\u1160".repeat(3))).toHaveProperty("error");
      expect(validateNickname("\uFFA0".repeat(3))).toHaveProperty("error");
    });
  });

  // 上の検査で絵文字を巻き添えにしていないこと。絵文字本体は p{S} なので可視に数える。
  describe("可視の文字が1つでもあれば受理する", () => {
    it("かなと漢字だけの名前は受理する", () => {
      expect(validateNickname("さっくす太郎")).toEqual({ value: "さっくす太郎" });
    });
    it("英数字だけの名前は受理する", () => {
      expect(validateNickname("AltoLove442")).toEqual({ value: "AltoLove442" });
    });
    it("ZWJ 絵文字を含む名前は受理する", () => {
      const nick = "太郎\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67";
      expect(validateNickname(nick)).toEqual({ value: nick });
    });
    it("絵文字だけの名前は受理する", () => {
      const nick = "\uD83C\uDFB7"; // 🎷
      expect(validateNickname(nick)).toEqual({ value: nick });
    });
    it("不可視文字に可視の文字が1つ混じれば受理する", () => {
      expect(validateNickname("\u2800A\u2800")).toEqual({ value: "\u2800A\u2800" });
    });
  });
  it("20コードポイントちょうどは受理する(サロゲートペア境界)", () => {
    const nick = "あ".repeat(19) + "😀"; // 19 + 1(絵文字はサロゲートペアだが1コードポイント) = 20
    expect([...nick].length).toBe(20);
    expect(validateNickname(nick)).toEqual({ value: nick });
  });
});

describe("buildProfileDoc", () => {
  it("正しい入力からドキュメントを作る", () => {
    const r = buildProfileDoc(base, new Date("2026-08-27"));
    expect(r.doc.nickname).toBe("さっくす太郎");
    expect(r.doc.startYear).toBe(2015);
    expect(r.doc.deviceClass).toMatch(/ios|android|pc/);
  });
  it("選択肢に無い値・未来の開始年・年齢未確認を弾く", () => {
    expect(buildProfileDoc({ ...base, position: "宇宙人" })).toHaveProperty("error");
    expect(buildProfileDoc({ ...base, startYear: 2199 })).toHaveProperty("error");
    expect(buildProfileDoc({ ...base, ageConfirmed: false })).toHaveProperty("error");
    expect(
      buildProfileDoc({ ...base, gear: { alto: { ...base.gear.alto, instrumentModel: "でたらめ" } } })
    ).toHaveProperty("error");
  });
  it("startYear が非整数だと弾く", () => {
    expect(buildProfileDoc({ ...base, startYear: 2015.5 })).toHaveProperty("error");
    expect(buildProfileDoc({ ...base, startYear: "abc" })).toHaveProperty("error");
  });
  it("複数選択は許可リスト外を黙って除外する", () => {
    const r = buildProfileDoc({ ...base, genres: ["クラシック", "演歌"] });
    expect(r.doc.genres).toEqual(["クラシック"]);
  });
  it("doc のキー集合が Firestore ルールと一致する14キーに固定される", () => {
    // 2026-09-02: icon / iconColor を足して12→14。
    // **この列を実装から作らないこと。**手で書いたこの列だけが正で、
    // 数も綴りも firestore.rules の hasAll / hasOnly と一致していなければならない。
    const r = buildProfileDoc(base, new Date("2026-08-27"));
    expect(Object.keys(r.doc).sort()).toEqual(
      [
        "ageConfirmed",
        "deviceClass",
        "ensembles",
        "gear",
        "genres",
        "icon",
        "iconColor",
        "isPublic",
        "nickname",
        "places",
        "position",
        "saxTypes",
        "startYear",
        "updatedAt",
      ].sort()
    );
  });
  it("doc は単数の saxType を持たず、複数形の saxTypes だけを持つ", () => {
    const r = buildProfileDoc(base, new Date("2026-08-27"));
    expect(Object.keys(r.doc)).not.toContain("saxType");
    expect(Object.keys(r.doc)).toContain("saxTypes");
    expect(r.doc.saxTypes).toEqual(["alto"]);
  });
  it("入力に余計なキーを混ぜても doc に漏れない", () => {
    const r = buildProfileDoc(
      { ...base, evilKey: "x", gear: { alto: { ...base.gear.alto, evilKey: "x" } } },
      new Date("2026-08-27")
    );
    expect(r.doc).not.toHaveProperty("evilKey");
    expect(r.doc.gear.alto).not.toHaveProperty("evilKey");
    expect(Object.keys(r.doc.gear.alto).sort()).toEqual([...GEAR_KEYS].sort());
  });

  // ---- 楽器種別が複数になったことで増えた規則 ----
  describe("saxTypes", () => {
    // 【1件ずつ独立の it にする】1つの it に複数の入力を並べると、最初の1件で落ちた時点で
    // 残りが評価されず、どの規則が効いていないのか分からなくなる(変異試験で実際に起きた)。
    it("空配列を弾く", () => {
      expect(buildProfileDoc({ ...base, saxTypes: [], gear: {} })).toHaveProperty("error");
    });
    it("配列でない値を弾く", () => {
      expect(buildProfileDoc({ ...base, saxTypes: "alto" })).toHaveProperty("error");
      expect(buildProfileDoc({ ...base, saxTypes: undefined })).toHaveProperty("error");
    });
    it("選択肢に無い種別を含むと弾く", () => {
      expect(
        buildProfileDoc({ ...base, saxTypes: ["alto", "sopranino"], gear: { alto: {}, sopranino: {} } })
      ).toHaveProperty("error");
    });
    it("5個以上を弾く(gear のキー数と揃えても通さない)", () => {
      expect(
        buildProfileDoc({
          ...base,
          saxTypes: ["soprano", "alto", "tenor", "baritone", "alto"],
          gear: { soprano: {}, alto: {}, tenor: {}, baritone: {} },
        })
      ).toHaveProperty("error");
    });
    it("同じ種別を2回選ぶと弾く(要素数とキー数の一致で完全一致を言えなくなるため)", () => {
      expect(buildProfileDoc({ ...base, saxTypes: ["alto", "alto"], gear: { alto: {} } })).toHaveProperty("error");
    });
    it("4種別すべてを選んだ入力は通る(上限は4)", () => {
      const r = buildProfileDoc(
        {
          ...base, saxTypes: [...SAX_TYPES],
          gear: { soprano: { ...ANY_GEAR }, alto: { ...ANY_GEAR }, tenor: { ...ANY_GEAR }, baritone: { ...ANY_GEAR } },
        },
        new Date("2026-08-27")
      );
      expect(r.error).toBeUndefined();
      expect(r.doc.saxTypes).toEqual([...SAX_TYPES]);
    });
  });

  // ---- gear のキー集合は saxTypes と完全一致 ----
  describe("gear のキー集合", () => {
    it("saxTypes より多いキーがあると弾く(持っていない楽器の機材)", () => {
      expect(
        buildProfileDoc({ ...base, saxTypes: ["alto"], gear: { alto: base.gear.alto, tenor: {} } })
      ).toHaveProperty("error");
    });
    it("saxTypes より少ないと弾く(選んだ楽器の欄が無い)", () => {
      expect(
        buildProfileDoc({ ...base, saxTypes: ["alto", "tenor"], gear: { alto: base.gear.alto } })
      ).toHaveProperty("error");
      const { gear, ...noGear } = base;
      expect(buildProfileDoc(noGear)).toHaveProperty("error");
      expect(buildProfileDoc({ ...base, gear: {} })).toHaveProperty("error");
    });
    it("キー名が違うだけでも弾く(数は合っていても集合が違う)", () => {
      expect(
        buildProfileDoc({ ...base, saxTypes: ["alto"], gear: { tenor: {} } })
      ).toHaveProperty("error");
    });
    it("gear が map でないと弾く", () => {
      expect(buildProfileDoc({ ...base, gear: null })).toHaveProperty("error");
      expect(buildProfileDoc({ ...base, gear: [base.gear.alto] })).toHaveProperty("error");
      expect(buildProfileDoc({ ...base, gear: { alto: "YAS-62" } })).toHaveProperty("error");
    });
    it("2種別ぶんの機材を入れた正常系: gear が2キーを持ち、それぞれ6キーを持つ", () => {
      const r = buildProfileDoc(
        {
          ...base,
          saxTypes: ["alto", "tenor"],
          gear: {
            alto: { ...ANY_GEAR, instrumentBrand: "YAMAHA", instrumentModel: "YAS-62", mpBrand: "Selmer", mpModel: "S80 C*" },
            tenor: { ...ANY_GEAR, instrumentBrand: "YAMAHA", instrumentModel: "YTS-62" },
          },
        },
        new Date("2026-08-27")
      );
      expect(r.error).toBeUndefined();
      expect(Object.keys(r.doc.gear).sort()).toEqual(["alto", "tenor"]);
      expect(Object.keys(r.doc.gear.alto).sort()).toEqual([...GEAR_KEYS].sort());
      expect(Object.keys(r.doc.gear.tenor).sort()).toEqual([...GEAR_KEYS].sort());
      expect(r.doc.gear.alto.instrumentModel).toBe("YAS-62");
      expect(r.doc.gear.tenor.instrumentModel).toBe("YTS-62");
      expect(r.doc.gear.tenor.ligBrand).toBe(OTHER_BRAND);
      // 以前ここは mpBrand が null であることを見ていた。必須化でその値は作れなくなったので、
      // 「種別ごとに別々の値が入る」ことを別の欄で言い直す(alto は Selmer、tenor は その他)。
      expect(r.doc.gear.alto.mpBrand).toBe("Selmer");
      expect(r.doc.gear.tenor.mpBrand).toBe(OTHER_BRAND);
    });
  });

  // ---- 楽器の妥当性は種別ごとに判定する ----
  // YAS-62 は YAMAHA の alto、YTS-62 は YAMAHA の tenor にしか無い型番なので、
  // 「種別を無視して照合している」実装ならこの2組のどちらかが必ず落ちる。
  describe("楽器の妥当性は種別ごとに判定される", () => {
    // 【渡された欄以外は埋めてから検査する】この describe の主題は
    // 「楽器の型番が種別ごとに照合されるか」。機材3欄が必須になったので、埋めずに渡すと
    // **マウスピース未選択で先に落ちて**、楽器の照合を一度も通らないまま
    // 「弾かれた」ことになる。検査は緑のままなのに、確かめたい仕組みは一切動いていない
    // ——という一番たちの悪い形になるので、ここで穴を埋める。
    const withGear = (types, gear) => buildProfileDoc(
      {
        ...base, saxTypes: types,
        gear: Object.fromEntries(Object.entries(gear).map(([t, g]) => [t, { ...ANY_GEAR, ...g }])),
      },
      new Date("2026-08-27")
    );

    it("alto の欄に tenor の型番(YTS-62)を入れると弾く", () => {
      expect(withGear(["alto"], { alto: { instrumentBrand: "YAMAHA", instrumentModel: "YTS-62" } })).toHaveProperty("error");
    });
    it("同じ YTS-62 を tenor の欄に入れれば通る", () => {
      const r = withGear(["tenor"], { tenor: { instrumentBrand: "YAMAHA", instrumentModel: "YTS-62" } });
      expect(r.error).toBeUndefined();
      expect(r.doc.gear.tenor.instrumentModel).toBe("YTS-62");
    });
    it("tenor の欄に alto の型番(YAS-62)を入れると弾く", () => {
      expect(withGear(["tenor"], { tenor: { instrumentBrand: "YAMAHA", instrumentModel: "YAS-62" } })).toHaveProperty("error");
    });
    it("2種別のうち片方だけが種別違いでも全体が弾かれる", () => {
      expect(
        withGear(["alto", "tenor"], {
          alto: { instrumentBrand: "YAMAHA", instrumentModel: "YAS-62" },
          tenor: { instrumentBrand: "YAMAHA", instrumentModel: "YAS-62" }, // tenor に alto の型番
        })
      ).toHaveProperty("error");
    });
    // 【変異試験で見つけた穴】マウスピースとリガチャーの照合を素通しにしても、
    // 移行前のテストは1件も落ちなかった(落ちていたのは楽器の照合だけ)。
    // カタログは3つあるので、3つとも「カタログに無い値は弾く」を押さえる。
    it("マウスピースがカタログに無いと弾く", () => {
      expect(
        buildProfileDoc({ ...base, gear: { alto: { ...base.gear.alto, mpModel: "でたらめ" } } })
      ).toHaveProperty("error");
    });
    it("リガチャーがカタログに無いと弾く", () => {
      expect(
        buildProfileDoc({ ...base, gear: { alto: { ...base.gear.alto, ligBrand: "Rovner", ligModel: "でたらめ" } } })
      ).toHaveProperty("error");
    });
    it("リードがカタログに無いと弾く", () => {
      expect(
        buildProfileDoc({ ...base, gear: { alto: { ...base.gear.alto, reedBrand: "Vandoren", reedModel: "青箱" } } })
      ).toHaveProperty("error");
    });
    it("リードは正式名称で通る(通称は通らない)", () => {
      // 本人裁定「製品名は正式名称」。青箱ではなく Traditional で登録される。
      const r = buildProfileDoc({ ...base, gear: { alto: { ...base.gear.alto, reedBrand: "Vandoren", reedModel: "Traditional" } } }, new Date("2026-08-27"));
      expect(r.error).toBeUndefined();
      expect(r.doc.gear.alto.reedModel).toBe("Traditional");
    });
    it("エラー文言はどの楽器種別の話かを言う", () => {
      const r = withGear(["tenor"], { tenor: { instrumentBrand: "YAMAHA", instrumentModel: "YAS-62" } });
      expect(r.error).toContain("Tenor");
    });
  });

  // 【2026-09-02 本人裁定】機材3欄は未選択で登録できない。該当が無ければ「その他」を選ぶ。
  it("機材を1つも選ばないと弾かれる", () => {
    const r = buildProfileDoc({ ...base, gear: { alto: { ...NO_GEAR } } }, new Date("2026-08-27"));
    expect(r.error).toBeTruthy();
  });
  it("種別のキーだけ置いて中身を空にしても弾かれる", () => {
    expect(buildProfileDoc({ ...base, gear: { alto: {} } }, new Date("2026-08-27"))).toHaveProperty("error");
  });
  it("3欄それぞれの未選択を、どの欄の話か分かる文言で弾く", () => {
    const only = (k, v) => buildProfileDoc(
      { ...base, gear: { alto: { ...base.gear.alto, [k]: null } } }, new Date("2026-08-27")
    ).error;
    // 「カタログにありません」ではなく「選んでください」が出ること。
    // 何も選んでいない人にカタログの話をしても、探し直すだけで解決しない。
    expect(only("instrumentBrand")).toContain("楽器を選んでください");
    expect(only("mpBrand")).toContain("マウスピースを選んでください");
    expect(only("ligBrand")).toContain("リガチャーを選んでください");
    expect(only("reedBrand")).toContain("リードを選んでください");
  });
  it("明示的に「その他」を選んだ場合は文字列で保存される", () => {
    const r = buildProfileDoc(
      { ...base, gear: { alto: { ...ANY_GEAR } } },
      new Date("2026-08-27")
    );
    expect(r.error).toBeUndefined();
    expect(r.doc.gear.alto).toEqual(ANY_GEAR);
  });
  // 【必須化しても null は消えない】この検査を消さないこと。
  // 必須化が効くのは*これから書く*ドキュメントだけで、(a) 既に null で保存された物は残り、
  // (b) firestore.rules は null を許したままなので生SDKからは書ける。
  // 計画4の機材シェアは、null を「その他」の票に数えてはいけない。
  it("「その他」は null と同じ値にならない(読む側が欠測と区別できる)", () => {
    const other = buildProfileDoc(
      { ...base, gear: { alto: { ...ANY_GEAR } } },
      new Date("2026-08-27")
    ).doc;
    expect(other.gear.alto.instrumentBrand).toBe(OTHER_BRAND);
    expect(other.gear.alto.instrumentBrand).not.toBeNull();
    expect(other.gear.alto).not.toEqual(NO_GEAR);
  });
  it("ブランドだけ null でモデルを渡す不整合は弾く", () => {
    expect(
      buildProfileDoc({ ...base, gear: { alto: { ...base.gear.alto, instrumentBrand: null } } })
    ).toHaveProperty("error");
  });

  // 【2026-09-02 本人裁定】ジャンル・編成・練習場所も1つ以上必須。
  describe("多選択は1つ以上必須", () => {
    for (const k of ["genres", "ensembles", "places"]) {
      it(`${k} が空だと弾かれる`, () => {
        expect(buildProfileDoc({ ...base, [k]: [] }, new Date("2026-08-27"))).toHaveProperty("error");
      });
      it(`${k} に選択肢外の値だけを渡しても弾かれる(捨てられて空になるため)`, () => {
        // pickAllowed が落とすので「渡した数」は1でも「残った数」は0になる。
        // 渡した数を見る実装だとここが素通りする。
        expect(buildProfileDoc({ ...base, [k]: ["ありえない値"] }, new Date("2026-08-27"))).toHaveProperty("error");
      });
    }
    it("編成と練習場所にも「その他」があり、それだけで登録できる", () => {
      // 必須にする以上、当てはまらない人の逃げ道が要る。逃げ道が無い必須化は嘘の申告を生む。
      const r = buildProfileDoc({ ...base, ensembles: ["その他"], places: ["その他"] }, new Date("2026-08-27"));
      expect(r.error).toBeUndefined();
      expect(r.doc.ensembles).toEqual(["その他"]);
      expect(r.doc.places).toEqual(["その他"]);
    });
  });

  describe("アイコン", () => {
    it("絵柄が未指定・一覧に無いものは弾く", () => {
      const { icon, ...noIcon } = base;
      expect(buildProfileDoc(noIcon)).toHaveProperty("error");
      expect(buildProfileDoc({ ...base, icon: "ic-そんな絵柄は無い" })).toHaveProperty("error");
      // 自由文を通すと、公開プロフィールに任意の文字列が載る経路が1つ増える
      expect(buildProfileDoc({ ...base, icon: "<script>" })).toHaveProperty("error");
    });
    it("色は1..10の整数だけを通す", () => {
      for (const bad of [0, 11, -1, 1.5, "1", null, undefined, NaN]) {
        expect(buildProfileDoc({ ...base, iconColor: bad })).toHaveProperty("error");
      }
      for (const ok of [1, 5, 10]) {
        expect(buildProfileDoc({ ...base, iconColor: ok }, new Date("2026-08-27")).error).toBeUndefined();
      }
    });
    it('文字列の "3" を弾く(ルールの is int と同じ厳しさにする)', () => {
      // ここが緩いと、保存の瞬間に permission-denied になるまで気づけない。
      expect(buildProfileDoc({ ...base, iconColor: "3" })).toHaveProperty("error");
    });
    it("絵柄と色がそのまま保存される", () => {
      const r = buildProfileDoc({ ...base, icon: "ic-fish", iconColor: 7 }, new Date("2026-08-27"));
      expect(r.error).toBeUndefined();
      expect(r.doc.icon).toBe("ic-fish");
      expect(r.doc.iconColor).toBe(7);
    });
  });

  it("isPublic を省略すると既定で true になる", () => {
    const { isPublic, ...rest } = base;
    const r = buildProfileDoc(rest, new Date("2026-08-27"));
    expect(r.doc.isPublic).toBe(true);
  });
  it("isPublic: false を渡すと false になる", () => {
    const r = buildProfileDoc({ ...base, isPublic: false }, new Date("2026-08-27"));
    expect(r.doc.isPublic).toBe(false);
  });
});

// 計画1に Cloud Functions は無く、サーバ側の検査は firestore.rules しかない。
// ルール側は同じ列挙を手で書き写して持っているので、片方だけ直されると
// 「アプリでは選べるのに保存できない」または「ルールが自由文を通す」のどちらかが起きる。
// 写しである以上、食い違いをテストで検出できる状態にしておく。
describe("firestore.rules との同期", () => {
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  const asRulesList = (arr) => "[" + arr.map((s) => `'${s}'`).join(",") + "]";

  it("position の列挙がルールと一致する", () => {
    expect(rules).toContain(`request.resource.data.position in ${asRulesList(POSITIONS)}`);
  });
  it("genres / ensembles / places の列挙がルールと一致する", () => {
    expect(rules).toContain(`request.resource.data.genres.hasOnly(${asRulesList(GENRES)})`);
    expect(rules).toContain(`request.resource.data.ensembles.hasOnly(${asRulesList(ENSEMBLES)})`);
    expect(rules).toContain(`request.resource.data.places.hasOnly(${asRulesList(PLACES)})`);
  });
  it("saxTypes の列挙がルールと一致する", () => {
    expect(rules).toContain("request.resource.data.saxTypes is list");
    expect(rules).toContain(`request.resource.data.saxTypes.hasOnly(${asRulesList(SAX_TYPES)})`);
  });
  it("saxTypes の要素数の上下限がルールに在る(1つ以上4つ以下)", () => {
    expect(SAX_TYPES.length).toBe(4); // 上限4の根拠は「種別が4つしか無い」こと
    expect(rules).toContain("request.resource.data.saxTypes.size() >= 1");
    expect(rules).toContain("request.resource.data.saxTypes.size() <= 4");
  });
  it("ドキュメント直下のキー集合が saxTypes を含み、単数の saxType を含まない", () => {
    // 'saxTypes' は 'saxType' を部分文字列として含むので、閉じ引用符まで見て区別する
    expect(rules).toContain("'saxTypes'");
    expect(rules).not.toContain("'saxType'");
    // ドキュメント直下のキー集合を並べている行は hasAll と hasOnly の2本。
    // (gear の中の `...gear.keys()` はこの綴りを含まないので拾われない。)
    // 2本という数はここでは不変条件そのもの ─ 片方だけだと余りか欠けのどちらかを見逃す。
    const keyListLines = rules.split(/\r?\n/).filter((l) => l.includes("request.resource.data.keys()"));
    expect(keyListLines).toHaveLength(2);
    const docKeys = Object.keys(buildProfileDoc(base, new Date("2026-08-27")).doc);
    for (const line of keyListLines) {
      for (const k of docKeys) expect(line).toContain(`'${k}'`);
      expect(line).not.toContain("'saxType'");
    }
  });
  it("gear 1組のキー列挙が4種別ぶんルールに在り、実装と同じ8キーである", () => {
    // 【ここが食い違うと本番でしか壊れない】実装が8キーを書き、ルールが6キーしか許さないと、
    // 保存の瞬間に permission-denied になる。しかも手元では起きない
    // (手元にルールは無く、テストも通る)。実際に古いルールのまま配って踏んだ。
    const list = "[" + GEAR_KEYS.map((k) => `'${k}'`).join(",") + "]";
    for (const t of SAX_TYPES) {
      expect(rules).toContain(`request.resource.data.gear.${t}.keys().hasAll(${list})`);
      expect(rules).toContain(`request.resource.data.gear.${t}.keys().hasOnly(${list})`);
    }
  });
  it("gear のキー集合が saxTypes と完全一致であることをルールが要求している", () => {
    expect(rules).toContain("request.resource.data.gear is map");
    expect(rules).toContain("request.resource.data.gear.keys().hasOnly(request.resource.data.saxTypes)");
    expect(rules).toContain("request.resource.data.gear.keys().hasAll(request.resource.data.saxTypes)");
  });
  it("saxTypes と gear のキーの要素数一致をルールが要求している(重複よけ)", () => {
    // hasOnly / hasAll は集合の検査なので、saxTypes: ['alto','alto'] + gear: {alto:{}} は
    // どちらも集合 {alto} になって素通りする。要素数の突き合わせだけが重複を落とす。
    // クライアント側の不変条件(「同じ種別を2回選ぶと弾く」)と対になる行。
    expect(rules).toContain(
      "request.resource.data.saxTypes.size() == request.resource.data.gear.keys().size()"
    );
  });
  it("4種別それぞれについて、機材の6キーと string-or-null の型検査がある", () => {
    for (const type of SAX_TYPES) {
      const p = `request.resource.data.gear.${type}`;
      // 「そのキーが在るなら中身を検査する」形の入口
      expect(rules).toContain(`!request.resource.data.gear.keys().hasAny(['${type}'])`);
      expect(rules).toContain(`${p}.keys().hasAll(${asRulesList(GEAR_KEYS)})`);
      expect(rules).toContain(`${p}.keys().hasOnly(${asRulesList(GEAR_KEYS)})`);
      for (const key of GEAR_KEYS) {
        expect(rules).toContain(`${p}.${key} == null`);
        expect(rules).toContain(`${p}.${key} is string`);
        expect(rules).toContain(`${p}.${key}.size() <= 60`);
      }
    }
  });
  it("互いを指す注意書きが両側にある", () => {
    expect(rules).toContain("src/community/profile.js");
    const profileSrc = readFileSync(new URL("./profile.js", import.meta.url), "utf8");
    expect(profileSrc).toContain("firestore.rules");
  });
});

describe("detectDeviceClass", () => {
  it("UA文字列から判定する", () => {
    expect(detectDeviceClass("Mozilla/5.0 (iPhone; ...)")).toBe("ios");
    expect(detectDeviceClass("Mozilla/5.0 (Linux; Android 14; ...)")).toBe("android");
    expect(detectDeviceClass("Mozilla/5.0 (Windows NT 10.0)")).toBe("pc");
  });
});
