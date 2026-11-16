// Draw scripts/rich-menu/menu.png from menu.html (only needed when the design changes;
// the PNG is committed). Needs Playwright with Chromium.
//   node scripts/rich-menu/render.mjs
// Offline? Point FONT_DIR at a folder with IBM Plex Sans Thai and Inter .woff2 files
// (e.g. from the @fontsource packages) and they are used instead of Google Fonts.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let html = readFileSync(join(here, 'menu.html'), 'utf8');
// The NORSE wordmark (brand/norse-logo.svg) on the hero tile.
const logo = readFileSync(join(here, '..', '..', 'brand', 'norse-logo.svg'), 'utf8')
  .replace('<svg ', '<svg style="height:30px;width:auto;display:block;color:rgba(12,23,21,.6)" ');
html = html.replace('<!--NORSE_LOGO-->', logo);
const dir = process.env.FONT_DIR;
if (dir && existsSync(dir)) {
  const faces = readdirSync(dir).filter((f) => f.endsWith('.woff2')).map((f) => {
    const family = /plex-sans-thai/i.test(f) ? 'IBM Plex Sans Thai' : /inter/i.test(f) ? 'Inter' : null;
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
