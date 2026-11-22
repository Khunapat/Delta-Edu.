// LINE Flex cards in the δelta Edu. look (from the institution's slide deck):
// cream panels, deep-green gradient hero tiles with cream text, KPI tiles with bars,
// stacked status bars, pill tags and pill buttons, brand tags (Uni green, LITE gold,
// Both blue), overlapping initials avatars, and animated banners (APNG,
// brand/banner-*.png) for the big moments. All text is English.
// Every button is a postback, a date picker or a typed command: tapping never costs an AI call.
//
// LINE renders these with the phone's own font; no shadows or CSS animation. Motion
// comes only from the animated banner images, which need a public https base URL
// (setAssetBase, set from the first request the server gets). Without it, cards
// simply have no banner.

import { formatDay, relDays, diffDays } from './dates.js';
import { ownersOf, STATUS_LABEL } from './team.js';

// δelta Edu. tokens: deep green #0B5C03, light green #C8E88D, cream #FDFCF4, gold #D4A017 (LITE).
export const C = {
  bg: '#FDFCF4', panel: '#FFFFFF', panel2: '#F3F7EF', panel3: '#E2EBDC', ink: '#1F2A1D', muted: '#5F6B5B', faint: '#8E9A8B', line: '#DCE6D6',
  accent: '#0B5C03', accent2: '#2E7D1E', accentSoft: '#E3F0DA', onAccent: '#FDFCF4', lime: '#C8E88D',
  heroA: '#0B5C03', heroMid: '#1A6C10', heroB: '#2E7D1E',
  heroKicker: '#C8E88D', heroSub: '#FDFCF4CC',
  todo: '#8E9A8B', doing: '#0B5C03', blocked: '#C8462F', done: '#2F8F3A', warn: '#B7791F',
  blockedSoft: '#FBE7E2', warnSoft: '#FBF1DC', doneSoft: '#E2F3E0',
  track: '#FDFCF433', // see-through cream track on the green hero
  brands: { Uni: '#0B5C03', LITE: '#C8961A', Both: '#3E7CB1' },
  streams: ['#2E7D1E', '#3E7CB1', '#8A5CC2', '#C2577F', '#2E8C83', '#B7791F'],
};

