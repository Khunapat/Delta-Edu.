import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledge, scrub } from '../src/knowledge.js';
import { systemPrompt } from '../src/ai/brain.js';
import { makeWorld, flat } from './helpers.js';

const docs = {
  'meta/brand': { vision: 'เป็นแบรนด์ตัวช่วยการหายใจจากสมุนไพรที่นักกีฬาไทยเลือกเป็นอันดับแรก', mission: ['พัฒนาผลิตภัณฑ์ใช้ง่าย'] },
  'suppliers/s1': { company: 'สวนสมุนไพรนครปฐม', category: 'OEM', price: '12 บาท/ชิ้น', moq: '1000', email: 'sales@herb.co.th', phone: '081-234-5678', notes: 'โทร 0812345678 ก่อนบ่าย' },
  'meetings/m1': { title: 'ประชุม 14 พ.ย.', decisions: 'เลือก Pocket Press Slim ทำต่อ', actions: 'Bonnie ทำ mockup' },
  'contacts/c1': { nick: 'Jai', email: 'jai@example.com', tel: '0899999999' },
  'bmc/main': { blocks: { segments: [{ id: 'a', text: 'นักวิ่งมาราธอน' }] } },
};

test('knowledge: basics + board notes; phone numbers and emails never included', () => {
  const k = buildKnowledge(docs);
  assert.match(k, /Thai herbal inhaler brand/, 'NORSE basics from knowledge/norse.md');
  assert.match(k, /Balm Stick, Pocket Press Slim/);
  assert.match(k, /นักกีฬาไทยเลือกเป็นอันดับแรก/, 'vision');
  assert.match(k, /เลือก Pocket Press Slim ทำต่อ/, 'meeting decision');
  assert.match(k, /สวนสมุนไพรนครปฐม · category: OEM · price: 12 บาท\/ชิ้น/);
  assert.match(k, /segments: นักวิ่งมาราธอน/, 'canvas');
  for (const secret of ['sales@herb.co.th', '081-234-5678', '0812345678', 'jai@example.com', '0899999999']) {
    assert.ok(!k.includes(secret), `leaked ${secret}`);
  }
  assert.match(k, /โทร \[phone\] ก่อนบ่าย/, 'numbers inside notes are masked');
  assert.ok(buildKnowledge(docs, { max: 300 }).length <= 300);
  assert.equal(scrub('mail a@b.co or call +66 81 234 5678'), 'mail [email] or call [phone]');
});

test('prompt: small talk is answered, team facts only from data, general knowledge is labelled, no health claims', () => {
  const p = systemPrompt({ botName: 'Norse', chat: 'group' });
  assert.match(p, /Greetings, thanks and small talk/);
  assert.match(p, /answer ONLY from DATA and KNOWLEDGE/);
  assert.match(p, /ความรู้ทั่วไป ไม่ใช่ข้อมูลทีม/);
  assert.match(p, /Never write health or medical claims/);
});

test('"@Norse hello" gets a reply, and the AI sees the knowledge (without contact details)', async () => {
  const w = await makeWorld();
  w.bot.knowledge = async () => buildKnowledge(docs);
  w.provider.next({ intent: 'other', answer: 'สวัสดี! วันนี้มีอะไรให้ช่วยไหม 🙂' });
  const r = await w.say('Jai', 'hello');
  assert.match(flat(r), /สวัสดี! วันนี้มีอะไรให้ช่วยไหม/);
  const sent = w.provider.calls.at(-1).text;
  assert.match(sent, /KNOWLEDGE/);
  assert.match(sent, /สวนสมุนไพรนครปฐม/);
  assert.ok(!sent.includes('sales@herb.co.th') && !sent.includes('081-234-5678'));
});
