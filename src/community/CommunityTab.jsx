import React, { useEffect, useState } from "react";
import { getSignedInUid, ensureSignedIn, saveProfile, loadProfile, setProfilePublic, deleteAccount } from "./accountRepo.js";
import { buildProfileDoc, POSITIONS, GENRES, ENSEMBLES, PLACES, SAX_TYPES, startYearOptions } from "./profile.js";
import { searchInstrumentModels, searchMouthpieces, OTHER_BRAND } from "./catalog/gear.js";

// ------------------------------------------------------------------
// コミュニティタブ。画面は3状態: 未参加 → 登録フォーム → プロフィール表示。
//
// 【判断の中身はここに書かない】入力の妥当性は profile.js の buildProfileDoc、
// カタログの照合は catalog/gear.js だけが決める(どちらも単体テスト済み)。
// このファイルは「並べる・押す・返ってきたエラー文言を出す」だけを持つ。
// ここに if を足したくなったら、それは profile.js に置くべき規則である合図。
//
// 【見た目】新しい値を発明しない(design/DESIGN-SYSTEM.md)。色・角丸・余白・
// 文字サイズはすべて index.css のトークン(var(--c-*) / --r-* / --sp-* / --fs-*)から引く。
// 操作するものの型(§6.7)も守る:
//   ・普通のボタン・入力欄 = B型(枠なし。地は --c-sunken か、主要動作なら --c-accent の塗り)
//   ・選択中/非選択が切り替わるピル = A型(枠 --c-line-strong。選択中は枠を透明にして地だけで塗る)
// 面の作法(.card / .tile)は使わない。あれはタブの根に付いた .surf-* が決めるもので、
// このタブの根がどちらになるかは App.jsx 側(Task 9)の話だから。
// ------------------------------------------------------------------

const SAX_LABELS = { soprano: "Soprano", alto: "Alto", tenor: "Tenor", baritone: "Baritone" };

// 通信系の失敗はどれも利用者にできることが同じ(電波の良いところでやり直す)なので、
// 文言も1つにまとめる。原因の切り分け(権限/オフライン/期限切れ)を見せても操作は変わらない。
const NET_ERROR = "通信に失敗しました。電波の良いところでもう一度お試しください";
const SAVE_ERROR = "保存に失敗しました。電波の良いところでもう一度お試しください";
const TOGGLE_ERROR = "公開設定を変更できませんでした。電波の良いところでもう一度お試しください";
// 【削除の文言は「実際に起きたこと」に合わせる】
// accountRepo.deleteAccount が例外を投げるのは deleteDoc が失敗したときだけで、
// そのときはまだ何も消えていない。だから「押し直せば完了できる」と言い切ってよい。
// (deleteUser の失敗は accountRepo 側でサインアウトに落とし込んでいる。匿名ユーザーは
//  再認証できないので、押し直しを促すと永久に失敗し続ける行き止まりになるため。)
const DELETE_ERROR = "削除できませんでした。まだ何も消えていません。電波の良いところでもう一度「アカウントを削除」を押してください";
// deleteUser だけが失敗した場合(auth/requires-recent-login など)。データは消えている。
// 「消えていない」と誤解させないよう、消えたものと残ったものを分けて言う。
const DELETE_PARTIAL_NOTICE =
  "サーバー上のプロフィールは削除しました。この端末に残っていた匿名のログイン情報だけは取り消せなかったため、サインアウトしました。あなたのデータはもう残っていません。";

