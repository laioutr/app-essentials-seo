/** Stands in for a page-type token on the source that carries laioutrrc's configured pages. */
export const CONFIGURED_PAGES_TOKEN = '__pages__';

/**
 * Maps a built name back to the (token, locale) pair it came from. Lives for the process only: the
 * build calls `buildSitemapName` for every page type × locale pair to populate it, and a freshly
 * started server process does the same thing from runtime config before serving its first request.
 * That is why `parseSitemapName` can be a lookup into this map instead of undoing the slug format.
 */
const registry = new Map<string, { token: string | null; locale: string }>();

/**
 * Slug for one source. Registers the mapping so `parseSitemapName` can invert it. Re-registering
 * the same (token, locale) pair under the name it already produced is a no-op — a fresh process
 * rebuilds the whole registry this way. Two different pairs producing the same name is a naming
 * collision, since `token.replaceAll('/', '-')` loses where the token ends and the locale begins;
 * that throws instead of letting one source's sitemap silently resolve to another's page type.
 */
export const buildSitemapName = (token: string, locale: string): string => {
  const prefix = token === CONFIGURED_PAGES_TOKEN ? 'pages' : token.replaceAll('/', '-');
  const name = `${prefix}-${locale}`;
  const resolvedToken = token === CONFIGURED_PAGES_TOKEN ? null : token;
  const existing = registry.get(name);
  if (existing && (existing.token !== resolvedToken || existing.locale !== locale)) {
    const describePair = (t: string | null, l: string) => `"${t ?? CONFIGURED_PAGES_TOKEN}" (${l})`;
    throw new Error(
      `Sitemap name "${name}" collides: ${describePair(existing.token, existing.locale)} and ${describePair(resolvedToken, locale)} both produce it. Rename one of the page types.`,
    );
  }
  registry.set(name, { token: resolvedToken, locale });
  return name;
};

/**
 * Inverts `buildSitemapName`. This works not because the slug is reversible — it isn't, since
 * flattening `/` to `-` loses where the token ends and the locale begins — but because
 * `buildSitemapName` rejects any registration that would collide with a different pair, so every
 * name in the registry maps back to exactly one pair. Tolerates the numeric chunk suffix the
 * sitemap module appends when a source is split, so `<name>-0` resolves to the same source as
 * `<name>`. Returns null for any name this app did not register.
 */
export const parseSitemapName = (name: string): { token: string | null; locale: string } | null => {
  const direct = registry.get(name);
  if (direct) return direct;
  const withoutChunk = name.replace(/-\d+$/, '');
  return registry.get(withoutChunk) ?? null;
};

/** Drops every registration. Test-only — production builds register once and never clear. */
export const __resetSitemapNames = (): void => registry.clear();
