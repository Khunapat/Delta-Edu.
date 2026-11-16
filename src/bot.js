// Chat handling for the team group and 1:1 chats.
//
// Group: the AI runs only when the bot is mentioned; buttons always work.
// 1:1:   commands and buttons first (free), the AI only for free-form text.
// Every write goes through Team (the Sheet) after checks here.

import { understand } from './ai/brain.js';
import { AiOff, AiResting } from './ai/index.js';
import { command, detectUpdate, matchTasks } from './rules.js';
import { addDays, diffDays, formatDay, isDayKey, parseThaiDate, relDays } from './dates.js';
import { newId, ownersOf, byDue, normName } from './team.js';
import * as F from './flex.js';
import { mentionText } from './line.js';

const DRAFT_TTL_MS = 24 * 3600_000;
const AWAIT_TTL_MS = 30 * 60_000;

export class Bot {
  constructor({ cfg, db, team, line, ai }) {
    this.cfg = cfg;
    this.db = db;
    this.team = team;
    this.line = line;
    this.ai = ai;
    this.name = cfg.botName;
  }

  today() { return this.team.today(); }

  // ======================================================================
  async handle(event) {
    const src = event.source || {};
    const chat = src.type === 'group' ? 'group' : src.type === 'user' ? 'direct' : null;
    if (!chat) return;
    const c = {
      chat, event, uid: src.userId || '', groupId: src.groupId || '', replyToken: event.replyToken,
      chatId: chat === 'group' ? src.groupId : src.userId,
    };

    if (event.type === 'join') return this.reply(c, F.textMsg(`สวัสดี ${this.name} มาแล้ว 👋\nให้ admin ของทีมพิมพ์ "@${this.name} ใช้กลุ่มนี้" เพื่อตั้งเป็นกลุ่มทีม\nแล้วทุกคนทักแชทส่วนตัวกับ ${this.name} พิมพ์ "ฉันคือ <ชื่อเล่น>" ครั้งเดียว`));
    if (event.type === 'follow') return this.reply(c, F.textMsg(`สวัสดี นี่ ${this.name} ผู้ช่วยทีม NORSE 🌿\nครั้งแรกพิมพ์ "ฉันคือ <ชื่อเล่นในทีม>" เพื่อเชื่อมบัญชีนะ`));
    if (event.type !== 'message' && event.type !== 'postback') return;

    if (chat === 'group') {
      const teamGroup = await this.db.kvGet('team_group', '');
      c.isTeamGroup = teamGroup === c.groupId;
      c.teamGroupSet = !!teamGroup;
    }
    c.member = await this.team.memberByUserId(c.uid);

    if (event.type === 'postback') return this.onPostback(c);
    if (event.message?.type !== 'text') return; // MVP 1: text only
    return chat === 'group' ? this.onGroupText(c) : this.onDirectText(c);
  }

  async reply(c, messages) {
    const list = (Array.isArray(messages) ? messages : [messages]).flat().filter(Boolean);
    if (c.chat === 'group' && c.isTeamGroup) {
      // Piggy-back queued ✓ lines on a free reply instead of a paid push.
      const notices = await this.takeNotices();
      if (notices) list.push(F.textMsg(notices));
    }
    await this.line.reply(c.replyToken, list.slice(0, 5));
  }

  // ======================================================================
  // GROUP
  async onGroupText(c) {
    const msg = c.event.message;
    const mentionees = msg.mention?.mentionees || [];
    const botMentioned = mentionees.some((m) => m.isSelf) || new RegExp(`^\\s*@?${this.name}\\b`, 'i').test(msg.text);

    // Waiting for a typed answer from this person (e.g. a new task title)?
    if (!botMentioned) {
      if (c.isTeamGroup && c.member && await this.peekAwait(c.uid)) return this.onAwaited(c, msg.text);
      return; // ignore normal chatter: no AI, no reply
    }

    const nickByUid = {};
    for (const m of mentionees) {
      if (m.isSelf || !m.userId) continue;
      const mem = await this.team.memberByUserId(m.userId);
      if (mem) nickByUid[m.userId] = mem.nickname;
    }
    const text = stripMentions(msg.text, mentionees, this.name, nickByUid);
    const cmd = command(text);

    if (!c.isTeamGroup) {
      if (cmd?.cmd === 'register_group') return this.registerGroup(c);
      if (!c.teamGroupSet) return this.reply(c, F.textMsg(`ยังไม่ได้ตั้งกลุ่มทีม ให้ admin พิมพ์ "@${this.name} ใช้กลุ่มนี้"`));
      return; // another group: stay quiet
    }
    if (!c.member) return this.reply(c, F.textMsg(`ยังไม่รู้จักกันเลย 🙂 ทักแชทส่วนตัวกับ ${this.name} แล้วพิมพ์ "ฉันคือ <ชื่อเล่น>" ก่อนนะ`));

    if (cmd) return this.onCommand(c, cmd);

    const mentioned = [...new Set(Object.values(nickByUid))];
    return this.withAi(c, text, { mentioned });
  }

