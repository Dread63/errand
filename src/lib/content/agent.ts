import { FrameGuard } from './guard';
import { Overlay } from './overlay';
import type { ContentReply, ContentRequest } from './protocol';
import { ElementRegistry, elementAtPoint, focusedElementInfo, readPageText, resolveElement, selectOption, takeSnapshot } from './snapshot';

export function createContentHandler(doc: Document, opts: { moveMs?: number; ownExtensionId?: string } = {}) {
  const registry = new ElementRegistry();
  let guard: FrameGuard | null = null;
  let overlay: Overlay | null = null;
  const ov = () => (overlay ??= new Overlay(doc, opts.moveMs ?? 300));

  return async (req: ContentRequest): Promise<unknown> => {
    switch (req.type) {
      case 'ping':
        return 'pong';
      case 'snapshot':
        return takeSnapshot(doc, registry, req.mode);
      case 'resolve':
        return resolveElement(registry, req.id, req.scroll);
      case 'focused':
        return focusedElementInfo(doc, registry);
      case 'pointInfo':
        return elementAtPoint(doc, registry, req.x, req.y);
      case 'readText':
        return readPageText(doc, req.maxChars);
      case 'select':
        return selectOption(registry, req.id, req.value);
      case 'guard':
        if (!req.on) {
          guard?.stop();
          return [];
        }
        guard ??= new FrameGuard(doc, opts.ownExtensionId ?? (globalThis as unknown as { chrome?: typeof chrome }).chrome?.runtime?.id ?? '');
        return guard.start();
      case 'overlay':
        switch (req.op) {
          case 'active':
            ov().setActive(req.on);
            return null;
          case 'move':
            await ov().moveTo(req.x, req.y);
            return null;
          case 'click':
            ov().click(req.x, req.y);
            return null;
          case 'hover':
            ov().hover(req.rect);
            return null;
          case 'highlight':
            ov().highlight(req.rect, req.label);
            return null;
        }
    }
    return null;
  };
}

export function installContentAgent(): void {
  // A script left behind by a reloaded extension keeps its window flag but can no longer
  // receive messages (its runtime.id is cleared), so only a live instance blocks reinstalling.
  const w = window as unknown as { __browserControlAlive?: () => boolean };
  if (w.__browserControlAlive?.()) return;
  const runtime = chrome.runtime;
  w.__browserControlAlive = () => {
    try {
      return !!runtime?.id;
    } catch {
      return false;
    }
  };
  const handle = createContentHandler(document);
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse: (r: ContentReply) => void) => {
    const m = msg as { __bc?: boolean; req?: ContentRequest } | undefined;
    if (!m?.__bc || !m.req) return false;
    handle(m.req).then(
      (value) => sendResponse({ ok: true, value }),
      (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  });
}
