// Cloud Scheduler calls /cron/tick once an hour (one job = inside the free
// tier). Each slot runs at most once a day, so retries and extra calls are safe.
//
//   morning  daily private digest (one push per person, only if needed: tasks to
//            look at, or a class to teach today)
//            + one gentle group tag for tasks overdue >= 2 days
//   monday   plan for the week + milestones + this week's classes (group)
//   friday   done / late / blocked            (group)
//   evening  ✓ round-up, if nothing carried it earlier (group). Low priority:
//            when the push budget is ahead of pace the lines wait for the next
//            free reply in the group or the next evening.

import { addDays, diffDays, formatDay, relDays, weekStart, zonedClock } from './dates.js';
import { ownersOf, byDue } from './team.js';
import { addToken, hasToken } from './bot.js';
import { mentionText } from './line.js';
import * as F from './flex.js';
import { classesBetween } from './classes.js';

const OVERDUE_DM_DAYS = new Set([1, 2, 3, 5, 7]);

export class Scheduler {
  constructor({ cfg, db, team, line, bot, research = null }) {
    Object.assign(this, { cfg, db, team, line, bot, research });
  }

  async tick({ now = new Date(), force = null } = {}) {
    const { hour, weekday } = zonedClock(this.cfg.timeZone, now);
    const s = this.cfg.schedule;
    const due = [];
    if (force) due.push(force);
    else {
      if (hour === s.morningHour) due.push('morning');
      if (weekday === 1 && hour === s.mondayHour) due.push('monday');
      if (weekday === 5 && hour === s.fridayHour) due.push('friday');
      if (hour === s.eveningHour) due.push('evening');
    }
    const ran = [];
    for (const slot of due) {
      const key = `ran:${slot}:${this.team.today()}`;
      if (!force && await this.db.kvGet(key, false)) continue;
      await this.db.kvSet(key, true);
      try {
        ran.push({ slot, ...(await this[slot]()) });
      } catch (err) {
        console.error(`cron ${slot} failed`, err?.message || err);
        ran.push({ slot, error: String(err?.message || err) });
      }
    }
    // Google Form answers -> the board's Research page, every tick (2 Sheet reads, no pushes).
    const research = this.research && !force ? await this.research.sync().catch((err) => ({ error: String(err?.message || err) })) : undefined;
    return { hour, weekday, ran, ...(research ? { research } : {}) };
  }

  // ---- morning -------------------------------------------------------------
  async morning() {
    const today = this.team.today();
    const [members, tasks, docs] = await Promise.all([this.team.members(), this.team.tasks(), this.boardDocs()]);
    let sent = 0;
    for (const m of members) {
      if (!m.line_user_id) continue;
      const plan = digestFor(m.nickname, tasks, today, this.cfg.reminderDays);
      const teaching = classesBetween(docs, today, today, { tutor: m.nickname });
      if (!plan.items.length && !teaching.length) continue;
      if ((await this.db.kvGet('lastpush:' + m.nickname, '')) === today) continue;
      const msgs = F.digestMessages({
        greeting: `Good morning ${m.nickname} ☀️`,
        today,
        sections: plan.sections,
        actionable: plan.actionable,
        classes: teaching,
      });
      const ok = await this.line.push(m.line_user_id, msgs, { kind: 'digest' });
      if (!ok) continue;
      sent++;
      await this.db.kvSet('lastpush:' + m.nickname, today);
      for (const { task, token } of plan.items) {
        await this.team.updateTask(task.id, (cur) => ({ reminded: addToken(cur.reminded, token) }));
      }
    }
    const tagged = await this.overdueTag(members, tasks, today);
    return { sent, tagged };
  }

  async boardDocs() {
    if (!this.bot?.store) return {};
    return (await this.bot.store.snapshot().catch(() => ({ docs: {} }))).docs;
  }