  async registerGroup(c) {
    if (!c.member?.admin) {
      return this.reply(c, F.textMsg(`ต้องเป็น admin ของทีม (คอลัมน์ role = admin ในแท็บ Members) และเชื่อม LINE แล้ว ถึงจะตั้งกลุ่มได้`));
    }
    await this.db.kvSet('team_group', c.groupId);
    await this.db.log(c.member.nickname, c.groupId, 'register_group');
    c.isTeamGroup = true;
    return this.reply(c, F.textMsg(`ตั้งกลุ่มนี้เป็นกลุ่มทีมแล้ว ✓\nเรียก @${this.name} เมื่อไหร่ค่อยตอบ คุยกันปกติไม่ต้องห่วง`));
  }

  // ======================================================================
  // 1:1
  async onDirectText(c) {
    const text = c.event.message.text;
    const cmd = command(text);
    if (cmd?.cmd === 'link') return this.link(c, cmd.name);
    if (!c.member) return this.reply(c, F.textMsg('ยังไม่รู้จักกัน 🙂 พิมพ์ "ฉันคือ <ชื่อเล่นในทีม>" ก่อนนะ (ใช้ได้เฉพาะคนในทีม NORSE)'));

    if (await this.peekAwait(c.uid)) {
      if (!cmd) return this.onAwaited(c, text);
      await this.db.kvDel('await:' + c.uid);
    }
    if (cmd) return this.onCommand(c, cmd);

    // "mockup เสร็จแล้ว" / "ขอเลื่อนเป็นจันทร์" / "ติด supplier ยังไม่ตอบ" without AI when clear.
    const action = detectUpdate(text);
    if (action) {
      const mine = await this.team.openTasksOf(c.member.nickname);
      let hits = matchTasks(text, mine);
      if (!hits.length && mine.length === 1) hits = mine;
      if (hits.length === 1) return this.applyUpdate(c, hits[0], action, { text });
      if (hits.length > 1) return this.askWhichTask(c, hits, action, text);
    }
    return this.withAi(c, text, {});
  }

  async link(c, name) {
    if (c.chat !== 'direct') return this.reply(c, F.textMsg('เชื่อมบัญชีในแชทส่วนตัวนะ'));
    const r = await this.team.link(name, c.uid);
    if (!r.ok && r.reason === 'unknown') return this.reply(c, F.textMsg(`ไม่เจอ "${name}" ในรายชื่อทีม ลองชื่อเล่นที่ใช้ในทีม หรือให้ admin เพิ่มชื่อในแท็บ Members ก่อนนะ`));
    if (!r.ok && r.reason === 'taken') return this.reply(c, F.textMsg(`ชื่อ ${r.member.nickname} เชื่อมกับ LINE อีกบัญชีไปแล้ว ถ้าเปลี่ยนเครื่อง/บัญชี ให้ admin ล้างช่อง line_user_id ในแท็บ Members ก่อน`));
    await this.db.log(r.member.nickname, 'direct', 'link');
    return this.reply(c, [F.textMsg(`เชื่อมแล้ว สวัสดี ${r.member.nickname} 👋`), F.helpMessage('direct', this.name)]);
  }

  // ======================================================================
  async onCommand(c, cmd) {
    const today = this.today();
    switch (cmd.cmd) {
      case 'mine': {
        const mine = await this.team.openTasksOf(c.member.nickname);
        return this.reply(c, F.taskListMessage(mine, today, { alt: `งานของ ${c.member.nickname}` }));
      }
      case 'team':
        return this.reply(c, F.teamMessage({ members: await this.team.members(), tasks: await this.team.tasks(), today }));
      case 'brief':
        return this.reply(c, await this.brief(c.member));
      case 'settings':
        return this.reply(c, await this.settingsCard());
      case 'help':
        return this.reply(c, F.helpMessage(c.chat, this.name));
      case 'register_group':
        return c.chat === 'group' ? this.registerGroup(c) : this.reply(c, F.textMsg('พิมพ์คำนี้ในกลุ่มทีมนะ'));
      case 'link':
        return this.link(c, cmd.name);
      default:
        return this.reply(c, F.helpMessage(c.chat, this.name));
    }
  }

