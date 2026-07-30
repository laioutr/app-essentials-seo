import { describe, expect, it, vi } from 'vitest';
import { applyUpstreamConfig } from '../../src/module';

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
