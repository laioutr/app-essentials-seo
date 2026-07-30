import { composePath, fillParams, hasUnfilledParams, missingParams, unlocalize } from '../../shared/path';
import type { SitemapUrl } from './alternates';
import type { PageTypeSeo } from './configuredPageUrls';
import type { RenderMarketDomain } from '@laioutr-core/core-types/rc';
import type { PageIndexEntry } from '@laioutr-core/core-types/orchestr';

export type { SitemapUrl } from './alternates';

/**
 * Maps enumerated entries onto sitemap URLs.
 *
 * No `alternatives` are emitted: correlating one entry across locales would need either a point
 * lookup per entry or one enumeration per locale, and the rendered page head already carries the
 * complete hreflang set.
 */
export const mapPageIndexEntries = (input: {
  entries: readonly PageIndexEntry[];
  pagePath: string | Record<string, string>;
  domain: RenderMarketDomain;
  trailingSlash: boolean;
  includeImages: boolean;
  seo: PageTypeSeo;
}): SitemapUrl[] => {
  const { entries, pagePath, domain, trailingSlash, includeImages, seo } = input;
  const path = unlocalize(pagePath, domain.language.localeChain);
  if (!path) return [];

  const urls: SitemapUrl[] = [];
  for (const entry of entries) {
    if (entry.meta.noindex) continue;

    // A param with no value and no constraint default would otherwise fill to an empty string,
    // producing a truncated URL.
    if (missingParams(path, entry.params).length) continue;

    const filled = fillParams(path, entry.params);
    // A missing param would otherwise emit a collapsed URL like /products//.
    if (hasUnfilledParams(filled)) continue;

    urls.push({
      loc: composePath(domain.path ?? '', filled, trailingSlash),
      ...(entry.meta.lastModified ? { lastmod: entry.meta.lastModified } : {}),
      ...(seo.priority !== undefined ? { priority: seo.priority } : {}),
      ...(seo.changefreq ? { changefreq: seo.changefreq } : {}),
      ...(includeImages && entry.meta.previewImage ? { images: [{ loc: entry.meta.previewImage }] } : {}),
    });
  }
  return urls;
};

/** Filters out URLs whose `loc` is already accumulated, recording the survivors in `seen`. */
export const dedupeByLoc = (urls: SitemapUrl[], seen: Set<string>): SitemapUrl[] =>
  urls.filter((url) => {
    if (seen.has(url.loc)) return false;
    seen.add(url.loc);
    return true;
  });
