import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld, flat, postbacks } from './helpers.js';
import { forAi, transcode } from '../src/media.js';

const AI_MEETING = {
  is_meeting: true, title: 'Thermo I launch', date_text: '', attendees: ['J', 'Kiakky', 'Pim'],
  summary: 'Planned the first Thermodynamics I cohort.',
  decisions: ['Start Thermo I in January'],
  action_items: [
    { title: 'Thermo I lesson 1 slides', owners: ['Kiakky'], due_text: 'friday', due_date: '2026-11-20' },
    { title: 'Post the class schedule', owners: ['Best'], due_text: 'tomorrow', due_date: '2026-11-17' },
  ],
  open_questions: ['What is the class price?'],
};
const media = (w, who, kind, id = 'm1', where = 'direct') => w.bot.handle({
  type: 'message', replyToken: 'r',
  source: where === 'group' ? { type: 'group', groupId: w.group, userId: w.uid[who] } : { type: 'user', userId: w.uid[who] },
  message: { type: kind, id },
}).then(() => w.client.lastReply());

test('typed meeting notes -> meeting card + task cards; save puts it on the board, confirm makes the tasks', async () => {
  const w = await makeWorld();
  w.provider.next(AI_MEETING);
  const r = await w.dm('Jai', 'meeting notes: agreed to start Thermo I in January. Kiak does lesson 1 slides by friday, Best posts the schedule tomorrow. Price still open.');
  const call = w.provider.calls.at(-1);
  assert.ok(call.schema.properties.is_meeting, 'meeting reader, not the chat reader');
  assert.match(call.text, /agreed to start Thermo I/);
  assert.match(call.system, /Always write in English/);
  assert.match(r[0].altText, /^Meeting summary · to save: Thermo I launch/);
  assert.match(flat(r[0]), /Start Thermo I in January/);
  assert.match(flat(r[0]), /Kiak/, 'names mapped to the team list');
  assert.match(r[1].altText, /New task to confirm: Thermo I lesson 1 slides, Post the class schedule/);

  const save = postbacks(r).find((d) => d.startsWith('a=mok'));
  const saved = await w.tap('Jai', save);
  assert.match(saved[0].altText, /^Meeting saved/);
  const docs = (await w.store.snapshot()).docs;
  const meeting = Object.entries(docs).find(([p]) => p.startsWith('meetings/'))[1];
  assert.equal(meeting.title, 'Thermo I launch');
  assert.equal(meeting.date, '2026-11-16');
  assert.equal(meeting.attendees, 'Jai, Kiak, Pim', 'team names mapped; unknown spellings kept as written');
  assert.equal(meeting.decisions, 'Start Thermo I in January');
  assert.match(meeting.actions, /^Kiak: Thermo I lesson 1 slides \(2026-11-20\)/);
  assert.match(meeting.notes, /Open questions:\n- What is the class price\?/);
  assert.match(flat(await w.tap('Jai', save)), /already saved or cancelled/, 'second tap does nothing');

  await w.tap('Jai', postbacks(r).find((d) => d.startsWith('a=dok')));
  const tasks = await w.team.tasks();
  assert.equal(tasks.find((t) => t.title.startsWith('Thermo I lesson')).owner, 'Kiak');
  assert.equal(tasks.find((t) => t.title.startsWith('Thermo I lesson')).due, '2026-11-20');
  assert.equal(tasks.find((t) => t.title.startsWith('Post the')).owner, 'Best');
  assert.equal(tasks.find((t) => t.title.startsWith('Post the')).due, '2026-11-17');
});

test('group: "@Delta meeting" then a whiteboard photo from the same person; others are ignored', async () => {
  const w = await makeWorld();
  assert.match(flat(await w.say('Jai', 'meeting')), /Send the meeting notes/);
  const before = w.client.replies.length;
  await media(w, 'Best', 'image', 'img0', 'group');
  assert.equal(w.client.replies.length, before, "someone else's photo is just chat");
  w.client.content = { img1: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) };
  w.provider.next({ ...AI_MEETING, action_items: [] });
  const r = await media(w, 'Jai', 'image', 'img1', 'group');
  const part = w.provider.calls.at(-1).parts[0];
  assert.equal(part.inlineData.mimeType, 'image/jpeg');
  assert.equal(part.inlineData.data, Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'));
  assert.match(r[0].altText, /Meeting summary/);
  assert.equal(r.length, 1, 'no action items, no task cards');
});

test('1:1 photo without "meeting" gets a hint and no AI call; "not a meeting" is said plainly', async () => {
  const w = await makeWorld();
  assert.match((await media(w, 'Jai', 'image'))[0].text, /type "meeting" first/);
  assert.equal(w.provider.calls.length, 0);
  await w.dm('Jai', 'meeting');
  w.provider.next({ ...AI_MEETING, is_meeting: false, decisions: [], action_items: [], open_questions: [] });
  assert.match(flat(await media(w, 'Jai', 'image')), /doesn't look like meeting notes/);
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
  await w.dm('Kiak', 'meeting');
  w.client.content = { v1: m4a };
  w.provider.next({ ...AI_MEETING, action_items: [] });
  await media(w, 'Kiak', 'audio', 'v1');
  assert.equal(w.provider.calls.at(-1).parts[0].inlineData.mimeType, 'audio/ogg');
});

test('slow reading: an expired reply token turns into one push to the same chat', async () => {
  const w = await makeWorld();
  await w.dm('Jai', 'meeting');
  w.client.replyMessage = async () => { throw Object.assign(new Error('Invalid reply token'), { status: 400 }); };
  w.provider.next({ ...AI_MEETING, action_items: [] });
  await w.bot.handle({ type: 'message', replyToken: 'old', source: { type: 'user', userId: 'Ujai' }, message: { type: 'text', text: 'talked about the SAT launch, we keep the same price' } });
  const p = w.client.pushes.at(-1);
  assert.equal(p.to, 'Ujai');
  assert.match(p.messages[0].altText, /Meeting summary/);
});

test('group: after "@Delta meeting", plain chat stays chat; "@Delta <notes>" is the notes', async () => {
  const w = await makeWorld();
  await w.say('Jai', 'meeting');
  const before = w.client.replies.length;
  await w.say('Jai', 'lunch anyone?', false);
  assert.equal(w.client.replies.length, before, 'normal chat ignored');
  assert.equal(w.provider.calls.length, 0, 'no AI spent');
  w.provider.next({ ...AI_MEETING, action_items: [] });
  const r = await w.say('Jai', 'we agreed to open IGCSE Physics in December');
  assert.ok(w.provider.calls.at(-1).schema.properties.is_meeting, 'read as meeting notes');
  assert.match(r[0].altText, /Meeting summary/);
});
