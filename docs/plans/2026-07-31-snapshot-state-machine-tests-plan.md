# Snapshot State Machine Test Seam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four-state snapshot decision in the sitemap nitro plugin directly testable, then cover the three behaviours that have no test today: an interrupted cold pass, recovery from a failed cold pass, and the stale → pending → promote refresh.

**Architecture:** The branch logic currently lives inside the `sitemap:sources` hook, where its only reachable path is an HTTP request. Lift it into `serveSource`, a function taking the store, a `pass` thunk and a `schedule` callback, so every state is a unit test and "the pass never finishes" becomes expressible. The nitro plugin keeps everything nitro-shaped — same-process dedupe, `event.waitUntil`, host resolution. Then add a steerable page-index fixture and a snapshot-seeding route so the integration suite can reach failure and staleness, which it cannot reach today.

**Tech Stack:** Nuxt 3.16.2, nitropack, `@nuxt/test-utils` 3.19.1 (e2e `setup`), vitest 3.1.1, `@laioutr-core/orchestr` 0.38.1, unstorage.

## Global Constraints

- **Never create or switch branches.** Commit to the branch already checked out.
- Commit at the point each task says to, and only those files — check `git status` first. Never `git add -A` or `git commit -a`.
- All four gates green at the end of every task: `pnpm lint` 0, `pnpm test` all passing, `pnpm test:types` 0, `pnpm dev:prepare` 0.
- **If a test fails, do not weaken an assertion to make it pass.** Diagnose and report.
- Do not reference this plan, a task number, or a review in any code comment or commit message. Comments explain the code in its own voice.
- No new public exports from `src/module.ts`. The package entry stays as it is; test seams are internal.
- `test/fixtures/seo/laioutrrc.json` is synthetic. Never copy a real `laioutrrc.json` into the repo.
- Task 1 is behaviour-preserving. The existing 150 tests are its safety net and must pass **unedited**.

## Out of Scope

- The wall-clock deadline on a pass. It is gated on orchestr exposing a live `endCursor`
  (`/Users/sl/src/laioutr/docs/plans/2026-07-31-page-index-live-end-cursor-design.md`). This plan builds
  the seam that change will land in; it does not pre-empt it.
- Any change to `runRebuildPass`. Its 15 unit tests already cover pass-level failure.
- Making the snapshot store survive a process restart.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/runtime/server/lib/serveSource.ts` | **Create.** The four-state decision: what to serve, what to schedule, what to persist. No nitro types. |
| `src/runtime/server/nitro/sitemap.ts` | **Modify.** Keeps host resolution, source naming, the pass closure, dedupe and `waitUntil`; delegates the decision. |
| `test/unit/serveSource.test.ts` | **Create.** All four states, plus the two properties that describe an interrupted cold pass. |
| `test/fixtures/seo/server/plugins/fakePageIndex.ts` | **Modify.** Add runtime-steerable failure. |
| `test/fixtures/seo/server/utils/pageIndexControl.ts` | **Create.** Module state the control route writes and the page index reads. |
| `test/fixtures/seo/server/routes/__page-index-control.ts` | **Create.** Test-only steering of the fixture. |
| `test/fixtures/seo/server/routes/__seed-snapshot.ts` | **Create.** Test-only write of an aged snapshot into the module's own cache. |
| `test/integration/recovery.test.ts` | **Create.** Cold pass fails → next request recovers. |
| `test/integration/refresh.test.ts` | **Create.** Stale live snapshot → pending accumulation → promotion. |

---

## Task 1: Extract the decision from the nitro hook

**Files:**
- Create: `src/runtime/server/lib/serveSource.ts`
- Modify: `src/runtime/server/nitro/sitemap.ts:180-205`

**Interfaces:**
- Consumes: `Snapshot`, `SnapshotStore`, `snapshotState` from `./snapshotStore`; `SitemapUrl` from `./alternates`.
- Produces: `serveSource(input: ServeSourceInput): Promise<SitemapUrl[]>` — Task 2 tests it, Task 5 depends on its stale branch.

- [ ] **Step 1: Write the new module**

`src/runtime/server/lib/serveSource.ts`:

```ts
import { snapshotState, type Snapshot, type SnapshotStore } from './snapshotStore';
import type { SitemapUrl } from './alternates';

