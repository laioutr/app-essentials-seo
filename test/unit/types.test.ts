import { describe, expect, it } from 'vitest';
import { MODULE_NAME, resolveOptions } from '../../src/types';

describe('resolveOptions', () => {
  it('exposes the package name as the config key', () => {
    expect(MODULE_NAME).toBe('@laioutr/app-essentials-seo');
  });

  it('fills every default so consumers need no guards', () => {
    const resolved = resolveOptions(undefined);
    expect(resolved.indexable).toBe('auto');
    expect(resolved.sitemap.enabled).toBe(true);
    expect(resolved.sitemap.excludePageTypes).toEqual([]);
    expect(resolved.sitemap.rebuildBatchSize).toBe(10_000);
    expect(resolved.sitemap.includeImages).toBe(true);
    expect(resolved.robots.enabled).toBe(true);
    expect(resolved.robots.extraDisallow).toEqual([]);
  });

  it('keeps caller values and still fills the rest', () => {
    const resolved = resolveOptions({ sitemap: { rebuildBatchSize: 500 } });
    expect(resolved.sitemap.rebuildBatchSize).toBe(500);
    expect(resolved.sitemap.enabled).toBe(true);
  });

  it('rejects a rebuildBatchSize below 1', () => {
    expect(() => resolveOptions({ sitemap: { rebuildBatchSize: 0 } })).toThrow();
  });
});
