import React, { useEffect, useMemo, useState } from "react";
import { getSignedInUid, ensureSignedIn, saveProfile, loadProfile, setProfilePublic, deleteAccount } from "./accountRepo.js";
import { FirebaseConfigMissingError } from "./firebaseClient.js";
import { buildProfileDoc, POSITIONS, GENRES, ENSEMBLES, PLACES, SAX_TYPES, SAX_LABELS, startYearOptions, AVATAR_ICONS, AVATAR_COLOR_MIN, AVATAR_COLOR_MAX } from "./profile.js";
import { AvatarSprite, Avatar } from "./icons.jsx";
import { RankScreen, ShareScreen, DataScreen, PersonSheet, usePublicUsers } from "./screens.jsx";
import { listIdeals, buildMyIdeals, publishMyIdeals } from "./idealRepo.js";
import { buildIdealProfileFromSessions } from "../App.jsx";
import { publishStats } from "./directory.js";
import { computePracticeStats } from "./stats.js";
import { searchInstrumentModels, searchMouthpieces, searchLigatures, searchReeds, OTHER_BRAND } from "./catalog/gear.js";

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

// SAX_LABELS は profile.js が持つ(機材の照合エラーが「どの楽器の話か」を言うために
// あちら側でも要る)。写しを2つ置かない。

// 通信系の失敗はどれも利用者にできることが同じ(電波の良いところでやり直す)なので、
// 文言も1つにまとめる。原因の切り分け(権限/オフライン/期限切れ)を見せても操作は変わらない。
const NET_ERROR = "通信に失敗しました。電波の良いところでもう一度お試しください";
// 【設定の欠落は通信の失敗と分ける】接続設定が読み込めていない状態は待っても直らない。
// 「電波の良いところで」と案内すると、利用者を無駄に待たせたうえ原因も伝わらない。
// この配信をビルドした環境に VITE_FIREBASE_* が無いことが原因なので、
// 利用者の操作では解決できない。そう分かる文言にする。
const CONFIG_ERROR = "この配信ではコミュニティを利用できません（アプリの接続設定が読み込めていません）";
// 失敗の種類で文言を選ぶ。ここ以外で NET_ERROR を直に使わない。
const connectErrorOf = (e) => (e instanceof FirebaseConfigMissingError ? CONFIG_ERROR : NET_ERROR);
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

// 【スプライトはここに1つだけ置く】<use href="#ic-..."> は同じ文書の中にある
// <symbol> を参照する。アイコンを出す画面ごとに置くと、同じ id が複数現れたときに
// どれが引かれるかが不定になる。中身を別の関数に分け、外側で1回だけ描く。
export default function CommunityTab({ sessions, tuningHz }) {
  return (
    <>
      <AvatarSprite />
      <CommunityTabBody sessions={sessions} tuningHz={tuningHz} />
    </>
  );
}

// 子タブ。マイページは「自分のこと」、他の3つは「他人のこと」。
const SUB_TABS = [
  { key: "data", label: "データ" },
  { key: "rank", label: "順位" },
  { key: "share", label: "シェア" },
  { key: "me", label: "マイページ" },
];

function SubTabs({ value, onChange }) {
  return (
    <div role="tablist" aria-label="コミュニティの表示" style={{
      display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: "var(--sp-1)", padding: "var(--sp-3) var(--sp-4) 0",
    }}>
      {SUB_TABS.map((t) => (
        <button
          key={t.key} type="button" role="tab" aria-selected={t.key === value}
          onClick={() => onChange(t.key)} className="sans no-select"
          style={{
            minHeight: "var(--tap-min)", border: "none", borderRadius: "var(--r-md)",
            background: t.key === value ? "var(--c-accent)" : "transparent",
            color: t.key === value ? "var(--c-on-accent)" : "var(--c-ink-2)",
            fontSize: "var(--fs-sm)", fontWeight: 600, cursor: "pointer",
          }}
        >{t.label}</button>
      ))}
    </div>
  );
}