export interface ServeSourceInput {
  store: SnapshotStore;
  host: string;
  sitemapName: string;
  /** Read once by the caller, so every decision in one request judges freshness against one clock. */
  now: number;
  pass: (previous: Snapshot | null) => Promise<Snapshot>;
  /**
   * Runs a pass behind the response. Injected rather than called directly: same-process dedupe and
   * `event.waitUntil` are nitro concerns that belong to the plugin, and a caller that hands over a
   * thunk it can run itself is one a test can drive without a server.
   */
  schedule: (run: () => Promise<void>) => void;
}

/**
 * Decides what a sitemap source serves and what that costs. `missing` is the only state that has to
 * build before it can answer; every other one answers from the stored snapshot and advances it
 * behind the response, so a crawler waits for a full enumeration exactly once per source.
 */
export const serveSource = async (input: ServeSourceInput): Promise<SitemapUrl[]> => {
  const { store, host, sitemapName, now, pass, schedule } = input;
  const live = await store.readLive(host, sitemapName);

  switch (snapshotState(live, now)) {
    case 'missing': {
      // The write is what makes this cost non-recurring: until it lands, the next request is cold
      // too, so anything that interrupts the pass leaves the source exactly where it started.
      const next = await pass(null);
      await store.writeLive(host, sitemapName, next);
      return next.urls;
    }
    case 'incomplete':
      // Serve the partial and advance it, so a reader sees growth instead of a wait.
      schedule(async () => {
        const next = await pass(live);
        await store.writeLive(host, sitemapName, next);
      });
      break;
    case 'stale':
      // A refresh takes several passes, so it accumulates beside the live value rather than in it —
      // promoted in a single write once complete, so a reader never observes a partial refresh.
      schedule(async () => {
        const pending = await store.readPending(host, sitemapName);
        const next = await pass(pending);
        await store.writePending(host, sitemapName, next);
        if (next.complete) await store.promotePending(host, sitemapName);
      });
      break;
    case 'fresh':
      break;
  }

  // Non-null: `missing` returned above, and an absent or expired snapshot is exactly what resolves
  // to `missing`.
  return live!.urls;
};
```

- [ ] **Step 2: Rewrite the tail of the hook to call it**

In `src/runtime/server/nitro/sitemap.ts`, replace everything from `const live = await store.readLive(...)` to the final `emit(live!.urls);` with:

```ts
    emit(
      await serveSource({
        store,
        host,
        sitemapName: ctx.sitemapName,
        now: Date.now(),
        pass,
        schedule: (run) => scheduleBackgroundPass(ctx.event, host, ctx.sitemapName, run),
      })
    );
```

Add `import { serveSource } from '../lib/serveSource';` alongside the other lib imports. Delete the now-unused `snapshotState` and `Snapshot` imports **only if nothing else in the file uses them** — `pass` is typed `(previous: Snapshot | null)`, so `Snapshot` is very likely still needed. Let `pnpm lint` decide rather than guessing.

- [ ] **Step 3: Verify nothing changed**

Run: `pnpm test`
Expected: 150 passed, **no test file edited**. If a test needs editing to pass, the extraction changed behaviour — stop and report which assertion moved.

Run: `pnpm lint && pnpm test:types && pnpm dev:prepare`
Expected: all 0.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/server/lib/serveSource.ts src/runtime/server/nitro/sitemap.ts
git commit -m "refactor: lift the snapshot decision out of the nitro hook"
```

---

## Task 2: Unit-test all four states

**Files:**
- Create: `test/unit/serveSource.test.ts`

**Interfaces:**
- Consumes: `serveSource` from Task 1.

The two cold-path tests are the point of the task: they describe, as executable assertions, what an
interrupted first request leaves behind. Neither is reachable over HTTP.

- [ ] **Step 1: Write the fake store and snapshot helper**

