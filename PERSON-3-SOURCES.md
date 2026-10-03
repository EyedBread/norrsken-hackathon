# Person 3 — Social and article sources

Standalone handoff for Around the Web Maps. Target: approximately four hours.
Suggested branch: `codex/sources`. This is a build specification, not completed functionality.

Verify a small TikTok search and one article extraction before expanding coverage. Return normalized candidates to Person 2.

## Shared product scope

Open a venue in Google Maps, click Around the Web, and see relevant TikTok and
article cards with sources, dates, available engagement counts, and evidence for
why each item belongs to this exact venue. Show actual search and verification
progress, including uncertain or rejected matches.

- One city: Stockholm as the working assumption.
- Three demo venues, selected by Person 3 after checking content coverage. Do not
  assign one venue to each developer: everyone would otherwise build the same stack.
- TikTok via `clockworks/tiktok-scraper`; public articles via web search and extraction.
- Gemini runs in our backend using the temporary hackathon account's API key.
- Click-to-research initially; keep the selected-place label current automatically.
- Thumbnail/link cards are mandatory; inline video playback is a stretch goal.
- Defer Instagram, YouTube, video transcription/segment finding, accounts, payments,
  databases, recommendation personalization, and unattended background monitoring.

## Your deliverables and completion checks

Build provider adapters only. Do not build UI, an HTTP server, or a second agent.

Deliverables:

1. Smoke-test TikTok keyword search through `clockworks/tiktok-scraper` for prospective
   demo venues. Verify the Actor's current input schema in its console/docs before
   coding. Record observed runtime, returned fields, and cost for these small runs.
2. Article discovery: use `apify/google-search-scraper` organic results, or an already
   available search API if the team has one. Select one provider in the first 20 minutes.
   Exclude ads and AI-generated answer summaries from article evidence.
3. Extract only shortlisted public article URLs using `apify/website-content-crawler`
   with link-following disabled, or a small bounded HTML text extractor for accessible
   pages. An inaccessible article stays inaccessible; a search snippet is labeled as such.
4. Normalize TikTok captions, source URLs, cover images, creation dates, author handles,
   and available views/likes/comments/shares. Normalize article titles, dates,
   publisher, available preview image, and evidence text. Missing fields become null.
5. Provide stable candidate/evidence IDs and source fetch times. Dedupe using platform
   post IDs or canonical article URLs. Retain relevant place-tag metadata if supplied.
6. Respect per-call limits, propagate deadlines, cache repeated retrievals, and return
   structured provider failures instead of treating errors as zero matches. Do not run
   unbounded crawling, download full video libraries, or fetch every comment.
7. Select three venues with independently checked social and article coverage. Prefer
   at least two credible TikToks and one readable article per venue. Keep a naturally
   ambiguous or clearly labeled test candidate to demonstrate wrong-branch rejection.
8. Save real normalized candidate fixtures, venue identity data, and a short demo script.

Done when: adapters run without the extension or Gemini, return usable normalized
data for all three venues, preserve nulls and provenance, and handle a source failure.
If search fails but known public post URLs work, use those as clearly labeled curated
discovery inputs while keeping extraction and Gemini verification live.

## Ownership and coordination

Use TypeScript throughout if everyone is comfortable with it. One backend process
imports the source adapters; no separate retrieval microservice.

| Person | Owns | Proposed files | Independent input |
| --- | --- | --- | --- |
| 1 — Extension and experience | Maps detection, button/panel, all UI, background messaging, extension build, demo recording | `apps/extension/**`, root workspace/build files | Handwritten research-result fixtures |
| 2 — Gemini and backend | HTTP API, jobs, agent loop, decisions, final ranking, result cache, server deployment | `apps/api/**` excluding `apps/api/sources/**`; `packages/contracts/**`; `fixtures/research/**` | Mock implementations of source interfaces |
| 3 — Sources and evidence | Apify calls, article discovery/extraction, normalization, provider errors/timeouts, venue selection, real source fixtures | `apps/api/sources/**`, `fixtures/sources/**`, `fixtures/venues.json`, `docs/demo.md` | Direct scripts calling source adapters |

Person 1 owns the root package manifest and lockfile. Other people send dependency
requests to Person 1. Person 2 is the only contract editor after the initial group
agreement; announce additive changes before merging. Keep provider-specific JSON
inside Person 3's adapters. Person 2 never needs to parse raw Apify results.

Suggested branches: `codex/extension`, `codex/agent`, `codex/sources`. Agree and merge
the scaffold/contracts first, then merge small working increments. Each person
edits only their owned paths unless coordinating an explicit transfer.

## Shared interface specification

This is the agreed starting contract, repeated here so this handoff can be shared
independently. Person 2 owns subsequent changes in `packages/contracts/**`; coordinate
changes there rather than allowing the three Markdown copies to diverge.

