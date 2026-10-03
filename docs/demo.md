# Person 3 demo and backend handoff

## What is ready

Import `createSourceTools` from `apps/api/sources/index.ts`. The three agreed methods
are implemented and tested independently of Gemini and the extension. Root build
files and Person 2's shared contract package have not been changed.

Final demo venues are in `fixtures/venues.json`:

| Venue | Exact branch | Preferred real TikTok IDs |
| --- | --- | --- |
| Vete-Katten | Kungsgatan 55 | `7648748209669491982`, `7515060034896809258` |
| Café Pascal Vasastan | Norrtullsgatan 4 | `7558092215805938966`, `7527301939311267094` |
| Stora Bageriet Östermalm | Sibyllegatan 2 | `7381445686920793376`, `7593065151616552194` |

Each pair has caption or location metadata supporting the specified branch. This
is evidence-based manual screening, not a claim that video frames were inspected.
For each venue, a Visit Stockholm article was fetched and its visible text includes
the street address. Real captures are in `fixtures/sources/live/`.

Svedjan Bageri was evaluated and dropped: two searches returned mostly unrelated
bakeries, leaving insufficient branch-specific social evidence. Its captures are
retained for diagnostics, not presented as a successful demo venue.

## Suggested 60-second demo

1. Open Café Pascal, Norrtullsgatan 4, in Maps and start research.
2. Show the post by `barn.vnligt.sthlm`: its caption and tag both give the address.
   Show source, publication date, and available engagement counts.
3. Show that the search also returned `patricpersson`'s post
   (`7622286293430521110`), tagged at Skånegatan 76. Gemini should reject that branch.
4. Show a city-only Pascal caption as uncertain instead of pretending it is verified.
5. Open an article source and switch to Vete-Katten to demonstrate place isolation.

Pitch: “We bring web videos and articles into Maps, and the agent checks whether
they refer to this exact venue.” The value is useful evidence, not the raw result count.

## Saved data for integration without live API latency

- `fixtures/sources/demo-candidates.json`: six real social candidates plus one real
  article per venue. Includes good, wrong-branch, and uncertain candidates for Gemini.
- `fixtures/sources/relevance-cases.json`: 13 manually labeled evaluation cases with
  reasons. Do not feed these expected verdicts into the live agent's prompt.
- `fixtures/sources/usage-report.json`: timestamped Apify usage metadata, including
  exploratory runs. Immediate run-completion cost readings can lag.
- Refined `*-articles.json`: real automatic article-search results and first-page
  reading outcome; `*-seed.json`: separately labeled curated article extraction.

Replay saved captures as cached data with their original timestamps. Do not animate
old tool calls as though they are happening live. Current image URLs may expire;
the extension must support text cards and source links when previews fail.

## Observed behavior

- Refined TikTok searches returned six candidates per venue in approximately 6–10 seconds.
- Automatic article search varied from approximately 11–26 seconds in these runs.
- Curated public article reads completed in under a second on this machine.
- First-result article extraction succeeded for Vete-Katten and Pascal. The first
  result for Stora was unreadable; article search still returned three candidates,
  and its curated Visit Stockholm article extracted successfully. Person 2 should
  try another returned URL or show an explicit snippet/link fallback after a read error.
- These are measured samples, not latency guarantees. Social retrieval and article
  discovery can run concurrently within the backend's shared deadline.

## First integration meeting

Integration check against Person 2's merged backend (2026-10-03): the existing live
loader imported `createSourceTools()` successfully; `/api/health` reported
`sources: "live"` on port 8787. Combined typecheck and all 22 API/source tests passed.
Two real research requests returned social and article candidates, but Gemini 3.8
Flash returned high-demand errors during both planning and final verification.
Those jobs were correctly marked partial/uncertain. See `api-integration*.json` in
the source fixtures for evidence. This validates live retrieval through the API,
not successful end-to-end Gemini ranking. Use `refresh: true` when retrying a cached
partial result after model recovery. Person 2 should consider avoiding final cache
entries when model verification fails and zero cards are produced.

Person 1: use the exact venue keys/addresses in `fixtures/venues.json`. Keep one owner
for the UI and root workspace configuration. The source package adds no runtime deps.

Person 2: instantiate one `createSourceTools` object, pass job deadlines/signals into
every method, and translate source failures into partial job state. Keep final result
caching and mode labels in the backend. The source types now re-export your existing
`packages/contracts/src/index.ts` definitions.

Use `apps/api/sources/README.md` for commands, error codes, caching, bounds, and
known limitations. The provider token is local and ignored; never pass it to clients.
