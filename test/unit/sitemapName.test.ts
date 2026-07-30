import { beforeAll, describe, expect, it } from 'vitest';
import { CONFIGURED_PAGES_TOKEN, buildSitemapName, parseSitemapName } from '../../src/runtime/shared/sitemapName';

beforeAll(() => {
  buildSitemapName('ecommerce/product-detail-page', 'de');
  buildSitemapName('ecommerce/category', 'de');
  buildSitemapName('cms/category', 'de');
  buildSitemapName('blog/post-single', 'de-CH');
  buildSitemapName(CONFIGURED_PAGES_TOKEN, 'de');
  buildSitemapName(CONFIGURED_PAGES_TOKEN, 'de-CH');
});

describe('buildSitemapName', () => {
  it('flattens the namespace separator', () => {
    expect(buildSitemapName('ecommerce/product-detail-page', 'de')).toBe('ecommerce-product-detail-page-de');
  });

  it('keeps namespaces distinct so same-named types cannot collide', () => {
    expect(buildSitemapName('ecommerce/category', 'de')).not.toBe(buildSitemapName('cms/category', 'de'));
  });

  it('names the configured-pages source', () => {
    expect(buildSitemapName(CONFIGURED_PAGES_TOKEN, 'de')).toBe('pages-de');
  });

  it('handles a locale with a region subtag', () => {
    expect(buildSitemapName('blog/post-single', 'de-CH')).toBe('blog-post-single-de-CH');
  });

  it('re-registering the same pair under the name it already produced is a no-op', () => {
    const name = buildSitemapName('ecommerce/product-detail-page', 'de');
    expect(() => buildSitemapName('ecommerce/product-detail-page', 'de')).not.toThrow();
    expect(parseSitemapName(name)).toEqual({ token: 'ecommerce/product-detail-page', locale: 'de' });
  });

  it('throws when two different pairs collide on the same name', () => {
    buildSitemapName('ns/a-b', 'c');
    expect(() => buildSitemapName('ns/a', 'b-c')).toThrow('ns-a-b-c');
  });
});

describe('parseSitemapName', () => {
  it('round-trips a page type', () => {
    expect(parseSitemapName('ecommerce-product-detail-page-de')).toEqual({
      token: 'ecommerce/product-detail-page',
      locale: 'de',
    });
  });

  it('round-trips the configured-pages source', () => {
    expect(parseSitemapName('pages-de')).toEqual({ token: null, locale: 'de' });
  });

  it('round-trips a region-subtag locale', () => {
    expect(parseSitemapName('blog-post-single-de-CH')).toEqual({ token: 'blog/post-single', locale: 'de-CH' });
  });

  it('strips the chunk suffix the sitemap module appends', () => {
    expect(parseSitemapName('ecommerce-product-detail-page-de-0')).toEqual({
      token: 'ecommerce/product-detail-page',
      locale: 'de',
    });
    expect(parseSitemapName('pages-de-CH-12')).toEqual({ token: null, locale: 'de-CH' });
  });

  it('returns null for a name this app does not own', () => {
    expect(parseSitemapName('some-other-sitemap')).toBeNull();
  });
});
