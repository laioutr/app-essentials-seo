import { CONFIGURED_PAGES_TOKEN, buildSitemapName } from './sitemapName';
import { isDynamicPath } from './pageSelection';
import type { ResolvedOptions } from '../../types';

/** Chunk size for a single child sitemap. The protocol caps a sitemap file at 50 000 URLs. */
const SITEMAP_CHUNK_SIZE = 50_000;

/** Paths that are never useful to a crawler. Kept independent of sitemap exclusions on purpose:
 *  Disallow stops crawling, which stops a `noindex` from ever being read. */
const INTERNAL_DISALLOW = ['/api/', '/_laioutr/'];

interface RcDomain {
  id: string;
  host: string;
  path?: string;
  languageId: string;
}

interface RcMarketLike {
  id: string;
  name: string;
  defaultDomainId?: string;
  domains: Record<string, RcDomain>;
}

interface RcPageLike {
  id: string;
  type: string;
  path: string | Record<string, string>;
}

export interface LaioutrRcLike {
  config?: { trailingSlash?: boolean };
  languages?: Record<string, { id: string; code: string }>;
  markets?: Record<string, RcMarketLike>;
  pages?: Record<string, RcPageLike>;
}

export interface SitemapSourceDescriptor {
  name: string;
  /** null on the configured-pages source. */
  token: string | null;
  locale: string;
}

/** The `nuxt-site-config` shape this module derives. Never carries `url` — that's left for
 *  `nuxt-site-config` to resolve per request from the incoming host. */
export interface DerivedSiteConfig {
  env: string;
  trailingSlash: boolean;
  multiTenancy: Array<{ hosts: string[]; config: { name: string; defaultLocale?: string } }>;
  /** Only set when the project named the site; otherwise each market's own name is used. */
  name?: string;
  /** Left unset on 'auto' so the environment decides. */
  indexable?: boolean;
}

const DEV_DOMAIN = 'local.laioutr.tech';

/** Mirrors frontend-core's devHost derivation so a market resolves in local development. */
const toDevHost = (host: string): string => {
  const stripped = host.replace(/^www\./, '');
  const sanitized = stripped
    .replace(/\.|\//g, '-')
    .replace(/[^0-9a-z-]/gi, '')
    .toLowerCase();
  return `${sanitized}.${DEV_DOMAIN}`;
};

const resolveEnv = (options: ResolvedOptions, env: NodeJS.ProcessEnv): string =>
  options.environment ?? env.NUXT_SITE_ENV ?? env.NUXT_PUBLIC_SITE_ENV ?? env.VERCEL_ENV ?? 'production';

export const toUpstreamConfig = (input: { laioutrrc: LaioutrRcLike; options: ResolvedOptions; env: NodeJS.ProcessEnv }) => {
  const { laioutrrc, options, env } = input;
  const languages = Object.values(laioutrrc.languages ?? {});
  const markets = Object.values(laioutrrc.markets ?? {});
  const pages = Object.values(laioutrrc.pages ?? {});
  const localeOf = (languageId: string) => languages.find((language) => language.id === languageId)?.code;

  const locales = [...new Set(languages.map((language) => language.code))];

  const dynamicTokens = [
    ...new Set(
      pages
        .filter((page) => isDynamicPath(page.path))
        .map((page) => page.type)
        .filter((type) => type !== 'core/404' && !options.sitemap.excludePageTypes.includes(type))
    ),
  ];

  const sources: SitemapSourceDescriptor[] = [
    ...locales.map((locale) => ({
      name: buildSitemapName(CONFIGURED_PAGES_TOKEN, locale),
      token: null,
      locale,
    })),
    ...dynamicTokens.flatMap((token) => locales.map((locale) => ({ name: buildSitemapName(token, locale), token, locale }))),
  ];

  const sitemaps = Object.fromEntries(
    sources.map((source) => [source.name, { chunks: true, chunkSize: SITEMAP_CHUNK_SIZE, includeAppSources: false }])
  );

  const site: DerivedSiteConfig = {
    env: resolveEnv(options, env),
    trailingSlash: laioutrrc.config?.trailingSlash ?? false,
    multiTenancy: markets.flatMap((market) =>
      Object.values(market.domains).map((domain) => ({
        hosts: [domain.host, toDevHost(domain.host)],
        config: {
          name: options.siteName ?? market.name,
          defaultLocale: localeOf(domain.languageId),
        },
      }))
    ),
  };
  if (options.siteName) site.name = options.siteName;
  // 'auto' leaves it unset so getSiteIndexable falls back to env === 'production'.
  if (options.indexable !== 'auto') site.indexable = options.indexable === 'always';

  return {
    site,
    sitemap: {
      enabled: options.sitemap.enabled,
      sitemaps,
      excludeAppSources: true,
      // Its key composition is undocumented and one build serves every market's host, so a
      // non-host-keyed entry could serve one host's URLs on another.
      cacheMaxAgeSeconds: 0,
      defaults: {
        ...(options.sitemap.defaultChangefreq ? { changefreq: options.sitemap.defaultChangefreq } : {}),
        ...(options.sitemap.defaultPriority !== undefined ? { priority: options.sitemap.defaultPriority } : {}),
      },
    },
    robots: {
      enabled: options.robots.enabled,
      sitemap: ['/sitemap_index.xml'],
      disallow: [...INTERNAL_DISALLOW, ...options.robots.extraDisallow],
      groups: options.robots.customGroups,
      blockAiBots: options.robots.blockAiBots,
      blockNonSeoBots: options.robots.blockNonSeoBots,
      // frontend-core's page renderer already writes this tag and force-overrides preview renders.
      metaTag: false,
    },
    sources,
  };
};
