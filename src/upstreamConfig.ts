import { defu } from 'defu';
import { LAIOUTR_GROUP } from './runtime/shared/toUpstreamConfig';
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

/** Reads a group field that may be a single value or an array, as an array. */
const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

/**
 * The slice of a @nuxtjs/robots group this function reads. Matched structurally rather than
 * imported: upstream does not export its group type from the package root.
 */
interface UpstreamRobotsGroup {
  userAgent?: string | string[];
  disallow?: string | string[];
}

/** The slice of @nuxtjs/robots' resolved options this module contributes to. */
interface UpstreamRobotsConfig {
  sitemap: string[];
  groups: UpstreamRobotsGroup[];
}

/**
 * Folds this module's derived robots config into upstream's own, from inside the `robots:config`
 * hook.
 *
 * The `nuxt.options.robots` write in `applyUpstreamConfig` only reaches @nuxtjs/robots if this
 * module is the first to install it: `installModule` dedupes by module name, so whoever installs it
 * first is the one whose setup reads those options, and every later install is a no-op that silently
 * discards the write. Anything ahead of this module in `modules[]` can win that race — a project's
 * own @nuxtjs/robots entry, another app, or a @laioutr-core/frontend-core old enough to still
 * install it itself. The hook runs once every module's setup has finished, whatever the order, so
 * this is what makes our entries land regardless.
 *
 * It must not overwrite the arrays outright — a project's own rules, and any other app's
 * contributions, live there too. The sitemap and disallow entries are strings, so they dedupe by
 * value. Custom groups cannot, so they carry `LAIOUTR_GROUP` instead: one already in `config.groups`
 * means the write was read and re-adding them would emit every group twice; none means the write was
 * discarded and this hook is the only path left. Groups added here are still normalized by upstream
 * — it maps `normalizeGroup` over the list again after this hook, so the shorthands the curated
 * schema accepts are resolved the same way whichever path the group arrived by.
 */
export const mergeDerivedRobots = (
  config: UpstreamRobotsConfig,
  derived: { sitemap: string[]; disallow: string[]; groups: UpstreamRobotsGroup[] }
): void => {
  for (const sitemapUrl of derived.sitemap) {
    if (!config.sitemap.includes(sitemapUrl)) config.sitemap.push(sitemapUrl);
  }

  const wildcardGroup = config.groups.find((group) => {
    const userAgents = asArray(group.userAgent);
    return userAgents.length === 1 && userAgents[0] === '*';
  });
  if (wildcardGroup) {
    const disallow = asArray(wildcardGroup.disallow);
    for (const path of derived.disallow) {
      if (!disallow.includes(path)) disallow.push(path);
    }
    wildcardGroup.disallow = disallow;
  }

  if (!config.groups.some((group) => LAIOUTR_GROUP in group)) config.groups.push(...derived.groups);
};
