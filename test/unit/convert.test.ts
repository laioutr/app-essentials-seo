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
});
