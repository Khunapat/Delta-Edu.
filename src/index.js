import express from 'express';
import { middleware, HTTPFetchError } from '@line/bot-sdk';
import { loadConfig } from './config.js';
import { Db, GoogleSheetsBackend, MemoryBackend } from './sheets.js';
import { Team } from './team.js';
import { Line } from './line.js';
import { Ai } from './ai/index.js';
import { Bot } from './bot.js';
import { Scheduler } from './scheduler.js';

const cfg = loadConfig();
const backend = cfg.sheetId ? new GoogleSheetsBackend(cfg.sheetId) : new MemoryBackend();
if (!cfg.sheetId) console.warn('SHEET_ID not set: using an in-memory sheet (data is lost on restart)');
const db = new Db(backend);
const team = new Team(db, { timeZone: cfg.timeZone });
const line = new Line({ token: cfg.line.channelAccessToken, db, monthlyLimit: cfg.pushMonthlyLimit, timeZone: cfg.timeZone });
const ai = new Ai({ cfg, db });
const bot = new Bot({ cfg, db, team, line, ai });
const scheduler = new Scheduler({ cfg, db, team, line, bot });

let ready = null;
function init() {
  ready ||= (async () => {
    await db.init();
    const n = await team.seedMembers(cfg.teamSeed);
    if (n) console.log(`seeded ${n} members`);
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

const describe = (err) => (err instanceof HTTPFetchError ? `${err.status} ${err.body}` : err?.stack || String(err));

const app = express();
app.get('/', (_req, res) => res.send(`${cfg.botName} ok`));
app.get('/healthz', async (_req, res) => {
  try { await init(); res.json({ ok: true, ai: ai.label }); } catch (err) { res.status(500).json({ ok: false, error: String(err?.message || err) }); }
});

// LINE needs the raw body to check the signature: no express.json() here.
app.post('/webhook', middleware({ channelSecret: cfg.line.channelSecret }), async (req, res) => {
  try { await init(); } catch (err) { console.error('init failed', describe(err)); return res.status(500).end(); }
  const events = req.body.events ?? [];
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

app.listen(cfg.port, () => console.log(`${cfg.botName} listening on ${cfg.port} (${ai.label})`));