export default function CommunityTab() {
  const [phase, setPhase] = useState("loading"); // loading | notJoined | form | profile | error
  const [uid, setUid] = useState(null);
  const [profile, setProfile] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 削除の結果、未参加へ戻ったときに一度だけ出す説明(DELETE_PARTIAL_NOTICE)。
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let alive = true;
    setPhase("loading");
    (async () => {
      try {
        // 【ここで ensureSignedIn を呼ばない】呼ぶと「参加すると匿名のアカウントが
        // 作られます」という説明を読んでいる時点で既にアカウントが存在してしまい、
        // 覗いて去っただけの人にもアカウントが残る。同意より先に作らない。
        // 既にサインイン済みの端末では getSignedInUid が既存の uid を返すので、
        // 2回目以降の体験は変わらない(匿名セッションは端末に永続する)。
        const id = await getSignedInUid();
        if (!alive) return;
        if (!id) { setPhase("notJoined"); return; } // まだ誰でもない。作らずに説明だけ出す
        setUid(id);
        const p = await loadProfile(id);
        if (!alive) return;
        setProfile(p);
        setPhase(p ? "profile" : "notJoined");
      } catch (e) {
        if (alive) { setErrorMsg(NET_ERROR); setPhase("error"); }
      }
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  // 【匿名アカウントを作る唯一の場所】呼ばれるのは (a) 参加ボタン (b) 保存の直前 の2つだけ。
  // どちらも利用者が「参加する」と決めたあとなので、説明文と実態がずれない。
  // アカウント削除の直後は uid が null に戻るが、そこで即座にサインインし直すと
  // 「消したのに新しいアカウントができる」ので、次に参加を押すまで作らない。
  // (b) が要るのは、削除 → 参加 の流れで骨格のまま saveProfile(null, doc) を呼ぶと
  // Firestore の doc パスが壊れるため。(a) があっても保険として残す(冪等)。
  const ensureUid = async () => {
    if (uid) return uid;
    const id = await ensureSignedIn();
    setUid(id);
    return id;
  };

  if (phase === "loading") return <Centered>読み込み中…</Centered>;
  if (phase === "error") {
    return (
      <Centered>
        <div>{errorMsg}</div>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="sans" style={{ ...secondaryButtonStyle, marginTop: "var(--sp-4)", width: "auto", padding: "0 var(--sp-5)" }}>
          もう一度試す
        </button>
      </Centered>
    );
  }
  if (phase === "notJoined") {
    return (
      <JoinIntro
        notice={notice}
        onJoin={async () => {
          // ここで初めて匿名アカウントが作られる。9項目を埋めきってから
          // 「圏外でした」と分かるより、押した瞬間に失敗を見せたほうが親切。
          try {
            setNotice(null);
            await ensureUid();
            setPhase("form");
          } catch (e) {
            setErrorMsg(NET_ERROR);
            setPhase("error");
          }
        }}
      />
    );
  }
  if (phase === "form") {
    return (
      <ProfileForm
        initial={profile}
        onCancel={profile ? () => setPhase("profile") : null}
        onSubmit={async (input) => {
          const r = buildProfileDoc(input);
          if (r.error) return r.error; // フォーム側がエラー文言を表示する
          try {
            const id = await ensureUid();
            await saveProfile(id, r.doc);
          } catch (e) {
            return SAVE_ERROR; // 黙って失敗させない。フォームは開いたままにして再送できるようにする
          }
          setProfile(r.doc);
          setPhase("profile");
          return null;
        }}
      />
    );
  }
  return (
    <ProfileView
      profile={profile}
      onEdit={() => setPhase("form")}
      onTogglePublic={async (v) => {
        await setProfilePublic(uid, v); // 失敗は ProfileView が受けて文言を出す
        setProfile({ ...profile, isPublic: v });
      }}
      onDelete={async () => {
        // 例外が出るのは deleteDoc が失敗したときだけ(= まだ何も消えていない)。ProfileView が文言を出す。
        const r = await deleteAccount();
        setProfile(null); setUid(null);
        // 資格情報まで消せたかどうかで、未参加画面に出す説明を切り替える。
        setNotice(r?.credentialRemoved === false ? DELETE_PARTIAL_NOTICE : null);
        setPhase("notJoined");
      }}
    />
  );
}

// ------------------------------------------------------------------
// 共有のスタイル。値はトークンから引くだけで、新しい寸法・色は作らない。
// ------------------------------------------------------------------

const pageStyle = { padding: "var(--sp-4)", display: "grid", gap: "var(--sp-4)" };
const titleStyle = { fontSize: "var(--fs-md)", fontWeight: 700, color: "var(--c-ink)" };
const bodyStyle = { fontSize: "var(--fs-sm)", color: "var(--c-ink)", lineHeight: 1.7 };
const noteStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", lineHeight: 1.6 };
const labelStyle = { fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", fontWeight: 600 };
const errorStyle = { fontSize: "var(--fs-sm)", color: "var(--c-danger)", lineHeight: 1.6 };
const controlStyle = { width: "100%", minHeight: "var(--tap-min)", padding: "0 var(--sp-3)", fontSize: "var(--fs-sm)", color: "var(--c-ink)" };

// 主要動作(参加する・保存する)。B型 = 枠なし + 塗り。
const primaryButtonStyle = {
  width: "100%", minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)", border: "none",
  background: "var(--c-accent)", color: "var(--c-on-accent)",
  fontSize: "var(--fs-md)", fontWeight: 700, cursor: "pointer",
};
// 主要でない動作(編集する・やり直す・やめる)。B型 = 枠なし + 沈めた地。
const secondaryButtonStyle = {
  width: "100%", minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)", border: "none",
  background: "var(--c-sunken)", color: "var(--c-ink-2)",
  fontSize: "var(--fs-md)", fontWeight: 600, cursor: "pointer",
};
// 破壊的な一手。index.css の .ctl-danger と同じ考え方(枠は持たず、地と文字色だけ)。
const dangerButtonStyle = {
  width: "100%", minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)", border: "none",
  background: "var(--c-danger)", color: "var(--c-on-accent)",
  fontSize: "var(--fs-sm)", fontWeight: 700, cursor: "pointer",
};

