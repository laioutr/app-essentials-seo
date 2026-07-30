import { composePath, fillParams, unlocalize } from '../../shared/path';
import type { RenderMarket } from '@laioutr-core/core-types/rc';

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  images?: Array<{ loc: string }>;
  alternatives?: Array<{ hreflang: string; href: string }>;
}

/**
 * Cross-host hreflang for a page whose path is known in every locale. Pure path composition, so it
 * costs no upstream calls — which is why configured pages get alternates and enumerated pages do not.
 */
export const buildAlternates = (input: {
  pagePath: string | Record<string, string>;
  markets: RenderMarket[];
  pageMarketIds?: string[];
  params: Record<string, string | string[]>;
  trailingSlash: boolean;
}): Array<{ hreflang: string; href: string }> => {
  const { pagePath, markets, pageMarketIds, params, trailingSlash } = input;
  const applicable = pageMarketIds?.length ? markets.filter((market) => pageMarketIds.includes(market.id)) : markets;
  const result: Array<{ hreflang: string; href: string }> = [];

  const hrefFor = (domain: RenderMarket['domains'][number]): string | undefined => {
    const path = unlocalize(pagePath, domain.language.localeChain);
    if (!path) return undefined;
    return `https://${domain.host}${composePath(domain.path ?? '', fillParams(path, params), trailingSlash)}`;
  };

  for (const market of applicable) {
    for (const domain of market.domains) {
      const href = hrefFor(domain);
      if (href) result.push({ hreflang: domain.language.code, href });
    }
  }

  // x-default targets the first applicable market so a market-scoped page never points at a market
  // where it has no route.
  const defaultHref = applicable[0] ? hrefFor(applicable[0].defaultDomain) : undefined;
  if (defaultHref) result.push({ hreflang: 'x-default', href: defaultHref });

  return result;
};
