import { fileURLToPath } from 'node:url';
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e';
import { beforeAll, describe, expect, it } from 'vitest';

describe('non-production deployments', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)),
    nuxtConfig: { '@laioutr/app-essentials-seo': { environment: 'preview' } } as never,
  });

  // See test/integration/sitemap.test.ts for why a plain `host` header can't spoof the request
  // host here and why x-forwarded-proto is needed too.
  const onHost = (path: string, host: string) =>
    $fetch<string>(path, { headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

  // Both tests below read this same response; fetch it once rather than once per test.
  let txt: string;
  beforeAll(async () => {
    txt = await onHost('/robots.txt', 'shop.ch');
  });

  it('blocks every crawler', () => {
    expect(txt).toContain('User-agent: *');
    // Anchored to a whole line: a plain substring check would also match the scoped
    // `Disallow: /api/` and `Disallow: /_laioutr/` lines production emits.
    expect(txt).toMatch(/^Disallow: \/$/m);
  });

  it('drops the sitemap reference so nothing is submitted', () => {
    expect(txt).toContain('User-agent: *'); // guard: a blank or error body would also "not contain" Sitemap:
    expect(txt).not.toContain('Sitemap:');
  });

  it('states no content preferences while indexing is disabled', () => {
    expect(txt).toContain('User-agent: *'); // guard, as above
    expect(txt).not.toContain('Content-Signal');
  });

  it('lists no pages in llms.txt', async () => {
    const llms = await onHost('/llms.txt', 'shop.ch');
    expect(llms.startsWith('# Switzerland\n')).toBe(true); // guard: a blank or error body would also lack pages
    expect(llms).not.toContain('## Pages');
    expect(llms).not.toContain('## Page Types');
  });

  it('marks the Markdown twin noindex, since frontend-core renders no robots meta here for this module to copy', async () => {
    const response = await fetch('/md-fixture/page.md', {
      headers: { host: 'shop.ch', 'x-forwarded-host': 'shop.ch', 'x-forwarded-proto': 'https' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
});
