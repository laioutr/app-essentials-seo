import { addServerPlugin, createResolver, defineNuxtModule, installModule } from '@nuxt/kit';
import { defu } from 'defu';
import { toUpstreamConfig } from './runtime/shared/toUpstreamConfig';
import { MODULE_NAME, resolveOptions, RobotsOptionsSchema, SitemapOptionsSchema } from './types';
import { registerLaioutrApp } from '@laioutr-core/kit';
import type { DerivedSiteConfig } from './runtime/shared/toUpstreamConfig';
import type { ModuleOptions } from './types';
import { version } from '../package.json';

export type { ModuleOptions } from './types';

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

/** Reads a `RobotsGroupInput` field that may be a single value or an array, as an array. */
const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

export default defineNuxtModule<ModuleOptions>({
  meta: { name: MODULE_NAME, version, configKey: MODULE_NAME },
  defaults: {},
  async setup(rawOptions, nuxt) {
    const { resolve } = createResolver(import.meta.url);
    const resolveRuntimeModule = (path: string) => resolve('./runtime', path);

    nuxt.options.build.transpile.push(resolve('./runtime'));

    const options = resolveOptions(rawOptions);
    const laioutrrc = (nuxt.options as any).laioutr?.laioutrrc ?? {};
    const derived = toUpstreamConfig({ laioutrrc, options, env: process.env });

    nuxt.options.runtimeConfig[MODULE_NAME] = defu(nuxt.options.runtimeConfig[MODULE_NAME], {
      ...options,
      sources: derived.sources,
    });

    applyUpstreamConfig(nuxt.options as any, derived, rawOptions as any);

    // @laioutr-core/frontend-core installs @nuxtjs/robots itself, unconditionally, from its own
    // setup — and Nuxt's installModule dedupes by module name, so whichever of the two modules a
    // developer lists first in nuxt.config.ts is the one whose setup actually configures robots;
    // the nuxt.options.robots write above is silently discarded when frontend-core wins that race.
    // This hook runs once every module's setup has finished, regardless of install order, so it is
    // what makes our sitemap and disallow entries land no matter who installed robots first. It
    // must not overwrite the arrays outright — a project's own rules, and any other app's
    // contributions, live there too.
    nuxt.hook('robots:config', (config) => {
      for (const sitemapUrl of derived.robots.sitemap) {
        if (!config.sitemap.includes(sitemapUrl)) config.sitemap.push(sitemapUrl);
      }
      const wildcardGroup = config.groups.find((group) => {
        const userAgents = asArray(group.userAgent);
        return userAgents.length === 1 && userAgents[0] === '*';
      });
      if (wildcardGroup) {
        const disallow = asArray(wildcardGroup.disallow);
        for (const path of derived.robots.disallow) {
          if (!disallow.includes(path)) disallow.push(path);
        }
        wildcardGroup.disallow = disallow;
      }
    });

    await registerLaioutrApp({
      name: MODULE_NAME,
      version,
      orchestrDirs: [resolveRuntimeModule('server/orchestr')],
      sections: [resolveRuntimeModule('app/sections')],
      blocks: [resolveRuntimeModule('app/blocks')],
    });

    addServerPlugin(resolve('./runtime/server/nitro/sitemap'));

    // Installed on the prepare step alone, so `#laioutr/*` and the orchestr server imports this
    // module's runtime resolves against exist when types are generated.
    //
    // frontend-core is the only one worth naming. It installs orchestr itself, so listing that here
    // too would only hit `defineNuxtModule`'s already-installed short-circuit. @nuxt/image would be
    // worse than redundant: frontend-core installs it *with* the image-provider config it collects
    // from the configured apps, and whichever install runs first wins, so a bare one here can beat it
    // and leave that config to be merged in after the module has already read its options. Nothing in
    // this package renders, so no component library belongs here either.
    if (nuxt.options._prepare) {
      await installModule('@laioutr-core/frontend-core');
    }

    // Installed unconditionally: these are this package's own dependencies, not peer modules the
    // consuming app supplies. @laioutr-core/frontend-core also installs @nuxtjs/robots today; the
    // robots:config hook registered above is what keeps our config correct regardless of which of
    // the two wins the install.
    await installModule('@nuxtjs/sitemap');
    await installModule('@nuxtjs/robots');
  },
});
