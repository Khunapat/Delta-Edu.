// LINE Flex cards in the style of the NORSE Project Overview dashboard (dark theme):
// dark panels, mint gradient hero tiles, KPI tiles with bars, stacked status bars,
// pill tags and pill buttons, workstream colours, overlapping initials avatars, and
// animated banners (APNG, brand/banner-*.png) for the big moments.
// Every button is a postback, a date picker or a typed command: tapping never costs an AI call.
//
// LINE renders these with the phone's own font; no shadows or CSS animation. Motion
// comes only from the animated banner images, which need a public https base URL
// (setAssetBase, set from the first request the server gets). Without it, cards
// simply have no banner.

import { formatDay, relDays, diffDays } from './dates.js';
import { ownersOf, STATUS_TH } from './team.js';

// Dashboard tokens (data-ui="dark").
export const C = {
  bg: '#0C1112', panel: '#141B1D', panel2: '#1A2326', panel3: '#212C2F', ink: '#E7EFED', muted: '#8C9A98', faint: '#5B6A68', line: '#232E31',
  accent: '#8FD9C6', accent2: '#5FBFA9', accentSoft: '#1C3631', onAccent: '#0C1715',
  heroA: '#9FE3D1', heroMid: '#7FD3BE', heroB: '#5FBFA9',
  todo: '#5B6A68', doing: '#8FD9C6', blocked: '#F07560', done: '#78D18F', warn: '#E8B14A',
  blockedSoft: '#3A201B', warnSoft: '#382D15', doneSoft: '#1A3322',
  track: '#0C171526', // dark see-through track on the mint hero
  streams: ['#8FD9C6', '#AC97EE', '#EFA064', '#78D18F', '#EA86B8', '#8EAEE6'],
};

