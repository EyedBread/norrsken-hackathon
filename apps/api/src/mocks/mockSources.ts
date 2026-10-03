import type { Candidate, Evidence, Place, SourceResult, SourceTools, ToolContext } from '@atw/contracts';

// Development-only fake sources. Every job that uses them is labelled mode "demo"
// and is never written to the result cache. Titles carry a [Mock] prefix as well.
//
// The fixtures are built from whatever place is requested, so the extension can be
// developed against any venue. They deliberately contain:
//   tt1  caption + location tag with this venue's address   -> should be kept
//   tt2  same name, explicitly a different branch/address    -> should be rejected
//   tt3  name and city hashtag only                          -> should be uncertain
//   tt4  only returned when the query names the venue's street (tests query refinement)
//   a1   review snippet with the address; readArticle returns full text
//   a2   article about the other branch

export type MockFailure = 'social' | 'social-timeout' | 'articles' | 'read';

export function createMockSources(opts: { fail?: string | null; delayMs?: number } = {}): SourceTools {
  const fail = (opts.fail ?? null) as MockFailure | null;
  const delayMs = opts.delayMs ?? 150;

  return {
    async searchSocial(input, ctx) {
      if (fail === 'social-timeout') await waitForAbort(ctx);
      await sleep(delayMs, ctx);
      if (fail === 'social') return failure('tiktok', 'mock_failure', 'Injected TikTok failure (MOCK_FAIL=social).');
      const f = fixtures(input.place);
      const items = [f.tt1, f.tt2, f.tt3];
      if (f.street && input.query.toLowerCase().includes(f.street.toLowerCase())) items.push(f.tt4);
      return { items: items.slice(0, input.limit), errors: [] };
    },

    async searchArticles(input, ctx) {
      await sleep(delayMs, ctx);
      if (fail === 'articles') return failure('web_search', 'mock_failure', 'Injected article search failure (MOCK_FAIL=articles).');
      const f = fixtures(input.place);
      return { items: [f.a1, f.a2].slice(0, input.limit), errors: [] };
    },

    async readArticle(input, ctx) {
      await sleep(delayMs, ctx);
      if (fail === 'read') return failure('web_article', 'mock_failure', 'Injected article read failure (MOCK_FAIL=read).');
      const [, key] = input.candidateId.split(':');
      const place = mockPlaceIndex.get(key ?? '');
      if (!place) return failure('web_article', 'not_found', 'Unknown mock article.');
      const f = fixtures(place);
      const base = [f.a1, f.a2].find((c) => c.id === input.candidateId);
      if (!base) return failure('web_article', 'not_found', 'Unknown mock article.');
      const fullText =
        base === f.a1
          ? `${place.name} sits at ${place.address} in ${place.city}. We visited twice. The cardamom buns are excellent and the staff were friendly. Expect a queue on weekends.`
          : `${place.name} has opened a second location at ${f.otherAddress}. The original venue is unchanged.`;
      const evidence: Evidence = { id: `${base.id}:text`, sourceUrl: base.url, kind: 'article_text', text: fullText };
      return { items: [{ ...base, fetchedAt: new Date().toISOString(), evidence: [...base.evidence, evidence] }], errors: [] };
    },
  };
}

const mockPlaceIndex = new Map<string, Place>();

function fixtures(place: Place) {
  const key = place.key.replace(/[^a-z0-9-]/gi, '_');
  mockPlaceIndex.set(key, place);
  const street = place.address.match(/^([^\d,]+?)\s*\d/)?.[1]?.trim() ?? null;
  const otherAddress = /odengatan/i.test(place.address) ? 'Hornsgatan 50, Södermalm' : 'Odengatan 12, Vasastan';
  const id = (suffix: string) => `mock:${key}:${suffix}`;
  const url = (suffix: string) => `https://example.com/mock/${key}/${suffix}`;
  const now = new Date().toISOString();

  const video = (suffix: string, caption: string, extra: Evidence[] = [], metrics: Partial<Candidate['metrics']> = {}): Candidate => ({
    id: id(suffix),
    type: 'video',
    source: 'tiktok',
    title: `[Mock] ${caption.slice(0, 80)}`,
    url: url(suffix),
    author: `@mock_${suffix}`,
    thumbnailUrl: null,
    publishedAt: '2026-08-14T10:00:00.000Z',
    fetchedAt: now,
    metrics: { views: null, likes: null, comments: null, shares: null, ...metrics },
    evidence: [{ id: `${id(suffix)}:caption`, sourceUrl: url(suffix), kind: 'caption', text: caption }, ...extra],
  });

  const article = (suffix: string, title: string, snippet: string): Candidate => ({
    id: id(suffix),
    type: 'article',
    source: 'web',
    title: `[Mock] ${title}`,
    url: url(suffix),
    author: 'Mock Gazette',
    thumbnailUrl: null,
    publishedAt: '2026-06-02T08:00:00.000Z',
    fetchedAt: now,
    metrics: { views: null, likes: null, comments: null, shares: null },
    evidence: [{ id: `${id(suffix)}:snippet`, sourceUrl: url(suffix), kind: 'search_snippet', text: snippet }],
  });

  return {
    street,
    otherAddress,
    tt1: video(
      'tt1',
      `Best fika in town at ${place.name}, ${place.address} ☕ #${place.city.toLowerCase()}`,
      [{ id: `${id('tt1')}:loc`, sourceUrl: url('tt1'), kind: 'location_tag', text: `${place.name}, ${place.address}` }],
      { views: 48_200, likes: 3_100, comments: 85, shares: 40 },
    ),
    tt2: video('tt2', `${place.name} at ${otherAddress} is so cozy! Their newest branch.`, [], { views: 12_000, likes: 900 }),
    tt3: video('tt3', `${place.name} vibes #${place.city.toLowerCase()} #fika`, [], { views: 3_400 }),
    tt4: video(
      'tt4',
      `Lunch at ${place.name} on ${street ?? 'the main street'}. The cardamom bun lives up to the hype`,
      [{ id: `${id('tt4')}:loc`, sourceUrl: url('tt4'), kind: 'location_tag', text: `${place.name}, ${place.address}` }],
      { views: 9_800, likes: 610, comments: 22, shares: null },
    ),
    a1: article('a1', `Review: ${place.name}`, `Review: ${place.name} at ${place.address} serves some of the best buns in ${place.city}...`),
    a2: article('a2', `${place.name} opens a second location`, `${place.name} opens second location at ${otherAddress}...`),
  };
}

function failure(source: string, code: string, message: string): SourceResult<Candidate> {
  return { items: [], errors: [{ source, code, message }] };
}

function sleep(ms: number, ctx: ToolContext): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    ctx.signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    }, { once: true });
  });
}

function waitForAbort(ctx: ToolContext): Promise<never> {
  return new Promise((_, reject) => {
    if (ctx.signal.aborted) reject(new Error('aborted'));
    ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}
