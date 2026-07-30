import { describe, expect, it } from 'vitest';
import { dedupeByLoc, mapPageIndexEntries } from '../../src/runtime/server/lib/pageIndexUrls';

const de = { id: 'lng_de', code: 'de', localeChain: ['de'] };
const domain = { host: 'shop.ch', path: '/fr', languageId: 'lng_de', language: de } as never;

const entry = (params: Record<string, string>, meta = {}) => ({ params, meta });

const map = (entries: any[], overrides = {}) =>
  mapPageIndexEntries({
    entries,
    pagePath: '/produkte/:slug+',
    domain,
    trailingSlash: false,
    includeImages: true,
    seo: {},
    ...overrides,
  });

describe('mapPageIndexEntries', () => {
  it('fills params and applies the domain path prefix', () => {
    expect(map([entry({ slug: 'schuh' })])[0].loc).toBe('/fr/produkte/schuh');
  });

  it('joins a repeatable param', () => {
    expect(map([entry({ slug: 'a/b' })])[0].loc).toBe('/fr/produkte/a/b');
  });

  it('skips an entry marked noindex', () => {
    expect(map([entry({ slug: 'x' }, { noindex: true })])).toHaveLength(0);
  });

  it('skips an entry whose params leave the path unfilled', () => {
    expect(map([entry({})])).toHaveLength(0);
  });

  it('skips an entry supplying an empty string for a required param', () => {
    expect(map([entry({ slug: '' })])).toHaveLength(0);
  });

  it('carries lastModified through to lastmod', () => {
    expect(map([entry({ slug: 'x' }, { lastModified: '2026-03-01T00:00:00Z' })])[0].lastmod).toBe('2026-03-01T00:00:00Z');
  });

  it('emits previewImage as an image entry when enabled', () => {
    const meta = { previewImage: 'https://cdn.example/a.jpg' };
    expect(map([entry({ slug: 'x' }, meta)])[0].images).toEqual([{ loc: 'https://cdn.example/a.jpg' }]);
    expect(map([entry({ slug: 'x' }, meta)], { includeImages: false })[0].images).toBeUndefined();
  });

  it('applies per-page-type priority and changefreq', () => {
    const urls = map([entry({ slug: 'x' })], { seo: { priority: 0.8, changefreq: 'daily' } });
    expect(urls[0].priority).toBe(0.8);
    expect(urls[0].changefreq).toBe('daily');
  });

  it('emits no alternatives — the page head is the authoritative hreflang source', () => {
    expect(map([entry({ slug: 'x' })])[0].alternatives).toBeUndefined();
  });
});

describe('dedupeByLoc', () => {
  it('drops a loc already seen and records new ones', () => {
    const seen = new Set<string>(['/a']);
    expect(dedupeByLoc([{ loc: '/a' }, { loc: '/b' }, { loc: '/b' }], seen).map((url) => url.loc)).toEqual(['/b']);
    expect(seen.has('/b')).toBe(true);
  });
});
