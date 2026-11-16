import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, flat, postbacks } from './helpers.js';
import { AiResting } from '../src/ai/index.js';

test('linking: only team names, one LINE account per name', async () => {
  const w = await makeWorld({ link: false });
  assert.match(flat(await w.dm('Ustranger', 'งานฉัน')), /ฉันคือ/);
  assert.match(flat(await w.dm('Ustranger', 'ฉันคือ Somchai')), /ไม่เจอ/);
  assert.match(flat(await w.dm('Jai', 'ฉันคือ พี่jai')), /เชื่อมแล้ว/);
  assert.match(flat(await w.dm('Ustranger', 'ฉันคือ Jai')), /เชื่อมกับ LINE อีกบัญชี/);
  const m = await w.team.memberByName('Jai');
  assert.equal(m.line_user_id, 'Ujai');
});

test('group: only an admin can register; normal chatter is ignored', async () => {
  const w = await makeWorld({ link: false });
  assert.match(flat(await w.dm('Best', 'ฉันคือ Best')), /ยังไม่ได้ตั้งกลุ่มทีม/, 'only an admin links before the group exists');
  assert.match(flat(await w.say('Best', 'ใช้กลุ่มนี้')), /admin/);
  await w.dm('Jai', 'ฉันคือ Jai');
  assert.match(flat(await w.say('Jai', 'ใช้กลุ่มนี้')), /ตั้งกลุ่มนี้เป็นกลุ่มทีมแล้ว/);
  const before = w.client.replies.length;
  await w.say('Best', 'กินข้าวยัง', false);
  assert.equal(w.client.replies.length, before, 'no reply without a mention');
  assert.equal(w.provider.calls.length, 0, 'no AI without a mention');
});

test('create task in group: card first, saved only after confirm, assignee gets a private DM', async () => {
  const w = await makeWorld();
  w.provider.next({ intent: 'create_tasks', tasks: [{ title: 'mockup กล่อง', owners: ['บอนนี่', 'Best'], due_text: 'ศุกร์', due_date: '2026-11-20', stream: 'Branding', priority: 'med' }] });
  // "บอนนี่" is an alias
  await w.db.update('Members', 'nickname', 'Bonnie', { aliases: 'บอนนี่' });
  const card = await w.say('Jai', 'บอนนี่ กับ Best ทำ mockup กล่อง ส่งศุกร์');
  assert.match(flat(card), /รอยืนยัน/);
  assert.match(flat(card), /Bonnie, Best/);
  assert.match(flat(card), /ศ\. 20 พ\.ย\./);
  assert.equal((await w.team.tasks()).length, 0, 'nothing saved before confirm');

  const ok = postbacks(card).find((d) => d.startsWith('a=dok'));
  const done = await w.tap('Best', ok, undefined, 'group');
  assert.match(flat(done), /เพิ่มงานแล้ว/);
  const tasks = await w.team.tasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].owner, 'Bonnie, Best');
  assert.equal(tasks[0].due, '2026-11-20');
  assert.equal(tasks[0].stream, 'Branding');
  // Bonnie gets a DM; Best confirmed it so does not.
  assert.deepEqual(w.client.pushes.map((p) => p.to), ['Ubonnie']);
  // Tapping confirm again does nothing.
  assert.match(flat(await w.tap('Best', ok, undefined, 'group')), /ยืนยัน\/ยกเลิกไปแล้ว/);
  assert.equal((await w.team.tasks()).length, 1);
});

