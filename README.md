# Norse: the NORSE team's LINE bot

One LINE bot that lives in the team group and in each member's 1:1 chat.
Tasks live in a Google Sheet (any teammate can own it). The bot is the only
program that writes to it, and it checks every change first. Cards follow the
look of the NORSE Project Overview dashboard.

## What MVP 1 does

**Team group** (the AI only runs when someone types `@Norse`)

| Type | What happens |
| --- | --- |
| `@Norse บอนนี่ กับ เจ ทำ mockup กล่อง ส่งศุกร์` | A card with owners, due date and workstream, with **ยืนยัน · วันส่ง · คนทำ · ชื่องาน · หมวด · ยกเลิก**. Nothing is saved until someone taps ยืนยัน. Unknown names and unclear dates ("อาทิตย์หน้า") are asked about; the bot never guesses an owner or a date. |
| `@Norse งานทีม` | Done / in progress / overdue / blocked tiles, who is on what, and the risk list. No AI. |
| `@Norse <question>` | Answered from the Sheet only; says so when there is no record. |
| `@Norse ใช้กลุ่มนี้` | (admin, once) makes this the team group. Other groups are ignored, and can't take over the role (to move it, delete the `team_group` row in the Kv tab first). |
| `@Norse ตั้งค่า` | AI use per model today, reset time, LINE pushes used this month. |

**1:1 chat**

| Type / tap | What happens |
| --- | --- |
| `ฉันคือ บอนนี่` | Links your LINE account to your team nickname or alias (once). See **Team only** below. |
| `งานฉัน` | Your open tasks by due date, each with **เสร็จแล้ว ✓ · ขอเลื่อน (date picker) · ติดอยู่**. |
| `mockup เสร็จแล้ว` · `ขอเลื่อนเป็นจันทร์` · `ติด supplier ยังไม่ตอบ` | Updated without AI when it's clear which task you mean; otherwise you get buttons to pick the task. |
| `วันนี้ทำอะไรดี` | Today / overdue / due soon / blocked. |

**Cards, not text**: lists (งานฉัน, งานทีม, digest, weekly posts, ตั้งค่า) and
outcomes (linked, group set, done, postponed, started, blocked, the ✓ round-up,
AI resting, help, welcome) are cards in the dashboard's dark style: mint gradient
headers with the big number, KPI tiles with bars, a stacked status bar, workload
bars per person, workstream stripes and stacked avatars. Each has a button for the
next step; buttons in group cards send `@Norse …` so the bot hears them. Questions
that need a choice (which day, who) stay short text with tap buttons.

