# Sitemap & robots.txt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `my-laioutr-app` template into `@laioutr/app-essentials-seo`, serving a per-host `sitemap_index.xml` + child sitemaps built from laioutr's configured pages and page-index, plus a per-host `robots.txt`.

**Architecture:** A Nuxt module that derives `site` / `sitemap` / `robots` config from `laioutrrc` and installs `@nuxtjs/sitemap` + `@nuxtjs/robots` itself. At request time one nitro plugin answers the sitemap module's `sitemap:sources` hook with URLs read from a host-keyed snapshot cache; the snapshot is accumulated in bounded passes via orchestr's `listPagesFrom`, so no single request walks a whole catalogue.

**Tech Stack:** Nuxt 3.16.2, `@nuxt/kit`, `@nuxtjs/sitemap` v7, `@nuxtjs/robots` 5.5.6, `nuxt-site-config` 3.2.2 (transitive), `@laioutr-core/orchestr` 0.38.1, zod 3.25.61, vitest 3.1.1, `@nuxt/test-utils` 3.19.1.

**Design doc:** `docs/plans/2026-07-30-sitemap-design.md`. Read it before starting. Do **not** cite it from code — see Global Constraints.

## Global Constraints

- **Node** `>=22.12.0`, **pnpm** `>=10.15.0`.
- **TypeScript stays on 5.x** (currently `5.9.2`). A bare `pnpm add -D typescript` resolves to 7.x, whose module layout breaks `nuxt-module-build@1.0.1`. Never upgrade it in this plan.
- **Package name and config key are the same string:** `@laioutr/app-essentials-seo`. Cockpit only permits app config under the key matching the package name.
- **Never set `site.url`.** `nuxt-site-config`'s `nitro:init` layer derives it per request from the request host; an explicit value sits at higher priority and would pin every market to one origin.
- **Never `JSON.stringify` a `ClientEnv`.** `market`/`language`/`domain` are cyclic (`RenderMarketDomain.language` ↔ `RenderLanguage.marketDomains`) and it throws.
- **Root-path exception is limited to exactly three patterns:** `/robots.txt`, `/sitemap_index.xml`, `/__sitemap__/*`. Every other path this app owns goes under `/app-essentials-seo/`.
- **Never reference design docs, plans, or `§` sections from code**, comments, JSDoc, test names or error messages. State the reason inline in the code's own words.
- **zod composition uses `z.object({ ...base.shape, … })`**, never `base.extend({ … })`.
- **Commit at the end of every task**, using the exact command given. Do not create or switch branches.

---

## File Structure

```
src/
  module.ts                      MODIFY  fan-out + installModule; the only build-time entry
  types.ts                       CREATE  ModuleOptions, defaults, zod schema
  globalExtensions.ts            MODIFY  runtime-config augmentation under the new key
  runtime/
    shared/                              pure leaf code — imported by BOTH module.ts and nitro
      path.ts                    CREATE  fillParams, composePath, unlocalize
      sitemapName.ts             CREATE  typeSlug, buildSitemapName, parseSitemapName
      pageSelection.ts           CREATE  isDynamicPath, defaultVariant, isNoindexRobots
      toUpstreamConfig.ts        CREATE  laioutrrc + options → { site, sitemap, robots }
    server/
      lib/
        hostContext.ts           CREATE  request host → { market, domain, clientEnv }
        alternates.ts            CREATE  cross-host hreflang for configured pages
        configuredPageUrls.ts    CREATE  laioutrrc pages → SitemapUrl[]
        pageIndexUrls.ts         CREATE  PageIndexEntry[] → SitemapUrl[]
        snapshotStore.ts         CREATE  live/pending keys, TTL stamps, swap
        rebuild.ts               CREATE  one bounded listPagesFrom pass
      nitro/
        sitemap.ts               CREATE  sitemap:sources, :index-resolved, :output
    types/
      hooks.d.ts                 CREATE  essentials-seo:sitemap-source:resolve
test/
  unit/*.test.ts                 CREATE  one file per src/runtime/{shared,server/lib} module
  fixtures/seo/                  CREATE  Nuxt fixture: 2 markets, 3 domains, fake pageIndex
  integration/sitemap.test.ts    CREATE  HTTP assertions against the fixture
```

`src/runtime/shared/` is pure — no `#imports`, no `@nuxt/kit`, no h3 — so `module.ts` can import it at build time and nitro can import it at request time. Anything touching `#imports` lives under `src/runtime/server/`.

---

### Task 1: Package identity, dependencies, config surface

**Files:**
- Modify: `package.json`
- Modify: `src/globalExtensions.ts`
- Create: `src/types.ts`
- Test: `test/unit/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ModuleOptions`, `ModuleOptionsSchema`, `resolveOptions(input: unknown): ResolvedOptions`, `MODULE_NAME = '@laioutr/app-essentials-seo'`. `ResolvedOptions` is `ModuleOptions` with every optional field filled — later tasks index into it without guards.

- [ ] **Step 1: Rename the package and add dependencies**

In `package.json` set `"name": "@laioutr/app-essentials-seo"`, `"description": "SEO essentials for Laioutr frontends — sitemap.xml and robots.txt"`, `"repository": "laioutr/app-essentials-seo"`.

Then install (do **not** touch the `typescript` pin):

```bash
pnpm add @nuxtjs/sitemap@^7 @nuxtjs/robots@^5.5.6
pnpm add -D @laioutr-core/orchestr@^0.38.1
```

Add to `peerDependencies` in `package.json`:

```json
"@laioutr-core/orchestr": ">=0.38.1"
```

- [ ] **Step 2: Record the resolved `@nuxtjs/sitemap` version and confirm its hook names**

```bash
node -p "require('./node_modules/@nuxtjs/sitemap/package.json').version"
grep -rho "sitemap:[a-z-]*" node_modules/@nuxtjs/sitemap/dist/runtime | sort -u
```

Expected: the grep lists `sitemap:index-resolved`, `sitemap:input`, `sitemap:output`, `sitemap:resolved`, `sitemap:sources`. If any is missing or renamed, **stop and report** — Tasks 11 and 12 depend on these exact names.

- [ ] **Step 3: Write the failing test**

Create `test/unit/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MODULE_NAME, resolveOptions } from '../../src/types';

describe('resolveOptions', () => {
  it('exposes the package name as the config key', () => {
    expect(MODULE_NAME).toBe('@laioutr/app-essentials-seo');
  });

  it('fills every default so consumers need no guards', () => {
    const resolved = resolveOptions(undefined);
    expect(resolved.indexable).toBe('auto');
    expect(resolved.sitemap.enabled).toBe(true);
    expect(resolved.sitemap.excludePageTypes).toEqual([]);
    expect(resolved.sitemap.rebuildBatchSize).toBe(10_000);
    expect(resolved.sitemap.includeImages).toBe(true);
    expect(resolved.robots.enabled).toBe(true);
    expect(resolved.robots.extraDisallow).toEqual([]);
  });

  it('keeps caller values and still fills the rest', () => {
    const resolved = resolveOptions({ sitemap: { rebuildBatchSize: 500 } });
    expect(resolved.sitemap.rebuildBatchSize).toBe(500);
    expect(resolved.sitemap.enabled).toBe(true);
  });

  it('rejects a rebuildBatchSize below 1', () => {
    expect(() => resolveOptions({ sitemap: { rebuildBatchSize: 0 } })).toThrow();
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `pnpm vitest run test/unit/types.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/types"`.

- [ ] **Step 5: Write `src/types.ts`**

```ts
import { z } from 'zod';

/** Package name and Nuxt config key. Cockpit only permits app config under the package name. */
export const MODULE_NAME = '@laioutr/app-essentials-seo';

const PageTypeSeoSchema = z.object({
  pageType: z.string(),
  priority: z.number().min(0).max(1).optional(),
  changefreq: z.enum(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']).optional(),
  include: z.boolean().optional(),
});

const RobotsGroupSchema = z.object({
  userAgent: z.array(z.string()).default(['*']),
  allow: z.array(z.string()).default([]),
  disallow: z.array(z.string()).default([]),
});

const SitemapOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  excludePageTypes: z.array(z.string()).default([]),
  pageTypes: z.array(PageTypeSeoSchema).default([]),
  defaultChangefreq: PageTypeSeoSchema.shape.changefreq,
  defaultPriority: z.number().min(0).max(1).optional(),
  includeImages: z.boolean().default(true),
  /** Entries pulled per snapshot rebuild pass. Bounds the work one request can do. */
  rebuildBatchSize: z.number().int().min(1).default(10_000),
});

const RobotsOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  blockAiBots: z.boolean().default(false),
  blockNonSeoBots: z.boolean().default(false),
  extraDisallow: z.array(z.string()).default([]),
  customGroups: z.array(RobotsGroupSchema).default([]),
});

export const ModuleOptionsSchema = z.object({
  siteName: z.string().optional(),
  indexable: z.enum(['auto', 'always', 'never']).default('auto'),
  environment: z.enum(['production', 'staging', 'preview', 'development']).optional(),
  sitemap: SitemapOptionsSchema.default({}),
  robots: RobotsOptionsSchema.default({}),
});

export type ModuleOptions = z.input<typeof ModuleOptionsSchema>;
export type ResolvedOptions = z.output<typeof ModuleOptionsSchema>;

/** Parses and fills defaults. Throws on invalid input so a bad Cockpit value fails the build loudly. */
export const resolveOptions = (input: unknown): ResolvedOptions => ModuleOptionsSchema.parse(input ?? {});
```

- [ ] **Step 6: Rewrite `src/globalExtensions.ts`**

```ts
/* eslint-disable @typescript-eslint/no-empty-object-type */
import type { ResolvedOptions } from './types';

declare module '@nuxt/schema' {
  interface PublicRuntimeConfig {
    ['@laioutr/app-essentials-seo']: {
      sitemap: ResolvedOptions['sitemap'];
    };
  }
  interface RuntimeConfig {
    ['@laioutr/app-essentials-seo']: ResolvedOptions;
  }
}

export {};
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `pnpm vitest run test/unit/types.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/types.ts src/globalExtensions.ts test/unit/types.test.ts
git commit -m "feat: rename to @laioutr/app-essentials-seo and add config surface"
```

---

### Task 2: Pure path helpers

These are reimplementations of frontend-core internals that are not exported. The tests are ported from frontend-core's own suites so drift shows up as a failure.

**Files:**
- Create: `src/runtime/shared/path.ts`
- Test: `test/unit/path.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `fillParams(path: string, params: Record<string, string | string[]>): string`
  - `composePath(prefix: string, path: string, trailingSlash: boolean): string`
  - `unlocalize<T>(value: T | Record<string, T>, localeChain: string[]): T | undefined`
  - `hasUnfilledParams(path: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/unit/path.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { composePath, fillParams, hasUnfilledParams, unlocalize } from '../../src/runtime/shared/path';

describe('fillParams', () => {
  it('substitutes a simple param', () => {
    expect(fillParams('/products/:slug', { slug: 'shoe' })).toBe('/products/shoe');
  });

  it('joins a repeatable param with slashes and drops the modifier', () => {
    expect(fillParams('/products/:slug+', { slug: ['a', 'b'] })).toBe('/products/a/b');
  });

  it('uses the first option of a finite set when no value is given', () => {
    expect(fillParams('/:param0(foo|bar)', {})).toBe('/foo');
  });

  it('substitutes empty string for a missing param', () => {
    expect(fillParams('/products/:slug', {})).toBe('/products/');
  });
});

describe('hasUnfilledParams', () => {
  it('detects a leftover placeholder', () => {
    expect(hasUnfilledParams('/products/:slug')).toBe(true);
  });

  it('detects an empty segment left by a missing param', () => {
    expect(hasUnfilledParams('/products//')).toBe(true);
    expect(hasUnfilledParams('/products/')).toBe(false);
  });

  it('accepts a fully filled path', () => {
    expect(hasUnfilledParams('/products/shoe')).toBe(false);
  });
});

describe('composePath', () => {
  it('joins a prefix and a path', () => {
    expect(composePath('/fr', '/produits', false)).toBe('/fr/produits');
  });

  it('treats an empty prefix as root', () => {
    expect(composePath('', '/produits', false)).toBe('/produits');
  });

  it('appends a trailing slash when asked', () => {
    expect(composePath('/fr', '/produits', true)).toBe('/fr/produits/');
  });

  it('never doubles a slash at the seam', () => {
    expect(composePath('/fr/', '/produits', false)).toBe('/fr/produits');
  });

  it('keeps root as a single slash in both modes', () => {
    expect(composePath('', '/', false)).toBe('/');
    expect(composePath('', '/', true)).toBe('/');
  });
});

describe('unlocalize', () => {
  it('returns a plain value unchanged', () => {
    expect(unlocalize('/about', ['de', 'en'])).toBe('/about');
  });

  it('picks the first locale in the chain that has a value', () => {
    expect(unlocalize({ en: '/about', de: '/ueber-uns' }, ['de', 'en'])).toBe('/ueber-uns');
  });

  it('falls back down the chain', () => {
    expect(unlocalize({ en: '/about' }, ['de', 'en'])).toBe('/about');
  });

  it('returns undefined when no locale in the chain matches', () => {
    expect(unlocalize({ fr: '/a-propos' }, ['de', 'en'])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run test/unit/path.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/runtime/shared/path.ts`**