function Centered({ children }) {
  return <div className="sans" style={{ padding: "var(--sp-6)", textAlign: "center", color: "var(--c-ink-3)", fontSize: "var(--fs-sm)", lineHeight: 1.7 }}>{children}</div>;
}

function JoinIntro({ onJoin, notice = null }) {
  const [busy, setBusy] = useState(false);
  const join = async () => {
    if (busy) return; // 二度押しで signInAnonymously が二重に走らないようにする
    setBusy(true);
    try { await onJoin(); } finally { setBusy(false); }
  };
  return (
    <div className="sans" style={pageStyle}>
      <div style={titleStyle}>コミュニティ</div>
      {notice ? <div className="sans" role="status" style={bodyStyle}>{notice}</div> : null}
      <div style={bodyStyle}>
        参加すると匿名のアカウントが作られ、他の奏者のデータが見られるようになります。
        メールアドレスなどの個人情報は公表されません。
      </div>
      {/* spec §6: 匿名のままのアカウントは機種変更・アプリ削除で失われる。この告知は本来
          アカウント連携の画面(後続の計画)に付くものだが、その画面が出来る前から
          「失われうるアカウント」は作られてしまうので、作る前のここで先に言っておく。 */}
      <div style={noteStyle}>
        匿名のアカウントはこの端末にだけ残ります。機種変更やアプリの削除で失われ、元に戻せません。
      </div>
      <button type="button" onClick={join} disabled={busy} className="sans" style={{ ...primaryButtonStyle, opacity: busy ? 0.6 : 1 }}>
        {busy ? "準備中…" : "参加してプロフィールを作る"}
      </button>
    </div>
  );
}

// 1項目 = 見出し + 中身(+ 注意書き)。フォームと表示の両方がこれを使う。
function Field({ label, note, children }) {
  return (
    <div style={{ display: "grid", gap: "var(--sp-1)" }}>
      <div className="sans jp-label" style={labelStyle}>{label}</div>
      {children}
      {note ? <div className="sans" style={noteStyle}>{note}</div> : null}
    </div>
  );
}