  async settingsCard() {
    const [ai, push, members] = await Promise.all([this.ai.status(), this.line.quota(), this.team.members()]);
    return F.usageMessage({ ai, push, members: members.length, linked: members.filter((m) => m.line_user_id).length });
  }

  async brief(member) {
    const today = this.today();
    const mine = await this.team.openTasksOf(member.nickname);
    const overdue = mine.filter((x) => x.due && x.due < today && x.status !== 'blocked');
    const dueToday = mine.filter((x) => x.due === today);
    const soon = mine.filter((x) => x.due && x.due > today && diffDays(today, x.due) <= 7);
    const blocked = mine.filter((x) => x.status === 'blocked');
    const rest = mine.filter((x) => !overdue.includes(x) && !dueToday.includes(x) && !soon.includes(x) && !blocked.includes(x));
    return F.digestMessages({
      greeting: `วันนี้ของ ${member.nickname}`,
      today,
      sections: [
        { label: '🔴 เลยกำหนด', tasks: overdue, color: '#C8462F' },
        { label: '📌 ส่งวันนี้', tasks: dueToday },
        { label: '⏰ ใกล้ส่ง (7 วัน)', tasks: soon },
        { label: '🚧 ติดอยู่', tasks: blocked },
        { label: 'งานอื่นๆ', tasks: rest },
      ],
      actionable: [...overdue, ...dueToday, ...soon].slice(0, 10),
    });
  }

  // ======================================================================
  // AI path (only for free-form text)
  async withAi(c, text, { mentioned = [] }) {
    if (c.chat === 'direct') this.line.showLoading(c.uid).catch(() => {});
    const today = this.today();
    const [members, tasks, milestones, streams] = await Promise.all([
      this.team.members(), this.team.tasks(), this.team.milestones(), this.team.streams(),
    ]);
    const myTasks = c.chat === 'direct' ? tasks.filter((x) => x.status !== 'done' && ownersOf(x).includes(c.member.nickname)).sort(byDue) : null;
    let out;
    try {
      out = await understand(this.ai, {
        botName: this.name, chat: c.chat, text,
        ctx: { today, sender: c.member.nickname, members, mentioned, streams, tasks, milestones, myTasks },
      });
    } catch (err) {
      if (err instanceof AiResting || err instanceof AiOff) return this.reply(c, F.textMsg(this.ai.restingText(err)));
      console.error('ai failed', err?.message || err);
      return this.reply(c, F.textMsg('ขอโทษ ตอนนี้อ่านข้อความไม่ออก ลองพิมพ์ใหม่ หรือใช้คำสั่ง งานฉัน / งานทีม ได้นะ'));
    }
    await this.db.log(c.member.nickname, c.chat, 'ai:' + out.intent, text);

    switch (out.intent) {
      case 'create_tasks':
        if (out.tasks.length) return this.startDraft(c, out.tasks, { text, mentioned, members, streams, clarify: out.clarify });
        return this.reply(c, F.textMsg(out.clarify || 'งานอะไร ใครทำ ส่งเมื่อไหร่ บอกอีกทีได้ไหม'));
      case 'team_status':
        return this.reply(c, F.teamMessage({ members, tasks, today }));
      case 'my_tasks':
        return this.reply(c, F.taskListMessage(myTasks || tasks.filter((x) => x.status !== 'done' && ownersOf(x).includes(c.member.nickname)).sort(byDue), today));
      case 'brief':
        return this.reply(c, await this.brief(c.member));
      case 'update_task':
        return this.onAiUpdate(c, out, myTasks || tasks.filter((x) => x.status !== 'done' && ownersOf(x).includes(c.member.nickname)));
      default:
        return this.reply(c, F.textMsg(out.answer || out.clarify || 'ยังไม่มีบันทึกเรื่องนี้ในข้อมูลทีมนะ'));
    }
  }

