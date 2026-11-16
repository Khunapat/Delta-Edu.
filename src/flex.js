// LINE Flex cards, styled after the team's NORSE Project Overview dashboard
// (dark panels, mint accent, pill tags and pill buttons, gradient hero tile).
// Every button is a postback or a date picker, so tapping never costs an AI call.

import { formatDay, relDays, diffDays } from './dates.js';
import { ownersOf, STATUS_TH } from './team.js';

// Dashboard tokens (data-ui="dark").
export const C = {
  bg: '#0C1112', panel: '#141B1D', panel2: '#1A2326', ink: '#E7EFED', muted: '#8C9A98', line: '#232E31',
  accent: '#8FD9C6', accent2: '#5FBFA9', accentSoft: '#1C3631', onAccent: '#0C1715',
  heroA: '#9FE3D1', heroB: '#5FBFA9',
  todo: '#5B6A68', doing: '#8FD9C6', blocked: '#F07560', done: '#78D18F', warn: '#E8B14A',
  blockedSoft: '#3A201B', warnSoft: '#382D15', doneSoft: '#1A3322',
  streams: ['#8FD9C6', '#AC97EE', '#EFA064', '#78D18F', '#EA86B8', '#8EAEE6'],
};

export function streamColor(name) {
  let h = 0;
  for (const ch of String(name || 'General')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return C.streams[h % C.streams.length];
}

// ---- primitives --------------------------------------------------------
export const textMsg = (text, quickReply) => ({ type: 'text', text: String(text).slice(0, 4900), ...(quickReply ? { quickReply } : {}) });
export const flex = (altText, contents, quickReply) => ({ type: 'flex', altText: String(altText).slice(0, 380), contents, ...(quickReply ? { quickReply } : {}) });
const t = (text, o = {}) => ({ type: 'text', text: String(text || ' '), wrap: true, size: 'sm', color: C.ink, ...o });
const box = (layout, contents, o = {}) => ({ type: 'box', layout, contents: contents.filter(Boolean), ...o });
const sep = (margin = 'md') => ({ type: 'separator', color: C.line, margin });
const filler = () => ({ type: 'filler' });

export const postback = (label, data, displayText) => ({ type: 'postback', label: label.slice(0, 20), data, ...(displayText ? { displayText } : {}) });
export const datePicker = (label, data, { initial, min } = {}) => ({
  type: 'datetimepicker', label: label.slice(0, 20), data, mode: 'date',
  ...(initial ? { initial } : {}), ...(min ? { min } : {}),
});

export function quickReply(actions) {
  return { items: actions.slice(0, 13).map((action) => ({ type: 'action', action })) };
}

/** Pill button like the dashboard's .btn / .btn.primary. */
function pill(action, kind = 'secondary', o = {}) {
  const styles = {
    primary: { backgroundColor: C.accent, color: C.onAccent, border: C.accent },
    secondary: { backgroundColor: C.panel2, color: C.ink, border: C.line },
    danger: { backgroundColor: C.panel, color: C.blocked, border: C.blocked },
    ghost: { backgroundColor: C.panel, color: C.muted, border: C.panel },
  }[kind];
  return box('vertical', [t(action.label, { align: 'center', size: 'sm', weight: 'bold', color: styles.color, wrap: false })], {
    action, backgroundColor: styles.backgroundColor, borderColor: styles.border, borderWidth: 'normal',
    cornerRadius: 'xxl', paddingTop: '9px', paddingBottom: '9px', paddingStart: '12px', paddingEnd: '12px', flex: 1, ...o,
  });
}
const pillRow = (...items) => box('horizontal', items, { spacing: 'sm' });

/** Status / priority tag like .tag.* */
function tag(text, kind) {
  const s = {
    todo: [C.panel2, C.muted, C.line], doing: [C.accentSoft, C.doing], blocked: [C.blockedSoft, C.blocked],
    done: [C.doneSoft, C.done], overdue: [C.warnSoft, C.warn], high: [C.blockedSoft, C.blocked],
    med: [C.warnSoft, C.warn], low: [C.panel2, C.muted, C.line],
  }[kind] || [C.panel2, C.muted, C.line];
  return box('vertical', [t(text, { size: 'xxs', weight: 'bold', color: s[1], wrap: false })], {
    backgroundColor: s[0], cornerRadius: 'xxl', paddingStart: '9px', paddingEnd: '9px', paddingTop: '2px', paddingBottom: '2px',
    flex: 0, ...(s[2] ? { borderColor: s[2], borderWidth: 'light' } : {}),
  });
}
function streamTag(name) {
  return box('vertical', [t(name || 'General', { size: 'xxs', weight: 'bold', color: streamColor(name), wrap: false })], {
    backgroundColor: C.panel, borderColor: C.line, borderWidth: 'light', cornerRadius: 'xxl',
    paddingStart: '9px', paddingEnd: '9px', paddingTop: '2px', paddingBottom: '2px', flex: 0,
  });
}
const tags = (...items) => box('horizontal', items.filter(Boolean), { spacing: 'xs' });

/** Round avatar with initials like .avatar */
function avatar(name, size = '28px') {
  const initials = String(name || '?').trim().slice(0, 2).toUpperCase();
  return box('vertical', [t(initials, { size: 'xxs', weight: 'bold', align: 'center', color: C.onAccent, wrap: false })], {
    width: size, height: size, cornerRadius: 'xxl', backgroundColor: streamColor('@' + name), justifyContent: 'center', flex: 0,
  });
}

/** Gradient hero header like .kpi.hero */
function hero(title, sub, big) {
  return box('vertical', [
    t(title, { size: 'sm', weight: 'bold', color: C.onAccent }),
    big != null ? t(String(big), { size: '3xl', weight: 'bold', color: C.onAccent, margin: 'sm' }) : null,
    sub ? t(sub, { size: 'xs', color: C.onAccent, margin: 'xs' }) : null,
  ], {
    background: { type: 'linearGradient', angle: '140deg', startColor: C.heroA, endColor: C.heroB },
    paddingAll: '16px',
  });
}

function plainHeader(title, sub) {
  return box('vertical', [
    t(title, { size: 'md', weight: 'bold', color: C.ink }),
    sub ? t(sub, { size: 'xs', color: C.muted, margin: 'xs' }) : null,
  ], { backgroundColor: C.panel, paddingAll: '16px', paddingBottom: '4px' });
}

function bubble({ header, body = [], footer = [], size = 'kilo', bodyBg = C.panel }) {
  return {
    type: 'bubble',
    size,
    header,
    body: box('vertical', body.length ? body : [t(' ')], { spacing: 'sm', backgroundColor: bodyBg, paddingAll: '16px' }),
    footer: footer.length ? box('vertical', footer, { spacing: 'sm', backgroundColor: bodyBg, paddingAll: '12px', paddingTop: '4px' }) : undefined,
    styles: { header: { backgroundColor: C.panel }, body: { backgroundColor: bodyBg }, footer: { backgroundColor: bodyBg } },
  };
}

const row = (icon, value, color = C.ink) => box('baseline', [
  t(icon, { flex: 0, size: 'sm' }),
  t(value, { color, margin: 'sm', flex: 1, size: 'sm' }),
], { spacing: 'sm' });

export function dueLabel(due, today, status) {
  if (!due) return { text: 'ยังไม่มีวันส่ง', color: C.muted, late: false };
  const n = diffDays(today, due);
  if (status === 'done') return { text: formatDay(due, today), color: C.muted, late: false };
  return { text: `${formatDay(due, today)} · ${relDays(n)}`, color: n <= 1 ? C.warn : C.muted, late: n < 0 };
}

// ---- drafts (confirm before saving) ------------------------------------
export function draftMessage(draft, today) {
  const bubbles = draft.tasks.map((task, i) => {
    const due = task.due ? dueLabel(task.due, today) : task.noDue ? { text: 'ไม่มีกำหนดส่ง', color: C.muted } : { text: 'ยังไม่มีวันส่ง', color: C.blocked };
    const ready = task.owners.length && (task.due || task.noDue);
    return bubble({
      header: plainHeader(draft.tasks.length > 1 ? `งานใหม่ ${i + 1}/${draft.tasks.length}` : 'งานใหม่ · รอยืนยัน', `จาก ${draft.by}`),
      body: [
        tags(streamTag(task.stream), tag({ high: 'High', med: 'Medium', low: 'Low' }[task.priority] || 'Medium', task.priority || 'med'), !ready ? tag('ยังไม่ครบ', 'overdue') : null),
        t(task.title, { weight: 'bold', size: 'md', margin: 'md' }),
        task.owners.length
          ? box('horizontal', [...task.owners.slice(0, 4).map((o) => avatar(o, '24px')), t(task.owners.join(', '), { size: 'xs', color: C.muted, gravity: 'center', margin: 'sm' })], { spacing: 'xs', margin: 'md' })
          : row('👤', 'ยังไม่รู้ว่าใครทำ', C.blocked),
        row('📅', due.text, due.color),
      ],
      footer: [
        pill(postback('ยืนยัน', `a=dok&d=${draft.id}`), 'primary'),
        pillRow(
          pill(datePicker('วันส่ง', `a=ddt&d=${draft.id}&i=${i}`, { initial: task.due && task.due >= today ? task.due : today, min: today })),
          pill(postback('คนทำ', `a=dow&d=${draft.id}&i=${i}`)),
        ),
        pillRow(
          pill(postback('ชื่องาน', `a=dti&d=${draft.id}&i=${i}`)),
          pill(postback('หมวด', `a=dst&d=${draft.id}&i=${i}`)),
        ),
        pill(postback('ยกเลิก', `a=dx&d=${draft.id}`), 'ghost'),
      ],
    });
  });
  const alt = `งานใหม่รอยืนยัน: ${draft.tasks.map((x) => x.title).join(', ')}`;
  return flex(alt, bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles.slice(0, 10) });
}

