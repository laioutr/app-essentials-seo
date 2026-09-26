# Markdown pages, `/llms.txt` and agent discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a Markdown version of every page (`<path>.md` + `Accept` negotiation), a curated
per-host `/llms.txt`, agent discovery links, and default Content Signals — as an upstream-compatible
subset of `nuxt-ai-ready@2.4.0`.

**Architecture:** Pure, unit-tested modules under `src/runtime/server/lib/` (negotiation, conversion,
headers, llms.txt model and formatter) wired together by one Nitro middleware, one route handler, one
Nitro plugin and one server-only Nuxt plugin. Conversion uses `mdream` exactly as upstream does;
observable output (URLs, frontmatter, `Link` headers, hook names/payloads) mirrors upstream so the
module can later be swapped for `nuxt-ai-ready`. A small change in the laioutr monorepo lets
section/block definitions opt out of Markdown.

**Tech Stack:** Nuxt 3.16 module (`@nuxt/kit`), Nitro/h3 v1, zod v4 (`zod/v4`), Vitest 3,
`@nuxt/test-utils/e2e`, `mdream` 1.7, `@mdream/js` 1.7 (`/negotiate`), `yaml` 2, `@nuxtjs/robots` 5.7.

**Spec:** `docs/plans/2026-09-26-llms-txt-markdown-design.md`

## Global Constraints

- Work on the currently checked-out branch; do not create branches or worktrees.
- Config lives under the module key `@laioutr/app-essentials-seo`, sub-key `aiReady`. Option names mirror upstream `aiReady`.
- Defaults: `enabled: true`, `contentNegotiation: true`, `describedby: true`, `markdownCacheHeaders: { maxAge: 3600, swr: true }`, `llmsTxtCacheSeconds: 600`, `llmsTxt.markdownLinks: true`, `llmsTxt.notes: []`, `llmsTxt.sections: []`, `llmsTxt.pageTypes: {}`.
- Default mdream options: `{ minimal: true, clean: true, filter: { exclude: ['[data-lfc-location="header"]', '[data-lfc-location="footer"]', '[data-markdown-ignore]'] } }`; project `mdreamOptions` merge over it with `defu` (arrays concatenate).
- Opt-out marker is the presence attribute `data-markdown-ignore` (selector `[data-markdown-ignore]`).
- Hook names and payloads, verbatim from upstream: `ai-ready:markdown:source` `{ route, event, source }`, `ai-ready:mdreamConfig` `(options)`, `ai-ready:page:markdown` `{ html, markdown, route, title, description, isPrerender, event }`.
- Content Signals default for the `*` group: `Content-Signal: search=yes, ai-input=yes` and `Content-Usage: search=y, ai-output=y`. Never set `ai-train`.
- Negotiation `Vary` value: `Accept, Sec-Fetch-Dest, User-Agent`. Negotiated redirects are `307` with `Cache-Control: private, no-store`.
- The internal self-fetch forwards host/proto only — never cookies.
- Code comments explain *why*, in present tense, and never reference docs/plans or this plan.
- Module tests: `pnpm vitest run <file>` from the repo root. Integration tests build the fixture app, so they take a minute.

---

## Part A — `@laioutr/app-essentials-seo` (`/Users/sl/src/app-essentials-seo`)

### Task 1: Default Content Signals, on a robots version that renders them

The lockfile resolves `@nuxtjs/robots@5.5.6`, which renders `Content-Usage` but never `Content-Signal`
— so the existing `customGroups[].contentSignal` option currently emits nothing. 5.7.1 renders both
and still declares `compatibility.nuxt: ">=3.6.1"`.

**Files:**
- Modify: `package.json` (dependency bump)
- Modify: `src/types.ts` (`contentPreferenceSchema`, `RobotsOptionsSchema`)
- Modify: `src/runtime/shared/toUpstreamConfig.ts` (return `robotsWildcard`)
- Modify: `src/upstreamConfig.ts` (`mergeDerivedRobots` applies wildcard preferences)
- Modify: `src/module.ts:46` (pass `robotsWildcard` into the hook)
- Test: `test/unit/types.test.ts`, `test/unit/upstreamConfig.test.ts`, `test/integration/sitemap.test.ts`, `test/integration/indexable.test.ts`

**Interfaces:**
- Produces: `ResolvedOptions['robots']['contentSignal' | 'contentUsage']`; `toUpstreamConfig(...).robotsWildcard: { contentUsage: unknown; contentSignal: unknown }`; `mergeDerivedRobots(config, derived & { wildcard?: { contentUsage: unknown; contentSignal: unknown } })`.

- [ ] **Step 1: Bump robots**

Run: `pnpm add @nuxtjs/robots@^5.7.1`
Expected: `package.json` shows `"@nuxtjs/robots": "^5.7.1"`; `pnpm-lock.yaml` resolves 5.7.x.

- [ ] **Step 2: Write the failing unit tests**

Append to `test/unit/types.test.ts`:

```ts
describe('resolveOptions — wildcard content preferences', () => {
  it('states search and AI-answer use by default, and leaves training unstated', () => {
    const { robots } = resolveOptions(undefined);
    expect(robots.contentSignal).toEqual(['search=yes, ai-input=yes']);
    expect(robots.contentUsage).toEqual(['search=y, ai-output=y']);
  });

  it('lets a project clear them', () => {
    const { robots } = resolveOptions({ robots: { contentSignal: [], contentUsage: [] } });
    expect(robots.contentSignal).toEqual([]);
    expect(robots.contentUsage).toEqual([]);
  });

  it('rejects an unknown category', () => {
    expect(() => resolveOptions({ robots: { contentSignal: ['ai-trian=no'] } })).toThrow();
  });
});
```

Append inside `describe('mergeDerivedRobots', …)` in `test/unit/upstreamConfig.test.ts`:

```ts
  const wildcard = { contentSignal: ['search=yes, ai-input=yes'], contentUsage: ['search=y, ai-output=y'] };

  it('puts the default content preferences on the wildcard group', () => {
    const config = upstreamOnly();
    mergeDerivedRobots(config, { ...derived(), wildcard });
    expect(config.groups[0]).toMatchObject(wildcard);
  });

  it('keeps preferences a project already set on the wildcard group', () => {
    const config: any = { sitemap: [], groups: [{ userAgent: ['*'], disallow: [''], contentSignal: ['ai-train=no'] }] };
    mergeDerivedRobots(config, { ...derived(), wildcard });
    expect(config.groups[0].contentSignal).toEqual(['ai-train=no']);
    expect(config.groups[0].contentUsage).toEqual(['search=y, ai-output=y']);
  });

  it('adds nothing when the project cleared the defaults', () => {
    const config = upstreamOnly();
    mergeDerivedRobots(config, { ...derived(), wildcard: { contentSignal: [], contentUsage: [] } });
    expect(config.groups[0].contentSignal).toBeUndefined();
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run test/unit/types.test.ts test/unit/upstreamConfig.test.ts`
Expected: FAIL — `robots.contentSignal` is `undefined`; wildcard group has no `contentSignal`.

- [ ] **Step 4: Implement**

In `src/types.ts`, give `contentPreferenceSchema` a default parameter:

```ts
const contentPreferenceSchema = <Shape extends z.ZodRawShape>(
  preferences: z.ZodObject<Shape>,
  values: readonly string[],
  fallback: string[] = []
) => z.union([z.array(contentRuleSchema(Object.keys(preferences.shape), values)), preferences]).default(fallback);
```

Add to `RobotsOptionsSchema` (after `localizeRules`):

```ts
  /**
   * `Content-Usage` for the `*` group. Defaults to allowing search and AI answers. Training is left
   * unstated: allowing or reserving it is the site owner's legal decision, and "no preference" is
   * the only answer this module can give on their behalf. `[]` emits none.
   */
  contentUsage: contentPreferenceSchema(ContentUsagePreferencesSchema, CONTENT_USAGE_VALUES, ['search=y, ai-output=y']),
  /** `Content-Signal` for the `*` group. Same defaults, other vocabulary. */
  contentSignal: contentPreferenceSchema(ContentSignalPreferencesSchema, CONTENT_SIGNAL_VALUES, ['search=yes, ai-input=yes']),
```

In `src/runtime/shared/toUpstreamConfig.ts`, add to the returned object (next to `robots`):

```ts
    // Kept off `robots` because that object is written to `nuxt.options.robots`, where these are not
    // top-level options; they reach the `*` group through the `robots:config` hook instead.
    robotsWildcard: {
      contentUsage: options.robots.contentUsage,
      contentSignal: options.robots.contentSignal,
    },
```

In `src/upstreamConfig.ts`, extend `UpstreamRobotsGroup`:

```ts
interface UpstreamRobotsGroup {
  userAgent?: string | string[];
  disallow?: string | string[];
  contentUsage?: unknown;
  contentSignal?: unknown;
}
```

Change the `mergeDerivedRobots` signature and add, right after the `if (wildcardGroup) { … }` block:

```ts
export const mergeDerivedRobots = (
  config: UpstreamRobotsConfig,
  derived: {
    sitemap: string[];
    disallow: string[];
    groups: UpstreamRobotsGroup[];
    wildcard?: { contentUsage: unknown; contentSignal: unknown };
  }
): void => {
```

```ts
  // A value already on the group is the project's own, set through raw robots config, and wins.
  const isUnset = (value: unknown) => value === undefined || (Array.isArray(value) && value.length === 0);
  if (wildcardGroup && derived.wildcard) {
    for (const key of ['contentUsage', 'contentSignal'] as const) {
      const ours = derived.wildcard[key];
      if (isUnset(wildcardGroup[key]) && !isUnset(ours)) wildcardGroup[key] = ours;
    }
  }
```

In `src/module.ts`, change the hook line to:

```ts
    nuxt.hook('robots:config', (config) => mergeDerivedRobots(config, { ...derived.robots, wildcard: derived.robotsWildcard }));
```

- [ ] **Step 5: Run unit tests to verify they pass**

Run: `pnpm vitest run test/unit`
Expected: PASS (all unit files — `ROBOTS_CURATED_KEYS` now also strips the two new keys from app config, which is intended).

- [ ] **Step 6: Add integration assertions**

In `test/integration/sitemap.test.ts`, add inside the top-level `describe`:

```ts
  describe('content preferences', () => {
    it('states the default Content-Signal and Content-Usage on the wildcard group', async () => {
      const txt = await onHost('/robots.txt', 'shop.ch');
      expect(txt).toContain('User-agent: *');
      expect(txt).toContain('Content-Signal: search=yes, ai-input=yes');
      expect(txt).toContain('Content-Usage: search=y, ai-output=y');
      expect(txt).not.toContain('ai-train');
    });
  });
```

In `test/integration/indexable.test.ts`, add:

```ts
  it('states no content preferences while indexing is disabled', () => {
    expect(txt).toContain('User-agent: *'); // guard, as above
    expect(txt).not.toContain('Content-Signal');
  });
```

- [ ] **Step 7: Run integration tests**

Run: `pnpm vitest run test/integration/sitemap.test.ts test/integration/indexable.test.ts`
Expected: PASS. If `Content-Signal` is missing while `Content-Usage` is present, the lockfile still resolves robots < 5.7 — re-run Step 1.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml src/types.ts src/runtime/shared/toUpstreamConfig.ts src/upstreamConfig.ts src/module.ts test/unit/types.test.ts test/unit/upstreamConfig.test.ts test/integration/sitemap.test.ts test/integration/indexable.test.ts
git commit -m "feat: state default Content-Signal and Content-Usage for the wildcard group"
```

---

### Task 2: `aiReady` options

**Files:**
- Modify: `src/types.ts`
- Modify: `src/module.ts` (public runtime config slice)
- Test: `test/unit/types.test.ts`

**Interfaces:**
- Produces: `AiReadyOptionsSchema`; `ResolvedOptions['aiReady']` with shape
  `{ enabled: boolean; contentNegotiation: boolean; describedby: boolean; mdreamOptions: Record<string, unknown>; markdownCacheHeaders: false | { maxAge: number; swr: boolean }; llmsTxtCacheSeconds: number; llmsTxt: { markdownLinks: boolean; notes: string | string[]; sections: LlmsTxtSectionOption[]; pageTypes: Record<string, false | { title?: string; description?: string }> } }`;
  exported types `LlmsTxtSectionOption = { title: string; description?: string | string[]; links: Array<{ title: string; href: string; description?: string }>; optional: boolean }`.
  Public runtime config `runtimeConfig.public['@laioutr/app-essentials-seo'].aiReady = { enabled, describedby }`.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/types.test.ts`:

