# Design: Markdown pages, `/llms.txt` and agent discovery, as an upstream-compatible subset of Nuxt AI Ready

**Repos:** `/Users/sl/src/app-essentials-seo` (most of it), `/Users/sl/src/laioutr` (`core-types`, `frontend-core`)
**Status:** approved in brainstorming, 2026-09-26. Implementation plan to follow.

## Problem

Laioutr frontends need to be readable by AI agents: a Markdown version of every page, a configurable
`/llms.txt`, and the discovery signals agent-readiness scanners look for. `laioutr.com` currently
scores level 1 of 5 on isitagentready.com — robots.txt and sitemap pass; Content Signals, Markdown
negotiation and agent-useful `Link` headers fail.

The module that does all of this in the Nuxt SEO family, [Nuxt AI Ready](https://nuxtseo.com/docs/ai-ready)
(`nuxt-ai-ready`), is not an option today: every release declares `compatibility.nuxt: ">=4.0.0"` and
depends on `@nuxt/kit` 4, v2 additionally wants `@nuxtjs/sitemap >= 8.3.1` and `nuxt-site-config` 4.
Laioutr frontends are on Nuxt 3.16 with no Nuxt 4 migration on the near-term roadmap.

## Approach

Implement a **subset of Nuxt AI Ready's observable contract** in this module, so that after a Nuxt 4
migration we can install the upstream module, forward our config, and delete our implementation.

"Contract" means three things, kept identical to `nuxt-ai-ready@2.4.0`:

1. **URLs and output** — `<path>.md`, `Accept` negotiation (307 to `.md`), frontmatter keys, `Link`
   header syntax, the Markdown 404 body.
2. **Config shape** — option names and types under `essentials-seo.aiReady`, mirroring upstream's
   `aiReady`.
3. **Nitro hooks** — `ai-ready:markdown:source`, `ai-ready:mdreamConfig`, `ai-ready:page:markdown`,
   with upstream's names and payloads, so extensions written against them survive the migration.

Built on the same libraries upstream uses: `mdream` (native engine on Node; it selects its WASM build
under `workerd`/`edge-light` on its own) for conversion, `@mdream/js/negotiate` for the `Accept`
decision. Small pure helpers (llms.txt link formatting, frontmatter building) may be ported from
upstream, which is MIT-licensed.

Rejected alternatives: vendoring upstream's runtime (it imports `nuxtseo-shared`, `#site-config` v4
helpers and virtual modules for agent skills and i18n — trimming it is most of the work and leaves a
drifting fork), and wrapping `@mdream/nuxt` (its surface is `mdream:*` hooks, a `mdream` config key and
in-place serving — every piece would need a shim and be discarded at migration).

**Migration rule:** at migration we forward our *resolved* config, not just what a project set. Our
defaults may therefore differ from upstream's without changing output on migration day.

### Out of scope

Database, `llms-full.txt`, `/sitemap.md` (we behave like upstream with `sitemapMd: false`, so `.md`
responses carry no trailing sitemap section), MCP tools, WebMCP, full-text search, cron, `runtimeSync`.

## Opt-out contract (`core-types`, `frontend-core`)

**Marker:** `data-markdown-ignore`, a presence attribute. Selector: `[data-markdown-ignore]`. Any
element carrying it is dropped from the Markdown, with its subtree. Component authors put it on any
part of their component's markup they want left out:

```vue
<div class="promo-badge" data-markdown-ignore>…</div>
```

Presence rather than a value, because Vue 3 renders `false` on a non-boolean attribute as the string
`"false"` rather than dropping it. Not `data-lfc-*`, because this attribute is written by hand by
component authors, not stamped by the renderers as internal plumbing. Not `data-md-*`, because `md`
reads as the UnoCSS breakpoint.

**Definition-level opt-out:**

- `core-types`: `SectionRenderingOptions` gains `markdown?: boolean` (default `true`). `BlockDefinition`
  gains `rendering?: BlockRenderingOptions` with the same field.
- `frontend-core`: `SectionRenderer` and `BlockRenderer` bind
  `:data-markdown-ignore="definition.rendering?.markdown === false ? '' : undefined"` on the component
  root, next to the `data-lfc-*` attributes they already set.

