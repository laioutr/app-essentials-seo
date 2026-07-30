import type { SitemapUrl } from './alternates';
import type { Storage } from 'unstorage';

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
 */
export const createSnapshotStore = (storage: Storage) => {
  const liveKey = (host: string, name: string) => `sitemap:v1:${host}:${name}`;
  const pendingKey = (host: string, name: string) => `${liveKey(host, name)}:pending`;

  const read = async (key: string): Promise<Snapshot | null> => ((await storage.getItem(key)) as Snapshot | null) ?? null;

  return {
    readLive: (host: string, name: string) => read(liveKey(host, name)),
    readPending: (host: string, name: string) => read(pendingKey(host, name)),
    writeLive: (host: string, name: string, snapshot: Snapshot) => storage.setItem(liveKey(host, name), snapshot),
    writePending: (host: string, name: string, snapshot: Snapshot) => storage.setItem(pendingKey(host, name), snapshot),
    promotePending: async (host: string, name: string): Promise<void> => {
      const pending = await read(pendingKey(host, name));
      if (!pending) return;
      await storage.setItem(liveKey(host, name), pending);
      await storage.removeItem(pendingKey(host, name));
    },
  };
};

export type SnapshotStore = ReturnType<typeof createSnapshotStore>;
