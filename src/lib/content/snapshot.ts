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

function isVisible(el: Element, rect: Rect, viewport: { w: number; h: number }, viewportOnly: boolean): boolean {
  if (rect.w <= 0 || rect.h <= 0) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.visibility === 'hidden' || style.display === 'none' || (style.opacity !== '' && Number(style.opacity) === 0))) {
    return false;
  }
  if (viewportOnly && (rect.y + rect.h < 0 || rect.y > viewport.h || rect.x + rect.w < 0 || rect.x > viewport.w)) return false;
  return true;
}

function labelText(el: Element): string {
  const doc = el.ownerDocument;
  if (el.id) {
    const forLabel = Array.from(doc.querySelectorAll('label')).find((l) => l.getAttribute('for') === el.id);
    if (forLabel) return norm(forLabel.textContent ?? '');
  }
  const wrapping = el.closest('label');
  return wrapping ? norm(wrapping.textContent ?? '') : '';
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
    const rect = rectOf(el);
    if (!isVisible(el, rect, viewport, viewportOnly)) continue;
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
  if (scroll && !inViewport(el, rectOf(el)) && typeof (el as HTMLElement).scrollIntoView === 'function') {
    (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    await waitForStableRect(el);
  }
  const rect = rectOf(el);
  if (rect.w <= 0 || rect.h <= 0) return { ok: false, error: `Element [${id}] is not visible right now.` };
  return { ok: true, x: Math.round(rect.x + rect.w / 2), y: Math.round(rect.y + rect.h / 2), info: describe(el, id, rect, false) };
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
  return describe(el, reg.idFor(el), rectOf(el), false);
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
