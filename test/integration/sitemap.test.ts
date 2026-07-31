import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('sitemap and robots', async () => {
  await setup({ rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)) });

  // @nuxt/test-utils serves plain HTTP, but nuxt-site-config derives the per-request URL via
  // getRequestProtocol(event, { xForwardedProto: true }), which falls back to 'http' without this
  // header — every <loc> would be http://… and disagree with the hardcoded https:// alternates.
  //
  // A plain `host` header cannot spoof the request host here: `Host` is a forbidden header under the
  // Fetch spec, so Node's fetch/undici (which $fetch uses) silently replaces whatever value is passed
  // with the real socket's `127.0.0.1:<port>` before the request is sent. Every host-dependent codepath
  // this suite exercises — resolveHostContext via the module's own `getRequestHost(event, {
  // xForwardedHost: true })`, and nuxt-site-config's `getNitroOrigin` (same option) for <loc>/robots
  // absolute URLs and multi-tenancy matching — reads `x-forwarded-host` first, exactly so a reverse
  // proxy (or, here, a test) can carry the intended host through unmodified.
  const onHost = <T = string>(path: string, host: string) =>
    $fetch<T>(path, { headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

  describe('index filtering', () => {
    it('lists only the locales a host serves', async () => {
      const ch = await onHost('/sitemap_index.xml', 'shop.ch');
      expect(ch).toContain('pages-de');
      expect(ch).toContain('pages-fr');

      const de = await onHost('/sitemap_index.xml', 'shop.de');
      expect(de).toContain('pages-de');
      expect(de).not.toContain('pages-fr');
    });
  });

  describe('configured pages', () => {
    it('emits absolute locs on the requesting host', async () => {
      expect(await onHost('/__sitemap__/pages-de.xml', 'shop.ch')).toContain('<loc>https://shop.ch/</loc>');
      expect(await onHost('/__sitemap__/pages-de.xml', 'shop.de')).toContain('<loc>https://shop.de/</loc>');
    });

    it('omits a page whose default variant is noindex', async () => {
      const xml = await onHost('/__sitemap__/pages-de.xml', 'shop.ch');
      expect(xml).toContain('<loc>https://shop.ch/</loc>'); // guard: a blank or error body would also "not contain" /intern
      expect(xml).not.toContain('/intern');
    });

    it('applies the fr path prefix on the multi-locale host', async () => {
      expect(await onHost('/__sitemap__/pages-fr.xml', 'shop.ch')).toContain('https://shop.ch/fr');
    });
  });

  describe('page-index convergence', () => {
    const count = (xml: string) => (xml.match(/<loc>/g) ?? []).length;

    it('accumulates across successive requests and completes', async () => {
      const first = count(await onHost('/__sitemap__/test-product-de.xml', 'shop.ch'));
      expect(first).toBe(9_999); // one entry is flagged noindex

      // Each request advances the accumulation in the background; poll until it stops growing.
      // The budget is a wall-clock deadline rather than a fixed attempt count, kept generously below
      // the test's own timeout, so a slower machine gets more polls instead of a spurious failure.
      const deadline = Date.now() + 30_000;
      let latest = first;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const next = count(await onHost('/__sitemap__/test-product-de.xml', 'shop.ch'));
        if (next === latest && next > first) break;
        latest = next;
      }
      expect(latest).toBe(24_999);
    }, 60_000);

    it('never emits an unfilled or collapsed path', async () => {
      const xml = await onHost('/__sitemap__/test-product-de.xml', 'shop.ch');
      expect(xml).not.toContain('//</loc>');
      expect(xml).not.toContain(':slug');
    });

    it('emits no hreflang alternates for enumerated pages', async () => {
      expect(await onHost('/__sitemap__/test-product-de.xml', 'shop.ch')).not.toContain('xhtml:link');
    });
  });

  describe('the extension hook', () => {
    // The fixture registers a hook plugin that keeps only the three "featured" articles, deciding
    // from `ctx.entries`, and logs every call it receives at /__sitemap-hook-log. Six articles fit in
    // one rebuild pass, so a source is built once and every request after that is served from its
    // snapshot — though the build can just as well have been triggered by an earlier test rendering
    // the sitemap index, which resolves every child source. Hence deltas rather than absolute counts.
    interface HookCall {
      token: string | null;
      locale: string;
      entries: number;
      urls: number;
    }
    const articleCalls = async (): Promise<HookCall[]> =>
      (await onHost<HookCall[]>('/__sitemap-hook-log', 'shop.ch')).filter((call) => call.token === 'test/article');

    const featuredLocs = ['https://shop.ch/artikel/a0', 'https://shop.ch/artikel/a2', 'https://shop.ch/artikel/a4'];

    it('hands a page-index source the entries it was built from', async () => {
      await onHost('/__sitemap__/test-article-de.xml', 'shop.ch');

      const calls = await articleCalls();
      expect(calls.length).toBeGreaterThan(0);
      // Six entries mapped to five URLs — one article is noindex — so every build saw the superset
      // the payload documents, and emphatically not an empty array.
      for (const call of calls) expect(call).toMatchObject({ entries: 6, urls: 5 });
    });

    it('serves what the hook left in urls', async () => {
      const xml = await onHost('/__sitemap__/test-article-de.xml', 'shop.ch');
      for (const loc of featuredLocs) expect(xml).toContain(`<loc>${loc}</loc>`);
      expect(xml).not.toContain('/artikel/a1');
      expect(xml).not.toContain('/artikel/a5');
    });

    it('keeps the filter on a cached request without firing the hook again', async () => {
      const before = (await articleCalls()).length;

      const xml = await onHost('/__sitemap__/test-article-de.xml', 'shop.ch');
      for (const loc of featuredLocs) expect(xml).toContain(`<loc>${loc}</loc>`);
      expect(xml).not.toContain('/artikel/a1');

      // The snapshot was filtered in the pass that built it, so a cached read has nothing left to
      // offer — firing again would hand out an empty `entries` and re-run the filter over its own
      // output.
      expect(await articleCalls()).toHaveLength(before);
    });
  });

  describe('robots.txt', () => {
    it('points at this hosts sitemap index and blocks internals', async () => {
      const txt = await onHost('/robots.txt', 'shop.ch');
      expect(txt).toContain('Sitemap: https://shop.ch/sitemap_index.xml');
      expect(txt).toContain('Disallow: /api/');
      expect(txt).toContain('Disallow: /_laioutr/');
    });

    it('resolves the sitemap line against the requesting host', async () => {
      expect(await onHost('/robots.txt', 'shop.de')).toContain('Sitemap: https://shop.de/sitemap_index.xml');
    });
  });
});