  async onAiUpdate(c, out, mine) {
    const u = out.update || {};
    const task = mine.find((x) => x.id === u.task_id);
    const action = { done: 'done', postpone: 'postpone', blocked: 'blocked', unblock: 'unblock', start: 'start' }[u.action];
    if (!action) return this.reply(c, F.textMsg(out.clarify || out.answer || 'อยากอัปเดตงานไหน ทำอะไรกับมัน บอกอีกทีได้ไหม'));
    if (!task) {
      if (!mine.length) return this.reply(c, F.textMsg('ตอนนี้ไม่มีงานค้างของคุณเลย'));
      return this.askWhichTask(c, mine.slice(0, 12), action, u.date_text || u.reason || '');
    }
    return this.applyUpdate(c, task, action, { text: u.date_text || u.reason, aiDate: u.date, reason: u.reason });
  }

  // ======================================================================
  // Drafts: AI suggestion -> card -> someone confirms -> saved
  async startDraft(c, aiTasks, { text, mentioned, members, streams, clarify }) {
    const today = this.today();
    const draft = { id: newId(), chat: c.chatId, by: c.member.nickname, created: Date.now(), tasks: [] };
    const questions = [];
    const unknown = [];
    for (const a of aiTasks.slice(0, 5)) {
      const owners = [];
      for (const raw of a.owners || []) {
        if (/^@?me$/i.test(raw)) { owners.push(c.member.nickname); continue; }
        const m = members.find((x) => normName(x.nickname) === normName(raw) || x.aliases.some((al) => normName(al) === normName(raw)));
        if (m) { if (!owners.includes(m.nickname)) owners.push(m.nickname); } else unknown.push(raw);
      }
      if (!owners.length && mentioned.length) owners.push(...mentioned);

      // Date: our parser decides; the AI's date is only used when our parser
      // could not read words that the AI also saw.
      let due = '';
      let dueOptions = null;
      const said = String(a.due_text || '').trim();
      // If the AI missed the date words, our parser may still find them in a one-task message.
      const parsed = parseThaiDate(said, today) || (!said && aiTasks.length === 1 ? parseThaiDate(text, today) : null);
      if (parsed?.date) due = parsed.date;
      else if (parsed?.ambiguous) dueOptions = parsed.options;
      else if (said && isDayKey(a.due_date) && a.due_date >= today) due = a.due_date;

      const stream = streams.find((s) => normName(s) === normName(a.stream)) || (a.stream || '').trim() || 'General';
      const task = { title: String(a.title || '').trim().slice(0, 120), owners, due, stream, priority: a.priority || 'med' };
      if (!task.title) continue;
      draft.tasks.push(task);
      if (dueOptions) questions.push({ kind: 'date', i: draft.tasks.length - 1, word: parsed.word, options: dueOptions });
    }
    if (!draft.tasks.length) return this.reply(c, F.textMsg(clarify || 'ยังไม่แน่ใจว่างานคืออะไร พิมพ์อีกทีได้ไหม'));
    await this.db.kvSet('draft:' + draft.id, draft);

    const msgs = [F.draftMessage(draft, today)];
    if (unknown.length) msgs.push(F.textMsg(`ไม่เจอชื่อ ${[...new Set(unknown)].join(', ')} ในทีม กด "คนทำ" เพื่อเลือกจากรายชื่อนะ`));
    const q = questions[0];
    if (q) {
      msgs.push(F.textMsg(`"${q.word}" หมายถึงวันไหน?`, F.quickReply([
        ...q.options.map((o) => F.postback(o.label, `a=dsd&d=${draft.id}&i=${q.i}&v=${o.date}`, o.label)),
        F.datePicker('เลือกวันเอง', `a=ddt&d=${draft.id}&i=${q.i}`, { min: today }),
      ])));
    } else {
      const noOwner = draft.tasks.findIndex((x) => !x.owners.length);
      const noDue = draft.tasks.findIndex((x) => !x.due);
      if (noOwner >= 0) msgs.push(this.ownerPicker(draft, noOwner, members, `ใครทำ "${draft.tasks[noOwner].title}"?`));
      else if (noDue >= 0) {
        msgs.push(F.textMsg(`"${draft.tasks[noDue].title}" ส่งวันไหน?`, F.quickReply([
          F.datePicker('เลือกวันส่ง', `a=ddt&d=${draft.id}&i=${noDue}`, { min: today }),
          F.postback('ไม่มีกำหนด', `a=dnd&d=${draft.id}&i=${noDue}`, 'ไม่มีกำหนดส่ง'),
        ])));
      }
    }
    return this.reply(c, msgs);
  }

