import { MODE_LIMITS } from '../agent/modes';
import type { ContextMode, ElementInfo, PageSnapshot, Rect } from '../types';
import { clip } from '../util';
import type { ResolveResult } from './protocol';

const INTERACTIVE = [
  'a[href]',
  'button',
  'input:not([type=hidden])',
  'select',
  'textarea',
  'summary',
  '[role=button]',
  '[role=link]',
  '[role=checkbox]',
  '[role=radio]',
  '[role=tab]',
  '[role=menuitem]',
  '[role=option]',
  '[role=switch]',
  '[role=combobox]',
  '[role=textbox]',
  '[role=searchbox]',
  '[contenteditable=""]',
  '[contenteditable=true]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export class ElementRegistry {
  private ids = new WeakMap<Element, number>();
  private els = new Map<number, Element>();
  private next = 1;

  idFor(el: Element): number {
    let id = this.ids.get(el);
    if (id === undefined) {
      id = this.next++;
      this.ids.set(el, id);
    }
    this.els.set(id, el);
    return id;
  }

  get(id: number): Element | undefined {
    const el = this.els.get(id);
    if (el && !el.isConnected) {
      this.els.delete(id);
      return undefined;
    }
    return el;
  }

  prune(): void {
    for (const [id, el] of this.els) if (!el.isConnected) this.els.delete(id);
  }
}

function collect(root: Document | ShadowRoot, out: Element[], seen: Set<Element>): void {
  root.querySelectorAll(INTERACTIVE).forEach((el) => {
    if (!seen.has(el)) {
      seen.add(el);
      out.push(el);
    }
  });
  root.querySelectorAll('*').forEach((el) => {
    if (el.shadowRoot) collect(el.shadowRoot, out, seen);
    if (el.tagName === 'IFRAME') {
      try {
        const d = (el as HTMLIFrameElement).contentDocument;
        if (d) collect(d, out, seen);
      } catch {
        // cross-origin iframe: not supported in v1
      }
    }
  });
}

function frameOffset(el: Element): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let win: Window | null = el.ownerDocument.defaultView;
  while (win && win.frameElement) {
    const r = win.frameElement.getBoundingClientRect();
    x += r.left;
    y += r.top;
    win = win.parent;
  }
  return { x, y };
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  const o = frameOffset(el);
  return { x: Math.round(r.left + o.x), y: Math.round(r.top + o.y), w: Math.round(r.width), h: Math.round(r.height) };
}

const isToggle = (el: Element) => el.tagName === 'INPUT' && /^(radio|checkbox)$/i.test(el.getAttribute('type') ?? '');

function findLabel(el: Element): Element | null {
  if (el.id) {
    const forLabel = Array.from(el.ownerDocument.querySelectorAll('label')).find((l) => l.getAttribute('for') === el.id);
    if (forLabel) return forLabel;
  }
  return el.closest('label');
}

/**
 * Where an element is drawn and should be clicked. Custom-styled radios/checkboxes are often
 * shrunk to a pixel (sr-only); their visible label is the real target then.
 */
function targetOf(el: Element): { rect: Rect; via: Element } {
  const rect = rectOf(el);
  if (isToggle(el) && (rect.w < 4 || rect.h < 4)) {
    const label = findLabel(el);
    if (label) {
      const lr = rectOf(label);
      if (lr.w > 0 && lr.h > 0) return { rect: lr, via: label };
    }
  }
  return { rect, via: el };
}

function groupLabel(el: Element): string | undefined {
  if (!isToggle(el)) return undefined;
  const legend = el.closest('fieldset')?.querySelector('legend')?.textContent;
  if (legend && norm(legend)) return clip(norm(legend), 120);
  const group = el.closest('[role=radiogroup],[role=group]');
  if (!group) return undefined;
  const aria = group.getAttribute('aria-label');
  if (aria?.trim()) return clip(norm(aria), 120);
  const by = group.getAttribute('aria-labelledby');
  const text = by ? by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' ') : '';
  return norm(text) ? clip(norm(text), 120) : undefined;
}

function isVisible(el: Element, rect: Rect, viewport: { w: number; h: number }, viewportOnly: boolean): boolean {
  if (rect.w <= 0 || rect.h <= 0) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  // Transparent radios/checkboxes laid over a custom-drawn control are still what gets clicked.
  const transparent = style && style.opacity !== '' && Number(style.opacity) === 0 && !isToggle(el);
  if (style && (style.visibility === 'hidden' || style.display === 'none' || transparent)) {
    return false;
  }
  if (viewportOnly && (rect.y + rect.h < 0 || rect.y > viewport.h || rect.x + rect.w < 0 || rect.x > viewport.w)) return false;
  return true;
}

function labelText(el: Element): string {
  const label = findLabel(el);
  return label ? norm(label.textContent ?? '') : '';
}

