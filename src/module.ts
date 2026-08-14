import { addServerPlugin, createResolver, defineNuxtModule, installModule } from '@nuxt/kit';
import { defu } from 'defu';
import { toUpstreamConfig } from './runtime/shared/toUpstreamConfig';
import { MODULE_NAME, resolveOptions } from './types';
import { applyUpstreamConfig, mergeDerivedRobots } from './upstreamConfig';
import { registerLaioutrApp } from '@laioutr-core/kit';
import type { ModuleOptions } from './types';
import { version } from '../package.json';

export type { ModuleOptions } from './types';
// This file is the package entry, so these re-exports are what let a consumer name the payload of
// `essentials-seo:sitemap-source:built`. The `nitropack` augmentation types that payload inline,
// which covers a handler written in place but not one lifted out into its own named function.
export type { SitemapUrl } from './runtime/server/lib/alternates';
export type { SitemapSourceBuiltContext } from './runtime/types/sitemapSource';

export default defineNuxtModule<ModuleOptions>({
  meta: { name: MODULE_NAME, version, configKey: MODULE_NAME },
  defaults: {},
  async setup(rawOptions, nuxt) {
    const { resolve } = createResolver(import.meta.url);
    const resolveRuntimeModule = (path: string) => resolve('./runtime', path);

    nuxt.options.build.transpile.push(resolve('./runtime'));

    const options = resolveOptions(rawOptions);
    const laioutrrc = (nuxt.options as any).laioutr?.laioutrrc ?? {};
    const derived = toUpstreamConfig({ laioutrrc, options, env: process.env, dev: nuxt.options.dev });

    nuxt.options.runtimeConfig[MODULE_NAME] = defu(nuxt.options.runtimeConfig[MODULE_NAME], {
      ...options,
      sources: derived.sources,
    });

    applyUpstreamConfig(nuxt.options as any, derived, rawOptions as any);

    // See mergeDerivedRobots for why our sitemap, disallow and group entries have to land here and
    // not only through the nuxt.options.robots write above.
    nuxt.hook('robots:config', (config) => mergeDerivedRobots(config, derived.robots));

    await registerLaioutrApp({
      name: MODULE_NAME,
      version,
      orchestrDirs: [resolveRuntimeModule('server/orchestr')],
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
    // consuming app supplies. This app owns robots.txt in a Laioutr frontend, but its peer range
    // still spans @laioutr-core/frontend-core versions that install @nuxtjs/robots themselves, and a
    // project can always install it directly — the robots:config hook above covers both.
    await installModule('@nuxtjs/sitemap');
    await installModule('@nuxtjs/robots');
  },
});
