import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

type Node = Record<string, unknown> & { '@type'?: string | string[] };

// Locks in the `autoWebSite: false` default. Projects that compose their own schema.org graph via
// `useSchemaOrg` rely on the module NOT shipping a competing WebSite/WebPage/Organization set, and
// in particular not the nuxt-schema-org default WebSite's self-referencing `workTranslation` list.
describe('schema.org with autoWebSite off (the default)', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)),
    nuxtConfig: {
      '@laioutr/app-essentials-seo': {
        structuredData: { organization: { legalName: 'Fixture GmbH' } },
      },
    } as never,
  });

  const htmlOn = (host: string) =>
    $fetch<string>('/', { headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

  const graphOf = (html: string) => {
    const match = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    return match ? (JSON.parse(match[1]!)['@graph'] as Node[]) : [];
  };

  const hasType = (graph: Node[], type: string) => graph.some((node) => [node['@type']].flat().includes(type));

  it('does not emit the auto WebSite, WebPage or Organization nodes', async () => {
    const graph = graphOf(await htmlOn('shop.ch'));
    expect(hasType(graph, 'WebSite')).toBe(false);
    expect(hasType(graph, 'WebPage')).toBe(false);
    expect(hasType(graph, 'Organization')).toBe(false);
  });

  it('does not emit the self-referencing `workTranslation` on any node', async () => {
    const html = await htmlOn('shop.ch');
    expect(html).not.toContain('workTranslation');
  });
});
