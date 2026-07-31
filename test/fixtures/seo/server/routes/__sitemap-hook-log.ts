import { defineEventHandler } from 'h3';
import { sitemapHookLog } from '../utils/sitemapHookLog';

/** Test-only read-back of what the sitemap source hook has seen this process. */
export default defineEventHandler(() => sitemapHookLog);
