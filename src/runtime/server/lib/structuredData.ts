const JSON_LD_SCRIPT = /<script\b[^>]*\stype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

export const extractJsonLd = (html: string): string[] =>
  [...html.matchAll(JSON_LD_SCRIPT)].map((match) => (match[1] ?? '').trim()).filter(Boolean);

// Unparseable content is kept rather than dropped: a malformed block still tells a reader what the page claims.
const prettyPrint = (raw: string): string => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

/**
 * mdream drops every `<script>`, and with it the page's schema.org data — which for a product page is
 * the price and availability an agent came for. Read from the full HTML, so a section opted out of
 * Markdown never takes structured data with it.
 */
export const appendStructuredData = (markdown: string, html: string): string => {
  const blocks = extractJsonLd(html);
  if (blocks.length === 0) return markdown;
  const fenced = blocks.map((block) => `\`\`\`json\n${prettyPrint(block)}\n\`\`\``).join('\n\n');
  return `${markdown.trimEnd()}\n\n## Structured Data\n\n${fenced}\n`;
};
