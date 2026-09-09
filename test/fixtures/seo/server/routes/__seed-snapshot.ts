import { useUserlandCache } from '#imports';
import { defineEventHandler, readBody } from 'h3';

/**
 * Writes a snapshot that is already due a refresh, so the stale branch is reachable without waiting
 * out a 24h life. The key format and the store window are the module's, mirrored here rather than
 * imported: this fixture is a separate app and the module deliberately exports no test seams. A case
 * in test/unit/snapshotStore.test.ts is what keeps the two in step.
 *
 * `writeOne` returns before its shared-tier write lands, but it populates the in-process tier
 * synchronously — and the sitemap plugin this seeds for runs in this same process, off the same
 * store instance — so the value is readable the moment this responds.
 */
export default defineEventHandler(async (event) => {
  const { host, sitemapName, urls } = await readBody<{ host: string; sitemapName: string; urls: string[] }>(event);
  const now = Date.now();
  useUserlandCache('essentials-seo').writeOne(
    `sitemap:v1:${host}:${sitemapName}`,
    {
      urls: urls.map((loc) => ({ loc })),
      complete: true,
      expiresAt: now + 60 * 60 * 1000,
      refreshAt: now - 1,
    },
    { maxAge: Math.ceil((24 * 60 * 60 * 1000 * 2) / 1000) }
  );
  return { seeded: true };
});
