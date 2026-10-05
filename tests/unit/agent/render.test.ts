import { describe, expect, it } from 'vitest';
import { renderElement, renderSnapshot } from '@/lib/agent/render';
import type { ElementInfo, PageSnapshot } from '@/lib/types';

const el = (id: number, over: Partial<ElementInfo> = {}): ElementInfo => ({
  id,
  tag: 'button',
  role: 'button',
  name: `Item ${id}`,
  inForm: false,
  isSubmit: false,
  download: false,
  rect: { x: 0, y: 0, w: 10, h: 10 },
  ...over,
});
const snap = (elements: ElementInfo[], over: Partial<PageSnapshot> = {}): PageSnapshot => ({
  url: 'https://shop.test/',
  title: 'Shop',
  restricted: false,
  elements,
  headings: ['Deals', 'Cart'],
  scrollY: 0,
  scrollMaxY: 1000,
  viewport: { w: 1000, h: 800 },
  ...over,
});

describe('renderElement', () => {
  it('renders role, name, value, state and options', () => {
    expect(renderElement(el(3, { role: 'textbox', tag: 'input', type: 'email', name: 'Email', value: 'a@b.c' }), 'compact')).toBe(
      '[3] textbox "Email" type=email value="a@b.c"',
    );
    expect(renderElement(el(4, { role: 'checkbox', checked: true, disabled: true }), 'compact')).toBe(
      '[4] checkbox "Item 4" checked disabled',
    );
    expect(renderElement(el(5, { role: 'combobox', options: ['S', 'M'] }), 'compact')).toBe('[5] combobox "Item 5" options=["S", "M"]');
  });
  it('shows the question a radio belongs to in every mode', () => {
    expect(renderElement(el(7, { role: 'radio', name: 'I agree', checked: false, group: 'You enjoy parties.' }), 'compact')).toBe(
      '[7] radio "I agree" unchecked in "You enjoy parties."',
    );
  });

  it('adds hrefs outside compact and nearby text only in full', () => {
    const link = el(6, { role: 'link', href: 'https://shop.test/x', context: 'Price $5' });
    expect(renderElement(link, 'compact')).toBe('[6] link "Item 6"');
    expect(renderElement(link, 'standard')).toBe('[6] link "Item 6" → https://shop.test/x');
    expect(renderElement(link, 'full')).toBe('[6] link "Item 6" → https://shop.test/x — Price $5');
  });
});

describe('renderSnapshot', () => {
  it('includes header, headings only in full, and a summary', () => {
    const r = renderSnapshot(snap([el(1)]), [{ index: 0, tabId: 9, title: 'Shop', url: 'https://shop.test/', active: true }], 'full');
    expect(r.detail).toContain('URL: https://shop.test/');
    expect(r.detail).toContain('Headings: Deals | Cart');
    expect(r.detail).toContain('[1] button "Item 1"');
    expect(r.summary).toBe('Shop (https://shop.test/) — 1 elements');
    expect(r.tabs).toBe('* 0: Shop — https://shop.test/');
    expect(renderSnapshot(snap([el(1)]), [], 'compact').detail).not.toContain('Headings');
  });
  it('cuts the element list at the mode budget', () => {
    const many = Array.from({ length: 2000 }, (_, i) => el(i + 1, { name: 'x'.repeat(40) }));
    const r = renderSnapshot(snap(many), [], 'compact');
    expect(r.detail.length).toBeLessThan(4000 * 4 + 500);
    expect(r.detail).toMatch(/more elements not shown/);
  });
  it('explains restricted pages', () => {
    expect(renderSnapshot(snap([], { restricted: true, url: 'chrome://settings' }), [], 'compact').detail).toMatch(/cannot be controlled/);
  });
});
