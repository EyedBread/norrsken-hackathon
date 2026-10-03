import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { boundedSignal, SourceFailure } from './errors.ts';
import { articleId, emptyMetrics, evidence, publicUrl, timestamp } from './normalize.ts';
import type { Candidate, ToolContext } from './types.ts';

const blocked = new BlockList();
for (const [network, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, bits, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
blocked.addSubnet('3fff::', 20, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export function validateArticleUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new SourceFailure('INVALID_URL', 'Article URL is invalid.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))
    || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || !host.includes('.') && !isIP(host)
    || isIP(host) && !isPublicAddress(host)) {
    throw new SourceFailure('UNSAFE_URL', 'Article URL must point to a public HTTP(S) website.');
  }
  url.hash = '';
  return url;
}

export type Resolve = (hostname: string) => Promise<{ address: string; family: number }[]>;
/** Every redirect is checked; connections are pinned to the checked DNS address. */
export async function resolvePublic(url: URL, resolve: Resolve = host => lookup(host, { all: true })) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
  if (!addresses.length || addresses.some(x => !isPublicAddress(x.address))) {
    throw new SourceFailure('UNSAFE_URL', 'Article hostname resolved to a non-public address.');
  }
  return addresses[0]!;
}

export type Page = { url: string; html: string };
export type PageLoader = (url: string, ctx: ToolContext) => Promise<Page>;
export const loadArticlePage: PageLoader = async (input, ctx) => {
  const signal = boundedSignal(ctx, 15000);
  let url = validateArticleUrl(input);
  try {
    for (let hop = 0; hop <= 4; hop++) {
      // DNS promises cannot be cancelled; race their result against the operation signal.
      const target = await new Promise<{ address: string; family: number }>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
        resolvePublic(url).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
      });
      signal.throwIfAborted();
      const page = await new Promise<{ status: number; location?: string; html: string }>((resolve, reject) => {
        const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
        const req = request(url, {
          signal,
          // Node can request all addresses. Return only the already-validated address.
          lookup: (_hostname: string, options: any, callback: any) => {
            if (options?.all) callback(null, [target]);
            else callback(null, target.address, target.family);
          },
          headers: { 'User-Agent': 'AroundTheWebMaps/0.1 (article preview)', Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity' },
        }, res => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.resume();
            resolve({ status, location: res.headers.location, html: '' });
            return;
          }
          if (status !== 200) { res.resume(); reject(new SourceFailure('ARTICLE_HTTP_ERROR', `Article returned HTTP ${status}.`)); return; }
          if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(res.headers['content-type'] ?? '')) {
            res.resume(); reject(new SourceFailure('UNSUPPORTED_CONTENT', 'Article was not an HTML page.')); return;
          }
          if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
            res.resume(); reject(new SourceFailure('UNSUPPORTED_CONTENT', 'Article returned compressed content despite identity request.')); return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          res.on('data', chunk => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) { req.destroy(new SourceFailure('RESPONSE_TOO_LARGE', 'Article exceeded the 2 MiB limit.')); return; }
            chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('end', () => resolve({ status, html: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.end();
      });
      if (page.status >= 300 && page.status < 400) {
        if (!page.location) throw new SourceFailure('INVALID_REDIRECT', 'Article redirect had no destination.');
        url = validateArticleUrl(new URL(page.location, url).href);
        continue;
      }
      return { url: url.href, html: page.html };
    }
    throw new SourceFailure('TOO_MANY_REDIRECTS', 'Article exceeded the redirect limit.');
  } catch (error) {
    if (signal.aborted) throw new SourceFailure(ctx.signal.aborted ? 'ABORTED' : 'TIMEOUT', ctx.signal.aborted ? 'Article request was cancelled.' : 'Article deadline exceeded.');
    throw error;
  }
};

function decode(value: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
  return value.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, key: string) => {
    if (key[0] !== '#') return entities[key.toLowerCase()] ?? whole;
    const n = key[1]!.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}
function plain(value: string): string { return decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function attrs(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
    .map(m => [m[1]!.toLowerCase(), decode(m[2] ?? m[3] ?? m[4] ?? '')]));
}

/** Lightweight reader for server-rendered pages; never executes scripts or claims visual analysis. */
export function extractArticle(page: Page, candidateId = articleId(page.url), fetchedAt = new Date().toISOString()): Candidate {
  const metadata: Record<string, string> = {};
  for (const tag of page.html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag); const key = a.property ?? a.name;
    if (key && a.content) metadata[key.toLowerCase()] = a.content;
  }
  const title = plain(metadata['og:title'] ?? page.html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? new URL(page.url).hostname);
  let clean = page.html.replace(/<!--[\s\S]*?-->/g, '');
  clean = clean.replace(/<(script|style|noscript|svg|nav|header|footer|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  // Some publishers use <article> for just the heading; fall back to main/body.
  const sections = ['article', 'main', 'body'].map(tag =>
    plain(clean.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] ?? ''));
  const content = (sections.find(value => value.length >= 100) ?? '').slice(0, 16000);
  if (content.length < 100 || /^(just a moment|access denied|attention required|verify you are human)/i.test(title)) {
    throw new SourceFailure('ARTICLE_UNREADABLE', 'Page did not provide readable article text.');
  }
  return {
    id: candidateId, type: 'article', source: 'web', title, url: page.url,
    author: metadata.author ?? metadata['article:author'] ?? null,
    thumbnailUrl: publicUrl(metadata['og:image'] ?? metadata['twitter:image'], page.url),
    publishedAt: timestamp(metadata['article:published_time'] ?? metadata.datepublished),
    fetchedAt, metrics: emptyMetrics(), evidence: [evidence(candidateId, page.url, 'article_text', content)],
  };
}