export function streamColor(name) {
  let h = 0;
  for (const ch of String(name || 'General')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return C.streams[h % C.streams.length];
}

// ---- animated banners (brand/banner-*.png) -------------------------------
let ASSET_BASE = '';
let ASSET_V = '1';
/** e.g. setAssetBase('https://norse-bot-xxx.run.app', 'a1b2c3') */
export function setAssetBase(base, version = ASSET_V) { ASSET_BASE = String(base || '').replace(/\/$/, ''); ASSET_V = version; }
export const assetBase = () => ASSET_BASE;
export const BANNERS = ['morning', 'done', 'weekly', 'welcome'];
/** Full-width animated image for a bubble's hero block, or undefined when no public base is known. */
export function banner(name) {
  if (!ASSET_BASE || !BANNERS.includes(name)) return undefined;
  return { type: 'image', url: `${ASSET_BASE}/brand/banner-${name}.png?v=${ASSET_V}`, size: 'full', aspectRatio: '8:3', aspectMode: 'cover', animated: true };
}

// ---- primitives --------------------------------------------------------
export const textMsg = (text, quickReply) => ({ type: 'text', text: String(text).slice(0, 4900), ...(quickReply ? { quickReply } : {}) });
export const flex = (altText, contents, quickReply) => ({ type: 'flex', altText: String(altText).slice(0, 380), contents, ...(quickReply ? { quickReply } : {}) });
const t = (text, o = {}) => ({ type: 'text', text: String(text || ' '), wrap: true, size: 'sm', color: C.ink, ...o });
const box = (layout, contents, o = {}) => ({ type: 'box', layout, contents: contents.filter(Boolean), ...o });
const sep = (margin = 'md') => ({ type: 'separator', color: C.line, margin });
const filler = () => ({ type: 'filler' });
const dot = (color, size = '8px') => box('vertical', [filler()], { width: size, height: size, cornerRadius: 'xxl', backgroundColor: color, flex: 0 });

export const postback = (label, data, displayText) => ({ type: 'postback', label: label.slice(0, 20), data, ...(displayText ? { displayText } : {}) });
export const datePicker = (label, data, { initial, min } = {}) => ({
  type: 'datetimepicker', label: label.slice(0, 20), data, mode: 'date',
  ...(initial ? { initial } : {}), ...(min ? { min } : {}),
});
/** Tap = the user "types" this text (free, no AI). In a group it needs @Norse in front. */
export const say = (label, text) => ({ type: 'message', label: label.slice(0, 20), text });

export function quickReply(actions) {
  return { items: actions.slice(0, 13).map((action) => ({ type: 'action', action })) };
}

/** Pill button like the dashboard's .btn / .btn.primary. */
function pill(action, kind = 'secondary', o = {}) {
  const styles = {
    primary: { bg: null, color: C.onAccent, border: C.heroA },
    secondary: { bg: C.panel2, color: C.ink, border: C.line },
    danger: { bg: C.panel, color: C.blocked, border: C.blocked },
    ghost: { bg: C.panel, color: C.muted, border: C.panel },
  }[kind];
  return box('vertical', [t(action.label, { align: 'center', size: 'sm', weight: 'bold', color: styles.color, wrap: false })], {
    action, borderColor: styles.border, borderWidth: 'normal', cornerRadius: 'xxl',
    ...(styles.bg ? { backgroundColor: styles.bg } : { background: { type: 'linearGradient', angle: '90deg', startColor: C.heroA, endColor: C.heroB } }),
    paddingTop: '10px', paddingBottom: '10px', paddingStart: '12px', paddingEnd: '12px', flex: 1, ...o,
  });
}
const pillRow = (...items) => box('horizontal', items, { spacing: 'sm' });
/** Buttons from actions: the first is the mint one, two per row. */
function buttonRows(actions, firstKind = 'primary') {
  const rows = [];
  for (let i = 0; i < actions.length; i += 2) {
    rows.push(pillRow(...actions.slice(i, i + 2).map((a, j) => pill(a, i + j === 0 ? firstKind : 'secondary'))));
  }
  return rows;
}

/** Status / priority tag like .tag.* */
function tag(text, kind) {
  const s = {
    todo: [C.panel2, C.muted, C.line], doing: [C.accentSoft, C.doing], blocked: [C.blockedSoft, C.blocked],
    done: [C.doneSoft, C.done], overdue: [C.warnSoft, C.warn], high: [C.blockedSoft, C.blocked],
    med: [C.warnSoft, C.warn], low: [C.panel2, C.muted, C.line], accent: [C.accentSoft, C.accent],
  }[kind] || [C.panel2, C.muted, C.line];
  return box('vertical', [t(text, { size: 'xxs', weight: 'bold', color: s[1], wrap: false })], {
    backgroundColor: s[0], cornerRadius: 'xxl', paddingStart: '9px', paddingEnd: '9px', paddingTop: '3px', paddingBottom: '3px',
    flex: 0, ...(s[2] ? { borderColor: s[2], borderWidth: 'light' } : {}),
  });
}
function streamTag(name) {
  const c = streamColor(name);
  return box('horizontal', [dot(c, '6px'), t(name || 'General', { size: 'xxs', weight: 'bold', color: c, wrap: false, margin: 'sm', flex: 0 })], {
    backgroundColor: C.panel, borderColor: C.line, borderWidth: 'light', cornerRadius: 'xxl', alignItems: 'center',
    paddingStart: '9px', paddingEnd: '10px', paddingTop: '3px', paddingBottom: '3px', flex: 0,
  });
}
const tags = (...items) => box('horizontal', items.filter(Boolean), { spacing: 'xs' });

/** Round avatar with initials like .avatar */
function avatar(name, size = 28) {
  const initials = String(name || '?').trim().slice(0, 2).toUpperCase();
  return box('vertical', [t(initials, { size: size < 26 ? 'xxs' : 'xs', weight: 'bold', align: 'center', color: C.onAccent, wrap: false })], {
    width: `${size}px`, height: `${size}px`, cornerRadius: 'xxl', backgroundColor: streamColor('@' + name), justifyContent: 'center', flex: 0,
  });
}
/** Overlapping avatars (like the dashboard's avatar stack), each with a ring in the panel colour. */
function avatarStack(names, size = 24, ring = C.panel2) {
  const list = names.slice(0, 4);
  if (!list.length) return null;
  const step = Math.round(size * 0.62);
  return box('vertical', list.map((n, i) => ({
    ...avatar(n, size), position: 'absolute', offsetTop: '0px', offsetStart: `${i * step}px`, borderColor: ring, borderWidth: 'medium',
  })), { width: `${size + step * (list.length - 1)}px`, height: `${size}px`, flex: 0 });
}

/** Thin progress bar (rounded track + fill). pct 0-100. */
function bar(pct, color, { track = C.panel3, height = '6px', margin } = {}) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return box('horizontal', [
    p > 0 ? box('vertical', [filler()], { width: `${p}%`, height, backgroundColor: color, cornerRadius: 'xxl', flex: 0 }) : filler(),
  ], { backgroundColor: track, height, cornerRadius: 'xxl', ...(margin ? { margin } : {}) });
}
/** Stacked status bar: [{ value, color }] side by side, like the dashboard's progress strip. */
function stackBar(parts, { track = C.panel3, height = '10px', margin } = {}) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return bar(0, C.accent, { track, height, margin });
  const shown = parts.filter((p) => p.value > 0);
  let used = 0;
  return box('horizontal', shown.map((p, i) => {
    const w = i === shown.length - 1 ? 100 - used : Math.max(4, Math.round((p.value / total) * 100));
    used += w;
    return box('vertical', [filler()], { width: `${w}%`, height, backgroundColor: p.color, flex: 0 });
  }), { backgroundColor: track, height, cornerRadius: 'xxl', spacing: 'none', ...(margin ? { margin } : {}) });
}

