import { MODULE_NAME } from './moduleName';
import { isDynamicPath } from './pageSelection';
import { buildSitemapName, CONFIGURED_PAGES_TOKEN } from './sitemapName';
import type { ResolvedOptions } from '../../types';
import type { RcMarket, RcMarketDomain, RcProject } from '@laioutr-core/core-types/rc';

/** Chunk size for a single child sitemap. The protocol caps a sitemap file at 50 000 URLs. */
const SITEMAP_CHUNK_SIZE = 50_000;

/** Paths that are never useful to a crawler. Kept independent of sitemap exclusions on purpose:
 *  Disallow stops crawling, which stops a `noindex` from ever being read. */
const INTERNAL_DISALLOW = ['/api/', '/_laioutr/'];

/**
 * Marks a group this module contributed. `mergeDerivedRobots` reads it to tell whether the
 * `nuxt.options.robots` write reached @nuxtjs/robots or was discarded — the two lists it merges
 * alongside are strings it can compare, and a group is not. Underscore-prefixed to sit with the
 * internal fields (`_normalized`, `_rules`, `_skipI18n`) upstream itself hangs off a group, and it
 * survives upstream's `normalizeGroup`, which spreads unknown keys through.
 */
export const LAIOUTR_GROUP = '_laioutrEssentialsSeo';

/**
 * Not `RcProject` itself: `RcProject.laioutr` is a required field carrying a required
 * `projectSecretKey`, but `module.ts` legitimately passes `{}` here for an unconfigured project.
 * Typing that as `RcProject` would assert a guarantee build time does not make. Picking the four
 * keys this module actually reads keeps drift in those shapes build-breaking without over-promising
 * the rest of the project shape.
 */
export type LaioutrRcLike = Partial<Pick<RcProject, 'config' | 'languages' | 'markets' | 'pages'>>;

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

/** Treats an empty or whitespace-only value as unset, so a variable declared but left blank
 *  (e.g. `NUXT_SITE_ENV=` in a Docker or CI config) doesn't short-circuit the fallback chain
 *  before a real value is reached. */
const nonBlank = (value: string | undefined): string | undefined => (value !== undefined && value.trim() !== '' ? value : undefined);

const resolveEnv = (options: ResolvedOptions, env: NodeJS.ProcessEnv): string =>
  options.environment ?? nonBlank(env.NUXT_SITE_ENV) ?? nonBlank(env.NUXT_PUBLIC_SITE_ENV) ?? nonBlank(env.VERCEL_ENV) ?? 'production';

export const toUpstreamConfig = (input: {
  laioutrrc: LaioutrRcLike;
  options: ResolvedOptions;
  env: NodeJS.ProcessEnv;
  /**
   * `nuxt.options.dev`. Deliberately not derived from `resolveEnv` below, which answers a different
   * question and falls back to 'production' when nothing sets it — a plain local `nuxt dev` resolves
   * to 'production' there, so keying developer conveniences off it turns them off where they matter.
   */
  dev: boolean;
}) => {
  const { laioutrrc, options, env, dev } = input;
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

  // nuxt-site-config matches a multiTenancy entry by host alone (first match wins, no path
  // awareness), so entries must be grouped by host rather than emitted one per domain — two
  // domains sharing a host (e.g. a market's root and its /fr path) would otherwise produce a
  // second entry no request could ever reach.
  const domainsByHost = new Map<string, Array<{ domain: RcMarketDomain; market: RcMarket }>>();
  for (const market of markets) {
    for (const domain of Object.values(market.domains)) {
      const entries = domainsByHost.get(domain.host) ?? [];
      entries.push({ domain, market });
      domainsByHost.set(domain.host, entries);
    }
  }

  const multiTenancy = [...domainsByHost.entries()].map(([host, entries]) => {
    // Prefer the market's own default domain when it serves this host, then the domain at the
    // host root (no path), then whichever domain was declared first.
    const primary =
      entries.find(({ domain, market }) => domain.id === market.defaultDomainId) ??
      entries.find(({ domain }) => domain.path === undefined) ??
      entries[0];
    return {
      hosts: [host, toDevHost(host)],
      config: {
        name: options.siteName ?? primary.market.name,
        defaultLocale: localeOf(primary.domain.languageId),
      },
    };
  });

  const resolvedEnv = resolveEnv(options, env);

  const site: DerivedSiteConfig = {
    env: resolvedEnv,
    trailingSlash: laioutrrc.config?.trailingSlash ?? false,
    multiTenancy,
  };
  if (options.siteName) site.name = options.siteName;
  // 'auto' leaves it unset so getSiteIndexable falls back to env === 'production'.
  if (options.indexable !== 'auto') site.indexable = options.indexable === 'always';

  // An explicit `indexable` deliberately outranks the environment, so this deployment will be
  // crawled even though it is not production. Checked against the resolved environment, not the
  // raw option, so the env-variable fallbacks count too.
  if (options.indexable === 'always' && resolvedEnv !== 'production') {
    console.warn(
      `[${MODULE_NAME}] indexable is 'always' on a "${resolvedEnv}" deployment, so search engines ` +
        'will index it. Its URLs can then compete with production for the same content. ' +
        "Use indexable: 'auto' to let the environment decide, or 'never' to keep this deployment out of search."
    );
  }

  return {
    site,
    sitemap: {
      enabled: options.sitemap.enabled,
      sitemaps,
      excludeAppSources: true,
      // Its key composition is undocumented and one build serves every market's host, so a
      // non-host-keyed entry could serve one host's URLs on another.
      cacheMaxAgeSeconds: 0,
      // The XSL stylesheet renders a sitemap readably in a browser, which is worth having while
      // developing and nothing but a shipped convenience once deployed — crawlers ignore it. Left
      // unset under dev so the upstream default applies; `false` elsewhere suppresses the
      // <?xml-stylesheet?> instruction on both the index and the child sitemaps, and stops the
      // /__sitemap__/style.xsl route being registered. A project that wants it back can still set
      // `sitemap.xsl` in app config, which outranks this.
      ...(dev ? {} : { xsl: false as const }),
      defaults: {
        ...(options.sitemap.defaultChangefreq ? { changefreq: options.sitemap.defaultChangefreq } : {}),
        ...(options.sitemap.defaultPriority === undefined ? {} : { priority: options.sitemap.defaultPriority }),
      },
    },
    robots: {
      enabled: options.robots.enabled,
      sitemap: ['/sitemap_index.xml'],
      disallow: [...INTERNAL_DISALLOW, ...options.robots.extraDisallow],
      groups: options.robots.customGroups.map((group) => ({ ...group, [LAIOUTR_GROUP]: true })),
      blockAiBots: options.robots.blockAiBots,
      blockNonSeoBots: options.robots.blockNonSeoBots,
      // frontend-core's page renderer already writes this tag and force-overrides preview renders.
      metaTag: false,
    },
    sources,
  };
};
