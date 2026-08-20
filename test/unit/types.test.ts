import { describe, expect, it } from 'vitest';
import { MODULE_NAME, resolveOptions } from '../../src/types';

describe('resolveOptions', () => {
  it('exposes the package name as the config key', () => {
    expect(MODULE_NAME).toBe('@laioutr/app-essentials-seo');
  });

  it('fills every default so consumers need no guards', () => {
    const resolved = resolveOptions(undefined);
    expect(resolved.indexable).toBe('auto');
    expect(resolved.sitemap.enabled).toBe(true);
    expect(resolved.sitemap.excludePageTypes).toEqual([]);
    expect(resolved.sitemap.entriesPerRequest).toBe(10_000);
    expect(resolved.sitemap.includeImages).toBe(true);
    expect(resolved.robots.enabled).toBe(true);
    expect(resolved.robots.extraDisallow).toEqual([]);
  });

  it('keeps caller values and still fills the rest', () => {
    const resolved = resolveOptions({ sitemap: { entriesPerRequest: 500 } });
    expect(resolved.sitemap.entriesPerRequest).toBe(500);
    expect(resolved.sitemap.enabled).toBe(true);
  });

  it('rejects an entriesPerRequest below 1', () => {
    expect(() => resolveOptions({ sitemap: { entriesPerRequest: 0 } })).toThrow();
  });
});

describe('resolveOptions — openGraph.pageTypes', () => {
  it('defaults the page types for which "website" would be wrong', () => {
    expect(resolveOptions(undefined).openGraph.pageTypes).toEqual({
      'blog/post-single': 'article',
      'ecommerce/product-detail-page': 'product',
      'location/detail': 'place',
    });
  });

  it('lets a project override one page type without losing the other defaults', () => {
    const pageTypes = resolveOptions({ openGraph: { pageTypes: { 'blog/post-single': 'blog' } } }).openGraph.pageTypes;
    expect(pageTypes['blog/post-single']).toBe('blog');
    expect(pageTypes['ecommerce/product-detail-page']).toBe('product');
    expect(pageTypes['location/detail']).toBe('place');
  });

  it('adds a page type that has no default rather than replacing the map', () => {
    const pageTypes = resolveOptions({ openGraph: { pageTypes: { 'shopify/content-page': 'article' } } }).openGraph.pageTypes;
    expect(pageTypes['shopify/content-page']).toBe('article');
    expect(pageTypes['ecommerce/product-detail-page']).toBe('product');
  });

  it('leaves the map alone when only the fallback type is configured', () => {
    const openGraph = resolveOptions({ openGraph: { defaultType: 'article' } }).openGraph;
    expect(openGraph.defaultType).toBe('article');
    expect(openGraph.pageTypes['ecommerce/product-detail-page']).toBe('product');
  });
});
