import { beforeEach, describe, expect, it } from 'vitest';
import { resolveOptions } from '../../src/types';
import { __resetSitemapNames } from '../../src/runtime/shared/sitemapName';
import { toUpstreamConfig } from '../../src/runtime/shared/toUpstreamConfig';

const laioutrrc = {
  config: { trailingSlash: false },
  languages: {
    lng_de: { id: 'lng_de', code: 'de', name: 'German', fallbacks: [] },
    lng_fr: { id: 'lng_fr', code: 'fr', name: 'French', fallbacks: [] },
  },
  markets: {
    mkt_ch: {
      id: 'mkt_ch',
      slug: 'switzerland',
      name: 'Switzerland',
      currency: 'CHF',
      regionCodes: ['CH'],
      defaultDomainId: 'dom_ch_de',
      domains: {
        dom_ch_de: { id: 'dom_ch_de', host: 'shop.ch', languageId: 'lng_de' },
        dom_ch_fr: { id: 'dom_ch_fr', host: 'shop.ch', path: '/fr', languageId: 'lng_fr' },
      },
      studio: {},
    },
    mkt_de: {
      id: 'mkt_de',
      slug: 'germany',
      name: 'Germany',
      currency: 'EUR',
      regionCodes: ['DE'],
      defaultDomainId: 'dom_de_de',
      domains: { dom_de_de: { id: 'dom_de_de', host: 'shop.de', languageId: 'lng_de' } },
      studio: {},
    },
  },
  pages: {
    p_home: { id: 'p_home', type: 'core/home', path: '/', variants: {}, createdAt: '', updatedAt: '' },
    p_pdp: {
      id: 'p_pdp',
      type: 'ecommerce/product-detail-page',
      path: { de: '/produkte/:slug+', fr: '/produits/:slug+' },
      variants: {},
      createdAt: '',
      updatedAt: '',
    },
    p_404: { id: 'p_404', type: 'core/404', path: '/:catchall*', variants: {}, createdAt: '', updatedAt: '' },
  },
  apps: [],
};

const build = (overrides = {}, env: NodeJS.ProcessEnv = {}) =>
  toUpstreamConfig({ laioutrrc: laioutrrc as never, options: resolveOptions(overrides), env });

beforeEach(() => __resetSitemapNames());

describe('toUpstreamConfig — site', () => {
  it('never sets site.url so nuxt-site-config derives it per request', () => {
    expect(build().site).not.toHaveProperty('url');
  });

  it('derives trailingSlash from laioutrrc rather than asking for it', () => {
    expect(build().site.trailingSlash).toBe(false);
  });

  it('builds one multiTenancy entry per domain, carrying host and devHost', () => {
    const hosts = build().site.multiTenancy.map((entry) => entry.hosts);
    expect(hosts).toHaveLength(3);
    expect(hosts.flat()).toContain('shop.ch');
    expect(hosts.flat()).toContain('shop.de');
  });

  it('derives the dev host from the platform convention, stripping a www. prefix', () => {
    const entry = build().site.multiTenancy.find((candidate) => candidate.hosts.includes('shop.ch'));
    expect(entry).toBeDefined();
    expect(entry!.hosts).toContain('shop-ch.local.laioutr.tech');

    const rcWithWww = {
      ...laioutrrc,
      markets: {
        ...laioutrrc.markets,
        mkt_ch: {
          ...laioutrrc.markets.mkt_ch,
          domains: {
            dom_ch_de: { id: 'dom_ch_de', host: 'www.shop.ch', languageId: 'lng_de' },
          },
        },
      },
    };
    const wwwEntry = toUpstreamConfig({
      laioutrrc: rcWithWww as never,
      options: resolveOptions({}),
      env: {},
    }).site.multiTenancy.find((candidate) => candidate.hosts.includes('www.shop.ch'));
    expect(wwwEntry).toBeDefined();
    expect(wwwEntry!.hosts).toContain('shop-ch.local.laioutr.tech');
  });

  it('resolves env from options first', () => {
    expect(build({ environment: 'staging' }, { VERCEL_ENV: 'production' }).site.env).toBe('staging');
  });

  it('falls back to NUXT_SITE_ENV, then VERCEL_ENV, then production', () => {
    expect(build({}, { NUXT_SITE_ENV: 'uat', VERCEL_ENV: 'production' }).site.env).toBe('uat');
    expect(build({}, { VERCEL_ENV: 'preview' }).site.env).toBe('preview');
    expect(build({}, {}).site.env).toBe('production');
  });

  it('leaves indexable unset on auto so env decides', () => {
    expect(build().site).not.toHaveProperty('indexable');
    expect(build({ indexable: 'never' }).site.indexable).toBe(false);
    expect(build({ indexable: 'always' }).site.indexable).toBe(true);
  });
});

describe('toUpstreamConfig — sources', () => {
  it('emits one configured-pages source per locale', () => {
    const names = build()
      .sources.filter((s) => s.token === null)
      .map((s) => s.name);
    expect(names.sort()).toEqual(['pages-de', 'pages-fr']);
  });

  it('emits one source per dynamic page type per locale', () => {
    const names = build()
      .sources.filter((s) => s.token === 'ecommerce/product-detail-page')
      .map((s) => s.name);
    expect(names.sort()).toEqual(['ecommerce-product-detail-page-de', 'ecommerce-product-detail-page-fr']);
  });

  it('never emits a source for the catch-all page type', () => {
    expect(build().sources.some((s) => s.token === 'core/404')).toBe(false);
  });

  it('omits an excluded page type entirely', () => {
    const sources = build({ sitemap: { excludePageTypes: ['ecommerce/product-detail-page'] } }).sources;
    expect(sources.some((s) => s.token === 'ecommerce/product-detail-page')).toBe(false);
  });

  it('registers every source name in the sitemap config with chunking on', () => {
    const config = build();
    for (const source of config.sources) {
      expect(config.sitemap.sitemaps[source.name]).toEqual({ chunks: true, chunkSize: 50_000, includeAppSources: false });
    }
  });

  it('excludes app sources so laioutr param templates never leak in', () => {
    expect(build().sitemap.excludeAppSources).toBe(true);
  });

  it('disables the module output cache because its key is not host-aware', () => {
    expect(build().sitemap.cacheMaxAgeSeconds).toBe(0);
  });
});

describe('toUpstreamConfig — robots', () => {
  it('points at a relative sitemap so each host resolves its own', () => {
    expect(build().robots.sitemap).toEqual(['/sitemap_index.xml']);
  });

  it('disallows laioutr internals and appends project rules', () => {
    expect(build({ robots: { extraDisallow: ['/secret'] } }).robots.disallow).toEqual(['/api/', '/_laioutr/', '/secret']);
  });

  it('leaves the robots meta tag to frontend-core', () => {
    expect(build().robots.metaTag).toBe(false);
  });
});
