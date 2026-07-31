import { describe, expect, it } from 'vitest';
import { composePath, fillParams, hasUnfilledParams, missingParams, unlocalize } from '../../src/runtime/shared/path';

describe('fillParams', () => {
  it('substitutes a simple param', () => {
    expect(fillParams('/products/:slug', { slug: 'shoe' })).toBe('/products/shoe');
  });

  it('joins a repeatable param with slashes and drops the modifier', () => {
    expect(fillParams('/products/:slug+', { slug: ['a', 'b'] })).toBe('/products/a/b');
  });

  it('uses the first option of a finite set when no value is given', () => {
    expect(fillParams('/:param0(foo|bar)', {})).toBe('/foo');
  });

  it('substitutes empty string for a missing param', () => {
    expect(fillParams('/products/:slug', {})).toBe('/products/');
  });
});

describe('missingParams', () => {
  it('reports a plain param with no value', () => {
    expect(missingParams('/products/:slug', {})).toEqual(['slug']);
  });

  it('does not report a finite-set param with no value', () => {
    expect(missingParams('/:param0(foo|bar)', {})).toEqual([]);
  });

  it('reports an empty-string value', () => {
    expect(missingParams('/products/:slug', { slug: '' })).toEqual(['slug']);
  });

  it('does not report a supplied value', () => {
    expect(missingParams('/products/:slug', { slug: 'shoe' })).toEqual([]);
  });
});

describe('hasUnfilledParams', () => {
  it('detects a leftover placeholder', () => {
    expect(hasUnfilledParams('/products/:slug')).toBe(true);
  });

  it('detects an empty segment left by a missing param', () => {
    expect(hasUnfilledParams('/products//')).toBe(true);
    expect(hasUnfilledParams('/products/')).toBe(false);
  });

  it('accepts a fully filled path', () => {
    expect(hasUnfilledParams('/products/shoe')).toBe(false);
  });
});

describe('composePath', () => {
  it('joins a prefix and a path', () => {
    expect(composePath('/fr', '/produits', false)).toBe('/fr/produits');
  });

  it('treats an empty prefix as root', () => {
    expect(composePath('', '/produits', false)).toBe('/produits');
  });

  it('appends a trailing slash when asked', () => {
    expect(composePath('/fr', '/produits', true)).toBe('/fr/produits/');
  });

  it('never doubles a slash at the seam', () => {
    expect(composePath('/fr/', '/produits', false)).toBe('/fr/produits');
  });

  it('keeps root as a single slash in both modes', () => {
    expect(composePath('', '/', false)).toBe('/');
    expect(composePath('', '/', true)).toBe('/');
  });
});

describe('unlocalize', () => {
  it('returns a plain value unchanged', () => {
    expect(unlocalize('/about', ['de', 'en'])).toBe('/about');
  });

  it('picks the first locale in the chain that has a value', () => {
    expect(unlocalize({ en: '/about', de: '/ueber-uns' }, ['de', 'en'])).toBe('/ueber-uns');
  });

  it('falls back down the chain', () => {
    expect(unlocalize({ en: '/about' }, ['de', 'en'])).toBe('/about');
  });

  it('returns undefined when no locale in the chain matches', () => {
    expect(unlocalize({ fr: '/a-propos' }, ['de', 'en'])).toBeUndefined();
  });

  it('walks past an empty string rather than treating it as a path', () => {
    expect(unlocalize({ de: '', en: '/about' }, ['de', 'en'])).toBe('/about');
  });

  it('walks past a null the way Studio writes a cleared field', () => {
    // A cleared localized field arrives as null, not as a missing key. Returning it would end the
    // chain and drop the page from that locale's sitemap even though a fallback exists.
    expect(unlocalize({ de: null, en: '/about' }, ['de', 'en'])).toBe('/about');
  });

  it('never returns null, which its signature already promised', () => {
    expect(unlocalize(null as never, ['de'])).toBeUndefined();
    expect(unlocalize({ de: null } as never, ['de'])).toBeUndefined();
  });
});
