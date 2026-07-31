# Wall-clock deadline for an enumeration pass — Design

**Date:** 2026-07-31 · **Status:** design, approved, not yet planned
**Package:** `@laioutr/app-essentials-seo` v1.1.0
**Unblocked by:** `@laioutr-core/orchestr` 0.38.2

Bound a rebuild pass in time as well as in entries, so the first request for a large page type always
completes and always persists, instead of being killed by the host and starting over forever.

## 1. Problem

`serveSource.ts:29-35` — the `missing` branch — awaits a full pass before it can respond, and writes
the snapshot only after that pass returns:

```ts
const next = await pass(null);
await store.writeLive(host, sitemapName, next);
```

`rebuild.ts:119` drains the stream with `await stream.toArray()`, bounded by `entriesPerRequest` and
by nothing else. So on a host with a hard request timeout, a catalogue too large to enumerate inside
that limit produces: function killed → `writeLive` never runs → nothing persisted → the next request
re-enters `missing` and repeats the identical doomed pass. The sitemap is not slow, it is
**unreachable**, and no amount of crawling fixes it.

Measured against a real store (3 413 Shopify products, warm local network): **3.59 s for one full
pass, ≈950 entries/s**. At that rate the shipped default of `entriesPerRequest: 10_000` is ~10.5 s of
work in a single blocking request.

`test/unit/serveSource.test.ts` → `persists nothing while the first pass is still running` is the
executable statement of this cost. It should keep passing after this change: the fix is not that a
kill persists something, it is that a kill stops happening.

## 2. Why this was not done sooner

Stopping a walk early used to be unsafe. `listPagesFrom` assigned its resume token only at the `take`
boundary, so a pass stopping anywhere else reported `endCursor: undefined` — which the contract
defines as *exhausted*. An early exit would have persisted a partial catalogue as `complete: true` for
a 24-hour TTL: silent truncation, worse than the timeout.

orchestr 0.38.2 fixes that (`a57b189a2`). A walk stopped at any position now reports a usable resume
token, and publishes `exhausted` / `progressed` as contract. `3d9547b` already moved this module onto
`stream.exhausted`, which is a prerequisite: once passes stop draining, inferring completion from
`endCursor === undefined` becomes actively wrong, because a pass that stopped early returns a *token*.

## 3. Rejected alternatives

**HTTP-stream the response until the host kills it.** Rejected on three counts. We do not own the
response — `sitemap:sources` takes a `urls` array and `@nuxtjs/sitemap` renders the document, so
streaming means replacing that module and losing the index, chunking, stylesheet and header hook.
A function killed mid-stream never emits `</urlset>`, and a truncated XML document is not partial
data, it is a parse error a crawler discards — a worse failure than no response. And it cannot
converge: with no persistence every request re-enumerates from zero, so a catalogue larger than one
request could never be served completely.

**Persist incrementally instead of bounding.** Genuinely attractive — a kill would cost one batch, no
budget to tune, no platform coupling. Rejected because of storage shape, not principle: a snapshot is
a single blob of every accumulated URL, so writing per batch is O(accumulated) per write and
O(n²/batch) overall (~200 writes averaging 25 000 URLs for a 50 000-entry type). Making it cheap needs
append-only chunks reassembled on read — a much larger redesign of `snapshotStore`. **If that redesign
ever happens for other reasons, revisit: it is the better fix and it removes the platform coupling in
§7.**

## 4. Mechanism

`runRebuildPass` stops draining:

```ts
const entries: any[] = [];
for await (const entry of stream) {
  entries.push(entry);                                        // collect BEFORE checking
  if (deadline !== undefined && Date.now() > deadline) break;
}
```

Three properties, all load-bearing:

- **Collect before checking.** `paginate` counts an entry as consumed when it hands it over, so the
  resume token names the position *after* the entry in hand. Checking first would silently drop one
  entry per pass.
- **Every pass advances.** The check runs only after a push, so a pass that breaks has always
  collected at least one entry. A badly set budget therefore cannot stall a page type — it can only
  make convergence slow. The cost is overshooting `budgetMs` by at most one upstream page (~250
  entries, ~0.26 s on the measured store).
- **Completion still comes from `stream.exhausted`**, unchanged from `3d9547b`.

`deadline` is an absolute timestamp, not a duration: `runRebuildPass` already takes `now` injected,
and the clock stays the caller's.

**`serveSource` does not change.** The deadline is computed inside the `pass` thunk in
`sitemap.ts:168-178`, which is invoked per pass, so each pass — cold or background — gets a fresh
budget measured from when it actually starts rather than from when the request arrived.

## 5. Option surface

`src/types.ts` gains one field beside `entriesPerRequest`:

```ts
/** Wall-clock ceiling for one enumeration pass. Must be below the host's request timeout. */
budgetMs: z.number().int().min(1).default(60_000),
```

Both bounds are kept, and they bound different things: `entriesPerRequest` caps **upstream traffic**
per request, `budgetMs` caps **request duration**. A pass stops at whichever fires first.

