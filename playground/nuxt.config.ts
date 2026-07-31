import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fixtureRc from './fixtures/laioutrrc.json';
import srcModule from '../src/module';

// Drop a real project's `laioutrrc.json` beside this file to run the playground against it
const localRc = fileURLToPath(new URL('./laioutrrc.json', import.meta.url));
const hasLocalRc = existsSync(localRc);
const laioutrrc = hasLocalRc ? JSON.parse(readFileSync(localRc, 'utf8')) : fixtureRc;

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
  // A real rc reaches real connectors, so a pass enumerates a live catalogue rather than a fixture.
  // Kept small deliberately: it bounds the upstream traffic one request can cause, and makes the
  // snapshot accumulate over several requests where the default would finish in one.
  ...(hasLocalRc ? { '@laioutr/app-essentials-seo': { sitemap: { entriesPerRequest: 10_000 } } } : {}),
  devtools: { enabled: true },
  compatibilityDate: '2025-09-11',
});
