# Structured Data (schema.org) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projects that install this module get one linked schema.org `@graph` on every page — `WebSite` and `WebPage` from `nuxt-schema-org`'s defaults, plus an optional `Organization` identity from a new `structuredData.organization` config block, named and addressed per host.

**Architecture:** The module installs `nuxt-schema-org` 5.0.5 after `@nuxtjs/sitemap` and `@nuxtjs/robots`, so it reads the per-host name and URL from the `nuxt-site-config` multi-tenancy this module already derives. A pure mapper turns the resolved `structuredData` options into `nuxt-schema-org` options. frontend-core's own schema.org registration detects the module's plugin and steps back, so ui-app's breadcrumb and FAQ nodes join the same graph.

**Tech Stack:** Nuxt 3.16.2, `nuxt-schema-org` 5.0.5 (`@unhead/schema-org` 2.0.x, `nuxt-site-config` ^3.1.9 — dedupes with the installed 3.2.21), zod v4, vitest 3, `@nuxt/test-utils/e2e`.

**Spec:** Section 3 of `docs/plans/2026-09-27-structured-data-design.md` in the laioutr monorepo (on `main`, and on PR #1007). Its `trailingSlash` item is already implemented here (`toUpstreamConfig` sets `site.trailingSlash` from `laioutrrc.config.trailingSlash`).

**Branch:** work directly on `main` (the user's decision). Do not push, tag, release or publish — ask the user first.

## Global Constraints

- `nuxt-schema-org` is pinned to exactly `5.0.5` (5.0.6 needs Nuxt 3.17.5; 5.0.7 and later need Nuxt 4).
- `defaults: true`: every page gets `WebSite` and `WebPage`.
- `structuredData.enabled: false` means `nuxt-schema-org` is not installed at all.
- Without `structuredData.organization` there is no `Organization` node.
- The identity's `name` and `url` fall back to each host's own site name and URL. An unconfigured field must never reach `nuxt-schema-org` as an explicit `undefined`, because it would overwrite that fallback.
- `organization.type` is `'Organization'` (default) or `'LocalBusiness'` — `nuxt-schema-org` derives a resolver from the type name, and only those two have resolvers among identity types relevant here. (Deviation from the spec's free-form `type`, which would break for names like `OnlineStore`.)
- No customer names in code, tests, README or commit messages — this package is public (`@laioutr/*`).
- Comments explain why, not what; no references to design docs or plans in code.
- Every Bash command runs with the sandbox disabled.
- Commit messages are conventional commits ending with `Claude-Session: https://claude.ai/code/session_01SoaZ27vog25dY6HRn5HRo9`. Do not edit `CHANGELOG.md` — `changelogen` writes it at release.

## Review Focus

1. **An `organization` block without `name`** (the common case: a project sets phone, e-mail and address only). Each host must keep its own name in the `Organization` and `WebSite` nodes. Pinned in Task 1 (mapper test: no `name` / `url` key) and Task 3 (e2e: `shop.ch` → "Switzerland", `shop.de` → "Germany").
2. **A request on a host that matches no market** (a preview or alias host). Without a base `site.name`, `nuxt-site-config` names the site after the fixture package — which then names the identity. Pinned in Task 2 (unit: base name is the first market's name) and Task 3 (e2e: unknown host).
3. **The base `site.name` from Task 2 overriding the per-host names.** It must not: `shop.de` still reads "Germany". Pinned in Task 3.
4. **Two graphs on one page** if frontend-core's own schema.org registration also ran. Pinned in Task 3 (exactly one `application/ld+json` script).
5. **`enabled: false`** must remove all schema.org output this module adds. Pinned in Task 3 (second e2e file).

---

### Task 1: `structuredData` options and the mapper to `nuxt-schema-org` options

**Files:**
- Modify: `src/types.ts` (add schemas above `ModuleOptionsSchema`; add the key to `ModuleOptionsSchema`)
- Create: `src/runtime/shared/toSchemaOrgConfig.ts`
- Test: `test/unit/toSchemaOrgConfig.test.ts`

**Interfaces:**
- Produces: `ResolvedOptions['structuredData']` = `{ enabled: boolean; organization?: { type: 'Organization' | 'LocalBusiness'; name?; legalName?; logo?; sameAs: string[]; email?; telephone?; address?: { streetAddress; postalCode; addressLocality; addressRegion?; addressCountry }; vatID? } }`; `toSchemaOrgConfig(structuredData): { enabled: boolean; defaults: true; identity?: Record<string, unknown> }`.

- [ ] **Step 1: Write the failing test**

`test/unit/toSchemaOrgConfig.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toSchemaOrgConfig } from '../../src/runtime/shared/toSchemaOrgConfig';
import { resolveOptions } from '../../src/types';

const build = (structuredData?: object) => toSchemaOrgConfig(resolveOptions({ structuredData }).structuredData);

describe('toSchemaOrgConfig', () => {
  it('keeps the WebSite and WebPage defaults and adds no identity without an organization', () => {
    expect(build()).toEqual({ enabled: true, defaults: true });
  });

  it('passes the enabled switch through', () => {
    expect(build({ enabled: false }).enabled).toBe(false);
  });

  it('leaves name and url out when they are not configured, so each host keeps its own', () => {
    const identity = build({ organization: { telephone: '+49 30 0000000' } }).identity;
    expect(identity).toEqual({ type: 'Organization', telephone: '+49 30 0000000' });
    expect(identity).not.toHaveProperty('name');
    expect(identity).not.toHaveProperty('url');
  });

  it('passes every configured field', () => {
    const address = { streetAddress: 'Musterstraße 1', postalCode: '10115', addressLocality: 'Berlin', addressCountry: 'DE' };
    expect(
      build({
        organization: {
          type: 'LocalBusiness',
          name: 'Acme',
          legalName: 'Acme GmbH',
          logo: '/logo.png',
          sameAs: ['https://social.example/acme'],
          email: 'info@example.com',
          telephone: '+49 30 0000000',
          address,
          vatID: 'DE000000000',
        },
      }).identity
    ).toEqual({
      type: 'LocalBusiness',
      name: 'Acme',
      legalName: 'Acme GmbH',
      logo: '/logo.png',
      sameAs: ['https://social.example/acme'],
      email: 'info@example.com',
      telephone: '+49 30 0000000',
      address,
      vatID: 'DE000000000',
    });
  });

  it('drops an empty sameAs list', () => {
    expect(build({ organization: { legalName: 'Acme GmbH' } }).identity).not.toHaveProperty('sameAs');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/sl/src/app-essentials-seo
pnpm vitest run test/unit/toSchemaOrgConfig.test.ts
```

Expected: FAIL — cannot resolve `../../src/runtime/shared/toSchemaOrgConfig`.

- [ ] **Step 3: Add the options schema**

In `src/types.ts`, above `export const ModuleOptionsSchema`:

```ts
const PostalAddressSchema = z.object({
  streetAddress: z.string(),
  postalCode: z.string(),
  addressLocality: z.string(),
  addressRegion: z.string().optional(),
  addressCountry: z.string(),
});

const OrganizationSchema = z.object({
  /** nuxt-schema-org derives the node's resolver from this name, so only types it resolves are allowed. */
  type: z.enum(['Organization', 'LocalBusiness']).default('Organization'),
  /** Leave unset to name the organization after each host's own site name. */
  name: z.string().optional(),
  legalName: z.string().optional(),
  /** A path or an absolute URL. */
  logo: z.string().optional(),
  sameAs: z.array(z.string()).default([]),
  email: z.string().optional(),
  telephone: z.string().optional(),
  address: PostalAddressSchema.optional(),
  vatID: z.string().optional(),
});

export const StructuredDataOptionsSchema = z.object({
  /** Off installs no schema.org module at all. */
  enabled: z.boolean().default(true),
  /** Without it there is no Organization node; WebSite and WebPage are still emitted. */
  organization: OrganizationSchema.optional(),
});
```

Add to `ModuleOptionsSchema`, after `aiReady`:

```ts
  structuredData: StructuredDataOptionsSchema.prefault({}),
```

- [ ] **Step 4: Write the mapper**

`src/runtime/shared/toSchemaOrgConfig.ts` (import `ResolvedOptions` the same way `toUpstreamConfig.ts` in this folder imports option types; adapt the relative path if it differs):

```ts
import type { ResolvedOptions } from '../../types';

type StructuredData = ResolvedOptions['structuredData'];
type Organization = NonNullable<StructuredData['organization']>;

/** The nuxt-schema-org module options for this module's `structuredData` options. */
export const toSchemaOrgConfig = (structuredData: StructuredData) => ({
  enabled: structuredData.enabled,
  defaults: true as const,
  ...(structuredData.organization && { identity: toIdentity(structuredData.organization) }),
});

// nuxt-schema-org spreads the identity over the host's own name and URL, so an explicit
// `undefined` would erase them. Only configured fields are passed.
const toIdentity = ({ sameAs, ...organization }: Organization): Record<string, unknown> => ({
  ...Object.fromEntries(Object.entries(organization).filter(([, value]) => value !== undefined)),
  ...(sameAs.length > 0 && { sameAs }),
});
```

- [ ] **Step 5: Run the test to verify it passes, then the unit suite**

```bash
pnpm vitest run test/unit/toSchemaOrgConfig.test.ts
pnpm vitest run test/unit
```

Expected: 5 new tests PASS; the unit suite stays green.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/runtime/shared/toSchemaOrgConfig.ts test/unit/toSchemaOrgConfig.test.ts
git commit -m "$(printf 'feat: configure the schema.org identity under structuredData\n\nClaude-Session: https://claude.ai/code/session_01SoaZ27vog25dY6HRn5HRo9')"
```

---

### Task 2: A base site name for hosts that match no market

**Files:**
- Modify: `src/runtime/shared/toUpstreamConfig.ts` (the `if (options.siteName) site.name = options.siteName;` line)
- Test: `test/unit/toUpstreamConfig.test.ts` (the `siteNameByHost` describe block, which already has a `build` helper)

**Interfaces:**
- Produces: `toUpstreamConfig(...).site.name` = `options.siteName ?? <first market's name>` (absent only when there is no market at all).

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `test/unit/toUpstreamConfig.test.ts`, after the `siteNameByHost` block, using the file's existing `build` helper:

```ts
describe('toUpstreamConfig — base site name', () => {
  it('names a host without a market entry after the first market, not after the package', () => {
    expect(build().site.name).toBe('Switzerland');
  });

  it('uses the explicit site name when the project set one', () => {
    expect(build({ siteName: 'Karls Shop' }).site.name).toBe('Karls Shop');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run test/unit/toUpstreamConfig.test.ts
```

Expected: the first new test FAILS (`site.name` is `undefined`).

- [ ] **Step 3: Implement**

In `toUpstreamConfig.ts`, replace `if (options.siteName) site.name = options.siteName;` with:

```ts
  // A host that matches no multiTenancy entry — a preview or alias host — would otherwise fall back
  // to the package name, which then names the schema.org identity.
  const baseName = options.siteName ?? markets[0]?.name;
  if (baseName) site.name = baseName;
```

(`markets` is the list the function already iterates to build `domainsByHost`; use that same variable.)

- [ ] **Step 4: Run the file, then the unit suite**

```bash
pnpm vitest run test/unit/toUpstreamConfig.test.ts
pnpm vitest run test/unit
```

Expected: PASS. If an existing assertion compares the whole `site` object and now sees `name`, update that expectation to include `name: 'Switzerland'` — do not weaken it.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/shared/toUpstreamConfig.ts test/unit/toUpstreamConfig.test.ts
git commit -m "$(printf 'fix: name hosts without a market entry after the first market\n\nClaude-Session: https://claude.ai/code/session_01SoaZ27vog25dY6HRn5HRo9')"
```

---

### Task 3: Install `nuxt-schema-org` and verify the graph end to end

**Files:**
- Modify: `package.json` (dependency), `pnpm-lock.yaml`
- Modify: `src/module.ts` (after `await installModule('@nuxtjs/robots');`)
- Create: `test/integration/schemaOrg.test.ts`
- Create: `test/integration/schemaOrgDisabled.test.ts`

**Interfaces:**
- Consumes: `toSchemaOrgConfig` (Task 1), `site.name` base (Task 2).

- [ ] **Step 1: Add the dependency**

```bash
cd /Users/sl/src/app-essentials-seo
pnpm add nuxt-schema-org@5.0.5 --save-exact
grep -oE "^  nuxt-site-config@[0-9.]+" pnpm-lock.yaml | sort -u
```

Expected: `package.json` lists `"nuxt-schema-org": "5.0.5"`; the lockfile still resolves a single `nuxt-site-config` version. If a second `nuxt-site-config` version appears, stop and report it — the per-host identity depends on one shared site config.

Record the typecheck baseline now, before any code change in this task:

```bash
pnpm test:types > $TMPDIR/types-baseline.txt 2>&1; echo "exit $?"
```

- [ ] **Step 2: Write the failing e2e tests**

`test/integration/schemaOrg.test.ts`:

```ts
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
```

`test/integration/schemaOrgDisabled.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('schema.org switched off', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)),
    nuxtConfig: { '@laioutr/app-essentials-seo': { structuredData: { enabled: false } } } as never,
  });

  it('adds no JSON-LD to the page', async () => {
    const html = await $fetch<string>('/', {
      headers: { host: 'shop.ch', 'x-forwarded-host': 'shop.ch', 'x-forwarded-proto': 'https' },
    });
    expect(html).toContain('seo fixture'); // guard: an error page would also contain no JSON-LD
    expect(html).not.toContain('application/ld+json');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

```bash
pnpm vitest run test/integration/schemaOrg.test.ts
```

Expected: FAIL — no `application/ld+json` script (`count` is 0).

If the `unknown.example` request fails with a non-200 (frontend-core may refuse a host with no market), keep that test out, and record the status code and the reason in the report; Task 2's unit test then carries Review Focus 2.

- [ ] **Step 4: Install the module**

In `src/module.ts`, import the mapper next to the other imports:

```ts
import { toSchemaOrgConfig } from './runtime/shared/toSchemaOrgConfig';
```

After `await installModule('@nuxtjs/robots');`:

```ts
    // After sitemap and robots: nuxt-schema-org names and addresses the identity from nuxt-site-config,
    // which those two install with the per-host config derived above.
    if (options.structuredData.enabled) {
      const nuxtOptions = nuxt.options as any;
      nuxtOptions.schemaOrg = defu(nuxtOptions.schemaOrg, toSchemaOrgConfig(options.structuredData));
      await installModule('nuxt-schema-org');
    }
```

- [ ] **Step 5: Run the e2e tests, then the whole suite**

```bash
pnpm vitest run test/integration/schemaOrg.test.ts test/integration/schemaOrgDisabled.test.ts
pnpm test
```

Expected: all PASS. If `shop.de` reads "Switzerland" (the base name from Task 2 overriding the per-host name), stop and report it — do not remove Task 2's base name.

- [ ] **Step 6: Typecheck and lint**

```bash
pnpm test:types
pnpm lint
```

Expected: both pass. If `pnpm test:types` fails, compare with `$TMPDIR/types-baseline.txt` from Step 1: report the baseline and confirm that no new error is in a file this plan touched.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/module.ts test/integration/schemaOrg.test.ts test/integration/schemaOrgDisabled.test.ts
git commit -m "$(printf 'feat: emit a schema.org graph with a per-host identity through nuxt-schema-org\n\nEvery page now carries WebSite and WebPage JSON-LD. Set structuredData.enabled to false to turn it off.\n\nClaude-Session: https://claude.ai/code/session_01SoaZ27vog25dY6HRn5HRo9')"
```

---

### Task 4: Document the structured data

**Files:**
- Modify: `README.md` (a new `### Structured data` section after the Open Graph section)

- [ ] **Step 1: Write the section**

Insert after the Open Graph section:

````markdown
### Structured data

Every page gets a schema.org `@graph` with a `WebSite` and a `WebPage` node, via
[`nuxt-schema-org`](https://nuxtseo.com/docs/schema-org). Both are named and addressed per host:
each host uses its market's name (or `siteName`) and its own URL.

Configure the organization behind the site under `structuredData.organization`:

```json
{
  "structuredData": {
    "organization": {
      "legalName": "Example GmbH",
      "logo": "/logo.png",
      "email": "info@example.com",
      "telephone": "+49 30 0000000",
      "address": {
        "streetAddress": "Musterstraße 1",
        "postalCode": "10115",
        "addressLocality": "Berlin",
        "addressCountry": "DE"
      },
      "sameAs": ["https://social.example/example"],
      "vatID": "DE000000000"
    }
  }
}
```

| Field | Notes |
| --- | --- |
| `type` | `Organization` (default) or `LocalBusiness`. |
| `name` | Leave it out to use each host's own site name. |
| `logo` | A path or an absolute URL. Google asks for at least 112×112 pixels. |
| everything else | Passed through as schema.org properties of the same name. |

Without `organization`, the graph has no `Organization` node. `structuredData.enabled: false` removes
the graph entirely.

Sections that emit their own structured data — the breadcrumbs, and an accordion set to FAQ in
`@laioutr-app/ui` — add their nodes to the same graph (with `@laioutr-core/frontend-core` 0.62.0 or
later).

Only the server-rendered HTML carries the graph; it is not updated on client-side navigation.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(printf 'docs: describe the structured data and the organization config\n\nClaude-Session: https://claude.ai/code/session_01SoaZ27vog25dY6HRn5HRo9')"
```

Then report to the user: all four commits are on local `main`, not pushed. Releasing (`pnpm release`) pushes, tags and publishes — that is the user's call.
