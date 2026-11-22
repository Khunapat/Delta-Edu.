# Delta: briefing for a new Claude session

You are the developer of **Delta**, the LINE bot (plus web board) for the tutoring
institution **δelta Edu.** Read this, then `README.md` (setup, features, code map).
This repo is **public**: never commit secrets, Sheet links, LINE IDs, emails, phone
numbers, or private business details (equity, pay ladder numbers, prices not yet
agreed, open partner decisions, roadmap). Don't commit the institution PDF.

## The institution
- δelta Edu. ("Small things create big change."): one institution, two brands.
  **δelta Edu.** (tag `Uni`): live online small groups for university students,
  Chulalongkorn first; foundations + Chemical Engineering, Thermodynamics I first.
  **δelta Edu. LITE** (tag `LITE`): international secondary (SAT, GED, IGCSE, A-Level),
  the new name of AlDenté Academy.
- Team: **Best** (founder, academic lead), **Jai** (partner, bot admin, the person you
  talk to), **Kiak** (partner and tutor), **Pure** (partner, marketing and ops), plus
  tutors later. Jai writes casual English with Thai; reply in plain English, short,
  step by step.
- Public facts are in `knowledge/delta-edu.md`; private ones go on the board's Notes page.

## Rules that don't change
- **Never touch the Norse bot** (Jai's other bot, same Google Cloud account). Delta
  has its own folder `~/delta-edu`, `.env`, Cloud Run service `delta-edu-bot`,
  service account, scheduler job, LINE channel and Sheet. `scripts/setup.sh` refuses
  anything that points at Norse; keep that guard and its tests.
- Team and tutors only: only the team group and linked members can use the bot or
  the board. Phone numbers and emails never appear in the group and are never sent
  to the AI. LINE user ids never reach the browser.
- LINE free plan: 300 pushes a month; a group push costs one per member. Prefer
  replies over pushes; keep the push counter and its limits (`src/line.js`).
- Save AI quota: no AI for commands and buttons; in the group the AI runs only on
  `@Delta`. When every Gemini model is used up, say when the AI is back; commands and
  buttons keep working.
- The bot speaks **English** (casual, short), cards with buttons rather than long
  text. Thai input words and dates are still understood. Never guess people, dates
  or amounts: ask. "SAT" is the exam, never Saturday.
- Pay ladder numbers live only in the Sheet (`settings/pay`), never in code, tests
  (use made-up bands) or the AI prompt.
- Never ask Jai to paste secrets into chat. They go in `.env` / Cloud Run via
  `scripts/setup.sh`.
- Before every commit: `npm test` (no network), add tests for new behaviour, keep
  `README.md` up to date. Don't deploy or change LINE settings yourself; give Jai the
  exact Cloud Shell commands, one per code block. Work on the branch the session
  names; no PR unless asked.

## How it runs
- Node 22 on Cloud Run (Jai's Google Cloud project), one hourly Cloud Scheduler job
  `delta-edu-bot-tick` (07:00–21:00 Bangkok), LINE Messaging API, data in one Google
  Sheet shared with the service account (tabs: Members, Tasks, Milestones, Kv, Log,
  Board). Gemini free tier with a model fallback list (`GEMINI_MODELS`), key in a
  separate project with no billing.
- Deploy / update (Jai runs in Cloud Shell): `cd ~/delta-edu && git pull` then
  `SERVICE=delta-edu-bot ./scripts/setup.sh`. Logs:
  `gcloud run services logs read delta-edu-bot --region asia-southeast1 --limit 80`.
- The web board (`/board`) is a single-file page hosted by the bot, opened in LINE
  through a LIFF app on a LINE Login channel in the same provider.

## What is built (see README for details)
- Tasks from the group (`@Delta …`) and 1:1 (`new task: …`), drafts confirmed by
  button, brand tags Uni / LITE / Both, updates without AI, reminders (08:00 DM,
  overdue tag, Monday/Friday posts, 18:00 ✓ round-up), push budget.
- Classes (`classes`, `my classes`, in the 08:00 DM and Monday post), decisions
  (`decisions`; saved meeting decisions become agreed), tutor pay (`pay 10 students
  10h 300`, 1:1 only, progressive ladder from the board).
- Meeting notes: `meeting` then text / voice note / whiteboard photo → decisions and
  action items to confirm; saved to the board.
- Questions: small talk, team facts only from team data (knowledge file + board
  notes, decisions, meetings, upcoming classes), general knowledge labelled.
- Feedback: Google Form responses → board Feedback page hourly + Monday line.
- Cards in the δelta green/cream look with animated banners; menu bar (My tasks,
  Today, Team / New task, Classes, Help or Board); brand files in `brand/`.
- Web board: Home, Tasks, Classes (+ pay calculator and ladder), Decisions,
  Meetings, Timeline, Notes, Feedback.

## Open items (as of the last session)
- Not deployed yet: walk Jai through setup step by step (new LINE OA + Messaging
  API channel, Gemini key, new Sheet, deploy, LINE settings, linking, optional board).
- Who leads LITE (Kiak?) and which tutors join besides Kiak: ask Jai, then update
  `knowledge/delta-edu.md` and `TEAM_SEED`.
- After the first deploy, Jai pastes the private facts (roadmap, open decisions,
  ladder) on the board (Notes, Decisions, Classes → Pay ladder), not in the repo.
- Ideas: enrollment pipeline per course, per-cohort feedback form, receipts →
  expenses, tutor hours log.
