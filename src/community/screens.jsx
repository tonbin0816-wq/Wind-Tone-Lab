import React, { useEffect, useMemo, useState } from "react";
import { SAX_TYPES, SAX_LABELS, GENRES, POSITIONS, AVATAR_ICONS, AVATAR_COLOR_MIN, positionLabel } from "./profile.js";
import { listPublicUsers, filterUsers, isFiltered, isFilteredBy, ANY, DIRECTORY_LIMIT } from "./directory.js";
import { rankByPractice, tallyGearByBrand, tallyGearModels, isDrillable, tallyCombos, GEAR_SLOTS, SLOT_LABEL, SLOT_MODEL_WORD, UNSET, COMBO_SLOTS } from "./aggregate.js";
import { PERIODS, PERIOD_LABEL, PERIOD_PHRASE } from "./stats.js";
import { OTHER_BRAND } from "./catalog/gear.js";
import { cohortAverage, alignProfile, noteValues } from "./align.js";
import { joinOwners } from "./idealRepo.js";
import { sanitizeNotes, buildAdoptedProfile } from "./idealDoc.js";
import { Avatar } from "./icons.jsx";
// 戻るの見た目は App.jsx の BACK_BUTTON_STYLE ただ1つ(2026/09/08 本人裁定)。
// CommunityTab.jsx が前から同じ向きで App.jsx を読んでいるので、依存の形は変わらない。
// シートの器も App.jsx の BottomSheet ただ1つ(C-16 / D-6 2026/09/09 本人裁定)。
// 【便AO 2026-09-24】音名軸の折れ線もアプリ本体の NoteAxisLineChart ただ1つ(手作りの LineChart は消した)。
import { BACK_BUTTON_STYLE, BottomSheet, NoteAxisLineChart, formatSignedCents } from "../App.jsx";
// 【計画5 モデレーション 2026-09-10】通報。判断は report.js、読み書きは reportRepo.js。
import { hideFlagged, REPORT_REASONS, reportEntryVisible } from "./report.js";
import { listFlaggedUids, reportUser } from "./reportRepo.js";
// 【便AH 2026-09-23】アイコンの写真。**出すかどうかの判断は純関数が持つ**
// (凍結仕様 決定5。docs/superpowers/specs/2026-09-23-avatar-photo.md)。
import { photoZoomAvailable } from "./avatarPhoto.js";
import PhotoZoom from "./PhotoZoom.jsx";

// ------------------------------------------------------------------
// 共有のスタイル。値はトークンから引くだけで、新しい寸法・色は作らない。
// ------------------------------------------------------------------
// 【便AH 2026-09-23】写真を押して拡大するための器。**地も枠も足さない**(§6.7) ──
// アイコンの円そのものが当たり判定で、56px なので --tap-min を超える。
const PHOTO_TAP_STYLE = {
  display: "inline-flex", flex: "none", padding: 0,
  background: "none", border: "none", borderRadius: "var(--r-full)", cursor: "pointer",
};
/* 【minmax(0, 1fr) を外さないこと】grid の子の min-width は既定 auto なので、
   中の長い文字(型番・メーカー)が列そのものを押し広げ、**ページ全体の X 軸がずれる**。
   凡例の行に minWidth: 0 と省略記号は付けてあるが、それは flex の中でしか効かない。
   実測: 375px 幅でカードが 619.7px まで広がった。minmax(0, 1fr) で 315px に収まる。
   同じ事故がアイコンの色の格子でも起きている(CommunityTab.jsx の格子のコメント)。 */
// 【B10 2026/09/09 本人裁定「30に寄せる」】左右は .app-root の 14px だけにする。
// ここに --sp-4 を足すと**打ち消しではなく上乗せ**になり、カードの中の文字が
// 14+16+16 = 46px と、My Data 側の 30px より 16px 右へずれる(ブラウザ実測)。
// 縦の --sp-4 と カード間の gap はそのまま。
const pageStyle = { padding: "var(--sp-4) 0", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "var(--sp-4)" };
const noteStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", lineHeight: 1.6 };
const labelStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", fontWeight: 600 };
// 【カードの作法】§6.6。地は白・浮きは影だけ・群の境界の罫は1本も引かない。
//
// 【寸法は index.css がただ1箇所で持つ 2026/09/08 本人裁定「部品写しはいいと思う方を採用」】
// ここには前まで cardStyle / cardListStyle / rowcardStyle という**同じ3値の写し**が
// あった。CSS の .surf-card .card を直してもコミュニティのカードは変わらない状態だった。
// コミュニティは CommunityTab の根が .surf-card の中にあるので、クラスがそのまま効く:
//   .card       … 角丸 --r-lg / 内側 --sp-4 / --shadow-card
//   .card-list  … 一覧を包むときだけ上下を --sp-1 に詰める(左右はそのまま)
//   .rowcard    … 角丸 --r-md / 内側 10px 14px / --shadow-row
// **padding をインラインで上書きしないこと**(§6.6。上書きすると検査が中身を読めなくなる)。
// 【読ませる文章は --c-ink-2】§1.1「--c-ink-3 は約3.0:1。読ませたい文章には使わない。
// 軸目盛や区切り記号まで」。noteStyle は数値の添え物用、bodyNoteStyle は文章用。
const bodyNoteStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", lineHeight: 1.8 };
// 10px は §6.6「D-10 の実寸」表の eyebrow(10px / 600 / .08em / --c-ink-3)。体系が持つ値。
const eyebrowStyle = { fontSize: 10, fontWeight: 600, letterSpacing: ".08em", color: "var(--c-ink-3)" };
// 【束5 2026-09-20 本人指示】「目安に設定のボタンと[計測環境により…]のテキストが被っている
// のでボタンの位置を下げて」。貼り付くボタン(sticky / bottom 0)と対で、**本文の末尾に
// ボタンの高さぶんの空きを置く**。片方だけだと最後まで送っても注記がボタンの下に残る。
// 高さは**ボタンの実寸から引く** ── ボタンの高さは minHeight: var(--tap-min)、
// 間隔は既にこの画面が使っている --sp-3。新しい数は作らない
// (App.jsx の FLOAT_ACTION_SPACER_H と同じ考え方。あちらは絵柄だけの 56 角なので値が違う)。
const ADOPT_STICKY_SPACER_H = "calc(var(--tap-min) + var(--sp-3))";

