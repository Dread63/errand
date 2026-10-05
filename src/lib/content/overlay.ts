import type { Rect } from '../types';

export const OVERLAY_HOST_ID = 'browser-control-overlay';

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
.border { position: fixed; inset: 0; border: 3px solid rgba(124, 92, 255, 0.85); box-shadow: inset 0 0 24px rgba(124, 92, 255, 0.45); border-radius: 4px; opacity: 0; transition: opacity 200ms; }
.border.on { opacity: 1; }
.cursor { position: fixed; left: -3px; top: -2px; width: 22px; height: 22px; opacity: 0; transition: transform 300ms cubic-bezier(.2,.8,.2,1), opacity 150ms; filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
.cursor.on { opacity: 1; }
.ring { position: fixed; display: none; border: 2px solid rgba(124, 92, 255, 0.9); border-radius: 6px; background: rgba(124, 92, 255, 0.08); }
.highlight { position: fixed; display: none; border: 3px solid #f5a524; border-radius: 6px; background: rgba(245, 165, 36, 0.12); }
.label { position: absolute; top: -26px; left: 0; background: #f5a524; color: #111; font: 600 12px/1.6 system-ui, sans-serif; padding: 0 8px; border-radius: 4px; white-space: nowrap; }
.ripple { position: fixed; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; border: 2px solid rgba(124, 92, 255, 0.9); animation: ripple 450ms ease-out forwards; }
@keyframes ripple { to { transform: scale(4); opacity: 0; } }
`;

const CURSOR_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#7c5cff" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

function box(el: HTMLElement, rect: Rect | null): void {
  if (!rect) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.style.left = `${rect.x - 3}px`;
  el.style.top = `${rect.y - 3}px`;
  el.style.width = `${rect.w + 6}px`;
  el.style.height = `${rect.h + 6}px`;
}

export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private layer: HTMLElement;
  private border: HTMLElement;
  private cursor: HTMLElement;
  private ring: HTMLElement;
  private hl: HTMLElement;
  private hlLabel: HTMLElement;

  constructor(
    private doc: Document,
    private moveMs = 300,
  ) {
    doc.querySelectorAll(`#${OVERLAY_HOST_ID}`).forEach((stale) => stale.remove()); // from a reloaded extension
    this.host = doc.createElement('div');
    this.host.id = OVERLAY_HOST_ID;
    this.root = this.host.attachShadow({ mode: 'closed' });
    this.root.innerHTML = `<style>${STYLE}</style><div class="layer"><div class="border"></div><div class="ring"></div><div class="highlight"><span class="label"></span></div><div class="cursor">${CURSOR_SVG}</div></div>`;
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.layer = q('.layer');
    this.border = q('.border');
    this.cursor = q('.cursor');
    this.ring = q('.ring');
    this.hl = q('.highlight');
    this.hlLabel = q('.label');
    const win = doc.defaultView;
    this.place((win?.innerWidth ?? 800) / 2, (win?.innerHeight ?? 600) / 2);
    this.attach();
  }

  /** Test hook: the shadow root is closed to page scripts. */
  get shadow(): ShadowRoot {
    return this.root;
  }

  private attach(): void {
    if (!this.host.isConnected) this.doc.documentElement.appendChild(this.host);
  }

  private place(x: number, y: number): void {
    this.cursor.style.transform = `translate(${x}px, ${y}px)`;
  }

  setActive(on: boolean): void {
    this.attach();
    this.border.classList.toggle('on', on);
    this.cursor.classList.toggle('on', on);
    if (!on) {
      this.hover(null);
      this.highlight(null);
    }
  }

  moveTo(x: number, y: number): Promise<void> {
    this.attach();
    this.cursor.classList.add('on');
    this.place(x, y);
    return new Promise((resolve) => setTimeout(resolve, this.moveMs));
  }

  click(x: number, y: number): void {
    this.attach();
    const ripple = this.doc.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    this.layer.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
  }

  hover(rect: Rect | null): void {
    this.attach();
    box(this.ring, rect);
  }

  highlight(rect: Rect | null, label?: string): void {
    this.attach();
    box(this.hl, rect);
    this.hlLabel.textContent = label ?? '';
    this.hlLabel.style.display = label ? '' : 'none';
  }
}
