import {
  avatarPathOf, avatarPrefixOf, downloadUrlOf, pathOfDownloadUrl, photoKindOf, safeSearchVerdict,
  stripJpegMetadata, PHOTO_MIME_JPEG,
  shouldDropPhoto, uploadAcceptable, uploadPathOf,
  isOlderPhoto, shouldRevokePhotoUrl, tokenOfDownloadUrl, uploadOrderOf, photoTimeOf,
} from "./avatarVerdict.js";

// ------------------------------------------------------------------
// 写真の仕事の**中身**。Firebase も Vision も import しない ──
// 触るものはすべて引数(deps)で受け取る。
//
// 【なぜ index.js から出したか ── 2026-09-23 審査役の指摘】
// index.js は firebase-functions を import するので、`node_modules` を入れない限り
// **1行も走らせられない**。走らせられないコードは、綴りの検査でしか守れない。
// 審査役の変異(`deleteFiles` を `if (false)` で殺す)が生き残ったのはそのためである。
// 触る相手を引数にすれば、作り物を渡して**実際に走らせて**確かめられる。
// index.js は本物の道具をここへ渡すだけの配線になる。
// ------------------------------------------------------------------

/** 呼び出し側(index.js)が HttpsError へ翻訳するための種別つきの失敗。 */
export function photoError(kind, reason) {
  // 【便BH 再審査】superseded(判定の途中で写真が外された)は通信の失敗とも判定の失敗とも別の種別。
  // 端末は文言を出さない(本人が絵柄に戻したのなら、それが本人の意思なので)。
  const head = kind === "unavailable" ? "photo-unavailable" : kind === "superseded" ? "photo-superseded" : "photo-rejected";
  const e = new Error(`${head}: ${reason}`);
  e.kind = kind;
  e.reason = reason;
  return e;
}

/**
 * 上がってきた写真を判定し、通ったら Storage と users に書く。
 *
 * 【重1 の要 ── バイト列は1度しか読まない(2026-09-23 審査役の指摘)】
 * 以前は「Vision には gs:// のアドレスを渡し、保存は `copy` で写す」形だった。
 * どちらも**その時点の最新世代**を別々の時刻に読むので、
 *   無害な画像を上げる → これを呼ぶ → 呼んだ直後に同じ場所を差し替える
 * で、判定は前の画像・保存は後の画像になり得た(TOCTOU)。
 * storage.rules は置き場への上書きを何度でも許しているので、実際に起こせる。
 *
 * **いまは `download` で1度だけ読み、その同じバッファを判定にも保存にも使う。**
 * 読んだあとに置き場が何度差し替えられても、載るのは判定したそのバイト列だけになる。
 * 「判定を通っていない写真が載る経路が構造上存在しない」(決定6)はこれで成立する。
 */