/** Gradient hero header like .kpi.hero: kicker, title, optional big value, sub and a bar on a dark track. */
function hero({ kicker, title, big, sub, barPct, stack }) {
  return box('vertical', [
    kicker ? t(kicker, { size: 'xxs', weight: 'bold', color: '#0C1715A6' }) : null,
    title ? t(title, { size: big != null ? 'sm' : 'lg', weight: 'bold', color: C.onAccent, margin: kicker ? 'xs' : undefined }) : null,
    big != null ? t(String(big), { size: '3xl', weight: 'bold', color: C.onAccent, margin: 'sm' }) : null,
    sub ? t(sub, { size: 'xs', color: '#0C1715CC', margin: 'xs' }) : null,
    stack ? stackBar(stack, { track: C.track, margin: 'lg' }) : barPct != null ? bar(barPct, C.onAccent, { track: C.track, margin: 'lg' }) : null,
  ], {
    background: { type: 'linearGradient', angle: '135deg', startColor: C.heroA, centerColor: C.heroMid, endColor: C.heroB },
    paddingAll: '18px',
  });
}

function plainHeader({ kicker, title, sub, color = C.accent }) {
  return box('vertical', [
    kicker ? t(kicker, { size: 'xxs', weight: 'bold', color }) : null,
    t(title, { size: 'md', weight: 'bold', color: C.ink, margin: kicker ? 'xs' : undefined }),
    sub ? t(sub, { size: 'xs', color: C.muted, margin: 'xs' }) : null,
  ], { backgroundColor: C.panel, paddingAll: '16px', paddingBottom: '6px' });
}

/** Title block at the top of the body, for cards whose banner image sits above it
 *  (LINE always draws a bubble's header above its hero image). */
function titleBlock({ kicker, title, sub, color = C.accent }) {
  return box('vertical', [
    kicker ? t(kicker, { size: 'xxs', weight: 'bold', color }) : null,
    t(title, { size: 'lg', weight: 'bold', color: C.ink, margin: kicker ? 'xs' : undefined }),
    sub ? t(sub, { size: 'xs', color: C.muted, margin: 'xs' }) : null,
  ]);
}

/** Coloured stripe across the top of a card (workstream colour). */
const stripe = (color) => box('vertical', [filler()], { height: '5px', backgroundColor: color, paddingAll: '0px' });

function bubble({ header, hero: heroBlock, body = [], footer = [], size = 'kilo', bodyBg = C.panel }) {
  return {
    type: 'bubble',
    size,
    ...(header ? { header } : {}),
    ...(heroBlock ? { hero: heroBlock } : {}),
    body: box('vertical', body.length ? body : [t(' ')], { spacing: 'sm', backgroundColor: bodyBg, paddingAll: '16px' }),
    footer: footer.length ? box('vertical', footer, { spacing: 'sm', backgroundColor: bodyBg, paddingAll: '12px', paddingTop: '4px' }) : undefined,
    styles: {
      header: { backgroundColor: header?.backgroundColor || C.panel },
      hero: { backgroundColor: C.panel },
      body: { backgroundColor: bodyBg },
      footer: { backgroundColor: bodyBg },
    },
  };
}

const row = (icon, value, color = C.ink) => box('horizontal', [
  box('vertical', [t(icon, { size: 'xs', align: 'center' })], { width: '26px', height: '26px', cornerRadius: 'md', backgroundColor: C.panel2, justifyContent: 'center', flex: 0 }),
  t(value, { color, margin: 'md', flex: 1, size: 'sm', gravity: 'center' }),
], { alignItems: 'center', margin: 'sm' });

export function dueLabel(due, today, status) {
  if (!due) return { text: 'ยังไม่มีวันส่ง', color: C.muted, late: false, short: 'ไม่มีกำหนด' };
  const n = diffDays(today, due);
  if (status === 'done') return { text: formatDay(due, today), color: C.muted, late: false, short: formatDay(due, today) };
  return { text: `${formatDay(due, today)} · ${relDays(n)}`, color: n <= 1 ? C.warn : C.muted, late: n < 0, today: n === 0, short: relDays(n) };
}
/** Due-date chip: amber when late or due within a day, mint when today, quiet otherwise. */
function dueChip(due, today, status) {
  const d = dueLabel(due, today, status);
  const kind = status === 'done' ? 'low' : d.late ? 'overdue' : d.today ? 'accent' : due && diffDays(today, due) <= 1 ? 'overdue' : 'low';
  return tag(`📅 ${due ? formatDay(due, today) : 'ไม่มีกำหนด'}${due && status !== 'done' ? ' · ' + d.short : ''}`, kind);
}

