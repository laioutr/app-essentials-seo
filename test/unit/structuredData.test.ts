import { describe, expect, it } from 'vitest';
import { appendStructuredData, extractJsonLd } from '../../src/runtime/server/lib/structuredData';

const html = `<head><script type="application/ld+json">{"@type":"BreadcrumbList"}</script></head>
<body><script type='application/ld+json' data-x>{"@type":"Product","name":"Shoe"}</script><script>var x</script>
<script type="application/ld+json">{ not json </script></body>`;

describe('structured data', () => {
  it('collects every JSON-LD script from head and body', () => {
    expect(extractJsonLd(html)).toEqual(['{"@type":"BreadcrumbList"}', '{"@type":"Product","name":"Shoe"}', '{ not json']);
  });

  it('appends each block pretty-printed, and invalid JSON verbatim', () => {
    expect(appendStructuredData('# Shoe\n', html)).toBe(
      [
        '# Shoe',
        '',
        '## Structured Data',
        '',
        '```json\n{\n  "@type": "BreadcrumbList"\n}\n```',
        '',
        '```json\n{\n  "@type": "Product",\n  "name": "Shoe"\n}\n```',
        '',
        '```json\n{ not json\n```',
        '',
      ].join('\n')
    );
  });

  it('leaves Markdown alone when there is none', () => {
    expect(appendStructuredData('# Shoe\n', '<p>x</p>')).toBe('# Shoe\n');
  });

  it('does not treat a script as JSON-LD when data-type masquerades as type', () => {
    expect(extractJsonLd('<script data-type="application/ld+json" type="text/javascript">alert(1)</script>')).toEqual([]);
  });
});
