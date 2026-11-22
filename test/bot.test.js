import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, flat, postbacks } from './helpers.js';
import { AiResting } from '../src/ai/index.js';

test('linking: only team names, one LINE account per name', async () => {
  const w = await makeWorld({ link: false });
  assert.match(flat(await w.dm('Ustranger', 'my tasks')), /I am/);
  assert.match(flat(await w.dm('Ustranger', 'I am Somchai')), /can't find/);
  assert.match(flat(await w.dm('Jai', "I'm khun jai")), /Linked/);
  assert.match(flat(await w.dm('Ustranger', 'I am Jai')), /already linked to another LINE account/);
  const m = await w.team.memberByName('Jai');
  assert.equal(m.line_user_id, 'Ujai');
});

test('the old Thai link phrase still works', async () => {
  const w = await makeWorld({ link: false });
  assert.match(flat(await w.dm('Jai', 'ฉันคือ Jai')), /Linked/);
});

test('group: only an admin can register; normal chatter is ignored', async () => {
  const w = await makeWorld({ link: false });
  assert.match(flat(await w.dm('Best', 'I am Best')), /team group isn't set up yet/, 'only an admin links before the group exists');
  assert.match(flat(await w.say('Best', 'use this group')), /admin/i);
  await w.dm('Jai', 'I am Jai');
  assert.match(flat(await w.say('Jai', 'use this group')), /This is now the team group/);
  const before = w.client.replies.length;
  await w.say('Best', 'lunch anyone?', false);
  assert.equal(w.client.replies.length, before, 'no reply without a mention');
  assert.equal(w.provider.calls.length, 0, 'no AI without a mention');
});

test('create task in group: card first, saved only after confirm, assignee gets a private DM', async () => {
  const w = await makeWorld();
  w.provider.next({ intent: 'create_tasks', tasks: [{ title: 'Thermo I slides', owners: ['Kiakky', 'Best'], due_text: 'friday', due_date: '2026-11-20', stream: 'Uni', priority: 'med' }] });
  const card = await w.say('Jai', 'Kiakky and Best: Thermo I slides by friday');
  assert.match(flat(card), /TO CONFIRM/);
  assert.match(flat(card), /Kiak, Best/, 'alias resolved to the nickname');
  assert.match(flat(card), /Fri 20 Nov/);
  assert.equal((await w.team.tasks()).length, 0, 'nothing saved before confirm');

  const ok = postbacks(card).find((d) => d.startsWith('a=dok'));
  const done = await w.tap('Best', ok, undefined, 'group');
  assert.match(flat(done), /Added 1 task/);
  const tasks = await w.team.tasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].owner, 'Kiak, Best');
  assert.equal(tasks[0].due, '2026-11-20');
  assert.equal(tasks[0].stream, 'Uni');
  // Kiak gets a DM; Best confirmed it so does not.
  assert.deepEqual(w.client.pushes.map((p) => p.to), ['Ukiak']);
  // Tapping confirm again does nothing.
  assert.match(flat(await w.tap('Best', ok, undefined, 'group')), /already confirmed or cancelled/);
  assert.equal((await w.team.tasks()).length, 1);
});

test('brand tags: the AI word is normalised; unclear means Both; the Brand button offers Uni / LITE / Both', async () => {
  const w = await makeWorld();
  w.provider.next({ intent: 'create_tasks', tasks: [
    { title: 'SAT mock test', owners: ['Jai'], due_text: 'friday', due_date: '2026-11-20', stream: 'sat', priority: 'med' },
    { title: 'Register the business', owners: ['Jai'], due_text: 'friday', due_date: '2026-11-20', stream: '', priority: 'med' },
  ] });
  const card = await w.dm('Jai', 'SAT mock test and register the business, both friday, me');
  assert.match(flat(card), /"text":"LITE"/);
  assert.match(flat(card), /"text":"Both"/);
  const brandBtn = postbacks(card).find((d) => d.startsWith('a=dst') && d.endsWith('i=1'));
  const pick = await w.tap('Jai', brandBtn);
  const uni = postbacks(pick).find((d) => d.startsWith('a=dss') && d.endsWith('v=Uni'));
  assert.ok(uni);
  await w.tap('Jai', uni);
  await w.tap('Jai', postbacks(card).find((d) => d.startsWith('a=dok')));
  const tasks = await w.team.tasks();
  assert.deepEqual(tasks.map((t) => t.stream), ['LITE', 'Uni']);
});

