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
  await w.dm('Best', 'ฉันคือ Best');
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
  assert.match(flat(await w.dm('Bonnie', 'mockup เสร็จแล้ว')), /เสร็จแล้ว ✓/);
  assert.match(flat(await w.dm('Bonnie', 'ขอเลื่อนสั่งตัวอย่างขวดเป็นศุกร์หน้า')), /เลื่อน .{0,3}สั่งตัวอย่างขวด.{0,3} เป็น ศ\. 27 พ\.ย\./);
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
