// Verifies the team key and model: one plain call and one function call.
// Usage: npm run smoke:gemini
import { loadConfig } from '../src/config.ts';
import { createGeminiModel } from '../src/model.ts';

const config = loadConfig();
if (!config.geminiApiKey) {
  console.error('GEMINI_API_KEY is not set (apps/api/.env).');
  process.exit(1);
}
const names = [config.geminiModel, ...config.geminiFallbackModels];
let failures = 0;
for (const name of names) {
  if (!(await check(name, config.geminiApiKey))) failures++;
}
process.exit(failures === names.length ? 1 : 0);

async function check(name: string, apiKey: string): Promise<boolean> {
// No retries here, so a busy model shows up as busy instead of looking slow.
const model = createGeminiModel(apiKey, name, { retry: { attemptsPerModel: 1, baseDelayMs: 0, maxDelayMs: 0 } });
const signal = AbortSignal.timeout(30_000);
console.log(`\n== ${name}`);
try {
  const t0 = Date.now();
  const plain = await model.generate({
    system: 'Answer briefly.',
    contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }],
    signal,
  });
  console.log(`1/2 plain call OK in ${Date.now() - t0}ms: ${JSON.stringify(plain.text.trim())}`);

  const t1 = Date.now();
  const tool = await model.generate({
    system: 'Use the tool.',
    contents: [{ role: 'user', parts: [{ text: 'Search TikTok for cafes on Södermalm.' }] }],
    tools: [{
      name: 'searchSocial',
      description: 'Search TikTok by keyword.',
      parametersJsonSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    }],
    signal,
  });
  const call = tool.functionCalls[0];
  if (!call) throw new Error(`model did not call the tool, it said: ${tool.text.slice(0, 200)}`);
  console.log(`2/2 function call OK in ${Date.now() - t1}ms: ${call.name}(${JSON.stringify(call.args)})`);
  console.log(`Model ${name} works with this key.`);
  return true;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number }).status;
  console.error(`Gemini call failed for model ${name}${status ? ` (HTTP ${status})` : ''}: ${msg.split(apiKey).join('[redacted]').slice(0, 300)}`);
  return false;
}
}
