import { defineOrchestr, paginate } from '#imports';
import { definePageTypeToken } from '@laioutr-core/core-types/frontend';

/**
 * Six articles, small enough that a single rebuild pass enumerates all of them — so the request after
 * the first one is served from the snapshot, which is what the cached-read case needs. One is flagged
 * noindex, which is what makes `entries` a strict superset of the URLs built from it, and three carry
 * a `featured-*` subject the sitemap hook plugin filters on.
 */
export const FAKE_ARTICLES = [
  { params: { slug: 'a0' }, subject: { type: 'BlogPost', id: 'featured-0' }, meta: { lastModified: '2026-01-01T00:00:00Z' } },
  { params: { slug: 'a1' }, subject: { type: 'BlogPost', id: 'plain-1' }, meta: { lastModified: '2026-01-01T00:00:00Z' } },
  { params: { slug: 'a2' }, subject: { type: 'BlogPost', id: 'featured-2' }, meta: { lastModified: '2026-01-01T00:00:00Z' } },
  { params: { slug: 'a3' }, subject: { type: 'BlogPost', id: 'plain-3' }, meta: { lastModified: '2026-01-01T00:00:00Z', noindex: true } },
  { params: { slug: 'a4' }, subject: { type: 'BlogPost', id: 'featured-4' }, meta: { lastModified: '2026-01-01T00:00:00Z' } },
  { params: { slug: 'a5' }, subject: { type: 'BlogPost', id: 'plain-5' }, meta: { lastModified: '2026-01-01T00:00:00Z' } },
];

/** Enumerates `FAKE_ARTICLES` in one page, so any walk over it ends resumable-but-exhausted. */
export const fakeArticleList = ({ startCursor }: { startCursor?: string }) =>
  paginate(async () => ({ entries: FAKE_ARTICLES, nextCursor: undefined }), startCursor);

/** Matches `type: "test/article"` on the fixture's dynamic article page in laioutrrc.json. */
export const TestArticlePage = definePageTypeToken('test/article', {
  kind: 'dynamic',
  studio: { label: 'Test Article' },
});

export default defineOrchestr.pageIndex({
  for: TestArticlePage,
  batchSize: 50,
  list: fakeArticleList,
});
