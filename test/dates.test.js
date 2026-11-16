import test from 'node:test';
import assert from 'node:assert/strict';
import { parseThaiDate, normalizeDate, formatDay, diffDays, weekStart } from '../src/dates.js';

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
  assert.equal(formatDay('2026-11-20', today), 'ศ. 20 พ.ย.');
  assert.equal(diffDays('2026-11-16', '2026-11-20'), 4);
  assert.equal(weekStart('2026-11-22'), '2026-11-16');
});
