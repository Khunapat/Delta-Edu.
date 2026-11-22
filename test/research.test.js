import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, splitChoices, sheetIdFrom, Research } from '../src/research.js';
import { buildKnowledge } from '../src/knowledge.js';
import { BoardStore } from '../src/board/store.js';
import { makeWorld, flat } from './helpers.js';

// Made-up answers shaped like the real Form (no real people).
const ROWS = [
  ['ประทับเวลา', '1. อายุ', '4. กิจกรรมออกกำลังกายที่ทำเป็นประจำ', '10. อาการเหล่านี้ส่งผลต่อ performance...', '12. คุณเคยใช้หรือทำอะไรบ้าง...', '16. ยินดีให้สัมภาษณ์เพิ่มเติม ฝากช่องทางติดต่อไว้ได้เลย (LINE / เบอร์โทร / อีเมล)...', '17. อยากให้ผลิตภัณฑ์มีอะไรเพิ่ม'],
  ['11/11/2026, 21:33:02', '20–29 ปี', 'ฟุตบอล, แบดมินตัน', '4', 'ยาดมสมุนไพร (เช่น โป๊ยเซียน, หงส์ไทย, Vicks, อื่นๆ)', '', 'กลิ่นเย็นๆ พกง่าย'],
  ['12/11/2026, 16:46:58', '20–29 ปี', 'ฟุตบอล', '5', 'ยาดมสมุนไพร (เช่น โป๊ยเซียน, หงส์ไทย, Vicks, อื่นๆ), ดื่มเครื่องดื่มเกลือแร่', '0812345678', 'ขอแบบสเปรย์ โทร 0891112222'],
  ['12/11/2026, 18:02:07', '30–39 ปี', 'วิ่ง, ฟุตบอล', '3', 'ไม่เคยลอง', 'someone@example.com', 'ราคาไม่แพง'],
  ['14/11/2569, 20:49:40', '20–29 ปี', 'วิ่ง', '3', 'ดื่มเครื่องดื่มเกลือแร่', 'line: abc', 'อยากได้หลายกลิ่น'],
];

test('Form answers -> board summary; the contact column never appears', () => {
  const s = summarize(ROWS, { now: new Date('2026-11-16T03:00:00Z') });
  assert.equal(s.total, 4);
  assert.deepEqual(s.byDay, { '2026-11-11': 1, '2026-11-12': 2, '2026-11-14': 1 }, 'Thai Buddhist year 2569 read as 2026');
  const titles = s.questions.map((q) => q.title);
  assert.ok(!titles.some((t) => /ติดต่อ/.test(t)), 'contact question skipped');
  assert.ok(!JSON.stringify(s).includes('0812345678') && !JSON.stringify(s).includes('someone@example.com'));
  const byTitle = Object.fromEntries(s.questions.map((q) => [q.title.slice(0, 3), q]));
  assert.equal(byTitle['1. '].type, 'choice');
  assert.deepEqual(byTitle['1. '].options[0], { label: '20–29 ปี', count: 3 });
  assert.equal(byTitle['4. '].type, 'multi');
  assert.deepEqual(byTitle['4. '].options[0], { label: 'ฟุตบอล', count: 3 });
  const tried = byTitle['12.'];
  assert.equal(tried.type, 'multi');
  assert.ok(tried.options.some((o) => o.label === 'ยาดมสมุนไพร (เช่น โป๊ยเซียน, หงส์ไทย, Vicks, อื่นๆ)' && o.count === 2), 'commas inside brackets stay one option');
  assert.equal(byTitle['10.'].type, 'scale');
  assert.equal(byTitle['10.'].avg, 3.75);
  const text = byTitle['17.'];
  assert.equal(text.type, 'text');
  assert.ok(text.samples.includes('ขอแบบสเปรย์ โทร [phone]'), 'numbers in quotes masked');
});

test('splitChoices and sheet ids', () => {
  assert.deepEqual(splitChoices('a, b (x, y), c'), ['a', 'b (x, y)', 'c']);
  assert.equal(sheetIdFrom('https://docs.google.com/spreadsheets/d/13xxshqfDBtd5P8T3Dy34I_wLsEIW43Gt6-k_qxwAVbQ/edit?usp=drivesdk'), '13xxshqfDBtd5P8T3Dy34I_wLsEIW43Gt6-k_qxwAVbQ');
  assert.equal(sheetIdFrom('not a link'), '');
});

test('sync fills research/summary, records lastSync, explains a sharing problem', async () => {
  const w = await makeWorld();
  const store = new BoardStore({ db: w.db, team: w.team });
  let fail = false;
  const research = new Research({ store, readRows: async () => { if (fail) throw new Error('The caller does not have permission'); return ROWS; }, now: () => new Date('2026-11-16T03:00:00Z') });
  assert.deepEqual(await research.sync(), { skipped: 'no form sheet linked' });
  await store.write({ op: 'set', path: 'research/config', data: { sheetUrl: 'https://docs.google.com/spreadsheets/d/13xxshqfDBtd5P8T3Dy34I_wLsEIW43Gt6-k_qxwAVbQ/edit', target: 100, qualTarget: 20 } });
  const r = await research.sync();
  assert.equal(r.total, 4);
  assert.equal((await store.get('research/summary')).total, 4);
  assert.equal((await store.get('research/config')).lastSync, '2026-11-16T03:00:00.000Z');
  assert.equal((await store.get('research/config')).target, 100, 'settings kept');
  fail = true;
  await research.sync();
  assert.match((await store.get('research/config')).lastError, /share it with delta-edu-bot/);
  // Monday line: feedback form progress
  assert.equal(await research.progressLine('2026-11-16', '2026-11-10'), 'Feedback form: 4/100 responses (+4 in 7 days)');
  // what Delta knows for "@Delta sum up the feedback form"
  const k = buildKnowledge((await store.snapshot()).docs);
  assert.match(k, /Feedback form: 4 responses/);
  assert.match(k, /1\. อายุ \(4 answers\): 20–29 ปี 75%/);
  assert.ok(!k.includes('0812345678'));
});

test('Monday post includes the feedback form line', async () => {
  const w = await makeWorld();
  w.scheduler.research = { progressLine: async () => 'Feedback form: 65/100 responses (+12 in 7 days)', sync: async () => ({}) };
  await w.scheduler.tick({ now: new Date('2026-11-16T02:00:00Z'), force: 'monday' });
  assert.match(flat(w.client.pushes.at(-1)), /📋 Feedback/);
  assert.match(flat(w.client.pushes.at(-1)), /Feedback form: 65\/100/);
});