export async function runVetAvatarPhoto({ uid }, deps) {
  if (!uid) throw photoError("unauthenticated", "no-uid");
  // 【便BH 差し戻し(不合格1)】置き場の時刻が取れなかったときの物差し。**読み込みと判定より前**に取る
  // (判定の速さで順が入れ替わらないように)。
  const enteredAt = deps.now();
  const src = uploadPathOf(uid);

  if (!(await deps.exists(src))) throw photoError("rejected", "no-upload");

  const meta = await deps.getMetadata(src);
  // 【便BH 差し戻し(不合格1)】新旧の物差しは「上げた順」= 置き場の実体が作られた時刻と世代。
  const order = uploadOrderOf(meta, enteredAt);
  // 【便BH 差し戻し】置き場を消すのは**自分が読んだ世代のときだけ**。読んだあとに別のタブが
  // 上げ直していたら、それはその判定が使う物なので消さない(世代が分からなければ今までどおり消す)。
  const removeSrc = () => deps.remove(src, order.gen === "0" ? undefined : { ifGenerationMatch: order.gen });
  const form = uploadAcceptable(meta);
  if (!form.ok) {
    await removeSrc();
    throw photoError("rejected", form.reason);
  }

  // ---- ここから先は、このバッファだけを見る ------------------------------
  const raw = await deps.download(src);

  // 【中9】申告ではなく中身を見る。形式を**中身から**決め、申告と食い違えば落とす
  // (PNG を image/webp と称して上げる ── iPhone で実際に起きていた形 ── も、ここで落ちる)。
  const kind = photoKindOf(raw);
  if (!kind || kind !== meta?.contentType) {
    await removeSrc();
    throw photoError("rejected", "bytes-mismatch");
  }
  // 【便AP】JPEG は付帯情報(EXIF など)を取り除いた**新しいバイト列**を、判定にも保存にも使う。
  // WebP はそのまま(canvas の書き出しは付帯情報を持たない)。
  const bytes = kind === PHOTO_MIME_JPEG ? stripJpegMetadata(raw) : raw;
  if (!bytes) {
    await removeSrc();
    throw photoError("rejected", "broken-jpeg");
  }

  let verdict;
  try {
    verdict = safeSearchVerdict(await deps.safeSearch(bytes));
  } catch (e) {
    // 判定そのものが失敗したときは**通さない**(fail closed)。
    await removeSrc();
    throw photoError("unavailable", "no-verdict");
  }
  if (!verdict.ok) {
    await removeSrc();
    throw photoError("rejected", verdict.reason);
  }

  // ---- 載せる ------------------------------------------------------------
  // 【名前を毎回変える】古い場所を指している画面や CDN の写しに新しい写真が出ない。
  // 【便BH】名前(版)には「上げた順」を入れる(判定が終わった時刻ではない)。
  const rev = deps.rev(order);
  const token = deps.token();
  const dest = avatarPathOf(uid, rev, kind);
  await deps.save(dest, bytes, token, kind);
  await removeSrc();

  const url = downloadUrlOf(deps.bucketName, dest, token);
  // **決定6 の要**: users に値を入れるのはこの道具だけ。
  // 【便BH 2026-10-01 本人裁定 (b)】書くのは**いま載っている写真より新しいときだけ**。
  // writeUserPhoto はトランザクションで、いま載っている値を読んでから pick に聞く。
  // pick が undefined を返したら書かない(より新しい写真がもう載っている)。
  // トランザクションはやり直されることがあるので、pick は何度呼ばれても同じ答えを返す形にしてある
  // (shown は最後の呼び出しの答えで上書きされる)。
  let shown = url;
  const wrote = await writeUserPhotoIf(uid, deps, (current) => {
    const newer = isOlderPhoto(dest, pathOfDownloadUrl(current));
    shown = newer ? current : url;
    return newer ? undefined : url;
  });
  if (!wrote) {
    // 【負けたほうは自分の実体を消して終える】users はより新しい写真を指しているので、
    // いま保存した物はどこからも指されない。残すと「1人1枚」が崩れる。
    // 【戻り値の形は変えない】{ photo } に**いま載っている写真**を返す ── 端末はそれで画面を
    // 向け直すので、消した実体の URL を返すと本人の画面だけが壊れた画像になる。
    await deps.remove(dest);
    return { photo: shown };
  }

  // 【便BH 差し戻し(統括裁定3)】判定の途中で絵柄に戻されていた(photo: null の合図のほうが
  // この写真を上げた時刻より新しい)と、掃除がこの実体を先に消していることがある。
  // そのまま終えると users.photo が消えた実体を指す(全員の画面で読めない)。
  // **書いたあとに実体が在るかを確かめ、無ければ自分の書いた URL のときだけ外す。**
  // 掃除の側も消したあとに同じことを確かめるので、どちらが先に終わっても読めない URL は残らない。
  if (!(await deps.exists(dest))) {
    await writeUserPhotoIf(uid, deps, (current) => (current === url ? null : undefined));
    // 【便BH 再審査】通信の失敗(unavailable)にしない ── 「電波の良いところで」と案内すると嘘になる。
    throw photoError("superseded", "superseded");
  }

  // 【1人1枚(決定7)】差し替えのたびに増やさない。
  // 【便BH (b)】消すのは**いま載せた写真より古い実体だけ**。新しいもの(別のタブで判定中の写真)は
  // 消さない ── 以前は「いま載せた1枚以外」を消していたので、2本が交差すると、後から users に
  // 載る側の実体を先に終わった側が消していた。users.photo は新しい側へしか動かない
  // (上のトランザクション・クライアントは null か同じ値しか書けない)ので、
  // いま載せた写真より古いものは、もうどこからも指されない。
  await dropOlderPhotos(uid, dest, deps);
  return { photo: url };
}

/**
 * 【便BH 2026-10-01】users.photo を**条件つきで**書く。pick はいま載っている値を受け取り、
 * 書く値(URL か null)を返す。undefined なら書かない。書いたら true。
 * 読む・決める・書くは deps.writeUserPhoto のトランザクションの中で1続きに起きるので、
 * 決めてから書くまでの間に別の関数が users.photo を変えることはできない(変えたらやり直しになる)。
 */
function writeUserPhotoIf(uid, deps, pick) {
  return deps.writeUserPhoto(uid, (current, write) => {
    const next = pick(current);
    if (next === undefined) return false;
    write(next);
    return true;
  });
}

/** 実体が消えていた(404)ときは静かに false。それ以外の失敗はそのまま投げる。 */
async function unlessGone(work) {
  try {
    await work();
    return true;
  } catch (e) {
    if (e?.code === 404 || e?.code === "404") return false;
    throw e;
  }
}

