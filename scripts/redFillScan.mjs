// ------------------------------------------------------------------
// 【便BI 2026-10-02 審査の差し戻し】赤の塗りの見張り(綴りの走査)。
// 本人指示「アプリ全体で赤の塗りのボタンを赤の枠に」の番人。src/dangerOutline.test.jsx と
// scripts/pitch-test.mjs(検証46 B-3)の両方がこの1つを読む。**許可の一覧はここに置かない**
// (読み手がそれぞれ自分の一覧を持つ。片方の一覧を広げても、もう片方が落ちる)。
//
// 以前の見張りは `background: "var(--c-danger)"` の**値の先頭**しか見ていなかったので、次を見逃した:
//   (K) 条件つき … background: count > 0 ? "var(--c-danger)" : "none"
//   (別名)       … const red = "var(--c-danger)";  …  background: red
// ここでは
//   ① background / backgroundColor / backgroundImage の**値の式の全体**(三項の両腕・括弧の中まで)を
//      切り出して、赤の綴りを探す(fills)
//   ② 赤の綴りを値に持つ定数(const / let / var)を全部拾う(redConsts)。読み手は許可の一覧の外を禁止する。
//      さらに ① の式が赤の定数の名前を含めば、それも塗りとして拾う(許可した定数の .color を地に流す形)
//   ③ CSS は background(-color|-image) の宣言の値の全体と、赤を値に持つカスタムプロパティ(cssVars)
//   ④ 【便BI 再審査の差し戻し】本体に赤の綴りを含む名前つきの関数(function 宣言・アロー・function 式)を
//      全部拾う(redFns)。読み手は許可の一覧の外を禁止する。① の式がその名前を含めば(呼んでいれば)、
//      **許可した関数でも**塗りとして拾う(赤を返す pitchCellColor を地に流す形 = 審査の R1)。
// 赤の綴り = --c-danger / --c-bad のトークンと、その実値 #DC2626(8桁の #DC2626FF も)/
// rgb(220, 38, 38)(空白区切りの rgb(220 38 38) と rgba も)。
// 【守っていないもの】(事実どおりに書く。ここに無い形は拾えると思わないこと)
//   ・色名(red / crimson など)や、近いが違う値(#DC2627 など)。赤の綴りの一覧に無い
//   ・inset の影での塗り(box-shadow: inset 0 0 0 999px …)。background ではないので見ていない。
//     pitch-test の【芯2】は「全周の枠」として1件だけ落とすが、塗りとしては数えていない
//   ・実行時に組み立てる色(数値から作る rgb の文字列・トークンの名前を文字列で継ぐなど)。綴りに現れない
//   ・関数を値として渡して、別の名前で呼ぶ形(PIVOT_MEASURES の color: pitchCellColor を m.color(v) で呼ぶなど)。
//     ④ が見るのは元の名前が塗りの式に現れるときだけ
// ------------------------------------------------------------------

export const RED_RE = /var\(\s*--c-(?:danger|bad)\s*\)|#dc2626(?:[0-9a-f]{2})?\b|rgba?\(\s*220\s*[,\s]\s*38\s*[,\s]\s*38\b/i;

