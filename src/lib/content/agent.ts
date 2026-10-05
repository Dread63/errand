import { Overlay } from './overlay';
import type { ContentReply, ContentRequest } from './protocol';
import { ElementRegistry, focusedElementInfo, readPageText, resolveElement, selectOption, takeSnapshot } from './snapshot';

export function createContentHandler(doc: Document, opts: { moveMs?: number } = {}) {
  const registry = new ElementRegistry();
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
      case 'readText':
        return readPageText(doc, req.maxChars);
      case 'select':
        return selectOption(registry, req.id, req.value);
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
  const w = window as unknown as { __browserControl?: boolean };
  if (w.__browserControl) return;
  w.__browserControl = true;
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
