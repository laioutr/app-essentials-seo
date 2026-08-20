import type { SitemapSourceBuiltContext } from './sitemapSource';
import type { H3Event } from 'h3';

declare module 'nitropack' {
  interface NitroRuntimeHooks {
    'essentials-seo:sitemap-source:built': (ctx: SitemapSourceBuiltContext) => void | Promise<void>;
    /**
     * Fired by `@nuxtjs/robots` with the rendered robots.txt, which it re-reads off `ctx` afterwards
     * — so a handler edits `robotsTxt` in place rather than returning a new one.
     *
     * Declared here because the package ships no declaration for it: the name appears only in its
     * JavaScript. That went unnoticed while `NitroRuntimeHooks` still tolerated an unknown key; a
     * newer nitropack does not, which is what makes this explicit rather than optional.
     */
    'robots:robots-txt': (ctx: { robotsTxt: string; e: H3Event }) => void | Promise<void>;
  }
}

export {};
