import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runResearch } from '../src/agent.ts';
import { createMockSources } from '../src/mocks/mockSources.ts';
import { PLACE, budgets, hooks, id, scriptedModel } from './helpers.ts';

const goodDecisions = () => ({
  decisions: [
    { candidateId: id('tt1'), verdict: 'keep', reason: 'Caption and location tag give this address.', evidenceIds: [id('tt1') + ':caption', id('tt1') + ':loc'] },
    { candidateId: id('a1'), verdict: 'keep', reason: 'Review names the address.', evidenceIds: [id('a1') + ':text'] },
    { candidateId: id('tt4'), verdict: 'keep', reason: 'Location tag names this venue.', evidenceIds: [id('tt4') + ':loc'] },
    { candidateId: id('tt2'), verdict: 'reject', reason: 'Caption is about the Odengatan branch.', evidenceIds: [id('tt2') + ':caption'] },
    { candidateId: id('tt3'), verdict: 'uncertain', reason: 'Only the name and a city hashtag.', evidenceIds: [id('tt3') + ':caption'] },
    // keep without evidence must be downgraded
    { candidateId: id('a2'), verdict: 'keep', reason: 'Looks right.', evidenceIds: ['made-up'] },
    // invented candidate must be dropped
    { candidateId: 'invented', verdict: 'keep', reason: 'x', evidenceIds: [] },
  ],
});

test('full loop: wrong branch rejected, thin match uncertain, refined query finds more', async () => {
  const model = scriptedModel(
    [
      [
        { id: 'c1', name: 'searchSocial', args: { query: 'Test Café Stockholm' } },
        { id: 'c2', name: 'searchArticles', args: { query: 'Test Café Stockholm review' } },
      ],
      [
        { id: 'c3', name: 'searchSocial', args: { query: 'Test Café Götgatan' } },
        { id: 'c4', name: 'readArticle', args: { candidateId: id('a1') } },
      ],
    ],
    goodDecisions,
  );
  const h = hooks();
  const out = await runResearch(PLACE, { model, sources: createMockSources({ delayMs: 5 }), budgets: budgets() }, h);

  assert.deepEqual(out.summary, { checked: 6, kept: 3, rejected: 1, uncertain: 2 });
  assert.deepEqual(out.cards.map((c) => c.id), [id('tt1'), id('a1'), id('tt4')]);
  assert.equal(out.sourceErrors.length, 0);
  assert.equal(out.cutShort, false);

  const a2 = out.decisions.find((d) => d.candidateId === id('a2'))!;
  assert.equal(a2.verdict, 'uncertain');
  assert.deepEqual(a2.evidenceIds, []);
  assert.ok(!out.decisions.some((d) => d.candidateId === 'invented'));

  // Card data comes from sources, not the model.
  const tt1 = out.cards[0]!;
  assert.equal(tt1.metrics.views, 48_200);
  assert.equal(tt1.metrics.shares, 40);
  assert.equal(out.cards[2]!.metrics.shares, null);
  // readArticle added article text evidence
  assert.ok(out.cards[1]!.evidence.some((e) => e.kind === 'article_text'));

  assert.deepEqual(h.stages, ['searching', 'checking']);
  assert.ok(h.events.includes('Running a follow-up search'));
  assert.ok(h.events.some((e) => e.includes('Götgatan')));
});

test('budgets: at most 4 search calls and 2 rounds', async () => {
  const s = (q: string, n: string) => ({ id: n, name: 'searchSocial', args: { query: q } });
  const model = scriptedModel([
    [s('q1', '1'), s('q2', '2'), s('q3', '3')],
    [s('q4', '4'), s('q5', '5')],
    [s('q6', '6')],
  ]);
  let calls = 0;
  const base = createMockSources({ delayMs: 1 });
  const sources = { ...base, searchSocial: (...a: Parameters<typeof base.searchSocial>) => (calls++, base.searchSocial(...a)) };
  const out = await runResearch(PLACE, { model, sources, budgets: budgets() }, hooks());
  assert.equal(calls, 4);
  assert.equal(out.cutShort, true);
  // Third turn is refused: the response tells the model why.
  const lastUser = model.requests.at(-2)!.contents.at(-1)!;
  assert.match(JSON.stringify(lastUser), /budget used up|No search rounds left/);
});