export function createdMessage(tasks, today, by) {
  return flex(`เพิ่มงานแล้ว ${tasks.length} งาน`, bubble({
    header: hero('เพิ่มงานแล้ว ✓', by ? `ยืนยันโดย ${by}` : undefined),
    body: tasks.flatMap((task, i) => {
      const due = dueLabel(task.due, today);
      return [
        i ? sep() : null,
        tags(streamTag(task.stream)),
        t(task.title, { weight: 'bold' }),
        t(`${ownersOf(task).join(', ')} · ${due.text}`, { size: 'xs', color: C.muted }),
      ];
    }),
  }));
}

// ---- tasks (like the kanban .tcard) -------------------------------------
export function taskBubble(task, today, { actions = true, note } = {}) {
  const due = dueLabel(task.due, today, task.status);
  const footer = [];
  if (actions && task.status !== 'done') {
    footer.push(pill(postback('เสร็จแล้ว ✓', `a=td&t=${task.id}`, `${task.title} เสร็จแล้ว`), 'primary'));
    footer.push(pillRow(
      pill(datePicker('ขอเลื่อน', `a=tp&t=${task.id}`, { initial: task.due && task.due > today ? task.due : today, min: today })),
      task.status === 'blocked'
        ? pill(postback('แก้ได้แล้ว', `a=tu&t=${task.id}`, 'แก้ได้แล้ว'))
        : pill(postback('ติดอยู่', `a=tb&t=${task.id}`), 'danger'),
    ));
  }
  return bubble({
    bodyBg: C.panel2,
    body: [
      tags(streamTag(task.stream), tag(STATUS_TH[task.status], task.status), due.late ? tag('เลยกำหนด', 'overdue') : null),
      note ? t(note, { size: 'xs', color: C.warn, weight: 'bold', margin: 'md' }) : null,
      t(task.title, { weight: 'bold', size: 'md', margin: note ? 'xs' : 'md' }),
      task.status === 'blocked' && task.blocker ? t(task.blocker, { size: 'xs', color: C.blocked }) : null,
      box('horizontal', [
        t(task.due ? due.text : 'ยังไม่มีวันส่ง', { size: 'xs', color: due.late ? C.warn : C.muted, weight: due.late ? 'bold' : 'regular', gravity: 'center', flex: 1 }),
        box('horizontal', ownersOf(task).slice(0, 3).map((o) => avatar(o, '22px')), { spacing: 'xs', flex: 0 }),
      ], { margin: 'md' }),
    ],
    footer,
  });
}

