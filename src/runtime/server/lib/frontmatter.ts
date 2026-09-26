import { isMap, parseDocument } from 'yaml';

export interface FrontmatterFields {
  title?: string;
  description?: string;
  canonical_url?: string;
  last_updated?: string;
  locale?: string;
}

const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Key order and quoting match nuxt-ai-ready's, so a twin reads the same after the switch. */
export const buildFrontmatter = (fields: FrontmatterFields): string => {
  const lines = ['---'];
  for (const key of ['title', 'description', 'canonical_url', 'last_updated', 'locale'] as const) {
    const value = fields[key];
    if (value) lines.push(`${key}: "${escape(value)}"`);
  }
  lines.push('---', '');
  return lines.join('\n');
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Sets `fields` on Markdown that may already carry frontmatter, keeping its other keys. */
export const layerFrontmatter = (fields: FrontmatterFields, markdown: string): string => {
  const match = FRONTMATTER.exec(markdown);
  const document = match ? parseDocument(match[1] ?? '') : undefined;
  if (!match || !document || document.errors.length > 0 || !isMap(document.contents)) {
    return `${buildFrontmatter(fields)}\n${markdown}`;
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== '') document.set(key, value);
  }
  const body = markdown.slice(match[0].length).replace(/^\r?\n/, '');
  return `---\n${document.toString({ lineWidth: 0 }).trimEnd()}\n---\n\n${body}`;
};

export const notFoundMarkdown = (input: {
  path: string;
  canonicalUrl: string;
  resolveUrl: (path: string) => string;
  locale?: string;
}): string => {
  const frontmatter = buildFrontmatter({
    title: 'Page not found',
    description: `No content is available at ${input.path}.`,
    canonical_url: input.canonicalUrl,
    locale: input.locale,
  });
  const body = [
    '# Page not found',
    '',
    `No content is available at \`${input.path}\`.`,
    '',
    'Try one of these resources:',
    '',
    `- [Sitemap](${input.resolveUrl('/sitemap_index.xml')})`,
    `- [llms.txt](${input.resolveUrl('/llms.txt')})`,
    '',
  ].join('\n');
  return `${frontmatter}\n${body}`;
};