// 複数選べる選択肢の並び。A型(枠 = --c-line-strong)。
// 選択中は「枠を透明にして地だけで塗る」= §6.7 の芯1(枠と違う地を同時に持たない)を守る書き方。
// 見た目・寸法は App.jsx の拍のグループ選択ピルと同値(新しい値を作らない)。
function PillGroup({ options, selected, onToggle, ariaPrefix }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <button
            key={opt} type="button" onClick={() => onToggle(opt)}
            aria-pressed={on} aria-label={`${ariaPrefix} ${opt}`}
            className="sans no-select"
            style={{
              minHeight: "var(--tap-min)", padding: 0, background: "transparent", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}
          >
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: "var(--fs-sm)", padding: "var(--sp-1) var(--sp-3)", borderRadius: "var(--r-pill)",
              border: on ? "1px solid transparent" : "1px solid var(--c-line-strong)",
              background: on ? "var(--c-accent)" : "transparent",
              color: on ? "var(--c-on-accent)" : "var(--c-ink-2)",
            }}>{opt}</span>
          </button>
        );
      })}
    </div>
  );
}

// 16px の四角い箱の見た目は App.jsx の reedCheckboxStyle が持っているが、あれは
// App.jsx の内部関数なのでここからは引けない(import すると循環参照になる)。
// ネイティブの checkbox を accentColor だけ紺に寄せて使う。当たり判定は label 側の 44px。
function CheckRow({ checked, onChange, children }) {
  return (
    <label className="sans no-select" style={{ minHeight: "var(--tap-min)", display: "flex", alignItems: "center", gap: "var(--sp-2)", fontSize: "var(--fs-sm)", color: "var(--c-ink)", cursor: "pointer" }}>
      <input
        type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, flex: "0 0 auto", accentColor: "var(--c-accent)", cursor: "pointer" }}
      />
      <span>{children}</span>
    </label>
  );
}

// ------------------------------------------------------------------
// 機材の選び方。**自由入力は確定できない。**
// 検索欄に打った文字はカタログを絞るためだけに使い、値にはならない。
// 確定できるのは (a) 候補リストの1件 (b)「カタログに無い(その他)」の2通りだけなので、
// 打った文字がそのまま保存される経路が構造的に存在しない。
// (buildProfileDoc 側でも isValidInstrument / isValidMouthpiece が同じことを検査している。
//  ここは「押せないようにする」担当で、正しさの最終判断はあちら。)
// ------------------------------------------------------------------
function gearLabel(v) {
  if (!v || !v.brand) return "未選択";
  return v.model ? `${v.brand} ${v.model}` : v.brand;
}

