import React, { useEffect, useMemo, useState } from "react";
import { SAX_TYPES, SAX_LABELS, GENRES, POSITIONS, AVATAR_ICONS, AVATAR_COLOR_MIN } from "./profile.js";
import { listPublicUsers, filterUsers, isFiltered, isFilteredBy, ANY, DIRECTORY_LIMIT } from "./directory.js";
import { rankByPractice, findMyRank, tallyGear, tallyCombos, GEAR_SLOTS, SLOT_LABEL, UNSET, COMBO_SLOTS } from "./aggregate.js";
import { PERIODS, PERIOD_LABEL } from "./stats.js";
import { OTHER_BRAND } from "./catalog/gear.js";
import { cohortAverage, alignProfile } from "./align.js";
import { joinOwners } from "./idealRepo.js";
import { sanitizeNotes, buildAdoptedProfile } from "./idealDoc.js";
import { Avatar } from "./icons.jsx";

// ------------------------------------------------------------------
// 共有のスタイル。値はトークンから引くだけで、新しい寸法・色は作らない。
// ------------------------------------------------------------------
/* 【minmax(0, 1fr) を外さないこと】grid の子の min-width は既定 auto なので、
   中の長い文字(型番・銘柄)が列そのものを押し広げ、**ページ全体の X 軸がずれる**。
   凡例の行に minWidth: 0 と省略記号は付けてあるが、それは flex の中でしか効かない。
   実測: 375px 幅でカードが 619.7px まで広がった。minmax(0, 1fr) で 315px に収まる。
   同じ事故がアイコンの色の格子でも起きている(CommunityTab.jsx の格子のコメント)。 */
