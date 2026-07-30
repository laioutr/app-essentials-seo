const FINITE_SET_RE = /^\w+(?:\|\w+)+$/;

/**
 * Fills path params like `/:id` from `params`. A finite-set param with no value takes the set's
 * first option, so `/:param0(foo|bar)` yields `/foo`. A missing value yields an empty string —
 * callers must reject the result with `hasUnfilledParams`.
 */
export const fillParams = (path: string, params: Record<string, string | string[]>): string =>
  path.replace(/:(\w+)(?:\(([^)]*)\))?[+*?]?/g, (_, key: string, constraint: string | undefined) => {
    const value = params[key];
    if (value !== undefined) return Array.isArray(value) ? value.join('/') : value;
    if (constraint && FINITE_SET_RE.test(constraint)) return constraint.split('|')[0];
    return '';
  });

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
  if (value === null || typeof value !== 'object') return value as T;
  const map = value as Record<string, T>;
  for (const locale of localeChain) {
    if (Object.hasOwn(map, locale) && map[locale] !== undefined && map[locale] !== '') return map[locale];
  }
  return undefined;
};
