import { loadConfig } from './config.js';
import { Db, GoogleSheetsBackend, MemoryBackend } from './sheets.js';
import { Team } from './team.js';
import { Line } from './line.js';
import { Ai } from './ai/index.js';
import { Bot } from './bot.js';
import { Scheduler } from './scheduler.js';
import { makeApp } from './app.js';
import { BoardStore } from './board/store.js';
import { BoardAuth } from './board/auth.js';
import { boardRouter } from './board/routes.js';
import { buildKnowledge } from './knowledge.js';
import { Research } from './research.js';

const cfg = loadConfig();
const backend = cfg.sheetId ? new GoogleSheetsBackend(cfg.sheetId) : new MemoryBackend();
if (!cfg.sheetId) console.warn('SHEET_ID not set: using an in-memory sheet (data is lost on restart)');
const db = new Db(backend);
const team = new Team(db, { timeZone: cfg.timeZone });
const line = new Line({ token: cfg.line.channelAccessToken, db, monthlyLimit: cfg.pushMonthlyLimit, timeZone: cfg.timeZone });
const ai = new Ai({ cfg, db });
const store = new BoardStore({ db, team });
// What Delta knows for questions: knowledge/delta-edu.md + the web board's documents (cached a minute).
let known = { at: 0, text: '' };
async function knowledge() {
  if (Date.now() - known.at < 60_000) return known.text;
  const { docs } = await store.snapshot();
  known = { at: Date.now(), text: buildKnowledge(docs, { today: team.today() }) };
  return known.text;
}
const bot = new Bot({ cfg, db, team, line, ai, knowledge, store });
const research = new Research({ store });
const scheduler = new Scheduler({ cfg, db, team, line, bot, research });

let ready = null;
function init() {
  ready ||= (async () => {
    await db.init();
    const n = await team.seedMembers(cfg.teamSeed);
    if (n) console.log(`seeded ${n} members`);
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

const auth = new BoardAuth({ secret: cfg.board.sessionSecret, channelId: cfg.board.loginChannelId, team });
const board = boardRouter({
  store, auth, init, liffId: cfg.board.liffId,
  onChange: async (change) => {
    await bot.boardChanged(change);
    if (change.path === 'research/config') await research.sync(); // Form link saved: fill the Research page now
  },
});
const app = makeApp({ cfg, init, bot, scheduler, aiLabel: () => ai.label, board });
app.listen(cfg.port, () => console.log(`${cfg.botName} listening on ${cfg.port} (${ai.label})`));