```ts
describe('resolveOptions — aiReady', () => {
  it('fills upstream-shaped defaults', () => {
    const { aiReady } = resolveOptions(undefined);
    expect(aiReady).toEqual({
      enabled: true,
      contentNegotiation: true,
      describedby: true,
      mdreamOptions: {},
      markdownCacheHeaders: { maxAge: 3600, swr: true },
      llmsTxtCacheSeconds: 600,
      llmsTxt: { markdownLinks: true, notes: [], sections: [], pageTypes: {} },
    });
  });

  it('accepts authored sections and page-type overrides', () => {
    const { aiReady } = resolveOptions({
      aiReady: {
        llmsTxt: {
          notes: 'Prices include VAT.',
          sections: [{ title: 'Help', links: [{ title: 'FAQ', href: '/faq' }] }],
          pageTypes: { 'blog/post-single': false, 'ecommerce/product-detail-page': { title: 'Products' } },
        },
      },
    });
    expect(aiReady.llmsTxt.sections[0]).toEqual({ title: 'Help', links: [{ title: 'FAQ', href: '/faq' }], optional: false });
    expect(aiReady.llmsTxt.pageTypes['blog/post-single']).toBe(false);
  });

  it('lets markdown cache headers be switched off', () => {
    expect(resolveOptions({ aiReady: { markdownCacheHeaders: false } }).aiReady.markdownCacheHeaders).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run test/unit/types.test.ts`
Expected: FAIL — `aiReady` is `undefined`.

- [ ] **Step 3: Implement**

In `src/types.ts`, before `ModuleOptionsSchema`:

```ts
const LlmsTxtLinkSchema = z.object({
  title: z.string(),
  href: z.string(),
  description: z.string().optional(),
});

const LlmsTxtSectionSchema = z.object({
  title: z.string(),
  description: z.union([z.string(), z.array(z.string())]).optional(),
  links: z.array(LlmsTxtLinkSchema).default([]),
  /** Rendered under `## Optional`, which the llms.txt proposal marks as skippable. */
  optional: z.boolean().default(false),
});

export type LlmsTxtSectionOption = z.output<typeof LlmsTxtSectionSchema>;

/**
 * Mirrors nuxt-ai-ready's `aiReady` options, so the resolved value can be handed to that module
 * unchanged once frontends run Nuxt 4. `llmsTxt.pageTypes` is this module's own addition.
 */
export const AiReadyOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Redirect requests that prefer Markdown (by `Accept` or a known AI agent) to the `.md` URL. */
  contentNegotiation: z.boolean().default(true),
  /** Advertise `/llms.txt` as `rel="describedby"` in the page head and `Link` headers. */
  describedby: z.boolean().default(true),
  /** Merged over this module's defaults; see `DEFAULT_MDREAM_OPTIONS`. */
  mdreamOptions: z.record(z.string(), z.unknown()).default({}),
  markdownCacheHeaders: z
    .union([z.literal(false), z.object({ maxAge: z.number().int().min(0).default(3600), swr: z.boolean().default(true) })])
    .prefault({}),
  llmsTxtCacheSeconds: z.number().int().min(0).default(600),
  llmsTxt: z
    .object({
      /** Link listed pages to their `.md` URL. Upstream defaults to false; every page here has one. */
      markdownLinks: z.boolean().default(true),
      notes: z.union([z.string(), z.array(z.string())]).default([]),
      sections: z.array(LlmsTxtSectionSchema).default([]),
      /** Title/description per dynamic page type in `## Page Types`; `false` leaves the type out. */
      pageTypes: z
        .record(z.string(), z.union([z.literal(false), z.object({ title: z.string().optional(), description: z.string().optional() })]))
        .default({}),
    })
    .prefault({}),
});
```

Add to `ModuleOptionsSchema`:

```ts
  aiReady: AiReadyOptionsSchema.prefault({}),
```

In `src/module.ts`, extend the public config `defu` object:

```ts
    nuxt.options.runtimeConfig.public[MODULE_NAME] = defu(publicConfig, {
      openGraph: options.openGraph,
      siteNameByHost: derived.siteNameByHost,
      siteName: options.siteName,
      // Read by the server-only head plugin, which runs in the app context and so sees only public config.
      aiReady: { enabled: options.aiReady.enabled, describedby: options.aiReady.describedby },
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/module.ts test/unit/types.test.ts
git commit -m "feat: add aiReady options mirroring nuxt-ai-ready"
```

---

### Task 3: Host domain helpers

`/llms.txt` needs every domain a host serves (languages section, default language), and the `.md`
frontmatter needs the domain serving a given path (locale).

**Files:**
- Modify: `src/runtime/server/lib/hostContext.ts`
- Test: `test/unit/hostContext.test.ts`

**Interfaces:**
- Produces:
  - `resolveHostDomains(i18nConfig: RenderI18nConfig, host: string): { market: RenderMarket; domains: RenderMarketDomain[] }` — `domains[0]` is the domain a bare request lands on.
  - `domainForPath(domains: RenderMarketDomain[], path: string): RenderMarketDomain | undefined`
  - `resolveHostContext` keeps its signature and behaviour.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/hostContext.test.ts` (it already imports from `../../src/runtime/server/lib/hostContext`; add `resolveHostDomains, domainForPath` to that import):

```ts
describe('resolveHostDomains', () => {
  const de = { code: 'de', localeChain: ['de'] };
  const fr = { code: 'fr', localeChain: ['fr'] };
  const chDe = { id: 'd1', host: 'shop.ch', devHost: 'shop-ch.local', language: de };
  const chFr = { id: 'd2', host: 'shop.ch', path: '/fr', devHost: 'shop-ch.local', language: fr };
  const ch = { id: 'mkt_ch', domains: [chFr, chDe], defaultDomain: chDe };
  const i18n = { hostToMarket: { 'shop.ch': ch }, defaultMarket: ch } as never;

  it('puts the market default domain first', () => {
    expect(resolveHostDomains(i18n, 'shop.ch').domains).toEqual([chDe, chFr]);
  });

  it('tolerates a www. spelling and a port', () => {
    expect(resolveHostDomains(i18n, 'www.shop.ch:3000').market).toBe(ch);
  });

  it('picks the longest matching path prefix, else the root domain', () => {
    const { domains } = resolveHostDomains(i18n, 'shop.ch');
    expect(domainForPath(domains, '/fr/produits/a')).toBe(chFr);
    expect(domainForPath(domains, '/fr')).toBe(chFr);
    expect(domainForPath(domains, '/france')).toBe(chDe);
    expect(domainForPath(domains, '/')).toBe(chDe);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/unit/hostContext.test.ts`
Expected: FAIL — `resolveHostDomains is not a function`.

- [ ] **Step 3: Implement**

Replace `resolveHostContext` in `src/runtime/server/lib/hostContext.ts` with:

```ts
/**
 * The market a request host resolves to, and the domains it serves on that host — the one a request
 * to the bare host lands on first. An unknown host resolves to the default market, matching how the
 * frontend treats localhost and unrecognised hosts.
 */
export const resolveHostDomains = (
  i18nConfig: RenderI18nConfig,
  host: string
): { market: RenderMarket; domains: RenderMarketDomain[] } => {
  // Anchored to the port rather than split on the first colon, which would truncate a bracketed
  // IPv6 authority to "[".
  const bareHost = host.replace(/:\d+$/, '');
  // A project configures one spelling of its host and serves both, so matching only the literal one
  // sends a `www.` request to the default market — and this file would then carry that market's
  // paths under this host. Both lookups below tolerate the prefix, as request routing does.
  const wwwAlt = bareHost.startsWith('www.') ? bareHost.slice(4) : `www.${bareHost}`;
  const market = i18nConfig.hostToMarket[bareHost] ?? i18nConfig.hostToMarket[wwwAlt] ?? i18nConfig.defaultMarket;

  const onThisHost = market.domains.filter(
    (domain) => domain.host === bareHost || domain.host === wwwAlt || domain.devHost === bareHost
  );
  const candidates = onThisHost.length > 0 ? onThisHost : market.domains;
  const primary =
    candidates.find((domain) => domain.id === market.defaultDomain?.id) ?? candidates.find((domain) => !domain.path) ?? candidates[0];
  return { market, domains: primary ? [primary, ...candidates.filter((domain) => domain !== primary)] : [] };
};

/**
 * Maps a request host and a locale onto the market domain that serves them. Returns null when the
 * host serves no domain for that locale, which the caller turns into an empty sitemap rather than
 * guessing another market's URLs.
 *
 * Preview deployments are kept out of the index by site config, not by an empty sitemap.
 */
export const resolveHostContext = (i18nConfig: RenderI18nConfig, host: string, locale: string): HostContext | null => {
  const { market, domains } = resolveHostDomains(i18nConfig, host);
  const domain = domains.find((candidate) => candidate.language.code === locale);
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

/** The domain serving `path` on one host: the longest matching path prefix, else the host root. */
export const domainForPath = (domains: RenderMarketDomain[], path: string): RenderMarketDomain | undefined => {
  const prefixed = domains
    .filter((domain) => domain.path)
    .map((domain) => ({ domain, prefix: domain.path!.replace(/\/+$/, '') }))
    .filter(({ prefix }) => path === prefix || path.startsWith(`${prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return prefixed[0]?.domain ?? domains.find((domain) => !domain.path) ?? domains[0];
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/unit/hostContext.test.ts`
Expected: PASS, including the pre-existing `resolveHostContext` cases.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/lib/hostContext.ts test/unit/hostContext.test.ts
git commit -m "refactor: expose the domains a host serves and the domain serving a path"
```

---

### Task 4: Markdown paths and the negotiation decision

**Files:**
- Create: `src/runtime/shared/markdownPath.ts`
- Create: `src/runtime/server/lib/negotiation.ts`
- Test: `test/unit/markdownPath.test.ts`, `test/unit/negotiation.test.ts`

**Interfaces:**
- Produces (`markdownPath.ts`): `isReservedPath(path: string): boolean`, `normalizePagePath(path: string): string`, `toMarkdownPath(path: string): string`, `fromMarkdownPath(path: string): string`, `markdownAlternatePath(path: string): string | null`.
- Produces (`negotiation.ts`): `INTERNAL_HEADER = 'x-essentials-seo-internal'`, `NEGOTIATION_VARY`, type `NegotiationDecision`, `decideNegotiation(request: { path: string; headers: Record<string, string | undefined>; contentNegotiation: boolean }): NegotiationDecision`, `contentNegotiationFor(enabled: boolean, routeRule: { isr?: unknown; cache?: unknown }): boolean`, `resolveMarkdownRedirect(location: string, options: { pageUrl: string; origins: string[] }): { kind: 'follow'; path: string } | { kind: 'redirect'; location: string }`.

- [ ] **Step 1: Write the failing tests**

`test/unit/markdownPath.test.ts`:

```ts
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
```

`test/unit/negotiation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { contentNegotiationFor, decideNegotiation, INTERNAL_HEADER, resolveMarkdownRedirect } from '../../src/runtime/server/lib/negotiation';

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

  it('answers 406 when nothing acceptable was asked for', () => {
    expect(decide('/about', { accept: 'application/pdf' })).toEqual({ kind: 'not-acceptable' });
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
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/unit/markdownPath.test.ts test/unit/negotiation.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Add the dependencies**

Run: `pnpm add mdream@^1.7.2 @mdream/js@^1.7.2 yaml@^2.9.1`

- [ ] **Step 4: Implement `src/runtime/shared/markdownPath.ts`**

```ts
/** Paths that are never pages: API routes, anything underscore-prefixed (Nitro and module internals), dev-server routes. */
const RESERVED_PATH = /^\/(?:api(?:\/|$)|_|@(?:id|fs|vite|react-refresh)(?:\/|$))/;

export const isReservedPath = (path: string): boolean => RESERVED_PATH.test(path);

export const normalizePagePath = (path: string): string => path.replace(/\/+$/, '') || '/';

/** `/` → `/index.md`, `/about/` → `/about.md`. */
export const toMarkdownPath = (path: string): string => {
  const normalized = normalizePagePath(path);
  return normalized === '/' ? '/index.md' : `${normalized}.md`;
};

/** Inverse of `toMarkdownPath`, also accepting an explicit `/index.md` under a prefix. */
export const fromMarkdownPath = (path: string): string => {
  const stripped = path.slice(0, -'.md'.length);
  return stripped.endsWith('/index') ? stripped.slice(0, -'/index'.length) || '/' : stripped;
};

/** The `.md` twin a page advertises, or null for anything that is not a page. */
export const markdownAlternatePath = (path: string): string | null => {
  if (isReservedPath(path)) return null;
  const lastSegment = normalizePagePath(path).split('/').pop() ?? '';
  if (lastSegment.includes('.')) return null;
  return toMarkdownPath(path);
};
```

- [ ] **Step 5: Implement `src/runtime/server/lib/negotiation.ts`**

```ts
import { negotiateContent } from '@mdream/js/negotiate';
import { getBotInfo } from '@nuxtjs/robots/util';
import { fromMarkdownPath, isReservedPath, markdownAlternatePath, toMarkdownPath } from '../../shared/markdownPath';

/** Marks the middleware's own fetch of a page's HTML, so that request is never negotiated again. */
export const INTERNAL_HEADER = 'x-essentials-seo-internal';

export const NEGOTIATION_VARY = 'Accept, Sec-Fetch-Dest, User-Agent';

export type NegotiationDecision =
  | { kind: 'skip' }
  | { kind: 'not-acceptable' }
  | { kind: 'render'; path: string }
  | { kind: 'redirect'; path: string }
  | { kind: 'html'; path: string; negotiated: boolean };

const SKIP: NegotiationDecision = { kind: 'skip' };

// A JSON or event-stream client asking for nothing page-like is an API caller that happened to hit a page route.
const API_ACCEPT = /\b(?:application\/json|text\/event-stream)\b/i;
const PAGE_ACCEPT = /text\/(?:html|markdown|plain)\b|\*\/\*/i;

const negotiateRepresentation = (headers: Record<string, string | undefined>) => {
  const accept = headers.accept;
  const secFetchDest = headers['sec-fetch-dest'];
  if (negotiateContent(accept) === 'markdown') return 'markdown';
  if (secFetchDest === 'document') return 'html';
  if (getBotInfo(headers)?.category === 'ai') return 'markdown';
  return negotiateContent(accept, secFetchDest);
};

export const decideNegotiation = (request: {
  path: string;
  headers: Record<string, string | undefined>;
  contentNegotiation: boolean;
}): NegotiationDecision => {
  const queryIndex = request.path.indexOf('?');
  const path = queryIndex === -1 ? request.path : request.path.slice(0, queryIndex);
  if (path.startsWith('/.well-known/')) return SKIP;
  if (request.headers[INTERNAL_HEADER]) return SKIP;

  const isExplicit = path.endsWith('.md');
  const pagePath = isExplicit ? fromMarkdownPath(path) : path;
  if (isReservedPath(pagePath)) return SKIP;

  const accept = request.headers.accept ?? '';
  if (!isExplicit && accept && API_ACCEPT.test(accept) && !PAGE_ACCEPT.test(accept)) return SKIP;

  const lastSegment = path.split('/').pop() ?? '';
  if (!isExplicit && lastSegment.includes('.')) return SKIP;

  if (isExplicit) return { kind: 'render', path: pagePath };
  if (!request.contentNegotiation) return { kind: 'html', path, negotiated: false };

  const representation = negotiateRepresentation(request.headers);
  if (representation === 'not-acceptable') return { kind: 'not-acceptable' };
  if (representation === 'markdown') return { kind: 'redirect', path };
  return { kind: 'html', path, negotiated: true };
};

const NEGOTIATION_HEADERS = NEGOTIATION_VARY.split(',').map((header) => header.trim().toLowerCase());

/**
 * A route cached without varying on the negotiation headers would hand one client's representation to
 * every other, so negotiation is off there.
 */
export const contentNegotiationFor = (enabled: boolean, routeRule: { isr?: unknown; cache?: unknown }): boolean => {
  if (!enabled) return false;
  if (routeRule.isr) return false;
  const cache = routeRule.cache as { headersOnly?: boolean; varies?: string[] } | boolean | undefined;
  if (!cache) return true;
  if (typeof cache !== 'object') return false;
  if (cache.headersOnly) return true;
  const varies = new Set(cache.varies?.map((header) => header.toLowerCase()));
  return NEGOTIATION_HEADERS.every((header) => varies.has(header));
};

const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/**
 * A page's HTML answered with a redirect. One that lands on the same Markdown twin (a trailing-slash
 * normalisation) is followed; one to another page sends the client to that page's twin; anything
 * else — another origin, a file — is passed on as it is.
 */
export const resolveMarkdownRedirect = (
  location: string,
  { pageUrl, origins }: { pageUrl: string; origins: string[] }
): { kind: 'follow'; path: string } | { kind: 'redirect'; location: string } => {
  const page = new URL(pageUrl);
  const target = URL.canParse(location, page) ? new URL(location, page) : null;
  if (!target || (target.origin !== page.origin && !origins.includes(target.origin))) return { kind: 'redirect', location };

  const markdownPath = markdownAlternatePath(target.pathname);
  if (!markdownPath) return { kind: 'redirect', location };
  if (markdownPath === toMarkdownPath(page.pathname)) return { kind: 'follow', path: `${target.pathname}${target.search}` };

  const markdownLocation = `${markdownPath}${target.search}${target.hash}`;
  return { kind: 'redirect', location: ABSOLUTE_URL.test(location) ? `${target.origin}${markdownLocation}` : markdownLocation };
};
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm vitest run test/unit/markdownPath.test.ts test/unit/negotiation.test.ts`
Expected: PASS. If the GPTBot case fails, print `getBotInfo({ 'user-agent': … })` and use a user-agent string the installed `@nuxtjs/robots` classifies as `category: 'ai'` — the assertion is about the AI category, not the exact string.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/runtime/shared/markdownPath.ts src/runtime/server/lib/negotiation.ts test/unit/markdownPath.test.ts test/unit/negotiation.test.ts
git commit -m "feat: decide between HTML and Markdown per request"
```

---

### Task 5: HTML metadata, structured data, frontmatter and `Link` headers

**Files:**
- Create: `src/runtime/server/lib/htmlMeta.ts`
- Create: `src/runtime/server/lib/structuredData.ts`
- Create: `src/runtime/server/lib/frontmatter.ts`
- Create: `src/runtime/server/lib/linkHeader.ts`
- Test: `test/unit/htmlMeta.test.ts`, `test/unit/structuredData.test.ts`, `test/unit/frontmatter.test.ts`, `test/unit/linkHeader.test.ts`

**Interfaces:**
- Consumes: `toMarkdownPath` (Task 4).
- Produces:
  - `extractMetaRobots(html: string): string | undefined`, `extractLastUpdated(html: string): string | undefined`
  - `extractJsonLd(html: string): string[]`, `appendStructuredData(markdown: string, html: string): string`
  - `FrontmatterFields = { title?: string; description?: string; canonical_url?: string; last_updated?: string; locale?: string }`, `buildFrontmatter(fields): string`, `layerFrontmatter(fields, markdown: string): string`, `notFoundMarkdown(input: { path: string; canonicalUrl: string; resolveUrl: (path: string) => string; locale?: string }): string`
  - `buildLinkHeader(input: { path: string; variant: 'html' | 'markdown'; describedby: boolean; resolveUrl: (path: string) => string }): string`

- [ ] **Step 1: Write the failing tests**

`test/unit/htmlMeta.test.ts`:

```ts
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
```

`test/unit/structuredData.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { appendStructuredData, extractJsonLd } from '../../src/runtime/server/lib/structuredData';

const html = `<head><script type="application/ld+json">{"@type":"BreadcrumbList"}</script></head>
<body><script type='application/ld+json' data-x>{"@type":"Product","name":"Shoe"}</script><script>var x</script>
<script type="application/ld+json">{ not json </script></body>`;

describe('structured data', () => {
  it('collects every JSON-LD script from head and body', () => {
    expect(extractJsonLd(html)).toEqual(['{"@type":"BreadcrumbList"}', '{"@type":"Product","name":"Shoe"}', '{ not json']);
  });

  it('appends each block pretty-printed, and invalid JSON verbatim', () => {
    expect(appendStructuredData('# Shoe\n', html)).toBe(
      [
        '# Shoe',
        '',
        '## Structured Data',
        '',
        '```json\n{\n  "@type": "BreadcrumbList"\n}\n```',
        '',
        '```json\n{\n  "@type": "Product",\n  "name": "Shoe"\n}\n```',
        '',
        '```json\n{ not json\n```',
        '',
      ].join('\n')
    );
  });

  it('leaves Markdown alone when there is none', () => {
    expect(appendStructuredData('# Shoe\n', '<p>x</p>')).toBe('# Shoe\n');
  });
});
```

`test/unit/frontmatter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildFrontmatter, layerFrontmatter, notFoundMarkdown } from '../../src/runtime/server/lib/frontmatter';

describe('frontmatter', () => {
  it('writes the upstream keys in upstream order, escaping quotes', () => {
    expect(buildFrontmatter({ title: 'A "B"', canonical_url: 'https://shop.ch/a', locale: 'de' })).toBe(
      '---\ntitle: "A \\"B\\""\ncanonical_url: "https://shop.ch/a"\nlocale: "de"\n---\n'
    );
  });

  it('layers fields over existing frontmatter', () => {
    expect(layerFrontmatter({ canonical_url: 'https://shop.ch/a' }, '---\ntitle: x\n---\n\nBody')).toBe(
      '---\ntitle: x\ncanonical_url: https://shop.ch/a\n---\n\nBody'
    );
  });

  it('prepends frontmatter when there is none', () => {
    expect(layerFrontmatter({ title: 'T' }, 'Body')).toBe('---\ntitle: "T"\n---\n\nBody');
  });

  it('renders the upstream not-found body', () => {
    const md = notFoundMarkdown({ path: '/x', canonicalUrl: 'https://shop.ch/x', resolveUrl: (p) => `https://shop.ch${p}` });
    expect(md).toContain('# Page not found');
    expect(md).toContain('No content is available at `/x`.');
    expect(md).toContain('- [llms.txt](https://shop.ch/llms.txt)');
  });
});
```

`test/unit/linkHeader.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/unit/htmlMeta.test.ts test/unit/structuredData.test.ts test/unit/frontmatter.test.ts test/unit/linkHeader.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/runtime/server/lib/htmlMeta.ts`**

```ts
const META_TAG = /<meta\b[^>]*>/gi;

// Anchored to whitespace so `data-name="robots"` is not read as `name="robots"`.
const attribute = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2];

