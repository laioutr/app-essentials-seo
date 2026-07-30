/** Stands in for a page-type token on the source that carries laioutrrc's configured pages. */
export const CONFIGURED_PAGES_TOKEN = '__pages__';

const registry = new Map<string, { token: string | null; locale: string }>();

/** Slug for one source. Registers the mapping so `parseSitemapName` can invert it. */
export const buildSitemapName = (token: string, locale: string): string => {
  const prefix = token === CONFIGURED_PAGES_TOKEN ? 'pages' : token.replaceAll('/', '-');
  const name = `${prefix}-${locale}`;
  registry.set(name, { token: token === CONFIGURED_PAGES_TOKEN ? null : token, locale });
  return name;
};

/**
 * Inverts `buildSitemapName`. Tolerates the numeric chunk suffix the sitemap module appends when a
 * source is split, so `<name>-0` resolves to the same source as `<name>`. Returns null for any name
 * this app did not register.
 */
export const parseSitemapName = (name: string): { token: string | null; locale: string } | null => {
  const direct = registry.get(name);
  if (direct) return direct;
  const withoutChunk = name.replace(/-\d+$/, '');
  return registry.get(withoutChunk) ?? null;
};

/** Drops every registration. Test-only — production builds register once and never clear. */
export const __resetSitemapNames = (): void => registry.clear();