export function taskListMessage(tasks, today, { empty = 'ไม่มีงานค้าง 🎉', alt = 'งานของฉัน', notes = {} } = {}) {
  if (!tasks.length) return textMsg(empty);
  const bubbles = tasks.slice(0, 10).map((x) => taskBubble(x, today, { note: notes[x.id] }));
  const more = tasks.length > 10 ? [textMsg(`และอีก ${tasks.length - 10} งาน (แสดง 10 งานที่ใกล้ส่งที่สุด)`)] : [];
  return [flex(`${alt} (${tasks.length})`, bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }), ...more];
}

// ---- team overview (KPI tiles + people + risks) --------------------------
function kpiTile(label, value, color = C.ink) {
  return box('vertical', [
    t(String(value), { size: 'xl', weight: 'bold', color, wrap: false }),
    t(label, { size: 'xxs', color: C.muted, wrap: false }),
  ], { backgroundColor: C.panel2, borderColor: C.line, borderWidth: 'light', cornerRadius: 'lg', paddingAll: '10px', flex: 1 });
}

export function teamMessage({ members, tasks, today }) {
  const open = tasks.filter((x) => x.status !== 'done');
  const done = tasks.filter((x) => x.status === 'done');
  const overdue = open.filter((x) => x.due && x.due < today && x.status !== 'blocked');
  const blocked = open.filter((x) => x.status === 'blocked');
  const pct = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0;
  const people = members.map((m) => {
    const mine = open.filter((x) => ownersOf(x).includes(m.nickname));
    const cur = mine.find((x) => x.status === 'blocked') || mine.find((x) => x.status === 'doing') || [...mine].sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))[0];
    return box('horizontal', [
      avatar(m.nickname, '30px'),
      box('vertical', [
        t(m.nickname, { weight: 'bold', size: 'sm' }),
        t(cur ? `กำลังทำ ${cur.title}` : 'ไม่มีงานค้าง', { size: 'xxs', color: C.muted }),
      ], { flex: 1, margin: 'md' }),
      cur ? tag(STATUS_TH[cur.status], cur.status) : tag('ว่าง', 'done'),
    ], { alignItems: 'center', margin: 'md' });
  });
  const risk = (x, kind) => box('horizontal', [
    box('vertical', [filler()], { width: '4px', backgroundColor: kind === 'blocked' ? C.blocked : C.warn }),
    box('vertical', [
      t(x.title, { size: 'xs', weight: 'bold' }),
      t(`${x.stream} · ${ownersOf(x).join(', ')}${x.due ? ' · ' + relDays(diffDays(today, x.due)) : ''}`, { size: 'xxs', color: C.muted }),
      kind === 'blocked' && x.blocker ? t(x.blocker, { size: 'xxs', color: C.ink }) : null,
    ], { paddingAll: '8px', flex: 1 }),
  ], { backgroundColor: C.panel2, borderColor: C.line, borderWidth: 'light', cornerRadius: 'md', margin: 'sm' });
  const risks = [...blocked.map((x) => risk(x, 'blocked')), ...overdue.map((x) => risk(x, 'overdue'))].slice(0, 6);
  return flex('งานทีม', bubble({
    size: 'mega',
    header: hero('งานทีม', `เสร็จแล้ว ${pct}% ของงานทั้งหมด`, `${open.length} งานเปิดอยู่`),
    body: [
      box('horizontal', [
        kpiTile('เสร็จ', done.length, C.done),
        kpiTile('กำลังทำ', open.filter((x) => x.status === 'doing').length, C.doing),
        kpiTile('เลยกำหนด', overdue.length, overdue.length ? C.warn : C.ink),
        kpiTile('ติดอยู่', blocked.length, blocked.length ? C.blocked : C.ink),
      ], { spacing: 'xs' }),
      t('ทีม', { weight: 'bold', size: 'sm', margin: 'lg' }),
      ...people,
      risks.length ? t(`ความเสี่ยง · ติด ${blocked.length} · เลยกำหนด ${overdue.length}`, { weight: 'bold', size: 'sm', margin: 'lg' }) : null,
      ...risks,
    ],
  }));
}