const pageStyle = { padding: "var(--sp-4)", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "var(--sp-4)" };
const noteStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", lineHeight: 1.6 };
const labelStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", fontWeight: 600 };
// 【カードの作法】§6.6。地は --c-sunk(CommunityTab の根が持つ)、この上に白いカードを浮かせる。
// 群の境界の罫は1本も引かない。群はカードと 12px の余白だけが切る。
const cardStyle = {
  background: "var(--c-surface)", borderRadius: "var(--r-lg)",
  padding: "var(--sp-4)", boxShadow: "var(--shadow-card)",
};
// 一覧を包むカードだけ上下を詰める(D-31 の .card-list と同じ手。左右は --sp-4 のまま)
const cardListStyle = { ...cardStyle, padding: "var(--sp-1) var(--sp-4)" };
const rowcardStyle = {
  background: "var(--c-surface)", borderRadius: "var(--r-md)",
  padding: "10px 14px", boxShadow: "var(--shadow-row)",
};
// 【読ませる文章は --c-ink-2】§1.1「--c-ink-3 は約3.0:1。読ませたい文章には使わない。
// 軸目盛や区切り記号まで」。noteStyle は数値の添え物用、bodyNoteStyle は文章用。
const bodyNoteStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", lineHeight: 1.8 };
// 10px は §6.6「D-10 の実寸」表の eyebrow(10px / 600 / .08em / --c-ink-3)。体系が持つ値。
const eyebrowStyle = { fontSize: 10, fontWeight: 600, letterSpacing: ".08em", color: "var(--c-ink-3)" };

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
// 選択チップ。**当たり判定 44px / 見えるピルは 30px**。
// 本人指摘「44ptの決まりはあるが明らかに大きすぎる」への答えで、
// 箱ではなく中身を小さくする(§5「見た目の大きさは変えない。当たり判定だけ広げる」)。
// 先例: §5.1 My Data の式の行 20px / §5.2 分析タブのチップ 30px。
// ------------------------------------------------------------------
function Chip({ on, onClick, children, grow = false, ariaLabel }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={ariaLabel}
      onClick={onClick} className="sans"
      style={{
        minHeight: "var(--tap-min)", display: "inline-flex", alignItems: "center",
        justifyContent: "center", padding: 0, border: "none", background: "none",
        cursor: "pointer", flex: grow ? "1 1 0" : "0 0 auto", minWidth: 0,
      }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minHeight: 30, padding: "0 13px", borderRadius: "var(--r-pill)",
        border: `1px solid ${on ? "var(--c-accent)" : "var(--c-line-strong)"}`,
        color: on ? "var(--c-accent)" : "var(--c-ink-2)",
        fontSize: "var(--fs-xs)", fontWeight: 600, whiteSpace: "nowrap",
        width: grow ? "100%" : "auto", boxSizing: "border-box",
      }}>{children}</span>
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
function FilterPill({ label, value, options, labelOf, onChange, allowAny = true }) {
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
        {allowAny ? <option value={ANY}>{label}（すべて）</option> : null}
        {options.map((v) => <option key={v} value={v}>{labelOf ? labelOf(v) : v}</option>)}
      </select>
      <span aria-hidden="true" className="sans" style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
        width: "100%", minWidth: 0, minHeight: 34, padding: "0 10px", boxSizing: "border-box",
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

export function FilterRow({ value, onChange, saxAny = true }) {
  return (
    <div style={{ display: "flex", gap: "var(--sp-2)" }}>
      <FilterPill label="楽器" value={value.saxType} options={SAX_TYPES} allowAny={saxAny}
        labelOf={(t) => SAX_LABELS[t]} onChange={(v) => onChange({ ...value, saxType: v })} />
      <FilterPill label="ジャンル" value={value.genre} options={GENRES}
        onChange={(v) => onChange({ ...value, genre: v })} />
      <FilterPill label="属性" value={value.position} options={POSITIONS}
        onChange={(v) => onChange({ ...value, position: v })} />
    </div>
  );
}

export const EMPTY_FILTER = { saxType: ANY, genre: ANY, position: ANY };

// 【上限に触れていることを黙らない】50件で切られていることは、人数もグラフも
// 普通に出るので画面からは分からない。切られたときだけ必ず出す。
// 詳細は設計書の決定1-b(公開ユーザーが40人に達したら読み直すこと)。
function CapNotice({ count }) {
  if (count < DIRECTORY_LIMIT) return null;
  return (
    <div className="sans" role="note" style={bodyNoteStyle}>上位{DIRECTORY_LIMIT}人</div>
  );
}

function Empty({ children }) {
  return <div className="sans" style={{ ...noteStyle, padding: "var(--sp-4) 0", textAlign: "center" }}>{children}</div>;
}

// 公開ユーザーを1度だけ読んで使い回す。
// 【画面を切り替えるたびに読み直さない】読み取り回数は費用そのもので、
// 利用者数の2乗で増える(設計書の決定1-b)。同じ50件を何度も読む理由が無い。
export function usePublicUsers() {
  const [state, setState] = useState({ phase: "loading", users: [], error: null });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const users = await listPublicUsers();
        if (alive) setState({ phase: "ready", users, error: null });
      } catch (e) {
        if (alive) setState({ phase: "error", users: [], error: "みんなのデータを読み込めませんでした" });
      }
    })();
    return () => { alive = false; };
  }, []);
  return state;
}

// ------------------------------------------------------------------
// 順位
// ------------------------------------------------------------------
const gearLabelOf = (key) => (key === UNSET ? "未選択" : key === OTHER_BRAND ? "その他" : key);

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
  if (u.position) parts.push(u.position);
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

// 順位の色。**面を塗らず、アイコンの環の線と順位の数字にだけ使う**(追記1 厳守事項)。
// 4位以下には色を与えない。金属質の光沢もグラデーションも使わない。
const RANK_COLOR = { 1: "var(--c-rank-1)", 2: "var(--c-rank-2)", 3: "var(--c-rank-3)" };

