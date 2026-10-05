const FRAME_TAGS = 'iframe,frame,embed,object';

interface Removed {
  el: Element;
  parent: Node;
  next: Node | null;
}

function sourceOf(el: Element): string {
  return el.getAttribute('src') ?? el.getAttribute('data') ?? '';
}

function shadowOf(el: Element): ShadowRoot | null {
  // Content scripts may read closed shadow roots, where extensions often hide their frames.
  const dom = (globalThis as unknown as { chrome?: { dom?: { openOrClosedShadowRoot?: (e: Element) => ShadowRoot | null } } }).chrome?.dom;
  try {
    return dom?.openOrClosedShadowRoot?.(el) ?? el.shadowRoot;
  } catch {
    return el.shadowRoot;
  }
}

/**
 * Chrome refuses debugger access to a tab while it contains a frame belonging to another
 * extension. While active, this keeps such frames out of the page and puts them back on stop.
 */
export class FrameGuard {
  private removed: Removed[] = [];
  private observer: MutationObserver | null = null;
  private active = false;
  private recentRemovals = new Map<string, number[]>();
  private givenUp = new Set<string>();

  constructor(
    private doc: Document,
    private ownExtensionId: string,
  ) {}

  private foreignId(el: Element): string | null {
    const m = /^chrome-extension:\/\/([^/]+)/i.exec(sourceOf(el));
    return m && m[1] !== this.ownExtensionId ? m[1] : null;
  }

  private sweep(root: Document | ShadowRoot, found: Set<string>): void {
    root.querySelectorAll('*').forEach((el) => {
      const shadow = shadowOf(el);
      if (shadow) this.sweep(shadow, found);
    });
    root.querySelectorAll(FRAME_TAGS).forEach((el) => {
      const id = this.foreignId(el);
      if (!id || !el.parentNode || this.givenUp.has(id)) return;
      const src = sourceOf(el);
      if (this.tooManyRemovals(src)) {
        // The extension re-adds its frame as fast as we remove it; fighting it would freeze the page.
        this.givenUp.add(id);
        return;
      }
      found.add(id);
      // Only the first copy is restored later; re-added copies are the extension replacing it.
      if (!this.removed.some((r) => sourceOf(r.el) === src)) this.removed.push({ el, parent: el.parentNode, next: el.nextSibling });
      el.remove();
    });
  }

  private tooManyRemovals(src: string): boolean {
    const now = Date.now();
    const times = (this.recentRemovals.get(src) ?? []).filter((t) => now - t < 1000);
    times.push(now);
    this.recentRemovals.set(src, times);
    return times.length > 50;
  }

  /** Extensions whose frames are re-added too fast to keep out. */
  stubborn(): string[] {
    return [...this.givenUp];
  }

  /** Removes foreign extension frames now and keeps removing them. Returns the extension ids found. */
  start(): string[] {
    const found = new Set<string>();
    this.active = true;
    this.sweep(this.doc, found);
    if (!this.observer) {
      // Records queued before stop() can still be delivered; ignore them once inactive.
      this.observer = new MutationObserver(() => this.active && this.sweep(this.doc, new Set()));
      this.observer.observe(this.doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data'] });
    }
    return [...found];
  }

  stop(): void {
    this.active = false;
    this.observer?.disconnect();
    this.observer = null;
    for (const r of this.removed.reverse()) {
      if (!r.parent.isConnected) continue;
      r.parent.insertBefore(r.el, r.next && r.next.parentNode === r.parent ? r.next : null);
    }
    this.removed = [];
    this.recentRemovals.clear();
    this.givenUp.clear();
  }
}
