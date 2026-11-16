// Every card the bot sends, built by the real code (src/flex.js) with sample data.
// Used by scripts/preview-cards.mjs (look) and scripts/validate-cards.mjs (LINE's validator).
import * as F from '../../src/flex.js';

export const TODAY = '2026-11-16';
const today = TODAY;
export const tasks = [
  { id: 'a1', title: 'Mockup กล่อง Pocket Press', owner: 'Bonnie, Non', stream: 'Branding', status: 'doing', priority: 'high', due: '2026-11-20' },
  { id: 'a2', title: 'ขอใบเสนอราคา OEM นครปฐม', owner: 'Jai', stream: 'Supplier', status: 'blocked', priority: 'med', due: '2026-11-18', blocker: 'รอ supplier ตอบ' },
  { id: 'a3', title: 'สัมภาษณ์นักวิ่ง 5 คน', owner: 'Non', stream: 'Research', status: 'todo', priority: 'med', due: '2026-11-14' },
  { id: 'a4', title: 'สรุปผล Google Form รอบ 1', owner: 'Jai', stream: 'Research', status: 'done', priority: 'low', due: '2026-11-13' },
  { id: 'a5', title: 'ถ่ายรูป prototype 4 แบบ', owner: 'Bonnie', stream: 'Product', status: 'todo', priority: 'med', due: '2026-11-16' },
];
const members = [{ nickname: 'Jai' }, { nickname: 'Non' }, { nickname: 'Bonnie' }];
const draft = { id: 'd1', by: 'Jai', tasks: [{ title: 'Mockup กล่อง Pocket Press', owners: ['Bonnie', 'Non'], due: '2026-11-20', stream: 'Branding', priority: 'med' }] };

