import type { ClientEnv } from '@laioutr-core/orchestr/types';
import type { RenderI18nConfig, RenderMarket, RenderMarketDomain } from '@laioutr-core/core-types/rc';

export interface HostContext {
  market: RenderMarket;
  domain: RenderMarketDomain;
  clientEnv: ClientEnv;
}

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
  const bareHost = host.split(':')[0];
  const market = i18nConfig.hostToMarket[bareHost] ?? i18nConfig.defaultMarket;

  const onThisHost = market.domains.filter((domain) => domain.host === bareHost || domain.devHost === bareHost);
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
