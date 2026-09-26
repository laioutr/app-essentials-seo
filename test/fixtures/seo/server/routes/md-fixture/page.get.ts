import { defineEventHandler, setResponseHeader } from 'h3';

/** Stands in for a frontend-core render: the markup it produces, without the renderer. */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
  return `<!DOCTYPE html><html><head><title>Red Shoe</title>
<meta name="description" content="A red leather shoe">
<meta property="article:modified_time" content="2026-09-01T00:00:00Z">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
</head><body><div id="__nuxt">
<div data-lfc-section="s1" data-lfc-location="header"><a href="/menu">Menu</a> Free shipping</div>
<div data-lfc-section="s2" data-lfc-location="body"><h1>Red Shoe</h1><p>Hand-made in <a href="/about">our workshop</a>.</p><span data-markdown-ignore>Only 3 left!</span></div>
<div data-lfc-section="s3" data-lfc-location="body" data-markdown-ignore>Subscribe to our newsletter</div>
<div data-lfc-section="s4" data-lfc-location="footer">Imprint</div>
</div></body></html>`;
});
