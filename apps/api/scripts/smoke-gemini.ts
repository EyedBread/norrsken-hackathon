// Verifies the team key and model: one plain call and one function call.
// Usage: npm run smoke:gemini
import { loadConfig } from '../src/config.ts';
import { createGeminiModel } from '../src/model.ts';

const config = loadConfig();
if (!config.geminiApiKey) {
  console.error('GEMINI_API_KEY is not set (apps/api/.env).');
  process.exit(1);
}
const model = createGeminiModel(config.geminiApiKey, config.geminiModel);
const signal = AbortSignal.timeout(30_000);

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
  console.log(`Model ${config.geminiModel} works with this key.`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Gemini call failed for model ${config.geminiModel}: ${msg.split(config.geminiApiKey).join('[redacted]')}`);
  process.exit(1);
}
