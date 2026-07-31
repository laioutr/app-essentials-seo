import { describe, expect, it } from 'vitest';
import type { SitemapUrl } from '../../src/runtime/server/lib/alternates';
import { serveSource, type ServeSourceInput } from '../../src/runtime/server/lib/serveSource';
import { COMPLETE_TTL_MS, type Snapshot, type SnapshotStore } from '../../src/runtime/server/lib/snapshotStore';

const url = (loc: string): SitemapUrl => ({ loc }) as SitemapUrl;

/** `now` is 0 in every test below, so these offsets read as "relative to the request". */
const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  urls: [url('https://shop.ch/a')],
  complete: true,
  expiresAt: COMPLETE_TTL_MS,
  refreshAt: COMPLETE_TTL_MS * 0.8,
  ...over,
});

const KEY = 'shop.ch:test-product-de';

/** Records call order, which is what the cold-path assertions are actually about. */
const fakeStore = () => {
  const live = new Map<string, Snapshot>();
  const pending = new Map<string, Snapshot>();
  const calls: string[] = [];
  const key = (host: string, name: string) => `${host}:${name}`;
  const store: SnapshotStore = {
    readLive: async (host, name) => live.get(key(host, name)) ?? null,
    readPending: async (host, name) => pending.get(key(host, name)) ?? null,
    writeLive: async (host, name, next) => {
      calls.push('writeLive');
      live.set(key(host, name), next);
    },
    writePending: async (host, name, next) => {
      calls.push('writePending');
      pending.set(key(host, name), next);
    },
    promotePending: async (host, name) => {
      calls.push('promotePending');
      const promoted = pending.get(key(host, name));
      if (!promoted) return;
      live.set(key(host, name), promoted);
      pending.delete(key(host, name));
    },
  };
  return { store, calls, live, pending };
};

const run = (over: Partial<ServeSourceInput> & { store: SnapshotStore }) =>
  serveSource({
    host: 'shop.ch',
    sitemapName: 'test-product-de',
    now: 0,
    pass: async () => snapshot(),
    schedule: () => {},
    ...over,
  });

describe('serveSource', () => {
  describe('missing', () => {
    it('builds, persists, and serves what it built', async () => {
      const { store, calls, live } = fakeStore();
      const built = snapshot({ urls: [url('https://shop.ch/new')] });

      const urls = await run({ store, pass: async () => built });

      expect(urls).toEqual(built.urls);
      expect(calls).toEqual(['writeLive']);
      expect(live.get(KEY)).toBe(built);
    });

    it('persists nothing while the first pass is still running', async () => {
      const { store, calls } = fakeStore();
      let finish: (next: Snapshot) => void;
      const pass = () =>
        new Promise<Snapshot>((resolve) => {
          finish = resolve;
        });

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

  describe('incomplete', () => {
    const partial = () =>
      snapshot({ complete: false, urls: [url('https://shop.ch/partial')], expiresAt: 1_000, refreshAt: 800 });

    it('serves the partial without waiting and advances it behind the response', async () => {
      const { store, calls, live } = fakeStore();
      const current = partial();
      live.set(KEY, current);
      const grown = snapshot({ complete: false, urls: [...current.urls, url('https://shop.ch/more')] });
      let scheduled: (() => Promise<void>) | undefined;

      const urls = await run({ store, pass: async () => grown, schedule: (fn) => (scheduled = fn) });

      expect(urls).toEqual(current.urls);
      expect(calls).toEqual([]); // served before any work ran
      await scheduled!();
      expect(calls).toEqual(['writeLive']);
      expect(live.get(KEY)).toBe(grown);
    });

    it('hands the pass the snapshot it is continuing', async () => {
      const { store, live } = fakeStore();
      const current = partial();
      live.set(KEY, current);
      let seen: Snapshot | null | undefined;

      await run({
        store,
        pass: async (previous) => {
          seen = previous;
          return snapshot();
        },
        schedule: (fn) => {
          fn();
        },
      });

      expect(seen).toBe(current);
    });
  });

  describe('stale', () => {
    const stale = () => snapshot({ refreshAt: -1 });

    it('accumulates a refresh in pending and promotes it once complete', async () => {
      const { store, calls, live, pending } = fakeStore();
      live.set(KEY, stale());
      const refreshed = snapshot({ complete: true, urls: [url('https://shop.ch/fresh')] });
      let scheduled: (() => Promise<void>) | undefined;

      const urls = await run({ store, pass: async () => refreshed, schedule: (fn) => (scheduled = fn) });

      expect(urls).toEqual(stale().urls); // the old value keeps serving while the refresh runs
      await scheduled!();
      expect(calls).toEqual(['writePending', 'promotePending']);
      expect(live.get(KEY)).toBe(refreshed);
      expect(pending.size).toBe(0);
    });

    it('leaves an unfinished refresh pending so no reader sees a partial', async () => {
      const { store, calls, live, pending } = fakeStore();
      const current = stale();
      live.set(KEY, current);
      const halfway = snapshot({ complete: false, urls: [url('https://shop.ch/halfway')] });
      let scheduled: (() => Promise<void>) | undefined;

      await run({ store, pass: async () => halfway, schedule: (fn) => (scheduled = fn) });
      await scheduled!();

      expect(calls).toEqual(['writePending']);
      expect(live.get(KEY)).toBe(current);
      expect(pending.get(KEY)).toBe(halfway);
    });

    it('continues from pending rather than restarting the refresh', async () => {
      const { store, live, pending } = fakeStore();
      live.set(KEY, stale());
      const half = snapshot({ complete: false });
      pending.set(KEY, half);
      let seen: Snapshot | null | undefined;

      await run({
        store,
        pass: async (previous) => {
          seen = previous;
          return snapshot();
        },
        schedule: (fn) => {
          fn();
        },
      });

      expect(seen).toBe(half);
    });
  });

  describe('fresh', () => {
    it('serves the snapshot and schedules nothing', async () => {
      const { store, calls, live } = fakeStore();
      const current = snapshot();
      live.set(KEY, current);
      let scheduledCount = 0;

      const urls = await run({ store, schedule: () => scheduledCount++ });

      expect(urls).toEqual(current.urls);
      expect(scheduledCount).toBe(0);
      expect(calls).toEqual([]);
    });

    it('treats an expired snapshot as missing rather than serving it', async () => {
      const { store, calls, live } = fakeStore();
      live.set(KEY, snapshot({ expiresAt: -1 }));
      const rebuilt = snapshot({ urls: [url('https://shop.ch/rebuilt')] });

      const urls = await run({ store, pass: async () => rebuilt });

      expect(urls).toEqual(rebuilt.urls);
      expect(calls).toEqual(['writeLive']);
    });
  });
});
