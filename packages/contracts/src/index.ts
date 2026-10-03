// Shared contracts for Around the Web Maps.
// Owner: Person 2. Announce changes to the team before merging; additive changes only.
// Types only, so importing this package has no runtime cost.

// ---------- Person 1 <-> Person 2: HTTP ----------

export type Place = {
  key: string; // verified demo slug or normalized identity, not map center
  name: string;
  address: string;
  city: string;
  mapsUrl: string;
  lat?: number;
  lng?: number;
};

export type Evidence = {
  id: string;
  sourceUrl: string;
  kind: 'caption' | 'location_tag' | 'article_text' | 'search_snippet';
  text: string;
};

export type Metrics = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
};

export type Candidate = {
  id: string;
  type: 'video' | 'article';
  source: 'tiktok' | 'web';
  title: string;
  url: string;
  author: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  metrics: Metrics;
  evidence: Evidence[];
};

export type Verdict = 'keep' | 'reject' | 'uncertain';

export type Decision = {
  candidateId: string;
  verdict: Verdict;
  reason: string;
  evidenceIds: string[];
};

export type SourceError = { source: string; code: string; message: string };

export type JobStatus = 'queued' | 'running' | 'complete' | 'partial' | 'failed';
export type JobStage = 'queued' | 'searching' | 'checking' | 'done';
export type JobMode = 'live' | 'cache' | 'demo';

export type ResearchCard = Candidate & { why: string; evidenceIds: string[] };

export type ResearchJob = {
  jobId: string;
  placeKey: string;
  status: JobStatus;
  stage: JobStage;
  mode: JobMode;
  generatedAt: string | null;
  events: { at: string; message: string }[]; // actual tool milestones
  summary: { checked: number; kept: number; rejected: number; uncertain: number };
  cards: ResearchCard[]; // kept candidates, best first
  decisions: Decision[];
  sourceErrors: SourceError[];
};

/** POST /api/research body. `refresh: true` skips the cache (additive, optional). */
export type StartResearchRequest = { place: Place; refresh?: boolean };

/** POST /api/research response, HTTP 202. */
export type StartResearchResponse = { jobId: string; placeKey: string };

/** Error body for any 4xx/5xx response. */
export type ApiError = { error: { code: string; message: string } };

// ---------- Person 2 <-> Person 3: source module ----------

export type ToolContext = { deadlineAt: number; signal: AbortSignal };
export type SearchInput = { place: Place; query: string; limit: number };
export type SourceResult<T> = { items: T[]; errors: SourceError[] };

export interface SourceTools {
  searchSocial(input: SearchInput, ctx: ToolContext): Promise<SourceResult<Candidate>>;
  searchArticles(input: SearchInput, ctx: ToolContext): Promise<SourceResult<Candidate>>;
  readArticle(
    input: { candidateId: string; url: string },
    ctx: ToolContext,
  ): Promise<SourceResult<Candidate>>;
}
