// Plain-text commands that never call the AI. The bot speaks English; the Thai
// words from the old bot still work as aliases (harmless, and some people type them).

import { normName } from './team.js';

const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');

const LINK = /^(?:i am|i'm|im|this is|ฉันคือ|ผมคือ|เราคือ|หนูคือ)\s*[:：]?\s*(.+)$/i;

export function command(text) {
  const s = clean(text).toLowerCase().replace(/[?!.。]+$/, '');
  if (LINK.test(s)) return { cmd: 'link', name: LINK.exec(clean(text))[1].trim() };
  if (/^(my tasks?|mine|tasks|งานฉัน|งานของฉัน)$/.test(s)) return { cmd: 'mine' };
  if (/^(team|team tasks|who'?s doing what|who is doing what|งานทีม)$/.test(s)) return { cmd: 'team' };
  if (/^(today|brief|my day|what'?s (on )?today|what should i do( today)?|วันนี้ทำอะไรดี)$/.test(s)) return { cmd: 'brief' };
  if (/^(settings?|usage|quota|ai|ตั้งค่า)$/.test(s)) return { cmd: 'settings' };
  if (/^(help|menu|how to( use)?|commands|วิธีใช้|เมนู)$/.test(s)) return { cmd: 'help' };
  if (/^(use this group|set this group|this is the team group|ใช้กลุ่มนี้)$/.test(s)) return { cmd: 'register_group' };
  if (/^(board|dashboard|open (the )?board|บอร์ด)$/.test(s)) return { cmd: 'board' };
  if (/^(meeting|meeting notes?|new meeting|ประชุม|บันทึกประชุม)$/.test(s)) return { cmd: 'meeting' };
  if (/^(classes|class|schedule|my classes|class schedule|this week'?s classes|คลาส)$/.test(s)) return { cmd: 'classes', mine: /^my /.test(s) };
  if (/^(decisions|open decisions|decision list)$/.test(s)) return { cmd: 'decisions' };
  const pay = parsePay(s);
  if (pay) return { cmd: 'pay', ...pay };
  return null;
}

/**
 * "pay 10 students 10h 300" / "pay 10 10 300" / "pay" (show how) -> numbers for the
 * tutor pay calculator: students, hours, price per student-hour. Never guesses a
 * missing number: missing ones come back empty and the bot asks.
 */
export function parsePay(s) {
  const m = /^(?:pay|tutor pay|calc(?:ulate)? pay)\b(.*)$/.exec(s);
  if (!m) return null;
  let rest = m[1].replace(/,/g, '');
  const take = (re) => { const x = re.exec(rest); if (!x) return null; rest = rest.replace(x[0], ' '); return Number(x[1]); };
  let students = take(/(\d+)\s*(?:students?|ppl|people|kids|learners)\b/);
  let hours = take(/(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)\b/);
  let price = take(/(?:thb|฿|price|at|@)\s*(\d+(?:\.\d+)?)/) ?? take(/(\d+(?:\.\d+)?)\s*(?:thb|baht|฿|\/h|per\b)/);
  // Unlabelled numbers fill the gaps in order: students, hours, price.
  const bare = rest.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (students == null && bare.length) students = bare.shift();
  if (hours == null && bare.length) hours = bare.shift();
  if (price == null && bare.length) price = bare.shift();
  return { students, hours, price };
}

/**
 * Updates people type about their own tasks: "slides done", "push to monday",
 * "blocked, waiting for Best". Returns the action, or null when unsure
 * (negations like "not done yet" go to the AI instead).
 */
export function detectUpdate(text) {
  const s = clean(text).toLowerCase();
  if (/\b(not|n't|never)\s+(yet\s+)?(done|finished|completed|blocked|started)|\bnot yet\b|(ยัง)?ไม่(ได้)?(เสร็จ|ติด|เลื่อน)/.test(s)) return null;
  if (/\bunblocked\b|no longer (blocked|stuck)|\bresolved\b|แก้ได้แล้ว|ไม่ติดแล้ว/.test(s)) return 'unblock';
  if (/\bblocked\b|\bstuck\b|waiting (for|on)\b|ติด(?!ต่อ|ตั้ง|ตาม)/.test(s)) return 'blocked';
  if (/\bpostpone|\bpush(ed)?\b.{0,40}\b(to|back|until)\b|\bmove(d)?\b.{0,40}\bto\b|\bdelay|\breschedule|\bneed more time\b|\bextend|เลื่อน/.test(s)) return 'postpone';
  if (/\bdone\b|\bfinished\b|\bcompleted?\b|\bsubmitted\b|\bsent\b|เสร็จ|เรียบร้อย/.test(s)) return 'done';
  if (/\bstarted\b|\bstarting\b|\bworking on\b|\bon it\b|\bin progress\b|เริ่ม(ทำ)?แล้ว|กำลังทำ/.test(s)) return 'start';
  return null;
}

const STOP = /\b(done|finished|completed?|submitted|sent|postponed?|push(ed)?|move(d)?|to|back|until|next|delay(ed)?|reschedule|blocked|stuck|waiting (for|on)|started|starting|working on|on it|in progress|already|please|the|is|it|my|i|have|has|just|now|task)\b|เสร็จแล้ว|เสร็จ|เลื่อน|ติด|แล้ว|ครับ|ค่ะ|นะ|งาน/g;

/** Which of `tasks` the text is about. Returns matching tasks, best first. */
export function matchTasks(text, tasks) {
  const s = normName(text);
  const scored = tasks.map((task) => {
    const title = normName(task.title);
    let score = 0;
    if (title && s.includes(title)) score = 100 + title.length;
    else {
      const rest = normName(String(text).toLowerCase().replace(STOP, ' '));
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
