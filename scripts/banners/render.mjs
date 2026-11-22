// Capture the δelta Edu. animated card banners (banners.html) into brand/banner-<name>.png
// (APNG, looping). The slab logo and the δ come from brand/delta-logo.svg via
// scripts/brand/slab.mjs; the "Welcome" text uses Nunito (Google Fonts, sans-serif offline).
//   node scripts/banners/render.mjs     (needs Playwright and the upng-js dev dependency)
// LINE shows animated PNGs in cards (image component with animated: true) up to 300 KB.
import { readFileSync, writeFileSync } from 'node:fs';
import { C, slab, deltaGlyph } from '../brand/slab.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const brand = join(here, '..', '..', 'brand');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const UPNG = require('upng-js');

export const SCENES = ['morning', 'done', 'weekly', 'welcome'];
const W = 800; const H = 300; const LOOP_MS = 3000; const FRAMES = 24; const LIMIT = 280 * 1024; // LINE allows 300 KB; keep a margin

const html = readFileSync(join(here, 'banners.html'), 'utf8')
  .replaceAll('<!--SLAB-->', slab({ fill: C.cream, ink: C.dark, title: false }).svg())
  .replaceAll('<!--SLAB_DARK-->', slab({ fill: C.dark, ink: C.cream, title: false }).svg())
  .replaceAll('<!--DELTA-->', deltaGlyph(C.dark));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}); // offline: fallback font
await page.evaluate(() => document.fonts.ready);
for (const name of SCENES) {
  await page.evaluate((n) => { location.hash = n; }, name);
  await page.waitForTimeout(50);
  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate((t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; }), (LOOP_MS * i) / FRAMES);
    const shot = await page.screenshot({ type: 'png' });
    frames.push(shot);
  }
  // decode -> RGBA, then encode as one looping APNG with a reduced palette
  const rgba = frames.map((buf) => { const img = UPNG.decode(buf); return UPNG.toRGBA8(img)[0]; });
  let cnum = 128; let out;
  do {
    out = Buffer.from(UPNG.encode(rgba, W, H, cnum, rgba.map(() => Math.round(LOOP_MS / FRAMES))));
    cnum = Math.floor(cnum / 2);
  } while (out.length > LIMIT && cnum >= 16);
  writeFileSync(join(brand, `banner-${name}.png`), out);
  console.log(`brand/banner-${name}.png  ${(out.length / 1024).toFixed(0)} KB, ${FRAMES} frames`);
}
await browser.close();
