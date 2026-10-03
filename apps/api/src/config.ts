import { resolve } from 'node:path';

export type Budgets = {
  maxSearchRounds: number;
  maxSearchCalls: number;
  maxArticleReads: number;
  maxCandidates: number;
  maxModelTurns: number;
  deadlineMs: number;
  /** Time kept back from the deadline for the final verification call. */
  decisionReserveMs: number;
  socialLimit: number;
  articleLimit: number;
};

export const DEFAULT_BUDGETS: Budgets = {
  maxSearchRounds: 2,
  maxSearchCalls: 4,
  maxArticleReads: 4,
  maxCandidates: 20,
  maxModelTurns: 6,
  deadlineMs: 90_000,
  decisionReserveMs: 20_000,
  socialLimit: 10,
  articleLimit: 8,
};

export type Config = {
  port: number;
  geminiApiKey: string | null;
  geminiModel: string;
  /** Tried in order when the main model stays busy. */
  geminiFallbackModels: string[];
  sources: 'mock' | 'live';
  budgets: Budgets;
  cacheDir: string;
  mockFail: string | null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const sources = env.SOURCES === 'live' ? 'live' : 'mock';
  const deadlineMs = positiveInt(env.RESEARCH_DEADLINE_MS) ?? DEFAULT_BUDGETS.deadlineMs;
  return {
    port: positiveInt(env.PORT) ?? 8787,
    geminiApiKey: env.GEMINI_API_KEY?.trim() || null,
    geminiModel: env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash',
    geminiFallbackModels: (env.GEMINI_FALLBACK_MODELS ?? '').split(',').map((m) => m.trim()).filter(Boolean),
    sources,
    budgets: {
      ...DEFAULT_BUDGETS,
      deadlineMs,
      decisionReserveMs: Math.min(DEFAULT_BUDGETS.decisionReserveMs, Math.floor(deadlineMs / 3)),
    },
    cacheDir: env.RESULT_CACHE_DIR?.trim()
      ? resolve(env.RESULT_CACHE_DIR)
      : resolve(import.meta.dirname, '../../../fixtures/research/live'),
    mockFail: env.MOCK_FAIL?.trim() || null,
  };
}

function positiveInt(value: string | undefined): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
