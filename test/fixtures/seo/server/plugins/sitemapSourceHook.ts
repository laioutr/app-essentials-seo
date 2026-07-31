import { defineNitroPlugin } from '#imports';
import { sitemapHookLog } from '../utils/sitemapHookLog';

/**
 * Stands in for a consumer app extending the sitemap: it keeps only the articles whose entry carries
 * a `featured-*` subject, deciding from `ctx.entries` alone. That is the natural shape of such a
 * filter, and also the one that silently empties a sitemap when `entries` arrives empty — with no
 * entries nothing matches, so nothing survives.
 *
 * Every call is logged, including the ones for sources this filter ignores, so a test can assert what
 * the hook was handed and how often it fired.
 */
export default defineNitroPlugin((nitro: any) => {
  nitro.hooks.hook('essentials-seo:sitemap-source:resolve', (ctx: any) => {
    sitemapHookLog.push({ token: ctx.token, locale: ctx.locale, entries: ctx.entries.length, urls: ctx.urls.length });
    if (ctx.token !== 'test/article') return;

    const featured = new Set(
      ctx.entries.filter((entry: any) => String(entry.subject?.id).startsWith('featured')).map((entry: any) => entry.params.slug)
    );
    // The slug is the one part of an entry that reaches the URL, so it is what links the two back
    // together.
    const kept = ctx.urls.filter((url: any) => featured.has(url.loc.split('/').pop()));
    ctx.urls.length = 0;
    ctx.urls.push(...kept);
  });
});
