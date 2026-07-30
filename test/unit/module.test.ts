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
});
