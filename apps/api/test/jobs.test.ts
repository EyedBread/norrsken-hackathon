import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { ResearchJob } from '@atw/contracts';
import { ResultCache } from '../src/cache.ts';
import { JobStore } from '../src/jobs.ts';
import { createMockSources } from '../src/mocks/mockSources.ts';
import { createApp } from '../src/server.ts';
import { validatePlace } from '../src/validate.ts';
import { PLACE, budgets, id, scriptedModel } from './helpers.ts';

const turns = () => [[{ id: '1', name: 'searchSocial', args: { query: 'Test Café' } }]];
const decide = () => ({ decisions: [{ candidateId: id('tt1'), verdict: 'keep', reason: 'Location tag.', evidenceIds: [id('tt1') + ':loc'] }] });

async function waitDone(store: JobStore, jobId: string): Promise<ResearchJob> {
  for (let i = 0; i < 200; i++) {
    const job = store.get(jobId)!;
    if (job.stage === 'done') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('job did not finish');
}

test('live job completes, is cached to disk, and is served from cache next time', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atw-cache-'));
  const store = new JobStore({
    model: scriptedModel(turns(), decide), sources: createMockSources({ delayMs: 1 }),
    budgets: budgets(), mode: 'live', cache: new ResultCache(dir),
  });
  const first = store.start(PLACE);
  const again = store.start(PLACE);
  assert.equal(again.jobId, first.jobId, 'identical active job is reused');

  const done = await waitDone(store, first.jobId);
  assert.equal(done.status, 'complete');
  assert.equal(done.mode, 'live');
  assert.ok(done.generatedAt);
  for (let i = 0; i < 100 && (await readdir(dir)).length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(await readdir(dir), ['test-cafe-sodermalm.json']);

  const fresh = new ResultCache(dir);
  assert.equal(await fresh.load(), 1);
  const store2 = new JobStore({
    model: scriptedModel([]), sources: createMockSources(), budgets: budgets(), mode: 'live', cache: fresh,
  });
  const cachedJob = store2.get(store2.start(PLACE).jobId)!;
  assert.equal(cachedJob.mode, 'cache');
  assert.equal(cachedJob.generatedAt, done.generatedAt);
  assert.equal(cachedJob.cards.length, 1);

  const refreshed = store2.get(store2.start(PLACE, true).jobId)!;
  assert.equal(refreshed.mode, 'live');
});

test('demo (mock) results are never cached', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atw-cache-'));
  const cache = new ResultCache(dir);
  const store = new JobStore({ model: scriptedModel(turns(), decide), sources: createMockSources({ delayMs: 1 }), budgets: budgets(), mode: 'demo', cache });
  const done = await waitDone(store, store.start(PLACE).jobId);
  assert.equal(done.mode, 'demo');
  assert.equal(cache.get(PLACE.key), undefined);
  assert.deepEqual(await readdir(dir), []);
});

test('place validation', () => {
  assert.equal(validatePlace(PLACE).ok, true);
  assert.equal(validatePlace({ ...PLACE, key: '' }).ok, false);
  assert.equal(validatePlace({ ...PLACE, mapsUrl: 'javascript:alert(1)' }).ok, false);
  assert.equal(validatePlace({ ...PLACE, lat: 200 }).ok, false);
  assert.equal(validatePlace({ ...PLACE, address: undefined }).ok, true);
});

test('HTTP: start, poll, errors', async () => {
  const store = new JobStore({
    model: scriptedModel(turns(), decide), sources: createMockSources({ delayMs: 1 }),
    budgets: budgets(), mode: 'demo', cache: new ResultCache(null),
  });
  const server = createApp(store, {}).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const bad = await fetch(`${base}/api/research`, { method: 'POST', body: '{"place":{}}' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, 'invalid_place');

    const start = await fetch(`${base}/api/research`, { method: 'POST', body: JSON.stringify({ place: PLACE }) });
    assert.equal(start.status, 202);
    const { jobId, placeKey } = await start.json();
    assert.equal(placeKey, PLACE.key);

    await waitDone(store, jobId);
    const job = await (await fetch(`${base}/api/research/${jobId}`)).json();
    assert.equal(job.status, 'complete');
    assert.equal(job.cards[0].id, id('tt1'));

    assert.equal((await fetch(`${base}/api/research/00000000-0000-0000-0000-000000000000`)).status, 404);
  } finally {
    server.close();
  }
});
