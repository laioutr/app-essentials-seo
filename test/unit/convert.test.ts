import { describe, expect, it, vi } from 'vitest';
import { convertHtmlToMarkdown, resolveMdreamOptions } from '../../src/runtime/server/lib/convert';

const html = `<html><head><title>Red Shoe</title><meta name="description" content="A red shoe"></head><body><div id="__nuxt">
<div data-lfc-location="header"><a href="/menu">Menu</a> Promo</div>
<div data-lfc-location="body"><h1>Red Shoe</h1><p>Great <a href="/shoes">shoe</a>.</p><span data-markdown-ignore>Only 3 left!</span></div>
<div data-lfc-location="body" data-markdown-ignore>Newsletter signup</div>
<div data-lfc-location="footer">Imprint</div></div></body></html>`;

const run = (hooks = { mdreamConfig: vi.fn(async () => {}), pageMarkdown: vi.fn(async () => {}) }) =>
  convertHtmlToMarkdown({
    html,
    url: 'https://shop.ch/p/red-shoe',
    route: '/p/red-shoe',
    event: {} as never,
    mdreamOptions: resolveMdreamOptions({}),
    additionalFrontmatter: { canonical_url: 'https://shop.ch/p/red-shoe', locale: 'de' },
    hooks,
  });

describe('convertHtmlToMarkdown', () => {
  it('keeps the body and drops header, footer and ignored parts', async () => {
    const { markdown } = await run();
    expect(markdown).toContain('# Red Shoe');
    expect(markdown).toContain('[shoe](https://shop.ch/shoes)');
    for (const gone of ['Menu', 'Promo', 'Imprint', 'Only 3 left', 'Newsletter']) expect(markdown).not.toContain(gone);
  });

  it('writes frontmatter from the head plus the fields passed in', async () => {
    const { markdown, title, description } = await run();
    expect(markdown).toMatch(/^---\n/);
    expect(markdown).toContain('canonical_url: "https://shop.ch/p/red-shoe"');
    expect(title).toBe('Red Shoe');
    expect(description).toBe('A red shoe');
  });

  it('lets hooks adjust options and output', async () => {
    const hooks = {
      mdreamConfig: vi.fn(async (options: any) => {
        options.filter.exclude.push('h1');
      }),
      pageMarkdown: vi.fn(async (ctx: any) => {
        ctx.markdown += '\nappended';
      }),
    };
    const { markdown } = await run(hooks);
    expect(markdown).not.toContain('# Red Shoe');
    expect(markdown.endsWith('appended')).toBe(true);
    expect(hooks.pageMarkdown.mock.calls[0]![0]).toMatchObject({ route: '/p/red-shoe', isPrerender: false, title: 'Red Shoe' });
  });

  it('adds project selectors to the defaults instead of replacing them', () => {
    const exclude = (resolveMdreamOptions({ filter: { exclude: ['.promo'] } }).filter as { exclude: string[] }).exclude;
    expect(exclude).toEqual(['.promo', '[data-lfc-location="header"]', '[data-lfc-location="footer"]', '[data-markdown-ignore]']);
  });

  it('keeps one call\'s option mutations from leaking into the next call or the shared options object', async () => {
    const options = resolveMdreamOptions({});
    const first = await convertHtmlToMarkdown({
      html,
      url: 'https://shop.ch/p/red-shoe',
      route: '/p/red-shoe',
      event: {} as never,
      mdreamOptions: options,
      additionalFrontmatter: {},
      hooks: {
        mdreamConfig: vi.fn(async (opts: any) => {
          opts.filter.exclude.push('h1');
        }),
        pageMarkdown: vi.fn(async () => {}),
      },
    });
    const second = await run();

    expect(first.markdown).not.toContain('# Red Shoe');
    expect(second.markdown).toContain('# Red Shoe');
    expect((options.filter as { exclude: string[] }).exclude).toEqual([
      '[data-lfc-location="header"]',
      '[data-lfc-location="footer"]',
      '[data-markdown-ignore]',
    ]);
  });

  it('keeps body content that comes before the first heading', async () => {
    const heroHtml = `<html><head><title>Landing</title></head><body><div id="__nuxt">
<div data-lfc-location="body"><p>Welcome text</p></div>
<div data-lfc-location="body"><h2>Later</h2><p>After</p></div>
</div></body></html>`;
    const { markdown } = await convertHtmlToMarkdown({
      html: heroHtml,
      url: 'https://shop.ch/',
      route: '/',
      event: {} as never,
      mdreamOptions: resolveMdreamOptions({}),
      additionalFrontmatter: {},
      hooks: { mdreamConfig: vi.fn(async () => {}), pageMarkdown: vi.fn(async () => {}) },
    });
    expect(markdown).toContain('Welcome text');
    expect(markdown).toContain('## Later');
    expect(markdown).toContain('After');
  });

  it('accepts a function-valued extraction option without throwing', async () => {
    const extracted: unknown[] = [];
    const { markdown } = await convertHtmlToMarkdown({
      html,
      url: 'https://shop.ch/p/red-shoe',
      route: '/p/red-shoe',
      event: {} as never,
      mdreamOptions: resolveMdreamOptions({ extraction: { h1: (element: unknown) => extracted.push(element) } } as never),
      additionalFrontmatter: {},
      hooks: { mdreamConfig: vi.fn(async () => {}), pageMarkdown: vi.fn(async () => {}) },
    });

    expect(markdown).toContain('# Red Shoe');
    expect(extracted).toHaveLength(1);
    expect(extracted[0]).toMatchObject({ tagName: 'h1', textContent: 'Red Shoe' });
  });
});
