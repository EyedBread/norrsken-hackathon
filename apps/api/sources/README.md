# Person 3 source adapters

Implements the handoff's `SourceTools` interface: TikTok search through Apify,
organic article discovery through Apify, and bounded HTML article extraction.
No HTTP server, Gemini agent, UI, runtime dependencies, or root workspace changes.

## Person 2 integration

The merged backend's `src/sources.ts` loads this module without any loader changes.
Set `SOURCES=live` and `APIFY_TOKEN` in the ignored `apps/api/.env`, supply
`GEMINI_API_KEY` through the environment or that same file, then run `npm start` from
`apps/api`. `GET http://localhost:8787/api/health` should report `sources: "live"`.
The standalone `sources/.env` is for the smoke CLI; the server does not load it.

Use Node 22.18+ (tested on Node 26), or compile the TypeScript in your own backend.
Keep one source instance alive across a job's search and article-read calls.

```ts
import { createSourceTools } from './sources/index.ts';

const sources = createSourceTools({ token: process.env.APIFY_TOKEN });
const context = {
  deadlineAt: Date.now() + 90_000,
  signal: jobAbortController.signal,
};
const found = await sources.searchSocial({
  place,
  query: `${place.name} ${place.address}`,
  limit: 6,
}, context);

const articles = await sources.searchArticles({
  place,
  query: `${place.name} ${place.city} cafe travel blog`,
  limit: 4,
}, context);
if (articles.items[0]) {
  const item = articles.items[0];
  const read = await sources.readArticle({ candidateId: item.id, url: item.url }, context);
}
```

`types.ts` re-exports Person 2's types from `packages/contracts/src/index.ts`.
There is no duplicate contract definition. Public function names and result shapes follow the agreed handoff.
The normalized `author` is a creator/byline when available. Derive the publisher's
domain from `url`; the frozen Candidate contract has no separate publisher field.

All operations return `{ items, errors }`. Errors include `MISSING_CREDENTIALS`,
`AUTH_FAILED`, `RATE_LIMITED`, `CREDIT_REQUIRED`, `TIMEOUT`, `ABORTED`, `INVALID_ITEMS`,
`ARTICLE_UNREADABLE`, `UNSAFE_URL`, and `UNKNOWN_ARTICLE`. A failed source is not an
empty successful search, and partial usable records are preserved. Do not convert
missing metrics into zero. Counts and dates come from providers, not a model.

Read requests must use an article ID/URL previously discovered by that instance.
IDs stay stable when reading redirects; evidence includes the final fetched URL.
Search snippets stay explicitly labeled `search_snippet` and are never upgraded
to `article_text` unless a real page was fetched and read.

## Run locally

From the repository root:

```sh
node --test apps/api/sources/test/*.test.ts

# Copy .env.example to .env and set your token locally; this directory ignores .env.
node --env-file=apps/api/sources/.env apps/api/sources/smoke.ts social cafe-pascal-vasastan 'Cafe Pascal Norrtullsgatan' 6
node --env-file=apps/api/sources/.env apps/api/sources/smoke.ts articles cafe-pascal-vasastan

# No Apify or Gemini key needed for curated public article seeds.
node apps/api/sources/smoke.ts seed cafe-pascal-vasastan
```

CLI modes: `all`, `social`, `articles`, `seed`. Arguments after mode are venue key,
optional query override, optional limit (maximum 10). `all` runs social then search
then one article read; production can parallelize independent searches against a
shared job deadline. CLI runs save fixtures and exit nonzero for any source error.
Live Actor runs consume the account's Apify credits; ordinary tests do not.

## Retrieval details and bounds

- `clockworks/tiktok-scraper`: `searchQueries`, `searchSection: '/video'`,
  `resultsPerPage`; disables media downloads and extra profile/related-video work.
- `apify/google-search-scraper`: one query, one results page, Sweden country context,
  English interface; consumes only `organicResults`. Discards social links and
  TripAdvisor/Yelp directory results. Caller chooses query content/language.
- The adapter caps social results at 20. Article discovery is limited to one SERP,
  typically around ten results before filtering, even if a higher limit is requested.
- Actor calls use a 60-second default timeout, shortened by caller deadline. Known
  active runs are aborted on cancellation, with at most two seconds of cleanup.
  If a start response is lost before the run ID arrives, the server-side Actor
  timeout still bounds its lifetime. No blind retries of charged start requests.
- Completed error-free results are cached for five minutes, maximum 100 entries.
  Values are cloned so callers cannot corrupt the cache. Their original `fetchedAt`
  remains intact. Backend owns research-job deduplication and final result caching;
  concurrent duplicate calls here are not coalesced.
- Up to 500 discovered article identities are retained. Very old evicted identities
  need to be searched again before reading. No persistent database is required.
- Direct article reads: 15 seconds, four redirects, two MiB response, 16,000 text
  characters, public HTTP(S) destinations on standard ports. Every redirect checks
  DNS and pins the connection to a checked address to prevent DNS rebinding.
- Scripts are never executed. Removes navigation/scripts/forms, prefers article
  text then main/body, and extracts Open Graph preview/byline/date when present.
  This is intentionally a small reader; JavaScript-only, blocked, compressed-only,
  or malformed pages can fail explicitly. Link/snippet fallback is the caller's choice.

## Evidence and fixture boundaries

These adapters retrieve candidates; they do not decide venue relevance. TikTok
location tags can contradict captions, and a city tag is not a branch address.
Preserve both so Gemini can mark uncertainty. No video frames were analyzed, no
transcripts generated, and no video segment timestamps are promised.

`fixtures/sources/demo-candidates.json` holds real historical normalized candidates
for the three selected venues. `relevance-cases.json` contains manual expectations
for Person 2 to evaluate, based on captions/location tags only. They are neither
model output nor visual verification. Captured article text is publisher material:
show a short attributed preview and a link, not a full reprint.

`fixtures/sources/live/` contains capture provenance, runtimes, and source errors.
Files ending in `-all` are the initial exploratory runs and include older directory
results. Refined `-social` and `-articles` files are preferred for the final demo.
`-seed` identifies manually selected public URLs; it is not automatic discovery.
Svedjan captures remain as a documented failed venue-selection experiment.

Apify `usageTotalUsd` can lag immediately after completion. `onRun` is operational
telemetry with a provisional usage value; do not interpret an immediate zero as a
free run. The saved usage report reads run metadata again after completion and gives
a timestamped snapshot, not a price guarantee.

Thumbnails are remote URLs and may expire. UI should fall back to text/source links.
Tokens stay in environment variables and are never embedded in source URLs or logs.

## Provider references

- https://apify.com/clockworks/tiktok-scraper/input-schema
- https://apify.com/apify/google-search-scraper/input-schema
- https://docs.apify.com/api/v2/actors-runs-post
- https://docs.apify.com/api/v2/dataset-items-get

Actor schemas were checked on 2026-10-03 and validated by live runs. Root dependency
and shared-contract changes remain with Persons 1 and 2 respectively.