// ---- digests / briefs ----------------------------------------------------
export function digestMessages({ greeting, sections, today, actionable }) {
  const lines = [];
  for (const s of sections) {
    if (!s.tasks.length) continue;
    lines.push(t(s.label, { weight: 'bold', size: 'sm', margin: 'lg', color: s.color || C.ink }));
    for (const x of s.tasks.slice(0, 6)) {
      const d = dueLabel(x.due, today, x.status);
      lines.push(box('horizontal', [
        box('vertical', [filler()], { width: '8px', height: '8px', cornerRadius: 'xxl', backgroundColor: streamColor(x.stream), flex: 0, offsetTop: '5px' }),
        box('vertical', [
          t(x.title, { size: 'xs', weight: 'bold' }),
          t(d.text, { size: 'xxs', color: d.late ? C.warn : C.muted }),
        ], { flex: 1, margin: 'md' }),
      ], { margin: 'sm' }));
    }
  }
  const total = sections.reduce((n, s) => n + s.tasks.length, 0);
  const out = [flex(greeting, bubble({
    size: 'mega',
    header: hero(greeting, total ? `${total} งานที่ควรดู` : 'วันนี้ไม่มีงานค้าง 🎉'),
    body: lines.length ? lines : [t('สบายๆ ไม่มีอะไรต้องรีบ', { color: C.muted, size: 'xs' })],
  }))];
  if (actionable?.length) {
    const bubbles = actionable.slice(0, 10).map((x) => taskBubble(x, today, { note: x._note }));
    out.push(flex('งานที่ต้องอัปเดต', bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }));
  }
  return out;
}

