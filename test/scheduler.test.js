import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, flat } from './helpers.js';

const at = (iso) => new Date(iso);

test('morning digest: one push per person, each reminder only once', async () => {
  const w = await makeWorld();
  await w.team.createTasks([
    { title: 'A due in 5', owners: ['Best'], due: '2026-11-21' },
    { title: 'B due in 3', owners: ['Best'], due: '2026-11-19' },
    { title: 'C due today', owners: ['Best', 'Kiak'], due: '2026-11-16' },
    { title: 'D due in 2 (no reminder)', owners: ['Best'], due: '2026-11-18' },
  ], 'Jai');
  const r = await w.scheduler.tick({ now: at('2026-11-16T01:30:00Z') }); // 08:30 Bangkok
  assert.deepEqual(r.ran.map((x) => x.slot), ['morning']);
  const toBest = w.client.pushes.filter((p) => p.to === 'Ubest');
  assert.equal(toBest.length, 1, 'one combined push');
  assert.ok(toBest[0].messages.length <= 2);
  const s = flat(toBest[0]);
  for (const t of ['A due in 5', 'B due in 3', 'C due today']) assert.match(s, new RegExp(t));
  assert.equal(w.client.pushes.filter((p) => p.to === 'Ukiak').length, 1);
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
  await w.team.createTasks([{ title: 'Logo', owners: ['Kiak'], due: '2026-11-17' }], 'Jai');
  await w.scheduler.tick({ now: at('2026-11-20T01:30:00Z') });
  const g = w.client.pushes.filter((p) => p.to === 'Cteam');
  assert.equal(g.length, 1);
  assert.equal(g[0].messages[0].type, 'textV2');
  assert.equal(g[0].messages[0].substitution.m0.mentionee.userId, 'Ukiak');
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
  assert.match(flat(mon), /This week's plan/);
  assert.match(flat(mon), /Best: mockup/);
  assert.match(flat(mon), /Prototype review/);

  await w.dm('Best', 'mockup done');
  w.client.pushes.length = 0;
  await w.scheduler.tick({ now: at('2026-11-16T11:30:00Z') }); // 18:30
  assert.match(flat(w.client.pushes), /✓ Best · mockup/);

  w.setNow('2026-11-20T10:30:00Z');
  w.client.pushes.length = 0;
  await w.scheduler.tick({ now: at('2026-11-20T10:30:00Z') }); // Fri 17:30
  assert.match(flat(w.client.pushes), /Week wrap-up/);
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

test('push budget follows LINE\'s own count and limit, never ours alone', async () => {
  const w = await makeWorld();
  w.client.lineQuota = { limit: 300, used: 268 }; // e.g. a broadcast sent from OA Manager
  assert.equal(await w.line.push('Ubest', { type: 'text', text: 'x' }), true, '269 <= 270');
  w.line.lineCount = null;
  w.client.lineQuota = { limit: 300, used: 269 };
  assert.equal(await w.line.push('Cteam', { type: 'text', text: 'x' }), false, '272 > 90% even though our count is 1');
  w.line.lineCount = null;
  w.client.lineQuota = { limit: 200, used: 10 }; // LINE's quota is lower than PUSH_MONTHLY_LIMIT
  assert.equal((await w.line.quota()).limit, 200);
  w.line.lineCount = null;
  w.client.lineQuota = { limit: 300, used: 299 };
  assert.equal(await w.line.push('Ubest', { type: 'text', text: 'x' }, { essential: true }), true, 'essential may use the last push');
  assert.equal(await w.line.push('Ubest', { type: 'text', text: 'x' }, { essential: true }), false, 'cached LINE count went up by 1: 300 is the hard stop');
});

test('18:00 round-up is low priority: it waits when the month is ahead of pace', async () => {
  const w = await makeWorld(); // 16 Nov: pace = 90% of 300 x 16/30 = 144
  const six = new Date('2026-11-16T11:00:00Z'); // 18:00 Bangkok
  w.setNow(six);
  await w.bot.queueNotice('✓ Jai · mockup');
  await w.db.kvSet(w.line.monthKey(), 142);
  let r = await w.scheduler.tick({ now: six });
  assert.equal(r.ran[0].sent, false, '142 + 3 > 144');
  assert.deepEqual(await w.db.kvGet('group_notices'), ['✓ Jai · mockup'], 'kept for the next free reply');
  assert.equal(await w.line.push('Cteam', { type: 'text', text: 'x' }), true, 'normal pushes still go (145 <= 270)');
  await w.db.kvSet(w.line.monthKey(), 100);
  r = await w.scheduler.tick({ now: six, force: 'evening' });
  assert.equal(r.ran[0].sent, true);
  assert.match(flat(w.client.pushes.at(-1)), /mockup/);
});
