// All settings come from environment variables (see .env.example).

const list = (v, d = '') => String(v ?? d).split(',').map((s) => s.trim()).filter(Boolean);
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export function loadConfig(env = process.env) {
  return {
    port: num(env.PORT, 8080),
    botName: env.BOT_NAME || 'Norse',
    timeZone: env.TIMEZONE || 'Asia/Bangkok',

    line: {
      channelSecret: env.LINE_CHANNEL_SECRET || '',
      channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
    },

    // The team Google Sheet (owned by anyone, shared as Editor with the bot's
    // service account). The bot creates the tabs it needs on first start.
    sheetId: env.SHEET_ID || '',
    // First start only: nicknames to put in the Members tab when it is empty,
    // "Nick/alias/alias:role", e.g. "Jai/เจ:admin, Best/เบสท์, Bonnie/บอนนี่".
    // Later, edit the Members tab directly.
    teamSeed: list(env.TEAM_SEED),

    ai: {
      provider: (env.LLM_PROVIDER || '').toLowerCase(),
      geminiKey: env.GEMINI_API_KEY || '',
      // Tried in order. Free-tier quota is counted per model, so when one
      // model's daily quota runs out the next one is used.
      geminiModels: list(env.GEMINI_MODELS, 'gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite'),
      anthropicKey: env.ANTHROPIC_API_KEY || '',
      claudeModel: env.CLAUDE_MODEL || 'claude-sonnet-5-5',
    },

    // Cloud Scheduler calls /cron/tick every hour with this secret.
    cronSecret: env.CRON_SECRET || '',
    schedule: {
      morningHour: num(env.MORNING_HOUR, 8),     // daily DM digest + overdue tag
      eveningHour: num(env.EVENING_HOUR, 18),    // group ✓ round-up
      mondayHour: num(env.MONDAY_HOUR, 9),       // Monday plan
      fridayHour: num(env.FRIDAY_HOUR, 17),      // Friday wrap-up
    },
    reminderDays: list(env.REMINDER_DAYS, '5,3,1').map(Number).filter((n) => n > 0),
    overdueTagAfterDays: num(env.OVERDUE_TAG_AFTER_DAYS, 2),

    // LINE free plan in Thailand: 300 pushes a month, counted per recipient.
    pushMonthlyLimit: num(env.PUSH_MONTHLY_LIMIT, 300),
  };
}
