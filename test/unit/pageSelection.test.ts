import { describe, expect, it } from 'vitest';
import { defaultVariant, isDynamicPath, isNoindexRobots, isPageIncluded } from '../../src/runtime/shared/pageSelection';

const variant = (seo: { robots?: string }, conditions?: unknown) => ({ conditions, seo: { title: '', description: '', ...seo } });

describe('isDynamicPath', () => {
  it('detects params in a plain path', () => {
    expect(isDynamicPath('/products/:slug+')).toBe(true);
    expect(isDynamicPath('/pricing')).toBe(false);
  });

  it('detects params in any locale of a localized path', () => {
    expect(isDynamicPath({ de: '/produkte/:slug', en: '/products/:slug' })).toBe(true);
    expect(isDynamicPath({ de: '/preise', en: '/pricing' })).toBe(false);
  });
});

describe('defaultVariant', () => {
  it('picks the variant with no conditions', () => {
    const page = { variants: { a: variant({}, { rules: [] }), b: variant({ robots: 'noindex' }) } };
    expect(defaultVariant(page)?.seo.robots).toBe('noindex');
  });

  it('falls back to the first variant when every one is conditional', () => {
    const page = { variants: { a: variant({ robots: 'all' }, { rules: [] }), b: variant({}, { rules: [] }) } };
    expect(defaultVariant(page)?.seo.robots).toBe('all');
  });

  it('returns undefined when there are no variants', () => {
    expect(defaultVariant({ variants: {} })).toBeUndefined();
  });
});

describe('isNoindexRobots', () => {
  it('matches noindex in any casing or position', () => {
    expect(isNoindexRobots('noindex')).toBe(true);
    expect(isNoindexRobots('NoIndex, follow')).toBe(true);
    expect(isNoindexRobots('follow, noindex')).toBe(true);
  });

  it('does not match an unrelated directive', () => {
    expect(isNoindexRobots('index, follow')).toBe(false);
    expect(isNoindexRobots(undefined)).toBe(false);
  });

  it('does not match a substring of another token', () => {
    expect(isNoindexRobots('max-snippet:-1')).toBe(false);
  });
});

describe('isPageIncluded', () => {
  const base = { id: 'p1', type: 'core/landingpage', variants: { a: variant({}) } };

  it('includes a page with no market scoping', () => {
    expect(isPageIncluded(base, { marketId: 'm1', excludePageTypes: [] })).toBe(true);
  });

  it('excludes a page scoped to another market', () => {
    expect(isPageIncluded({ ...base, marketIds: ['m2'] }, { marketId: 'm1', excludePageTypes: [] })).toBe(false);
  });

  it('includes a page scoped to this market', () => {
    expect(isPageIncluded({ ...base, marketIds: ['m1'] }, { marketId: 'm1', excludePageTypes: [] })).toBe(true);
  });

  it('always excludes the catch-all 404 type', () => {
    expect(isPageIncluded({ ...base, type: 'core/404' }, { marketId: 'm1', excludePageTypes: [] })).toBe(false);
  });

  it('excludes a configured page type', () => {
    expect(isPageIncluded(base, { marketId: 'm1', excludePageTypes: ['core/landingpage'] })).toBe(false);
  });

  it('excludes a page whose default variant is noindex', () => {
    const page = { ...base, variants: { a: variant({ robots: 'noindex, follow' }) } };
    expect(isPageIncluded(page, { marketId: 'm1', excludePageTypes: [] })).toBe(false);
  });
});
