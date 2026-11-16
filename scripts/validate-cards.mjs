// Ask LINE whether every card the bot can send is valid, without sending anything.
//   node scripts/validate-cards.mjs      (reads LINE_CHANNEL_ACCESS_TOKEN from the env or .env)
// Uses https://api.line.me/v2/bot/message/validate/reply, which costs no messages.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as F from '../src/flex.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fromDotEnv = (key) => {
  const f = join(root, '.env');
  if (!existsSync(f)) return '';
  const line = readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith(key + '='));
  return line ? line.slice(key.length + 1).trim() : '';
};
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || fromDotEnv('LINE_CHANNEL_ACCESS_TOKEN');
if (!token) { console.error('LINE_CHANNEL_ACCESS_TOKEN is not set (env or .env)'); process.exit(1); }
F.setAssetBase(process.env.PUBLIC_URL || 'https://example.com', 'check');
const { samples } = await import('./cards/samples.mjs');

let bad = 0;
for (const s of samples()) {
  const msgs = s.messages.flat();
  for (let i = 0; i < msgs.length; i += 5) {
    const r = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs.slice(i, i + 5) }),
    });
    if (r.ok) { console.log(`   ✓ ${s.title}`); continue; }
    bad++;
    console.log(`   ✗ ${s.title}: ${r.status} ${await r.text()}`);
  }
}
if (bad) { console.error(`${bad} card(s) rejected by LINE`); process.exit(1); }
console.log('   all cards valid');
