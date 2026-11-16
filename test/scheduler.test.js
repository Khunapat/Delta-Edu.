import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, flat } from './helpers.js';

const at = (iso) => new Date(iso);

test('morning digest: one push per person, each reminder only once', async () => {
  const w = await makeWorld();
  await w.team.createTasks([
    { title: 'A due in 5', owners: ['Best'], due: '2026-11-21' },
    { title: 'B due in 3', owners: ['Best'], due: '2026-11-19' },
    { title: 'C due today', owners: ['Best', 'Bonnie'], due: '2026-11-16' },
    { title: 'D due in 2 (no reminder)', owners: ['Best'], due: '2026-11-18' },
  ], 'Jai');
  const r = await w.scheduler.tick({ now: at('2026-11-16T01:30:00Z') }); // 08:30 Bangkok
  assert.deepEqual(r.ran.map((x) => x.slot), ['morning']);
  const toBest = w.client.pushes.filter((p) => p.to === 'Ubest');
  assert.equal(toBest.length, 1, 'one combined push');
  assert.ok(toBest[0].messages.length <= 2);
  const s = flat(toBest[0]);
  for (const t of ['A due in 5', 'B due in 3', 'C due today']) assert.match(s, new RegExp(t));
  assert.equal(w.client.pushes.filter((p) => p.to === 'Ubonnie').length, 1);
  assert.equal(w.client.pushes.filter((p) => p.to === 'Ujai').length, 0, 'nothing for Jai');

  // Same slot again the same day: nothing.
  await w.scheduler.tick({ now: at('2026-11-16T01:40:00Z') });
  assert.equal(w.client.pushes.length, 2);
  // Next day: "new task" and today's reminders are not repeated; A is now 4 days away -> nothing for Best.
  w.setNow('2026-11-17T01:30:00Z');
  w.client.pushes.length = 0;
  await w.scheduler.tick({ now: at('2026-11-17T01:30:00Z') });
  const best2 = w.client.pushes.filter((p) => p.to === 'Ubest');
  assert.equal(best2.length, 1);
  assert.match(flat(best2[0]), /C due today/); // overdue 1 day
  assert.doesNotMatch(flat(best2[0]), /A due in 5/);
});

test('overdue >= 2 days: one gentle group tag, once per task', async () => {
  const w = await makeWorld();
  w.setNow('2026-11-20T01:30:00Z');
  await w.team.createTasks([{ title: 'โลโก้', owners: ['Bonnie'], due: '2026-11-17' }], 'Jai');
  await w.scheduler.tick({ now: at('2026-11-20T01:30:00Z') });
  const g = w.client.pushes.filter((p) => p.to === 'Cteam');
  assert.equal(g.length, 1);
  assert.equal(g[0].messages[0].type, 'textV2');
  assert.equal(g[0].messages[0].substitution.m0.mentionee.userId, 'Ubonnie');
  w.setNow('2026-11-21T01:30:00Z');
  await w.scheduler.tick({ now: at('2026-11-21T01:30:00Z') });
  assert.equal(w.client.pushes.filter((p) => p.to === 'Cteam').length, 1, 'not tagged twice');
});

test('Monday plan, Friday wrap-up and evening ✓ round-up go to the group', async () => {
  const w = await makeWorld();
  await w.team.createTasks([{ title: 'mockup', owners: ['Best'], due: '2026-11-20' }], 'Jai');
  await w.db.insert('Milestones', { id: 'm1', title: 'Prototype review', date: '2026-11-21', stream: 'Product', done: '' });
  await w.scheduler.tick({ now: at('2026-11-16T02:30:00Z') }); // Mon 09:30
  const mon = w.client.pushes.find((p) => p.to === 'Cteam');
  assert.match(flat(mon), /แผนสัปดาห์นี้/);
  assert.match(flat(mon), /Best: mockup/);
  assert.match(flat(mon), /Prototype review/);

  await w.dm('Best', 'mockup เสร็จแล้ว');
  w.client.pushes.length = 0;
  await w.scheduler.tick({ now: at('2026-11-16T11:30:00Z') }); // 18:30
  assert.match(flat(w.client.pushes), /✓ Best · mockup/);

  w.setNow('2026-11-20T10:30:00Z');
  w.client.pushes.length = 0;
  await w.scheduler.tick({ now: at('2026-11-20T10:30:00Z') }); // Fri 17:30
  assert.match(flat(w.client.pushes), /สรุปสัปดาห์/);
  assert.match(flat(w.client.pushes), /mockup \(Best\)/);
});

test('push budget: group push costs one per member and stops near the limit', async () => {
  const w = await makeWorld();
  w.line.limit = 10;
  await w.db.kvSet(w.line.monthKey(), 7);
  const ok = await w.line.push('Cteam', { type: 'text', text: 'x' });
  assert.equal(ok, false, '7 + 3 > 90% of 10');
  assert.equal(await w.line.push('Cteam', { type: 'text', text: 'x' }, { essential: true }), true);
  assert.equal(await w.db.kvGet(w.line.monthKey()), 10);
  assert.equal(await w.line.push('Ubest', { type: 'text', text: 'x' }, { essential: true }), false, 'hard limit');
});
