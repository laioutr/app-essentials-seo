import { fileURLToPath } from 'node:url';
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('llms.txt', async () => {
  await setup({ rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)) });

  // See sitemap.test.ts for why the host travels in x-forwarded-host.
  const onHost = (path: string, host: string) =>
    $fetch<string>(path, { headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

  it('opens with the site header and the authored parts', async () => {
    const txt = await onHost('/llms.txt', 'shop.ch');
    expect(txt.startsWith('# Switzerland\n')).toBe(true);
    expect(txt).toContain('Canonical Origin: https://shop.ch/');
    expect(txt).toContain('Fixture shop for tests.');
    expect(txt).toContain('- [sitemap_index.xml](https://shop.ch/sitemap_index.xml)');
    expect(txt).toContain('- [FAQ](https://shop.ch/faq.md)');
  });

  it('lists configured, indexable pages as twins', async () => {
    const txt = await onHost('/llms.txt', 'shop.ch');
    expect(txt).toContain('- [Startseite](https://shop.ch/index.md)');
    expect(txt).not.toContain('/intern');
  });

  it('summarises page types, hiding the ones set to false', async () => {
    const txt = await onHost('/llms.txt', 'shop.ch');
    expect(txt).toContain('- [Product](https://shop.ch/__sitemap__/test-product-de.xml): Pages at /produkte/{slug}.');
    expect(txt).not.toContain('/artikel/');
  });

  it('counts a page type once its snapshot is complete', async () => {
    await $fetch('/__seed-snapshot', {
      method: 'POST',
      body: { host: 'shop.ch', sitemapName: 'test-product-de', urls: ['https://shop.ch/produkte/a', 'https://shop.ch/produkte/b'] },
    });
    expect(await onHost('/llms.txt', 'shop.ch')).toContain('~2 pages at /produkte/{slug}');
  });

  it('lists languages on a multi-language host only', async () => {
    const ch = await onHost('/llms.txt', 'shop.ch');
    expect(ch).toContain('- [German (de)](https://shop.ch/index.md): content included below.');
    expect(ch).toContain('- [French (fr)](https://shop.ch/fr.md): visit this language for content.');
    const de = await onHost('/llms.txt', 'shop.de');
    expect(de.startsWith('# Germany\n')).toBe(true);
    expect(de).not.toContain('Available Languages');
  });

  it('is plain text', async () => {
    const response = await fetch('/llms.txt', { headers: { 'x-forwarded-host': 'shop.ch', 'x-forwarded-proto': 'https' } });
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });
});
