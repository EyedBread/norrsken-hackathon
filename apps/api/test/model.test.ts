import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRetryable, withRetry, type ModelRequest, type ModelTurn } from '../src/model.ts';

const ok: ModelTurn = { content: null, functionCalls: [], text: 'ok' };
const busy = () => Object.assign(new Error('The model is experiencing high demand'), { status: 503 });
const fast = { attemptsPerModel: 3, baseDelayMs: 1, maxDelayMs: 2 };
const req = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  system: '', contents: [], signal: new AbortController().signal, ...over,
});

test('retries busy errors and reports each retry', async () => {
  const seen: string[] = [];
  let n = 0;
  const model = withRetry(async (name) => { seen.push(name); if (++n < 3) throw busy(); return ok; }, ['main'], fast);
  const retries: number[] = [];
  const out = await model.generate(req({ onRetry: (i) => retries.push(i.attempt) }));
  assert.equal(out.text, 'ok');
  assert.deepEqual(seen, ['main', 'main', 'main']);
  assert.deepEqual(retries, [2, 3]);
});

test('moves to the fallback model when the main one stays busy', async () => {
  const seen: string[] = [];
  const model = withRetry(async (name) => { seen.push(name); if (name === 'main') throw busy(); return ok; }, ['main', 'backup'], fast);
  assert.equal((await model.generate(req())).text, 'ok');
  assert.deepEqual(seen, ['main', 'main', 'main', 'backup']);
});

test('a missing fallback model does not hide the busy error', async () => {
  const model = withRetry(async (name) => {
    if (name === 'main') throw busy();
    throw Object.assign(new Error('models/backup is not found'), { status: 404 });
  }, ['main', 'backup'], fast);
  await assert.rejects(model.generate(req()), /high demand/);
});

test('does not retry a bad key or bad request', async () => {
  let n = 0;
  const model = withRetry(async () => { n++; throw Object.assign(new Error('API key not valid'), { status: 400 }); }, ['main', 'backup'], fast);
  await assert.rejects(model.generate(req()), /API key not valid/);
  assert.equal(n, 1);
});

test('stops waiting when the job is aborted', async () => {
  const ctrl = new AbortController();
  const model = withRetry(async () => { throw busy(); }, ['main'], { attemptsPerModel: 5, baseDelayMs: 10_000, maxDelayMs: 10_000 });
  const started = Date.now();
  setTimeout(() => ctrl.abort(), 30);
  await assert.rejects(model.generate(req({ signal: ctrl.signal })));
  assert.ok(Date.now() - started < 1000);
});

test('classifies errors', () => {
  assert.equal(isRetryable(busy()), true);
  assert.equal(isRetryable(Object.assign(new Error('x'), { status: 429 })), true);
  assert.equal(isRetryable(Object.assign(new Error('x'), { status: 400 })), false);
  assert.equal(isRetryable(new Error('fetch failed')), true);
});
