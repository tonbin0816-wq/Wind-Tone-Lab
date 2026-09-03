import React, { useEffect, useMemo, useState } from "react";
import { SAX_TYPES, SAX_LABELS, GENRES, POSITIONS, AVATAR_ICONS, AVATAR_COLOR_MIN } from "./profile.js";
import { listPublicUsers, filterUsers, isFiltered, ANY, DIRECTORY_LIMIT } from "./directory.js";
import { rankByPractice, findMyRank, tallyGear, tallyCombos, GEAR_SLOTS, SLOT_LABEL, UNSET, COMBO_SLOTS } from "./aggregate.js";
import { PERIODS, PERIOD_LABEL } from "./stats.js";
import { OTHER_BRAND } from "./catalog/gear.js";
import { cohortAverage } from "./align.js";
import { joinOwners } from "./idealRepo.js";
import { sanitizeNotes } from "./idealDoc.js";
import { Avatar } from "./icons.jsx";

// ------------------------------------------------------------------
// 共有のスタイル。値はトークンから引くだけで、新しい寸法・色は作らない。
// ------------------------------------------------------------------
const pageStyle = { padding: "var(--sp-4)", display: "grid", gap: "var(--sp-4)" };
const noteStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", lineHeight: 1.6 };
const labelStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", fontWeight: 600 };
const selectStyle = {
  minHeight: "var(--tap-min)", width: "100%", padding: "0 var(--sp-2)", boxSizing: "border-box",
  borderRadius: "var(--r-xs)", border: "1px solid var(--c-line-strong)",
  background: "var(--c-surface)", color: "var(--c-ink)", fontSize: "var(--fs-sm)",
};

// ------------------------------------------------------------------
// 条件行。**3画面が同じ部品を同じ位置(上部1行)に置く。**
//
// 掛け算は 楽器 × ジャンル × 属性 の3つに固定する。それぞれ単一選択で、
// 複数選択にはしない ── 「クラシック または ジャズ」の平均は誰の目安にもならない。
// カードで囲まない(2026-08-28 本人裁定)。
// ------------------------------------------------------------------
export function FilterRow({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const opt = (list) => list.map((v) => <option key={v} value={v}>{v}</option>);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "var(--sp-2)" }}>
      <select aria-label="楽器種別で絞り込む" value={value.saxType} onChange={set("saxType")} className="sans" style={selectStyle}>
        <option value={ANY}>楽器：すべて</option>
        {SAX_TYPES.map((t) => <option key={t} value={t}>{SAX_LABELS[t]}</option>)}
      </select>
      <select aria-label="ジャンルで絞り込む" value={value.genre} onChange={set("genre")} className="sans" style={selectStyle}>
        <option value={ANY}>ジャンル：すべて</option>
        {opt(GENRES)}
      </select>
      <select aria-label="属性で絞り込む" value={value.position} onChange={set("position")} className="sans" style={selectStyle}>
        <option value={ANY}>属性：すべて</option>
        {opt(POSITIONS)}
      </select>
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
    <div className="sans" role="note" style={noteStyle}>
      上位{DIRECTORY_LIMIT}人ぶんの集計です。全員ぶんではありません
    </div>
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

// 「学生 ・ 歴3年 ・ クラシック」。読めない区画は丸ごと省く。
function whoLine(u) {
  const parts = [];
  if (u.position) parts.push(u.position);
  const y = yearsOf(u.startYear);
  if (y !== null) parts.push(`歴${y}年`);
  if (Array.isArray(u.genres) && u.genres[0]) parts.push(u.genres[0]);
  return parts.join(" ・ ");
}