```ts
const FINITE_SET_RE = /^\w+(?:\|\w+)+$/;

/**
 * Fills path params like `/:id` from `params`. A finite-set param with no value takes the set's
 * first option, so `/:param0(foo|bar)` yields `/foo`. A missing value yields an empty string —
 * callers must reject the result with `hasUnfilledParams`.
 */
export const fillParams = (path: string, params: Record<string, string | string[]>): string =>
  path.replace(/:(\w+)(?:\(([^)]*)\))?[+*?]?/g, (_, key: string, constraint: string | undefined) => {
    const value = params[key];
    if (value !== undefined) return Array.isArray(value) ? value.join('/') : value;
    if (constraint && FINITE_SET_RE.test(constraint)) return constraint.split('|')[0];
    return '';
  });

/**
 * True when a filled path is not a usable URL — either a placeholder survived, or a missing param
 * collapsed a segment to nothing (`/products//`). A single trailing slash is fine.
 */
export const hasUnfilledParams = (path: string): boolean => path.includes(':') || path.slice(0, -1).includes('//');

/** Joins a domain path prefix and a page path, applying the project's trailing-slash policy. */
export const composePath = (prefix: string, path: string, trailingSlash: boolean): string => {
  const joined = `${prefix.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  const normalized = joined.replace(/\/{2,}/g, '/');
  if (normalized === '/') return '/';
  return trailingSlash ? `${normalized.replace(/\/$/, '')}/` : normalized.replace(/\/$/, '');
};

/**
 * Resolves a possibly-localized value against a locale chain. A plain value is already resolved;
 * a map is probed in chain order. Undefined means the value does not exist for this chain, which
 * callers treat as "this page has no route here" rather than substituting a default.
 */
export const unlocalize = <T>(value: T | Record<string, T>, localeChain: string[]): T | undefined => {
  if (value === null || typeof value !== 'object') return value as T;
  const map = value as Record<string, T>;
  for (const locale of localeChain) {
    if (Object.hasOwn(map, locale) && map[locale] !== undefined && map[locale] !== '') return map[locale];
  }
  return undefined;
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run test/unit/path.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/shared/path.ts test/unit/path.test.ts
git commit -m "feat: add pure path helpers for sitemap URL composition"
```

---

### Task 3: Sitemap name slugging and parsing

**Files:**
- Create: `src/runtime/shared/sitemapName.ts`
- Test: `test/unit/sitemapName.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CONFIGURED_PAGES_TOKEN = '__pages__'` — the sentinel used where a page-type token would go for the configured-pages source.
  - `buildSitemapName(token: string, locale: string): string`
  - `parseSitemapName(name: string): { token: string | null; locale: string } | null` — `token: null` means the configured-pages source; `null` overall means the name is not ours.

- [ ] **Step 1: Write the failing test**

Create `test/unit/sitemapName.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIGURED_PAGES_TOKEN, buildSitemapName, parseSitemapName } from '../../src/runtime/shared/sitemapName';

describe('buildSitemapName', () => {
  it('flattens the namespace separator', () => {
    expect(buildSitemapName('ecommerce/product-detail-page', 'de')).toBe('ecommerce-product-detail-page-de');
  });

  it('keeps namespaces distinct so same-named types cannot collide', () => {
    expect(buildSitemapName('ecommerce/category', 'de')).not.toBe(buildSitemapName('cms/category', 'de'));
  });

  it('names the configured-pages source', () => {
    expect(buildSitemapName(CONFIGURED_PAGES_TOKEN, 'de')).toBe('pages-de');
  });

  it('handles a locale with a region subtag', () => {
    expect(buildSitemapName('blog/post-single', 'de-CH')).toBe('blog-post-single-de-CH');
  });
});

describe('parseSitemapName', () => {
  it('round-trips a page type', () => {
    expect(parseSitemapName('ecommerce-product-detail-page-de')).toEqual({
      token: 'ecommerce/product-detail-page',
      locale: 'de',
    });
  });

  it('round-trips the configured-pages source', () => {
    expect(parseSitemapName('pages-de')).toEqual({ token: null, locale: 'de' });
  });

  it('round-trips a region-subtag locale', () => {
    expect(parseSitemapName('blog-post-single-de-CH')).toEqual({ token: 'blog/post-single', locale: 'de-CH' });
  });

  it('strips the chunk suffix the sitemap module appends', () => {
    expect(parseSitemapName('ecommerce-product-detail-page-de-0')).toEqual({
      token: 'ecommerce/product-detail-page',
      locale: 'de',
    });
    expect(parseSitemapName('pages-de-CH-12')).toEqual({ token: null, locale: 'de-CH' });
  });

  it('returns null for a name this app does not own', () => {
    expect(parseSitemapName('some-other-sitemap')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run test/unit/sitemapName.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/runtime/shared/sitemapName.ts`**

The round-trip cannot be recovered by string splitting alone — `ecommerce-product-detail-page-de` gives no way to know where the token ends. So names are registered as they are built, and parsing is a lookup. `buildSitemapName` is called at build time for every (type, locale) pair, and the nitro plugin rebuilds the same registry from runtime config, so both sides agree by construction.

```ts
/** Stands in for a page-type token on the source that carries laioutrrc's configured pages. */
export const CONFIGURED_PAGES_TOKEN = '__pages__';

const registry = new Map<string, { token: string | null; locale: string }>();

/** Slug for one source. Registers the mapping so `parseSitemapName` can invert it. */
export const buildSitemapName = (token: string, locale: string): string => {
  const prefix = token === CONFIGURED_PAGES_TOKEN ? 'pages' : token.replaceAll('/', '-');
  const name = `${prefix}-${locale}`;
  registry.set(name, { token: token === CONFIGURED_PAGES_TOKEN ? null : token, locale });
  return name;
};

/**
 * Inverts `buildSitemapName`. Tolerates the numeric chunk suffix the sitemap module appends when a
 * source is split, so `<name>-0` resolves to the same source as `<name>`. Returns null for any name
 * this app did not register.
 */
export const parseSitemapName = (name: string): { token: string | null; locale: string } | null => {
  const direct = registry.get(name);
  if (direct) return direct;
  const withoutChunk = name.replace(/-\d+$/, '');
  return registry.get(withoutChunk) ?? null;
};

/** Drops every registration. Test-only — production builds register once and never clear. */
export const __resetSitemapNames = (): void => registry.clear();
```

- [ ] **Step 4: Add the registration precondition to the test**

Because parsing is a lookup, the test must build the names first. Prepend to `test/unit/sitemapName.test.ts`:

```ts
import { beforeAll } from 'vitest';

beforeAll(() => {
  buildSitemapName('ecommerce/product-detail-page', 'de');
  buildSitemapName('ecommerce/category', 'de');
  buildSitemapName('cms/category', 'de');
  buildSitemapName('blog/post-single', 'de-CH');
  buildSitemapName(CONFIGURED_PAGES_TOKEN, 'de');
  buildSitemapName(CONFIGURED_PAGES_TOKEN, 'de-CH');
});
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm vitest run test/unit/sitemapName.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/shared/sitemapName.ts test/unit/sitemapName.test.ts
git commit -m "feat: add sitemap source name slugging and parsing"
```

---

### Task 4: Page selection predicates

**Files:**
- Create: `src/runtime/shared/pageSelection.ts`
- Test: `test/unit/pageSelection.test.ts`

**Interfaces:**
- Consumes: `unlocalize` from `src/runtime/shared/path`.
- Produces:
  - `isDynamicPath(path: string | Record<string, string>): boolean`
  - `defaultVariant(page: { variants: Record<string, { conditions?: unknown; seo: { robots?: string } }> })` → the variant an anonymous visitor gets
  - `isNoindexRobots(robots: string | undefined): boolean`
  - `isPageIncluded(page, opts: { marketId: string; excludePageTypes: string[] }): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/unit/pageSelection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultVariant, isDynamicPath, isNoindexRobots, isPageIncluded } from '../../src/runtime/shared/pageSelection';

const variant = (seo: { robots?: string }, conditions?: unknown) => ({ conditions, seo: { title: '', description: '', ...seo } });

describe('isDynamicPath', () => {
  it('detects params in a plain path', () => {
    expect(isDynamicPath('/products/:slug+')).toBe(true);
    expect(isDynamicPath('/pricing')).toBe(false);
  });

  it('detects params in any locale of a localized path', () => {
    expect(isDynamicPath({ de: '/produkte/:slug', en: '/products/:slug' })).toBe(true);
    expect(isDynamicPath({ de: '/preise', en: '/pricing' })).toBe(false);
  });
});

describe('defaultVariant', () => {
  it('picks the variant with no conditions', () => {
    const page = { variants: { a: variant({}, { rules: [] }), b: variant({ robots: 'noindex' }) } };
    expect(defaultVariant(page)?.seo.robots).toBe('noindex');
  });

  it('falls back to the first variant when every one is conditional', () => {
    const page = { variants: { a: variant({ robots: 'all' }, { rules: [] }), b: variant({}, { rules: [] }) } };
    expect(defaultVariant(page)?.seo.robots).toBe('all');
  });

  it('returns undefined when there are no variants', () => {
    expect(defaultVariant({ variants: {} })).toBeUndefined();
  });
});

describe('isNoindexRobots', () => {
  it('matches noindex in any casing or position', () => {
    expect(isNoindexRobots('noindex')).toBe(true);
    expect(isNoindexRobots('NoIndex, follow')).toBe(true);
    expect(isNoindexRobots('follow, noindex')).toBe(true);
  });

  it('does not match an unrelated directive', () => {
    expect(isNoindexRobots('index, follow')).toBe(false);
    expect(isNoindexRobots(undefined)).toBe(false);
  });

  it('does not match a substring of another token', () => {
    expect(isNoindexRobots('max-snippet:-1')).toBe(false);
  });
});

describe('isPageIncluded', () => {
  const base = { id: 'p1', type: 'core/landingpage', variants: { a: variant({}) } };

  it('includes a page with no market scoping', () => {
    expect(isPageIncluded(base, { marketId: 'm1', excludePageTypes: [] })).toBe(true);
  });

  it('excludes a page scoped to another market', () => {
    expect(isPageIncluded({ ...base, marketIds: ['m2'] }, { marketId: 'm1', excludePageTypes: [] })).toBe(false);
  });

  it('includes a page scoped to this market', () => {
    expect(isPageIncluded({ ...base, marketIds: ['m1'] }, { marketId: 'm1', excludePageTypes: [] })).toBe(true);
  });

  it('always excludes the catch-all 404 type', () => {
    expect(isPageIncluded({ ...base, type: 'core/404' }, { marketId: 'm1', excludePageTypes: [] })).toBe(false);
  });

  it('excludes a configured page type', () => {
    expect(isPageIncluded(base, { marketId: 'm1', excludePageTypes: ['core/landingpage'] })).toBe(false);
  });

  it('excludes a page whose default variant is noindex', () => {
    const page = { ...base, variants: { a: variant({ robots: 'noindex, follow' }) } };
    expect(isPageIncluded(page, { marketId: 'm1', excludePageTypes: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run test/unit/pageSelection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/runtime/shared/pageSelection.ts`**

```ts
/** The catch-all page type. It matches every unrouted URL and must never appear in a sitemap. */
const CATCH_ALL_TYPE = 'core/404';

export interface SelectablePageVariant {
  conditions?: unknown;
  seo: { robots?: string };
}

export interface SelectablePage {
  id: string;
  type: string;
  marketIds?: string[];
  variants: Record<string, SelectablePageVariant>;
}

/** True when any locale of the path carries a route param, which means it needs page-index to enumerate. */
export const isDynamicPath = (path: string | Record<string, string>): boolean =>
  typeof path === 'string' ? path.includes(':') : Object.values(path).some((value) => value.includes(':'));

/**
 * The variant an anonymous visitor renders: the first with no personalization conditions. When every
 * variant is conditional there is no unconditional answer, so the first is used rather than skipping
 * the page entirely.
 */
export const defaultVariant = <T extends { variants: Record<string, SelectablePageVariant> }>(
  page: T
): SelectablePageVariant | undefined => {
  const variants = Object.values(page.variants);
  return variants.find((variant) => variant.conditions === undefined) ?? variants[0];
};

/** True when a robots directive string contains a `noindex` token. Token-aware, so `max-snippet` cannot match. */
export const isNoindexRobots = (robots: string | undefined): boolean =>
  robots !== undefined &&
  robots
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .includes('noindex');

/** Whether a configured page belongs in this market's sitemap. */
export const isPageIncluded = (
  page: SelectablePage,
  options: { marketId: string; excludePageTypes: string[] }
): boolean => {
  if (page.type === CATCH_ALL_TYPE) return false;
  if (options.excludePageTypes.includes(page.type)) return false;
  if (page.marketIds?.length && !page.marketIds.includes(options.marketId)) return false;
  return !isNoindexRobots(defaultVariant(page)?.seo.robots);
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run test/unit/pageSelection.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/shared/pageSelection.ts test/unit/pageSelection.test.ts
git commit -m "feat: add page selection predicates for sitemap inclusion"
```

---

### Task 5: Upstream config derivation

**Files:**
- Create: `src/runtime/shared/toUpstreamConfig.ts`
- Test: `test/unit/toUpstreamConfig.test.ts`

**Interfaces:**
- Consumes: `ResolvedOptions` (Task 1), `buildSitemapName` / `CONFIGURED_PAGES_TOKEN` (Task 3), `isDynamicPath` (Task 4).
- Produces: `toUpstreamConfig(input: { laioutrrc: LaioutrRcLike; options: ResolvedOptions; env: NodeJS.ProcessEnv }): { site, sitemap, robots, sources }`, where `sources` is `Array<{ name: string; token: string | null; locale: string }>` — the same list the nitro plugin needs at runtime.

- [ ] **Step 1: Write the failing test**

Create `test/unit/toUpstreamConfig.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveOptions } from '../../src/types';
import { __resetSitemapNames } from '../../src/runtime/shared/sitemapName';
import { toUpstreamConfig } from '../../src/runtime/shared/toUpstreamConfig';

const laioutrrc = {
  config: { trailingSlash: false },
  languages: {
    lng_de: { id: 'lng_de', code: 'de', name: 'German', fallbacks: [] },
    lng_fr: { id: 'lng_fr', code: 'fr', name: 'French', fallbacks: [] },
  },
  markets: {
    mkt_ch: {
      id: 'mkt_ch',
      slug: 'switzerland',
      name: 'Switzerland',
      currency: 'CHF',
      regionCodes: ['CH'],
      defaultDomainId: 'dom_ch_de',
      domains: {
        dom_ch_de: { id: 'dom_ch_de', host: 'shop.ch', languageId: 'lng_de' },
        dom_ch_fr: { id: 'dom_ch_fr', host: 'shop.ch', path: '/fr', languageId: 'lng_fr' },
      },
      studio: {},
    },
    mkt_de: {
      id: 'mkt_de',
      slug: 'germany',
      name: 'Germany',
      currency: 'EUR',
      regionCodes: ['DE'],
      defaultDomainId: 'dom_de_de',
      domains: { dom_de_de: { id: 'dom_de_de', host: 'shop.de', languageId: 'lng_de' } },
      studio: {},
    },
  },
  pages: {
    p_home: { id: 'p_home', type: 'core/home', path: '/', variants: {}, createdAt: '', updatedAt: '' },
    p_pdp: {
      id: 'p_pdp',
      type: 'ecommerce/product-detail-page',
      path: { de: '/produkte/:slug+', fr: '/produits/:slug+' },
      variants: {},
      createdAt: '',
      updatedAt: '',
    },
    p_404: { id: 'p_404', type: 'core/404', path: '/:catchall*', variants: {}, createdAt: '', updatedAt: '' },
  },
  apps: [],
};

const build = (overrides = {}, env: NodeJS.ProcessEnv = {}) =>
  toUpstreamConfig({ laioutrrc: laioutrrc as never, options: resolveOptions(overrides), env });

beforeEach(() => __resetSitemapNames());

describe('toUpstreamConfig — site', () => {
  it('never sets site.url so nuxt-site-config derives it per request', () => {
    expect(build().site).not.toHaveProperty('url');
  });

  it('derives trailingSlash from laioutrrc rather than asking for it', () => {
    expect(build().site.trailingSlash).toBe(false);
  });

  it('builds one multiTenancy entry per domain, carrying host and devHost', () => {
    const hosts = build().site.multiTenancy.map((entry) => entry.hosts);
    expect(hosts).toHaveLength(3);
    expect(hosts.flat()).toContain('shop.ch');
    expect(hosts.flat()).toContain('shop.de');
  });

  it('resolves env from options first', () => {
    expect(build({ environment: 'staging' }, { VERCEL_ENV: 'production' }).site.env).toBe('staging');
  });

  it('falls back to NUXT_SITE_ENV, then VERCEL_ENV, then production', () => {
    expect(build({}, { NUXT_SITE_ENV: 'uat', VERCEL_ENV: 'production' }).site.env).toBe('uat');
    expect(build({}, { VERCEL_ENV: 'preview' }).site.env).toBe('preview');
    expect(build({}, {}).site.env).toBe('production');
  });

  it('leaves indexable unset on auto so env decides', () => {
    expect(build().site).not.toHaveProperty('indexable');
    expect(build({ indexable: 'never' }).site.indexable).toBe(false);
    expect(build({ indexable: 'always' }).site.indexable).toBe(true);
  });
});

describe('toUpstreamConfig — sources', () => {
  it('emits one configured-pages source per locale', () => {
    const names = build().sources.filter((s) => s.token === null).map((s) => s.name);
    expect(names.sort()).toEqual(['pages-de', 'pages-fr']);
  });

  it('emits one source per dynamic page type per locale', () => {
    const names = build()
      .sources.filter((s) => s.token === 'ecommerce/product-detail-page')
      .map((s) => s.name);
    expect(names.sort()).toEqual(['ecommerce-product-detail-page-de', 'ecommerce-product-detail-page-fr']);
  });

  it('never emits a source for the catch-all page type', () => {
    expect(build().sources.some((s) => s.token === 'core/404')).toBe(false);
  });

  it('omits an excluded page type entirely', () => {
    const sources = build({ sitemap: { excludePageTypes: ['ecommerce/product-detail-page'] } }).sources;
    expect(sources.some((s) => s.token === 'ecommerce/product-detail-page')).toBe(false);
  });

  it('registers every source name in the sitemap config with chunking on', () => {
    const config = build();
    for (const source of config.sources) {
      expect(config.sitemap.sitemaps[source.name]).toEqual({ chunks: true, chunkSize: 50_000, includeAppSources: false });
    }
  });

  it('excludes app sources so laioutr param templates never leak in', () => {
    expect(build().sitemap.excludeAppSources).toBe(true);
  });

  it('disables the module output cache because its key is not host-aware', () => {
    expect(build().sitemap.cacheMaxAgeSeconds).toBe(0);
  });
});

describe('toUpstreamConfig — robots', () => {
  it('points at a relative sitemap so each host resolves its own', () => {
    expect(build().robots.sitemap).toEqual(['/sitemap_index.xml']);
  });

  it('disallows laioutr internals and appends project rules', () => {
    expect(build({ robots: { extraDisallow: ['/secret'] } }).robots.disallow).toEqual([
      '/api/',
      '/_laioutr/',
      '/secret',
    ]);
  });

  it('leaves the robots meta tag to frontend-core', () => {
    expect(build().robots.metaTag).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run test/unit/toUpstreamConfig.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/runtime/shared/toUpstreamConfig.ts`**

```ts
import { CONFIGURED_PAGES_TOKEN, buildSitemapName } from './sitemapName';
import { isDynamicPath } from './pageSelection';
import type { ResolvedOptions } from '../../types';

/** Chunk size for a single child sitemap. The protocol caps a sitemap file at 50 000 URLs. */
const SITEMAP_CHUNK_SIZE = 50_000;

/** Paths that are never useful to a crawler. Kept independent of sitemap exclusions on purpose:
 *  Disallow stops crawling, which stops a `noindex` from ever being read. */
const INTERNAL_DISALLOW = ['/api/', '/_laioutr/'];

interface RcDomain {
  id: string;
  host: string;
  path?: string;
  languageId: string;
}

interface RcMarketLike {
  id: string;
  name: string;
  defaultDomainId?: string;
  domains: Record<string, RcDomain>;
}

interface RcPageLike {
  id: string;
  type: string;
  path: string | Record<string, string>;
}

export interface LaioutrRcLike {
  config?: { trailingSlash?: boolean };
  languages?: Record<string, { id: string; code: string }>;
  markets?: Record<string, RcMarketLike>;
  pages?: Record<string, RcPageLike>;
}

export interface SitemapSourceDescriptor {
  name: string;
  /** null on the configured-pages source. */
  token: string | null;
  locale: string;
}

/** Local mirror of frontend-core's devHost convention so a market resolves in local development. */
const toDevHost = (host: string): string => `${host.replaceAll('.', '-')}.local.laioutr.tech`;

const resolveEnv = (options: ResolvedOptions, env: NodeJS.ProcessEnv): string =>
  options.environment ?? env.NUXT_SITE_ENV ?? env.NUXT_PUBLIC_SITE_ENV ?? env.VERCEL_ENV ?? 'production';

export const toUpstreamConfig = (input: {
  laioutrrc: LaioutrRcLike;
  options: ResolvedOptions;
  env: NodeJS.ProcessEnv;
}) => {
  const { laioutrrc, options, env } = input;
  const languages = Object.values(laioutrrc.languages ?? {});
  const markets = Object.values(laioutrrc.markets ?? {});
  const pages = Object.values(laioutrrc.pages ?? {});
  const localeOf = (languageId: string) => languages.find((language) => language.id === languageId)?.code;

  const locales = [...new Set(languages.map((language) => language.code))];

  const dynamicTokens = [
    ...new Set(
      pages
        .filter((page) => isDynamicPath(page.path))
        .map((page) => page.type)
        .filter((type) => type !== 'core/404' && !options.sitemap.excludePageTypes.includes(type))
    ),
  ];

  const sources: SitemapSourceDescriptor[] = [
    ...locales.map((locale) => ({
      name: buildSitemapName(CONFIGURED_PAGES_TOKEN, locale),
      token: null,
      locale,
    })),
    ...dynamicTokens.flatMap((token) =>
      locales.map((locale) => ({ name: buildSitemapName(token, locale), token, locale }))
    ),
  ];

  const sitemaps = Object.fromEntries(
    sources.map((source) => [
      source.name,
      { chunks: true, chunkSize: SITEMAP_CHUNK_SIZE, includeAppSources: false },
    ])
  );

  const site: Record<string, unknown> = {
    env: resolveEnv(options, env),
    trailingSlash: laioutrrc.config?.trailingSlash ?? false,
    multiTenancy: markets.flatMap((market) =>
      Object.values(market.domains).map((domain) => ({
        hosts: [domain.host, toDevHost(domain.host)],
        config: {
          name: options.siteName ?? market.name,
          defaultLocale: localeOf(domain.languageId),
        },
      }))
    ),
  };
  if (options.siteName) site.name = options.siteName;
  // 'auto' leaves it unset so getSiteIndexable falls back to env === 'production'.
  if (options.indexable !== 'auto') site.indexable = options.indexable === 'always';

  return {
    site,
    sitemap: {
      enabled: options.sitemap.enabled,
      sitemaps,
      excludeAppSources: true,
      // Its key composition is undocumented and one build serves every market's host, so a
      // non-host-keyed entry could serve one host's URLs on another.
      cacheMaxAgeSeconds: 0,
      defaults: {
        ...(options.sitemap.defaultChangefreq ? { changefreq: options.sitemap.defaultChangefreq } : {}),
        ...(options.sitemap.defaultPriority !== undefined ? { priority: options.sitemap.defaultPriority } : {}),
      },
    },
    robots: {
      enabled: options.robots.enabled,
      sitemap: ['/sitemap_index.xml'],
      disallow: [...INTERNAL_DISALLOW, ...options.robots.extraDisallow],
      groups: options.robots.customGroups,
      blockAiBots: options.robots.blockAiBots,
      blockNonSeoBots: options.robots.blockNonSeoBots,
      // frontend-core's page renderer already writes this tag and force-overrides preview renders.
      metaTag: false,
    },
    sources,
  };
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run test/unit/toUpstreamConfig.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/shared/toUpstreamConfig.ts test/unit/toUpstreamConfig.test.ts
git commit -m "feat: derive site, sitemap and robots config from laioutrrc"
```

---

### Task 6: Module wiring

**Files:**
- Modify: `src/module.ts`
- Test: `test/unit/module.test.ts`

**Interfaces:**
- Consumes: `resolveOptions`, `MODULE_NAME` (Task 1); `toUpstreamConfig` (Task 5).
- Produces: `applyUpstreamConfig(nuxtOptions, derived)` — exported from `src/module.ts` so the precedence rule is testable without booting Nuxt.

- [ ] **Step 1: Write the failing test**

Create `test/unit/module.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { applyUpstreamConfig } from '../../src/module';

describe('applyUpstreamConfig', () => {
  it('lets app config beat a developer value, and both beat derived', () => {
    const nuxtOptions: any = { sitemap: { defaults: { priority: 0.1 } } };
    applyUpstreamConfig(
      nuxtOptions,
      { site: {}, sitemap: { defaults: { priority: 0.9 }, excludeAppSources: true }, robots: {} },
      { sitemap: { defaults: { priority: 0.5 } } }
    );
    expect(nuxtOptions.sitemap.defaults.priority).toBe(0.5);
    expect(nuxtOptions.sitemap.excludeAppSources).toBe(true);
  });

  it('concatenates array values rather than replacing them', () => {
    const nuxtOptions: any = {};
    applyUpstreamConfig(nuxtOptions, { site: {}, sitemap: {}, robots: { disallow: ['/api/'] } }, { robots: { disallow: ['/x'] } });
    expect(nuxtOptions.robots.disallow).toEqual(['/x', '/api/']);
  });

  it('warns when site.url is set and more than one host is configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const nuxtOptions: any = {};
    applyUpstreamConfig(
      nuxtOptions,
      { site: { multiTenancy: [{ hosts: ['a'] }, { hosts: ['b'] }] }, sitemap: {}, robots: {} },
      { site: { url: 'https://a' } }
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('site.url'));
    warn.mockRestore();
  });

  it('does not warn about site.url when only one host is configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const nuxtOptions: any = {};
    applyUpstreamConfig(nuxtOptions, { site: { multiTenancy: [{ hosts: ['a'] }] }, sitemap: {}, robots: {} }, { site: { url: 'https://a' } });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run test/unit/module.test.ts`
Expected: FAIL — `applyUpstreamConfig` is not exported.

- [ ] **Step 3: Rewrite `src/module.ts`**

```ts
import { addServerPlugin, createResolver, defineNuxtModule, installModule } from '@nuxt/kit';
import { defu } from 'defu';
import { registerLaioutrApp } from '@laioutr-core/kit';
import { MODULE_NAME, resolveOptions } from './types';
import { toUpstreamConfig } from './runtime/shared/toUpstreamConfig';
import type { ModuleOptions } from './types';
import { version } from '../package.json';

export type { ModuleOptions } from './types';

/**
 * Merges derived, developer and app config onto the upstream module keys. App config wins so a
 * Cockpit change always takes visible effect; a raw `nuxt.config` value stays available for anything
 * the curated schema does not expose. `defu` concatenates arrays, so disallow lists compose.
 */
export const applyUpstreamConfig = (
  nuxtOptions: Record<string, any>,
  derived: { site: any; sitemap: any; robots: any },
  appConfig: { site?: any; sitemap?: any; robots?: any }
): void => {
  const hostCount = (derived.site.multiTenancy ?? []).length;
  if (appConfig.site?.url && hostCount > 1) {
    console.warn(
      `[${MODULE_NAME}] site.url is set but ${hostCount} hosts are configured. ` +
        'Every market will emit URLs on that one origin; leave it unset so each request derives its own host.'
    );
  }
  nuxtOptions.site = defu(appConfig.site, nuxtOptions.site, derived.site);
  nuxtOptions.sitemap = defu(appConfig.sitemap, nuxtOptions.sitemap, derived.sitemap);
  nuxtOptions.robots = defu(appConfig.robots, nuxtOptions.robots, derived.robots);
};

export default defineNuxtModule<ModuleOptions>({
  meta: { name: MODULE_NAME, version, configKey: MODULE_NAME },
  defaults: {},
  async setup(rawOptions, nuxt) {
    const { resolve } = createResolver(import.meta.url);
    nuxt.options.build.transpile.push(resolve('./runtime'));

    const options = resolveOptions(rawOptions);
    const laioutrrc = (nuxt.options as any).laioutr?.laioutrrc ?? {};
    const derived = toUpstreamConfig({ laioutrrc, options, env: process.env });

    nuxt.options.runtimeConfig[MODULE_NAME] = defu(nuxt.options.runtimeConfig[MODULE_NAME] as any, {
      ...options,
      sources: derived.sources,
    });

    applyUpstreamConfig(nuxt.options as any, derived, rawOptions as any);

    await registerLaioutrApp({ name: MODULE_NAME, version });

    addServerPlugin(resolve('./runtime/server/nitro/sitemap'));

    // Installed here, after the fan-out, so build-time options are reachable. frontend-core installs
    // @nuxtjs/robots today; when that install is removed this stays the only one.
    await installModule('@nuxtjs/sitemap');
    await installModule('@nuxtjs/robots');
  },
});
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run test/unit/module.test.ts`
Expected: PASS, 4 tests. The nitro plugin file does not exist yet — that is fine, this test never boots Nuxt.

- [ ] **Step 5: Commit**

```bash
git add src/module.ts test/unit/module.test.ts
git commit -m "feat: wire module fan-out and install the seo modules"
```

---

### Task 7: Host context resolution

**Files:**
- Create: `src/runtime/server/lib/hostContext.ts`
- Test: `test/unit/hostContext.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resolveHostContext(i18nConfig, host, locale)` → `{ market, domain, clientEnv } | null`. `null` means this host does not serve that locale, and the caller must emit an empty source.

- [ ] **Step 1: Write the failing test**

Create `test/unit/hostContext.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveHostContext } from '../../src/runtime/server/lib/hostContext';

const de = { id: 'lng_de', code: 'de', localeChain: ['de'] };
const fr = { id: 'lng_fr', code: 'fr', localeChain: ['fr'] };
const chDe = { id: 'd1', host: 'shop.ch', devHost: 'shop-ch.local', languageId: 'lng_de', language: de, isDefault: true };
const chFr = { id: 'd2', host: 'shop.ch', path: '/fr', devHost: 'shop-ch.local', languageId: 'lng_fr', language: fr, isDefault: false };
const deDe = { id: 'd3', host: 'shop.de', devHost: 'shop-de.local', languageId: 'lng_de', language: de, isDefault: true };

const marketCh = { id: 'mkt_ch', currency: 'CHF', domains: [chDe, chFr], defaultDomain: chDe };
const marketDe = { id: 'mkt_de', currency: 'EUR', domains: [deDe], defaultDomain: deDe };

const i18nConfig = {
  markets: [marketCh, marketDe],
  hostToMarket: { 'shop.ch': marketCh, 'shop-ch.local': marketCh, 'shop.de': marketDe, 'shop-de.local': marketDe },
  defaultMarket: marketCh,
} as never;

describe('resolveHostContext', () => {
  it('resolves the domain serving a locale on a host', () => {
    const ctx = resolveHostContext(i18nConfig, 'shop.ch', 'fr');
    expect(ctx?.domain.id).toBe('d2');
    expect(ctx?.clientEnv.currency).toBe('CHF');
    expect(ctx?.clientEnv.locale).toBe('fr');
  });

  it('resolves a second locale on the same host via its path prefix', () => {
    expect(resolveHostContext(i18nConfig, 'shop.ch', 'de')?.domain.path).toBeUndefined();
    expect(resolveHostContext(i18nConfig, 'shop.ch', 'fr')?.domain.path).toBe('/fr');
  });

  it('returns null when the host does not serve that locale', () => {
    expect(resolveHostContext(i18nConfig, 'shop.de', 'fr')).toBeNull();
  });

  it('strips a port before matching', () => {
    expect(resolveHostContext(i18nConfig, 'shop.ch:3000', 'de')?.market.id).toBe('mkt_ch');
  });

  it('falls back to the default market for an unknown host', () => {
    expect(resolveHostContext(i18nConfig, 'preview-abc.vercel.app', 'de')?.market.id).toBe('mkt_ch');
  });

  it('never marks the resolved client env as preview', () => {
    expect(resolveHostContext(i18nConfig, 'shop.ch', 'de')?.clientEnv.isPreview).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run test/unit/hostContext.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/runtime/server/lib/hostContext.ts`**

```ts
import type { ClientEnv } from '@laioutr-core/orchestr/runtime/types/userland/ClientEnv';
import type { RenderI18nConfig, RenderMarket, RenderMarketDomain } from '@laioutr-core/core-types/rc';

export interface HostContext {
  market: RenderMarket;
  domain: RenderMarketDomain;
  clientEnv: ClientEnv;
}

/**
 * Maps a request host and a locale onto the market domain that serves them. Returns null when the
 * host serves no domain for that locale, which the caller turns into an empty sitemap rather than
 * guessing another market's URLs.
 *
 * An unknown host resolves to the default market, matching how the frontend treats localhost and
 * unrecognised hosts. Preview deployments are kept out of the index by site config, not by an empty
 * sitemap.
 */
export const resolveHostContext = (
  i18nConfig: RenderI18nConfig,
  host: string,
  locale: string
): HostContext | null => {
  const bareHost = host.split(':')[0];
  const market = i18nConfig.hostToMarket[bareHost] ?? i18nConfig.defaultMarket;

  const onThisHost = market.domains.filter((domain) => domain.host === bareHost || domain.devHost === bareHost);
  const candidates = onThisHost.length > 0 ? onThisHost : market.domains;
  const domain = candidates.find((candidate) => candidate.language.code === locale);
  if (!domain) return null;

  return {
    market,
    domain,
    clientEnv: {
      locale: domain.language.code,
      currency: market.currency,
      isPreview: false,
      market,
      language: domain.language,
      domain,
    },
  };
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run test/unit/hostContext.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/lib/hostContext.ts test/unit/hostContext.test.ts
git commit -m "feat: resolve request host and locale to a market domain"
```

---

### Task 8: Configured-page URLs with cross-host alternates

**Files:**
- Create: `src/runtime/server/lib/alternates.ts`
- Create: `src/runtime/server/lib/configuredPageUrls.ts`
- Test: `test/unit/alternates.test.ts`, `test/unit/configuredPageUrls.test.ts`

**Interfaces:**
- Consumes: `composePath`, `fillParams`, `unlocalize`, `hasUnfilledParams` (Task 2); `isPageIncluded` (Task 4).
- Produces:
  - `buildAlternates(input: { pagePath, markets, pageMarketIds?, params, trailingSlash }): Array<{ hreflang: string; href: string }>`
  - `buildConfiguredPageUrls(input: { pages, market, domain, markets, trailingSlash, excludePageTypes, pageTypeSeo }): SitemapUrl[]`
  - `SitemapUrl` is the shape the sitemap module consumes: `{ loc: string; lastmod?: string; changefreq?: string; priority?: number; images?: Array<{ loc: string }>; alternatives?: Array<{ hreflang: string; href: string }> }`. Declare it in `src/runtime/server/lib/alternates.ts` and re-export from `pageIndexUrls.ts` in Task 9.

- [ ] **Step 1: Write the failing alternates test**

Create `test/unit/alternates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildAlternates } from '../../src/runtime/server/lib/alternates';

const de = { id: 'lng_de', code: 'de', localeChain: ['de'] };
const fr = { id: 'lng_fr', code: 'fr', localeChain: ['fr'] };
const chDe = { host: 'shop.ch', languageId: 'lng_de', language: de };
const chFr = { host: 'shop.ch', path: '/fr', languageId: 'lng_fr', language: fr };
const deDe = { host: 'shop.de', languageId: 'lng_de', language: de };
const marketCh = { id: 'mkt_ch', domains: [chDe, chFr], defaultDomain: chDe };
const marketDe = { id: 'mkt_de', domains: [deDe], defaultDomain: deDe };
const markets = [marketCh, marketDe] as never;

describe('buildAlternates', () => {
  it('emits one alternate per domain across every market', () => {
    const alternates = buildAlternates({
      pagePath: { de: '/ueber-uns', fr: '/a-propos' },
      markets,
      params: {},
      trailingSlash: false,
    });
    expect(alternates).toEqual(
      expect.arrayContaining([
        { hreflang: 'de', href: 'https://shop.ch/ueber-uns' },
        { hreflang: 'fr', href: 'https://shop.ch/fr/a-propos' },
        { hreflang: 'de', href: 'https://shop.de/ueber-uns' },
      ])
    );
  });

  it('adds x-default pointing at the first applicable market default domain', () => {
    const alternates = buildAlternates({ pagePath: '/about', markets, params: {}, trailingSlash: false });
    expect(alternates).toContainEqual({ hreflang: 'x-default', href: 'https://shop.ch/about' });
  });

  it('restricts alternates to the markets a scoped page belongs to', () => {
    const alternates = buildAlternates({
      pagePath: '/about',
      markets,
      pageMarketIds: ['mkt_de'],
      params: {},
      trailingSlash: false,
    });
    expect(alternates.every((alternate) => alternate.href.startsWith('https://shop.de'))).toBe(true);
    expect(alternates).toContainEqual({ hreflang: 'x-default', href: 'https://shop.de/about' });
  });

  it('omits a locale the page has no path for', () => {
    const alternates = buildAlternates({ pagePath: { de: '/ueber-uns' }, markets, params: {}, trailingSlash: false });
    expect(alternates.some((alternate) => alternate.hreflang === 'fr')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run test/unit/alternates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/runtime/server/lib/alternates.ts`**

```ts
import { composePath, fillParams, unlocalize } from '../../shared/path';
import type { RenderMarket } from '@laioutr-core/core-types/rc';

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  images?: Array<{ loc: string }>;
  alternatives?: Array<{ hreflang: string; href: string }>;
}

/**
 * Cross-host hreflang for a page whose path is known in every locale. Pure path composition, so it
 * costs no upstream calls — which is why configured pages get alternates and enumerated pages do not.
 */
export const buildAlternates = (input: {
  pagePath: string | Record<string, string>;
  markets: RenderMarket[];
  pageMarketIds?: string[];
  params: Record<string, string | string[]>;
  trailingSlash: boolean;
}): Array<{ hreflang: string; href: string }> => {
  const { pagePath, markets, pageMarketIds, params, trailingSlash } = input;
  const applicable = pageMarketIds?.length ? markets.filter((market) => pageMarketIds.includes(market.id)) : markets;
  const result: Array<{ hreflang: string; href: string }> = [];

  const hrefFor = (domain: RenderMarket['domains'][number]): string | undefined => {
    const path = unlocalize(pagePath, domain.language.localeChain);
    if (!path) return undefined;
    return `https://${domain.host}${composePath(domain.path ?? '', fillParams(path, params), trailingSlash)}`;
  };

  for (const market of applicable) {
    for (const domain of market.domains) {
      const href = hrefFor(domain);
      if (href) result.push({ hreflang: domain.language.code, href });
    }
  }

  // x-default targets the first applicable market so a market-scoped page never points at a market
  // where it has no route.
  const defaultHref = applicable[0] ? hrefFor(applicable[0].defaultDomain) : undefined;
  if (defaultHref) result.push({ hreflang: 'x-default', href: defaultHref });

  return result;
};
```

- [ ] **Step 4: Run the alternates test and confirm it passes**

Run: `pnpm vitest run test/unit/alternates.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing configured-pages test**

