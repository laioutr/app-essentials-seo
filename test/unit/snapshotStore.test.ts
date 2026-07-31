import { describe, expect, it } from 'vitest';
import { COMPLETE_TTL_MS, createSnapshotStore, INCOMPLETE_TTL_MS, snapshotState, stamp } from '../../src/runtime/server/lib/snapshotStore';

const memoryStorage = () => {
  const map = new Map<string, unknown>();
  return {
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      map.set(key, value);
    },
    removeItem: async (key: string) => {
      map.delete(key);
    },
    _map: map,
  };
};

const NOW = 1_000_000;

describe('stamp', () => {
  it('gives a complete snapshot a 24h life', () => {
    expect(stamp(true, NOW).expiresAt).toBe(NOW + COMPLETE_TTL_MS);
  });

  it('gives an incomplete snapshot a 1h life so accumulation retries soon', () => {
    expect(stamp(false, NOW).expiresAt).toBe(NOW + INCOMPLETE_TTL_MS);
  });

  it('sets refreshAt at 80 percent of the life', () => {
    const { expiresAt, refreshAt } = stamp(true, NOW);
    expect(refreshAt).toBe(NOW + (expiresAt - NOW) * 0.8);
  });
});

describe('snapshotState', () => {
  const snap = (over: Partial<any>) => ({ urls: [], complete: true, expiresAt: NOW + 1000, refreshAt: NOW + 800, ...over });

  it('reports missing for null', () => {
    expect(snapshotState(null, NOW)).toBe('missing');
  });

  it('reports missing once expired', () => {
    expect(snapshotState(snap({ expiresAt: NOW - 1 }), NOW)).toBe('missing');
  });

  it('reports incomplete regardless of freshness', () => {
    expect(snapshotState(snap({ complete: false }), NOW)).toBe('incomplete');
  });

  it('reports fresh before refreshAt and stale after', () => {
    expect(snapshotState(snap({ refreshAt: NOW + 1 }), NOW)).toBe('fresh');
    expect(snapshotState(snap({ refreshAt: NOW - 1 }), NOW)).toBe('stale');
  });
});

describe('createSnapshotStore', () => {
  it('keys live and pending separately, both by host', async () => {
    const storage = memoryStorage();
    const store = createSnapshotStore(storage as never);
    await store.writeLive('shop.ch', 'pages-de', { urls: [{ loc: '/a' }], complete: true, ...stamp(true, NOW) });
    await store.writePending('shop.ch', 'pages-de', { urls: [{ loc: '/b' }], complete: false, ...stamp(false, NOW) });
    expect((await store.readLive('shop.ch', 'pages-de'))?.urls[0].loc).toBe('/a');
    expect((await store.readPending('shop.ch', 'pages-de'))?.urls[0].loc).toBe('/b');
    expect(await store.readLive('shop.de', 'pages-de')).toBeNull();
  });

  it('promotes pending to live in one write and clears pending', async () => {
    const storage = memoryStorage();
    const store = createSnapshotStore(storage as never);
    await store.writeLive('shop.ch', 'pages-de', { urls: [{ loc: '/old' }], complete: true, ...stamp(true, NOW) });
    await store.writePending('shop.ch', 'pages-de', { urls: [{ loc: '/new' }], complete: true, ...stamp(true, NOW) });
    await store.promotePending('shop.ch', 'pages-de');
    expect((await store.readLive('shop.ch', 'pages-de'))?.urls[0].loc).toBe('/new');
    expect(await store.readPending('shop.ch', 'pages-de')).toBeNull();
  });

  it('is a no-op when there is no pending snapshot to promote', async () => {
    const storage = memoryStorage();
    const store = createSnapshotStore(storage as never);
    await store.writeLive('shop.ch', 'pages-de', { urls: [{ loc: '/old' }], complete: true, ...stamp(true, NOW) });
    await store.promotePending('shop.ch', 'pages-de');
    expect((await store.readLive('shop.ch', 'pages-de'))?.urls[0].loc).toBe('/old');
  });
});