Four **animated banners** (`brand/banner-*.png`, APNG under LINE's 300 KB) top the
welcome/linked cards, the 08:00 reminder, the done card and the weekly posts. LINE
downloads them from the bot (`/brand/…`), so the bot needs its public address: it
takes it from the first request Cloud Run sends it (or `PUBLIC_URL`). Until then
cards show a gradient header instead. `setup.sh` asks LINE to validate every card
(`npm run validate-cards`, no messages sent).

**Menu bar** (1:1 chat only; LINE doesn't show menus in groups): **งานฉัน ·
วันนี้ทำอะไรดี · งานทีม / เพิ่มงาน · ตั้งค่า · วิธีใช้**. Each button sends the
command, so a tap costs no push and no AI. **เพิ่มงาน** opens the keyboard with
`งานใหม่: ` typed in; a message starting with `งานใหม่:` always makes a new
task card and is never read as an update.

The group only sees the result: a **✓ line** (sent with the bot's next group
reply, or in the 18:00 round-up) or the **🚧 blocked line** asking who can help.

**Reminders** (one Cloud Scheduler job, every hour on the hour from 07:00 to 21:00 Bangkok time)

- 08:00 private DM, **at most one push per person per day**: new tasks, due in 5/3/1 days, due today (with buttons), overdue.
- A new task also sends a DM right away, unless that person already got a push that day.
- Overdue: DM first. After 2 days, one gentle `@tag` in the group, once per task.
- Monday 09:00 plan and milestones; Friday 17:00 done / late / blocked; 18:00 ✓ round-up.

**Saving AI quota**: commands and buttons never call the AI. In the group the AI
runs only on `@Norse`. Gemini models are tried in order (`GEMINI_MODELS`); when
all are used up, the bot says when the AI is back, and commands and buttons
keep working.

**Push budget**: LINE's Thai free plan allows 300 pushes a month, and a push to
a 3-person group counts as 3. Before every push the bot takes the higher of its
own count and LINE's (LINE's also includes anything sent from OA Manager), and
the lower of `PUSH_MONTHLY_LIMIT` and LINE's own quota, so it never goes over:

- 🚧 blocked lines stop at 100%;
- digests, new-task DMs, the overdue tag and the weekly posts stop at 90%;
- the 18:00 ✓ round-up also waits when the month is ahead of pace (more than
  90% × day-of-month / days-in-month used). Its ✓ lines are kept and ride on
  the next free group reply instead.

**Team only**: the bot is a public LINE account, so a nickname alone is not
enough to get in. Before the team group exists, only an admin can link
(`ฉันคือ Jai`), so do that right after deploying. After `@Norse ใช้กลุ่มนี้`,
`ฉันคือ …` only works for people who are in the team group (LINE is asked
each time). Each nickname links to one LINE account.

## The Sheet

The bot creates these tabs on first start (an empty Sheet is fine):

- **Members**: `nickname, aliases, role, line_user_id, …`. Put `admin` in *role* for admins. *aliases* holds other spellings, comma-separated (e.g. `บอนนี่`); without them "@Norse บอนนี่ ทำ …" can't find Bonnie. On first start the tab is filled from `TEAM_SEED`, written `Nick/alias/alias:role`, e.g. `Jai/เจ:admin, Best/เบสท์, Bonnie/บอนนี่`. To re-link someone (new phone or account), clear their `line_user_id`. Contact columns are never shown in the group or sent to the AI.
- **Tasks**: same fields as the dashboard (`title, owner, stream, status, priority, start, due, blocker, …`). You can edit rows by hand: keep `status` to todo / doing / blocked / done, and dates as `2026-11-20` or `20/11/2026`.
- **Milestones**: `title, date, stream, done`.
- **Kv**, **Log**: the bot's own bookkeeping. Leave them alone.

## Setup (about 20 minutes)

You need: a LINE Official Account, a Google Cloud project with billing turned
on (Cloud Run requires billing, but this stays inside the free tier), a Gemini
key, and the Sheet.

1. **LINE**: Messaging API channels are no longer created in the Developers console. First create a **LINE Official Account** named `Norse` at <https://manager.line.biz/> (free plan). Then, in Official Account Manager, go to **Settings → Messaging API → Enable Messaging API** and create a provider (e.g. `NORSE`). In <https://developers.line.biz/console/>, open that channel: the **Channel secret** is under *Basic settings*, and the **Channel access token (long-lived)** is issued at the bottom of the *Messaging API* tab. Keep both on your own computer; `setup.sh` asks for them (input is hidden).
2. **Gemini key**: <https://aistudio.google.com/apikey>. Check **Rate limits** there for the current free models, and set `GEMINI_MODELS` to match.
3. **Sheet**: your friend creates an empty Google Sheet and copies its URL.
4. **Deploy**: open <https://shell.cloud.google.com> on *your* Google account, then:
   ```bash
   git clone <this repo> norse-bot && cd norse-bot
   ./scripts/setup.sh
   ```
   The script asks for the values above, enables the APIs, creates the service account `norse-bot@<project>.iam.gserviceaccount.com`, deploys to Cloud Run, creates the hourly job and sets the LINE webhook.
5. **Share the Sheet**: the Sheet's owner shares it with that service-account email as **Editor** (untick *Notify people*). Then open `<URL>/health`: it should say `"ok":true`. (Cloud Run reserves paths ending in `z`, so it is not `/healthz`.)
6. **LINE settings**:
   - Developers console: turn on **Use webhook** and **Allow bot to join group chats**.
   - Official Account Manager: turn off **auto-reply** and **greeting** messages.
7. In this order: the admin adds the bot as a friend and sends `ฉันคือ <ชื่อเล่น>`; adds the bot to the team group and types `@Norse ใช้กลุ่มนี้`; then everyone else adds the bot as a friend and sends `ฉันคือ <ชื่อเล่น>`.

Re-run `./scripts/setup.sh` to deploy new code.

## Web board (the team dashboard, inside LINE)

The NORSE Project Overview dashboard is hosted by the same Cloud Run service at
`/board` and reads and writes **the same Sheet** as the bot:

- A task made in LINE (`@Norse …`, `งานใหม่: …`) shows on the board within ~8 seconds.
- A task made or edited on the board gets the same LINE treatment: new owners get
  a private DM (same once-a-day rule), done → ✓ line in the group, blocked → 🚧
  card in the group, and the 08:00 reminders (5/3/1 days, today, overdue).
- Tasks and milestones are the Tasks and Milestones tabs. Everything else the board
  keeps (contacts, interviews, orders, canvas, sources, settings) is in the **Board**
  tab, one row per item. Leave that tab alone.
- Sign-in is LINE (a LIFF app). Only linked team members get in; the session is a
  signed cookie checked on every request. Contacts' phone and email are only
  visible on the board, never in the group or to the AI.
- It opens from the menu bar's **แดชบอร์ด** button, or `บอร์ด` / `@Norse บอร์ด`.

**Setting it up (once, about 10 minutes)**

1. LINE Developers console → provider **NORSE** (the bot's provider, so user ids match)
   → **Create a new channel → LINE Login**. Region Thailand, app type **Web app**,
   name e.g. `Norse Board`.
2. In that channel, **LIFF** tab → **Add**: size **Full**, endpoint URL
   `https://<service-url>/board`, scopes **openid** and **profile**. Bot link
   feature: **On (Normal)** with the Norse account.
3. Click **Publish** on the channel (top of the page). While it says *Developing*,
   only the channel's admins can sign in.
4. Copy the **Channel ID** (Basic settings) and the **LIFF ID** (LIFF tab).
5. In Cloud Shell: `./scripts/setup.sh` and paste them when asked. The menu bar's
   last button switches from วิธีใช้ to แดชบอร์ด.

`board/index.html` is the dashboard page as built on claude.ai, kept as close to the
original as possible. `src/board/routes.js` adds `board/client.js` (a stand-in for
the claude.ai runtime: same `db`/`user` calls, backed by `/api/board/*`) and swaps
the email wording for LINE. To update the page, replace `board/index.html` and run
the tests: they fail if a swapped sentence no longer matches.

## Logo

`brand/norse-logo.svg` is the NORSE wordmark as a vector (traced from the brand
image; `fill="currentColor"`, so it takes the text colour where it is used). The
board's sidebar and tab icon, and the menu bar's hero tile, use it. Files for LINE
(upload them by hand; LINE has no API for these):

| File | Where |
| --- | --- |
| `brand/line-profile.png` (640×640) | Official Account Manager → Settings → Account settings → profile picture |
| `brand/line-cover.png` (1080×878) | Official Account Manager → Business profile → cover photo |
| `brand/icon-512.png` | LINE Developers → the LINE Login channel → Basic settings → App icon (shown when signing in to the board) |
| `brand/line-profile-dark.png` | alternative dark profile picture |

`npm run brand:render` redraws them from the SVG, and `npm run banners:render` redraws
the animated banners from `scripts/banners/banners.html` (both need Playwright).

## Develop

```bash
npm install
npm test          # 51 tests, no network
npm run preview   # cards.html: every card (real code, sample data) as LINE lays it out
```

Without `SHEET_ID` the bot uses an in-memory sheet (data is lost on restart).

**Menu bar**: `setup.sh` uploads it. To change it, edit `src/richmenu.js`
(buttons) and `scripts/rich-menu/menu.html` (look), run `npm run rich-menu:render`
(needs Playwright) to redraw `menu.png` and `menu-board.png`, commit, then `npm run rich-menu` in
Cloud Shell. Re-running with no changes does nothing.

## Code map

- `src/bot.js`: group and 1:1 handling, drafts, buttons, task updates
- `src/scheduler.js`: daily digest, overdue tag, weekly posts, evening round-up
- `src/flex.js`: cards in the dashboard style; `scripts/cards/`: sample cards + a LINE-like renderer for previews
- `src/dates.js`: Thai dates ("ศุกร์หน้า", "20 พ.ย.", ambiguous phrases become questions)
- `src/rules.js`: commands and update phrases that need no AI
- `src/ai/`: Gemini / Claude providers, model fallback, usage counter, prompt + JSON schema
- `src/sheets.js`, `src/team.js`: the Sheet as a database; members and tasks
- `src/line.js`: replies, counted pushes, @mentions
- `src/richmenu.js`, `scripts/rich-menu.js`, `scripts/rich-menu/`: the 1:1 menu bar (buttons, upload script, design + PNG)
- `src/board/`: the web board: `store.js` (documents ↔ Sheet), `auth.js` (LINE Login, cookie), `routes.js`; `board/`: the page and `client.js`
- `src/app.js`: HTTP routes (`/webhook`, `/health`, `/cron/tick`); `src/index.js` wires it all up

## Next (MVP 2–3)

- Meeting notes (text, voice, whiteboard photo) → decisions and action items to confirm
- Research: progress toward 20 interviews and a Google Form summary (inside the Monday post and replies, to save pushes)
- Private interview notes, receipts → expenses, supplier quotes
- ~~A LIFF board inside LINE, reading the same Sheet~~ done (see Web board); next: Research tab fed from the Google Form responses
