import { getRequestHost, setHeader } from 'h3';
import { defineNitroPlugin, listPages, listPagesFrom, useRuntimeConfig, useUserlandCache } from '#imports';
import type { ResolvedOptions } from '../../../types';
import type { SitemapSourceDescriptor } from '../../shared/toUpstreamConfig';
import type { SitemapUrl } from '../lib/alternates';
import type { PageTypeToken } from '@laioutr-core/core-types/frontend';
import type { PageIndexEntry } from '@laioutr-core/core-types/orchestr';
import { isDynamicPath } from '../../shared/pageSelection';
import { buildSitemapName, CONFIGURED_PAGES_TOKEN, parseSitemapName } from '../../shared/sitemapName';
import { buildConfiguredPageUrls } from '../lib/configuredPageUrls';
import { resolveHostContext } from '../lib/hostContext';
import { mapPageIndexEntries } from '../lib/pageIndexUrls';
import { runRebuildPass } from '../lib/rebuild';
import { createSnapshotStore, type Snapshot, snapshotState } from '../lib/snapshotStore';
// #laioutr/i18n-config and #laioutr/rc are virtual Nitro aliases that exist only at build time;
// their ambient declarations live in ../types/rc.d.ts, which import-x cannot see.
// eslint-disable-next-line import-x/no-unresolved
import { i18nConfig } from '#laioutr/i18n-config';
// eslint-disable-next-line import-x/no-unresolved
import { rcProject } from '#laioutr/rc';

const MODULE_NAME = '@laioutr/app-essentials-seo';
const CACHE_CONTROL = 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800';

const warned = new Set<string>();
const warnOnce = (key: string, message: string) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[${MODULE_NAME}] ${message}`);
};

/**
 * Background passes in flight, keyed by "<host>:<sitemapName>". `promotePending` has no
 * compare-and-swap, so two concurrent passes for the same source would duplicate upstream work and
 * could stomp on each other's progress. This only guards same-process concurrency — the realistic
 * collision — not multiple server processes; cross-process needs actual CAS on the store, which
 * unstorage does not offer. Deleted on settle so a failed pass never wedges its key.
 */
const inFlightPasses = new Map<string, Promise<void>>();

const scheduleBackgroundPass = (
  event: { waitUntil: (promise: Promise<unknown>) => void },
  host: string,
  sitemapName: string,
  run: () => Promise<void>
): void => {
  const key = `${host}:${sitemapName}`;
  if (inFlightPasses.has(key)) return;
  const promise = run()
    // `event.waitUntil` on the node preset only pushes this promise into an array nitropack never
    // awaits or catches, so a rejection here would otherwise surface as a Node unhandled rejection —
    // fatal by default — turning one bad background pass into a dead process. Catching and warning
    // keeps the failure local to this source; the next request for it just retries.
    .catch((error: unknown) => {
      console.warn(
        `[${MODULE_NAME}] background sitemap rebuild failed for host "${host}", sitemap "${sitemapName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    })
    .finally(() => inFlightPasses.delete(key));
  inFlightPasses.set(key, promise);
  event.waitUntil(promise);
};

