// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ElementRegistry,
  focusedElementInfo,
  readPageText,
  resolveElement,
  selectOption,
  takeSnapshot,
} from '@/lib/content/snapshot';

function rect(top: number, width = 100, height = 30): DOMRect {
  return { x: 10, y: top, left: 10, top, width, height, right: 10 + width, bottom: top + height, toJSON() {} } as DOMRect;
}

beforeEach(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute('data-hidden')) return rect(0, 0, 0);
    return rect(this.hasAttribute('data-below') ? 5000 : 20);
  };
  document.body.innerHTML = '';
  document.title = 'Test page';
});

const snap = (mode: 'compact' | 'standard' | 'full' = 'compact', reg = new ElementRegistry()) => takeSnapshot(document, reg, mode);
const byName = (s: ReturnType<typeof snap>, name: string) => s.elements.find((e) => e.name === name);

describe('takeSnapshot', () => {
  it('finds interactive elements with roles and accessible names', () => {
    document.body.innerHTML = `
      <label for="e">Email</label><input id="e" type="email" value="a@b.c">
      <label>Name <input name="name"></label>
      <a href="/cart">Cart</a>
      <button aria-label="Close dialog">×</button>
      <div role="button">Custom</div>
      <input type="checkbox" aria-label="Agree" checked>
      <p>Not interactive</p>`;
    const s = snap();
    expect(s.title).toBe('Test page');
    expect(s.elements.map((e) => `${e.role}:${e.name}`)).toEqual([
      'textbox:Email',
      'textbox:Name',
      'link:Cart',
      'button:Close dialog',
      'button:Custom',
      'checkbox:Agree',
    ]);
    expect(byName(s, 'Email')).toMatchObject({ type: 'email', value: 'a@b.c' });
    expect(byName(s, 'Name')).toMatchObject({ fieldName: 'name' });
    expect(byName(s, 'Cart')?.href).toMatch(/\/cart$/);
    expect(byName(s, 'Agree')?.checked).toBe(true);
    expect(byName(s, 'Email')?.rect).toEqual({ x: 10, y: 20, w: 100, h: 30 });
  });

  it('detects forms and submit buttons', () => {
    document.body.innerHTML = `<form><input name="q" aria-label="Query"><button>Go</button><button type="button">Help</button></form><button>Outside</button>`;
    const s = snap();
    expect(byName(s, 'Go')).toMatchObject({ inForm: true, isSubmit: true });
    expect(byName(s, 'Help')).toMatchObject({ inForm: true, isSubmit: false });
    expect(byName(s, 'Outside')).toMatchObject({ inForm: false, isSubmit: false });
    expect(byName(s, 'Query')?.inForm).toBe(true);
  });

  it('masks password values', () => {
    document.body.innerHTML = `<input type="password" aria-label="Password" value="hunter2" autocomplete="current-password">`;
    expect(byName(snap(), 'Password')).toMatchObject({ value: '••••••', autocomplete: 'current-password' });
  });

  it('lists select options and the selected value', () => {
    document.body.innerHTML = `<select aria-label="Size"><option>S</option><option selected>M</option></select>`;
    expect(byName(snap(), 'Size')).toMatchObject({ role: 'combobox', options: ['S', 'M'], value: 'M' });
  });

  it('skips hidden elements, and off-screen ones unless mode is full', () => {
    document.body.innerHTML = `<button data-hidden>Hidden</button><button data-below>Below</button><button style="visibility:hidden">Invisible</button><button>Shown</button>`;
    expect(snap('compact').elements.map((e) => e.name)).toEqual(['Shown']);
    expect(snap('full').elements.map((e) => e.name)).toEqual(['Below', 'Shown']);
  });

  it('includes open shadow DOM content', () => {
    document.body.innerHTML = `<div id="host"></div>`;
    document.getElementById('host')!.attachShadow({ mode: 'open' }).innerHTML = `<button>Inner</button>`;
    expect(byName(snap(), 'Inner')).toBeDefined();
  });

  it('adds headings and nearby text only in full mode', () => {
    document.body.innerHTML = `<h1>Deals</h1><div>Price $5 <button>Buy</button></div>`;
    expect(snap('compact').headings).toEqual([]);
    const full = snap('full');
    expect(full.headings).toEqual(['Deals']);
    expect(byName(full, 'Buy')?.context).toBe('Price $5 Buy');
  });

  it('Review Focus: keeps ids stable and never reuses them', async () => {
    document.body.innerHTML = `<button id="a">A</button><button id="b">B</button>`;
    const reg = new ElementRegistry();
    const first = snap('compact', reg);
    const idA = byName(first, 'A')!.id;
    const idB = byName(first, 'B')!.id;
    document.getElementById('a')!.remove();
    document.body.insertAdjacentHTML('afterbegin', '<button>C</button>');
    const second = snap('compact', reg);
    expect(byName(second, 'B')!.id).toBe(idB);
    expect(byName(second, 'C')!.id).not.toBe(idA);
    expect(await resolveElement(reg, idA, false)).toEqual({
      ok: false,
      error: `Element [${idA}] no longer exists on the page. Use an id from the latest page state.`,
    });
  });
});