Both reach the DOM through Vue attribute fallthrough. A component with several root nodes, or with
`inheritAttrs: false`, drops them — the same existing limitation as `data-lfc-location`, documented
rather than fixed here. An older `frontend-core` ignores `rendering.markdown`; hand-written markers work
regardless of version.

## Markdown pages and negotiation

A Nitro middleware registered by this module handles four cases.

**1. `GET /<path>.md`**

1. Call `ai-ready:markdown:source` with `{ route, event, source: null }`. If a listener sets `source`
   (`{ markdown, title?, description?, updatedAt? }`), layer frontmatter over it and respond — no
   render.
2. Otherwise fetch `/<path>` from the server itself (internal header set, so the request does not
   negotiate again; `redirect: 'manual'`; follow at most one same-origin redirect, otherwise pass the
   redirect on).
3. Non-`text/html` or 404 → upstream's Markdown "Page not found" body, status 404.
   Any other non-OK status is passed through.
4. Convert with `mdream`: resolve options, call `ai-ready:mdreamConfig(options)`, convert, call
   `ai-ready:page:markdown({ html, markdown, route, title, description, isPrerender: false, event })`.
5. Frontmatter: `title`, `description`, `canonical_url`, `last_updated` (when the HTML carries one),
   `locale`.
6. Headers: `Content-Type: text/markdown; charset=utf-8`; `Link` with `rel="alternate"; type="text/html"`
   and `rel="canonical"` pointing at the HTML page, plus `rel="describedby"` → `/llms.txt` when
   enabled; `Cache-Control` from `markdownCacheHeaders` (default `maxAge: 3600, swr: true`);
   `X-Robots-Tag` (below).

**2. HTML route, request prefers Markdown** (`Accept: text/markdown`, or a known AI agent, as decided by
`@mdream/js/negotiate`) → `307` to `<path>.md`, `Vary` set, `Cache-Control: private, no-store`.

**3. HTML route, browser negotiation** → append `Vary`, set
`Link: <….md>; rel="alternate"; type="text/markdown"` plus `rel="describedby"` → `/llms.txt` when
enabled, continue to the page. A server-only Nuxt plugin also adds
`<link rel="alternate" type="text/markdown" href="….md">` to the head.

**4. Anything else** (`/.well-known/*`, `/api/*`, files with an extension, the internal fetch) → skip.

Nitro route rules can disable negotiation per route, as upstream allows.

### Default conversion options

```ts
mdreamOptions: {
  minimal: true,
  clean: true,
  filter: {
    exclude: [
      '[data-lfc-location="header"]',
      '[data-lfc-location="footer"]',
      '[data-markdown-ignore]',
    ],
  },
}
```

`frontend-core` renders no `<main>`, so relying on mdream's `isolateMain` heuristics would be a guess;
every section root does carry `data-lfc-location`, which was verified to work as an mdream filter
selector. Project `mdreamOptions` merge over this default (arrays concatenate), so a project can add
selectors without restating ours.

### Robots on `.md`

The page's `<meta name="robots">` content is copied onto the `.md` response as `X-Robots-Tag`. This one
mechanism covers pages with `seo.robots: noindex`, markets that are not launched, and preview
environments, because `frontend-core` renders the tag in all three. Upstream sets no such header; the
addition is compatible and would be re-added as a Nitro plugin after migration.

### JSON-LD

mdream drops `<script>` elements, so every `application/ld+json` block would be lost —
`SectionBreadcrumbs` emits a `BreadcrumbList` via `useHead`, which lands in `<head>`. This module
registers its own `ai-ready:page:markdown` listener that collects every
`<script type="application/ld+json">` from the full HTML (head and body, before any exclusion — opting a
section out of Markdown never removes structured data) and appends:

````md
## Structured Data

```json
{ …pretty-printed… }
```
````

One fenced block per script. A script whose content does not parse as JSON is passed through verbatim
rather than dropped. Being a hook listener, it keeps working unchanged after migration.

### Cost

Every uncached `.md` response costs a full SSR render plus conversion, as upstream. We rely on
`markdownCacheHeaders` and the CDN.