// disabled: 検索してもカタログを引けない状態(楽器種別が未選択のとき)。
// searchInstrumentModels(q, "") は必ず空を返すので、打てるままにしておくと
// 「カタログに自分の楽器があるのに、候補が出ないので『その他』で登録する」人が出る。
// 引けないなら打たせない。
function GearPicker({ label, note, value, onPick, runSearch, placeholder, ariaPrefix, disabled = false }) {
  const [query, setQuery] = useState("");
  const results = !disabled && query.trim() ? runSearch(query).slice(0, 10) : [];

  if (value) {
    return (
      <Field label={label} note={note}>
        <div style={{ display: "flex" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "var(--sp-2)", minHeight: "var(--tap-min)",
            padding: "0 var(--sp-2) 0 var(--sp-3)", borderRadius: "var(--r-pill)",
            background: "var(--c-sunken)", color: "var(--c-ink)", fontSize: "var(--fs-sm)", fontWeight: 600,
          }}>
            {gearLabel(value)}
            <button
              type="button"
              onClick={() => { setQuery(""); onPick(null); }}
              aria-label={`${ariaPrefix}の選択を解除`}
              className="sans no-select"
              style={{
                minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", padding: 0,
                background: "transparent", border: "none", color: "var(--c-ink-3)",
                fontSize: "var(--fs-md)", lineHeight: 1, cursor: "pointer",
              }}
            >
              ✕
            </button>
          </span>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} note={note}>
      <input
        type="search" value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder} aria-label={`${ariaPrefix}を検索`}
        disabled={disabled}
        className="sans" style={{ ...controlStyle, opacity: disabled ? 0.6 : 1, cursor: disabled ? "not-allowed" : "auto" }}
      />
      {results.length > 0 && (
        <div style={{ display: "grid", gap: 0 }}>
          {results.map((r) => (
            <button
              key={`${r.brand}/${r.model}`} type="button"
              onClick={() => { setQuery(""); onPick({ brand: r.brand, model: r.model }); }}
              className="sans"
              style={{
                width: "100%", minHeight: "var(--tap-min)", padding: "0 var(--sp-3)", textAlign: "left",
                background: "transparent", border: "none", borderBottom: "1px solid var(--c-line)",
                borderRadius: 0, color: "var(--c-ink)", fontSize: "var(--fs-sm)", cursor: "pointer",
              }}
            >
              <span style={{ color: "var(--c-ink-3)" }}>{r.brand}</span> {r.model}
            </button>
          ))}
        </div>
      )}
      {/* 候補が出ていなくても常に末尾に置く。打った文字が候補ゼロだったときの逃げ道がこれ。 */}
      <button
        type="button"
        onClick={() => { setQuery(""); onPick({ brand: OTHER_BRAND, model: null }); }}
        className="sans"
        style={{ ...secondaryButtonStyle, fontSize: "var(--fs-sm)", fontWeight: 600 }}
      >
        カタログに無い(その他)
      </button>
    </Field>
  );
}

