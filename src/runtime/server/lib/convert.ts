import { defu } from 'defu';
import { htmlToMarkdown, type MdreamOptions } from 'mdream';
import type { PageMarkdownContext } from '../../types/markdown';
import type { H3Event } from 'h3';

/**
 * frontend-core renders no `<main>`, so mdream's main-content heuristics would be guessing. Every
 * section root does carry its page region, and header and footer sections repeat on every page.
 */
export const DEFAULT_MDREAM_OPTIONS: Partial<MdreamOptions> = {
  minimal: true,
  clean: true,
  filter: {
    exclude: ['[data-lfc-location="header"]', '[data-lfc-location="footer"]', '[data-markdown-ignore]'],
  },
  // `minimal` turns this on by default, and its heuristic guesses at a "main content" region the
  // same way the comment above already distrusts — dropping any body content before the first
  // heading (hero or intro copy) instead of the header/footer this module actually knows about.
  isolateMain: false,
};

/** `defu` concatenates arrays, so a project's selectors add to ours rather than replace them. */
export const resolveMdreamOptions = (project: Record<string, unknown>): Partial<MdreamOptions> =>
  defu(project, DEFAULT_MDREAM_OPTIONS) as Partial<MdreamOptions>;

// mdream renders `&nbsp;` as U+00A0, which reads like a normal space but isn't one; the escape
// (rather than the raw byte) keeps the source unambiguous instead of relying on invisible width.
const NBSP = /\u00A0/g;

/**
 * Deep-copies mdream options so a hook's mutation (e.g. pushing a selector onto `filter.exclude`)
 * never leaks into the next request or into the shared `DEFAULT_MDREAM_OPTIONS` these came from.
 * `structuredClone` would do that, but it throws on a function value, and mdream's `extraction`
 * option is callback-valued. So this rebuilds plain objects/arrays by hand and passes functions
 * (and any other non-cloneable value) through by reference instead.
 */
const cloneMdreamOptions = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(cloneMdreamOptions) as unknown as T;
  const clone: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) clone[key] = cloneMdreamOptions(nested);
  return clone as T;
};

export const convertHtmlToMarkdown = async (input: {
  html: string;
  url: string;
  route: string;
  event: H3Event;
  mdreamOptions: Partial<MdreamOptions>;
  additionalFrontmatter: Record<string, string>;
  hooks: {
    mdreamConfig: (options: Partial<MdreamOptions>) => Promise<void>;
    pageMarkdown: (ctx: PageMarkdownContext) => Promise<void>;
  };
}): Promise<{ markdown: string; title: string; description: string }> => {
  const meta = { title: '', description: '' };
  const options: Partial<MdreamOptions> = {
    origin: new URL(input.url).origin,
    ...cloneMdreamOptions(input.mdreamOptions),
    frontmatter: {
      additionalFields: input.additionalFrontmatter,
      onExtract: (frontmatter) => {
        if (frontmatter.title) meta.title = frontmatter.title;
        if (frontmatter.description) meta.description = frontmatter.description;
      },
    },
  };
  await input.hooks.mdreamConfig(options);

  const context: PageMarkdownContext = {
    html: input.html,
    markdown: htmlToMarkdown(input.html, options),
    route: input.route,
    title: meta.title,
    description: meta.description,
    isPrerender: false,
    event: input.event,
  };
  await input.hooks.pageMarkdown(context);

  return {
    markdown: context.markdown.replace(NBSP, ' '),
    title: meta.title.replace(NBSP, ' '),
    description: meta.description.replace(NBSP, ' '),
  };
};
