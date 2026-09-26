import { describe, expect, it } from 'vitest';
import { type LlmsTxtModel, renderLlmsTxt } from '../../src/runtime/server/lib/llmsTxt/format';

const model = (overrides: Partial<LlmsTxtModel> = {}): LlmsTxtModel => ({
  siteName: 'Shop',
  description: 'Shoes',
  origin: 'https://shop.ch',
  notes: 'Prices in CHF.',
  sections: [
    { title: 'Help', links: [{ title: 'FAQ', href: 'https://shop.ch/faq.md' }] },
    { title: 'Legal', optional: true, links: [{ title: 'Imprint', href: 'https://shop.ch/imprint.md' }] },
  ],
  resources: [{ title: 'sitemap_index.xml', href: 'https://shop.ch/sitemap_index.xml', description: 'XML sitemap for search engines and crawlers.' }],
  languages: [],
  pages: [
    { path: '/about', href: 'https://shop.ch/about.md', description: 'About us' },
    { path: '/', href: 'https://shop.ch/index.md', title: 'Home' },
  ],
  pageTypes: [{ title: 'Product', href: 'https://shop.ch/__sitemap__/p-de.xml', pattern: '/p/{slug}', count: 12400 }],
  ...overrides,
});

describe('renderLlmsTxt', () => {
  it('renders the upstream layout plus Page Types', () => {
    expect(renderLlmsTxt(model())).toBe(
      [
        '# Shop',
        '',
        '> Shoes',
        '',
        'Canonical Origin: https://shop.ch/',
        '',
        '**Notes:**',
        '',
        'Prices in CHF.',
        '',
        '## LLM Resources',
        '',
        '- [sitemap_index.xml](https://shop.ch/sitemap_index.xml): XML sitemap for search engines and crawlers.',
        '',
        '## Help',
        '',
        '- [FAQ](https://shop.ch/faq.md)',
        '',
        '## Optional',
        '',
        '- [Imprint](https://shop.ch/imprint.md): Legal',
        '',
        '## Pages',
        '',
        '- [Home](https://shop.ch/index.md)',
        '- [/about](https://shop.ch/about.md): About us',
        '',
        '## Page Types',
        '',
        '- [Product](https://shop.ch/__sitemap__/p-de.xml): ~12,400 pages at /p/{slug}. Append .md to any URL for Markdown.',
        '',
      ].join('\n')
    );
  });

  it('omits the count it does not know, and puts an authored description first', () => {
    const text = renderLlmsTxt(
      model({ pageTypes: [{ title: 'Product', href: 'https://x', pattern: '/p/{slug}', description: 'Our running shoes.' }] })
    );
    expect(text).toContain('- [Product](https://x): Our running shoes. Pages at /p/{slug}. Append .md to any URL for Markdown.');
  });

  it('lists languages only when the host serves more than one', () => {
    const languages = [
      { code: 'de', name: 'German', href: 'https://shop.ch/index.md', isDefault: true },
      { code: 'fr', name: 'French', href: 'https://shop.ch/fr.md', isDefault: false },
    ];
    const text = renderLlmsTxt(model({ languages }));
    expect(text).toContain('## Available Languages on Website\n\n- [German (de)](https://shop.ch/index.md): content included below.\n- [French (fr)](https://shop.ch/fr.md): visit this language for content.');
    expect(renderLlmsTxt(model({ languages: languages.slice(0, 1) }))).not.toContain('Available Languages');
  });

  it('leaves out empty generated sections', () => {
    const text = renderLlmsTxt(model({ pages: [], pageTypes: [] }));
    expect(text).not.toContain('## Pages');
    expect(text).not.toContain('## Page Types');
  });

  it('truncates page descriptions at 160 characters and escapes brackets in titles', () => {
    const text = renderLlmsTxt(model({ pages: [{ path: '/a', href: 'https://x/a.md', title: 'A [B]', description: 'x'.repeat(200) }] }));
    expect(text).toContain(`- [A &#91;B&#93;](https://x/a.md): ${'x'.repeat(160)}...`);
  });
});
