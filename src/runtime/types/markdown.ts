import type { H3Event } from 'h3';

/** Payload of `ai-ready:page:markdown`, identical to nuxt-ai-ready's. */
export interface PageMarkdownContext {
  html: string;
  markdown: string;
  route: string;
  title: string;
  description: string;
  isPrerender: boolean;
  event: H3Event;
}

/** What an `ai-ready:markdown:source` listener supplies to skip rendering the page. */
export interface MarkdownSource {
  markdown: string;
  title?: string;
  description?: string;
  updatedAt?: string;
}

export interface MarkdownSourceContext {
  route: string;
  event: H3Event;
  source: MarkdownSource | null;
}
