import type { SitemapUrl } from '../server/lib/alternates';
import type { PageIndexEntry } from '@laioutr-core/core-types/orchestr';
import type { RenderMarket, RenderMarketDomain } from '@laioutr-core/core-types/rc';
import type { H3Event } from 'h3';

/**
 * Payload of `essentials-seo:sitemap-source:resolve`, which fires whenever a sitemap source is built,
 * with the entries that built it: once per request for the configured-pages source, which is rebuilt
 * in full every time, and once per rebuild pass for a page-index-backed source. A request answered
 * from the snapshot cache does not fire it — that snapshot was already offered to the hook, pass by
 * pass, while it was accumulated — and neither does a page type with no route template, which builds
 * nothing at all.
 *
 * Lives in a `.ts` module rather than beside the `nitropack` augmentation in `hooks.d.ts` so the
 * package entry can re-export it: only `.ts` sources are compiled into `dist`, and a re-export
 * pointing into a hand-written `.d.ts` has no built file to resolve against.
 */
export interface SitemapSourceResolveContext {
  event: H3Event;
  /** null on the configured-pages source. */
  token: string | null;
  locale: string;
  market: RenderMarket;
  domain: RenderMarketDomain;
  /**
   * The raw entries `urls` was built from — this pass's enumerated page-index entries, or every
   * configured page on the configured-pages source — provided as context for filtering decisions. Not
   * positionally aligned with `urls`: entries skipped as noindex, incomplete or unfillable never reach
   * `urls`, so this is the superset of the two. Match on entry identity rather than by index.
   */
  entries: readonly (PageIndexEntry | Record<string, unknown>)[];
  /**
   * The URLs just built, mutated in place — what survives is what gets served and, for a page-index
   * source, what the snapshot persists. Holds one whole pass, not one URL, and never the URLs earlier
   * passes already contributed.
   */
  urls: SitemapUrl[];
}
