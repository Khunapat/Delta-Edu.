// Chat handling for the team group and 1:1 chats.
//
// Group: the AI runs only when the bot is mentioned; buttons always work.
// 1:1:   commands and buttons first (free), the AI only for free-form text.
// Every write goes through Team (the Sheet) after checks here.

import { understand } from './ai/brain.js';
import { AiOff, AiResting } from './ai/index.js';
import { command, detectUpdate, matchTasks } from './rules.js';
import { addDays, diffDays, formatDay, isDayKey, normalizeDate, parseThaiDate } from './dates.js';
import { newId, ownersOf, byDue, normName, normBrand, BRANDS, DEFAULT_BRAND } from './team.js';
import * as F from './flex.js';
import { mentionText } from './line.js';
import { readMeeting } from './ai/meeting.js';
import { forAi, MAX_AUDIO_BYTES } from './media.js';
import { upcomingClasses, decisionLists, ladderBands, payout, thb } from './classes.js';

const DRAFT_TTL_MS = 24 * 3600_000;
const NEW_TASK = /^(?:new task|task|งานใหม่)\s*[:：]/i;
// "meeting notes: …" / "meeting: …" (or the old Thai "ประชุม: …") with the notes after it
const MEETING_INLINE = /^(?:meeting(?:\s+notes?)?|minutes|บันทึกประชุม|สรุปประชุม|ประชุม)\s*[:：]\s*([\s\S]+)$/i;
const MEETING_TTL_MS = 24 * 3600_000;
const AWAIT_TTL_MS = 30 * 60_000;

export class Bot {
  constructor({ cfg, db, team, line, ai, knowledge = async () => '', store = null }) {
    this.cfg = cfg;
    this.store = store; // web board documents (meetings are saved there)
    this.knowledge = knowledge; // text about Delta Edu for questions (src/knowledge.js)
    this.db = db;
    this.team = team;
    this.line = line;
    this.ai = ai;
    this.name = cfg.botName;
  }

  today() { return this.team.today(); }

  /** Text a button should "type": in a group it needs @Delta in front or the bot ignores it. */
  cmd(c, text) { return c.chat === 'group' ? `@${this.name} ${text}` : text; }

  // ======================================================================
  async handle(event) {
    const src = event.source || {};
    const chat = src.type === 'group' ? 'group' : src.type === 'user' ? 'direct' : null;
    if (!chat) return;
    const c = {
      chat, event, uid: src.userId || '', groupId: src.groupId || '', replyToken: event.replyToken,
      chatId: chat === 'group' ? src.groupId : src.userId,
    };

    if (event.type === 'join') {
      return this.reply(c, F.infoMessage({
        title: `Hi, ${this.name} is here 👋`, sub: 'The δelta Edu. team helper', banner: 'welcome',
        steps: [
          { text: `Admin: open a 1:1 chat with ${this.name} and send "I am <nickname>"` },
          { text: `Admin: type "@${this.name} use this group" here` },
          { text: `Everyone: open a 1:1 chat with ${this.name} and send "I am <nickname>"` },
        ],
      }));
    }
    if (event.type === 'follow') {
      return this.reply(c, F.infoMessage({
        title: `Hi, this is ${this.name} 🌿`, sub: 'The δelta Edu. team helper', banner: 'welcome',
        lines: ['First time? Send "I am <your team nickname>" to link your account (team and tutors only).'],
      }));
    }
    if (event.type !== 'message' && event.type !== 'postback') return;

    if (chat === 'group') {
      const teamGroup = await this.db.kvGet('team_group', '');
      c.isTeamGroup = teamGroup === c.groupId;
      c.teamGroupSet = !!teamGroup;
    }
    c.member = await this.team.memberByUserId(c.uid);

    if (event.type === 'postback') return this.onPostback(c);
    const kind = event.message?.type;
    if (kind === 'image' || kind === 'audio') return this.onMedia(c, kind);
    if (kind !== 'text') return;
    return chat === 'group' ? this.onGroupText(c) : this.onDirectText(c);
  }

  async reply(c, messages) {
    const list = (Array.isArray(messages) ? messages : [messages]).flat().filter(Boolean).slice(0, 5);
    if (c.chat === 'group' && c.isTeamGroup && list.length < 5) {
      // Piggy-back queued ✓ lines on a free reply instead of a paid push.
      const notices = await this.takeNotices();
      if (notices) list.push(F.noticesMessage(notices));
    }
    try {
      await this.line.reply(c.replyToken, list);
    } catch (err) {
      // Slow work (a long voice note) can outlive the reply token: send it as one push instead.
      if (c.slow && Number(err?.status) === 400 && c.chatId) {
        await this.line.push(c.chatId, list, { kind: 'late_reply' });
        return;
      }
      throw err;
    }
  }

