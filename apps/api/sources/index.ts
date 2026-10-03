import { ACTORS, createActorRunner } from './apify.ts';
import type { ActorRunner, ApifyOptions } from './apify.ts';
import { extractArticle, loadArticlePage, validateArticleUrl } from './article.ts';
import type { PageLoader } from './article.ts';
import { checkContext, sourceError, SourceFailure } from './errors.ts';
import { canonicalUrl, normalizeSearchResult, normalizeTikTok, record, unique } from './normalize.ts';
import type { Candidate, SearchInput, SourceResult, SourceTools, ToolContext } from './types.ts';
export type * from './types.ts';

export type SourceOptions = ApifyOptions & { runner?: ActorRunner; pageLoader?: PageLoader; cacheTtlMs?: number };
export function createSourceTools(options: SourceOptions = {}): SourceTools {
  const run = options.runner ?? createActorRunner(options);
  const load = options.pageLoader ?? loadArticlePage;
  const ttl = options.cacheTtlMs ?? 5 * 60 * 1000;
  const cache = new Map<string, { expires: number; value: SourceResult<Candidate> }>();
  const knownArticles = new Map<string, Candidate>();

  async function execute(source: string, key: string, ctx: ToolContext, action: () => Promise<SourceResult<Candidate>>) {
    try {
      checkContext(ctx);
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) return structuredClone(cached.value);
      cache.delete(key);
      const result = await action();
      checkContext(ctx);
      if (!result.errors.length) {
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: Date.now() + ttl, value: structuredClone(result) });
      }
      return result;
    } catch (error) { return { items: [], errors: [sourceError(source, error, ctx)] }; }
  }
  function searchInput(input: SearchInput) {
    if (!input.place?.key || !input.place.name || !input.place.city || !input.query?.trim() || !Number.isFinite(input.limit) || input.limit < 1) {
      throw new SourceFailure('INVALID_INPUT', 'Search requires a place, query, and positive result limit.');
    }
    const query = input.query.replace(/[\r\n]+/g, ' ').trim();
    if (query.length > 300) throw new SourceFailure('INVALID_INPUT', 'Search query exceeds 300 characters.');
    return { query, limit: Math.min(20, Math.floor(input.limit)) };
  }
  function remember(items: Candidate[]) {
    for (const item of items) {
      if (knownArticles.size >= 500) knownArticles.delete(knownArticles.keys().next().value!);
      knownArticles.set(item.id, item);
    }
  }
  return {
    async searchSocial(input, ctx) {
      return execute('tiktok', `social:${JSON.stringify(input)}`, ctx, async () => {
        const { query, limit } = searchInput(input);
        const raw = await run(ACTORS.social, {
          searchQueries: [query], searchSection: '/video', resultsPerPage: limit,
          shouldDownloadVideos: false, shouldDownloadCovers: false,
          shouldDownloadSlideshowImages: false, shouldDownloadSubtitles: false,
          scrapeRelatedVideos: false, scrapeAdditionalAuthorMeta: false,
          maxFollowersPerProfile: 0, maxFollowingPerProfile: 0,
        }, limit, ctx);
        const fetchedAt = new Date().toISOString();
        const items = unique(raw.map(x => normalizeTikTok(x, fetchedAt)).filter((x): x is Candidate => x !== null)).slice(0, limit);
        const invalid = raw.filter(x => !normalizeTikTok(x, fetchedAt)).length;
        return { items, errors: invalid ? [{ source: 'tiktok', code: 'INVALID_ITEMS', message: `${invalid} source records lacked a usable TikTok post URL.` }] : [] };
      });
    },
    async searchArticles(input, ctx) {
      const result = await execute('web', `search:${JSON.stringify(input)}`, ctx, async () => {
        const { query, limit } = searchInput(input);
        const pages = await run(ACTORS.articles, { queries: query, maxPagesPerQuery: 1, countryCode: 'se', languageCode: 'en' }, 1, ctx);
        const fetchedAt = new Date().toISOString();
        const organic: unknown[] = [];
        let malformed = false;
        for (const page of pages) {
          const data = record(page);
          if (!Array.isArray(data.organicResults)) { malformed = true; continue; }
          organic.push(...data.organicResults);
        }
        const items = unique(organic.map(x => normalizeSearchResult(x, fetchedAt)).filter((x): x is Candidate => x !== null)).slice(0, limit);
        return { items, errors: malformed ? [{ source: 'web', code: 'INVALID_ITEMS', message: 'A search response did not contain organic results.' }] : [] };
      });
      remember(result.items);
      return result;
    },
    async readArticle(input, ctx) {
      return execute('web', `read:${JSON.stringify(input)}`, ctx, async () => {
        const url = validateArticleUrl(input.url);
        const known = knownArticles.get(input.candidateId);
        if (!known || canonicalUrl(known.url) !== canonicalUrl(url.href)) {
          throw new SourceFailure('UNKNOWN_ARTICLE', 'Read only an article ID and URL returned by this source instance.');
        }
        const candidate = extractArticle(await load(url.href, ctx), input.candidateId);
        candidate.evidence = [...known.evidence, ...candidate.evidence];
        return { items: [candidate], errors: [] };
      });
    },
  };
}
