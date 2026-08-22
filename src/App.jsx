import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useId } from "react";
import { createPortal } from "react-dom";
// 【N-5 で GripLines(Menu の読み替え)を外した】登録済みリードの「行」に付けていた
// 三本線の目印(F-64)は、行が 5×2 のタイルになって載せる場所が無くなった。
// 代わりに「長押しで持ち上がる」ことを正典 .tile.drag の見た目(浮き上がり+影+紺の枠)で示す。
import { Square, Trash2, ChevronDown, ChevronUp, Upload, FileAudio } from "lucide-react";

// 指定要素から祖先(container手前まで)に横スクロール可能な要素があるか判定する。
// あればそこはスワイプでスクロールしたい領域なので、タブ切替スワイプの発火を避ける。
function hasHorizontalScrollAncestor(el, stopEl) {
  let node = el;
  while (node && node !== stopEl && node.nodeType === 1) {
    if (node.scrollWidth > node.clientWidth + 2) {
      const ov = getComputedStyle(node).overflowX;
      if (ov === "auto" || ov === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

// 対象要素の上端から画面下端(下部固定ナビの手前)までの高さを返すフック。スワイプ領域を
// この高さ以上に広げることで、コンテンツが短くても画面下側の空白部分までスワイプが効くようにする。
// --page-bottom-gap(= --nav-h + env(safe-area-inset-bottom)) の実効ピクセル値を得る。
// getComputedStyle().getPropertyValue() はカスタムプロパティを「未解決の文字列」
// ("calc(47px + 34px)")のまま返すため parseFloat では読めない。実際に其の高さを持つ
// 要素を一瞬置いて測ることで、calc() と env() を解決させた確定値を取る。
function resolveBottomGap() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;height:var(--page-bottom-gap)";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h > 0 ? h : 47; // 何らかの理由で測れなかった場合はナビ高だけ確保する
}

// 下部固定ナビに隠れる分を差し引いて、要素が画面下端まで占める高さを返す。
// 差し引く量は index.css の --page-bottom-gap(= --nav-h + env(safe-area-inset-bottom))から
// 実測で読む。以前は 72px をJS側にも直書きしていたため、セーフエリアのある端末で
// ナビの実効高(81px)に9px足りず、コンテンツ末尾がナビの下に隠れていた。
// bottomGap に数値を渡した場合はそれを優先する(呼び出し側で上書きしたいケース用)。
// 【iOSでは innerHeight を使わない】window.innerHeight はアドレスバーを含む高さを返すため、
// 実際に見えている領域より大きくなる。その値で minHeight を敷くと、詳細を閉じた素の状態でも
// 常にアドレスバーぶんだけ縦スクロールできてしまう(実機で計測タブ・リードタブの両方で報告)。
// 見えている領域の高さは visualViewport.height が返すので、あればそちらを優先する。
function visibleViewportHeight() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const h = vv && vv.height > 0 ? vv.height : 0;
  return h || window.innerHeight;
}
// 「画面ぶんの高さ」= 可視高 − 枠の上端 − 下端の余白。
// 【スクロール量を足して文書座標に直す。ここが F-53 の急所】
// getBoundingClientRect().top は**表示中のスクロール位置に依存する**。スクロールした状態で
// 測り直しが走ると top が小さく(スクロールしきると負に)なり、その差ぶんだけ minHeight が
// 膨らむ。膨らんだ枠は flex:1 の中間で吸収されるので、**録音ボタンから下がまるごと
// スクロール量ぶん下へずれる**(本人報告: 詳細ページを開いている=ページがスクロールできる
// 状態でテンポ入力をすると、ソフトキーボードに伴う visualViewport の resize がスクロール中に
// 発火してこれが起きる)。文書先頭からの位置で測れば、どのスクロール位置でも同じ値になる。
// DESIGN-SYSTEM §6.1.5「既にあった要素は1pxも動かない」。
function fillViewportMinHeight(rectTop, scrollY, visibleH, bottomGap) {
  const top = rectTop + (scrollY || 0);
  const h = visibleH - top - bottomGap;
  return h > 0 ? h : 0;
}
function useFillViewportHeight(ref, bottomGap = null) {
  const [minH, setMinH] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const gap = bottomGap != null ? bottomGap : resolveBottomGap();
      const scrollY = window.scrollY ?? document.documentElement.scrollTop ?? 0;
      setMinH(fillViewportMinHeight(el.getBoundingClientRect().top, scrollY, visibleViewportHeight(), gap));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    // アドレスバーの伸縮は window の resize を伴わないことがあるため visualViewport も購読する
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    const t = setTimeout(measure, 300); // フォント読込等で上の要素高さが変わった後にも測り直す
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      vv?.removeEventListener("resize", measure);
      clearTimeout(t);
    };
  }, [ref, bottomGap]);
  return minH;
}

// 指に追従してページが横からスライドインする、カルーセル型のスワイプpager。
// children(各ページ)を横一列に並べ、ドラッグ量ぶんだけtranslateXで動かす。指を離した時に
// しきい値(幅の20%)を超えていれば隣のページへスナップ、足りなければ元に戻る。
// ・パフォーマンス: ドラッグ中はReactのstateを更新せず、trackのstyleを直接書き換える
//   (重い子ページを毎フレーム再レンダーしないため)。indexはpropで制御(サブタブと同期)。
// ・縦スクロールとの両立: 最初の数pxで縦横どちらのジェスチャーかを判定し、横と決まってから
//   のみ preventDefault(非パッシブ登録)して横へ動かす。縦と判定したら何もせず縦スクロールさせる。
// ・スライダー/プルダウン/横スクロール要素の上では発火しない。
// ・viewportは画面下端まで高さを確保し、コンテンツが短くても画面のどこでもスワイプできる。
// 【N-5】リードタイルの並び替え中は、横スワイプの子タブ移動を止める。
// 行の並び替え(縦だけ)は「横に動いたら SwipePager、縦なら並び替え」と軸で棲み分けられたが、
// 5×2 のタイルは**横にも動かす**ので軸では分けられない。
// フラグを立てるのは ReedTileGrid の長押しが成立した瞬間だけで、それ以外は常に false。
// (プロパティで渡さないのは、ジェスチャーの途中で値が変わる必要があり、
//  再レンダーを待つと1フレームぶん取りこぼすため。読むのは SwipePager だけ。)
let reedTileDragActive = false;
function setReedTileDragActive(v) { reedTileDragActive = !!v; }
function isReedTileDragActive() { return reedTileDragActive; }

// 【F-79a の差し戻しで新設】SwipePager の**ジェスチャーの終わり方**と、そのとき track へ書く値。
//
// DESIGN-SYSTEM §6.3 は「ジェスチャーの終わり方は3つ(up / cancel / 別の down による中断)」とし、
// 「これを取り違えると**画面がずれたまま無期限に固着する**(実測で最大200px)」と警告している。
// F-79a はそこへ**4つ目の終わり方**(タイルの並び替えが成立したので観測をやめる)を増やした。
// 最初の実装は「捨てるだけ」で戻す処理を持たず、押したまま横へ 8px ずらしてから長押しを成立
// させると **track が translateX(calc(0% - 8px)) のまま固着**した(審査役の実測: grid の left が
// 24 → 16。時間経過でも下タブ往復でも戻らない)。まさに §6.3 が名指ししている壊れ方だった。
//
// 判定と後始末をここへ集約し、**どの終わり方を通っても track が元へ戻る(または戻す予約が入る)**
// ことを純関数としてテストから確かめられるようにする(swipeBack* と同じ作法。
// コンポーネントの if はハーネスから見えないので、消しても書き換えても検出できない)。
//
//   "advance" 指を離し、しきい値を越えて**行き先がある** → onIndexChange。
//             transform は新しい index で React が書き直すので、ここでは transition だけ戻す
//   "settle"  指を離したが、しきい値未満か行き先が無い   → 自分で元の位置へ戻す
//   "drop"    **中断**。行き先の判定をせずに終わる → 自分で元の位置へ戻す
//   "idle"    横と確定していない = track を 1px も動かしていない → 何も書かない
//
// 【`interrupted` が指すもの】「行き先を判定せず必ず戻す」終わり方**すべて**。
// §6.3 の「中断」がこれで、入口は次の4つ。**同じ扱いにする**:
//   ・タイルの並び替えが成立した(F-79a)
//   ・2本目の指が触れた(`e.touches.length !== 1`)
//   ・入力欄・横スクロール祖先の上で新しいジェスチャーが始まった
//   ・**`touchcancel`**(ブラウザがジェスチャーを取り上げた)
// どれも「新しく始めるか」「もう続けられないか」の判断であって「前のを進めるか」の
// 判断ではない。進めてしまうと、2本目の指を置いただけ・縦にスクロールしようとしただけで
// 子タブが切り替わる。
//
// 【F-83】4つ目(`touchcancel`)は HEAD から抜けていた。上の一覧は「4つ」と書きながら
// 3つしか挙げておらず、実装も `onTouchCancel={onTouchEnd}` で**指を離したのと同じ扱い**に
// していた。統括の実測(375×812、viewport 327px / しきい値 65.4px):
//   横へ -100px → `touchcancel` → **`translateX(0%)` → `translateX(-100%)`(登録→比較へ進む)**
//   同じ位置・同じ移動量の `touchend` と**区別がつかない**(800ms後の値が完全に一致)
// iOS では縦スクロールを引き取られた瞬間に `touchcancel` が来るので、斜めに引いただけで
// 子タブが替わる。SwipeBackArea 側は `pointercancel` を「元の位置へ戻す」と扱っており、
// アプリ内で作法が食い違っていた。どちらが正しいかは §6.3 の「中断は行き先を判定しない」で
// 決まる。**イベントの種類 → 中断か否か**の対応を純関数に閉じ込め、
// コンポーネントの三項演算子から追い出す(そうしないとハーネスから見えず、
// 取り違えても検出できない。A8 の変異が生き残ったのと同じ理由)。
// 【審査で訂正 2026/08/17】しきい値の元にする幅は**1ページの幅**であって viewport の
// clientWidth ではない。N-11 の `bleed`(グラフカードを画面いっぱいにするため viewport へ
// 左右 padding を入れる)を足した結果、clientWidth が 347→375 になり、**データタブだけ
// 確定のしきい値が 69.40→75.00px(+8.07%)に重くなっていた**(審査役の実測)。
// ドラッグして戻る距離はページ幅+溝のままなので、判定だけが別の寸法になっていた。
// padding を引いて content box の幅（＝1ページの幅）を返す。
function swipePagerPageWidth(viewport) {
  if (!viewport) return 0;
  const cs = typeof getComputedStyle === "function" ? getComputedStyle(viewport) : null;
  const padL = cs ? parseFloat(cs.paddingLeft) || 0 : 0;
  const padR = cs ? parseFloat(cs.paddingRight) || 0 : 0;
  return Math.max(0, (viewport.clientWidth || 0) - padL - padR);
}

function swipePagerEndKind(horizontal, interrupted, dx, width, index, count) {
  if (horizontal !== true) return "idle";     // track を触っていないので後始末も要らない
  if (interrupted) return "drop";             // 行き先は判定しない。ただし位置は必ず戻す
  const th = swipeBackThreshold(width);       // しきい値の規則は §6.3 でアプリ内に1つだけ
  if (dx <= -th && index < count - 1) return "advance";
  if (dx >= th && index > 0) return "advance";
  return "settle";
}
// 【F-107 2026/08/17 本人指示・凍結仕様 design/F106-SPEC.md】ページ間の溝(gutter)。
// 症状: 指で引いている最中だけ、隣のページとの間隔が詰まって見える。
// 原因: track が「幅100%のページを**隙間なく**並べたもの」で、静止時は隣が画面外だから
// 気付かないが、ドラッグ中は隣が露出して「間隔ゼロ」が見えてしまう(＝もともと溝が無い)。
// 対処: ページの間に常に溝を確保し、**静止時の位置計算にも溝を織り込む**。
// 溝の値は既存トークンから採る(--sp-4 = 16px。新しい値を発明しない)。
// **CSS 変数のまま使う**ので、px の数値がこのファイルへ写らない(トークンが唯一の答えのまま)。
const SWIPE_PAGER_GUTTER = "var(--sp-4)";
// track の transform は**この1関数だけ**が作る。静止時(dx=0)もドラッグ中も同じ式なので、
// 「静止時とドラッグ中で間隔が違う」という壊れ方が構造的に起こり得ない
// (溝を片方だけに入れたのが F-107 の症状そのもの)。
// ページ i の左端は i*(幅 + 溝) にあるので、index 番のページを画面に合わせるには
// 100%(=幅) の index 倍に加えて**溝の index 倍**も戻す必要がある。
function swipePagerTrackTransform(index, dxPx) {
  return `translateX(calc(${-index * 100}% - ${index} * ${SWIPE_PAGER_GUTTER} + ${dxPx}px))`;
}
// 終わり方 → track に書く値。null は「何も書かない」。
// **"idle" 以外は必ず transition を戻す**(ドラッグ中に "none" にしてあるため。
// 戻さないと次の遷移が瞬間移動になる)。transform が null なのは "advance" だけで、
// そこは React が新しい index の translateX を書く。
function swipePagerTrackStyle(kind, index, ease) {
  if (kind === "idle") return null;
  return { transition: ease, transform: kind === "advance" ? null : swipePagerTrackTransform(index, 0) };
}
// 終わり方 → **どのページへ行くか**。"advance" 以外は今の index のまま(動かない)。
// 指が左へ(dx<0)なら次のページ、右へ(dx>0)なら前のページ。端は動かない。
// 向きをここに閉じ込めるのは、コンポーネント側の三項演算子だとハーネスから見えず、
// **左右を取り違えても検出できない**ため(審査役の変異で実際に生き残った)。
function swipePagerNextIndex(kind, dx, index, count) {
  if (kind !== "advance") return index;
  const next = dx < 0 ? index + 1 : index - 1;
  return Math.max(0, Math.min(count - 1, next));
}
// 【F-83】ジェスチャーの終わりを告げた DOM イベント → **中断か否か**。
// `touchcancel` は「ブラウザが取り上げた」の合図で、指を離した意思表示ではない。
// 中断として扱う = 行き先を判定せず必ず元へ戻す(§6.3)。
// `touchend` のときだけ、タイルの並び替えが成立していたかを見る。
function swipePagerInterrupted(eventType, tileDragActive) {
  if (eventType === "touchcancel") return true;
  return tileDragActive === true;
}

// 【N-11 2026/08/17 本人指示】`bleed`: viewport の切り取り線を本文の左右余白ぶんだけ外へ出す。
// **ページの幅も溝も 1px も変えない**(pages は content box の 100% のまま = 従来と同値)。
// overflow の切り取りは padding box で起きるので、margin(外へ) + padding(同量を内へ戻す)を
// 対で当てると、ページの中身が左右の余白を食い破って画面の端まで描けるようになる
// (グラフカードの「画面いっぱい」。これが無いと viewport の overflow:hidden が食い破りを切る)。
// **既定 false = 既存の呼び出し側(リードタブ)は 1px も変わらない。**
function SwipePager({ index, onIndexChange, bleed = false, children }) {
  const pages = (Array.isArray(children) ? children : [children]).filter((c) => c != null);
  const count = pages.length;
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const st = useRef(null);
  const idxRef = useRef(index);
  useEffect(() => { idxRef.current = index; }, [index]);
  const minH = useFillViewportHeight(viewportRef);
  const EASE = SWIPE_BACK_EASE;

  // ジェスチャーの終端はここ1本に集約する。**どの終わり方でもここを通る。**
  // 終わり方の判定も track へ書く値も純関数が決め、ここは DOM に書くだけにする。
  const endGesture = (s, i, interrupted) => {
    const kind = swipePagerEndKind(s?.horizontal, interrupted, s?.dx ?? 0,
      swipePagerPageWidth(viewportRef.current), i, count);
    const style = swipePagerTrackStyle(kind, i, EASE);
    const track = trackRef.current;
    if (track && style) {
      track.style.transition = style.transition;
      if (style.transform !== null) track.style.transform = style.transform;
    }
    return kind;
  };

  // **進行中のジェスチャーを終わらせる唯一の出口。** 終端(endGesture)を必ず通してから捨てる。
  // `st.current = null` を書くのは**アプリ全体でこの1行だけ**。ここ以外に「捨てるだけ」の
  // 経路を作ると、そこまでに書いた translateX を誰も消さず
  // **画面がずれたまま無期限に固着する**(§6.3)。実際に2度これで差し戻された:
  //   1度目 … タイルの並び替えが成立した経路(F-79a の初版)
  //   2度目 … onTouchStart のガード。**「まだ track を1pxも触っていない」は誤り**だった。
  //           あのガードは新しい touchstart のたびに走るので、**前のジェスチャーが
  //           100px 動かした後**にも発火する(審査役の実測: 左へ100px → 2本目の指 →
  //           離しても `translateX(calc(0% - 100px))` のまま固着。rect.x が 24 → -76)。
  const finishGesture = (i, interrupted) => {
    const s = st.current;
    st.current = null;
    if (!s) return { kind: "none", dx: 0 };
    return { kind: endGesture(s, i, interrupted), dx: s.dx };
  };

  // 【§6.3】**中断の終端は対象判定より前に置く。**
  // 「対象外かどうか」は新しく始めるかの判断であって、前のを終わらせるかの判断ではない。
  // だから最初の1行で必ず前のジェスチャーを終わらせる(進行中が無ければ何も書かない)。
  // 中断なので **interrupted = true**: 行き先は判定せず、必ず元の位置へ戻す。
  // ここで行き先を判定すると、2本目の指を置いただけで子タブが切り替わる。
  const onTouchStart = (e) => {
    finishGesture(index, true);
    if (e.touches.length !== 1 || e.target.closest?.("input, select, textarea, [data-noswipe]") ||
        hasHorizontalScrollAncestor(e.target, e.currentTarget)) return;
    if (isReedTileDragActive()) return;
    const t = e.touches[0];
    st.current = { x: t.clientX, y: t.clientY, dx: 0, decided: false, horizontal: false };
  };

  // touchmoveは非パッシブで登録し、横ドラッグ確定後に縦スクロールを止める。
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onMove = (e) => {
      const s = st.current;
      if (!s || e.touches.length !== 1) return;
      // 【F-79a】タイルの並び替えが成立したら、進行中のジェスチャーを**捨てる**(旗を見て
      // 早期 return するだけにしない)。N-5 の実装は return だけで st.current を残していたので、
      // ドラッグ中にブラウザがスクロールを引き取って pointercancel が飛び、並び替えが終わった
      // 瞬間に**この st が生き返り**、押した点からの大きな dx でページが横に動いていた
      // (本人の実機報告「子タブへ切り替わりそうにはなる」)。捨てれば指を離すまで復活しない。
      // **捨てる前に必ず戻す**("drop")。捨てるだけだと、ここまでに書いた translateX が
      // 誰にも消されず画面がずれたまま固着する(§6.3。差し戻しの理由そのもの)。
      if (isReedTileDragActive()) { finishGesture(idxRef.current, true); return; }
      const t = e.touches[0];
      const dxRaw = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (!s.decided) {
        if (Math.abs(dxRaw) < 6 && Math.abs(dy) < 6) return;
        s.decided = true;
        s.horizontal = Math.abs(dxRaw) > Math.abs(dy);
      }
      if (!s.horizontal) return;
      e.preventDefault();
      let dx = dxRaw;
      const i = idxRef.current;
      if ((i === 0 && dx > 0) || (i === count - 1 && dx < 0)) dx *= 0.35; // 端は抵抗をつける
      s.dx = dx;
      const track = trackRef.current;
      if (track) {
        track.style.transition = "none";
        // 【F-107】静止時と**同じ関数**で書く(溝を片方だけに入れない)
        track.style.transform = swipePagerTrackTransform(i, dx);
      }
    };
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => el.removeEventListener("touchmove", onMove);
  }, [count]);

  // touchend / touchcancel の両方がここへ来る。**イベントの種類を引数で受ける**(F-83)。
  // 同じ関数を両方に配線して中身で区別しないのは、`touchcancel` を「指を離した」と
  // 取り違える形そのもの。中断か否かの判断は純関数に任せ、ここでは渡すだけにする。
  // **行き先を決める前に必ず終端を通す。** 「並び替え中だから何もしない」で抜けると、
  // ここまでに書いた translateX が残って画面がずれたまま固着する(§6.3)。
  const onTouchFinish = (eventType) => {
    const i = index;
    const interrupted = swipePagerInterrupted(eventType, isReedTileDragActive());
    const { kind, dx } = finishGesture(i, interrupted);
    const next = swipePagerNextIndex(kind, dx, i, count);   // 行き先は純関数が決める
    if (next !== i) onIndexChange(next);                    // 再レンダーで次ページへスライド
  };

  return (
    <div ref={viewportRef} onTouchStart={onTouchStart}
      onTouchEnd={() => onTouchFinish("touchend")} onTouchCancel={() => onTouchFinish("touchcancel")}
      style={{
        overflow: "hidden", minHeight: minH || undefined,
        /* bleed のときだけ width を auto にする。box-sizing: border-box なので
           width:100% のまま padding を足すと**ページの幅が padding ぶん縮む**
           (溝と位置計算の前提が崩れる)。auto なら負マージンぶんだけ枠が外へ広がり、
           content box = 従来の 100% と同じ幅に保たれる。 */
        ...(bleed ? {
          width: "auto",
          marginLeft: "calc(-1 * var(--page-pad-left))", paddingLeft: "var(--page-pad-left)",
          marginRight: "calc(-1 * var(--page-pad-right))", paddingRight: "var(--page-pad-right)",
        } : { width: "100%" }),
      }}>
      {/* 【F-107】ページ間の溝は flex の gap が実体で、位置計算(transform)が同じ量を織り込む。
          **溝の値はこの2箇所とも SWIPE_PAGER_GUTTER の1つ**(片方だけ変える事故を作らない)。
          【F-106】`will-change: transform` は外した(ここは transform を実際に書き換える要素
          なので合成レイヤは自然に作られる。恒久的なレイヤ昇格は iOS の再ペイント取りこぼしの
          典型要因で、この track は**セッション一覧のスクロールコンテナの祖先**にあたる。
          SwipeBackArea 側は以前から「will-change は使わない」と明記していて、
          アプリ内で作法が食い違っていた)。 */}
      <div ref={trackRef} style={{
        display: "flex", flexWrap: "nowrap", alignItems: "flex-start", gap: SWIPE_PAGER_GUTTER,
        transform: swipePagerTrackTransform(index, 0), transition: EASE,
      }}>
        {pages.map((c, i) => (
          <div key={i} style={{ flex: "0 0 100%", minWidth: 0, boxSizing: "border-box" }}>{c}</div>
        ))}
      </div>
    </div>
  );
}

// 詳細画面の横スワイプ領域。コンテンツが短くても画面下側の空白までスワイプが効くよう、
// 画面下端まで高さを確保する。
//   右スワイプ(指が右へ) = 一覧へ戻る(onBack)。iOSの戻る操作と同じ向き。
//   左スワイプ(指が左へ) = onForward。未指定なら何も起きない(動かすが遷移しない)。
// SwipePager と同じ「指に追従」の作法にそろえる: ドラッグ量ぶんだけ translateX で実際に
// 動かし、指を離した時点でしきい値(幅の20%)を超えていれば遷移、足りなければ元に戻す。
// ・パフォーマンス: ドラッグ中はReactのstateを更新せず、要素のstyleを直接書き換える
//   (重い詳細画面を毎フレーム再レンダーしないため)。
// ・縦スクロールとの両立: 最初の SWIPE_AXIS_LOCK_PX で縦横どちらのジェスチャーかを決め、
//   横と決まってからのみ横へ動かす。縦と決まったら何もしない。ブラウザが縦スクロールを
//   引き取ると pointercancel が来るので、そこで元の位置へ戻す。
// ・PointerEvent を使う理由: touch-action は祖先の指定が子孫より優先されるため、ここに
//   touch-action:pan-y を敷くと SessionDetailView の中にある横スクロール表(overflowX:auto)
//   が横に動かせなくなる。touch-action を触らずに済む Pointer Events で組む。
// ・ただし Pointer Events だけではブラウザのスクロールを一度も止められない。縦に長い
//   ページでは、真横(0°)に引いてさえ 20px 進んだ時点でブラウザが縦スクロールを引き取り、
//   pointercancel が飛んでジェスチャーごと死ぬ(実機報告「反応自体もよくない」。
//    審査役が Chrome DevTools Protocol の Input.dispatchTouchEvent で測り直した実測:
//    docH 1160 / innerH 812 の状態で、修正前は 20通り中 0 件しか遷移せず、
//    pointercancel が 20/20。preventDefault は1件も打てていなかった)。
//   そこで **非パッシブの touchmove を1本足し、横と確定している間だけ preventDefault する**
//   (同じ実測で 9/20 が遷移・pointercancel 0。除外要素を除くと 0/12 → 9/12)。
//   touch-action を触らずに済むので上記の横スクロール表も生きたまま。
// ・SwipePager との異同: 「非パッシブの touchmove を張り、横と確定してからだけ
//   preventDefault する」という作法は同じだが、**軸を決める場所は違う**。SwipePager は
//   touchmove の中で軸を決める。こちらは pointermove で決め、touchmove は旗を読むだけ。
// ・スライダー・プルダウン・入力欄・横スクロール要素の上では発火しない(既存と同じ判定)。
// ・マウスは対象外。デスクトップの文字選択・ドラッグを妨げない(従来もタッチ専用だった)。
// ・構造も SwipePager に合わせる: overflow:hidden の viewport が track を包む。動かすのは
//   track だけ。包まないと右ドラッグのぶんだけページが横に伸び(実測 scrollWidth 375→422)、
//   ページ全体が横スクロールできてしまう。
// ・will-change は使わない。transform と同じく position:fixed の子孫の包含ブロックを
//   作ってしまうため(暗幕が画面全体を覆えなくなる)。

// しきい値は SwipePager と同じ「**1ページの幅**の20%、幅が測れなければ 60px」。
// 【審査で訂正 2026/08/17】以前は「viewport幅の20%」と書いていたが、N-11 の bleed で
// viewport の clientWidth とページ幅が一致しなくなった(padding が入る)。
// SwipePager 側は swipePagerPageWidth で padding を引いてページ幅を渡している。
const SWIPE_BACK_THRESHOLD_RATIO = 0.2;
const SWIPE_BACK_THRESHOLD_MIN = 60;
// 縦横どちらのジェスチャーかを決めるまでの移動量(SwipePager と同じ 6px)。
const SWIPE_AXIS_LOCK_PX = 6;
// 「縦」と断定するのに要る縦成分と横成分の比。縦成分が横成分のこの倍以上でなければ
// 縦とは決めず、未確定のまま観察を続ける。
// 理由: 親指のスワイプは根元を支点に弧を描くので**最初の6pxは縦成分が勝ちやすい**。
// 1.0(=単純な大小比較)だと一度の揺れで縦に固定され、そのまま二度と横へ戻れない。
// 効き目の実測(審査役が Chrome DevTools Protocol の Input.dispatchTouchEvent で計測):
//   **1.5 が実際に救っているのは初角 42〜44° の帯**。1.0 では×、1.5 では○になる。
//   座標の丸めのゆらぎで一瞬 |dy| >= |dx| になる帯を、断定せず拾い直せるため。
//   一方、46〜70° の弧のドラッグは 1.0 でも 1.5 でも成立しない(この定数だけでは救えない)。
//   ジェスチャーが死んでいた主因は preventDefault が一度も打てていなかったことで、
//   そちらは非パッシブ touchmove の追加で解決している(0/12 → 9/12)。
// 境界は atan(1.5)=56.3°。真に縦のドラッグは 1.5 倍をすぐ超えるので縦スクロールは残る
// (同じ実測で、上へ200px引くと scrollY +185px・preventDefault 0/19)。
const SWIPE_VERTICAL_BIAS = 1.5;
// 行き先の無い向きへ引いたときの抵抗(SwipePager の端と同じ 0.35)。動くが遷移はしない。
const SWIPE_DEAD_END_RESIST = 0.35;
// 戻すときの動き(SwipePager と同じイージング)と、その後 transform を消すまでの時間。
const SWIPE_BACK_EASE = "transform 0.32s cubic-bezier(.22,.61,.36,1)";
const SWIPE_BACK_SETTLE_MS = 320;

// --- 以下5つはジェスチャー判定の純関数。scripts/pitch-test.mjs から直接検証する ---
// 判定はすべてここに閉じ込め、コンポーネント側には if を残さない
// (コンポーネントのifはハーネスから見えず、消しても書き換えても検出できないため)。

// 要素幅からしきい値(px)を出す。幅が測れないときだけ固定値にする。
function swipeBackThreshold(width) {
  return width > 0 ? width * SWIPE_BACK_THRESHOLD_RATIO : SWIPE_BACK_THRESHOLD_MIN;
}
// 縦横の軸判定。3値。**勝つまで決めない**のが要点で、どちらとも言えないうちは null を返し、
// 呼び出し側は観察を続ける(6px時点の一瞬の優劣で永久に固定しない)。
//   横と確定: |dx| が軸ロック距離に達し、かつ横成分が縦成分より大きい
//   縦と確定: |dy| が軸ロック距離に達し、かつ縦成分が横成分の SWIPE_VERTICAL_BIAS 倍以上
//   それ以外: null(未確定)
function swipeAxisIsHorizontal(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax >= SWIPE_AXIS_LOCK_PX && ax > ay) return true;
  if (ay >= SWIPE_AXIS_LOCK_PX && ay >= ax * SWIPE_VERTICAL_BIAS) return false;
  return null;
}
// ドラッグ量 → 実際に動かす量。行き先の無い向き(左スワイプで onForward が無い)には抵抗をつける。
function swipeBackOffset(dx, canForward) {
  return !canForward && dx < 0 ? dx * SWIPE_DEAD_END_RESIST : dx;
}
// 指を離したときの行き先。横と決まっていないジェスチャー(縦・未確定)は必ず "stay"。
// dx>0(右)=戻る / dx<0(左)=onForward / それ以外=元の位置へ。
function swipeBackDecision(horizontal, dx, width, canForward) {
  if (horizontal !== true) return "stay";
  const th = swipeBackThreshold(width);
  if (dx >= th) return "back";
  if (canForward && dx <= -th) return "forward";
  return "stay";
}
// 行き先 → 実際に呼ぶコールバック。この対応表を通すことで、右と左の配線の取り違えが
// ハーネスから見えるようになる("stay" は呼ぶものが無いので null)。
function swipeBackHandler(go, handlers) {
  if (go === "back") return handlers?.onBack || null;
  if (go === "forward") return handlers?.onForward || null;
  return null;
}

// ============================================================
// 【F-88 / F-90】下から出るシートを**下スワイプで閉じる**。
//
// 本人指示(実機 2026/08/15):
//   「下から出てくる追加メニューは下スワイプでも閉じれる機能を追加」(リードタブ)
//   「下から出てくるテンポ拍子メニューは下スワイプでも閉じれる機能を追加」(計測タブ)
// 統括の凍結: **同じ作法にするのは「シート」だけ**で、下端寄せのカードすべてではない。
// ここで言うシート = **正典 .sheet の角丸(28px 28px 0 0)を持ち、下端に密着し、つまみを持つ**
// カード4種(テンポ拍子 / リード追加・箱を編集 / リードの「…」 / DataOptionSheet)。
// 下端寄せだが**外した3枚**は「エラー」「この録音を保存しますか？」「目安に設定」で、
// いずれも角丸 --r-lg の四方囲み・つまみ無しの別部品(保存確認は誤タップ防止のため
// 背景タップでも閉じない設計)。判断の根拠は design/BACKLOG.md の F-88 に記録した。
//
// 【§6.3 との関係】§6.3 が定めているのは**横**スワイプの作法で、
// **縦のシート閉じは規範に無い**(実機で固まったら §6.3 へ逆輸入する)。
// §6.3 の中で**向きに依らないものだけ**を流用した:
//   指に追従する / しきい値は動かす面の20%・測れなければ60px / 軸ロック 6px /
//   縦の断定に 1.5 倍 / 戻すときのイージングと 320ms
// **新しい定数は1つも作っていない。**
// 「動かす面」はシートそのものなので、しきい値は**シートの高さ**の20%。
//
// 【流用しなかったもの: 「行き先の無い向きの抵抗 0.35」】
// §6.3 の 0.35 は**横に並んだページの端**のための値で、下端に貼り付いたシートには
// 当てはまらない。上へ動かすと下端が持ち上がって暗幕が覗くだけで、行き先が無いのではなく
// **動かしてはいけない**。初版はこれを向き無しで転用して実測 35px の隙間を作った
// (審査で発覚)。いまは sheetDismissOffset が上向きを 0 に落とす。
//
// 【終わり方は4通り。どれか1つでも終端を通し忘れるとシートがずれたまま固着する】
// F-78〜F-83 でこれを3回繰り返した(§6.3 の警告そのもの)。判定・DOM へ書く値・行き先を
// すべて純関数に出し、総当たりで検査できる形にする(swipePager* が手本)。
//   "close"  指を離し、しきい値を越えた → onClose を呼ぶ
//   "settle" 指を離したが、しきい値未満 → 元の位置へ戻す
//   "drop"   **中断**(touchcancel / 2本目の指 など)。行き先を判定せず元の位置へ戻す
//   "idle"   縦と確定していない = シートを1pxも動かしていない → 何も書かない
//
// 【"close" でも transform を戻す理由】シートは onClose でアンマウントされるのが常だが、
// **onClose が実際には閉じない実装**(親が状態を持ったまま等)だと、戻さない経路が
// そのまま「ずれたまま固着」になる。§6.3 の警告に照らして、
// **"idle" 以外はすべて translateY(0px) へ戻す**という1つの規則にする(分岐を作らない)。

// しきい値(px)。**§6.3 の横スワイプと同じ規則**を縦に使う: 動かす面の 20%、
// 測れなければ 60px。「動かす面」はシートなので height はシートの高さ。
function sheetDismissThreshold(height) {
  return height > 0 ? height * SWIPE_BACK_THRESHOLD_RATIO : SWIPE_BACK_THRESHOLD_MIN;
}
// ドラッグ量 → 実際にシートを動かす量。**下向きだけ**。
//
// 【初版の誤り(審査で実測)】§6.3 の「行き先の無い向きの抵抗 0.35」を**向き無しで**
// 転用し、上へ引くと `translateY(-35px)` していた。シートは**下端に貼り付いている**ので、
// 上へ動かすと下端が持ち上がり **777px の位置に上がって下 35px に暗幕が覗く**
// (審査役の実測)。§6.3 の抵抗は「横に並んだページの端」= どちらへ動いても
// 下に地が無い作りのための値で、下端固定のシートには当てはまらない。
// **抵抗の概念ごと持ち込まない。上向きは 0 = 動かさない。**
function sheetDismissOffset(dy) {
  return dy > 0 ? dy : 0;
}
// ジェスチャーを**シートの操作として掴むか**。掴んだときだけ preventDefault する。
//
// 【なぜ軸判定だけでは足りないか(審査で実測)】縦と確定しただけで掴むと、
// 中身がスクローラのシートで `scrollTop = 0` から**上へ**引いたときにも
// `preventDefault` が入り、`defaultPrevented = true` になって
// **中身が先頭から動き出せなくなる**。掴む条件は「先頭に居る」と「下向き」の**両方**。
// どちらかが欠けたらブラウザに返す(preventDefault しない)。
//   scrollTop: 触れた点の直近のスクロールできる祖先の scrollTop(触れた時点の値)
//   dy: 触れた点からの縦の移動量。正が下。
function sheetDismissShouldCapture(scrollTop, dy) {
  return (Number(scrollTop) || 0) <= 0 && dy > 0;
}
// 終わり方。vertical は swipeAxisIsHorizontal(dx,dy) === false のときだけ true。
function sheetDismissEndKind(vertical, interrupted, dy, height) {
  if (vertical !== true) return "idle";   // シートを触っていないので後始末も要らない
  if (interrupted) return "drop";         // 行き先は判定しない。ただし位置は必ず戻す
  return dy >= sheetDismissThreshold(height) ? "close" : "settle";
}
// 終わり方 → シートに書く値。null は「何も書かない」。
// **"idle" 以外は必ず transition を戻し、必ず translateY(0px) へ戻す**
// (ドラッグ中に transition を "none" にしてあるため。戻さないと次が瞬間移動になる)。
function sheetDismissSheetStyle(kind, ease) {
  if (kind === "idle") return null;
  return { transition: ease, transform: "translateY(0px)" };
}
// 終わり方 → **閉じるかどうか**。"close" のときだけ true。
// コンポーネント側の三項演算子に置くとハーネスから見えず、取り違えても検出できない。
function sheetDismissShouldClose(kind) {
  return kind === "close";
}
// 【F-83 と同じ】ジェスチャーの終わりを告げた DOM イベント → **中断か否か**。
// `touchcancel` は「ブラウザが取り上げた」の合図で、指を離した意思表示ではない。
function sheetDismissInterrupted(eventType) {
  return eventType === "touchcancel";
}
// 触れた点から見て、シートの中で**縦にスクロールできる直近の祖先**の scrollTop。
// 見つからなければ 0(=先頭とみなす)。root 自身も対象に含める
// (データタブの「…」はシートのカードそのものが overflowY:auto を持つ)。
function sheetScrollTopAt(el, root) {
  let node = el;
  while (node && node.nodeType === 1) {
    if (node.scrollHeight > node.clientHeight + 2) {
      const ov = getComputedStyle(node).overflowY;
      if (ov === "auto" || ov === "scroll") return node.scrollTop;
    }
    if (node === root) break;
    node = node.parentElement;
  }
  return 0;
}

// ジェスチャーの状態機械そのもの。DOMに触る操作(setX / clearX / settle / cancelSettle /
// beginDrag / 幅の取得 / コールバック / 対象判定)はすべて引数で受け取り、ここには
// 状態遷移だけを置く。判定の純関数と同じ理由で外に出してある: コンポーネントの中に
// 状態遷移を書くと、ハーネスからは正規表現でしか見えず、「呼ばれるはずの後始末が
// 呼ばれない経路」を検出できないため。ここに出しておけば scripts/pitch-test.mjs から
// 偽のイベントを順に流し込んで、clearX が実際に呼ばれた回数で守れる。
//
// 守る不変条件: **進行中のジェスチャーが終わるイベント経路は up / cancel / 別の down による
// 中断 の3つしかなく、どれを通っても transform は消えるか「戻して消す」予約が入る。**
// (経路と言えるものは実はもう1つ、アンマウントがある。SwipeBackArea の useEffect の
//  後片付けが settle のタイマーを解除しリスナーを外すが、st は後始末されず閉包ごと捨てられる。
//  ただし transform を持つ track も同時に消えるので、居座る先が無く実害は無い。
//  この行が数えているのは「イベントで終わる」3経路。)
// identity(0px)でも transform があると position:fixed の子孫の基準がこの要素になり、
// モーダルの暗幕が画面全体を覆えなくなる。
// 「終わり」を数え落とすと transform が居座る。過去に2度落としている:
//   1度目: down が settle のタイマーを解除するだけで clearX を呼ばず、直後のジェスチャーが
//          横と確定しないまま終わる(＝ただのタップ)と transform が永久に残った。
//   2度目: 対象外の down(2本目の指・入力欄・data-noswipe)が、進行中のドラッグを後始末なしに
//          捨てていた。最後の setX の値のまま固着し、以後の move/up/cancel は st が null なので
//          素通りし、無期限にずれたままになった。
// したがって中断の終端は **対象判定より前** に置く。対象外かどうかは「新しく始めるか」の
// 判断であって、「前のを終わらせるか」の判断ではない。
// なお対象外の down では cancelSettle を呼ばない。予約済みの clearX を消してしまうと、
// 戻し終えた transform がそのまま残る(＝直そうとして同じ穴を開けることになる)。
// 引数は名前付きのオブジェクト1つ。分割代入は本体の中でする(ハーネスの extractFunction は
// 「関数名の後の最初の { 」を本体の始まりと見なすため、引数の位置で分割代入すると抽出できない)。
function createSwipeBackGesture(io) {
  const { setX, clearX, settle, cancelSettle, beginDrag, getWidth, canForward, handlers, isSwipeTarget } = io;
  let st = null;
  // 行き先を決めない終わり方。pointercancel と、別の down による中断が共有する。
  // st を捨てる(再代入する)場所は abort と up の2つだけ。ここを増やすと終端が漏れる。
  // 綴りを変えても(undefined / void 0)、st.id などを書き換えて以後のイベントを素通り
  // させても同じ穴が開くので、pitch-test は綴りではなく「st への再代入」と
  // 「st の破壊的な書き換え」の数を固定している。
  const abort = () => {
    if (!st) return;
    const horizontal = st.horizontal === true;
    st = null;
    if (horizontal) settle(); else clearX();
  };
  const down = (e) => {
    abort();                                   // 前のジェスチャーの「終わり」。対象判定より前に置く
    if (!isSwipeTarget(e)) return;             // 対象外: 始めないだけ。settle の予約は生かす
    cancelSettle();                            // 進行中のドラッグを古いタイマーに消させない
    clearX();                                  // 新しいジェスチャーは必ず素の状態から始める
    st = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, horizontal: null };
  };
  const move = (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (st.horizontal === null) {
      const h = swipeAxisIsHorizontal(dx, dy);
      if (h === null) return;
      st.horizontal = h;
      if (h) beginDrag();                      // 横と決まった瞬間だけアニメーションを外す
    }
    if (!st.horizontal) return;                // 縦と決まったら横へは一切動かさない
    st.dx = dx;
    setX(swipeBackOffset(dx, canForward()));
  };
  const up = (e) => {
    if (!st || e.pointerId !== st.id) return;
    const { dx, horizontal } = st;
    st = null;
    const go = swipeBackDecision(horizontal, dx, getWidth(), canForward());
    const run = swipeBackHandler(go, handlers());
    if (run) { clearX(); run(); return; }      // 遷移するときは transform を消してから呼ぶ
    if (horizontal === true) settle();         // 動かした後で行き先が無いときだけ戻す
    else clearX();                             // 横と確定しなかった経路(タップ・縦)も必ず後始末する
  };
  const cancel = (e) => {                      // 縦スクロール等をブラウザが引き取った
    if (!st || e.pointerId !== st.id) return;
    abort();                                   // 中断と同じ終端に合流させる
  };
  return { down, move, up, cancel };
}

// 【F-88 / F-90】シートを下スワイプで閉じるジェスチャーの**状態機械そのもの**。
//
// DOM に触る操作(シートの高さ / 触れた点のスクロール位置 / transform と transition を書く /
// 消す予約とその取り消し / preventDefault / 閉じる)は**すべて io で受け取る**。
// ここには状態遷移だけを置く。createSwipeBackGesture と同じ作法で、理由も同じ:
// **コンポーネントの中に状態遷移を書くと、ハーネスからは正規表現でしか見えず、
// 「呼ばれるはずの後始末が呼ばれない経路」を検出できない**。
// ここに出しておけば scripts/pitch-test.mjs から偽のイベントを流し込んで、
// io の呼ばれ方(=実際に DOM へ何が書かれるか)で守れる。
//
// 守る不変条件:
//   (1) 進行中のジェスチャーが終わる経路は up / cancel / 別の down による中断 /
//       **アンマウント**の4つで、どれを通っても transform は元へ戻り、消す予約が入る
//   (2) 掴んでいない(= preventDefault していない)ジェスチャーは DOM を1回も触らない
//   (3) 閉じるのは「指を離し、しきい値を越えた」ときだけ
//
// io の各関数は上の純関数(sheetDismiss*)を経由した値だけを受け取る。
// 判定を io 側に書くと、また同じ「純関数を迂回する」穴になる。
function createSheetDismissGesture(io) {
  let st = null;

  // **進行中のジェスチャーを終わらせる唯一の出口。** 終端を必ず通してから捨てる。
  // `st = null` を書くのはこの1行だけ(ここ以外に「捨てるだけ」の経路を作ると、
  //  そこまでに書いた translateY を誰も消さず**シートがずれたまま固着する**。§6.3)。
  const finish = (interrupted) => {
    const s = st;
    st = null;
    if (!s) return "none";
    const kind = sheetDismissEndKind(s.captured, interrupted, s.dy, io.height());
    const style = sheetDismissSheetStyle(kind, io.ease());
    if (style) {
      io.setTransition(style.transition);
      io.setTransform(style.transform);
      io.scheduleClear();          // §6.3「静止時に transform を残さない」
    }
    return kind;
  };

  // 【§6.3】**中断の終端は対象判定より前に置く。**「対象外かどうか」は新しく始めるかの
  // 判断であって、前のを終わらせるかの判断ではない。だから最初の1行で必ず終わらせる。
  const start = (e) => {
    finish(true);
    if (io.touchCount(e) !== 1) return;
    if (io.isFormField(e)) return;          // 入力欄の上では始めない(値を選ぶ操作を奪わない)
    const p = io.point(e);
    st = { x: p.x, y: p.y, dy: 0, decided: false, captured: false, scrollTop: io.scrollTopAt(e) };
  };

  const move = (e) => {
    const s = st;
    if (!s || io.touchCount(e) !== 1) return;
    const p = io.point(e);
    const dx = p.x - s.x;
    const dyRaw = p.y - s.y;
    if (!s.decided) {
      // 軸は §6.3 の規則そのまま。**勝つまで決めない**(未確定のうちは何もしない)。
      const axis = io.axisIsHorizontal(dx, dyRaw);
      if (axis === null) return;
      s.decided = true;
      // 縦と確定しても、**先頭に居て下向きのときだけ**シートの操作として掴む。
      // 掴まなければ preventDefault しないのでブラウザに返り、中身のスクロールが生きる。
      s.captured = axis === false && sheetDismissShouldCapture(s.scrollTop, dyRaw);
    }
    if (!s.captured) return;
    io.preventDefault(e);
    const dy = sheetDismissOffset(dyRaw);
    s.dy = dy;
    io.setTransition("none");
    io.setTransform(`translateY(${dy}px)`);
  };

  // touchend / touchcancel の両方がここへ来る。**イベントの種類を引数で受ける**(F-83)。
  // 中断か否かの判断は純関数に任せ、ここでは渡すだけにする。
  const end = (eventType) => {
    const kind = finish(sheetDismissInterrupted(eventType));
    if (sheetDismissShouldClose(kind)) io.close();
  };

  // 要素が消える = 終わり方の4つ目(アンマウント)。ここも唯一の出口を通す。
  const detach = () => { finish(true); io.cancelClear(); };

  return { start, move, end, detach };
}

// 【F-88 / F-90】上の状態機械を React へつなぐだけの層。**判定を1つも持たない。**
//
// 使い方: `const dismiss = useSheetDismiss(onClose);` として
//   <div ref={dismiss.ref} {...dismiss.handlers}>  ← シートのカード
// を書く。カードにしか付けないので、暗幕(背景タップで閉じる)側の挙動は変わらない。
//
// 【touchmove を非パッシブで張る理由】§6.3。掴んでいる間だけ preventDefault() を
// 呼ばないと、ブラウザがページの縦スクロールを引き取ってジェスチャーごと死ぬ。
// **掴むまでは preventDefault してはいけない**(iOS は最初の touchmove で止められると
// そのジェスチャー全体をスクロールしなくなり、シート内の縦スクロールが死ぬ)。
function useSheetDismiss(onClose) {
  const ref = useRef(null);
  const settleTimer = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // io は毎レンダー作り直さない(状態機械を1つに保つため ref に入れる)。
  // 中身は ref 越しに今の値を読むので、閉包が古くなることは無い。
  const gestureRef = useRef(null);
  if (gestureRef.current === null) {
    const el = () => ref.current;
    gestureRef.current = createSheetDismissGesture({
      ease: () => SWIPE_BACK_EASE,
      height: () => el()?.offsetHeight || 0,
      touchCount: (e) => e.touches.length,
      point: (e) => ({ x: e.touches[0].clientX, y: e.touches[0].clientY }),
      isFormField: (e) => !!e.target.closest?.("input, select, textarea"),
      scrollTopAt: (e) => sheetScrollTopAt(e.target, el()),
      axisIsHorizontal: (dx, dy) => swipeAxisIsHorizontal(dx, dy),
      preventDefault: (e) => e.preventDefault(),
      setTransition: (v) => { const n = el(); if (n) n.style.transition = v; },
      setTransform: (v) => { const n = el(); if (n) n.style.transform = v; },
      close: () => onCloseRef.current?.(),
      // 戻し終わったら **transform を消す**。§6.3「静止時に transform を残さない」。
      // identity(translateY(0px))でも、transform を持つ要素は position:fixed の子孫の
      // 包含ブロックになる。シートの中からは ScrollPicker(z-index 60 の全画面モーダル)が
      // 開くので、残すと**そのピッカーがシートの中に閉じ込められる**。
      scheduleClear: () => {
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => {
          settleTimer.current = null;
          const n = el();
          if (!n) return;
          n.style.transition = "";
          n.style.transform = "";
        }, SWIPE_BACK_SETTLE_MS);
      },
      cancelClear: () => {
        if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
      },
    });
  }
  const g = gestureRef.current;
  useEffect(() => () => g.detach(), [g]);

  // 非パッシブの touchmove は**コールバック ref で張る**。
  // シートは条件付きレンダーなので、フックを持つ側(MeasureView)が先にマウントされる
  // ケースがあり、useEffect([]) の時点では ref.current がまだ null になる。
  //
  // 【依存配列は必ず空にする】コールバック ref は**関数の同一性が変わるたびに**
  // 「古い ref に null」→「新しい ref に要素」の順で呼ばれる。依存に onClose 等を入れると、
  // 呼び出し側が毎レンダー新しい関数を渡すため親の再レンダーだけで下の null 分岐が走り、
  //   ・進行中のジェスチャーが中断される(ドラッグ中に親が再レンダーすると指から外れる)
  //   ・戻した後の transform を消すタイマーが毎回キャンセルされ、**transform が残り続ける**
  // という2つの事故が起きる。**実ブラウザで後者を実測して見つけた**
  // (テンポシートを下へ40px引いて離し、420ms 後も style.transform が translateY(0px) のまま)。
  // g / listenerRef は ref なので同一性が変わらず、閉包が古くなることも無い。
  const listenerRef = useRef(null);
  const attachRef = useCallback((node) => {
    const prev = ref.current;
    if (prev && listenerRef.current) {
      prev.removeEventListener("touchmove", listenerRef.current);
      listenerRef.current = null;
    }
    ref.current = node;
    if (node) {
      const fn = (ev) => g.move(ev);
      listenerRef.current = fn;
      node.addEventListener("touchmove", fn, { passive: false });
    } else {
      g.detach();
    }
  }, [g]);

  return {
    ref: attachRef,
    handlers: {
      onTouchStart: (e) => g.start(e),
      onTouchEnd: () => g.end("touchend"),
      onTouchCancel: () => g.end("touchcancel"),
    },
  };
}

function SwipeBackArea({ onBack, onForward, children }) {
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const minH = useFillViewportHeight(viewportRef);
  // 遷移先はレンダーごとに新しい関数が来るのでrefで読む(リスナーは張り替えない)。
  const cbRef = useRef({ onBack, onForward });
  useEffect(() => { cbRef.current = { onBack, onForward }; });

  useEffect(() => {
    const vp = viewportRef.current, track = trackRef.current;
    if (!vp || !track) return;
    let settleTimer = 0;
    // 横と確定している間だけ true。立てるのは beginDrag(横と決まった瞬間)、降ろすのは
    // clearX と settle(ジェスチャーの開始・終了はすべてこの2つを通る)。
    // この旗が touchmove の preventDefault の可否そのもの。
    let dragHorizontal = false;
    const setX = (px) => { track.style.transform = `translateX(${px}px)`; };
    // 静止時は transform を残さない。identityでも transform があると position:fixed の
    // 子孫の基準がこの要素になり、モーダルの暗幕が画面全体を覆えなくなるため。
    const clearX = () => { dragHorizontal = false; track.style.transition = ""; track.style.transform = ""; };
    const settle = () => {                       // しきい値未満: 元の位置へ戻す
      dragHorizontal = false;                    // 指はもう離れている。戻しの間は何も止めない
      track.style.transition = SWIPE_BACK_EASE;
      setX(0);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(clearX, SWIPE_BACK_SETTLE_MS);
    };
    // 非パッシブの touchmove。**横と確定している間だけ**ブラウザのスクロールを止める。
    // 未確定・縦のあいだは preventDefault しない(縦スクロールを妨げない)。
    // Pointer Events だけではここが止められず、斜めに引くとブラウザが縦スクロールを
    // 引き取って pointercancel が飛び、ジェスチャーごと死んでいた。
    const onTouchMove = (e) => {
      if (!dragHorizontal) return;
      e.preventDefault();
    };
    // 状態遷移は createSwipeBackGesture(純関数のファクトリ)が持つ。ここは DOM を触る
    // 手足を渡して、返ってきた down/move/up/cancel をイベントに繋ぐだけにする。
    const g = createSwipeBackGesture({
      setX, clearX, settle,
      cancelSettle: () => clearTimeout(settleTimer),
      beginDrag: () => { dragHorizontal = true; track.style.transition = "none"; },
      getWidth: () => vp.clientWidth,
      canForward: () => !!cbRef.current.onForward,
      handlers: () => cbRef.current,
      isSwipeTarget: (e) => {
        if (e.pointerType === "mouse" || e.isPrimary === false) return false;
        if (e.target?.closest?.("input, select, textarea, [data-noswipe]")) return false;
        return !hasHorizontalScrollAncestor(e.target, vp);
      },
    });

    vp.addEventListener("pointerdown", g.down);
    vp.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("pointermove", g.move);
    window.addEventListener("pointerup", g.up);
    window.addEventListener("pointercancel", g.cancel);
    return () => {
      clearTimeout(settleTimer);
      vp.removeEventListener("pointerdown", g.down);
      vp.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointermove", g.move);
      window.removeEventListener("pointerup", g.up);
      window.removeEventListener("pointercancel", g.cancel);
    };
  }, []);

  return (
    <div ref={viewportRef} style={{ overflow: "hidden", width: "100%", minHeight: minH || undefined }}>
      <div ref={trackRef}>{children}</div>
    </div>
  );
}

// ============================================================
// Music theory helpers
// ============================================================
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];

// 楽器音だけを拾うための判定パラメータ。
// ・ノイズゲート: バンドパス後の音量(dBFS)がこの値以下なら無音とみなす(設定で変更可能)。
// ・ヒステリシス: 発音中はゲート-この分まで継続し、境界付近のパタつきを防ぐ。
// ・clarity(MPMの周期明瞭度0..1)がこの値未満なら「音程のない雑音(ブレス/空調)」として排除。
//   楽器音はほぼ完全な周期波形でclarityが0.9以上になる。ブレスや空調は非周期で低い。
const NOISE_GATE_DEFAULT_DB = -50; // 既定のノイズゲート(dBFS)
const GATE_HYSTERESIS_DB = 4;
const PITCH_CLARITY_MIN = 0.8;
const TIMBRE_EXTRA_DB = 8;          // 音色系(重心/HNR/倍音)はゲート+この余裕の音量でだけ測定
// バンドパス(BiquadFilterNode)の中心周波数とQ。楽器の基音帯を通し、
// 空調のうなり(低域)と高域ヒスを抑える。Qを低くして広い帯域を通す。
// 中心周波数は楽器種別ごと(SAX_PRESETSのgateBandpassHz)。500はフォールバック。
const BANDPASS_FREQ_HZ = 500;
const BANDPASS_Q = 0.3;
// 記録データの頑健化パラメータ。
// ・TIMBRE_SUSTAIN_MS: ノート冒頭のアタック過渡は音色(倍音/重心/HNR)の集計から除外する
//   (典型的なアタックは20〜100ms。表示はリアルタイムのまま、平均値の質だけを上げる)。
// ・NOTE_SWITCH_CENTS: 音名グルーピングのヒステリシス。半音境界(±50¢)ちょうどの音で
//   フレームごとに隣の音名と行き来するチャタリングを防ぐ(前の音名から±60¢までは保持)。
// ・PITCH_OUTLIER_CENTS: 前後フレームの中央値からこれ以上外れた単発検出(オクターブ
//   誤検出等)を保存時に無効化する。速いパッセージの実音(隣接音±数百¢)は誤検出しない値。
const TIMBRE_SUSTAIN_MS = 120;
const NOTE_SWITCH_CENTS = 60;
const PITCH_OUTLIER_CENTS = 700;
// ピッチ集計の入口ゲート(F-44)。保存データは非破壊のまま、集計に使うフレームだけを
// selectPitchAggregationFrames で選別する。タイムライン表示は生のまま。
const PITCH_EDGE_TRIM_MS = 120;        // 各ノート区間の両端をこの時間だけピッチ集計から外す(アタックのしゃくり・スラーの過渡)
const PITCH_RUN_GAP_MS = 250;          // フレーム間隔がこれを超えたら(または t が逆行したら)別区間とみなす(無音・セッション連結境界)
const PITCH_FLIP_MAX_MS = 120;         // これ以下の短い区間だけをオクターブ誤検出の疑い対象にする(実奏のオクターブ跳躍を誤爆しないための上限)
const PITCH_FLIP_NEIGHBOR_AGREE_CENTS = 200; // 前後の安定区間同士がこの範囲で一致しているときだけ判定する
const PITCH_FLIP_INTERVALS_CENTS = [1200, 1902]; // オクターブ / 12度(3倍音)
const PITCH_FLIP_TOLERANCE_CENTS = 150;          // 上記音程との一致とみなす許容
// 運指テーブルの範囲から大きく外れた音(アルティッシモ・他楽器・誤検出)は運指に紐付けない。
// テーブル範囲内なら最近傍運指との差は必ず±50¢以内のため、これを超えるのは範囲外のみ。
const FINGERING_MATCH_MAX_CENTS = 150;

// a4: 基準ピッチ(Hz)。音名判定・セント誤差はこの基準に対する平均律で計算する
// (基準を442Hzにすれば、442Hzちょうどの音がA4・誤差0¢と表示される)
function freqToNote(freq, a4 = 440) {
  if (!freq || freq <= 0) return null;
  const midi = 69 + 12 * Math.log2(freq / a4);
  const rounded = Math.round(midi);
  const centsExact = (midi - rounded) * 100; // メーターを滑らかに動かすための丸めていないセント差
  const cents = Math.round(centsExact);       // 表示用(±0.5¢刻みだと数字が落ち着かないため整数)
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return { name, octave, cents, centsExact, midi };
}

function centsBetween(freqA, freqB) {
  if (!freqA || !freqB) return 0;
  return 1200 * Math.log2(freqA / freqB);
}

function speedOfSound(tempC) {
  return 331.3 + 0.606 * tempC;
}

// ============================================================
// Conical tube model (saxophone) — 検証済み実効長プリセット
// 【注記】この固定プリセットは「最低音1点のみの校正」であり、
// 運指が変わる(音域が変わる)たびに理論値がズレる問題がある。
// 下記の「運指ベース管長自動キャリブレーション」で置き換える。
// ============================================================
// gateBandpassHz: ノイズゲート判定用バンドパスの中心周波数。楽器の基音域の中心付近に
// 合わせる(バリトンの最低音域65〜100Hzは500Hz中心だと減衰し、ppの低音を拾い損ねるため)。
const SAX_PRESETS = {
  soprano: { label: "Soprano", effectiveLengthCm: 73.3, bellRadiusCm: 0.6, gateBandpassHz: 650 },
  alto: { label: "Alto", effectiveLengthCm: 123.4, bellRadiusCm: 0.8, gateBandpassHz: 500 },
  tenor: { label: "Tenor", effectiveLengthCm: 164.8, bellRadiusCm: 1.0, gateBandpassHz: 400 },
  baritone: { label: "Baritone", effectiveLengthCm: 261.7, bellRadiusCm: 1.3, gateBandpassHz: 300 },
};

function conicalTubeHarmonics(effectiveLengthCm, bellRadiusCm, tempC, count) {
  const v = speedOfSound(tempC);
  const L = effectiveLengthCm / 100;
  const bellCorr = 0.6 * (bellRadiusCm / 100);
  const Leff = L + bellCorr;
  const harmonics = [];
  for (let n = 1; n <= count; n++) harmonics.push({ n, freq: (n * v) / (2 * Leff) });
  return harmonics;
}

// ============================================================
// 運指ベース管長自動キャリブレーション
// (Python検証: algo_fingering_calibration.py を移植)
//
// サックスは運指(トーンホール開閉)で気柱長を変える楽器のため、
// 最低音1点だけで校正した固定管長では、音域が変わるたびに
// 理論値(絶対周波数)が実測とズレる。
//
// 対処: サックス共通の運指テーブル(記音ベース)を持ち、楽器種別ごとの
// 移調量・基準ピッチでスケーリングした「正しい実音Hz」を求める。
// 実測基音に最も近い運指をテーブルから検索し、そのHzを理論値の基準にする。
// ============================================================
const NOTE_NAMES_SHARP = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];

// 記音: Low B♭(サックス共通の最低音、MIDI 58相当)からの半音距離でテーブルを構築
const LOW_BB_WRITTEN_MIDI = 58;

function writtenNoteLabel(semitoneFromLowBb) {
  const midi = LOW_BB_WRITTEN_MIDI + semitoneFromLowBb;
  const name = NOTE_NAMES_SHARP[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

// "A4" / "C♯5" / "B♭3" のような音名ラベルを {name, octave} に分解する(大表示用)。
function parseNoteLabel(label) {
  if (typeof label !== "string") return null;
  const m = /^([A-G][♯♭#b]?)(-?\d+)$/.exec(label);
  return m ? { name: m[1], octave: m[2] } : null;
}

// 音名表記統一(D#→E♭, A#→B♭)より前に保存されたセッション/理想値プロファイルには
// 旧表記の音名文字列がそのまま残っているため、読み込み時に一度だけ変換する。
function migrateNoteSpelling(label) {
  if (typeof label !== "string") return label;
  if (label.startsWith("D#")) return "E♭" + label.slice(2);
  if (label.startsWith("A#")) return "B♭" + label.slice(2);
  return label;
}

// 楽器種別ごとの移調(記音→実音): アルト/バリトン=E♭管、ソプラノ/テナー=B♭管
// オクターブ差込みの合計半音移調量
const TRANSPOSITION_SEMITONES = {
  soprano: -2,   // B♭管
  alto: -9,       // E♭管
  tenor: -2 - 12, // B♭管、1オクターブ下
  baritone: -9 - 12, // E♭管、1オクターブ下
};

const A4_MIDI = 69;

function writtenMidiToSoundingFreq(writtenMidi, saxType, tuningHz) {
  const transposition = TRANSPOSITION_SEMITONES[saxType];
  const soundingMidi = writtenMidi + transposition;
  const freq440 = 440 * Math.pow(2, (soundingMidi - A4_MIDI) / 12);
  return freq440 * (tuningHz / 440);
}

// 楽器種別ごとの実音(コンサートピッチ)の音域(MIDIノート番号, 両端含む)。
// 【F-103 2026/08/17 本人指示】フラジオ(アルティッシモ)対応: 上限を通常の最高音
// (記音F♯6 = High F♯キー)から**長3度(+4半音)上**の記音B♭6まで拡張する。
// 運指範囲は全機種共通で記音B♭3(58)〜B♭6(94)の37音。下限は不変。
// 各機種の移調量を足した実音がこの範囲になる:
//   ソプラノ: A♭3(56)〜A♭6(92) / アルト: D♭3(49)〜D♭6(85)
//   テナー:   A♭2(44)〜A♭5(80) / バリトン: D♭2(37)〜D♭5(73)
// (通常運指の最高音は従来どおり 92-4 / 85-4 / 80-4 / 73-4 の位置。+4の帯がフラジオ域)
// この範囲外の検出(倍音を基音と誤る1オクターブ上のピーク等)は測定・記録しない。
// 音域の左端は運指テーブルの最低音(記音B♭)の実音と一致する。
// この定数が運指表(buildFingeringTable)・音名軸グラフ・チューナー判定(saxPitchBounds)の
// **唯一の上限**なので、+4 はここにだけ入れる。
const SAX_CONCERT_RANGE = {
  soprano: { lowMidi: 56, highMidi: 92 },
  alto: { lowMidi: 49, highMidi: 85 },
  tenor: { lowMidi: 44, highMidi: 80 },
  baritone: { lowMidi: 37, highMidi: 73 },
};

// 実音MIDI → 周波数(基準ピッチa4基準)
function concertMidiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

// 実音周波数 → 実音の音名ラベル(グラフの横軸などに使う。例: 442基準で139Hz→"D♭3")
function concertFreqLabel(freq, a4 = 440) {
  const n = freqToNote(freq, a4);
  return n ? `${n.name}${n.octave}` : null;
}

// 楽器音域からピッチ検出の下限・上限周波数を出す(±1半音の余裕をつけて、音域端の音を
// ±50¢曲げても外れないようにする)。範囲外の検出はdetectPitchMPMが棄却する。
function saxPitchBounds(saxType, a4 = 440) {
  const r = SAX_CONCERT_RANGE[saxType];
  if (!r) return { minFreq: 55, maxFreq: 1200 };
  return {
    minFreq: concertMidiToFreq(r.lowMidi - 1, a4),
    maxFreq: concertMidiToFreq(r.highMidi + 1, a4),
  };
}

// 運指テーブルを生成。音数は楽器種別ごとの音域(SAX_CONCERT_RANGE)に一致させる
// (記音B♭=音域の左端から、実音の最高音までを1半音刻みで並べる)。
function buildFingeringTable(saxType, tuningHz, numNotes) {
  const r = SAX_CONCERT_RANGE[saxType];
  const n = numNotes ?? (r ? r.highMidi - r.lowMidi + 1 : 30);
  const table = [];
  for (let i = 0; i < n; i++) {
    const writtenMidi = LOW_BB_WRITTEN_MIDI + i;
    const freq = writtenMidiToSoundingFreq(writtenMidi, saxType, tuningHz);
    table.push({ semitoneIndex: i, writtenLabel: writtenNoteLabel(i), soundingFreqHz: freq });
  }
  return table;
}

// 【F-103】SAX_CONCERT_RANGE の highMidi に足したフラジオ域の幅(半音)。
// 「通常運指の最高音は 92-4 / 85-4 / 80-4 / 73-4 の位置」= +4 の帯がフラジオ域、という
// SAX_CONCERT_RANGE の定義そのもの。**上限を +4 したのはあの1箇所だけ**なので、
// 「フラジオを含めない」も同じ量をここから引く形で書く(別の音数を発明しない)。
const SAX_ALTISSIMO_SEMITONES = 4;
// 【N-11 2026/08/17 本人指示】音名軸に並べる音数。
// 「My Data のカードのグラフにはフラジオを入れなくてよい(他は入れる)」。
// **既定 true = 従来どおり全音(フラジオ込み)**。false のときだけフラジオの帯を落とす。
// 音域そのもの(SAX_CONCERT_RANGE)は動かさない: 変えるのは**この軸に何音並べるか**だけで、
// チューナーの判定域・運指表・他の画面のグラフはすべて従来のまま。
function noteAxisCount(saxType, includeAltissimo = true) {
  const r = SAX_CONCERT_RANGE[saxType];
  if (!r) return null;
  const full = r.highMidi - r.lowMidi + 1;
  return includeAltissimo ? full : full - SAX_ALTISSIMO_SEMITONES;
}

// 運指(semitoneIndex)→ 実音(コンサートピッチ)の音名ラベル。【F-54】
// 集計の行ラベル・ピボットの音名次元は**運指から一意に導く**こと。フレームの concertNote は
// *実測*の音名なので、同じ運指でも演奏が大きくズレると隣の音名になり、同じ運指が複数の行に割れる
// (NoteAxisLineChart が横軸を buildFingeringTable から作っているのと同じ考え方)。
// 楽器種別はフレームごとに違い得る(複数セッションを混ぜる PIVOT ではアルトとテナーが同居する)。
// 同じ semitoneIndex でも実音は変わるので、**そのフレームのセッションの saxType** を必ず渡すこと。
// buildFingeringTable はフレームごとに呼ばない(毎回37音(F-103でフラジオぶん+4)のテーブルを作ることになる)ため、
// 楽器種別ごとに直近の tuningHz のラベル列だけを持つ。Map の要素数は楽器種別の数(4)が上限。
const CONCERT_LABEL_CACHE = new Map(); // saxType -> { tuningHz, labels: string[], freqs: number[] }
function concertNoteTableOf(saxType, tuningHz) {
  if (!SAX_CONCERT_RANGE[saxType] || !(tuningHz > 0)) return null;
  let hit = CONCERT_LABEL_CACHE.get(saxType);
  if (!hit || hit.tuningHz !== tuningHz) {
    const table = buildFingeringTable(saxType, tuningHz);
    hit = {
      tuningHz,
      labels: table.map((e) => concertFreqLabel(e.soundingFreqHz, tuningHz)),
      // 並べ替え用の実音の高さ。ラベルと同じテーブルから同時に作るので、
      // 表示と並びが必ず同じ土台から出る(片方だけ実音・片方だけ運指、という食い違いを防ぐ)。
      freqs: table.map((e) => e.soundingFreqHz),
    };
    CONCERT_LABEL_CACHE.set(saxType, hit);
  }
  return hit;
}
function concertNoteLabelOf(semitoneIndex, saxType, tuningHz) {
  if (semitoneIndex === null || semitoneIndex === undefined) return null;
  const hit = concertNoteTableOf(saxType, tuningHz);
  return hit ? (hit.labels[semitoneIndex] ?? null) : null;
}
// 実音の高さ(Hz)。PIVOTの音名軸を「音の高さ順」に並べるのに使う。
// 【F-60】運指(semitoneIndex)で並べてはいけない。F-54でラベルを実音にしたので、
// 楽器種別が混ざると運指の順と実音の高さの順が一致しなくなる
// (アルトの si=32 は A5=880Hz、テナーの si=32 は E5=659Hz。運指で並べると E5 が A5 より上に来る)。
function concertNoteFreqOf(semitoneIndex, saxType, tuningHz) {
  if (semitoneIndex === null || semitoneIndex === undefined) return null;
  const hit = concertNoteTableOf(saxType, tuningHz);
  return hit ? (hit.freqs[semitoneIndex] ?? null) : null;
}

// 実測周波数に最も近い運指をテーブルから検索(セント距離で比較)
function findClosestFingering(measuredHz, fingeringTable) {
  if (!measuredHz || measuredHz <= 0) return null;
  let best = null;
  let bestAbsCents = Infinity;
  for (const entry of fingeringTable) {
    const cents = 1200 * Math.log2(measuredHz / entry.soundingFreqHz);
    if (Math.abs(cents) < bestAbsCents) {
      bestAbsCents = Math.abs(cents);
      best = { ...entry, centsError: cents };
    }
  }
  return best;
}

// 正しい実音Hzから理論上の管長を逆算(開管モデル、基音の式) — 表示用の物理量
function deriveTubeLengthCm(targetHz, bellRadiusCm, tempC) {
  const v = speedOfSound(tempC);
  const bellCorrM = 0.6 * (bellRadiusCm / 100);
  const LeffM = v / (2 * targetHz);
  return (LeffM - bellCorrM) * 100;
}

// テーブルの正しいHzを基音として整数次倍音列を返す(理論値グラフの基準)
function theoreticalHarmonicsFromTarget(targetHz, count) {
  const harmonics = [];
  for (let n = 1; n <= count; n++) harmonics.push({ n, freq: targetHz * n });
  return harmonics;
}


// ============================================================
// Pitch detection: MPM (McLeod Pitch Method)
//
// 旧実装(HPS=スペクトル積)は2つの致命的問題があった:
//  1. FFTのビン分解能(8192点/48kHz=5.86Hz)そのままでは低音で±30〜70¢の階段状にしか
//     動けず、1¢単位のチューナーとして成立しない。
//  2. AnalyserNodeの床(-100dB)で0になったビンが積に混ざると全域の積が0になり、
//     探索範囲の最初のビン(≒50Hz)を「検出」してしまう→常に最低音(B♭)に判定される。
// MPMは時間領域の正規化自己相関(NSDF)のピークを放物線補間で読むため、
// サブサンプル精度(実測<0.5¢)で基音周期を求められる。fftRadix2による
// FFT自己相関でO(N logN)に抑える。clarity(0..1)は音の周期性の明瞭度で、
// ブレスや空調のような非周期ノイズの排除(楽器音判定)にも使う。
// ============================================================
function detectPitchMPM(timeBuf, sampleRate, minFreq = 55, maxFreq = 1200) {
  const W = 4096;  // 解析窓(約85ms@48kHz。バリトン最低音73Hzでも6周期以上入る)
  const N = 8192;  // ゼロ埋めFFTサイズ(円状自己相関→線形自己相関化)
  if (!timeBuf || timeBuf.length < W) return null;
  const offset = timeBuf.length - W;

  // DC除去(マイクのオフセットで自己相関が歪むのを防ぐ)
  let mean = 0;
  for (let i = 0; i < W; i++) mean += timeBuf[offset + i];
  mean /= W;

  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < W; i++) re[i] = timeBuf[offset + i] - mean;
  fftRadix2(re, im);
  // パワースペクトル(実偶関数)を再度FFTすると実数の自己相関×Nが得られる
  for (let i = 0; i < N; i++) { const p = re[i] * re[i] + im[i] * im[i]; re[i] = p; im[i] = 0; }
  fftRadix2(re, im);

  const r0 = re[0] / N;
  if (r0 <= 1e-12) return null; // 完全な無音

  // m(τ) = Σ(x[j]² + x[j+τ]²) を累積和で O(1) 参照できるようにする
  const sq = new Float64Array(W + 1);
  for (let i = 0; i < W; i++) { const v = timeBuf[offset + i] - mean; sq[i + 1] = sq[i] + v * v; }

  const maxLag = Math.min(W - 1, Math.ceil(sampleRate / minFreq));
  // NSDFはτ=2から計算する。探索をminLag(最高周波数の周期)から始めると、高音では
  // 最初の真のピークがτ=0の自明な正区間と地続きになって「正区間スキップ」に飲み込まれ、
  // 2倍周期(1オクターブ下)を拾ってしまう。τ=2起点ならτ=0のローブを正しく通過できる。
  const nsdf = new Float64Array(maxLag + 2);
  for (let t = 2; t <= maxLag; t++) {
    const rt = re[t] / N;
    const mt = (sq[W - t] - sq[0]) + (sq[W] - sq[t]);
    nsdf[t] = mt > 0 ? (2 * rt) / mt : 0;
  }

  // ピーク選択(McLeod): 正区間ごとの局所最大を列挙し、音域内で最大ピーク×K以上の最初(最小τ)を採る
  const peaks = [];
  let t = 2;
  while (t <= maxLag && nsdf[t] > 0) t++; // τ=0近傍の自明な正区間を飛ばす
  while (t <= maxLag) {
    while (t <= maxLag && nsdf[t] <= 0) t++;
    let peakT = -1, peakV = 0;
    while (t <= maxLag && nsdf[t] > 0) {
      if (nsdf[t] > peakV) { peakV = nsdf[t]; peakT = t; }
      t++;
    }
    if (peakT > 0) { peaks.push([peakT, peakV]); }
  }
  if (peaks.length === 0) return null;
  // 楽器音域の上限(maxFreq)より高いピーク=倍音を基音と誤る「1オクターブ上」のピークは
  // 候補から除外する。McLeodの選択は「最大ピーク×K以上で最もτが小さい(=最も高い)ピーク」
  // を採るため、音域を絞らないと強い倍音を持つ音で幻の高音(オクターブ上)を拾いやすい。
  // 音域内(τ≥minLag)に絞ることで、正しい基音を選ぶ。
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  const cand = peaks.filter((p) => p[0] >= minLag);
  if (cand.length === 0) return null;
  let candMax = 0;
  for (const p of cand) if (p[1] > candMax) candMax = p[1];
  if (candMax < 0.5) return null;
  const K = 0.9;
  let chosen = cand[0];
  for (const p of cand) { if (p[1] >= K * candMax) { chosen = p; break; } }

  // 放物線補間でサブサンプルの周期を求める(これが1¢精度の要)
  const T = chosen[0];
  const a = nsdf[T - 1], b = nsdf[T], c = nsdf[T + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  const tau = T + shift;
  const clarity = Math.max(0, Math.min(1, b - 0.25 * (a - c) * shift));
  const freq = sampleRate / tau;
  if (freq < minFreq || freq > maxFreq) return null;
  return { freq, clarity };
}

function freqToBin(freq, sampleRate, fftSize) {
  return Math.round((freq * fftSize) / sampleRate);
}

// ============================================================
// Timbre metrics (倍音・スペクトル重心・HNR)
//
// 旧実装はAnalyserNodeの周波数データ(smoothingTimeConstant=0.6の時間平滑つき)から
// 計算していたため、次の系統誤差があった:
//  1. 立ち上がりや音替わりの直後は、直前の音(や無音)のスペクトルが混ざった値になる
//  2. ライブ(rAF毎≒60回/秒で平滑)とアップロード解析(100msホップ毎で平滑)では
//     平滑の効きが約6倍違い、同じ演奏でも数値が一致しない
//  3. 倍音レベルはFFTビン格子(5.86Hz刻み)の±2ビン最大値で、ピークがビン間に
//     落ちると過小評価、ビブラートでビンをまたぐと値が揺れる
//  4. HNRの倍音帯域が固定±15Hzで、ビブラート時に上位倍音(第8倍音は±20¢で±40Hz
//     動く)が帯域から外れ「ノイズ」側に計上され、HNRが不当に下がる
//  5. HNR・重心とも全帯域(〜24kHz)を対象にしており、マイクのヒスや低域ランブルが
//     値を左右する(奏者ではなく機材・部屋を測ってしまう)
//
// 本実装は時間波形の直近W=8192サンプルからHann窓つきFFTで毎回独立に計算する。
// 平滑ゼロ・ライブとアップロード解析で完全に同一の計算になる。
//  - 倍音: n×f0を中心とする帯域(±(15Hz + n×f0の1.5%))のエネルギー和の平方根。
//    15Hzの固定分はHann窓のメインローブ+スカート、比例分はビブラートによる
//    周波数の振れ(±25¢で第n倍音はn×f0の約1.5%動く)をカバーする。
//    帯域全体を積分するためビン格子への丸め誤差がほぼ消え、
//    ビブラートで広がったエネルギーも取りこぼさない(MPMのサブセント精度のf0前提)
//  - HNR: 倍音帯域は上と同じ次数比例幅。評価帯域を楽器帯(0.5×f0〜(倍音数+0.5)×f0)に
//    限定し、帯域外のヒス・ランブルを評価から除外する
//  - 重心: 10kHz以下かつ「ピーク-60dB」と「ビン中央値(≒ノイズ床)の6倍」の
//    大きい方を超えるビンだけで加重平均し、弱音時にノイズ床が重心を引っ張るのを防ぐ
//
// 窓長は8192固定(倍音の分離には周波数分解能が要るため短縮しない)。音の遷移で前の音が
// 窓に混ざる問題は、表示側の中央値スムージング(遷移フレームを弾く)と、音替わり直後の
// 測定除外(呼び出し側)で扱う。
// ============================================================
function computeTimbreMetrics(timeBuf, sampleRate, f0, numHarmonics = 8) {
  const W = 8192;
  if (!timeBuf || timeBuf.length < W || !f0 || f0 <= 0) return null;
  // Hann窓は毎tick使うため関数プロパティにキャッシュする(モジュール変数だと
  // scripts/pitch-test.mjsの関数単位抽出で切り離されるため、関数内に閉じる)
  if (!computeTimbreMetrics._hann) {
    const h = new Float64Array(W);
    for (let i = 0; i < W; i++) h[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W);
    computeTimbreMetrics._hann = h;
  }
  const hann = computeTimbreMetrics._hann;
  const offset = timeBuf.length - W;

  // DC除去 + Hann窓
  let mean = 0;
  for (let i = 0; i < W; i++) mean += timeBuf[offset + i];
  mean /= W;
  const re = new Float64Array(W);
  const im = new Float64Array(W);
  for (let i = 0; i < W; i++) re[i] = (timeBuf[offset + i] - mean) * hann[i];
  fftRadix2(re, im);

  const bins = W / 2;
  const binHz = sampleRate / W;
  const mags = new Float64Array(bins);
  for (let k = 0; k < bins; k++) mags[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);

  // --- 倍音レベル: n×f0周辺帯域のエネルギー和の平方根 ---
  const nyquist = sampleRate / 2;
  const harmonics = [];
  for (let n = 1; n <= numHarmonics; n++) {
    const target = f0 * n;
    if (target >= nyquist) { harmonics.push({ n, freq: target, mag: 0 }); continue; }
    const bw = 15 + 0.015 * target; // 窓の広がり(15Hz) + ビブラートの振れ(次数比例)
    const lo = Math.max(1, Math.ceil((target - bw) / binHz));
    const hi = Math.min(bins - 1, Math.floor((target + bw) / binHz));
    let energy = 0;
    for (let k = lo; k <= hi; k++) energy += mags[k] * mags[k];
    harmonics.push({ n, freq: target, mag: Math.sqrt(energy) });
  }

  // --- スペクトル重心: 10kHz以下・ノイズ床より十分上のビンのみで加重平均 ---
  const centroidMaxBin = Math.min(bins - 1, Math.floor(10000 / binHz));
  let peakMag = 0;
  for (let k = 1; k <= centroidMaxBin; k++) if (mags[k] > peakMag) peakMag = mags[k];
  // 除外閾値はノイズ床適応: ビンの中央値はほぼノイズ床の高さになるため、その6倍を
  // 下回るビンはノイズとして捨てる。クリーンな信号では中央値≒0となり、
  // ピーク-60dBの固定閾値だけが効く(弱い倍音を誤って捨てない)。
  const sortedMags = mags.slice(1, centroidMaxBin + 1).sort();
  const medianMag = sortedMags[sortedMags.length >> 1];
  const floorMag = Math.max(peakMag * 1e-3, medianMag * 6);
  let magSum = 0, weighted = 0;
  for (let k = 1; k <= centroidMaxBin; k++) {
    if (mags[k] >= floorMag) { magSum += mags[k]; weighted += k * binHz * mags[k]; }
  }
  const centroidHz = magSum > 1e-12 ? weighted / magSum : 0;

  // --- HNR: 評価帯域(0.5×f0〜(倍音数+0.5)×f0)内で倍音帯域とそれ以外を分ける ---
  const evalLo = Math.max(1, Math.round((0.5 * f0) / binHz));
  const evalHi = Math.min(bins - 1, Math.round(((numHarmonics + 0.5) * f0) / binHz));
  let harmonicEnergy = 0, totalEnergy = 0;
  for (let k = evalLo; k <= evalHi; k++) {
    const p = mags[k] * mags[k];
    totalEnergy += p;
    const fk = k * binHz;
    const n = Math.round(fk / f0);
    if (n >= 1 && n <= numHarmonics) {
      const bw = 15 + 0.015 * f0 * n; // 倍音レベルと同じ帯域定義
      if (Math.abs(fk - n * f0) <= bw) harmonicEnergy += p;
    }
  }
  const noiseEnergy = totalEnergy - harmonicEnergy;
  let hnrDb;
  if (harmonicEnergy <= 0) hnrDb = -20;
  else if (noiseEnergy <= 0) hnrDb = 60;
  else hnrDb = Math.max(-20, Math.min(60, 10 * Math.log10(harmonicEnergy / noiseEnergy)));

  return { harmonics, centroidHz, hnrDb };
}

// ============================================================
// Match score: pitch & timbre (Python検証: algo_match_score.py を移植)
// ============================================================
function pitchMatchScore(centsError, toleranceCents = 50) {
  const x = centsError / toleranceCents;
  return Math.exp(-0.5 * x * x);
}

function timbreMatchScore(measuredHarmonicsNorm, referenceHarmonicsNorm, measuredCentroid, referenceCentroid, measuredHnr, referenceHnr) {
  const wHarm = 0.6, wCentroid = 0.25, wHnr = 0.15;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < measuredHarmonicsNorm.length; i++) {
    dot += measuredHarmonicsNorm[i] * referenceHarmonicsNorm[i];
    normA += measuredHarmonicsNorm[i] ** 2;
    normB += referenceHarmonicsNorm[i] ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  const harmScore = denom > 1e-10 ? Math.max(0, dot / denom) : 0;

  const relErr = referenceCentroid > 0 ? Math.abs(measuredCentroid - referenceCentroid) / referenceCentroid : 1;
  const centroidScore = Math.exp(-3.0 * relErr);

  const hnrDiff = Math.abs((measuredHnr ?? 0) - (referenceHnr ?? 0));
  const hnrScore = Math.exp(-hnrDiff / 15.0);

  const total = wHarm * harmScore + wCentroid * centroidScore + wHnr * hnrScore;
  return Math.min(1, Math.max(0, total));
}

function scoreToColor(score) {
  const s = Math.min(1, Math.max(0, score));
  // ライトモード(白背景)で視認できる濃色: 0.0=赤#DC2626 / 0.5=アンバー#D97706 / 1.0=緑#16A34A
  const stops = [
    [0.0, [0xdc, 0x26, 0x26]],
    [0.5, [0xd9, 0x77, 0x06]],
    [1.0, [0x16, 0xa3, 0x4a]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [s0, c0] = stops[i];
    const [s1, c1] = stops[i + 1];
    if (s >= s0 && s <= s1) {
      const t = s1 !== s0 ? (s - s0) / (s1 - s0) : 0;
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return `rgb(${r},${g},${b})`;
    }
  }
  return "rgb(22,163,74)";
}

// ============================================================
// リード総合評価スコア (Python検証: algo_reed_score.py を移植)
// 企画書v5 10.4(c)節: HNR30% / 音量安定性25% / ピッチ安定性25% / 重心近似度20%
// ============================================================
function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// フレームの信頼度重み(=MPMのclarity 0..1)。ゲート通過後のclarityは0.8〜1.0の範囲で、
// 際どい検出(0.8近辺)ほど平均値への寄与を下げる。clarity記録前の旧データは1として扱う。
function frameWeight(f) {
  const c = f?.clarity;
  return c === null || c === undefined ? 1 : c;
}

// 音色(倍音・重心・HNR)の集計対象フレームか。ノート冒頭のアタック過渡(noteAgeMs <
// TIMBRE_SUSTAIN_MS)はスペクトルが定常でないため平均から除外する。
// noteAgeMs未記録の旧データは従来どおり集計に含める(後方互換)。
function timbreSustained(f) {
  const age = f?.noteAgeMs;
  return age === null || age === undefined || age >= TIMBRE_SUSTAIN_MS;
}

// clarity重み付き平均。全フレームの平均をとる集計はすべてこれを通す
// (計測タブ・データタブ・ピボットで同じ重み付けになり、値が食い違わない)。
function weightedMean(frames, getValue) {
  let ws = 0, vs = 0;
  for (const f of frames) {
    const v = getValue(f);
    if (v === null || v === undefined || isNaN(v)) continue;
    const w = frameWeight(f);
    ws += w;
    vs += w * v;
  }
  return ws > 0 ? vs / ws : null;
}

// 保存前のフレーム列から単発のピッチ誤検出を除去する。
// 連続する有音3フレームの中央値からPITCH_OUTLIER_CENTS以上外れた真ん中のフレーム
// (オクターブ誤検出=±1200¢が典型)を無音扱いに置き換える。速いパッセージの実音は
// 隣接音でも±数百¢のため閾値未満で残る。2フレーム以上続く誤検出は対象外(実音とみなす)。
function sanitizePitchOutliers(frames, outlierCents = PITCH_OUTLIER_CENTS) {
  if (!frames || frames.length < 3) return frames;
  const cents = frames.map((f) => (f.pitchHz ? 1200 * Math.log2(f.pitchHz / 440) : null));
  const out = frames.slice();
  for (let i = 1; i < frames.length - 1; i++) {
    const a = cents[i - 1], b = cents[i], c = cents[i + 1];
    if (a === null || b === null || c === null) continue;
    const med = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    if (Math.abs(b - med) > outlierCents) {
      // ピッチもそこから導いた音名・音色(誤ったf0で測定されている)もすべて無効化する
      out[i] = {
        ...frames[i],
        pitchHz: null, pitchCents: null, matchedWrittenNote: null, concertNote: null,
        semitoneIndex: null, derivedTubeLengthCm: null, spectralCentroidHz: null,
        hnrDb: null, harmonics: [], clarity: null,
        matchScore: { pitch: { theoretical: 0, ideal: 0 }, timbre: { ideal: 0 } },
      };
    }
  }
  return out;
}

// ピッチ集計の入口ゲート(F-44)。保存データは変更せず、ピッチの平均・音階ごとの平均に
// 使うフレームだけを選ぶ純関数。入力は変更しない。
//   1) 同一semitoneIndexの連続区間(run)に分割(音替わり・無音ギャップ・tの逆行=
//      セッション連結境界で切る)
//   2) 前後の安定区間に挟まれた短い区間が、オクターブ/12度だけ離れていたら丸ごと除外
//      (2フレーム以上続く倍音誤検出はsanitizePitchOutliers=単発用を素通しするため)。
//      pitchCentsは最寄り半音との差(±50¢)なのでオクターブ誤検出が見えない。判定は
//      絶対セント(1200*log2(pitchHz/440))の中央値で行う
//   3) 残った各区間の両端をトリム(アタックのしゃくり・スラーで指だけ変えた音替わりの過渡。
//      noteAgeMsは音量ベースでしかリセットされずスラーでは効かないため、tで直接切る)
// semitoneIndexがnullのフレーム(運指範囲外=アルティッシモ等)は区間に入らず自然に
// 除外される(意図した仕様変更: 音階に紐付かない音はピッチ集計から外す)。
// 音量・音色の集計とタイムライン表示(PhraseTimeline)はこのゲートを通らない。
function selectPitchAggregationFrames(frames) {
  const list = frames || [];
  const gapSec = PITCH_RUN_GAP_MS / 1000;
  const flipMaxSec = PITCH_FLIP_MAX_MS / 1000;
  // 1) run分割。idxは元配列のインデックス列(配列順のまま)
  const runs = [];
  let cur = null;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const si = f?.semitoneIndex;
    if (si === null || si === undefined) { cur = null; continue; }
    if (cur) {
      const dt = f.t - list[cur.idx[cur.idx.length - 1]].t;
      // 音替わり / t逆行(セッション連結境界。!(dt>=0)はtが無い旧データのNaNも区間を切る) / 無音ギャップ
      if (si !== cur.semitoneIndex || !(dt >= 0) || dt > gapSec) cur = null;
    }
    if (!cur) { cur = { semitoneIndex: si, idx: [] }; runs.push(cur); }
    cur.idx.push(i);
  }
  const tFirst = (r) => list[r.idx[0]].t;
  const tLast = (r) => list[r.idx[r.idx.length - 1]].t;
  const durOf = (r) => tLast(r) - tFirst(r);
  // 区間の絶対セント中央値(=A4からの距離)。オクターブ誤検出はここでしか見えない
  const medAbs = (r) => median(
    r.idx.map((i) => list[i].pitchHz).filter((hz) => hz > 0).map((hz) => 1200 * Math.log2(hz / 440)));
  // 2) オクターブ/12度誤検出ランの除外
  const excludedRuns = new Set();
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    if (durOf(r) > flipMaxSec) continue; // 疑うのは短い区間だけ(実奏のオクターブ跳躍を誤爆しない)
    const p = runs[k - 1], n = runs[k + 1];
    if (!p || !n) continue;
    // 時間的に隣接している場合だけ(gap<0はt逆行=連結境界。跨いで判定しない)
    const gapP = tFirst(r) - tLast(p);
    const gapN = tFirst(n) - tLast(r);
    if (!(gapP >= 0 && gapP <= gapSec && gapN >= 0 && gapN <= gapSec)) continue;
    if (!(durOf(p) > flipMaxSec && durOf(n) > flipMaxSec)) continue; // 前後が両方とも安定区間の場合だけ
    const mp = medAbs(p), mn = medAbs(n), mr = medAbs(r);
    if (mp === null || mn === null || mr === null) continue;
    if (Math.abs(mp - mn) > PITCH_FLIP_NEIGHBOR_AGREE_CENTS) continue; // 前後の区間の音程が近い(±200¢=全音以内で一致する)場合だけ
    const jump = Math.abs(mr - mp); // 上下どちらの誤検出も絶対差で拾う
    if (PITCH_FLIP_INTERVALS_CENTS.some((iv) => Math.abs(jump - iv) <= PITCH_FLIP_TOLERANCE_CENTS)) {
      excludedRuns.add(r);
    }
  }
  // 3) 両端トリム。離散化で1つも残らない短い音は中央の1フレームを採用する(全滅させない)
  const selected = new Set();
  for (const r of runs) {
    if (excludedRuns.has(r)) continue;
    const t0 = tFirst(r), t1 = tLast(r);
    const e = Math.min(PITCH_EDGE_TRIM_MS / 1000, (t1 - t0) / 3);
    let any = false;
    for (const i of r.idx) {
      if (list[i].t >= t0 + e && list[i].t <= t1 - e) { selected.add(i); any = true; }
    }
    if (!any) selected.add(r.idx[r.idx.length >> 1]); // インデックス中央の1フレーム
  }
  // 透明性のための集計: totalはpitchCentsが非nullのフレーム総数。semitoneIndexがnullで
  // pitchCentsを持つフレーム(運指範囲外)もexcludedに数える
  let total = 0, used = 0;
  for (let i = 0; i < list.length; i++) {
    const v = list[i]?.pitchCents;
    if (v === null || v === undefined || isNaN(v)) continue;
    total++;
    if (selected.has(i)) used++;
  }
  return { selected, total, used, excluded: total - used };
}

// 音名グルーピングのヒステリシス。実測f0が前フレームの判定音から±holdCents以内なら
// 音名を切り替えない(半音境界±50¢ちょうどの音でフレーム毎に隣の音名と行き来する
// チャタリングを防ぐ)。メーター表示(freqToNote)は正確さ優先で従来どおり生のまま。
function holdFingering(prevEntry, f0, candidate, holdCents = NOTE_SWITCH_CENTS) {
  if (!prevEntry || !candidate || !f0) return candidate;
  if (candidate.semitoneIndex === prevEntry.semitoneIndex) return candidate;
  const centsVsPrev = 1200 * Math.log2(f0 / prevEntry.soundingFreqHz);
  if (Math.abs(centsVsPrev) <= holdCents) return { ...prevEntry, centsError: centsVsPrev };
  return candidate;
}

// 実測f0に対する運指判定の共通処理: 最近傍検索 → 音名ヒステリシス → 範囲外リジェクト。
// 運指テーブルの範囲から±FINGERING_MATCH_MAX_CENTS超外れた音(アルティッシモや
// 他楽器の音等)は「最も近い端の運指」に無理に紐付けず、運指なし(null)として扱う
// (ピッチ・実音名の記録には影響しない。音階グルーピングだけが対象外になる)。
// ライブ計測とオフライン解析の両方からこれを使い、判定を完全に一致させる。
function matchFingering(prevEntry, f0, fingeringTable) {
  const m = holdFingering(prevEntry, f0, findClosestFingering(f0, fingeringTable));
  if (m && Math.abs(m.centsError) > FINGERING_MATCH_MAX_CENTS) return null;
  return m;
}

// RBJ Audio-EQ-Cookbook のバンドパス(ピーク0dB)を1回通すIIRフィルタ。
// Web AudioのBiquadFilterNode(type:"bandpass")と同じ伝達関数で、アップロード解析の
// ノイズゲート判定にライブ計測(バンドパス→gateAnalyser)と同一の帯域限定音量を使うためのもの。
function applyBandpassRBJ(input, sampleRate, centerHz, q) {
  const w0 = (2 * Math.PI * centerHz) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW0 = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0;
  const a1 = (-2 * cosW0) / a0, a2 = (1 - alpha) / a0;
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return out;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stddev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 運指の半音インデックスから音域帯(low/mid/high)を判定する分類(分析タブのクロス集計で使用)。
// 運指(記音)は全楽器共通のため閾値も楽器によらず1つで済む。境界は各楽器の実音での
// 指定(例: アルト低音域=A4以下、中音域=A5〜B♭4、高音域=B♭5以上)を記音の半音
// インデックスに変換したもので、移調量が異なっていても4楽器すべてで同じ値になる
// (低音域<=20=記音F♯5、中音域21〜32=記音G5〜F♯6、高音域>=33=記音G6以上)。
function registerBand(semitoneIndex, lowMax = 20, midMax = 32) {
  if (semitoneIndex === null || semitoneIndex === undefined) return "unknown";
  if (semitoneIndex <= lowMax) return "low";
  if (semitoneIndex <= midMax) return "mid";
  return "high";
}

const REGISTER_BAND_LABELS = { low: "低音域", mid: "中音域", high: "高音域", unknown: "不明" };

// ============================================================
// リード登録用マスタデータ
// 銘柄: 初期リスト(一般的なメーカー) + ユーザーが自由入力した銘柄を自動追加
// 番手: 2.0〜4.0を0.5刻み
// ============================================================
const INITIAL_REED_BRANDS = [
  "Vandoren", "Rico (D'Addario)", "Légère", "Marca", "Rigotti", "Silverstein", "Alexander",
];

const REED_STRENGTHS = ["2.0", "2.5", "3.0", "3.5", "4.0"];

const REED_BOX_SIZE = 10; // リード1箱あたりの枚数

// ============================================================
// リードのグルーピング・表示名ヘルパー
// 銘柄・番手・使用開始日が同じリードは「同じ箱」とみなし、
// 登録順(createdAt)で1からの通し番号を振る。一覧表示・データ分析での
// 個体識別(#N)に共通して使う。
// ============================================================
function reedGroupKey(r) {
  return `${r.brand}|${r.strength}|${r.startDate}`;
}

// 箱の中のタイルの並び順。表示順(sortOrder)が主で、長押し並び替えで変わる。
// 管理番号(boxNumber)とは独立。sortOrder 未設定のものは登録順(createdAt)で後ろに続く。
// **groupReeds と箱の合流(ReedRegisterView の updateGroup)が同じ規則を使う。**
// 2箇所に書くと必ず食い違い、「並べ直したのに一覧の順が違う」という壊れ方をする。
function reedMemberOrder(a, b) {
  const an = a.sortOrder ?? Infinity;
  const bn = b.sortOrder ?? Infinity;
  if (an !== bn) return an - bn;
  return new Date(a.createdAt) - new Date(b.createdAt);
}

function groupReeds(reeds) {
  const groups = {};
  for (const r of reeds) {
    const key = reedGroupKey(r);
    if (!groups[key]) groups[key] = { key, brand: r.brand, strength: r.strength, startDate: r.startDate, members: [] };
    groups[key].members.push(r);
  }
  for (const g of Object.values(groups)) g.members.sort(reedMemberOrder);
  return Object.values(groups).sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
}

function reedPosition(reed, reeds) {
  if (reed.boxNumber) return reed.boxNumber; // 手動で編集された番号があれば自動採番より優先する
  const key = reedGroupKey(reed);
  const group = reeds.filter((r) => reedGroupKey(r) === key).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const idx = group.findIndex((r) => r.id === reed.id);
  return idx >= 0 ? idx + 1 : null;
}

// 【N-4a】計測タブの上部設定行で使う、箱の短い表記。「Vandoren V16」+「3.0」→「V16-3」。
// 本人指示「要素は最小限にしたいので V16-3 #4 の形に」。
//
// 短縮は**銘柄の最後の語**(=型番。"Vandoren V16" の "V16"、"D'Addario Select" の "Select")を採る。
// ただし登録済みの銘柄の中で最後の語が衝突する場合(例: "Vandoren Java" と "Marca Java")は、
// **その銘柄だけ**フルの銘柄名に戻す。衝突しているのに同じ表記になると、どの箱を選んでいるのか
// 画面から判別できなくなるため。判定は「いま登録されている銘柄の集合」に対して行うので、
// 銘柄が増えて衝突が生まれた時点で自動的にフル表記へ切り替わる。
// 番手は末尾の ".0" だけ落とす("3.0"→"3" / "2.5"→"2.5")。
function shortBoxLabel(brand, strength, allBrands) {
  const b = String(brand ?? "").trim();
  if (!b) return String(strength ?? "");
  const last = b.split(/\s+/).pop();
  const collides = (allBrands || []).some((other) => {
    const o = String(other ?? "").trim();
    return o && o !== b && o.split(/\s+/).pop() === last;
  });
  const head = collides ? b : last;
  const s = String(strength ?? "").replace(/\.0$/, "");
  return s ? `${head}-${s}` : head;
}

// 【N-4b / B-2】録音の経過時間 m:ss。正典の .rectime(赤点 + 1:24)の表記。
// 秒は必ず2桁ゼロ埋め、分は桁上がりしても切らない(60分を超えたら 60:00 と出す)。
// 負値・非数は 0:00 に落とす(実時計の巻き戻りで "-1:59" のような表示を作らない)。
function formatElapsedMs(ms) {
  const total = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// 【N-6】セッション一覧の副次行に出す録音時間(m:ss)。
// **録音時間そのものは保存されていない。** フレーム列の最後の `t`(録音開始からの経過秒)が
// 唯一の手がかりなので、そこから導く。フレームが1つも無い/最後の `t` が読めないセッションは
// null を返し、呼び出し側が**時間の区画ごと省く**(「0:00」を出すと「0秒録った」と読める)。
// 表記(m:ss・秒は2桁ゼロ埋め)は録音中バッジと同じ formatElapsedMs に委ねる。同じ表記を2つ作らない。
// 【N-10】1セッションの録音長(秒)。**「最後のフレームの t」という規則はここ1箇所だけ**に置く
// (一覧の m:ss も My Data の総演奏時間も同じ値から出す。同じ規則を2箇所に書かない)。
function sessionDurationSec(session) {
  const frames = session?.frames;
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const t = frames[frames.length - 1]?.t;
  if (t === null || t === undefined || typeof t !== "number" || isNaN(t) || t < 0) return null;
  return t;
}
function sessionDurationLabel(session) {
  const t = sessionDurationSec(session);
  if (t === null) return null;
  return formatElapsedMs(t * 1000);
}

// 一覧に生のISO文字列("2026-07-31")を出さないための表示用フォーマッタ。
// 【N-2 表記統一】表示用の日付はこの1関数に寄せ、yyyy/mm/dd(ゼロ埋め)に統一する。
// 時刻が付く場所は { time: true } で yyyy/mm/dd hh:mm。
// 値が無い/壊れている場合は null を返し、呼び出し側で「未設定」等の文言に振り替える
// (欠測でも行が崩れないようにするため、ここでは空文字を返さない)。
// input[type=date] / datetime-local のネイティブ値(yyyy-MM-dd形式)はここを通さない。
function formatYmd(dateStr, opts) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const p2 = (n) => String(n).padStart(2, "0");
  const ymd = `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())}`;
  // 【D-1】timeOnly: 時刻だけ(カレンダーの「選択日のセッション」の行頭)。
  // 日付は見出しが出しているので行では繰り返さない。時刻の綴りを2箇所に持たないため
  // ここに足す(新しい書式関数を作らない)。
  if (opts?.timeOnly) return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return opts?.time ? `${ymd} ${p2(d.getHours())}:${p2(d.getMinutes())}` : ymd;
}

// 【D-1】「8月21日」。カレンダーの選択日の見出しと、日のラベル(読み上げ)が使う。
function formatMonthDay(d) {
  const t = d instanceof Date ? d : new Date(d);
  if (isNaN(t.getTime())) return "";
  return `${t.getMonth() + 1}月${t.getDate()}日`;
}

// ローカル暦日のキー(YYYY-MM-DD)。**この組み立てはアプリ内でここ1箇所だけ**。
//
// 【`new Date().toISOString().slice(0, 10)` を使ってはいけない】あれは **UTC の暦日**で、
// JST(UTC+9)では 00:00〜09:00 の間ずっと1日前の日付になる。
// N-5 の審査で実測: ローカル 2026-08-14 00:55 に「10枚の箱を追加」→ 保存された開封日が
// **2026-08-13**、箱見出しも 2026/08/13 と1日前になった。
// リードでは表示だけの問題では済まない:
//   - reedGroupKey は `銘柄|番手|開封日` なので、同じ実日の 08:00 と 10:00 で**箱が2つに割れる**
//   - usageDays の「開封 n日」も1日ずれる
// 評価履歴の同日判定(reedRatingDayKey)は元からローカル暦日で組んであり、そちらのコメントが
// この式を名指しで禁じていた。リードの開封日も同じ組み立てに揃える。
function localDayKey(d) {
  const p2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

// リード1本ぶんの計測フレーム総数。ReedCompareTab が同じ集計をローカルに持っており
// (「Nフレーム」の表示に使っている)、リード登録一覧の「育てる」表示でも同じ数を使う。
// 新しい集計は足さない: この関数と usageDays() の2つだけで「開封からの日数 / 使用量」を出す。
function frameCountFor(sessions, reedId) {
  return sessions.filter((s) => s.reedId === reedId).reduce((n, s) => n + (s.frames?.length ?? 0), 0);
}

function reedLabel(reed, reeds) {
  if (!reed) return "";
  const pos = reedPosition(reed, reeds);
  return `${reed.brand} ${reed.strength} #${pos}(${formatYmd(reed.startDate) ?? "—"})`;
}

// 【N-6】セッション一覧の副次行に出す短いリード表記「V16-3 #4」(短縮規則は N-4a の
// shortBoxLabel が唯一の答え)。長い形(reedLabel)は選択肢の一覧など、区別が要る場所で使い続ける。
// リードが無い(未紐付け)ときは null を返し、呼び出し側が文言に振り替える。
function reedShortLabel(reed, reeds) {
  if (!reed) return null;
  return `${shortBoxLabel(reed.brand, reed.strength, reeds.map((r) => r.brand))} #${reedPosition(reed, reeds)}`;
}

// (【N-11 2026/08/17 本人指示】bulkReedOptionLabel = 一括リード変更の <select> の選択肢の
//  短い表記「V16-3 #1 (2026/08/13)」はここにあったが、**一括リード変更の機能そのものを
//  削除した**(本人「「選択」が何の選択か分からない → リードをまとめて変更の機能を削除し、
//  選択＝削除だけに」)ため、読み手が1つも無くなり定義ごと消した。
//  F-85 で対処した select の固有幅の問題も、その select ごと無くなった。)

// ============================================================
// データ永続化(IndexedDB)
//
// 「データを撮りためることで検証の質が上がる」という方針のため、
// リード・セッション・理想値プロファイルはページのリロードや再訪問を
// またいで残す必要がある。localStorage(5〜10MB程度)はフレーズ録音の
// フレーム列(100ms間隔)が積み重なるとすぐ枯渇するため、より大きな
// クォータを持つIndexedDBを使う。単一のkvストアにキー毎の値を丸ごと
// 保存する単純な方式(このアプリの規模ではクエリ機能は不要なため)。
// ============================================================
const IDB_NAME = "windToneLabDB";
const IDB_STORE = "kv";
const SESSIONS_STORE = "sessions"; // セッションはレコード単位のストア(理由は下記usePersistedState/useSessionsStoreのコメント参照)
const IDB_VERSION = 2;

function openIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("indexedDB unavailable")); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) db.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined; // プライベートブラウジング等でIndexedDBが使えない場合は諦めて初期値を使う
  }
}

async function idbSet(key, value) {
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 書き込み失敗時も画面操作自体は継続させる(永続化できないだけに留める)
  }
}

// key別にIndexedDBへ自動保存するstateフック。マウント時に非同期で読み込み、
// 以後の変更は逐次書き込む(読み込み完了前の書き込みで初期値により上書きしないようloadedRefで防ぐ)。
//
// 【F-101 2026/08/17 本人指示】タブ切替(navNonce の再マウント)のたびに useState(initialValue) から
// 始まるため、IndexedDB の読み込みが解決するまでの数ms〜数十ms、既定値(期間セレクタなら「1ヶ月」)が
// 一瞬見えるフリッカがあった。**一度読めた値はモジュールスコープの Map に保持**し、再マウント時は
// キャッシュから初期化する(読めていれば初回描画から保存値が出る)。
//   ・初回起動(キャッシュ未加載)の挙動は不変: 従来どおり initialValue で始まり idbGet を待つ。
//   ・cache.get(key) ?? initialValue にしない理由: null は正当な保存値(selectedReedId 等)なので、
//     ?? だと null が既定値に化ける。有無は has() で判定する。
const persistedStateCache = new Map();
function usePersistedState(key, initialValue) {
  const [state, setState] = useState(() => (persistedStateCache.has(key) ? persistedStateCache.get(key) : initialValue));
  const loadedRef = useRef(persistedStateCache.has(key));

  useEffect(() => {
    let cancelled = false;
    idbGet(key).then((saved) => {
      if (cancelled) return;
      if (saved !== undefined) { persistedStateCache.set(key, saved); setState(saved); }
      loadedRef.current = true;
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loadedRef.current) { persistedStateCache.set(key, state); idbSet(key, state); }
  }, [key, state]);

  return [state, setState];
}

// --- セッション専用のレコード単位ストア -------------------------------
// 【重要】録音停止のたびに10秒以上のラグが発生していた原因はこれだった。
// usePersistedStateはstateが変わるたび配列全体をIndexedDBに書き込むため、
// セッション履歴(フレーム列を含む)が蓄積するほど1回の書き込みが重くなり、
// 「データを撮りためる」というアプリの目的そのものと衝突していた。
// セッションだけはkeyPath:"id"の専用ストアにして、変更のあった1件だけを
// put/deleteする方式にし、書き込みコストをセッション総数と切り離す。
async function idbGetAllSessions() {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, "readonly");
      const req = tx.objectStore(SESSIONS_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function idbPutSessions(sessionsToWrite) {
  if (sessionsToWrite.length === 0) return;
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, "readwrite");
      const store = tx.objectStore(SESSIONS_STORE);
      for (const s of sessionsToWrite) store.put(s);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 書き込み失敗時も画面操作自体は継続させる
  }
}

async function idbDeleteSessions(ids) {
  if (ids.length === 0) return;
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SESSIONS_STORE, "readwrite");
      const store = tx.objectStore(SESSIONS_STORE);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 削除失敗時も画面操作自体は継続させる
  }
}

// sessions配列をReact state上では今まで通り扱いつつ、書き込みだけは変更のあった
// レコードに限定する。addSession: 新規1件追加。updateSessions: 関数更新の結果、
// 中身が変わったレコードだけを差分検出してIndexedDBに書き込む。
function useSessionsStore() {
  const [sessions, setSessionsState] = useState([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    idbGetAllSessions().then((all) => {
      if (cancelled) return;
      // 音名表記統一(D#→E♭, A#→B♭)より前に保存されたフレームの音名表記を一度だけ変換して書き戻す
      const migrated = all.map((s) => {
        const frames = s.frames;
        if (!frames?.some((f) => f.matchedWrittenNote?.startsWith("D#") || f.matchedWrittenNote?.startsWith("A#"))) return s;
        return { ...s, frames: frames.map((f) => (f.matchedWrittenNote ? { ...f, matchedWrittenNote: migrateNoteSpelling(f.matchedWrittenNote) } : f)) };
      });
      const changed = migrated.filter((s, i) => s !== all[i]);
      if (changed.length > 0) idbPutSessions(changed);
      setSessionsState(migrated);
      loadedRef.current = true;
    });
    return () => { cancelled = true; };
  }, []);

  const addSession = useCallback((session) => {
    setSessionsState((prev) => [...prev, session]);
    idbPutSessions([session]);
  }, []);

  const updateSessions = useCallback((updater) => {
    setSessionsState((prev) => {
      const next = updater(prev);
      const prevById = new Map(prev.map((s) => [s.id, s]));
      const changed = next.filter((s) => prevById.get(s.id) !== s);
      if (changed.length > 0) idbPutSessions(changed);
      return next;
    });
  }, []);

  const deleteSessions = useCallback((ids) => {
    const idSet = new Set(ids);
    setSessionsState((prev) => prev.filter((s) => !idSet.has(s.id)));
    idbDeleteSessions(ids);
  }, []);

  return [sessions, addSession, updateSessions, deleteSessions];
}

// ============================================================
// アップロード音声の解析
//
// マイク入力(ライブ)と同じ解析パイプラインを、アップロードされた音声/動画ファイルにかける。
// 1フレーム分の解析ロジックはcreateFrameAnalyzer()に切り出し、
// 「AudioBufferを取れた場合(高速なオフライン処理)」「取れなかった場合
// (動画コンテナ等、<video>要素での再生を通す実時間フォールバック)」の
// 両方から共通で使う。
// ============================================================

// 1フレーム分の解析(ピッチ・倍音・ノート区間検出)を行う共通ロジック。
// analyser/sampleRate/経過時間(ms)を渡すたびに呼び、必要ならframesに1件追加する。
// オフライン解析(analyzeAudioBuffer)・リアルタイム解析(analyzeMediaFile)の両方から呼ばれる。
// 楽器音の判定はライブ計測と同一: 計測下限dB(ノイズゲート)+ヒステリシス、MPMのclarity、
// 音色系(重心/HNR/倍音)はさらに余裕(TIMBRE_EXTRA_DB)のある音量でだけ測定する。
// これにより、ほぼ無音の区間やノイズ区間から誤ったピッチ・音色データが記録されるのを防ぐ。
function createFrameAnalyzer({ saxType, tuningHz, instrumentOffsetCents, temperature, selectedIdeal, noiseGateDb = NOISE_GATE_DEFAULT_DB }) {
  const preset = SAX_PRESETS[saxType];
  const effectiveTuningHz = tuningHz * Math.pow(2, instrumentOffsetCents / 1200);
  const fingeringTable = buildFingeringTable(saxType, effectiveTuningHz);
  const { minFreq: pitchMinFreq, maxFreq: pitchMaxFreq } = saxPitchBounds(saxType, effectiveTuningHz);
  const FFT_SIZE = 8192;
  const NUM_HARMONICS = 8;
  const SAMPLE_INTERVAL_MS = 100;
  const ATTACK_WINDOW_MS = 400;

  const frames = [];
  const noteDetector = { phase: "silence", onsetMs: 0, peakDb: -100, samples: [], events: [] };
  let lastSampleMs = -Infinity;
  let sounding = false; // 発音中フラグ(ヒステリシス判定に使う。ライブのsoundingRefに相当)
  let lastFinger = null; // 音名グルーピングのヒステリシス用(前フレームの判定運指)

  const tick = (analyser, sampleRate, elapsedMs) => {
    // 時間領域波形(RMS音量・MPMピッチ検出・音色測定のすべてに使う)。
    // 旧実装はここでanalyser.getFloatFrequencyData(平滑済みスペクトル)も読んで
    // 音色を計算していたが、computeTimbreMetricsが時間波形から自前計算するため不要。
    let timeBuf = null;
    if (analyser.getFloatTimeDomainData) {
      timeBuf = new Float32Array(FFT_SIZE);
      analyser.getFloatTimeDomainData(timeBuf);
    }

    // 音量はライブと同じ時間領域RMS(dBFS)。旧来のFFT振幅由来のdBはスケールが独自で、
    // ライブで設定した計測下限dBと比較できないため使わない。
    let vDb = -100;
    if (timeBuf) {
      let ss = 0;
      for (let i = 0; i < timeBuf.length; i++) ss += timeBuf[i] * timeBuf[i];
      vDb = 20 * Math.log10(Math.sqrt(ss / timeBuf.length) + 1e-10);
    }

    // ゲート判定用の帯域限定音量。ライブ計測はバンドパス後の音量で判定するため、
    // 解析元がバンドパス済み波形(getGateTimeDomainData)を提供できる場合はそれを使う。
    // 提供がない場合はフルバンドRMSにフォールバック(従来動作)。
    let gateDbLevel = vDb;
    if (analyser.getGateTimeDomainData) {
      const gb = new Float32Array(FFT_SIZE);
      analyser.getGateTimeDomainData(gb);
      let s2 = 0;
      for (let i = 0; i < gb.length; i++) s2 += gb[i] * gb[i];
      gateDbLevel = 20 * Math.log10(Math.sqrt(s2 / gb.length) + 1e-10);
    }

    // ピッチ検出はライブと同じMPM(時間領域)+clarityゲート
    let f0 = null;
    let mpmClarity = null; // フレームに信頼度として記録(集計の重み付けに使う)
    if (timeBuf) {
      const mpm = detectPitchMPM(timeBuf, sampleRate, pitchMinFreq, pitchMaxFreq);
      if (mpm && mpm.clarity >= PITCH_CLARITY_MIN) { f0 = mpm.freq; mpmClarity = mpm.clarity; }
    }

    // --- 楽器音の判定(ライブ計測と同一: バンドパス後音量のゲート+ヒステリシス) ---
    const hasPitch = !!(f0 && f0 > 40);
    const aboveGate = gateDbLevel > (sounding ? noiseGateDb - GATE_HYSTERESIS_DB : noiseGateDb);
    sounding = hasPitch && aboveGate;
    const timbreMeasurable = sounding && gateDbLevel > noiseGateDb + TIMBRE_EXTRA_DB;

    let levels = [];
    let hnr = null;
    let centroid = null;
    let matchedFinger = null;
    if (sounding) {
      // 最近傍検索+ヒステリシス+範囲外リジェクト(ライブと同一のmatchFingering)
      matchedFinger = matchFingering(lastFinger, f0, fingeringTable);
      lastFinger = matchedFinger;
    } else {
      lastFinger = null;
    }
    if (timbreMeasurable && timeBuf) {
      // 音色(倍音・重心・HNR)はライブと完全に同一の計算(computeTimbreMetrics)
      const tm = computeTimbreMetrics(timeBuf, sampleRate, f0, NUM_HARMONICS);
      if (tm) {
        const maxMag = Math.max(...tm.harmonics.map((l) => l.mag), 1e-6);
        levels = tm.harmonics.map((l) => ({ ...l, norm: l.mag / maxMag }));
        hnr = tm.hnrDb;
        centroid = tm.centroidHz;
      }
    }

    // --- ノート区間分割・アタック時間検出(企画書2.4節相当) ---
    // ノート境界は「楽器音と判定されているか(sounding)」で決める(ライブと同じ)。
    {
      const det = noteDetector;
      if (det.phase === "silence") {
        if (sounding) {
          det.phase = "attack"; det.onsetMs = elapsedMs; det.peakDb = vDb; det.samples = [{ t: elapsedMs, vDb }];
        }
      } else if (det.phase === "attack") {
        det.samples.push({ t: elapsedMs, vDb });
        if (vDb > det.peakDb) det.peakDb = vDb;
        if (!sounding) {
          det.phase = "silence";
        } else if (elapsedMs - det.onsetMs >= ATTACK_WINDOW_MS) {
          const target = det.peakDb - 3;
          const hit = det.samples.find((s) => s.vDb >= target);
          const attackTimeMs = hit ? Math.round(hit.t - det.onsetMs) : null;
          det.events.push({ startT: det.onsetMs / 1000, endT: null, attackTimeMs, peakVolumeDb: det.peakDb });
          det.phase = "sustain"; det.samples = [];
        }
      } else if (det.phase === "sustain") {
        if (vDb > det.peakDb) det.peakDb = vDb;
        if (!sounding) {
          const last = det.events[det.events.length - 1];
          if (last && last.endT === null) { last.endT = elapsedMs / 1000; last.peakVolumeDb = det.peakDb; }
          det.phase = "silence";
        }
      }
    }

    if (elapsedMs - lastSampleMs >= SAMPLE_INTERVAL_MS) {
      lastSampleMs = elapsedMs;
      // ピッチのセント誤差はライブと同じ「実効基準ピッチのfreqToNote」で統一する
      const noteNow = sounding ? freqToNote(f0, effectiveTuningHz) : null;
      const pitchCentsVsTheory = noteNow ? noteNow.centsExact : null;
      // 理想値は音(運指の半音インデックス)ごとに持つため、今判定されている音に対応する理想値を都度引く
      const noteIdeal = getNoteIdeal(selectedIdeal, matchedFinger?.semitoneIndex);
      const pitchCentsVsIdeal = sounding && noteIdeal?.pitchHz ? centsBetween(f0, noteIdeal.pitchHz) : null;
      const harmNorm = levels.length === NUM_HARMONICS ? levels.map((l) => l.norm) : new Array(NUM_HARMONICS).fill(0);
      const idealHarmNorm = noteIdeal?.harmonicsProfile ? noteIdeal.harmonicsProfile.map((h) => h.norm) : new Array(NUM_HARMONICS).fill(0);
      const pitchScoreTheory = pitchCentsVsTheory !== null ? pitchMatchScore(pitchCentsVsTheory) : 0;
      const pitchScoreIdeal = pitchCentsVsIdeal !== null ? pitchMatchScore(pitchCentsVsIdeal) : 0;
      const timbreScoreIdeal = noteIdeal && timbreMeasurable && centroid !== null
        ? timbreMatchScore(harmNorm, idealHarmNorm, centroid, noteIdeal.centroidHz, hnr, noteIdeal.hnrDb)
        : 0;

      frames.push({
        t: elapsedMs / 1000,
        pitchHz: sounding ? f0 : null,
        pitchCents: pitchCentsVsTheory,
        matchedWrittenNote: matchedFinger?.writtenLabel ?? null,
        concertNote: noteNow ? `${noteNow.name}${noteNow.octave}` : null,
        semitoneIndex: matchedFinger?.semitoneIndex ?? null,
        derivedTubeLengthCm: matchedFinger ? deriveTubeLengthCm(matchedFinger.soundingFreqHz, preset.bellRadiusCm, temperature) : null,
        clarity: sounding ? mpmClarity : null, // 検出信頼度(集計の重み)
        noteAgeMs: noteDetector.phase !== "silence" ? Math.round(elapsedMs - noteDetector.onsetMs) : null, // ノート開始からの経過(アタック除外判定用)
        volumeDb: vDb,
        spectralCentroidHz: centroid,
        hnrDb: hnr,
        harmonics: levels.map((l) => ({ n: l.n, freqHz: l.freq, levelNorm: l.norm })),
        matchScore: {
          pitch: { theoretical: pitchScoreTheory, ideal: pitchScoreIdeal },
          timbre: { ideal: timbreScoreIdeal },
        },
      });
    }
  };

  return { tick, frames, noteEvents: noteDetector.events };
}

// radix-2の反復型FFT(in-place)。MPMピッチ検出の自己相関と、音色測定
// (computeTimbreMetrics)のスペクトル計算に使う。ブラウザのOfflineAudioContext+
// ScriptProcessorNodeはSafari(iPhone含む)でレンダリングが永遠に完了しない既知の
// 不具合があるため、オーディオグラフに頼らずデコード済みPCMを直接処理する。
function fftRadix2(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const vRe = re[b] * curRe - im[b] * curIm;
        const vIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - vRe; im[b] = im[a] - vIm;
        re[a] += vRe; im[a] += vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

// ============================================================
// 動画から音声トラックだけをWebCodecsで高速デコードする(スマホ直撮り動画向け)。
// mp4box.jsでMP4/MOVコンテナをデマクスし、音声サンプルだけをAudioDecoderに流す。
// 動画トラックは一切デコードしないため、実時間再生に頼る旧フォールバックより桁違いに速い。
// 非対応環境(古いiOS等)・非対応コーデック・デマクス失敗時は例外を投げ、呼び出し側で
// 従来の<video>再生経路にフォールバックする。返り値は {pcm: Float32Array(モノラル), sampleRate}。
// ============================================================
async function extractAudioViaWebCodecs(file, { onProgress } = {}) {
  if (typeof AudioDecoder === "undefined" || typeof EncodedAudioChunk === "undefined") {
    throw new Error("WebCodecs非対応");
  }
  // 使う時だけ読み込む(メインバンドルを重くしない)。CJS/ESMどちらの形でも拾えるようにする。
  const mod = await import("mp4box");
  const MP4Box = mod.default ?? mod;

  // mp4boxのstsdエントリからAAC等のAudioSpecificConfig(AudioDecoderのdescription)を取り出す
  const getDescription = (mp4file, trackId) => {
    const trak = mp4file.getTrackById(trackId);
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const box = entry.esds || entry.mha1 || entry.mhaC;
      if (entry.esds && entry.esds.esd) {
        try {
          // esd.descs[0](DecoderConfigDescriptor).descs[0](DecoderSpecificInfo).data
          const dsi = entry.esds.esd.descs[0].descs[0];
          if (dsi && dsi.data) return dsi.data;
        } catch { /* 構造が違えばdescriptionなしで試す */ }
      }
      if (box) { /* AAC以外は基本descriptionなしで通す */ }
    }
    return undefined;
  };

  return await new Promise((resolve, reject) => {
    const mp4 = MP4Box.createFile();
    let decoder = null;
    let track = null;
    let sampleRate = 0;
    let totalSec = 0, decodedFrames = 0;
    const pcmChunks = [];
    let settled = false;
    const done = (err, val) => {
      if (settled) return;
      settled = true;
      try { if (decoder && decoder.state !== "closed") decoder.close(); } catch { /* noop */ }
      if (err) reject(err); else resolve(val);
    };

    mp4.onError = (e) => done(new Error("動画コンテナの解析に失敗: " + e));

    mp4.onReady = (info) => {
      track = info.audioTracks && info.audioTracks[0];
      if (!track) { done(new Error("この動画に音声トラックがありません")); return; }
      sampleRate = track.audio.sample_rate;
      totalSec = (info.duration && info.timescale) ? info.duration / info.timescale : 0;
      const numberOfChannels = track.audio.channel_count || 1;

      decoder = new AudioDecoder({
        output: (audioData) => {
          try {
            const nFrames = audioData.numberOfFrames;
            const nCh = audioData.numberOfChannels;
            const mono = new Float32Array(nFrames);
            const plane = new Float32Array(nFrames);
            for (let ch = 0; ch < nCh; ch++) {
              audioData.copyTo(plane, { planeIndex: ch, format: "f32-planar" });
              for (let i = 0; i < nFrames; i++) mono[i] += plane[i];
            }
            if (nCh > 1) for (let i = 0; i < nFrames; i++) mono[i] /= nCh;
            pcmChunks.push(mono);
            decodedFrames += nFrames;
            if (onProgress && totalSec) onProgress(Math.min(0.98, (decodedFrames / sampleRate) / totalSec));
          } finally {
            audioData.close();
          }
        },
        error: (e) => done(new Error("音声デコードに失敗: " + (e?.message ?? e))),
      });

      let description;
      try { description = getDescription(mp4, track.id); } catch { /* noop */ }
      try {
        decoder.configure({ codec: track.codec, sampleRate, numberOfChannels, ...(description ? { description } : {}) });
      } catch (e) {
        done(new Error("このコーデックはWebCodecsで扱えません: " + (e?.message ?? e)));
        return;
      }

      mp4.setExtractionOptions(track.id, null, { nbSamples: 2000 });
      mp4.start();
    };

    mp4.onSamples = (trackId, ref, samples) => {
      if (settled || !decoder) return;
      for (const s of samples) {
        decoder.decode(new EncodedAudioChunk({
          type: s.is_sync ? "key" : "delta",
          timestamp: (s.cts * 1e6) / s.timescale,
          duration: (s.duration * 1e6) / s.timescale,
          data: s.data,
        }));
      }
    };

    // ファイルをチャンクで読み、mp4boxへ順次追記する。スマホ動画はmoovが末尾にあることが多く、
    // onReadyは全チャンク追記後に発火する(=全体を読み終えてから音声デコードを開始する)。
    (async () => {
      try {
        const reader = file.stream().getReader();
        let offset = 0;
        for (;;) {
          const { done: rdone, value } = await reader.read();
          if (rdone) break;
          const ab = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
          ab.fileStart = offset;
          offset += ab.byteLength;
          mp4.appendBuffer(ab);
        }
        mp4.flush();
        // 全サンプル投入後、デコーダをflushしてから連結する
        if (!decoder) { done(new Error("音声トラックを取得できませんでした")); return; }
        await decoder.flush();
        const total = pcmChunks.reduce((a, c) => a + c.length, 0);
        if (total === 0) { done(new Error("音声を取り出せませんでした")); return; }
        const merged = new Float32Array(total);
        let o = 0;
        for (const c of pcmChunks) { merged.set(c, o); o += c.length; }
        if (onProgress) onProgress(0.99);
        done(null, { pcm: merged, sampleRate });
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });
}

// AudioBufferを直接デコードできた場合の高速パス。デコード済みPCMを25ms刻みで
// ライブ計測と同じtick()パイプラインに流す。再生を伴わないためファイル長に関係なく
// 数秒で完了し、ブラウザの自動再生ポリシーやオーディオグラフの実装差の影響も受けない。
// UIをブロックしないよう30msごとにイベントループへ譲る。
// スペクトルの事前計算はしない: 音色測定はtick内のcomputeTimbreMetricsが時間波形から
// 自前で行うため、ここでは生波形の窓を渡すだけでライブ計測と完全に同一の値になる。
function analyzeAudioBuffer(audioBuffer, opts) {
  const { onProgress } = opts;
  const FFT_SIZE = 8192;
  const HOP_MS = 25; // ノート検出の音量エンベロープ追跡に十分な分解能(ライブ時のrAF≒16msに近い)
  const fa = createFrameAnalyzer(opts);
  const sampleRate = audioBuffer.sampleRate;
  const n = audioBuffer.length;

  // モノラルにミックスダウン
  const mono = new Float32Array(n);
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < n; i++) mono[i] += data[i] / audioBuffer.numberOfChannels;
  }

  // ノイズゲート判定用に、ライブ計測と同じバンドパス(楽器種別ごとの中心周波数)を
  // かけた波形も用意する。ライブはBiquadFilterNode→gateAnalyserの帯域限定音量で
  // ゲート判定するため、オフラインも同じ帯域限定音量で判定しないと結果が一致しない。
  const gateMono = applyBandpassRBJ(mono, sampleRate, SAX_PRESETS[opts.saxType]?.gateBandpassHz ?? BANDPASS_FREQ_HZ, BANDPASS_Q);

  // fa.tick()はAnalyserNode互換のインターフェースだけを使うため、互換オブジェクトを渡す。
  // getFloatTimeDomainDataは現在解析中の窓の生波形(MPMピッチ検出・音色測定用)、
  // getGateTimeDomainDataはバンドパス済み波形(ノイズゲート判定用)を返す。
  const analyserLike = {
    getFloatTimeDomainData: (out) => out.set(mono.subarray(curPos.pos, curPos.pos + FFT_SIZE)),
    getGateTimeDomainData: (out) => out.set(gateMono.subarray(curPos.pos, curPos.pos + FFT_SIZE)),
  };
  const curPos = { pos: 0 };

  const hop = Math.max(1, Math.round((sampleRate * HOP_MS) / 1000));
  return new Promise((resolve) => {
    let pos = 0;
    // チャンク間のyieldにはsetTimeoutではなくMessageChannelを使う。
    // setTimeoutはタブが非アクティブだと1回/秒以下に絞られ、解析が何十秒もかかったり
    // 止まったように見える。MessageChannelのpostMessageはこの絞りを受けない。
    const channel = new MessageChannel();
    const processChunk = () => {
      const deadline = performance.now() + 30;
      while (pos + FFT_SIZE <= n && performance.now() < deadline) {
        curPos.pos = pos; // 時間波形窓を現在位置に同期
        fa.tick(analyserLike, sampleRate, ((pos + FFT_SIZE) / sampleRate) * 1000);
        pos += hop;
      }
      if (onProgress) onProgress(Math.min(1, pos / n));
      if (pos + FFT_SIZE <= n) {
        channel.port2.postMessage(null);
      } else {
        channel.port1.onmessage = null;
        resolve({ frames: fa.frames, noteEvents: fa.noteEvents });
      }
    };
    channel.port1.onmessage = processChunk;
    processChunk();
  });
}

// decodeAudioDataでデコードできなかったファイル(動画コンテナ等、ブラウザによっては
// 音声トラックの取り出しに対応しないことがある)向けのフォールバック。
// 実際に<video>要素で再生し、AnalyserNode経由でtickにかける。
// オフライン処理ができないため、解析にはファイルの再生時間と同じだけ実時間がかかる。
// ハング防止のため、メタデータ読み込み・再生停滞・全体時間のそれぞれに見張りを置く。
function analyzeMediaFile(file, opts) {
  const { onProgress, onNeedTap } = opts;
  const FFT_SIZE = 8192;
  const fa = createFrameAnalyzer(opts);

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const mediaEl = document.createElement("video"); // 音声のみのファイルも<video>要素で再生可能
    mediaEl.src = url;
    mediaEl.preload = "auto";
    mediaEl.playsInline = true; // iOSで全画面再生に切り替わるのを防ぐ
    // 【注記】muted=trueにするとブラウザによってはMediaElementAudioSourceNodeが受け取る
    // 信号自体が無音になり解析が空振りするため、ミュートはしない。要素の音声出力は
    // オーディオグラフに引き込まれるので、下のsilentGain(=0)経由でスピーカーには出ない。

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.6;
    // ライブ計測と同じバンドパス→ゲート用アナライザ(ノイズゲート判定を帯域限定音量で行う)
    const bandpass = audioCtx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = SAX_PRESETS[opts.saxType]?.gateBandpassHz ?? BANDPASS_FREQ_HZ;
    bandpass.Q.value = BANDPASS_Q;
    const gateAnalyser = audioCtx.createAnalyser();
    gateAnalyser.fftSize = FFT_SIZE;
    // fa.tick()にはAnalyserNode互換+ゲート波形取得を足したラッパーを渡す
    const analyserLike = {
      getFloatTimeDomainData: (out) => analyser.getFloatTimeDomainData(out),
      getGateTimeDomainData: (out) => gateAnalyser.getFloatTimeDomainData(out),
    };
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;

    let rafId;
    let finished = false;
    const timers = [];
    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (rafId) cancelAnimationFrame(rafId);
      timers.forEach(clearTimeout);
      try { mediaEl.pause(); } catch { /* noop */ }
      mediaEl.removeAttribute("src");
      try { audioCtx.close(); } catch { /* noop */ }
      URL.revokeObjectURL(url);
    };
    const fail = (message) => { cleanup(); reject(new Error(message)); };

    mediaEl.onerror = () => fail("この形式のファイルは読み込めませんでした（動画の場合、コーデック非対応の可能性があります）");

    // メタデータがいつまでも来ない(コンテナを解釈できない等)場合の見張り
    timers.push(setTimeout(() => { if (!finished && mediaEl.readyState === 0) fail("ファイルの読み込みがタイムアウトしました"); }, 20000));

    mediaEl.onloadedmetadata = () => {
      if (finished) return;
      let sourceNode;
      try {
        sourceNode = audioCtx.createMediaElementSource(mediaEl);
      } catch (err) {
        fail(err?.message ?? String(err));
        return;
      }
      sourceNode.connect(analyser);
      sourceNode.connect(bandpass);
      bandpass.connect(gateAnalyser);
      analyser.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      const duration = Number.isFinite(mediaEl.duration) ? mediaEl.duration : 0;

      const finish = () => {
        if (finished) return;
        cleanup();
        resolve({ frames: fa.frames, noteEvents: fa.noteEvents });
      };

      // 再生位置が10秒間進まなければ停滞とみなす
      let lastTime = -1;
      let lastAdvance = performance.now();

      const tick = () => {
        if (finished) return;
        // 経過時間は壁時計ではなく再生位置を使う(バッファリング等で再生が波打っても音声内の時刻と一致する)
        const elapsedMs = mediaEl.currentTime * 1000;
        fa.tick(analyserLike, audioCtx.sampleRate, elapsedMs);
        if (onProgress && duration) onProgress(Math.min(1, mediaEl.currentTime / duration));
        if (mediaEl.currentTime !== lastTime) { lastTime = mediaEl.currentTime; lastAdvance = performance.now(); }
        else if (performance.now() - lastAdvance > 10000) { fail("再生が進まないため解析を中断しました"); return; }
        if (mediaEl.ended) { finish(); return; }
        rafId = requestAnimationFrame(tick);
      };

      mediaEl.onended = finish;

      // 再生開始に成功してから各種見張りタイマーを起動する(ユーザーのタップ待ちの間に
      // タイムアウトしてしまわないよう、開始前には仕掛けない)。
      const begin = () => {
        if (finished) return;
        lastAdvance = performance.now();
        // 再生時間+15秒経っても終わらなければ打ち切る(デコード停止などでendedが来ないケースの保険)
        if (duration > 0) timers.push(setTimeout(() => { if (!finished) fail("解析がタイムアウトしました"); }, (duration + 15) * 1000));
        rafId = requestAnimationFrame(tick);
      };
      const tryStart = () => Promise.all([audioCtx.resume(), mediaEl.play()]).then(begin);

      tryStart().catch(() => {
        // 自動再生の制限でブロックされた場合(ファイル選択のタップから時間が経っていると
        // iOS/Chromeはジェスチャ外の再生を拒否する)、失敗にはせず「タップして開始」を
        // 呼び出し側に依頼する。渡した関数は新しいタップのイベント内で呼んでもらう。
        if (onNeedTap) {
          onNeedTap(() => tryStart().catch(() => fail("ブラウザが再生をブロックしました。もう一度お試しください")));
        } else {
          fail("ブラウザが再生をブロックしました。もう一度お試しください");
        }
      });
    };
  });
}

// ============================================================
// マイク接続の生存監視・復旧(iOS対策)
// ============================================================
// 【背景】アプリを一度バックグラウンドにして戻ると、マイクは繋がっている(readyState="live")のに
// 解析バッファが全ゼロのまま=音量が -200dB 付近に張り付いたまま戻らない、という不具合がある。
// -200 は 20*log10(0 + 1e-10) の値、つまり「バッファが完全にゼロ」の状態を意味する。
// 静かな部屋の実測は -60dB 前後なので、-200 近傍は「ストリームが死んでいる」ことの明確な指標になる。

// ウォッチドッグの無音しきい値(dBFS)。これ以下を「バッファが全ゼロ=死んでいる」とみなす。
// -150dB の RMS は約 3.2e-8 で、24bit の最下位ビット(-144dB)より下。実マイクの暗騒音では
// 到達しえない値なので、静かな部屋(-60dB前後)で誤発火しない。全ゼロ(-200)とは 50dB の余裕がある。
const SILENCE_WATCHDOG_DB = -150;
// この時間だけ連続で全ゼロが続いたら壊れているとみなす(起動直後の数フレームでは発火させない)
const SILENCE_WATCHDOG_SUSTAIN_MS = 1500;
// 復旧を連打しないためのクールダウン。マイク再取得は端末のインジケータを点滅させるため間隔を空ける
const MIC_RECOVER_COOLDOWN_MS = 5000;
// ユーザーが「画面をタップしてください」に応えてタップしたときのクールダウン。自動復旧より短くして
// 待たせないが、0にはしない(連打すると連打ぶんだけマイクを取り直してしまうため)。
const MIC_RETRY_TAP_COOLDOWN_MS = 1000;
// 復旧に失敗したときにユーザーへ出す文言(タップで再試行できることを明示する)
const MIC_RECOVER_FAILED_MSG = "マイクを再接続できませんでした。画面をタップしてください";
// **計測タブでしか意味を持たない案内**。「画面をタップしてください」に応えるジェスチャー経路は
// 計測タブ限定(onGesture の topTab !== "measure" で return)なので、他のタブで出すと
// 指示どおりタップしても何も起きない。エラーモーダルはこの集合だけをタブで出し分ける。
// アップロード由来のエラー(無音ファイル等)はここに入れない=データタブでも出る。
const ERROR_MEASURE_ONLY = [MIC_RECOVER_FAILED_MSG];

// iOSはマイク使用中、既定でオーディオ出力を受話口(小音量)側に回すため、メトロノームが極端に
// 小さく聞こえる。setSinkId は iOS Safari 未実装、AVAudioSessionCategoryOptionDefaultToSpeaker は
// ネイティブ専用でWebから触れないため、Web側から確実にルートを変える手段は現状無い。
// navigator.audioSession(Safariのみ実装)への用途宣言だけが唯一試せる手で、どの値が最適かは
// 実機でしか確認できない。後から差し替えられるよう値はこの1箇所の定数にまとめる。
// 候補: "play-and-record"(録音を伴う再生) / "playback" / "ambient" / "auto"
const AUDIO_SESSION_TYPE = "play-and-record";
function applyAudioSessionType() {
  // 未対応環境ではプロパティ自体が無いので何も起きない(例外も握りつぶす)
  try { if (typeof navigator !== "undefined" && navigator.audioSession) navigator.audioSession.type = AUDIO_SESSION_TYPE; } catch { /* noop */ }
}

// AudioContext の state から取るべき手を決める(純関数)。
// iOS Safari は仕様外の "interrupted" を返すことがあるため明示的に扱う
// (=== "suspended" だけの判定では漏れる)。未知の値は安全側=作り直しに倒す。
// 戻り値: "ok"(そのまま使える) | "resume"(resume()で戻せる見込み) | "rebuild"(作り直しが必要)
function audioCtxRecoveryAction(state) {
  if (state === "running") return "ok";
  if (state === "suspended" || state === "interrupted") return "resume";
  return "rebuild"; // "closed" と未知の状態
}

// 【F-52】AudioContext の時計が「経った実時間ぶん進んだか」を見る(純関数)。
// 本人報告: 「メトロノーム起動中に違うアプリへ行って戻るとたまに右端から動かなくなる。
// スタートを押しても動かない。ストップで真ん中に戻るが、またスタートすると右端へ飛ぶだけ。
// アプリを落とすと直る」。
// 原因: iOS は割り込み(別アプリへの切り替え)から復帰したあと、**state を "running" と
// 報告したまま currentTime が止まったコンテキスト**を返すことがある。上の
// audioCtxRecoveryAction は state しか見ないので "ok" を返し、startMetronome は
// そのコンテキストを使い回す。すると
//   ・位相の基準時刻 anchor.time = currentTime + 0.12 が止まった時計の上に置かれ、
//     getMetroPhase の (currentTime − anchor.time) が定数になる → 振り子が端に張り付く
//   ・スケジューラの while (nextTime < currentTime + LOOKAHEAD) が常に偽 → 1つも鳴らない
// が同時に起きる。アプリを落とすと直るのは、コンテキストが作り直されるから。
// 【判定】非表示になった時点/停止した時点で (音声時計, 実時計) の対を控えておき、
// START のときに両者の進みを突き合わせる。実時間が MIN_WALL 秒以上経ったのに音声時計が
// その RATIO 倍も進んでいなければ「止まっていた」と見なし、コンテキストを作り直す。
// 作り直しは既存の "state が running でない" 経路とまったく同じ処理なので、
// 発音のスケジューリングそのものには一切触れない。
// 引数は秒。新しいコンテキストに差し替わった直後は audioDelta が負になるので、これも「止まった」側に落ちる。
const AUDIO_CLOCK_STALL_MIN_WALL_S = 1;   // これ未満の間隔では判定しない(連打で作り直さない)
const AUDIO_CLOCK_STALL_RATIO = 0.5;      // 実時間のこの割合も進んでいなければ止まっていた
function audioClockStalled(audioDeltaS, wallDeltaS) {
  if (!(wallDeltaS >= AUDIO_CLOCK_STALL_MIN_WALL_S)) return false;
  return !(audioDeltaS >= wallDeltaS * AUDIO_CLOCK_STALL_RATIO);
}

// マイクのトラックが実際に音を運べる状態か(純関数)。readyState が live でも、iOSは中断中に
// muted=true のまま返すことがあるため両方を見る。muted が未実装の環境で誤って毎回取り直さないよう
// 「muted が明示的に true のときだけ駄目」と判定する。
function isMicTrackUsable(track) {
  return !!track && track.readyState === "live" && track.muted !== true;
}
function isMicStreamUsable(stream) {
  const tracks = stream?.getTracks?.() || [];
  return tracks.length > 0 && tracks.some(isMicTrackUsable);
}

// 無音ウォッチドッグの判定(純関数)。解析ループから毎フレーム呼ぶ。
//   volumeDb        : そのフレームの音量(dBFS)
//   prevSilentFrames: 直前フレームまでの連続無音フレーム数
//   frameIntervalMs : 実測したフレーム間隔(ms)。rAFなので端末により16.7〜33msと幅がある
//   isRecording     : 録音中は復旧を走らせない(セッションが壊れるため)
//   nowMs/lastRecoverAtMs: クールダウン判定用
// 戻り値: { silentFrames(更新後のカウンタ), recover(復旧を走らせるか) }
// ※引数の分割代入は関数の本体側で行う(テストハーネスのextractFunctionが波括弧の対応で
//   関数末尾を探すため、シグネチャに { } を書くとそこで切れてしまう)。
function shouldRecoverFromSilence(opts) {
  const o = opts || {};
  const volumeDb = o.volumeDb;
  const prevSilentFrames = o.prevSilentFrames || 0;
  const frameIntervalMs = o.frameIntervalMs || 0;
  const isRecording = o.isRecording === true;
  const nowMs = o.nowMs || 0;
  const lastRecoverAtMs = o.lastRecoverAtMs || 0;
  const thresholdDb = o.thresholdDb === undefined ? SILENCE_WATCHDOG_DB : o.thresholdDb;
  const sustainMs = o.sustainMs === undefined ? SILENCE_WATCHDOG_SUSTAIN_MS : o.sustainMs;
  const cooldownMs = o.cooldownMs === undefined ? MIC_RECOVER_COOLDOWN_MS : o.cooldownMs;
  const silent = Number.isFinite(volumeDb) ? volumeDb <= thresholdDb : true;
  const silentFrames = silent ? prevSilentFrames + 1 : 0;
  if (!silent) return { silentFrames, recover: false };
  if (isRecording) return { silentFrames, recover: false };
  if (!(frameIntervalMs > 0)) return { silentFrames, recover: false };
  if (silentFrames * frameIntervalMs < sustainMs) return { silentFrames, recover: false };
  if (nowMs - lastRecoverAtMs < cooldownMs) return { silentFrames, recover: false };
  return { silentFrames, recover: true };
}

// 中断された AudioContext を running に戻す。resume() を呼んでも running にならなければ、
// そのコンテキストを close() して作り直す。作り直した場合は rebuilt:true を返すので、
// 呼び出し側は「古いノードは新しいコンテキストに繋げない」ため source/analyser/バンドパスを
// すべて作り直さなければならない。
async function recoverAudioContext(ctx, createCtx) {
  const create = createCtx || (() => new (window.AudioContext || window.webkitAudioContext)());
  if (ctx && audioCtxRecoveryAction(ctx.state) === "resume") {
    try { await ctx.resume(); } catch { /* noop */ }
  }
  if (ctx && ctx.state === "running") return { ctx, rebuilt: false };
  if (ctx && ctx.state !== "closed") { try { await ctx.close(); } catch { /* noop */ } }
  const fresh = create();
  try { await fresh.resume(); } catch { /* noop */ }
  return { ctx: fresh, rebuilt: true };
}

// ============================================================
// Main component
// ============================================================
export default function WindToneLabPhaseMode() {
  const [topTab, setTopTab] = useState("measure"); // "measure" | "reeds" | "analysis"
  const [reedsSubTab, setReedsSubTab] = useState("register"); // 「リード」タブ内の子タブ: register | compare | ranking
  // 下部ナビのタップ毎にインクリメントする通し番号。リード/データタブの中身のkeyに使い、
  // タブをタップすると(既にそのタブにいても)子ビューが再マウントされ、開いていた
  // 個別リード/個別セッションの詳細が閉じてトップページに戻るようにする。
  const [navNonce, setNavNonce] = useState(0);
  const handleNavTap = useCallback((key) => {
    if (isRecordingRef.current) return;
    if (key === "reeds") setReedsSubTab("register"); // リードタブのトップは「登録」子タブ
    setTopTab(key);
    setNavNonce((n) => n + 1);
  }, []);
  const [compareReedIds, setCompareReedIds] = useState([]); // 「比較」タブで選択中のリード(タブ切替をまたいで保持)
  // 【F-59 本人指示】「pivotの集計条件や選択軸はページを移動して戻ってきても内容がキープ」。
  // AnalysisLabView は (a) タブを離れるとアンマウントされ (b) 下部ナビのタップごとに
  // key={`data-${navNonce}`} で**意図的に**再マウントされる(上記 navNonce の目的:
  // 開いていた個別セッションを閉じて一覧に戻す)。その意図は壊さずに条件だけ残すため、
  // 保持したい状態だけをここへ持ち上げる。**再マウントで消えるべきもの
  // (開いている個別セッション selectedSessionId・子タブ dataSubTab)は子の useState のまま。**
  const [pivotRow, setPivotRow] = useState("note");
  const [pivotCol, setPivotCol] = useState("brand");
  const [pivotMetric, setPivotMetric] = useState("pitchCents");
  // null = まだ本人が触っていない。既定値(「サックス種別=今の楽器」)はここで作らない:
  // saxType は IndexedDB から**非同期に**復元されるため、アプリ起動時点では既定の "alto" しか
  // 見えず、テナー使用者の初期フィルターが誤って固定される(以前は子が毎回マウントし直されて
  // いたので、実際に開く時点の saxType で作られていた)。実際に使う側で埋める。
  const [pivotFilters, setPivotFilters] = useState(null);
  // isListening: マイク+ライブ表示が有効か(計測タブ滞在中は自動でON/OFF)。
  // isRecording: 録音ボタンで蓄積中かどうか(セッションとして保存されるのはこの間のフレームのみ)。
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [pitch, setPitch] = useState(null);
  const [harmonicLevels, setHarmonicLevels] = useState([]);
  const [volumeDb, setVolumeDb] = useState(-100);
  const [centroidHz, setCentroidHz] = useState(0);
  const [hnrDb, setHnrDb] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const [saxType, setSaxType] = usePersistedState("saxType", "alto");
  const [noiseGateDb, setNoiseGateDb] = usePersistedState("noiseGateDb", NOISE_GATE_DEFAULT_DB); // 楽器音だけ拾うためのノイズゲート(dBFS)
  const [temperature, setTemperature] = useState(20);
  const [tuningHz, setTuningHz] = usePersistedState("tuningHz", 442); // 基準ピッチ: 440〜444Hzのボタン、デフォルト442Hz
  const [instrumentOffsetCents, setInstrumentOffsetCents] = usePersistedState("instrumentOffsetCents", 0); // 楽器個体差の補正(セント)。運指テーブル全体をシフトする(企画書3節末尾の注記への対応)
  const [showIdeal, setShowIdeal] = useState(true);

  // 理想値プロファイルは「撮りためたデータ」の中核のひとつのため永続化する
  const [idealProfiles, setIdealProfiles] = usePersistedState("idealProfiles", []);
  const [selectedIdealId, setSelectedIdealId] = usePersistedState("selectedIdealId", null);

  // 音名表記統一(D#→E♭, A#→B♭)より前に保存された理想値プロファイルのwrittenLabelを
  // 読み込み後に一度だけ変換する(セッション側はuseSessionsStoreの読み込み時に対応済み)。
  useEffect(() => {
    const needsMigration = idealProfiles.some((p) =>
      Object.values(p.notes || {}).some((n) => n.writtenLabel?.startsWith("D#") || n.writtenLabel?.startsWith("A#"))
    );
    if (!needsMigration) return;
    setIdealProfiles((prev) => prev.map((p) => ({
      ...p,
      notes: Object.fromEntries(Object.entries(p.notes || {}).map(([k, n]) => [k, { ...n, writtenLabel: migrateNoteSpelling(n.writtenLabel) }])),
    })));
  }, [idealProfiles, setIdealProfiles]);

  // --- 運指ベース管長自動キャリブレーション state ---
  const [matchedFingering, setMatchedFingering] = useState(null); // 直近フレームで判定された運指(理論値計算の基準に使う)

  // --- 録音結果の時系列データ(単音/フレーズの区別はnoteEvents数から事後判定する) ---
  // タイムライン表示切替・ドリルダウン選択の状態はPhraseTimelineコンポーネント内にローカル化した
  const [phraseFrames, setPhraseFrames] = useState([]); // データ構造は企画書3節のframesに準拠

  // --- リード管理 state (企画書v5 10節) ---
  // reeds/sessionsは練習を重ねるほど価値が増す蓄積データのため、IndexedDBに永続化する(usePersistedState)
  const [reeds, setReeds] = usePersistedState("reeds", []); // リードマスタ一覧
  const [sessions, addSession, updateSessions, deleteSessions] = useSessionsStore(); // 録音セッション一覧(reedIdで紐付け、10.5節のsessionWithReedに準拠。レコード単位で永続化)
  const [selectedReedId, setSelectedReedId] = usePersistedState("selectedReedId", null); // 録音前に選択する「今回使うリード」

  // --- 奏者(演奏者)管理 ---
  // 「自分」は常に選べる固定選択肢。ユーザーが「名前を入力」で追加した名前をperformersに積み上げていく
  const [performers, setPerformers] = usePersistedState("performers", []);
  const [selectedPerformer, setSelectedPerformer] = usePersistedState("selectedPerformer", "自分");

  // --- 音声ファイルアップロード解析(分析タブ) ---
  const [isAnalyzingUpload, setIsAnalyzingUpload] = useState(false);
  const isAnalyzingUploadRef = useRef(false); // 可視状態復帰時のWake Lock再取得判定に使う
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadNeedsTap, setUploadNeedsTap] = useState(null); // 自動再生ブロック時の再開関数(タップで呼ぶ)
  const [lastUploadedSession, setLastUploadedSession] = useState(null); // 解析完了直後に「目安に設定」を出すため

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const gateAnalyserRef = useRef(null); // バンドパス後の音量(ノイズゲート判定)用のアナライザ
  const bandpassRef = useRef(null);     // ゲート用バンドパス(楽器種別変更時に中心周波数を追従させる)
  const [micProcessingWarning, setMicProcessingWarning] = useState(""); // 端末がAGC等を無効化できなかった時の警告
  const rafRef = useRef(null);
  const tickRef = useRef(null); // 描画ループ本体(tick)。タブ切替でマイクを繋ぎ直さずループだけ再開するために保持する
  const streamRef = useRef(null);
  // --- マイク生存監視・復旧(iOS対策。詳細はファイル上部 SILENCE_WATCHDOG_DB 付近のコメント) ---
  const silentFramesRef = useRef(0);      // 連続で「バッファ全ゼロ」だったフレーム数
  const lastFrameAtRef = useRef(0);       // 直前フレームの時刻(フレーム間隔を実測してms換算するため)
  const micRecoverAtRef = useRef(0);      // 直近に復旧を走らせた時刻(クールダウン用)
  const micRecoveringRef = useRef(false); // 復旧処理の多重起動防止
  const micNeedsRetryRef = useRef(false); // 復旧に失敗しユーザーのタップ待ちである
  const recoverMicRef = useRef(() => {});  // 復旧関数の最新版(tick/トラックイベントのクロージャから呼ぶ)
  const phraseStartTimeRef = useRef(null);
  const lastSampleTimeRef = useRef(0);
  const phraseFramesRef = useRef([]); // stop()のクロージャから最新フレーム配列を参照するためのref

  // --- 常時ライブのタイムライン用ローリングバッファ ---
  // 録音(isRecording)開始前でも、マイク接続中(tick稼働中)は直近30秒分のフレームを
  // 保持し続け、タイムラインを録音の有無によらず常時動かす。セッション保存には使わない
  // 使い捨てのバッファなので、録音中のphraseFramesとは別に持つ(録音ロジックには触れない)。
  const [liveFrames, setLiveFrames] = useState([]);
  const liveStartTimeRef = useRef(null);
  const lastLiveSampleTimeRef = useRef(0);
  const LIVE_WINDOW_MAX_FRAMES = 300; // 100ms間隔で約30秒分(「これまでの音」ミニタイムラインが必要とする幅)
  const soundingRef = useRef(false);   // 発音中フラグ(ヒステリシス判定に使う)
  const lastFingerRef = useRef(null);  // 音名グルーピングのヒステリシス用(前フレームの判定運指)
  // --- メトロノーム連携(エンジン本体はMeasureView内。ここは計測との干渉対策用) ---
  const scheduledClicksRef = useRef([]); // クリック予定時刻(performance.now()基準・昇順)。tickが近傍判定に読む
  const metroActiveRef = useRef(false);  // メトロノーム動作中フラグ(録音停止時のWake Lock解放判定に使う)
  const metroBarPerfTimesRef = useRef([]); // メトロノームのアクセント(=小節頭)の予定時刻(performance.now基準)。録音中に貯め、小節線として保存する
  const recStartPerfRef = useRef(null);   // 録音開始時のperformance.now()。小節線を録音相対秒に変換するのに使う(phraseStartTimeRefは停止時にnull化されるため別に持つ)
  // 音色(倍音・重心・HNR)の"表示"を安定させるためのローリングバッファ。
  // 測定はフレーム毎に正確に行い記録するが、画面表示は直近の有効値の中央値にすることで、
  // ・音の遷移(レガート)で一瞬混ざった外れ値を弾き、
  // ・一瞬測れないフレームでも直近値を保持して行が「—」に落ちてガタつくのを防ぐ。
  const timbreDisplayRef = useRef({ centroid: [], hnr: [], harmonics: [], validMs: 0, lastNote: null, changedMs: 0, stale: false, lastComputeMs: 0, lastCentroid: null, lastHnr: null, lastLevels: [] });
  // 【F-104 2026/08/17】tick が毎フレーム確保していた 2本の Float32Array(8192)(時間波形+
  // ゲート用 = 64KB/フレーム ≒ 実測 24.8KB/tick のヒープ増加)を使い回すためのバッファ。
  // 中身は毎フレーム getFloatTimeDomainData が全書き換えするので値の意味は不変
  // (=計測の正確さは 1bit も変わらない)。GC の断続的な停止(特に iOS Safari)を減らす。
  // fftSize が変わったときだけ作り直す。
  const tickBufsRef = useRef({ time: null, gate: null });
  const noiseGateDbRef = useRef(noiseGateDb);
  useEffect(() => { noiseGateDbRef.current = noiseGateDb; }, [noiseGateDb]);
  // マイク接続中に楽器種別を変えたら、ゲート用バンドパスの中心周波数も追従させる
  useEffect(() => {
    if (bandpassRef.current) bandpassRef.current.frequency.value = SAX_PRESETS[saxType]?.gateBandpassHz ?? BANDPASS_FREQ_HZ;
  }, [saxType]);

  // --- ノート区間分割・アタック時間検出(企画書2.4節のnoteEvents、rAFレートで検出) ---
  // 100msフレームではアタック(典型20〜100ms)を測れないため、tick毎(約60fps)に音量エンベロープを監視する。
  // 状態機械: silence → attack(立ち上がり計測中) → sustain → (音量低下で) silence
  const noteDetectorRef = useRef({ phase: "silence", onsetMs: 0, peakDb: -100, samples: [], events: [] });
  const [phraseNoteEvents, setPhraseNoteEvents] = useState([]);
  const ATTACK_WINDOW_MS = 400; // アタック確定までの観測窓
  const SAMPLE_INTERVAL_MS = 100;

  const FFT_SIZE = 8192;
  const NUM_HARMONICS = 8;
  const preset = SAX_PRESETS[saxType];

  // 運指テーブルは saxType / tuningHz / 個体差オフセット が変わった時だけ再計算。
  // 個体差オフセット(セント)は基準ピッチに乗算する形でテーブル全体をシフトする:
  //   実効基準Hz = tuningHz × 2^(offsetCents/1200)
  const fingeringTable = useMemo(
    () => buildFingeringTable(saxType, tuningHz * Math.pow(2, instrumentOffsetCents / 1200)),
    [saxType, tuningHz, instrumentOffsetCents]
  );

  // 【注記】音色一致度は理論値基準を持たない方針とした(企画書v3 2.8節参照)。
  // 理論モデルは絶対周波数のみを持ち、倍音の相対強度情報を持たないため、
  // 倍音パターン比較の基準として使うと精度が低くなるのが理由。
  // ピッチ一致度のみ、理論値(運指テーブル)・理想値の両方を基準として選べる。

  const selectedIdeal = idealProfiles.find((p) => p.id === selectedIdealId) || null;

  // マイクは計測タブ滞在中ずっと繋ぎっぱなしにする(録音の開始/停止では繋ぎ直さない)ため、
  // tick()は長寿命のクロージャになる。設定変更(サックス種別・基準ピッチ・気温・理想値等)を
  // 反映するため、クロージャ変数ではなくrefから毎回読む。
  const fingeringTableRef = useRef(fingeringTable);
  const presetRef = useRef(preset);
  const temperatureRef = useRef(temperature);
  const selectedIdealRef = useRef(selectedIdeal);
  const isRecordingRef = useRef(false);
  // メーターと折れ線グラフ・フレームで0¢の基準を完全に一致させるため、実効基準ピッチ
  // (基準Hz×個体差オフセット)をtickからも読めるようrefで保持する。
  const effectiveTuningHz = tuningHz * Math.pow(2, instrumentOffsetCents / 1200);
  const effectiveTuningRef = useRef(effectiveTuningHz);
  // ピッチ検出の音域(楽器種別+基準ピッチから算出)。音域外の幻の高音を拾わないよう
  // detectPitchMPMに渡す。tickから毎回参照するためref化し、種別・基準変更で更新する。
  const pitchBoundsRef = useRef(saxPitchBounds(saxType, effectiveTuningHz));
  useEffect(() => { pitchBoundsRef.current = saxPitchBounds(saxType, effectiveTuningHz); }, [saxType, effectiveTuningHz]);
  useEffect(() => { fingeringTableRef.current = fingeringTable; }, [fingeringTable]);
  useEffect(() => { presetRef.current = preset; }, [preset]);
  useEffect(() => { temperatureRef.current = temperature; }, [temperature]);
  useEffect(() => { selectedIdealRef.current = selectedIdeal; }, [selectedIdeal]);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { effectiveTuningRef.current = effectiveTuningHz; }, [effectiveTuningHz]);

  // 録音停止時、蓄積フレームがあればセッション候補(pendingSession)として保持する。
  // 以前は停止と同時に自動保存していたが、「登録 or 取り直し」を選べるように、ここでは
  // 保存せず候補として持ち、ユーザーが「登録」を押したときにだけ実際に保存する。
  const [pendingSession, setPendingSession] = useState(null);
  const finalizeRecording = useCallback(() => {
    if (phraseFramesRef.current.length > 0) {
      // メトロノームのアクセント(小節頭)が録音中に鳴っていれば、その時刻を録音開始からの
      // 相対秒(フレームのtと同じ座標)に変換して小節線として保存する。
      const startPerf = recStartPerfRef.current;
      const endPerf = performance.now();
      let barlines = [];
      if (startPerf !== null) {
        barlines = metroBarPerfTimesRef.current
          .filter((p) => p >= startPerf - 20 && p <= endPerf + 20)
          .map((p) => (p - startPerf) / 1000)
          .filter((t) => t >= 0);
      }
      const session = {
        id: generateId(),
        recordedAt: new Date().toISOString(),
        saxType,
        reedId: selectedReedId,
        linkedAt: selectedReedId ? "eager" : null,
        memo: null,
        performer: selectedPerformer,
        source: "live",
        frames: sanitizePitchOutliers(phraseFramesRef.current), // 単発のオクターブ誤検出等を除去してから保存
        barlines, // メトロノームのアクセント由来の小節頭の時刻(秒)。タイムラインに縦線として描く
        noteEvents: noteDetectorRef.current.events, // ノート区間分割・アタック時間(企画書2.4節・4節のnoteEvents)
      };
      setPendingSession(session);
    }
  }, [saxType, selectedReedId, selectedPerformer]);
  // 画面スリープ抑止(Wake Lock)。録音中に取得し、停止時に解放する。ブラウザが未対応でも黙って無視。
  // 画面が一度隠れるとWake Lockは自動解放されるため、復帰時に録音中なら再取得する。
  const wakeLockRef = useRef(null);
  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator && !wakeLockRef.current) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        wakeLockRef.current.addEventListener?.("release", () => { wakeLockRef.current = null; });
      }
    } catch { /* 未対応・失敗時は何もしない */ }
  }, []);
  const releaseWakeLock = useCallback(() => {
    try { wakeLockRef.current?.release(); } catch { /* noop */ }
    wakeLockRef.current = null;
  }, []);

  const registerPendingSession = useCallback(() => {
    if (pendingSession) addSession(pendingSession);
    setPendingSession(null);
    setPhraseFrames([]);
    phraseFramesRef.current = [];
  }, [pendingSession, addSession]);
  const discardPendingSession = useCallback(() => {
    setPendingSession(null);
    setPhraseFrames([]);
    phraseFramesRef.current = [];
  }, []);

  // マイクを完全に止める(画面を隠した時・アンマウント時に呼ぶ)。マイクデバイスを解放し、
  // 端末のマイク使用インジケータも消える。録音中に離脱した場合の保険としてここでも保存する。
  const stopListening = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => {
      // 停止させる前にハンドラを外す(t.stop()自体でendedが飛ぶ実装があり、意図しない復旧を招くため)
      t.onmute = null;
      t.onended = null;
      t.stop();
    });
    streamRef.current = null;
    tickRef.current = null;
    silentFramesRef.current = 0;
    lastFrameAtRef.current = 0;
    // 古いノードを新しいコンテキストに繋がないよう、コンテキストと一緒に必ず捨てる
    analyserRef.current = null;
    gateAnalyserRef.current = null;
    bandpassRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") audioCtxRef.current.close();
    audioCtxRef.current = null;
    if (isRecordingRef.current) finalizeRecording();
    setIsRecording(false);
    setIsListening(false);
  }, [finalizeRecording]);

  // マイクは繋いだまま一時停止する(計測タブから他タブへ移ったときに呼ぶ)。
  // トラックをミュート(enabled=false)して描画ループを止めるだけで、getUserMediaで
  // 取得した接続自体は保持する。これにより計測タブへ戻ってもマイク許可のポップアップが
  // 再び出ない(繋ぎ直さずstartListeningの再利用パスでループを再開する)。
  const pauseListening = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => { t.enabled = false; });
    if (isRecordingRef.current) finalizeRecording();
    setIsRecording(false);
    setIsListening(false);
  }, [finalizeRecording]);

  // マイクへの接続自体はrefのみで完結させ、依存配列は空にする(サックス種別等の変更で
  // マイクを繋ぎ直す必要はない。tick()は設定値をrefから読むため常に最新の値を反映できる)。
  const startListening = useCallback(async () => {
    setErrorMsg("");
    liveStartTimeRef.current = null;
    lastLiveSampleTimeRef.current = 0;
    soundingRef.current = false;
    setLiveFrames([]);

    silentFramesRef.current = 0;
    lastFrameAtRef.current = 0;

    // 【マイク権限ポップアップ対策】タブを行き来するたびにgetUserMediaを呼ぶと、
    // 端末によっては毎回マイク許可のポップアップが出る。既にマイク接続が生きていれば
    // 繋ぎ直さず、ミュートを解除して描画ループだけ再開する(pauseListeningと対で使う)。
    // ただし再利用してよいのは「トラックが live かつ muted でない」かつ「AudioContextが実際に
    // running に戻せた」ときだけ。戻せなければ下の完全再取得パスへ落ちる(古いノードを新しい
    // コンテキストに繋ぐことはできないため、部分的な作り直しはしない)。
    const existingTracks = streamRef.current?.getTracks?.() || [];
    const ctxAlive = audioCtxRef.current && audioCtxRef.current.state !== "closed";
    if (isMicStreamUsable(streamRef.current) && ctxAlive && tickRef.current) {
      existingTracks.forEach((t) => { t.enabled = true; });
      // ジェスチャー権限内で同期的にキックする(awaitを挟むと権限が切れる)
      try { audioCtxRef.current.resume().catch(() => {}); } catch { /* noop */ }
      if (audioCtxRef.current.state === "running") {
        setIsListening(true);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        lastFrameAtRef.current = 0;
        rafRef.current = requestAnimationFrame(tickRef.current);
        return true;
      }
    }

    // ここから先は完全再取得。古いコンテキスト・トラックが残っていれば必ず捨てる
    // (中途半端に残すと、新しいコンテキストに古いノードが繋がったままになる)。
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch { /* noop */ } }
    streamRef.current = null;
    tickRef.current = null;
    analyserRef.current = null;
    gateAnalyserRef.current = null;
    bandpassRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") { try { audioCtxRef.current.close(); } catch { /* noop */ } }
    audioCtxRef.current = null;

    try {
      // 【iOS対策・重要】AudioContextの生成とresume()は、getUserMediaのawaitより「前」に、
      // つまりstartListeningがユーザー操作(タップ)の中から呼ばれたならその操作の権限内で同期的に
      // 行う。awaitを先に挟むとジェスチャー権限が切れ、suspendedのまま作られたcontext上のsourceが
      // 二度と音を流さなくなる(=起動直後からずっと-200dB、リロードでしか治らない)不具合になる。
      // iOSはマイク使用中、既定でオーディオ出力を受話口(小音量)に回すため、メトロノームが
      // 極端に小さく聞こえる。audioSessionに用途を明示しておくと対応ブラウザではスピーカー側に
      // 寄せられる(未対応環境ではプロパティ自体が無いので何も起きない)。値は AUDIO_SESSION_TYPE の1箇所。
      applyAudioSessionType();
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      audioCtx.resume().catch(() => {}); // ジェスチャー中に同期発火(awaitしない)。以降tick内でも監視・再resumeする

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;

      // 【トラックの死亡検知】iOSは他アプリにマイクを奪われると readyState は live のまま
      // muted だけ true にして戻ってくることがある。ended/mute のどちらでも復旧を試みる。
      stream.getTracks().forEach((t) => {
        t.onmute = () => { recoverMicRef.current("track-muted"); };
        t.onended = () => { recoverMicRef.current("track-ended"); };
      });

      // 端末が実際にAGC/ノイズ抑制/エコー除去を無効化できたか確認する(iOS Safariは
      // 制約を無視することがある)。有効なままだと音量・音色の測定値に端末側の加工が
      // 入るため、詳細パネルに警告を出してユーザーが気づけるようにする。
      try {
        const st = stream.getAudioTracks()[0]?.getSettings?.() || {};
        const active = [
          st.autoGainControl === true && "自動音量調整(AGC)",
          st.noiseSuppression === true && "ノイズ抑制",
          st.echoCancellation === true && "エコー除去",
        ].filter(Boolean);
        setMicProcessingWarning(active.length ? `端末の${active.join("・")}を無効化できませんでした。音量・音色の測定値に端末側の加工が入っている可能性があります。` : "");
      } catch { setMicProcessingWarning(""); }

      const source = audioCtx.createMediaStreamSource(stream);
      // 生の解析用アナライザ(スペクトル・倍音・重心・ピッチ検出はフルバンドで行う)
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      // 楽器の基音帯だけを通すバンドパス(BiquadFilterNode)→ ゲート判定用アナライザ。
      // 空調のうなり(低域)や高域ヒスを抑えた音量でノイズゲートを判定する。
      // 中心周波数は楽器種別ごと(バリトンの低音域が減衰しないよう低めに)。種別変更に追従する。
      const bandpass = audioCtx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = SAX_PRESETS[saxType]?.gateBandpassHz ?? BANDPASS_FREQ_HZ;
      bandpass.Q.value = BANDPASS_Q;
      bandpassRef.current = bandpass;
      const gateAnalyser = audioCtx.createAnalyser();
      gateAnalyser.fftSize = FFT_SIZE;
      gateAnalyser.smoothingTimeConstant = 0.2;
      source.connect(bandpass);
      bandpass.connect(gateAnalyser);
      gateAnalyserRef.current = gateAnalyser;

      setIsListening(true);

      const tick = () => {
        // 【世代チェック】復旧でマイクを取り直すと新しいtickが作られる。cancelAnimationFrameが
        // 間に合わず古いtickが1回だけ走ってしまうことがあり、そのままだと閉じたコンテキストを見て
        // 復旧を要求したり、二重にループを回し続けたりする。現行世代でなければ次を予約せず静かに終わる。
        if (tickRef.current !== tick) return;
        // tick本体はtry/finallyで包み、1フレームで例外が出ても必ず次フレームを予約して
        // ループが永久停止しない(＝メーターやグラフが固まらない)ようにする。以前は末尾の
        // requestAnimationFrameに到達しないと二度と更新されず、途中で止まる不具合につながっていた。
        try {
        const analyserNode = analyserRef.current;
        if (!analyserNode) return;
        // AudioContextがrunning以外(suspend/iOS固有のinterrupted等)だと解析用データが更新
        // されず検出が止まる。resumeで戻せる状態なら毎フレーム試み、closed等の戻せない状態なら
        // コンテキストごと作り直す復旧に回す(中断からの復帰はユーザー操作外でも通ることが多い)。
        const ctxAction = audioCtxRecoveryAction(audioCtx.state);
        if (ctxAction === "resume") audioCtx.resume().catch(() => {});
        else if (ctxAction === "rebuild") recoverMicRef.current(`audiocontext-${audioCtx.state}`);
        // 測定(ピッチ・倍音・重心・HNR)はすべて時間波形から自前計算する。AnalyserNodeの
        // 平滑済みスペクトルは使わない(スペクトル表示バーを廃止したため周波数データも読まない)。
        const sampleRate = audioCtx.sampleRate;

        // 音量(RMS/dBFS)は時間領域波形から算出する(標準的なdB。無音≒-70〜-90、通常音≒-15〜-35)。
        // 【F-104】バッファは使い回す(毎フレーム new すると 32KB/フレームの GC 圧になる)。
        if (!tickBufsRef.current.time || tickBufsRef.current.time.length !== analyserNode.fftSize) {
          tickBufsRef.current.time = new Float32Array(analyserNode.fftSize);
        }
        const timeBuf = tickBufsRef.current.time;
        analyserNode.getFloatTimeDomainData(timeBuf);
        let ss = 0;
        for (let i = 0; i < timeBuf.length; i++) ss += timeBuf[i] * timeBuf[i];
        const rms = Math.sqrt(ss / timeBuf.length);
        const vDb = 20 * Math.log10(rms + 1e-10);
        setVolumeDb(vDb);

        // 【無音ウォッチドッグ】トラックがliveでも、バッファが全ゼロ(=-200dB近傍)のまま
        // 一定時間続いたらストリームは死んでいる。判定は純関数に切り出してテストしている。
        {
          const wNow = performance.now();
          const wInterval = lastFrameAtRef.current ? wNow - lastFrameAtRef.current : 0;
          lastFrameAtRef.current = wNow;
          const wd = shouldRecoverFromSilence({
            volumeDb: vDb,
            prevSilentFrames: silentFramesRef.current,
            frameIntervalMs: wInterval,
            isRecording: isRecordingRef.current,
            nowMs: wNow,
            lastRecoverAtMs: micRecoverAtRef.current,
          });
          silentFramesRef.current = wd.silentFrames;
          if (wd.recover) recoverMicRef.current("silence-watchdog");
        }

        // バンドパス後の音量(dBFS)。空調のうなり・高域ヒスを除いた楽器帯の音量でゲート判定する。
        let bandDb = -Infinity;
        const gateNode = gateAnalyserRef.current;
        if (gateNode) {
          // 【F-104】こちらも使い回す(time と同じ理由)。
          if (!tickBufsRef.current.gate || tickBufsRef.current.gate.length !== gateNode.fftSize) {
            tickBufsRef.current.gate = new Float32Array(gateNode.fftSize);
          }
          const gb = tickBufsRef.current.gate;
          gateNode.getFloatTimeDomainData(gb);
          let s2 = 0;
          for (let i = 0; i < gb.length; i++) s2 += gb[i] * gb[i];
          bandDb = 20 * Math.log10(Math.sqrt(s2 / gb.length) + 1e-10);
        }

        // ピッチ検出: 時間領域MPM(サブサンプル精度。1¢単位のメーター動作の要)。
        // clarity(周期の明瞭度)が低いもの=ブレスや空調などの非周期ノイズはここで排除する。
        // 楽器音域(minFreq/maxFreq)を渡し、音域外の幻の高音(倍音の誤検出)を拾わないようにする。
        const { minFreq: pmn, maxFreq: pmx } = pitchBoundsRef.current;
        const mpm = detectPitchMPM(timeBuf, sampleRate, pmn, pmx);
        const f0 = mpm && mpm.clarity >= PITCH_CLARITY_MIN ? mpm.freq : null;

        let levels = [];
        let hnr = null;
        let centroid = null;
        let matchedFinger = null;

        // --- 楽器音の判定(楽器以外=空調・ブレス等を拾わない) ---
        // (1) ノイズゲート: バンドパス後の音量が設定しきい値(dBFS)を超えること。ヒステリシスつき。
        // (2) 音程のある楽音であること: MPMが十分なclarityで基音を検出できること。
        const gateDb = noiseGateDbRef.current;
        const wasSounding = soundingRef.current;
        const hasPitch = !!(f0 && f0 > 40);
        const aboveGate = bandDb > (wasSounding ? gateDb - GATE_HYSTERESIS_DB : gateDb);
        soundingRef.current = hasPitch && aboveGate;
        const sounding = soundingRef.current;
        // 音色系(重心・HNR・倍音・スペクトル)は、ゲート+余裕を持った音量でだけ測定する。
        const timbreMeasurable = sounding && bandDb > gateDb + TIMBRE_EXTRA_DB;

        // メトロノームのクリック近傍(前30ms〜後90ms)で楽器音が無い場合は、スピーカーから
        // マイクに回り込んだクリック音をフレームとして記録しない(音量等の誤データ防止)。
        // 楽器音が鳴っている間は楽器がクリックより支配的でclarityゲートもあるため記録を続ける。
        const skipFrameForMetroClick = !sounding && isNearScheduledClick(scheduledClicksRef.current, performance.now());

        // ピッチのセント誤差は、メーターと同じ実効基準ピッチで1回だけ算出し、表示・グラフ・フレームで
        // 共有する(これで0¢の基準が全音でメーターと一致する)。
        const noteNow = sounding ? freqToNote(f0, effectiveTuningRef.current) : null;
        const pitchCentsUnified = noteNow ? noteNow.centsExact : null;

        if (sounding) {
          setPitch(f0);
          // 実測基音に最も近い運指をテーブルから検索(音名・音域・倍音理論値の基準に使う)。
          // 半音境界のヒステリシスと範囲外リジェクトを含む共通判定(オフライン解析と同一)
          matchedFinger = matchFingering(lastFingerRef.current, f0, fingeringTableRef.current);
          lastFingerRef.current = matchedFinger;
          setMatchedFingering(matchedFinger);
        } else {
          // 無音: ピッチをnullに戻すことで、メーターは中央(音名は「—」)に戻る。
          setPitch(null);
          setMatchedFingering(null);
          lastFingerRef.current = null;
        }

        // 音色(倍音・重心・HNR)は平滑済みAnalyserNodeスペクトルではなく、時間波形から
        // 毎回自前計算する(computeTimbreMetrics)。アップロード解析と完全に同一の計算になり、
        // 立ち上がりで前の音が混ざる系統誤差もない。記録用(centroid/levels/hnr)は生値のまま。
        //
        // 【表示の安定化(倍音が直前の音に汚染される/理想値がガタつく問題への対策)】
        // 解析窓(約170ms)は音の遷移直後に前の音の成分を含む。そこで:
        //  1) 音名(semitoneIndex)が変わってからTIMBRE_SETTLE_MSの間は、遷移で汚れた測定を
        //     表示バッファに積まない(前の音の倍音が混ざるのを防ぐ)。
        //  2) 表示はバッファの中央値。単発の外れ値を弾き、一瞬測れなくても直近値を保持して
        //     行が「—」に落ちてガタつくのを防ぐ。
        //  3) 音が変わったら古い音の値はバッファから捨て、新しい音の定常フレームで入れ替える。
        const disp = timbreDisplayRef.current;
        const DISPLAY_WINDOW = 5;      // 中央値をとる直近フレーム数
        const DISPLAY_HOLD_MS = 600;   // 最後の有効測定からこの間は直近値を保持して行をキープ
        const TIMBRE_SETTLE_MS = 140;  // 音替わり直後この間は遷移フレームを表示に取り込まない
        const TIMBRE_COMPUTE_MS = 66;  // 音色FFT(重い)は毎フレームではなくこの間隔で間引く(メーターの追従はピッチのみで足り、CPU負荷を大きく下げる)
        const nowPerfMs = performance.now();
        const noteKey = matchedFinger?.semitoneIndex ?? (sounding ? "unknown" : null);
        if (noteKey !== disp.lastNote) {
          disp.lastNote = noteKey;
          disp.changedMs = nowPerfMs;
          disp.stale = true; // 次に定常フレームが来たら古い音の値を捨てて入れ替える
          disp.lastCentroid = null; disp.lastHnr = null; disp.lastLevels = []; // 前の音の音色値を持ち越さない
        }
        // 音色(重心・HNR・倍音)は8192点FFTを含み重いため、TIMBRE_COMPUTE_MS間隔に間引く。
        // ピッチ検出(メーターの要)は毎フレーム走らせたまま、音色だけ負荷を落とす。
        if (timbreMeasurable && nowPerfMs - disp.lastComputeMs >= TIMBRE_COMPUTE_MS) {
          disp.lastComputeMs = nowPerfMs;
          const settled = nowPerfMs - disp.changedMs >= TIMBRE_SETTLE_MS;
          const tm = settled ? computeTimbreMetrics(timeBuf, sampleRate, f0, NUM_HARMONICS) : null;
          if (tm) {
            const maxMag = Math.max(...tm.harmonics.map((l) => l.mag), 1e-6);
            disp.lastCentroid = tm.centroidHz;
            disp.lastHnr = tm.hnrDb;
            disp.lastLevels = tm.harmonics.map((l) => ({ ...l, norm: l.mag / maxMag }));
            if (disp.stale) { disp.centroid = []; disp.hnr = []; disp.harmonics = []; disp.stale = false; }
            // 表示用ローリングバッファに積む(直近DISPLAY_WINDOW件を保持)
            disp.centroid.push(disp.lastCentroid); if (disp.centroid.length > DISPLAY_WINDOW) disp.centroid.shift();
            disp.hnr.push(disp.lastHnr); if (disp.hnr.length > DISPLAY_WINDOW) disp.hnr.shift();
            disp.harmonics.push(disp.lastLevels.map((l) => l.norm)); if (disp.harmonics.length > DISPLAY_WINDOW) disp.harmonics.shift();
            disp.validMs = nowPerfMs;
          }
        }
        // フレーム記録用の音色値は、間引きの合間でも直近の計算結果を使う(値が抜けないように)
        if (timbreMeasurable) {
          centroid = disp.lastCentroid;
          hnr = disp.lastHnr;
          levels = disp.lastLevels;
        }
        const holdActive = disp.centroid.length > 0 && nowPerfMs - disp.validMs <= DISPLAY_HOLD_MS;
        if (holdActive) {
          setCentroidHz(median(disp.centroid));
          setHnrDb(median(disp.hnr));
          // 倍音は次数ごとに中央値をとる
          const dispHarm = Array.from({ length: NUM_HARMONICS }, (_, i) => ({
            n: i + 1, norm: median(disp.harmonics.map((h) => h[i] ?? 0)) ?? 0,
          }));
          setHarmonicLevels(dispHarm);
        } else {
          // しばらく測れていない(無音・弱音が続いた)ならバッファを空にして「—」に戻す
          disp.centroid = []; disp.hnr = []; disp.harmonics = [];
          disp.lastCentroid = null; disp.lastHnr = null; disp.lastLevels = [];
          setCentroidHz(null);
          setHarmonicLevels([]);
          setHnrDb(null);
        }


        // --- 100ms周期でフレームを蓄積(録音ボタンでisRecordingがtrueの間だけ) ---
        if (isRecordingRef.current && phraseStartTimeRef.current !== null) {
          const elapsedMs = performance.now() - phraseStartTimeRef.current;
          const selectedIdeal = selectedIdealRef.current;
          const preset = presetRef.current;
          const temperature = temperatureRef.current;

          // --- ノート区間分割・アタック時間検出(rAFレート、100msゲートの外で毎tick実行) ---
          {
            const det = noteDetectorRef.current;
            // ノート境界は「楽器音と判定されているか(sounding)」で決める。ブレスや空調では発音開始にしない。
            if (det.phase === "silence") {
              if (sounding) {
                det.phase = "attack";
                det.onsetMs = elapsedMs;
                det.peakDb = vDb;
                det.samples = [{ t: elapsedMs, vDb }];
              }
            } else if (det.phase === "attack") {
              det.samples.push({ t: elapsedMs, vDb });
              if (vDb > det.peakDb) det.peakDb = vDb;
              if (!sounding) {
                det.phase = "silence"; // 観測窓の途中で消えた短すぎる音はノートとして扱わない
              } else if (elapsedMs - det.onsetMs >= ATTACK_WINDOW_MS) {
                // アタック確定: 観測窓内のピーク-3dBに初到達した時刻までをアタック時間とする
                const target = det.peakDb - 3;
                const hit = det.samples.find((s) => s.vDb >= target);
                const attackTimeMs = hit ? Math.round(hit.t - det.onsetMs) : null;
                det.events.push({ startT: det.onsetMs / 1000, endT: null, attackTimeMs, peakVolumeDb: det.peakDb });
                setPhraseNoteEvents([...det.events]);
                det.phase = "sustain";
                det.samples = [];
              }
            } else if (det.phase === "sustain") {
              if (vDb > det.peakDb) det.peakDb = vDb;
              if (!sounding) {
                const last = det.events[det.events.length - 1];
                if (last && last.endT === null) {
                  last.endT = elapsedMs / 1000;
                  last.peakVolumeDb = det.peakDb;
                  setPhraseNoteEvents([...det.events]);
                }
                det.phase = "silence";
              }
            }
          }

          if (!skipFrameForMetroClick && elapsedMs - lastSampleTimeRef.current >= SAMPLE_INTERVAL_MS) {
            lastSampleTimeRef.current = elapsedMs;

            // ピッチのセント誤差はメーターと同じ実効基準で算出済み(pitchCentsUnified)を使い、
            // 表示メーターと折れ線グラフの0¢基準を完全に一致させる。
            const pitchCentsVsTheory = pitchCentsUnified;
            // 理想値は音(運指の半音インデックス)ごとに持つため、今判定されている音に対応する理想値を都度引く。
            // これにより演奏中の音が変わるたびに比較対象の理想値も自動で切り替わる。
            const noteIdeal = getNoteIdeal(selectedIdeal, matchedFinger?.semitoneIndex);
            const pitchCentsVsIdeal = f0 && noteIdeal?.pitchHz ? centsBetween(f0, noteIdeal.pitchHz) : null;

            const harmNorm = levels.length === NUM_HARMONICS ? levels.map((l) => l.norm) : new Array(NUM_HARMONICS).fill(0);
            const idealHarmNorm = noteIdeal?.harmonicsProfile
              ? noteIdeal.harmonicsProfile.map((h) => h.norm)
              : new Array(NUM_HARMONICS).fill(0);

            const pitchScoreTheory = pitchCentsVsTheory !== null ? pitchMatchScore(pitchCentsVsTheory) : 0;
            const pitchScoreIdeal = pitchCentsVsIdeal !== null ? pitchMatchScore(pitchCentsVsIdeal) : 0;

            // 音色一致度: 理論モデルは倍音の相対強度情報を持たないため、理想値のみを基準とする
            // (企画書v3 2.8節の方針: ピッチ以外は理想値との比較に絞る)
            const timbreScoreIdeal = noteIdeal && timbreMeasurable && centroid !== null
              ? timbreMatchScore(harmNorm, idealHarmNorm, centroid, noteIdeal.centroidHz, hnr, noteIdeal.hnrDb)
              : 0;

            const frame = {
              t: elapsedMs / 1000,
              pitchHz: f0,
              pitchCents: pitchCentsVsTheory,
              matchedWrittenNote: matchedFinger?.writtenLabel ?? null,
              concertNote: noteNow ? `${noteNow.name}${noteNow.octave}` : null, // 実音(コンサートピッチ)の音名。メーター・グラフ表示用
              semitoneIndex: matchedFinger?.semitoneIndex ?? null, // 音域軸集計用(企画書11.7節の対応: 運指の半音インデックス)
              derivedTubeLengthCm: matchedFinger ? deriveTubeLengthCm(matchedFinger.soundingFreqHz, preset.bellRadiusCm, temperature) : null,
              clarity: sounding && mpm ? mpm.clarity : null, // 検出信頼度(集計の重み)
              noteAgeMs: noteDetectorRef.current.phase !== "silence" ? Math.round(elapsedMs - noteDetectorRef.current.onsetMs) : null, // ノート開始からの経過(アタック除外判定用)
              volumeDb: vDb,
              spectralCentroidHz: timbreMeasurable ? centroid : null,
              hnrDb: hnr,
              harmonics: levels.map((l) => ({ n: l.n, freqHz: l.freq, levelNorm: l.norm })),
              matchScore: {
                // ピッチは理論値・理想値の両方を保持(絶対的な正解=理論値があるため)
                pitch: { theoretical: pitchScoreTheory, ideal: pitchScoreIdeal },
                // 音色は理想値のみ(理論値基準は倍音の相対強度を持たず精度が低いため)
                timbre: { ideal: timbreScoreIdeal },
              },
            };
            setPhraseFrames((prev) => {
              const next = [...prev, frame];
              phraseFramesRef.current = next;
              return next;
            });
          }
        } else {
          // --- 録音していない間も、タイムラインを常時動かすための直近30秒ローリングバッファ ---
          // (セッションには保存しない使い捨てのバッファ。録音中はここには積まず、
          // phraseFramesの方をそのままタイムラインに渡す)
          if (liveStartTimeRef.current === null) liveStartTimeRef.current = performance.now();
          const liveElapsedMs = performance.now() - liveStartTimeRef.current;
          if (!skipFrameForMetroClick && liveElapsedMs - lastLiveSampleTimeRef.current >= SAMPLE_INTERVAL_MS) {
            lastLiveSampleTimeRef.current = liveElapsedMs;
            const selectedIdeal = selectedIdealRef.current;
            const noteIdeal = getNoteIdeal(selectedIdeal, matchedFinger?.semitoneIndex);
            const harmNorm = levels.length === NUM_HARMONICS ? levels.map((l) => l.norm) : new Array(NUM_HARMONICS).fill(0);
            const idealHarmNorm = noteIdeal?.harmonicsProfile
              ? noteIdeal.harmonicsProfile.map((h) => h.norm)
              : new Array(NUM_HARMONICS).fill(0);
            const pitchCentsVsTheory = pitchCentsUnified;
            const pitchCentsVsIdeal = f0 && noteIdeal?.pitchHz ? centsBetween(f0, noteIdeal.pitchHz) : null;
            const pitchScoreTheory = pitchCentsVsTheory !== null ? pitchMatchScore(pitchCentsVsTheory) : 0;
            const pitchScoreIdeal = pitchCentsVsIdeal !== null ? pitchMatchScore(pitchCentsVsIdeal) : 0;
            const timbreScoreIdeal = noteIdeal && timbreMeasurable && centroid !== null
              ? timbreMatchScore(harmNorm, idealHarmNorm, centroid, noteIdeal.centroidHz, hnr, noteIdeal.hnrDb)
              : 0;
            const liveFrame = {
              t: liveElapsedMs / 1000,
              pitchHz: f0,
              pitchCents: pitchCentsVsTheory,
              matchedWrittenNote: matchedFinger?.writtenLabel ?? null,
              concertNote: noteNow ? `${noteNow.name}${noteNow.octave}` : null, // 実音の音名(グラフ表示用)
              semitoneIndex: matchedFinger?.semitoneIndex ?? null,
              clarity: sounding && mpm ? mpm.clarity : null,
              noteAgeMs: null, // ノート検出器は録音中のみ稼働(このバッファは保存されない使い捨て)
              volumeDb: vDb,
              spectralCentroidHz: timbreMeasurable ? centroid : null,
              hnrDb: hnr,
              harmonics: levels.map((l) => ({ n: l.n, freqHz: l.freq, levelNorm: l.norm })),
              matchScore: {
                pitch: { theoretical: pitchScoreTheory, ideal: pitchScoreIdeal },
                timbre: { ideal: timbreScoreIdeal },
              },
            };
            setLiveFrames((prev) => [...prev, liveFrame].slice(-LIVE_WINDOW_MAX_FRAMES));
          }
        }
        } catch { /* 1フレームの失敗ではループを止めない(次フレームで回復) */ }
        finally {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      tickRef.current = tick; // タブ切替後の再開(startListeningのマイク再利用パス)で使う
      tick();
      return true;
    } catch (err) {
      // 詳細な原因(権限拒否・デバイスなし等)はコンソールにのみ残し、画面上のアラートは
      // 常に同じ簡潔な一文にする(原因の切り分けはユーザーの手を煩わせない)。
      console.error("getUserMedia failed:", err.name, err.message, err);
      setErrorMsg("マイクにアクセスできませんでした");
      setIsListening(false);
      return false;
    }
  }, []);

  // 録音ボタンのトグル。マイクがまだ繋がっていなければ先に接続を試みる(権限エラー時の再試行も兼ねる)。
  // phraseStartTimeRefをrefで即座にnullにすることで、isRecording stateの反映を待たずに
  // tick()側のフレーム蓄積を同期的に止められるようにしている。
  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      phraseStartTimeRef.current = null;
      finalizeRecording();
      setIsRecording(false);
      if (!metroActiveRef.current) releaseWakeLock(); // メトロノーム動作中はスリープ抑止を維持
      return;
    }
    if (!streamRef.current) {
      const ok = await startListening();
      if (!ok) return;
    }
    setPendingSession(null); // 新規録音を始めるので前回の候補は破棄
    setLastUploadedSession(null); // 前回の「解析が完了しました」表示も消す
    phraseStartTimeRef.current = performance.now();
    recStartPerfRef.current = phraseStartTimeRef.current; // 小節線を録音相対秒に変換する基準
    metroBarPerfTimesRef.current = []; // 今回の録音ぶんの小節頭を貯め直す
    lastSampleTimeRef.current = 0;
    setPhraseFrames([]);
    phraseFramesRef.current = [];
    noteDetectorRef.current = { phase: "silence", onsetMs: 0, peakDb: -100, samples: [], events: [] };
    setPhraseNoteEvents([]);
    setIsRecording(true);
    requestWakeLock(); // 録音中は画面スリープを抑止(スリープで録音が止まるのを防ぐ)
  }, [isRecording, startListening, finalizeRecording, requestWakeLock, releaseWakeLock]);

  // 【重要】startListening/stopListeningは(finalizeRecordingの依存経由で)頻繁に再生成され得るため、
  // 依存配列に直接入れると「関数が変わるたびに前回のeffectのクリーンアップとして古い関数が
  // 呼ばれる」という不具合(以前のstop()二重発火バグと同種)を招く。refで最新の関数を保持し、
  // このeffect自体はtopTabが変わったときだけ発火させる。
  const startListeningRef = useRef(startListening);
  const stopListeningRef = useRef(stopListening);
  const pauseListeningRef = useRef(pauseListening);
  useEffect(() => { startListeningRef.current = startListening; }, [startListening]);
  useEffect(() => { stopListeningRef.current = stopListening; }, [stopListening]);
  useEffect(() => { pauseListeningRef.current = pauseListening; }, [pauseListening]);

  // 【マイク復旧の唯一の入口】無音ウォッチドッグ・トラックのmute/ended・AudioContextのclosed検知・
  // 画面タップ、どの経路もここに集約する(経路ごとに別々のクールダウンを持つと連打で
  // マイクが点滅するため)。マイクを完全に解放してから取り直し、AudioContextが本当に
  // running まで戻ったこととトラックが使える状態であることを確認する。戻らなければ
  // errorMsg でユーザーに知らせ、次のタップで再試行できる状態(micNeedsRetryRef)にする。
  //   urgent=true : ユーザーの明示的なタップからの再試行。クールダウンを短いほうに切り替える
  //                 (0にはしない。連打すると連打ぶんだけマイクを取り直してしまうため)
  // 録音中は絶対に走らせない(セッションが壊れるため)。
  const recoverMic = useCallback(async (reason, urgent = false) => {
    if (isRecordingRef.current) return false;
    if (micRecoveringRef.current) return false;
    const now = performance.now();
    const cooldown = urgent ? MIC_RETRY_TAP_COOLDOWN_MS : MIC_RECOVER_COOLDOWN_MS;
    if (now - micRecoverAtRef.current < cooldown) return false;
    micRecoverAtRef.current = now;
    micRecoveringRef.current = true;
    silentFramesRef.current = 0;
    console.warn("mic recovery:", reason);
    try {
      stopListeningRef.current();
      const ok = await startListeningRef.current();
      const ctx = audioCtxRef.current;
      if (ok && ctx && ctx.state !== "running") {
        // resume()しても running にならなければ、そのコンテキストは close() して作り直す。
        const { ctx: next, rebuilt } = await recoverAudioContext(ctx);
        if (rebuilt) {
          // 作り直したコンテキストの上にはまだノードが1つも無い(古いノードは新しい
          // コンテキストに繋げない)。refに入れてから stopListening で確実に閉じ(=放置してリークさせない)、
          // startListening で source/analyser/バンドパスをすべて作り直す。
          audioCtxRef.current = next;
          stopListeningRef.current();
          await startListeningRef.current();
        }
      }
      const healthy = ok
        && audioCtxRef.current
        && audioCtxRef.current.state === "running"
        && isMicStreamUsable(streamRef.current);
      if (healthy) {
        micNeedsRetryRef.current = false;
        setErrorMsg("");
        return true;
      }
      micNeedsRetryRef.current = true;
      setErrorMsg(MIC_RECOVER_FAILED_MSG);
      return false;
    } catch {
      micNeedsRetryRef.current = true;
      setErrorMsg(MIC_RECOVER_FAILED_MSG);
      return false;
    } finally {
      micRecoveringRef.current = false;
      silentFramesRef.current = 0;
      lastFrameAtRef.current = 0;
      micRecoverAtRef.current = performance.now(); // 復旧に要した時間ぶんクールダウンを食われないよう終了時刻で更新
    }
  }, []);
  useEffect(() => { recoverMicRef.current = recoverMic; }, [recoverMic]);

  // 計測タブに滞在中は自動でマイクを起動し、他タブへ移ったら一時停止する(マイク接続は保持)。
  // 繋ぎ直さないことで、タブを行き来してもマイク許可のポップアップが繰り返し出ないようにする。
  useEffect(() => {
    if (topTab === "measure" && !document.hidden) {
      startListeningRef.current();
    } else {
      pauseListeningRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topTab]);

  // 画面が非表示(バックグラウンド化・画面ロック等)になった間はマイクを完全に解放し(裏で
  // 聞き続けず、端末のマイク使用インジケータも消す)、表示に戻った時点で計測タブに滞在して
  // いれば繋ぎ直す。※アプリ内のタブ切替は上のeffectのpauseで扱うため、ここは実際に画面が
  // 隠れた場合のみ。
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopListeningRef.current();
      } else {
        // 復帰時はまず通常どおり繋ぎ直し、実際に「AudioContextがrunning」かつ「トラックが使える」
        // 状態まで戻れたかを確かめる。戻れていなければ復旧経路(recoverMic)に回す。
        // ここまでやらないと、繋ぎ直しは成功したのに解析バッファが全ゼロ(=-200dB)のまま、という
        // 一番厄介な壊れ方を無言で通してしまう。
        if (topTab === "measure") {
          Promise.resolve(startListeningRef.current())
            .then((ok) => {
              const ctx = audioCtxRef.current;
              const healthy = ok && ctx && ctx.state === "running" && isMicStreamUsable(streamRef.current);
              if (!healthy) recoverMicRef.current("visibility-restore");
            })
            .catch(() => recoverMicRef.current("visibility-restore-error"));
        }
        // Wake Lockは非表示で自動解放されるため、録音中またはアップロード解析中なら復帰時に再取得
        if (isRecordingRef.current || isAnalyzingUploadRef.current) requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [topTab]);

  // 【iOS対策】ユーザー操作なしに作られたAudioContextはsuspendedのまま起動し、その上で作られた
  // sourceが音を流さない(=起動直後からずっと-200dB、リロードでしか治らない)。画面をタップした
  // 時に、runningでなければまずこのジェスチャーの権限内で同期的にresumeを試み、それでも駄目なら
  // 復旧経路(recoverMic)へ回す。復旧経路は1本に統一してあるので、ウォッチドッグ・トラックの
  // mute/ended・このタップが同時に起きても多重に走らない(micRecoveringRef + クールダウン)。
  // errorMsgで「画面をタップしてください」と出した後のタップだけは、クールダウンを飛ばして
  // 即座に再試行する(ユーザーの明示的な操作なので待たせない)。
  useEffect(() => {
    const onGesture = () => {
      const c = audioCtxRef.current;
      // ジェスチャー権限内で同期的にキックする(awaitを挟むと権限が切れる)
      if (c && audioCtxRecoveryAction(c.state) === "resume") c.resume().catch(() => {});
      if (topTab !== "measure" || document.hidden || isRecordingRef.current) return;
      // 【重要】suspendedのまま作られたコンテキスト上のsourceはresume()しても音を流さない。
      // よって「runningでない」だけで取り直しの対象にする(closedだけでは足りない)。
      const ctxBroken = !c || c.state !== "running";
      const micBroken = !isMicStreamUsable(streamRef.current);
      const needsRetry = micNeedsRetryRef.current;
      if (needsRetry) recoverMicRef.current("gesture-retry", true);
      else if (ctxBroken || micBroken) recoverMicRef.current("gesture");
    };
    document.addEventListener("touchend", onGesture, { passive: true });
    document.addEventListener("pointerdown", onGesture, { passive: true });
    return () => {
      document.removeEventListener("touchend", onGesture);
      document.removeEventListener("pointerdown", onGesture);
    };
  }, [topTab]);

  useEffect(() => () => stopListeningRef.current(), []);

  // セッション(またはライブ録音直後のフレーム列)全体を平均して理想値プロファイルとして保存する。
  // 計測タブの録音停止後・アップロード解析完了後・セッション詳細画面のいずれからも共通で呼ばれる。
  // 数十音を1つずつ手動設定するのは非現実的なため、同じ名前のプロファイルが既にあれば
  // そのnotesに今回のデータの音だけをマージ(上書き)する。ない場合は新規作成する。
  // これにより、複数回に分けて録音した音をまとめて1つの理想値プロファイルに積み上げていける。
  // 【F-68】scope: "session"(このセッションだけ) | "performer"(同じ奏者・同じ楽器種別の全セッション)。
  // 対象の選別は selectPerformerSessions が1箇所で持つ(ボタン側は同じ関数で件数だけを出す)。
  const promoteSessionToIdeal = useCallback((sessionLike, name, scope = "session") => {
    const trimmedName = name.trim();
    const targets = scope === "performer" ? selectPerformerSessions(sessions, sessionLike) : [sessionLike];
    // tuningHz は音ごとの実音ラベル(concertLabel)の算出に使う(F-54)。運指テーブルと同じ
    // 基準ピッチ(楽器個体差の補正込み)を渡さないと、記録される音名が計測タブとずれる。
    const newProfile = buildIdealProfileFromSessions(targets, trimmedName, NUM_HARMONICS, effectiveTuningHz, scope);
    setIdealProfiles((prev) => {
      const existingIdx = prev.findIndex((p) => p.name === trimmedName);
      if (existingIdx === -1) {
        setSelectedIdealId(newProfile.id);
        return [...prev, newProfile];
      }
      // 同じ名前があれば notes をマージする(複数回に分けて録った音を積み上げる既存の挙動)。
      // 由来も同じく積む: マージ後のプロファイルには両方のセッションのデータが入っているので、
      // どちらのセッション詳細でも「目安設定中」が出るのが正しい。
      const existing = prev[existingIdx];
      const merged = {
        ...existing,
        notes: { ...existing.notes, ...newProfile.notes },
        sourceKind: newProfile.sourceKind,
        sourceSessionIds: [...new Set([...(existing.sourceSessionIds || []), ...newProfile.sourceSessionIds])],
      };
      setSelectedIdealId(merged.id);
      return prev.map((p, i) => (i === existingIdx ? merged : p));
    });
  }, [NUM_HARMONICS, effectiveTuningHz, sessions]);

  // アップロードされた音声/動画ファイルを、ライブ録音と同じ解析パイプラインで処理し、通常の録音と同じ
  // セッション構造で保存する(企画書のフレームデータ構造に準拠。source:"upload"で区別)。
  // 音声ファイル(wav/mp3/m4a等)はdecodeAudioDataで直接デコードして高速なオフライン解析にかける。
  // 動画ファイル(スマホの録画データ等)はブラウザによってはdecodeAudioDataが音声トラックを
  // 取り出せないことがあるため、その場合は<video>要素で実際に再生する経路にフォールバックする
  // (この場合のみ解析に再生時間と同じだけ時間がかかる)。
  // 【動画の扱い】スマホ直撮り動画はまずWebCodecsで音声トラックだけを高速デコードする
  // (extractAudioViaWebCodecs)。動画本体をデコードしないため実時間再生よりずっと速い。
  // 非対応環境・失敗時のみ、従来の<video>を実際に再生して解析する経路にフォールバックする
  // (この場合のみ解析に再生時間と同じだけ時間がかかる)。
  const handleUploadFile = useCallback(async (file) => {
    if (!file || isAnalyzingUpload) return;
    setErrorMsg("");
    setLastUploadedSession(null); // 前回の「解析が完了しました」表示を消してから始める
    setIsAnalyzingUpload(true);
    isAnalyzingUploadRef.current = true;
    setUploadProgress(0);
    setUploadNeedsTap(null);
    // 解析中は画面スリープを抑止する(スリープで解析が止まって見えるのを防ぐ)。
    // オフライン解析はMessageChannelで進めるためアプリ内のタブ切替では止まらないが、
    // 画面が消えるとiOSはJS実行自体を凍結するため、少なくともスリープは防ぐ。
    requestWakeLock();
    try {
      const analysisOpts = {
        saxType, tuningHz, instrumentOffsetCents, temperature, selectedIdeal,
        noiseGateDb, // 計測下限dB: ライブと同じ値でアップロード解析からもノイズ・無音区間を除外する
        onProgress: setUploadProgress,
        // 自動再生がブロックされた時は「タップして開始」ボタンを出し、新しいタップ内で再開する
        onNeedTap: (startFn) => setUploadNeedsTap(() => startFn),
      };
      const looksLikeVideo = (file.type || "").startsWith("video/") || /\.(mov|mp4|m4v|webm|3gp)$/i.test(file.name || "");
      let frames, noteEvents;
      if (looksLikeVideo) {
        // 動画: まずWebCodecsで音声だけ高速抽出→オフライン解析。失敗したら実時間再生にフォールバック。
        try {
          const { pcm, sampleRate } = await extractAudioViaWebCodecs(file, { onProgress: setUploadProgress });
          const octx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, pcm.length, sampleRate);
          const audioBuffer = octx.createBuffer(1, pcm.length, sampleRate);
          audioBuffer.copyToChannel(pcm, 0);
          ({ frames, noteEvents } = await analyzeAudioBuffer(audioBuffer, analysisOpts));
        } catch (webCodecErr) {
          console.warn("WebCodecs抽出に失敗、実時間再生にフォールバック:", webCodecErr);
          setUploadProgress(0);
          ({ frames, noteEvents } = await analyzeMediaFile(file, analysisOpts));
        }
      } else {
        // 音声ファイル: decodeAudioDataで直接デコード。失敗したら実時間再生。
        try {
          const arrayBuffer = await file.arrayBuffer();
          const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
          const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
          decodeCtx.close();
          ({ frames, noteEvents } = await analyzeAudioBuffer(audioBuffer, analysisOpts));
        } catch {
          ({ frames, noteEvents } = await analyzeMediaFile(file, analysisOpts));
        }
      }

      // 単発のオクターブ誤検出等を除去してから保存する(ライブ録音の保存時と同じ処理)
      frames = sanitizePitchOutliers(frames);

      // フレームは無音区間でも(null値で)積まれるため、「楽器音として判定されたフレームが
      // 1つでもあるか」で有効性を判断する(無音・ノイズだけのファイルは保存しない)。
      const hasSound = frames.some((f) => f.pitchCents !== null && f.pitchCents !== undefined);
      if (hasSound) {
        const session = {
          id: generateId(),
          recordedAt: new Date().toISOString(),
          saxType,
          reedId: selectedReedId,
          linkedAt: selectedReedId ? "eager" : null,
          memo: null,
          performer: selectedPerformer,
          source: "upload",
          sourceFileName: file.name,
          frames,
          noteEvents,
        };
        addSession(session);
        setLastUploadedSession(session);
      } else {
        setErrorMsg("アップロードした音声から有効な音が検出できませんでした");
      }
    } catch (err) {
      setErrorMsg(`音声ファイルの解析に失敗しました: ${err?.message ?? String(err)}`);
    } finally {
      setIsAnalyzingUpload(false);
      isAnalyzingUploadRef.current = false;
      setUploadProgress(0);
      setUploadNeedsTap(null);
      if (!isRecordingRef.current) releaseWakeLock(); // 録音中でなければスリープ抑止を解除
    }
  }, [saxType, tuningHz, instrumentOffsetCents, temperature, selectedIdeal, selectedReedId, selectedPerformer, addSession, isAnalyzingUpload, noiseGateDb, requestWakeLock, releaseWakeLock]);

  const deleteIdealProfile = (id) => {
    setIdealProfiles((prev) => prev.filter((p) => p.id !== id));
    if (selectedIdealId === id) setSelectedIdealId(null);
  };

  // 音名・セント誤差はレンダー時に実効基準ピッチ(基準Hz×個体差オフセット)で導出する。
  // フレーム(折れ線グラフ)側もtick内で同じ実効基準で算出しており、これで0¢の基準が全音で一致する。
  const note = pitch ? freqToNote(pitch, effectiveTuningHz) : null;
  const centsOffset = note ? note.cents : 0;

  // min-height は index.css の .app-root(100vh → 100dvh のフォールバック付き)で当てる。
  // インラインstyleでは同じプロパティを2回書けず、100dvh 未対応環境の受け皿を用意できない。
  // 【N-11 2026/08/17 本人指示】左右の余白は index.css の --page-pad-left / --page-pad-right。
  // 値(14px + 安全域)は**そのトークンが唯一の答え**で、ここは引くだけ。
  // グラフカードの負マージンと浮かせるボタンの右端が同じトークンから引くので、
  // 「本文の左右余白」を1箇所で動かせば3つとも同時に動く(計算値は従来と 1px も変わらない)。
  return (
    <div className="app-root" style={{ background: "var(--c-bg)", color: "var(--c-ink)", fontFamily: "var(--font-jp)", padding: "calc(16px + env(safe-area-inset-top)) var(--page-pad-right) var(--page-bottom-gap) var(--page-pad-left)", boxSizing: "border-box" }}>
      <style>{`
        /* 【F-43・2026-08-04】webfontの@importをここから撤去した。
           - JetBrains Mono: 参照0件の死蔵だった(P2-1)
           - Noto Sans JP: 本番のiPhoneでは --font-jp 先頭のヒラギノが必ず当たり1グリフも使われない
           - Space Grotesk: 本人選定により数字・英字はシステムフォント(SF Pro)+tabular-numsへ移行
           - Instrument Serif(音名の主役書体・本人選定で継続): JSバンドル評価後に読み込みが始まる
             @import だと初回表示で音名がFOUTするため、index.html の preconnect+link に移した。
           ここに@importを書き戻さないこと。 */
        * { box-sizing: border-box; }
        .sans { font-family: var(--font-jp); }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #174585; outline-offset: 2px; }
        input[type=range] { accent-color: #174585; }
        /* 地・枠・角丸は index.css の入力欄の規則(--c-sunk / --c-line-strong / --r-xs)が持つ。
           ここは select 固有の詰めと書体だけ(色を二重管理すると必ず片方が腐る)。 */
        select { padding:6px 8px; font-family: var(--font-jp); font-size:var(--fs-xs); }
        /* (【D-2 2026/08/22】ピボットの軸セレクタ select.pivot-axis-select はここにあったが、
           正典 #13a の3カラムカードで**共有部品 PlainSelect(素のテキスト + ▾)へ寄せた**ので
           使い手が1つも無くなった。読み手ゼロの規則を残さない。) */
      `}</style>

      {/* アプリ名ヘッダーは削除(Claude Designに準拠。タブ切替は画面下部の固定ナビ=BottomNavに集約)。 */}

      {/* 【面の作法】タブの根に作法のクラスを1つだけ付ける(DESIGN-SYSTEM §6 / index.css)。
          計測・リード = 罫(surf-rule) / データ = 沈める(surf-sunk)。
          中のカードは「自分がどの作法の中にいるか」で見た目が決まるので、
          共有部品(PhraseTimeline・MetricCard・TappableMetricCard)を分岐なしで置ける。
          データタブだけ作法を分けるのは、ピボット表など密度が高く、群の境界を
          余白や罫だけでは示せないため(本人指示)。 */}

      {/* リードタブ: 子タブ(登録 / 比較) + 本体。
          【N-5】子タブの行は ReedsTab の中へ移した。正典 .subtabs は「素のテキスト2つ + 右端の…」で、
          右端の「…」が登録一覧の削除モード・開封日の編集を開く。溝つきのセグメントコントロールは
          正典に無いので撤去した。**データタブの子タブ行(AnalysisLabView 側)には触っていない。** */}
      {topTab === "reeds" && (
        <div className="surf-rule">
        <ReedsTab
          key={`reeds-${navNonce}`}
          reeds={reeds} setReeds={setReeds}
          sessions={sessions} updateSessions={updateSessions}
          setTopTab={setTopTab} setSelectedReedId={setSelectedReedId} selectedReedId={selectedReedId}
          selectedIdeal={selectedIdeal} saxType={saxType} tuningHz={effectiveTuningHz}
          compareReedIds={compareReedIds} setCompareReedIds={setCompareReedIds}
          reedsSubTab={reedsSubTab} setReedsSubTab={setReedsSubTab}
        />
        </div>
      )}

      {/* 計測タブでのみ発生しうるエラー(マイク接続・アップロード解析)のため、他タブでは表示しない。
          以前は上部に赤い帯で表示するインライン通知だったが、保存確認モーダル(pendingSession、
          このファイル内)と同じ idiom(下寄せの position:fixed モーダル)に統一する。
          【極めて重要・絶対に壊さないこと】マイク復旧失敗(MIC_RECOVER_FAILED_MSG)のときは、
          documentに付けたジェスチャー復旧パスが**このタップを拾って**即座に再試行する
          (復旧経路は1本に統一してあるのでここでは呼ばない)。成功すれば recoverMic 側が
          errorMsg をクリアする。この仕組みは「タップが document まで伝播すること」に依存して
          いるため、このモーダルは stopPropagation を一切使わない。暗幕(backdrop)・カードの
          どちらをタップしても同じ setErrorMsg("") だけを呼び、伝播を止めない設計にする。
          【position:fixedの配置】環(top 147〜477)を覆わないよう下寄せにする(DESIGN-SYSTEM
          §6.1.5: 計測タブでモーダルを垂直中央に置くと環と必ず重なる)。この要素は既に
          MeasureView 呼び出しより前・SwipeBackArea/SwipePager の外にあるので createPortal は
          使わない(pendingSession モーダルも同じ理由でポータルしていないことを確認済み)。 */}
      {/* 【C-2 + 審査②の修正】アップロードの入口をデータタブへ移したので、
          無音ファイルのエラー(handleUploadFile → setErrorMsg)はデータタブでも出す必要がある。
          ただし**タブで広げてはいけない**。MIC_RECOVER_FAILED_MSG は
          「マイクを再接続できませんでした。画面をタップしてください」と**行動を指示する**が、
          その指示に応えるジェスチャー経路(このファイルの onGesture)は
          `if (topTab !== "measure" …) return;` で**計測タブ限定**。データタブで出すと、
          指示どおりタップしても復旧処理が1行も走らない=嘘の案内になる(審査役がスクショで確認)。
          → **タブではなくメッセージの種類で出し分ける。**
          計測タブ: すべてのエラーを出す / データタブ: 計測タブでしか意味を持たない案内だけ出さない。 */}
      {errorMsg && (topTab === "measure" || (topTab === "analysis" && !ERROR_MEASURE_ONLY.includes(errorMsg))) && (
        <div
          role="dialog" aria-modal="true" aria-label="エラー"
          onClick={() => setErrorMsg("")}
          style={{
            position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.28)",
            display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center",
            padding: "var(--sp-4)",
            paddingBottom: "calc(var(--page-bottom-gap) + var(--sp-4))",
          }}
        >
          <div style={{ width: "100%", maxWidth: 900, background: "var(--c-surface)", borderRadius: "var(--r-lg)", padding: "var(--sp-4)", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
            <div className="sans" style={{ fontSize: "var(--fs-md)", fontWeight: 700, color: "var(--c-danger)" }}>{errorMsg}</div>
          </div>
        </div>
      )}

      {topTab === "measure" && (
        <div className="surf-rule">
        <MeasureView
          isRecording={isRecording} toggleRecording={toggleRecording}
          note={note} centsOffset={centsOffset}
          harmonicLevels={harmonicLevels}
          showIdeal={showIdeal} setShowIdeal={setShowIdeal}
          selectedIdeal={selectedIdeal}
          volumeDb={volumeDb} centroidHz={centroidHz} hnrDb={hnrDb}
          saxType={saxType} setSaxType={setSaxType}
          temperature={temperature} setTemperature={setTemperature}
          tuningHz={tuningHz} setTuningHz={setTuningHz}
          matchedFingering={matchedFingering}
          idealProfiles={idealProfiles}
          selectedIdealId={selectedIdealId} setSelectedIdealId={setSelectedIdealId}
          deleteIdealProfile={deleteIdealProfile}
          NUM_HARMONICS={NUM_HARMONICS}
          reeds={reeds} selectedReedId={selectedReedId} setSelectedReedId={setSelectedReedId}
          performers={performers} selectedPerformer={selectedPerformer}
          setSelectedPerformer={setSelectedPerformer} setPerformers={setPerformers}
          noiseGateDb={noiseGateDb} setNoiseGateDb={setNoiseGateDb} micProcessingWarning={micProcessingWarning}
          scheduledClicksRef={scheduledClicksRef} metroActiveRef={metroActiveRef} metroBarPerfTimesRef={metroBarPerfTimesRef}
          requestWakeLock={requestWakeLock} releaseWakeLock={releaseWakeLock}
          phraseFrames={phraseFrames} phraseNoteEvents={phraseNoteEvents} liveFrames={liveFrames}
          pendingSession={pendingSession} registerPendingSession={registerPendingSession} discardPendingSession={discardPendingSession}
        />
        </div>
      )}
      {topTab === "analysis" && (
        <div className="surf-sunk">
        <AnalysisLabView
          key={`data-${navNonce}`}
          sessions={sessions} reeds={reeds} selectedIdeal={selectedIdeal}
          promoteSessionToIdeal={promoteSessionToIdeal}
          NUM_HARMONICS={NUM_HARMONICS}
          updateSessions={updateSessions} deleteSessions={deleteSessions}
          performers={performers} setPerformers={setPerformers}
          saxType={saxType} tuningHz={effectiveTuningHz}
          pivotRow={pivotRow} setPivotRow={setPivotRow}
          pivotCol={pivotCol} setPivotCol={setPivotCol}
          pivotMetric={pivotMetric} setPivotMetric={setPivotMetric}
          pivotFilters={pivotFilters} setPivotFilters={setPivotFilters}
          /* 【C-1/C-2 で移設】録音のアップロードはデータタブで完結させる(正典)。
             解析処理・エラーモーダルの配線はそのまま流用し、入口と告知だけを移した。 */
          handleUploadFile={handleUploadFile} isAnalyzingUpload={isAnalyzingUpload}
          uploadProgress={uploadProgress} lastUploadedSession={lastUploadedSession} setLastUploadedSession={setLastUploadedSession}
          uploadNeedsTap={uploadNeedsTap} setUploadNeedsTap={setUploadNeedsTap}
        />
        </div>
      )}

      {/* 画面下部の固定タブナビ(Claude Designに準拠)。録音中はタブ移動を無効化する。 */}
      <BottomNav topTab={topTab} onNavTap={handleNavTap} isRecording={isRecording} />
    </div>
  );
}

// 「計測」を表すアイコン(メーターの針)。**下部ナビとリード一覧の測定ボタンが同じ絵を使う**
// ので、綴りはここ1箇所だけに置く(F-63)。片方にコピーを残すと、次に絵を直した人が
// 片方だけ直して食い違う。サイズは呼び出し側が決める(ナビ=30 / 行の中=もっと小さい)。
// 色の既定は currentColor。**SVG のプレゼンテーション属性は var() を解決しない**
// (DESIGN-SYSTEM §1.9)ので、トークンで色を指定したい呼び出し側は親要素の CSS の
// color で渡すこと。hex を直接渡す道も残してある(下部ナビは選択状態で色を出し分ける)。
// 装飾なので aria-hidden。意味は呼び出し側のボタンの aria-label が担う。
function MeasureIcon({ size = 30, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M4 15 A8 8 0 0 1 20 15" /><line x1="12" y1="15" x2="15" y2="9" />
      <circle cx="12" cy="15" r="1.4" fill={color} stroke="none" />
    </svg>
  );
}

// 画面下部の固定ナビ。計測/リード/データをアイコンのみで切り替える(ラベルは aria-label)。
function BottomNav({ topTab, onNavTap, isRecording }) {
  const items = [
    {
      key: "measure", label: "計測",
      icon: (c) => (<MeasureIcon color={c} />),
    },
    {
      // 実際のリード1枚を正面から見たピクトグラム: 先端(チップ)はとがらせず、なだらかな
      // ドーム状のアーチにする。中央より少し下のヴァンプ(削り部)を表す直線、下は平らな尻(ヒール)。
      key: "reeds", label: "リード",
      icon: (c) => (
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 22 L9 10 Q9 4 12 4 Q15 4 15 10 L15 22 Z" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
      ),
    },
    {
      key: "analysis", label: "データ",
      icon: (c) => (
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
          <line x1="7" y1="20" x2="7" y2="13" /><line x1="12" y1="20" x2="12" y2="7" /><line x1="17" y1="20" x2="17" y2="11" />
        </svg>
      ),
    },
  ];
  return (
    /* 【B-1】録音中は下部タブを淡くする(正典の「演奏中」は下部タブ全体が opacity .35)。
       演奏中は「今の音」だけを読む場面なので、周辺を一段落として主役を立てる。
       タブそのものは従来どおり disabled のままで、機能は何も変えていない。
       帯全体に1つだけ掛けるので、選択中/非選択の濃淡の差は淡くしても保たれる。 */
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 30,
      background: "rgba(255,255,255,.92)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      borderTop: "1px solid #ECEEF1", paddingBottom: "env(safe-area-inset-bottom)",
      opacity: isRecording ? 0.35 : 1,
    }}>
      {/* アイコンのみの1行。ラベルを廃してタブ帯の縦幅を小さくする(演奏中の画面領域を広く取るため) */}
      <div style={{ maxWidth: 480, margin: "0 auto", height: 46, display: "flex", padding: "6px 20px 8px" }}>
        {items.map((t) => {
          const active = topTab === t.key;
          const color = active ? "#174585" : "#8D95A1";
          return (
            <button
              key={t.key}
              onClick={() => onNavTap(t.key)}
              disabled={isRecording}
              aria-label={t.label}
              className="sans"
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                background: "none", border: "none", cursor: isRecording ? "default" : "pointer",
                /* 【B-1】録音中の淡さは帯(親)に1回だけ掛ける。ここで重ねて掛けると
                   0.35 × 0.4 = 0.14 になり、正典の .35 より2段暗くなる。 */
                color,
              }}
            >
              {t.icon(color)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// iOS風のスクロールスナップピッカー。中央行が現在値で、スクロールが止まった位置の
// 値を確定してonChangeを呼ぶ(確定ボタンは持たず、選ぶ動作=決定とする)。
// 背景タップ or Escで閉じる。optionsは表示順の配列、labelFnで見た目のラベルに変換する。
function ScrollPicker({ options, value, onChange, onClose, labelFn }) {
  const ROW_H = 38;
  const VISIBLE_ROWS = 3;
  const containerRef = useRef(null);
  const scrollTimerRef = useRef(null);

  useEffect(() => {
    const idx = Math.max(0, options.indexOf(value));
    const el = containerRef.current;
    if (el) el.scrollTop = idx * ROW_H;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleScroll = () => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const el = containerRef.current;
      if (!el) return;
      const idx = Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / ROW_H)));
      el.scrollTo({ top: idx * ROW_H, behavior: "smooth" });
      if (options[idx] !== value) onChange(options[idx]);
    }, 130);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.28)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", width: 140, background: "#FFFFFF", borderRadius: 12, boxShadow: "0 8px 24px rgba(15,23,42,0.18)", overflow: "hidden" }}
      >
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="sans"
          style={{ height: ROW_H * VISIBLE_ROWS, overflowY: "auto", scrollSnapType: "y mandatory", WebkitOverflowScrolling: "touch" }}
        >
          <div style={{ height: ROW_H }} />
          {options.map((o) => (
            <div
              key={o}
              style={{
                height: ROW_H, display: "flex", alignItems: "center", justifyContent: "center",
                scrollSnapAlign: "center", fontSize: 15,
                fontWeight: o === value ? 700 : 400,
                color: o === value ? "#174585" : "#121F32",
              }}
            >
              {labelFn ? labelFn(o) : o}
            </div>
          ))}
          <div style={{ height: ROW_H }} />
        </div>
        {/* 中央行のハイライト帯(選択中の値がここに来る) */}
        <div style={{ position: "absolute", top: ROW_H, left: 0, right: 0, height: ROW_H, borderTop: "1px solid #E9ECF0", borderBottom: "1px solid #E9ECF0", background: "rgba(37,99,235,0.05)", pointerEvents: "none" }} />
      </div>
    </div>
  );
}

// ============================================================
// 【F-72】「押せば選択肢が出る」を形で示す ▾。
//
// 本人指示(2026/08/12・実機): 「モックでは上部の奏者やリードもカード色を変えて
// カード方式にしていない。モックに合わせて。モックどおり ▾ などがあれば
// タップすれば選択肢が出るんだなと直感的に分かる」。
// 地と枠を落とすと「ここは触れる」の信号が全部消えるので、その唯一の代わりがこれ。
// 正典 design/north-star-measure.html の `.chev { color: var(--ink3); font-size: 10px }`
// をそのまま採る(10px は正典の実寸。DESIGN-SYSTEM §6.0 でモックが見た目の唯一の正典)。
// 色はアプリの体系側の同じ役の段 --c-ink-3 を使う(正典 --ink3 #98A1AC の位置)。
// 文字との間隔は正典が半角空白1つなので、体系内の最小段 --sp-1(4px)を当てる。
//
// **必ず「押せるもの」の中に置くこと。** <button> の中か、<select> を指す <label> の中。
// 外に置くと、そこだけ当たり判定の穴になる(N-4 の罠1 と同じ形の事故になる)。
const PICK_CHEV_PX = 10;       // 正典 .chev の font-size
function PickChevron() {
  return (
    <span aria-hidden="true" style={{
      fontSize: PICK_CHEV_PX, color: "var(--c-ink-3)",
      marginLeft: "var(--sp-1)", flexShrink: 0, lineHeight: 1,
    }}>▾</span>
  );
}

// 【F-72】計測タブの上部設定行の <select> は appearance を落として「素のテキスト + ▾」にする。
// 落とさないと、ネイティブの三角を描く環境で ▾ が二重に見える(Chrome で実測: 各 select が
// 自前の三角を持ち、幅が 20px ぶん広い)。
// **appearance を落としたら縦も自分で決める**(DESIGN-SYSTEM §6.7。実機で一度これを踏んでいる)。
// 下の2つの値は**新しく決めた寸法ではなく、落とす前に Chrome 375×812 で実測した現行の値**:
//   奏者の枠 = 28px / リード枠の中の値を包む箱 = 26px
// ※ どちらも「値をテキストで描き、透明な <select> を重ねる」形にしたので、
//   **<select> の高さではなく、それを包む箱の高さ**になっている。
//   役目は同じ(上部設定行の高さ 60px を保ち、環を動かさない。§6.1.5)。
//   重ねた <select> は高さ 100% なので、そちらの固有の縦寸法はもう効かない。
// 【TOPSET_LINE_H_PX(行送り 14px)は削除した】重ねる形にしたときに参照が 0 件になったが、
//   定義とコメントだけが残り「3つとも効いている」ように読めていた。死んだ定数は残さない。
//
// 【ここは Chrome では判定不能・実機待ち(iOS Safari)】
// DESIGN-SYSTEM §6.7 が同じ操作について明記している:
//   「Chrome では、この症状は横も縦も最初から再現しない。Browser pane の実測は必ず『揃っている』と
//     出る。**この欄を触ったときの Chrome の実測は判定に使えない**ので、必ず実機で確認すること」
// したがって上の2つは「どのエンジンでも同じ高さになる」ことの証明にはならない。**Chrome で
// 高さが不変(28/26)だったという事実**だけがここでの根拠で、iOS Safari の <select> が
// appearance を落としたあと同じ高さになるかは**実機で本人が見るまで分からない**。
// ずれていたら、この2定数の調整で吸収する(呼び出し側は触らなくてよい形にしてある)。
// 【overflow の置き場所】§6.7 は overflow:hidden を「最後の歯止め」と書いているが、
// **<select> に書いても Chrome では効かない**(インラインには乗るが computed が visible。実測)。
// 重ねる形では <select> は inset 0 なので自身の overflow は意味を持たない。
// 歯止めは**値を包む箱と値そのもの**に置いてある(overflow:hidden + textOverflow:ellipsis)。
// これが無いと、maxWidth を超える長い銘柄が箱の外へ描かれて隣の #N や ▾ に重なる
// (実測: `D'Addario Select Jazz-3S` で #3 に 56.4px 重なった)。
const TOPSET_PERFORMER_H_PX = 28;
const TOPSET_REED_SELECT_H_PX = 26;

// 計測タブの「これまでの音」ミニタイムライン。SessionDetailView等で使う履歴振り返り用の
// PhraseTimeline(スクラブ・ドリルダウンつき)とは別物として実装する: こちらは直近30秒の
// 理論値(運指テーブル)からのピッチ偏差(セント)をそのまま折れ線で表す。縦軸はメーターと
// 揃えて-50¢〜+50¢に固定する。**±10¢ の良好ゾーンの帯は N-4a で撤去した**(本人判定)。
const RECENT_NOTES_WINDOW_SEC = 30;
const RECENT_NOTES_RANGE_CENTS = 25;

// quiet: 演奏中サーフェス(環のチューナーの下)に置くときの控えめな見せ方。
// 縦軸の数値ラベルを落とし、全体を一段落として環から視線を奪わないようにする。
function PitchDeviationLine({ frames, quiet = false }) {
  const W = 600, H = quiet ? 84 : 110;
  const latestT = frames.length ? frames[frames.length - 1].t : 0;
  const windowFrames = frames.filter((f) => f.t >= latestT - RECENT_NOTES_WINDOW_SEC);

  // x: 「今から何秒前か」を右端=現在・左端=30秒前に固定でマッピングする。
  const x = (t) => W - ((latestT - t) / RECENT_NOTES_WINDOW_SEC) * W;
  // y: -50¢〜+50¢を上下の帯全体にマッピングする(0¢が中央)。範囲外の値は見切れさせず端に寄せる。
  const y = (cents) => {
    const clamped = Math.max(-RECENT_NOTES_RANGE_CENTS, Math.min(RECENT_NOTES_RANGE_CENTS, cents));
    return H / 2 - (clamped / RECENT_NOTES_RANGE_CENTS) * (H / 2 - 6);
  };

  // 無音判定: pitchCentsがnull(=発音判定がfalseだったフレーム。メーターと同じ音量フロア判定で
  // 決まる)。無音は中央(0¢)に落とし、線は途切れず中央ライン上に留まる。
  const isSilent = (f) => {
    const c = f.pitchCents;
    return c === null || c === undefined || isNaN(c);
  };

  // 折れ線は単色グレーで統一する(無音は中央0¢に落として線を途切れさせない)。
  const points = windowFrames
    .map((f) => `${x(f.t)},${y(isSilent(f) ? 0 : f.pitchCents)}`)
    .join(" ");

  // 感知した音名(運指の記音)を時系列に沿ってラベル表示する。連続する同じ音をひとまとまりにし、
  // 各まとまりの先頭位置に音名を出す。無音フレームはまとまりを区切る。SVGはpreserveAspectRatio=none
  // で横に引き伸ばされ文字が歪むため、ラベルはSVGの上にHTMLで重ねて配置する。
  const noteRuns = [];
  let cur = null;
  const MIN_RUN = 2;
  for (const f of windowFrames) {
    // 実音(コンサートピッチ)の音名で表示する。旧データにconcertNoteが無い場合のみ記音にフォールバック。
    const nm = isSilent(f) ? null : (f.concertNote || f.matchedWrittenNote || null);
    if (nm) {
      if (!cur || cur.name !== nm) {
        if (cur && cur.count >= MIN_RUN) noteRuns.push(cur);
        cur = { name: nm, startT: f.t, count: 1 };
      } else cur.count += 1;
    } else {
      if (cur && cur.count >= MIN_RUN) noteRuns.push(cur);
      cur = null;
    }
  }
  if (cur && cur.count >= MIN_RUN) noteRuns.push(cur);
  // ラベルが重なりすぎないよう、直前に置いた位置から一定以上離れているものだけ表示する。
  const labels = [];
  let lastPct = -100;
  for (const r of noteRuns) {
    const pct = (x(r.startT) / W) * 100;
    if (pct - lastPct >= 9) { labels.push({ name: r.name, pct }); lastPct = pct; }
  }

  const axisLabel = { position: "absolute", right: 4, fontSize: 12, color: "#A6AEBA", whiteSpace: "nowrap" };

  return (
    <div style={{ padding: quiet ? "10px 0 0" : "18px 0 0", opacity: quiet ? 0.72 : 1 }}>
      <div style={{ display: "flex" }}>
        {/* 縦軸の目盛ラベル: 上=+25¢ / 中央=0 / 下=-25¢。
            演奏中サーフェス(quiet)では出さない。1m先の12px文字は読めず、環の邪魔になるだけのため。
            音名ラベルは「どの音だったか」を伝える実質的な情報なのでquietでも残す。 */}
        {!quiet && (
        <div style={{ position: "relative", width: 34, height: H, flexShrink: 0 }}>
          <span className="sans" style={{ ...axisLabel, top: 0 }}>+{RECENT_NOTES_RANGE_CENTS}¢</span>
          <span className="sans" style={{ ...axisLabel, top: "50%", transform: "translateY(-50%)" }}>0</span>
          <span className="sans" style={{ ...axisLabel, bottom: 0 }}>-{RECENT_NOTES_RANGE_CENTS}¢</span>
        </div>
        )}
        {/* グラフ本体 */}
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
            {/* 【N-4a で撤去】±10¢ の良好ゾーンの帯。本人判定「真ん中の緑の帯は役目を
                果たしていない」。DESIGN-SYSTEM §6.0「説明を消して形に語らせる」に従い、
                残すのは 0¢ の基準線と音名ラベルだけ。ゾーンの範囲は環の色が返している。 */}
            <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#DDE2E8" strokeWidth="1" />
            {points && <polyline fill="none" stroke="#8D95A1" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
              points={points} />}
          </svg>
          {labels.map((l, i) => (
            <span
              key={i}
              className="sans"
              style={{
                position: "absolute", top: 0, left: `${Math.max(2, Math.min(94, l.pct))}%`, transform: "translateX(-50%)",
                fontSize: 12, fontWeight: 700, color: "#174585", background: "rgba(246,247,249,.85)",
                padding: "1px 5px", borderRadius: 6, whiteSpace: "nowrap", pointerEvents: "none",
              }}
            >
              {l.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// メトロノーム
//
// ・クリック音はWeb Audioの発振器で合成し、「先読みスケジューリング」で正確な拍を刻む
//   (25ms毎のタイマーで120ms先までAudioContextの時計に予約する。タイマー直接発音のブレがない)
// ・拍の解釈: 分母の音符=1拍(6/8なら8分音符が1拍で1小節6クリック。テンポ数値は分母音符の速さ)
// ・振り子はクリックと同じ時計(AudioContext.currentTime)に位相同期し、拍の瞬間に両端へ達する
// ・マイク計測との干渉対策: クリック予定時刻をperformance.now()基準で記録しておき、
//   ライブ計測側が「クリック近傍かつ楽器音なし」のフレーム記録をスキップする
//   (楽器音が鳴っている間は楽器がクリックより支配的で、clarityゲートもあるため記録を続ける)
// ============================================================
const METRO_SIGS = ["1/4", "2/4", "3/4", "4/4", "5/4", "6/4", "3/8", "5/8", "6/8", "7/8", "9/8", "12/8"];
const METRO_SUBDIVS = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3連" },
  { value: 4, label: "4" },
];
const METRO_TEMPO_MIN = 20;
const METRO_TEMPO_MAX = 300;

function clampMetroTempo(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 120;
  return Math.max(METRO_TEMPO_MIN, Math.min(METRO_TEMPO_MAX, n));
}

// "6/8"のような拍子文字列を{num, den}に分解する
function parseMetroSig(sig) {
  const parts = String(sig).split("/");
  const num = parseInt(parts[0], 10);
  const den = parseInt(parts[1], 10);
  return { num: Number.isFinite(num) && num > 0 ? num : 4, den: Number.isFinite(den) && den > 0 ? den : 4 };
}

// X/8拍子で「1拍=8分音符いくつ分か」のグループ配列を返す。3の倍数は全て3、それ以外は
// 3と2で埋める(3→[3] / 5→[3,2] / 6→[3,3] / 7→[3,2,2] / 9→[3,3,3] / 12→[3,3,3,3])。
function metroBeatGroups(num) {
  const g = [];
  let r = num;
  while (r > 0) {
    if (r === 4) { g.push(2, 2); r = 0; }
    else if (r >= 3) { g.push(3); r -= 3; }
    else { g.push(r); r = 0; }
  }
  return g;
}
// X/8拍子で、8分音符インデックス→そこが主拍(グループ)の頭かどうかの集合を作る。
// groups(例:[3,2])を渡せばそのグループ分けを使う(5/8・7/8のユーザー選択用)。合計がnumと
// 合わない/未指定なら自動(metroBeatGroups)にフォールバックする。
function metroX8BeatStarts(num, groups) {
  const g = (Array.isArray(groups) && groups.reduce((a, b) => a + b, 0) === num) ? groups : metroBeatGroups(num);
  const starts = new Set();
  let acc = 0;
  for (const gsize of g) { starts.add(acc); acc += gsize; }
  return starts;
}

// 通算tick番号(0始まり)における、そのtickで鳴らすクリックの強さを返す。
// 返り値: "accent"(小節頭・最強) / "beat"(拍頭・中強) / "sub"(拍内の細分・弱) / "silent"(鳴らさない)。
// 【X/8拍子】グリッドは常に8分音符(1小節=num個)。分子を3と2でグループ分けし、その頭を拍とする。
//   ・subdiv=1: 主拍(グループ頭)だけを鳴らし、拍間の8分音符は"silent"(=主拍のみのクリック)。
//   ・subdiv>=2: 拍を8分音符で埋める。複合拍子なら1拍に8分音符3つ(強-弱-弱)=実質3連符。
// 【X/4等】従来通り。拍頭以外(subdivによる細分)は"sub"、拍頭は先頭accent・他beat。
function metroTickKind(tickIndex, sig, subdiv, accentEnabled, groups) {
  const { num, den } = parseMetroSig(sig);
  const sd = subdiv || 1;
  if (den === 8) {
    const perMeasure = num;
    const idx = ((tickIndex % perMeasure) + perMeasure) % perMeasure;
    const beatStarts = metroX8BeatStarts(num, groups);
    const fill = sd >= 2; // 8分音符で拍を埋めるか
    if (beatStarts.has(idx)) return idx === 0 ? (accentEnabled ? "accent" : "beat") : "beat";
    return fill ? "sub" : "silent";
  }
  const perMeasure = num * sd;
  const idx = ((tickIndex % perMeasure) + perMeasure) % perMeasure;
  const isBeatHead = idx % sd === 0;
  const beatIdx = Math.floor(idx / sd);
  if (!isBeatHead) return "sub";
  if (beatIdx === 0) return accentEnabled ? "accent" : "beat";
  return "beat";
}

// メトロノームのクリック音がマイクに入り得る時間帯か(クリック開始の少し前〜減衰+伝搬遅れ)。
// timesはperformance.now()基準の予定時刻(昇順)。ライブ計測のフレーム記録スキップ判定に使う。
function isNearScheduledClick(times, nowMs, preMs = 30, postMs = 90) {
  for (let i = times.length - 1; i >= 0; i--) {
    const d = nowMs - times[i];
    if (d > postMs) break; // これより古い予定はさらに範囲外なので打ち切り
    if (d >= -preMs) return true;
  }
  return false;
}

// クリック音の元になる白色雑音バッファをAudioContextごとに1回だけ生成しキャッシュする
// (毎tick生成すると無駄なため)。急速減衰エンベロープを焼き込み、短いパーカッシブな
// 「チッ」という質感の種にする(正弦波の柔らかいビープ音ではなく、輪郭のはっきりした
// 抜ける音にするため、倍音の詰まったノイズ+バンドパスで音高感を出す設計にした)。
function getMetroClickBuffer(ctx) {
  if (ctx.__metroClickBuffer) return ctx.__metroClickBuffer;
  const dur = 0.06;
  const n = Math.ceil(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const decay = Math.exp(-i / (n * 0.15));
    data[i] = (Math.random() * 2 - 1) * decay;
  }
  ctx.__metroClickBuffer = buffer;
  return buffer;
}

// メトロノーム出力の共通マスターチェーン(AudioContextごとに1回作りキャッシュ)。
// iOSではマイク(getUserMedia)が有効な間、音声出力が受話口寄り/小音量のルートに切り替わり、
// 端末音量を最大にしてもクリック音が小さくなる問題がある(Web側からルート自体は変えられない)。
// そこで、デジタル段で目一杯持ち上げつつリミッター(DynamicsCompressor)で歪みを抑え、
// 許可の有無によらずできる限り大きく・一定の音量に近づける。
//   [各クリック] → limiter(閾値-3dB・高レシオ) → masterGain(2.6倍) → destination
function getMetroMasterInput(ctx) {
  if (ctx.__metroMasterInput) return ctx.__metroMasterInput;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.05;
  const master = ctx.createGain();
  master.gain.value = 2.6; // マイク有効時の小音量を補うブースト。リミッターが歪みを抑える
  limiter.connect(master);
  master.connect(ctx.destination);
  ctx.__metroMasterInput = limiter;
  return limiter;
}

// クリック音を1回分スケジュールする。白色雑音をバンドパスで整形した短いパーカッシブな
// 「チッ」音(実物のメトロノームや電子ドラムのクリックに近い、はっきり抜ける音)。
// アクセント/拍/分割で中心周波数と音量を変え、聴き分けやすくする。出力はマスターチェーン経由。
function scheduleMetroClick(ctx, t, kind) {
  const src = ctx.createBufferSource();
  src.buffer = getMetroClickBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = kind === "accent" ? 2900 : kind === "beat" ? 2000 : 1300;
  bp.Q.value = 1.6;
  const gain = ctx.createGain();
  const vol = kind === "accent" ? 1.0 : kind === "beat" ? 0.85 : 0.6;
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + src.buffer.duration);
  src.connect(bp);
  bp.connect(gain);
  gain.connect(getMetroMasterInput(ctx));
  src.start(t);
}

// メトロノームアイコン(本体の台形+振り子アーム)
function MetronomeIcon({ color, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 3 L14.5 3 L19 21 L5 21 Z" />
      <line x1="12" y1="17.5" x2="16.2" y2="7.5" />
      <circle cx="16.6" cy="6.5" r="1.4" fill={color} stroke="none" />
    </svg>
  );
}

// 【N-4b で削除】TimeSigStacked(拍子を分子/分母に縦積みして見せる部品)。
// 唯一の呼び出し元だった「拍子パネルを開くボタン」が無くなり、参照0件になった。
// 正典では拍子は**拍の●の左に 4/4 の1行**で出す(MetroPendulum)。

// 【N-4b】3連符は「3」の**文字を書かない**(本人指示。正典のシートも数字を持たない)。
// 旗を1本の桁でつないだ8分音符×3 = 3連符、という譜面そのものの形で見せる。
// 2つ(♫)・4つ(♬)との違いは音符の数と桁の本数で読める。
function SubdivNoteIcon({ value, size = 22, color = "#174585" }) {
  const cfg = {
    1: { n: 1, beams: 0 },
    2: { n: 2, beams: 1 },
    3: { n: 3, beams: 1 },
    4: { n: 4, beams: 2 },
  }[value] || { n: 1, beams: 0 };
  const { n, beams } = cfg;
  const W = 32, H = 24;
  const yHead = 17, yBeam = 5, headRx = 3.6, headRy = 2.7;
  const xs = n === 1 ? [13] : Array.from({ length: n }, (_, i) => 6 + (20 * i) / (n - 1));
  const stemX = (x) => x + 3.0;
  return (
    <svg width={size} height={(size * H) / W} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} aria-hidden="true">
      {xs.map((x, i) => (
        <ellipse key={`h${i}`} cx={x} cy={yHead} rx={headRx} ry={headRy} fill={color} transform={`rotate(-20 ${x} ${yHead})`} />
      ))}
      {xs.map((x, i) => (
        <line key={`s${i}`} x1={stemX(x)} y1={yHead - 1.5} x2={stemX(x)} y2={n === 1 ? yBeam + 1 : yBeam} stroke={color} strokeWidth={1.3} strokeLinecap="round" />
      ))}
      {beams >= 1 && n >= 2 && (
        <line x1={stemX(xs[0])} y1={yBeam} x2={stemX(xs[n - 1])} y2={yBeam} stroke={color} strokeWidth={2.6} />
      )}
      {beams >= 2 && n >= 2 && (
        <line x1={stemX(xs[0])} y1={yBeam + 4} x2={stemX(xs[n - 1])} y2={yBeam + 4} stroke={color} strokeWidth={2.6} />
      )}
    </svg>
  );
}

// 【削除済み】MetronomePendulum(振り子・高さ248×scale)
// 375x812 で 334.8px を占め、これ単体でページを194pxはみ出させて録音ボタンを固定ナビの
// 下に押し込んでいた(BACKLOG P0-1)。拍の表示は環(PitchRing)の下側の未使用弧に移した。
// 環が「上弧=ピッチ / 下弧=拍」の二役を持つことで、縦スペースを増やさずに拍を出せる。
// テンポに応じて錘が動く演出(metroWeightTop / METRO_WEIGHT_TOP_*)も併せて削除した。

// 【削除済み】PitchMeter(横一直線のピッチメーター・残像つき)と PITCH_TRAIL_MS
// メトロノーム表示中のコンパクト1行フォールバックが唯一の呼び出し元で、それを廃して
// 環(PitchRing)に一本化した時点で参照0件になった(BACKLOG P1-5)。
// 目盛の "-50/+50"(fontSize:12) を持っていたが、これは DESIGN-SYSTEM §6.1 の
// 「演奏中サーフェスに目盛の数字を置かない/12px禁止」に真っ向から反する要素だった。

// ============================================================
// 色空間(sRGB ⇔ OKLab ⇔ OKLCH)。
//
// 機能色の補間を sRGB の直線補間でやると、緑#16A34A と橙#D97706 の中間(6.5¢)が
// rgb(120,141,40) という濁ったカーキになる。同じ2色を OKLCH で補間すると
// rgb(160,145,0) の澄んだ金になる。**色そのものは1つも変えていない**。
// 帯のグラデーションも同じ理由でここを通す(明度・彩度・色相を独立に動かせる)。
//
// 純関数としてモジュール直下に置き、scripts/pitch-test.mjs から実行で検証する。
// ============================================================
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
// rgb(0〜255) → OKLab [L, a, b]
function rgbToOklab(rgb) {
  const r = srgbToLinear(rgb[0] / 255);
  const g = srgbToLinear(rgb[1] / 255);
  const b = srgbToLinear(rgb[2] / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
// OKLab [L, a, b] → rgb(0〜255・整数)。sRGB色域外は端で丸める。
function oklabToRgb(lab) {
  const lp = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
  const mp = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
  const sp = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2];
  const l = lp * lp * lp, m = mp * mp * mp, s = sp * sp * sp;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  return lin.map((v) => Math.max(0, Math.min(255, Math.round(linearToSrgb(v) * 255))));
}
// OKLab ⇔ OKLCH(極座標。C=彩度 / H=色相[度])
function oklabToOklch(lab) {
  let h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [lab[0], Math.hypot(lab[1], lab[2]), h];
}
function oklchToOklab(lch) {
  const rad = (lch[2] * Math.PI) / 180;
  return [lch[0], Math.cos(rad) * lch[1], Math.sin(rad) * lch[1]];
}
// 2色を OKLCH で補間する。色相は**最短経路**で回す(反対側を回ると緑→橙の間に
// 青や紫を経由してしまう)。
function mixOklchRGB(rgb0, rgb1, t) {
  const a = oklabToOklch(rgbToOklab(rgb0));
  const b = oklabToOklch(rgbToOklab(rgb1));
  let dh = b[2] - a[2];
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return oklabToRgb(oklchToOklab([
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + dh * t,
  ]));
}

// セント差(絶対値)を緑→橙→赤へ滑らかに補間した色を返す。
// 0¢=緑 / 8¢=橙 / 30¢以上=赤。音程の正誤という機能的意味を持つ色で、装飾都合で変えない。
// 補間は OKLCH(上記)。橙は以前 13¢ にあったが、8¢ は既に「結構違う」領域なので前倒しした。
function pitchBarColorRGB(cents) {
  const a = Math.abs(cents);
  const stops = [
    [0, [22, 163, 74]],    // ジャスト=緑 #16A34A
    [8, [217, 119, 6]],    // やや外れ=橙 #D97706
    [30, [220, 38, 38]],   // 大きく外れ=赤 #DC2626
  ];
  if (a <= stops[0][0]) return stops[0][1];
  if (a >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [c0, col0] = stops[i];
    const [c1, col1] = stops[i + 1];
    if (a >= c0 && a <= c1) return mixOklchRGB(col0, col1, (a - c0) / (c1 - c0));
  }
  return stops[stops.length - 1][1];
}


// ============================================================
// 演奏中サーフェスのチューナー(環)。
//
// このアプリの特殊性: ユーザーは両手で楽器を持ち、口にマウスピースを咥え、スマホは
// 譜面台の上(目から50cm〜1m)にある。手は塞がっていて操作できず、見るのはチラ見・
// 周辺視野。したがってこの画面だけは「文字を読ませない」設計にする。
//
//   - 目盛の数字(-50/+50)は置かない。ズレは環の色と弧の長さだけで伝える
//   - 音名は視線の中心=環の内側に大きく置く
//   - 合った(|¢|<=RING_IN_TUNE_CENTS)ら環が閉じてゆっくり呼吸する。
//     「到達した」を色と動きで返すのがこの画面の唯一の報酬表現
//
// 角度のマッピング: 12時=0¢(ジャスト)を基準に、±RING_MAX_CENTS を ±RING_SWEEP_DEG に
// 割り当てる。上半分だけを使い、下半分は常に空ける(円を一周させると0¢の位置が
// 分からなくなるため)。
//
// 【メトロノーム表示中の環の中身(E案: 振り子＋拍の点)】DESIGN-SYSTEM §6.1。
// 拍マーカーが下弧を往復する形は「既存のメトロノームは上半円なのに下半円で振れる」
// 違和感と、点だけでは今が何拍目か読めない問題があったため作り直した。
//   上半円 = 振り子(予測を担う)。錘が端に近づくのが見えるから身体が次の拍を準備できる。
//            機械式メトロノームの錘が支点の上に来るのは複合振り子の機構上の都合だが、
//            結果としてそれが視覚的な常識になっている。
//   下半円 = 拍の点(今が何拍目かを担う)。点は動かず、灯る場所だけが変わる。
//
// 拍の演出は**毎拍・両端で**出す。実際のメトロノームは両端で鳴るのに、以前の実装は
// 小節頭だけを強調していたため、偶数拍子では cos(π×通算拍) が必ず同じ端に来て
// 片側でしか光らなかった。
//
// 【N-4b】環はピッチ専用になった。拍(振り子・●列)は環の外・下に置く(正典)。
// かつてここには「ピッチマーカーと拍の要素が実寸で最低6 CSS px 離れること」という
// 要件があったが、環の中に拍の要素が無くなったので測る相手そのものが消えた。
// 検証は「PitchRing の中に拍の描画が1つも無いこと」に置き換えている(pitch-test.mjs)。
// ============================================================
const RING_MAX_CENTS = 50;     // 環の端に対応するセント差
const RING_SWEEP_DEG = 110;    // ±RING_MAX_CENTS を割り当てる角度(上弧)
// これ以内なら「合った」として環を閉じる。本人指示(F-47)で 1 → 2 に広げた。
// 【この定数を見ている箇所】(1) 到達の判定 inTune = 走りの発火・帯の抑制・セント値の呼吸
// (2) 外周の光の「合った」側の境界(RING_GLOW_NEAR_CENTS までの帯の起点)。他に閾値の直書きは無い。
const RING_IN_TUNE_CENTS = 2;
// 【撤去】RING_MARKER_MIN_GAP_PX(ピッチマーカーと拍の要素の最小距離)。
// N-4b で拍の描画を環の外へ出したため、環の中に「拍の要素」が1つも無くなり、
// 距離を測る相手がいなくなった。**環はピッチ専用**という、より強い形で置き換わっている。
// 環の形状。viewBoxは300固定で、実寸はCSSの幅で追従させる。
// rAFでDOMを直接書き換える拍マーカーからも参照するためモジュール定数として持つ。
// (テストハーネスが1つずつ抽出するため、まとめて宣言せず1行1定数にする)
const RING_VB = 300;
const RING_CX = 150;
const RING_CY = 150;
const RING_R = 136;
const RING_SW = 14;
// 【削除済み】RING_PITCH_DOT_R(帯の先端に置いていた丸い点)。
// 丸端(stroke-linecap="round")と合わせて、先端に「別の丸いものが付いている」ように
// 見えていた。先端はあくまでグラデーションの終わりで、そこで何かが始まってはいけない。
// 点が無くなったので、拍の要素とのクリアランスの基準は「点の内縁(R-SW/2-3=126)」から
// 「帯の内縁(R-SW/2=129)」になる(クリアランスは広がる)。検証は pitch-test.mjs 側。

// 環の実寸(直径)。DESIGN-SYSTEM §4.2 の表と対応する。
// **メトロノームの開閉で大きさを変えない。** 以前は開くと 330→250 に縮めていたが、
// 環は演奏中サーフェスの主役で、開閉のたびに主役の大きさが変わるのは読み取りを妨げる。
// 縦スペースはメトロノームを開いている間だけ「これまでの音」を隠して捻出する。
const RING_D_FULL = 330;       // 環の直径(常にこの値)

// --- 音名の組み方 ---
// 【N-4c】サイズは**正典 design/north-star-measure.html の実寸**をそのまま採る
// (DESIGN-SYSTEM §6.0: 見た目についてはモックが唯一の正典。§4.2 の比率計算より優先)。
//   .note      148px   .note .oct  44px   .cents  21px(margin-top 10px)
// 以前は「環の直径 × NOTE_FS_RATIO(0.3576) = 118px」と比で持っていた。環は 330px 固定なので
// 比の仕組みは結果を1つに固定するだけになっており、モックの実寸に置き換えても
// 「環が縮んだときに崩れる」という当時の懸念は起きない(環は縮まない)。
const NOTE_FS_PX = 148;        // 正典 .note
const NOTE_OCT_PX = 44;        // 正典 .note .oct
const NOTE_CENTS_PX = 21;      // 正典 .cents
const NOTE_CENTS_GAP_PX = 10;  // 正典 .cents の margin-top
// 【F-77 で復活】NOTE_SCALE_X(1.30)と NOTE_SCALE_PAD_EM(§4.2「横幅を scaleX(1.30) で明示する」)。
// N-4c で一度撤去した。撤去の理由は「正典 design/north-star-measure.html の .note が
// transform を持たない」(DESIGN-SYSTEM §6.0)だったが、**本人が実機で見て
// 「細いので引き伸ばしを継続する」と決めた**(2026/08/12)。本人の直接指示は正典より上位。
// Instrument Serif の既定の送り幅は 0.457em(一般的な serif の64%)で、書体既定のままだと
// 「幅を選んでいない」見え方になる(§4.2)。scaleX(1.30) で 0.594em にする。
const NOTE_SCALE_X = 1.30;     // 音名の横幅(明示指定)
// scaleX は要素のレイアウト幅を変えないため、変形後のグリフが左右に (1.30-1)/2 = 15%
// はみ出す。隣の臨時記号と重ならないよう、送り幅 0.457em の15%分を左右marginで補う。
const NOTE_SCALE_PAD_EM = 0.457 * (NOTE_SCALE_X - 1) / 2;
//
// 【クリアランスの記録。この節の数字は2度書き直している。読む前に測り方まで見ること】
// ・N-4c で撤去の根拠にした 1.41px / 17.83px / 35.08px … **em の箱の角**で測っていて再現しない
// ・F-77 の1周目に書いた 21.16px 等 … **書体の読み込み前**(フォールバックの serif)で測っていて再現しない
//   (`D` の送り幅が 113.96px と出ていた。Instrument Serif の実値は 78.44px)
//   → 測る前に `await document.fonts.ready` を通すこと。これが1周目に外した原因。
//
// 【3度目の実測(2026/08/13)】375×812 / 環の直径 330 / 音名 148px + scaleX 1.30。
//   環の内周の半径 = (RING_R − RING_SW/2) × 330/300 = 141.90 CSS px、中心 (187.5, 261)。
//   測り方: (1) `document.fonts.ready` を待つ (2) 行末に高さ0の inline-block を挿して
//           **ベースラインの実測値**を取る(この条件では 293.5) (3) canvas TextMetrics の
//           actualBoundingBox* を **ベースラインに当てて**インクの矩形を出す。本体だけ
//           transform-origin "center bottom" で 1.30 倍に写す (4) A〜G × ♮/♯/♭ × oct3〜5 の
//           **63通りすべて**を実DOMに入れて走査する。
//   結果(要件は §4.2「視覚幅の左右端が環の内周に対し音名サイズの10%以上」= 14.80px):
//     水平の最悪 … `D♯4` / `D♭4` で **36.39 CSS px**
//                  (インク 左103.79 / 右271.88 / 上186.50 / 下296.50。
//                   水平は**インクの縦の帯の中で弦がいちばん狭くなる高さ**= y186.50 で測る)
//     半径方向の最悪 … `G♯4` / `G♭4` で **29.18 CSS px**(中心から最も遠いインクの角まで 112.72)
//   要件に対し 2.4倍の余裕。**scaleX 1.30 を掛けても要件は割らない。**
//   ※ 審査役は同じ日に 水平 38.88 / 半径 31.41 を報告している。名前(D♯4・D♭4)は一致するので
//     差は**水平をどの高さで測るかの定義差**とみられる(上の (4) の取り方が違うと数 px ずれる)。
//     ここに書いてあるのは上の手順で再現できる値。**定義ごと読み替えずに引き写さないこと。**
// **この値をハーネスで検算することはできない**(Node に書体の字幅が無い)。
// pitch-test が縛るのは「scaleX(NOTE_SCALE_X) が音名の本体に掛かっている」という構造だけで、
// **環内周とのクリアランスは縛っていない**。書いていない検査を「縛っている」と書かないこと(F-39)。
//
// 臨時記号(♯/♭)は音名に付属する記号。本体と近いサイズだと主従が逆転して見えるため
// 明確に小さくする。横幅の指定は本体だけに掛け、記号には掛けない。
// モックの計測タブは臨時記号のある音(G♯ 等)を描いていないので、比は §4.2 のまま残す。
const NOTE_ACC_RATIO = 0.34;   // 臨時記号 = 音名の34%

// 12時を0として時計回りに測った角度(度) → SVG座標
function ringPoint(deg, r, cx, cy) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
}

// --- 振り子(N-4b で環の外へ出した) ---
//
// 【なぜ環から出したか】正典 design/north-star-measure.html の「メトロノーム中」は、
// 環をピッチ専用のまま残し、拍は**環の下**に「浅い弧のガイド1本 + 点1つ」と
// 「拍の●列」として置く(本人確定 2026/08/11)。DESIGN-SYSTEM §6.0 は
// 「本節と他節が矛盾する場合、目標状態としては本節が勝つ / 置き換えは画面単位」と定めており、
// §6.1 の「環の二役(上半円=振り子 / 下半円=拍の点)」はこの画面の置き換えで役目を終える。
// 環は**ピッチ専用**になったので、帯と拍が場所を争う問題そのものが無くなった。
// 【撤去した定数】RING_PEND_R / RING_PEND_BOB_* / RING_PEND_HALO_* /
// RING_BEAT_DOT_ORBIT_R / RING_BEAT_DOT_SPREAD_DEG / RING_BEAT_DOT_* / RING_MARKER_MIN_GAP_PX。
// いずれも「環の中に拍を描く」ための値で、参照0件になったため残さない。
//
// 【ガイドの弧は正典で復活した】以前「軌道のガイド線は描かない」という本人指示で消していたが、
// 確定版の正典は浅い弧を1本描いている。錘(大きな円)を細い点に落としたぶん、
// 点だけでは往復の道筋が読めないため。**新しい指示が古い指示を上書きしている。**
const RING_PEND_SWING_DEG = 55;     // 振れ角(12時=0°、時計回り)。拍の瞬間が両端になる

// ============================================================
// 【F-95a】メトロノーム一式の拡大率。**正典の上書き**。
//
// 本人指示(実機 2026/08/16)「メトロノームはB」。B とは統括が作った比較サンプル
// design/metro-size-sample.html の B 列(--k:1.20)で、**正典 design/north-star-measure.html
// の .pend 一式を丸ごと 1.20 倍したもの**。サンプルが `--k` 1つで全部を動かしているのと
// 同じ作りにする = 拡大はこの定数1箇所からしか入らない。
//
// 【正典との関係】下の基準値(150/26/7/12/16/72/48/12/15/20/34)は**正典のまま1つも動かさない**。
// 画面に出る実寸は「基準値 × METRO_SCALE」で導く。だから正典が変われば基準値だけを直せばよく、
// 本人が倍率を変えるならこの1行だけを直せばよい。
// 【この値の身分】REC_RING_SW と同じ「本人の実機確認待ちの暫定値」。
// 正典の中に無い数はこの1つだけ(design/BACKLOG.md の「新設した値」の表に起票すること)。
// 【F-100 2026/08/17 本人指示】「前(1.0)と今(1.2)の中間に」→ 1.2 → **1.1**。
// サンプル design/metro-size-sample.html の B 列の --k も 1.1 へ上書き済み(検査はそこから読む)。
const METRO_SCALE = 1.1;

// 【F-95b】拍の瞬間に大きくなる倍率。正典 .beat.on の scale(1.4) を**上書き**する。
// 本人指示(実機 2026/08/16)「振り子が端に触れるときの大きくなるのも今よりも大きくして」。
// 【1つの定数が2箇所を動かす】この倍率は
//   (a) 振り子の点が端(=拍の瞬間)で膨らむ最大倍率 metroDotR
//   (b) 拍の●列の「今の拍」の倍率 metroBeatDotR
// の両方が使う。本人が名指ししたのは (a) の言葉づかいだが、両者は同じ瞬間に起きる同じ演出で、
// 分けると正典に無い2つ目の数を発明することになるので、**1つのまま引き上げる**。
// 【上限】行の高さ METRO_BEAT_ROW_H(16) が ●の最大直径 7×倍率 を含む必要がある。
// 1.8 → 12.6、2.2 → 15.4 なので、統括が言う 2.2 までは行を1pxも動かさずに上げられる。
const METRO_DOT_HEAD_SCALE = 1.8;

// ガイドの弧。正典の <svg width="150" height="26"> と path "M10 8 Q75 30 140 8" そのもの。
// 【単位】ここから下の弧まわりの数はすべて **viewBox 単位**(環のように直径で伸縮させない)。
// F-95a 以前は svg を実寸で描いていたので viewBox 1単位 = 1 CSS px だったが、
// **今は viewBox 1単位 = METRO_SCALE CSS px**(svg の width/height だけを拡大しているため)。
// 弧の幾何・振り子の物理はこの単位のままで、拡大は最後の描画にしか効かない。
const METRO_ARC_W = 150;
const METRO_ARC_H = 26;
const METRO_ARC_P0 = [10, 8];       // 左端
const METRO_ARC_C = [75, 30];       // 制御点(浅い弧)
const METRO_ARC_P2 = [140, 8];      // 右端
const METRO_ARC_SW = 1.5;           // ガイドの線幅(正典 stroke-width)
const METRO_DOT_R = 5;              // 往復する点の半径(正典 circle r=5)
// 拍の瞬間に膨らむ最大倍率は METRO_DOT_HEAD_SCALE(F-95b。上の定義を参照)。

// --- 拍の●列(今が何拍目かを担う。正典 .beatrow) ---
const METRO_BEAT_DOT_PX = 7;        // 正典 .beat の 7px(直径)
const METRO_BEAT_GAP_PX = 12;       // 正典 .beatrow の gap
// 行の高さは固定する。点が膨らんでも行が伸びないようにするため(DESIGN-SYSTEM §6.1.5)。
// 最大直径 = 7 × METRO_DOT_HEAD_SCALE(F-95b で 1.8)= 12.6 なので、
// それを含む偶数の 16 を箱にする(2.2 まで上げても 15.4 で収まる)。
const METRO_BEAT_ROW_H = 16;

// テンポの −/＋ の**反応領域**。正典 .pmt の 72×48(DESIGN-SYSTEM §6.0 の予告改訂にも同じ値)。
// 見た目(46×46 のピル)と文字サイズは据え置きで、当たり判定だけをこの大きさにする
// (DESIGN-SYSTEM §5「見た目の大きさは変えない。当たり判定だけ広げる」)。
// テンポ数値の箱も同じ幅にして、桁が変わっても ± が動かないようにする(§6.1.5)。
// 【F-95a 以降】この 72×48 は**基準値**。計測タブのテンポ行は METRO_PM_W_CSS(=×1.2)で描く。
// リード追加シートの ±(枚数)は拡大の対象外なので、そちらは基準値の 72 のまま使う。
const METRO_PM_W = 72;
const METRO_PM_H = 48;
// 正典 .pmt の font-size 20 / .bpmtxt の 15 / .tsig の 12 / ± を並べる行の gap 34。
// 【なぜ定数にしたか】F-95a で 1.2 倍にするため。数値のまま JSX に散らすと
// 「1箇所の定数から導く」が成り立たない。値は正典のまま(拡大は METRO_SCALE 側が持つ)。
const METRO_PM_FS = 20;             // 正典 .pmt の font-size
const METRO_BPM_FS = 15;            // 正典 .bpmtxt の font-size
const METRO_TSIG_FS = 12;           // 正典 .tsig の font-size
const METRO_PM_GAP = 34;            // 正典 ± を並べる行の gap

// --- 【F-95a】画面に出る実寸(CSS px)= 正典の基準値 × METRO_SCALE ---------------
// ここより下では基準値を直接描かない。全部この派生を通す。
// 【svg は viewBox を正典の単位のまま残す】幅・高さだけを CSS px で拡大するので、
// 弧の幾何(METRO_ARC_P0/C/P2)・振り子の物理・●の座標式は**1行も変わらない**。
// 拡大は最後の描画だけに効く。
const METRO_ARC_W_CSS = METRO_ARC_W * METRO_SCALE;
const METRO_ARC_H_CSS = METRO_ARC_H * METRO_SCALE;
const METRO_BEAT_ROW_H_CSS = METRO_BEAT_ROW_H * METRO_SCALE;
const METRO_PM_W_CSS = METRO_PM_W * METRO_SCALE;
const METRO_PM_H_CSS = METRO_PM_H * METRO_SCALE;
const METRO_PM_FS_CSS = METRO_PM_FS * METRO_SCALE;
const METRO_BPM_FS_CSS = METRO_BPM_FS * METRO_SCALE;
const METRO_TSIG_FS_CSS = METRO_TSIG_FS * METRO_SCALE;
const METRO_PM_GAP_CSS = METRO_PM_GAP * METRO_SCALE;

// --- 録音ボタン(F-89) ---
// 本人指示(実機 2026/08/15)「録音ボタンはスマホの動画開始、停止ボタンと同じに変更
// (とる前は枠全体の丸、とると四角に形が変わる形式)」。
//
// 正典 design/north-star-measure.html の .rec は
//   68px の円 / 1.5px の輪 / 中身 = 待機26pxの丸・録音中22px(r5)の四角
// で、**「丸→四角」はすでに正典どおり実装されていた**。本人が言っている差分は
//   (a) 輪が細い(1.5px)ので「輪」に見えない
//   (b) 中の丸が 26px = 外径の 38% しかなく、輪の中に小さな点が浮いて見える
//      (スマホのカメラは輪の内側いっぱいまで赤で埋まっている)
// の2点。**本人の実機指示は正典より上位**(F-75 / F-77 と同じ扱い)。
//
// 【規範外なのは下の5つのうち REC_RING_SW と REC_RING_GAP の**2つだけ**。統括/本人の確認待ち。】
// 残る3つは正典 design/north-star-measure.html にある値をそのまま使っている:
//   REC_BTN_D=68 … .rec の width(行66) / REC_STOP_PX=22・REC_STOP_R=5 … .rec .stop(行69)
// 外径 68 は動かさない(本人指示「位置と外径は動かさない」)。録音中の四角も正典のまま。
// 内側の丸は「輪の内側いっぱい」= 外径 −(輪の太さ + 隙間)×2 から**導く**ので、
// 新しく決めた数は結局 REC_RING_SW と REC_RING_GAP の2つに閉じている。
// (この数え方は design/BACKLOG.md の F-84〜F-92「新設した値」の表と一致させること。)
const REC_BTN_D = 68;        // 正典 .rec の外径。丸→四角で1pxも動かさない
const REC_RING_SW = 4;       // 輪の太さ(新設)。正典の 1.5px では「輪」に見えないため
const REC_RING_GAP = 3;      // 輪と中身の隙間(新設)
const REC_STOP_PX = 22;      // 正典 .rec .stop の 22px
const REC_STOP_R = 5;        // 正典 .rec .stop の border-radius 5px

// 録音ボタンの**中身**の寸法。待機=丸(輪の内側いっぱい) / 録音中=四角(正典 .stop)。
// 【純関数にする理由】JSX はテストのハーネスから見えない(LOOP.md)。
// 「形が変わるだけで外径と位置は動かない」は**中身が外径を超えない**ことで担保されるので、
// その不変条件をここで検査できる形にしておく。
// 戻り値の size/radius はそのまま CSS px。radius が size/2 なら円、それ未満なら角丸の四角。
function recInnerShape(isRecording) {
  if (isRecording) return { size: REC_STOP_PX, radius: REC_STOP_R };
  const d = REC_BTN_D - 2 * (REC_RING_SW + REC_RING_GAP);
  return { size: d, radius: d / 2 };
}

// --- 拍の演出(毎拍・両端で出す) ---
const RING_BEAT_EMPH_DECAY = 2.2;   // 拍内位相 × これ を 1 から引く
const RING_BEAT_EMPH_HEAD = 1;      // 小節頭の係数
const RING_BEAT_EMPH_OTHER = 0.55;  // それ以外の拍の係数

// 12時=0の角度で from → to を結ぶ、半径 RING_R の弧のパス。
// 角度の符号がそのまま回転方向になる(to>from なら時計回り = sweep 1)。
function ringArcD(from, to) {
  const [ax, ay] = ringPoint(from, RING_R, RING_CX, RING_CY);
  const [bx, by] = ringPoint(to, RING_R, RING_CX, RING_CY);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M${ax.toFixed(2)},${ay.toFixed(2)} A${RING_R},${RING_R} 0 ${large},${sweep} ${bx.toFixed(2)},${by.toFixed(2)}`;
}

// ============================================================
// 帯のグラデーション(先端からの**絶対弧長**で塗る)。
//
// 【なぜ帯の長さで正規化しないのか】
// 以前はランプを「帯の長さ」で正規化していた。これが短い帯が汚かった原因。
// ±24¢ の帯は弧長125、±8¢ は42。そこへ同じ工程を押し込むと3分の1に圧縮されて
// **断層として見える**。実用域は ±10¢ なので、そこで成立しないと意味がない。
// だから色は「先端から何 viewBox 単位か」だけで決め、帯の長さでは割らない。
//
// RING_RAMP_REF は「作り込む長さ」。62 viewBox 単位 = 62/136 rad = 26.12° で、
// 角度→セントの写像(RING_SWEEP_DEG/RING_MAX_CENTS = 2.2°/¢)を逆に辿ると 11.9¢。
// 実用域 ±10¢ をランプの内側に収め、その少し外側で色が飽和する長さとして選んだ。
//
// 明度差・彩度倍率・色相ずれの3つとも **単調**。明るさの山(芯)は置かない。
// 単調なら断層は原理的に出ない。
// ============================================================
const RING_RAMP_REF = 62;      // ランプを作り込む弧長(viewBox単位)
const RING_RAMP_STOPS = 30;    // グラデーションのストップ数

function ringSmoothstep(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

// base の色を OKLCH 上で動かす。dL=明度差 / cMul=彩度倍率 / dH=色相ずれ(度)。
function ringTuneRGB(base, dL, cMul, dH) {
  const lch = oklabToOklch(rgbToOklab(base));
  return oklabToRgb(oklchToOklab([lch[0] + dL, Math.max(0, lch[1] * cMul), lch[2] + dH]));
}

// 先端からの弧長 s(viewBox単位)における帯の色。s は帯の長さで割らない(上記)。
function ringRampRGB(base, s) {
  const e = ringSmoothstep(s / RING_RAMP_REF);
  return ringTuneRGB(base, 0.105 * e - 0.062 * (1 - e), 1.12 - 0.30 * e, -9 * e + 7 * (1 - e));
}

// 線形グラデーションの軸は「根元の点 → 先端の点」を結ぶ**弦**なので、弧上の点は
// 弦へ射影した位置に置かないと色がずれる(以前は等間隔で近似していた)。
// 180°以下の弧では射影は単調なので offset は非減少になる。
// 返り値: [{ offset(0〜1), s(先端からの弧長・viewBox単位) }]
function ringGradientStops(from, to) {
  const [x0, y0] = ringPoint(from, RING_R, RING_CX, RING_CY);
  const [x1, y1] = ringPoint(to, RING_R, RING_CX, RING_CY);
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const out = [];
  for (let i = 0; i < RING_RAMP_STOPS; i++) {
    const phi = from + (to - from) * (i / (RING_RAMP_STOPS - 1));
    const [px, py] = ringPoint(phi, RING_R, RING_CX, RING_CY);
    const off = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
    out.push({
      offset: Math.max(0, Math.min(1, off)),
      s: Math.abs(((to - phi) * Math.PI) / 180) * RING_R,
    });
  }
  return out;
}

// ============================================================
// 到達の演出(走り + 外側だけの呼吸)。
//
// 合った瞬間、帯が12時から両サイドへ同時に走り、6時で出会う(全周360°)。
// DESIGN-SYSTEM §6.1 は「到達の表現を上弧に留める」としているが、**到達したときだけは
// 全周を使ってよい**という許可を本人から得ている(2026-08-03)。到達していない間は
// 従来どおり上弧だけを使う。
//
// 光は環の**外側だけ**。トラックの内縁より内側は完全に透明のままにする(減衰カーブが
// そこで0になる)。音名の可読性と静けさのため、これは要件。
// 光は「合った」ときだけでなく ±RING_GLOW_NEAR_CENTS まで出す(F-47。下の外周の光の節)。
// ============================================================
const RING_RUN_MS = 640;         // 12時→6時に走り切るまで
// 外れた状態がこれだけ続くまで走り直さない。
//
// 【根拠(実コンポーネントと同じ EMA=0.15/フレームを60fpsで駆動して実測)】
// 数値は F-47 で判定線を ±1 → ±2 に広げたあとに取り直したもの。
// (1) 判定線の上でごく短く揺らしたときの「inTune が偽である連続時間」。
//     揺らしは判定線に対する相対量なので、振幅は判定線の倍数で置く
//     (EMA は線形・判定はしきい値比較なので、この系は判定線に対してスケール不変。
//      ±1 のときの実測値と完全に一致する):
//       振幅3.0倍/1.5Hz → 交差47回・最長 267ms
//       振幅1.6倍/0.8Hz → 交差25回・最長 333ms
//       振幅2.0倍/0.5Hz → 交差16回・最長 650ms
//       振幅1.2倍/3Hz   → 交差0回(EMAが吸収して一度も外れない)
//     つまり**揺らしだけなら最長でも 650ms** で、0.9〜1.0秒には届かない。
// (2) 0.9秒を超えるのは揺らしではなく「一度はっきり外して戻す」場合。
//     生の音程を +15¢ に保持してから戻すと、EMA が 15¢→判定線まで戻るぶんが尾として
//     足される。判定線が ±2 になって尾は 278ms → **200ms** に縮んだので、
//     650ms 保持での外れ時間は 928ms → **850ms**。
//
// 【1200 の位置づけ(F-47 で根拠を置き直した)】
// ±1 のときは「650ms 保持の外れ(928ms)が 900 では抑制を抜ける」ことが直接の根拠だった。
// ±2 では 850ms なので、その事例では 900 でも抑制される。根拠は事例ではなく掃引の境目で持つ:
//   ・抑制 900ms は保持 690ms から、抑制 1200ms は保持 990ms から走り直す
//   ・つまり 1200 のほうが厳しく、「生の外れが 800ms までは走らず 1000ms 以上で走る」
//     という選定時の性質はそのまま保たれている
// 「一瞬ぶれただけ」と「一度離れて戻ってきた」の境目がこの位置に来る。
const RING_RUN_REARM_MS = 1200;
const RING_BREATH_MS = 2600;     // 呼吸の周期
const RING_BREATH_RISE = 0.50;   // 周期のうち上りに使う割合
const RING_GLOW_AMP = 0.90;      // 光の最大の強さ(時間方向。呼吸と走りの立ち上がりに掛かる)

// ============================================================
// 外周の光(F-47)。本人選定の試作 public/ring-proto.html「案③ やや強め」をそのまま移植した。
//
// 【何を作るか】環の縁から間接照明のように漏れる光。
//
// 【粒について・実測で分かっていること】本人は「均一なグラデーションではいけない、粒の表現が
//   要るかも」と要望し、試作にも粒(feTurbulence)を入れて案③を選定した。**しかし実測すると、
//   案③のパラメータでは粒は画面にほぼ出ていない**:
//     ・粒を1に固定した場合との合成後の最大画素差は **0.972/255**(r=172)
//     ・円周720点の標準偏差は r=168〜172 で 0.164〜0.455 出るが、**粒を外して測っても同値**
//       (r=168 で 0.183 / r=170 で 0.455)。このばらつきは減衰カーブの量子化ディザであって
//       粒起因ではない。粒の有無で SD は変わらない
//     ・本人が選んだ試作(public/ring-proto.html 案③)を同じ手順で測ると 0.983/255(r=168.5)。
//       本体の 0.972 と **0.011/255 しか違わない** = 移植は試作と同一の見え方になっている
//   つまり**移植の欠陥ではなく、本人が選定した試作そのものが最初から粒を出していない**。
//   いま見えている質感は下の減衰カーブが作っており、粒の寄与は 8bit の量子化より下にある。
//
//   【粒を効かせたくなったときに知っておくこと・実測】粒の機構(RING_GLOW_GRAIN_* と外側の
//   入れ子)は本人の要望の経緯があるので残してあるが、**下の定数を動かすだけでは点かない**:
//     ・grainLo 0.30 → 0.00(範囲を最大に開く)でも粒の寄与は 0.972 → **0.972** で不変。
//       このつまみはマスク全体を暗くして光を薄くするだけで、ばらつきの上限は
//       falloff(r)×ramp(r) に縛られたまま
//     ・rampPow 1.8 → 0.6 でも 0.958/255 で不変。0.2 まで振ると 2.068/255(なお不可視)だが、
//       **光そのものが明るくなる**(r=150 の画素 235 → 241)ので「粒だけを強くする」操作にならない
//   効かせるには `falloff × ramp` という掛け算の**構造**を変える必要がある
//   (例: 粒を外側の傾斜だけでなく減衰マスク側へ掛ける)。つまみ探しで時間を溶かさないこと。
//   **「外へ行くほど粒に分解して散る」と書かないこと**(実際には見えていない。F-37 と同種の負債になる)。
//
// 【要点1: 光の最大は環の外縁(RING_GLOW_EDGE_R)に置く】
//   立ち上がり(RING_GLOW_RISE_R → RING_GLOW_EDGE_R)は環のトラックの下に隠れるので、
//   見える範囲では「環の縁からいきなり明るい光が出て外へ薄れる」= 環から漏れ出る光になる。
//   立ち上がりが外縁より外まで続くと、環と光の間の数pxが淡いまま残り
//   **環と光の間に細い明るい線**が見える(試作の初期版で本人が指摘した不具合)。
//
// 【要点2: 終端で値も傾きも0にする】exp(-decay·x)·(1-x)³ は x=1 で値も微分も0になる。
//   ここが折れると「グラデーションの終わり」が縁として見える。
//
// 【要点3: mix-blend-mode を一切使わない】試作の初版は粒をマスクの中で
//   mix-blend-mode:multiply で重ねており、その指定がマスク内で効かない環境では
//   ノイズが全面に加算されて**画面全体が緑になった**(本人報告)。
//   現行はマスクの入れ子(=掛け算)だけで作る:
//       <g mask=減衰>                       ← 最外。ここが0なら何も描かれない
//         <g mask=1-傾斜>       光 </g>      ← 内側: 滑らかな光
//         <g mask=傾斜><g mask=粒> 光 </g></g> ← 外側(粒を掛ける。実測では 1/255 未満)
//   減衰マスクが常に最外に掛かるので、どんな事情があっても環の外側へは漏れない。
//
// 【毎フレーム変えるのは明るさだけ】ストップも粒も静的に1度だけ作り、rAF は
//   いちばん外の <g> の opacity だけを動かす(作り直すと重い)。
//
// 試作からそのまま引いた値(案③): peak 0.66 / rMax 190 / decay 2.3 /
//   grainLo 0.30 / grainHi 1.00 / rampPow 1.8 / ストップ44段。
// 試作の座標は viewBox 300 基準なので、本体の RING_VB に合わせて換算する(RING_VB=300 なので等倍)。
// ただし環そのものの寸法は試作(R=128/線幅10 → 外縁133)と本体(R=136/線幅14 → 外縁143)で違うため、
// 外縁から外への到達距離は試作の 57 に対し本体は 47 viewBox 単位になる。
// ============================================================
// 「合った」の外側で、走らせずに光だけを出す範囲(本人指示: ±4以内はほんのり広がる)。
const RING_GLOW_NEAR_CENTS = 4;
const RING_GLOW_PEAK = 0.66;                        // 環の外縁での明るさ(本人選定: 案③)
const RING_GLOW_EDGE_R = RING_R + RING_SW / 2;      // 光の最大の位置 = 環のトラックの外縁
// 立ち上がりの開始。トラックの内縁(RING_R - RING_SW/2)と外縁の間に収め、**全部トラックの下に隠す**。
// 試作は外縁の 0.7×線幅 内側(133-7=126)から立ち上げていたので、同じ比で置く。
const RING_GLOW_RISE_R = RING_GLOW_EDGE_R - 0.7 * RING_SW;
const RING_GLOW_R_MAX = 190 * (RING_VB / 300);      // 光が届く半径(ここで値も傾きも0)
const RING_GLOW_DECAY = 2.3;                        // 裾の伸び(小さいほど遠くまで)
// 粒まわりの3つは「粒の強さのつまみ」に見えるが、**動かしても粒は点かない**
// (grainLo を 0.30→0.00 に振り切っても寄与は 0.972→0.972 で不変)。
// 効かせるには掛け算の構造ごと変える必要がある。冒頭の【粒を効かせたくなったときに
// 知っておくこと・実測】を必ず読むこと。
const RING_GLOW_RAMP_POW = 1.8;                     // 粒が効き始める急さ(実測では粒の強さを変えられない)
const RING_GLOW_GRAIN_LO = 0.30;                    // 粒の明るさの下限(実測では効かない。上の注意書きを見ること)
const RING_GLOW_GRAIN_HI = 1.00;                    // 粒の明るさの上限
const RING_GLOW_STEPS = 44;                         // 減衰・傾斜を近似するストップの段数
const RING_GLOW_SEED = 6;                           // 粒(feTurbulence)の種。案③のもの
// ストップを刻み始める半径。立ち上がりの開始より内側なら値は0のままなのでどこでもよいが、
// 環のトラックの内縁に合わせて「トラックの下から刻み始める」形にする。
const RING_GLOW_STOP_R0 = RING_R - RING_SW / 2;
// 光を塗る矩形。マスクで削るための下地なので、光の届く範囲(半径190)を余裕をもって覆う。
// 試作の {x:-80, y:-80, 460×460} をそのまま換算したもの。
const RING_GLOW_RECT_MIN = -80 * (RING_VB / 300);
const RING_GLOW_RECT_SIZE = 460 * (RING_VB / 300);

// 光の減衰。環の外縁で最大(RING_GLOW_PEAK)、そこから外へ exp·(1-x)³ で0へ落ちる。
function ringGlowAlphaAt(r) {
  if (r <= RING_GLOW_RISE_R) return 0;
  if (r < RING_GLOW_EDGE_R) {
    const t = (r - RING_GLOW_RISE_R) / (RING_GLOW_EDGE_R - RING_GLOW_RISE_R);
    return RING_GLOW_PEAK * t * t * (3 - 2 * t);
  }
  const x = (r - RING_GLOW_EDGE_R) / (RING_GLOW_R_MAX - RING_GLOW_EDGE_R);
  if (x >= 1) return 0;
  return RING_GLOW_PEAK * Math.exp(-RING_GLOW_DECAY * x) * Math.pow(1 - x, 3);
}

// 粒の効き具合(0=内側は滑らか / 1=外側は完全に粒まかせ)。環の外縁から数え始める。
function ringGlowRampAt(r) {
  const x = Math.max(0, Math.min(1, (r - RING_GLOW_EDGE_R) / (RING_GLOW_R_MAX - RING_GLOW_EDGE_R)));
  return Math.pow(x, RING_GLOW_RAMP_POW);
}

// 減衰・傾斜を多段のストップで近似する(直線2〜3本だと折れ目が見える)。
// offset はグラデーションの半径 RING_GLOW_R_MAX に対する割合。
function ringGlowStops(fn) {
  const out = [];
  for (let i = 0; i <= RING_GLOW_STEPS; i++) {
    const r = RING_GLOW_STOP_R0 + (RING_GLOW_R_MAX - RING_GLOW_STOP_R0) * (i / RING_GLOW_STEPS);
    out.push({ offset: r / RING_GLOW_R_MAX, value: fn(r) });
  }
  return out;
}

// 3種のストップは静的。毎フレーム作り直さない(重い)。
const RING_GLOW_FALLOFF_STOPS = ringGlowStops(ringGlowAlphaAt);
const RING_GLOW_GRAINY_STOPS = ringGlowStops(ringGlowRampAt);
const RING_GLOW_SMOOTH_STOPS = ringGlowStops((r) => 1 - ringGlowRampAt(r));

// 走りのイージング: ease-out cubic。勢いよく出て6時へそっと着地する。
function ringRunEase(p) {
  const t = Math.max(0, Math.min(1, p));
  return 1 - Math.pow(1 - t, 3);
}

// 走りの進捗を DOM 書き換えの単位(小数4桁)へ**切り捨てで**量子化する。
// 【なぜ必要か】rAF は書き換えの間引きに `p.toFixed(4)` をキーとして使う。以前は
// キーだけを丸め、描画には量子化前の p を渡していた。toFixed は四捨五入なので
// t=617ms(p=0.99996)でキーが "1.0000" に丸まり、以降キーが変わらず**最終フレームが
// 書かれない**。走りの終端が ±179.9916° で止まり、6時に 0.044 CSS px の隙間が残った
// (8倍解像度のラスタで1画素だけ背景色が検出された)。
// 切り捨てにして**キーの値と描画に使う値を同一にする**ことで、進捗が本当に1になった
// フレームで必ずキーが変わり、終端が ±180.0000° になる。
function ringRunQuantP(raw) {
  if (raw >= 1) return 1;
  return Math.floor(ringRunEase(raw) * 1e4) / 1e4;
}

// イージング前の線形進捗(0〜1)。光の立ち上がりはこちらを使う。
function ringRunProgress(runFrom, now) {
  if (runFrom === null || runFrom === undefined) return 0;
  return Math.max(0, Math.min(1, (now - runFrom) / RING_RUN_MS));
}

// 呼吸の波形。正弦波ではなく smoothstep を上り下りに分けたもの。
// 両端での変化が緩く、中ほどが速い。
function ringBreath(ms) {
  const u = (((ms % RING_BREATH_MS) + RING_BREATH_MS) % RING_BREATH_MS) / RING_BREATH_MS;
  return u < RING_BREATH_RISE
    ? ringSmoothstep(u / RING_BREATH_RISE)
    : 1 - ringSmoothstep((u - RING_BREATH_RISE) / (1 - RING_BREATH_RISE));
}

// 光の実効不透明度。ズレの大きさで3つの段に分かれる(本人指示 F-47)。
//   |¢| <= RING_IN_TUNE_CENTS   合った。走り(線形進捗)に合わせて立ち上がり、そのあと呼吸する
//   〜 RING_GLOW_NEAR_CENTS     走りは出さない。光だけを出し、合格線に近いほど強く、
//                               RING_GLOW_NEAR_CENTS でちょうど0になるよう連続的に落とす
//   それより外 / 音が無い        光らない
//
// 【rAF の中に条件分岐を散らさない】段の切り替えはこの純関数の中に閉じる。そうすれば
// ハーネスが数値を固定できる(コンポーネントの中の if はハーネスから見えない)。
// absCents に音が無いことを表す NaN が来た場合も、最初の判定が偽になって0を返す。
function ringGlowOpacity(runRaw, breath, absCents) {
  const ac = Math.abs(absCents);
  if (!(ac <= RING_GLOW_NEAR_CENTS)) return 0;
  if (ac <= RING_IN_TUNE_CENTS) return RING_GLOW_AMP * runRaw * (0.34 + 0.66 * breath);
  return RING_GLOW_AMP * ((RING_GLOW_NEAR_CENTS - ac) / (RING_GLOW_NEAR_CENTS - RING_IN_TUNE_CENTS));
}

// 光の色。帯より明るく彩度を落とす。「光源の色」ではなく「照らされた面の色」にするため。
function ringGlowRGB(base) {
  return ringTuneRGB(base, 0.16, 0.62, 0);
}

// 再走行の抑制。±RING_IN_TUNE_CENTS の判定線の上でピッチが揺れると走りが何度も起きる。
// **一度走ったら、外れた状態が RING_RUN_REARM_MS 続くまで走り直さない。**
// 抑制中に合格へ戻った場合は、走りをやり直さず点灯状態(進捗1)から始める
// = runFrom を now - RING_RUN_MS に置く(ringRunProgress が即座に1を返す)。
//
// コンポーネントの中に if を書くとハーネスから見えないので、状態遷移をここへ切り出す。
// prev / 返り値: { runFrom, outSince }
//   runFrom  走りを開始した時刻(ms)。合格していない間は null
//   outSince 外れ始めた時刻(ms)。初期値 -Infinity(=十分長く外れていた→初回は必ず走る)
function ringRunState(prev, inTune, now) {
  const p = prev || {};
  const runFrom = p.runFrom === undefined ? null : p.runFrom;
  const outSince = p.outSince === undefined || p.outSince === null ? -Infinity : p.outSince;
  if (!inTune) return { runFrom: null, outSince: runFrom === null ? outSince : now };
  if (runFrom !== null) return { runFrom, outSince: null };
  const rearmed = now - outSince >= RING_RUN_REARM_MS;
  return { runFrom: rearmed ? now : now - RING_RUN_MS, outSince: null };
}

// 振り子の錘の角度(12時=0とした度)。位相(拍単位の連続値)を上半円の往復に写す。
// cos(π*phase) なので拍の瞬間(位相が整数)にちょうど両端へ達する。
// 停止中(phase===null)は静止した振り子と同じく最下点=12時(0°)に置く。
function ringPendDeg(phase) {
  if (phase === null || phase === undefined) return 0;
  return RING_PEND_SWING_DEG * Math.cos(Math.PI * phase);
}

// 停止したあと、止まった瞬間の角度から中央(0°)へ**減衰しながら**戻る(本人指示 F-51:
// 「いきなり真ん中に戻るのではなく、本物の振り子のようにゆっくり中央へ戻る」)。
//
// 【値を発明しない】角振動数も時定数も、動作中の振り子そのものから引く。
// 動作中は deg = RING_PEND_SWING_DEG × cos(π × phase) で phase = 経過秒 / beatDur なので、
// 角振動数は ω = π / beatDur。**自由振動になっても振れの速さは変えない**のが自然なので
// そのまま使う。減衰の時定数 τ も同じ beatDur(=片道1振りぶんの時間)を採る。
// つまり「1振りごとに振幅が 1/e(約37%)になる」。BPM から導かれる既存の量だけで決まり、
// DESIGN-SYSTEM に無い新しい定数を1つも持ち込まない。
function ringPendSettleDeg(fromDeg, beatDurSec, elapsedSec) {
  if (!(beatDurSec > 0)) return 0;
  return fromDeg * Math.exp(-elapsedSec / beatDurSec) * Math.cos((Math.PI / beatDurSec) * elapsedSec);
}
// 角度1度あたり、弧の上の点が何 CSS px 動くか。
// 角度→弧のパラメータ t の写像は線形(下の metroPendT)なので dt/ddeg = 1/(2×振れ角)。
// 【事実の訂正】以前ここに「2次ベジエの速さは弧の中央(t=0.5)で**最大**」と書いていたが、
// これは**逆**だった。B'(t) = 2[(1−t)(C−P0) + t(P2−C)] で C−P0=(65,22) / P2−C=(65,−22) なので
//   |B'(0)| = |B'(1)| = 2√(65²+22²) = 137.244  … 端が最大
//   |B'(0.5)| = |P2 − P0| = 130                … 中央が最小
// **値(130)は変えていない。変えたのは理由の書き方。** この定数の唯一の用途は
// ringPendSettleDone の「これ以上動いても toFixed(2) の文字列が変わらないか」の判定で、
// 戻りの終盤は角度が0の近傍 = **弧の中央の近傍**にしか行かない(角度 → t の写像は
// t = 0.5 + deg/(2×振れ角) なので deg→0 は t→0.5)。判定に効くのは中央での速さであって
// 端での速さではないので、130 が正しい。端の 137.244 を使うと、中央付近では絶対に
// 到達しない速さで見積もることになり、必要より長く回し続ける。
const METRO_ARC_PX_PER_DEG = (METRO_ARC_P2[0] - METRO_ARC_P0[0]) / (2 * RING_PEND_SWING_DEG);

// 戻りきったか。**包絡(振幅)だけ**を見る(cos は途中で何度も0を通るので角度では判定できない)。
// しきい値は描画の丸め。点の座標は toFixed(2) で書くので、変位がこれ未満になれば
// 以後どう動いても属性の文字列は変わらない=静止と区別できない。
// 【単位】viewBox 単位。F-95a 以前は弧が実寸だったので CSS px と同じ値だったが、
// 今は画面上 0.005 × METRO_SCALE = 0.006 CSS px に相当する。判定の意味(属性の文字列が
// 変わらなくなる = 静止と区別できない)は viewBox 単位のまま変わらない。
const RING_PEND_SETTLE_EPS_VB = 0.005; // toFixed(2) の丸め幅(属性は viewBox 単位で書く)
function ringPendSettleDone(fromDeg, beatDurSec, elapsedSec) {
  if (!(beatDurSec > 0)) return true;
  const envelope = Math.abs(fromDeg) * Math.exp(-elapsedSec / beatDurSec);
  return envelope * METRO_ARC_PX_PER_DEG < RING_PEND_SETTLE_EPS_VB;
}

// 角度(12時=0とした度・時計回りが正) → ガイドの弧のパラメータ t∈[0,1]。
// 左端(−振れ角)=0 / 中央(0°)=0.5 / 右端(+振れ角)=1。
// 角度が正のとき右へ行くのは、環に描いていた頃の錘の向き(時計回りが右)と同じ。
// 角度の写像そのもの(ringPendDeg / ringPendSettleDeg)は環の時代から一切変えていないので、
// 「拍の瞬間が両端」も「停止後は中央へ減衰しながら戻る(F-51)」もそのまま成立する。
function metroPendT(deg) {
  const t = 0.5 + deg / (2 * RING_PEND_SWING_DEG);
  return Math.max(0, Math.min(1, t));
}

// ガイドの弧(2次ベジエ)の上の点。正典 path "M10 8 Q75 30 140 8" と同じ制御点を使う。
function metroArcPoint(t) {
  const u = 1 - t;
  return [
    u * u * METRO_ARC_P0[0] + 2 * u * t * METRO_ARC_C[0] + t * t * METRO_ARC_P2[0],
    u * u * METRO_ARC_P0[1] + 2 * u * t * METRO_ARC_C[1] + t * t * METRO_ARC_P2[1],
  ];
}

// 往復する点の半径。**毎拍**、演出量 e に比例して膨らむ。
// 【F-100 2026/08/17 本人指示】「拍ごとに強調が入るように」。従来は `isHead ? e : 0` で
// **小節頭以外の e を 0 に潰していた**(頭拍限定の原因はこの1箇所。ringBeatEmphasis 自体は
// 毎拍 e>0 を返している: 小節頭 1 / それ以外 0.55)。潰すのをやめ、e をそのまま使う。
//   ・強弱の差は e の係数(RING_BEAT_EMPH_HEAD/OTHER)が既に持つ: アクセントONなら頭拍が
//     より大きく膨らみ、OFFなら全拍同じ 0.55(鳴り方と同じ。§6.1「小節頭の"差"を出さない」)。
//   ・最大倍率 METRO_DOT_HEAD_SCALE(1.8)は据え置き(本人指示)。
// isHead 引数は呼び出し側の綴りを固定している検査(F-95b)との配線を変えないため残すが、
// 半径には使わない。
function metroDotR(isHead, e) {
  return METRO_DOT_R * (1 + (METRO_DOT_HEAD_SCALE - 1) * e);
}

// 拍の演出量(0〜1)。**毎拍・両端で**出す(実際のメトロノームは両端で鳴る)。
// 拍の瞬間に最大で、拍内位相 × RING_BEAT_EMPH_DECAY のぶんだけ減衰して0になる。
// 強さの係数だけを小節頭(1)とそれ以外(0.55)で分ける。
// ficus-breathe と同じく「静かに立ち上がって消える」量として使い、明滅はさせない。
//
// accentOn = メトロノームの「一拍目にアクセントをつける」設定(metroAccent)。
// これがOFFのときは強拍が"鳴らない"ので、視覚だけが小節頭を主張してはいけない
// (鳴っていないものを見せるのは、P1-6が直そうとした「鳴るのに見えない」の裏返しになる)。
// この設定が効くのは小節頭の"差"だけで、拍そのものの演出は毎拍出る(毎拍鳴っているため)。
function ringBeatEmphasis(phase, beatsPerMeasure, accentOn) {
  if (phase === null || phase === undefined) return 0;
  const beat = Math.floor(phase);
  const emph = Math.max(0, 1 - (phase - beat) * RING_BEAT_EMPH_DECAY);
  return emph * (ringBeatIsHead(phase, beatsPerMeasure, accentOn) ? RING_BEAT_EMPH_HEAD : RING_BEAT_EMPH_OTHER);
}

// 今が小節の何拍目か(0起点)。停止中・拍子未確定は null。拍の●はこれで灯る場所を変える。
function ringBeatIndex(phase, beatsPerMeasure) {
  if (phase === null || phase === undefined || !(beatsPerMeasure > 0)) return null;
  const beat = Math.floor(phase);
  return ((beat % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure;
}

// 今の拍が小節頭か。アクセント設定がOFFなら鳴り方が同じなので小節頭として扱わない。
function ringBeatIsHead(phase, beatsPerMeasure, accentOn) {
  if (!accentOn) return false;
  return ringBeatIndex(phase, beatsPerMeasure) === 0;
}

// 拍の●列の幅(**viewBox 単位**。画面上の実寸は ×METRO_SCALE = rowWCss)。
// ●が n 個、間隔 METRO_BEAT_GAP_PX。
// 列は画面中央に置く(本人指示「拍の●は中央固定」)ので、拍子表示の位置もこの幅から決める。
function metroBeatRowW(n) {
  if (!(n > 0)) return 0;
  return n * METRO_BEAT_DOT_PX + (n - 1) * METRO_BEAT_GAP_PX;
}

// i 番目の●の中心x(列の左端を0とした **viewBox 単位**)。左から右へ数える。
function metroBeatDotX(i, n) {
  if (!(n > 0)) return 0;
  return i * (METRO_BEAT_DOT_PX + METRO_BEAT_GAP_PX) + METRO_BEAT_DOT_PX / 2;
}

// ●の半径(viewBox 単位)。**位置は動かさず、大きさと色だけが変わる**(正典 .beat / .beat.on)。
// 現在の拍だけ METRO_DOT_HEAD_SCALE 倍(F-95b で 1.8。正典 .beat.on の 1.4 の上書き)。
// 膨らみのアニメーションは往復する点の側が担うので、
// ●列は「今が何拍目か」だけを静かに返す(1画面で動く物を増やさない)。
function metroBeatDotR(isCurrent) {
  return (METRO_BEAT_DOT_PX / 2) * (isCurrent ? METRO_DOT_HEAD_SCALE : 1);
}

// 【N-4b】環は**ピッチ専用**になった。拍(振り子・拍の●)は環の外・下の MetroPendulum が描く。
// 正典 design/north-star-measure.html の「メトロノーム中」がその形(環と共存)。
// diameter: 環の実寸(直径)。音名のサイズはこれに比例させる(DESIGN-SYSTEM §4.2)。
function PitchRing({ note, centsOffset, diameter = RING_D_FULL }) {
  const sounding = !!note;
  const rawExact = note ? Math.max(-RING_MAX_CENTS, Math.min(RING_MAX_CENTS, note.centsExact ?? centsOffset)) : 0;

  // 生のピッチはフレーム毎に細かく揺れるため指数移動平均で落ち着かせる。ただし音名(半音)が
  // 変わった瞬間はcentsExactが大きく飛ぶのでスナップして平滑をやり直す
  // (隣の音へ不自然にスウィープしない)。
  const smoothRef = useRef({ semi: null, val: 0 });
  let exact = rawExact;
  if (sounding) {
    const semi = Math.round(note.midi);
    if (smoothRef.current.semi !== semi) smoothRef.current = { semi, val: rawExact };
    else smoothRef.current.val += (rawExact - smoothRef.current.val) * 0.15;
    exact = smoothRef.current.val;
  } else {
    smoothRef.current = { semi: null, val: 0 };
  }

  // viewBoxは300固定。実寸は幅に追従させる(上限が diameter)。
  const VB = RING_VB, CX = RING_CX, CY = RING_CY, R = RING_R, SW = RING_SW;
  // 【N-4c】音名のサイズは正典の実寸(148px)。臨時記号だけ比で従う。
  const noteFs = NOTE_FS_PX;
  const deg = (exact / RING_MAX_CENTS) * RING_SWEEP_DEG;
  const [mx, my] = ringPoint(deg, R, CX, CY);
  const [r, g, b] = pitchBarColorRGB(exact);
  const color = `rgb(${r},${g},${b})`;
  // 光の色は帯より明るく彩度を落とす(「光源の色」ではなく「照らされた面の色」)。
  // 初期値だけJSXで置き、以降はrAFが元色の変化に追従して塗り替える。
  const glowRGB = ringGlowRGB([r, g, b]);
  const glowColor = `rgb(${glowRGB[0]},${glowRGB[1]},${glowRGB[2]})`;
  const inTune = sounding && Math.abs(exact) <= RING_IN_TUNE_CENTS;

  // 音名は "A" / "B♭" / "F♯" の形。本体の文字と臨時記号でサイズを変えるため分解する。
  // 【音が入っていないときは文字を出さない】以前は "—" を置いていたが、待っている状態は
  // 環のトラックだけで読める。文字で説明しない(DESIGN-SYSTEM §6.1)。
  const noteLetter = sounding ? note.name.charAt(0) : "";
  const accidental = sounding ? note.name.slice(1) : "";
  // 文字を消しても箱は残す(§6.1.5)。行の高さは「音名サイズ × 行送り」で、幅は環の内寸いっぱい。
  // これを明示しないと、文字が無いときに行の高さが0になり、環の内側の寸法が状態で変わる。
  // 行送りは正典の .note の line-height:1 に合わせる(以前は 0.82 で詰めていた)。
  const NOTE_LINE_H = 1;
  const noteBoxH = noteFs * NOTE_LINE_H;

  // 0¢(12時)から現在位置までの弧。ズレが小さいうちは描かない(点にしかならないため)。
  // 到達している間は全周を走る帯がここを覆うので描かない(±2¢ の帯は弧長10.4で線幅14より短い)。
  const [sx, sy] = ringPoint(0, R, CX, CY);
  const arcD = (inTune || Math.abs(deg) < 1) ? "" : ringArcD(0, deg);
  // 帯の色は「先端からの絶対弧長」で決める(帯の長さでは割らない)。ストップの位置は
  // 弧を弦へ射影して求める(線形グラデーションの軸は弦なので、等間隔に置くと色がずれる)。
  const barStops = ringGradientStops(0, deg);
  // SVGのid衝突を避ける(同じ画面に環が2つ出ても混ざらないように)。
  // useId() の返り値はコロンを含むので url(#...) に使えるよう落とす。
  const uid = useId().replace(/:/g, "");
  const barGradId = `ring-bar-${uid}`;
  const runGradIds = [`ring-run-l-${uid}`, `ring-run-r-${uid}`];
  // 外周の光。減衰・傾斜(内/外)・粒の4つのマスクを入れ子にする。
  const glowFalloffId = `ring-glow-falloff-${uid}`;
  const glowSmoothId = `ring-glow-smooth-${uid}`;
  const glowGrainyId = `ring-glow-grainy-${uid}`;
  const glowNoiseId = `ring-glow-noise-${uid}`;

  // --- 到達の演出(走り + 外側だけの呼吸) ---
  // 走りは640ms、呼吸は2.6秒周期で続くため、Reactの再レンダーを挟まずrAFで書き換える。
  const runStateRef = useRef({ runFrom: null, outSince: -Infinity });
  const runPathRefs = useRef([null, null]);   // [左弧, 右弧]
  const runGradRefs = useRef([null, null]);
  const runStopRefs = useRef([[], []]);
  const glowGroupRef = useRef(null);          // 光のいちばん外の <g>。明るさはここの opacity だけ
  const glowFillRefs = useRef([]);            // 光を塗る矩形 [滑らかな側, 粒の側]
  // rAFから読む最新値。走りの判定と色の元になる。
  // glowCents は光の段(合った / ±RING_GLOW_NEAR_CENTS まで / それ以外)を決める |¢|。
  // 音が入っていないときは NaN を渡し、ringGlowOpacity 側で0になるようにする。
  const liveRef = useRef({ inTune: false, base: [22, 163, 74], glowCents: NaN });
  liveRef.current = { inTune, base: [r, g, b], glowCents: sounding ? Math.abs(exact) : NaN };
  useEffect(() => {
    // 動きを減らす設定。rAFで属性を書き換えるぶんはCSSの @media が効かないので自分で見る。
    // 走りは行わず進捗1(点灯した状態)から始め、呼吸は止めて breath=1 で固定する。
    // **光は消さない**(到達したことは伝える必要がある)。
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf;
    let lastKey = "";
    let lastGlow = "";
    let lastBase = "";
    const loop = () => {
      const now = performance.now();
      const reduce = reduceMotion.matches;
      const st = ringRunState(runStateRef.current, liveRef.current.inTune, now);
      runStateRef.current = st;
      // イージング前の線形進捗。光の立ち上がりはこれに比例させる。
      const raw = st.runFrom === null ? 0 : (reduce ? 1 : ringRunProgress(st.runFrom, now));
      // 【p は量子化後の値】キー(小数4桁)と描画に使う値を同一にする。分けると
      // 終端が書かれず 179.9916° で止まる(ringRunQuantP のコメント参照)。
      const p = ringRunQuantP(raw);
      const breath = reduce ? 1 : ringBreath(now);
      const base = liveRef.current.base;
      // 帯の形と色は進捗と元色が変わったときだけ書き換える(消えている間は何もしない)。
      const key = p <= 0 ? "off" : `${p.toFixed(4)}|${base.join(",")}`;
      if (key !== lastKey) {
        lastKey = key;
        const spread = 180 * p;
        for (let k = 0; k < 2; k++) {
          const path = runPathRefs.current[k];
          const grad = runGradRefs.current[k];
          if (!path || !grad) continue;
          if (spread <= 0) { path.setAttribute("d", ""); continue; }
          // 深い端(先端 s=0)が12時に来る向きで使う。走る先端は ±180*p 側。
          const from = (k === 0 ? -1 : 1) * spread, to = 0;
          path.setAttribute("d", ringArcD(from, to));
          const [ax, ay] = ringPoint(from, RING_R, RING_CX, RING_CY);
          const [bx, by] = ringPoint(to, RING_R, RING_CX, RING_CY);
          grad.setAttribute("x1", ax.toFixed(2));
          grad.setAttribute("y1", ay.toFixed(2));
          grad.setAttribute("x2", bx.toFixed(2));
          grad.setAttribute("y2", by.toFixed(2));
          const list = ringGradientStops(from, to);
          for (let i = 0; i < list.length; i++) {
            const el = runStopRefs.current[k][i];
            if (!el) continue;
            const c = ringRampRGB(base, list[i].s);
            el.setAttribute("offset", list[i].offset.toFixed(5));
            el.setAttribute("stop-color", `rgb(${c[0]},${c[1]},${c[2]})`);
          }
        }
      }
      // 光の色。**走りが出ていない間(±RING_GLOW_NEAR_CENTS までの帯)も光るので、
      // 走りのキーとは別に、元色が変わったときだけ塗り替える。**
      const baseKey = base.join(",");
      if (baseKey !== lastBase) {
        lastBase = baseKey;
        const gl = ringGlowRGB(base);
        for (const el of glowFillRefs.current) {
          if (el) el.setAttribute("fill", `rgb(${gl[0]},${gl[1]},${gl[2]})`);
        }
      }
      // 【毎フレーム変えるのは明るさだけ】いちばん外の <g> の opacity だけを動かす。
      // 減衰のストップも粒も静的なので作り直さない。
      const glow = glowGroupRef.current;
      const op = ringGlowOpacity(raw, breath, liveRef.current.glowCents).toFixed(4);
      if (glow && op !== lastGlow) { glow.setAttribute("opacity", op); lastGlow = op; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    /* 【pointerEvents: none】環は読む物で、押す物を1つも持たない(拍の要素は出て行った)。
       ここを既定のままにすると、position:relative の箱が 330×330 の当たり判定として
       背面レイヤ(A-1)の上に乗り、環の上と内側の余白でタップが死ぬ。実測で確認して直した。
       レイアウトは1pxも変わらない(pointer-events は寸法に影響しない)。 */
    <div style={{ width: "100%", maxWidth: diameter, margin: "0 auto", position: "relative", pointerEvents: "none" }}>
      {/* 【overflow: visible】外周の光は環の外縁(viewBox 143)から RING_GLOW_R_MAX(190)まで
          届くので、viewBox(半径150)の内側では収まらない。既定の overflow:hidden のままだと
          viewBox の枠で切られて**四角い切り口が縁として見える**(r=150 の時点で減衰は
          まだ最大の44%残っている)。切らずに外へ出す。
          レイアウトには影響しない(はみ出すのは描画だけで、要素の寸法は変わらない §6.1.5)。
          【pointerEvents: none】はみ出した描画が上下の要素の当たり判定を食わないようにする。
          錘のタップはこのSVGの外にある透明なボタンが持つので、SVG側は当たり判定を持たない。 */}
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        style={{ display: "block", width: "100%", height: "auto", overflow: "visible", pointerEvents: "none" }}
        aria-hidden="true"
      >
        <defs>
          {/* ズレの帯。色は**先端(現在位置)からの絶対弧長**で決め、帯の長さでは割らない。
              ストップの位置は弧を弦へ射影して求める(軸は根元→先端の弦)。
              【stop-opacity は1つも書かない】根元が透けると下地が出る。不透明度は常に1。 */}
          <linearGradient
            id={barGradId} gradientUnits="userSpaceOnUse"
            x1={sx.toFixed(2)} y1={sy.toFixed(2)} x2={mx.toFixed(2)} y2={my.toFixed(2)}
          >
            {barStops.map((st, i) => {
              const c = ringRampRGB([r, g, b], st.s);
              return <stop key={i} offset={st.offset.toFixed(5)} stopColor={`rgb(${c[0]},${c[1]},${c[2]})`} />;
            })}
          </linearGradient>
          {/* 到達の走り(左弧・右弧)。座標もストップもrAFが書き換える。ここでも不透明度は常に1。 */}
          {runGradIds.map((gid, k) => (
            <linearGradient
              key={gid} id={gid} gradientUnits="userSpaceOnUse"
              ref={(el) => { runGradRefs.current[k] = el; }}
              x1={sx.toFixed(2)} y1={sy.toFixed(2)} x2={sx.toFixed(2)} y2={sy.toFixed(2)}
            >
              {Array.from({ length: RING_RAMP_STOPS }).map((_, i) => (
                <stop
                  key={i} ref={(el) => { runStopRefs.current[k][i] = el; }}
                  offset={(i / (RING_RAMP_STOPS - 1)).toFixed(5)} stopColor={color}
                />
              ))}
            </linearGradient>
          ))}
          {/* 外周の光(F-47)。減衰・傾斜・粒の3種のマスクを作る。すべて静的。
              光の最大は環のトラックの外縁(RING_GLOW_EDGE_R)。立ち上がりはトラックの下に隠れる。 */}
          <radialGradient
            id={glowFalloffId} gradientUnits="userSpaceOnUse" cx={CX} cy={CY} r={RING_GLOW_R_MAX}
          >
            {RING_GLOW_FALLOFF_STOPS.map((st, i) => (
              <stop key={i} offset={st.offset.toFixed(4)} stopColor="#fff" stopOpacity={st.value.toFixed(4)} />
            ))}
          </radialGradient>
          <mask id={`${glowFalloffId}-m`}>
            <rect
              x={RING_GLOW_RECT_MIN} y={RING_GLOW_RECT_MIN}
              width={RING_GLOW_RECT_SIZE} height={RING_GLOW_RECT_SIZE}
              fill={`url(#${glowFalloffId})`}
            />
          </mask>
          {/* 外へ行くほど粒に置き換えるための傾斜と、その逆(内側の滑らかな側) */}
          <radialGradient
            id={glowGrainyId} gradientUnits="userSpaceOnUse" cx={CX} cy={CY} r={RING_GLOW_R_MAX}
          >
            {RING_GLOW_GRAINY_STOPS.map((st, i) => (
              <stop key={i} offset={st.offset.toFixed(4)} stopColor="#fff" stopOpacity={st.value.toFixed(4)} />
            ))}
          </radialGradient>
          <mask id={`${glowGrainyId}-m`}>
            <rect
              x={RING_GLOW_RECT_MIN} y={RING_GLOW_RECT_MIN}
              width={RING_GLOW_RECT_SIZE} height={RING_GLOW_RECT_SIZE}
              fill={`url(#${glowGrainyId})`}
            />
          </mask>
          <radialGradient
            id={glowSmoothId} gradientUnits="userSpaceOnUse" cx={CX} cy={CY} r={RING_GLOW_R_MAX}
          >
            {RING_GLOW_SMOOTH_STOPS.map((st, i) => (
              <stop key={i} offset={st.offset.toFixed(4)} stopColor="#fff" stopOpacity={st.value.toFixed(4)} />
            ))}
          </radialGradient>
          <mask id={`${glowSmoothId}-m`}>
            <rect
              x={RING_GLOW_RECT_MIN} y={RING_GLOW_RECT_MIN}
              width={RING_GLOW_RECT_SIZE} height={RING_GLOW_RECT_SIZE}
              fill={`url(#${glowSmoothId})`}
            />
          </mask>
          {/* 粒そのもの。マスクとして使うので輝度がそのまま光の濃淡になる。
              feComponentTransfer で明るさの幅を grainLo〜grainHi に収め、
              **alpha は slope 0 / intercept 1 で不透明に固定する**(穴を空けない)。 */}
          <filter id={glowNoiseId} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise" baseFrequency="0.9" numOctaves="2"
              seed={RING_GLOW_SEED} stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncR type="linear" slope={RING_GLOW_GRAIN_HI - RING_GLOW_GRAIN_LO} intercept={RING_GLOW_GRAIN_LO} />
              <feFuncG type="linear" slope={RING_GLOW_GRAIN_HI - RING_GLOW_GRAIN_LO} intercept={RING_GLOW_GRAIN_LO} />
              <feFuncB type="linear" slope={RING_GLOW_GRAIN_HI - RING_GLOW_GRAIN_LO} intercept={RING_GLOW_GRAIN_LO} />
              <feFuncA type="linear" slope="0" intercept="1" />
            </feComponentTransfer>
          </filter>
          <mask id={`${glowNoiseId}-m`}>
            <rect
              x={RING_GLOW_RECT_MIN} y={RING_GLOW_RECT_MIN}
              width={RING_GLOW_RECT_SIZE} height={RING_GLOW_RECT_SIZE}
              filter={`url(#${glowNoiseId})`}
            />
          </mask>
        </defs>
        {/* 外周の光。帯より奥に敷く。**mix-blend-mode は一切使わず、マスクの入れ子
            (=掛け算)だけ**で作る(ブレンドが効かない環境で全面が染まった経緯がある)。
            いちばん外の減衰マスクが常に掛かるので、環の外側の届く範囲を超えて漏れない。
            明るさは rAF がこの <g> の opacity だけを書き換える。 */}
        <g ref={glowGroupRef} mask={`url(#${glowFalloffId}-m)`} opacity="0">
          {/* 内側 = 減衰 × (1-傾斜) … 滑らかな光 */}
          <g mask={`url(#${glowSmoothId}-m)`}>
            <rect
              ref={(el) => { glowFillRefs.current[0] = el; }}
              x={RING_GLOW_RECT_MIN} y={RING_GLOW_RECT_MIN}
              width={RING_GLOW_RECT_SIZE} height={RING_GLOW_RECT_SIZE} fill={glowColor}
            />
          </g>
          {/* 外側 = 減衰 × 傾斜 × 粒。粒の寄与は実測で 1/255 未満(冒頭の解説を見ること) */}
          <g mask={`url(#${glowGrainyId}-m)`}>
            <g mask={`url(#${glowNoiseId}-m)`}>
              <rect
                ref={(el) => { glowFillRefs.current[1] = el; }}
                x={RING_GLOW_RECT_MIN} y={RING_GLOW_RECT_MIN}
                width={RING_GLOW_RECT_SIZE} height={RING_GLOW_RECT_SIZE} fill={glowColor}
              />
            </g>
          </g>
        </g>
        {/* 【N-4a で撤去】環のトラック(常に全周の円)。本人指示「チューナーの円環の枠は要らない」。
            DESIGN-SYSTEM §6.0「説明を消して形に語らせる」: 枠は「帯がここを通ります」という
            予告=説明であって、データではない。帯は必ず12時から伸びるので**帯そのものが軌道を示す**。
            半径 R / 線幅 SW は帯・走り・光・振り子・拍の点が座標の基準として参照し続けるため、
            定数は残して**描画だけ**を消している(定数を消すとそれらの位置がすべて壊れる)。 */}
        {/* 【削除済み】12時=0¢の基準マーカー(紺の縦線)。本人指示で撤去した。
            帯は必ず12時から伸びるので、**帯の根元そのものが0¢の位置**を示す。
            音が入っていないときは指すものが無いので、印だけを残す理由も無い。
            演奏中サーフェスは要素を足すより減らすほうが効く(DESIGN-SYSTEM §6.1)。 */}
        {/* 到達の走り: 12時から両サイドへ同時に走り、6時で出会う(全周)。
            DESIGN-SYSTEM §6.1 の「上弧=ピッチ / 下弧=拍」は、**到達したときだけ**
            全周を使う許可を本人から得ている(2026-08-03)。到達していない間は上弧だけ。
            【linecap は butt】丸端は終点から SW/2=7 外へ張り出して0¢の基準線を越え、
            張り出した半円が最終色でベタ塗りされて「別の丸いものが付いている」ように見えた。 */}
        {runGradIds.map((gid, k) => (
          <path
            key={gid} ref={(el) => { runPathRefs.current[k] = el; }}
            d="" fill="none" stroke={`url(#${gid})`} strokeWidth={SW} strokeLinecap="butt"
          />
        ))}
        {sounding && arcD && (
          /* ズレの帯: 0¢から現在位置まで伸びる。長さとグラデーションでズレの大きさを示す。
             先端に点は置かない(先端はグラデーションの終わりであって、そこで何かが始まらない)。 */
          <path d={arcD} fill="none" stroke={`url(#${barGradId})`} strokeWidth={SW} strokeLinecap="butt" />
        )}
        {/* 【N-4b で撤去】拍の要素(下半円の点・上半円の錘と輪・錘のタップ)。
            正典 design/north-star-measure.html は、拍を**環の外・下**の浅い弧と●列で描く。
            環はピッチ専用になり、帯と拍が場所を争う関係そのものが無くなった。
            拍の描画は MetroPendulum が持つ。開始/停止は画面のどこをタップしてもよい(A-1)。 */}
      </svg>
      {/* 環の内側: 音名(実音)とセント差。数値は「合間に読む」ための補助で、主役は環そのもの。 */}
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", pointerEvents: "none",
      }}>
        <div style={{
          display: "flex", alignItems: "baseline", justifyContent: "center",
          width: "100%", height: noteBoxH,
          lineHeight: NOTE_LINE_H, fontFamily: "var(--font-serif)",
          color: sounding ? "var(--c-ink)" : "var(--c-disabled)",
        }}>
          {/* 音名の文字。横幅は scaleX で明示指定する(F-77 で復活。書体既定のままにしない) */}
          <span style={{
            fontSize: noteFs, display: "inline-block",
            transform: `scaleX(${NOTE_SCALE_X})`, transformOrigin: "center bottom",
            margin: `0 ${NOTE_SCALE_PAD_EM}em`,
          }}>
            {noteLetter}
          </span>
          {/* 臨時記号。文字として組み、本体より明確に小さくする(scaleXは掛けない) */}
          {accidental && (
            <span style={{ fontSize: noteFs * NOTE_ACC_RATIO }}>{accidental}</span>
          )}
          {/* オクターブ数字は正典 .note .oct の実寸(44px)。色も .oct と同じ薄い紺。 */}
          <span style={{ fontSize: NOTE_OCT_PX, color: "var(--c-accent-dim)", marginLeft: 3 }}>
            {sounding ? note.octave : ""}
          </span>
        </div>
        {/* セント値。色は環と同じ pitchBarColorRGB() の連続補間で、閾値のベタ判定は混ぜない
            (以前メトロノーム表示中だけ ac<=3 / <=10 の3段階で塗り分けており、環の判定と
            食い違っていた)。「合った」の判定はこの画面では RING_IN_TUNE_CENTS だけを使い、
            到達したときは環と同じ ficus-breathe(透明度のみ)で静かに返す。 */}
        {/* 音が入っていないときはセント値も文字を出さない。ただし箱(高さ--fs-md+--sp-1 =
            文字がある時の行の高さ・幅は環の内寸いっぱい)は残し、音の有無で環の内側の寸法が
            変わらないようにする(DESIGN-SYSTEM §6.1.5)。 */}
        {/* 【N-4c】サイズと間隔は正典 .cents の実寸(21px / margin-top 10px)。 */}
        <div className={`sans${inTune ? " ficus-breathe" : ""}`} style={{
          marginTop: NOTE_CENTS_GAP_PX, width: "100%", height: NOTE_CENTS_PX + 4,
          textAlign: "center",
          fontFamily: "var(--font-num)", fontSize: NOTE_CENTS_PX, fontWeight: 700,
          letterSpacing: "0.02em", color: sounding ? color : "var(--c-ink-3)",
          animation: inTune ? "ficus-breathe 1.9s ease-in-out infinite" : undefined,
        }}>
          {sounding ? `${centsOffset > 0 ? "+" : ""}${centsOffset}¢` : ""}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 振り子と拍の●(N-4b)。**環の外・下**に置く。
// 正典 design/north-star-measure.html「メトロノーム中」の .pend そのもの:
//   1行目 = 浅い弧のガイド1本 + 往復する点1つ(端が拍の瞬間・小節頭で点が膨らむ)
//   2行目 = 拍の● (画面中央固定) と、その左に拍子表示
// 開始/停止はこの部品が持たない。計測タブの背面レイヤ(画面のどこでも)が持つ(A-1)。
//
// getBeatPhase: メトロノームの位相(拍単位の連続値)を返す関数。null を返す=停止中。
//   位相の計算は MeasureView の getMetroPhase(クリックと同じ音声時計)をそのまま使う。
// getBeatDur:   1拍(片道1振り)の秒数。停止後の戻り(F-51)の角振動数・時定数をここから引く。
// beatsPerMeasure / accentOn: ●の数と、小節頭を強調してよいか。
// settleOnStop: 停止時にゆっくり中央へ戻すか。false なら即座に中央へ。
// ============================================================
// onOpenSheet: 【F-91】拍子表示・拍の●をタップしたときに開くもの(テンポ拍子シート)。
//   **渡されなければ従来どおり何も押せない**(この部品は元来「読む物」なので、
//   既定を「押せる」にすると、次に増える呼び出し先へ黙って当たり判定が漏れる。
//   F-72 罠1「共有部品の変更が担当外の画面へ黙って漏れた」と同じ形を作らないため)。
function MetroPendulum({ getBeatPhase, getBeatDur, beatsPerMeasure = 0, accentOn = false, sig = "4/4", settleOnStop = true, onOpenSheet = null }) {
  const dotRef = useRef(null);
  const beatDotRefs = useRef([]);
  // 停止後の戻り(F-51)。rAFループの中だけで進む状態なので ref で持つ。
  //   lastDegRef  最後に「動いている状態で」描いた角度 = 止まった瞬間の角度
  //   settleRef   null=まだ入っていない / {from,dur,t0} = 減衰中 / {done:true} = 戻りきった
  const lastDegRef = useRef(0);
  const settleRef = useRef(null);
  // 毎レンダー最新値をrefへ。ループの依存に足すと、録音の開始/停止でrAFが張り直しになる。
  const settleOnStopRef = useRef(settleOnStop);
  settleOnStopRef.current = settleOnStop;
  const getBeatDurRef = useRef(getBeatDur);
  getBeatDurRef.current = getBeatDur;
  const n = beatsPerMeasure > 0 ? beatsPerMeasure : 0;
  const rowW = metroBeatRowW(n);
  // 【F-95a】●列の画面上の実寸(CSS px)。viewBox は rowW(正典の単位)のままで、
  // svg の幅だけをこれにする。拍子表示の位置もこの実寸から決める。
  const rowWCss = rowW * METRO_SCALE;

  useEffect(() => {
    if (!getBeatPhase) return undefined;
    // 動きを減らす設定。属性をrAFで直接書き換えるぶんはCSSの
    // @media (prefers-reduced-motion) が効かないので、ここで自分で見る。
    // 【止めるのは装飾だけ】拍の演出=ふくらみ(装飾)は止め、点の移動と●の切り替え
    // (機能=拍がどこかを伝える情報そのもの)は残す。DESIGN-SYSTEM §6.1「減速設定」の規則。
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf;
    const loop = () => {
      const phase = getBeatPhase();
      const running = phase !== null;
      // 角度。動いている間は位相そのもの。止まっている間は「止まった瞬間の角度から
      // 減衰しながら中央へ戻る」(F-51)。角度の写像は環の時代から変えていない。
      let pendDeg;
      if (running) {
        settleRef.current = null;
        pendDeg = ringPendDeg(phase);
        lastDegRef.current = pendDeg;
      } else {
        if (settleRef.current === null) {
          const from = lastDegRef.current;
          const dur = getBeatDurRef.current ? getBeatDurRef.current() : 0;
          settleRef.current = (reduceMotion.matches || !settleOnStopRef.current || from === 0 || !(dur > 0))
            ? { done: true }
            : { from, dur, t0: performance.now() };
        }
        const s = settleRef.current;
        if (s.done) pendDeg = 0;
        else {
          const el = (performance.now() - s.t0) / 1000;
          if (ringPendSettleDone(s.from, s.dur, el)) { s.done = true; pendDeg = 0; }
          else pendDeg = ringPendSettleDeg(s.from, s.dur, el);
        }
      }
      const [px, py] = metroArcPoint(metroPendT(pendDeg));
      // 拍の演出は毎拍・両端で出す。膨らみも毎拍(【F-100 2026/08/17 本人指示】。強弱は e の係数が持つ)。
      const e = reduceMotion.matches ? 0 : ringBeatEmphasis(phase, beatsPerMeasure, accentOn);
      const isHead = ringBeatIsHead(phase, beatsPerMeasure, accentOn);
      const dot = dotRef.current;
      if (dot) {
        dot.setAttribute("cx", px.toFixed(2));
        dot.setAttribute("cy", py.toFixed(2));
        dot.setAttribute("r", metroDotR(isHead, e).toFixed(2));
        dot.setAttribute("fill-opacity", running ? "1" : "0.35");
      }
      const cur = ringBeatIndex(phase, beatsPerMeasure);
      for (let i = 0; i < beatDotRefs.current.length; i++) {
        const d = beatDotRefs.current[i];
        if (!d) continue;
        const isCur = cur === i;
        d.setAttribute("r", metroBeatDotR(isCur).toFixed(2));
        d.style.fill = isCur ? "var(--c-accent)" : "var(--c-line-strong)";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getBeatPhase, beatsPerMeasure, accentOn]);

  return (
    /* 【pointerEvents: none】振り子も拍の●も**読む物**で、押す物を持たない。
       開始/停止は画面のどこでも効く(A-1)ので、ここが当たり判定を持つと
       いちばん押したい場所(振り子の上)でタップが死ぬ。実測で確認して直した。 */
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: `calc(var(--sp-2) * ${METRO_SCALE})`, pointerEvents: "none" }}>
      {/* 1行目: ガイドの弧 + 往復する点。
          【F-95a】viewBox は正典の 150×26 のまま。幅・高さだけを ×METRO_SCALE で描くので
          viewBox 1単位 = METRO_SCALE CSS px になる。弧の座標も点の半径も1つも書き換えていない。
          【overflow: visible】小節頭で点が膨らむと弧の箱から出るため。
          レイアウトには影響しない(はみ出すのは描画だけ。§6.1.5)。
          【F-95b で実際に効き始めた】点は cy=8 / 最大 r=5×1.8=9 なので、箱の上辺(y=0)を
          1単位はみ出す(実測 1.20 CSS px)。1.4 の頃は r=7 で箱の中に収まっていたので
          この宣言は飾りだったが、**今は hidden にすると膨らみの頭が切れる**。検査で固定した。 */}
      <svg
        width={METRO_ARC_W_CSS} height={METRO_ARC_H_CSS} viewBox={`0 0 ${METRO_ARC_W} ${METRO_ARC_H}`}
        style={{ display: "block", overflow: "visible", pointerEvents: "none" }}
        aria-hidden="true"
      >
        <path
          d={`M${METRO_ARC_P0[0]} ${METRO_ARC_P0[1]} Q${METRO_ARC_C[0]} ${METRO_ARC_C[1]} ${METRO_ARC_P2[0]} ${METRO_ARC_P2[1]}`}
          fill="none" strokeWidth={METRO_ARC_SW} strokeLinecap="round" style={{ stroke: "var(--c-line)" }}
        />
        <circle
          ref={dotRef} cx={METRO_ARC_P0[0]} cy={METRO_ARC_P0[1]} r={METRO_DOT_R}
          fillOpacity="0.35" style={{ fill: "var(--c-accent)" }}
        />
      </svg>
      {/* 2行目: 拍の●は**画面中央固定**(本人指示)。拍子表示はその左。
          拍子表示を絶対配置にして流れから外すので、●の列は拍子の桁数に関係なく
          常に行の中央=画面の中央に来る。行の高さは固定で、●が膨らんでも動かない。 */}
      {/* 【F-91】本人指示(実機 2026/08/15)「4/4などの拍子や、拍を表すをタップしても
          テンポ拍子メニューがでるルートを追加」。テンポ数値(♩=n)からの入口はそのまま残す。
          【メトロノームの開始/停止と喧嘩させない】計測タブは A-1 で**画面のどこをタップしても
          開始/停止**する背面レイヤを持ち、F-74 でその範囲を上部設定行の下〜テンポ行の下端に
          限定してある。ここに当たり判定を置くぶんだけ開始/停止の面積が減るので、
          **拍子の文字と●の列の上だけ**に限る(行の幅いっぱいには広げない)。
          【行の高さは動かさない】§6.1.5「●が膨らんでも行は伸びない」を守るため、
          当たり判定は position:absolute で流れの外に置き、行の高さは METRO_BEAT_ROW_H のまま。
          §5 の 44pt は高さ・最小幅で満たす(見た目の文字・●の大きさは1pxも変えない)。 */}
      <div style={{ position: "relative", width: "100%", height: METRO_BEAT_ROW_H_CSS, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* 拍子表示。押せるときだけ <button> になる。**文字の右端の位置は同じ式のまま**
            (箱を右端で揃え、中身を右寄せにするので、最小幅で広がるぶんは左へ伸びるだけ)。 */}
        {onOpenSheet ? (
          <button
            type="button" onClick={onOpenSheet}
            aria-label="テンポと拍子" className="sans no-select"
            style={{
              position: "absolute", right: `calc(50% + ${rowWCss / 2}px + var(--sp-3) * ${METRO_SCALE})`,
              top: "50%", transform: "translateY(-50%)",
              height: "var(--tap-min)", minWidth: "var(--tap-min)",
              display: "flex", alignItems: "center", justifyContent: "flex-end",
              background: "none", border: "none", padding: 0, cursor: "pointer",
              pointerEvents: "auto",
            }}
          >
            <span style={{ fontFamily: "var(--font-num)", fontSize: METRO_TSIG_FS_CSS, color: "var(--c-ink-3)", lineHeight: 1 }}>{sig}</span>
          </button>
        ) : (
          <span
            className="sans no-select"
            style={{
              position: "absolute", right: `calc(50% + ${rowWCss / 2}px + var(--sp-3) * ${METRO_SCALE})`,
              /* 【N-4c】正典 .tsig の実寸 12px。以前は §6.1「演奏中サーフェスで12px禁止」に
                 従って 15px にしていたが、見た目はモックが唯一の正典(§6.0)。
                 【F-95a】その 12px を基準値として ×METRO_SCALE した 14.4px で描く。 */
              fontFamily: "var(--font-num)", fontSize: METRO_TSIG_FS_CSS, color: "var(--c-ink-3)", lineHeight: 1,
            }}
          >
            {sig}
          </span>
        )}
        {/* 拍の●列。押せるときは列と同じ幅・44pt高の透明な箱を重ねる。
            **●が1つも無いとき(n=0)は箱ごと出さない**。出すと「押しても何も起きない」ではなく
            「何も無い所が押せる」になり、開始/停止の面積だけが黙って減る。 */}
        {onOpenSheet && n > 0 && (
          <button
            type="button" onClick={onOpenSheet}
            aria-label="テンポと拍子" className="no-select"
            style={{
              position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
              /* 幅は●の列と同じ。列が 44 に満たない拍子(1/4 など)でも §5 を割らないよう
                 minWidth で下限を持たせる(44 の綴りは --tap-min の1箇所だけに置く)。 */
              width: rowWCss, minWidth: "var(--tap-min)", height: "var(--tap-min)",
              background: "none", border: "none", padding: 0, cursor: "pointer",
              pointerEvents: "auto",
            }}
          />
        )}
        <svg
          width={rowWCss} height={METRO_BEAT_ROW_H_CSS} viewBox={`0 0 ${rowW} ${METRO_BEAT_ROW_H}`}
          style={{ display: "block", overflow: "visible", pointerEvents: "none" }}
          aria-hidden="true"
        >
          {Array.from({ length: n }).map((_, i) => (
            <circle
              key={i} ref={(el) => { beatDotRefs.current[i] = el; }}
              cx={metroBeatDotX(i, n)} cy={METRO_BEAT_ROW_H / 2} r={METRO_BEAT_DOT_PX / 2}
              style={{ fill: "var(--c-line-strong)" }}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

// ============================================================
// 計測ビュー(単音・フレーズ統合)
//
// 単音/フレーズはモードとして分けず、1つの録音フローで扱う。
// リアルタイム表示(音高・スペクトル・倍音構成等)は録音中/停止後を問わず常時表示し、
// 「単音」の結果はこの常時表示がそのまま最終評価になる(停止後も最後の値が残る)。
// 「フレーズ」かどうかは録音停止後(または録音中)にnoteEvents(検出ノート数)から
// 事後判定し、2音以上検出された場合のみ下部にタイムライン(旧フレーズモード相当)を追加表示する。
// ============================================================
function MeasureView(props) {
  const {
    isRecording, toggleRecording, note, centsOffset,
    harmonicLevels, showIdeal, setShowIdeal,
    selectedIdeal, volumeDb, centroidHz, hnrDb, saxType, setSaxType, temperature, setTemperature,
    tuningHz, setTuningHz, matchedFingering,
    idealProfiles, selectedIdealId, setSelectedIdealId, deleteIdealProfile, NUM_HARMONICS,
    reeds, selectedReedId, setSelectedReedId,
    performers, selectedPerformer, setSelectedPerformer, setPerformers,
    noiseGateDb, setNoiseGateDb, micProcessingWarning,
    scheduledClicksRef, metroActiveRef, metroBarPerfTimesRef, requestWakeLock, releaseWakeLock,
    phraseFrames, phraseNoteEvents, liveFrames,
    pendingSession, registerPendingSession, discardPendingSession,
    // 【C-1】アップロード関連(handleUploadFile / isAnalyzingUpload / uploadProgress /
    // lastUploadedSession / uploadNeedsTap …)はデータタブへ移設したのでもう受け取らない。
    // 完了通知の「目安に設定」が使っていた sessions / promoteSessionToIdeal も同じ理由で外した。
  } = props;

  const selectedReed = reeds?.find((r) => r.id === selectedReedId) || null;
  // 理想値は音(運指)ごとに持つため、今演奏している音に対応する理想値を都度引く
  const currentNoteIdeal = getNoteIdeal(selectedIdeal, matchedFingering?.semitoneIndex);

  // リード選択は箱→個体の二段階にする(枚数が増えるとフラットな一覧では選びにくいため)。
  const reedGroups = groupReeds(reeds || []);
  const [selectedBoxKey, setSelectedBoxKey] = useState(() => (selectedReed ? reedGroupKey(selectedReed) : null));
  // リードタブの「測定へ」等、外部からselectedReedIdが変わった場合は箱の選択も追従させる。
  // ただし本画面で箱を選び直してreedIdをnullにクリアした場合は上書きしない。
  useEffect(() => {
    if (!selectedReedId) return;
    const r = (reeds || []).find((x) => x.id === selectedReedId) || null;
    const key = r ? reedGroupKey(r) : null;
    if (key) setSelectedBoxKey((prev) => (prev === key ? prev : key));
  }, [selectedReedId, reeds]);
  const selectedBoxGroup = reedGroups.find((g) => g.key === selectedBoxKey) || null;

  // 【差し戻し①】リード枠の選択肢。**綴りをここ1箇所に集める。**
  // 上部設定行は「値をテキストで描き、透明な <select> を重ねる」形にしたので、
  // 見えているテキストと <option> の**両方**がこの配列から作られる。
  // 2箇所に書くと必ず片方が腐る(見えている値と選択肢がずれる、という最悪の壊れ方をする)。
  // 先頭は必ず「未選択のときに見せるラベル」にしておくこと(描画側が [0] を既定に使う)。
  // 【N-4a】箱の表記「Vandoren V16 3.0」→「V16-3」。短縮規則は shortBoxLabel を参照。
  const reedBoxOptions = [
    { value: "", label: "リードを選択" },
    ...reedGroups.map((g) => ({ value: g.key, label: shortBoxLabel(g.brand, g.strength, reedGroups.map((x) => x.brand)) })),
  ];
  const reedMemberOptions = [
    { value: "", label: selectedBoxGroup ? "#" : "—" },
    ...(selectedBoxGroup?.members || []).map((r) => ({ value: r.id, label: `#${reedPosition(r, reeds) ?? "?"}` })),
  ];

  // メーター内の基準ピッチ・楽器種別は、タップでスクロールピッカーを開いて選ぶ(下段の設定より
  // 優先的に触る値のため、演奏姿勢のまま指の届く位置に置く)。どちらか一方だけ開く。
  const [openPicker, setOpenPicker] = useState(null); // null | "tuning" | "sax"
  const [detailOpen, setDetailOpen] = useState(false); // 倍音構成・スペクトル・補助指標をまとめた詳細カードの開閉。デフォルトは閉じておく
  // 計測タブを画面いっぱいの縦フレックスにして「上=設定 / 中央=メーター / 下=録音ボタン」に配置する。
  const measureRootRef = useRef(null);
  const measureMinH = useFillViewportHeight(measureRootRef);
  const TUNING_HZ_OPTIONS = [438, 439, 440, 441, 442, 443, 444];
  const SAX_TYPE_OPTIONS = Object.keys(SAX_PRESETS);

  // --- メトロノーム(設定は永続化。ON/OFFはタブ滞在中のみ=タブを離れるとアンマウントで停止) ---
  const [metroTempo, setMetroTempo] = usePersistedState("metroTempo", 120);
  const [metroSig, setMetroSig] = usePersistedState("metroSig", "4/4");
  const [metroSubdiv, setMetroSubdiv] = usePersistedState("metroSubdiv", 1);
  const [metroAccent, setMetroAccent] = usePersistedState("metroAccent", true); // デフォルトON(OFFにしないと拍子が聴き分けられないため)
  // 5/8・7/8のグループ分け(例:[3,2]/[2,2,3])。ユーザーが選べる。他の拍子はnull(自動)。
  const [metroGrouping, setMetroGrouping] = usePersistedState("metroGrouping", null);
  const [metronomeOn, setMetronomeOn] = useState(false); // 実際に音が鳴っている(スケジューラ動作中)か
  // 開閉状態は永続化する。計測タブは他タブへ移るとアンマウントされるため、useStateだと
  // 戻ったときにメトロノームが閉じてしまう(ユーザー報告)。開いたままなら戻っても開いたまま。
  const [showMetroPanel, setShowMetroPanel] = usePersistedState("showMetroPanel", false); // 開いただけでは音は鳴らない
  // 【N-4b】テンポ・拍子・分割・拍グループ・小節アクセントは、下から出るシート1枚にまとめた。
  // 以前は環と入れ替わる2種類の設定パネル(metroPanel = "sig" | "subdiv")で、開くと環が消えていた。
  // 正典は「環と共存」なので、設定は環の上に**重ねる**シートにする。
  const [tempoSheetOpen, setTempoSheetOpen] = useState(false);
  // 【F-90】テンポ拍子シートを下スワイプで閉じる。フックは条件付きで呼べないので、
  // シートが出ていない間も常に呼ぶ(ref が付く先が無いだけで何も起きない)。
  const tempoSheetDismiss = useSheetDismiss(() => setTempoSheetOpen(false));
  const [tempoEditing, setTempoEditing] = useState(false); // テンポ数値タップで直接入力モード
  const tempoInputRef = useRef(null);
  // autoFocus属性はモバイルブラウザ(ユーザージェスチャー外の文脈等)で確実に効かないことがあるため、
  // マウント時に明示的にfocus+全選択する(数値をすぐ上書き入力できるように)。
  useEffect(() => {
    if (tempoEditing) { tempoInputRef.current?.focus(); tempoInputRef.current?.select(); }
  }, [tempoEditing]);

  // 拍子情報(分子・分母)を都度パースして使う。X/8拍子(分母8)かつ分子が3の倍数
  // (3/8・6/8・9/8・12/8)は複合拍子(1拍=8分音符3つ)として扱う。
  const { num: metroSigNum, den: metroSigDen } = parseMetroSig(metroSig);
  const metroCompoundX8 = metroSigDen === 8 && metroSigNum % 3 === 0;
  // X/8拍子の「1拍の分割」は2択: 1=主拍のみ / 2=8分音符で拍を埋める(複合なら1拍に8分3つ=実質3連)。
  // 表示アイコンは、埋める側を複合拍子では8分音符3つ、非複合(5/8,7/8)では2つで見せる。
  const metroSubdivOptions = metroSigDen === 8
    ? [{ value: 1, icon: 1 }, { value: 2, icon: metroCompoundX8 ? 3 : 2 }]
    : METRO_SUBDIVS.map((s) => ({ ...s, icon: s.value }));
  // 1小節の拍数(=振り子1振りぶんの単位がいくつ入るか)。環の下弧の拍マーカーが
  // 小節頭を強調するために使う「読み取り専用の導出値」で、発音側のロジックには一切触れない。
  // X/4等は分子そのもの。X/8はスケジューラと同じグループ分け(metroBeatGroups)の個数=拍数。
  const metroBeatsPerMeasure = metroSigDen === 8
    ? ((Array.isArray(metroGrouping) && metroGrouping.reduce((a, b) => a + b, 0) === metroSigNum)
        ? metroGrouping.length : metroBeatGroups(metroSigNum).length)
    : metroSigNum;
  // X/8では分割は1か2のみ。それ以外(16分等)が選ばれていたら主拍のみ(1)に戻す。
  useEffect(() => {
    if (metroSigDen === 8 && metroSubdiv !== 1 && metroSubdiv !== 2) setMetroSubdiv(1);
  }, [metroSigDen, metroSubdiv, setMetroSubdiv]);

  // スケジューラは長寿命クロージャのため、最新の設定値はrefから読む
  const metroCtxRef = useRef(null);
  const metroTimerRef = useRef(null);
  const metroNextTimeRef = useRef(0);
  const metroTickIndexRef = useRef(0);
  const metroGBeatRef = useRef(0); // 通算拍数。振り子の位相が小節をまたいでも連続するように増え続ける
  const metroAnchorRef = useRef({ time: 0, gBeat: 0, mBeat: 0 }); // 直近の拍(音声時刻・通算拍・小節内拍)
  // 【F-52】音声時計が止まっていないかを次の START で確かめるための基準点 { audio, wall }。
  // 「中断が起きうる境目」= 非表示になった時 / 停止した時 に控える。使ったら捨てる(null)。
  const metroClockMarkRef = useRef(null);
  const markMetroClock = useCallback(() => {
    const ctx = metroCtxRef.current;
    if (ctx) metroClockMarkRef.current = { audio: ctx.currentTime, wall: performance.now() };
  }, []);
  const metroOnRef = useRef(false);
  const metroTempoRef = useRef(clampMetroTempo(metroTempo));
  const metroSigRef = useRef(metroSig);
  const metroSubdivRef = useRef(metroSubdiv);
  const metroAccentRef = useRef(metroAccent);
  const metroGroupingRef = useRef(metroGrouping);
  // START呼び出しごとに増える世代番号。古いSTART呼び出し(resume()待ち中)がその間に
  // 発生したSTOPや別のSTARTより後から状態を書き換えてしまう競合を防ぐ(詳細は下記)。
  const metroGenRef = useRef(0);
  useEffect(() => { metroTempoRef.current = clampMetroTempo(metroTempo); }, [metroTempo]);
  useEffect(() => { metroSigRef.current = metroSig; }, [metroSig]);
  useEffect(() => { metroSubdivRef.current = metroSubdiv; }, [metroSubdiv]);
  useEffect(() => { metroAccentRef.current = metroAccent; }, [metroAccent]);
  useEffect(() => { metroGroupingRef.current = metroGrouping; }, [metroGrouping]);
  // 拍子に応じてグループ分けを整える。5/8・7/8以外はnull(自動)、5/8・7/8は現在の選択が
  // 合計と合わなければ既定(5/8→[3,2] / 7/8→[3,2,2])に戻す(有効な選択は保持)。
  useEffect(() => {
    const { num, den } = parseMetroSig(metroSig);
    const needs = den === 8 && (num === 5 || num === 7);
    if (!needs) { if (metroGrouping !== null) setMetroGrouping(null); return; }
    const sum = Array.isArray(metroGrouping) ? metroGrouping.reduce((a, b) => a + b, 0) : 0;
    if (sum !== num) setMetroGrouping(num === 5 ? [3, 2] : [3, 2, 2]);
  }, [metroSig, metroGrouping, setMetroGrouping]);

  // 先読みスケジューラ本体。25ms毎に呼ばれ、120ms先までのクリックを音声時計に予約する。
  //
  // 拍の強弱(kind)の決め方:
  //   ・小節の先頭(eighthIdx===0)は"accent"(アクセント有効時。最強)
  //   ・複合拍子(6/8等)では、8分音符3つごとの先頭(eighthIdx%3===0)を"beat"(中強)、
  //     その中の2・3番目を"sub"(弱)にする → 1拍(付点四分相当)の中に3つの音が
  //     強・弱・弱で鳴る、実際の複合拍子の感じ方に合わせた並びになる
  //   ・単純拍子(4/4等)では、先頭以外の拍はすべて"beat"(均等)、"1拍の分割"による
  //     細分だけが"sub"になる(従来通り)
  const metroSchedulerTick = useCallback(() => {
    const ctx = metroCtxRef.current;
    if (!ctx || !metroOnRef.current) return;
    const LOOKAHEAD = 0.12;
    let guard = 0; // 万一ステップ幅が異常値になっても無限ループでタブが固まらないようにする安全弁
    while (metroNextTimeRef.current < ctx.currentTime + LOOKAHEAD) {
      if (++guard > 512) { metroNextTimeRef.current = ctx.currentTime + LOOKAHEAD; break; }
      const t = metroNextTimeRef.current;
      const { num, den } = parseMetroSig(metroSigRef.current);
      const subdiv = metroSubdivRef.current || 1;
      const isX8 = den === 8;
      // 【テンポの基準】X/8拍子はすべて、テンポ数値を「8分音符3つ分(付点四分)の速さ」として扱う。
      // よって8分音符1つ=その1/3の長さ。複合(6/8等)は1拍=8分3つなので1拍がちょうどテンポ。
      // 非複合の5/8・7/8も同じ8分の長さで、3グループの拍=60/tempo秒、2グループの拍=その2/3秒に
      // なる(8分音符は全グループ均等)。X/4は分母の四分音符1つがテンポの1拍(従来通り)。
      const eighthDur = isX8 ? (60 / metroTempoRef.current) / 3 : (60 / metroTempoRef.current);
      // X/8はグリッドを常に8分音符に固定(perMeasure=num・subdivで割らない)。subdivは
      // 「主拍のみ(1)か、8分で拍を埋めるか(>=2)」の切替。振り子は1拍(グループ)で1振りにする。
      let perMeasure, stepDiv, idx, kind, isBeatAnchor, beatDur;
      if (isX8) {
        perMeasure = num;
        stepDiv = 1;
        idx = metroTickIndexRef.current % perMeasure;
        const gr = metroGroupingRef.current;
        const groups = (Array.isArray(gr) && gr.reduce((a, b) => a + b, 0) === num) ? gr : metroBeatGroups(num);
        // idxが拍(グループ)頭か、そのグループの8分音符数(=1拍の長さ)を求める
        let acc = 0, gsize = 0;
        for (const g of groups) { if (acc === idx) { gsize = g; break; } acc += g; }
        isBeatAnchor = gsize > 0;                 // グループ頭のときだけ振り子を進める
        beatDur = (gsize || num) * eighthDur;     // 1拍=8分音符×グループサイズ(振り子1振り分)
        kind = metroTickKind(metroTickIndexRef.current, metroSigRef.current, subdiv, metroAccentRef.current, groups);
      } else {
        perMeasure = num * subdiv;
        stepDiv = subdiv;
        idx = metroTickIndexRef.current % perMeasure;
        isBeatAnchor = idx % subdiv === 0;        // 拍頭
        beatDur = eighthDur;                       // 1拍=分母音符1つ
        kind = metroTickKind(metroTickIndexRef.current, metroSigRef.current, subdiv, metroAccentRef.current);
      }

      if (kind !== "silent") {
        scheduleMetroClick(ctx, t, kind);
        // ライブ計測の除外判定用にクリック時刻をperformance.now()基準で記録する
        const perfT = performance.now() + (t - ctx.currentTime) * 1000;
        scheduledClicksRef.current.push(perfT);
        if (scheduledClicksRef.current.length > 128) scheduledClicksRef.current.splice(0, 64);
        // アクセント(=小節頭)の時刻は、録音のタイムラインに小節線を引くために別途貯める
        if (kind === "accent" && metroBarPerfTimesRef) {
          metroBarPerfTimesRef.current.push(perfT);
          if (metroBarPerfTimesRef.current.length > 2048) metroBarPerfTimesRef.current.splice(0, 1024);
        }
      }
      if (isBeatAnchor) {
        // 振り子は「1拍(端から端)」で1振り。X/8複合なら1拍=8分3つぶんの時間をかけて振れる。
        metroAnchorRef.current = { time: t, gBeat: metroGBeatRef.current, dur: beatDur };
        metroGBeatRef.current += 1;
      }
      metroNextTimeRef.current = t + eighthDur / stepDiv;
      metroTickIndexRef.current = (idx + 1) % perMeasure;
    }
  }, [scheduledClicksRef, metroBarPerfTimesRef]);

  const startMetronome = useCallback(() => {
    metroGenRef.current++; // 進行中の古い状態を無効化する
    // 出力用AudioContextはマイクの解析用とは分けて持つ(ライフサイクルを絡めないため)。
    // 【iOS対策・重要】アプリを一度バックグラウンドにするとAudioContextはinterrupted/suspendに
    // なり、awaitを挟んでからresume()してもユーザー操作(このタップ)の権限が切れて再開できない。
    // そこで「runningでなければ、このタップの中で同期的にコンテキストを作り直し、resume()も
    // awaitせず同期でキックする」。これで一度閉じてから戻ってもSTARTで必ず鳴らせる。
    // 出力の行き先(受話口/スピーカー)の宣言。マイク使用中に音が小さくなる問題への唯一の試行手段で、
    // 値は AUDIO_SESSION_TYPE の1箇所。効果は実機でしか確認できない(未対応環境では何も起きない)。
    applyAudioSessionType();
    let ctx = metroCtxRef.current;
    // 【F-52】state が "running" でも時計が止まっていることがある(iOSの割り込み後)。
    // 控えておいた基準点と突き合わせ、止まっていたなら state を信じずに作り直す。
    const mark = metroClockMarkRef.current;
    metroClockMarkRef.current = null; // 1回の START で使い切る(作り直した新しい時計と比べない)
    const clockStalled = !!ctx && !!mark &&
      audioClockStalled(ctx.currentTime - mark.audio, (performance.now() - mark.wall) / 1000);
    if (!ctx || ctx.state !== "running" || clockStalled) {
      try { ctx?.close(); } catch { /* noop */ }
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      metroCtxRef.current = ctx;
    }
    ctx.resume().catch(() => {}); // ジェスチャー中に同期的に発火(awaitしない)
    metroTickIndexRef.current = 0;
    metroGBeatRef.current = 0;
    metroNextTimeRef.current = ctx.currentTime + 0.12;
    metroAnchorRef.current = { time: metroNextTimeRef.current, gBeat: 0, mBeat: 0 };
    metroOnRef.current = true;
    metroActiveRef.current = true;
    setMetronomeOn(true);
    requestWakeLock(); // 練習中に画面が消えないように(録音時と同じ)
    if (metroTimerRef.current) clearInterval(metroTimerRef.current);
    metroTimerRef.current = setInterval(metroSchedulerTick, 25);
  }, [metroSchedulerTick, metroActiveRef, requestWakeLock]);

  const stopMetronome = useCallback(() => {
    metroGenRef.current++; // resume()待ち中の古いSTART呼び出しがあれば無効化する
    // 【F-52】止めた瞬間の (音声時計, 実時計) を控える。次の START までに音声時計が
    // 進まなければ、そのコンテキストは死んでいるので作り直す。
    // visibilitychange が飛ばなかった端末でも、ユーザーが STOP→START を踏めば回復できる。
    markMetroClock();
    if (metroTimerRef.current) { clearInterval(metroTimerRef.current); metroTimerRef.current = null; }
    metroOnRef.current = false;
    metroActiveRef.current = false;
    scheduledClicksRef.current = [];
    setMetronomeOn(false);
    // (旧UIの名残 setMetroSettingsOpen(false) は未定義でstopのたびに例外を投げていたため削除。
    //  設定サブパネルの開閉は metroPanel 側で独立管理しているのでここでは触らない)
    // AudioContextはsuspendしない(スケジューラを止めれば無音になるだけで十分軽量なため、
    // suspend/resumeの繰り返しによる不安定化を避ける。タブ離脱時のみアンマウント処理でcloseする)。
    if (!isRecording) releaseWakeLock(); // 録音中はWake Lockを維持
  }, [isRecording, metroActiveRef, scheduledClicksRef, releaseWakeLock, markMetroClock]);

  // アンマウント(=計測タブを離れた)時は完全に停止して音を止める
  useEffect(() => {
    const clicksRef = scheduledClicksRef;
    const activeRef = metroActiveRef;
    return () => {
      metroGenRef.current++;
      if (metroTimerRef.current) clearInterval(metroTimerRef.current);
      metroOnRef.current = false;
      activeRef.current = false;
      clicksRef.current = [];
      try { metroCtxRef.current?.close(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // アプリを閉じる(バックグラウンド化・画面ロック)とiOSはAudioContextを中断し、鳴っていた
  // メトロノームは無音のまま状態だけ残る。復帰後にSTOP表示なのに鳴らない混乱を避けるため、
  // 非表示になった時点でクリーンに止めておく(復帰後はSTARTで確実に鳴らせる=上のstartMetronome)。
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) return;
      // 【F-52】鳴っていたかどうかに関わらず、非表示になる瞬間の時計を控える。
      // iOS はここから復帰するときに「running のまま止まった」コンテキストを返すことがある。
      markMetroClock();
      if (metroOnRef.current) stopMetronome();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [stopMetronome, markMetroClock]);

  // 拍子・分割の変更時は小節の頭から仕切り直す(実行中のみ。テンポ変更は次の拍から自然に反映)
  useEffect(() => {
    const ctx = metroCtxRef.current;
    if (!metroOnRef.current || !ctx) return;
    metroTickIndexRef.current = 0;
    metroGBeatRef.current = 0;
    metroNextTimeRef.current = ctx.currentTime + 0.08;
    metroAnchorRef.current = { time: metroNextTimeRef.current, gBeat: 0, mBeat: 0 };
  }, [metroSig, metroSubdiv]);

  // 1拍(=振り子の片道1振り)の実時間[秒]。
  // a.dur = この拍(gBeat 1単位)の実時間。X/8複合は1拍=8分3つ=3×(60/tempo)なので、
  // 振り子は「端から端」=1拍(8分3つ)で1振りになる。未設定時は8分1つ分にフォールバック。
  // 停止後の戻り(F-51)の角振動数・時定数もここから引く。
  const getMetroBeatDur = useCallback(() => {
    const a = metroAnchorRef.current;
    return a.dur || (60 / metroTempoRef.current);
  }, []);
  // 振り子の位相(拍単位の連続値)。クリックと同じAudioContextの時計から算出する
  const getMetroPhase = useCallback(() => {
    const ctx = metroCtxRef.current;
    if (!ctx || !metroOnRef.current) return null;
    const a = metroAnchorRef.current;
    return a.gBeat + (ctx.currentTime - a.time) / getMetroBeatDur();
  }, [getMetroBeatDur]);

  // --- 録音の経過時間(B-2) ---
  // 正典は録音ボタンの下に「赤点 + m:ss」を出す。役割が重複する「録音中」バッジは撤去した
  // (バッジは position:fixed でメトロノームアイコンと場所を取り合っていた。F-48)。
  // 実時計で測る(フレームは無音だと進まないため)。0.25秒ごとに更新し、表示は m:ss。
  const [recElapsedMs, setRecElapsedMs] = useState(0);
  const recStartRef = useRef(0);
  useEffect(() => {
    if (!isRecording) { setRecElapsedMs(0); return undefined; }
    recStartRef.current = performance.now();
    setRecElapsedMs(0);
    const id = setInterval(() => setRecElapsedMs(performance.now() - recStartRef.current), 250);
    return () => clearInterval(id);
  }, [isRecording]);

  return (
    <div ref={measureRootRef} style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* 【縦構造】DESIGN-SYSTEM §6.1.5「レイアウトの安定」。
          画面ぶんの高さ(measureMinH)を持つ枠を1枚だけ敷き、その中を
            上端に固定(設定行) → 固定の間隔(--sp-1) → 主役(環) → 可変の中間(flex:1) → 下端に固定(アクション)
          の順で並べる。余りは必ず「可変の中間」が吸収する。
          ・justify-content を状態で切り替えない(全状態 flex-start)。以前は素の状態だけ center で、
            中身の高さが変わるたびに環と録音ボタンが動いていた(本人の実機フィードバック2026-08-01)。
          ・詳細カードはこの枠の「外・下」に置く。開いても枠の高さは measureMinH のままなので
            環・録音ボタン・詳細トグルは1pxも動かず、増えたぶんだけページがスクロールする。
          【F-74 で並びが1つ増えた】余りを吸収する flex:1 を「可変の中間」から独立した
          スペーサーへ出し、環と可変の中間を「チューナーの帯」1箱にまとめた。背面レイヤは
          その箱の中だけに敷く(= 上部設定行の直下 〜 テンポ操作行の下端)。
          上部設定行・録音ボタンより下・詳細カード・下部ナビは覆わない。 */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", minHeight: measureMinH || undefined }}>
      {/* ── 上端に固定 ── 設定行と各種の告知。この塊の下端が「固定の間隔」--sp-1。 */}
      <div style={{ flexShrink: 0 }}>
      {/* 上部設定行【N-4a で2行構成に変更】本人指示「リードと奏者・楽器・基準ピッチの上下を逆に」。
          ・1行目 = 奏者 / 楽器種別 / 基準ピッチ。3つとも**表示と選択の両方**を維持する
            (本人指示「表示の役割だけでなく選択の役割もあるので3つとも表示」)
          ・2行目 = リード(箱→個体の二段階)
          ・メトロノームの開閉は右端で**2行ぶんの高さ**。正典 = design/north-star-measure.html の待機中
          いずれも演奏前に決めたら触らない設定なので、上端に固めて環の縦スペースを確保する意図は不変。
          【B-1 録音中は淡くする】正典の「演奏中」は上部設定行と下部タブが opacity .35。
          環・音名・折れ線は淡くしない(演奏中に読む物だから)。淡くするだけで無効化はしない
          (メトロノームは録音中も押せる)。
          【A-1 の前面】position:relative + zIndex 1 で背面レイヤより手前に置く。
          レイアウトは動かない(static → relative でオフセット0のため。§6.1.5)。 */}
      <div className="tap-through" style={{ position: "relative", zIndex: 1, opacity: isRecording ? 0.35 : 1, display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--sp-1)" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div className="sans" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap", overflowX: "auto" }}>
          {/* 1行目 = 奏者 / 楽器種別 / 基準ピッチ。**表示と選択の両方**を担う(本人指示)。 */}
          {/* 【F-72】bare を渡すのは**この画面だけ**(正典 .set1 の「自分 ▾」)。
              セッション詳細の呼び出し(識別情報行)は既定のまま = 入力欄の作法を維持する。 */}
          <PerformerSelector
            performers={performers} selectedPerformer={selectedPerformer}
            setSelectedPerformer={setSelectedPerformer} setPerformers={setPerformers}
            disabled={isRecording}
            bare selectId="measure-performer-select"
          />
          {/* 【F-72】地も枠も元から持たない素のテキスト。**足したのは ▾ だけ**
              (正典 .set1 の「Alto ▾」「442Hz ▾」)。▾ はボタンの中に入れるので穴にならない。 */}
          <button onClick={() => setOpenPicker("sax")} style={{ background: "none", border: "none", color: "#8D95A1", cursor: "pointer", padding: 4, fontSize: 12 }}>{SAX_PRESETS[saxType]?.label}<PickChevron /></button>
          <span style={{ color: "#8D95A1" }}>·</span>
          <button onClick={() => setOpenPicker("tuning")} style={{ background: "none", border: "none", color: "#8D95A1", cursor: "pointer", padding: 4, fontSize: 12 }}>{tuningHz}Hz<PickChevron /></button>
        </div>
        {/* 2行目 = リード。 */}
        <div className="sans" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap", overflowX: "auto" }}>
          {/* リード選択の枠。
              【F-72 で地を落とした】本人指示(2026/08/12・実機)「モックでは上部の奏者やリードも
              カード色を変えてカード方式にしていない。モックに合わせて」。正典 .reedchip は
              **地も枠も持たない素のテキスト + ▾** なので、B型 .ctl-plain(地 --c-sunken)を外す。
              DESIGN-SYSTEM §6.7 の B型は §6.0 により「モックに対する制約として機能しない」。
              .ctl-plain は border:0 なので、クラスを外しても外形は 1px も変わらない
              (実測で確認済み。§6.1.5)。
              選択済み/未選択は左の点の色と文字の色・太さが返す(地では返さない)。
              中の select 2つは地も枠も持たない — DESIGN-SYSTEM §6.6 が明記する意図的な例外。
              【当たり判定】地が消えても**枠まるごとが箱の <select> の <label>** のままなので、
              N-4 で塞いだ 1,088px² の穴は開き直らない(F-72 で 1px 刻みに測り直して確認)。 */}
          {/* 【D-2】表記は正典の `V16-3 #4`。箱と個体は別の <select> だが、**1つの塊**として
              読めるように間を詰め(gap 0)、色も正典に合わせて 箱=--c-ink(太字) / 個体=--c-ink-2 にする。
              以前は箱も個体も --c-accent で、DESIGN-SYSTEM §1.4「--c-accent はアクション専用」に
              反していた(この枠は押せるが、文字色が状態を主張する必要は無い)。
              選択済み/未選択は左の点の色と文字の濃さ・太さが返す。 */}
          {/* 【審査⑥の修正】**枠まるごとを箱の <select> の <label> にする。**
              以前は <div> で、枠の左端(padding + 選択済みの点)・上下 2px・右 4px の padding が
              どの操作要素にも属さず**背面レイヤに落ちていた**(1px刻みの実測で 1,088px²。
              見た目は1つの枠なのに、そこを押すとメトロノームが開始/停止していた)。
              枠そのものを <label htmlFor> にすると、その 1,088px² が label に属して穴が塞がる
              (実測で残り 4px² = 角丸の縁だけ)。
              中の個体 <select> は「いちばん内側の操作」が勝つので、これまでどおり自分で受け取る
              (個体を押しても箱へ転送されないことを実測で確認済み)。
              (地・枠・角丸を持っていた .ctl-plain は F-72 で外した。当たり判定の構造はこのまま。)

              【ここで保証できること／できないこと】**書き分ける。**
              保証できる: (a) 枠の中に背面レイヤへ落ちる穴が無い (b) 枠を押すと箱の <select> へ
              フォーカスが移る。どちらも 375×812 の実測で確認した。
              **保証できない**: 押した結果**選択リストが開くか**。HTML 仕様は <label> の
              activation behavior を「プラットフォーム依存」とし、<select> を開くとは規定していない
              (WHATWG HTML §4.10.4)。**Chrome では開かない**(信頼されたクリックを合成して実測。
              フォーカスリングが出るだけ)。**iOS Safari は未検証＝実機待ち**
              (LOOP.md「Chrome で判定できない類」= ネイティブフォームコントロールの固有挙動)。
              実機で開かなければ label 方式は却下し、onClick で ScrollPicker を開く形
              (楽器種別・基準ピッチで既に使っている idiom) へ差し替える。 */}
          {/* 【差し戻し①】奏者枠と同じ作りにした: **値をテキストで描き、その上に透明な <select> を重ねる**。
              <select> に値を描かせると箱の幅が「いちばん長い option」で決まるため、
              値が短いときに右へ大きく余る。375×812 の実測(リード12枚・V16-3 #4 を選択):
                箱の select … 幅84 に対し値「V16-3」は 40.7(最長 option「リードを選択」67.9 + padding 16)
                個体の select … 幅44 に対し値「#4」は 20.2(最長 option「#12」27.7 + padding 16)
                → **「V16-3」と「#4」の間が 43.3px、「#4」と ▾ の間が 19.8px** 空いていた。
              正典 .reedchip は `<b>V16-3</b> #4 ▾` で、間は半角空白1つ。gap:0 を書いても
              **箱の余白は消せない**ので、「1つの塊として読ませる」が実際には成立していなかった
              (gap:0 だけを見る検査は通り続けていた)。
              重ねる形にすると幅が値そのものになり、間隔は --sp-1(4px)だけになる。
              **option の綴りは1箇所(下の配列)に集約**し、見えているテキストと <option> の
              両方をそこから作る(2箇所に書くと必ず片方が腐る)。 */}
          <label htmlFor="measure-reed-box" style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: 0, padding: "2px 4px 2px 10px", flexShrink: 0, cursor: isRecording ? "default" : "pointer" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: selectedReedId ? "#174585" : "#C3CAD3", flexShrink: 0, marginRight: 2 }} />
            {/* 【overflow は箱と値の両方に要る】maxWidth は**幅の上限**でしかない。
                値を <span> に描かせる形では、上限を超えた文字は箱の外へそのまま描かれる
                (素の <select> はコントロールの箱が値をクリップしてくれていた。
                 実測: `D'Addario Select Jazz-3S` は 166.9px あり、maxWidth 110 の外へ出て
                 隣の #3 に 56.4px 重なった)。銘柄の最後の語が衝突すると shortBoxLabel が
                フル銘柄へ戻す仕様なので、この長さは実在しうる。 */}
            <span style={{ position: "relative", display: "inline-flex", alignItems: "center", height: TOPSET_REED_SELECT_H_PX, maxWidth: 110, overflow: "hidden" }}>
              <span style={{ color: selectedReedId ? "var(--c-ink)" : "#435266", fontWeight: selectedReedId ? 600 : 400, whiteSpace: "nowrap", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {(reedBoxOptions.find((o) => o.value === (selectedBoxKey || "")) || reedBoxOptions[0]).label}
              </span>
              <select
                id="measure-reed-box"
                value={selectedBoxKey || ""}
                onChange={(e) => { setSelectedBoxKey(e.target.value || null); setSelectedReedId(null); }}
                disabled={isRecording}
                style={{ pointerEvents: "auto", position: "absolute", left: 0, top: 0, width: "100%", height: "100%", padding: 0, color: "transparent", background: "none", border: "none", appearance: "none", WebkitAppearance: "none", cursor: isRecording ? "default" : "pointer" }}
              >
                {reedBoxOptions.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </span>
            {/* 箱と個体の間隔は**この marginLeft だけ**が作っている(label の gap は 0)。
                正典 .reedchip の半角空白1つに当たる。--sp-1(4px)より広げないこと
                (43.3px 空いて「V16-3 #4」が1つの塊に読めなくなったのが差し戻しの理由)。 */}
            <span style={{ position: "relative", display: "inline-flex", alignItems: "center", height: TOPSET_REED_SELECT_H_PX, maxWidth: 60, marginLeft: "var(--sp-1)", overflow: "hidden" }}>
              <span style={{ color: selectedReedId ? "var(--c-ink-2)" : "#C3CAD3", whiteSpace: "nowrap", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {(reedMemberOptions.find((o) => o.value === (selectedReedId || "")) || reedMemberOptions[0]).label}
              </span>
              <select
                value={selectedReedId || ""}
                onChange={(e) => setSelectedReedId(e.target.value || null)}
                disabled={isRecording || !selectedBoxGroup}
                style={{ pointerEvents: "auto", position: "absolute", left: 0, top: 0, width: "100%", height: "100%", padding: 0, color: "transparent", background: "none", border: "none", appearance: "none", WebkitAppearance: "none", cursor: isRecording || !selectedBoxGroup ? "default" : "pointer" }}
              >
                {reedMemberOptions.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </span>
            {/* 【F-81】箱の開封日。本人指示(2026/08/14・実機)「計測タブに表示されるリードに
                開封日も追加して。同じ銘柄使った時どちらか分からない」。
                **表記は yyyy/mm/dd**(DESIGN-SYSTEM §6.0「日付は yyyy/mm/dd」)。
                月日だけに縮める案もあったが、(a) 375×812 の実測で最長の箱名でも収まる
                (b) 縮めると §6.0 に無い日付表記を1つ増やすことになる、の2点で全桁を出す。
                値でも選択肢でもない**箱の説明**なので、`·` で区切って --c-ink-3 の素の文字に落とす
                (箱の値 --c-ink / 個体 --c-ink-2 より弱い段)。選んでいないときは出さない。
                【当たり判定】<label> の中に置いてあるので**背面レイヤへ落ちる穴にはならない**
                (ここまでは 375×812 の実測で確認済み)。ただし**押した結果 <select> の選択リストが
                開くかは Chrome では判定できない = 実機待ち**: <label> の activation behavior は
                HTML 仕様が「プラットフォーム依存」とし、Chrome では開かない(F-72 と同じ未解決点。
                この枠全体が同じ前提の上に乗っている)。 */}
            {selectedBoxGroup && formatYmd(selectedBoxGroup.startDate) && (
              <span style={{ color: "var(--c-ink-3)", whiteSpace: "nowrap", flexShrink: 0, marginLeft: "var(--sp-1)" }}>
                · {formatYmd(selectedBoxGroup.startDate)}
              </span>
            )}
            {/* 正典 .reedchip の末尾の ▾。枠(label)の中なので当たり判定の穴にならない。 */}
            <PickChevron />
          </label>
        </div>
        </div>
        {/* メトロノーム(タップでパネルの開閉のみ。実際の音はパネル内のSTART/STOPで制御)。
            【N-4a】右端に移し、**2行ぶんの高さ**にする(本人指示)。
            【F-75 で枠線を撤去】本人指示(2026/08/12・実機)「メトロノームアイコンも同様に枠線不要」。
            A型 .ctl-state(枠線 --c-line-strong / ON は --c-accent)を外した。
            **ON/OFF が分かることは維持する**: 正典 design/north-star-measure.html の
            「待機中」と「メトロノーム中」もアイコンの色だけが変わっている(--ink2 → --accent)ので、
            返し方はアイコンの色(--c-ink-3 → --c-accent)と aria-pressed。
            枠は `1px solid transparent` で**場所だけ残す**(DESIGN-SYSTEM §6.7「枠を透明にして残す」。
            border:0 にすると 44×56 が 42×54 に縮み、行の高さを通って環が動く。§6.1.5)。 */}
        <button
          onClick={() => {
            if (showMetroPanel) {
              if (metronomeOn) stopMetronome(); // パネルを閉じる時、鳴っていれば止める
              setShowMetroPanel(false);
            } else {
              setShowMetroPanel(true);
            }
          }}
          aria-label="メトロノーム"
          aria-pressed={showMetroPanel}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: "var(--tap-min)", height: 56, cursor: "pointer", flexShrink: 0,
            background: "transparent", border: "1px solid transparent", padding: 0,
          }}
        >
          {/* 色は hex のまま。SVG のプレゼンテーション属性(stroke/fill)は var() を
              解決しない環境があるため(DESIGN-SYSTEM §1.9)。#174585=--c-accent / #8D95A1=--c-ink-3。 */}
          <MetronomeIcon color={showMetroPanel ? "#174585" : "#8D95A1"} size={26} />
        </button>
      </div>
      {(!reeds || reeds.length === 0) && (
        <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginBottom: "var(--sp-1)" }}>「リード」タブでリードを登録できます</div>
      )}

      {/* 【C-1 で移設】隠しファイル入力とアップロードのボタン・告知はデータタブへ移した。
          正典の計測タブは**録音ボタン1つだけ**。解析の進捗・完了通知・「目安に設定」も
          アップロードに付いてデータタブ側に出る(AnalysisLabView)。 */}
      {/* 【N-4b で撤去】環と入れ替わる設定パネル(拍子 / 1拍の分割)。
          正典は「環と共存」なので、設定は環を消さずに**下から重ねるシート**(下記)にした。 */}
      </div>{/* /上端に固定 */}

      {/* ── 主役 ── 環。上端の塊から --sp-1 の固定間隔だけ下、という位置から絶対に動かさない。
          flexShrink:0 を明示して、下の中身が増えても環が痩せないようにする。 */}
      {/* 音名+ピッチ表示。実音(コンサートピッチ)表示。演奏中サーフェスなので、
          メトロノームの開閉にかかわらず環(PitchRing)を主役にする(設計言語を1つに保つ)。
          【大きさは変えない】以前はメトロノームを開くと 330→250 に縮めていたが、主役の
          大きさが開閉のたびに変わるのは読み取りを妨げる。環は常に RING_D_FULL(330)。
          【N-4b】環は**ピッチ専用**になった。メトロノームを開いている間も環は消えず、
          拍(振り子・拍の●)は環の下に並ぶ(正典 = design/north-star-measure.html「メトロノーム中」)。
          以前あった「26pxの音名+横メーター+13pxのセント値」へのフォールバックは廃止した
          (1m先で読めないうえ、セント色の閾値が環と一致していなかった)。 */}
      {/* ── チューナーの帯 ── 環 + 可変の中間の中身を1つの箱にまとめる。
          【F-74 でこの箱を作った】本人指示(2026/08/12・実機)「どこをタップしても作動しすぎる。
          **上部の奏者やリード表示があるところより下から、テンポ表示があるところまで**を
          タップで開始/停止に(おおむねチューナー表示周辺)」。
          背面レイヤ(下)をこの箱の inset に貼るので、**箱の下端 = テンポ操作行の下端**に
          なるように、余りを吸収する flex:1 はこの箱の**外**(下のスペーサー)へ出してある。
          この箱自身は flexShrink:0 で中身ぶんの高さしか持たない。
          この付け替えでは環・録音ボタン・詳細トグルの位置は 1px も動かない(実測で確認。§6.1.5)。 */}
      <div style={{ position: "relative", flexShrink: 0 }}>

      {/* 【A-1 / F-74】メトロノームの開始/停止は**この帯のどこをタップしてもよい**。
          実装は「背面レイヤ1枚 + 操作要素を前面に置く」。stopPropagation は使わない
          (伝播を止める作りにすると、マイク復旧のジェスチャー経路のように
           "document まで届くこと"に依存している既存の仕組みを壊しうる)。
          【F-74 で範囲を狭めた】以前は画面ぶんの枠(上端16 〜 下端765)を丸ごと覆っていた。
          本人には「どこをタップしても作動しすぎる」と映ったので、**上部設定行の直下から
          テンポ操作行の下端まで**に限る。範囲外(上部設定行・録音ボタンの周り・詳細トグル・
          下部ナビ)は開始/停止しない。**新しい無反応領域が生まれるのは意図した仕様。**
          【上端の負オフセットを外した】N-4 で入れた `.app-root` の padding-top ぶんの
          負オフセット(上端 16px + 安全域)は、上端を覆わなくなったので不要。
          **左右の負オフセットは残す**: 帯は画面の端から端まで反応してほしいので、
          枠の外側にある .app-root の左右 padding(14px + 安全域)まで広げる。式は
          .app-root の padding と**同じもの**を符号だけ変えて書く(別管理にしない)。
          上端は `calc(-1 * var(--sp-1))` = 上端の塊との「固定の間隔」ぶんだけ遡り、
          上部設定行の下端との間に無反応の隙間を作らない。
          下端は箱の下端そのもの(= メトロノームを開いていればテンポ操作行の下端)。
          【F-73】ピッカーを開いている間は disabled にする。本人報告
          「サックス種別とHzを押すと選択肢は出てくるが、メトロノームの開始/停止が優先されて
          動かない」。ピッカー自体もこの枠の外(z-index 60)へ出したので暗幕が最前面になるが、
          **覆う側が出ているときは覆われる側を無効化する**(§6.1.5「押しても何も起きないを作らない」)。
          z-index 0 の位置指定要素は静的な中身より前に来るので、押せなければならない物には
          z-index 1 を与えて**前面**に出す: 上部設定行 / テンポの操作行 / 録音ボタンと詳細トグル。
          さらにそれらの箱自身は .tap-through で当たり判定を捨て、中の操作要素だけが受け取る
          (箱に当たり判定を残すと、箱の**余白**でタップが死ぬ。375×812 の全走査で実測して直した)。
          モーダル(ScrollPicker・保存確認・テンポシート)は position:fixed の z-index 60 で更に上。 */}
      {showMetroPanel && (
        <button
          type="button"
          onClick={() => (metronomeOn ? stopMetronome() : startMetronome())}
          aria-label="メトロノームの開始/停止"
          aria-pressed={metronomeOn}
          disabled={openPicker !== null}
          className="no-select"
          style={{
            position: "absolute", zIndex: 0,
            top: "calc(-1 * var(--sp-1))",
            /* 【N-11 2026/08/17】式を写すのをやめ、.app-root と**同じトークン**を符号だけ
               変えて使う(--page-pad-left / --page-pad-right)。計算値は従来と同一。 */
            left: "calc(-1 * var(--page-pad-left))",
            right: "calc(-1 * var(--page-pad-right))",
            bottom: 0,
            background: "transparent", border: "none", padding: 0, cursor: "pointer",
          }}
        />
      )}

      {/* 環の下の余白は「可変の中間」側(グラフの marginTop / 操作UIの marginTop)が持つ。
          ここに状態で変わる padding を足すと、それ自体が状態依存の寸法になるので置かない。 */}
      <div style={{ flexShrink: 0 }}>
        <PitchRing note={note} centsOffset={centsOffset} diameter={RING_D_FULL} />
      </div>

      {/* ── 可変の中間 ── 状態ごとに中身が入れ替わる(素=これまでの音 / メトロノーム=拍と操作)。 */}
      <div style={{ display: "flex", flexDirection: "column" }}>
      {/* メトロノーム。正典「メトロノーム中」の .pend そのもの:
            浅い弧のガイド + 往復する点 → 拍の●(中央固定)と拍子表示 → テンポの − / ♩=n / ＋。
          開始/停止のボタンは無い。**画面のどこをタップしても開始/停止する**(A-1)。
          拍子・分割・拍グループ・小節アクセントは、テンポ数値のタップで開くシートに入っている。 */}
      {showMetroPanel && (
        /* 【F-95a】振り子〜テンポ行の縦の間隔も一式と同じ倍率で開く。
           marginTop(環との間)は拡大の対象外なので基準値のまま。 */
        <div style={{ marginTop: "var(--sp-2)", display: "flex", flexDirection: "column", alignItems: "center", gap: `calc(var(--sp-2) * ${METRO_SCALE})` }}>
          <MetroPendulum
            getBeatPhase={getMetroPhase}
            getBeatDur={getMetroBeatDur}
            beatsPerMeasure={metroBeatsPerMeasure}
            accentOn={metroAccent}
            sig={metroSig}
            /* 【F-91】拍子表示・拍の●からもテンポ拍子シートを開く。
                テンポ数値(♩=n)からの入口(下の <button>)はそのまま残す。 */
            onOpenSheet={() => setTempoSheetOpen(true)}
          />
          {/* テンポ行。押せる物(− / ♩=n / ＋)があるので背面レイヤより手前(zIndex 1)。
              【審査①の修正】ただし**箱そのものは当たり判定を持たない**(.tap-through)。
              持たせると −と♩=n の隙間・♩=n と＋の隙間・数値の下 2px が「押しても何も起きない」
              領域になる(審査役の1px刻み全走査で y492-539 × x120-254 = 3,268px² が無反応だった)。
              §6.1.5「押しても何も起きないを作らない」。 */}
          <div className="tap-through" style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: METRO_PM_GAP_CSS }}>
            {/* 【A-4 / 逸脱4 の撤回】正典 .pmt をそのまま採る:
                  width 72 / height 48 / font-size 20 / font-weight 300 / color --ink2 / 地も枠も無し。
                以前は「文字サイズ据え置き(24px)+46×46 のピル」にしていたが、見た目については
                モックが唯一の正典(DESIGN-SYSTEM §6.0)。**反応領域 72×48 は本人の明示要件**なので維持。
                gap 34 も正典(.pmt を並べる行の gap)。
                【F-95a】本人指示「メトロノームはB」で、この行も一式と同じ METRO_SCALE 倍で描く。
                基準値(72/48/20/15/34)は正典のまま。実寸は 86.4×57.6 / 24px / 18px / gap 40.8。 */}
            <button
              onClick={() => setMetroTempo((v) => clampMetroTempo((Number(v) || 120) - 1))}
              aria-label="テンポを下げる" className="no-select"
              style={{ width: METRO_PM_W_CSS, height: METRO_PM_H_CSS, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", flexShrink: 0, fontSize: METRO_PM_FS_CSS, fontWeight: 300, color: "var(--c-ink-2)", lineHeight: 1 }}
            >−</button>
            {/* 【A-5】テンポ数値をタップすると下からシートが開く。正典の .bpmtxt「♩= 92」(15px)。
                箱の幅は ± と同じ METRO_PM_W に固定してあるので、桁が変わっても ± は動かない(§6.1.5)。 */}
            <button
              onClick={() => setTempoSheetOpen(true)}
              aria-label="テンポと拍子" aria-expanded={tempoSheetOpen}
              className="sans no-select"
              style={{ width: METRO_PM_W_CSS, minHeight: "var(--tap-min)", background: "none", border: "none", fontFamily: "var(--font-num)", fontSize: METRO_BPM_FS_CSS, color: "var(--c-ink-2)", cursor: "pointer", padding: 0, lineHeight: 1, flexShrink: 0 }}
            >
              ♩= {metroTempo}
            </button>
            <button
              onClick={() => setMetroTempo((v) => clampMetroTempo((Number(v) || 120) + 1))}
              aria-label="テンポを上げる" className="no-select"
              style={{ width: METRO_PM_W_CSS, height: METRO_PM_H_CSS, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", flexShrink: 0, fontSize: METRO_PM_FS_CSS, fontWeight: 300, color: "var(--c-ink-2)", lineHeight: 1 }}
            >＋</button>
          </div>
        </div>
      )}

      {/* 「これまでの音」ミニタイムライン。メーターと同様、録音開始有無に関わらず常時動かす。
          録音中はphraseFrames(セッションになる確定データ)を、それ以外はマイク接続中に常に
          更新され続ける直近30秒のローリングバッファ(liveFrames)を表示に使う。以前は録音を一度
          行うとphraseFramesが残り続け、録音停止後もグラフが過去の録音で固まったままになっていた
          ため、録音していない間はliveFramesを優先してライブ追従させる。 */}
      {/* フレームが無い(マイク未接続・音を出す前)状態でも常にグラフを描き、既定は中央0¢の
          フラットなラインを表示する(空状態の別レイアウトに切り替えず、位置ブレをなくす)。 */}
      {/* quietは常にtrue。環が主役の演奏中サーフェスなので、縦軸の12px数値ラベルを
          出す/出さないで設計言語が割れないようにする。
          【メトロノームを開いている間は隠す】環を330px固定にしたぶんの縦スペースをここから
          捻出する。メトロノーム使用中はリズムに集中していて、ピッチの履歴は合間に読むもの。 */}
      {!showMetroPanel && (
      <div style={{ marginTop: 6 }}>
        <PitchDeviationLine frames={isRecording ? phraseFrames : liveFrames} quiet />
      </div>
      )}

      </div>{/* /可変の中間 */}
      </div>{/* /チューナーの帯(背面レイヤの範囲) */}

      {/* ── 余りを吸収するスペーサー ── 以前は「可変の中間」が flex:1 で兼ねていた役。
          F-74 で背面レイヤの下端を**テンポ操作行の下端**に合わせるため、余りの吸収だけを
          ここへ分離した。中身は持たないので、環・録音ボタン・詳細トグルの位置は変わらない。 */}
      <div style={{ flex: "1 1 auto", minHeight: 0 }} />

      {/* ── 下端に固定 ── 録音ボタン・経過時間・詳細トグル。枠の高さが measureMinH で固定なので
          これらの top は状態が変わっても動かない。
          【A-1 の前面】この塊は押せなければならないので zIndex 1(背面レイヤより手前)。
          ただし**箱そのものは当たり判定を持たない**(index.css の .tap-through)。持たせると
          録音ボタンの左右の余白と経過時間の行でタップが死ぬ(375×812 の実測で確認)。
          中の <button> だけが当たり判定を取り戻す。 */}
      <div className="tap-through" style={{ position: "relative", zIndex: 1, flexShrink: 0 }}>
      {/* 【C-1】正典の計測タブは録音ボタン**1つだけ**。アップロードはデータタブへ移した。
          【⑥ / 逸脱9 の撤回】形は正典 .rec をそのまま:
            68×68 の白い円 / 1.5px の輪郭(--c-line-strong) / 文字は持たない。
            中身は 待機= .rec .dot(赤い丸 26px) / 録音中= .rec .stop(赤い角丸 22px・r5)。
          文字を持たないので名前は aria-label が担う。状態は aria-pressed(トグル)。
          【影は持たない】本人指示(F-50)。box-shadow は外形寸法を変えない(実測で確認)。 */}
      <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
        {/* 【F-73】ピッカーを開いている間は無効化する。本人報告「録音ボタンも選択肢提示中に
            有効になっている。選択肢提示中は他と同様に裏面でよい」。ピッカーは position:fixed の
            z-index 60 で最前面に出したが、無効化も併せて行う(§6.1.5「押しても何も起きないを作らない」の
            逆側 = 覆われている側は無反応ではなく disabled にする)。 */}
        <button
          onClick={toggleRecording}
          aria-label={isRecording ? "録音を停止" : "録音する"}
          aria-pressed={isRecording}
          disabled={openPicker !== null}
          className="sans"
          /* 【F-89】外径 68 は正典 .rec のまま(状態で動かさない)。輪は 1.5px → 4px。
              寸法は**静的に読める文字列/数値で書く**(index.css の芯を守るため、
              テストのハーネスが式を辿れない形にしない。scripts/pitch-test.mjs 17.x)。
              ここの 68 は正典 .rec の width と、4 は REC_RING_SW と一致していることを検査で固定する
              (68 は REC_BTN_D との一致ではなく**正典との一致**で縛る。定数どうしを突き合わせても
               両方を同じ値に書き換える変異が通るため)。
              地は border-box(index.css の `*` 規則)なので、輪を太くしても外径は 68 のまま。 */
          style={{ width: 68, height: 68, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c-surface)", border: "4px solid var(--c-line-strong)", padding: 0, cursor: "pointer" }}
        >
          {/* 【F-89】中身の寸法は recInnerShape が唯一の答え。ここで数値を書かない
              (待機と録音中で2箇所に写すと、片方だけ直して外径が動く事故になる)。
              輪(border)と外径は状態で変わらないので、**形だけが変わる**。 */}
          {(() => {
            const s = recInnerShape(isRecording);
            return <span style={{ width: s.size, height: s.size, borderRadius: s.radius, background: "var(--c-danger)", display: "inline-block" }} />;
          })()}
        </button>
      </div>

      {/* 【B-2】録音の経過時間。正典は録音ボタンの下に「赤点 + m:ss」。
          役割が重複していた「録音中」バッジ(position:fixed)は撤去した。
          **箱は常に確保し、文字だけを出し入れする**(DESIGN-SYSTEM §6.1.5)。
          高さは音名の下のセント値と同じ式 calc(--fs-md + --sp-1) を使い、新しい値を足さない。 */}
      {/* 寸法は正典 .rectime / .recdot をそのまま: font-size 12 / gap 6 / 赤点 6×6。 */}
      <div className="sans" style={{ height: 19, marginTop: "var(--sp-1)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "var(--font-num)", fontSize: 12, color: "var(--c-ink-3)" }}>
        {isRecording && (
          <>
            {/* 点滅は index.css の @keyframes pulse。.ficus-pulse で prefers-reduced-motion では止まる。 */}
            <span className="ficus-pulse" style={{ width: 6, height: 6, background: "var(--c-danger)", borderRadius: "50%", display: "inline-block", animation: "pulse 1s infinite" }} />
            {formatElapsedMs(recElapsedMs)}
          </>
        )}
      </div>

      {/* 詳細トグル: 倍音構成・音量/重心/HNR・計測下限dB・目安を1枚の折りたたみカードにまとめ、
          画面の一番下(録音ボタンより下)に置く。 */}
      {/* 【F-75 で枠線を撤去】本人指示(2026/08/12・実機)「詳細タブも枠線を作る必要はない」。
          A型 .ctl-state + .ctl-pill(枠線 --c-line-strong / 開くと --c-accent)を外した。
          正典 design/north-star-measure.html の .chevbtn も**素の山形1つ**で枠を持たない。
          開いているかどうかは**山形の向き**が返し、状態は aria-expanded が持つ。
          枠は `1px solid transparent` で場所だけ残す(DESIGN-SYSTEM §6.7)。border:0 にすると
          高さが 44 → 42 になり、§5 のタップ領域 44px を割る(機能側の規定なので §6.0 でも有効)。 */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
        <button
          onClick={() => setDetailOpen((v) => !v)}
          aria-label={detailOpen ? "詳細を閉じる" : "詳細を見る"}
          aria-expanded={detailOpen}
          style={{ width: 200, maxWidth: "72%", padding: "9px 0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid transparent" }}
        >
          {detailOpen
            ? <ChevronUp size={24} color="#174585" strokeWidth={2.5} />
            : <ChevronDown size={24} color="#174585" strokeWidth={2.5} />}
        </button>
      </div>
      </div>
      </div>{/* /画面ぶんの固定枠 */}

      {/* ── 追加表示 ── 詳細カード。固定枠の「外・下」に置く。開いても枠の高さは measureMinH の
          ままなので、環・録音ボタン・詳細トグルは1pxも動かない。増えたぶんだけページが縦に伸び、
          ここから下だけがスクロールする(素の状態・メトロノームだけの状態ではスクロールしない)。
          【A-1 とは無関係】背面レイヤは画面ぶんの枠の中だけに敷いてあるので、このカードは
          覆われない。中の操作要素(目安チェック・計測下限スライダー・目安の選択と削除)は
          そのまま自分でタップを受け取る。 */}
      {detailOpen && (
        <div style={{ padding: "16px 0 10px" }}>
          {/* 【F-75 で上辺の罫を撤去】本人指示(2026/08/12・実機)「詳細タブも枠線を作る必要はない」。
              計測タブは罫の作法(.surf-rule)なので .card は上辺に --c-rule の罫1本を持つ。
              罫を消すのに .card 自身へインラインで書くと作法が丸ごと効かなくなるので、
              DESIGN-SYSTEM §6.6 が用意している逃げ道 = **`.card` という文字列を含まない
              別名クラス .no-top-rule** を使う(既存の規則。乱用しないための「本人が明示した箇所だけ」に
              この1件が加わって計3箇所)。地・padding などは .surf-rule .card のまま生きる。
              **正典 design/north-star-measure.html の .detail は border-top を持っている**が、
              本人の実機指示が正典より上位(F-77 と同じ扱い)。 */}
          <div className="card no-top-rule">
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <span className="sans" style={{ fontSize: 13, fontWeight: 700, color: "#121F32" }}>倍音構成（実測 / 目安）</span>
              <div className="sans" style={{ display: "flex", gap: 10, fontSize: 12, color: "#435266" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}><input type="checkbox" checked={showIdeal} onChange={(e) => setShowIdeal(e.target.checked)} /> 目安</label>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 140, paddingTop: 14 }}>
              {Array.from({ length: NUM_HARMONICS }).map((_, idx) => {
                const n = idx + 1;
                const measured = harmonicLevels.find((h) => h.n === n);
                const measuredHeight = measured ? measured.norm * 100 : 0;
                const idealHarmonic = currentNoteIdeal?.harmonicsProfile?.find((h) => h.n === n);
                const idealHeight = idealHarmonic ? idealHarmonic.norm * 100 : 0;
                const showIdealBar = showIdeal && currentNoteIdeal && !!idealHarmonic;
                return (
                  <div key={n} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
                    <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, position: "relative" }}>
                      <div style={{ width: "38%", height: `${measuredHeight}%`, background: measured ? "#174585" : "transparent", borderRadius: "3px 3px 0 0", minHeight: measured ? 3 : 0, transition: "height 0.1s ease-out" }} />
                      {/* 理想バーの枠(28%)は常に確保する。理想が出ている時と出ていない時で
                          実測バーの横位置が動かないようにするため、非表示時も同じ幅の空スロットを残す。 */}
                      <div style={{ width: "28%", height: showIdealBar ? `${idealHeight}%` : 0, border: showIdealBar ? "1.5px dashed #8D95A1" : "none", borderBottom: "none", borderRadius: "3px 3px 0 0", minHeight: showIdealBar ? 3 : 0, opacity: 0.85, boxSizing: "border-box" }} />
                    </div>
                    <div className="sans" style={{ fontSize: 12, color: "#435266", marginTop: 4 }}>{n}倍</div>
                  </div>
                );
              })}
            </div>
            <div className="sans" style={{ fontSize: 12, color: "#435266", marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, background: "#174585", borderRadius: 2, display: "inline-block" }} />実測</span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 8, height: 8, border: "1.5px dashed #8D95A1", borderRadius: 2, display: "inline-block" }} />目安{selectedIdeal ? `: ${selectedIdeal.name}` : "(未選択)"}</span>
            </div>

            <div style={{ height: 1, background: "#EEF1F4", margin: "18px 0 16px" }} />

            <div className="tile-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", marginTop: 16 }}>
              {/* 値・単位・目安行は常に同じ形で描画し、測れない瞬間も「—」で行をキープする(ガタつき防止) */}
              <MetricCard label="音量" value={volumeDb.toFixed(1)} unit="dB" sub={`目安: ${currentNoteIdeal?.volumeDb != null ? `${currentNoteIdeal.volumeDb.toFixed(1)} dB` : "— dB"}`} />
              <MetricCard label="スペクトル重心" value={centroidHz != null ? String(Math.round(centroidHz)) : "—"} unit="Hz" sub={`目安: ${currentNoteIdeal?.centroidHz != null ? `${Math.round(currentNoteIdeal.centroidHz)} Hz` : "— Hz"}`} />
              <MetricCard label="HNR" value={hnrDb !== null ? hnrDb.toFixed(1) : "—"} unit="dB" sub={`目安: ${currentNoteIdeal?.hnrDb != null ? `${currentNoteIdeal.hnrDb.toFixed(1)} dB` : "— dB"}`} />
            </div>

            <div style={{ height: 1, background: "#EEF1F4", margin: "18px 0 14px" }} />

            {/* 計測下限dB: バンドパス後の音量がこの値以下なら無音とみなす(旧称ノイズゲート)。 */}
            <div className="sans" style={{ fontSize: 12, color: "#121F32", fontWeight: 700, marginBottom: 8 }}>計測下限dB</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range" min="-80" max="-20" step="1" value={noiseGateDb}
                onChange={(e) => setNoiseGateDb(Number(e.target.value))}
                style={{ flex: 1, accentColor: "#174585" }}
              />
              <span style={{ fontFamily: "var(--font-num)", fontSize: 13, fontWeight: 700, color: "#174585", width: 62, textAlign: "right" }}>{noiseGateDb} dB</span>
            </div>

            {/* 端末がAGC等を無効化できなかった場合の警告(iOS Safari等で発生しうる) */}
            {micProcessingWarning && (
              <div className="sans" style={{ marginTop: 10, padding: "8px 10px", background: "#FDF0E1", border: "1px solid #F0D9B8", borderRadius: 8, fontSize: 12, color: "#8A5A00", lineHeight: 1.6 }}>
                {micProcessingWarning}
              </div>
            )}

            {/* 目安(旧・理想値プロファイル)。作成は録音後の「目安に設定」ボタンから行う。
                計測下限dBの下に置き、詳細を閉じると一緒に隠れる。 */}
            {idealProfiles.length > 0 && (
              <>
                <div style={{ height: 1, background: "#EEF1F4", margin: "18px 0 14px" }} />
                <div className="sans" style={{ fontSize: 12, color: "#121F32", fontWeight: 700, marginBottom: 8 }}>目安</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {idealProfiles.map((p) => (
                    /* 【A型 = index.css の .ctl-state】選択中/非選択という**状態を持つ**ので枠線を使う。
                       状態は枠線の色(--c-line-strong → --c-accent)と文字色だけで返し、地は足さない
                       (以前は選択中だけ 枠 1.5px #174585 と 地 #EAEFF5 を両方持っていた。
                        枠の太さも 1.5px/1px で割れていた。両方 1px に揃える。
                        なお DPR=1 の実測では両方 1px に丸められ高さは 39px で同じだった。
                        枠の太さの差が見えるのは端末の画素密度が高いときだけ)。
                       <button> ではなく <div> のままなのは、行の中に削除の <button> を抱えているため
                       (button の入れ子は作れない)。状態は aria-pressed が持つ。
                       角丸のインライン(4px)も外す。型がクラスで角丸まで決めるので(A型 = --r-sm 8px)、
                       インラインで書き戻すと型が効かなくなる(17.6 の検査が落ちる)。

                       【F-76】**選択中の行をもう一度タップすると選択を解除する。**
                       本人指示(2026/08/12・実機)「選択中のものを解除するには他の目安をタップするか
                       削除するしか今は選択肢がない。選択中の目安をタップで目安設定を解除できるように」。
                       解除後は「目安未設定」= selectedIdealId が null の状態に戻る
                       (削除で選択中の目安が消えたときと同じ状態。deleteIdealProfile 参照)。
                       比較の破線・「目安: n」の表示は selectedIdeal / currentNoteIdeal が null に
                       なることで自動的に消える(表示側に分岐を足さない)。
                       削除(ゴミ箱)の挙動は変えていない。 */
                    <div key={p.id} onClick={() => setSelectedIdealId((cur) => (cur === p.id ? null : p.id))}
                      aria-pressed={selectedIdealId === p.id}
                      className="ctl-state"
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", cursor: "pointer" }}>
                      <div className="sans" style={{ fontSize: 12, color: selectedIdealId === p.id ? "#174585" : "#121F32" }}>{p.name}<span style={{ fontSize: 12, color: "#435266", marginLeft: 6 }}>{SAX_PRESETS[p.saxType]?.label}</span></div>
                      <button onClick={(e) => { e.stopPropagation(); deleteIdealProfile(p.id); }} style={{ background: "none", border: "none", color: "#435266", cursor: "pointer", padding: 4 }}><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 浮かせる告知(レイアウトの流れの外) ───────────────────────────────
          保存確認は「出たり消えたりする過渡的な告知」なので、上端固定ブロックの流れに置くと
          出た瞬間に環・録音ボタン・詳細トグルが下がる(F-8)。流れから外す(position:fixed)。
          【N-4b で減った告知】
          ・「録音中」バッジ → 録音ボタンの下の経過時間(赤点 + m:ss)に一本化した(B-2)。
            F-48 の要件は「メトロノームのアイコンを覆わない」で、覆うと押せなくなるのが理由。
            バッジそのものが無くなったので、覆う経路が構造的に消えた。
          ・アップロードの進捗・タップ要求・完了通知 → データタブへ移設した(C-2)。 */}

      {/* 【F-73 でここへ移した】楽器種別・基準ピッチのスクロールピッカー。
          本人報告(2026/08/12・実機)「サックス種別とHzを押すと選択肢は出てくるが、
          **メトロノームの開始/停止が優先されて動かない**」「録音ボタンも選択肢提示中に
          有効になっている。選択肢提示中は他と同様に裏面でよい」。
          原因は**置き場所**だった: 以前は上部設定行(.tap-through = pointer-events:none / z-index 1)の
          **中**に置いていたので、
            (a) 暗幕もピッカーの行も pointer-events を継承して none になり、
                タップがそのまま背面レイヤ(メトロノームの開始/停止)へ抜けていた
            (b) 上部設定行(z-index 1)より後ろの兄弟である録音ボタンの塊(z-index 1)が
                ピッカーより手前に描かれ、暗幕の上から押せていた
          テンポシートと同じ場所(画面ぶんの枠の**外**・position:fixed の z-index 60)へ出すと、
          どちらも構造的に起きない。**併せて背面レイヤと録音ボタンを disabled にする**
          (§6.1.5「押しても何も起きないを作らない」)。
          ピッカー自体の作法(止まった位置で即確定・暗幕タップ / Esc で閉じる)は変えていない。 */}
      {openPicker === "tuning" && (
        <ScrollPicker
          options={TUNING_HZ_OPTIONS} value={tuningHz}
          onChange={setTuningHz} onClose={() => setOpenPicker(null)}
          labelFn={(hz) => `${hz} Hz`}
        />
      )}
      {openPicker === "sax" && (
        <ScrollPicker
          options={SAX_TYPE_OPTIONS} value={saxType}
          onChange={setSaxType} onClose={() => setOpenPicker(null)}
          labelFn={(key) => SAX_PRESETS[key]?.label}
        />
      )}

      {/* 【A-5】テンポシート。テンポ数値のタップで下から開く。正典 = north-star-measure.html の
          「テンポシート」。中身は 大きな −/数値/＋ ・拍子12種 ・1拍の分割 ・(5/8・7/8だけ)拍グループ
          ・小節アクセント。**環は消さずに上へ重ねる**(以前は環と入れ替わっていた)。
          暗幕の色・カードの影は ScrollPicker / 保存確認と同値(新しい濃さを発明しない)。
          背景タップで閉じる。z-index 60 なので A-1 の背面レイヤには絶対に届かない。 */}
      {tempoSheetOpen && (
        <div
          role="dialog" aria-modal="true" aria-label="テンポと拍子"
          onClick={() => setTempoSheetOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.28)",
            display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center",
          }}
        >
          <div
            /* 【F-90】下スワイプで閉じる。テンポの直接入力(<input type=number>)の上では
                ジェスチャーを始めない(useSheetDismiss の除外に input が入っている)。 */
            ref={tempoSheetDismiss.ref} {...tempoSheetDismiss.handlers}
            onClick={(e) => e.stopPropagation()}
            /* 寸法は正典 .sheet をそのまま: border-radius 28px 28px 0 0 / padding 14px 24px 40px。
               下端だけ env(safe-area-inset-bottom) を足す(モックは静的なので安全域を持たないが、
               シートは下部ナビを覆うので実機ではホームインジケータに文字が乗る)。
               Chrome では inset=0 なので 40px ちょうど = モックと同値。 */
            style={{
              width: "100%", maxWidth: 900, background: "var(--c-surface)",
              borderRadius: "28px 28px 0 0", boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
              padding: "14px 24px",
              paddingBottom: "calc(40px + env(safe-area-inset-bottom))",
              display: "flex", flexDirection: "column", alignItems: "center",
            }}
          >
            {/* つまみ。ここをタップしても閉じる(背景タップと同じ動作を明示的に持たせる)。
                見た目は 36×4 の棒のまま、当たり判定だけ --tap-min 角にする(DESIGN-SYSTEM §5)。 */}
            <button
              onClick={() => setTempoSheetOpen(false)} aria-label="閉じる" className="no-select"
              style={{ width: "var(--tap-min)", height: "var(--tap-min)", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}
            >
              {/* 正典 .handle: 36×4 / border-radius 2px(4px高の棒なので --r-pill と同じ見え方) */}
              <span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--c-line-strong)", display: "block" }} />
            </button>

            {/* 大きな − / 数値 / ＋。数値のタップで直接入力に切り替わる(現行の機能を維持)。
                【逸脱2/3 の撤回】正典 .bpmrow / .pm / .bpmbig をそのまま:
                  行の gap 30 / ± は 62×62 の円で 1.5px の輪郭(--c-line-strong)・font-size 28・weight 300 /
                  数値は 76px。以前は §6.7(枠線は状態を持つ物だけ)と §4.1(7段スケール)に従って
                  地だけの B型 + --fs-hero(46px) にしていたが、見た目はモックが唯一の正典(§6.0)。 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 30 }}>
              <button
                onClick={() => setMetroTempo((v) => clampMetroTempo((Number(v) || 120) - 1))}
                aria-label="テンポを下げる" className="no-select"
                style={{ width: 62, height: 62, borderRadius: "50%", border: "1.5px solid var(--c-line-strong)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-ink-2)", fontSize: 28, fontWeight: 300, cursor: "pointer", lineHeight: 1, padding: 0, flexShrink: 0 }}
              >−</button>
              {tempoEditing ? (
                // Enterでの確定はカスタムkeydown判定ではなく、<form>のsubmit(ブラウザ標準機構、
                // number inputを含む単一フィールドのフォームはEnterで自動submitされる)に任せる。
                // フィールド外タップでの確定はonBlurで引き続き対応する。
                <form
                  onSubmit={(e) => { e.preventDefault(); setMetroTempo(clampMetroTempo(tempoInputRef.current?.value)); setTempoEditing(false); }}
                  style={{ display: "inline-block" }}
                >
                  <input
                    ref={tempoInputRef}
                    type="number" inputMode="numeric"
                    defaultValue={metroTempo}
                    onBlur={(e) => { setMetroTempo(clampMetroTempo(e.target.value)); setTempoEditing(false); }}
                    // 地・枠・角丸は index.css の入力欄の規則(B型: --c-sunken の地 + 見えない枠 + --r-xs)。
                    style={{ width: 150, height: 84, textAlign: "center", fontSize: 76, fontWeight: 600, fontFamily: "var(--font-num)", padding: "3px 0" }}
                  />
                </form>
              ) : (
                <button
                  onClick={() => setTempoEditing(true)} aria-label="テンポを直接入力"
                  className="num-tight no-select"
                  style={{ width: 150, height: 84, background: "none", border: "none", fontFamily: "var(--font-num)", fontSize: 76, fontWeight: 600, color: "var(--c-ink)", cursor: "pointer", padding: 0, lineHeight: 1 }}
                >{metroTempo}</button>
              )}
              <button
                onClick={() => setMetroTempo((v) => clampMetroTempo((Number(v) || 120) + 1))}
                aria-label="テンポを上げる" className="no-select"
                style={{ width: 62, height: 62, borderRadius: "50%", border: "1.5px solid var(--c-line-strong)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-ink-2)", fontSize: 28, fontWeight: 300, cursor: "pointer", lineHeight: 1, padding: 0, flexShrink: 0 }}
              >＋</button>
            </div>

            {/* 拍子12種(1/4〜12/8)。正典 .selrow どおり**6個ずつ2行**、行の gap は 7、
                1行目の上マージン 18 / 2行目 7。
                【逸脱1 の撤回】見た目は正典 .selpill / .selpill.on をそのまま:
                  非選択 = 1px の輪郭(--c-line-strong)・地なし・文字 --c-ink-2
                  選択中 = --c-accent の塗り + 白文字(枠は地と同色なので「塗り」に見える)
                以前は §6.7 の A型(状態は枠線の色だけ・地は足さない)にしていたが、
                見た目はモックが唯一の正典(§6.0)。
                【枠の書き方】選択中の枠は "1px solid transparent" にしてある。**描画は
                モックと同一**(背景は枠の下まで塗られるので、地と同色の枠と見分けられない)で、
                「枠と違う地を同じ状態で両方持たない」という構造だけを保っている。
                【タップ領域】見た目のピルは 44 に満たないので、外側の <button> が
                --tap-min の当たり判定を持ち、内側の <span> が見た目を持つ(DESIGN-SYSTEM §5)。 */}
            {[METRO_SIGS.slice(0, 6), METRO_SIGS.slice(6)].map((row, ri) => (
              <div key={ri} style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 7, marginTop: ri === 0 ? 18 : 7 }}>
                {row.map((sig) => (
                  <button key={sig} onClick={() => setMetroSig(sig)}
                    aria-pressed={metroSig === sig}
                    aria-label={`拍子 ${sig}`}
                    className="no-select"
                    style={{
                      minHeight: "var(--tap-min)", minWidth: "var(--tap-min)", padding: 0, background: "transparent", border: "none",
                      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12.5, padding: "4px 11px", borderRadius: 999, fontFamily: "var(--font-num)",
                      border: metroSig === sig ? "1px solid transparent" : "1px solid var(--c-line-strong)",
                      background: metroSig === sig ? "var(--c-accent)" : "transparent",
                      color: metroSig === sig ? "var(--c-on-accent)" : "var(--c-ink-2)",
                    }}>{sig}</span>
                  </button>
                ))}
              </div>
            ))}

            {/* 1拍の分割。**条件分岐は現行のまま**: X/4系は 1・2・3連・4、
                X/8系は「主拍のみ」と「8分音符で拍を埋める」の2択(複合拍子なら8分3つ=実質3連)。
                見た目は拍子と同じ正典 .selpill(選択中は塗り)。行の上マージンは正典の 14。 */}
            <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 7, marginTop: 14 }}>
              {metroSubdivOptions.map((s) => {
                const selected = metroSubdiv === s.value;
                return (
                  <button key={s.value} onClick={() => setMetroSubdiv(s.value)} aria-label={`分割 ${s.value}`}
                    aria-pressed={selected}
                    className="no-select"
                    style={{
                      minHeight: "var(--tap-min)", minWidth: "var(--tap-min)", padding: 0, background: "transparent", border: "none",
                      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      padding: "4px 11px", borderRadius: 999,
                      border: selected ? "1px solid transparent" : "1px solid var(--c-line-strong)",
                      background: selected ? "var(--c-accent)" : "transparent",
                    }}>
                      <SubdivNoteIcon value={s.icon ?? s.value} size={26} color={selected ? "#FFFFFF" : "#435266"} />
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 拍のグループ(8分音符の束ね方=主拍の区切り)は 5/8・7/8 のときだけ出す。 */}
            {(metroSig === "5/8" || metroSig === "7/8") && (() => {
              const choices = metroSig === "5/8" ? [[3, 2], [2, 3]] : [[3, 2, 2], [2, 3, 2], [2, 2, 3]];
              const cur = Array.isArray(metroGrouping) ? metroGrouping.join("+") : "";
              return (
                <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 7, marginTop: 7 }}>
                  {choices.map((g) => {
                    const label = g.join("+");
                    const selected = cur === label;
                    return (
                      <button key={label} onClick={() => setMetroGrouping(g)}
                        aria-pressed={selected}
                        aria-label={`拍のグループ ${label}`}
                        className="sans no-select" style={{
                          minHeight: "var(--tap-min)", minWidth: "var(--tap-min)", padding: 0, background: "transparent", border: "none",
                          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                        }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12.5, padding: "4px 11px", borderRadius: 999, fontFamily: "var(--font-num)",
                          border: selected ? "1px solid transparent" : "1px solid var(--c-line-strong)",
                          background: selected ? "var(--c-accent)" : "transparent",
                          color: selected ? "var(--c-on-accent)" : "var(--c-ink-2)",
                        }}>{label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* 小節アクセント(既定ON)。OFF にすると小節頭の強拍が鳴らず、
                振り子の点の膨らみも出なくなる(鳴っていないものを見せない)。 */}
            {/* 寸法・色は正典 .ckrow / .ck をそのまま: 行の上マージン 14 / gap 8 / 文字 12.5px /
                箱は 16×16・角丸4・紺の 1.5px 枠、チェック時は紺の塗り + 白いチェック。
                箱は 16px の絵のまま、当たり判定だけ 44×44 に広げる(reedCheckboxStyle。§5)。 */}
            <label className="sans no-select" style={{ alignSelf: "flex-start", marginTop: 14, minHeight: "var(--tap-min)", display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--c-ink-2)", cursor: "pointer" }}>
              <input
                type="checkbox" checked={metroAccent} onChange={(e) => setMetroAccent(e.target.checked)}
                style={reedCheckboxStyle(metroAccent, 16, CHECKBOX_OFF_ACCENT_IMG)}
              />
              小節アクセント
            </label>
          </div>
        </div>
      )}

      {/* 録音停止後: この録音を「登録」(セッションとして保存)するか「取り直し」(破棄)するか選ぶ。
          登録したセッションは分析タブから目安に設定することもできる。
          【背景タップでは閉じない】誤タップで録音を失わせないため、暗幕に onClick を付けない。
          どちらかを選べば registerPendingSession / discardPendingSession が pendingSession を
          null にするので、そのまま消える。保存・破棄のロジックには触っていない。
          暗幕の色・不透明度・カードの影は ScrollPicker と同値(新しい濃さを発明しない)。
          カードは下寄せ。画面中央に置くと環(top 147〜477)を覆ってしまうため、
          環と音名を隠さない位置=環の下・アクションの上に浮かせる。 */}
      {!isRecording && pendingSession && (
        <div
          role="dialog" aria-modal="true" aria-label="この録音を保存しますか？"
          style={{
            position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.28)",
            display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center",
            padding: "var(--sp-4)",
            paddingBottom: "calc(var(--page-bottom-gap) + var(--sp-4))",
          }}
        >
          <div style={{ width: "100%", maxWidth: 900, background: "var(--c-surface)", borderRadius: "var(--r-lg)", padding: "var(--sp-4)", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
            <div className="sans" style={{ fontSize: "var(--fs-lg)", fontWeight: 700, color: "var(--c-ink)" }}>この録音を保存しますか？</div>
            <div style={{ display: "flex", gap: "var(--sp-3)", marginTop: "var(--sp-4)" }}>
              {/* B型 = .ctl-plain + .ctl-pill。取り直しは状態を持たない普通のボタン */}
              <button
                onClick={discardPendingSession}
                className="sans ctl-plain ctl-pill"
                style={{ flex: 1, minHeight: "var(--tap-min)", color: "var(--c-ink-2)", fontSize: "var(--fs-md)", fontWeight: 600, cursor: "pointer" }}
              >
                取り直し
              </button>
              <button
                onClick={registerPendingSession}
                className="sans"
                style={{ flex: 1, minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)", border: "none", background: "var(--c-accent)", color: "var(--c-on-accent)", fontSize: "var(--fs-md)", fontWeight: 700, cursor: "pointer" }}
              >
                登録
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// フレーズのタイムライン+ドリルダウン表示。**呼び出しはセッション詳細の1箇所だけ**
// (旧コメントは「計測タブとの共通部品」と書いていたが、HEAD 時点で既に計測タブからの
// 呼び出しは無かった。審査役の指摘 2026/08/16 で訂正)。
// 理想値プロファイル自体の選択は計測タブの設定欄で行う前提のため、ここでは「基準」として
// 理想値/お手本セッション/(音高のみ)理論値のどれと比較するかだけを選ぶ。
// 【N-9 2026/08/16 本人指示】セッション詳細・分析(PIVOT)の <select> を「素のテキスト + ▾」へ
// 寄せるための共有部品。F-72(計測タブの上部設定行)/ PerformerSelector の bare 枝と同じ構造:
// 値は <span> が描き、その上に**透明なネイティブ <select> を枠全体に重ねる**。
//   ・<select> に値を描かせると箱の幅が「いちばん長い option」で決まり、▾ が値から離れる
//     (F-72 の実測 76.0px)。重ねる形は幅が値そのものになる
//   ・押せば必ず <select> 自身が開く(label タップの挙動のプラットフォーム差を構造ごと回避)
//   ・**中身のネイティブ <select> はそのまま**(iOS の実寸問題を新しく作らない。option の
//     選択 UI はネイティブのまま)
// 透明化は opacity ではなく color(opacity:0 だと :focus-visible の輪郭まで消える)。
// 当たり判定は §5 の 44px を minHeight で確保する(文字は中央寄せのまま)。
// 【D-2 2026/08/22】strong: 太字にするだけの任意指定(既定 false = 既存の呼び出しは 1px も変わらない)。
// 正典 #13a の3カラムセレクタは値が 600 で、3つの関係が一目で分かることを担っているため。
function PlainSelect({ text, value, onChange, children, ariaLabel, strong = false }) {
  return (
    <label style={{ position: "relative", display: "inline-flex", alignItems: "center", minHeight: "var(--tap-min)", minWidth: "var(--tap-min)", cursor: "pointer" }}>
      <span className="sans" style={{ color: "var(--c-ink)", fontSize: 12, fontWeight: strong ? 600 : 400, whiteSpace: "nowrap", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
      <PickChevron />
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={onChange}
        style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", padding: 0, color: "transparent", background: "none", appearance: "none", WebkitAppearance: "none", cursor: "pointer" }}
      >
        {children}
      </select>
    </label>
  );
}

function PhraseTimeline({ frames, noteEvents, selectedIdeal, NUM_HARMONICS, sessions, ownSessionId, barlines }) {
  const [timelineMetric, setTimelineMetric] = useState("pitch");
  const [referenceBasis, setReferenceBasis] = useState("theoretical"); // "theoretical"(音高のみ) | "ideal" | "session"
  const [selectedFrameIdx, setSelectedFrameIdx] = useState(null);
  const [referenceSessionId, setReferenceSessionId] = useState(null);
  const timelineScrollRef = useRef(null);

  // 音高以外の指標では理論値基準を選べないため、指標切替時に無効な組み合わせを補正する
  useEffect(() => {
    if (timelineMetric !== "pitch" && referenceBasis === "theoretical") {
      setReferenceBasis("ideal");
    }
  }, [timelineMetric, referenceBasis]);

  // スライダーでフレームを選ぶたびに、選択位置が常に見えるようグラフを横スクロールさせる
  // (グラフ幅はframes.length*6pxでコンテナ幅を超えることが多いため)。
  useEffect(() => {
    if (selectedFrameIdx === null) return;
    const container = timelineScrollRef.current;
    if (!container) return;
    const x = selectedFrameIdx * 6;
    container.scrollLeft = Math.max(0, x - container.clientWidth / 2);
  }, [selectedFrameIdx]);

  const referenceCandidates = (sessions || []).filter((s) => s.id !== ownSessionId && (s.frames?.length ?? 0) > 0);
  const referenceSession = referenceCandidates.find((s) => s.id === referenceSessionId) || null;

  // 自分とお手本、それぞれの最初の発音タイミング(noteEvents[0].startT)を基準に位置を揃え、
  // 「発音開始からの経過時間」が近いフレーム同士を対応づける(吹き始めのタイミングのズレを吸収する簡易アライメント)。
  const referenceLookup = useMemo(() => {
    if (!referenceSession) return null;
    const ownOnset = noteEvents?.[0]?.startT ?? 0;
    const refOnset = referenceSession.noteEvents?.[0]?.startT ?? 0;
    const refFrames = referenceSession.frames || [];
    return (frameT) => {
      const ownRel = frameT - ownOnset;
      let best = null;
      let bestDiff = Infinity;
      for (const rf of refFrames) {
        const diff = Math.abs((rf.t - refOnset) - ownRel);
        if (diff < bestDiff) { bestDiff = diff; best = rf; }
      }
      return bestDiff <= 0.2 ? best : null; // 200ms以上離れていたら対応フレームなしとみなす
    };
  }, [referenceSession, noteEvents]);

  // 比較対象(理想値 or お手本セッションの対応フレーム)を、noteIdealと同じ形({pitchHz, centroidHz, hnrDb, harmonicsProfile})に揃えて返す
  const getComparisonTarget = (frame) => {
    if (referenceBasis === "session") {
      if (!referenceLookup) return null;
      const refFrame = referenceLookup(frame.t);
      if (!refFrame) return null;
      return {
        pitchHz: refFrame.pitchHz,
        centroidHz: refFrame.spectralCentroidHz,
        hnrDb: refFrame.hnrDb,
        harmonicsProfile: refFrame.harmonics?.map((h) => ({ n: h.n, norm: h.levelNorm })),
      };
    }
    return getNoteIdeal(selectedIdeal, frame.semitoneIndex);
  };

  const metricOptions = [
    { key: "pitch", label: "ピッチ" },
    { key: "volume", label: "音量" },
    { key: "centroid", label: "重心" },
    { key: "hnr", label: "HNR" },
  ];

  // 音高だけ絶対値(平均律の正しいピッチ)との比較も選べる。それ以外の指標は理想値/お手本セッションのみ。
  const referenceOptions = timelineMetric === "pitch"
    ? [
        { key: "theoretical", label: "絶対値" },
        { key: "ideal", label: `目安${selectedIdeal ? `(${selectedIdeal.name})` : ""}` },
        { key: "session", label: "別セッション" },
      ]
    : [
        { key: "ideal", label: `目安${selectedIdeal ? `(${selectedIdeal.name})` : ""}` },
        { key: "session", label: "別セッション" },
      ];

  const getMetricValue = (frame) => {
    switch (timelineMetric) {
      case "pitch": return frame.pitchHz;
      case "volume": return frame.volumeDb;
      case "centroid": return frame.spectralCentroidHz;
      case "hnr": return frame.hnrDb;
      default: return null;
    }
  };

  // 比較対象(音ごとの理想値、またはお手本セッションの対応フレーム)は都度引き直してスコアを再計算する。
  // これにより、あとから理想値やお手本の選択を変えても、各瞬間ごとに正しい基準と比較できる。
  // 理論値基準は録音時の値のまま使う。
  const getMatchScore = (frame, kind) => {
    if (kind === "pitch" && referenceBasis === "theoretical") {
      return frame.matchScore?.pitch?.theoretical ?? 0;
    }
    const target = getComparisonTarget(frame);
    if (!target) return 0;
    if (kind === "timbre") {
      const harmNorm = frame.harmonics?.length === NUM_HARMONICS ? frame.harmonics.map((h) => h.levelNorm) : new Array(NUM_HARMONICS).fill(0);
      const idealHarmNorm = target.harmonicsProfile ? target.harmonicsProfile.map((h) => h.norm) : new Array(NUM_HARMONICS).fill(0);
      return timbreMatchScore(harmNorm, idealHarmNorm, frame.spectralCentroidHz, target.centroidHz, frame.hnrDb, target.hnrDb);
    }
    // kind === "pitch" && referenceBasis !== "theoretical"
    if (!frame.pitchHz || !target.pitchHz) return 0;
    return pitchMatchScore(centsBetween(frame.pitchHz, target.pitchHz));
  };

  const values = frames.map(getMetricValue).filter((v) => v !== null && v !== undefined && !isNaN(v));
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;
  const range = maxV - minV || 1;
  const selectedFrame = selectedFrameIdx !== null ? frames[selectedFrameIdx] : null;

  // 小節線(メトロノームのアクセント由来)の秒→x座標変換。フレームは約100ms間隔で
  // インデックスi→x=i*6に並ぶため、時刻tに最も近い前後フレームを見つけてxを線形補間する。
  const barlineXs = (() => {
    if (!barlines || barlines.length === 0 || frames.length < 2) return [];
    const xs = [];
    for (const bt of barlines) {
      // frames[i].t <= bt <= frames[i+1].t となるiを探す(単純な線形探索。小節数は多くない)
      if (bt < frames[0].t || bt > frames[frames.length - 1].t) continue;
      let i = 0;
      while (i < frames.length - 1 && frames[i + 1].t < bt) i++;
      const t0 = frames[i].t, t1 = frames[i + 1]?.t ?? t0;
      const frac = t1 > t0 ? (bt - t0) / (t1 - t0) : 0;
      xs.push((i + frac) * 6);
    }
    return xs;
  })();

  return (
    <>
      {/* 表示切り替え・比較基準。
          【N-9 2026/08/16 本人指示】カードの箱を廃止し、素の行にする(白地+罫の作法)。
          select は PlainSelect(素のテキスト + ▾。中身のネイティブ select はそのまま)。 */}
      <div style={{ marginBottom: 4, display: "flex", flexWrap: "wrap", gap: "0 10px", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
          <span className="sans" style={{ fontSize: 12, color: "#435266", flexShrink: 0 }}>表示:</span>
          <PlainSelect
            ariaLabel="タイムラインの指標"
            text={metricOptions.find((m) => m.key === timelineMetric)?.label ?? timelineMetric}
            value={timelineMetric} onChange={(e) => setTimelineMetric(e.target.value)}
          >
            {metricOptions.map((m) => (<option key={m.key} value={m.key}>{m.label}</option>))}
          </PlainSelect>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <span className="sans" style={{ fontSize: 12, color: "#435266", flexShrink: 0 }}>基準:</span>
          <PlainSelect
            ariaLabel="比較の基準"
            text={referenceOptions.find((o) => o.key === referenceBasis)?.label ?? referenceBasis}
            value={referenceBasis} onChange={(e) => setReferenceBasis(e.target.value)}
          >
            {referenceOptions.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
          </PlainSelect>
          {referenceBasis === "session" && (
            <PlainSelect
              ariaLabel="比較する別セッション"
              text={referenceSession ? formatYmd(referenceSession.recordedAt, { time: true }) : "別セッションを選択"}
              value={referenceSessionId || ""} onChange={(e) => setReferenceSessionId(e.target.value || null)}
            >
              <option value="">別セッションを選択</option>
              {referenceCandidates.map((s) => (
                <option key={s.id} value={s.id}>{formatYmd(s.recordedAt, { time: true })}{s.memo ? ` 「${s.memo}」` : ""}</option>
              ))}
            </PlainSelect>
          )}
        </div>
      </div>
      {referenceBasis === "session" && referenceSession && (
        <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginBottom: 10 }}>
          最初の発音タイミングを基準に自動で位置合わせして比較します
        </div>
      )}

      {/* タイムライン。【N-9】カードの箱 → 白地+上辺の罫1本(計測/リード/My Data と同じ文法) */}
      <div style={{ borderTop: "1px solid var(--c-rule)", padding: "10px 0", marginBottom: 10 }}>
        <div className="sans" style={{ fontSize: 12, color: "#435266", marginBottom: 8 }}>
          {/* 【F-98 2026/08/17 本人指示】「— ピッチ一致度で色分け（…基準）」の解説は削除。
              色分けの基準はすぐ上の「基準」セレクタが状態として示している(二度言いだった)。
              検出ノート数・平均アタックは解説ではなくデータなので残す。 */}
          タイムライン
          {noteEvents?.length > 0 && (() => {
            const attacks = noteEvents.map((e) => e.attackTimeMs).filter((v) => v !== null);
            const avg = attacks.length ? Math.round(attacks.reduce((a, b) => a + b, 0) / attacks.length) : null;
            return <span style={{ marginLeft: 8 }}>｜ 検出ノート {noteEvents.length}{avg !== null ? ` ・ 平均アタック ${avg}ms` : ""}</span>;
          })()}
        </div>
        <div ref={timelineScrollRef} style={{ overflowX: "auto" }}>
          <svg width={Math.max(600, frames.length * 6)} height="120" style={{ display: "block" }}>
            {/* 小節線(メトロノームのアクセント=小節頭。折れ線より先に描いて背面に置く) */}
            {barlineXs.map((x, k) => (
              <line key={`bar-${k}`} x1={x} y1={0} x2={x} y2={108} stroke="#C3CAD3" strokeWidth="1" />
            ))}
            <polyline
              fill="none" stroke="#174585" strokeWidth="1.5"
              points={frames.map((f, i) => {
                const v = getMetricValue(f);
                const y = v !== null && v !== undefined && !isNaN(v) ? 100 - ((v - minV) / range) * 90 : 100;
                return `${i * 6},${y}`;
              }).join(" ")}
            />
            {/* 検出した音名(記音)を時系列に沿って表示する(計測タブの折れ線と同様) */}
            {(() => {
              const labels = [];
              let curName = null, lastX = -100;
              frames.forEach((f, i) => {
                const nm = f.concertNote || f.matchedWrittenNote || null;
                if (nm && nm !== curName) {
                  const x = i * 6;
                  if (x - lastX >= 22) { labels.push({ name: nm, x }); lastX = x; }
                  curName = nm;
                } else if (!nm) curName = null;
              });
              return labels.map((l, k) => (
                <text key={k} x={l.x} y={9} fontSize="11" fontWeight="700" fill="#174585" fontFamily="var(--font-num)">{l.name}</text>
              ));
            })()}
            {frames.map((f, i) => {
              // 無音・測定外(ピッチ未検出)のフレームは一致度が定義できないためグレーにする
              // (以前はスコア0扱いで赤く表示され、測定できていない区間が「大きく外れている」ように見えていた)。
              const sounding = f.pitchHz != null && !isNaN(f.pitchHz);
              const color = sounding ? scoreToColor(getMatchScore(f, "pitch")) : "#C3CAD3";
              return (
                <rect key={i} x={i * 6} y={110} width={5} height={8} fill={color}
                  onClick={() => setSelectedFrameIdx(i)}
                  style={{ cursor: "pointer" }}
                />
              );
            })}
            {selectedFrameIdx !== null && (
              <line x1={selectedFrameIdx * 6 + 2.5} y1={0} x2={selectedFrameIdx * 6 + 2.5} y2={118} stroke="#121F32" strokeWidth="1" strokeDasharray="2,2" />
            )}
          </svg>
        </div>
        <input
          type="range" min={0} max={frames.length - 1}
          value={selectedFrameIdx ?? 0}
          onChange={(e) => setSelectedFrameIdx(Number(e.target.value))}
          style={{ width: "100%", marginTop: 8 }}
        />
        <div className="sans" style={{ fontSize: 12, color: "#8D95A1", display: "flex", justifyContent: "space-between" }}>
          <span>0s</span>
          <span>{frames[frames.length - 1]?.t.toFixed(1)}s</span>
        </div>
      </div>

      {/* ドリルダウン: 選択フレームの詳細。
          【N-9 2026/08/16 本人指示】カードと .tile の箱を廃止し、リード個体詳細の .numrow と
          同じ「枠も地も持たない数字の列」にする(寸法は BARE_ROW_STYLES.numrow から引く。
          数値を写さない)。一致度の機能色は数値の色が担う(従来の MetricCard と同じ考え)。 */}
      {selectedFrame && (
        <div style={{ borderTop: "1px solid var(--c-rule)", padding: "10px 0" }}>
          <div className="sans" style={{ fontSize: 12, color: "#435266", marginBottom: 10 }}>
            t = {selectedFrame.t.toFixed(2)}s の詳細
          </div>

          {(() => {
            const target = getComparisonTarget(selectedFrame);
            const noTargetLabel = referenceBasis === "session" ? "対応する別セッションの瞬間がありません" : "この音の目安が未登録";
            const cells = [
              { label: "ピッチ一致度", value: `${Math.round(getMatchScore(selectedFrame, "pitch") * 100)}%`, sub: selectedFrame.pitchHz ? `${selectedFrame.pitchHz.toFixed(1)} Hz ／ 記音${selectedFrame.matchedWrittenNote ?? "—"}` : "—", color: scoreToColor(getMatchScore(selectedFrame, "pitch")) },
              { label: "音色一致度(比較対象基準)", value: target ? `${Math.round(getMatchScore(selectedFrame, "timbre") * 100)}%` : "—", sub: target ? `重心 ${Math.round(selectedFrame.spectralCentroidHz)}Hz` : noTargetLabel, color: target ? scoreToColor(getMatchScore(selectedFrame, "timbre")) : undefined },
            ];
            return (
              <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 12 }}>
                {cells.map((c) => (
                  <div key={c.label} className="sans" style={{ flex: "1 1 0", minWidth: REED_NUMROW_MIN_PX, textAlign: "center" }}>
                    <div style={{ fontFamily: "var(--font-num)", fontSize: BARE_ROW_STYLES.numrow.value, fontWeight: 600, color: c.color || "var(--c-ink)" }}>{c.value}</div>
                    <div style={{ fontSize: BARE_ROW_STYLES.numrow.label, color: "var(--c-ink-3)" }}>{c.label}</div>
                    <div style={{ fontSize: BARE_ROW_STYLES.numrow.sub, color: "var(--c-ink-3)", minHeight: 15 }}>{c.sub ?? " "}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="sans" style={{ fontSize: 12, color: "#435266", marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span>音量: {selectedFrame.volumeDb?.toFixed(1)} dB</span>
            <span>HNR: {selectedFrame.hnrDb?.toFixed(1) ?? "—"} dB</span>
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================================
// リードの主観評価(総評 / 厚さ / バランス)の共通ルール。
//
// **総評だけ 1.0〜5.0 の 0.1 刻み(41段)**、厚さ・バランスは **1〜5 の整数(5段)**。
// (本人指示: 「厚さとバランスは五段階でいい」→ その後「総評だけは.1きざみでできるように」)
// 未評価はどれも **null**。
// **既存データは書き換えない**。読み取り時にだけ丸めてクランプし、ユーザーが実際に
// 値を変えたときだけ書き込む(壊してしまうと元の記録が復元できないため)。既に入っている
// 整数の総評(3)はそのまま有効な値で、表示だけ "3.0" になる。マイグレーションはしない。
//
// **0.1 刻みは2進小数で正確に表せない。** 生の値どうしを === で比べると
// 0.1*37 = 3.7000000000000006 のような値が「変わった」と判定され、
// 「開いただけで履歴が1件増える」バグが再発する(前の周で潰した挙動)。
// したがって総評は必ず normalizeReedRating(= Math.round(v*10)/10)を通してから比較する。
//
// 純関数として切り出してあるのは、scripts/pitch-test.mjs のハーネスが JSX を見ないため。
// 「同じ値なら履歴を増やさない」「未評価は線を繋がない」「縦軸は1〜5固定」といった
// 要件は、この層に置いてテストで押さえる。
// ============================================================================
const REED_SCORE_MIN = 1;
const REED_SCORE_MAX = 5;
const REED_SCORE_KEYS = ["rating", "thickness", "balance"];

// 総評の刻みと段数。1.0〜5.0 を 0.1 刻みで並べると 41 段。
const REED_RATING_STEP = 0.1;
const REED_RATING_STEPS_N = 41;

// ダイヤル(厚さ・バランス)・グラフ縦軸目盛の並び。**上が5・下が1**
// (本人指示: 「リードの総評ダイアルは上が5下が1」)。
// グラフの縦軸目盛も上から下へ同じ並びなので、同じ定数を共有する。
const RATING_DIAL_ORDER = [5, 4, 3, 2, 1];
// 総評のダイヤルの並び。同じく上が 5.0・下が 1.0 で、間を 0.1 刻みで埋めた41段。
// 各要素は Math.round(x*10)/10 を通してあり、normalizeReedRating の出す値と完全に一致する
// (一致していないと indexOf が -1 になり、選んだ値へスクロール位置を合わせられない)。
const RATING_DIAL_RATING_ORDER = Array.from({ length: REED_RATING_STEPS_N }, (_, i) => Math.round((REED_SCORE_MAX - i * REED_RATING_STEP) * 10) / 10);
// 【N-5】ダイヤルの**先頭に「—」(未評価)を1段足す**(本人指示 / 正典の「評価ダイヤル」ミニ:
// 「各列の端に『—』(未評価)を追加。未計測の初期表示と同じ記号で、評価の取り消しもできる」)。
// 値は null。reedScoreText(key, null) が "—" を返すので、表示側に分岐は要らない。
// **RATING_DIAL_ORDER 自体には足さない**: この定数は評価の推移グラフの縦軸目盛(1〜5固定)と
// 共有しており、null を混ぜると目盛が1本増えて軸が壊れる。ダイヤル専用の並びをここで作る。
const RATING_DIAL_UNRATED = null;
const RATING_DIAL_ORDER_WITH_UNRATED = [RATING_DIAL_UNRATED, ...RATING_DIAL_ORDER];
const RATING_DIAL_RATING_ORDER_WITH_UNRATED = [RATING_DIAL_UNRATED, ...RATING_DIAL_RATING_ORDER];
// ダイヤル1行の高さ。行そのものがタップ選択の当たり判定なので --tap-min(44px)。DESIGN-SYSTEM §5。
const RATING_DIAL_ITEM_H = 44;
// ダイヤルの窓の高さ(行数換算)。**5行ぶん**。
// 【注意】「5行ぶんの高さ」であって「常に5段が見える」ではない。選択行を中央に合わせるため
// 上下に (窓高 - 行高)/2 = 88px の padding があり、**一度に見える段数は選択位置で変わる**。
// 実測(375px・窓220px): 選択が中央(3)なら5段、その隣(2 / 4)なら4段、端(1 / 5)なら3段。
// つまり F-13 の「1と2がスクロールでしか選べない」は、**値が5のときは今も起きる**。
// 3行のときはどの選択位置でも3段だったので窓は広がっているが、解消はしていない。
const RATING_DIAL_VISIBLE = 5;
// 【N-5 で削除】REED_SCORE_NEUTRAL(未評価のとき指を置く位置=中央の 3)。
// ダイヤルの先頭に「—」(未評価)の段ができたので、未評価はその段に置く。
// 参照が 0 件になった定数は残さない。

// 評価値を 1〜5 の整数に正規化する(厚さ・バランス)。0 / null / undefined / 数値でないものは未評価(null)。
function normalizeReedScore(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(REED_SCORE_MIN, Math.min(REED_SCORE_MAX, Math.round(n)));
}
// 総評を 1.0〜5.0 の 0.1 刻みに正規化する。**丸めはここが唯一の場所**で、
// 比較も表示も保存もすべてこの出力を使う(生の値どうしを比べない)。
function normalizeReedRating(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const r = Math.round(n / REED_RATING_STEP) * REED_RATING_STEP; // 刻みに乗せる
  return Math.max(REED_SCORE_MIN, Math.min(REED_SCORE_MAX, Math.round(r * 10) / 10)); // 乗せた結果の2進誤差を落とす
}
// 項目ごとの正規化。総評だけ 0.1 刻み、厚さ・バランスは整数。
function normalizeReedScoreOf(key, v) {
  return key === "rating" ? normalizeReedRating(v) : normalizeReedScore(v);
}
// 項目ごとのダイヤルの並び。**先頭は必ず「—」(未評価 = null)**。
function ratingDialOrder(key) {
  return key === "rating" ? RATING_DIAL_RATING_ORDER_WITH_UNRATED : RATING_DIAL_ORDER_WITH_UNRATED;
}
// 表示用の文字列。**総評は常に小数第1位まで**(3 は "3.0")。厚さ・バランスは整数。
// 未評価は "—"。
function reedScoreText(key, v) {
  const n = normalizeReedScoreOf(key, v);
  if (n === null) return "—";
  return key === "rating" ? n.toFixed(1) : String(n);
}

// 履歴1件の読み取り。旧形式 { value, at }(総評だけの履歴)は value を rating として読み、
// 厚さ・バランスは未評価とみなす。新形式は { at, rating, thickness, balance }。
function reedHistoryEntry(h) {
  if (!h) return { at: null, rating: null, thickness: null, balance: null };
  const raw = Object.prototype.hasOwnProperty.call(h, "rating") ? h.rating : h.value;
  return {
    at: h.at ?? null,
    rating: normalizeReedRating(raw),           // 総評は 0.1 刻み
    thickness: normalizeReedScore(h.thickness), // 厚さ・バランスは整数
    balance: normalizeReedScore(h.balance),
  };
}

// 履歴の「同じ日」を判定するためのローカル暦日キー(YYYY-MM-DD)。
// **表示用の reedScoreDateLabel(M/D)を判定に流用してはいけない**。年が落ちるので
// 2025-08-08 と 2026-08-08 が同じ日に見え、1年前の記録を上書きしてしまう。
// UTC(toISOString)でもいけない。JST では日本時間 8/9 00:30 が UTC 8/8 になり、
// 「日付が変わったのに上書きされる / 変わっていないのに増える」が両方起きる。
// 読めない日時は null を返す。null 同士は「同じ日」とみなさない
// (normalizeRatingHistory が捨てる壊れた記録を、上書きに巻き込まないため)。
function reedRatingDayKey(at) {
  const d = new Date(at);
  if (isNaN(d.getTime())) return null;
  return localDayKey(d); // 組み立ては localDayKey ただ1箇所(リードの開封日と共有)
}

// 履歴配列を読み取り用に正規化する(日時が読めないものは捨て、古い順に並べる)。
function normalizeRatingHistory(list) {
  return (list || [])
    .map(reedHistoryEntry)
    .filter((h) => h.at && !isNaN(new Date(h.at).getTime()))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

// 評価の確定。**値が1つも変わっていなければ null を返す**(ページを開いただけ・同じ値で
// ダイアログを閉じただけでは何も書かない)。変わっていれば、変わった項目だけを patch し、
// 履歴には**3つ全部の現在値を1エントリ**として積む(グラフで同じx点に3本が揃うため)。
// 直前の記録と3つとも同じなら履歴は増やさない。
// **同じカレンダー日(ローカル)の記録が既にあれば、積まずにそれを置き換える(F-61)。**
// 本人指示「リード評価遷移は同じ日付に変更があった場合は上書きされる仕組みに変更」。
// その日の最後の評価だけが残り、グラフの x 軸に同じ日付が2つ並ばなくなる。
function commitReedScores(reed, next, at) {
  const cur = {}, norm = {};
  for (const k of REED_SCORE_KEYS) {
    // 総評は 0.1 刻みに丸めてから入れる。丸めずに比べると 0.1*37 のような値が
    // 「変わった」と判定され、開いただけで履歴が増える(§冒頭のコメント)。
    cur[k] = normalizeReedScoreOf(k, reed ? reed[k] : null);
    norm[k] = normalizeReedScoreOf(k, next ? next[k] : null);
  }
  // 3つとも見る。どれか1つでも変わっていれば patch を返し、履歴は1件だけ積む。
  const changed = REED_SCORE_KEYS.filter((k) => norm[k] !== cur[k]);
  if (changed.length === 0) return null;
  const patch = {};
  for (const k of changed) patch[k] = norm[k];
  const list = (reed && reed.ratings) || [];
  const last = list.length ? reedHistoryEntry(list[list.length - 1]) : null;
  const same = last && REED_SCORE_KEYS.every((k) => last[k] === norm[k]);
  if (!same) {
    const day = reedRatingDayKey(at);
    const entry = { at, ...norm };
    // 同じ暦日の最初の記録の位置。そこへ新しい値を置き、同じ日の記録は全部落とす
    // (古いデータに同じ日が2件以上ある場合もここで1件にまとまる)。
    // 落とす前の位置 hit より前の記録は必ず別の日なので、kept の中でも同じ添字に入る。
    // 時刻は新しい方(at)にするので、昇順に並べ直しても順序は壊れない。
    const hit = day === null ? -1 : list.findIndex((h) => reedRatingDayKey(h && h.at) === day);
    if (hit === -1) {
      patch.ratings = [...list, entry];
    } else {
      const kept = list.filter((h) => reedRatingDayKey(h && h.at) !== day);
      patch.ratings = [...kept.slice(0, hit), entry, ...kept.slice(hit)];
    }
  }
  return patch;
}

// ダイヤルのスクロール位置 ⇄ 値。並び(上が5)がそのまま index になる。
// key を渡さなければ整数のダイヤル(厚さ・バランス)、"rating" なら 0.1 刻み41段。
function ratingDialValueAt(scrollTop, itemH, key) {
  const order = ratingDialOrder(key);
  const i = Math.max(0, Math.min(order.length - 1, Math.round(scrollTop / itemH)));
  return order[i];
}
// 【N-5】未評価(null)は**中央(3)ではなく先頭の「—」**に置く。
// 「—」が並びに入ったので、未評価のまま開いたダイヤルは「—」を指したまま止まる。
// これで「開いて閉じただけで 3 が入る」経路がそもそも生まれない
// (以前は中央の 3 に置いていたので、位置合わせ由来の scroll を確定に使わない
//  ratingDialScrollIsUser だけが唯一の歯止めだった。歯止めは残してある)。
function ratingDialOffsetFor(value, itemH, key) {
  const order = ratingDialOrder(key);
  const v = normalizeReedScoreOf(key, value);
  return Math.max(0, order.indexOf(v)) * itemH;
}
// そのscrollイベントを「指で動かした」とみなしてよいか。
// 表示位置を合わせるために自分で scrollTop を代入したぶん(syncTarget)は確定に使わない。
// 使ってしまうと、未評価(null)のダイヤルを中央(3)に置いた時点で 3 が選ばれたことになり、
// 「開いて閉じただけで履歴が増える」(項目6違反)状態になる。
function ratingDialScrollIsUser(scrollTop, syncTarget) {
  if (syncTarget === null || syncTarget === undefined) return true;
  return Math.abs(scrollTop - syncTarget) > 1;
}

// ============================================================================
// 評価の経時変化グラフの座標。縦軸は **1〜5 で固定**(データに応じて伸縮させない。
// DESIGN-SYSTEM §7「数値の自動フルスケール描画」をしない)。yAt はデータを引数に取らない
// ので、値の分布が変わっても目盛の位置は動かない。
// ============================================================================
const REED_SCORE_PLOT_H = 94; // 作図高さ。リード比較の折れ線と同じ

function reedScoreY(v, padTop, plotH) {
  const t = (v - REED_SCORE_MIN) / (REED_SCORE_MAX - REED_SCORE_MIN);
  return padTop + plotH - t * plotH;
}
// 横軸は記録1件につき1点。1件しかないときは中央に置く(端に貼り付くと欠けて見える)。
function reedScoreX(i, n, x0, x1) {
  if (n <= 1) return (x0 + x1) / 2;
  return x0 + (i * (x1 - x0)) / (n - 1);
}
// 未評価(null)を欠測として扱い、連続して値がある区間の index 列に分ける。
// 区間をまたいで線を引かないことで「評価していない期間」を繋がないようにする。
function reedScoreSegments(values) {
  const segs = [];
  let cur = [];
  for (let i = 0; i < (values || []).length; i++) {
    const v = values[i];
    if (v === null || v === undefined) { if (cur.length) segs.push(cur); cur = []; }
    else cur.push(i);
  }
  if (cur.length) segs.push(cur);
  return segs;
}
// 日付ラベルの間引き幅。隣り合うラベルの中心間に need px 要る。
function reedScoreLabelStep(colStep, need, n) {
  if (n <= 1) return 1;
  if (colStep <= 0) return Math.max(1, n);
  return Math.max(1, Math.ceil(need / colStep));
}
function reedScoreDateLabel(at) {
  const d = new Date(at);
  if (isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 箱(同じ銘柄・番手・使用開始日の群)の平均総評。**総評そのものと同じ 0.1 刻みに丸める**(F-62)。
// 丸めずに星へ渡すと、4.0 / 4.1 / 4.1 の箱が 4.0666… で塗られ、隣に出ている title の
// 「4.1」と星の塗りが別の値を指す。丸めは総評の正規化(normalizeReedScoreOf の "rating")に
// 任せる。**ここで新しい丸めを書かない**(刻みが2箇所に分かれると必ず食い違う)。
// 未評価しかない箱は null(呼び出し側が★ごと出さない)。
function reedGroupAvgRating(members) {
  const rated = (members || [])
    .map((m) => (m ? m.rating : null))
    .filter((v) => v !== null && v !== undefined);
  if (!rated.length) return null;
  return normalizeReedScoreOf("rating", rated.reduce((a, b) => a + b, 0) / rated.length);
}

// 【N-5 で削除】StarRating(★5つを部分的に塗って小数の評価を表す部品)。
// 正典は箱見出しも比較の一覧も **「★3.8」という文字**で書いており、星の絵は1つも出てこない。
// リードタブが唯一の読み手だったので、寄せ切った時点で参照が0件になった。
// 副次的に、この部品が肯定的な評価に機能色 --c-warn(#D97706)を流用していた
// DESIGN-SYSTEM §1.5 違反も消えた(意図した効果ではなく、撤去に伴う結果)。

// (入力シークバー RatingSlider はここにあった。今周で ReedScoreEditor を3ダイヤル化した
//  時点で呼び出し元がゼロになったので削除した。
//  ＊直前の HEAD(80bf314)までは死にコードではなく**出荷されていた**。厚さ・バランスが
//    SCORE_FIELDS の kind:"slider" で、ReedScoreEditor がこの要素を実際に描いており、
//    HEAD のバンドル dist/assets/index-u8DNZPZS.js には type:"range" が3箇所あった
//    (現行は2箇所＝ノイズゲートのしきい値と再生位置スクラバだけ)。
//    「元から死にコードだった」という以前のコメントは誤りだったので訂正しておく。)

// 評価の入力ダイヤル1列ぶん。**上が5・下が1**(本人指示)。
// 並び順は ratingDialOrder(itemKey) が唯一の答え(総評=0.1刻み41段 / 厚さ・バランス=整数5段)。
// 行の高さは --tap-min(44px)で、スクロールでも行タップでも選べる
// (スクロールが効かない環境でも操作できるようにする)。
// 窓の高さは RATING_DIAL_VISIBLE(5行ぶん=220px)。ただし選択行を中央に合わせる padding が
// 上下に付くので、**一度に見える段数は選択位置による**(中央=5段 / 隣=4段 / 端=3段)。
// 厚さ・バランスでも、値が5や1のときは他の段を選ぶのにスクロールが要る。
// 幅は列いっぱい(100%)。3列を横に並べる側(ReedScoreEditor)が列幅を決める。
// 確定はダイアログを閉じたときに1回だけ行うので、ここでは onCommit を持たない。
function RatingDial({ itemKey, value, onChange }) {
  const ref = useRef(null);
  const ITEM = RATING_DIAL_ITEM_H;
  const VISIBLE = RATING_DIAL_VISIBLE;
  const height = ITEM * VISIBLE;
  const v = normalizeReedScoreOf(itemKey, value);
  const settleRef = useRef(null);
  const selfScrollRef = useRef(false);
  // 表示位置を合わせるために**自分で**動かしたスクロール量。ここから来た scroll イベントは
  // 確定に使わない。これが無いと、未評価(null)のダイヤルを中央(3)に置くだけで scroll が飛び、
  // 「開いただけで3が入る」= 変更していないのに履歴が増える、という状態になる。
  const syncTargetRef = useRef(null);
  // 外から値が変わった時だけスクロール位置を合わせる(自分のスクロール由来なら何もしない)
  useEffect(() => {
    const el = ref.current;
    if (!el || selfScrollRef.current) return;
    const target = ratingDialOffsetFor(v, ITEM, itemKey);
    if (Math.abs(el.scrollTop - target) > 1) { syncTargetRef.current = target; el.scrollTop = target; }
  }, [v, ITEM, itemKey]);
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const isUser = ratingDialScrollIsUser(el.scrollTop, syncTargetRef.current);
    syncTargetRef.current = null;
    if (!isUser) return; // 位置合わせぶん。指で動かしたものではないので確定しない
    const next = ratingDialValueAt(el.scrollTop, ITEM, itemKey);
    selfScrollRef.current = true;
    if (next !== v) onChange(next);
    clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => { selfScrollRef.current = false; }, 400);
  };
  useEffect(() => () => clearTimeout(settleRef.current), []);
  const pick = (s) => {
    const el = ref.current;
    if (el) { syncTargetRef.current = ratingDialOffsetFor(s, ITEM, itemKey); el.scrollTop = syncTargetRef.current; }
    onChange(s);
  };
  return (
    // data-noswipe: 縦スクロールする列なので、横スワイプ(SwipeBackArea / SwipePager)に掴ませない
    <div style={{ position: "relative", height, width: "100%", flexShrink: 0 }} data-noswipe>
      <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: ITEM, marginTop: -ITEM / 2, background: "var(--c-accent-tint)", border: "1px solid var(--c-accent-line)", borderRadius: "var(--r-xs)", pointerEvents: "none" }} />
      <div
        ref={ref}
        onScroll={onScroll}
        data-noswipe
        style={{ position: "absolute", inset: 0, overflowY: "auto", scrollSnapType: "y mandatory", padding: `${(height - ITEM) / 2}px 0`, boxSizing: "border-box", WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}
      >
        {ratingDialOrder(itemKey).map((s) => {
          const on = s === v;
          return (
            <button
              /* 先頭の「—」は値が null なので key={s} だと React に「キー無し」と読まれる。
                 String(null) = "null" は他のどの段(数値)とも衝突しない。 */
              key={String(s)}
              type="button"
              onClick={() => pick(s)}
              aria-pressed={on}
              aria-label={s === RATING_DIAL_UNRATED ? "未評価に戻す" : undefined}
              style={{ display: "block", width: "100%", height: ITEM, minHeight: "var(--tap-min)", scrollSnapAlign: "center", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-num)", fontSize: "var(--fs-lg)", fontWeight: on ? 700 : 400, color: on ? "var(--c-accent)" : "var(--c-ink-4)" }}
            >
              {reedScoreText(itemKey, s)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 評価を編集するダイアログ。**過渡的な告知は流れから外す**(DESIGN-SYSTEM §6.1.5)ため
// position:fixed で浮かせる。インラインで開くと下の要素が押し下げられる。
// 暗幕の色・不透明度・カードの影は ScrollPicker / 保存確認ダイアログと同値
// (rgba(15,23,42,0.28) / 0 8px 24px rgba(15,23,42,0.18))。新しい濃さを発明しない。
// 破棄されて困る情報は無いので、保存確認と違い**背景タップで閉じてよい**。
// 【document.body へポータルする理由】position:fixed の基準(包含ブロック)は、祖先に
// transform / will-change / filter があるとその祖先に移る。この画面は SwipeBackArea の
// 子孫で、スワイプ中は祖先に transform が乗る。DOM上そのまま置くと暗幕が画面全体ではなく
// 祖先の矩形(0,0,375x812 → 44,65,347x700)になり、下部ナビが触れてしまう(審査役の実測)。
// ポータルで木の外に出せば、祖先の transform と無関係に常に画面全体を覆う。
//
// 【3項目3列】生年月日ピッカーと同じで、1回開けば総評・厚さ・バランスの3つとも回せる
// (本人指示: 「タップすると生年月日みたいに一度で三つともダイヤルでるように」)。
// 列の並びは表示(ReedScoreField)と同じ 総評 / 厚さ / バランス。
// 寸法(375px実機): 暗幕の padding --sp-4 → パネル343、パネルの padding --sp-4 → 内側311、
// 3列 + gap --sp-2×2 = (311-16)/3 = 98.33px/列。完了ボタンは幅いっぱい(311×44)。
// 「完了」は1つだけ。背景タップでも閉じる。確定(履歴への記録)は閉じたとき1回。
function ReedScoreEditor({ fields, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="評価を編集"
      onClick={onClose}
      data-noswipe
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.28)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--sp-4)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-noswipe
        style={{ width: "100%", maxWidth: 900, background: "var(--c-surface)", borderRadius: "var(--r-lg)", padding: "var(--sp-4)", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}
      >
        <div className="sans" style={{ fontSize: "var(--fs-lg)", fontWeight: 700, color: "var(--c-ink)" }}>評価</div>
        {/* 3列は折り返さない。flexWrap は初期値と同じ nowrap だが、明示して要件にする */}
        <div style={{ display: "flex", flexWrap: "nowrap", gap: "var(--sp-2)", marginTop: "var(--sp-4)" }}>
          {fields.map((f) => (
            // data-noswipe: 縦スクロールする列。付けないと横スワイプと喧嘩する
            <div key={f.key} data-noswipe style={{ flex: "1 1 0", minWidth: 0 }}>
              <div className="sans" style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", textAlign: "center", marginBottom: "var(--sp-1)" }}>{f.label}</div>
              <RatingDial itemKey={f.key} value={f.value} onChange={f.set} />
            </div>
          ))}
        </div>
        <button
          type="button" onClick={onClose} className="sans"
          data-noswipe
          style={{ width: "100%", minHeight: "var(--tap-min)", marginTop: "var(--sp-4)", borderRadius: "var(--r-pill)", border: "none", background: "var(--c-accent)", color: "var(--c-on-accent)", fontSize: "var(--fs-md)", fontWeight: 700, cursor: "pointer" }}
        >
          完了
        </button>
      </div>
    </div>,
    document.body,
  );
}

// 評価表示の1行に並べる要素。**渡された項目を1つも落とさず**、それぞれの表示文字列・
// 区切りの有無・未評価かどうかまでここで決める。
// JSX 側は返り値をそのまま map するだけにしてある。理由: scripts/pitch-test.mjs の
// ハーネスは JSX を見ないので、行の中身を JSX に書くと「3つ並んでいること」を
// 正規表現でしか見られず、fields.slice(0,1).map(…) の1文字の変異が素通りする
// (実際に審査役の変異が生き残った)。ここに出しておけば実行で数えられる。
// (F-65 で1枚の枠を3枚のカードに分けたので、「先頭以外の左に区切り罫」を表していた
//  sep は返さなくなった。カードとカードの間の隙間が区切りを担う。)
function reedScoreRowItems(fields) {
  return (fields || []).map((f) => ({
    key: f.key,
    label: f.label,
    text: reedScoreText(f.key, f.value),
    rated: normalizeReedScoreOf(f.key, f.value) !== null,
  }));
}

// 通常時の評価表示。**総評 / 厚さ / バランスを1行に横並び**にし、行のどこを押しても
// 同じ1つのダイアログが開く(本人指示: 「同列に横一列にしてタップすると…一度で三つとも」。
// DESIGN-SYSTEM §6.4)。各列は**見出しの下に数字**を積む(本人指示)。
// 3列は flex:1 1 0 + minWidth:0 で**等幅**にする。
// 行全体が1つのタップ対象。値が入っても未評価でも高さは変わらない(§6.1.5)。
// ★は出さない(本人指示: 「厚さは星不要」)。
// 中身は reedScoreRowItems の返り値をそのまま並べる。ここで slice / filter しない。
//
// 【F-65】本人指示「総評と厚さとバランスの数字枠を、**色と配置はそのまま**でカード3枚に
// 分割表示に変更」。1枚の枠に3列(境は1px罫)だったものを、**3枚の枠**にした。
//  - 色は変えていない: 枠の地は今までどおり B型の --c-sunken、見出しは --c-ink-2、
//    数字は評価済み --c-accent / 未評価 --c-ink-3。角丸も型の既定(--r-xs)のまま。
//  - 並び順も変えていない: 総評 → 厚さ → バランス(reedScoreRowItems が渡された順を守る)。
//  - **B型(.ctl-plain)を外側のボタンから3枚のカードへ移した。** 外側は地も枠も持たない
//    透明な当たり判定になる(「測定」ボタンと同じ書き方)。
//    面の作法(§6.6 の .card / .tile)は使わない。**これは群ではなく操作するもの**で、
//    §6.6 自身が「操作するものの見た目は §6.7 が決める。面の作法は操作するものに触らない」
//    と書いているため。罫の作法の .tile は塗りを持たないので、使うと地の色が消えて
//    「色はそのまま」に反する。
//  - 以前は「余白なく三等分」(本人指示)で列の間に隙間を置かなかったが、隙間が無いと
//    3枚が1枚に戻って見える。カード間にだけ --sp-2 を入れ、3枚の幅は等しいまま保つ。
// 【N-5】見た目を正典 .starrow に揃えた。**箱(B型 .ctl-plain の地)は持たない**:
//   行 = padding 16px 0 + 下に罫1本 / 列 = flex:1 の中央揃え
//   値 = 23px / 600(.starrow .v) / ラベル = 11px --ink3 で**値の下**(.starrow .l)
// 【本人の旧指示との差】F-65 の「見出しの下に数字」「地はそのまま」は、正典では
// 逆順(数字の下に見出し)・地なしになっている。DESIGN-SYSTEM §6.0 が
// 「モックと本書の既存規定が食い違う場合は無条件でモックが勝つ」と定めているので正典に寄せた。
// 未評価の色分け(--c-accent / --c-ink-3)は残す(値の有無が読めなくなるため)。
function ReedScoreField({ fields, onOpen }) {
  return (
    <button
      type="button" onClick={onOpen} className="sans"
      aria-label="総評・厚さ・バランスを編集"
      style={{
        display: "flex", alignItems: "stretch", flexWrap: "nowrap", gap: 0,
        width: "100%", minHeight: "var(--tap-min)", padding: "16px 0",
        background: "none", border: "none", borderBottom: "1px solid var(--c-line)",
        borderRadius: 0, cursor: "pointer",
      }}
    >
      {reedScoreRowItems(fields).map((it) => (
        <span
          key={it.key}
          style={{
            flex: "1 1 0", minWidth: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: 0,
          }}
        >
          <span style={{ fontFamily: "var(--font-num)", fontSize: 23, fontWeight: 600, lineHeight: 1.2, color: it.rated ? "var(--c-accent)" : "var(--c-ink-3)" }}>
            {it.text}
          </span>
          <span style={{ fontSize: 11, color: "var(--c-ink-3)", marginTop: 1 }}>{it.label}</span>
        </span>
      ))}
    </button>
  );
}

// 奏者選択。「自分」固定 + 登録済みの名前 + 「名前を入力」で新規追加できる可変プルダウン。
// 一度追加した名前はperformersに積み上がり、以後の選択肢として残り続ける。
// セッション(またはライブ録音直後のフレーム列)を理想値プロファイルに設定するボタン。
// onSave(session, name, scope) を呼び、実際のプロファイル生成は buildIdealProfileFromSessions が行う。
// tapMin: 当たり判定を --tap-min(44px) 以上にする(既定は従来どおり。分析タブ側は変えない)。
// 計測タブの「解析が完了しました」告知は浮かせた告知の中に入るため、ここだけ44pt化する。
//
// 【F-67】名前の入力はポップアップ(下寄せの暗幕モーダル)に移した。
// 以前はこの場で入力欄+保存+×に化けており、押した瞬間に日付欄の隣の要素が入れ替わって
// 行の中身が動いていた(DESIGN-SYSTEM §6.1.5「何かを開いても既にあった要素は1pxも動かない」に反する)。
// モーダルは position:fixed でレイアウトの流れから外れるので、押しても周囲は動かない。
//
// 【F-67 型の変更 B型 → A型】このボタンは「理想値設定中 / 未設定」という**状態を持つ**ように
// なったので、§6.7 の A型(.ctl-state = 枠線 --c-line-strong / 地は透明、ON は枠線の色だけ
// --c-accent)が該当する。B型(.ctl-plain = 枠なし・地 --c-sunken)のままだと、状態を返せるのは
// 地か文字だけになり「枠線があるものは状態を持っている」という読み手への約束から外れる。
// ON の合図に地は足さない(足すと A型が「枠線+違う地」になり規則そのものを破る)。
function SetAsIdealButton({ session, sessions, selectedIdeal, onSave, tapMin }) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("session"); // "session" | "performer"(F-68)

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setIsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  const frames = session?.frames || [];
  if (frames.length === 0) return null;

  // 由来を持たない古いプロファイルでは false になる(クラッシュさせず「設定中」を出さないだけ)
  const isSet = isSessionInIdeal(selectedIdeal, session);
  // F-68 の2択に添える件数。選別は selectPerformerSessions が唯一の答えを持つ(画面側で数え直さない)
  const performerCount = selectPerformerSessions(sessions, session).length;

  const confirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(session, trimmed, scope);
    setName("");
    setScope("session");
    setIsOpen(false);
  };

  const scopeOptions = [
    { key: "session", label: "このセッション", count: 1 },
    { key: "performer", label: "この奏者の平均", count: performerCount },
  ];

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="sans ctl-state ctl-pill"
        aria-pressed={isSet}
        style={{
          fontSize: tapMin ? "var(--fs-sm)" : "var(--fs-xs)",
          minHeight: tapMin ? "var(--tap-min)" : undefined,
          padding: tapMin ? "0 var(--sp-3)" : "5px 10px",
          color: "var(--c-accent)", cursor: "pointer", fontWeight: 600,
          flexShrink: 0, whiteSpace: "nowrap",
        }}
      >
        {/* 和文5文字ぶんで揃えてある(目安に設定 / 目安設定中)。
            文字数が変わるとボタンの幅が変わり、右寄せの行で左端が動く */}
        {isSet ? "★ 目安設定中" : "★ 目安に設定"}
      </button>
      {isOpen && createPortal(
        // 体裁は pendingSession の保存確認・マイク許可エラーと同じ(暗幕 rgba(15,23,42,0.28) /
        // zIndex 60 / 下寄せ / カードは --c-surface + --r-lg + 影)。新しい濃さを発明しない。
        // 【document.body へポータルする理由】position:fixed の基準は祖先に transform があると
        // そちらへ移る。この画面は SwipeBackArea の子孫で、スワイプ中は祖先に transform が乗る
        // (ReedScoreEditor と同じ理由)。
        // 【stopPropagation を使わない】暗幕とカードの当たりは e.target === e.currentTarget で
        // 見分ける。伝播を止めると、document に張られた復旧用のジェスチャー監視まで殺してしまう。
        <div
          role="dialog" aria-modal="true" aria-label="目安に設定"
          data-noswipe
          onClick={(e) => { if (e.target === e.currentTarget) setIsOpen(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.28)",
            display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center",
            padding: "var(--sp-4)",
            paddingBottom: "calc(var(--page-bottom-gap) + var(--sp-4))",
          }}
        >
          <div data-noswipe style={{ width: "100%", maxWidth: 900, background: "var(--c-surface)", borderRadius: "var(--r-lg)", padding: "var(--sp-4)", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
            <div className="sans" style={{ fontSize: "var(--fs-lg)", fontWeight: 700, color: "var(--c-ink)" }}>目安に設定</div>
            {/* 【F-68】対象の2択。選択中かどうかという**状態を持つ**ので A型(.ctl-state)。
                状態は枠線の色だけで返す(地は足さない)。件数はそれぞれの選択肢に添える。 */}
            <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-3)" }}>
              {scopeOptions.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setScope(o.key)}
                  className="sans ctl-state"
                  aria-pressed={scope === o.key}
                  style={{
                    flex: 1, minWidth: 0, minHeight: "var(--tap-min)", padding: "var(--sp-2)",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: "var(--sp-1)", cursor: "pointer",
                    color: scope === o.key ? "var(--c-accent)" : "var(--c-ink-2)",
                    fontSize: "var(--fs-sm)", fontWeight: 600,
                  }}
                >
                  <span>{o.label}</span>
                  <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", fontWeight: 400 }}>{o.count}セッション</span>
                </button>
              ))}
            </div>
            <input
              type="text" placeholder="目安の名前" value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
              className="sans"
              style={{ width: "100%", marginTop: "var(--sp-3)", minHeight: "var(--tap-min)", padding: "0 var(--sp-3)", fontSize: "var(--fs-md)" }}
            />
            <div style={{ display: "flex", gap: "var(--sp-3)", marginTop: "var(--sp-4)" }}>
              {/* B型 = .ctl-plain + .ctl-pill。キャンセルは状態を持たない普通のボタン */}
              <button
                onClick={() => setIsOpen(false)}
                className="sans ctl-plain ctl-pill"
                style={{ flex: 1, minHeight: "var(--tap-min)", color: "var(--c-ink-2)", fontSize: "var(--fs-md)", fontWeight: 600, cursor: "pointer" }}
              >
                キャンセル
              </button>
              {/* 塗りの強調ボタン(§6.7 の意図した例外5)。名前が空のときは押しても何も起きない
                  ので disabled にする(§6.1.5「押しても何も起きない」を作らない)。 */}
              <button
                onClick={confirm}
                disabled={!name.trim()}
                className="sans"
                style={{ flex: 1, minHeight: "var(--tap-min)", borderRadius: "var(--r-pill)", border: "none", background: "var(--c-accent)", color: "var(--c-on-accent)", fontSize: "var(--fs-md)", fontWeight: 700, cursor: "pointer", opacity: name.trim() ? 1 : 0.45 }}
              >
                保存
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// 【F-72 の適用範囲】この部品は**共有**で、計測タブの上部設定行と
// **セッション詳細の識別情報行**の2箇所から呼ばれる。
// F-72(地と枠を落として ▾ を添える)は**計測タブだけ**の話なので、`bare` で明示的に選ぶ:
//   bare 無し(既定) … 入力欄の規則そのまま(地 --c-sunken / ネイティブの ▼)。
//                      セッション詳細はこちら。**N-6 が未着手で、北極星モックは
//                      この画面を描いていない**ので §6.0 の「モックが勝つ」は及ばず、
//                      §6.7 の B型(入力欄は地を持つ)が現に有効。隣のリード <select> と
//                      同じ行に並ぶので、片方だけ作法を変えると1行に2種類の入力欄が混ざる。
//   bare 指定     … 正典 .set1 の「自分 ▾」。計測タブだけがこちらを渡す。
// **既定を bare 側にしないこと。** 既定を変えると、次に呼び出しを増やした画面へ
// 黙って計測タブの作法が漏れる(F-72 の1周目で実際にセッション詳細へ漏れた)。
// id も呼び出し側から渡す(部品の中に画面名を直書きすると、名前と事実がずれる)。
function PerformerSelector({ performers, selectedPerformer, setSelectedPerformer, setPerformers, disabled, bare = false, selectId }) {
  const [addingName, setAddingName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const options = ["自分", ...performers];

  const confirmAdd = () => {
    const name = addingName.trim();
    if (!name) return;
    setPerformers((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setSelectedPerformer(name);
    setAddingName("");
    setIsAdding(false);
  };

  if (isAdding) {
    return (
      <div style={{ pointerEvents: "auto", display: "flex", gap: 4, alignItems: "center" }}>
        <input
          type="text" autoFocus placeholder="名前を入力" value={addingName}
          onChange={(e) => setAddingName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") confirmAdd(); if (e.key === "Escape") { setIsAdding(false); setAddingName(""); } }}
          className="sans"
          style={{ padding: "5px 8px", fontSize: 12, width: 110 }}
        />
        <button onClick={confirmAdd} className="sans" style={{ fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "none", background: "#174585", color: "var(--c-on-accent)", cursor: "pointer" }}>追加</button>
        <button onClick={() => { setIsAdding(false); setAddingName(""); }} style={{ background: "none", border: "none", color: "#8D95A1", cursor: "pointer", fontSize: 12 }}>×</button>
      </div>
    );
  }

  if (!bare) {
    return (
      /* 既定の見た目。**HEAD のまま一切変えていない**(セッション詳細はここを使う)。
         地・枠・角丸は index.css の入力欄の規則(B型)が持つ。
         pointerEvents は既定値そのもの。計測タブの上部設定行は .tap-through(index.css)の
         中にあり箱ごと当たり判定を捨てているので、入力欄はここで明示的に取り戻す。 */
      <select
        value={selectedPerformer}
        onChange={(e) => { if (e.target.value === "__add__") setIsAdding(true); else setSelectedPerformer(e.target.value); }}
        disabled={disabled}
        style={{ pointerEvents: "auto" }}
      >
        {options.map((name) => (<option key={name} value={name}>{name}</option>))}
        <option value="__add__">＋ 名前を入力...</option>
      </select>
    );
  }

  return (
    /* 【F-72・計測タブだけ】正典 design/north-star-measure.html の .set1 は「自分 ▾」=
       **地も枠も持たない素のテキスト + ▾**。入力欄の規則(index.css)が付ける地 --c-sunken を
       落とし、▾ を添える。

       【差し戻し①で作りを変えた: 値をテキストで描き、その上に透明な <select> を重ねる】
       <select> に値を描かせると、**箱の幅が「いちばん長い option」で決まる**ため
       (Blink/WebKit 共通の内在サイズ規則。この構造そのものはエンジンに依らない)、
       値が短いときに ▾ が右へ大きく離れる。375×812 の実測:
         「自分」の右端 47.0 / ▾ 123.0-131.4 / 「Alto」の左端 141.4
         → **自分のラベルから 76.0px、隣の Alto から 10.0px** で、近接の原則から
           ▾ が Alto の記号に見えていた(本人指示「▾ があればタップすれば選択肢が出ると
           直感的に分かる」を満たさない)。
         幅の内訳も実測: option が「自分 + ＋名前を入力...」なら 105px、
         「＋名前を入力...」だけでも 105px、「自分」だけなら 42px。**長い option が幅を決めている。**
       重ねる形にすると (a) 箱の幅が option に引きずられず、値のすぐ隣に ▾ が来る
       (b) 枠のどこを押しても **<select> 自身**が押されるので、N-4 の罠5
       (「label を押して選択リストが開くか」はプラットフォーム依存)を構造ごと回避できる。
       ※ px 値は Chrome 実測。<select> の寸法・タップ時の挙動は
         LOOP.md「Chrome で判定できない類」なので **iOS Safari は実機待ち**。
       ※ 透明化は opacity ではなく `color: transparent` を使う。opacity:0 にすると
         :focus-visible の輪郭まで消えてキーボード操作の焦点が見えなくなる。
         色で消せることは同じ行のリードの <select>(color で文字色を出し分けている)で確認済み。
       ※ 近接(「▾ と自分の値の距離 < ▾ と隣の項目の距離」)は Node のハーネスには書けない
         (書体の字幅が無い)。**検査では縛っていない**。実測値と手順はこのコメントが持つ。 */
    <label
      htmlFor={selectId}
      style={{ pointerEvents: "auto", position: "relative", display: "inline-flex", alignItems: "center", height: TOPSET_PERFORMER_H_PX, flexShrink: 0, cursor: disabled ? "default" : "pointer" }}
    >
      {/* 見えている値。色は <select> が持っていたのと同じ --c-ink(見た目は変えない)。
          【幅の上限は**持たせない**。理由を書く】リード枠(maxWidth 110 / 60)と違い、
          ここは枠の中に続く要素が ▾ しか無く、上限が無ければ箱の幅は値そのものになる。
          flex の項目は重ならないので、名前が長いときは行が伸びて
          上部設定行の overflowX:auto で横スクロールするだけ(隣の Alto・442Hz を押すが重ならない)。
          HEAD も <select> の固有幅が最長 option で決まっていたので同じ伸び方をしていた = 退行ではない。
          **上限を付けるなら「何 px か」を決める必要があり、それは本人の決めごと**なので、
          発明せずに現状(上限なし)を維持する。
          overflow / textOverflow は上限を持ったときに効くよう入れてある(今は無効)。 */}
      <span style={{ color: "var(--c-ink)", whiteSpace: "nowrap", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{selectedPerformer}</span>
      <PickChevron />
      <select
        id={selectId}
        value={selectedPerformer}
        onChange={(e) => { if (e.target.value === "__add__") setIsAdding(true); else setSelectedPerformer(e.target.value); }}
        disabled={disabled}
        style={{ pointerEvents: "auto", position: "absolute", left: 0, top: 0, width: "100%", height: "100%", padding: 0, color: "transparent", background: "none", appearance: "none", WebkitAppearance: "none", cursor: disabled ? "default" : "pointer" }}
      >
        {options.map((name) => (<option key={name} value={name}>{name}</option>))}
        <option value="__add__">＋ 名前を入力...</option>
      </select>
    </label>
  );
}

// ============================================================================
// 【N-5】リードタブの正典の実寸。
// 正典 = design/north-star-measure.html の「リードタブ」3画面(登録一覧 / 個体詳細 / 比較)と
// ミニ2枚(追加シート / 評価ダイヤル)。DESIGN-SYSTEM §6.0「見た目はモックが唯一の正典」。
// 対応する CSS クラス: .rlist / .rgroup / .rhead / .rname / .rmeta / .rgrid / .tile /
//                      .addrow / .addbtn / .starrow / .memoline / .bigbtn / .numrow
// ============================================================================
// 正典 .rlist / .subtabs の左右 padding。.app-root が既に 14px 持っているので、
// リードタブの中身には**差分だけ**を足す(app-root 側は他タブと共有なので触らない)。
const REED_APP_SIDE_PAD_PX = 14;  // .app-root の左右 padding(安全域 env() は別に足される)
const REED_SIDE_PAD_PX = 24;      // 正典 .rlist / .subtabs
const REED_LIST_EXTRA_PAD_PX = REED_SIDE_PAD_PX - REED_APP_SIDE_PAD_PX;

const REED_GRID_COLS = 5;         // 正典 .rgrid grid-template-columns: repeat(5,1fr)
const REED_GRID_GAP_PX = 10;      // 正典 .rgrid gap
const REED_TILE_FS_PX = 14;       // 正典 .tile font-size
// タイルの角丸(12px)・枠(1.2px)・4段の濃さは index.css の .reedtile が持つ
// (地と枠を1箇所にまとめないと §6.7 の芯1 を守れないため)。ここには重複して置かない。
const REED_HEAD_MB_PX = 14;       // 正典 .rhead margin-bottom
const REED_GROUP_PAD_TOP_PX = 20; // 正典 .rgroup padding-top
const REED_GROUP_PAD_BOTTOM_PX = 24; // 正典 .rgroup padding-bottom
// (【F-111 2026/08/17 本人指示】REED_ADDROW_PAD_TOP_PX = 正典 .addrow の padding-top は
//  ここにあったが、一覧末尾の「＋ 追加」を右下に浮かせるボタン(案D)へ移して読み手が
//  無くなったので削除した。使い手の無い定義を残さない。)
const REED_SUBTAB_GAP_PX = 18;       // 正典 .subtabs gap(隣り合う子タブの文字の間隔)
// 子タブの当たり判定を 44px にするために左右へ入れる余白。左右あわせて gap と同じ量になるので、
// 行の gap を 0 にすれば**文字の間隔は正典の 18px のまま**当たり判定だけ広がる。
const REED_SUBTAB_HALF_GAP_PX = REED_SUBTAB_GAP_PX / 2;
// 個体詳細の .numrow の1列に与える最小幅。**折り返しの判定にだけ効く**値で、
// 通常時(4列)の見た目は変わらない(4×60 = 240 ≤ 327)。
// 1列がグラフに切り替わって幅100%になったとき、残りの3列を次の行へ送るために要る。
const REED_NUMROW_MIN_PX = 60;

// タイルの「濃さ」は index.css の .reedtile[data-tone] が4段持つ。
//   ret   = ごく薄い (正典 .tile.ret)  / plain = 既定 (正典 .tile)
//   data  = 濃い枠   (正典 .tile.data) / sel   = 紺の塗り (正典 .tile.sel)
// ここでは「どの段になるか」だけを決める。
//
// 個体1枚の濃さを、**そのリードについて残っている記録の量**だけで決める。
// 記録が増えるほど濃くなる(DESIGN-SYSTEM §7「育てる」= 数値が静かに増えるだけ)。
//   測定データがある            → data (濃い枠)
//   測定は無いが主観評価がある  → plain(既定)
//   何の記録も無い              → ret  (ごく薄い)
// **新しいフラグ(引退など)は作らない。** 既にあるデータだけで濃さを決める。
// 純関数にしてあるのは、scripts/pitch-test.mjs のハーネスが JSX を見ないため。
function reedTileTone(hasData, rated) {
  if (hasData) return "data";
  if (rated) return "plain";
  return "ret";
}

// グリッド上の指の位置から、掴んでいるタイルの落ちる位置(index)を出す。
// cols 列・1マス cellW×cellH・間隔 gap の格子として読む。
// 端はクランプし、最後の行の空きマスへ落とそうとしたら末尾に寄せる。
// 純関数(座標だけで決まる)にしてあるので、テストが実行で確かめられる。
function gridDropIndex(x, y, gridLeft, gridTop, cellW, cellH, gap, cols, count) {
  const stepX = cellW + gap;
  const stepY = cellH + gap;
  if (!(stepX > 0) || !(stepY > 0) || cols < 1 || count < 1) return 0;
  const col = Math.max(0, Math.min(cols - 1, Math.floor((x - gridLeft) / stepX)));
  const row = Math.max(0, Math.floor((y - gridTop) / stepY));
  return Math.max(0, Math.min(count - 1, row * cols + col));
}

// 長押しが成立するまでの時間と、その間に許す移動量。**現行の 400ms / 8px をそのまま引き継ぐ**
// (行の並び替えで本人が慣れている感触を変えない)。判定だけ縦から2次元(距離)に広げる。
const REED_DRAG_LONGPRESS_MS = 400;
const REED_DRAG_SLOP_PX = 8;

// 【F-79b】入れ替えで避ける側のタイルが新しいマスへ滑る動き。
// **新しい値を発明していない**: DESIGN-SYSTEM §6.3 が定める唯一の「元の位置へ戻す動き」
// (`transform 0.32s cubic-bezier(.22,.61,.36,1)` / 後始末 320ms)と同じ値をそのまま採る。
// 定数を別に立てるのは、横スワイプの戻りを調整したときにタイルまで巻き添えにしないため。
const REED_TILE_SLIDE_EASE = "transform 0.32s cubic-bezier(.22,.61,.36,1)";
const REED_TILE_SETTLE_MS = 320;
// 正典 .tile.drag の浮き上がり。指との相対位置は掴んだ瞬間からこのぶんだけ一定にずれる
// (ドラッグ中に値が変わらないので「指からずれる」原因にはならない)。
const REED_TILE_LIFT_PX = 6;
const REED_TILE_DRAG_DEG = -2;

// 【F-79b】タイル1枚の見た目(transform / transition / 前後関係)を決める純関数。
// **iPhone のアプリ並べ替えと同じ使用感**にするための要点はここ1箇所に閉じている。
//
//   drag = null                      … 並び替えていない。全部素の位置
//   drag = { id, grabX, grabY, pointerX, pointerY, cells, settling }
//     grabX/grabY … 掴んだ瞬間の「指 − タイル左上」のずれ。**最後まで変えない**
//     cells       … 掴んだ瞬間に実測した各マスの左上座標(index 順)。ドラッグ中は変わらない
//     settling    … 指を離してから落ち切るまで
//   home … そのタイルが**DOM 上で**占めているマス(ドラッグ中は凍結する)
//   cur  … 並び替え後の論理的な位置
//
// 掴んでいるタイル: `指 − ずれ − home のマスの左上`。
//   **home は入れ替えが起きても動かない**(DOM の並びを凍結してあるため)ので、
//   入れ替えのたびに基準を取り直す必要が無い＝指からずれない。
//   N-5 の実装は「掴んだ点からの移動量」をそのまま transform に入れており、入れ替えで
//   タイルのレイアウト位置が動くと、その動いたぶんだけ丸ごと指からずれていた(本人報告)。
// それ以外のタイル: `cur のマス − home のマス`を transition 付きで。避けて動くのがこれ。
function reedTileVisual(drag, id, home, cur) {
  if (!drag || !drag.cells) return { transform: "none", transition: "none", zIndex: 1 };
  const homeCell = drag.cells[home];
  const curCell = drag.cells[cur >= 0 ? cur : home];
  if (!homeCell || !curCell) return { transform: "none", transition: "none", zIndex: 1 };
  if (id === drag.id && !drag.settling) {
    const x = drag.pointerX - drag.grabX - homeCell.left;
    const y = drag.pointerY - drag.grabY - homeCell.top - REED_TILE_LIFT_PX;
    return { transform: `translate(${x}px, ${y}px) rotate(${REED_TILE_DRAG_DEG}deg)`, transition: "none", zIndex: 2 };
  }
  const x = curCell.left - homeCell.left;
  const y = curCell.top - homeCell.top;
  // 落ちていくタイルだけ rotate(0deg) を明示する。関数リストの形を揃えないと
  // `translate(…) rotate(-2deg)` からの補間が効かず、角度がぱちんと戻る。
  const rot = id === drag.id ? " rotate(0deg)" : "";
  return { transform: `translate(${x}px, ${y}px)${rot}`, transition: REED_TILE_SLIDE_EASE, zIndex: id === drag.id ? 2 : 1 };
}

// 【N-5】5×2 のタイル。長押し(400ms)で持ち上がり、ドラッグで並び替える。
// 正典 .rgrid / .tile / .tile.drag。
//
// 【行(ReorderableReedRows)から置き換えた】旧実装は縦1次元で、掴んだ行の移動量を
// 行高で割って行数を出していた。タイルは横にも動くので、**指の座標がグリッドのどのマスに
// あるか**で落ちる位置を決める(gridDropIndex)。
//
// 【持ち上がりが見て分かること】GripLines の目印はタイルに載らないので、長押しが成立した
// 瞬間に正典 .tile.drag の見た目(translateY(-6px) rotate(-2deg) + 影 + 枠が紺)へ変える。
// 指を動かす前から変わるので、「持ち上がった」ことが動かさなくても分かる。
//
// 【横スワイプとの同居】タイルのドラッグは横にも動くため、軸では SwipePager と棲み分けられない。
// 長押し成立の瞬間に setReedTileDragActive(true) を立て、SwipePager 側が降りる。
// 指を離す/中断すると必ず false に戻す(endDrag / abortDrag が唯一の出口)。
// 【F-79a】旗を立てるだけでは足りなかった。ブラウザが縦スクロールを引き取ると pointercancel が
// 飛んでドラッグが死に、そこから SwipePager が息を吹き返す。**非パッシブの touchmove を張って
// preventDefault する**(DESIGN-SYSTEM §6.3 と同じ作法)。長押しが成立するまで指は 8px しか
// 動いていないので、この時点ではまだブラウザはスクロールを始めていない＝止められる。
// `touch-action` は祖先に敷くと子孫の横スクロールが死ぬ(§6.3)ので、**掴んだタイル自身にだけ**
// ドラッグ中 "none" を当てる(この1枚に横スクロールする子孫は無い)。
//
// 【F-79b】DOM の並びはドラッグ中**凍結**する。動くのは transform だけ。
// 掴んだタイルのレイアウト位置が最後まで変わらないので、入れ替えが起きても指からずれない。
function ReedTileGrid({ members, reeds, sessions, selectedReedId, deleteMode, noDrag = false, selectedForDelete, onTileTap, onReorder }) {
  const [order, setOrder] = useState(() => members.map((m) => m.id));
  // drag: null | { id, baseOrder, cells, grabX, grabY, pointerX, pointerY, settling }
  const [drag, setDrag] = useState(null);
  const longPressTimerRef = useRef(null);
  const dragInfoRef = useRef(null);
  const orderRef = useRef(order);
  const gridRef = useRef(null);
  const settleTimerRef = useRef(null);

  useEffect(() => { orderRef.current = order; }, [order]);
  useEffect(() => { setOrder(members.map((m) => m.id)); }, [members]);

  const membersById = new Map(members.map((m) => [m.id, m]));
  // **ドラッグ中は drag.baseOrder で描く**(= DOM の並びを凍結する)。並び替えの結果は
  // order にだけ入れ、見た目は transform で表す。指を離して落ち切ってから DOM を並べ直す。
  const renderIds = drag ? drag.baseOrder : order;
  const orderedMembers = renderIds.map((id) => membersById.get(id)).filter(Boolean);

  const cancelLongPress = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  };
  const cancelSettle = () => {
    if (settleTimerRef.current) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
  };
  const detachNativeListeners = () => {
    const info = dragInfoRef.current;
    if (info?.onMove) {
      window.removeEventListener("pointermove", info.onMove);
      window.removeEventListener("pointerup", info.onUp);
      window.removeEventListener("pointercancel", info.onUp);
      window.removeEventListener("touchmove", info.onTouchMove);
    }
  };
  // ドラッグ中に(削除モードへの切り替え等で)アンマウントされてもリスナーと旗が残らないようにする
  useEffect(() => () => {
    cancelLongPress();
    cancelSettle();
    detachNativeListeners();
    setReedTileDragActive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 指を離した(または pointercancel で中断された)。**並び順の確定はここで即座に行い**、
  // 落ちる動きは見た目だけにする。確定を待たせると、落ちている 320ms の間に
  // アンマウントされたとき並び替えが消える。
  // 中断も確定として扱うのは HEAD と同じ(finishDrag(true) が pointercancel からも呼ばれていた)。
  // 「中断なら元へ戻す」に変えるのは挙動の変更なので、この周ではしない。
  const endDrag = () => {
    detachNativeListeners();
    cancelLongPress();
    dragInfoRef.current = null;
    setReedTileDragActive(false);
    cancelSettle();
    setDrag((d) => (d ? { ...d, settling: true } : null));
    settleTimerRef.current = setTimeout(() => { settleTimerRef.current = null; setDrag(null); }, REED_TILE_SETTLE_MS);
    onReorder(orderRef.current);
  };

  // 並び替えを起動できるか。**タップで詳細を開けるかとは別**。
  // 削除モード中はタップが選択のトグルになるので、その場合だけ pointer 系を丸ごと降ろす。
  // 【F-102】番号編集モード(noDrag)中は長押しの並び替えを起動しない(タップ=番号編集に一本化)。
  const canReorder = !deleteMode && !noDrag && members.length >= 2;

  const handlePointerDown = (id, index) => (e) => {
    // 落ちている最中に次のジェスチャーが来たら、その場で落とし切ってから始める
    // (落下の transform を残したまま新しいドラッグを重ねると基準が二重になる)。
    if (settleTimerRef.current) { cancelSettle(); setDrag(null); }
    if (deleteMode) return;                       // 削除モード中は onClick が選択を担う(現行と同じ方針)
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    const target = e.currentTarget;
    cancelLongPress();
    // **1枚しかない箱でもここは通す。** 通さないと handlePointerUp が
    // 「押していない」と判断してタップが死に、詳細を開けなくなる(実測で踏んだ)。
    // 並び替える先が無いときは長押しのタイマーだけ張らない。
    // lastX/lastY は長押しが成立するまでの指の現在位置(スロップ 8px の内側で動きうる)。
    // 掴んだ瞬間のずれはここから採る。押した点から採ると、成立の瞬間に最大 8px 跳ねる。
    dragInfoRef.current = { armed: false, startX, startY, lastX: startX, lastY: startY, id, index };
    if (!canReorder) return;
    longPressTimerRef.current = setTimeout(() => {
      const pending = dragInfoRef.current;
      if (!pending) return;
      const rect = target.getBoundingClientRect();
      const grid = gridRef.current?.getBoundingClientRect();
      // 各マスの左上を実測して控える。**マスの位置はドラッグ中ずっと変わらない**
      // (DOM の並びを凍結するので、動くのは「どのタイルがどのマスに見えるか」だけ)。
      const cells = Array.from(gridRef.current?.children || []).map((el) => {
        const cr = el.getBoundingClientRect();
        return { left: cr.left, top: cr.top };
      });
      const info = {
        armed: true, id,
        cellW: rect.width, cellH: rect.height,
        gridLeft: grid ? grid.left : rect.left, gridTop: grid ? grid.top : rect.top,
      };

      const onMove = (ev) => {
        ev.preventDefault();
        setDrag((d) => (d && !d.settling ? { ...d, pointerX: ev.clientX, pointerY: ev.clientY } : d));
        const targetIndex = gridDropIndex(
          ev.clientX, ev.clientY, info.gridLeft, info.gridTop,
          info.cellW, info.cellH, REED_GRID_GAP_PX, REED_GRID_COLS, orderRef.current.length);
        setOrder((prev) => {
          const currentIndex = prev.indexOf(info.id);
          if (currentIndex === -1 || currentIndex === targetIndex) return prev;
          const next = [...prev];
          const [moved] = next.splice(currentIndex, 1);
          next.splice(targetIndex, 0, moved);
          return next;
        });
      };
      const onUp = () => endDrag();
      // ブラウザにスクロールを引き取らせない(§6.3 の作法)。引き取られると pointercancel で
      // ドラッグが死に、そのまま SwipePager が子タブを動かしにかかる(F-79a の症状)。
      const onTouchMove = (ev) => { if (ev.cancelable) ev.preventDefault(); };

      info.onMove = onMove;
      info.onUp = onUp;
      info.onTouchMove = onTouchMove;
      dragInfoRef.current = info;
      setReedTileDragActive(true);   // ここから先は横スワイプで子タブを動かさない
      setDrag({
        id,
        baseOrder: [...orderRef.current],
        cells,
        grabX: pending.lastX - rect.left,
        grabY: pending.lastY - rect.top,
        pointerX: pending.lastX,
        pointerY: pending.lastY,
        settling: false,
      });
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
    }, REED_DRAG_LONGPRESS_MS);
  };

  // 長押し成立前だけ使う。**2次元の距離**で見る(タイルは横にも並ぶので、縦だけ見ていると
  // 横に払ったスワイプが長押しとして生き残る)。
  const handlePointerMove = (e) => {
    const info = dragInfoRef.current;
    if (!info || info.armed) return;
    info.lastX = e.clientX; info.lastY = e.clientY;
    if (Math.hypot(e.clientX - info.startX, e.clientY - info.startY) > REED_DRAG_SLOP_PX) {
      cancelLongPress();
      dragInfoRef.current = null;
    }
  };
  // 長押しが成立せずに指が離れた=ただのタップ。成立していれば window の onUp が確定する。
  const handlePointerUp = (id) => () => {
    const info = dragInfoRef.current;
    if (!info || info.armed) return;
    cancelLongPress();
    dragInfoRef.current = null;
    onTileTap(id);
  };
  const handlePointerCancel = () => {
    const info = dragInfoRef.current;
    if (info?.armed) return;
    cancelLongPress();
    dragInfoRef.current = null;
  };

  return (
    <div
      ref={gridRef}
      style={{ display: "grid", gridTemplateColumns: `repeat(${REED_GRID_COLS}, 1fr)`, gap: REED_GRID_GAP_PX }}
    >
      {orderedMembers.map((r, home) => {
        const isDragging = drag?.id === r.id;
        // home = DOM 上のマス(ドラッグ中は凍結) / cur = 並び替え後の論理位置。
        // 見た目のずれは reedTileVisual がこの2つから決める。
        const cur = drag ? order.indexOf(r.id) : home;
        const vis = reedTileVisual(drag, r.id, home, cur);
        const idx = home;
        const tone = deleteMode
          ? (selectedForDelete?.has(r.id) ? "sel" : reedTileTone(sessions.some((s) => s.reedId === r.id), normalizeReedRating(r.rating) !== null))
          : (r.id === selectedReedId ? "sel"
            : reedTileTone(sessions.some((s) => s.reedId === r.id), normalizeReedRating(r.rating) !== null));
        return (
          /* no-select: 長押しで並び替えを起動するので、同じ長押しがテキスト選択に化けないようにする(F-49)。 */
          <button
            key={r.id}
            type="button"
            /* 地・枠・角丸・文字色は index.css の .reedtile が持つ(型と同じ扱い)。
               ここに書くとインラインがクラスより強く、濃さの4段が丸ごと効かなくなる。 */
            className="no-select reedtile"
            data-tone={tone}
            data-drag={isDragging ? "true" : "false"}
            aria-label={`${reedPosition(r, reeds) ?? idx + 1}枚目`}
            aria-pressed={deleteMode ? !!selectedForDelete?.has(r.id) : undefined}
            onPointerDown={handlePointerDown(r.id, idx)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp(r.id)}
            onPointerCancel={handlePointerCancel}
            onClick={deleteMode ? () => onTileTap(r.id) : undefined}
            style={{
              /* 正典 .tile の寸法。aspect-ratio 1 なので幅は .rgrid の 1fr が決める */
              aspectRatio: "1",
              fontSize: REED_TILE_FS_PX, fontFamily: "var(--font-num)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 0, cursor: "pointer", position: "relative",
              /* 正典 .tile.drag の浮き上がり(-6px / -2deg)と、指への追従・入れ替えで避ける動きは
                 すべて reedTileVisual が決める。影と紺の枠は .reedtile[data-drag] が持つ。 */
              transform: vis.transform,
              transition: vis.transition,
              zIndex: vis.zIndex,
              /* 掴んでいる1枚だけ none。祖先には敷かない(§6.3: 祖先の touch-action は
                 子孫の横スクロールを殺す)。ドラッグしていない間は従来どおり pan-y。 */
              touchAction: isDragging ? "none" : "pan-y",
            }}
          >
            {reedPosition(r, reeds) ?? idx + 1}
          </button>
        );
      })}
    </div>
  );
}

// 値の行は折り返し禁止+高さ固定にする。桁数が変わるたびに「-18.2 dB」が1行に収まったり
// 単位だけ折り返したりしてカードの高さが変わり、画面全体が上下にブレるのを防ぐ。
// unitを渡すと数値より小さい字で添える(狭いカードでも1行に収まりやすくする)。
function MetricCard({ label, value, unit, sub, accentColor }) {
  return (
    // 面の作法は .tile が持つ(background / border / borderRadius をここに書かない)。
    // accentColor(一致度の機能色)は枠ではなく**数値の色**が担う。枠に出すには
    // インラインで border を書くしかなく、それをやると作法ごと効かなくなるため。
    <div className="tile">
      <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-num)", fontSize: 22, fontWeight: 600, marginTop: 2, color: accentColor || "#121F32", whiteSpace: "nowrap", height: 28, lineHeight: "28px", overflow: "hidden" }}>
        {value}
        {unit && <span className="sans" style={{ fontSize: 12, color: "#8D95A1", marginLeft: 3, fontWeight: 400 }}>{unit}</span>}
      </div>
      {/* subは常に高さを確保して描画する(値が出たり消えたりで行がガタつかないように)。
          内容が無い時も空行として場所だけ残す。 */}
      <div className="sans" style={{ fontSize: 12, color: "#174585", marginTop: 2, height: 15, lineHeight: "15px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub ?? " "}</div>
    </div>
  );
}

// ============================================================
// Reeds view — 企画書v5 10節: リード管理・リード別比較・リード毎比較・ランキング
// ============================================================
// リードタブの親。登録⇄比較をスワイプpagerで行き来し、個別リード詳細の開閉も担う。
// 詳細を開いている間はpagerを出さず(早期return)、右スワイプで一覧へ戻し、左スワイプで比較タブへ移る。
//
// 【N-5】正典の子タブ行(.subtabs)と右端の「…」をここで描く。
// 以前は App.jsx のルート(topTab === "reeds" の中)に溝つきのセグメントコントロールがあったが、
// 正典は**素のテキスト2つ**で、選択中だけ濃い太字。右端の「…」は削除モードと開封日の編集の入口。
// ここへ移したのは、「…」の中身(削除モード)が登録一覧の状態と一体だから
// (ルートに置くと状態を2階層またいで配らねばならない)。データタブの子タブ行には触らない。
//
// 【モード】listMode は登録子タブだけが持つ一時的な状態:
//   null         通常
//   "boxDelete"  箱を選んで削除
//   "memberDelete" 個体を選んで削除
// モード中は「…」の代わりに「キャンセル」と実行を同じ行に出す。
// 【F-80】"dateEdit"(箱の開封日を編集)は廃止。開封日は箱の見出しの日付をタップして
// 「箱を編集」シートで直す(F-82 の銘柄・番手の編集と同じシート)。モードごと消した。
function ReedsTab(props) {
  const {
    reeds, setReeds, sessions, updateSessions, setTopTab, setSelectedReedId,
    selectedIdeal, saxType, tuningHz, compareReedIds, setCompareReedIds,
    reedsSubTab, setReedsSubTab, selectedReedId,
  } = props;
  const [evaluatingReedId, setEvaluatingReedId] = useState(null);
  // 展開中の箱は詳細を開いている間もここで保持する。ReedRegisterView側のstateにすると
  // 詳細表示中にアンマウントされ、戻ったとき一覧が畳まれてトップに戻ってしまう(ユーザー報告)。
  // 【N-5】正典の一覧は常時展開なので開閉は無くなったが、追加シートの下書き(銘柄・番手・枚数)は
  // 同じ理由でここに置く必要がある。
  const [listMode, setListMode] = useState(null);
  const [selectedBoxKeys, setSelectedBoxKeys] = useState(() => new Set());
  const [selectedMemberIds, setSelectedMemberIds] = useState(() => new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  // 一覧のスクロール位置。詳細を開く直前に控え、戻ったら同じ位置へ復帰させる。
  const listScrollYRef = useRef(0);
  const openReed = (id) => { listScrollYRef.current = window.scrollY; setEvaluatingReedId(id); };
  const closeReed = () => setEvaluatingReedId(null);
  // 詳細からの左スワイプの行き先。詳細を閉じて比較タブへ移る(登録が左・比較が右の並びに沿う)。
  // 一覧へ戻ったわけではないので、控えてあった一覧のスクロール位置は復元しない(0にして無効化)。
  const openCompareFromReed = () => { listScrollYRef.current = 0; setEvaluatingReedId(null); setReedsSubTab("compare"); };

  const evaluatingReed = reeds.find((r) => r.id === evaluatingReedId) || null;
  useEffect(() => {
    if (evaluatingReedId) return; // 一覧へ戻った時だけ復元する
    const y = listScrollYRef.current;
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [evaluatingReedId]);

  const reedGroups = groupReeds(reeds);

  // 削除は**現行のまま**: window.confirm で1度だけ確かめ、消したリードに紐づいていた
  // セッションは reedId / linkedAt を落として紐付けだけ解除する(セッション自体は消さない)。
  const deleteReeds = (ids) => {
    const idSet = new Set(ids);
    setReeds((prev) => prev.filter((r) => !idSet.has(r.id)));
    updateSessions((prev) => prev.map((s) => (idSet.has(s.reedId) ? { ...s, reedId: null, linkedAt: null } : s)));
  };

  const exitMode = () => {
    setListMode(null);
    setSelectedBoxKeys(new Set());
    setSelectedMemberIds(new Set());
  };
  const startMode = (mode) => {
    setSelectedBoxKeys(new Set());
    setSelectedMemberIds(new Set());
    setListMode(mode);
    setMoreOpen(false);
  };
  const toggleBoxSelected = (key) => setSelectedBoxKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleMemberSelected = (id) => setSelectedMemberIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const confirmBoxDelete = () => {
    if (selectedBoxKeys.size === 0) return;
    const targetGroups = reedGroups.filter((g) => selectedBoxKeys.has(g.key));
    const ids = targetGroups.flatMap((g) => g.members.map((m) => m.id));
    if (!window.confirm(`選択した${targetGroups.length}箱（${ids.length}枚）を削除しますか？(元に戻せません)`)) return;
    deleteReeds(ids);
    exitMode();
  };
  const confirmMemberDelete = () => {
    if (selectedMemberIds.size === 0) return;
    if (!window.confirm(`選択した${selectedMemberIds.size}枚を削除しますか？(元に戻せません)`)) return;
    deleteReeds([...selectedMemberIds]);
    exitMode();
  };

  // 左右の余白は一覧・個体詳細・比較で同じ(正典 .rlist の 24px)。
  // **詳細だけ枠の外に出さない**: 早期 return を枠の内側に畳んであるのはそのため
  // (以前ここで早期 return していたときは、詳細だけ左右が 14px になっていた)。
  if (evaluatingReed) {
    return (
      <div style={{ paddingLeft: REED_LIST_EXTRA_PAD_PX, paddingRight: REED_LIST_EXTRA_PAD_PX }}>
        <SwipeBackArea onBack={closeReed} onForward={openCompareFromReed}>
          <ReedEvaluationDetail
            reed={evaluatingReed} reeds={reeds} sessions={sessions} setReeds={setReeds}
            selectedIdeal={selectedIdeal} saxType={saxType} tuningHz={tuningHz}
            onBack={closeReed}
            onMeasure={(id) => { setSelectedReedId(id); setTopTab("measure"); }}
          />
        </SwipeBackArea>
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: REED_LIST_EXTRA_PAD_PX, paddingRight: REED_LIST_EXTRA_PAD_PX }}>
      {/* 正典 .subtabs: 素のテキスト2つ(13px)を gap 18 で並べ、選択中だけ --c-ink の太字。
          溝(地 --c-sunken の segmented control)は正典に無いので撤去した。
          【タップ領域(§5)の作り方】「登録」「比較」は実測 26px しかないので、
          **見た目の間隔を変えずに**当たり判定だけ広げる: 行の gap を 0 にして
          左右に 18/2 = 9px の padding を入れる(隣り合う文字の間は 9+9 = 18 のまま)。
          先頭の文字が 9px 右へずれるぶんは行の marginLeft で戻す(文字の位置は正典どおり)。 */}
      <div className="sans" style={{ display: "flex", alignItems: "center", gap: 0, marginLeft: -REED_SUBTAB_HALF_GAP_PX, fontSize: 13, marginBottom: 4 }}>
        {[{ key: "register", label: "登録" }, { key: "compare", label: "比較" }].map((t) => (
          <button
            key={t.key}
            onClick={() => { if (listMode) exitMode(); setReedsSubTab(t.key); }}
            className="sans"
            aria-pressed={reedsSubTab === t.key}
            style={{
              minHeight: "var(--tap-min)", minWidth: "var(--tap-min)",
              padding: `0 ${REED_SUBTAB_HALF_GAP_PX}px`,
              background: "none", border: "none", cursor: "pointer",
              fontSize: 13,
              color: reedsSubTab === t.key ? "var(--c-ink)" : "var(--c-ink-3)",
              fontWeight: reedsSubTab === t.key ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
        {/* 正典 .subtabs の右端(margin-left:auto)。登録子タブのときだけ出す(正典の比較画面には無い)。
            【リードが0枚のときは出さない】中身は「箱を選んで削除 / 個体を選んで削除」で、
            **箱が1つも無ければどちらも実行できない**。
            HEAD も削除の入口を `{reeds.length > 0 && …}` で括っていた(0枚では出さない)。
            §6.0 の3原則「今に関係ない物は出ていない」。0枚の画面に残るのは
            「まだリードが登録されていません」と「＋ 追加」だけになる。 */}
        {reedsSubTab === "register" && (reeds.length > 0 || listMode !== null) && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            {listMode === null ? (
              <button
                onClick={() => setMoreOpen(true)}
                aria-label="その他の操作"
                aria-expanded={moreOpen}
                className="sans"
                style={{ minWidth: "var(--tap-min)", minHeight: "var(--tap-min)", display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--c-ink-2)" }}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" focusable="false">
                  <circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" />
                </svg>
              </button>
            ) : (
              <>
                {/* 【F-102】numberEdit は選んで実行する型ではなく「編集して終わる」型なので、
                    出口の文言は「完了」(編集はシートを閉じた時点で確定済み。キャンセルと出すと
                    変更が戻ると誤読される)。見た目の型は削除モードのキャンセルと同じ B型ピル。 */}
                <button onClick={exitMode} className="sans" style={{ ...TAP_BUTTON_RESET }}>
                  <span className="ctl-plain ctl-pill" style={{ padding: "7px 14px", color: "var(--c-ink-2)", fontSize: 12, lineHeight: 1.2 }}>{listMode === "numberEdit" ? "完了" : "キャンセル"}</span>
                </button>
                {listMode !== "numberEdit" && (
                <button
                  onClick={listMode === "boxDelete" ? confirmBoxDelete : confirmMemberDelete}
                  disabled={listMode === "boxDelete" ? selectedBoxKeys.size === 0 : selectedMemberIds.size === 0}
                  className="sans"
                  style={{ ...TAP_BUTTON_RESET, cursor: (listMode === "boxDelete" ? selectedBoxKeys.size : selectedMemberIds.size) > 0 ? "pointer" : "default" }}
                >
                  {/* 実際に消える一手だけが --c-danger の塗りを持つ(index.css の .ctl-danger)。 */}
                  <span className="ctl-plain ctl-pill ctl-danger"
                    data-armed={(listMode === "boxDelete" ? selectedBoxKeys.size : selectedMemberIds.size) > 0}
                    style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>
                    {listMode === "boxDelete"
                      ? (selectedBoxKeys.size > 0 ? `${selectedBoxKeys.size}箱を削除` : "削除")
                      : (selectedMemberIds.size > 0 ? `${selectedMemberIds.size}枚を削除` : "削除")}
                  </span>
                </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <SwipePager
        index={reedsSubTab === "compare" ? 1 : 0}
        onIndexChange={(i) => { if (listMode) exitMode(); setReedsSubTab(i === 1 ? "compare" : "register"); }}
      >
        <ReedRegisterView
          reeds={reeds} setReeds={setReeds}
          sessions={sessions}
          selectedReedId={selectedReedId}
          onOpenReed={openReed}
          reedGroups={reedGroups}
          listMode={listMode}
          selectedBoxKeys={selectedBoxKeys} toggleBoxSelected={toggleBoxSelected}
          selectedMemberIds={selectedMemberIds} toggleMemberSelected={toggleMemberSelected}
          pageActive={reedsSubTab === "register"}
        />
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <ReedCompareTab reeds={reeds} sessions={sessions} compareReedIds={compareReedIds} setCompareReedIds={setCompareReedIds} saxType={saxType} tuningHz={tuningHz} />
        </div>
      </SwipePager>

      {moreOpen && (
        <ReedMoreMenu
          onClose={() => setMoreOpen(false)}
          onPick={startMode}
        />
      )}
    </div>
  );
}

// 【N-5】登録一覧の「…」。正典 .subtabs 右端の3点から開く。
// 使用頻度の低い操作をここへ入れる(正典の3原則「今に関係ない物は出ていない」)。
// シートの作法(暗幕・角丸28・つまみ36×4・影)はテンポシートと同値。新しい濃さを発明しない。
// **リードが0枚のときはこのメニューの入口ごと出さない**(どちらも実行できないため。呼び出し側の条件)。
//
// 【F-78 総枚数バッジは消した(2026/08/14 本人決定)】N-5 では「登録済みリード n枚」を
// このメニューの見出しへ**暫定**で置き、置き場所は本人判断待ちとしていた。本人の決定は「消す」。
// 枚数はタイルを数えれば分かる(正典の判断)ので、アプリのどこにも総枚数は出さない。
//
// 【F-80 「箱の開封日を編集」も消した】開封日は箱の見出しの日付をタップして編集する形に移した
// (本人指示「日付をタップしたら編集できるというのは直感的に分かるはず」)。残るのは削除2件。
const REED_MORE_ITEMS = [
  { mode: "boxDelete", label: "箱を選んで削除" },
  { mode: "memberDelete", label: "個体を選んで削除" },
  // 【F-102 2026/08/17 本人指示】番号編集の入口を「…」へ。モード中はタイルをタップすると
  // その1枚の番号編集シートが開く(個別ページの点線の下線は削除した。機能はこの経路で維持)。
  { mode: "numberEdit", label: "リード番号を変更" },
];
function ReedMoreMenu({ onClose, onPick }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const dismiss = useSheetDismiss(onClose);   // 【F-88】下スワイプで閉じる
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="リードの操作"
      onClick={onClose}
      data-noswipe
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.28)",
        display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center",
      }}
    >
      <div
        ref={dismiss.ref} {...dismiss.handlers}
        onClick={(e) => e.stopPropagation()}
        data-noswipe
        style={{
          width: "100%", maxWidth: 900, background: "var(--c-surface)",
          borderRadius: "28px 28px 0 0", boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
          padding: "14px 24px", paddingBottom: "calc(40px + env(safe-area-inset-bottom))",
          display: "flex", flexDirection: "column", alignItems: "stretch",
        }}
      >
        <button
          onClick={onClose} aria-label="閉じる" className="no-select"
          style={{ width: "var(--tap-min)", height: "var(--tap-min)", alignSelf: "center", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}
        >
          <span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--c-line-strong)", display: "block" }} />
        </button>
        {REED_MORE_ITEMS.map((it) => (
          <button
            key={it.mode}
            onClick={() => onPick(it.mode)}
            className="sans"
            style={{
              minHeight: "var(--tap-min)", display: "flex", alignItems: "center",
              background: "none", border: "none", borderBottom: "1px solid var(--c-line)",
              padding: 0, cursor: "pointer", fontSize: 14, color: "var(--c-ink)", textAlign: "left",
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// 【F-102 2026/08/17 本人指示】「…」→「リード番号を変更」モードでタイルをタップすると開く、
// 1枚ぶんの番号編集シート。シートの作法(暗幕・角丸28・つまみ36×4・影)は ReedMoreMenu と同値
// (新しい濃さ・寸法を発明しない)。番号の意味は個別ページの入力欄と同一:
// 自由記述・空にすると自動採番に戻る(placeholder に今の値が出る)。
// 確定はシートを閉じる操作(背景タップ・つまみ・Escape)で行う(開いて閉じただけ=変更なしは書き込まない)。
function ReedNumberSheet({ reed, reeds, onCommit, onClose }) {
  const [draft, setDraft] = useState(String(reedPosition(reed, reeds) ?? ""));
  const close = () => { onCommit(draft); onClose(); };
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const dismiss = useSheetDismiss(close);   // 下スワイプで閉じる(F-88 と同じ作法)
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="リード番号を変更"
      onClick={close}
      data-noswipe
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.28)",
        display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center",
      }}
    >
      <div
        ref={dismiss.ref} {...dismiss.handlers}
        onClick={(e) => e.stopPropagation()}
        data-noswipe
        style={{
          width: "100%", maxWidth: 900, background: "var(--c-surface)",
          borderRadius: "28px 28px 0 0", boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
          padding: "14px 24px", paddingBottom: "calc(40px + env(safe-area-inset-bottom))",
          display: "flex", flexDirection: "column", alignItems: "stretch",
        }}
      >
        <button
          onClick={close} aria-label="閉じる" className="no-select"
          style={{ width: "var(--tap-min)", height: "var(--tap-min)", alignSelf: "center", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}
        >
          <span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--c-line-strong)", display: "block" }} />
        </button>
        <div className="sans" style={{ fontSize: 14, color: "var(--c-ink)", marginBottom: 12 }}>
          {reedLabel(reed, reeds)} の番号
        </div>
        <input
          type="text" aria-label="番号"
          placeholder={String(reedPosition(reed, reeds))}
          value={draft} onChange={(e) => setDraft(e.target.value)}
          className="sans"
          style={{ ...REED_FORM_CONTROL_STYLE, fontSize: 15 }}
        />
      </div>
    </div>,
    document.body,
  );
}

// ============================================================
// リード登録タブ (企画書10.2/10.3節) — 銘柄/番手プルダウン化、10枚まとめ登録に対応
// ============================================================

// 入力欄・selectの共通スタイル。高さは --tap-min(44px)。
// select/input は「見た目＝当たり判定」なので、DESIGN-SYSTEM §5 の minHeight 方式を
// そのまま当てて枠ごと44ptにする(枠より広い透明領域を作ると隣の欄と食い合うため)。
// 地・枠・角丸は index.css の入力欄の規則(B型: --c-sunken の地 + 見えない枠 + --r-xs)が持つ。
// ここで角丸を書き足すと、型を変えたときにこの1箇所だけ取り残される。
// minWidth: 0 は input[type=date] のため。type=date は「年/月/日」＋カレンダーアイコンを
// 抱えた固有幅を持ち、既定の min-width:auto のままだとグリッド項目の取り分より縮まず、
// width:100% が効かずに右の列へはみ出す(iOS Safari で本人報告)。
// height を minHeight と**両方**書く理由(2026-08-04・本人報告「使用開始日だけ縦幅が変わった」):
// minHeight は下限でしかないので、ネイティブ描画のまま(appearance:auto)の select が
// 固有の高さで 44px を上回ると、appearance を落とした使用開始日(=固有の高さを失って
// ちょうど 44px になる)だけが低くなり、3つの欄の縦幅が揃わない。Chrome では 3つとも
// 44px に収まるためこの差は出ない(またしても実機だけで出る差)。height で固定して
// 「揃っている」を実装で保証する。minHeight は §5 の 44pt 要件の意図を残すために併記する。
const REED_FORM_CONTROL_STYLE = {
  width: "100%",
  minWidth: 0,
  height: "var(--tap-min)",
  minHeight: "var(--tap-min)",
  padding: "0 8px",
  boxSizing: "border-box",
};

// 削除選択のチェックボックス。18/20pxの箱のままだと当たり判定が44ptに届かないため、
// appearance:none にして「44×44の透明な当たり判定 + 中央に18pxの箱を描いた背景画像」にする。
// 見た目の大きさは変えず当たり判定だけ広げる(DESIGN-SYSTEM §5)。
// 色は data URI 内に直書きするしかないので、パレットの値をそのまま埋めている
// (枠=--c-line-strong #C3CAD3 / 面=--c-surface #FFFFFF / 選択=--c-accent #174585 / チェック=--c-on-accent #FFFFFF)。
const CHECKBOX_OFF_IMG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Crect x='0.75' y='0.75' width='16.5' height='16.5' rx='4' fill='%23FFFFFF' stroke='%23C3CAD3' stroke-width='1.5'/%3E%3C/svg%3E\")";
const CHECKBOX_ON_IMG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Crect width='18' height='18' rx='4' fill='%23174585'/%3E%3Cpath d='M4.4 9.3l3 3 6.2-6.6' fill='none' stroke='%23FFFFFF' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";
// テンポシートの「小節アクセント」用。正典 .ck は**紺(--c-accent)の 1.5px 枠**で地は透明。
// 上の CHECKBOX_OFF_IMG(灰枠+白地)と分けるのは、モックがこの1箇所だけ枠の色を変えているため。
const CHECKBOX_OFF_ACCENT_IMG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Crect x='0.75' y='0.75' width='16.5' height='16.5' rx='4' fill='none' stroke='%23174585' stroke-width='1.5'/%3E%3C/svg%3E\")";

// offImg: 未チェックの絵。既定はリードタブの灰枠。テンポシートの「小節アクセント」だけは
// 正典 .ck の**紺の枠**(CHECKBOX_OFF_ACCENT_IMG)を渡す。チェック時の絵は共通(.ck.on と同形)。
function reedCheckboxStyle(checked, glyph = 18, offImg = CHECKBOX_OFF_IMG) {
  return {
    appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
    width: "var(--tap-min)", height: "var(--tap-min)",
    flexShrink: 0, margin: 0, padding: 0, border: "none", background: "transparent",
    backgroundImage: checked ? CHECKBOX_ON_IMG : offImg,
    backgroundRepeat: "no-repeat", backgroundPosition: "center",
    backgroundSize: `${glyph}px ${glyph}px`,
    cursor: "pointer",
  };
}

// 見た目のピルは内側の<span>が持ち、<button>自体は高さ44ptの透明な当たり判定にする。
// これで「見た目の大きさは変えず当たり判定だけ広げる」(DESIGN-SYSTEM §5)が成立する。
// fontSize を明示するのは、<button> のUA既定(13.333px)が7段スケールの外だから。
// 見えている文字は内側の<span>が持つが、素の button を放置するとスケール外の値が残る。
const TAP_BUTTON_RESET = {
  minHeight: "var(--tap-min)",
  display: "flex", alignItems: "center",
  padding: 0, background: "none", border: "none", cursor: "pointer",
  fontSize: "var(--fs-xs)",
};

// ============================================================================
// 【N-11 / F-111 2026/08/17 本人指示】右下に浮かせるボタン(共通部品)。
// 正典 = design/mydata-v2-proposals.html の案P(.fab)と
//        design/detail-and-reed-proposals.html の案D(.fab)。**同じ形の .fab** なので、
// 「作法を2つ作らない」(N11-SPEC)ために **My Data の「取り込み」と
// リードタブの「リードを追加」は文字通りこの1部品**を使う。
//
// 【createPortal で document.body へ出す理由】呼び出し側はどちらも SwipePager の track の
// 子孫にいる。track は transform を持つので、**その中の position:fixed は画面ではなく
// track を基準に配置される**(SwipeBackArea のコメントが同じ罠を「暗幕が画面全体を覆えなくなる」
// として名指ししている)。body へ出せば transform の外側になり、スクロールでも動かない。
//
// 【重なりの順】シート・暗幕(z-index 60)より下、下部ナビ(30)より上。
// アップロードの告知(40)とは画面の上下で分かれるので競合しない。
const FLOAT_ACTION_Z = 45;
// 浮かせるボタンと画面の縁との間隔。**既存の余白トークンだけで書く**(直書きの数値を作らない)。
const FLOAT_ACTION_GAP = "var(--sp-3)";
// 一覧の下に確保する余白 = ボタンの高さ(§5 の 44) + 上下の間隔。
// これが無いと最下行がボタンの下に潜る(案D の弱点として正典自身が書いている
// 「最下段のタイルに少し重なる(下に余白を確保して回避)」)。
const FLOAT_ACTION_SPACER_H = `calc(var(--tap-min) + ${FLOAT_ACTION_GAP} + ${FLOAT_ACTION_GAP})`;
function FloatingAction({ label, ariaLabel, onClick, disabled = false, icon = null }) {
  return createPortal(
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="sans"
      style={{
        position: "fixed", zIndex: FLOAT_ACTION_Z,
        /* 右端は本文の左右余白と揃える。下端は下部ナビ(+安全域)の上に間隔ぶん。
           **どちらも既存のトークンだけで書く**(--page-pad-right / --page-bottom-gap / --sp-3)。 */
        right: "var(--page-pad-right)",
        bottom: `calc(var(--page-bottom-gap) + ${FLOAT_ACTION_GAP})`,
        minHeight: "var(--tap-min)", minWidth: "var(--tap-min)",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-1)",
        padding: "0 var(--sp-5)", borderRadius: "var(--r-pill)", border: "none",
        background: disabled ? "var(--c-disabled)" : "var(--c-accent)",
        color: "var(--c-on-accent)",
        fontSize: "var(--fs-sm)", fontWeight: 600, lineHeight: 1.2,
        /* 影は既存の浮かぶ物(シート・上端の告知)と同値。新しい濃さを発明しない。 */
        boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {icon}
      {label}
    </button>,
    document.body,
  );
}
// 一覧の末尾に置く、ボタンの高さぶんの余白。**FloatingAction と対で使う**
// (片方だけ置くと最下行がボタンに隠れる)。
function FloatingActionSpacer() {
  return <div aria-hidden="true" style={{ height: FLOAT_ACTION_SPACER_H }} />;
}

// 【N-5】箱の見出しの2行目に出していた「開始 yyyy/mm/dd ・ n枚」は正典 .rmeta の
// 「★3.8 / 2026/08/02」に置き換わった。枚数はタイルを数えれば分かる(正典の判断)。
// 個体の「開封n日 ・ nセッション / 未測定」もタイルには載らないので、個体詳細へ移した
// (下の reedDetailMetaLine)。
//
// 個体詳細の「測定データ · …」の1行。正典は「測定データ · 12セッション」だが、
// 一覧のタイルから落ちた**開封からの日数**をここが引き取る(P1-8「育てる」の唯一の表示)。
// 集計は既存の usageDays() / セッション数だけを使う。新しい指標は作らない。
//   セッションが0件            → 「未測定」(一覧の個体行が出していた語をそのまま使う)
//   開封日が未設定 / 読めない  → 日数の節を出さない
function reedDetailMetaLine(sessionCount, days) {
  const head = sessionCount > 0 ? `${sessionCount}セッション` : "未測定";
  return days ? `測定データ · ${head} · 開封 ${days}日` : `測定データ · ${head}`;
}

// 【N-5】追加シート。正典のミニ「追加」。
// 銘柄プルダウン(「＋ 新しい銘柄を入力...」で自由入力が出るのは現行のまま)・番手5種のピル・
// 枚数 1〜10 の −/＋。**枚数1なら「1枚を追加」、複数なら「n枚の箱を追加」**。
// 現行の window.prompt による枚数入力は廃止(シートの中で完結する)。
// シートの作法(暗幕・角丸28・つまみ・影)はテンポシート/「…」と同値。
//
// 追加ボタンの文言は純関数に出してある(ハーネスが JSX を見ないため。実行で数えられる)。
function reedAddButtonLabel(count) {
  return count === 1 ? "1枚を追加" : `${count}枚の箱を追加`;
}
// 【F-80 / F-82】同じシートを「箱を編集」にも使う。実行の一手の文言はここで分ける
// (JSX 側で書き分けるとハーネスから見えない)。
function reedSheetButtonLabel(mode, count) {
  return mode === "edit" ? "この箱を変更" : reedAddButtonLabel(count);
}
// シートの見出し(11px / --ink3)とダイアログ名。綴りを2箇所に置かないためここへ集める。
function reedSheetTitle(mode) {
  return mode === "edit" ? "箱を編集" : "追加";
}
// 銘柄プルダウンの「新しい銘柄を入力」の値とラベル。現行の <option value="__custom__"> を
// そのまま引き継ぐ(保存される銘柄名には出ない内部値)。
const REED_BRAND_CUSTOM = "__custom__";
const REED_BRAND_CUSTOM_LABEL = "＋ 新しい銘柄を入力...";
const REED_ADD_COUNT_MIN = 1;
const REED_ADD_COUNT_MAX = REED_BOX_SIZE; // 箱1つぶん(10枚)
function clampReedAddCount(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return REED_ADD_COUNT_MIN;
  return Math.max(REED_ADD_COUNT_MIN, Math.min(REED_ADD_COUNT_MAX, v));
}

// 【F-80 / F-82】mode で「追加」と「箱を編集」を切り替える。**呼び出し側で切り替える**方式
// (F-72 罠1 の bare と同じ考え)で、既定は今までどおり "add"。追加の呼び出しは1文字も変えない。
//   "add"  … 銘柄 + 番手 + 枚数。開封日は出さない(箱を追加した日が自動で入る)
//   "edit" … 銘柄 + 番手 + 開封日。枚数は出さない(枚数は箱の中身であって箱の属性ではない)
// 銘柄・番手・開封日はどれも箱のキー(銘柄|番手|開封日)なので、編集は3つを1枚のシートで扱う。
function ReedBoxSheet({
  brandOptions, brand, setBrand, customBrand, setCustomBrand,
  strength, setStrength, count, setCount, startDate, setStartDate, onAdd, onClose, mode = "add",
}) {
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const isEdit = mode === "edit";
  const isCustom = brand === REED_BRAND_CUSTOM;
  // 押しても何も起きない一手を作らない(§6.1.5)。実行側(registerReeds / applyBoxEdit)は
  // 銘柄が空・開封日が空のとき**黙って return する**ので、その2つをここで先に潰しておく。
  // 片方だけにすると「押せるのに無反応」になる(審査役の変異で実際に生き残った経路)。
  const disabled = (isCustom && !customBrand.trim()) || (isEdit && !startDate);
  const pickerOptions = [...brandOptions, REED_BRAND_CUSTOM];
  // 【F-88】下スワイプで閉じる。**銘柄ピッカーを開いている間は配線ごと外す**
  // (ScrollPicker はこのシートの中から開く全画面モーダルで、シートに transform が
  //  残っているとそのピッカーの position:fixed の基準がシートになる。§6.3。
  //  ドラッグ後 SWIPE_BACK_SETTLE_MS で transform は消えるが、消える前にピッカーを
  //  開けてしまう経路を残さない)。
  const dismiss = useSheetDismiss(onClose);
  const dismissHandlers = brandPickerOpen ? null : dismiss.handlers;
  return createPortal(
    <>
      <div
        role="dialog" aria-modal="true" aria-label={isEdit ? "箱を編集" : "リードを追加"}
        onClick={onClose}
        data-noswipe
        style={{
          position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.28)",
          display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center",
        }}
      >
        <div
          ref={dismiss.ref} {...dismissHandlers}
          onClick={(e) => e.stopPropagation()}
          data-noswipe
          style={{
            width: "100%", maxWidth: 900, background: "var(--c-surface)",
            borderRadius: "28px 28px 0 0", boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
            padding: "14px 24px", paddingBottom: "calc(40px + env(safe-area-inset-bottom))",
            display: "flex", flexDirection: "column", alignItems: "stretch",
          }}
        >
          <button
            onClick={onClose} aria-label="閉じる" className="no-select"
            style={{ width: "var(--tap-min)", height: "var(--tap-min)", alignSelf: "center", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}
          >
            <span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--c-line-strong)", display: "block" }} />
          </button>

          {/* 正典ミニの見出し「追加」(11px / --ink3)。編集のときは「箱を編集」 */}
          <div className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", marginBottom: 10 }}>{reedSheetTitle(mode)}</div>

          {/* 銘柄。正典は「太字の値 + ▾」の1行(padding 8px 0 / 下に罫1本 / 14px)。 */}
          <button
            onClick={() => setBrandPickerOpen(true)}
            aria-label="銘柄" aria-expanded={brandPickerOpen}
            className="sans"
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 0", minHeight: "var(--tap-min)",
              border: "none", borderBottom: "1px solid var(--c-line)",
              background: "none", cursor: "pointer", fontSize: 14, color: "var(--c-ink)", width: "100%",
            }}
          >
            <span style={{ fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {isCustom ? (customBrand.trim() || REED_BRAND_CUSTOM_LABEL) : brand}
            </span>
            <PickChevron />
          </button>
          {/* 「＋ 新しい銘柄を入力...」を選んだときだけ出る自由入力(現行のまま)。 */}
          {isCustom && (
            <input
              type="text" placeholder="新しい銘柄名を入力" value={customBrand}
              onChange={(e) => setCustomBrand(e.target.value)}
              className="sans"
              style={{ ...REED_FORM_CONTROL_STYLE, fontSize: 12, marginTop: 8 }}
            />
          )}

          {/* 番手5種。正典 .selrow / .selpill(12.5px / padding 4px 11px / 角丸999 / 選択は紺の塗り)。
              見た目のピルは 44 に満たないので、外側の <button> が当たり判定を持つ(§5)。 */}
          <div style={{ display: "flex", gap: 7, justifyContent: "flex-start", flexWrap: "wrap", marginTop: 12 }}>
            {REED_STRENGTHS.map((s) => (
              <button key={s} onClick={() => setStrength(s)}
                aria-pressed={strength === s}
                aria-label={`番手 ${s}`}
                className="no-select"
                style={{
                  minHeight: "var(--tap-min)", minWidth: "var(--tap-min)", padding: 0,
                  background: "transparent", border: "none",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12.5, padding: "4px 11px", borderRadius: 999, fontFamily: "var(--font-num)",
                  border: strength === s ? "1px solid transparent" : "1px solid var(--c-line-strong)",
                  background: strength === s ? "var(--c-accent)" : "transparent",
                  color: strength === s ? "var(--c-on-accent)" : "var(--c-ink-2)",
                }}>{s}</span>
              </button>
            ))}
          </div>

          {/* 枚数 1〜10。正典は −/数値/＋ を gap 26 で並べ、数値は 26px の太字。
              ± の反応領域の幅は正典 .pmt の基準値 METRO_PM_W(72)。
              【F-95a 以降は計測タブと同じではない】計測タブのテンポ行だけが本人指示で
              1.2 倍(86.4)になった。ここは拡大の対象外なので基準値のまま。 */}
          {/*
              【正典と意図的に違う1点】正典ミニの `.pmt` は **height:40px** だが、
              DESIGN-SYSTEM §6.0 は「§5 のタップ領域 44px は機能側の規定として引き続き有効。
              機能とモックが衝突したときは機能を残す」と定めているので **44px** にした。
              見えているのは「−」「＋」の文字だけなので、高さを 4px 足しても見た目は変わらない。 */}
          {/* 【F-80】開封日。編集のときだけ出す。
              **ScrollPicker ではなく input[type=date] を選んだ理由**: ScrollPicker は1列の
              選択肢リストなので、年・月・日の3値を1列に落とせない(日付を列挙すると選択肢が
              無限に近くなる)。一方 input[type=date] は iOS Safari で固有幅が width より
              優先される既知の罠がある(BACKLOG F-39/F-40/F-41)。だから**行内には置かず**、
              左右 24px の余白しか無いシートの中に置いて幅を目一杯取らせる
              (箱見出しの行に置くと ★ と同居して 150px しか取れない)。
              **iOS Safari での見え方は Chrome では判定できない = 実機待ち**(LOOP.md)。 */}
          {isEdit && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
              <span className="sans" style={{ fontSize: 12, color: "var(--c-ink-3)", flexShrink: 0 }}>開封日</span>
              <input
                type="date"
                aria-label="開封日"
                value={startDate || ""}
                onChange={(e) => setStartDate?.(e.target.value)}
                className="sans"
                /* appearance / maxWidth / lineHeight / overflow の4点は、N-5 まで
                   「…」の中にあった同じ欄が持っていた手当てを**1つも下げずに**引き継いだもの
                   (理由は §6.9 の検査のコメント。iOS Safari の固有幅・縦位置・内部UIのはみ出し)。 */
                style={{ ...REED_FORM_CONTROL_STYLE, flex: 1, fontSize: 14, WebkitAppearance: "none", appearance: "none", maxWidth: "100%", lineHeight: "1.25", overflow: "hidden" }}
              />
            </div>
          )}

          {/* 枚数は「追加」のときだけ。**箱の編集では出さない**(枚数は箱の中身であって
              箱の属性ではない。編集で枚数を変えると、どの個体を消すのかが決まらない)。 */}
          {!isEdit && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 26, marginTop: 16 }}>
            <button
              onClick={() => setCount((v) => clampReedAddCount(v - 1))}
              aria-label="枚数を減らす" className="no-select"
              style={{ width: METRO_PM_W, height: "var(--tap-min)", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", flexShrink: 0, fontSize: 20, fontWeight: 300, color: "var(--c-ink-2)", lineHeight: 1 }}
            >−</button>
            <span aria-live="polite" style={{ fontSize: 26, fontWeight: 600, fontFamily: "var(--font-num)", minWidth: 44, textAlign: "center" }}>{count}</span>
            <button
              onClick={() => setCount((v) => clampReedAddCount(v + 1))}
              aria-label="枚数を増やす" className="no-select"
              style={{ width: METRO_PM_W, height: "var(--tap-min)", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", flexShrink: 0, fontSize: 20, fontWeight: 300, color: "var(--c-ink-2)", lineHeight: 1 }}
            >＋</button>
          </div>
          )}

          {/* 追加の一手。正典は紺の塗りピル(13px / 600 / padding 8px 22px)。 */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
            <button
              onClick={onAdd}
              disabled={disabled}
              className="sans"
              style={{
                minHeight: "var(--tap-min)", padding: 0, background: "none", border: "none",
                cursor: disabled ? "default" : "pointer", display: "flex", alignItems: "center",
              }}
            >
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 600, color: "var(--c-on-accent)",
                background: disabled ? "var(--c-line-strong)" : "var(--c-accent)",
                borderRadius: 999, padding: "8px 22px",
              }}>{reedSheetButtonLabel(mode, count)}</span>
            </button>
          </div>
        </div>
      </div>
      {/* 銘柄のピッカーはシートの**外**に出す(z-index はシートと同じ層の上)。
          シートの中に置くと、暗幕がシートの中に閉じて背面がタップできてしまう(F-73 と同型の罠)。 */}
      {brandPickerOpen && (
        <ScrollPicker
          options={pickerOptions}
          value={brand}
          onChange={(v) => setBrand(v)}
          onClose={() => setBrandPickerOpen(false)}
          labelFn={(v) => (v === REED_BRAND_CUSTOM ? REED_BRAND_CUSTOM_LABEL : v)}
        />
      )}
    </>,
    document.body,
  );
}

function ReedRegisterView(props) {
  const {
    reeds, setReeds, sessions, selectedReedId, onOpenReed, reedGroups,
    listMode, selectedBoxKeys, toggleBoxSelected, selectedMemberIds, toggleMemberSelected,
    // 【F-111】浮かせるボタンは body へ portal で出るので、SwipePager の「今どのページか」を
    // 知らないと**隣のページ(比較)を見ている間も出たままになる**。呼び出し側が渡す。
    pageActive,
  } = props;

  const [addOpen, setAddOpen] = useState(false);
  const [newBrand, setNewBrand] = useState(INITIAL_REED_BRANDS[0]);
  const [customBrand, setCustomBrand] = useState("");
  const [newStrength, setNewStrength] = useState(REED_STRENGTHS[2]); // 初期値3.0
  const [addCount, setAddCount] = useState(REED_ADD_COUNT_MAX);      // 既定は箱ぶん(10枚)

  // ユーザーが自由入力した銘柄を選択肢に自動追加(初期リスト+動的追加分)
  const [extraBrands, setExtraBrands] = useState([]);
  const brandOptions = [...INITIAL_REED_BRANDS, ...extraBrands];

  // 【F-102 2026/08/17 本人指示】番号編集モード(listMode === "numberEdit")中にタップした
  // 1枚。id で持つ(リードそのものを持つと、編集で reeds が変わった瞬間に古い実体を掴む)。
  const [numberEditId, setNumberEditId] = useState(null);
  const numberEditReed = numberEditId ? reeds.find((r) => r.id === numberEditId) || null : null;
  // モードを抜けたら開きっぱなしのシートも閉じる(モード外にシートだけ残さない)
  useEffect(() => { if (listMode !== "numberEdit") setNumberEditId(null); }, [listMode]);

  // 【F-80 / F-82】箱の編集。見出しの銘柄／日付をタップして開く。下書きは箱のキーで持つ
  // (箱そのものを持つと、編集で reeds が変わった瞬間に古い箱を掴んだままになる)。
  const [editBoxKey, setEditBoxKey] = useState(null);
  const [editBrand, setEditBrand] = useState("");
  const [editCustomBrand, setEditCustomBrand] = useState("");
  const [editStrength, setEditStrength] = useState(REED_STRENGTHS[2]);
  const [editStartDate, setEditStartDate] = useState("");
  const editGroup = reedGroups.find((g) => g.key === editBoxKey) || null;
  const openBoxEdit = (g) => {
    setEditBoxKey(g.key);
    setEditBrand(g.brand);
    setEditCustomBrand("");
    setEditStrength(g.strength);
    setEditStartDate(g.startDate || "");
  };

  const resolveBrand = () => (newBrand === REED_BRAND_CUSTOM ? customBrand.trim() : newBrand);

  // 【N-5】開封日の入力欄は出さない。**箱を追加した日**がそのまま開封日になる
  // (編集は「…」の「箱の開封日を編集」)。
  const registerReeds = (count) => {
    const brand = resolveBrand();
    if (!brand) return;
    // 自由入力の銘柄は選択肢に自動追加(重複は避ける)
    if (newBrand === REED_BRAND_CUSTOM && !brandOptions.includes(brand)) {
      setExtraBrands((prev) => [...prev, brand]);
    }
    // **ローカル暦日**で入れる(localDayKey の解説を見ること)。
    // toISOString().slice(0,10) は UTC の暦日なので、JST の 00:00〜09:00 に追加すると
    // 1日前の開封日になり、箱のキー(銘柄|番手|開封日)まで割れる。
    const startDate = localDayKey(new Date());
    const newReeds = Array.from({ length: count }).map((_, i) => ({
      id: generateId(),
      brand,
      strength: newStrength,
      startDate,
      boxLabel: count > 1 ? `#${i + 1}/${count}` : null, // まとめ登録時の箱内通し番号(参考情報)
      rating: null, // 主観の5段階評価(1〜5)。未評価はnull
      thickness: null, // 主観の厚さ(抵抗感/密度)。未評価はnull
      balance: null,   // 主観のバランス(低音〜高音の鳴りの揃い)。未評価はnull
      createdAt: new Date().toISOString(),
    }));
    setReeds((prev) => [...prev, ...newReeds]);
    if (newBrand === REED_BRAND_CUSTOM) setCustomBrand("");
    setAddOpen(false);
  };

  // 【F-80 / F-82】箱の編集(銘柄・番手・開封日)。
  // **箱のキーは 銘柄|番手|開封日**(reedGroupKey)なので、3つのどれを変えても箱ごと動く。
  // その箱に属する全部のリードを同じ値へ書き換える(1枚だけ動かすと箱が割れる)。
  // 変更後のキーが既にある箱と一致したら、groupReeds が同じキーでまとめるので**その箱へ合流する**。
  //
  // 【合流したタイルは末尾に続く】値を書き換えるだけでは**そうならない**。
  // 両方の箱が sortOrder 1..n を持ったまま重なると、同じ番号が2枚ずつ並ぶので
  // reedMemberOrder が交互に並べる(審査役が実データで確認: タイルが `1,4,2,5,3,6,7` と並んだ。
  // タイルの数字は reedPosition = 登録順の管理番号で並び順そのものではないが、
  // 合流分が合流先の間に**割り込んで**いることが見える)。どれが合流分か画面から読めない。
  // → 合流のたびに**通し番号を振り直す**: 合流先を今の並びのまま 1.. に正規化し、その続きに合流分を並べる。
  // 正規化まで要るのは、合流先が一度も並び替えられていないと sortOrder が未設定(=Infinity)で、
  // 番号を持つ合流分のほうが**前に来てしまう**ため。
  // **合流先の sortOrder も書き換わる**(並びは変えない。番号を詰めるだけ)。
  const updateGroup = (g, patch) => {
    const brand = (patch.brand ?? g.brand);
    const strength = (patch.strength ?? g.strength);
    const startDate = (patch.startDate ?? g.startDate);
    if (!brand || !startDate) return;
    const ids = new Set(g.members.map((m) => m.id));
    const nextKey = `${brand}|${strength}|${startDate}`;
    setReeds((prev) => {
      const dest = prev.filter((r) => !ids.has(r.id) && reedGroupKey(r) === nextKey)
        .sort(reedMemberOrder);           // 並びの規則は groupReeds と同じものを使う
      const rank = new Map();
      dest.forEach((r, i) => rank.set(r.id, i + 1));
      g.members.forEach((m, i) => rank.set(m.id, dest.length + i + 1));
      return prev.map((r) => {
        if (ids.has(r.id)) return { ...r, brand, strength, startDate, sortOrder: rank.get(r.id) };
        return rank.has(r.id) ? { ...r, sortOrder: rank.get(r.id) } : r;
      });
    });
  };

  const applyBoxEdit = () => {
    if (!editGroup) return;
    const brand = editBrand === REED_BRAND_CUSTOM ? editCustomBrand.trim() : editBrand;
    if (!brand || !editStartDate) return;
    // 自由入力の銘柄は選択肢に自動追加(追加シートと同じ扱い)
    if (editBrand === REED_BRAND_CUSTOM && !brandOptions.includes(brand)) {
      setExtraBrands((prev) => [...prev, brand]);
    }
    updateGroup(editGroup, { brand, strength: editStrength, startDate: editStartDate });
    setEditBoxKey(null);
  };

  // 長押し+ドラッグでの並び替え確定時、表示順(sortOrder)だけを更新する。
  // 管理番号(boxNumber)は並び替えても変えない(リードそのものの識別に使うため)。
  const reorderGroupMembers = (newOrderIds) => {
    const orderById = new Map(newOrderIds.map((id, i) => [id, i + 1]));
    setReeds((prev) => prev.map((r) => (orderById.has(r.id) ? { ...r, sortOrder: orderById.get(r.id) } : r)));
  };

  // 並び替えの案内。正典に居場所は無いので、**一覧のいちばん下**(「＋ 追加」の下)に
  // 小さく1行だけ置く。並び替える先がある箱(2枚以上)が1つも無ければ出さない。
  const anyReorderable = reedGroups.some((g) => g.members.length >= 2);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {reeds.length === 0 ? (
        <div className="sans" style={{ fontSize: 12, color: "var(--c-ink-3)", padding: "20px 0" }}>まだリードが登録されていません</div>
      ) : (
        reedGroups.map((g) => {
          const avgRating = reedGroupAvgRating(g.members);
          const boxChecked = selectedBoxKeys?.has(g.key);
          // 【F-80 / F-82】銘柄と日付をタップすると「箱を編集」シートが開く。
          // **見た目は 1px も足していない**: 地・枠・角丸・下線を持たない <button> にし、
          // 当たり判定だけ index.css の .taptext(疑似要素)で 44pt へ広げる
          // (DESIGN-SYSTEM §5「見た目の大きさは変えない。当たり判定だけ広げる」)。
          // **どの削除モード中も**素の <span> に戻す。理由はモードによって違う:
          //   ・箱を選んで削除(boxDelete) … 見出しの行そのものが選択の <button> になるので、
          //     入れ子を避ける(押せる物が2つ重なると、どちらが効くか画面から読めない)。
          //   ・個体を選んで削除(memberDelete) … 見出しの行は素の <div> のままだが、
          //     「今は選んで消す作業中」に編集シートが開くのは筋が通らない。
          // (前版のコメントは前者の理由だけを両方に当てていて、memberDelete では偽だった)
          const boxEditable = listMode === null;
          const nameStyle = { fontSize: 15, fontWeight: 600, color: "var(--c-ink)", minWidth: 0 };
          const nameInner = (
            <>{g.brand} <span style={{ color: "var(--c-ink-3)", fontWeight: 400, fontStyle: "normal" }}>{g.strength}</span></>
          );
          const dateText = formatYmd(g.startDate) ?? "開封日 未設定";
          const heading = (
            <>
              {/* 正典 .rname: 15px / 600。番手は <i>(--ink3 / 400 / 斜体にしない)。
                  切り取り(ellipsis)は**内側の子**が持つ。外側に overflow:hidden を置くと
                  .taptext の疑似要素ごと切られて当たり判定が 44pt を割る。 */}
              {boxEditable ? (
                <button
                  type="button"
                  onClick={() => openBoxEdit(g)}
                  aria-label={`${g.brand} ${g.strength} の銘柄と番手を編集`}
                  className="rname sans taptext"
                  style={{ ...nameStyle, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", display: "block" }}
                >
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameInner}</span>
                </button>
              ) : (
                <span className="rname sans" style={{ ...nameStyle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameInner}</span>
              )}
              {/* 正典 .rmeta: 12px / --ink3 / gap 10 / baseline。★は文字のまま(星の絵は使わない) */}
              <span className="sans" style={{ fontSize: 12, color: "var(--c-ink-3)", display: "flex", gap: 10, alignItems: "baseline", flexShrink: 0 }}>
                {avgRating !== null && <span>★{avgRating.toFixed(1)}</span>}
                {boxEditable ? (
                  <button
                    type="button"
                    onClick={() => openBoxEdit(g)}
                    aria-label={`${g.brand} ${g.strength} の開封日を編集`}
                    className="sans taptext"
                    style={{ background: "none", border: "none", padding: 0, fontSize: 12, color: "var(--c-ink-3)", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    {dateText}
                  </button>
                ) : (
                  <span>{dateText}</span>
                )}
              </span>
            </>
          );
          return (
            /* 正典 .rgroup: padding 20px 0 24px / 下に罫1本 */
            <div key={g.key} style={{ paddingTop: REED_GROUP_PAD_TOP_PX, paddingBottom: REED_GROUP_PAD_BOTTOM_PX, borderBottom: "1px solid var(--c-line)" }}>
              {listMode === "boxDelete" ? (
                /* 箱まとめ削除。見出しの行がそのまま選択の当たり判定になる */
                <button
                  onClick={() => toggleBoxSelected(g.key)}
                  className="sans"
                  aria-pressed={!!boxChecked}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 4, minHeight: "var(--tap-min)", marginBottom: REED_HEAD_MB_PX, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                >
                  <input
                    type="checkbox" checked={!!boxChecked} onChange={() => toggleBoxSelected(g.key)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${g.brand} ${g.strength} の箱を選択`}
                    style={reedCheckboxStyle(!!boxChecked, 18)}
                  />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>{heading}</span>
                </button>
              ) : (
                /* 正典 .rhead: baseline 揃えの両端寄せ / 下に 14px */
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: REED_HEAD_MB_PX }}>{heading}</div>
              )}
              <ReedTileGrid
                members={g.members}
                reeds={reeds}
                sessions={sessions}
                selectedReedId={selectedReedId}
                deleteMode={listMode === "memberDelete"}
                noDrag={listMode === "numberEdit"}
                selectedForDelete={selectedMemberIds}
                onTileTap={(id) => (listMode === "memberDelete" ? toggleMemberSelected(id)
                  : listMode === "numberEdit" ? setNumberEditId(id)
                  : onOpenReed?.(id))}
                onReorder={reorderGroupMembers}
              />
            </div>
          );
        })
      )}

      {/* 【F-111 2026/08/17 本人指示・正典 = detail-and-reed-proposals.html の案D】
          一覧末尾の「＋ 追加」(正典 .addrow / .addbtn)は**撤去した**。本人の課題
          「リードが増えるほど『＋追加』が下に流れ、毎回スクロールが必要」に対して、
          入口を**右下に浮かせるボタン**へ移す(下の FloatingAction)。
          機能は同じ(同じ setAddOpen を呼び、同じ追加シートが開く)。
          **リードが0枚の空状態でも出す**ので、そこからしか追加できない状態は作らない。
          (正典 .addrow の padding-top を持っていた REED_ADDROW_PAD_TOP_PX は読み手が
           無くなったので定義ごと削除した。) */}

      {anyReorderable && listMode === null && (
        <div className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", textAlign: "center", paddingTop: "var(--sp-2)" }}>
          長押ししてスライドすると並び替えられます・タップで詳細
        </div>
      )}

      {/* 【F-102】番号編集モード中の案内(1行)と、タップした1枚の番号編集シート。
          変更の確定はシートを閉じたとき(値が変わったときだけ書き込む=個別ページの
          commitPosition と同じ判定)。 */}
      {listMode === "numberEdit" && (
        <div className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", textAlign: "center", paddingTop: "var(--sp-2)" }}>
          番号を変更するリードをタップ
        </div>
      )}

      {/* 【F-111】一覧の下に、浮かせるボタンの高さぶんの余白。最下段のタイルに重ならない。 */}
      <FloatingActionSpacer />
      {/* 【F-111 2026/08/17 本人指示・正典 案D】「＋ リードを追加」を右下に浮かせる。
          子タブが「登録」のときだけ出す(「比較」の画面に追加の入口は無い)。
          **リードが0枚でも出す**(空状態からの唯一の入口)。 */}
      {pageActive && (
        <FloatingAction
          label="＋ リードを追加"
          ariaLabel="リードを追加"
          onClick={() => setAddOpen(true)}
        />
      )}

      {numberEditReed && (
        <ReedNumberSheet
          reed={numberEditReed} reeds={reeds}
          onCommit={(draft) => {
            const trimmed = draft.trim();
            // 保存値と同じ(変えていない) or 表示中の自動採番のまま(触っていない)なら書き込まない。
            // 後者を見ないと「開いて閉じただけ」で自動採番が boxNumber に固定化されてしまう。
            if (trimmed === String(numberEditReed.boxNumber ?? "")) return;
            if (trimmed === String(reedPosition(numberEditReed, reeds) ?? "")) return;
            setReeds((prev) => prev.map((r) => (r.id === numberEditReed.id ? { ...r, boxNumber: trimmed || null } : r)));
          }}
          onClose={() => setNumberEditId(null)}
        />
      )}

      {addOpen && (
        <ReedBoxSheet
          brandOptions={brandOptions}
          brand={newBrand} setBrand={setNewBrand}
          customBrand={customBrand} setCustomBrand={setCustomBrand}
          strength={newStrength} setStrength={setNewStrength}
          count={addCount} setCount={setAddCount}
          onAdd={() => registerReeds(addCount)}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* 【F-80 / F-82】箱の編集。**mode は呼び出し側で渡す**(既定は "add" のまま)。
          銘柄の選択肢にはこの箱の銘柄を必ず含める(過去に自由入力した銘柄は
          brandOptions に載っていないことがあり、載っていないと開いた瞬間に別の銘柄へ化ける)。 */}
      {editGroup && (
        <ReedBoxSheet
          mode="edit"
          brandOptions={[...new Set([...brandOptions, editGroup.brand])]}
          brand={editBrand} setBrand={setEditBrand}
          customBrand={editCustomBrand} setCustomBrand={setEditCustomBrand}
          strength={editStrength} setStrength={setEditStrength}
          startDate={editStartDate} setStartDate={setEditStartDate}
          onAdd={applyBoxEdit}
          onClose={() => setEditBoxKey(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// データ分析タブ (企画書10.4節) — リード別比較・リード毎比較・ランキング
// ============================================================
// フレーム配列から比較用の平均値を算出(リード別比較・リード毎比較で共通利用)
// pitchSelection: ピッチ集計に採用するフレーム配列。groupFramesByNoteだけが
// 「全体の時系列で選別したサブセット」を渡す(グループ分け後では区間の文脈が失われるため)。
// nullなら内部でselectPitchAggregationFrames(F-44のゲート)を通して自分で選ぶ。
function computeFrameMetrics(frames, pitchSelection = null) {
  // 音量・音色は従来どおりclarity重み付き(weightedMean)。音色系(HNR・重心)はさらに
  // アタック過渡フレームを除外(timbreSustained)して定常状態だけを平均する。
  const sustained = frames.filter(timbreSustained);
  // ピッチはF-44のゲート(過渡トリム・オクターブ誤検出ラン除外)を通過したフレームだけの
  // clarity加重平均。【2026-08-04 F-46 本人指示】「代表値に中央値採用はやめて平均値に統一。
  // ±をふまえた符号付きの平均」— 中央値(F-44)をやめてF-44以前と同じ加重平均に戻した。
  // F-44以前との違いは「採用フレーム=ゲート通過分のみ」という母集団だけ。
  // 絶対値版(旧pitchCents)は全画面が符号付きに統一されたため廃止(死にフィールドを残さない)。
  const pitchFrames = pitchSelection ?? (() => {
    const sel = selectPitchAggregationFrames(frames);
    return frames.filter((_, i) => sel.selected.has(i));
  })();
  const signed = pitchFrames.map((f) => f.pitchCents).filter((v) => v !== null && v !== undefined && !isNaN(v));
  // 透明性のための内訳: total=ピッチを持つ全フレーム / used=採用 / excluded=除外
  const pitchFrameTotal = frames.filter((f) => f.pitchCents !== null && f.pitchCents !== undefined && !isNaN(f.pitchCents)).length;
  return {
    hnrDb: weightedMean(sustained, (f) => f.hnrDb),
    spectralCentroidHz: weightedMean(sustained, (f) => f.spectralCentroidHz),
    volumeDb: weightedMean(frames, (f) => f.volumeDb),
    pitchCentsSigned: weightedMean(pitchFrames, (f) => f.pitchCents),
    // ピッチのブレ: 採用フレームの符号つきpitchCentsの標準偏差。ピッチ誤差(pitchCentsSigned)が
    // 「中心からどちらへどれだけズレているか」を表すのに対し、こちらは「値がどれだけ揺れ動くか」を表す。
    // 【2026-08-04】以前は My Data のカードがこれを「ピッチの安定度」として表示していたが、
    // 本人指示で符号つきの平均ズレ(pitchCentsSigned)に置き換わったため、**現在この値を
    // 表示している画面は無い**(算出だけ残してある)。使うときは表示先を決めてから。
    pitchStabilityCents: stddev(signed),
    pitchFrameTotal,
    pitchFrameUsed: signed.length,
    pitchFrameExcluded: pitchFrameTotal - signed.length,
  };
}

// フレーム配列をsemitoneIndex(判定運指の半音インデックス)ごとにグループ化し、
// それぞれの音の平均値(音高・音量・重心・HNR・倍音構成)を算出する。
// 「1つのデータには様々な音が含まれる」ため、理想値・セッション詳細画面の両方で
// 音階ごとの内訳を出すのに使う共通ロジック。semitoneIndexが取れないフレーム(無音等)は除外する。
// 【F-54】saxType / tuningHz は concertLabel(実音の音名)を運指から導くために要る。
// 呼び出し元(理想値プロファイル生成・NoteAxisLineChart・セッション詳細)は必ず渡すこと。
function groupFramesByNote(frames, NUM_HARMONICS = 8, saxType = null, tuningHz = null) {
  return groupFramesByNoteAcrossSessions([frames], NUM_HARMONICS, saxType, tuningHz);
}

// 複数セッションぶんのフレーム列を、まとめて音階(運指)ごとに集計する。
// groupFramesByNote は「セッションが1つだけ」の特別な場合としてこれに委ねる
// (音ごとの値の作り方を2箇所に書くと、理想値プロファイルの構造が必ず食い違うため)。
// 【F-68】理想値の「この奏者の平均」がここを使う。
// **frameLists はセッションごとに分けたまま渡すこと。** ピッチのゲート
// (selectPitchAggregationFrames)は**セッション単位で個別に**掛ける。連結してから1回で
// 掛けると、セッションの継ぎ目が「同じ音が続いている区間」に見えて両端トリムの位置が動き、
// 前後の安定区間を見るオクターブ誤検出ランの判定も別のセッションの音を参照してしまう
// (F-44の罠1。F-45で buildFramesWithContext が同じ形で解いている)。
function groupFramesByNoteAcrossSessions(frameLists, NUM_HARMONICS = 8, saxType = null, tuningHz = null) {
  const groups = {};
  const selectedByGroup = {};
  for (const list of frameLists || []) {
    const frames = list || [];
    // ピッチの採用フレームは**グループ分けの前に、そのセッションの時系列に対して1回だけ**選別する。
    // グループ分け後の配列では区間の隣接関係(前後の安定区間・過渡の位置)が失われ、
    // 両端トリムもオクターブ誤検出ランの判定もできなくなるため(F-44)。
    const sel = selectPitchAggregationFrames(frames);
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.semitoneIndex === null || f.semitoneIndex === undefined) continue;
      if (!groups[f.semitoneIndex]) { groups[f.semitoneIndex] = []; selectedByGroup[f.semitoneIndex] = []; }
      groups[f.semitoneIndex].push(f);
      if (sel.selected.has(i)) selectedByGroup[f.semitoneIndex].push(f);
    }
  }
  return Object.entries(groups)
    .map(([key, groupFrames]) => {
      const semitoneIndex = Number(key);
      // ピッチ系は「グループ内フレーム ∩ 採用フレーム」のclarity加重平均(F-46)。
      // 採用が0のグループ(全編が過渡・誤検出ラン)はピッチ系がnullになる。
      const pitchFrames = selectedByGroup[key];
      const m = computeFrameMetrics(groupFrames, pitchFrames);
      // 倍音構成もアタック過渡を除外し、clarity重み付きで平均する(音色系の共通方針)
      const sustained = groupFrames.filter(timbreSustained);
      const harmonicsProfile = Array.from({ length: NUM_HARMONICS }, (_, i) => {
        const n = i + 1;
        const wm = weightedMean(sustained, (f) => f.harmonics?.find((h) => h.n === n)?.levelNorm ?? null);
        return { n, norm: wm ?? 0 };
      });
      return {
        semitoneIndex,
        // 記音(サックスの譜面上の音名)。理想値プロファイルに保存され、旧表記(D#/A#)の
        // 一括変換(migrateIdealProfile)が参照する。**画面には出さない**(F-54で実音に統一した)。
        writtenLabel: groupFrames.find((f) => f.matchedWrittenNote)?.matchedWrittenNote ?? null,
        // 実音(コンサートピッチ)の音名。計測タブ・NoteAxisLineChart と同じ土台にするため、
        // 実測の concertNote ではなく**運指から**導く(F-54)。運指から引けない旧データ
        // (semitoneIndex 無し等)だけ、既存の idiom concertNote || matchedWrittenNote に倣う。
        concertLabel: concertNoteLabelOf(semitoneIndex, saxType, tuningHz)
          || groupFrames.find((f) => f.concertNote)?.concertNote
          || groupFrames.find((f) => f.matchedWrittenNote)?.matchedWrittenNote
          || null,
        frameCount: groupFrames.length,
        // 表示の一貫性のため、pitchHzも採用フレームの加重平均(ピッチ系と同じ土台の値)
        pitchHz: weightedMean(pitchFrames, (f) => f.pitchHz),
        volumeDb: m.volumeDb,
        centroidHz: m.spectralCentroidHz,
        hnrDb: m.hnrDb,
        pitchCentsSigned: m.pitchCentsSigned, // ピッチ誤差(符号付き・採用フレームの加重平均)。音名軸グラフ用
        pitchStabilityCents: m.pitchStabilityCents,   // ピッチのブレ(stddev)。現在どの画面でも未使用
        pitchFrameUsed: m.pitchFrameUsed,             // ピッチ集計の透明性(採用/除外の内訳)
        pitchFrameExcluded: m.pitchFrameExcluded,
        harmonicsProfile,
      };
    })
    .sort((a, b) => b.semitoneIndex - a.semitoneIndex); // 音が高い順(半音インデックスが大きいほど高音)
}

// 全セッションのフレームを、セッション情報(リード・録音日時・奏者・種別・メモ)つきで平坦化する
// (semitoneIndexはフレーム自体が保持: 企画書11.7節の記録拡張を実施済み)。分析タブのクロス集計
// (PIVOT)が使う入力を組み立てる純関数。React hooks/JSXに依存しないモジュールスコープの関数として
// 切り出してある(AnalysisLabViewのローカル定義のままだと、抽出型のテストハーネス
// (scripts/pitch-test.mjs)がJSXの外に出せず検証できないため。F-45の審査で指摘)。
// 【F-45】ピッチ集計にF-44/F-46と同じ入口ゲート(selectPitchAggregationFrames)を通すため、
// セッションごとに(=groupFramesByNoteと同じ時系列の粒度で)選別し、通過フレームに
// _pitchGateOk を立てる。複数セッションを連結してから1回で掛けると区間の文脈(前後の安定区間・
// tの連続性)が壊れるため、必ずセッション単位で個別に呼ぶ(F-44の罠1と同じ)。
function buildFramesWithContext(sessions, reeds) {
  return sessions.flatMap((s) => {
    const reed = reeds.find((r) => r.id === s.reedId) || null;
    const frames = s.frames || [];
    const sel = selectPitchAggregationFrames(frames);
    return frames.map((f, i) => ({
      ...f, reedId: s.reedId, reed, recordedAt: s.recordedAt,
      performer: s.performer, saxType: s.saxType, source: s.source, memo: s.memo,
      _pitchGateOk: sel.selected.has(i),
    }));
  });
}

// 理想値プロファイルのnotesマップから、指定した音(semitoneIndex)の理想値を取り出す。
// 該当する音がまだ理想値に登録されていない場合はnull(比較の対象外として扱う)。
function getNoteIdeal(profile, semitoneIndex) {
  if (!profile || semitoneIndex === null || semitoneIndex === undefined) return null;
  return profile.notes?.[semitoneIndex] ?? null;
}

// セッション全体のフレームを音階(運指)ごとに分解し、理想値プロファイルを組み立てる。
// 1回の録音/アップロードに複数の音(スケール等)が含まれていても、それぞれの音ごとに
// 平均値を算出して目安(理想値プロファイル)として持つ。計測タブの録音後・アップロード解析後・
// セッション詳細画面の「目安に設定」ボタンから共通で使う。
function buildIdealProfileFromSession(session, name, NUM_HARMONICS = 8, tuningHz = null) {
  return buildIdealProfileFromSessions([session], name, NUM_HARMONICS, tuningHz, "session");
}

// 複数セッションから理想値プロファイルを作る(F-68「この奏者の平均」)。
// **プロファイルの構造(getNoteIdeal が引く notes[semitoneIndex])は単一セッションと同じ。**
// 構造を変えると既に保存されているプロファイルが読めなくなるため、増えるのは
// 「どのセッション由来か」の記録(sourceKind / sourceSessionIds)だけにする。
// sourceSessionIds は F-67 の「理想値設定中」の判定に使う。**古いプロファイルは
// このフィールドを持たない**ので、読む側は必ず Array.isArray() で確かめること。
function buildIdealProfileFromSessions(sessionList, name, NUM_HARMONICS = 8, tuningHz = null, sourceKind = "session") {
  const list = (sessionList || []).filter(Boolean);
  const noteGroups = groupFramesByNoteAcrossSessions(
    list.map((s) => s.frames || []), NUM_HARMONICS, list[0]?.saxType ?? null, tuningHz);
  const notes = {};
  for (const g of noteGroups) notes[g.semitoneIndex] = g;
  return {
    id: generateId(),
    name,
    // 楽器種別は対象セッションで揃っている(selectPerformerSessions が同じ saxType だけを選ぶ)
    saxType: list[0]?.saxType ?? null,
    recordedAt: new Date().toISOString(),
    notes,
    sourceKind,
    sourceSessionIds: list.map((s) => s.id).filter((id) => id !== null && id !== undefined),
  };
}

// 【F-68】「この奏者の平均」の対象セッションを選ぶ。
// **同じ楽器種別のセッションだけ**を対象にする(アルトとテナーの平均は音域も移調も違うので
// 音ごとの理想値として意味を成さない)。奏者名は未設定を「自分」と読む
// (セッション詳細の表示・計測タブの既定値と同じ扱い)。
// 対象セッション自身が一覧に無い場合(保存直後で反映前など)でも必ず含めるので、
// 戻り値が空になることはない。対象が1件しかなければ「このセッション」と同じ結果になる。
function idealPerformerKeyOf(session) {
  return (session && session.performer) || "自分";
}
function selectPerformerSessions(sessions, session) {
  if (!session) return [];
  const key = idealPerformerKeyOf(session);
  const list = (sessions || []).filter((s) =>
    s && idealPerformerKeyOf(s) === key && s.saxType === session.saxType && (s.frames || []).length > 0);
  if (!list.some((s) => s.id === session.id)) return [session, ...list];
  return list;
}

// 「このセッションのデータが、いま選ばれている理想値に入っているか」(F-67の「理想値設定中」)。
// 由来を持たない古いプロファイルでは常に false(クラッシュさせず、単に出さないフォールバック)。
function isSessionInIdeal(profile, session) {
  if (!profile || !session || session.id === null || session.id === undefined) return false;
  if (!Array.isArray(profile.sourceSessionIds)) return false;
  return profile.sourceSessionIds.includes(session.id);
}

// ============================================================================
// グラフ共通の仕組み。リード比較(NoteAxisLineChart)とピボット(PivotLineChart)の
// 両方がここから引く。同じ規則を2箇所に書かないためにこの位置に置いている。
// ============================================================================

// グラフSVG内の文字サイズ。SVGの fontSize 属性には var() が書けないため、
// --fs-xs(12px) の値をここで一度だけ数値にする(マジックナンバーを散らさない)。
// DESIGN-SYSTEM §4.1: グラフSVG内の 9/9.5/10/11px は --fs-xs まで引き上げる。
const SVG_FS_XS = 12;

// SVG内の余白。DESIGN-SYSTEM §1.9「目盛ラベルの左右余白は --sp-2(8px) 以上」。
// --sp-1(4px) では足りない: getComputedTextLength() は送り幅で、和文グリフのインクは
// それを最大1.6px程度超えるため、4pxだと「たまたま足りていた」にしかならない。
const SVG_SP1 = 4;
const SVG_SP2 = 8;

// 折れ線グラフの系列スタイル(DESIGN-SYSTEM §1.7 系列色 / §1.8 線の太さ)。
// 機能色(緑/橙/赤)は音程の正誤という意味を持つので系列識別に流用しない。
// グレー(--c-ink-3)は理想値の破線用に予約されているので系列が取らない。
// 紺の明度段階3段 × 線種(実線/破線)の6系列。7系列以上は色を足さず表示を絞る。
// 薄い色ほど太くしないと同じ強さに見えないため、--c-accent-line だけ 3px(§1.8)。
// 色は CSS 変数で持つ(presentation属性では var() が解決されないため style で当てる)。
const SERIES_STYLES = [
  { color: "var(--c-accent)",      width: 2, dash: null },
  { color: "var(--c-accent-mid)",  width: 2, dash: null },
  { color: "var(--c-accent-line)", width: 3, dash: null },
  { color: "var(--c-accent)",      width: 2, dash: "4 3" },
  { color: "var(--c-accent-mid)",  width: 2, dash: "4 3" },
  { color: "var(--c-accent-line)", width: 3, dash: "4 3" },
];

// 理想値(目安)の線。DESIGN-SYSTEM §1.7 が --c-ink-3 を理想値の破線に予約しているので、
// 系列がこの色を取らないようにここで1箇所に定義しておく。破線パターンは §1.8 の "4 3"。
const IDEAL_LINE_STYLE = { color: "var(--c-ink-3)", width: 2, dash: "4 3" };

// (【N-10 2026/08/17 本人指示】N-8 の HERO_CHART_* = 紺のヒーローの中の折れ線の配色は、
//  案K 採用で紺のカードそのものが無くなったため削除した。使い手の無い定義を残さない。)

// 【N-10 2026/08/17 本人指示】ばらつきの帯(正典 案K の .stock 下の面)の塗り。
// 正典の --ghost は #EAEFF6 だが、**新しい hex を足さず**体系内でいちばん薄い紺系の面
// (--c-accent-tint = #EAEFF5。1/255 の差)をそのまま使う。線(--c-accent-line)より薄いので
// 帯の上に重なる2本の折れ線が沈まない。
const CHART_BAND_FILL = "var(--c-accent-tint)";

// SVG内テキストの実描画幅(px)を測る。--font-num / --font-jp は入れ子の var() を含むため
// getComputedStyle().getPropertyValue() では未解決の文字列しか得られない(resolveBottomGap と同じ罠)。
// 実際に文書へ置いた <text> の getComputedTextLength() で測ることで確定値を取る。
let _svgTextProbe = null;
function measureSvgTextPx(s, fontPx, fontFamily = "var(--font-num)") {
  const str = String(s);
  if (typeof document === "undefined") return str.length * fontPx * 0.6;
  if (!_svgTextProbe) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none";
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    svg.appendChild(t);
    document.body.appendChild(svg);
    _svgTextProbe = t;
  }
  _svgTextProbe.style.fontFamily = fontFamily;
  _svgTextProbe.style.fontSize = `${fontPx}px`;
  _svgTextProbe.textContent = str;
  return _svgTextProbe.getComputedTextLength();
}

// ラベルを与えられた幅に収める。入らないときだけ末尾を「…」に畳む。
// 文字数ではなく実描画幅で判定するので、和文/欧文が混じっても切り位置が破綻しない。
// 縦軸の項目ラベルと凡例はこの同一の規則を共有する(同じ値が両方に出たとき表記が食い違わないため)。
function fitLabel(s, maxPx, fontPx, fontFamily = "var(--font-num)") {
  const str = String(s);
  if (maxPx <= 0 || measureSvgTextPx(str, fontPx, fontFamily) <= maxPx) return str;
  let lo = 0, hi = str.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureSvgTextPx(str.slice(0, mid) + "…", fontPx, fontFamily) <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? "…" : str.slice(0, lo) + "…";
}

// 描画コンテナの実ピクセル幅を返す。グラフはこの実測値に追従させ、SVGは viewBox と実寸を
// 1:1 に保つ(preserveAspectRatio による全体縮小はしない。縮小すると 12px の文字が
// 実効 9.6px になり DESIGN-SYSTEM §4.1「グラフ内は --fs-xs 以上」が破れる)。
function useMeasuredWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  // 小数のはみ出しで横スクロールが出ないよう、実測値は必ず切り捨てて使う
  const measure = () => {
    const el = ref.current;
    if (el) setW(Math.floor(el.getBoundingClientRect().width));
  };
  useLayoutEffect(() => {
    if (!ref.current) return;
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // レンダーのたびに測り直す。グラフを描いたことでページが伸びて縦スクロールバーが出ると
  // コンテナはその幅ぶん狭まるが、そこで ResizeObserver を取りこぼすとSVGだけ古い幅のまま
  // 残ってコンテナからはみ出す(768pxで15pxはみ出す実例があった)。値が変わらなければ
  // setState は再レンダーを起こさないので、この測り直しはループしない。
  useLayoutEffect(() => { measure(); });
  return [ref, w];
}

// 系列の線サンプル。色だけでは実線/破線の別が伝わらないので、凡例も選択チップも
// 実際の線種で描く。選択中のチップは --c-accent の面なので、その上でも1本目
// (--c-accent の実線)が沈まないよう、常に --c-on-accent の小さな面の上に置く。
function SeriesSwatch({ style: st, width = 14 }) {
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, background: "var(--c-on-accent)", borderRadius: 2, padding: 2 }}>
      <svg width={width} height={st.width} style={{ display: "block", overflow: "visible" }}>
        <line x1="0" y1={st.width / 2} x2={width} y2={st.width / 2} strokeWidth={st.width} strokeDasharray={st.dash || undefined} style={{ stroke: st.color }} />
      </svg>
    </span>
  );
}

// 【F-66 2026-08-08】平均差分(ピッチ)カードの副次テキスト「標準偏差 ±5.3¢」。
// 【N-2 表記統一】表示は「ピッチ誤差」→「平均差分」、「ばらつき」→「標準偏差」
// (2026-08-10 本人決定)。量の意味・計算は変えていない。
//
// 本人報告「データタブのピッチ誤差が肌感覚より過剰に合っている気がする。±5くらいずれて
// いそうな感覚でも ±1以内で出ることがある」の正体は、主役の数字(pitchCentsSigned)が
// **符号付きの加重平均**であることそのもの。+5¢ と −5¢ を行き来していると打ち消し合って
// 0 に近づくため「一度も合っていないのに 0¢」が起こる。つまり主役は「偏り(平均して
// シャープ寄りかフラット寄りか)」であって「精度(どれくらい外しているか)」ではない。
// 本人が感じている「±5」は後者なので、採用フレームの標準偏差(pitchStabilityCents)を
// 精度の目安として副次テキストで併記する。**主役の数字の意味・計算は変えない**(F-46)。
//
// 導出はこの1箇所だけに置く。表示する4画面(My Data / 最新セッション / セッション詳細 /
// 登録済みリードの測定データ)は指標定義の sub を呼ぶだけにして、同じ式を写さない
// (F-46 で SESSION_METRICS を廃止して1配列に統合したのと同じ考え方)。
// 採用フレームが2未満のとき stddev は null を返す。そのときは**副次テキストごと出さない**
// (「±null¢」「±NaN¢」を出さない)。桁は主役と揃えて小数1桁。
// 【N-6】表示の形は2つあるが**導出は1つ**。正典 .hero .sd は「±3.4¢ · 平均 −0.8¢」で
// 語を持たない(本人指示「青いカード部分のテキストが多い」)ので、ヒーローだけ bare を渡す。
// 数字の作り方(小数1桁・欠測は null)を2箇所に写さないための引数であって、別の量ではない。
// 符号付きの差分(¢)の書式。**丸めた結果が 0.0 なら符号を付けない**。
// 【2026-08-15 本人指示】「ピッチがちょうど 0 のときの表示は 0.0¢ で」。
// 素直に `v >= 0 ? "+" : ""` と書くと `+0.0`、`v > 0` にすると今度は
// `(-0.04).toFixed(1)` が `-0.0` になって `-0.0¢` が出る。**どちらの側も 0 は 0**。
// 書式をこの1関数に寄せ、リード比較・個体詳細・セッション詳細・My Data・目安との差(Δ)が
// 同じ規則で出るようにする(以前は同じ式が3箇所に写されていた)。
function formatSignedCents(v) {
  const t = v.toFixed(1);
  if (t === "0.0" || t === "-0.0") return "0.0";
  return v > 0 ? `+${t}` : t;
}

function pitchSpreadSub(metrics, opts) {
  const sd = metrics?.pitchStabilityCents;
  if (sd === null || sd === undefined || isNaN(sd)) return null;
  const v = `±${sd.toFixed(1)}¢`;
  return opts?.bare ? v : `標準偏差 ${v}`;
}

// リード別比較・リード個別・個別セッションで共通する比較項目の定義。
// (【N-6】「最新セッション」カードはこの案件で無くなった。データタブの「最新」の行は
//  別配列 MY_DATA_METRICS を使うので、ここの一覧に含めない)
// 【2026-08-04 F-46 本人指示】ピッチは全画面「符号付きのピッチ誤差」に統一(以前の
// 「リード比較系だけ絶対値のまま」という指示は本人自身が上書き)。これにより
// 旧SESSION_METRICS(符号付き差し替え版)と同一になったため配列を1つに統合した。
const REED_COMPARE_METRICS = [
  { key: "hnrDb", label: "HNR", unit: "dB", fmt: (v) => v.toFixed(1) },
  // 【N-6】ラベルは正典どおり「重心」。長らく「スペクトル重心」だったのは、
  // north-star-coverage.md が**意図的な相違**として記録していたため。正典に合わせる。
  // 影響先は**この配列を使う3画面だけ**: リード比較 / 個体詳細 / セッション詳細。
  // データタブ(My Data)は別配列 MY_DATA_METRICS を使うので、**ここを直しても変わらない**
  // (統括が最初この配列だけ直して「直った」と誤報告し、審査で露見した。
  //  あちらのラベルは MY_DATA_METRICS 側で別に正典へ寄せてある)。
  // 計測タブの詳細カードはさらに別の文字列リテラルなので、これも変わらない。
  { key: "spectralCentroidHz", label: "重心", unit: "Hz", fmt: (v) => Math.round(v).toString() },
  { key: "volumeDb", label: "音量", unit: "dB", fmt: (v) => v.toFixed(1) },
  // sub は副次テキストの導出(F-66)。平均差分(ピッチ)だけが持つ。カード側は m.sub?.(metrics) を渡す
  { key: "pitchCentsSigned", label: "平均差分", unit: "¢", fmt: formatSignedCents, sub: pitchSpreadSub },
];

// 【N-5】個体詳細の .numrow に並べる指標と**その順**。正典は 平均差分 / HNR / 重心 / 音量。
// 比較タブの4グラフの順(音量 / 平均差分 / HNR / 重心)とは別なので、配列を分けて持つ。
// 中身の定義(ラベル・単位・書式・副次テキスト)は REED_COMPARE_METRICS が唯一の答えで、
// ここはキーの並びだけを持つ(定義を2箇所に写さない)。
const REED_DETAIL_METRICS = ["pitchCentsSigned", "hnrDb", "spectralCentroidHz", "volumeDb"];
// 比較タブの4グラフの並び(正典の比較画面の順)。同じ理由でキーの並びだけを持つ。
const REED_COMPARE_CHART_KEYS = ["volumeDb", "pitchCentsSigned", "hnrDb", "spectralCentroidHz"];

// リード比較の系列スタイルは SERIES_STYLES(DESIGN-SYSTEM §1.7)をそのまま使う。
// 以前はここに専用の hex パレットがあり、4・5番目が機能色(#D97706 注意 / #16A34A 良い)の
// 流用、6番目 #8D95A1 が理想値の破線と同色で6枚目のリードと理想線が見分けられなかった。

// --- 10.4(a): リード別比較(複数リードをグラフで視覚比較) ---
//
// 【N-5】正典 = design/north-star-measure.html の「比較」画面。
//   箱ごとに .rname(13.5px)+「n枚選択中」(11px) の見出し → 個体チップの .selrow
//   選択中のチップには**系列の線種見本**が付く(色だけでは実線/破線が伝わらない)
//   その下に4グラフ(音量 / 平均差分 / HNR / スペクトル重心)・★一覧・フレーム数脚注
// 機能はすべて現行のまま(6本制限の告知・空状態2種・チップのトグル)。
// 箱の開閉(chevron)は正典に無いので**常時展開**にした(タイル同様、畳む必要がない密度)。
function ReedCompareTab({ reeds, sessions, compareReedIds, setCompareReedIds, saxType, tuningHz }) {
  const toggleReed = (id) => {
    setCompareReedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // フレーム総数はモジュールスコープの frameCountFor(sessions, reedId) を使う。
  // 【N-5】ここには同じ集計のローカル版があり、一覧の「育てる」行が module 版、
  // この画面がローカル版という二重実装になっていた。一覧の行が無くなって module 版の
  // 読み手が0になったので、**同じ数を2箇所で作らない**ようローカル版を畳んだ。
  const framesOf = (reedId) => frameCountFor(sessions, reedId);

  if (reeds.length === 0) {
    return <div className="sans" style={{ fontSize: 12, color: "var(--c-ink-3)", textAlign: "center", padding: 30 }}>比較するリードがありません。まず「登録」タブでリードを登録してください</div>;
  }

  const selectedItems = compareReedIds
    .map((id) => reeds.find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => ({ reed: r, label: reedLabel(r, reeds), frameCount: framesOf(r.id) }));

  // 見分けのつく系列は6本まで。7本目以降は色を足さず表示を絞る(DESIGN-SYSTEM §1.7)。
  // 選択順に SERIES_STYLES を割り当て、チップの線サンプル・折れ線・凡例で同じ線種を使う。
  const items = selectedItems.slice(0, SERIES_STYLES.length);
  const hiddenCount = selectedItems.length - items.length;
  const styleById = new Map(items.map((it, i) => [it.reed.id, SERIES_STYLES[i]]));

  return (
    <div>
      {groupReeds(reeds).map((g) => {
        const selectedInBox = g.members.filter((r) => compareReedIds.includes(r.id)).length;
        return (
          <div key={g.key} style={{ padding: "16px 0 4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
              {/* 正典の比較画面の見出しは .rname の 13.5px(一覧の 15px より一段小さい) */}
              <span className="sans" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--c-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {g.brand} <span style={{ color: "var(--c-ink-3)", fontWeight: 400 }}>{g.strength}</span>
              </span>
              {selectedInBox > 0 && (
                <span className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", flexShrink: 0 }}>{selectedInBox}枚選択中</span>
              )}
            </div>
            {/* 正典 .selrow / .selpill。選択中は紺の塗り + 線種見本。
                見た目のピルは 44 に満たないので、外側の <button> が当たり判定を持つ(§5)。 */}
            <div style={{ display: "flex", gap: 7, justifyContent: "flex-start", flexWrap: "wrap" }}>
              {g.members.map((r, idx) => {
                const sel = compareReedIds.includes(r.id);
                return (
                  <button key={r.id} onClick={() => toggleReed(r.id)}
                    aria-pressed={sel}
                    aria-label={`${reedPosition(r, reeds) ?? idx + 1}枚目を比較に入れる`}
                    className="sans no-select"
                    style={{
                      minHeight: "var(--tap-min)", minWidth: "var(--tap-min)", padding: 0,
                      background: "transparent", border: "none",
                      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                      fontSize: 12.5, padding: "4px 11px", borderRadius: 999, fontFamily: "var(--font-num)",
                      border: sel ? "1px solid transparent" : "1px solid var(--c-line-strong)",
                      background: sel ? "var(--c-accent)" : "transparent",
                      color: sel ? "var(--c-on-accent)" : "var(--c-ink-2)",
                      fontWeight: sel ? 600 : 400,
                    }}>
                      {sel && styleById.has(r.id) && <SeriesSwatch style={styleById.get(r.id)} />}
                      #{reedPosition(r, reeds) ?? idx + 1}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {items.length === 0 ? (
        <div className="sans" style={{ fontSize: 12, color: "var(--c-ink-3)", textAlign: "center", padding: 20 }}>リードを選択すると比較グラフが表示されます</div>
      ) : (
        <div style={{ paddingTop: 18 }}>
          {hiddenCount > 0 && (
            <div className="sans" style={{ fontSize: 12, color: "var(--c-ink-2)", marginBottom: 12 }}>
              選択中{selectedItems.length}枚のうち先頭6枚を表示しています（見分けのつく系列は6本まで）。残り{hiddenCount}枚は選択を外すと入れ替わります
            </div>
          )}
          {/* 全指標(音量・平均差分・HNR・スペクトル重心)を音名ごとの折れ線で比較(横軸=音名, 縦軸=値) */}
          {REED_COMPARE_CHART_KEYS.map((key) => {
            const m = REED_COMPARE_METRICS.find((x) => x.key === key);
            return (
              <NoteAxisLineChart
                key={key}
                label={m.label}
                unit={m.unit}
                metricKey={key}
                series={items.map((it) => ({
                  id: it.reed.id, label: it.label, style: styleById.get(it.reed.id),
                  frames: sessions.filter((s) => s.reedId === it.reed.id).flatMap((s) => s.frames || []),
                }))}
                saxType={saxType}
                tuningHz={tuningHz}
                fmt={m.fmt}
              />
            );
          })}
          {/* ★一覧。正典は「#1 ★3.7」の**文字**で1行に並べる(星の絵は使わない)。 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", alignItems: "center", padding: "11px 0", borderTop: "1px solid var(--c-line)", borderBottom: "1px solid var(--c-line)" }}>
            {items.map((it) => {
              const avg = normalizeReedScoreOf("rating", it.reed.rating);
              return (
                <span key={it.reed.id} className="sans" style={{ fontSize: 13, color: "var(--c-ink)" }} title={it.label}>
                  #{reedPosition(it.reed, reeds)} <span style={{ color: "var(--c-ink-3)" }}>{avg === null ? "★—" : `★${avg.toFixed(1)}`}</span>
                </span>
              );
            })}
          </div>
          <div className="sans" style={{ fontSize: 10, color: "var(--c-ink-3)", paddingTop: 8 }}>
            {items.map((it) => `${it.label}: ${it.frameCount}フレーム`).join(" ・ ")}
          </div>
        </div>
      )}
    </div>
  );
}

// 横軸=音名(選択楽器の音域)、縦軸=指標値の折れ線グラフ。
// 各系列(比較リード or 自分)のフレームを運指(semitoneIndex=音)ごとに平均し、音域の
// 低音→高音の順に線で結ぶ。データのある音だけ点を打ち、連続する音の間を線でつなぐ
// (欠けている音はギャップにする)。横軸の音名は選択中の楽器種別ごとに変わる。
// selectedIdeal+idealKeyを渡すと、音ごとの理想値も破線の折れ線で重ねる。
// 【N-6】idealDiffText: 目安との差(Δ)を凡例の「目安」の隣に添える。
// 正典 .mrow には常時表示の Δ を置く列が無いので、**常時表示をやめてグラフ側へ移した**
// (情報は失わせない。DESIGN-SYSTEM §6.0「今に関係ない物は出ていない」)。
// 破線(目安)が出ているときにしか意味を持たない値なので、凡例の「目安」と同じ条件でだけ描く。
// 【N-7 2026/08/16】plain: 見出し行(ラベル)と系列の凡例を**描かない**。データタブ(My Data)の
// グラフは、見出しと凡例を正典(【N-10】design/mydata-zero-proposals-2.html の案K)の
// .lbl / .legend の形で**呼び出し側が持つ**ため(ここが二重に描くと見出しが2つ並ぶ)。
// 目安の凡例(実測/目安/Δ)は plain でも描く: 目安の破線と Δ の置き場所は N-6 のまま
// (【N-8】My Data は selectedIdeal を渡さなくなったので描かれない。他画面は従来のまま)。
// 既定 false = リード比較・個体詳細・セッション詳細は従来のまま。
// (【N-10 2026/08/17 本人指示】N-8 の hero 変形は**廃止**した。紺のヒーローそのものが
//  案K の採用で無くなったため、渡し手が1つも無くなった。使い手の無い引数を残さない。)
// 【N-10 2026/08/17 本人指示】bandByIdx / bandSeriesId: 正典 案K の**ばらつきの帯**。
// bandSeriesId で指定した系列の値を中心に、音ごとに ±bandByIdx[音] の帯を敷く。
// 帯の半幅の**作り方**は呼び出し側が持ち、ここは描くだけ(グラフの部品に集計規則を持たせない)。
// 【D-1 2026/08/22】**この引数を渡す呼び出し側は今は1つも無い。** My Data の折れ線が
// Design canon #9b の採用でマトリクスへ置き換わり、半幅を作っていた noteSpreadByIndex も
// 読み手ゼロになったので削除した。描く側の仕組みだけをここに残してある
// (次の周で分析タブが折れ線を引き継ぐかを見てから、残すか落とすかを決める。BACKLOG 起票済み)。
// 【N-11 2026/08/17 本人指示】includeAltissimo: 横軸にフラジオ域(F-103 の +4 半音)を含めるか。
// **既定 true = 既存の呼び出し側(リード比較・個体詳細・セッション詳細・PIVOT・計測)は
// 従来のまま。** false を渡すのは My Data のグラフだけ(本人「My Data のカードのグラフには
// フラジオを入れなくてよい。他は入れる」)。音数の作り方は noteAxisCount の1箇所。
// 【N-11 2026/08/17 本人指示】axisOverlay: 縦軸の目盛ラベルを**プロットに重ねて**描き、
// 左に軸用の余白(AXW)を取らない。線の描画幅がそのぶん広がる(本人「左のY軸ラベルが横幅を
// 取るのでY軸をずらしてグラフの横幅を増やして」)。**既定 false = 既存の呼び出し側は不変。**
function NoteAxisLineChart({ label, unit, metricKey, series, saxType, tuningHz, fmt, selectedIdeal, idealKey, noteFocus = null, idealDiffText = null, plain = false, bandByIdx = null, bandSeriesId = null, includeAltissimo = true, axisOverlay = false }) {
  // 幅は固定しない。コンテナの実測幅に音域全体を収める(DESIGN-SYSTEM §1.9)。
  // 以前は COL=26 の固定列幅で W=33音×26=858px あり、375pxでは31%しか見えていなかった。
  const [boxRef, W] = useMeasuredWidth();
  const table = buildFingeringTable(saxType, tuningHz, noteAxisCount(saxType, includeAltissimo) ?? undefined);
  const N = table.length;
  const noteLabels = table.map((e) => concertFreqLabel(e.soundingFreqHz, tuningHz) || "");

  // 系列ごとに音(semitoneIndex)別の代表値を出す(groupFramesByNoteの共通ロジックに従う:
  // 音量・音色はclarity重み+アタック除外、ピッチはF-44のゲートを通した中央値)。
  // groupFramesByNoteは重心を"centroidHz"で返すため対応づける。
  const groupKey = metricKey === "spectralCentroidHz" ? "centroidHz" : metricKey;
  let seriesData = series.map((s) => {
    const byIdx = {};
    for (const g of groupFramesByNote(s.frames || [], undefined, saxType, tuningHz)) {
      // 【N-11 2026/08/17】**この軸に無い音は持ち込まない。** groupFramesByNote は音域の全音
      // (フラジオ込みの 37 音)で分けるので、includeAltissimo=false のときは上の 4 音が
      // 余る。ここで落とさないと、折れ線は繋がらないのに**点だけが軸の外へ描かれ**、
      // 縦のスケールもその値に引きずられる(375×812 の実測で実際に出た: 軸の右端 x=333 に
      // 対して点が x=371 まで並んだ)。落とすのは描画の範囲だけで、集計の規則は触らない。
      if (g.semitoneIndex >= N) continue;
      const v = g[groupKey];
      if (v !== null && v !== undefined && !isNaN(v)) byIdx[g.semitoneIndex] = v;
    }
    return { ...s, byIdx };
  });

  // 理想値プロファイルの音ごとの値(存在する音だけ)。実測と同じ音名軸に破線で重ねる
  let idealByIdx = null;
  if (selectedIdeal && idealKey) {
    const m = {};
    for (let i = 0; i < N; i++) {
      const v = getNoteIdeal(selectedIdeal, i)?.[idealKey];
      if (v !== null && v !== undefined && !isNaN(v)) m[i] = v;
    }
    if (Object.keys(m).length) idealByIdx = m;
  }

  // noteFocus: 横軸の「ラベル表示」だけを絞り込む(データタブの「My Data」「最新セッション」
  // カードのみが渡す)。プロットするデータ(折れ線・y軸スケール)は音域の全音を対象のまま。
  const plotN = N;
  const plotNoteLabels = noteLabels;

  // 【N-10】帯(±)の実体。中心は bandSeriesId の系列の値、半幅は呼び出し側が渡した音ごとの量。
  // 両方が読める音だけが帯を持つ(片方しか無い音は帯を出さない = 穴を作らない)。
  const bandBounds = (() => {
    if (!bandByIdx || bandSeriesId === null || bandSeriesId === undefined) return null;
    const center = seriesData.find((s) => s.id === bandSeriesId);
    if (!center) return null;
    const m = {};
    for (const key of Object.keys(bandByIdx)) {
      const c = center.byIdx[key];
      const half = bandByIdx[key];
      if (c === null || c === undefined || isNaN(c)) continue;
      if (half === null || half === undefined || isNaN(half)) continue;
      m[key] = { hi: c + half, lo: c - half };
    }
    return Object.keys(m).length ? m : null;
  })();

  // 縦のスケールは帯の上下端も含めて決める(帯だけが枠から出て切れる、を作らない)
  const allVals = [
    ...seriesData.flatMap((s) => Object.values(s.byIdx)),
    ...(idealByIdx ? Object.values(idealByIdx) : []),
    ...(bandBounds ? Object.values(bandBounds).flatMap((b) => [b.hi, b.lo]) : []),
  ];
  const hasData = seriesData.some((s) => Object.keys(s.byIdx).length > 0);
  const minV = allVals.length ? Math.min(...allVals) : 0;
  const maxV = allVals.length ? Math.max(...allVals) : 1;
  // 符号付きピッチ誤差(pitchCentsSigned)は0を挟んで上がシャープ側・下がフラット側になる
  // ように、0中心の対称ドメイン(lo = -hi)にする。データ自体が既に符号を持つので、
  // 折れ線は通常どおり1本。
  // 【2026-08-04 本人指示】以前は「ピッチの安定度」(pitchStabilityCents = 標準偏差、常に非負)を
  // ±v の2本のミラー折れ線で帯として見せていたが、「0を挟んで上が＋・下がマイナス、線は1本」
  // という指示によりMy Dataの該当カードは符号付きの平均ズレ(pitchCentsSigned)に変わったため、
  // ミラー描画は使う指標が無くなり撤去した(MY_DATA_METRICS のコメントを見ること)。
  const isSignedCentered = metricKey === "pitchCentsSigned";
  let lo, hi, rng;
  if (isSignedCentered) {
    const maxAbs = allVals.length ? Math.max(...allVals.map((v) => Math.abs(v))) : 0;
    hi = maxAbs || 1; // 実測が全て0(またはデータ無し)のときのゼロ除算だけ避ける
    lo = -hi;
    rng = hi - lo || 1;
  } else {
    const pad = (maxV - minV) * 0.12 || Math.abs(maxV) * 0.1 || 1;
    lo = minV - pad; hi = maxV + pad; rng = hi - lo || 1;
  }

  // 音名軸の目印: 音域の中央に最も近いE♭を1つだけ強調する(今どのあたりを吹いているか掴みやすくする)。
  const ebIndexes = plotNoteLabels.map((nm, i) => (nm.startsWith("E♭") ? i : -1)).filter((i) => i >= 0);
  const axisCenter = (plotN - 1) / 2;
  const midEbIdx = ebIndexes.length
    ? ebIndexes.reduce((best, i) => (Math.abs(i - axisCenter) < Math.abs(best - axisCenter) ? i : best), ebIndexes[0])
    : null;

  // レイアウトは実測幅から毎回引き直す。音数(N)が増えても列幅が縮むだけで、
  // 横スクロールは出さない。SVGの実寸と viewBox は 1:1 に保つ
  // (preserveAspectRatio で全体を縮めると 12px の文字が実効 9.6px になり §4.1 が破れる)。
  const L = (() => {
    if (!hasData || W <= 0) return null;
    const FS = SVG_FS_XS;
    const plotH = 94;                 // 4指標が縦に積まれるため従来の作図高さを踏襲する
    const padTop = SVG_SP2;

    // 縦軸は上端・中間・下端の3値。中間値が無いと、横に長い折れ線のどこが基準か掴めない。
    const tickVals = [hi, (hi + lo) / 2, lo];
    // fmt にはどの指標でも生の値をそのまま渡す(符号付き指標の fmt は自分で "+"/"-" を付ける)。
    // 以前ここで絶対値に潰していたのは "±" を前置する安定度の fmt が負の目盛で "±-4.4" と
    // 二重符号になるのを避けるためだったが、その指標(ミラー描画)ごと撤去したので不要になった。
    const tickTexts = tickVals.map((v) => fmt(v));
    const tickW = Math.ceil(Math.max(...tickTexts.map((t) => measureSvgTextPx(t, FS))));
    // 目盛ラベルの左右に --sp-2 以上(§1.9)。measureSvgTextPx は送り幅なので、実インクは
    // 左右どちらにも送り幅を最大1px程度はみ出す(実測: 右 0.7px / 左 0.95px)。
    // --sp-1 を逃げとして足す。足さないと実測が 7.3px / 7.05px と 8px を割る。
    const TICK_GAP = SVG_SP2 + SVG_SP1;      // 目盛ラベルの左右の余白
    // 【N-11 2026/08/17 本人指示】axisOverlay のときは**左に軸の柱を立てない**(AXW = 0)。
    // 目盛の文字はプロットの左上へ重ねて描く(下の tickX / tickTextY)。
    // 重ねるぶん、線の描画幅が AXW = TICK_GAP + 目盛の文字幅 + TICK_GAP ぶん広がる。
    const AXW = axisOverlay ? 0 : TICK_GAP + tickW + TICK_GAP;

    // 音名ラベルは中央揃えなので両端で半分ぶん外へ出る。送り幅より実インクが広くなる
    // ぶん(和文で最大1.6px程度)の逃げに --sp-1 を足してからプロット域を決める。
    const maxLblW = Math.ceil(Math.max(0, ...plotNoteLabels.map((nm) => measureSvgTextPx(nm, FS))));
    const halfLbl = Math.ceil(maxLblW / 2) + SVG_SP1;
    // 重ねるときの左端は右端(W - SVG_SP2 - halfLbl)と対称にする。
    const x0 = axisOverlay ? SVG_SP2 + halfLbl : AXW + halfLbl;
    const x1 = Math.max(x0 + 1, W - SVG_SP2 - halfLbl);
    const colStep = (x1 - x0) / Math.max(1, plotN - 1);

    // 間引くのは**ラベルだけ**(データ点は全音描く。線の形が比較の実体)。
    // 間引き幅は12の約数から選び、どの幅でもオクターブ単位で同じ音名が残るようにする。
    const need = maxLblW + SVG_SP2;   // 隣り合うラベルの中心間に要る幅(隙間は --sp-2 以上)
    const labelStep = [1, 2, 3, 4, 6, 12].find((s) => s * colStep >= need)
      ?? Math.max(12, Math.ceil(need / colStep / 12) * 12);
    const labelAnchor = midEbIdx ?? 0;
    // noteFocus 指定時はデータを絞らず、ラベル表示だけを noteFocus に含まれる音名に絞る。
    const showLabel = noteFocus
      ? (i) => noteFocus.includes(plotNoteLabels[i])
      : (i) => (((i - labelAnchor) % labelStep) + labelStep) % labelStep === 0;

    // 点が隣とくっついて見えないよう、直径は音の間隔の6割までに抑える(上限3px)
    const dotR = Math.max(1.5, Math.min(3, colStep * 0.3));
    const labelY = padTop + plotH + SVG_SP2 + Math.round(FS * 0.8);
    const yAt = (v) => padTop + plotH - ((v - lo) / rng) * plotH;
    return {
      FS, plotH, padTop, AXW, TICK_GAP, tickVals, tickTexts, dotR, labelY, showLabel,
      H: labelY + SVG_SP1,
      xAt: (i) => x0 + i * colStep,
      yAt,
      // 【N-11】目盛ラベルの置き方。重ねるときは左端から start 揃えで、目盛線の**上**に乗せる
      // (正典 案P の <text x="3" y="…"> と同じ形)。上端の目盛だけは SVG の外へ出るので、
      // 文字の高さぶんだけ下げて必ず枠内に収める。
      gridX0: axisOverlay ? 0 : AXW,
      tickX: axisOverlay ? SVG_SP2 : AXW - TICK_GAP,
      tickAnchor: axisOverlay ? "start" : "end",
      tickTextY: axisOverlay
        ? (v) => Math.max(Math.round(FS * 0.85), yAt(v) - SVG_SP1)
        : (v) => yAt(v) + Math.round(FS * 0.35),
    };
  })();

  // データのある音を連続区間(欠けで分割)ごとにpolylineにする
  const segmentsFor = (byIdx) => {
    const segs = []; let cur = [];
    for (let i = 0; i < plotN; i++) {
      if (byIdx[i] !== undefined) cur.push(`${L.xAt(i)},${L.yAt(byIdx[i])}`);
      else { if (cur.length) segs.push(cur); cur = []; }
    }
    if (cur.length) segs.push(cur);
    return segs;
  };

  // 【N-10】帯の塗り。折れ線と同じ「欠けで分割」の規則で連続区間ごとに閉じた多角形にする
  // (上辺を左→右、下辺を右→左)。帯が1音しか無い区間は面にならないので描かない。
  const bandPaths = () => {
    if (!bandBounds) return [];
    const runs = []; let cur = [];
    for (let i = 0; i < plotN; i++) {
      if (bandBounds[i] !== undefined) cur.push(i);
      else { if (cur.length) runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    return runs.filter((r) => r.length >= 2).map((r) => {
      const top = r.map((i) => `${L.xAt(i)},${L.yAt(bandBounds[i].hi)}`);
      const bottom = r.slice().reverse().map((i) => `${L.xAt(i)},${L.yAt(bandBounds[i].lo)}`);
      return `M${top.join("L")}L${bottom.join("L")}Z`;
    });
  };

  // 凡例のリード名は縦軸ラベルと同じ規則で畳む(fitLabel を共有)。
  const legendMax = Math.round(W * 0.42);
  const legendPad = L ? L.AXW : 0;

  return (
    // plain(N-7)のときは下余白も持たない(行の余白は正典 .mrow の padding が持つ)
    <div style={{ marginBottom: plain ? 0 : 18 }}>
      {!plain && <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginBottom: 6 }}>{label}{unit ? `（${unit}）` : ""}</div>}
      {!hasData ? (
        <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>この音域のデータがまだありません</div>
      ) : (
        // 実測前(W=0)は箱だけ描いて幅を測る。useLayoutEffect で測るのでちらつきは出ない
        <div ref={boxRef}>
          {L && (
            <svg width={W} height={L.H} viewBox={`0 0 ${W} ${L.H}`} style={{ display: "block" }}>
              {/* 縦軸(値)の目盛と水平グリッド: 上端・中間・下端。 */}
              {L.tickVals.map((v, k) => (
                <g key={k}>
                  <line x1={L.gridX0} y1={L.yAt(v)} x2={W} y2={L.yAt(v)} strokeWidth="1" style={{ stroke: "var(--c-line)" }} />
                  <text x={L.tickX} y={L.tickTextY(v)} fontSize={L.FS} textAnchor={L.tickAnchor} fontFamily="var(--font-num)" style={{ fill: "var(--c-ink-4)" }}>{L.tickTexts[k]}</text>
                </g>
              ))}
              {/* 【N-10】ばらつきの帯。**折れ線より先に**描いて、線が帯の上に乗るようにする。
                  塗りは体系内でいちばん薄い紺系の面(--c-accent-tint)。正典 案K の --ghost
                  (#EAEFF6)は既存トークン #EAEFF5 と 1/255 しか違わないので、
                  **新しい hex を足さずに既存トークンを使う**。 */}
              {bandBounds && bandPaths().map((d, k) => (
                <path key={`band${k}`} d={d} stroke="none" style={{ fill: CHART_BAND_FILL }} />
              ))}
              {/* 中央のE♭に縦のガイド線を引く(ラベルも下で色付けする)。 */}
              {midEbIdx !== null && (
                <line x1={L.xAt(midEbIdx)} y1={L.padTop} x2={L.xAt(midEbIdx)} y2={L.padTop + L.plotH} strokeWidth="1" strokeDasharray="4 3" style={{ stroke: "var(--c-accent-line)" }} />
              )}
              {/* 理想値(破線)は実測より先に描き、実測の線が上に乗るようにする */}
              {idealByIdx && (
                <g style={{ stroke: IDEAL_LINE_STYLE.color }}>
                  {segmentsFor(idealByIdx).map((seg, k) => (
                    <polyline key={k} fill="none" strokeWidth={IDEAL_LINE_STYLE.width} strokeDasharray={IDEAL_LINE_STYLE.dash} points={seg.join(" ")} />
                  ))}
                  {Object.entries(idealByIdx).map(([idx, v]) => (
                    <circle key={idx} cx={L.xAt(+idx)} cy={L.yAt(v)} r={L.dotR} strokeWidth="1" style={{ fill: "var(--c-surface)" }} />
                  ))}
                </g>
              )}
              {/* 系列は紺の明度段階と線種で識別する(§1.7)。機能色は使わない */}
              {seriesData.map((s, si) => {
                const st = s.style || SERIES_STYLES[0];
                return (
                  <g key={s.id ?? si} style={{ stroke: st.color, fill: st.color }}>
                    {segmentsFor(s.byIdx).map((seg, k) => (
                      <polyline key={k} fill="none" strokeWidth={st.width} strokeDasharray={st.dash || undefined} points={seg.join(" ")} />
                    ))}
                    {Object.entries(s.byIdx).map(([idx, v]) => (
                      <circle key={idx} cx={L.xAt(+idx)} cy={L.yAt(v)} r={L.dotR} stroke="none" />
                    ))}
                  </g>
                );
              })}
              {plotNoteLabels.map((nm, i) => (L.showLabel(i) ? (
                <text key={i} x={L.xAt(i)} y={L.labelY} fontSize={L.FS} fontWeight={i === midEbIdx ? 700 : 400} textAnchor="middle" fontFamily="var(--font-num)" style={{ fill: i === midEbIdx ? "var(--c-accent)" : "var(--c-ink-3)" }}>{nm}</text>
              ) : null))}
            </svg>
          )}
        </div>
      )}
      {idealByIdx && hasData && (
        <div className="sans" style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 12, color: "#435266", paddingLeft: legendPad }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><SeriesSwatch style={seriesData[0]?.style || SERIES_STYLES[0]} />実測</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><SeriesSwatch style={IDEAL_LINE_STYLE} />目安</span>
          {idealDiffText && <span style={{ color: "var(--c-accent)" }}>{idealDiffText}</span>}
        </div>
      )}
      {!plain && series.length > 1 && (
        <div className="sans" style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginTop: 6, fontSize: 12, color: "#435266", paddingLeft: legendPad }}>
          {series.map((s, si) => (
            <span key={s.id ?? si} style={{ display: "flex", alignItems: "center", gap: 4 }} title={s.label}>
              <SeriesSwatch style={s.style || SERIES_STYLES[si % SERIES_STYLES.length]} />
              {W > 0 ? fitLabel(s.label, legendMax, SVG_FS_XS, "var(--font-jp)") : s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// タップで「数値表示 ⇄ 音名軸の折れ線グラフ」を切り替えるメトリクスカード。
// 登録済みリードの測定データ・セッション詳細で共通して使う。
// 【N-10 2026/08/17・審査で訂正】データタブ(My Data)はこの部品から離れている。
// N-7 の MetricRow も N-8 のヒーローの折れ線も**現在は存在しない**(N-10 で削除)。
// 今の My Data は「数字カード4枚 + 常に1枚だけのグラフ」で、この部品を使っていない。
// グラフ表示中はグリッドの全幅に広がり(gridColumn: 1/-1)、理想値があれば破線で重ねる。
//
// 【N-5 / bare】リードの個体詳細とデータタブだけ、正典の「枠も地も持たない数字の列」にする。
// **既定は false = 従来の .tile のまま**にしてある。既定を新しい側にすると、次に増えた
// 呼び出し側(セッション詳細)へ黙って漏れる(F-72 の罠1 と同じ事故)。
//
// 【N-6 / rowStyle】寸法はモックの実測値そのままで、どちらを使うかを呼び出し側が選ぶ
// (BARE_ROW_STYLES が唯一の答え。数値を呼び出し側に写さない)。
//   numrow … リード個体詳細 .numrow: 値 19 / 単位 11 / ラベル 10.5 / 副次 10.5(場所を常に確保)
// 【N-7 → N-10・審査で訂正】mrow(データタブの累計/最新の数字の列)は N-7 で廃止し、
// 定義ごと消した(使い手の無い定義を残さない)。移行先として挙げていた MetricRow も
// N-10 で削除済みなので、現存物として名指ししない。
const BARE_ROW_STYLES = {
  numrow: { value: 19, unit: 11, label: 10.5, sub: 10.5 },
};
function TappableMetricCard({ label, unit, fmt, metricKey, idealKey, frames, saxType, tuningHz, selectedIdeal, value, sub, noteFocus = null, bare = false, rowStyle = "numrow", idealDiffText = null }) {
  const [open, setOpen] = useState(false);
  const chart = (
    <NoteAxisLineChart
      label={label} unit={unit} metricKey={metricKey}
      series={[{ id: "self", label, style: SERIES_STYLES[0], frames }]}
      saxType={saxType} tuningHz={tuningHz} fmt={fmt}
      selectedIdeal={selectedIdeal} idealKey={idealKey} noteFocus={noteFocus}
      idealDiffText={idealDiffText}
    />
  );
  if (bare) {
    const fs = BARE_ROW_STYLES[rowStyle] ?? BARE_ROW_STYLES.numrow;
    return (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${label}を音名ごとのグラフで見る`}
        className="sans"
        style={{
          /* 【minWidth を 0 にしない】flex-basis 0 のままだと、1つが幅100%になっても
             残りの3つは**同じ行で幅0まで潰れる**(実測: 327 / 0 / 0 / 0)。
             幅0の見えないボタンが残るのは §5 の当たり判定として最悪なので、
             折り返しの判定に使われる最小幅を与えて次の行へ送る。
             60px は4つ並べても 4×60=240 ≤ 327 で1行に収まる値(＝通常時の見た目は変わらない)。 */
          flex: open ? "1 1 100%" : "1 1 0", minWidth: REED_NUMROW_MIN_PX, textAlign: "center",
          minHeight: "var(--tap-min)", padding: 0, background: "none", border: "none", cursor: "pointer",
        }}
      >
        {open ? chart : (
          <>
            <div style={{ fontFamily: "var(--font-num)", fontSize: fs.value, fontWeight: 600, color: "var(--c-ink)" }}>
              {value}{unit && <span className="sans" style={{ fontSize: fs.unit, color: "var(--c-ink-3)", fontWeight: 400, marginLeft: 1 }}>{unit}</span>}
            </div>
            <div style={{ fontSize: fs.label, color: "var(--c-ink-3)" }}>{label}</div>
            {/* 副次(標準偏差)は正典 .numrow .b。値が無い列でも高さを揃えるため場所だけ残す(§6.1.5)。
                正典 .mrow にはこの行が無いので、mrow のときは場所ごと出さない。 */}
            {fs.sub !== null && (
              <div style={{ fontSize: fs.sub, color: "var(--c-ink-3)", minHeight: 15 }}>{sub ?? " "}</div>
            )}
          </>
        )}
      </button>
    );
  }
  return (
    // 面の作法は .tile が持つ(background / border / borderRadius をここに書かない)。
    // 開くと gridColumn:1/-1 で行いっぱいに広がるため、行の先頭かどうかを :nth-child で
    // 数える方式は使えない。左罫の消し方は index.css の .surf-rule .tile-row を参照。
    <div
      className="tile"
      onClick={() => setOpen((v) => !v)}
      style={{ cursor: "pointer", gridColumn: open ? "1 / -1" : "auto" }}
    >
      {open ? chart : (
        <>
          <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>{label}</div>
          <div style={{ fontFamily: "var(--font-num)", fontSize: 22, fontWeight: 600, margin: "2px 0", color: "#121F32" }}>
            {value}
          </div>
          {sub && <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>{sub}</div>}
        </>
      )}
    </div>
  );
}

// 評価(総評・厚さ・バランス)の経時変化。3本を同じグラフに重ねる。
// 縦軸は **1〜5 で固定**(データに応じて伸縮させない。DESIGN-SYSTEM §7「数値の自動フルスケール
// 描画」をしない)。横軸は評価を記録した日。未評価(null)の区間は線を繋がない。
// 幅はコンテナ実測(useMeasuredWidth)に追従させ、SVGの実寸と viewBox は 1:1(§1.9)。
// 系列色は §1.7 の紺3段、線幅は §1.8。共通部品(useMeasuredWidth / fitLabel /
// measureSvgTextPx / SERIES_STYLES / SVG_FS_XS)はすべて既存のものを共有する。
function ReedScoreHistoryChart({ reed }) {
  const [boxRef, W] = useMeasuredWidth();
  const history = useMemo(() => normalizeRatingHistory(reed.ratings), [reed.ratings]);
  const n = history.length;
  const dateLabels = history.map((h) => reedScoreDateLabel(h.at));
  const series = [
    { key: "rating", label: "総評", style: SERIES_STYLES[0] },
    { key: "thickness", label: "厚さ", style: SERIES_STYLES[1] },
    { key: "balance", label: "バランス", style: SERIES_STYLES[2] },
  ];

  const L = (() => {
    if (n === 0 || W <= 0) return null;
    const FS = SVG_FS_XS;
    const plotH = REED_SCORE_PLOT_H;
    // 上端の目盛(5)のラベルが上に食い込む分の逃げ。--sp-1 以上を確保する(§1.9)。
    const padTop = SVG_SP2 + SVG_SP1;
    const tickTexts = RATING_DIAL_ORDER.map(String);
    const tickW = Math.ceil(Math.max(...tickTexts.map((t) => measureSvgTextPx(t, FS))));
    const TICK_GAP = SVG_SP2 + SVG_SP1; // 目盛ラベルの左右の余白(§1.9: --sp-2 以上)
    const AXW = TICK_GAP + tickW + TICK_GAP;
    const maxLblW = Math.ceil(Math.max(0, ...dateLabels.map((s) => measureSvgTextPx(s, FS))));
    const halfLbl = Math.ceil(maxLblW / 2) + SVG_SP1; // 中央揃えのラベルが端で半分外へ出る分
    const x0 = AXW + halfLbl;
    const x1 = Math.max(x0 + 1, W - SVG_SP2 - halfLbl);
    const colStep = n > 1 ? (x1 - x0) / (n - 1) : 0;
    const labelStep = reedScoreLabelStep(colStep, maxLblW + SVG_SP2, n);
    // 間引きの起点は最新(右端)。いちばん新しい日付は必ず出す。
    const showLabel = (i) => ((n - 1 - i) % labelStep) === 0;
    const dotR = n > 1 ? Math.max(1.5, Math.min(3, colStep * 0.3)) : 3;
    const labelY = padTop + plotH + SVG_SP2 + Math.round(FS * 0.8);
    return {
      FS, plotH, padTop, AXW, TICK_GAP, tickTexts, dotR, labelY, showLabel,
      H: labelY + SVG_SP2, // ディセンダの逃げ(§1.9: --sp-1 以上)
      xAt: (i) => reedScoreX(i, n, x0, x1),
      yAt: (v) => reedScoreY(v, padTop, plotH),
    };
  })();

  const legendMax = Math.round(W * 0.42);

  return (
    /* 【N-5】正典の個体詳細は「評価の推移」を 11px --ink3 の小さな見出し1行 + 折れ線 + 凡例だけで
       出す(カードの枠も「n件の記録」の行も無い)。空状態の文言は現行のまま2種とも残す。 */
    <div style={{ paddingTop: 14 }}>
      <div className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", paddingBottom: 6 }}>評価の推移</div>
      {n === 0 && (
        <div className="sans" style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-2)", marginBottom: "var(--sp-2)" }}>まだ記録がありません</div>
      )}
      {n === 0 ? (
        <div className="sans" style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)" }}>評価するとここに折れ線が育ちます</div>
      ) : (
        // 実測前(W=0)は箱だけ描いて幅を測る。useLayoutEffect で測るのでちらつきは出ない
        <div ref={boxRef}>
          {L && (
            <svg width={W} height={L.H} viewBox={`0 0 ${W} ${L.H}`} style={{ display: "block" }}>
              {/* 縦軸は 1〜5 の5段。データが何であってもこの位置は動かない */}
              {RATING_DIAL_ORDER.map((v) => (
                <g key={v}>
                  <line x1={L.AXW} y1={L.yAt(v)} x2={W} y2={L.yAt(v)} strokeWidth="1" style={{ stroke: "var(--c-line)" }} />
                  <text x={L.AXW - L.TICK_GAP} y={L.yAt(v) + Math.round(L.FS * 0.35)} fontSize={L.FS} textAnchor="end" fontFamily="var(--font-num)" style={{ fill: "var(--c-ink-4)" }}>{v}</text>
                </g>
              ))}
              {series.map((s) => {
                const vals = history.map((h) => h[s.key]);
                return (
                  <g key={s.key} style={{ stroke: s.style.color, fill: s.style.color }}>
                    {reedScoreSegments(vals).filter((seg) => seg.length >= 2).map((seg, k) => (
                      <polyline key={k} fill="none" strokeWidth={s.style.width} strokeDasharray={s.style.dash || undefined}
                        points={seg.map((i) => `${L.xAt(i)},${L.yAt(vals[i])}`).join(" ")} />
                    ))}
                    {vals.map((v, i) => (v === null ? null : (
                      <circle key={i} cx={L.xAt(i)} cy={L.yAt(v)} r={L.dotR} stroke="none" />
                    )))}
                  </g>
                );
              })}
              {dateLabels.map((d, i) => (L.showLabel(i) ? (
                <text key={i} x={L.xAt(i)} y={L.labelY} fontSize={L.FS} textAnchor="middle" fontFamily="var(--font-num)" style={{ fill: "var(--c-ink-3)" }}>{d}</text>
              ) : null))}
            </svg>
          )}
        </div>
      )}
      {n > 0 && (
        /* 正典の凡例は 10.5px。線種見本(SeriesSwatch)は現行のまま残す(色だけでは実線/破線が伝わらない) */
        <div className="sans" style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: "var(--sp-2)", fontSize: 10.5, color: "var(--c-ink-3)" }}>
          {series.map((s) => (
            <span key={s.key} style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }} title={s.label}>
              <SeriesSwatch style={s.style} />
              {W > 0 ? fitLabel(s.label, legendMax, SVG_FS_XS, "var(--font-jp)") : s.label}
            </span>
          ))}
        </div>
      )}
      {n === 1 && (
        <div className="sans" style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", marginTop: "var(--sp-2)" }}>
          次に評価を変えると、ここが線でつながります
        </div>
      )}
    </div>
  );
}

// 登録済みリードをタップした際の評価詳細(経時変化グラフ)。旧「リード毎比較」タブの内容を、
// リード登録一覧からのタップ遷移として統合したもの。
//
// 【N-5】正典 = design/north-star-measure.html の「個体詳細」。上から:
//   .backrow  「‹ 一覧」 / V16-3 #4(#番号は自由入力・空で自動採番) / 開封日 yyyy/mm/dd
//   .starrow  ★3枚(総評 / 厚さ / バランス)。どこを押しても3列ダイヤルが1回で開く
//   .memoline メモ
//   「測定データ · nセッション」 + .numrow の4指標(タップで音名軸グラフ)
//   「評価の推移」 + 折れ線 + 凡例
//   .bigbtn   「このリードで計測」= 計測タブへのジャンプ(一覧の「測定」ボタンの移設先)
// カード(.card)の枠は正典に無いので、群は余白と罫1本だけで分ける(§6.0 の囲いの序列)。
function ReedEvaluationDetail({ reed, reeds, sessions, setReeds, selectedIdeal, saxType, tuningHz, onBack, onMeasure }) {
  const reedSessions = sessions
    .filter((s) => s.reedId === reed.id)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  const allFrames = reedSessions.flatMap((s) => s.frames || []);
  const overall = computeFrameMetrics(allFrames);

  // #番号・メモは打鍵毎の書き込みを避けるためローカルstateで編集し、フォーカスが外れた時に
  // まとめてリードへ反映する(セッション詳細と同じパターン)。
  // #番号は数字管理の人もいればアルファベットや記号で管理する人もいるため自由記述にする
  // (デフォルトは登録順の連番のまま。空にすればまた自動採番に戻る)。
  const [positionDraft, setPositionDraft] = useState(String(reedPosition(reed, reeds) ?? ""));
  const [memoDraft, setMemoDraft] = useState(reed.memo || "");
  // 総評は 0.1 刻み、厚さ・バランスは整数。未評価は null。保存済みの値は読み取り時にだけ
  // 丸める(normalizeReedScoreOf)。既存データは書き換えず、実際に値を変えたときだけ保存する。
  const [ratingDraft, setRatingDraft] = useState(() => normalizeReedRating(reed.rating));
  // 総評とは別軸の主観評価。厚さ=抵抗感/密度、バランス=低音〜高音の鳴りの揃い方。
  const [thicknessDraft, setThicknessDraft] = useState(() => normalizeReedScore(reed.thickness));
  const [balanceDraft, setBalanceDraft] = useState(() => normalizeReedScore(reed.balance));
  // 編集ダイアログを開いているか。3つを1つのダイアログでまとめて回すので真偽値1つ。
  const [editingScores, setEditingScores] = useState(false);
  useEffect(() => {
    setPositionDraft(String(reedPosition(reed, reeds) ?? ""));
    setMemoDraft(reed.memo || "");
    setRatingDraft(normalizeReedRating(reed.rating));
    setThicknessDraft(normalizeReedScore(reed.thickness));
    setBalanceDraft(normalizeReedScore(reed.balance));
    setEditingScores(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reed.id]);

  const patchReed = (patch) => setReeds((prev) => prev.map((r) => (r.id === reed.id ? { ...r, ...patch } : r)));
  const commitPosition = () => {
    const trimmed = positionDraft.trim();
    if (trimmed === String(reed.boxNumber ?? "")) return;
    patchReed({ boxNumber: trimmed || null });
  };
  const commitMemo = () => {
    const trimmed = memoDraft.trim();
    if (trimmed === (reed.memo || "")) return;
    patchReed({ memo: trimmed || null });
  };
  // 評価の確定はダイアログを閉じたときの1回だけ。**3つのうち1つでも変わったときだけ**1件書き込む
  // (以前は開閉のたびに履歴が1件増えていた)。判定は commitReedScores に閉じてある。
  const closeScoreEditor = () => {
    const patch = commitReedScores(reed, { rating: ratingDraft, thickness: thicknessDraft, balance: balanceDraft }, new Date().toISOString());
    if (patch) patchReed(patch);
    setEditingScores(false);
  };
  const SCORE_FIELDS = [
    { key: "rating", label: "総評", value: ratingDraft, set: setRatingDraft },
    { key: "thickness", label: "厚さ", value: thicknessDraft, set: setThicknessDraft },
    { key: "balance", label: "バランス", value: balanceDraft, set: setBalanceDraft },
  ];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* 正典 .backrow: 「‹ 一覧」 / 中央に V16-3 #4 / 右に開封日。13px の1行 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 13, color: "var(--c-ink-2)" }}>
        <button
          onClick={onBack}
          className="sans"
          style={{ minHeight: "var(--tap-min)", minWidth: "var(--tap-min)", display: "flex", alignItems: "center", background: "none", border: "none", color: "var(--c-ink-2)", fontSize: 13, cursor: "pointer", padding: 0, flexShrink: 0 }}
        >
          ‹ 一覧
        </button>
        <span style={{ fontSize: 15, color: "var(--c-ink)", display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <b style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {shortBoxLabel(reed.brand, reed.strength, reeds.map((r) => r.brand))}
          </b>
          {/* #番号はそのまま編集欄。空欄にすると自動採番に戻り、placeholder にその値が出る
              (＝今なら何番になるかが分かる)。地・枠は持たない(正典 .backrow に箱は無い)。
              当たり判定は 44px。
              【F-102 2026/08/17 本人指示】「編集できる」ことを示していた破線の下線は削除。
              編集機能そのもの(タップ→入力→blur で確定)は不変で、入口の案内は
              リードタブの「…」→「リード番号を変更」が担う。 */}
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            <span aria-hidden="true">#</span>
            <input
              type="text" aria-label="番号" placeholder={String(reedPosition(reed, reeds))}
              value={positionDraft} onChange={(e) => setPositionDraft(e.target.value)} onBlur={commitPosition}
              className="sans"
              style={{
                width: 46, minHeight: "var(--tap-min)", padding: 0, fontSize: 15, fontWeight: 700,
                background: "none", border: "none",
                borderRadius: 0, color: "var(--c-ink)",
              }}
            />
          </span>
        </span>
        <span className="sans" style={{ fontSize: 12, color: "var(--c-ink-3)", flexShrink: 0 }}>{formatYmd(reed.startDate) ?? "—"}</span>
      </div>

      {/* 正典 .starrow: 3列を等幅で並べ、値 23px/600 の下に 11px のラベル。上下 16px・下に罫1本。
          行のどこを押しても3列ダイヤルが1回で開く(§6.4)。 */}
      <ReedScoreField fields={SCORE_FIELDS} onOpen={() => setEditingScores(true)} />

      {/* 正典 .memoline: 13px --ink3 / 上下 13px / 下に罫1本。編集できることは現行のまま。 */}
      <textarea
        placeholder="メモ"
        value={memoDraft} onChange={(e) => setMemoDraft(e.target.value)} onBlur={commitMemo}
        rows={1}
        className="sans"
        style={{
          width: "100%", padding: "13px 0", fontSize: 13, resize: "vertical", fontFamily: "inherit",
          boxSizing: "border-box", color: "var(--c-ink-3)",
          background: "none", border: "none", borderBottom: "1px solid var(--c-line)", borderRadius: 0,
        }}
      />

      {/* 測定データ。正典は「測定データ · 12セッション」の 11px 1行 + .numrow の4指標。
          一覧のタイルから落ちた「開封n日」「未測定」はこの行が引き取る(reedDetailMetaLine)。
          各指標はタップで音名軸の折れ線グラフに切り替わる(再タップで数値に戻る)。 */}
      <div className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", paddingTop: 16 }}>
        {reedDetailMetaLine(reedSessions.length, usageDays(new Date(), reed.startDate))}
      </div>
      {reedSessions.length === 0 ? (
        <div className="sans" style={{ fontSize: 12, color: "var(--c-ink-3)", padding: "10px 0 14px", borderBottom: "1px solid var(--c-line)" }}>
          このリードに紐づく測定データがまだありません
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", padding: "10px 0 14px", borderBottom: "1px solid var(--c-line)" }}>
          {REED_DETAIL_METRICS.map((key) => {
            const m = REED_COMPARE_METRICS.find((x) => x.key === key);
            const v = overall[m.key];
            return (
              <TappableMetricCard
                key={m.key}
                bare
                label={m.label} unit={m.unit} fmt={m.fmt}
                metricKey={m.key} idealKey={METRIC_IDEAL_KEYS[m.key]}
                frames={allFrames} saxType={saxType} tuningHz={tuningHz} selectedIdeal={selectedIdeal}
                value={v !== null && v !== undefined ? m.fmt(v) : "—"}
                sub={m.sub?.(overall) ?? null}
              />
            );
          })}
        </div>
      )}

      {/* 測定データの下に評価の推移(縦軸=1〜5・横軸=日付・総評/厚さ/バランスの3本) */}
      <ReedScoreHistoryChart reed={reed} />

      {/* 正典 .bigbtn: 紺の塗りピル(14px / 600 / padding 11px 26px / 上 20px・中央)。
          【決定6】計測タブへのジャンプはここ。一覧の行にあった「測定」ボタンの移設先。 */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
        <button
          onClick={() => onMeasure?.(reed.id)}
          className="sans"
          style={{ minHeight: "var(--tap-min)", display: "flex", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer" }}
        >
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 600, color: "var(--c-on-accent)",
            background: "var(--c-accent)", borderRadius: 999, padding: "11px 26px",
          }}>このリードで計測</span>
        </button>
      </div>

      {/* 評価の編集ダイアログ。position:fixed で流れから外すので、開閉しても裏のページは1pxも動かない(§6.1.5) */}
      {editingScores && (
        <ReedScoreEditor fields={SCORE_FIELDS} onClose={closeScoreEditor} />
      )}
    </div>
  );
}

// ============================================================
// 分析ラボ (③) — 企画書v6 11節
//
// 11.4(b)(c)の「体の使い方」原因推定: リード軸・音域軸の両方が実働。
// (音域軸はフレームにsemitoneIndexを保存する拡張により有効化済み)
// 11.6節の自由軸集計: ピボット型クロス集計として実装。
// 縦軸(音名/音域帯) × 横軸(リード/リード×使用日数/録音日) の交点に
// 選択した指標(ピッチ誤差・高次倍音強度・HNR・重心)を数値表示する。
// ============================================================
// ピッチ偏差セルの色分け(絶対値: <10¢緑 / <25¢アンバー / それ以上赤)
function pitchCellColor(cents) {
  const a = Math.abs(cents);
  if (a < 10) return "#16A34A";
  if (a < 25) return "#D97706";
  return "#DC2626";
}

function usageDays(recordedAt, startDate) {
  if (!startDate) return null;
  const days = Math.floor((new Date(recordedAt) - new Date(startDate)) / 86400000) + 1;
  return Math.max(1, days);
}

// ============================================================
// クロス集計(ピボット) — Excelのピボットテーブル風の自由軸集計
//
// 「次元」(カテゴリ値)はフィルター(集計対象抽出)・縦軸・横軸のどこにでも配置でき、
// 「指標」(数値)はセルの集計値として選ぶ。フレームは呼び出し側でセッション情報
// (録音日時・奏者・サックス種別・録音/アップロード・メモ・リードオブジェクト)を
// 付与した形(enriched frame)で渡す。getValue(f, ctx)のctxは{reeds, tuningHz}。
// ============================================================
const PIVOT_BAND_ORDER = { low: 0, mid: 1, high: 2 };

const PIVOT_DIMENSIONS = [
  {
    key: "note", label: "音名",
    // 【F-54】実音(コンサートピッチ)で表示する。記音(matchedWrittenNote)のままだと、
    // 計測タブ・NoteAxisLineChart・PhraseTimeline(すべて実音)と同じデータなのに画面ごとに
    // 別の音名が出ていた(アルトなら記音B♭3〜F♯6 / 実音D♭3〜A5)。
    // ラベルは**運指(semitoneIndex)から**導く。実測の concertNote を使うと、同じ運指でも
    // 大きく外したフレームが隣の音名になり、同じ運指が複数の行に割れる。
    // 楽器種別はフレームごとに違い得る(複数セッションを混ぜるので f.saxType を使う。
    // ctx.tuningHz は AnalysisLabView が渡す実効基準ピッチ)。
    // 運指から引けない旧データだけ、既存の idiom concertNote || matchedWrittenNote に倣う。
    getValue: (f, ctx) =>
      concertNoteLabelOf(f.semitoneIndex, f.saxType, ctx?.tuningHz)
      || f.concertNote || f.matchedWrittenNote || null,
    // 縦軸では上から、横軸では左から高い音が来るように、**実音の高さ**の降順(符号反転)で
    // ソートする(未判定は Infinity で従来通り末尾に置く)。行・列とも同じ昇順ソートを共通で使う
    // buildPivotの仕組み上、ここでソートキーを反転させるのが一番シンプルな実装になる。
    // 【F-60】以前は運指(semitoneIndex)の降順だった。F-54 でラベルを実音にしたため、
    // 楽器種別が混ざると運指の順と実音の高さの順が食い違い、実測で4箇所の逆転が出た
    // (E5がF5より上・G♯4がA4より上・C4がC♯4より上・E3がF3より上)。表示と同じ土台
    // (concertNoteTableOf)から高さを引いて並べる。旧データ等で高さが引けない場合だけ、
    // 従来どおり運指で並べる(実音ラベルも引けないので、その行は元々フォールバック表示)。
    getSort: (f, ctx) => {
      if (f.semitoneIndex === null || f.semitoneIndex === undefined) return Infinity;
      const hz = concertNoteFreqOf(f.semitoneIndex, f.saxType, ctx?.tuningHz);
      return hz ? -hz : -f.semitoneIndex;
    },
  },
  {
    key: "band", label: "音域帯",
    getValue: (f) => {
      const band = registerBand(f.semitoneIndex);
      return band === "unknown" ? null : REGISTER_BAND_LABELS[band];
    },
    getSort: (f) => PIVOT_BAND_ORDER[registerBand(f.semitoneIndex)] ?? 9,
  },
  {
    key: "reed", label: "リード(個体)",
    getValue: (f, ctx) => (f.reed ? reedLabel(f.reed, ctx.reeds) : "未紐付け"),
  },
  {
    key: "brand", label: "リード銘柄",
    getValue: (f) => f.reed?.brand ?? "未紐付け",
  },
  {
    key: "strength", label: "リード番手",
    getValue: (f) => (f.reed ? String(f.reed.strength) : "未紐付け"),
    getSort: (f) => (f.reed ? parseFloat(f.reed.strength) : 999),
  },
  {
    key: "rating", label: "リード主観評価",
    getValue: (f) => (f.reed ? (f.reed.rating ? `★${f.reed.rating}` : "未評価") : "未紐付け"),
    getSort: (f) => (f.reed ? (f.reed.rating ?? 0) : -1),
  },
  {
    key: "reedDays", label: "開封後日数",
    // フィルターでは範囲選択(numberRange)にするため、値そのものの取得はgetRangeValueで行う
    getValue: (f) => {
      if (!f.reed) return null;
      const d = usageDays(f.recordedAt, f.reed.startDate);
      return d ? `${d}日目` : null;
    },
    getSort: (f) => (f.reed ? usageDays(f.recordedAt, f.reed.startDate) ?? 999 : 999),
    filterKind: "numberRange",
    getRangeValue: (f) => (f.reed ? usageDays(f.recordedAt, f.reed.startDate) : null),
  },
  {
    key: "date", label: "録音日",
    getValue: (f) => formatYmd(f.recordedAt),
    getSort: (f) => new Date(f.recordedAt).setHours(0, 0, 0, 0),
    filterKind: "dateRange",
    getRangeValue: (f) => new Date(f.recordedAt).setHours(0, 0, 0, 0),
  },
  {
    key: "performer", label: "奏者",
    getValue: (f) => f.performer || "—",
  },
  {
    key: "saxType", label: "サックス種別",
    getValue: (f) => SAX_PRESETS[f.saxType]?.label ?? f.saxType ?? null,
  },
  {
    key: "source", label: "データ種別",
    getValue: (f) => (f.source === "upload" ? "アップロード" : "録音"),
  },
  {
    key: "memo", label: "メモ",
    getValue: (f) => f.memo || "（メモなし）",
  },
];

// PIVOTの集計条件の既定値。他機種のデータが混ざると平均が意味を失うため、初期状態で
// 「サックス種別=今の楽器」を1つ入れておく(不要なら × で消せる)。
// 【F-59】状態を親へ持ち上げたので、既定値の生成をここに切り出して**使う時点の saxType**で
// 評価できるようにした(親の useState 初期化子で評価すると、IndexedDB からの楽器種別の復元より
// 前に固定されてしまう)。
function defaultPivotFilters(saxType) {
  const label = SAX_PRESETS[saxType]?.label;
  return label ? [{ dimKey: "saxType", values: [label], rangeMin: null, rangeMax: null }] : [];
}

function harmonicSliceMean(f, lo, hi) {
  const hs = f.harmonics?.slice(lo, hi).map((h) => h.levelNorm) ?? [];
  return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null;
}

// 音色系(倍音・HNR・重心)はアタック過渡フレームを集計から除外する(timbreSustained。
// セッション詳細・My Dataの平均と同じ方針で、ビューによって値が食い違わないようにする)
const PIVOT_MEASURES = [
  // 【F-45】ラベルに続きデータ側もF-44/F-46と同じゲート(_pitchGateOk。framesWithContextで
  // セッション単位にselectPitchAggregationFramesを通して付与)を通す。ゲート非通過フレームは
  // nullを返し、buildPivotの「値がnullなら集計から除外」に乗せる(buildPivot自体は無変更)。
  { key: "pitchCents", label: "平均差分(¢)", getValue: (f) => (f._pitchGateOk ? f.pitchCents : null), fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(1), color: pitchCellColor },
  { key: "pitchHz", label: "ピッチ(Hz)", getValue: (f) => f.pitchHz, fmt: (v) => v.toFixed(1) },
  { key: "volume", label: "音量(dB)", getValue: (f) => f.volumeDb, fmt: (v) => v.toFixed(1) },
  { key: "lowHarm", label: "倍音強度(低次1-4)", getValue: (f) => (timbreSustained(f) ? harmonicSliceMean(f, 0, 4) : null), fmt: (v) => (v * 100).toFixed(0) },
  { key: "highHarm", label: "倍音強度(高次5-8)", getValue: (f) => (timbreSustained(f) ? harmonicSliceMean(f, 4, 8) : null), fmt: (v) => (v * 100).toFixed(0) },
  { key: "hnr", label: "HNR(dB)", getValue: (f) => (timbreSustained(f) ? f.hnrDb : null), fmt: (v) => v.toFixed(1) },
  { key: "centroid", label: "重心(Hz)", getValue: (f) => (timbreSustained(f) ? f.spectralCentroidHz : null), fmt: (v) => Math.round(v).toString() },
];

// 指定した次元がとりうる値の一覧を、ソートキーつきで返す(音域帯まとめ選択など値→ソートキーの
// 対応が必要な場面用)。次元のソート順で並ぶ。
function pivotDimensionValueEntries(frames, ctx, dimKey) {
  const dim = PIVOT_DIMENSIONS.find((d) => d.key === dimKey);
  if (!dim) return [];
  const sortByValue = new Map();
  for (const f of frames) {
    const v = dim.getValue(f, ctx);
    if (v === null || v === undefined) continue;
    if (!sortByValue.has(v)) sortByValue.set(v, dim.getSort ? dim.getSort(f, ctx) : v);
  }
  return [...sortByValue.entries()]
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([value, sortKey]) => ({ value, sortKey }));
}

// 指定した次元がとりうる値の一覧(フィルターUIの選択肢用)。次元のソート順で返す
function pivotDimensionValues(frames, ctx, dimKey) {
  return pivotDimensionValueEntries(frames, ctx, dimKey).map((e) => e.value);
}

// filters: 通常は{dimKey, values: string[]}(値が1つ以上選ばれているフィルターだけ有効)。
// dimKindが"dateRange"/"numberRange"の次元は{dimKey, rangeMin, rangeMax}を使い、
// どちらか一方でも指定されていれば有効(未指定側は無制限)。
// colKey === "none" の場合は横軸なし(「全体」1列)として集計する。
function buildPivot(frames, ctx, rowKey, colKey, measureKey, filters) {
  const rowDim = PIVOT_DIMENSIONS.find((d) => d.key === rowKey);
  const colDim = colKey === "none" ? null : PIVOT_DIMENSIONS.find((d) => d.key === colKey);
  const measure = PIVOT_MEASURES.find((m) => m.key === measureKey);
  if (!rowDim || !measure) return { cells: {}, rowKeys: [], colKeys: [], measure: null };

  const activeFilters = (filters || [])
    .map((flt) => ({ ...flt, dim: PIVOT_DIMENSIONS.find((d) => d.key === flt.dimKey) }))
    .filter((flt) => {
      if (!flt.dim) return false;
      if (flt.dim.filterKind) return flt.rangeMin != null || flt.rangeMax != null;
      return (flt.values || []).length > 0;
    });

  const cells = {}; // rowKey -> colKey -> {sum, count}
  const rowSort = {};
  const colSort = {};
  for (const f of frames) {
    const rejected = activeFilters.some((flt) => {
      if (flt.dim.filterKind) {
        const rv = flt.dim.getRangeValue(f, ctx);
        if (rv === null || rv === undefined) return true;
        if (flt.rangeMin != null && rv < flt.rangeMin) return true;
        if (flt.rangeMax != null && rv > flt.rangeMax) return true;
        return false;
      }
      return !flt.values.includes(flt.dim.getValue(f, ctx));
    });
    if (rejected) continue;
    const rk = rowDim.getValue(f, ctx);
    const ck = colDim ? colDim.getValue(f, ctx) : "全体";
    const v = measure.getValue(f);
    if (rk === null || rk === undefined || ck === null || ck === undefined || v === null || v === undefined || isNaN(v)) continue;
    if (!cells[rk]) cells[rk] = {};
    if (!cells[rk][ck]) cells[rk][ck] = { sum: 0, count: 0, wsum: 0, wtotal: 0 };
    const w = frameWeight(f); // 平均はclarity重み付き(他ビューの平均と同じ方針)
    cells[rk][ck].sum += v;
    cells[rk][ck].count += 1;
    cells[rk][ck].wsum += w * v;
    cells[rk][ck].wtotal += w;
    if (rowSort[rk] === undefined) rowSort[rk] = rowDim.getSort ? rowDim.getSort(f, ctx) : rk;
    if (colDim && colSort[ck] === undefined) colSort[ck] = colDim.getSort ? colDim.getSort(f, ctx) : ck;
  }

  const bySort = (sortMap) => (a, b) => {
    const sa = sortMap[a], sb = sortMap[b];
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  };
  const rowKeys = Object.keys(cells).sort(bySort(rowSort));
  const colKeys = colDim
    ? [...new Set(Object.values(cells).flatMap((row) => Object.keys(row)))].sort(bySort(colSort))
    : ["全体"];
  return { cells, rowKeys, colKeys, measure };
}

// ================= 【D-2 2026/08/22 本人指示・凍結仕様 design/D2-SPEC.md】=================
// 分析(PIVOT)タブを Design canon(design/dc-mydata-redesign.html)の **#13a** へ。
// 折れ線の**向き**(縦軸=音名・上から下へ / 横軸=選んだ数値)は N-9 から不変で、
// 正典が足したのは「行の縞」「縦の目盛り線(0だけ濃い)」「凡例をグラフの上へ」の3つ。
// 操作部は「条件のチップ行」と「3カラムのセレクタカード(並べる軸 / 数値 / 分け方)」になった。

// 正典 #13a の実数。行高 25px / 目盛5本 / 点は r2.8 に白フチ1.1px。
const PIVOT_ROW_H = 25;
const PIVOT_TICK_COUNT = 5;
const PIVOT_DOT_R = 2.8;
const PIVOT_DOT_RING = 1.1;

// 【D-2】縦の目盛りの値。lo から hi まで等間隔に n 本。**両端は lo と hi そのもの**。
// 【0 を目盛へ寄せない】初版は「いちばん 0 に近い目盛を 0 ちょうどへ動かす」形だったが、
// それだと**端の目盛が 0 に化ける**(lo=-1, hi=9 で左端のラベルが「-1」ではなく「0」になる)。
// 軸の端の値を偽るのは目盛の役目に反するので、0 の線は**目盛とは別に**引き、
// ラベルが重なる目盛だけを1つ譲る(pivotCrowdedTickIndex)。
function pivotTickValues(lo, hi, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(lo + ((hi - lo) * i) / (n - 1));
  return out;
}
// 0 のラベルと重なる目盛の番号(重なっていなければ -1)。**0 のラベルは必ず出す**ので、
// 譲るのは目盛の側。距離は描画後の x(px)で見る(値の間隔ではなく実際の重なりで決める)。
const PIVOT_TICK_MIN_GAP_PX = 18;
function pivotCrowdedTickIndex(tickXs, zeroX, minGap) {
  if (zeroX === null || zeroX === undefined) return -1;
  let best = -1, bd = Infinity;
  for (let i = 0; i < (tickXs || []).length; i++) {
    const d = Math.abs(tickXs[i] - zeroX);
    if (d < bd) { bd = d; best = i; }
  }
  return bd < minGap ? best : -1;
}

// 【D-2】行の縞(正典 #13a「オクターブ単位で交互に極薄い面」)。
// 行ラベルを parseNoteLabel で割り、**同じオクターブが続く区間**を1群として、1つおきに塗る。
// 戻り値は塗る区間だけ [{ from, to }](to は含まない)。
// オクターブが読めない行(音名でない次元)は群ごと落とす — 「2行ごとに交互」のような
// **正典に無い規則を発明しない**ため。
function pivotOctaveStripes(rowKeys) {
  const groups = [];
  for (let i = 0; i < (rowKeys || []).length; i++) {
    const p = parseNoteLabel(String(rowKeys[i]));
    const oct = p ? p.octave : null;
    const last = groups[groups.length - 1];
    if (last && last.oct === oct) last.to = i + 1;
    else groups.push({ oct, from: i, to: i + 1 });
  }
  return groups.filter((g, i) => i % 2 === 1 && g.oct !== null).map((g) => ({ from: g.from, to: g.to }));
}

// 【D-2】グラフ右上に出す単位。PIVOT_MEASURES の label は「平均差分(¢)」のように
// **名前と単位を括弧でつないだ1つの文字列**なので、その括弧の中だけを取る
// (単位の綴りを2箇所に持たないため。括弧が無い測度は空文字)。
function pivotUnitOf(metricDef) {
  const m = /[（(]([^（）()]*)[）)]\s*$/.exec(metricDef?.label ?? "");
  return m ? m[1] : "";
}

// 【D-2】条件チップの文字。正典 #13a は適用中のフィルタを「Alto」「6ヶ月」のように
// **値そのもの**で出す。値を選んでいないフィルタ(=全選択と同じ扱い)は次元名だけを出す。
// 範囲(日付・日数)のフィルタは端の値をつないで出す。**押せば必ず編集に入れる**ので、
// ここで出せない情報があっても行き止まりにはならない。
function pivotFilterChipText(flt, dim) {
  const name = dim?.label ?? flt?.dimKey ?? "";
  if (dim?.filterKind === "dateRange" || dim?.filterKind === "numberRange") {
    const a = flt?.rangeMin, b = flt?.rangeMax;
    if (a === null && b === null) return name;
    const f = (v) => (dim.filterKind === "dateRange" ? (formatYmd(v) ?? "") : String(v));
    return `${name} ${a === null ? "" : f(a)}〜${b === null ? "" : f(b)}`;
  }
  const vals = flt?.values ?? [];
  if (vals.length === 0) return name;
  if (vals.length <= PIVOT_CHIP_VALUES_MAX) return vals.join(" / ");
  return `${vals.slice(0, PIVOT_CHIP_VALUES_MAX).join(" / ")} 他${vals.length - PIVOT_CHIP_VALUES_MAX}`;
}
// チップに並べる値の上限。超えたぶんは「他n」に畳む(チップが行を埋め尽くさないため)。
const PIVOT_CHIP_VALUES_MAX = 2;


// 【D-2 2026/08/22 本人指示・凍結仕様 design/D2-SPEC.md】正典 = design/dc-mydata-redesign.html
// の **#13a**。縦軸=音名(上から下へ)／横軸=選んだ数値、という**向きは N-9 から不変**で、
// 正典が足したのは次の3つ:
//   ・**行の縞**(オクターブ単位で交互に極薄い面)— どの行がどのオクターブか掴めるようにする
//   ・**縦の目盛り線**(5本)と、その下の目盛ラベル。**0線だけ濃い**
//   ・**凡例をグラフの上**へ(左に系列、右端に単位)。下の指標名は凡例の単位が引き継ぐ
// 行高は正典の 25px。線幅2px・点 r2.8 + 白フチ1.1px も正典どおり。
//
// 【行の縞をオクターブで割れるのは行が音名のときだけ】rowIsNote が false のときは縞を出さない
// (「2行ごとに交互」のような**正典に無い規則を発明しない**)。
function PivotLineChart({ rowKeys, colKeys, cells, metricDef, rowIsNote = false }) {
  // グラフ幅は固定値ではなくコンテナの実測幅。375pxでも横に溢れない条件がここで決まる。
  const [boxRef, W] = useMeasuredWidth();

  const cellValue = (rk, ck) => {
    const c = cells[rk]?.[ck];
    if (!c) return null;
    const v = metricDef.agg === "sum" ? c.sum : c.wsum / c.wtotal;
    return v === null || v === undefined || isNaN(v) ? null : v;
  };

  // 7系列以上は色を足さず表示を絞る(DESIGN-SYSTEM §1.7)。絞ったことは凡例の下に明記する。
  const shownKeys = colKeys.slice(0, SERIES_STYLES.length);
  const hiddenCount = colKeys.length - shownKeys.length;
  const styleAt = (i) => SERIES_STYLES[i];

  const allVals = [];
  rowKeys.forEach((rk) => shownKeys.forEach((ck) => { const v = cellValue(rk, ck); if (v !== null) allVals.push(v); }));

  // 項目ラベル(縦軸)と凡例に共通の文字幅の上限。固定文字数では切らず、この幅で畳む。
  // 幅の4割強までをラベルに割き、残りをプロットに回す(375pxで両方が成立する配分)。
  const LABEL_MAX = Math.round(W * 0.42);

  // 実測前(W=0)は箱だけ描いて幅を測る。useLayoutEffect で測るので描画のちらつきは出ない。
  const body = (() => {
    if (allVals.length === 0 || W <= 0) return null;

    let minV = Math.min(...allVals), maxV = Math.max(...allVals);
    // ピッチ偏差は0(ジャスト)を基準線として必ず範囲に含める
    if (metricDef.key === "pitchCents") { minV = Math.min(minV, 0); maxV = Math.max(maxV, 0); }
    const pad = (maxV - minV) * 0.12 || Math.abs(maxV) * 0.1 || 1;
    const lo = minV - pad, hi = maxV + pad, rng = hi - lo || 1;

    const FS = SVG_FS_XS;           // --fs-xs (12px)
    const SP1 = 4, SP2 = 8;         // --sp-1 / --sp-2
    const ROW = PIVOT_ROW_H;        // 1項目(行)あたりの高さ(正典 #13a の 25px)
    const GAPL = SP2;               // 項目ラベルとプロット領域の間隔
    const RPAD = SP1;               // 右端の内側寄せ。最大値の目盛と点(r=2.8)が枠外に出ないため
    const BASE = Math.round(FS * 0.8);  // 文字の上端からベースラインまで(組版上の目安。トークンではない)
    const padTop = 6;
    // 【D-2】下は目盛ラベル1行だけ。グラフの下に置いていた指標名は**凡例の右端の単位**が引き継いだ。
    const padBottom = SP1 * 2 + FS;
    const H = padTop + rowKeys.length * ROW + padBottom;

    // 左端も RPAD と同じだけ内側に寄せる。getComputedTextLength() は送り幅で、和文グリフの
    // 実インクは 1px 前後それを超えることがあるため、この余白が無いと左端で欠ける。
    const longest = rowKeys.reduce((m, rk) => Math.max(m, measureSvgTextPx(rk, FS)), 0);
    const LABELW = RPAD + Math.min(Math.ceil(longest), LABEL_MAX) + GAPL;
    const PLOTW = Math.max(1, W - LABELW - RPAD);

    const xAt = (v) => LABELW + ((v - lo) / rng) * PLOTW;
    const yAt = (ri) => padTop + ri * ROW + ROW / 2;

    // 系列(指標の値)ごとに、縦(行)方向へ連続する行をつないだ折れ線を作る(欠けはギャップ)
    const segmentsFor = (ck) => {
      const segs = []; let cur = [];
      rowKeys.forEach((rk, ri) => {
        const v = cellValue(rk, ck);
        if (v !== null) cur.push(`${xAt(v)},${yAt(ri)}`);
        else { if (cur.length) segs.push(cur); cur = []; }
      });
      if (cur.length) segs.push(cur);
      return segs;
    };
    // 【D-2】縦の目盛り線(5本)と、それとは別に引く 0 の線。
    // 0 が範囲の内側にあるときだけ 0 の線を引き、**ラベルが重なる目盛を1つ譲る**。
    const ticks = pivotTickValues(lo, hi, PIVOT_TICK_COUNT);
    const zeroX = lo < 0 && hi > 0 ? xAt(0) : null;
    const crowded = pivotCrowdedTickIndex(ticks.map(xAt), zeroX, PIVOT_TICK_MIN_GAP_PX);

    // 行の縞。オクターブが変わるたびに交互(正典 #13a)。行が音名でないときは出さない。
    const stripes = rowIsNote ? pivotOctaveStripes(rowKeys) : [];

    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        {/* 【D-2】行の縞(オクターブ単位で交互に極薄い面)。地は --c-sunk(白地との差 ΔL* 2.79)。
            **新しい薄さを発明しない**: 体系でいちばん淡い面がこれ。 */}
        {stripes.map((s) => (
          <rect key={s.from} x={LABELW} y={padTop + s.from * ROW} width={PLOTW} height={(s.to - s.from) * ROW}
            fill="var(--c-sunk)" />
        ))}
        {/* 【D-2】縦の目盛り線は罫(--c-line)。**0 の線だけ濃い**(--c-line-strong)。 */}
        {ticks.map((t) => (
          <line key={t} x1={xAt(t)} y1={padTop} x2={xAt(t)} y2={H - padBottom} strokeWidth="1" stroke="var(--c-line)" />
        ))}
        {zeroX !== null && (
          <line x1={zeroX} y1={padTop} x2={zeroX} y2={H - padBottom} strokeWidth="1" stroke="var(--c-line-strong)" />
        )}
        {/* 項目ラベル(縦軸) */}
        {rowKeys.map((rk, ri) => (
          <text key={rk} x={LABELW - GAPL} y={yAt(ri) + Math.round(FS * 0.35)} fontSize={FS}
            fill="var(--c-ink-2)" textAnchor="end" fontFamily="var(--font-num)">{fitLabel(rk, LABEL_MAX, FS)}</text>
        ))}
        {/* 目盛ラベル。両端だけは枠の内側へ寄せる(中央合わせだと半分が枠外に出る)。
            0 のラベルと重なる1本だけは譲る(crowded)。 */}
        {ticks.map((t, ti) => (ti === crowded ? null : (
          <text key={t} x={xAt(t)} y={H - padBottom + SP1 + BASE} fontSize={FS} fill="var(--c-ink-4)"
            textAnchor={ti === 0 ? "start" : ti === ticks.length - 1 ? "end" : "middle"}
            fontFamily="var(--font-num)">{metricDef.fmt(t)}</text>
        )))}
        {zeroX !== null && (
          <text x={zeroX} y={H - padBottom + SP1 + BASE} fontSize={FS} fill="var(--c-ink-3)"
            textAnchor="middle" fontFamily="var(--font-num)">{metricDef.fmt(0)}</text>
        )}
        {/* 系列(分け方の値ごと)の折れ線を同じ場所に重ねる。識別は紺の明度段階と線種で行う */}
        {shownKeys.map((ck, ci) => {
          const st = styleAt(ci);
          return (
            <g key={ck} style={{ stroke: st.color, fill: st.color }}>
              {segmentsFor(ck).map((seg, k) => (
                <polyline key={k} fill="none" strokeWidth={st.width} strokeDasharray={st.dash || undefined} points={seg.join(" ")} />
              ))}
              {rowKeys.map((rk, ri) => {
                const v = cellValue(rk, ck);
                if (v === null) return null;
                /* 正典 #13a の点: r 2.8 + 白フチ 1.1px。線が重なっても点だけは読める。 */
                return <circle key={ri} cx={xAt(v)} cy={yAt(ri)} r={PIVOT_DOT_R} stroke="var(--c-surface)" strokeWidth={PIVOT_DOT_RING} />;
              })}
            </g>
          );
        })}
      </svg>
    );
  })();

  return (
    <div>
      {/* 【D-2】凡例は**グラフの上**(正典 #13a)。左に系列、右端に単位。
          旧実装はグラフの下に凡例、さらに下に指標名を置いていたが、
          正典は「上に凡例、右上に単位」の1行にまとめている。 */}
      {body && (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "0 2px 12px" }}>
          <div className="sans" style={{ display: "flex", flexWrap: "wrap", gap: "8px 13px", maxHeight: 96, overflowY: "auto" }}>
            {shownKeys.map((ck, ci) => (
              <span key={ck} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--c-ink-2)" }}>
                <SeriesSwatch style={styleAt(ci)} width={12} />
                {fitLabel(ck, LABEL_MAX, SVG_FS_XS)}
              </span>
            ))}
          </div>
          {/* 単位。指標の定義(PIVOT_MEASURES)の label の括弧の中から引く(綴りを2箇所に置かない)。
              名前そのものは上の「数値」セレクタが出しているので、ここは単位だけ。 */}
          <span className="sans" style={{ fontSize: 10, color: "var(--c-ink-3)", flexShrink: 0 }}>{pivotUnitOf(metricDef)}</span>
        </div>
      )}
      <div ref={boxRef}>{body}</div>
      {body && hiddenCount > 0 && (
        <div className="sans" style={{ marginTop: 6, fontSize: 12, color: "var(--c-ink-3)" }}>
          残り{hiddenCount}件は表示していません（見分けのつく系列は6本まで）。フィルターで絞ると全部見えます
        </div>
      )}
    </div>
  );
}

// 奏者が「自分」のセッションだけを集めた経時変化グラフ。分析タブの一番上に表示し、
// 自分の演奏がどう変化しているかを他のリード・セッションのデータから独立して確認できるようにする。
// My Dataで扱う4指標。
// 【N-8 2026/08/16 本人指示】idealKey(目安プロファイルとの対応)はこの配列から削除した:
// 目安の破線と Δ は My Data の全グラフから外れた(「目安は表示不要」)ため、読み手が無い。
// 他画面(リード詳細・セッション詳細)の目安対応は METRIC_IDEAL_KEYS が引き続き持つ。
const MY_DATA_METRICS = [
  { key: "volumeDb", label: "音量", unit: "dB", fmt: (v) => v.toFixed(1) },
  // 【N-6】ラベルは正典どおり「重心」(design/north-star-measure.html の .mrow .l)。
  { key: "spectralCentroidHz", label: "重心", unit: "Hz", fmt: (v) => Math.round(v).toString() },
  { key: "hnrDb", label: "HNR", unit: "dB", fmt: (v) => v.toFixed(1) },
  // 【2026-08-04 本人指示】「0を挟んで上が＋・下がマイナス、折れ線は1本」。
  // 以前はブレ幅(標準偏差、常に非負)を ±v の2本のミラーで描いていたが、本人が見たいのは
  // 「シャープ側/フラット側のどちらにどれだけズレたか」だったので、符号付きの平均ズレ
  // (pitchCentsSigned)に変えた。ラベルは【F-46 本人指示】の統一を経て【N-2】で「平均差分」になった。
  // 【N-10 2026/08/17 本人指示・審査で訂正】この指標は My Data の**数字カード4枚の先頭
  // (＝既定で選ばれているカード)**になった。初版のコメントは N-6 当時の「行の列としては
  // 使われない」を残しており、根拠に挙げていた MY_DATA_ROW_METRICS は N-10 で削除済み
  // (実装と真逆の断定だった)。ラベル・単位・書式・副次テキストの唯一の答えである点は不変。
  // 【N-7 2026/08/16 本人指示】N-6 の「ヒーローの数字をタップして開く」は廃止し、常時表示にした。
  // 【N-8 2026/08/16 本人指示】その常時表示のピッチ折れ線は、単独のカード(.pitchcard)ごと廃止し、
  // **ヒーロー(紺のカード)の中**へ移った(旧スパークラインの場所)。fmt はここが唯一の答えのまま。
  // sub は副次テキストの導出(F-66)。この指標だけが持つ
  { key: "pitchCentsSigned", label: "平均差分", unit: "¢", fmt: formatSignedCents, sub: pitchSpreadSub },
];

// (【N-8 2026/08/16 本人指示】idealAvgForFrames(目安の加重平均。Δ の導出)はここにあったが、
//  目安の破線と Δ が My Data の全グラフから外れて読み手が無くなったため削除した。)

// 3ヶ月/6ヶ月/1年は「直近Nヶ月」のローリング期間。1年より前のデータは1年単位の
// 期間(2年目=1〜2年前、3年目=2〜3年前…)で追加抽出できるようにする。
const MY_DATA_RANGES = [
  { key: "yesterday", label: "昨日" },
  { key: "1w", label: "1週間" },
  { key: "1m", label: "1ヶ月" },
  { key: "3m", label: "3ヶ月" },
  { key: "6m", label: "6ヶ月" },
  { key: "1y", label: "1年" },
  { key: "3y", label: "3年" },
  { key: "5y", label: "5年" },
  { key: "all", label: "全期間" },
];

function getMyDataRangeBounds(rangeKey, now) {
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const back = (fn) => { const d = new Date(now); fn(d); return { start: d, end: null }; };
  if (rangeKey === "yesterday") { const s = new Date(startOfToday); s.setDate(s.getDate() - 1); return { start: s, end: startOfToday }; }
  if (rangeKey === "1w") return back((d) => d.setDate(d.getDate() - 7));
  if (rangeKey === "1m") return back((d) => d.setMonth(d.getMonth() - 1));
  if (rangeKey === "3m") return back((d) => d.setMonth(d.getMonth() - 3));
  if (rangeKey === "6m") return back((d) => d.setMonth(d.getMonth() - 6));
  if (rangeKey === "1y") return back((d) => d.setFullYear(d.getFullYear() - 1));
  if (rangeKey === "3y") return back((d) => d.setFullYear(d.getFullYear() - 3));
  if (rangeKey === "5y") return back((d) => d.setFullYear(d.getFullYear() - 5));
  return { start: null, end: null }; // all
}

// 【N-8 2026/08/16 本人指示】「当日のデータがまだない場合は直近の記録のある日の平均を表示」。
// 対象 = 呼び出し側が渡す「奏者=自分 + 選択中の楽器種別」のセッション(allMySessions)のうち、
// フレームを持つものの最新 recordedAt の**ローカル暦日**の全フレーム(暦日の組み立ては
// localDayKey ただ1箇所。toISOString の UTC 暦日を使ってはいけない — localDayKey の解説を見ること)。
// 戻り値 { frames, label }:
//   - その暦日が今日なら label = "今日"(従来と同じ見え方)
//   - 今日でなければ label = "M/D"(例 "8/15")。**「今日」と偽らない**(N8-SPEC 5)
//   - フレームを持つ記録が1件も無ければ frames = [] / label = "今日"(呼び出し側は従来どおりの空表示)
// ヒーローの数字・折れ線の濃い線・3行のヘッダの**すべてがこの1関数の戻り値を使う**
// (規則を2箇所に写さない。どれかが別の規則で「今日」を出すと、日付ラベルと数字の母集団がずれる)。
function myDataTodayOrLatestFrames(sessions, now) {
  const withFrames = sessions.filter((s) => (s.frames || []).length > 0);
  if (withFrames.length === 0) return { frames: [], label: "今日" };
  const latest = withFrames.reduce((a, b) => (new Date(b.recordedAt) > new Date(a.recordedAt) ? b : a));
  const d = new Date(latest.recordedAt);
  const dayKey = localDayKey(d);
  const frames = withFrames
    .filter((s) => localDayKey(new Date(s.recordedAt)) === dayKey)
    .flatMap((s) => s.frames || []);
  return { frames, label: dayKey === localDayKey(now) ? "今日" : `${d.getMonth() + 1}/${d.getDate()}` };
}

// 【N-10 2026/08/17 本人指示】数字カードに並べる指標と**その順**(正典 = 案K +
// 本人の追加指示「ピッチ・重心・音量・HNR の数字カードは残して、それぞれをタップすると
// そのグラフが表示される」)。仕様の並びは ピッチ(=平均差分) / HNR / 重心 / 音量。
// **既定の選択は先頭**(＝平均差分)。中身の定義(ラベル・単位・書式)は MY_DATA_METRICS が
// 唯一の答えで、ここはキーの並びだけを持つ(定義を2箇所に写さない)。
// (N-7〜N-9 の MY_DATA_ROW_METRICS = 常時表示の3行は N-10 で廃止。グラフは常に1枚だけになった。)
const MY_DATA_CARD_METRICS = ["pitchCentsSigned", "hnrDb", "spectralCentroidHz", "volumeDb"];

// 【N-10 2026/08/17 本人指示】上部の「蓄積量の数字」(正典 案K の .stock = 46回 / 12.5時間 /
// 3,120音)。母集団はヒーロー(旧)と同じ = 呼び出し側が渡す「奏者=自分 + 選択楽器 + 選択期間」。
//   セッション数 … 渡された件数そのもの
//   総演奏時間   … sessionDurationSec の合計(録音長そのものは保存されていないので、
//                  一覧の m:ss と**同じ1箇所**から出す)
//   計測した音   … noteEvents(ノート区間分割。計測タブが「検出ノート」と呼んでいるもの)の合計。
//                  noteEvents を持たない旧セッションは 0 として数える(新しい推定規則を作らない)
function myDataStock(sessions) {
  let seconds = 0, noteCount = 0;
  for (const s of sessions || []) {
    const sec = sessionDurationSec(s);
    if (sec !== null) seconds += sec;
    noteCount += Array.isArray(s?.noteEvents) ? s.noteEvents.length : 0;
  }
  return { sessionCount: (sessions || []).length, seconds, noteCount };
}
// 3桁ごとのカンマ。正典 案K の「3,120」。Intl のロケール既定に依存させない(端末で表記が変わる)。
function groupDigits(n) {
  return String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
// 蓄積量の**表示文字列**。数字の作り方(小数1桁の時間・カンマ区切り)をここ1箇所に閉じる。
// 単位とラベルは呼び出し側(JSX)が並べる — 文字の大きさが違うので span を分けるため。
function myDataStockTexts(stock) {
  return {
    sessions: groupDigits(stock.sessionCount),
    // 【D-1】小数1桁の規則は hoursText の1箇所(カレンダーの合計時間と共有)。
    hours: hoursText(stock.seconds),
    notes: groupDigits(stock.noteCount),
  };
}




// ================= 【D-1 2026/08/22 本人指示・凍結仕様 design/D1-SPEC.md】=================
// My Data は Design canon(claude.ai/design の「MyData Tab.dc.html」)の **#9b** へ移った。
// 正典の写しは design/dc-mydata-redesign.html(取り込みの制約もそのファイルの冒頭に書いてある)。
// 画面は「12音名 × オクターブ のマトリクス2枚 + 発散カラースケールの凡例 + 5週の練習カレンダー」。
// N-11 の折れ線(案P)とばらつきの帯は**正典が却下側に置いた**ので画面から外れた
// (却下理由「音名は連続量ではないため」)。NoteAxisLineChart 自体は他の4画面が使うので残す。
//
// 【本人の裁定 2026/08/22】README は「色・サイズ・余白の数値はそのまま使え」と書いているが、
// 採るのは**レイアウト・構造・余白の関係だけ**で、色/フォント/文字サイズは index.css の
// トークンへ写像する(DESIGN-SYSTEM「新しい値を発明しない」が上位)。
// **唯一の例外が発散カラースケール**で、これだけ体系に無かったので正典から取り込んだ。

// 比較対象。**上下2枚のマトリクスで共通**(別々には選べない。正典 #9b)。
// ±0 は平均差分のときだけ列に増える(README「平均差分タブのときだけ ±0 が追加される」)。
const MY_DATA_COMPARE_TARGETS = [
  { key: "myAverage", label: "自分の平均" },
  { key: "reference", label: "目安" },
  { key: "zero", label: "±0", pitchOnly: true },
];
// 平均差分のキー。「±0 が出るのはこの指標だけ」という規則を綴りで2箇所に持たないための1箇所。
const MY_DATA_SIGNED_METRIC = "pitchCentsSigned";

// この指標を選んでいるときに選べる比較対象。**押せない選択肢を出さない**(F-77 の罠)ので、
// 目安が未設定なら「目安」も列から落ちる。
function myDataCompareTargets(metricKey, hasIdeal) {
  return MY_DATA_COMPARE_TARGETS.filter((t) => {
    if (t.pitchOnly && metricKey !== MY_DATA_SIGNED_METRIC) return false;
    if (t.key === "reference" && !hasIdeal) return false;
    return true;
  });
}
// 選べなくなった比較対象が選ばれたまま残らないようにする(指標タブを平均差分から動かした/
// 目安を消した、のどちらでも起きる)。落とし先は必ず先頭 = 自分の平均。
function myDataCompareFallback(targetKey, metricKey, hasIdeal) {
  return myDataCompareTargets(metricKey, hasIdeal).some((t) => t.key === targetKey)
    ? targetKey
    : MY_DATA_COMPARE_TARGETS[0].key;
}

// groupFramesByNote は重心だけ "centroidHz" という別の綴りで返す。**対応づけはこの1関数だけ**
// (NoteAxisLineChart が同じ式をローカルに持っている形を、D-1 の新しい経路には持ち込まない)。
// 理想値プロファイルの音ごとの値も同じ綴りなので、目安の読み出しにも使う。
function noteGroupKeyOf(metricKey) {
  return metricKey === "spectralCentroidHz" ? "centroidHz" : metricKey;
}

// 【D-1】音(semitoneIndex)ごとの代表値。**軸に無い音は byIdx に入れる前に落とす**
// (N-11 で踏んだ罠と同じ形: 落とさないと軸の外の音が最大絶対値を吊り上げ、
//  マトリクス全体の色が薄くなる)。ガードは代入より必ず前に置くこと。
function noteValuesByIdx(frames, metricKey, count, saxType, tuningHz) {
  const groupKey = noteGroupKeyOf(metricKey);
  const out = {};
  for (const g of groupFramesByNote(frames || [], undefined, saxType, tuningHz)) {
    if (g.semitoneIndex >= count) continue;
    const v = g[groupKey];
    if (v !== null && v !== undefined && !isNaN(v)) out[g.semitoneIndex] = v;
  }
  return out;
}

// 【D-1】比較対象の音ごとの値。読めない音は**入れない**(0 で埋めない = そのセルは空になる)。
//   自分の平均 … 選択期間の平均(呼び出し側が既に作ってある periodByIdx をそのまま使う)
//   目安       … getNoteIdeal(選択中の理想値プロファイル)
//   ±0        … 定数 0(平均差分のときだけ選べる)
function compareTargetByIdx(targetKey, periodByIdx, selectedIdeal, metricKey, count) {
  if (targetKey === "zero") {
    const m = {};
    for (let i = 0; i < count; i++) m[i] = 0;
    return m;
  }
  if (targetKey === "reference") {
    const groupKey = noteGroupKeyOf(metricKey);
    const m = {};
    for (let i = 0; i < count; i++) {
      const v = getNoteIdeal(selectedIdeal, i)?.[groupKey];
      if (v !== null && v !== undefined && !isNaN(v)) m[i] = v;
    }
    return m;
  }
  return periodByIdx || {};
}

// 【D-1】マトリクスの中身。**行(オクターブ)は固定しない。** 正典 #9b は 3/4/5 の3行だが、
// それは Alto のときの実際の音域で、Tenor は1オクターブ下がる(罠4「箇所数の釘付け禁止」)。
// 音名とオクターブは concertNoteLabelOf の戻り値を parseNoteLabel で割るだけ
// (実音ラベルの作り方を2箇所に書かない。F-54 で実音に統一済み)。
// 列は NOTE_NAMES そのもの(**この配列が唯一の答え**。正典の A♭ ではなく体系の G♯ を使う)。
// 戻り値 { octaves, byKey, maxAbs, min, max, count }:
//   byKey の鍵は "オクターブ:音名"。値が読めない音は鍵ごと持たない(空セルになる)。
//   maxAbs は**このマトリクスの実測の最大絶対値**。色はこれで毎回引き直す(固定閾値ではない)。
function buildNoteMatrix(valueByIdx, targetByIdx, count, saxType, tuningHz) {
  const byKey = {};
  const octaves = [];
  let min = null, max = null, filled = 0;
  for (let i = 0; i < count; i++) {
    const p = parseNoteLabel(concertNoteLabelOf(i, saxType, tuningHz) || "");
    if (!p) continue;
    const oct = Number(p.octave);
    if (!octaves.includes(oct)) octaves.push(oct);
    const a = valueByIdx ? valueByIdx[i] : undefined;
    const b = targetByIdx ? targetByIdx[i] : undefined;
    if (a === null || a === undefined || isNaN(a)) continue;
    if (b === null || b === undefined || isNaN(b)) continue;
    const d = a - b;
    byKey[oct + ":" + p.name] = d;
    filled += 1;
    if (min === null || d < min) min = d;
    if (max === null || d > max) max = d;
  }
  octaves.sort((x, y) => x - y);
  const maxAbs = min === null ? 0 : Math.max(Math.abs(min), Math.abs(max));
  return { octaves, byKey, min, max, maxAbs, count: filled };
}

// 【D-1】発散カラースケールの段(1..8)。1 = いちばん低い(青) / 8 = いちばん高い(金)。
// maxAbs は**そのマトリクスの実測の最大絶対値**を渡す(固定閾値にしない。README の指定)。
// 0 は 5(金側のいちばん淡い段)、0 未満は 4(青側のいちばん淡い段)に落ちる。
const DIVERGING_STEPS = 8;
function divergingStep(v, maxAbs) {
  if (!(maxAbs > 0)) return v < 0 ? 4 : 5;
  const t = Math.max(-1, Math.min(1, v / maxAbs));
  return Math.max(0, Math.min(DIVERGING_STEPS - 1, Math.floor(((t + 1) / 2) * DIVERGING_STEPS))) + 1;
}
// hex は index.css の --c-div-1..8 が持つ(値を2箇所に写さない)。ここは段の番号だけを扱う。
function divergingFill(step) { return "var(--c-div-" + step + ")"; }
// セルの数字の色。**相対輝度から出した答えを表として固定する**(実行時に計算しない)。
// 白(--c-on-accent)と濃(--c-ink #121F32)のコントラスト比の実測(統括が計算):
//   1 #43719F 白5.12 / 濃3.24 → **白**     5 #E2D0A3 白1.52 / 濃10.87 → 濃
//   2 #658BB1 白3.57 / 濃4.64 → 濃         6 #D1B570 白1.99 / 濃 8.33 → 濃
//   3 #89A6C3 白2.53 / 濃6.55 → 濃         7 #C39F45 白2.51 / 濃 6.60 → 濃
//   4 #B3C6D9 白1.75 / 濃9.46 → 濃         8 #B5891C 白3.20 / 濃 5.17 → 濃
// 左右の端で答えが揃わないのは**2つの端の明度が違うから**で、揃えると片方が読めなくなる。
function divergingInk(step) { return step === 1 ? "var(--c-on-accent)" : "var(--c-ink)"; }

// 【D-1】セルの数字。**4指標とも符号付きの整数**にする。
// 平均差分だけ formatSignedCents(小数1桁)を使う手もあるが、"+12.3" は5字あり、
// 375px 実機のセル内幅 22.17px(D1-SPEC 2.4)に入らない。セルは色が主で数字は副なので、
// 全指標を整数に揃える(書式を指標ごとに分けない = 読み手が桁の意味を取り違えない)。
// Math.round(-0.4) は -0 になるが String(-0) === "0" なので「-0」は出ない。
// 桁が4字を超える極端な値(重心の千単位の差など)はセル側の overflow: hidden が切る。
// **色は切れない**ので、値そのものが読めなくても「高い/低い」は必ず伝わる。
function matrixCellText(v) {
  if (v === null || v === undefined || isNaN(v)) return "";
  const r = Math.round(v);
  return r > 0 ? "+" + r : String(r);
}
// マトリクス右上の実測レンジ。読める値が1つも無ければ「—」。
function matrixRangeText(m) {
  if (!m || m.count === 0) return "—";
  return matrixCellText(m.min) + " 〜 " + matrixCellText(m.max);
}

// 【D-1】5週の練習カレンダー。窓は**今日を含む週の日曜まで**の35日で、
// 週の始まりは月曜(正典 #9b の曜日ヘッダが 月〜日)。
// 暦日は localDayKey ただ1つで組み立てる(罠14: toISOString の UTC 暦日は JST 00〜09時で前日にずれる)。
const CALENDAR_WEEKS = 5;
const CALENDAR_DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];
// 【D-1】指標タブの見た目の間隔(正典 #9b の gap:22px)の半分。子タブ行の
// DATA_SUBTAB_HALF_GAP_PX と同じ役目 — 行の gap を 0 にして左右へこの値の padding を入れ、
// **見た目の間隔を変えずに**当たり判定だけ 44pt へ広げる(§5)。値の唯一の答えはここ。
const MY_DATA_METRIC_TAB_HALF_GAP_PX = 11;
// 【D-1】カレンダーのマスの高さ。正典 #9b は 34px だが、**375px の実機では §5 を満たせない**:
// 7列 × 5週のマスは 402px の正典だと 44.3px 角に収まるのに対し、375px では 41.3 × 34 になる
// (統括の実測)。README 自身が「タップ可能要素は最小44px高」と書いているので、
//   ・縦 … 34 → 44 へ上げる(正典より 10px 高い。**意図した差**)
//   ・横 … グリッドだけカードの padding を食い破って地の端まで広げる(46.1px 角になる)
// の2つで 44×44 を満たす。マスの色・角丸・gap・週の数は正典のまま。
const CALENDAR_CELL_H = 44;
function practiceCalendarDays(sessions, now) {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const dow = (end.getDay() + 6) % 7;   // 月=0 … 日=6
  end.setDate(end.getDate() - dow + 6); // その週の日曜
  const byDay = {};
  for (const s of sessions || []) {
    const k = localDayKey(new Date(s.recordedAt));
    if (!byDay[k]) byDay[k] = { minutes: 0, count: 0 };
    const sec = sessionDurationSec(s);
    byDay[k].minutes += sec === null ? 0 : sec / 60;
    byDay[k].count += 1;
  }
  const days = [];
  for (let i = CALENDAR_WEEKS * 7 - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const k = localDayKey(d);
    const hit = byDay[k] || { minutes: 0, count: 0 };
    days.push({ key: k, date: d, minutes: hit.minutes, count: hit.count });
  }
  return days;
}
// 濃さ 0..4。**記録がある日は必ず 1 以上**(長さが保存されていない古いセッションでも、
// 練習した日が「していない日」と同じ色になってはいけない)。
function calendarLevel(minutes, maxMinutes, count) {
  if (!(count > 0)) return 0;
  if (!(maxMinutes > 0)) return 1;
  const t = minutes / maxMinutes;
  if (t <= 0.25) return 1;
  if (t <= 0.5) return 2;
  if (t <= 0.75) return 3;
  return 4;
}
// 色は**既存の紺ランプそのまま**(新しい値を発明しない)。0 = 記録なし。
const CALENDAR_FILLS = ["var(--c-sunk)", "var(--c-accent-tint)", "var(--c-accent-line)", "var(--c-accent-mid)", "var(--c-accent)"];
function calendarFill(level) { return CALENDAR_FILLS[level] ?? CALENDAR_FILLS[0]; }

// 秒 → 「9.4」。小数1桁の規則をここ1箇所に閉じる(myDataStockTexts とカレンダーの合計時間が共有)。
function hoursText(seconds) { return ((Number(seconds) || 0) / 3600).toFixed(1); }

// 【D-1】My Data の母集団。奏者=自分 かつ 選択中の楽器種別。
// セッションの楽器種別は `s.saxType ?? 現在のsaxType`(セッション詳細と同じ既存のフォールバック規則)。
// マトリクスもカレンダーも**この1関数から母集団を取る**(規則を2箇所に写さない)。
function myDataOwnSessions(sessions, saxType, dataSax) {
  return (sessions || []).filter((s) => s.performer === "自分" && (s.saxType ?? saxType) === dataSax);
}

// 【N-6】データタブの選択・操作シート。子タブ行の「…」も、フィルタピルの選択肢も、
// ヒーローの期間セレクタも、出るものはこの1枚。
// 作法(暗幕・角丸28・つまみ36×4・影・44ptの行)はリードタブの「…」(ReedMoreMenu)と
// テンポシートに揃える。**新しい濃さ・角丸・影を発明しない。**
// **押せない項目は呼び出し側が渡さない**(F-77 で「0リードなのに使えない削除が出る」を踏んでいる)。
function DataOptionSheet({ ariaLabel, items, value, onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // 【F-90】下スワイプで閉じる。カードの中は縦スクロールし得るので、
  // useSheetDismiss が**先頭に居るときだけ**ドラッグとして扱う。
  const dismiss = useSheetDismiss(onClose);
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={ariaLabel}
      onClick={onClose}
      data-noswipe
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "rgba(15,23,42,0.28)",
        display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center",
      }}
    >
      <div
        ref={dismiss.ref} {...dismiss.handlers}
        onClick={(e) => e.stopPropagation()}
        data-noswipe
        style={{
          width: "100%", maxWidth: 900, background: "var(--c-surface)",
          borderRadius: "28px 28px 0 0", boxShadow: "0 8px 24px rgba(15,23,42,0.18)",
          padding: "14px 24px", paddingBottom: "calc(40px + env(safe-area-inset-bottom))",
          display: "flex", flexDirection: "column", alignItems: "stretch",
          /* リードの候補は箱1つで10枚増えるので、シートは画面を越え得る(ReedMoreMenu は
             項目が2つ固定なので上限を持たない)。下端に貼り付く作りなので、越えると
             **上の項目から画面外へ出て届かなくなる**。上限は新しい割合を発明せず、
             既にある2つの値だけで書く: 画面の高さ(--app-root と同じ 100dvh)から
             下部ナビ1つぶん(--nav-h)を引く。残る帯は暗幕なので、そこを押せば閉じられる。
             dvh 未対応の環境ではこの宣言ごと落ちて上限なし(＝現行の ReedMoreMenu と同じ)になる。 */
          maxHeight: "calc(100dvh - var(--nav-h))", overflowY: "auto",
        }}
      >
        <button
          onClick={onClose} aria-label="閉じる" className="no-select"
          style={{ width: "var(--tap-min)", height: "var(--tap-min)", alignSelf: "center", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}
        >
          <span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--c-line-strong)", display: "block" }} />
        </button>
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => onPick(it.key)}
            className="sans"
            aria-pressed={value !== undefined ? value === it.key : undefined}
            style={{
              minHeight: "var(--tap-min)", display: "flex", alignItems: "center",
              background: "none", border: "none", borderBottom: "1px solid var(--c-line)",
              padding: 0, cursor: "pointer", fontSize: 14, textAlign: "left",
              color: value !== undefined && value === it.key ? "var(--c-accent)" : "var(--c-ink)",
              fontWeight: value !== undefined && value === it.key ? 600 : 400,
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// My Data: 奏者が「自分」のセッションの集計。
// 【N-11 2026/08/17 本人指示】**正典は design/mydata-v2-proposals.html の案P**へ移った
//   (mydata-zero-proposals-2.html の案K は N-10 までの正典。移行の理由はそちらの冒頭コメント)。
//   ただし**グラフカードの地だけ同ファイルの案R の灰**(本人「P案。ただしカードの色だけR案の灰」)
//   = 実装は既存トークン --c-sunken。
//   並びは 蓄積量の数字3つ(回 / 時間 / 音) → **グラフカード**(4指標のタブ →
//   選択中の指標の数字1つ + 凡例 → 常に1枚だけのグラフ)。
//   楽器 ▾ · 期間 ▾ は**子タブ行の右端**へ移った(MyDataScopePicker。上部の空白の解消)。
//   グラフは 期間平均=薄 / 直近日=濃 + ばらつきの帯。目安の破線と Δ は出さない(N-8 を継続)。
//   紺のヒーローカードと評価ピル(Great 等)は N-10 で廃止済み。
// 【N-7 2026/08/16 本人指示】**楽器種別と期間が効くのは上部の数字とグラフだけ**で、
//   セッション一覧には効かせない(N7-SPEC 2。一覧の絞り込みは既存のピルが担う。二重の絞りは混乱のもと)。
// 【N-8 2026/08/16 本人指示】今日のデータが無い日は「直近の記録のある日」で代替
//   (myDataTodayOrLatestFrames。ラベルはその日付)。
// 【D-1 2026/08/22 本人指示・凍結仕様 design/D1-SPEC.md】マトリクスカード。
// 正典 design/dc-mydata-redesign.html の #9b。器は **.surf-sunk の中の .card**
// (地 --c-sunk / 角丸 --r-md / padding --sp-4)。正典は「淡い地 + 白カード + 影」だが、
// 本人の裁定「既存トークンへ寄せる」に従い、**図と地の関係が同じ既存の作法**へ写像した。
// **インライン style で background / border / padding を書かない**(作法が丸ごと死ぬ。
// index.css の「いちばん壊れやすいところ その1」)。marginTop だけは作法が持たないので書く。
function NoteMatrixCard({ title, sub, metricKey, matrix }) {
  return (
    <div className="card" style={{ marginTop: "var(--sp-3)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingBottom: "var(--sp-3)" }}>
        <div style={{ minWidth: 0 }}>
          <div className="sans" style={{ fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--c-ink)" }}>{title}</div>
          <div className="sans" style={{ fontSize: 10, color: "var(--c-ink-3)", marginTop: 2 }}>{sub}</div>
        </div>
        {/* そのマトリクスの実測レンジ。色の段を引く maxAbs と**同じ matrix から出す**
            (「色は実測レンジで毎回引き直す」を、読み手が数字で確かめられるようにする)。 */}
        <span style={{ fontFamily: "var(--font-num)", fontSize: 10, color: "var(--c-ink-3)", flexShrink: 0 }}>
          {matrixRangeText(matrix)}
        </span>
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        {/* 左のオクターブ番号の列。上の音名ラベル行(高さ14px)ぶん下げてから 26px の行に揃える。 */}
        <div style={{ width: 11, flexShrink: 0, display: "flex", flexDirection: "column", gap: 3, paddingTop: 14 }}>
          {matrix.octaves.map((oct) => (
            <span
              key={oct}
              style={{ height: 26, display: "flex", alignItems: "center", fontFamily: "var(--font-num)", fontSize: 10, color: "var(--c-ink-3)" }}
            >
              {oct}
            </span>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 3, marginBottom: 3 }}>
            {NOTE_NAMES.map((pc) => (
              <span key={pc} className="sans" style={{ fontSize: 10, color: "var(--c-ink-3)", textAlign: "center", overflow: "hidden" }}>{pc}</span>
            ))}
          </div>
          {matrix.octaves.map((oct) => (
            <div key={oct} style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 3, marginBottom: 3 }}>
              {NOTE_NAMES.map((pc) => {
                const v = matrix.byKey[oct + ":" + pc];
                // 音域の外の音も、データが読めない音も、**同じ空セル**にする(穴を作らない)。
                if (v === null || v === undefined || isNaN(v)) {
                  return <div key={pc} style={{ height: 26 }} />;
                }
                const step = divergingStep(v, matrix.maxAbs);
                return (
                  <div
                    key={pc}
                    style={{
                      height: 26, borderRadius: "var(--r-xs)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      overflow: "hidden",
                      /* 【9.5px の根拠 — Browser pane 375×812 の実測】
                         セルの内幅は **22.00px**。この font での送り幅は
                         "-240" 19.17 / "+240" 21.88 / "+999" 21.88 / "-88" 14.05 px。
                         **4字までは収まる**(いちばん厳しい "+NNN" で余裕 0.12px)。
                         10px にすると "+240" が 23.03px になって溢れる。正典は 8.5px。
                         5字("+1200" = 26.98px)は溢れるので overflow: hidden が切る
                         — 色は切れないので「高い/低い」の信号は必ず残る。 */
                      fontFamily: "var(--font-num)", fontSize: 9.5,
                      background: divergingFill(step), color: divergingInk(step),
                    }}
                  >
                    {matrixCellText(v)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 【D-1】発散カラースケールの凡例。**カード2枚の外側に1つだけ**(正典 #9b)。
// 方向ラベルは4指標とも「低い ← → 高い」。README は「指標によってラベルが変わる」と
// 書いているが、**具体の語は取り込めなかった側(256KiB で切れた <script>)にあって正典から
// 読めない**。本人の既出の原則「データの事実を提示するだけで解釈はユーザーに委ねたい」に
// 沿う語を選び、推測で「澄んだ」「明るい」等の解釈語を作らない(BACKLOG に起票)。
function DivergingLegend() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "var(--sp-3) var(--sp-2) 0" }}>
      <span className="sans" style={{ fontSize: 10, color: "var(--c-ink-3)", flexShrink: 0 }}>低い</span>
      <div style={{ display: "flex", flex: 1, gap: 2 }}>
        {Array.from({ length: DIVERGING_STEPS }, (_, i) => i + 1).map((step) => (
          <div
            key={step}
            aria-hidden="true"
            style={{
              flex: 1, height: 5, background: divergingFill(step),
              borderRadius: step === 1 ? "3px 0 0 3px" : step === DIVERGING_STEPS ? "0 3px 3px 0" : 0,
            }}
          />
        ))}
      </div>
      <span className="sans" style={{ fontSize: 10, color: "var(--c-ink-3)", flexShrink: 0 }}>高い</span>
    </div>
  );
}

// 【D-1】練習カード「この5週の練習」(正典 #9b)。
// 母集団はマトリクスと同じ(奏者=自分 + 選択中の楽器種別)。**期間セレクタには従わない**
// (見出しが「この5週」と言い切っているため。窓は常に直近5週 = practiceCalendarDays)。
// 選択日のセッション行のタップが**セッション詳細への入口**で、最下行が全件一覧への入口。
function PracticeCalendarCard({ sessions, reeds, totalSessionCount, onOpenSession, onOpenAllSessions }) {
  const now = new Date();
  const days = practiceCalendarDays(sessions, now);
  const maxMinutes = days.reduce((a, d) => Math.max(a, d.minutes), 0);
  const totalSeconds = days.reduce((a, d) => a + d.minutes, 0) * 60;
  // 既定の選択日 = **記録のある最新の日**(無ければ窓の末日)。窓は毎日ずれるので、
  // 選んだ日が窓から出たら既定へ戻す(選択が窓の外に取り残されない)。
  const [selKey, setSelKey] = useState(null);
  const latest = [...days].reverse().find((d) => d.count > 0) || null;
  const selected = days.find((d) => d.key === selKey) || latest || days[days.length - 1];
  const daySessions = (sessions || [])
    .filter((s) => localDayKey(new Date(s.recordedAt)) === selected.key)
    .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));

  return (
    <div className="card" style={{ marginTop: "var(--sp-3)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: "var(--sp-3)" }}>
        <span className="sans" style={{ fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--c-ink)" }}>この5週の練習</span>
        <span className="sans" style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink)", flexShrink: 0 }}>
          <b style={{ fontFamily: "var(--font-num)", fontWeight: 600 }}>{hoursText(totalSeconds)}</b> 時間
        </span>
      </div>
      {/* 【D-1 §5】曜日ヘッダとマスの grid は**カードの padding を食い破って地の端まで**広げる
          (375px でマスを 44 角にするため。CALENDAR_CELL_H の解説を見ること)。
          食い破る量は .card の padding と同じ --sp-4 で、**値を写さずトークンから引く**。
          ヘッダも同じだけ広げないと列がずれる(2箇所を同じ式にする)。 */}
      <div className="sans" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, fontSize: 10, color: "var(--c-ink-3)", textAlign: "center", marginLeft: "calc(-1 * var(--sp-4))", marginRight: "calc(-1 * var(--sp-4))" }}>
        {CALENDAR_DAY_LABELS.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginTop: 6, marginLeft: "calc(-1 * var(--sp-4))", marginRight: "calc(-1 * var(--sp-4))" }}>
        {days.map((d) => {
          const level = calendarLevel(d.minutes, maxMinutes, d.count);
          const isSel = d.key === selected.key;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => setSelKey(d.key)}
              aria-pressed={isSel}
              aria-label={formatMonthDay(d.date) + " " + (d.count > 0 ? d.count + "件" : "記録なし")}
              style={{
                /* 見た目そのものが当たり判定。高さは CALENDAR_CELL_H(§5 を満たす 44)、
                   横は上の grid が地の端まで広がることで 46.1px になる(375px の実測)。 */
                height: CALENDAR_CELL_H, padding: 0, cursor: "pointer",
                borderRadius: "var(--r-sm)",
                background: calendarFill(level),
                /* 選択日は枠で示す(正典 #9b「選択日は border で示す」)。
                   選択していない日も **1px 分の場所を確保する**(F-75 の作法。
                   枠を 0 にするとマスが 2px 動く)。 */
                border: isSel ? "2px solid var(--c-ink)" : "2px solid transparent",
                boxSizing: "border-box",
              }}
            />
          );
        })}
      </div>
      <div style={{ marginTop: "var(--sp-4)", paddingTop: 13, borderTop: "1px solid var(--c-line)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
          <span className="sans" style={{ fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--c-ink)" }}>{formatMonthDay(selected.date)} のセッション</span>
          <span className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", flexShrink: 0 }}>{daySessions.length} 件</span>
        </div>
        {daySessions.length === 0 ? (
          <div className="sans" style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", padding: "8px 0" }}>この日の記録はありません</div>
        ) : (
          daySessions.map((s) => {
            const reed = (reeds || []).find((r) => r.id === s.reedId) || null;
            // 読めない区画は**丸ごと省く**(「—:—」のような穴を作らない。案P から不変の作法)。
            const meta = [reedShortLabel(reed, reeds) ?? "未紐付け", s.performer || null].filter(Boolean).join(" · ");
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpenSession(s.id)}
                className="sans"
                style={{
                  width: "100%", minHeight: "var(--tap-min)",
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                  padding: "10px 0", background: "none", border: "none",
                  borderBottom: "1px solid var(--c-line)", cursor: "pointer", textAlign: "left",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: "var(--fs-sm)", color: "var(--c-ink)" }}>{formatYmd(s.recordedAt, { timeOnly: true })}</span>
                  <span style={{ display: "block", fontSize: 10, color: "var(--c-ink-3)", marginTop: 2 }}>{meta}</span>
                </span>
                <span style={{ fontFamily: "var(--font-num)", fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", flexShrink: 0 }}>{sessionDurationLabel(s) ?? ""}</span>
              </button>
            );
          })
        )}
        {/* 正典 #9b の最下行。**全件一覧(絞り込み・選択削除つき)への唯一の入口**。 */}
        <button
          type="button"
          onClick={onOpenAllSessions}
          className="sans"
          style={{
            width: "100%", minHeight: "var(--tap-min)",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
            padding: "12px 0 0", background: "none", border: "none", cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--c-accent)" }}>すべてのセッション {totalSessionCount} 件</span>
          <span aria-hidden="true" style={{ fontSize: "var(--fs-md)", color: "var(--c-line-strong)" }}>›</span>
        </button>
      </div>
    </div>
  );
}

function MyDataSection({ sessions, reeds, selectedIdeal, saxType, tuningHz, dataSax, range, totalSessionCount, onOpenSession, onOpenAllSessions }) {
  // 【N-11】楽器種別・期間のセレクタは子タブ行の右端(MyDataScopePicker)。状態は AnalysisLabView。
  // 【D-1】母集団の規則は myDataOwnSessions の1箇所(カレンダーと共有する)。
  const allMySessions = myDataOwnSessions(sessions, saxType, dataSax);

  const now = new Date();
  const { start, end } = getMyDataRangeBounds(range, now);
  const mySessions = allMySessions
    .filter((s) => {
      const t = new Date(s.recordedAt);
      if (start && t < start) return false;
      if (end && t >= end) return false;
      return true;
    })
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  const periodFrames = mySessions.flatMap((s) => s.frames || []);
  // 【N-8】「当日のデータがまだない場合は直近の記録のある日」。選定・フレーム・ラベルは
  // myDataTodayOrLatestFrames の1箇所。**「今日」と偽らない**(N8-SPEC 5)ので、
  // 上のカードのサブ見出しもこの label を使う(正典 #9b は「今日 −」固定だが、こちらが上位)。
  const day = myDataTodayOrLatestFrames(allMySessions, now);
  const rangeLabel = MY_DATA_RANGES.find((o) => o.key === range)?.label ?? "";

  // 選択中の指標。既定は先頭(=平均差分)。永続化しない(再マウントで既定へ戻る)。
  const [cardMetric, setCardMetric] = useState(MY_DATA_CARD_METRICS[0]);
  const chartMetric = MY_DATA_METRICS.find((m) => m.key === cardMetric) ?? MY_DATA_METRICS[0];

  // 【D-1】比較対象。**上下2枚のマトリクスで共通**。選べなくなった値が選ばれたまま残らない
  // ように、状態そのものではなく myDataCompareFallback を通した値を全員が使う
  // (useEffect で書き戻すと1フレームだけ古い値で描いてしまう)。
  const hasIdeal = !!selectedIdeal;
  const [compareRaw, setCompareRaw] = useState(MY_DATA_COMPARE_TARGETS[0].key);
  const compare = myDataCompareFallback(compareRaw, chartMetric.key, hasIdeal);
  const compareOptions = myDataCompareTargets(chartMetric.key, hasIdeal);
  const compareName = MY_DATA_COMPARE_TARGETS.find((t) => t.key === compare)?.label ?? "";

  // 【D-1】**フラジオは含めない**(本人指示「mydata のカードのこのグラフにはフラジオまで
  // 入れなくていい(他は入れる)」。折れ線の後継であるマトリクスがそのまま引き継ぐ)。
  const noteCount = noteAxisCount(dataSax, false) ?? 0;
  const periodByIdx = noteValuesByIdx(periodFrames, chartMetric.key, noteCount, dataSax, tuningHz);
  const dayByIdx = noteValuesByIdx(day.frames, chartMetric.key, noteCount, dataSax, tuningHz);
  const targetByIdx = compareTargetByIdx(compare, periodByIdx, selectedIdeal, chartMetric.key, noteCount);
  const upper = buildNoteMatrix(dayByIdx, targetByIdx, noteCount, dataSax, tuningHz);
  const lower = buildNoteMatrix(periodByIdx, targetByIdx, noteCount, dataSax, tuningHz);
  // 【D-1 / D1-SPEC 4.3】下のカードを畳む条件。**正典の記述からは意図的に外している**。
  // README は「比較対象 = ±0 のときだけ折りたたむ」と書くが、±0 のときは
  // 上=その日の絶対値 / 下=期間平均の絶対値 で重複していない。実際に退化するのは
  // **比較対象 = 自分の平均**で、下は「期間平均 − 期間平均」なので全セルが構造的に 0 になる。
  const showLower = compare !== MY_DATA_COMPARE_TARGETS[0].key;

  return (
    <>
      {/* 【D-1】指標タブ(正典 #9b はヘッダーの下線タブ)。N-11 でグラフカードの中に置いた
          等幅ピルは廃止。選択中だけ --c-ink + 2px の下線(box-shadow なので高さが動かない)。
          並びと定義は MY_DATA_CARD_METRICS / MY_DATA_METRICS が唯一の答え。 */}
      <div className="sans" style={{ display: "flex", gap: 0, marginLeft: -MY_DATA_METRIC_TAB_HALF_GAP_PX, padding: "2px 0 0" }}>
        {MY_DATA_CARD_METRICS.map((key) => {
          const m = MY_DATA_METRICS.find((x) => x.key === key);
          const sel = cardMetric === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setCardMetric(key)}
              aria-pressed={sel}
              className="sans"
              style={{
                /* 【当たり判定 §5】「重心」「音量」は文字幅が 30px しかなく、正典どおり
                   padding: 0 2px にすると横 34px で 44 を割る(375×812 の実測)。
                   子タブ行(DATA_SUBTAB_HALF_GAP_PX)と同じ手で、**見た目の間隔を変えずに**
                   当たり判定だけ広げる: 行の gap を 0 にして左右に 22/2 = 11px の padding を
                   入れる(隣り合う文字の間は 11+11 = 22 のまま)。
                   先頭が 11px 右へずれるぶんは行の marginLeft で戻す。 */
                minHeight: "var(--tap-min)", minWidth: "var(--tap-min)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                padding: `0 ${MY_DATA_METRIC_TAB_HALF_GAP_PX}px`,
                background: "none", border: "none", cursor: "pointer",
              }}
            >
              {/* 下線は**文字の幅**に付く(正典 #9b)。ボタン全体に付けると 22px ぶん伸びて
                  隣の下線と繋がるので、見た目は内側の <span> が持つ。 */}
              <span
                style={{
                  display: "inline-flex", alignItems: "center", minHeight: 26, padding: "0 2px",
                  fontSize: "var(--fs-sm)", fontWeight: 600,
                  color: sel ? "var(--c-ink)" : "var(--c-ink-3)",
                  boxShadow: sel ? "inset 0 -2px 0 0 var(--c-ink)" : "none",
                }}
              >
                {m.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* 【D-1】比較対象チップ。**上下2枚で共通**。押せない選択肢は列に出さない
          (目安が未設定なら「目安」ごと消える。±0 は平均差分のときだけ増える)。 */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "var(--sp-3) 0 0", flexWrap: "wrap" }}>
        <span className="sans" style={{ fontSize: 10, color: "var(--c-ink-3)", flexShrink: 0 }}>比較対象</span>
        <div style={{ display: "flex", gap: "var(--sp-1)" }}>
          {compareOptions.map((t) => {
            const sel = compare === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setCompareRaw(t.key)}
                aria-pressed={sel}
                /* 【型】比較対象は**状態を持つ**もの(選択中が切り替わる)なので **A型 .ctl-state**。
                   地は透明・枠は --c-line-strong・選択中は枠が --c-accent になる
                   (状態は枠線の色だけで返し、地は足さない)。
                   正典 #9b は「選択中=紺の塗り / 非選択=淡い地 + 枠」だが、
                   **index.css の芯1「同じ物に枠線と違う地を両方与えない」に反する**うえ、
                   体系では紺の塗りは「主要動作の合図」に予約されている(.ctl-danger の解説)。
                   本人の裁定「既存トークンへ寄せる」に従い、選択の言語は A型へ写像した。
                   角丸(--r-sm)も地も枠も**クラスが持つ**ので、ここでインラインに書かない。 */
                className="sans ctl-state"
                style={{
                  minHeight: "var(--tap-min)", display: "inline-flex", alignItems: "center",
                  padding: "0 13px", cursor: "pointer",
                  fontSize: "var(--fs-xs)", fontWeight: 600,
                  color: sel ? "var(--c-accent)" : "var(--c-ink-2)",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 期間に「自分」のセッションが1件も無いときの文言は**現行のまま**。 */}
      {mySessions.length === 0 && (
        <div className="sans" style={{ fontSize: "var(--fs-xs)", color: "var(--c-ink-3)", padding: "12px 2px 0" }}>
          この期間の「自分」のセッションはありません
        </div>
      )}

      <NoteMatrixCard
        title="今日の自分"
        sub={day.label + " − " + compareName}
        metricKey={chartMetric.key}
        matrix={upper}
      />

      {showLower && (
        <NoteMatrixCard
          title="いつもの自分"
          sub={rangeLabel + "の平均 − " + compareName}
          metricKey={chartMetric.key}
          matrix={lower}
        />
      )}

      <DivergingLegend />

      <PracticeCalendarCard
        sessions={allMySessions}
        reeds={reeds}
        totalSessionCount={totalSessionCount}
        onOpenSession={onOpenSession}
        onOpenAllSessions={onOpenAllSessions}
      />

      {/* 目安が1つも選ばれていないことの告知は**現行のまま**残す(「目安」という機能そのものの
          状態表示。D-1 では比較対象の列から「目安」が消えることの説明も兼ねる)。 */}
      {!selectedIdeal && (
        <div className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", padding: "8px 2px 0" }}>目安未設定</div>
      )}
    </>
  );
}

// 【N-11 2026/08/17 本人指示】My Data の集計範囲セレクタ(楽器種別 ▾ · 期間 ▾)。
// **子タブ行(My Data / 分析)の右端**に置く(本人「上部が不自然に空いていてセンスがない」)。
// 独立した帯を作らないのが目的なので、行を新設せず既にある行へ相乗りする。
// 作法(素のテキスト + ▾ / 44pt の当たり判定 / 型のクラスを持たない)は F-72 から不変で、
// 位置だけが変わった。状態は呼び出し側(AnalysisLabView)が持つ:
//   楽器種別 … 既定 = 計測タブの saxType。永続化しない(再マウントで計測タブの選択へ戻る)
//   期間     … usePersistedState("myDataRange")。再マウントしても残る
// (この非対称は N7-SPEC 1 の意図そのもの。ここで変えない。)
function MyDataScopePicker({ dataSax, setDataSax, range, setRange }) {
  const [saxSheetOpen, setSaxSheetOpen] = useState(false);
  const [rangeSheetOpen, setRangeSheetOpen] = useState(false);
  const rangeOptions = MY_DATA_RANGES;
  const rangeLabel = rangeOptions.find((o) => o.key === range)?.label ?? "";
  return (
    <>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
        <button
          onClick={() => setSaxSheetOpen(true)}
          aria-expanded={saxSheetOpen}
          aria-label="集計する楽器種別を選ぶ"
          className="sans"
          style={{
            /* 【当たり判定】§5 の手当て。minWidth で広げるぶんは flex-end 側に寄せてあるので
               左の余白へ伸びるだけで、文字の位置は 1px も動かない。 */
            minHeight: "var(--tap-min)", minWidth: "var(--tap-min)",
            display: "inline-flex", alignItems: "center", justifyContent: "flex-end",
            padding: 0, background: "none", border: "none", cursor: "pointer",
            fontSize: 12, color: "var(--c-ink-3)",
          }}
        >
          {SAX_PRESETS[dataSax]?.label} ▾
        </button>
        <span className="sans" aria-hidden="true" style={{ fontSize: 12, color: "var(--c-ink-3)", whiteSpace: "pre" }}> · </span>
        <button
          onClick={() => setRangeSheetOpen(true)}
          aria-expanded={rangeSheetOpen}
          aria-label="集計する期間を選ぶ"
          className="sans"
          style={{
            minHeight: "var(--tap-min)", minWidth: "var(--tap-min)",
            display: "inline-flex", alignItems: "center", justifyContent: "flex-end",
            padding: 0, background: "none", border: "none", cursor: "pointer",
            fontSize: 12, color: "var(--c-ink-3)",
          }}
        >
          {rangeLabel} ▾
        </button>
      </div>

      {rangeSheetOpen && (
        <DataOptionSheet
          ariaLabel="集計する期間"
          items={rangeOptions.map((o) => ({ key: o.key, label: o.label }))}
          value={range}
          onPick={(k) => { setRange(k); setRangeSheetOpen(false); }}
          onClose={() => setRangeSheetOpen(false)}
        />
      )}
      {/* 【N-7】楽器種別の選択肢は計測タブと同じ SAX_PRESETS から流し込む(語彙を2箇所に置かない。
          F-87 の注意書き「別の言い方を作らないこと」と同じ)。シートは既存の DataOptionSheet。 */}
      {saxSheetOpen && (
        <DataOptionSheet
          ariaLabel="集計する楽器種別"
          items={Object.keys(SAX_PRESETS).map((k) => ({ key: k, label: SAX_PRESETS[k].label }))}
          value={dataSax}
          onPick={(k) => { setDataSax(k); setSaxSheetOpen(false); }}
          onClose={() => setSaxSheetOpen(false)}
        />
      )}
    </>
  );
}

// REED_COMPARE_METRICSの各指標に対応する目安プロファイル側のフィールド名
// (音名軸グラフに目安の破線を重ねるための対応表。平均差分は目安=0のため対象外)
const METRIC_IDEAL_KEYS = { hnrDb: "hnrDb", spectralCentroidHz: "centroidHz", volumeDb: "volumeDb", pitchCentsSigned: null };

// 【N-6】正典 .subtabs の gap は 18px。リードタブ(N-5)と同じクラスの寸法だが、
// 定数を共有すると片方を調整したときにもう片方が黙って動くので、画面ごとに持つ。
const DATA_SUBTAB_GAP_PX = 18;
// 子タブの当たり判定を 44px にするために左右へ入れる余白。左右あわせて gap と同じ量になるので、
// 行の gap を 0 にすれば**文字の間隔は正典の 18px のまま**当たり判定だけ広がる。
const DATA_SUBTAB_HALF_GAP_PX = DATA_SUBTAB_GAP_PX / 2;

// 【F-108 2026/08/17 本人指示】「セッションの削除についての機能なのに一覧との距離が遠くて
// 使いづらい。せめてスクロール不要で同一画面内に収まるように」。
// → **選択モードの入口を一覧の見出しの隣へ移した**(N-10 の「選択」。正典 案K の .shead .ops)。
// 子タブ行の「…」に入っていた項目は「セッションを選んで削除」と
// 「選んだセッションのリードをまとめて変更」の2つ**だけ**で、どちらもセッション関連だった。
// 両方とも「選択」ひとつの中へ入った(選ぶところまでは元々同じで、最後の一手が違うだけ)ので、
// **「…」は中身が空になり、ボタンごと出さなくなった**(F106-SPEC「空なら「…」自体を出さない」)。
// 【N-11 2026/08/17 本人指示・審査で訂正】その後、**一括リード変更は機能ごと削除**した
// (本人「なんの選択？という感じなので…選択を削除だけにして要素をシンプル化」)。
// よって「選択」の中身は削除だけ。上の「両方とも『選択』の中へ入った」は N-10 当時の記述で、
// 現在は当てはまらない(初版はここに『一括リード変更は一覧の直前の行』と現在形で書いていた)。
// (N-6 の DATA_MORE_ITEM_DEFS / dataMoreItems はここにあったが、読み手が無くなったので削除した。)

// 【N-10 / F-108】セッションの選択モードは**1つだけ**(値は "select")。
// 削除と一括リード変更で別々のモードを持っていた(N-6 の "delete" / "reed")のをやめる:
// 【N-11 2026/08/17・審査で訂正】この理由は N-10 当時のもの。一括リード変更を削除した今、
// モードは削除の1機能しか持たないので「行き止まり」の議論はもう成り立たない。
// 値を1つに保つ理由は**入口が1つだから**(選択＝削除)に変わった。
const SESSION_SELECT_MODE = "select";

function AnalysisLabView(props) {
  const {
    sessions, reeds, selectedIdeal, promoteSessionToIdeal,
    NUM_HARMONICS,
    updateSessions, deleteSessions, performers, setPerformers,
    saxType, tuningHz,
    // 【F-59】選択軸・集計条件は親が持つ(タブ移動・下部ナビの再マウントをまたいで保持する)。
    pivotRow, setPivotRow, pivotCol, setPivotCol, pivotMetric, setPivotMetric,
    pivotFilters: pivotFiltersRaw, setPivotFilters: setPivotFiltersRaw,
    // 【C-1/C-2 で移設】録音のアップロード。解析処理そのもの(handleUploadFile)は親のまま。
    handleUploadFile, isAnalyzingUpload, uploadProgress, lastUploadedSession, setLastUploadedSession,
    uploadNeedsTap, setUploadNeedsTap,
  } = props;

  // データタブ内の子タブ: My Data(推移・平均・セッション一覧) / 分析(クロス集計)
  // **これは持ち上げない**。下部ナビをタップしたら一覧のトップに戻る、という既存の挙動
  // (navNonce による再マウント)を保つため、再マウントで "mydata" に戻ってよい。
  const [dataSubTab, setDataSubTab] = useState("mydata");
  // 【N-11 2026/08/17 本人指示】My Data の集計範囲(楽器種別・期間)。
  // セレクタが**子タブ行の右端**へ移ったので、状態もこの行を描く側が持つ。
  // 既定値と永続化の規則は N7-SPEC 1 のまま(楽器=計測タブの選択・非永続 / 期間=永続)。
  const [dataSax, setDataSax] = useState(saxType);
  const [dataRange, setDataRange] = usePersistedState("myDataRange", "1m");
  // 集計対象抽出: [{dimKey, values: string[]}]。他機種のデータが混ざると平均が意味を失うため、
  // 初期状態で「サックス種別=今の楽器」を入れておく(不要なら×で消せる)。
  // 親が持つ値が null(まだ本人が触っていない)のときだけ、**このレンダー時点の** saxType から
  // 既定値を作る(親のuseState初期化子で作ると、IndexedDBからの復元前の値で固定されてしまう)。
  const pivotFilters = pivotFiltersRaw ?? defaultPivotFilters(saxType);
  const setPivotFilters = (next) => setPivotFiltersRaw((prev) => {
    const base = prev ?? defaultPivotFilters(saxType);
    return typeof next === "function" ? next(base) : next;
  });
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  // 削除はリードタブと同様、行ごとのボタンではなくチェックボックスによる複数選択にする。
  // 【F-108 2026/08/17 本人指示】モードは null / SESSION_SELECT_MODE の**2状態だけ**
  // (N-6 の "delete" / "reed" の2モードは統合した。理由は SESSION_SELECT_MODE の解説)。
  // (selectedSessionがある時の早期returnより前で呼ぶ必要があるため、ここでまとめて宣言する)
  // 【N-11 2026/08/17 本人指示】選択モードの一手は**削除だけ**になった
  // (一括リード変更を機能ごと削除したので bulkReedId も消えた)。
  const [listMode, setListMode] = useState(null);
  const [selectedForDelete, setSelectedForDelete] = useState(() => new Set());
  // 【D-1 2026/08/22 本人指示・凍結仕様 design/D1-SPEC.md】全件一覧(絞り込み・選択削除つき)は
  // 正典 #8a どおり**別画面**になった。入口は My Data のカレンダー最下行「すべてのセッション n 件 ›」
  // ただ1つ。セッション詳細と同じく早期 return で開くので、子タブ行も SwipePager も出ない。
  const [allSessionsOpen, setAllSessionsOpen] = useState(false);
  // 【D-2 2026/08/22 本人指示・凍結仕様 design/D2-SPEC.md】条件の編集(12次元・値チップ・
  // 音域帯まとめ選択・日付/日数範囲・条件の削除)は**畳んである**。正典 #13a が条件を
  // チップ1行に畳んでいるため。チップか「＋」を押すと開く。**機能は1つも落としていない。**
  const [filterEditorOpen, setFilterEditorOpen] = useState(false);

  // 全セッションのフレームを、セッション情報つきで平坦化(F-44/F-46ゲート込み)。
  // モジュールスコープの純関数buildFramesWithContextに切り出し済み(テストハーネスから
  // extractFunctionで直接検証できるようにするため。F-45の審査で指摘)。
  const framesWithContext = buildFramesWithContext(sessions, reeds);

  // --- ピボット集計 ---
  // tuningHz は音名次元が実音ラベルを運指から導くのに使う(F-54)。
  const pivotCtx = { reeds, tuningHz };
  const pivot = buildPivot(framesWithContext, pivotCtx, pivotRow, pivotCol, pivotMetric, pivotFilters);
  const metricDef = PIVOT_MEASURES.find((m) => m.key === pivotMetric);

  const selectedSession = selectedSessionId ? sessions.find((s) => s.id === selectedSessionId) : null;
  if (selectedSession) {
    return (
      <SwipeBackArea onBack={() => setSelectedSessionId(null)}>
        <SessionDetailView
          session={selectedSession} reeds={reeds} sessions={sessions} selectedIdeal={selectedIdeal}
          NUM_HARMONICS={NUM_HARMONICS} promoteSessionToIdeal={promoteSessionToIdeal}
          updateSessions={updateSessions} performers={performers} setPerformers={setPerformers}
          tuningHz={tuningHz}
          onBack={() => setSelectedSessionId(null)}
        />
      </SwipeBackArea>
    );
  }

  const toggleSessionSelected = (id) => {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setListMode(null);
    setSelectedForDelete(new Set());
  };
  // 【F-108】選択モードの**唯一の入口**(一覧の見出しの「選択」)。選択状態は必ず空から始める。
  const startListMode = () => {
    setSelectedForDelete(new Set());
    setListMode(SESSION_SELECT_MODE);
  };

  const confirmBatchDeleteSessions = () => {
    if (selectedForDelete.size === 0) return;
    if (!window.confirm(`選択した${selectedForDelete.size}件のセッションを削除しますか？(元に戻せません)`)) return;
    deleteSessions([...selectedForDelete]);
    exitSelectionMode();
  };

  // 【D-1 2026/08/22 本人指示・凍結仕様 design/D1-SPEC.md】全件一覧ページ。
  // **セッション詳細の判定より後**に置く: 一覧から1件開いたときは詳細が勝ち、
  // 詳細から戻ると allSessionsOpen が残っているのでこの一覧に戻る(2段の戻り先が正しく積まれる)。
  // 一覧を離れるときは必ず選択モードも畳む(モードだけが画面の外で生き残らない)。
  if (allSessionsOpen) {
    const closeAllSessions = () => { exitSelectionMode(); setAllSessionsOpen(false); };
    return (
      <SwipeBackArea onBack={closeAllSessions}>
        <AllSessionsPage
          sessions={sessions} reeds={reeds}
          onOpenSession={setSelectedSessionId}
          onBack={closeAllSessions}
          listMode={listMode}
          selectedForDelete={selectedForDelete}
          toggleSessionSelected={toggleSessionSelected}
          onStartSelect={startListMode}
          onCancelSelect={exitSelectionMode}
          onConfirmDelete={confirmBatchDeleteSessions}
        />
      </SwipeBackArea>
    );
  }

  // (【N-11 2026/08/17 本人指示】applyBulkReed = 選択したセッションのリードをまとめて変更する
  //  一手はここにあったが、**機能ごと削除した**。本人「「選択」が何の選択か分からない →
  //  リードをまとめて変更の機能を削除し、選択＝削除だけに」。
  //  N11-SPEC は「落としてよい唯一の機能」と明記している。)

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* 【C-2 で移設】アップロードの過渡的な告知(自動再生ブロック時の「解析を開始」/
          解析の進捗 / 完了通知 + 「★ 目安に設定」)。
          正典「アップロードの解析進捗と完了通知はデータタブ上端に浮く」。
          レイアウトの流れから外す(position:fixed)ので、出ても下の一覧は1pxも動かない
          (DESIGN-SYSTEM §6.1.5)。座標はルートの padding と同じ式。
          容器は pointerEvents:none、カードだけ auto(告知が無い領域の操作を殺さない)。 */}
      {(isAnalyzingUpload || lastUploadedSession) && (
        <div
          style={{
            position: "fixed", zIndex: 40,
            top: "calc(16px + env(safe-area-inset-top))",
            left: "calc(14px + env(safe-area-inset-left))",
            right: "calc(14px + env(safe-area-inset-right))",
            pointerEvents: "none",
          }}
        >
          <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {/* ブラウザの自動再生制限で動画の再生開始がブロックされた場合は、タップで再開してもらう
                (新しいタップイベントの中でplay()を呼び直せば許可される)。 */}
            {isAnalyzingUpload && uploadNeedsTap && (
              <div style={{ pointerEvents: "auto", display: "flex", gap: "var(--sp-3)", padding: "var(--sp-3) var(--sp-4)", background: "var(--c-accent-tint)", border: "1px solid var(--c-accent-line)", borderRadius: "var(--r-lg)", alignItems: "center", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
                <span className="sans" style={{ fontSize: "var(--fs-md)", color: "var(--c-accent)", fontWeight: 600, flex: 1 }}>タップして動画の解析を開始してください</span>
                <button
                  onClick={() => { const start = uploadNeedsTap; setUploadNeedsTap(null); start(); }}
                  className="sans"
                  style={{ minHeight: "var(--tap-min)", padding: "0 var(--sp-4)", borderRadius: "var(--r-pill)", border: "none", background: "var(--c-accent)", color: "var(--c-on-accent)", fontSize: "var(--fs-md)", fontWeight: 700, cursor: "pointer", flexShrink: 0 }}
                >
                  解析を開始
                </button>
              </div>
            )}
            {/* 解析の進捗(ライブ録音と同じ解析パイプラインを通すため、ファイルの長さと同じだけ時間がかかる) */}
            {isAnalyzingUpload && !uploadNeedsTap && (
              <div style={{ pointerEvents: "auto", padding: "var(--sp-3) var(--sp-4)", background: "var(--c-surface)", border: "1px solid var(--c-line)", borderRadius: "var(--r-lg)", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
                {/* 【N-6】正典 mini「読み込み中」: 11px --ink3 の見出し + **3px の細い横棒** + 右に %。
                    棒の地は正典どおりヘアラインのトークン(--c-line)。8px の太い棒より静か。 */}
                <div className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", marginBottom: 8 }}>読み込み中</div>
                <div style={{ background: "var(--c-line)", borderRadius: 2, height: 3, overflow: "hidden" }}>
                  <div style={{ width: `${Math.round(uploadProgress * 100)}%`, height: "100%", background: "var(--c-accent)", borderRadius: 2, transition: "width 0.2s linear" }} />
                </div>
                <div className="sans" style={{ fontFamily: "var(--font-num)", fontSize: 11, color: "var(--c-ink-3)", textAlign: "right", marginTop: 4 }}>{Math.round(uploadProgress * 100)}%</div>
              </div>
            )}
            {!isAnalyzingUpload && lastUploadedSession && (
              <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "var(--sp-1) var(--sp-1) var(--sp-1) var(--sp-4)", background: "var(--c-surface)", border: "1px solid var(--c-line)", borderRadius: "var(--r-lg)", boxShadow: "0 8px 24px rgba(15,23,42,0.18)" }}>
                {/* 【N-6】正典 mini の「解析が完了しました」(12.5px)。
                    色は素の --c-ink。--c-good は §1.5 の機能色(音程が合っている)なので、
                    解析の完了という別の意味に流用しない。 */}
                <span className="sans" style={{ fontSize: 12.5, color: "var(--c-ink)", flex: 1 }}>解析が完了しました</span>
                <SetAsIdealButton tapMin session={lastUploadedSession} sessions={sessions} selectedIdeal={selectedIdeal} onSave={promoteSessionToIdeal} />
                {/* タップで表示を閉じる(録音・再アップロード等の他アクションでも自動で消える)。
                    見た目の丸は22pxのまま、当たり判定だけ --tap-min に広げる(DESIGN-SYSTEM §5)。 */}
                <button
                  onClick={() => setLastUploadedSession(null)}
                  className="sans"
                  aria-label="閉じる"
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "var(--tap-min)", height: "var(--tap-min)", background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}
                >
                  {/* B型 = .ctl-plain + .ctl-pill。閉じるは状態を持たないので枠線を外し、
                      地(--c-sunken)だけにする。22×22 は明示 + border-box なので外形は動かない。 */}
                  <span className="ctl-plain ctl-pill" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, color: "var(--c-ink-3)", fontSize: "var(--fs-sm)", lineHeight: 1 }}>×</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* 【N-6】データタブ内の子タブ: My Data / 分析(クロス集計)。
          正典 .subtabs = 素のテキスト2つ(13px)を gap 18 で並べ、選択中だけ --c-ink の太字。
          溝(地 --c-sunken の segmented control)は正典に無いので撤去した(リードタブの N-5 と同じ)。
          【タップ領域(§5)の作り方】文字の実高は 26px しかないので、**見た目の間隔を変えずに**
          当たり判定だけ広げる: 行の gap を 0 にして左右に 18/2 = 9px の padding を入れる
          (隣り合う文字の間は 9+9 = 18 のまま)。先頭が 9px 右へずれるぶんは行の marginLeft で戻す。
          右端(正典の margin-left:auto)が「…」。 */}
      <div className="sans" style={{ display: "flex", alignItems: "center", gap: 0, marginLeft: -DATA_SUBTAB_HALF_GAP_PX, fontSize: 13, marginBottom: 4 }}>
        {[
          { key: "mydata", label: "My Data" },
          { key: "analysis", label: "分析" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => { if (listMode) exitSelectionMode(); setDataSubTab(t.key); }}
            className="sans"
            aria-pressed={dataSubTab === t.key}
            style={{
              minHeight: "var(--tap-min)", minWidth: "var(--tap-min)",
              padding: `0 ${DATA_SUBTAB_HALF_GAP_PX}px`,
              background: "none", border: "none", cursor: "pointer",
              fontSize: 13,
              color: dataSubTab === t.key ? "var(--c-ink)" : "var(--c-ink-3)",
              fontWeight: dataSubTab === t.key ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
        {/* 【N-11 2026/08/17 本人指示】子タブ行の右端(正典 案P の .top .sel)に
            **楽器種別 ▾ · 期間 ▾** を置く。以前は子タブ行の下に専用の1行を敷いていて、
            そこが「不自然に空いた帯」に見えていた(本人指示の1項目め)。
            選択モード中は同じ場所を出口(キャンセル)と一手(削除)が使うので出さない
            — モード中に集計範囲を変える操作は要らないため、場所を奪い合わない。 */}
        {/* 【D-1 2026/08/22】選択モードは**別画面(AllSessionsPage)でしか始まらない**ので、
            この行が描かれている間 listMode は必ず null。ガードは到達しないので外した
            (残すと「モード中に何かが起きる場所」に見えるが、実際には何も起きない)。 */}
        {dataSubTab === "mydata" && (
          <MyDataScopePicker
            dataSax={dataSax} setDataSax={setDataSax}
            range={dataRange} setRange={setDataRange}
          />
        )}
        {/* 【F-108 2026/08/17 本人指示】子タブ行の右端から「…」を**外した**。
            中身(セッションを選んで削除)は一覧の見出しの「選択」ひとつに入った。
            【D-1 2026/08/22】その一覧が別画面(AllSessionsPage)へ移ったので、
            選択モードの出口(キャンセル)と一手(削除)も**一覧と一緒にそちらへ移した**。
            この行には子タブ2つと集計範囲セレクタだけが残る
            (モードは一覧の画面でしか始まらないので、ここに出口を置く必要が無くなった)。 */}
      </div>

      {/* 【N-11】bleed: グラフカードが左右の余白を食い破れるよう、viewport の切り取り線だけを
          本文の左右余白ぶん外へ出す(ページの幅と溝は 1px も変えない。SwipePager の解説を見ること)。 */}
      <SwipePager bleed index={dataSubTab === "analysis" ? 1 : 0} onIndexChange={(i) => setDataSubTab(i === 1 ? "analysis" : "mydata")}>
      {/* --- My Data 子タブ(正典 = design/dc-mydata-redesign.html の **#9b**):
              指標タブ + 比較対象チップ + マトリクス2枚 + カラースケールの凡例 + 5週の練習カレンダー。
              セッション一覧・絞り込み・選択削除は別画面(AllSessionsPage)へ移った。 --- */}
      <MyDataPage
        sessions={sessions} reeds={reeds} selectedIdeal={selectedIdeal}
        saxType={saxType} tuningHz={tuningHz}
        dataSax={dataSax} dataRange={dataRange}
        onOpenSession={setSelectedSessionId}
        onOpenAllSessions={() => setAllSessionsOpen(true)}
        pageActive={dataSubTab === "mydata"}
        handleUploadFile={handleUploadFile} isAnalyzingUpload={isAnalyzingUpload}
      />
      {/* --- 分析(11.6節): クロス集計(ピボット型マトリクス) ---
          【N-9 2026/08/16 本人指示】「いい感じにほかのページと統一して」「なるべく要素を減らす」:
          ・カード(.card)・枠つきの箱・地色の箱を廃止し、白地+罫(--c-rule)で群を分ける
            (計測/リード/My Data と同じ文法)
          ・表題「PIVOT」(子タブ「分析」と同じことの二度言い)・冒頭の説明段落
            (「集計対象抽出(フィルター)・縦軸・横軸・指標を組み合わせて…」)・
            グラフ下の軸の説明文は**削除**(本人: 「長いテキストは趣旨がずれてる」)
          ・機能は1つも落とさない: 条件追加/削除・12次元・値チップ・音域帯まとめ選択・
            日付/日数範囲・既定フィルタ・軸セレクタ3枚・測度7種・折れ線・設定のタブまたぎ保持 */}
      <div>
        {/* 【F-99 2026/08/17 本人指示】N-9 で消した表題と説明を**書き直して**復活。
            本人の意図: 「分析は自分で集計軸を選んで初めて機能するページ。最初にユーザーに
            アクションしてもらう必要があるので一定の説明が必要。PIVOT の文字があれば Excel も
            想起できる」。説明は N-9 で消した長文を戻すのではなく、1行の簡潔な文に書き直した。
            表題の文字組み(15px / --c-accent / 700)と説明(12px / --c-ink-3)は旧実装と同じ値
            (箱 .card は N-9 どおり復活させない。白地に直接置く)。 */}
        <div className="sans" style={{ fontSize: 15, color: "var(--c-accent)", fontWeight: 700, marginBottom: 4 }}>
          PIVOT
        </div>
        <div className="sans" style={{ fontSize: 12, color: "var(--c-ink-3)", lineHeight: 1.6, marginBottom: 12 }}>
          条件・並べる軸・数値・分け方を選ぶと、蓄積データをマトリクスで集計します
        </div>
        {/* 【D-2 2026/08/22 本人指示・凍結仕様 design/D2-SPEC.md】条件のチップ行(正典 #13a)。
            ラベル「条件」＋ 適用中のフィルタのチップ ＋ 追加用の「＋」(破線)。
            **正典は条件を1行に畳んでいる**が、現行の編集UI(12次元・値チップ・音域帯まとめ選択・
            日付/日数範囲・条件の削除)は**1つも落とさない**(本人の決定「モックと現行が
            ぶつかったら機能を残す」)。畳んだぶんは**チップか「＋」を押すと下に開く**。
            チップの文字は pivotFilterChipText の1箇所(値の畳み方を2箇所に書かない)。
            【型】チップは地だけ / 「＋」は破線の枠だけ。**同じ物に枠と違う地を両方与えない**(芯1)。 */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "0 0 4px" }}>
          <span className="sans" style={{ fontSize: 10, color: "var(--c-ink-3)", flexShrink: 0 }}>条件</span>
          {pivotFilters.map((flt, i) => (
            <button
              key={i} type="button" onClick={() => setFilterEditorOpen(true)}
              aria-expanded={filterEditorOpen}
              className="sans" style={{ ...TAP_BUTTON_RESET, minWidth: 0 }}
            >
              <span style={{
                display: "inline-flex", alignItems: "center", maxWidth: 160,
                background: "var(--c-accent-tint)", border: "1px solid transparent",
                borderRadius: "var(--r-sm)", padding: "4px 9px",
                fontSize: 11, fontWeight: 600, color: "var(--c-accent)", lineHeight: 1.4,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {pivotFilterChipText(flt, PIVOT_DIMENSIONS.find((d) => d.key === flt.dimKey))}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setPivotFilters((prev) => [...prev, { dimKey: PIVOT_DIMENSIONS[0].key, values: [], rangeMin: null, rangeMax: null }]);
              setFilterEditorOpen(true);
            }}
            aria-label="集計の条件を追加"
            /* 【芯2】枠(破線)を持つ操作は**状態を持つ**。この「＋」は条件を1つ足して
               編集を開くので、開いているかどうかが状態そのもの。 */
            aria-expanded={filterEditorOpen}
            className="sans" style={{ ...TAP_BUTTON_RESET, minWidth: "var(--tap-min)", justifyContent: "center" }}
          >
            <span style={{
              display: "inline-flex", alignItems: "center",
              background: "transparent", border: "1px dashed var(--c-line-strong)",
              borderRadius: "var(--r-sm)", padding: "4px 9px",
              fontSize: 11, color: "var(--c-ink-2)", lineHeight: 1.4,
            }}>＋</span>
          </button>
          {pivotFilters.length > 0 && (
            <button
              type="button" onClick={() => setFilterEditorOpen((v) => !v)}
              aria-expanded={filterEditorOpen}
              className="sans" style={{ ...TAP_BUTTON_RESET, minWidth: "var(--tap-min)", justifyContent: "center", marginLeft: "auto", color: "var(--c-ink-2)" }}
            >
              {filterEditorOpen ? "閉じる" : "編集"}
            </button>
          )}
        </div>
        {pivotFilters.length === 0 && (
          <div className="sans" style={{ fontSize: 12, color: "var(--c-ink-3)", padding: "0 0 8px" }}>条件なし（全データを集計）</div>
        )}

        {/* 集計対象抽出(フィルター)の編集。**中身は N-9 から 1つも変えていない**(置き場所と
            開閉だけが変わった)。任意の次元の値で絞り込み。値を1つも選んでいないフィルターは
            全選択と同じ扱い。 */}
        {filterEditorOpen && (
        <div style={{ padding: "6px 0 12px" }}>
          {pivotFilters.length === 0 ? (
            <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>フィルターなし（全データを集計）</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pivotFilters.map((flt, i) => {
                const dim = PIVOT_DIMENSIONS.find((d) => d.key === flt.dimKey);
                const updateFilter = (patch) => setPivotFilters((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
                return (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                    {/* 【F-57 本人指示】条件削除の × は「そのカテゴリ名の先頭」に置く。
                        当たり判定は §5 の 44×44pt を満たす。**見た目の × の大きさは変えない**。 */}
                    <button
                      onClick={() => setPivotFilters((prev) => prev.filter((_, j) => j !== i))}
                      aria-label="このフィルターを削除"
                      style={{
                        background: "none", border: "none", color: "#8D95A1", cursor: "pointer",
                        fontSize: 13, flexShrink: 0, padding: 0,
                        minWidth: "var(--tap-min)", minHeight: "var(--tap-min)",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}
                      title="このフィルターを削除"
                    >
                      ×
                    </button>
                    {/* 【N-9】カテゴリ名の select も「素のテキスト + ▾」(PlainSelect)。中身はそのまま */}
                    <PlainSelect
                      ariaLabel="絞り込む次元"
                      text={dim?.label ?? flt.dimKey}
                      value={flt.dimKey}
                      onChange={(e) => setPivotFilters((prev) => prev.map((p, j) => (j === i ? { dimKey: e.target.value, values: [], rangeMin: null, rangeMax: null } : p)))}
                    >
                      {PIVOT_DIMENSIONS.map((d) => (<option key={d.key} value={d.key}>{d.label}</option>))}
                    </PlainSelect>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 180 }}>
                      {dim?.filterKind === "dateRange" ? (
                        <div className="sans" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#435266" }}>
                          {/* 【N-5b / 罠14】表示は localDayKey(ローカル暦日)。toISOString の UTC 暦日を
                              使うと JST では常に1日前が出る(保存値は正しいのに入力欄だけずれる)。 */}
                          <input
                            type="date"
                            value={flt.rangeMin ? localDayKey(new Date(flt.rangeMin)) : ""}
                            onChange={(e) => updateFilter({ rangeMin: e.target.value ? new Date(e.target.value).setHours(0, 0, 0, 0) : null })}
                          />
                          <span>〜</span>
                          <input
                            type="date"
                            value={flt.rangeMax ? localDayKey(new Date(flt.rangeMax)) : ""}
                            onChange={(e) => updateFilter({ rangeMax: e.target.value ? new Date(e.target.value).setHours(0, 0, 0, 0) : null })}
                          />
                        </div>
                      ) : dim?.filterKind === "numberRange" ? (
                        <div className="sans" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#435266" }}>
                          <input
                            type="number" min={1} placeholder="最小" value={flt.rangeMin ?? ""}
                            onChange={(e) => updateFilter({ rangeMin: e.target.value === "" ? null : Number(e.target.value) })}
                            style={{ width: 64 }}
                          />
                          <span>日目 〜</span>
                          <input
                            type="number" min={1} placeholder="最大" value={flt.rangeMax ?? ""}
                            onChange={(e) => updateFilter({ rangeMax: e.target.value === "" ? null : Number(e.target.value) })}
                            style={{ width: 64 }}
                          />
                          <span>日目</span>
                        </div>
                      ) : (
                        <>
                          {flt.dimKey === "note" && (() => {
                            const entries = pivotDimensionValueEntries(framesWithContext, pivotCtx, "note");
                            return (
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {["high", "mid", "low"].map((band) => {
                                  const bandValues = entries.filter((e) => registerBand(e.sortKey) === band).map((e) => e.value);
                                  if (bandValues.length === 0) return null;
                                  const allSelected = bandValues.every((v) => flt.values.includes(v));
                                  return (
                                    <button
                                      key={band}
                                      onClick={() => updateFilter({
                                        values: allSelected
                                          ? flt.values.filter((v) => !bandValues.includes(v))
                                          : [...new Set([...flt.values, ...bandValues])],
                                      })}
                                      aria-pressed={allSelected}
                                      className="sans ctl-state"
                                      style={{
                                        fontSize: 12, padding: "3px 10px", cursor: "pointer",
                                        color: allSelected ? "var(--c-accent)" : "var(--c-ink-2)", fontWeight: 600,
                                      }}
                                    >
                                      {REGISTER_BAND_LABELS[band]}
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })()}
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {(() => {
                              const options = pivotDimensionValues(framesWithContext, pivotCtx, flt.dimKey);
                              return options.length === 0 ? (
                                <span className="sans" style={{ fontSize: 12, color: "#8D95A1", padding: "4px 0" }}>該当する値がありません</span>
                              ) : options.map((v) => {
                                const selected = flt.values.includes(v);
                                return (
                                  <button
                                    key={v}
                                    onClick={() => updateFilter({ values: selected ? flt.values.filter((x) => x !== v) : [...flt.values, v] })}
                                    aria-pressed={selected}
                                    className="sans ctl-state"
                                    style={{
                                      fontSize: 12, padding: "3px 8px", cursor: "pointer",
                                      color: selected ? "var(--c-accent)" : "var(--c-ink-2)",
                                      fontWeight: selected ? 600 : 400,
                                    }}
                                  >
                                    {v}
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* 【D-2】3カラムのセレクタカード(正典 #13a)。「並べる軸 / 数値 / 分け方」を横1列に並べ、
            3つの関係が一目で分かるようにする。**中の3つは N-9 の縦軸 / 横軸 / 指標と同じ状態**で、
            正典に合わせて**名前だけ**を変えた(親が持つ pivotRow / pivotMetric / pivotCol は不変)。
            器は .surf-sunk の中の .card(地・角丸・padding は作法が持つ。インラインで書かない)。
            中央の列だけ左右に罫を持つのは正典どおり(列の境界を余白ではなく線で示す)。 */}
        <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
          {[
            { key: "row", label: "並べる軸", aria: "並べる軸を選ぶ",
              text: PIVOT_DIMENSIONS.find((d) => d.key === pivotRow)?.label ?? pivotRow,
              value: pivotRow, onChange: (e) => setPivotRow(e.target.value),
              options: PIVOT_DIMENSIONS.map((d) => ({ v: d.key, l: d.label })) },
            { key: "metric", label: "数値", aria: "集計する数値を選ぶ",
              text: PIVOT_MEASURES.find((m) => m.key === pivotMetric)?.label ?? pivotMetric,
              value: pivotMetric, onChange: (e) => setPivotMetric(e.target.value),
              options: PIVOT_MEASURES.map((m) => ({ v: m.key, l: m.label })) },
            { key: "col", label: "分け方", aria: "分け方を選ぶ",
              text: pivotCol === "none" ? "なし（全体）" : (PIVOT_DIMENSIONS.find((d) => d.key === pivotCol)?.label ?? pivotCol),
              value: pivotCol, onChange: (e) => setPivotCol(e.target.value),
              options: [{ v: "none", l: "なし（全体）" }, ...PIVOT_DIMENSIONS.map((d) => ({ v: d.key, l: d.label }))] },
          ].map((z, zi) => (
            <div
              key={z.key}
              style={zi === 1
                ? { minWidth: 0, borderLeft: "1px solid var(--c-line)", borderRight: "1px solid var(--c-line)", padding: "0 var(--sp-2)" }
                : { minWidth: 0 }}
            >
              <div className="sans" style={{ fontSize: 10, color: "var(--c-ink-3)", letterSpacing: ".02em" }}>{z.label}</div>
              <PlainSelect strong ariaLabel={z.aria} text={z.text} value={z.value} onChange={z.onChange}>
                {z.options.map((o) => (<option key={o.v} value={o.v}>{o.l}</option>))}
              </PlainSelect>
            </div>
          ))}
        </div>

        {/* 折れ線グラフ: 縦=縦軸の項目、横=指標値、指標で選んだ次元の値ごとに色分けした線を重ねる。
            【N-9】グラフ下の軸の説明文(「縦に「…」、横に「…」。…」)は削除した(本人指示)。 */}
        <div style={{ borderTop: "1px solid var(--c-rule)", padding: "12px 0" }}>
          {pivot.rowKeys.length === 0 ? (
            <div className="sans" style={{ fontSize: 12, color: "#8D95A1" }}>
              この軸の組み合わせに該当するデータがまだありません。運指判定・リード紐付けつきで録音するとここに折れ線が育ちます
            </div>
          ) : (
            <PivotLineChart
              rowKeys={pivot.rowKeys} colKeys={pivot.colKeys} cells={pivot.cells}
              metricDef={metricDef}
              /* 行の縞(オクターブ単位)は**行が音名のときだけ**。正典に無い規則を発明しない。 */
              rowIsNote={pivotRow === "note"}
            />
          )}
        </div>
        {/* 【D-1 2026/08/22 本人指示・凍結仕様 design/D1-SPEC.md】脚注の蓄積量。
            正典 #13a の右寄せ1行「4,938 音 · 49 セッション」。
            **My Data の上部にあった蓄積量3数字がここへ移った**(正典 #9b が
            「上部の実績3数字の主役扱い」を却下側に置いたため。画面から消しはしない)。
            表示文字列は myDataStockTexts の1箇所から引く(規則を2箇所に写さない)。
            母集団は分析タブの見ている全セッション(奏者・楽器で絞らない = PIVOT の入力と同じ)。 */}
        <div className="sans" style={{ fontSize: 11, color: "var(--c-ink-3)", textAlign: "right", padding: "11px 2px 0" }}>
          {(() => {
            const st = myDataStockTexts(myDataStock(sessions));
            return `${st.notes} 音 · ${st.sessions} セッション · ${st.hours} 時間`;
          })()}
        </div>
      </div>
      </SwipePager>
      {/* (【F-108】「…」のシートはここにあったが、入口ごと一覧の見出しの「選択」へ移したので削除。
           DataOptionSheet 自体は絞り込みピル・期間・楽器種別が引き続き使う。) */}
    </div>
  );
}

// 【N-11 2026/08/17 本人指示】データタブの My Data 子タブ1枚ぶん。
// **正典は design/mydata-v2-proposals.html の案P**へ移った(N-10 までの正典
// mydata-zero-proposals-2.html の案K は役目を終えた。移行の理由は両ファイルの冒頭コメント)。
// ただし**グラフカードの地だけ案R の灰**(本人「P案。ただしカードの色だけR案の灰」)。
// **この画面に .card は1枚も無い。** §6.0 の囲いの序列は「余白 → 揃え → 罫1本 → 面」。
// 【N-11】面は**グラフカード1枚だけ**(案P の .gcard。地 --c-sunken・角丸なし・画面いっぱい)。
// 一覧の群の境界は正典どおり**罫1本(.srow の下辺)と余白**が作る。
// 【D-1 2026/08/22 本人指示・凍結仕様 design/D1-SPEC.md】全件一覧ページ。
// 正典 #8a「一覧はカレンダー下の1行『すべてのセッション 49件 ›』から別画面へ」。
// **現行 My Data が持っていた一覧まわりを丸ごとここへ移した**(落とした機能は無い):
//   ・絞り込みピル(期間の自由範囲 / リード / 奏者)とクリア
//   ・「選択」= 削除モードの唯一の入口、チェックボックス、削除の一手 / キャンセル
//   ・一覧そのもの(.slist / .slist-row / .slist-check の構造と CSS は**1文字も変えない**。
//     F-97 / F-106 で3周かけた箇所なので、置き場所だけ移して中身は触らない)
// 唯一の差は `.slist` に静的な `is-full` を足したこと(高さ制限 190px を外す)。
// **モードで切り替わるクラスは今も `.is-select` ただ1つ**(F-106 の不変条件は崩れていない)。
function AllSessionsPage({
  sessions, reeds, onOpenSession, onBack,
  listMode, selectedForDelete, toggleSessionSelected, onStartSelect,
  onCancelSelect, onConfirmDelete,
}) {
  // セッション一覧の絞り込み(並び替えではなく絞り込み)。期間・奏者・リードで絞る。
  const [sessionFilterPerformer, setSessionFilterPerformer] = useState(""); // "" = すべて
  const [sessionFilterReed, setSessionFilterReed] = useState(""); // "" = すべて / "__none__" = 未紐付け
  const [sessionFilterDateFrom, setSessionFilterDateFrom] = useState(""); // "YYYY-MM-DD" or ""
  const [sessionFilterDateTo, setSessionFilterDateTo] = useState("");
  // 期間だけは「いつからいつまで」の自由な範囲。ピルをタップすると date 入力2つが開く。
  // **正典のピルは固定候補だが、置き換えると自由な範囲の絞り込みが消える。**
  // 本人の決定「モックと現行がぶつかったら機能を残す」に従い、形だけピルに揃えて中身は残す。
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  // 奏者・リードの候補はシートで選ぶ。null = 開いていない / "performer" / "reed"。
  const [pillSheet, setPillSheet] = useState(null);

  const sessionPerformerOptions = [...new Set(sessions.map((s) => s.performer).filter(Boolean))];
  const fromMs = sessionFilterDateFrom ? new Date(sessionFilterDateFrom).setHours(0, 0, 0, 0) : null;
  const toMs = sessionFilterDateTo ? new Date(sessionFilterDateTo).setHours(23, 59, 59, 999) : null;
  const sessionFilterActive = !!(sessionFilterPerformer || sessionFilterReed || sessionFilterDateFrom || sessionFilterDateTo);
  const dateFilterText = () => {
    if (!sessionFilterDateFrom && !sessionFilterDateTo) return "期間";
    const f = sessionFilterDateFrom ? formatYmd(sessionFilterDateFrom) : "";
    const t = sessionFilterDateTo ? formatYmd(sessionFilterDateTo) : "";
    return `${f}〜${t}`;
  };
  const filteredSessions = [...sessions]
    .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
    .filter((s) => {
      if (sessionFilterPerformer && (s.performer || "") !== sessionFilterPerformer) return false;
      if (sessionFilterReed === "__none__" && s.reedId) return false;      // 未紐付けのみ
      if (sessionFilterReed && sessionFilterReed !== "__none__" && s.reedId !== sessionFilterReed) return false; // 特定リードのみ
      const t = new Date(s.recordedAt).getTime();
      if (fromMs !== null && t < fromMs) return false;
      if (toMs !== null && t > toMs) return false;
      return true;
    });
  const clearSessionFilters = () => {
    setSessionFilterPerformer(""); setSessionFilterReed(""); setSessionFilterDateFrom(""); setSessionFilterDateTo("");
    setDateFilterOpen(false);
  };

  // ピルの中身。見た目のピルは内側の <span> が持ち、<button> 自身は
  // 高さ 44pt の透明な当たり判定にする(§5「見た目の大きさは変えない。当たり判定だけ広げる」)。
  // 【F-86】本人指示「セッションの絞り込みにも枠線は不要」。**寸法は動かさない**ので
  // 枠は `1px solid transparent` で場所だけ残す(F-75 の作法)。
  const filterPill = (label, onClick, expanded) => (
    <button
      type="button" onClick={onClick} aria-expanded={expanded}
      className="sans" style={{ ...TAP_BUTTON_RESET, minWidth: 0 }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", border: "1px solid transparent", borderRadius: "var(--r-pill)", padding: "3px 11px", fontSize: 12, color: "var(--c-ink-2)", lineHeight: 1.4, maxWidth: "100%" }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <PickChevron />
      </span>
    </button>
  );

  const reedFilterLabel = (() => {
    if (!sessionFilterReed) return "リード";
    if (sessionFilterReed === "__none__") return "未紐付け";
    const r = reeds.find((x) => x.id === sessionFilterReed);
    return reedShortLabel(r, reeds) ?? "リード";
  })();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* 戻る導線 + モードの出口/一手。正典 #14b の「‹ 一覧」と同じ作法(左に戻る、右に一手)。
          選択モード中は「選択」を出さない(入口と出口が同時に並ばない)。 */}
      <div className="sans" style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: -DATA_SUBTAB_HALF_GAP_PX }}>
        <button
          type="button" onClick={onBack} className="sans"
          style={{
            minHeight: "var(--tap-min)", minWidth: "var(--tap-min)",
            padding: `0 ${DATA_SUBTAB_HALF_GAP_PX}px`,
            background: "none", border: "none", cursor: "pointer",
            fontSize: 13, color: "var(--c-accent)",
          }}
        >
          ‹ My Data
        </button>
        {/* 【F-108 の芯】「選択」は**一覧の見出しと同じ行**に置く(下の .shead の行)。
            この行に残すのは戻る導線と、モード中の出口(キャンセル)・一手(削除)だけ。 */}
        {listMode !== null && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={onCancelSelect} className="sans" style={{ ...TAP_BUTTON_RESET }}>
              <span className="ctl-plain ctl-pill" style={{ padding: "7px 14px", color: "var(--c-ink-2)", fontSize: 12, lineHeight: 1.2 }}>キャンセル</span>
            </button>
            <button
              onClick={onConfirmDelete}
              disabled={selectedForDelete.size === 0}
              className="sans"
              style={{ ...TAP_BUTTON_RESET, cursor: selectedForDelete.size > 0 ? "pointer" : "default" }}
            >
              <span className="ctl-plain ctl-pill ctl-danger"
                data-armed={selectedForDelete.size > 0}
                style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>
                {selectedForDelete.size > 0 ? `${selectedForDelete.size}件を削除` : "削除"}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* 見出しの行の余白・文字は正典 north-star-measure.html の .shead / .shead .t のまま
          (N-6 から 1px も動かしていない。置き場所が別画面へ移っただけ)。 */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "16px 2px 10px" }}>
        <div className="sans" style={{ fontSize: 13, fontWeight: 600, color: "var(--c-ink)" }}>
          すべてのセッション <span style={{ color: "var(--c-ink-3)", fontWeight: 400 }}>{sessionFilterActive ? `${filteredSessions.length}/${sessions.length}` : sessions.length}</span>
        </div>
        {/* 選ぶ対象が無い(0件)ときとモード中は入口を出さない(押せない入口を作らない。F-77)。
            TAP_BUTTON_RESET は minHeight しか持たないので、「選択」の2文字だと横が 24px まで
            痩せて §5(44×44・例外なし)を割る(N-11 の実測)。横も明示して確保する。 */}
        {sessions.length > 0 && !listMode && (
          <button onClick={onStartSelect} className="sans" style={{ ...TAP_BUTTON_RESET, minWidth: "var(--tap-min)", justifyContent: "center", flexShrink: 0, color: "var(--c-ink-2)" }}>
            選択
          </button>
        )}
      </div>

      {sessions.length > 0 && !listMode && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "0 2px 12px", alignItems: "center" }}>
          {filterPill(dateFilterText(), () => setDateFilterOpen((v) => !v), dateFilterOpen)}
          {filterPill(reedFilterLabel, () => setPillSheet("reed"), pillSheet === "reed")}
          {/* 奏者ピルは奏者が2人以上いるときだけ出す(1人しかいない画面で絞る意味が無い) */}
          {sessionPerformerOptions.length > 1 && filterPill(sessionFilterPerformer || "奏者", () => setPillSheet("performer"), pillSheet === "performer")}
          {sessionFilterActive && (
            <button type="button" onClick={clearSessionFilters} className="sans" style={{ ...TAP_BUTTON_RESET }}>
              {/* クリアは状態を持たない**一手**なので B型(枠なし・地だけ)。文字だけアクセント色。 */}
              <span className="ctl-plain ctl-pill" style={{ display: "inline-flex", alignItems: "center", padding: "3px 11px", fontSize: 12, color: "var(--c-accent)", fontWeight: 600, lineHeight: 1.4 }}>クリア</span>
            </button>
          )}
        </div>
      )}

      {sessions.length > 0 && !listMode && dateFilterOpen && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "0 2px 12px" }}>
          <input type="date" value={sessionFilterDateFrom} onChange={(e) => setSessionFilterDateFrom(e.target.value)} style={{ fontSize: 12 }} />
          <span className="sans" style={{ fontSize: 12, color: "var(--c-ink-3)" }}>〜</span>
          <input type="date" value={sessionFilterDateTo} onChange={(e) => setSessionFilterDateTo(e.target.value)} style={{ fontSize: 12 }} />
          <button type="button" onClick={() => setDateFilterOpen(false)} className="sans" style={{ ...TAP_BUTTON_RESET }}>
            <span className="ctl-plain ctl-pill" style={{ display: "inline-flex", alignItems: "center", padding: "3px 11px", fontSize: 12, color: "var(--c-ink-2)", lineHeight: 1.4 }}>閉じる</span>
          </button>
        </div>
      )}

      {filteredSessions.length === 0 ? (
        <div className="sans" style={{ fontSize: 12, color: "var(--c-ink-3)", padding: "0 2px" }}>{sessions.length === 0 ? "まだ記録がありません" : "条件に合うセッションがありません"}</div>
      ) : (
        /* 【F-106 2026/08/17 本人指示・凍結仕様 design/F106-SPEC.md】
           削除(選択)モードは **この祖先の className ただ1つ**で表現する。
           行の側は listMode を一切見ない: 構造も style も属性もモードで変わらない
           (変わるのは checked と、行タップの行き先だけ)。
           **一覧の行にもこのスクロールコンテナにも `contain` /
           `content-visibility` / `will-change` / `transform` は置かない。**
           【D-1】`is-full` は**静的なクラス**(専用ページなので高さ制限 190px を外す)。
           モードで切り替わるクラスは今も `.is-select` ただ1つ。 */
        <div className={listMode ? "slist is-full is-select" : "slist is-full"}>
          {filteredSessions.map((s) => {
            const reed = reeds.find((r) => r.id === s.reedId) || null;
            const dur = sessionDurationLabel(s);
            // 副次行「V16-3 #4 · 自分 · 12:24」。読めない区画は**丸ごと省く**。
            const subParts = [reedShortLabel(reed, reeds) ?? "未紐付け", s.performer || null, dur].filter(Boolean);
            return (
              <div
                key={s.id}
                onClick={() => (listMode ? toggleSessionSelected(s.id) : onOpenSession(s.id))}
                className="sans slist-row"
              >
                <input
                  type="checkbox" checked={selectedForDelete.has(s.id)}
                  onChange={() => toggleSessionSelected(s.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="このセッションを選ぶ"
                  className="slist-check"
                />
                <span className="slist-main">
                  <span className="slist-date">{formatYmd(s.recordedAt, { time: true })}</span>
                  <span className="slist-sub">{subParts.join(" · ")}</span>
                </span>
                {s.source === "upload" && <FileAudio size={12} strokeWidth={1.8} style={{ color: "var(--c-ink-3)", flexShrink: 0 }} />}
              </div>
            );
          })}
        </div>
      )}

      {pillSheet === "reed" && (
        <DataOptionSheet
          ariaLabel="リードで絞り込む"
          items={[
            { key: "", label: "すべて" },
            { key: "__none__", label: "未紐付け" },
            ...reeds.map((r) => ({ key: r.id, label: reedLabel(r, reeds) })),
          ]}
          value={sessionFilterReed}
          onPick={(k) => { setSessionFilterReed(k); setPillSheet(null); }}
          onClose={() => setPillSheet(null)}
        />
      )}
      {pillSheet === "performer" && (
        <DataOptionSheet
          ariaLabel="奏者で絞り込む"
          items={[{ key: "", label: "すべて" }, ...sessionPerformerOptions.map((p) => ({ key: p, label: p }))]}
          value={sessionFilterPerformer}
          onPick={(k) => { setSessionFilterPerformer(k); setPillSheet(null); }}
          onClose={() => setPillSheet(null)}
        />
      )}
    </div>
  );
}

// 【D-1 2026/08/22】My Data 子タブ。正典 #9b の中身は MyDataSection が全部持つので、
// このページに残るのは**隠しファイル入力と右下に浮かせるボタン**だけになった
// (セッション一覧・絞り込み・選択削除は AllSessionsPage へ移した)。
function MyDataPage({
  sessions, reeds, selectedIdeal, saxType, tuningHz,
  dataSax, dataRange,
  onOpenSession, onOpenAllSessions,
  // 【N-11】浮かせるボタン(取り込み)は body へ portal で出るので、
  // 「今どのページか」を知らないと隣のページ(分析)でも出たままになる。
  pageActive,
  handleUploadFile, isAnalyzingUpload,
}) {
  // 隠しファイル入力。計測タブから移した(配線はそのまま流用。C-1/C-2)。
  const uploadInputRef = useRef(null);

  return (
    <div>
      <input
        ref={uploadInputRef} type="file" accept="audio/*,video/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); e.target.value = ""; }}
      />

      <MyDataSection
        sessions={sessions} reeds={reeds} selectedIdeal={selectedIdeal}
        saxType={saxType} tuningHz={tuningHz}
        dataSax={dataSax} range={dataRange}
        totalSessionCount={sessions.length}
        onOpenSession={onOpenSession}
        onOpenAllSessions={onOpenAllSessions}
      />

      {/* 【N-11】最下端に、浮かせるボタンの高さぶんの余白。最後の行がボタンの下に潜らない。 */}
      <FloatingActionSpacer />
      {/* 【N-11 2026/08/17 本人指示】「↥ 録音を取り込む」を右下に浮かせる。
          押すと同じ uploadInputRef の隠しファイル入力を開く(機能は 1つも変わっていない)。
          解析中は押せない(disabled)。進捗・完了通知は従来どおり画面上端に浮く。 */}
      {pageActive && (
        <FloatingAction
          label={isAnalyzingUpload ? "解析中…" : "録音を取り込む"}
          ariaLabel="録音ファイルを取り込む"
          icon={<Upload size={14} />}
          disabled={isAnalyzingUpload}
          onClick={() => uploadInputRef.current?.click()}
        />
      )}
    </div>
  );
}

// セッション詳細ビュー。録音/アップロードいずれかのセッションを、計測タブに近いレイアウトで振り返る。
function SessionDetailView({ session, reeds, sessions, selectedIdeal, NUM_HARMONICS, promoteSessionToIdeal, updateSessions, performers, setPerformers, tuningHz, onBack }) {
  const frames = session.frames || [];
  // 1回のデータには複数の音(スケール等)が含まれることがあるため、音階(運指)ごとにも分解して平均を出す
  const noteGroups = groupFramesByNote(frames, NUM_HARMONICS, session.saxType, tuningHz);
  const reed = reeds.find((r) => r.id === session.reedId) || null;
  const sessionMetrics = computeFrameMetrics(frames);

  // 記録後に気づいた誤り(奏者・リードの紐付け間違い等)をその場で修正できるようにする
  const setSessionPerformer = (name) => {
    updateSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, performer: name } : s)));
  };
  const setSessionReedId = (reedId) => {
    updateSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, reedId: reedId || null, linkedAt: reedId ? "retroactive" : null } : s)));
  };
  // 日付も後から修正できる(録音日を間違えた場合等)。開封後日数などの集計はこの日付に追従する。
  const setSessionRecordedAt = (value) => {
    const d = value ? new Date(value) : null;
    if (!d || isNaN(d.getTime())) return;
    updateSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, recordedAt: d.toISOString() } : s)));
  };
  // datetime-local入力はローカル時刻の "YYYY-MM-DDTHH:mm" 形式を要求するため変換する
  const recordedAtLocal = (() => {
    const d = new Date(session.recordedAt);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  // メモは計測タブでは入力せず、ここで後から追記・修正する。打鍵毎の書き込みを避けるため
  // ローカルstateで編集し、フォーカスが外れた時にまとめてセッションへ反映する。
  const [memoDraft, setMemoDraft] = useState(session.memo || "");
  useEffect(() => { setMemoDraft(session.memo || ""); }, [session.id, session.memo]);
  const commitMemo = () => {
    const trimmed = memoDraft.trim();
    if (trimmed === (session.memo || "")) return;
    updateSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, memo: trimmed || null } : s)));
  };

  // DOM順序は既にセッション情報(1.)が先頭だが、タブから遷移する前のスクロール位置が
  // そのまま引き継がれるため、以前スクロールした状態でセッションを開くとタイムラインが
  // 最初に見えてしまう(リスト側のスクロール復元とは別件)。マウント時・セッション切り替え時に
  // 上端へ戻す。listScrollYRef 等、一覧側のスクロール復元ロジックには触れない(別件・F-15)。
  useEffect(() => { window.scrollTo(0, 0); }, [session.id]);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <button
        onClick={onBack}
        className="sans"
        style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#174585", fontSize: 12, marginBottom: 10, cursor: "pointer", padding: 0 }}
      >
        <ChevronDown size={13} style={{ transform: "rotate(90deg)" }} /> 一覧に戻る
      </button>

      {/* 1. セッション情報。
          【N-9 2026/08/16 本人指示】カードの箱を廃止して白地に直接置く(計測/リード/My Data と
          同じ文法)。直前に「一覧に戻る」の区切りがあるので、この群は上辺の罫を引かない
          (リードタブの no-top-rule と同じ判断)。 */}
      {/* 【F-98 2026/08/17 本人指示】セッション情報を「ラベル+値」の行構成(1行1情報)へ整形。
          ラベルは .mname の文字組み(12px / --c-ink-2)・値の左端は minWidth 3em で縦に揃える
          (「リード」が3文字なので 3em。F-55 の 2em はこの整形で置き換えた。コロンは正典 .mname に
          無いので全行から外した)。
          入力欄(datetime-local / メモ)は**白地+細い下線**へ: 地(--c-sunken)を打ち消し、
          リード個体詳細のメモ(borderBottom 1px solid var(--c-line))と同じ下線の作法。
          枠は透明で場所を残す(§6.1.5。border:none にすると外形が縮む)。中身のネイティブ input は不変。 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ marginBottom: 2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
            <span className="sans" style={{ fontSize: 12, color: "var(--c-ink-2)", minWidth: "3em", flexShrink: 0 }}>日付</span>
            <input
              type="datetime-local"
              value={recordedAtLocal}
              onChange={(e) => setSessionRecordedAt(e.target.value)}
              className="sans"
              style={{ padding: "4px 8px", fontSize: 13, boxSizing: "border-box", width: 158, flexShrink: 0, background: "none", border: "1px solid transparent", borderBottom: "1px solid var(--c-line)", borderRadius: 0 }}
            />
          </span>
          <SetAsIdealButton session={session} sessions={sessions} selectedIdeal={selectedIdeal} onSave={promoteSessionToIdeal} />
        </div>
        <div className="sans" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <span style={{ fontSize: 12, color: "var(--c-ink-2)", minWidth: "3em", flexShrink: 0 }}>奏者</span>
          {/* 【N-9 2026/08/16 本人指示】select 類は見た目だけ「素のテキスト + ▾」(F-72 の作法)。
              中身のネイティブ select はそのまま。 */}
          <PerformerSelector bare selectId="session-performer-select" performers={performers} selectedPerformer={session.performer || "自分"} setSelectedPerformer={setSessionPerformer} setPerformers={setPerformers} />
        </div>
        <div className="sans" style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--c-ink-2)", minWidth: "3em", flexShrink: 0 }}>リード</span>
          <PlainSelect
            ariaLabel="紐付けるリード"
            text={reed ? reedLabel(reed, reeds) : "未紐付け"}
            value={session.reedId || ""} onChange={(e) => setSessionReedId(e.target.value || null)}
          >
            <option value="">未紐付け</option>
            {reeds.map((r) => (<option key={r.id} value={r.id}>{reedLabel(r, reeds)}</option>))}
          </PlainSelect>
        </div>
        <div className="sans" style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 28 }}>
          <span style={{ fontSize: 12, color: "var(--c-ink-2)", minWidth: "3em", flexShrink: 0 }}>楽器</span>
          <span style={{ fontSize: 12, color: "var(--c-ink)" }}>{SAX_PRESETS[session.saxType]?.label ?? session.saxType}</span>
        </div>
        {session.source === "upload" && (
          <div className="sans" style={{ fontSize: 12, color: "#8D95A1", marginTop: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>アップロード: {session.sourceFileName}</div>
        )}
        <div className="sans" style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--c-ink-2)", minWidth: "3em", flexShrink: 0 }}>メモ</span>
          <input
            type="text"
            value={memoDraft} onChange={(e) => setMemoDraft(e.target.value)} onBlur={commitMemo}
            className="sans"
            style={{ flex: 1, padding: "6px 2px", fontSize: 12, background: "none", border: "1px solid transparent", borderBottom: "1px solid var(--c-line)", borderRadius: 0 }}
          />
        </div>
      </div>

      {/* 2. 録音データグラフ(時間変化のタイムライン。単音でも音の立ち上がり等の変化があるため常に表示) */}
      {frames.length > 0 && (
        <PhraseTimeline
          frames={frames} noteEvents={session.noteEvents} selectedIdeal={selectedIdeal}
          NUM_HARMONICS={NUM_HARMONICS} sessions={sessions} ownSessionId={session.id}
          barlines={session.barlines}
        />
      )}

      {/* 2.5. セッション平均の指標。タップで横軸=音名の折れ線グラフに切り替わる(再タップで数値に戻る)。
          【N-9 2026/08/16 本人指示】カード+.tile の箱を廃止し、リード個体詳細と同じ
          bare(numrow)の「枠も地も持たない数字の列」+ 罫1本にする。目安(selectedIdeal / idealKey)は
          **残す**(N-8 で消したのは My Data 側だけ。検査 28.4)。 */}
      {frames.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--c-rule)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", padding: "10px 0 6px" }}>
            {REED_COMPARE_METRICS.map((mt) => {
              const v = sessionMetrics[mt.key];
              return (
                <TappableMetricCard
                  key={mt.key}
                  bare
                  label={mt.label} unit={mt.unit} fmt={mt.fmt}
                  metricKey={mt.key} idealKey={METRIC_IDEAL_KEYS[mt.key]}
                  frames={frames} saxType={session.saxType} tuningHz={tuningHz} selectedIdeal={selectedIdeal}
                  value={v !== null && v !== undefined ? mt.fmt(v) : "—"}
                  sub={mt.sub?.(sessionMetrics) ?? null}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* 3. 音階ごとの平均値。1回のデータに複数の音が含まれる場合、音ごとの理想値との差もここで確認できる。
          【N-9 2026/08/16 本人指示】カードの箱 → 白地+上辺の罫1本。表の見出し行の地色
          (--c-sunk の箱)も落とし、罫(borderBottom)だけで見出しを分ける。 */}
      {noteGroups.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--c-rule)", padding: "12px 0" }}>
          <div className="sans" style={{ fontSize: 12, color: "#435266", marginBottom: 10 }}>
            音階ごとの平均（{noteGroups.length}音）
          </div>
          {/* 【F-98 2026/08/17 本人指示】F-44 の解説文「ピッチは各音の安定区間の平均（…過渡 n% を
              除外）」は削除(本人が名指しした長い解説文)。**集計そのもの(過渡の除外)は不変**。 */}
          {/* 全件を縦に常時表示する(本人指示)。縦スクロールが無いので見出しの sticky は不要。
              横は375px幅ではテーブルの minWidth:480 に対して足りないため overflowX は残す。
              軸ロック(useAxisLockScroll)は「縦横どちらもスクロールする場合の斜め防止」用だったが、
              縦スクロールが無くなったのでこの箇所では不要になった。 */}
          <div style={{ overflowX: "auto" }}>
          <table className="sans" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 480 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "5px 8px", color: "#435266", fontSize: 12, fontWeight: 400, borderBottom: "1px solid var(--c-line)" }}>実音</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 12, fontWeight: 400, borderBottom: "1px solid var(--c-line)" }}>ピッチ</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 12, fontWeight: 400, borderBottom: "1px solid var(--c-line)" }}>音量</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 12, fontWeight: 400, borderBottom: "1px solid var(--c-line)" }}>重心</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 12, fontWeight: 400, borderBottom: "1px solid var(--c-line)" }}>HNR</th>
                <th style={{ textAlign: "right", padding: "5px 8px", color: "#435266", fontSize: 12, fontWeight: 400, borderBottom: "1px solid var(--c-line)" }}>目安との差</th>
              </tr>
            </thead>
            <tbody>
              {noteGroups.map((g) => {
                const noteIdeal = getNoteIdeal(selectedIdeal, g.semitoneIndex);
                const cents = noteIdeal?.pitchHz && g.pitchHz ? centsBetween(g.pitchHz, noteIdeal.pitchHz) : null;
                return (
                  <tr key={g.semitoneIndex}>
                    {/* 音名は実音(コンサートピッチ)。計測タブ・音名軸グラフと同じ表記に揃える(F-54) */}
                    <td style={{ padding: "5px 8px", color: "#121F32", fontWeight: 600, borderBottom: "1px solid #EEF1F4" }}>{g.concertLabel ?? "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", color: "#121F32", borderBottom: "1px solid #EEF1F4" }}>{g.pitchHz ? `${g.pitchHz.toFixed(1)}Hz` : "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", color: "#121F32", borderBottom: "1px solid #EEF1F4" }}>{g.volumeDb !== null ? `${g.volumeDb.toFixed(1)}dB` : "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", color: "#121F32", borderBottom: "1px solid #EEF1F4" }}>{g.centroidHz !== null ? `${Math.round(g.centroidHz)}Hz` : "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", color: "#121F32", borderBottom: "1px solid #EEF1F4" }}>{g.hnrDb !== null ? `${g.hnrDb.toFixed(1)}dB` : "—"}</td>
                    <td style={{ textAlign: "right", padding: "5px 8px", fontWeight: 600, borderBottom: "1px solid #EEF1F4", color: cents !== null ? pitchCellColor(cents) : "#8D95A1" }}>
                      {cents !== null ? `${cents > 0 ? "+" : ""}${cents.toFixed(1)}¢` : noteIdeal ? "—" : "未登録"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
