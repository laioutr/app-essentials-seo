/** Paths that are never pages: API routes, anything underscore-prefixed (Nitro and module internals), dev-server routes. */
const RESERVED_PATH = /^\/(?:api(?:\/|$)|_|@(?:id|fs|vite|react-refresh)(?:\/|$))/;

export const isReservedPath = (path: string): boolean => RESERVED_PATH.test(path);

export const normalizePagePath = (path: string): string => path.replace(/\/+$/, '') || '/';

/** `/` → `/index.md`, `/about/` → `/about.md`. */
export const toMarkdownPath = (path: string): string => {
  const normalized = normalizePagePath(path);
  return normalized === '/' ? '/index.md' : `${normalized}.md`;
};

/** Inverse of `toMarkdownPath`, also accepting an explicit `/index.md` under a prefix. */
export const fromMarkdownPath = (path: string): string => {
  const stripped = path.slice(0, -'.md'.length);
  return stripped.endsWith('/index') ? stripped.slice(0, -'/index'.length) || '/' : stripped;
};

/** The `.md` twin a page advertises, or null for anything that is not a page. */
export const markdownAlternatePath = (path: string): string | null => {
  if (isReservedPath(path)) return null;
  const lastSegment = normalizePagePath(path).split('/').pop() ?? '';
  if (lastSegment.includes('.')) return null;
  return toMarkdownPath(path);
};