  ownerPicker(draft, i, members, prompt) {
    const cur = draft.tasks[i].owners;
    return F.textMsg(prompt || `เลือกคนทำ "${draft.tasks[i].title}" (กดได้หลายคน)`, F.quickReply(
      members.map((m) => F.postback(`${cur.includes(m.nickname) ? '✓ ' : ''}${m.nickname}`, `a=dso&d=${draft.id}&i=${i}&n=${encodeURIComponent(m.nickname)}`)),
    ));
  }

  async loadDraft(id) {
    const d = await this.db.kvGet('draft:' + id, null);
    if (!d) return null;
    if (Date.now() - (d.created || 0) > DRAFT_TTL_MS) { await this.db.kvDel('draft:' + id); return null; }
    return d;
  }

  async saveDraftAndShow(c, draft, extra = []) {
    await this.db.kvSet('draft:' + draft.id, draft);
    return this.reply(c, [F.draftMessage(draft, this.today()), ...extra]);
  }

  async confirmDraft(c, draft) {
    const missing = draft.tasks.findIndex((x) => !x.owners.length);
    if (missing >= 0) return this.reply(c, this.ownerPicker(draft, missing, await this.team.members(), `ยังไม่มีคนทำ "${draft.tasks[missing].title}" เลือกก่อนนะ`));
    const noDue = draft.tasks.findIndex((x) => !x.due && !x.noDue);
    if (noDue >= 0) {
      return this.reply(c, F.textMsg(`"${draft.tasks[noDue].title}" ส่งวันไหน?`, F.quickReply([
        F.datePicker('เลือกวันส่ง', `a=ddt&d=${draft.id}&i=${noDue}`, { min: this.today() }),
        F.postback('ไม่มีกำหนด', `a=dnd&d=${draft.id}&i=${noDue}`, 'ไม่มีกำหนดส่ง'),
      ])));
    }
    await this.db.kvDel('draft:' + draft.id);
    const created = await this.team.createTasks(draft.tasks, c.member.nickname);
    await this.db.log(c.member.nickname, c.chat, 'create_tasks', created.map((x) => x.title).join(' | '));
    await this.reply(c, F.createdMessage(created, this.today(), c.member.nickname));
    await this.notifyAssigned(created, c.member.nickname).catch((err) => console.warn('assign DM failed', err?.message || err));
  }

  /** Private "new task for you" DM, unless that person already got a push today (then tomorrow's digest has it). */
  async notifyAssigned(tasks, by) {
    const today = this.today();
    const members = await this.team.members();
    for (const m of members) {
      if (!m.line_user_id || m.nickname === by) continue;
      const mine = tasks.filter((x) => ownersOf(x).includes(m.nickname));
      if (!mine.length) continue;
      if ((await this.db.kvGet('lastpush:' + m.nickname, '')) === today) continue;
      const sent = await this.line.push(m.line_user_id, [
        F.textMsg(`${by} มอบงานใหม่ให้ ${mine.length} งาน`),
        ...F.taskListMessage(mine, today, { alt: 'งานใหม่' }).slice(0, 1),
      ], { kind: 'assigned' });
      if (!sent) continue;
      await this.db.kvSet('lastpush:' + m.nickname, today);
      for (const x of mine) await this.team.updateTask(x.id, (cur) => ({ reminded: addToken(cur.reminded, 'a:' + m.nickname) }));
    }
  }

  // ======================================================================
  // Task updates
  async canEdit(c, task) {
    return !!task && (ownersOf(task).includes(c.member.nickname) || c.member.admin || task.created_by === c.member.nickname);
  }

