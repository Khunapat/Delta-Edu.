// Plain-text commands that never call the AI.

import { normName } from './team.js';

const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');

export function command(text) {
  const s = clean(text).toLowerCase().replace(/[?!.。]+$/, '');
  if (/^(ฉันคือ|ผมคือ|เราคือ|หนูคือ|i am|i'm)\s*(.+)$/i.test(s)) return { cmd: 'link', name: /^(?:ฉันคือ|ผมคือ|เราคือ|หนูคือ|i am|i'm)\s*(.+)$/i.exec(clean(text))[1].trim() };
  if (/^(งานฉัน|งานของฉัน|งานผม|งานเรา|my tasks?)$/.test(s)) return { cmd: 'mine' };
  if (/^(งานทีม|ใครทำอะไร(อยู่)?(บ้าง)?|team)$/.test(s)) return { cmd: 'team' };
  if (/^(วันนี้ทำอะไรดี|วันนี้ต้องทำอะไร(บ้าง)?|brief|today)$/.test(s)) return { cmd: 'brief' };
  if (/^(ตั้งค่า|settings?|usage|ai|โควตา)$/.test(s)) return { cmd: 'settings' };
  if (/^(help|ช่วยด้วย|ทำอะไรได้บ้าง|วิธีใช้|เมนู)$/.test(s)) return { cmd: 'help' };
  if (/^(ใช้กลุ่มนี้|ตั้งกลุ่มนี้|ตั้งเป็นกลุ่มทีม)$/.test(s)) return { cmd: 'register_group' };
  return null;
}

/**
 * Updates people type about their own tasks: "mockup เสร็จแล้ว",
 * "ขอเลื่อนเป็นจันทร์", "ติด supplier ยังไม่ตอบ". Returns the action, or null
 * when unsure (negations like "ยังไม่เสร็จ" go to the AI instead).
 */
export function detectUpdate(text) {
  const s = clean(text).toLowerCase();
  if (/(ยัง)?ไม่(ได้)?(เสร็จ|ติด|เลื่อน)|not (done|blocked)/.test(s)) return null;
  if (/แก้ได้แล้ว|ไม่ติดแล้ว|หายติดแล้ว|unblock/.test(s)) return 'unblock';
  if (/ติด(?!ต่อ|ตั้ง|ตาม)|blocked|stuck|รอ.{0,20}(ตอบ|อนุมัติ)/.test(s)) return 'blocked';
  if (/เลื่อน|postpone|ขอเวลา(เพิ่ม)?|push to/.test(s)) return 'postpone';
  if (/เสร็จ|เรียบร้อย|done|finished|ส่งแล้ว/.test(s)) return 'done';
  if (/เริ่ม(ทำ)?แล้ว|กำลังทำ|started/.test(s)) return 'start';
  return null;
}

const STOP = /(เสร็จแล้ว|เสร็จ|เรียบร้อย(แล้ว)?|ขอเลื่อน(เป็น|ไป)?|เลื่อน(เป็น|ไป)?|ติด|แล้ว|ครับ|ค่ะ|คะ|นะ|จ้า|งาน|done|blocked|postpone)/g;

/** Which of `tasks` the text is about. Returns matching tasks, best first. */
export function matchTasks(text, tasks) {
  const s = normName(text);
  const scored = tasks.map((task) => {
    const title = normName(task.title);
    let score = 0;
    if (title && s.includes(title)) score = 100 + title.length;
    else {
      const rest = normName(String(text).replace(STOP, ' '));
      if (rest.length >= 3 && title.includes(rest)) score = 80 + rest.length;
      for (const w of String(task.title).toLowerCase().split(/[\s,/()-]+/)) {
        if (w.length >= 3 && s.includes(normName(w))) score = Math.max(score, 10 + w.length);
      }
    }
    return { task, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((x) => x.score >= top - 3).map((x) => x.task);
}
