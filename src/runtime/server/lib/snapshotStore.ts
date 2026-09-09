import type { SitemapUrl } from './alternates';
import type { EntryOptions, TypedCacheStore } from '@laioutr-core/orchestr/types';

export const COMPLETE_TTL_MS = 24 * 60 * 60 * 1000;
/** Short so an unfinished accumulation is retried within the hour and keeps making progress. */
export const INCOMPLETE_TTL_MS = 60 * 60 * 1000;
const REFRESH_FACTOR = 0.8;

export interface Snapshot {
  urls: SitemapUrl[];
  complete: boolean;
  /**
   * Opaque page-index resume token. Not bound to its enumeration by the platform, so it is only ever
   * read back under the same (host, sitemap name) key that produced it.
   */
  resumeFrom?: string;
  expiresAt: number;
  refreshAt: number;
}

/**
 * The store's own window, which is not the one that decides what gets served: a snapshot carries
 * `expiresAt` and `refreshAt`, and `serveSource` picks its branch from those. This only has to
 * outlive the longest of them, so the store never evicts a snapshot the state machine still
 * considers live. No `staleMaxAge`, because the snapshot's own `refreshAt` already expresses that.
 */
const STORE_OPTIONS: EntryOptions<Snapshot> = { maxAge: Math.ceil((COMPLETE_TTL_MS * 2) / 1000) };

export const stamp = (complete: boolean, now: number): { expiresAt: number; refreshAt: number } => {
  const ttl = complete ? COMPLETE_TTL_MS : INCOMPLETE_TTL_MS;
  return { expiresAt: now + ttl, refreshAt: now + ttl * REFRESH_FACTOR };
};

export const snapshotState = (snapshot: Snapshot | null, now: number): 'missing' | 'fresh' | 'stale' | 'incomplete' => {
  if (!snapshot || snapshot.expiresAt <= now) return 'missing';
  if (!snapshot.complete) return 'incomplete';
  return snapshot.refreshAt <= now ? 'stale' : 'fresh';
};

/**
 * Two keys per source. A refresh accumulates over several passes, so it cannot happen in the value
 * being served without exposing a partial sitemap; it lands in `:pending` and replaces `live` in a
 * single write once it completes. The host is in the key because one build serves every market.
 *
 * The cache is a parameter rather than a `useUserlandCache()` call of its own, so a test can drive
 * this without a Nitro request in scope.
 */
export const createSnapshotStore = (cache: TypedCacheStore<Snapshot>) => {
  const liveKey = (host: string, name: string) => `sitemap:v1:${host}:${name}`;
  const pendingKey = (host: string, name: string) => `${liveKey(host, name)}:pending`;

  const read = async (key: string): Promise<Snapshot | null> => {
    const hit = await cache.readOne(key, STORE_OPTIONS);
    // `absent` is a cached "there is nothing here", which for a snapshot means the same as no entry.
    return hit && !hit.absent ? hit.value : null;
  };

  return {
    readLive: (host: string, name: string) => read(liveKey(host, name)),
    readPending: (host: string, name: string) => read(pendingKey(host, name)),
    writeLive: (host: string, name: string, snapshot: Snapshot) => cache.writeOne(liveKey(host, name), snapshot, STORE_OPTIONS),
    writePending: (host: string, name: string, snapshot: Snapshot) => cache.writeOne(pendingKey(host, name), snapshot, STORE_OPTIONS),
    /**
     * In-process this is ordered: `writeOne` populates the in-memory tier synchronously, so a reader
     * on this instance sees the promoted value before the pending key is gone. The shared tier is
     * not, because `writeOne` defers its write while `remove` awaits its own — so an instance that
     * dies in that window loses the promotion and keeps no pending to resume from. The next pass
     * rebuilds it, which is what the caller's in-flight guard already tolerates.
     */
    promotePending: async (host: string, name: string): Promise<void> => {
      const pending = await read(pendingKey(host, name));
      if (!pending) return;
      cache.writeOne(liveKey(host, name), pending, STORE_OPTIONS);
      await cache.remove([pendingKey(host, name)]);
    },
  };
};

export type SnapshotStore = ReturnType<typeof createSnapshotStore>;