test('never guesses: unknown owner and ambiguous date are asked', async () => {
  const w = await makeWorld();
  w.provider.next({ intent: 'create_tasks', tasks: [{ title: 'หา supplier ขวด', owners: ['Somchai'], due_text: 'อาทิตย์หน้า', due_date: '2026-11-29', stream: '', priority: 'high' }] });
  const msgs = await w.say('Jai', 'Somchai หา supplier ขวด อาทิตย์หน้า');
  assert.match(flat(msgs), /ไม่เจอชื่อ Somchai/);
  assert.match(flat(msgs), /หมายถึงวันไหน/);
  assert.match(flat(msgs), /ยังไม่มีวันส่ง/);
  const pick = postbacks(msgs).find((d) => d.startsWith('a=dsd') && d.endsWith('2026-11-27'));
  const card = await w.tap('Jai', pick, undefined, 'group');
  assert.match(flat(card), /ศ\. 27 พ\.ย\./);
  // confirm without owner -> asked to pick
  const ok = postbacks(card).find((d) => d.startsWith('a=dok'));
  assert.match(flat(await w.tap('Jai', ok, undefined, 'group')), /ยังไม่มีคนทำ/);
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
    { title: 'mockup กล่อง', owners: ['Bonnie'], due: '2026-11-20' },
    { title: 'สั่งตัวอย่างขวด', owners: ['Bonnie'], due: '2026-11-25' },
  ], 'Jai');
  const done = await w.dm('Bonnie', 'mockup เสร็จแล้ว');
  assert.equal(done[0].type, 'flex', 'a card, not plain text');
  assert.match(done[0].altText, /^✓ เสร็จแล้ว: mockup กล่อง/);
  const moved = await w.dm('Bonnie', 'ขอเลื่อนสั่งตัวอย่างขวดเป็นศุกร์หน้า');
  assert.match(moved[0].altText, /^📅 เลื่อนวันส่งแล้ว: สั่งตัวอย่างขวด/);
  assert.match(flat(moved), /ศ\. 27 พ\.ย\./);
  assert.match(flat(moved), /จากเดิม พ\. 25 พ\.ย\./);
  await w.dm('Bonnie', 'ติด supplier ยังไม่ตอบ'); // only one open task left
  const tasks = await w.team.tasks();
  assert.equal(tasks.find((t) => t.title === 'mockup กล่อง').status, 'done');
  const b = tasks.find((t) => t.title === 'สั่งตัวอย่างขวด');
  assert.equal(b.status, 'blocked');
  assert.equal(b.due, '2026-11-27');
  assert.match(b.blocker, /supplier/);
  assert.equal(w.provider.calls.length, 0, 'no AI used');
  // blocked line pushed to the group right away
  assert.equal(w.client.pushes.at(-1).to, 'Cteam');
  assert.match(flat(w.client.pushes.at(-1)), /ใครช่วยได้บ้าง/);
  // ✓ rides on the next free group reply
  const r = await w.say('Best', 'งานทีม');
  assert.match(flat(r), /✓ Bonnie · mockup กล่อง/);
  assert.equal(await w.db.kvGet('group_notices', null), null);
});

test('buttons: date picker postpones; only owners or admin can change a task', async () => {
  const w = await makeWorld();
  const [t] = await w.team.createTasks([{ title: 'ราคาต้นทุน', owners: ['Best'], due: '2026-11-18' }], 'Jai');
  assert.match(flat(await w.tap('Bonnie', `a=td&t=${t.id}`)), /ไม่ใช่ของคุณ/);
  await w.tap('Best', `a=tp&t=${t.id}`, { date: '2026-11-24' });
  assert.equal((await w.team.task(t.id)).due, '2026-11-24');
  await w.tap('Jai', `a=td&t=${t.id}`); // admin may
  assert.equal((await w.team.task(t.id)).status, 'done');
});

test('ambiguous update asks which task with buttons', async () => {
  const w = await makeWorld();
  await w.team.createTasks([
    { title: 'mockup กล่อง A', owners: ['Best'], due: '2026-11-20' },
    { title: 'mockup กล่อง B', owners: ['Best'], due: '2026-11-21' },
  ], 'Jai');
  const r = await w.dm('Best', 'mockup เสร็จแล้ว');
  assert.match(flat(r), /งานไหนที่เสร็จ/);
  const pb = postbacks(r).filter((d) => d.startsWith('a=pick'));
  assert.equal(pb.length, 2);
  await w.tap('Best', pb[1]);
  assert.equal((await w.team.tasks()).filter((t) => t.status === 'done').length, 1);
});

