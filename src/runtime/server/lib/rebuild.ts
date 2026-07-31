import { dedupeByLoc } from './pageIndexUrls';
import { type Snapshot, stamp } from './snapshotStore';
import type { SitemapUrl } from './alternates';
import { MODULE_NAME } from '../../shared/moduleName';

interface EntryStreamLike {
  toArray(): Promise<any[]>;
}

/**
 * The part of orchestr's `ResumablePageEntryStream` this module reads, both only meaningful once the
 * stream has been consumed. That stream also reports `progressed`, which the contract says to stop a
 * loop on; it is not read here because the only state that sets it without setting `exhausted` is a
 * pass that threw, and those are handled by their rejection long before completion is decided.
 */
interface ResumableEntryStreamLike extends EntryStreamLike {
  readonly endCursor: string | undefined;
  readonly exhausted: boolean;
}

export interface RebuildPassInput {
  previous: Snapshot | null;
  now: number;
  take: number;
  mapEntries: (entries: any[]) => SitemapUrl[];
  /**
   * Offered the URLs this pass just built, together with the entries they were mapped from, before
   * they are accumulated — so whatever it leaves in the array is what the snapshot persists. It sees
   * only what this pass added: URLs carried over from earlier passes were offered in the pass that
   * built them and are never replayed.
   */
  onPassBuilt?: (urls: SitemapUrl[], entries: any[]) => void | Promise<void>;
  /** Injected `listPagesFrom`. Its stream rejects when the registration ignores `startCursor`. */
  listPagesFrom: (options: { take: number; resumeFrom: string | undefined }) => ResumableEntryStreamLike;
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
 * A rejection value can be anything a dependency's async chain throws, including `null` or
 * `undefined` — reading `.message` off those directly would throw a second error out of code whose
 * whole job is describing the first one.
 */
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Advances an accumulation by one bounded pass. Progress is monotonic on a transient failure: a pass
 * that fails for any reason other than a non-resumable handler leaves the previous resume point
 * untouched so the next crawl repeats that pass rather than restarting the whole enumeration. A pass
 * that fails because its handler cannot be resumed at all instead discards the resume point and marks
 * the snapshot complete, after running the non-resumable fallback once.
 */
export const runRebuildPass = async (input: RebuildPassInput): Promise<Snapshot> => {
  const { previous, now, take, mapEntries, onPassBuilt, listPagesFrom, listPages, label } = input;
  const urls = previous ? [...previous.urls] : [];
  const seen = new Set(urls.map((url) => url.loc));

  /**
   * Maps one pass's entries, offers what it built for filtering, then accumulates the survivors.
   * Holes are dropped rather than stored: an accumulated snapshot is read back as the starting point
   * of the next pass, which would throw reading `loc` off one.
   */
  const accumulate = async (passEntries: any[]): Promise<void> => {
    const built = dedupeByLoc(mapEntries(passEntries), seen);
    await onPassBuilt?.(built, passEntries);
    urls.push(...built.filter(Boolean));
  };

  const keep = (complete: boolean, resumeFrom: string | undefined): Snapshot => ({
    urls,
    complete,
    ...(resumeFrom === undefined ? {} : { resumeFrom }),
    ...stamp(complete, now),
  });

  // A page type whose handler ignores startCursor cannot be resumed at all, so one bounded read via
  // listPages is the best this pass can offer until the handler threads the cursor through.
  const runNonResumableFallback = async (error: unknown): Promise<Snapshot> => {
    console.warn(
      `[${MODULE_NAME}] ${label ?? 'page type'} cannot be resumed because its pageIndex list handler ignores startCursor. ` +
        `Its sitemap is capped at ${take} URLs. Return \`paginate(fn, startCursor)\` from the handler to fix it. ` +
        `Original error: ${messageOf(error)}`
    );
    if (!listPages) return keep(true, undefined);
    let fallbackEntries: any[];
    try {
      fallbackEntries = await listPages({ take }).toArray();
    } catch (fallbackError) {
      console.warn(`[${MODULE_NAME}] fallback enumeration failed: ${messageOf(fallbackError)}`);
      return keep(true, undefined);
    }
    // Outside the catch above: this is a capped build like any other, so it owes the caller the same
    // chance to filter it, and a failure in that filter is not an enumeration failure.
    await accumulate(fallbackEntries);
    return keep(true, undefined);
  };

  let stream: ResumableEntryStreamLike;
  try {
    stream = listPagesFrom({ take, resumeFrom: previous?.resumeFrom });
  } catch (error) {
    // Cheap insurance: today the platform only rejects once the stream is consumed (below), never
    // here, but route a synchronous throw to the same fallback in case a future version validates
    // eagerly.
    return runNonResumableFallback(error);
  }

  let entries: any[];
  try {
    entries = await stream.toArray();
  } catch (error) {
    if (isNonResumable(error)) return runNonResumableFallback(error);
    console.warn(
      `[${MODULE_NAME}] enumeration pass failed for ${label ?? 'a page type'}; keeping the last resume point. ` +
        `Original error: ${messageOf(error)}`
    );
    return keep(false, previous?.resumeFrom);
  }

  await accumulate(entries);

  // Both read only after one complete consumption. Completion is the stream's to report rather than
  // ours to infer from the token: the two agree for every pass that reaches here, but a failed pass
  // reports the token it started from, which is `undefined` on a first pass and would read as
  // "exhausted" to anyone inferring. Those are caught by their rejection above — asking the stream
  // directly is what keeps that a local detail of the catch rather than a load-bearing one here.
  return keep(stream.exhausted, stream.endCursor);
};
