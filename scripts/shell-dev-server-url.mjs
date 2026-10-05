// scripts/shell-dev-server-url.mjs ── 開発版の殻(codemagic.yaml の workflow ios-dev)だけが走らせる。
// 【殻 S2 統括の裁定】開発版は同梱の dist ではなく Vercel の配信(本番の Web 版)を読み込む。main へ push すれば、
// 開発版のアプリを開き直すだけで画面の変更が届く(ネイティブの変更は ios-dev の再ビルドが要る)。
//
// 何をするか: `npx cap sync ios` が書き出した **生成物** ios/App/App/capacitor.config.json に server.url を足すだけ。
// 根の capacitor.config.json(git に入っている本物)は読みも書きもしない。生成物は ios/.gitignore で除外されていて、
// cap sync のたびに作り直される(= この書き換えはそのビルドの中だけで消える一時ファイル)。
//
// なぜ「同期の後で生成物を書き換える」か(Capacitor 8.5.2 で確実に効く道):
//   ・CLI の設定の読み込み(node_modules/@capacitor/cli/dist/config.js の loadExtConfig)は
//     capacitor.config.ts → .js → .json の順で、環境変数で上書きする口が無い。
//     .ts は typescript を要し(依存に無い)、.js は package.json の "type": "module" の下で require() 経由になり
//     export default が { default: … } のまま渡る(.default を剥がすのは .ts の道だけ)── どちらも確実でない。
//   ・CLI の copy(tasks/copy.js の copyCapacitorConfig)は設定をそのまま ios/App/App/capacitor.config.json に書き、
//     続く update が packageClassList(プラグインの一覧)を同じファイルに足す。iOS の実行時
//     (Capacitor/CAPInstanceDescriptor.swift)は**このファイル**の server.url を読んで serverURL にする。
//     だから同期の後でこのファイルに足せば、本物の設定ファイルに触れずに確実に効く。
//
// プラグイン(Filesystem・Share・KeepAwake・自前の FicusAudioSession)はリモートの URL の上でも動く:
//   Capacitor はブリッジ(native-bridge.js と window.Capacitor)を WKUserScript(atDocumentStart・メインフレーム)で
//   **どのオリジンにも**差し込む(Capacitor/JSExport.swift)。server.url はそのための live reload の仕組み
//   (https://capacitorjs.com/docs/guides/live-reload ・ https://capacitorjs.com/docs/config の server.url)。
//   server.url の内側への移動は WebViewDelegationHandler.swift が「アプリの移動」として許すので allowNavigation は要らない。
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 開発版が読み込む Web の配信(本番の Web 版と同じ。値の唯一の答え)。
export const DEV_SERVER_URL = "https://wind-tone-lab.vercel.app";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "ios", "App", "App", "capacitor.config.json");

const conf = JSON.parse(readFileSync(target, "utf8"));
// cap sync の後であること(packageClassList は update が足す)。無ければ順番の誤りなので止める。
if (!Array.isArray(conf.packageClassList)) {
  console.error(`[shell-dev] ${target} に packageClassList が無い。npx cap sync ios の後で走らせること`);
  process.exit(1);
}
conf.server = { ...(conf.server || {}), url: DEV_SERVER_URL };
writeFileSync(target, JSON.stringify(conf, null, "\t") + "\n");
console.log(`[shell-dev] server.url = ${DEV_SERVER_URL} を ios/App/App/capacitor.config.json(cap sync の生成物)に書いた`);
console.log(JSON.stringify(conf, null, 2));
