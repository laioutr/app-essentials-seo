import { dedupeByLoc } from './pageIndexUrls';
import { stamp, type Snapshot } from './snapshotStore';
import type { SitemapUrl } from './alternates';

interface EntryStreamLike {
  toArray(): Promise<any[]>;
  readonly endCursor?: string | undefined;
}

export interface RebuildPassInput {
  previous: Snapshot | null;
  now: number;
  take: number;
  mapEntries: (entries: any[]) => SitemapUrl[];
  /** Injected `listPagesFrom`. Its stream rejects when the registration ignores `startCursor`. */
  listPagesFrom: (options: { take: number; resumeFrom: string | undefined }) => EntryStreamLike;
  /** Injected `listPages`, used only for the non-resumable fallback. */
  listPages?: (options: { take: number }) => EntryStreamLike;
  /** Named in the non-resumable diagnostic so the author knows which registration to fix. */
  label?: string;
}

/**
 * The platform throws a plain Error with no code or class of its own when a pageIndex list handler
 * ignores startCursor, so matching its message text is the only way to tell that condition apart
 * from a transient failure.
 */
const isNonResumable = (error: unknown): boolean => error instanceof Error && error.message.includes('ignores startCursor');

/**
 * Advances an accumulation by one bounded pass. Progress is monotonic: a pass that fails leaves the
 * previous resume point untouched so the next crawl repeats that pass rather than restarting the
 * whole enumeration.
 */
export const runRebuildPass = async (input: RebuildPassInput): Promise<Snapshot> => {
  const { previous, now, take, mapEntries, listPagesFrom, listPages, label } = input;
  const urls = previous ? [...previous.urls] : [];
  const seen = new Set(urls.map((url) => url.loc));

  const keep = (complete: boolean, resumeFrom: string | undefined): Snapshot => ({
    urls,
    complete,
    ...(resumeFrom !== undefined ? { resumeFrom } : {}),
    ...stamp(complete, now),
  });

  // A page type whose handler ignores startCursor cannot be resumed at all, so one bounded read via
  // listPages is the best this pass can offer until the handler threads the cursor through.
  const runNonResumableFallback = async (error: Error): Promise<Snapshot> => {
    console.error(
      `[@laioutr/app-essentials-seo] ${label ?? 'page type'} cannot be resumed because its pageIndex list handler ignores startCursor. ` +
        `Its sitemap is capped at ${take} URLs. Return \`paginate(fn, startCursor)\` from the handler to fix it. ` +
        `Original error: ${error.message}`
    );
    if (!listPages) return keep(true, undefined);
    try {
      urls.push(...dedupeByLoc(mapEntries(await listPages({ take }).toArray()), seen));
    } catch (fallbackError) {
      console.error(`[@laioutr/app-essentials-seo] fallback enumeration failed: ${(fallbackError as Error).message}`);
    }
    return keep(true, undefined);
  };

  let stream: EntryStreamLike;
  try {
    stream = listPagesFrom({ take, resumeFrom: previous?.resumeFrom });
  } catch (error) {
    // Cheap insurance: today the platform only rejects once the stream is consumed (below), never
    // here, but route a synchronous throw to the same fallback in case a future version validates
    // eagerly.
    return runNonResumableFallback(error as Error);
  }

  let entries: any[];
  try {
    entries = await stream.toArray();
  } catch (error) {
    if (isNonResumable(error)) return runNonResumableFallback(error as Error);
    console.error(
      `[@laioutr/app-essentials-seo] enumeration pass failed for ${label ?? 'a page type'}; keeping the last resume point. ` +
        `Original error: ${(error as Error).message}`
    );
    return keep(false, previous?.resumeFrom);
  }

  urls.push(...dedupeByLoc(mapEntries(entries), seen));

  // Read only after one complete consumption: undefined means "start here" going in and "exhausted"
  // coming out.
  const endCursor = stream.endCursor;
  return keep(endCursor === undefined, endCursor);
};