// ------------------------------------------------------------------
// 指標の切替は**下線タブ**。現行アプリの MetricUnderlineTabs(App.jsx)と同じ作り。
// 当たり判定 44px / 見えるのは 26px の文字と下線だけ / 選択は inset 0 -2px。
// **カードの作法では下の罫を引かない**(D-30 §7.2「bordered を渡さない」)。
// 本人指示「現行アプリと同じ機能は現行に揃える」。
// ------------------------------------------------------------------
function UnderlineTabs({ items, value, onChange, label }) {
  return (
    <div className="sans" role="tablist" aria-label={label}
      style={{ display: "flex", alignItems: "center", gap: 0, marginLeft: -10, flexWrap: "wrap" }}>
      {items.map((it) => {
        const sel = it.key === value;
        return (
          <button key={it.key} type="button" role="tab" aria-selected={sel}
            onClick={() => onChange(it.key)} className="sans"
            style={{
              minHeight: "var(--tap-min)", minWidth: "var(--tap-min)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              padding: "0 10px", background: "none", border: "none", cursor: "pointer",
            }}>
            <span style={{
              display: "inline-flex", alignItems: "center", minHeight: 26, padding: "0 2px",
              fontSize: "var(--fs-sm)", fontWeight: 600,
              color: sel ? "var(--c-ink)" : "var(--c-ink-3)",
              boxShadow: sel ? "inset 0 -2px 0 0 var(--c-ink)" : "none",
            }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------
// 溝型の切り替え(SegmentedTabs)
//
// 【便AT 2026-09-24 本人指示】「タブ切り替えを4枚目(別のアプリの『打撃成績 | 投手成績』)の
// デザインと同じにして」。灰色の溝の中で、選んでいる側だけが白く浮き上がる形。
// 使う場所は2つ: 順位の種類(練習日数 | 練習時間)・人物紹介の「データ | プロフィール」。
// 【便AU 2026-09-24 本人指示】楽器の行(人物紹介・マイページ)は前の選択チップ(Chip)に戻した ──
// 「人物のページのタブはデータとプロフィールを新しいタブ形式にして欲しかった。楽器の形式は前のやつに戻して」。
//
// 寸法: 溝(--c-sunken・角 --r-2)は高さ 44。**押せる箱は溝の高さいっぱい(44)**で、
// 見える白い面(角 --r-1)は内側 36。文字は --fs-md。
// 選べない項目(disabled)は溝の中に並べるが、字を --c-line-strong まで落として押せなくする
// (<button> にも role="radio" にもしない ── 読み上げにも「選べる」と言わせない。Chip の off と
// 同じ作法・同じ色)。白い面は選べる項目にしか乗らない。
// ------------------------------------------------------------------
export function SegmentedTabs({ items, value, onChange, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{
      display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(0, 1fr)",
      background: "var(--c-sunken)", borderRadius: "var(--r-2)", padding: "0 2px",
      minHeight: "var(--tap-min)",
    }}>
      {items.map((it) => {
        const on = !it.disabled && it.key === value;
        const face = (
          <span style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "100%", minWidth: 0, minHeight: 36, padding: "0 4px", boxSizing: "border-box",
            borderRadius: "var(--r-1)", whiteSpace: "nowrap", overflow: "hidden",
            fontSize: "var(--fs-md)", fontWeight: on ? 700 : 600,
            color: it.disabled ? "var(--c-line-strong)" : on ? "var(--c-ink)" : "var(--c-ink-3)",
            background: on ? "var(--c-surface)" : "transparent",
            boxShadow: on ? "var(--shadow-seg)" : "none",
          }}>{it.label}</span>
        );
        const box = {
          display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0,
          minHeight: "var(--tap-min)", padding: "0 2px", border: "none", background: "none",
        };
        if (it.disabled) return <span key={it.key} className="sans" style={box}>{face}</span>;
        return (
          <button key={it.key} type="button" role="radio" aria-checked={on}
            onClick={() => onChange(it.key)} className="sans"
            style={{ ...box, cursor: "pointer" }}>
            {face}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------
// 【便AU 2026-09-24 本人指示「楽器の形式は前のやつに戻して」】楽器の行はこのチップに戻した。
// 選択チップ。**当たり判定 44px / 見えるピルは 30px**。
// 本人指摘「44ptの決まりはあるが明らかに大きすぎる」への答えで、
// 箱ではなく中身を小さくする(§5「見た目の大きさは変えない。当たり判定だけ広げる」)。
// 先例: §5.1 My Data の式の行 20px / §5.2 分析タブのチップ 30px。
// ------------------------------------------------------------------
// 【off = 選びようが無いもの 2026-09-19 本人指示・案ア】
// 人物画面の楽器の行が、その人が**吹かない**種別も並べるようになった(SaxTypeRow)。
// 吹かない種別は選択に切り替わりようがない = **状態を持たない**ので、
// index.css §6.7「枠線は状態を持つものにだけ」に従って**枠を持たせない**
// (`1px solid transparent` ── 枠を 0 にすると寸法が 2px ずれて行が揃わなくなる)。
// 字も --c-line-strong まで落とす。**新しい色は作らない**(枠に使っている既存の値)。
// 押せないので <button> にも role="radio" にもしない ── 読み上げにも「選べる」と言わせない。
function Chip({ on, onClick, children, grow = false, ariaLabel, off = false }) {
  const boxStyle = {
    minHeight: "var(--tap-min)", display: "inline-flex", alignItems: "center",
    justifyContent: "center", padding: 0, border: "none", background: "none",
    flex: grow ? "1 1 0" : "0 0 auto", minWidth: 0,
  };
  const pill = (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minHeight: 30, padding: "0 13px", borderRadius: "var(--r-pill)",
      border: `1px solid ${off ? "transparent" : on ? "var(--c-accent)" : "var(--c-line-strong)"}`,
      color: off ? "var(--c-line-strong)" : on ? "var(--c-accent)" : "var(--c-ink-2)",
      fontSize: "var(--fs-xs)", fontWeight: 600, whiteSpace: "nowrap",
      width: grow ? "100%" : "auto", boxSizing: "border-box",
    }}>{children}</span>
  );
  if (off) return <span className="sans" style={boxStyle}>{pill}</span>;
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={ariaLabel}
      onClick={onClick} className="sans"
      style={{ ...boxStyle, cursor: "pointer" }}>
      {pill}
    </button>
  );
}

// ------------------------------------------------------------------
// 条件行。**3画面が同じ部品を同じ位置(上部1行)に置く。**
//
// 掛け算は 楽器 × ジャンル × 属性 の3つに固定する。それぞれ単一選択で、
// 複数選択にはしない ── 「クラシック または ジャズ」の平均は誰の目安にもならない。
// カードで囲まない(2026-08-28 本人裁定)。
// ------------------------------------------------------------------
// 【1つの条件ピル】§6.7 の B型(枠線なし・地は --c-sunken)。
// **ON の合図に地を足さない**(§6.7)。選んだかどうかは**文字の濃さ**で返す。
//
// 【項目名を欄の中に出さない】3等分で1つ 110px しかなく、「ジャンル」を固定幅で置くと
// 値に 27px しか残らず「ジ…」になる(実測)。唯一の情報である値を削って
// ラベルを守るのは順序が逆。未選択のときは項目名が薄い文字で入り、選ぶと値に置き換わる。
// 並びは常に 楽器 / ジャンル / 属性 で固定なので、どの枠かは位置で分かる。
//
// 【native の select を透明で重ねる】iOS の選択UIをそのまま使える。
// 見た目のピルは aria-hidden にして、読み上げは select が担う。
// allowAny=false のとき「すべて」は出さない。シェアとデータは楽器種別ごとに
// 1組を数える画面で、種別が決まらないと何の内訳なのか言えないため(争点B)。
function FilterPill({ label, value, options, labelOf, onChange, allowAny = true, dense = false }) {
  // 「すべて」が無いピルは常に値を持つので、常に「選んでいる」濃さで出る。
  const on = value !== ANY;
  return (
    <span style={{
      flex: "1 1 0", minWidth: 0, position: "relative", display: "flex",
      alignItems: "center", justifyContent: "center", minHeight: "var(--tap-min)",
    }}>
      <select
        aria-label={`${label}で絞り込む`} value={value}
        onChange={(e) => onChange(e.target.value)} className="sans"
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%",
          opacity: 0, border: "none", cursor: "pointer", WebkitAppearance: "none", appearance: "none",
        }}>
        {allowAny ? <option value={ANY}>{label}(すべて)</option> : null}
        {options.map((v) => <option key={v} value={v}>{labelOf ? labelOf(v) : v}</option>)}
      </select>
      <span aria-hidden="true" className="sans" style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
        // 【便AT】4つ並ぶ行(順位)は1つ 80px 前後になるので、左右の内側を 10 → 6 に詰める
        // (「ジャンル」+ 下向きの印が 59px。10 のままだと「ジャン…」になる)。
        width: "100%", minWidth: 0, minHeight: 34, padding: dense ? "0 6px" : "0 10px", boxSizing: "border-box",
        background: "var(--c-sunken)", borderRadius: "var(--r-pill)",
        fontSize: "var(--fs-xs)", fontWeight: on ? 700 : 600,
        color: on ? "var(--c-ink)" : "var(--c-ink-3)", whiteSpace: "nowrap", overflow: "hidden",
      }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {on ? (labelOf ? labelOf(value) : value) : label}
        </span>
        <svg width="7" height="7" viewBox="0 0 10 10" style={{ flex: "none", opacity: .55 }} aria-hidden="true">
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </span>
  );
}

// 【便AT 2026-09-24 本人指示】「期間は上部の楽器ジャンル属性と同じように4つ横並びにして
// 一番右側に加えて」。period / onPeriod を渡した画面(順位)だけ、4つ目に期間のピルが出る。
// 「すべて」は他の3つの「すべて」と同じ扱い(薄い字で項目名「期間」)。選ぶと「今週」などに替わる。
export function FilterRow({ value, onChange, saxAny = true, period = null, onPeriod = null }) {
  const withPeriod = period !== null && typeof onPeriod === "function";
  return (
    <div style={{ display: "flex", gap: withPeriod ? "var(--sp-1)" : "var(--sp-2)" }}>
      <FilterPill label="楽器" value={value.saxType} options={SAX_TYPES} allowAny={saxAny} dense={withPeriod}
        labelOf={(t) => SAX_LABELS[t]} onChange={(v) => onChange({ ...value, saxType: v })} />
      <FilterPill label="ジャンル" value={value.genre} options={GENRES} dense={withPeriod}
        onChange={(v) => onChange({ ...value, genre: v })} />
      <FilterPill label="属性" value={value.position} options={POSITIONS} dense={withPeriod}
        onChange={(v) => onChange({ ...value, position: v })} />
      {withPeriod ? (
        <FilterPill label="期間" dense value={period === "all" ? ANY : period}
          options={PERIODS.filter((p) => p !== "all")} labelOf={(p) => PERIOD_LABEL[p]}
          onChange={(v) => onPeriod(v === ANY ? "all" : v)} />
      ) : null}
    </div>
  );
}

export const EMPTY_FILTER = { saxType: ANY, genre: ANY, position: ANY };

// 【便AW 2026-09-24 本人指示】「アカウントを削除のボタンを背景色なしで枠線とテキストが赤に。
// この人を通報のボタンも同じく」。**押すと確認が開く入口**の一手の見た目(地なし・枠と字が --c-danger)。
// 確認のシートの中の最後の一手(アカウントを削除する)は、今までどおり赤い地のまま(dangerButtonStyle)。
// マイページ(CommunityTab.jsx)と人物紹介の両方がこの1つを読む(写しを作らない)。
export const DANGER_OUTLINE_STYLE = {
  width: "100%", minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)",
  border: "1px solid var(--c-danger)", background: "transparent", color: "var(--c-danger)",
  fontSize: "var(--fs-sm)", fontWeight: 700, cursor: "pointer",
};

// 【上限に触れていることを黙らない】50件で切られていることは、人数もグラフも
// 普通に出るので画面からは分からない。切られたときだけ必ず出す。
// 詳細は設計書の決定1-b(公開ユーザーが40人に達したら読み直すこと)。
function CapNotice({ count }) {
  if (count < DIRECTORY_LIMIT) return null;
  return (
    <div className="sans" role="note" style={bodyNoteStyle}>上位{DIRECTORY_LIMIT}人</div>
  );
}

// 【A-6 / T2・T3 2026-09-15 本人裁定】0件の知らせ。
// **絞り込み中の0件だけ** onClear を受け取り、「条件を外す」を出す。
// 3画面が同じこの1つを使う(写しを作らない)。onClear を渡さない呼び手の見た目は
// 1px も変わらない ── ボタンごと描かれないため。
function Empty({ children, onClear = null }) {
  return (
    <div className="sans" style={{ ...noteStyle, padding: "var(--sp-4) 0", textAlign: "center" }}>
      {/* 【C2・C3 2026-09-16】align.js の文言は改行の文字で2行に分かれている。pre-line で効かせる。 */}
      <div style={{ whiteSpace: "pre-line" }}>{children}</div>
      {onClear ? (
        /* B型 = .ctl-plain + .ctl-pill。押しても何も壊れないので危険色は持たない */
        <button type="button" onClick={onClear} className="sans ctl-plain ctl-pill"
                style={{ marginTop: "var(--sp-3)", minHeight: "var(--tap-min)", padding: "0 var(--sp-4)",
                         color: "var(--c-ink-2)", fontSize: "var(--fs-sm)", fontWeight: 600, cursor: "pointer" }}>
          条件を外す
        </button>
      ) : null}
    </div>
  );
}

// 【条件名を文に入れるための綴り】0件の文が「この条件」としか言えないと、
// 何を外せばよいのかが画面から読めない。**数える鍵だけ**を渡すこと ──
// 楽器ピルに「すべて」が無い画面(シェア・データ)で saxType を数えると、
// 常に「絞り込み中」になって「まだ誰もいない」と言い分けられなくなる。
const FILTER_TERM_OF = {
  saxType: (v) => SAX_LABELS[v] ?? v,
  genre: (v) => v,
  position: (v) => v,
};
function filterTerms(filter, keys) {
  return keys
    .filter((k) => (filter?.[k] ?? ANY) !== ANY)
    .map((k) => FILTER_TERM_OF[k](filter[k]));
}

// 公開ユーザーを1度だけ読んで使い回す。
// 【画面を切り替えるたびに読み直さない】読み取り回数は費用そのもので、
// 利用者数の2乗で増える(設計書の決定1-b)。同じ50件を何度も読む理由が無い。
//
// 【setUsers を返す理由】自分が公開/非公開を切り替えたとき、サーバへは書くが
// **読み直さない**。他人の変更まで即時に追う必要は無いので、自分の行だけ
// 手元の配列で差し引く(2026/09/06 本人指摘「非公開にしてもその場で反映されない」)。
export function usePublicUsers(myUid = null) {
  const [state, setState] = useState({ phase: "loading", users: [], error: null, flagged: new Set() });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 【計画5 2026-09-10】通報された人をここで落とす。**この1箇所だけ**でよい ──
        // 順位もシェアもデータも、みんなこの users を受け取って数える。
        // 落としてから数えるので、母数からも消える。
        //
        // 【flags が読めなくても一覧は出す】通報の名簿が読めないのは通信の問題であって、
        // そのために「みんなのデータ」自体を出さないのは割に合わない。
        // 隠すべき人が出てしまうが、それは通信が復旧するまでの間だけ。
        const [users, flagged] = await Promise.all([
          listPublicUsers(),
          listFlaggedUids().catch(() => new Set()),
        ]);
        if (alive) setState({ phase: "ready", users: hideFlagged(users, flagged, myUid), error: null, flagged });
      } catch (e) {
        if (alive) setState({ phase: "error", users: [], error: "みんなのデータを読み込めませんでした", flagged: new Set() });
      }
    })();
    return () => { alive = false; };
  }, [myUid]);
  // 読み込み中/失敗中は phase を保ったまま配列だけ差し替える(phase を書き換えない)
  const setUsers = (fn) => setState((s) => ({ ...s, users: typeof fn === "function" ? fn(s.users) : fn }));
  return { ...state, setUsers };
}

// ------------------------------------------------------------------
// 順位
// ------------------------------------------------------------------
const gearLabelOf = (key) => (key === UNSET ? "—" : key === OTHER_BRAND ? "その他" : key);

function yearsOf(startYear) {
  if (!Number.isInteger(startYear)) return null;
  const y = new Date().getFullYear() - startYear;
  return y >= 0 ? y : null;
}

// 「学生  歴3年  クラシック」。読めない区画は丸ごと省く。
// 【中黒を使わない】本人指示。区切りは記号ではなく**余白**で作る
// (§6.0 囲いの序列「1. 余白で分ける」)。並びの gap がそのまま区切りになる。
function whoParts(u) {
  const parts = [];
  // 【便AI】旧い語のまま残っている人も、新しい語で出す。
  const pl = positionLabel(u.position);
  if (pl) parts.push(pl);
  const y = yearsOf(u.startYear);
  if (y !== null) parts.push(`歴${y}年`);
  if (Array.isArray(u.genres) && u.genres[0]) parts.push(u.genres[0]);
  return parts;
}

