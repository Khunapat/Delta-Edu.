// δelta Edu. logo files for LINE and the web board, all drawn from brand/delta-logo.svg
// (the "δelta Edu." wordmark as outlines; see scripts/brand/slab.mjs for the slab mark).
//   node scripts/brand/render.mjs      (needs Playwright with Chromium; no web fonts needed
//   except Nunito for the cover tagline, which falls back to a plain sans-serif offline)
// Writes into brand/:
//   icon.svg               the cream δ on a dark green rounded square: browser tab / app icon
//   icon-512.png           same, PNG: LINE Login channel icon
//   line-profile.png       640 x 640, cream slab logo on dark green: LINE Official Account profile picture
//   line-profile-dark.png  640 x 640, dark green slab on cream (alternative)
//   line-cover.png         1080 x 878: LINE Official Account cover photo, slab logo + tagline
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { BRAND_DIR as brand, C, TAGLINE, slab, deltaGlyph } from './slab.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// The δ in a dark green rounded square (1000 units), cream glyph, optically centred.
const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="δelta Edu.">'
  + `<title>δelta Edu.</title><rect width="1000" height="1000" rx="220" fill="${C.dark}"/>`
  + `<g transform="translate(500 512) scale(0.8) translate(-298 -368)">${deltaGlyph(C.cream)}</g></svg>\n`;
writeFileSync(join(brand, 'icon.svg'), icon);

const light = slab({ fill: C.cream, ink: C.dark });
const dark = slab({ fill: C.dark, ink: C.cream });
const at = (s, width) => s.svg(`width:${width}px;height:auto;display:block`);
const page = (w, h, bg, body, head = '') => `<!doctype html><html><head><meta charset="utf-8">${head}<style>*{margin:0}html,body{width:${w}px;height:${h}px;background:${bg};overflow:hidden}
body{display:grid;place-items:center;font-family:'Nunito','Helvetica Neue',Arial,sans-serif}</style></head><body>${body}</body></html>`;
const fonts = '<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@800&display=block" rel="stylesheet">';

const shots = [
  ['line-profile.png', 640, 640, page(640, 640, C.dark, at(light, 440))],
  ['line-profile-dark.png', 640, 640, page(640, 640, C.cream, at(dark, 440))],
  ['line-cover.png', 1080, 878, page(1080, 878, C.dark, `<div style="display:grid;justify-items:center;gap:64px">${at(light, 520)}
    <div style="font-size:40px;font-weight:800;letter-spacing:.01em;color:${C.light}">${TAGLINE}</div></div>`, fonts)],
  ['icon-512.png', 512, 512, page(512, 512, 'transparent', icon.replace('<svg ', '<svg style="width:512px;height:512px;display:block" '))],
];

const browser = await chromium.launch();
for (const [file, w, h, html] of shots) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}); // offline: fall back fonts
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: join(brand, file), omitBackground: file === 'icon-512.png' });
  await p.close();
  console.log('wrote brand/' + file);
}
await browser.close();
