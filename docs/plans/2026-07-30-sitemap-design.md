# Sitemap & robots.txt for `@laioutr/app-essentials-seo` — Design

**Date:** 2026-07-30 · **Status:** approved, ready for an implementation plan
**Repo:** `app-essentials-seo` (currently the untouched Laioutr app template, `my-laioutr-app`)
**Depends on:** `@laioutr-core/orchestr` page-index **with cursor resume**, `@nuxtjs/sitemap`,
`@nuxtjs/robots`, `nuxt-site-config`

> This design assumes the orchestr page-index cursor work is **already implemented** — specified in
> the laioutr repo at `docs/plans/2026-07-30-page-index-cursor-resume-design.md`. It is a hard
> prerequisite, not a follow-up; §9 does not converge without it. See §2.1.

## 1. Scope

`@laioutr/app-essentials-seo` will eventually wrap the whole `@nuxtjs/seo` bundle. This design covers
the first two surfaces: **`sitemap.xml`** and **`robots.txt`**. `nuxt-og-image`, `nuxt-schema-org`
and `nuxt-link-checker` are out of scope, but the module shell is shaped so each is added later as
one config namespace plus one `installModule` call.

Out of scope, deliberately:

- Prerendering / SSG of sitemaps. The page-index prerender spike (in the **laioutr** repo, at
  `docs/research/2026-07-28-page-index-prerender-spike.md`) found a 4 GB build OOM caused by Nitro's
  second Rollup build, independent of catalogue size. Nothing here prerenders.
- The per-page `robots` meta tag. `frontend-core`'s `PageRenderer.vue` already resolves
  `pageVariant.seo.robots` and force-overrides preview renders to `noindex, nofollow`.
- Page-level SEO fields (title, description). Already owned by frontend-core.

## 2. Prerequisites

### 2.1 orchestr page-index cursor resume — **shipped in `@laioutr-core/orchestr@0.38.1`**

The landed API is a **separate function**, `listPagesFrom`, not an option on `listPages`:

```ts
import { listPagesFrom } from '#imports';

const stream  = listPagesFrom(token, { clientEnv, event, take: BATCH, resumeFrom: saved.cursor });
const entries = await stream.toArray();   // exactly once — toArray() restarts the walk
saved.cursor  = stream.endCursor;         // read after consumption; undefined ⇒ exhausted
```

Four properties of the shipped implementation that the design has to respect:

- **`take` is required.** `ListPagesFromOptions.take` is non-optional — *"an unbounded
  cursor-addressed pass is just `listPages()`"*.
- **`endCursor` is directional.** `undefined` means "start at the beginning" going in and "exhausted"
  coming out. `iterateResumed` resets it at the start of every iteration and sets it only on the pass
  that fills `take`. Accumulation must be `do…while`, never `while (cursor)`.
- **The resume token is not bound to its enumeration.** It encodes only `{ cursor, skip }`;
  *"a token fed to a different enumeration resumes at a meaningless position: callers must key their
  stored tokens by that triple themselves."* §9.1's key does — `host` fixes the market, `sitemapName`
  fixes the page type and locale.
- **A non-resumable handler throws**, naming the page type and telling the author to return
  `paginate(fn, startCursor)`. It does not degrade silently. §9.3 handles it.

`ListPagesOptions.skip` (§3.4 of the orchestr design) **did not ship**. Nothing here needs it.

Each pass costs `take` entries of upstream work plus at most one redundant page fetch,
**regardless of cache state**. This is what makes §9's snapshot converge across crawls; `skip` would
not, because it resolves through the chunk chain whose 1h TTL is far shorter than the interval
between crawls.

Two properties of that mode shape §9 and are easy to miss:

- **A `resumeFrom` walk writes no chunks.** It is cursor-addressed, not position-addressed, so it
  cannot compute a chunk index. Our rebuild therefore neither reads nor writes the page-index chunk
  chain — it is not a dependency *and* not a beneficiary, and it does not warm the chain for the
  editor picker.
- **`resumeFrom` throws against a non-resumable handler** rather than silently restarting at entry 0.
  A page type whose registration returns a plain array, or whose result a middleware replaced with
  one, fails on the first pass. §9.3 handles it.

### 2.2 frontend-core drops the robots install — **not yet shipped**

`@laioutr-core/frontend-core@0.38.1` still declares `@nuxtjs/robots` as a dependency and still calls
`installModule('@nuxtjs/robots')`. This remains an open prerequisite for the robots half of the work;
the sitemap half does not depend on it.

Two lines leave frontend-core, plus a changeset:

```
packages/frontend-core/src/module.ts:218   - await installModule('@nuxtjs/robots')
packages/frontend-core/package.json:54     - "@nuxtjs/robots": "^5.4.0"
```

