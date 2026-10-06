import type { Rect } from '../types';

export const OVERLAY_HOST_ID = 'errand-overlay';

const ACCENT = '124, 92, 255';

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
.border { position: fixed; inset: 0; box-shadow: inset 0 0 0 2px rgba(${ACCENT}, .55), inset 0 0 18px 4px rgba(${ACCENT}, .5), inset 0 0 64px 10px rgba(${ACCENT}, .28); opacity: 0; transition: opacity 250ms; }
.border.on { opacity: 1; }
.cursor { position: fixed; left: 0; top: 0; opacity: 0; transition: opacity 180ms; }
.cursor.on { opacity: 1; }
.arrow { position: absolute; left: -5px; top: -4px; width: 34px; height: 34px; transform-origin: 5px 4px; transition: transform 140ms cubic-bezier(.3,.7,.4,1.4); filter: drop-shadow(0 0 3px rgba(${ACCENT}, .85)) drop-shadow(0 2px 3px rgba(0,0,0,.3)); }
.cursor.on .arrow { animation: glow 2.4s ease-in-out infinite; }
.arrow.press { transform: scale(.82); }
@keyframes glow { 50% { filter: drop-shadow(0 0 6px rgba(${ACCENT}, .9)) drop-shadow(0 2px 3px rgba(0,0,0,.3)); } }
.tag { position: absolute; left: 26px; top: 30px; max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 4px 11px; border-radius: 999px; background: rgb(${ACCENT}); color: #fff; font: 600 13px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; letter-spacing: .01em; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; box-shadow: 0 0 14px rgba(${ACCENT}, .55), 0 2px 6px rgba(0,0,0,.2); visibility: hidden; }
.tag.on { visibility: visible; }
.tag.left { left: auto; right: 14px; }
.tag.above { top: auto; bottom: 14px; }
.ring { position: fixed; display: none; border: 2px solid rgba(${ACCENT}, .85); border-radius: 8px; background: rgba(${ACCENT}, .07); transition: all 160ms ease-out; }
.highlight { position: fixed; display: none; border: 2px solid #f5a524; border-radius: 8px; background: rgba(245, 165, 36, .12); }
.label { position: absolute; top: -26px; left: 0; background: #f5a524; color: #111; font: 600 12px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif; padding: 0 8px; border-radius: 6px; white-space: nowrap; }
.ripple { position: fixed; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; background: rgba(${ACCENT}, .35); animation: pulse 450ms ease-out forwards; }
@keyframes pulse { from { transform: scale(.35); opacity: .9; } to { transform: scale(1.6); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .cursor.on .arrow { animation: none; }
  .arrow { transition: none; }
}
`;

const ARROW_SVG = `<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 3.2c-.6-.3-1.3.3-1.1.9l5.3 15.6c.2.7 1.2.7 1.4 0l1.9-5.6c.1-.3.3-.5.6-.6l5.6-1.9c.7-.2.7-1.2 0-1.4z" fill="rgb(${ACCENT})" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

const MAX_LABEL = 40;

interface Pt {
  x: number;
  y: number;
}

/** Mid-point of a gently curved path: offset perpendicular to travel by 12% of the distance, at most 60px. */
export function arcPoint(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const mid = { x: from.x + dx / 2, y: from.y + dy / 2 };
  if (dist === 0) return mid;
  const bend = Math.min(60, dist * 0.12);
  return { x: mid.x + (-dy / dist) * bend, y: mid.y + (dx / dist) * bend };
}

/** 180ms for tiny moves up to 450ms for long ones. */
export function moveDuration(dist: number): number {
  return Math.round(Math.min(450, 180 + Math.sqrt(dist) * 9));
}

/** Which side of the cursor the label pill goes so it stays inside the viewport. */
export function labelPlacement(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: boolean; above: boolean } {
  return { left: x + 26 + w > vw - 8, above: y + 30 + h > vh - 8 };
}

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
  private arrow: SVGElement;
  private tag: HTMLElement;
  private ring: HTMLElement;
  private hl: HTMLElement;
  private hlLabel: HTMLElement;
  private pos: Pt;

  /** `moveMs` 0 disables animation (tests); otherwise duration scales with distance. */
  constructor(
    private doc: Document,
    private moveMs = 300,
  ) {
    doc.querySelectorAll(`#${OVERLAY_HOST_ID}`).forEach((stale) => stale.remove()); // from a reloaded extension
    this.host = doc.createElement('div');
    this.host.id = OVERLAY_HOST_ID;
    this.root = this.host.attachShadow({ mode: 'closed' });
    this.root.innerHTML = `<style>${STYLE}</style><div class="layer"><div class="border"></div><div class="ring"></div><div class="highlight"><span class="label"></span></div><div class="cursor">${ARROW_SVG}<span class="tag"></span></div></div>`;
    const q = <T extends Element = HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.layer = q('.layer');
    this.border = q('.border');
    this.cursor = q('.cursor');
    this.arrow = q<SVGElement>('.arrow');
    this.tag = q('.tag');
    this.ring = q('.ring');
    this.hl = q('.highlight');
    this.hlLabel = q('.label');
    const win = doc.defaultView;
    this.pos = { x: (win?.innerWidth ?? 800) / 2, y: (win?.innerHeight ?? 600) / 2 };
    this.place(this.pos.x, this.pos.y);
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
    this.cursor.style.left = `${Math.round(x)}px`;
    this.cursor.style.top = `${Math.round(y)}px`;
  }

  private reducedMotion(): boolean {
    return this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private setLabel(label: string | undefined): void {
    if (label === undefined) return;
    const text = label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
    this.tag.textContent = text;
    this.tag.classList.toggle('on', !!text);
  }

  private placeLabel(x: number, y: number): void {
    const win = this.doc.defaultView;
    const w = this.tag.offsetWidth || this.tag.textContent!.length * 8 + 22;
    const p = labelPlacement(x, y, w, 28, win?.innerWidth ?? 1e6, win?.innerHeight ?? 1e6);
    this.tag.classList.toggle('left', p.left);
    this.tag.classList.toggle('above', p.above);
  }

  setActive(on: boolean): void {
    this.attach();
    this.border.classList.toggle('on', on);
    this.cursor.classList.toggle('on', on);
    if (!on) {
      this.setLabel('');
      this.hover(null);
      this.highlight(null);
    }
  }

  moveTo(x: number, y: number, label?: string): Promise<void> {
    this.attach();
    this.cursor.classList.add('on');
    this.setLabel(label);
    this.placeLabel(x, y);
    const from = this.pos;
    this.pos = { x, y };
    this.place(x, y);
    if (this.moveMs === 0) return Promise.resolve();
    const reduced = this.reducedMotion();
    const ms = reduced ? 120 : moveDuration(Math.hypot(x - from.x, y - from.y));
    const mid = reduced ? { x: (from.x + x) / 2, y: (from.y + y) / 2 } : arcPoint(from, { x, y });
    const anim = this.cursor.animate?.(
      [
        { left: `${Math.round(from.x)}px`, top: `${Math.round(from.y)}px` },
        { left: `${Math.round(mid.x)}px`, top: `${Math.round(mid.y)}px`, offset: 0.5 },
        { left: `${Math.round(x)}px`, top: `${Math.round(y)}px` },
      ],
      { duration: ms, easing: 'cubic-bezier(.45,0,.2,1)' },
    );
    return new Promise((resolve) => {
      if (anim) anim.onfinish = () => resolve();
      setTimeout(resolve, ms + 50); // in case the animation is cancelled or unsupported
    });
  }

  click(x: number, y: number): void {
    this.attach();
    this.arrow.classList.add('press');
    setTimeout(() => this.arrow.classList.remove('press'), 140);
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
