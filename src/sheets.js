// The team Google Sheet is the database. Each tab is a table whose first row is
// the header; the bot creates missing tabs and columns on start and never
// renames or removes anything people added. Values are written RAW (as typed),
// so dates stay 'YYYY-MM-DD' strings.
//
// Cloud Run runs one instance (max-instances 1), so an in-process lock per tab
// is enough to keep read-modify-write safe.

import { google } from 'googleapis';
import { withLock } from './lock.js';

export const SCHEMA = {
  Members: ['nickname', 'aliases', 'role', 'line_user_id', 'linked_at', 'email', 'phone', 'line_id'],
  // Same field names as the team board (title, owner, stream, status, ...).
  Tasks: ['id', 'title', 'owner', 'stream', 'status', 'priority', 'start', 'due', 'blocker', 'notify',
    'created', 'updated', 'created_by', 'done_at', 'source', 'reminded', 'overdue_tagged'],
  Milestones: ['id', 'title', 'date', 'stream', 'done'],
  Kv: ['key', 'value', 'updated'],
  Log: ['time', 'who', 'chat', 'action', 'detail'],
};

const colName = (n) => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/** Google Sheets API backend (uses the Cloud Run service account, no key file). */
export class GoogleSheetsBackend {
  constructor(spreadsheetId) {
    if (!spreadsheetId) throw new Error('SHEET_ID is required');
    this.id = spreadsheetId;
    const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    this.api = google.sheets({ version: 'v4', auth });
  }
  async listTabs() {
    const r = await this.api.spreadsheets.get({ spreadsheetId: this.id, fields: 'sheets.properties.title' });
    return (r.data.sheets || []).map((s) => s.properties.title);
  }
  async addTab(title) {
    await this.api.spreadsheets.batchUpdate({ spreadsheetId: this.id, requestBody: { requests: [{ addSheet: { properties: { title } } }] } });
  }
  async getValues(tab) {
    const r = await this.api.spreadsheets.values.get({ spreadsheetId: this.id, range: `'${tab}'!A1:ZZ`, valueRenderOption: 'FORMATTED_VALUE' });
    return r.data.values || [];
  }
  async setRow(tab, rowNumber, values) {
    await this.api.spreadsheets.values.update({
      spreadsheetId: this.id, range: `'${tab}'!A${rowNumber}:${colName(values.length - 1)}${rowNumber}`,
      valueInputOption: 'RAW', requestBody: { values: [values] },
    });
  }
  async appendRows(tab, rows) {
    await this.api.spreadsheets.values.append({
      spreadsheetId: this.id, range: `'${tab}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    });
  }
  async clearRow(tab, rowNumber) {
    await this.api.spreadsheets.values.clear({ spreadsheetId: this.id, range: `'${tab}'!A${rowNumber}:ZZ${rowNumber}` });
  }
}

/** In-memory backend with the same shape, for tests and local dry runs. */
export class MemoryBackend {
  constructor(tabs = {}) { this.tabs = structuredClone(tabs); this.calls = 0; }
  async listTabs() { this.calls++; return Object.keys(this.tabs); }
  async addTab(t) { this.calls++; this.tabs[t] = []; }
  async getValues(t) { this.calls++; return structuredClone(this.tabs[t] || []); }
  async setRow(t, n, values) { this.calls++; const rows = this.tabs[t]; while (rows.length < n) rows.push([]); rows[n - 1] = [...values]; }
  async appendRows(t, rows) { this.calls++; this.tabs[t].push(...rows.map((r) => [...r])); }
  async clearRow(t, n) { this.calls++; if (this.tabs[t][n - 1]) this.tabs[t][n - 1] = []; }
}

export class Db {
  constructor(backend, { ttlMs = 15000, clock = () => Date.now() } = {}) {
    this.b = backend;
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.cache = new Map(); // tab -> { at, header, rows }
    this.locks = new Map();
  }

  /** Create missing tabs, header rows and columns. */
  async init(schema = SCHEMA) {
    const have = new Set(await this.b.listTabs());
    for (const [tab, cols] of Object.entries(schema)) {
      if (!have.has(tab)) await this.b.addTab(tab);
      const values = have.has(tab) ? await this.b.getValues(tab) : [];
      const header = (values[0] || []).map((h) => String(h).trim());
      const missing = cols.filter((c) => !header.includes(c));
      if (missing.length) await this.b.setRow(tab, 1, [...header, ...missing]);
      this.cache.delete(tab);
    }
  }

  async table(tab, { fresh = false } = {}) {
    const hit = this.cache.get(tab);
    if (!fresh && hit && this.clock() - hit.at < this.ttlMs) return hit;
    const values = await this.b.getValues(tab);
    const header = (values[0] || []).map((h) => String(h).trim());
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const v = values[i] || [];
      if (!v.some((x) => String(x ?? '').trim() !== '')) continue;
      const obj = {};
      header.forEach((h, j) => { if (h) obj[h] = v[j] === undefined || v[j] === null ? '' : String(v[j]); });
      rows.push({ obj, row: i + 1 });
    }
    const t = { at: this.clock(), header, rows };
    this.cache.set(tab, t);
    return t;
  }

  async all(tab, opts) { return (await this.table(tab, opts)).rows.map((r) => ({ ...r.obj })); }

  toRow(header, obj) { return header.map((h) => (obj[h] === undefined || obj[h] === null ? '' : String(obj[h]))); }

  async insert(tab, objs) {
    const list = Array.isArray(objs) ? objs : [objs];
    return withLock(this.locks, tab, async () => {
      const { header } = await this.table(tab, { fresh: true });
      await this.b.appendRows(tab, list.map((o) => this.toRow(header, o)));
      this.cache.delete(tab);
      return list;
    });
  }

  /** Merge `patch` into the row whose `key` column equals `value`. Returns the new row or null. */
  async update(tab, key, value, patch) {
    return withLock(this.locks, tab, async () => {
      const { header, rows } = await this.table(tab, { fresh: true });
      const hit = rows.find((r) => r.obj[key] === String(value));
      if (!hit) return null;
      const next = { ...hit.obj, ...(typeof patch === 'function' ? patch(hit.obj) : patch) };
      await this.b.setRow(tab, hit.row, this.toRow(header, next));
      this.cache.delete(tab);
      return next;
    });
  }

  async remove(tab, key, value) {
    return withLock(this.locks, tab, async () => {
      const { rows } = await this.table(tab, { fresh: true });
      const hits = rows.filter((r) => r.obj[key] === String(value));
      for (const h of hits.reverse()) await this.b.clearRow(tab, h.row);
      this.cache.delete(tab);
      return hits.length;
    });
  }

  // ---- small JSON key/value store (drafts, waiting-for-input, counters) ----
  async kvGet(key, fallback = null) {
    const row = (await this.all('Kv')).find((r) => r.key === key);
    if (!row) return fallback;
    try { return JSON.parse(row.value); } catch { return fallback; }
  }
  async kvSet(key, value) {
    const now = new Date(this.clock()).toISOString();
    const updated = await this.update('Kv', 'key', key, { value: JSON.stringify(value), updated: now });
    if (!updated) await this.insert('Kv', { key, value: JSON.stringify(value), updated: now });
    return value;
  }
  async kvDel(key) { return this.remove('Kv', 'key', key); }
  /** Read-modify-write one key under a lock. */
  async kvUpdate(key, fn, fallback = null) {
    return withLock(this.locks, 'kv:' + key, async () => {
      const cur = await this.kvGet(key, fallback);
      const next = await fn(cur);
      if (next === undefined) return cur;
      if (next === null) { await this.kvDel(key); return null; }
      return this.kvSet(key, next);
    });
  }

  async log(who, chat, action, detail = '') {
    try {
      await this.insert('Log', { time: new Date(this.clock()).toISOString(), who, chat, action, detail: String(detail).slice(0, 500) });
    } catch (err) { console.warn('log failed', err?.message || err); }
  }
}
