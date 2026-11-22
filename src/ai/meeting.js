// Meeting notes -> decisions and action items. The input can be typed notes, a voice
// note (audio) or a whiteboard / notebook photo (image). The AI only suggests: owners
// must be on the team list, dates are re-read by our own date parser, and nothing is
// saved until someone taps a button.

import { formatDay, weekdayName } from '../dates.js';

const ITEM = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'The action item as a short task title in English (keep course names and names as written).' },
    owners: { type: 'array', items: { type: 'string' }, description: 'Names exactly as said/written. Empty if nobody was named.' },
    due_text: { type: 'string', description: 'The exact words giving the due date, copied. Empty if none.' },
    due_date: { type: 'string', description: 'YYYY-MM-DD for due_text using the CALENDAR, or empty.' },
  },
  required: ['title', 'owners', 'due_text', 'due_date'],
  additionalProperties: false,
};

export const MEETING_SCHEMA = {
  type: 'object',
  properties: {
    is_meeting: { type: 'boolean', description: 'False if this is clearly not meeting notes (e.g. a random photo).' },
    title: { type: 'string', description: 'Short meeting name in English, e.g. "Weekly team meeting" or the topic.' },
    date_text: { type: 'string', description: 'Words giving the meeting date if stated, else empty.' },
    attendees: { type: 'array', items: { type: 'string' }, description: 'Names of people present, as said/written. Empty if unknown.' },
    summary: { type: 'string', description: '1-3 short lines in English: what the meeting was about.' },
    decisions: { type: 'array', items: { type: 'string' }, description: 'Things that were decided, one short line each. Only real decisions.' },
    action_items: { type: 'array', items: ITEM, description: 'Things someone has to do next.' },
    open_questions: { type: 'array', items: { type: 'string' }, description: 'Questions left open / things to find out.' },
  },
  required: ['is_meeting', 'title', 'date_text', 'attendees', 'summary', 'decisions', 'action_items', 'open_questions'],
  additionalProperties: false,
};

function calendar(today) {
  const [y, m, d] = today.split('-').map(Number);
  const out = [];
  for (let i = -7; i < 15; i++) {
    const k = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    out.push(`${k} ${weekdayName(k)}${i === 0 ? ' (today)' : ''}`);
  }
  return out.join('\n');
}

export function meetingPrompt({ botName }) {
  return [
    `You are ${botName}, the LINE helper of the δelta Edu. team (pronounced "Delta Edu"), a small Thai tutoring institution with two brands: δelta Edu. (live online small groups for university students, starting with Chulalongkorn: first/second-year foundations and Chemical Engineering) and δelta Edu. LITE (international secondary students: SAT, GED, IGCSE, A-Level). Users are the partners, staff and tutors only.`,
    'You get notes from one team meeting: typed text, a voice recording, or a photo of a whiteboard or notebook. Read or listen to all of it (Thai and English mixed), then fill the JSON.',
    'Rules:',
    '- Only include what is actually in the notes. Never invent decisions, owners, dates or numbers.',
    '- Decisions are things agreed. Action items are things someone must do. Questions are things still unknown.',
    '- Owners: only names that appear in the notes. If an item has no owner, leave owners empty. Names can be nicknames or Thai spellings; copy them as said.',
    '- due_text must be the words from the notes; due_date must come from the CALENDAR. No date words means both empty.',
    '- Keep each line short (under 90 characters). Always write in English, even when the notes are in Thai.',
    '- Leave out phone numbers, emails and anything about individual students\' private details.',
    '- If the input is clearly not meeting notes, set is_meeting false and leave the lists empty.',
  ].join('\n');
}

export function meetingContext({ today, members, sender }) {
  return [
    `TODAY: ${today} (${weekdayName(today)}, ${formatDay(today, today)})`,
    'CALENDAR:', calendar(today),
    `SENDER: ${sender}`,
    `TEAM: ${members.map((m) => [m.nickname, ...m.aliases].join('/')).join(', ')}`,
  ].join('\n');
}

/** media: [{ mimeType, data(base64) }]. Returns the parsed object with defaults. */
export async function readMeeting(ai, { botName, text = '', media = [], ctx }) {
  const out = await ai.extract({
    system: meetingPrompt({ botName }),
    parts: [
      ...media.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data } })),
      { text: `${meetingContext(ctx)}\n\nMEETING NOTES${media.length ? ' (see the attached ' + media.map((m) => m.mimeType.split('/')[0]).join(' + ') + ')' : ''}:\n${text || '(no typed text)'}` },
    ],
    schema: MEETING_SCHEMA,
  });
  const arr = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : x)).filter(Boolean) : []);
  return {
    isMeeting: out?.is_meeting !== false,
    title: String(out?.title || '').trim(),
    dateText: String(out?.date_text || '').trim(),
    attendees: arr(out?.attendees),
    summary: String(out?.summary || '').trim(),
    decisions: arr(out?.decisions),
    actions: arr(out?.action_items).filter((a) => a && String(a.title || '').trim()),
    questions: arr(out?.open_questions),
  };
}