## `/llms.txt`

A curated index, per the llms.txt proposal — **not** a dump of every URL. Upstream AI Ready lists every
sitemap URL; for a shop that is tens of thousands of lines and duplicates the sitemap. This is a
deliberate divergence: at migration, this handler is kept and overrides upstream's `/llms.txt` route;
everything else is replaced.

Built per request host, in upstream's layout:

```
# <site name for this host>
> <site description>

Canonical Origin: https://<host>/

<notes>

## LLM Resources
- [sitemap_index.xml](…): XML sitemap for search engines and crawlers.
- [robots.txt](…): Crawler rules and permissions.

## <authored sections…>

## Optional
<authored sections marked optional>

## Available Languages on Website        ← only when the host serves more than one language
- [Deutsch (de)](…): content included below.
- [English (en)](…): visit this language for content.

## Pages
- [Home](https://…/index.md): <seo.description>
- [Shipping & Returns](https://…/shipping.md): …

## Page Types
- [Product Detail Page](https://…/<product sitemap>.xml): ~12,400 pages at /p/{slug}. Append .md to any URL for Markdown.
```

Section order follows upstream's `buildLlmsTxt`: header, notes, required authored sections, `## Optional`,
languages, then the generated lists. `## Page Types` is our addition and comes last.

- **Header** — site name as this module already resolves it per host (`siteNameByHost`), description
  from site config, canonical origin of the request host.
- **Authored** — `aiReady.llmsTxt.notes` and `.sections` (`{ title, description?, optional?, links:
  [{ title, href, description? }] }`), one version per project, not localized. The sitemap and robots
  links are appended to the first section, `LLM Resources`, as upstream does (upstream's own first
  entry, `llms-full.txt`, is absent because we do not serve it).
- **Pages** — configured pages for the host's default language, through the same filters as the
  sitemap (`isPageIncluded`: catch-all, `excludePageTypes`, market scoping, noindex). Title and
  description from the default variant's `seo`; a value that is a `{{…}}` template falls back to the
  path. Links point at the `.md` twin (`markdownLinks`). Descriptions truncated to 160 characters,
  grouped and ordered by upstream's path-prefix algorithm.
- **Page Types** — one line per dynamic page type that has a sitemap source for this locale:
  - URL pattern from the configured route template, `:param` rendered as `{param}`.
  - Link to that page type's child sitemap for the locale.
  - Count (`~N pages`) only when a **complete** snapshot exists in the store, read directly. llms.txt
    never triggers a rebuild pass and never calls upstream; without a complete snapshot the count is
    omitted.
  - Title and description from our extension `aiReady.llmsTxt.pageTypes`:
    `{ '<token>': { title?, description? } | false }`. `false` hides the type. Default title is the
    humanized token (`ecommerce/product-detail-page` → "Product Detail Page").
- **Languages** — languages this host serves, each linking to its home page, default language first.
- **Unlaunched market or preview environment** — header and authored parts only; Pages and Page Types
  empty (same rule as `belongsInSitemap`).
- **Caching** — `llmsTxtCacheSeconds` (default 600) → `Cache-Control: public, max-age, s-maxage,
  stale-while-revalidate`. The server-side cached function is keyed by host; upstream's is not, which
  would serve one market's file to another.

No changes to the snapshot store.

## Content Signals default

Today `robots.customGroups[].contentSignal`/`contentUsage` exist, but nothing is emitted unless a
project writes a custom group. Add a default for the wildcard group:

- `Content-Signal: search=yes, ai-input=yes`
- `Content-Usage: search=y, ai-output=y`

`ai-train` is deliberately left unset: allowing or reserving training use is the merchant's legal
decision (in the EU a `no` acts as the Art. 4 DSM text-and-data-mining opt-out, a `yes` waives it), and
"no preference stated" is the honest default. Emitted only in indexable robots output. A project
overrides the values, or clears them with `[]`. Exact config placement (top-level `robots.contentSignal`
/ `robots.contentUsage` applied to the `*` group, reusing the existing validation schemas) is settled in
the plan. Whether isitagentready.com passes a signal set without `ai-train` is unverified and is checked
against the live scan after release.