/** [{ id, title, chat: 'direct'|'group', you?: string, messages: [...] }] in chat order. */
export function samples() {
  const open = tasks.filter((x) => x.status !== 'done');
  return [
    { id: 'linked', title: 'Linking (1:1)', chat: 'direct', you: 'ฉันคือ เจ', messages: [
      F.infoMessage({ banner: 'welcome', title: 'เชื่อมแล้ว ✓', sub: 'สวัสดี Jai 👋', lines: ['ต่อไปนี้งานของคุณจะแจ้งเตือนในแชทนี้ (วันละไม่เกิน 1 ครั้ง)'], buttons: [F.say('งานฉัน', 'งานฉัน'), F.say('วันนี้ทำอะไรดี', 'วันนี้ทำอะไรดี')] }),
      F.helpMessage('direct', 'Norse'),
    ] },
    { id: 'morning', title: 'Morning reminder 08:00 (1:1, push)', chat: 'direct', messages: F.digestMessages({
      greeting: 'อรุณสวัสดิ์ Non ☀️', today,
      sections: [{ label: '📌 ส่งวันนี้', tasks: [tasks[4]] }, { label: '⏰ ใกล้ส่ง', tasks: [tasks[0]] }, { label: '🔴 เลยกำหนด', tasks: [tasks[2]], color: '#F07560' }],
      actionable: [{ ...tasks[2], _note: 'เลยมา 2 วัน' }, { ...tasks[0], _note: 'อีก 4 วัน' }],
    }) },
    { id: 'mine', title: 'งานฉัน (1:1)', chat: 'direct', you: 'งานฉัน', messages: F.taskListMessage(open.slice(0, 3), today) },
    { id: 'done', title: 'Done (1:1)', chat: 'direct', you: 'mockup เสร็จแล้ว', messages: [
      F.resultMessage({ kind: 'done', task: { ...tasks[0], status: 'done' }, today, headline: 'เยี่ยม! 🎉', note: 'เดี๋ยวกลุ่มจะเห็นเป็น ✓', noteColor: '#8C9A98', buttons: [F.say('งานฉัน', 'งานฉัน')] }),
    ] },
    { id: 'postpone', title: 'Postpone (1:1)', chat: 'direct', you: 'ขอเลื่อนสัมภาษณ์เป็นจันทร์', messages: [
      F.resultMessage({ kind: 'postpone', task: { ...tasks[2], due: '2026-11-23' }, today, note: 'จากเดิม ส. 14 พ.ย.', noteColor: '#8C9A98', buttons: [F.datePicker('เลื่อนอีก', 'a=tp&t=a3'), F.say('งานฉัน', 'งานฉัน')] }),
    ] },
    { id: 'blocked', title: 'Blocked (1:1)', chat: 'direct', you: 'ติด supplier ยังไม่ตอบ', messages: [
      F.resultMessage({ kind: 'blocked', task: tasks[1], today, headline: 'บันทึกแล้ว · เดี๋ยวบอกในกลุ่มให้ว่าใครช่วยได้', note: 'รอ supplier ตอบ', buttons: [F.postback('แก้ได้แล้ว', 'a=tu&t=a2')] }),
    ] },
    { id: 'settings', title: 'ตั้งค่า (1:1)', chat: 'direct', you: 'ตั้งค่า', messages: [F.usageMessage({
      ai: { label: 'Gemini 3.8-flash > 3.6-flash > 3.5-flash-lite', total: 23, resetText: '15:00 น.', models: [{ model: 'gemini-3.8-flash', used: 20, limit: 20, exhausted: true }, { model: 'gemini-3.6-flash', used: 3, limit: 20, exhausted: false }, { model: 'gemini-3.5-flash-lite', used: 0, limit: 500, exhausted: false }] },
      push: { used: 48, limit: 300 }, members: 3, linked: 3,
    })] },
    { id: 'meeting', title: 'Meeting notes (voice note / photo / text)', chat: 'group', you: '🎤 voice note 2:41', messages: [
      F.meetingMessage({
        id: 'mt1', title: 'ประชุมเลือกแพ็กเกจ', date: today, attendees: ['Jai', 'Bonnie', 'Non'], summary: 'คุยเรื่องแบบที่จะทำต่อ ราคา และ supplier',
        decisions: ['เลือก Pocket Press Slim ทำต่อ', 'ตั้งราคาทดลอง 159 บาท'],
        actions: [{ title: 'ทำ mockup Pocket Press Slim', owners: ['Bonnie'], due: '2026-11-20' }, { title: 'โทรถาม supplier 3 เจ้า', owners: ['Non'], due: '2026-11-17' }, { title: 'สรุปต้นทุนต่อชิ้น', owners: [], due: '' }],
        questions: ['ต้นทุนต่อชิ้นจริงเท่าไหร่', 'ใช้กลิ่นไหนเป็นตัวหลัก'],
      }, today),
    ] },
    { id: 'draft', title: 'New task from the group', chat: 'group', you: '@Norse บอนนี่ กับ นน ทำ mockup กล่อง ส่งศุกร์', messages: [F.draftMessage(draft, today)] },
    { id: 'created', title: 'Confirmed', chat: 'group', messages: [F.createdMessage([{ ...tasks[0], owner: 'Bonnie, Non' }], today, 'Jai')] },
    { id: 'team', title: '@Norse งานทีม', chat: 'group', you: '@Norse งานทีม', messages: [F.teamMessage({ members, tasks, today })] },
    { id: 'blocked-group', title: 'Blocked line in the group (push)', chat: 'group', messages: [
      F.resultMessage({ kind: 'blocked', task: tasks[1], today, headline: 'Jai ติดงานนี้ · ใครช่วยได้บ้าง? 🙋', note: 'รอ supplier ตอบ' }),
    ] },
    { id: 'notices', title: '✓ round-up (with a reply or 18:00)', chat: 'group', messages: [F.noticesMessage('✓ Bonnie, Non · Mockup กล่อง Pocket Press\n✓ Jai · สรุปผล Google Form รอบ 1', 'วันนี้เสร็จแล้ว 🎉')] },
    { id: 'monday', title: 'Monday 09:00 plan (group, push)', chat: 'group', messages: [F.weeklyMessage({
      title: 'แผนสัปดาห์นี้ 💪', subtitle: 'จ. 16 พ.ย. – อา. 22 พ.ย.', today,
      stats: [{ label: 'ส่งสัปดาห์นี้', value: 3, color: '#8FD9C6' }, { label: 'ค้างจากก่อน', value: 1, color: '#E8B14A' }, { label: 'ติดอยู่', value: 1, color: '#F07560' }],
      sections: [
        { label: '📅 ส่งสัปดาห์นี้ (3)', lines: ['Bonnie: Mockup กล่อง Pocket Press (ศ. 20 พ.ย.), ถ่ายรูป prototype (จ. 16 พ.ย.)', 'Jai: ขอใบเสนอราคา OEM (พ. 18 พ.ย.)'] },
        { label: '🏁 Milestone', lines: ['Prototype ready · ศ. 20 พ.ย.'] },
        { label: '🔴 ค้างจากก่อนหน้า (1)', color: '#F07560', lines: ['สัมภาษณ์นักวิ่ง 5 คน (Non)'] },
      ],
    })] },
    { id: 'board', title: '@Norse บอร์ด', chat: 'group', you: '@Norse บอร์ด', messages: [F.infoMessage({
      title: 'บอร์ดทีม NORSE', sub: 'งาน · ไทม์ไลน์ · ทีม · รีเสิร์ช · ยอดขาย', lines: ['ข้อมูลเดียวกับใน LINE: แก้ที่บอร์ด Norse ก็แจ้งในแชทให้'],
      buttons: [{ type: 'uri', label: 'เปิดบอร์ด', uri: 'https://liff.line.me/2000000000-xxxxxxxx' }],
    })] },
    { id: 'resting', title: 'AI quota used up', chat: 'group', messages: [F.infoMessage({
      tone: 'warn', title: 'AI พักอยู่ 😴', lines: ['โควตาฟรีวันนี้หมดแล้ว กลับมา 15:00 น.\nระหว่างนี้ปุ่มกับคำสั่ง งานฉัน / งานทีม / เสร็จแล้ว ยังใช้ได้ปกติ'],
      buttons: [F.say('งานฉัน', '@Norse งานฉัน'), F.say('งานทีม', '@Norse งานทีม')],
    })] },
  ];
}
