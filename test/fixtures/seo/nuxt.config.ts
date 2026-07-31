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
  },
  compatibilityDate: '2025-09-11',
});