/**
 * 消した実体を users.photo が指していたら外す(掃除の後始末 ── 便BH 統括裁定3)。
 * 外すのは「読み直した URL のまま」のときだけ(その間に新しい写真が載っていたら触らない)。
 */
async function unpointRemoved(uid, removed, deps) {
  if (removed.length === 0) return;
  const now = await deps.readUserPhoto(uid);
  if (!removed.includes(pathOfDownloadUrl(now))) return;
  await writeUserPhotoIf(uid, deps, (current) => (current === now ? null : undefined));
}

/**
 * keep より古い写真の実体だけを消す(便BH (b))。keep 自身と、keep より新しいものは残す。
 * 【片付けの失敗で写真の保存を失敗にしない】ここに来た時点で users はもう書けている。
 * 消し残しは次に新しい写真が載ったときにまた消される。
 */
async function dropOlderPhotos(uid, keep, deps) {
  try {
    const names = await deps.listPhotos(avatarPrefixOf(uid));
    await Promise.all(names.filter((n) => isOlderPhoto(n, keep)).map((n) => deps.remove(n)));
  } catch (e) {
    console.warn("[avatar] 古い写真を消せなかった", e?.message);
  }
}

/**
 * users の写真が消えたら、Storage の写真も消す(決定9)。
 *
 * 3つの経路をこれ1つがまかなう:
 *   ・アカウント削除   … ドキュメントごと消える
 *   ・絵柄を選び直した … クライアントが photo に null を書く(決定4)
 *   ・運営が剥がす     … コンソールで photo を消す(コンソールはルールを通らない)
 *
 * 【便BH 2026-10-01 本人裁定 (a)】公開をやめたときは、写真の URL の鍵を入れ替える(revokePhotoUrl)。
 * at は合図(この書き込み)の時刻(onDocumentWritten の event.time)。
 */
export async function runCleanAvatarPhoto({ uid, before, after, at = null }, deps) {
  if (!shouldDropPhoto(before, after)) {
    if (!shouldRevokePhotoUrl(before, after)) return { dropped: false };
    return { dropped: false, revoked: await revokePhotoUrl(uid, deps) };
  }
  // 【便BH 再審査】**関数自身が書いた photo: null は掃除の合図にしない。**
  // 関数が null を書くのは「users.photo が指す実体がもう無い」ときだけ(判定が自分の URL を外す・
  // 掃除が後始末で外す)。その書き込みを合図にすると、合図の時刻(= 関数が外した時刻)より前に
  // 上げられた版をもう一度消すので、本人がその間に上げ直して判定中の写真まで消しうる。
  // 見分け方: 外された URL の実体がもう無い。本人が絵柄に戻したときは、ふつう外した写真の実体はまだ在る。
  // 【審査の軽微・起票】**例外が2つある。** (1) 別の端末で判定中の写真Bが、本人の null の掃除より先に
  // 書き終えて前の写真の実体を片付けると、本人の null も「関数の null」と見なされ、B が残る
  // (壊れた画像にはならない・HEAD と同じ振る舞い)。(2) 既に実体の無い写真を指したまま絵柄に戻すと、
  // 掃除が丸ごと飛ばされ、古い実体と置き場が次に写真を上げるまで残る。
  // 【印の項目(photoBy など)を足さない理由】firestore.rules の users は書ける項目を hasOnly で
  // 名指ししているので、関数が新しい項目を書くと、その後の端末の updateDoc(公開の切り替えなど)が
  // すべて拒まれる。ルールは変えない約束なので、実体の有無で見分ける。
  // 文書ごと消えた(アカウント削除)ときは、関数が文書を消すことは無いので、いつもどおり掃除する。
  const was = pathOfDownloadUrl(before?.photo);
  if (after !== null && was && was.startsWith(avatarPrefixOf(uid)) && !(await deps.exists(was))) {
    return { dropped: false, unpointed: true };
  }
  // 【便AJ 2026-09-24 競合】この掃除は users の書き込みを**合図に非同期で**走るので、
  // 数秒遅れて来ることがある。「絵柄に戻す → すぐ新しい写真を上げる」と、
  // 起動した時点では新しい写真がもう載っている。丸ごと消すとそれも消える。
  // **消す直前に読み直し、いま載っている写真があれば、それより古いものだけを消す。**
  // その場合は置き場(avatarUploads)にも触らない ── 新しい写真の判定が使っている最中かもしれない。
  // 【便BH (b)】「それ以外すべて」から「それより古いものだけ」に変えた(判定中の新しい実体を消さない)。
  const current = pathOfDownloadUrl(await deps.readUserPhoto(uid));
  if (current) {
    await dropOlderPhotos(uid, current, deps);
    return { dropped: true, kept: current };
  }
  // 【便BH 差し戻し(統括裁定3)】以前はここで丸ごと消していた(dropAll)。判定の途中で絵柄に
  // 戻すと、判定中の新しい実体まで消え、そのあと判定が users.photo をその消えた実体に向けていた。
  // 版に「上げた時刻」が入ったので、**合図の時刻より前に上げられた版だけ**を消す。
  // 合図のあとに上げられた写真(絵柄に戻してから上げ直した写真)は残す。置き場も同じ物差しで見る。
  const signal = signalTimeOf(at, deps);
  const removed = await dropPhotosBefore(uid, signal, deps);
  await removeUploadBefore(uid, signal, deps);
  // 消したあとで、判定が users.photo を消した実体に向けていたら外す(判定の側も同じことを確かめる)。
  await unpointRemoved(uid, removed, deps);
  return { dropped: true };
}