export function weeklyMessage({ title, subtitle, sections }) {
  const body = [];
  for (const s of sections) {
    body.push(t(s.label, { weight: 'bold', size: 'sm', margin: 'lg', color: s.color || C.ink }));
    if (!s.lines.length) body.push(t('—', { size: 'xs', color: C.muted }));
    for (const l of s.lines.slice(0, 12)) body.push(t(l, { size: 'xs', color: C.muted }));
  }
  return flex(title, bubble({ size: 'mega', header: hero(title, subtitle), body }));
}

// ---- settings / AI usage -------------------------------------------------
export function usageMessage({ ai, push, members, linked }) {
  const rows = ai.models.length ? ai.models.map((m) => box('horizontal', [
    t(m.model.replace(/^gemini-/, ''), { size: 'xs', flex: 3 }),
    m.exhausted ? tag('หมดวันนี้', 'blocked') : t(`${m.used}${m.limit ? '/' + m.limit : ''}`, { size: 'xs', color: C.muted, flex: 2, align: 'end' }),
  ], { alignItems: 'center' })) : [t('ยังไม่ได้ใช้ AI วันนี้', { size: 'xs', color: C.muted })];
  return flex('ตั้งค่าและการใช้งาน', bubble({
    size: 'mega',
    header: hero('ตั้งค่า · การใช้งาน', ai.label, `AI ${ai.total} ครั้งวันนี้`),
    body: [
      t(`โควตา AI รีเซ็ต ${ai.resetText}`, { size: 'xs', color: C.muted }),
      ...rows,
      sep('lg'),
      box('horizontal', [
        kpiTile('push เดือนนี้', `${push.used}/${push.limit}`, push.used > push.limit * 0.8 ? C.blocked : C.ink),
        kpiTile('เชื่อม LINE', `${linked}/${members}`),
      ], { spacing: 'xs', margin: 'lg' }),
    ],
  }));
}

