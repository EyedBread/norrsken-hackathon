# Person 1 — Extension and complete UI

Standalone handoff for Around the Web Maps. Target: approximately four hours.
Suggested branch: `codex/extension`. This is a build specification, not completed functionality.

Get a fixture card into Maps first. Own the full frontend so no other teammate needs to edit the panel.

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
| 0:00–0:20 | Shared scaffold + fixture UI contract |
| 0:20–1:00 | Maps button + full card UI against fixture |
| 1:00–1:30 | Connect to backend, drawer/side-panel decision |
| 1:30–2:15 | Venue switching, error/empty/cache states |
| 2:15–3:00 | Visual polish, thumbnail/link fallback |
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
