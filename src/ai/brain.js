// What the AI is asked, and the JSON it must answer with. The server treats
// the answer as a suggestion: owners must be on the team list, dates are
// re-read by our own Thai date parser, and nothing is saved until someone
// taps a button.

import { formatDay, weekdayName } from '../dates.js';
import { ownersOf } from '../team.js';

const TASK = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short task title in the words used (Thai or English).' },
    owners: { type: 'array', items: { type: 'string' }, description: 'Names exactly as written, or "@me" for the sender. Empty if nobody was named.' },
    due_text: { type: 'string', description: 'The exact words that give the due date, copied from the message. Empty if none.' },
    due_date: { type: 'string', description: 'YYYY-MM-DD for due_text, using the calendar below. Empty if no date was given.' },
    stream: { type: 'string', description: 'Workstream: one of the existing ones if it fits, otherwise empty.' },
    priority: { type: 'string', enum: ['high', 'med', 'low'] },
  },
  required: ['title', 'owners', 'due_text', 'due_date', 'stream', 'priority'],
  additionalProperties: false,
};

export const SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['create_tasks', 'update_task', 'my_tasks', 'team_status', 'brief', 'question', 'other'],
    },
    tasks: { type: 'array', items: TASK, description: 'For create_tasks only.' },
    update: {
      type: 'object',
      description: 'For update_task only (the sender changing one of their own tasks).',
      properties: {
        task_id: { type: 'string', description: 'id from MY OPEN TASKS, or empty if unclear.' },
        action: { type: 'string', enum: ['done', 'postpone', 'blocked', 'unblock', 'start', 'none'] },
        date_text: { type: 'string', description: 'For postpone: the exact words of the new date.' },
        date: { type: 'string', description: 'For postpone: YYYY-MM-DD, or empty.' },
        reason: { type: 'string', description: 'For blocked: what is in the way, in the sender\'s words.' },
      },
      required: ['task_id', 'action', 'date_text', 'date', 'reason'],
      additionalProperties: false,
    },
    answer: { type: 'string', description: 'For question / other: a short casual Thai reply (1-3 lines) using only the DATA.' },
    clarify: { type: 'string', description: 'One short Thai question if something needed is missing or unclear; else empty.' },
  },
  required: ['intent', 'tasks', 'update', 'answer', 'clarify'],
  additionalProperties: false,
};

function calendar(today) {
  // two weeks of dates so "ศุกร์หน้า" can be looked up, not computed
  const out = [];
  const [y, m, d] = today.split('-').map(Number);
  for (let i = 0; i < 15; i++) {
    const k = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    out.push(`${k} ${weekdayName(k)}${i === 0 ? ' (วันนี้)' : ''}`);
  }
  return out.join('\n');
}

export function systemPrompt({ botName, chat }) {
  return [
    `You are ${botName}, the LINE helper of NORSE, a small Thai startup team making a herbal inhaler (ยาดมสมุนไพร) brand for athletes.`,
    'Read one chat message and fill the JSON. Reply text is casual, short Thai (English if the sender wrote English). No emoji spam.',
    chat === 'group'
      ? 'This is the TEAM GROUP. Typical asks: create tasks for people ("บอนนี่ กับ เจ ทำ mockup กล่อง ส่งศุกร์"), who is doing what, questions about the project.'
      : 'This is a PRIVATE 1:1 chat with one member (the sender). Typical asks: update one of their tasks ("mockup เสร็จแล้ว", "ขอเลื่อนเป็นจันทร์", "ติด supplier ยังไม่ตอบ"), what to do today, questions about the project, or create a task.',
    'Rules:',
    '- Never guess an owner or a date. Only use names that appear in the message (or "@me" when the sender says ฉัน/ผม/เรา/เค้า about themself). If none, leave owners empty.',
    '- due_text must be copied from the message; due_date must come from the CALENDAR. No date words means both empty.',
    '- One task per distinct piece of work. Several people on one piece of work = one task with several owners.',
    '- Answer questions ONLY from DATA. If DATA has no record, say so plainly (e.g. "ยังไม่มีบันทึกเรื่องนี้").',
    '- Never write health or medical claims about the product (no curing, treating or preventing anything). Never show phone numbers or emails.',
    '- intent my_tasks = asking for their own task list; team_status = who is on what / overdue / blocked; brief = what to do today.',
  ].join('\n');
}

export function contextBlock({ today, sender, members, mentioned = [], streams, tasks, milestones, myTasks = null }) {
  const lines = [
    `TODAY: ${today} (${weekdayName(today)}, ${formatDay(today, today)})`,
    'CALENDAR:', calendar(today),
    `SENDER: ${sender || 'unknown'}`,
    `TEAM: ${members.map((m) => [m.nickname, ...m.aliases].join('/')).join(', ')}`,
  ];
  if (mentioned.length) lines.push(`TAGGED IN MESSAGE: ${mentioned.join(', ')}`);
  lines.push(`WORKSTREAMS: ${streams.length ? streams.join(', ') : '(none yet)'}`);
  if (myTasks) {
    lines.push('MY OPEN TASKS (id | title | status | due):');
    lines.push(myTasks.length ? myTasks.map((t) => `${t.id} | ${t.title} | ${t.status} | ${t.due || '-'}`).join('\n') : '(none)');
  }
  const open = tasks.filter((t) => t.status !== 'done').slice(0, 80);
  const done = tasks.filter((t) => t.status === 'done').slice(-20);
  lines.push('DATA tasks (title | owner | stream | status | due | blocker):');
  lines.push([...open, ...done].map((t) => `${t.title} | ${ownersOf(t).join('+') || '-'} | ${t.stream} | ${t.status} | ${t.due || '-'} | ${t.blocker || ''}`).join('\n') || '(none)');
  lines.push('DATA milestones (title | date | done):');
  lines.push(milestones.map((m) => `${m.title} | ${m.date || '-'} | ${m.done ? 'yes' : 'no'}`).join('\n') || '(none)');
  return lines.join('\n');
}

/** Ask the AI about one message. Returns the parsed object (defaults filled in). */
export async function understand(ai, { botName, chat, text, ctx }) {
  const out = await ai.extract({
    system: systemPrompt({ botName, chat }),
    parts: [{ text: `${contextBlock(ctx)}\n\nMESSAGE:\n${text}` }],
    schema: SCHEMA,
  });
  return {
    intent: out?.intent || 'other',
    tasks: Array.isArray(out?.tasks) ? out.tasks : [],
    update: out?.update || { task_id: '', action: 'none', date_text: '', date: '', reason: '' },
    answer: String(out?.answer || '').trim(),
    clarify: String(out?.clarify || '').trim(),
  };
}