```ts
import { describe, expect, it } from 'vitest';
import { serveSource } from '../../src/runtime/server/lib/serveSource';
import { COMPLETE_TTL_MS, type Snapshot, type SnapshotStore } from '../../src/runtime/server/lib/snapshotStore';
import type { SitemapUrl } from '../../src/runtime/server/lib/alternates';

const url = (loc: string): SitemapUrl => ({ loc }) as SitemapUrl;

/** `now` is 0 in every test, so these offsets read as "relative to the request". */
const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  urls: [url('https://shop.ch/a')],
  complete: true,
  expiresAt: COMPLETE_TTL_MS,
  refreshAt: COMPLETE_TTL_MS * 0.8,
  ...over,
});

/** Records call order, which is what the cold-path assertions are actually about. */
const fakeStore = () => {
  const live = new Map<string, Snapshot>();
  const pending = new Map<string, Snapshot>();
  const calls: string[] = [];
  const key = (h: string, n: string) => `${h}:${n}`;
  const store: SnapshotStore = {
    readLive: async (h, n) => live.get(key(h, n)) ?? null,
    readPending: async (h, n) => pending.get(key(h, n)) ?? null,
    writeLive: async (h, n, s) => void (calls.push('writeLive'), live.set(key(h, n), s)),
    writePending: async (h, n, s) => void (calls.push('writePending'), pending.set(key(h, n), s)),
    promotePending: async (h, n) => {
      calls.push('promotePending');
      const p = pending.get(key(h, n));
      if (p) {
        live.set(key(h, n), p);
        pending.delete(key(h, n));
      }
    },
  };
  return { store, calls, live, pending };
};

const run = (over: Partial<Parameters<typeof serveSource>[0]> & { store: SnapshotStore }) =>
  serveSource({
    host: 'shop.ch',
    sitemapName: 'test-product-de',
    now: 0,
    pass: async () => snapshot(),
    schedule: () => {},
    ...over,
  });
```

- [ ] **Step 2: Write the cold-path tests**

```ts
describe('serveSource', () => {
  describe('missing', () => {
    it('builds, persists, and serves what it built', async () => {
      const { store, calls, live } = fakeStore();
      const built = snapshot({ urls: [url('https://shop.ch/new')] });

      const urls = await run({ store, pass: async () => built });

      expect(urls).toEqual(built.urls);
      expect(calls).toEqual(['writeLive']);
      expect(live.get('shop.ch:test-product-de')).toBe(built);
    });

    it('persists nothing while the first pass is still running', async () => {
      const { store, calls } = fakeStore();
      let finish: (snapshot: Snapshot) => void;
      const pass = () => new Promise<Snapshot>((resolve) => (finish = resolve));

      const inFlight = run({ store, pass });
      await Promise.resolve();
      await Promise.resolve();

      // A host that kills the function here leaves the source exactly as cold as it found it, so the
      // next request repeats this same pass. Bounding a pass is what keeps that from being forever.
      expect(calls).toEqual([]);

      finish!(snapshot());
      await inFlight;
      expect(calls).toEqual(['writeLive']);
    });

    it('persists nothing when the first pass rejects', async () => {
      const { store, calls } = fakeStore();

      await expect(
        run({
          store,
          pass: async () => {
            throw new Error('upstream down');
          },
        })
      ).rejects.toThrow('upstream down');

      expect(calls).toEqual([]);
    });
  });
});
```

- [ ] **Step 3: Run them**

Run: `pnpm vitest run test/unit/serveSource.test.ts`
Expected: 3 passed.

- [ ] **Step 4: Write the warm-path tests**

Append inside `describe('serveSource', …)`:

