import { beforeEach, describe, expect, it } from 'vitest';
import { buildLlmsTxtModel, humanizePageType, toUrlPattern } from '../../src/runtime/server/lib/llmsTxt/model';
import { __resetSitemapNames } from '../../src/runtime/shared/sitemapName';
import { resolveOptions } from '../../src/types';

const de = { id: 'lng_de', code: 'de', name: 'German', localeChain: ['de'] };
const fr = { id: 'lng_fr', code: 'fr', name: 'French', localeChain: ['fr'] };
const chDe = { id: 'd1', host: 'shop.ch', devHost: 'shop-ch.local', language: de };
const chFr = { id: 'd2', host: 'shop.ch', path: '/fr', devHost: 'shop-ch.local', language: fr };
const ch = { id: 'mkt_ch', name: 'Switzerland', isIndexable: true, domains: [chDe, chFr], defaultDomain: chDe };
const i18nConfig = { hostToMarket: { 'shop.ch': ch }, defaultMarket: ch, markets: [ch] } as never;

const variant = (seo: Record<string, unknown>) => ({ v: { id: 'v', seo: { title: {}, description: {}, ...seo } } });
const pages = {
  home: { id: 'home', type: 'core/home', path: '/', variants: variant({ title: { de: 'Startseite' }, description: { de: 'Willkommen' } }) },
  hidden: { id: 'hidden', type: 'core/landingpage', path: '/intern', variants: variant({ robots: 'noindex' }) },
  templated: { id: 'templated', type: 'core/contentpage', path: '/info', variants: variant({ title: { de: '{{ queries.x.title }}' } }) },
  pdp: { id: 'pdp', type: 'test/product', path: { de: '/produkte/:slug', fr: '/produits/:slug' }, variants: variant({}) },
  article: { id: 'article', type: 'test/article', path: '/artikel/:slug(\\d+)', variants: variant({}) },
} as never;

const build = (overrides: Record<string, unknown> = {}) =>
  buildLlmsTxtModel({
    host: 'shop.ch',
    origin: 'https://shop.ch',
    site: { name: 'Switzerland', description: 'Swiss shop', indexable: true },
    i18nConfig,
    pages,
    trailingSlash: false,
    excludePageTypes: [],
    llmsTxt: resolveOptions(undefined).aiReady.llmsTxt,
    dynamicTokens: ['test/product', 'test/article'],
    readSnapshot: async () => null,
    now: 1_000,
    ...overrides,
  } as never);

beforeEach(() => __resetSitemapNames());

describe('buildLlmsTxtModel', () => {
  it('lists configured, indexable pages in the default language, linking twins', async () => {
    const model = await build();
    expect(model.pages).toEqual([
      { path: '/', href: 'https://shop.ch/index.md', title: 'Startseite', description: 'Willkommen' },
      { path: '/info', href: 'https://shop.ch/info.md', title: undefined, description: undefined },
    ]);
  });

  it('links canonical URLs when markdownLinks is off', async () => {
    const llmsTxt = resolveOptions({ aiReady: { llmsTxt: { markdownLinks: false } } }).aiReady.llmsTxt;
    expect((await build({ llmsTxt })).pages[0]!.href).toBe('https://shop.ch/');
  });

  it('summarises each dynamic page type by its route pattern', async () => {
    const model = await build();
    expect(model.pageTypes).toEqual([
      { title: 'Product', description: undefined, pattern: '/produkte/{slug}', href: 'https://shop.ch/__sitemap__/test-product-de.xml', count: undefined },
      { title: 'Article', description: undefined, pattern: '/artikel/{slug}', href: 'https://shop.ch/__sitemap__/test-article-de.xml', count: undefined },
    ]);
  });

  it('counts a page type only from a complete, live snapshot', async () => {
    const snapshot = (complete: boolean) => ({ urls: [{ loc: 'a' }, { loc: 'b' }], complete, expiresAt: 5_000, refreshAt: 4_000 });
    expect((await build({ readSnapshot: async () => snapshot(true) })).pageTypes[0]!.count).toBe(2);
    expect((await build({ readSnapshot: async () => snapshot(false) })).pageTypes[0]!.count).toBeUndefined();
  });

  it('applies authored titles and hides types set to false', async () => {
    const llmsTxt = resolveOptions({
      aiReady: { llmsTxt: { pageTypes: { 'test/product': { title: 'Products', description: 'Shoes.' }, 'test/article': false } } },
    }).aiReady.llmsTxt;
    const model = await build({ llmsTxt });
    expect(model.pageTypes).toHaveLength(1);
    expect(model.pageTypes[0]).toMatchObject({ title: 'Products', description: 'Shoes.' });
  });

  it('lists the host languages, default first', async () => {
    expect((await build()).languages).toEqual([
      { code: 'de', name: 'German', href: 'https://shop.ch/index.md', isDefault: true },
      { code: 'fr', name: 'French', href: 'https://shop.ch/fr.md', isDefault: false },
    ]);
  });

  it('adds sitemap and robots to the resources', async () => {
    expect((await build()).resources.map((link) => link.href)).toEqual(['https://shop.ch/sitemap_index.xml', 'https://shop.ch/robots.txt']);
  });

  it('lists no pages for a non-indexable deployment or market', async () => {
    const preview = await build({ site: { name: 'Switzerland', indexable: false } });
    expect(preview.pages).toEqual([]);
    expect(preview.pageTypes).toEqual([]);
    const draft = { ...ch, isIndexable: false };
    const unlaunched = await build({ i18nConfig: { hostToMarket: { 'shop.ch': draft }, defaultMarket: draft } });
    expect(unlaunched.pages).toEqual([]);
  });
});

describe('helpers', () => {
  it('writes route params as {name}', () => {
    expect(toUrlPattern('/p/:slug')).toBe('/p/{slug}');
    expect(toUrlPattern('/a/:year(\\d+)/:rest*')).toBe('/a/{year}/{rest}');
  });

  it('humanizes the last token segment', () => {
    expect(humanizePageType('ecommerce/product-detail-page')).toBe('Product Detail Page');
    expect(humanizePageType('test/product')).toBe('Product');
  });
});