const firstMetaContent = (html: string, keys: ReadonlySet<string>): string | undefined => {
  for (const [tag] of html.matchAll(META_TAG)) {
    const key = (attribute(tag, 'name') ?? attribute(tag, 'property'))?.toLowerCase();
    if (!key || !keys.has(key)) continue;
    const content = attribute(tag, 'content');
    if (content) return content;
  }
  return undefined;
};

const ROBOTS_KEYS = new Set(['robots']);
const UPDATED_KEYS = new Set(['article:modified_time', 'og:updated_time', 'last-modified', 'lastmod', 'updated']);

export const extractMetaRobots = (html: string): string | undefined => firstMetaContent(html, ROBOTS_KEYS);

export const extractLastUpdated = (html: string): string | undefined => firstMetaContent(html, UPDATED_KEYS);
```

- [ ] **Step 4: Implement `src/runtime/server/lib/structuredData.ts`**

```ts
const JSON_LD_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

export const extractJsonLd = (html: string): string[] =>
  [...html.matchAll(JSON_LD_SCRIPT)].map((match) => (match[1] ?? '').trim()).filter(Boolean);

// Unparseable content is kept rather than dropped: a malformed block still tells a reader what the page claims.
const prettyPrint = (raw: string): string => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

/**
 * mdream drops every `<script>`, and with it the page's schema.org data — which for a product page is
 * the price and availability an agent came for. Read from the full HTML, so a section opted out of
 * Markdown never takes structured data with it.
 */
export const appendStructuredData = (markdown: string, html: string): string => {
  const blocks = extractJsonLd(html);
  if (blocks.length === 0) return markdown;
  const fenced = blocks.map((block) => `\`\`\`json\n${prettyPrint(block)}\n\`\`\``).join('\n\n');
  return `${markdown.trimEnd()}\n\n## Structured Data\n\n${fenced}\n`;
};
```

- [ ] **Step 5: Implement `src/runtime/server/lib/frontmatter.ts`**

```ts
import { isMap, parseDocument } from 'yaml';

export interface FrontmatterFields {
  title?: string;
  description?: string;
  canonical_url?: string;
  last_updated?: string;
  locale?: string;
}

const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Key order and quoting match nuxt-ai-ready's, so a twin reads the same after the switch. */
export const buildFrontmatter = (fields: FrontmatterFields): string => {
  const lines = ['---'];
  for (const key of ['title', 'description', 'canonical_url', 'last_updated', 'locale'] as const) {
    const value = fields[key];
    if (value) lines.push(`${key}: "${escape(value)}"`);
  }
  lines.push('---', '');
  return lines.join('\n');
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Sets `fields` on Markdown that may already carry frontmatter, keeping its other keys. */
export const layerFrontmatter = (fields: FrontmatterFields, markdown: string): string => {
  const match = FRONTMATTER.exec(markdown);
  const document = match ? parseDocument(match[1] ?? '') : undefined;
  if (!match || !document || document.errors.length > 0 || !isMap(document.contents)) {
    return `${buildFrontmatter(fields)}\n${markdown}`;
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== '') document.set(key, value);
  }
  const body = markdown.slice(match[0].length).replace(/^\r?\n/, '');
  return `---\n${document.toString({ lineWidth: 0 }).trimEnd()}\n---\n\n${body}`;
};

