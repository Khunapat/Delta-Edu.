import { GoogleGenAI } from '@google/genai';
import { withRetry, isQuotaError } from './errors.js';

/**
 * Gemini provider (Google AI Studio key, free tier is enough for one user).
 *
 * complete({ system, messages, tools, runTool }) runs the model, executes any
 * function calls through runTool, and returns the final text.
 *   messages: [{ role: 'user'|'assistant', text }]   (last one is the new turn)
 *   tools:    Anthropic-style { name, description, input_schema } definitions
 */
export class GeminiProvider {
  /**
   * `model` may be a comma-separated list ("gemini-3.6-flash,gemini-3.6-flash-lite").
   * Free-tier quotas are counted per model, so when the first model's daily
   * quota is spent we fall through to the next one instead of failing.
   */
  constructor({ apiKey, model = 'gemini-3.6-flash', usage = null, timeoutMs = 20_000, budgetMs = 45_000 }) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is required');
    this.ai = new GoogleGenAI({ apiKey });
    this.usage = usage;
    this.models = String(model).split(',').map((m) => m.trim()).filter(Boolean);
    this.model = this.models[0];
    this.label = `Gemini ${this.models.join(' > ')}`;
    this.timeoutMs = timeoutMs;   // per model attempt
    this.budgetMs = budgetMs;     // stop moving down the list after this long
    this.noThinking = new Set();
  }

  /**
   * One model call with a time limit. Gemini 3 models are asked to think "low": task
   * cards and short answers don't need long reasoning, and it keeps replies fast. A
   * model that refuses the setting is retried once without it (and remembered).
   */
  async callModel(model, request) {
    const thinking = /^gemini-3/.test(model) && !this.noThinking.has(model);
    const once = async (withThinking) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const config = { ...(request.config || {}), abortSignal: ctrl.signal, ...(withThinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) };
        return await this.ai.models.generateContent({ model, ...request, config });
      } catch (err) {
        if (ctrl.signal.aborted) throw Object.assign(new Error(`${model} took longer than ${this.timeoutMs / 1000}s`), { status: 504, timeout: true });
        throw err;
      } finally { clearTimeout(timer); }
    };
    try {
      return await once(thinking);
    } catch (err) {
      if (thinking && Number(err?.status) === 400 && /thinking/i.test(String(err?.message || ''))) {
        this.noThinking.add(model);
        return once(false);
      }
      throw err;
    }
  }

  /** Call generateContent, walking down the model list on quota errors, missing models and timeouts. */
  async generate(request) {
    let lastErr;
    const started = Date.now();
    for (const model of this.models) {
      if (Date.now() - started > this.budgetMs) break; // LINE's reply window is short: stop trying
      const t0 = Date.now();
      try {
        const resp = await withRetry(() => this.callModel(model, request), { maxDelayMs: 4000 });
        this.usage?.record(model).catch(() => {});
        console.log(`gemini ${model} ok ${Date.now() - t0}ms`);
        return resp;
      } catch (err) {
        const timedOut = !!err?.timeout;
        if (!timedOut) this.usage?.record(model, err).catch(() => {});
        const missing = Number(err?.status) === 404 || /not found|not supported/i.test(String(err?.message || ''));
        console.warn(`gemini ${model} ${timedOut ? 'timeout' : missing ? 'unavailable' : isQuotaError(err) ? 'quota hit' : 'error'} after ${Date.now() - t0}ms: ${String(err?.message || err).slice(0, 160)}`);
        if (!isQuotaError(err) && !missing && !timedOut) throw err;
        // Keep the quota error as the reported cause so the user sees "AI busy", not "model missing".
        if (!lastErr || isQuotaError(err)) lastErr = err;
      }
    }
    throw lastErr || Object.assign(new Error('AI took too long'), { status: 504, timeout: true });
  }

  async complete({ system, messages, tools, runTool, maxIters = 6 }) {
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));
    const functionDeclarations = tools.map(toFunctionDeclaration);

    for (let i = 0; i < maxIters; i++) {
      const resp = await this.generate({
        contents,
        config: {
          systemInstruction: system,
          tools: [{ functionDeclarations }],
          temperature: 0.7,
        },
      });

      const calls = resp.functionCalls || [];
      if (calls.length === 0) return { text: (resp.text || '').trim() };

      const modelTurn = resp.candidates?.[0]?.content;
      if (modelTurn) contents.push(modelTurn);

      const parts = [];
      for (const call of calls) {
        let result;
        try {
          result = await runTool(call.name, call.args || {});
        } catch (err) {
          result = { error: String(err?.message || err) };
        }
        parts.push({ functionResponse: { id: call.id, name: call.name, response: { result } } });
      }
      contents.push({ role: 'user', parts });
    }
    return { text: '' };
  }
}

/**
 * Structured extraction: returns an object matching `schema` (JSON Schema).
 * `parts` may include { text } and { inlineData: { mimeType, data(base64) } }.
 */
GeminiProvider.prototype.extract = async function extract({ system, parts, schema }) {
  const resp = await this.generate({
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      temperature: 0.2,
    },
  });
  const text = resp.text || '';
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('model returned non-JSON: ' + text.slice(0, 200));
  }
};

/** Convert an Anthropic-style tool definition to a Gemini function declaration. */
export function toFunctionDeclaration(tool) {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.input_schema,
  };
}
