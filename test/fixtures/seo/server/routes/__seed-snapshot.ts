import { useUserlandCache } from '#imports';
import { defineEventHandler, readBody } from 'h3';

/**
 * Writes a snapshot that is already due a refresh, so the stale branch is reachable without waiting
 * out a 24h life. The key format is the module's, mirrored here rather than imported: this fixture is
 * a separate app and the module deliberately exports no test seams. A case in
 * test/unit/snapshotStore.test.ts is what keeps the two in step.
 */
export default defineEventHandler(async (event) => {
  const { host, sitemapName, urls } = await readBody<{ host: string; sitemapName: string; urls: string[] }>(event);
  const now = Date.now();
  await useUserlandCache('essentials-seo').setItem(`sitemap:v1:${host}:${sitemapName}`, {
    urls: urls.map((loc) => ({ loc })),
    complete: true,
    expiresAt: now + 60 * 60 * 1000,
    refreshAt: now - 1,
  });
  return { seeded: true };
});