  async applyUpdate(c, task, action, { text = '', aiDate = '', reason = '' } = {}) {
    if (!await this.canEdit(c, task)) return this.reply(c, F.textMsg('งานนี้ไม่ใช่ของคุณ ให้เจ้าของงานหรือ admin อัปเดตนะ'));
    const today = this.today();
    switch (action) {
      case 'done': return this.markDone(c, task);
      case 'start':
        await this.team.updateTask(task.id, { status: 'doing' });
        return this.reply(c, F.textMsg(`▶ เริ่ม "${task.title}" แล้ว สู้ๆ`));
      case 'unblock':
        await this.team.updateTask(task.id, { status: 'doing', blocker: '' });
        return this.reply(c, F.textMsg(`โอเค "${task.title}" กลับมาเดินต่อแล้ว ▶`));
      case 'postpone': {
        const p = parseThaiDate(text, today);
        if (p?.date) return this.postpone(c, task, p.date);
        if (p?.ambiguous) {
          return this.reply(c, F.textMsg(`"${p.word}" หมายถึงวันไหน?`, F.quickReply([
            ...p.options.map((o) => F.postback(o.label, `a=tps&t=${task.id}&v=${o.date}`, o.label)),
            F.datePicker('เลือกวันเอง', `a=tp&t=${task.id}`, { min: today }),
          ])));
        }
        if (isDayKey(aiDate) && aiDate >= today && text) return this.postpone(c, task, aiDate);
        return this.reply(c, F.textMsg(`เลื่อน "${task.title}" เป็นวันไหน?`, F.quickReply([
          F.datePicker('เลือกวัน', `a=tp&t=${task.id}`, { initial: task.due && task.due > today ? task.due : today, min: today }),
        ])));
      }
      case 'blocked': {
        const why = (reason || (detectUpdate(text) === 'blocked' ? text : '')).trim();
        if (why) return this.markBlocked(c, task, why);
        return this.askBlocker(c, task);
      }
      default:
        return this.reply(c, F.textMsg('ยังไม่แน่ใจว่าจะให้ทำอะไร ลองกดปุ่มในการ์ดงานแทนได้นะ'));
    }
  }

  async askWhichTask(c, tasks, action, text) {
    const label = { done: 'เสร็จ', postpone: 'เลื่อน', blocked: 'ติด', unblock: 'แก้ได้แล้ว', start: 'เริ่ม' }[action] || action;
    await this.db.kvSet('pendingtext:' + c.uid, { text, at: Date.now() });
    return this.reply(c, F.textMsg(`งานไหนที่${label}?`, F.quickReply(
      tasks.slice(0, 12).map((x) => F.postback(x.title.slice(0, 20), `a=pick&t=${x.id}&x=${action}`, x.title)),
    )));
  }

  async markDone(c, task) {
    if (task.status === 'done') return this.reply(c, F.textMsg(`"${task.title}" เสร็จไปแล้ว ✓`));
    await this.team.updateTask(task.id, { status: 'done' });
    await this.db.log(c.member.nickname, c.chat, 'done', task.title);
    const line = `✓ ${ownersOf(task).join(', ')} · ${task.title}`;
    if (c.chat === 'group') return this.reply(c, F.textMsg(`${line} เสร็จแล้ว 🎉`));
    await this.queueNotice(line);
    return this.reply(c, F.textMsg(`เยี่ยม! "${task.title}" เสร็จแล้ว ✓\n(เดี๋ยวกลุ่มจะเห็นเป็น ✓)`));
  }

  async postpone(c, task, date) {
    const today = this.today();
    if (date < today) return this.reply(c, F.textMsg('วันนั้นผ่านไปแล้วนะ เลือกวันใหม่อีกที'));
    await this.team.updateTask(task.id, { due: date, status: task.status === 'blocked' ? 'blocked' : task.status });
    await this.db.log(c.member.nickname, c.chat, 'postpone', `${task.title} -> ${date}`);
    return this.reply(c, F.textMsg(`เลื่อน "${task.title}" เป็น ${formatDay(date, today)} (${relDays(diffDays(today, date))}) แล้ว`));
  }

  async askBlocker(c, task) {
    await this.db.kvSet('await:' + c.uid, { type: 'blocker', taskId: task.id, at: Date.now() });
    return this.reply(c, F.textMsg(`"${task.title}" ติดอะไรอยู่? พิมพ์สั้นๆ ได้เลย`, F.quickReply([
      F.postback('รอ supplier', `a=tbr&t=${task.id}&r=${encodeURIComponent('รอ supplier ตอบ')}`, 'รอ supplier ตอบ'),
      F.postback('รอข้อมูล', `a=tbr&t=${task.id}&r=${encodeURIComponent('รอข้อมูล')}`, 'รอข้อมูล'),
      F.postback('ไม่มีเวลา', `a=tbr&t=${task.id}&r=${encodeURIComponent('ไม่มีเวลา ต้องการคนช่วย')}`, 'ไม่มีเวลา'),
    ])));
  }