export const notFoundMarkdown = (input: {
  path: string;
  canonicalUrl: string;
  resolveUrl: (path: string) => string;
  locale?: string;
}): string => {
  const frontmatter = buildFrontmatter({
    title: 'Page not found',
    description: `No content is available at ${input.path}.`,
    canonical_url: input.canonicalUrl,
    locale: input.locale,
  });
  const body = [
    '# Page not found',
    '',
    `No content is available at \`${input.path}\`.`,
    '',
    'Try one of these resources:',
    '',
    `- [Sitemap](${input.resolveUrl('/sitemap_index.xml')})`,
    `- [llms.txt](${input.resolveUrl('/llms.txt')})`,
    '',
  ].join('\n');
  return `${frontmatter}\n${body}`;
};
```

- [ ] **Step 6: Implement `src/runtime/server/lib/linkHeader.ts`**

```ts
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
```

- [ ] **Step 7: Run to verify pass**

Run: `pnpm vitest run test/unit/htmlMeta.test.ts test/unit/structuredData.test.ts test/unit/frontmatter.test.ts test/unit/linkHeader.test.ts`
Expected: PASS. If the `layerFrontmatter` quoting assertion differs only in YAML quoting style, adjust the expectation to what `yaml`'s `toString({ lineWidth: 0 })` emits — the layering (keys kept, key added, body preserved) is what the test is about.

- [ ] **Step 8: Commit**

```bash
git add src/runtime/server/lib/htmlMeta.ts src/runtime/server/lib/structuredData.ts src/runtime/server/lib/frontmatter.ts src/runtime/server/lib/linkHeader.ts test/unit/htmlMeta.test.ts test/unit/structuredData.test.ts test/unit/frontmatter.test.ts test/unit/linkHeader.test.ts
git commit -m "feat: add Markdown response helpers for metadata, JSON-LD, frontmatter and Link"
```

---

### Task 6: HTML → Markdown conversion

**Files:**
- Create: `src/runtime/server/lib/convert.ts`
- Create: `src/runtime/types/markdown.ts`
- Test: `test/unit/convert.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_MDREAM_OPTIONS: Partial<MdreamOptions>`; `resolveMdreamOptions(project: Record<string, unknown>): Partial<MdreamOptions>`
  - `convertHtmlToMarkdown(input: { html: string; url: string; route: string; event: H3Event; mdreamOptions: Partial<MdreamOptions>; additionalFrontmatter: Record<string, string>; hooks: { mdreamConfig: (options: Partial<MdreamOptions>) => Promise<void>; pageMarkdown: (ctx: PageMarkdownContext) => Promise<void> } }): Promise<{ markdown: string; title: string; description: string }>`
  - Types in `src/runtime/types/markdown.ts`: `PageMarkdownContext`, `MarkdownSource`, `MarkdownSourceContext`.

- [ ] **Step 1: Write the failing test**

`test/unit/convert.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { convertHtmlToMarkdown, resolveMdreamOptions } from '../../src/runtime/server/lib/convert';

const html = `<html><head><title>Red Shoe</title><meta name="description" content="A red shoe"></head><body><div id="__nuxt">
<div data-lfc-location="header"><a href="/menu">Menu</a> Promo</div>
<div data-lfc-location="body"><h1>Red Shoe</h1><p>Great <a href="/shoes">shoe</a>.</p><span data-markdown-ignore>Only 3 left!</span></div>
<div data-lfc-location="body" data-markdown-ignore>Newsletter signup</div>
<div data-lfc-location="footer">Imprint</div></div></body></html>`;

const run = (hooks = { mdreamConfig: vi.fn(async () => {}), pageMarkdown: vi.fn(async () => {}) }) =>
  convertHtmlToMarkdown({
    html,
    url: 'https://shop.ch/p/red-shoe',
    route: '/p/red-shoe',
    event: {} as never,
    mdreamOptions: resolveMdreamOptions({}),
    additionalFrontmatter: { canonical_url: 'https://shop.ch/p/red-shoe', locale: 'de' },
    hooks,
  });