function RankRow({ row, big = false, mine = false, onTap }) {
  const rankColor = RANK_COLOR[row.rank] ?? null;
  const tap = onTap ? {
    role: "button", tabIndex: 0, onClick: onTap,
    onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } },
    "aria-label": `${row.nickname} の詳細を見る`,
  } : {};
  return (
    <div {...tap} style={{
      cursor: onTap ? "pointer" : "default",
      display: "flex", alignItems: "center", gap: "var(--sp-3)",
      // 上位3件だけカードを独立させる。**台の高さには頼らない**(本人指示「丸パクリ過ぎる」)
      ...(big ? cardStyle : { padding: "11px 2px", minHeight: 47 }),
    }}>
      <div className="sans" style={{
        flex: "0 0 1.6em", textAlign: "center", fontWeight: 700, letterSpacing: "-.02em",
        fontFamily: "var(--font-num)",
        fontSize: big ? "var(--fs-md)" : "var(--fs-sm)",
        color: rankColor ?? "var(--c-ink-3)",
      }}>{row.rank}</div>
      {/* 環は面ではなく線。アイコンの外側に出す */}
      <span style={{
        position: "relative", display: "inline-flex", flex: "none",
        borderRadius: "50%",
        boxShadow: rankColor ? `0 0 0 2px ${rankColor}` : "none",
        margin: rankColor ? 2 : 0,
      }}>
        <Avatar icon={row.icon ?? AVATAR_ICONS[0]} color={row.iconColor ?? AVATAR_COLOR_MIN} size={big ? 44 : 34} />
      </span>
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <NameLine nickname={row.nickname} mine={mine} size={big ? "var(--fs-md)" : undefined} />
        <WhoLine u={row} />
      </div>
      <div className="sans" style={{
        flex: "0 0 auto", fontWeight: 700, fontFamily: "var(--font-num)", letterSpacing: "-.02em",
        fontSize: big ? "var(--fs-xl)" : "var(--fs-md)", color: "var(--c-ink)",
      }}>
        {row.days}<span style={{ fontFamily: "var(--font-jp)", fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--c-ink-3)" }}>日</span>
      </div>
    </div>
  );
}

