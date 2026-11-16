import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiProvider } from '../src/ai/gemini.js';
import { Ai, AiResting } from '../src/ai/index.js';
import { loadConfig } from '../src/config.js';

/** A Gemini client whose models behave as scripted: 'hang', 'ok', 'nothinking', or an error. */
function fakeGemini(behaviour) {
  const calls = [];
  return {
    calls,
    models: {
      generateContent: ({ model, config }) => {
        calls.push({ model, thinking: !!config.thinkingConfig });
        const b = behaviour[model];
        if (b === 'hang') return new Promise((_, reject) => config.abortSignal.addEventListener('abort', () => reject(new Error('aborted'))));
        if (b === 'nothinking' && config.thinkingConfig) return Promise.reject(Object.assign(new Error('Thinking level is not supported for this model'), { status: 400 }));
        if (b instanceof Error) return Promise.reject(b);
        return Promise.resolve({ text: JSON.stringify({ model }) });
      },
    },
  };
}
function provider(models, behaviour, opts = {}) {
  const p = new GeminiProvider({ apiKey: 'k', model: models.join(','), timeoutMs: 50, budgetMs: 1000, ...opts });
  p.ai = fakeGemini(behaviour);
  return p;
}

test('a model that hangs is cut off and the next one answers', async () => {
  const p = provider(['gemini-3.8-flash', 'gemini-3.5-flash-lite'], { 'gemini-3.8-flash': 'hang', 'gemini-3.5-flash-lite': 'ok' });
  const t0 = Date.now();
  const out = await p.extract({ system: 's', parts: [{ text: 'x' }], schema: {} });
  assert.equal(out.model, 'gemini-3.5-flash-lite');
  assert.ok(Date.now() - t0 < 1000, 'did not wait for the stuck model');
});

test('Gemini 3 models are asked to think "low"; a model that refuses is retried without it', async () => {
  const p = provider(['gemini-3.8-flash'], { 'gemini-3.8-flash': 'nothinking' });
  const out = await p.extract({ system: 's', parts: [{ text: 'x' }], schema: {} });
  assert.equal(out.model, 'gemini-3.8-flash');
  assert.deepEqual(p.ai.calls.map((c) => c.thinking), [true, false]);
  await p.extract({ system: 's', parts: [{ text: 'x' }], schema: {} });
  assert.equal(p.ai.calls.at(-1).thinking, false, 'remembered');
  const q = provider(['gemini-2.5-flash'], { 'gemini-2.5-flash': 'ok' });
  await q.extract({ system: 's', parts: [{ text: 'x' }], schema: {} });
  assert.equal(q.ai.calls[0].thinking, false, 'older models untouched');
});

test('when every model is too slow, the bot says "try again" instead of hanging', async () => {
  const p = provider(['gemini-3.8-flash', 'gemini-3.6-flash'], { 'gemini-3.8-flash': 'hang', 'gemini-3.6-flash': 'hang' });
  const ai = new Ai({ cfg: loadConfig({}), db: null, provider: p });
  await assert.rejects(ai.extract({ system: 's', parts: [{ text: 'x' }], schema: {} }), (e) => e instanceof AiResting && e.daily === false);
});
