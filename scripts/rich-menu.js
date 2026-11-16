// Put the Norse menu bar under every 1:1 chat with the bot.
//   node scripts/rich-menu.js          (reads LINE_CHANNEL_ACCESS_TOKEN from the env or .env)
// Safe to re-run: when the menu and image are unchanged it does nothing; otherwise it
// uploads the new menu, makes it the default, then deletes the old Norse menus.
// Rich menus cost no pushes.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { richMenuBody, imageFor, MENU_NAME } from '../src/richmenu.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function fromDotEnv(key) {
  const f = join(root, '.env');
  if (!existsSync(f)) return '';
  const line = readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith(key + '='));
  return line ? line.slice(key.length + 1).trim() : '';
}
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || fromDotEnv('LINE_CHANNEL_ACCESS_TOKEN');
if (!token) { console.error('LINE_CHANNEL_ACCESS_TOKEN is not set (env or .env)'); process.exit(1); }

const liffId = process.env.LIFF_ID || fromDotEnv('LIFF_ID');
const image = readFileSync(join(root, 'scripts/rich-menu', imageFor({ liffId })));
const version = createHash('sha1').update(JSON.stringify(richMenuBody('', { liffId }))).update(image).digest('hex').slice(0, 8);
const body = richMenuBody(version, { liffId });

const auth = { Authorization: `Bearer ${token}` };
async function call(method, url, { json, data, type } = {}) {
  const r = await fetch(url, {
    method,
    headers: { ...auth, ...(json ? { 'Content-Type': 'application/json' } : {}), ...(type ? { 'Content-Type': type } : {}) },
    body: json ? JSON.stringify(json) : data,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url.replace(API, '').replace(DATA, '')}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : {};
}
// Overridable only so tests can point the script at a fake LINE server.
const API = process.env.LINE_API_BASE || 'https://api.line.me/v2/bot';
const DATA = process.env.LINE_DATA_API_BASE || 'https://api-data.line.me/v2/bot';

const { richmenus = [] } = await call('GET', `${API}/richmenu/list`);
const ours = richmenus.filter((m) => m.name === MENU_NAME || m.name?.startsWith(MENU_NAME + '-'));
const current = await call('GET', `${API}/user/all/richmenu`).catch(() => ({}));
const live = ours.find((m) => m.name === body.name && m.richMenuId === current.richMenuId);
if (live) {
  console.log(`   menu bar already up to date (${body.name})`);
  process.exit(0);
}

const { richMenuId } = await call('POST', `${API}/richmenu`, { json: body });
await call('POST', `${DATA}/richmenu/${richMenuId}/content`, { data: image, type: 'image/png' });
await call('POST', `${API}/user/all/richmenu/${richMenuId}`);
for (const m of ours) {
  if (m.richMenuId !== richMenuId) await call('DELETE', `${API}/richmenu/${m.richMenuId}`).catch((e) => console.warn('   could not delete old menu', e.message));
}
console.log(`   ✓ menu bar set for every 1:1 chat (${body.name})`);
