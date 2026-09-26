import { defineEventHandler, getRequestHost, getRequestURL, type H3Event, setResponseHeader } from 'h3';
import { defineCachedFunction, getSiteConfig, getSiteIndexable, useRuntimeConfig, useUserlandCache } from '#imports';
import type { ResolvedOptions } from '../../../types';
import type { SitemapSourceDescriptor } from '../../shared/toUpstreamConfig';
import { MODULE_NAME } from '../../shared/moduleName';
import { renderLlmsTxt } from '../lib/llmsTxt/format';
import { buildLlmsTxtModel } from '../lib/llmsTxt/model';
import { createSnapshotStore, type Snapshot } from '../lib/snapshotStore';
// #laioutr/i18n-config and #laioutr/rc are virtual Nitro aliases that exist only at build time;
// their ambient declarations live in ../types/rc.d.ts, which import-x cannot see.
// eslint-disable-next-line import-x/no-unresolved
import { i18nConfig } from '#laioutr/i18n-config';
// eslint-disable-next-line import-x/no-unresolved
import { rcProject } from '#laioutr/rc';

type Options = ResolvedOptions & { sources: SitemapSourceDescriptor[] };

// Stripped of the port so the snapshot keys match the ones the sitemap plugin writes.
const bareHost = (event: H3Event) => getRequestHost(event, { xForwardedHost: true }).split(':')[0]!;

const build = async (event: H3Event): Promise<string> => {
  const options = useRuntimeConfig(event)[MODULE_NAME] as Options;
  const site = getSiteConfig(event);
  const host = bareHost(event);
  const store = createSnapshotStore(useUserlandCache<Snapshot>('essentials-seo'));

  const model = await buildLlmsTxtModel({
    host,
    origin: getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin,
    // `getSiteConfig().indexable` is only the raw configured value, which is `undefined` under the
    // default `indexable: 'auto'` — `getSiteIndexable` is the one that applies the env fallback.
    site: { name: site.name || host, description: site.description, indexable: getSiteIndexable(event) },
    i18nConfig,
    pages: rcProject.pages ?? {},
    // frontend-core strips `config` off `rcProject`; it publishes `trailingSlash` on public runtime config instead.
    trailingSlash: useRuntimeConfig(event).public.laioutr?.trailingSlash ?? false,
    excludePageTypes: options.sitemap.excludePageTypes,
    llmsTxt: options.aiReady.llmsTxt,
    // `||`-style filter: a null token comes back from runtime config as ''.
    dynamicTokens: [...new Set(options.sources.map((source) => source.token).filter((token): token is string => Boolean(token)))],
    readSnapshot: (sitemapName) => store.readLive(host, sitemapName),
    now: Date.now(),
  });
  return renderLlmsTxt(model);
};

let cachedBuild: ((event: H3Event) => Promise<string>) | undefined;

export default defineEventHandler(async (event) => {
  const { aiReady } = useRuntimeConfig(event)[MODULE_NAME] as Options;
  const seconds = aiReady.llmsTxtCacheSeconds;
  const cache = !import.meta.dev && seconds > 0;

  // Keyed by host: one build serves every market, and a shared entry would hand one market's file to another.
  cachedBuild ??= defineCachedFunction(build, { name: 'essentials-seo-llms-txt', maxAge: seconds, swr: true, getKey: bareHost });
  const body = cache ? await cachedBuild(event) : await build(event);

  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8');
  if (cache) setResponseHeader(event, 'cache-control', `public, max-age=${seconds}, s-maxage=${seconds}, stale-while-revalidate=3600`);
  return body;
});
