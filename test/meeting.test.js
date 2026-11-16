import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld, flat, postbacks } from './helpers.js';
import { forAi, transcode } from '../src/media.js';

const AI_MEETING = {
  is_meeting: true, title: 'ประชุมเลือกแพ็กเกจ', date_text: '', attendees: ['เจ', 'บอนนี่', 'นน'],
  summary: 'คุยเรื่องแบบที่จะทำต่อและ supplier',
  decisions: ['เลือก Pocket Press Slim ทำต่อ'],
  action_items: [
    { title: 'ทำ mockup Pocket Press Slim', owners: ['บอนนี่'], due_text: 'ศุกร์', due_date: '2026-11-20' },
    { title: 'โทรถาม supplier 3 เจ้า', owners: ['เบสท์'], due_text: 'พรุ่งนี้', due_date: '2026-11-17' },
  ],
  open_questions: ['ต้นทุนต่อชิ้นเท่าไหร่'],
};
const media = (w, who, kind, id = 'm1', where = 'direct') => w.bot.handle({
  type: 'message', replyToken: 'r',
  source: where === 'group' ? { type: 'group', groupId: w.group, userId: w.uid[who] } : { type: 'user', userId: w.uid[who] },
  message: { type: kind, id },
}).then(() => w.client.lastReply());

test('typed meeting notes -> meeting card + task cards; save puts it on the board, confirm makes the tasks', async () => {
  const w = await makeWorld();
  w.provider.next(AI_MEETING);
  const r = await w.dm('Jai', 'บันทึกประชุม: ตกลงเลือก Pocket Press Slim บอนนี่ทำ mockup ส่งศุกร์ นนโทรหา supplier พรุ่งนี้ ต้นทุนยังไม่รู้');
  const call = w.provider.calls.at(-1);
  assert.ok(call.schema.properties.is_meeting, 'meeting reader, not the chat reader');
  assert.match(call.text, /ตกลงเลือก Pocket Press Slim/);
  assert.match(r[0].altText, /^สรุปประชุม · รอบันทึก: ประชุมเลือกแพ็กเกจ/);
  assert.match(flat(r[0]), /เลือก Pocket Press Slim ทำต่อ/);
  assert.match(flat(r[0]), /Bonnie/, 'names mapped to the team list');
  assert.match(r[1].altText, /งานใหม่รอยืนยัน: ทำ mockup Pocket Press Slim, โทรถาม supplier 3 เจ้า/);

  const save = postbacks(r).find((d) => d.startsWith('a=mok'));
  const saved = await w.tap('Jai', save);
  assert.match(saved[0].altText, /^บันทึกประชุมแล้ว/);
  const docs = (await w.store.snapshot()).docs;
  const meeting = Object.entries(docs).find(([p]) => p.startsWith('meetings/'))[1];
  assert.equal(meeting.title, 'ประชุมเลือกแพ็กเกจ');
  assert.equal(meeting.date, '2026-11-16');
  assert.equal(meeting.attendees, 'Jai, Bonnie, นน', 'team names mapped; unknown spellings kept as written');
  assert.equal(meeting.decisions, 'เลือก Pocket Press Slim ทำต่อ');
  assert.match(meeting.actions, /^Bonnie: ทำ mockup Pocket Press Slim \(2026-11-20\)/);
  assert.match(meeting.notes, /คำถามค้าง:\n- ต้นทุนต่อชิ้นเท่าไหร่/);
  assert.match(flat(await w.tap('Jai', save)), /บันทึก\/ยกเลิกไปแล้ว/, 'second tap does nothing');

  await w.tap('Jai', postbacks(r).find((d) => d.startsWith('a=dok')));
  const tasks = await w.team.tasks();
  assert.equal(tasks.find((t) => t.title.startsWith('ทำ mockup')).owner, 'Bonnie');
  assert.equal(tasks.find((t) => t.title.startsWith('ทำ mockup')).due, '2026-11-20');
  assert.equal(tasks.find((t) => t.title.startsWith('โทรถาม')).owner, 'Best');
  assert.equal(tasks.find((t) => t.title.startsWith('โทรถาม')).due, '2026-11-17');
});

test('group: "@Norse ประชุม" then a whiteboard photo from the same person; others are ignored', async () => {
  const w = await makeWorld();
  assert.match(flat(await w.say('Jai', 'ประชุม')), /ส่งโน้ตประชุมมาได้เลย/);
  const before = w.client.replies.length;
  await media(w, 'Best', 'image', 'img0', 'group');
  assert.equal(w.client.replies.length, before, "someone else's photo is just chat");
  w.client.content = { img1: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) };
  w.provider.next({ ...AI_MEETING, action_items: [] });
  const r = await media(w, 'Jai', 'image', 'img1', 'group');
  const part = w.provider.calls.at(-1).parts[0];
  assert.equal(part.inlineData.mimeType, 'image/jpeg');
  assert.equal(part.inlineData.data, Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'));
  assert.match(r[0].altText, /สรุปประชุม/);
  assert.equal(r.length, 1, 'no action items, no task cards');
});

test('1:1 photo without "ประชุม" gets a hint and no AI call; "not a meeting" is said plainly', async () => {
  const w = await makeWorld();
  assert.match((await media(w, 'Jai', 'image'))[0].text, /พิมพ์ "ประชุม" ก่อน/);
  assert.equal(w.provider.calls.length, 0);
  await w.dm('Jai', 'ประชุม');
  w.provider.next({ ...AI_MEETING, is_meeting: false, decisions: [], action_items: [], open_questions: [] });
  assert.match(flat(await media(w, 'Jai', 'image')), /ดูไม่เหมือนโน้ตประชุม/);
});

test('voice note: converted to Ogg/Opus for the AI (ffmpeg), falls back to the original', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 && 'no ffmpeg here' }, async () => {
  // A normal m4a (index at the end), like LINE's voice notes.
  const file = join(mkdtempSync(join(tmpdir(), 'm4a-')), 'v.m4a');
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', file]);
  const m4a = readFileSync(file);
  assert.ok(m4a.length > 100);
  const out = await forAi('audio', m4a);
  assert.equal(out.mimeType, 'audio/ogg');
  assert.equal(Buffer.from(out.data, 'base64').toString('ascii', 0, 4), 'OggS');
  assert.equal(await transcode(Buffer.from('not audio'), ['-f', 'ogg']), null);
  const fallback = await forAi('audio', m4a, { bin: 'no-such-ffmpeg' });
  assert.equal(fallback.mimeType, 'audio/mp4');

  const w = await makeWorld();
  await w.dm('Bonnie', 'ประชุม');
  w.client.content = { v1: m4a };
  w.provider.next({ ...AI_MEETING, action_items: [] });
  await media(w, 'Bonnie', 'audio', 'v1');
  assert.equal(w.provider.calls.at(-1).parts[0].inlineData.mimeType, 'audio/ogg');
});

test('slow reading: an expired reply token turns into one push to the same chat', async () => {
  const w = await makeWorld();
  await w.dm('Jai', 'ประชุม');
  w.client.replyMessage = async () => { throw Object.assign(new Error('Invalid reply token'), { status: 400 }); };
  w.provider.next({ ...AI_MEETING, action_items: [] });
  await w.bot.handle({ type: 'message', replyToken: 'old', source: { type: 'user', userId: 'Ujai' }, message: { type: 'text', text: 'คุยเรื่อง supplier ตกลงใช้เจ้าเดิม' } });
  const p = w.client.pushes.at(-1);
  assert.equal(p.to, 'Ujai');
  assert.match(p.messages[0].altText, /สรุปประชุม/);
});
