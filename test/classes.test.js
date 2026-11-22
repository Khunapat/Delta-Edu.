// Classes, decisions and tutor pay: board documents read by the bot (no AI, no pushes).
// The ladder numbers here are made up for the tests; the real one lives in the Sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, flat, postbacks } from './helpers.js';
import { payout, ladderBands, classesBetween, decisionLists, thb } from '../src/classes.js';
import { command } from '../src/rules.js';

const LADDER = { bands: [{ from: 1, to: 2, tutor: 50 }, { from: 3, to: 5, tutor: 55 }, { from: 6, to: null, tutor: 60 }] };

test('pay ladder: progressive like tax brackets, never a flat rate', () => {
  const bands = ladderBands(LADDER);
  const r = payout(bands, { students: 7, hours: 10, price: 200 }); // 2000 per student
  assert.equal(r.fees, 14000);
  assert.deepEqual(r.rows.map((x) => [x.from, x.to, x.students, x.tutor]), [[1, 2, 2, 2000], [3, 5, 3, 3300], [6, 7, 2, 2400]]);
  assert.equal(r.tutor, 7700);
  assert.equal(r.company, 6300);
  assert.equal(r.effective, 55);
  assert.notEqual(r.tutor, 14000 * 0.6, 'not the top rate for everyone');
  // students outside every band stay with the company
  const gap = payout(ladderBands({ bands: [{ from: 1, to: 2, tutor: 50 }] }), { students: 4, hours: 1, price: 100 });
  assert.equal(gap.tutor, 100);
  assert.equal(gap.company, 300);
  assert.equal(thb(19500), 'THB 19,500');
});

test('pay ladder: broken or missing bands are ignored, never invented', () => {
  assert.deepEqual(ladderBands(undefined), []);
  assert.deepEqual(ladderBands({ bands: [{ from: 0, tutor: 50 }, { from: 3, to: 1, tutor: 50 }, { from: 1, tutor: 150 }, { from: '', tutor: 10 }] }), []);
  assert.deepEqual(ladderBands({ bands: [{ from: '4', to: '', tutor: '65' }, { from: 1, to: 3, tutor: 60 }] }).map((b) => b.from), [1, 4]);
});

test('"pay ..." command: numbers read without AI; missing ones are asked; private chat only', async () => {
  const w = await makeWorld();
  assert.match(flat(await w.dm('Kiak', 'pay 7 students 10h 200')), /No pay ladder yet/);
  await w.store.write({ op: 'set', path: 'settings/pay', data: LADDER });
  const r = await w.dm('Kiak', 'pay 7 students 10h 200');
  assert.match(r[0].altText, /^Tutor pay: THB 7,700 of THB 14,000/);
  assert.match(flat(r), /Students 6–7/);
  assert.match(flat(r), /55%/);
  assert.match(flat(await w.dm('Kiak', 'pay 7 students')), /I need the hours, price per student-hour/);
  assert.match(flat(await w.say('Kiak', 'pay 7 students 10h 200')), /Pay is private/);
  assert.equal(w.provider.calls.length, 0, 'no AI');
  assert.equal(w.client.pushes.length, 0, 'no pushes');
  assert.deepEqual(command('pay 6 students 12 hours at 350'), { cmd: 'pay', students: 6, hours: 12, price: 350 });
});

async function withClasses() {
  const w = await makeWorld();
  const add = (id, d) => w.store.write({ op: 'set', path: `classes/${id}`, data: d });
  await add('c1', { date: '2026-11-16', time: '19:00', course: 'Thermodynamics I', brand: 'Uni', tutor: 'Kiak', students: 6, hours: 2, status: 'planned' });
  await add('c2', { date: '2026-11-18', time: '10:00', course: 'SAT Math', brand: 'LITE', tutor: 'Best', students: 4, hours: 1.5, status: 'planned' });
  await add('c3', { date: '2026-11-17', time: '13:00', course: 'IGCSE Physics', brand: 'LITE', tutor: 'Kiak', students: 1, hours: 1, status: 'cancelled' });
  await add('c4', { date: '2026-11-27', time: '19:00', course: 'Thermodynamics I', brand: 'Uni', tutor: 'Kiak', status: 'planned' });
  await add('c5', { date: '2026-11-10', time: '19:00', course: 'Past class', brand: 'Uni', tutor: 'Kiak', status: 'done' });
  return w;
}

