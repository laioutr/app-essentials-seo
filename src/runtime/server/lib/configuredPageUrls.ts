import { buildAlternates, type SitemapUrl } from './alternates';
import type { RenderMarket, RenderMarketDomain } from '@laioutr-core/core-types/rc';
import { isDynamicPath, isPageIncluded } from '../../shared/pageSelection';
import { composePath, unlocalize } from '../../shared/path';

export interface PageTypeSeo {
  priority?: number;
  changefreq?: string;
  include?: boolean;
}

interface ConfiguredPage {
  id: string;
  type: string;
  path: string | Record<string, string>;
  marketIds?: string[];
  variants: Record<string, { conditions?: unknown; seo: { robots?: string } }>;
  updatedAt?: string;
}

/** Every parameterless configured page this host serves in this locale. Finite and cheap, so it is
 *  always built in full rather than accumulated. */
export const buildConfiguredPageUrls = (input: {
  pages: Record<string, ConfiguredPage>;
  market: RenderMarket;
  domain: RenderMarketDomain;
  markets: RenderMarket[];
  trailingSlash: boolean;
  excludePageTypes: string[];
  pageTypeSeo: Record<string, PageTypeSeo>;
}): SitemapUrl[] => {
  const { pages, market, domain, markets, trailingSlash, excludePageTypes, pageTypeSeo } = input;
  const urls: SitemapUrl[] = [];

  for (const page of Object.values(pages)) {
    if (isDynamicPath(page.path)) continue;
    if (pageTypeSeo[page.type]?.include === false) continue;
    if (!isPageIncluded(page, { marketId: market.id, excludePageTypes })) continue;

    const path = unlocalize(page.path, domain.language.localeChain);
    if (!path) continue;

    const seo = pageTypeSeo[page.type] ?? {};
    urls.push({
      loc: composePath(domain.path ?? '', path, trailingSlash),
      ...(page.updatedAt ? { lastmod: page.updatedAt } : {}),
      ...(seo.priority === undefined ? {} : { priority: seo.priority }),
      ...(seo.changefreq ? { changefreq: seo.changefreq } : {}),
      alternatives: buildAlternates({
        pagePath: page.path,
        markets,
        pageMarketIds: page.marketIds,
        params: {},
        trailingSlash,
      }),
    });
  }

  return urls;
};
