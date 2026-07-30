import { addServerPlugin, createResolver, defineNuxtModule, installModule } from '@nuxt/kit';
import { defu } from 'defu';
import { registerLaioutrApp } from '@laioutr-core/kit';
import { MODULE_NAME, resolveOptions } from './types';
import { toUpstreamConfig } from './runtime/shared/toUpstreamConfig';
import type { ModuleOptions } from './types';
import type { DerivedSiteConfig } from './runtime/shared/toUpstreamConfig';
import { version } from '../package.json';

export type { ModuleOptions } from './types';

/**
 * The slice of `DerivedSiteConfig.site` this function actually reads, with `multiTenancy` entries
 * loosened to their `hosts` field — the only one the host-count warning below needs.
 */
type DerivedSiteInput = Partial<Omit<DerivedSiteConfig, 'multiTenancy'>> & {
  multiTenancy?: Array<Pick<DerivedSiteConfig['multiTenancy'][number], 'hosts'>>;
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
  if (appConfig.site?.url && hostCount > 1) {
    console.warn(
      `[${MODULE_NAME}] site.url is set but ${hostCount} hosts are configured. ` +
        'Every market will emit URLs on that one origin; leave it unset so each request derives its own host.'
    );
  }
  nuxtOptions.site = defu(appConfig.site, nuxtOptions.site, derived.site);
  nuxtOptions.sitemap = defu(appConfig.sitemap, nuxtOptions.sitemap, derived.sitemap);
  nuxtOptions.robots = defu(appConfig.robots, nuxtOptions.robots, derived.robots);
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

    await registerLaioutrApp({
      name: MODULE_NAME,
      version,
      orchestrDirs: [resolveRuntimeModule('server/orchestr')],
      sections: [resolveRuntimeModule('app/sections')],
      blocks: [resolveRuntimeModule('app/blocks')],
    });

    addServerPlugin(resolve('./runtime/server/nitro/sitemap'));

    // Install peer-dependency modules only on prepare-step.
    // This makes auto-imports and import-aliases work. Remove any modules you might not need.
    if (nuxt.options._prepare) {
      await installModule('@nuxt/image');
      await installModule('@laioutr-core/frontend-core');
      await installModule('@laioutr-core/orchestr');
      await installModule('@laioutr-app/ui');
    }

    // Installed unconditionally: these are this package's own dependencies, not peer modules the
    // consuming app supplies.
    await installModule('@nuxtjs/sitemap');
    await installModule('@nuxtjs/robots');
  },
});