// ---- drafts (confirm before saving) ------------------------------------
export function draftMessage(draft, today) {
  const bubbles = draft.tasks.map((task, i) => {
    const due = task.due ? dueLabel(task.due, today) : task.noDue ? { text: 'ไม่มีกำหนดส่ง', color: C.muted } : { text: 'ยังไม่มีวันส่ง · เลือกวันก่อน', color: C.blocked };
    const ready = task.owners.length && (task.due || task.noDue);
    return bubble({
      header: plainHeader({
        kicker: draft.tasks.length > 1 ? `งานใหม่ ${i + 1}/${draft.tasks.length} · รอยืนยัน` : 'งานใหม่ · รอยืนยัน',
        title: task.title, sub: `จาก ${draft.by}`, color: ready ? C.accent : C.warn,
      }),
      body: [
        tags(streamTag(task.stream), tag({ high: 'High', med: 'Medium', low: 'Low' }[task.priority] || 'Medium', task.priority || 'med'), !ready ? tag('ยังไม่ครบ', 'overdue') : tag('พร้อม ✓', 'done')),
        task.owners.length
          ? box('horizontal', [avatarStack(task.owners, 26, C.panel), t(task.owners.join(', '), { size: 'sm', color: C.ink, gravity: 'center', margin: 'md', flex: 1 })], { margin: 'lg', alignItems: 'center' })
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
    header: hero({ kicker: 'NORSE · งานใหม่', title: `เพิ่มงานแล้ว ${tasks.length} งาน ✓`, sub: by ? `ยืนยันโดย ${by}` : undefined }),
    body: tasks.flatMap((task, i) => [
      i ? sep() : null,
      box('horizontal', [
        box('vertical', [filler()], { width: '4px', backgroundColor: streamColor(task.stream), cornerRadius: 'xxl', flex: 0 }),
        box('vertical', [
          t(task.title, { weight: 'bold' }),
          box('horizontal', [streamTag(task.stream), dueChip(task.due, today)], { spacing: 'xs', margin: 'sm' }),
        ], { flex: 1, margin: 'md' }),
        avatarStack(ownersOf(task), 22, C.panel),
      ], { margin: i ? 'md' : undefined }),
    ]),
  }));
}

// ---- meeting notes (decisions + action items, confirm before saving) ------
/** m: { id, title, date, attendees[], summary, decisions[], actions[{ title, owners[], due }], questions[] } */
export function meetingMessage(m, today, { saved = false } = {}) {
  const sectionRows = (items, mark, color) => items.slice(0, 8).map((x, i) => box('horizontal', [
    box('vertical', [t(mark, { size: 'xxs', weight: 'bold', align: 'center', color: C.onAccent })], {
      width: '20px', height: '20px', cornerRadius: 'xxl', backgroundColor: color, justifyContent: 'center', flex: 0,
    }),
    t(x, { size: 'sm', margin: 'md', flex: 1 }),
  ], { margin: i ? 'md' : 'sm', alignItems: 'flex-start' }));
  const actionRows = m.actions.slice(0, 8).map((a, i) => box('horizontal', [
    box('vertical', [filler()], { width: '4px', backgroundColor: C.accent, cornerRadius: 'xxl', flex: 0 }),
    box('vertical', [
      t(a.title, { size: 'sm', weight: 'bold' }),
      box('horizontal', [
        t(a.owners?.length ? a.owners.join(', ') : 'ยังไม่มีคนทำ', { size: 'xxs', color: a.owners?.length ? C.muted : C.blocked, flex: 0, gravity: 'center' }),
        filler(),
        a.due ? dueChip(a.due, today) : tag('ไม่มีกำหนด', 'low'),
      ], { margin: 'xs', alignItems: 'center' }),
    ], { flex: 1, margin: 'md' }),
  ], { margin: i ? 'md' : 'sm' }));
  const head = (label, n, color) => box('horizontal', [
    t(label, { size: 'sm', weight: 'bold', color, flex: 0 }),
    box('vertical', [t(String(n), { size: 'xxs', weight: 'bold', color: C.muted, align: 'center' })], {
      backgroundColor: C.panel2, cornerRadius: 'xxl', paddingStart: '7px', paddingEnd: '7px', paddingTop: '1px', paddingBottom: '1px', margin: 'sm', flex: 0,
    }),
  ], { margin: 'xl', alignItems: 'center' });
  const body = [
    m.summary ? t(m.summary, { size: 'sm', color: C.muted }) : null,
    m.decisions.length ? head('✓ ตัดสินใจ', m.decisions.length, C.done) : null,
    ...sectionRows(m.decisions, '✓', C.done),
    m.actions.length ? head('→ งานที่ต้องทำ', m.actions.length, C.accent) : null,
    ...actionRows,
    m.questions.length ? head('? คำถามค้าง', m.questions.length, C.warn) : null,
    ...sectionRows(m.questions, '?', C.warn),
    !m.decisions.length && !m.actions.length && !m.questions.length ? t('ไม่เจอเรื่องที่ตัดสินใจหรืองานที่ต้องทำในโน้ตนี้', { size: 'xs', color: C.muted, margin: 'md' }) : null,
  ].filter(Boolean);
  const sub = [m.date ? formatDay(m.date, today) : '', m.attendees.length ? m.attendees.join(', ') : ''].filter(Boolean).join(' · ');
  return flex(`${saved ? 'บันทึกประชุมแล้ว' : 'สรุปประชุม · รอบันทึก'}: ${m.title}`, bubble({
    size: 'mega',
    header: hero({ kicker: saved ? 'NORSE · ประชุม · บันทึกแล้ว ✓' : 'NORSE · ประชุม · รอบันทึก', title: m.title || 'ประชุมทีม', sub }),
    body,
    footer: saved ? [] : [
      pill(postback('บันทึกลงบอร์ด', `a=mok&m=${m.id}`, 'บันทึกประชุม'), 'primary'),
      pill(postback('ยกเลิก', `a=mx&m=${m.id}`, 'ยกเลิก'), 'ghost'),
    ],
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
    header: { ...stripe(streamColor(task.stream)), backgroundColor: streamColor(task.stream) },
    body: [
      tags(streamTag(task.stream), tag(STATUS_TH[task.status], task.status), due.late ? tag('เลยกำหนด', 'overdue') : null),
      note ? t(note, { size: 'xs', color: C.warn, weight: 'bold', margin: 'md' }) : null,
      t(task.title, { weight: 'bold', size: 'md', margin: note ? 'xs' : 'md' }),
      task.status === 'blocked' && task.blocker ? box('horizontal', [t('🚧', { size: 'xs', flex: 0 }), t(task.blocker, { size: 'xs', color: C.blocked, margin: 'sm' })], { margin: 'xs' }) : null,
      box('horizontal', [dueChip(task.due, today, task.status), filler(), avatarStack(ownersOf(task), 24, C.panel2)], { margin: 'lg', alignItems: 'center' }),
    ],
    footer,
  });
}

export function taskListMessage(tasks, today, { empty = 'ไม่มีงานค้าง 🎉', alt = 'งานของฉัน', notes = {} } = {}) {
  if (!tasks.length) {
    return flex(empty, bubble({ header: hero({ kicker: 'NORSE', title: empty, sub: 'มีงานใหม่เมื่อไหร่ จะแจ้งในแชทนี้' }), body: [t('พิมพ์ "งานใหม่: …" หรือกดเมนู เพิ่มงาน ได้เลย', { size: 'xs', color: C.muted })] }));
  }
  const bubbles = tasks.slice(0, 10).map((x) => taskBubble(x, today, { note: notes[x.id] }));
  const more = tasks.length > 10 ? [textMsg(`และอีก ${tasks.length - 10} งาน (แสดง 10 งานที่ใกล้ส่งที่สุด)`)] : [];
  return [flex(`${alt} (${tasks.length})`, bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }), ...more];
}

// ---- team overview (KPI tiles + people + risks) --------------------------
function kpiTile(label, value, color, pct) {
  return box('vertical', [
    box('horizontal', [dot(color, '7px'), t(label, { size: 'xxs', color: C.muted, wrap: false, margin: 'sm' })], { alignItems: 'center' }),
    t(String(value), { size: 'xl', weight: 'bold', color: C.ink, wrap: false, margin: 'sm' }),
    pct != null ? bar(pct, color, { height: '4px', margin: 'sm' }) : null,
  ], { backgroundColor: C.panel2, borderColor: C.line, borderWidth: 'light', cornerRadius: 'lg', paddingAll: '11px', flex: 1 });
}

export function teamMessage({ members, tasks, today }) {
  const open = tasks.filter((x) => x.status !== 'done');
  const done = tasks.filter((x) => x.status === 'done');
  const doing = open.filter((x) => x.status === 'doing');
  const todo = open.filter((x) => x.status === 'todo');
  const overdue = open.filter((x) => x.due && x.due < today && x.status !== 'blocked');
  const blocked = open.filter((x) => x.status === 'blocked');
  const n = tasks.length || 1;
  const pct = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0;
  const maxLoad = Math.max(1, ...members.map((m) => open.filter((x) => ownersOf(x).includes(m.nickname)).length));
  const people = members.map((m) => {
    const mine = open.filter((x) => ownersOf(x).includes(m.nickname));
    const cur = mine.find((x) => x.status === 'blocked') || mine.find((x) => x.status === 'doing') || [...mine].sort((a, b) => (a.due || '9').localeCompare(b.due || '9'))[0];
    const late = mine.filter((x) => x.due && x.due < today).length;
    return box('horizontal', [
      avatar(m.nickname, 32),
      box('vertical', [
        box('horizontal', [
          t(m.nickname, { weight: 'bold', size: 'sm', flex: 1 }),
          t(`${mine.length} งาน`, { size: 'xxs', color: late ? C.warn : C.muted, flex: 0, gravity: 'center' }),
        ]),
        t(cur ? `${cur.status === 'blocked' ? '🚧 ' : ''}${cur.title}` : 'ว่าง ไม่มีงานค้าง', { size: 'xxs', color: cur?.status === 'blocked' ? C.blocked : C.muted, wrap: false }),
        bar((mine.length / maxLoad) * 100, cur?.status === 'blocked' ? C.blocked : late ? C.warn : C.accent, { height: '4px', margin: 'sm' }),
      ], { flex: 1, margin: 'md' }),
    ], { alignItems: 'center', margin: 'lg' });
  });
  const risk = (x, kind) => box('horizontal', [
    box('vertical', [filler()], { width: '4px', backgroundColor: kind === 'blocked' ? C.blocked : C.warn, flex: 0 }),
    box('vertical', [
      t(x.title, { size: 'xs', weight: 'bold' }),
      t(`${x.stream} · ${ownersOf(x).join(', ')}${x.due ? ' · ' + relDays(diffDays(today, x.due)) : ''}`, { size: 'xxs', color: C.muted }),
      kind === 'blocked' && x.blocker ? t(`🚧 ${x.blocker}`, { size: 'xxs', color: C.blocked }) : null,
    ], { paddingAll: '9px', flex: 1 }),
  ], { backgroundColor: C.panel2, borderColor: C.line, borderWidth: 'light', cornerRadius: 'md', margin: 'sm' });
  const risks = [...blocked.map((x) => risk(x, 'blocked')), ...overdue.map((x) => risk(x, 'overdue'))].slice(0, 6);
  return flex('งานทีม', bubble({
    size: 'mega',
    header: hero({
      kicker: 'NORSE · งานทีม', title: 'เสร็จแล้ว', big: `${pct}%`, sub: `${open.length} งานเปิดอยู่ · เสร็จ ${done.length} จาก ${tasks.length}`,
      stack: [{ value: done.length, color: C.onAccent }, { value: doing.length, color: '#0C171599' }, { value: blocked.length, color: '#B8432F' }, { value: todo.length, color: '#0C171540' }],
    }),
    body: [
      box('horizontal', [
        kpiTile('กำลังทำ', doing.length, C.doing, (doing.length / n) * 100),
        kpiTile('ยังไม่เริ่ม', todo.length, C.todo, (todo.length / n) * 100),
      ], { spacing: 'sm' }),
      box('horizontal', [
        kpiTile('เลยกำหนด', overdue.length, C.warn, (overdue.length / n) * 100),
        kpiTile('ติดอยู่', blocked.length, C.blocked, (blocked.length / n) * 100),
      ], { spacing: 'sm', margin: 'sm' }),
      t('ทีม', { weight: 'bold', size: 'sm', margin: 'xl' }),
      ...people,
      risks.length ? t(`ความเสี่ยง · ติด ${blocked.length} · เลยกำหนด ${overdue.length}`, { weight: 'bold', size: 'sm', margin: 'xl' }) : null,
      ...risks,
    ],
  }));
}

// ---- digests / briefs ----------------------------------------------------
function sectionHead(label, count, color = C.ink) {
  return box('horizontal', [
    t(label, { weight: 'bold', size: 'sm', color, flex: 0 }),
    box('vertical', [t(String(count), { size: 'xxs', weight: 'bold', color: C.muted, align: 'center' })], {
      backgroundColor: C.panel2, cornerRadius: 'xxl', paddingStart: '7px', paddingEnd: '7px', paddingTop: '1px', paddingBottom: '1px', margin: 'sm', flex: 0,
    }),
  ], { margin: 'xl', alignItems: 'center' });
}
function taskLine(x, today) {
  const d = dueLabel(x.due, today, x.status);
  return box('horizontal', [
    box('vertical', [filler()], { width: '4px', backgroundColor: streamColor(x.stream), cornerRadius: 'xxl', flex: 0 }),
    box('vertical', [
      t(x.title, { size: 'sm', weight: 'bold' }),
      t(`${x.stream || 'General'} · ${d.text}`, { size: 'xxs', color: d.late ? C.warn : C.muted }),
    ], { flex: 1, margin: 'md' }),
  ], { margin: 'md' });
}

export function digestMessages({ greeting, sections, today, actionable }) {
  const lines = [];
  for (const s of sections) {
    if (!s.tasks.length) continue;
    lines.push(sectionHead(s.label, s.tasks.length, s.color || C.ink));
    for (const x of s.tasks.slice(0, 6)) lines.push(taskLine(x, today));
  }
  const total = sections.reduce((n, s) => n + s.tasks.length, 0);
  const pic = banner('morning');
  const out = [flex(greeting, bubble({
    size: 'mega',
    hero: pic,
    header: pic ? undefined : hero({ kicker: formatDay(today), title: greeting, sub: total ? `${total} งานที่ควรดู` : 'วันนี้ไม่มีงานค้าง 🎉' }),
    body: [
      pic ? titleBlock({ kicker: formatDay(today), title: greeting, sub: total ? `${total} งานที่ควรดู` : 'วันนี้ไม่มีงานค้าง 🎉' }) : null,
      ...(lines.length ? lines : [t('สบายๆ ไม่มีอะไรต้องรีบ หายใจลึกๆ แล้วลุยต่อ 🌿', { color: C.muted, size: 'xs', margin: 'md' })]),
    ].filter(Boolean),
  }))];
  if (actionable?.length) {
    const bubbles = actionable.slice(0, 10).map((x) => taskBubble(x, today, { note: x._note }));
    out.push(flex('งานที่ต้องอัปเดต', bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }));
  }
  return out;
}

/** Monday plan / Friday wrap-up: banner, headline numbers, then sections. stats: [{ label, value, color }]. */
export function weeklyMessage({ title, subtitle, sections, stats = [] }) {
  const body = [];
  if (stats.length) body.push(box('horizontal', stats.slice(0, 3).map((s) => kpiTile(s.label, s.value, s.color || C.accent)), { spacing: 'sm' }));
  for (const s of sections) {
    const n = /\((\d+)\)$/.exec(s.label);
    body.push(sectionHead(s.label.replace(/\s*\(\d+\)$/, ''), n ? Number(n[1]) : s.lines.length, s.color || C.ink));
    if (!s.lines.length) body.push(t('—', { size: 'xs', color: C.muted }));
    for (const l of s.lines.slice(0, 12)) {
      body.push(box('horizontal', [dot(s.color || C.accent, '6px'), t(l, { size: 'xs', color: C.ink, margin: 'md', flex: 1 })], { margin: 'sm', alignItems: 'center' }));
    }
  }
  const pic = banner('weekly');
  if (pic) body.unshift(titleBlock({ kicker: 'NORSE · สัปดาห์นี้', title, sub: subtitle }));
  if (pic && stats.length) body[1] = { ...body[1], margin: 'lg' };
  return flex(title, bubble({
    size: 'mega', hero: pic,
    header: pic ? undefined : hero({ kicker: 'NORSE · สัปดาห์นี้', title, sub: subtitle }),
    body,
  }));
}

// ---- settings / AI usage -------------------------------------------------
export function usageMessage({ ai, push, members, linked }) {
  const rows = ai.models.length ? ai.models.map((m) => box('vertical', [
    box('horizontal', [
      t(m.model.replace(/^gemini-/, ''), { size: 'xs', flex: 1 }),
      m.exhausted ? tag('หมดวันนี้', 'blocked') : t(`${m.used}${m.limit ? ' / ' + m.limit : ''}`, { size: 'xs', color: C.muted, flex: 0 }),
    ], { alignItems: 'center' }),
    bar(m.exhausted ? 100 : m.limit ? (m.used / m.limit) * 100 : Math.min(100, m.used * 5), m.exhausted ? C.blocked : C.accent, { height: '4px', margin: 'sm' }),
  ], { margin: 'md' })) : [t('ยังไม่ได้ใช้ AI วันนี้', { size: 'xs', color: C.muted })];
  const pushPct = push.limit ? (push.used / push.limit) * 100 : 0;
  return flex('ตั้งค่าและการใช้งาน', bubble({
    size: 'mega',
    header: hero({ kicker: 'NORSE · ตั้งค่า', title: 'AI วันนี้', big: `${ai.total} ครั้ง`, sub: `${ai.label} · รีเซ็ต ${ai.resetText}` }),
    body: [
      t('โควตา AI ต่อโมเดล', { weight: 'bold', size: 'sm' }),
      ...rows,
      sep('xl'),
      box('horizontal', [
        kpiTile('push เดือนนี้', `${push.used}/${push.limit}`, pushPct > 80 ? C.blocked : pushPct > 60 ? C.warn : C.accent, pushPct),
        kpiTile('เชื่อม LINE', `${linked}/${members}`, C.done, members ? (linked / members) * 100 : 0),
      ], { spacing: 'sm', margin: 'xl' }),
    ],
  }));
}

// ---- small cards for outcomes (instead of plain text) ---------------------
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
    backgroundColor: k.soft, cornerRadius: 'xxl', paddingStart: '12px', paddingEnd: '12px', paddingTop: '5px', paddingBottom: '5px', flex: 0,
  });
}

