# Delta: the δelta Edu. team's LINE bot

One LINE bot ("Delta") that lives in the δelta Edu. team group and in each
member's 1:1 chat, plus a web board opened inside LINE. Everything is stored in
one private Google Sheet. The bot is the only program that writes to it, and it
checks every change first.

δelta Edu. is a tutoring institution with two brands: **δelta Edu.** (university:
foundations and Chemical Engineering, tag **Uni**) and **δelta Edu. LITE**
(international secondary: SAT, GED, IGCSE, A-Level, tag **LITE**). The bot is for
the partners, staff and tutors only. It speaks **English**: casual, short, and
cards with buttons rather than long text.

> Delta Edu was started as a copy of Norse, the older bot for another team.
> **Delta Edu never touches Norse.** It has its own folder (`~/delta-edu`), `.env`,
> Cloud Run service (`delta-edu-bot`), service account, scheduler job, LINE
> channel and Sheet. `scripts/setup.sh` stops if anything points at Norse.

## What it does

**Team group** (the AI only runs when someone types `@Delta`)

| Type | What happens |
| --- | --- |
| `@Delta Kiak and Pure: Thermo I slides by Friday, Uni` | A task card with owners, due date and brand tag, with **Confirm · Due date · Who · Title · Brand · Cancel**. Nothing is saved until someone taps Confirm. Unknown names and unclear dates ("next week") are asked about; the bot never guesses an owner or a date. |
| `@Delta team` | Done / doing / overdue / blocked tiles, who is on what, and the risk list. No AI. |
| `@Delta classes` | The team's classes for the next 7 days (from the board). No AI. |
| `@Delta decisions` | Open decisions first, then the latest agreed ones. No AI. |
| `@Delta meeting` | Then send meeting notes as text, a voice note or a whiteboard photo (see Meeting notes). |
| `@Delta hello` · `@Delta <question>` | Small talk gets a short reply. Questions about δelta Edu. are answered only from team data (tasks, classes, decisions, meetings, board notes, `knowledge/delta-edu.md`); if it isn't there, Delta says so. General questions get a short answer marked *(general knowledge, not team data)*. |
| `@Delta use this group` | (admin, once) makes this the team group. Other groups are ignored and can't take over (to move it, delete the `team_group` row in the Kv tab first). |
| `@Delta board` · `@Delta settings` · `@Delta help` | Board button · AI use and pushes this month · how to use. |

**1:1 chat**

| Type / tap | What happens |
| --- | --- |
| `I am Kiak` | Links your LINE account to your team nickname or alias (once). See **Team only**. |
| `my tasks` | Your open tasks by due date, each with **Done ✓ · Postpone (date picker) · Blocked**. |
| `slides done` · `push the worksheet to monday` · `blocked, waiting for Best` | Updated without AI when it's clear which task you mean; otherwise you get buttons to pick the task. "not done yet" goes to the AI instead of closing it. |
| `today` | Today / overdue / due soon / blocked. |
| `new task: IGCSE worksheet by Thu` | Always a new task card, never read as an update. |
| `my classes` | The classes you teach in the next 14 days. |
| `pay 10 students 10h 300` | Tutor pay by the ladder set on the board (see **Tutor pay**). 1:1 only. |

The old Thai words from Norse (`ฉันคือ`, `งานฉัน`, `ประชุม`…) still work, and Thai
dates are still understood, but every reply is English.

