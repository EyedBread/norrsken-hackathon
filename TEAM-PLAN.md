# Around the Web Maps — three-person handoff

Planning date: 2026-10-03. Target: approximately four hours, three developers.

This is a proposed build plan, not a record of implemented or tested functionality.
The original Downloads plan was reviewed without modifying it. The team selected
social content as core: one Apify social source plus articles, with YouTube deferred.

## Product and scope

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

## Ownership and integration rules

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

## Handoff 1 — extension and complete UI

Build a Manifest V3 extension that detects the active venue, mounts an isolated
Shadow DOM drawer, starts research, polls job state, and renders cards and evidence.

Deliverables:

1. Read visible venue name and address plus current Maps URL. Coordinates are
   optional; map-camera coordinates must not be mistaken for venue coordinates.
2. Use URL-change detection plus a debounced observer for relevant DOM changes.
   Avoid depending on a single obfuscated CSS class. Recognize no selected venue.
3. For the three demo venues, allow an explicit fixture mapping to their verified
   addresses. Outside that mapping, show a correction field if identity is unclear.
4. One owner-controlled drawer with close/reopen behavior and content filters.
5. Requests go through the extension background context to our backend. No Gemini
   or Apify tokens in extension code, browser storage, or frontend environment files.
6. Render idle, queued, searching, checking, complete, partial, empty, and error states.
   No invented progress messages or fake real-time counters.
7. On a place change, clear the previous place's results and stop its polling. Match
   every result to both the active place key and current job ID before rendering.
8. Thumbnail failure becomes a text card. Every card opens its original source URL.
   Display null metrics as unavailable, not zero. Label cached results and fetch time.

Done when: switch A → B → A without refreshing; no duplicate drawers or wrong-place
results; loading/error/empty fixtures work; there is no API key in the built bundle.

Fallback decision at minute 60: if the drawer cannot survive normal Maps navigation,
reuse the same UI in Chrome's side panel, opened by a user click. Keep place detection.

## Handoff 2 — Gemini backend and orchestration

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

## Handoff 3 — social/article retrieval and evidence

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

## Interfaces to freeze in the first 20 minutes

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

## Four-hour schedule and gates

| Time | Person 1 | Person 2 | Person 3 |
| --- | --- | --- | --- |
| 0:00–0:20 | Shared scaffold + fixture UI contract | Freeze contracts; verify Gemini key/model | Verify Apify key/search; select article provider |
| 0:20–1:00 | Maps button + full card UI against fixture | Jobs + mocked source tools + decisions | Real TikTok/article sample for first venue |
| 1:00–1:30 | Connect to backend, drawer/side-panel decision | Integrate live source module | Stabilize adapters + pick all three venues |
| 1:30–2:15 | Venue switching, error/empty/cache states | One bounded follow-up search + evidence checks | All three venues; real fixtures + provider fallback |
| 2:15–3:00 | Visual polish, thumbnail/link fallback | Genuine result cache + budget/error handling | Source validation, counts/dates, demo script |
| 3:00–4:00 | Feature freeze; rehearse and record together | Feature freeze; rehearse and record together | Feature freeze; rehearse and record together |

At minute 90 the target is one actual TikTok and one actual article reaching Maps
through the complete path. If blocked, use saved genuine source fixtures and label
the mode; do not add a second social network. By hour 3, all three venues must work
or the live demo narrows to the proven subset with its coverage limitation stated.

## Assessment of the original plan

Keep its four-feature scope, fixture-first development, early fallback, and rehearsal.
Change its role split: its agent developer owns too much, while extension/UI work
overlaps. Move all retrieval to Person 3 and all UI to Person 1.

Replace fixed three-query filtering with one bounded evidence-driven follow-up.
Require evidence for match explanations; the sample street-sign claim is unsupported
without visual inspection. Use visible address/verified fixture identities rather
than assuming URL coordinates identify the selected venue. Cache is Person 2's
responsibility; source fixtures belong to Person 3.

The original 2022 statistic is not verified in this review; omit it from the pitch
unless someone checks the original source and its population/context. Venue-owner
reports are a possible business hypothesis, not validated demand or an MVP feature.

Suggested pitch: “Maps tells you where a place is. We bring the web's videos and
articles into the decision, and our agent checks whether they refer to this exact
venue.” Demonstrate a useful card and a real rejected or uncertain match.

## Gemini account and references

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
