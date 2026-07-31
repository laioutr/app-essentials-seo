import type { SitemapSourceResolveContext } from './sitemapSource';

declare module 'nitropack' {
  interface NitroRuntimeHooks {
    'essentials-seo:sitemap-source:built': (ctx: SitemapSourceResolveContext) => void | Promise<void>;
  }
}

export {};