// ---- small cards for outcomes (instead of plain text) ---------------------
/** Tap = the user "types" this text (free, no AI). In a group it needs @Norse in front. */
export const say = (label, text) => ({ type: 'message', label: label.slice(0, 20), text });

const RESULT = {
  done: { icon: '✓', label: 'เสร็จแล้ว', color: C.done, soft: C.doneSoft },
  postpone: { icon: '📅', label: 'เลื่อนวันส่งแล้ว', color: C.accent, soft: C.accentSoft },
  start: { icon: '▶', label: 'เริ่มแล้ว', color: C.doing, soft: C.accentSoft },
  unblock: { icon: '▶', label: 'กลับมาเดินต่อ', color: C.doing, soft: C.accentSoft },
  blocked: { icon: '🚧', label: 'ติดอยู่', color: C.blocked, soft: C.blockedSoft },
  already: { icon: '✓', label: 'เสร็จไปแล้ว', color: C.muted, soft: C.panel2 },
};

function chip(kind) {
  const k = RESULT[kind];
  return box('horizontal', [t(`${k.icon}  ${k.label}`, { size: 'xs', weight: 'bold', color: k.color, wrap: false })], {
    backgroundColor: k.soft, cornerRadius: 'xxl', paddingStart: '12px', paddingEnd: '12px', paddingTop: '4px', paddingBottom: '4px', flex: 0,
  });
}

/**
 * One task after a change: status chip, title, workstream, people, due date, a note,
 * and buttons for the next step. `headline` replaces the chip text's meaning in the alt text.
 */
export function resultMessage({ kind, task, today, note, noteColor, headline, buttons = [] }) {
  const k = RESULT[kind];
  const due = dueLabel(task.due, today, kind === 'done' || kind === 'already' ? 'done' : task.status);
  // alt text = what shows in notifications and chat lists
  return flex(`${k.icon} ${k.label}: ${task.title}${headline ? ' · ' + headline : ''}`.slice(0, 380), bubble({
    body: [
      box('horizontal', [chip(kind), filler()]),
      headline ? t(headline, { size: 'xs', color: C.muted, margin: 'md' }) : null,
      t(task.title, { weight: 'bold', size: 'md', margin: headline ? 'xs' : 'md' }),
      note ? t(note, { size: 'sm', color: noteColor || k.color, margin: 'sm' }) : null,
      box('horizontal', [
        streamTag(task.stream),
        t(due.text, { size: 'xs', color: due.color, gravity: 'center', margin: 'md', flex: 1, wrap: false }),
        box('horizontal', ownersOf(task).slice(0, 3).map((o) => avatar(o, '22px')), { spacing: 'xs', flex: 0 }),
      ], { margin: 'lg', alignItems: 'center' }),
    ],
    footer: buttons.length ? [pillRow(...buttons.slice(0, 2).map((a, i) => pill(a, i === 0 ? 'primary' : 'secondary')))] : [],
  }));
}

/** Group ✓ lines ("✓ Jai · mockup") as one card. */
export function noticesMessage(text, title = 'อัปเดตจากทีม') {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  return flex(`${title}: ${lines.join(' / ')}`.slice(0, 380), bubble({
    body: [
      t(title, { weight: 'bold', size: 'sm', color: C.ink }),
      ...lines.slice(0, 15).map((l) => {
        const m = /^✓\s*(.*?)\s*·\s*(.*)$/.exec(l);
        return box('horizontal', [
          t('✓', { size: 'sm', weight: 'bold', color: C.done, flex: 0 }),
          m
            ? box('vertical', [t(m[2], { size: 'sm', weight: 'bold' }), t(m[1], { size: 'xxs', color: C.muted })], { margin: 'md', flex: 1 })
            : t(l.replace(/^✓\s*/, ''), { size: 'sm', margin: 'md', flex: 1 }),
        ], { margin: 'md' });
      }),
    ],
  }));
}

