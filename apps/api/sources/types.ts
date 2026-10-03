/** Re-export Person 2's shared types; relative path keeps standalone source tests dependency-free. */
export type { Place, Evidence, Candidate, SourceError, SourceResult, ToolContext, SearchInput, SourceTools }
  from '../../../packages/contracts/src/index.ts';

export type RunObservation = {
  actor: string; runId: string | null; status: string; elapsedMs: number;
  usageTotalUsd: number | null; // Apify-reported usage, not an estimate of total billing.
};
