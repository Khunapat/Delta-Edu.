// LINE Messaging API wrapper. Replies are free; pushes count against the
// monthly allowance per recipient (a push to a 3-person group costs 3), so
// every push goes through here and is counted in the Sheet.
//
// The month's limit is never crossed: before each push we use the HIGHER of
// our own count and LINE's count (LINE's also sees messages sent from OA
// Manager), and the LOWER of PUSH_MONTHLY_LIMIT and LINE's own quota.
//   essential  (🚧 blocked)          stops at 100%
//   normal     (digest, weekly, ...) stops at 90%
//   low        (18:00 ✓ round-up)    also stops when the month is ahead of
//              pace (more than 90% × day/days-in-month used), so the budget
//              lasts to the end of the month

import { messagingApi } from '@line/bot-sdk';

const LINE_COUNT_TTL_MS = 10 * 60_000;

export class Line {
  constructor({ token, db, monthlyLimit = 300, client = null, timeZone = 'Asia/Bangkok', now = () => new Date() }) {
    this.client = client || new messagingApi.MessagingApiClient({ channelAccessToken: token });
    // Media downloads (images, voice notes). Tests pass a fake client that does both.
    this.blob = client || new messagingApi.MessagingApiBlobClient({ channelAccessToken: token });
    this.db = db;
    this.limit = monthlyLimit;
    this.tz = timeZone;
    this.now = now;
    this.sizes = new Map();
    this.lineCount = null; // { at, month, used, limit }
  }

  monthKey(now = this.now()) {
    return 'push:' + new Intl.DateTimeFormat('en-CA', { timeZone: this.tz, year: 'numeric', month: '2-digit' }).format(now);
  }

  /** LINE's own usage and quota for this month (cached 10 min), or null when LINE can't be asked. */
  async lineUsage() {
    const now = this.now();
    const month = this.monthKey(now);
    const hit = this.lineCount;
    if (hit && hit.month === month && now.getTime() - hit.at < LINE_COUNT_TTL_MS) return hit;
    try {
      const [q, c] = await Promise.all([this.client.getMessageQuota(), this.client.getMessageQuotaConsumption()]);
      this.lineCount = {
        at: now.getTime(), month,
        used: Number(c?.totalUsage) || 0,
        limit: q?.type === 'limited' && Number(q.value) > 0 ? Number(q.value) : null,
      };
      return this.lineCount;
    } catch (err) {
      if (!hit || hit.month !== month) console.warn('LINE quota check failed, using our own count', err?.message || err);
      return hit && hit.month === month ? hit : null;
    }
  }

  /** { used, limit, source } for this month: the stricter of ours and LINE's. */
  async budget() {
    const ours = Number(await this.db.kvGet(this.monthKey(), 0)) || 0;
    const l = await this.lineUsage();
    const limit = Math.min(this.limit, l?.limit ?? Infinity);
    const used = Math.max(ours, l?.used ?? 0);
    return { used, limit, ours, source: l ? 'line' : 'bot' };
  }

  /** How much of the month's 90% should be used by the end of today. */
  pace(limit, now = this.now()) {
    const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: this.tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(now).split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Math.floor(limit * 0.9 * (d / days));
  }

  async reply(replyToken, messages) {
    const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean).slice(0, 5);
    if (!replyToken || !list.length) return;
    await this.client.replyMessage({ replyToken, messages: list });
  }

  async recipients(to) {
    if (!to.startsWith('C') && !to.startsWith('R')) return 1;
    if (this.sizes.has(to)) return this.sizes.get(to);
    let n = 5;
    try {
      const r = to.startsWith('C') ? await this.client.getGroupMemberCount(to) : await this.client.getRoomMemberCount(to);
      n = Math.max(1, (r?.count ?? 6) - 0);
    } catch (err) { console.warn('member count failed', err?.message || err); }
    this.sizes.set(to, n);
    return n;
  }

  /**
   * Push with budget control (see the top of this file). Returns true when sent.
   * `essential` may use the last 10%; `low` also waits when the month is ahead of pace.
   */
  async push(to, messages, { essential = false, low = false, kind = 'push' } = {}) {
    const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean).slice(0, 5);
    if (!to || !list.length) return false;
    const cost = await this.recipients(to);
    const key = this.monthKey();
    const { used, limit } = await this.budget();
    const after = used + cost;
    const why = after > limit ? 'limit'
      : !essential && after > limit * 0.9 ? '90%'
        : low && after > this.pace(limit) ? 'pace' : '';
    if (why) {
      console.warn(`push skipped (${kind}, ${why}): ${used}/${limit} used this month`);
      await this.db.log('bot', to, 'push_skipped', `${kind} ${why} ${used}/${limit}`);
      return false;
    }
    await this.client.pushMessage({ to, messages: list });
    await this.db.kvUpdate(key, (n) => (Number(n) || 0) + cost, 0);
    if (this.lineCount?.month === key) this.lineCount.used += cost;
    return true;
  }

  /** For the settings card. */
  async quota() {
    const b = await this.budget();
    return { limit: b.limit, used: b.used, source: b.source };
  }

  async displayName(userId, groupId) {
    try {
      const p = groupId ? await this.client.getGroupMemberProfile(groupId, userId) : await this.client.getProfile(userId);
      return p?.displayName || '';
    } catch { return ''; }
  }

  /** true / false, or null when LINE could not be asked (treat as "not now"). */
  async isGroupMember(groupId, userId) {
    if (!groupId || !userId) return false;
    try {
      await this.client.getGroupMemberProfile(groupId, userId);
      return true;
    } catch (err) {
      const status = Number(err?.status ?? err?.statusCode);
      if (status === 404 || status === 400) return false;
      console.warn('group member check failed', err?.message || err);
      return null;
    }
  }

  async showLoading(userId, seconds = 20) {
    try { await this.client.showLoadingAnimation({ chatId: userId, loadingSeconds: seconds }); } catch { /* 1:1 only */ }
  }

  async content(messageId) {
    const stream = await this.blob.getMessageContent(messageId);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
  }
}

/**
 * Text with @mentions: mentionText('{a} can you take a look?', { a: { uid, name } }).
 * People without a linked LINE id are written as their nickname instead.
 */
export function mentionText(text, users) {
  const substitution = {};
  let out = text;
  for (const [k, u] of Object.entries(users)) {
    if (u?.uid) substitution[k] = { type: 'mention', mentionee: { type: 'user', userId: u.uid } };
    else out = out.replaceAll(`{${k}}`, u?.name || '');
  }
  return Object.keys(substitution).length ? { type: 'textV2', text: out, substitution } : { type: 'text', text: out.trim() };
}
