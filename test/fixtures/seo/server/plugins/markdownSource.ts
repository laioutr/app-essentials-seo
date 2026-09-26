import { defineNitroPlugin } from '#imports';

// Stands in for a consumer app that supplies a page's Markdown directly — e.g. from a CMS or a
// pre-rendered artifact — with no HTML route behind it at all.
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('ai-ready:markdown:source', (ctx) => {
    if (ctx.route !== '/md-fixture/sourced') return;
    ctx.source = { markdown: '# From source', title: 'Sourced' };
  });
});
