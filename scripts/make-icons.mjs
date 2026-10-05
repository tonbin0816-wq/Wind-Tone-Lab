// アイコン一式を public/icon.svg(唯一の元)から作り直す。DESIGN-SYSTEM.md §3.5。
// 使い方(リポジトリの根で。sharp は依存に入れない):
//   npm install --no-save sharp@0.32.6
//   node scripts/make-icons.mjs
// 書き出すもの: public/icon-maskable.svg・public/apple-touch-icon.png・assets/logo.png・assets/splash-logo.png・
//   AppIcon.appiconset(ライト・ダーク・色合わせの3枚と Contents.json)・Splash.imageset の png 6枚。
// @capacitor/assets の generate はアイコンに使わない(Contents.json を書き換えてダークと色合わせが消える)。
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const NAVY = '#174585';
const DARK_BG = '#0E1A2C';   // ダークの地(紺を暗くしたもの)
const DARK_FG = '#B9C9E4';   // ダークの印 = --c-accent-line
const src = readFileSync('public/icon.svg', 'utf8');
const D = /<path[^>]* d="([^"]+)"/.exec(src)[1];

const f1 = (n) => (Math.round(n * 10) / 10).toString();
const scaled = (s) => D.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${f1(512 + (x - 512) * s)} ${f1(512 + (y - 512) * s)}`);
const svgOf = ({ bg, fg, d = D, extra = '' }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">` +
  (bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : '') + extra +
  `<path fill="${fg}" fill-rule="evenodd" d="${d}"/></svg>\n`;
const png1024 = (svg, out) => sharp(Buffer.from(svg)).resize(1024, 1024).removeAlpha().png().toFile(out);

// Web: maskable は円で切られても葉先が欠けないよう 0.8 倍(安全域は中心から半径 0.4)。iOS Safari は SVG の apple-touch-icon を使わないので PNG
writeFileSync('public/icon-maskable.svg', svgOf({ bg: '#FFFFFF', fg: NAVY, d: scaled(0.8) }));
await sharp(Buffer.from(src)).resize(180, 180).removeAlpha().png().toFile('public/apple-touch-icon.png');

// iOS のアイコン(どれもアルファ無し)
const AI = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/';
await png1024(src, 'assets/logo.png');
await png1024(src, AI + 'AppIcon-512@2x.png');
await png1024(svgOf({ bg: DARK_BG, fg: DARK_FG,
  extra: '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/>' }),
  AI + 'AppIcon-dark-512@2x.png');
// 色合わせ: iOS は明るさだけを見て選ばれた色で塗るので、黒地に白(灰色の階調)
await sharp(Buffer.from(svgOf({ bg: '#000000', fg: '#FFFFFF' }))).resize(1024, 1024).greyscale().removeAlpha().png().toFile(AI + 'AppIcon-tinted-512@2x.png');
writeFileSync(AI + 'Contents.json', JSON.stringify({
  images: [
    { idiom: 'universal', size: '1024x1024', filename: 'AppIcon-512@2x.png', platform: 'ios' },
    { appearances: [{ appearance: 'luminosity', value: 'dark' }], idiom: 'universal', size: '1024x1024', filename: 'AppIcon-dark-512@2x.png', platform: 'ios' },
    { appearances: [{ appearance: 'luminosity', value: 'tinted' }], idiom: 'universal', size: '1024x1024', filename: 'AppIcon-tinted-512@2x.png', platform: 'ios' },
  ],
  info: { author: 'xcode', version: 1 },
}, null, 2) + '\n');

// 起動画面: 地なしの紺のマーク。横は枠の中心(重心合わせを保つ)、縦は外接箱の中心で正方形に切り出す
const mark = await sharp(Buffer.from(svgOf({ fg: NAVY }))).resize(2048, 2048).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let y0 = 1e9, y1 = -1, x0 = 1e9, x1 = -1;
for (let y = 0; y < mark.info.height; y++) for (let x = 0; x < mark.info.width; x++) if (mark.data[(y * mark.info.width + x) * 4 + 3] > 8) {
  x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
}
const cx = 1024, cy = (y0 + y1) / 2;
const half = Math.ceil(Math.max(cx - x0, x1 - cx, cy - y0, y1 - cy)) + 4;
const square = await sharp(mark.data, { raw: mark.info })
  .extract({ left: cx - half, top: Math.round(cy - half), width: 2 * half, height: 2 * half }).resize(1024, 1024).png().toBuffer();
writeFileSync('assets/splash-logo.png', square);
// 2732 四方の白地の中央へ。マークの高さは約 204px(iPhone 縦で約 63pt。前の葉と同じ)。ダークも白地
const S = Math.round(204 / ((y1 - y0) / (2 * half)));
const splash = await sharp({ create: { width: 2732, height: 2732, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
  .composite([{ input: await sharp(square).resize(S, S).png().toBuffer(), left: Math.round(1366 - S / 2), top: Math.round(1366 - S / 2) }]).png().toBuffer();
const SP = 'ios/App/App/Assets.xcassets/Splash.imageset/';
for (const n of [1, 2, 3]) for (const dark of ['', '-dark']) writeFileSync(`${SP}Default@${n}x~universal~anyany${dark}.png`, splash);
console.log('icons written');