  /** One combined, gentle group message for tasks late by >= N days (once per task). */
  async overdueTag(members, tasks, today) {
    const group = await this.db.kvGet('team_group', '');
    if (!group) return 0;
    const late = tasks.filter((t) => t.status !== 'done' && t.status !== 'blocked' && t.due && !t.overdue_tagged
      && diffDays(t.due, today) >= this.cfg.overdueTagAfterDays);
    if (!late.length) return 0;
    const users = {};
    const lines = late.slice(0, 8).map((t) => {
      const who = ownersOf(t).map((nick) => {
        const k = 'm' + Object.keys(users).length;
        const m = members.find((x) => x.nickname === nick);
        users[k] = { uid: m?.line_user_id, name: nick };
        return `{${k}}`;
      }).join(' ');
      return `• ${who} "${t.title}" ${relDays(diffDays(today, t.due))}`;
    });
    const msg = mentionText(`Gentle nudge 🙏 these are past their due date. If something is in the way, say so and we'll help.\n${lines.join('\n')}`, users);
    const ok = await this.line.push(group, msg, { kind: 'overdue_tag' });
    if (!ok) return 0;
    for (const t of late.slice(0, 8)) await this.team.updateTask(t.id, { overdue_tagged: today });
    return late.length;
  }

  // ---- weekly ---------------------------------------------------------------
  async monday() {
    const group = await this.db.kvGet('team_group', '');
    if (!group) return { skipped: 'no group' };
    const today = this.team.today();
    const mon = weekStart(today);
    const sun = addDays(mon, 6);
    const [tasks, milestones, members, docs] = await Promise.all([this.team.tasks(), this.team.milestones(), this.team.members(), this.boardDocs()]);
    const classes = classesBetween(docs, mon, sun);
    const research = this.research ? await this.research.progressLine(today, addDays(today, -6)).catch(() => '') : '';
    const open = tasks.filter((t) => t.status !== 'done');
    const week = open.filter((t) => t.due && t.due >= mon && t.due <= sun).sort(byDue);
    const late = open.filter((t) => t.due && t.due < mon);
    const blocked = open.filter((t) => t.status === 'blocked');
    const ms = milestones.filter((m) => !m.done && m.date && m.date >= mon && m.date <= sun);
    const byPerson = members.map((m) => {
      const mine = week.filter((t) => ownersOf(t).includes(m.nickname));
      return mine.length ? `${m.nickname}: ${mine.map((t) => `${t.title} (${formatDay(t.due, today)})`).join(', ')}` : null;
    }).filter(Boolean);
    const msg = F.weeklyMessage({
      title: "This week's plan 💪",
      subtitle: `${formatDay(mon, today)} – ${formatDay(sun, today)}`,
      today,
      stats: [
        { label: 'Due this week', value: week.length, color: '#0B5C03' },
        { label: 'Carried over', value: late.length, color: '#B7791F' },
        { label: 'Blocked', value: blocked.length, color: '#C8462F' },
      ],
      sections: [
        { label: `📅 Due this week (${week.length})`, lines: byPerson },
        { label: '🏁 Milestone', lines: ms.map((m) => `${m.title} · ${formatDay(m.date, today)}`) },
        ...(classes.length ? [{ label: `📚 Classes this week (${classes.length})`, lines: classes.map((c) => `${formatDay(c.date, today)}${c.time ? ' ' + c.time : ''} · ${c.course}${c.brand ? ` (${c.brand})` : ''}${c.tutor ? ' · ' + c.tutor : ''}`) }] : []),
        ...(late.length ? [{ label: `🔴 Carried over (${late.length})`, color: '#C8462F', lines: late.map((t) => `${t.title} (${ownersOf(t).join(', ')})`) }] : []),
        ...(blocked.length ? [{ label: `🚧 Blocked (${blocked.length})`, color: '#C8462F', lines: blocked.map((t) => `${t.title}${t.blocker ? ': ' + t.blocker : ''}`) }] : []),
        ...(research ? [{ label: '📋 Feedback', lines: [research] }] : []),
      ],
    });
    const ok = await this.line.push(group, msg, { kind: 'monday' });
    return { sent: ok };
  }