Justification: no `useRobotsRule`, `defineRobotMeta`, `getSiteRobotConfig`, `<RobotMeta>`,
`useSiteConfig` or `defineSiteConfig` call exists anywhere in `packages/*/src` or `apps/*/src` —
frontend-core installs the module and never uses it. What regresses for a project without this app
installed: `/robots.txt` starts returning 404, and the `X-Robots-Tag` header disappears. A 404
robots.txt means "crawl everything", which is what the current default content says, so the
regression is cosmetic — but it is a behaviour change and needs the changeset.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Sources keyed **per page type × locale** | One enumeration per source. The host already partitions markets, so a single-language host gets one file per type. |
| D2 | **Opt-out** inclusion, honouring two existing signals | `RcPageVariant.seo.robots` for configured pages, `PageIndexMeta.noindex` for page-index entries. Correct with zero config. |
| D3 | Config surface is a **curated subset**, not upstream passthrough | Upstream `ModuleOptions` contain functions and deep unions that can never render as a Cockpit form. |
| D4 | **All** config flows through the `@laioutr/app-essentials-seo` key | Cockpit only permits app config under the key matching the package name. |
| D5 | This app **owns** the `@nuxtjs/robots` install | Nothing in the monorepo uses the module's API; owning it makes build-time options reachable. |
| D6 | robots.txt `Disallow` is **independent** of sitemap exclusions | `Disallow` prevents crawling, which prevents Google reading `noindex`. Deriving one from the other breaks the exclusions it tries to enforce. |
| D7 | URLs supplied via the nitro **`sitemap:sources`** hook, not source endpoints | Gives us `event` (needed for host resolution and `listPages`), avoids an internal HTTP hop, and avoids the Host-header-forwarding question. |
| D8 | Exactly **one** hook of our own | Only the `PageIndexEntry → SitemapUrl` mapping is unreachable from upstream hooks. |
| D9 | Own **snapshot cache** keyed by `(host, sitemapName)`; module SWR cache off | The module's cache key composition is undocumented and one build serves every host. |
| D10 | Bounded work per request via a **resumable snapshot**, not URL-level shards | Achieves the same bounded-request property as page-sharding without a runtime-derived shard count that the module's build-time `sitemaps` config cannot express. See §3.1. |

### 3.1 Prior art, and where this deliberately diverges

Every comparable platform splits sitemaps **by type**, never by locale, because the host already
partitions locales for them.

| Platform | Structure | Locale handling |
|---|---|---|
| Shopify (hosted) | `/sitemap.xml` index → `sitemap_products_1.xml`, `sitemap_collections_1.xml`, … chunked ~5,000 | Each international domain serves its own |
| Shopify Hydrogen | `sitemap.xml` + `sitemap.$type.$page.xml`, sharded type × page | One `<url>` per locale inside a shard, with `xhtml:link` alternates; 24h cache header |
| Shopware 6 | One sitemap per sales channel, no master across shops | Each domain submitted separately |
| `@nuxtjs/sitemap` | Named sitemaps at `/__sitemap__/<name>.xml`, index at `/sitemap_index.xml`, `chunks: true` → `<name>-0.xml` | `_sitemap` key routes a URL to a named sitemap |

