// Every card the bot sends, built by the real code (src/flex.js) with sample data.
// Used by scripts/preview-cards.mjs (look) and scripts/validate-cards.mjs (LINE's validator).
import * as F from '../../src/flex.js';

export const TODAY = '2026-11-16';
const today = TODAY;
export const tasks = [
  { id: 'a1', title: 'Thermo I lesson 1 slides', owner: 'Kiak, Best', stream: 'Uni', status: 'doing', priority: 'high', due: '2026-11-20' },
  { id: 'a2', title: 'Register the business', owner: 'Jai', stream: 'Both', status: 'blocked', priority: 'med', due: '2026-11-18', blocker: 'Needs a partner decision' },
  { id: 'a3', title: 'SAT 6 Days 7 Tests flyer', owner: 'Pure', stream: 'LITE', status: 'todo', priority: 'med', due: '2026-11-14' },
  { id: 'a4', title: 'Rename AlDenté social accounts', owner: 'Pure', stream: 'LITE', status: 'done', priority: 'low', due: '2026-11-13' },
  { id: 'a5', title: 'IGCSE Physics worksheet 1', owner: 'Kiak', stream: 'LITE', status: 'todo', priority: 'med', due: '2026-11-16' },
];
const members = [{ nickname: 'Best' }, { nickname: 'Jai' }, { nickname: 'Kiak' }, { nickname: 'Pure' }];
const draft = { id: 'd1', by: 'Jai', tasks: [{ title: 'Thermo I lesson 1 slides', owners: ['Kiak', 'Best'], due: '2026-11-20', stream: 'Uni', priority: 'med' }] };