/** Brand tag colour: Uni green, LITE gold, Both blue; anything else from a fixed palette. */
export function streamColor(name) {
  if (C.brands[name]) return C.brands[name];
  let h = 0;
  for (const ch of String(name || 'Both')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return C.streams[h % C.streams.length];
}

// ---- animated banners (brand/banner-*.png) -------------------------------
let ASSET_BASE = '';
let ASSET_V = '1';
/** e.g. setAssetBase('https://delta-edu-bot-xxx.run.app', 'a1b2c3') */
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
/** Tap = the user "types" this text (free, no AI). In a group it needs @Delta in front. */
export const say = (label, text) => ({ type: 'message', label: label.slice(0, 20), text });

export function quickReply(actions) {
  return { items: actions.slice(0, 13).map((action) => ({ type: 'action', action })) };
}

/** Pill button like the dashboard's .btn / .btn.primary. */
function pill(action, kind = 'secondary', o = {}) {
  const styles = {
    primary: { bg: null, color: C.onAccent, border: C.heroA },
    secondary: { bg: C.panel2, color: C.accent, border: C.line },
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
/** Buttons from actions: the first is the green one, two per row. */
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
  return box('horizontal', [dot(c, '6px'), t(name || 'Both', { size: 'xxs', weight: 'bold', color: c, wrap: false, margin: 'sm', flex: 0 })], {
    backgroundColor: C.panel, borderColor: C.line, borderWidth: 'light', cornerRadius: 'xxl', alignItems: 'center',
    paddingStart: '9px', paddingEnd: '10px', paddingTop: '3px', paddingBottom: '3px', flex: 0,
  });
}
const tags = (...items) => box('horizontal', items.filter(Boolean), { spacing: 'xs' });

/** Round avatar with initials like .avatar */
function avatar(name, size = 28) {
  const initials = String(name || '?').trim().slice(0, 2).toUpperCase();
  return box('vertical', [t(initials, { size: size < 26 ? 'xxs' : 'xs', weight: 'bold', align: 'center', color: C.onAccent, wrap: false })], {
    width: `${size}px`, height: `${size}px`, cornerRadius: 'xxl', backgroundColor: C.streams[[...String(name)].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) >>> 0, 7) % C.streams.length], justifyContent: 'center', flex: 0,
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
    kicker ? t(kicker, { size: 'xxs', weight: 'bold', color: C.heroKicker }) : null,
    title ? t(title, { size: big != null ? 'sm' : 'lg', weight: 'bold', color: C.onAccent, margin: kicker ? 'xs' : undefined }) : null,
    big != null ? t(String(big), { size: '3xl', weight: 'bold', color: C.onAccent, margin: 'sm' }) : null,
    sub ? t(sub, { size: 'xs', color: C.heroSub, margin: 'xs' }) : null,
    stack ? stackBar(stack, { track: C.track, margin: 'lg' }) : barPct != null ? bar(barPct, C.lime, { track: C.track, margin: 'lg' }) : null,
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

/** Coloured stripe across the top of a card (brand colour). */
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
  if (!due) return { text: 'No due date', color: C.muted, late: false, short: 'no date' };
  const n = diffDays(today, due);
  if (status === 'done') return { text: formatDay(due, today), color: C.muted, late: false, short: formatDay(due, today) };
  return { text: `${formatDay(due, today)} · ${relDays(n)}`, color: n <= 1 ? C.warn : C.muted, late: n < 0, today: n === 0, short: relDays(n) };
}
/** Due-date chip: amber when late or due within a day, green when today, quiet otherwise. */
function dueChip(due, today, status) {
  const d = dueLabel(due, today, status);
  const kind = status === 'done' ? 'low' : d.late ? 'overdue' : d.today ? 'accent' : due && diffDays(today, due) <= 1 ? 'overdue' : 'low';
  return tag(`📅 ${due ? formatDay(due, today) : 'No date'}${due && status !== 'done' ? ' · ' + d.short : ''}`, kind);
}

// ---- drafts (confirm before saving) ------------------------------------
export function draftMessage(draft, today) {
  const bubbles = draft.tasks.map((task, i) => {
    const due = task.due ? dueLabel(task.due, today) : task.noDue ? { text: 'No due date', color: C.muted } : { text: 'No due date yet · pick one', color: C.blocked };
    const ready = task.owners.length && (task.due || task.noDue);
    return bubble({
      header: plainHeader({
        kicker: draft.tasks.length > 1 ? `NEW TASK ${i + 1}/${draft.tasks.length} · TO CONFIRM` : 'NEW TASK · TO CONFIRM',
        title: task.title, sub: `from ${draft.by}`, color: ready ? C.accent : C.warn,
      }),
      body: [
        tags(streamTag(task.stream), tag({ high: 'High', med: 'Medium', low: 'Low' }[task.priority] || 'Medium', task.priority || 'med'), !ready ? tag('Missing info', 'overdue') : tag('Ready ✓', 'done')),
        task.owners.length
          ? box('horizontal', [avatarStack(task.owners, 26, C.panel), t(task.owners.join(', '), { size: 'sm', color: C.ink, gravity: 'center', margin: 'md', flex: 1 })], { margin: 'lg', alignItems: 'center' })
          : row('👤', 'Who does it? Pick someone', C.blocked),
        row('📅', due.text, due.color),
      ],
      footer: [
        pill(postback('Confirm', `a=dok&d=${draft.id}`), 'primary'),
        pillRow(
          pill(datePicker('Due date', `a=ddt&d=${draft.id}&i=${i}`, { initial: task.due && task.due >= today ? task.due : today, min: today })),
          pill(postback('Who', `a=dow&d=${draft.id}&i=${i}`)),
        ),
        pillRow(
          pill(postback('Title', `a=dti&d=${draft.id}&i=${i}`)),
          pill(postback('Brand', `a=dst&d=${draft.id}&i=${i}`)),
        ),
        pill(postback('Cancel', `a=dx&d=${draft.id}`), 'ghost'),
      ],
    });
  });
  const alt = `New task to confirm: ${draft.tasks.map((x) => x.title).join(', ')}`;
  return flex(alt, bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles.slice(0, 10) });
}

export function createdMessage(tasks, today, by) {
  const n = tasks.length === 1 ? '1 task' : `${tasks.length} tasks`;
  return flex(`Added ${n}`, bubble({
    header: hero({ kicker: 'δELTA EDU. · NEW TASK', title: `Added ${n} ✓`, sub: by ? `confirmed by ${by}` : undefined }),
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
        t(a.owners?.length ? a.owners.join(', ') : 'No owner yet', { size: 'xxs', color: a.owners?.length ? C.muted : C.blocked, flex: 0, gravity: 'center' }),
        filler(),
        a.due ? dueChip(a.due, today) : tag('No date', 'low'),
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
    m.decisions.length ? head('✓ Decided', m.decisions.length, C.done) : null,
    ...sectionRows(m.decisions, '✓', C.done),
    m.actions.length ? head('→ To do', m.actions.length, C.accent) : null,
    ...actionRows,
    m.questions.length ? head('? Open questions', m.questions.length, C.warn) : null,
    ...sectionRows(m.questions, '?', C.warn),
    !m.decisions.length && !m.actions.length && !m.questions.length ? t('No decisions or action items found in these notes.', { size: 'xs', color: C.muted, margin: 'md' }) : null,
  ].filter(Boolean);
  const sub = [m.date ? formatDay(m.date, today) : '', m.attendees.length ? m.attendees.join(', ') : ''].filter(Boolean).join(' · ');
  return flex(`${saved ? 'Meeting saved' : 'Meeting summary · to save'}: ${m.title}`, bubble({
    size: 'mega',
    header: hero({ kicker: saved ? 'δELTA EDU. · MEETING · SAVED ✓' : 'δELTA EDU. · MEETING · TO SAVE', title: m.title || 'Team meeting', sub }),
    body,
    footer: saved ? [] : [
      pill(postback('Save to board', `a=mok&m=${m.id}`, 'Save meeting'), 'primary'),
      pill(postback('Cancel', `a=mx&m=${m.id}`, 'Cancel'), 'ghost'),
    ],
  }));
}

// ---- tasks (like the kanban .tcard) -------------------------------------
export function taskBubble(task, today, { actions = true, note } = {}) {
  const due = dueLabel(task.due, today, task.status);
  const footer = [];
  if (actions && task.status !== 'done') {
    footer.push(pill(postback('Done ✓', `a=td&t=${task.id}`, `${task.title} done`), 'primary'));
    footer.push(pillRow(
      pill(datePicker('Postpone', `a=tp&t=${task.id}`, { initial: task.due && task.due > today ? task.due : today, min: today })),
      task.status === 'blocked'
        ? pill(postback('Unblocked', `a=tu&t=${task.id}`, 'Unblocked'))
        : pill(postback('Blocked', `a=tb&t=${task.id}`), 'danger'),
    ));
  }
  return bubble({
    bodyBg: C.panel2,
    header: { ...stripe(streamColor(task.stream)), backgroundColor: streamColor(task.stream) },
    body: [
      tags(streamTag(task.stream), tag(STATUS_LABEL[task.status], task.status), due.late ? tag('Overdue', 'overdue') : null),
      note ? t(note, { size: 'xs', color: C.warn, weight: 'bold', margin: 'md' }) : null,
      t(task.title, { weight: 'bold', size: 'md', margin: note ? 'xs' : 'md' }),
      task.status === 'blocked' && task.blocker ? box('horizontal', [t('🚧', { size: 'xs', flex: 0 }), t(task.blocker, { size: 'xs', color: C.blocked, margin: 'sm' })], { margin: 'xs' }) : null,
      box('horizontal', [dueChip(task.due, today, task.status), filler(), avatarStack(ownersOf(task), 24, C.panel2)], { margin: 'lg', alignItems: 'center' }),
    ],
    footer,
  });
}

export function taskListMessage(tasks, today, { empty = 'No open tasks 🎉', alt = 'My tasks', notes = {} } = {}) {
  if (!tasks.length) {
    return flex(empty, bubble({ header: hero({ kicker: 'δELTA EDU.', title: empty, sub: "New tasks for you will show up in this chat" }), body: [t('Type "new task: …" or tap New task in the menu.', { size: 'xs', color: C.muted })] }));
  }
  const bubbles = tasks.slice(0, 10).map((x) => taskBubble(x, today, { note: notes[x.id] }));
  const more = tasks.length > 10 ? [textMsg(`…and ${tasks.length - 10} more (showing the 10 due soonest)`)] : [];
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
          t(mine.length === 1 ? '1 task' : `${mine.length} tasks`, { size: 'xxs', color: late ? C.warn : C.muted, flex: 0, gravity: 'center' }),
        ]),
        t(cur ? `${cur.status === 'blocked' ? '🚧 ' : ''}${cur.title}` : 'Free · nothing open', { size: 'xxs', color: cur?.status === 'blocked' ? C.blocked : C.muted, wrap: false }),
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
  return flex('Team tasks', bubble({
    size: 'mega',
    header: hero({
      kicker: 'δELTA EDU. · TEAM', title: 'Done', big: `${pct}%`, sub: `${open.length} open · ${done.length} of ${tasks.length} done`,
      stack: [{ value: done.length, color: C.lime }, { value: doing.length, color: '#FDFCF4B3' }, { value: blocked.length, color: '#F08A6E' }, { value: todo.length, color: '#FDFCF440' }],
    }),
    body: [
      box('horizontal', [
        kpiTile('Doing', doing.length, C.doing, (doing.length / n) * 100),
        kpiTile('To do', todo.length, C.todo, (todo.length / n) * 100),
      ], { spacing: 'sm' }),
      box('horizontal', [
        kpiTile('Overdue', overdue.length, C.warn, (overdue.length / n) * 100),
        kpiTile('Blocked', blocked.length, C.blocked, (blocked.length / n) * 100),
      ], { spacing: 'sm', margin: 'sm' }),
      t('Team', { weight: 'bold', size: 'sm', margin: 'xl' }),
      ...people,
      risks.length ? t(`Risks · ${blocked.length} blocked · ${overdue.length} overdue`, { weight: 'bold', size: 'sm', margin: 'xl' }) : null,
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
      t(`${x.stream || 'Both'} · ${d.text}`, { size: 'xxs', color: d.late ? C.warn : C.muted }),
    ], { flex: 1, margin: 'md' }),
  ], { margin: 'md' });
}

export function digestMessages({ greeting, sections, today, actionable, classes = [] }) {
  const lines = [];
  if (classes.length) {
    lines.push(sectionHead('📚 Teaching today', classes.length, C.accent));
    for (const c of classes.slice(0, 6)) {
      lines.push(box('horizontal', [
        box('vertical', [filler()], { width: '4px', backgroundColor: streamColor(c.brand), cornerRadius: 'xxl', flex: 0 }),
        box('vertical', [
          t(`${c.time ? c.time + ' · ' : ''}${c.course || 'Class'}`, { size: 'sm', weight: 'bold' }),
          t([c.brand, c.students ? `${c.students} student${Number(c.students) === 1 ? '' : 's'}` : '', c.hours ? `${c.hours} h` : ''].filter(Boolean).join(' · ') || ' ', { size: 'xxs', color: C.muted }),
        ], { flex: 1, margin: 'md' }),
      ], { margin: 'md' }));
    }
  }
  for (const s of sections) {
    if (!s.tasks.length) continue;
    lines.push(sectionHead(s.label, s.tasks.length, s.color || C.ink));
    for (const x of s.tasks.slice(0, 6)) lines.push(taskLine(x, today));
  }
  const total = sections.reduce((n, s) => n + s.tasks.length, 0) + classes.length;
  const pic = banner('morning');
  const out = [flex(greeting, bubble({
    size: 'mega',
    hero: pic,
    header: pic ? undefined : hero({ kicker: formatDay(today), title: greeting, sub: total ? `${total} to look at` : 'Nothing open today 🎉' }),
    body: [
      pic ? titleBlock({ kicker: formatDay(today), title: greeting, sub: total ? `${total} to look at` : 'Nothing open today 🎉' }) : null,
      ...(lines.length ? lines : [t('All clear. Nothing urgent today 🌿', { color: C.muted, size: 'xs', margin: 'md' })]),
    ].filter(Boolean),
  }))];
  if (actionable?.length) {
    const bubbles = actionable.slice(0, 10).map((x) => taskBubble(x, today, { note: x._note }));
    out.push(flex('Tasks to update', bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }));
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
  if (pic) body.unshift(titleBlock({ kicker: 'δELTA EDU. · THIS WEEK', title, sub: subtitle }));
  if (pic && stats.length) body[1] = { ...body[1], margin: 'lg' };
  return flex(title, bubble({
    size: 'mega', hero: pic,
    header: pic ? undefined : hero({ kicker: 'δELTA EDU. · THIS WEEK', title, sub: subtitle }),
    body,
  }));
}

// ---- settings / AI usage -------------------------------------------------
export function usageMessage({ ai, push, members, linked }) {
  const rows = ai.models.length ? ai.models.map((m) => box('vertical', [
    box('horizontal', [
      t(m.model.replace(/^gemini-/, ''), { size: 'xs', flex: 1 }),
      m.exhausted ? tag('Used up today', 'blocked') : t(`${m.used}${m.limit ? ' / ' + m.limit : ''}`, { size: 'xs', color: C.muted, flex: 0 }),
    ], { alignItems: 'center' }),
    bar(m.exhausted ? 100 : m.limit ? (m.used / m.limit) * 100 : Math.min(100, m.used * 5), m.exhausted ? C.blocked : C.accent, { height: '4px', margin: 'sm' }),
  ], { margin: 'md' })) : [t('No AI used today yet', { size: 'xs', color: C.muted })];
  const pushPct = push.limit ? (push.used / push.limit) * 100 : 0;
  return flex('Settings and usage', bubble({
    size: 'mega',
    header: hero({ kicker: 'δELTA EDU. · SETTINGS', title: 'AI today', big: `${ai.total} ${ai.total === 1 ? 'call' : 'calls'}`, sub: `${ai.label} · resets ${ai.resetText}` }),
    body: [
      t('AI quota per model', { weight: 'bold', size: 'sm' }),
      ...rows,
      sep('xl'),
      box('horizontal', [
        kpiTile('Pushes this month', `${push.used}/${push.limit}`, pushPct > 80 ? C.blocked : pushPct > 60 ? C.warn : C.accent, pushPct),
        kpiTile('Linked to LINE', `${linked}/${members}`, C.done, members ? (linked / members) * 100 : 0),
      ], { spacing: 'sm', margin: 'xl' }),
    ],
  }));
}

// ---- small cards for outcomes (instead of plain text) ---------------------
const RESULT = {
  done: { icon: '✓', label: 'Done', color: C.done, soft: C.doneSoft },
  postpone: { icon: '📅', label: 'Moved', color: C.accent, soft: C.accentSoft },
  start: { icon: '▶', label: 'Started', color: C.doing, soft: C.accentSoft },
  unblock: { icon: '▶', label: 'Back on track', color: C.doing, soft: C.accentSoft },
  blocked: { icon: '🚧', label: 'Blocked', color: C.blocked, soft: C.blockedSoft },
  already: { icon: '✓', label: 'Already done', color: C.muted, soft: C.panel2 },
};

function chip(kind) {
  const k = RESULT[kind];
  return box('horizontal', [t(`${k.icon}  ${k.label}`, { size: 'xs', weight: 'bold', color: k.color, wrap: false })], {
    backgroundColor: k.soft, cornerRadius: 'xxl', paddingStart: '12px', paddingEnd: '12px', paddingTop: '5px', paddingBottom: '5px', flex: 0,
  });
}

/**
 * One task after a change: status chip, title, brand, people, due date, a note,
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
export function noticesMessage(text, title = 'Team updates') {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  return flex(`${title}: ${lines.join(' / ')}`.slice(0, 380), bubble({
    header: hero({ kicker: 'δELTA EDU. · TEAM', title, sub: lines.length === 1 ? '1 task done' : `${lines.length} tasks done` }),
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
      t('δELTA EDU. · HEADS UP', { size: 'xxs', weight: 'bold', color: C.warn }),
      t(title, { size: 'lg', weight: 'bold', color: C.ink, margin: 'xs' }),
      sub ? t(sub, { size: 'xs', color: C.muted, margin: 'xs' }) : null,
    ], { backgroundColor: C.warnSoft, paddingAll: '18px' })
    : pic ? undefined : hero({ kicker: 'δELTA EDU.', title, sub });
  const body = [
    pic ? titleBlock({ kicker: 'δELTA EDU.', title, sub }) : null,
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
      title: `Call @${botName} like this`, sub: "Normal chat is ignored", alt: `How to use ${botName} in the group`,
      steps: [
        { text: `@${botName} Kiak and Pure: Thermo I slides by Friday, Uni` },
        { text: `@${botName} team`, cmd: `@${botName} team` },
        { text: `@${botName} classes`, cmd: `@${botName} classes` },
        { text: `@${botName} decisions`, cmd: `@${botName} decisions` },
        { text: `@${botName} who is on the SAT launch?` },
        { text: `@${botName} board`, cmd: `@${botName} board` },
        { text: `@${botName} meeting → notes / voice / whiteboard photo`, cmd: `@${botName} meeting` },
      ],
      lines: [`Update your own tasks (done / postpone / blocked) in your 1:1 chat with ${botName}.`],
    });
  }
  return infoMessage({
    title: `Using ${botName}`, sub: 'Tap the menu below or just type', alt: `How to use ${botName}`,
    steps: [
      { text: 'my tasks', cmd: 'my tasks' },
      { text: 'today', cmd: 'today' },
      { text: 'slides done · push to monday' },
      { text: 'blocked, waiting for the price list' },
      { text: 'new task: IGCSE worksheet by Thu' },
      { text: 'classes · my classes', cmd: 'my classes' },
      { text: 'pay 10 students 10h 300 (tutor pay)' },
      { text: 'meeting → notes / voice / whiteboard photo', cmd: 'meeting' },
      { text: 'team', cmd: 'team' },
    ],
  });
}

// ---- classes, decisions, tutor pay (δelta Edu.) ---------------------------
/** Brand pill for a class: Uni green, LITE gold. */
function brandTag(name) {
  const c = streamColor(name || 'Both');
  return box('vertical', [t(name || '—', { size: 'xxs', weight: 'bold', color: '#FFFFFF', wrap: false })], {
    backgroundColor: c, cornerRadius: 'xxl', paddingStart: '8px', paddingEnd: '8px', paddingTop: '2px', paddingBottom: '2px', flex: 0,
  });
}

/** Upcoming classes grouped by day. classes: [{ date, time, end, course, brand, tutor, students, hours }] */
export function classesMessage(classes, today, { title = 'Classes · next 7 days', empty = 'No classes in the next 7 days', boardUri = '' } = {}) {
  const body = [];
  let day = '';
  for (const c of classes.slice(0, 14)) {
    if (c.date !== day) {
      day = c.date;
      const n = diffDays(today, c.date);
      body.push(t(`${n === 0 ? 'TODAY · ' : n === 1 ? 'TOMORROW · ' : ''}${formatDay(c.date, today).toUpperCase()}`, { size: 'xxs', weight: 'bold', color: C.accent2, margin: body.length ? 'xl' : undefined }));
    }
    body.push(box('horizontal', [
      t(c.time || '—', { size: 'sm', weight: 'bold', color: C.accent, flex: 0, wrap: false }),
      box('vertical', [
        t(c.course || 'Class', { size: 'sm', weight: 'bold' }),
        box('horizontal', [
          brandTag(c.brand),
          t([c.tutor, c.students ? `${c.students} student${Number(c.students) === 1 ? '' : 's'}` : '', c.hours ? `${c.hours} h` : ''].filter(Boolean).join(' · '), { size: 'xxs', color: C.muted, margin: 'sm', gravity: 'center' }),
        ], { margin: 'xs', alignItems: 'center' }),
      ], { flex: 1, margin: 'lg' }),
    ], { backgroundColor: C.panel2, cornerRadius: 'md', paddingAll: '10px', margin: 'sm' }));
  }
  if (classes.length > 14) body.push(t(`…and ${classes.length - 14} more on the board`, { size: 'xxs', color: C.muted, margin: 'md' }));
  if (!body.length) body.push(t(empty, { size: 'sm', color: C.muted }), t('Add classes on the board (Classes page).', { size: 'xs', color: C.faint, margin: 'sm' }));
  const n = classes.length;
  return flex(`${title}: ${n ? classes.slice(0, 3).map((c) => `${c.course} ${formatDay(c.date, today)} ${c.time || ''}`.trim()).join(', ') : empty}`, bubble({
    size: 'mega',
    header: hero({ kicker: 'δELTA EDU. · CLASSES', title, sub: n ? `${n} ${n === 1 ? 'session' : 'sessions'}` : undefined }),
    body,
    footer: boardUri ? [pill({ type: 'uri', label: 'Open Classes', uri: boardUri }, 'secondary')] : [],
  }));
}

/** Open decisions (and the latest agreed ones). */
export function decisionsMessage({ open, agreed }, today, { boardUri = '' } = {}) {
  const item = (d, color, sub) => box('horizontal', [
    box('vertical', [filler()], { width: '4px', backgroundColor: color, cornerRadius: 'xxl', flex: 0 }),
    box('vertical', [
      t(d.title, { size: 'sm', weight: 'bold' }),
      sub ? t(sub, { size: 'xxs', color: C.muted }) : null,
    ], { flex: 1, margin: 'md' }),
  ], { margin: 'md' });
  const body = [];
  if (open.length) body.push(sectionHead('Open', open.length, C.warn));
  for (const d of open.slice(0, 10)) body.push(item(d, C.warn, [d.area, d.owner, d.due ? `decide by ${formatDay(d.due, today)}` : ''].filter(Boolean).join(' · ')));
  if (agreed.length) body.push(sectionHead('Agreed lately', Math.min(agreed.length, 5), C.done));
  for (const d of agreed.slice(0, 5)) body.push(item(d, C.done, d.outcome || d.area || ''));
  if (!body.length) body.push(t('No decisions on the board yet.', { size: 'sm', color: C.muted }), t('Meeting decisions you save land here too.', { size: 'xs', color: C.faint, margin: 'sm' }));
  return flex(`Decisions: ${open.length} open`, bubble({
    size: 'mega',
    header: hero({ kicker: 'δELTA EDU. · DECISIONS', title: open.length ? `${open.length} still open` : 'Nothing open', sub: 'Provisional until the partners agree' }),
    body,
    footer: boardUri ? [pill({ type: 'uri', label: 'Open Decisions', uri: boardUri }, 'secondary')] : [],
  }));
}

/** Tutor pay split from payout(): per-band rows, tutor and company totals. */
export function payMessage({ students, hours, price, result, fmt }) {
  const rowLine = (r) => box('horizontal', [
    t(`Students ${r.from}${r.to == null ? '+' : r.to !== r.from ? `–${r.to}` : ''}`, { size: 'xs', color: C.accent, weight: 'bold', flex: 3 }),
    t(`${fmt(r.fees)} × ${r.pct}%`, { size: 'xs', color: C.muted, flex: 4 }),
    t(fmt(r.tutor), { size: 'xs', weight: 'bold', align: 'end', flex: 3 }),
  ], { margin: 'md' });
  return flex(`Tutor pay: ${fmt(result.tutor)} of ${fmt(result.fees)}`, bubble({
    size: 'mega',
    header: hero({ kicker: 'δELTA EDU. · TUTOR PAY (PROVISIONAL)', title: 'Tutor share', big: fmt(result.tutor), sub: `${students} students × ${hours} h × ${fmt(price)} = ${fmt(result.fees)}` }),
    body: [
      ...result.rows.map(rowLine),
      sep('lg'),
      box('horizontal', [
        kpiTile('Tutor', `${result.effective}%`, C.accent, result.effective),
        kpiTile('Company', fmt(result.company), C.warn, result.fees ? 100 - result.effective : 0),
      ], { spacing: 'sm', margin: 'lg' }),
      t('Follows the ladder on the board (Classes page). Base: net collected fees.', { size: 'xxs', color: C.faint, margin: 'md' }),
    ],
  }));
}
