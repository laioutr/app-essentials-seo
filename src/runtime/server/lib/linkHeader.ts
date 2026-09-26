import { toMarkdownPath } from '../../shared/markdownPath';

/**
 * The HTML page names its Markdown twin; the twin names its HTML page as canonical, since a Markdown
 * response has no `<head>` to say so. Paths arrive already percent-encoded from the request, so they
 * are not encoded again.
 */
export const buildLinkHeader = (input: {
  path: string;
  variant: 'html' | 'markdown';
  describedby: boolean;
  resolveUrl: (path: string) => string;
}): string => {
  const parts: string[] = [];
  if (input.variant === 'html') {
    parts.push(`<${input.resolveUrl(toMarkdownPath(input.path))}>; rel="alternate"; type="text/markdown"`);
  } else {
    const href = input.resolveUrl(input.path);
    parts.push(`<${href}>; rel="alternate"; type="text/html"`, `<${href}>; rel="canonical"`);
  }
  if (input.describedby) parts.push(`<${input.resolveUrl('/llms.txt')}>; rel="describedby"`);
  return parts.join(', ');
};
