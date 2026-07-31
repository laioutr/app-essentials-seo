export interface SitemapHookCall {
  token: string | null;
  locale: string;
  /** Sizes rather than payloads: the assertions only ever ask how much the hook was handed. */
  entries: number;
  urls: number;
}

/**
 * One record per `essentials-seo:sitemap-source:resolve` call, in order. Written by the hook plugin
 * and read back over `/__sitemap-hook-log`, so a test can assert both what a call received and that a
 * cached request produced no call at all.
 */
export const sitemapHookLog: SitemapHookCall[] = [];
