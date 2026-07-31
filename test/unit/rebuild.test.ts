import { describe, expect, it, vi } from 'vitest';
import { runRebuildPass } from '../../src/runtime/server/lib/rebuild';

/** Fake matching orchestr's ResumablePageEntryStream: endCursor is only defined after consumption. */
const fakeStream = (entries: any[], endCursor: string | undefined) => {
  let consumed = false;
  return {
    toArray: async () => {
      consumed = true;
      return entries;
    },
    get endCursor() {
      return consumed ? endCursor : undefined;
    },
    async *[Symbol.asyncIterator] () {
      yield* entries;
    },
  };
};

/** Fake whose toArray() rejects, matching how orchestr's iterateResumed surfaces its errors. */
const rejectingStream = (message: string) => ({
  toArray: async () => {
    throw new Error(message);
  },
  endCursor: undefined,
  async *[Symbol.asyncIterator] () {},
});

const entry = (slug: string) => ({ params: { slug }, meta: {} });

const NON_RESUMABLE_MESSAGE = '[orchestr] the pageIndex list handler for "x" ignores startCursor, so listPagesFrom cannot resume it.';

const base = {
  now: 1_000_000,
  take: 2,
  mapEntries: (entries: any[]) => entries.map((e) => ({ loc: `/p/${e.params.slug}` })),
};

describe('runRebuildPass', () => {
  it('starts with no resume token and stores the one it receives', async () => {
    const listPagesFrom = vi.fn(() => fakeStream([entry('a'), entry('b')], 'cursor-1'));
    const next = await runRebuildPass({ ...base, previous: null, listPagesFrom });
    expect(listPagesFrom).toHaveBeenCalledWith(expect.objectContaining({ resumeFrom: undefined, take: 2 }));
    expect(next.urls.map((u) => u.loc)).toEqual(['/p/a', '/p/b']);
    expect(next.resumeFrom).toBe('cursor-1');
    expect(next.complete).toBe(false);
  });

  it('resumes from the stored token and appends', async () => {
    const previous = { urls: [{ loc: '/p/a' }], complete: false, resumeFrom: 'cursor-1', expiresAt: 0, refreshAt: 0 };
    const listPagesFrom = vi.fn(() => fakeStream([entry('c')], undefined));
    const next = await runRebuildPass({ ...base, previous, listPagesFrom });
    expect(listPagesFrom).toHaveBeenCalledWith(expect.objectContaining({ resumeFrom: 'cursor-1' }));
    expect(next.urls.map((u) => u.loc)).toEqual(['/p/a', '/p/c']);
  });

  it('marks complete when the stream reports an undefined endCursor after consumption', async () => {
    const next = await runRebuildPass({ ...base, previous: null, listPagesFrom: () => fakeStream([entry('a')], undefined) });
    expect(next.complete).toBe(true);
    expect(next.resumeFrom).toBeUndefined();
  });

  it('does not re-add a loc already accumulated', async () => {
    const previous = { urls: [{ loc: '/p/a' }], complete: false, resumeFrom: 'c', expiresAt: 0, refreshAt: 0 };
    const next = await runRebuildPass({ ...base, previous, listPagesFrom: () => fakeStream([entry('a'), entry('b')], undefined) });
    expect(next.urls.map((u) => u.loc)).toEqual(['/p/a', '/p/b']);
  });

  it('keeps the previous resume token when a pass throws', async () => {
    const previous = { urls: [{ loc: '/p/a' }], complete: false, resumeFrom: 'cursor-1', expiresAt: 0, refreshAt: 0 };
    const listPagesFrom = () => ({
      toArray: async () => {
        throw new Error('upstream exploded');
      },
      endCursor: undefined,
      async *[Symbol.asyncIterator] () {},
    });
    const next = await runRebuildPass({ ...base, previous, listPagesFrom: listPagesFrom as never });
    expect(next.resumeFrom).toBe('cursor-1');
    expect(next.complete).toBe(false);
    expect(next.urls.map((u) => u.loc)).toEqual(['/p/a']);
  });

  // Real orchestr never throws synchronously from listPagesFrom itself — the "ignores startCursor"
  // error surfaces only once the returned stream is consumed, because iterateResumed is an async
  // generator. These three tests replace the brief's single synchronous-throw case.

  it('falls back to listPages when the stream rejects because the handler ignores startCursor', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const listPagesFrom = vi.fn(() => rejectingStream(NON_RESUMABLE_MESSAGE));
    const fallback = vi.fn(() => fakeStream([entry('a')], undefined));
    const next = await runRebuildPass({ ...base, previous: null, listPagesFrom: listPagesFrom as never, listPages: fallback });
    expect(fallback).toHaveBeenCalled();
    expect(next.complete).toBe(true);
    expect(next.urls.map((u) => u.loc)).toEqual(['/p/a']);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('startCursor'));
    warnSpy.mockRestore();
  });

  it('does not fall back and keeps the previous resume point when the stream rejects for an unrelated reason', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const previous = { urls: [{ loc: '/p/a' }], complete: false, resumeFrom: 'cursor-1', expiresAt: 0, refreshAt: 0 };
    const listPagesFrom = vi.fn(() => rejectingStream('upstream exploded'));
    const fallback = vi.fn(() => fakeStream([entry('z')], undefined));
    const next = await runRebuildPass({ ...base, previous, listPagesFrom: listPagesFrom as never, listPages: fallback });
    expect(fallback).not.toHaveBeenCalled();
    expect(next.complete).toBe(false);
    expect(next.resumeFrom).toBe('cursor-1');
    expect(next.urls.map((u) => u.loc)).toEqual(['/p/a']);
    warnSpy.mockRestore();
  });

  it('reaches the fallback when listPagesFrom itself throws synchronously for the same reason', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const listPagesFrom = () => {
      throw new Error(NON_RESUMABLE_MESSAGE);
    };
    const fallback = vi.fn(() => fakeStream([entry('a')], undefined));
    const next = await runRebuildPass({ ...base, previous: null, listPagesFrom: listPagesFrom as never, listPages: fallback });
    expect(fallback).toHaveBeenCalled();
    expect(next.complete).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('startCursor'));
    warnSpy.mockRestore();
  });

  it('returns a snapshot instead of rejecting when the stream rejects with null', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const previous = { urls: [{ loc: '/p/a' }], complete: false, resumeFrom: 'cursor-1', expiresAt: 0, refreshAt: 0 };
    const listPagesFrom = () => ({
      toArray: async () => {
        // A dependency's async chain can reject with anything, not just an Error — this is the case
        // that reading `.message` off an un-narrowed cast gets wrong. The literal throw is the point:
        // rewriting it to `throw new Error(...)` would delete coverage for that fix.
        // eslint-disable-next-line no-throw-literal
        throw null;
      },
      endCursor: undefined,
      async *[Symbol.asyncIterator] () {},
    });
    const next = await runRebuildPass({ ...base, previous, listPagesFrom: listPagesFrom as never });
    expect(next.resumeFrom).toBe('cursor-1');
    expect(next.complete).toBe(false);
    expect(next.urls.map((u) => u.loc)).toEqual(['/p/a']);
    warnSpy.mockRestore();
  });
});