test('never guesses: unknown owner and ambiguous date are asked', async () => {
  const w = await makeWorld();
  w.provider.next({ intent: 'create_tasks', tasks: [{ title: 'Find a GED tutor', owners: ['Somchai'], due_text: 'next week', due_date: '2026-11-27', stream: 'LITE', priority: 'high' }] });
  const msgs = await w.say('Jai', 'Somchai find a GED tutor next week');
  assert.match(flat(msgs), /Somchai is not on the team list/);
  assert.match(flat(msgs), /Which day is \\"next week\\"/);
  assert.match(flat(msgs), /No due date yet/);
  const pick = postbacks(msgs).find((d) => d.startsWith('a=dsd') && d.endsWith('2026-11-27'));
  const card = await w.tap('Jai', pick, undefined, 'group');
  assert.match(flat(card), /Fri 27 Nov/);
  // confirm without owner -> asked to pick
  const ok = postbacks(card).find((d) => d.startsWith('a=dok'));
  assert.match(flat(await w.tap('Jai', ok, undefined, 'group')), /Nobody is on/);
  const best = postbacks(w.client.lastReply()).find((d) => d.includes('n=Best'));
  await w.tap('Jai', best, undefined, 'group');
  await w.tap('Jai', ok, undefined, 'group');
  const [t] = await w.team.tasks();
  assert.equal(t.owner, 'Best');
  assert.equal(t.due, '2026-11-27');
});

test('1:1 updates without AI: done, postpone, blocked; group sees ✓ and the blocked line', async () => {
  const w = await makeWorld();
  await w.team.createTasks([
    { title: 'Thermo I slides', owners: ['Kiak'], due: '2026-11-20' },
    { title: 'IGCSE worksheet', owners: ['Kiak'], due: '2026-11-25' },
  ], 'Jai');
  const done = await w.dm('Kiak', 'thermo slides done');
  assert.equal(done[0].type, 'flex', 'a card, not plain text');
  assert.match(done[0].altText, /^✓ Done: Thermo I slides/);
  const moved = await w.dm('Kiak', 'push the IGCSE worksheet to next friday');
  assert.match(moved[0].altText, /^📅 Moved: IGCSE worksheet/);
  assert.match(flat(moved), /Fri 27 Nov/);
  assert.match(flat(moved), /was Wed 25 Nov/);
  await w.dm('Kiak', 'blocked, waiting for the past papers'); // only one open task left
  const tasks = await w.team.tasks();
  assert.equal(tasks.find((t) => t.title === 'Thermo I slides').status, 'done');
  const b = tasks.find((t) => t.title === 'IGCSE worksheet');
  assert.equal(b.status, 'blocked');
  assert.equal(b.due, '2026-11-27');
  assert.match(b.blocker, /past papers/);
  assert.equal(w.provider.calls.length, 0, 'no AI used');
  // blocked line pushed to the group right away
  assert.equal(w.client.pushes.at(-1).to, 'Cteam');
  assert.match(flat(w.client.pushes.at(-1)), /who can help/);
  // ✓ rides on the next free group reply
  const r = await w.say('Best', 'team');
  assert.match(flat(r), /✓ Kiak · Thermo I slides/);
  assert.equal(await w.db.kvGet('group_notices', null), null);
});

