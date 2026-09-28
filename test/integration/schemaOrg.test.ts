import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

type Node = Record<string, unknown> & { '@type'?: string | string[] };

describe('schema.org graph', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)),
    nuxtConfig: {
      '@laioutr/app-essentials-seo': {
        structuredData: { organization: { legalName: 'Fixture GmbH', telephone: '+41 00 000 00 00' } },
      },
    } as never,
  });

  // See sitemap.test.ts for why the request host needs x-forwarded-host and -proto.
  const onHost = (path: string, host: string) =>
    $fetch<string>(path, { headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

  const scriptsOf = (html: string) =>
    [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]!);

  const graphOf = async (host: string, path = '/') => {
    const scripts = scriptsOf(await onHost(path, host));
    return { count: scripts.length, graph: scripts.length ? (JSON.parse(scripts[0]!)['@graph'] as Node[]) : [] };
  };

  const nodeOf = (graph: Node[], type: string) => graph.find((node) => [node['@type']].flat().includes(type));

  it('renders exactly one graph with WebSite, WebPage and the Organization', async () => {
    const { count, graph } = await graphOf('shop.ch');
    expect(count).toBe(1);
    expect(nodeOf(graph, 'WebSite')).toBeDefined();
    expect(nodeOf(graph, 'WebPage')).toBeDefined();
    expect(nodeOf(graph, 'Organization')).toMatchObject({ legalName: 'Fixture GmbH', telephone: '+41 00 000 00 00' });
  });

  it('names and addresses the organization per host', async () => {
    const ch = nodeOf((await graphOf('shop.ch')).graph, 'Organization');
    const de = nodeOf((await graphOf('shop.de')).graph, 'Organization');
    expect(ch).toMatchObject({ name: 'Switzerland', url: expect.stringMatching(/^https:\/\/shop\.ch\/?$/) });
    expect(de).toMatchObject({ name: 'Germany', url: expect.stringMatching(/^https:\/\/shop\.de\/?$/) });
  });

  it('names the website per host', async () => {
    expect(nodeOf((await graphOf('shop.de')).graph, 'WebSite')).toMatchObject({ name: 'Germany' });
  });

  it('names a host without a market entry after the first market, not after the package', async () => {
    const organization = nodeOf((await graphOf('unknown.example')).graph, 'Organization');
    expect(organization?.name).toBe('Switzerland');
  });
});
