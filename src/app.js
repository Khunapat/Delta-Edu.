// HTTP routes. Kept apart from index.js so tests can run them without LINE or Google.
//
// Note: Cloud Run reserves paths that end in "z" (like /healthz), so the
// health check is /health.

import express from 'express';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { middleware, HTTPFetchError } from '@line/bot-sdk';
import { setAssetBase, assetBase } from './flex.js';

const BRAND = join(dirname(fileURLToPath(import.meta.url)), '..', 'brand');
/** Changes whenever a brand file changes, so LINE fetches new images instead of cached ones. */
function brandVersion() {
  try {
    const h = createHash('sha1');
    for (const f of readdirSync(BRAND).sort()) h.update(f).update(readFileSync(join(BRAND, f)));
    return h.digest('hex').slice(0, 8);
  } catch { return '1'; }
}

const describe = (err) => (err instanceof HTTPFetchError ? `${err.status} ${err.body}` : err?.stack || String(err));

/** `init` opens the Sheet (and creates tabs) once; it may throw until the Sheet is shared. */
export function makeApp({ cfg, init, bot, scheduler, aiLabel = () => '', board = null }) {
  const app = express();
  // Card banners are images LINE downloads from us, so they need our public https address.
  // PUBLIC_URL wins; otherwise the first request's host (Cloud Run's own address) is used.
  const version = brandVersion();
  if (cfg.publicUrl) setAssetBase(cfg.publicUrl, version);
  app.use((req, _res, next) => {
    const host = req.get('x-forwarded-host') || req.get('host') || '';
    if (!assetBase() && /^[a-z0-9.-]+\.run\.app$/i.test(host)) setAssetBase(`https://${host}`, version);
    next();
  });
  app.use('/brand', express.static(BRAND, { maxAge: '30d' }));
  if (board) app.use(board); // /board and /api/board/* (JSON body parsing stays inside it)
  app.get('/', (_req, res) => res.send(`${cfg.botName} ok`));

  app.get('/health', async (_req, res) => {
    try {
      await init();
      res.json({ ok: true, sheet: 'ok', ai: aiLabel() });
    } catch (err) {
      res.status(500).json({ ok: false, sheet: 'cannot open', error: String(err?.message || err) });
    }
  });

  // LINE needs the raw body to check the signature: no express.json() here.
  app.post('/webhook', middleware({ channelSecret: cfg.line.channelSecret }), async (req, res) => {
    const events = req.body.events ?? [];
    // LINE's "Verify" button sends no events: answer at once, without the Sheet.
    if (!events.length) return res.status(200).end();
    try { await init(); } catch (err) { console.error('init failed', describe(err)); return res.status(500).end(); }
    // Events from one chat are handled in order; different chats in parallel.
    const byChat = new Map();
    for (const e of events) {
      const k = e.source?.groupId || e.source?.userId || 'x';
      byChat.set(k, [...(byChat.get(k) || []), e]);
    }
    await Promise.all([...byChat.values()].map(async (list) => {
      for (const e of list) {
        try { await bot.handle(e); } catch (err) { console.error('event failed', e.type, describe(err)); }
      }
    }));
    res.status(200).end();
  });

  app.all('/cron/tick', async (req, res) => {
    if (!cfg.cronSecret || req.get('x-cron-secret') !== cfg.cronSecret) return res.status(401).send('unauthorized');
    try {
      await init();
      const force = ['morning', 'monday', 'friday', 'evening'].includes(req.query.force) ? req.query.force : null;
      res.json(await scheduler.tick({ force }));
    } catch (err) {
      console.error('cron failed', describe(err));
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  app.use((err, _req, res, _next) => {
    console.error('request failed', describe(err));
    res.status(err?.name === 'SignatureValidationFailed' ? 401 : 500).end();
  });
  return app;
}