test('readArticle only accepts article IDs from search results, never URLs', async () => {
  let reads = 0;
  const base = createMockSources({ delayMs: 1 });
  const sources = { ...base, readArticle: (...a: Parameters<typeof base.readArticle>) => (reads++, base.readArticle(...a)) };
  const model = scriptedModel([
    [{ id: '1', name: 'searchSocial', args: { query: 'Test Café' } }],
    [
      { id: '2', name: 'readArticle', args: { candidateId: 'http://169.254.169.254/latest' } },
      { id: '3', name: 'readArticle', args: { candidateId: id('tt1') } },
      { id: '4', name: 'readArticle', args: { candidateId: id('a1') } },
    ],
  ]);
  await runResearch(PLACE, { model, sources, budgets: budgets() }, hooks());
  assert.equal(reads, 0);
});

test('a timed-out source still returns results from the others', async () => {
  const model = scriptedModel(
    [[
      { id: '1', name: 'searchSocial', args: { query: 'Test Café' } },
      { id: '2', name: 'searchArticles', args: { query: 'Test Café' } },
    ]],
    () => ({ decisions: [{ candidateId: id('a1'), verdict: 'keep', reason: 'Address in snippet.', evidenceIds: [id('a1') + ':snippet'] }] }),
  );
  const out = await runResearch(
    PLACE,
    { model, sources: createMockSources({ fail: 'social-timeout', delayMs: 5 }), budgets: budgets({ deadlineMs: 1500, decisionReserveMs: 700 }) },
    hooks(),
  );
  assert.deepEqual(out.sourceErrors.map((e) => `${e.source}:${e.code}`), ['tiktok:timeout']);
  assert.equal(out.cards.length, 1);
  assert.equal(out.summary.uncertain, 1);
  assert.equal(out.cutShort, true);
});

test('provider error is reported, not counted as rejection', async () => {
  const model = scriptedModel([[{ id: '1', name: 'searchSocial', args: { query: 'Test Café' } }]]);
  const out = await runResearch(PLACE, { model, sources: createMockSources({ fail: 'social', delayMs: 1 }), budgets: budgets() }, hooks());
  assert.deepEqual(out.summary, { checked: 0, kept: 0, rejected: 0, uncertain: 0 });
  assert.equal(out.sourceErrors[0]?.code, 'mock_failure');
});

test('decision failure leaves candidates uncertain and reports it', async () => {
  const model = scriptedModel([[{ id: '1', name: 'searchArticles', args: { query: 'Test Café' } }]], () => {
    throw new Error('quota exceeded for key SECRET123456');
  });
  const out = await runResearch(
    PLACE,
    { model, sources: createMockSources({ delayMs: 1 }), budgets: budgets(), redact: (t) => t.replaceAll('SECRET123456', '[redacted]') },
    hooks(),
  );
  assert.equal(out.summary.uncertain, 2);
  assert.equal(out.cards.length, 0);
  const err = out.sourceErrors.find((e) => e.source === 'gemini')!;
  assert.equal(err.code, 'decision_failed');
  assert.ok(!err.message.includes('SECRET123456'));
});

test('planning failure falls back to default searches', async () => {
  const model = {
    name: 'broken',
    async generate(req: { jsonSchema?: unknown }) {
      if (req.jsonSchema) return { content: null, functionCalls: [], text: '{"decisions":[]}' };
      throw new Error('model not found');
    },
  };
  const h = hooks();
  const out = await runResearch(PLACE, { model, sources: createMockSources({ delayMs: 1 }), budgets: budgets() }, h);
  assert.equal(out.summary.checked, 5);
  assert.equal(out.sourceErrors[0]?.code, 'planning_failed');
  assert.ok(h.events.includes('Gemini planning failed, running default searches'));
});