**Menu bar** (1:1 chat only; LINE doesn't show menus in groups):
**My tasks · Today · Team / New task · Classes · Help** (Help becomes **Board**
once the web board is set up). Each button sends the command, so a tap costs no
push and no AI. **New task** opens the keyboard with `new task: ` typed in.

**Cards, not text**: lists and outcomes are cards in the δelta Edu. look (deep
green `#0B5C03`, light green, cream; LITE gold): green gradient headers with the
big number, KPI tiles with bars, brand tags (Uni green, LITE gold, Both blue),
stacked avatars. Buttons in group cards send `@Delta …` so the bot hears them.
Four **animated banners** (`brand/banner-*.png`, APNG) top the welcome/linked
cards, the 08:00 reminder, the done card and the weekly posts. LINE downloads them
from the bot (`/brand/…`), so the bot learns its public address from the first
request (or `PUBLIC_URL`). `setup.sh` asks LINE to validate every card
(`npm run validate-cards`, nothing is sent).

The group only sees results: a **✓ line** (sent with the bot's next group reply,
or in the 18:00 round-up) or the **🚧 blocked line** asking who can help.

**Reminders** (one Cloud Scheduler job, every hour from 07:00 to 21:00 Bangkok time)

- 08:00 private DM, **at most one push per person per day**: classes you teach
  today, new tasks, due in 5/3/1 days, due today (with buttons), overdue.
- A new task also sends a DM right away, unless that person already got a push that day.
- Overdue: DM first. After 2 days, one gentle `@tag` in the group, once per task.
- Monday 09:00 plan: due this week, milestones, **this week's classes**, feedback
  form line; Friday 17:00 done / late / blocked; 18:00 ✓ round-up.

**Saving AI quota**: commands and buttons never call the AI (classes, decisions,
pay, my tasks, team, today…). In the group the AI runs only on `@Delta`. Gemini
models are tried in order (`GEMINI_MODELS`); when all are used up, the bot says
when the AI is back, and commands and buttons keep working.

**Push budget**: LINE's Thai free plan allows 300 pushes a month, and a push to
a 4-person group counts as 4. Before every push the bot takes the higher of its
own count and LINE's, and the lower of `PUSH_MONTHLY_LIMIT` and LINE's quota:

- 🚧 blocked lines stop at 100%;
- digests, new-task DMs, the overdue tag and the weekly posts stop at 90%;
- the 18:00 ✓ round-up also waits when the month is ahead of pace; its ✓ lines
  ride on the next free group reply instead.

**Team only**: the bot is a public LINE account, so a nickname is not enough.
Before the team group exists, only an admin can link (`I am Jai`), so do that
right after deploying. After `@Delta use this group`, `I am …` only works for
people who are in the team group (LINE is asked each time). Each nickname links
to one LINE account. Phone numbers and emails never appear in the group and are
never sent to the AI.

## Classes, decisions and tutor pay

These live on the web board (documents in the Sheet's **Board** tab) and the bot
reads them; none of them uses the AI or extra pushes.

- **Classes** (board → Classes): date, time, course, brand, tutor, students,
  hours, status. `classes` / `my classes` in LINE; tutors see today's class in
  the 08:00 DM; the Monday post lists the week. Upcoming classes are also known
  to the AI ("@Delta when is the next Thermo I class?").
- **Decisions** (board → Decisions): open / agreed / dropped, area, owner,
  decide-by date, outcome. Saving meeting notes adds their decisions as agreed.
  `decisions` in LINE.
- **Tutor pay**: the partners' ladder is entered on the board (Classes → Pay
  ladder): bands like "students 1–3: tutor X%", "4–7: Y%", "13 and up: Z%". Each
  band's % applies only to the students inside it, like tax brackets. In the 1:1
  chat, `pay 10 students 10h 300` (students, hours, THB per student-hour) shows
  the split per band, the tutor total, the company share and the effective %.
  Missing numbers are asked for. The ladder is never in the code or the repo and
  is never sent to the AI. The board has the same calculator, per class or per course.

## The Sheet

The bot creates these tabs on first start (an empty Sheet is fine):

- **Members**: `nickname, aliases, role, line_user_id, …`. Put `admin` in *role*
  for admins (other roles like `founder` or `tutor` are just labels). *aliases*
  holds other spellings, comma-separated. On first start the tab is filled from
  `TEAM_SEED`, written `Nick/alias:role`, e.g. `Best:founder, Jai:admin, Kiak:tutor, Pure`.
  To re-link someone (new phone or account), clear their `line_user_id`.
- **Tasks**: `title, owner, stream (the brand tag: Uni / LITE / Both), status,
  priority, start, due, blocker, …`. You can edit rows by hand: keep `status` to
  todo / doing / blocked / done, and dates as `2026-11-20` or `20/11/2026`.
- **Milestones**: `title, date, stream, done`.
- **Board**: everything else the board keeps (classes, decisions, meetings, notes,
  pay ladder, feedback form settings), one row per item. Leave it alone.
- **Kv**, **Log**: the bot's own bookkeeping. Leave them alone.

## Setup

You need: a **new** LINE Official Account, a Google Cloud project with billing on
(Cloud Run needs billing but this stays in the free tier; the Norse project is
fine), a Gemini key from a separate project with **no** billing, and a **new**
Google Sheet.

1. **LINE**: create a LINE Official Account named `Delta Edu` at
   <https://manager.line.biz/> (free plan). In Official Account Manager:
   **Settings → Messaging API → Enable Messaging API**, with a new provider
   (e.g. `Delta Edu`). In <https://developers.line.biz/console/>, open that
   channel: **Channel secret** (Basic settings) and **Channel access token
   (long-lived)** (bottom of the Messaging API tab). `setup.sh` asks for them
   (input hidden). Never paste them in a chat.
2. **Gemini key**: <https://aistudio.google.com/apikey>, in a project without
   billing. Check **Rate limits** there and set `GEMINI_MODELS` to match.
3. **Sheet**: create an empty Google Sheet and copy its URL.
4. **Deploy** in <https://shell.cloud.google.com>:
   ```bash
   git clone <this repo> ~/delta-edu && cd ~/delta-edu
   SERVICE=delta-edu-bot ./scripts/setup.sh
   ```
   It asks for the values above (kept in `~/delta-edu/.env`, never committed),
   enables the APIs, creates the service account
   `delta-edu-bot@<project>.iam.gserviceaccount.com`, deploys to Cloud Run,
   creates the hourly job `delta-edu-bot-tick`, sets the webhook and the menu bar,
   and validates every card with LINE.
5. **Share the Sheet** with that service-account email as **Editor**. Then open
   `<URL>/health`: it should say `"ok":true`.
6. **LINE settings**: Developers console → **Use webhook** on, **Allow bot to
   join group chats** on. Official Account Manager → **auto-reply** and
   **greeting** messages off.
7. In this order: the admin adds the bot as a friend and sends `I am Jai`; adds
   the bot to the team group and types `@Delta use this group`; everyone else
   joins the group, adds the bot and sends `I am <nickname>`.

To update: `cd ~/delta-edu && git pull && SERVICE=delta-edu-bot ./scripts/setup.sh`.
Logs: `gcloud run services logs read delta-edu-bot --region asia-southeast1 --limit 80`.

## Web board (inside LINE)

Hosted by the same Cloud Run service at `/board`, on **the same Sheet** as the
bot. Pages: **Home** (KPIs, this week's classes, next milestone, open decisions),
**Tasks** (brand filter, kanban), **Classes** (schedule, tutor pay calculator,
pay ladder), **Decisions**, **Meetings**, **Timeline**, **Notes** (private team
notes the AI reads), **Feedback** (Google Form summary). English, phone first.

- A task made in LINE shows on the board within ~8 seconds; a task made or edited
  on the board gets the same LINE treatment (new owner DM, ✓ line, 🚧 card,
  reminders).
- Sign-in is LINE (a LIFF app). Only linked team members get in; the session is a
  signed cookie. The board gets a read-only member list (nickname, role) and never
  sees LINE user ids.

**Setting it up (once)**

1. LINE Developers console → the **Delta Edu** provider (the bot's provider, so
   user ids match) → **Create a new channel → LINE Login**, app type **Web app**,
   name `Delta Edu Board`.
2. **LIFF** tab → **Add**: size **Full**, endpoint `https://<service-url>/board`,
   scopes **openid** and **profile**, bot link feature **On (Normal)**.
3. **Publish** the channel (while *Developing*, only its admins can sign in).
4. Copy the **Channel ID** and the **LIFF ID**, re-run `setup.sh` and paste them.
   The menu bar's last button becomes **Board**.

`board/index.html` is a single file (no build step). `src/board/routes.js` puts
`board/client.js` (the `db`/`user` runtime backed by `/api/board/*`) before the
page's script and the wordmark (`brand/delta-logo.svg`) in the sidebar.

## Meeting notes

Type **`meeting`** (group: `@Delta meeting`), then within 30 minutes send the
notes as **text**, a **voice note** or a **photo of the whiteboard / notebook**;
or in one go: `meeting notes: …`. One AI call returns a **meeting card**
(summary, ✓ decisions, → action items, ? open questions; always in English) with
**Save to board / Cancel**. Action items come as the usual task cards. Saving puts
the meeting on the board's Meetings page and its decisions on the Decisions page.
Photos and voice notes are only read after `meeting`, and only from the person
who asked. Voice notes are converted with ffmpeg (in the Docker image).

## Feedback form (Google Form)

On the board's **Feedback** page, paste the link of the Sheet that collects the
Form's responses and share it with the service account as **Viewer**. The bot
reads it hourly and fills the page (charts per question). Columns with contact
details or names are skipped; written answers are scrubbed of phone numbers and
emails. The Monday post gets one line, and `@Delta sum up the feedback form`
answers from the same summary.

## What Delta knows

For questions, the AI gets the task list, milestones, **`knowledge/delta-edu.md`**
(public facts only: brands, courses, approach, team roles; edit and redeploy) and
from the board: team **Notes**, **Decisions**, **Meetings**, upcoming **Classes**
and the feedback summary (`src/knowledge.js`, up to ~9,000 characters). **This
repo is public**: private facts (equity, the pay ladder, prices not agreed yet,
open partner decisions, the roadmap) go on the board's Notes page, never in this
repo. Contacts are never sent; phone numbers and emails are masked.

## Brand files

Recreated from the institution deck: `brand/delta-logo.svg` (one-line wordmark,
`fill="currentColor"`), `brand/icon.svg`, and for LINE (upload by hand):

| File | Where |
| --- | --- |
| `brand/line-profile.png` (640×640) | Official Account Manager → Account settings → profile picture |
| `brand/line-cover.png` (1080×878) | Official Account Manager → Business profile → cover photo |
| `brand/icon-512.png` | LINE Login channel → Basic settings → App icon |
| `brand/line-profile-dark.png` | alternative profile picture |

`npm run brand:render`, `npm run banners:render` and `npm run rich-menu:render`
redraw them (need Playwright; shared shapes in `scripts/brand/slab.mjs`).

## When something is slow or silent

- Every AI call has a time limit (20 s per model, ~45 s in all); slow models are
  skipped for the next one in `GEMINI_MODELS`. Google Sheets calls give up after 20 s.
- An answer that arrives after LINE's reply window is sent as one push instead.
- Logs: see Setup.

## Develop

```bash
npm install
npm test          # 84 tests, no network
npm run preview   # cards.html: every card (real code, sample data) as LINE lays it out
```

Without `SHEET_ID` the bot uses an in-memory sheet (data is lost on restart).

## Code map

- `src/bot.js`: group and 1:1 handling, drafts, buttons, task updates, classes / decisions / pay commands
- `src/classes.js`: classes, decisions and the progressive pay ladder (pure helpers)
- `src/scheduler.js`: daily digest, overdue tag, weekly posts, evening round-up
- `src/flex.js`: cards in the δelta Edu. style; `scripts/cards/`: sample cards + a LINE-like preview
- `src/dates.js`: English and Thai dates ("next fri", "20 Nov", "ศุกร์หน้า"); ambiguous ones become questions; "SAT" is never Saturday
- `src/rules.js`: commands and update phrases that need no AI
- `src/ai/`: Gemini / Claude providers, model fallback, usage counter, prompts + JSON schemas (`brain.js`, `meeting.js`)
- `src/knowledge.js`, `knowledge/delta-edu.md`: what the AI knows for questions
- `src/research.js`: Google Form responses → the board's Feedback page
- `src/sheets.js`, `src/team.js`: the Sheet as a database; members, tasks, brand tags
- `src/line.js`: replies, counted pushes, @mentions
- `src/richmenu.js`, `scripts/rich-menu.js`, `scripts/rich-menu/`: the 1:1 menu bar
- `src/board/`: `store.js` (documents ↔ Sheet), `auth.js` (LINE Login, cookie), `routes.js`; `board/`: the page and `client.js`
- `src/app.js`: HTTP routes (`/webhook`, `/health`, `/cron/tick`); `src/index.js` wires it all up
- `scripts/setup.sh`: deploy (with the Norse guard)

## Ideas for later

- Enrollment pipeline per course (leads → paid), feeding class sizes and pay
- Student feedback form per course, summarised after each cohort
- Receipt photo → expense; tutor hours log per month