/**
 * One task after a change: status chip, title, workstream, people, due date, a note,
 * and buttons for the next step. "done" gets the animated celebration banner.
 */
export function resultMessage({ kind, task, today, note, noteColor, headline, buttons = [] }) {
  const k = RESULT[kind];
  const pic = kind === 'done' ? banner('done') : undefined;
  // alt text = what shows in notifications and chat lists
  return flex(`${k.icon} ${k.label}: ${task.title}${headline ? ' · ' + headline : ''}`.slice(0, 380), bubble({
    hero: pic,
    header: pic ? undefined : { ...stripe(k.color), backgroundColor: k.color },
    body: [
      box('horizontal', [chip(kind), filler()]),
      headline ? t(headline, { size: 'xs', color: C.muted, margin: 'md' }) : null,
      t(task.title, { weight: 'bold', size: 'lg', margin: headline ? 'xs' : 'md' }),
      note ? t(note, { size: 'sm', color: noteColor || k.color, margin: 'sm' }) : null,
      box('horizontal', [
        streamTag(task.stream), dueChip(task.due, today, kind === 'done' || kind === 'already' ? 'done' : task.status),
        filler(), avatarStack(ownersOf(task), 22, C.panel),
      ], { margin: 'lg', alignItems: 'center', spacing: 'xs' }),
    ],
    footer: buttons.length ? buttonRows(buttons.slice(0, 2)) : [],
  }));
}