// 参加済みの人に見せる画面。子タブで4つを切り替える。
function JoinedView({ profile, uid, sessions, tuningHz, onEdit, onTogglePublic, onDelete }) {
  const [tab, setTab] = useState("data");
  // タップされた人。**子タブとは別に持つ** ── 開いたまま子タブを切り替えられると、
  // 下の画面が変わったのに上に別人の紹介が乗っている、という状態になる。
  const [person, setPerson] = useState(null);
  // 【公開ユーザーは1度だけ読む】タブを切り替えるたびに読み直さない。
  // 読み取り回数は費用そのもので、利用者数の2乗で増える(設計書の決定1-b)。
  const dir = usePublicUsers();

  // 【自分の目安を種別ごとに作る】公開するものと、データ画面で自分の線として
  // 描くものは**同じ値**にする。別々に作ると、公開した値と画面の値が食い違う。
  // 平均の作り方は計測タブと同じ関数(buildIdealProfileFromSessions)を使う。
  const myIdeals = useMemo(() => buildMyIdeals({
    sessions, saxTypes: profile?.saxTypes ?? [], tuningHz, buildProfile: buildIdealProfileFromSessions,
  }), [sessions, profile?.saxTypes, tuningHz]);
  // 目安も1度だけ読む。データタブを開くまで読まないのではなく、
  // 公開ユーザーと同じ1回で済ませる(タブを行き来しても読み直さない)。
  const [ideals, setIdeals] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await listIdeals();
        if (alive) setIdeals(list);
      } catch (e) {
        if (alive) setIdeals([]); // 読めなくても順位とシェアは見せる
      }
    })();
    return () => { alive = false; };
  }, []);

  // 【練習日数はタブを開いたときに1度だけ書く】練習のたびには書かない。
  // 書き込み回数が無駄に増えるだけで、順位は開いて見るものなので即時性が要らない。
  //
  // **失敗しても黙って諦める。** これは本人の操作ではなく副次的な更新なので、
  // 順位が1日古いだけの話に対してエラーを出しても、利用者にできることが無い。
  // (プロフィールの保存は本人の操作なので、あちらは必ず文言を出す。)
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    (async () => {
      try {
        const stats = computePracticeStats(sessions ?? []);
        if (alive) await publishStats(uid, stats);
      } catch (e) { /* 順位が古いままになるだけ。利用者に見せる意味が無い */ }
      // 【目安も同じ機会に公開する】目安は「選んで出すもの」ではなく、
      // 登録した楽器種別ごとの自分の平均が1つあるだけ(2026-09-03 本人裁定)。
      // したがって公開ボタンは無く、練習日数と同じくタブを開いたときに更新する。
      try {
        if (alive && Array.isArray(profile?.saxTypes)) {
          await publishMyIdeals(uid, myIdeals);
        }
      } catch (e) { /* 同上。1種別も出せなくても他の画面は見られる */ }
    })();
    return () => { alive = false; };
    // sessions を依存に入れない ── 録音のたびに書き直すことになる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const body = () => {
    if (tab === "me") {
      return <ProfileView profile={profile} onEdit={onEdit} onTogglePublic={onTogglePublic} onDelete={onDelete} />;
    }
    if (dir.phase === "loading") return <Centered>読み込み中…</Centered>;
    if (dir.phase === "error") return <Centered>{dir.error}</Centered>;
    if (tab === "rank") return <RankScreen users={dir.users} myUid={uid} onOpenPerson={setPerson} />;
    if (tab === "share") return <ShareScreen users={dir.users} />;
    if (ideals === null) return <Centered>読み込み中…</Centered>;
    return <DataScreen users={dir.users} ideals={ideals} myIdeals={myIdeals} myUid={uid} saxTypes={profile?.saxTypes ?? []} onOpenPerson={setPerson} />;
  };

  return (
    <div>
      <SubTabs value={tab} onChange={(t) => { setPerson(null); setTab(t); }} />
      {body()}
      {person ? (
        <PersonSheet
          person={person}
          ideals={ideals ?? []}
          myIdeals={myIdeals}
          onClose={() => setPerson(null)}
        />
      ) : null}
    </div>
  );
}

