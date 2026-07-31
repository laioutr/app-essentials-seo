import laioutrrc from './fixtures/laioutrrc.json';
import srcModule from '../src/module';

export default defineNuxtConfig({
  modules: [
    srcModule,
    '@pinia/nuxt', // Added to show in devtools
    '@laioutr-core/frontend-core',
    '@laioutr-core/devtools',
  ],
  laioutr: {
    laioutrrc: laioutrrc as any,
  },
  devtools: { enabled: true },
  compatibilityDate: '2025-09-11',
});