test('buttons: date picker postpones; only owners or admin can change a task', async () => {
  const w = await makeWorld();
  const [t] = await w.team.createTasks([{ title: 'Price list', owners: ['Best'], due: '2026-11-18' }], 'Jai');
  assert.match(flat(await w.tap('Kiak', `a=td&t=${t.id}`)), /isn't your task/);
  await w.tap('Best', `a=tp&t=${t.id}`, { date: '2026-11-24' });
  assert.equal((await w.team.task(t.id)).due, '2026-11-24');
  await w.tap('Jai', `a=td&t=${t.id}`); // admin may
  assert.equal((await w.team.task(t.id)).status, 'done');
});

test('ambiguous update asks which task with buttons', async () => {
  const w = await makeWorld();
  await w.team.createTasks([
    { title: 'SAT deck A', owners: ['Best'], due: '2026-11-20' },
    { title: 'SAT deck B', owners: ['Best'], due: '2026-11-21' },
  ], 'Jai');
  const r = await w.dm('Best', 'sat deck done');
  assert.match(flat(r), /Which task is done/);
  const pb = postbacks(r).filter((d) => d.startsWith('a=pick'));
  assert.equal(pb.length, 2);
  await w.tap('Best', pb[1]);
  assert.equal((await w.team.tasks()).filter((t) => t.status === 'done').length, 1);
});

test('"not done yet" is not taken as done', async () => {
  const w = await makeWorld();
  await w.team.createTasks([{ title: 'SAT deck', owners: ['Best'], due: '2026-11-20' }], 'Jai');
  w.provider.next({ intent: 'other', answer: 'Okay, keep going!' });
  await w.dm('Best', 'sat deck not done yet');
  assert.equal((await w.team.tasks())[0].status, 'todo');
  assert.equal(w.provider.calls.length, 1, 'went to the AI instead');
});

test('AI resting: friendly message, commands still work', async () => {
  const w = await makeWorld();
  w.provider.next(new AiResting(new Date('2026-11-16T08:00:00Z')));
  assert.match(flat(await w.dm('Best', 'can you sum up the SAT launch plan?')), /AI is resting/);
  assert.match(flat(await w.dm('Best', 'my tasks')), /No open tasks/);
});

test('questions answered from data only; phone numbers never sent to AI; replies in English', async () => {
  const w = await makeWorld();
  await w.db.update('Members', 'nickname', 'Best', { phone: '0812345678', email: 'best@example.com' });
  w.provider.next({ intent: 'question', answer: 'Nothing on that yet. You can add it to the board Notes.' });
  assert.match(flat(await w.say('Jai', 'what price did we set for Thermo I?')), /Nothing on that yet/);
  const sent = w.provider.calls.at(-1).text;
  assert.doesNotMatch(sent, /0812345678|best@example/);
  const sys = w.provider.calls.at(-1).system;
  assert.match(sys, /δelta Edu\./);
  assert.match(sys, /ALWAYS casual, short, plain English/);
  assert.doesNotMatch(sys, /NORSE|herbal|FDA/);
});

test('blocker typed after tapping Blocked', async () => {
  const w = await makeWorld();
  const [t] = await w.team.createTasks([{ title: 'Record Thermo intro video', owners: ['Jai'], due: '2026-11-19' }], 'Jai');
  assert.match(flat(await w.tap('Jai', `a=tb&t=${t.id}`)), /What's blocking/);
  await w.dm('Jai', 'mic is broken');
  const x = await w.team.task(t.id);
  assert.equal(x.status, 'blocked');
  assert.equal(x.blocker, 'mic is broken');
});

test('team only: before the group exists only an admin links; after, only people in the team group', async () => {
  const w = await makeWorld({ link: false });
  w.client.groupMembers = new Map([['Cteam', new Set(['Ujai', 'Ubest', 'Ukiak'])]]);
  assert.match(flat(await w.dm('Ustranger', 'I am Best')), /team group isn't set up yet/);
  assert.equal((await w.team.memberByName('Best')).line_user_id, '');
  assert.match(flat(await w.dm('Jai', 'I am J')), /Linked/, 'admin links by alias');
  assert.match(flat(await w.say('Jai', 'use this group')), /This is now the team group/);
  assert.match(flat(await w.dm('Ustranger', 'I am Kiak')), /Only people in the δelta Edu\. team group/);
  assert.equal((await w.team.memberByName('Kiak')).line_user_id, '', 'stranger not linked');
  assert.match(flat(await w.dm('Ustranger', 'team')), /I am/, 'stranger sees nothing');
  assert.match(flat(await w.dm('Kiak', 'I am Kiakky')), /Linked\. Hi Kiak/);
  // LINE can't be asked: refuse for now instead of letting anyone in
  w.client.getGroupMemberProfile = async () => { throw Object.assign(new Error('boom'), { status: 500 }); };
  assert.match(flat(await w.dm('Best', 'I am Best')), /Try again/);
  assert.equal((await w.team.memberByName('Best')).line_user_id, '');
});

test('the team group cannot be moved from another group', async () => {
  const w = await makeWorld();
  await w.bot.handle({ type: 'message', replyToken: 'r', source: { type: 'group', groupId: 'Cother', userId: 'Ujai' },
    message: { type: 'text', text: '@Delta use this group', mention: { mentionees: [{ index: 0, length: 6, isSelf: true, type: 'user' }] } } });
  assert.match(flat(w.client.lastReply()), /already a team group/);
  assert.equal(await w.db.kvGet('team_group'), 'Cteam');
});

test('a typed answer only counts in the chat where the bot asked', async () => {
  const w = await makeWorld();
  const [t] = await w.team.createTasks([{ title: 'Record Thermo intro video', owners: ['Jai'], due: '2026-11-19' }], 'Jai');
  await w.tap('Jai', `a=tb&t=${t.id}`); // asked in 1:1
  const before = w.client.replies.length;
  await w.say('Jai', 'lunch anyone?', false); // normal group chatter
  assert.equal(w.client.replies.length, before, 'group chatter ignored');
  assert.equal((await w.team.task(t.id)).status, 'todo');
  await w.dm('Jai', 'mic is broken');
  assert.equal((await w.team.task(t.id)).blocker, 'mic is broken');
});

test('TEAM_SEED carries aliases and roles', async () => {
  const w = await makeWorld({ link: false });
  const ms = await w.team.members();
  assert.deepEqual(ms.map((m) => [m.nickname, m.aliases, m.role, m.admin]), [
    ['Jai', ['J'], 'admin', true], ['Best', [], 'founder', false], ['Kiak', ['Kiakky'], 'tutor', false],
  ]);
  assert.equal((await w.team.memberByName('khun kiakky')).nickname, 'Kiak');
});

test('admin who has not linked yet is told to link in the 1:1 chat first; "I am" in the group points there', async () => {
  const w = await makeWorld({ link: false });
  assert.match(flat(await w.say('Jai', 'use this group')), /1:1 chat.*I am/);
  assert.match(flat(await w.say('Jai', 'I am Jai', false)), /Link your account in a 1:1 chat/, 'typed without @Delta');
  assert.match(flat(await w.say('Jai', 'I am Jai')), /Link your account in a 1:1 chat/, 'typed with @Delta');
  assert.equal((await w.team.memberByName('Jai')).line_user_id, '', 'no linking from the group');
  await w.dm('Jai', 'I am J');
  assert.match(flat(await w.say('Jai', 'use this group')), /This is now the team group/);
  const before = w.client.replies.length;
  await w.say('Jai', 'I am the hungriest person in this group', false);
  assert.equal(w.client.replies.length, before, 'linked people chatting "I am ..." are ignored');
});

test('outcomes are cards; buttons in group cards carry @Delta so the bot hears them', async () => {
  const w = await makeWorld({ link: false });
  const linked = await w.dm('Jai', 'I am J');
  assert.deepEqual(linked.map((m) => m.type), ['flex', 'flex']);
  assert.match(linked[0].altText, /Linked\. Hi Jai/);
  const reg = await w.say('Jai', 'use this group');
  assert.equal(reg[0].type, 'flex');
  assert.match(flat(reg), /"text":"@Delta team"/);

  const [t] = await w.team.createTasks([{ title: 'Record Thermo intro video', owners: ['Jai'], due: '2026-11-19' }], 'Jai');
  await w.tap('Jai', `a=tbr&t=${t.id}&r=${encodeURIComponent('mic is broken')}`);
  const push = w.client.pushes.at(-1);
  assert.equal(push.to, 'Cteam');
  assert.equal(push.messages[0].type, 'flex');
  assert.match(push.messages[0].altText, /^🚧 Blocked: Record Thermo intro video · Jai is blocked/);

  w.provider.next(new AiResting(new Date('2026-11-17T08:00:00Z')));
  const resting = await w.say('Jai', 'who is doing what today?');
  assert.equal(resting[0].type, 'flex');
  assert.match(flat(resting), /"text":"@Delta my tasks"/);
  assert.match(resting[0].altText, /AI is resting/);
});

test('no Thai text in any card or reply the bot sends', async () => {
  const w = await makeWorld();
  await w.team.createTasks([{ title: 'Thermo I slides', owners: ['Jai'], due: '2026-11-20' }], 'Jai');
  const all = [];
  for (const cmd of ['help', 'my tasks', 'today', 'team', 'settings', 'meeting', 'board']) all.push(await w.dm('Jai', cmd));
  all.push(await w.say('Jai', 'help'));
  assert.doesNotMatch(flat(all), /[฀-๿]/);
  assert.doesNotMatch(flat(all), /NORSE|Norse/);
});
