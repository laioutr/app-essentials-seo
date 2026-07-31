import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('a live snapshot past its refresh time', async () => {
  await setup({ rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)) });

  // See test/integration/sitemap.test.ts for why the intended host has to travel in
  // x-forwarded-host rather than in a plain host header.
  const onHost = (path: string, host: string) =>
    $fetch<string>(path, { headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

  const count = (xml: string) => (xml.match(/<loc>/g) ?? []).length;

  it('keeps serving the old value until the refresh completes, then swaps it in', async () => {
    await $fetch('/__seed-snapshot', {
      method: 'POST',
      body: { host: 'shop.ch', sitemapName: 'test-product-de', urls: ['https://shop.ch/stale-only'] },
    });

    const first = await onHost('/__sitemap__/test-product-de.xml', 'shop.ch');
    expect(first).toContain('https://shop.ch/stale-only');
    expect(count(first)).toBe(1);

    // The refresh takes several passes. Until the last one it lives in the pending slot, so every
    // response is either the seeded value or the finished one — never anything in between.
    const deadline = Date.now() + 60_000;
    let seenIntermediate = false;
    let promoted = false;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const xml = await onHost('/__sitemap__/test-product-de.xml', 'shop.ch');
      if (!xml.includes('https://shop.ch/stale-only')) {
        promoted = true;
        expect(count(xml)).toBe(24_999);
        break;
      }
      if (count(xml) !== 1) seenIntermediate = true;
    }

    // The whole reason the pending slot exists: a reader never observes a partial refresh.
    expect(seenIntermediate).toBe(false);
    expect(promoted).toBe(true);
  }, 90_000);
});
