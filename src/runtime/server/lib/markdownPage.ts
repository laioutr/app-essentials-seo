import {
  createError,
  getRequestHost,
  getRequestProtocol,
  getRequestURL,
  type H3Event,
  setResponseHeader,
  setResponseStatus,
} from 'h3';
import { convertHtmlToMarkdown, resolveMdreamOptions } from './convert';
import { layerFrontmatter, notFoundMarkdown } from './frontmatter';
import { domainForPath, resolveHostDomains } from './hostContext';
import { extractLastUpdated, extractMetaRobots } from './htmlMeta';
import { buildLinkHeader } from './linkHeader';
import { INTERNAL_HEADER, resolveMarkdownRedirect } from './negotiation';
import { getSiteIndexable, useNitroApp } from '#imports';
import type { ResolvedOptions } from '../../../types';
import type { MarkdownSourceContext } from '../../types/markdown';
// eslint-disable-next-line import-x/no-unresolved
import { i18nConfig } from '#laioutr/i18n-config';

type AiReady = ResolvedOptions['aiReady'];

/**
 * Host and protocol only. A twin is an anonymous render: forwarding cookies would put one visitor's
 * session into a response that is then cached for everyone.
 */
const forwardedHeaders = (event: H3Event): Record<string, string> => {
  const host = getRequestHost(event, { xForwardedHost: true });
  return {
    'accept': 'text/html',
    host,
    'x-forwarded-host': host,
    'x-forwarded-proto': getRequestProtocol(event, { xForwardedProto: true }),
    [INTERNAL_HEADER]: '1',
  };
};

export const renderMarkdownPage = async (
  event: H3Event,
  path: string,
  aiReady: AiReady,
  resolveUrl: (path: string) => string
): Promise<unknown> => {
  const nitroApp = useNitroApp();
  const canonicalUrl = resolveUrl(path);
  const host = getRequestHost(event, { xForwardedHost: true });
  const locale = domainForPath(resolveHostDomains(i18nConfig, host).domains, path)?.language.code;
  const indexable = getSiteIndexable(event);

  const respond = (markdown: string, status = 200) => {
    setResponseStatus(event, status);
    setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8');
    setResponseHeader(event, 'link', buildLinkHeader({ path, variant: 'markdown', describedby: aiReady.describedby, resolveUrl }));
    // frontend-core renders no robots meta on a non-production deployment, and this module turns off
    // @nuxtjs/robots' own header/meta — so without this, a twin there would carry no signal at all.
    // This outranks whatever the page's own meta said, since the deployment itself isn't indexable.
    if (!indexable) setResponseHeader(event, 'x-robots-tag', 'noindex, nofollow');
    // Only a 200 twin is a stable representation of the page worth caching; a 404 twin would
    // otherwise cache a real page's outage or a typo'd URL for the same duration as content.
    if (status === 200 && aiReady.markdownCacheHeaders) {
      const { maxAge, swr } = aiReady.markdownCacheHeaders;
      setResponseHeader(event, 'cache-control', swr ? `public, max-age=${maxAge}, stale-while-revalidate=${maxAge}` : `public, max-age=${maxAge}`);
    }
    return markdown;
  };

  const sourceContext: MarkdownSourceContext = { route: path, event, source: null };
  await nitroApp.hooks.callHook('ai-ready:markdown:source', sourceContext);
  if (sourceContext.source) {
    const { markdown, title, description, updatedAt } = sourceContext.source;
    return respond(layerFrontmatter({ title: title ?? path, description, canonical_url: canonicalUrl, last_updated: updatedAt, locale }, markdown));
  }

  const origins = [getRequestURL(event).origin];
  let htmlPath = path;
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await nitroApp.localFetch(htmlPath, { headers: forwardedHeaders(event), redirect: 'manual' }).catch(() => null);
    const location = response && response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!response || !location) break;
    const redirect = resolveMarkdownRedirect(location, { pageUrl: canonicalUrl, origins });
    if (redirect.kind === 'follow' && attempt === 0) {
      htmlPath = redirect.path;
      continue;
    }
    setResponseStatus(event, response.status);
    setResponseHeader(event, 'location', redirect.kind === 'redirect' ? redirect.location : location);
    return '';
  }

  if (!response) throw createError({ statusCode: 502, statusMessage: 'Bad Gateway' });
  if (!response.ok && response.status !== 404) {
    // This pass-through answers on behalf of every visitor asking for the Markdown twin, not just
    // the one who happened to trigger the upstream error — any Set-Cookie meant for that one visitor
    // must not travel here.
    const headers = new Headers(response.headers);
    headers.delete('set-cookie');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const isHtml = (response.headers.get('content-type') ?? '').includes('text/html');
  if (response.status === 404 || !isHtml) return respond(notFoundMarkdown({ path, canonicalUrl, resolveUrl, locale }), 404);

  const html = await response.text();
  const lastUpdated = extractLastUpdated(html);
  const { markdown } = await convertHtmlToMarkdown({
    html,
    url: canonicalUrl,
    route: path,
    event,
    mdreamOptions: resolveMdreamOptions(aiReady.mdreamOptions),
    additionalFrontmatter: {
      canonical_url: canonicalUrl,
      ...(lastUpdated ? { last_updated: lastUpdated } : {}),
      ...(locale ? { locale } : {}),
    },
    hooks: {
      mdreamConfig: (options) => nitroApp.hooks.callHook('ai-ready:mdreamConfig', options),
      pageMarkdown: (ctx) => nitroApp.hooks.callHook('ai-ready:page:markdown', ctx),
    },
  });

  // The page's own robots meta has no `<head>` to live in here, so it travels as a header instead —
  // otherwise a noindex page would be indexable through its twin.
  const robots = extractMetaRobots(html);
  if (robots) setResponseHeader(event, 'x-robots-tag', robots);
  return respond(markdown);
};