/** Group ✓ lines ("✓ Jai · mockup") as one card. */
export function noticesMessage(text, title = 'อัปเดตจากทีม') {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  return flex(`${title}: ${lines.join(' / ')}`.slice(0, 380), bubble({
    header: hero({ kicker: 'NORSE · ทีม', title, sub: `${lines.length} งานเสร็จ` }),
    body: lines.slice(0, 15).map((l, i) => {
      const m = /^✓\s*(.*?)\s*·\s*(.*)$/.exec(l);
      return box('horizontal', [
        box('vertical', [t('✓', { size: 'xs', weight: 'bold', align: 'center', color: C.onAccent })], { width: '22px', height: '22px', cornerRadius: 'xxl', backgroundColor: C.done, justifyContent: 'center', flex: 0 }),
        m
          ? box('vertical', [t(m[2], { size: 'sm', weight: 'bold' }), t(m[1], { size: 'xxs', color: C.muted })], { margin: 'md', flex: 1 })
          : t(l.replace(/^✓\s*/, ''), { size: 'sm', margin: 'md', flex: 1 }),
      ], { margin: i ? 'lg' : undefined, alignItems: 'center' });
    }),
  }));
}

/**
 * Hero card for one-off moments (linked, group set, welcome, AI resting, help).
 *   steps:   [{ text, cmd? }]  (cmd = tappable row that sends a command)
 *   buttons: actions for pill buttons
 *   banner:  'welcome' | ... animated image above the header
 */