  async friday() {
    const group = await this.db.kvGet('team_group', '');
    if (!group) return { skipped: 'no group' };
    const today = this.team.today();
    const mon = weekStart(today);
    const tasks = await this.team.tasks();
    const done = tasks.filter((t) => t.status === 'done' && t.done_at && t.done_at.slice(0, 10) >= mon);
    const open = tasks.filter((t) => t.status !== 'done');
    const late = open.filter((t) => t.due && t.due < today && t.status !== 'blocked');
    const blocked = open.filter((t) => t.status === 'blocked');
    const nextWeek = open.filter((t) => t.due && t.due > today && t.due <= addDays(mon, 13));
    const msg = F.weeklyMessage({
      title: 'Week wrap-up 🙌',
      subtitle: `${done.length} done · ${late.length} late · ${blocked.length} blocked`,
      today,
      stats: [
        { label: 'Done', value: done.length, color: '#2F8F3A' },
        { label: 'Late', value: late.length, color: '#B7791F' },
        { label: 'Blocked', value: blocked.length, color: '#C8462F' },
      ],
      sections: [
        { label: `✓ Done this week (${done.length})`, color: '#2F8F3A', lines: done.map((t) => `${t.title} (${ownersOf(t).join(', ')})`) },
        { label: `🔴 Late (${late.length})`, color: '#C8462F', lines: late.map((t) => `${t.title} (${ownersOf(t).join(', ')}) ${relDays(diffDays(today, t.due))}`) },
        { label: `🚧 Blocked (${blocked.length})`, color: '#C8462F', lines: blocked.map((t) => `${t.title}${t.blocker ? ': ' + t.blocker : ''}`) },
        { label: `⏭ Next week (${nextWeek.length})`, lines: nextWeek.sort(byDue).map((t) => `${t.title} · ${formatDay(t.due, today)}`) },
      ],
    });
    const ok = await this.line.push(group, msg, { kind: 'friday' });
    return { sent: ok };
  }

  async evening() {
    const group = await this.db.kvGet('team_group', '');
    if (!group) return { skipped: 'no group' };
    const text = await this.bot.takeNotices();
    if (!text) return { sent: false };
    const ok = await this.line.push(group, F.noticesMessage(text, 'Done today 🎉'), { kind: 'evening', low: true });
    if (!ok) await this.bot.queueNotice(text);
    return { sent: ok };
  }
}

/**
 * What one person should hear about this morning. Each item carries a token
 * stored on the task so the same reminder is never sent twice.
 */
export function digestFor(nickname, tasks, today, reminderDays = [5, 3, 1]) {
  const mine = tasks.filter((t) => t.status !== 'done' && ownersOf(t).includes(nickname)).sort(byDue);
  const items = [];
  const fresh = []; const soon = []; const todayList = []; const late = [];
  for (const t of mine) {
    if (!hasToken(t.reminded, 'a:' + nickname) && t.created_by !== nickname) {
      fresh.push(t); items.push({ task: t, token: 'a:' + nickname });
    }
    if (!t.due || t.status === 'blocked') continue;
    const n = diffDays(today, t.due);
    if (n > 0 && reminderDays.includes(n) && !hasToken(t.reminded, `r${n}:${t.due}`)) {
      soon.push(t); items.push({ task: t, token: `r${n}:${t.due}` });
    } else if (n === 0 && !hasToken(t.reminded, `d0:${t.due}`)) {
      todayList.push(t); items.push({ task: t, token: `d0:${t.due}` });
    } else if (n < 0 && (OVERDUE_DM_DAYS.has(-n) || -n % 7 === 0) && !hasToken(t.reminded, `o${-n}:${t.due}`)) {
      late.push(t); items.push({ task: t, token: `o${-n}:${t.due}` });
    }
  }
  const sections = [
    { label: '🆕 New for you', tasks: fresh },
    { label: '📌 Due today', tasks: todayList },
    { label: '⏰ Due soon', tasks: soon },
    { label: '🔴 Overdue', tasks: late, color: '#C8462F' },
  ];
  const actionable = [
    ...todayList.map((t) => ({ ...t, _note: 'Due today' })),
    ...late.map((t) => ({ ...t, _note: relDays(diffDays(today, t.due)) })),
    ...soon.map((t) => ({ ...t, _note: relDays(diffDays(today, t.due)) })),
  ];
  return { items, sections, actionable };
}
