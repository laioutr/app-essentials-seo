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
};

/** `defu` concatenates arrays, so a project's selectors add to ours rather than replace them. */
export const resolveMdreamOptions = (project: Record<string, unknown>): Partial<MdreamOptions> =>
  defu(project, DEFAULT_MDREAM_OPTIONS) as Partial<MdreamOptions>;

// mdream renders `&nbsp;` as U+00A0, which reads like a normal space but isn't one; the escape
// (rather than the raw byte) keeps the source unambiguous instead of relying on invisible width.
const NBSP = /\u00A0/g;

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
  // Cloned so a hook that mutates options never leaks into the next request's defaults.
  const options: Partial<MdreamOptions> = {
    origin: new URL(input.url).origin,
    ...structuredClone(input.mdreamOptions),
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
