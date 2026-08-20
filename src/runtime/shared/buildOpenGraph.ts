/**
 * Open Graph tags derived from the head frontend-core has already computed.
 *
 * `og:locale` and `og:locale:alternate` are deliberately absent: frontend-core emits them from the
 * locale slot, and `PageRenderer` concatenates the two slots without deduplicating, so producing
 * them here would render each one twice.
 */
export interface OpenGraphMeta {
  ogTitle?: string;
  ogDescription?: string;
  ogType?: string;
  ogUrl?: string;
  ogSiteName?: string;
}

/** The `og:type` vocabulary, keyed by page type. Already merged with this module's own defaults. */
export interface OpenGraphConfig {
  defaultType: string;
  pageTypes: Record<string, string>;
}

export interface BuildOpenGraphInput {
  /**
   * The seo slot as frontend-core computed it — `{{queries.…}}` placeholders already substituted and
   * the locale chain already applied, so these are the final strings the page renders.
   */
  seo: { title?: string; description?: string };
  /** The locale slot's links. The canonical entry is the only correct source of an absolute page URL. */
  links: ReadonlyArray<{ rel: string; href: string }>;
  /** `RenderPage.type`, e.g. 'core/landingpage'. */
  pageType: string;
  /** Host of the domain serving this request. Undefined before a market domain resolves. */
  host: string | undefined;
  /** Site name per host, including dev hosts. Falls back to `siteName` when the host is unknown. */
  siteNameByHost: Record<string, string>;
  /** Project-wide site name, when one is configured. */
  siteName: string | undefined;
  config: OpenGraphConfig;
}

/**
 * Derives the Open Graph tags for one page render. Pure: every input arrives from the
 * `frontend-core:page-head:resolve` payload or from build-time config, so this stays unit-testable
 * without a Nuxt context — and the hook handler it feeds must stay synchronous.
 *
 * Keys are omitted rather than set to an empty string: an absent tag is correct, a blank one tells a
 * scraper the page really has no title.
 */
export const buildOpenGraph = (input: BuildOpenGraphInput): OpenGraphMeta => {
  const { seo, links, pageType, host, siteNameByHost, siteName, config } = input;
  const meta: OpenGraphMeta = {};

  // frontend-core falls back to the bare page type when a variant has no SEO title, which is a
  // developer-facing sentinel ('core/landingpage'), not a headline worth putting in a share preview.
  if (seo.title && seo.title !== pageType) meta.ogTitle = seo.title;
  if (seo.description) meta.ogDescription = seo.description;

  // Read through `typeof` rather than `??`: the map is a plain object parsed from project config, so
  // it inherits Object.prototype, and a page type named `constructor` would resolve to a function.
  const configuredType = config.pageTypes[pageType];
  meta.ogType = typeof configuredType === 'string' ? configuredType : config.defaultType;

  // Omitted when there is no canonical — the locale slot is empty until a market domain resolves
  // (Studio preview), and a guessed URL is worse than none: it is what a scraper deduplicates on.
  const canonical = links.find((link) => link.rel === 'canonical')?.href;
  if (canonical) meta.ogUrl = canonical;

  const resolvedSiteName = (host === undefined ? undefined : siteNameByHost[host]) ?? siteName;
  if (resolvedSiteName) meta.ogSiteName = resolvedSiteName;

  return meta;
};
