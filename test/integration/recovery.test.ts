import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('a page type whose upstream fails on the first pass', async () => {
  await setup({ rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)) });

  // See test/integration/sitemap.test.ts for why the intended host has to travel in
  // x-forwarded-host rather than in a plain host header.
  const onHost = (path: string, host: string) =>
    $fetch<string>(path, { headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

  const count = (xml: string) => (xml.match(/<loc>/g) ?? []).length;

  it('serves an empty sitemap rather than an error, then recovers on a later request', async () => {
    await $fetch('/__page-index-control', { method: 'POST', body: { failPasses: 1 } });

    // A failed pass still resolves to a snapshot, so the crawler gets a valid document. Erroring
    // here would be the alternative, and a 5xx on a sitemap is worse than an empty one.
    const first = await onHost('/__sitemap__/test-product-de.xml', 'shop.ch');
    expect(first).toContain('urlset'); // guard: an error body would also have no <loc>
    expect(count(first)).toBe(0);

    const deadline = Date.now() + 30_000;
    let latest = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      latest = count(await onHost('/__sitemap__/test-product-de.xml', 'shop.ch'));
      if (latest > 0) break;
    }

    // The failed pass left a resume point behind rather than a dead end, so accumulation continues.
    expect(latest).toBeGreaterThan(0);
  }, 60_000);
});
