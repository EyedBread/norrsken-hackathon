import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SourceTools } from '@atw/contracts';
import type { Config } from './config.ts';
import { createMockSources } from './mocks/mockSources.ts';

/**
 * Loads the source adapters.
 * Live adapters belong to Person 3 and must live in apps/api/sources/index.ts,
 * exporting `createSourceTools(): SourceTools | Promise<SourceTools>`.
 */
export async function loadSources(config: Config): Promise<SourceTools> {
  if (config.sources === 'mock') return createMockSources({ fail: config.mockFail });

  const entry = new URL('../sources/index.ts', import.meta.url);
  if (!existsSync(fileURLToPath(entry))) {
    throw new Error('SOURCES=live but apps/api/sources/index.ts does not exist yet. Use SOURCES=mock until Person 3 merges the adapters.');
  }
  const mod = (await import(entry.href)) as { createSourceTools?: () => SourceTools | Promise<SourceTools> };
  if (typeof mod.createSourceTools !== 'function') {
    throw new Error('apps/api/sources/index.ts must export createSourceTools()');
  }
  const tools = await mod.createSourceTools();
  for (const name of ['searchSocial', 'searchArticles', 'readArticle'] as const) {
    if (typeof tools?.[name] !== 'function') throw new Error(`Source adapters are missing ${name}()`);
  }
  return tools;
}
