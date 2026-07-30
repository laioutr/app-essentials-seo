import type { PageIndexEntry } from '@laioutr-core/core-types/orchestr';
import type { RenderMarket, RenderMarketDomain } from '@laioutr-core/core-types/rc';
import type { H3Event } from 'h3';
import type { SitemapUrl } from '../server/lib/alternates';

export interface SitemapSourceResolveContext {
  event: H3Event;
  /** null on the configured-pages source. */
  token: string | null;
  locale: string;
  market: RenderMarket;
  domain: RenderMarketDomain;
  /**
   * Raw entries enumerated for this source, provided as context for filtering decisions. Not
   * positionally aligned with `urls` — entries skipped as noindex, incomplete or unfillable never
   * reach `urls`, so it is a subset.
   */
  entries: readonly (PageIndexEntry | Record<string, unknown>)[];
  /** Mutated in place. Fires once per rebuild pass, not once per URL. */
  urls: SitemapUrl[];
}

declare module 'nitropack' {
  interface NitroRuntimeHooks {
    'essentials-seo:sitemap-source:resolve': (ctx: SitemapSourceResolveContext) => void | Promise<void>;
  }
}

export {};
