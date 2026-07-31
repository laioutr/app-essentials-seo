import { defu } from 'defu';
import { MODULE_NAME, RobotsOptionsSchema, SitemapOptionsSchema } from './types';
import type { DerivedSiteConfig } from './runtime/shared/toUpstreamConfig';

/**
 * The slice of `DerivedSiteConfig.site` this function actually reads, with `multiTenancy` entries
 * loosened to their `hosts` field — the only one the host-count warning below needs.
 */
type DerivedSiteInput = Partial<Omit<DerivedSiteConfig, 'multiTenancy'>> & {
  multiTenancy?: Array<Pick<DerivedSiteConfig['multiTenancy'][number], 'hosts'>>;
};

// Field names our own curated schema defines for `sitemap`/`robots`. A developer's app config is
// shaped like this schema, not like the upstream module it eventually lands on, so these names must
// never reach `nuxtOptions.sitemap`/`.robots` directly — `blockNonSeoBots` happens to be both a
// curated field and a real @nuxtjs/robots option, so leaving it in would let the raw app value win
// over the one we derived, by coincidence of naming rather than by design.
const SITEMAP_CURATED_KEYS = Object.keys(SitemapOptionsSchema.shape);
const ROBOTS_CURATED_KEYS = Object.keys(RobotsOptionsSchema.shape);

/** Copies `source` with the given keys removed, so only genuine upstream escape-hatch fields survive. */
const omitCuratedKeys = (source: any, curatedKeys: string[]): any => {
  if (!source) return source;
  const result = { ...source };
  for (const key of curatedKeys) delete result[key];
  return result;
};

/**
 * Merges derived, developer and app config onto the upstream module keys. App config wins so a
 * Cockpit change always takes visible effect; a raw `nuxt.config` value stays available for anything
 * the curated schema does not expose. `defu` concatenates arrays, so disallow lists compose.
 */
export const applyUpstreamConfig = (
  nuxtOptions: Record<string, any>,
  derived: { site: DerivedSiteInput; sitemap: any; robots: any },
  appConfig: { site?: any; sitemap?: any; robots?: any }
): void => {
  const hostCount = (derived.site.multiTenancy ?? []).length;
  // A developer can set `site.url` either as a raw nuxt.config value or, since our curated schema
  // has no `site` field, only by smuggling it into the app config escape hatch — both must be checked.
  const siteUrl = appConfig.site?.url ?? nuxtOptions.site?.url;
  if (siteUrl && hostCount > 1) {
    console.warn(
      `[${MODULE_NAME}] site.url is set but ${hostCount} hosts are configured. ` +
        'Every market will emit URLs on that one origin; leave it unset so each request derives its own host.'
    );
  }
  nuxtOptions.site = defu(appConfig.site, nuxtOptions.site, derived.site);
  nuxtOptions.sitemap = defu(omitCuratedKeys(appConfig.sitemap, SITEMAP_CURATED_KEYS), nuxtOptions.sitemap, derived.sitemap);
  nuxtOptions.robots = defu(omitCuratedKeys(appConfig.robots, ROBOTS_CURATED_KEYS), nuxtOptions.robots, derived.robots);
};
