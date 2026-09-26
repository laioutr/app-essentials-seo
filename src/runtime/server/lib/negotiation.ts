import { negotiateContent } from '@mdream/js/negotiate';
import { getBotInfo } from '@nuxtjs/robots/util';
import { fromMarkdownPath, isReservedPath, markdownAlternatePath, toMarkdownPath } from '../../shared/markdownPath';

/** Marks the middleware's own fetch of a page's HTML, so that request is never negotiated again. */
export const INTERNAL_HEADER = 'x-essentials-seo-internal';

export const NEGOTIATION_VARY = 'Accept, Sec-Fetch-Dest, User-Agent';

export type NegotiationDecision =
  | { kind: 'skip' }
  | { kind: 'not-acceptable' }
  | { kind: 'render'; path: string }
  | { kind: 'redirect'; path: string }
  | { kind: 'html'; path: string; negotiated: boolean };

const SKIP: NegotiationDecision = { kind: 'skip' };

// A JSON or event-stream client asking for nothing page-like is an API caller that happened to hit a page route.
const API_ACCEPT = /\b(?:application\/json|text\/event-stream)\b/i;
const PAGE_ACCEPT = /text\/(?:html|markdown|plain)\b|\*\/\*/i;

const negotiateRepresentation = (headers: Record<string, string | undefined>) => {
  const accept = headers.accept;
  const secFetchDest = headers['sec-fetch-dest'];
  if (negotiateContent(accept) === 'markdown') return 'markdown';
  if (secFetchDest === 'document') return 'html';
  if (getBotInfo(headers)?.category === 'ai') return 'markdown';
  return negotiateContent(accept, secFetchDest);
};

export const decideNegotiation = (request: {
  path: string;
  headers: Record<string, string | undefined>;
  contentNegotiation: boolean;
}): NegotiationDecision => {
  const queryIndex = request.path.indexOf('?');
  const path = queryIndex === -1 ? request.path : request.path.slice(0, queryIndex);
  if (path.startsWith('/.well-known/')) return SKIP;
  if (request.headers[INTERNAL_HEADER]) return SKIP;

  const isExplicit = path.endsWith('.md');
  const pagePath = isExplicit ? fromMarkdownPath(path) : path;
  if (isReservedPath(pagePath)) return SKIP;

  const accept = request.headers.accept ?? '';
  if (!isExplicit && accept && API_ACCEPT.test(accept) && !PAGE_ACCEPT.test(accept)) return SKIP;

  const lastSegment = path.split('/').pop() ?? '';
  if (!isExplicit && lastSegment.includes('.')) return SKIP;

  if (isExplicit) return { kind: 'render', path: pagePath };
  if (!request.contentNegotiation) return { kind: 'html', path, negotiated: false };

  const representation = negotiateRepresentation(request.headers);
  if (representation === 'not-acceptable') return { kind: 'not-acceptable' };
  if (representation === 'markdown') return { kind: 'redirect', path };
  return { kind: 'html', path, negotiated: true };
};

const NEGOTIATION_HEADERS = NEGOTIATION_VARY.split(',').map((header) => header.trim().toLowerCase());

/**
 * A route cached without varying on the negotiation headers would hand one client's representation to
 * every other, so negotiation is off there.
 */
export const contentNegotiationFor = (enabled: boolean, routeRule: { isr?: unknown; cache?: unknown }): boolean => {
  if (!enabled) return false;
  if (routeRule.isr) return false;
  const cache = routeRule.cache as { headersOnly?: boolean; varies?: string[] } | boolean | undefined;
  if (!cache) return true;
  if (typeof cache !== 'object') return false;
  if (cache.headersOnly) return true;
  const varies = new Set(cache.varies?.map((header) => header.toLowerCase()));
  return NEGOTIATION_HEADERS.every((header) => varies.has(header));
};

const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * A page's HTML answered with a redirect. One that lands on the same Markdown twin (a trailing-slash
 * normalisation) is followed; one to another page sends the client to that page's twin; anything
 * else — another origin, a file — is passed on as it is.
 */
export const resolveMarkdownRedirect = (
  location: string,
  { pageUrl, origins }: { pageUrl: string; origins: string[] }
): { kind: 'follow'; path: string } | { kind: 'redirect'; location: string } => {
  const page = new URL(pageUrl);
  const target = URL.canParse(location, page) ? new URL(location, page) : null;
  if (!target || (target.origin !== page.origin && !origins.includes(target.origin))) return { kind: 'redirect', location };

  const markdownPath = markdownAlternatePath(target.pathname);
  if (!markdownPath) return { kind: 'redirect', location };
  if (markdownPath === toMarkdownPath(page.pathname)) return { kind: 'follow', path: `${target.pathname}${target.search}` };

  const markdownLocation = `${markdownPath}${target.search}${target.hash}`;
  return { kind: 'redirect', location: ABSOLUTE_URL.test(location) ? `${target.origin}${markdownLocation}` : markdownLocation };
};