/**
 * Hero card for one-off moments (linked, group set, welcome, AI resting, help).
 *   steps:   [{ text, cmd? }]  (cmd = tappable row that sends a command)
 *   buttons: actions for pill buttons
 */
export function infoMessage({ title, sub, alt, tone = 'hero', lines = [], steps = [], buttons = [] }) {
  const header = tone === 'hero' ? hero(title, sub) : box('vertical', [
    t(title, { size: 'md', weight: 'bold', color: tone === 'warn' ? C.warn : C.ink }),
    sub ? t(sub, { size: 'xs', color: C.muted, margin: 'xs' }) : null,
  ], { backgroundColor: tone === 'warn' ? C.warnSoft : C.panel, paddingAll: '16px' });
  const body = [
    ...lines.map((l) => t(l, { size: 'sm', color: C.ink })),
    ...steps.map((st, i) => box('horizontal', [
      box('vertical', [t(String(i + 1), { size: 'xxs', weight: 'bold', align: 'center', color: C.onAccent })], {
        width: '20px', height: '20px', cornerRadius: 'xxl', backgroundColor: C.accent, justifyContent: 'center', flex: 0,
      }),
      t(st.text, { size: 'sm', margin: 'md', flex: 1, color: st.cmd ? C.accent : C.ink, weight: st.cmd ? 'bold' : 'regular' }),
    ], { margin: 'md', alignItems: 'center', ...(st.cmd ? { action: say(st.text, st.cmd) } : {}) })),
  ];
  return flex((alt || `${title}${sub ? ' · ' + sub : ''}`).slice(0, 380), bubble({
    header,
    body: body.length ? body : [t(' ')],
    // buttons: actions; the first is the main (mint) one; two per row
    footer: buttons.length ? [box('vertical', [0, 2].filter((i) => buttons[i]).map((i) => pillRow(
      ...buttons.slice(i, i + 2).map((a, j) => pill(a, i + j === 0 ? 'primary' : 'secondary')),
    )), { spacing: 'sm' })] : [],
  }));
}

export function helpMessage(chat, botName) {
  if (chat === 'group') {
    return infoMessage({
      title: `เรียก @${botName} แบบนี้`, sub: 'คุยกันปกติ บอทไม่ตอบ', alt: `วิธีใช้ ${botName} ในกลุ่ม`,
      steps: [
        { text: `@${botName} นน กับ เจ ทำ mockup ส่งศุกร์` },
        { text: `@${botName} งานทีม`, cmd: `@${botName} งานทีม` },
        { text: `@${botName} ใครทำ supplier อยู่` },
        { text: `@${botName} ตั้งค่า`, cmd: `@${botName} ตั้งค่า` },
      ],
      lines: ['อัปเดตงานตัวเอง (เสร็จ / เลื่อน / ติด) ทำในแชทส่วนตัวกับ Norse'],
    });
  }
  return infoMessage({
    title: 'ใช้ Norse แบบนี้', sub: 'กดเมนูด้านล่าง หรือพิมพ์ได้เลย', alt: `วิธีใช้ ${botName}`,
    steps: [
      { text: 'งานฉัน', cmd: 'งานฉัน' },
      { text: 'วันนี้ทำอะไรดี', cmd: 'วันนี้ทำอะไรดี' },
      { text: 'mockup เสร็จแล้ว · ขอเลื่อนเป็นจันทร์' },
      { text: 'ติด supplier ยังไม่ตอบ' },
      { text: 'งานใหม่: ทำ deck ส่งพฤหัส' },
      { text: 'งานทีม', cmd: 'งานทีม' },
    ],
  });
}
