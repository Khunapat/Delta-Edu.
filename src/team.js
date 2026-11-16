// Team data on top of the Sheet: members, tasks, milestones.
// Contact fields (email, phone, line_id) are read here but never leave the
// server in a group chat; cards use nicknames only.

import { randomBytes } from 'node:crypto';
import { normalizeDate, todayKey } from './dates.js';

export const STATUSES = ['todo', 'doing', 'blocked', 'done'];
export const STATUS_TH = { todo: 'ยังไม่เริ่ม', doing: 'กำลังทำ', blocked: 'ติดอยู่', done: 'เสร็จแล้ว' };
export const PRIORITIES = ['high', 'med', 'low'];

export const newId = () => randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase();

const HONORIFIC = /^(พี่|น้อง|คุณ|p'|p\.|k\.|khun)\s*/i;
export function normName(s) {
  return String(s || '').trim().replace(/^@/, '').replace(HONORIFIC, '').replace(/\s+/g, '').toLowerCase();
}
export const splitList = (s) => String(s || '').split(/[,،]/).map((x) => x.trim()).filter(Boolean);
export const ownersOf = (t) => splitList(t.owner);

export class Team {
  constructor(db, { timeZone = 'Asia/Bangkok', now = () => new Date() } = {}) {
    this.db = db;
    this.tz = timeZone;
    this.now = now;
  }

  today() { return todayKey(this.tz, this.now()); }
  stamp() { return this.now().toISOString(); }

  // ---- members ----
  async members() {
    return (await this.db.all('Members')).filter((m) => m.nickname.trim()).map((m) => ({
      ...m, nickname: m.nickname.trim(), aliases: splitList(m.aliases), admin: /admin/i.test(m.role),
    }));
  }
  async memberByUserId(uid) { return uid ? (await this.members()).find((m) => m.line_user_id === uid) || null : null; }
  /** Nickname or alias, ignoring พี่/น้อง/คุณ, case and spaces. */
  async memberByName(name) {
    const n = normName(name);
    if (!n) return null;
    return (await this.members()).find((m) => normName(m.nickname) === n || m.aliases.some((a) => normName(a) === n)) || null;
  }
  /** First start only. Each entry: "Nick[/alias/alias][:role]", e.g. "Bonnie/บอนนี่" or "Jai/เจ:admin". */
  async seedMembers(seed) {
    if (!seed?.length || (await this.members()).length) return 0;
    const rows = seed.map((s) => {
      const [names, role = ''] = s.split(':').map((x) => x.trim());
      const [nick, ...aliases] = names.split('/').map((x) => x.trim()).filter(Boolean);
      return { nickname: nick || '', aliases: aliases.join(', '), role };
    }).filter((r) => r.nickname);
    await this.db.insert('Members', rows);
    return rows.length;
  }
  /** Link a LINE user to a nickname from the team list. */
  async link(name, uid) {
    const m = await this.memberByName(name);
    if (!m) return { ok: false, reason: 'unknown' };
    if (m.line_user_id && m.line_user_id !== uid) return { ok: false, reason: 'taken', member: m };
    const already = await this.memberByUserId(uid);
    if (already && already.nickname !== m.nickname) {
      await this.db.update('Members', 'nickname', already.nickname, { line_user_id: '', linked_at: '' });
    }
    await this.db.update('Members', 'nickname', m.nickname, { line_user_id: uid, linked_at: this.stamp() });
    return { ok: true, member: { ...m, line_user_id: uid } };
  }

  // ---- tasks ----
  async tasks() {
    return (await this.db.all('Tasks')).filter((t) => t.id && t.title).map((t) => ({
      ...t,
      status: STATUSES.includes(t.status) ? t.status : 'todo',
      priority: PRIORITIES.includes(t.priority) ? t.priority : 'med',
      due: normalizeDate(t.due),
      start: normalizeDate(t.start),
      stream: t.stream || 'General',
    }));
  }
  async task(id) { return (await this.tasks()).find((t) => t.id === id) || null; }
  async openTasksOf(nickname) {
    return (await this.tasks()).filter((t) => t.status !== 'done' && ownersOf(t).includes(nickname)).sort(byDue);
  }
  async streams() {
    const set = new Set((await this.tasks()).map((t) => t.stream).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  async createTasks(drafts, by, source = 'line') {
    const stamp = this.stamp();
    const rows = drafts.map((d) => ({
      id: newId(),
      title: d.title.trim(),
      owner: d.owners.join(', '),
      stream: d.stream || 'General',
      status: 'todo',
      priority: PRIORITIES.includes(d.priority) ? d.priority : 'med',
      start: d.start || this.today(),
      due: d.due || '',
      blocker: '',
      notify: 'yes',
      created: stamp,
      updated: stamp,
      created_by: by || '',
      done_at: '',
      source,
      reminded: '',
      overdue_tagged: '',
    }));
    await this.db.insert('Tasks', rows);
    return rows;
  }

  async updateTask(id, patch) {
    return this.db.update('Tasks', 'id', id, (cur) => {
      const p = typeof patch === 'function' ? patch(cur) : patch;
      const next = { ...p, updated: this.stamp() };
      if (p.status === 'done' && cur.status !== 'done') next.done_at = this.stamp();
      if (p.status && p.status !== 'done') next.done_at = '';
      if (p.status && p.status !== 'blocked' && p.blocker === undefined) next.blocker = '';
      if (p.due !== undefined && p.due !== cur.due) { next.reminded = ''; next.overdue_tagged = ''; }
      return next;
    });
  }

  async milestones() {
    return (await this.db.all('Milestones')).filter((m) => m.title).map((m) => ({
      ...m, date: normalizeDate(m.date), done: /^(yes|true|1|done|✓)$/i.test(m.done),
    }));
  }
}

export function byDue(a, b) {
  return (a.due || '9999').localeCompare(b.due || '9999') || a.title.localeCompare(b.title);
}
