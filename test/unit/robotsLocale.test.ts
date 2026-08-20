import { describe, expect, it } from 'vitest';
import { hostPathPrefixes, localizeRobotsTxt } from '../../src/runtime/server/lib/robotsLocale';

// Only the fields these functions read; the rest of RenderMarket is irrelevant here.
const de = { id: 'lng_de', code: 'de', localeChain: ['de'] };
const en = { id: 'lng_en', code: 'en', localeChain: ['en'] };
const fr = { id: 'lng_fr', code: 'fr', localeChain: ['fr'] };

const market = (id: string, domains: unknown[]) => ({ id, currency: 'EUR', domains }) as never;

const chDe = { id: 'd1', host: 'shop.ch', devHost: 'shop-ch.local', language: de };
const chFr = { id: 'd2', host: 'shop.ch', path: '/fr', devHost: 'shop-ch.local', language: fr };
const deDe = { id: 'd3', host: 'shop.de', devHost: 'shop-de.local', language: de };
const deEn = { id: 'd4', host: 'shop.de', path: '/en/', devHost: 'shop-de.local', language: en };

const markets = [market('mkt_ch', [chDe, chFr]), market('mkt_de', [deDe, deEn])];

describe('hostPathPrefixes', () => {
  it('lists the non-root prefixes a host serves', () => {
    expect(hostPathPrefixes(markets, 'shop.ch')).toEqual(['/fr']);
  });

  it('does not leak the prefixes of another host', () => {
    expect(hostPathPrefixes([market('mkt_ch', [chDe, chFr])], 'shop.de')).toEqual([]);
  });

  it('collects prefixes across every market sharing the host', () => {
    const shared = [market('a', [{ ...chDe, host: 'shop.eu' }]), market('b', [{ ...chFr, host: 'shop.eu' }])];
    expect(hostPathPrefixes(shared, 'shop.eu')).toEqual(['/fr']);
  });

  it('tolerates a port, the www. spelling and the dev host, as request routing does', () => {
    expect(hostPathPrefixes(markets, 'shop.ch:3000')).toEqual(['/fr']);
    expect(hostPathPrefixes(markets, 'www.shop.ch')).toEqual(['/fr']);
    expect(hostPathPrefixes(markets, 'shop-ch.local')).toEqual(['/fr']);
  });

  it('strips a trailing slash so the prefix joins cleanly onto a rule', () => {
    expect(hostPathPrefixes(markets, 'shop.de')).toEqual(['/en']);
  });

  it('returns nothing for an unknown host, rather than guessing a market', () => {
    expect(hostPathPrefixes(markets, 'preview-abc.vercel.app')).toEqual([]);
  });
});

describe('localizeRobotsTxt', () => {
  it('repeats a rule under each prefix, keeping the original', () => {
    expect(localizeRobotsTxt('User-agent: *\nDisallow: /login', ['/fr'])).toBe('User-agent: *\nDisallow: /login\nDisallow: /fr/login');
  });

  it('leaves the document alone when the host serves one language', () => {
    const robotsTxt = 'User-agent: *\nDisallow: /login';
    expect(localizeRobotsTxt(robotsTxt, [])).toBe(robotsTxt);
  });

  it('localizes Allow as well as Disallow', () => {
    expect(localizeRobotsTxt('Allow: /login/reset', ['/fr'])).toBe('Allow: /login/reset\nAllow: /fr/login/reset');
  });

  it('leaves a rule already scoped to a language alone, rather than widening it to the root', () => {
    // @nuxtjs/robots strips the locale and re-adds every other one, which would turn this into
    // `Disallow: /` and take the whole site out of search.
    expect(localizeRobotsTxt('Disallow: /fr', ['/fr'])).toBe('Disallow: /fr');
    expect(localizeRobotsTxt('Disallow: /fr/login', ['/fr'])).toBe('Disallow: /fr/login');
  });

  it('leaves a wildcard rule alone, since it already spans every prefix', () => {
    expect(localizeRobotsTxt('Disallow: */login', ['/fr'])).toBe('Disallow: */login');
  });

  it('leaves the empty rule alone, which is how upstream says "allow everything"', () => {
    expect(localizeRobotsTxt('User-agent: *\nDisallow:', ['/fr'])).toBe('User-agent: *\nDisallow:');
  });

  it('leaves this module\'s internal disallows alone, as they are app-root routes', () => {
    expect(localizeRobotsTxt('Disallow: /api/\nDisallow: /_laioutr/', ['/fr'])).toBe('Disallow: /api/\nDisallow: /_laioutr/');
  });

  it('passes through every line that is not a rule', () => {
    const robotsTxt = [
      '# START nuxt-robots (indexable)',
      'User-agent: Googlebot',
      'Content-Usage: train-ai=n',
      'Disallow: /login',
      '',
      'Sitemap: https://shop.ch/sitemap_index.xml',
      '# END nuxt-robots',
    ].join('\n');
    expect(localizeRobotsTxt(robotsTxt, ['/fr']).split('\n')).toEqual([
      '# START nuxt-robots (indexable)',
      'User-agent: Googlebot',
      'Content-Usage: train-ai=n',
      'Disallow: /login',
      'Disallow: /fr/login',
      '',
      'Sitemap: https://shop.ch/sitemap_index.xml',
      '# END nuxt-robots',
    ]);
  });

  it('reproduces the spelling of the line it copies', () => {
    expect(localizeRobotsTxt('  disallow:/login', ['/fr'])).toBe('  disallow:/login\n  disallow:/fr/login');
  });

  it('does not carry a trailing comment onto the copies', () => {
    expect(localizeRobotsTxt('Disallow: /login # members only', ['/fr'])).toBe('Disallow: /login # members only\nDisallow: /fr/login');
  });

  it('handles a host serving more than two languages', () => {
    expect(localizeRobotsTxt('Disallow: /login', ['/fr', '/it'])).toBe('Disallow: /login\nDisallow: /fr/login\nDisallow: /it/login');
  });
});