export default defineNitroPlugin((nitro) => {
  // Nuxt generates `RuntimeConfig`'s type for this key from the actual resolved value, widening
  // enums and typed arrays to their plain JS types, so the literal-typed shape this plugin relies on
  // — including `sources`, which only exists on the resolved runtime value, never on the input schema
  // — is recovered with a local cast instead of a hand-written global augmentation.
  const options = useRuntimeConfig()[MODULE_NAME] as ResolvedOptions & { sources: SitemapSourceDescriptor[] };
  const store = createSnapshotStore(useUserlandCache('essentials-seo'));
  // frontend-core's own sanitiser strips `config` off `rcProject` before it reaches this process, so
  // `trailingSlash` has to come from the runtime-config channel frontend-core publishes it on instead.
  const trailingSlash = useRuntimeConfig().public.laioutr?.trailingSlash ?? false;
  const pageTypeSeo = Object.fromEntries(options.sitemap.pageTypes.map((entry) => [entry.pageType, entry]));

  // `parseSitemapName` inverts a registry, so every name the build declared has to be registered in
  // this process before the first request can be parsed.
  //
  // `??` alone is not enough here: `SitemapSourceDescriptor.token` is typed `string | null`, but a
  // `null` array element does not survive Nuxt's runtime-config round-trip — it comes back as `''`
  // (the type is inferred as `string` from sibling entries like "test/product", so runtime-config
  // widens `null` to that type's empty value, same class of coercion the comment above already flags
  // for this key). `||` catches both `null` and `''`, and a real page-type token is never empty.
  for (const source of options.sources) {
    buildSitemapName(source.token || CONFIGURED_PAGES_TOKEN, source.locale);
  }

  /** The configured page whose route template a page type owns. */
  const templateFor = (token: string) =>
    Object.values(rcProject.pages ?? {}).find((page) => page.type === token && isDynamicPath(page.path));

  nitro.hooks.hook('sitemap:sources', async (ctx: any) => {
    const parsed = parseSitemapName(ctx.sitemapName);
    if (!parsed) return; // not one of ours

    // Stripped once here so the snapshot cache key and market resolution agree on the same host —
    // resolveHostContext strips it internally too, but a raw `host:port` reaching only one of the two
    // would key the cache by port while resolving markets as if it weren't there.
    const host = getRequestHost(ctx.event, { xForwardedHost: true }).split(':')[0];
    const hostContext = resolveHostContext(i18nConfig, host, parsed.locale);
    if (!hostContext) {
      ctx.sources.push({ context: { name: MODULE_NAME }, urls: [] });
      return;
    }
    const { market, domain, clientEnv } = hostContext;

    const emit = (urls: SitemapUrl[]) => {
      ctx.sources.push({ context: { name: MODULE_NAME }, urls: urls.filter(Boolean) });
    };

    /**
     * The hook fires whenever a source is built, with the entries that built it — so `entries` is
     * never handed out empty for a source that had any. The two cases that do not build anything do
     * not fire it: a cached read serves a snapshot that was already offered to the hook, pass by
     * pass, as it was accumulated, and a source with no route template was never built at all.
     */
    const announceBuild = (urls: SitemapUrl[], entries: readonly (PageIndexEntry | Record<string, unknown>)[]) =>
      nitro.hooks.callHook('essentials-seo:sitemap-source:resolve', {
        event: ctx.event,
        token: parsed.token,
        locale: parsed.locale,
        market,
        domain,
        entries,
        urls,
      });

    // Configured pages are finite and need no upstream calls, so they are always built in full.
    if (parsed.token === null) {
      const urls = buildConfiguredPageUrls({
        pages: rcProject.pages ?? {},
        market,
        domain,
        markets: i18nConfig.markets,
        trailingSlash,
        excludePageTypes: options.sitemap.excludePageTypes,
        pageTypeSeo,
      });
      // Configured pages are handed to the extension hook as the loose `Record<string, unknown>` arm
      // of its `entries` union — they are RC page objects, not enumerated page-index entries. `RcPage`
      // has no index signature of its own, so it still needs a cast to satisfy that arm; unlike
      // before, the cast is now from the real production type instead of a local mirror shaped to fit.
      await announceBuild(urls, Object.values(rcProject.pages ?? {}) as unknown as Record<string, unknown>[]);
      emit(urls);
      return;
    }

    const template = templateFor(parsed.token);
    if (!template) {
      warnOnce(ctx.sitemapName, `no configured page carries a route for "${parsed.token}" — emitting an empty sitemap`);
      emit([]);
      return;
    }

    const mapEntries = (entries: any[]) =>
      mapPageIndexEntries({
        entries,
        pagePath: template.path,
        domain,
        trailingSlash,
        includeImages: options.sitemap.includeImages,
        seo: pageTypeSeo[parsed.token!] ?? {},
      });

    const token = parsed.token as PageTypeToken;
    const pass = (previous: Snapshot | null) =>
      runRebuildPass({
        previous,
        now: Date.now(),
        take: options.sitemap.rebuildBatchSize,
        mapEntries,
        onPassBuilt: announceBuild,
        label: `${parsed.token} (${parsed.locale})`,
        listPagesFrom: ({ take, resumeFrom }) => listPagesFrom(token, { clientEnv, event: ctx.event, take, resumeFrom }),
        listPages: ({ take }) => listPages(token, { clientEnv, event: ctx.event, take }),
      });

    const live = await store.readLive(host, ctx.sitemapName);
    const state = snapshotState(live, Date.now());

    if (state === 'missing') {
      const next = await pass(null);
      await store.writeLive(host, ctx.sitemapName, next);
      emit(next.urls);
      return;
    }

    if (state === 'incomplete') {
      // First build still accumulating: serve the partial and advance it in the background.
      scheduleBackgroundPass(ctx.event, host, ctx.sitemapName, () =>
        pass(live).then((next) => store.writeLive(host, ctx.sitemapName, next))
      );
    } else if (state === 'stale') {
      // Refreshes accumulate beside the live value so a reader never observes a partial.
      scheduleBackgroundPass(ctx.event, host, ctx.sitemapName, async () => {
        const pending = await store.readPending(host, ctx.sitemapName);
        const next = await pass(pending);
        await store.writePending(host, ctx.sitemapName, next);
        if (next.complete) await store.promotePending(host, ctx.sitemapName);
      });
    }

    emit(live!.urls);
  });

  nitro.hooks.hook('sitemap:index-resolved', (ctx: any) => {
    const host = getRequestHost(ctx.event, { xForwardedHost: true }).split(':')[0];
    // A sitemap file may only list URLs on its own host, so a child covering a locale this host does
    // not serve must not appear in its index.
    ctx.sitemaps = ctx.sitemaps.filter((entry: { sitemap: string }) => {
      const name =
        entry.sitemap
          .split('/')
          .pop()
          ?.replace(/\.xml$/, '') ?? '';
      const parsed = parseSitemapName(name);
      if (!parsed) return true;
      return resolveHostContext(i18nConfig, host, parsed.locale) !== null;
    });
  });

  nitro.hooks.hook('sitemap:output', (ctx: any) => {
    // Set here rather than via the module's own cache option, which is disabled: this runs after its
    // header logic, and the CDN keys by host where a server-side entry would not.
    setHeader(ctx.event, 'Cache-Control', CACHE_CONTROL);
  });
});
