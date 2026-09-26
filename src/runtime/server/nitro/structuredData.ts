import { defineNitroPlugin } from '#imports';
import { appendStructuredData } from '../lib/structuredData';

// A hook listener rather than part of the conversion, so it keeps working unchanged on top of
// nuxt-ai-ready, which calls the same hook.
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('ai-ready:page:markdown', (ctx) => {
    ctx.markdown = appendStructuredData(ctx.markdown, ctx.html);
  });
});
