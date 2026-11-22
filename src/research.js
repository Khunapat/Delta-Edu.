// Google Form answers -> the board's Research page (research/summary), hourly and
// whenever the Form link is saved on the board.
//
// The Form's response Sheet is shared with the bot (Viewer). Its link is in the
// board's research/config document. Only totals, per-question counts and short
// anonymous quotes are kept. Columns that hold contact details or names are skipped
// entirely; quotes are scrubbed of phone numbers and emails.
//
// Summary shape (what board/index.html renderResearch draws):
//   { total, byDay: { 'YYYY-MM-DD': n }, updatedAt, example: false,
//     questions: [{ title, type: choice|multi|scale|number|text, n, options: [{ label, count }],
//                   min, max, avg, median, samples }] }

import { google } from 'googleapis';
import { normalizeDate } from './dates.js';
import { scrub } from './knowledge.js';

const PRIVATE_COL = /ติดต่อ|contact|e-?mail|อีเมล|เบอร์|โทร|phone|line\s*id|ไลน์|ชื่อ-?นามสกุล|ชื่อจริง|full\s*name|^name$|address|ที่อยู่/i;
const TIME_COL = /ประทับเวลา|timestamp|time\s*stamp/i;

export function sheetIdFrom(url) {
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(String(url || ''));
  return m ? m[1] : (/^[A-Za-z0-9_-]{20,}$/.test(String(url || '')) ? String(url) : '');
}

/** Rows of the first tab of a spreadsheet the bot can read (service account). */
export async function readFirstTab(spreadsheetId) {
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const api = google.sheets({ version: 'v4', auth });
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const title = meta.data.sheets?.[0]?.properties?.title;
  if (!title) return [];
  const r = await api.spreadsheets.values.get({ spreadsheetId, range: `'${title}'!A1:ZZ`, valueRenderOption: 'FORMATTED_VALUE' });
  return r.data.values || [];
}

/** "a, b (x, y), c" -> ["a", "b (x, y)", "c"]: Google Forms joins checkbox answers with ", ". */
export function splitChoices(v) {
  const out = []; let cur = ''; let depth = 0;
  const s = String(v);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') depth++;
    if ((ch === ')' || ch === ']') && depth > 0) depth--;
    if (ch === ',' && depth === 0 && s[i + 1] === ' ') { out.push(cur.trim()); cur = ''; i++; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

const isNum = (v) => /^-?\d+(\.\d+)?$/.test(String(v).trim());
const count = (vals) => {
  const m = new Map();
  for (const v of vals) m.set(v, (m.get(v) || 0) + 1);
  return [...m].map(([label, c]) => ({ label, count: c })).sort((a, b) => b.count - a.count);
};
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** One column -> one question summary (or null when there is nothing to show). */
export function summarizeColumn(title, values) {
  const vals = values.map((v) => String(v ?? '').trim()).filter((v) => v && v !== '-');
  if (!vals.length) return null;
  const q = { title: title.replace(/\.{3}$/, '').trim(), n: vals.length };
  if (vals.every(isNum)) {
    const xs = vals.map(Number);
    const ints = xs.every((x) => Number.isInteger(x));
    const mx = Math.max(...xs); const mn = Math.min(...xs);
    if (ints && mn >= 0 && mx <= 10 && new Set(xs).size <= 11) {
      return { ...q, type: 'scale', min: mn === 0 ? 0 : 1, max: mx <= 5 ? 5 : 10, avg: xs.reduce((a, b) => a + b, 0) / xs.length, options: count(xs.map(String)).map((o) => ({ label: Number(o.label), count: o.count })) };
    }
    return { ...q, type: 'number', avg: xs.reduce((a, b) => a + b, 0) / xs.length, median: median(xs), min: mn, max: mx, options: [] };
  }
  const parts = vals.map(splitChoices);
  const tokens = parts.flat();
  const distinct = new Set(vals).size;
  const distinctTokens = new Set(tokens).size;
  // Checkbox question: answers are combinations of the same options, so splitting them
  // gives fewer different values than the whole answers (free text with commas does not).
  const multi = parts.some((p) => p.length > 1) && distinctTokens < distinct;
  if (multi) return { ...q, type: 'multi', options: count(tokens) };
  // Mostly unique answers = written answers; otherwise people picked from a list.
  if (vals.length < 3 || distinct / vals.length <= 0.7) return { ...q, type: 'choice', options: count(vals) };
  return { ...q, type: 'text', samples: vals.slice(-6).reverse().map((v) => scrub(v).slice(0, 180)) };
}

/** Sheet rows (header first) -> the board's research summary. */
export function summarize(rows, { now = new Date() } = {}) {
  const [header = [], ...data] = rows;
  const body = data.filter((r) => r.some((c) => String(c ?? '').trim()));
  const timeCol = header.findIndex((h) => TIME_COL.test(String(h)));
  const byDay = {};
  if (timeCol >= 0) {
    for (const r of body) {
      const day = normalizeDate(String(r[timeCol] || '').split(/[ ,T]/)[0]);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    }
  }
  const questions = [];
  header.forEach((h, i) => {
    if (i === timeCol || !String(h).trim() || PRIVATE_COL.test(String(h))) return;
    const q = summarizeColumn(String(h), body.map((r) => r[i]));
    if (q) questions.push(q);
  });
  return { total: body.length, byDay, questions, updatedAt: now.toISOString(), example: false };
}

export class Research {
  constructor({ store, readRows = readFirstTab, now = () => new Date() }) {
    Object.assign(this, { store, readRows, now });
  }

  /** Read the Form's Sheet and refresh research/summary. Never throws; errors go to research/config.lastError. */
  async sync() {
    const cfg = (await this.store.get('research/config')) || {};
    const id = sheetIdFrom(cfg.sheetUrl);
    if (!id) return { skipped: 'no form sheet linked' };
    try {
      const summary = summarize(await this.readRows(id), { now: this.now() });
      await this.store.write({ op: 'set', path: 'research/summary', data: summary }, { by: 'Delta' });
      await this.store.write({ op: 'update', path: 'research/config', data: { lastSync: summary.updatedAt, lastError: '' } });
      return { total: summary.total, questions: summary.questions.length };
    } catch (err) {
      const msg = /permission|403|404|not found/i.test(String(err?.message || err))
        ? "Delta can't read the responses Sheet: share it with delta-edu-bot@…iam.gserviceaccount.com (Viewer)"
        : String(err?.message || err).slice(0, 200);
      await this.store.write({ op: 'update', path: 'research/config', data: { lastError: msg } }).catch(() => {});
      console.warn('research sync failed', err?.message || err);
      return { error: msg };
    }
  }

  /** One line for the Monday post: feedback form responses (+ the last 7 days). '' when no form is linked. */
  async progressLine(today, sinceKey) {
    const docs = (await this.store.snapshot()).docs;
    const s = docs['research/summary'];
    if (!s) return '';
    const cfg = docs['research/config'] || {};
    const target = Number(cfg.target) || 0;
    const week = Object.entries(s.byDay || {}).filter(([d]) => d >= sinceKey && d <= today).reduce((n, [, c]) => n + c, 0);
    return `Feedback form: ${s.total}${target ? `/${target}` : ''} responses${week ? ` (+${week} in 7 days)` : ''}`;
  }
}
