import type { SitemapSourceResolveContext } from './sitemapSource';

declare module 'nitropack' {
  interface NitroRuntimeHooks {
    'essentials-seo:sitemap-source:resolve': (ctx: SitemapSourceResolveContext) => void | Promise<void>;
  }
}

export {};