Create `test/unit/configuredPageUrls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildConfiguredPageUrls } from '../../src/runtime/server/lib/configuredPageUrls';

const de = { id: 'lng_de', code: 'de', localeChain: ['de'] };
const chDe = { host: 'shop.ch', languageId: 'lng_de', language: de };
const marketCh = { id: 'mkt_ch', domains: [chDe], defaultDomain: chDe };
const markets = [marketCh] as never;

const variant = (robots?: string) => ({ seo: { title: '', description: '', ...(robots ? { robots } : {}) } });

const pages = {
  home: { id: 'home', type: 'core/home', path: '/', variants: { a: variant() }, updatedAt: '2026-01-01T00:00:00Z' },
  pricing: { id: 'pricing', type: 'core/landingpage', path: '/preise', variants: { a: variant() }, updatedAt: '2026-02-01T00:00:00Z' },
  hidden: { id: 'hidden', type: 'core/landingpage', path: '/intern', variants: { a: variant('noindex') }, updatedAt: '' },
  notFound: { id: 'notFound', type: 'core/404', path: '/:catchall*', variants: { a: variant() }, updatedAt: '' },
  pdp: { id: 'pdp', type: 'ecommerce/product-detail-page', path: '/produkte/:slug', variants: { a: variant() }, updatedAt: '' },
  otherMarket: { id: 'om', type: 'core/landingpage', path: '/nur-de', marketIds: ['mkt_de'], variants: { a: variant() }, updatedAt: '' },
};

const build = (overrides = {}) =>
  buildConfiguredPageUrls({
    pages: pages as never,
    market: marketCh as never,
    domain: chDe as never,
    markets,
    trailingSlash: false,
    excludePageTypes: [],
    pageTypeSeo: {},
    ...overrides,
  });

describe('buildConfiguredPageUrls', () => {
  it('includes only parameterless pages', () => {
    const locs = build().map((url) => url.loc);
    expect(locs).toContain('/');
    expect(locs).toContain('/preise');
    expect(locs.some((loc) => loc.includes('produkte'))).toBe(false);
  });

  it('drops the catch-all, noindex pages and other markets pages', () => {
    const locs = build().map((url) => url.loc);
    expect(locs.some((loc) => loc.includes('catchall'))).toBe(false);
    expect(locs).not.toContain('/intern');
    expect(locs).not.toContain('/nur-de');
  });

  it('carries lastmod from the page updatedAt', () => {
    expect(build().find((url) => url.loc === '/preise')?.lastmod).toBe('2026-02-01T00:00:00Z');
  });

  it('applies per-page-type priority and changefreq', () => {
    const urls = build({ pageTypeSeo: { 'core/home': { priority: 1, changefreq: 'daily' } } });
    const home = urls.find((url) => url.loc === '/');
    expect(home?.priority).toBe(1);
    expect(home?.changefreq).toBe('daily');
  });

  it('omits a page type turned off with include false', () => {
    const urls = build({ pageTypeSeo: { 'core/landingpage': { include: false } } });
    expect(urls.map((url) => url.loc)).not.toContain('/preise');
  });

  it('attaches cross-host alternates', () => {
    expect(build().find((url) => url.loc === '/preise')?.alternatives).toContainEqual({
      hreflang: 'de',
      href: 'https://shop.ch/preise',
    });
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `pnpm vitest run test/unit/configuredPageUrls.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write `src/runtime/server/lib/configuredPageUrls.ts`**

