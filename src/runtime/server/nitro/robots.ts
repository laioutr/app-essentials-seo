import { getRequestHost } from 'h3';
import { defineNitroPlugin, useRuntimeConfig } from '#imports';
import type { ResolvedOptions } from '../../../types';
import { MODULE_NAME } from '../../shared/moduleName';
import { hostPathPrefixes, localizeRobotsTxt } from '../lib/robotsLocale';
// #laioutr/i18n-config is a virtual Nitro alias that exists only at build time; its ambient
// declaration lives in ../types/rc.d.ts, which import-x cannot see.
// eslint-disable-next-line import-x/no-unresolved
import { i18nConfig } from '#laioutr/i18n-config';

export default defineNitroPlugin((nitro) => {
  const options = useRuntimeConfig()[MODULE_NAME] as ResolvedOptions;
  if (!options.robots.localizeRules) return;

  // Fires per robots.txt request with the text already rendered, so each host is answered with its
  // own language prefixes and no other host's. A prerendered robots.txt has no real request host to
  // resolve, so it finds no prefixes and is served exactly as @nuxtjs/robots rendered it.
  nitro.hooks.hook('robots:robots-txt', (ctx) => {
    const host = getRequestHost(ctx.e, { xForwardedHost: true });
    ctx.robotsTxt = localizeRobotsTxt(ctx.robotsTxt, hostPathPrefixes(i18nConfig.markets, host));
  });
});
