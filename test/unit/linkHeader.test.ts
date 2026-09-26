import { describe, expect, it } from 'vitest';
import { buildLinkHeader } from '../../src/runtime/server/lib/linkHeader';

const resolveUrl = (path: string) => `https://shop.ch${path}`;

describe('buildLinkHeader', () => {
  it('points an HTML page at its twin and at llms.txt', () => {
    expect(buildLinkHeader({ path: '/', variant: 'html', describedby: true, resolveUrl })).toBe(
      '<https://shop.ch/index.md>; rel="alternate"; type="text/markdown", <https://shop.ch/llms.txt>; rel="describedby"'
    );
  });

  it('points a twin back at its canonical HTML page', () => {
    expect(buildLinkHeader({ path: '/a', variant: 'markdown', describedby: false, resolveUrl })).toBe(
      '<https://shop.ch/a>; rel="alternate"; type="text/html", <https://shop.ch/a>; rel="canonical"'
    );
  });
});
