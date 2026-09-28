import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('schema.org switched off', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)),
    nuxtConfig: { '@laioutr/app-essentials-seo': { structuredData: { enabled: false } } } as never,
  });

  it('adds no JSON-LD to the page', async () => {
    const html = await $fetch<string>('/', {
      headers: { host: 'shop.ch', 'x-forwarded-host': 'shop.ch', 'x-forwarded-proto': 'https' },
    });
    expect(html).toContain('seo fixture'); // guard: an error page would also contain no JSON-LD
    expect(html).not.toContain('application/ld+json');
  });
});
