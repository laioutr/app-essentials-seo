const META_TAG = /<meta\b[^>]*>/gi;

// Anchored to whitespace so `data-name="robots"` is not read as `name="robots"`.
const attribute = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2];

const firstMetaContent = (html: string, keys: ReadonlySet<string>): string | undefined => {
  for (const [tag] of html.matchAll(META_TAG)) {
    const key = (attribute(tag, 'name') ?? attribute(tag, 'property'))?.toLowerCase();
    if (!key || !keys.has(key)) continue;
    const content = attribute(tag, 'content');
    if (content) return content;
  }
  return undefined;
};

const ROBOTS_KEYS = new Set(['robots']);
const UPDATED_KEYS = new Set(['article:modified_time', 'og:updated_time', 'last-modified', 'lastmod', 'updated']);

export const extractMetaRobots = (html: string): string | undefined => firstMetaContent(html, ROBOTS_KEYS);

export const extractLastUpdated = (html: string): string | undefined => firstMetaContent(html, UPDATED_KEYS);
