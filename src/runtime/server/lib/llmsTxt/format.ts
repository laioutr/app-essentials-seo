export interface LlmsTxtLink {
  title: string;
  href: string;
  description?: string;
}

export interface LlmsTxtSection {
  title: string;
  description?: string | string[];
  links: LlmsTxtLink[];
  optional?: boolean;
}

export interface LlmsTxtPage {
  path: string;
  href: string;
  title?: string;
  description?: string;
}

export interface LlmsTxtPageType {
  title: string;
  href: string;
  /** Route template with params written as `{name}`. */
  pattern: string;
  /** Known only once the page type's sitemap has been fully enumerated. */
  count?: number;
  description?: string;
}

export interface LlmsTxtLanguage {
  code: string;
  name: string;
  href: string;
  isDefault: boolean;
}

export interface LlmsTxtModel {
  siteName: string;
  description?: string;
  origin: string;
  notes: string | string[];
  sections: LlmsTxtSection[];
  resources: LlmsTxtLink[];
  languages: LlmsTxtLanguage[];
  pages: LlmsTxtPage[];
  pageTypes: LlmsTxtPageType[];
}

// Link, section, preamble and page-grouping formatting below is ported from nuxt-ai-ready (MIT), so
// the parts both modules produce read identically.

const INLINE_WHITESPACE = /\s+/g;
const TITLE_BRACKET = /[[\]]/g;
const HREF_UNSAFE = /[\s()]/g;
const PREAMBLE_ATX_HEADING = /^( {0,3})(#{1,6})(?=\s)/gm;

const inline = (value: string) => value.trim().replace(INLINE_WHITESPACE, ' ');
const linkTitle = (value: string) => inline(value).replace(TITLE_BRACKET, (bracket) => (bracket === '[' ? '&#91;' : '&#93;'));
const linkHref = (value: string) =>
  value.trim().replace(HREF_UNSAFE, (character) => {
    if (character === '(') return '%28';
    if (character === ')') return '%29';
    return encodeURIComponent(character);
  });

const asList = (value: string | string[] | undefined): string[] => {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
};
const descriptions = (value: string | string[] | undefined) => asList(value).filter((entry) => entry.trim()).map(inline);
const preambleBlocks = (value: string | string[] | undefined) =>
  asList(value)
    .filter((block) => block.trim())
    .map((block) => block.trim().replace(PREAMBLE_ATX_HEADING, '$1\\$2'));

const formatLink = (link: LlmsTxtLink, descriptionPrefixes: string[] = []): string => {
  const description = [...descriptionPrefixes, link.description]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(inline)
    .join('; ');
  return `- [${linkTitle(link.title)}](${linkHref(link.href)})${description ? `: ${description}` : ''}`;
};

const formatAuthored = (notes: string | string[], sections: LlmsTxtSection[]): string => {
  const required = sections.filter((section) => !section.optional);
  const optional = sections.filter((section) => section.optional);
  const parts: string[] = [];

  const noteBlocks = preambleBlocks(notes);
  if (noteBlocks.length > 0) parts.push(['**Notes:**', ...noteBlocks].join('\n\n'));
  for (const section of required) {
    const blocks = preambleBlocks(section.description);
    if (blocks.length > 0) parts.push([`**${inline(section.title)}:**`, ...blocks].join('\n\n'));
  }

  for (const section of required) {
    if (section.links.length > 0) parts.push([`## ${inline(section.title)}`, '', ...section.links.map((link) => formatLink(link))].join('\n'));
  }

  const optionalLinks = optional.flatMap((section) =>
    section.links.map((link) => formatLink(link, [section.title, ...descriptions(section.description)]))
  );
  if (optionalLinks.length > 0) parts.push(['## Optional', '', ...optionalLinks].join('\n'));

  return parts.join('\n\n');
};

const segmentsOf = (path: string) => path.split('/').filter(Boolean);

const groupPrefix = (path: string, depth: 1 | 2) => {
  const segments = segmentsOf(path);
  if (segments.length === 0) return '/';
  if (depth === 1 || segments.length === 1) return `/${segments[0]}`;
  return `/${segments[0]}/${segments[1]}`;
};

const analyzeGroups = (pages: LlmsTxtPage[]) => {
  const twoSegmentCount = new Map<string, number>();
  const segmentHasNested = new Map<string, boolean>();
  for (const page of pages) {
    const prefix = groupPrefix(page.path, 2);
    twoSegmentCount.set(prefix, (twoSegmentCount.get(prefix) ?? 0) + 1);
    const segments = segmentsOf(page.path);
    const first = segments[0] ?? '';
    if (!segmentHasNested.has(first)) segmentHasNested.set(first, false);
    if (segments.length > 1) segmentHasNested.set(first, true);
  }
  return { twoSegmentCount, segmentHasNested };
};

const groupKey = (path: string, analysis: ReturnType<typeof analyzeGroups>) => {
  const segments = segmentsOf(path);
  const first = segments[0] ?? '';
  const twoSegment = groupPrefix(path, 2);
  let key = (analysis.twoSegmentCount.get(twoSegment) ?? 0) > 1 ? twoSegment : `/${first}`;
  if (segments.length <= 1 && !analysis.segmentHasNested.get(first)) key = '';
  return key;
};

const sortPages = (pages: LlmsTxtPage[]): LlmsTxtPage[] => {
  const analysis = analyzeGroups(pages);
  return [...pages].sort((a, b) => {
    const keyA = groupKey(a.path, analysis);
    const keyB = groupKey(b.path, analysis);
    if (keyA === '' && keyB !== '') return -1;
    if (keyA !== '' && keyB === '') return 1;
    if (keyA !== keyB) return keyA.localeCompare(keyB);
    const segmentsA = segmentsOf(a.path);
    const segmentsB = segmentsOf(b.path);
    if (segmentsA.length === 0) return -1;
    if (segmentsB.length === 0) return 1;
    for (let i = 0; i < Math.min(segmentsA.length, segmentsB.length); i++) {
      const compared = segmentsA[i]!.localeCompare(segmentsB[i]!);
      if (compared !== 0) return compared;
    }
    return segmentsA.length - segmentsB.length;
  });
};

const formatPage = (page: LlmsTxtPage): string => {
  const description = page.description?.trim().replace(INLINE_WHITESPACE, ' ');
  const title = page.title ? inline(page.title) : '';
  return formatLink({
    title: title && title !== page.path ? title : page.path,
    href: page.href,
    description: description ? `${description.slice(0, 160)}${description.length > 160 ? '...' : ''}` : undefined,
  });
};

const formatPageGroups = (pages: LlmsTxtPage[]): string[] => {
  const analysis = analyzeGroups(pages);
  const lines: string[] = [];
  let currentGroup = '';
  let groupIndex = 0;
  let inGroup = 0;
  for (const page of pages) {
    const key = groupKey(page.path, analysis);
    if (key !== currentGroup) {
      if (inGroup > 0 && (groupIndex === 0 || (groupIndex <= 2 && inGroup > 1))) lines.push('');
      currentGroup = key;
      groupIndex++;
      inGroup = 0;
    }
    inGroup++;
    lines.push(formatPage(page));
  }
  return lines;
};

const formatPageType = (type: LlmsTxtPageType): string => {
  const reach = `${type.count === undefined ? 'Pages' : `~${type.count.toLocaleString('en-US')} pages`} at ${type.pattern}. Append .md to any URL for Markdown.`;
  return formatLink({ title: type.title, href: type.href, description: [type.description?.trim(), reach].filter(Boolean).join(' ') });
};

export const renderLlmsTxt = (model: LlmsTxtModel): string => {
  const parts: string[] = [`# ${model.siteName}`];
  if (model.description) parts.push(`\n> ${model.description}`);
  parts.push(`\nCanonical Origin: ${model.origin}/`, '');

  const authored = formatAuthored(model.notes, [{ title: 'LLM Resources', links: model.resources }, ...model.sections]);
  if (authored) parts.push(authored, '');

  if (model.languages.length > 1) {
    parts.push(
      '## Available Languages on Website',
      '',
      ...model.languages.map((language) =>
        formatLink({
          title: `${language.name} (${language.code})`,
          href: language.href,
          description: language.isDefault ? 'content included below.' : 'visit this language for content.',
        })
      ),
      ''
    );
  }

  if (model.pages.length > 0) parts.push('## Pages\n', ...formatPageGroups(sortPages(model.pages)), '');
  if (model.pageTypes.length > 0) parts.push('## Page Types\n', ...model.pageTypes.map(formatPageType), '');

  return parts.join('\n');
};