Hard constraints from [sitemaps.org](https://www.sitemaps.org/protocol.html): 50,000 URLs and 50 MB
per file; a sitemap index may not list more than 50,000 sitemaps; **all URLs in a sitemap must be
from a single host** and use the same protocol; an index may only reference sitemaps on its own
domain. Google relaxes exactly one of these — [alternate URLs may cross
domains](https://developers.google.com/search/docs/specialty/international/localized-versions).

On bounding work per request, the prior art is unanimous: Next.js
[`generateSitemaps`](https://nextjs.org/docs/app/api-reference/functions/generate-sitemaps) fetches
only its own slice per shard, and Shopify hit the same wall in Hydrogen — [sitemap generation
exceeding worker execution
limits](https://community.shopify.com/t/how-can-i-improve-sitemap-generation-speed-in-a-hydrogen-storefront/240806)
past ~250 resources — fixing it by adding a page-numbered `sitemap(type:)` query to the Storefront
API.

**We take the same property by a different route.** URL-level sharding would need one declared
`sitemaps` key per shard, and `@nuxtjs/sitemap` resolves that config at **build time** while the
shard count (`ceil(countPages() / size)`) is **runtime, per-market** data. Reconciling the two means
either declaring a generous fixed upper bound and trimming the index at runtime — hundreds of dead
config keys — or abandoning the module's routing and rendering entirely.

The resumable snapshot (§9) gets the same bounded-request guarantee without that: each request
advances the accumulation by a fixed batch and returns, and successive crawls converge. Output size
is then handled where it belongs, on the output side, by the module's `chunks: true`. The visible
structure stays type × locale, so **no sitemap URL ever changes** and no Search Console
resubmission is needed.

## 4. Platform constraints this design is built around

**Host-per-market.** `RenderMarketDomain` is `{ host, path?, languageId, devHost }`. One build serves
every market's host. A market may also serve several languages off path prefixes on one host
(`example.com` + `example.com/fr`).

**i18n is `no_prefix`.** `frontend-core/src/module.ts:257,323` configures `@nuxtjs/i18n` with
`strategy: 'no_prefix'` and does its own market detection, so `@nuxtjs/sitemap`'s `autoI18n`
integration never fires. We drive locales ourselves and set `excludeAppSources: true`, because
laioutr's routes are param templates with locale aliases, not URLs.

**Site config is a per-request stack.** `nuxt-site-config`'s init middleware assembles layers by
priority:

| Priority | Layer | Source |
|---|---|---|
| −4 | `nitro:init` | `url` from `useNitroOrigin(e)` → `getRequestHost(e, { xForwardedHost: true })` |
| 0 | `runtimeEnv` | `runtimeConfig.site`, `runtimeConfig.public.site`, `NUXT_SITE_*` env |
| — | build stack | `site: {}` in `nuxt.config` |
| — | route-rules | `routeRules[path].site` |
| 0 | `multiTenancy:<host>` | `site.multiTenancy: [{ hosts, config }]` matched on request host |
| — | `site-config:init` | nitro hook |

Two consequences: `site.url` is **already request-host-derived** provided we never set it, and
`multiTenancy` is a first-class host-matched layer that maps directly onto laioutr markets. The
middleware warns that site config is unavailable *inside server middleware* — our code must live in
route handlers and nitro hooks only.

**Page-index chunk TTL is 1 hour.** `pageIndexCache.ts` sets `expiresAt = now + ttl`,
`refreshAt = now + 0.8 × ttl`, with `DEFAULT_ENUM_TTL = '1h'`, and `iterateEnumerate` breaks its read
loop on `chunk.expiresAt <= Date.now()`. Crawlers revisit sitemaps hours-to-days apart, so the chain
is usually cold at crawl time. This is precisely why §9 resumes via `resumeFrom` (connector-level,
cache-independent) rather than `skip` (chain-dependent).

## 5. Module shell & config surface

Package renames to `@laioutr/app-essentials-seo` with `configKey: name`. `frontend-core/src/module.ts:409`
assigns `laioutrrc.apps[].config` onto `nuxt.options[name]`, so **`ModuleOptions` is the
Cockpit-editable surface** with no extra plumbing.

Two artefacts:

| Artefact | Role |
|---|---|
| `src/module.ts` → `ModuleOptions` | Hand-authored, independent of `@nuxtjs/*` types |
| `src/lib/toUpstreamConfig.ts` | Maps our options + laioutrrc onto `site` / `sitemap` / `robots`. The only place upstream shapes appear. |

`ModuleOptions` is deliberately **curated**, not a passthrough of upstream `ModuleOptions`: it must
stay independent of upstream churn, must not confuse editors with options that do not apply, and must
be renderable as a form once the app-config GUI mechanism ships. Every field maps to one
`SystemFieldDefinition` (`text · textarea · number · select · radio · checkbox · toggleButton · info ·
json · richtext · array · object · secret`).

| Group | Field | Field type | → upstream |
|---|---|---|---|
| Visibility | `siteName` | `text` | `site.name` |
| | `indexable` | `select` auto/always/never | `site.indexable` (auto → unset) |
| | `environment` | `select` production/staging/preview/development | `site.env` |
| Sitemap | `enabled` | `checkbox` | `sitemap.enabled` |
| | `excludePageTypes` | `array<select>` | source generation |
| | `pageTypes` | `array<object>`: `pageType`, `priority`, `changefreq`, `include` | per-source defaults |
| | `defaultChangefreq` / `defaultPriority` | `select` / `number` | `sitemap.defaults` |
| | `includeImages` | `checkbox` | `previewImage` → `<image:image>` |
| | `rebuildBatchSize` | `number` (default 10 000) | entries per snapshot rebuild pass |
| Robots | `enabled` | `checkbox` | `robots.enabled` |
| | `blockAiBots` / `blockNonSeoBots` | `checkbox` | same names |
| | `extraDisallow` | `array<text>` | appended to derived `robots.disallow` |
| | `customGroups` | `array<object>`: `userAgent`, `allow`, `disallow` | `robots.groups` |

`ModuleOptions` gets a zod schema, composed as `z.object({ ...base.shape, … })` per the monorepo's
`zod-schemas` rule.

**Derived, never asked** — computing these is the app's value:

```
site.trailingSlash    ← laioutrrc.config.trailingSlash   (frontend-core's 0.trailingSlash.ts
                                                          301-redirects any mismatch)
site.multiTenancy     ← markets → domain hosts + devHosts
site.url              ← left UNSET so nitro:init derives it per request
sitemap.sitemaps      ← page types × locales
sitemap.excludeAppSources: true
robots.sitemap        ← ['/sitemap_index.xml'], relative on purpose
robots.metaTag: false ← frontend-core's PageRenderer owns that tag
robots.disallow       ← ['/api/', '/_laioutr/']
```

`setup()` fans out **before** each install, which is what owning the installs buys:

```ts
const derived = deriveSeoConfig(laioutrrc);
nuxt.options.site    = defu(mapped(options).site,    nuxt.options.site,    derived.site);
nuxt.options.sitemap = defu(mapped(options).sitemap, nuxt.options.sitemap, derived.sitemap);
nuxt.options.robots  = defu(mapped(options).robots,  nuxt.options.robots,  derived.robots);
await installModule('@nuxtjs/sitemap');
await installModule('@nuxtjs/robots');
```

`defu` concatenates arrays and merges objects, so `robots.disallow` becomes our internals *plus* the
project's rules, and a project may add its own entry to `sitemap.sitemaps` without clobbering ours.

**Precedence:** `derived` < developer's raw `nuxt.options.*` < app config. App config wins so a
Cockpit change always visibly takes effect; raw `nuxt.config` remains a developer escape hatch for
anything the curated schema does not expose. Any key set in both is warned about at build time.

Three derived values the project should not fight — `sitemap.sitemaps`, `site.multiTenancy` and
`site.url`. Project entries merge into the first two; ours are not removable. Setting `site.url` is
permitted but warns when more than one host is configured, because it would pin every market to one
origin.

**Deferred:** `src/app-schema.ts` and the `build.config.ts` schema-emit hook. The app-config GUI
mechanism has not shipped; `ModuleOptions` is shaped to map onto it when it does.

## 6. URL sources & data flow

### 6.1 Build time

`toUpstreamConfig` partitions `laioutrrc.pages` by whether the path carries `:params`:

```
laioutrrc.pages
├─ no ':' in path  → all of them → one key per locale:  pages-<locale>
└─ has ':' in path → grouped by page.type → one key per (type, locale):
                                            ecommerce-product-detail-page-<locale>
```

Page-type tokens contain `/`, so the key slug is `token.replaceAll('/', '-')` — keeping namespaces
distinct so `ecommerce/category` and `cms/category` cannot collide. Keys must be static at build, so
**all** locales get keys; per-host filtering happens at request time. Each entry gets
`chunks: true, chunkSize: 50_000`, which splits an already-resolved list on the output side to stay
inside the protocol limit.

### 6.2 Request time

One nitro plugin, two upstream hooks:

```
GET https://shop.ch/__sitemap__/ecommerce-product-detail-page-de.xml
  │
  ├─ sitemap:sources ─── ctx.sitemapName → { token, locale }
  │                      getRequestHost(event, { xForwardedHost: true })
  │                      i18nConfig.hostToMarket[host] → market
  │                      market.domains.find(d => d.host === host
  │                                            && d.language.code === locale)
  │                      → clientEnv { locale, currency, market, language, domain }
  │                      → ctx.sources.push({ context, urls })
  │
  └─ sitemap:index-resolved ─── drop every child sitemap whose locale
                                this host does not serve (single-host rule)
```

`clientEnv` is built to the same shape as frontend-core's `resolveDefaultClientEnv`:
`{ locale, currency, isPreview: false, market, language, domain }`.

The snapshot cache (§9) is consulted **inside this `sitemap:sources` handler**, before either builder
runs: a fresh snapshot is pushed straight to `ctx.sources` and neither `#laioutr/rc` nor `listPages`
is touched.

`ctx.sitemapName` needs a parser tolerant of the module's chunk suffix: with `chunks: true` a request
for `<key>-0.xml` arrives with the chunk index appended, and it must resolve to the same
`(token, locale)` — and therefore the same snapshot key — as the unchunked name.

### 6.3 The two builders

| | Configured pages | Page-index entries |
|---|---|---|
| Enumerate | `#laioutr/rc` in-process | `listPagesFrom(token, { clientEnv, event, take, resumeFrom })` |
| Skip when | type excluded · `core/404` · `marketIds` excludes this market · default variant's `seo.robots` matches `/noindex/` | `meta.noindex === true` |
| `loc` | `composePath(domain.path, unlocalize(page.path, localeChain), trailingSlash)` | same, with `fillParams(path, entry.params)` |
| `lastmod` | `page.updatedAt` | `entry.meta.lastModified` |
| `images` | — | `entry.meta.previewImage` when `includeImages` |
| `alternatives` | full cross-host hreflang | none |

"Default variant" means the variant with no `conditions`; if every variant is conditional, the first
is used. Configured pages are cheap and finite, so they are always built in full — only the
page-index builder accumulates.

**Why page-index entries carry no `alternatives`.** Correlating one product across locales needs
either `locatePage` per entry (tens of thousands of point lookups) or one enumeration per locale
joined on `PageIndexEntry.subject`. The second is cheaper but re-introduces the N-enumerations-per-
request cost that per-locale keying exists to avoid. It is also redundant: `PageRenderer` already
emits complete hreflang in the page `<head>` via `usePageAlternateParams` → `locatePage` →
`buildHreflangLinks`, and Google treats head and sitemap hreflang as equivalent. Configured pages
keep alternates because they are pure path composition. The asymmetry breaks no reciprocity rule —
reciprocity binds declared pairs only.

### 6.4 Accepted duplication

`buildHreflangLinks`, `fillParams`, `composePath` and `unlocalize` live in frontend-core's `runtime/`
and are not exported. This app reimplements the ~40 lines it needs rather than deep-importing across
a package boundary, with tests ported from frontend-core's own suites so drift surfaces as a failure.
Exporting these four from frontend-core is a worthwhile follow-up once this app proves the shape.

### 6.5 Path-prefixing exception

`/sitemap_index.xml`, `/__sitemap__/*.xml` and `/robots.txt` sit at the root, contrary to the
monorepo's `app-path-prefixing` rule. They are well-known paths fixed by external specs and crawler
convention; no alternative location is discoverable by a crawler. This is a deliberate, documented
exception limited to these three patterns — every other path this app might own stays under
`/app-essentials-seo/`.

## 7. robots.txt & site config

### 7.1 Derived robots config

```ts
robots: {
  sitemap: ['/sitemap_index.xml'],     // relative on purpose
  disallow: ['/api/', '/_laioutr/'],
  metaTag: false,
  header: true,
}
```

`sitemap` stays relative because the robots.txt route maps any entry not starting with `http` through
`withSiteUrl(e, s, { absolute: true })`, and `site.url` is request-derived — so one build emits
`Sitemap: https://shop.ch/sitemap_index.xml` on `shop.ch` and `https://shop.de/…` on `shop.de`, with
no hook and no per-host config.

Both disallow paths are real: `/api/laioutr/*` is gated by frontend-core's `laioutrProtectedRoutes`
middleware, and `/_laioutr/reflect` is registered at `frontend-core/src/module.ts:386`.

`metaTag: false` because `PageRenderer.vue` already resolves `pageVariant.seo.robots` and
force-overrides preview renders — leaving the module's own meta tag on would put two writers on one
tag. `header: true` is safe: where header and meta disagree, Google applies the more restrictive rule,
so the preview override still wins.

We deliberately do **not** blanket-block `/app-`; legitimate app pages live there.

### 7.2 Closing the preview-indexing gap

`getSiteIndexable` returns `env === 'production'` when `indexable` is unset. Nothing in laioutr or
Cockpit's hosting generator sets `NUXT_SITE_ENV`, `NUXT_PUBLIC_SITE_ENV` or `site.env`, and a Vercel
build runs with `NODE_ENV=production` — so **preview and staging deployments currently serve an
allow-all robots.txt.** This app closes that.

`site.env` resolves at build, first match wins:

```
options.environment ?? process.env.NUXT_SITE_ENV ?? process.env.VERCEL_ENV ?? 'production'
```

Cockpit's `managed-vercel.ts:97` deploys with `target: 'production' | 'staging'`, so a staging deploy
yields a non-production `VERCEL_ENV`, `getSiteIndexable` returns false, and the robots.txt route
collapses the whole file to `User-agent: *` / `Disallow: /` and drops the `Sitemap:` lines.
`indexable: 'auto'` (default) leaves `site.indexable` unset so `env` decides; `always` / `never` pin
it.

### 7.3 Derived site config

```ts
site: {
  name: options.siteName,
  env: resolvedEnv,
  trailingSlash: laioutrrc.config.trailingSlash ?? false,
  multiTenancy: markets.flatMap(m => m.domains.map(d => ({
    hosts: [d.host, d.devHost],
    config: { name: options.siteName ?? m.name, defaultLocale: d.language.code },
  }))),
  // url: deliberately absent
}
```

## 8. Extension surface

Applying the monorepo's `nuxt-hooks` rule — *a hook earns its keep wherever code runs an effect the
developer cannot otherwise reach*:

| Effect | Reachable without our hook? | Verdict |
|---|---|---|
| Transform the final URL list | Yes — `sitemap:resolved` fires at the emission site | No hook |
| Add URLs from another app | Yes — `sitemap:sources` is public | No hook |
| Modify robots.txt | Yes — `robots:config` / `robots:robots-txt` | No hook |
| Derive upstream config at build | Yes — a developer sets `nuxt.options.sitemap`, we defu it | No hook (pure producer) |
| **Map a `PageIndexEntry` → `SitemapUrl`** | **No** | **One hook** |

By the time `sitemap:input` fires, the `PageIndexEntry` is gone — `subject`, `meta.previewImage` and
the resolved market/domain have been discarded into a bare `SitemapUrl`. That is the one effect no
upstream hook reaches.

```ts
// nitro hook — fires once per rebuild pass, before urls are appended to the snapshot
'essentials-seo:sitemap-source:resolve': (ctx: {
  event: H3Event;
  token: PageTypeToken | null;                     // null for the configured-pages source
  locale: string;
  market: RenderMarket;
  domain: RenderMarketDomain;
  entries: readonly (PageIndexEntry | RcPage)[];   // raw, index-aligned with urls
  urls: SitemapUrl[];                              // mutated in place; null a slot to drop it
}) => void | Promise<void>;
```

Named `namespace:entity:action` per the rule, with `essentials-seo` matching the app-path namespace.
Once per rebuild pass, not once per URL — a 20k-product sitemap must not fire 20k handlers. Because
it fires per pass, a handler sees each entry exactly once across an accumulation, and its output is
what gets persisted into the snapshot.

Two deviations from the rule, both because this is a nitro hook rather than a Nuxt app hook:

1. **No `getHookResult`.** That helper imports `#app` and drives `nuxt.hooks.callHookWith` with a
   synchronous caller. Nitro has a separate `nitroApp.hooks` instance and no equivalent; we
   `await nitroApp.hooks.callHook(...)`, which awaits handlers properly.
2. **No `result: { value }` slot.** The slot exists because hookable ignores handler return values, so
   mutation is the only way out — and `urls` is a mutable array, so in-place mutation already
   satisfies that. This also matches every nuxt-seo nitro hook (`ctx.sources`, `ctx.urls`,
   `ctx.sitemaps`), keeping one idiom across the whole surface.

Everything else is nuxt-seo's own surface, documented rather than wrapped:

```
sitemap:sources         add URLs from another app
sitemap:input           insert before resolution
sitemap:resolved        transform / remove, per sitemap
sitemap:index-resolved  add external sitemaps to the index
robots:config           per-request robots rules (e.g. an app disallowing its /app-<name>/ paths)
robots:robots-txt       final string
site-config:init        per-request site config layer
```

## 9. Caching, freshness & convergence

### 9.1 The snapshot is an accumulator

```ts
useUserlandCache('essentials-seo')                  // orchestr's app-facing mount
live:    `sitemap:v1:${host}:${sitemapName}`        // host in the key ⇒ provably single-host safe
pending: `sitemap:v1:${host}:${sitemapName}:pending`
value: {
  urls: SitemapUrl[];
  complete: boolean;
  resumeFrom?: string;                              // opaque token; absent once complete
  expiresAt: number;
  refreshAt: number;
}
```

`expiresAt` / `refreshAt` mirror orchestr's `stamps()` convention (`refreshAt = now + 0.8 × ttl`) so
both layers behave identically. TTL is **24h when `complete`, 1h when not** — an incomplete snapshot
is retried within the hour so accumulation makes progress.

**Two keys, because a refresh cannot be atomic.** A stale `complete` snapshot must be rebuilt by
accumulation like any other, and accumulation takes several passes — so it cannot happen in the live
value without serving a partial sitemap in the meantime, and it cannot happen in one `waitUntil`
because a from-scratch walk over a large catalogue is exactly the unbounded work this design exists
to avoid. Accumulation therefore always targets `:pending`, and `:pending` replaces `live` in one
write only when it completes.

```
live complete + fresh    → serve live
live complete + stale    → serve live + waitUntil(advance :pending; swap in when complete)
live incomplete          → serve live + waitUntil(advance live one pass)
live missing             → run one pass inline, store as live, serve
```

The `live incomplete` state exists only for a first build, where serving a growing partial beats
serving nothing. Once a snapshot has ever been `complete`, refreshes go through `:pending` and the
reader never observes a partial again.

A pass is bounded and resumable:

```ts
const stream  = listPagesFrom(token, { clientEnv, event, take: rebuildBatchSize, resumeFrom: snap?.resumeFrom });
const entries = await stream.toArray();          // exactly once — toArray() starts a fresh walk
snap.urls.push(...dedupeByLoc(mapEntries(entries)));
snap.resumeFrom = stream.endCursor;              // read only after consumption
snap.complete   = stream.endCursor === undefined;
```

**This converges.** Each pass costs `rebuildBatchSize` entries plus at most one redundant page,
regardless of chunk-cache state, because `resumeFrom` resumes at the connector. A 50k catalogue at
the 10 000 default completes in five passes — and since a `waitUntil` pass runs on every crawl, that
is five crawls, not five days. The chunk chain is not in this path at all (§2.1).

`waitUntil` work is best-effort on a serverless host: a pass that gets cut short simply leaves
`resumeFrom` where it was, and the next crawl repeats it. Progress is monotonic, never negative —
which is why every pass persists before it returns.

The 24h `complete` TTL decouples sitemap freshness from the connector's 1h page-index TTL. Cockpit's
existing cache-clear endpoint flushes both orchestr mounts, so "clear cache" drops sitemap snapshots
for free.

### 9.2 Output cache

The module's own SWR cache stays **off** (`cacheMaxAgeSeconds: 0`): its key composition is
undocumented and one build serves every host, so a non-host-keyed cache could serve `shop.de`'s XML on
`shop.fr` — an invalid sitemap under the single-host rule.
`Cache-Control: public, max-age=600, s-maxage=86400, stale-while-revalidate=604800` is set explicitly
in `sitemap:output`, which runs after the module's own header logic.

### 9.3 Failure modes

| Failure | Behaviour |
|---|---|
| Connector throws mid-pass | Catch; keep the snapshot at its last good `resumeFrom` and serve what has accumulated. `listPages` does not swallow errors the way `locatePage` does, and a 5xx on a sitemap makes crawlers back off for days. |
| **Handler is not resumable** — `resumeFrom` throws | Fall back to a single `take`-bounded walk with no resume, mark the snapshot `complete` at whatever it collected, and **log an error naming the page type**: this type is capped at `rebuildBatchSize` URLs and cannot converge until its registration threads `startCursor`. Detected on the first pass, so it surfaces immediately rather than after a partial accumulation. |
| Snapshot storage unavailable | Run one pass inline and serve; never fail the request on a cache write failure. |
| No `pageIndex` registration for a token | `listPagesFrom` warns and returns an empty stream whose `endCursor` is `undefined` — which our loop correctly reads as complete. Result is an empty `<urlset>`, logged once per (token, locale). |
| Unknown host (`*.vercel.app`, localhost) | Fall back to `defaultMarket`, matching frontend-core's convention. Preview hosts stay out of the index via `site.indexable`, not via an empty sitemap. |
| `fillParams` leaves a placeholder or empty segment | Skip the entry, log once — otherwise a missing param emits `/products//`. |
| Trailing-slash mismatch | Impossible by construction; derived from `laioutrrc.config.trailingSlash`. |

### 9.4 Consistency

An accumulated enumeration is **eventually consistent, not snapshot-consistent**. Each pass boundary
is a *seam* where upstream may have shifted underneath, so an accumulation over *n* passes carries
*n−1* seams; a catalogue that changes across one can duplicate or omit an entry there. Shopware's
page-number cursor is the worse case, since inserting one product shifts every later page.

Three things bound it: the `:pending` rebuild is a clean from-scratch accumulation, `invalidateEntity`
drops stale page-index values by subject tag, and an incomplete snapshot's 1h TTL keeps the
accumulation window short. None of the three is a *guarantee* — the rebuild runs under `waitUntil`,
which a serverless host may cut short — so nothing here assumes drift is corrected on any particular
schedule.

For a sitemap this is the right trade: a URL briefly duplicated or missing across one refresh cycle
costs nothing, while a permanently truncated sitemap would. Deduplication by `loc` on append is cheap
insurance against the duplicate half and is applied on every pass.

## 10. Testing

Three tiers, weighted toward the first — most of the risk is in pure derivation logic.

**Tier 1 — pure unit tests.** Everything in `src/lib/` is a pure function of
`(laioutrrc, options, host)` and needs no Nuxt.

| Under test | Cases |
|---|---|
| `toUpstreamConfig` | Page partition by `:params` · key slugging (`ecommerce/category` vs `cms/category` must not collide) · `multiTenancy` incl. `devHost` · `site.url` stays absent · precedence · warn on double-set |
| `resolveHostContext` | host → market → domain per locale · multi-locale host via path prefix · unknown host → `defaultMarket` |
| `buildConfiguredPageUrls` | `marketIds` scoping · `seo.robots` noindex on the default variant · `unlocalize` + `localeChain` · prefix composition · trailing slash both ways |
| `buildPageIndexUrls` | `meta.noindex` skipped · `fillParams` incl. `:slug+` · malformed-param rejection · `lastModified` → `lastmod` · `previewImage` → `<image:image>` |
| `alternates` | cross-host hreflang · `x-default` · market-scoped page never points `x-default` at a market where it has no route |
| Snapshot state machine | `complete` → 24h vs `!complete` → 1h · a pass appends and advances `resumeFrom` · `endCursor === undefined` flips `complete` · a throwing pass leaves `resumeFrom` at its last good value · dedupe by `loc` · **a stale refresh accumulates in `:pending` and never mutates `live`** · **`live` is replaced in one write, only once `:pending` completes** · a non-resumable handler caps at one batch, marks `complete`, and logs |

Tests for the reimplemented `fillParams` / `composePath` / `unlocalize` / `buildHreflangLinks` are
**ported from frontend-core's existing suites** (`fillParams.test.ts`, `applyTrailingSlash.test.ts`,
`rcPageToRender.test.ts`), which is what makes the duplication in §6.4 safe.

**Tier 2 — nitro integration** via `@nuxt/test-utils` against a fixture with two markets, three
domains and a fake `pageIndex` registration:

- `/sitemap_index.xml` on host A lists only A's locales; on host B, only B's — the single-host rule,
  the one bug with real SEO consequences
- `/__sitemap__/<key>.xml` returns absolute `<loc>`s on the requesting host, proving `site.url` is
  request-derived
- **Convergence:** with a fake registration of 25 000 entries and `rebuildBatchSize: 10_000`, three
  successive requests yield 10 000 → 20 000 → 25 000 URLs and the third marks `complete`
- A second request against a `complete` snapshot does not call the fake connector at all
- **A stale `complete` snapshot keeps serving its full 25 000 URLs across every pass of the refresh**,
  and flips to the new set in one step — never a partial
- **A registration returning a plain array** (no cursor support) serves one batch, logs an error
  naming the page type, and does not loop
- `/robots.txt` on host A emits `Sitemap: https://a/sitemap_index.xml`; a non-production `site.env`
  collapses it to `Disallow: /`
- A connector that throws mid-pass yields a partial sitemap with **200**, never 5xx, and leaves
  `resumeFrom` recoverable
- `essentials-seo:sitemap-source:resolve` receives index-aligned `entries` / `urls`, and a mutation
  survives into the persisted snapshot

**Tier 3 — XML conformance.** Validate against sitemap 0.9 plus the `xhtml` and `image` schemas, and
assert the 50k / 50 MB bounds so `chunks: true` is proven rather than assumed.

**Not tested:** `@nuxtjs/sitemap` and `@nuxtjs/robots` internals. We assert our inputs and their
observable output. No component tests — this app ships no components.

## 11. Follow-ups

1. **Export `buildHreflangLinks`, `fillParams`, `composePath`, `unlocalize`** from frontend-core and
   drop the duplication in §6.4.
2. **Switch the Shopify `list` path to the Storefront `sitemap(type:)` query**, which offers
   page-numbered random access at 250/page plus `updatedAt` and image. Cheaper per pass than
   resuming a forward-only `products` walk, and a precondition for `ListPagesOptions.skip` ever
   being worth shipping. Tracked in the orchestr cursor design.
3. **`maxDuration` in Cockpit's Vercel generator**, which raises the per-pass budget and lets
   `rebuildBatchSize` grow.
4. **`src/app-schema.ts` + build-time schema emit**, once the app-config GUI mechanism ships.
5. **Remaining `@nuxtjs/seo` modules** — og-image, schema-org, link-checker — one config namespace and
   one `installModule` each.

## 12. To verify during implementation

- Whether `@nuxtjs/sitemap`'s output cache key includes the request host. We sidestep it by disabling
  that cache; confirm and record the answer so §9.2 can be revisited.
- Peak build memory with both modules added. The prerender spike found a 4 GB OOM from Nitro's second
  Rollup build; we add no prerendering but do add two modules to the bundle.
- That `sitemap:index-resolved` can remove entries, not only append. §6.2 depends on removal.
- That `chunks: true` chunk naming (`<name>-0.xml`) stays stable across the module's minor versions,
  since these URLs get submitted to Search Console.
- Snapshot value size. A completed 50k-URL snapshot is order-megabytes; confirm the project-mounted
  unstorage driver accepts it, and split into keyed pages if not.
- `typescript` stays pinned to 5.x — a bare `pnpm add -D typescript` resolves to 7.x, whose module
  layout breaks `nuxt-module-build@1.0.1`.