## Configuration

```ts
'essentials-seo': {
  aiReady: {
    enabled: true,
    contentNegotiation: true,
    describedby: true,
    mdreamOptions: { /* merged over the default above */ },
    markdownCacheHeaders: { maxAge: 3600, swr: true },
    llmsTxtCacheSeconds: 600,
    llmsTxt: {
      markdownLinks: true,           // upstream default: false
      notes: '' as string | string[],
      sections: [],
      pageTypes: {},                 // our extension; dropped when forwarding to upstream
    },
  },
  robots: {
    // new defaults, see "Content Signals default"
  },
}
```

Validated with zod in `src/types.ts` like the existing options, so a bad Cockpit value fails the build.
Defaults that differ from upstream: `markdownLinks: true`, `pageTypes` (extension). `describedby`
matches upstream (`true`) — the scanner's `linkHeaders` check only counts `describedby`, `api-catalog`,
`service-desc` and `service-doc`.

## Testing

**Unit** (Vitest, pure modules):

- Negotiation decision: `Accept` variants, AI agent user agents, explicit `.md`, internal header,
  route-rule opt-out, skipped paths.
- Frontmatter builder; meta robots → `X-Robots-Tag`; JSON-LD extraction and appending (several
  scripts, invalid JSON, head and body, none).
- `Link` header builder: HTML and `.md` variants, with and without `describedby`.
- llms.txt formatter as a pure function from a model to a string: header, notes, optional sections,
  Pages, Page Types, languages, truncation.
- Page-type summary: template → `{param}`, token humanizing, `pageTypes` override and `false`, count
  only for complete snapshots.
- Config schema: defaults, `mdreamOptions` merge, Content Signals default and clearing.

**Upstream contract** — golden strings captured from `nuxt-ai-ready@2.4.0` (version recorded in the
fixture): link-line format, section order, frontmatter keys, `Link` header syntax, the 404 body. Re-run
against upstream at migration to see what visibly changes.

**Integration** (`test/fixtures/seo`), with a page using `data-markdown-ignore`, a section with
`rendering.markdown: false`, a JSON-LD script and a noindex page added to the fixture:

- `GET /foo.md`: header, footer and ignored parts absent; JSON-LD block present; frontmatter and
  headers correct.
- Noindex page and unlaunched market: `X-Robots-Tag: noindex` on the `.md`.
- `Accept: text/markdown` on an HTML URL → 307 to `.md` with `Vary`; browser `Accept` → HTML with the
  `Link` header and the head `<link>`.
- Missing page → Markdown 404.
- `/llms.txt`: configured pages and authored sections present; Page Types count absent, then present
  after seeding a complete snapshot via `__seed-snapshot`; unlaunched market has no page lists; two
  hosts get different output.
- robots.txt carries the default Content Signals in indexable output only.

**`frontend-core`** — `SectionRenderer` and `BlockRenderer` stamp `data-markdown-ignore` exactly when the
definition sets `rendering.markdown: false`.

**After release** — scan `laioutr.com` on isitagentready.com; expect Content Signals, Markdown
negotiation (verify the scanner follows the 307) and Link headers to pass, i.e. level 3.

## Later (not in this design)

- **API Catalog** (`/.well-known/api-catalog`, RFC 9727) and **Agent Skills index**
  (`/.well-known/agent-skills/`), using upstream's `apiCatalog` / `agentSkills` config shapes. Either
  reaches level 4 on isitagentready.com.
- **Product JSON-LD** (`Product`, `Offer`, `AggregateRating`) on PDP sections in `ui-app` — only
  `BreadcrumbList` exists today.
- **Platform topic, separate from this module:** agentic commerce (UCP, ACP) and a shop MCP server,
  built on orchestr's cart/checkout abstraction. A discovery document without a working implementation
  behind it would pass a scanner and break every agent that uses it.

## Findings recorded along the way

- `sport-korting.nl` answered `429` (Cloudflare) to both the scanner and a single plain request —
  worth checking its bot settings before any agent-readiness work matters there.
- `laioutr.com` sends each `preconnect` origin twice across two `Link` values — likely a small
  `frontend-core` bug, unrelated to this design.