function RankRow({ row, big = false, mine = false }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "var(--sp-3)",
      padding: big ? "var(--sp-3)" : "var(--sp-2) var(--sp-3)",
      background: big || mine ? "var(--c-surface)" : "transparent",
      borderRadius: big || mine ? "var(--r-lg)" : 0,
      boxShadow: big ? "var(--shadow-card)" : "none",
      border: mine ? "1px solid var(--c-accent-line)" : "none",
    }}>
      <div className="sans" style={{
        flex: "0 0 1.6em", textAlign: "center", fontWeight: 700,
        fontSize: big ? "var(--fs-md)" : "var(--fs-sm)", color: "var(--c-ink-2)",
      }}>{row.rank}</div>
      <Avatar icon={row.icon ?? AVATAR_ICONS[0]} color={row.iconColor ?? AVATAR_COLOR_MIN} size={big ? 44 : 34} />
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <div className="sans" style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--c-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.nickname}
          {mine ? <span className="sans" style={{ marginLeft: "var(--sp-2)", fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--c-accent)" }}>あなた</span> : null}
        </div>
        <div className="sans" style={noteStyle}>{whoLine(row)}</div>
      </div>
      <div className="sans" style={{ flex: "0 0 auto", fontWeight: 700, fontSize: big ? "var(--fs-md)" : "var(--fs-sm)", color: "var(--c-ink)" }}>
        {row.days}<span style={{ fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--c-ink-3)" }}>日</span>
      </div>
    </div>
  );
}

export function RankScreen({ users, myUid }) {
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [period, setPeriod] = useState("month");
  const shown = useMemo(() => filterUsers(users, filter), [users, filter]);
  const ranked = useMemo(() => rankByPractice(shown, period), [shown, period]);
  const mine = findMyRank(ranked, myUid);

  return (
    <div style={pageStyle}>
      <FilterRow value={filter} onChange={setFilter} />
      <div role="radiogroup" aria-label="期間" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "var(--sp-1)" }}>
        {PERIODS.map((p) => (
          <button
            key={p} type="button" role="radio" aria-checked={p === period}
            onClick={() => setPeriod(p)} className="sans"
            style={{
              minHeight: "var(--tap-min)", border: "none", borderRadius: "var(--r-md)",
              background: p === period ? "var(--c-accent)" : "var(--c-sunken)",
              color: p === period ? "var(--c-on-accent)" : "var(--c-ink-2)",
              fontSize: "var(--fs-sm)", fontWeight: 600, cursor: "pointer",
            }}
          >{PERIOD_LABEL[p]}</button>
        ))}
      </div>

      <div className="sans" style={noteStyle}>練習日数 ・ {PERIOD_LABEL[period]}</div>

      {ranked.length === 0 ? (
        <Empty>
          {isFiltered(filter)
            ? "この条件に合う人がまだいません"
            : `${PERIOD_LABEL[period]}に練習した人がまだいません`}
        </Empty>
      ) : (
        <>
          {/* 上位3件だけカードを独立させる。台の高さには頼らない */}
          <div style={{ display: "grid", gap: "var(--sp-2)" }}>
            {ranked.slice(0, 3).map((r) => <RankRow key={r.uid} row={r} big mine={r.uid === myUid} />)}
          </div>
          <div style={{ display: "grid", gap: "var(--sp-1)" }}>
            {ranked.slice(3).map((r) => <RankRow key={r.uid} row={r} mine={r.uid === myUid} />)}
          </div>
        </>
      )}

      {/* 【圏外でも自分は必ず見える】一覧に自分が出ていないときだけ、下に自分の行を置く。
          出ていない理由は2つ(順位に入っているが画面外 / そもそも並んでいない)で、
          後者は「その期間に練習していない」か「絞り込みから外れている」。
          どちらなのかを言い分ける。 */}
      {myUid && !mine ? (
        <div className="sans" style={{ ...noteStyle, paddingTop: "var(--sp-2)", borderTop: "1px solid var(--c-line)" }}>
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
// シェア(機材の内訳)
// ------------------------------------------------------------------
function Bar({ label, count, ratio }) {
  const pct = Math.round(ratio * 100);
  return (
    <div style={{ display: "grid", gap: "var(--sp-1)", padding: "var(--sp-1) 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--sp-2)" }}>
        <div className="sans" style={{ fontSize: "var(--fs-sm)", color: "var(--c-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
        <div className="sans" style={{ ...noteStyle, flex: "0 0 auto" }}>{count}人 ・ {pct}%</div>
      </div>
      <div style={{ height: 6, borderRadius: "var(--r-pill)", background: "var(--c-sunken)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--c-accent)" }} />
      </div>
    </div>
  );
}

export function ShareScreen({ users }) {
  const [filter, setFilter] = useState(EMPTY_FILTER);
  // 【機材は楽器種別を必ず1つに決める】gear は種別ごとに1組なので、
  // 種別が決まらないと何の内訳なのか言えない。条件行の「すべて」とは別に既定を持つ。
  const [saxType, setSaxType] = useState("alto");
  const [slot, setSlot] = useState("instrument");
  const [depth, setDepth] = useState(2);

  const shown = useMemo(() => filterUsers(users, { ...filter, saxType: ANY }), [users, filter]);
  const gear = useMemo(() => tallyGear(shown, saxType), [shown, saxType]);
  const combos = useMemo(() => tallyCombos(shown, saxType, depth), [shown, saxType, depth]);

  const tab = (on) => ({
    minHeight: "var(--tap-min)", border: "none", borderRadius: "var(--r-md)",
    background: on ? "var(--c-accent)" : "var(--c-sunken)",
    color: on ? "var(--c-on-accent)" : "var(--c-ink-2)",
    fontSize: "var(--fs-sm)", fontWeight: 600, cursor: "pointer",
  });

  return (
    <div style={pageStyle}>
      <FilterRow value={{ ...filter, saxType: ANY }} onChange={(v) => setFilter({ ...v, saxType: ANY })} />
      <div role="radiogroup" aria-label="機材の楽器種別" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "var(--sp-1)" }}>
        {SAX_TYPES.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={t === saxType} onClick={() => setSaxType(t)} className="sans" style={tab(t === saxType)}>
            {SAX_LABELS[t]}
          </button>
        ))}
      </div>

      {gear.total === 0 ? (
        <Empty>この条件で {SAX_LABELS[saxType]} を吹く人がまだいません</Empty>
      ) : (
        <>
          <div className="sans" style={noteStyle}>{SAX_LABELS[saxType]} を吹く {gear.total}人のデータ</div>

          <div role="radiogroup" aria-label="機材の種類" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "var(--sp-1)" }}>
            {GEAR_SLOTS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={s === slot} onClick={() => setSlot(s)} className="sans" style={tab(s === slot)}>
                {SLOT_LABEL[s]}
              </button>
            ))}
          </div>
          <div>
            {gear.slots[slot].map((x) => <Bar key={x.key} label={gearLabelOf(x.key)} count={x.count} ratio={x.ratio} />)}
          </div>

          <div className="sans jp-label" style={{ ...labelStyle, paddingTop: "var(--sp-3)" }}>人気の組み合わせ</div>
          <div role="radiogroup" aria-label="組み合わせの項目数" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "var(--sp-1)" }}>
            {Object.keys(COMBO_SLOTS).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={Number(d) === depth} onClick={() => setDepth(Number(d))} className="sans" style={tab(Number(d) === depth)}>
                {d}項目
              </button>
            ))}
          </div>
          <div className="sans" style={noteStyle}>
            {COMBO_SLOTS[depth].map((s) => SLOT_LABEL[s]).join(" × ")}
          </div>
          {combos.total === 0 ? (
            <Empty>機材をすべて登録している人がまだいません</Empty>
          ) : (
            <div>
              {combos.combos.slice(0, 10).map((c) => (
                <Bar key={c.key} label={c.parts.map(gearLabelOf).join(" / ")} count={c.count} ratio={c.ratio} />
              ))}
            </div>
          )}
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
function LineChart({ keys, series, digits }) {
  const W = 320, H = 160, PAD_L = 40, PAD_B = 22, PAD_T = 10, PAD_R = 8;
  const all = series.flatMap((s) => keys.map((k) => s.values[k]).filter((v) => typeof v === "number"));
  if (all.length === 0) return null;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) { lo -= 1; hi += 1; } // 全部同じ値のとき0で割らない
  const x = (i) => PAD_L + (keys.length === 1 ? (W - PAD_L - PAD_R) / 2 : (i * (W - PAD_L - PAD_R)) / (keys.length - 1));
  const y = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
         aria-label={`音名ごとの比較。横軸は音名、縦軸は値(${lo.toFixed(digits)}〜${hi.toFixed(digits)})`}
         style={{ display: "block", overflow: "visible" }}>
      {/* 目盛りは上下2本だけ。線の形を読む画面なので、罫で埋めない */}
      {[hi, lo].map((v, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="var(--c-line)" strokeWidth="1" />
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

export function DataScreen({ users, ideals, myProfile, myUid }) {
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [metric, setMetric] = useState("spectralCentroidHz");

  const shown = useMemo(() => filterUsers(users, filter), [users, filter]);
  // 【条件で絞った人の目安だけを使う】上のカードと下の一覧が同じ母集団になる。
  const pairs = useMemo(() => {
    const joined = joinOwners(ideals, shown);
    // 楽器種別の絞り込みは目安そのものにも効かせる。
    // 掛け持ちの人はアルトとテナーの両方の目安を持ちうるので、
    // 所有者で絞るだけでは別の楽器の目安が混ざる。
    return filter.saxType === ANY ? joined : joined.filter((p) => p.ideal.saxType === filter.saxType);
  }, [ideals, shown, filter.saxType]);

  const others = useMemo(() => pairs.filter((p) => p.ideal.ownerUid !== myUid).map((p) => p.ideal), [pairs, myUid]);

  // 【綴りを揃えてから比べる】自分の目安は App.jsx の形(centroidHz / harmonicsProfile)、
  // 読んできた他人の目安は公開の形(spectralCentroidHz / harmonics)。
  // 変換せずに渡すと共通音が1つも見つからず、**常に「重なっている音が足りません」**になる。
  // 実際にこれを踏んだ。sanitizeNotes が対応表を持っているので、それを通す。
  const mineShared = useMemo(() => ({ notes: sanitizeNotes(myProfile?.notes) }), [myProfile]);
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
      <FilterRow value={filter} onChange={setFilter} />

      <div role="radiogroup" aria-label="見る指標" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "var(--sp-1)" }}>
        {METRICS.map((x) => (
          <button key={x.key} type="button" role="radio" aria-checked={x.key === metric}
                  onClick={() => setMetric(x.key)} className="sans"
                  style={{
                    minHeight: "var(--tap-min)", border: "none", borderRadius: "var(--r-md)",
                    background: x.key === metric ? "var(--c-accent)" : "var(--c-sunken)",
                    color: x.key === metric ? "var(--c-on-accent)" : "var(--c-ink-2)",
                    fontSize: "var(--fs-sm)", fontWeight: 600, cursor: "pointer",
                  }}>{x.label}</button>
        ))}
      </div>

      {avg.error ? (
        <Empty>{avg.error}</Empty>
      ) : (
        <div style={{ display: "grid", gap: "var(--sp-2)" }}>
          <div className="sans" style={noteStyle}>{avg.count}人のデータ ・ {m.label}({m.unit})</div>
          {chart ? <LineChart keys={chart.keys} series={chart.series} digits={m.digits} /> : <Empty>この指標のデータがありません</Empty>}
          {chart ? <Legend series={chart.series} /> : null}
          {/* 【この注意書きを消さないこと】平行移動を知らずにこのグラフを見ると、
              「自分のほうが低い/高い」を絶対値の差だと読んでしまう。 */}
          <div className="sans" style={noteStyle}>
            計測環境により値全体が一律にずれるため、揃えた状態で線の形で比較しています
          </div>
        </div>
      )}

      <div className="sans jp-label" style={{ ...labelStyle, paddingTop: "var(--sp-3)" }}>この条件の人の目安</div>
      {pairs.length === 0 ? (
        <Empty>{isFiltered(filter) ? "この条件に合う目安がまだありません" : "公開されている目安がまだありません"}</Empty>
      ) : (
        <div style={{ display: "grid", gap: "var(--sp-1)" }}>
          {pairs.map(({ ideal, owner }) => (
            <div key={ideal.id} style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "var(--sp-2) 0", borderBottom: "1px solid var(--c-line)" }}>
              <Avatar icon={owner.icon ?? AVATAR_ICONS[0]} color={owner.iconColor ?? AVATAR_COLOR_MIN} size={34} />
              <div style={{ flex: "1 1 0", minWidth: 0 }}>
                <div className="sans" style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--c-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ideal.name}
                  {ideal.ownerUid === myUid ? <span className="sans" style={{ marginLeft: "var(--sp-2)", fontSize: "var(--fs-xs)", color: "var(--c-accent)" }}>あなた</span> : null}
                </div>
                <div className="sans" style={noteStyle}>
                  {owner.nickname} ・ {SAX_LABELS[ideal.saxType] ?? ideal.saxType} ・ {ideal.noteKeys?.length ?? 0}音
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CapNotice count={users.length} />
    </div>
  );
}