  // ======================================================================
  // GROUP
  async onGroupText(c) {
    const msg = c.event.message;
    const mentionees = msg.mention?.mentionees || [];
    const botMentioned = mentionees.some((m) => m.isSelf) || new RegExp(`^\\s*@?${this.name}\\b`, 'i').test(msg.text);

    // Waiting for a typed answer from this person (e.g. a new task title)?
    if (!botMentioned) {
      // A typed answer we asked for (blocker reason, task title...). Meeting notes in the group
      // must come as a photo / voice note, or text with @Delta or "meeting notes:", so normal
      // chat right after "@Delta meeting" is never taken as notes.
      const waiting = c.isTeamGroup && c.member ? await this.peekAwait(c) : null;
      if (waiting && waiting.type !== 'meeting') return this.onAwaited(c, msg.text);
      if (waiting?.type === 'meeting' && MEETING_INLINE.test(msg.text.trim())) return this.processMeeting(c, { text: MEETING_INLINE.exec(msg.text.trim())[1] });
      // Someone not linked yet typed "I am ..." here: point them to the 1:1 chat (a free reply).
      if (!c.member && (c.isTeamGroup || !c.teamGroupSet) && command(msg.text)?.cmd === 'link') return this.linkHere(c);
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

    if (cmd?.cmd === 'link' && (c.isTeamGroup || !c.teamGroupSet)) return this.linkHere(c);
    if (!c.isTeamGroup) {
      if (cmd?.cmd === 'register_group') return this.registerGroup(c);
      if (!c.teamGroupSet) return this.reply(c, F.textMsg(`No team group yet. The admin types "@${this.name} use this group" in the team group.`));
      return; // another group: stay quiet
    }
    if (!c.member) return this.reply(c, F.textMsg(`We haven't met yet 🙂 Open a 1:1 chat with ${this.name} and send "I am <nickname>" first.`));

    if (cmd) return this.onCommand(c, cmd);
    const notes = MEETING_INLINE.exec(text);
    if (notes) return this.processMeeting(c, { text: notes[1] });
    // "@Delta <notes>" right after "@Delta meeting" from the same person = the meeting notes
    if ((await this.peekAwait(c))?.type === 'meeting') {
      await this.db.kvDel('await:' + c.uid);
      return this.processMeeting(c, { text });
    }

    const mentioned = [...new Set(Object.values(nickByUid))];
    return this.withAi(c, text, { mentioned });
  }

  linkHere(c) {
    return this.reply(c, F.textMsg(c.member
      ? `You're already linked, ${c.member.nickname} 🙂`
      : `Link your account in a 1:1 chat 🙂 Tap ${this.name}'s name > Chat, then send "I am <nickname>" there.`));
  }

  async registerGroup(c) {
    if (!c.member) {
      return this.reply(c, F.textMsg(`We haven't met yet 🙂 Admin: open a 1:1 chat with ${this.name}, send "I am <nickname>", then type "@${this.name} use this group" here again.`));
    }
    if (!c.member.admin) {
      return this.reply(c, F.textMsg(`Only a linked team admin can do this (role = admin in the Members tab).`));
    }
    // Only one team group, and it can't be moved from another group by chat.
    if (c.teamGroupSet && !c.isTeamGroup) {
      return this.reply(c, F.textMsg('There is already a team group. To move it, the admin deletes the team_group row in the Kv tab of the Sheet, then types this again in the new group.'));
    }
    await this.db.kvSet('team_group', c.groupId);
    await this.db.log(c.member.nickname, c.groupId, 'register_group');
    c.isTeamGroup = true;
    return this.reply(c, F.infoMessage({
      banner: 'welcome', title: 'This is now the team group ✓', sub: `I only answer when you call @${this.name}; normal chat is ignored`,
      lines: [`Everyone: open a 1:1 chat with ${this.name} and send "I am <nickname>" once.`],
      buttons: [F.say('Team', `@${this.name} team`), F.say('Help', `@${this.name} help`)],
    }));
  }

  // ======================================================================
  // 1:1
  async onDirectText(c) {
    const text = c.event.message.text;
    const cmd = command(text);
    if (cmd?.cmd === 'link') return this.link(c, cmd.name);
    if (!c.member) return this.reply(c, F.textMsg('We haven\'t met yet 🙂 Send "I am <your team nickname>" first (δelta Edu. team and tutors only).'));

    if (await this.peekAwait(c)) {
      if (!cmd) return this.onAwaited(c, text);
      await this.db.kvDel('await:' + c.uid);
    }
    if (cmd) return this.onCommand(c, cmd);

    // "new task: ..." (from the menu bar's New task button) always means a new task,
    // never an update, even if it contains words like done or postpone.
    const notes = MEETING_INLINE.exec(text.trim());
    if (notes) return this.processMeeting(c, { text: notes[1] });

    const fresh = NEW_TASK.exec(text.trim());
    if (fresh) {
      const rest = text.trim().slice(fresh[0].length).trim();
      if (!rest) return this.reply(c, F.textMsg('What is the task, who does it, and when is it due? e.g. "new task: IGCSE worksheet by Thursday"'));
      return this.withAi(c, `Create a new task: ${rest}`, {});
    }

    // "slides done" / "push to monday" / "blocked, waiting for Best" without AI when clear.
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
    if (c.chat !== 'direct') return this.reply(c, F.textMsg('Link your account in a 1:1 chat with me.'));
    // Team only: the bot is a public LINE account, so knowing a nickname is not enough.
    // Before the team group exists only an admin can link (to set the group up);
    // after that, only people who are in the team group.
    const group = await this.db.kvGet('team_group', '');
    if (group) {
      const inGroup = await this.line.isGroupMember(group, c.uid);
      if (inGroup === null) return this.reply(c, F.textMsg("I can't check with LINE right now. Try again in a minute."));
      if (!inGroup) return this.reply(c, F.textMsg('Only people in the δelta Edu. team group can use me. Ask a teammate to add you to the group, then send "I am <nickname>" again.'));
    } else {
      const m = await this.team.memberByName(name);
      if (m && !m.admin) return this.reply(c, F.textMsg(`The team group isn't set up yet. The admin links first and types "@${this.name} use this group" in the group; then send "I am ${m.nickname}" again.`));
    }
    const r = await this.team.link(name, c.uid);
    if (!r.ok && r.reason === 'unknown') return this.reply(c, F.textMsg(`I can't find "${name}" on the team list. Try your team nickname, or ask the admin to add you in the Members tab.`));
    if (!r.ok && r.reason === 'taken') return this.reply(c, F.textMsg(`${r.member.nickname} is already linked to another LINE account. New phone or account? The admin clears line_user_id in the Members tab first.`));
    await this.db.log(r.member.nickname, 'direct', 'link');
    return this.reply(c, [
      F.infoMessage({
        banner: 'welcome', title: 'Linked ✓', sub: `Hi ${r.member.nickname} 👋`, alt: `Linked. Hi ${r.member.nickname} 👋`,
        lines: ['Your tasks and classes will be sent to this chat (at most once a day).'],
        buttons: [F.say('My tasks', 'my tasks'), F.say('Today', 'today')],
      }),
      F.helpMessage('direct', this.name),
    ]);
  }

  // ======================================================================
  async onCommand(c, cmd) {
    const today = this.today();
    switch (cmd.cmd) {
      case 'mine': {
        const mine = await this.team.openTasksOf(c.member.nickname);
        return this.reply(c, F.taskListMessage(mine, today, { alt: `${c.member.nickname}'s tasks` }));
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
        return c.chat === 'group' ? this.registerGroup(c) : this.reply(c, F.textMsg('Type this in the team group.'));
      case 'link':
        return this.link(c, cmd.name);
      case 'board':
        return this.reply(c, this.boardCard());
      case 'classes':
        return this.reply(c, await this.classesCard(c, cmd.mine));
      case 'decisions': {
        const docs = await this.boardDocs();
        return this.reply(c, F.decisionsMessage(decisionLists(docs), today, { boardUri: this.boardUri() }));
      }
      case 'pay':
        return this.reply(c, await this.payCard(c, cmd));
      case 'meeting':
        await this.db.kvSet('await:' + c.uid, { type: 'meeting', chat: c.chatId, at: Date.now() });
        return this.reply(c, F.infoMessage({
          title: 'Send the meeting notes 📝', sub: 'Within 30 minutes · from you only',
          alt: 'Send the meeting notes',
          steps: [
            { text: c.chat === 'group' ? `Type @${this.name} then a short summary: what you discussed, who does what` : 'Type a short summary: what you discussed, who does what' },
            { text: 'Or record a voice note (hold the mic) telling the summary' },
            { text: 'Or send a photo of the whiteboard / notebook' },
          ],
          lines: [`${this.name} splits it into decisions · action items · open questions, for you to confirm before saving.`],
        }));
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
      greeting: `${member.nickname}'s day`,
      today,
      sections: [
        { label: '🔴 Overdue', tasks: overdue, color: '#C8462F' },
        { label: '📌 Due today', tasks: dueToday },
        { label: '⏰ Due soon (7 days)', tasks: soon },
        { label: '🚧 Blocked', tasks: blocked },
        { label: 'Other tasks', tasks: rest },
      ],
      actionable: [...overdue, ...dueToday, ...soon].slice(0, 10),
    });
  }

  // ======================================================================
  // AI path (only for free-form text)
  async withAi(c, text, { mentioned = [] }) {
    c.slow = true; // if the AI is slow and LINE's reply window closes, send the answer as one push
    if (c.chat === 'direct') this.line.showLoading(c.uid).catch(() => {});
    const today = this.today();
    const [members, tasks, milestones, streams, knowledge] = await Promise.all([
      this.team.members(), this.team.tasks(), this.team.milestones(), this.team.streams(),
      this.knowledge().catch((err) => { console.warn('knowledge failed', err?.message || err); return ''; }),
    ]);
    const myTasks = c.chat === 'direct' ? tasks.filter((x) => x.status !== 'done' && ownersOf(x).includes(c.member.nickname)).sort(byDue) : null;
    let out;
    try {
      out = await understand(this.ai, {
        botName: this.name, chat: c.chat, text,
        ctx: { today, sender: c.member.nickname, members, mentioned, streams, tasks, milestones, myTasks, knowledge },
      });
    } catch (err) {
      if (err instanceof AiResting || err instanceof AiOff) {
        return this.reply(c, F.infoMessage({
          tone: 'warn', title: err instanceof AiOff ? 'AI is not set up' : 'AI is resting 😴', lines: [this.ai.restingText(err)],
          alt: this.ai.restingText(err),
          buttons: [F.say('My tasks', this.cmd(c, 'my tasks')), F.say('Team', this.cmd(c, 'team'))],
        }));
      }
      console.error('ai failed', err?.message || err);
      return this.reply(c, F.textMsg("Sorry, I couldn't read that. Try again, or use \"my tasks\" / \"team\"."));
    }
    await this.db.log(c.member.nickname, c.chat, 'ai:' + out.intent, text);

    switch (out.intent) {
      case 'create_tasks':
        if (out.tasks.length) return this.startDraft(c, out.tasks, { text, mentioned, members, streams, clarify: out.clarify });
        return this.reply(c, F.textMsg(out.clarify || 'What is the task, who does it, and when is it due?'));
      case 'team_status':
        return this.reply(c, F.teamMessage({ members, tasks, today }));
      case 'my_tasks':
        return this.reply(c, F.taskListMessage(myTasks || tasks.filter((x) => x.status !== 'done' && ownersOf(x).includes(c.member.nickname)).sort(byDue), today));
      case 'brief':
        return this.reply(c, await this.brief(c.member));
      case 'update_task':
        return this.onAiUpdate(c, out, myTasks || tasks.filter((x) => x.status !== 'done' && ownersOf(x).includes(c.member.nickname)));
      default:
        return this.reply(c, F.textMsg(out.answer || out.clarify || "There's nothing about this in the team data yet."));
    }
  }

  async onAiUpdate(c, out, mine) {
    const u = out.update || {};
    const task = mine.find((x) => x.id === u.task_id);
    const action = { done: 'done', postpone: 'postpone', blocked: 'blocked', unblock: 'unblock', start: 'start' }[u.action];
    if (!action) return this.reply(c, F.textMsg(out.clarify || out.answer || 'Which task, and what should I do with it?'));
    if (!task) {
      if (!mine.length) return this.reply(c, F.textMsg("You don't have any open tasks."));
      return this.askWhichTask(c, mine.slice(0, 12), action, u.date_text || u.reason || '');
    }
    return this.applyUpdate(c, task, action, { text: u.date_text || u.reason, aiDate: u.date, reason: u.reason });
  }

  // ======================================================================
  // Drafts: AI suggestion -> card -> someone confirms -> saved
  async startDraft(c, aiTasks, { text, mentioned, members, streams, clarify, before = [] }) {
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

      const stream = normBrand(a.stream) || streams.find((s) => normName(s) === normName(a.stream)) || DEFAULT_BRAND;
      const task = { title: String(a.title || '').trim().slice(0, 120), owners, due, stream, priority: a.priority || 'med' };
      if (!task.title) continue;
      draft.tasks.push(task);
      if (dueOptions) questions.push({ kind: 'date', i: draft.tasks.length - 1, word: parsed.word, options: dueOptions });
    }
    if (!draft.tasks.length) return this.reply(c, F.textMsg(clarify || "I'm not sure what the task is. Could you type it again?"));
    await this.db.kvSet('draft:' + draft.id, draft);

    const msgs = [F.draftMessage(draft, today)];
    if (unknown.length) msgs.push(F.textMsg(`${[...new Set(unknown)].join(', ')} ${new Set(unknown).size > 1 ? 'are' : 'is'} not on the team list. Tap "Who" to pick from the list.`));
    const q = questions[0];
    if (q) {
      msgs.push(F.textMsg(`Which day is "${q.word}"?`, F.quickReply([
        ...q.options.map((o) => F.postback(o.label, `a=dsd&d=${draft.id}&i=${q.i}&v=${o.date}`, o.label)),
        F.datePicker('Pick a date', `a=ddt&d=${draft.id}&i=${q.i}`, { min: today }),
      ])));
    } else {
      const noOwner = draft.tasks.findIndex((x) => !x.owners.length);
      const noDue = draft.tasks.findIndex((x) => !x.due);
      if (noOwner >= 0) msgs.push(this.ownerPicker(draft, noOwner, members, `Who does "${draft.tasks[noOwner].title}"?`));
      else if (noDue >= 0) {
        msgs.push(F.textMsg(`When is "${draft.tasks[noDue].title}" due?`, F.quickReply([
          F.datePicker('Pick due date', `a=ddt&d=${draft.id}&i=${noDue}`, { min: today }),
          F.postback('No due date', `a=dnd&d=${draft.id}&i=${noDue}`, 'No due date'),
        ])));
      }
    }
    return this.reply(c, [...before, ...msgs]);
  }