test('AI resting: friendly message, commands still work', async () => {
  const w = await makeWorld();
  w.provider.next(new AiResting(new Date('2026-11-16T08:00:00Z')));
  assert.match(flat(await w.dm('Best', 'ช่วยสรุปเรื่อง supplier หน่อย')), /AI พักอยู่/);
  assert.match(flat(await w.dm('Best', 'งานฉัน')), /ไม่มีงานค้าง/);
});

test('questions answered from data only; phone numbers never sent to AI', async () => {
  const w = await makeWorld();
  await w.db.update('Members', 'nickname', 'Best', { phone: '0812345678', email: 'best@example.com' });
  w.provider.next({ intent: 'question', answer: 'ยังไม่มีบันทึกเรื่อง supplier ที่ยังไม่ตอบ' });
  assert.match(flat(await w.say('Jai', 'supplier ไหนยังไม่ตอบ')), /ยังไม่มีบันทึก/);
  const sent = w.provider.calls.at(-1).text;
  assert.doesNotMatch(sent, /0812345678|best@example/);
  assert.match(w.provider.calls.at(-1).system, /health or medical claims/);
});

test('blocker typed after tapping ติดอยู่', async () => {
  const w = await makeWorld();
  const [t] = await w.team.createTasks([{ title: 'ถ่ายรูปสินค้า', owners: ['Jai'], due: '2026-11-19' }], 'Jai');
  assert.match(flat(await w.tap('Jai', `a=tb&t=${t.id}`)), /ติดอะไรอยู่/);
  await w.dm('Jai', 'กล้องเสีย');
  const x = await w.team.task(t.id);
  assert.equal(x.status, 'blocked');
  assert.equal(x.blocker, 'กล้องเสีย');
});

test('team only: before the group exists only an admin links; after, only people in the team group', async () => {
  const w = await makeWorld({ link: false });
  w.client.groupMembers = new Map([['Cteam', new Set(['Ujai', 'Ubest', 'Ubonnie'])]]);
  assert.match(flat(await w.dm('Ustranger', 'ฉันคือ Best')), /ยังไม่ได้ตั้งกลุ่มทีม/);
  assert.equal((await w.team.memberByName('Best')).line_user_id, '');
  assert.match(flat(await w.dm('Jai', 'ฉันคือ เจ')), /เชื่อมแล้ว/, 'admin links by alias');
  assert.match(flat(await w.say('Jai', 'ใช้กลุ่มนี้')), /ตั้งกลุ่มนี้เป็นกลุ่มทีมแล้ว/);
  assert.match(flat(await w.dm('Ustranger', 'ฉันคือ Bonnie')), /เฉพาะคนในกลุ่มทีม/);
  assert.equal((await w.team.memberByName('Bonnie')).line_user_id, '', 'stranger not linked');
  assert.match(flat(await w.dm('Ustranger', 'งานทีม')), /ฉันคือ/, 'stranger sees nothing');
  assert.match(flat(await w.dm('Bonnie', 'ฉันคือ บอนนี่')), /เชื่อมแล้ว สวัสดี Bonnie/);
  // LINE can't be asked: refuse for now instead of letting anyone in
  w.client.getGroupMemberProfile = async () => { throw Object.assign(new Error('boom'), { status: 500 }); };
  assert.match(flat(await w.dm('Best', 'ฉันคือ Best')), /ลองใหม่/);
  assert.equal((await w.team.memberByName('Best')).line_user_id, '');
});

test('the team group cannot be moved from another group', async () => {
  const w = await makeWorld();
  await w.bot.handle({ type: 'message', replyToken: 'r', source: { type: 'group', groupId: 'Cother', userId: 'Ujai' },
    message: { type: 'text', text: '@Norse ใช้กลุ่มนี้', mention: { mentionees: [{ index: 0, length: 6, isSelf: true, type: 'user' }] } } });
  assert.match(flat(w.client.lastReply()), /มีกลุ่มทีมอยู่แล้ว/);
  assert.equal(await w.db.kvGet('team_group'), 'Cteam');
});

