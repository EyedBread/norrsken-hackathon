import { GoogleGenAI, type Content, type FunctionCall, type FunctionDeclaration } from '@google/genai';

export type ModelRequest = {
  system: string;
  contents: Content[];
  tools?: FunctionDeclaration[];
  /** When set, the model must answer with JSON matching this schema. */
  jsonSchema?: unknown;
  signal: AbortSignal;
  /** Called before each retry so the job can show a real "busy, retrying" event. */
  onRetry?: (info: { attempt: number; model: string; reason: string }) => void;
};

export type ModelTurn = {
  /** Raw model content, passed back unchanged so thought signatures survive. */
  content: Content | null;
  functionCalls: FunctionCall[];
  text: string;
};

/** The only thing the agent needs from Gemini. Tests swap in a scripted fake. */
export interface ResearchModel {
  readonly name: string;
  generate(req: ModelRequest): Promise<ModelTurn>;
}

export type RetryOptions = {
  /** Attempts per model, including the first. */
  attemptsPerModel: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export const DEFAULT_RETRY: RetryOptions = { attemptsPerModel: 3, baseDelayMs: 1000, maxDelayMs: 6000 };

type CallModel = (model: string, req: ModelRequest) => Promise<ModelTurn>;

export function createGeminiModel(
  apiKey: string,
  model: string,
  opts: { fallbackModels?: string[]; retry?: RetryOptions } = {},
): ResearchModel {
  const ai = new GoogleGenAI({ apiKey });
  const call: CallModel = async (name, req) => {
    const res = await ai.models.generateContent({
      model: name,
      contents: req.contents,
      config: {
        systemInstruction: req.system,
        abortSignal: req.signal,
        ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools }] } : {}),
        ...(req.jsonSchema ? { responseMimeType: 'application/json', responseJsonSchema: req.jsonSchema } : {}),
      },
    });
    return {
      content: res.candidates?.[0]?.content ?? null,
      functionCalls: res.functionCalls ?? [],
      text: res.text ?? '',
    };
  };
  return withRetry(call, [model, ...(opts.fallbackModels ?? [])], opts.retry ?? DEFAULT_RETRY);
}

/**
 * Retries busy/overloaded errors with backoff, then moves to the next fallback model.
 * Other errors (bad key, bad request) fail at once. Waiting stops when the job is aborted.
 * Exported for tests.
 */
export function withRetry(call: CallModel, models: string[], retry: RetryOptions): ResearchModel {
  const chain = [...new Set(models.filter(Boolean))];
  return {
    name: chain[0]!,
    async generate(req) {
      let lastError: unknown;
      let attempt = 0;
      for (const [m, name] of chain.entries()) {
        for (let i = 0; i < retry.attemptsPerModel; i++) {
          if (attempt > 0) {
            const reason = errorSummary(lastError);
            req.onRetry?.({ attempt: attempt + 1, model: name, reason });
            if (i > 0) await sleep(Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (i - 1)) * jitter(), req.signal);
          }
          attempt++;
          try {
            return await call(name, req);
          } catch (err) {
            if (req.signal.aborted) throw err;
            // A fallback model that does not exist should not hide the real busy error.
            if (m > 0 && !isRetryable(err) && isModelMissing(err)) break;
            if (!isRetryable(err)) throw err;
            lastError = err;
          }
        }
      }
      throw lastError;
    },
  };
}

export function isRetryable(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== null) return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  const msg = err instanceof Error ? err.message : String(err);
  return /high demand|overloaded|unavailable|resource.?exhausted|rate.?limit|try again later|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg);
}

function isModelMissing(err: unknown): boolean {
  return statusOf(err) === 404 || /not found|is not supported/i.test(err instanceof Error ? err.message : String(err));
}

function statusOf(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}

function errorSummary(err: unknown): string {
  const status = statusOf(err);
  if (status === 429) return 'rate limited';
  if (status === 503) return 'high demand';
  return status ? `HTTP ${status}` : 'temporary error';
}

function jitter(): number {
  return 0.8 + Math.random() * 0.4;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new Error('aborted'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
