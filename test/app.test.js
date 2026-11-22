import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const cfg = loadConfig({ LINE_CHANNEL_SECRET: 'sec', LINE_CHANNEL_ACCESS_TOKEN: 't', CRON_SECRET: 'cron' });

async function serve({ initFails = false } = {}) {
  const handled = [];
  let inits = 0;
  const app = makeApp({
    cfg,
    init: async () => { inits++; if (initFails) throw new Error('The caller does not have permission'); },
    bot: { handle: async (e) => { handled.push(e); } },
    scheduler: { tick: async ({ force }) => ({ ran: [force] }) },
    aiLabel: () => 'Fake AI',
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const line = (body, secret = 'sec') => {
    const raw = JSON.stringify(body);
    return fetch(`${base}/webhook`, {
      method: 'POST', body: raw,
      headers: { 'content-type': 'application/json', 'x-line-signature': createHmac('sha256', secret).update(raw).digest('base64') },
    });
  };
  return { base, line, handled, inits: () => inits, close: () => server.close() };
}

test('LINE Verify (no events) gets 200 even before the Sheet is shared', async () => {
  const s = await serve({ initFails: true });
  try {
    const r = await s.line({ destination: 'U1', events: [] });
    assert.equal(r.status, 200);
    assert.equal(s.inits(), 0, 'Sheet not touched');
  } finally { s.close(); }
});

test('webhook: bad signature is refused; real events are handled', async () => {
  const s = await serve();
  try {
    assert.equal((await s.line({ events: [] }, 'wrong')).status, 401);
    const ev = { type: 'message', source: { type: 'user', userId: 'U1' }, message: { type: 'text', text: 'my tasks' } };
    assert.equal((await s.line({ events: [ev] })).status, 200);
    assert.equal(s.handled.length, 1);
  } finally { s.close(); }
});

test('/health says whether the Sheet opens (not /healthz: Cloud Run reserves it)', async () => {
  const ok = await serve();
  const bad = await serve({ initFails: true });
  try {
    const a = await fetch(`${ok.base}/health`);
    assert.equal(a.status, 200);
    assert.deepEqual(await a.json(), { ok: true, sheet: 'ok', ai: 'Fake AI' });
    const b = await fetch(`${bad.base}/health`);
    assert.equal(b.status, 500);
    assert.equal((await b.json()).sheet, 'cannot open');
  } finally { ok.close(); bad.close(); }
});

test('/cron/tick needs the secret', async () => {
  const s = await serve();
  try {
    assert.equal((await fetch(`${s.base}/cron/tick`, { method: 'POST' })).status, 401);
    const r = await fetch(`${s.base}/cron/tick?force=monday`, { method: 'POST', headers: { 'x-cron-secret': 'cron' } });
    assert.deepEqual(await r.json(), { ran: ['monday'] });
  } finally { s.close(); }
});
