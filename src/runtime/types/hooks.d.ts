import type { SitemapSourceBuiltContext } from './sitemapSource';

declare module 'nitropack' {
  interface NitroRuntimeHooks {
    'essentials-seo:sitemap-source:built': (ctx: SitemapSourceBuiltContext) => void | Promise<void>;
  }
}

export {};
