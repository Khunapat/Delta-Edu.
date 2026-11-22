// The web board's data, kept in the team Sheet so the bot and the board share it.
//
//   tasks/<id>       <-> Tasks tab       (same rows the bot reads and writes)
//   milestones/<id>  <-> Milestones tab
//   anything else    <-> Board tab       (one row per document: path, JSON in parts)
//
// The board page talks in documents (like a tiny Firestore): set, update
// (shallow merge), delete. Fields the Sheet has no column for (e.g. a task's
// "assigned" map) are kept as JSON in the row's "extra" column.

import { createHash } from 'node:crypto';
import { normalizeDate } from '../dates.js';

const PART = 45000;                 // a Sheet cell holds 50,000 characters
const MAX_DOC = 900_000;            // one document (e.g. an imported table) at most ~0.9 MB
const PATH = /^[A-Za-z][A-Za-z0-9_-]{0,40}\/[A-Za-z0-9_-]{1,80}$/;

const TASK_COLS = ['title', 'owner', 'stream', 'status', 'priority', 'start', 'due', 'blocker', 'notify', 'created', 'updated'];
const MS_COLS = ['title', 'date', 'stream', 'done', 'updated'];
const STATUSES = new Set(['todo', 'doing', 'blocked', 'done']);
const PRIOS = new Set(['high', 'med', 'low']);

