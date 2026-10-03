import type { Candidate, Decision, Place, ResearchCard, ResearchJob, Verdict } from '@atw/contracts';

const VERDICTS: ReadonlySet<string> = new Set<Verdict>(['keep', 'reject', 'uncertain']);
const MAX_REASON = 300;

export type Finalized = {
  decisions: Decision[];
  cards: ResearchCard[];
  summary: ResearchJob['summary'];
};

/**
 * Turns the model's raw decision JSON into trusted output.
 * - Unknown or repeated candidate IDs are dropped.
 * - Evidence IDs must belong to that candidate's real evidence.
 * - keep/reject without valid evidence becomes uncertain.
 * - Candidates the model skipped become uncertain.
 * - Card data is copied from source data, only `why` comes from the model.
 * - Counts are computed here, never taken from the model.
 */
export function finalizeDecisions(
  candidates: Map<string, Candidate>,
  raw: unknown,
  skippedReason = 'Not assessed by the model.',
): Finalized {
  const seen = new Set<string>();
  const decided: Decision[] = [];

  const list = isRecord(raw) && Array.isArray(raw.decisions) ? raw.decisions : [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const candidateId = typeof item.candidateId === 'string' ? item.candidateId : '';
    const candidate = candidates.get(candidateId);
    if (!candidate || seen.has(candidateId)) continue;
    if (typeof item.verdict !== 'string' || !VERDICTS.has(item.verdict)) continue;

    const ownEvidence = new Set(candidate.evidence.map((e) => e.id));
    const evidenceIds = [
      ...new Set(
        (Array.isArray(item.evidenceIds) ? item.evidenceIds : []).filter(
          (id): id is string => typeof id === 'string' && ownEvidence.has(id),
        ),
      ),
    ];
    let verdict = item.verdict as Verdict;
    let reason = typeof item.reason === 'string' ? item.reason.trim().slice(0, MAX_REASON) : '';
    if (verdict !== 'uncertain' && evidenceIds.length === 0) {
      reason = `No valid evidence was cited for "${verdict}". ${reason}`.trim().slice(0, MAX_REASON);
      verdict = 'uncertain';
    }
    seen.add(candidateId);
    decided.push({ candidateId, verdict, reason, evidenceIds });
  }

  for (const id of candidates.keys()) {
    if (!seen.has(id)) {
      decided.push({ candidateId: id, verdict: 'uncertain', reason: skippedReason, evidenceIds: [] });
    }
  }

  const order: Record<Verdict, number> = { keep: 0, uncertain: 1, reject: 2 };
  // Stable sort keeps the model's ranking inside each verdict group.
  const decisions = decided.slice().sort((a, b) => order[a.verdict] - order[b.verdict]);

  const cards: ResearchCard[] = decisions
    .filter((d) => d.verdict === 'keep')
    .map((d) => ({ ...candidates.get(d.candidateId)!, why: d.reason, evidenceIds: d.evidenceIds }));

  const count = (v: Verdict) => decisions.filter((d) => d.verdict === v).length;
  const summary = { checked: decisions.length, kept: count('keep'), rejected: count('reject'), uncertain: count('uncertain') };
  return { decisions, cards, summary };
}

/** Light shape check for candidates coming back from source adapters. */
export function isCandidate(value: unknown): value is Candidate {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' && value.id.length > 0 &&
    (value.type === 'video' || value.type === 'article') &&
    typeof value.url === 'string' && /^https?:\/\//i.test(value.url) &&
    typeof value.title === 'string' &&
    isRecord(value.metrics) &&
    Array.isArray(value.evidence) &&
    value.evidence.every((e) => isRecord(e) && typeof e.id === 'string' && typeof e.text === 'string')
  );
}

export type PlaceValidation = { ok: true; place: Place } | { ok: false; message: string };

export function validatePlace(input: unknown): PlaceValidation {
  if (!isRecord(input)) return { ok: false, message: 'place must be an object' };
  const str = (field: string, max: number, required = true): string | null => {
    const v = input[field];
    if (typeof v !== 'string') return required ? null : '';
    const t = v.trim();
    if ((required && !t) || t.length > max || /[\u0000-\u001f]/.test(t)) return null;
    return t;
  };
  const key = str('key', 200);
  const name = str('name', 200);
  const address = str('address', 300, false);
  const city = str('city', 100);
  const mapsUrl = str('mapsUrl', 2000);
  if (key === null) return { ok: false, message: 'place.key is required (1-200 characters)' };
  if (name === null) return { ok: false, message: 'place.name is required (1-200 characters)' };
  if (address === null) return { ok: false, message: 'place.address must be a string up to 300 characters' };
  if (city === null) return { ok: false, message: 'place.city is required (1-100 characters)' };
  if (mapsUrl === null || !/^https?:\/\//i.test(mapsUrl)) return { ok: false, message: 'place.mapsUrl must be an http(s) URL' };

  const place: Place = { key, name, address, city, mapsUrl };
  for (const [field, limit] of [['lat', 90], ['lng', 180]] as const) {
    const v = input[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > limit) {
      return { ok: false, message: `place.${field} must be a number between -${limit} and ${limit}` };
    }
    place[field] = v;
  }
  return { ok: true, place };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