function WhoLine({ u }) {
  const parts = whoParts(u);
  if (parts.length === 0) return null;
  return (
    <span className="sans" style={{
      display: "flex", gap: 9, minWidth: 0, overflow: "hidden",
      fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", marginTop: 2,
    }}>
      {parts.map((p, i) => (
        <span key={p} style={i === parts.length - 1
          ? { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
          : { flex: "none", whiteSpace: "nowrap" }}>{p}</span>
      ))}
    </span>
  );
}

// 【札を名前の中に入れない】名前は ellipsis なので、中に置くと長いニックネーム
// (上限20文字)で札が真っ先に削られる。自分を見分ける唯一の手がかりなので、
// 名前とは別の項目にして削られないようにする。
// **紺を使わない**(§1.4「押せる／選ばれている物にだけ」)。本人が差し戻した
// 「青いバー」と同じ轍を踏まない。
function NameLine({ nickname, mine, size }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <span className="sans" style={{
        flex: "0 1 auto", fontSize: size ?? "var(--fs-sm)", fontWeight: 700, color: "var(--c-ink)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>{nickname}</span>
      {mine ? (
        <span className="sans" style={{
          flex: "none", fontSize: "var(--fs-xs)", fontWeight: 700, color: "var(--c-ink-2)",
          background: "var(--c-sunken)", borderRadius: "var(--r-xs)", padding: "1px 6px",
        }}>あなた</span>
      ) : null}
    </span>
  );
}

// 順位の色。**面を塗らず、アイコンの環の線と左端の帯にだけ使う**(追記1 厳守事項)。
// 4位以下には色を与えない。
//
// 【1位だけ光る 2026/09/10 本人裁定「案G」】色相を離したうえで、
// 色以外の手がかりをもう1つ足す。**光の値・時間・曲線は index.css だけが持つ**(§1.11) ──
// ここは class を名乗るだけで、色も秒数も書かない。
// 2位・3位は光らせない(1位を立てるための光なので、全員光ると意味が消える)。
const RANK_COLOR = { 1: "var(--c-rank-1)", 2: "var(--c-rank-2)", 3: "var(--c-rank-3)" };

// 【C9 2026-09-16 実機の指摘】順位の2種類。
// 【便AT 2026-09-24 本人指示】切り替えは溝型(SegmentedTabs)。以前は子タブ(SubTabs)だった。
const RANK_METRICS = [{ key: "days", label: "練習日数" }, { key: "time", label: "練習時間" }];
// 練習時間の表示は 時間・小数1桁(My Data の累計 hoursText と同じ作り)。row.sec は整数秒。
const hoursText = (sec) => (Math.round(sec / 360) / 10).toFixed(1);

function RankRow({ row, big = false, mine = false, onTap }) {
  const rankColor = RANK_COLOR[row.rank] ?? null;
  const tap = onTap ? {
    role: "button", tabIndex: 0, onClick: onTap,
    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } },
    "aria-label": `${row.nickname} の詳細を見る`,
  } : {};
  // 【上位3件は大きさと帯で立てる 2026/09/08 本人裁定「案B」】
  // ・順位の色は**左端の 4px の帯と環の線**が持つ。**面は白のまま**(§6.6 を割らない)
  // ・順位の数字は --c-ink に戻した。金 2.59:1 / 銀 2.47:1 は大きな文字の下限 3:1 に
  //   届いておらず、字を大きくしても薄いままだったため(実測)
  // ・1位だけもう一段大きい。**台の高さには頼らない**(本人指示「丸パクリ過ぎる」)
  const first = big && row.rank === 1;
  const inner = (
    <>
      <div className="sans" style={{
        flex: big ? "0 0 34px" : "0 0 1.6em", textAlign: "center", fontWeight: 700,
        letterSpacing: "-.02em", fontFamily: "var(--font-num)", lineHeight: big ? 1 : undefined,
        fontSize: big ? (first ? "var(--fs-2xl)" : "var(--fs-xl)") : "var(--fs-sm)",
        color: big ? "var(--c-ink)" : "var(--c-ink-3)",
      }}>{row.rank}</div>
      {/* 環は面ではなく線。アイコンの外側に出す。
          【1位だけ層を分ける】光る環は conic-gradient なので box-shadow では描けない。
          色の層を 3px 大きく敷き、その上にアイコンを重ねる ──
          **回すのは色の層だけ**なのでアイコンは回らない。
          2位・3位と4位以下は今までどおり box-shadow の1枚で描く(形は変えない)。 */}
      {first ? (
        <span style={{
          position: "relative", flex: "none", display: "inline-block",
          width: 56 + 6, height: 56 + 6, margin: 3,
        }}>
          <span aria-hidden="true" className="rank-shine-ring"
                style={{ position: "absolute", inset: 0, borderRadius: "50%" }} />
          <span style={{ position: "absolute", inset: 3, borderRadius: "50%", display: "inline-flex" }}>
            <Avatar icon={row.icon ?? AVATAR_ICONS[0]} color={row.iconColor ?? AVATAR_COLOR_MIN} photo={row.photo ?? null} size={56} />
          </span>
        </span>
      ) : (
        <span style={{
          position: "relative", display: "inline-flex", flex: "none", borderRadius: "50%",
          boxShadow: big && rankColor ? `0 0 0 3px ${rankColor}` : "none",
          margin: big && rankColor ? 3 : 0,
        }}>
          <Avatar icon={row.icon ?? AVATAR_ICONS[0]} color={row.iconColor ?? AVATAR_COLOR_MIN}
                  photo={row.photo ?? null} size={big ? 44 : 34} />
        </span>
      )}
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <NameLine nickname={row.nickname} mine={mine}
                  size={first ? "var(--fs-lg)" : big ? "var(--fs-md)" : undefined} />
        <WhoLine u={row} />
      </div>
      <div className="sans" style={{
        flex: "0 0 auto", fontWeight: 700, fontFamily: "var(--font-num)", letterSpacing: "-.02em",
        lineHeight: big ? 1 : undefined,
        fontSize: big ? (first ? "var(--fs-2xl)" : "var(--fs-xl)") : "var(--fs-md)",
        color: "var(--c-ink)",
      }}>
        {row.sec !== undefined ? hoursText(row.sec) : row.days}<span style={{ fontFamily: "var(--font-jp)", fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--c-ink-3)" }}>{row.sec !== undefined ? "時間" : "日"}</span>
      </div>
    </>
  );
  if (!big) {
    return (
      <div {...tap} style={{
        cursor: onTap ? "pointer" : "default",
        display: "flex", alignItems: "center", gap: "var(--sp-3)",
        padding: "11px 2px", minHeight: 47,
      }}>{inner}</div>
    );
  }
  return (
    <div {...tap} style={{
      cursor: onTap ? "pointer" : "default",
      display: "flex", alignItems: "stretch",
      background: "var(--c-surface)", borderRadius: "var(--r-lg)",
      boxShadow: "var(--shadow-card)",
      // 帯を丸に沿わせるために切る。**カードの角を残したまま帯を端まで届かせる唯一の手**
      overflow: "hidden",
    }}>
      {/* 【1位の帯だけ光る】class は動きと gradient を持つ。
          **background の短縮形をここに書かない** ── 短縮形は background-size を
          auto へ戻すので、index.css 側の「3倍に伸ばす」が打ち消される(モックで踏んだ)。 */}
      <span aria-hidden="true"
            className={first ? "rank-shine-bar" : undefined}
            style={first ? { flex: "0 0 4px" } : { flex: "0 0 4px", background: rankColor ?? "transparent" }} />
      <div style={{
        flex: "1 1 0", minWidth: 0, display: "flex", alignItems: "center",
        gap: "var(--sp-3)", padding: "var(--sp-4)",
      }}>{inner}</div>
    </div>
  );
}

export function RankScreen({ users, myUid, onOpenPerson }) {
  const [filter, setFilter] = useState(EMPTY_FILTER);
  // 【C9 2026-09-16】順位の種類(練習日数 / 練習時間)。既定は練習日数。画面を離れたら戻ってよい。
  const [metric, setMetric] = useState("days");
  // 【既定は「すべて」】2026/09/06 本人指示。人数が少ないうちは期間で切ると
  // 一覧が空になりやすく、まず全体が見えたほうがよい。
  const [period, setPeriod] = useState("all");
  const shown = useMemo(() => filterUsers(users, filter), [users, filter]);
  const ranked = useMemo(() => rankByPractice(shown, period, undefined, metric), [shown, period, metric]);

  return (
    <div style={pageStyle}>
      {/* 【便AT 2026-09-24 本人指示】期間は条件行の4つ目(一番右)。以前はチップの行だった。 */}
      <FilterRow value={filter} onChange={setFilter} period={period} onPeriod={setPeriod} />
      {/* 【便AT】種類の切替は溝型(SegmentedTabs)。
          【C8】見出しの行(「練習日数 今週」)は消した ── 何の順位かは切り替えが言い、
          期間は条件行の4つ目が言っている。 */}
      <SegmentedTabs ariaLabel="順位の種類" items={RANK_METRICS} value={metric} onChange={setMetric} />

      {ranked.length === 0 ? (
        <Empty onClear={isFiltered(filter) ? () => setFilter(EMPTY_FILTER) : null}>
          {/* 【C5・C6】期間の語は助詞込み(PERIOD_PHRASE)。「すべて」は「すべての期間で」。
              「〜で、今週で」と「で」が続くのは意図どおり(条件と期間は別の句)。 */}
          {isFiltered(filter)
            ? `${filterTerms(filter, ["saxType", "genre", "position"]).join(" × ")}で、${PERIOD_PHRASE[period]}練習した人はまだいません`
            : `${PERIOD_PHRASE[period]}練習した人がまだいません`}
        </Empty>
      ) : (
        <>
          {/* 上位3件はカードが独立する */}
          <div style={{ display: "grid", gap: "var(--sp-3)" }}>
            {ranked.slice(0, 3).map((r) => (
              <RankRow key={r.uid} row={r} big mine={r.uid === myUid}
                onTap={onOpenPerson ? () => onOpenPerson(r) : undefined} />
            ))}
          </div>
          {/* 4位以下は1つの群に畳む。**群の中の行区切りの罫は引いてよい**(D-30 本人裁定) */}
          {ranked.length > 3 ? (
            <div className="card card-list">
              {ranked.slice(3).map((r, i, arr) => (
                <div key={r.uid} style={{ borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--c-line)" }}>
                  <RankRow row={r} mine={r.uid === myUid}
                    onTap={onOpenPerson ? () => onOpenPerson(r) : undefined} />
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}

      {/* 【C7 2026-09-16 実機の指摘】ここにあった「あなたはいまの絞り込みに… / あなたは…の記録が
          まだありません」の行(rowcard)は消した。読み手が無くなった findMyRank も aggregate.js から消した。 */}
      <CapNotice count={users.length} />
    </div>
  );
}

// ------------------------------------------------------------------
// シェア(楽器の組の内訳)
// ------------------------------------------------------------------
// 【円グラフ】設計書 §5③。系列は §1.7 の紺の3段まで ── 段は3つしか無く、
// 4つ目に色を与えると必ずグレーか重複になる(§1.7「色を足すのではなく表示を絞る」)。
// 残りは系列ではないので、色ではなく**沈めた面**で「その他」を表す。
const PIE_COLORS = ["var(--c-accent)", "var(--c-accent-mid)", "var(--c-accent-line)"];
const PIE_REST = "var(--c-sunken)";
const PIE_R = 54, PIE_C = 60;

function arcPath(fromRatio, toRatio) {
  const pt = (r) => {
    const a = r * 2 * Math.PI - Math.PI / 2;
    return [PIE_C + PIE_R * Math.cos(a), PIE_C + PIE_R * Math.sin(a)];
  };
  // 1周まるごとは円弧では描けない(始点と終点が同じ点になる)ので円で描く
  if (toRatio - fromRatio >= 0.9999) return null;
  const [sx, sy] = pt(fromRatio), [ex, ey] = pt(toRatio);
  const large = toRatio - fromRatio > 0.5 ? 1 : 0;
  return `M${PIE_C},${PIE_C} L${sx.toFixed(1)},${sy.toFixed(1)} A${PIE_R},${PIE_R} 0 ${large} 1 ${ex.toFixed(1)},${ey.toFixed(1)} Z`;
}

// 【掘り下げられる区画だけがタップできる】判定は aggregate.js の isDrillable ひとつに寄せる。
// 「その他」はカタログ外で割れないので、円でも凡例でもタップ対象にしない。
const pickable = (onPick, item) => Boolean(onPick && item && isDrillable(item.key));

function PieChart({ items, label, onPick }) {
  const top = items.slice(0, 3);
  const restRatio = Math.max(0, 1 - top.reduce((a, x) => a + x.ratio, 0));
  const slices = [];
  let acc = 0;
  top.forEach((x, i) => { slices.push({ from: acc, to: acc + x.ratio, fill: PIE_COLORS[i], item: x }); acc += x.ratio; });
  if (restRatio > 0.0001) slices.push({ from: acc, to: 1, fill: PIE_REST, item: null });
  const whole = slices.length === 1;
  const tap = (item) => (pickable(onPick, item) ? {
    role: "button", tabIndex: 0, style: { cursor: "pointer" },
    onClick: () => onPick(item.key),
    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(item.key); } },
    "aria-label": `${gearLabelOf(item.key)} の内訳を見る`,
  } : {});
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" style={{ flex: "none" }} role="img" aria-label={label}>
      {whole
        ? <circle cx={PIE_C} cy={PIE_C} r={PIE_R} fill={slices[0].fill} {...tap(slices[0].item)} />
        : slices.map((sl, i) => {
            const d = arcPath(sl.from, sl.to);
            return d ? <path key={i} d={d} fill={sl.fill} {...tap(sl.item)} /> : null;
          })}
    </svg>
  );
}

// 【凡例も同じタップ先を持つ】円の区画は割合が小さいと細くなり、44px を保証できない。
// 凡例の行を当たり判定 44px にして、**箱ではなく中身を小さいまま**にする(§5 / Chip と同じ手)。
// 行どうしの gap は 0 ── 44px と文字の高さの差がそのまま間隔になる。
// showRest: 「ほか〇種類」を開いた状態。開くと4位以下も行として並び、
// 押せるものは押せる ── 円は3区画までしか持てないので、**4位以下への入り口は
// 凡例が担う。**色は増やさない(§1.7「色を足すのではなく表示を絞る」)。
function PieLegend({ items, onPick, showRest = false, onToggleRest }) {
  const top = items.slice(0, 3);
  const rest = items.slice(3);
  const restRatio = rest.reduce((a, x) => a + x.ratio, 0);
  const rowStyle = { display: "flex", alignItems: "center", gap: 7, minWidth: 0, minHeight: "var(--tap-min)" };
  const inner = (color, text, pct, muted) => (
    <>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flex: "none" }} />
      <span className="sans" style={{
        fontSize: "var(--fs-xs)", color: muted ? "var(--c-ink-3)" : "var(--c-ink)",
        minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{text}</span>
      <span className="sans" style={{
        ...noteStyle, flex: "none", marginLeft: "auto", fontFamily: "var(--font-num)",
      }}>{Math.round(pct * 100)}%</span>
    </>
  );
  const row = (color, text, pct, muted, item) => (
    pickable(onPick, item) ? (
      <button key={text} type="button" className="sans" onClick={() => onPick(item.key)}
        aria-label={`${text} の内訳を見る`}
        style={{ ...rowStyle, width: "100%", padding: 0, border: "none", background: "none", cursor: "pointer" }}>
        {inner(color, text, pct, muted)}
      </button>
    ) : (
      <div key={text} style={rowStyle}>{inner(color, text, pct, muted)}</div>
    )
  );
  // 「ほか〇種類」の行。開閉できるときはボタンにする。
  const restRow = () => {
    const label = showRest ? `ほか${rest.length}種類を閉じる` : `ほか${rest.length}種類`;
    if (!onToggleRest) return row(PIE_REST, label, restRatio, true, null);
    return (
      <button key="rest" type="button" className="sans" onClick={onToggleRest}
        aria-expanded={showRest} aria-label={showRest ? "ほかのメーカーを閉じる" : `ほか${rest.length}種類のメーカーを見る`}
        style={{ ...rowStyle, width: "100%", padding: 0, border: "none", background: "none", cursor: "pointer" }}>
        {inner(PIE_REST, label, restRatio, true)}
      </button>
    );
  };
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0 }}>
      {top.map((x, i) => row(PIE_COLORS[i], gearLabelOf(x.key), x.ratio, false, x))}
      {rest.length > 0 ? restRow() : null}
      {/* 開いた4位以下。円には区画が無いので、色は「その他」の沈めた面のまま。
          ここが唯一の入り口なので、押せるものは押せるようにする。 */}
      {showRest ? rest.map((x) => row(PIE_REST, gearLabelOf(x.key), x.ratio, true, x)) : null}
    </div>
  );
}

export function ShareScreen({ users, saxTypes }) {
  // 【楽器種別は条件行の楽器ピルで選ぶ】2026/09/06 本人指示で専用のボタン行は消した。
  // 内訳は種別ごとに1組を数えるので、この画面の楽器ピルには「すべて」が無い(争点B)。
  // 4種別ぶんを合算すると、アルトのマウスピースとテナーのマウスピースが同じ票に
  // 入って内訳として嘘になる。既定は自分が登録している最初の種別。
  const [filter, setFilter] = useState(() => ({ ...EMPTY_FILTER, saxType: (saxTypes ?? [])[0] ?? "alto" }));
  const [slot, setSlot] = useState("instrument");
  const [depth, setDepth] = useState(2);
  // 【内訳は2段】1段目はメーカーだけで数え、メーカーを選ぶと2段目(型番)に降りる。
  // drill が null なら1段目。項目や条件が変わったら畳む ── 別の項目のメーカーの
  // 内訳を出したままにすると、何の内訳なのか言えなくなる。
  const [drill, setDrill] = useState(null);
  // 【4位以下のメーカーへの入り口】円は3区画までしか持てない(§1.7 の系列は紺の3段。
  // 4つ目に色を与えると必ずグレーか重複になる)。そこで色は増やさず、
  // 凡例の「ほか〇種類」を押したら残りを行で並べる。全部のメーカーに手が届く。
  const [showRest, setShowRest] = useState(false);
  const saxType = filter.saxType;

  const shown = useMemo(() => filterUsers(users, filter), [users, filter]);
  const gear = useMemo(() => tallyGearByBrand(shown, saxType), [shown, saxType]);
  const models = useMemo(
    () => (drill ? tallyGearModels(shown, saxType, slot, drill) : null),
    [shown, saxType, slot, drill]);
  const combos = useMemo(() => tallyCombos(shown, saxType, depth), [shown, saxType, depth]);
  // 【出す5件だけ、型番で書けるかを確かめてから決める】
  // 型番だけの綴りは短いが、別のメーカーが同じ型番を使っていると**見た目が同じで
  // 人数だけ違う行**ができる。5件の中で綴りがぶつかったら、その場合だけ
  // メーカー名を含む元の綴りへ戻す(切れるが、嘘にはならない)。
  const shownCombos = useMemo(() => {
    const top = combos.combos.slice(0, 5);
    const short = top.map((c) => (c.labels ?? c.parts).map(gearLabelOf));
    const collides = new Set(short.map((l) => l.join(" / "))).size < short.length;
    return top.map((c, i) => ({
      combo: c,
      labels: collides ? c.parts.map(gearLabelOf) : short[i],
    }));
  }, [combos]);
  const items = models ? models.items : (gear.slots[slot] ?? []);
  // 2段目の母数は「そのメーカーを選んでいる人」。円と n が同じ母数を指す。
  const shownTotal = models ? models.total : gear.total;

  return (
    <div style={pageStyle}>
      <FilterRow value={filter} onChange={(v) => { setFilter(v); setDrill(null); setShowRest(false); }} saxAny={false} />

      {gear.total === 0 ? (
        /* 【楽器種別は絞り込みに数えない】この画面の楽器ピルには「すべて」が無く、常に1つ
           選ばれている(データ画面と同じ規則)。数えると必ず「絞り込み中」になる。
           【2026-09-15 統括裁定で「戻す先」を直した】「条件を外す」は**いま見ている楽器を保つ**。
           以前は画面の既定(saxTypes[0])へ戻していたが、それは押していない条件まで動かす
           ── 0件の文が「{ジャンル} × {属性}で、テナー を吹く人はまだいません」と言っているのに、
           押すとアルトの画面になる。ANY は入れない(このピルの選択肢に無く、値の無いピルができる)。 */
        <Empty onClear={isFilteredBy(filter, ["genre", "position"])
                          ? () => { setFilter({ ...EMPTY_FILTER, saxType: filter.saxType }); setDrill(null); setShowRest(false); }
                          : null}>
          {isFilteredBy(filter, ["genre", "position"])
            ? `${filterTerms(filter, ["genre", "position"]).join(" × ")}で、${SAX_LABELS[saxType]} を吹く人はまだいません`
            : `${SAX_LABELS[saxType]} を吹く人がまだいません`}
        </Empty>
      ) : (
        <>
          <div className="card">
            {/* 【見出しを置かない】本人指示。何の内訳かは下のタブがそのまま言っている
                (§6.0「説明を消して形に語らせる」) */}
            <UnderlineTabs
              label="見る項目" value={slot} onChange={(k) => { setSlot(k); setDrill(null); setShowRest(false); }}
              items={GEAR_SLOTS.map((k) => ({ key: k, label: SLOT_LABEL[k] }))}
            />
            {/* 【2段目にいることを名乗り、1段目に戻る一手を必ず置く】
                表記は人物紹介の戻ると同じ `< 行き先`。 */}
            {drill ? (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", paddingTop: "var(--sp-2)" }}>
                <button type="button" className="sans" onClick={() => { setDrill(null); setShowRest(false); }}
                        aria-label="メーカーの内訳に戻る"
                        style={{ ...BACK_BUTTON_STYLE, flex: "none" }}>
                  {"< メーカー"}
                </button>
                <span className="sans" style={{
                  minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--c-ink)",
                }}>{gearLabelOf(drill)}</span>
              </div>
            ) : null}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", padding: "var(--sp-2) 0 var(--sp-1)" }}>
              <PieChart items={items} onPick={drill ? undefined : setDrill}
                label={drill
                  ? `${gearLabelOf(drill)} の${SLOT_LABEL[slot]}を使う${shownTotal}人の、${SLOT_MODEL_WORD[slot]}の内訳`
                  : `${SAX_LABELS[saxType]} を吹く${shownTotal}人の、${SLOT_LABEL[slot]}のメーカーの内訳`} />
              <PieLegend items={items} onPick={drill ? undefined : setDrill}
                showRest={showRest} onToggleRest={drill ? undefined : () => setShowRest((v) => !v)} />
            </div>
            <div className="sans" style={bodyNoteStyle}>
              n = <span style={{ fontFamily: "var(--font-num)", fontWeight: 700 }}>{shownTotal}</span>人
            </div>
          </div>

          <div className="card">
            <div className="sans jp-label" style={{ ...eyebrowStyle, marginBottom: 10 }}>人気の組み合わせ</div>
            {/* 【候補が3つしかないので、開かずに比較できる形で全部出す】2026/09/06 本人指示。
                「2項目 / 3項目 / 4項目」という数の表示をやめ、中身をそのまま行にした。
                形は計測タブの目安一覧と同じ A型の行 ── 選択は枠と文字の色だけで返し、
                地を塗らない(§6.7)。当たり判定 44 / 見えるボックス 36。
                行の縦 gap は 0(44−36 の 8px が見た目の間隔になる)。 */}
            <div role="radiogroup" aria-label="組み合わせ" style={{ display: "grid", gap: 0 }}>
              {Object.keys(COMBO_SLOTS).map((d) => {
                const on = Number(d) === depth;
                const text = COMBO_SLOTS[d].map((x) => SLOT_LABEL[x]).join(" × ");
                return (
                  <button
                    key={d} type="button" role="radio" aria-checked={on}
                    onClick={() => setDepth(Number(d))} className="sans no-select"
                    style={{
                      minHeight: "var(--tap-min)", padding: 0, background: "none", border: "none",
                      display: "flex", alignItems: "center", cursor: "pointer",
                    }}
                  >
                    <span style={{
                      display: "flex", alignItems: "center", width: "100%", minWidth: 0,
                      minHeight: 36, padding: "0 12px", boxSizing: "border-box",
                      borderRadius: "var(--r-sm)",
                      border: `1px solid ${on ? "var(--c-accent)" : "var(--c-line-strong)"}`,
                      color: on ? "var(--c-accent)" : "var(--c-ink-2)",
                      fontSize: "var(--fs-sm)", fontWeight: 600, textAlign: "left",
                    }}>{text}</span>
                  </button>
                );
              })}
            </div>
            {combos.total === 0 ? (
              <Empty>4つすべてを登録している人がまだいません</Empty>
            ) : (
              <div>
                {shownCombos.map(({ combo: c, labels }, i) => {
                  const pct = Math.round(c.ratio * 100);
                  return (
                    <div key={c.key} style={{ padding: "7px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--sp-2)" }}>
                        {/* 【区切りは記号ではなく余白】中黒も「/」も使わない(§6.0 囲いの序列
                            「1. 余白で分ける」。WhoLine と同じ作法)。あふれたときに
                            省略記号になるのは**最後の1つだけ**で、手前の項目は削られない。
                            改行はしない ── 1件1行という形が崩れると5件の比較ができなくなる。 */}
                        <span className="sans" style={{
                          display: "flex", gap: 9, minWidth: 0, overflow: "hidden",
                          fontSize: "var(--fs-sm)", color: "var(--c-ink)",
                        }}>
                          {labels.map((t, j) => (
                            <span key={j} style={j === labels.length - 1
                              ? { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
                              : { flex: "none", whiteSpace: "nowrap" }}>{t}</span>
                          ))}
                        </span>
                        <span className="sans" style={{ ...noteStyle, flex: "none", fontFamily: "var(--font-num)" }}>{c.count}人</span>
                      </div>
                      <div style={{ height: 6, borderRadius: "var(--r-pill)", background: "var(--c-sunken)", marginTop: 5, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: PIE_COLORS[Math.min(i, 2)] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <CapNotice count={users.length} />
    </div>
  );
}

// ------------------------------------------------------------------
// データ(音の比較)
//
// 上のカードが「みんなの平均」、下が「その条件に合う個人の目安」。
// **上下は同じ条件で絞られている** ── 本人の指摘「上と下で二つある」を、
// 条件行を1つにして解いた。
// ------------------------------------------------------------------
const METRICS = [
  { key: "spectralCentroidHz", label: "重心", unit: "Hz", digits: 0 },
  { key: "hnrDb", label: "HNR", unit: "dB", digits: 1 },
  { key: "pitchCentsSigned", label: "音程", unit: "¢", digits: 1 },
];

// 【便AO 2026-09-24 本人の実機報告】「重心とかHNRとか音程の横軸が D2 E2 F#2 の3つしかない。
// その楽器の該当の音は横軸に出るようにして」。
// ここには手作りの折れ線(LineChart)があり、原因は2つあった:
//   1. 音名が誤り … 音の番号(semitoneIndex)を「0 を C1 として12音で回す」だけで名付けていた。
//      semitoneIndex は**その楽器の最低音から数えた運指の番号**なので、A.Sax の 14/16/18
//      (実音 E♭4 / F4 / G4)が D2 / E2 / F#2 と出ていた。
//   2. 横軸がデータのある音だけ … 3音しか公開されていなければ横軸も3つ。
// アプリ本体の NoteAxisLineChart に差し替えた。あちらは buildFingeringTable で**その楽器の
// 音域の全音**を横軸に並べ、実音の音名(concertFreqLabel)を付ける。手作りの部品は残さない
// (同じ絵を2つの部品が描くと、片方だけ直る)。
//
// 目盛の書式は METRICS の digits。音程だけ符号付き(App.jsx の formatSignedCents =
// 小数1桁。METRICS の音程の digits 1 と同じ)。
const metricFmt = (m) => (m.key === "pitchCentsSigned" ? formatSignedCents : (v) => v.toFixed(m.digits));

// 系列の見た目は**凡例(Legend)と同じ値から引く**(color / dash を2箇所に書かない)。
// 太さは §1.8 の系列の 2px(いままでの LineChart の既定と同じ)。
const COMMUNITY_SERIES_WIDTH = 2;

// 【便AR 2026-09-24 本人採用 案B「計測タブにそろえる」】
// 本人の実機報告「どれがみんなの平均でどれが自分か分かりにくい」。以前は平均が紺(--c-accent)の
// 塗りの点、自分が濃い灰(--c-ink-2)の塗りの点で、点だけになると色の差しか残らなかった。
// 計測タブの「実測と目安」と同じ決まりにそろえる:
//   ・自分        … 実測と同じ。紺の実線・塗りの点
//   ・比べる相手  … 目安と同じ。--c-ink-3 の破線 4 3・白抜きの点(平均も、人物紹介のその人も)
// 相手は目安に設定できるもの(人物紹介の「目安に設定」)なので、目安の見た目が役と合う。
// 描く順は相手が先(下)・自分が後(上)── 計測タブも目安を先に描いて実測を上に乗せている。
const COMPARE_SERIES = { color: "var(--c-ink-3)", dash: "4 3", hollow: true };
const MINE_SERIES = { color: "var(--c-accent)", dash: null, hollow: false };

// chart = { series: [{ label, color, dash?, values, byMetric }] } を NoteAxisLineChart の形にして描く。
//   ・byIdx … いまの指標の「音の番号 → 値」(数値のキー)
//   ・byMetric … 3指標ぶん。R12(指標を切り替えても柱の幅を動かさない)のために渡す
//   ・plain … 見出し(label / unit)を出さない。単位は画面の側が出している
//   ・音程は metricKey で自動的に 0 中心
function CommunityNoteChart({ chart, metric, saxType, tuningHz }) {
  return (
    <NoteAxisLineChart
      plain
      metricKey={metric.key}
      fmt={metricFmt(metric)}
      saxType={saxType}
      tuningHz={tuningHz}
      series={chart.series.map((s, i) => ({
        id: `s${i}`, label: s.label,
        style: { color: s.color, width: COMMUNITY_SERIES_WIDTH, dash: s.dash ?? null, hollow: Boolean(s.hollow) },
        byIdx: s.values, byMetric: s.byMetric,
      }))}
      selectedIdeal={null} idealKey={null}
    />
  );
}

// 【便AR】凡例の見本は、グラフと同じ「線 + 点」を小さく描く(破線・白抜きも見本に出す)。
// 以前は 14×3 の実線の帯で、破線かどうかも点の塗りも凡例からは分からなかった。
const LEGEND_SWATCH_W = 22;
function LegendSwatch({ s }) {
  return (
    <svg width={LEGEND_SWATCH_W} height={10} viewBox={`0 0 ${LEGEND_SWATCH_W} 10`} aria-hidden="true"
         data-legend-swatch={s.hollow ? "hollow" : "fill"} style={{ display: "block", flex: "0 0 auto", overflow: "visible" }}>
      <line x1={1} y1={5} x2={LEGEND_SWATCH_W - 1} y2={5} strokeWidth={COMMUNITY_SERIES_WIDTH}
            strokeDasharray={s.dash || undefined} style={{ stroke: s.color }} />
      {s.hollow
        ? <circle cx={LEGEND_SWATCH_W / 2} cy={5} r={3} strokeWidth={1} style={{ stroke: s.color, fill: "var(--c-surface)" }} />
        : <circle cx={LEGEND_SWATCH_W / 2} cy={5} r={3} style={{ fill: s.color }} />}
    </svg>
  );
}

function Legend({ series }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
      {series.map((s) => (
        <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
          <LegendSwatch s={s} />
          <span className="sans" style={noteStyle}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// 【便AO 2026-09-24 tuningHz】横軸の実音の音名を引くのに要る(自分の基準ピッチ。
// CommunityTab が buildMyIdeals に渡しているものと同じ値)。
export function DataScreen({ users, ideals, myIdeals, myUid, saxTypes, onOpenPerson, tuningHz }) {
  // 【楽器種別は条件行の楽器ピルで選ぶ】2026/09/06 本人指示で専用のボタン行は消した。
  // アルトとテナーの重心を混ぜた平均は誰の目安にもならないので、この画面の
  // 楽器ピルには「すべて」が無い(争点B)。既定は自分が登録している最初の種別。
  const [filter, setFilter] = useState(() => ({ ...EMPTY_FILTER, saxType: (saxTypes ?? [])[0] ?? "alto" }));
  const [metric, setMetric] = useState("spectralCentroidHz");
  const saxType = filter.saxType;

  const shown = useMemo(() => filterUsers(users, filter), [users, filter]);
  // 【条件で絞った人の目安だけを使う】上のカードと下の一覧が同じ母集団になる。
  // 目安そのものの種別でも絞る ── 掛け持ちの人はアルトとテナーの両方を持つので、
  // 所有者で絞るだけでは別の楽器の目安が混ざる。
  const pairs = useMemo(
    () => joinOwners(ideals, shown).filter((p) => p.ideal.saxType === saxType),
    [ideals, shown, saxType]);

  const others = useMemo(() => pairs.filter((p) => p.ideal.ownerUid !== myUid).map((p) => p.ideal), [pairs, myUid]);

  // 【綴りを揃えてから比べる】自分の目安は App.jsx の形(centroidHz / harmonicsProfile)、
  // 読んできた他人の目安は公開の形(spectralCentroidHz / harmonics)。
  // 変換せずに渡すと共通音が1つも見つからず、**常に「重なっている音が足りません」**になる。
  // 実際にこれを踏んだ。sanitizeNotes が対応表を持っているので、それを通す。
  const mineShared = useMemo(
    () => ({ notes: sanitizeNotes(myIdeals?.[saxType]?.notes) }), [myIdeals, saxType]);
  const avg = useMemo(() => cohortAverage(mineShared, others), [mineShared, others]);

  const m = METRICS.find((x) => x.key === metric) ?? METRICS[0];
  const chart = useMemo(() => {
    if (avg.error) return null;
    // 自分の線も変換後の値から読む。ここだけローカルの綴りを直に読むと、
    // 綴りを足したときに片方だけ直し忘れる。読む場所を1つにする。
    // 【便AO】3指標ぶんを作る(byMetric。R12 の柱の幅を測るのに要る)。描くのは m.key の分。
    // 【便AQ】線ごとに**自分の持っている音で**拾う(noteValues)。平均のある音で自分を絞らない。
    const avgBy = Object.fromEntries(METRICS.map((x) => [x.key, noteValues(avg.notes, x.key, (c) => c?.value)]));
    const mineBy = Object.fromEntries(METRICS.map((x) => [x.key, noteValues(mineShared.notes, x.key)]));
    if (Object.keys(avgBy[m.key]).length === 0 && Object.keys(mineBy[m.key]).length === 0) return null;
    return {
      series: [
        { label: "みんなの平均", values: avgBy[m.key], byMetric: avgBy, ...COMPARE_SERIES },
        { label: "自分", values: mineBy[m.key], byMetric: mineBy, ...MINE_SERIES },
      ],
    };
  }, [avg, mineShared, m.key]);

  return (
    <div style={pageStyle}>
      <FilterRow value={filter} onChange={setFilter} saxAny={false} />

      <div className="card">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--sp-2)" }}>
          <div className="sans jp-label" style={eyebrowStyle}>みんなの平均</div>
          {avg.error ? null : (
            <div className="sans" style={noteStyle}>
              目安を公開している<span style={{ fontFamily: "var(--font-num)", fontWeight: 700 }}>{avg.count}</span>人
            </div>
          )}
        </div>
        {/* 指標の切替は現行アプリと同じ下線タブ(本人指示) */}
        <div style={{ margin: "10px 0 2px" }}>
          <UnderlineTabs label="見る指標" value={metric} onChange={setMetric}
            items={METRICS.map((x) => ({ key: x.key, label: x.label }))} />
        </div>
        {avg.error ? (
          <Empty>{avg.error}</Empty>
        ) : (
          <div style={{ display: "grid", gap: "var(--sp-2)" }}>
            {chart ? <CommunityNoteChart chart={chart} metric={m} saxType={saxType} tuningHz={tuningHz} /> : <Empty>この指標のデータがありません</Empty>}
            {chart ? <Legend series={chart.series} /> : null}
            {/* 【この注意書きを消さないこと】平行移動を知らずに見ると、
                「自分のほうが低い/高い」を絶対値の差だと読んでしまう。 */}
            <div className="sans" style={bodyNoteStyle}>
              計測環境により値全体が一律にずれるため、揃えた状態で線の形で比較しています。
            </div>
          </div>
        )}
      </div>

      {/* 【見出しを置かない】2026/09/06 本人指示。下の一覧が自分で名乗るので要らない
          (§6.0「説明を消して形に語らせる」) */}
      {/* 【楽器種別は絞り込みに数えない】この画面の楽器ピルには「すべて」が無く、
          常に1つ選ばれている。数えると必ず「絞り込み中」になり、
          「まだ誰もいない」のか「条件で外れた」のかを言い分けられなくなる。
          【2026-09-15 統括裁定】「条件を外す」は**いま見ている楽器を保つ**
          (シェア画面と同じ。理由はあちらの注記)。 */}
      {pairs.length === 0 ? (
        <Empty onClear={isFilteredBy(filter, ["genre", "position"])
                          ? () => setFilter({ ...EMPTY_FILTER, saxType: filter.saxType })
                          : null}>
          {isFilteredBy(filter, ["genre", "position"])
            ? `${filterTerms(filter, ["genre", "position"]).join(" × ")}で、公開されているデータはまだありません`
            : "公開されているデータがまだありません"}
        </Empty>
      ) : (
        <div className="card card-list">
          {pairs.map(({ ideal, owner }, i, arr) => (
            <div key={ideal.id}
                 role={onOpenPerson ? "button" : undefined}
                 tabIndex={onOpenPerson ? 0 : undefined}
                 onClick={onOpenPerson ? () => onOpenPerson(owner) : undefined}
                 onKeyDown={onOpenPerson ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenPerson(owner); } } : undefined}
                 aria-label={onOpenPerson ? `${owner.nickname} の詳細を見る` : undefined}
                 style={{
                   display: "flex", alignItems: "center", gap: "var(--sp-3)",
                   padding: "11px 2px", minHeight: 47,
                   // 【群の中の行区切りの罫は引いてよい】D-30 本人裁定。最後の行だけ消す
                   borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--c-line)",
                   cursor: onOpenPerson ? "pointer" : "default",
                 }}>
              <Avatar icon={owner.icon ?? AVATAR_ICONS[0]} color={owner.iconColor ?? AVATAR_COLOR_MIN} photo={owner.photo ?? null} size={34} />
              <div style={{ flex: "1 1 0", minWidth: 0 }}>
                {/* 【目安に名前は無い】種別ごとに1つなので、人の名前で示すのが自然。
                    公開される自由入力をニックネームだけに保つためでもある。 */}
                <NameLine nickname={owner.nickname} mine={ideal.ownerUid === myUid} />
                <WhoLine u={owner} />
              </div>
              {/* 【右端は録音回数】いくつの録音から作られた目安かは、
                  その線をどれだけ信じてよいかの目安になる。
                  折れ線を 56px で置いても形は読み取れない(本人指摘)。 */}
              <div className="sans" style={{ flex: "none", textAlign: "right" }}>
                <span style={{ fontFamily: "var(--font-num)", fontSize: "var(--fs-md)", fontWeight: 700, color: "var(--c-ink)" }}>
                  {ideal.sourceSessionCount ?? "—"}
                </span>
                <span style={{ fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--c-ink-3)" }}>回</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <CapNotice count={users.length} />
    </div>
  );
}

// ------------------------------------------------------------------
// 人をタップしたときの画面。
//
// 【1枚に全部出す】以前の案は「この人の目安を見る」を押させていたが、
// 順位を眺めていて気になった人が居たとき、往復せずにその場で判断できるほうがよい
// (2026-08-28 本人裁定)。楽器の組も指標も同じ画面に置く。
//
// 【練習日数は累計を出す】順位は期間を切り替えて見るものだが、
// 人物の紹介として出すなら累計のほうが素性を表す。
// ------------------------------------------------------------------
// 項目行の作法。**罫はこの1本だけ**(群の中の行区切り。D-30 本人裁定)。
const infoRowStyle = {
  display: "flex", gap: "var(--sp-3)", alignItems: "baseline",
  padding: "var(--sp-2) 0", borderBottom: "1px solid var(--c-line)",
};
const infoLabelStyle = { ...labelStyle, flex: "0 0 7em" };
const infoValueStyle = { fontSize: "var(--fs-sm)", color: "var(--c-ink)", flex: "1 1 0", minWidth: 0 };

// strength はリードのときだけ渡す。番手を持たない古いドキュメントもあるので、
// 無ければ何も足さない(ルールが null を許している)。
// 【便AV 2026-09-24 本人指示「リード行の下線とその下の横線は削除」】last の行(組の最後 = リード)は下線を持たない。
function GearLine({ label, brand, model, strength = null, last = false }) {
  const has = brand !== null && brand !== undefined;
  const v = !has ? "—"
    : brand === OTHER_BRAND ? "その他"
    : model ? `${brand} ${model}` : brand;
  return (
    <div style={last ? { ...infoRowStyle, borderBottom: "none" } : infoRowStyle}>
      <div className="sans jp-label" style={infoLabelStyle}>{label}</div>
      <div className="sans" style={infoValueStyle}>
        {v}
        {/* 番手は数値なので --font-num(§4.3) */}
        {has && strength ? <span style={{ fontFamily: "var(--font-num)" }}> {strength}</span> : null}
      </div>
    </div>
  );
}

// プロフィールの1行。値が無ければ「—」。
// 【中黒を使わない】複数値の区切りは記号ではなく余白(WhoLine と同じ。§6.0)。
function InfoLine({ label, value }) {
  const list = Array.isArray(value) ? value.filter(Boolean) : null;
  const empty = list ? list.length === 0 : (value === null || value === undefined || value === "");
  return (
    <div style={infoRowStyle}>
      <div className="sans jp-label" style={infoLabelStyle}>{label}</div>
      <div className="sans" style={{ ...infoValueStyle, display: "flex", flexWrap: "wrap", gap: 9 }}>
        {empty ? "—" : list ? list.map((v) => <span key={v}>{v}</span>) : value}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// 人物画面の楽器の行。**表(音のデータ)と裏(プロフィール)が同じ1つの部品を呼ぶ。**
// 以前は同じ radiogroup が2箇所に直書きされていて、片方だけ直る事故の入口だった。
//
// 【常に4つ 2026-09-19 本人指示・案ア】本人「ソプラノからバリトンまで同じ行に横並びで配置」。
// データのある種別だけを出していたので、1種別の人では `grow` のチップが横いっぱいに
// 伸びて「ボタン1つ」に見えていた。SAX_TYPES の4つを `flex: 1 1 0` で等分に並べれば
// 幅は常に 1/4 で、行が何を選ぶものなのかも読める。
//
// 【3つの状態は枠を段階的に減らして分ける】新しい色は1つも作らない:
//   1. いま見ているデータの楽器 … 枠 --c-accent / 字 --c-accent(Chip の選択中そのまま)
//   2. その人が吹く楽器         … 枠 --c-line-strong / 字 --c-ink-2(Chip の非選択そのまま)
//   3. 吹かない楽器             … 枠なし(transparent) / 字 --c-line-strong。押せない
// 3 に枠が無いのは index.css §6.7「枠線は状態を持つものにだけ」に沿うため ──
// 吹かない種別は選択に切り替わりようがないので、状態を持たない。
//
// 【吹くかどうかは person.saxTypes で決める】目安や楽器の組があるかは問わない。
// 「吹くが何も公開していない」は 2 で、「吹かない」は 3 で、別のことだと読める。
// ------------------------------------------------------------------
// 【便AU 2026-09-24 本人指示】マイページも同じこの部品を使う(export)。
// 「プロフィールのページも。前のやつの該当の楽器をタップしたらその楽器のデータになるように」──
// 押した楽器の楽器の組に切り替わる(呼び手の onPick が表示する種別を替える)。
export function SaxTypeRow({ saxType, playing, onPick }) {
  const plays = new Set(playing ?? []);
  return (
    <div role="radiogroup" aria-label="楽器種別" style={{ display: "flex", gap: "var(--sp-1)" }}>
      {SAX_TYPES.map((t) => (
        <Chip key={t} on={t === saxType} off={!plays.has(t)} grow
              onClick={() => onPick(t)}>{SAX_LABELS[t]}</Chip>
      ))}
    </div>
  );
}

// 【便AO 2026-09-24 本人指示】「他の奏者のページはこのアプリの他のタブ切り替えに倣って
// データとプロフィールがタブ切り替えになるように変更して」。
// 以前は「表(音のデータ)/裏(プロフィール)」で、名前の行を押すと裏返り、左上の
// `< 音のデータ` で戻った。コミュニティ上部・データタブ・リードタブと同じ SubTabs にした。
// 【便AU 2026-09-24 本人指示】「人物のページのタブはデータとプロフィールを新しいタブ形式にして欲しかった」
// ── 溝型(SegmentedTabs)に替えた。中身の出し分けは side("data" / "profile")のまま。
const PERSON_TABS = [
  { key: "data", label: "データ" },
  { key: "profile", label: "プロフィール" },
];

export function PersonSheet({ person, ideals, myIdeals, onClose, onAdopt, myUid = null, onReported, tuningHz }) {
  const [adopted, setAdopted] = useState(null);
  // 【計画5 2026-09-10】通報。開いているか / 選んだ理由 / 送った結果。
  // シートの上にシートを重ねない ── 人物紹介を閉じてから通報のシートを出す。
  const [reporting, setReporting] = useState(false);
  const [reportState, setReportState] = useState(null);
  // 【1枚のシートの2つのタブ】新しい画面の作法を増やさない(2026/09/06 本人指示)。
  // "data" = データ / "profile" = プロフィール。行き来は名前の行の下の SubTabs だけが担う(便AO)。
  const [side, setSide] = useState("data");
  // 【便AH 2026-09-23 決定5 → 便AO 2026-09-24】写真の拡大。**両方のタブで**出る。
  // 以前は裏(プロフィール面)だけだった ── 表の名前の行が行全体でプロフィールへの入口で、
  // そこで写真が開くと人を開けなくなるから。便AO でその入口(名前の行を押して裏返る)が
  // 無くなったので、理由も消えた。場所の名前を渡して純関数に決めさせるのは変わらない。
  const [photoZoom, setPhotoZoom] = useState(false);
  // その人が登録している種別のうち、目安か楽器の組があるものだけをタブに出す。
  // 「タブはあるのに中身が何も無い」を作らない。
  const types = useMemo(() => {
    const has = new Set();
    for (const t of person?.saxTypes ?? []) {
      if (person?.gear?.[t]) has.add(t);
    }
    for (const i of ideals ?? []) if (i.ownerUid === person?.uid) has.add(i.saxType);
    return SAX_TYPES.filter((t) => has.has(t));
  }, [person, ideals]);

  const [saxType, setSaxType] = useState(() => types[0] ?? "alto");
  const [metric, setMetric] = useState("spectralCentroidHz");
  // 【選べる集合は「行が押せる形で描くもの」2026-09-19 束2】
  // 案アで**吹くがデータが無い種別**も押せるようになった。ここを types(データのある種別)
  // だけで見ていると、その種別を押した瞬間に先頭へ引き戻されて**何も起きないように見える**
  // (実測で踏んだ: T.Sax を押しても A.Sax のまま)。行が押せるのは person.saxTypes なので、
  // 引き戻すのは**そのどちらにも入っていないとき**だけにする。
  useEffect(() => {
    const pickable = person?.saxTypes ?? [];
    if (types.length > 0 && !types.includes(saxType) && !pickable.includes(saxType)) setSaxType(types[0]);
  }, [types, saxType, person]);

  const theirIdeal = useMemo(
    () => (ideals ?? []).find((i) => i.ownerUid === person?.uid && i.saxType === saxType) ?? null,
    [ideals, person, saxType]);

  const m = METRICS.find((x) => x.key === metric) ?? METRICS[0];

  // 【この人だけを自分に合わせる】コホート平均と同じ算術を使う。
  // 自分の目安が無い種別では合わせられないので、そのときは相手の線だけを出さず、
  // なぜ出ないのかを言う(絶対値だけ出すと環境の差を実力の差と読ませてしまう)。
  // 【合わせた結果を1度だけ作る】グラフにも取り込みにも同じものを使う。
  // 別々に計算すると、画面に出ている線と取り込まれる値が食い違いうる。
  const aligned = useMemo(() => {
    if (!theirIdeal) return null;
    const mineShared = { notes: sanitizeNotes(myIdeals?.[saxType]?.notes) };
    return alignProfile(mineShared, { notes: theirIdeal.notes });
  }, [theirIdeal, myIdeals, saxType]);

  const chart = useMemo(() => {
    if (!theirIdeal || !aligned) return null;
    const mineShared = { notes: sanitizeNotes(myIdeals?.[saxType]?.notes) };
    if (aligned.error) return { error: aligned.error };
    // 【便AO】3指標ぶんを作る(byMetric。R12 の柱の幅を測るのに要る)。描くのは m.key の分。
    // 【便AQ】線ごとに**その線の持っている音で**拾う(noteValues)。相手の音で自分を絞らない。
    const theirBy = Object.fromEntries(METRICS.map((x) => [x.key, noteValues(aligned.notes, x.key)]));
    const mineBy = Object.fromEntries(METRICS.map((x) => [x.key, noteValues(mineShared.notes, x.key)]));
    return {
      series: [
        { label: person?.nickname ?? "この人", values: theirBy[m.key], byMetric: theirBy, ...COMPARE_SERIES },
        { label: "自分", values: mineBy[m.key], byMetric: mineBy, ...MINE_SERIES },
      ],
    };
  }, [theirIdeal, aligned, myIdeals, saxType, m.key, person]);

  if (!person) return null;
  const personPhoto = person.photo ?? null;
  // 【便AO】場所は「人物紹介」1つ。タブ(side)では変えない ── 両方のタブで出す。
  const canZoomPerson = photoZoomAvailable({
    photo: personPhoto, icon: person.icon, color: person.iconColor,
    place: "person",
  });
  // 綴りは1つ。押せる器で包むかどうかだけが変わる(中の絵は同じもの)。
  const personAvatar = (
    <Avatar icon={person.icon ?? AVATAR_ICONS[0]} color={person.iconColor ?? AVATAR_COLOR_MIN}
            photo={personPhoto} size={56} />
  );
  const g = person.gear?.[saxType] ?? null;
  const days = person.stats?.daysAll;

  // 【便P 2026-09-20 本人指示】「目安に設定ボタンは固定して。いま1番下までスクロールすると
  // ボタンの位置も上がる仕様になっている」。
  // 貼り付く器を**本文の一番最後**(通報の行より後ろ)へ移したので、ボタンを出す条件だけを
  // ここへ持ち上げる。**中身は下の分岐と同じ**: データのタブに居て、データのある種別が
  // あって、その種別の目安が公開されていて、合わせられている(chart.error が無い)とき。
  // 描画の分岐(Empty の出し分け)は1つも変えていない。
  const showAdopt = Boolean(onAdopt && side === "data" && types.length > 0
    && theirIdeal && chart && !chart.error);


  return (
    // 【C-16 / D-6 2026/09/09 本人裁定「シートは①(下寄せ + つまみ)に統一する」】
    // ここは以前**全画面・暗幕なし・重なり順 40・角丸なし**で、閉じ方は左上のボタン1つ
    // だけだった。アプリで唯一この作法だったので、器を BottomSheet に畳んだ。
    // 重なり順も 60 に揃い、閉じ方が つまみ / 暗幕タップ / 下スワイプ / Escape の4つに増える。
    // (便AO までは「左上のボタンは消さない」だった。【便AZ 2026-09-25 本人指示】で `< 一覧` も消えた。
    //  `< 音のデータ` は便AO で先に消えている。閉じ方は上の4つだけになった。)
    // 中身は縦に長い。上限(画面高 − ナビ)と overflowY: auto は BottomSheet が持つので、
    // 溢れたぶんはシートの中でスクロールする(自前の overflowY はもう持たない)。
    <BottomSheet ariaLabel={`${person.nickname} の詳細`} onClose={onClose}>
      {/* 【上の余白は 16 だけ外す 2026-09-19 本人指示「上部の余白が大きすぎるので詰めて」】
          シートの上端から中身(便AZ までは `< 一覧`、いまは名前の行)までは つまみの上 14 + つまみ 44 + つまみと中身の間 12 +
          この画面の上余白 16 = 86 あった。**BottomSheet 側の 14/44/12 は全シートに効く**ので
          1px も触らない。この画面だけが足している 16 を 0 にして 70 にする。
          `pageStyle` は他のコミュニティ画面も使う共有の定義なので、定義は変えず
          ここでの上書きだけで済ませる(paddingBottom を上書きしているのと同じ手)。 */}
      <div style={{ ...pageStyle, paddingTop: 0, paddingBottom: "var(--sp-6, 40px)" }}>
        {/* 【便AZ 2026-09-25 本人指示 C】一番上の `< 一覧` は**消した**。このシートの閉じ方は
            BottomSheet が持つ つまみ / 暗幕タップ / 下スワイプ / Escape の4つが残る
            (便AO まで左上に置いていた「行き先を名乗る戻る」は、シートの作法と二重になっていた)。 */}

        {/* 【名前の行は押せる行ではない 便AO 2026-09-24】以前はデータ側で行全体が
            プロフィールへの入口で、右端に山形を出していた。入口は下の SubTabs に移ったので、
            role="button" も山形も持たない(押しても何も起きない行に押せる印を残さない)。 */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          {canZoomPerson ? (
            <button type="button" aria-label="写真を大きく表示" style={PHOTO_TAP_STYLE}
                    onClick={() => setPhotoZoom(true)}>
              {personAvatar}
            </button>
          ) : personAvatar}
          <div style={{ minWidth: 0, flex: "1 1 0" }}>
            {/* 【便AV 2026-09-24 本人指示】「プロフィールとアイコン横の学生歴クラシックが重複するので
                個人ページではアイコンと名前だけに」── 属性・歴・ジャンルはプロフィールのタブが持つ。 */}
            <div className="sans" style={{ fontSize: "var(--fs-md)", fontWeight: 700, color: "var(--c-ink)" }}>{person.nickname}</div>
          </div>
        </div>

        {/* 【便AO 2026-09-24 本人指示】データとプロフィールはタブで切り替える。名前の行の下に置く。
            【便AU】部品は溝型(SegmentedTabs。順位の「練習日数 | 練習時間」と同じ)。
            楽器種別の選択(saxType)は両タブで共有する(状態は1つ)。 */}
        <SegmentedTabs ariaLabel="表示する内容" items={PERSON_TABS} value={side} onChange={setSide} />

        {side === "profile" ? (
          <>
            <div>
              <InfoLine label="属性" value={positionLabel(person.position)} />
              {/* 年は数値なので --font-num(§4.3) */}
              <InfoLine label="演奏開始年" value={Number.isInteger(person.startYear)
                ? <><span style={{ fontFamily: "var(--font-num)" }}>{person.startYear}</span>年</>
                : null} />
              <InfoLine label="ジャンル" value={person.genres} />
              <InfoLine label="編成" value={person.ensembles} />
            </div>

            {/* 【便AV 2026-09-24 本人指示】「楽器の組というテキストは削除」。楽器の行がそのまま見出しの役をする。 */}
            {/* 種別の選択は表と共有する。1枚のシートなので状態を2つ持たない。
                本人「プロフィールも同様に変更」── 行の見た目も表と同じ1つの部品が描く。 */}
            <SaxTypeRow saxType={saxType} playing={person.saxTypes} onPick={setSaxType} />
            {types.length === 0 ? (
              /* 直前で属性・ジャンル・編成を出しているので「何も公開していません」は嘘 */
              <Empty>楽器の組は登録されていません</Empty>
            ) : g ? (
              <div>
                <GearLine label="楽器" brand={g.instrumentBrand} model={g.instrumentModel} />
                <GearLine label="マウスピース" brand={g.mpBrand} model={g.mpModel} />
                <GearLine label="リガチャー" brand={g.ligBrand} model={g.ligModel} />
                <GearLine label="リード" brand={g.reedBrand} model={g.reedModel} strength={g.reedStrength} last />
              </div>
            ) : <Empty>この楽器の登録はまだありません</Empty>}
          </>
        ) : (
          <>
        {/* 【累計で出す】期間つきの数字は順位の画面のもの。紹介としては累計が素性を表す。 */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-2)" }}>
          <div className="sans jp-label" style={labelStyle}>練習日数</div>
          <div className="sans" style={{ fontSize: "var(--fs-lg, 22px)", fontWeight: 700, color: "var(--c-ink)" }}>
            {Number.isInteger(days) ? days : "—"}
            <span style={{ fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--c-ink-3)" }}>日</span>
          </div>
        </div>

        {/* 両タブで同じ行。データのある種別が無い人でも4つ並ぶ(押せるのは吹く種別だけ)。 */}
        <SaxTypeRow saxType={saxType} playing={person.saxTypes} onPick={setSaxType} />

        {types.length === 0 ? (
          <Empty>この人はまだ何も公開していません</Empty>
        ) : (
          <>
            {/* 【楽器の組は表に出さない 2026/09/07】裏(プロフィール)が持っている。
                同じ4行を2箇所に置くと、片方だけ直る事故が起きる。
                【見出しは消した 2026-09-19 本人指示】「中段にある音のデータというテキストは削除」。
                この画面は人物の音のデータを見る画面なので、見出しが何も足していなかった。 */}
            {!theirIdeal ? (
              <Empty>この楽器の目安はまだ公開されていません</Empty>
            ) : (
              <>
                <UnderlineTabs label="見る指標" value={metric} onChange={setMetric}
                  items={METRICS.map((x) => ({ key: x.key, label: x.label }))} />
                {chart?.error ? (
                  // 【合わせられないときに絶対値を出さない】環境の差を実力の差と読ませてしまう。
                  <Empty>{chart.error}</Empty>
                ) : chart ? (
                  <>
                    {/* 【指標名は落とす 2026-09-19 本人指示】「選択中の項目の表示も削除。
                        タブを見ればわかるので」。真上の下線タブが選択中の指標を返しているので、
                        同じ語を下でもう一度言っていた。**単位は残す** ── タブは単位を持たず、
                        縦軸の数字が何なのかはここでしか分からない。 */}
                    <div className="sans" style={noteStyle}>{m.unit}　計測{theirIdeal.sourceSessionCount ?? "—"}件</div>
                    <CommunityNoteChart chart={chart} metric={m} saxType={saxType} tuningHz={tuningHz} />
                    {/* 【便P 2026-09-20 本人裁定】案2(注記をボタンより後ろへ)は**取り消した**。
                        本人の言葉「最初に見た時はボタンと重なっててもいいが、スクロールで
                        ボタンを避けられるようにして」── 重なり自体は許されたので、
                        注記はグラフの直下(読む順どおりの場所)へ戻す。綴りは1文字も変えていない。
                        【便P 本人指示「以下のテキストと折れ線グラフの余白を詰めて」】
                        凡例と注記の間だけを詰める。親(pageStyle)の gap は --sp-4 なので、
                        この2つだけを**既にこの画面が使っている --sp-2** の格子で包む。
                        新しい数は作っていない(16px → 8px)。 */}
                    <div style={{ display: "grid", gap: "var(--sp-2)" }}>
                      <Legend series={chart.series} />
                      <div className="sans" style={noteStyle}>
                        計測環境により値全体が一律にずれるため、揃えた状態で線の形で比較しています。
                      </div>
                    </div>
                    {adopted?.ok ? (
                      <div className="sans" role="status" style={{ ...noteStyle, color: "var(--c-accent)" }}>
                        目安に設定しました。計測タブで比べられます
                      </div>
                    ) : null}
                    {adopted?.error ? (
                      <div className="sans" role="alert" style={{ ...noteStyle, color: "var(--c-bad)" }}>{adopted.error}</div>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </>
        )}
          </>
        )}
      {/* 【計画5 2026-09-10 通報の入口 / 便AG 2026-09-23 本人裁定「案A」で裏だけに移した】
          並びの一番下に置く。**この画面の主要動作ではない**ので、右下に浮かせる
          「目安に設定」(D-7)とは別の系統として、本文の流れの末尾に地味に置く。
          自分自身は通報できない(ルールも同じ条件を持つ)ので、自分の紹介では出さない。
          型は B型の素のボタン(§6.7)。危険色は使わない ── 押した先で理由を選ぶので、
          ここはまだ何も起きない一手である。

          【なぜ裏(side === "profile")だけなのか ── 便AG】
          以前は表裏どちらの末尾にも出していたが、**表(音のデータ)は縦に長い**ので、
          最後まで送らないと現れず、しかも下端には「目安に設定」の帯が貼り付いている。
          本人から「通報機能がアプリ側でなくなっている」と報告が出た ── 機能は生きていて、
          *届かなかった*。通報は「人」に対する動作であって「データ」に対する動作ではないので、
          裏へ寄せる。裏はプロフィールの数行ぶんしかないので、末尾でもひと目で届く。
          **表に戻さないこと。** 戻すとまた同じ埋もれ方をする。 */}
      {reportEntryVisible({ side, personUid: person?.uid, myUid }) ? (
        // 【便AV 2026-09-24 本人指示】「その下の横線は削除」「この人を通報ボタンをタブ切り替えの横幅と同じに」。
        // 区切りの線(borderTop)をやめ、ボタンは本文の幅いっぱい(= 上の データ | プロフィール と同じ幅)。
        <div style={{ marginTop: "var(--sp-6)" }}>
          {/* 【便AW】地なし・枠と字が赤(DANGER_OUTLINE_STYLE。マイページのアカウントを削除と同じ)。 */}
          <button
            type="button" className="sans"
            onClick={() => { setReportState(null); setReporting(true); }}
            style={{ ...DANGER_OUTLINE_STYLE, padding: "0 var(--sp-4)" }}
          >
            この人を通報
          </button>
        </div>
      ) : null}
      </div>
      {/* 【便P 2026-09-20 本人指示】「最初に見た時はボタンと重なっててもいいが、
          スクロールでボタンを避けられるようにして」。
          **空き → 貼り付く器** の順で、本文(pageStyle の器)の**外・その後ろ**に置く。
          ・器を本文の一番最後へ移すと、一番下まで送ったときの「自然な位置」が末尾に来るので、
            ボタンが下端から動かなくなる。
          ・本文の器の中に置くと、その器自身の下余白(paddingBottom: --sp-6 = 20px)が
            ボタンの下に残り、一番下で **20.44px 上がる**(375×812 の写しで実測)。
            外へ出すと同じ実測で **0px**(scrollTop 0 と最大でボタン下端が同じ)。
            本文の下余白は1px も変えていないので、他の行の見た目は動かない。
          ・空きが器の直前に在るので、その上の内容(注記・取り込んだ結果・通報の行)は
            すべてボタンを避けられる。高さの持ち主は ADOPT_STICKY_SPACER_H だけ。
          横の余白はシートのカード(padding: 14px 24px)が配るので、本文の中に在ったときと
          同じ x に右端が来る(pageStyle の横 padding は元から 0)。 */}
      {showAdopt ? <div aria-hidden="true" style={{ height: ADOPT_STICKY_SPACER_H }} /> : null}
      {showAdopt ? (
        /* 面の右下に貼り付ける器。
           【ボタンだけを浮かせる 2026-09-19 本人指示】「目安に設定の浮いているボタンの行も
           浮いてしまっているので**ボタンだけを**浮かせて」。器は地も padding も持たず、
           浮きはボタン自身の影が返す ── My Data / リードの FloatingAction と同じ作法。
           貼り付ける仕組み(sticky / bottom 0)とボタンの寸法・色・影は1つも変えていない。
           zIndex は**この容器の中だけ**の話なので 1 で足りる。 */
        <div style={{
          position: "sticky", bottom: 0, zIndex: 1,
          display: "flex", justifyContent: "flex-end",
        }}>
          <button
            type="button" className="sans"
            onClick={() => {
              const r = onAdopt({ aligned, theirIdeal, nickname: person.nickname });
              setAdopted(r?.error ? { error: r.error } : { ok: true });
            }}
            style={{
              minHeight: "var(--tap-min)", minWidth: "var(--tap-min)",
              padding: "0 var(--sp-5)", border: "none",
              borderRadius: "var(--r-pill)",
              background: "var(--c-accent)", color: "var(--c-on-accent)",
              fontSize: "var(--fs-sm)", fontWeight: 600, lineHeight: 1.2,
              boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
              cursor: "pointer",
            }}
          >目安に設定</button>
        </div>
      ) : null}
      {reporting ? (
        <ReportSheet
          nickname={person?.nickname}
          onClose={() => setReporting(false)}
          onSubmit={async (reason) => {
            try {
              await reportUser({ targetUid: person.uid, reporterUid: myUid, reason });
              setReporting(false);
              setReportState({ ok: true });
              // 一覧から即座に消す。読み直さずに呼び出し側へ知らせる
              // (読み直すと 50 件ぶんの読み取りが1回増える)。
              onReported?.(person.uid);
            } catch (e) {
              setReportState({ error: "通報を送れませんでした。電波の良いところでもう一度お試しください" });
            }
          }}
        />
      ) : null}
      {reportState?.ok ? (
        <div className="sans" role="status" style={{ ...noteStyle, marginTop: "var(--sp-3)", color: "var(--c-accent)" }}>
          通報しました。この人はすぐに一覧から見えなくなります
        </div>
      ) : null}
      {reportState?.error ? (
        <div className="sans" role="alert" style={{ ...noteStyle, marginTop: "var(--sp-3)", color: "var(--c-bad)" }}>{reportState.error}</div>
      ) : null}
      {/* 【便AH 決定5】そのまま大きく出す。閉じるのは画面のどこをタップしても(Escape も)。
          このシートより上の層へ出る(PhotoZoom が持つ)。 */}
      {photoZoom && personPhoto ? <PhotoZoom url={personPhoto} onClose={() => setPhotoZoom(false)} /> : null}
    </BottomSheet>
  );
}

// ------------------------------------------------------------------
// 通報のシート(計画5 2026-09-10)
//
// 【自由記述を置かない】理由は列挙(REPORT_REASONS)から選ぶだけ。
// 設計書 §8.1 の「自由入力はニックネームだけ」を1つも崩さない
// (その前提の上に、通報の自動処理が成立している)。
// 【器は BottomSheet】シートの器はアプリで1つ(§4.5)。
// ------------------------------------------------------------------
function ReportSheet({ nickname, onClose, onSubmit }) {
  const [reason, setReason] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <BottomSheet ariaLabel="この人を通報" onClose={onClose}>
      <div className="sans" style={{ fontSize: "var(--fs-lg)", fontWeight: 700, color: "var(--c-ink)" }}>通報</div>
      <div className="sans" style={{ ...noteStyle, marginTop: "var(--sp-2)" }}>
        {nickname ? `${nickname} さんを通報します。` : "この人を通報します。"}
        通報するとその人はすぐに一覧から見えなくなり、運営が内容を確認します。
      </div>
      {/* 理由は A型(選択中かどうかという状態を持つ)。状態は枠の色だけで返す。 */}
      <div style={{ display: "grid", gap: "var(--sp-2)", marginTop: "var(--sp-4)" }}>
        {REPORT_REASONS.map((r) => (
          <button
            key={r} type="button" className="sans ctl-state" aria-pressed={reason === r}
            onClick={() => setReason(r)}
            style={{
              minHeight: "var(--tap-min)", padding: "0 var(--sp-4)", textAlign: "left",
              color: reason === r ? "var(--c-accent)" : "var(--c-ink-2)",
              fontSize: "var(--fs-md)", fontWeight: 600, cursor: "pointer",
            }}
          >{r}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: "var(--sp-3)", marginTop: "var(--sp-5)" }}>
        <button
          type="button" onClick={onClose} className="sans ctl-plain ctl-pill"
          style={{ flex: 1, minHeight: "var(--tap-min)", color: "var(--c-ink-2)", fontSize: "var(--fs-md)", fontWeight: 600, cursor: "pointer" }}
        >やめる</button>
        {/* 【危険色にしない】消えるのは相手であって、押した本人のデータではない。
            §1.5 の危険色は「自分のものが戻らなくなる」一手のために取ってある。 */}
        <button
          type="button" disabled={!reason || busy}
          onClick={async () => { setBusy(true); await onSubmit(reason); setBusy(false); }}
          className="sans"
          style={{
            flex: 1, minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)", border: "none",
            background: "var(--c-accent)", color: "var(--c-on-accent)",
            fontSize: "var(--fs-md)", fontWeight: 700, cursor: "pointer", opacity: reason && !busy ? 1 : 0.45,
          }}
        >{busy ? "送信中…" : "通報する"}</button>
      </div>
    </BottomSheet>
  );
}