// コメントを落とす(文字列の中の // や /* は残す)。CSS は /* */ だけ。
export function stripComments(text, css = false) {
  let out = "";
  let i = 0;
  let q = null; // 文字列の中なら引用符
  while (i < text.length) {
    const c = text[i];
    if (q) {
      out += c;
      if (c === "\\") { out += text[i + 1] ?? ""; i += 2; continue; }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const body = text.slice(i, end === -1 ? text.length : end + 2);
      out += body.replace(/[^\n]/g, " ");   // 行番号を保つ
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (!css && c === "/" && text[i + 1] === "/" && text[i - 1] !== ":") {
      while (i < text.length && text[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (!css && (c === '"' || c === "'" || c === "`")) q = c;
    out += c;
    i++;
  }
  return out;
}

// start から、深さ 0 の終わり(, ; } ) ] か、ends に入れた文字)までを切り出す。文字列・括弧の中は越える。
export function exprFrom(text, start, ends = ",;})]") {
  let depth = 0;
  let q = null;
  let i = start;
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === "\\") { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "(" || c === "[" || c === "{") { depth++; continue; }
    if ((c === ")" || c === "]" || c === "}") && depth > 0) { depth--; continue; }
    if (depth === 0 && ends.includes(c)) break;
  }
  return text.slice(start, i);
}

const lineAt = (text, idx) => text.slice(0, idx).split("\n").length;

// 初期化の式が関数か(function 式・アロー)。`(a) => …` / `a => …` / `async (…) => …` / `function …`。
// JSX の中のアロー(onClick={() => …})を持つだけの値を関数と取り違えない(先頭の形だけで決める)。
function isFunctionInit(init) {
  const t = init.trim().replace(/^async\s+/, "");
  if (/^function\b/.test(t)) return true;
  if (/^[A-Za-z_$][\w$]*\s*=>/.test(t)) return true;
  if (t[0] === "(") {
    const params = exprFrom(t, 1, ")");
    return /^\)\s*=>/.test(t.slice(1 + params.length));
  }
  return false;
}
// JSX の値(const tree = (<div …>…</div>))。色ではないので定数としては数えない(中の塗りは ① が拾う)。
const isJsxInit = (init) => /^\(?\s*</.test(init.trim());

// 1ファイルを走査する。name は表示用。css は CSS かどうか。
export function scanRedFills(name, raw, css = /\.css$/.test(name)) {
  const text = stripComments(raw, css);
  const fills = [];
  const redConsts = [];
  const cssVars = [];
  if (css) {
    for (const m of text.matchAll(/(^|[;{\s])(background(?:-color|-image)?)\s*:/g)) {
      const at = m.index + m[0].length;
      const expr = exprFrom(text, at, ";}");
      // 赤かどうかは scanRedFillsAll が見る(赤を値に持つカスタムプロパティ = CSS の別名も、そこで拾う)。
      fills.push({ file: name, line: lineAt(text, at), prop: m[2], expr: expr.trim(), raw: true });
    }
    for (const m of text.matchAll(/(^|[;{\s])(--[\w-]+)\s*:/g)) {
      const at = m.index + m[0].length;
      const expr = exprFrom(text, at, ";}");
      if (RED_RE.test(expr)) cssVars.push({ file: name, line: lineAt(text, at), name: m[2], expr: expr.trim() });
    }
    return { fills, redConsts, redFns: [], cssVars };
  }
  const redFns = [];
  // ② 赤を値に持つ定数。④ 関数(アロー・function 式)は redFns へ。JSX の値は数えない(中の塗りは ① が拾う)。
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?![=>])/g)) {
    const at = m.index + m[0].length;
    const init = exprFrom(text, at, ";");
    if (!RED_RE.test(init)) continue;
    if (isFunctionInit(init)) { redFns.push({ file: name, line: lineAt(text, at), name: m[1], kind: "arrow" }); continue; }
    if (isJsxInit(init)) continue;
    redConsts.push({ file: name, line: lineAt(text, at), name: m[1], init: init.trim().slice(0, 200) });
  }
  // ④ function 宣言(export も async も)。本体 = 引数の括弧の後ろの { … }。
  for (const m of text.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const params = exprFrom(text, open + 1, ")");
    const b = text.indexOf("{", open + 1 + params.length);
    if (b === -1) continue;
    const body = exprFrom(text, b + 1, "}");
    if (RED_RE.test(body)) redFns.push({ file: name, line: lineAt(text, m.index), name: m[1], kind: "function" });
  }
  // ① 塗り。style オブジェクトの鍵(引用符つきも)と、el.style.background = … の代入。
  const re = /(?:\b|["'])(background(?:Color|Image)?)["']?\s*:(?!:)|\.style\.(background(?:Color|Image)?)\s*=(?!=)/g;
  for (const m of text.matchAll(re)) {
    const at = m.index + m[0].length;
    const expr = exprFrom(text, at);
    fills.push({ file: name, line: lineAt(text, at), prop: m[1] ?? m[2], expr: expr.trim(), raw: true });
  }
  return { fills, redConsts, redFns, cssVars };
}

// 複数ファイルをまとめて走査し、① の式に赤の綴りか、赤の定数・赤の関数の名前が入っているものだけを返す。
export function scanRedFillsAll(files) {
  const per = files.map(([name, text]) => scanRedFills(name, text));
  const redConsts = per.flatMap((p) => p.redConsts);
  const redFns = per.flatMap((p) => p.redFns);
  const cssVars = per.flatMap((p) => p.cssVars);
  const names = [...new Set([...redConsts, ...redFns].map((c) => c.name))];
  const nameRe = names.length ? new RegExp(`\\b(?:${names.map((n) => n.replace(/\$/g, "\\$")).join("|")})\\b`) : null;
  const varRe = cssVars.length ? new RegExp(`var\\(\\s*(?:${cssVars.map((v) => v.name.replace(/[-]/g, "\\-")).join("|")})\\s*\\)`) : null;
  const fills = per.flatMap((p) => p.fills).filter((f) =>
    RED_RE.test(f.expr) || (nameRe && nameRe.test(f.expr)) || (varRe && varRe.test(f.expr)));
  return { fills: fills.map(({ raw, ...f }) => f), redConsts, redFns, cssVars };
}
