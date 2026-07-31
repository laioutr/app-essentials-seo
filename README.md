# @laioutr/app-essentials-seo

[![Laioutr][laioutr-src]][laioutr-href]
[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

SEO essentials for [Laioutr](https://laioutr.com) frontends: a per-host `sitemap_index.xml`, its
child sitemaps, and `robots.txt`.

- [✨ &nbsp;Release Notes](/CHANGELOG.md)

Every response this module serves is derived from the requesting host. A Laioutr project can span
several markets and domains behind one deployment; this module resolves the correct, host-specific
sitemap and robots.txt for whichever host the request actually came in on, so there is nothing to
build or configure per market.

## What it serves

Three routes:

- **`/sitemap_index.xml`** — the per-host sitemap index. Lists only the child sitemaps whose locale
  the requesting host actually serves.
- **`/__sitemap__/<name>.xml`** — the child sitemaps themselves.
- **`/robots.txt`** — per-host, with its `Sitemap:` line resolved against the requesting host.

### Child sitemap naming

You will see these names in the index and in logs, so it helps to know how they're built:

- A configured page (a page declared directly in the project, with no route params) becomes
  `pages-<locale>.xml`.
- A page-index-backed page type becomes its token with every `/` flattened to `-`, followed by
  `-<locale>`. The token `ecommerce/product-detail-page` in `de` becomes
  `ecommerce-product-detail-page-de.xml`.

When a child sitemap is large enough to be chunked, the upstream `@nuxtjs/sitemap` module appends a
numeric suffix — `ecommerce-product-detail-page-de-0.xml`, `...-de-1.xml`, and so on. This module
resolves the suffixed name back to its source transparently; there is nothing to configure for it.

## Configuration

Configure this module under its own package name, `@laioutr/app-essentials-seo` — that's also the
app config key, since Cockpit only permits app configuration under the package name.

### Top level

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `siteName` | `string` | _unset_ | Site name used for every market. When unset, each market falls back to its own name. |
| `indexable` | `'auto' \| 'always' \| 'never'` | `'auto'` | `'auto'` leaves indexability unset, so it falls back to `environment === 'production'`. `'always'`/`'never'` force it regardless of environment. |
| `environment` | `'production' \| 'staging' \| 'preview' \| 'development'` | _unset_ | Falls back, in order, to the `NUXT_SITE_ENV`, `NUXT_PUBLIC_SITE_ENV`, then `VERCEL_ENV` environment variables, and finally `'production'` if none are set. |

### `sitemap`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | |
| `excludePageTypes` | `string[]` | `[]` | Page types dropped from the sitemap entirely — both configured pages of that type and any page-index source for it. |
| `pageTypes` | `PageTypeSeo[]` | `[]` | Per-page-type overrides. See below. |
| `defaultChangefreq` | `'always' \| 'hourly' \| 'daily' \| 'weekly' \| 'monthly' \| 'yearly' \| 'never'` | _unset_ | Fallback `changefreq` for a URL that doesn't set its own. |
| `defaultPriority` | `number` (0–1) | _unset_ | Fallback `priority` for a URL that doesn't set its own. |
| `includeImages` | `boolean` | `true` | Emits an `<image:image>` entry when a page-index entry carries a preview image. Only applies to page-index-backed sources — configured pages never carry an image. |
| `rebuildBatchSize` | `integer` (≥ 1) | `10000` | Entries pulled per snapshot rebuild pass. See "Operational notes" below for what happens at the boundary. |

**`sitemap.pageTypes[]`** — one entry per page type you want to override:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `pageType` | `string` | yes | The page type token, e.g. `ecommerce/product-detail-page`. |
| `priority` | `number` (0–1) | no | |
| `changefreq` | same enum as `defaultChangefreq` | no | |
| `include` | `boolean` | no | Set `false` to drop pages of this type from the sitemap. Only affects **configured** pages — it has no effect on a page-index-backed source; use `excludePageTypes` to drop those instead. |

### `robots`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | |
| `blockAiBots` | `boolean` | `false` | Passed through to `@nuxtjs/robots`. |
| `blockNonSeoBots` | `boolean` | `false` | Passed through to `@nuxtjs/robots`. |
| `extraDisallow` | `string[]` | `[]` | Appended to the wildcard (`*`) group's `Disallow` list, alongside this module's own internal `/api/` and `/_laioutr/` entries. |
| `customGroups` | `RobotsGroup[]` | `[]` | Additional `User-agent` groups. See below. |

**`robots.customGroups[]`**:

| Field | Type | Default |
| --- | --- | --- |
| `userAgent` | `string[]` | `['*']` |
| `allow` | `string[]` | `[]` |
| `disallow` | `string[]` | `[]` |

### Example

```ts
export default defineNuxtConfig({
  modules: ['@laioutr/app-essentials-seo'],
  '@laioutr/app-essentials-seo': {
    indexable: 'auto',
    environment: 'production',
    sitemap: {
      excludePageTypes: ['core/checkout'],
      pageTypes: [{ pageType: 'ecommerce/product-detail-page', changefreq: 'daily', priority: 0.8 }],
      includeImages: true,
    },
    robots: {
      blockAiBots: true,
      extraDisallow: ['/search'],
    },
  },
});
```

## The extension hook

This module fires a Nitro server hook, `essentials-seo:sitemap-source:resolve`, whenever it builds a
sitemap source — with the entries that built it. Another app in the project can hook into it to
filter or enrich the URLs before they're stored and served — for example, to drop out-of-stock
products from the crawlable set.

When it fires depends on how the source is built:

- **Configured pages** are finite, so that source is rebuilt in full on every request and the hook
  fires every time.
- **A page-index-backed source** is accumulated over one or more rebuild passes (see "Operational
  notes"), and the hook fires once per pass, carrying only the URLs that pass added. Whatever it
  leaves behind is what lands in the snapshot, so a filter applied here survives into every later
  request served from that snapshot.
- **A request answered from the snapshot cache does not fire it** — there is nothing new to filter,
  and re-offering an already-filtered snapshot would mean applying the filter twice.

The payload carries:

- `event` — the current `H3Event`.
- `token` — the page type token for this source, e.g. `'ecommerce/product-detail-page'`. **`null` on
  the configured-pages source** (the source that lists the project's finite, non-parameterized
  pages).
- `locale`, `market`, `domain` — the locale and resolved market/domain this source is being built
  for.
- `urls` — the URLs this build produced. **Mutate this array in place** — reassigning it to a new
  array is not observed by the caller. It holds **one whole pass, not one URL** — expect to filter or
  map the array in one call, not to be invoked per entry — and never the URLs earlier passes already
  contributed, which were offered in the pass that built them.
- `entries` — the raw entries `urls` was built from, given as context for filtering decisions: this
  pass's enumerated page-index entries, or every configured page on the configured-pages source.
  **Not positionally aligned with `urls`**: entries dropped along the way (flagged `noindex`,
  missing required params, or otherwise unfillable) never reach `urls`, so `entries` is a superset.
  Do not zip the two arrays together by index — match on entry identity instead.

A worked example. `entries` is what makes this possible: a page-index entry carries the identity
(`subject`, `params`) the decision needs, while a URL only carries its `loc`.

```ts
// server/plugins/filterOutOfStockProducts.ts
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('essentials-seo:sitemap-source:resolve', async (ctx) => {
    // Only touch the product-detail-page source; leave every other source untouched.
    if (ctx.token !== 'ecommerce/product-detail-page') return;

    // Ask stock about exactly the products this pass built, not the whole catalogue.
    const entries = ctx.entries as PageIndexEntry[];
    const outOfStock = await getOutOfStockIds(ctx.market.id, entries.map((entry) => entry.subject?.id));
    const droppedSlugs = new Set(entries.filter((entry) => outOfStock.has(entry.subject?.id)).map((entry) => entry.params.slug));

    // The slug is the one part of an entry that reaches the URL, so it is what links a URL back to
    // the entry it came from. A trailing slash is stripped first, so both settings match.
    const slugOf = (loc: string) => loc.replace(/\/$/, '').split('/').pop();

    // `urls` must be mutated in place.
    const kept = ctx.urls.filter((url) => !droppedSlugs.has(slugOf(url.loc)));
    ctx.urls.length = 0;
    ctx.urls.push(...kept);
  });
});
```

## Upstream hooks

To affect the underlying `@nuxtjs/sitemap`, `@nuxtjs/robots` or `nuxt-site-config` modules directly,
rather than this module's own sources, reach for their hooks instead:

- **`sitemap:sources`** (`@nuxtjs/sitemap`) — called once per sitemap while its sources are being
  assembled; push additional `{ context, urls }` entries or inspect/replace `ctx.sources`.
- **`sitemap:input`** (`@nuxtjs/sitemap`) — called with every source's URLs flattened into one list,
  before they're normalized into sitemap entries.
- **`sitemap:resolved`** (`@nuxtjs/sitemap`) — called with the final, per-sitemap entries right
  before they're serialized to XML.
- **`sitemap:index-resolved`** (`@nuxtjs/sitemap`) — called with the resolved list of child sitemaps
  right before the index is serialized. This module uses it to drop child sitemaps whose locale the
  requesting host doesn't serve.
- **`robots:config`** (`@nuxtjs/robots`) — called with the resolved robots config before `robots.txt`
  is generated. This module uses it to add its sitemap line and internal disallow paths without
  clobbering a project's own rules.
- **`robots:robots-txt`** (`@nuxtjs/robots`) — called with the fully rendered `robots.txt` context,
  for last-mile text edits.
- **`site-config:init`** (`nuxt-site-config`) — called once per request as the per-host site config
  (name, url, indexable, ...) is resolved; the place to override site config in ways this module's
  own options don't expose.

## Operational notes

- **Leave `site.url` unset on a multi-market project.** If it's set — whether directly in
  `nuxt.config.ts` or via this module's own config — every market emits URLs on that single origin
  instead of each request deriving its own host. This module warns at build time when `site.url` is
  set alongside more than one configured host, but it does not unset it for you.
- **A page type whose page-index registration ignores `startCursor` is capped at
  `rebuildBatchSize` URLs.** Sitemaps for page-index-backed page types are built incrementally,
  resuming from where the previous pass left off. Resumption depends on the registration's list
  handler threading the cursor through — returning `paginate(fn, startCursor)` is what makes a page
  type fully enumerable across passes. When a handler ignores `startCursor` instead, this module
  falls back to a single bounded read of up to `rebuildBatchSize` entries and logs a warning naming
  the page type, so raising `rebuildBatchSize` is the only way to cover more of that page type until
  its handler is fixed.

## Quick Setup

Follow the [Laioutr NPM Guide](https://docs.laioutr.com/cockpit/project-settings/npm) for connecting to [npm.laioutr.cloud](https://npm.laioutr.cloud).

- `pnpm install`
- `npx @laioutr/cli project fetch-rc --project <organization slug>/<project slug> --secret <project secret key>` - This will load the `laioutrrc.json` file with the current remote project configuration.
- `pnpm dev:prepare`

That's it! Sitemaps and `robots.txt` are now served for every host in your [Laioutr Frontend](https://laioutr.com).

You can find a thorough guide on getting started with Laioutr development in our [developer guide](https://docs.laioutr.com/getting-started/next-steps/local-setup).

## Linting and Formatting

We use ESLint and Prettier to lint and format the code. This repository contains opinionated configurations for both tools. You can, of course, replace them with your own configurations.

## Publishing

To publish a new version, run `pnpm release`. This will:

- Run the tests
- Update the changelog
- Publish the package to npmjs.org
- Push the changes to the repository

### Private publishing

If you want to publish a private package to npm.laioutr.cloud, you need to:

1. Make sure you have a `.npmrc` with your private npm registry token.
2. Add this line to the root of the `package.json` file: `"publishConfig": { "registry": "https://npm.laioutr.cloud/" }`
3. Make sure your package-name follows the `@laioutr-org/<organization-slug>__<package-name>` format.

After that you can run `pnpm release` to publish the package to npm.laioutr.cloud.

More information for publishing can be found in the [NPM Guide](https://docs.laioutr.com/cockpit/project-settings/npm#publish-an-organization-package).

## Contribution

Follow the [setup guide](https://docs.laioutr.com/getting-started/next-steps/local-setup) to get started.

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@laioutr/app-essentials-seo/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/@laioutr/app-essentials-seo
[npm-downloads-src]: https://img.shields.io/npm/dm/@laioutr/app-essentials-seo.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/@laioutr/app-essentials-seo
[license-src]: https://img.shields.io/npm/l/@laioutr/app-essentials-seo.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/@laioutr/app-essentials-seo
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
[laioutr-src]: https://img.shields.io/badge/%F0%9F%A6%99_Laioutr_App-702DCE
[laioutr-href]: https://www.laioutr.com/
