import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import type { ApiError } from '@atw/contracts';
import { ResultCache } from './cache.ts';
import { loadConfig } from './config.ts';
import { JobStore } from './jobs.ts';
import { createGeminiModel } from './model.ts';
import { loadSources } from './sources.ts';
import { isRecord, validatePlace } from './validate.ts';

const MAX_BODY_BYTES = 32 * 1024;

export function createApp(store: JobStore, info: Record<string, unknown>) {
  return createServer(async (req, res) => {
    // The extension calls us from its background worker. No cookies or credentials are used.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();

    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    try {
      if (req.method === 'GET' && path === '/api/health') {
        return send(res, 200, { ok: true, ...info });
      }
      if (req.method === 'POST' && path === '/api/research') {
        const body = await readJson(req);
        if (!isRecord(body)) return fail(res, 400, 'bad_request', 'Body must be a JSON object { place }');
        const v = validatePlace(body.place);
        if (!v.ok) return fail(res, 400, 'invalid_place', v.message);
        return send(res, 202, store.start(v.place, body.refresh === true));
      }
      const match = path.match(/^\/api\/research\/([0-9a-f-]{36})$/);
      if (req.method === 'GET' && match) {
        const job = store.get(match[1]!);
        return job ? send(res, 200, job) : fail(res, 404, 'not_found', 'Unknown or expired job');
      }
      return fail(res, 404, 'not_found', 'No such route');
    } catch (err) {
      if (err instanceof HttpError) return fail(res, err.status, err.code, err.message);
      console.error('[http] unexpected error', err instanceof Error ? err.message : err);
      return fail(res, 500, 'internal_error', 'Unexpected server error');
    }
  });
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'bad_json', 'Body must be valid JSON');
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function fail(res: ServerResponse, status: number, code: string, message: string): void {
  send(res, status, { error: { code, message } } satisfies ApiError);
}

async function main() {
  const config = loadConfig();
  if (!config.geminiApiKey) {
    console.error('GEMINI_API_KEY is not set. Copy apps/api/.env.example to apps/api/.env and add the key.');
    process.exit(1);
  }
  const secrets = [config.geminiApiKey, process.env.APIFY_TOKEN].filter((s): s is string => !!s && s.length > 8);
  const redact = (text: string) => secrets.reduce((t, s) => t.split(s).join('[redacted]'), text);

  const sources = await loadSources(config);
  const cache = new ResultCache(config.sources === 'live' ? config.cacheDir : null);
  const loaded = await cache.load();
  const store = new JobStore({
    model: createGeminiModel(config.geminiApiKey, config.geminiModel),
    sources,
    budgets: config.budgets,
    mode: config.sources === 'live' ? 'live' : 'demo',
    cache,
    redact,
  });

  createApp(store, { model: config.geminiModel, sources: config.sources }).listen(config.port, () => {
    console.log(
      `Around the Web API on http://localhost:${config.port} ` +
        `(model ${config.geminiModel}, sources ${config.sources}, ${loaded} cached results)`,
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
