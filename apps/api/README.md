# Around the Web API (Person 2)

Node/TypeScript server. Gemini plans the searches and checks the evidence, and the source adapters fetch the data.
Shared types live in `packages/contracts/src/index.ts`.

## Run

```sh
cd apps/api
npm install
cp .env.example .env        # add GEMINI_API_KEY
npm run smoke:gemini        # checks the key and model (plain call + one function call)
npm run dev                 # http://localhost:8787
npm test                    # offline tests, no key needed
```

`SOURCES=mock` (default) uses built-in fake data. Those jobs are labelled `mode: "demo"`, titles start with `[Mock]`, and they are never cached.
`SOURCES=live` loads Person 3's adapters and labels jobs `mode: "live"`.

Mock failure injection for UI work: `MOCK_FAIL=social | social-timeout | articles | read`.

## HTTP (for Person 1)

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/research` | Body `{ place: Place, refresh?: boolean }`. Returns 202 `{ jobId, placeKey }`. An identical running job is reused. A saved live result is returned as `mode: "cache"` unless `refresh: true`. |
| `GET` | `/api/research/:jobId` | Returns `ResearchJob`. Poll every 1 to 2 s until `stage === "done"`. |
| `GET` | `/api/health` | `{ ok, model, sources }` |

Errors are `{ error: { code, message } }` with status 400, 404, 413 or 500.

Status meaning
- `complete` all searches and checks finished
- `partial` results are usable but a source failed, timed out, or a budget cut the work short (see `sourceErrors`)
- `failed` unexpected server error

`cards` are kept results, best first. `decisions` lists every candidate (keep, then uncertain, then reject).
`summary` counts are computed by the server from `decisions`.

## Source adapters (for Person 3)

Create `apps/api/sources/index.ts` that exports

```ts
import type { SourceTools } from '@atw/contracts';
export function createSourceTools(): SourceTools | Promise<SourceTools>;
```

What the agent relies on
- Candidate and evidence IDs are stable and unique. Evidence IDs are what Gemini cites.
- `ctx.deadlineAt` and `ctx.signal` are honoured. The agent also enforces its own timeout and aborts the signal.
- Failures are returned in `errors`, not as empty results. Throwing is also handled.
- `readArticle` returns the same candidate ID with extra `article_text` evidence. The agent only ever passes URLs that a search returned.

## Agent limits

Set in `src/config.ts`: 2 search rounds, 4 search calls, 4 article reads, 20 candidates, 90 s deadline
(`RESEARCH_DEADLINE_MS`), with 20 s of it kept back for the final verification call.

What the server enforces regardless of what Gemini says
- Unknown candidate IDs are dropped. Evidence IDs must belong to that candidate.
- `keep` or `reject` without valid evidence becomes `uncertain`.
- Candidates Gemini skipped become `uncertain`.
- URLs, metrics, dates and thumbnails come from source data. Only `why` is model text.
- If Gemini planning fails, one default search per source still runs. If verification fails, everything is `uncertain` and the job is `partial`.

## Gemini busy errors

When Gemini answers "high demand" (503), rate limited (429) or another temporary error, each call is retried
up to 3 times with backoff (about 1 s, then 2 s). Then the next model in `GEMINI_FALLBACK_MODELS` is tried.
Bad keys and bad requests fail at once. Retries stop when the step's time budget runs out, and each retry
shows in the job's `events`, for example `Gemini high demand, retrying with gemini-3.8-flash (attempt 2)`.
`npm run smoke:gemini` checks the main model and every fallback model, without retries.

## Cache

Live `complete`/`partial` results are saved to `fixtures/research/live/<placeKey>.json` and loaded on start.
Commit these after real runs of the demo venues so the demo works offline.