export function infoMessage({ title, sub, alt, tone = 'hero', lines = [], steps = [], buttons = [], banner: bannerName }) {
  const pic = bannerName ? banner(bannerName) : undefined;
  const header = tone === 'warn'
    ? box('vertical', [
      t('NORSE · แจ้งเตือน', { size: 'xxs', weight: 'bold', color: C.warn }),
      t(title, { size: 'lg', weight: 'bold', color: C.ink, margin: 'xs' }),
      sub ? t(sub, { size: 'xs', color: C.muted, margin: 'xs' }) : null,
    ], { backgroundColor: C.warnSoft, paddingAll: '18px' })
    : pic ? undefined : hero({ kicker: 'NORSE', title, sub });
  const body = [
    pic ? titleBlock({ kicker: 'NORSE', title, sub }) : null,
    ...lines.map((l) => t(l, { size: 'sm', color: C.ink })),
    ...steps.map((st, i) => box('horizontal', [
      box('vertical', [t(String(i + 1), { size: 'xxs', weight: 'bold', align: 'center', color: C.onAccent })], {
        width: '22px', height: '22px', cornerRadius: 'xxl', justifyContent: 'center', flex: 0,
        background: { type: 'linearGradient', angle: '135deg', startColor: C.heroA, endColor: C.heroB },
      }),
      t(st.text, { size: 'sm', margin: 'md', flex: 1, color: st.cmd ? C.accent : C.ink, weight: st.cmd ? 'bold' : 'regular' }),
      st.cmd ? t('›', { size: 'lg', color: C.accent, flex: 0 }) : null,
    ], {
      margin: 'md', alignItems: 'center', paddingAll: '8px', cornerRadius: 'md',
      ...(st.cmd ? { action: say(st.text, st.cmd), backgroundColor: C.panel2 } : {}),
    })),
  ];
  return flex((alt || `${title}${sub ? ' · ' + sub : ''}`).slice(0, 380), bubble({
    hero: pic,
    header,
    body: body.length ? body : [t(' ')],
    footer: buttons.length ? buttonRows(buttons.slice(0, 4), buttons[0]?.type === 'uri' ? 'primary' : 'primary') : [],
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
        { text: `@${botName} บอร์ด`, cmd: `@${botName} บอร์ด` },
        { text: `@${botName} ประชุม → ส่งโน้ต / เสียง / รูปไวท์บอร์ด`, cmd: `@${botName} ประชุม` },
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
      { text: 'ประชุม → ส่งโน้ต / เสียง / รูปไวท์บอร์ด', cmd: 'ประชุม' },
      { text: 'งานทีม', cmd: 'งานทีม' },
    ],
  });
}
