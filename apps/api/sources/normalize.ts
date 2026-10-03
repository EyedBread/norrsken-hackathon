import { createHash } from 'node:crypto';
import type { Candidate, Evidence } from './types.ts';

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
export function clip(value: string, length: number): string { return Array.from(value).slice(0, length).join(''); }
export function metric(value: unknown): number | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function timestamp(value: unknown): string | null {
  let input: string | number;
  if (typeof value === 'number') input = value < 1e12 ? value * 1000 : value;
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) input = value;
  else return null;
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function publicUrl(value: unknown, base?: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value, base);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    return u.href;
  } catch { return null; }
}
export function canonicalUrl(value: string): string {
  const u = new URL(value);
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'msclkid'].includes(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  return u.href;
}
export function articleId(url: string): string {
  return 'web:' + createHash('sha256').update(canonicalUrl(url)).digest('hex').slice(0, 24);
}
export function evidence(id: string, sourceUrl: string, kind: Evidence['kind'], value: string): Evidence {
  return { id: `${id}:${kind}:${createHash('sha256').update(value).digest('hex').slice(0, 12)}`, sourceUrl, kind, text: value };
}
export const emptyMetrics = () => ({ views: null, likes: null, comments: null, shares: null });

export function normalizeTikTok(value: unknown, fetchedAt: string): Candidate | null {
  const raw = record(value);
  const author = record(raw.authorMeta);
  const video = record(raw.videoMeta);
  const url = publicUrl(raw.webVideoUrl ?? raw.submittedVideoUrl);
  if (!url) return null;
  const parsed = new URL(url);
  if (!['www.tiktok.com', 'tiktok.com'].includes(parsed.hostname)) return null;
  const match = parsed.pathname.match(/^\/@[^/]+\/(?:video|photo)\/(\d+)\/?$/);
  if (!match) return null;
  const id = `tiktok:${match[1]}`;
  const sourceUrl = `https://www.tiktok.com${parsed.pathname.replace(/\/$/, '')}`;
  const caption = text(raw.text);
  const proof: Evidence[] = caption ? [evidence(id, sourceUrl, 'caption', clip(caption, 8000))] : [];
  const location = record(raw.locationMeta ?? raw.locationCreated ?? raw.poi);
  const locationParts = [location.locationName ?? location.name, location.address, location.city, location.country].map(text).filter(Boolean);
  if (locationParts.length) proof.push(evidence(id, sourceUrl, 'location_tag', locationParts.join(', ')));
  return {
    id, type: 'video', source: 'tiktok', title: clip(caption ?? 'TikTok video', 200), url: sourceUrl,
    author: text(author.name ?? author.nickName),
    thumbnailUrl: publicUrl(video.coverUrl ?? video.originalCoverUrl ?? raw.coverUrl),
    publishedAt: timestamp(raw.createTimeISO ?? raw.createTime), fetchedAt,
    metrics: { views: metric(raw.playCount), likes: metric(raw.diggCount), comments: metric(raw.commentCount), shares: metric(raw.shareCount) },
    evidence: proof,
  };
}

export function normalizeSearchResult(value: unknown, fetchedAt: string): Candidate | null {
  const raw = record(value);
  const href = publicUrl(raw.url);
  if (!href) return null;
  const host = new URL(href).hostname;
  if (/(^|\.)(tiktok\.com|instagram\.com|youtube\.com|facebook\.com|google\.com)$/.test(host)) return null;
  if (/(^|\.)(tripadvisor|yelp)\.[a-z.]+$/.test(host)) return null;
  const url = canonicalUrl(href);
  const id = articleId(url);
  const description = text(raw.description ?? raw.snippet);
  return {
    id, type: 'article', source: 'web', title: text(raw.title) ?? host, url,
    author: null, thumbnailUrl: publicUrl(raw.imageUrl), publishedAt: null, fetchedAt,
    metrics: emptyMetrics(),
    evidence: description ? [evidence(id, url, 'search_snippet', clip(description, 4000))] : [],
  };
}

export function unique(items: Candidate[]): Candidate[] {
  return [...new Map(items.map(item => [item.id, item])).values()];
}
