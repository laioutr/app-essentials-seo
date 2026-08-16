import { describe, expect, it } from 'vitest';
import { buildOpenGraph } from '../../src/runtime/shared/buildOpenGraph';
import type { BuildOpenGraphInput } from '../../src/runtime/shared/buildOpenGraph';

const build = (overrides: Partial<BuildOpenGraphInput> = {}) =>
  buildOpenGraph({
    seo: { title: 'Running shoes', description: 'The full range.' },
    links: [
      { rel: 'canonical', href: 'https://shop.ch/schuhe' },
      { rel: 'alternate', href: 'https://shop.fr/chaussures' },
    ],
    pageType: 'core/landingpage',
    host: 'shop.ch',
    siteNameByHost: { 'shop.ch': 'Shop Schweiz', 'shop-ch.local.laioutr.tech': 'Shop Schweiz' },
    siteName: undefined,
    config: { defaultType: 'website', pageTypes: [] },
    ...overrides,
  });

describe('buildOpenGraph', () => {
  it('mirrors the resolved title and description', () => {
    expect(build()).toMatchObject({ ogTitle: 'Running shoes', ogDescription: 'The full range.' });
  });

  it('omits the title when frontend-core fell back to the bare page type', () => {
    expect(build({ seo: { title: 'core/landingpage' } }).ogTitle).toBeUndefined();
  });

  it('omits blank or absent strings rather than emitting empty tags', () => {
    const meta = build({ seo: { title: '', description: '' } });
    expect(meta.ogTitle).toBeUndefined();
    expect(meta.ogDescription).toBeUndefined();
  });

  it('never emits og:locale, which frontend-core already renders', () => {
    expect(build()).not.toHaveProperty('ogLocale');
  });
});

describe('buildOpenGraph og:type', () => {
  it('falls back to the default type for an unmapped page type', () => {
    expect(build().ogType).toBe('website');
  });

  it('uses the configured type for a mapped page type', () => {
    const config = { defaultType: 'website', pageTypes: [{ pageType: 'blog/post', type: 'article' }] };
    expect(build({ pageType: 'blog/post', config }).ogType).toBe('article');
  });

  it('is always emitted, since og:type has no sensible absent state', () => {
    expect(build({ seo: {} }).ogType).toBe('website');
  });
});

describe('buildOpenGraph og:url', () => {
  it('takes the canonical link, not an alternate', () => {
    expect(build().ogUrl).toBe('https://shop.ch/schuhe');
  });

  it('is omitted when no canonical was produced, as in a preview with no resolved domain', () => {
    expect(build({ links: [] }).ogUrl).toBeUndefined();
  });
});

describe('buildOpenGraph og:site_name', () => {
  it('resolves the name of the host serving the request', () => {
    expect(build().ogSiteName).toBe('Shop Schweiz');
  });

  it('resolves a dev host the same way, so local renders match production', () => {
    expect(build({ host: 'shop-ch.local.laioutr.tech' }).ogSiteName).toBe('Shop Schweiz');
  });

  it('falls back to the project-wide name for an unknown host', () => {
    expect(build({ host: 'preview.example.com', siteName: 'Shop' }).ogSiteName).toBe('Shop');
  });

  it('falls back to the project-wide name when no domain resolved at all', () => {
    expect(build({ host: undefined, siteName: 'Shop' }).ogSiteName).toBe('Shop');
  });

  it('is omitted when neither the host nor the project names the site', () => {
    expect(build({ host: undefined, siteName: undefined }).ogSiteName).toBeUndefined();
  });
});
