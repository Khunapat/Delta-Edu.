// What Delta knows about δelta Edu. beyond the task list, for questions like
// "@Delta when is the next Thermo I class?" or "@Delta what did we decide about refunds?".
//   1. knowledge/delta-edu.md: the public basics, always included (edit to teach Delta more)
//   2. the web board's documents (private, in the Sheet): team notes, decisions,
//      upcoming classes, meetings, feedback form summary
// The tutor pay ladder (settings/pay) is never sent: the bot computes pay itself.
// Privacy rule: no phone numbers or emails ever go to the AI. Contact fields are
// dropped and anything that looks like a phone number or email is masked.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'knowledge', 'delta-edu.md');

// Board collections worth knowing, in order of usefulness, with a label for the AI.
const COLLECTIONS = [
  ['notes', 'Team notes (private, written by the team)'],
  ['decisions', 'Decisions (status open = not agreed yet; agreed = final)'],
  ['meetings', 'Meetings'],
];
// Never sent: who to call and how. (contacts/* is skipped as a whole.)
const PRIVATE_KEYS = /^(email|e-?mail|phone|tel|mobile|line|lineid|line_id|contact|address|customer)$/i;
const SKIP_KEYS = /^(id|example|updated|created|_updated|color|x|y|w|h)$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?66|0)[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{3,4}\b|\b\d{9,10}\b/g;

/** Mask emails and phone numbers in free text. */
export function scrub(s) {
  return String(s ?? '').replace(EMAIL, '[email]').replace(PHONE, '[phone]');
}

/** One line from a document: "key: value · key: value", private keys dropped. */
function line(doc, max = 320) {
  const parts = [];
  for (const [k, v] of Object.entries(doc || {})) {
    if (PRIVATE_KEYS.test(k) || SKIP_KEYS.test(k) || v == null || v === '') continue;
    let val;
    if (Array.isArray(v)) val = v.map((x) => (typeof x === 'object' ? x?.text ?? '' : x)).filter(Boolean).join(', ');
    else if (typeof v === 'object') continue;
    else val = String(v);
    val = scrub(val).replace(/\s+/g, ' ').trim();
    if (val) parts.push(`${k}: ${val}`);
  }
  const out = parts.join(' · ');
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}

function flattenText(obj, depth = 0, out = []) {
  if (obj == null || depth > 3) return out;
  if (typeof obj === 'string' || typeof obj === 'number') { const s = scrub(String(obj)).trim(); if (s) out.push(s); return out; }
  if (Array.isArray(obj)) { for (const x of obj) flattenText(x, depth + 1, out); return out; }
  for (const [k, v] of Object.entries(obj)) if (!PRIVATE_KEYS.test(k) && !SKIP_KEYS.test(k)) flattenText(v, depth + 1, out);
  return out;
}

/** Survey summary in a few lines: totals, then each question's top answers. */
export function researchText(s) {
  const lines = [`Feedback form: ${Number(s.total) || 0} responses${s.updatedAt ? ` (synced ${String(s.updatedAt).slice(0, 10)})` : ''}.`];
  for (const q of (Array.isArray(s.questions) ? s.questions : []).slice(0, 20)) {
    let a = '';
    if (q.type === 'choice' || q.type === 'multi') {
      const base = q.type === 'multi' ? (Number(q.n) || 1) : (q.options || []).reduce((n, o) => n + (Number(o.count) || 0), 0) || 1;
      a = (q.options || []).slice(0, 4).map((o) => `${scrub(o.label)} ${Math.round((Number(o.count) || 0) / base * 100)}%`).join(', ');
    } else if (q.type === 'scale' || q.type === 'number') a = `average ${Number(q.avg || 0).toFixed(1)}${q.max ? ' / ' + q.max : ''}`;
    else a = (q.samples || []).slice(0, 2).map((x) => `"${scrub(x).slice(0, 80)}"`).join(' ');
    lines.push(`- ${scrub(q.title).slice(0, 90)} (${q.n} answers): ${a}`);
  }
  return lines.join('\n');
}

export function baseKnowledge() {
  if (!existsSync(FILE)) return '';
  return readFileSync(FILE, 'utf8').split('\n').filter((l) => l.startsWith('- ') || /^\s{2,}\S/.test(l)).join('\n');
}

/** Text for the AI from the board's documents (path -> data). `max` caps the size. */
export function buildKnowledge(docs = {}, { max = 9000, today = '' } = {}) {
  const parts = [];
  const base = baseKnowledge();
  if (base) parts.push(`δelta Edu. basics:\n${base}`);
  const classes = Object.entries(docs).filter(([p, d]) => p.startsWith('classes/') && d?.date && d.status !== 'cancelled' && (!today || d.date >= today))
    .map(([, d]) => d).sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));
  if (classes.length) {
    parts.push(`Upcoming classes (${classes.length}):\n${classes.slice(0, 25).map((c) => `- ${c.date} ${c.time || ''} ${scrub(c.course || '')} (${c.brand || '-'}) tutor ${c.tutor || '?'}${c.students ? `, ${c.students} students` : ''}`.replace(/\s+/g, ' ')).join('\n')}`);
  }
  const research = docs['research/summary'];
  if (research) parts.push(researchText(research));
  for (const [coll, label] of COLLECTIONS) {
    const rows = Object.entries(docs).filter(([p]) => p.split('/')[0] === coll).map(([, d]) => line(d, coll === 'notes' ? 1500 : 320)).filter(Boolean);
    if (rows.length) parts.push(`${label} (${rows.length}):\n${rows.slice(0, 25).map((r) => '- ' + r).join('\n')}`);
  }
  let text = parts.join('\n\n');
  const more = '\n…(more on the board)';
  if (text.length > max) text = text.slice(0, max - more.length) + more;
  return text;
}
