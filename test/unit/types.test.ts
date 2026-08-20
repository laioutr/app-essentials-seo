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
    expect(resolved.sitemap.entriesPerRequest).toBe(10_000);
    expect(resolved.sitemap.includeImages).toBe(true);
    expect(resolved.robots.enabled).toBe(true);
    expect(resolved.robots.extraDisallow).toEqual([]);
    expect(resolved.robots.localizeRules).toBe(true);
  });

  it('lets a project turn rule localization off', () => {
    expect(resolveOptions({ robots: { localizeRules: false } }).robots.localizeRules).toBe(false);
  });

  it('keeps caller values and still fills the rest', () => {
    const resolved = resolveOptions({ sitemap: { entriesPerRequest: 500 } });
    expect(resolved.sitemap.entriesPerRequest).toBe(500);
    expect(resolved.sitemap.enabled).toBe(true);
  });

  it('rejects an entriesPerRequest below 1', () => {
    expect(() => resolveOptions({ sitemap: { entriesPerRequest: 0 } })).toThrow();
  });
});

describe('resolveOptions — robots content preferences', () => {
  const group = (fields: Record<string, unknown>) => resolveOptions({ robots: { customGroups: [fields] } }).robots.customGroups[0];

  it('defaults both preference lists to empty so upstream emits no line', () => {
    expect(group({})).toEqual({ userAgent: ['*'], allow: [], disallow: [], contentUsage: [], contentSignal: [] });
  });

  it('keeps rule strings as authored', () => {
    expect(group({ contentUsage: ['train-ai=n'], contentSignal: ['ai-train=no'] })).toMatchObject({
      contentUsage: ['train-ai=n'],
      contentSignal: ['ai-train=no'],
    });
  });

  it('accepts a comma-separated list and a path-scoped rule', () => {
    expect(group({ contentUsage: ['bots=y, search=y', '/private train-ai=n,ai-output=n'] })).toMatchObject({
      contentUsage: ['bots=y, search=y', '/private train-ai=n,ai-output=n'],
    });
  });

  it('accepts the preferences-object form upstream also takes', () => {
    expect(group({ contentUsage: { 'train-ai': 'n' }, contentSignal: { 'ai-train': 'no', 'search': 'yes' } })).toMatchObject({
      contentUsage: { 'train-ai': 'n' },
      contentSignal: { 'ai-train': 'no', 'search': 'yes' },
    });
  });

  it('rejects a category from the other vocabulary', () => {
    expect(() => group({ contentUsage: ['ai-train=n'] })).toThrow();
    expect(() => group({ contentSignal: ['train-ai=no'] })).toThrow();
  });

  it('rejects a value from the other vocabulary', () => {
    expect(() => group({ contentUsage: ['train-ai=no'] })).toThrow();
    expect(() => group({ contentSignal: ['ai-train=n'] })).toThrow();
  });

  it('rejects a rule with no assignment, and a path that is not one', () => {
    expect(() => group({ contentUsage: ['train-ai'] })).toThrow();
    expect(() => group({ contentUsage: [''] })).toThrow();
    expect(() => group({ contentUsage: ['private train-ai=n'] })).toThrow();
  });

  it('rejects a mistyped key in the object form rather than silently dropping it', () => {
    expect(() => group({ contentUsage: { trainAi: 'n' } })).toThrow();
  });
});
