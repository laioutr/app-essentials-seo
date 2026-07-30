import { describe, expect, it } from 'vitest';
import { resolveHostContext } from '../../src/runtime/server/lib/hostContext';

const de = { id: 'lng_de', code: 'de', localeChain: ['de'] };
const fr = { id: 'lng_fr', code: 'fr', localeChain: ['fr'] };
const chDe = { id: 'd1', host: 'shop.ch', devHost: 'shop-ch.local', languageId: 'lng_de', language: de, isDefault: true };
const chFr = { id: 'd2', host: 'shop.ch', path: '/fr', devHost: 'shop-ch.local', languageId: 'lng_fr', language: fr, isDefault: false };
const deDe = { id: 'd3', host: 'shop.de', devHost: 'shop-de.local', languageId: 'lng_de', language: de, isDefault: true };

const marketCh = { id: 'mkt_ch', currency: 'CHF', domains: [chDe, chFr], defaultDomain: chDe };
const marketDe = { id: 'mkt_de', currency: 'EUR', domains: [deDe], defaultDomain: deDe };

const i18nConfig = {
  markets: [marketCh, marketDe],
  hostToMarket: { 'shop.ch': marketCh, 'shop-ch.local': marketCh, 'shop.de': marketDe, 'shop-de.local': marketDe },
  defaultMarket: marketCh,
} as never;

describe('resolveHostContext', () => {
  it('resolves the domain serving a locale on a host', () => {
    const ctx = resolveHostContext(i18nConfig, 'shop.ch', 'fr');
    expect(ctx?.domain.id).toBe('d2');
    expect(ctx?.clientEnv.currency).toBe('CHF');
    expect(ctx?.clientEnv.locale).toBe('fr');
  });

  it('resolves a second locale on the same host via its path prefix', () => {
    expect(resolveHostContext(i18nConfig, 'shop.ch', 'de')?.domain.path).toBeUndefined();
    expect(resolveHostContext(i18nConfig, 'shop.ch', 'fr')?.domain.path).toBe('/fr');
  });

  it('returns null when the host does not serve that locale', () => {
    expect(resolveHostContext(i18nConfig, 'shop.de', 'fr')).toBeNull();
  });

  it('strips a port before matching', () => {
    expect(resolveHostContext(i18nConfig, 'shop.ch:3000', 'de')?.market.id).toBe('mkt_ch');
  });

  it('falls back to the default market for an unknown host', () => {
    expect(resolveHostContext(i18nConfig, 'preview-abc.vercel.app', 'de')?.market.id).toBe('mkt_ch');
  });

  it('never marks the resolved client env as preview', () => {
    expect(resolveHostContext(i18nConfig, 'shop.ch', 'de')?.clientEnv.isPreview).toBe(false);
  });
});
