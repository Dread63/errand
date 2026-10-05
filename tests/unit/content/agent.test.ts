// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createContentHandler } from '@/lib/content/agent';
import { OVERLAY_HOST_ID } from '@/lib/content/overlay';
import type { PageSnapshot } from '@/lib/types';
import type { ResolveResult } from '@/lib/content/protocol';

beforeEach(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, width: 50, height: 20, right: 50, bottom: 20, toJSON() {} }) as DOMRect;
  document.body.innerHTML = `<button>Go</button><select aria-label="Size"><option>S</option></select>`;
  document.getElementById(OVERLAY_HOST_ID)?.remove();
});

describe('createContentHandler', () => {
  it('answers ping, snapshot and resolve', async () => {
    const h = createContentHandler(document, { moveMs: 0 });
    expect(await h({ type: 'ping' })).toBe('pong');
    const snap = (await h({ type: 'snapshot', mode: 'compact' })) as PageSnapshot;
    const go = snap.elements.find((e) => e.name === 'Go')!;
    const r = (await h({ type: 'resolve', id: go.id, scroll: true })) as ResolveResult;
    expect(r).toMatchObject({ ok: true, x: 25, y: 10 });
  });

  it('drives the overlay lazily', async () => {
    const h = createContentHandler(document, { moveMs: 0 });
    expect(document.getElementById(OVERLAY_HOST_ID)).toBeNull();
    await h({ type: 'overlay', op: 'active', on: true });
    await h({ type: 'overlay', op: 'move', x: 1, y: 2 });
    await h({ type: 'overlay', op: 'hover', rect: { x: 0, y: 0, w: 5, h: 5 } });
    expect(document.getElementById(OVERLAY_HOST_ID)).not.toBeNull();
  });

  it('rejects select errors so the background can report them', async () => {
    const h = createContentHandler(document, { moveMs: 0 });
    const snap = (await h({ type: 'snapshot', mode: 'compact' })) as PageSnapshot;
    const size = snap.elements.find((e) => e.name === 'Size')!;
    await expect(h({ type: 'select', id: size.id, value: 'XL' })).rejects.toThrow(/No option "XL"/);
  });
});
