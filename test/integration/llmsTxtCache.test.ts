import { fileURLToPath } from 'node:url';
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('llms.txt cached path', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)),
    nuxtConfig: { '@laioutr/app-essentials-seo': { aiReady: { llmsTxtCacheSeconds: 600 } } } as never,
  });

  // See sitemap.test.ts for why the host travels in x-forwarded-host.
  const onHost = (path: string, host: string) =>
    $fetch<string>(path, { headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

  it('sends a public, shared Cache-Control once caching is enabled', async () => {
    const response = await fetch('/llms.txt', { headers: { host: 'shop.ch', 'x-forwarded-host': 'shop.ch', 'x-forwarded-proto': 'https' } });
    expect(response.headers.get('cache-control')).toBe('public, max-age=600, s-maxage=600, stale-while-revalidate=3600');
  });

  it('keeps each host\'s own body even when shop.ch is cached first', async () => {
    const ch = await onHost('/llms.txt', 'shop.ch');
    expect(ch.startsWith('# Switzerland\n')).toBe(true);

    const de = await onHost('/llms.txt', 'shop.de');
    expect(de.startsWith('# Germany\n')).toBe(true);
  });
});
