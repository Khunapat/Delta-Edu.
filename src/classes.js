// Classes (teaching sessions), decisions and the tutor pay ladder. All three live
// on the web board as documents in the team Sheet:
//   classes/<id>    { date, time, end, course, brand: Uni|LITE, tutor, students, hours, status: planned|done|cancelled, note }
//   decisions/<id>  { title, area, status: open|agreed|dropped, outcome, owner, due, source }
//   settings/pay    { bands: [{ from, to|null, tutor }] }   tutor = % for students inside the band
// Nothing here calls the AI or LINE: the bot and the scheduler use these helpers.

import { normName } from './team.js';
import { addDays, isDayKey } from './dates.js';

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** Classes from board docs, not cancelled, between from..to (inclusive), sorted by date and time. */
export function classesBetween(docs, from, to, { tutor = '' } = {}) {
  return Object.entries(docs || {})
    .filter(([p, d]) => p.startsWith('classes/') && d && isDayKey(d.date) && d.status !== 'cancelled' && d.date >= from && d.date <= to)
    .map(([p, d]) => ({ id: p.split('/')[1], ...d }))
    .filter((c) => !tutor || normName(c.tutor) === normName(tutor))
    .sort((a, b) => `${a.date} ${a.time || '99:99'}`.localeCompare(`${b.date} ${b.time || '99:99'}`));
}
export const upcomingClasses = (docs, today, days = 7, opts) => classesBetween(docs, today, addDays(today, days - 1), opts);

/** Decisions from board docs: open first (by due), then the latest agreed ones. */
export function decisionLists(docs) {
  const all = Object.entries(docs || {}).filter(([p, d]) => p.startsWith('decisions/') && d?.title).map(([p, d]) => ({ id: p.split('/')[1], ...d }));
  const open = all.filter((d) => (d.status || 'open') === 'open').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.title.localeCompare(b.title));
  const agreed = all.filter((d) => d.status === 'agreed').sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  return { open, agreed };
}

/** Valid ladder bands (sorted), or [] when none / broken. Never invents numbers. */
export function ladderBands(settings) {
  const bands = (Array.isArray(settings?.bands) ? settings.bands : [])
    .map((b) => ({ from: num(b.from), to: num(b.to), tutor: num(b.tutor) }))
    .filter((b) => b.from != null && b.from >= 1 && b.tutor != null && b.tutor >= 0 && b.tutor <= 100 && (b.to == null || b.to >= b.from))
    .sort((a, b) => a.from - b.from);
  return bands;
}

/**
 * Progressive split, like tax brackets: each band's tutor % applies only to the
 * students inside that band. Students outside every band count as company share.
 *   fees = students x hours x price
 * Returns { fees, tutor, company, effective, rows: [{ from, to, students, fees, pct, tutor }] }.
 */
export function payout(bands, { students, hours, price }) {
  const s = Math.max(0, Math.floor(Number(students) || 0));
  const perStudent = (Number(hours) || 0) * (Number(price) || 0);
  const rows = [];
  let tutor = 0;
  for (const b of bands) {
    const top = b.to == null ? s : Math.min(s, b.to);
    const n = Math.max(0, top - b.from + 1);
    if (!n) continue;
    const fees = n * perStudent;
    const share = round2(fees * b.tutor / 100);
    tutor += share;
    rows.push({ from: b.from, to: top, students: n, fees, pct: b.tutor, tutor: share });
  }
  const fees = s * perStudent;
  tutor = round2(tutor);
  return { fees, tutor, company: round2(fees - tutor), effective: fees ? round2((tutor / fees) * 100) : 0, rows };
}
const round2 = (x) => Math.round(x * 100) / 100;

/** "THB 12,345" */
export const thb = (n) => `THB ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