describe('convertHtmlToMarkdown', () => {
  it('keeps the body and drops header, footer and ignored parts', async () => {
    const { markdown } = await run();
    expect(markdown).toContain('# Red Shoe');
    expect(markdown).toContain('[shoe](https://shop.ch/shoes)');
    for (const gone of ['Menu', 'Promo', 'Imprint', 'Only 3 left', 'Newsletter']) expect(markdown).not.toContain(gone);
  });

  it('writes frontmatter from the head plus the fields passed in', async () => {
    const { markdown, title, description } = await run();
    expect(markdown).toMatch(/^---\n/);
    expect(markdown).toContain('canonical_url: "https://shop.ch/p/red-shoe"');
    expect(title).toBe('Red Shoe');
    expect(description).toBe('A red shoe');
  });

  it('lets hooks adjust options and output', async () => {
    const hooks = {
      mdreamConfig: vi.fn(async (options: any) => {
        options.filter.exclude.push('h1');
      }),
      pageMarkdown: vi.fn(async (ctx: any) => {
        ctx.markdown += '\nappended';
      }),
    };
    const { markdown } = await run(hooks);
    expect(markdown).not.toContain('# Red Shoe');
    expect(markdown.endsWith('appended')).toBe(true);
    expect(hooks.pageMarkdown.mock.calls[0]![0]).toMatchObject({ route: '/p/red-shoe', isPrerender: false, title: 'Red Shoe' });
  });

  it('adds project selectors to the defaults instead of replacing them', () => {
    const exclude = (resolveMdreamOptions({ filter: { exclude: ['.promo'] } }).filter as { exclude: string[] }).exclude;
    expect(exclude).toEqual(['.promo', '[data-lfc-location="header"]', '[data-lfc-location="footer"]', '[data-markdown-ignore]']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/unit/convert.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/runtime/types/markdown.ts`**

```ts
import type { H3Event } from 'h3';

/** Payload of `ai-ready:page:markdown`, identical to nuxt-ai-ready's. */
export interface PageMarkdownContext {
  html: string;
  markdown: string;
  route: string;
  title: string;
  description: string;
  isPrerender: boolean;
  event: H3Event;
}

/** What an `ai-ready:markdown:source` listener supplies to skip rendering the page. */
export interface MarkdownSource {
  markdown: string;
  title?: string;
  description?: string;
  updatedAt?: string;
}

export interface MarkdownSourceContext {
  route: string;
  event: H3Event;
  source: MarkdownSource | null;
}
```

- [ ] **Step 4: Implement `src/runtime/server/lib/convert.ts`**

```ts
import { defu } from 'defu';
import { htmlToMarkdown, type MdreamOptions } from 'mdream';
import type { PageMarkdownContext } from '../../types/markdown';
import type { H3Event } from 'h3';

/**
 * frontend-core renders no `<main>`, so mdream's main-content heuristics would be guessing. Every
 * section root does carry its page region, and header and footer sections repeat on every page.
 */
export const DEFAULT_MDREAM_OPTIONS: Partial<MdreamOptions> = {
  minimal: true,
  clean: true,
  filter: {
    exclude: ['[data-lfc-location="header"]', '[data-lfc-location="footer"]', '[data-markdown-ignore]'],
  },
};

/** `defu` concatenates arrays, so a project's selectors add to ours rather than replace them. */
export const resolveMdreamOptions = (project: Record<string, unknown>): Partial<MdreamOptions> =>
  defu(project, DEFAULT_MDREAM_OPTIONS) as Partial<MdreamOptions>;

const NBSP = / /g;

export const convertHtmlToMarkdown = async (input: {
  html: string;
  url: string;
  route: string;
  event: H3Event;
  mdreamOptions: Partial<MdreamOptions>;
  additionalFrontmatter: Record<string, string>;
  hooks: {
    mdreamConfig: (options: Partial<MdreamOptions>) => Promise<void>;
    pageMarkdown: (ctx: PageMarkdownContext) => Promise<void>;
  };
}): Promise<{ markdown: string; title: string; description: string }> => {
  const meta = { title: '', description: '' };
  // Cloned so a hook that mutates options never leaks into the next request's defaults.
  const options: Partial<MdreamOptions> = {
    origin: new URL(input.url).origin,
    ...structuredClone(input.mdreamOptions),
    frontmatter: {
      additionalFields: input.additionalFrontmatter,
      onExtract: (frontmatter) => {
        if (frontmatter.title) meta.title = frontmatter.title;
        if (frontmatter.description) meta.description = frontmatter.description;
      },
    },
  };
  await input.hooks.mdreamConfig(options);

  const context: PageMarkdownContext = {
    html: input.html,
    markdown: htmlToMarkdown(input.html, options),
    route: input.route,
    title: meta.title,
    description: meta.description,
    isPrerender: false,
    event: input.event,
  };
  await input.hooks.pageMarkdown(context);

  return {
    markdown: context.markdown.replace(NBSP, ' '),
    title: meta.title.replace(NBSP, ' '),
    description: meta.description.replace(NBSP, ' '),
  };
};
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run test/unit/convert.test.ts`
Expected: PASS. If `structuredClone` throws on a project option holding a function (mdream accepts callback-valued `extraction`), replace it with `defu({}, input.mdreamOptions)`, which copies without cloning functions.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/server/lib/convert.ts src/runtime/types/markdown.ts test/unit/convert.test.ts
git commit -m "feat: convert page HTML to Markdown with mdream"
```

---

### Task 7: Markdown middleware, hooks and JSON-LD listener

**Files:**
- Create: `src/runtime/server/lib/markdownPage.ts`
- Create: `src/runtime/server/middleware/markdown.ts`
- Create: `src/runtime/server/nitro/structuredData.ts`
- Modify: `src/runtime/types/hooks.d.ts`
- Modify: `src/module.ts`
- Create fixture routes: `test/fixtures/seo/server/routes/md-fixture/page.get.ts`, `noindex.get.ts`, `data.get.ts`, `gone.get.ts`, `moved.get.ts`
- Test: `test/integration/markdown.test.ts`

**Interfaces:**
- Consumes: Tasks 3–6 (`resolveHostDomains`, `domainForPath`, `decideNegotiation`, `contentNegotiationFor`, `resolveMarkdownRedirect`, `INTERNAL_HEADER`, `NEGOTIATION_VARY`, `toMarkdownPath`, `extractMetaRobots`, `extractLastUpdated`, `layerFrontmatter`, `notFoundMarkdown`, `buildLinkHeader`, `convertHtmlToMarkdown`, `resolveMdreamOptions`, `appendStructuredData`).
- Produces: `renderMarkdownPage(event: H3Event, path: string, aiReady: ResolvedOptions['aiReady'], resolveUrl: (path: string) => string): Promise<unknown>`; the three `ai-ready:*` Nitro runtime hooks, typed.

- [ ] **Step 1: Add fixture routes**

`test/fixtures/seo/server/routes/md-fixture/page.get.ts`:

```ts
import { defineEventHandler, setResponseHeader } from 'h3';

/** Stands in for a frontend-core render: the markup it produces, without the renderer. */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
  return `<!DOCTYPE html><html><head><title>Red Shoe</title>
<meta name="description" content="A red leather shoe">
<meta property="article:modified_time" content="2026-09-01T00:00:00Z">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
</head><body><div id="__nuxt">
<div data-lfc-section="s1" data-lfc-location="header"><a href="/menu">Menu</a> Free shipping</div>
<div data-lfc-section="s2" data-lfc-location="body"><h1>Red Shoe</h1><p>Hand-made in <a href="/about">our workshop</a>.</p><span data-markdown-ignore>Only 3 left!</span></div>
<div data-lfc-section="s3" data-lfc-location="body" data-markdown-ignore>Subscribe to our newsletter</div>
<div data-lfc-section="s4" data-lfc-location="footer">Imprint</div>
</div></body></html>`;
});
```

`noindex.get.ts`:

```ts
import { defineEventHandler, setResponseHeader } from 'h3';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
  return '<!DOCTYPE html><html><head><title>Hidden</title><meta name="robots" content="noindex, follow"></head><body><h1>Hidden</h1></body></html>';
});
```

`data.get.ts`:

```ts
import { defineEventHandler } from 'h3';

export default defineEventHandler(() => ({ not: 'html' }));
```

`gone.get.ts`:

```ts
import { createError, defineEventHandler } from 'h3';

export default defineEventHandler(() => {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' });
});
```

`moved.get.ts`:

```ts
import { defineEventHandler, sendRedirect } from 'h3';

export default defineEventHandler((event) => sendRedirect(event, '/md-fixture/page', 302));
```

- [ ] **Step 2: Write the failing integration test**

`test/integration/markdown.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('markdown twins', async () => {
  await setup({ rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)) });

  // See sitemap.test.ts for why the host travels in x-forwarded-host.
  const hostHeaders = { 'host': 'shop.ch', 'x-forwarded-host': 'shop.ch', 'x-forwarded-proto': 'https' };
  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(path, { headers: { ...hostHeaders, ...headers }, redirect: 'manual' });

  describe('GET <path>.md', () => {
    it('serves the page body as Markdown, without header, footer or ignored parts', async () => {
      const response = await get('/md-fixture/page.md');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/markdown');
      const md = await response.text();
      expect(md).toContain('# Red Shoe');
      expect(md).toContain('[our workshop](https://shop.ch/about)');
      for (const gone of ['Free shipping', 'Imprint', 'Only 3 left', 'newsletter']) expect(md).not.toContain(gone);
    });

    it('writes upstream frontmatter', async () => {
      const md = await (await get('/md-fixture/page.md')).text();
      expect(md).toMatch(/^---\n/);
      expect(md).toContain('title: "Red Shoe"');
      expect(md).toContain('canonical_url: "https://shop.ch/md-fixture/page"');
      expect(md).toContain('last_updated: "2026-09-01T00:00:00Z"');
      expect(md).toMatch(/locale: "?de"?/);
    });

    it('keeps the JSON-LD', async () => {
      const md = await (await get('/md-fixture/page.md')).text();
      expect(md).toContain('## Structured Data');
      expect(md).toContain('"@type": "BreadcrumbList"');
    });

    it('links back to the HTML page as canonical and caches', async () => {
      const response = await get('/md-fixture/page.md');
      expect(response.headers.get('link')).toContain('<https://shop.ch/md-fixture/page>; rel="canonical"');
      expect(response.headers.get('link')).toContain('<https://shop.ch/llms.txt>; rel="describedby"');
      expect(response.headers.get('cache-control')).toBe('public, max-age=3600, stale-while-revalidate=3600');
    });

    it('carries the page robots directive', async () => {
      const response = await get('/md-fixture/noindex.md');
      expect(response.status).toBe(200);
      expect(response.headers.get('x-robots-tag')).toBe('noindex, follow');
      expect((await get('/md-fixture/page.md')).headers.get('x-robots-tag')).toBeNull();
    });

    it('answers a missing or non-HTML page with a Markdown 404', async () => {
      for (const path of ['/md-fixture/gone.md', '/md-fixture/data.md']) {
        const response = await get(path);
        expect(response.status).toBe(404);
        expect(await response.text()).toContain('# Page not found');
      }
    });

    it('sends a redirect to another page on to that page’s twin', async () => {
      const response = await get('/md-fixture/moved.md');
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/md-fixture/page.md');
    });

    it('renders the Nuxt home page', async () => {
      const md = await (await get('/index.md')).text();
      expect(md).toContain('seo fixture');
    });
  });

  describe('negotiation on HTML URLs', () => {
    it('redirects a Markdown-preferring client to the twin, uncached', async () => {
      const response = await get('/md-fixture/page', { accept: 'text/markdown' });
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('/md-fixture/page.md');
      expect(response.headers.get('vary')).toContain('Accept');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    });

    it('serves a browser HTML with a Link to the twin and to llms.txt', async () => {
      const response = await get('/', { 'accept': 'text/html', 'sec-fetch-dest': 'document' });
      expect(response.status).toBe(200);
      const link = response.headers.get('link') ?? '';
      expect(link).toContain('<https://shop.ch/index.md>; rel="alternate"; type="text/markdown"');
      expect(link).toContain('<https://shop.ch/llms.txt>; rel="describedby"');
      expect(response.headers.get('vary')).toContain('User-Agent');
    });

    it('never negotiates a non-GET request', async () => {
      const response = await fetch('/md-fixture/page', { method: 'POST', headers: { ...hostHeaders, accept: 'text/markdown' }, redirect: 'manual' });
      expect(response.status).not.toBe(307);
    });

    it('leaves non-page routes alone', async () => {
      const response = await get('/robots.txt', { accept: 'text/markdown' });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');
    });
  });

  it('is reachable through $fetch too (sanity check for the fixture)', async () => {
    expect(await $fetch<string>('/md-fixture/page', { headers: hostHeaders })).toContain('Red Shoe');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run test/integration/markdown.test.ts`
Expected: FAIL — `/md-fixture/page.md` is not served as Markdown (404 or HTML).

- [ ] **Step 4: Type the hooks**

In `src/runtime/types/hooks.d.ts`, add imports and three entries to `NitroRuntimeHooks`:

```ts
import type { MarkdownSourceContext, PageMarkdownContext } from './markdown';
import type { MdreamOptions } from 'mdream';
```

```ts
    /** Supply a page's Markdown directly by setting `ctx.source`; the page is then not rendered. */
    'ai-ready:markdown:source': (ctx: MarkdownSourceContext) => void | Promise<void>;
    /** Adjust the mdream options for one conversion. Mutate in place. */
    'ai-ready:mdreamConfig': (options: Partial<MdreamOptions>) => void | Promise<void>;
    /** Adjust one page's Markdown after conversion by reassigning `ctx.markdown`. */
    'ai-ready:page:markdown': (ctx: PageMarkdownContext) => void | Promise<void>;
```

Add to `src/module.ts` next to the existing type re-exports:

```ts
export type { MarkdownSource, MarkdownSourceContext, PageMarkdownContext } from './runtime/types/markdown';
```

- [ ] **Step 5: Implement `src/runtime/server/lib/markdownPage.ts`**

```ts
import {
  createError,
  getRequestHost,
  getRequestProtocol,
  getRequestURL,
  type H3Event,
  setResponseHeader,
  setResponseStatus,
} from 'h3';
import { useNitroApp } from '#imports';
import type { ResolvedOptions } from '../../../types';
import { convertHtmlToMarkdown, resolveMdreamOptions } from './convert';
import { layerFrontmatter, notFoundMarkdown } from './frontmatter';
import { domainForPath, resolveHostDomains } from './hostContext';
import { extractLastUpdated, extractMetaRobots } from './htmlMeta';
import { buildLinkHeader } from './linkHeader';
import { INTERNAL_HEADER, resolveMarkdownRedirect } from './negotiation';
import type { MarkdownSourceContext } from '../../types/markdown';
// eslint-disable-next-line import-x/no-unresolved
import { i18nConfig } from '#laioutr/i18n-config';

type AiReady = ResolvedOptions['aiReady'];

/**
 * Host and protocol only. A twin is an anonymous render: forwarding cookies would put one visitor's
 * session into a response that is then cached for everyone.
 */
const forwardedHeaders = (event: H3Event): Record<string, string> => {
  const host = getRequestHost(event, { xForwardedHost: true });
  return {
    'accept': 'text/html',
    host,
    'x-forwarded-host': host,
    'x-forwarded-proto': getRequestProtocol(event, { xForwardedProto: true }),
    [INTERNAL_HEADER]: '1',
  };
};

export const renderMarkdownPage = async (
  event: H3Event,
  path: string,
  aiReady: AiReady,
  resolveUrl: (path: string) => string
): Promise<unknown> => {
  const nitroApp = useNitroApp();
  const canonicalUrl = resolveUrl(path);
  const host = getRequestHost(event, { xForwardedHost: true });
  const locale = domainForPath(resolveHostDomains(i18nConfig, host).domains, path)?.language.code;

  const respond = (markdown: string, status = 200) => {
    setResponseStatus(event, status);
    setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8');
    setResponseHeader(event, 'link', buildLinkHeader({ path, variant: 'markdown', describedby: aiReady.describedby, resolveUrl }));
    if (aiReady.markdownCacheHeaders) {
      const { maxAge, swr } = aiReady.markdownCacheHeaders;
      setResponseHeader(event, 'cache-control', swr ? `public, max-age=${maxAge}, stale-while-revalidate=${maxAge}` : `public, max-age=${maxAge}`);
    }
    return markdown;
  };

  const sourceContext: MarkdownSourceContext = { route: path, event, source: null };
  await nitroApp.hooks.callHook('ai-ready:markdown:source', sourceContext);
  if (sourceContext.source) {
    const { markdown, title, description, updatedAt } = sourceContext.source;
    return respond(layerFrontmatter({ title: title ?? path, description, canonical_url: canonicalUrl, last_updated: updatedAt, locale }, markdown));
  }

  const origins = [getRequestURL(event).origin];
  let htmlPath = path;
  let response: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await nitroApp.localFetch(htmlPath, { headers: forwardedHeaders(event), redirect: 'manual' }).catch(() => null);
    const location = response && response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!response || !location) break;
    const redirect = resolveMarkdownRedirect(location, { pageUrl: canonicalUrl, origins });
    if (redirect.kind === 'follow' && attempt === 0) {
      htmlPath = redirect.path;
      continue;
    }
    setResponseStatus(event, response.status);
    setResponseHeader(event, 'location', redirect.kind === 'redirect' ? redirect.location : location);
    return '';
  }

  if (!response) throw createError({ statusCode: 502, statusMessage: 'Bad Gateway' });
  if (!response.ok && response.status !== 404) return response;
  const isHtml = (response.headers.get('content-type') ?? '').includes('text/html');
  if (response.status === 404 || !isHtml) return respond(notFoundMarkdown({ path, canonicalUrl, resolveUrl, locale }), 404);

  const html = await response.text();
  const lastUpdated = extractLastUpdated(html);
  const { markdown } = await convertHtmlToMarkdown({
    html,
    url: canonicalUrl,
    route: path,
    event,
    mdreamOptions: resolveMdreamOptions(aiReady.mdreamOptions),
    additionalFrontmatter: {
      canonical_url: canonicalUrl,
      ...(lastUpdated ? { last_updated: lastUpdated } : {}),
      ...(locale ? { locale } : {}),
    },
    hooks: {
      mdreamConfig: (options) => nitroApp.hooks.callHook('ai-ready:mdreamConfig', options),
      pageMarkdown: (ctx) => nitroApp.hooks.callHook('ai-ready:page:markdown', ctx),
    },
  });

  // The page's own robots meta has no `<head>` to live in here, so it travels as a header instead —
  // otherwise a noindex page would be indexable through its twin.
  const robots = extractMetaRobots(html);
  if (robots) setResponseHeader(event, 'x-robots-tag', robots);
  return respond(markdown);
};
```

- [ ] **Step 6: Implement `src/runtime/server/middleware/markdown.ts`**

```ts
import { appendResponseHeader, createError, defineEventHandler, getHeaders, getRequestURL, sendRedirect, setResponseHeader } from 'h3';
import { getRouteRules, useRuntimeConfig } from '#imports';
import type { ResolvedOptions } from '../../../types';
import { toMarkdownPath } from '../../shared/markdownPath';
import { MODULE_NAME } from '../../shared/moduleName';
import { buildLinkHeader } from '../lib/linkHeader';
import { renderMarkdownPage } from '../lib/markdownPage';
import { contentNegotiationFor, decideNegotiation, NEGOTIATION_VARY } from '../lib/negotiation';

const setUncacheable = (event: Parameters<typeof setResponseHeader>[0]) => {
  setResponseHeader(event, 'cache-control', 'private, no-store');
  setResponseHeader(event, 'cdn-cache-control', 'no-store');
};

export default defineEventHandler(async (event) => {
  // A form post or API call to a page URL is never a request for a representation of that page.
  if (event.method !== 'GET' && event.method !== 'HEAD') return;
  const { aiReady } = useRuntimeConfig(event)[MODULE_NAME] as ResolvedOptions;
  const decision = decideNegotiation({
    path: event.path,
    headers: getHeaders(event),
    contentNegotiation: contentNegotiationFor(aiReady.contentNegotiation, getRouteRules(event)),
  });
  if (decision.kind === 'skip') return;

  const origin = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin;
  const resolveUrl = (path: string) => `${origin}${path}`;

  switch (decision.kind) {
    case 'not-acceptable':
      appendResponseHeader(event, 'vary', NEGOTIATION_VARY);
      setUncacheable(event);
      throw createError({ statusCode: 406, statusMessage: 'Not Acceptable', message: 'Supported types: text/html, text/markdown, text/plain' });
    case 'redirect':
      appendResponseHeader(event, 'vary', NEGOTIATION_VARY);
      setUncacheable(event);
      return sendRedirect(event, toMarkdownPath(decision.path), 307);
    case 'html':
      if (decision.negotiated) appendResponseHeader(event, 'vary', NEGOTIATION_VARY);
      // Appended, not set: the renderer adds its own `Link` values (preconnect) to the same response.
      appendResponseHeader(event, 'link', buildLinkHeader({ path: decision.path, variant: 'html', describedby: aiReady.describedby, resolveUrl }));
      return;
    case 'render':
      return renderMarkdownPage(event, decision.path, aiReady, resolveUrl);
    // no default
  }
});
```

- [ ] **Step 7: Implement `src/runtime/server/nitro/structuredData.ts`**

```ts
import { defineNitroPlugin } from '#imports';
import { appendStructuredData } from '../lib/structuredData';

// A hook listener rather than part of the conversion, so it keeps working unchanged on top of
// nuxt-ai-ready, which calls the same hook.
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('ai-ready:page:markdown', (ctx) => {
    ctx.markdown = appendStructuredData(ctx.markdown, ctx.html);
  });
});
```

- [ ] **Step 8: Register in `src/module.ts`**

Add `addServerHandler` to the `@nuxt/kit` import, and after the existing `addServerPlugin` calls:

```ts
    if (options.aiReady.enabled) {
      addServerHandler({ middleware: true, handler: resolve('./runtime/server/middleware/markdown') });
      addServerPlugin(resolve('./runtime/server/nitro/structuredData'));
    }
```

- [ ] **Step 9: Run the integration test**

Run: `pnpm vitest run test/integration/markdown.test.ts`
Expected: PASS.

If the fixture build fails with `Cannot find module '@mdream/rust-…'` (Nitro's file tracing missed mdream's platform binary), add to `module.ts` setup, before the handler registration:

```ts
    // mdream loads its native engine through a runtime platform lookup that Nitro's file tracing
    // cannot follow, so it stays a runtime dependency instead of being traced into the output.
    nuxt.options.nitro.externals = defu(nuxt.options.nitro.externals, { external: ['mdream'] });
```

and re-run. If the home-page case returns HTML-in-Markdown noise from Nuxt's payload scripts, that is expected mdream output; only assert on `seo fixture`.

- [ ] **Step 10: Run the whole suite**

Run: `pnpm vitest run`
Expected: PASS — the middleware must not change sitemap, robots or Open Graph behaviour.

- [ ] **Step 11: Commit**

```bash
git add src/runtime/server/lib/markdownPage.ts src/runtime/server/middleware/markdown.ts src/runtime/server/nitro/structuredData.ts src/runtime/types/hooks.d.ts src/module.ts test/fixtures/seo/server/routes/md-fixture test/integration/markdown.test.ts
git commit -m "feat: serve Markdown twins of every page with Accept negotiation"
```

---

### Task 8: `<link rel="alternate" type="text/markdown">` in the page head

**Files:**
- Create: `src/runtime/app/plugins/markdownAlternate.server.ts`
- Modify: `src/module.ts`
- Test: `test/integration/markdown.test.ts`

**Interfaces:**
- Consumes: `markdownAlternatePath` (Task 4); public config `aiReady` (Task 2).

- [ ] **Step 1: Write the failing test**

Add to `test/integration/markdown.test.ts`, inside the top-level `describe`:

```ts
  describe('page head', () => {
    it('names the twin and llms.txt', async () => {
      const html = await $fetch<string>('/', { headers: hostHeaders });
      const links = html.match(/<link\b[^>]*>/g) ?? [];
      expect(links.some((tag) => tag.includes('type="text/markdown"') && tag.includes('href="/index.md"'))).toBe(true);
      expect(links.some((tag) => tag.includes('rel="describedby"') && tag.includes('href="/llms.txt"'))).toBe(true);
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/integration/markdown.test.ts -t "page head"`
Expected: FAIL.

- [ ] **Step 3: Implement the plugin**

`src/runtime/app/plugins/markdownAlternate.server.ts`:

```ts
import { defineNuxtPlugin, useHead, useRequestURL, useRuntimeConfig } from '#app';
import { markdownAlternatePath } from '../../shared/markdownPath';
import { MODULE_NAME } from '../../shared/moduleName';

// Server-only: crawlers read the SSR document, and the tags need no updating on client navigation.
export default defineNuxtPlugin(() => {
  const config = (useRuntimeConfig().public as Record<string, unknown>)[MODULE_NAME] as
    | { aiReady?: { enabled: boolean; describedby: boolean } }
    | undefined;
  if (!config?.aiReady?.enabled) return;

  const markdownPath = markdownAlternatePath(useRequestURL().pathname);
  if (!markdownPath) return;

  useHead({
    link: [
      { rel: 'alternate', type: 'text/markdown', href: markdownPath },
      ...(config.aiReady.describedby ? [{ rel: 'describedby', href: '/llms.txt' }] : []),
    ],
  });
});
```

In `src/module.ts`, after the `pageHead` `addPlugin` call:

```ts
    if (options.aiReady.enabled) addPlugin({ src: resolve('./runtime/app/plugins/markdownAlternate.server'), mode: 'server' });
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/integration/markdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/app/plugins/markdownAlternate.server.ts src/module.ts test/integration/markdown.test.ts
git commit -m "feat: advertise the Markdown twin and llms.txt in the page head"
```

---

### Task 9: llms.txt formatter

A pure function from a model to the file. Link, section and page-list formatting are ported from
nuxt-ai-ready 2.4.0 (MIT) so the shared parts read identically.

**Files:**
- Create: `src/runtime/server/lib/llmsTxt/format.ts`
- Test: `test/unit/llmsTxtFormat.test.ts`

**Interfaces:**
- Produces:

```ts
export interface LlmsTxtLink { title: string; href: string; description?: string }
export interface LlmsTxtSection { title: string; description?: string | string[]; links: LlmsTxtLink[]; optional?: boolean }
export interface LlmsTxtPage { path: string; href: string; title?: string; description?: string }
export interface LlmsTxtPageType { title: string; href: string; pattern: string; count?: number; description?: string }
export interface LlmsTxtLanguage { code: string; name: string; href: string; isDefault: boolean }
export interface LlmsTxtModel {
  siteName: string; description?: string; origin: string;
  notes: string | string[]; sections: LlmsTxtSection[]; resources: LlmsTxtLink[];
  languages: LlmsTxtLanguage[]; pages: LlmsTxtPage[]; pageTypes: LlmsTxtPageType[];
}
export const renderLlmsTxt: (model: LlmsTxtModel) => string;
```

- [ ] **Step 1: Write the failing test**

`test/unit/llmsTxtFormat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type LlmsTxtModel, renderLlmsTxt } from '../../src/runtime/server/lib/llmsTxt/format';

const model = (overrides: Partial<LlmsTxtModel> = {}): LlmsTxtModel => ({
  siteName: 'Shop',
  description: 'Shoes',
  origin: 'https://shop.ch',
  notes: 'Prices in CHF.',
  sections: [
    { title: 'Help', links: [{ title: 'FAQ', href: 'https://shop.ch/faq.md' }] },
    { title: 'Legal', optional: true, links: [{ title: 'Imprint', href: 'https://shop.ch/imprint.md' }] },
  ],
  resources: [{ title: 'sitemap_index.xml', href: 'https://shop.ch/sitemap_index.xml', description: 'XML sitemap for search engines and crawlers.' }],
  languages: [],
  pages: [
    { path: '/about', href: 'https://shop.ch/about.md', description: 'About us' },
    { path: '/', href: 'https://shop.ch/index.md', title: 'Home' },
  ],
  pageTypes: [{ title: 'Product', href: 'https://shop.ch/__sitemap__/p-de.xml', pattern: '/p/{slug}', count: 12400 }],
  ...overrides,
});

describe('renderLlmsTxt', () => {
  it('renders the upstream layout plus Page Types', () => {
    expect(renderLlmsTxt(model())).toBe(
      [
        '# Shop',
        '',
        '> Shoes',
        '',
        'Canonical Origin: https://shop.ch/',
        '',
        '**Notes:**',
        '',
        'Prices in CHF.',
        '',
        '## LLM Resources',
        '',
        '- [sitemap_index.xml](https://shop.ch/sitemap_index.xml): XML sitemap for search engines and crawlers.',
        '',
        '## Help',
        '',
        '- [FAQ](https://shop.ch/faq.md)',
        '',
        '## Optional',
        '',
        '- [Imprint](https://shop.ch/imprint.md): Legal',
        '',
        '## Pages',
        '',
        '- [Home](https://shop.ch/index.md)',
        '- [/about](https://shop.ch/about.md): About us',
        '',
        '## Page Types',
        '',
        '- [Product](https://shop.ch/__sitemap__/p-de.xml): ~12,400 pages at /p/{slug}. Append .md to any URL for Markdown.',
        '',
      ].join('\n')
    );
  });

  it('omits the count it does not know, and puts an authored description first', () => {
    const text = renderLlmsTxt(
      model({ pageTypes: [{ title: 'Product', href: 'https://x', pattern: '/p/{slug}', description: 'Our running shoes.' }] })
    );
    expect(text).toContain('- [Product](https://x): Our running shoes. Pages at /p/{slug}. Append .md to any URL for Markdown.');
  });

  it('lists languages only when the host serves more than one', () => {
    const languages = [
      { code: 'de', name: 'German', href: 'https://shop.ch/index.md', isDefault: true },
      { code: 'fr', name: 'French', href: 'https://shop.ch/fr.md', isDefault: false },
    ];
    const text = renderLlmsTxt(model({ languages }));
    expect(text).toContain('## Available Languages on Website\n\n- [German (de)](https://shop.ch/index.md): content included below.\n- [French (fr)](https://shop.ch/fr.md): visit this language for content.');
    expect(renderLlmsTxt(model({ languages: languages.slice(0, 1) }))).not.toContain('Available Languages');
  });

  it('leaves out empty generated sections', () => {
    const text = renderLlmsTxt(model({ pages: [], pageTypes: [] }));
    expect(text).not.toContain('## Pages');
    expect(text).not.toContain('## Page Types');
  });

  it('truncates page descriptions at 160 characters and escapes brackets in titles', () => {
    const text = renderLlmsTxt(model({ pages: [{ path: '/a', href: 'https://x/a.md', title: 'A [B]', description: 'x'.repeat(200) }] }));
    expect(text).toContain(`- [A &#91;B&#93;](https://x/a.md): ${'x'.repeat(160)}...`);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/unit/llmsTxtFormat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/runtime/server/lib/llmsTxt/format.ts`**

```ts
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

const asList = (value: string | string[] | undefined) => (Array.isArray(value) ? value : value ? [value] : []);
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
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/unit/llmsTxtFormat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/lib/llmsTxt/format.ts test/unit/llmsTxtFormat.test.ts
git commit -m "feat: render llms.txt from a model in nuxt-ai-ready's layout"
```

---

### Task 10: llms.txt model

**Files:**
- Create: `src/runtime/server/lib/llmsTxt/model.ts`
- Test: `test/unit/llmsTxtModel.test.ts`

**Interfaces:**
- Consumes: `resolveHostDomains`, `belongsInSitemap` (hostContext); `isDynamicPath`, `isPageIncluded`, `defaultVariant` (pageSelection); `composePath`, `unlocalize` (path); `buildSitemapName` (sitemapName); `snapshotState`, `Snapshot` (snapshotStore); `toMarkdownPath`; `LlmsTxtModel` (Task 9); `ResolvedOptions['aiReady']['llmsTxt']` (Task 2).
- Produces:

```ts
export const toUrlPattern: (path: string) => string;
export const humanizePageType: (token: string) => string;
export const buildLlmsTxtModel: (input: {
  host: string;
  origin: string;
  site: { name: string; description?: string; indexable: boolean };
  i18nConfig: RenderI18nConfig;
  pages: Record<string, RcPage>;
  trailingSlash: boolean;
  excludePageTypes: string[];
  llmsTxt: ResolvedOptions['aiReady']['llmsTxt'];
  dynamicTokens: string[];
  readSnapshot: (sitemapName: string) => Promise<Snapshot | null>;
  now: number;
}) => Promise<LlmsTxtModel>;
```

- [ ] **Step 1: Write the failing test**

`test/unit/llmsTxtModel.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { buildLlmsTxtModel, humanizePageType, toUrlPattern } from '../../src/runtime/server/lib/llmsTxt/model';
import { __resetSitemapNames } from '../../src/runtime/shared/sitemapName';
import { resolveOptions } from '../../src/types';

const de = { id: 'lng_de', code: 'de', name: 'German', localeChain: ['de'] };
const fr = { id: 'lng_fr', code: 'fr', name: 'French', localeChain: ['fr'] };
const chDe = { id: 'd1', host: 'shop.ch', devHost: 'shop-ch.local', language: de };
const chFr = { id: 'd2', host: 'shop.ch', path: '/fr', devHost: 'shop-ch.local', language: fr };
const ch = { id: 'mkt_ch', name: 'Switzerland', isIndexable: true, domains: [chDe, chFr], defaultDomain: chDe };
const i18nConfig = { hostToMarket: { 'shop.ch': ch }, defaultMarket: ch, markets: [ch] } as never;

const variant = (seo: Record<string, unknown>) => ({ v: { id: 'v', seo: { title: {}, description: {}, ...seo } } });
const pages = {
  home: { id: 'home', type: 'core/home', path: '/', variants: variant({ title: { de: 'Startseite' }, description: { de: 'Willkommen' } }) },
  hidden: { id: 'hidden', type: 'core/landingpage', path: '/intern', variants: variant({ robots: 'noindex' }) },
  templated: { id: 'templated', type: 'core/contentpage', path: '/info', variants: variant({ title: { de: '{{ queries.x.title }}' } }) },
  pdp: { id: 'pdp', type: 'test/product', path: { de: '/produkte/:slug', fr: '/produits/:slug' }, variants: variant({}) },
  article: { id: 'article', type: 'test/article', path: '/artikel/:slug(\\d+)', variants: variant({}) },
} as never;

const build = (overrides: Record<string, unknown> = {}) =>
  buildLlmsTxtModel({
    host: 'shop.ch',
    origin: 'https://shop.ch',
    site: { name: 'Switzerland', description: 'Swiss shop', indexable: true },
    i18nConfig,
    pages,
    trailingSlash: false,
    excludePageTypes: [],
    llmsTxt: resolveOptions(undefined).aiReady.llmsTxt,
    dynamicTokens: ['test/product', 'test/article'],
    readSnapshot: async () => null,
    now: 1_000,
    ...overrides,
  } as never);

beforeEach(() => __resetSitemapNames());

describe('buildLlmsTxtModel', () => {
  it('lists configured, indexable pages in the default language, linking twins', async () => {
    const model = await build();
    expect(model.pages).toEqual([
      { path: '/', href: 'https://shop.ch/index.md', title: 'Startseite', description: 'Willkommen' },
      { path: '/info', href: 'https://shop.ch/info.md', title: undefined, description: undefined },
    ]);
  });

  it('links canonical URLs when markdownLinks is off', async () => {
    const llmsTxt = resolveOptions({ aiReady: { llmsTxt: { markdownLinks: false } } }).aiReady.llmsTxt;
    expect((await build({ llmsTxt })).pages[0]!.href).toBe('https://shop.ch/');
  });

  it('summarises each dynamic page type by its route pattern', async () => {
    const model = await build();
    expect(model.pageTypes).toEqual([
      { title: 'Product', description: undefined, pattern: '/produkte/{slug}', href: 'https://shop.ch/__sitemap__/test-product-de.xml', count: undefined },
      { title: 'Article', description: undefined, pattern: '/artikel/{slug}', href: 'https://shop.ch/__sitemap__/test-article-de.xml', count: undefined },
    ]);
  });

  it('counts a page type only from a complete, live snapshot', async () => {
    const snapshot = (complete: boolean) => ({ urls: [{ loc: 'a' }, { loc: 'b' }], complete, expiresAt: 5_000, refreshAt: 4_000 });
    expect((await build({ readSnapshot: async () => snapshot(true) })).pageTypes[0]!.count).toBe(2);
    expect((await build({ readSnapshot: async () => snapshot(false) })).pageTypes[0]!.count).toBeUndefined();
  });

  it('applies authored titles and hides types set to false', async () => {
    const llmsTxt = resolveOptions({
      aiReady: { llmsTxt: { pageTypes: { 'test/product': { title: 'Products', description: 'Shoes.' }, 'test/article': false } } },
    }).aiReady.llmsTxt;
    const model = await build({ llmsTxt });
    expect(model.pageTypes).toHaveLength(1);
    expect(model.pageTypes[0]).toMatchObject({ title: 'Products', description: 'Shoes.' });
  });

  it('lists the host languages, default first', async () => {
    expect((await build()).languages).toEqual([
      { code: 'de', name: 'German', href: 'https://shop.ch/index.md', isDefault: true },
      { code: 'fr', name: 'French', href: 'https://shop.ch/fr.md', isDefault: false },
    ]);
  });

  it('adds sitemap and robots to the resources', async () => {
    expect((await build()).resources.map((link) => link.href)).toEqual(['https://shop.ch/sitemap_index.xml', 'https://shop.ch/robots.txt']);
  });

  it('lists no pages for a non-indexable deployment or market', async () => {
    const preview = await build({ site: { name: 'Switzerland', indexable: false } });
    expect(preview.pages).toEqual([]);
    expect(preview.pageTypes).toEqual([]);
    const draft = { ...ch, isIndexable: false };
    const unlaunched = await build({ i18nConfig: { hostToMarket: { 'shop.ch': draft }, defaultMarket: draft } });
    expect(unlaunched.pages).toEqual([]);
  });
});

describe('helpers', () => {
  it('writes route params as {name}', () => {
    expect(toUrlPattern('/p/:slug')).toBe('/p/{slug}');
    expect(toUrlPattern('/a/:year(\\d+)/:rest*')).toBe('/a/{year}/{rest}');
  });

  it('humanizes the last token segment', () => {
    expect(humanizePageType('ecommerce/product-detail-page')).toBe('Product Detail Page');
    expect(humanizePageType('test/product')).toBe('Product');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/unit/llmsTxtModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/runtime/server/lib/llmsTxt/model.ts`**

```ts
import type { ResolvedOptions } from '../../../../types';
import type { RcPage, RenderI18nConfig } from '@laioutr-core/core-types/rc';
import { toMarkdownPath } from '../../../shared/markdownPath';
import { composePath, unlocalize } from '../../../shared/path';
import { defaultVariant, isDynamicPath, isPageIncluded } from '../../../shared/pageSelection';
import { buildSitemapName } from '../../../shared/sitemapName';
import { belongsInSitemap, resolveHostDomains } from '../hostContext';
import { type Snapshot, snapshotState } from '../snapshotStore';
import type { LlmsTxtModel } from './format';

const PARAM = /:(\w+)(?:\([^)]*\))?[+*?]?/g;

export const toUrlPattern = (path: string): string => path.replace(PARAM, '{$1}');

export const humanizePageType = (token: string): string =>
  (token.split('/').pop() ?? token)
    .split('-')
    .filter(Boolean)
    .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
    .join(' ');

/** An authored SEO value, or nothing for a `{{…}}` template this build cannot resolve without running the page's queries. */
const authoredText = (value: unknown, localeChain: string[]): string | undefined => {
  const text = unlocalize(value as string | Record<string, string>, localeChain);
  return typeof text === 'string' && text.trim() && !text.includes('{{') ? text.trim() : undefined;
};

export const buildLlmsTxtModel = async (input: {
  host: string;
  origin: string;
  site: { name: string; description?: string; indexable: boolean };
  i18nConfig: RenderI18nConfig;
  pages: Record<string, RcPage>;
  trailingSlash: boolean;
  excludePageTypes: string[];
  llmsTxt: ResolvedOptions['aiReady']['llmsTxt'];
  dynamicTokens: string[];
  readSnapshot: (sitemapName: string) => Promise<Snapshot | null>;
  now: number;
}): Promise<LlmsTxtModel> => {
  const { market, domains } = resolveHostDomains(input.i18nConfig, input.host);
  const domain = domains[0];
  const pageHref = (path: string) => `${input.origin}${input.llmsTxt.markdownLinks ? toMarkdownPath(path) : path}`;

  const model: LlmsTxtModel = {
    siteName: input.site.name,
    description: input.site.description,
    origin: input.origin,
    notes: input.llmsTxt.notes,
    sections: input.llmsTxt.sections,
    resources: [
      { title: 'sitemap_index.xml', href: `${input.origin}/sitemap_index.xml`, description: 'XML sitemap for search engines and crawlers.' },
      { title: 'robots.txt', href: `${input.origin}/robots.txt`, description: 'Crawler rules and permissions.' },
    ],
    languages: domains.map((candidate) => ({
      code: candidate.language.code,
      name: candidate.language.name,
      href: pageHref(composePath(candidate.path ?? '', '/', input.trailingSlash)),
      isDefault: candidate === domain,
    })),
    pages: [],
    pageTypes: [],
  };

  // Same rule as the sitemap: a deployment or market that asks not to be indexed is not advertised.
  if (!domain || !input.site.indexable || !belongsInSitemap(market)) return model;

  const localeChain = domain.language.localeChain;
  const prefix = domain.path ?? '';

  for (const page of Object.values(input.pages)) {
    if (isDynamicPath(page.path)) continue;
    if (!isPageIncluded(page, { marketId: market.id, excludePageTypes: input.excludePageTypes })) continue;
    const path = unlocalize(page.path, localeChain);
    if (!path) continue;
    const loc = composePath(prefix, path, input.trailingSlash);
    const seo = defaultVariant(page)?.seo;
    model.pages.push({
      path: loc,
      href: pageHref(loc),
      title: authoredText(seo?.title, localeChain),
      description: authoredText(seo?.description, localeChain),
    });
  }

  for (const token of input.dynamicTokens) {
    const authored = input.llmsTxt.pageTypes[token];
    if (authored === false) continue;
    const template = Object.values(input.pages).find((page) => page.type === token && isDynamicPath(page.path));
    const path = template && unlocalize(template.path, localeChain);
    if (!path) continue;

    const sitemapName = buildSitemapName(token, domain.language.code);
    const snapshot = await input.readSnapshot(sitemapName);
    const state = snapshotState(snapshot, input.now);
    model.pageTypes.push({
      title: authored?.title ?? humanizePageType(token),
      description: authored?.description,
      pattern: toUrlPattern(composePath(prefix, path, input.trailingSlash)),
      href: `${input.origin}/__sitemap__/${sitemapName}.xml`,
      // Read, never built: llms.txt must not start page-index enumeration or call upstream.
      count: state === 'fresh' || state === 'stale' ? snapshot!.urls.length : undefined,
    });
  }

  return model;
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/unit/llmsTxtModel.test.ts`
Expected: PASS. If `buildSitemapName` throws a collision between test cases, the `beforeEach` reset is missing.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/server/lib/llmsTxt/model.ts test/unit/llmsTxtModel.test.ts
git commit -m "feat: build the llms.txt model from configured pages and page types"
```

---

### Task 11: `/llms.txt` route

**Files:**
- Create: `src/runtime/server/routes/llmsTxt.ts`
- Modify: `src/module.ts`
- Modify: `test/fixtures/seo/nuxt.config.ts`, `test/fixtures/seo/laioutrrc.json` (`p_home` title)
- Test: `test/integration/llmsTxt.test.ts`, `test/integration/indexable.test.ts`

**Interfaces:**
- Consumes: `buildLlmsTxtModel` (Task 10), `renderLlmsTxt` (Task 9), `createSnapshotStore`, `Snapshot`, `SitemapSourceDescriptor`.

- [ ] **Step 1: Configure the fixture**

In `test/fixtures/seo/nuxt.config.ts`, extend the module options:

```ts
  '@laioutr/app-essentials-seo': {
    sitemap: {
      entriesPerRequest: 10_000,
      excludePageTypes: [],
    },
    aiReady: {
      // Off so a seeded snapshot shows up on the next request instead of after the cache expires.
      llmsTxtCacheSeconds: 0,
      llmsTxt: {
        notes: 'Fixture shop for tests.',
        sections: [{ title: 'Help', links: [{ title: 'FAQ', href: 'https://shop.ch/faq.md' }] }],
        pageTypes: { 'test/article': false },
      },
    },
  },
```

In `test/fixtures/seo/laioutrrc.json`, set `p_home.variants.v.seo.title` to `{ "de": "Startseite", "fr": "Accueil" }`.

- [ ] **Step 2: Write the failing integration tests**

`test/integration/llmsTxt.test.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('llms.txt', async () => {
  await setup({ rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)) });

  // See sitemap.test.ts for why the host travels in x-forwarded-host.
  const onHost = (path: string, host: string) =>
    $fetch<string>(path, { headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

  it('opens with the site header and the authored parts', async () => {
    const txt = await onHost('/llms.txt', 'shop.ch');
    expect(txt.startsWith('# Switzerland\n')).toBe(true);
    expect(txt).toContain('Canonical Origin: https://shop.ch/');
    expect(txt).toContain('Fixture shop for tests.');
    expect(txt).toContain('- [sitemap_index.xml](https://shop.ch/sitemap_index.xml)');
    expect(txt).toContain('- [FAQ](https://shop.ch/faq.md)');
  });

  it('lists configured, indexable pages as twins', async () => {
    const txt = await onHost('/llms.txt', 'shop.ch');
    expect(txt).toContain('- [Startseite](https://shop.ch/index.md)');
    expect(txt).not.toContain('/intern');
  });

  it('summarises page types, hiding the ones set to false', async () => {
    const txt = await onHost('/llms.txt', 'shop.ch');
    expect(txt).toContain('- [Product](https://shop.ch/__sitemap__/test-product-de.xml): Pages at /produkte/{slug}.');
    expect(txt).not.toContain('/artikel/');
  });

  it('counts a page type once its snapshot is complete', async () => {
    await $fetch('/__seed-snapshot', {
      method: 'POST',
      body: { host: 'shop.ch', sitemapName: 'test-product-de', urls: ['https://shop.ch/produkte/a', 'https://shop.ch/produkte/b'] },
    });
    expect(await onHost('/llms.txt', 'shop.ch')).toContain('~2 pages at /produkte/{slug}');
  });

  it('lists languages on a multi-language host only', async () => {
    const ch = await onHost('/llms.txt', 'shop.ch');
    expect(ch).toContain('- [German (de)](https://shop.ch/index.md): content included below.');
    expect(ch).toContain('- [French (fr)](https://shop.ch/fr.md): visit this language for content.');
    const de = await onHost('/llms.txt', 'shop.de');
    expect(de.startsWith('# Germany\n')).toBe(true);
    expect(de).not.toContain('Available Languages');
  });

  it('is plain text', async () => {
    const response = await fetch('/llms.txt', { headers: { 'x-forwarded-host': 'shop.ch', 'x-forwarded-proto': 'https' } });
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });
});
```

In `test/integration/indexable.test.ts`, add:

```ts
  it('lists no pages in llms.txt', async () => {
    const llms = await onHost('/llms.txt', 'shop.ch');
    expect(llms.startsWith('# Switzerland\n')).toBe(true); // guard: a blank or error body would also lack pages
    expect(llms).not.toContain('## Pages');
    expect(llms).not.toContain('## Page Types');
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run test/integration/llmsTxt.test.ts`
Expected: FAIL — `/llms.txt` 404s.

- [ ] **Step 4: Implement `src/runtime/server/routes/llmsTxt.ts`**

```ts
import { defineEventHandler, getRequestHost, getRequestURL, type H3Event, setResponseHeader } from 'h3';
import { defineCachedFunction, getSiteConfig, useRuntimeConfig, useUserlandCache } from '#imports';
import type { ResolvedOptions } from '../../../types';
import type { SitemapSourceDescriptor } from '../../shared/toUpstreamConfig';
import { MODULE_NAME } from '../../shared/moduleName';
import { renderLlmsTxt } from '../lib/llmsTxt/format';
import { buildLlmsTxtModel } from '../lib/llmsTxt/model';
import { createSnapshotStore, type Snapshot } from '../lib/snapshotStore';
// #laioutr/i18n-config and #laioutr/rc are virtual Nitro aliases that exist only at build time;
// their ambient declarations live in ../types/rc.d.ts, which import-x cannot see.
// eslint-disable-next-line import-x/no-unresolved
import { i18nConfig } from '#laioutr/i18n-config';
// eslint-disable-next-line import-x/no-unresolved
import { rcProject } from '#laioutr/rc';

type Options = ResolvedOptions & { sources: SitemapSourceDescriptor[] };

// Stripped of the port so the snapshot keys match the ones the sitemap plugin writes.
const bareHost = (event: H3Event) => getRequestHost(event, { xForwardedHost: true }).split(':')[0]!;

const build = async (event: H3Event): Promise<string> => {
  const options = useRuntimeConfig(event)[MODULE_NAME] as Options;
  const site = getSiteConfig(event);
  const host = bareHost(event);
  const store = createSnapshotStore(useUserlandCache<Snapshot>('essentials-seo'));

  const model = await buildLlmsTxtModel({
    host,
    origin: getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin,
    site: { name: site.name || host, description: site.description, indexable: site.indexable !== false },
    i18nConfig,
    pages: rcProject.pages ?? {},
    // frontend-core strips `config` off `rcProject`; it publishes `trailingSlash` on public runtime config instead.
    trailingSlash: useRuntimeConfig(event).public.laioutr?.trailingSlash ?? false,
    excludePageTypes: options.sitemap.excludePageTypes,
    llmsTxt: options.aiReady.llmsTxt,
    // `||`-style filter: a null token comes back from runtime config as ''.
    dynamicTokens: [...new Set(options.sources.map((source) => source.token).filter((token): token is string => Boolean(token)))],
    readSnapshot: (sitemapName) => store.readLive(host, sitemapName),
    now: Date.now(),
  });
  return renderLlmsTxt(model);
};

let cachedBuild: ((event: H3Event) => Promise<string>) | undefined;

export default defineEventHandler(async (event) => {
  const { aiReady } = useRuntimeConfig(event)[MODULE_NAME] as Options;
  const seconds = aiReady.llmsTxtCacheSeconds;
  const cache = !import.meta.dev && seconds > 0;

  // Keyed by host: one build serves every market, and a shared entry would hand one market's file to another.
  cachedBuild ??= defineCachedFunction(build, { name: 'essentials-seo-llms-txt', maxAge: seconds, swr: true, getKey: bareHost });
  const body = cache ? await cachedBuild(event) : await build(event);

  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8');
  if (cache) setResponseHeader(event, 'cache-control', `public, max-age=${seconds}, s-maxage=${seconds}, stale-while-revalidate=3600`);
  return body;
});
```

In `src/module.ts`, inside the `if (options.aiReady.enabled)` block from Task 7:

```ts
      addServerHandler({ route: '/llms.txt', handler: resolve('./runtime/server/routes/llmsTxt') });
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run test/integration/llmsTxt.test.ts test/integration/indexable.test.ts`
Expected: PASS. If `getSiteConfig` is not an auto-import in the server runtime, import it from `#site-config/server/composables/getSiteConfig` (the path `.nuxt/types/nitro-imports.d.ts` lists).

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm lint && pnpm test:types`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/server/routes/llmsTxt.ts src/module.ts test/fixtures/seo/nuxt.config.ts test/fixtures/seo/laioutrrc.json test/integration/llmsTxt.test.ts test/integration/indexable.test.ts
git commit -m "feat: serve a curated per-host llms.txt"
```

---

### Task 12: Document it

**Files:**
- Modify: `README.md` (sections "What it serves", "Configuration", new "`aiReady`" subsection, "Upstream hooks")
- Modify: `package.json` (`description`)

- [ ] **Step 1: Update the README**

Under "What it serves", add bullets:

```md
- **Markdown twins** — `<path>.md` for every page (`/index.md` for the home page), converted from the
  rendered HTML with [mdream](https://github.com/harlan-zw/mdream). Header and footer sections and
  anything marked `data-markdown-ignore` are left out; schema.org JSON-LD is appended under
  `## Structured Data`. Clients that prefer Markdown (`Accept: text/markdown`, known AI agents) are
  redirected there with a `307`. A noindex page's twin carries the same directive as `X-Robots-Tag`.
- **`/llms.txt`** — per host: site name and description, authored notes and sections, the configured
  pages, and one line per dynamic page type (URL pattern, count once its sitemap is complete).
  Deliberately curated rather than a list of every URL — the sitemap already is that.
- **Discovery** — `<link rel="alternate" type="text/markdown">` and `rel="describedby"` → `/llms.txt`
  in the page head and the `Link` header.
```

Add a `### aiReady` subsection under "Configuration" listing every option with its default (copy the
table from the spec's "Configuration" block), plus:

```md
Option names mirror [nuxt-ai-ready](https://nuxtseo.com/docs/ai-ready)'s `aiReady`, so this block can
be handed to that module unchanged once frontends run Nuxt 4. `llmsTxt.pageTypes` is this module's
own addition.

**Leaving content out of the Markdown.** Put `data-markdown-ignore` on any element:

    <div class="stock-badge" data-markdown-ignore>Only 3 left!</div>

A section or block definition can leave itself out entirely with `rendering: { markdown: false }`
(needs `@laioutr-core/frontend-core` with Markdown opt-out support).
```

Under `### robots`, document `contentSignal` / `contentUsage` with their defaults and why `ai-train`
is unset.

Under "Upstream hooks", add the three `ai-ready:*` hooks with one-line descriptions and this example:

```ts
// server/plugins/markdown.ts
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('ai-ready:page:markdown', (ctx) => {
    ctx.markdown += `\n\nSource: ${ctx.route}`;
  });
});
```

- [ ] **Step 2: Update the package description**

`"description": "SEO essentials for Laioutr frontends — sitemap.xml, robots.txt, llms.txt and Markdown twins"`

- [ ] **Step 3: Commit**

```bash
git add README.md package.json
git commit -m "docs: document Markdown twins, llms.txt and content preferences"
```

---

## Part B — laioutr monorepo (`/Users/sl/src/laioutr`)

Independent of Part A: Part A already honours `data-markdown-ignore` wherever it appears; this part
makes definitions able to emit it. Monorepo rules apply: no component tests (the attribute logic is a
pure helper with a unit test), a changeset for the published packages.

### Task 13: `rendering.markdown` on section and block definitions

**Files:**
- Modify: `packages/core-types/src/frontend/definitions/SectionDefinition.ts`
- Modify: `packages/core-types/src/frontend/definitions/BlockDefinition.ts`
- Create: `packages/frontend-core/src/runtime/lib/page/markdownIgnoreAttr.ts`
- Create: `packages/frontend-core/src/runtime/lib/page/markdownIgnoreAttr.test.ts`
- Modify: `packages/frontend-core/src/runtime/app/core/components/SectionRenderer.vue`
- Modify: `packages/frontend-core/src/runtime/app/core/components/BlockRenderer.vue`
- Create: `.changeset/markdown-opt-out.md`

**Interfaces:**
- Produces: `SectionRenderingOptions.markdown?: boolean`; `BlockRenderingOptions { markdown?: boolean }` and `BlockDefinition.rendering?: BlockRenderingOptions`; `markdownIgnoreAttr(definition: { rendering?: { markdown?: boolean } } | undefined): '' | undefined`.

- [ ] **Step 1: Write the failing test**

`packages/frontend-core/src/runtime/lib/page/markdownIgnoreAttr.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { markdownIgnoreAttr } from './markdownIgnoreAttr';

describe('markdownIgnoreAttr', () => {
  it('marks a definition that opts out of Markdown', () => {
    expect(markdownIgnoreAttr({ rendering: { markdown: false } })).toBe('');
  });

  it('leaves the attribute off otherwise', () => {
    expect(markdownIgnoreAttr({ rendering: { markdown: true } })).toBeUndefined();
    expect(markdownIgnoreAttr({ rendering: {} })).toBeUndefined();
    expect(markdownIgnoreAttr({})).toBeUndefined();
    expect(markdownIgnoreAttr(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (from `packages/frontend-core`): `pnpm vitest run src/runtime/lib/page/markdownIgnoreAttr.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

`packages/frontend-core/src/runtime/lib/page/markdownIgnoreAttr.ts`:

```ts
/**
 * Value for `data-markdown-ignore`, which drops an element from the page's Markdown version.
 * `''` renders the bare attribute and `undefined` omits it; `false` would render the string "false",
 * which a presence selector still matches.
 */
export const markdownIgnoreAttr = (definition: { rendering?: { markdown?: boolean } } | undefined): '' | undefined =>
  definition?.rendering?.markdown === false ? '' : undefined;
```

- [ ] **Step 4: Extend the definition types**

`SectionDefinition.ts` — add to `SectionRenderingOptions`:

```ts
  /**
   * Whether the section appears in the page's Markdown version, which agents read at `<path>.md`.
   * Set to false for sections with no page content of their own — promo bars, overlays, newsletter
   * prompts. Parts of a section can be left out instead with a `data-markdown-ignore` attribute.
   * @default true
   */
  markdown?: boolean;
```

`BlockDefinition.ts` — add above `BlockDefinition`:

```ts
/** Runtime rendering behavior hints for blocks. */
export interface BlockRenderingOptions {
  /**
   * Whether the block appears in the page's Markdown version, which agents read at `<path>.md`.
   * Parts of a block can be left out instead with a `data-markdown-ignore` attribute.
   * @default true
   */
  markdown?: boolean;
}
```

and to `BlockDefinition`:

```ts
  /** Runtime rendering behavior overrides. */
  rendering?: BlockRenderingOptions;
```

- [ ] **Step 5: Stamp the attribute in the renderers**

`SectionRenderer.vue` — import and bind next to the existing `data-lfc-*` attributes:

```ts
import { markdownIgnoreAttr } from '../../lib/page/markdownIgnoreAttr';
```

```vue
          :data-lfc-isolate="resolvedSection.definition?.rendering?.isolate !== false"
          :data-markdown-ignore="markdownIgnoreAttr(resolvedSection.definition)"
```

`BlockRenderer.vue`:

```ts
import { markdownIgnoreAttr } from '../../lib/page/markdownIgnoreAttr';
```

```vue
      <component
        :is="resolved.component"
        v-bind="resolved.props"
        :data-lfc-block-id="resolved.id"
        :data-markdown-ignore="markdownIgnoreAttr(resolved.definition)"
      />
```

- [ ] **Step 6: Run tests and typecheck**

Run (from the repo root): `turbo run @laioutr-core/frontend-core#test @laioutr-core/core-types#typecheck`
Expected: PASS. The frontend-core `test` script also runs `nuxi typecheck`, which verifies the
`resolved.definition` types accept the helper.

- [ ] **Step 7: Add the changeset**

`.changeset/markdown-opt-out.md`:

```md
---
'@laioutr-core/core-types': minor
'@laioutr-core/frontend-core': minor
---

Section and block definitions can now leave themselves out of a page's Markdown version with `rendering: { markdown: false }`. The renderer then marks the component with `data-markdown-ignore`, the same attribute component authors can put on any part of their markup. Markdown versions are served by `@laioutr/app-essentials-seo`.
```

- [ ] **Step 8: Commit**

```bash
git add packages/core-types/src/frontend/definitions/SectionDefinition.ts packages/core-types/src/frontend/definitions/BlockDefinition.ts packages/frontend-core/src/runtime/lib/page/markdownIgnoreAttr.ts packages/frontend-core/src/runtime/lib/page/markdownIgnoreAttr.test.ts packages/frontend-core/src/runtime/app/core/components/SectionRenderer.vue packages/frontend-core/src/runtime/app/core/components/BlockRenderer.vue .changeset/markdown-opt-out.md
git commit -m "feat: let section and block definitions opt out of Markdown"
```

---

## After release (manual, not a task)

- Scan `laioutr.com` via `POST https://isitagentready.com/api/scan` with body `{ "url": "https://laioutr.com" }`. Expect `contentSignals`, `markdownNegotiation` and `linkHeaders` to pass (level 3). If `markdownNegotiation` fails while `curl -H 'Accept: text/markdown' -L https://www.laioutr.com/` returns Markdown, the scanner does not follow the 307 — raise it before changing the redirect.
- Watch CDN hit rates for HTML after enabling: `Vary: Accept, Sec-Fetch-Dest, User-Agent` on negotiated pages can reduce cache efficiency on CDNs that honour `Vary`. `aiReady.contentNegotiation: false` turns it off per project while keeping `.md` URLs and `llms.txt`.