function CommunityTabBody({ sessions, tuningHz }) {
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
        if (alive) { setErrorMsg(connectErrorOf(e)); setPhase("error"); }
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
        {/* 【設定の欠落では再試行を出さない】押しても同じ結果にしかならないボタンは、
            利用者に「自分の操作で直せる」と誤解させたうえで裏切る。通信の失敗のときだけ出す。 */}
        {errorMsg !== CONFIG_ERROR && (
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="sans" style={{ ...secondaryButtonStyle, marginTop: "var(--sp-4)", width: "auto", padding: "0 var(--sp-5)" }}>
            もう一度試す
          </button>
        )}
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
            setErrorMsg(connectErrorOf(e));
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
    <JoinedView
      profile={profile}
      uid={uid}
      sessions={sessions}
      tuningHz={tuningHz}
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
// 楽器種別ごとの機材のまとまりの頭。項目の見出し(labelStyle)より一段濃いだけで、
// 新しい寸法・色は作らない(--fs-sm と --c-ink はどちらも既存のトークン)。
const gearHeadingStyle = { fontSize: "var(--fs-sm)", color: "var(--c-ink)", fontWeight: 700 };
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
// labelOf: 保存する値と画面に出す文字が違うとき(楽器種別は値 "alto" / 表示 "Alto")に渡す。
// 既定は「値をそのまま出す」なので、既存の呼び手(ジャンル・編成・練習場所)は書き換え不要。
function PillGroup({ options, selected, onToggle, ariaPrefix, labelOf = (v) => v }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-2)" }}>
      {options.map((opt) => {
        const on = selected.includes(opt);
        const text = labelOf(opt);
        return (
          <button
            key={opt} type="button" onClick={() => onToggle(opt)}
            aria-pressed={on} aria-label={`${ariaPrefix} ${text}`}
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
            }}>{text}</span>
          </button>
        );
      })}
    </div>
  );
}

// 16px の四角い箱の見た目は App.jsx の reedCheckboxStyle が持っているが、あれは
// App.jsx の内部関数なのでここからは引けない(import すると循環参照になる)。
// ネイティブの checkbox を accentColor だけ紺に寄せて使う。当たり判定は label 側の 44px。
// 公開の切替はスイッチ。**チェックボックスとは役割が違う。**
// チェックボックスは「保存ボタンを押したときに効く申告」(この画面では「13歳以上です」)、
// スイッチは「触った瞬間に効く設定」。公開の切替は押すとその場で Firestore へ書きに行くので、
// 保存を待つ見た目にすると、切ったつもりで切れていない誤解を生む。
// 寸法は design/community-tab-proposals.html の .tog に合わせた(軌道 44x26 / つまみ 20)。
// 当たり判定は軌道ではなくボタン側の 44px 角で確保する(軌道は 26px しかなく単独では足りない)。
function SwitchRow({ checked, onChange, disabled = false, label, note }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-3)" }}>
      <div style={{ display: "grid", gap: "var(--sp-1)", minWidth: 0 }}>
        <div className="sans" style={{ fontSize: "var(--fs-sm)", fontWeight: 700, color: "var(--c-ink)" }}>{label}</div>
        {note ? <div className="sans" style={noteStyle}>{note}</div> : null}
      </div>
      <button
        type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
        onClick={() => onChange(!checked)}
        className="no-select"
        style={{
          flex: "0 0 auto", width: "var(--tap-min)", minHeight: "var(--tap-min)", padding: 0,
          background: "transparent", border: "none", cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <span style={{
          display: "block", width: 44, height: 26, borderRadius: "var(--r-pill)", position: "relative",
          // 【OFF の軌道に --c-line を使わない】あれは白地との差が 1.1:1 しかなく、
          // 白いつまみが軌道に溶けて**OFF のときスイッチが消えて見える**。
          // --c-line-strong(#C3CAD3 / 白地と 1.65:1)は設計システムが
          // 「入力欄・丸ボタンの枠」に充てている段で、つまみの輪郭が出る。新しい値は作らない。
          background: checked ? "var(--c-accent)" : "var(--c-line-strong)", transition: "background 120ms ease",
        }}>
          <span style={{
            position: "absolute", top: 3, left: checked ? 21 : 3, width: 20, height: 20,
            borderRadius: "50%", background: "#fff", transition: "left 120ms ease",
            boxShadow: "0 1px 2px rgba(0,0,0,.2)",
          }} />
        </span>
      </button>
    </div>
  );
}

