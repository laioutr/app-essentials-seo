const FINITE_SET_RE = /^\w+(?:\|\w+)+$/;
const PARAM_RE = /:(\w+)(?:\(([^)]*)\))?[+*?]?/g;

/**
 * Fills path params like `/:id` from `params`. A finite-set param with no value takes the set's
 * first option, so `/:param0(foo|bar)` yields `/foo`. A missing value yields an empty string —
 * callers must reject the result with `hasUnfilledParams`.
 */
export const fillParams = (path: string, params: Record<string, string | string[]>): string =>
  path.replace(PARAM_RE, (_, key: string, constraint: string | undefined) => {
    const value = params[key];
    if (value !== undefined) return Array.isArray(value) ? value.join('/') : value;
    if (constraint && FINITE_SET_RE.test(constraint)) return constraint.split('|')[0];
    return '';
  });

/**
 * Names the params `path` declares that `params` cannot fill. A param is missing when its value
 * is undefined or an empty string and it has no finite-set constraint to fall back to — the same
 * fallback `fillParams` itself applies — so the two never disagree about what counts as filled.
 */
export const missingParams = (path: string, params: Record<string, string | string[]>): string[] => {
  const missing: string[] = [];
  for (const [, key, constraint] of path.matchAll(PARAM_RE)) {
    const value = params[key];
    const hasFallback = Boolean(constraint) && FINITE_SET_RE.test(constraint as string);
    if ((value === undefined || value === '') && !hasFallback) missing.push(key);
  }
  return missing;
};

/**
 * True when a filled path is not a usable URL — either a placeholder survived, or a missing param
 * collapsed a segment to nothing, leaving a doubled slash (`/products//`). A single trailing slash
 * is fine.
 */
export const hasUnfilledParams = (path: string): boolean => path.includes(':') || path.includes('//');

/** Joins a domain path prefix and a page path, applying the project's trailing-slash policy. */
export const composePath = (prefix: string, path: string, trailingSlash: boolean): string => {
  const joined = `${prefix.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const normalized = joined.replace(/\/{2,}/g, '/');
  if (normalized === '/') return '/';
  return trailingSlash ? `${normalized.replace(/\/$/, '')}/` : normalized.replace(/\/$/, '');
};

/**
 * Resolves a possibly-localized value against a locale chain. A plain value is already resolved;
 * a map is probed in chain order. Undefined means the value does not exist for this chain, which
 * callers treat as "this page has no route here" rather than substituting a default.
 */
export const unlocalize = <T>(value: T | Record<string, T>, localeChain: string[]): T | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object') return value as T;
  const map = value as Record<string, T>;
  for (const locale of localeChain) {
    const localized = map[locale];
    // Clearing a localized field in Studio leaves `null` behind rather than removing the key, and an
    // empty string is not a route either. Both mean "nothing authored for this locale", so the chain
    // keeps walking — ending on one would drop a page that has a perfectly good fallback.
    if (localized !== undefined && localized !== null && localized !== '') return localized;
  }
  return undefined;
};
