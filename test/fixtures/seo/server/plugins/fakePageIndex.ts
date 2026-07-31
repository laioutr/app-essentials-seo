import { defineOrchestr, paginate } from '#imports';
import { definePageTypeToken } from '@laioutr-core/core-types/frontend';

const TOTAL = 25_000;
const BATCH = 250;

/**
 * Registers the token in the platform's page-type registry — matches `type: "test/product"` on the
 * fixture's dynamic page in laioutrrc.json.
 */
export const TestProductPage = definePageTypeToken('test/product', {
  kind: 'dynamic',
  studio: { label: 'Test Product' },
});

export const fakeList = ({ batchSize, startCursor }: { batchSize: number; startCursor?: string }) =>
  paginate(async ({ cursor }: { cursor: string | undefined }) => {
    const offset = cursor ? Number(cursor) : 0;
    const size = Math.min(batchSize ?? BATCH, TOTAL - offset);
    const entries = Array.from({ length: Math.max(size, 0) }, (_, i) => ({
      params: { slug: `p${offset + i}` },
      meta: { lastModified: '2026-01-01T00:00:00Z', noindex: offset + i === 0 },
    }));
    const next = offset + size;
    return { entries, nextCursor: next >= TOTAL ? undefined : String(next) };
  }, startCursor);

// `defineOrchestr.pageIndex(...)` returns a `NitroAppPlugin` — a plain `(nitro) => void` function —
// so default-exporting it here is all the wiring this fixture needs; Nuxt auto-registers everything
// under `server/plugins/`. There is no `orchestr:page-index:register` hook: the builder call above
// *is* the registration, and `registerLaioutrApp`'s `orchestrDirs` (module-level only) does not apply
// to an app fixture like this one.
export default defineOrchestr.pageIndex({
  for: TestProductPage,
  batchSize: BATCH,
  list: fakeList,
});