test('a typed answer only counts in the chat where the bot asked', async () => {
  const w = await makeWorld();
  const [t] = await w.team.createTasks([{ title: 'ถ่ายรูปสินค้า', owners: ['Jai'], due: '2026-11-19' }], 'Jai');
  await w.tap('Jai', `a=tb&t=${t.id}`); // asked in 1:1
  const before = w.client.replies.length;
  await w.say('Jai', 'กินข้าวยังทุกคน', false); // normal group chatter
  assert.equal(w.client.replies.length, before, 'group chatter ignored');
  assert.equal((await w.team.task(t.id)).status, 'todo');
  await w.dm('Jai', 'กล้องเสีย');
  assert.equal((await w.team.task(t.id)).blocker, 'กล้องเสีย');
});

test('TEAM_SEED carries aliases and roles', async () => {
  const w = await makeWorld({ link: false });
  const ms = await w.team.members();
  assert.deepEqual(ms.map((m) => [m.nickname, m.aliases, m.admin]), [
    ['Jai', ['เจ'], true], ['Best', ['เบสท์'], false], ['Bonnie', ['บอนนี่'], false],
  ]);
  assert.equal((await w.team.memberByName('พี่บอนนี่')).nickname, 'Bonnie');
});

test('admin who has not linked yet is told to link in the 1:1 chat first; "ฉันคือ" in the group points there', async () => {
  const w = await makeWorld({ link: false });
  assert.match(flat(await w.say('Jai', 'ใช้กลุ่มนี้')), /ทักแชทส่วนตัว.*ฉันคือ/);
  assert.match(flat(await w.say('Jai', 'ฉันคือ ใจ', false)), /เชื่อมบัญชีในแชทส่วนตัว/, 'typed without @Norse');
  assert.match(flat(await w.say('Jai', 'ฉันคือ ใจ')), /เชื่อมบัญชีในแชทส่วนตัว/, 'typed with @Norse');
  assert.equal((await w.team.memberByName('Jai')).line_user_id, '', 'no linking from the group');
  await w.dm('Jai', 'ฉันคือ เจ');
  assert.match(flat(await w.say('Jai', 'ใช้กลุ่มนี้')), /ตั้งกลุ่มนี้เป็นกลุ่มทีมแล้ว/);
  const before = w.client.replies.length;
  await w.say('Jai', 'ฉันคือ คนที่หิวที่สุดในกลุ่ม', false);
  assert.equal(w.client.replies.length, before, 'linked people chatting "ฉันคือ ..." are ignored');
});

test('outcomes are cards; buttons in group cards carry @Norse so the bot hears them', async () => {
  const w = await makeWorld({ link: false });
  const linked = await w.dm('Jai', 'ฉันคือ เจ');
  assert.deepEqual(linked.map((m) => m.type), ['flex', 'flex']);
  assert.match(linked[0].altText, /เชื่อมแล้ว สวัสดี Jai/);
  const reg = await w.say('Jai', 'ใช้กลุ่มนี้');
  assert.equal(reg[0].type, 'flex');
  assert.match(flat(reg), /"text":"@Norse งานทีม"/);

  const [t] = await w.team.createTasks([{ title: 'ถ่ายรูปสินค้า', owners: ['Jai'], due: '2026-11-19' }], 'Jai');
  await w.tap('Jai', `a=tbr&t=${t.id}&r=${encodeURIComponent('กล้องเสีย')}`);
  const push = w.client.pushes.at(-1);
  assert.equal(push.to, 'Cteam');
  assert.equal(push.messages[0].type, 'flex');
  assert.match(push.messages[0].altText, /^🚧 ติดอยู่: ถ่ายรูปสินค้า · Jai ติดงานนี้/);

  w.provider.next(new AiResting(new Date('2026-11-17T08:00:00Z')));
  const resting = await w.say('Jai', 'ใครทำอะไรอยู่บ้างวันนี้นะ');
  assert.equal(resting[0].type, 'flex');
  assert.match(flat(resting), /"text":"@Norse งานฉัน"/);
  assert.match(resting[0].altText, /AI พักอยู่/);
});
