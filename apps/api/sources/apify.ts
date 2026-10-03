import { setTimeout as delay } from 'node:timers/promises';
import { boundedSignal, checkContext, SourceFailure } from './errors.ts';
import { record } from './normalize.ts';
import type { RunObservation, ToolContext } from './types.ts';

export const ACTORS = { social: 'clockworks~tiktok-scraper', articles: 'apify~google-search-scraper' } as const;
type Actor = typeof ACTORS[keyof typeof ACTORS];
export type ActorRunner = (actor: Actor, input: Record<string, unknown>, limit: number, ctx: ToolContext) => Promise<unknown[]>;
export type ApifyOptions = {
  token?: string; timeoutMs?: number; pollMs?: number; fetch?: typeof fetch;
  onRun?: (observation: RunObservation) => void;
};

/** Starts bounded runs, polls terminal state, and cancels known unfinished runs. */
export function createActorRunner(options: ApifyOptions = {}): ActorRunner {
  const fetcher = options.fetch ?? fetch;
  const token = options.token ?? process.env.APIFY_TOKEN ?? process.env.APIFY_API_TOKEN;
  const timeoutMs = options.timeoutMs ?? 60000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 90000) throw new Error('timeoutMs must be between 1000 and 90000.');

  async function request(path: string, signal: AbortSignal, body?: Record<string, unknown>) {
    const response = await fetcher(`https://api.apify.com/v2/${path}`, {
      method: body ? 'POST' : 'GET', signal, redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const code = response.status === 401 || response.status === 403 ? 'AUTH_FAILED'
        : response.status === 429 ? 'RATE_LIMITED' : response.status === 402 ? 'CREDIT_REQUIRED' : 'PROVIDER_HTTP_ERROR';
      throw new SourceFailure(code, `Apify returned HTTP ${response.status}.`);
    }
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (!response.body) throw new SourceFailure('INVALID_RESPONSE', 'Apify returned an empty response.');
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) throw new SourceFailure('RESPONSE_TOO_LARGE', 'Apify response exceeded the size limit.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new SourceFailure('INVALID_RESPONSE', 'Apify returned invalid JSON.'); }
  }

  return async (actor, input, limit, ctx) => {
    checkContext(ctx);
    if (!token) throw new SourceFailure('MISSING_CREDENTIALS', 'Set APIFY_TOKEN in the backend environment.');
    if (!Object.values(ACTORS).includes(actor)) throw new SourceFailure('INVALID_ACTOR', 'Actor is not allowed.');
    const signal = boundedSignal(ctx, timeoutMs);
    const started = Date.now();
    let run: Record<string, unknown> = {};
    let runId: string | null = null;
    let finished = false;
    let observedStatus = 'FAILED';
    const seconds = Math.max(1, Math.floor(Math.min(timeoutMs, ctx.deadlineAt - started) / 1000));
    try {
      const params = new URLSearchParams({ timeout: String(seconds), waitForFinish: '0' });
      run = record(record(await request(`acts/${actor}/runs?${params}`, signal, input)).data);
      if (typeof run.id !== 'string' || !/^[\w-]+$/.test(run.id)) throw new SourceFailure('INVALID_RESPONSE', 'Apify did not return a valid run ID.');
      runId = run.id;
      while (['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING'].includes(String(run.status))) {
        await delay(options.pollMs ?? 750, undefined, { signal });
        run = record(record(await request(`actor-runs/${runId}`, signal)).data);
        if (run.id !== runId) throw new SourceFailure('INVALID_RESPONSE', 'Apify returned an invalid run.');
      }
      finished = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(String(run.status));
      observedStatus = String(run.status ?? 'UNKNOWN');
      if (run.status !== 'SUCCEEDED') throw new SourceFailure(run.status === 'TIMED-OUT' ? 'TIMEOUT' : 'ACTOR_FAILED', `Apify Actor ended with status ${finished ? run.status : 'UNKNOWN'}.`);
      if (typeof run.defaultDatasetId !== 'string' || !/^[\w-]+$/.test(run.defaultDatasetId)) throw new SourceFailure('INVALID_RESPONSE', 'Apify did not return a dataset ID.');
      const items = await request(`datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=${Math.max(1, Math.min(20, limit))}`, signal);
      if (!Array.isArray(items)) throw new SourceFailure('INVALID_RESPONSE', 'Apify dataset was not an array.');
      return items;
    } catch (error) {
      if (signal.aborted && !ctx.signal.aborted) throw new SourceFailure('TIMEOUT', 'Apify source deadline exceeded.');
      throw error;
    } finally {
      if (!finished && runId) {
        try {
          await request(`actor-runs/${runId}/abort`, AbortSignal.timeout(2000), {});
          observedStatus = 'ABORTED';
        } catch { observedStatus = 'CANCELLATION_UNCONFIRMED'; }
      }
      // Telemetry is optional and must not break retrieval or expose input/token values.
      try { options.onRun?.({ actor, runId, status: observedStatus,
        elapsedMs: Date.now() - started, usageTotalUsd: typeof run.usageTotalUsd === 'number' ? run.usageTotalUsd : null }); } catch { /* observer only */ }
    }
  };
}