// 絵柄と地の色を選ぶ。**上に実物大の1つを出す。**
// 画面案の初期の版は上部の見本が横長で、実際にどう見えるか分からなかった
// (2026-08-28 本人指摘)。選んだ結果そのものを、順位や一覧で出るのと同じ大きさで見せる。
function AvatarPicker({ icon, color, onChange }) {
  const cell = (selected) => ({
    minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", padding: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: selected ? "var(--c-accent-tint)" : "transparent",
    border: "none", borderRadius: "var(--r-md)", cursor: "pointer",
  });
  return (
    <div style={{ display: "grid", gap: "var(--sp-3)" }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Avatar icon={icon} color={color} size={64} />
      </div>

      <div className="sans jp-label" style={labelStyle}>絵柄</div>
      {/* 【列は minmax(0, 1fr) にする】`1fr` の最小値は auto なので、
          中の当たり判定(44px)がそのまま列の下限になり、**格子が画面より広くなる**。
          親は grid なので、広がった子は兄弟もろともページ全体を押し広げる
          (実際にこれで色の行が476pxになり、375pxの画面でニックネーム欄まで画面外へ出た)。
          minmax(0, ...) にすると列は0まで縮められるので、はみ出しがページに伝播しない。 */}
      <div role="radiogroup" aria-label="アイコンの絵柄" style={{
        display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "var(--sp-1)",
      }}>
        {AVATAR_ICONS.map((id) => (
          <button
            key={id} type="button" role="radio" aria-checked={id === icon}
            aria-label={id.replace(/^ic-/, "")}
            onClick={() => onChange({ icon: id, color })}
            style={cell(id === icon)}
          >
            {/* 一覧の中は選択の判別が要るだけなので、地の色は付けず絵柄だけを出す。
                地の色まで付けると24個ぶん色が散り、いま選んでいるものが埋もれる。 */}
            <svg width={24} height={24} fill="var(--c-ink)" aria-hidden="true">
              <use href={`#${id}`} />
            </svg>
          </button>
        ))}
      </div>

      <div className="sans jp-label" style={labelStyle}>地の色</div>
      {/* 【10色を1行に並べない】当たり判定は44px角を割れないので、10列だと
          10*44 + 隙間9*4 = 476px 必要になる。375px の端末で使える幅は
          375 - 左右の余白32 = 343px しかない。**5列2段にすると 5*44 + 4*4 = 236px で収まる。**
          「列を狭くして1行に収める」は当たり判定を割るので採らない。 */}
      <div role="radiogroup" aria-label="アイコンの地の色" style={{
        display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "var(--sp-1)",
      }}>
        {Array.from({ length: AVATAR_COLOR_MAX - AVATAR_COLOR_MIN + 1 }, (_, i) => i + AVATAR_COLOR_MIN).map((n) => (
          <button
            key={n} type="button" role="radio" aria-checked={n === color}
            aria-label={`色 ${n}`}
            onClick={() => onChange({ icon, color: n })}
            style={cell(n === color)}
          >
            <span style={{
              display: "block", width: 24, height: 24, borderRadius: "50%",
              background: `var(--c-avatar-${n})`,
              // 選択中は輪で示す。**地の色そのものを変えない** ── 見本と食い違う。
              boxShadow: n === color ? "0 0 0 2px var(--c-surface), 0 0 0 4px var(--c-accent)" : "none",
            }} />
          </button>
        ))}
      </div>
    </div>
  );
}

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
function GearPicker({ label, note, value, onPick, runSearch, ariaPrefix, disabled = false }) {
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
        aria-label={`${ariaPrefix}を検索`}
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
// 保存されている機材1組(6キー)を、画面が持つ形(3つの選択)へ開く。
// 【保存の形と画面の形の対応づけは、この2つの関数だけが持つ】
// 機材の欄を1つ足すたびに、直す場所は (a) 読み込み (b) 空の初期値 (c) 書き出し の3つある。
// 実際にリードを足したとき (b) と (c) を忘れ、**選んでも保存されない**状態になった。
// 必須の欄でこれが起きると、利用者から見て「正しく選んでいるのに永久に登録できない」。
// 対応づけを関数に閉じ込め、picksToGearEntry の出力が仕様の8キーと一致することを
// community-form.test.js で検査している。
const gearEntryToPicks = (g = {}) => ({
  instrument: g.instrumentBrand ? { brand: g.instrumentBrand, model: g.instrumentModel ?? null } : null,
  mouthpiece: g.mpBrand ? { brand: g.mpBrand, model: g.mpModel ?? null } : null,
  ligature: g.ligBrand ? { brand: g.ligBrand, model: g.ligModel ?? null } : null,
  reed: g.reedBrand ? { brand: g.reedBrand, model: g.reedModel ?? null } : null,
});
export const EMPTY_PICKS = { instrument: null, mouthpiece: null, ligature: null, reed: null };
export const picksToGearEntry = (p = EMPTY_PICKS) => ({
  instrumentBrand: p.instrument?.brand ?? null,
  instrumentModel: p.instrument?.model ?? null,
  mpBrand: p.mouthpiece?.brand ?? null,
  mpModel: p.mouthpiece?.model ?? null,
  ligBrand: p.ligature?.brand ?? null,
  ligModel: p.ligature?.model ?? null,
  reedBrand: p.reed?.brand ?? null,
  reedModel: p.reed?.model ?? null,
});

function ProfileForm({ initial, onSubmit, onCancel }) {
  const [nickname, setNickname] = useState(initial?.nickname ?? "");
  // 【既定を選んだ状態で出す】アイコンは必須なので、未選択で始めると
  // 「何も触っていないのに保存できない」になる。初期値は一覧の先頭と色1。
  const [icon, setIcon] = useState(initial?.icon ?? AVATAR_ICONS[0]);
  const [iconColor, setIconColor] = useState(initial?.iconColor ?? AVATAR_COLOR_MIN);
  const [position, setPosition] = useState(initial?.position ?? "");
  const [startYear, setStartYear] = useState(initial?.startYear ? String(initial.startYear) : "");
  const [genres, setGenres] = useState(initial?.genres ?? []);
  const [ensembles, setEnsembles] = useState(initial?.ensembles ?? []);
  const [places, setPlaces] = useState(initial?.places ?? []);
  // 【楽器種別と機材を2つの state に分けない】掛け持ちの奏者が居るので楽器種別は複数だが、
  // 「選んだ種別」と「その機材」を別々の state に持つと、両方を1つの操作で更新するときに
  // 片方が古い値を読んで**キー集合がずれる**(gear.keys() ≠ saxTypes → 保存が弾かれる)。
  // そこで持つのは機材の側だけにして、**選んだ種別はそのキーから導く**。
  // 集合の一致が構造的に崩せなくなり、「外したら機材も捨てる」も delete 1つで済む。
  const [gearPicks, setGearPicks] = useState(() => {
    const src = initial?.gear ?? {};
    const out = {};
    for (const t of SAX_TYPES) if ((initial?.saxTypes ?? []).includes(t)) out[t] = gearEntryToPicks(src[t]);
    return out;
  });
  // 値は SAX_TYPES の並び順(保存されている順に依らず、画面も doc も同じ並びになる)。
  const saxTypes = SAX_TYPES.filter((t) => Object.prototype.hasOwnProperty.call(gearPicks, t));
  const [ageConfirmed, setAgeConfirmed] = useState(initial?.ageConfirmed === true);
  // 【モジュール直下で作らない】このアプリは PWA として何日も開きっぱなしになりうる。
  // 読み込み時に一度だけ年の一覧を作ると年をまたいだとき新年が選べない。フォームを開くたびに作る。
  const [yearOptions] = useState(() => startYearOptions());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const toggle = (list, setList) => (v) => setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // 【外したら機材の入力状態も捨てる】キーを消すことが「種別を外す」ことそのものなので、
  // 入力状態が取り残される経路が無い(残ると gear のキーが saxTypes より多くなり、
  // buildProfileDoc と Firestore ルールの「完全一致」に弾かれて保存できなくなる。
  // しかも弾かれる理由が画面に出ていない機材なので、利用者からは直しようがない)。
  const toggleSaxType = (t) => {
    setGearPicks((prev) => {
      if (Object.prototype.hasOwnProperty.call(prev, t)) { const next = { ...prev }; delete next[t]; return next; }
      return { ...prev, [t]: EMPTY_PICKS };
    });
  };
  const setPick = (t, slot, v) => setGearPicks((prev) => ({ ...prev, [t]: { ...(prev[t] ?? EMPTY_PICKS), [slot]: v } }));

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
        icon,
        iconColor,
        saxTypes,
        position,
        startYear,
        genres,
        ensembles,
        places,
        ageConfirmed,
        // 【編集のときに公開設定を巻き戻さない】buildProfileDoc の既定は「公開」なので、
        // 非公開にしていた人が編集しただけで公開に戻ってしまう。元の値を持ち回す。
        isPublic: initial ? initial.isPublic !== false : true,
        // gear のキーは saxTypes からしか作らない。gearPicks に取り残しがあっても混ざらない。
        gear: Object.fromEntries(saxTypes.map((t) => {
          return [t, picksToGearEntry(gearPicks[t])];
        })),
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
          aria-label="ニックネーム"
          className="sans" style={controlStyle}
        />
      </Field>

      <Field label="アイコン" note="順位や一覧であなたを表す絵柄です">
        <AvatarPicker icon={icon} color={iconColor} onChange={(v) => { setIcon(v.icon); setIconColor(v.color); }} />
      </Field>

      <Field label="楽器種別(複数選べます)" note="吹く楽器をすべて選んでください。機材は選んだ楽器ごとに登録します">
        <PillGroup
          options={SAX_TYPES} selected={saxTypes} onToggle={toggleSaxType}
          ariaPrefix="楽器種別" labelOf={(t) => SAX_LABELS[t]}
        />
      </Field>

      {saxTypes.length === 0 ? (
        // カタログは楽器種別ごとに分かれているので、種別が決まるまで楽器は引けない。
        // 引けない検索欄を出すより、何をすれば出るかだけを言う。
        <div className="sans" style={noteStyle}>楽器種別を選ぶと、機材の欄が種別ごとに出ます</div>
      ) : null}

      {saxTypes.map((t) => (
        <div key={t} style={{ display: "grid", gap: "var(--sp-4)" }}>
          <div className="sans jp-label" style={gearHeadingStyle}>{SAX_LABELS[t]} の機材</div>
          <GearPicker
            label="楽器" ariaPrefix={`${SAX_LABELS[t]}の楽器`}
            /* 【2026-09-02 本人裁定で補助文を削除】以前ここには探し方と
               「選ばなくても登録できます」が出ていた。後者は必須化で嘘になったので消し、
               前者も併せて落とした。**代わりの案内を足さないこと。**
               打つ手が分からない人の逃げ道は、常に見えている「カタログに無い(その他)」の
               ボタンが担っている(下の runSearch の結果が0件でも消えない)。 */
            value={gearPicks[t]?.instrument ?? null} onPick={(v) => setPick(t, "instrument", v)}
            /* カタログは種別ごとに分かれている(アルトの YAS-62 はテナーには無い)ので、
               この欄の種別をそのまま渡す。渡し違えると保存の瞬間に弾かれる。 */
            runSearch={(q) => searchInstrumentModels(q, t)}
          />
          <GearPicker
            label="マウスピース" ariaPrefix={`${SAX_LABELS[t]}のマウスピース`}
            value={gearPicks[t]?.mouthpiece ?? null} onPick={(v) => setPick(t, "mouthpiece", v)}
            runSearch={(q) => searchMouthpieces(q)}
          />
          <GearPicker
            label="リガチャー" ariaPrefix={`${SAX_LABELS[t]}のリガチャー`}
            value={gearPicks[t]?.ligature ?? null} onPick={(v) => setPick(t, "ligature", v)}
            runSearch={(q) => searchLigatures(q)}
          />
          {/* 【リードに番手の欄を置かない】番手はリードタブ(App.jsx)が箱ごとに持っていて、
              同じ銘柄でも日によって変わる。ここは機材の一覧なので銘柄だけを持つ。 */}
          <GearPicker
            label="リード" ariaPrefix={`${SAX_LABELS[t]}のリード`}
            value={gearPicks[t]?.reed ?? null} onPick={(v) => setPick(t, "reed", v)}
            runSearch={(q) => searchReeds(q)}
          />
        </div>
      ))}

      <Field label="属性">
        <select value={position} onChange={(e) => setPosition(e.target.value)} aria-label="属性" className="sans" style={controlStyle}>
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
  // 表示順は SAX_TYPES の並びに揃える(保存されている配列の順に依らず同じ画面になる)。
  const types = SAX_TYPES.filter((t) => (profile?.saxTypes ?? []).includes(t));
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

      {/* 名前より先にアイコンを出す。順位や一覧では絵柄で人を探すので、
          自分がどう見えているかが最初に分かるようにする。 */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Avatar icon={profile?.icon ?? AVATAR_ICONS[0]} color={profile?.iconColor ?? AVATAR_COLOR_MIN} size={64} />
      </div>

      <div>
        <Row label="ニックネーム" value={profile?.nickname ?? "—"} />
        <Row label="楽器種別" value={types.length > 0 ? types.map((t) => SAX_LABELS[t]).join("・") : "—"} />
        {/* 機材は楽器種別ごとに1組。どの楽器の機材かが分からないと読めないので、
            種別の見出しを挟んでから3行を出す。 */}
        {types.map((t) => {
          const g = gear[t] ?? {};
          return (
            <React.Fragment key={t}>
              <div className="sans jp-label" style={{ ...gearHeadingStyle, padding: "var(--sp-3) 0 var(--sp-1)" }}>{SAX_LABELS[t]}</div>
              <Row label="楽器" value={gearLabel({ brand: g.instrumentBrand, model: g.instrumentModel })} />
              <Row label="マウスピース" value={gearLabel({ brand: g.mpBrand, model: g.mpModel })} />
              <Row label="リガチャー" value={gearLabel({ brand: g.ligBrand, model: g.ligModel })} />
              <Row label="リード" value={gearLabel({ brand: g.reedBrand, model: g.reedModel })} />
            </React.Fragment>
          );
        })}
        <Row label="属性" value={profile?.position ?? "—"} />
        <Row label="演奏開始年" value={profile?.startYear ? `${profile.startYear}年` : "—"} />
        <Row label="ジャンル" value={listOrDash(profile?.genres)} />
        <Row label="編成" value={listOrDash(profile?.ensembles)} />
        <Row label="練習場所" value={listOrDash(profile?.places)} />
      </div>

      <SwitchRow
        checked={isPublic} onChange={togglePublic} disabled={busy}
        label="公開する"
        note="既定は公開です。OFFにすると他の利用者から見えなくなります"
      />

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
