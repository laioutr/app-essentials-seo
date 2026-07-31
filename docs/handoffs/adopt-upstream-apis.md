# Handoff: adopt the upstream APIs once they ship

**Repo:** `/Users/sl/src/app-essentials-seo` · branch `main`
**Blocked on:** releases of `@laioutr-core/frontend-core` and `@laioutr-core/orchestr`.
**Upstream designs:** `/Users/sl/src/laioutr/docs/plans/2026-07-31-build-time-project-context-design.md`,
`/Users/sl/src/laioutr/docs/plans/2026-07-31-page-index-live-end-cursor-design.md`

Each item below is independent. Do only the ones whose upstream change actually shipped — check, do
not assume. Commit each separately. **Do not create or switch branches. Do not push.**

Gates after every item: `pnpm lint` 0, `pnpm test` all passing, `pnpm test:types` 0, `pnpm dev:prepare` 0.
Baseline at handoff: **169 tests**.

---

## ⚠ Read this before deleting anything

Two divergences from upstream in this repo are **deliberate fixes, not drift**. Adopting an upstream
implementation that still has the old behaviour would silently reintroduce a bug we shipped a fix and
a test for. Both are on `main` (`2a55371`, `525589f`).

1. **`src/runtime/server/lib/hostContext.ts`** tolerates a `www.` prefix in both the market lookup and
   the domain filter, and strips the port with `replace(/:\d+$/, '')` rather than `split(':')`.
   Upstream `resolveMarketFromRequest` has the `www.` alternation but selects a domain **by longest
   path prefix** and falls back to `market.defaultDomain`. We select **by locale** and return `null`.
   That difference is correct for us: a sitemap file is named by locale, has no path, and may only
   list URLs on its own host — the `null` becomes an empty sitemap (`sitemap.ts:104-107`).
   **Only delete `hostContext.ts` if the upstream API offers a locale-keyed selector *and* a nullable
   result.** Otherwise keep ours.
2. **`src/runtime/shared/path.ts` `unlocalize`** walks past both `null` and `''`. Upstream rejects
   `null` but *returns* `''`, and its callers then drop the domain instead of trying the next locale
   in the chain. **Do not adopt upstream's `unlocalize` until it also walks past `''`.**

`test/unit/hostContext.test.ts` and `test/unit/path.test.ts` cover both. If a swap makes one of those
fail, the upstream version is the one that is wrong — report it, do not weaken the test.

---

## 1. orchestr: read `exhausted` / `progressed` instead of inferring completion

**Ships with:** any orchestr release containing `a57b189a2 fix(orchestr): report listPagesFrom endCursor
at any stopping position`. Verify: `grep -n "readonly progressed" node_modules/@laioutr-core/orchestr/dist/runtime/server/lib/page-index/pageIndexRunner.d.ts`

`src/runtime/server/lib/rebuild.ts:6-9` declares a local `EntryStreamLike` with only `toArray()` and
`endCursor`, then infers completion at `:123-124` from `endCursor === undefined`. orchestr now
publishes that as contract:

- `exhausted` — the upstream enumeration ran out.
- `progressed` — this pass handed over entries. **False after a pass that threw**, so a loop guarded
  only on `exhausted` repeats identical work forever.

Widen `EntryStreamLike` with both, and use them at `:123-124`. Keep the existing tests green; add one
for a pass that reports `!progressed`.

This is also the prerequisite for the wall-clock deadline work — do it first if that is next.

Commit: `refactor: take completion from the page-index stream contract`

## 2. frontend-core: build-time project context

**Ships with:** `useLaioutrProject` exported from `@laioutr-core/kit`. Verify by importing it.

Replaces, in this order of confidence:

| Delete | Where | ~lines |
| --- | --- | --- |
| `DEV_DOMAIN` + `toDevHost` | `src/runtime/shared/toUpstreamConfig.ts:42-52` | 11 |
| domain grouping + default-domain preference | `toUpstreamConfig.ts:97-112` | 20 |
| the `as any` on laioutrrc | `src/module.ts:33` | 1 |
| `hostContext.ts` | whole file — **only under the §⚠ condition** | 40 |

`toUpstreamConfig` takes `laioutrrc` as an argument and is unit-tested that way
(`test/unit/toUpstreamConfig.test.ts:53`), so thread the context in as a parameter rather than calling
`useLaioutrProject()` inside it. Keep it a pure function.

Commit separately per row.

## 3. frontend-core: `#laioutr/rc` ambient types

**Ships with:** frontend-core registering `include.d.ts` on the no-laioutrrc branch, **and** typing
`rcProject` as the sanitised shape. Verify both: after `pnpm dev:prepare`, `grep -rn "laioutr/rc" .nuxt/`
should hit, and reading `rcProject.config` should be a type error.

Then delete `src/runtime/server/types/rc.d.ts` (17 lines) and the two `eslint-disable
import-x/no-unresolved` lines plus their comment at `src/runtime/server/nitro/sitemap.ts:17-22`.

**If only the registration ships and the type is still `RcProject`, keep our file** — ours is the
correct type and the shipped one is wrong.

Commit: `chore: take the rc virtual module types from the platform`

## 4. orchestr: scheduling primitives

**Ships with:** `scheduleBackgroundRefresh` / `useRefreshLock` / `ttlStamp` auto-imported from orchestr.

Deletes `inFlightPasses` + `scheduleBackgroundPass` (`sitemap.ts:40-65`, 26 lines) and
`REFRESH_FACTOR` + `stamp` (`src/runtime/server/lib/snapshotStore.ts:7, 21-24`, 6 lines).

Two things to carry across rather than drop:

- The comment at `sitemap.ts:55-61` explaining that on the node preset `event.waitUntil` pushes into
  an array nitropack never awaits, so an uncaught rejection kills the process. If the upstream helper
  does not catch, this is a regression — check before deleting.
- `promotePending` (`snapshotStore.ts:48-53`) currently has **no** cross-process guard. If
  `useRefreshLock` ships, wrap the stale-refresh branch in `serveSource.ts` with it and update the
  comment at `sitemap.ts:36-38`, which claims unstorage offers no answer. It does not offer CAS, but
  orchestr ships a best-effort TTL lock.

Commit: `refactor: take background-refresh scheduling from the platform`

---

## Not blocked on anything

- `test/unit/serveSource.test.ts` covers all four snapshot states; `serveSource.ts` is where the
  wall-clock deadline lands when its design is planned.
- `package.json` + `pnpm-lock.yaml` still carry a `@laioutr-app/shopify` devDependency added for
  manual testing against a real store, and `playground/nuxt.config.ts` prefers a local
  `playground/laioutrrc.json` when present (gitignored). Both were left uncommitted deliberately —
  confirm with the user before committing or reverting them.
