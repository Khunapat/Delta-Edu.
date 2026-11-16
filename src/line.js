// LINE Messaging API wrapper. Replies are free; pushes count against the
// monthly allowance per recipient (a push to a 3-person group costs 3), so
// every push goes through here and is counted in the Sheet.

import { messagingApi } from '@line/bot-sdk';

export class Line {
  constructor({ token, db, monthlyLimit = 300, client = null, timeZone = 'Asia/Bangkok' }) {
    this.client = client || new messagingApi.MessagingApiClient({ channelAccessToken: token });
    this.blob = client ? null : new messagingApi.MessagingApiBlobClient({ channelAccessToken: token });
    this.db = db;
    this.limit = monthlyLimit;
    this.tz = timeZone;
    this.sizes = new Map();
  }

  monthKey(now = new Date()) {
    return 'push:' + new Intl.DateTimeFormat('en-CA', { timeZone: this.tz, year: 'numeric', month: '2-digit' }).format(now);
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
   * Push with budget control. Non-essential pushes are skipped once 90% of the
   * month's allowance is used. Returns true when sent.
   */
  async push(to, messages, { essential = false, kind = 'push' } = {}) {
    const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean).slice(0, 5);
    if (!to || !list.length) return false;
    const cost = await this.recipients(to);
    const key = this.monthKey();
    const used = Number(await this.db.kvGet(key, 0)) || 0;
    if (used + cost > this.limit || (!essential && used + cost > this.limit * 0.9)) {
      console.warn(`push skipped (${kind}): ${used}/${this.limit} used this month`);
      await this.db.log('bot', to, 'push_skipped', `${kind} ${used}/${this.limit}`);
      return false;
    }
    await this.client.pushMessage({ to, messages: list });
    await this.db.kvUpdate(key, (n) => (Number(n) || 0) + cost, 0);
    return true;
  }

  /** LINE's own count when available, else ours. */
  async quota() {
    const ours = Number(await this.db.kvGet(this.monthKey(), 0)) || 0;
    try {
      const [q, c] = await Promise.all([this.client.getMessageQuota(), this.client.getMessageQuotaConsumption()]);
      return { limit: q?.type === 'limited' ? q.value : this.limit, used: c?.totalUsage ?? ours, source: 'line' };
    } catch {
      return { limit: this.limit, used: ours, source: 'bot' };
    }
  }

  async displayName(userId, groupId) {
    try {
      const p = groupId ? await this.client.getGroupMemberProfile(groupId, userId) : await this.client.getProfile(userId);
      return p?.displayName || '';
    } catch { return ''; }
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
 * Text with @mentions: mentionText('{a} ช่วยดูหน่อย', { a: { uid, name } }).
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
