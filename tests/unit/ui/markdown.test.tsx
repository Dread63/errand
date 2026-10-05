import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, safeHref } from '@/entrypoints/sidepanel/components/Markdown';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('Markdown', () => {
  it('renders GFM lists, tables, emphasis and code', () => {
    const out = html('# Hi\n\n- **one**\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nUse `npm test`.');
    expect(out).toContain('<h1>Hi</h1>');
    expect(out).toContain('<strong>one</strong>');
    expect(out).toContain('<table>');
    expect(out).toContain('<code>npm test</code>');
  });

  it('opens safe links in a new tab', () => {
    expect(html('[site](https://example.com)')).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a>');
  });

  it('never renders raw HTML or script links', () => {
    const out = html('<script>alert(1)</script>\n\nhi <img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<a ');
    expect(out).toContain('<span>x</span>');
  });

  it('wraps tables so they scroll instead of stretching the panel', () => {
    expect(html('| a |\n|---|\n| 1 |')).toContain('class="md-table"');
  });
});

describe('safeHref', () => {
  it('allows only http, https and mailto', () => {
    expect(safeHref('https://a.b')).toBe('https://a.b');
    expect(safeHref('mailto:x@y.z')).toBe('mailto:x@y.z');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,hi')).toBeUndefined();
    expect(safeHref('/relative')).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});
