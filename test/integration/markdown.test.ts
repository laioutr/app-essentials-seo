import { fileURLToPath } from 'node:url';
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('markdown twins', async () => {
  await setup({ rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)) });

  // See sitemap.test.ts for why the host travels in x-forwarded-host.
  const hostHeaders = { 'host': 'shop.ch', 'x-forwarded-host': 'shop.ch', 'x-forwarded-proto': 'https' };
  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(path, { headers: { ...hostHeaders, ...headers }, redirect: 'manual' });

  describe('GET <path>.md', () => {
    it('serves the page body as Markdown, without header, footer or ignored parts', async () => {
      const response = await get('/md-fixture/page.md');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/markdown');
      const md = await response.text();
      expect(md).toContain('# Red Shoe');
      expect(md).toContain('[our workshop](https://shop.ch/about)');
      for (const gone of ['Free shipping', 'Imprint', 'Only 3 left', 'newsletter']) expect(md).not.toContain(gone);
    });

    it('writes upstream frontmatter', async () => {
      const md = await (await get('/md-fixture/page.md')).text();
      expect(md).toMatch(/^---\n/);
      expect(md).toContain('title: "Red Shoe"');
      expect(md).toContain('canonical_url: "https://shop.ch/md-fixture/page"');
      expect(md).toContain('last_updated: "2026-09-01T00:00:00Z"');
      expect(md).toMatch(/locale: "?de"?/);
    });

    it('keeps the JSON-LD', async () => {
      const md = await (await get('/md-fixture/page.md')).text();
      expect(md).toContain('## Structured Data');
      expect(md).toContain('"@type": "BreadcrumbList"');
    });

    it('links back to the HTML page as canonical and caches', async () => {
      const response = await get('/md-fixture/page.md');
      expect(response.headers.get('link')).toContain('<https://shop.ch/md-fixture/page>; rel="canonical"');
      expect(response.headers.get('link')).toContain('<https://shop.ch/llms.txt>; rel="describedby"');
      expect(response.headers.get('cache-control')).toBe('public, max-age=3600, stale-while-revalidate=3600');
    });

    it('carries the page robots directive', async () => {
      const response = await get('/md-fixture/noindex.md');
      expect(response.status).toBe(200);
      expect(response.headers.get('x-robots-tag')).toBe('noindex, follow');
      expect((await get('/md-fixture/page.md')).headers.get('x-robots-tag')).toBeNull();
    });

    it('answers a missing or non-HTML page with a Markdown 404', async () => {
      for (const path of ['/md-fixture/gone.md', '/md-fixture/data.md']) {
        const response = await get(path);
        expect(response.status).toBe(404);
        expect(await response.text()).toContain('# Page not found');
        expect(response.headers.get('cache-control')).not.toBe('public, max-age=3600, stale-while-revalidate=3600');
      }
    });

    it('drops any set-cookie from a pass-through error response, since it answers on behalf of every visitor', async () => {
      const response = await get('/md-fixture/broken.md');
      expect(response.status).toBe(500);
      expect(response.headers.get('set-cookie')).toBeNull();
    });

    it('sends a redirect to another page on to that page’s twin', async () => {
      const response = await get('/md-fixture/moved.md');
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/md-fixture/page.md');
    });

    it('renders the Nuxt home page', async () => {
      const md = await (await get('/index.md')).text();
      expect(md).toContain('seo fixture');
    });
  });

  describe('ai-ready:markdown:source', () => {
    it('serves a listener-supplied Markdown source with no HTML route behind it', async () => {
      const response = await get('/md-fixture/sourced.md');
      expect(response.status).toBe(200);
      const md = await response.text();
      expect(md).toContain('# From source');
      expect(md).toMatch(/title: "?Sourced"?/);
    });
  });

  describe('negotiation on HTML URLs', () => {
    it('redirects a Markdown-preferring client to the twin, uncached', async () => {
      const response = await get('/md-fixture/page', { accept: 'text/markdown' });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('/md-fixture/page.md');
      expect(response.headers.get('vary')).toContain('Accept');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    });

    it('serves a browser HTML with a Link to the twin and to llms.txt', async () => {
      const response = await get('/', { 'accept': 'text/html', 'sec-fetch-dest': 'document' });
      expect(response.status).toBe(200);
      const link = response.headers.get('link') ?? '';
      expect(link).toContain('<https://shop.ch/index.md>; rel="alternate"; type="text/markdown"');
      expect(link).toContain('<https://shop.ch/llms.txt>; rel="describedby"');
      expect(response.headers.get('vary')).toContain('User-Agent');
    });

    it('never negotiates a non-GET request', async () => {
      const response = await fetch('/md-fixture/page', { method: 'POST', headers: { ...hostHeaders, accept: 'text/markdown' }, redirect: 'manual' });
      expect(response.status).not.toBe(307);
    });

    it('leaves non-page routes alone', async () => {
      const response = await get('/robots.txt', { accept: 'text/markdown' });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');
    });
  });

  it('is reachable through $fetch too (sanity check for the fixture)', async () => {
    expect(await $fetch<string>('/md-fixture/page', { headers: hostHeaders })).toContain('Red Shoe');
  });

  describe('page head', () => {
    it('names the twin and llms.txt', async () => {
      const html = await $fetch<string>('/', { headers: hostHeaders });
      const links = html.match(/<link\b[^>]*>/g) ?? [];
      expect(links.some((tag) => tag.includes('type="text/markdown"') && tag.includes('href="/index.md"'))).toBe(true);
      expect(links.some((tag) => tag.includes('rel="describedby"') && tag.includes('href="/llms.txt"'))).toBe(true);
    });
  });
});