function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return norm(aria);
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const t = labelledby
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (t.trim()) return norm(t);
  }
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    const label = labelText(el);
    if (label) return label;
    const ph = el.getAttribute('placeholder');
    if (ph) return norm(ph);
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (tag === 'INPUT' && ['submit', 'button', 'reset'].includes(type)) return norm((el as HTMLInputElement).value || type);
  }
  const text = tag === 'SELECT' ? '' : norm(el.textContent ?? '');
  if (text) return text;
  const alt = el.querySelector('img[alt]')?.getAttribute('alt');
  if (alt) return norm(alt);
  return norm(el.getAttribute('title') ?? el.getAttribute('name') ?? '');
}

function roleOf(el: Element): string {
  const r = el.getAttribute('role');
  if (r) return r;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button' || tag === 'summary') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const t = (el.getAttribute('type') ?? 'text').toLowerCase();
    const map: Record<string, string> = {
      checkbox: 'checkbox',
      radio: 'radio',
      submit: 'button',
      button: 'button',
      reset: 'button',
      image: 'button',
      range: 'slider',
      file: 'file',
      search: 'searchbox',
    };
    return map[t] ?? 'textbox';
  }
  if (el.getAttribute('contenteditable') !== null) return 'textbox';
  return 'clickable';
}

function describe(el: Element, id: number, rect: Rect, withContext: boolean): ElementInfo {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  const inForm = !!el.closest('form');
  const info: ElementInfo = {
    id,
    tag,
    role: roleOf(el),
    name: clip(accessibleName(el), 120),
    inForm,
    isSubmit: (tag === 'button' && (type === 'submit' || (type === '' && inForm))) || (tag === 'input' && (type === 'submit' || type === 'image')),
    download: el.hasAttribute('download'),
    rect,
  };
  if (type) info.type = type;
  const autocomplete = el.getAttribute('autocomplete');
  if (autocomplete) info.autocomplete = autocomplete;
  const fieldName = el.getAttribute('name') || el.id;
  if (fieldName) info.fieldName = fieldName;
  if (tag === 'a') {
    const href = (el as HTMLAnchorElement).href;
    if (href) info.href = href;
  }
  if (tag === 'input' || tag === 'textarea') {
    const input = el as HTMLInputElement;
    if (type === 'checkbox' || type === 'radio') info.checked = input.checked;
    else if (input.value) info.value = type === 'password' ? '••••••' : clip(input.value, 200);
  }
  if (tag === 'select') {
    const s = el as HTMLSelectElement;
    info.options = Array.from(s.options).map((o) => norm(o.text));
    const selected = s.options[s.selectedIndex];
    if (selected) info.value = norm(selected.text);
  }
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked) info.checked = ariaChecked === 'true';
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') info.disabled = true;
  const group = groupLabel(el);
  if (group) info.group = group;
  if (withContext) {
    const ctx = norm(el.parentElement?.textContent ?? '');
    if (ctx && ctx !== info.name) info.context = clip(ctx, 160);
  }
  return info;
}

export function takeSnapshot(doc: Document, reg: ElementRegistry, mode: ContextMode): PageSnapshot {
  const win = doc.defaultView!;
  const viewport = { w: win.innerWidth, h: win.innerHeight };
  const viewportOnly = MODE_LIMITS[mode].viewportOnly;
  reg.prune();
  const found: Element[] = [];
  collect(doc, found, new Set());
  const elements: ElementInfo[] = [];
  for (const el of found) {
    const { rect, via } = targetOf(el);
    if (!isVisible(via, rect, viewport, viewportOnly)) continue;
    elements.push(describe(el, reg.idFor(el), rect, mode === 'full'));
  }
  const headings =
    mode === 'full'
      ? Array.from(doc.querySelectorAll('h1,h2,h3'))
          .map((h) => norm(h.textContent ?? ''))
          .filter(Boolean)
          .slice(0, 30)
      : [];
  const scroller = doc.scrollingElement ?? doc.documentElement;
  return {
    url: doc.location?.href ?? '',
    title: doc.title,
    restricted: false,
    elements,
    headings,
    scrollY: Math.round(win.scrollY),
    scrollMaxY: Math.max(0, Math.round(scroller.scrollHeight - win.innerHeight)),
    viewport,
  };
}

function inViewport(el: Element, rect: Rect): boolean {
  const top = el.ownerDocument.defaultView?.top ?? el.ownerDocument.defaultView;
  const w = top?.innerWidth ?? 0;
  const h = top?.innerHeight ?? 0;
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= w && rect.y + rect.h <= h;
}

/** Waits until the element stops moving (a smooth scroll has finished), up to maxMs. */
async function waitForStableRect(el: Element, maxMs = 1000, pollMs = 50): Promise<void> {
  const deadline = Date.now() + maxMs;
  let prev = rectOf(el);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const next = rectOf(el);
    if (next.x === prev.x && next.y === prev.y) return;
    prev = next;
  }
}

