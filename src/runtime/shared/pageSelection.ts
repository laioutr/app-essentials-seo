/** The catch-all page type. It matches every unrouted URL and must never appear in a sitemap. */
const CATCH_ALL_TYPE = 'core/404';

export interface SelectablePageVariant {
  conditions?: unknown;
  seo: { robots?: string };
}

export interface SelectablePage {
  id: string;
  type: string;
  marketIds?: string[];
  variants: Record<string, SelectablePageVariant>;
}

/** True when any locale of the path carries a route param, which means it needs page-index to enumerate. */
export const isDynamicPath = (path: string | Record<string, string>): boolean =>
  typeof path === 'string' ? path.includes(':') : Object.values(path).some((value) => value.includes(':'));

/**
 * The variant an anonymous visitor renders: the first with no personalization conditions. When every
 * variant is conditional there is no unconditional answer, so the first is used rather than skipping
 * the page entirely.
 */
export const defaultVariant = <T extends { variants: Record<string, SelectablePageVariant> }>(
  page: T
): SelectablePageVariant | undefined => {
  const variants = Object.values(page.variants);
  return variants.find((variant) => variant.conditions === undefined) ?? variants[0];
};

/** True when a robots directive string contains a `noindex` token. Token-aware, so `max-snippet` cannot match. */
export const isNoindexRobots = (robots: string | undefined): boolean =>
  robots !== undefined &&
  robots
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .includes('noindex');

/** Whether a configured page belongs in this market's sitemap. */
export const isPageIncluded = (page: SelectablePage, options: { marketId: string; excludePageTypes: string[] }): boolean => {
  if (page.type === CATCH_ALL_TYPE) return false;
  if (options.excludePageTypes.includes(page.type)) return false;
  if (page.marketIds?.length && !page.marketIds.includes(options.marketId)) return false;
  return !isNoindexRobots(defaultVariant(page)?.seo.robots);
};
