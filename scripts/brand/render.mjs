// Logo files for LINE and the web board, all drawn from brand/norse-logo.svg.
//   node scripts/brand/render.mjs      (needs Playwright; FONT_DIR as in scripts/rich-menu/render.mjs)
// Writes into brand/:
//   icon.svg               the N on cream: browser tab / app icon
//   icon-512.png           same, PNG: LINE Login channel icon
//   line-profile.png       640 x 640, black on cream: LINE Official Account profile picture
//   line-profile-dark.png  640 x 640, cream on near-black (alternative)
//   line-cover.png         1080 x 878: LINE Official Account cover photo, with the tagline
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const brand = join(root, 'brand');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const CREAM = '#F3F0E9';
export const INK = '#1A1A1A';
const logo = readFileSync(join(brand, 'norse-logo.svg'), 'utf8');
const path = /<path[^>]*\/>/.exec(logo)[0];
const [, , W, H] = /viewBox="([^"]+)"/.exec(logo)[1].split(' ').map(Number);

// The N is the first ~205 units of the wordmark; frame it in a cream rounded square.
const NW = 205;
const side = 330;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-(side - NW) / 2} ${-(side - H) / 2} ${side} ${side}" role="img" aria-label="NORSE">`
  + `<title>NORSE</title><rect x="${-(side - NW) / 2}" y="${-(side - H) / 2}" width="${side}" height="${side}" rx="72" fill="${CREAM}"/>`
  + `<clipPath id="n"><rect x="-10" y="-10" width="${NW + 10}" height="${H + 20}"/></clipPath>`
  + `<g clip-path="url(#n)" color="${INK}">${path}</g></svg>\n`;
writeFileSync(join(brand, 'icon.svg'), icon);

let fonts = '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500&display=block" rel="stylesheet">';
const dir = process.env.FONT_DIR;
if (dir && existsSync(dir)) {
  fonts = '<style>' + readdirSync(dir).filter((f) => /inter-latin-500/.test(f)).map((f) => `@font-face{font-family:'Inter';font-weight:500;src:url(data:font/woff2;base64,${readFileSync(join(dir, f)).toString('base64')}) format('woff2');}`).join('') + '</style>';
}
const svgAt = (width, color) => logo.replace('<svg ', `<svg style="width:${width}px;height:auto;display:block;color:${color}" `);
const page = (w, h, bg, body) => `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>*{margin:0}html,body{width:${w}px;height:${h}px;background:${bg};overflow:hidden}
body{display:grid;place-items:center;font-family:Inter,sans-serif}</style></head><body>${body}</body></html>`;

const shots = [
  ['line-profile.png', 640, 640, page(640, 640, CREAM, svgAt(400, INK))],
  ['line-profile-dark.png', 640, 640, page(640, 640, '#0C1112', svgAt(400, CREAM))],
  ['line-cover.png', 1080, 878, page(1080, 878, CREAM, `<div style="display:grid;justify-items:center;gap:44px">${svgAt(560, INK)}
    <div style="font-size:30px;letter-spacing:.04em;color:${INK};opacity:.72">Optimize your breathing. Elevate your performance.</div></div>`)],
  ['icon-512.png', 512, 512, page(512, 512, 'transparent', icon.replace('<svg ', '<svg style="width:512px;height:512px;display:block" '))],
];

const browser = await chromium.launch();
for (const [file, w, h, html] of shots) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: join(brand, file), omitBackground: file === 'icon-512.png' });
  await p.close();
  console.log('wrote brand/' + file);
}
await browser.close();
console.log(`logo ${W} x ${H}`);
