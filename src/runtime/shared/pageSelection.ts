import type { RcPage, RcPageVariant } from '@laioutr-core/core-types/rc';

/** The catch-all page type. It matches every unrouted URL and must never appear in a sitemap. */
const CATCH_ALL_TYPE = 'core/404';

/** True when any locale of the path carries a route param, which means it needs page-index to enumerate. */
export const isDynamicPath = (path: string | Record<string, string>): boolean =>
  typeof path === 'string' ? path.includes(':') : Object.values(path).some((value) => value.includes(':'));

/**
 * The variant an anonymous visitor renders: the first with no personalization conditions. When every
 * variant is conditional there is no unconditional answer, so the first is used rather than skipping
 * the page entirely. Conditions travel through Studio as JSON, where "no personalization" can be
 * authored as either a missing key or an explicit `null`, so both are treated as unconditional.
 */
export const defaultVariant = <T extends { variants: Record<string, RcPageVariant> }>(
  page: T
): RcPageVariant | undefined => {
  const variants = Object.values(page.variants);
  return variants.find((variant) => variant.conditions === undefined || variant.conditions === null) ?? variants[0];
};

/**
 * True when a robots directive string contains a `noindex` token. Tokens can be separated by commas,
 * whitespace, or both, so splitting on either keeps `max-snippet` from matching as a substring.
 *
 * A page can author `seo.robots` as a `{{queries.…}}` template that frontend-core resolves per
 * render, and one of those reads as indexable here whatever it resolves to. That is deliberate:
 * the value depends on query results this build cannot fetch, and the cost of being wrong is one
 * sitemap entry for a page that then serves its own `noindex` and is dropped from the index. Pulling
 * the real value through would mean running the page's queries at build time to decide one flag.
 */
export const isNoindexRobots = (robots: string | undefined): boolean =>
  robots !== undefined &&
  robots
    .split(/[,\s]+/)
    .map((token) => token.trim().toLowerCase())
    .includes('noindex');

/** Whether a configured page belongs in this market's sitemap. */
export const isPageIncluded = (page: RcPage, options: { marketId: string; excludePageTypes: string[] }): boolean => {
  if (page.type === CATCH_ALL_TYPE) return false;
  if (options.excludePageTypes.includes(page.type)) return false;
  if (page.marketIds?.length && !page.marketIds.includes(options.marketId)) return false;
  return !isNoindexRobots(defaultVariant(page)?.seo.robots);
};
