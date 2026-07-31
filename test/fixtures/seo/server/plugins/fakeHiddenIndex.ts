import { defineOrchestr, paginate } from '#imports';
import { FAKE_ARTICLES } from './fakeArticleIndex';
import { definePageTypeToken } from '@laioutr-core/core-types/frontend';

/**
 * A second page type over the same entries as the article index, configured with `include: false` in
 * the fixture's nuxt.config. Sharing the entries is what makes the exclusion test conclusive: the
 * article tests prove this enumeration produces URLs, so an empty sitemap here can only be the
 * exclusion and not a broken registration.
 *
 * Matches `type: "test/hidden"` on the fixture's dynamic hidden page in laioutrrc.json.
 */
export const TestHiddenPage = definePageTypeToken('test/hidden', {
  kind: 'dynamic',
  studio: { label: 'Test Hidden' },
});

export default defineOrchestr.pageIndex({
  for: TestHiddenPage,
  batchSize: 50,
  list: ({ startCursor }: { startCursor?: string }) => paginate(async () => ({ entries: FAKE_ARTICLES, nextCursor: undefined }), startCursor),
});