  async markBlocked(c, task, reason) {
    await this.team.updateTask(task.id, { status: 'blocked', blocker: reason.slice(0, 200) });
    await this.db.log(c.member.nickname, c.chat, 'blocked', `${task.title}: ${reason}`);
    const line = `🚧 ${ownersOf(task).join(', ')} ติดงาน "${task.title}": ${reason}\nใครช่วยได้บ้าง?`;
    if (c.chat === 'group') return this.reply(c, F.textMsg(line));
    await this.reply(c, F.textMsg(`บันทึกแล้ว 🚧 เดี๋ยวบอกในกลุ่มให้ว่าใครช่วยได้`));
    const group = await this.db.kvGet('team_group', '');
    if (group) await this.line.push(group, F.textMsg(line), { essential: true, kind: 'blocked' });
  }

  // ======================================================================
  // Typed answers we asked for (blocker reason, new title, workstream)
  async peekAwait(uid) {
    const a = await this.db.kvGet('await:' + uid, null);
    if (!a) return null;
    if (Date.now() - (a.at || 0) > AWAIT_TTL_MS) { await this.db.kvDel('await:' + uid); return null; }
    return a;
  }

  async onAwaited(c, text) {
    const a = await this.peekAwait(c.uid);
    await this.db.kvDel('await:' + c.uid);
    const value = String(text).trim();
    if (!a || !value) return;
    if (a.type === 'blocker') {
      const task = await this.team.task(a.taskId);
      if (!task) return this.reply(c, F.textMsg('ไม่เจองานนั้นแล้ว'));
      return this.markBlocked(c, task, value);
    }
    const draft = await this.loadDraft(a.draftId);
    if (!draft) return this.reply(c, F.textMsg('การ์ดงานนี้หมดอายุหรือยืนยันไปแล้ว'));
    const task = draft.tasks[a.i];
    if (!task) return;
    if (a.type === 'draft_title') task.title = value.slice(0, 120);
    if (a.type === 'draft_stream') task.stream = value.slice(0, 40);
    return this.saveDraftAndShow(c, draft);
  }