```ts
import { buildAlternates, type SitemapUrl } from './alternates';
import { composePath, unlocalize } from '../../shared/path';
import { isDynamicPath, isPageIncluded } from '../../shared/pageSelection';
import type { RenderMarket, RenderMarketDomain } from '@laioutr-core/core-types/rc';

export interface PageTypeSeo {
  priority?: number;
  changefreq?: string;
  include?: boolean;
}

interface ConfiguredPage {
  id: string;
  type: string;
  path: string | Record<string, string>;
  marketIds?: string[];
  variants: Record<string, { conditions?: unknown; seo: { robots?: string } }>;
  updatedAt?: string;
}

/** Every parameterless configured page this host serves in this locale. Finite and cheap, so it is
 *  always built in full rather than accumulated. */
export const buildConfiguredPageUrls = (input: {
  pages: Record<string, ConfiguredPage>;
  market: RenderMarket;
  domain: RenderMarketDomain;
  markets: RenderMarket[];
  trailingSlash: boolean;
  excludePageTypes: string[];
  pageTypeSeo: Record<string, PageTypeSeo>;
}): SitemapUrl[] => {
  const { pages, market, domain, markets, trailingSlash, excludePageTypes, pageTypeSeo } = input;
  const urls: SitemapUrl[] = [];

  for (const page of Object.values(pages)) {
    if (isDynamicPath(page.path)) continue;
    if (pageTypeSeo[page.type]?.include === false) continue;
    if (!isPageIncluded(page, { marketId: market.id, excludePageTypes })) continue;

    const path = unlocalize(page.path, domain.language.localeChain);
    if (!path) continue;

    const seo = pageTypeSeo[page.type] ?? {};
    urls.push({
      loc: composePath(domain.path ?? '', path, trailingSlash),
      ...(page.updatedAt ? { lastmod: page.updatedAt } : {}),
      ...(seo.priority !== undefined ? { priority: seo.priority } : {}),
      ...(seo.changefreq ? { changefreq: seo.changefreq } : {}),
      alternatives: buildAlternates({
        pagePath: page.path,
        markets,
        pageMarketIds: page.marketIds,
        params: {},
        trailingSlash,
      }),
    });
  }

  return urls;
};
```

