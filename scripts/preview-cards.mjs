// HTML preview of every card the bot sends (real src/flex.js, sample data), so the
// look can be checked without a phone:
//   node scripts/preview-cards.mjs > cards.html
// Banners are embedded so the page works offline. LINE's own renderer uses the
// phone's font and slightly different spacing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as F from '../src/flex.js';
import { render, esc } from './cards/emulate.mjs';

const brand = join(dirname(fileURLToPath(import.meta.url)), '..', 'brand');
F.setAssetBase('https://delta.local', 'preview');
const { samples } = await import('./cards/samples.mjs');
const embed = (url) => {
  const m = /\/brand\/([a-z0-9-]+\.png)/.exec(url);
  return m ? 'data:image/png;base64,' + readFileSync(join(brand, m[1])).toString('base64') : url;
};

const sections = samples().map((s) => `<h3>${esc(s.title)}</h3>${s.you ? `<div class="you">${esc(s.you)}</div>` : ''}${s.messages.flat().map((m) => render(m, { urlFor: embed })).join('')}`);
console.log(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Delta cards</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;700&display=swap" rel="stylesheet"><style>
body{margin:0;padding:24px;background:#0b0f10;color:#e7efed;font-family:"Noto Sans Thai",system-ui,sans-serif}
h3{color:#8c9a98;font-weight:600;font-size:13px;margin:28px 0 8px}
.row{display:flex;gap:10px;overflow-x:auto;align-items:flex-start}
.bubble{border-radius:18px;overflow:hidden;flex:none}
.msg{margin:6px 0}.you{background:#5fbfa9;color:#0c1715;border-radius:16px;padding:8px 12px;display:table;margin:6px 0 6px auto}
.text{background:#1a2326;border-radius:16px;padding:8px 12px;display:inline-block;max-width:300px;white-space:pre-wrap;font-size:14px}
.quick span{display:inline-block;border:1px solid #8fd9c6;color:#8fd9c6;border-radius:999px;padding:3px 10px;margin:4px 4px 0 0;font-size:12px}
</style></head><body>${sections.join('')}</body></html>`);