**Which bound binds is a property of the connector, not of the configuration.** Against Shopify's
Storefront API at the measured ~950 entries/s, 60 s is ≈57 000 entries — far above the 10 000 default,
so the entry cap binds and `budgetMs` is a safety net. Shopware's Storefront API is materially slower
(**not measured here — worth measuring before tuning**); at a fifth of that rate the same budget buys
≈11 000 entries, so the two bounds are comparable, and slower still makes `budgetMs` the primary bound
and `entriesPerRequest` the vestigial one.

That is the argument for keeping both rather than collapsing to one. Neither bound is redundant,
because a project can carry a fast connector and a slow one at once — Shopify products and Shopware
products in the same frontend — and each source gets whichever bound its own throughput reaches first.
A single global `budgetMs` remains correct even so: it bounds *request duration*, and every source is
enumerated in its own request.

Two consequences of a slow connector worth stating plainly:

- **A cold request blocks for up to `budgetMs`.** On a slow connector that is the full 60 s before a
  crawler gets its first response for that page type. Every later request is served from the snapshot
  immediately, so this is a one-off per page type per host, but it is real and it is most visible
  exactly where the catalogue is largest.
- **The overshoot in §4 scales with the connector.** Breaking only after collecting means the pass can
  exceed its budget by one upstream page — ~0.26 s on the measured store, proportionally more on a
  slow one. Still bounded by a single page fetch, never by the remaining catalogue.

One budget serves cold and background passes alike. A background pass runs under `event.waitUntil`,
which the same platform limit bounds, so a second value would be two things to reason about for no
gain.

## 6. Consequences elsewhere

**The extension hook is unchanged.** Entries accumulate into an array handed to `accumulate(entries)`
exactly where `toArray()`'s result went, so `essentials-seo:sitemap-source:built` still fires once per
pass with everything that pass built.

**`progressed` stays unread, and the comment at `rebuild.ts:12-14` stays true.** Because the deadline
is checked only after collecting, a pass that breaks has progressed, and a pass that collects nothing
fell through the loop and is therefore exhausted. `!progressed && !exhausted` remains unreachable.
Under a strict budget it would have become reachable immediately — a second reason §4's ordering is
load-bearing.

**The non-resumable fallback is bounded too.** `runNonResumableFallback` uses `listPages({ take })`,
which cannot resume: bounded in entries, unbounded in time, and the only remaining way a pass runs
without a clock. It takes the same deadline. Its existing warning says the sitemap is "capped at
`{take}` URLs"; that wording must change, because the real cap becomes whichever bound fires first.

**A new diagnostic, and it must be once per source per process.** Log when a pass stops *on the
deadline* rather than on `take` or exhaustion — a platform kill is undetectable from inside, so this
is the only signal that would reveal a `budgetMs` set above the host's limit.

The naive version logs on every pass, which is fine when the budget is a rare safety net and is
constant noise on a slow connector, where hitting the deadline is the *normal* outcome of every pass
until a page type converges (§5). Use the `warnOnce` keyed by sitemap name that `sitemap.ts:25-30`
already has, so a slow connector reports the fact once rather than once per crawl.

## 7. The risk this design carries

`budgetMs` must sit below the host's request timeout, with headroom for the snapshot write and the
response. If it does not — host kills at 10 s, budget set to 60 s — the budget never fires, nothing
persists, and the original bug returns with extra machinery in front of it.

Nothing in the code can verify this: the limit is not discoverable across hosts, and a kill leaves no
trace in-process. It is therefore a **documentation-and-diagnostic obligation**, discharged by the
README note and the §6 log line, not a guarantee. The default of 60 s is deliberately chosen on the
assumption that the deployment target permits it; a project on a 10 s host must lower it.

## 8. Testing

**Unit (`rebuild`)** — a deadline that fires mid-stream yields an incomplete snapshot carrying the
stream's `endCursor` · an already-expired deadline still collects exactly one entry, which is §4's
guarantee · no deadline reproduces today's behaviour exactly · the non-resumable fallback honours it
and still marks the snapshot complete.

**Integration** — `test/fixtures/seo/server/utils/pageIndexControl.ts` gains a `delayMs` knob so a
pass can be made to exceed its budget deterministically. This is the one case where controllable
slowness is necessary rather than a liability: a wall-clock bound can only be tested against
wall-clock time.

The test that carries the design: **a cold request against a catalogue that cannot be enumerated
inside its budget returns a valid partial sitemap and persists a resume point**, and a second request
continues from it. That is precisely what is broken today.

## 9. Out of scope

- Append-only chunked snapshot storage (§3). Revisit if `snapshotStore` is redesigned for other
  reasons.
- Discovering the host's request limit automatically.
- Any change to `entriesPerRequest`'s meaning or default.
- The `@nuxtjs/sitemap` integration seam — this change is entirely behind `sitemap:sources`.
