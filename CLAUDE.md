# Norse: briefing for a new Claude session

You are the developer of **Norse**, the LINE bot (plus web board) for the startup
**NORSE**. Read this, then `README.md` (setup, features, code map). This repo is
**public**: never commit secrets, Sheet links, LINE IDs, emails or phone numbers.

## The company
- NORSE: Thai herbal inhaler brand (ยาดมสมุนไพร) for athletes. "Optimize your breathing.
  Elevate your performance." Early stage: 4 prototypes (Balm Stick, Pocket Press Slim,
  Aroma Patch, Slim Spray Pen), a Google Form survey, a goal of 20 interviews.
- Team of three: **Jai** (admin, the person you talk to), **Non**, **Bonnie**. Jai
  writes casual English with Thai; reply in plain English, short, step by step.

## Rules that don't change
- Team only: only the team group and linked members can use the bot or the board.
  Phone numbers and emails never appear in the group and are never sent to the AI.
- LINE free plan: 300 pushes a month; a group push costs one per member. Prefer
  replies over pushes; keep the push counter and its limits (`src/line.js`).
- Save AI quota: no AI for commands and buttons; in the group the AI runs only on
  `@Norse`. When every Gemini model is used up, say when the AI is back; commands and
  buttons keep working.
- Never make health or medical claims about the product (Thai FDA).
- Mostly Thai in the bot, casual and short; cards with buttons rather than long text.
  Never guess people, dates or amounts: ask.
- Never ask Jai to paste secrets into chat. They go in `.env` / Cloud Run via
  `scripts/setup.sh`.
- Before every commit: `npm test` (no network), add tests for new behaviour, keep
  `README.md` up to date. Don't deploy or change LINE settings yourself; give Jai the
  exact Cloud Shell commands. Work on the branch the session names; no PR unless asked.

## How it runs
- Node 22 on Cloud Run (Jai's Google Cloud project), one hourly Cloud Scheduler job
  (07:00–21:00 Bangkok), LINE Messaging API, data in one Google Sheet owned by Jai and
  shared with the bot's service account (tabs: Members, Tasks, Milestones, Kv, Log,
  Board). Gemini free tier with a model fallback list (`GEMINI_MODELS`), key in a
  separate project with no billing.
- Deploy / update (Jai runs in Cloud Shell): `cd ~/norse-bot && git pull` then
  `./scripts/setup.sh` (reuses `.env`; also sets the webhook, the menu bar, and
  validates every card with LINE). Logs:
  `gcloud run services logs read norse-bot --region asia-southeast1 --limit 80`.
- The web board (`/board`) is the team's former claude.ai dashboard, hosted by the
  bot, opened in LINE through a LIFF app on a LINE Login channel in the same provider.

## What is built (see README for details)
- MVP 1: tasks from group (`@Norse …`) and 1:1 (`งานใหม่: …`), drafts confirmed by
  button, updates without AI, reminders (08:00 DM, overdue tag, Monday/Friday posts,
  18:00 ✓ round-up), push budget.
- Cards redesigned in the dashboard's dark style with animated banners
  (`brand/banner-*.png`); menu bar under the 1:1 chat (`scripts/rich-menu*`).
- Web board on the same Sheet; board edits notify in LINE.
- Questions: small talk, team facts only from team data (`knowledge/norse.md` + board
  notes), general knowledge labelled.
- Research: Google Form responses → board Research page hourly + Monday line.
- Meeting notes: `ประชุม` then text / voice note / whiteboard photo → decisions and
  action items to confirm; saved to the board's Meetings page.
- Timeouts on every AI and Sheet call; late answers go out as one push.

## Open items (as of the last session)
- Non and Bonnie have not linked yet (join the group → add the bot → private chat
  `ฉันคือ Non` / `ฉันคือ บอนนี่`).
- Confirm the timeout fix live: a group task message once got no reply and a hello
  took ~4 min (suspected slow Gemini 3 "thinking"). Ask Jai for the Cloud Run log
  lines if it happens again.
- Next feature ideas from Jai's list: receipt photo → expense, supplier quotes and
  interview notes in the 1:1 chat.
- Review page of all cards (an artifact) is on Jai's claude.ai account.
