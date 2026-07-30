import { describe, expect, it } from 'vitest';
import { buildAlternates } from '../../src/runtime/server/lib/alternates';

const de = { id: 'lng_de', code: 'de', localeChain: ['de'] };
const fr = { id: 'lng_fr', code: 'fr', localeChain: ['fr'] };
const chDe = { host: 'shop.ch', languageId: 'lng_de', language: de };
const chFr = { host: 'shop.ch', path: '/fr', languageId: 'lng_fr', language: fr };
const deDe = { host: 'shop.de', languageId: 'lng_de', language: de };
const marketCh = { id: 'mkt_ch', domains: [chDe, chFr], defaultDomain: chDe };
const marketDe = { id: 'mkt_de', domains: [deDe], defaultDomain: deDe };
const markets = [marketCh, marketDe] as never;

describe('buildAlternates', () => {
  it('emits one alternate per domain across every market', () => {
    const alternates = buildAlternates({
      pagePath: { de: '/ueber-uns', fr: '/a-propos' },
      markets,
      params: {},
      trailingSlash: false,
    });
    expect(alternates).toEqual(
      expect.arrayContaining([
        { hreflang: 'de', href: 'https://shop.ch/ueber-uns' },
        { hreflang: 'fr', href: 'https://shop.ch/fr/a-propos' },
        { hreflang: 'de', href: 'https://shop.de/ueber-uns' },
      ])
    );
  });

  it('adds x-default pointing at the first applicable market default domain', () => {
    const alternates = buildAlternates({ pagePath: '/about', markets, params: {}, trailingSlash: false });
    expect(alternates).toContainEqual({ hreflang: 'x-default', href: 'https://shop.ch/about' });
  });

  it('restricts alternates to the markets a scoped page belongs to', () => {
    const alternates = buildAlternates({
      pagePath: '/about',
      markets,
      pageMarketIds: ['mkt_de'],
      params: {},
      trailingSlash: false,
    });
    expect(alternates.every((alternate) => alternate.href.startsWith('https://shop.de'))).toBe(true);
    expect(alternates).toContainEqual({ hreflang: 'x-default', href: 'https://shop.de/about' });
  });

  it('omits a locale the page has no path for', () => {
    const alternates = buildAlternates({ pagePath: { de: '/ueber-uns' }, markets, params: {}, trailingSlash: false });
    expect(alternates.some((alternate) => alternate.hreflang === 'fr')).toBe(false);
  });
});
