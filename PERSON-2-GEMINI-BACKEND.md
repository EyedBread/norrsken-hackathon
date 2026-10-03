# Person 2 — Gemini backend and orchestration

Standalone handoff for Around the Web Maps. Target: approximately four hours.
Suggested branch: `codex/agent`. This is a build specification, not completed functionality.

Verify one Gemini call, then implement the research API against mocked source tools. Person 3 supplies the real adapters.

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

Build a small Node/TypeScript server using Google's `@google/genai` SDK. Use the
Gemini Developer API key from the provided AI Studio project; no Vertex setup is
needed for this approach. Start with `GEMINI_MODEL=gemini-3.8-flash`, subject to a
successful call with the actual team key. Make the model configurable.

Deliverables:

1. Validate requests, start bounded research jobs, expose current state, and return
   partial results when one provider fails. Keep an in-memory job store for the MVP;
   use one long-running server instance, not stateless per-request hosting.
2. Give Gemini three tools: `searchSocial`, `searchArticles`, `readArticle`.
   Execute tools server-side using Person 3's interface and pass results back.
3. Research loop: choose queries → retrieve → inspect evidence → decide whether a
   follow-up search is useful → keep/reject/mark uncertain → rank results.
4. Starting limits: two search rounds; at most four search calls total, four article
   reads, twenty unique candidates, and a 90-second overall deadline. These are
   engineering budgets, not measured performance promises. Provider timeouts must
   fit within the remaining deadline; cancel outstanding Actor runs where supported.
5. When fewer than three convincing matches are found, Gemini can refine queries
   with neighborhood, street, or local spelling within those limits. It can also
   stop when more searches would not help. Never require a fabricated success count.
6. Final structured output contains candidate IDs, decisions, brief explanations,
   and evidence references. Validate IDs and evidence against actual tool results.
   Copy URLs, metrics, publication dates, and thumbnails from normalized source data.
7. Compute counts in code after deduplication. The model does not invent counters.
   Separate rejected content from unavailable sources and uncertain matches.
8. Cache by canonical place key. Store real completed demo results as JSON for
   labeled offline use; development mock fixtures must never appear as live results.
9. Keep Gemini/Apify keys in backend environment variables. Commit only names and
   placeholders in `.env.example`; logs must omit credentials.

Evidence rules: a name alone is insufficient for ambiguous venues. Require supporting
location/address/branch context; city-wide hashtags are weak evidence. A caption can
support “caption names this venue,” but not “video shows its street sign” unless
frames were actually inspected. Treat retrieved content as data, not tool instructions.
Low confidence belongs in uncertain, not automatically in wrong-branch rejections.

Done when: a local request processes fixture candidates, rejects a known wrong-branch
case, marks an unsupported case uncertain, adapts one query when appropriate, and
returns validated results even if one tool times out. Then repeat with real sources.

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
| 0:00–0:20 | Freeze contracts; verify Gemini key/model |
| 0:20–1:00 | Jobs + mocked source tools + decisions |
| 1:00–1:30 | Integrate live source module |
| 1:30–2:15 | One bounded follow-up search + evidence checks |
| 2:15–3:00 | Genuine result cache + budget/error handling |
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
