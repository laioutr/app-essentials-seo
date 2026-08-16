import { defineNuxtPlugin, useRuntimeConfig } from '#app';
import { buildOpenGraph } from '../../shared/buildOpenGraph';
import { MODULE_NAME } from '../../shared/moduleName';
import type { OpenGraphConfig, OpenGraphMeta } from '../../shared/buildOpenGraph';

/** The slice of this module's public runtime config the page-head hook reads. */
interface PublicConfig {
  openGraph: OpenGraphConfig & { enabled: boolean };
  siteNameByHost: Record<string, string>;
  siteName?: string;
}

export default defineNuxtPlugin((nuxtApp) => {
  // Public, not private: the head is recomputed on every client-side navigation too, and a
  // server-only config would leave those renders without Open Graph tags.
  const config = (useRuntimeConfig().public as Record<string, unknown>)[MODULE_NAME] as PublicConfig | undefined;
  if (!config?.openGraph.enabled) return;

  // Synchronous by contract: `getHookResult` runs handlers through a sync caller, so anything
  // awaited here would be dropped after `result.value` has already been read.
  nuxtApp.hook('frontend-core:page-head:resolve', ({ page, currentDomain, result }) => {
    // `UseSeoMetaInput` allows a getter or ref per field. frontend-core seeds both as plain strings,
    // but an app handler running before this one may not, and a function would stringify into a tag.
    const asText = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

    const built = buildOpenGraph({
      seo: { title: asText(result.value.seo.title), description: asText(result.value.seo.description) },
      links: result.value.locale.link,
      pageType: page.type,
      host: currentDomain?.host,
      siteNameByHost: config.siteNameByHost,
      siteName: config.siteName,
      config: config.openGraph,
    });

    // Fill gaps only. Handler order across apps is not guaranteed, so overwriting would let this
    // module silently discard a value another app — or the project itself — set deliberately.
    const seo = result.value.seo as Record<string, unknown>;
    for (const [key, value] of Object.entries(built) as Array<[keyof OpenGraphMeta, string]>) {
      if (seo[key] === undefined) seo[key] = value;
    }
  });
});