describe('resolveElement', () => {
  let scrolls: ScrollIntoViewOptions[] = [];
  beforeEach(() => {
    scrolls = [];
    Element.prototype.scrollIntoView = function (opts?: boolean | ScrollIntoViewOptions) {
      scrolls.push(opts as ScrollIntoViewOptions);
      this.removeAttribute('data-below'); // now in view
    };
  });

  it('returns the element center without scrolling when it is already in view', async () => {
    document.body.innerHTML = `<button>Go</button>`;
    const reg = new ElementRegistry();
    const id = snap('compact', reg).elements[0].id;
    expect(await resolveElement(reg, id, true)).toMatchObject({ ok: true, x: 60, y: 35 });
    expect(scrolls).toEqual([]);
  });

  it('smooth-scrolls off-screen elements into view, then measures them', async () => {
    document.body.innerHTML = `<button data-below>Far</button>`;
    const reg = new ElementRegistry();
    const id = snap('full', reg).elements[0].id;
    expect(await resolveElement(reg, id, true)).toMatchObject({ ok: true, x: 60, y: 35 });
    expect(scrolls).toEqual([{ behavior: 'smooth', block: 'center', inline: 'center' }]);
  });
});

describe('selectOption', () => {
  it('selects by text, fires change, and lists options when missing', () => {
    document.body.innerHTML = `<select aria-label="Size"><option value="s">Small</option><option value="m">Medium</option></select>`;
    const reg = new ElementRegistry();
    const id = snap('compact', reg).elements[0].id;
    let changed = 0;
    document.querySelector('select')!.addEventListener('change', () => changed++);
    expect(selectOption(reg, id, 'medium')).toBe('Selected "Medium".');
    expect(document.querySelector('select')!.value).toBe('m');
    expect(changed).toBe(1);
    expect(() => selectOption(reg, id, 'XL')).toThrow('No option "XL". Options: "Small", "Medium"');
  });
  it('refuses non-select elements', () => {
    document.body.innerHTML = `<button>Go</button>`;
    const reg = new ElementRegistry();
    const id = snap('compact', reg).elements[0].id;
    expect(() => selectOption(reg, id, 'x')).toThrow(/not a dropdown/);
  });
});

describe('focusedElementInfo and readPageText', () => {
  it('describes the focused field', () => {
    document.body.innerHTML = `<form><input aria-label="Search"></form>`;
    document.querySelector('input')!.focus();
    expect(focusedElementInfo(document, new ElementRegistry())).toMatchObject({ name: 'Search', inForm: true });
  });
  it('returns null when nothing is focused', () => {
    expect(focusedElementInfo(document, new ElementRegistry())).toBeNull();
  });
  it('reads and clips page text', () => {
    document.body.innerHTML = `<h1>Title</h1><p>  Hello   world  </p>`;
    expect(readPageText(document, 1000)).toBe('Title\nHello world');
    expect(readPageText(document, 5)).toBe('Title…[+12 chars]');
  });
});