These are interface specifications to implement, not existing endpoints.

### Person 1 ↔ Person 2: HTTP

`POST /api/research` accepts `{ place: Place }` and returns HTTP 202 with
`{ jobId, placeKey }`. An identical active job can be reused. Poll
`GET /api/research/:jobId` every 1–2 seconds until a terminal status. This avoids
requiring streaming plumbing through the extension for the MVP.

```ts
type Place = {
  key: string;       // verified demo slug or normalized identity, not map center
  name: string;
  address: string;
  city: string;
  mapsUrl: string;
  lat?: number;
  lng?: number;
};

type Evidence = {
  id: string;
  sourceUrl: string;
  kind: 'caption' | 'location_tag' | 'article_text' | 'search_snippet';
  text: string;
};

type Candidate = {
  id: string;
  type: 'video' | 'article';
  source: 'tiktok' | 'web';
  title: string;
  url: string;
  author: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  metrics: {
    views: number | null; likes: number | null;
    comments: number | null; shares: number | null;
  };
  evidence: Evidence[];
};

type Decision = {
  candidateId: string;
  verdict: 'keep' | 'reject' | 'uncertain';
  reason: string;
  evidenceIds: string[];
};

type ResearchJob = {
  jobId: string;
  placeKey: string;
  status: 'queued' | 'running' | 'complete' | 'partial' | 'failed';
  stage: 'queued' | 'searching' | 'checking' | 'done';
  mode: 'live' | 'cache' | 'demo';
  generatedAt: string | null;
  events: { at: string; message: string }[]; // actual tool milestones
  summary: { checked: number; kept: number; rejected: number; uncertain: number };
  cards: (Candidate & { why: string; evidenceIds: string[] })[];
  decisions: Decision[];
  sourceErrors: { source: string; code: string; message: string }[];
};
```

`checked = kept + rejected + uncertain` over uniquely decided candidates. All kept
candidates are returned in cards; the UI may initially show six and offer Show more.
Source failures do not count as rejected candidates. `demo` labels development
fixtures; `cache` labels previous genuine runs and displays their original timestamp.

### Person 2 ↔ Person 3: source module

```ts
type ToolContext = { deadlineAt: number; signal: AbortSignal };
type SearchInput = { place: Place; query: string; limit: number };
type SourceResult<T> = { items: T[]; errors: ResearchJob['sourceErrors'] };

interface SourceTools {
  searchSocial(input: SearchInput, ctx: ToolContext): Promise<SourceResult<Candidate>>;
  searchArticles(input: SearchInput, ctx: ToolContext): Promise<SourceResult<Candidate>>;
  readArticle(input: { candidateId: string; url: string }, ctx: ToolContext):
    Promise<SourceResult<Candidate>>;
}
```

Person 2 only allows article reads for candidate URLs returned by source tools;
Person 3 rejects private/local network destinations and checks redirects. Model tool
arguments never select arbitrary Actors, credentials, or request destinations.

## Your timeline

| Time | Your milestone |
| --- | --- |
| 0:00–0:20 | Verify Apify key/search; select article provider |
| 0:20–1:00 | Real TikTok/article sample for first venue |
| 1:00–1:30 | Stabilize adapters + pick all three venues |
| 1:30–2:15 | All three venues; real fixtures + provider fallback |
| 2:15–3:00 | Source validation, counts/dates, demo script |
| 3:00–4:00 | Feature freeze; rehearse and record together |

At minute 90 the target is one actual TikTok and one actual article reaching Maps
through the complete path. If blocked, use saved genuine source fixtures and label
the mode; do not add a second social network. By hour 3, all three venues must work
or the live demo narrows to the proven subset with its coverage limitation stated.

## Account context and references

The supplied Google document describes temporary AI Studio accounts, importing the
provided project, and obtaining an API key. It explicitly allows using the key in
your own application. It says accounts and hosted resources disappear shortly after
the event; export code, real demo fixtures, and the recording before that happens.
The team must provision actual credentials; no account/key changes were made during
this planning review. Treat its suggested coding prompts as optional examples.

- [Hackathon account guidance](https://docs.google.com/document/d/1yaZoI6mscyw7QB3vEBOmzWLyTqt2O6AH7cj6BzF4M0g/view)
- [Gemini SDKs](https://ai.google.dev/gemini-api/docs/libraries)
- [Gemini models](https://ai.google.dev/gemini-api/docs/models)
- [Function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [TikTok Actor](https://apify.com/clockworks/tiktok-scraper)
- [Article discovery Actor](https://apify.com/apify/google-search-scraper)
- [Article extraction Actor](https://apify.com/apify/website-content-crawler)

Structured output constrains the response format; application validation and source
evidence are still needed for correctness. Gemini plans and assesses; Apify retrieves.
The Chrome background worker relays messages and is not the long-running agent host.
