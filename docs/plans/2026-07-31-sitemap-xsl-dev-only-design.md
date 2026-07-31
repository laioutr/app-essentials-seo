# Design: serve the sitemap XSL only under `nuxt dev`

**Repo:** `/Users/sl/src/app-essentials-seo` · branch `main`
**Status:** approved, implemented in the same session.

## Problem

`@nuxtjs/sitemap` defaults `xsl` to `"/__sitemap__/style.xsl"`, and this module never overrides it.
Every deployment therefore emits a `<?xml-stylesheet type="text/xsl" …?>` processing instruction on
`/sitemap_index.xml` and on every child sitemap, and registers `/__sitemap__/style.xsl` as a public
route with an `application/xslt+xml` route rule.

The stylesheet exists so a human can read a sitemap in a browser. A production sitemap is read by
crawlers, which ignore it. It is developer convenience shipped to production.

## Behaviour

| | `<?xml-stylesheet?>` on index + children | `/__sitemap__/style.xsl` route |
| --- | --- | --- |
| `nuxt dev` | emitted (unchanged) | registered (unchanged) |
| any built deployment | absent | not registered |

"Production" here means **build mode**, not deployment environment: the gate is `nuxt.options.dev`,
so staging and preview builds drop the stylesheet too.

Deliberately *not* keyed off `resolveEnv()` (`toUpstreamConfig.ts:59`), which is what
`indexable: 'auto'` uses. That function falls back to `'production'` when no environment variable is
set, so a plain local `nuxt dev` resolves to `'production'` — keying off it would strip the
stylesheet in the one place it earns its keep.

## Changes

1. **`src/runtime/shared/toUpstreamConfig.ts`** — the input object gains a required `dev: boolean`,
   and the derived `sitemap` config gains `...(dev ? {} : { xsl: false })`.

   The flag is a parameter rather than a global read: this function is pure and unit-tested by
   passing its inputs directly, and the adopt-upstream-apis handoff calls out keeping it that way.

   Required rather than optional because there are only two call sites, so a future third one should
   be a compile error rather than a silent default.

2. **`src/module.ts`** — passes `dev: nuxt.options.dev` alongside the existing `env: process.env`.

3. **Tests** — below.

## Why `xsl: false` and not omitting the key

`applyUpstreamConfig` merges with `defu(appConfig, nuxtOptions, derived)`, so `derived` is the lowest
precedence. Omitting the key would leave `@nuxtjs/sitemap`'s own default in place and change nothing.
`false` is the documented off value — the option is typed `xsl: string | false`.

Both emission paths are guarded by truthiness, so one `false` covers both:

- `runtime/server/sitemap/builder/sitemap-index.js:170` — `if (xsl) { … }`
- `runtime/server/sitemap/builder/xml.js:103` — `xslHref ? … : …`

and `module.mjs:870`'s `if (config.xsl)` is what skips the route-rule registration.

## The escape hatch survives

`xsl` is not a key of `SitemapOptionsSchema`, so `omitCuratedKeys` does not strip it from app config,
and app config outranks `derived` in the `defu` chain. A project that genuinely wants the stylesheet
in production can still set `sitemap.xsl` and win.

This is why no curated option is added: the override already exists, and a curated field would be a
documented API surface to support forever for a setting nearly nobody should touch.

## Testing

**Unit** (`test/unit/toUpstreamConfig.test.ts`) — `dev: true` leaves no `xsl` key on the derived
sitemap config, so the upstream default applies; `dev: false` sets it to `false`.

**Integration** (`test/integration/sitemap.test.ts`) — the stronger of the two. The e2e suite calls
`setup({ rootDir })` with no `dev: true`, so `@nuxt/test-utils` builds in production mode: asserting
that `/sitemap_index.xml` and a child sitemap contain no `xml-stylesheet` proves the real production
output rather than merely that a flag was threaded through.

Nothing asserted anything about XSL in either direction before this.

## Not in scope

No error handling: build-time config, boolean input, no failure mode. `xslTips` and `xslColumns` are
left alone — they only shape the stylesheet's own rendering, which no longer ships.