- [ ] **Step 8: Run the test and confirm it passes**

Run: `pnpm vitest run test/unit/configuredPageUrls.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Commit**

```bash
git add src/runtime/server/lib/alternates.ts src/runtime/server/lib/configuredPageUrls.ts test/unit/alternates.test.ts test/unit/configuredPageUrls.test.ts
git commit -m "feat: build configured-page sitemap URLs with cross-host alternates"
```

---

### Task 9: Page-index entry mapping and the extension hook

**Files:**
- Create: `src/runtime/server/lib/pageIndexUrls.ts`
- Create: `src/runtime/types/hooks.d.ts`
- Test: `test/unit/pageIndexUrls.test.ts`

**Interfaces:**
- Consumes: `composePath`, `fillParams`, `hasUnfilledParams`, `unlocalize` (Task 2); `SitemapUrl` (Task 8).
- Produces:
  - `mapPageIndexEntries(input: { entries, pagePath, domain, trailingSlash, includeImages, seo }): SitemapUrl[]`
  - `dedupeByLoc(urls: SitemapUrl[], seen: Set<string>): SitemapUrl[]`
  - Hook type `essentials-seo:sitemap-source:resolve`.

- [ ] **Step 1: Write the failing test**

Create `test/unit/pageIndexUrls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dedupeByLoc, mapPageIndexEntries } from '../../src/runtime/server/lib/pageIndexUrls';

const de = { id: 'lng_de', code: 'de', localeChain: ['de'] };
const domain = { host: 'shop.ch', path: '/fr', languageId: 'lng_de', language: de } as never;

const entry = (params: Record<string, string>, meta = {}) => ({ params, meta });

const map = (entries: any[], overrides = {}) =>
  mapPageIndexEntries({
    entries,
    pagePath: '/produkte/:slug+',
    domain,
    trailingSlash: false,
    includeImages: true,
    seo: {},
    ...overrides,
  });

describe('mapPageIndexEntries', () => {
  it('fills params and applies the domain path prefix', () => {
    expect(map([entry({ slug: 'schuh' })])[0].loc).toBe('/fr/produkte/schuh');
  });

  it('joins a repeatable param', () => {
    expect(map([entry({ slug: 'a/b' })])[0].loc).toBe('/fr/produkte/a/b');
  });

  it('skips an entry marked noindex', () => {
    expect(map([entry({ slug: 'x' }, { noindex: true })])).toHaveLength(0);
  });

  it('skips an entry whose params leave the path unfilled', () => {
    expect(map([entry({})])).toHaveLength(0);
  });

  it('carries lastModified through to lastmod', () => {
    expect(map([entry({ slug: 'x' }, { lastModified: '2026-03-01T00:00:00Z' })])[0].lastmod).toBe('2026-03-01T00:00:00Z');
  });

  it('emits previewImage as an image entry when enabled', () => {
    const meta = { previewImage: 'https://cdn.example/a.jpg' };
    expect(map([entry({ slug: 'x' }, meta)])[0].images).toEqual([{ loc: 'https://cdn.example/a.jpg' }]);
    expect(map([entry({ slug: 'x' }, meta)], { includeImages: false })[0].images).toBeUndefined();
  });

  it('applies per-page-type priority and changefreq', () => {
    const urls = map([entry({ slug: 'x' })], { seo: { priority: 0.8, changefreq: 'daily' } });
    expect(urls[0].priority).toBe(0.8);
    expect(urls[0].changefreq).toBe('daily');
  });

  it('emits no alternatives — the page head is the authoritative hreflang source', () => {
    expect(map([entry({ slug: 'x' })])[0].alternatives).toBeUndefined();
  });
});

