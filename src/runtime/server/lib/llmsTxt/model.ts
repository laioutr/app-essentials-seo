import type { LlmsTxtModel } from './format';
import type { ResolvedOptions } from '../../../../types';
import type { RcPage, RenderI18nConfig } from '@laioutr-core/core-types/rc';
import { toMarkdownPath } from '../../../shared/markdownPath';
import { defaultVariant, isDynamicPath, isPageIncluded } from '../../../shared/pageSelection';
import { composePath, unlocalize } from '../../../shared/path';
import { buildSitemapName } from '../../../shared/sitemapName';
import { belongsInSitemap, resolveHostDomains } from '../hostContext';
import { type Snapshot, snapshotState } from '../snapshotStore';

const PARAM = /:(\w+)(?:\([^)]*\))?[+*?]?/g;

export const toUrlPattern = (path: string): string => path.replace(PARAM, '{$1}');

export const humanizePageType = (token: string): string =>
  (token.split('/').pop() ?? token)
    .split('-')
    .filter(Boolean)
    .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
    .join(' ');

/** An authored SEO value, or nothing for a `{{…}}` template this build cannot resolve without running the page's queries. */
const authoredText = (value: unknown, localeChain: string[]): string | undefined => {
  const text = unlocalize(value as string | Record<string, string>, localeChain);
  return typeof text === 'string' && text.trim() && !text.includes('{{') ? text.trim() : undefined;
};

export const buildLlmsTxtModel = async (input: {
  host: string;
  origin: string;
  site: { name: string; description?: string; indexable: boolean };
  i18nConfig: RenderI18nConfig;
  pages: Record<string, RcPage>;
  trailingSlash: boolean;
  excludePageTypes: string[];
  llmsTxt: ResolvedOptions['aiReady']['llmsTxt'];
  dynamicTokens: string[];
  readSnapshot: (sitemapName: string) => Promise<Snapshot | null>;
  now: number;
}): Promise<LlmsTxtModel> => {
  const { market, domains } = resolveHostDomains(input.i18nConfig, input.host);
  const domain = domains[0];
  const pageHref = (path: string) => `${input.origin}${input.llmsTxt.markdownLinks ? toMarkdownPath(path) : path}`;

  const model: LlmsTxtModel = {
    siteName: input.site.name,
    description: input.site.description,
    origin: input.origin,
    notes: input.llmsTxt.notes,
    sections: input.llmsTxt.sections,
    resources: [
      { title: 'sitemap_index.xml', href: `${input.origin}/sitemap_index.xml`, description: 'XML sitemap for search engines and crawlers.' },
      { title: 'robots.txt', href: `${input.origin}/robots.txt`, description: 'Crawler rules and permissions.' },
    ],
    languages: domains.map((candidate) => ({
      code: candidate.language.code,
      name: candidate.language.name,
      href: pageHref(composePath(candidate.path ?? '', '/', input.trailingSlash)),
      isDefault: candidate === domain,
    })),
    pages: [],
    pageTypes: [],
  };

  // Same rule as the sitemap: a deployment or market that asks not to be indexed is not advertised.
  if (!domain || !input.site.indexable || !belongsInSitemap(market)) return model;

  const localeChain = domain.language.localeChain;
  const prefix = domain.path ?? '';

  for (const page of Object.values(input.pages)) {
    if (isDynamicPath(page.path)) continue;
    if (!isPageIncluded(page, { marketId: market.id, excludePageTypes: input.excludePageTypes })) continue;
    const path = unlocalize(page.path, localeChain);
    if (!path) continue;
    const loc = composePath(prefix, path, input.trailingSlash);
    const seo = defaultVariant(page)?.seo;
    model.pages.push({
      path: loc,
      href: pageHref(loc),
      title: authoredText(seo?.title, localeChain),
      description: authoredText(seo?.description, localeChain),
    });
  }

  for (const token of input.dynamicTokens) {
    const authored = input.llmsTxt.pageTypes[token];
    if (authored === false) continue;
    const template = Object.values(input.pages).find((page) => page.type === token && isDynamicPath(page.path));
    const path = template && unlocalize(template.path, localeChain);
    if (!path) continue;

    const sitemapName = buildSitemapName(token, domain.language.code);
    const snapshot = await input.readSnapshot(sitemapName);
    const state = snapshotState(snapshot, input.now);
    model.pageTypes.push({
      title: authored?.title ?? humanizePageType(token),
      description: authored?.description,
      pattern: toUrlPattern(composePath(prefix, path, input.trailingSlash)),
      href: `${input.origin}/__sitemap__/${sitemapName}.xml`,
      // Read, never built: llms.txt must not start page-index enumeration or call upstream.
      count: state === 'fresh' || state === 'stale' ? snapshot!.urls.length : undefined,
    });
  }

  return model;
};
