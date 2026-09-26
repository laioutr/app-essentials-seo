import { describe, expect, it } from 'vitest';
import { buildFrontmatter, layerFrontmatter, notFoundMarkdown } from '../../src/runtime/server/lib/frontmatter';

describe('frontmatter', () => {
  it('writes the upstream keys in upstream order, escaping quotes', () => {
    expect(buildFrontmatter({ title: 'A "B"', canonical_url: 'https://shop.ch/a', locale: 'de' })).toBe(
      '---\ntitle: "A \\"B\\""\ncanonical_url: "https://shop.ch/a"\nlocale: "de"\n---\n'
    );
  });

  it('layers fields over existing frontmatter', () => {
    expect(layerFrontmatter({ canonical_url: 'https://shop.ch/a' }, '---\ntitle: x\n---\n\nBody')).toBe(
      '---\ntitle: x\ncanonical_url: https://shop.ch/a\n---\n\nBody'
    );
  });

  it('prepends frontmatter when there is none', () => {
    expect(layerFrontmatter({ title: 'T' }, 'Body')).toBe('---\ntitle: "T"\n---\n\nBody');
  });

  it('renders the upstream not-found body', () => {
    const md = notFoundMarkdown({ path: '/x', canonicalUrl: 'https://shop.ch/x', resolveUrl: (p) => `https://shop.ch${p}` });
    expect(md).toContain('# Page not found');
    expect(md).toContain('No content is available at `/x`.');
    expect(md).toContain('- [llms.txt](https://shop.ch/llms.txt)');
  });
});