```ts
  describe('incomplete', () => {
    it('serves the partial without waiting and advances it behind the response', async () => {
      const { store, calls, live } = fakeStore();
      const partial = snapshot({ complete: false, urls: [url('https://shop.ch/partial')], expiresAt: 1_000, refreshAt: 800 });
      live.set('shop.ch:test-product-de', partial);
      const grown = snapshot({ complete: false, urls: [...partial.urls, url('https://shop.ch/more')] });
      let scheduled: (() => Promise<void>) | undefined;

      const urls = await run({ store, pass: async () => grown, schedule: (fn) => (scheduled = fn) });

      expect(urls).toEqual(partial.urls); // served before any work ran
      expect(calls).toEqual([]);
      await scheduled!();
      expect(calls).toEqual(['writeLive']);
      expect(live.get('shop.ch:test-product-de')).toBe(grown);
    });

    it('hands the pass the snapshot it is continuing', async () => {
      const { store, live } = fakeStore();
      const partial = snapshot({ complete: false, expiresAt: 1_000, refreshAt: 800 });
      live.set('shop.ch:test-product-de', partial);
      let seen: Snapshot | null | undefined;

      await run({
        store,
        pass: async (previous) => ((seen = previous), snapshot()),
        schedule: (fn) => void fn(),
      });

      expect(seen).toBe(partial);
    });
  });

  describe('stale', () => {
    const stale = () => snapshot({ refreshAt: -1 });

    it('accumulates a refresh in pending and promotes it once complete', async () => {
      const { store, calls, live, pending } = fakeStore();
      live.set('shop.ch:test-product-de', stale());
      const refreshed = snapshot({ complete: true, urls: [url('https://shop.ch/fresh')] });
      let scheduled: (() => Promise<void>) | undefined;

      const urls = await run({ store, pass: async () => refreshed, schedule: (fn) => (scheduled = fn) });

      expect(urls).toEqual(stale().urls); // the old value keeps serving while the refresh runs
      await scheduled!();
      expect(calls).toEqual(['writePending', 'promotePending']);
      expect(live.get('shop.ch:test-product-de')).toBe(refreshed);
      expect(pending.size).toBe(0);
    });

    it('leaves an unfinished refresh pending so no reader sees a partial', async () => {
      const { store, calls, live, pending } = fakeStore();
      const current = stale();
      live.set('shop.ch:test-product-de', current);
      const halfway = snapshot({ complete: false, urls: [url('https://shop.ch/halfway')] });
      let scheduled: (() => Promise<void>) | undefined;

      await run({ store, pass: async () => halfway, schedule: (fn) => (scheduled = fn) });
      await scheduled!();

      expect(calls).toEqual(['writePending']);
      expect(live.get('shop.ch:test-product-de')).toBe(current);
      expect(pending.get('shop.ch:test-product-de')).toBe(halfway);
    });

    it('continues from pending rather than restarting the refresh', async () => {
      const { store, live, pending } = fakeStore();
      live.set('shop.ch:test-product-de', stale());
      const half = snapshot({ complete: false });
      pending.set('shop.ch:test-product-de', half);
      let seen: Snapshot | null | undefined;

      await run({
        store,
        pass: async (previous) => ((seen = previous), snapshot()),
        schedule: (fn) => void fn(),
      });

      expect(seen).toBe(half);
    });
  });

  describe('fresh', () => {
    it('serves the snapshot and schedules nothing', async () => {
      const { store, calls, live } = fakeStore();
      const current = snapshot();
      live.set('shop.ch:test-product-de', current);
      let scheduledCount = 0;

      const urls = await run({ store, schedule: () => scheduledCount++ });

      expect(urls).toEqual(current.urls);
      expect(scheduledCount).toBe(0);
      expect(calls).toEqual([]);
    });
  });
```

- [ ] **Step 5: Run the full suite**

Run: `pnpm vitest run test/unit/serveSource.test.ts` → 9 passed.
Run: `pnpm lint && pnpm test && pnpm test:types` → all green, 159 tests.

- [ ] **Step 6: Commit**

```bash
git add test/unit/serveSource.test.ts
git commit -m "test: cover every snapshot state the sitemap can serve from"
```

---

## Task 3: Make the fixture page index steerable

**Files:**
- Create: `test/fixtures/seo/server/utils/pageIndexControl.ts`
- Create: `test/fixtures/seo/server/routes/__page-index-control.ts`
- Modify: `test/fixtures/seo/server/plugins/fakePageIndex.ts`

`setup()` boots one server for a whole suite, so a test cannot vary the fixture by rebuilding it. Module
state written through a route is how the existing fixture already does read-back (`__sitemap-hook-log`);
this is the write direction of the same idea.

- [ ] **Step 1: Write the control state**

`test/fixtures/seo/server/utils/pageIndexControl.ts`:

```ts
/**
 * Test-only steering for the fake page index. One server serves a whole suite, so behaviour a test
 * wants to vary has to be switchable at request time rather than baked in at build time.
 */
export const pageIndexControl = {
  /** Passes still to fail before the handler starts succeeding. Decremented as they fail. */
  failPasses: 0,
};
```

- [ ] **Step 2: Write the control route**

