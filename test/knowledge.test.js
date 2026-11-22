import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledge, scrub } from '../src/knowledge.js';
import { systemPrompt } from '../src/ai/brain.js';
import { makeWorld, flat } from './helpers.js';

const docs = {
  'notes/n1': { title: 'Refund policy (draft)', body: 'Full refund before the 2nd class. Call Pure 0812345678 or mail pure@example.com' },
  'decisions/d1': { title: 'Thermo I price', area: 'Courses', status: 'open', owner: 'Best', outcome: '' },
  'decisions/d2': { title: 'Class size', area: 'Courses', status: 'agreed', outcome: 'Max 12 per group' },
  'meetings/m1': { title: 'Kick-off', decisions: 'Start Thermo I in January', actions: 'Kiak: lesson 1 slides' },
  'classes/c1': { date: '2026-11-20', time: '19:00', course: 'Thermodynamics I', brand: 'Uni', tutor: 'Kiak', students: 6, status: 'planned' },
  'classes/c0': { date: '2026-11-01', time: '19:00', course: 'Old class', brand: 'Uni', tutor: 'Kiak', status: 'done' },
  'classes/cx': { date: '2026-11-21', time: '10:00', course: 'Cancelled class', brand: 'LITE', tutor: 'Best', status: 'cancelled' },
  'settings/pay': { bands: [{ from: 1, to: 3, tutor: 61 }] },
  'contacts/c1': { nick: 'Jai', email: 'jai@example.com', tel: '0899999999' },
};

test('knowledge: public basics + private board notes, decisions, upcoming classes; contacts and pay ladder never included', () => {
  const k = buildKnowledge(docs, { today: '2026-11-16' });
  assert.match(k, /δelta Edu\. basics/);
  assert.match(k, /Thermodynamics I first/, 'from knowledge/delta-edu.md');
  assert.match(k, /SAT \(Basic, Intermediate, Advanced/);
  assert.match(k, /Refund policy \(draft\)/, 'team notes');
  assert.match(k, /Thermo I price · area: Courses · status: open/, 'open decision');
  assert.match(k, /Max 12 per group/);
  assert.match(k, /2026-11-20 19:00 Thermodynamics I \(Uni\) tutor Kiak, 6 students/);
  assert.doesNotMatch(k, /Old class|Cancelled class/, 'only upcoming, not cancelled');
  assert.doesNotMatch(k, /tutor: 61|"bands"|61/, 'pay ladder never sent to the AI');
  for (const secret of ['0812345678', 'pure@example.com', 'jai@example.com', '0899999999']) {
    assert.ok(!k.includes(secret), `leaked ${secret}`);
  }
  assert.match(k, /Call Pure \[phone\] or mail \[email\]/, 'numbers inside notes are masked');
  assert.doesNotMatch(k, /NORSE|herbal|inhaler/);
  assert.ok(buildKnowledge(docs, { max: 300 }).length <= 300);
  assert.equal(scrub('mail a@b.co or call +66 81 234 5678'), 'mail [email] or call [phone]');
});

test('prompt: small talk is answered, team facts only from data, general knowledge is labelled, English, no NORSE rules', () => {
  const p = systemPrompt({ botName: 'Delta', chat: 'group' });
  assert.match(p, /You are Delta, the LINE helper of the δelta Edu\. team/);
  assert.match(p, /Greetings, thanks and small talk/);
  assert.match(p, /answer ONLY from DATA and KNOWLEDGE/);
  assert.match(p, /\(general knowledge, not team data\)/);
  assert.match(p, /provisional or open are not final/);
  assert.doesNotMatch(p, /health or medical|FDA|NORSE|startup/);
});

test('"@Delta hello" gets a reply, and the AI sees the knowledge (without contact details)', async () => {
  const w = await makeWorld();
  w.bot.knowledge = async () => buildKnowledge(docs, { today: '2026-11-16' });
  w.provider.next({ intent: 'other', answer: 'Hi! What can I help with today? 🙂' });
  const r = await w.say('Jai', 'hello');
  assert.match(flat(r), /Hi! What can I help with today/);
  const sent = w.provider.calls.at(-1).text;
  assert.match(sent, /KNOWLEDGE/);
  assert.match(sent, /Refund policy/);
  assert.ok(!sent.includes('pure@example.com') && !sent.includes('0812345678'));
});
