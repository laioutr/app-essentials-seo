import { describe, expect, it } from 'vitest';
import {
  contentNegotiationFor,
  decideNegotiation,
  INTERNAL_HEADER,
  NEGOTIATION_VARY,
  resolveMarkdownRedirect,
} from '../../src/runtime/server/lib/negotiation';

const decide = (path: string, headers: Record<string, string> = {}, contentNegotiation = true) =>
  decideNegotiation({ path, headers, contentNegotiation });

describe('decideNegotiation', () => {
  it('renders an explicit .md request', () => {
    expect(decide('/about.md')).toEqual({ kind: 'render', path: '/about' });
    expect(decide('/index.md?x=1')).toEqual({ kind: 'render', path: '/' });
  });

  it('serves HTML to a browser navigation', () => {
    expect(decide('/about', { 'accept': 'text/html,*/*;q=0.8', 'sec-fetch-dest': 'document' })).toEqual({
      kind: 'html',
      path: '/about',
      negotiated: true,
    });
  });

  it('redirects a client that prefers Markdown', () => {
    expect(decide('/about', { accept: 'text/markdown' })).toEqual({ kind: 'redirect', path: '/about' });
  });

  it('redirects a known AI agent even without an Accept preference', () => {
    expect(decide('/about', { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)' })).toEqual({
      kind: 'redirect',
      path: '/about',
    });
  });

  it('falls through to html when nothing acceptable was asked for, so a custom route still answers as it always did', () => {
    expect(decide('/about', { accept: 'application/pdf' })).toEqual({ kind: 'html', path: '/about', negotiated: true });
  });

  it('normalises a leading run of slashes and backslashes before deciding, so a negotiated redirect can never leave this origin', () => {
    expect(decide('//evil.com/x', { accept: 'text/markdown' })).toEqual({ kind: 'redirect', path: '/evil.com/x' });
    expect(decide('/\\evil.com/x', { accept: 'text/markdown' })).toEqual({ kind: 'redirect', path: '/evil.com/x' });
    expect(decide('//evil.com/x.md')).toEqual({ kind: 'render', path: '/evil.com/x' });
  });

  it('never negotiates when negotiation is off, but still marks the page', () => {
    expect(decide('/about', { accept: 'text/markdown' }, false)).toEqual({ kind: 'html', path: '/about', negotiated: false });
  });

  it('skips files, reserved paths, well-known URIs, JSON clients and its own internal fetch', () => {
    expect(decide('/robots.txt')).toEqual({ kind: 'skip' });
    expect(decide('/api/cart')).toEqual({ kind: 'skip' });
    expect(decide('/__sitemap__/pages-de.xml')).toEqual({ kind: 'skip' });
    expect(decide('/.well-known/api-catalog')).toEqual({ kind: 'skip' });
    expect(decide('/about', { accept: 'application/json' })).toEqual({ kind: 'skip' });
    expect(decide('/about.md', { [INTERNAL_HEADER]: '1' })).toEqual({ kind: 'skip' });
  });
});

describe('contentNegotiationFor', () => {
  it('turns negotiation off where a cache would not vary on it', () => {
    expect(contentNegotiationFor(true, {})).toBe(true);
    expect(contentNegotiationFor(false, {})).toBe(false);
    expect(contentNegotiationFor(true, { isr: 60 })).toBe(false);
    expect(contentNegotiationFor(true, { cache: { maxAge: 60 } })).toBe(false);
    expect(contentNegotiationFor(true, { cache: { varies: ['accept', 'sec-fetch-dest', 'user-agent'] } })).toBe(true);
  });

  it('only needs the cache to vary on Accept', () => {
    expect(contentNegotiationFor(true, { cache: { varies: ['Accept'] } })).toBe(true);
    expect(contentNegotiationFor(true, { cache: { varies: ['user-agent'] } })).toBe(false);
  });
});

describe('NEGOTIATION_VARY', () => {
  it('varies on Accept alone, so caches are not split per user agent', () => {
    expect(NEGOTIATION_VARY).toBe('Accept');
  });
});

describe('resolveMarkdownRedirect', () => {
  const pageUrl = 'https://shop.ch/about';

  it('follows a redirect that lands on the same Markdown twin', () => {
    expect(resolveMarkdownRedirect('/about/', { pageUrl, origins: [] })).toEqual({ kind: 'follow', path: '/about/' });
  });

  it('points the client at the twin of a different page', () => {
    expect(resolveMarkdownRedirect('/team', { pageUrl, origins: [] })).toEqual({ kind: 'redirect', location: '/team.md' });
    expect(resolveMarkdownRedirect('https://shop.ch/team?a=1', { pageUrl, origins: [] })).toEqual({
      kind: 'redirect',
      location: 'https://shop.ch/team.md?a=1',
    });
  });

  it('passes a foreign redirect through untouched', () => {
    expect(resolveMarkdownRedirect('https://other.example/x', { pageUrl, origins: [] })).toEqual({
      kind: 'redirect',
      location: 'https://other.example/x',
    });
  });
});
