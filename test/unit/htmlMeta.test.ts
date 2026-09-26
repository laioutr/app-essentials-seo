import { describe, expect, it } from 'vitest';
import { extractLastUpdated, extractMetaRobots } from '../../src/runtime/server/lib/htmlMeta';

describe('htmlMeta', () => {
  it('reads the robots meta whatever the attribute order', () => {
    expect(extractMetaRobots('<meta content="noindex, follow" name="robots">')).toBe('noindex, follow');
    expect(extractMetaRobots('<meta name="ROBOTS" content="noindex">')).toBe('noindex');
    expect(extractMetaRobots('<meta name="description" content="x">')).toBeUndefined();
  });

  it('does not mistake a data attribute for the name', () => {
    expect(extractMetaRobots('<meta data-name="robots" content="noindex">')).toBeUndefined();
  });

  it('reads the first last-modified style meta', () => {
    expect(extractLastUpdated('<meta property="article:modified_time" content="2026-09-01">')).toBe('2026-09-01');
  });
});
