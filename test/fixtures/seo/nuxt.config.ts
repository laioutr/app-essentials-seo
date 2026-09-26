import laioutrrc from './laioutrrc.json';
import SeoModule from '../../../src/module';

export default defineNuxtConfig({
  modules: [SeoModule, '@laioutr-core/frontend-core'],
  laioutr: { laioutrrc: laioutrrc as any },
  '@laioutr/app-essentials-seo': {
    sitemap: {
      entriesPerRequest: 10_000,
      excludePageTypes: [],
    },
    aiReady: {
      // Off so a seeded snapshot shows up on the next request instead of after the cache expires.
      llmsTxtCacheSeconds: 0,
      llmsTxt: {
        notes: 'Fixture shop for tests.',
        sections: [{ title: 'Help', links: [{ title: 'FAQ', href: 'https://shop.ch/faq.md' }] }],
        pageTypes: { 'test/article': false },
      },
    },
  },
  compatibilityDate: '2025-09-11',
});
