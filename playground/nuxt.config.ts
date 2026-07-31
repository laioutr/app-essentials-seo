import srcModule from '../src/module';
// This rc is shared with the integration suite, which asserts against its exact shape
// (host/locale lists, page counts). Don't edit it for playground purposes.
import laioutrrc from '../test/fixtures/seo/laioutrrc.json';

// Disable project secret key for playground. laioutrrc is shared with the test fixture, so build
// a copy rather than mutating the import in place.
const rc = { ...laioutrrc, laioutr: { ...laioutrrc.laioutr, projectSecretKey: false as any } };

export default defineNuxtConfig({
  modules: [
    srcModule,
    '@pinia/nuxt', // Added to show in devtools
    '@laioutr-core/frontend-core',
    '@laioutr-core/devtools',
  ],
  laioutr: {
    laioutrrc: rc as any,
  },
  devtools: { enabled: true },
  compatibilityDate: '2025-09-11',
});
