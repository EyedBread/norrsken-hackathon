import { randomUUID } from 'node:crypto';
import type { JobMode, Place, ResearchJob, StartResearchResponse } from '@atw/contracts';
import { runResearch, type AgentDeps } from './agent.ts';
import type { ResultCache } from './cache.ts';

const TERMINAL = new Set(['complete', 'partial', 'failed']);
const JOB_TTL_MS = 30 * 60_000;

export type JobStoreDeps = AgentDeps & {
  /** "live" for real sources, "demo" for mock sources. */
  mode: Exclude<JobMode, 'cache'>;
  cache: ResultCache;
};

/** In-memory job store. One long-running server instance holds all jobs. */
export class JobStore {
  private readonly jobs = new Map<string, { job: ResearchJob; place: Place; createdAt: number }>();

  constructor(private readonly deps: JobStoreDeps) {}

  start(place: Place, refresh = false): StartResearchResponse {
    this.sweep();

    // Reuse an identical job that is still running.
    for (const entry of this.jobs.values()) {
      if (!TERMINAL.has(entry.job.status) && samePlace(entry.place, place)) {
        return { jobId: entry.job.jobId, placeKey: place.key };
      }
    }

    const jobId = randomUUID();
    const cached = refresh ? undefined : this.deps.cache.get(place.key);
    if (cached) {
      const job: ResearchJob = {
        ...structuredClone(cached),
        jobId,
        mode: 'cache',
        events: [...cached.events, { at: now(), message: `Loaded saved result from ${cached.generatedAt ?? 'an earlier run'}` }],
      };
      this.jobs.set(jobId, { job, place, createdAt: Date.now() });
      return { jobId, placeKey: place.key };
    }

    const job: ResearchJob = {
      jobId,
      placeKey: place.key,
      status: 'queued',
      stage: 'queued',
      mode: this.deps.mode,
      generatedAt: null,
      events: [{ at: now(), message: 'Queued' }],
      summary: { checked: 0, kept: 0, rejected: 0, uncertain: 0 },
      cards: [],
      decisions: [],
      sourceErrors: [],
    };
    this.jobs.set(jobId, { job, place, createdAt: Date.now() });
    setImmediate(() => void this.run(job, place));
    return { jobId, placeKey: place.key };
  }

  get(jobId: string): ResearchJob | undefined {
    return this.jobs.get(jobId)?.job;
  }

  private async run(job: ResearchJob, place: Place): Promise<void> {
    job.status = 'running';
    const startedAt = Date.now();
    console.log(`[job ${job.jobId}] start ${place.key} (${job.mode})`);
    try {
      const outcome = await runResearch(place, this.deps, {
        event: (message) => job.events.push({ at: now(), message }),
        stage: (stage) => (job.stage = stage),
      });
      job.cards = outcome.cards;
      job.decisions = outcome.decisions;
      job.summary = outcome.summary;
      job.sourceErrors = outcome.sourceErrors;
      job.status = outcome.sourceErrors.length > 0 || outcome.cutShort ? 'partial' : 'complete';
    } catch (err) {
      const message = (this.deps.redact ?? String)(err instanceof Error ? err.message : String(err)).slice(0, 300);
      job.sourceErrors.push({ source: 'api', code: 'internal_error', message });
      job.events.push({ at: now(), message: 'Research failed' });
      job.status = 'failed';
      console.error(`[job ${job.jobId}] failed: ${message}`);
    }
    job.stage = 'done';
    job.generatedAt = now();
    job.events.push({ at: now(), message: job.status === 'failed' ? 'Stopped' : 'Done' });
    console.log(
      `[job ${job.jobId}] ${job.status} in ${Date.now() - startedAt}ms ` +
        `kept=${job.summary.kept} rejected=${job.summary.rejected} uncertain=${job.summary.uncertain} errors=${job.sourceErrors.length}`,
    );
    await this.deps.cache.set(job);
  }

  private sweep(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, entry] of this.jobs) {
      if (entry.createdAt < cutoff && TERMINAL.has(entry.job.status)) this.jobs.delete(id);
    }
  }
}

function samePlace(a: Place, b: Place): boolean {
  return a.key === b.key && a.name === b.name && a.address === b.address && a.city === b.city;
}

function now(): string {
  return new Date().toISOString();
}