  // ======================================================================
  // Buttons
  async onPostback(c) {
    const p = new URLSearchParams(c.event.postback?.data || '');
    const params = c.event.postback?.params || {};
    const a = p.get('a');
    if (!c.member) return this.reply(c, F.textMsg(`ยังไม่รู้จักกัน ทักแชทส่วนตัวแล้วพิมพ์ "ฉันคือ <ชื่อเล่น>" ก่อนนะ`));
    if (c.chat === 'group' && !c.isTeamGroup) return;

    // ---- draft buttons ----
    if (a?.startsWith('d') && p.get('d')) {
      const draft = await this.loadDraft(p.get('d'));
      if (!draft) return this.reply(c, F.textMsg('การ์ดนี้ยืนยัน/ยกเลิกไปแล้ว หรือหมดอายุ (24 ชม.)'));
      const i = Number(p.get('i') || 0);
      const task = draft.tasks[i];
      const today = this.today();
      switch (a) {
        case 'dok': return this.confirmDraft(c, draft);
        case 'dx':
          await this.db.kvDel('draft:' + draft.id);
          return this.reply(c, F.textMsg('ยกเลิกแล้ว'));
        case 'ddt':
          if (!task || !isDayKey(params.date)) return;
          if (params.date < today) return this.reply(c, F.textMsg('วันนั้นผ่านไปแล้วนะ'));
          task.due = params.date;
          return this.saveDraftAndShow(c, draft);
        case 'dsd':
          if (!task || !isDayKey(p.get('v'))) return;
          task.due = p.get('v');
          return this.saveDraftAndShow(c, draft);
        case 'dnd':
          if (!task) return;
          task.due = '';
          task.noDue = true;
          return this.saveDraftAndShow(c, draft);
        case 'dow':
          return this.reply(c, this.ownerPicker(draft, i, await this.team.members()));
        case 'dso': {
          if (!task) return;
          const n = decodeURIComponent(p.get('n') || '');
          const m = await this.team.memberByName(n);
          if (!m) return;
          task.owners = task.owners.includes(m.nickname) ? task.owners.filter((x) => x !== m.nickname) : [...task.owners, m.nickname];
          await this.db.kvSet('draft:' + draft.id, draft);
          return this.reply(c, [F.draftMessage(draft, today), this.ownerPicker(draft, i, await this.team.members(), `คนทำตอนนี้: ${task.owners.join(', ') || '-'} (กดเพิ่ม/เอาออก)`)]);
        }
        case 'dti':
          await this.db.kvSet('await:' + c.uid, { type: 'draft_title', draftId: draft.id, i, at: Date.now() });
          return this.reply(c, F.textMsg('พิมพ์ชื่องานใหม่ได้เลย'));
        case 'dst': {
          const streams = await this.team.streams();
          return this.reply(c, F.textMsg('หมวดไหน?', F.quickReply([
            ...streams.slice(0, 11).map((s) => F.postback(s.slice(0, 20), `a=dss&d=${draft.id}&i=${i}&v=${encodeURIComponent(s)}`, s)),
            F.postback('พิมพ์เอง', `a=dsw&d=${draft.id}&i=${i}`),
          ])));
        }
        case 'dss':
          if (!task) return;
          task.stream = decodeURIComponent(p.get('v') || 'General');
          return this.saveDraftAndShow(c, draft);
        case 'dsw':
          await this.db.kvSet('await:' + c.uid, { type: 'draft_stream', draftId: draft.id, i, at: Date.now() });
          return this.reply(c, F.textMsg('พิมพ์ชื่อหมวดได้เลย'));
        default: return;
      }
    }

    // ---- task buttons ----
    const task = p.get('t') ? await this.team.task(p.get('t')) : null;
    if (p.get('t') && !task) return this.reply(c, F.textMsg('ไม่เจองานนี้แล้ว (อาจถูกลบในชีต)'));
    switch (a) {
      case 'td': return this.applyUpdate(c, task, 'done');
      case 'tp':
        if (!isDayKey(params.date)) return;
        if (!await this.canEdit(c, task)) return this.reply(c, F.textMsg('งานนี้ไม่ใช่ของคุณนะ'));
        return this.postpone(c, task, params.date);
      case 'tps':
        if (!isDayKey(p.get('v')) || !await this.canEdit(c, task)) return;
        return this.postpone(c, task, p.get('v'));
      case 'tb':
        if (!await this.canEdit(c, task)) return this.reply(c, F.textMsg('งานนี้ไม่ใช่ของคุณนะ'));
        return this.askBlocker(c, task);
      case 'tbr':
        if (!await this.canEdit(c, task)) return;
        await this.db.kvDel('await:' + c.uid);
        return this.markBlocked(c, task, decodeURIComponent(p.get('r') || 'ติดอยู่'));
      case 'tu': return this.applyUpdate(c, task, 'unblock');
      case 'pick': {
        const pending = await this.db.kvGet('pendingtext:' + c.uid, null);
        await this.db.kvDel('pendingtext:' + c.uid);
        return this.applyUpdate(c, task, p.get('x'), { text: pending?.text || '' });
      }
      default: return;
    }
  }

  // ======================================================================
  // Group ✓ lines: sent with the next free reply in the group, or once in the evening.
  async queueNotice(line) {
    await this.db.kvUpdate('group_notices', (list) => [...(list || []), line].slice(-30), []);
  }
  async takeNotices() {
    const list = await this.db.kvGet('group_notices', []);
    if (!list?.length) return '';
    await this.db.kvDel('group_notices');
    return list.join('\n');
  }
}

// ---- helpers ---------------------------------------------------------------
/** Remove the bot's @mention; turn teammates' @DisplayName into their nickname. */
export function stripMentions(text, mentionees, botName, nickByUid = {}) {
  let s = String(text);
  const spans = [...mentionees].sort((a, b) => b.index - a.index);
  for (const m of spans) {
    const repl = m.isSelf ? '' : nickByUid[m.userId] ? `@${nickByUid[m.userId]}` : s.slice(m.index, m.index + m.length);
    s = s.slice(0, m.index) + repl + s.slice(m.index + m.length);
  }
  s = s.replace(new RegExp(`^\\s*@?${botName}\\b`, 'i'), '');
  return s.trim();
}

export function addToken(list, token) {
  const set = new Set(String(list || '').split(',').map((x) => x.trim()).filter(Boolean));
  set.add(token);
  return [...set].join(',');
}
export const hasToken = (list, token) => String(list || '').split(',').map((x) => x.trim()).includes(token);

export { mentionText };
