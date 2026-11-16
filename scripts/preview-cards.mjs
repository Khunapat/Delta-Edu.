// Rough HTML preview of the bot's Flex cards with sample data, so the look can
// be checked without a phone:  node scripts/preview-cards.mjs > cards.html
// (LINE's own renderer differs slightly: fonts and exact spacing.)

import * as F from '../src/flex.js';

const SIZE = { xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22, xxl: 29, '3xl': 32 };
const GAP = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
const RAD = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 999 };
const px = (v, map) => (v == null ? null : map && map[v] != null ? map[v] + 'px' : String(v));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function node(n, parent) {
  const st = [];
  const m = n.margin ? px(n.margin, GAP) : null;
  if (m) st.push(parent === 'vertical' ? `margin-top:${m}` : `margin-left:${m}`);
  if (n.flex != null) st.push(n.flex === 0 ? 'flex:none' : `flex:${n.flex} 1 0`);
  if (n.type === 'text') {
    st.push(`font-size:${SIZE[n.size || 'md']}px`, `color:${n.color || '#111'}`, `font-weight:${n.weight === 'bold' ? 700 : 400}`);
    if (n.align) st.push(`text-align:${n.align === 'end' ? 'right' : n.align}`);
    if (n.wrap === false) st.push('white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
    if (n.gravity === 'center') st.push('align-self:center');
    return `<div style="${st.join(';')}">${esc(n.text)}</div>`;
  }
  if (n.type === 'separator') return `<div style="border-top:1px solid ${n.color};${m ? 'margin-top:' + m : ''}"></div>`;
  if (n.type === 'filler') return '<div style="flex:1"></div>';
  if (n.type === 'box') {
    st.push('display:flex', `flex-direction:${n.layout === 'vertical' ? 'column' : 'row'}`);
    if (n.layout === 'baseline') st.push('align-items:baseline');
    if (n.spacing) st.push(`gap:${px(n.spacing, GAP)}`);
    if (n.backgroundColor) st.push(`background:${n.backgroundColor}`);
    if (n.background?.type === 'linearGradient') st.push(`background:linear-gradient(${n.background.angle},${n.background.startColor},${n.background.endColor})`);
    if (n.borderColor) st.push(`border:${n.borderWidth === 'light' ? 0.5 : 1}px solid ${n.borderColor}`);
    if (n.cornerRadius) st.push(`border-radius:${px(n.cornerRadius, RAD)}`);
    for (const k of ['paddingAll', 'paddingTop', 'paddingBottom', 'paddingStart', 'paddingEnd']) {
      if (n[k] == null) continue;
      const v = px(n[k], GAP);
      if (k === 'paddingAll') st.push(`padding:${v}`);
      else st.push(`padding-${{ paddingTop: 'top', paddingBottom: 'bottom', paddingStart: 'left', paddingEnd: 'right' }[k]}:${v}`);
    }
    if (n.width) st.push(`width:${n.width}`);
    if (n.height) st.push(`height:${n.height}`);
    if (n.alignItems) st.push(`align-items:${n.alignItems === 'center' ? 'center' : n.alignItems}`);
    if (n.justifyContent) st.push(`justify-content:${n.justifyContent}`);
    if (n.offsetTop) st.push(`position:relative;top:${n.offsetTop}`);
    return `<div style="${st.join(';')}">${n.contents.map((c) => node(c, n.layout === 'vertical' ? 'vertical' : 'horizontal')).join('')}</div>`;
  }
  return '';
}

function bubble(b) {
  const w = { nano: 120, micro: 160, kilo: 260, mega: 300, giga: 386 }[b.size || 'mega'];
  return `<div class="bubble" style="width:${w}px">${['header', 'body', 'footer'].map((k) => (b[k] ? node(b[k], 'vertical') : '')).join('')}</div>`;
}

function message(m) {
  if (m.type === 'text' || m.type === 'textV2') return `<div class="text">${esc(m.text)}</div>`;
  const c = m.contents;
  const inner = c.type === 'carousel' ? c.contents.map(bubble).join('') : bubble(c);
  return `<div class="row">${inner}</div>`;
}

const today = '2026-11-16';
const tasks = [
  { id: 'a1', title: 'Mockup กล่อง Pocket Press', owner: 'Bonnie, Best', stream: 'Branding', status: 'doing', priority: 'high', due: '2026-11-20' },
  { id: 'a2', title: 'ขอใบเสนอราคา OEM นครปฐม', owner: 'Jai', stream: 'Supplier', status: 'blocked', priority: 'med', due: '2026-11-18', blocker: 'รอ supplier ตอบ' },
  { id: 'a3', title: 'สัมภาษณ์นักวิ่ง 5 คน', owner: 'Best', stream: 'Research', status: 'todo', priority: 'med', due: '2026-11-14' },
  { id: 'a4', title: 'สรุปผล Google Form รอบ 1', owner: 'Jai', stream: 'Research', status: 'done', priority: 'low', due: '2026-11-13' },
];
const members = [{ nickname: 'Jai' }, { nickname: 'Best' }, { nickname: 'Bonnie' }];
const draft = { id: 'd1', by: 'Jai', tasks: [{ title: 'Mockup กล่อง Pocket Press', owners: ['Bonnie', 'Best'], due: '2026-11-20', stream: 'Branding', priority: 'med' }] };

const sections = [
  ['@Norse บอนนี่ กับ Best ทำ mockup กล่อง ส่งศุกร์', [F.draftMessage(draft, today)]],
  ['@Norse งานทีม', [F.teamMessage({ members, tasks, today })]],
  ['งานฉัน (1:1)', F.taskListMessage(tasks.filter((x) => x.status !== 'done'), today)],
  ['Morning DM', F.digestMessages({
    greeting: 'อรุณสวัสดิ์ Best ☀️', today,
    sections: [{ label: '📌 ส่งวันนี้', tasks: [] }, { label: '⏰ ใกล้ส่ง', tasks: [tasks[0]] }, { label: '🔴 เลยกำหนด', tasks: [tasks[2]], color: '#F07560' }],
    actionable: [],
  })],
  ['ตั้งค่า', [F.usageMessage({
    ai: { label: 'Gemini 3.8-flash > 3.6-flash > 3.5-flash-lite', total: 23, resetText: '15:00 น.', models: [{ model: 'gemini-3.8-flash', used: 20, limit: 20, exhausted: true }, { model: 'gemini-3.5-flash-lite', used: 3, limit: null, exhausted: false }] },
    push: { used: 48, limit: 300 }, members: 3, linked: 3,
  })]],
];

console.log(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Norse cards</title><style>
body{margin:0;padding:24px;background:#7f8c8a;font-family:"Noto Sans Thai","Thonburi",system-ui,sans-serif;line-height:1.4}
h3{color:#fff;font-weight:600;font-size:14px;margin:24px 0 8px}
.row{display:flex;gap:10px;overflow-x:auto;align-items:flex-start}
.bubble{border-radius:16px;overflow:hidden;flex:none;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.text{background:#fff;border-radius:16px;padding:8px 12px;display:inline-block;max-width:300px;white-space:pre-wrap;font-size:14px}
</style></head><body>${sections.map(([h, msgs]) => `<h3>${esc(h)}</h3>${msgs.flat().map(message).join('')}`).join('')}</body></html>`);
