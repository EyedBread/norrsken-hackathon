import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createSourceTools } from './index.ts';
import { extractArticle, loadArticlePage } from './article.ts';
import type { Place, RunObservation, SourceResult, Candidate } from './types.ts';

const mode = process.argv[2] ?? 'all';
const key = process.argv[3] ?? 'vete-katten-kungsgatan';
const queryOverride = process.argv[4];
const limit = Math.max(1, Math.min(10, Number(process.argv[5] ?? 3)));
if (!['all', 'social', 'articles', 'seed'].includes(mode)) throw new Error('Usage: node smoke.ts [all|social|articles|seed] [venue-key]');
const root = new URL('../../../', import.meta.url);
const venues = JSON.parse(await readFile(new URL('fixtures/venues.json', root), 'utf8')) as (Place & { queries: string[]; articleSeedUrl: string })[];
const place = venues.find(v => v.key === key);
if (!place) throw new Error('Unknown venue key. See fixtures/venues.json.');
const observations: RunObservation[] = [];
const tools = createSourceTools({ onRun: run => observations.push(run), timeoutMs: Number(process.env.SOURCE_TIMEOUT_MS ?? 60000) });
const ctx = () => ({ signal: new AbortController().signal, deadlineAt: Date.now() + 65000 });
const started = Date.now();
const results: Record<string, SourceResult<Candidate>> = {};
if (mode === 'social' || mode === 'all') results.social = await tools.searchSocial({ place, query: queryOverride ?? place.queries[0] ?? `${place.name} ${place.city}`, limit }, ctx());
if (mode === 'articles' || mode === 'all') {
  results.search = await tools.searchArticles({ place, query: queryOverride ?? `${place.name} ${place.city} cafe travel blog -site:tripadvisor.com -site:yelp.com`, limit }, ctx());
  const first = results.search.items[0];
  if (first) results.article = await tools.readArticle({ candidateId: first.id, url: first.url }, ctx());
}
if (mode === 'seed') {
  try {
    results.article = { items: [extractArticle(await loadArticlePage(place.articleSeedUrl, ctx()))], errors: [] };
  } catch (error) {
    // Source URLs here are manually verified public seeds, not arbitrary model inputs.
    const { sourceError } = await import('./errors.ts');
    results.article = { items: [], errors: [sourceError('web', error, ctx())] };
  }
}
const output = { mode: 'live-source-capture', discovery: mode === 'seed' ? 'curated-public-url' : 'live-search',
  venueKey: key, queryOverride: queryOverride ?? null, capturedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
  observations, results };
const folder = new URL('fixtures/sources/live/', root);
await mkdir(folder, { recursive: true });
const path = new URL(`${key}-${mode}.json`, folder);
await writeFile(path, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ venue: key, mode, elapsedMs: output.elapsedMs,
  results: Object.fromEntries(Object.entries(results).map(([name, r]) => [name, { items: r.items.length, errors: r.errors }])),
  observations, saved: path.pathname }, null, 2));
if (Object.values(results).some(r => r.errors.length)) process.exitCode = 1;
