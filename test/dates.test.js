import test from 'node:test';
import assert from 'node:assert/strict';
import { parseThaiDate, normalizeDate, formatDay, diffDays, weekStart, relDays } from '../src/dates.js';

const today = '2026-11-16'; // Monday
const d = (s) => parseThaiDate(s, today);

test('relative words', () => {
  assert.equal(d('ส่งพรุ่งนี้').date, '2026-11-17');
  assert.equal(d('มะรืนนี้นะ').date, '2026-11-18');
  assert.equal(d('วันนี้เลย').date, today);
  assert.equal(d('อีก 3 วัน').date, '2026-11-19');
  assert.equal(d('อีก ๒ สัปดาห์').date, '2026-11-30');
  assert.equal(d('สิ้นเดือน').date, '2026-11-30');
  assert.equal(d('สิ้นเดือนหน้า').date, '2026-12-31');
});

test('weekdays', () => {
  assert.equal(d('ส่งศุกร์').date, '2026-11-20');
  assert.equal(d('ศุกร์นี้').date, '2026-11-20');
  assert.equal(d('ศุกร์หน้า').date, '2026-11-27');
  assert.equal(d('วันจันทร์').date, today); // today is Monday
  assert.equal(d('จันทร์หน้า').date, '2026-11-23');
  assert.equal(d('พฤหัสบดี').date, '2026-11-19');
  assert.equal(d('วันอาทิตย์หน้า').date, '2026-11-29');
  assert.equal(d('next friday').date, '2026-11-27');
  assert.equal(d('by friday').date, '2026-11-20');
});

test('ambiguous phrases ask instead of guessing', () => {
  const r = d('ภายในอาทิตย์หน้า');
  assert.equal(r.ambiguous, true);
  assert.deepEqual(r.options.map((o) => o.date), ['2026-11-29', '2026-11-27']);
  assert.equal(d('สัปดาห์หน้า').ambiguous, true);
});

test('explicit dates', () => {
  assert.equal(d('ส่ง 20/11').date, '2026-11-20');
  assert.equal(d('ส่ง 3/1').date, '2027-01-03');
  assert.equal(d('20 พ.ย.').date, '2026-11-20');
  assert.equal(d('5 ธันวาคม 2569').date, '2026-12-05');
  assert.equal(d('2026-12-01').date, '2026-12-01');
  assert.equal(d('31/02'), null);
  assert.equal(d('ทำ mockup กล่อง'), null);
  assert.equal(d('ติดต่อ supplier'), null);
});

test('normalize and format', () => {
  assert.equal(normalizeDate('20/11/2569'), '2026-11-20');
  assert.equal(normalizeDate('20/11/2026'), '2026-11-20');
  assert.equal(normalizeDate(''), '');
  assert.equal(formatDay('2026-11-20', today), 'Fri 20 Nov');
  assert.equal(formatDay('2027-01-04', today), 'Mon 4 Jan 2027');
  assert.deepEqual([0, 1, 3, -1, -4].map(relDays), ['today', 'tomorrow', 'in 3 days', '1 day late', '4 days late']);
  assert.equal(diffDays('2026-11-16', '2026-11-20'), 4);
  assert.equal(weekStart('2026-11-22'), '2026-11-16');
});

test('English phrases', () => {
  assert.equal(d('due tomorrow').date, '2026-11-17');
  assert.equal(d('day after tomorrow').date, '2026-11-18');
  assert.equal(d('by fri').date, '2026-11-20');
  assert.equal(d('this friday').date, '2026-11-20');
  assert.equal(d('next monday').date, '2026-11-23');
  assert.equal(d('in 3 days').date, '2026-11-19');
  assert.equal(d('in 2 weeks').date, '2026-11-30');
  assert.equal(d('end of next month').date, '2026-12-31');
  assert.equal(d('Nov 20').date, '2026-11-20');
  assert.equal(d('20th November').date, '2026-11-20');
  assert.equal(d('Dec 5, 2026').date, '2026-12-05');
  assert.equal(d('3 Jan').date, '2027-01-03');
  const nw = d('sometime next week');
  assert.equal(nw.ambiguous, true);
  assert.deepEqual(nw.options.map((o) => o.date), ['2026-11-27', '2026-11-29']);
  assert.match(nw.options[0].label, /^Friday · Fri 27 Nov$/);
  assert.equal(d('this weekend').ambiguous, true);
  assert.equal(d('we may 2 classes'), null, '"may" alone is not a month');
  assert.equal(d('3 marks for the quiz'), null);
  assert.equal(d('update the SAT deck'), null);
});

test('"SAT" is the exam, not Saturday', () => {
  assert.equal(d('update the SAT deck'), null);
  assert.equal(d('SAT mock on friday').date, '2026-11-20');
  assert.equal(d('saturday').date, '2026-11-21');
});