`test/fixtures/seo/server/routes/__page-index-control.ts`:

```ts
import { defineEventHandler, readBody } from 'h3';
import { pageIndexControl } from '../utils/pageIndexControl';

export default defineEventHandler(async (event) => {
  const body = await readBody<{ failPasses?: number }>(event);
  pageIndexControl.failPasses = body?.failPasses ?? 0;
  return { failPasses: pageIndexControl.failPasses };
});
```

- [ ] **Step 3: Teach the page index to fail on command**

In `test/fixtures/seo/server/plugins/fakePageIndex.ts`, import the control and fail at the top of the
paginated fetch, before any entry is produced:

```ts
import { pageIndexControl } from '../utils/pageIndexControl';
```

then, as the first statement inside the `paginate` callback in `fakeList`:

```ts
    // Fails the pass the way a real connector outage does — from inside the walk, once consumption
    // has started, rather than by refusing to hand one out.
    if (pageIndexControl.failPasses > 0) {
      pageIndexControl.failPasses--;
      throw new Error('fixture page index is unavailable');
    }
```

- [ ] **Step 4: Prove the switch works and defaults off**

Run: `pnpm test`
Expected: 159 passed. `failPasses` defaults to `0`, so every existing test is unaffected. If the
convergence test changes count, the throw is in the wrong place — it must not consume an entry.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/seo/server/utils/pageIndexControl.ts test/fixtures/seo/server/routes/__page-index-control.ts test/fixtures/seo/server/plugins/fakePageIndex.ts
git commit -m "test: let the fixture page index fail on demand"
```

---

## Task 4: Integration — a failed cold pass recovers

**Files:**
- Create: `test/integration/recovery.test.ts`

This is the end-to-end complement to Task 2's third test. `runRebuildPass` returns rather than rejects
on a transient failure, so the cold request should still persist an empty incomplete snapshot and the
next request should continue from it. That claim has never been checked through the HTTP surface.

- [ ] **Step 1: Write the test**

```ts
import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('a page type whose upstream fails on the first pass', async () => {
  await setup({ rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)) });

  // See test/integration/sitemap.test.ts for why the host has to travel in x-forwarded-host.
  const onHost = <T = string>(path: string, host: string) =>
    $fetch<T>(path, { headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

  const count = (xml: string) => (xml.match(/<loc>/g) ?? []).length;

  it('serves an empty sitemap, then recovers on a later request', async () => {
    await $fetch('/__page-index-control', { method: 'POST', body: { failPasses: 1 } });

    const first = await onHost<string>('/__sitemap__/test-product-de.xml', 'shop.ch');
    expect(count(first)).toBe(0); // guard: the source answered rather than erroring
    expect(first).toContain('urlset');

    const deadline = Date.now() + 30_000;
    let latest = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      latest = count(await onHost<string>('/__sitemap__/test-product-de.xml', 'shop.ch'));
      if (latest > 0) break;
    }

    expect(latest).toBeGreaterThan(0);
  }, 60_000);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run test/integration/recovery.test.ts`
Expected: 1 passed.

If the first request 500s instead of serving an empty sitemap, that is a **real finding, not a broken
test**: it means a transient upstream failure surfaces as an error to the crawler. Report it with the
response body rather than adapting the assertion.

- [ ] **Step 3: Full gates, then commit**

Run: `pnpm lint && pnpm test && pnpm test:types`

```bash
git add test/integration/recovery.test.ts
git commit -m "test: cover recovery from a failed first enumeration"
```

---

## Task 5: Integration — the stale refresh path

**Files:**
- Create: `test/fixtures/seo/server/routes/__seed-snapshot.ts`
- Create: `test/integration/refresh.test.ts`

Reaching `stale` naturally takes 19.2 h (a complete snapshot refreshes at 80 % of a 24 h life), so the
only way to test it is to seed one that is already past its refresh time.

- [ ] **Step 1: Write the seeding route**

`test/fixtures/seo/server/routes/__seed-snapshot.ts`:

```ts
import { defineEventHandler, readBody } from 'h3';
import { useUserlandCache } from '#imports';

/**
 * Writes a snapshot that is already due a refresh, so the stale branch is reachable without waiting
 * out a 24h life. The key format is the module's, mirrored here rather than imported: the fixture is
 * a separate app and the module deliberately exports no test seams. `test/unit/snapshotStore.test.ts`
 * is what keeps the two in step.
 */
export default defineEventHandler(async (event) => {
  const { host, sitemapName, urls } = await readBody<{ host: string; sitemapName: string; urls: string[] }>(event);
  const now = Date.now();
  await useUserlandCache('essentials-seo').setItem(`sitemap:v1:${host}:${sitemapName}`, {
    urls: urls.map((loc) => ({ loc })),
    complete: true,
    expiresAt: now + 60 * 60 * 1000,
    refreshAt: now - 1,
  });
  return { seeded: true };
});
```

- [ ] **Step 2: Add the key-format guard**

Append to `test/unit/snapshotStore.test.ts`, inside `describe('createSnapshotStore', …)`:

```ts
  it('keys a live snapshot exactly as the fixture seeding route writes it', async () => {
    const storage = createStorage();
    const store = createSnapshotStore(storage);
    await store.writeLive('shop.ch', 'test-product-de', {} as never);
    // test/fixtures/seo/server/routes/__seed-snapshot.ts builds this string by hand.
    expect(await storage.getKeys()).toContain('sitemap:v1:shop.ch:test-product-de');
  });
```

Match the existing file's storage construction — read the top of it rather than assuming `createStorage`
is imported the same way.

- [ ] **Step 3: Write the refresh test**

```ts
import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('a live snapshot past its refresh time', async () => {
  await setup({ rootDir: fileURLToPath(new URL('../fixtures/seo', import.meta.url)) });

  const onHost = <T = string>(path: string, host: string) =>
    $fetch<T>(path, { headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' } });

  const count = (xml: string) => (xml.match(/<loc>/g) ?? []).length;

  it('keeps serving the old value until the refresh completes, then swaps it in', async () => {
    await $fetch('/__seed-snapshot', {
      method: 'POST',
      body: { host: 'shop.ch', sitemapName: 'test-product-de', urls: ['https://shop.ch/stale-only'] },
    });

    // The seeded value serves while the refresh accumulates — never a partial of the new one.
    const first = await onHost<string>('/__sitemap__/test-product-de.xml', 'shop.ch');
    expect(first).toContain('https://shop.ch/stale-only');
    expect(count(first)).toBe(1);

    // The refresh needs several passes; until the last one it stays in the pending slot, so every
    // response is either the seeded value or the finished one, never anything between.
    const deadline = Date.now() + 45_000;
    let seenIntermediate = false;
    let promoted = false;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const xml = await onHost<string>('/__sitemap__/test-product-de.xml', 'shop.ch');
      if (!xml.includes('https://shop.ch/stale-only')) {
        promoted = true;
        expect(count(xml)).toBe(24_999);
        break;
      }
      if (count(xml) !== 1) seenIntermediate = true;
    }

    expect(seenIntermediate).toBe(false);
    expect(promoted).toBe(true);
  }, 90_000);
});
```

- [ ] **Step 4: Run it**

Run: `pnpm vitest run test/integration/refresh.test.ts`
Expected: 1 passed.

`seenIntermediate` is the assertion that matters — it is the whole reason the pending slot exists. If it
trips, a reader observed a partial refresh and that is a production bug in `serveSource`'s stale branch,
not a test problem. Report it with the observed count.

If the test instead times out without promoting, check whether the refresh needs more passes than the
budget allows before concluding anything: the fixture holds 25 000 entries at 10 000 per pass.

- [ ] **Step 5: Full gates, then commit**

Run: `pnpm lint && pnpm test && pnpm test:types && pnpm dev:prepare`

```bash
git add test/fixtures/seo/server/routes/__seed-snapshot.ts test/unit/snapshotStore.test.ts test/integration/refresh.test.ts
git commit -m "test: cover the pending-slot refresh and its promotion"
```

---

## Done when

`serveSource` owns the four-state decision and is unit-tested in all of them; an interrupted and a
rejected cold pass are both pinned as executable assertions; the fixture can fail on command; and the
recovery and stale-refresh paths are covered end to end. Roughly 161 tests, all four gates green.

The deadline change then lands in `serveSource`'s `missing` branch and in `runRebuildPass`, both of
which now have tests that will notice if it breaks them.
