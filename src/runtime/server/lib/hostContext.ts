import type { RenderI18nConfig, RenderMarket, RenderMarketDomain } from '@laioutr-core/core-types/rc';
import type { ClientEnv } from '@laioutr-core/orchestr/types';

export interface HostContext {
  market: RenderMarket;
  domain: RenderMarketDomain;
  clientEnv: ClientEnv;
}

/**
 * Whether a market's URLs belong in a sitemap. A market that is not launched renders every one of
 * its pages `noindex, nofollow` — frontend-core's page renderer forces it — so listing those URLs
 * would advertise pages that ask to be dropped the moment they are fetched.
 *
 * Deliberately not paired with a `Disallow` for the same host. That `noindex` is only read if the
 * crawler is allowed to fetch the page; disallowing instead would leave the URLs discoverable by
 * link, indexed on the strength of those links alone, and with no way left to say otherwise. So the
 * market stays crawlable and this module simply stops advertising it.
 *
 * Kept out of `resolveHostContext` on purpose: that answers which domain serves a locale, and
 * returning null here would claim this host serves none when it plainly does.
 */
export const belongsInSitemap = (market: Pick<RenderMarket, 'isIndexable'>): boolean => market.isIndexable;

/**
 * Maps a request host and a locale onto the market domain that serves them. Returns null when the
 * host serves no domain for that locale, which the caller turns into an empty sitemap rather than
 * guessing another market's URLs.
 *
 * An unknown host resolves to the default market, matching how the frontend treats localhost and
 * unrecognised hosts. Preview deployments are kept out of the index by site config, not by an empty
 * sitemap.
 */
export const resolveHostContext = (i18nConfig: RenderI18nConfig, host: string, locale: string): HostContext | null => {
  // Anchored to the port rather than split on the first colon, which would truncate a bracketed
  // IPv6 authority to "[".
  const bareHost = host.replace(/:\d+$/, '');
  // A project configures one spelling of its host and serves both, so matching only the literal one
  // sends a `www.` request to the default market — and this file would then carry that market's
  // paths under this host. Both lookups below tolerate the prefix, as request routing does.
  const wwwAlt = bareHost.startsWith('www.') ? bareHost.slice(4) : `www.${bareHost}`;
  const market = i18nConfig.hostToMarket[bareHost] ?? i18nConfig.hostToMarket[wwwAlt] ?? i18nConfig.defaultMarket;

  const onThisHost = market.domains.filter(
    (domain) => domain.host === bareHost || domain.host === wwwAlt || domain.devHost === bareHost
  );
  const candidates = onThisHost.length > 0 ? onThisHost : market.domains;
  const domain = candidates.find((candidate) => candidate.language.code === locale);
  if (!domain) return null;

  return {
    market,
    domain,
    clientEnv: {
      locale: domain.language.code,
      currency: market.currency,
      isPreview: false,
      market,
      language: domain.language,
      domain,
    },
  };
};
