# Design: default `og:type` per page type, and a config shape that can be overridden

**Repo:** `/Users/sl/src/app-essentials-seo` · branch `feat/open-graph-tags`
**Status:** approved, implemented in the same session.

## Problem

`openGraph.pageTypes` ships empty, so every page in every project renders `og:type: website` until
someone writes the mapping out by hand. A blog post and a product detail page are the two cases where
`website` is plainly wrong, and both are canonical page types this module can name up front. Nobody
should have to configure them.

Shipping defaults is what breaks the current shape. `pageTypes` is an array of
`{ pageType, type }`, and `resolveOptions` fills it from a zod `.default([])` — a default that a
project's own array *replaces* rather than extends. Add defaults there and overriding one page type
silently discards the rest.

`openGraph` exists only on this branch: the `v1.1.1` tag predates commit `ce2c159`, so nothing has
shipped this config yet and the shape is still free. `sitemap.pageTypes` released in `v1.1.0` and is
deliberately left alone, arrays and all.

## The shape

`openGraph.pageTypes` becomes a map from page type to `og:type`:

```ts
openGraph: {
  pageTypes: { 'blog/post-single': 'blog' },
}
```

A map is what makes an override an override. The unit of configuration is one page type, so it is
the key — a project's entry replaces the default for that page type and touches nothing else. The
array could be merged by `pageType` to the same effect, but the merge would be invisible in the
config file: two entries with the same `pageType`, one of them ours and not written down anywhere the
reader can see.

The verbosity goes too. `{ pageType: 'blog/post-single', type: 'article' }` names the same page type
twice, once as a key that is not a key.

## Defaults

```ts
const DEFAULT_OG_PAGE_TYPES = {
  'blog/post-single': 'article',
  'ecommerce/product-detail-page': 'product',
  'location/detail': 'place',
};
```

Three entries, because only three canonical page types are something other than a website. The rest —
`core/home`, `core/landingpage`, `core/contentpage`, `core/404`, `blog/collection`,
`blog/post-listing`, `ecommerce/product-listing-page`, `ecommerce/product-search-page`,
`location/finder` — fall through to `defaultType`. A listing page really is a page of a website, and
`article` on a content page would promise an author and a publication date that no such page has.

Page types other packages register (`shopify/content-page`, `laioutr/app-detail-page`, …) get no
entry. This module does not own that vocabulary, and a wrong guess about someone else's page type is
worse than the fall-through, which is at least correct.

Plain string literals, not the token constants from `@laioutr-core/canonical-types`. Those constants
are not inert: `definePageTypeToken` registers into a module-global registry as an import side
effect, so importing them to write three strings would run page-type registration inside this
module's build. `z.record(z.string(), z.string())` also accepts any key, so the map has to hold page
types this module could not import in the first place — the keys are data, not a type contract.

## Merging

The merge happens in the schema, so `resolveOptions` returns one already-merged map:

```ts
pageTypes: z
  .record(z.string(), z.string())
  .default({})
  .transform((configured) => ({ ...DEFAULT_OG_PAGE_TYPES, ...configured })),
```

Everything downstream then reads an effective config rather than a partial one. `runtimeConfig`
carries the full map, which is what devtools shows and what a bug report can be read off; the page
head plugin and `buildOpenGraph` never learn that defaults exist.

The alternative — leaving `pageTypes` as written and falling back to the defaults at lookup time —
splits the resolution across the schema and the renderer, and hides from `runtimeConfig` the very
values being rendered. It also buys nothing: the lookup order is the same either way.

The field-level placement depends on zod still treating the key as optional once `.default()` is
wrapped in a `ZodPipe` by `.transform()`. It does — `resolveOptions(undefined)` yields the full map —
so the transform stays on the field. Had it not, the same transform would have moved to the
`OpenGraphOptionsSchema` object for identical behaviour.

## Removing a default

There is no `null` sentinel. To move a page type off its default, set it:

```ts
openGraph: {
  pageTypes: { 'blog/post-single': 'website' },
}
```

`og:type` has no meaningful absent state — consumers treat a missing `og:type` as `website` — so
"delete this entry" and "set it to `website`" are the same request, and only one of them needs a
sentinel value to express. The explicit string also survives a later change to
`defaultType`, which a deletion marker would silently follow.

## Lookup

`buildOpenGraph` drops the `.find()` for a keyed read:

```ts
const configured = config.pageTypes[pageType];
meta.ogType = typeof configured === 'string' ? configured : config.defaultType;
```

The `typeof` check is not defensive noise. The map is a plain object parsed from project JSON, so it
inherits `Object.prototype`: a page type named `constructor` or `toString` would otherwise resolve to
a function and stringify into the tag. The check costs one comparison and removes the whole class.

`OpenGraphConfig.pageTypes` in `buildOpenGraph.ts` changes type to `Record<string, string>`
accordingly. Nothing else in the file moves.

## Testing

**`test/unit/types.test.ts`** — the merge, which is the actual feature:

- `resolveOptions(undefined)` yields the three defaults, so a project that configures nothing still
  gets them.
- A project entry for `blog/post-single` wins for that key while the other two defaults survive —
  the exact failure the array shape had.
- A project entry for a page type with no default is added rather than replacing the map.
- `defaultType` can be changed without disturbing `pageTypes`.

**`test/unit/buildOpenGraph.test.ts`** — the existing `og:type` cases move to the record shape
(mapped page type, unmapped page type falling through to `defaultType`, always emitted). One case is
added: a page type named `constructor` resolves to `defaultType`, not to a function.

No integration test. The tag emission path is already covered by the plugin's own contract, and what
changed here is build-time config resolution, which the unit tests reach directly.

## Not in scope

`sitemap.pageTypes` and `sitemap.excludePageTypes` keep their published array shape. Unifying every
per-page-type setting under one top-level `pageTypes` record is the cleaner surface and was
considered, but it breaks config that shipped in `v1.1.0` and belongs to its own major bump.

`og:image`, Twitter cards, and the `product:`/`place:` namespace tags that `product` and `place`
would ideally pair with remain out of scope, as they were when the Open Graph work landed.
