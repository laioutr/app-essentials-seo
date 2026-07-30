import { describe, expect, it } from 'vitest';
import { buildConfiguredPageUrls } from '../../src/runtime/server/lib/configuredPageUrls';

const de = { id: 'lng_de', code: 'de', localeChain: ['de'] };
const chDe = { host: 'shop.ch', languageId: 'lng_de', language: de };
const marketCh = { id: 'mkt_ch', domains: [chDe], defaultDomain: chDe };
const markets = [marketCh] as never;

const variant = (robots?: string) => ({ seo: { title: '', description: '', ...(robots ? { robots } : {}) } });

const pages = {
  home: { id: 'home', type: 'core/home', path: '/', variants: { a: variant() }, updatedAt: '2026-01-01T00:00:00Z' },
  pricing: { id: 'pricing', type: 'core/landingpage', path: '/preise', variants: { a: variant() }, updatedAt: '2026-02-01T00:00:00Z' },
  hidden: { id: 'hidden', type: 'core/landingpage', path: '/intern', variants: { a: variant('noindex') }, updatedAt: '' },
  notFound: { id: 'notFound', type: 'core/404', path: '/:catchall*', variants: { a: variant() }, updatedAt: '' },
  pdp: { id: 'pdp', type: 'ecommerce/product-detail-page', path: '/produkte/:slug', variants: { a: variant() }, updatedAt: '' },
  otherMarket: { id: 'om', type: 'core/landingpage', path: '/nur-de', marketIds: ['mkt_de'], variants: { a: variant() }, updatedAt: '' },
};

const build = (overrides = {}) =>
  buildConfiguredPageUrls({
    pages: pages as never,
    market: marketCh as never,
    domain: chDe as never,
    markets,
    trailingSlash: false,
    excludePageTypes: [],
    pageTypeSeo: {},
    ...overrides,
  });

describe('buildConfiguredPageUrls', () => {
  it('includes only parameterless pages', () => {
    const locs = build().map((url) => url.loc);
    expect(locs).toContain('/');
    expect(locs).toContain('/preise');
    expect(locs.some((loc) => loc.includes('produkte'))).toBe(false);
  });

  it('drops the catch-all, noindex pages and other markets pages', () => {
    const locs = build().map((url) => url.loc);
    expect(locs.some((loc) => loc.includes('catchall'))).toBe(false);
    expect(locs).not.toContain('/intern');
    expect(locs).not.toContain('/nur-de');
  });

  it('carries lastmod from the page updatedAt', () => {
    expect(build().find((url) => url.loc === '/preise')?.lastmod).toBe('2026-02-01T00:00:00Z');
  });

  it('applies per-page-type priority and changefreq', () => {
    const urls = build({ pageTypeSeo: { 'core/home': { priority: 1, changefreq: 'daily' } } });
    const home = urls.find((url) => url.loc === '/');
    expect(home?.priority).toBe(1);
    expect(home?.changefreq).toBe('daily');
  });

  it('omits a page type turned off with include false', () => {
    const urls = build({ pageTypeSeo: { 'core/landingpage': { include: false } } });
    expect(urls.map((url) => url.loc)).not.toContain('/preise');
  });

  it('attaches cross-host alternates', () => {
    expect(build().find((url) => url.loc === '/preise')?.alternatives).toContainEqual({
      hreflang: 'de',
      href: 'https://shop.ch/preise',
    });
  });
});
