import type { FunctionCall } from '@google/genai';
import type { Place } from '@atw/contracts';
import { DEFAULT_BUDGETS, type Budgets } from '../src/config.ts';
import type { ModelRequest, ModelTurn, ResearchModel } from '../src/model.ts';

export const PLACE: Place = {
  key: 'test-cafe-sodermalm',
  name: 'Test Café',
  address: 'Götgatan 22, 118 46 Stockholm',
  city: 'Stockholm',
  mapsUrl: 'https://www.google.com/maps/place/Test+Caf%C3%A9',
};

export const id = (suffix: string) => `mock:${PLACE.key}:${suffix}`;

export const budgets = (over: Partial<Budgets> = {}): Budgets => ({ ...DEFAULT_BUDGETS, ...over });

/** Fake Gemini: plays back tool-call turns, then answers the decision call. */
export function scriptedModel(
  turns: FunctionCall[][],
  decide: (req: ModelRequest) => unknown = () => ({ decisions: [] }),
): ResearchModel & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  let i = 0;
  return {
    name: 'scripted',
    requests,
    async generate(req): Promise<ModelTurn> {
      requests.push(req);
      if (req.jsonSchema) return { content: null, functionCalls: [], text: JSON.stringify(decide(req)) };
      const calls = turns[i++] ?? [];
      return { content: { role: 'model', parts: calls.map((functionCall) => ({ functionCall })) }, functionCalls: calls, text: '' };
    },
  };
}

export const hooks = () => {
  const events: string[] = [];
  const stages: string[] = [];
  return { events, stages, event: (m: string) => void events.push(m), stage: (s: string) => void stages.push(s) };
};
