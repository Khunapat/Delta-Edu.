// One AI interface for the bot. Gemini (free tier) by default with a fallback
// list of models; Claude (paid) if configured. The AI only ever returns JSON
// that matches a schema; the server checks it and does the writing.

import { GeminiProvider } from './gemini.js';
import { AnthropicProvider } from './anthropic.js';
import { Usage, nextReset, describeReset } from './usage.js';
import { isQuotaError, isDailyQuota } from './errors.js';

export class AiResting extends Error {
  constructor(resetAt, { daily = true } = {}) {
    super('AI quota used up');
    this.resetAt = resetAt;
    this.daily = daily;
  }
}
export class AiOff extends Error {}

/** Usage counts saved in the Sheet's Kv tab so restarts keep them. */
class KvDocStore {
  constructor(db) { this.db = db; }
  read(name, fallback) { return this.db.kvGet('doc:' + name, fallback); }
  write(name, data) { return this.db.kvSet('doc:' + name, data); }
}

export class Ai {
  constructor({ cfg, db, provider = null, usage = null }) {
    this.tz = cfg.timeZone;
    this.usage = usage || new Usage({ store: db ? new KvDocStore(db) : null });
    this.provider = provider || makeProvider(cfg.ai, this.usage);
  }

  get enabled() { return !!this.provider; }
  get models() { return this.provider?.models || []; }
  get label() { return this.provider?.label || 'AI ปิดอยู่'; }

  /** All configured models have hit their daily quota today. */
  async resting(now = new Date()) {
    if (!this.provider) return false;
    const snap = await this.usage.snapshot(this.models, now);
    const mine = snap.models.filter((m) => this.models.includes(m.model));
    return mine.length > 0 && mine.every((m) => m.exhausted);
  }

  async extract({ system, parts, schema }) {
    if (!this.provider) throw new AiOff('no AI key configured');
    if (await this.resting()) throw new AiResting(nextReset());
    try {
      return await this.provider.extract({ system, parts, schema });
    } catch (err) {
      if (err instanceof AiResting) throw err;
      if (isQuotaError(err)) throw new AiResting(isDailyQuota(err) || (await this.resting()) ? nextReset() : null, { daily: isDailyQuota(err) });
      throw err;
    }
  }

  async status(now = new Date()) {
    const snap = await this.usage.snapshot(this.models, now);
    return { ...snap, label: this.label, resetText: describeReset(snap.resetAt, this.tz, now) };
  }

  restingText(err, now = new Date()) {
    if (err instanceof AiOff) return 'ยังไม่ได้ใส่ key ของ AI เลยตอบประโยคยาวๆ ไม่ได้ แต่ปุ่มกับคำสั่ง งานฉัน / งานทีม ยังใช้ได้นะ';
    if (err?.resetAt && err.daily !== false) {
      return `AI พักอยู่ (โควตาฟรีวันนี้หมดแล้ว) กลับมา ${describeReset(err.resetAt, this.tz, now)} 😴\nระหว่างนี้ปุ่มกับคำสั่ง งานฉัน / งานทีม / เสร็จแล้ว ยังใช้ได้ปกติ`;
    }
    return 'AI คิวแน่นอยู่ ลองพิมพ์ใหม่อีกสักครู่นะ (ปุ่มกับคำสั่งสั้นๆ ยังใช้ได้)';
  }
}

function makeProvider(ai, usage) {
  const want = ai.provider;
  if ((want === 'anthropic' || (!want && !ai.geminiKey)) && ai.anthropicKey) {
    return new AnthropicProvider({ apiKey: ai.anthropicKey, model: ai.claudeModel, usage });
  }
  if (want !== 'none' && ai.geminiKey) {
    return new GeminiProvider({ apiKey: ai.geminiKey, model: ai.geminiModels.join(','), usage });
  }
  return null;
}