/** [{ id, title, chat: 'direct'|'group', you?: string, messages: [...] }] in chat order. */
export function samples() {
  const open = tasks.filter((x) => x.status !== 'done');
  return [
    { id: 'linked', title: 'Linking (1:1)', chat: 'direct', you: 'I am Jai', messages: [
      F.infoMessage({ banner: 'welcome', title: 'Linked ✓', sub: 'Hi Jai 👋', lines: ['Your tasks and classes will be sent to this chat (at most once a day).'], buttons: [F.say('My tasks', 'my tasks'), F.say('Today', 'today')] }),
      F.helpMessage('direct', 'Delta'),
    ] },
    { id: 'morning', title: 'Morning reminder 08:00 (1:1, push)', chat: 'direct', messages: F.digestMessages({
      greeting: 'Good morning Kiak ☀️', today,
      sections: [{ label: '📌 Due today', tasks: [tasks[4]] }, { label: '⏰ Due soon', tasks: [tasks[0]] }, { label: '🔴 Overdue', tasks: [tasks[2]], color: '#C8462F' }],
      actionable: [{ ...tasks[2], _note: '2 days late' }, { ...tasks[0], _note: 'in 4 days' }],
    }) },
    { id: 'mine', title: 'My tasks (1:1)', chat: 'direct', you: 'my tasks', messages: F.taskListMessage(open.slice(0, 3), today) },
    { id: 'done', title: 'Done (1:1)', chat: 'direct', you: 'thermo slides done', messages: [
      F.resultMessage({ kind: 'done', task: { ...tasks[0], status: 'done' }, today, headline: 'Nice work! 🎉', note: 'The group will see it as a ✓', noteColor: '#5F6B5B', buttons: [F.say('My tasks', 'my tasks')] }),
    ] },
    { id: 'postpone', title: 'Postpone (1:1)', chat: 'direct', you: 'push the flyer to monday', messages: [
      F.resultMessage({ kind: 'postpone', task: { ...tasks[2], due: '2026-11-23' }, today, note: 'was Sat 14 Nov', noteColor: '#5F6B5B', buttons: [F.datePicker('Move again', 'a=tp&t=a3'), F.say('My tasks', 'my tasks')] }),
    ] },
    { id: 'blocked', title: 'Blocked (1:1)', chat: 'direct', you: 'blocked, needs a partner decision', messages: [
      F.resultMessage({ kind: 'blocked', task: tasks[1], today, headline: "Saved · I'll ask the group who can help", note: 'Needs a partner decision', buttons: [F.postback('Unblocked', 'a=tu&t=a2')] }),
    ] },
    { id: 'settings', title: 'Settings (1:1)', chat: 'direct', you: 'settings', messages: [F.usageMessage({
      ai: { label: 'Gemini 3.8-flash > 3.6-flash > 3.5-flash-lite', total: 23, resetText: 'at 15:00', models: [{ model: 'gemini-3.8-flash', used: 20, limit: 20, exhausted: true }, { model: 'gemini-3.6-flash', used: 3, limit: 20, exhausted: false }, { model: 'gemini-3.5-flash-lite', used: 0, limit: 500, exhausted: false }] },
      push: { used: 48, limit: 300 }, members: 4, linked: 4,
    })] },
    { id: 'meeting', title: 'Meeting notes (voice note / photo / text)', chat: 'group', you: '🎤 voice note 2:41', messages: [
      F.meetingMessage({
        id: 'mt1', title: 'Thermo I launch', date: today, attendees: ['Best', 'Jai', 'Kiak', 'Pure'], summary: 'Planned the first Thermodynamics I cohort and the LITE rename.',
        decisions: ['Start Thermo I in January', 'Max 12 students per group'],
        actions: [{ title: 'Thermo I lesson 1 slides', owners: ['Kiak'], due: '2026-11-20' }, { title: 'Post the class schedule', owners: ['Pure'], due: '2026-11-17' }, { title: 'Draft refund policy', owners: [], due: '' }],
        questions: ['Thermo I price?', 'Which day of the week?'],
      }, today),
    ] },
    { id: 'draft', title: 'New task from the group', chat: 'group', you: '@Delta Kiak and Best: Thermo I lesson 1 slides by Friday', messages: [F.draftMessage(draft, today)] },
    { id: 'created', title: 'Confirmed', chat: 'group', messages: [F.createdMessage([{ ...tasks[0], owner: 'Kiak, Best' }], today, 'Jai')] },
    { id: 'team', title: '@Delta team', chat: 'group', you: '@Delta team', messages: [F.teamMessage({ members, tasks, today })] },
    { id: 'blocked-group', title: 'Blocked line in the group (push)', chat: 'group', messages: [
      F.resultMessage({ kind: 'blocked', task: tasks[1], today, headline: 'Jai is blocked · who can help? 🙋', note: 'Needs a partner decision' }),
    ] },
    { id: 'notices', title: '✓ round-up (with a reply or 18:00)', chat: 'group', messages: [F.noticesMessage('✓ Kiak, Best · Thermo I lesson 1 slides\n✓ Pure · Rename AlDenté social accounts', 'Done today 🎉')] },
    { id: 'monday', title: 'Monday 09:00 plan (group, push)', chat: 'group', messages: [F.weeklyMessage({
      title: "This week's plan 💪", subtitle: 'Mon 16 Nov – Sun 22 Nov', today,
      stats: [{ label: 'Due this week', value: 3, color: '#0B5C03' }, { label: 'Carried over', value: 1, color: '#B7791F' }, { label: 'Blocked', value: 1, color: '#C8462F' }],
      sections: [
        { label: '📅 Due this week (3)', lines: ['Kiak: Thermo I lesson 1 slides (Fri 20 Nov), IGCSE Physics worksheet 1 (Mon 16 Nov)', 'Jai: Register the business (Wed 18 Nov)'] },
        { label: '🏁 Milestone', lines: ['Brand launch · Tue 15 Dec'] },
        { label: '🔴 Carried over (1)', color: '#C8462F', lines: ['SAT 6 Days 7 Tests flyer (Pure)'] },
      ],
    })] },
    { id: 'board', title: '@Delta board', chat: 'group', you: '@Delta board', messages: [F.infoMessage({
      title: 'δelta Edu. board', sub: 'Tasks · Classes · Decisions · Meetings · Timeline', lines: ['Same data as in LINE: changes on the board are announced here by Delta.'],
      buttons: [{ type: 'uri', label: 'Open board', uri: 'https://liff.line.me/2000000000-xxxxxxxx' }],
    })] },
    { id: 'resting', title: 'AI quota used up', chat: 'group', messages: [F.infoMessage({
      tone: 'warn', title: 'AI is resting 😴', lines: ["The AI is resting (today's free quota is used up). It's back at 15:00 😴\nButtons and commands (my tasks, team, classes, done) still work."],
      buttons: [F.say('My tasks', '@Delta my tasks'), F.say('Team', '@Delta team')],
    })] },
  ];
}