export async function resolveElement(reg: ElementRegistry, id: number, scroll: boolean): Promise<ResolveResult> {
  const el = reg.get(id);
  if (!el) return { ok: false, error: `Element [${id}] no longer exists on the page. Use an id from the latest page state.` };
  const via = targetOf(el).via;
  if (scroll && !inViewport(via, rectOf(via)) && typeof (via as HTMLElement).scrollIntoView === 'function') {
    (via as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    await waitForStableRect(via);
  }
  const rect = targetOf(el).rect;
  if (rect.w <= 0 || rect.h <= 0) return { ok: false, error: `Element [${id}] is not visible right now.` };
  const x = Math.round(rect.x + rect.w / 2);
  const y = Math.round(rect.y + rect.h / 2);
  const result: ResolveResult = { ok: true, x, y, info: describe(el, id, rect, false) };
  const hit = hitAt(topDocument(el), x, y);
  if (hit && !composedContains(el, hit) && !composedContains(via, hit) && !composedContains(hit, via)) {
    const cover = coverOf(hit);
    result.coveredBy = describe(cover, reg.idFor(cover), rectOf(cover), false);
  }
  return result;
}

function topDocument(el: Element): Document {
  try {
    return el.ownerDocument.defaultView?.top?.document ?? el.ownerDocument;
  } catch {
    return el.ownerDocument; // cross-origin parent
  }
}

/** Whether inner is outer or lies inside it, crossing shadow roots and same-origin iframes. */
function composedContains(outer: Element, inner: Element): boolean {
  let n: Node | null = inner;
  while (n) {
    if (n === outer) return true;
    if (n instanceof ShadowRoot) n = n.host;
    else if (n.nodeType === Node.DOCUMENT_NODE) n = (n as Document).defaultView?.frameElement ?? null;
    else n = n.parentNode;
  }
  return false;
}

/** The interactive element, or else the named container (a menu, dialog…), that a hit lands in. */
function coverOf(hit: Element): Element {
  return (
    hit.closest(INTERACTIVE) ??
    hit.closest('[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip],[aria-label],dialog') ??
    hit
  );
}

export function focusedElementInfo(doc: Document, reg: ElementRegistry): ElementInfo | null {
  let el: Element | null = doc.activeElement;
  for (;;) {
    if (el?.shadowRoot?.activeElement) {
      el = el.shadowRoot.activeElement;
      continue;
    }
    if (el?.tagName === 'IFRAME') {
      try {
        const inner = (el as HTMLIFrameElement).contentDocument?.activeElement;
        if (inner) {
          el = inner;
          continue;
        }
      } catch {
        // cross-origin
      }
    }
    break;
  }
  if (!el || !el.isConnected || el === doc.body || el === doc.documentElement) return null;
  return describe(el, reg.idFor(el), targetOf(el).rect, false);
}

/**
 * The element drawn at a top-level viewport point, or the interactive element containing it,
 * looking through open shadow roots and same-origin iframes. The overlay is ignored.
 */
export function elementAtPoint(doc: Document, reg: ElementRegistry, x: number, y: number): ElementInfo | null {
  const el = hitAt(doc, x, y);
  if (!el) return null;
  const target = el.closest(INTERACTIVE) ?? el;
  return describe(target, reg.idFor(target), targetOf(target).rect, false);
}

/** The deepest element drawn at a top-level viewport point, ignoring the overlay. */
function hitAt(doc: Document, x: number, y: number): Element | null {
  let root: Document | ShadowRoot = doc;
  let px = x;
  let py = y;
  let el: Element | null = null;
  for (;;) {
    const hit: Element | undefined = (root.elementsFromPoint?.(px, py) ?? []).find((e) => !e.closest('#browser-control-overlay'));
    if (!hit || hit === el) break;
    el = hit;
    if (hit.shadowRoot) {
      root = hit.shadowRoot;
      continue;
    }
    if (hit.tagName === 'IFRAME') {
      try {
        const inner: Document | null = (hit as HTMLIFrameElement).contentDocument;
        if (inner) {
          const r = hit.getBoundingClientRect();
          px -= r.left;
          py -= r.top;
          root = inner;
          continue;
        }
      } catch {
        // cross-origin: report the iframe itself
      }
    }
    break;
  }
  return !el || el === doc.documentElement ? null : el;
}

export function readPageText(doc: Document, maxChars: number): string {
  const body = doc.body as HTMLElement | null;
  if (!body) return '';
  const raw = body.innerText ?? body.textContent ?? '';
  const text = raw
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return clip(text, maxChars);
}

export function selectOption(reg: ElementRegistry, id: number, value: string): string {
  const el = reg.get(id);
  if (!el) throw new Error(`Element [${id}] no longer exists on the page.`);
  if (el.tagName !== 'SELECT') throw new Error(`Element [${id}] is not a dropdown (<select>). Click it instead.`);
  const s = el as HTMLSelectElement;
  const options = Array.from(s.options);
  const want = value.trim().toLowerCase();
  const opt =
    options.find((o) => norm(o.text).toLowerCase() === want || o.value.toLowerCase() === want) ??
    options.find((o) => norm(o.text).toLowerCase().includes(want));
  if (!opt) throw new Error(`No option "${value}". Options: ${options.map((o) => `"${norm(o.text)}"`).join(', ')}`);
  s.value = opt.value;
  s.dispatchEvent(new Event('input', { bubbles: true }));
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return `Selected "${norm(opt.text)}".`;
}
