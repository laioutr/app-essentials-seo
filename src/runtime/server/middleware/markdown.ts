import { appendResponseHeader, defineEventHandler, getHeaders, getRequestURL, sendRedirect, setResponseHeader } from 'h3';
import { getRouteRules, useRuntimeConfig } from '#imports';
import type { ResolvedOptions } from '../../../types';
import { toMarkdownPath } from '../../shared/markdownPath';
import { MODULE_NAME } from '../../shared/moduleName';
import { buildLinkHeader } from '../lib/linkHeader';
import { renderMarkdownPage } from '../lib/markdownPage';
import { contentNegotiationFor, decideNegotiation, NEGOTIATION_VARY } from '../lib/negotiation';

const setUncacheable = (event: Parameters<typeof setResponseHeader>[0]) => {
  setResponseHeader(event, 'cache-control', 'private, no-store');
  setResponseHeader(event, 'cdn-cache-control', 'no-store');
};

export default defineEventHandler(async (event) => {
  // A form post or API call to a page URL is never a request for a representation of that page.
  if (event.method !== 'GET' && event.method !== 'HEAD') return undefined;
  const { aiReady } = useRuntimeConfig(event)[MODULE_NAME] as ResolvedOptions;
  const decision = decideNegotiation({
    path: event.path,
    headers: getHeaders(event),
    contentNegotiation: contentNegotiationFor(aiReady.contentNegotiation, getRouteRules(event)),
  });
  if (decision.kind === 'skip') return undefined;

  const origin = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin;
  const resolveUrl = (path: string) => `${origin}${path}`;

  switch (decision.kind) {
    case 'redirect':
      appendResponseHeader(event, 'vary', NEGOTIATION_VARY);
      setUncacheable(event);
      return sendRedirect(event, toMarkdownPath(decision.path), 307);
    case 'html':
      if (decision.negotiated) appendResponseHeader(event, 'vary', NEGOTIATION_VARY);
      // Appended, not set: the renderer adds its own `Link` values (preconnect) to the same response.
      appendResponseHeader(event, 'link', buildLinkHeader({ path: decision.path, variant: 'html', describedby: aiReady.describedby, resolveUrl }));
      return undefined;
    case 'render':
      return renderMarkdownPage(event, decision.path, aiReady, resolveUrl);
    default:
      return undefined;
  }
});