  ownerPicker(draft, i, members, prompt) {
    const cur = draft.tasks[i].owners;
    return F.textMsg(prompt || `Who does "${draft.tasks[i].title}"? (tap one or more)`, F.quickReply(
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
    if (missing >= 0) return this.reply(c, this.ownerPicker(draft, missing, await this.team.members(), `Nobody is on "${draft.tasks[missing].title}" yet. Pick someone first.`));
    const noDue = draft.tasks.findIndex((x) => !x.due && !x.noDue);
    if (noDue >= 0) {
      return this.reply(c, F.textMsg(`When is "${draft.tasks[noDue].title}" due?`, F.quickReply([
        F.datePicker('Pick due date', `a=ddt&d=${draft.id}&i=${noDue}`, { min: this.today() }),
        F.postback('No due date', `a=dnd&d=${draft.id}&i=${noDue}`, 'No due date'),
      ])));
    }
    await this.db.kvDel('draft:' + draft.id);
    const created = await this.team.createTasks(draft.tasks, c.member.nickname);
    await this.db.log(c.member.nickname, c.chat, 'create_tasks', created.map((x) => x.title).join(' | '));
    await this.reply(c, F.createdMessage(created, this.today(), c.member.nickname));
    await this.notifyAssigned(created, c.member.nickname).catch((err) => console.warn('assign DM failed', err?.message || err));
  }

  /** Private "new task for you" DM, unless that person already got a push today (then tomorrow's digest has it). */
  async notifyAssigned(tasks, by, { only = null } = {}) {
    const today = this.today();
    const members = await this.team.members();
    for (const m of members) {
      if (!m.line_user_id || m.nickname === by) continue;
      if (only && !only.includes(m.nickname)) continue;
      const mine = tasks.filter((x) => ownersOf(x).includes(m.nickname));
      if (!mine.length) continue;
      if ((await this.db.kvGet('lastpush:' + m.nickname, '')) === today) continue;
      const sent = await this.line.push(m.line_user_id, [
        F.textMsg(`${by} gave you ${mine.length === 1 ? 'a new task' : `${mine.length} new tasks`}`),
        ...F.taskListMessage(mine, today, { alt: 'New task' }).slice(0, 1),
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
    if (!await this.canEdit(c, task)) return this.reply(c, F.textMsg("This isn't your task. The owner or an admin can update it."));
    const today = this.today();
    switch (action) {
      case 'done': return this.markDone(c, task);
      case 'start':
        await this.team.updateTask(task.id, { status: 'doing' });
        return this.reply(c, F.resultMessage({
          kind: 'start', task: { ...task, status: 'doing' }, today, note: 'You got this 💪',
          buttons: [F.postback('Done ✓', `a=td&t=${task.id}`, `${task.title} done`)],
        }));
      case 'unblock':
        await this.team.updateTask(task.id, { status: 'doing', blocker: '' });
        return this.reply(c, F.resultMessage({
          kind: 'unblock', task: { ...task, status: 'doing', blocker: '' }, today,
          buttons: [F.postback('Done ✓', `a=td&t=${task.id}`, `${task.title} done`)],
        }));
      case 'postpone': {
        const p = parseThaiDate(text, today);
        if (p?.date) return this.postpone(c, task, p.date);
        if (p?.ambiguous) {
          return this.reply(c, F.textMsg(`Which day is "${p.word}"?`, F.quickReply([
            ...p.options.map((o) => F.postback(o.label, `a=tps&t=${task.id}&v=${o.date}`, o.label)),
            F.datePicker('Pick a date', `a=tp&t=${task.id}`, { min: today }),
          ])));
        }
        if (isDayKey(aiDate) && aiDate >= today && text) return this.postpone(c, task, aiDate);
        return this.reply(c, F.textMsg(`Move "${task.title}" to which day?`, F.quickReply([
          F.datePicker('Pick a date', `a=tp&t=${task.id}`, { initial: task.due && task.due > today ? task.due : today, min: today }),
        ])));
      }
      case 'blocked': {
        const why = (reason || (detectUpdate(text) === 'blocked' ? text : '')).trim();
        if (why) return this.markBlocked(c, task, why);
        return this.askBlocker(c, task);
      }
      default:
        return this.reply(c, F.textMsg("I'm not sure what to do. Try the buttons on the task card."));
    }
  }

  async askWhichTask(c, tasks, action, text) {
    const label = { done: 'is done', postpone: 'should move', blocked: 'is blocked', unblock: 'is unblocked', start: 'did you start' }[action] || action;
    await this.db.kvSet('pendingtext:' + c.uid, { text, at: Date.now() });
    return this.reply(c, F.textMsg(`Which task ${label}?`, F.quickReply(
      tasks.slice(0, 12).map((x) => F.postback(x.title.slice(0, 20), `a=pick&t=${x.id}&x=${action}`, x.title)),
    )));
  }

  async markDone(c, task) {
    if (task.status === 'done') return this.reply(c, F.resultMessage({ kind: 'already', task, today: this.today() }));
    await this.team.updateTask(task.id, { status: 'done' });
    await this.db.log(c.member.nickname, c.chat, 'done', task.title);
    const line = `✓ ${ownersOf(task).join(', ')} · ${task.title}`;
    const doneTask = { ...task, status: 'done' };
    if (c.chat === 'group') {
      return this.reply(c, F.resultMessage({ kind: 'done', task: doneTask, today: this.today(), headline: `${ownersOf(task).join(', ')} finished this 🎉` }));
    }
    await this.queueNotice(line);
    return this.reply(c, F.resultMessage({
      kind: 'done', task: doneTask, today: this.today(), headline: 'Nice work! 🎉', note: 'The group will see it as a ✓', noteColor: '#5F6B5B',
      buttons: [F.say('My tasks', 'my tasks')],
    }));
  }

  async postpone(c, task, date) {
    const today = this.today();
    if (date < today) return this.reply(c, F.textMsg('That day has passed. Pick another one.'));
    await this.team.updateTask(task.id, { due: date, status: task.status === 'blocked' ? 'blocked' : task.status });
    await this.db.log(c.member.nickname, c.chat, 'postpone', `${task.title} -> ${date}`);
    return this.reply(c, F.resultMessage({
      kind: 'postpone', task: { ...task, due: date }, today,
      note: task.due ? `was ${formatDay(task.due, today)}` : undefined, noteColor: '#5F6B5B',
      buttons: [
        F.datePicker('Move again', `a=tp&t=${task.id}`, { initial: date, min: today }),
        F.say('My tasks', this.cmd(c, 'my tasks')),
      ],
    }));
  }

  async askBlocker(c, task) {
    await this.db.kvSet('await:' + c.uid, { type: 'blocker', taskId: task.id, chat: c.chatId, at: Date.now() });
    return this.reply(c, F.textMsg(`What's blocking "${task.title}"? Type a few words.`, F.quickReply([
      F.postback('Waiting for a reply', `a=tbr&t=${task.id}&r=${encodeURIComponent('Waiting for a reply')}`, 'Waiting for a reply'),
      F.postback('Need a decision', `a=tbr&t=${task.id}&r=${encodeURIComponent('Needs a partner decision')}`, 'Needs a partner decision'),
      F.postback('No time', `a=tbr&t=${task.id}&r=${encodeURIComponent('No time, need help')}`, 'No time, need help'),
    ])));
  }

  async markBlocked(c, task, reason) {
    await this.team.updateTask(task.id, { status: 'blocked', blocker: reason.slice(0, 200) });
    await this.db.log(c.member.nickname, c.chat, 'blocked', `${task.title}: ${reason}`);
    const today = this.today();
    const blocked = { ...task, status: 'blocked', blocker: reason };
    const groupCard = this.blockedCard(blocked, reason);
    if (c.chat === 'group') return this.reply(c, groupCard);
    await this.reply(c, F.resultMessage({
      kind: 'blocked', task: blocked, today, headline: "Saved · I'll ask the group who can help", note: reason,
      buttons: [F.postback('Unblocked', `a=tu&t=${task.id}`, 'Unblocked')],
    }));
    const group = await this.db.kvGet('team_group', '');
    if (group) await this.line.push(group, groupCard, { essential: true, kind: 'blocked' });
  }

  // ======================================================================
  // Meeting notes: text, voice note or whiteboard photo -> decisions + action items
  /** An image or voice note: meeting notes when the sender asked for it ("meeting" first). */
  async onMedia(c, kind) {
    if (!c.member) return c.chat === 'direct' ? this.reply(c, F.textMsg('We haven\'t met yet 🙂 Send "I am <your team nickname>" first.')) : undefined;
    if (c.chat === 'group' && !c.isTeamGroup) return;
    const a = await this.peekAwait(c);
    if (a?.type === 'meeting') {
      await this.db.kvDel('await:' + c.uid);
      return this.processMeeting(c, { media: kind });
    }
    if (c.chat === 'group') return; // photos and voice in the group are just chat
    return this.reply(c, F.textMsg(`If these are meeting notes, type "meeting" first, then send this ${kind === 'audio' ? 'voice note' : 'photo'} again 📝`, F.quickReply([F.say('Meeting', 'meeting')])));
  }

  async processMeeting(c, { text = '', media = null }) {
    if (!this.store) return this.reply(c, F.textMsg("I can't save meetings yet (the board isn't ready)."));
    c.slow = true; // reading a voice note can take a while
    if (c.chat === 'direct') this.line.showLoading(c.uid, 60).catch(() => {});
    const today = this.today();
    const members = await this.team.members();
    let out;
    try {
      const parts = [];
      if (media) {
        const buf = await this.line.content(c.event.message.id);
        if (media === 'audio' && buf.length > MAX_AUDIO_BYTES) return this.reply(c, F.textMsg('That voice note is too long. Record it in shorter parts (up to ~10 minutes).'));
        parts.push(await forAi(media, buf));
      }
      out = await readMeeting(this.ai, { botName: this.name, text, media: parts, ctx: { today, members, sender: c.member.nickname } });
    } catch (err) {
      if (err instanceof AiResting || err instanceof AiOff) return this.reply(c, F.infoMessage({ tone: 'warn', title: 'AI is resting 😴', lines: [this.ai.restingText(err)], alt: this.ai.restingText(err) }));
      console.error('meeting failed', err?.message || err);
      return this.reply(c, F.textMsg(`I couldn't read the meeting notes. Send them again, or type "meeting notes: …" as text.`));
    }
    if (!out.isMeeting) return this.reply(c, F.textMsg("That doesn't look like meeting notes. If it is, type a short summary: what you discussed, who does what."));
    const nick = (raw) => {
      const n = normName(raw);
      return members.find((x) => normName(x.nickname) === n || x.aliases.some((al) => normName(al) === n))?.nickname || String(raw).trim();
    };
    // The meeting already happened: a weekday means the latest one up to today.
    const said = out.dateText ? (normalizeDate(out.dateText) || parseThaiDate(out.dateText, addDays(today, -6))?.date || '') : '';
    const m = {
      id: newId(), chat: c.chatId, by: c.member.nickname, created: Date.now(),
      title: out.title || 'Team meeting', date: said && said <= today ? said : today,
      attendees: [...new Set(out.attendees.map(nick))], summary: out.summary,
      decisions: out.decisions.slice(0, 15), questions: out.questions.slice(0, 10),
      actions: out.actions.slice(0, 10).map((a) => {
        const p = parseThaiDate(String(a.due_text || ''), today);
        const due = p?.date || (a.due_text && isDayKey(a.due_date) && a.due_date >= today ? a.due_date : '');
        return { title: String(a.title).trim().slice(0, 120), owners: [...new Set((a.owners || []).map(nick))], due };
      }),
    };
    await this.db.kvSet('meeting:' + m.id, m);
    await this.db.log(c.member.nickname, c.chat, 'meeting_read', `${m.title} (${media || 'text'})`);
    const card = F.meetingMessage(m, today);
    if (!out.actions.length) return this.reply(c, card);
    // Action items become task cards to confirm, with the usual questions about people and dates.
    return this.startDraft(c, out.actions.slice(0, 5).map((a) => ({ title: a.title, owners: a.owners, due_text: a.due_text, due_date: a.due_date, stream: '', priority: 'med' })), {
      text: '', mentioned: [], members, streams: await this.team.streams(), clarify: '', before: [card],
    });
  }

  async finishMeeting(c, id, save) {
    const m = id ? await this.db.kvGet('meeting:' + id, null) : null;
    if (!m || Date.now() - (m.created || 0) > MEETING_TTL_MS) return this.reply(c, F.textMsg('This meeting card was already saved or cancelled, or it expired (24 h).'));
    await this.db.kvDel('meeting:' + id);
    if (!save) return this.reply(c, F.textMsg('Meeting summary cancelled.'));
    const stamp = new Date().toISOString();
    await this.store.write({
      op: 'set', path: `meetings/${m.id}`, data: {
        date: m.date, title: m.title, attendees: m.attendees.join(', '),
        notes: [m.summary, ...(m.questions.length ? ['Open questions:', ...m.questions.map((q) => '- ' + q)] : [])].filter(Boolean).join('\n'),
        decisions: m.decisions.join('\n'),
        actions: m.actions.map((a) => `${a.owners.join(', ') || '?'}: ${a.title}${a.due ? ` (${a.due})` : ''}`).join('\n'),
        source: 'line', created: stamp, updated: stamp,
      },
    }, { by: c.member.nickname });
    // Each decision also lands on the Decisions page as agreed.
    for (const [i, d] of m.decisions.entries()) {
      await this.store.write({
        op: 'set', path: `decisions/${m.id}-${i}`,
        data: { title: d.slice(0, 160), area: 'Meeting', status: 'agreed', outcome: `${m.title} · ${m.date}`, owner: '', due: '', source: 'line', created: stamp, updated: stamp },
      }, { by: c.member.nickname });
    }
    await this.db.log(c.member.nickname, c.chat, 'meeting_saved', m.title);
    const liffId = this.cfg.board?.liffId;
    return this.reply(c, [
      F.meetingMessage(m, this.today(), { saved: true }),
      liffId ? F.textMsg('See it on the board: Meetings and Decisions pages.', F.quickReply([{ type: 'uri', label: 'Open board', uri: `https://liff.line.me/${liffId}` }])) : null,
    ]);
  }

  // ======================================================================
  // Classes, decisions and tutor pay (board documents; no AI, no pushes)
  async boardDocs() {
    if (!this.store) return {};
    return (await this.store.snapshot()).docs;
  }
  boardUri() { return this.cfg.board?.liffId ? `https://liff.line.me/${this.cfg.board.liffId}` : ''; }

  /** "classes": the team's next 7 days; "my classes": only the sender's, next 14 days. */
  async classesCard(c, mine) {
    const today = this.today();
    const docs = await this.boardDocs();
    if (mine) {
      const list = upcomingClasses(docs, today, 14, { tutor: c.member.nickname });
      return F.classesMessage(list, today, { title: `${c.member.nickname}'s classes · 14 days`, empty: 'You have no classes in the next 14 days', boardUri: this.boardUri() });
    }
    return F.classesMessage(upcomingClasses(docs, today, 7), today, { boardUri: this.boardUri() });
  }

  /**
   * "pay 10 students 10h 300": the tutor share by the ladder on the board. Private
   * money talk, so only in the 1:1 chat. Never guesses a missing number.
   */
  async payCard(c, { students, hours, price }) {
    if (c.chat === 'group') return F.textMsg('Pay is private: ask me in our 1:1 chat, e.g. "pay 10 students 10h 300".');
    const bands = ladderBands((await this.boardDocs())['settings/pay']);
    if (!bands.length) return F.textMsg('No pay ladder yet. Add the bands your partners agreed on the board (Classes page > Pay ladder), then ask again.');
    const missing = [students == null && 'number of students', hours == null && 'hours', price == null && 'price per student-hour (THB)'].filter(Boolean);
    if (missing.length) return F.textMsg(`I need the ${missing.join(', ')}. e.g. "pay 10 students 10h 300" (students, hours, THB per student-hour).`);
    return F.payMessage({ students, hours, price, result: payout(bands, { students, hours, price }), fmt: thb });
  }

  /** Card with a button that opens the web board inside LINE (LIFF). */
  boardCard() {
    const liffId = this.cfg.board?.liffId;
    if (!liffId) return F.textMsg("The web board isn't switched on yet (the admin sets up LIFF, see README).");
    return F.infoMessage({
      title: 'δelta Edu. board', sub: 'Tasks · Classes · Decisions · Meetings · Timeline', alt: 'Open the δelta Edu. board',
      lines: [`Same data as in LINE: changes on the board are announced here by ${this.name}.`],
      buttons: [{ type: 'uri', label: 'Open board', uri: `https://liff.line.me/${liffId}` }],
    });
  }

  blockedCard(task, reason) {
    return F.resultMessage({
      kind: 'blocked', task, today: this.today(), headline: `${ownersOf(task).join(', ')} ${ownersOf(task).length > 1 ? 'are' : 'is'} blocked · who can help? 🙋`, note: reason || undefined,
    });
  }

  // ======================================================================
  // Changes made on the web board: tell people in LINE the same way as chat changes.
  //   new owner      -> private "new task" DM (same once-a-day rule as chat)
  //   marked done    -> ✓ line for the group (rides on the next free reply / 18:00)
  //   marked blocked -> 🚧 card to the group right away
  async boardChanged({ path, before, after, member }) {
    if (!String(path).startsWith('tasks/') || !after) return;
    const task = await this.team.task(path.split('/')[1]);
    if (!task) return;
    const was = before ? ownersOf({ owner: /^unassigned$/i.test(before.owner || '') ? '' : before.owner }) : [];
    const added = ownersOf(task).filter((n) => !was.includes(n));
    await this.db.log(member.nickname, 'board', before ? 'board_update' : 'board_create', task.title);
    if (added.length && task.status !== 'done') await this.notifyAssigned([task], member.nickname, { only: added });
    if (task.status === 'done' && before?.status !== 'done') await this.queueNotice(`✓ ${ownersOf(task).join(', ')} · ${task.title}`);
    if (task.status === 'blocked' && before?.status !== 'blocked') {
      const group = await this.db.kvGet('team_group', '');
      if (group) await this.line.push(group, this.blockedCard(task, task.blocker), { essential: true, kind: 'blocked' });
    }
  }

  // ======================================================================
  // Typed answers we asked for (blocker reason, new title, brand)
  /** The typed answer we are waiting for from this person, only in the chat where we asked. */
  async peekAwait(c) {
    const a = await this.db.kvGet('await:' + c.uid, null);
    if (!a) return null;
    if (Date.now() - (a.at || 0) > AWAIT_TTL_MS) { await this.db.kvDel('await:' + c.uid); return null; }
    if (a.chat !== c.chatId) return null; // asked in another chat: leave it for there
    return a;
  }

  async onAwaited(c, text) {
    const a = await this.peekAwait(c);
    await this.db.kvDel('await:' + c.uid);
    const value = String(text).trim();
    if (!a || !value) return;
    if (a.type === 'meeting') return this.processMeeting(c, { text: value });
    if (a.type === 'blocker') {
      const task = await this.team.task(a.taskId);
      if (!task) return this.reply(c, F.textMsg("I can't find that task any more."));
      return this.markBlocked(c, task, value);
    }
    const draft = await this.loadDraft(a.draftId);
    if (!draft) return this.reply(c, F.textMsg('This task card expired or was already confirmed.'));
    const task = draft.tasks[a.i];
    if (!task) return;
    if (a.type === 'draft_title') task.title = value.slice(0, 120);
    if (a.type === 'draft_stream') task.stream = normBrand(value) || value.slice(0, 40);
    return this.saveDraftAndShow(c, draft);
  }

  // ======================================================================
  // Buttons
  async onPostback(c) {
    const p = new URLSearchParams(c.event.postback?.data || '');
    const params = c.event.postback?.params || {};
    const a = p.get('a');
    if (a === 'kbd') return; // menu bar "New task": it only opens the keyboard
    if (!c.member) return this.reply(c, F.textMsg(`We haven't met yet. Open a 1:1 chat with me and send "I am <nickname>" first.`));
    if (c.chat === 'group' && !c.isTeamGroup) return;

    // ---- meeting card buttons ----
    if (a === 'mok' || a === 'mx') return this.finishMeeting(c, p.get('m'), a === 'mok');

    // ---- draft buttons ----
    if (a?.startsWith('d') && p.get('d')) {
      const draft = await this.loadDraft(p.get('d'));
      if (!draft) return this.reply(c, F.textMsg('This card was already confirmed or cancelled, or it expired (24 h).'));
      const i = Number(p.get('i') || 0);
      const task = draft.tasks[i];
      const today = this.today();
      switch (a) {
        case 'dok': return this.confirmDraft(c, draft);
        case 'dx':
          await this.db.kvDel('draft:' + draft.id);
          return this.reply(c, F.textMsg('Cancelled.'));
        case 'ddt':
          if (!task || !isDayKey(params.date)) return;
          if (params.date < today) return this.reply(c, F.textMsg('That day has passed.'));
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
          return this.reply(c, [F.draftMessage(draft, today), this.ownerPicker(draft, i, await this.team.members(), `Now on it: ${task.owners.join(', ') || '-'} (tap to add / remove)`)]);
        }
        case 'dti':
          await this.db.kvSet('await:' + c.uid, { type: 'draft_title', draftId: draft.id, i, chat: c.chatId, at: Date.now() });
          return this.reply(c, F.textMsg('Type the new title.'));
        case 'dst':
          return this.reply(c, F.textMsg('Which brand?', F.quickReply([
            ...BRANDS.map((s) => F.postback({ Uni: 'Uni (δelta Edu.)', LITE: 'LITE', Both: 'Both' }[s], `a=dss&d=${draft.id}&i=${i}&v=${encodeURIComponent(s)}`, s)),
            F.postback('Type my own', `a=dsw&d=${draft.id}&i=${i}`),
          ])));
        case 'dss':
          if (!task) return;
          task.stream = decodeURIComponent(p.get('v') || DEFAULT_BRAND);
          return this.saveDraftAndShow(c, draft);
        case 'dsw':
          await this.db.kvSet('await:' + c.uid, { type: 'draft_stream', draftId: draft.id, i, chat: c.chatId, at: Date.now() });
          return this.reply(c, F.textMsg('Type the tag (e.g. Uni, LITE, Both).'));
        default: return;
      }
    }

    // ---- task buttons ----
    const task = p.get('t') ? await this.team.task(p.get('t')) : null;
    if (p.get('t') && !task) return this.reply(c, F.textMsg("I can't find this task any more (maybe deleted in the Sheet)."));
    switch (a) {
      case 'td': return this.applyUpdate(c, task, 'done');
      case 'tp':
        if (!isDayKey(params.date)) return;
        if (!await this.canEdit(c, task)) return this.reply(c, F.textMsg("This isn't your task."));
        return this.postpone(c, task, params.date);
      case 'tps':
        if (!isDayKey(p.get('v')) || !await this.canEdit(c, task)) return;
        return this.postpone(c, task, p.get('v'));
      case 'tb':
        if (!await this.canEdit(c, task)) return this.reply(c, F.textMsg("This isn't your task."));
        return this.askBlocker(c, task);
      case 'tbr':
        if (!await this.canEdit(c, task)) return;
        await this.db.kvDel('await:' + c.uid);
        return this.markBlocked(c, task, decodeURIComponent(p.get('r') || 'Blocked'));
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