// ------------------------------------------------------------------
// 登録フォーム。自由入力はニックネームだけ。他はすべて選択。
// ------------------------------------------------------------------
function ProfileForm({ initial, onSubmit, onCancel }) {
  const g = initial?.gear ?? {};
  const [nickname, setNickname] = useState(initial?.nickname ?? "");
  const [saxType, setSaxType] = useState(initial?.saxType ?? "");
  const [position, setPosition] = useState(initial?.position ?? "");
  const [startYear, setStartYear] = useState(initial?.startYear ? String(initial.startYear) : "");
  const [genres, setGenres] = useState(initial?.genres ?? []);
  const [ensembles, setEnsembles] = useState(initial?.ensembles ?? []);
  const [places, setPlaces] = useState(initial?.places ?? []);
  const [instrument, setInstrument] = useState(g.instrumentBrand ? { brand: g.instrumentBrand, model: g.instrumentModel ?? null } : null);
  const [mouthpiece, setMouthpiece] = useState(g.mpBrand ? { brand: g.mpBrand, model: g.mpModel ?? null } : null);
  const [ageConfirmed, setAgeConfirmed] = useState(initial?.ageConfirmed === true);
  // 【モジュール直下で作らない】このアプリは PWA として何日も開きっぱなしになりうる。
  // 読み込み時に一度だけ年の一覧を作ると年をまたいだとき新年が選べない。フォームを開くたびに作る。
  const [yearOptions] = useState(() => startYearOptions());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const toggle = (list, setList) => (v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    // 【try/finally が要る理由】onSubmit が万一 reject すると busy が true のまま固まり、
    // 保存ボタンが永久に無効化される。初回登録には「やめる」が無いので、
    // タブの中で唯一の行き止まりになる。いまは親が全て catch しているので保険。
    try {
      const msg = await onSubmit({
        nickname,
        saxType,
        position,
        startYear,
        genres,
        ensembles,
        places,
        ageConfirmed,
        // 【編集のときに公開設定を巻き戻さない】buildProfileDoc の既定は「公開」なので、
        // 非公開にしていた人が編集しただけで公開に戻ってしまう。元の値を持ち回す。
        isPublic: initial ? initial.isPublic !== false : true,
        gear: {
          instrumentBrand: instrument?.brand ?? null,
          instrumentModel: instrument?.model ?? null,
          mpBrand: mouthpiece?.brand ?? null,
          mpModel: mouthpiece?.model ?? null,
        },
      });
      // 成功時は親が phase を切り替えてこの要素ごと消える。失敗時だけ文言が残る。
      setError(msg);
    } catch (e) {
      setError(SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sans" style={pageStyle}>
      <div style={titleStyle}>{initial ? "プロフィールを編集" : "プロフィールを作る"}</div>

      <Field label="ニックネーム" note="ニックネームは他の利用者に公開されます">
        <input
          type="text" value={nickname} maxLength={20}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="例: さくら" aria-label="ニックネーム"
          className="sans" style={controlStyle}
        />
      </Field>

      <Field label="楽器種別">
        <select
          value={saxType} aria-label="楽器種別"
          onChange={(e) => {
            setSaxType(e.target.value);
            // 種別が変わるとカタログの範囲も変わる(アルトの YAS-62 はテナーには無い)。
            // 選び直させないと保存の瞬間に「楽器がカタログにありません」で弾かれる。
            setInstrument(null);
          }}
          className="sans" style={controlStyle}
        >
          <option value="">選んでください</option>
          {SAX_TYPES.map((t) => <option key={t} value={t}>{SAX_LABELS[t]}</option>)}
        </select>
      </Field>

      <GearPicker
        label="楽器" ariaPrefix="楽器"
        /* 【「選ばなければその他」とは書かない】未選択(null)と「その他」は別の値として
           保存されるようになった(profile.js / gear.js)。ここで嘘の案内をすると、
           自分では何も選んでいない人が「その他を選んだ」と思い込む。 */
        note={saxType
          ? "型番かメーカー名(カタカナ可)で探せます。選ばなくても登録できます"
          : "カタログは楽器種別ごとに分かれています。先に楽器種別を選んでください"}
        value={instrument} onPick={setInstrument}
        disabled={!saxType}
        runSearch={(q) => searchInstrumentModels(q, saxType)}
        placeholder={saxType ? "例: YAS-62 / ヤマハ" : "先に楽器種別を選んでください"}
      />

      <GearPicker
        label="マウスピース" ariaPrefix="マウスピース"
        note="型番かメーカー名(カタカナ可)で探せます。選ばなくても登録できます"
        value={mouthpiece} onPick={setMouthpiece}
        runSearch={(q) => searchMouthpieces(q)}
        placeholder="例: S80 C* / メイヤー"
      />

      <Field label="立場">
        <select value={position} onChange={(e) => setPosition(e.target.value)} aria-label="立場" className="sans" style={controlStyle}>
          <option value="">選んでください</option>
          {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>

      <Field label="演奏開始年">
        <select value={startYear} onChange={(e) => setStartYear(e.target.value)} aria-label="演奏開始年" className="sans" style={controlStyle}>
          <option value="">選んでください</option>
          {yearOptions.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
      </Field>

      <Field label="ジャンル(複数選べます)">
        <PillGroup options={GENRES} selected={genres} onToggle={toggle(genres, setGenres)} ariaPrefix="ジャンル" />
      </Field>

      <Field label="編成(複数選べます)">
        <PillGroup options={ENSEMBLES} selected={ensembles} onToggle={toggle(ensembles, setEnsembles)} ariaPrefix="編成" />
      </Field>

      <Field label="練習場所(複数選べます)">
        <PillGroup options={PLACES} selected={places} onToggle={toggle(places, setPlaces)} ariaPrefix="練習場所" />
      </Field>

      <CheckRow checked={ageConfirmed} onChange={setAgeConfirmed}>13歳以上です</CheckRow>

      {error ? <div className="sans" role="alert" style={errorStyle}>{error}</div> : null}

      <button type="button" onClick={submit} disabled={busy} className="sans" style={{ ...primaryButtonStyle, opacity: busy ? 0.6 : 1 }}>
        {busy ? "保存中…" : "保存する"}
      </button>
      {onCancel ? (
        <button type="button" onClick={onCancel} disabled={busy} className="sans" style={secondaryButtonStyle}>
          やめる
        </button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------
// プロフィール表示。登録内容の一覧 + 公開トグル + 編集 + アカウント削除。
// ------------------------------------------------------------------
function Row({ label, value }) {
  return (
    <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "baseline", padding: "var(--sp-2) 0", borderBottom: "1px solid var(--c-line)" }}>
      <div className="sans jp-label" style={{ ...labelStyle, flex: "0 0 6.5em" }}>{label}</div>
      <div className="sans" style={{ ...bodyStyle, flex: "1 1 0", minWidth: 0 }}>{value}</div>
    </div>
  );
}

const listOrDash = (a) => (Array.isArray(a) && a.length > 0 ? a.join("・") : "—");

function ProfileView({ profile, onEdit, onTogglePublic, onDelete }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const gear = profile?.gear ?? {};
  const isPublic = profile?.isPublic !== false;

  const togglePublic = async (v) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await onTogglePublic(v);
    } catch (e) {
      // profile.isPublic は成功したときしか動かないので、チェックの見た目は自動で元に戻る
      setError(TOGGLE_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    // 【この一手で消えるものと消えないものを、押す前に言い切る】
    // 計測データは端末内にあり、このアカウントとは別物。混同したまま消させない。
    const ok = window.confirm("アカウントとサーバー上のプロフィールを完全に削除します。この端末の計測データは消えません。よろしいですか？");
    if (!ok) return;
    setBusy(true); setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(DELETE_ERROR); // ボタンは残るので、そのまま押し直せる
      setBusy(false);
    }
    // 成功時はこの要素ごと消えるので busy は戻さない(戻す先が無い)
  };

  return (
    <div className="sans" style={pageStyle}>
      <div style={titleStyle}>プロフィール</div>

      <div>
        <Row label="ニックネーム" value={profile?.nickname ?? "—"} />
        <Row label="楽器種別" value={SAX_LABELS[profile?.saxType] ?? "—"} />
        <Row label="楽器" value={gearLabel({ brand: gear.instrumentBrand, model: gear.instrumentModel })} />
        <Row label="マウスピース" value={gearLabel({ brand: gear.mpBrand, model: gear.mpModel })} />
        <Row label="立場" value={profile?.position ?? "—"} />
        <Row label="演奏開始年" value={profile?.startYear ? `${profile.startYear}年` : "—"} />
        <Row label="ジャンル" value={listOrDash(profile?.genres)} />
        <Row label="編成" value={listOrDash(profile?.ensembles)} />
        <Row label="練習場所" value={listOrDash(profile?.places)} />
      </div>

      <div style={{ display: "grid", gap: "var(--sp-1)" }}>
        <CheckRow checked={isPublic} onChange={togglePublic}>公開する</CheckRow>
        <div className="sans" style={noteStyle}>ONにすると他の利用者から見えます</div>
      </div>

      {error ? <div className="sans" role="alert" style={errorStyle}>{error}</div> : null}

      <button type="button" onClick={onEdit} disabled={busy} className="sans" style={secondaryButtonStyle}>
        編集
      </button>

      <div style={{ display: "grid", gap: "var(--sp-2)", marginTop: "var(--sp-4)" }}>
        <div className="sans" style={noteStyle}>
          アカウントを削除すると、サーバー上のプロフィールと匿名アカウントが完全に消えます。
          この端末に保存されている計測データは消えません。
        </div>
        <button type="button" onClick={remove} disabled={busy} className="sans" style={{ ...dangerButtonStyle, opacity: busy ? 0.6 : 1 }}>
          アカウントを削除
        </button>
      </div>
    </div>
  );
}