export function RankScreen({ users, myUid, onOpenPerson }) {
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [period, setPeriod] = useState("month");
  const shown = useMemo(() => filterUsers(users, filter), [users, filter]);
  const ranked = useMemo(() => rankByPractice(shown, period), [shown, period]);
  const mine = findMyRank(ranked, myUid);

  return (
    <div style={pageStyle}>
      <FilterRow value={filter} onChange={setFilter} />
      {/* 期間は状態を持つので A型のチップ。当たり判定44px / 見た目30px */}
      <div role="radiogroup" aria-label="期間" style={{ display: "flex", gap: "var(--sp-1)" }}>
        {PERIODS.map((p) => (
          <Chip key={p} on={p === period} grow onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</Chip>
        ))}
      </div>

      <div className="sans" style={{ ...bodyNoteStyle, display: "flex", gap: 9 }}>
        <span>練習日数</span><span>{PERIOD_LABEL[period]}</span>
      </div>

      {ranked.length === 0 ? (
        <Empty>
          {isFiltered(filter)
            ? "この条件に合う人がまだいません"
            : `${PERIOD_LABEL[period]}に練習した人がまだいません`}
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
            <div style={cardListStyle}>
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

      {/* 【圏外でも自分は必ず見える】一覧に自分が出ていないときだけ、下に自分を置く。
          出ていない理由は「その期間に練習していない」か「絞り込みから外れている」の2つで、
          どちらなのかを言い分ける ── 「出ない」だけでは直しようがない。 */}
      {myUid && !mine ? (
        <div className="sans" style={{ ...rowcardStyle, ...bodyNoteStyle }}>
          {isFiltered(filter)
            ? "あなたはいまの絞り込みに含まれていません"
            : `あなたは${PERIOD_LABEL[period]}の記録がまだありません`}
        </div>
      ) : null}

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

function PieChart({ items, label }) {
  const top = items.slice(0, 3);
  const restRatio = Math.max(0, 1 - top.reduce((a, x) => a + x.ratio, 0));
  const slices = [];
  let acc = 0;
  top.forEach((x, i) => { slices.push({ from: acc, to: acc + x.ratio, fill: PIE_COLORS[i] }); acc += x.ratio; });
  if (restRatio > 0.0001) slices.push({ from: acc, to: 1, fill: PIE_REST });
  const whole = slices.length === 1;
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" style={{ flex: "none" }} role="img" aria-label={label}>
      {whole
        ? <circle cx={PIE_C} cy={PIE_C} r={PIE_R} fill={slices[0].fill} />
        : slices.map((sl, i) => {
            const d = arcPath(sl.from, sl.to);
            return d ? <path key={i} d={d} fill={sl.fill} /> : null;
          })}
    </svg>
  );
}

function PieLegend({ items, restCount }) {
  const top = items.slice(0, 3);
  const rest = items.slice(3);
  const restRatio = rest.reduce((a, x) => a + x.ratio, 0);
  const row = (color, text, pct, muted) => (
    <div key={text} style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, flex: "none" }} />
      <span className="sans" style={{
        fontSize: "var(--fs-xs)", color: muted ? "var(--c-ink-3)" : "var(--c-ink)",
        minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{text}</span>
      <span className="sans" style={{
        ...noteStyle, flex: "none", marginLeft: "auto", fontFamily: "var(--font-num)",
      }}>{Math.round(pct * 100)}%</span>
    </div>
  );
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
      {top.map((x, i) => row(PIE_COLORS[i], gearLabelOf(x.key), x.ratio, false))}
      {rest.length > 0 ? row(PIE_REST, `ほか${rest.length}種類`, restRatio, true) : null}
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
  const saxType = filter.saxType;

  const shown = useMemo(() => filterUsers(users, filter), [users, filter]);
  const gear = useMemo(() => tallyGear(shown, saxType), [shown, saxType]);
  const combos = useMemo(() => tallyCombos(shown, saxType, depth), [shown, saxType, depth]);
  const items = gear.slots[slot] ?? [];

  return (
    <div style={pageStyle}>
      <FilterRow value={filter} onChange={setFilter} saxAny={false} />

      {gear.total === 0 ? (
        <Empty>この条件で {SAX_LABELS[saxType]} を吹く人がまだいません</Empty>
      ) : (
        <>
          <div style={cardStyle}>
            {/* 【見出しを置かない】本人指示。何の内訳かは下のタブがそのまま言っている
                (§6.0「説明を消して形に語らせる」) */}
            <UnderlineTabs
              label="見る項目" value={slot} onChange={setSlot}
              items={GEAR_SLOTS.map((k) => ({ key: k, label: SLOT_LABEL[k] }))}
            />
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", padding: "var(--sp-2) 0 var(--sp-1)" }}>
              <PieChart items={items} label={`${SAX_LABELS[saxType]} を吹く${gear.total}人の${SLOT_LABEL[slot]}の内訳`} />
              <PieLegend items={items} />
            </div>
            <div className="sans" style={bodyNoteStyle}>
              {SAX_LABELS[saxType]} を吹く<span style={{ fontFamily: "var(--font-num)", fontWeight: 700 }}>{gear.total}</span>人
            </div>
          </div>

          <div style={cardStyle}>
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
                {combos.combos.slice(0, 5).map((c, i) => {
                  const pct = Math.round(c.ratio * 100);
                  return (
                    <div key={c.key} style={{ padding: "7px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--sp-2)" }}>
                        <span className="sans" style={{
                          fontSize: "var(--fs-sm)", color: "var(--c-ink)", minWidth: 0,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{c.parts.map(gearLabelOf).join(" / ")}</span>
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

// 半音インデックス → 表示名。0 を C として12音で回す。
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteLabel = (key) => {
  const n = Number(key);
  if (!Number.isInteger(n)) return String(key);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) + 1);
};

// 折れ線を1枚のSVGで描く。**横軸は音名**(他の画面と同じ向き)。
//
// 【centerAt】その値を中心にした対称の縦軸にし、中心線を1本引く。
// 音程は「0 からどれだけ外れているか」を読む指標なので、min/max で枠を決めると
// 0 が枠の外に出ることすらあり、上か下かが読めない(2026/09/06 本人指示)。
// App.jsx の My Data(NoteAxisLineChart)が既に同じ形を持つので、それに揃える。
function LineChart({ keys, series, digits, centerAt = null }) {
  const W = 320, H = 160, PAD_L = 40, PAD_B = 22, PAD_T = 10, PAD_R = 8;
  const all = series.flatMap((s) => keys.map((k) => s.values[k]).filter((v) => typeof v === "number"));
  if (all.length === 0) return null;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (typeof centerAt === "number") {
    // 中心からの最大の外れ幅で対称にする。全値が中心のときは 0 で割らないよう 1 を置く。
    const half = Math.max(...all.map((v) => Math.abs(v - centerAt))) || 1;
    lo = centerAt - half; hi = centerAt + half;
  } else if (lo === hi) { lo -= 1; hi += 1; } // 全部同じ値のとき0で割らない
  // 目盛は上下2本。中心があるときは中心も加えて3本。
  const ticks = typeof centerAt === "number" ? [hi, centerAt, lo] : [hi, lo];
  const x = (i) => PAD_L + (keys.length === 1 ? (W - PAD_L - PAD_R) / 2 : (i * (W - PAD_L - PAD_R)) / (keys.length - 1));
  const y = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
         aria-label={`音名ごとの比較。横軸は音名、縦軸は値(${lo.toFixed(digits)}〜${hi.toFixed(digits)})`}
         style={{ display: "block", overflow: "visible" }}>
      {/* 目盛りは上下2本だけ。線の形を読む画面なので、罫で埋めない。
          中心線(±0)だけは --c-line-strong の実線で一段濃くする ── App.jsx の
          My Data の中央線と同じ(DESIGN-SYSTEM §1.8)。 */}
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)}
                stroke={v === centerAt ? "var(--c-line-strong)" : "var(--c-line)"} strokeWidth="1" />
          <text x={PAD_L - 6} y={y(v) + 4} textAnchor="end" fontSize="9" fill="var(--c-ink-3)" className="sans">
            {v.toFixed(digits)}
          </text>
        </g>
      ))}
      {keys.map((k, i) => (
        <text key={k} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--c-ink-3)" className="sans">
          {noteLabel(k)}
        </text>
      ))}
      {series.map((s) => {
        const pts = keys.map((k, i) => (typeof s.values[k] === "number" ? `${x(i)},${y(s.values[k])}` : null)).filter(Boolean);
        if (pts.length === 0) return null;
        return (
          <g key={s.label}>
            <polyline points={pts.join(" ")} fill="none" stroke={s.color} strokeWidth={s.width ?? 2}
                      strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dash ?? "none"} />
            {pts.map((p) => {
              const [px, py] = p.split(",");
              return <circle key={p} cx={px} cy={py} r="2.5" fill={s.color} />;
            })}
          </g>
        );
      })}
    </svg>
  );
}

function Legend({ series }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)" }}>
      {series.map((s) => (
        <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
          <span style={{ width: 14, height: 3, borderRadius: 2, background: s.color, flex: "0 0 auto" }} />
          <span className="sans" style={noteStyle}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export function DataScreen({ users, ideals, myIdeals, myUid, saxTypes, onOpenPerson }) {
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
    const keys = Object.keys(avg.notes).sort((a, b) => Number(a) - Number(b));
    if (keys.length === 0) return null;
    // 自分の線も変換後の値から読む。ここだけローカルの綴りを直に読むと、
    // 綴りを足したときに片方だけ直し忘れる。読む場所を1つにする。
    const mineValues = {};
    for (const k of keys) {
      const v = mineShared.notes?.[k]?.[m.key];
      if (typeof v === "number" && Number.isFinite(v)) mineValues[k] = v;
    }
    const avgValues = {};
    for (const k of keys) {
      const cell = avg.notes[k]?.[m.key];
      if (cell) avgValues[k] = cell.value;
    }
    return {
      keys,
      series: [
        { label: "みんなの平均", values: avgValues, color: "var(--c-accent)" },
        { label: "自分", values: mineValues, color: "var(--c-ink-2)", dash: "4 3" },
      ],
    };
  }, [avg, mineShared, m.key]);

  return (
    <div style={pageStyle}>
      <FilterRow value={filter} onChange={setFilter} saxAny={false} />

      <div style={cardStyle}>
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
            {chart ? <LineChart keys={chart.keys} series={chart.series} digits={m.digits}
                                       centerAt={m.key === "pitchCentsSigned" ? 0 : null} /> : <Empty>この指標のデータがありません</Empty>}
            {chart ? <Legend series={chart.series} /> : null}
            {/* 【この注意書きを消さないこと】平行移動を知らずに見ると、
                「自分のほうが低い/高い」を絶対値の差だと読んでしまう。 */}
            <div className="sans" style={bodyNoteStyle}>
              計測環境により値全体が一律にずれるため、揃えた状態で線の形で比較しています
            </div>
          </div>
        )}
      </div>

      <div className="sans jp-label" style={{ ...labelStyle, paddingTop: "var(--sp-3)" }}>この条件の人</div>
      {/* 【楽器種別は絞り込みに数えない】この画面の楽器ピルには「すべて」が無く、
          常に1つ選ばれている。数えると必ず「絞り込み中」になり、
          「まだ誰もいない」のか「条件で外れた」のかを言い分けられなくなる。 */}
      {pairs.length === 0 ? (
        <Empty>{isFilteredBy(filter, ["genre", "position"]) ? "この条件に合う目安がまだありません" : "公開されている目安がまだありません"}</Empty>
      ) : (
        <div style={cardListStyle}>
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
              <Avatar icon={owner.icon ?? AVATAR_ICONS[0]} color={owner.iconColor ?? AVATAR_COLOR_MIN} size={34} />
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
// strength はリードのときだけ渡す。番手を持たない古いドキュメントもあるので、
// 無ければ何も足さない(ルールが null を許している)。
function GearLine({ label, brand, model, strength = null }) {
  const has = brand !== null && brand !== undefined;
  const v = !has ? "未選択"
    : brand === OTHER_BRAND ? "その他"
    : model ? `${brand} ${model}` : brand;
  return (
    <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "baseline", padding: "var(--sp-2) 0", borderBottom: "1px solid var(--c-line)" }}>
      <div className="sans jp-label" style={{ ...labelStyle, flex: "0 0 7em" }}>{label}</div>
      <div className="sans" style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)", flex: "1 1 0", minWidth: 0 }}>
        {v}
        {/* 番手は数値なので --font-num(§4.3) */}
        {has && strength ? <span style={{ fontFamily: "var(--font-num)" }}> {strength}</span> : null}
      </div>
    </div>
  );
}

export function PersonSheet({ person, ideals, myIdeals, onClose, onAdopt }) {
  const [adopted, setAdopted] = useState(null);
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
  useEffect(() => { if (types.length > 0 && !types.includes(saxType)) setSaxType(types[0]); }, [types, saxType]);

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
    const keys = Object.keys(aligned.notes).sort((a, b) => Number(a) - Number(b));
    const theirValues = {}; const mineValues = {};
    for (const k of keys) {
      const tv = aligned.notes[k]?.[m.key];
      if (typeof tv === "number") theirValues[k] = tv;
      const mv = mineShared.notes?.[k]?.[m.key];
      if (typeof mv === "number") mineValues[k] = mv;
    }
    return {
      keys,
      series: [
        { label: person?.nickname ?? "この人", values: theirValues, color: "var(--c-accent)" },
        { label: "自分", values: mineValues, color: "var(--c-ink-2)", dash: "4 3" },
      ],
    };
  }, [theirIdeal, aligned, myIdeals, saxType, m.key, person]);

  if (!person) return null;
  const g = person.gear?.[saxType] ?? null;
  const days = person.stats?.daysAll;


  return (
    <div role="dialog" aria-label={`${person.nickname} の詳細`}
         style={{ position: "fixed", inset: 0, zIndex: 40, background: "var(--c-bg)", overflowY: "auto" }}>
      <div style={{ ...pageStyle, paddingBottom: "var(--sp-6, 40px)" }}>
        <button type="button" onClick={onClose} className="sans" aria-label="閉じる"
                style={{ justifySelf: "start", minHeight: "var(--tap-min)", padding: "0 var(--sp-3)",
                         border: "none", borderRadius: "var(--r-md)", background: "var(--c-sunken)",
                         color: "var(--c-ink-2)", fontSize: "var(--fs-sm)", fontWeight: 600, cursor: "pointer" }}>
          ← 戻る
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          <Avatar icon={person.icon ?? AVATAR_ICONS[0]} color={person.iconColor ?? AVATAR_COLOR_MIN} size={56} />
          <div style={{ minWidth: 0 }}>
            <div className="sans" style={{ fontSize: "var(--fs-md)", fontWeight: 700, color: "var(--c-ink)" }}>{person.nickname}</div>
            <WhoLine u={person} />
          </div>
        </div>

        {/* 【累計で出す】期間つきの数字は順位の画面のもの。紹介としては累計が素性を表す。 */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-2)" }}>
          <div className="sans jp-label" style={labelStyle}>練習日数</div>
          <div className="sans" style={{ fontSize: "var(--fs-lg, 22px)", fontWeight: 700, color: "var(--c-ink)" }}>
            {Number.isInteger(days) ? days : "—"}
            <span style={{ fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--c-ink-3)" }}>日</span>
          </div>
        </div>

        {types.length === 0 ? (
          <Empty>この人はまだ何も公開していません</Empty>
        ) : (
          <>
            <div role="radiogroup" aria-label="楽器種別" style={{ display: "flex", gap: "var(--sp-1)" }}>
              {types.map((t) => (
                <Chip key={t} on={t === saxType} grow onClick={() => setSaxType(t)}>{SAX_LABELS[t]}</Chip>
              ))}
            </div>

              {g ? (
              <div>
                <GearLine label="楽器" brand={g.instrumentBrand} model={g.instrumentModel} />
                <GearLine label="マウスピース" brand={g.mpBrand} model={g.mpModel} />
                <GearLine label="リガチャー" brand={g.ligBrand} model={g.ligModel} />
                <GearLine label="リード" brand={g.reedBrand} model={g.reedModel} strength={g.reedStrength} />
              </div>
            ) : <Empty>この楽器の登録はまだありません</Empty>}

            <div className="sans jp-label" style={{ ...labelStyle, paddingTop: "var(--sp-3)" }}>音のデータ</div>
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
                    <div className="sans" style={noteStyle}>{m.label}({m.unit})　録音{theirIdeal.sourceSessionCount ?? "—"}回</div>
                    <LineChart keys={chart.keys} series={chart.series} digits={m.digits}
                               centerAt={m.key === "pitchCentsSigned" ? 0 : null} />
                    <Legend series={chart.series} />
                    <div className="sans" style={noteStyle}>
                      計測環境により値全体が一律にずれるため、揃えた状態で線の形で比較しています
                    </div>
                    {/* 【取り込むのは「合わせたあとの値」】相手の生の値を目標にすると、
                        環境の差のぶんだけ全音で「足りない」と出続け、どの音を直せばいいか
                        分からなくなる。上のグラフに出ている線がそのまま目安になる。 */}
                    {onAdopt ? (
                      <button
                        type="button" className="sans"
                        onClick={() => {
                          const r = onAdopt({ aligned, theirIdeal, nickname: person.nickname });
                          setAdopted(r?.error ? { error: r.error } : { ok: true });
                        }}
                        style={{
                          minHeight: "var(--tap-min)", border: "none", borderRadius: "var(--r-md)",
                          background: "var(--c-accent)", color: "var(--c-on-accent)",
                          fontSize: "var(--fs-sm)", fontWeight: 700, cursor: "pointer",
                        }}
                      >目安に設定</button>
                    ) : null}
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
      </div>
    </div>
  );
}
