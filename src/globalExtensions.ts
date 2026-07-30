/* eslint-disable @typescript-eslint/no-empty-object-type */
import type { ResolvedOptions } from './types';

declare module '@nuxt/schema' {
  interface PublicRuntimeConfig {
    ['@laioutr/app-essentials-seo']: {
      sitemap: ResolvedOptions['sitemap'];
    };
  }
  interface RuntimeConfig {
    ['@laioutr/app-essentials-seo']: ResolvedOptions;
  }
}

export {};
