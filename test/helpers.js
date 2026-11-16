import { Db, MemoryBackend, SCHEMA } from '../src/sheets.js';
import { Team } from '../src/team.js';
import { Line } from '../src/line.js';
import { Ai } from '../src/ai/index.js';
import { Bot } from '../src/bot.js';
import { Scheduler } from '../src/scheduler.js';
import { loadConfig } from '../src/config.js';

export class FakeLineClient {
  constructor() {
    this.replies = []; this.pushes = [];
    this.groupMembers = null; // Map groupId -> Set(userId); null = everyone is in every group
    this.lineQuota = null;    // { limit, used } to act like LINE's own count; null = offline
  }
  async replyMessage(r) { this.replies.push(r); }
  async pushMessage(r) { this.pushes.push(r); }
  async getGroupMemberCount() { return { count: 3 }; }
  async getRoomMemberCount() { return { count: 3 }; }
  async getMessageQuota() { if (!this.lineQuota) throw new Error('offline'); return { type: 'limited', value: this.lineQuota.limit }; }
  async getMessageQuotaConsumption() { if (!this.lineQuota) throw new Error('offline'); return { totalUsage: this.lineQuota.used }; }
  async showLoadingAnimation() {}
  async getProfile() { return { displayName: 'x' }; }
  async getGroupMemberProfile(groupId, userId) {
    if (this.groupMembers && !this.groupMembers.get(groupId)?.has(userId)) throw Object.assign(new Error('Not found'), { status: 404 });
    return { displayName: 'x' };
  }
  lastReply() { return this.replies.at(-1)?.messages || []; }
}

export class FakeProvider {
  constructor() { this.models = ['fake-model']; this.label = 'Fake'; this.queue = []; this.calls = []; }
  next(obj) { this.queue.push(obj); return this; }
  async extract({ system, parts, schema }) {
    this.calls.push({ system, text: parts.map((p) => p.text).join('\n') });
    const r = this.queue.shift();
    if (r instanceof Error) throw r;
    if (!r) throw new Error('no scripted AI answer');
    return {
      tasks: [], update: { task_id: '', action: 'none', date_text: '', date: '', reason: '' }, answer: '', clarify: '', ...r,
    };
  }
}

/** A team of 3, linked, with the group registered. Clock fixed at Mon 16 Nov 2026 09:00 Bangkok. */
export async function makeWorld({ now = new Date('2026-11-16T02:00:00Z'), link = true, seed = 'Jai/เจ:admin, Best/เบสท์, Bonnie/บอนนี่' } = {}) {
  const cfg = loadConfig({ BOT_NAME: 'Norse', CRON_SECRET: 's', TEAM_SEED: seed });
  const backend = new MemoryBackend();
  let clock = now.getTime();
  const db = new Db(backend, { ttlMs: 0, clock: () => clock });
  await db.init(SCHEMA);
  const team = new Team(db, { timeZone: cfg.timeZone, now: () => new Date(clock) });
  await team.seedMembers(cfg.teamSeed);
  const client = new FakeLineClient();
  const line = new Line({ client, db, monthlyLimit: 300, timeZone: cfg.timeZone, now: () => new Date(clock) });
  const provider = new FakeProvider();
  const ai = new Ai({ cfg, db, provider });
  const bot = new Bot({ cfg, db, team, line, ai });
  const scheduler = new Scheduler({ cfg, db, team, line, bot });
  const w = {
    cfg, backend, db, team, client, line, provider, ai, bot, scheduler,
    setNow(d) { clock = new Date(d).getTime(); },
    uid: { Jai: 'Ujai', Best: 'Ubest', Bonnie: 'Ubonnie' },
    group: 'Cteam',
    async dm(who, text) { await bot.handle({ type: 'message', replyToken: 'r', source: { type: 'user', userId: w.uid[who] || who }, message: { type: 'text', text } }); return client.lastReply(); },
    async say(who, text, mention = true, extra = []) {
      const prefix = mention ? '@Norse ' : '';
      const mentionees = mention ? [{ index: 0, length: 6, isSelf: true, type: 'user' }, ...extra] : extra;
      await bot.handle({ type: 'message', replyToken: 'r', source: { type: 'group', groupId: w.group, userId: w.uid[who] }, message: { type: 'text', text: prefix + text, mention: mentionees.length ? { mentionees } : undefined } });
      return client.lastReply();
    },
    async tap(who, data, params, where = 'direct') {
      const source = where === 'group' ? { type: 'group', groupId: w.group, userId: w.uid[who] } : { type: 'user', userId: w.uid[who] };
      await bot.handle({ type: 'postback', replyToken: 'r', source, postback: { data, params } });
      return client.lastReply();
    },
  };
  if (link) {
    // Real order: the admin links, sets the team group, then the others link.
    await w.dm('Jai', 'ฉันคือ Jai');
    await w.say('Jai', 'ใช้กลุ่มนี้');
    for (const n of ['Best', 'Bonnie']) await w.dm(n, `ฉันคือ ${n}`);
  }
  client.replies.length = 0;
  return w;
}

export const flat = (msgs) => JSON.stringify(msgs);
/** All postback data strings found in messages. */
export function postbacks(msgs) {
  const out = [];
  JSON.stringify(msgs, (k, v) => { if (k === 'data' && typeof v === 'string') out.push(v); return v; });
  return out;
}
