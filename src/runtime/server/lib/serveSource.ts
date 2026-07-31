import { type Snapshot, snapshotState, type SnapshotStore } from './snapshotStore';
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
 * build before it can answer; every other one answers from the stored snapshot and advances it behind
 * the response, so a crawler waits for a full enumeration exactly once per source.
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
      // Current and complete: serving it is the whole of the work.
      break;
    // Naming every state `snapshotState` returns is what makes a new one a visible gap here rather
    // than something a catch-all silently absorbs.
    // no default
  }

  // Non-null: `missing` returned above, and an absent or expired snapshot is exactly what resolves to
  // `missing`.
  return live!.urls;
};