/** 合図の時刻(ミリ秒)。読めなければ、いまの時刻(以前の「丸ごと消す」に近い側)にする。 */
function signalTimeOf(at, deps) {
  const t = Date.parse(at ?? "");
  return Number.isFinite(t) ? t : deps.now();
}

/** 版の時刻が signal より前の写真を消し、消した名前を返す。前の形(時刻 0)は必ず消える。 */
async function dropPhotosBefore(uid, signal, deps) {
  const names = await deps.listPhotos(avatarPrefixOf(uid));
  const doomed = names.filter((n) => {
    const t = photoTimeOf(n);
    return t !== null && t < signal;
  });
  await Promise.all(doomed.map((n) => deps.remove(n)));
  return doomed;
}

/** 置き場の写真が signal より前に上げられた物なら消す。時刻が読めなければ今までどおり消す。 */
async function removeUploadBefore(uid, signal, deps) {
  const src = uploadPathOf(uid);
  let meta = null;
  try {
    meta = await deps.getMetadata(src);
  } catch (e) {
    if (e?.code === 404 || e?.code === "404") return;   // 置き場は空
    throw e;
  }
  const order = uploadOrderOf(meta, -Infinity);
  if (order.ms < signal) await deps.remove(src, order.gen === "0" ? undefined : { ifGenerationMatch: order.gen });
}

/**
 * 【便BH 2026-10-01 本人裁定 (a)】users.photo が指す実体の鍵を新しい乱数に入れ替え、
 * users.photo を新しい鍵の URL に書き直す。鍵を新しい1つにした時点で、古い鍵の URL では読めなくなる
 * (ただし、すでに見た人の端末のキャッシュは消せない)。
 *
 * 何もしないとき(false を返す):
 *   ・photo が無い ・avatars/{uid}/ 以外を指している ・実体が無い(確かめたあとに消えた 404 も含む)
 *
 * 【手順の順番 ── 便BH 差し戻し(統括裁定1)】途中で落ちても、users.photo が読めない URL を
 * 指したまま残らない順にする。
 *   1. 鍵を「古い,新しい」の2つにする(古い URL も新しい URL も読める)
 *   2. users.photo を新しい URL に書き直す(トランザクションで、読んだ URL のままのときだけ)
 *   3. 鍵を新しい1つにする(ここで古い鍵の URL が読めなくなる)
 * 1 のあとで落ちれば古い URL のまま読める(入れ替えが済んでいないだけ)。3 で落ちても新しい URL は読める。
 * 【負けたときは、いま載っている URL の鍵に実体を合わせる】同じ写真を2本の関数が同時に
 * 入れ替えると、勝った側の鍵を、負けた側の鍵が後から上書きし得る。そのままだと
 * users.photo の URL が読めなくなる(本人の画面が壊れる)ので、負けた側が最後に読み直して直す。
 */
async function revokePhotoUrl(uid, deps) {
  const from = await deps.readUserPhoto(uid);
  const path = pathOfDownloadUrl(from);
  const oldToken = tokenOfDownloadUrl(from);
  if (!path || !oldToken || !path.startsWith(avatarPrefixOf(uid))) return false;
  if (!(await deps.exists(path))) return false;
  const token = deps.token();
  if (!(await unlessGone(() => deps.setDownloadToken(path, `${oldToken},${token}`)))) return false;
  const to = downloadUrlOf(deps.bucketName, path, token);
  const wrote = await writeUserPhotoIf(uid, deps, (current) => (current === from ? to : undefined));
  if (wrote) {
    await unlessGone(() => deps.setDownloadToken(path, token));
    return true;
  }
  const now = await deps.readUserPhoto(uid);
  const nowToken = tokenOfDownloadUrl(now);
  if (pathOfDownloadUrl(now) === path && nowToken) await unlessGone(() => deps.setDownloadToken(path, nowToken));
  return false;
}
