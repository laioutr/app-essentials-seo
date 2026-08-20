import { describe, expect, it, vi } from 'vitest';
import { LAIOUTR_GROUP } from '../../src/runtime/shared/toUpstreamConfig';
import { applyUpstreamConfig, mergeDerivedRobots } from '../../src/upstreamConfig';

describe('applyUpstreamConfig', () => {
  it('lets app config beat a developer value, and both beat derived', () => {
    const nuxtOptions: any = { sitemap: { defaults: { priority: 0.1 } } };
    applyUpstreamConfig(
      nuxtOptions,
      { site: {}, sitemap: { defaults: { priority: 0.9 }, excludeAppSources: true }, robots: {} },
      { sitemap: { defaults: { priority: 0.5 } } }
    );
    expect(nuxtOptions.sitemap.defaults.priority).toBe(0.5);
    expect(nuxtOptions.sitemap.excludeAppSources).toBe(true);
  });

  it('concatenates array values rather than replacing them', () => {
    const nuxtOptions: any = {};
    applyUpstreamConfig(nuxtOptions, { site: {}, sitemap: {}, robots: { disallow: ['/api/'] } }, { robots: { disallow: ['/x'] } });
    expect(nuxtOptions.robots.disallow).toEqual(['/x', '/api/']);
  });

  it('warns when site.url is set and more than one host is configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const nuxtOptions: any = {};
    applyUpstreamConfig(
      nuxtOptions,
      { site: { multiTenancy: [{ hosts: ['a'] }, { hosts: ['b'] }] }, sitemap: {}, robots: {} },
      { site: { url: 'https://a' } }
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('site.url'));
    warn.mockRestore();
  });

  it('does not warn about site.url when only one host is configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const nuxtOptions: any = {};
    applyUpstreamConfig(
      nuxtOptions,
      { site: { multiTenancy: [{ hosts: ['a'] }] }, sitemap: {}, robots: {} },
      { site: { url: 'https://a' } }
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns when nuxtOptions.site.url is set and more than one host is configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const nuxtOptions: any = { site: { url: 'https://a' } };
    applyUpstreamConfig(nuxtOptions, { site: { multiTenancy: [{ hosts: ['a'] }, { hosts: ['b'] }] }, sitemap: {}, robots: {} }, {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('site.url'));
    warn.mockRestore();
  });

  it('does not warn about nuxtOptions.site.url when only one host is configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const nuxtOptions: any = { site: { url: 'https://a' } };
    applyUpstreamConfig(nuxtOptions, { site: { multiTenancy: [{ hosts: ['a'] }] }, sitemap: {}, robots: {} }, {});
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not let a curated-only sitemap key reach the upstream sitemap config', () => {
    const nuxtOptions: any = {};
    applyUpstreamConfig(
      nuxtOptions,
      { site: {}, sitemap: { defaults: { priority: 0.5 } }, robots: {} },
      { sitemap: { excludePageTypes: ['core/404'] } }
    );
    expect(nuxtOptions.sitemap.excludePageTypes).toBeUndefined();
  });

  it('derives blockNonSeoBots from the curated schema rather than the raw escape hatch', () => {
    const nuxtOptions: any = {};
    applyUpstreamConfig(nuxtOptions, { site: {}, sitemap: {}, robots: { blockNonSeoBots: false } }, { robots: { blockNonSeoBots: true } });
    expect(nuxtOptions.robots.blockNonSeoBots).toBe(false);
  });
});

describe('mergeDerivedRobots', () => {
  const customGroup = (userAgent: string) => ({ userAgent: [userAgent], allow: [], disallow: [], [LAIOUTR_GROUP]: true });

  /** What @nuxtjs/robots hands the hook when this module's nuxt.options.robots write was discarded. */
  const upstreamOnly = (): any => ({ sitemap: [], groups: [{ userAgent: ['*'], disallow: [''], allow: [] }] });

  const derived = (overrides: any = {}) => ({ sitemap: ['/sitemap_index.xml'], disallow: ['/api/'], groups: [], ...overrides });

  it('adds custom groups when the nuxt.options.robots write never reached upstream', () => {
    const config = upstreamOnly();
    mergeDerivedRobots(config, derived({ groups: [customGroup('Googlebot')] }));
    expect(config.groups).toEqual([{ userAgent: ['*'], disallow: ['', '/api/'], allow: [] }, customGroup('Googlebot')]);
  });

  it('leaves custom groups alone when the write did reach upstream, so none are emitted twice', () => {
    // The marked group is already in the list, exactly as upstream read it off nuxt.options.robots.
    const config: any = { sitemap: [], groups: [{ userAgent: ['*'], disallow: [''], allow: [] }, customGroup('Googlebot')] };
    mergeDerivedRobots(config, derived({ groups: [customGroup('Googlebot')] }));
    expect(config.groups).toHaveLength(2);
  });

  it('recognizes a group upstream has already normalized', () => {
    // normalizeGroup runs before the hook and rebuilds each group by spread, so the marker rides
    // along on a copy rather than the object we handed over.
    const normalized = { ...customGroup('Googlebot'), _normalized: true, _indexable: true, _rules: [] };
    const config: any = { sitemap: [], groups: [normalized] };
    mergeDerivedRobots(config, derived({ groups: [customGroup('Googlebot')] }));
    expect(config.groups).toEqual([normalized]);
  });

  it('appends the sitemap and internal disallows without dropping what is already there', () => {
    const config: any = { sitemap: ['/other.xml'], groups: [{ userAgent: ['*'], disallow: ['/admin'] }] };
    mergeDerivedRobots(config, derived());
    expect(config.sitemap).toEqual(['/other.xml', '/sitemap_index.xml']);
    expect(config.groups[0].disallow).toEqual(['/admin', '/api/']);
  });

  it('is idempotent on the string lists, so a second module doing the same adds nothing', () => {
    const config = upstreamOnly();
    mergeDerivedRobots(config, derived());
    mergeDerivedRobots(config, derived());
    expect(config.sitemap).toEqual(['/sitemap_index.xml']);
    expect(config.groups[0].disallow).toEqual(['', '/api/']);
  });

  it('reads a single-value userAgent, which upstream also accepts', () => {
    const config: any = { sitemap: [], groups: [{ userAgent: '*', disallow: '/admin' }] };
    mergeDerivedRobots(config, derived());
    expect(config.groups[0].disallow).toEqual(['/admin', '/api/']);
  });

  it('leaves a non-wildcard group untouched', () => {
    const config: any = { sitemap: [], groups: [{ userAgent: ['Googlebot'], disallow: [] }] };
    mergeDerivedRobots(config, derived());
    expect(config.groups[0].disallow).toEqual([]);
  });
});
