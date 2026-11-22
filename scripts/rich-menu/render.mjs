// Draw the δelta Edu. menu bar, scripts/rich-menu/menu.png and menu-board.png, from menu.html
// (only needed when the design changes; the PNGs are committed). Needs Playwright with Chromium.
//   node scripts/rich-menu/render.mjs
// Offline? Point FONT_DIR at a folder with Nunito .woff2 files (e.g. nunito-latin-900-normal.woff2
// from the @fontsource/nunito package) and they are used instead of Google Fonts.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { C, slab } from '../brand/slab.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let html = readFileSync(join(here, 'menu.html'), 'utf8');
// The cream δelta Edu. slab logo (from brand/delta-logo.svg) on the hero tile.
html = html.replace('<!--SLAB-->', slab({ fill: C.cream, ink: C.dark, title: false }).svg());
const dir = process.env.FONT_DIR;
if (dir && existsSync(dir)) {
  const faces = readdirSync(dir).filter((f) => f.endsWith('.woff2')).map((f) => {
    const family = /nunito/i.test(f) ? 'Nunito' : null;
    const weight = /-(\d00)-/.exec(f)?.[1];
    if (!family || !weight) return '';
    const data = readFileSync(join(dir, f)).toString('base64');
    return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  }).join('\n');
  html = html.replace(/<link[^>]+fonts\.g[^>]+>/g, '').replace('<style>', `<style>\n${faces}\n`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2500, height: 843 }, deviceScaleFactor: 1 });
for (const [board, file] of [[false, 'menu.png'], [true, 'menu-board.png']]) {
  await page.setContent(html, { waitUntil: 'networkidle' });
  if (board) await page.evaluate(() => document.querySelector('.help-tile').replaceChildren(document.getElementById('board-tile').content.cloneNode(true)));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(here, file), type: 'png' });
  console.log('wrote', join(here, file));
}
await browser.close();