describe('dedupeByLoc', () => {
  it('drops a loc already seen and records new ones', () => {
    const seen = new Set<string>(['/a']);
    expect(dedupeByLoc([{ loc: '/a' }, { loc: '/b' }, { loc: '/b' }], seen).map((url) => url.loc)).toEqual(['/b']);
    expect(seen.has('/b')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run test/unit/pageIndexUrls.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/runtime/server/lib/pageIndexUrls.ts`**

```ts
import { composePath, fillParams, hasUnfilledParams, unlocalize } from '../../shared/path';
import type { SitemapUrl } from './alternates';
import type { PageTypeSeo } from './configuredPageUrls';
import type { RenderMarketDomain } from '@laioutr-core/core-types/rc';
import type { PageIndexEntry } from '@laioutr-core/core-types/orchestr';

export type { SitemapUrl } from './alternates';

/**
 * Maps enumerated entries onto sitemap URLs.
 *
 * No `alternatives` are emitted: correlating one entry across locales would need either a point
 * lookup per entry or one enumeration per locale, and the rendered page head already carries the
 * complete hreflang set.
 */
export const mapPageIndexEntries = (input: {
  entries: readonly PageIndexEntry[];
  pagePath: string | Record<string, string>;
  domain: RenderMarketDomain;
  trailingSlash: boolean;
  includeImages: boolean;
  seo: PageTypeSeo;
}): SitemapUrl[] => {
  const { entries, pagePath, domain, trailingSlash, includeImages, seo } = input;
  const path = unlocalize(pagePath, domain.language.localeChain);
  if (!path) return [];

  const urls: SitemapUrl[] = [];
  for (const entry of entries) {
    if (entry.meta.noindex) continue;

    const filled = fillParams(path, entry.params);
    // A missing param would otherwise emit a collapsed URL like /products//.
    if (hasUnfilledParams(filled)) continue;

    urls.push({
      loc: composePath(domain.path ?? '', filled, trailingSlash),
      ...(entry.meta.lastModified ? { lastmod: entry.meta.lastModified } : {}),
      ...(seo.priority !== undefined ? { priority: seo.priority } : {}),
      ...(seo.changefreq ? { changefreq: seo.changefreq } : {}),
      ...(includeImages && entry.meta.previewImage ? { images: [{ loc: entry.meta.previewImage }] } : {}),
    });
  }
  return urls;
};

/** Filters out URLs whose `loc` is already accumulated, recording the survivors in `seen`. */
export const dedupeByLoc = (urls: SitemapUrl[], seen: Set<string>): SitemapUrl[] =>
  urls.filter((url) => {
    if (seen.has(url.loc)) return false;
    seen.add(url.loc);
    return true;
  });
```

- [ ] **Step 4: Write `src/runtime/types/hooks.d.ts`**

```ts
import type { PageIndexEntry } from '@laioutr-core/core-types/orchestr';
import type { RenderMarket, RenderMarketDomain } from '@laioutr-core/core-types/rc';
import type { H3Event } from 'h3';
import type { SitemapUrl } from '../server/lib/alternates';

export interface SitemapSourceResolveContext {
  event: H3Event;
  /** null on the configured-pages source. */
  token: string | null;
  locale: string;
  market: RenderMarket;
  domain: RenderMarketDomain;
  /** Raw entries, index-aligned with `urls` before any handler mutates it. */
  entries: readonly (PageIndexEntry | Record<string, unknown>)[];
  /** Mutated in place. Fires once per rebuild pass, not once per URL. */
  urls: SitemapUrl[];
}

declare module 'nitropack' {
  interface NitroRuntimeHooks {
    'essentials-seo:sitemap-source:resolve': (ctx: SitemapSourceResolveContext) => void | Promise<void>;
  }
}

export {};
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm vitest run test/unit/pageIndexUrls.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/server/lib/pageIndexUrls.ts src/runtime/types/hooks.d.ts test/unit/pageIndexUrls.test.ts
git commit -m "feat: map page-index entries to sitemap URLs and declare the resolve hook"
```

---

### Task 10: Snapshot store

**Files:**
- Create: `src/runtime/server/lib/snapshotStore.ts`
- Test: `test/unit/snapshotStore.test.ts`

**Interfaces:**
- Consumes: `SitemapUrl` (Task 8).
- Produces:
  - `Snapshot = { urls: SitemapUrl[]; complete: boolean; resumeFrom?: string; expiresAt: number; refreshAt: number }`
  - `stamp(complete: boolean, now: number): { expiresAt; refreshAt }`
  - `snapshotState(snapshot: Snapshot | null, now: number): 'missing' | 'fresh' | 'stale' | 'incomplete'`
  - `createSnapshotStore(storage)` → `{ readLive, writeLive, readPending, writePending, promotePending }`

- [ ] **Step 1: Write the failing test**

Create `test/unit/snapshotStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COMPLETE_TTL_MS, INCOMPLETE_TTL_MS, createSnapshotStore, snapshotState, stamp } from '../../src/runtime/server/lib/snapshotStore';

const memoryStorage = () => {
  const map = new Map<string, unknown>();
  return {
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: unknown) => void map.set(key, value),
    removeItem: async (key: string) => void map.delete(key),
    _map: map,
  };
};

const NOW = 1_000_000;

describe('stamp', () => {
  it('gives a complete snapshot a 24h life', () => {
    expect(stamp(true, NOW).expiresAt).toBe(NOW + COMPLETE_TTL_MS);
  });

  it('gives an incomplete snapshot a 1h life so accumulation retries soon', () => {
    expect(stamp(false, NOW).expiresAt).toBe(NOW + INCOMPLETE_TTL_MS);
  });

  it('sets refreshAt at 80 percent of the life', () => {
    const { expiresAt, refreshAt } = stamp(true, NOW);
    expect(refreshAt).toBe(NOW + (expiresAt - NOW) * 0.8);
  });
});

describe('snapshotState', () => {
  const snap = (over: Partial<any>) => ({ urls: [], complete: true, expiresAt: NOW + 1000, refreshAt: NOW + 800, ...over });

  it('reports missing for null', () => {
    expect(snapshotState(null, NOW)).toBe('missing');
  });

  it('reports missing once expired', () => {
    expect(snapshotState(snap({ expiresAt: NOW - 1 }), NOW)).toBe('missing');
  });

  it('reports incomplete regardless of freshness', () => {
    expect(snapshotState(snap({ complete: false }), NOW)).toBe('incomplete');
  });

  it('reports fresh before refreshAt and stale after', () => {
    expect(snapshotState(snap({ refreshAt: NOW + 1 }), NOW)).toBe('fresh');
    expect(snapshotState(snap({ refreshAt: NOW - 1 }), NOW)).toBe('stale');
  });
});

describe('createSnapshotStore', () => {
  it('keys live and pending separately, both by host', () => {
    const storage = memoryStorage();
    const store = createSnapshotStore(storage as never);
    return (async () => {
      await store.writeLive('shop.ch', 'pages-de', { urls: [{ loc: '/a' }], complete: true, ...stamp(true, NOW) });
      await store.writePending('shop.ch', 'pages-de', { urls: [{ loc: '/b' }], complete: false, ...stamp(false, NOW) });
      expect((await store.readLive('shop.ch', 'pages-de'))?.urls[0].loc).toBe('/a');
      expect((await store.readPending('shop.ch', 'pages-de'))?.urls[0].loc).toBe('/b');
      expect(await store.readLive('shop.de', 'pages-de')).toBeNull();
    })();
  });

  it('promotes pending to live in one write and clears pending', async () => {
    const storage = memoryStorage();
    const store = createSnapshotStore(storage as never);
    await store.writeLive('shop.ch', 'pages-de', { urls: [{ loc: '/old' }], complete: true, ...stamp(true, NOW) });
    await store.writePending('shop.ch', 'pages-de', { urls: [{ loc: '/new' }], complete: true, ...stamp(true, NOW) });
    await store.promotePending('shop.ch', 'pages-de');
    expect((await store.readLive('shop.ch', 'pages-de'))?.urls[0].loc).toBe('/new');
    expect(await store.readPending('shop.ch', 'pages-de')).toBeNull();
  });

  it('is a no-op when there is no pending snapshot to promote', async () => {
    const storage = memoryStorage();
    const store = createSnapshotStore(storage as never);
    await store.writeLive('shop.ch', 'pages-de', { urls: [{ loc: '/old' }], complete: true, ...stamp(true, NOW) });
    await store.promotePending('shop.ch', 'pages-de');
    expect((await store.readLive('shop.ch', 'pages-de'))?.urls[0].loc).toBe('/old');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run test/unit/snapshotStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/runtime/server/lib/snapshotStore.ts`**

```ts
import type { SitemapUrl } from './alternates';
import type { Storage } from 'unstorage';

export const COMPLETE_TTL_MS = 24 * 60 * 60 * 1000;
/** Short so an unfinished accumulation is retried within the hour and keeps making progress. */
export const INCOMPLETE_TTL_MS = 60 * 60 * 1000;
const REFRESH_FACTOR = 0.8;

export interface Snapshot {
  urls: SitemapUrl[];
  complete: boolean;
  /**
   * Opaque page-index resume token. Not bound to its enumeration by the platform, so it is only ever
   * read back under the same (host, sitemap name) key that produced it.
   */
  resumeFrom?: string;
  expiresAt: number;
  refreshAt: number;
}

export const stamp = (complete: boolean, now: number): { expiresAt: number; refreshAt: number } => {
  const ttl = complete ? COMPLETE_TTL_MS : INCOMPLETE_TTL_MS;
  return { expiresAt: now + ttl, refreshAt: now + ttl * REFRESH_FACTOR };
};

export const snapshotState = (snapshot: Snapshot | null, now: number): 'missing' | 'fresh' | 'stale' | 'incomplete' => {
  if (!snapshot || snapshot.expiresAt <= now) return 'missing';
  if (!snapshot.complete) return 'incomplete';
  return snapshot.refreshAt <= now ? 'stale' : 'fresh';
};

/**
 * Two keys per source. A refresh accumulates over several passes, so it cannot happen in the value
 * being served without exposing a partial sitemap; it lands in `:pending` and replaces `live` in a
 * single write once it completes. The host is in the key because one build serves every market.
 */
export const createSnapshotStore = (storage: Storage) => {
  const liveKey = (host: string, name: string) => `sitemap:v1:${host}:${name}`;
  const pendingKey = (host: string, name: string) => `${liveKey(host, name)}:pending`;

  const read = async (key: string): Promise<Snapshot | null> => ((await storage.getItem(key)) as Snapshot | null) ?? null;

  return {
    readLive: (host: string, name: string) => read(liveKey(host, name)),
    readPending: (host: string, name: string) => read(pendingKey(host, name)),
    writeLive: (host: string, name: string, snapshot: Snapshot) => storage.setItem(liveKey(host, name), snapshot),
    writePending: (host: string, name: string, snapshot: Snapshot) => storage.setItem(pendingKey(host, name), snapshot),
    promotePending: async (host: string, name: string): Promise<void> => {
      const pending = await read(pendingKey(host, name));
      if (!pending) return;
      await storage.setItem(liveKey(host, name), pending);
      await storage.removeItem(pendingKey(host, name));
    },
  };
};

export type SnapshotStore = ReturnType<typeof createSnapshotStore>;
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run test/unit/snapshotStore.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/lib/snapshotStore.ts test/unit/snapshotStore.test.ts
git commit -m "feat: add host-keyed sitemap snapshot store with live and pending slots"
```

---

### Task 11: The rebuild pass

**Files:**
- Create: `src/runtime/server/lib/rebuild.ts`
- Test: `test/unit/rebuild.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `stamp` (Task 10); `dedupeByLoc` (Task 9).
- Produces: `runRebuildPass(input): Promise<Snapshot>` — takes the previous snapshot (or null) and an injected `listPagesFrom`, returns the next snapshot. Dependency-injected so it is testable without a nitro context.

- [ ] **Step 1: Write the failing test**

Create `test/unit/rebuild.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runRebuildPass } from '../../src/runtime/server/lib/rebuild';

/** Fake matching orchestr's ResumablePageEntryStream: endCursor is only defined after consumption. */
const fakeStream = (entries: any[], endCursor: string | undefined) => {
  let consumed = false;
  return {
    toArray: async () => {
      consumed = true;
      return entries;
    },
    get endCursor() {
      return consumed ? endCursor : undefined;
    },
    [Symbol.asyncIterator]: async function* () {
      yield* entries;
    },
  };
};

const entry = (slug: string) => ({ params: { slug }, meta: {} });

const base = {
  now: 1_000_000,
  take: 2,
  mapEntries: (entries: any[]) => entries.map((e) => ({ loc: `/p/${e.params.slug}` })),
};

describe('runRebuildPass', () => {
  it('starts with no resume token and stores the one it receives', async () => {
    const listPagesFrom = vi.fn(() => fakeStream([entry('a'), entry('b')], 'cursor-1'));
    const next = await runRebuildPass({ ...base, previous: null, listPagesFrom });
    expect(listPagesFrom).toHaveBeenCalledWith(expect.objectContaining({ resumeFrom: undefined, take: 2 }));
    expect(next.urls.map((u) => u.loc)).toEqual(['/p/a', '/p/b']);
    expect(next.resumeFrom).toBe('cursor-1');
    expect(next.complete).toBe(false);
  });

  it('resumes from the stored token and appends', async () => {
    const previous = { urls: [{ loc: '/p/a' }], complete: false, resumeFrom: 'cursor-1', expiresAt: 0, refreshAt: 0 };
    const listPagesFrom = vi.fn(() => fakeStream([entry('c')], undefined));
    const next = await runRebuildPass({ ...base, previous, listPagesFrom });
    expect(listPagesFrom).toHaveBeenCalledWith(expect.objectContaining({ resumeFrom: 'cursor-1' }));
    expect(next.urls.map((u) => u.loc)).toEqual(['/p/a', '/p/c']);
  });

  it('marks complete when the stream reports an undefined endCursor after consumption', async () => {
    const next = await runRebuildPass({ ...base, previous: null, listPagesFrom: () => fakeStream([entry('a')], undefined) });
    expect(next.complete).toBe(true);
    expect(next.resumeFrom).toBeUndefined();
  });

  it('does not re-add a loc already accumulated', async () => {
    const previous = { urls: [{ loc: '/p/a' }], complete: false, resumeFrom: 'c', expiresAt: 0, refreshAt: 0 };
    const next = await runRebuildPass({ ...base, previous, listPagesFrom: () => fakeStream([entry('a'), entry('b')], undefined) });
    expect(next.urls.map((u) => u.loc)).toEqual(['/p/a', '/p/b']);
  });

  it('keeps the previous resume token when a pass throws', async () => {
    const previous = { urls: [{ loc: '/p/a' }], complete: false, resumeFrom: 'cursor-1', expiresAt: 0, refreshAt: 0 };
    const listPagesFrom = () => ({
      toArray: async () => {
        throw new Error('upstream exploded');
      },
      endCursor: undefined,
      [Symbol.asyncIterator]: async function* () {},
    });
    const next = await runRebuildPass({ ...base, previous, listPagesFrom: listPagesFrom as never });
    expect(next.resumeFrom).toBe('cursor-1');
    expect(next.complete).toBe(false);
    expect(next.urls.map((u) => u.loc)).toEqual(['/p/a']);
  });

  it('caps at one pass and marks complete when the handler is not resumable', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listPagesFrom = () => {
      throw new Error('the pageIndex list handler for "x" ignores startCursor');
    };
    const fallback = vi.fn(() => fakeStream([entry('a')], undefined));
    const next = await runRebuildPass({ ...base, previous: null, listPagesFrom: listPagesFrom as never, listPages: fallback });
    expect(fallback).toHaveBeenCalled();
    expect(next.complete).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('startCursor'));
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run test/unit/rebuild.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/runtime/server/lib/rebuild.ts`**

```ts
import { dedupeByLoc } from './pageIndexUrls';
import { stamp, type Snapshot } from './snapshotStore';
import type { SitemapUrl } from './alternates';

interface EntryStreamLike {
  toArray(): Promise<any[]>;
  readonly endCursor?: string | undefined;
}

export interface RebuildPassInput {
  previous: Snapshot | null;
  now: number;
  take: number;
  mapEntries: (entries: any[]) => SitemapUrl[];
  /** Injected `listPagesFrom`. Throws when the registration ignores `startCursor`. */
  listPagesFrom: (options: { take: number; resumeFrom: string | undefined }) => EntryStreamLike;
  /** Injected `listPages`, used only for the non-resumable fallback. */
  listPages?: (options: { take: number }) => EntryStreamLike;
  /** Named in the non-resumable error so the author knows which registration to fix. */
  label?: string;
}

/**
 * Advances an accumulation by one bounded pass. Progress is monotonic: a pass that throws leaves the
 * previous resume point untouched so the next crawl repeats it rather than restarting.
 */
export const runRebuildPass = async (input: RebuildPassInput): Promise<Snapshot> => {
  const { previous, now, take, mapEntries, listPagesFrom, listPages, label } = input;
  const urls = previous ? [...previous.urls] : [];
  const seen = new Set(urls.map((url) => url.loc));

  const keep = (complete: boolean, resumeFrom: string | undefined): Snapshot => ({
    urls,
    complete,
    ...(resumeFrom !== undefined ? { resumeFrom } : {}),
    ...stamp(complete, now),
  });

  let stream: EntryStreamLike;
  try {
    stream = listPagesFrom({ take, resumeFrom: previous?.resumeFrom });
  } catch (error) {
    // The registration ignores startCursor, so it cannot be resumed. One bounded read is all this
    // page type can offer until its handler threads the cursor through.
    console.error(
      `[@laioutr/app-essentials-seo] ${label ?? 'page type'} cannot be resumed because its pageIndex list handler ignores startCursor. ` +
        `Its sitemap is capped at ${take} URLs. Return \`paginate(fn, startCursor)\` from the handler to fix it. ` +
        `Original error: ${(error as Error).message}`
    );
    if (!listPages) return keep(true, undefined);
    try {
      urls.push(...dedupeByLoc(mapEntries(await listPages({ take }).toArray()), seen));
    } catch (fallbackError) {
      console.error(`[@laioutr/app-essentials-seo] fallback enumeration failed: ${(fallbackError as Error).message}`);
    }
    return keep(true, undefined);
  }

  let entries: any[];
  try {
    entries = await stream.toArray();
  } catch (error) {
    console.error(
      `[@laioutr/app-essentials-seo] enumeration pass failed for ${label ?? 'a page type'}; keeping the last resume point. ` +
        `Original error: ${(error as Error).message}`
    );
    return keep(false, previous?.resumeFrom);
  }

  urls.push(...dedupeByLoc(mapEntries(entries), seen));

  // Read only after one complete consumption: undefined means "start here" going in and "exhausted"
  // coming out.
  const endCursor = stream.endCursor;
  return keep(endCursor === undefined, endCursor);
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run test/unit/rebuild.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/lib/rebuild.ts test/unit/rebuild.test.ts
git commit -m "feat: add bounded resumable sitemap rebuild pass"
```

---

### Task 12: Nitro plugin

**Files:**
- Create: `src/runtime/server/nitro/sitemap.ts`
- Test: covered by Task 13's integration suite (this task has no isolated test — the plugin is pure wiring over already-tested units).

**Interfaces:**
- Consumes: everything from Tasks 3, 5, 7–11.
- Produces: the three hook registrations. No exports.

- [ ] **Step 1: Write `src/runtime/server/nitro/sitemap.ts`**

```ts
import { defineNitroPlugin, useRuntimeConfig, useUserlandCache } from '#imports';
import { getRequestHost, setHeader } from 'h3';
import { i18nConfig } from '#laioutr/i18n-config';
import { rcProject } from '#laioutr/rc';
import { listPages, listPagesFrom } from '#imports';
import { CONFIGURED_PAGES_TOKEN, buildSitemapName, parseSitemapName } from '../../shared/sitemapName';
import { resolveHostContext } from '../lib/hostContext';
import { buildConfiguredPageUrls } from '../lib/configuredPageUrls';
import { mapPageIndexEntries } from '../lib/pageIndexUrls';
import { createSnapshotStore, snapshotState, stamp, type Snapshot } from '../lib/snapshotStore';
import { runRebuildPass } from '../lib/rebuild';
import { isDynamicPath } from '../../shared/pageSelection';
import type { SitemapUrl } from '../lib/alternates';

const MODULE_NAME = '@laioutr/app-essentials-seo';
const CACHE_CONTROL = 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800';

const warned = new Set<string>();
const warnOnce = (key: string, message: string) => {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[${MODULE_NAME}] ${message}`);
};

export default defineNitroPlugin((nitro) => {
  const options = useRuntimeConfig()[MODULE_NAME];
  const store = createSnapshotStore(useUserlandCache('essentials-seo'));
  const trailingSlash = rcProject.config?.trailingSlash ?? false;
  const pageTypeSeo = Object.fromEntries(options.sitemap.pageTypes.map((entry: any) => [entry.pageType, entry]));

  // `parseSitemapName` inverts a registry, so every name the build declared has to be registered in
  // this process before the first request can be parsed.
  for (const source of options.sources as Array<{ token: string | null; locale: string }>) {
    buildSitemapName(source.token ?? CONFIGURED_PAGES_TOKEN, source.locale);
  }

  /** The configured page whose route template a page type owns. */
  const templateFor = (token: string) =>
    Object.values(rcProject.pages ?? {}).find((page: any) => page.type === token && isDynamicPath(page.path));

  nitro.hooks.hook('sitemap:sources', async (ctx: any) => {
    const parsed = parseSitemapName(ctx.sitemapName);
    if (!parsed) return; // not one of ours

    const host = getRequestHost(ctx.event, { xForwardedHost: true });
    const hostContext = resolveHostContext(i18nConfig, host, parsed.locale);
    if (!hostContext) {
      ctx.sources.push({ context: { name: MODULE_NAME }, urls: [] });
      return;
    }
    const { market, domain, clientEnv } = hostContext;

    const emit = async (urls: SitemapUrl[], entries: readonly unknown[]) => {
      await nitro.hooks.callHook('essentials-seo:sitemap-source:resolve', {
        event: ctx.event,
        token: parsed.token,
        locale: parsed.locale,
        market,
        domain,
        entries,
        urls,
      });
      ctx.sources.push({ context: { name: MODULE_NAME }, urls: urls.filter(Boolean) });
    };

    // Configured pages are finite and need no upstream calls, so they are always built in full.
    if (parsed.token === null) {
      const urls = buildConfiguredPageUrls({
        pages: rcProject.pages ?? {},
        market,
        domain,
        markets: i18nConfig.markets,
        trailingSlash,
        excludePageTypes: options.sitemap.excludePageTypes,
        pageTypeSeo,
      });
      await emit(urls, Object.values(rcProject.pages ?? {}));
      return;
    }

    const template = templateFor(parsed.token);
    if (!template) {
      warnOnce(ctx.sitemapName, `no configured page carries a route for "${parsed.token}" — emitting an empty sitemap`);
      await emit([], []);
      return;
    }

    const mapEntries = (entries: any[]) =>
      mapPageIndexEntries({
        entries,
        pagePath: template.path,
        domain,
        trailingSlash,
        includeImages: options.sitemap.includeImages,
        seo: pageTypeSeo[parsed.token!] ?? {},
      });

    const pass = (previous: Snapshot | null) =>
      runRebuildPass({
        previous,
        now: Date.now(),
        take: options.sitemap.rebuildBatchSize,
        mapEntries,
        label: `${parsed.token} (${parsed.locale})`,
        listPagesFrom: ({ take, resumeFrom }) =>
          listPagesFrom(parsed.token as never, { clientEnv, event: ctx.event, take, resumeFrom }),
        listPages: ({ take }) => listPages(parsed.token as never, { clientEnv, event: ctx.event, take }),
      });

    const live = await store.readLive(host, ctx.sitemapName);
    const state = snapshotState(live, Date.now());

    if (state === 'missing') {
      const next = await pass(null);
      await store.writeLive(host, ctx.sitemapName, next);
      await emit(next.urls, []);
      return;
    }

    if (state === 'incomplete') {
      // First build still accumulating: serve the partial and advance it in the background.
      ctx.event.waitUntil(
        pass(live).then((next) => store.writeLive(host, ctx.sitemapName, next))
      );
    } else if (state === 'stale') {
      // Refreshes accumulate beside the live value so a reader never observes a partial.
      ctx.event.waitUntil(
        (async () => {
          const pending = await store.readPending(host, ctx.sitemapName);
          const next = await pass(pending);
          await store.writePending(host, ctx.sitemapName, next);
          if (next.complete) await store.promotePending(host, ctx.sitemapName);
        })()
      );
    }

    await emit(live!.urls, []);
  });

  nitro.hooks.hook('sitemap:index-resolved', (ctx: any) => {
    const host = getRequestHost(ctx.event, { xForwardedHost: true });
    // A sitemap file may only list URLs on its own host, so a child covering a locale this host does
    // not serve must not appear in its index.
    ctx.sitemaps = ctx.sitemaps.filter((entry: { sitemap: string }) => {
      const name = entry.sitemap.split('/').pop()?.replace(/\.xml$/, '') ?? '';
      const parsed = parseSitemapName(name);
      if (!parsed) return true;
      return resolveHostContext(i18nConfig, host, parsed.locale) !== null;
    });
  });

  nitro.hooks.hook('sitemap:output', (ctx: any) => {
    // Set here rather than via the module's own cache option, which is disabled: this runs after its
    // header logic, and the CDN keys by host where a server-side entry would not.
    setHeader(ctx.event, 'Cache-Control', CACHE_CONTROL);
  });
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm dev:prepare && pnpm test:types`
Expected: no errors. If `#laioutr/rc` or `#laioutr/i18n-config` are not resolvable, add them to `src/runtime/server/tsconfig.json`'s `paths` pointing at the frontend-core types, and re-run.

- [ ] **Step 3: Commit**

```bash
git add src/runtime/server/nitro/sitemap.ts src/runtime/server/tsconfig.json
git commit -m "feat: serve per-host sitemap sources from a resumable snapshot"
```

---

### Task 13: Integration fixture and HTTP tests

**Files:**
- Create: `test/fixtures/seo/nuxt.config.ts`, `test/fixtures/seo/laioutrrc.json`, `test/fixtures/seo/app.vue`, `test/fixtures/seo/server/plugins/fakePageIndex.ts`, `test/fixtures/seo/package.json`
- Create: `test/integration/sitemap.test.ts`
- Modify: `test/basic.test.ts` (delete — superseded)

**Interfaces:**
- Consumes: the whole module.
- Produces: nothing importable.

- [ ] **Step 1: Create the fixture laioutrrc**

Create `test/fixtures/seo/laioutrrc.json`. Two markets, three domains — `shop.ch` serves `de` at the root and `fr` under `/fr`; `shop.de` serves `de` only.

```json
{
  "version": 1,
  "config": { "trailingSlash": false },
  "laioutr": { "projectSecretKey": false },
  "apps": [],
  "templates": {},
  "globalSections": {},
  "languages": {
    "lng_de": { "id": "lng_de", "code": "de", "name": "German", "fallbacks": [] },
    "lng_fr": { "id": "lng_fr", "code": "fr", "name": "French", "fallbacks": [] }
  },
  "markets": {
    "mkt_ch": {
      "id": "mkt_ch", "slug": "switzerland", "name": "Switzerland", "currency": "CHF",
      "regionCodes": ["CH"], "defaultDomainId": "dom_ch_de", "studio": {},
      "domains": {
        "dom_ch_de": { "id": "dom_ch_de", "host": "shop.ch", "languageId": "lng_de" },
        "dom_ch_fr": { "id": "dom_ch_fr", "host": "shop.ch", "path": "/fr", "languageId": "lng_fr" }
      }
    },
    "mkt_de": {
      "id": "mkt_de", "slug": "germany", "name": "Germany", "currency": "EUR",
      "regionCodes": ["DE"], "defaultDomainId": "dom_de_de", "studio": {},
      "domains": { "dom_de_de": { "id": "dom_de_de", "host": "shop.de", "languageId": "lng_de" } }
    }
  },
  "pages": {
    "p_home": {
      "id": "p_home", "type": "core/home", "path": "/", "queries": {},
      "variants": { "v": { "id": "v", "seo": { "title": {}, "description": {} }, "sections": { "header": [], "body": [], "footer": [] }, "queries": {}, "studio": { "label": "Default" } } },
      "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"
    },
    "p_hidden": {
      "id": "p_hidden", "type": "core/landingpage", "path": "/intern", "queries": {},
      "variants": { "v": { "id": "v", "seo": { "title": {}, "description": {}, "robots": "noindex, follow" }, "sections": { "header": [], "body": [], "footer": [] }, "queries": {}, "studio": { "label": "Default" } } },
      "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"
    },
    "p_pdp": {
      "id": "p_pdp", "type": "test/product", "path": { "de": "/produkte/:slug", "fr": "/produits/:slug" }, "queries": {},
      "variants": { "v": { "id": "v", "seo": { "title": {}, "description": {} }, "sections": { "header": [], "body": [], "footer": [] }, "queries": {}, "studio": { "label": "Default" } } },
      "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"
    }
  }
}
```

- [ ] **Step 2: Create the fake page-index registration**

Create `test/fixtures/seo/server/plugins/fakePageIndex.ts`. 25 000 entries, so a `rebuildBatchSize` of 10 000 needs three passes.

```ts
import { defineNitroPlugin, paginate } from '#imports';

const TOTAL = 25_000;
const BATCH = 250;

/** Counts how many upstream pages were fetched, so a test can assert a warm read does none. */
export const stats = { pagesFetched: 0 };

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('orchestr:page-index:register' as never, () => undefined);
  (globalThis as any).__seoFixtureStats = stats;
});

export const fakeList = ({ batchSize, startCursor }: { batchSize: number; startCursor?: string }) =>
  paginate(async ({ cursor }) => {
    stats.pagesFetched++;
    const offset = cursor ? Number(cursor) : 0;
    const size = Math.min(batchSize ?? BATCH, TOTAL - offset);
    const entries = Array.from({ length: Math.max(size, 0) }, (_, i) => ({
      params: { slug: `p${offset + i}` },
      meta: { lastModified: '2026-01-01T00:00:00Z', noindex: offset + i === 0 },
    }));
    const next = offset + size;
    return { entries, nextCursor: next >= TOTAL ? undefined : String(next) };
  }, startCursor);
```

> Register `fakeList` for the `test/product` page type using the orchestr builder the same way the
> shopify and shopware connectors do — `defineX.pageIndex({ for: 'test/product', batchSize: 250, list: fakeList })`
> inside `test/fixtures/seo/server/orchestr/`. Mirror
> `packages/shopware/src/runtime/server/orchestr/product/detail-page.page-index.ts` in the laioutr
> repo for the exact builder call; the fixture only needs `for`, `batchSize` and `list`.

- [ ] **Step 3: Create the fixture Nuxt config and app**

`test/fixtures/seo/nuxt.config.ts`:

```ts
import laioutrrc from './laioutrrc.json';
import SeoModule from '../../../src/module';

export default defineNuxtConfig({
  modules: [SeoModule, '@laioutr-core/frontend-core'],
  laioutr: { laioutrrc: laioutrrc as any },
  '@laioutr/app-essentials-seo': {
    sitemap: { rebuildBatchSize: 10_000, excludePageTypes: [] },
  },
  compatibilityDate: '2025-09-11',
});
```

`test/fixtures/seo/app.vue`:

```vue
<template>
  <div>seo fixture</div>
</template>
```

`test/fixtures/seo/package.json`:

```json
{ "name": "seo-fixture", "private": true, "type": "module" }
```

- [ ] **Step 4: Write the integration test**

Create `test/integration/sitemap.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { beforeAll, describe, expect, it } from 'vitest';

describe('sitemap and robots', async () => {
  await setup({ rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)) });

  const onHost = (path: string, host: string) => $fetch(path, { headers: { host } });

  describe('index filtering', () => {
    it('lists only the locales a host serves', async () => {
      const ch = await onHost('/sitemap_index.xml', 'shop.ch');
      expect(ch).toContain('pages-de');
      expect(ch).toContain('pages-fr');

      const de = await onHost('/sitemap_index.xml', 'shop.de');
      expect(de).toContain('pages-de');
      expect(de).not.toContain('pages-fr');
    });
  });

  describe('configured pages', () => {
    it('emits absolute locs on the requesting host', async () => {
      expect(await onHost('/__sitemap__/pages-de.xml', 'shop.ch')).toContain('<loc>https://shop.ch/</loc>');
      expect(await onHost('/__sitemap__/pages-de.xml', 'shop.de')).toContain('<loc>https://shop.de/</loc>');
    });

    it('omits a page whose default variant is noindex', async () => {
      expect(await onHost('/__sitemap__/pages-de.xml', 'shop.ch')).not.toContain('/intern');
    });

    it('applies the fr path prefix on the multi-locale host', async () => {
      expect(await onHost('/__sitemap__/pages-fr.xml', 'shop.ch')).toContain('https://shop.ch/fr');
    });
  });

  describe('page-index convergence', () => {
    const count = (xml: string) => (xml.match(/<loc>/g) ?? []).length;

    it('accumulates across successive requests and completes', async () => {
      const first = count(await onHost('/__sitemap__/test-product-de.xml', 'shop.ch'));
      expect(first).toBe(9_999); // one entry is flagged noindex

      // Each request advances the accumulation in the background; poll until it stops growing.
      let latest = first;
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const next = count(await onHost('/__sitemap__/test-product-de.xml', 'shop.ch'));
        if (next === latest && next > first) break;
        latest = next;
      }
      expect(latest).toBe(24_999);
    }, 60_000);

    it('never emits an unfilled or collapsed path', async () => {
      const xml = await onHost('/__sitemap__/test-product-de.xml', 'shop.ch');
      expect(xml).not.toContain('//</loc>');
      expect(xml).not.toContain(':slug');
    });

    it('emits no hreflang alternates for enumerated pages', async () => {
      expect(await onHost('/__sitemap__/test-product-de.xml', 'shop.ch')).not.toContain('xhtml:link');
    });
  });

  describe('robots.txt', () => {
    it('points at this hosts sitemap index and blocks internals', async () => {
      const txt = await onHost('/robots.txt', 'shop.ch');
      expect(txt).toContain('Sitemap: https://shop.ch/sitemap_index.xml');
      expect(txt).toContain('Disallow: /api/');
      expect(txt).toContain('Disallow: /_laioutr/');
    });

    it('resolves the sitemap line against the requesting host', async () => {
      expect(await onHost('/robots.txt', 'shop.de')).toContain('Sitemap: https://shop.de/sitemap_index.xml');
    });
  });
});
```

- [ ] **Step 5: Delete the superseded template test**

```bash
rm test/basic.test.ts
rm -rf test/fixtures/basic
```

- [ ] **Step 6: Run the whole suite**

Run: `pnpm test`
Expected: PASS. If the convergence test times out, raise its `60_000` budget rather than lowering the assertion — a truncated sitemap is the failure this test exists to catch.

- [ ] **Step 7: Commit**

```bash
git add test/
git commit -m "test: add multi-market fixture and sitemap integration suite"
```

---

### Task 14: Non-production indexability

**Files:**
- Test: `test/integration/indexable.test.ts`
- Modify: none — this verifies Task 5's `site.env` derivation end to end.

**Interfaces:**
- Consumes: `toUpstreamConfig` (Task 5), the fixture (Task 13).

- [ ] **Step 1: Write the failing test**

Create `test/integration/indexable.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('non-production deployments', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)),
    nuxtConfig: { '@laioutr/app-essentials-seo': { environment: 'preview' } } as never,
  });

  it('blocks every crawler', async () => {
    const txt = await $fetch('/robots.txt', { headers: { host: 'shop.ch' } });
    expect(txt).toContain('User-agent: *');
    expect(txt).toContain('Disallow: /');
  });

  it('drops the sitemap reference so nothing is submitted', async () => {
    expect(await $fetch('/robots.txt', { headers: { host: 'shop.ch' } })).not.toContain('Sitemap:');
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run test/integration/indexable.test.ts`
Expected: PASS. If it fails because `environment` did not reach `site.env`, check that `toUpstreamConfig` reads `options.environment` first — that ordering is what the test pins.

- [ ] **Step 3: Run the full suite and lint**

```bash
pnpm lint
pnpm test
pnpm test:types
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add test/integration/indexable.test.ts
git commit -m "test: verify non-production deployments are not indexable"
```

---

### Task 15: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite `README.md`**

Replace the template content. It must cover: what the app provides (`/sitemap_index.xml`, `/__sitemap__/*.xml`, `/robots.txt`); the full `@laioutr/app-essentials-seo` config key with every field from Task 1 and its default; the `essentials-seo:sitemap-source:resolve` hook with a worked example; the upstream hooks another app should use instead (`sitemap:sources`, `sitemap:input`, `sitemap:resolved`, `sitemap:index-resolved`, `robots:config`, `robots:robots-txt`, `site-config:init`); and two operational notes — that `site.url` must stay unset for multi-market projects, and that a page type whose `pageIndex` registration ignores `startCursor` is capped at `rebuildBatchSize` URLs.

Do not reference the design doc.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the sitemap and robots surface"
```

---

## Self-Review

**Spec coverage.** Design §5 → Tasks 1, 5, 6. §6.1 → Task 5. §6.2 → Task 12. §6.3 → Tasks 8, 9. §6.4 → Task 2. §7.1 → Task 5 (robots block). §7.2 → Tasks 5, 14. §7.3 → Task 5 (site block). §8 → Task 9 (hook type) + Task 12 (call site). §9.1 → Tasks 10, 11, 12. §9.2 → Task 5 (`cacheMaxAgeSeconds: 0`) + Task 12 (`sitemap:output`). §9.3 → Tasks 7, 9, 11, 12. §9.4 → Task 9 (`dedupeByLoc`), Task 10 (TTLs). §10 → Tasks 2–11 unit tests, 13–14 integration.

**Two spec items deliberately not implemented here**, both because they are not this repo's code:

- §2.2, removing `installModule('@nuxtjs/robots')` from `frontend-core`. Still shipping in `0.38.1`. Until it lands, both modules install robots; the second `installModule` call is a no-op for Nuxt, but **our** config only lands because Task 6 writes `nuxt.options.robots` before its own install — which runs after frontend-core's. Verify `/robots.txt` content in Task 13 actually reflects our config; if it does not, that PR becomes a hard blocker and the robots tasks must wait for it.
- §11 follow-ups. Out of scope by definition.

**Type consistency check.** `SitemapUrl` is declared once in `alternates.ts` and re-exported from `pageIndexUrls.ts`; Tasks 8–12 all import it from one of those two. `Snapshot`, `stamp`, `snapshotState` are declared in `snapshotStore.ts` and used unchanged in `rebuild.ts` and the plugin. `parseSitemapName` returns `{ token: string | null; locale: string } | null` in Task 3 and is destructured that way in Task 12. `PageTypeSeo` is declared in `configuredPageUrls.ts` and imported by `pageIndexUrls.ts`. `resolveHostContext` returns `HostContext | null` in Task 7 and is null-checked at both call sites in Task 12.

**Registry lifetime.** Task 3's `parseSitemapName` inverts a registry rather than parsing a string, because `ecommerce-product-detail-page-de` gives no way to know where the token ends. The registry is per-process, so the nitro plugin repopulates it from `runtimeConfig[MODULE_NAME].sources` at construction — that loop is in Task 12 Step 1, and Task 3's tests populate it in a `beforeAll` for the same reason. If a future change makes the plugin lazy, that loop must stay eager.

---

Plan complete and saved to `docs/plans/2026-07-30-sitemap-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
