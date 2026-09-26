import { describe, expect, it } from 'vitest';
import { fromMarkdownPath, isReservedPath, markdownAlternatePath, toMarkdownPath } from '../../src/runtime/shared/markdownPath';

describe('markdown paths', () => {
  it('maps a page path to its .md twin', () => {
    expect(toMarkdownPath('/')).toBe('/index.md');
    expect(toMarkdownPath('/about/')).toBe('/about.md');
    expect(toMarkdownPath('/fr')).toBe('/fr.md');
  });

  it('inverts the mapping, including an explicit index', () => {
    expect(fromMarkdownPath('/index.md')).toBe('/');
    expect(fromMarkdownPath('/fr/index.md')).toBe('/fr');
    expect(fromMarkdownPath('/about.md')).toBe('/about');
  });

  it('reserves API, underscore and dev-server paths', () => {
    expect(isReservedPath('/api/cart')).toBe(true);
    expect(isReservedPath('/__sitemap__/pages-de.xml')).toBe(true);
    expect(isReservedPath('/_laioutr/x')).toBe(true);
    expect(isReservedPath('/apiary')).toBe(false);
  });

  it('offers no alternate for reserved paths or files', () => {
    expect(markdownAlternatePath('/api/x')).toBeNull();
    expect(markdownAlternatePath('/robots.txt')).toBeNull();
    expect(markdownAlternatePath('/p/red-shoe')).toBe('/p/red-shoe.md');
  });
});
