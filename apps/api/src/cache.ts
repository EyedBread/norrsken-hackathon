import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResearchJob } from '@atw/contracts';

/**
 * Cache of genuine live results, keyed by place key.
 * Only mode "live" jobs are stored, so mock/demo data can never come back labelled as a real run.
 * Results are also written to disk as JSON so they survive restarts and can be used offline.
 */
export class ResultCache {
  private readonly entries = new Map<string, ResearchJob>();

  constructor(private readonly dir: string | null) {}

  async load(): Promise<number> {
    if (!this.dir) return 0;
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return 0;
    }
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      try {
        const job = JSON.parse(await readFile(join(this.dir, file), 'utf8')) as ResearchJob;
        if (job.mode === 'live' && typeof job.placeKey === 'string' && Array.isArray(job.cards)) {
          this.entries.set(job.placeKey, job);
        }
      } catch {
        console.warn(`[cache] skipped unreadable file ${file}`);
      }
    }
    return this.entries.size;
  }

  get(placeKey: string): ResearchJob | undefined {
    return this.entries.get(placeKey);
  }

  async set(job: ResearchJob): Promise<void> {
    if (job.mode !== 'live' || (job.status !== 'complete' && job.status !== 'partial')) return;
    this.entries.set(job.placeKey, job);
    if (!this.dir) return;
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(join(this.dir, `${fileSafe(job.placeKey)}.json`), `${JSON.stringify(job, null, 2)}\n`);
    } catch (err) {
      console.warn(`[cache] could not write ${job.placeKey}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

function fileSafe(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 120) || 'place';
}