test('classes: "classes" shows the team\'s next 7 days, "my classes" only mine; cancelled and past ones hidden', async () => {
  const w = await withClasses();
  const all = await w.say('Jai', 'classes');
  assert.match(all[0].altText, /^Classes · next 7 days: Thermodynamics I Mon 16 Nov 19:00, SAT Math Wed 18 Nov 10:00$/);
  assert.match(flat(all), /TODAY · MON 16 NOV/);
  assert.doesNotMatch(flat(all), /IGCSE Physics|Past class/);
  const mine = await w.dm('Kiak', 'my classes');
  assert.match(mine[0].altText, /Kiak's classes · 14 days: Thermodynamics I Mon 16 Nov 19:00, Thermodynamics I Fri 27 Nov 19:00/);
  assert.doesNotMatch(flat(mine), /SAT Math/);
  assert.match(flat(await w.dm('Jai', 'my classes')), /You have no classes/);
  assert.equal(w.provider.calls.length, 0);
  assert.deepEqual(classesBetween((await w.store.snapshot()).docs, '2026-11-16', '2026-11-22').map((c) => c.id), ['c1', 'c2']);
});

test('morning: a tutor teaching today gets the class in the digest, even with no task reminders', async () => {
  const w = await withClasses();
  await w.scheduler.tick({ now: new Date('2026-11-16T01:30:00Z'), force: 'morning' });
  const kiak = w.client.pushes.filter((p) => p.to === 'Ukiak');
  assert.equal(kiak.length, 1);
  assert.match(flat(kiak), /Teaching today/);
  assert.match(flat(kiak), /19:00 · Thermodynamics I/);
  assert.equal(w.client.pushes.filter((p) => p.to === 'Ubest').length, 0, 'Best teaches Wednesday, nothing today');
});

test('Monday post lists this week\'s classes (same push, no extra)', async () => {
  const w = await withClasses();
  await w.scheduler.tick({ now: new Date('2026-11-16T02:00:00Z'), force: 'monday' });
  const group = w.client.pushes.filter((p) => p.to === 'Cteam');
  assert.equal(group.length, 1);
  assert.match(flat(group), /📚 Classes this week/);
  assert.match(flat(group), /Wed 18 Nov 10:00 · SAT Math \(LITE\) · Best/);
});

test('decisions: open ones first; saved meeting decisions land on the Decisions page as agreed', async () => {
  const w = await makeWorld();
  await w.store.write({ op: 'set', path: 'decisions/d1', data: { title: 'Thermo I price', area: 'Courses', status: 'open', owner: 'Best', due: '2026-11-25' } });
  await w.store.write({ op: 'set', path: 'decisions/d2', data: { title: 'Voting rules', area: 'Ownership', status: 'open' } });
  let r = await w.say('Jai', 'decisions');
  assert.match(r[0].altText, /^Decisions: 2 open/);
  assert.match(flat(r), /Thermo I price/);
  assert.match(flat(r), /decide by Wed 25 Nov/);

  w.provider.next({ is_meeting: true, title: 'Partner meeting', date_text: '', attendees: ['Best', 'Jai'], summary: 'Pricing.', decisions: ['Max 12 students per group'], action_items: [], open_questions: [] });
  const card = await w.dm('Jai', 'meeting notes: we agreed max 12 students per group');
  await w.tap('Jai', postbacks(card).find((d) => d.startsWith('a=mok')));
  const { agreed, open } = decisionLists((await w.store.snapshot()).docs);
  assert.equal(open.length, 2);
  assert.deepEqual(agreed.map((d) => [d.title, d.status, d.source]), [['Max 12 students per group', 'agreed', 'line']]);
  r = await w.dm('Jai', 'decisions');
  assert.match(flat(r), /Agreed lately/);
  assert.match(flat(r), /Max 12 students per group/);
});