const str = (v) => (v == null ? '' : String(v).trim());
const parseExtra = (s) => { try { const o = JSON.parse(s || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };
const yes = (v) => /^(yes|true|1|done|✓)$/i.test(String(v ?? ''));

export function validPath(path) { return typeof path === 'string' && PATH.test(path); }

/** Sheet row -> board task. */
export function taskToDoc(row) {
  const extra = parseExtra(row.extra);
  return {
    ...extra,
    title: row.title, owner: row.owner || 'Unassigned', stream: row.stream || 'Both',
    status: STATUSES.has(row.status) ? row.status : 'todo', priority: PRIOS.has(row.priority) ? row.priority : 'med',
    start: normalizeDate(row.start), due: normalizeDate(row.due), blocker: row.blocker || '',
    notify: row.notify === '' ? false : yes(row.notify), created: row.created || '', updated: row.updated || '',
  };
}

/** Board task -> Sheet columns (only the columns the board owns; bot columns are left alone). */
export function docToTaskCols(doc) {
  const extra = {};
  for (const [k, v] of Object.entries(doc)) if (!TASK_COLS.includes(k) && k !== 'id') extra[k] = v;
  const owner = str(doc.owner);
  return {
    title: str(doc.title).slice(0, 200), owner: /^unassigned$/i.test(owner) ? '' : owner, stream: str(doc.stream) || 'Both',
    status: STATUSES.has(doc.status) ? doc.status : 'todo', priority: PRIOS.has(doc.priority) ? doc.priority : 'med',
    start: normalizeDate(doc.start), due: normalizeDate(doc.due), blocker: str(doc.blocker).slice(0, 300),
    notify: doc.notify === false ? 'no' : 'yes', created: str(doc.created), updated: str(doc.updated) || new Date().toISOString(),
    extra: Object.keys(extra).length ? JSON.stringify(extra) : '',
  };
}

export function msToDoc(row) {
  return { ...parseExtra(row.extra), title: row.title, date: normalizeDate(row.date), stream: row.stream || 'Both', done: yes(row.done), updated: row.updated || '' };
}
export function docToMsCols(doc) {
  const extra = {};
  for (const [k, v] of Object.entries(doc)) if (!MS_COLS.includes(k) && k !== 'id') extra[k] = v;
  return {
    title: str(doc.title).slice(0, 200), date: normalizeDate(doc.date), stream: str(doc.stream) || 'Both', done: doc.done ? 'yes' : '',
    updated: str(doc.updated) || new Date().toISOString(), extra: Object.keys(extra).length ? JSON.stringify(extra) : '',
  };
}

export class BoardStore {
  /** `team` supplies members (for the default contact list) and the bot's task rules. */
  constructor({ db, team, now = () => new Date() }) {
    this.db = db;
    this.team = team;
    this.now = now;
  }

  /** Every document the board shows: { docs: { path: data }, etag }. */
  async snapshot() {
    const [tasks, ms, board, members] = await Promise.all([
      this.db.all('Tasks'), this.db.all('Milestones'), this.db.all('Board'), this.team.members(),
    ]);
    const docs = {};
    for (const r of tasks) if (r.id && r.title) docs[`tasks/${r.id}`] = taskToDoc(r);
    for (const r of ms) if (r.id && r.title) docs[`milestones/${r.id}`] = msToDoc(r);
    const parts = new Map();
    for (const r of board) {
      if (!validPath(r.path)) continue;
      const list = parts.get(r.path) || [];
      list.push([Number(r.part) || 0, r.json || '']);
      parts.set(r.path, list);
    }
    for (const [path, list] of parts) {
      try { docs[path] = JSON.parse(list.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join('')); } catch { /* half-written: skip */ }
    }
    // Read-only team list (nickname, role, linked) for pickers: never LINE ids or contacts.
    for (const m of members) {
      docs[`members/m-${slug(m.nickname)}`] = { nickname: m.nickname, role: String(m.role || ''), admin: !!m.admin, linked: !!m.line_user_id };
    }
    // The Team page starts from the bot's member list until someone edits it.
    if (!Object.keys(docs).some((p) => p.startsWith('contacts/'))) {
      for (const m of members) {
        docs[`contacts/m-${slug(m.nickname)}`] = { nick: m.nickname, first: m.nickname, last: '', status: 'active', email: '', tel: '', line: '' };
      }
    }
    const etag = createHash('sha1').update(JSON.stringify(docs)).digest('hex').slice(0, 16);
    return { docs, etag };
  }

  /** "Bonny, เจ" -> "Bonnie, Jai" when the names are on the team list (aliases too); others kept as typed. */
  async ownerNicknames(owner) {
    const names = String(owner || '').split(/\s*[,&\/]\s*|\s+and\s+/i).map((x) => x.trim()).filter(Boolean);
    const out = [];
    for (const n of names) {
      const m = await this.team.memberByName(n);
      const nick = m ? m.nickname : n;
      if (!out.includes(nick)) out.push(nick);
    }
    return out.join(', ');
  }

  async get(path) {
    return (await this.snapshot()).docs[path] ?? null;
  }

  /**
   * Apply one write. op: 'set' (replace), 'update' (shallow merge, doc must exist), 'delete'.
   * Returns { before, after } so callers can react (e.g. notify new owners).
   */
  async write({ op, path, data = {} }, { by = '' } = {}) {
    if (!validPath(path)) throw httpError(400, 'bad path');
    if (!['set', 'update', 'delete'].includes(op)) throw httpError(400, 'bad op');
    if (op !== 'delete' && (typeof data !== 'object' || data === null || Array.isArray(data))) throw httpError(400, 'bad data');
    const [coll, id] = path.split('/');
    if (coll === 'members') throw httpError(403, 'The team list comes from the Members tab in the Sheet');
    const before = await this.get(path);
    if (op === 'update' && !before) throw httpError(404, 'not found');
    const after = op === 'delete' ? null : op === 'update' ? deepMerge(before, data) : { ...data };
    const stamp = this.now().toISOString();

    if (coll === 'tasks') {
      if (op === 'delete') await this.db.replaceRows('Tasks', (r) => r.id === id, []);
      else {
        const cols = docToTaskCols(after);
        cols.owner = await this.ownerNicknames(cols.owner);
        if (!cols.title) throw httpError(400, 'task needs a title');
        if (before) {
          // Through Team so the bot's rules apply (done_at, reminders reset when the date moves).
          await this.team.updateTask(id, cols);
        } else {
          await this.db.insert('Tasks', {
            id, ...cols, created: cols.created || stamp, created_by: by, source: 'board',
            done_at: cols.status === 'done' ? stamp : '', reminded: '', overdue_tagged: '',
          });
        }
      }
    } else if (coll === 'milestones') {
      await this.db.replaceRows('Milestones', (r) => r.id === id, op === 'delete' ? [] : [{ id, ...docToMsCols(after) }]);
    } else {
      let rows = [];
      if (op !== 'delete') {
        const json = JSON.stringify(after);
        if (json.length > MAX_DOC) throw httpError(413, 'too big');
        for (let i = 0; i * PART < json.length || i === 0; i++) rows.push({ path, part: i, json: json.slice(i * PART, (i + 1) * PART), updated: stamp });
      }
      await this.db.replaceRows('Board', (r) => r.path === path, rows);
    }
    return { before, after: op === 'delete' ? null : await this.get(path) };
  }
}

/** Like the original board's runtime: nested plain objects merge (one canvas block at a time); arrays and values replace. */
export function deepMerge(base, patch) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    const cur = out[k];
    out[k] = isPlain(v) && isPlain(cur) ? deepMerge(cur, v) : v;
  }
  return out;
}
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || createHash('sha1').update(String(s)).digest('hex').slice(0, 8); }
export function httpError(status, message) { return Object.assign(new Error(message), { status }); }
